/**
 * Real-run validation for mountain cross-zone contiguity — confirms a
 * promoted Highland/Snow zone with a `highEdges`-marked boundary (a
 * neighbor at higher macro elevation) shows real massif wall tiles
 * noticeably denser near that edge than the opposite one. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateMassifEdges.ts`
 */
import { generateMacroGrid, biasForZone, generateWorld, tileAt, biomeWeightsAt } from "@pokuelike/engine";

const rows = 60;
const cols = 60;
const seed = 20260906;
const width = 90;
const height = 60;

const grid = generateMacroGrid(seed, rows, cols);

const opposite: Record<string, string> = { N: "S", S: "N", W: "E", E: "W" };
const bandFraction = 0.2;
const bandWidth = Math.round(width * bandFraction);
const bandHeight = Math.round(height * bandFraction);
const bandPredicate: Record<string, (x: number, y: number) => boolean> = {
  N: (x, y) => y < bandHeight,
  S: (x, y) => y >= height - bandHeight,
  W: (x, y) => x < bandWidth,
  E: (x, y) => x >= width - bandWidth,
};

function isMassifBiomeDominant(world: ReturnType<typeof generateWorld>, x: number, y: number): boolean {
  const weights = biomeWeightsAt(world.biomeSeeds, x, y);
  let bestName: string | undefined;
  let bestWeight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestName = name;
    }
  }
  return bestName === "highland" || bestName === "snow";
}

function wallFraction(world: ReturnType<typeof generateWorld>, predicate: (x: number, y: number) => boolean): number {
  let wall = 0;
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!predicate(x, y)) continue;
      total++;
      const tile = tileAt(world, "surface", x, y)!;
      if (tile.terrain === "wall" && isMassifBiomeDominant(world, x, y)) wall++;
    }
  }
  return total > 0 ? wall / total : 0;
}

// Zones that are themselves Highland/Snow-dominant (so a massif can even
// form) AND have a real highEdges-marked boundary — a neighbor at higher
// macro elevation, the same real macro fact the bias mechanism reads.
const candidateZones = grid.zones.filter((z) => !z.isOcean && (z.biome === "highland" || z.biome === "snow") && z.row > 1 && z.col > 1 && z.row < rows - 2 && z.col < cols - 2);

let markedSideSum = 0;
let oppositeSideSum = 0;
const samples: unknown[] = [];
const SAMPLE_COUNT = Math.min(15, candidateZones.length);
let checked = 0;
for (let i = 0; i < candidateZones.length && checked < SAMPLE_COUNT; i++) {
  const zone = candidateZones[i]!;
  const bias = biasForZone(grid, zone.row, zone.col);
  if (bias.elevation.highEdges.length === 0) continue;
  const world = generateWorld(width, height, seed ^ (zone.row * 7919 + zone.col * 104729), bias);
  const dir = bias.elevation.highEdges[0]!;
  const markedSide = wallFraction(world, bandPredicate[dir]!);
  const oppositeSide = wallFraction(world, bandPredicate[opposite[dir]!]!);
  markedSideSum += markedSide;
  oppositeSideSum += oppositeSide;
  samples.push({ row: zone.row, col: zone.col, highEdgeDir: dir, markedSideWall: markedSide, oppositeSideWall: oppositeSide });
  checked++;
}

console.log(
  JSON.stringify(
    {
      totalHighlandSnowZonesFound: candidateZones.length,
      sampleCount: checked,
      avgMarkedSideWallFraction: checked ? markedSideSum / checked : undefined,
      avgOppositeSideWallFraction: checked ? oppositeSideSum / checked : undefined,
      samples,
    },
    null,
    2
  )
);
