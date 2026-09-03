import type { Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";

/** Chance, per tick, that an agent moving across open ground drops a seed there. */
const SEED_DROP_CHANCE = 0.02;
/** Chance a dropped seed actually takes root instead of doing nothing. */
const GERMINATION_CHANCE = 0.3;
/** Ticks a seedling takes to mature into a full food patch. */
const MATURATION_TICKS = 150;
/** Base stock/tick a food patch regrows, before the seasonal multiplier. */
const BASE_REGROWTH_RATE = 0.004;
/** Ticks per full season cycle — a slow abundant/lean rhythm on regrowth. */
const SEASON_LENGTH = 1000;
/** How much a single feeding depletes a food patch's stock. */
export const CONSUME_STOCK_AMOUNT = 0.2;

/** 0..1 multiplier on regrowth: a slow sine cycle, never fully zeroing growth out. */
export function seasonalMultiplier(tick: number): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * tick) / SEASON_LENGTH);
}

/**
 * Called after an agent actually moves. A small chance it leaves a seed on
 * open ground, which itself has a smaller chance to germinate — deliberately
 * not modeling *why* (no need to simulate what leaves the seed), just the
 * outcome: Pokémon traveling through an area occasionally start new growth
 * there.
 */
export function maybeDropSeed(world: World, layer: Layer, pos: Vec2, log?: EventLog): void {
  if (layer !== "surface") return; // flora is a surface-layer thing for now
  if (Math.random() >= SEED_DROP_CHANCE) return;

  const tile = tileAt(world, layer, pos.x, pos.y);
  if (!tile || tile.terrain !== "floor") return;
  if (Math.random() >= GERMINATION_CHANCE) return;

  tile.terrain = "seedling";
  tile.growth = 0;
  log?.record({ kind: "floraChanged", tick: world.tick, layer, pos, stage: "seeded" });
}

/** Advances every seedling toward maturity and regrows every food patch's stock. Call once per tick. */
export function growFlora(world: World, log?: EventLog): void {
  const season = seasonalMultiplier(world.tick);
  const tiles = world.tiles.surface;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;

    if (tile.terrain === "seedling") {
      tile.growth = (tile.growth ?? 0) + 1;
      if (tile.growth >= MATURATION_TICKS) {
        tile.terrain = "food";
        tile.stock = 1;
        tile.growth = undefined;
        log?.record({
          kind: "floraChanged",
          tick: world.tick,
          layer: "surface",
          pos: { x: i % world.width, y: Math.floor(i / world.width) },
          stage: "sprouted",
        });
      }
      continue;
    }

    if (tile.terrain === "food" && tile.stock !== undefined && tile.stock < 1) {
      tile.stock = Math.min(1, tile.stock + BASE_REGROWTH_RATE * season);
    }
  }
}
