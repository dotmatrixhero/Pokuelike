import type { Agent, Layer, Vec2, World } from "./types.js";
import type { ForcedMovement } from "./moves.js";
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

/**
 * Applies a move's `ForcedMovement` effect (moves.ts) — displaces whichever
 * of `attacker`/`defender` is `forced.mover` by `forced.tiles`, one
 * obstacle-aware step at a time (`stepToward`/`stepAway`, same as an
 * agent's own ordinary flee/hunt stepping), toward or away from the other
 * party. Called from `resolveHit` (predation.ts), both before a hit
 * resolves (a lunge) and after a landed one (drag/knockback/retreat) — see
 * `ForcedMovement.timing`'s own doc comment for which is which. A blocked
 * step (obstacle, edge of map) simply doesn't move that tile, same as any
 * other stepToward/stepAway call — forced movement never teleports through
 * something it can't walk through.
 */
export function applyForcedMovement(world: World, forced: ForcedMovement, attacker: Agent, defender: Agent): void {
  const mover = forced.mover === "attacker" ? attacker : defender;
  const other = forced.mover === "attacker" ? defender : attacker;
  for (let i = 0; i < forced.tiles; i++) {
    mover.pos = forced.direction === "closer" ? stepToward(world, mover.layer, mover.pos, other.pos) : stepAway(world, mover.layer, mover.pos, other.pos);
  }
}
