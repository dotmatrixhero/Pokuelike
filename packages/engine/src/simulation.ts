import type { HuntRules, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tickAgent } from "./needs.js";
import { growFlora, maybeDropSeed } from "./flora.js";

/**
 * Advances the whole world by one tick. Shared by the browser app and the
 * headless runner. Agents killed this tick (see predation.ts) are pruned
 * from World.agents afterward, so a kill's own tick still sees the victim.
 * A newborn (see reproduction.ts) pushed mid-loop may itself get ticked
 * once more in the same call, since array iteration picks up appended
 * elements — harmless, just means a same-tick newborn can already be at
 * age 1 by the time this returns.
 */
export function tickWorld(world: World, log?: EventLog, rules?: HuntRules): void {
  world.tick += 1;
  for (const agent of world.agents) {
    const before = { x: agent.pos.x, y: agent.pos.y };
    const beforeLayer = agent.layer;
    tickAgent(world, agent, log, rules);
    if (agent.alive !== false && agent.layer === beforeLayer && (agent.pos.x !== before.x || agent.pos.y !== before.y)) {
      maybeDropSeed(world, agent.layer, agent.pos, log);
    }
  }
  growFlora(world, log);
  if (world.agents.some((agent) => agent.alive === false)) {
    world.agents = world.agents.filter((agent) => agent.alive !== false);
  }
}
