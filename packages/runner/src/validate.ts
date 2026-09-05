/**
 * A lightweight population/egg-cycle validation script — used to produce
 * the real headless-run numbers in DESIGN.md's "Bonding, shelter, and eggs"
 * section without printing the full per-event log `index.ts` does (which
 * gets impractically slow to eyeball past a few thousand ticks). Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validate.ts <seed> <ticks>`.
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const seed = Number(process.argv[2] ?? 42);
const ticks = Number(process.argv[3] ?? 6000);

const world = createDemoWorld(seed);
const log = new EventLog();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}

const alive = world.agents.filter((a) => a.alive !== false && !a.isEgg);
const eggsAlive = world.agents.filter((a) => a.isEgg && a.alive !== false);
const counts: Record<string, number> = {};
for (const e of log.events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;

console.log(JSON.stringify({
  seed,
  ticks,
  finalPopulation: alive.length,
  eggsCurrentlyIncubating: eggsAlive.length,
  bondsFormed: world.bondsFormed ?? 0,
  eggsLaid: world.eggsLaid ?? 0,
  eggsHatched: world.eggsHatched ?? 0,
  eggsEaten: world.eggsEaten ?? 0,
  eventCounts: {
    bonded: counts.bonded ?? 0,
    eggLaid: counts.eggLaid ?? 0,
    eggHatched: counts.eggHatched ?? 0,
    eggEaten: counts.eggEaten ?? 0,
    eggDefended: counts.eggDefended ?? 0,
    shelterBuilt: counts.shelterBuilt ?? 0,
    killed: counts.killed ?? 0,
    starved: counts.starved ?? 0,
    diedOfAge: counts.diedOfAge ?? 0,
    immigrated: counts.immigrated ?? 0,
  },
}, null, 2));
