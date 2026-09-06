import type { MacroGrid, MacroZone } from "./macroGrid.js";
import { DIRECTIONS, DIRECTION_DELTA } from "./directions.js";

/**
 * Rare, real points of interest on the macro grid — direct ask: "more
 * character, more points of interest," refined into "natural places," per
 * mainline Pokémon's own well of real location archetypes (Mt. Moon,
 * Cerulean Cave, Diglett's Cave, Lavender Tower, Seafoam Islands) but with
 * every human-built one filtered out — a meteorite impact, a cave system, a
 * colony's own dug burrows, and animal behavior (a species' own "return
 * here to die" instinct) are all real without implying anyone constructed
 * anything. Each type is placed sparsely (`placeLandmarks`, a handful per
 * whole grid — see `LANDMARK_DEFS`' own `chancePerEligibleZone`), carries
 * REAL mechanical hooks other systems actually read (`overworld.ts`'s
 * `landmarkResourceBonus`/`landmarkSpeciesBias`), and gets genuinely
 * distinct terrain once promoted (`worldgen.ts`'s `applyLandmarkFeature`) —
 * not just a name on the map.
 *
 * The real emergent payoff, per direct ask ("interesting points of conflict
 * and emergent stuff"): a landmark's population/species-mix boost
 * deliberately favors MULTIPLE species congregating on the same limited
 * tiles, not a single monoculture — `herdConflict.ts`'s real resource-
 * contention rivalry trigger (a sustained blocked-tile standoff, cross-
 * species included) already exists and needs no new code to fire more
 * often exactly where several herds are drawn to the same scarce water/food
 * a landmark concentrates. A landmark becomes a real "fought over" place
 * through an existing mechanic doing what it already does, just under
 * denser, more contested conditions.
 */
export type LandmarkType =
  | "greatLake"
  | "fertileBasin"
  | "sacredSpring"
  | "geothermalVent"
  | "meteorCrater"
  | "deepCavern"
  | "tunnelWarren"
  | "boneGrounds"
  | "frozenGrotto"
  | "crossroads";

export const LANDMARK_TYPES: readonly LandmarkType[] = [
  "greatLake",
  "fertileBasin",
  "sacredSpring",
  "geothermalVent",
  "meteorCrater",
  "deepCavern",
  "tunnelWarren",
  "boneGrounds",
  "frozenGrotto",
  "crossroads",
];

interface LandmarkDef {
  /** Real, human-readable name — narrative color for the macro map/UI. */
  name: string;
  /** Which biomes a zone must already be classified as to be eligible — absent = eligible everywhere land (still ocean-excluded). */
  eligibleBiomes?: readonly string[];
  /** If set, only a zone already flagged this way (from river carving) is eligible — currently only Great Lake, reusing `isLake` for real instead of leaving it dead. */
  requiresLake?: boolean;
  /** If set, only a zone with at least this many non-ocean orthogonal neighbors is eligible — a real geographic junction, currently only Crossroads. */
  minLandNeighbors?: number;
  /**
   * Independent per-eligible-zone roll each landmark type gets during
   * placement — deliberately tiny: these are meant to read as rare, findable
   * spots on a real map, not a common decoration. Capped by `maxCount`
   * regardless of how many zones would otherwise roll true.
   */
  chancePerEligibleZone: number;
  /** Hard cap on how many of this type can exist on one grid, regardless of `chancePerEligibleZone` — keeps a huge (hundreds-of-thousands-of-zones) grid from drowning in "rare" landmarks. */
  maxCount: number;
}

/**
 * Every numeric value here is a sim-original guess to be judged against a
 * real generated grid, exactly like every other tuning table in this
 * codebase (`BIOME_WEATHER_AFFINITY`, `BIOMES`, etc.) — not remotely canon.
 */
export const LANDMARK_DEFS: Record<LandmarkType, LandmarkDef> = {
  greatLake: {
    name: "Great Lake",
    requiresLake: true,
    chancePerEligibleZone: 0.35,
    maxCount: 6,
  },
  fertileBasin: {
    name: "Fertile Basin",
    eligibleBiomes: ["grassland", "forest", "jungle", "wetland"],
    chancePerEligibleZone: 0.0006,
    maxCount: 8,
  },
  sacredSpring: {
    name: "Sacred Spring",
    eligibleBiomes: ["wetland", "jungle", "snow"],
    chancePerEligibleZone: 0.0006,
    maxCount: 6,
  },
  geothermalVent: {
    name: "Geothermal Vent",
    eligibleBiomes: ["badlands", "desert", "highland"],
    chancePerEligibleZone: 0.0006,
    maxCount: 6,
  },
  meteorCrater: {
    name: "Meteor Crater",
    // Any land biome — a real impact site doesn't care what grew there after.
    chancePerEligibleZone: 0.00015,
    maxCount: 4,
  },
  deepCavern: {
    name: "Deep Cavern",
    eligibleBiomes: ["highland", "badlands", "desert"],
    chancePerEligibleZone: 0.0006,
    maxCount: 6,
  },
  tunnelWarren: {
    name: "Tunnel Warren",
    eligibleBiomes: ["badlands", "grassland", "desert"],
    chancePerEligibleZone: 0.0006,
    maxCount: 6,
  },
  boneGrounds: {
    name: "Bone Grounds",
    eligibleBiomes: ["badlands", "desert", "highland"],
    chancePerEligibleZone: 0.0004,
    maxCount: 4,
  },
  frozenGrotto: {
    name: "Frozen Grotto",
    eligibleBiomes: ["snow"],
    chancePerEligibleZone: 0.002,
    maxCount: 4,
  },
  crossroads: {
    name: "Crossroads",
    minLandNeighbors: 3,
    chancePerEligibleZone: 0.001,
    maxCount: 6,
  },
};

function countLandNeighbors(zones: readonly MacroZone[], rows: number, cols: number, row: number, col: number): number {
  let count = 0;
  for (const dir of DIRECTIONS) {
    const delta = DIRECTION_DELTA[dir];
    const nr = row + delta.dr;
    const nc = col + delta.dc;
    if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
    if (!zones[nr * cols + nc]!.isOcean) count++;
  }
  return count;
}

function isEligible(zones: readonly MacroZone[], rows: number, cols: number, zone: MacroZone, def: LandmarkDef): boolean {
  if (zone.isOcean || zone.landmark) return false;
  if (def.requiresLake && !zone.isLake) return false;
  if (def.eligibleBiomes && !def.eligibleBiomes.includes(zone.biome)) return false;
  if (def.minLandNeighbors !== undefined && countLandNeighbors(zones, rows, cols, zone.row, zone.col) < def.minLandNeighbors) return false;
  return true;
}

/**
 * Scatters every landmark type across the grid — one independent pass per
 * type, in `LANDMARK_TYPES` order, each zone getting at most one landmark
 * (first type to claim it wins; a zone already claimed by an earlier type
 * is simply ineligible for a later one, same "first-come" simplicity
 * `pruneNoiseSpeckIslands` and friends already use elsewhere in this file).
 * Deterministic for a given rng, same contract as every other generation
 * step here.
 */
export function placeLandmarks(grid: MacroGrid, rng: () => number): void {
  const { zones, rows, cols } = grid;
  for (const type of LANDMARK_TYPES) {
    const def = LANDMARK_DEFS[type];
    let count = 0;
    for (const zone of zones) {
      if (count >= def.maxCount) break;
      if (!isEligible(zones, rows, cols, zone, def)) continue;
      if (rng() < def.chancePerEligibleZone) {
        zone.landmark = type;
        count++;
      }
    }
  }
}
