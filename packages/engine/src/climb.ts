import type { Agent, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";

/**
 * ROADMAP.md M7 Climb — "Multiple cave layers and transitions between
 * them... Done when: you emerge." Direct ask, once the design question got
 * simple again after a scoping tangent: "i think i just want to be able to
 * move to the next level of the cave and shit."
 *
 * Each cave level is a full, independent `World` (see types.ts's `World.
 * below`/`above` doc comment for why — the chained-worlds architecture over
 * widening `Layer`). Crossing is not automatic on stepping onto a stairs
 * tile (same "terrain is just terrain" split as "food" not auto-eating) —
 * the caller (`main.ts`) calls this when the player deliberately uses the
 * stairs, then re-points its own `world` reference to whatever this
 * returns, the same dance it already does for the macro grid's `focusZone`.
 */
export function useStairs(world: World, agent: Agent, log?: EventLog): World | undefined {
  const tile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
  if (tile?.terrain === "stairsDown" && world.below && world.below.stairsUpAt) {
    return crossLevel(world, world.below, agent, world.below.stairsUpAt, "down", log);
  }
  if (tile?.terrain === "stairsUp" && world.above && world.above.stairsDownAt) {
    return crossLevel(world, world.above, agent, world.above.stairsDownAt, "up", log);
  }
  return undefined;
}

function crossLevel(from: World, to: World, agent: Agent, landAt: { x: number; y: number }, direction: "down" | "up", log?: EventLog): World {
  from.agents = from.agents.filter((a) => a !== agent);
  agent.pos = { ...landAt };
  to.agents.push(agent);
  log?.record({
    kind: "crossedCaveLevel",
    tick: to.tick,
    agentId: agent.id,
    species: agent.species,
    fromDepth: from.depth ?? 0,
    toDepth: to.depth ?? 0,
    direction,
  });
  return to;
}

/** True once the agent has actually stepped onto the deepest level's exit tile. See types.ts's `World.exitAt`. */
export function isAtExit(world: World, agent: Agent): boolean {
  return tileAt(world, agent.layer, agent.pos.x, agent.pos.y)?.terrain === "exit";
}

/** Records the win moment once, for narration — call right after `isAtExit` confirms it. */
export function recordEmerged(world: World, agent: Agent, log?: EventLog): void {
  log?.record({ kind: "emerged", tick: world.tick, agentId: agent.id, species: agent.species, depth: world.depth ?? 0 });
}
