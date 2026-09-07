/**
 * Real-run validation for Mountain Massifs — confirms real generated worlds
 * actually produce large, contiguous massif structures (not speckle), and
 * reports how much of Highland/Snow's own footprint ends up massif vs open.
 * Usage: `pnpm --filter @pokuelike/runner exec tsx src/validateMountainMassifs.ts <seeds>`
 */
import { generateWorld, tileAt, biomeWeightsAt } from "@pokuelike/engine";

const width = 90;
const height = 60;
const seeds = Number(process.argv[2] ?? 15);

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

function wallComponentSizes(world: ReturnType<typeof generateWorld>): number[] {
  const isWall = (x: number, y: number) => tileAt(world, "surface", x, y)?.terrain === "wall" && isMassifBiomeDominant(world, x, y);
  const visited = new Uint8Array(width * height);
  const sizes: number[] = [];
  for (let start = 0; start < width * height; start++) {
    const sx = start % width, sy = Math.floor(start / width);
    if (visited[start] || !isWall(sx, sy)) continue;
    let size = 0;
    const queue = [start];
    visited[start] = 1;
    while (queue.length > 0) {
      const i = queue.pop()!;
      size++;
      const x = i % width, y = Math.floor(i / width);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue;
        const ni = ny! * width + nx!;
        if (visited[ni] || !isWall(nx!, ny!)) continue;
        visited[ni] = 1;
        queue.push(ni);
      }
    }
    sizes.push(size);
  }
  return sizes;
}

let totalHighlandSnowTiles = 0;
let totalMassifWallTiles = 0;
let totalMassifComponents = 0;
let largestComponent = 0;
let worldsWithAtLeastOneMassif = 0;

for (let seed = 0; seed < seeds; seed++) {
  const world = generateWorld(width, height, seed * 7919 + 12345);
  let highlandSnowCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isMassifBiomeDominant(world, x, y)) highlandSnowCount++;
    }
  }
  totalHighlandSnowTiles += highlandSnowCount;

  const sizes = wallComponentSizes(world);
  if (sizes.length > 0) worldsWithAtLeastOneMassif++;
  totalMassifComponents += sizes.length;
  for (const s of sizes) {
    totalMassifWallTiles += s;
    if (s > largestComponent) largestComponent = s;
  }
}

console.log(
  JSON.stringify(
    {
      seedsChecked: seeds,
      worldsWithAtLeastOneMassif,
      totalMassifComponentsAcrossAllSeeds: totalMassifComponents,
      largestSingleComponentSeen: largestComponent,
      avgMassifWallTilesPerWorld: totalMassifWallTiles / seeds,
      avgHighlandSnowFootprintPerWorld: totalHighlandSnowTiles / seeds,
      massifFractionOfHighlandSnowFootprint: totalHighlandSnowTiles > 0 ? totalMassifWallTiles / totalHighlandSnowTiles : undefined,
    },
    null,
    2
  )
);
