import { describe, expect, it } from "vitest";
import { elevationAccuracyModifier, elevationEvasionModifier } from "../src/elevation.js";

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
