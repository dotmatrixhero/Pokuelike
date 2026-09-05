import { generateMacroGrid, biasForZone, zoneAt, generateWorld, tileAt } from "@pokuelike/engine";

const rows = 60;
const cols = 60;
const seed = 12345;
const width = 90;
const height = 60;

const grid = generateMacroGrid(seed, rows, cols);

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

const edgeBandFraction = 0.15;
const bandWidth = Math.round(width * edgeBandFraction);
const bandHeight = Math.round(height * edgeBandFraction);
const bandPredicate: Record<string, (x: number, y: number) => boolean> = {
  N: (x, y) => y < bandHeight,
  S: (x, y) => y >= height - bandHeight,
  W: (x, y) => x < bandWidth,
  E: (x, y) => x >= width - bandWidth,
};
const opposite: Record<string, string> = { N: "S", S: "N", W: "E", E: "W" };

// Every coastal land zone not on the macro grid's own border (so it has a
// real neighbor in every direction, not an edge-of-grid artifact), with
// exactly one coast edge for a clean directional check.
const coastalZones = grid.zones.filter(
  (z) => !z.isOcean && z.coastEdges.length === 1 && z.row > 0 && z.col > 0 && z.row < rows - 1 && z.col < cols - 1
);

let coastSideSum = 0;
let oppositeSideSum = 0;
const samples: unknown[] = [];
const SAMPLE_COUNT = Math.min(12, coastalZones.length);
for (let i = 0; i < SAMPLE_COUNT; i++) {
  const zone = coastalZones[Math.floor((i * coastalZones.length) / SAMPLE_COUNT)]!;
  const bias = biasForZone(grid, zone.row, zone.col);
  const world = generateWorld(width, height, seed ^ (zone.row * 7919 + zone.col * 104729), bias);
  const dir = zone.coastEdges[0]!;
  const coastSide = waterFraction(world, bandPredicate[dir]!);
  const oppositeSide = waterFraction(world, bandPredicate[opposite[dir]!]!);
  coastSideSum += coastSide;
  oppositeSideSum += oppositeSide;
  samples.push({ row: zone.row, col: zone.col, biome: zone.biome, coastDir: dir, coastSideWater: coastSide, oppositeSideWater: oppositeSide });
}

console.log(
  JSON.stringify(
    {
      sampleCount: SAMPLE_COUNT,
      avgCoastSideWaterFraction: coastSideSum / SAMPLE_COUNT,
      avgOppositeSideWaterFraction: oppositeSideSum / SAMPLE_COUNT,
      samples,
    },
    null,
    2
  )
);
