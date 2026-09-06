/**
 * Real-run validation for river-edge cross-zone contiguity — confirms a
 * promoted zone the macro grid marked as river-crossing on a specific edge
 * actually shows real water noticeably closer to that edge than the
 * opposite one, more often than an unbiased zone would. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateRiverEdges.ts`
 */
import { generateMacroGrid, biasForZone, generateWorld, tileAt } from "@pokuelike/engine";

const rows = 60;
const cols = 60;
const seed = 20260906;
const width = 90;
const height = 60;

const grid = generateMacroGrid(seed, rows, cols);

const opposite: Record<string, string> = { N: "S", S: "N", W: "E", E: "W" };
const bandFraction = 0.15;
const bandWidth = Math.round(width * bandFraction);
const bandHeight = Math.round(height * bandFraction);
const bandPredicate: Record<string, (x: number, y: number) => boolean> = {
  N: (x, y) => y < bandHeight,
  S: (x, y) => y >= height - bandHeight,
  W: (x, y) => x < bandWidth,
  E: (x, y) => x >= width - bandWidth,
};

function waterFraction(world: ReturnType<typeof generateWorld>, predicate: (x: number, y: number) => boolean): number {
  let water = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!predicate(x, y)) continue;
      total++;
      if (tileAt(world, "surface", x, y)!.terrain === "water") water++;
    }
  }
  return total > 0 ? water / total : 0;
}

const riverZones = grid.zones.filter(
  (z) => !z.isOcean && z.riverEdges.length === 1 && z.row > 1 && z.col > 1 && z.row < rows - 2 && z.col < cols - 2
);

let markedSideSum = 0;
let oppositeSideSum = 0;
const samples: unknown[] = [];
const SAMPLE_COUNT = Math.min(15, riverZones.length);
for (let i = 0; i < SAMPLE_COUNT; i++) {
  const zone = riverZones[Math.floor((i * riverZones.length) / SAMPLE_COUNT)]!;
  const bias = biasForZone(grid, zone.row, zone.col);
  const world = generateWorld(width, height, seed ^ (zone.row * 7919 + zone.col * 104729), bias);
  const dir = zone.riverEdges[0]!;
  const markedSide = waterFraction(world, bandPredicate[dir]!);
  const oppositeSide = waterFraction(world, bandPredicate[opposite[dir]!]!);
  markedSideSum += markedSide;
  oppositeSideSum += oppositeSide;
  samples.push({ row: zone.row, col: zone.col, riverDir: dir, markedSideWater: markedSide, oppositeSideWater: oppositeSide });
}

console.log(
  JSON.stringify(
    {
      totalRiverCrossingZonesFound: riverZones.length,
      sampleCount: SAMPLE_COUNT,
      avgMarkedSideWaterFraction: SAMPLE_COUNT ? markedSideSum / SAMPLE_COUNT : undefined,
      avgOppositeSideWaterFraction: SAMPLE_COUNT ? oppositeSideSum / SAMPLE_COUNT : undefined,
      samples,
    },
    null,
    2
  )
);
