import { describe, expect, it } from "vitest";
import { elevationAccuracyModifier, elevationEvasionModifier, elevationAccuracyMultiplier } from "../src/elevation.js";

describe("elevation modifiers", () => {
  it("favors an attacker firing from higher ground", () => {
    expect(elevationAccuracyModifier(3, 0)).toBeGreaterThan(0);
    expect(elevationAccuracyModifier(0, 3)).toBeLessThan(0);
    expect(elevationAccuracyModifier(0, 0)).toBe(0);
  });

  it("favors a defender standing on higher ground", () => {
    expect(elevationEvasionModifier(3, 0)).toBeGreaterThan(0);
    expect(elevationEvasionModifier(0, 3)).toBeLessThan(0);
  });

  it("caps the modifier so an extreme height gap isn't a guaranteed hit/miss", () => {
    expect(elevationAccuracyModifier(50, 0)).toBeLessThan(1);
  });
});

describe("elevationAccuracyMultiplier: the value combat actually consumes", () => {
  it("is 1 on level ground, above 1 attacking downhill, below 1 attacking uphill", () => {
    expect(elevationAccuracyMultiplier(0, 0)).toBe(1);
    expect(elevationAccuracyMultiplier(3, 0)).toBeGreaterThan(1);
    expect(elevationAccuracyMultiplier(0, 3)).toBeLessThan(1);
  });

  it("stays inside [0.7, 1.3] no matter how extreme the gap", () => {
    expect(elevationAccuracyMultiplier(9999, 0)).toBeCloseTo(1.3, 10);
    expect(elevationAccuracyMultiplier(0, 9999)).toBeCloseTo(0.7, 10);
  });

  /**
   * Direct requirement: "it should be the diff between the attacker and the
   * defender not anything mapping a specific elevation to accuracy." Being
   * high up is worth nothing against someone equally high up — only the gap
   * between the two combatants counts. This pins that property against a
   * future change that reaches for an absolute-elevation term.
   */
  it("depends ONLY on the difference, never on absolute height", () => {
    const gapOfFour = elevationAccuracyMultiplier(4, 0);
    expect(elevationAccuracyMultiplier(104, 100)).toBe(gapOfFour);
    expect(elevationAccuracyMultiplier(-96, -100)).toBe(gapOfFour);
    expect(elevationAccuracyMultiplier(4.25, 0.25)).toBeCloseTo(gapOfFour, 10);

    // ...and equal footing is neutral at every altitude, sea level or summit.
    for (const height of [0, 1, 7.5, 250, -30]) {
      expect(elevationAccuracyMultiplier(height, height)).toBe(1);
    }
  });

  /**
   * The one real trap in elevation.ts: with `ACCURACY_PER_ELEVATION` and
   * `EVASION_PER_ELEVATION` equal, the evasion modifier is the exact
   * arithmetic negative of the accuracy modifier for the same pair. Applying
   * both to a single accuracy roll would double-count one height gap, which
   * is why only the accuracy side is wired into `rollAccuracy`. If these
   * constants ever diverge deliberately, this test should fail and be
   * rewritten rather than deleted.
   */
  it("evasion modifier is the exact negative of the accuracy modifier — why only one is applied", () => {
    for (const [attacker, defender] of [
      [3, 0],
      [0, 3],
      [1.75, -2.25],
      [0, 0],
    ]) {
      expect(elevationEvasionModifier(defender!, attacker!)).toBeCloseTo(-elevationAccuracyModifier(attacker!, defender!), 10);
    }
  });
});
