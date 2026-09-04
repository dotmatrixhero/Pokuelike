import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { generateWorld } from "../src/worldgen.js";
import { mulberry32 } from "../src/rng.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import { migrate, findRandomWalkableTile } from "../src/migration.js";
import { growFlora, maybeDropSeed } from "../src/flora.js";
import { grantExp } from "../src/leveling.js";
import { applyMateSeeking } from "../src/reproduction.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

/**
 * The determinism sweep — see DESIGN.md's determinism section. Each `it`
 * below targets one of the raw `Math.random()` call sites converted to the
 * shared seeded generator (`World.rng`, `rng.ts`'s `mulberry32`): same seed
 * (same rng instance, or two independently constructed instances from the
 * same numeric seed) must produce the exact same sequence of outcomes, and
 * a different seed must (with overwhelming probability, checked as a real
 * assertion, not just eyeballed) produce a different one — a sanity check
 * that nothing here is secretly hardcoded or still reading `Math.random`
 * under the hood.
 */

const TEST_MOVE: MoveSpec = {
  id: "test-move",
  name: "Test Move",
  shape: { kind: "point" },
  type: "normal",
  category: "physical",
  power: 40,
  accuracy: 100,
  cooldownTicks: 0,
};

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "test",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...overrides,
  };
}

describe("World.rng wiring", () => {
  it("createWorld with an explicit seed gives a reproducible generator: same seed -> same draw sequence", () => {
    const a = createWorld(10, 10, 42);
    const b = createWorld(10, 10, 42);
    expect(a.rngSeed).toBe(42);
    const drawsA = Array.from({ length: 10 }, () => a.rng());
    const drawsB = Array.from({ length: 10 }, () => b.rng());
    expect(drawsA).toEqual(drawsB);
  });

  it("different seeds give different draw sequences", () => {
    const a = createWorld(10, 10, 1);
    const b = createWorld(10, 10, 2);
    const drawsA = Array.from({ length: 10 }, () => a.rng());
    const drawsB = Array.from({ length: 10 }, () => b.rng());
    expect(drawsA).not.toEqual(drawsB);
  });

  it("createWorld with no seed still mints one and records it on rngSeed", () => {
    const world = createWorld(5, 5);
    expect(typeof world.rngSeed).toBe("number");
    expect(typeof world.rng).toBe("function");
  });

  it("generateWorld's behavior rng (world.rng) is deterministic from the same seed, independent of terrain generation", () => {
    const a = generateWorld(20, 20, 777);
    const b = generateWorld(20, 20, 777);
    expect(a.rngSeed).toBe(b.rngSeed);
    const drawsA = Array.from({ length: 5 }, () => a.rng());
    const drawsB = Array.from({ length: 5 }, () => b.rng());
    expect(drawsA).toEqual(drawsB);
  });
});

describe("tickWorld: full-run determinism (the real acceptance test at unit scale)", () => {
  function scenario(seed: number): { world: ReturnType<typeof createWorld>; log: EventLog } {
    const world = createWorld(30, 20, seed);
    setTile(world, "surface", 10, 10, "water");
    setTile(world, "surface", 15, 10, "food");
    world.agents.push(
      agent("bulbasaur-0", { species: "bulbasaur", pos: { x: 8, y: 8 }, herdId: "herd", sex: "male", moves: [TEST_MOVE], maxHp: 20, hp: 20, needs: createNeeds({ mateDrive: 0.9 }) }),
      agent("bulbasaur-1", { species: "bulbasaur", pos: { x: 9, y: 8 }, herdId: "herd", sex: "female", moves: [TEST_MOVE], maxHp: 20, hp: 20, needs: createNeeds({ mateDrive: 0.9 }) }),
      agent("scyther-0", { species: "scyther", pos: { x: 12, y: 12 }, moves: [TEST_MOVE], maxHp: 40, hp: 40, needs: createNeeds({ hunger: 0.2 }) })
    );
    const log = new EventLog();
    const rules: HuntRules = { scyther: true };
    for (let i = 0; i < 500; i++) tickWorld(world, log, rules);
    return { world, log };
  }

  it("the same seed run twice produces byte-identical event logs", () => {
    const runA = scenario(20260904);
    const runB = scenario(20260904);
    expect(runA.log.events.length).toBeGreaterThan(0); // not a vacuous pass — real events did happen
    expect(JSON.stringify(runA.log.events)).toBe(JSON.stringify(runB.log.events));
  });

  it("different seeds produce different event logs (sanity check against accidental hardcoding)", () => {
    const runA = scenario(1);
    const runB = scenario(2);
    expect(JSON.stringify(runA.log.events)).not.toBe(JSON.stringify(runB.log.events));
  });
});

describe("flora.ts determinism", () => {
  it("growFlora: same rng seed -> identical tile outcomes", () => {
    function run(seed: number) {
      const world = createWorld(6, 6, seed);
      for (let x = 0; x < 6; x++) setTile(world, "surface", x, 0, "seedling");
      const log = new EventLog();
      for (let i = 0; i < 25; i++) growFlora(world, log, world.rng);
      return world.tiles.surface.map((t) => `${t.terrain}:${t.flavor ?? ""}`);
    }
    expect(run(5)).toEqual(run(5));
  });

  it("growFlora: different seeds produce a different flavor/food-vs-flora outcome somewhere", () => {
    function run(seed: number) {
      const world = createWorld(10, 10, seed);
      for (let x = 0; x < 10; x++) for (let y = 0; y < 3; y++) setTile(world, "surface", x, y, "seedling");
      for (let i = 0; i < 25; i++) growFlora(world, undefined, world.rng);
      return world.tiles.surface.map((t) => `${t.terrain}:${t.flavor ?? ""}`).join(",");
    }
    expect(run(1)).not.toBe(run(2));
  });

  it("maybeDropSeed: same seed -> same seeded/not-seeded outcome sequence", () => {
    function run(seed: number) {
      const rng = mulberry32(seed);
      const world = createWorld(5, 5, seed);
      const results: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        maybeDropSeed(world, "surface", { x: 2, y: 2 }, undefined, rng);
        results.push(world.tiles.surface[2 * 5 + 2]!.terrain === "seedling");
        world.tiles.surface[2 * 5 + 2]!.terrain = "floor"; // reset for the next roll
      }
      return results;
    }
    expect(run(9)).toEqual(run(9));
  });
});

describe("migration.ts determinism", () => {
  it("findRandomWalkableTile: same seed -> same candidate tile", () => {
    const world = createWorld(50, 50, 1);
    const a = findRandomWalkableTile(world, "surface", { x: 25, y: 25 }, mulberry32(3));
    const b = findRandomWalkableTile(world, "surface", { x: 25, y: 25 }, mulberry32(3));
    expect(a).toEqual(b);
  });

  it("findRandomWalkableTile: different seeds usually pick a different tile", () => {
    const world = createWorld(50, 50, 1);
    const a = findRandomWalkableTile(world, "surface", { x: 25, y: 25 }, mulberry32(3));
    const b = findRandomWalkableTile(world, "surface", { x: 25, y: 25 }, mulberry32(4));
    expect(a).not.toEqual(b);
  });

  it("migrate: same seed picks the same relocate target", () => {
    const worldA = createWorld(50, 50, 1);
    const worldB = createWorld(50, 50, 1);
    const a1 = agent("a", { pos: { x: 25, y: 25 } });
    const a2 = agent("a", { pos: { x: 25, y: 25 } });
    migrate(worldA, a1, undefined, mulberry32(11));
    migrate(worldB, a2, undefined, mulberry32(11));
    expect(a1.relocateTarget).toEqual(a2.relocateTarget);
  });
});

describe("leveling.ts determinism", () => {
  it("grantExp's wildcard skill-point roll: same seed -> same grant sequence", () => {
    // A growth-rate/level table trivial enough to level up every single grantExp call.
    const ctx = {
      getProfile: () => ({
        growthRate: "FAST" as const,
        baseStats: { hp: 10, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 10 },
        types: [],
        baseExp: 10,
        levelMoves: [],
        evolutions: [],
      }),
      resolveMove: () => undefined,
    };
    function run(seed: number) {
      const world = createWorld(5, 5, seed);
      const a = agent("a", { level: 1, exp: 0 });
      const rng = mulberry32(seed);
      for (let i = 0; i < 30; i++) grantExp(world, a, 50, ctx, undefined, rng);
      return a.wildcardSkillPoints ?? 0;
    }
    expect(run(123)).toBe(run(123));
  });
});

describe("reproduction.ts determinism", () => {
  it("applyMateSeeking: same seed -> identical newborn (nature, sex, spawn tile)", () => {
    function run(seed: number) {
      const world = createWorld(10, 10, seed);
      const mother = agent("mother", { species: "bulbasaur", sex: "female", pos: { x: 5, y: 5 }, herdId: "h" });
      const father = agent("father", { species: "bulbasaur", sex: "male", pos: { x: 5, y: 6 }, herdId: "h" });
      world.agents.push(mother, father);
      applyMateSeeking(world, mother, undefined, undefined, world.rng);
      const child = world.agents[2];
      return child ? { nature: child.nature, sex: child.sex, pos: child.pos } : undefined;
    }
    expect(run(555)).toEqual(run(555));
  });

  it("applyMateSeeking: different seeds can produce a different newborn nature/sex/position", () => {
    function run(seed: number) {
      const world = createWorld(10, 10, seed);
      const mother = agent("mother", { species: "bulbasaur", sex: "female", pos: { x: 5, y: 5 }, herdId: "h" });
      const father = agent("father", { species: "bulbasaur", sex: "male", pos: { x: 5, y: 6 }, herdId: "h" });
      world.agents.push(mother, father);
      applyMateSeeking(world, mother, undefined, undefined, world.rng);
      const child = world.agents[2];
      return child ? JSON.stringify({ nature: child.nature, sex: child.sex, pos: child.pos }) : undefined;
    }
    // Try a handful of seed pairs — natures/sex/spawn tile are drawn from a
    // small discrete set, so any single pair has a real (if small) chance of
    // coincidentally matching; requiring at least one differing pair out of
    // several keeps this a real, non-flaky sanity check.
    const outcomes = new Set([1, 2, 3, 4, 5].map(run));
    expect(outcomes.size).toBeGreaterThan(1);
  });
});
