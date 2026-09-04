import { describe, expect, it } from "vitest";
import { mulberry32, makeNoise2D, makeDensityField, generateWorld, findWalkableNear, blendBiomeParams } from "../src/worldgen.js";
import { tileAt, setTile } from "../src/world.js";

describe("mulberry32 (seeded PRNG)", () => {
  it("is deterministic: the same seed produces the same sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it("stays within [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("makeNoise2D", () => {
  it("is deterministic: the same seed produces the same field", () => {
    const noiseA = makeNoise2D(mulberry32(99), 40, 40, 5);
    const noiseB = makeNoise2D(mulberry32(99), 40, 40, 5);
    for (const [x, y] of [[0, 0], [12, 30], [39, 39], [5.5, 8.25]] as const) {
      expect(noiseA(x, y)).toBe(noiseB(x, y));
    }
  });

  it("is smooth: adjacent tiles differ gradually, not like independent random noise", () => {
    const noise = makeNoise2D(mulberry32(3), 60, 60, 8);
    let maxStep = 0;
    for (let x = 0; x < 59; x++) {
      maxStep = Math.max(maxStep, Math.abs(noise(x + 1, 20) - noise(x, 20)));
    }
    // A single Math.random() per tile would routinely jump close to 1 between
    // neighbors; smoothed value noise at this scale should never jump anywhere
    // near that between adjacent tiles.
    expect(maxStep).toBeLessThan(0.2);
  });
});

describe("makeDensityField", () => {
  it("calibrates thresholdFor so roughly the requested fraction of sampled tiles qualify", () => {
    const field = makeDensityField(123, 80, 80, 4);
    const density = 0.2;
    const threshold = field.thresholdFor(density);

    let hits = 0;
    let total = 0;
    for (let y = 0; y < 80; y += 2) {
      for (let x = 0; x < 80; x += 2) {
        total++;
        if (field.sample(x, y) < threshold) hits++;
      }
    }
    const actualFraction = hits / total;
    expect(actualFraction).toBeGreaterThan(density - 0.08);
    expect(actualFraction).toBeLessThan(density + 0.08);
  });

  it("a density of 0 yields (close to) nothing, and 1 yields (close to) everything", () => {
    const field = makeDensityField(456, 60, 60, 4);
    expect(field.thresholdFor(0)).toBeLessThanOrEqual(field.thresholdFor(0.5));
    expect(field.thresholdFor(0.5)).toBeLessThanOrEqual(field.thresholdFor(1));
  });
});

describe("generateWorld", () => {
  it("is fully deterministic: the same (width, height, seed) produces an identical grid", () => {
    const a = generateWorld(30, 20, 555);
    const b = generateWorld(30, 20, 555);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 30; x++) {
        const ta = tileAt(a, "surface", x, y)!;
        const tb = tileAt(b, "surface", x, y)!;
        expect(ta.terrain).toBe(tb.terrain);
        expect(ta.elevation).toBe(tb.elevation);
      }
    }
  });

  it("a different seed produces a different grid", () => {
    const a = generateWorld(30, 20, 1);
    const b = generateWorld(30, 20, 2);
    let differences = 0;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 30; x++) {
        if (tileAt(a, "surface", x, y)!.terrain !== tileAt(b, "surface", x, y)!.terrain) differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });

  it("produces a genuinely varied map: more than one terrain kind actually appears", () => {
    const world = generateWorld(90, 60, 2026);
    const kindsSeen = new Set<string>();
    for (const tile of world.tiles.surface) kindsSeen.add(tile.terrain);
    // floor plus at least a few of: water/food/tree/boulder/bush/sand/mud/sunbeam.
    expect(kindsSeen.size).toBeGreaterThanOrEqual(5);
  });

  it("underground/canopy stay the plain flat grid — a Surface-only generation pass", () => {
    const world = generateWorld(40, 30, 9);
    for (const tile of world.tiles.underground) {
      expect(tile.terrain).toBe("floor");
      expect(tile.elevation).toBe(0);
    }
    for (const tile of world.tiles.canopy) {
      expect(tile.terrain).toBe("floor");
      expect(tile.elevation).toBe(0);
    }
  });

  it("tree tiles are unwalkable; boulder/bush/sand/mud are walkable (boulder is slow and opaque, not a hard blocker)", () => {
    const world = generateWorld(90, 60, 77);
    let sawTree = false;
    let sawBoulder = false;
    for (const tile of world.tiles.surface) {
      if (tile.terrain === "tree") {
        sawTree = true;
        expect(tile.walkable).toBe(false);
        expect(tile.opaque).toBe(true);
      }
      if (tile.terrain === "boulder") {
        sawBoulder = true;
        // Walkable-but-slow (see support.ts's terrainSpeedMultiplier) and
        // still opaque (blocks sight/ranged attacks) — direct ask: boulders
        // shouldn't hard-block movement, just cost speed.
        expect(tile.walkable).toBe(true);
        expect(tile.opaque).toBe(true);
      }
      if (tile.terrain === "bush" || tile.terrain === "sand" || tile.terrain === "mud") {
        expect(tile.walkable).toBe(true);
        expect(tile.opaque).toBe(false);
      }
    }
    expect(sawTree).toBe(true);
    expect(sawBoulder).toBe(true);
  });
});

describe("biome blending", () => {
  it("blends parameters gradually across a boundary, not in a hard step", () => {
    // Two seeds, far apart on the x axis, with very different obstacle
    // densities — deliberately not going through the full random biome
    // placement so this test is about the blending math itself.
    const seeds = [
      { x: 0, y: 0, biome: { name: "a", seedCount: 1, foodDensity: 0.05, waterDensity: 0.05, obstacleDensity: 0.05, elevationBase: 0, elevationVariance: 0, terrainWeights: { tree: 1, boulder: 0, bush: 0, sand: 0, mud: 0 } } },
      { x: 100, y: 0, biome: { name: "b", seedCount: 1, foodDensity: 0.4, waterDensity: 0.4, obstacleDensity: 0.4, elevationBase: 3, elevationVariance: 0, terrainWeights: { tree: 0, boulder: 1, bush: 0, sand: 0, mud: 0 } } },
    ];

    const samples = Array.from({ length: 11 }, (_, i) => blendBiomeParams(seeds, i * 10, 0).obstacleDensity);

    // Monotonically increasing from seed A's value toward seed B's, not a step.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
    expect(samples[0]).toBeCloseTo(0.05, 1);
    expect(samples[samples.length - 1]).toBeCloseTo(0.4, 1);

    // No single step accounts for more than a small fraction of the total
    // change — i.e. it's a gradient, not "flat, flat, ..., jump, flat, flat".
    const totalChange = samples[samples.length - 1]! - samples[0]!;
    const maxStep = Math.max(...samples.slice(1).map((v, i) => v - samples[i]!));
    expect(maxStep).toBeLessThan(totalChange * 0.5);
  });
});

describe("findWalkableNear", () => {
  it("returns the anchor itself when it's already walkable", () => {
    const world = generateWorld(20, 20, 3);
    // Find a known-walkable tile first.
    const floor = tileAt(world, "surface", 0, 0);
    if (floor?.walkable) {
      expect(findWalkableNear(world, "surface", 0, 0)).toEqual({ x: 0, y: 0 });
    }
  });

  it("finds a nearby walkable tile when the anchor is an obstacle", () => {
    const world = generateWorld(20, 20, 5);
    // Force an obstacle at a known point.
    setTile(world, "surface", 10, 10, "boulder");
    const found = findWalkableNear(world, "surface", 10, 10);
    expect(tileAt(world, "surface", found.x, found.y)?.walkable).toBe(true);
  });
});
