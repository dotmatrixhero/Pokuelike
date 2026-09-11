import type { Layer, TerrainKind, World } from "./types.js";
import type { MaterialId } from "./harvest.js";
import { LAYER_ORDER } from "./types.js";
import { tileAt } from "./world.js";
import { biomeWeightsAt } from "./worldgen.js";

/**
 * Decals: the small things standing on a tile — a fallen log, a cut stump, a
 * boulder, a bone spur, a mushroom cluster, a shell, a barrel.
 *
 * These used to live entirely in the renderer as a stateless hash of
 * `(x, y, biome, layer)`. Nothing in the engine could see them, which meant
 * the art and the rules disagreed about the same tile: `harvest.ts` decided
 * what you could gather from PROXIMITY HEURISTICS ("deadwood if a sunbeam is
 * within range", "flint if a wall is within 1") while the renderer drew an
 * actual log on a specific tile and ignored it. You could stand on a drawn log
 * and be told there was no deadwood. Direct asks:
 *
 *   "I want the gather button to allow you gather appropriate materials based
 *    on the decals"
 *   "So like make them proper tiles in the data that represent something data
 *    wise"
 *
 * So a decal is now real data on the `Tile` (`scatterDecal`/`featureDecal`),
 * placed by worldgen, gathered off by `harvest.ts`, and consumed when it is.
 * The hash did not go away, though — it is still the oracle for what NATURALLY
 * belongs on a tile, which is what `tickHarvestRegrowth` regrows a picked fern
 * back from. Placement is data; what would be there is still a pure function.
 */
export type DecalId =
  | "barrel_1" | "barrel_2" | "barrel_3"
  | "blade_cold_1" | "blade_cold_2"
  | "bloom_1" | "bloom_2"
  | "bones_1" | "bones_2" | "bones_3" | "bones_4"
  | "boulder_1"
  | "cactus_1" | "cactus_2"
  | "cattail_1"
  | "fence_wood_1"
  | "fern_1"
  | "flower_red_1"
  | "lily_1" | "lily_2"
  | "log_1" | "log_mossy_1"
  | "moss_1"
  | "reed_1"
  | "rock_sea_1"
  | "shell_1"
  | "shroom_orange_1" | "shroom_red_1" | "shroom_red_2"
  | "sign_danger_1"
  | "stump_cut_1" | "stump_cut_2" | "stump_oak_1" | "stump_oak_2" | "stump_ring_1"
  | "succulent_1"
  | "tuft_dry_1" | "tuft_dry_2" | "tuft_dry_3" | "tuft_green_1";

/** Where a decal can sit. Lilies float; everything else stands on dry ground. */
export type DecalFooting = "ground" | "water";

export interface DecalSpec {
  /**
   * What gathering this decal hands you, one unit each, on every take.
   * Empty means the decal is scenery you cannot pick up — the DANGER sign is
   * there to *say* something, not to be carried off.
   */
  yields: readonly MaterialId[];
  /**
   * Does it come back? A picked mushroom cluster or fern regrows with the
   * tile; a felled stump, a smashed barrel or a gathered boulder does not.
   * This is per decal and not one global rule because the global rule reads
   * wrong in both directions — a stump regrowing in 300 ticks is absurd, and
   * a moss patch that never returns strips a biome permanently.
   */
  regrows: boolean;
  footing: DecalFooting;
  /**
   * Stands up off the ground, so the renderer gives it a contact shadow and a
   * lit rim. Not a size test: `moss_1` and `fern_1` are both 32x32 and both in
   * the fine pool, but one IS the ground and the other is a plant on it.
   */
  standing: boolean;
}

const GROUND_COVER = { yields: ["fiber"] as const, regrows: true, footing: "ground" as const, standing: false };
const PLANT = { yields: ["fiber"] as const, regrows: true, footing: "ground" as const, standing: true };
const DEADWOOD = { yields: ["deadwood"] as const, regrows: false, footing: "ground" as const, standing: true };
const STONE = { yields: ["flint"] as const, regrows: false, footing: "ground" as const, standing: true };

export const DECALS: Record<DecalId, DecalSpec> = {
  // Ground cover. Regrows, and it is the fine scatter layer, so it is on a
  // large fraction of tiles — fiber is deliberately the one abundant material.
  moss_1: GROUND_COVER,
  tuft_dry_1: GROUND_COVER,
  tuft_dry_2: GROUND_COVER,
  tuft_dry_3: GROUND_COVER,
  tuft_green_1: GROUND_COVER,
  blade_cold_1: GROUND_COVER,
  blade_cold_2: GROUND_COVER,
  bloom_1: { yields: ["herbs"], regrows: true, footing: "ground", standing: false },
  bloom_2: { yields: ["herbs"], regrows: true, footing: "ground", standing: false },
  flower_red_1: { yields: ["herbs"], regrows: true, footing: "ground", standing: false },
  fern_1: PLANT,
  reed_1: PLANT,
  cattail_1: PLANT,
  succulent_1: PLANT,
  cactus_1: PLANT,
  cactus_2: PLANT,
  shroom_red_1: { yields: ["shroom"], regrows: true, footing: "ground", standing: true },
  shroom_red_2: { yields: ["shroom"], regrows: true, footing: "ground", standing: true },
  shroom_orange_1: { yields: ["shroom"], regrows: true, footing: "ground", standing: true },

  // Deadwood. A log is the visible cause the old "is there a sunbeam nearby"
  // rule was standing in for.
  log_1: DEADWOOD,
  log_mossy_1: DEADWOOD,
  stump_oak_1: DEADWOOD,
  stump_oak_2: DEADWOOD,
  stump_cut_1: DEADWOOD,
  stump_cut_2: DEADWOOD,
  stump_ring_1: DEADWOOD,
  fence_wood_1: DEADWOOD,

  // Stone. Likewise the visible cause behind "is there a wall within 1".
  boulder_1: STONE,
  rock_sea_1: STONE,

  bones_1: { yields: ["bone"], regrows: false, footing: "ground", standing: true },
  bones_2: { yields: ["bone"], regrows: false, footing: "ground", standing: true },
  bones_3: { yields: ["bone"], regrows: false, footing: "ground", standing: true },
  bones_4: { yields: ["bone"], regrows: false, footing: "ground", standing: true },
  shell_1: { yields: ["shell"], regrows: false, footing: "ground", standing: true },

  // Worked junk. A barrel is salvage; the sign is not.
  barrel_1: { yields: ["scrap"], regrows: false, footing: "ground", standing: true },
  barrel_2: { yields: ["scrap"], regrows: false, footing: "ground", standing: true },
  barrel_3: { yields: ["scrap"], regrows: false, footing: "ground", standing: true },
  sign_danger_1: { yields: [], regrows: false, footing: "ground", standing: true },

  // Floats. Not standable, so not gatherable on foot either.
  lily_1: { yields: [], regrows: true, footing: "water", standing: false },
  lily_2: { yields: [], regrows: true, footing: "water", standing: false },
};

/**
 * The off-grid scatter layer: which decals a biome scatters over its ground.
 *
 * This is the technique the source art uses to stop reading as a grid — not
 * base-tile variety. The renderer places these at hash-jittered sub-tile
 * offsets at their NATIVE size, so a 32x24 decal straddles two tiles and lands
 * wherever the jitter puts it rather than snapping to a tile origin.
 */
export const BIOME_SCATTER: Record<string, readonly DecalId[]> = {
  grassland: ["bloom_1", "bloom_2", "flower_red_1", "tuft_green_1"],
  forest: ["fern_1", "bloom_1", "flower_red_1", "moss_1", "shroom_red_1", "shroom_red_2", "shroom_orange_1"],
  jungle: ["fern_1", "reed_1", "tuft_green_1", "moss_1", "shroom_red_2", "shroom_orange_1"],
  wetland: ["reed_1", "lily_1", "moss_1", "tuft_green_1", "shroom_red_1"],
  mangrove: ["reed_1", "lily_1", "lily_2", "moss_1"],
  badlands: ["tuft_dry_1", "tuft_dry_2", "succulent_1"],
  desert: ["tuft_dry_1", "tuft_dry_3", "succulent_1"],
  beach: ["tuft_dry_2", "tuft_dry_3"],
  savanna: ["tuft_dry_1", "tuft_dry_2", "tuft_dry_3", "succulent_1"],
  highland: ["moss_1", "tuft_dry_1", "tuft_green_1"],
  tundra: ["blade_cold_2", "moss_1", "tuft_dry_2"],
  snow: ["blade_cold_1", "blade_cold_2"],
};

/**
 * The sparse FEATURE layer: landmark-sized art, scattered far more thinly.
 *
 * Separate from `BIOME_SCATTER` because size and density are coupled, and now
 * because SCARCITY is too. Anything in the fine layer is on a large fraction
 * of tiles; the sparse layer is where a find is actually a find.
 */
export const BIOME_FEATURES: Record<string, readonly DecalId[]> = {
  grassland: ["boulder_1", "log_1", "stump_oak_1", "stump_cut_1"],
  forest: ["log_1", "log_mossy_1", "boulder_1", "stump_ring_1", "stump_oak_1", "stump_oak_2", "stump_cut_1", "stump_cut_2"],
  jungle: ["log_1", "log_mossy_1", "boulder_1", "stump_oak_2", "stump_cut_2"],
  wetland: ["cattail_1", "log_1", "log_mossy_1", "stump_oak_2"],
  mangrove: ["cattail_1", "log_1", "log_mossy_1"],
  // Worked junk, not scenery: a quarry should read as somewhere somebody dug.
  badlands: ["cactus_1", "boulder_1", "rock_sea_1", "barrel_1", "barrel_2", "barrel_3", "sign_danger_1", "fence_wood_1"],
  desert: ["cactus_1", "cactus_2", "boulder_1", "rock_sea_1"],
  // `shell_1` is a FEATURE, not ground detail. In the fine layer it drew 338
  // times in one frame on a map that is 83% beach — a third as dense as the
  // grass tufts, which reads as a shell beach, not a shell.
  beach: ["log_1", "boulder_1", "rock_sea_1", "shell_1"],
  savanna: ["cactus_1", "boulder_1", "log_1", "stump_oak_1"],
  highland: ["boulder_1", "rock_sea_1"],
  tundra: ["boulder_1", "log_1", "stump_cut_1"],
  snow: ["boulder_1", "log_1", "stump_cut_2"],
};

const SCATTER_DEFAULT: readonly DecalId[] = ["moss_1", "tuft_green_1"];
const FEATURE_DEFAULT: readonly DecalId[] = ["boulder_1"];

/**
 * Underground pools. The cave is not a biome — it shares the surface's
 * coordinates — so before this it scattered whatever the zone ABOVE it did,
 * which on a beach-dominated map meant dry grass tufts in a cave.
 *
 * The cave gets NO fine scatter layer. Bones went there first and drew ~2,270
 * times in one frame — ground-cover density, which reads as a boneyard rather
 * than as a find.
 */
const CAVE_SCATTER: readonly DecalId[] = [];
const CAVE_FEATURES: readonly DecalId[] = ["bones_1", "bones_2", "bones_3", "bones_4", "boulder_1", "rock_sea_1"];

/** One tile in this many carries a fine scatter decal. */
export const SCATTER_ONE_IN = 7;
/** One tile in this many carries a landmark feature. Much sparser — see `BIOME_FEATURES`. */
export const FEATURE_ONE_IN = 47;

export type DecalSlot = "scatter" | "feature";

const SALT: Record<DecalSlot, { x: number; y: number; oneIn: number }> = {
  scatter: { x: 31337, y: 7919, oneIn: SCATTER_ONE_IN },
  feature: { x: 15485863, y: 32452843, oneIn: FEATURE_ONE_IN },
};

export function hashTile(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Where a decal sits within its tile: a stable sub-tile offset in [-0.5, 0.5].
 *
 * A second, independent hash from the one that picks the decal, so two tiles
 * that rolled the same decal don't also land at the same offset. This stays a
 * pure function of the coordinate even though the decal itself is now data —
 * it is presentation, not state, and there is nothing to gain by storing it.
 */
export function decalJitter(x: number, y: number, slot: DecalSlot): { x: number; y: number } {
  const j = hashTile(x + SALT[slot].x + 104729, y + SALT[slot].y + 1299709);
  return { x: ((j % 16) / 16) - 0.5, y: ((Math.floor(j / 16) % 16) / 16) - 0.5 };
}

/** Terrain a ground decal can stand on. Everything else is water, solid, or already carrying its own art (a crop, a seedling, a shelter). */
const DECAL_GROUND: ReadonlySet<TerrainKind> = new Set<TerrainKind>(["floor", "sunbeam", "flora", "mud", "sand", "stone"]);

/**
 * Can this tile carry a decal with this footing?
 *
 * This gate is new with the move into data, and it is a fix, not just a port.
 * The renderer's scatter pass ran over every tile in view with no terrain
 * check at all, so decals drew on top of water, walls and trees — which is why
 * lily pads were landing on dry ground and tufts were floating out to sea.
 */
export function tileTakesDecal(terrain: TerrainKind, footing: DecalFooting): boolean {
  return footing === "water" ? terrain === "water" : DECAL_GROUND.has(terrain);
}

/**
 * What NATURALLY belongs in this slot on this tile, ignoring whatever is
 * actually there now. The oracle worldgen places from and regrowth restores
 * from — a pure function of position, biome and layer, exactly as the
 * renderer's hash always was.
 */
export function naturalDecalAt(world: World, layer: Layer, x: number, y: number, slot: DecalSlot): DecalId | undefined {
  const tile = tileAt(world, layer, x, y);
  if (!tile) return undefined;
  // The canopy is treetops. A first run of this pass put boulders and fallen
  // logs up there (5-7 per 60x60 zone) because the old renderer's hash never
  // asked what layer it was on either -- it just never showed, since nothing
  // was looking at the canopy with decals on.
  if (layer === "canopy") return undefined;
  const underground = layer !== "surface";
  const pools = slot === "scatter" ? BIOME_SCATTER : BIOME_FEATURES;
  const fallback = underground
    ? slot === "scatter" ? CAVE_SCATTER : CAVE_FEATURES
    : slot === "scatter" ? SCATTER_DEFAULT : FEATURE_DEFAULT;
  const biome = underground ? undefined : dominantBiomeAt(world, x, y);
  const pool = (biome ? pools[biome] : undefined) ?? fallback;
  if (pool.length === 0) return undefined;

  const salt = SALT[slot];
  // Offset so "which tiles get a decal" doesn't correlate with anything else
  // keyed off (x, y). Absolute world coordinates, not zone-local ones, so
  // neighbouring zones of a macro world don't repeat each other's scatter.
  const h = hashTile(x + (world.origin?.x ?? 0) + salt.x, y + (world.origin?.y ?? 0) + salt.y);
  if (h % salt.oneIn !== 0) return undefined;
  const id = pool[Math.floor(h / salt.oneIn) % pool.length]!;
  return tileTakesDecal(tile.terrain, DECALS[id].footing) ? id : undefined;
}

function dominantBiomeAt(world: World, x: number, y: number): string | undefined {
  if (!world.biomeSeeds || world.biomeSeeds.length === 0) return undefined;
  const weights = biomeWeightsAt(world.biomeSeeds, x, y);
  let best: string | undefined;
  let bestWeight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = name;
    }
  }
  return best;
}

/** Worldgen's decal pass: stamp what naturally belongs onto every tile of every layer. Runs last, after every terrain overlay has settled. */
export function scatterDecals(world: World): void {
  for (const layer of LAYER_ORDER) {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const tile = tileAt(world, layer, x, y);
        if (!tile) continue;
        tile.scatterDecal = naturalDecalAt(world, layer, x, y, "scatter");
        tile.featureDecal = naturalDecalAt(world, layer, x, y, "feature");
      }
    }
  }
}
