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
    expect(tile.stock).toBeUndefined();
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
});
