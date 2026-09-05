import type { Layer, Tile, Vec2, World } from "./types.js";
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
 * How much stock a freshly-matured (or worldgen-placed) "food" tile starts
 * with — was an implicit 1 everywhere; now a real, named knob. Direct ask:
 * "food sources to die out a little faster, like 20% less food produced per
 * food source." Cut to 0.8 (a flat 20% reduction), which composes with
 * `CONSUME_STOCK_AMOUNT` (0.35) to bring a patch down from ~3 feedings
 * (1 / 0.35 ≈ 2.86) to ~2 feedings (0.8 / 0.35 ≈ 2.29) before it's eaten
 * out — a real, meaningfully smaller yield per source, independent of
 * `FOOD_LIFESPAN_TICKS`'s separate "dies of old age" clock. Does NOT apply
 * to "flora" tiles (see the `tile.stock = 1` comment at the flora branch
 * below) — that field there tracks vitality/decay progress, not edible
 * yield, and is a different concept that happens to reuse the same field.
 */
export const FOOD_MAX_STOCK = 0.8;
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

/**
 * Grazing scars — a lasting mark from SUSTAINED heavy grazing, distinct from
 * the ordinary instant stock depletion above. A single food patch getting
 * eaten out over its normal ~3-feeding life (`CONSUME_STOCK_AMOUNT`) isn't
 * enough on its own to scar the ground; it takes repeated grazing at the
 * same coordinates — across one patch's feedings, or across several
 * patches that keep regrowing and getting eaten again at the same spot — to
 * cross the threshold. User's own pitch, approved directly ("Yeah that
 * sounds good"): "a patch that's been grazed hard and repeatedly over real
 * time should measurably degrade... a real lingering 'this ground is
 * overgrazed' effect."
 *
 * `Tile.grazingPressure` (see types.ts) is a persistent per-tile counter,
 * incremented by `recordGrazing` at both real consumption call sites
 * (needs.ts's self-feeding `consume()`, support.ts's herd food-delivery
 * pickup) and decayed a little every tick in `growFlora` below, regardless
 * of the tile's current terrain — deliberately the same "counter that
 * decays over time when not being fed" shape as this codebase's other
 * decaying counters (e.g. `Agent.ticksSinceEligibleMate`), not a novel
 * mechanism. `Tile.overgrazed` flips on/off around two different
 * thresholds (hysteresis) so it doesn't flicker tick-to-tick right at the
 * boundary — the same "enter high, exit low" shape weather.ts and other
 * threshold-driven state in this codebase already use.
 */
/** Added to a tile's grazing pressure on every real consumption event there. */
const GRAZING_PRESSURE_PER_CONSUME = 1;
/**
 * A tile's grazing pressure decays by this much per tick, always (whether
 * or not it's currently being grazed).
 *
 * Tuned against a real headless run, not guessed: an initial 0.02/tick
 * (full decay of a single grazing event in 50 ticks) turned out to erase
 * pressure almost as fast as it's earned — a real 3000-tick, 3-seed run
 * showed individual food tiles genuinely getting grazed 4-8 times each over
 * the run (170 distinct fed tiles, seed 42; 12 of them hit 4+ times), but
 * because real regrowth cycles (`FOOD_LIFESPAN_TICKS`=70 to die,
 * `MATURATION_TICKS`=20 to regrow) space consecutive feedings at the same
 * coordinate anywhere from a handful of ticks to several hundred apart, the
 * fast decay wiped pressure out between waves almost every time — only 3
 * tiles ever crossed the threshold across all three seeds combined, on a
 * threshold that in principle only needed 4 real feedings. Slowed 5x here
 * so pressure actually survives the gap between a herd's feeding waves
 * (matches a food patch's own regrowth-cycle timescale) instead of quietly
 * resetting itself before the next wave arrives — see this constant's
 * DESIGN.md entry for the concrete before/after tile counts this produced.
 */
const GRAZING_PRESSURE_DECAY_PER_TICK = 0.004;
/**
 * Grazing pressure at/above this flips a tile into "overgrazed" — three
 * real grazing events without much decay in between, matching
 * `CONSUME_STOCK_AMOUNT`'s own "3 feedings empties a patch" bar: it takes
 * at least a full patch's worth of real feeding pressure (whether from one
 * overfed patch or several patches regrown and refed at the same spot) to
 * actually scar the ground, not just one or two visits.
 */
const OVERGRAZED_ENTER_PRESSURE = 3;
/** Grazing pressure has to decay back down to this (lower than the enter threshold) before a scar fades. */
const OVERGRAZED_EXIT_PRESSURE = 1;
/**
 * How much an overgrazed tile's germination/spread chances are multiplied
 * by — a REAL suppression (85% reduction), not a token tweak, per the
 * explicit "a real, visible suppression" ask. Left non-zero (not an outright
 * ban) so an overgrazed tile can still, rarely, get lucky and start
 * recovering on its own even under continued light pressure — total denial
 * is reserved for `trySpread`, which is deliberately pickier (see below).
 */
const OVERGRAZED_GROWTH_MULTIPLIER = 0.15;

/** Records a real grazing event at these tile coordinates — call from every place stock is actually consumed. */
export function recordGrazing(tile: Tile | undefined): void {
  if (!tile) return;
  tile.grazingPressure = (tile.grazingPressure ?? 0) + GRAZING_PRESSURE_PER_CONSUME;
}

/**
 * Decays this tile's grazing pressure by one tick's worth and flips
 * `overgrazed` on/off around the hysteresis band above, emitting a
 * `floraChanged` event on each real state transition (not every tick) so
 * the event log narrates "this patch scarred over" / "this patch
 * recovered" as a real, occasional beat rather than noise. Called once per
 * tile per tick from `growFlora`'s main scan, regardless of terrain.
 */
function decayGrazing(world: World, tile: Tile, pos: Vec2, log: EventLog | undefined): void {
  if (tile.grazingPressure === undefined) return; // never grazed — nothing to decay

  // Check the enter threshold against the pressure AS OF THIS TICK's real
  // grazing, before this tick's own decay quietly pulls it back under —
  // otherwise a patch that gets grazed to exactly the threshold and then
  // immediately decays a hair below it on the very next `growFlora` call
  // would never register as overgrazed at all (caught by a real test that
  // grazes a tile to exactly `OVERGRAZED_ENTER_PRESSURE`).
  if (!tile.overgrazed && tile.grazingPressure >= OVERGRAZED_ENTER_PRESSURE) {
    tile.overgrazed = true;
    log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos, stage: "overgrazed" });
  }

  tile.grazingPressure = Math.max(0, tile.grazingPressure - GRAZING_PRESSURE_DECAY_PER_TICK);

  if (tile.overgrazed && tile.grazingPressure <= OVERGRAZED_EXIT_PRESSURE) {
    tile.overgrazed = false;
    log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos, stage: "recovered" });
  }
}

const NEIGHBOR_OFFSETS: Vec2[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

/** 0..1 multiplier on decay/spread: a slow sine cycle, never fully zeroing out. */
export function seasonalMultiplier(tick: number): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * tick) / SEASON_LENGTH);
}

/**
 * Tries to seed one open neighbor of a living food patch — how it
 * proliferates. Skips overgrazed neighbors outright rather than just
 * lowering their odds (unlike germination/maturation below, which are
 * suppressed but not zeroed) — spreading INTO a patch of ground a herd is
 * actively hammering flat would undercut the whole point of the scar, and
 * this is the one growth path with other, un-scarred neighbors usually
 * available to fall back to instead.
 */
function trySpread(world: World, pos: Vec2, log: EventLog | undefined, rng: () => number): void {
  const shuffled = [...NEIGHBOR_OFFSETS].sort(() => rng() - 0.5);
  for (const offset of shuffled) {
    const nx = pos.x + offset.x, ny = pos.y + offset.y;
    const tile = tileAt(world, "surface", nx, ny);
    if (tile?.terrain === "floor" && !tile.overgrazed) {
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
  // Overgrazed ground resists germination — real suppression, not a ban
  // (see OVERGRAZED_GROWTH_MULTIPLIER's doc comment above `trySpread`).
  const germinationChance = tile.overgrazed ? GERMINATION_CHANCE * OVERGRAZED_GROWTH_MULTIPLIER : GERMINATION_CHANCE;
  if (rng() >= germinationChance) return;

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
    const pos = { x: i % world.width, y: Math.floor(i / world.width) };
    decayGrazing(world, tile, pos, log);

    if (tile.terrain === "seedling") {
      // Overgrazed ground also slows maturation for whatever DOES manage to
      // germinate there — real suppression on the growth path, not just a
      // gate at the germination roll.
      tile.growth = (tile.growth ?? 0) + (tile.overgrazed ? OVERGRAZED_GROWTH_MULTIPLIER : 1);
      if (tile.growth >= MATURATION_TICKS) {
        const nearSun = isNearSunbeam(world, pos);
        const becomesFood = rng() < (nearSun ? FOOD_CHANCE_NEAR_SUNBEAM : FOOD_CHANCE);

        if (becomesFood) {
          tile.terrain = "food";
          tile.stock = FOOD_MAX_STOCK;
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
