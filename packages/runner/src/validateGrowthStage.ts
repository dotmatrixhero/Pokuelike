/**
 * Real-run validation for canopy growth-stage rendering (CROPS_DESIGN.md) —
 * confirms a live `tickWorld` run actually carries unripe canopy Apple
 * tiles through real ticks and flips them to real harvestable stock once
 * CANOPY_APPLE_RIPEN_TICKS is reached, not just in an isolated unit test.
 * Usage: `pnpm --filter @pokuelike/runner exec tsx src/validateGrowthStage.ts <ticks>`
 */
import { tickWorld, EventLog, CANOPY_APPLE_RIPEN_TICKS } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? CANOPY_APPLE_RIPEN_TICKS + 500);

const world = createDemoWorld();
const log = new EventLog();

function countCanopyApples() {
  let ripe = 0;
  let unripe = 0;
  for (const tile of world.tiles.canopy) {
    if (tile.terrain !== "food" || tile.flavor !== "apple") continue;
    if ((tile.stock ?? 0) > 0) ripe++;
    else unripe++;
  }
  return { ripe, unripe };
}

const before = countCanopyApples();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}

const after = countCanopyApples();

console.log(
  JSON.stringify(
    {
      ticks,
      canopyApplesAtStart: before,
      canopyApplesAtEnd: after,
      // A real ripening pass should have moved at least some tiles from
      // unripe -> ripe over CANOPY_APPLE_RIPEN_TICKS + margin ticks (some
      // unripe tiles may also have been eaten down once ripe, by real
      // canopy-native foragers, so "ripe count only ever goes up" isn't
      // asserted here — just that real progress happened).
      unripeCountDropped: after.unripe < before.unripe,
    },
    null,
    2
  )
);
