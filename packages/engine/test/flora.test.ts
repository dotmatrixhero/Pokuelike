import { describe, expect, it, vi, afterEach } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import {
  maybeDropSeed,
  growFlora,
  growCanopyFood,
  recordGrazing,
  waterSoil,
  tendSoil,
  foodNutritionFactor,
  CONSUME_STOCK_AMOUNT,
  FOOD_MAX_STOCK,
  FLORA_FLAVORS,
  MATURATION_TICKS,
} from "../src/flora.js";
import { seasonalMultiplier, FOOD_CROPS, SEASON_LENGTH, CANOPY_APPLE_RIPEN_TICKS } from "../src/crops.js";
import { EventLog } from "../src/events.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("maybeDropSeed", () => {
  it("turns open ground into a seedling when the roll succeeds", () => {
    const world = createWorld(3, 3);
    vi.spyOn(Math, "random").mockReturnValue(0); // always beats both chance checks
    const log = new EventLog();

    maybeDropSeed(world, "surface", { x: 1, y: 1 }, log);

    expect(tileAt(world, "surface", 1, 1)!.terrain).toBe("seedling");
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "floraChanged", stage: "seeded" }));
  });

  it("does nothing when the roll fails", () => {
    const world = createWorld(3, 3);
    vi.spyOn(Math, "random").mockReturnValue(0.999);

    maybeDropSeed(world, "surface", { x: 1, y: 1 });

    expect(tileAt(world, "surface", 1, 1)!.terrain).toBe("floor");
  });

  it("never plants on non-floor terrain (e.g. water)", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "water");
    vi.spyOn(Math, "random").mockReturnValue(0);

    maybeDropSeed(world, "surface", { x: 1, y: 1 });

    expect(tileAt(world, "surface", 1, 1)!.terrain).toBe("water");
  });
});

describe("growFlora", () => {
  it("matures a seedling into a full food patch after enough ticks (food roll succeeds)", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "seedling");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.growth = MATURATION_TICKS - 1; // one tick from maturity
    const log = new EventLog();
    vi.spyOn(Math, "random").mockReturnValue(0); // beats the food-vs-flora roll

    growFlora(world, log);

    expect(tile.terrain).toBe("food");
    expect(tile.stock).toBe(FOOD_MAX_STOCK);
    // A hand-built world has no biomeSeeds at all, so every biome-gated crop
    // (Wheat/Tomato/Corn/Rice/Apple/Potato/Pumpkin) is ineligible — Herbs
    // (no gates at all) is the only crop `pickCrop` can ever land on here.
    expect(tile.flavor).toBe("herbs");
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "floraChanged", stage: "sprouted", flavor: "herbs" })
    );
  });

  it("matures a seedling into decorative (non-edible) flora when the food roll fails", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "seedling");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.growth = MATURATION_TICKS - 1;
    vi.spyOn(Math, "random").mockReturnValue(0.99); // fails the food-vs-flora roll (55% chance of food)

    growFlora(world);

    expect(tile.terrain).toBe("flora");
    expect(tile.stock).toBe(1); // vitality, not edible stock — decorative flora is mortal too, see below
    expect(FLORA_FLAVORS as readonly string[]).toContain(tile.flavor);
  });

  it("a seedling near a sunbeam is more likely to mature into food (the real mechanism Tomato's sunLoving gate reuses)", () => {
    const world = createWorld(5, 5);
    setTile(world, "surface", 2, 2, "sunbeam");
    setTile(world, "surface", 3, 2, "seedling");
    const tile = tileAt(world, "surface", 3, 2)!;
    tile.growth = MATURATION_TICKS - 1;
    // 0.7 is below the near-sunbeam food chance (0.8) but above the normal
    // one (0.55) — proves the sunbeam is what tips this into food. (Tomato
    // itself can't actually be picked here — this hand-built world has no
    // biomeSeeds, so pickCrop always falls back to Herbs — but the
    // near-sunbeam food-chance boost Tomato's `sunLoving` gate reuses is
    // exactly this mechanism, unchanged by the crop system.)
    vi.spyOn(Math, "random").mockReturnValue(0.7);

    growFlora(world);

    expect(tile.terrain).toBe("food");
  });

  it("a living food patch decays on its own, even if nothing ever eats from it", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.stock = 0.5;
    vi.spyOn(Math, "random").mockReturnValue(0.99); // fails the spread roll, isolating decay

    growFlora(world);

    expect(tile.stock).toBeLessThan(0.5);
    expect(tile.terrain).toBe("food"); // not dead yet
  });

  it("a food patch dies (reverts to bare floor) once its stock runs out", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.stock = 0.001; // one tick of natural decay finishes it off
    tile.flavor = "herbs";
    const log = new EventLog();

    growFlora(world, log);

    expect(tile.terrain).toBe("floor");
    expect(tile.stock).toBeUndefined();
    expect(tile.flavor).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "floraChanged", stage: "died" }));
  });

  it("a living food patch can spread to seed an adjacent open tile", () => {
    const world = createWorld(5, 5);
    setTile(world, "surface", 2, 2, "food");
    const tile = tileAt(world, "surface", 2, 2)!;
    tile.stock = 1;
    vi.spyOn(Math, "random").mockReturnValue(0); // beats the spread roll, picks first shuffled neighbor

    growFlora(world);

    const neighborOffsets = [
      [1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3],
    ];
    const spread = neighborOffsets.some(([x, y]) => tileAt(world, "surface", x, y)!.terrain === "seedling");
    expect(spread).toBe(true);
  });

  it("decorative flora also decays and eventually dies back to floor — regression for the one-way ratchet bug", () => {
    // Real bug: flora never died, and a seedling can only ever plant on
    // bare "floor" — so decorative flora permanently converted floor away
    // without ever giving tiles back. A real 2000-tick run hit 0 food and
    // 248/384 tiles converted to dead-end flora, and the population
    // starved sitting in the water hole with nowhere left for new food to
    // grow. This just proves flora is mortal like food is.
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "flora");
    const tile = tileAt(world, "surface", 1, 1)!;
    expect(tile.stock).toBe(1); // setTile gives it full vitality, same as food

    tile.stock = 0.001;
    const log = new EventLog();
    growFlora(world, log);

    expect(tile.terrain).toBe("floor");
    expect(tile.stock).toBeUndefined();
    expect(tile.flavor).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "floraChanged", stage: "died" }));
  });
});

describe("growFlora: weather composes with the season multiplier (Phase 3)", () => {
  it("rain slows a food patch's decay relative to no weather at the same tick/season", () => {
    const rainy = createWorld(3, 3);
    setTile(rainy, "surface", 1, 1, "food");
    tileAt(rainy, "surface", 1, 1)!.stock = 0.5;
    rainy.weatherCells = [
      { id: "r", type: "rain", center: { x: 1, y: 1 }, radius: 3, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];

    const clear = createWorld(3, 3);
    setTile(clear, "surface", 1, 1, "food");
    tileAt(clear, "surface", 1, 1)!.stock = 0.5;

    vi.spyOn(Math, "random").mockReturnValue(0.99); // fails the spread roll on both, isolating decay
    growFlora(rainy);
    growFlora(clear);

    const rainyStock = tileAt(rainy, "surface", 1, 1)!.stock!;
    const clearStock = tileAt(clear, "surface", 1, 1)!.stock!;
    expect(rainyStock).toBeGreaterThan(clearStock); // decayed less under rain
    expect(rainyStock).toBeLessThan(0.5); // still decayed some — rain eases decay, doesn't freeze it
  });

  it("drought speeds up a food patch's decay relative to no weather at the same tick/season", () => {
    const droughty = createWorld(3, 3);
    setTile(droughty, "surface", 1, 1, "food");
    tileAt(droughty, "surface", 1, 1)!.stock = 0.5;
    droughty.weatherCells = [
      { id: "d", type: "drought", center: { x: 1, y: 1 }, radius: 3, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];

    const clear = createWorld(3, 3);
    setTile(clear, "surface", 1, 1, "food");
    tileAt(clear, "surface", 1, 1)!.stock = 0.5;

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    growFlora(droughty);
    growFlora(clear);

    const droughtyStock = tileAt(droughty, "surface", 1, 1)!.stock!;
    const clearStock = tileAt(clear, "surface", 1, 1)!.stock!;
    expect(droughtyStock).toBeLessThan(clearStock); // decayed more under drought
  });

  it("a food patch outside a weather cell's radius is unaffected by it", () => {
    const world = createWorld(20, 20);
    setTile(world, "surface", 1, 1, "food");
    tileAt(world, "surface", 1, 1)!.stock = 0.5;
    world.weatherCells = [
      { id: "d", type: "drought", center: { x: 15, y: 15 }, radius: 2, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];

    const control = createWorld(20, 20);
    setTile(control, "surface", 1, 1, "food");
    tileAt(control, "surface", 1, 1)!.stock = 0.5;

    vi.spyOn(Math, "random").mockReturnValue(0.99);
    growFlora(world);
    growFlora(control);

    expect(tileAt(world, "surface", 1, 1)!.stock).toBe(tileAt(control, "surface", 1, 1)!.stock);
  });

  it("rain raises the spread chance enough to flip a roll that would otherwise fail", () => {
    const rainy = createWorld(5, 5);
    setTile(rainy, "surface", 2, 2, "food");
    tileAt(rainy, "surface", 2, 2)!.stock = 1;
    rainy.weatherCells = [
      { id: "r", type: "rain", center: { x: 2, y: 2 }, radius: 3, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];
    const clear = createWorld(5, 5);
    setTile(clear, "surface", 2, 2, "food");
    tileAt(clear, "surface", 2, 2)!.stock = 1;

    // Base spread chance at tick 0 (season 0.5) is 0.035; rain's divisor
    // (1.6x) pushes it to 0.056 — 0.04 clears the rainy threshold but not
    // the clear one.
    vi.spyOn(Math, "random").mockReturnValue(0.04);
    growFlora(rainy);
    growFlora(clear);

    const neighborOffsets = [
      [1, 1], [1, 2], [1, 3], [2, 1], [2, 3], [3, 1], [3, 2], [3, 3],
    ];
    const rainySpread = neighborOffsets.some(([x, y]) => tileAt(rainy, "surface", x, y)!.terrain === "seedling");
    const clearSpread = neighborOffsets.some(([x, y]) => tileAt(clear, "surface", x, y)!.terrain === "seedling");
    expect(rainySpread).toBe(true);
    expect(clearSpread).toBe(false);
  });
});

describe("seasonalMultiplier", () => {
  it("stays within 0..1", () => {
    for (let tick = 0; tick < 2000; tick += 137) {
      const m = seasonalMultiplier(tick);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});

describe("CONSUME_STOCK_AMOUNT", () => {
  it("is a positive fraction of a patch's stock", () => {
    expect(CONSUME_STOCK_AMOUNT).toBeGreaterThan(0);
    expect(CONSUME_STOCK_AMOUNT).toBeLessThan(1);
  });

  it("empties a full patch in 3 feedings, not 4 — direct ask to make food less durable", () => {
    // Real-run tuning ask: "make food less durable... force migration."
    // CONSUME_STOCK_AMOUNT went 0.25 -> 0.35 specifically so 3 feedings
    // empty a patch instead of 4 — check the actual arithmetic, not just
    // the constant's raw value, so a future edit that quietly drifts this
    // back toward "4 feedings" gets caught here.
    let stock = 1;
    let feedings = 0;
    while (stock > 0) {
      stock = Math.max(0, stock - CONSUME_STOCK_AMOUNT);
      feedings++;
    }
    expect(feedings).toBe(3);
  });
});

describe("food/flora durability tuning (direct ask: less durable food to force migration)", () => {
  it("a full-stock food patch dies of natural decay meaningfully sooner than the old ~100-tick lifespan", () => {
    // tick 0 -> seasonalMultiplier(0) = 0.5, a fixed, reproducible decay
    // rate rather than depending on which tick within the season cycle the
    // test happens to run at.
    const world = createWorld(5, 5);
    setTile(world, "surface", 2, 2, "food");
    const tile = tileAt(world, "surface", 2, 2)!;
    tile.stock = 1;
    // Quality 0.5 (neutral) keeps this test isolated to the base decay
    // tuning it's actually about — an unset quality behaves as 1 (full
    // quality, see types.ts), which would slow decay via the "fully
    // fertile plants survive longer" quality effect and confound this
    // measurement.
    tile.quality = 0.5;
    world.tick = 0;

    // rng() always returns 1 so the spread roll (which would otherwise
    // plant a fresh neighboring seedling and complicate this specific
    // "how long does THIS patch last" measurement) never fires.
    let deathTick: number | undefined;
    for (let t = 1; t <= 120; t++) {
      world.tick = t;
      growFlora(world, undefined, () => 1);
      if (tileAt(world, "surface", 2, 2)!.terrain === "floor") {
        deathTick = t;
        break;
      }
    }

    expect(deathTick).toBeDefined();
    // Old FOOD_LIFESPAN_TICKS (100) would die around tick ~100 under this
    // same fixed decay rate; the new, shorter lifespan should die
    // noticeably earlier — comfortably under 90, with real margin below
    // the old value rather than right at the boundary.
    expect(deathTick!).toBeLessThan(90);
    // Sanity floor: not so short it's dying almost instantly either.
    expect(deathTick!).toBeGreaterThan(50);
  });

  it("food spreads less readily than before — a roll that would have beaten the old 0.035 rate no longer beats the new lower rate", () => {
    // At tick 0, seasonalMultiplier(0) = 0.5, so the spread check is
    // `rng() < FOOD_SPREAD_CHANCE * (0.5 + 0.5) = FOOD_SPREAD_CHANCE * 1`
    // with no active weather (weatherDivisor 1). A roll of exactly 0.03
    // would have beaten the old rate (0.035) but must now fail against the
    // new, lower rate (0.025) — a real behavior difference, not just a
    // constant-value check.
    const world = createWorld(5, 5);
    setTile(world, "surface", 2, 2, "food");
    tileAt(world, "surface", 2, 2)!.stock = 1;
    world.tick = 0;
    const log = new EventLog();

    growFlora(world, log, () => 0.03);

    expect(log.events.some((e) => e.kind === "floraChanged" && e.stage === "seeded")).toBe(false);

    // Confirm the same setup DOES spread at a roll that beats the new,
    // lower rate — the check above isn't just "nothing ever spreads."
    const world2 = createWorld(5, 5);
    setTile(world2, "surface", 2, 2, "food");
    tileAt(world2, "surface", 2, 2)!.stock = 1;
    world2.tick = 0;
    const log2 = new EventLog();

    growFlora(world2, log2, () => 0.01);

    expect(log2.events.some((e) => e.kind === "floraChanged" && e.stage === "seeded")).toBe(true);
  });
});

describe("grazing scars (sustained heavy grazing degrades a tile beyond ordinary stock depletion)", () => {
  it("recordGrazing accumulates pressure on repeated consumption", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    expect(tile.grazingPressure).toBeUndefined();

    recordGrazing(tile);
    expect(tile.grazingPressure).toBe(1);
    recordGrazing(tile);
    recordGrazing(tile);
    expect(tile.grazingPressure).toBe(3);
  });

  it("recordGrazing on an undefined tile is a safe no-op", () => {
    expect(() => recordGrazing(undefined)).not.toThrow();
  });

  it("a lightly-grazed patch (one feeding) never crosses the overgrazed threshold", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    recordGrazing(tile); // a single real feeding — should be a near-miss, not a scar

    for (let t = 1; t <= 50; t++) {
      world.tick = t;
      growFlora(world, undefined, () => 1); // never spreads, isolates the grazing accounting
    }

    expect(tile.overgrazed).not.toBe(true);
  });

  it("sustained heavy grazing (repeated feedings faster than decay) crosses the overgrazed threshold and fires a real event", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    const log = new EventLog();

    // Four real grazing events in quick succession (a herd camped on this
    // one tile, refeeding faster than the slow per-tick decay can undo) —
    // crosses OVERGRAZED_ENTER_PRESSURE (4).
    for (let i = 0; i < 4; i++) recordGrazing(tile);

    world.tick = 1;
    growFlora(world, log, () => 1);

    expect(tile.overgrazed).toBe(true);
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "floraChanged", stage: "overgrazed" }));
  });

  it("an overgrazed scar fades on its own after enough real time without further grazing", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    for (let i = 0; i < 4; i++) recordGrazing(tile);

    const log = new EventLog();
    let recoveredTick: number | undefined;
    for (let t = 1; t <= 1000; t++) {
      world.tick = t;
      growFlora(world, log, () => 1); // never re-grazed after tick 0, never spreads
      if (recoveredTick === undefined && tile.overgrazed === false) recoveredTick = t;
    }

    // It did fade...
    expect(recoveredTick).toBeDefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "floraChanged", stage: "recovered" }));
    // ...but only after a real rest period, not instantly (this is "the
    // ground needs to rest," not a same-tick flicker around the threshold).
    expect(recoveredTick!).toBeGreaterThan(50);
  });

  it("overgrazing suppresses spread onto that specific tile — a heavily-grazed patch's neighbor stays scarred while a fresh patch's neighbor gets seeded", () => {
    const heavy = createWorld(5, 5);
    setTile(heavy, "surface", 2, 2, "food");
    const heavyTile = tileAt(heavy, "surface", 2, 2)!;
    heavyTile.stock = 1;
    // Mark the one neighbor `trySpread` will pick (rng()=0 makes every
    // sort-comparator return -0.5, which for this NEIGHBOR_OFFSETS array
    // reliably puts {-1,-1} -> (1,1) first — verified directly, not assumed)
    // as overgrazed, same as if a herd had hammered that exact spot before.
    const scarredNeighbor = tileAt(heavy, "surface", 1, 1)!;
    for (let i = 0; i < 4; i++) recordGrazing(scarredNeighbor);
    scarredNeighbor.overgrazed = true;

    const fresh = createWorld(5, 5);
    setTile(fresh, "surface", 2, 2, "food");
    tileAt(fresh, "surface", 2, 2)!.stock = 1;

    // rng() = 0 always beats the spread roll and always picks the first
    // shuffled neighbor offset — isolates "does it land on the scarred tile
    // specifically," not "does it roll to spread at all."
    growFlora(heavy, undefined, () => 0);
    growFlora(fresh, undefined, () => 0);

    expect(tileAt(heavy, "surface", 1, 1)!.terrain).toBe("floor"); // still scarred, refused the seed
    expect(tileAt(fresh, "surface", 1, 1)!.terrain).toBe("seedling"); // same setup, no scar — spreads normally
  });

  it("overgrazed ground resists germination via maybeDropSeed — a roll that would succeed on fresh ground fails here", () => {
    const world = createWorld(3, 3);
    const tile = tileAt(world, "surface", 1, 1)!;
    for (let i = 0; i < 4; i++) recordGrazing(tile);
    tile.overgrazed = true;

    // rng() is called twice per attempt: once against SEED_DROP_CHANCE
    // (0.1), once against the germination chance. 0.099 clears the first
    // (0.099 < 0.1) but must fail the suppressed germination rate
    // (0.65 * 0.15 = 0.0975 — 0.099 >= 0.0975) while still clearing the
    // normal, unsuppressed rate (0.099 < 0.65) on fresh ground.
    maybeDropSeed(world, "surface", { x: 1, y: 1 }, undefined, () => 0.099);
    expect(tile.terrain).toBe("floor");

    // Same roll succeeds on an otherwise-identical, non-scarred tile.
    const control = createWorld(3, 3);
    maybeDropSeed(control, "surface", { x: 1, y: 1 }, undefined, () => 0.099);
    expect(tileAt(control, "surface", 1, 1)!.terrain).toBe("seedling");
  });

  it("a seedling on overgrazed ground matures slower than one on fresh ground", () => {
    const scarred = createWorld(3, 3);
    setTile(scarred, "surface", 1, 1, "seedling");
    const scarredTile = tileAt(scarred, "surface", 1, 1)!;
    for (let i = 0; i < 4; i++) recordGrazing(scarredTile);
    scarredTile.overgrazed = true;

    const fresh = createWorld(3, 3);
    setTile(fresh, "surface", 1, 1, "seedling");

    for (let t = 1; t <= 10; t++) {
      scarred.tick = t;
      fresh.tick = t;
      growFlora(scarred, undefined, () => 1);
      growFlora(fresh, undefined, () => 1);
    }

    // Fresh ground's growth advances 1/tick; scarred ground advances at the
    // suppressed rate — after the same 10 ticks it should measurably lag.
    expect(tileAt(scarred, "surface", 1, 1)!.growth!).toBeLessThan(tileAt(fresh, "surface", 1, 1)!.growth!);
  });

  it("rng-determinism: identical grazing/decay/overgrazed bookkeeping across two runs of the same fixed rng sequence", () => {
    function run(): unknown {
      const world = createWorld(4, 4);
      setTile(world, "surface", 1, 1, "food");
      const tile = tileAt(world, "surface", 1, 1)!;
      for (let i = 0; i < 5; i++) recordGrazing(tile);
      let calls = 0;
      const rng = () => {
        calls++;
        // A small deterministic pseudo-sequence, not Math.random.
        return (calls * 0.137) % 1;
      };
      for (let t = 1; t <= 200; t++) {
        world.tick = t;
        growFlora(world, undefined, rng);
      }
      return { pressure: tile.grazingPressure, overgrazed: tile.overgrazed, terrain: tile.terrain, stock: tile.stock };
    }

    expect(run()).toEqual(run());
  });
});

describe("soil fertility (direct ask: soil should take time to recover after growing something, with Water/Grass-type help)", () => {
  it("an untouched world-gen floor tile has undefined fertility (== fully fertile) — never gates a map's very first growth", () => {
    const world = createWorld(3, 3);
    expect(tileAt(world, "surface", 1, 1)!.fertility).toBeUndefined();
  });

  it("germination on an untouched tile is completely unaffected by the fertility gate (same odds as before this feature)", () => {
    const world = createWorld(3, 3);
    // First roll (SEED_DROP_CHANCE) just needs to pass; second roll is just
    // under GERMINATION_CHANCE (0.65) — succeeds only if fertility's
    // multiplier is exactly 1 on a never-touched tile, not silently < 1.
    const values = [0, 0.64];
    let i = 0;
    vi.spyOn(Math, "random").mockImplementation(() => values[i++]!);

    maybeDropSeed(world, "surface", { x: 1, y: 1 });

    expect(tileAt(world, "surface", 1, 1)!.terrain).toBe("seedling");
  });

  it("a food patch dying reverts fertility to a real, lower (not zero, not still-full) value", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.stock = 0.001; // one tick of decay away from dying

    growFlora(world, undefined, () => 0.99); // never spreads/germinates elsewhere, just decays this tile to death

    expect(tile.terrain).toBe("floor");
    expect(tile.fertility).toBeGreaterThan(0);
    expect(tile.fertility).toBeLessThan(1);
  });

  it("a flora patch dying also reverts fertility the same way", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "flora");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.stock = 0.001;

    growFlora(world, undefined, () => 0.99);

    expect(tile.terrain).toBe("floor");
    expect(tile.fertility).toBeGreaterThan(0);
    expect(tile.fertility).toBeLessThan(1);
  });

  it("low fertility measurably suppresses (but doesn't outright ban) germination", () => {
    const world = createWorld(3, 3);
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.fertility = 0.5;
    // Just over GERMINATION_CHANCE * 0.5 (0.325) — fails only because the
    // fertility multiplier is actually being applied, not ignored.
    vi.spyOn(Math, "random").mockReturnValue(0.33);

    maybeDropSeed(world, "surface", { x: 1, y: 1 });

    expect(tile.terrain).toBe("floor"); // germination roll failed
  });

  it("fertility recovers on its own over time via growFlora, without any watering/tending", () => {
    const world = createWorld(3, 3);
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.fertility = 0.5;

    for (let t = 1; t <= 50; t++) {
      world.tick = t;
      growFlora(world, undefined, () => 0.99); // no spontaneous germination/spread noise
    }

    expect(tile.fertility!).toBeGreaterThan(0.5);
    expect(tile.fertility!).toBeLessThanOrEqual(1);
  });

  it("passive regen never pushes fertility above 1, and never touches an already-fully-fertile (undefined) tile", () => {
    const world = createWorld(3, 3);
    const untouched = tileAt(world, "surface", 1, 1)!;
    const recovering = tileAt(world, "surface", 2, 2)!;
    recovering.fertility = 0.999;

    for (let t = 1; t <= 10; t++) {
      world.tick = t;
      growFlora(world, undefined, () => 0.99);
    }

    expect(untouched.fertility).toBeUndefined();
    expect(recovering.fertility).toBe(1);
  });

  describe("waterSoil (Water-type moves)", () => {
    it("raises fertility, capped at 1", () => {
      const world = createWorld(3, 3);
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.fertility = 0.9;

      waterSoil(tile);

      expect(tile.fertility).toBe(1);
    });

    it("gives a real boost off a low baseline, not a token nudge", () => {
      const world = createWorld(3, 3);
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.fertility = 0.35;

      waterSoil(tile);

      expect(tile.fertility!).toBeGreaterThan(0.6);
    });

    it("is a safe no-op on an undefined tile", () => {
      expect(() => waterSoil(undefined)).not.toThrow();
    });
  });

  describe("tendSoil (Grass-type agents standing on a tile)", () => {
    it("raises fertility a smaller amount than a single watering", () => {
      const world = createWorld(3, 3);
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.fertility = 0.35;

      tendSoil(tile);

      expect(tile.fertility!).toBeGreaterThan(0.35);
      expect(tile.fertility!).toBeLessThan(0.6); // meaningfully less than waterSoil's own boost
    });

    it("sustained tending over many ticks adds up to a real recovery", () => {
      const world = createWorld(3, 3);
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.fertility = 0.35;

      for (let i = 0; i < 40; i++) tendSoil(tile);

      expect(tile.fertility).toBe(1);
    });

    it("is a safe no-op on an undefined tile", () => {
      expect(() => tendSoil(undefined)).not.toThrow();
    });
  });

  it("rng-determinism: identical fertility bookkeeping across two runs of the same fixed rng sequence", () => {
    function run(): unknown {
      const world = createWorld(4, 4);
      setTile(world, "surface", 1, 1, "food");
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.stock = 0.001;
      let calls = 0;
      const rng = () => {
        calls++;
        return (calls * 0.137) % 1;
      };
      for (let t = 1; t <= 200; t++) {
        world.tick = t;
        growFlora(world, undefined, rng);
      }
      return { fertility: tile.fertility, terrain: tile.terrain };
    }

    expect(run()).toEqual(run());
  });
});

describe("plant quality (direct ask: \"fully fertile plant gives super higher quality berries... they don't need to be fully fertile to produce it. And fully fertile plants tend to survive noticeably longer and produce more\")", () => {
  it("a patch maturing on fertile-but-not-full ground still becomes food, at a reduced but not near-zero yield", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "seedling");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.growth = MATURATION_TICKS - 1;
    tile.fertility = 0; // worst case: freshly-harvested, zero recovery yet
    vi.spyOn(Math, "random").mockReturnValue(0); // wins the food-vs-flora roll

    growFlora(world);

    expect(tile.terrain).toBe("food");
    // Not exactly 0 — this same growFlora pass also applies one tick of
    // passive fertility regen before checking maturation, same per-tile
    // scan order as everything else in this file — but still ~0.
    expect(tile.quality!).toBeLessThan(0.01);
    // "don't need to be fully fertile to produce it" — a real majority of
    // FOOD_MAX_STOCK, not next to nothing.
    expect(tile.stock!).toBeGreaterThanOrEqual(FOOD_MAX_STOCK * 0.7);
    expect(tile.stock!).toBeLessThan(FOOD_MAX_STOCK);
  });

  it("a patch maturing on fully fertile ground yields the full FOOD_MAX_STOCK and records quality 1", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "seedling");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.growth = MATURATION_TICKS - 1;
    tile.fertility = 1;
    vi.spyOn(Math, "random").mockReturnValue(0);

    growFlora(world);

    expect(tile.quality).toBe(1);
    expect(tile.stock).toBe(FOOD_MAX_STOCK);
  });

  it("an untouched tile (undefined fertility, == fully fertile) also matures at full quality — no regression for ordinary growth", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "seedling");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.growth = MATURATION_TICKS - 1;
    vi.spyOn(Math, "random").mockReturnValue(0);

    growFlora(world);

    expect(tile.quality).toBe(1);
    expect(tile.stock).toBe(FOOD_MAX_STOCK);
  });

  it("a full-quality patch survives noticeably longer than a low-quality patch under identical decay conditions", () => {
    function ticksToDie(quality: number): number {
      const world = createWorld(3, 3);
      setTile(world, "surface", 1, 1, "food");
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.stock = 1;
      tile.quality = quality;
      world.tick = 0;
      for (let t = 1; t <= 500; t++) {
        world.tick = t;
        growFlora(world, undefined, () => 1); // rng() == 1 never fires the spread roll
        if (tileAt(world, "surface", 1, 1)!.terrain === "floor") return t;
      }
      throw new Error("never died");
    }

    expect(ticksToDie(1)).toBeGreaterThan(ticksToDie(0));
  });

  it("quality is cleared back to undefined once a food patch dies", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.stock = 0.001;
    tile.quality = 1;

    growFlora(world, undefined, () => 0.99);

    expect(tile.terrain).toBe("floor");
    expect(tile.quality).toBeUndefined();
  });

  it("quality is cleared back to undefined once a flora patch dies", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "flora");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.stock = 0.001;
    tile.quality = 0.2;

    growFlora(world, undefined, () => 0.99);

    expect(tile.terrain).toBe("floor");
    expect(tile.quality).toBeUndefined();
  });

  describe("foodNutritionFactor (direct ask: higher-quality berries restore more hunger)", () => {
    it("is 1 (neutral) for a tile with no recorded quality", () => {
      const world = createWorld(3, 3);
      setTile(world, "surface", 1, 1, "food");
      expect(foodNutritionFactor(tileAt(world, "surface", 1, 1))).toBe(1);
    });

    it("is 1 for undefined (no tile at all)", () => {
      expect(foodNutritionFactor(undefined)).toBe(1);
    });

    it("is greater than 1 for a full-quality patch", () => {
      const world = createWorld(3, 3);
      setTile(world, "surface", 1, 1, "food");
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.quality = 1;
      expect(foodNutritionFactor(tile)).toBeGreaterThan(1);
    });

    it("is less than 1 for a zero-quality patch — still real nutrition, just less", () => {
      const world = createWorld(3, 3);
      setTile(world, "surface", 1, 1, "food");
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.quality = 0;
      const factor = foodNutritionFactor(tile);
      expect(factor).toBeLessThan(1);
      expect(factor).toBeGreaterThan(0);
    });

    it("a nutrition-dense crop (Pumpkin) restores meaningfully more than a filler one (Herbs) at identical quality — the real 'keep you full for longer' mechanism", () => {
      const world = createWorld(3, 3);
      setTile(world, "surface", 1, 1, "food");
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.quality = 0.7;
      tile.flavor = "herbs";
      const herbsFactor = foodNutritionFactor(tile);
      tile.flavor = "pumpkin";
      const pumpkinFactor = foodNutritionFactor(tile);
      expect(pumpkinFactor).toBeGreaterThan(herbsFactor);
      expect(pumpkinFactor / herbsFactor).toBeCloseTo(FOOD_CROPS.pumpkin.nutritionMultiplier / FOOD_CROPS.herbs.nutritionMultiplier, 5);
    });

    it("a flavor that isn't a real crop id (e.g. decorative flora's own flavors) is treated as a neutral 1x multiplier, not a crash", () => {
      const world = createWorld(3, 3);
      setTile(world, "surface", 1, 1, "food");
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.flavor = "bloom"; // a FLORA_FLAVORS value, never a real CropId
      expect(() => foodNutritionFactor(tile)).not.toThrow();
      expect(foodNutritionFactor(tile)).toBe(1);
    });
  });
});

describe("crop maturation (CROPS_DESIGN.md: real biome/moisture/season-gated crops, not cosmetic flavors)", () => {
  it("a biome with real biomeSeeds data picks a real, biome-eligible crop instead of always falling back to Herbs", () => {
    const world = createWorld(10, 10);
    // A single grassland seed covering the whole tiny world — real
    // `biomeWeightsAt` data this time, unlike the hand-built worlds
    // elsewhere in this file (which have none and always land on Herbs).
    world.biomeSeeds = [{ x: 5, y: 5, name: "grassland" }];
    setTile(world, "surface", 5, 5, "seedling");
    const tile = tileAt(world, "surface", 5, 5)!;
    tile.growth = MATURATION_TICKS - 1;
    world.tick = 0; // Spring — wide-window grassland crops are all eligible

    // Sample across enough rng values that if crop selection were still
    // hardcoded to Herbs only, this would never see anything else.
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const w = createWorld(10, 10);
      w.biomeSeeds = [{ x: 5, y: 5, name: "grassland" }];
      setTile(w, "surface", 5, 5, "seedling");
      tileAt(w, "surface", 5, 5)!.growth = MATURATION_TICKS - 1;
      growFlora(w, undefined, () => i / 30);
      const t = tileAt(w, "surface", 5, 5)!;
      if (t.terrain === "food") seen.add(t.flavor!);
    }
    // Grassland-at-Spring-eligible crops: herbs, all four berries (ungated),
    // wheat, corn — Tomato (Summer-only) and Pumpkin (Autumn-only) are
    // excluded by their season window at tick 0 regardless of biome.
    expect(seen.size).toBeGreaterThan(1);
    for (const flavor of seen) expect(["herbs", "oran", "pecha", "sitrus", "cheri", "wheat", "corn"]).toContain(flavor);
  });

  it("Winter cuts a non-hardy crop's real chance of maturing into food at all (vs. decorative flora)", () => {
    function foodFraction(tick: number): number {
      let foodCount = 0;
      const trials = 200;
      for (let i = 0; i < trials; i++) {
        const world = createWorld(3, 3);
        world.biomeSeeds = [{ x: 1, y: 1, name: "grassland" }];
        setTile(world, "surface", 1, 1, "seedling");
        tileAt(world, "surface", 1, 1)!.growth = MATURATION_TICKS - 1;
        world.tick = tick;
        growFlora(world, undefined, () => i / trials);
        if (tileAt(world, "surface", 1, 1)!.terrain === "food") foodCount++;
      }
      return foodCount / trials;
    }

    const springFraction = foodFraction(0); // Spring
    const winterFraction = foodFraction(SEASON_LENGTH * 0.9); // Winter
    expect(winterFraction).toBeLessThan(springFraction);
  });

  it("a drought-resistant crop (Potato) decays slower under drought than a non-resistant one", () => {
    function stockAfterOneTick(flavor: string, drought: boolean): number {
      const world = createWorld(3, 3);
      setTile(world, "surface", 1, 1, "food");
      const tile = tileAt(world, "surface", 1, 1)!;
      tile.stock = 0.5;
      tile.flavor = flavor;
      if (drought) {
        world.weatherCells = [
          { id: "d", type: "drought", center: { x: 1, y: 1 }, radius: 3, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
        ];
      }
      growFlora(world, undefined, () => 0.99); // never spreads, isolates decay
      return tileAt(world, "surface", 1, 1)!.stock!;
    }

    const potatoNoDrought = stockAfterOneTick("potato", false);
    const potatoDrought = stockAfterOneTick("potato", true);
    const herbsDrought = stockAfterOneTick("herbs", true);

    // Both decay faster under drought than without it (real drought effect
    // still applies)...
    expect(potatoDrought).toBeLessThan(potatoNoDrought);
    // ...but Potato is spared most of that penalty relative to a
    // non-drought-resistant crop under the identical drought.
    expect(potatoDrought).toBeGreaterThan(herbsDrought);
  });
});

describe("growCanopyFood (CROPS_DESIGN.md: real growth-stage rendering, unripe canopy Apple before it's actually harvestable)", () => {
  it("advances an unripe canopy Apple tile's growth by 1 per tick, never touching Surface flora", () => {
    const world = createWorld(3, 1);
    setTile(world, "canopy", 1, 0, "food", 0, "apple");
    const tile = tileAt(world, "canopy", 1, 0)!;
    tile.stock = 0;
    tile.growth = 0;
    setTile(world, "surface", 1, 0, "food", 0, "corn"); // untouched control — growCanopyFood is Canopy-only
    const surfaceTile = tileAt(world, "surface", 1, 0)!;
    const surfaceStockBefore = surfaceTile.stock;

    growCanopyFood(world);

    expect(tile.growth).toBe(1);
    expect(tile.stock).toBe(0); // not ripe yet
    expect(surfaceTile.stock).toBe(surfaceStockBefore); // untouched
  });

  it("flips to real harvestable stock once growth reaches CANOPY_APPLE_RIPEN_TICKS, clearing the growth counter", () => {
    const world = createWorld(3, 1);
    setTile(world, "canopy", 1, 0, "food", 0, "apple");
    const tile = tileAt(world, "canopy", 1, 0)!;
    tile.stock = 0;
    tile.growth = CANOPY_APPLE_RIPEN_TICKS - 1;

    growCanopyFood(world);

    expect(tile.stock).toBe(FOOD_MAX_STOCK);
    expect(tile.growth).toBeUndefined();
  });

  it("never touches an already-ripe canopy Apple tile (real stock) — growCanopyFood only advances unripe ones", () => {
    const world = createWorld(3, 1);
    setTile(world, "canopy", 1, 0, "food", 0, "apple");
    const tile = tileAt(world, "canopy", 1, 0)!;
    const ripeStock = tile.stock;

    growCanopyFood(world);

    expect(tile.stock).toBe(ripeStock);
    expect(tile.growth).toBeUndefined();
  });

  it("never touches a non-Apple canopy food tile or a plain canopy floor tile", () => {
    const world = createWorld(3, 1);
    setTile(world, "canopy", 0, 0, "floor");
    setTile(world, "canopy", 1, 0, "food", 0, "corn"); // hypothetical non-canopy-native flavor on canopy — shouldn't happen in real worldgen, but growCanopyFood should still ignore it safely
    const cornTile = tileAt(world, "canopy", 1, 0)!;
    cornTile.stock = 0;
    cornTile.growth = 0;

    growCanopyFood(world);

    expect(tileAt(world, "canopy", 0, 0)!.growth).toBeUndefined();
    expect(cornTile.growth).toBe(0); // untouched — only flavor "apple" is ever advanced
  });
});
