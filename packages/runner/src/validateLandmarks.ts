import {
  generateMacroGrid,
  biasForZone,
  generateWorld,
  tileAt,
  estimateZoneResourceIndex,
  estimateZoneSpecies,
  LANDMARK_TYPES,
  type ImmigrationSpeciesInfo,
} from "@pokuelike/engine";

// Real question: do landmarks actually appear on a big grid, at roughly the
// rarity `LANDMARK_DEFS` intends, do they carve genuinely distinct terrain
// once promoted, and do the resource/species-congregation hooks actually
// move the numbers `macroGrid.ts` now derives from them?

const rows = 400;
const cols = 400;
const seed = 424242;
const width = 90;
const height = 60;

const grid = generateMacroGrid(seed, rows, cols);

const counts: Record<string, number> = {};
for (const z of grid.zones) {
  if (z.landmark) counts[z.landmark] = (counts[z.landmark] ?? 0) + 1;
}
console.log("Landmark counts across a", rows * cols, "zone grid:");
console.log(JSON.stringify(counts, null, 2));
for (const type of LANDMARK_TYPES) {
  if (!(type in counts)) console.log(`  WARNING: ${type} never placed`);
}

// Fake, minimal roster covering both land and aquatic — real ImmigrationSpeciesInfo
// shape, just enough fields to exercise speciesFitsZone.
const roster: ImmigrationSpeciesInfo[] = [
  { id: "landA", homeLayer: "surface", biomes: ["grassland", "forest", "jungle", "wetland", "badlands", "desert", "highland", "snow"] },
  { id: "landB", homeLayer: "surface", biomes: ["grassland", "forest", "jungle", "wetland", "badlands", "desert", "highland", "snow"] },
] as unknown as ImmigrationSpeciesInfo[];

console.log("\nResource-index and population estimates, landmark vs. plain zone of the same biome:");
for (const type of LANDMARK_TYPES) {
  const landmarkZone = grid.zones.find((z) => z.landmark === type);
  if (!landmarkZone) continue;
  const plainSameBiome = grid.zones.find((z) => !z.landmark && !z.isOcean && z.biome === landmarkZone.biome);
  const landmarkResource = estimateZoneResourceIndex(landmarkZone);
  const plainResource = plainSameBiome ? estimateZoneResourceIndex(plainSameBiome) : undefined;
  const landmarkPop = estimateZoneSpecies(landmarkZone, roster, () => 0.5).reduce((s, e) => s + e.population, 0);
  const plainPop = plainSameBiome ? estimateZoneSpecies(plainSameBiome, roster, () => 0.5).reduce((s, e) => s + e.population, 0) : undefined;
  console.log(
    `  ${type} (biome=${landmarkZone.biome}): resourceIndex ${landmarkResource.toFixed(2)} vs plain ${plainResource?.toFixed(2) ?? "n/a"}; ` +
      `totalPop ${landmarkPop.toFixed(1)} vs plain ${plainPop?.toFixed(1) ?? "n/a"}`
  );
}

console.log("\nTerrain distinctness — one promoted zone per landmark type:");
function terrainCounts(world: ReturnType<typeof generateWorld>): Record<string, number> {
  const out: Record<string, number> = {};
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = tileAt(world, "surface", x, y)!.terrain;
      out[t] = (out[t] ?? 0) + 1;
    }
  }
  return out;
}

for (const type of LANDMARK_TYPES) {
  const zone = grid.zones.find((z) => z.landmark === type);
  if (!zone) continue;
  const bias = biasForZone(grid, zone.row, zone.col);
  const world = generateWorld(width, height, seed ^ (zone.row * 7919 + zone.col * 104729), bias);
  console.log(`  ${type}:`, JSON.stringify(terrainCounts(world)));
}
