import { EventLog, tickWorld, randomSeed } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
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
// Optional 4th positional argument: an explicit seed to reproduce an exact
// earlier run — see DESIGN.md's determinism section. Omitted, a fresh
// (non-reproducible) seed is minted via `randomSeed()` (engine/src/rng.ts —
// prefers `crypto.getRandomValues`, falls back to `Date.now()`), same as
// `createWorld`'s own default. Printed below either way so every run's seed
// is always visible and copyable, whether it was chosen or randomly minted:
// `pnpm --filter @pokuelike/runner run <ticks> <snapshotTicks> <seed>`
// reruns the exact same run byte-for-byte (same event log — see DESIGN.md's
// determinism section for the concrete two-runs-diffed proof).
const seedArg = process.argv[4];
const seed = seedArg !== undefined && seedArg !== "" ? Number(seedArg) : randomSeed();
console.log(`Seed: ${seed}`);

const world = createDemoWorld(seed);
const log = new EventLog();
const frames: string[] = [];

if (snapshotTicks.has(0)) {
  frames.push(`--- tick 0 ---\n${frameToAnsi(captureFrame(world))}`);
}

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
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
