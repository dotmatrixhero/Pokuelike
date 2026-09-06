/**
 * Real-run validation for evolution-aware invented-population levels
 * (macroGrid.ts's `estimateZoneSpecies`/overworld.ts's
 * `estimateInitialAggregates` + `promoteZone`) — the SEPARATE bug from
 * immigration.ts's own flat level (this one seeds a never-visited zone's
 * ESTIMATED starting population, e.g. panning the overworld map onto a
 * fresh zone). Confirms a real promotion of a fresh zone containing an
 * evolved species lands well above the old flat 5. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateInventedLevels.ts`
 */
import { generateMacroGrid, promoteZone, type MacroWorld } from "@pokuelike/engine";
import { IMMIGRATION_CONTEXT } from "@pokuelike/data";
import { mulberry32 } from "@pokuelike/engine";

const seed = 12345;
const grid = generateMacroGrid(seed, 10, 10);
const mw: MacroWorld = {
  grid,
  regions: new Map(),
  focusedKey: "0,0",
  tick: 0,
  rng: mulberry32(seed ^ 0x6f4d5c1b),
  worldSeed: seed,
  zoneWidth: 40,
  zoneHeight: 40,
  weatherFronts: [],
  nextWeatherFrontId: 0,
};

const results: Record<string, { count: number; min: number; max: number }> = {};

for (let row = 0; row < 10; row++) {
  for (let col = 0; col < 10; col++) {
    const region = promoteZone(mw, row, col, IMMIGRATION_CONTEXT);
    for (const agent of region.world?.agents ?? []) {
      if (!results[agent.species]) results[agent.species] = { count: 0, min: Infinity, max: -Infinity };
      const r = results[agent.species]!;
      r.count++;
      r.min = Math.min(r.min, agent.level ?? 0);
      r.max = Math.max(r.max, agent.level ?? 0);
    }
    region.world = undefined; // demote-ish: drop the terrain to keep memory bounded across 100 zones
  }
}

console.log(JSON.stringify(results, null, 2));
