import type { Agent, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { logBehaviorChange } from "./events.js";
import { stepToward } from "./movement.js";
import { tileAt } from "./world.js";

const MIN_RELOCATE_DISTANCE = 8;
const RELOCATE_ATTEMPTS = 10;

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function findRandomWalkableTile(world: World, layer: Layer, from: Vec2, rng: () => number = Math.random): Vec2 | undefined {
  for (let i = 0; i < RELOCATE_ATTEMPTS; i++) {
    const candidate = { x: Math.floor(rng() * world.width), y: Math.floor(rng() * world.height) };
    if (manhattan(candidate, from) < MIN_RELOCATE_DISTANCE) continue;
    if (tileAt(world, layer, candidate.x, candidate.y)?.walkable) return candidate;
  }
  return undefined;
}

/**
 * Shared by any agent giving up on its current area — a predator that can't
 * find safe prey (predation.ts), or any agent that can't find food/water
 * anywhere reachable (needs.ts). Picks a random distant point once and
 * walks it down over however many ticks it takes; the caller decides what
 * "arrived" means for its own bookkeeping (resetting a failure counter,
 * etc).
 */
export function migrate(world: World, agent: Agent, log?: EventLog, rng: () => number = Math.random): "arrived" | "traveling" | "stuck" {
  if (!agent.relocateTarget) {
    agent.relocateTarget = findRandomWalkableTile(world, agent.layer, agent.pos, rng);
    if (!agent.relocateTarget) return "stuck";
  }

  logBehaviorChange(log, world, agent, "relocate");
  agent.behavior = "relocate";

  if (manhattan(agent.pos, agent.relocateTarget) <= 1) {
    agent.pos = agent.relocateTarget;
    agent.relocateTarget = undefined;
    return "arrived";
  }

  agent.pos = stepToward(world, agent.layer, agent.pos, agent.relocateTarget);
  return "traveling";
}
