import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES } from "@pokuelike/data";
import { captureFrame, type Frame } from "./ascii.js";
import { writeFileSync } from "node:fs";

const ticks = Number(process.argv[2] ?? 2000);
const fixedSnapshotTicks = new Set(
  (process.argv[3] ?? "0,2000").split(",").map((s) => Number(s.trim()))
);
const outPath = process.argv[4] ?? "./frames.json";
const AUTO_CAPTURE_KINDS = new Set(["killed", "defeated"]);

interface PopulatedFrame extends Frame {
  population: Record<string, number>;
}

const world = createDemoWorld();
const log = new EventLog();
const frames: PopulatedFrame[] = [];
const capturedTicks = new Set<number>();

function maybeCapture(tick: number) {
  if (capturedTicks.has(tick)) return;
  capturedTicks.add(tick);
  const bySpecies = new Map<string, number>();
  for (const a of world.agents) {
    if (a.alive === false) continue;
    bySpecies.set(a.species, (bySpecies.get(a.species) ?? 0) + 1);
  }
  frames.push({ ...captureFrame(world), population: Object.fromEntries(bySpecies) });
}

if (fixedSnapshotTicks.has(0)) maybeCapture(0);

for (let i = 0; i < ticks; i++) {
  const before = log.events.length;
  tickWorld(world, log, HUNT_RULES);
  if (fixedSnapshotTicks.has(world.tick)) maybeCapture(world.tick);
  for (let j = before; j < log.events.length; j++) {
    if (AUTO_CAPTURE_KINDS.has(log.events[j]!.kind)) {
      maybeCapture(world.tick);
      break;
    }
  }
}

frames.sort((a, b) => a.tick - b.tick);

const counts = new Map<string, number>();
for (const e of log.events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

const notable = log.events.filter((e) =>
  ["killed", "defeated", "starved", "born", "crossedLayer"].includes(e.kind)
);

writeFileSync(
  outPath,
  JSON.stringify(
    { frames, eventCounts: Object.fromEntries(counts), totalEvents: log.events.length, notable },
    null,
    2
  )
);
console.log("wrote", outPath, "frames:", frames.length);
