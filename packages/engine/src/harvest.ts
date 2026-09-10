import type { Layer, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";
import { LAYER_ORDER } from "./types.js";

/**
 * What a tile yields to a gatherer — ROADMAP.md M5, HANDOFF.md §3.3.
 *
 * No new terrain kinds. Materials are read off what is already on the map,
 * per CRAFTABLES_V1.md's "where" column: lichen on cave floor near water,
 * deadwood only near a sunbeam, flint on rocky ground or beside a boulder,
 * berries from a food tile, herbs from the herbs crop. A tile gives
 * `HARVEST_YIELD_PER_TILE` takes and is then bare until it regrows.
 *
 * "Gather" is the verb — direct ask: "I do want like gather as a
 * verb/move." The materials table (weights, names) lives here too because
 * the engine is what puts them in a pack; the data package's crafting
 * tables reference these ids.
 */

export type MaterialId = "lichen" | "deadwood" | "flint" | "herbs" | "food";

export const MATERIALS: Record<MaterialId, { name: string; weight: number }> = {
  lichen: { name: "Lichen", weight: 1 },
  deadwood: { name: "Deadwood", weight: 2 },
  flint: { name: "Flint", weight: 1 },
  herbs: { name: "Herbs", weight: 1 },
  food: { name: "Berries", weight: 1 },
};

/** Takes before a tile is bare. Sim-original; CRAFTABLES_V1.md's open question 4 is spoilage, not this. */
export const HARVEST_YIELD_PER_TILE = 3;
/** Every this many ticks, every gathered tile recovers one take. ~75 player keys. */
export const HARVEST_REGROW_TICKS = 300;
/** Player turns one gather takes — PLAYER_ACTIONS.md's Tier 2 "many ticks, interruptible". */
export const GATHER_TURNS = 3;

const LICHEN_WATER_RANGE = 6;
const DEADWOOD_SUNBEAM_RANGE = 2;

function anyWithin(world: World, layer: Layer, pos: Vec2, range: number, pred: (t: NonNullable<ReturnType<typeof tileAt>>) => boolean): boolean {
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const t = tileAt(world, layer, pos.x + dx, pos.y + dy);
      if (t && pred(t)) return true;
    }
  }
  return false;
}

/** What this tile can yield, ignoring depletion. Empty on bare rock. */
export function harvestableAt(world: World, layer: Layer, pos: Vec2): MaterialId[] {
  const tile = tileAt(world, layer, pos.x, pos.y);
  if (!tile) return [];
  const out: MaterialId[] = [];
  if (tile.terrain === "food" && (tile.stock ?? 0) > 0) out.push(tile.flavor === "herbs" ? "herbs" : "food");
  // Ground you can pick things off: bare floor, and floor with plants on
  // it. The chamber's flora spreads over the floor near water, and a bot
  // that walked to a "floor" tile found "flora" there by the time it
  // arrived (validateTorch.ts, seed 202) — lichen grows among moss.
  const ground = tile.terrain === "floor" || tile.terrain === "sunbeam" || tile.terrain === "mud" || tile.terrain === "flora" || tile.terrain === "seedling";
  if (ground) {
    if (layer === "underground" && anyWithin(world, layer, pos, LICHEN_WATER_RANGE, (t) => t.terrain === "water")) out.push("lichen");
    if (anyWithin(world, layer, pos, DEADWOOD_SUNBEAM_RANGE, (t) => t.terrain === "sunbeam")) out.push("deadwood");
    // Ruling: "I want gathering on layer 1." Cave walls are rock, so floor
    // beside a wall underground gives loose flint too — the reachability
    // test found no rocky ground or boulders on any cave seed.
    const rockNearby = tile.groundType === "rocky" || anyWithin(world, layer, pos, 1, (t) => t.terrain === "boulder" || (layer === "underground" && t.terrain === "wall"));
    if (rockNearby) out.push("flint");
  }
  return out;
}

/** Takes left on this tile before it is bare. */
export function harvestLeft(world: World, layer: Layer, pos: Vec2): number {
  const tile = tileAt(world, layer, pos.x, pos.y);
  if (!tile) return 0;
  return Math.max(0, HARVEST_YIELD_PER_TILE - (tile.harvested ?? 0));
}

/** One take: everything the tile yields, one unit each, and the tile remembers it. Empty if bare. */
export function takeHarvest(world: World, layer: Layer, pos: Vec2): MaterialId[] {
  if (harvestLeft(world, layer, pos) <= 0) return [];
  const yields = harvestableAt(world, layer, pos);
  if (yields.length === 0) return [];
  const tile = tileAt(world, layer, pos.x, pos.y)!;
  tile.harvested = (tile.harvested ?? 0) + 1;
  return yields;
}

/** Every `HARVEST_REGROW_TICKS`, each gathered tile recovers one take. One scan, not per agent — same shape as flora.ts. */
export function tickHarvestRegrowth(world: World): void {
  if (world.tick === 0 || world.tick % HARVEST_REGROW_TICKS !== 0) return;
  for (const layer of LAYER_ORDER) {
    for (const tile of world.tiles[layer]) {
      if (tile.harvested) tile.harvested = tile.harvested - 1 || undefined;
    }
  }
}
