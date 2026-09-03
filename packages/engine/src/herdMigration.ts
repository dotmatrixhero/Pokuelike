import type { Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { herdCentroid, COHESION_DISTANCE } from "./herding.js";
import { foodStockNear, countTerrainNear } from "./resourceIndex.js";
import { findWalkableNear } from "./worldgen.js";

/**
 * Herd-level migration — see DESIGN.md's "Herd-level migration: moving as a
 * group, not wandering individually" section. Deliberately separate from
 * `migration.ts`'s existing single-agent `migrate()` (a predator giving up
 * on a hunting area) — conceptually different triggers and, per DESIGN.md,
 * an explicitly-open question whether they should ever unify. This module
 * owns the shared per-herd state (`World.herdMigrations`/
 * `World.herdScarcityTicks`) and the once-per-tick check that maintains it
 * (`updateHerdMigrations`, called from `simulation.ts`'s `tickWorld`); the
 * actual per-agent movement bias lives in `herding.ts`'s `applyHerdCohesion`,
 * which reads `World.herdMigrations` as its single source of truth so every
 * member (and guardian) of a migrating herd pulls toward the same point
 * rather than each rolling its own.
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
 * A candidate destination must beat the herd's *current* local abundance by
 * at least this much to be worth the walk — otherwise sustained scarcity
 * would trigger a pointless relocation to an equally-poor spot. This also
 * correctly makes the underground/canopy herds (no food/water tiles exist
 * on those layers at all, per worldgen.ts's Surface-only scope) never
 * migrate: every candidate scores exactly 0, same as "home," so nothing
 * ever clears the improvement bar — the right outcome (nowhere better to
 * walk to), not a bug.
 */
const MIN_IMPROVEMENT = 1;

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Combined food-stock + water-count abundance score around `pos` — the same measure drives both scarcity detection and destination scoring. */
function abundanceAt(world: World, layer: Layer, pos: Vec2, radius: number): number {
  return foodStockNear(world, layer, pos, radius) + WATER_WEIGHT * countTerrainNear(world, layer, pos, "water", radius);
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

/**
 * Samples candidate points at increasing distance from `from` (8 compass
 * directions x `CANDIDATE_DISTANCES`), scores each by local resource
 * abundance, and returns the best one — provided it clearly beats `from`'s
 * own score by `MIN_IMPROVEMENT`. This is the "resource-aware, not a blind
 * random point" destination selection DESIGN.md asks for, contrasted with
 * `migration.ts`'s existing single-agent `migrate()`.
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
 */
export function pickDestination(world: World, layer: Layer, from: Vec2): Vec2 | undefined {
  const currentScore = abundanceAt(world, layer, from, SAMPLE_RADIUS);
  let best: Vec2 | undefined;
  let bestScore = currentScore + MIN_IMPROVEMENT;

  for (const dist of CANDIDATE_DISTANCES) {
    for (const dir of CANDIDATE_DIRECTIONS) {
      const raw = { x: Math.round(from.x + dir.x * dist), y: Math.round(from.y + dir.y * dist) };
      if (raw.x < 0 || raw.y < 0 || raw.x >= world.width || raw.y >= world.height) continue;

      const candidate = findWalkableNear(world, layer, raw.x, raw.y);
      const score = abundanceAt(world, layer, candidate, SAMPLE_RADIUS);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * Once per world tick (not once per agent — a herd-level check computed a
 * single time per herd, called from `simulation.ts`'s `tickWorld`),
 * maintains every herd's migration state:
 *
 * - An **active** migration clears on arrival (centroid within
 *   `ARRIVAL_DISTANCE` of the target) or timeout (`MIGRATION_TIMEOUT_TICKS`
 *   without arriving), logging a `herdSettled` event either way, and resets
 *   that herd's scarcity counter so a fresh sustained-scarcity window is
 *   needed before migrating again.
 * - A herd with **no** active migration has its local abundance sampled
 *   around its live centroid; consecutive scarce ticks accumulate in
 *   `World.herdScarcityTicks`, and crossing `SCARCITY_SUSTAIN_TICKS`
 *   attempts a destination search. The counter resets either way once that
 *   attempt happens (success or not) — bounding retries to roughly once per
 *   sustain window instead of re-running the (cheap, but not free) search
 *   every single tick while still scarce.
 */
export function updateHerdMigrations(world: World, log?: EventLog): void {
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
        log?.record({
          kind: "herdSettled",
          tick: world.tick,
          herdId,
          pos: centroid,
          outcome: arrived ? "arrived" : "gaveUp",
        });
      }
      continue; // an already-migrating herd doesn't also re-run scarcity detection this tick
    }

    const abundance = abundanceAt(world, layer, centroid, SAMPLE_RADIUS);
    world.herdScarcityTicks ??= {};
    if (abundance < SCARCITY_SCORE_THRESHOLD) {
      world.herdScarcityTicks[herdId] = (world.herdScarcityTicks[herdId] ?? 0) + 1;
    } else {
      world.herdScarcityTicks[herdId] = 0;
    }

    if (world.herdScarcityTicks[herdId] >= SCARCITY_SUSTAIN_TICKS) {
      world.herdScarcityTicks[herdId] = 0;
      const destination = pickDestination(world, layer, centroid);
      if (destination) {
        world.herdMigrations ??= {};
        const reason = "food scarcity";
        world.herdMigrations[herdId] = { target: destination, reason, startedTick: world.tick };
        log?.record({ kind: "herdMigrating", tick: world.tick, herdId, from: centroid, to: destination, reason });
      }
      // No qualifying candidate found (e.g. an underground/canopy herd with
      // nothing anywhere to walk toward) — stays put, counter already reset
      // above, will simply re-accumulate and try again later.
    }
  }
}
