import type { Layer, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";

/** Extra sight radius per unit of the observer's own elevation above ground level. */
export const ELEVATION_SIGHT_BONUS = 1.5;

/**
 * Extra *effective* distance added when the tile being looked at grants
 * concealment (a "bush" tile — see `Tile.concealment`) — makes a concealed
 * tile measurably harder to spot from range without blocking sight outright
 * up close. Sim-original design magnitude, not canon.
 */
export const CONCEALMENT_SIGHT_PENALTY = 2;

/**
 * Extra effective distance per unit of elevation the *target* tile sits
 * above the observer — and, symmetrically, a `bonus` (reduced effective
 * distance) per unit it sits below. A second, independent, direction-aware
 * layer on top of the existing rules (own-elevation radius bonus, ridge
 * blocking): "fog thickens looking uphill, thins looking downhill," neither
 * replacing nor duplicating either existing rule. Sim-original design
 * magnitude, not canon — see DESIGN.md.
 */
export const ELEVATION_FOV_ASYMMETRY_PER_UNIT = 0.5;
/**
 * Caps how far the elevation-asymmetry adjustment can push effective
 * distance in either direction, so an extreme height gap isn't an unbounded
 * "always/never visible" — and, just as importantly, bounds how far the
 * scan below needs to pad its bounding box to correctly find a
 * downhill target whose *effective* distance is within radius even though
 * its *raw* distance is not.
 */
const MAX_ELEVATION_FOV_ADJUSTMENT = 4;

/**
 * Flat sight-radius reduction at full darkness (`lightLevel` 0), scaled
 * linearly down to 0 at full daylight (`lightLevel` 1) — see
 * daynight.ts/DESIGN.md's Phase 2. A fourth, independent term layered onto
 * `computeVisible`'s radius calculation exactly like concealment and
 * elevation-asymmetry already are: it shrinks the *radius* itself (same
 * treatment as `ELEVATION_SIGHT_BONUS` extending it), rather than adjusting
 * any one target's effective distance, since darkness makes everything
 * harder to see, not just specific tiles. Sim-original magnitude, not
 * canon: 2.5 tiles at midnight is a real, noticeable bite out of the
 * baseline radii used elsewhere in the sim (3-5), without zeroing FOV out
 * entirely for a stationary, non-elevated observer.
 */
export const NIGHT_FOV_PENALTY = 2.5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function bresenhamLine(from: Vec2, to: Vec2): Vec2[] {
  const points: Vec2[] = [];
  let x0 = from.x;
  let y0 = from.y;
  const dx = Math.abs(to.x - x0);
  const dy = -Math.abs(to.y - y0);
  const sx = x0 < to.x ? 1 : -1;
  const sy = y0 < to.y ? 1 : -1;
  let err = dx + dy;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === to.x && y0 === to.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}

/**
 * A tile is visible if it's within elevation-adjusted range and nothing
 * along the line of sight rises above both endpoints' elevation — i.e. a
 * ridge between two low points blocks the view over it, but doesn't block
 * a view along its own slope. Walls always block, regardless of elevation.
 */
function hasLineOfSight(world: World, layer: Layer, origin: Vec2, target: Vec2, observerElevation: number): boolean {
  const targetTile = tileAt(world, layer, target.x, target.y);
  if (!targetTile) return false;

  const line = bresenhamLine(origin, target);
  const blockingHeight = Math.max(observerElevation, targetTile.elevation);

  for (const point of line) {
    if ((point.x === origin.x && point.y === origin.y) || (point.x === target.x && point.y === target.y)) {
      continue;
    }
    const tile = tileAt(world, layer, point.x, point.y);
    if (!tile || !tile.walkable) return false;
    if (tile.elevation > blockingHeight) return false;
  }
  return true;
}

/**
 * Every tile visible from `origin` within `baseRadius`, extended by the
 * observer's own elevation (`ELEVATION_SIGHT_BONUS`, unchanged) and now also
 * adjusted per-target by two independent effects layered on top of that
 * radius/line-of-sight check, neither of which changes it:
 *  - concealment (`CONCEALMENT_SIGHT_PENALTY`): a bush tile is effectively
 *    farther away than it is.
 *  - elevation asymmetry (`ELEVATION_FOV_ASYMMETRY_PER_UNIT`): a target
 *    tile higher than the observer is effectively farther away; one lower
 *    is effectively closer.
 * Both are folded into one `effectiveDistance` compared against `radius`,
 * ahead of the existing `hasLineOfSight` ridge-blocking check (which still
 * runs unmodified, using raw elevations) — so a tall ridge between two flat
 * points still blocks the view over it exactly as before, and standing on
 * high ground still extends the base radius exactly as before; this only
 * adds a *third*, independent reason a given tile might or might not make
 * the cut.
 *
 * `lightLevel` (daynight.ts's 0..1, defaulting to 1 — full daylight) is a
 * *fourth* independent effect, folded straight into `radius` before any of
 * the above: darkness shrinks the radius itself by up to `NIGHT_FOV_PENALTY`
 * tiles at full darkness, scaling down to no reduction at all at full
 * daylight. Defaulting to 1 (rather than reading a world day/night state
 * automatically) is deliberate — every existing caller/test that doesn't
 * pass this argument keeps seeing exactly the pre-Phase-2 elevation/
 * concealment/ridge behavior, unchanged.
 *
 * `stormPenalty` (weather.ts's Phase 3, defaulting to 0 — no storm) is a
 * *fifth* independent effect, subtracted from `radius` alongside
 * `nightPenalty` rather than folded into the same `lightLevel` scalar — see
 * weather.ts's `stormFovPenalty` doc comment for why night-darkness and
 * storm-darkness are kept as two separate, additive terms rather than one
 * combined "how dark is it" number. Both terms hit the same
 * `Math.max(0, ...)` floor below, so a storm at midnight is darker than
 * either alone but never goes negative — "additive severity, capped at a
 * floor of zero visibility."
 */
export function computeVisible(world: World, layer: Layer, origin: Vec2, baseRadius: number, lightLevel = 1, stormPenalty = 0): Vec2[] {
  const observerElevation = tileAt(world, layer, origin.x, origin.y)?.elevation ?? 0;
  const nightPenalty = NIGHT_FOV_PENALTY * (1 - clamp(lightLevel, 0, 1));
  const radius = Math.max(0, baseRadius + observerElevation * ELEVATION_SIGHT_BONUS - nightPenalty - Math.max(0, stormPenalty));

  // Padded by the max possible downhill *bonus* — a target's raw distance
  // can be up to MAX_ELEVATION_FOV_ADJUSTMENT past `radius` and still end up
  // with an effective distance inside it, so the scan window has to reach
  // that far to find it at all.
  const scanRadius = radius + MAX_ELEVATION_FOV_ADJUSTMENT;
  const visible: Vec2[] = [];
  const minY = Math.max(0, Math.floor(origin.y - scanRadius));
  const maxY = Math.min(world.height - 1, Math.ceil(origin.y + scanRadius));
  const minX = Math.max(0, Math.floor(origin.x - scanRadius));
  const maxX = Math.min(world.width - 1, Math.ceil(origin.x + scanRadius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const rawDistance = Math.hypot(x - origin.x, y - origin.y);
      const targetTile = tileAt(world, layer, x, y);
      const elevationDelta = (targetTile?.elevation ?? 0) - observerElevation;
      const elevationAdjustment = clamp(
        elevationDelta * ELEVATION_FOV_ASYMMETRY_PER_UNIT,
        -MAX_ELEVATION_FOV_ADJUSTMENT,
        MAX_ELEVATION_FOV_ADJUSTMENT
      );
      const effectiveDistance = rawDistance + elevationAdjustment + (targetTile?.concealment ? CONCEALMENT_SIGHT_PENALTY : 0);
      if (effectiveDistance > radius) continue;
      if (hasLineOfSight(world, layer, origin, { x, y }, observerElevation)) {
        visible.push({ x, y });
      }
    }
  }
  return visible;
}

/**
 * Pure walkability check along a straight line between two points — no
 * elevation gating, unlike `hasLineOfSight`. Used by combat.ts's
 * line/cone-shaped moves (via predation.ts) so an obstacle (tree, boulder,
 * wall) blocks a ranged attack's path exactly like it blocks ambient line of
 * sight, without pulling in `hasLineOfSight`'s elevation-ridge logic, which
 * doesn't apply to a flat combat range check.
 */
export function isPathClear(world: World, layer: Layer, from: Vec2, to: Vec2): boolean {
  const line = bresenhamLine(from, to);
  for (const point of line) {
    if ((point.x === from.x && point.y === from.y) || (point.x === to.x && point.y === to.y)) continue;
    const tile = tileAt(world, layer, point.x, point.y);
    if (!tile || !tile.walkable) return false;
  }
  return true;
}
