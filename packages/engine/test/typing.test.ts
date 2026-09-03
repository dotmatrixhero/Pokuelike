import { describe, expect, it } from "vitest";
import { typeEffectiveness } from "../src/typing.js";

describe("typeEffectiveness", () => {
  it("is neutral (1x) for an unrelated matchup", () => {
    expect(typeEffectiveness("normal", ["grass"])).toBe(1);
  });

  it("is super effective (2x) for a textbook matchup", () => {
    expect(typeEffectiveness("fire", ["grass"])).toBe(2);
  });

  it("is not very effective (0.5x) for a textbook resist", () => {
    expect(typeEffectiveness("water", ["grass"])).toBe(0.5);
  });

  it("is immune (0x) for a textbook immunity", () => {
    expect(typeEffectiveness("normal", ["ghost"])).toBe(0);
    expect(typeEffectiveness("electric", ["ground"])).toBe(0);
  });

  it("stacks multipliers across dual types", () => {
    // Grass into Bug/Flying: 0.5 (bug) * 0.5 (flying) = 0.25 — quadruply resisted.
    expect(typeEffectiveness("grass", ["bug", "flying"])).toBe(0.25);
  });
});
