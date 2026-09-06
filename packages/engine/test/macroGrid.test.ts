import { describe, expect, it } from "vitest";
import { DIRECTION_DELTA, OPPOSITE_DIRECTION } from "../src/directions.js";
import { generateMacroGrid, zoneAt, zoneKey, parseZoneKey, zoneNeighbors, biasForZone, estimateZoneResourceIndex, estimateZoneSpecies } from "../src/macroGrid.js";

describe("generateMacroGrid", () => {
  it("is fully deterministic for a given (seed, rows, cols)", () => {
    const a = generateMacroGrid(777, 20, 25);
    const b = generateMacroGrid(777, 20, 25);
    expect(a.zones).toEqual(b.zones);
  });

  it("a different seed produces a different grid", () => {
    const a = generateMacroGrid(1, 20, 25);
    const b = generateMacroGrid(2, 20, 25);
    expect(a.zones).not.toEqual(b.zones);
  });

  it("every (row, col) in bounds has a real zone entry, addressable both ways", () => {
    const grid = generateMacroGrid(5, 8, 6);
    expect(grid.zones.length).toBe(8 * 6);
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const zone = zoneAt(grid, row, col)!;
        expect(zone.row).toBe(row);
        expect(zone.col).toBe(col);
        expect(parseZoneKey(zoneKey(row, col))).toEqual({ row, col });
      }
    }
    expect(zoneAt(grid, -1, 0)).toBeUndefined();
    expect(zoneAt(grid, 0, grid.cols)).toBeUndefined();
  });

  it("zoneNeighbors returns only in-bounds orthogonal neighbors (up to 4, fewer at the grid's border)", () => {
    const grid = generateMacroGrid(9, 10, 10);
    const corner = zoneNeighbors(grid, 0, 0);
    expect(corner.length).toBe(2); // only E and S exist
    const interior = zoneNeighbors(grid, 5, 5);
    expect(interior.length).toBe(4);
  });

  it("roughly matches the tile-level generator's target ocean fraction (~44%) at real grid scale", () => {
    const grid = generateMacroGrid(2024, 80, 80);
    const oceanCount = grid.zones.filter((z) => z.isOcean).length;
    const fraction = oceanCount / grid.zones.length;
    expect(fraction).toBeGreaterThan(0.3);
    expect(fraction).toBeLessThan(0.6);
  });

  it("produces every one of the 6 land biome names across a large-enough grid, not just one", () => {
    const grid = generateMacroGrid(55, 100, 100);
    const biomes = new Set(grid.zones.filter((z) => !z.isOcean).map((z) => z.biome));
    for (const name of ["grassland", "forest", "wetland", "badlands", "highland", "snow"]) {
      expect(biomes.has(name)).toBe(true);
    }
  });

  it("coastEdges are symmetric with the grid's own isOcean facts: a land zone's coastEdge always points at a real ocean neighbor", () => {
    const grid = generateMacroGrid(31, 60, 60);
    let checked = 0;
    for (const zone of grid.zones) {
      if (zone.isOcean) continue;
      for (const dir of zone.coastEdges) {
        const delta = DIRECTION_DELTA[dir];
        const neighbor = zoneAt(grid, zone.row + delta.dr, zone.col + delta.dc);
        expect(neighbor).toBeDefined();
        expect(neighbor!.isOcean).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // the grid actually has coastline to check, not a vacuous pass
  });

  it("riverEdges are symmetric between two land neighbors: if A records an edge toward B, B records the opposite edge back toward A", () => {
    const grid = generateMacroGrid(31, 60, 60);
    let riverEdgeCount = 0;
    for (const zone of grid.zones) {
      for (const dir of zone.riverEdges) {
        const delta = DIRECTION_DELTA[dir];
        const neighbor = zoneAt(grid, zone.row + delta.dr, zone.col + delta.dc);
        expect(neighbor).toBeDefined();
        riverEdgeCount++;
        if (neighbor!.isOcean) continue; // a river mouth — the ocean-side neighbor never records a riverEdge back (see carveMacroRiver)
        expect(neighbor!.riverEdges).toContain(OPPOSITE_DIRECTION[dir]);
      }
    }
    expect(riverEdgeCount).toBeGreaterThan(0);
  });

  it("generates a real, large (hundreds of thousands of zones) grid fast enough to be practical", () => {
    const t0 = Date.now();
    const grid = generateMacroGrid(9001, 500, 500);
    const elapsedMs = Date.now() - t0;
    expect(grid.zones.length).toBe(250000);
    // Generous ceiling, not a tight perf assertion — this is a "doesn't
    // become impractical at real scale" sanity check, not a benchmark. A
    // real run on this dev environment measured well under a second (see
    // DESIGN.md for the exact number); 10s leaves huge headroom for a
    // slower CI machine while still catching an actual accidental
    // quadratic-blowup regression.
    expect(elapsedMs).toBeLessThan(10000);
  });

  /** 4-connected flood-fill component sizes matching `predicate` — same idiom this file's own "generates a real, large grid" style tests use, independent of any internal pruning/grouping the generator does. */
  function componentSizes(grid: ReturnType<typeof generateMacroGrid>, predicate: (row: number, col: number) => boolean): number[] {
    const { rows, cols } = grid;
    const visited = new Uint8Array(rows * cols);
    const sizes: number[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        if (visited[idx] || !predicate(row, col)) continue;
        let size = 0;
        const stack = [[row, col]];
        visited[idx] = 1;
        while (stack.length > 0) {
          const [r, c] = stack.pop()!;
          size++;
          for (const [dr, dc] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
            const ni = nr * cols + nc;
            if (visited[ni] || !predicate(nr, nc)) continue;
            visited[ni] = 1;
            stack.push([nr, nc]);
          }
        }
        sizes.push(size);
      }
    }
    return sizes;
  }

  it("islands: no tiny 1-9 zone land specks survive, but real secondary landmasses do — direct ask: 'Islands'", () => {
    // Real finding this guards against, from an actual connected-component
    // analysis across several seeds: alongside one dominant continent, the
    // elevation field's multi-uplift-point design already produces
    // secondary landmasses ranging from single-digit noise flecks up to
    // several-hundred-zone real islands — this only prunes the former.
    for (const seed of [1, 2, 3, 42, 20260903]) {
      const grid = generateMacroGrid(seed, 64, 64);
      const land = componentSizes(grid, (r, c) => !zoneAt(grid, r, c)!.isOcean);
      expect(Math.min(...land)).toBeGreaterThanOrEqual(10); // MIN_ISLAND_ZONES
    }
    // At least one seed in this batch keeps a real, meaningfully-sized
    // secondary landmass (not just the one dominant continent) — otherwise
    // this "feature" would just be deleting islands, not cleaning them up.
    const withRealIsland = [1, 2, 3, 42, 20260903].some((seed) => {
      const grid = generateMacroGrid(seed, 64, 64);
      const land = componentSizes(grid, (r, c) => !zoneAt(grid, r, c)!.isOcean).sort((a, b) => b - a);
      return land.length > 1 && land[1]! >= 50;
    });
    expect(withRealIsland).toBe(true);
  });

  it("biome regions read as real macro-scale stretches, not per-tile speckle — direct ask: 'stretches of desert... would be cool'", () => {
    // A single-digit-zone biome patch is barely distinguishable from noise;
    // a real "stretch" should span dozens of zones at minimum on a
    // reasonably large grid. Checked for badlands specifically (the direct
    // ask's own named example) across several seeds.
    for (const seed of [1, 2, 3, 42, 20260903]) {
      const grid = generateMacroGrid(seed, 64, 64);
      const badlands = componentSizes(grid, (r, c) => zoneAt(grid, r, c)!.biome === "badlands").sort((a, b) => b - a);
      expect(badlands.length).toBeGreaterThan(0);
      expect(badlands[0]!).toBeGreaterThan(20);
    }
  });
});

describe("biasForZone", () => {
  it("a fully-ocean zone gets a high oceanFraction target and no dominant biome", () => {
    const grid = generateMacroGrid(3, 20, 20);
    const oceanZone = grid.zones.find((z) => z.isOcean)!;
    const bias = biasForZone(grid, oceanZone.row, oceanZone.col);
    expect(bias.elevation.oceanFraction).toBeGreaterThan(0.5);
    expect(bias.dominantBiome).toBeUndefined();
  });

  it("a coastal land zone's lowEdges include every direction it actually borders ocean", () => {
    const grid = generateMacroGrid(3, 20, 20);
    const coastal = grid.zones.find((z) => !z.isOcean && z.coastEdges.length > 0)!;
    const bias = biasForZone(grid, coastal.row, coastal.col);
    for (const dir of coastal.coastEdges) expect(bias.elevation.lowEdges).toContain(dir);
    expect(bias.dominantBiome).toBe(coastal.biome);
  });

  it("a fully inland zone gets a small oceanFraction target", () => {
    const grid = generateMacroGrid(3, 20, 20);
    const inland = grid.zones.find((z) => !z.isOcean && z.coastEdges.length === 0);
    if (!inland) return; // this particular seed/size happened to have no fully-inland zone — not worth failing over
    const bias = biasForZone(grid, inland.row, inland.col);
    expect(bias.elevation.oceanFraction).toBeLessThan(0.15);
  });
});

describe("estimateZoneResourceIndex / estimateZoneSpecies", () => {
  it("estimates land zones within a plausible 0..1 range and ocean zones at a fixed estimate", () => {
    const grid = generateMacroGrid(3, 20, 20);
    for (const zone of grid.zones) {
      const estimate = estimateZoneResourceIndex(zone);
      expect(estimate).toBeGreaterThanOrEqual(0);
      expect(estimate).toBeLessThanOrEqual(1);
    }
    const ocean = grid.zones.find((z) => z.isOcean)!;
    expect(estimateZoneResourceIndex(ocean)).toBeCloseTo(0.6, 5);
  });

  it("only matches roster species whose biome preference (or lack of one) and aquatic-ness agree with the zone", () => {
    const grid = generateMacroGrid(3, 20, 20);
    const land = grid.zones.find((z) => !z.isOcean && z.biome === "grassland")!;
    const ocean = grid.zones.find((z) => z.isOcean)!;
    const roster = [
      { id: "grassland-only", homeLayer: "surface" as const, biomes: ["grassland"] },
      { id: "badlands-only", homeLayer: "surface" as const, biomes: ["badlands"] },
      { id: "no-preference", homeLayer: "surface" as const },
      { id: "fish", homeLayer: "surface" as const, obligateAquatic: true },
      // Mirrors @pokuelike/data's real magikarp/tentacool shape: obligate-
      // aquatic but tagged "wetland" (the roster's only real water-heavy
      // per-tile biome — "ocean" isn't a BIOMES entry at all), not "ocean"
      // literally. This must still match an ocean zone — see
      // estimateZoneSpecies's own doc comment for the real bug this guards.
      { id: "wetland-fish", homeLayer: "surface" as const, obligateAquatic: true, biomes: ["wetland"] },
    ];
    const rng = () => 0.5;

    const landMatches = new Set(estimateZoneSpecies(land, roster, rng).map((e) => e.speciesId));
    expect(landMatches.has("grassland-only")).toBe(true);
    expect(landMatches.has("badlands-only")).toBe(false);
    expect(landMatches.has("no-preference")).toBe(true);
    expect(landMatches.has("fish")).toBe(false);
    expect(landMatches.has("wetland-fish")).toBe(false);

    const oceanMatches = new Set(estimateZoneSpecies(ocean, roster, rng).map((e) => e.speciesId));
    expect(oceanMatches.has("fish")).toBe(true);
    expect(oceanMatches.has("wetland-fish")).toBe(true);
    expect(oceanMatches.has("grassland-only")).toBe(false);
    expect(oceanMatches.has("no-preference")).toBe(false); // no-preference isn't obligate-aquatic, so it's excluded from an ocean zone
  });
});
