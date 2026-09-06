import type { Layer, Tile, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";
import { invalidateResourceIndex } from "./resourceIndex.js";
import { floraDecayDivisor } from "./weather.js";
import { dominantBiomeAt, effectiveWaterDensityAt } from "./worldgen.js";
import { FOOD_CROPS, WINTER_NON_HARDY_FOOD_CHANCE_MULTIPLIER, pickCrop, seasonalMultiplier, seasonName, type CropId } from "./crops.js";

/**
 * What a seedling can mature into — a real, biome/moisture/season-gated
 * `CropId` (`crops.ts`) for "food" (edible, has stock, a real nutrition
 * multiplier), or a purely cosmetic decorative flavor for "flora"
 * (decorative only, not edible, just a nicer/comfier tile than bare floor —
 * unchanged, `FLORA_FLAVORS` never needed to be more than cosmetic).
 */
export const FLORA_FLAVORS = ["moss", "fern", "bloom"] as const;
/** How far (Chebyshev distance) counts as "near" a sunbeam for germination purposes. */
/** Also read directly by utilityMoves.ts's `selfHeal`'s `sunbeamBonus` — same "how close counts as near" radius germination already uses. */
export const SUNBEAM_RADIUS = 3;
/** Chance a maturing seedling becomes edible food vs. decorative flora, normally. */
const FOOD_CHANCE = 0.55;
/** Same, but boosted near a sunbeam — sun-loving crops (Tomato) do better in the light. */
const FOOD_CHANCE_NEAR_SUNBEAM = 0.8;
/**
 * How much a drought-resistant crop's (Potato's) decay is spared from a
 * drought's usual penalty — pulls the weather divisor this fraction of the
 * way back toward 1 (neutral) whenever it's below 1 (a real drought
 * in effect), rather than eliminating the penalty outright ("drought-
 * tolerant," not "drought-immune").
 */
const DROUGHT_RESISTANCE_DAMPING = 0.7;

function pickFlavor<T extends readonly string[]>(flavors: T, rng: () => number): T[number] {
  return flavors[Math.floor(rng() * flavors.length)]!;
}

/** Also read directly by utilityMoves.ts's `selfHeal`'s `sunbeamBonus` (Synthesis/Moonlight) — same terrain-scaled-healing idea this already drives for germination, reused for self-heal instead. */
export function isNearSunbeam(world: World, pos: Vec2): boolean {
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

/**
 * Soil fertility — direct ask: "this limits how flora can spawn... make
 * it take time for the soil to be able to accommodate life... Pokémon
 * that help, like watering it via water moves and tilling/planting it
 * via grass type help." Distinct from the grazing-scar system above:
 * that punishes over-consumption, this just models ordinary recovery
 * time after *any* harvest — see `Tile.fertility`'s doc comment in
 * types.ts for why `undefined`/1 (fully fertile) is the default so the
 * map's initial growth is completely unaffected.
 */
/** A tile's fertility drops to this once whatever grew on it dies — not to 0, so recovery is real but not glacial even with zero help. */
const FERTILITY_AFTER_HARVEST = 0.35;
/**
 * Passive fertility regen per tick, whether or not anything's helping —
 * reaches full from `FERTILITY_AFTER_HARVEST` in ~130 ticks on its own,
 * comfortably inside one food-patch lifecycle (`FOOD_LIFESPAN_TICKS` +
 * `MATURATION_TICKS` = 90) so a spot that's never actively tended still
 * recovers rather than staying gated forever, just not instantly.
 */
const FERTILITY_REGEN_PER_TICK = 0.005;
/** A landed Water-type hit's puddle also counts as "watering" the ground it hits — a real, immediate boost, not just a faster passive rate. */
const FERTILITY_WATER_BOOST = 0.35;
/** Per tick a Grass-type agent spends standing on a tile — slower than watering's one-off boost, but sustained presence adds up ("tilling/planting it"). */
const FERTILITY_TEND_PER_TICK = 0.02;

/** Bumps this tile's fertility (capped at 1) — shared by waterSoil/tendSoil below, the harvest-recovery reset in growFlora, and utilityMoves.ts's `fertilityBoost` effect (Growth/Grassy Terrain). */
export function raiseFertility(tile: Tile | undefined, amount: number): void {
  if (!tile) return;
  tile.fertility = Math.min(1, (tile.fertility ?? 1) + amount);
}

/** Call when a Water-type move's hit lands and creates a puddle (predation.ts's `terrainFill` site) — the ground it hits gets a real, immediate fertility boost. */
export function waterSoil(tile: Tile | undefined): void {
  raiseFertility(tile, FERTILITY_WATER_BOOST);
}

/** Call once per tick for every Grass-type agent, at the tile under its own position (needs.ts) — sustained presence gradually enriches the ground it stands on. */
export function tendSoil(tile: Tile | undefined): void {
  raiseFertility(tile, FERTILITY_TEND_PER_TICK);
}

/**
 * Plant quality — direct ask: "fully fertile plant gives super higher
 * quality berries and such. But they don't need to be fully fertile to
 * produce it. And fully fertile plants tend to survive noticeably longer
 * and produce more." Whatever the tile's fertility happens to be the
 * moment a seedling matures gets frozen onto the new patch as
 * `Tile.quality` (see its doc comment in types.ts) and drives three real
 * effects below — yield, lifespan, and (via `foodNutritionFactor`, read
 * from needs.ts) how much a feeding actually restores.
 */
/**
 * A patch's starting stock never drops below this fraction of
 * `FOOD_MAX_STOCK`, even at zero founding quality — "they don't need to
 * be fully fertile to produce it," so a poor patch still yields a real
 * majority of the max rather than next to nothing.
 */
const QUALITY_MIN_YIELD_FRACTION = 0.7;
/** Starting stock scales linearly from `QUALITY_MIN_YIELD_FRACTION` (quality 0) up to the full `FOOD_MAX_STOCK` (quality 1). */
function yieldFactor(quality: number): number {
  return QUALITY_MIN_YIELD_FRACTION + quality * (1 - QUALITY_MIN_YIELD_FRACTION);
}
/**
 * How much founding quality can speed up or slow down a patch's own
 * decay — "fully fertile plants tend to survive noticeably longer." At
 * quality 1, decays this fraction SLOWER (survives proportionally
 * longer); at quality 0, this fraction FASTER. Applied to both food and
 * flora decay below — "survive longer" isn't specific to edible berries
 * the way yield/nutrition are.
 */
const QUALITY_LIFESPAN_SWING = 0.4;
function decayFactor(quality: number): number {
  return 1 + QUALITY_LIFESPAN_SWING * (1 - 2 * quality);
}
/**
 * How much founding quality scales the real hunger benefit of eating from
 * a patch — "fully fertile plant gives super higher quality berries."
 * Symmetric with `decayFactor` but inverted (higher quality = more
 * benefit, not less); exported so needs.ts's actual feeding site can use
 * the same quality->benefit curve instead of duplicating it.
 */
const QUALITY_NUTRITION_SWING = 0.3;
/**
 * How much hunger-restoration a feeding from this tile is worth, relative
 * to a baseline (quality-1, Herbs-tier) feeding — composes two independent
 * factors: the tile's own founding `quality` (unchanged from before crops
 * existed) and its `CropId`'s `nutritionMultiplier` (`crops.ts`) — a
 * nutrition-dense crop (Pumpkin) restores meaningfully more per bite than a
 * filler one (Herbs) even at identical quality, which is the real "keep you
 * full for longer" ask: a bigger one-shot restore means more ticks pass
 * before the next feeding trip, straight out of `needs.ts`'s existing
 * flat-per-tick hunger decay.
 */
export function foodNutritionFactor(tile: Tile | undefined): number {
  if (!tile) return 1;
  const qualityFactor = tile.quality === undefined ? 1 : 1 + QUALITY_NUTRITION_SWING * (2 * tile.quality - 1);
  const cropMultiplier = tile.flavor !== undefined && tile.flavor in FOOD_CROPS ? FOOD_CROPS[tile.flavor as CropId].nutritionMultiplier : 1;
  return qualityFactor * cropMultiplier;
}

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
    if (tile?.terrain !== "floor" || tile.overgrazed) continue;
    // Low fertility (a recently-harvested neighbor still recovering) is a
    // real but probabilistic setback, same "reduce, don't ban" shape as
    // the overgrazed multiplier elsewhere — not a hard skip, so a
    // just-harvested spot can still occasionally take the next seed
    // rather than being locked out for its whole recovery window.
    if (rng() >= (tile.fertility ?? 1)) continue;
    tile.terrain = "seedling";
    tile.growth = 0;
    log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos: { x: nx, y: ny }, stage: "seeded" });
    return;
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
  // Low fertility (recently-harvested, still recovering) composes with
  // that the same way — a probabilistic dampener, not a gate — and is
  // 1 (no effect at all) on every untouched world-gen tile, so this never
  // slows the map's very first growth cycle.
  const germinationChance = (tile.overgrazed ? GERMINATION_CHANCE * OVERGRAZED_GROWTH_MULTIPLIER : GERMINATION_CHANCE) * (tile.fertility ?? 1);
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
    // Passive fertility recovery, regardless of terrain — same
    // single-scan shape as grazing pressure's own decay just above.
    // `fertility === undefined` already means "fully fertile" (see
    // types.ts), so this only ever does real work on a tile that's
    // actually recovering from a recent harvest.
    if (tile.fertility !== undefined && tile.fertility < 1) {
      tile.fertility = Math.min(1, tile.fertility + FERTILITY_REGEN_PER_TICK);
    }

    if (tile.terrain === "seedling") {
      // Overgrazed ground also slows maturation for whatever DOES manage to
      // germinate there — real suppression on the growth path, not just a
      // gate at the germination roll.
      tile.growth = (tile.growth ?? 0) + (tile.overgrazed ? OVERGRAZED_GROWTH_MULTIPLIER : 1);
      if (tile.growth >= MATURATION_TICKS) {
        const nearSun = isNearSunbeam(world, pos);
        // Real biome/moisture-gated crop pick (crops.ts) — the same runtime
        // biome-blend/moisture-proxy functions weather.ts's own Phase 3
        // biome-influenced weather already reuses, not a new biome concept.
        const biome = dominantBiomeAt(world.biomeSeeds, pos.x, pos.y);
        const moisture = effectiveWaterDensityAt(world.biomeSeeds, world.biomeSeedDrift, pos.x, pos.y);
        const crop = pickCrop(biome, moisture, world.tick, nearSun, rng);
        // Winter thins out which crops mature into real food at all — see
        // crops.ts's own doc comment; Potato (winterHardy) is exempt.
        const winterPenalty = seasonName(world.tick) === "winter" && !FOOD_CROPS[crop].winterHardy ? WINTER_NON_HARDY_FOOD_CHANCE_MULTIPLIER : 1;
        const becomesFood = rng() < (nearSun ? FOOD_CHANCE_NEAR_SUNBEAM : FOOD_CHANCE) * winterPenalty;
        // Frozen onto the new patch as its `quality` — the tile's own
        // `fertility` keeps moving after this, but this plant's yield/
        // lifespan/nutrition are set for its whole life right here.
        const quality = tile.fertility ?? 1;
        tile.quality = quality;

        if (becomesFood) {
          tile.terrain = "food";
          tile.stock = FOOD_MAX_STOCK * yieldFactor(quality);
          tile.flavor = crop;
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
      let weatherDivisor = floraDecayDivisor(world, "surface", pos);
      // Drought-resistant crops (Potato) shrug off most of a drought's
      // usual decay penalty — pulls a below-1 (drought) divisor this
      // fraction of the way back toward 1 (neutral), "drought-tolerant,"
      // not "drought-immune." No effect on rain/neutral weather, and no
      // effect on non-drought-resistant crops at all.
      const crop = tile.flavor !== undefined && tile.flavor in FOOD_CROPS ? FOOD_CROPS[tile.flavor as CropId] : undefined;
      if (crop?.droughtResistant && weatherDivisor < 1) {
        weatherDivisor += (1 - weatherDivisor) * DROUGHT_RESISTANCE_DAMPING;
      }
      tile.stock -= (NATURAL_DECAY_PER_TICK * (1.5 - season) * decayFactor(tile.quality ?? 1)) / weatherDivisor;

      if (tile.stock <= 0) {
        tile.terrain = "floor";
        tile.stock = undefined;
        tile.flavor = undefined;
        tile.quality = undefined;
        tile.fertility = FERTILITY_AFTER_HARVEST; // the ground that just fed something needs a little time before it's this ready again
        invalidateResourceIndex(world); // a "food" tile just reverted to "floor"
        log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos, stage: "died" });
        continue;
      }

      if (rng() < FOOD_SPREAD_CHANCE * (0.5 + season) * weatherDivisor) {
        trySpread(world, pos, log, rng);
      }
    }

    if (tile.terrain === "flora" && tile.stock !== undefined) {
      tile.stock -= (FLORA_DECAY_PER_TICK * (1.5 - season) * decayFactor(tile.quality ?? 1)) / floraDecayDivisor(world, "surface", pos);

      if (tile.stock <= 0) {
        tile.terrain = "floor";
        tile.stock = undefined;
        tile.flavor = undefined;
        tile.quality = undefined;
        tile.fertility = FERTILITY_AFTER_HARVEST; // same recovery-time reasoning as the food-death branch above
        log?.record({ kind: "floraChanged", tick: world.tick, layer: "surface", pos, stage: "died" });
      }
    }
  }
}
