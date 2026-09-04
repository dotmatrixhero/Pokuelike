import type { Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";
import { invalidateResourceIndex } from "./resourceIndex.js";
import { floraDecayDivisor } from "./weather.js";

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

function pickFlavor<T extends readonly string[]>(flavors: T, rng: () => number): T[number] {
  return flavors[Math.floor(rng() * flavors.length)]!;
}

function isNearSunbeam(world: World, pos: Vec2): boolean {
  for (let dy = -SUNBEAM_RADIUS; dy <= SUNBEAM_RADIUS; dy++) {
    for (let dx = -SUNBEAM_RADIUS; dx <= SUNBEAM_RADIUS; dx++) {
      if (tileAt(world, "surface", pos.x + dx, pos.y + dy)?.terrain === "sunbeam") return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tuning constants — the knobs to hand-edit. Every food/flora durability and
// regrowth rate the sim actually uses lives here, grouped in one place on
// purpose (direct ask: "parametrize things like food durability and
// regrowth stuff... so I can tune it") rather than scattered as inline magic
// numbers through `growFlora`/`trySpread`/`maybeDropSeed` below. Each one
// still carries its own doc comment with what a real headless run showed
// when it was last changed — read those before nudging a number, the same
// "judge against a real run, not vibes" standard every other tuning constant
// in this codebase is held to.
// ---------------------------------------------------------------------------

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
 * Left unchanged by this pass — the faster-depleting/shorter-lived patches
 * below don't shrink this famine-window math, they just make an existing
 * patch run out and die sooner, which is the point (real pressure to move
 * on), not a reason to also slow down replacement.
 */
export const MATURATION_TICKS = 20;
/** Ticks per full season cycle — a slow abundant/lean rhythm on decay and spread. */
const SEASON_LENGTH = 1000;
/**
 * How much a single feeding depletes a food patch's stock. Was 0.2, then
 * briefly 0.5 (reverted — a real run showed 0.5 stacks with natural decay
 * below and wipes out the *starting* food supply before any replacement can
 * mature, total colony collapse by tick ~280), then 0.25 for a long stretch
 * of this session while starvation itself was still a real, common cause of
 * death.
 *
 * Raised again to 0.35 here — direct ask ("Maybe we make food less durable
 * now? Make it die easier to force migration now that starving is less
 * likely"), now that this session's earlier fixes (see DESIGN.md's "Real
 * confirmed bug: dying of thirst standing on water" and the breeding-gate
 * tuning before it) made starvation deaths collapse to zero across every
 * real seed tested. That headroom is exactly what makes 0.35 safe to try
 * where 0.5 wasn't: at 0.35, under 3 feedings empty a patch (was 4 at 0.25),
 * a real, meaningfully faster depletion, without repeating the earlier
 * total-collapse failure mode this constant already has a documented scar
 * from. See this file's own "Built, real-run findings" entry in DESIGN.md
 * for the actual before/after migration-event counts this produced.
 */
export const CONSUME_STOCK_AMOUNT = 0.35;
/**
 * A living food patch's natural lifespan in ticks, before it dies (reverts
 * to bare floor) on its own — on top of, not instead of, being eaten out.
 * A full patch used to just sit at low stock forever, slowly regrowing in
 * place (`BASE_REGROWTH_RATE`, since removed): it never actually died, so
 * "how long food lasts" was really unbounded. That old regrowth-from-empty
 * cycle took roughly 500 ticks at an average season; 50 (a tenth of that)
 * turned out a little too short once the one-way-ratchet flora-death bug
 * was fixed and food could actually be found again — doubled to 100 per
 * that earlier request.
 *
 * Shortened to 70 here, the same "less durable, force migration" direct ask
 * as `CONSUME_STOCK_AMOUNT` above — a patch now dies of old age 30% sooner
 * even if agents never fully eat it out, so a herd camped on a locally
 * abundant patch still sees it disappear on a real, visible clock rather
 * than lingering indefinitely between feedings.
 */
const FOOD_LIFESPAN_TICKS = 70;
const NATURAL_DECAY_PER_TICK = 1 / FOOD_LIFESPAN_TICKS;
/**
 * Chance, per tick, a living food patch seeds an adjacent open tile — real
 * bushes spread, they don't just sit in one place. Lowered from 0.035 to
 * 0.025 alongside the two durability cuts above: less compensating
 * replacement growth right next to a dying patch means a herd that exhausts
 * its local food is more likely to actually need to walk somewhere else for
 * more, rather than a new patch reliably sprouting in-place at the same
 * spot — the whole point of this pass (direct ask: "force migration").
 */
const FOOD_SPREAD_CHANCE = 0.025;
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
 * eventually give the tile back. Left unchanged by this pass — it's
 * decorative, not edible, so it isn't part of the "food durability" ask.
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
function trySpread(world: World, pos: Vec2, log: EventLog | undefined, rng: () => number): void {
  const shuffled = [...NEIGHBOR_OFFSETS].sort(() => rng() - 0.5);
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
export function maybeDropSeed(world: World, layer: Layer, pos: Vec2, log?: EventLog, rng: () => number = Math.random): void {
  if (layer !== "surface") return; // flora is a surface-layer thing for now
  if (rng() >= SEED_DROP_CHANCE) return;

  const tile = tileAt(world, layer, pos.x, pos.y);
  if (!tile || tile.terrain !== "floor") return;
  if (rng() >= GERMINATION_CHANCE) return;

  tile.terrain = "seedling";
  tile.growth = 0;
  log?.record({ kind: "floraChanged", tick: world.tick, layer, pos, stage: "seeded" });
}

/** Advances every seedling toward maturity and regrows every food patch's stock. Call once per tick. */
export function growFlora(world: World, log?: EventLog, rng: () => number = Math.random): void {
  const season = seasonalMultiplier(world.tick);
  const tiles = world.tiles.surface;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;

    if (tile.terrain === "seedling") {
      tile.growth = (tile.growth ?? 0) + 1;
      if (tile.growth >= MATURATION_TICKS) {
        const pos = { x: i % world.width, y: Math.floor(i / world.width) };
        const nearSun = isNearSunbeam(world, pos);
        const becomesFood = rng() < (nearSun ? FOOD_CHANCE_NEAR_SUNBEAM : FOOD_CHANCE);

        if (becomesFood) {
          tile.terrain = "food";
          tile.stock = 1;
          tile.flavor = nearSun ? pickFlavor(SUN_FOOD_FLAVORS, rng) : pickFlavor(FOOD_FLAVORS, rng);
          invalidateResourceIndex(world); // a new "food" tile — resourceIndex.ts's cache needs rebuilding
        } else {
          tile.terrain = "flora";
          tile.stock = 1; // vitality, not edible stock — decays and dies just like food does, below
          tile.flavor = pickFlavor(FLORA_FLAVORS, rng);
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
      // Lean season (season near 0): decays faster, spreads less. A local
      // weather cell (weather.ts's Phase 3) composes with, doesn't replace,
      // that global season term: `weatherDivisor` divides the decay rate
      // (rain > 1 slows decay, drought < 1 speeds it up) and directly scales
      // the spread chance the same direction (rain spreads more, drought
      // less) — see `floraDecayDivisor`'s doc comment for why decay/spread
      // modulation, not a direct stock top-up, is this system's closest
      // equivalent to "boosts/suppresses regrowth."
      const pos = { x: i % world.width, y: Math.floor(i / world.width) };
      const weatherDivisor = floraDecayDivisor(world, "surface", pos);
      tile.stock -= (NATURAL_DECAY_PER_TICK * (1.5 - season)) / weatherDivisor;

      if (tile.stock <= 0) {
        tile.terrain = "floor";
        tile.stock = undefined;
        tile.flavor = undefined;
        invalidateResourceIndex(world); // a "food" tile just reverted to "floor"
        log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos, stage: "died" });
        continue;
      }

      if (rng() < FOOD_SPREAD_CHANCE * (0.5 + season) * weatherDivisor) {
        trySpread(world, pos, log, rng);
      }
    }

    if (tile.terrain === "flora" && tile.stock !== undefined) {
      const pos = { x: i % world.width, y: Math.floor(i / world.width) };
      tile.stock -= (FLORA_DECAY_PER_TICK * (1.5 - season)) / floraDecayDivisor(world, "surface", pos);

      if (tile.stock <= 0) {
        tile.terrain = "floor";
        tile.stock = undefined;
        tile.flavor = undefined;
        log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos, stage: "died" });
      }
    }
  }
}
