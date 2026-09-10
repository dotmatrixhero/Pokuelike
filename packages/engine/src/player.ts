import type { Agent, PlayerAction, World } from "./types.js";
import { canStepTo } from "./movement.js";

/**
 * The player-controlled agent — ROADMAP.md's M0.
 *
 * The one design decision here is that there is no separate player system.
 * `Agent.controlledBy === "player"` is the whole difference: `tickWorld`
 * skips the behaviour tree for that agent and applies `queuedAction`
 * instead, on the tick its action energy is ready. Needs, action energy,
 * predation, rapport — all unchanged, all real. DESIGN.md: "the player is
 * just another agent to the sim."
 */

/** The player-controlled agent, if this world has one. Linear scan; there is at most one and this is called once per input, not per tick. */
export function findPlayer(world: World): Agent | undefined {
  return world.agents.find((a) => a.controlledBy === "player" && a.alive !== false);
}

/**
 * Applies one queued action to a player-controlled agent. A blocked move
 * (wall, water the species cannot enter, a full tile) is a no-op that still
 * costs the turn — bumping into a wall is not free, same as any roguelike.
 * Returns whether the agent actually moved.
 *
 * Uses `movement.ts`'s `canStepTo` — the exact predicate every sim agent's
 * step goes through — with the player as its own `mover` so tile capacity
 * applies too. Not `canEnterTile` alone: that is occupancy only, and the
 * first draft of this walked through walls.
 */
export function applyPlayerAction(world: World, agent: Agent, action: PlayerAction): boolean {
  if (action.kind === "wait") return false;
  const next = { x: agent.pos.x + action.dx, y: agent.pos.y + action.dy };
  if (!canStepTo(world, agent, agent.layer, next, agent)) return false;
  agent.pos = next;
  return true;
}
