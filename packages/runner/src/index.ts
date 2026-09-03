import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES } from "@pokuelike/data";
import { formatEvent, summarize } from "./format.js";

const ticks = Number(process.argv[2] ?? 500);

const world = createDemoWorld();
const log = new EventLog();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES);
}

for (const event of log.events) {
  console.log(formatEvent(event));
}

console.log("");
console.log(`Ran ${ticks} ticks.`);
console.log(summarize(log.events));
