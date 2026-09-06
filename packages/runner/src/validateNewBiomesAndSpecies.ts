/**
 * Real-run validation for the desert/jungle/beach biome batch + its species
 * (species.ts, macroGrid.ts, worldgen.ts) — proves new biomes actually get
 * promoted and populated with their tagged residents over a real macro-grid
 * run, not just "the classifier produces the right name" (already covered
 * by macroGrid.test.ts's own unit tests). Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateNewBiomesAndSpecies.ts <ticks>`
 */
import { tickMacroWorld, setFocusedZone, zoneAt, type MacroWorld } from "@pokuelike/engine";
import { createDemoMacroWorld, HUNT_RULES, IMMIGRATION_CONTEXT, LEVELING_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 4000);

const mw: MacroWorld = createDemoMacroWorld();
const NEW_BIOMES = ["desert", "jungle", "beach"] as const;

// Find one never-yet-promoted zone of each new biome near the starting
// focus, and promote it (setFocusedZone) so its terrain — and the species
// immigration actually places there — becomes real, not just an estimate.
const found: Record<string, { row: number; col: number }> = {};
for (let radius = 1; radius < Math.max(mw.grid.rows, mw.grid.cols) / 2 && Object.keys(found).length < NEW_BIOMES.length; radius++) {
  const centerRow = Math.floor(mw.grid.rows / 2);
  const centerCol = Math.floor(mw.grid.cols / 2);
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const zone = zoneAt(mw.grid, centerRow + dr, centerCol + dc);
      if (!zone || zone.isOcean) continue;
      if (NEW_BIOMES.includes(zone.biome as (typeof NEW_BIOMES)[number]) && !found[zone.biome]) {
        found[zone.biome] = { row: zone.row, col: zone.col };
      }
    }
  }
}

console.log("new-biome zones found near start:", JSON.stringify(found));

for (const [biome, pos] of Object.entries(found)) {
  setFocusedZone(mw, pos.row, pos.col, IMMIGRATION_CONTEXT);
  console.log(`promoted a ${biome} zone at (${pos.row},${pos.col})`);
}

for (let i = 0; i < ticks; i++) {
  tickMacroWorld(mw, undefined, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT);
}

// Snapshot every tracked zone's living/aggregate species composition.
const speciesByZone: Record<string, Record<string, number>> = {};
for (const region of mw.regions.values()) {
  const zone = zoneAt(mw.grid, region.row, region.col)!;
  const counts: Record<string, number> = {};
  if (region.world) {
    for (const a of region.world.agents) {
      if (a.alive === false || a.isEgg) continue;
      counts[a.species] = (counts[a.species] ?? 0) + 1;
    }
  } else if (region.aggregates) {
    for (const [species, agg] of Object.entries(region.aggregates)) counts[species] = Math.round(agg.population);
  }
  speciesByZone[`${zone.biome}@${region.key}`] = counts;
}

console.log(JSON.stringify({ ticks, trackedZoneCount: mw.regions.size, speciesByZone }, null, 2));
