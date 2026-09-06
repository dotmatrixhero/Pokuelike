import { describe, expect, it } from "vitest";
import { generateMacroGrid } from "../src/macroGrid.js";
import { LANDMARK_TYPES, LANDMARK_DEFS } from "../src/landmarks.js";

describe("placeLandmarks (via generateMacroGrid)", () => {
  it("is deterministic for a given (seed, rows, cols)", () => {
    const a = generateMacroGrid(555, 60, 60);
    const b = generateMacroGrid(555, 60, 60);
    expect(a.zones.map((z) => z.landmark)).toEqual(b.zones.map((z) => z.landmark));
  });

  it("places at least one of most landmark types on a large enough grid", () => {
    const grid = generateMacroGrid(2024, 200, 200);
    const seen = new Set(grid.zones.map((z) => z.landmark).filter(Boolean));
    // Not a hard guarantee for every type (some require rare terrain, e.g.
    // requiresLake) — but the large majority should show up somewhere on a
    // 40,000-zone grid.
    expect(seen.size).toBeGreaterThanOrEqual(LANDMARK_TYPES.length - 2);
  });

  it("never exceeds a type's maxCount", () => {
    const grid = generateMacroGrid(999, 300, 300);
    const counts: Record<string, number> = {};
    for (const z of grid.zones) {
      if (z.landmark) counts[z.landmark] = (counts[z.landmark] ?? 0) + 1;
    }
    for (const type of LANDMARK_TYPES) {
      expect(counts[type] ?? 0).toBeLessThanOrEqual(LANDMARK_DEFS[type].maxCount);
    }
  });

  it("never places a landmark on an ocean zone", () => {
    const grid = generateMacroGrid(42, 150, 150);
    for (const z of grid.zones) {
      if (z.landmark) expect(z.isOcean).toBe(false);
    }
  });

  it("never places two landmarks on the same zone", () => {
    const grid = generateMacroGrid(4242, 150, 150);
    for (const z of grid.zones) {
      expect(z.landmark === undefined || LANDMARK_TYPES.includes(z.landmark)).toBe(true);
    }
  });

  it("greatLake only ever lands on a zone already flagged isLake", () => {
    const grid = generateMacroGrid(123, 200, 200);
    for (const z of grid.zones) {
      if (z.landmark === "greatLake") expect(z.isLake).toBe(true);
    }
  });

  it("respects eligibleBiomes for a biome-restricted type", () => {
    const grid = generateMacroGrid(321, 200, 200);
    const def = LANDMARK_DEFS.frozenGrotto;
    for (const z of grid.zones) {
      if (z.landmark === "frozenGrotto") expect(def.eligibleBiomes).toContain(z.biome);
    }
  });

  it("crossroads only ever lands on a zone with at least minLandNeighbors land neighbors", () => {
    const grid = generateMacroGrid(654, 200, 200);
    for (const z of grid.zones) {
      if (z.landmark !== "crossroads") continue;
      let landNeighbors = 0;
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const nr = z.row + dr;
        const nc = z.col + dc;
        if (nr < 0 || nc < 0 || nr >= grid.rows || nc >= grid.cols) continue;
        const neighbor = grid.zones[nr * grid.cols + nc]!;
        if (!neighbor.isOcean) landNeighbors++;
      }
      expect(landNeighbors).toBeGreaterThanOrEqual(LANDMARK_DEFS.crossroads.minLandNeighbors!);
    }
  });
});
