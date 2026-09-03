import type { Layer, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";

function candidatesToward(pos: Vec2, dx: number, dy: number): Vec2[] {
  return [
    { x: pos.x + dx, y: pos.y + dy },
    { x: pos.x + dx, y: pos.y },
    { x: pos.x, y: pos.y + dy },
  ];
}

function firstWalkable(world: World, layer: Layer, pos: Vec2, candidates: Vec2[]): Vec2 {
  for (const candidate of candidates) {
    if (candidate.x === pos.x && candidate.y === pos.y) continue;
    if (tileAt(world, layer, candidate.x, candidate.y)?.walkable) return candidate;
  }
  return pos;
}

/** Moves one step toward `target` using simple Manhattan stepping. */
export function stepToward(world: World, layer: Layer, pos: Vec2, target: Vec2): Vec2 {
  const dx = Math.sign(target.x - pos.x);
  const dy = Math.sign(target.y - pos.y);
  return firstWalkable(world, layer, pos, candidatesToward(pos, dx, dy));
}

/** Moves one step directly away from `threat`, deterministically tie-broken when already aligned. */
export function stepAway(world: World, layer: Layer, pos: Vec2, threat: Vec2): Vec2 {
  const dx = Math.sign(pos.x - threat.x) || 1;
  const dy = Math.sign(pos.y - threat.y) || 1;
  return firstWalkable(world, layer, pos, candidatesToward(pos, dx, dy));
}
