import { describe, expect, it } from "vitest";
import { calculateStats } from "../src/stats.js";

const BULBASAUR_BASE = { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 };

describe("calculateStats", () => {
  it("produces mainline-scale numbers at level 5", () => {
    const stats = calculateStats(BULBASAUR_BASE, 5);
    // A real level-5 Bulbasaur has 19 HP in the mainline games (perfect IVs, no EVs) — close enough
    // that this confirms the formula shape, not just that it returns *some* positive number.
    expect(stats.maxHp).toBeGreaterThanOrEqual(17);
    expect(stats.maxHp).toBeLessThanOrEqual(21);
  });

  it("scales up with level", () => {
    const low = calculateStats(BULBASAUR_BASE, 5);
    const high = calculateStats(BULBASAUR_BASE, 50);
    expect(high.maxHp).toBeGreaterThan(low.maxHp);
    expect(high.attack).toBeGreaterThan(low.attack);
  });

  it("a higher base stat produces a higher computed stat at the same level", () => {
    const stats = calculateStats(BULBASAUR_BASE, 20);
    // Bulbasaur's SpAttack/SpDefense (65) are higher base than Attack/Defense (49).
    expect(stats.spAttack).toBeGreaterThan(stats.attack);
  });
});
