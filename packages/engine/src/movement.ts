import type { Agent, Layer, Vec2, World } from "./types.js";
import type { ForcedMovement } from "./moves.js";
import { tileAt } from "./world.js";
import { isImmovable } from "./status.js";
import { canEnterTile } from "./occupancy.js";
import { canEnterWater } from "./waterBody.js";

function candidatesToward(pos: Vec2, dx: number, dy: number): Vec2[] {
  return [
    { x: pos.x + dx, y: pos.y + dy },
    { x: pos.x + dx, y: pos.y },
    { x: pos.x, y: pos.y + dy },
  ];
}

/**
 * `agent` is the one actually being moved — REQUIRED (unlike `mover` below)
 * because it gates `waterBody.ts`'s `canEnterWater`, a hard physical
 * constraint (direct ask: "non water Pokemon can't move across large
 * bodies of water") that must never be silently skippable the way the soft
 * capacity gate is. Every real call site has a real `Agent` in scope (it's
 * the thing whose `.pos` is being reassigned), so this costs real call
 * sites nothing; only synthetic bare-position unit tests need to pass a
 * placeholder `Agent`, which is a fine, one-time cost for closing off a
 * whole class of "forgot to wire the water check" bugs by construction.
 *
 * `mover`, when given, ADDITIONALLY gates a candidate on tile capacity
 * (`occupancy.ts`'s `canEnterTile`) — a tile at capacity is "blocked for
 * entry" for movement purposes without being a terrain/walkability change
 * (direct ask: general crowding, every step, not just resource-seeking).
 * Optional and defaulted-away, unlike `agent`: a real, measured finding
 * (see `pathfinding.ts`'s `stepTowardMovingTarget` doc comment) is that
 * gating hunt/mate pursuit on tile capacity misreads ordinary herd density
 * as "unreachable" and tanks births — those call sites deliberately omit
 * `mover` to stay capacity-blind while still passing `agent` for the water
 * check, which is exactly the split this second parameter exists to allow.
 */
function firstWalkable(world: World, layer: Layer, pos: Vec2, candidates: Vec2[], agent: Agent, mover?: Agent, avoid?: Vec2): Vec2 {
  for (const candidate of candidates) {
    if (candidate.x === pos.x && candidate.y === pos.y) continue;
    if (avoid && candidate.x === avoid.x && candidate.y === avoid.y) continue;
    if (!tileAt(world, layer, candidate.x, candidate.y)?.walkable) continue;
    if (!canEnterWater(world, agent, layer, candidate)) continue;
    if (mover && !canEnterTile(world, mover, layer, candidate)) continue;
    return candidate;
  }
  return pos;
}

/**
 * Moves one step toward `target` using simple Manhattan stepping. `agent`
 * (required — see `firstWalkable`'s doc comment) gates the step on the
 * hard water-crossing constraint; `mover`, if given, ADDITIONALLY makes the
 * step capacity-aware (see `firstWalkable`).
 *
 * `stopAdjacent`, when true, never lands exactly on `target`'s own tile —
 * direct ask: "two units in combat should never share the same tile."
 * `candidatesToward`'s first (diagonal) candidate is the one that can equal
 * `target` exactly (when already diagonally adjacent, Manhattan distance 2);
 * excluding it here falls through to an orthogonal candidate instead, which
 * lands *next to* the target rather than on it. Opt-in and defaulted off:
 * most `stepToward` callers (seeking a food/water/shelter tile, migrating to
 * a destination) genuinely want to arrive exactly on `target`, so this only
 * applies where a caller explicitly asks for "approach, don't occupy."
 */
export function stepToward(world: World, layer: Layer, pos: Vec2, target: Vec2, agent: Agent, mover?: Agent, stopAdjacent?: boolean): Vec2 {
  const dx = Math.sign(target.x - pos.x);
  const dy = Math.sign(target.y - pos.y);
  return firstWalkable(world, layer, pos, candidatesToward(pos, dx, dy), agent, mover, stopAdjacent ? target : undefined);
}

/**
 * Moves one step directly away from `threat`, deterministically tie-broken
 * when already aligned. `agent` (required — see `firstWalkable`'s doc
 * comment) gates the step on the hard water-crossing constraint; `mover`,
 * if given, ADDITIONALLY makes the step capacity-aware (see `firstWalkable`).
 */
export function stepAway(world: World, layer: Layer, pos: Vec2, threat: Vec2, agent: Agent, mover?: Agent): Vec2 {
  const dx = Math.sign(pos.x - threat.x) || 1;
  const dy = Math.sign(pos.y - threat.y) || 1;
  return firstWalkable(world, layer, pos, candidatesToward(pos, dx, dy), agent, mover);
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
  // The "Immovable" passive (status.ts's `isImmovable`) plants an agent in
  // place against any drag/knockback/lunge/retreat that would displace it —
  // it does nothing to stop the *other* party's own forced movement.
  if (isImmovable(mover)) return;
  // Deliberately capacity-BLIND, matching this session's real-run finding
  // for `stepTowardMovingTarget` (pathfinding.ts): a combat knockback/lunge
  // is a momentary displacement, not "taking a stand" on a tile, and this
  // codebase's capacity gate is specifically about a tile you're standing on
  // and consuming from — see occupancy.ts's/needs.ts's doc comments.
  for (let i = 0; i < forced.tiles; i++) {
    // "closer" (a lunge) passes `stopAdjacent` — a forced pull/lunge is
    // still combat, so it shouldn't be able to drag the mover onto the
    // other party's exact tile either. "away" can't land on `other` in the
    // first place (it's moving away from it), so no equivalent guard needed.
    mover.pos =
      forced.direction === "closer" ? stepToward(world, mover.layer, mover.pos, other.pos, mover, undefined, true) : stepAway(world, mover.layer, mover.pos, other.pos, mover);
  }
}
