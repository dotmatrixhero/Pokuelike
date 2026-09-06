/**
 * Real-run validation for layer-gated crop access + digging — confirms a
 * real live tickWorld run actually produces real digging behavior (agents
 * accruing digTicksAccrued while standing on a layer-mismatched Potato/
 * Pumpkin tile), not just in an isolated unit test. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateDigging.ts <ticks>`
 */
import { tickWorld, EventLog } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);

const world = createDemoWorld();
const log = new EventLog();

let maxDigTicksSeenAtOnce = 0;
let ticksWithAnyAgentDigging = 0;
let digCompletions = 0; // digTicksAccrued going from a real positive value back to undefined
const wasDigging = new Set<string>();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

  let anyDigging = false;
  for (const agent of world.agents) {
    if (agent.alive === false || agent.isEgg) continue;
    if (agent.digTicksAccrued) {
      anyDigging = true;
      wasDigging.add(agent.id);
      if (agent.digTicksAccrued > maxDigTicksSeenAtOnce) maxDigTicksSeenAtOnce = agent.digTicksAccrued;
    } else if (wasDigging.has(agent.id)) {
      digCompletions++;
      wasDigging.delete(agent.id);
    }
  }
  if (anyDigging) ticksWithAnyAgentDigging++;
}

console.log(
  JSON.stringify(
    {
      ticks,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      ticksWithAnyAgentDigging,
      maxDigTicksSeenAtOnce,
      realDigCompletions: digCompletions,
    },
    null,
    2
  )
);
