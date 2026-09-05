import type { Agent, TerrainKind, World } from "./types.js";
import type { PokemonType } from "./typing.js";
import type { MoveSpec, MoveTreeNode } from "./moves.js";
import { applyMoveTree, trySpendSkillPoints } from "./moves.js";
import type { BaseStats } from "./stats.js";
import { calculateStats } from "./stats.js";
import type { EventLog } from "./events.js";
import { grantPassive } from "./status.js";

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
      if (node.cost > typed + wildcard) continue;
      candidates.push({ moveId, base, node, chosen });
    }
  }
  if (candidates.length === 0) return;

  const weights = candidates.map((c) => 0.15 + (c.node.leaning ? agent.disposition?.[c.node.leaning] ?? 0.5 : 0.5));
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
      log?.record({ kind: "evolved", tick: world.tick, agentId: agent.id, fromSpecies, toSpecies: agent.species, level: agent.level });
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
