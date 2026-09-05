import { describe, expect, it } from "vitest";
import { SPECIES } from "../src/species.js";
import { LEVELING_CONTEXT } from "../src/leveling.js";
import { IMMIGRATION_CONTEXT } from "../src/immigration.js";
import { spawnAgent } from "../src/spawn.js";
import { SPECIES_DEX_BY_KEY } from "../src/dex/index.js";

/**
 * Data-integrity checks for this feature's new species (geodude/growlithe/
 * mankey) and charmander's first real spawn — see DESIGN.md's "Species/
 * biome/immigration" section. Every one of these is a real, checkable claim
 * this feature's own doc comments make (species.ts) — this test confirms
 * they're actually true, not just asserted in a comment.
 */
const NEW_SPECIES = ["geodude", "growlithe", "mankey"] as const;

describe("new species: dex entries resolve", () => {
  for (const id of NEW_SPECIES) {
    it(`${id} has a real SPECIES entry with baseStats/types from the dex`, () => {
      const species = SPECIES[id];
      expect(species).toBeDefined();
      expect(species!.baseStats.hp).toBeGreaterThan(0);
      expect(species!.types.length).toBeGreaterThan(0);
    });

    it(`${id}'s moves all resolve to real MoveSpecs (species.ts's own moves list)`, () => {
      const species = SPECIES[id]!;
      expect(species.moves.length).toBeGreaterThan(0);
      // spawnAgent throws if any move id doesn't resolve — see spawn.ts.
      expect(() => spawnAgent(id, `${id}-test`, { x: 0, y: 0 }, 5, () => 0.5)).not.toThrow();
    });

    it(`${id} has real egg groups wired through LevelingContext.getProfile`, () => {
      const profile = LEVELING_CONTEXT.getProfile(id);
      expect(profile).toBeDefined();
      expect(profile!.eggGroups.length).toBeGreaterThan(0);
    });
  }

  it("geodude and onix share the Mineral egg group (a real cross-species breeding pair)", () => {
    const geodudeGroups = LEVELING_CONTEXT.getProfile("geodude")!.eggGroups;
    const onixGroups = LEVELING_CONTEXT.getProfile("onix")!.eggGroups;
    expect(geodudeGroups).toContain("mineral");
    expect(onixGroups).toContain("mineral");
  });

  it("mankey has a real level-only evolution (Primeape) that resolves to a known species id", () => {
    const profile = LEVELING_CONTEXT.getProfile("mankey")!;
    expect(profile.evolutions.length).toBeGreaterThan(0);
    const evo = profile.evolutions[0]!;
    expect(evo.targetSpeciesId).toBe("primeape");
    expect(SPECIES_DEX_BY_KEY[evo.targetSpeciesId.toUpperCase()]).toBeDefined();
  });

  it("growlithe's only evolution needs an item, so it correctly has zero level-only evolutions (matches the existing Onix precedent)", () => {
    const profile = LEVELING_CONTEXT.getProfile("growlithe")!;
    expect(profile.evolutions.length).toBe(0);
  });

  for (const id of NEW_SPECIES) {
    it(`${id} is tagged with real worldgen.ts biome names`, () => {
      const species = SPECIES[id]!;
      expect(species.biomes && species.biomes.length).toBeTruthy();
      for (const biome of species.biomes!) {
        expect(["grassland", "forest", "wetland", "badlands", "highland"]).toContain(biome);
      }
    });
  }

  it("badlands and highland each have at least one real resident now (the gap this feature closes)", () => {
    const roster = Object.values(SPECIES);
    const badlandsResidents = roster.filter((s) => s.biomes?.includes("badlands"));
    const highlandResidents = roster.filter((s) => s.biomes?.includes("highland"));
    expect(badlandsResidents.length).toBeGreaterThan(0);
    expect(highlandResidents.length).toBeGreaterThan(0);
  });
});

describe("charmander: now a real spawnable roster member", () => {
  it("spawns without crashing and is tagged for badlands placement", () => {
    expect(() => spawnAgent("charmander", "charmander-test", { x: 0, y: 0 }, 5, () => 0.5)).not.toThrow();
    expect(SPECIES.charmander!.biomes).toEqual(["badlands"]);
  });
});

describe("IMMIGRATION_CONTEXT wiring", () => {
  it("carries every roster species with its homeLayer, and can spawn each one via the shared spawnAgent", () => {
    expect(IMMIGRATION_CONTEXT.speciesRoster.length).toBe(Object.keys(SPECIES).length);
    for (const info of IMMIGRATION_CONTEXT.speciesRoster) {
      expect(() => IMMIGRATION_CONTEXT.spawnAgent(info.id, `${info.id}-immigration-test`, { x: 0, y: 0 }, 5, () => 0.5)).not.toThrow();
    }
  });

  it("new badlands/highland species carry biome tags through to the roster IMMIGRATION_CONTEXT hands to the engine", () => {
    const geodude = IMMIGRATION_CONTEXT.speciesRoster.find((s) => s.id === "geodude");
    expect(geodude?.biomes).toEqual(["badlands", "highland"]);
  });
});
