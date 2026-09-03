import type { World } from "./types.js";
import type { EventLog } from "./events.js";
import { tickAgent } from "./needs.js";

/** Advances the whole world by one tick. Shared by the browser app and the headless runner. */
export function tickWorld(world: World, log?: EventLog): void {
  world.tick += 1;
  for (const agent of world.agents) {
    tickAgent(world, agent, log);
  }
}
