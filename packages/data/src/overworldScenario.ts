import { createMacroWorld, generateMacroGrid, zoneAt, type MacroGrid, type MacroWorld } from "@pokuelike/engine";
import { SCENARIO_SEED, SCENARIO_WIDTH, SCENARIO_HEIGHT } from "./scenario.js";
import { IMMIGRATION_CONTEXT } from "./immigration.js";

/**
 * The overworld's demo macro grid — TODO.md's "Overworld: the current map
 * becomes one cell in a larger grid" item, DESIGN.md's macro-grid
 * rearchitecture. Replaces the old 3-named-region demo (`region-a`/`region-
 * b`/`region-c`, each an independently-seeded `createDemoWorld` with no
 * spatial relationship to its "neighbors" at all) with a real macro grid:
 * `@pokuelike/engine`'s `generateMacroGrid` produces coherent land/ocean/
 * biome/river facts for every cell up front, and exactly one cell — the
 * starting focused zone — gets promoted to a real, fully-simulated `World`
 * whose terrain is biased from those facts rather than an unrelated seed.
 *
 * 64x64 = 4096 zones for the interactive demo default — comfortably inside
 * "thousands" while staying fast enough to regenerate on every page load
 * (a real run measured ~30ms at this size, see DESIGN.md); `@pokuelike/
 * runner`'s `validateMacroGrid.ts`/`validateOverworld.ts` exercise much
 * larger grids (hundreds of thousands of zones) for the real scale claim.
 */
export const OVERWORLD_GRID_ROWS = 64;
export const OVERWORLD_GRID_COLS = 64;

/**
 * Nearest non-ocean zone to (row, col), expanding-ring search — same idiom
 * `worldgen.ts`'s `findWalkableNear` uses at tile resolution, one level up.
 * Only used to pick a sane default starting zone (never start face-down in
 * open ocean); an explicit caller-supplied focus position is used as-is,
 * ocean or not.
 */
function findNearestLandZone(grid: MacroGrid, row: number, col: number): { row: number; col: number } {
  const maxRadius = Math.max(grid.rows, grid.cols);
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const zone = zoneAt(grid, row + dy, col + dx);
        if (zone && !zone.isOcean) return { row: zone.row, col: zone.col };
      }
    }
  }
  return { row, col }; // shouldn't happen — OCEAN_FRACTION is well under 1
}

/**
 * Builds the demo macro world: generates the `OVERWORLD_GRID_ROWS` x
 * `OVERWORLD_GRID_COLS` grid from `seed`, then promotes the nearest
 * non-ocean zone to the grid's center (or an explicit `focusedRow`/
 * `focusedCol`) to a real, fully-simulated zone. Deterministic for a given
 * seed, same contract every other demo-scenario builder in this file
 * follows.
 */
export function createDemoMacroWorld(seed: number = SCENARIO_SEED, focusedRow?: number, focusedCol?: number): MacroWorld {
  const grid = generateMacroGrid(seed, OVERWORLD_GRID_ROWS, OVERWORLD_GRID_COLS);
  const start = findNearestLandZone(grid, focusedRow ?? Math.floor(OVERWORLD_GRID_ROWS / 2), focusedCol ?? Math.floor(OVERWORLD_GRID_COLS / 2));
  return createMacroWorld(grid, start.row, start.col, seed, SCENARIO_WIDTH, SCENARIO_HEIGHT, IMMIGRATION_CONTEXT);
}
