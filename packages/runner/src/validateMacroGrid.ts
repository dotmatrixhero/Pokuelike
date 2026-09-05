import { generateMacroGrid } from "@pokuelike/engine";

const rows = Number(process.argv[2] ?? 60);
const cols = Number(process.argv[3] ?? 60);
const seed = Number(process.argv[4] ?? 12345);

const t0 = Date.now();
const grid = generateMacroGrid(seed, rows, cols);
const t1 = Date.now();

const counts: Record<string, number> = {};
let coastZones = 0;
let riverZones = 0;
let lakeZones = 0;
let sourceZones = 0;
for (const z of grid.zones) {
  counts[z.biome] = (counts[z.biome] ?? 0) + 1;
  if (z.coastEdges.length > 0) coastZones++;
  if (z.riverEdges.length > 0) riverZones++;
  if (z.isLake) lakeZones++;
  if (z.isRiverSource) sourceZones++;
}

console.log(JSON.stringify({ rows, cols, totalZones: rows * cols, genTimeMs: t1 - t0, biomeCounts: counts, coastZones, riverZones, lakeZones, sourceZones }, null, 2));
