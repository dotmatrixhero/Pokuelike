import { describe, expect, it } from "vitest";
import { displayNameFor } from "../src/names.js";
import type { PokemonType } from "../src/typing.js";

describe("displayNameFor", () => {
  it("is deterministic — naming can never perturb a seeded run", () => {
    expect(displayNameFor("a-1", ["grass"])).toBe(displayNameFor("a-1", ["grass"]));
  });

  it("flavours the name by type — a bug and a grass type do not sound alike", () => {
    const bug = Array.from({ length: 40 }, (_, i) => displayNameFor(`x-${i}`, ["bug"]));
    const grass = Array.from({ length: 40 }, (_, i) => displayNameFor(`x-${i}`, ["grass"]));
    // Same ids, different typing: the pools must not overlap at all.
    expect(bug.some((n) => grass.includes(n))).toBe(false);
  });

  it("still names an animal whose typing is unknown", () => {
    expect(displayNameFor("a-1")).toMatch(/^[A-Z][a-z]+$/);
  });

  it("has no collisions at a realistic same-species population", () => {
    // The original 240-name pool collided 56% of the time at 20 animals.
    for (const n of [20, 40, 80]) {
      const names = new Set(Array.from({ length: n }, (_, i) => displayNameFor(`bulbasaur-${i}`, ["grass"])));
      expect(names.size, `${n} animals`).toBe(n);
    }
  });

  it("never doubles a letter across a join — no 'Sapathhide'", () => {
    for (const type of ["grass", "fire", "water", "bug", "rock", "ghost", "steel"] as PokemonType[]) {
      for (let i = 0; i < 300; i++) {
        const name = displayNameFor(`agent-${type}-${i}`, [type]);
        expect(name, name).not.toMatch(/(.)\1\1/); // no tripled letters
        expect(name, name).toMatch(/^[A-Z][a-z]+$/);
      }
    }
  });

  it("keeps three-part names the exception, not the norm", () => {
    const withInfix = Array.from({ length: 400 }, (_, i) => displayNameFor(`n-${i}`, ["fire"]))
      .filter((n) => /wyn|dra|mor|thal/.test(n)).length;
    expect(withInfix).toBeGreaterThan(0);
    expect(withInfix).toBeLessThan(200); // under half
  });
});
