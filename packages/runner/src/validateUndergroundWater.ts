/**
 * Real-run validation for underground water informed by surface water —
 * confirms (1) a real water pocket exists underground on every generated
 * world, and (2) it's genuinely biased toward wherever Surface's own
 * moisture is highest, not placed independent of it. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateUndergroundWater.ts <seeds>`
 */
import { generateWorld, tileAt, effectiveWaterDensityAt } from "@pokuelike/engine";

const width = 90;
const height = 60;
const seeds = Number(process.argv[2] ?? 30);

let worldsWithWater = 0;
let sumUndergroundWaterSurfaceDensity = 0;
let sumRandomFloorSurfaceDensity = 0;
let sampleCount = 0;

for (let seed = 0; seed < seeds; seed++) {
  const world = generateWorld(width, height, seed * 7919 + 424242);

  const waterCoords: { x: number; y: number }[] = [];
  const floorCoords: { x: number; y: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tileAt(world, "underground", x, y)!;
      if (t.terrain === "water") waterCoords.push({ x, y });
      else if (t.terrain === "floor") floorCoords.push({ x, y });
    }
  }
  if (waterCoords.length > 0) worldsWithWater++;
  else continue;

  const avgWaterDensity = waterCoords.reduce((s, { x, y }) => s + (effectiveWaterDensityAt(world.biomeSeeds, world.biomeSeedDrift, x, y) ?? 0), 0) / waterCoords.length;

  // Compare against a handful of RANDOM floor tiles from the same world —
  // the real "would this have been just as wet if placed anywhere" control.
  let randomSum = 0;
  const randomSampleSize = Math.min(20, floorCoords.length);
  for (let i = 0; i < randomSampleSize; i++) {
    const idx = Math.floor((i * floorCoords.length) / randomSampleSize);
    const { x, y } = floorCoords[idx]!;
    randomSum += effectiveWaterDensityAt(world.biomeSeeds, world.biomeSeedDrift, x, y) ?? 0;
  }
  const avgRandomDensity = randomSampleSize > 0 ? randomSum / randomSampleSize : 0;

  sumUndergroundWaterSurfaceDensity += avgWaterDensity;
  sumRandomFloorSurfaceDensity += avgRandomDensity;
  sampleCount++;
}

console.log(
  JSON.stringify(
    {
      seedsChecked: seeds,
      worldsWithWater,
      guaranteeHolds: worldsWithWater === seeds,
      avgSurfaceWaterDensityAtUndergroundWaterPockets: sampleCount ? sumUndergroundWaterSurfaceDensity / sampleCount : undefined,
      avgSurfaceWaterDensityAtRandomUndergroundFloor: sampleCount ? sumRandomFloorSurfaceDensity / sampleCount : undefined,
    },
    null,
    2
  )
);
