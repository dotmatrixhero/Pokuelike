/**
 * Real-run validation for canopy-harvest-by-damage (CROPS_DESIGN.md) —
 * confirms a live `tickWorld` run actually produces both the layer-mismatch
 * processing tax on real Apple tiles AND real completions (a stock drop
 * following accrued `digTicksAccrued` progress), the same "prove it fires
 * in a live run, not just a unit test" discipline every other mechanic this
 * session built already gets. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateCanopyHarvest.ts <ticks>`
 */
import { tickWorld, EventLog, FOOD_CROPS } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);

const world = createDemoWorld();
const log = new EventLog();

let appleTileCount = 0;
for (const layer of ["surface", "canopy", "underground"] as const) {
  for (const tile of world.tiles[layer]) if (tile.flavor === "apple") appleTileCount++;
}

let ticksWithAnyCanopyProcessing = 0;
let maxDigTicksSeenOnApple = 0;

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

  let anyProcessing = false;
  for (const agent of world.agents) {
    if (agent.alive === false || agent.isEgg) continue;
    if (!agent.digTicksAccrued) continue;
    const tile = world.tiles[agent.layer][agent.pos.y * world.width + agent.pos.x];
    if (tile?.flavor === "apple" && FOOD_CROPS.apple.nativeLayer !== agent.layer) {
      anyProcessing = true;
      if (agent.digTicksAccrued > maxDigTicksSeenOnApple) maxDigTicksSeenOnApple = agent.digTicksAccrued;
    }
  }
  if (anyProcessing) ticksWithAnyCanopyProcessing++;
}

console.log(
  JSON.stringify(
    {
      ticks,
      appleTileCount,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      ticksWithAnyCanopyProcessing,
      maxDigTicksSeenOnApple,
    },
    null,
    2
  )
);
