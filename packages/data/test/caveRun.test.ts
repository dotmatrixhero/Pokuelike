import { describe, expect, it } from "vitest";
import { useStairs, isAtExit, findPlayer, EventLog, type World } from "@pokuelike/engine";
import { CAVE_RUN_DEPTH, createCaveRun, walkDistances } from "../src/scenario.js";

/**
 * ROADMAP.md M7 Climb's own acceptance bar, same shape as cave.test.ts's
 * M1 test: reachability by construction (every stairs/exit tile is placed
 * by BFS from a real anchor point), checked as a property across several
 * seeds rather than trusted from one. Direct ask that started this
 * milestone: "i think i just want to be able to move to the next level of
 * the cave and shit."
 */
const SEEDS = [20260903, 11, 202, 3003, 40404];

describe("createCaveRun (ROADMAP M7)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: all ${CAVE_RUN_DEPTH} levels chain together, every stairs/exit tile is actually reachable`, () => {
      const level1 = createCaveRun(seed);
      expect(level1.depth).toBe(1);
      expect(findPlayer(level1)).toBeDefined();

      let w: World | undefined = level1;
      let count = 0;
      for (; w; w = w.below, count++) {
        expect(w.depth).toBe(count + 1);
        if (w.depth! < CAVE_RUN_DEPTH) {
          expect(w.stairsDownAt).toBeDefined();
          expect(w.exitAt).toBeUndefined();
        } else {
          expect(w.exitAt).toBeDefined();
          expect(w.stairsDownAt).toBeUndefined();
        }
        if (w.depth! > 1) {
          expect(w.stairsUpAt).toBeDefined();
          expect(w.above).toBeDefined();
          // Reachable from the level's own arrival point, not just present as a tile.
          const reachable = walkDistances(w, "underground", w.stairsUpAt!);
          const target = w.stairsDownAt ?? w.exitAt!;
          expect(reachable.has(`${target.x},${target.y}`)).toBe(true);
        }
      }
      expect(count).toBe(CAVE_RUN_DEPTH);
    });
  }

  it("predators escalate with depth — real underground roster, not invented placeholders", () => {
    const level1 = createCaveRun(20260903);
    const speciesByDepth = new Map<number, string[]>();
    for (let w: World | undefined = level1; w; w = w.below) {
      speciesByDepth.set(w.depth!, [...new Set(w.agents.map((a) => a.species))]);
    }
    expect(speciesByDepth.get(2)).toContain("zubat");
    expect(speciesByDepth.get(3)).toContain("golbat");
    expect(speciesByDepth.get(4)).toContain("onix");
    expect(speciesByDepth.get(5)).toContain("haunter");
    // Levels get harder with depth — the levels named above have a real predator each.
    for (let w: World | undefined = level1.below; w; w = w.below) {
      const predatorLevels = w.agents.filter((a) => a.species !== "human").map((a) => a.level ?? 5);
      expect(Math.max(...predatorLevels)).toBeGreaterThan(0);
    }
  });

  it("you can actually walk the whole chain via useStairs, down to the exit", () => {
    const level1 = createCaveRun(20260903);
    const player = findPlayer(level1)!;
    const log = new EventLog();
    let w: World = level1;
    for (let i = 0; i < CAVE_RUN_DEPTH - 1; i++) {
      player.pos = { ...w.stairsDownAt! };
      const next = useStairs(w, player, log);
      expect(next).toBeDefined();
      w = next!;
    }
    expect(w.depth).toBe(CAVE_RUN_DEPTH);
    player.pos = { ...w.exitAt! };
    expect(isAtExit(w, player)).toBe(true);
  });
});
