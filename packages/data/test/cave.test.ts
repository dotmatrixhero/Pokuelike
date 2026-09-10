import { describe, expect, it } from "vitest";
import { tileAt, tileIndex } from "@pokuelike/engine";
import { CAVE_SPAWN_MAX_STEPS, CAVE_SPAWN_MIN_STEPS, createCaveScenario, walkDistances } from "../src/scenario.js";

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

      const herd = world.agents.filter((a) => a.herdId === "sandshrew-herd");
      expect(herd).toHaveLength(4);
      for (const s of herd) expect(s.layer).toBe("underground");

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
      expect(nearest).toBeGreaterThanOrEqual(CAVE_SPAWN_MIN_STEPS - 6); // chamber radius + a little
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

  it("is deterministic per seed", () => {
    const a = createCaveScenario(3003);
    const b = createCaveScenario(3003);
    const pa = a.agents.find((x) => x.controlledBy === "player")!;
    const pb = b.agents.find((x) => x.controlledBy === "player")!;
    expect(pa.pos).toEqual(pb.pos);
  });
});
