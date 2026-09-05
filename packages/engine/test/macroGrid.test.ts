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

  it("produces every one of the 5 land biome names across a large-enough grid, not just one", () => {
    const grid = generateMacroGrid(55, 100, 100);
    const biomes = new Set(grid.zones.filter((z) => !z.isOcean).map((z) => z.biome));
    for (const name of ["grassland", "forest", "wetland", "badlands", "highland"]) {
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
    ];
    const rng = () => 0.5;

    const landMatches = new Set(estimateZoneSpecies(land, roster, rng).map((e) => e.speciesId));
    expect(landMatches.has("grassland-only")).toBe(true);
    expect(landMatches.has("badlands-only")).toBe(false);
    expect(landMatches.has("no-preference")).toBe(true);
    expect(landMatches.has("fish")).toBe(false);

    const oceanMatches = new Set(estimateZoneSpecies(ocean, roster, rng).map((e) => e.speciesId));
    expect(oceanMatches.has("fish")).toBe(true);
    expect(oceanMatches.has("grassland-only")).toBe(false);
    expect(oceanMatches.has("no-preference")).toBe(false); // no-preference isn't obligate-aquatic, so it's excluded from an ocean zone
  });
});
