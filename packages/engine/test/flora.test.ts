import { describe, expect, it, vi, afterEach } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import {
  maybeDropSeed,
  growFlora,
  seasonalMultiplier,
  CONSUME_STOCK_AMOUNT,
  FOOD_FLAVORS,
  FLORA_FLAVORS,
  MATURATION_TICKS,
} from "../src/flora.js";
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
    vi.spyOn(Math, "random").mockReturnValue(0); // beats the food-vs-flora roll, picks flavor index 0

    growFlora(world, log);

    expect(tile.terrain).toBe("food");
    expect(tile.stock).toBe(1);
    expect(tile.flavor).toBe(FOOD_FLAVORS[0]);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "floraChanged", stage: "sprouted", flavor: FOOD_FLAVORS[0] })
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

  it("favors sun-loving berries when a seedling matures next to a sunbeam", () => {
    const world = createWorld(5, 5);
    setTile(world, "surface", 2, 2, "sunbeam");
    setTile(world, "surface", 3, 2, "seedling");
    const tile = tileAt(world, "surface", 3, 2)!;
    tile.growth = MATURATION_TICKS - 1;
    // 0.7 is below the near-sunbeam food chance (0.8) but above the normal
    // one (0.55) — proves the sunbeam is what tips this into food.
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
    tile.flavor = "oran";
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
