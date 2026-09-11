import { describe, expect, it } from "vitest";
import { tileAt, tileIndex } from "@pokuelike/engine";
import { CAVE_SPAWN_MAX_STEPS, CAVE_SPAWN_MIN_STEPS, CAVE_STARTER_SPECIES, createCaveScenario, walkDistances } from "../src/scenario.js";
import { SPECIES } from "../src/species.js";

/**
 * ROADMAP.md M1's acceptance test — "you spawn in the dark and walk to the
 * light" — as a property of the constructor, on several seeds, since a
 * single seed in this sim is noise. Reachability is by construction (the
 * spawn is chosen by BFS from the chamber), and this is what keeps that true.
 */
const SEEDS = [20260903, 11, 202, 3003, 40404];

describe("createCaveScenario (ROADMAP M1)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: player and herd are underground, the chamber is lit, and the light is a real walk away`, () => {
      const world = createCaveScenario(seed);
      const player = world.agents.find((a) => a.controlledBy === "player")!;
      expect(player).toBeDefined();
      expect(player.layer).toBe("underground");
      expect(player.homeLayer).toBe("underground");

      // Direct ask: "I want starting cave to be a random pack of prey" —
      // one species from CAVE_STARTER_SPECIES, not hardcoded to Sandshrew.
      const herd = world.agents.filter((a) => a.herdId?.endsWith("-herd"));
      expect(herd).toHaveLength(4);
      const species = herd[0]!.species;
      expect(CAVE_STARTER_SPECIES).toContain(species);
      for (const s of herd) {
        expect(s.species).toBe(species); // one herd, one species
        expect(s.herdId).toBe(`${species}-herd`);
        expect(s.layer).toBe("underground");
        expect(s.homeLayer).toBe("underground");
      }

      // Nobody on the surface — M1 is the cave.
      expect(world.agents.some((a) => a.layer === "surface")).toBe(false);

      // The lit chamber exists underground, where worldgen never puts sunbeams.
      const sunbeams: { x: number; y: number }[] = [];
      for (let y = 0; y < world.height; y++)
        for (let x = 0; x < world.width; x++) if (tileAt(world, "underground", x, y)?.terrain === "sunbeam") sunbeams.push({ x, y });
      expect(sunbeams.length).toBeGreaterThanOrEqual(8);

      // From the player's spawn, a sunbeam is reachable on foot, and not too
      // close: the first thing you do is walk into the dark toward it.
      const dist = walkDistances(world, "underground", player.pos);
      const reach = sunbeams.map((p) => dist.get(`${p.x},${p.y}`)).filter((d): d is number => d !== undefined);
      expect(reach.length).toBeGreaterThan(0);
      const nearest = Math.min(...reach);
      // Direct report: "I need more water around the cave... very open, hard
      // to see" — every water pocket now casts its own small lit halo
      // (worldgen.ts's `pickUndergroundWaterPockets`), not just the one this
      // scenario hand-authors around its chosen chamber pocket. `nearest`
      // is the closest sunbeam ANYWHERE, so an extra pocket's halo landing
      // a couple of tiles closer to spawn than the chamber alone would is a
      // real, expected consequence of that — the fudge factor below is
      // widened accordingly (was -6), not loosened to paper over a break.
      expect(nearest).toBeGreaterThanOrEqual(CAVE_SPAWN_MIN_STEPS - 9);
      expect(nearest).toBeLessThanOrEqual(CAVE_SPAWN_MAX_STEPS + 2);

      // And the player is standing in the dark, not on a lit tile.
      expect(tileAt(world, "underground", player.pos.x, player.pos.y)?.terrain).not.toBe("sunbeam");

      // ROADMAP M2: "you cannot see the chamber until you are in it." Vision
      // is computed at spawn, and no sunbeam is in it. (Measured on 8 seeds
      // by runner/validateCaveVision.ts: the first lit tile appears after
      // 6-23 keys of walking.)
      expect(player.vision).toBeDefined();
      expect(player.vision!.visible.size).toBeGreaterThan(0);
      expect(sunbeams.some((p) => player.vision!.visible.has(tileIndex(world, p.x, p.y)))).toBe(false);
    });
  }

  it("CAVE_STARTER_SPECIES is a real, non-predator, base-stage roster — every entry resolves and none is a hunter", () => {
    for (const id of CAVE_STARTER_SPECIES) {
      const def = SPECIES[id];
      expect(def, `${id} is not in SPECIES`).toBeDefined();
      expect(def!.isPredator, `${id} is flagged isPredator — should never be the first thing a player meets`).not.toBe(true);
    }
    // No duplicates in the pool.
    expect(new Set(CAVE_STARTER_SPECIES).size).toBe(CAVE_STARTER_SPECIES.length);
  });

  it("the pool actually varies — several distinct species turn up across seeds, not always Sandshrew", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const world = createCaveScenario(seed);
      const player = world.agents.find((a) => a.controlledBy === "player")!;
      const herdSpecies = world.agents.find((a) => a.herdId?.endsWith("-herd"))!.species;
      seen.add(herdSpecies);
      void player;
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it("is deterministic per seed", () => {
    const a = createCaveScenario(3003);
    const b = createCaveScenario(3003);
    const pa = a.agents.find((x) => x.controlledBy === "player")!;
    const pb = b.agents.find((x) => x.controlledBy === "player")!;
    expect(pa.pos).toEqual(pb.pos);
  });
});
