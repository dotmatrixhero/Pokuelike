import { describe, expect, it } from "vitest";
import { generateMacroGrid } from "../src/macroGrid.js";
import { MIN_NAMED_TERRITORY_ZONES, nameTerritories, territoryAt, territoryName } from "../src/territories.js";

const GRID = () => generateMacroGrid(24757, 64, 64);

describe("nameTerritories", () => {
  it("names a few dozen regions, not four thousand zones", () => {
    const grid = GRID();
    const ts = grid.territories!;
    // The whole point: collections of zones. A 64x64 grid has ~2300 land
    // zones; naming each would be meaningless.
    expect(ts.length).toBeGreaterThan(10);
    expect(ts.length).toBeLessThan(200);
  });

  it("covers most of the land — a map should not be mostly nameless", () => {
    const grid = GRID();
    const land = grid.zones.filter((z) => !z.isOcean).length;
    const named = grid.territories!.reduce((sum, t) => sum + t.zoneIndices.length, 0);
    expect(named / land).toBeGreaterThan(0.7);
  });

  it("never names the ocean", () => {
    const grid = GRID();
    for (const t of grid.territories!) {
      for (const index of t.zoneIndices) expect(grid.zones[index]!.isOcean).toBe(false);
    }
  });

  it("gives every territory one biome — a region is a contiguous run of one thing", () => {
    const grid = GRID();
    for (const t of grid.territories!) {
      for (const index of t.zoneIndices) expect(grid.zones[index]!.biome).toBe(t.biome);
    }
  });

  it("skips specks too small to be a region", () => {
    const grid = GRID();
    for (const t of grid.territories!) expect(t.zoneIndices.length).toBeGreaterThanOrEqual(MIN_NAMED_TERRITORY_ZONES);
  });

  it("gives no two regions the same name", () => {
    const grid = GRID();
    const names = grid.territories!.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts each label on a zone the territory actually contains", () => {
    // A crescent-shaped region's centre of mass can fall in the sea.
    const grid = GRID();
    for (const t of grid.territories!) {
      const index = t.labelRow * grid.cols + t.labelCol;
      expect(t.zoneIndices).toContain(index);
    }
  });

  it("stamps territoryId onto member zones, and territoryAt finds it", () => {
    const grid = GRID();
    const t = grid.territories![0]!;
    const found = territoryAt(grid, t.labelRow, t.labelCol);
    expect(found?.id).toBe(t.id);
  });

  it("is deterministic for a seed", () => {
    const a = generateMacroGrid(99, 32, 32).territories!.map((t) => t.name);
    const b = generateMacroGrid(99, 32, 32).territories!.map((t) => t.name);
    expect(a).toEqual(b);
  });

  it("re-running the naming pass is idempotent", () => {
    const grid = GRID();
    const before = grid.territories!.map((t) => t.name);
    nameTerritories(grid);
    expect(grid.territories!.map((t) => t.name)).toEqual(before);
  });
});

describe("territoryName", () => {
  it("never stutters — no 'the Crag Crags'", () => {
    for (const biome of ["highland", "forest", "desert", "snow", "wetland"]) {
      for (let i = 0; i < 400; i++) {
        const name = territoryName(biome, `${biome}:${i}`);
        const words = name.replace(/^the /, "").toLowerCase().split(/[\s]+/);
        if (words.length === 2) {
          expect(words[0]!.replace(/s$/, ""), name).not.toBe(words[1]!.replace(/s$/, ""));
        }
      }
    }
  });

  it("avoids names already taken", () => {
    const taken = new Set(["the Ashen Waste"]);
    for (let i = 0; i < 50; i++) {
      expect(territoryName("desert", `d:${i}`, taken)).not.toBe("the Ashen Waste");
    }
  });
});
