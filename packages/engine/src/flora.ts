import type { Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";
import { invalidateResourceIndex } from "./resourceIndex.js";

/**
 * What a seedling can mature into — purely cosmetic flavors of "food"
 * (edible, has stock) or "flora" (decorative only, not edible, just a
 * nicer/comfier tile than bare floor). No gameplay effects yet — just a
 * distinct glyph/color per flavor in the renderer. Real Pokémon berry
 * names for the edible ones since this is, after all, a Pokémon sim.
 */
export const FOOD_FLAVORS = ["oran", "sitrus", "pecha", "cheri"] as const;
export const FLORA_FLAVORS = ["moss", "fern", "bloom"] as const;
/** Sun-loving berries — favored when a seedling matures near a sunbeam tile. */
const SUN_FOOD_FLAVORS = ["sitrus", "cheri"] as const;
/** How far (Chebyshev distance) counts as "near" a sunbeam for germination purposes. */
const SUNBEAM_RADIUS = 3;
/** Chance a maturing seedling becomes edible food vs. decorative flora, normally. */
const FOOD_CHANCE = 0.55;
/** Same, but boosted near a sunbeam — sun-loving berries do better in the light. */
const FOOD_CHANCE_NEAR_SUNBEAM = 0.8;

function pickFlavor<T extends readonly string[]>(flavors: T): T[number] {
  return flavors[Math.floor(Math.random() * flavors.length)]!;
}

function isNearSunbeam(world: World, pos: Vec2): boolean {
  for (let dy = -SUNBEAM_RADIUS; dy <= SUNBEAM_RADIUS; dy++) {
    for (let dx = -SUNBEAM_RADIUS; dx <= SUNBEAM_RADIUS; dx++) {
      if (tileAt(world, "surface", pos.x + dx, pos.y + dy)?.terrain === "sunbeam") return true;
    }
  }
  return false;
}

/** Chance, per tick, that an agent moving across open ground drops a seed there. */
const SEED_DROP_CHANCE = 0.1;
/** Chance a dropped seed actually takes root instead of doing nothing. */
const GERMINATION_CHANCE = 0.65;
/**
 * Ticks a seedling takes to mature into a full food patch. Was 150 —
 * confirmed by a real run to cause total colony collapse once
 * FOOD_LIFESPAN_TICKS (below) dropped to 50: every food patch on the map
 * died of old age around tick 50-70, but a seedling planted at tick 0
 * wouldn't mature until tick 150, guaranteeing a ~100-tick famine window
 * with zero food anywhere. All 9 starting agents starved by tick ~200 in
 * that run. Shortened so new food reliably arrives before old food dies.
 */
export const MATURATION_TICKS = 20;
/** Ticks per full season cycle — a slow abundant/lean rhythm on decay and spread. */
const SEASON_LENGTH = 1000;
/**
 * How much a single feeding depletes a food patch's stock. Was 0.2, then
 * briefly 0.5 — reverted most of the way back after a real run showed why:
 * 0.5 (two feedings to empty a patch) stacks with natural decay/death
 * below and wipes out the *starting* food supply in the first handful of
 * ticks, before any replacement can mature, causing total colony collapse
 * (confirmed: all 3 initial patches dead by tick 42, every agent starved
 * by tick ~280). 0.25 still runs out meaningfully faster than the
 * original 0.2, without also being the dominant killer on top of natural
 * decay.
 */
export const CONSUME_STOCK_AMOUNT = 0.25;
/**
 * A living food patch's natural lifespan in ticks, before it dies (reverts
 * to bare floor) on its own — on top of, not instead of, being eaten out.
 * A full patch used to just sit at low stock forever, slowly regrowing in
 * place (`BASE_REGROWTH_RATE`, since removed): it never actually died, so
 * "how long food lasts" was really unbounded. That old regrowth-from-empty
 * cycle took roughly 500 ticks at an average season; 50 (a tenth of that)
 * turned out a little too short once the one-way-ratchet flora-death bug
 * was fixed and food could actually be found again — doubled per request.
 */
const FOOD_LIFESPAN_TICKS = 100;
const NATURAL_DECAY_PER_TICK = 1 / FOOD_LIFESPAN_TICKS;
/** Chance, per tick, a living food patch seeds an adjacent open tile — real bushes spread, they don't just sit in one place. */
const FOOD_SPREAD_CHANCE = 0.035;
/**
 * Decorative "flora" needs a lifespan too, on the same principle as food —
 * without this it never dies, which turned out to be a much worse bug than
 * it sounds: since a seedling only ever plants on bare "floor", and
 * "flora" permanently converts floor away without ever giving it back,
 * decorative growth was a one-way ratchet that steadily ate the map's
 * entire pool of seedable ground. Confirmed in a real 2000-tick run: by
 * tick 800, food had hit zero *permanently* (0 food tiles, 248 of 384
 * total tiles converted to un-reseedable decorative flora, only 113 left
 * as bare floor) while the population sat starving in the water hole,
 * with nowhere left for new food to ever grow again. Longer-lived than
 * food since it's meant to be a longer-standing feature, but it has to
 * eventually give the tile back.
 */
const FLORA_LIFESPAN_TICKS = 150;
const FLORA_DECAY_PER_TICK = 1 / FLORA_LIFESPAN_TICKS;

const NEIGHBOR_OFFSETS: Vec2[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

/** 0..1 multiplier on decay/spread: a slow sine cycle, never fully zeroing out. */
export function seasonalMultiplier(tick: number): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * tick) / SEASON_LENGTH);
}

/** Tries to seed one open neighbor of a living food patch — how it proliferates. */
function trySpread(world: World, pos: Vec2, log?: EventLog): void {
  const shuffled = [...NEIGHBOR_OFFSETS].sort(() => Math.random() - 0.5);
  for (const offset of shuffled) {
    const nx = pos.x + offset.x, ny = pos.y + offset.y;
    const tile = tileAt(world, "surface", nx, ny);
    if (tile?.terrain === "floor") {
      tile.terrain = "seedling";
      tile.growth = 0;
      log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos: { x: nx, y: ny }, stage: "seeded" });
      return;
    }
  }
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
        const pos = { x: i % world.width, y: Math.floor(i / world.width) };
        const nearSun = isNearSunbeam(world, pos);
        const becomesFood = Math.random() < (nearSun ? FOOD_CHANCE_NEAR_SUNBEAM : FOOD_CHANCE);

        if (becomesFood) {
          tile.terrain = "food";
          tile.stock = 1;
          tile.flavor = nearSun ? pickFlavor(SUN_FOOD_FLAVORS) : pickFlavor(FOOD_FLAVORS);
          invalidateResourceIndex(world); // a new "food" tile — resourceIndex.ts's cache needs rebuilding
        } else {
          tile.terrain = "flora";
          tile.stock = 1; // vitality, not edible stock — decays and dies just like food does, below
          tile.flavor = pickFlavor(FLORA_FLAVORS);
        }
        tile.growth = undefined;
        log?.record({
          kind: "floraChanged",
          tick: world.tick,
          layer: "surface",
          pos,
          stage: "sprouted",
          flavor: tile.flavor,
        });
      }
      continue;
    }

    if (tile.terrain === "food" && tile.stock !== undefined) {
      // Abundant season (season near 1): decays slower, spreads more often.
      // Lean season (season near 0): decays faster, spreads less.
      tile.stock -= NATURAL_DECAY_PER_TICK * (1.5 - season);

      if (tile.stock <= 0) {
        const pos = { x: i % world.width, y: Math.floor(i / world.width) };
        tile.terrain = "floor";
        tile.stock = undefined;
        tile.flavor = undefined;
        invalidateResourceIndex(world); // a "food" tile just reverted to "floor"
        log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos, stage: "died" });
        continue;
      }

      if (Math.random() < FOOD_SPREAD_CHANCE * (0.5 + season)) {
        trySpread(world, { x: i % world.width, y: Math.floor(i / world.width) }, log);
      }
    }

    if (tile.terrain === "flora" && tile.stock !== undefined) {
      tile.stock -= FLORA_DECAY_PER_TICK * (1.5 - season);

      if (tile.stock <= 0) {
        const pos = { x: i % world.width, y: Math.floor(i / world.width) };
        tile.terrain = "floor";
        tile.stock = undefined;
        tile.flavor = undefined;
        log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos, stage: "died" });
      }
    }
  }
}
