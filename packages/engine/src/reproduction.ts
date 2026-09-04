import type { Agent, Layer, Needs, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { stepTowardMovingTarget } from "./pathfinding.js";
import { tileAt } from "./world.js";
import { EXP_ON_BIRTH_PARENT, EXP_ON_MATE_ATTEMPT, canBreed, ensureCombatProfile, grantExp, type LevelingContext } from "./leveling.js";
import { dispositionFromNature, dispositionSummary, randomNature } from "./nature.js";
import { herdRank, herdSize } from "./herding.js";

/**
 * Ticks before an agent can mate. A single global constant for now — real
 * per-species maturity rates (a Venusaur maturing slower than a Pidgey) are
 * a data-layer refinement for later, not an engine change.
 */
export const MATURITY_AGE = 200;
/** Baseline mate-search radius at neutral (0.5) sociability — see `mateSearchRadius`. */
const MATE_SEARCH_RADIUS = 5;
/** How far sociability can push the search radius from baseline in either direction. */
const MATE_SEARCH_SPREAD = 2;

/**
 * More sociable agents search farther/more readily for a mate; less sociable
 * ones are choosier about proximity. Deliberately the *only* sociability
 * hook for now — full herd cohesion is still unbuilt, see DESIGN.md. Absent
 * disposition (hand-built fixtures) reads as neutral (0.5), reproducing the
 * original fixed 5-tile radius exactly.
 */
function mateSearchRadius(agent: Agent): number {
  const sociability = agent.disposition?.sociability ?? 0.5;
  return MATE_SEARCH_RADIUS + (sociability - 0.5) * (2 * MATE_SEARCH_SPREAD);
}

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isMature(agent: Agent): boolean {
  return agent.age === undefined || agent.age >= MATURITY_AGE;
}

/**
 * Inbreeding avoidance: blocks direct parent/offspring, full or half
 * siblings (share at least one parent), and grandparent/grandchild pairs.
 * Founders (spawned directly into a scenario, no `parentIds`) are never
 * "related" to anything by this check — real gap, since two founders of
 * the same species are conceptually unrelated strangers, which is exactly
 * right. Confirmed real bug this fixes: a founding Venusaur guardian with
 * no predator fathered most of a herd's growth over a real run, including
 * with his own daughters and granddaughters.
 */
function isRelated(agent: Agent, candidate: Agent): boolean {
  const agentParents: string[] = agent.parentIds ?? [];
  const candidateParents: string[] = candidate.parentIds ?? [];
  if (agentParents.includes(candidate.id) || candidateParents.includes(agent.id)) return true;
  if (agentParents.length > 0 && candidateParents.some((id) => agentParents.includes(id))) return true;
  if ((agent.grandparentIds ?? []).includes(candidate.id)) return true;
  if ((candidate.grandparentIds ?? []).includes(agent.id)) return true;
  return false;
}

function isEligibleMate(agent: Agent, candidate: Agent, ctx?: LevelingContext): boolean {
  if (candidate.id === agent.id || candidate.alive === false) return false;
  if (candidate.fainted || candidate.beingCarriedBy) return false; // downed or being carried — not available to mate
  // Real mainline rule: species mate if they share an egg group, not only
  // with their own exact species — e.g. Bulbasaur and Charmander (both
  // "monster") are a real cross-species breeding pair. See canBreed.
  if (!canBreed(agent.species, candidate.species, ctx) || candidate.layer !== agent.layer) return false;
  if (!agent.sex || !candidate.sex || agent.sex === candidate.sex) return false;
  if (!isMature(candidate)) return false;
  if (candidate.behavior === "flee") return false; // don't interrupt a fleeing mate
  if (isRelated(agent, candidate)) return false;
  // Herd animals pair within their herd; solitary agents (no herdId) aren't restricted.
  if (agent.herdId && agent.herdId !== candidate.herdId) return false;
  return true;
}

/**
 * Rank-aware mate preference — DESIGN.md's "Herd status" payoff 2. A
 * higher-status candidate (lower `herdRank`, i.e. higher level relative to
 * its herd-mates) is worth walking a little farther for, but distance still
 * dominates a real gap: this awards a top-ranked candidate a "discount" of
 * at most `STATUS_DISTANCE_BONUS` tiles off its effective distance, scaled
 * down toward 0 for a lower-ranked one. That bonus can only ever tip a close
 * call (candidates within ~`STATUS_DISTANCE_BONUS` tiles of each other) —
 * it's small next to `mateSearchRadius`'s ~3-7 tile range, so a candidate
 * that's merely nearer by more than the bonus always still wins, matching
 * the direct instruction ("distance still matters, status tips close calls,
 * it doesn't override a huge distance gap").
 */
const STATUS_DISTANCE_BONUS = 2;

/**
 * 0 (lowest-ranked herd-mate) .. 1 (highest-ranked, rank 1) — how much of
 * `STATUS_DISTANCE_BONUS` a candidate earns. A solitary candidate (herd size
 * 1, e.g. no herdId) is trivially top-ranked but there's no one to outrank,
 * so it still resolves to 1 rather than being penalized for having no herd —
 * harmless either way since `nearestMate` only compares candidates that are
 * already otherwise eligible.
 */
function statusAdvantage(world: World, candidate: Agent): number {
  const size = candidate.herdId ? herdSize(world, candidate.herdId) : 1;
  if (size <= 1) return 1;
  const rank = herdRank(world, candidate);
  return (size - rank) / (size - 1);
}

/**
 * Effective distance used to rank candidates: real Manhattan distance minus
 * a status-scaled discount (see `statusAdvantage`/`STATUS_DISTANCE_BONUS`
 * above). Lower is more attractive, same sense as the old pure-distance
 * comparison this replaces.
 */
function mateScore(world: World, candidate: Agent, distance: number): number {
  return distance - statusAdvantage(world, candidate) * STATUS_DISTANCE_BONUS;
}

function nearestMate(world: World, agent: Agent, candidates: Agent[]): Agent | undefined {
  let best: Agent | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const dist = manhattan(agent.pos, candidate.pos);
    const score = mateScore(world, candidate, dist);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function freshNeeds(): Needs {
  return { hunger: 1, thirst: 1, energy: 1, mateDrive: 0 };
}

const SPAWN_OFFSETS: Vec2[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

/**
 * A tile next to the mother, not literally on top of her. Without this,
 * a herd whose cohesion has already pulled it into a tight cluster spawns
 * every new generation on the exact same tile as the last, and the whole
 * population collapses into a single stacked point within a few hundred
 * ticks (confirmed in a real run: 168 of 264 agents on one tile by tick
 * 2000). Falls back to the mother's own tile only if she's fully boxed in.
 */
function nearbySpawnTile(world: World, layer: Layer, origin: Vec2, rng: () => number): Vec2 {
  const shuffled = [...SPAWN_OFFSETS].sort(() => rng() - 0.5);
  for (const offset of shuffled) {
    const candidate = { x: origin.x + offset.x, y: origin.y + offset.y };
    if (tileAt(world, layer, candidate.x, candidate.y)?.walkable) return candidate;
  }
  return origin;
}

function spawnOffspring(world: World, mother: Agent, father: Agent, ctx?: LevelingContext, rng: () => number = Math.random): Agent {
  // Was a module-level `let offspringSequence = 0` — a hidden global that
  // leaked across separate `World` instances ticked in the same process
  // (tests do this constantly, and so does any determinism check that runs
  // the same seed twice in one process — confirmed a real bug this way: two
  // fresh worlds seeded identically produced byte-different event logs
  // purely because the second world's first newborn inherited whatever
  // count the first world's run had already reached). Tracked on `World`
  // instead — see `World.offspringSequence` — so it resets per world like
  // every other piece of `World` state, matching this feature's own "no
  // hidden global, thread everything through/on the World" requirement even
  // though this particular piece of state isn't rng-derived at all.
  world.offspringSequence = (world.offspringSequence ?? 0) + 1;
  const offspringSequence = world.offspringSequence;
  // Breeding always produces the base (pre-evolution) form, mainline-accurate:
  // a bred Venusaur's offspring hatches as a Bulbasaur, never another
  // Venusaur — Bulbasaur is the "child version," Venusaur just what an adult
  // grows into, not a separately-bred species. See LevelingContext.baseSpeciesOf.
  const species = ctx?.baseSpeciesOf?.(mother.species) ?? mother.species;
  // Own random nature (and thus its own disposition), same as any spawned
  // agent — never inherited from either parent, matching spawnAgent.
  const nature = randomNature(rng);
  const disposition = dispositionFromNature(nature, rng);
  const child: Agent = {
    id: `${species}-${world.tick}-${offspringSequence}`,
    species,
    pos: nearbySpawnTile(world, mother.layer, mother.pos, rng),
    layer: mother.layer,
    homeLayer: mother.homeLayer,
    // Cheapest available "home range" stand-in for carryAlly's rescue destination
    // (support.ts) — there's no richer herd-home-range concept in the engine yet.
    // A newborn's home is simply where it was born, same as the mother's own
    // homePos when she has one.
    homePos: mother.homePos ?? { ...mother.pos },
    needs: freshNeeds(),
    behavior: "idle",
    herdId: mother.herdId,
    // 50/50 for now — real per-species gender ratios are a data-layer concern, see TODO.
    sex: rng() < 0.5 ? "male" : "female",
    age: 0,
    level: 1,
    exp: 0,
    parentIds: [mother.id, father.id],
    // Computed from the parents' own parentIds, not looked up live — an
    // ancestor is easily long pruned from World.agents by the time this
    // child matures. Empty for a first-generation child (founders have no
    // parentIds of their own to combine).
    grandparentIds: [...new Set([...(mother.parentIds ?? []), ...(father.parentIds ?? [])])],
    nature,
    disposition,
  };
  // Backfills stats/hp/types/moves for the base species at level 1 — without
  // this a newborn had no combat profile at all (couldn't fight, and its
  // guaranteed per-level-up skill point silently never fired, since
  // `grantExp` reads `agent.types?.[0]`). No-op without `ctx` (bare tests).
  ensureCombatProfile(child, ctx);
  return child;
}

/**
 * Called when chooseBehavior has already picked "seekMate". Finds the
 * nearest eligible mate (same species/layer/herd, opposite sex, mature) and
 * either closes distance or, once adjacent, produces an offspring — the
 * mother's turn triggers the birth so a pair doesn't double-spawn the same
 * tick. Both parents' mateDrive resets afterward, which is the sim's only
 * "cooldown": rebuilding it naturally takes a while (see needs.ts).
 */
export function applyMateSeeking(
  world: World,
  agent: Agent,
  log?: EventLog,
  ctx?: LevelingContext,
  rng: () => number = Math.random
): void {
  if (!agent.sex || !isMature(agent)) return;

  const candidates = world.agents.filter(
    (other) => isEligibleMate(agent, other, ctx) && manhattan(agent.pos, other.pos) <= mateSearchRadius(agent)
  );
  // Feeds dispersal.ts's guaranteed "sustained zero eligible mates" fallback
  // trigger — piggybacks on this scan (already paid for every time this
  // function runs) rather than dispersal.ts paying for a second one of its
  // own. Reset to 0 the moment even one candidate is visible, regardless of
  // whether a partner ends up close enough to actually breed with this tick.
  agent.ticksSinceEligibleMate = candidates.length > 0 ? 0 : (agent.ticksSinceEligibleMate ?? 0) + 1;
  const partner = nearestMate(world, agent, candidates);
  if (!partner) return;

  if (manhattan(agent.pos, partner.pos) <= 1) {
    if (agent.sex === "female") {
      const child = spawnOffspring(world, agent, partner, ctx, rng);
      world.agents.push(child);
      log?.record({
        kind: "born",
        tick: world.tick,
        motherId: agent.id,
        fatherId: partner.id,
        childId: child.id,
        species: child.species,
        layer: child.layer,
        pos: child.pos,
        // Narrative color per DESIGN.md — e.g. "born-14 (Timid, low boldness)".
        // Always present since spawnOffspring above always assigns both.
        nature: child.nature!,
        dispositionSummary: dispositionSummary(child.disposition!),
      });
      grantExp(world, agent, EXP_ON_BIRTH_PARENT, ctx, log, rng);
      grantExp(world, partner, EXP_ON_BIRTH_PARENT, ctx, log, rng);
    }
    agent.needs.mateDrive = 0;
    partner.needs.mateDrive = 0;
  } else {
    grantExp(world, agent, EXP_ON_MATE_ATTEMPT, ctx, log, rng);
    // A mate-seeking partner moves every tick, same as a hunt target — see
    // `stepTowardMovingTarget`'s own doc comment (pathfinding.ts) for why
    // this needs its own staleness/recompute handling rather than plain
    // `stepToward` or `stepAlongPath`'s static-target cache match.
    agent.pos = stepTowardMovingTarget(world, agent, partner);
  }
}
