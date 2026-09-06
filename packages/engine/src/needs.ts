import type { Agent, BehaviorKind, HuntRules, Layer, Needs, TerrainKind, Tile, Vec2, World } from "./types.js";
import { otherLayers, setTile, tileAt } from "./world.js";
import { stepToward } from "./movement.js";
import { stepAlongPath } from "./pathfinding.js";
import { applyEggEating, applyPredationInstincts, hasAwakeHerdmateNearby, hasNearbyThreat, manhattan } from "./predation.js";
import { applyMateSeeking } from "./reproduction.js";
import { CONSUME_STOCK_AMOUNT, foodNutritionFactor, recordGrazing, tendSoil } from "./flora.js";
import { tickCooldowns, useMove } from "./combat.js";
import { DIG_TICKS_DEFAULT, FOOD_CROPS, type CropId } from "./crops.js";
import { applyHerdCohesion, herdRank } from "./herding.js";
import { migrate } from "./migration.js";
import { applyDispersal, maybeTriggerDispersal, type RegionDispersalContext } from "./dispersal.js";
import {
  applyShelterBuilding,
  applyShelterResting,
  hasNearbyShelter,
  maybeFeedFromShelterCache,
  maybeTriggerShelterBuilding,
  SHELTER_HEAL_MULTIPLIER,
  SHELTER_NEEDS_DECAY_MULTIPLIER,
  SHELTER_REST_RADIUS,
} from "./shelter.js";
import { logBehaviorChange, type EventLog } from "./events.js";
import {
  EXP_ON_CONSUME,
  EXP_TRICKLE_PER_TICK,
  MAX_TRACKED_SPECIES,
  grantExp,
  markSectorVisited,
  markSpeciesEncountered,
  sectorId,
  type LevelingContext,
} from "./leveling.js";
import { applyCarrying, applyHealOverTime, applyHerdSupport, applyLooting, applyScavenging, applySupportMove, maybeRecoverFromFaint, maybeStartCarrying } from "./support.js";
import { findNearestIndexed, type IndexedTerrain } from "./resourceIndex.js";
import { canEnterTile } from "./occupancy.js";
import { canEnterWater, canEnterLand } from "./waterBody.js";
import { findWalkableNear } from "./worldgen.js";
import { HERD_CONFLICT_MIN_BLOCKED_TICKS, applyHerdRivalryConflict, applyRivalryRetaliation, applyTerritorialGuard } from "./herdConflict.js";
import { maybeUseUtilityMove } from "./utilityMoves.js";
import { thirstDecayMultiplier } from "./weather.js";
import { PARALYSIS_SKIP_CHANCE, isAsleep, isFrozen, isParalyzed, tickStatusEffects } from "./status.js";

const DECAY_PER_TICK = {
  /**
   * Quartered again from 0.005 — direct ask: "thirst and hunger... much
   * much much slower... like 1/4 the time it is now." At 0.00125, thirst
   * empties in ~800 ticks (was ~200), on top of `THIRST_STARVATION_GRACE_TICKS`,
   * without touching thirst's deliberately-kept-linear curve. Motivated by
   * the breeding-level gate (agents now need to survive to level 16 or
   * evolve before they can reproduce at all) — see DESIGN.md's "Breeding
   * requires a real earned edge" section, whose real-run findings showed
   * near-zero breeding because agents weren't surviving long enough to
   * level up; giving needs a much longer runway is the direct fix.
   */
  thirst: 0.00125,
  energy: 0.005,
  mateDrive: 0.01,
} as const;

/**
 * Hunger decay is no longer a flat per-tick subtraction — direct feedback
 * that a flat rate reads as too punishing. Real appetite doesn't work that
 * way: you get hungry fairly fast right after a meal, but once genuinely
 * hungry you can go a long while before it's actually dangerous. Modeled as
 * exponential decay of the *remaining* hunger value (a multiplicative term
 * proportional to current hunger, so the absolute drop is largest at full
 * and shrinks as hunger falls) plus a small flat floor so it still reaches
 * true 0 in finite time instead of asymptoting forever. Both terms
 * quartered again from an earlier pass (0.006/0.0005) — direct ask: "thirst
 * and hunger... much much much slower... like 1/4 the time it is now,"
 * motivated by the breeding-level gate needing agents to actually survive
 * long enough to reach level 16 or evolve (see DESIGN.md). From full (1.0),
 * this now reaches the 0.7 "seek food" threshold (`chooseBehavior`'s
 * urgency cutoff) in ~216 ticks (was ~54), and takes ~1708 total to fall
 * the rest of the way to 0 (was ~427), where `STARVATION_GRACE_TICKS` (100
 * more) still has to run out before actual death — sim-original tuning,
 * judge against a real run like everything else here, not a canon formula.
 */
const HUNGER_DECAY_RATE = 0.0015;
const HUNGER_DECAY_FLOOR = 0.000125;

/** Ticks an agent can sit at 0 hunger before it dies of it. */
const STARVATION_GRACE_TICKS = 100;
/**
 * Thirst's own, longer, grace period — see "Extend thirst's survival
 * margin" in DESIGN.md. Hunger's full curve (exponential decay of the
 * remaining value, see `HUNGER_DECAY_RATE`'s doc comment) now takes ~427
 * ticks to empty, then 100 more before death — ~527 total. Thirst's flat
 * rate empties in ~200 ticks (`DECAY_PER_TICK.thirst`); this 150-tick grace
 * period brings its total survival budget to ~350 — narrower than hunger's
 * but not by a principle-violating margin, and thirst deliberately stays
 * linear rather than getting hunger's exponential shape. Tracked
 * independently of `STARVATION_GRACE_TICKS` via `Agent.thirstStarvationTicks`
 * (a separate counter from `Agent.starvationTicks`) since hunger and thirst
 * can cross 0 at different ticks — a single shared counter can't correctly
 * judge two different thresholds.
 */
const THIRST_STARVATION_GRACE_TICKS = 150;
/**
 * Age (ticks) at which old-age mortality starts being possible at all. A
 * single global constant for now, same call as `MATURITY_AGE` above — real
 * per-species lifespans (a Pidgey aging out faster than a Venusaur) are a
 * data-layer refinement for later.
 */
const OLD_AGE_ONSET = 1500;
/** Age at which the per-tick death chance saturates at `OLD_AGE_MAX_CHANCE`. */
const OLD_AGE_HAZARD_CAP_AGE = 3000;
/** The per-tick death chance a sufficiently old agent asymptotically approaches. */
const OLD_AGE_MAX_CHANCE = 0.02;

/**
 * A gentle, ramping hazard rather than a hard cutoff age — a species with no
 * predator and no famine (a guardian Venusaur, say) should still eventually
 * die of old age instead of living forever once every other cause of death
 * is dodged, but a sharp "everyone dies at exactly age X" cutoff would read
 * as an obvious game-of-life rule rather than mortality. 0 before
 * `OLD_AGE_ONSET`, then rises linearly to `OLD_AGE_MAX_CHANCE` by
 * `OLD_AGE_HAZARD_CAP_AGE` and stays there for anything older.
 */
export function ageMortalityChance(age: number): number {
  if (age < OLD_AGE_ONSET) return 0;
  const span = OLD_AGE_HAZARD_CAP_AGE - OLD_AGE_ONSET;
  const progress = Math.min(1, (age - OLD_AGE_ONSET) / span);
  return progress * OLD_AGE_MAX_CHANCE;
}
/** Ticks a non-predator can go wanting food/water with none reachable anywhere before it gives up and migrates. */
const MIGRATE_AFTER_TICKS = 150;

/**
 * Tile capacity's "blocked-resource AI" — direct ask: "Might need ai to
 * recognize when it's blocked or unable to get a resource and try to
 * relocate to find a new one." How long an agent tolerates its current
 * seekWater/seekFood target being at capacity (`occupancy.ts`) before
 * giving up on THIS specific tile and trying a different one of the same
 * terrain kind. Deliberately much shorter than `MIGRATE_AFTER_TICKS` (150,
 * "no resource of this kind exists/is reachable ANYWHERE") — this is a much
 * narrower, more common situation (a real resource sits right there,
 * several tiles away or one hop away, just currently full), and per this
 * codebase's established "sustained, not instant" tuning convention, a real
 * short wait should read as genuine queueing/turn-taking (the user's
 * explicit ask: "feeding and drinking has to actually be timed") before an
 * agent gives up and looks elsewhere — instant switching would produce
 * relocation-with-a-guise instead of visible contention. 25 ticks sits
 * comfortably below the scale of a real multi-hundred-tick errand
 * (dispersal/shelter-building/food-delivery) while still being a genuine
 * wait, not a single-tick flicker. See DESIGN.md's "Tile capacity" section
 * for the real-run read on whether agents actually wait vs. just relocate.
 */
const BLOCKED_RESOURCE_GRACE_TICKS = 25;

/**
 * How many recently-crowded tiles of the same terrain kind one seeking
 * episode remembers to exclude from the next nearest-tile pick — bounds the
 * "try a different resource tile" fallback so it doesn't immediately
 * re-offer a tile it just gave up on. Small on purpose — a real local
 * water/food supply rarely has more than a couple of genuinely nearby
 * alternatives; this isn't meant to remember a map-spanning list. Real
 * exhaustion (every currently-known nearby tile of this terrain excluded)
 * is detected structurally, not by hitting this exact count — see
 * `somethingExistsNearby`'s use below.
 */
const MAX_BLOCKED_RESOURCE_MEMORY = 4;

/**
 * Sleep — see DESIGN.md's "Sleep: a real vulnerable-rest state" section.
 * `Needs.energy` decays at `DECAY_PER_TICK.energy` (0.005/tick), so a fully
 * rested (1.0) agent that never sleeps takes ~140 ticks to fall below this
 * threshold — a real, reachable-within-a-normal-run floor (not so low it
 * almost never fires), while still comfortably below `chooseBehavior`'s
 * urgency band so falling asleep never looks like an emergency reaction.
 * Sim-original tuning guess, explicitly flagged in DESIGN.md as unconfirmed
 * until a real run shows agents actually reaching it — see this feature's
 * "Built, and real-run findings" writeup.
 */
export const ENERGY_SLEEP_THRESHOLD = 0.3;

/**
 * How much slower hunger/thirst drain while genuinely asleep — real cost to
 * oversleeping (DESIGN.md's explicit ask: "dramatically reduced," not
 * paused), not free. 0.15 means an asleep agent's hunger/thirst budget
 * stretches to roughly 6-7x its awake rate — long enough that a multi-
 * hundred-tick sleep doesn't quietly kill the sleeper of thirst, short
 * enough that oversleeping still visibly costs something on a long enough
 * nap. Sim-original tuning guess, judge against a real run.
 */
export const SLEEP_NEEDS_DECAY_MULTIPLIER = 0.15;

/**
 * How fast `energy` rises while asleep — 4x `DECAY_PER_TICK.energy`'s awake
 * drain rate, so a full night's sleep is a real, visible recovery (a nap of
 * a few hundred ticks meaningfully refills energy) without being instant.
 */
export const SLEEP_ENERGY_RESTORE_RATE = 0.02;

/**
 * Heal-over-time multiplier while asleep — support.ts's `applyHealOverTime`
 * gets this on top of its existing flat rate, per DESIGN.md's "replenishes
 * hp... more" ask. 3x is a real, noticeable difference from awake healing
 * without being an instant full-heal nap.
 */
export const SLEEP_HEAL_MULTIPLIER = 3;

/** Move-cooldown ticks (combat.ts's `tickCooldowns`) consumed per action tick while asleep — double speed, DESIGN.md's "pp" (cooldown) recovery ask. */
export const SLEEP_COOLDOWN_TICKS = 2;

/**
 * Consecutive `sleepTicks` before a long, uninterrupted sleep grants a
 * one-time exp bonus — DESIGN.md's "long sleep can give xp" ask. Set above
 * a single ordinary nap's likely length (a sleep session this long means the
 * agent found genuinely safe, sustained rest) so this reads as a real
 * milestone, not something every nap trivially grants. Sim-original tuning
 * guess, judge against a real run.
 */
export const LONG_SLEEP_EXP_TICKS = 200;

/** One-time exp bonus granted at `LONG_SLEEP_EXP_TICKS` — same order of magnitude as leveling.ts's `EXP_ON_NEW_SECTOR` (20), a comparable "real milestone" reward. */
export const LONG_SLEEP_EXP_BONUS = 25;

/**
 * A real kill should be a much bigger deal than grazing — direct ask: "a
 * kill is just a lot more incentive for them, keeps em sated." A predator
 * still eats plants (this doesn't touch generic foraging at all), but a
 * kill fully restores hunger to 1.0 and starts a `digestingTicksRemaining`
 * countdown (`Agent`'s own field, set by predation.ts's hunt branch — see
 * `KILL_SATIATION_TICKS` there for the tick count) during which hunger
 * decays at this multiplier instead of its normal rate — a big meal
 * actually lasts, rather than being back to normal hunger-seeking within
 * the next few dozen ticks like an ordinary plant meal. 0.1 means roughly
 * 10x the normal post-meal runway. Thirst is deliberately untouched —
 * eating doesn't quench thirst.
 */
export const KILL_SATIATION_HUNGER_DECAY_MULTIPLIER = 0.1;

/**
 * How far a fully-satisfied idle agent will look for a not-yet-visited
 * sector to wander to — the exp-motivated exploration drive. Deliberately
 * local (`SECTOR_SIZE` in leveling.ts is 5, so this reaches a handful of
 * neighboring sectors), not a full migrate()-style jump across the map —
 * this is idle curiosity, not desperation.
 */
const EXPLORE_SEARCH_RADIUS = 8;
const EXPLORE_SEARCH_ATTEMPTS = 8;
/**
 * A newborn doesn't wander off exploring the instant it's born — it settles
 * in near its birthplace for a few ticks first. Also fixes a real same-tick
 * interaction: a newborn (age 0) pushed mid-loop by `spawnOffspring` gets
 * ticked once more in the very same `tickWorld` call (see simulation.ts's
 * doc comment) — by the time ITS OWN turn runs, `tickAgentNeeds` has
 * already incremented its age to 1, and without this floor it could
 * immediately wander a step back onto its mother's own tile, defeating the
 * "don't spawn stacked on the mother" placement `nearbySpawnTile` exists
 * for (confirmed: this exact interaction intermittently failed that test).
 */
const MIN_EXPLORE_AGE = 10;

/** A random nearby walkable tile that lands in a sector this agent hasn't visited yet, if one can be found in a few tries. */
function findNearbyUnvisitedTile(world: World, agent: Agent, rng: () => number): Vec2 | undefined {
  for (let i = 0; i < EXPLORE_SEARCH_ATTEMPTS; i++) {
    const dx = Math.floor(rng() * (EXPLORE_SEARCH_RADIUS * 2 + 1)) - EXPLORE_SEARCH_RADIUS;
    const dy = Math.floor(rng() * (EXPLORE_SEARCH_RADIUS * 2 + 1)) - EXPLORE_SEARCH_RADIUS;
    const candidate = { x: agent.pos.x + dx, y: agent.pos.y + dy };
    if (!tileAt(world, agent.layer, candidate.x, candidate.y)?.walkable) continue;
    if (agent.visitedSectors?.includes(sectorId(candidate.x, candidate.y))) continue;
    return candidate;
  }
  return undefined;
}

/**
 * Terrain kinds resourceIndex.ts's cheap index tracks — a preference in this
 * set gets the same O(matching tiles) `findNearestIndexed` lookup as an
 * ordinary food/water search. A preference kind outside this set (currently
 * "bush"/"boulder", each tagged by only a single roster species so far — see
 * DESIGN.md's "Tile preference" section) falls back to
 * `findNearestPreferredLocal`'s bounded scan instead of extending the global
 * index for one consumer.
 */
const INDEXED_PREFERENCE_KINDS: ReadonlySet<TerrainKind> = new Set(["water", "food", "sunbeam", "flora"]);

/**
 * Bounded local scan for a preferred terrain kind that isn't in
 * resourceIndex.ts's cheap index. Same shape as `findNearbyUnvisitedTile`'s
 * "cheap, local, not a full-grid scan" standard, but exhaustive within its
 * radius (rather than a handful of random tries) since this is a real
 * destination search, not a curiosity roll.
 */
const PREFERRED_TERRAIN_LOCAL_SCAN_RADIUS = 12;

function findNearestPreferredLocal(world: World, agent: Agent, terrain: TerrainKind): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestDist = Infinity;
  const r = PREFERRED_TERRAIN_LOCAL_SCAN_RADIUS;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = agent.pos.x + dx;
      const y = agent.pos.y + dy;
      if (tileAt(world, agent.layer, x, y)?.terrain !== terrain) continue;
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Close enough to a preferred-terrain tile that lingering here already
 * satisfies the preference — no need to path the last step or two onto the
 * exact tile. Small and deliberate: this is "hang out near the flora patch,"
 * not "always be standing exactly on a flora tile."
 */
const PREFERRED_TERRAIN_SATISFIED_RADIUS = 2;

/**
 * "arrived": the agent is already within `PREFERRED_TERRAIN_SATISFIED_RADIUS`
 * of a matching tile — content, no wander needed this tick. `Vec2`: a real
 * destination to head toward. `undefined`: no `preferredTerrain` tagged, or
 * none of the tagged kinds exist anywhere reachable — caller should fall
 * back to ordinary exploration.
 */
function locatePreferredTerrain(world: World, agent: Agent): "arrived" | Vec2 | undefined {
  const prefs = agent.preferredTerrain;
  if (!prefs || prefs.length === 0) return undefined;
  for (const terrain of prefs) {
    const pos = INDEXED_PREFERENCE_KINDS.has(terrain)
      ? findNearestIndexed(world, agent.layer, agent.pos, terrain as IndexedTerrain)
      : findNearestPreferredLocal(world, agent, terrain);
    if (!pos) continue;
    return manhattan(agent.pos, pos) <= PREFERRED_TERRAIN_SATISFIED_RADIUS ? "arrived" : pos;
  }
  return undefined;
}

/**
 * Called only once an agent is otherwise fully idle (no urgent need, no
 * herd pull-back needed) — instead of just standing on the last tile it
 * ate/drank at forever, it wanders toward nearby unexplored territory,
 * motivated by the exp `markSectorVisited` grants for genuinely new ground
 * (see leveling.ts). Requested directly: agents should be "somewhat
 * motivated by gaining exp too," not just gain it as a side effect of
 * need-seeking. Incidentally also closes the pre-existing "no reason to
 * leave a resource tile once satisfied" gap noted in TODO.md's tile-
 * stacking section. A no-op (stays idle) if nothing new is reachable
 * nearby right now — exploring is optional flavor, not another need that
 * can starve.
 *
 * Tile preference (see DESIGN.md's "Tile preference" section) is checked
 * FIRST, ahead of the unvisited-sector wander: a `preferredTerrain`-tagged
 * species that's already lingering near its preferred terrain kind is
 * content and skips wandering entirely this tick (the `"arrived"` case);
 * one that isn't heads there instead of a uniformly random nearby spot. Only
 * an untagged species, or a tagged one with no matching tile reachable at
 * all, falls through to the pre-existing random-wander behavior — so this
 * is a strict, additive extension, not a replacement: nothing changes for
 * any species that was never tagged. Deliberately checked fresh every time
 * `agent.exploreTarget` is empty (same as the unvisited-tile search below),
 * never persisted as its own separate commitment field — a preference-
 * driven wander is exactly as droppable by an urgent need as ordinary
 * exploration already is, since both live in the same `exploreTarget`.
 */
function applyExploration(world: World, agent: Agent, log: EventLog | undefined, rng: () => number): void {
  if (agent.age !== undefined && agent.age < MIN_EXPLORE_AGE) return;

  if (!agent.exploreTarget) {
    const preferred = locatePreferredTerrain(world, agent);
    if (preferred === "arrived") return;
    agent.exploreTarget = preferred ?? findNearbyUnvisitedTile(world, agent, rng);
    if (!agent.exploreTarget) return;
  }

  logBehaviorChange(log, world, agent, "explore");
  agent.behavior = "explore";

  if (manhattan(agent.pos, agent.exploreTarget) <= 1) {
    agent.pos = agent.exploreTarget;
    agent.exploreTarget = undefined;
  } else {
    agent.pos = stepToward(world, agent.layer, agent.pos, agent.exploreTarget, agent, agent);
  }
}

const CONSUME_RATE = {
  seekWater: { need: "thirst", amount: 0.4 },
  seekFood: { need: "hunger", amount: 0.4 },
} as const;

export function createNeeds(overrides: Partial<Needs> = {}): Needs {
  return { hunger: 1, thirst: 1, energy: 1, mateDrive: 0, ...overrides };
}

/**
 * `thirstMultiplier` (default 1) composes multiplicatively with the flat
 * per-tick thirst decay rate — a local weather effect (rain eases it,
 * drought raises it — see weather.ts's `thirstDecayMultiplier`), not a
 * replacement for the base rate. Every pre-existing caller that doesn't pass
 * it keeps decaying at exactly the original flat rate.
 *
 * `asleep` (default false) is the sleep mechanic's three needs-decay effects
 * at once (DESIGN.md's "Sleep" section): while true, hunger and thirst decay
 * are both further multiplied by `SLEEP_NEEDS_DECAY_MULTIPLIER` (composing
 * with `thirstMultiplier` for thirst — a sleeping agent caught in a drought
 * still gets some relief, just less), and `energy` rises
 * (`SLEEP_ENERGY_RESTORE_RATE`) instead of falling. A single boolean rather
 * than a third numeric multiplier parameter: sleep doesn't just scale
 * energy's decay, it inverts its direction entirely, which a multiplier
 * alone can't express.
 *
 * `hungerMultiplier` (default 1) composes multiplicatively with the base
 * hunger-decay term only (never thirst) — the post-kill "digesting"
 * slowdown (`KILL_SATIATION_HUNGER_DECAY_MULTIPLIER`, set via
 * `Agent.digestingTicksRemaining` in `tickAgentNeeds`). Kept as its own
 * parameter rather than folded into `asleep`'s combined multiplier since an
 * agent can be digesting without being asleep (or vice versa), and a kill
 * deliberately doesn't touch thirst the way sleep does.
 *
 * `shelterMultiplier` (default 1) composes multiplicatively with `asleep`'s
 * own multiplier — shelter.ts's `SHELTER_NEEDS_DECAY_MULTIPLIER`, passed
 * whenever the agent is within `SHELTER_REST_RADIUS` of any shelter tile
 * (see `tickAgentNeeds`'s call site). A smaller, real-but-lesser reduction
 * than sleep's own: being merely home is a lighter commitment than being a
 * genuine sitting duck, so it shouldn't duplicate sleep's "dramatically
 * reduced" bonus outright — but an asleep agent that's ALSO home gets both,
 * multiplicatively, the best rest available in this sim.
 */
export function decayNeeds(needs: Needs, thirstMultiplier = 1, asleep = false, hungerMultiplier = 1, shelterMultiplier = 1): void {
  const needsMultiplier = (asleep ? SLEEP_NEEDS_DECAY_MULTIPLIER : 1) * shelterMultiplier;
  needs.hunger = Math.max(0, needs.hunger - (needs.hunger * HUNGER_DECAY_RATE + HUNGER_DECAY_FLOOR) * needsMultiplier * hungerMultiplier);
  needs.thirst = Math.max(0, needs.thirst - DECAY_PER_TICK.thirst * thirstMultiplier * needsMultiplier);
  needs.energy = asleep
    ? Math.min(1, needs.energy + SLEEP_ENERGY_RESTORE_RATE)
    : Math.max(0, needs.energy - DECAY_PER_TICK.energy);
  needs.mateDrive = Math.min(1, needs.mateDrive + DECAY_PER_TICK.mateDrive);
}

/**
 * Picks the single most urgent need and maps it to a behavior. Thirst and
 * hunger are weighted above mating so herds don't starve chasing romance —
 * tune these thresholds once real playtesting exists.
 */
export function chooseBehavior(needs: Needs): BehaviorKind {
  const urgency: Array<[BehaviorKind, number]> = [
    ["seekWater", 1 - needs.thirst],
    ["seekFood", 1 - needs.hunger],
    ["seekMate", needs.mateDrive * 0.5],
  ];
  urgency.sort((a, b) => b[1] - a[1]);
  const [behavior, score] = urgency[0]!;
  return score > 0.3 ? behavior : "idle";
}

/**
 * Nearest tile of the given terrain kind, if any — delegates to
 * resourceIndex.ts's cached index rather than a naive full-grid scan (was
 * O(width*height) *per call*, flagged in TODO.md as the cheap tier's
 * performance ceiling; became a real bottleneck once the generated map grew
 * from 24x16 to ~90x60 — see DESIGN.md). Same signature/behavior as before,
 * so every existing caller/test is unaffected.
 */
export function findNearestTerrain(
  world: World,
  layer: Layer,
  from: Vec2,
  terrain: "water" | "food" | "sunbeam",
  exclude: readonly Vec2[] = []
): Vec2 | undefined {
  return findNearestIndexed(world, layer, from, terrain, exclude);
}

/**
 * How many raw-nearest water candidates `findReachableWaterTarget` will
 * reject-and-retry before giving up for this tick. `findNearestTerrain` is
 * purely geometric ("nearest tile of this terrain kind") — it has no idea a
 * large lake/ocean's interior is now off-limits to a non-water-type agent
 * (`waterBody.ts`'s `canEnterWater`), so near an irregular real coastline
 * (this session's macro land/ocean elevation + rivers worldgen, not a clean
 * rectangle) the handful of geometrically-nearest water tiles can genuinely
 * all be interior/unreachable before the actual nearest reachable shore
 * tile turns up — a real, measured effect on real generated maps, not a
 * hypothetical: an early, too-low bound here (`MAX_BLOCKED_RESOURCE_MEMORY`,
 * 4 — reused from the transient capacity-wait exclusion list) measurably
 * increased thirst-starvation deaths in a real multi-seed run before this
 * was split out into its own, larger, non-persisted budget (see DESIGN.md's
 * real-run findings for this feature). Deliberately NOT reusing
 * `agent.blockedResourceTiles` for these exclusions — that field is small
 * (capped at `MAX_BLOCKED_RESOURCE_MEMORY`) and meant for the *transient*
 * capacity-wait case (a tile that might free up later); an unreachable-by-
 * type tile never becomes reachable, so persisting it there would just
 * evict real transient-crowding memory for no benefit. Recomputed fresh
 * every tick instead: `findNearestIndexed`'s per-lookup cost is cheap
 * (O(matching water tiles), no full-grid scan) and only thirsty agents near
 * a large body's tricky-shaped coastline ever pay for more than one lookup.
 */
const WATER_REACHABILITY_MAX_ATTEMPTS = 24;

/**
 * `findNearestTerrain(..., "water", ...)`, additionally skipping any
 * candidate this specific `agent` can't actually enter (`waterBody.ts`'s
 * `canEnterWater`) — see `WATER_REACHABILITY_MAX_ATTEMPTS`'s doc comment for
 * why this needs its own bound instead of reusing `seekWater`'s ordinary
 * `exclude` list. Falls through to the pre-existing
 * `ticksWithoutResource`/`migrate` escape valve (this function's only
 * caller, below) when every attempt is exhausted — a Rock/Fire type (or any
 * non-water type) surrounded only by one giant lake/ocean with no reachable
 * shore or small pond anywhere nearby genuinely has nothing to target, and
 * that's the correct outcome, not a bug to route around further.
 */
function findReachableWaterTarget(world: World, agent: Agent, baseExclude: readonly Vec2[]): Vec2 | undefined {
  const exclude = [...baseExclude];
  for (let attempts = 0; attempts < WATER_REACHABILITY_MAX_ATTEMPTS; attempts++) {
    const candidate = findNearestIndexed(world, agent.layer, agent.pos, "water", exclude);
    if (!candidate) return undefined;
    if (canEnterWater(world, agent, agent.layer, candidate)) return candidate;
    exclude.push(candidate);
  }
  return undefined;
}

/**
 * `findReachableWaterTarget`'s symmetric counterpart, for the obligate-
 * aquatic side of the same reachability-vs-nearest mismatch: `worldgen.ts`
 * places "food" terrain on LAND tiles only (water and food are mutually
 * exclusive per-tile — see that file's tile-generation pass), so an
 * obligate-aquatic agent (`waterBody.ts`'s `canEnterLand`) can only actually
 * reach a food tile sitting on the shore ring directly touching water, never
 * one further inland — exactly the same "geometrically nearest isn't the
 * same as reachable" trap `findReachableWaterTarget` exists for, just food
 * instead of water and land-depth instead of water-depth. A NON-
 * obligate-aquatic agent is completely unaffected: `canEnterLand` is an
 * unconditional `true` for it, so this behaves exactly like a plain
 * `findNearestTerrain(..., "food", ...)` lookup, same as before this
 * function existed. Reuses `WATER_REACHABILITY_MAX_ATTEMPTS` rather than a
 * second hand-tuned constant — both bounds exist for the identical reason
 * (an irregular real coastline's nearest candidates can genuinely all be
 * unreachable before a real reachable one turns up), so there's no reason
 * to expect a different number to matter here.
 */
function findReachableFoodTarget(world: World, agent: Agent, baseExclude: readonly Vec2[]): Vec2 | undefined {
  const exclude = [...baseExclude];
  for (let attempts = 0; attempts < WATER_REACHABILITY_MAX_ATTEMPTS; attempts++) {
    const candidate = findNearestIndexed(world, agent.layer, agent.pos, "food", exclude);
    if (!candidate) return undefined;
    if (canEnterLand(world, agent, agent.layer, candidate)) return candidate;
    exclude.push(candidate);
  }
  return undefined;
}

/** Finds a layer other than `from` that has the given terrain, nearest (adjacent) layers first. */
export function findLayerWithTerrain(
  world: World,
  from: Layer,
  origin: Vec2,
  terrain: "water" | "food" | "sunbeam",
  exclude: readonly Vec2[] = []
): Layer | undefined {
  for (const layer of otherLayers(from)) {
    if (findNearestTerrain(world, layer, origin, terrain, exclude)) return layer;
  }
  return undefined;
}

/**
 * `qualityMultiplier` — direct ask: "fully fertile plant gives super
 * higher quality berries." Only `seekFood` ever passes anything but the
 * default 1: water tiles have no `quality` concept of their own.
 */
function consume(needs: Needs, behavior: "seekWater" | "seekFood", qualityMultiplier = 1): void {
  const { need, amount } = CONSUME_RATE[behavior];
  needs[need] = Math.min(1, needs[need] + amount * qualityMultiplier);
}

/**
 * Chance, per action tick a water-affiliated agent spends `seekFood` while
 * already standing on a water tile, of grazing something incidental right
 * there (algae/krill stand-in) instead of needing to reach a real "food"
 * tile at all. Direct ask: "water type Pokémon should be able to find food
 * in pools of water by random chance, simulating algae or krill." Real gap
 * this closes, not just flavor: `findReachableFoodTarget`'s own doc comment
 * already notes `worldgen.ts` only ever places "food" terrain on LAND
 * tiles, so an obligate-aquatic agent (`waterBody.ts`'s `canEnterLand`) can
 * only ever reach a food tile sitting on the shore ring directly touching
 * water — this gives it (and any species that simply prefers water,
 * amphibious or not) a real food source that doesn't depend on shore
 * geometry at all.
 */
const WATER_FORAGE_CHANCE_PER_TICK = 0.05;
/** A light snack, not a full meal — `WATER_FORAGE_CHANCE_PER_TICK` firing often enough on its own to matter (roughly one hit every 20 ticks while sitting in water) already adds up; a real "food" tile should still be the better, more deliberate meal for a species that has one reachable at all. */
const WATER_FORAGE_QUALITY = 0.4;

/**
 * Whether `agent`'s species is meaningfully water-affiliated for foraging
 * purposes — genuinely obligate-aquatic (Magikarp, Tentacruel, ...) or one
 * that simply prefers water tiles once idle (`SpeciesDef.preferredTerrain`,
 * e.g. the Squirtle line) — either reads as "at home enough in water to
 * graze it," not just the narrower obligate-aquatic case alone.
 */
export function isWaterForager(agent: Agent): boolean {
  return agent.obligateAquatic === true || agent.preferredTerrain?.includes("water") === true;
}

/**
 * Tries the incidental water-graze above; returns true (and applies the
 * partial hunger restore + a `consumed` event, same shape every other
 * consumption path in this file already logs) exactly when it fires. Purely
 * opportunistic — only rolled while the agent is ALREADY sitting on a water
 * tile this tick, never a reason to travel anywhere on its own.
 */
function tryForageFromWater(world: World, agent: Agent, log: EventLog | undefined, rng: () => number): boolean {
  if (!isWaterForager(agent)) return false;
  if (tileAt(world, agent.layer, agent.pos.x, agent.pos.y)?.terrain !== "water") return false;
  if (rng() >= WATER_FORAGE_CHANCE_PER_TICK) return false;

  consume(agent.needs, "seekFood", WATER_FORAGE_QUALITY);
  log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "hunger" });
  return true;
}

/**
 * DESIGN.md's "Herd status" payoff 1 — feeding priority. **Real contention
 * finding**: same-tick, same-tile contention over a food patch's dwindling
 * `stock` genuinely happens in this codebase's model — `tickWorld`'s
 * per-agent loop (simulation.ts) runs every agent's action tick within one
 * call, and `resourceIndex.ts`'s `findNearestIndexed` re-checks a food
 * tile's live `stock` on every lookup (only reverting to unindexed "floor"
 * once `growFlora` runs, once per tick, *after* the whole per-agent loop) —
 * so two herd-mates who both converge on the same nearest food tile
 * routinely both reach and target it inside the same `tickWorld` call, with
 * whichever one's turn came first in `world.agents`' iteration order
 * (arbitrary spawn order, nothing to do with status) draining the stock
 * first. This is that real mechanism, not an invented analog.
 *
 * What wasn't already real: consuming never actually depended on how much
 * `stock` was left — `consume()` always grants the full flat need-restore
 * amount regardless, `stock` was purely bookkeeping for when a patch reverts
 * to floor. So "getting whatever's left, possibly nothing" needed an actual
 * gate to attach to, added here: once a tile's `stock` is already low enough
 * that it can't obviously feed a second herd-mate too
 * (`FEEDING_PRIORITY_STOCK_THRESHOLD`), a lower-ranked agent that finds a
 * *higher-ranked, also-currently-hungry* herd-mate standing on the exact
 * same tile yields its turn (does nothing this tick, stays `seekFood`, tries
 * again next tick) instead of eating — so the higher-rank member's next
 * action tick (same tick or shortly after, whichever its own Speed-gated
 * turn allows) drains the tile first, and the lower-rank member only gets
 * "whatever's left" once the higher-rank one is no longer contesting it
 * (satisfied, or has moved on). Above the threshold, stock isn't actually
 * dwindling yet — both eat freely, no reason to make either wait.
 */
const FEEDING_PRIORITY_STOCK_THRESHOLD = 2 * CONSUME_STOCK_AMOUNT;

/** Herbs' own real hook (CROPS_DESIGN.md) — deliberately well under Safeguard's 60-tick grant, and self-only (no herd-radius aura like Safeguard's), so it reads as "the humble remedy," not a strictly-better food. */
const HERBS_STATUS_IMMUNE_TICKS = 20;

/**
 * Real process-time cost to dig a brand-new spring — CROPS_DESIGN.md's
 * water rework. Same order of magnitude as `DIG_TICKS_DEFAULT`/the real
 * `dig` move's own `burrow.ticks` (20) — this literally is that move's own
 * canonical duration, since digging a spring is a more literal read of
 * "Dig" than uncovering an existing crop is.
 */
const SPRING_DIG_TICKS = 20;

/**
 * How much extra `Agent.digTicksAccrued` a single successful use of an
 * off-cooldown `burrow`-flagged move (the real `dig` move, currently the
 * only one) grants, on top of the ordinary +1/tick — "moves can be used to
 * dig faster... like dig," CROPS_DESIGN.md's own pitch. Deliberately a real
 * multi-tick burst (a third of `DIG_TICKS_DEFAULT`), not a token nudge, so
 * actually knowing Dig is worth something concrete here, gated by the
 * move's own real cooldown (`useMove`) so it can't be spammed every tick.
 * Scoped to `burrow`-flagged moves only for now — CROPS_DESIGN.md's own
 * "most damage moves" phrasing is flagged there as a real open question,
 * not decided here.
 */
const DIG_MOVE_BURST_TICKS = 5;

/**
 * `Agent.digTicksAccrued` burst a single off-cooldown damage-dealing move
 * grants toward processing a canopy-native crop (Apple) out — the "canopy
 * foods processed by damage" half of the pitch, `DIG_MOVE_BURST_TICKS`'s
 * own counterpart for Canopy instead of Underground. Any move with real
 * `power` and a non-`"status"` `category` qualifies (Tackle, Peck, ...) —
 * deliberately not scoped to `burrow`-flagged moves the way digging is,
 * since knocking fruit down is a damage action, not an extraction one.
 */
const CANOPY_HARVEST_MOVE_BASE_BURST = 3;

/**
 * Extra burst per point of a damage move's own `range.max` beyond 1 (melee)
 * — "higher range gives advantage," a direct, cheap reuse of `MoveSpec.
 * range` (already real and consumed by combat.ts's `moveRange`/
 * `withinMoveRange`) rather than inventing a second range concept just for
 * this. A move with no explicit `range` set falls back to 1 (melee), same
 * as `CANOPY_HARVEST_MOVE_BASE_BURST` alone — no accidental bonus for specs
 * that predate the `range` field.
 */
const CANOPY_HARVEST_RANGE_BONUS_PER_POINT = 2;

/**
 * How many more `Agent.digTicksAccrued` this crop still needs before an
 * agent on a mismatched layer can actually eat from it — undefined when no
 * digging is required at all (the crop has no `nativeLayer`, or this agent
 * is already on it). CROPS_DESIGN.md's "layer-gated crop access": Potato/
 * Pumpkin are underground-native, so a surface agent pays this real
 * process-time tax while an underground agent standing on the same tile
 * pays nothing.
 */
function cropDigThreshold(tile: Tile | undefined, agentLayer: Layer): number | undefined {
  if (!tile?.flavor || !(tile.flavor in FOOD_CROPS)) return undefined;
  const def = FOOD_CROPS[tile.flavor as CropId];
  if (!def.nativeLayer || def.nativeLayer === agentLayer) return undefined;
  return def.digTicks ?? DIG_TICKS_DEFAULT;
}

function yieldsToHigherRankedFeeder(world: World, agent: Agent, tileStock: number | undefined): boolean {
  if (!agent.herdId) return false;
  if (tileStock === undefined || tileStock >= FEEDING_PRIORITY_STOCK_THRESHOLD) return false;

  const myRank = herdRank(world, agent);
  return world.agents.some(
    (other) =>
      other.id !== agent.id &&
      other.alive !== false &&
      other.herdId === agent.herdId &&
      other.pos.x === agent.pos.x &&
      other.pos.y === agent.pos.y &&
      other.layer === agent.layer &&
      chooseBehavior(other.needs) === "seekFood" &&
      herdRank(world, other) < myRank
  );
}

/**
 * The part of an agent's tick that happens every world tick regardless of
 * the Speed-driven action economy (see simulation.ts): aging, need decay,
 * and the passive exp trickle (tiny, per-tick, for every living agent —
 * deliberately in this always-runs path rather than the action-gated one,
 * consistent with the rest of the action-economy split: surviving doesn't
 * pause because you're slow). Move-cooldown countdown is deliberately NOT
 * here — see `tickAgentAction`'s own doc comment on why it ticks down on
 * the agent's own action tick instead, same as everything else a move's
 * `cooldownTicks` is meant to be measured against. `world`/`ctx`/`log` are
 * optional so callers without a leveling context (bare fixtures, anything
 * that predates this feature) keep working — no world/ctx means the
 * trickle simply isn't granted (nothing to log a tick number against).
 *
 * Heal-over-time and faint-recovery (support.ts) also live here, for the
 * same reason: a fainted agent still needs-decays and heals every tick even
 * though it's excluded from the action tick entirely (see `tickAgentAction`
 * below) — DESIGN.md's "Faint/finish-off, heal over time" section.
 *
 * `tickStatusEffects` (status.ts) lives here too, same reasoning: burn/
 * poison DOT and sleep/freeze's own duration/thaw all tick down regardless
 * of whether this is the agent's action tick. Paralysis's speed cut and
 * skip-the-action-tick roll are the two status effects that *aren't* here —
 * see `actionSpeedOf` (simulation.ts) and `tickAgentAction` below.
 */
export function tickAgentNeeds(
  agent: Agent,
  world?: World,
  ctx?: LevelingContext,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  if (agent.alive === false) return;
  if (agent.age !== undefined) agent.age += 1;
  if (world) tickStatusEffects(agent, world, log, rng);
  // "tilling/planting it via grass type help" — a live Grass-type agent
  // gradually enriches the ground it's standing on, every tick, no move
  // or intent required. Surface-only, matching flora.ts's own scope.
  if (world && agent.layer === "surface" && agent.types?.includes("grass")) {
    tendSoil(tileAt(world, agent.layer, agent.pos.x, agent.pos.y));
  }
  const thirstMultiplier = world ? thirstDecayMultiplier(world, agent.layer, agent.pos) : 1;
  // Post-kill "digesting" slowdown (see KILL_SATIATION_TICKS's doc comment)
  // — checked and ticked down here rather than gated behind `world` like
  // the trickle/starvation logic below, since it's pure needs bookkeeping
  // that should still count down even for a bare-fixture caller.
  const digesting = (agent.digestingTicksRemaining ?? 0) > 0;
  if (digesting) agent.digestingTicksRemaining = (agent.digestingTicksRemaining ?? 0) - 1;
  // Herd-conflict rivalry cooldown (herdConflict.ts) — same "plain bookkeeping,
  // ticks down regardless of `world`" shape as `digestingTicksRemaining` above.
  if ((agent.herdConflictCooldownTicks ?? 0) > 0) agent.herdConflictCooldownTicks = (agent.herdConflictCooldownTicks ?? 0) - 1;
  // "Incentivize the Pokémon to stay in it" — real, per-tick heal/needs-decay
  // perks for ANY agent genuinely standing near a shelter (universal now,
  // per direct instruction — no longer gated on `agent.buildsShelter`, see
  // shelter.ts's `maybeTriggerShelterBuilding` doc comment), regardless of
  // which behavior label happens to be set this tick (a fresh arrival,
  // mid-rest, or just passing through all count) — see shelter.ts's
  // "Incentive to actually stay" doc comment.
  const nearShelter = world !== undefined && hasNearbyShelter(world, agent.layer, agent.pos, SHELTER_REST_RADIUS);
  decayNeeds(
    agent.needs,
    thirstMultiplier,
    agent.asleep === true,
    digesting ? KILL_SATIATION_HUNGER_DECAY_MULTIPLIER : 1,
    nearShelter ? SHELTER_NEEDS_DECAY_MULTIPLIER : 1
  );

  // Hunger and thirst each get their own consecutive-zero-ticks counter and
  // their own grace threshold (`STARVATION_GRACE_TICKS` /
  // `THIRST_STARVATION_GRACE_TICKS`) — a single shared counter can't
  // correctly judge two different thresholds once hunger and thirst can
  // independently cross 0 at different ticks (see `Agent.thirstStarvationTicks`'s
  // doc comment).
  if (world && agent.needs.hunger <= 0) {
    agent.starvationTicks = (agent.starvationTicks ?? 0) + 1;
  } else {
    agent.starvationTicks = 0;
  }
  if (world && agent.needs.thirst <= 0) {
    agent.thirstStarvationTicks = (agent.thirstStarvationTicks ?? 0) + 1;
  } else {
    agent.thirstStarvationTicks = 0;
  }

  if (
    world &&
    ((agent.starvationTicks ?? 0) >= STARVATION_GRACE_TICKS ||
      (agent.thirstStarvationTicks ?? 0) >= THIRST_STARVATION_GRACE_TICKS)
  ) {
    agent.alive = false;
    agent.diedAtTick = world.tick;
    log?.record({
      kind: "starved",
      tick: world.tick,
      agentId: agent.id,
      species: agent.species,
      pos: agent.pos,
      // Ties (both thresholds crossed the same tick) report hunger, matching
      // this codebase's pre-existing convention for a tied cause.
      cause: (agent.starvationTicks ?? 0) >= STARVATION_GRACE_TICKS ? "hunger" : "thirst",
    });
    return;
  }

  applyHealOverTime(agent, (agent.asleep ? SLEEP_HEAL_MULTIPLIER : 1) * (nearShelter ? SHELTER_HEAL_MULTIPLIER : 1));
  if (world) maybeRecoverFromFaint(agent, world, log);
  if (world) grantExp(world, agent, EXP_TRICKLE_PER_TICK, ctx, log, rng);

  // Long-sleep exp bonus (DESIGN.md's "long sleep can give xp" ask) — granted
  // exactly once per sleep session, detected as a threshold crossing right
  // here (both the increment and the grant happen in this same function, so
  // no separate one-shot flag is needed the way `pendingLevelDispersalCheck`
  // needs one for a trigger/consumer split across modules). `sleepTicks`
  // itself resets to 0 on waking (needs.ts's `tickAgentAction` sleep block),
  // so a later nap gets a fresh shot at the bonus rather than being
  // permanently spent.
  if (agent.asleep) {
    const wasBelowThreshold = (agent.sleepTicks ?? 0) < LONG_SLEEP_EXP_TICKS;
    agent.sleepTicks = (agent.sleepTicks ?? 0) + 1;
    if (wasBelowThreshold && agent.sleepTicks >= LONG_SLEEP_EXP_TICKS && world) {
      grantExp(world, agent, LONG_SLEEP_EXP_BONUS, ctx, log, rng);
      log?.record({
        kind: "longSleepBonus",
        tick: world.tick,
        agentId: agent.id,
        species: agent.species,
        pos: agent.pos,
        exp: LONG_SLEEP_EXP_BONUS,
      });
    }
  }
}

/**
 * The part of an agent's tick that only runs on an action tick: survival
 * instincts, behavior choice, movement, mate-seeking, attacks. Needs-seeking
 * routinely crosses layers: a Diglett (home: underground) finds its food on
 * the surface and crosses to get it, then drifts back once satisfied.
 * Crossing itself takes a tick (no position change) so it reads as a
 * discrete, loggable event rather than free teleportation.
 *
 * Survival instincts (flee a nearby predator, hunt nearby prey when hungry)
 * take priority over normal need-seeking when `rules` is provided — see
 * predation.ts. Without rules, agents behave exactly as before predation
 * existed.
 *
 * A fainted agent, or one currently being physically carried by a herd-mate
 * (`beingCarriedBy`), takes NO action-tick behavior at all — no movement,
 * attack, flee, hunt, mate-seeking, or food delivery — per DESIGN.md; it
 * still needs-decays and heals via `tickAgentNeeds` above. Everything else
 * here (carrying an ally, looting, herd food delivery) runs for a normal,
 * conscious agent, ahead of ordinary needs-driven behavior: an in-progress
 * carry gets first refusal (so a threat can still make the carrier drop the
 * ally and flee this same tick, see support.ts's `applyCarrying`), then
 * survival instincts, then starting a new carry/loot/delivery, then the
 * original needs-based behavior choice.
 *
 * Asleep or frozen is the same shape as fainted/beingCarriedBy — no action
 * at all while it lasts (status.ts's `tickStatusEffects` handles counting
 * the affliction itself down, this just blocks acting while it's active).
 * Paralysis doesn't block acting outright; instead it rolls a real chance
 * (`PARALYSIS_SKIP_CHANCE`) to skip *this* action tick, on top of the
 * separate, permanent Speed cut it applies in `actionSpeedOf`
 * (simulation.ts) — mainline's two independent paralysis effects (fewer
 * turns overall, plus a full-lockout chance on the turns you do get),
 * modeled as two independent mechanisms here too rather than one that
 * approximates both.
 */
export function tickAgentAction(
  world: World,
  agent: Agent,
  log?: EventLog,
  rules?: HuntRules,
  ctx?: LevelingContext,
  rng: () => number = Math.random,
  regionDispersal?: RegionDispersalContext
): void {
  if (agent.alive === false) return;
  // Cooldowns tick down once per real action tick this agent gets — its own
  // clock, not the world's (see this function's own doc comment on Speed-
  // driven action economy) — not once per world tick regardless of Speed,
  // which is what this lived as before: a move with `cooldownTicks: 1` was
  // effectively always off-cooldown for anything slower than the action
  // threshold itself, since world ticks pass far more often than a normal
  // agent's own turns. Placed ahead of every early-return below (fainted/
  // carried/asleep/frozen/paralysis-skip) so it still recovers on a tick
  // that ends up doing nothing else, same as it always has.
  tickCooldowns(agent, agent.asleep ? SLEEP_COOLDOWN_TICKS : 1);
  if (agent.fainted) return;
  if (agent.beingCarriedBy) return;
  if (isAsleep(agent) || isFrozen(agent)) return;
  if (isParalyzed(agent) && rng() < PARALYSIS_SKIP_CHANCE) return;
  if ((agent.actionLockTicks ?? 0) > 0) return;

  if (applyCarrying(world, agent, rules, log)) return;
  // `thirstIsUrgent` gates only predation.ts's "give up hunting and wander
  // off" relocate mechanic — flee/fight/hunt-a-visible-target all still take
  // priority as before, and a hungry predator can still start/continue
  // relocating (that's the whole point — it's searching for its next meal).
  // Specifically thirst, not `chooseBehavior`'s general urgency: hunger is
  // what's driving the hunt/relocate in the first place, so gating on "any"
  // urgent need would block the very relocate that's meant to resolve it.
  // Thirst has nothing to do with that goal, and a directionless multi-
  // hundred-tick relocate walk shouldn't march a predator through it the
  // same way natal dispersal used to before its own pause-for-urgent-needs
  // fix — confirmed in a real run: an Onix walked 262 ticks on "relocate"
  // without a single drink and died of thirst mid-search.
  const thirstIsUrgent = 1 - agent.needs.thirst > 0.3;
  if (rules && applyPredationInstincts(world, agent, rules, log, ctx, rng, thirstIsUrgent)) return;
  // Egg-eating (point 5 — "eggs are highly edible... super desired as food
  // by any Pokémon that does not share egg type... given the chance") — a
  // real, opportunistic feeding source checked at the same priority tier as
  // `applyScavenging` right below (both are fallback meals tried once
  // ordinary hunting/fleeing/fighting found nothing to do), deliberately
  // NOT gated on `rules` the way scavenging/hunting are: egg-eating is
  // explicitly wider than the predator/prey `HuntRules` roster — see
  // predation.ts's `applyEggEating` doc comment for why it's a separate
  // mechanism entirely.
  if (applyEggEating(world, agent, ctx, log, rng)) return;
  // Retaliation (herdConflict.ts) — direct follow-up: "there isn't any
  // fighting back, is there?" Checked ahead of scavenging/territorial
  // guarding below (same tier, but a direct response to just having been
  // hit outranks a fresh decision to escalate) — spends `Agent.
  // retaliateAgainstId` the instant it's set, regardless of `rules` gating
  // being met (the function itself re-checks predator exclusion), same
  // "checked here regardless" shape `applyEggEating` right above uses.
  if (applyRivalryRetaliation(world, agent, rules ?? {}, log, rng)) return;
  // A real fallback, not a last resort tacked on after everything else: a
  // hungry predator that had nothing to flee/fight/hunt this tick (solo or
  // pack — see predation.ts) checks for a nearby corpse to feed from
  // directly before falling through to looting/herd-support/ordinary
  // foraging. See support.ts's `applyScavenging` doc comment for why this
  // sits here specifically (right after predation instincts get first
  // refusal, same "survival/feeding instincts before routine behavior"
  // ordering every other step in this function already follows).
  if (rules && applyScavenging(world, agent, rules, log)) return;
  // Territorial guarding (herdConflict.ts) — direct ask: "more territorial
  // behavior. Around guarding resources," refined to proactive patrol/
  // chase-off. Deliberately NOT gated on `needsAreUrgent` below (unlike
  // `applySupportMove`/dispersal) — a hungry/thirsty agent is exactly who
  // this mechanic means to let fight for a foothold rather than just wander
  // off looking elsewhere, direct ask: "incentivize[d] to try to fight and
  // take over resources... if they thought they could win." Sits at the
  // same "survival/feeding instinct" tier as `applyScavenging` right above —
  // after predation/egg-eating already got first refusal, ahead of routine
  // carrying/looting/support/dispersal.
  if (rules && applyTerritorialGuard(world, agent, rules, log, rng, ctx)) return;
  if (maybeStartCarrying(world, agent, log)) return;
  if (applyLooting(world, agent, log)) return;
  // Real confirmed death case: a zero-cooldown ally-buff move (reachable via
  // the skill tree — e.g. Tackle respecced into `steadfast_guard`) plus an
  // adjacent, permanently-in-range herd-mate let `applySupportMove` return
  // true on literally every action tick forever, since it had no urgent-need
  // escape valve of its own — an agent could stand on a water tile rebuffing
  // its neighbor nonstop while its own thirst ran to 0 and then through the
  // full starvation grace period, never once reaching `chooseBehavior` below.
  // Same for `applyHerdSupport`'s multi-tick food-delivery errand: it only
  // checked the deliverer's own needs once, at the moment the errand started,
  // never again during the walk — the exact "commits no matter what" shape
  // dispersal/shelter-building already had to be fixed for. General urgency
  // (not just thirst, unlike `thirstIsUrgent` above) is the right gate here:
  // unlike predation's hunt/relocate, neither of these behaviors exists to
  // resolve the agent's own hunger/thirst, so there's no reason to let either
  // one through just because hunger specifically is what's urgent.
  const needsAreUrgent = chooseBehavior(agent.needs) !== "idle";
  if (!needsAreUrgent && applySupportMove(world, agent, log)) return;
  if (applyHerdSupport(world, agent, log, needsAreUrgent)) return;

  // Natal dispersal (dispersal.ts) — checked once per action tick for every
  // agent not already dispersing, ranked below survival/carrying/looting/
  // herd-support (those get first refusal, same as everything above) but
  // ahead of ordinary needs-driven behavior. Direct instruction: "needs
  // should be able to jump queue in priority, definitely based on urgency" —
  // so an in-progress dispersal is PAUSABLE, the exact same shape
  // shelter-building's own pause-on-urgent-need logic uses just below: it
  // only continues (`applyDispersal`) while `chooseBehavior` still reads
  // `"idle"`, and falls through to ordinary needs-driven behavior for as many
  // ticks as it takes to resolve otherwise, without touching
  // `agent.dispersalTarget` — the walk resumes exactly where it left off once
  // the agent is satisfied again. This replaces an earlier "commits no matter
  // what" version: a real run confirmed agents dying of thirst standing right
  // next to water turned out to be exactly this dispersal side effect
  // (overriding hunger/thirst/mate-seeking for the entire multi-hundred-tick
  // walk), not a crowding or water-scarcity problem — see DESIGN.md's
  // "Urgency-based need priority" section. `maybeTriggerDispersal`'s own
  // trigger conditions (level gate, disposition-weighted roll, no-mates
  // fallback timer) are untouched by this — it's still a no-op whenever
  // `agent.dispersalTarget` is already set, so this never re-triggers a
  // dispersal already in progress.
  if (agent.dispersalTarget) {
    if (chooseBehavior(agent.needs) === "idle") {
      applyDispersal(world, agent, log);
      return;
    }
    // Paused, not abandoned — resumes on a later tick once satisfied again.
  } else {
    maybeTriggerDispersal(world, agent, log, rng, regionDispersal);
    if (agent.dispersalTarget && chooseBehavior(agent.needs) === "idle") {
      applyDispersal(world, agent, log);
      return;
    }
  }

  // Shelter-building (shelter.ts) — deliberately NOT given dispersal's
  // "commits no matter what" priority: a real run at seed 42 confirmed why.
  // With that first design (checked/continued unconditionally, like
  // dispersal), all 4 of the demo scenario's buildsShelter founders
  // (2 Diglett, 2 Sandshrew) either starved mid-build or got caught by a
  // predator while traveling to a build site far from any resource, wiping
  // out the entire underground lineage before tick 170 — every one of them
  // committed to the multi-hundred-tick round trip the instant they first
  // went idle, then never broke off to eat/drink because the check was
  // unconditional. Direct instruction is explicit that this feature should
  // NOT override survival instincts, so an in-progress task pauses (without
  // losing its travel/build progress — `Agent.shelterTarget`/
  // `shelterBuildTicks` are left untouched) the moment a real need becomes
  // urgent, and falls through to ordinary needs-driven behavior for as many
  // ticks as it takes to resolve — the same "checked fresh every tick, drop
  // out the instant something more urgent shows up" shape `applyExploration`
  // already uses below, not dispersal's shape. The trigger itself is gated
  // the same way: only an agent that's currently satisfied goes to start a
  // build in the first place.
  // Also paused (not triggered) while genuinely asleep — a sleeping agent
  // doesn't start or continue any task on its own initiative, matching every
  // other self-directed branch above/below this one. Without this guard, a
  // sleeping agent's shelter-building trigger (now universal — see this
  // block's own doc comment above) could silently hijack its action tick
  // before ever reaching the sleep block just below, skipping the real
  // wake-check machinery entirely (confirmed by a real test: a sleeping
  // agent with full hunger/thirst, once shelter-building applied to every
  // species, started walking to a build site instead of ever being checked
  // for waking).
  if (!agent.asleep && agent.shelterTarget) {
    if (chooseBehavior(agent.needs) === "idle") {
      applyShelterBuilding(world, agent, log);
      return;
    }
    // Paused, not abandoned — resumes on a later tick once satisfied again.
  } else if (!agent.asleep && chooseBehavior(agent.needs) === "idle") {
    maybeTriggerShelterBuilding(world, agent, rng);
    if (agent.shelterTarget) {
      applyShelterBuilding(world, agent, log);
      return;
    }
  }

  // Sleep (needs.ts + predation.ts) — DESIGN.md's "Sleep: a real
  // vulnerable-rest state" section, verbatim ask: "lets add sleeping. make
  // it so it replenishes hp and pp more, but you're sitting duck. sometimes
  // herd protects each other and can wake each other up. hunger and thirst
  // drain is dramatically reduced while sleeping. long sleep can give xp."
  // Same tier as shelter-building/exploration: checked here, after
  // survival/carrying/looting/herd-support/dispersal/shelter all get their
  // existing first-refusal priority above.
  //
  // While asleep, checked fresh every action tick, the same "drop out the
  // instant something wins priority" shape shelter/dispersal use above: two
  // things wake the agent and let it fall through to ordinary behavior THIS
  // SAME tick rather than wasting it — (1) an urgent need
  // (`chooseBehavior(needs) !== "idle"`), sleep never lets an agent starve in
  // its sleep, and (2) a threat within detection range AND an awake,
  // conscious, same-herd watcher close enough to notice and rouse it (the
  // "herd protects each other" ask) — deliberately not a random roll, same
  // "chance emergent from real positioning, not an invented dice roll"
  // approach `applyPredationInstincts`'s own mob-fighting already uses.
  // (Note: `applyPredationInstincts` above already ran THIS tick with
  // `agent.asleep` still true and skipped its self-defense branches — see its
  // doc comment — so a wake here doesn't retroactively grant an in-tick
  // flee/fight reaction; that begins on this agent's next action tick, now
  // that `asleep` reads false. "Falls through to ordinary behavior" here
  // means needs-seeking/exploring resumes immediately, not that the tick is
  // wasted standing still.) Otherwise (safe, or a threat is near with no one
  // to notice) the agent stays asleep and does nothing this tick at all — no
  // movement, no attack, no flee — the "sitting duck" half.
  if (agent.asleep) {
    const urgentNeed = chooseBehavior(agent.needs) !== "idle";
    const threatNearby = rules ? hasNearbyThreat(world, agent, rules) : false;
    const watcherNearby = threatNearby && hasAwakeHerdmateNearby(world, agent);
    if (urgentNeed || watcherNearby) {
      agent.asleep = false;
      agent.sleepTicks = 0;
      log?.record({
        kind: "wokeUp",
        tick: world.tick,
        agentId: agent.id,
        species: agent.species,
        pos: agent.pos,
        reason: urgentNeed ? "urgentNeed" : "threatSpotted",
      });
      // Falls through to ordinary needs-driven behavior below.
    } else {
      return; // Sitting duck: no movement, attack, or flee while genuinely asleep.
    }
  } else if (
    chooseBehavior(agent.needs) === "idle" &&
    agent.needs.energy < ENERGY_SLEEP_THRESHOLD &&
    !(rules && hasNearbyThreat(world, agent, rules))
  ) {
    agent.asleep = true;
    agent.sleepTicks = 0;
    logBehaviorChange(log, world, agent, "sleep");
    agent.behavior = "sleep";
    log?.record({ kind: "fellAsleep", tick: world.tick, agentId: agent.id, species: agent.species, pos: agent.pos });
    return;
  }

  // Real finding from this feature's own real-run validation: gating this
  // on `agent.behavior === "idle"` (checked further below, where that field
  // gets its final value for the tick) badly under-fired — an agent
  // mid-`exploreTarget` walk (which can run for many consecutive ticks)
  // returns out of the branch right below THIS one every single one of
  // those ticks, so it never even reaches that later check despite its
  // needs being perfectly satisfied the whole time. `chooseBehavior`
  // (not the `agent.behavior` label, which can lag a walk in progress) is
  // the real "needs satisfied right now" signal, so this is checked here,
  // before an in-progress exploration walk gets first refusal.
  if (chooseBehavior(agent.needs) === "idle" && maybeUseUtilityMove(world, agent, log, rng)) return;

  // Continue an in-progress exploration walk as long as nothing more urgent
  // has come up since it started (checked fresh, not read from the stale
  // `agent.behavior` — see applyExploration's doc comment on why an urgent
  // need always wins).
  if (agent.exploreTarget) {
    if (chooseBehavior(agent.needs) === "idle") {
      applyExploration(world, agent, log, rng);
      return;
    }
    agent.exploreTarget = undefined;
  }

  markSectorVisited(agent, world, ctx, log, rng);
  // Once an agent has racked up a handful of distinct species, it's very likely seen
  // everything currently in play (the demo roster is ~6 species) — skip the O(agents)
  // nearby-scan entirely past that point rather than re-scanning forever for a trickle
  // that will never fire again. Without this cap, this scan alone turns a long run with
  // an exploding population (see DESIGN.md's Venusaur/Bulbasaur growth findings) into an
  // O(agents^2)-per-tick cost that made even a 5000-tick run impractically slow.
  if ((agent.encounteredSpecies?.length ?? 0) < MAX_TRACKED_SPECIES) {
    for (const other of world.agents) {
      if (other.id === agent.id || other.alive === false) continue;
      if (Math.abs(other.pos.x - agent.pos.x) + Math.abs(other.pos.y - agent.pos.y) > 3) continue;
      markSpeciesEncountered(agent, other.species, world, ctx, log, rng);
    }
  }

  const previousBehavior = agent.behavior;
  agent.behavior = chooseBehavior(agent.needs);

  if (log && agent.behavior !== previousBehavior) {
    log.record({
      kind: "behaviorChanged",
      tick: world.tick,
      agentId: agent.id,
      species: agent.species,
      from: previousBehavior,
      to: agent.behavior,
    });
  }

  if (agent.behavior !== previousBehavior && agent.behavior !== "seekWater" && agent.behavior !== "seekFood") {
    // A different, more urgent need (or none) took over — this
    // seekWater/seekFood episode is over, so its crowded-tile memory
    // shouldn't carry into whatever comes next (or a later, fresh episode
    // of the same behavior). Same "episode ends -> forget" boundary as
    // `deliverTargetId` clearing on arrival/give-up elsewhere in this file.
    agent.blockedResourceTiles = undefined;
    agent.ticksBlockedFromResource = 0;
  }

  if (agent.behavior === "seekMate") {
    applyMateSeeking(world, agent, log, ctx, rng);
    return;
  }

  if (agent.behavior === "seekFood" && tryForageFromWater(world, agent, log, rng)) {
    // Opportunistic incidental graze (algae/krill stand-in) — tried before
    // the shelter cache/real-food-tile search below since it costs nothing
    // to check and, when it fires, needs neither a stockpile nor a
    // reachable food tile to exist at all. See `tryForageFromWater`'s own
    // doc comment for why this only ever helps a water-affiliated species.
    return;
  }

  if (agent.behavior === "seekFood" && maybeFeedFromShelterCache(world, agent, log)) {
    // A real safety net: this agent is genuinely hungry AND already home
    // (or close enough) with something stockpiled — eats from the cache
    // instead of trekking to a live patch. See shelter.ts's doc comment on
    // why this is never a trap: an empty/absent cache just returns false
    // and falls through to the ordinary search below, same tick.
    return;
  }

  if (agent.behavior === "seekWater" || agent.behavior === "seekFood") {
    const terrain = agent.behavior === "seekWater" ? "water" : "food";
    const excluded = agent.blockedResourceTiles ?? [];
    const target =
      agent.behavior === "seekWater"
        ? findReachableWaterTarget(world, agent, excluded)
        : findReachableFoodTarget(world, agent, excluded);

    if (target) {
      agent.ticksWithoutResource = 0;
      if (target.x === agent.pos.x && target.y === agent.pos.y) {
        if (agent.behavior === "seekFood" && yieldsToHigherRankedFeeder(world, agent, tileAt(world, agent.layer, target.x, target.y)?.stock)) {
          // Defers to a higher-ranked, also-hungry herd-mate on this exact
          // tile while the patch is running low — see
          // `yieldsToHigherRankedFeeder`'s doc comment. Stays put, doesn't
          // consume; re-checked fresh next tick.
          return;
        }
        // Standing exactly on the target tile means this agent already got
        // a valid slot (capacity was checked on the step that got it here)
        // — a fresh consume always clears the "this specific tile is
        // crowded" memory for this episode, same as arriving cleanly.
        agent.blockedResourceTiles = undefined;
        agent.ticksBlockedFromResource = 0;
        const need = agent.behavior === "seekWater" ? "thirst" : "hunger";
        const targetTile = agent.behavior === "seekFood" ? tileAt(world, agent.layer, target.x, target.y) : undefined;

        if (agent.behavior === "seekFood") {
          const digThreshold = cropDigThreshold(targetTile, agent.layer);
          if (digThreshold !== undefined) {
            const cropDef = targetTile?.flavor && targetTile.flavor in FOOD_CROPS ? FOOD_CROPS[targetTile.flavor as CropId] : undefined;
            if (cropDef?.nativeLayer === "canopy") {
              // "Canopy foods can also be processed by damage, with higher
              // range giving advantage" — a damage move substitutes for the
              // ordinary dig move, its own `range.max` scaling the burst
              // instead of a flat bonus.
              const harvestMove = (agent.moves ?? []).find((move) => move.power > 0 && move.category !== "status" && !agent.moveCooldowns?.[move.id]);
              if (harvestMove) {
                useMove(agent, harvestMove, world.tick);
                const rangeMax = harvestMove.range?.max ?? 1;
                agent.digTicksAccrued = (agent.digTicksAccrued ?? 0) + CANOPY_HARVEST_MOVE_BASE_BURST + Math.max(0, rangeMax - 1) * CANOPY_HARVEST_RANGE_BONUS_PER_POINT;
              } else {
                agent.digTicksAccrued = (agent.digTicksAccrued ?? 0) + 1;
              }
            } else {
              const digMove = (agent.moves ?? []).find((move) => move.burrow && !agent.moveCooldowns?.[move.id]);
              if (digMove) {
                useMove(agent, digMove, world.tick);
                agent.digTicksAccrued = (agent.digTicksAccrued ?? 0) + DIG_MOVE_BURST_TICKS;
              } else {
                agent.digTicksAccrued = (agent.digTicksAccrued ?? 0) + 1;
              }
            }
            if (agent.digTicksAccrued < digThreshold) return; // still processing — no consume this tick
            agent.digTicksAccrued = undefined; // done — a fresh dig/harvest next time, not a lingering surplus
          }
        }

        consume(agent.needs, agent.behavior, agent.behavior === "seekFood" ? foodNutritionFactor(targetTile) : 1);
        if (agent.behavior === "seekFood") {
          if (targetTile?.stock !== undefined) {
            targetTile.stock = Math.max(0, targetTile.stock - CONSUME_STOCK_AMOUNT);
            recordGrazing(targetTile); // real self-feeding grazing event — see flora.ts's "Grazing scars"
          }
          // Herbs' own real hook (CROPS_DESIGN.md): "the humble remedy" — a
          // short status-immunity grant on eat, well under Safeguard's own
          // 60-tick/herd-radius grant (self-only here, no aura), reusing the
          // exact field/tick-down mechanism Safeguard already established
          // (status.ts's `statusImmuneTicksRemaining`) rather than a second
          // one. Makes the deliberately weak Filler tier a real choice
          // (nutrition vs. a minor status hedge), not just a tier to skip.
          if (targetTile?.flavor === "herbs") {
            agent.statusImmuneTicksRemaining = HERBS_STATUS_IMMUNE_TICKS;
          }
        }
        grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
        log?.record({
          kind: "consumed",
          tick: world.tick,
          agentId: agent.id,
          species: agent.species,
          layer: agent.layer,
          pos: agent.pos,
          need,
        });
      } else if (!canEnterTile(world, agent, agent.layer, target)) {
        // Herd conflict (herdConflict.ts) — a real, sustained standoff over
        // this exact crowded tile (not a fresh block, see
        // `HERD_CONFLICT_MIN_BLOCKED_TICKS`) gets a disposition-weighted
        // chance to escalate into a rivalry fight against whoever's actually
        // occupying it, instead of only ever waiting/relocating. When it
        // fires this tick counts as spent on the fight, same as the ordinary
        // wait/path branches below it's an alternative to; when it doesn't
        // (no eligible rival, on cooldown, predator involved, or the roll
        // just misses), falls straight through to the existing behavior,
        // unchanged.
        if (
          rules &&
          (agent.ticksBlockedFromResource ?? 0) >= HERD_CONFLICT_MIN_BLOCKED_TICKS &&
          applyHerdRivalryConflict(world, agent, rules, target, log, rng)
        ) {
          return;
        }
        // Direct ask: "ai to recognize when it's blocked or unable to get a
        // resource and try to relocate to find a new one." The nearest
        // matching tile exists but is currently at tile capacity
        // (occupancy.ts) — wait nearby for a bounded grace period (real
        // queueing, matching "feeding and drinking has to actually be
        // timed"), rather than instantly bailing on a tile that might free
        // up in a few ticks. `stepAlongPath` is itself capacity-aware, so
        // this still makes whatever progress it safely can toward/near the
        // tile instead of doing nothing during the wait.
        // Same lightweight-counter reasoning as `resourceBlockedFallbackCount`
        // just below: one agent-tick spent actually waiting on a crowded
        // tile (whether or not this is the tick the grace period runs out) —
        // lets real-run validation compare "how much waiting happens" against
        // "how often that waiting actually ends in giving up," per DESIGN.md's
        // "Tile capacity" section (does queueing actually happen, or does
        // everyone just instantly relocate?).
        world.resourceWaitTicks = (world.resourceWaitTicks ?? 0) + 1;
        agent.ticksBlockedFromResource = (agent.ticksBlockedFromResource ?? 0) + 1;
        if (agent.ticksBlockedFromResource >= BLOCKED_RESOURCE_GRACE_TICKS) {
          agent.ticksBlockedFromResource = 0;
          const nextExcluded = [...excluded, target].slice(-MAX_BLOCKED_RESOURCE_MEMORY);
          agent.blockedResourceTiles = nextExcluded;
          // Not a SimEvent: packages/web's `eventText.ts` switches
          // exhaustively over every `SimEvent.kind` and is off-limits this
          // session (a concurrent redesign is in progress there), so a new
          // discriminated event variant here would break its build. A
          // plain counter on `World` (same shape as `resourceVersion`) is
          // the lightweight substitute — real-run validation reads it
          // directly rather than grepping the event log. See DESIGN.md's
          // "Tile capacity" section.
          world.resourceBlockedFallbackCount = (world.resourceBlockedFallbackCount ?? 0) + 1;
        }
        agent.pos = stepAlongPath(world, agent, target);
      } else {
        // Real BFS-backed pathing (pathfinding.ts), not greedy stepToward —
        // this is the confirmed real death case (an Onix got stuck
        // oscillating near a boulder cluster on the way to reachable water,
        // see DESIGN.md/TODO.md), so seekWater/seekFood specifically get
        // routed around obstacle clusters instead of single-step-greedy.
        agent.ticksBlockedFromResource = 0;
        agent.pos = stepAlongPath(world, agent, target);
      }
      return;
    }

    // No un-excluded candidate this tick — either this terrain genuinely
    // doesn't exist/isn't reachable at all, or every nearby tile of it is
    // currently remembered as crowded. Tell those two apart with one
    // unfiltered lookup: if something of this terrain exists at all, KEEP
    // the exclusion memory (don't immediately re-offer a tile just excluded
    // for being crowded — that would turn the grace period into a
    // same-tick round trip) and let the pre-existing
    // `ticksWithoutResource`/`migrate` escape valve below run its own
    // course, exactly as it already does for "nothing reachable at all" —
    // reused rather than inventing a second timeout, so a genuinely urgent
    // need still can't get stuck forever bouncing between a small set of
    // mutually-crowded tiles: it eventually relocates away instead. Only
    // actually forget the exclusion memory once nothing of this terrain
    // exists anywhere nearby at all — that memory would otherwise never get
    // a reason to clear on its own.
    const somethingExistsNearby = findNearestTerrain(world, agent.layer, agent.pos, terrain) !== undefined;
    if (!somethingExistsNearby) {
      agent.blockedResourceTiles = undefined;
    }

    // Threads the same exclusion list a same-layer lookup uses: without
    // this, a crowded surface water tile that's also reachable from
    // underground via `resourceIndex.ts`'s underground->surface water
    // redirect would keep being "found" via the cross-layer check even
    // after the same-layer check just excluded it for being crowded — an
    // agent could ping-pong underground<->surface forever, each hop
    // "discovering" the very tile it just gave up on, without this.
    const crossTo = findLayerWithTerrain(world, agent.layer, agent.pos, terrain, excluded);
    if (crossTo) {
      agent.ticksWithoutResource = 0;
      const from = agent.layer;
      agent.layer = crossTo;
      // Real bug this closes: crossing layers used to keep the agent's (x,
      // y) completely unchanged, relying on Underground/Canopy always being
      // a flat, obstacle-free grid (true) — but the reverse direction
      // (crossing UP to Surface, which is the one that actually happens
      // here, since Underground/Canopy have no water/food of their own) has
      // no such guarantee: the exact same (x, y) on Surface could be the
      // middle of a lake. A non-water-type Diglett/Pidgey landing there was
      // then just as stranded as the spawn-placement bug this session
      // already fixed in worldgen.ts's `findWalkableNear` — same root
      // cause, different code path. Reuses that exact fix: relocate to the
      // nearest tile on the new layer that's actually safe to stand on
      // (walkable AND not deep water for a land agent) before anything else
      // runs. A no-op ring-search on Underground/Canopy (already
      // everywhere-walkable), a real one landing on Surface.
      agent.pos = findWalkableNear(world, crossTo, agent.pos.x, agent.pos.y);
      log?.record({
        kind: "crossedLayer",
        tick: world.tick,
        agentId: agent.id,
        species: agent.species,
        from,
        to: crossTo,
        pos: agent.pos,
      });
      return;
    }

    // Safety valve on top of the one below: reaching this branch AT ALL
    // while `somethingExistsNearby` is true already means every real,
    // currently-known candidate of this terrain is in the exclusion list
    // (otherwise `findNearestTerrain` above would have returned one) — the
    // agent has already spent one real grace period per excluded tile
    // failing to get a slot anywhere nearby, so don't also make it sit
    // through the FULL separate `MIGRATE_AFTER_TICKS` "nothing reachable at
    // all" timeout on top of that before finally relocating. This is what
    // actually prevents the worst case named in DESIGN.md's real-run
    // findings: a small, mutually-crowded local water/food supply
    // shouldn't be able to hold an agent in a wait/exclude loop right up
    // against its own starvation grace period.
    if (somethingExistsNearby) {
      agent.ticksWithoutResource = MIGRATE_AFTER_TICKS;
    }

    // Dig a spring — CROPS_DESIGN.md's water rework, the real last resort
    // once water genuinely doesn't exist anywhere reachable on any layer at
    // all (`!somethingExistsNearby` — the same-layer check above and the
    // cross-layer check just above that both already failed to find even
    // an EXCLUDED candidate). Deliberately NOT triggered just because every
    // known water tile is currently crowded (`somethingExistsNearby` true
    // but every instance excluded) — that's a real, different, temporary
    // situation the existing wait/relocate escape valve below already
    // handles; digging a whole new spring is for when water is genuinely
    // absent, not merely contested. Dig right where it's standing instead
    // of only ever migrating away. Real, multi-tick process cost
    // (SPRING_DIG_TICKS), same accrue-then-complete shape as crop digging,
    // sped up the same way by an off-cooldown `dig` move. Only on real bare
    // ground (`floor`) — never carves through an obstacle or another
    // water/food tile.
    if (!somethingExistsNearby && agent.behavior === "seekWater" && tileAt(world, agent.layer, agent.pos.x, agent.pos.y)?.terrain === "floor") {
      const digMove = (agent.moves ?? []).find((move) => move.burrow && !agent.moveCooldowns?.[move.id]);
      if (digMove) {
        useMove(agent, digMove, world.tick);
        agent.springDigTicksAccrued = (agent.springDigTicksAccrued ?? 0) + DIG_MOVE_BURST_TICKS;
      } else {
        agent.springDigTicksAccrued = (agent.springDigTicksAccrued ?? 0) + 1;
      }
      if (agent.springDigTicksAccrued >= SPRING_DIG_TICKS) {
        setTile(world, agent.layer, agent.pos.x, agent.pos.y, "water", 0);
        agent.springDigTicksAccrued = undefined;
        agent.ticksWithoutResource = 0;
        log?.record({ kind: "terrainChanged", tick: world.tick, layer: agent.layer, pos: agent.pos, from: "floor", to: "water", cause: "dug" });
      }
      return;
    }

    // No layer has the resource at all — this agent isn't starving-immediately
    // (that's the check above), but if this drags on, standing in place forever
    // isn't better than trying somewhere else.
    agent.ticksWithoutResource = (agent.ticksWithoutResource ?? 0) + 1;
    if (agent.ticksWithoutResource >= MIGRATE_AFTER_TICKS) {
      if (migrate(world, agent, log, rng) === "arrived") {
        agent.ticksWithoutResource = 0;
        agent.blockedResourceTiles = undefined; // fresh location, fresh look at what's crowded there
        agent.ticksBlockedFromResource = 0;
      }
    }
    return;
  }

  if (agent.behavior === "idle" && agent.layer !== agent.homeLayer) {
    const from = agent.layer;
    agent.layer = agent.homeLayer;
    log?.record({
      kind: "crossedLayer",
      tick: world.tick,
      agentId: agent.id,
      species: agent.species,
      from,
      to: agent.homeLayer,
      pos: agent.pos,
    });
    return;
  }

  if (agent.behavior === "idle") {
    const drewBack = applyHerdCohesion(world, agent, rules);
    if (!drewBack) {
      // "Incentivize the Pokémon to stay in it": any agent (universal
      // shelter now — see shelter.ts's doc comment) with a known shelter
      // goes home and lingers there instead of wandering off exploring — see
      // shelter.ts's `applyShelterResting`. Only ever a no-op (falls through
      // to ordinary exploration) when this herd has no shelter anywhere
      // findable yet.
      const wentHome = applyShelterResting(world, agent, log);
      if (!wentHome) applyExploration(world, agent, log, rng);
    }
  }
}

/**
 * Convenience wrapper that runs both halves unconditionally — needs decay
 * *and* a full action — for callers that don't go through `tickWorld`'s
 * Speed-gated action economy (direct unit tests, anything that wants "tick
 * this one agent once, fully" without wiring up actionEnergy/stats). Real
 * simulation ticking goes through `tickWorld` (simulation.ts), which calls
 * `tickAgentNeeds` every tick and `tickAgentAction` only on an agent's
 * action tick.
 */
export function tickAgent(
  world: World,
  agent: Agent,
  log?: EventLog,
  rules?: HuntRules,
  ctx?: LevelingContext,
  rng: () => number = Math.random
): void {
  tickAgentNeeds(agent, world, ctx, log, rng);
  tickAgentAction(world, agent, log, rules, ctx, rng);
}
