import type { Layer, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";

/** Extra sight radius per unit of the observer's own elevation above ground level. */
export const ELEVATION_SIGHT_BONUS = 1.5;

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

/** Every tile visible from `origin` within `baseRadius`, extended by the observer's own elevation. */
export function computeVisible(world: World, layer: Layer, origin: Vec2, baseRadius: number): Vec2[] {
  const observerElevation = tileAt(world, layer, origin.x, origin.y)?.elevation ?? 0;
  const radius = baseRadius + observerElevation * ELEVATION_SIGHT_BONUS;

  const visible: Vec2[] = [];
  const minY = Math.max(0, Math.floor(origin.y - radius));
  const maxY = Math.min(world.height - 1, Math.ceil(origin.y + radius));
  const minX = Math.max(0, Math.floor(origin.x - radius));
  const maxX = Math.min(world.width - 1, Math.ceil(origin.x + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (Math.hypot(x - origin.x, y - origin.y) > radius) continue;
      if (hasLineOfSight(world, layer, origin, { x, y }, observerElevation)) {
        visible.push({ x, y });
      }
    }
  }
  return visible;
}
