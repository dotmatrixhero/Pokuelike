import type { Agent, TerrainKind, World } from "./types.js";
import type { PokemonType } from "./typing.js";
import type { MoveSpec, MoveTreeNode } from "./moves.js";
import { applyMoveTree, trySpendSkillPoints } from "./moves.js";
import type { BaseStats } from "./stats.js";
import { calculateStats } from "./stats.js";
import type { EventLog } from "./events.js";
import { grantPassive, revokePassive } from "./status.js";

/** PokeRogue's `GrowthRate` enum keys, e.g. as imported onto `SpeciesDexEntry.growthRate`. */
export type GrowthRateKey = "ERRATIC" | "FAST" | "MEDIUM_FAST" | "MEDIUM_SLOW" | "SLOW" | "FLUCTUATING";

/**
 * The six mainline growth-rate curves, implemented directly from the public
 * piecewise polynomial formulas (not scraped from PokeRogue — see DESIGN.md).
 * Returns the *cumulative total* exp required to reach `level` (matches the
 * shape of the reference table this was checked against).
 *
 * Verified numerically against every entry (levels 2-100, level 1 excepted —
 * see below) of `poke_the_spire/src/data/exp.ts`'s raw per-growth-rate
 * `expLevels` arrays for all six curves: zero mismatches. (Level 1 is
 * special-cased to 0 here, matching real mainline; the raw formulas alone
 * produce a small nonzero residual at level 1 for several curves, which
 * PokeRogue's own table also overrides to 0.) Deliberately NOT cross-checked
 * against PokeRogue's *exported* `getLevelTotalExp` function — that function
 * additionally blends every non-Medium-Fast curve 32.5%/67.5% with Medium
 * Fast (a PokeRogue-specific balance house-rule, not real mainline behavior),
 * so its output differs from pure mainline on purpose; the raw tables (pre-
 * blend) are the real correctness reference and that's what this was checked
 * against.
 */
export function totalExpForLevel(growthRate: GrowthRateKey, level: number): number {
  if (level <= 1) return 0;
  const n = level;
  switch (growthRate) {
    case "ERRATIC": {
      if (n < 50) return Math.floor((n ** 3 * (100 - n)) / 50);
      if (n < 68) return Math.floor((n ** 3 * (150 - n)) / 100);
      if (n < 98) return Math.floor((n ** 3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n ** 3 * (160 - n)) / 100);
    }
    case "FAST":
      return Math.floor((4 * n ** 3) / 5);
    case "MEDIUM_FAST":
      return n ** 3;
    case "MEDIUM_SLOW":
      return Math.floor((6 / 5) * n ** 3 - 15 * n ** 2 + 100 * n - 140);
    case "SLOW":
      return Math.floor((5 * n ** 3) / 4);
    case "FLUCTUATING": {
      if (n < 15) return Math.floor(n ** 3 * ((Math.floor((n + 1) / 3) + 24) / 50));
      if (n < 36) return Math.floor((n ** 3 * (n + 14)) / 50);
      return Math.floor((n ** 3 * (Math.floor(n / 2) + 32)) / 50);
    }
  }
}

const MAX_LEVEL = 100;

/** The highest level whose cumulative exp threshold `exp` has crossed, capped at `MAX_LEVEL`. */
export function levelForExp(growthRate: GrowthRateKey, exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && totalExpForLevel(growthRate, level + 1) <= exp) level++;
  return level;
}

/** Per-species data `grantExp` needs that only `packages/data`'s dex actually has — injected, same pattern as `HuntRules`. */
export interface LevelingProfile {
  growthRate: GrowthRateKey;
  baseStats: BaseStats;
  /** Base form's typing — a newborn's starting types (see `baseSpeciesOf` below: breeding produces the base form, not whatever the parent evolved into). */
  types: PokemonType[];
  /** Wild-battle base exp yield: floor(baseExp * defeatedLevel / 7) on a kill. */
  baseExp: number;
  /** [level, move key] pairs, unsorted-safe — every entry with level <= newLevel is learned. */
  levelMoves: Array<[number, string]>;
  /** Level-gated evolutions only (item/trade/friendship deferred — see DESIGN.md). */
  evolutions: Array<{ targetSpeciesId: string; level: number }>;
  /**
   * Mainline egg groups (e.g. `["monster", "grass"]`) — real cross-species
   * breeding compatibility: two species can mate if they share *any* group,
   * regardless of evolution stage. `["undiscovered"]` means never breeds at
   * all (legendaries, baby Pokemon). Empty/absent means "not classified" —
   * treated as compatible only with its own species (a safe fallback, not
   * "can't breed"), since the source dex this sim imports from (PokeRogue)
   * doesn't carry egg-group data at all — it's a battler, not the mainline
   * Day Care sim, so this has to be hand-curated per species as they're
   * added rather than pulled from the import. See DESIGN.md.
   */
  eggGroups?: string[];
  /**
   * Mirrors `SpeciesDef.buildsShelter` (packages/data) — set here so
   * `ensureCombatProfile` can denormalize it onto a newborn exactly like
   * `spawnAgent` already does for a founder, otherwise a shelter-building
   * lineage's offspring would silently lose the trait the instant they're
   * born (an agent's own `buildsShelter` is otherwise only ever set once,
   * at whichever creation site actually built it — see shelter.ts).
   */
  buildsShelter?: boolean;
  /**
   * Mirrors `SpeciesDef.preferredTerrain` (packages/data) — same
   * denormalize-onto-newborn reasoning as `buildsShelter` immediately
   * above: without this, a tile-preference lineage's offspring would
   * silently wander with no preference the instant they're born, since an
   * agent's own `preferredTerrain` is otherwise only ever set once, at
   * spawn (see needs.ts's `applyExploration`).
   */
  preferredTerrain?: TerrainKind[];
  /**
   * Mirrors `SpeciesDef.obligateAquatic` (packages/data) — same
   * denormalize-onto-newborn reasoning as `buildsShelter`/`preferredTerrain`
   * immediately above: without this, a genuinely obligate-aquatic lineage's
   * offspring would hatch with no restriction at all, since an agent's own
   * `obligateAquatic` is otherwise only ever set once, at whichever creation
   * site actually built it — see `waterBody.ts`'s `canEnterLand`.
   */
  obligateAquatic?: boolean;
}

export interface LevelingContext {
  /** Looks up a `LevelingProfile` by the sim's `Agent.species` id. Undefined = exp still accrues but nothing can level/evolve/learn (unknown species). */
  getProfile(speciesId: string): LevelingProfile | undefined;
  /** Resolves a level-move's key to a usable `MoveSpec`. Undefined = can't be represented in combat (e.g. a status move — see DESIGN.md) but is still recorded in `knownMoves` and logged. */
  resolveMove(moveKey: string): MoveSpec | undefined;
  /**
   * The root (pre-evolution) species of `speciesId`'s line — e.g.
   * "venusaur" -> "bulbasaur". Breeding always produces the base form
   * (mainline-accurate: a bred Venusaur's offspring hatches as a
   * Bulbasaur, never another Venusaur), so `spawnOffspring` uses this
   * instead of the mother's own (possibly evolved) species. Optional so
   * bare-engine tests without dex data keep working — falls back to the
   * parent's own species when absent.
   */
  baseSpeciesOf?(speciesId: string): string;
}

/**
 * Real mainline breeding compatibility: two species can mate if they share
 * an egg group, regardless of evolution stage — e.g. Bulbasaur and
 * Charmander both include "monster", so a Bulbasaur/Charmander pair is a
 * real cross-species breeding pair in the actual games, not a same-species
 * requirement. A species is always compatible with itself even if
 * unclassified (`eggGroups` absent/empty) — that's the safe fallback for
 * the vast majority of the imported dex this sim hasn't hand-curated egg
 * groups for yet, so an unclassified species can still reproduce with its
 * own kind, just not cross-breed with anything else until classified.
 * `"undiscovered"` on either side means never breeds, full stop (legendaries,
 * baby Pokemon in the mainline games).
 */
export function canBreed(speciesA: string, speciesB: string, ctx?: LevelingContext): boolean {
  if (speciesA === speciesB) return true;
  const groupsA = ctx?.getProfile(speciesA)?.eggGroups;
  const groupsB = ctx?.getProfile(speciesB)?.eggGroups;
  if (!groupsA?.length || !groupsB?.length) return false;
  if (groupsA.includes("undiscovered") || groupsB.includes("undiscovered")) return false;
  return groupsA.some((g) => groupsB.includes(g));
}

// --- Tuning constants for non-combat exp sources (sim-original, no canon formula exists for these — see DESIGN.md) ---
// Raised substantially from the original values (0.02/0.5/1/3/2/2), requested
// directly: evolution was engine-tested but never once observed in a real
// run (max level reached in a 10000-tick run: 8, nowhere near Bulbasaur's
// level-16 threshold — see TODO.md). Kills should "give a ton," passive
// eating/drinking "some," and reaching new territory "a bunch" — tuned
// against real runs (see TODO.md's Leveling section) rather than solved
// analytically; re-tune again if a longer run still can't reach evolution.
//
// Raised again (0.15 -> 0.8), paired with gating natal dispersal
// (dispersal.ts) behind DISPERSAL_MIN_LEVEL: a Medium Slow species (e.g.
// Bulbasaur) needs 2035 total exp for level 15, ~13,567 ticks at the old
// trickle rate alone — far longer than any run this project has actually
// exercised. At 0.8/tick, trickle alone reaches it by ~2,545 ticks, with
// consume/mate/birth/kill exp on top of that in practice — comfortably
// inside the run lengths (3,000-8,000 ticks) already used to validate
// dispersal, instead of the level gate making dispersal fire even more
// rarely than before this change.
//
// Slight bump again (0.8 -> 1.0), direct ask, alongside lowering the new
// breeding-level gate (reproduction.ts's MIN_BREEDING_LEVEL_UNEVOLVED,
// 16 -> 12): a real run with the gate at 16 showed births collapsing to
// 1-4 per 3000-tick run even after quartering hunger/thirst decay — the
// actual bottleneck was exp pace, not survival time (see TODO.md). A
// lower threshold needs less exp on its own (973 vs. 2535 for Medium Slow
// level 12 vs. 16); this trickle bump is a modest push on top of that,
// not the primary fix.
export const EXP_TRICKLE_PER_TICK = 1.0;
/**
 * Minimum level before natal dispersal (dispersal.ts) can trigger at all —
 * direct instruction: dispersal should read as something an older/more
 * experienced individual does, not any agent the instant it's biologically
 * mature (`reproduction.ts`'s `MATURITY_AGE`, a mere 200 ticks). Gates both
 * of dispersal.ts's triggers identically, including the guaranteed
 * no-eligible-mates fallback — a young, low-level agent with zero mates
 * nearby still just waits, same as it would have before this feature
 * existed.
 */
export const DISPERSAL_MIN_LEVEL = 15;
export const EXP_ON_CONSUME = 8; // slight bump from 6, same pass as EXP_TRICKLE_PER_TICK's increase above
export const EXP_ON_MATE_ATTEMPT = 4;
export const EXP_ON_BIRTH_PARENT = 15;
export const EXP_ON_NEW_SECTOR = 20;
export const EXP_ON_NEW_SPECIES_ENCOUNTERED = 12;
/**
 * Multiplies the real mainline kill-exp formula (`killExpYield`) — that
 * formula assumes a 6-Pokémon team splitting exp from frequent trainer
 * battles, neither of which applies to a single wild agent in this
 * ecosystem sim getting a rare kill. "A kill should give a ton" — a kill is
 * meant to be a genuinely big, level-moving event here, not a small
 * fraction of one.
 */
export const KILL_EXP_MULTIPLIER = 8;

/** Sector size (tiles per side) for the coarse "visited a new area" bucketing. */
export const SECTOR_SIZE = 5;
export const MAX_TRACKED_SECTORS = 40;
export const MAX_TRACKED_SPECIES = 20;

/** Chance a landed hit grants the attacker one skill point of the move's own type. */
export const SKILLPOINT_ON_HIT_CHANCE = 0.05;
/**
 * Every Nth "real" (typed) skill point granted — level-up or on-hit alike —
 * also grants a bonus wildcard point, deterministically (tracked via
 * `Agent.skillPointGrantCount`), not by a per-grant RNG roll. Replaces an
 * earlier 10%-chance-per-level-up roll: that made wildcard income a coin
 * flip an unlucky agent could go many levels without, starving any tree
 * whose type doesn't match the agent's primary type (typed income only
 * flows in that primary type — see `grantExp`'s level-up loop). A fixed
 * cadence guarantees every agent the same long-run wildcard rate regardless
 * of luck. See DESIGN.md's "Specialization" section.
 */
export const SKILLPOINT_WILDCARD_INTERVAL = 2;

/**
 * Chance an agent banks a skill point rather than spending it, when a
 * reachable node it cannot yet afford exists — see `maybeAutoRespec`. At
 * 0.5 an agent takes roughly two grants to commit to a cost-2 keystone
 * instead of never reaching one, without becoming a hoarder that ignores
 * the cheap nodes it likes.
 */
export const SKILLPOINT_SAVE_CHANCE = 0.5;

/**
 * How strongly the auto-respec prefers a move it has already invested in
 * over one it has barely touched. At 0 an agent spreads evenly across every
 * move it knows (the old behavior); higher values make it specialise.
 *
 * Measured across 8 seeds x 8k ticks, per INVESTING agent:
 *
 * | focus | reached a keystone | reached a capstone |
 * |---|---|---|
 * | 0 | 36% | 1% |
 * | 2 | 32% | 6% |
 *
 * Median nodes chosen per agent is 14 either way — the same points, spent
 * with a build in mind instead of scattered across three or four trees.
 * Higher values were tried and did not help further: at 5 the population
 * thinned enough that the sample stopped being comparable.
 */
export const SKILLPOINT_FOCUS_BONUS = 2;

export function sectorId(x: number, y: number): string {
  return `${Math.floor(x / SECTOR_SIZE)},${Math.floor(y / SECTOR_SIZE)}`;
}

/** Appends `value` to a capped list (oldest dropped first) if not already present. Mutates and returns the list. */
function rememberCapped(list: string[] | undefined, value: string, cap: number): string[] {
  const arr = list ?? [];
  if (arr.includes(value)) return arr;
  arr.push(value);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
  return arr;
}

/** Records a newly-entered map sector; grants a small exp trickle the first time this agent visits it. */
export function markSectorVisited(
  agent: Agent,
  world: World,
  ctx?: LevelingContext,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  const id = sectorId(agent.pos.x, agent.pos.y);
  if (agent.visitedSectors?.includes(id)) return;
  agent.visitedSectors = rememberCapped(agent.visitedSectors, id, MAX_TRACKED_SECTORS);
  grantExp(world, agent, EXP_ON_NEW_SECTOR, ctx, log, rng);
}

/** Records a newly-encountered species (an agent within `radius` of `others`); grants a small exp trickle the first time. */
export function markSpeciesEncountered(
  agent: Agent,
  species: string,
  world: World,
  ctx?: LevelingContext,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  if (species === agent.species || agent.encounteredSpecies?.includes(species)) return;
  agent.encounteredSpecies = rememberCapped(agent.encounteredSpecies, species, MAX_TRACKED_SPECIES);
  grantExp(world, agent, EXP_ON_NEW_SPECIES_ENCOUNTERED, ctx, log, rng);
}

/**
 * Grants one skill point (typed or wildcard) and logs it. When `ctx` is
 * given (it needs `resolveMove` to get at pristine base `MoveSpec`s),
 * immediately follows up with `maybeAutoRespec` — a wild agent doesn't
 * hoard points waiting for a player to spend them, it commits to a build as
 * it goes. Without `ctx` (most direct/test call sites), the point is
 * granted but nothing is auto-spent, same as before this existed.
 *
 * Every real (non-wildcard) grant also counts toward
 * `Agent.skillPointGrantCount`; every `SKILLPOINT_WILDCARD_INTERVAL`th one
 * recursively grants a bonus wildcard point too (itself logged, itself
 * triggering `maybeAutoRespec` again — a fresh wildcard can immediately
 * unlock a node that was one point short a moment ago). The wildcard grant
 * doesn't advance its own counter, so this can't runaway-recurse.
 */
export function grantSkillPoint(
  agent: Agent,
  pointType: PokemonType | "wildcard",
  world: World,
  log?: EventLog,
  ctx?: LevelingContext,
  rng: () => number = Math.random
): void {
  if (pointType === "wildcard") {
    agent.wildcardSkillPoints = (agent.wildcardSkillPoints ?? 0) + 1;
  } else {
    agent.skillPoints = agent.skillPoints ?? {};
    agent.skillPoints[pointType] = (agent.skillPoints[pointType] ?? 0) + 1;
  }
  log?.record({ kind: "gainedSkillPoint", tick: world.tick, agentId: agent.id, species: agent.species, pointType });
  if (ctx) maybeAutoRespec(agent, world, ctx, log, rng);

  if (pointType !== "wildcard") {
    agent.skillPointGrantCount = (agent.skillPointGrantCount ?? 0) + 1;
    if (agent.skillPointGrantCount % SKILLPOINT_WILDCARD_INTERVAL === 0) {
      grantSkillPoint(agent, "wildcard", world, log, ctx, rng);
    }
  }
}

/** Rolls `SKILLPOINT_ON_HIT_CHANCE` for a landed hit of type `moveType` — call from combat/predation on a successful hit. */
export function maybeGrantHitSkillPoint(
  agent: Agent,
  moveType: PokemonType,
  world: World,
  log?: EventLog,
  ctx?: LevelingContext,
  rng: () => number = Math.random
): void {
  if (rng() < SKILLPOINT_ON_HIT_CHANCE) grantSkillPoint(agent, moveType, world, log, ctx, rng);
}

/**
 * Called whenever `grantSkillPoint` fires with a `LevelingContext` in hand:
 * scans every move this agent knows for a respec tree with at least one
 * eligible (prerequisites already chosen, not itself already chosen) node
 * it can currently afford, and — if any exist, possibly across several of
 * the agent's known moves at once — commits to exactly one, spending its
 * cost. Never more than one new commitment per call, even if the point that
 * triggered this happened to newly unlock candidates on multiple trees.
 *
 * The pick is disposition-weighted, not disposition-determined: each
 * candidate's weight is `0.15 + (agent.disposition's value on the node's
 * `leaning` axis, or 0.5 if the node has no leaning or the agent has no
 * disposition)`. A highly aggressive individual is *more likely*, not
 * guaranteed, to grab an aggression-leaning node over one competing for the
 * same point — two agents with identical species/level/points can still
 * diverge, same as mainline nature never fully determining a build. See
 * DESIGN.md's "Specialization" section.
 *
 * A commitment is permanent — this only ever appends to
 * `agent.moveTreeChoices[moveId]`, never removes from it (no respec-back).
 * The move's live `MoveSpec` in `agent.moves` is recomputed from
 * `ctx.resolveMove`'s pristine base plus the *full* chosen list every time
 * (via `applyMoveTree`, not the total-cost-charging `applyMoveTreeWithSpend`
 * — the cost here is paid incrementally, one node at a time, via
 * `trySpendSkillPoints` directly), so deltas never stack on top of deltas
 * from a stale intermediate spec.
 */
export function maybeAutoRespec(
  agent: Agent,
  world: World,
  ctx: LevelingContext,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  interface Candidate {
    moveId: string;
    base: MoveSpec;
    node: MoveTreeNode;
    chosen: string[];
  }
  const candidates: Candidate[] = [];
  let oneGrantAway = false;

  for (const moveId of agent.knownMoves ?? []) {
    const base = ctx.resolveMove(moveId);
    if (!base?.tree) continue;
    const chosen = agent.moveTreeChoices?.[moveId] ?? [];
    const chosenSet = new Set(chosen);
    const typed = agent.skillPoints?.[base.type] ?? 0;
    const wildcard = agent.wildcardSkillPoints ?? 0;
    for (const node of Object.values(base.tree)) {
      if (chosenSet.has(node.id)) continue;
      if (!(node.prerequisites ?? []).every((prereq) => chosenSet.has(prereq))) continue;
      if (node.prerequisitesAnyOf && node.prerequisitesAnyOf.length > 0) {
        const satisfied = node.prerequisitesAnyOf.some((set) => set.every((prereq) => chosenSet.has(prereq)));
        if (!satisfied) continue;
      }
      const excluded = chosen.some(
        (chosenId) => (node.excludes ?? []).includes(chosenId) || (base.tree![chosenId]?.excludes ?? []).includes(node.id)
      );
      if (excluded) continue;
      if (node.cost > typed + wildcard) {
        // Reachable but not yet affordable. Only "one more grant away"
        // counts — see the banking rule below.
        if (node.cost === typed + wildcard + 1) oneGrantAway = true;
        continue;
      }
      candidates.push({ moveId, base, node, chosen });
    }
  }
  if (candidates.length === 0) return;

  // Bank the point instead of spending it, sometimes, when the agent is
  // exactly one grant short of something it has already unlocked.
  //
  // Without this an agent spends every point the instant it arrives, and a
  // cost-1 candidate is nearly always available — so it can never accumulate
  // the 2 or 3 points a keystone or capstone costs. That is not a theory:
  // measured across the living population of a 20k-tick run, cost-1 nodes
  // reached 77 of 456 distinct nodes, cost-2 only 6 of 144, and cost-3
  // exactly 0 of 4. Every capstone in the game was very nearly dead content,
  // and the expensive forks (Inferno, Wildfire Burst) were unreachable
  // outright — which is how a whole shipped fire mechanic managed to produce
  // zero ignitions across 20k ticks.
  //
  // The "exactly one grant away" gate matters more than the probability. The
  // first attempt at this banked whenever ANY unaffordable node existed,
  // which is almost always true — agents then saved indefinitely toward
  // something deeper and picked ~nothing at all. Bounding it to one point of
  // patience lets a build climb 1 -> 2 -> 3 smoothly and self-limits: once
  // the node is affordable it stops being "ahead" and the normal weighted
  // pick resumes. The probability keeps it from becoming a rule, so an agent
  // still commits to cheap nodes it likes.
  if (oneGrantAway && SKILLPOINT_SAVE_CHANCE > 0 && rng() < SKILLPOINT_SAVE_CHANCE) return;

  // How many nodes this agent has already committed to each move, so a
  // build can prefer to go DEEPER rather than start somewhere new.
  const investedPerMove = new Map<string, number>();
  for (const [moveId, chosen] of Object.entries(agent.moveTreeChoices ?? {})) {
    investedPerMove.set(moveId, chosen.length);
  }
  const deepestInvestment = Math.max(1, ...investedPerMove.values());

  const weights = candidates.map((c) => {
    const dispositionWeight = 0.15 + (c.node.leaning ? agent.disposition?.[c.node.leaning] ?? 0.5 : 0.5);
    // Specialisation bias. Without it an agent spreads its points evenly
    // across every move it knows and never finishes a branch: measured at a
    // median of 14 nodes chosen per agent, yet only 2% of investing agents
    // ever reached a terminal capstone, because those 14 were scattered
    // across three or four trees. Weighting toward the move already
    // furthest along turns the same number of points into a real build.
    //
    // A multiplier on the existing disposition weight rather than a
    // replacement, so temperament still decides WHICH branch — this only
    // decides which move to keep pushing.
    const invested = investedPerMove.get(c.moveId) ?? 0;
    const focus = 1 + SKILLPOINT_FOCUS_BONUS * (invested / deepestInvestment);
    return dispositionWeight * focus;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  let picked = candidates[candidates.length - 1];
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      picked = candidates[i];
      break;
    }
  }

  if (!trySpendSkillPoints(agent, picked.base.type, picked.node.cost)) return; // already filtered as affordable above; guards against a caller bug rather than a real race

  if (picked.node.grantsPassive) grantPassive(agent, picked.node.grantsPassive.kind, picked.node.grantsPassive.value);
  for (const passive of picked.node.grantsPassives ?? []) grantPassive(agent, passive.kind, passive.value);

  const nextChosen = [...picked.chosen, picked.node.id];
  agent.moveTreeChoices = agent.moveTreeChoices ?? {};
  agent.moveTreeChoices[picked.moveId] = nextChosen;

  const respecced = applyMoveTree(picked.base, nextChosen);
  agent.moves = agent.moves ?? [];
  // Keyed by `respecced.id` (the `MoveSpec`'s own id, e.g. "ember"), not
  // `picked.moveId` (the `knownMoves` entry that resolved to this base spec,
  // e.g. the dex key "EMBER") — those two are frequently different casings/
  // names for the same move (see `LevelingContext.resolveMove`), and
  // `agent.moves` is always keyed by the former.
  const idx = agent.moves.findIndex((m) => m.id === respecced.id);
  if (idx >= 0) agent.moves[idx] = respecced;
  else agent.moves.push(respecced);

  log?.record({
    kind: "moveRespecced",
    tick: world.tick,
    agentId: agent.id,
    species: agent.species,
    moveId: picked.moveId,
    nodeId: picked.node.id,
  });
}

/**
 * Fills in a combat profile (`stats`/`hp`/`maxHp`/`types`/`moves`/
 * `knownMoves`) for an agent that doesn't have one yet — currently just
 * newborns (`spawnOffspring` in reproduction.ts), which used to enter the
 * world with no stats or moves at all, unable to fight or be targeted by
 * `pickBestMove` despite being full `Agent` records. Uses the *current*
 * `agent.level` (1 for a newborn) and `agent.species`, same dex-backed math
 * `grantExp`'s level-up loop already uses, so a level-5 agent constructed
 * this way ends up identical to one that leveled there naturally. No-op if
 * `ctx` or a profile for the species is unavailable, or if the agent
 * already has stats (never overwrites an existing combat profile).
 */
export function ensureCombatProfile(agent: Agent, ctx?: LevelingContext): void {
  if (agent.stats) return;
  if (!ctx) return;
  const profile = ctx.getProfile(agent.species);
  if (!profile) return;

  const level = agent.level ?? 1;
  const stats = calculateStats(profile.baseStats, level);
  agent.stats = stats;
  agent.maxHp = stats.maxHp;
  agent.hp = stats.maxHp;
  agent.types = profile.types;
  agent.buildsShelter = agent.buildsShelter ?? profile.buildsShelter;
  agent.preferredTerrain = agent.preferredTerrain ?? profile.preferredTerrain;
  agent.obligateAquatic = agent.obligateAquatic ?? profile.obligateAquatic;

  agent.knownMoves = agent.knownMoves ?? [];
  agent.moves = agent.moves ?? [];
  for (const [unlockLevel, moveKey] of profile.levelMoves) {
    if (unlockLevel > level) continue;
    if (agent.knownMoves.includes(moveKey)) continue;
    agent.knownMoves.push(moveKey);
    const spec = ctx.resolveMove(moveKey);
    if (spec && !agent.moves.some((m) => m.id === spec.id)) agent.moves.push(spec);
  }
  // A backfilled profile can hand a high-level agent its whole level-move
  // list at once, so this path needs the cap too — otherwise an immigrant or
  // a newborn constructed at level 30 would enter the world holding ten
  // moves while everything that levelled there naturally holds four.
  // No investment exists yet on a fresh profile, so `pickMoveToForget` here
  // is deciding purely on combat value and type coverage, which is what it
  // should be doing when there is no build to protect.
  while ((agent.knownMoves?.length ?? 0) > MAX_KNOWN_MOVES) {
    const drop = pickMoveToForget(agent, agent.knownMoves!, ctx);
    if (!drop) break;
    forgetMove(agent, drop, undefined, ctx);
  }
}

/**
 * Grants `amount` exp to `agent`, then loops applying every level gained in
 * one go (a single big kill against a much-higher-level target can cross
 * several thresholds at once — not capped at +1). Each level crossed:
 * recomputes stats via `calculateStats` (using the *current* species' base
 * stats — this can change mid-loop if an evolution fires), heals current HP
 * by the same delta as the max-HP gain (mainline-accurate: it heals by the
 * gain, it doesn't reset to full or leave HP unchanged), learns every
 * `levelMoves` entry now unlocked, grants one guaranteed skill point of the
 * agent's own primary type plus a rare wildcard chance, then checks for a
 * level-gated evolution and applies it if the new level qualifies.
 *
 * One `leveledUp` event is emitted per level gained (not one summary event
 * for a multi-level jump) — a 5-level jump from one kill reads as five
 * distinct entries in the log, which matches this project's "the event log
 * needs semantic content" north star better than a single "+5 levels" blob.
 *
 * Without `ctx` (or without a profile for this agent's current species), exp
 * still accrues but nothing can level, evolve, or learn a move — this is the
 * same "optional injected policy" pattern as `HuntRules`, so callers that
 * don't have dex data on hand (bare engine tests) keep working unchanged.
 */
/**
 * Permanent XP multiplier while an agent holds any Notables title — the
 * "give it xp boosts" half of the direct ask (see notables.ts's top-of-file
 * doc comment). Applied here, the single funnel every real exp grant in the
 * engine already passes through (kill exp, sector/new-species exp trickle,
 * successful egg-laying), rather than duplicating the check at every grant
 * site. 1.5x — a real, felt reward (noticeably faster leveling over a run)
 * without being absurd (a title-holder still can't out-level a genuinely
 * higher-level rival through this bonus alone; it accelerates, it doesn't
 * replace, real combat/exploration exp).
 */
export const NOTABLE_XP_MULTIPLIER = 1.5;

export function grantExp(
  world: World,
  agent: Agent,
  amount: number,
  ctx?: LevelingContext,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  if (agent.alive === false || amount <= 0) return;
  const effectiveAmount = agent.notableTitle !== undefined ? amount * NOTABLE_XP_MULTIPLIER : amount;
  agent.exp = (agent.exp ?? 0) + effectiveAmount;
  agent.level = agent.level ?? 1;

  if (!ctx) return;

  for (;;) {
    const profile = ctx.getProfile(agent.species);
    if (!profile) return;
    if (agent.level >= MAX_LEVEL) return;
    if (totalExpForLevel(profile.growthRate, agent.level + 1) > agent.exp) return;

    const fromLevel = agent.level;
    agent.level += 1;

    // See Agent.pendingLevelDispersalCheck's doc comment — a flag, not an
    // exact equality check, since this loop can jump several levels in one
    // grantExp call and skip right past DISPERSAL_MIN_LEVEL otherwise.
    if (fromLevel < DISPERSAL_MIN_LEVEL && agent.level >= DISPERSAL_MIN_LEVEL) {
      agent.pendingLevelDispersalCheck = true;
    }

    const newStats = calculateStats(profile.baseStats, agent.level);
    const oldMaxHp = agent.stats?.maxHp ?? agent.maxHp ?? newStats.maxHp;
    const hpDelta = Math.max(0, newStats.maxHp - oldMaxHp);
    agent.stats = newStats;
    agent.maxHp = newStats.maxHp;
    agent.hp = Math.min(agent.maxHp, (agent.hp ?? oldMaxHp) + hpDelta);

    log?.record({
      kind: "leveledUp",
      tick: world.tick,
      agentId: agent.id,
      species: agent.species,
      fromLevel,
      toLevel: agent.level,
      exp: agent.exp,
    });

    agent.knownMoves = agent.knownMoves ?? [];
    for (const [unlockLevel, moveKey] of profile.levelMoves) {
      if (unlockLevel > agent.level) continue;
      if (agent.knownMoves.includes(moveKey)) continue;
      agent.knownMoves.push(moveKey);
      const spec = ctx.resolveMove(moveKey);
      if (spec) {
        agent.moves = agent.moves ?? [];
        if (!agent.moves.some((m) => m.id === spec.id)) agent.moves.push(spec);
      }
      log?.record({ kind: "learnedMove", tick: world.tick, agentId: agent.id, species: agent.species, moveId: moveKey, level: agent.level });
      // One move at a time, inside the loop: a level-up can cross several
      // thresholds at once and teach two or three moves in one go, and
      // deferring the cap to the end would let the agent briefly hold six
      // and then decide between them with the tree investment of the ones it
      // never really had. Each new move faces the cap as it arrives.
      enforceMoveCap(agent, moveKey, world, ctx, log);
    }

    const primaryType = agent.types?.[0];
    // The bonus wildcard (every SKILLPOINT_WILDCARD_INTERVAL-th real point,
    // level-up or on-hit alike) is handled inside grantSkillPoint itself.
    if (primaryType) grantSkillPoint(agent, primaryType, world, log, ctx, rng);

    const levelAfterUp = agent.level;
    const evo = profile.evolutions.find((e) => levelAfterUp >= e.level);
    if (evo) {
      const fromSpecies = agent.species;
      agent.species = evo.targetSpeciesId;
      const newProfile = ctx.getProfile(agent.species);
      if (newProfile) {
        const hpFraction = agent.maxHp && agent.maxHp > 0 ? (agent.hp ?? agent.maxHp) / agent.maxHp : 1;
        const evoStats = calculateStats(newProfile.baseStats, agent.level);
        agent.stats = evoStats;
        agent.maxHp = evoStats.maxHp;
        agent.hp = Math.max(1, Math.round(evoStats.maxHp * hpFraction));
      }
      log?.record({ kind: "evolved", tick: world.tick, agentId: agent.id, fromSpecies, toSpecies: agent.species, level: agent.level, herdId: agent.herdId });
      // Consumed by dispersal.ts's maybeTriggerDispersal on this agent's very
      // next check — one of natal dispersal's two triggers (DESIGN.md's
      // "Natal dispersal" section) is "a disposition-weighted chance to
      // disperse ... on evolving." A transient flag rather than rolling the
      // chance right here: dispersal.ts owns that roll/relocation logic
      // entirely, this is just the hook telling it "an evolution just
      // happened, check now."
      agent.pendingEvolutionDispersalCheck = true;
    }
  }
}

/** floor(baseExp * defeatedLevel / 7) — the real mainline wild-battle exp-yield formula. */
export function killExpYield(baseExp: number, defeatedLevel: number): number {
  return Math.floor((baseExp * defeatedLevel) / 7);
}

/** Grants a kill's exp to the attacker, using the defender's dex `baseExp` and level (via `ctx`). No-op if `ctx` or the defender's profile is unavailable. */
export function grantKillExp(
  world: World,
  attacker: Agent,
  defender: Agent,
  ctx?: LevelingContext,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  if (!ctx) return;
  const profile = ctx.getProfile(defender.species);
  if (!profile) return;
  const amount = killExpYield(profile.baseExp, defender.level ?? 1) * KILL_EXP_MULTIPLIER;
  grantExp(world, attacker, amount, ctx, log, rng);
}

// --- The four-move cap, forgetting, and the refund (see DESIGN.md) ---

/**
 * Why a move was unlearned. "declined" is the new move being turned down as
 * not worth a slot; the rest describe what was given up and why — see
 * `forgetReasonFor`.
 */
export type ForgetReason = "capacity" | "declined" | "outclassed" | "redundant" | "unbuilt";

/**
 * How many moves an agent may know at once.
 *
 * Applies to `knownMoves` — everything, status moves included. Direct: "we
 * technically don't cap moves to 4 moves per unit. I think we should add a
 * cap. Force forgetting," and then "the 4 moved cap applies to all." Capping
 * only the combat-usable subset was the other option and was rejected: a
 * species with three status moves would effectively get seven slots and the
 * cap would stop being legible.
 *
 * This is a large change, not a trim. Measured before it existed
 * (`measureMovepool.ts`, 8 seeds x 10k ticks, 158 living agents): agents knew
 * a MEDIAN of 13 moves, mean 11.8, max 21, and 94.9% knew more than four. So
 * a typical adult now makes roughly nine forget decisions over its life,
 * which is what makes `pickMoveToForget` below load-bearing rather than a
 * detail.
 */
export const MAX_KNOWN_MOVES = 4;

/**
 * Every skill point an agent has sunk into `moveId`'s tree.
 *
 * Reads the node costs out of the tree itself rather than assuming 1 apiece:
 * template v4 made every node cost 1, but older trees still carry cost-2
 * notables, and a refund that silently short-changed those would be a quiet
 * tax on exactly the builds that invested most.
 */
function pointsSpentOn(agent: Agent, moveId: string, ctx: LevelingContext): number {
  const base = ctx.resolveMove(moveId);
  const chosen = agent.moveTreeChoices?.[moveId] ?? [];
  if (!base?.tree) return chosen.length; // no tree to price it from — one point each is the honest fallback
  return chosen.reduce((sum, nodeId) => sum + (base.tree![nodeId]?.cost ?? 1), 0);
}

/**
 * Unlearns `moveId`: drops it from `knownMoves`/`moves`, takes back every
 * passive its chosen nodes granted, and refunds the points as WILDCARD.
 *
 * Refund shape is a direct call — "A + C": the full amount ever spent, with
 * nothing withheld, but returned as wildcard rather than typed points. Full
 * value means forgetting is never a punishment for having specialised;
 * wildcard means it does not simply re-buy the same tree, since a typed
 * refund would fund the branch it just came from and forgetting would be a
 * free respec button.
 *
 * Returns the number of points refunded, or undefined if the agent did not
 * know the move.
 */
export function forgetMove(
  agent: Agent,
  moveId: string,
  /** Only ever read for the log tick — `ensureCombatProfile` backfills a profile with no world in scope and still has to be able to trim. */
  world: World | undefined,
  ctx: LevelingContext,
  log?: EventLog,
  reason: ForgetReason = "capacity"
): number | undefined {
  const known = agent.knownMoves ?? [];
  const idx = known.indexOf(moveId);
  if (idx < 0) return undefined;

  const refund = pointsSpentOn(agent, moveId, ctx);
  const base = ctx.resolveMove(moveId);

  // Passives come back off BEFORE the choices are dropped — the tree is the
  // only record of what was granted.
  for (const nodeId of agent.moveTreeChoices?.[moveId] ?? []) {
    const node = base?.tree?.[nodeId];
    if (!node) continue;
    if (node.grantsPassive) revokePassive(agent, node.grantsPassive.kind, node.grantsPassive.value);
    for (const passive of node.grantsPassives ?? []) revokePassive(agent, passive.kind, passive.value);
  }

  known.splice(idx, 1);
  agent.knownMoves = known;
  if (agent.moveTreeChoices) {
    delete agent.moveTreeChoices[moveId];
    if (Object.keys(agent.moveTreeChoices).length === 0) agent.moveTreeChoices = undefined;
  }
  if (base && agent.moves) {
    agent.moves = agent.moves.filter((m) => m.id !== base.id);
    if (agent.moveCooldowns) delete agent.moveCooldowns[base.id];
    if (agent.moveLastUsedTick) delete agent.moveLastUsedTick[base.id];
  }
  agent.wildcardSkillPoints = (agent.wildcardSkillPoints ?? 0) + refund;

  log?.record({
    kind: "forgotMove",
    tick: world?.tick ?? 0,
    agentId: agent.id,
    species: agent.species,
    moveId,
    refundedPoints: refund,
    reason,
  });
  return refund;
}

/**
 * How much a chosen tree node counts toward "don't throw this build away."
 *
 * Was 8, which made investment an effective VETO — nothing invested was ever
 * dropped, and the refund became dead content: 0 points returned across 6744
 * forgets in a live run. Direct correction: "It's okay to drop an invested
 * move but there should be reasoning behind it."
 *
 * 2 is the honest weight once you follow the refund through. Forgetting
 * returns EVERY point spent, as wildcard, and `maybeAutoRespec` immediately
 * starts spending them again — so dropping a built move does not destroy the
 * points, it converts them. What is actually lost is narrower than it looks:
 * the specific shape of the build, the passives that tree granted (revoked
 * by `forgetMove`), and the time to climb a new tree. Real costs, but not
 * the whole thirty points, which is what a weight of 8 was implicitly
 * charging.
 *
 * So this is a friction term, not a lock: a clearly better move wins the
 * slot and the agent respecs into it, and a marginally better one does not.
 */
const FORGET_INVESTMENT_WEIGHT = 2;

/** Bonus for a move whose type the agent doesn't otherwise have, so a movepool doesn't collapse to four of the same type. */
const FORGET_COVERAGE_BONUS = 25;

/** How much of a utility move's worth its effects are assumed to carry, given it has no `power` to score. */
const FORGET_UTILITY_BASE_VALUE = 30;

/**
 * What a move is worth for having a designed skill tree at all — its
 * POTENTIAL, as against the current value of every other term.
 *
 * Not a nicety: without this term the cap deletes the game's whole
 * specialisation system, and only a live run showed it. A level-42 Charizard
 * spawn came out knowing Dragon Claw, Metal Claw, Fire Fang and Flame Burst
 * — four generic dex-derived specs with no tree — having dropped Slash, the
 * curated move with a full 45-node tree, because Slash scored marginally
 * lower on raw damage per action. Every curated move in the roster was being
 * displaced by undesigned filler with slightly better numbers.
 *
 * Deliberately BINARY — "does this move have a designed tree at all" — and
 * not scaled by node count. Scaling was the first attempt and it was wrong:
 * it made tree SIZE decide which moves survive, and size is currently an
 * artifact of how far the v4 conversion has got rather than anything about
 * the move. A level-50 Charizard started dropping Slash (36 nodes) for
 * Scratch (45) the moment Scratch was converted, purely on the node count,
 * even though Slash wins on damage per action and the two are the same type.
 * Converting the remaining trees would have kept reshuffling every movepool
 * in the game for no design reason.
 *
 * The bug this term exists for was never 36-vs-45; it was curated-move
 * versus undesigned dex filler. Binary answers that and nothing else, and
 * once every tree is 45 nodes a scaled version would collapse to this
 * anyway.
 */
const FORGET_HAS_TREE_BONUS = 120;

/**
 * Why a move was given up, worked out from the same scores that chose it —
 * so the chronicle can say what happened rather than just that it happened.
 *
 * "Just dying out is sad and vague" applies to builds too: an agent that
 * dropped a thirty-point Solar Beam because a Fire Blast outclassed it is a
 * different story from one that dropped an untouched Growl for space, and
 * the log should be able to tell them apart.
 */
function forgetReasonFor(
  agent: Agent,
  dropped: string,
  kept: string[],
  ctx: LevelingContext,
  ownTypes: PokemonType[]
): "outclassed" | "redundant" | "unbuilt" | "capacity" {
  const spec = ctx.resolveMove(dropped);
  const investedPoints = pointsSpentOn(agent, dropped, ctx);

  // Same type as something it kept, and it lost — the movepool was doubling
  // up, which is the cheapest kind of slot to free.
  if (spec && kept.some((id) => ctx.resolveMove(id)?.type === spec.type)) return "redundant";

  // A real build was given up. That is the case worth naming: it only
  // happens when something genuinely outscored it, and the points come back
  // to be spent on whatever did.
  if (investedPoints > 0) return "outclassed";

  // Known but never invested in at all.
  if (spec) return "unbuilt";
  return "capacity";
}

/**
 * What this move is worth to this agent, right now. Higher = keep.
 *
 * Deliberately not just "damage": failure mode (b) is an agent keeping a bad
 * move and refusing a better one, and a pure-damage score causes exactly
 * that, since it rates every status move at zero and would forget Synthesis
 * for a marginally stronger Tackle every time.
 *
 * The terms, and the failure each answers:
 *   investment  — (a), don't discard a built tree
 *   potential   — don't discard a tree it has not built YET; without this,
 *                 every curated move loses its slot to undesigned dex filler
 *                 with slightly better raw numbers
 *   power/tempo — (b), a genuinely stronger move should win a slot
 *   coverage    — four moves of one type is a worse movepool than three
 *                 types plus a filler, however the raw numbers read
 *   STAB        — the sim's own damage math already rewards it
 */
function moveKeepScore(agent: Agent, moveId: string, ctx: LevelingContext, ownTypes: PokemonType[]): number {
  const spec = ctx.resolveMove(moveId);
  if (!spec) {
    // Learned but not representable in combat. Its tree investment is still
    // real, so it is not free to drop, but it has no combat value to add.
    return FORGET_INVESTMENT_WEIGHT * pointsSpentOn(agent, moveId, ctx);
  }

  const invested = FORGET_INVESTMENT_WEIGHT * pointsSpentOn(agent, moveId, ctx);

  // Damage per action, not damage per use — a move usable every action is
  // worth more than a stronger one usable every fourth. Same denominator the
  // tempo cap uses (cooldowns tick on the agent's own action clock), so this
  // does not repeat the units mistake called out in CLAUDE.md.
  const avgHits = spec.hits ? (spec.hits.min + spec.hits.max) / 2 : 1;
  const perAction = spec.utilityMove
    ? FORGET_UTILITY_BASE_VALUE
    : (spec.power * avgHits) / (spec.cooldownTicks + 1);

  const stab = ownTypes.includes(spec.type) ? 1.5 : 1;

  const otherTypes = new Set(
    (agent.knownMoves ?? [])
      .filter((id) => id !== moveId)
      .map((id) => ctx.resolveMove(id)?.type)
      .filter((t): t is PokemonType => t !== undefined)
  );
  const coverage = otherTypes.has(spec.type) ? 0 : FORGET_COVERAGE_BONUS;
  const potential = Object.keys(spec.tree ?? {}).length > 0 ? FORGET_HAS_TREE_BONUS : 0;

  return invested + perAction * stab + coverage + potential;
}

/**
 * Which of `candidates` to give up — the lowest-scoring one.
 *
 * `candidates` deliberately INCLUDES the move being learned. An agent that
 * would be worse off learning something should decline it, which is both
 * mainline-accurate and the other half of failure mode (b): a cap that can
 * only ever displace an existing move forces every new move in regardless of
 * whether it is an upgrade.
 */
export function pickMoveToForget(agent: Agent, candidates: string[], ctx: LevelingContext): string | undefined {
  const ownTypes = agent.types ?? [];
  let worst: string | undefined;
  let worstScore = Infinity;
  for (const moveId of candidates) {
    const score = moveKeepScore(agent, moveId, ctx, ownTypes);
    if (score < worstScore) {
      worstScore = score;
      worst = moveId;
    }
  }
  return worst;
}

/**
 * Enforces `MAX_KNOWN_MOVES` after `newMoveId` has just been learned.
 *
 * Player-owned agents are NOT auto-resolved. Direct call on who decides:
 * the sim decides for wild Pokemon, the player decides for theirs. There is
 * no player-owned agent in the sim yet, so this is the seam rather than the
 * feature — a player-owned agent over the cap parks the decision on
 * `pendingMoveChoice` and is left alone until something resolves it, and
 * every wild agent goes through `pickMoveToForget` as before. Building the
 * seam now keeps the cap from having to be retrofitted around a UI later.
 */
export function enforceMoveCap(
  agent: Agent,
  newMoveId: string,
  world: World,
  ctx: LevelingContext,
  log?: EventLog
): void {
  const known = agent.knownMoves ?? [];
  if (known.length <= MAX_KNOWN_MOVES) return;

  if (agent.playerOwned) {
    agent.pendingMoveChoice = { newMoveId, atTick: world.tick };
    return;
  }

  const drop = pickMoveToForget(agent, known, ctx);
  if (!drop) return;
  const reason =
    drop === newMoveId
      ? "declined"
      : forgetReasonFor(agent, drop, known.filter((id) => id !== drop), ctx, agent.types ?? []);
  forgetMove(agent, drop, world, ctx, log, reason);
}
