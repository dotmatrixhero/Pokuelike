import type { Layer } from "./types.js";
import type { ImmigrationSpeciesInfo } from "./immigration.js";
import { generateMacroElevation, makeNoise2D, mulberry32, biomeFoodWaterDensity, type MacroElevationBias, type ZoneGenerationBias } from "./worldgen.js";
import { DIRECTIONS, DIRECTION_DELTA, OPPOSITE_DIRECTION, type ZoneDirection } from "./directions.js";

/**
 * The macro-scale zone grid — DESIGN.md's "Correction: overworld and zone are
 * two distinct levels, not one." The overworld is a coarse grid of thousands
 * of zone-cells; THIS module generates the cheap, whole-grid facts (macro
 * elevation, land/ocean, dominant biome, coastline/river edges) for every
 * cell up front, reusing `worldgen.ts`'s existing macro-elevation/river
 * algorithms at zone-grid resolution instead of tile resolution — the same
 * "Groudon/Kyogre" uplift-and-basin field, the same "Suicune" steepest-
 * descent river carving, just addressed by (row, col) zone coordinates
 * instead of (x, y) tile coordinates.
 *
 * A zone's own full-resolution `World` (what `overworld.ts` actually
 * simulates once a zone is promoted) is NOT generated here — that's still
 * `worldgen.ts`'s `generateWorld`, just handed a `ZoneGenerationBias`
 * (`biasForZone` below) derived from this grid's facts at that zone's
 * position, so a promoted zone's real terrain is recognizably "the zoomed-in
 * version of that macro spot" rather than an independent reroll. This module
 * never imports `overworld.ts` — it only produces facts and estimates for
 * that module to consume, keeping the dependency one-directional.
 */

export interface MacroZone {
  row: number;
  col: number;
  /** Normalized 0..1 macro elevation, same meaning as `worldgen.ts`'s `MacroElevation.normalized`, sampled once at this zone's own grid position. */
  elevation: number;
  isOcean: boolean;
  /** A `BIOME_NAMES` entry, or `"ocean"` when `isOcean` — the biome a promoted zone's terrain should lean toward, see `biasForZone`. */
  biome: string;
  /** Edges where the adjacent zone is ocean and this one isn't — a coastline crosses here. Empty for an ocean zone itself (its neighbors' own `coastEdges` cover the same boundary from the land side). */
  coastEdges: ZoneDirection[];
  /** Edges a macro-scale river crosses (both the zone it flows FROM and the one it flows INTO record the shared edge, from their own side) — see `carveMacroRivers`. */
  riverEdges: ZoneDirection[];
  /** True if a river originates in this zone — a macro-scale "mountain peak" source, same role `selectRiverSources` picks at tile resolution. */
  isRiverSource: boolean;
  /** True if a river carved into this zone found no lower neighbor and pooled here instead of reaching the ocean. */
  isLake: boolean;
}

export interface MacroGrid {
  rows: number;
  cols: number;
  /** Row-major: `zones[row * cols + col]`. Every (row, col) in bounds has a real entry — this is the "cheap, dense, whole-grid" data structure the vision calls for; nothing here is lazy. */
  zones: MacroZone[];
}

export function zoneIndex(grid: Pick<MacroGrid, "cols">, row: number, col: number): number {
  return row * grid.cols + col;
}

export function inBounds(grid: Pick<MacroGrid, "rows" | "cols">, row: number, col: number): boolean {
  return row >= 0 && col >= 0 && row < grid.rows && col < grid.cols;
}

export function zoneAt(grid: MacroGrid, row: number, col: number): MacroZone | undefined {
  return inBounds(grid, row, col) ? grid.zones[zoneIndex(grid, row, col)] : undefined;
}

/** The string key `overworld.ts` addresses a `Region` by — plain `"row,col"`, parsed back by `parseZoneKey`. */
export function zoneKey(row: number, col: number): string {
  return `${row},${col}`;
}

export function parseZoneKey(key: string): { row: number; col: number } {
  const [row, col] = key.split(",").map(Number);
  return { row: row!, col: col! };
}

/** The (up to 4) orthogonal in-bounds neighbor zones of (row, col) — no diagonals: a river/coastline edge only ever means one of N/E/S/W, so orthogonal adjacency is what keeps that concept crisp. */
export function zoneNeighbors(grid: MacroGrid, row: number, col: number): MacroZone[] {
  const neighbors: MacroZone[] = [];
  for (const dir of DIRECTIONS) {
    const delta = DIRECTION_DELTA[dir];
    const neighbor = zoneAt(grid, row + delta.dr, col + delta.dc);
    if (neighbor) neighbors.push(neighbor);
  }
  return neighbors;
}

// ---------------------------------------------------------------------------
// Biome classification — elevation (already computed by generateMacroElevation)
// plus one extra macro-scale moisture field, thresholded into the same 5
// biome names worldgen.ts's per-tile BIOMES table uses (plus "ocean").
// ---------------------------------------------------------------------------

/** Elevation at/above this reads as Highland — see `macroBiomeFor`. Sim-original guess; validated against a real generated grid's biome distribution (see DESIGN.md), not canon. */
const HIGHLAND_ELEVATION_THRESHOLD = 0.72;
/** Moisture below this reads as Badlands. */
const BADLANDS_MOISTURE_THRESHOLD = 0.35;
/** Moisture at/above this reads as Wetland. */
const WETLAND_MOISTURE_THRESHOLD = 0.65;
/** Moisture at/above this (but below Wetland) reads as Forest; below it, Grassland. */
const FOREST_MOISTURE_THRESHOLD = 0.5;

function macroBiomeFor(elevation: number, moisture: number): string {
  if (elevation >= HIGHLAND_ELEVATION_THRESHOLD) return "highland";
  if (moisture < BADLANDS_MOISTURE_THRESHOLD) return "badlands";
  if (moisture >= WETLAND_MOISTURE_THRESHOLD) return "wetland";
  if (moisture >= FOREST_MOISTURE_THRESHOLD) return "forest";
  return "grassland";
}

// ---------------------------------------------------------------------------
// Macro river carving — the same steepest-descent idea `carveSuicuneRivers`
// uses at tile resolution, but orthogonal-only (no diagonal step) so every
// step crosses exactly one well-defined N/E/S/W edge, and marking edges on
// `MacroZone.riverEdges` instead of painting "water" tiles.
// ---------------------------------------------------------------------------

/** How many rivers carve the macro grid — same "light function of the larger dimension" shape as `worldgen.ts`'s tile-level `riverCountFor`, just with its own constant since a zone grid's typical size is a different order of magnitude. */
function macroRiverCount(rows: number, cols: number): number {
  return Math.max(4, Math.round(Math.max(rows, cols) / 8));
}

/** Minimum spacing between two river sources, as a fraction of the grid's larger dimension — same idea as the tile-level `RIVER_SOURCE_MIN_SPACING_FRACTION`. */
const MACRO_RIVER_SOURCE_MIN_SPACING_FRACTION = 0.12;

function selectMacroRiverSources(grid: MacroGrid, count: number, minSpacing: number): MacroZone[] {
  const candidates = grid.zones.filter((z) => !z.isOcean).sort((a, b) => b.elevation - a.elevation);
  const chosen: MacroZone[] = [];
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every((p) => Math.hypot(p.col - c.col, p.row - c.row) >= minSpacing)) chosen.push(c);
  }
  return chosen;
}

function carveMacroRiver(grid: MacroGrid, source: MacroZone, visited: Set<string>): void {
  source.isRiverSource = true;
  let row = source.row;
  let col = source.col;
  const maxSteps = grid.rows + grid.cols;

  for (let step = 0; step < maxSteps; step++) {
    const key = zoneKey(row, col);
    if (visited.has(key)) return;
    const zone = zoneAt(grid, row, col)!;
    if (zone.isOcean) return; // flowed into a zone the macro field already made ocean — a silent merge, same as the tile-level "flowed into existing water" case
    visited.add(key);

    let bestDir: ZoneDirection | undefined;
    let bestNeighbor: MacroZone | undefined;
    let bestElevation = zone.elevation;
    let touchedOcean = false;
    for (const dir of DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const neighbor = zoneAt(grid, row + delta.dr, col + delta.dc);
      if (!neighbor) continue;
      if (neighbor.isOcean) {
        touchedOcean = true;
        if (!zone.riverEdges.includes(dir)) zone.riverEdges.push(dir);
        continue;
      }
      if (neighbor.elevation < bestElevation) {
        bestElevation = neighbor.elevation;
        bestDir = dir;
        bestNeighbor = neighbor;
      }
    }
    if (touchedOcean) return; // river mouth — reached the coast this zone already borders

    if (!bestNeighbor || !bestDir) {
      zone.isLake = true; // no lower neighbor anywhere adjacent — pools here, same as the tile-level "pools into a new lake" case
      return;
    }
    if (!zone.riverEdges.includes(bestDir)) zone.riverEdges.push(bestDir);
    const opposite = OPPOSITE_DIRECTION[bestDir];
    if (!bestNeighbor.riverEdges.includes(opposite)) bestNeighbor.riverEdges.push(opposite);

    row = bestNeighbor.row;
    col = bestNeighbor.col;
  }
}

function carveMacroRivers(grid: MacroGrid, rng: () => number): void {
  const count = macroRiverCount(grid.rows, grid.cols);
  const minSpacing = Math.max(grid.rows, grid.cols) * MACRO_RIVER_SOURCE_MIN_SPACING_FRACTION;
  const sources = selectMacroRiverSources(grid, count, minSpacing);
  const visited = new Set<string>();
  for (const source of sources) carveMacroRiver(grid, source, visited);
  void rng; // reserved: no randomness needed once sources are picked (steepest descent is deterministic from elevation alone) — kept as a parameter for symmetry with every other "pass an rng, even if unused today" generation step in this codebase, and in case future tie-breaking needs one.
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generates the whole macro grid in one pass — cheap and dense: a `rows *
 * cols` array of small per-zone records, no per-tile data anywhere, so
 * thousands of zones is trivial to generate and hold in memory (see
 * DESIGN.md for a real-run measurement). Deterministic for a given (seed,
 * rows, cols), same contract every other generation function in this
 * codebase follows.
 */
export function generateMacroGrid(seed: number, rows: number, cols: number): MacroGrid {
  const noiseScale = Math.max(rows, cols);
  const detailNoise = makeNoise2D(mulberry32(seed ^ 0x9e3779b9), cols, rows, noiseScale / 10);
  const macroPointsRng = mulberry32(seed ^ 0x51c48a7d);
  // Reuses worldgen.ts's tile-resolution macro-elevation field generator
  // directly, at zone-grid resolution: cols/rows stand in for width/height,
  // and every zone samples it at its own integer (col, row) — the exact same
  // "Groudon/Kyogre" uplift-and-basin algorithm, one level up.
  const macro = generateMacroElevation(macroPointsRng, cols, rows, detailNoise);
  const moistureNoise = makeNoise2D(mulberry32(seed ^ 0x2545f491), cols, rows, noiseScale / 6);

  const zones: MacroZone[] = new Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const elevation = macro.normalized(col, row);
      const isOcean = macro.isOcean(col, row);
      const biome = isOcean ? "ocean" : macroBiomeFor(elevation, moistureNoise(col, row));
      zones[row * cols + col] = { row, col, elevation, isOcean, biome, coastEdges: [], riverEdges: [], isRiverSource: false, isLake: false };
    }
  }
  const grid: MacroGrid = { rows, cols, zones };

  for (const zone of zones) {
    if (zone.isOcean) continue;
    for (const dir of DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const neighbor = zoneAt(grid, zone.row + delta.dr, zone.col + delta.dc);
      if (neighbor?.isOcean) zone.coastEdges.push(dir);
    }
  }

  carveMacroRivers(grid, mulberry32(seed ^ 0x27220a95));
  return grid;
}

// ---------------------------------------------------------------------------
// Promotion bias — what a promoted zone's own full-resolution generateWorld
// call gets handed, so its terrain matches this macro spot instead of
// independently rerolling. See worldgen.ts's ZoneGenerationBias/
// MacroElevationBias doc comments for what each field actually does.
// ---------------------------------------------------------------------------

/** Ocean fraction target for a zone the macro grid marked fully ocean — high, but deliberately not 1.0, so a promoted ocean zone can still show a small island poking up, same "not a lie, just mostly true" spirit as this codebase's other lossy abstractions. */
const OCEAN_ZONE_OCEAN_FRACTION = 0.85;
/** Ocean fraction target for a coastal land zone (has at least one `coastEdges` entry) — enough to guarantee a real, visible coastline without swallowing most of the zone. */
const COASTAL_ZONE_OCEAN_FRACTION = 0.22;
/** Ocean fraction target for a fully inland zone — small in-land ponds only, via the ordinary per-biome water-density roll, same as an unbiased zone would get. */
const INLAND_ZONE_OCEAN_FRACTION = 0.04;

export function biasForZone(grid: MacroGrid, row: number, col: number): ZoneGenerationBias {
  const zone = zoneAt(grid, row, col)!;
  const lowEdges: ZoneDirection[] = [...zone.coastEdges];
  const highEdges: ZoneDirection[] = [];
  for (const dir of DIRECTIONS) {
    const delta = DIRECTION_DELTA[dir];
    const neighbor = zoneAt(grid, row + delta.dr, col + delta.dc);
    if (neighbor && !zone.isOcean && !neighbor.isOcean && neighbor.elevation > zone.elevation) highEdges.push(dir);
  }

  const oceanFraction = zone.isOcean ? OCEAN_ZONE_OCEAN_FRACTION : zone.coastEdges.length > 0 ? COASTAL_ZONE_OCEAN_FRACTION : INLAND_ZONE_OCEAN_FRACTION;
  const elevation: MacroElevationBias = {
    elevationShift: zone.elevation * 2 - 1,
    oceanFraction,
    lowEdges,
    highEdges,
  };

  return { elevation, dominantBiome: zone.isOcean ? undefined : zone.biome };
}

// ---------------------------------------------------------------------------
// Cheap per-zone estimates — used ONLY to seed a never-visited zone's
// abstract-tier aggregate state (overworld.ts) before any real tiles exist to
// measure from. Deliberately analytic, not a real simulation — the whole
// point of this grid is that most zones never need one.
// ---------------------------------------------------------------------------

/** Resource-abundance estimate for a fully-ocean zone — no `BiomeDef` describes ocean, so this is its own flat guess rather than a density lookup. */
const OCEAN_RESOURCE_INDEX_ESTIMATE = 0.6;
/**
 * Scales a biome's raw `foodDensity + waterDensity` into roughly the same
 * 0..1 range `overworld.ts`'s real `measureResourceIndex` reports for an
 * actually-generated map (that function's own doc comment notes a real
 * `createDemoWorld`-sized map lands around ~0.5) — a sim-original guess,
 * judged against a real large-grid run like every other tuning constant in
 * this codebase (see DESIGN.md).
 *
 * Recalibrated from 2 (real bug, found while validating overworld.ts's
 * abstract-region recovery fix): at 2, grassland/forest/badlands/highland
 * ALL landed under `overworld.ts`'s `DEATH_HEALTH_THRESHOLD` (0.3) —
 * wetland (0.64 pre-fix) was the only land biome whose estimate could ever
 * support a surviving abstracted population at all, regardless of species
 * fit. That's a real miscalibration against this constant's own stated
 * intent above ("roughly the same ~0.5 typical"), not an accident of biome
 * design — grassland/forest are meant to read as perfectly ordinary,
 * moderately-provisioned habitats, not ones every abstracted population
 * eventually starves out of on principle. At 4, grassland (~0.52) and
 * forest (~0.4) land comfortably above the threshold, matching that
 * original intent, while genuinely sparse biomes (badlands ~0.12, highland
 * ~0.2) stay a real, harsher habitat rather than an ordinary one — the
 * "barren, but for a real biome-fit reason" distinction this fix is for,
 * rather than "yes/no does a background population survive at all."
 */
const RESOURCE_ESTIMATE_SCALE = 4;

/** A never-visited zone's estimated `RegionAggregate.baseResourceIndex` — see `RESOURCE_ESTIMATE_SCALE`'s doc comment for why this is only an estimate, not a measurement. */
export function estimateZoneResourceIndex(zone: MacroZone): number {
  if (zone.isOcean) return OCEAN_RESOURCE_INDEX_ESTIMATE;
  const density = biomeFoodWaterDensity(zone.biome);
  if (!density) return 0.5;
  return Math.min(1, Math.max(0, (density.foodDensity + density.waterDensity) * RESOURCE_ESTIMATE_SCALE));
}

export interface ZoneSpeciesEstimate {
  speciesId: string;
  homeLayer: Layer;
  population: number;
}

/** Lower/upper bound (before the `estimateZoneResourceIndex`-scaled nudge below) on a never-visited zone's guessed starting population per matching species — settles toward the abstract tier's own capacity-driven equilibrium (`advanceAbstractRegion`) after a few ticks regardless, so this only needs to be in the right ballpark. */
const SEED_POPULATION_BASE = 4;
const SEED_POPULATION_VARIANCE = 10;

/**
 * Guesses which species from `roster` would plausibly already live in a
 * never-visited zone, and roughly how many — the abstract-tier seed for a
 * zone `overworld.ts` needs to track (received migrants, or a first
 * promotion) but has never actually simulated. A species matches when its
 * `obligateAquatic`-ness agrees with whether this zone is ocean, same as
 * `overworld.ts`'s real `placeInvented` check when actually spawning an
 * individual. The biome-name check only applies to LAND zones — `"ocean"`
 * isn't a real per-tile `BIOMES` entry (see worldgen.ts), so an
 * obligate-aquatic species has nothing literal to tag itself with beyond
 * `@pokuelike/data`'s existing "wetland" stand-in (its own closest
 * water-heavy per-tile biome); requiring a biome match for an ocean zone
 * too would make every ocean zone's estimate come up empty, a real bug an
 * ocean-zone promotion test in this codebase's own web-app smoke check
 * caught directly.
 */
/**
 * Whether `species` could plausibly live in `zone` at all — obligate-aquatic
 * agrees with ocean-ness, and (land zones only) its `biomes` list, if it has
 * one, includes this zone's biome. Extracted from `estimateZoneSpecies`'s
 * own per-species filter (see that function's doc comment for the ocean
 * special-case reasoning) so `overworld.ts`'s abstract-region resource-
 * baseline recovery can reuse the identical "is this the right habitat"
 * check instead of a second, possibly-diverging one.
 */
export function speciesFitsZone(species: ImmigrationSpeciesInfo, zone: MacroZone): boolean {
  const isAquatic = species.obligateAquatic === true;
  if (isAquatic !== zone.isOcean) return false;
  if (zone.isOcean) return true;
  return !species.biomes || species.biomes.length === 0 || species.biomes.includes(zone.biome);
}

export function estimateZoneSpecies(zone: MacroZone, roster: readonly ImmigrationSpeciesInfo[], rng: () => number): ZoneSpeciesEstimate[] {
  const estimates: ZoneSpeciesEstimate[] = [];
  for (const species of roster) {
    if (!speciesFitsZone(species, zone)) continue;
    estimates.push({ speciesId: species.id, homeLayer: species.homeLayer, population: SEED_POPULATION_BASE + rng() * SEED_POPULATION_VARIANCE });
  }
  return estimates;
}
