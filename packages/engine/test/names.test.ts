import { describe, expect, it } from "vitest";
import { displayNameFor, speciesDisplayName, withArticle } from "../src/names.js";
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

  it("reaches its whole pool — no correlation between the two halves", () => {
    // This is the assertion that caught a real bug twice. Plain FNV-1a
    // preserves parity, so salting the id with `":end"` flipped the low bit
    // every time and locked root and end into opposite parities: exactly
    // half the pairings (1,404 of 2,808) were unreachable, with nothing
    // visibly wrong in the output. Asserting the pool is FULLY reachable is
    // the only thing that surfaces that class of failure.
    const names = new Set(Array.from({ length: 200_000 }, (_, i) => displayNameFor(`z-${i}`, ["grass"])));
    expect(names.size).toBeGreaterThan(2_700);
  });

  it("keeps same-species collisions rare at the scale a real run reaches", () => {
    // Deliberately a measured RATE, not the "zero collisions" the previous
    // version claimed. Dropping the infix (see names.ts) shrank the pool
    // from ~9,600 per type to ~2,800, and at 2,800 names the birthday
    // problem makes zero collisions in a 40-animal cohort simply false —
    // asserting it would only have held for the one hand-picked id set the
    // test happened to use. Measured over 500 independent cohorts: 1.4% of
    // 12-animal cohorts and 5.2% of 20-animal cohorts contain any duplicate
    // at all. A herd peaks around a dozen and a species runs a few dozen
    // world-wide, so that is the range that matters.
    const cohorts = 500;
    const dupRate = (n: number): number => {
      let withDup = 0;
      for (let c = 0; c < cohorts; c++) {
        const names = new Set(Array.from({ length: n }, (_, i) => displayNameFor(`bulbasaur-${c}-${i}`, ["grass"])));
        if (names.size !== n) withDup++;
      }
      return withDup / cohorts;
    };
    expect(dupRate(12), "12 animals").toBeLessThan(0.05);
    expect(dupRate(20), "20 animals").toBeLessThan(0.12);
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

  it("is strictly two parts — no spliced middle syllable", () => {
    // Direct verdict on the old three-part form: "waspdraseeker and
    // foamthalborn and flarewynwing is a bit much. Waspseeker and foamborn
    // and flarewing and pincerheart accomplish the same thing better."
    const names = Array.from({ length: 400 }, (_, i) => displayNameFor(`n-${i}`, ["fire"]));
    for (const name of names) expect(name, name).not.toMatch(/wyn|dra|thal/);
  });
});

describe("species display", () => {
  it("capitalises a species id — Pokemon names are proper nouns", () => {
    expect(speciesDisplayName("ivysaur")).toBe("Ivysaur");
    expect(speciesDisplayName("bulbasaur")).toBe("Bulbasaur");
  });

  it("picks the article that matches the name", () => {
    // Five of the current roster start with a vowel: Onix, Ivysaur, Ekans,
    // Arbok, Oddish — so "a" cannot be hardcoded.
    expect(withArticle("Ivysaur")).toBe("an Ivysaur");
    expect(withArticle("Onix")).toBe("an Onix");
    expect(withArticle("Bulbasaur")).toBe("a Bulbasaur");
    expect(withArticle("Charizard")).toBe("a Charizard");
  });
});
