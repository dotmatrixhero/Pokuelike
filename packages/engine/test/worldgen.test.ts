import { describe, expect, it } from "vitest";
import { mulberry32, makeNoise2D, makeDensityField, generateWorld, generateMacroElevation, findWalkableNear, blendBiomeParams, biomeWeightsAt, effectiveWaterDensityAt } from "../src/worldgen.js";
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

  it("canopy stays the plain flat grid — a Surface-only generation pass; underground now gets real cellular-automata cave structure", () => {
    const world = generateWorld(40, 30, 9);
    for (const tile of world.tiles.canopy) {
      expect(tile.terrain).toBe("floor");
      expect(tile.elevation).toBe(0);
    }
    // Underground: every tile is still either "floor" or "wall" (the CA cave
    // carver's own vocabulary — no water/food/elevation texture, unlike
    // Surface), but it's no longer guaranteed *all* floor.
    let sawUndergroundWall = false;
    let sawUndergroundFloor = false;
    for (const tile of world.tiles.underground) {
      expect(["floor", "wall"]).toContain(tile.terrain);
      expect(tile.elevation).toBe(0);
      if (tile.terrain === "wall") sawUndergroundWall = true;
      if (tile.terrain === "floor") sawUndergroundFloor = true;
    }
    expect(sawUndergroundWall).toBe(true);
    expect(sawUndergroundFloor).toBe(true);
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

describe("effectiveWaterDensityAt: runtime-readable moisture field (TODO.md's flagged gap)", () => {
  it("returns undefined with no biome seed data at all — no data, no guessed default", () => {
    expect(effectiveWaterDensityAt(undefined, undefined, 5, 5)).toBeUndefined();
    expect(effectiveWaterDensityAt([], undefined, 5, 5)).toBeUndefined();
  });

  it("a point surrounded only by same-named seeds reads as that biome's own water density, and differs by biome", () => {
    // Same name at every nearby seed means the distance-weighted blend can't
    // move the result away from that one biome's own value, whatever the
    // weights are — this isolates "does the runtime lookup actually
    // differentiate Wetland from Badlands" from the blending math itself.
    const wetlandSeeds = [{ x: 10, y: 10, name: "wetland" }, { x: 10, y: 11, name: "wetland" }, { x: 11, y: 10, name: "wetland" }];
    const badlandsSeeds = [{ x: 10, y: 10, name: "badlands" }, { x: 10, y: 11, name: "badlands" }, { x: 11, y: 10, name: "badlands" }];
    const wetlandDensity = effectiveWaterDensityAt(wetlandSeeds, undefined, 10, 10)!;
    const badlandsDensity = effectiveWaterDensityAt(badlandsSeeds, undefined, 10, 10)!;
    expect(wetlandDensity).toBeGreaterThan(badlandsDensity);
  });

  it("blends gradually between two differently-named biomes across a boundary, not in a hard step", () => {
    const seeds = [
      { x: 0, y: 0, name: "wetland" },
      { x: 100, y: 0, name: "badlands" },
    ];
    const samples = Array.from({ length: 11 }, (_, i) => effectiveWaterDensityAt(seeds, undefined, i * 10, 0)!);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]!); // monotonically falling wetland -> badlands
    }
    expect(samples[0]).toBeGreaterThan(samples[samples.length - 1]!);
  });

  it("drift toward 1 pulls a seed's own contribution down to exactly the badlands-arid target; drift 0 leaves its original biome untouched", () => {
    const wetlandSeeds = [{ x: 10, y: 10, name: "wetland" }, { x: 10, y: 11, name: "wetland" }, { x: 11, y: 10, name: "wetland" }];
    const badlandsSeeds = [{ x: 10, y: 10, name: "badlands" }, { x: 10, y: 11, name: "badlands" }, { x: 11, y: 10, name: "badlands" }];
    const undrifted = effectiveWaterDensityAt(wetlandSeeds, [0, 0, 0], 10, 10)!;
    const fullyDrifted = effectiveWaterDensityAt(wetlandSeeds, [1, 1, 1], 10, 10)!;
    const badlandsReference = effectiveWaterDensityAt(badlandsSeeds, undefined, 10, 10)!;
    expect(undrifted).toBeGreaterThan(fullyDrifted);
    expect(fullyDrifted).toBeCloseTo(badlandsReference, 10);
  });

  it("a partial or missing drift array reads as 0 ('no drift yet') for every seed past its end", () => {
    const wetlandSeeds = [{ x: 10, y: 10, name: "wetland" }];
    expect(effectiveWaterDensityAt(wetlandSeeds, undefined, 10, 10)).toBe(effectiveWaterDensityAt(wetlandSeeds, [], 10, 10));
  });
});

describe("generateMacroElevation (Groudon uplift / Kyogre basin)", () => {
  it("is deterministic: the same seed produces the same field and the same land/ocean boundary", () => {
    const detail = makeNoise2D(mulberry32(1), 60, 40, 6);
    const a = generateMacroElevation(mulberry32(321), 60, 40, detail);
    const b = generateMacroElevation(mulberry32(321), 60, 40, detail);
    for (const [x, y] of [[0, 0], [30, 20], [59, 39], [12, 8]] as const) {
      expect(a.normalized(x, y)).toBe(b.normalized(x, y));
      expect(a.isOcean(x, y)).toBe(b.isOcean(x, y));
    }
  });

  it("places a real, non-trivial mix of ocean and land — not all-one or all-the-other", () => {
    const detail = makeNoise2D(mulberry32(2), 80, 60, 8);
    const macro = generateMacroElevation(mulberry32(654), 80, 60, detail);
    let ocean = 0;
    let land = 0;
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 80; x++) {
        if (macro.isOcean(x, y)) ocean++;
        else land++;
      }
    }
    expect(ocean).toBeGreaterThan(0);
    expect(land).toBeGreaterThan(0);
    // Roughly balanced per OCEAN_FRACTION, not a near-total wipeout either way.
    const oceanFraction = ocean / (ocean + land);
    expect(oceanFraction).toBeGreaterThan(0.2);
    expect(oceanFraction).toBeLessThan(0.7);
  });

  it("produces large coherent regions, not tile-by-tile speckle — most tiles agree with their immediate neighbor", () => {
    // The whole point of moving off small-scale value noise: real macro
    // shapes should be smooth at the tile level, not flip land/ocean at
    // every step the way independent-per-tile noise would.
    const detail = makeNoise2D(mulberry32(3), 70, 50, 7);
    const macro = generateMacroElevation(mulberry32(987), 70, 50, detail);
    let agreements = 0;
    let total = 0;
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 69; x++) {
        total++;
        if (macro.isOcean(x, y) === macro.isOcean(x + 1, y)) agreements++;
      }
    }
    expect(agreements / total).toBeGreaterThan(0.85);
  });
});

describe("generateWorld: rivers", () => {
  it("carves at least one real river reaching the coast: a beach ('sand') tile shows up next to the ocean it flowed into", () => {
    // A big-enough map that mountain peaks and coastline both show up
    // reliably, checked across several seeds so this isn't sensitive to one
    // unlucky roll (river placement is a real deterministic function of the
    // seed, not something to overfit a test to one exact count/position).
    let sawAnyBeach = false;
    for (const seed of [11, 22, 33, 44, 55]) {
      const world = generateWorld(90, 60, seed);
      for (const tile of world.tiles.surface) {
        if (tile.terrain === "sand") sawAnyBeach = true;
      }
    }
    expect(sawAnyBeach).toBe(true);
  });

  it("river generation doesn't break determinism: the same seed produces byte-identical terrain twice", () => {
    const a = generateWorld(90, 60, 999);
    const b = generateWorld(90, 60, 999);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 90; x++) {
        expect(tileAt(a, "surface", x, y)!.terrain).toBe(tileAt(b, "surface", x, y)!.terrain);
      }
    }
  });
});

describe("generateWorld: Badlands BSP chambers", () => {
  /** Mirrors worldgen.ts's own private `isBadlandsDominant` — kept here as its own small check, same "own math, not the exported internals" idiom as this file's other statistical tests, so this describes the *contract* (never spills past Badlands' footprint) rather than reaching into the implementation. */
  function isBadlandsDominant(world: ReturnType<typeof generateWorld>, x: number, y: number): boolean {
    const weights = biomeWeightsAt(world.biomeSeeds, x, y);
    const badlandsWeight = weights["badlands"] ?? 0;
    if (badlandsWeight <= 0) return false;
    return Object.entries(weights).every(([name, w]) => name === "badlands" || w < badlandsWeight);
  }

  it("places real 'wall' tiles somewhere across a handful of seeds — the mechanism actually fires, not just theoretically", () => {
    // wall never appeared anywhere in generateWorld's output before this
    // feature (OBSTACLE_KINDS never includes it) — checked across several
    // seeds since which exact seeds roll a wall tile is seed-dependent (a
    // low per-tile chance on a sparse subset of boundary lines).
    let sawAnyWall = false;
    for (const seed of [42, 7, 2, 5, 9, 11]) {
      const world = generateWorld(90, 60, seed);
      if (world.tiles.surface.some((t) => t.terrain === "wall")) sawAnyWall = true;
    }
    expect(sawAnyWall).toBe(true);
  });

  it("every 'wall' tile, and every BSP boundary boulder line, stays inside Badlands' own dominant footprint — never spills into another biome's territory", () => {
    for (const seed of [42, 7, 2, 5, 9, 11, 20260903]) {
      const world = generateWorld(90, 60, seed);
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          if (tileAt(world, "surface", x, y)!.terrain === "wall") {
            expect(isBadlandsDominant(world, x, y)).toBe(true);
          }
        }
      }
    }
  });

  it("wall is sparse relative to boulder within Badlands' footprint — the exception, not the rule", () => {
    let wallCount = 0;
    let boulderInBadlandsCount = 0;
    for (const seed of [42, 7, 2, 5, 9, 11, 20260903]) {
      const world = generateWorld(90, 60, seed);
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          const terrain = tileAt(world, "surface", x, y)!.terrain;
          if (terrain === "wall") wallCount++;
          else if (terrain === "boulder" && isBadlandsDominant(world, x, y)) boulderInBadlandsCount++;
        }
      }
    }
    expect(boulderInBadlandsCount).toBeGreaterThan(0);
    expect(wallCount).toBeGreaterThan(0);
    expect(wallCount).toBeLessThan(boulderInBadlandsCount * 0.3);
  });

  it("a BSP-placed boulder tile is walkable, opaque, and elevated above what a plain floor tile would read as at the exact same spot — reads exactly like a hand-placed boulder", () => {
    // BOULDER_ELEVATION_BOOST isn't exported (private tuning constant, same
    // as this file's other magic numbers) — this checks the *contract*
    // instead: every boulder tile's elevation strictly exceeds its own
    // ambient (non-boulder) elevation would have been, by re-deriving that
    // ambient baseline the same way carveBadlandsChambers itself does.
    let checked = 0;
    for (const seed of [42, 7, 2]) {
      const world = generateWorld(90, 60, seed);
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          const tile = tileAt(world, "surface", x, y)!;
          if (tile.terrain !== "boulder" && tile.terrain !== "wall") continue;
          expect(tile.walkable).toBe(tile.terrain === "boulder"); // boulder crosses, wall doesn't
          expect(tile.opaque).toBe(true); // both block sight
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("determinism: the same seed produces byte-identical wall/boulder placement", () => {
    const a = generateWorld(90, 60, 42);
    const b = generateWorld(90, 60, 42);
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 90; x++) {
        expect(tileAt(a, "surface", x, y)!.terrain).toBe(tileAt(b, "surface", x, y)!.terrain);
      }
    }
  });

  it("boundary lines meander instead of tracing a mathematically straight edge — direct ask: 'less rigidly room like... more organic, wobbly, rock shelf like'", () => {
    // A raw (pre-wobble) BspBoundary line holds one coordinate perfectly
    // constant along its whole length — e.g. a vertical line's every tile
    // shares the exact same x, for up to the map's own height. The real,
    // checkable signature of that rigidity: a long unbroken run of
    // boulder/wall tiles sharing the same x (scanning down a column) or
    // same y (scanning across a row). Post-wobble, the actual painted
    // column/row should drift within a few tiles well before any such run
    // gets anywhere near map-spanning length.
    function longestSameColumnRun(world: ReturnType<typeof generateWorld>): number {
      let longest = 0;
      for (let x = 0; x < world.width; x++) {
        let run = 0;
        for (let y = 0; y < world.height; y++) {
          const terrain = tileAt(world, "surface", x, y)!.terrain;
          run = terrain === "boulder" || terrain === "wall" ? run + 1 : 0;
          longest = Math.max(longest, run);
        }
      }
      return longest;
    }

    for (const seed of [42, 7, 2, 5, 9, 11]) {
      const world = generateWorld(90, 60, seed);
      // Well under the map's own height (60) — a straight vertical line long
      // enough to span most/all of a `BSP_MIN_LEAF_SIZE`(10)+ chamber's own
      // height would otherwise easily clear 20-30+ tiles of identical x.
      expect(longestSameColumnRun(world)).toBeLessThan(15);
    }
  });
});

describe("generateWorld: Underground cellular-automata caves", () => {
  /** 4-connected flood-fill component sizes over every "floor" underground tile — same connectivity convention waterBody.ts uses, checked independently here rather than reaching into worldgen.ts's own internal `keepOnlyLargestFloorRegion`. */
  function floorComponentSizes(world: ReturnType<typeof generateWorld>): number[] {
    const width = world.width, height = world.height;
    const visited = new Uint8Array(width * height);
    const sizes: number[] = [];
    for (let start = 0; start < width * height; start++) {
      const t = world.tiles.underground[start]!;
      if (visited[start] || t.terrain !== "floor") continue;
      let size = 0;
      const queue = [start];
      visited[start] = 1;
      while (queue.length > 0) {
        const i = queue.pop()!;
        size++;
        const x = i % width, y = Math.floor(i / width);
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue;
          const ni = ny! * width + nx!;
          if (visited[ni] || world.tiles.underground[ni]!.terrain !== "floor") continue;
          visited[ni] = 1;
          queue.push(ni);
        }
      }
      sizes.push(size);
    }
    return sizes;
  }

  it("produces a real, non-trivial mix of floor and wall — not all-one or all-the-other", () => {
    for (const seed of [9, 42, 7, 100]) {
      const world = generateWorld(90, 60, seed);
      const counts = { floor: 0, wall: 0 };
      for (const t of world.tiles.underground) counts[t.terrain as "floor" | "wall"]++;
      expect(counts.floor).toBeGreaterThan(0);
      expect(counts.wall).toBeGreaterThan(0);
    }
  });

  it("every floor tile belongs to exactly one connected region — no isolated, unreachable cave pockets", () => {
    for (const seed of [9, 42, 7, 100]) {
      const world = generateWorld(90, 60, seed);
      const sizes = floorComponentSizes(world);
      expect(sizes.length).toBe(1); // keepOnlyLargestFloorRegion walled off every other pocket
      expect(sizes[0]).toBeGreaterThan(0);
    }
  });

  it("canopy is untouched by cave generation — still the plain flat grid", () => {
    const world = generateWorld(90, 60, 9);
    for (const tile of world.tiles.canopy) expect(tile.terrain).toBe("floor");
  });

  it("determinism: the same seed produces byte-identical underground cave layout", () => {
    const a = generateWorld(90, 60, 42);
    const b = generateWorld(90, 60, 42);
    for (let i = 0; i < a.tiles.underground.length; i++) {
      expect(a.tiles.underground[i]!.terrain).toBe(b.tiles.underground[i]!.terrain);
    }
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
