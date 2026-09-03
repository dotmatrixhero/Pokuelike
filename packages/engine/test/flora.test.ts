import { describe, expect, it, vi, afterEach } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { maybeDropSeed, growFlora, seasonalMultiplier, CONSUME_STOCK_AMOUNT } from "../src/flora.js";
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
  it("matures a seedling into a full food patch after enough ticks", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "seedling");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.growth = 149; // one tick from maturity
    const log = new EventLog();

    growFlora(world, log);

    expect(tile.terrain).toBe("food");
    expect(tile.stock).toBe(1);
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "floraChanged", stage: "sprouted" }));
  });

  it("regrows a depleted food patch's stock over time", () => {
    const world = createWorld(3, 3);
    setTile(world, "surface", 1, 1, "food");
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.stock = 0.5;

    growFlora(world);

    expect(tile.stock).toBeGreaterThan(0.5);
    expect(tile.stock).toBeLessThanOrEqual(1);
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
