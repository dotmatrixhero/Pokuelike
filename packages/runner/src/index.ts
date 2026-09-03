import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT } from "@pokuelike/data";
import { formatEvent, summarize } from "./format.js";
import { captureFrame, frameToAnsi } from "./ascii.js";

const ticks = Number(process.argv[2] ?? 500);
// Comma-separated list of ticks to snapshot as ASCII frames, e.g. "0,100,500".
const snapshotTicks = new Set(
  (process.argv[3] ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
);

const world = createDemoWorld();
const log = new EventLog();
const frames: string[] = [];

if (snapshotTicks.has(0)) {
  frames.push(`--- tick 0 ---\n${frameToAnsi(captureFrame(world))}`);
}

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT);
  if (snapshotTicks.has(world.tick)) {
    frames.push(`--- tick ${world.tick} ---\n${frameToAnsi(captureFrame(world))}`);
  }
}

for (const event of log.events) {
  console.log(formatEvent(event));
}

console.log("");
console.log(`Ran ${ticks} ticks.`);
console.log(summarize(log.events));

if (frames.length > 0) {
  console.log("");
  console.log(frames.join("\n\n"));
}
