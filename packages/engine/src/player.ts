import type { Agent, PlayerAction, World } from "./types.js";
import { canStepTo } from "./movement.js";
import { consume } from "./needs.js";
import { tileAt } from "./world.js";
import { CONSUME_STOCK_AMOUNT, foodNutritionFactor, recordGrazing } from "./flora.js";
import { EXP_ON_CONSUME, grantExp, type LevelingContext } from "./leveling.js";
import type { EventLog } from "./events.js";

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
 * Returns whether the action did what it set out to do (moved, ate, drank);
 * the same answer is left on `agent.lastActionOutcome` for the UI, since
 * this runs inside `tickWorld` where the caller cannot see the return.
 *
 * Moves use `movement.ts`'s `canStepTo` — the exact predicate every sim
 * agent's step goes through — with the player as its own `mover` so tile
 * capacity applies too. Not `canEnterTile` alone: that is occupancy only,
 * and the first draft of this walked through walls.
 *
 * Eat and drink (ROADMAP.md M3) go through the same `consume` the
 * behaviour tree's seekFood/seekWater arrive at, with the same stock
 * depletion, grazing scar, exp and `consumed` event — the sim does not know
 * a human ate rather than a Sandshrew.
 */
export function applyPlayerAction(
  world: World,
  agent: Agent,
  action: PlayerAction,
  log?: EventLog,
  ctx?: LevelingContext,
  rng: () => number = world.rng,
): boolean {
  const ok = apply(world, agent, action, log, ctx, rng);
  agent.lastActionOutcome = { action, ok, tick: world.tick };
  return ok;
}

function apply(world: World, agent: Agent, action: PlayerAction, log: EventLog | undefined, ctx: LevelingContext | undefined, rng: () => number): boolean {
  switch (action.kind) {
    case "wait":
      return false;
    case "move": {
      const next = { x: agent.pos.x + action.dx, y: agent.pos.y + action.dy };
      if (!canStepTo(world, agent, agent.layer, next, agent)) return false;
      agent.pos = next;
      return true;
    }
    case "eat": {
      const tile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
      if (!tile || tile.terrain !== "food" || (tile.stock ?? 0) <= 0) return false;
      consume(agent.needs, "seekFood", foodNutritionFactor(tile));
      tile.stock = Math.max(0, (tile.stock ?? 0) - CONSUME_STOCK_AMOUNT);
      recordGrazing(tile);
      grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
      log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "hunger" });
      return true;
    }
    case "drink": {
      if (!waterWithinReach(world, agent)) return false;
      consume(agent.needs, "seekWater");
      grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
      log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "thirst" });
      return true;
    }
  }
}

/** Water on the player's own tile or any of the eight around it — you kneel at the edge; you do not have to wade in. */
export function waterWithinReach(world: World, agent: Agent): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tileAt(world, agent.layer, agent.pos.x + dx, agent.pos.y + dy)?.terrain === "water") return true;
    }
  }
  return false;
}

/** Whether the tile under the player is food with anything left on it. */
export function foodUnderfoot(world: World, agent: Agent): boolean {
  const tile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
  return tile?.terrain === "food" && (tile.stock ?? 0) > 0;
}
