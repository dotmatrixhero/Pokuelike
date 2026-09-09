import type { Layer } from "./types.js";
import type { ImmigrationSpeciesInfo } from "./immigration.js";
import { generateMacroElevation, makeNoise2D, mulberry32, biomeFoodWaterDensity, type MacroElevationBias, type ZoneGenerationBias } from "./worldgen.js";
import { DIRECTIONS, DIRECTION_DELTA, OPPOSITE_DIRECTION, type ZoneDirection } from "./directions.js";
import { placeLandmarks, type LandmarkType } from "./landmarks.js";
import { nameTerritories } from "./territories.js";

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
  /**
   * A rare, real, named point of interest — direct ask: "more character,
   * more points of interest." See `landmarks.ts` for the full list, real
   * mechanical hooks (resource/population/species-mix overrides, all
   * REAL numbers other systems read, not flavor text), and the terrain
   * that makes each one visually distinct once its zone is promoted
   * (`worldgen.ts`'s `applyLandmarkFeature`). Absent = an ordinary zone,
   * the overwhelming majority — every landmark type is placed sparsely
   * (`placeLandmarks`), a handful per whole grid, not a per-tile decoration.
   */
  landmark?: LandmarkType;
  /** The named territory this zone belongs to, if any — see territories.ts. Absent for ocean and for specks too small to name. */
  territoryId?: string;
}

export interface MacroGrid {
  rows: number;
  cols: number;
  /** Row-major: `zones[row * cols + col]`. Every (row, col) in bounds has a real entry — this is the "cheap, dense, whole-grid" data structure the vision calls for; nothing here is lazy. */
  zones: MacroZone[];
  /** Named contiguous biome regions — see territories.ts's `nameTerritories`, which populates this. */
  territories?: import("./territories.js").Territory[];
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
// plus one extra macro-scale moisture field, thresholded into the same 9
// land biome names worldgen.ts's per-tile BIOMES table uses (plus "ocean").
// Beach is the one exception: applied as a coastline post-process
// (`applyBeachReclassification`) rather than a moisture/elevation band of
// its own, since "coastal strip" isn't expressible as a threshold on either
// field alone.
// ---------------------------------------------------------------------------

/**
 * Elevation at/above this reads as Snow — direct ask: "snowy mountain tops
 * where ice Pokemon and dragon live." Checked BEFORE Highland below, so
 * this is genuinely the tallest-peak tier ABOVE it, not a competing
 * same-tier biome — the real elevation-gating `worldgen.ts`'s own six-biome
 * doc comment describes (unlike that file's per-tile seed placement, which
 * is elevation-agnostic; this macro classification is a real threshold
 * check against actual macro elevation). Sim-original guess, comfortably
 * above `HIGHLAND_ELEVATION_THRESHOLD` so only genuine mountain tips
 * qualify — judged against a real generated grid's biome distribution like
 * every other constant here.
 */
const SNOW_ELEVATION_THRESHOLD = 0.9;
/** Elevation at/above this (but below Snow) reads as Highland — see `macroBiomeFor`. Sim-original guess; validated against a real generated grid's biome distribution (see DESIGN.md), not canon. */
const HIGHLAND_ELEVATION_THRESHOLD = 0.72;
/**
 * Moisture below this reads as Desert — the driest possible extreme, carved
 * out of what used to be Badlands' own low end. Direct ask: "looking at more
 * other types of terrain generation... stretches of desert." Deliberately a
 * DIFFERENT character from Badlands, not just a renamed copy of it: Badlands
 * keeps its rocky BSP-carved canyon structure (`worldgen.ts`'s
 * `carveBadlandsChambers` checks `isBadlandsDominant` by name, so a Desert
 * zone never gets chamber-carved), while Desert is open sand dunes — see
 * `worldgen.ts`'s own "desert" `BiomeDef` for the terrain-weight difference.
 *
 * `makeNoise2D`'s own doc comment (worldgen.ts) already flags why this
 * needed real calibration, not a guessed round number: multi-octave value
 * noise clusters toward the middle of its range rather than spreading
 * evenly, so a naive "the bottom 15%" guess (0.15) badly under-fired —
 * checked directly across 12 seeds at this module's own 100x100 test scale,
 * it produced zero Desert zones in 9 of them. 0.32 was chosen by directly
 * sampling the real moisture field across those same 12 seeds and picking
 * the lowest threshold that reliably produced at least SOME Desert in every
 * one of them, while Badlands' own share (still real, just thinner than
 * before) stayed nonzero in all 12 too.
 */
const DESERT_MOISTURE_THRESHOLD = 0.32;
/** Moisture below this (but at/above Desert) reads as Badlands. */
const BADLANDS_MOISTURE_THRESHOLD = 0.35;
/** Moisture at/above this reads as Wetland. */
const WETLAND_MOISTURE_THRESHOLD = 0.65;
/**
 * Moisture at/above this (but below Wetland) reads as Jungle — carved out of
 * what used to be Forest's own high end, same "split the wettest/driest
 * extreme off into its own named biome" move as Desert above. Same direct
 * ask ("more other types of terrain generation") plus the "knock out more
 * species habitats" follow-up — a dense, humid jungle is a real, distinct
 * habitat from a temperate Forest, not just a green recolor of it.
 */
const JUNGLE_MOISTURE_THRESHOLD = 0.58;
/** Moisture at/above this (but below Jungle) reads as Forest; below it, Grassland (or, below `SAVANNA_MOISTURE_THRESHOLD`, Savanna). */
const FOREST_MOISTURE_THRESHOLD = 0.5;
/**
 * Moisture below this (but at/above Badlands) reads as Savanna instead of
 * Grassland — the driest slice of what used to be one flat Grassland band,
 * carved out the same way Desert/Jungle already were. Direct follow-up ask,
 * after fixing Grassland's own water density: "what other biomes could be
 * better?" A real dry-open-plains habitat, distinct from both moister
 * Grassland above this threshold and Badlands/Desert below it (which stay
 * rocky/dune-structured, not open plains — see `isBadlandsDominant`).
 * Splits the old 0.35-0.5 Grassland-only band roughly in half.
 */
const SAVANNA_MOISTURE_THRESHOLD = 0.42;
/**
 * Elevation at/above this (but below Highland) reads as Tundra — a cold,
 * open, rocky plateau/steppe sitting just below Highland's own much taller
 * mountain profile, the same "one biome caps another" relationship
 * Highland/Snow already have. Checked before the moisture bands below (like
 * Highland/Snow above it) so Tundra is a real elevation tier, not competing
 * with Grassland/Forest/etc. for the same territory. Sim-original guess —
 * comfortably below `HIGHLAND_ELEVATION_THRESHOLD` (0.72) so it reads as a
 * genuine foothill/plateau band, not a sliver.
 */
const TUNDRA_ELEVATION_THRESHOLD = 0.58;

function macroBiomeFor(elevation: number, moisture: number): string {
  if (elevation >= SNOW_ELEVATION_THRESHOLD) return "snow";
  if (elevation >= HIGHLAND_ELEVATION_THRESHOLD) return "highland";
  // Desert/Badlands checked BEFORE Tundra's own elevation gate — a zone
  // that's both cold (elevated) and arid reads as a cold desert/badlands
  // (real rocky/dune structure already models that), not stolen into
  // Tundra's open-plateau niche. Confirmed via a real regression: an
  // earlier ordering with Tundra checked first measurably shrank Desert's
  // own real macro-scale regions in several seeds (this file's own
  // macroGrid.test.ts caught it).
  if (moisture < DESERT_MOISTURE_THRESHOLD) return "desert";
  if (moisture < BADLANDS_MOISTURE_THRESHOLD) return "badlands";
  if (elevation >= TUNDRA_ELEVATION_THRESHOLD && moisture < FOREST_MOISTURE_THRESHOLD) return "tundra";
  if (moisture >= WETLAND_MOISTURE_THRESHOLD) return "wetland";
  if (moisture >= JUNGLE_MOISTURE_THRESHOLD) return "jungle";
  if (moisture >= FOREST_MOISTURE_THRESHOLD) return "forest";
  if (moisture < SAVANNA_MOISTURE_THRESHOLD) return "savanna";
  return "grassland";
}

/**
 * How close to THIS grid's own lowest land elevation a coastal zone must sit
 * to read as Beach instead of whatever `macroBiomeFor` classified it as — a
 * real, low-lying shoreline strip between ocean and inland terrain, applied
 * as a post-process (needs `coastEdges`, computed after the main
 * elevation/moisture pass below) rather than a fourth input to
 * `macroBiomeFor` itself.
 *
 * Deliberately RELATIVE to this specific grid's own land-elevation floor,
 * not a fixed absolute cutoff — `worldgen.ts`'s elevation field normalizes
 * per-instance (min/max of THAT seed's own raw values), so "0.4" means a
 * completely different real height from one seed to the next. Confirmed via
 * direct measurement across a dozen seeds: a coastal zone's own elevation
 * always clusters extremely tightly just above whatever that grid's actual
 * land minimum happens to be (e.g. one seed's coastal band sat at
 * 0.407-0.464, another's at 0.645-0.695 — wildly different absolute numbers,
 * same "just above local sea level" relative position) — a fixed absolute
 * threshold picked up beaches in some seeds and silently produced zero in
 * others. `HIGHLAND_ELEVATION_THRESHOLD` is an extra belt-and-suspenders
 * ceiling, not something this band is ever expected to actually reach in
 * practice (a genuinely coastal zone is never also a highland peak) — it
 * just makes that invariant explicit in code rather than merely observed.
 */
const BEACH_ELEVATION_BAND = 0.08;

function applyBeachReclassification(zones: readonly MacroZone[]): void {
  let landMin = Infinity;
  for (const zone of zones) {
    if (!zone.isOcean && zone.elevation < landMin) landMin = zone.elevation;
  }
  const beachCeiling = Math.min(landMin + BEACH_ELEVATION_BAND, HIGHLAND_ELEVATION_THRESHOLD);
  for (const zone of zones) {
    if (zone.isOcean || zone.coastEdges.length === 0) continue;
    if (zone.elevation <= beachCeiling) zone.biome = "beach";
  }
}

/**
 * A coastal Wetland zone reads as Mangrove instead — the same "coastal strip
 * isn't expressible as a moisture/elevation threshold alone" reasoning
 * `applyBeachReclassification` above already established, just for
 * Wetland's own coastal-adjacent extreme rather than every biome's. Run
 * AFTER beach reclassification so a coastal zone low enough to already read
 * as Beach (dry sand, no standing water of its own) stays Beach rather than
 * being re-claimed here — Mangrove is specifically "a real coastal marsh",
 * not "any wet zone that happens to touch the ocean".
 */
function applyMangroveReclassification(zones: readonly MacroZone[]): void {
  for (const zone of zones) {
    if (zone.isOcean || zone.coastEdges.length === 0) continue;
    if (zone.biome === "wetland") zone.biome = "mangrove";
  }
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
/**
 * A land component (4-connected, flood-filled) below this many zones reads
 * as noise, not a real island — direct ask: "Islands [would be cool]." The
 * elevation field's own multi-uplift-point design (`generateMacroElevation`)
 * already produces genuinely separate landmasses sometimes (confirmed via a
 * real connected-component analysis across several seeds: alongside one
 * dominant continent, secondary components ranging anywhere from single-
 * digit specks up to several-hundred-zone islands), but the bulk of what
 * that analysis actually found were 1-4 zone flecks — a stray tile or two
 * clearing sea level near a basin's edge, not a real, explorable landmass.
 * Pruning those (converting them back to ocean, see
 * `pruneNoiseSpeckIslands`) makes whatever land IS left away from the main
 * continent read as a deliberate island rather than map-generation noise —
 * without inventing a new "always place N islands" generator, which would
 * fight the elevation field's own already-working multi-peak structure
 * instead of just cleaning up its edge cases.
 */
const MIN_ISLAND_ZONES = 10;

/**
 * Flood-fills every land (non-ocean) component of the grid and flips any
 * component smaller than `MIN_ISLAND_ZONES` to ocean — same 4-connected
 * flood-fill idiom `worldgen.ts`'s `keepOnlyLargestFloorRegion` already
 * uses for underground caves, just pruning small-but-not-smallest
 * components instead of keeping only the single biggest (a real island
 * should stay an island, not get merged away just because it isn't the
 * largest landmass on the map).
 */
function pruneNoiseSpeckIslands(zones: MacroZone[], rows: number, cols: number): void {
  const visited = new Uint8Array(rows * cols);
  for (let start = 0; start < zones.length; start++) {
    if (visited[start] || zones[start]!.isOcean) continue;
    const component: number[] = [start];
    visited[start] = 1;
    const stack = [start];
    while (stack.length > 0) {
      const i = stack.pop()!;
      const row = Math.floor(i / cols);
      const col = i % cols;
      for (const dir of DIRECTIONS) {
        const delta = DIRECTION_DELTA[dir];
        const nr = row + delta.dr;
        const nc = col + delta.dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        const ni = nr * cols + nc;
        if (visited[ni] || zones[ni]!.isOcean) continue;
        visited[ni] = 1;
        stack.push(ni);
        component.push(ni);
      }
    }
    if (component.length < MIN_ISLAND_ZONES) {
      for (const i of component) {
        zones[i]!.isOcean = true;
        zones[i]!.biome = "ocean";
      }
    }
  }
}

export function generateMacroGrid(seed: number, rows: number, cols: number): MacroGrid {
  const noiseScale = Math.max(rows, cols);
  const detailNoise = makeNoise2D(seed ^ 0x9e3779b9, noiseScale / 10);
  const macroPointsRng = mulberry32(seed ^ 0x51c48a7d);
  // Reuses worldgen.ts's tile-resolution macro-elevation field generator
  // directly, at zone-grid resolution: cols/rows stand in for width/height,
  // and every zone samples it at its own integer (col, row) — the exact same
  // "Groudon/Kyogre" uplift-and-basin algorithm, one level up.
  const macro = generateMacroElevation(macroPointsRng, cols, rows, detailNoise);
  // Direct ask: "having sections of zones mean something... stretches of
  // desert or something like that would be cool." At the old /6 scale,
  // biome regions were noticeably smaller than the macro elevation field's
  // own continents/oceans (/1) — real, contiguous stretches of a single
  // biome, but modest ones, more "patch" than "region." Widened to /2.5 so
  // a desert (or wetland, or forest) reads as a real macro-scale feature
  // spanning a meaningful chunk of a continent, closer to the elevation
  // field's own scale of coherence, while still varying enough within one
  // continent to keep multiple biomes represented (not one flat color per
  // landmass) — judged against a real generated grid's biome-region sizes,
  // same convention as every other macro-grid tuning constant here.
  const moistureNoise = makeNoise2D(seed ^ 0x2545f491, noiseScale / 2.5);

  const zones: MacroZone[] = new Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const elevation = macro.normalized(col, row);
      const isOcean = macro.isOcean(col, row);
      const biome = isOcean ? "ocean" : macroBiomeFor(elevation, moistureNoise(col, row));
      zones[row * cols + col] = { row, col, elevation, isOcean, biome, coastEdges: [], riverEdges: [], isRiverSource: false, isLake: false };
    }
  }
  pruneNoiseSpeckIslands(zones, rows, cols);

  const grid: MacroGrid = { rows, cols, zones };

  for (const zone of zones) {
    if (zone.isOcean) continue;
    for (const dir of DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const neighbor = zoneAt(grid, zone.row + delta.dr, zone.col + delta.dc);
      if (neighbor?.isOcean) zone.coastEdges.push(dir);
    }
  }
  applyBeachReclassification(zones);
  applyMangroveReclassification(zones);

  carveMacroRivers(grid, mulberry32(seed ^ 0x27220a95));
  // After rivers/lakes — Great Lake specifically wants to know `isLake`,
  // and Crossroads wants final `coastEdges`-adjusted land shape.
  placeLandmarks(grid, mulberry32(seed ^ 0x7ed55d16));
  // Last — territories are named after the geography is final, and a
  // territory containing a landmark takes its name (see territories.ts).
  nameTerritories(grid);
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
    riverEdges: zone.riverEdges,
  };

  return { elevation, dominantBiome: zone.isOcean ? undefined : zone.biome, landmark: zone.landmark };
}

/**
 * Chebyshev (grid-step) distance from (row, col) to the nearest zone carrying
 * `landmarkType` — `undefined` if the grid has none of that type anywhere.
 * `0` means this zone itself IS one. Feeds `immigration.ts`'s zone-level
 * banding: "certain zones (friendlier ones) don't have high levels spawn...
 * adjacent zones with changing normalized probability curves, median
 * increasing as you get further away from a particular zone" — this is the
 * "how far away" half of that; `immigration.ts`'s `zoneLevelCenter` turns
 * the distance into an actual level.
 *
 * A plain full-grid scan, not a BFS flood-fill from the landmark(s) outward —
 * deliberately: this only ever runs once per zone PROMOTION (`overworld.ts`'s
 * `promoteZone`, a rare "the observer moved to/booted into a new zone"
 * event, not a per-tick cost), so even the "hundreds of thousands of zones"
 * scale `macroGrid.test.ts` exercises is a handful of milliseconds, and a
 * scan needs no extra state — a flood-fill would either redo the same work
 * per zone anyway or require caching results across every zone up front,
 * which promoteZone's "only ever the currently-visited zone" access pattern
 * has no use for.
 */
export function distanceToNearestLandmark(grid: MacroGrid, row: number, col: number, landmarkType: LandmarkType): number | undefined {
  let best: number | undefined;
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      if (grid.zones[zoneIndex(grid, r, c)]!.landmark !== landmarkType) continue;
      const dist = Math.max(Math.abs(r - row), Math.abs(c - col));
      if (best === undefined || dist < best) best = dist;
    }
  }
  return best;
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

/**
 * A flat top-up to a landmark zone's resource estimate, on top of its
 * ordinary biome-driven baseline above — the genuinely food/water-rich
 * landmarks (a real lake, an overgrown basin, a spring) read as a real
 * abundance spike a population would actually be drawn to, not just
 * distinct scenery. `boneGrounds` gets none here: per `landmarks.ts`'s own
 * doc comment, any richness there is meant to be earned through the
 * not-yet-built corpse-decomposition passive, not handed out for free by
 * this estimate. Every other landmark is left at 0 (no bonus, no penalty)
 * — their draw is about species congregation (`LANDMARK_POPULATION_MULTIPLIER`
 * below), not raw resource abundance.
 */
const LANDMARK_RESOURCE_BONUS: Partial<Record<LandmarkType, number>> = {
  greatLake: 0.25,
  fertileBasin: 0.3,
  sacredSpring: 0.15,
  // Direct ask: "make certain zones more hospitable" — a Sanctuary reads as
  // genuinely abundant, on the same order as Fertile Basin.
  sanctuary: 0.3,
};

/** A never-visited zone's estimated `RegionAggregate.baseResourceIndex` — see `RESOURCE_ESTIMATE_SCALE`'s doc comment for why this is only an estimate, not a measurement. */
export function estimateZoneResourceIndex(zone: MacroZone): number {
  if (zone.isOcean) return OCEAN_RESOURCE_INDEX_ESTIMATE;
  const density = biomeFoodWaterDensity(zone.biome);
  const base = density ? (density.foodDensity + density.waterDensity) * RESOURCE_ESTIMATE_SCALE : 0.5;
  const bonus = zone.landmark ? (LANDMARK_RESOURCE_BONUS[zone.landmark] ?? 0) : 0;
  return Math.min(1, Math.max(0, base + bonus));
}

export interface ZoneSpeciesEstimate {
  speciesId: string;
  homeLayer: Layer;
  population: number;
  /** Carried straight from the roster entry's own `ImmigrationSpeciesInfo.minLevel` — see that field's doc comment. Absent/undefined reads as "no evolution data," same fallback `rollImmigrantLevel` already uses. */
  minLevel?: number;
  /** Carried straight from the roster entry's own `ImmigrationSpeciesInfo.singleStage` — see that field's doc comment. */
  singleStage?: boolean;
  /** Carried straight from the roster entry's own `ImmigrationSpeciesInfo.isPredator` — see that field's doc comment. */
  isPredator?: boolean;
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

/**
 * A per-species population multiplier for landmark zones that read as a
 * real congregation point rather than an ordinary patch of habitat — a
 * meteor crater, a warren's dug ground, a deep cavern all draw MULTIPLE
 * species onto the same limited real estate instead of thinning any one
 * out. This is deliberately a multiplier on every fitting species (not a
 * pick-one-winner boost), so the actual emergent payoff — several
 * populations packed onto the landmark's small footprint — is real
 * pressure on the same scarce tiles once promoted, exactly the setup
 * `herdConflict.ts`'s existing cross-species rivalry trigger already fires
 * on for free. Landmarks not listed here (springs, basins, lakes) are left
 * at 1 — richness there is about abundance, not crowding.
 */
const LANDMARK_POPULATION_MULTIPLIER: Partial<Record<LandmarkType, number>> = {
  meteorCrater: 1.6,
  tunnelWarren: 1.5,
  deepCavern: 1.4,
  crossroads: 1.3,
};

/**
 * A never-visited zone only ever seeds a SMALL pocket of its habitat's
 * fitting species, not every single one that could theoretically live
 * there. Direct ask: "just cuz a zone can support a bunch of different
 * Pokemon, doesn't mean it should. It should just have a smaller variety of
 * species per zone... by chance, they just have different pockets of
 * species" — a real biome (e.g. wetland) can have 15 roster species tagged
 * for it, and every prior fresh-zone promotion invented ALL of them at
 * once, so every wetland zone in the whole world looked like the same
 * fully-stocked checklist instead of feeling like its own distinct pocket
 * of nature. `[ZONE_SPECIES_POOL_MIN, ZONE_SPECIES_POOL_MAX]` (a real range
 * rolled per zone, not a fixed count, so pockets vary in richness too, not
 * just membership) caps how many of the fitting species actually get
 * invented — picked via `pickZoneSpeciesPool`'s partial shuffle, so which
 * subset survives is deterministic per zone (same `mw.rng` every other
 * zone-invention roll already uses) but varies zone to zone, biome to
 * biome. A habitat with fewer fitting species than the cap (e.g. snow's 4)
 * is simply left alone — nothing to trim. Raised from 3-6 to 4-7, direct
 * follow-up ask once this first shipped: "add like a little species. More
 * throughout? Each zone should have at least 4, max 7 to start" — richer
 * "to start" (a zone still isn't capped forever; population/species mix
 * keeps evolving via ordinary migration/reproduction after promotion,
 * this only bounds what a genuinely fresh zone is invented with).
 */
const ZONE_SPECIES_POOL_MIN = 4;
const ZONE_SPECIES_POOL_MAX = 7;
/**
 * A congregation-type landmark (see `LANDMARK_POPULATION_MULTIPLIER`) is
 * explicitly meant to draw MULTIPLE species onto the same limited real
 * estate — the opposite instinct from an ordinary zone's smaller pocket —
 * so its pool cap gets a real bonus on top of the ordinary range instead of
 * being trimmed the same way.
 */
const LANDMARK_SPECIES_POOL_BONUS = 3;
/**
 * How many of a zone's pool slots can be predator species — direct ask:
 * "try to have at least some predators + prey per each zone typically. With
 * a smaller number of predators." Deliberately small relative to
 * `ZONE_SPECIES_POOL_MIN`/`_MAX` (4-7, or up to 10 with a congregation
 * landmark's bonus): a zone should feel like it has real hunters in it, not
 * be dominated by them — see `pickZoneSpeciesPool`'s own doc comment for how
 * this actually gets enforced. A congregation landmark's real "draw multiple
 * species together" bonus still applies proportionally more to prey than
 * predators, same "smaller number" intent even at a richer site. Raised
 * from 1 (+1 landmark) to 2 (+2 landmark) — direct follow-up ask once a cap
 * of exactly 1 shipped: "our species changes have removed too many
 * predators" — a hard cap of 1 meant a zone with several real predator
 * species fitting its biome (e.g. badlands: Onix/Growlithe/Zubat/Golbat) only
 * ever showed a single one, every time, never any actual variety even
 * though the roster has real predator diversity now.
 */
const ZONE_PREDATOR_POOL_CAP = 2;
const LANDMARK_PREDATOR_POOL_BONUS = 2;
/**
 * A predator's own invented population is scaled down relative to what the
 * exact same formula would give an ordinary prey/neutral species — real
 * ecology (a hunting guild is always thinner on the ground than what it
 * hunts) backing the same "smaller number of predators" direct ask
 * `ZONE_PREDATOR_POOL_CAP` addresses at the species level; this is the
 * individual-count half of it. Raised from 0.4 to 0.55 alongside the pool
 * cap above, same direct follow-up ask ("removed too many predators") —
 * still meaningfully thinner than prey, just not so thin a real predator
 * presence read as negligible.
 */
const PREDATOR_POPULATION_DISCOUNT = 0.55;
/**
 * A hard ceiling on one predator species' own invented population, on top
 * of `PREDATOR_POPULATION_DISCOUNT`'s proportional thinning — direct
 * report: "Kabutops are just utterly slaughtering everything... make high
 * level predators like no more than 2 in a zone." A real generated zone
 * measured before this cap: Kabutops (its own real evolution floor, level
 * 40, plus `immigration.ts`'s `PREDATOR_LEVEL_BOOST`) was spawning at
 * level 46-51 against co-spawned prey — Shellder/Psyduck/Krabby — rolling
 * as low as level 5 in the SAME zone, a 40+ level gap; population itself
 * was already only 5-7 (the existing discount above was already working
 * as designed). The level gap is the deeper cause and this cap alone
 * doesn't fix it (even 2 individuals at level 50 among level-5 prey is
 * still a massacre) — flagged separately, not solved here. This constant
 * is the real, requested piece: fewer high-level killers doing the
 * damage, whatever the level gap turns out to be.
 */
const PREDATOR_POPULATION_CAP = 2;

/**
 * Direct ask: "make certain zones more hospitable and prey friendly." A
 * Sanctuary zone (`landmarks.ts`'s new landmark type) caps its predator
 * species pool tighter than an ordinary zone's own `ZONE_PREDATOR_POOL_CAP`
 * (2, or up to 4 at a congregation landmark) — real safety in numbers,
 * genuinely fewer distinct hunting species call it home at all, not just a
 * thinner population of whichever ones do. `sanctuary` is not itself a
 * congregation-type landmark (not in `LANDMARK_POPULATION_MULTIPLIER`), so
 * this override replaces the ordinary cap rather than composing with the
 * congregation bonus — the two kinds of "special zone" are mutually
 * exclusive per zone anyway (`placeLandmarks` gives each zone at most one
 * landmark).
 */
const SANCTUARY_PREDATOR_POOL_CAP = 1;
/**
 * On top of the tighter species-pool cap above, a Sanctuary further thins
 * whatever predator population does show up — composes multiplicatively
 * with the ordinary `PREDATOR_POPULATION_DISCOUNT`, so a Sanctuary's
 * predator population lands well below even an ordinary zone's already-
 * discounted one. Real, not just "fewer predator species": the ones that
 * are there are also a smaller pack.
 */
const SANCTUARY_PREDATOR_POPULATION_DISCOUNT = 0.6;
/**
 * A Sanctuary's own prey population gets a real bonus multiplier, on top of
 * the landmark's resource-richness bump (`LANDMARK_RESOURCE_BONUS`) — the
 * genuinely "prey friendly" half of the ask, not just "predator-thin."
 */
const SANCTUARY_PREY_POPULATION_MULTIPLIER = 1.4;

/**
 * Deterministically (via `rng`, the zone's own seeded stream) picks up to
 * `n` entries from `list`, preserving none of the original order (a partial
 * Fisher-Yates shuffle — only as many swaps as `n` needs, not a full shuffle
 * of the whole list) — the shared subset-picking primitive behind
 * `pickZoneSpeciesPool`'s predator/prey balance below. Returns every entry,
 * unmodified order and all, when `list` is already at or under `n` — nothing
 * to trim, and no reason to consume extra `rng()` calls for a shuffle that
 * wouldn't change the outcome.
 */
function pickRandomSubset<T>(list: readonly T[], n: number, rng: () => number): T[] {
  if (list.length <= n) return [...list];
  const pool = [...list];
  const picked: T[] = [];
  for (let i = 0; i < n; i++) {
    const idx = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[idx]] = [pool[idx]!, pool[i]!];
    picked.push(pool[i]!);
  }
  return picked;
}

/**
 * A never-visited zone's species pool, deliberately balanced rather than a
 * plain random draw across every fitting species — direct ask: "try to have
 * at least some predators + prey per each zone typically. With a smaller
 * number of predators." Splits `fitting` into predators and everything else
 * (prey/neutral), picks up to `ZONE_PREDATOR_POOL_CAP` (+ a landmark's own
 * small bonus) predators first, then fills the REST of the pool with
 * prey/neutral species — so a zone whose habitat has any real hunters in it
 * gets at least one, but is never dominated by them the way a plain uniform
 * random draw across all fitting species occasionally would. A habitat with
 * zero fitting predator species (this roster's desert biome, say) simply
 * gets an all-prey pool — nothing to force.
 *
 * `predatorCapOverride`, when given, REPLACES the ordinary
 * `ZONE_PREDATOR_POOL_CAP` (+ congregation bonus) math entirely rather than
 * composing with it — currently only `estimateZoneSpecies`'s Sanctuary case
 * (`SANCTUARY_PREDATOR_POOL_CAP`), see that constant's own doc comment for
 * why the two "special zone" mechanisms don't need to compose.
 */
function pickZoneSpeciesPool(fitting: readonly ImmigrationSpeciesInfo[], poolBonus: number, isCongregationLandmark: boolean, predatorCapOverride: number | undefined, rng: () => number): ImmigrationSpeciesInfo[] {
  // `ZONE_SPECIES_POOL_MIN`/`_MAX` (4-7) only ever trims a biome with MORE
  // fitting species than that — a thin biome (this roster's Beach: 5,
  // Tundra: 3, Desert/Snow: 5) always had `fitting.length <= poolSize`,
  // so `pickZoneSpeciesPool` returned every fitting species, EVERY zone,
  // unconditionally. Direct report, confirmed by a real generated 60x60
  // grid before this fix: 12 of 15 real Beach zones showed the identical
  // full 5-species pool, and Krabby (fitting every one) appeared in all
  // 15 — "I don't have to see a million krabby on every single beach
  // zone... maybe some of em have seel or whatever and no krabby's."
  // `lowerBound` now scales DOWN with a thin biome's own `fitting.length`
  // (floored at 2 — omitting down to a single species reads as "empty",
  // not "a real distinct pocket") instead of always floating at the fixed
  // `ZONE_SPECIES_POOL_MIN`, so `poolSize` can land below `fitting.length`
  // even for a thin biome and real omission actually has a chance to fire.
  // A rich biome (Wetland: 26, Forest: 15, ...) is completely unaffected —
  // `Math.min(ZONE_SPECIES_POOL_MIN, fitting.length - 1)` still resolves to
  // the same fixed `ZONE_SPECIES_POOL_MIN` whenever `fitting.length` is
  // comfortably above it, so this is purely additive for thin biomes.
  // Scales with HALF of `fitting.length`, not a flat `fitting.length - 1` —
  // a first attempt at that flat version only ever dropped exactly one
  // species, which barely moved the needle for a thin biome: re-measured,
  // Krabby (fitting all 5 real Beach species) still showed up in 91.5% of
  // 1,218 real generated Beach zones (5 seeds, 60x60 grids) — one dropped
  // slot out of five just isn't a big enough perturbation to feel like real
  // variety. Halving instead gives Beach a real 3-5 range (drop 0-2 of 5),
  // Tundra (3 fitting) a real 2-3 range — a real chance some zones settle
  // on a genuinely different, smaller pocket, matching the direct ask:
  // "I don't have to see a million krabby on every single beach zone...
  // maybe some of em have seel or whatever and no krabby's."
  // `fitting.length <= 2` forces `lowerBound` up to `fitting.length` itself
  // (no real trimming possible/desirable at that point — see this
  // function's own doc comment) while still drawing exactly one `rng()`
  // call below either way, matching the original unconditional single draw
  // this function always made — a version that skipped the draw entirely
  // for this case shifted every OTHER `rng()`-consuming call downstream in
  // the same seeded stream, a real regression a `promoteZone` test caught
  // (an evolved species' seeded level jitter came out different for a
  // reason that had nothing to do with levels at all).
  // A predator's own `rarity` now ALSO gates whether it's even a candidate
  // for THIS zone at all, independent per-species roll, before any of the
  // pool-size/trimming math below — direct report: "kabutops are just
  // utterly slaughtering everything... I think the level 40 gap can
  // happen, it should just be rare." Beach's fitting predator list is a
  // single species (Kabutops) — every earlier mechanism here (the
  // pool-size trim, the predator-cap split) still guaranteed its inclusion
  // whenever a predator slot got filled at all, since "pick up to N from a
  // list of exactly 1" is deterministic regardless of N. Rolled BEFORE
  // `fitting.length` gets used for anything (including the thin-biome
  // trimming above, and the `fitting.length <= poolSize` early return
  // right below) so an excluded predator is genuinely ABSENT from this
  // zone's pool, not just population-thinned once present — the actual
  // "occurrence should be rare" the report asked for, not another
  // reduction on top of `PREDATOR_POPULATION_CAP`'s existing one. `rarity`
  // was already documented as "a multiplier on how often this species
  // shows up" (`ImmigrationSpeciesInfo.rarity`'s own doc comment) — this
  // is that stated intent actually reaching zone-seeding, which it never
  // did before (only `estimateZoneSpecies`'s population math read it).
  // Non-predators are untouched (`!s.isPredator` short-circuits before the
  // roll) — this doesn't change ordinary prey/neutral selection at all.
  const candidates = fitting.filter((s) => !s.isPredator || rng() < (s.rarity ?? 1));

  const lowerBound = candidates.length <= 2 ? candidates.length : Math.max(2, Math.min(ZONE_SPECIES_POOL_MIN + poolBonus, Math.floor(candidates.length / 2)));
  const upperBound = Math.min(ZONE_SPECIES_POOL_MAX + poolBonus, candidates.length);
  const poolSize = lowerBound + Math.floor(rng() * Math.max(0, upperBound - lowerBound + 1));
  if (candidates.length <= poolSize) return [...candidates];

  const predators = candidates.filter((s) => s.isPredator);
  const prey = candidates.filter((s) => !s.isPredator);
  const predatorCap = predatorCapOverride ?? ZONE_PREDATOR_POOL_CAP + (isCongregationLandmark ? LANDMARK_PREDATOR_POOL_BONUS : 0);
  const pickedPredators = pickRandomSubset(predators, Math.min(predatorCap, poolSize), rng);
  const pickedPrey = pickRandomSubset(prey, poolSize - pickedPredators.length, rng);
  return [...pickedPredators, ...pickedPrey];
}

export function estimateZoneSpecies(zone: MacroZone, roster: readonly ImmigrationSpeciesInfo[], rng: () => number): ZoneSpeciesEstimate[] {
  const estimates: ZoneSpeciesEstimate[] = [];
  const multiplier = zone.landmark ? (LANDMARK_POPULATION_MULTIPLIER[zone.landmark] ?? 1) : 1;
  const isCongregationLandmark = zone.landmark !== undefined && LANDMARK_POPULATION_MULTIPLIER[zone.landmark] !== undefined;
  // Direct ask: "make certain zones more hospitable and prey friendly" —
  // see SANCTUARY_PREDATOR_POOL_CAP/_PREDATOR_POPULATION_DISCOUNT/_PREY_
  // POPULATION_MULTIPLIER's own doc comments for the three real mechanics
  // this flag gates below.
  const isSanctuary = zone.landmark === "sanctuary";
  const fitting = roster.filter((species) => speciesFitsZone(species, zone));
  const pool = pickZoneSpeciesPool(
    fitting,
    isCongregationLandmark ? LANDMARK_SPECIES_POOL_BONUS : 0,
    isCongregationLandmark,
    isSanctuary ? SANCTUARY_PREDATOR_POOL_CAP : undefined,
    rng
  );
  for (const species of pool) {
    const populationMultiplier =
      (species.isPredator ? PREDATOR_POPULATION_DISCOUNT : isSanctuary ? SANCTUARY_PREY_POPULATION_MULTIPLIER : 1) *
      // See `ImmigrationSpeciesInfo.rarity`'s own doc comment — direct ask:
      // "make arboks less common."
      (species.rarity ?? 1);
    let population = (SEED_POPULATION_BASE + rng() * SEED_POPULATION_VARIANCE) * multiplier * populationMultiplier;
    if (species.isPredator) {
      // `PREDATOR_POPULATION_CAP` applied BEFORE the Sanctuary-specific
      // extra discount, not composed into one combined multiplier — a flat
      // ceiling would otherwise clamp an ordinary zone's already-modest
      // predator population (typically 2.2-7.7 pre-cap) down to the SAME
      // number a Sanctuary's own further-discounted population lands on,
      // erasing the real "Sanctuary is even thinner on predators" signal
      // this function's own Sanctuary test checks for. Capping first, then
      // discounting the Sanctuary case on top of that already-capped
      // number, keeps Sanctuary's population strictly lower than an
      // ordinary zone's, same as every other Sanctuary mechanic here.
      population = Math.min(PREDATOR_POPULATION_CAP, population);
      if (isSanctuary) population *= SANCTUARY_PREDATOR_POPULATION_DISCOUNT;
    }
    estimates.push({
      speciesId: species.id,
      homeLayer: species.homeLayer,
      population,
      minLevel: species.minLevel,
      singleStage: species.singleStage,
      isPredator: species.isPredator,
    });
  }
  return estimates;
}
