import { describe, expect, it } from "vitest";
import { generateMacroGrid, hasFreshWater, siteScore } from "../src/index.js";

const SEEDS = [11, 22, 33];

describe("settlement history pass", () => {
  it("sites every settlement on FRESH water — the founding rule, and coast is salt", () => {
    for (const seed of SEEDS) {
      const grid = generateMacroGrid(seed, 64, 64);
      const history = grid.history!;
      expect(history.settlements.length).toBeGreaterThan(0);
      for (const s of history.settlements) {
        const zone = grid.zones[s.row * grid.cols + s.col]!;
        expect(hasFreshWater(zone)).toBe(true);
        expect(zone.isOcean).toBe(false);
        // A coast-only zone must never qualify on its own.
        expect(siteScore(grid, zone)).toBeGreaterThan(0);
      }
    }
  });

  it("keeps wilderness dominant — the human footprint is a small fraction of the land", () => {
    for (const seed of SEEDS) {
      const grid = generateMacroGrid(seed, 64, 64);
      const history = grid.history!;
      const land = grid.zones.filter((z) => !z.isOcean).length;
      const marked = new Set<number>(history.traffic.keys());
      for (const s of history.settlements) marked.add(s.row * grid.cols + s.col);
      // Decision 6: "Populated world is good, just gotta not be... everything."
      expect(marked.size / land).toBeLessThan(0.15);
    }
  });

  it("reaches every speciality across seeds — an unreachable one is a defect, not a rarity", () => {
    const seen = new Set<string>();
    for (const seed of [11, 22, 33, 44, 55, 66]) {
      for (const s of generateMacroGrid(seed, 64, 64).history!.settlements) seen.add(s.specialty);
    }
    // This is the regression guard for the first-match version of
    // `specialtyFor`, which produced merchant 0 and farming 1 because
    // "high ground nearby" swallowed nearly every site into smithing.
    for (const specialty of ["farming", "smithing", "merchant", "port", "timber"]) {
      expect(seen).toContain(specialty);
    }
  });

  it("records a real cause on every ruin, and builds lineages rather than only origins", () => {
    let daughters = 0;
    for (const seed of SEEDS) {
      const history = generateMacroGrid(seed, 64, 64).history!;
      for (const s of history.settlements) {
        if (s.status === "ruined") {
          expect(s.ruinedCause).toBeTruthy();
          expect(s.ruinedEra).toBeGreaterThanOrEqual(0);
        }
        if (s.origin === "daughter") {
          daughters++;
          expect(s.parentId).toBeTruthy();
          expect(history.settlements.some((p) => p.id === s.parentId)).toBe(true);
        }
      }
      // Roads always connect two real settlements.
      for (const road of history.roads) {
        expect(history.settlements.some((s) => s.id === road.fromId)).toBe(true);
        expect(history.settlements.some((s) => s.id === road.toId)).toBe(true);
        expect(road.zoneIndices.length).toBeGreaterThan(1);
      }
    }
    expect(daughters).toBeGreaterThan(0);
  });

  it("is deterministic for a seed", () => {
    const a = generateMacroGrid(11, 64, 64).history!;
    const b = generateMacroGrid(11, 64, 64).history!;
    expect(a.settlements.map((s) => `${s.name}@${s.row},${s.col}:${s.status}`)).toEqual(
      b.settlements.map((s) => `${s.name}@${s.row},${s.col}:${s.status}`)
    );
  });
});
