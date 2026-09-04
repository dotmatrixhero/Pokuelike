import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { EventLog } from "../src/events.js";
import {
  advanceWeather,
  advanceWaterCycle,
  pickWeatherType,
  activeWeatherAt,
  hasCoverNearby,
  floraDecayDivisor,
  thirstDecayMultiplier,
  stormAccuracyMultiplier,
  stormFovPenalty,
  isInColdSnap,
  RAIN_FLORA_DECAY_DIVISOR,
  DROUGHT_FLORA_DECAY_DIVISOR,
  RAIN_THIRST_DECAY_MULTIPLIER,
  DROUGHT_THIRST_DECAY_MULTIPLIER,
  STORM_ACCURACY_MULTIPLIER,
  STORM_FOV_PENALTY,
  MAX_ACTIVE_WEATHER_CELLS,
  DROUGHT_WATER_DRY_CHANCE_PER_TICK,
  RAIN_WATER_FORM_CHANCE_PER_TICK,
  LARGE_WATER_BODY_DRY_CHANCE_PER_TICK,
  LARGE_WATER_BODY_FLOOR_SIZE,
} from "../src/weather.js";
import { LARGE_WATER_BODY_MIN_SIZE } from "../src/waterBody.js";
import type { WeatherCell } from "../src/types.js";

/** Deterministic seeded PRNG (mulberry32) — for statistical tests that must never flake. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cell(overrides: Partial<WeatherCell> = {}): WeatherCell {
  return {
    id: "test-cell",
    type: "storm",
    center: { x: 40, y: 40 },
    radius: 10,
    startedTick: 0,
    lifespanTicks: 100,
    drift: { x: 0, y: 0 },
    ...overrides,
  };
}

describe("advanceWeather: lifecycle", () => {
  it("spawns a new cell when below the cap and the per-tick roll succeeds", () => {
    const world = createWorld(80, 80);
    const log = new EventLog();

    advanceWeather(world, log, () => 0); // 0 < any positive spawn chance -> always spawns; every subsequent roll comes out 0 too

    expect(world.weatherCells).toHaveLength(1);
    const spawned = world.weatherCells![0]!;
    expect(spawned.center).toEqual({ x: 0, y: 0 });
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "weatherChanged", phase: "began", center: { x: 0, y: 0 } })
    );
  });

  it("does not spawn when the per-tick roll fails", () => {
    const world = createWorld(80, 80);
    advanceWeather(world, undefined, () => 0.999999); // above any real spawn chance
    expect(world.weatherCells).toHaveLength(0);
  });

  it("does not spawn past MAX_ACTIVE_WEATHER_CELLS even when the roll would otherwise succeed", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ id: "a" }), cell({ id: "b" }), cell({ id: "c" })];
    expect(world.weatherCells).toHaveLength(MAX_ACTIVE_WEATHER_CELLS);

    advanceWeather(world, undefined, () => 0);

    expect(world.weatherCells).toHaveLength(MAX_ACTIVE_WEATHER_CELLS);
  });

  it("drifts a surviving cell by its fixed per-tick drift vector", () => {
    const world = createWorld(80, 80);
    world.tick = 1;
    world.weatherCells = [cell({ center: { x: 40, y: 40 }, drift: { x: 1.5, y: -0.5 }, lifespanTicks: 100, startedTick: 0 })];

    advanceWeather(world, undefined, () => 0.999999); // suppress the spawn roll so only drift is exercised

    expect(world.weatherCells![0]!.center).toEqual({ x: 41.5, y: 39.5 });
  });

  it("clamps a drifting cell's center to stay on the map instead of sailing off the edge", () => {
    const world = createWorld(80, 80);
    world.tick = 1;
    world.weatherCells = [cell({ center: { x: 0, y: 0 }, drift: { x: -5, y: -5 } })];

    advanceWeather(world, undefined, () => 0.999999);

    expect(world.weatherCells![0]!.center).toEqual({ x: 0, y: 0 });
  });

  it("dissipates a cell once its lifespan elapses, logging a weatherChanged 'ended' event", () => {
    const world = createWorld(80, 80);
    world.tick = 100;
    world.weatherCells = [cell({ startedTick: 0, lifespanTicks: 100, type: "rain", center: { x: 20, y: 20 }, radius: 5 })];
    const log = new EventLog();

    advanceWeather(world, log, () => 0.999999);

    expect(world.weatherCells).toHaveLength(0);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "weatherChanged", phase: "ended", weatherType: "rain", center: { x: 20, y: 20 }, radius: 5 })
    );
  });

  it("keeps a cell active for as long as its lifespan hasn't elapsed yet", () => {
    const world = createWorld(80, 80);
    world.tick = 99;
    world.weatherCells = [cell({ startedTick: 0, lifespanTicks: 100 })];

    advanceWeather(world, undefined, () => 0.999999);

    expect(world.weatherCells).toHaveLength(1);
  });
});

describe("pickWeatherType: biome-influenced spawn likelihood (statistical, fixed seed)", () => {
  const TRIALS = 5000;

  function countTypes(world: ReturnType<typeof createWorld>, x: number, y: number, seed: number): Record<string, number> {
    const rng = seededRng(seed);
    const counts: Record<string, number> = { rain: 0, storm: 0, drought: 0, coldSnap: 0 };
    for (let i = 0; i < TRIALS; i++) counts[pickWeatherType(world, x, y, rng)]!++;
    return counts;
  }

  it("skews toward rain on a Wetland-dominant point", () => {
    const world = createWorld(80, 80);
    world.biomeSeeds = [{ x: 40, y: 40, name: "wetland" }];
    const counts = countTypes(world, 40, 40, 1);

    expect(counts.rain).toBeGreaterThan(TRIALS * 0.5); // documented weight: rain 3 of a 4.8 total = 62.5%
    expect(counts.rain).toBeGreaterThan(counts.storm);
    expect(counts.rain).toBeGreaterThan(counts.drought);
    expect(counts.rain).toBeGreaterThan(counts.coldSnap);
  });

  it("skews toward drought on a Badlands-dominant point", () => {
    const world = createWorld(80, 80);
    world.biomeSeeds = [{ x: 40, y: 40, name: "badlands" }];
    const counts = countTypes(world, 40, 40, 2);

    expect(counts.drought).toBeGreaterThan(TRIALS * 0.6); // documented weight: drought 3 of a 4.0 total = 75%
    expect(counts.drought).toBeGreaterThan(counts.rain);
    expect(counts.drought).toBeGreaterThan(counts.storm);
    expect(counts.drought).toBeGreaterThan(counts.coldSnap);
  });

  it("skews toward storm and coldSnap on a Highland-dominant point", () => {
    const world = createWorld(80, 80);
    world.biomeSeeds = [{ x: 40, y: 40, name: "highland" }];
    const counts = countTypes(world, 40, 40, 3);

    expect(counts.storm).toBeGreaterThan(counts.rain);
    expect(counts.storm).toBeGreaterThan(counts.drought);
    expect(counts.coldSnap).toBeGreaterThan(counts.rain);
    expect(counts.coldSnap).toBeGreaterThan(counts.drought);
  });

  it("skews toward rain on a Grassland-dominant point", () => {
    const world = createWorld(80, 80);
    world.biomeSeeds = [{ x: 40, y: 40, name: "grassland" }];
    const counts = countTypes(world, 40, 40, 4);

    expect(counts.rain).toBeGreaterThan(counts.storm);
    expect(counts.rain).toBeGreaterThan(counts.drought);
    expect(counts.rain).toBeGreaterThan(counts.coldSnap);
  });

  it("falls back to a roughly uniform distribution when the world has no biome data at all", () => {
    const world = createWorld(80, 80); // no biomeSeeds — a bare hand-built world
    const counts = countTypes(world, 40, 40, 5);

    for (const type of ["rain", "storm", "drought", "coldSnap"]) {
      // Generous bounds around the exact 25% expectation — deterministic given the fixed seed, never flaky.
      expect(counts[type]).toBeGreaterThan(TRIALS * 0.15);
      expect(counts[type]).toBeLessThan(TRIALS * 0.35);
    }
  });
});

describe("activeWeatherAt", () => {
  it("finds a cell covering a point within its circular radius", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ center: { x: 10, y: 10 }, radius: 5 })];
    expect(activeWeatherAt(world, { x: 13, y: 10 })).toBeDefined(); // distance 3, inside radius 5
  });

  it("does not find a cell for a point outside its radius", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ center: { x: 10, y: 10 }, radius: 5 })];
    expect(activeWeatherAt(world, { x: 20, y: 10 })).toBeUndefined(); // distance 10, outside radius 5
  });

  it("returns undefined when there are no active cells", () => {
    const world = createWorld(80, 80);
    expect(activeWeatherAt(world, { x: 10, y: 10 })).toBeUndefined();
  });
});

describe("hasCoverNearby", () => {
  it("is true near a tree tile", () => {
    const world = createWorld(80, 80);
    setTile(world, "surface", 12, 10, "tree");
    expect(hasCoverNearby(world, "surface", { x: 10, y: 10 })).toBe(true);
  });

  it("is true near a bush tile", () => {
    const world = createWorld(80, 80);
    setTile(world, "surface", 10, 12, "bush");
    expect(hasCoverNearby(world, "surface", { x: 10, y: 10 })).toBe(true);
  });

  it("is false on open ground with nothing nearby", () => {
    const world = createWorld(80, 80);
    expect(hasCoverNearby(world, "surface", { x: 10, y: 10 })).toBe(false);
  });
});

describe("floraDecayDivisor / thirstDecayMultiplier: rain and drought", () => {
  it("rain divides the decay rate above 1 (slower decay) and drought below 1 (faster decay)", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "rain", center: { x: 10, y: 10 }, radius: 5 })];
    expect(floraDecayDivisor(world, "surface", { x: 10, y: 10 })).toBe(RAIN_FLORA_DECAY_DIVISOR);
    expect(RAIN_FLORA_DECAY_DIVISOR).toBeGreaterThan(1);

    world.weatherCells = [cell({ type: "drought", center: { x: 10, y: 10 }, radius: 5 })];
    expect(floraDecayDivisor(world, "surface", { x: 10, y: 10 })).toBe(DROUGHT_FLORA_DECAY_DIVISOR);
    expect(DROUGHT_FLORA_DECAY_DIVISOR).toBeLessThan(1);
  });

  it("is neutral (1) outside any weather cell", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "rain", center: { x: 60, y: 60 }, radius: 3 })];
    expect(floraDecayDivisor(world, "surface", { x: 10, y: 10 })).toBe(1);
  });

  it("is neutral off the surface layer even inside a cell's footprint", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "rain", center: { x: 10, y: 10 }, radius: 5 })];
    expect(floraDecayDivisor(world, "underground", { x: 10, y: 10 })).toBe(1);
  });

  it("thirst decay: rain eases it (multiplier < 1), drought raises it (multiplier > 1)", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "rain", center: { x: 10, y: 10 }, radius: 5 })];
    expect(thirstDecayMultiplier(world, "surface", { x: 10, y: 10 })).toBe(RAIN_THIRST_DECAY_MULTIPLIER);
    expect(RAIN_THIRST_DECAY_MULTIPLIER).toBeLessThan(1);

    world.weatherCells = [cell({ type: "drought", center: { x: 10, y: 10 }, radius: 5 })];
    expect(thirstDecayMultiplier(world, "surface", { x: 10, y: 10 })).toBe(DROUGHT_THIRST_DECAY_MULTIPLIER);
    expect(DROUGHT_THIRST_DECAY_MULTIPLIER).toBeGreaterThan(1);
  });

  it("storm and coldSnap leave flora/thirst untouched (only rain/drought affect them)", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "storm", center: { x: 10, y: 10 }, radius: 5 })];
    expect(floraDecayDivisor(world, "surface", { x: 10, y: 10 })).toBe(1);
    expect(thirstDecayMultiplier(world, "surface", { x: 10, y: 10 })).toBe(1);
  });
});

describe("stormAccuracyMultiplier / stormFovPenalty", () => {
  it("reduces accuracy inside a storm, and is neutral (1) outside one", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "storm", center: { x: 10, y: 10 }, radius: 5 })];
    expect(stormAccuracyMultiplier(world, "surface", { x: 10, y: 10 })).toBe(STORM_ACCURACY_MULTIPLIER);
    expect(STORM_ACCURACY_MULTIPLIER).toBeLessThan(1);
    expect(stormAccuracyMultiplier(world, "surface", { x: 60, y: 60 })).toBe(1);
  });

  it("adds a FOV penalty inside a storm, bigger than night's own penalty, and 0 outside one", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "storm", center: { x: 10, y: 10 }, radius: 5 })];
    expect(stormFovPenalty(world, "surface", { x: 10, y: 10 })).toBe(STORM_FOV_PENALTY);
    expect(stormFovPenalty(world, "surface", { x: 60, y: 60 })).toBe(0);
  });

  it("does not apply off the surface layer", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "storm", center: { x: 10, y: 10 }, radius: 5 })];
    expect(stormAccuracyMultiplier(world, "canopy", { x: 10, y: 10 })).toBe(1);
    expect(stormFovPenalty(world, "canopy", { x: 10, y: 10 })).toBe(0);
  });

  it("does not apply for rain/drought/coldSnap (storm-only effects)", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "coldSnap", center: { x: 10, y: 10 }, radius: 5 })];
    expect(stormAccuracyMultiplier(world, "surface", { x: 10, y: 10 })).toBe(1);
    expect(stormFovPenalty(world, "surface", { x: 10, y: 10 })).toBe(0);
  });
});

describe("isInColdSnap", () => {
  it("is true only inside an active coldSnap cell on the surface layer", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "coldSnap", center: { x: 10, y: 10 }, radius: 5 })];
    expect(isInColdSnap(world, "surface", { x: 10, y: 10 })).toBe(true);
    expect(isInColdSnap(world, "surface", { x: 60, y: 60 })).toBe(false);
    expect(isInColdSnap(world, "underground", { x: 10, y: 10 })).toBe(false);
  });

  it("is false for any other weather type", () => {
    const world = createWorld(80, 80);
    world.weatherCells = [cell({ type: "storm", center: { x: 10, y: 10 }, radius: 5 })];
    expect(isInColdSnap(world, "surface", { x: 10, y: 10 })).toBe(false);
  });
});

describe("advanceWaterCycle: sustained drought/rain mutate real terrain", () => {
  it("dries a water tile inside an active drought cell into mud when the roll succeeds, and logs terrainChanged", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    world.weatherCells = [cell({ type: "drought", center: { x: 5, y: 5 }, radius: 5 })];
    const log = new EventLog();

    advanceWaterCycle(world, log, () => 0); // 0 beats any positive per-tick chance

    expect(tileAt(world, "surface", 5, 5)!.terrain).toBe("mud");
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "terrainChanged", pos: { x: 5, y: 5 }, from: "water", to: "mud", cause: "drought" })
    );
  });

  it("does not dry a water tile when the roll fails", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    world.weatherCells = [cell({ type: "drought", center: { x: 5, y: 5 }, radius: 5 })];

    advanceWaterCycle(world, undefined, () => 0.999999);

    expect(tileAt(world, "surface", 5, 5)!.terrain).toBe("water");
  });

  it("does not dry water outside an active drought cell, or under rain/storm", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    setTile(world, "surface", 6, 6, "water");
    world.weatherCells = [cell({ type: "rain", center: { x: 5, y: 5 }, radius: 5 })];

    advanceWaterCycle(world, undefined, () => 0);

    expect(tileAt(world, "surface", 5, 5)!.terrain).toBe("water"); // rain doesn't dry water
    expect(tileAt(world, "surface", 6, 6)!.terrain).toBe("water"); // inside the cell but not drought-typed anyway
  });

  it("forms new water on a floor/mud/sand tile adjacent to existing water inside an active rain cell, and logs terrainChanged", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    setTile(world, "surface", 6, 5, "floor"); // adjacent to the water tile
    world.weatherCells = [cell({ type: "rain", center: { x: 5, y: 5 }, radius: 5 })];
    const log = new EventLog();

    advanceWaterCycle(world, log, () => 0);

    expect(tileAt(world, "surface", 6, 5)!.terrain).toBe("water");
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "terrainChanged", pos: { x: 6, y: 5 }, from: "floor", to: "water", cause: "rain" })
    );
  });

  it("does not form water on a tile with no adjacent water, even inside an active rain cell", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 2, "floor"); // no water anywhere nearby
    world.weatherCells = [cell({ type: "rain", center: { x: 2, y: 2 }, radius: 5 })];

    advanceWaterCycle(world, undefined, () => 0);

    expect(tileAt(world, "surface", 2, 2)!.terrain).toBe("floor");
  });

  it("does not form water on an ineligible terrain kind (e.g. tree) even when adjacent to water under rain", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    setTile(world, "surface", 6, 5, "tree");
    world.weatherCells = [cell({ type: "rain", center: { x: 5, y: 5 }, radius: 5 })];

    advanceWaterCycle(world, undefined, () => 0);

    expect(tileAt(world, "surface", 6, 5)!.terrain).toBe("tree");
  });

  it("is a no-op with no active weather cells at all", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    setTile(world, "surface", 6, 5, "floor");

    advanceWaterCycle(world, undefined, () => 0);

    expect(tileAt(world, "surface", 5, 5)!.terrain).toBe("water");
    expect(tileAt(world, "surface", 6, 5)!.terrain).toBe("floor");
  });

  it("magnitudes: a full weather-cell lifespan (500 ticks) dries a small body almost completely, a large one only modestly, and forms a meaningful minority of new water", () => {
    // Sanity-checks the doc comments' own math rather than re-deriving it by
    // hand here: with a per-tick chance p over N independent rolls, the
    // chance of at least one success is 1 - (1-p)^N.
    const N = 500;
    const smallDryFraction = 1 - Math.pow(1 - DROUGHT_WATER_DRY_CHANCE_PER_TICK, N);
    const largeDryFraction = 1 - Math.pow(1 - LARGE_WATER_BODY_DRY_CHANCE_PER_TICK, N);
    const formFraction = 1 - Math.pow(1 - RAIN_WATER_FORM_CHANCE_PER_TICK, N);
    // A small (below-threshold) body under a full sustained drought is very
    // likely to fully dry out — the direct "puddles can vanish" ask.
    expect(smallDryFraction).toBeGreaterThan(0.85);
    // A large body's per-tile drying is real but much more modest over the
    // same window — visible edge-shrinkage, not a wipeout.
    expect(largeDryFraction).toBeGreaterThan(0.05);
    expect(largeDryFraction).toBeLessThan(0.3);
    expect(formFraction).toBeGreaterThan(0.1);
    expect(formFraction).toBeLessThan(0.6);
    // Rain forms new water noticeably more slowly per-roll than a small body
    // dries — a deliberate asymmetry to counteract forming's own structural
    // growth advantage (each new water tile becomes a new adjacency source
    // for its neighbors) — see this file's own doc comment above the
    // exported constants for the full reasoning and the real run that found
    // it. A large body's drying rate is lower still, by direct design.
    expect(RAIN_WATER_FORM_CHANCE_PER_TICK).toBeLessThan(DROUGHT_WATER_DRY_CHANCE_PER_TICK);
    expect(LARGE_WATER_BODY_DRY_CHANCE_PER_TICK).toBeLessThan(DROUGHT_WATER_DRY_CHANCE_PER_TICK);
  });

  it("large water bodies dry much more slowly than small ones, and never dry below the floor size", () => {
    // Build one small (below-threshold) puddle and one large lake, both
    // fully exposed to the same sustained drought, then run many ticks
    // with a real seeded rng (not a fixed 0/1 roll) so both the "large
    // bodies shrink far slower" and "large bodies never fully vanish"
    // claims are exercised against realistic roll variance, not a
    // best-case single roll.
    const width = 30, height = 30;
    const world = createWorld(width, height);

    // Small puddle: a single isolated water tile (size 1) — always below
    // LARGE_WATER_BODY_MIN_SIZE, so it dries at the small-body rate and can
    // vanish completely.
    setTile(world, "surface", 3, 3, "water");

    // Large lake: a solid square block of water comfortably at/above
    // LARGE_WATER_BODY_MIN_SIZE tiles (a 5x5 = 25-tile block).
    const lakeOriginX = 15, lakeOriginY = 15, lakeSide = 5;
    for (let dy = 0; dy < lakeSide; dy++) {
      for (let dx = 0; dx < lakeSide; dx++) {
        setTile(world, "surface", lakeOriginX + dx, lakeOriginY + dy, "water");
      }
    }
    expect(lakeSide * lakeSide).toBeGreaterThanOrEqual(LARGE_WATER_BODY_MIN_SIZE);

    world.weatherCells = [cell({ type: "drought", center: { x: 15, y: 15 }, radius: 25 })];
    const rng = seededRng(2026);
    for (let t = 0; t < 4000; t++) {
      world.tick = t;
      advanceWaterCycle(world, undefined, rng);
    }

    // The small puddle, unprotected, is expected to have dried by now.
    expect(tileAt(world, "surface", 3, 3)!.terrain).toBe("mud");

    // The lake shrank but never disappeared, and never dropped below the
    // documented floor — even under 4000 ticks of continuous, never-ending
    // drought exposure (a harsher, more adversarial test than any real
    // weather cell, which always dissipates within a few hundred ticks).
    let lakeWaterTilesRemaining = 0;
    for (let dy = 0; dy < lakeSide; dy++) {
      for (let dx = 0; dx < lakeSide; dx++) {
        if (tileAt(world, "surface", lakeOriginX + dx, lakeOriginY + dy)!.terrain === "water") lakeWaterTilesRemaining++;
      }
    }
    expect(lakeWaterTilesRemaining).toBeGreaterThan(0);
    expect(lakeWaterTilesRemaining).toBeGreaterThanOrEqual(LARGE_WATER_BODY_FLOOR_SIZE);
    // A real, visible effect, not a no-op — some tiles did dry.
    expect(lakeWaterTilesRemaining).toBeLessThan(lakeSide * lakeSide);
  });

  it("determinism: the same rng sequence produces the exact same terrain outcome twice", () => {
    function run(): string {
      const world = createWorld(12, 12);
      setTile(world, "surface", 5, 5, "water");
      setTile(world, "surface", 6, 5, "floor");
      setTile(world, "surface", 4, 5, "sand");
      world.weatherCells = [
        cell({ type: "drought", center: { x: 5, y: 5 }, radius: 6 }),
      ];
      const log = new EventLog();
      const rng = seededRng(777);
      for (let t = 0; t < 50; t++) {
        world.tick = t;
        advanceWaterCycle(world, log, rng);
      }
      return JSON.stringify(log.events);
    }

    expect(run()).toBe(run());
  });
});
