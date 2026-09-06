/**
 * Real-run validation for the water rework's "dig a spring" mechanic —
 * confirms a live tickWorld run actually produces both the digging
 * behavior AND real new water tiles created by it (a "dug" terrainChanged
 * event), not just in an isolated unit test. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateDigASpring.ts <ticks>`
 */
import { tickWorld, EventLog } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);

const world = createDemoWorld();
const log = new EventLog();

let ticksWithAnySpringDigging = 0;
let maxSpringDigTicksSeenAtOnce = 0;

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

  let anyDigging = false;
  for (const agent of world.agents) {
    if (agent.alive === false || agent.isEgg) continue;
    if (agent.springDigTicksAccrued) {
      anyDigging = true;
      if (agent.springDigTicksAccrued > maxSpringDigTicksSeenAtOnce) maxSpringDigTicksSeenAtOnce = agent.springDigTicksAccrued;
    }
  }
  if (anyDigging) ticksWithAnySpringDigging++;
}

const dugSprings = log.events.filter((e) => e.kind === "terrainChanged" && e.cause === "dug");

console.log(
  JSON.stringify(
    {
      ticks,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      ticksWithAnySpringDigging,
      maxSpringDigTicksSeenAtOnce,
      realSpringsDug: dugSprings.length,
      dugSpringLocations: dugSprings.slice(0, 10).map((e) => (e.kind === "terrainChanged" ? e.pos : undefined)),
    },
    null,
    2
  )
);
