import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES } from "@pokuelike/data";
import { TERRAIN_ORDER } from "./ascii.js";
import { writeFileSync } from "node:fs";

// Dumps *every* tick of a run (not just a handful of curated snapshots) as
// compact index-encoded data, so a page can replay the whole sim tick by
// tick instead of looking at a few stills.

const ticks = Number(process.argv[2] ?? 2000);
const outPath = process.argv[3] ?? "./replay.json";

const world = createDemoWorld();
const log = new EventLog();

const speciesList: string[] = [];
const speciesIndex = new Map<string, number>();
function indexOfSpecies(species: string): number {
  let i = speciesIndex.get(species);
  if (i === undefined) {
    i = speciesList.length;
    speciesList.push(species);
    speciesIndex.set(species, i);
  }
  return i;
}

const width = world.width;
const height = world.height;

// Static terrain: kind index + elevation per cell (elevation never
// changes; kind can, e.g. flora growing/being eaten) plus a sparse diff
// log of every terrain-kind change, keyed by tick.
const terrainKindOf = (x: number, y: number) =>
  TERRAIN_ORDER.indexOf(world.tiles.surface[y * width + x]!.terrain);

let prevKinds: number[] = [];
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    prevKinds.push(terrainKindOf(x, y));
  }
}

const baseTerrain = world.tiles.surface.map((tile) => ({
  t: TERRAIN_ORDER.indexOf(tile.terrain),
  e: tile.elevation,
}));

const terrainDiffs: { tick: number; i: number; t: number }[] = [];

// One flat number array per tick: [x0, y0, species0, x1, y1, species1, ...]
// for every alive agent on the surface layer.
const agentFrames: number[][] = [];

function captureAgents(): number[] {
  const flat: number[] = [];
  for (const agent of world.agents) {
    if (agent.layer !== "surface" || agent.alive === false) continue;
    flat.push(agent.pos.x, agent.pos.y, indexOfSpecies(agent.species));
  }
  return flat;
}

agentFrames.push(captureAgents());

for (let tick = 1; tick <= ticks; tick++) {
  tickWorld(world, log, HUNT_RULES);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = terrainKindOf(x, y);
      const i = y * width + x;
      if (kind !== prevKinds[i]) {
        terrainDiffs.push({ tick, i, t: kind });
        prevKinds[i] = kind;
      }
    }
  }

  agentFrames.push(captureAgents());
}

const counts = new Map<string, number>();
for (const e of log.events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);

const notable = log.events.filter((e) =>
  ["killed", "defeated", "starved", "born"].includes(e.kind)
);

writeFileSync(
  outPath,
  JSON.stringify({
    width,
    height,
    terrainOrder: TERRAIN_ORDER,
    baseTerrain,
    terrainDiffs,
    speciesList,
    agentFrames,
    eventCounts: Object.fromEntries(counts),
    totalEvents: log.events.length,
    notable,
  })
);

console.log("wrote", outPath, "ticks:", agentFrames.length, "species:", speciesList);
