import type { Layer, MigrationReason, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { herdCentroid, COHESION_DISTANCE } from "./herding.js";
import { foodStockNear, countTerrainNear } from "./resourceIndex.js";
import { findWalkableNear, biomeWeightsAt } from "./worldgen.js";
import { activeWeatherAt, hasCoverNearby } from "./weather.js";
import { LEADERSHIP_DISPOSITION_BLEND_WEIGHT } from "./herdLeadership.js";

/**
 * Herd-level migration — see DESIGN.md's "Herd-level migration: moving as a
 * group, not wandering individually" section, and its Phase 1 follow-up
 * ("Dynamics that move a content herd: extra migration triggers, day/night,
 * spatial weather") which generalized this from a scarcity-only system to
 * four trigger reasons (`MigrationReason`, types.ts): `"scarcity"` (the
 * original trigger, renamed from the old ad hoc `"food scarcity"` string
 * now that it's a real discriminated value), `"predator_pressure"`,
 * `"wanderlust"`, and `"territorial"`. All four reuse the exact same
 * shared-state/destination-selection/cohesion-bias pipeline — this module
 * is about adding trigger *evaluators* on top of that pipeline, not
 * building a parallel one. Deliberately separate from `migration.ts`'s
 * existing single-agent `migrate()` (a predator giving up on a hunting
 * area) — conceptually different triggers and, per DESIGN.md, an
 * explicitly-open question whether they should ever unify. This module
 * owns the shared per-herd state (`World.herdMigrations`/
 * `World.herdScarcityTicks`/`World.herdPredatorPressure`/
 * `World.herdTerritorialTicks`) and the once-per-tick check that maintains
 * it (`updateHerdMigrations`, called from `simulation.ts`'s `tickWorld`);
 * the actual per-agent movement bias lives in `herding.ts`'s
 * `applyHerdCohesion`, which reads `World.herdMigrations` as its single
 * source of truth so every member (and guardian) of a migrating herd pulls
 * toward the same point rather than each rolling its own.
 *
 * **Trigger precedence** (documented once, here, rather than re-derived at
 * each call site): per tick, a herd with no *active* migration is checked
 * in this order — `scarcity`, then `predator_pressure` (both
 * survival-critical, so checked first; the relative order between these two
 * is an arbitrary tie-break, not a meaningful priority claim), then
 * `weather` (Phase 3 — also survival-relevant, sustained storm exposure
 * without cover, but slotted after the two original survival triggers
 * rather than reordering them, since DESIGN.md never asked for a real
 * priority claim between the three), then `territorial`, then `wanderlust`
 * (both "soft" triggers, per DESIGN.md either order is fine). The first one
 * that fires this tick wins and the rest are skipped for that herd this
 * tick. A herd that's already actively migrating never has ANY of these
 * checks run against it at all — see the early `continue` below — so
 * nothing ever preempts an in-progress migration, regardless of reason.
 * That's a deliberate, simpler-than-asked reading of "don't let a new
 * trigger interrupt one in progress unless clearly higher priority": rather
 * than modeling a priority ordering for interruption too, Phase 1 just
 * never interrupts, full stop. A migration always runs to arrival or
 * timeout before the herd can be re-triggered.
 */

/**
 * Local food/water sampling radius for both scarcity detection and
 * destination scoring — reuses `herding.ts`'s own "how far counts as local"
 * answer (`COHESION_DISTANCE`) rather than inventing a second, possibly-
 * inconsistent number for a closely related idea.
 */
const SAMPLE_RADIUS = COHESION_DISTANCE;

/**
 * Sim-original tuning guess, like every other magic number in this
 * codebase — judge against a real run, not canon. A herd's combined local
 * food-stock-sum + water-tile-count score below this counts as "scarce this
 * tick." `flora.ts`'s per-tile `stock` tops out at 1, so a handful of
 * healthy patches within `SAMPLE_RADIUS` easily clears this; a genuinely
 * depleted or barren range (Badlands-leaning, or simply eaten out) doesn't.
 */
export const SCARCITY_SCORE_THRESHOLD = 1.5;
/**
 * How much one nearby water tile counts toward the combined abundance score,
 * relative to food stock (0..1 per tile). Water doesn't deplete the way food
 * does, so a flat per-tile weight (rather than trying to model "how much"
 * water is available) is enough.
 */
const WATER_WEIGHT = 1;
/**
 * Consecutive scarce ticks required before a herd actually migrates — not a
 * single bad tick, per DESIGN.md's explicit ask to avoid reacting to
 * ordinary regrowth/depletion noise (`flora.ts`'s food patches naturally
 * die and regrow on ~100-tick and ~20-tick cycles respectively —
 * `FOOD_LIFESPAN_TICKS`/`MATURATION_TICKS`). 150 ticks rides out a single
 * patch's death-to-replacement gap comfortably while still being reachable
 * within a several-thousand-tick real run.
 */
export const SCARCITY_SUSTAIN_TICKS = 150;
/** Herd centroid within this of the target counts as "arrived" — reuses the same cohesion-distance idea as "close enough to the group." */
export const ARRIVAL_DISTANCE = COHESION_DISTANCE;
/**
 * Give up and clear the migration if it hasn't arrived within this many
 * ticks — mirrors `migration.ts`'s own give-up pattern (that one just
 * never sets a distance/time bound explicitly, relying on the caller to
 * retry; this bounds it directly since an un-arriving herd would otherwise
 * migrate forever toward an unreachable/no-longer-relevant point).
 */
export const MIGRATION_TIMEOUT_TICKS = 2000;
/** Candidate destinations are probed this many tiles out from the centroid, in each of `CANDIDATE_DIRECTIONS`. */
const CANDIDATE_DISTANCES = [15, 25, 40];
const CANDIDATE_DIRECTIONS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];
/**
 * A candidate destination must beat the herd's *current* combined score
 * (abundance, plus `awayBonus` when scoring predator-pressure/territorial)
 * by at least this much to be worth the walk — otherwise sustained scarcity
 * would trigger a pointless relocation to an equally-poor spot. For
 * `scarcity` specifically (no `awayFrom`, so the score is pure abundance),
 * this correctly makes underground/canopy herds (no food/water tiles exist
 * on those layers at all, per worldgen.ts's Surface-only scope) never
 * migrate for that reason: every candidate scores exactly 0, same as
 * "home," so nothing ever clears the improvement bar — the right outcome
 * (nowhere better to walk to), not a bug. `predator_pressure`/`territorial`
 * don't share that exemption — `awayBonus` is pure distance, not resources,
 * so an underground/canopy herd under real predator pressure or territorial
 * crowding can still relocate purely to get away, even with nothing to
 * forage at either end. `wanderlust` bypasses this scoring machinery
 * entirely (see `pickWanderDestination`), so it's unaffected either way.
 */
const MIN_IMPROVEMENT = 1;
/**
 * Weight applied to a candidate's distance from the relevant threat
 * position (the predator's last known spot for `predator_pressure`, the
 * rival herd's centroid for `territorial`) when scoring destinations for
 * those two reasons — see `awayBonus`. Chosen so it's meaningful but doesn't
 * swamp resource-richness: `abundanceAt` scores rarely exceed the
 * high single digits (a few nearby full-stock food tiles plus water), while
 * candidate distances can be 40+ tiles out — at this weight, walking 40
 * tiles farther from the threat is worth +2, comparable to a couple of
 * healthy food tiles, not an automatic override of resource scoring.
 */
const AWAY_WEIGHT = 0.05;

/**
 * Weight applied to a candidate's forest-biome blend weight (0..1, from
 * worldgen.ts's `biomeWeightsAt`) when scoring destinations for the
 * `"weather"` trigger — see `pickDestination`'s `preferCover` parameter.
 * Picked so a candidate sitting squarely in a Forest-dominant blend (weight
 * near 1) is worth about +6, comparable to several healthy food tiles
 * (`abundanceAt` scores rarely exceed the high single digits) — a real pull
 * toward good cover, not an automatic override of resource-richness, same
 * tuning philosophy as `AWAY_WEIGHT`. A world with no `World.biomeSeeds`
 * (hand-built test worlds, a bare `createWorld`) scores every candidate's
 * forest weight at 0 — see worldgen.ts's `biomeWeightsAt` — so this term
 * simply doesn't contribute anywhere biome data doesn't exist, rather than
 * guessing.
 */
const COVER_WEIGHT = 6;

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Combined food-stock + water-count abundance score around `pos` — the same measure drives both scarcity detection and destination scoring. */
function abundanceAt(world: World, layer: Layer, pos: Vec2, radius: number): number {
  return foodStockNear(world, layer, pos, radius) + WATER_WEIGHT * countTerrainNear(world, layer, pos, "water", radius);
}

/** Extra score for being far from `awayFrom` (undefined for scarcity/wanderlust, which have no threat position to flee) — see `AWAY_WEIGHT`. */
function awayBonus(pos: Vec2, awayFrom: Vec2 | undefined): number {
  return awayFrom ? AWAY_WEIGHT * manhattan(pos, awayFrom) : 0;
}

/**
 * Extra score for a candidate's forest-biome blend strength, only when
 * `preferCover` is set (the `"weather"` trigger — see `tryWeatherTrigger`).
 * Deliberately reads real biome data (`worldgen.ts`'s `biomeWeightsAt`)
 * rather than a tile-level tree/bush scan the way `hasCoverNearby`
 * (weather.ts) does for the *exposure check* — picking a destination
 * *region* is exactly the kind of "which neighborhood is this" question
 * biome blending answers well, whereas "am I sheltered right here, right
 * now" is a literal tile-level fact. Two different questions, two
 * deliberately different (documented) data sources — see weather.ts's
 * `hasCoverNearby` doc comment for the other half of this distinction.
 */
function coverBonus(world: World, pos: Vec2, preferCover: boolean): number {
  if (!preferCover) return 0;
  return COVER_WEIGHT * (biomeWeightsAt(world.biomeSeeds, pos.x, pos.y).forest ?? 0);
}

/**
 * The layer a herd actually lives/forages on. Every herd in the demo
 * scenario is single-layer (a member briefly crossing layers for a resource
 * is the exception, not the rule — see needs.ts), so the first living
 * member's `homeLayer` is a fine stand-in for "the herd's layer" without
 * needing a richer per-herd concept that nothing yet requires.
 */
function herdLayer(world: World, herdId: string): Layer | undefined {
  return world.agents.find((agent) => agent.alive !== false && agent.herdId === herdId)?.homeLayer;
}

/** The herd's species — same "first living member stands in for the herd" reasoning as `herdLayer`. Every herd in the demo scenario is single-species. */
function herdSpecies(world: World, herdId: string): string | undefined {
  return world.agents.find((agent) => agent.alive !== false && agent.herdId === herdId)?.species;
}

/** Number of living members in the herd — used to decide which of two territorially-clashing herds gets displaced (the smaller one). */
function herdSize(world: World, herdId: string): number {
  return world.agents.filter((agent) => agent.alive !== false && !agent.isEgg && agent.herdId === herdId).length;
}

/**
 * Samples candidate points at increasing distance from `from` (8 compass
 * directions x `CANDIDATE_DISTANCES`), scores each by local resource
 * abundance plus (when `awayFrom` is given) a bonus for distance from that
 * point, and returns the best one — provided it clearly beats `from`'s own
 * score by `MIN_IMPROVEMENT`. This is the "resource-aware, not a blind
 * random point" destination selection DESIGN.md asks for scarcity, extended
 * per Phase 1 with an "and ideally away from the threat/rival" term for
 * `predator_pressure`/`territorial` — contrasted with `migration.ts`'s
 * existing single-agent `migrate()` and with `pickWanderDestination` below
 * (wanderlust's destination doesn't need to score better at all).
 *
 * Deliberately a direct resource-density scan via resourceIndex.ts rather
 * than a biome-aware lookup through worldgen.ts's `BIOMES`/`blendBiomeParams`
 * — DESIGN.md left that choice open, and scoring actual nearby food/water
 * tiles is both simpler and more directly tied to "is this genuinely a
 * better spot to live" than reasoning about which biome a candidate blends
 * toward (a Forest-leaning tile with unlucky noise rolls can still be
 * foodless; scanning the real tiles avoids that mismatch entirely). Reuses
 * `worldgen.ts`'s `findWalkableNear` (already-solved "land on an actually
 * walkable tile" search) rather than a second implementation.
 *
 * `preferCover` (Phase 3's `"weather"` trigger — see `tryWeatherTrigger`)
 * adds `coverBonus`'s forest-biome-blend term on top of the same abundance
 * score, the same "additional scoring term, not a parallel scoring
 * function" pattern `awayFrom` already established for
 * `predator_pressure`/`territorial`. Unlike `awayFrom`, `preferCover`
 * doesn't need a reference point — it's "toward good cover in general," not
 * "away from one specific place" — so candidates are scored purely on
 * abundance + cover strength, no distance-from-anything term.
 */
export function pickDestination(world: World, layer: Layer, from: Vec2, awayFrom?: Vec2, preferCover = false): Vec2 | undefined {
  const currentScore = abundanceAt(world, layer, from, SAMPLE_RADIUS) + awayBonus(from, awayFrom) + coverBonus(world, from, preferCover);
  let best: Vec2 | undefined;
  let bestScore = currentScore + MIN_IMPROVEMENT;

  for (const dist of CANDIDATE_DISTANCES) {
    for (const dir of CANDIDATE_DIRECTIONS) {
      const raw = { x: Math.round(from.x + dir.x * dist), y: Math.round(from.y + dir.y * dist) };
      if (raw.x < 0 || raw.y < 0 || raw.x >= world.width || raw.y >= world.height) continue;

      const candidate = findWalkableNear(world, layer, raw.x, raw.y);
      const score =
        abundanceAt(world, layer, candidate, SAMPLE_RADIUS) + awayBonus(candidate, awayFrom) + coverBonus(world, candidate, preferCover);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * Wanderlust's destination pick — deliberately NOT resource-scored at all,
 * per DESIGN.md: "doesn't need to be better, just different." Picks one of
 * the same 8 compass directions at a moderate `CANDIDATE_DISTANCES[1]`
 * (25 tiles — far enough to read as a real relocation, not a single-step
 * shuffle) and lands on the nearest walkable tile there. This is also why
 * wanderlust is the one trigger that still works for underground/canopy
 * herds even though they have no food/water tiles to score at all (see
 * `MIN_IMPROVEMENT`'s doc comment) — an occasional aimless wander doesn't
 * need resources to justify it.
 */
function pickWanderDestination(world: World, layer: Layer, from: Vec2, rng: () => number): Vec2 | undefined {
  const dir = CANDIDATE_DIRECTIONS[Math.floor(rng() * CANDIDATE_DIRECTIONS.length)]!;
  const dist = CANDIDATE_DISTANCES[1]!;
  const raw = { x: Math.round(from.x + dir.x * dist), y: Math.round(from.y + dir.y * dist) };
  if (raw.x < 0 || raw.y < 0 || raw.x >= world.width || raw.y >= world.height) return undefined;
  return findWalkableNear(world, layer, raw.x, raw.y);
}

/**
 * How many ticks of "no qualifying hunt/fight event" before a herd's
 * predator-pressure window is considered stale and restarts from zero
 * rather than keeping stacking onto old events — see
 * `recordPredatorPressure`. Same number as `PREDATOR_PRESSURE_THRESHOLD`'s
 * doc: a real "last 300 ticks" rolling window, approximated cheaply (see
 * below) rather than literally maintaining a timestamped event deque.
 */
export const PREDATOR_PRESSURE_WINDOW_TICKS = 300;
/**
 * Hunt/fight/kill events landed against a herd's members within one
 * `PREDATOR_PRESSURE_WINDOW_TICKS` window before it's "sustained pressure,"
 * not a single skirmish. Sim-original tuning guess: a herd being fought
 * over ~5+ times inside 300 ticks is a real, ongoing predation problem, not
 * one unlucky encounter (which this threshold is specifically meant not to
 * fire on — see the "isolated hit" test).
 */
export const PREDATOR_PRESSURE_THRESHOLD = 5;

/**
 * Call from predation.ts at the moment a hunt/fight event actually lands
 * against `defenderHerdId` (i.e. right where the `fought` event is logged)
 * — this is the "running counter updated at the event-emission site" this
 * module uses instead of scanning `EventLog` for hunt/fight/kill events
 * every tick per herd. A full-log scan would be O(events) per herd per
 * tick, growing without bound over a long run; this is O(1) per event,
 * paid only when a fight actually happens.
 *
 * Approximates a real "last `PREDATOR_PRESSURE_WINDOW_TICKS` ticks" rolling
 * window without maintaining a timestamped event deque: if the previous
 * event in this window was more than `PREDATOR_PRESSURE_WINDOW_TICKS` ticks
 * ago, the count restarts at 1 (a fresh window) instead of accumulating
 * across a long-dormant gap; otherwise it just increments. This slightly
 * over-counts relative to a literal sliding window (a burst of hits at the
 * very start of a window stays "in window" slightly past
 * `PREDATOR_PRESSURE_WINDOW_TICKS` ticks after the last of them), which is
 * fine for a threshold this coarse and much cheaper than exact windowing.
 */
export function recordPredatorPressure(world: World, herdId: string | undefined, threatPos: Vec2): void {
  if (!herdId) return;
  world.herdPredatorPressure ??= {};
  const existing = world.herdPredatorPressure[herdId];
  if (!existing || world.tick - existing.windowStart > PREDATOR_PRESSURE_WINDOW_TICKS) {
    world.herdPredatorPressure[herdId] = { count: 1, windowStart: world.tick, lastThreatPos: threatPos };
  } else {
    existing.count += 1;
    existing.lastThreatPos = threatPos;
  }
}

/**
 * Base unscaled per-tick-per-herd wanderlust roll — the actual chance a herd
 * rolls each tick is this times `wanderlustChance`'s disposition multiplier
 * (never below `WANDERLUST_MIN_MULTIPLIER`, so this is a floor value, not
 * the typical one). Picked, together with the multiplier below, so a
 * *neutral* (0.5/0.5) herd's real per-tick chance comes out to
 * `WANDERLUST_BASE_CHANCE * 1.5` = 1/2000 — "1-in-several-thousand" per
 * DESIGN.md, reading as occasional restlessness over a multi-thousand-tick
 * run (roughly 5 times per 10,000 ticks at neutral disposition) rather than
 * constant churn. See `wanderlustChance` for the full formula.
 */
export const WANDERLUST_BASE_CHANCE = 1 / 3000;
/**
 * How much a herd's average boldness+sociability (0..1, see
 * `herdWanderlustFactor`) multiplies `WANDERLUST_BASE_CHANCE` by:
 * `max(WANDERLUST_MIN_MULTIPLIER, factor * WANDERLUST_DISPOSITION_SCALE)`.
 * At neutral (factor 0.5) that's 1.5x; at fully bold+social (factor 1.0)
 * it's 3x; at fully timid+solitary (factor 0.0) the floor
 * (`WANDERLUST_MIN_MULTIPLIER`) kicks in at 0.25x rather than zero — even a
 * cautious herd wanders *occasionally*, just markedly less than a
 * bold/social one. Sim-original tuning guess, not canon.
 */
const WANDERLUST_DISPOSITION_SCALE = 3;
const WANDERLUST_MIN_MULTIPLIER = 0.25;

/**
 * Average boldness+sociability (each 0..1) across a herd's living members —
 * the simplest reasonable aggregation for "how restless is this herd as a
 * whole," rather than e.g. weighting by any one standout individual.
 * Members without a `disposition` (hand-built fixtures) read as neutral
 * (0.5/0.5), matching every other disposition-consuming site in this
 * codebase (predation.ts, reproduction.ts).
 *
 * **Herd Leadership decision (see DESIGN.md's "Herd Leadership" section):**
 * unlike the six per-INDIVIDUAL disposition consumers (predation.ts,
 * herdConflict.ts, dispersal.ts, reproduction.ts), which each swap a plain
 * `agent.disposition` read for `effectiveDisposition(world, agent)`, this
 * function already computes a herd-wide AGGREGATE, so there's no single
 * "this agent's own disposition" to blend per-member. Instead, once the
 * plain unweighted average above is computed, it's nudged the rest of the
 * way toward the herd's current leader's own raw disposition by the exact
 * same `LEADERSHIP_DISPOSITION_BLEND_WEIGHT` used everywhere else — reusing
 * one blend weight/mechanism rather than inventing a second, differently-
 * tuned "how much does the herd average lean on its leader" constant purely
 * for this one site. A leaderless herd (or a herd whose leader's own
 * disposition is absent) falls through unchanged to the plain average,
 * exactly as before this feature. This directly extends "their herd sorta
 * changes to follow their behaviors" to migration timing too, not just the
 * six individual-level thresholds: a bold, restless leader measurably
 * shifts how eagerly its WHOLE herd decides to relocate, on top of shifting
 * each member's own flee/hunt/mob-fight calls individually.
 */
function herdWanderlustFactor(world: World, herdId: string): number {
  const members = world.agents.filter((agent) => agent.alive !== false && !agent.isEgg && agent.herdId === herdId);
  if (members.length === 0) return 0.5;
  const sum = members.reduce((total, agent) => total + (agent.disposition?.boldness ?? 0.5) + (agent.disposition?.sociability ?? 0.5), 0);
  const average = sum / (members.length * 2);

  const leaderId = world.herdLeaders?.[herdId];
  const leader = leaderId ? world.agents.find((a) => a.id === leaderId) : undefined;
  if (!leader?.disposition) return average;
  const leaderFactor = (leader.disposition.boldness + leader.disposition.sociability) / 2;
  return average + (leaderFactor - average) * LEADERSHIP_DISPOSITION_BLEND_WEIGHT;
}

function wanderlustChance(world: World, herdId: string): number {
  const factor = herdWanderlustFactor(world, herdId); // 0..1
  const multiplier = Math.max(WANDERLUST_MIN_MULTIPLIER, factor * WANDERLUST_DISPOSITION_SCALE);
  return WANDERLUST_BASE_CHANCE * multiplier;
}

/**
 * Two same-species herds' centroids within this of each other count as
 * "territorially clashing" this tick — `2x COHESION_DISTANCE`, per
 * DESIGN.md, wide enough that it's "sharing the same neighborhood," not
 * literally standing on top of each other.
 */
export const TERRITORIAL_DISTANCE = 2 * COHESION_DISTANCE;
/**
 * Consecutive ticks two same-species herds must stay within
 * `TERRITORIAL_DISTANCE` before the smaller one is displaced — mirrors
 * `SCARCITY_SUSTAIN_TICKS`'s "sustained, not a single overlap" pattern
 * exactly (same number, same reasoning: rides out ordinary foraging
 * overlap without over-triggering on a momentary pass-by).
 */
export const TERRITORIAL_SUSTAIN_TICKS = 150;

/** Canonical (order-independent) key for a herd pair, so `World.herdTerritorialTicks` counts a pair once regardless of iteration order. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Once per world tick (not once per agent — a herd-level check computed a
 * single time per herd, called from `simulation.ts`'s `tickWorld`),
 * maintains every herd's migration state. See this module's top-of-file
 * comment for the full trigger-precedence rule; in short:
 *
 * - An **active** migration clears on arrival (centroid within
 *   `ARRIVAL_DISTANCE` of the target) or timeout (`MIGRATION_TIMEOUT_TICKS`
 *   without arriving), logging a `herdSettled` event either way, and resets
 *   every trigger's sustained-condition counter for that herd so a fresh
 *   sustained window is needed before migrating again. A migrating herd
 *   skips every trigger check below entirely (see the early `continue`) —
 *   nothing interrupts a migration already in progress.
 * - A herd with **no** active migration is checked in priority order:
 *   `scarcity` (local abundance below threshold, sustained
 *   `SCARCITY_SUSTAIN_TICKS`) → `predator_pressure`
 *   (`World.herdPredatorPressure` past `PREDATOR_PRESSURE_THRESHOLD` within
 *   its window) → `weather` (Phase 3 — centroid inside an active storm cell
 *   with no cover nearby, sustained `STORM_EXPOSURE_SUSTAIN_TICKS`) →
 *   `territorial` (centroid within `TERRITORIAL_DISTANCE` of a
 *   same-species herd's, sustained `TERRITORIAL_SUSTAIN_TICKS`, and this is
 *   the smaller of the two) → `wanderlust` (a flat per-tick chance, scaled
 *   by disposition, no bad condition required). The first one that fires
 *   wins; the rest aren't even evaluated that tick for that herd.
 */
export function updateHerdMigrations(world: World, log?: EventLog, rng: () => number = Math.random): void {
  const herdIds = new Set<string>();
  for (const agent of world.agents) {
    if (agent.alive !== false && agent.herdId) herdIds.add(agent.herdId);
  }

  for (const herdId of herdIds) {
    const layer = herdLayer(world, herdId);
    if (!layer) continue;
    const centroid = herdCentroid(world, herdId, layer);
    if (!centroid) continue;

    const active = world.herdMigrations?.[herdId];
    if (active) {
      const arrived = manhattan(centroid, active.target) <= ARRIVAL_DISTANCE;
      const timedOut = world.tick - active.startedTick >= MIGRATION_TIMEOUT_TICKS;
      if (arrived || timedOut) {
        delete world.herdMigrations![herdId];
        if (world.herdScarcityTicks) world.herdScarcityTicks[herdId] = 0;
        if (world.herdPredatorPressure) delete world.herdPredatorPressure[herdId];
        if (world.herdStormExposureTicks) world.herdStormExposureTicks[herdId] = 0;
        log?.record({
          kind: "herdSettled",
          tick: world.tick,
          herdId,
          pos: centroid,
          outcome: arrived ? "arrived" : "gaveUp",
        });
      }
      continue; // an already-migrating herd doesn't also re-run trigger detection this tick
    }

    if (tryScarcityTrigger(world, log, herdId, layer, centroid)) continue;
    if (tryPredatorPressureTrigger(world, log, herdId, layer, centroid)) continue;
    if (tryWeatherTrigger(world, log, herdId, layer, centroid)) continue;
    if (tryTerritorialTrigger(world, log, herdId, layer, centroid, herdIds)) continue;
    tryWanderlustTrigger(world, log, herdId, layer, centroid, rng);
  }
}

function startMigration(world: World, log: EventLog | undefined, herdId: string, from: Vec2, to: Vec2, reason: MigrationReason): void {
  world.herdMigrations ??= {};
  world.herdMigrations[herdId] = { target: to, reason, startedTick: world.tick };
  log?.record({ kind: "herdMigrating", tick: world.tick, herdId, from, to, reason });
}

/** Highest-priority trigger: sustained local food/water scarcity. Unchanged from Phase 0 apart from the `reason` value (`"scarcity"`, not the old ad hoc `"food scarcity"` string). */
function tryScarcityTrigger(world: World, log: EventLog | undefined, herdId: string, layer: Layer, centroid: Vec2): boolean {
  const abundance = abundanceAt(world, layer, centroid, SAMPLE_RADIUS);
  world.herdScarcityTicks ??= {};
  if (abundance < SCARCITY_SCORE_THRESHOLD) {
    world.herdScarcityTicks[herdId] = (world.herdScarcityTicks[herdId] ?? 0) + 1;
  } else {
    world.herdScarcityTicks[herdId] = 0;
  }

  if (world.herdScarcityTicks[herdId] < SCARCITY_SUSTAIN_TICKS) return false;

  world.herdScarcityTicks[herdId] = 0;
  const destination = pickDestination(world, layer, centroid);
  if (!destination) return false; // e.g. an underground/canopy herd with nothing anywhere to walk toward — stays put, will retry later
  startMigration(world, log, herdId, centroid, destination, "scarcity");
  return true;
}

/** Second-priority trigger: sustained hunt/fight pressure from a predator. */
function tryPredatorPressureTrigger(world: World, log: EventLog | undefined, herdId: string, layer: Layer, centroid: Vec2): boolean {
  const pressure = world.herdPredatorPressure?.[herdId];
  if (!pressure || pressure.count < PREDATOR_PRESSURE_THRESHOLD) return false;

  const destination = pickDestination(world, layer, centroid, pressure.lastThreatPos);
  delete world.herdPredatorPressure![herdId]; // consumed either way — a fresh window has to build back up before this can trigger again
  if (!destination) return false;
  startMigration(world, log, herdId, centroid, destination, "predator_pressure");
  return true;
}

/**
 * Consecutive ticks a herd's centroid must sit inside an active storm cell
 * with no forest/canopy cover nearby before it migrates — same "sustained,
 * not a single bad tick" reasoning as `SCARCITY_SUSTAIN_TICKS`, picked
 * somewhat shorter (100 vs. 150) since being caught exposed in a storm reads
 * as more urgent than ordinary food scarcity. Sim-original tuning guess,
 * judge against a real run like everything else here.
 */
export const STORM_EXPOSURE_SUSTAIN_TICKS = 100;

/**
 * Third-priority trigger (Phase 3): the herd's centroid is inside an active
 * storm cell (weather.ts) with no forest/canopy cover within
 * `hasCoverNearby`'s local scan radius, sustained for
 * `STORM_EXPOSURE_SUSTAIN_TICKS`. A single herd-centroid check, not a
 * per-member exposure tally — DESIGN.md left "per-herd or per-agent" open
 * and explicitly asked for whatever's cleanest to feed the shared
 * herd-migration trigger; a per-herd aggregate reuses the exact same
 * sustained-counter/reset-on-recovery shape as `tryScarcityTrigger` and
 * `tryTerritorialTrigger` rather than inventing a second bookkeeping
 * pattern for per-agent tallies that would need aggregating back up to the
 * herd level anyway. `World.herdStormExposureTicks` mirrors
 * `herdScarcityTicks` exactly, resets are conservative — losing cover, the
 * storm moving off, or an already-settled/timed-out migration (see
 * `updateHerdMigrations`) all zero it, so a herd doesn't migrate on stale
 * exposure from an earlier storm. Destination scoring uses `preferCover`
 * (see `pickDestination`) instead of `awayFrom` — there's no single "threat
 * position" to flee, just a general pull toward better shelter.
 */
function tryWeatherTrigger(world: World, log: EventLog | undefined, herdId: string, layer: Layer, centroid: Vec2): boolean {
  world.herdStormExposureTicks ??= {};
  if (layer !== "surface") {
    // Weather is a Surface-only system (see weather.ts's top-of-file
    // comment) — an underground/canopy herd is never exposed, so its
    // counter never even starts accumulating.
    world.herdStormExposureTicks[herdId] = 0;
    return false;
  }

  const cell = activeWeatherAt(world, centroid);
  const exposed = cell?.type === "storm" && !hasCoverNearby(world, layer, centroid);
  world.herdStormExposureTicks[herdId] = exposed ? (world.herdStormExposureTicks[herdId] ?? 0) + 1 : 0;

  if (world.herdStormExposureTicks[herdId] < STORM_EXPOSURE_SUSTAIN_TICKS) return false;

  world.herdStormExposureTicks[herdId] = 0;
  const destination = pickDestination(world, layer, centroid, undefined, true);
  if (!destination) return false;
  startMigration(world, log, herdId, centroid, destination, "weather");
  return true;
}

/** Fourth-priority (soft) trigger: another same-species herd crowding this one's territory for too long. */
function tryTerritorialTrigger(
  world: World,
  log: EventLog | undefined,
  herdId: string,
  layer: Layer,
  centroid: Vec2,
  allHerdIds: Set<string>
): boolean {
  const species = herdSpecies(world, herdId);
  if (!species) return false;

  let rivalId: string | undefined;
  let rivalCentroid: Vec2 | undefined;
  for (const otherId of allHerdIds) {
    if (otherId === herdId) continue;
    if (herdSpecies(world, otherId) !== species) continue;
    const otherCentroid = herdCentroid(world, otherId, layer);
    if (!otherCentroid) continue;
    if (manhattan(centroid, otherCentroid) <= TERRITORIAL_DISTANCE) {
      rivalId = otherId;
      rivalCentroid = otherCentroid;
      break; // first same-species clash found this tick is enough — herds this close are rare per-tick, no need to pick "the closest"
    }
  }

  world.herdTerritorialTicks ??= {};
  if (!rivalId || !rivalCentroid) {
    // Not currently clashing with anyone — clear every pair counter this herd is party to, mirroring scarcity's "reset on recovery."
    for (const key of Object.keys(world.herdTerritorialTicks)) {
      if (key.startsWith(`${herdId}|`) || key.endsWith(`|${herdId}`)) delete world.herdTerritorialTicks[key];
    }
    return false;
  }

  const key = pairKey(herdId, rivalId);
  world.herdTerritorialTicks[key] = (world.herdTerritorialTicks[key] ?? 0) + 1;
  if (world.herdTerritorialTicks[key] < TERRITORIAL_SUSTAIN_TICKS) return false;

  // Only the smaller herd gets displaced — the larger one holds its ground. Both herds run this
  // function independently, so only the smaller one's own check should actually start a migration;
  // a tie (equal size) arbitrarily favors this herd's own id sorting first, same tie-break spirit as `pairKey`.
  const mySize = herdSize(world, herdId);
  const rivalSize = herdSize(world, rivalId);
  const isSmaller = mySize < rivalSize || (mySize === rivalSize && herdId < rivalId);
  if (!isSmaller) return false;

  delete world.herdTerritorialTicks[key];
  const destination = pickDestination(world, layer, centroid, rivalCentroid);
  if (!destination) return false;
  startMigration(world, log, herdId, centroid, destination, "territorial");
  return true;
}

/** Lowest-priority (soft) trigger: unconditioned restlessness. */
function tryWanderlustTrigger(world: World, log: EventLog | undefined, herdId: string, layer: Layer, centroid: Vec2, rng: () => number): boolean {
  if (rng() >= wanderlustChance(world, herdId)) return false;
  const destination = pickWanderDestination(world, layer, centroid, rng);
  if (!destination) return false;
  startMigration(world, log, herdId, centroid, destination, "wanderlust");
  return true;
}
