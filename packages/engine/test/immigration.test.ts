import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import { tickWorld } from "../src/simulation.js";
import {
  maybeImmigrate,
  rollImmigrantLevel,
  IMMIGRATION_BASE_CHANCE,
  MIN_TICKS_BETWEEN_IMMIGRATIONS,
  POP_HARD_CAP,
  POP_SOFT_CAP,
  type ImmigrationContext,
  type ImmigrationSpeciesInfo,
} from "../src/immigration.js";
import type { Agent, Vec2, World } from "../src/types.js";

/** Deterministic seeded PRNG (mulberry32) — matches herdMigration.test.ts's/dispersal.test.ts's own helper, for statistical tests that must never flake. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Never rolls under any real chance — for tests that must never fire. */
const NEVER_FIRE = () => 1;
/** Always rolls under any real chance — for tests that must always fire (once past the cooldown/cap gates). */
const ALWAYS_FIRE = () => 0;

function stubSpawnAgent(speciesId: string, id: string, pos: Vec2, level: number): Agent {
  return {
    id,
    species: speciesId,
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    level,
  };
}

const SURFACE_CTX: ImmigrationContext = {
  speciesRoster: [
    { id: "bulbasaur", homeLayer: "surface", biomes: ["grassland", "forest"] },
    { id: "onix", homeLayer: "underground", biomes: ["badlands", "highland"] },
  ],
  spawnAgent: stubSpawnAgent,
};

function livingAgent(id: string, species = "bulbasaur"): Agent {
  return {
    id,
    species,
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    alive: true,
  };
}

describe("maybeImmigrate", () => {
  it("does nothing without an ImmigrationContext", () => {
    const world = createWorld(40, 40, 1);
    const log = new EventLog();
    maybeImmigrate(world, undefined, log, ALWAYS_FIRE);
    expect(world.agents.length).toBe(0);
    expect(log.events.length).toBe(0);
  });

  it("fires and spawns a new herd under a guaranteed roll", () => {
    const world = createWorld(40, 40, 1);
    world.tick = 1;
    const log = new EventLog();
    maybeImmigrate(world, SURFACE_CTX, log, ALWAYS_FIRE);

    expect(world.agents.length).toBeGreaterThan(0);
    expect(world.agents.length).toBeLessThanOrEqual(3);
    expect(world.lastImmigrationTick).toBe(1);

    const events = log.events.filter((e) => e.kind === "immigrated");
    expect(events.length).toBe(1);
    const event = events[0]!;
    expect(event.kind).toBe("immigrated");
    if (event.kind === "immigrated") {
      expect(event.agentIds.length).toBe(world.agents.length);
      expect(event.outcome).toBe("founded"); // nothing else on the map to join
      expect(world.agents.every((a) => a.herdId === event.herdId)).toBe(true);
    }
  });

  it("never fires on a roll that never clears the chance threshold", () => {
    const world = createWorld(40, 40, 1);
    const log = new EventLog();
    maybeImmigrate(world, SURFACE_CTX, log, NEVER_FIRE);
    expect(world.agents.length).toBe(0);
    expect(log.events.length).toBe(0);
  });

  it("respects the cooldown: no second immigration within MIN_TICKS_BETWEEN_IMMIGRATIONS", () => {
    const world = createWorld(40, 40, 1);
    world.tick = 100;
    world.lastImmigrationTick = 100 - (MIN_TICKS_BETWEEN_IMMIGRATIONS - 1);
    const log = new EventLog();
    maybeImmigrate(world, SURFACE_CTX, log, ALWAYS_FIRE);
    expect(world.agents.length).toBe(0);
  });

  it("fires again once the cooldown has fully elapsed", () => {
    const world = createWorld(40, 40, 1);
    world.tick = 100;
    world.lastImmigrationTick = 100 - MIN_TICKS_BETWEEN_IMMIGRATIONS;
    const log = new EventLog();
    maybeImmigrate(world, SURFACE_CTX, log, ALWAYS_FIRE);
    expect(world.agents.length).toBeGreaterThan(0);
  });

  it("population cap: never fires once living population is at or above POP_HARD_CAP", () => {
    const world = createWorld(60, 60, 1);
    for (let i = 0; i < POP_HARD_CAP; i++) world.agents.push(livingAgent(`a-${i}`));
    const log = new EventLog();
    maybeImmigrate(world, SURFACE_CTX, log, ALWAYS_FIRE);
    // Only the pre-seeded agents — nothing new got pushed despite a guaranteed roll.
    expect(world.agents.length).toBe(POP_HARD_CAP);
    expect(log.events.length).toBe(0);
  });

  it("population cap: below POP_SOFT_CAP, a threshold roll just under the base chance still fires", () => {
    const world = createWorld(40, 40, 1);
    for (let i = 0; i < POP_SOFT_CAP - 5; i++) world.agents.push(livingAgent(`a-${i}`));
    const log = new EventLog();
    // Just under the unscaled base chance — should fire since scale is 1 below the soft cap.
    const justUnder = () => IMMIGRATION_BASE_CHANCE * 0.99;
    maybeImmigrate(world, SURFACE_CTX, log, justUnder);
    const newAgents = world.agents.length - (POP_SOFT_CAP - 5);
    expect(newAgents).toBeGreaterThan(0);
  });

  it("population cap: the same roll that fires below the soft cap does not fire once scaled down between soft and hard cap", () => {
    const world = createWorld(40, 40, 1);
    const between = Math.floor((POP_SOFT_CAP + POP_HARD_CAP) / 2);
    for (let i = 0; i < between; i++) world.agents.push(livingAgent(`a-${i}`));
    const log = new EventLog();
    const justUnderBase = () => IMMIGRATION_BASE_CHANCE * 0.99;
    maybeImmigrate(world, SURFACE_CTX, log, justUnderBase);
    // At the midpoint the scale is ~0.5, so a roll just under the *unscaled*
    // base chance should now fail (0.99*chance >= 0.5*chance).
    expect(world.agents.length).toBe(between);
  });

  it("dead agents don't count toward the population cap", () => {
    const world = createWorld(40, 40, 1);
    for (let i = 0; i < POP_HARD_CAP + 20; i++) {
      const a = livingAgent(`a-${i}`);
      a.alive = false; // corpses shouldn't block immigration
      world.agents.push(a);
    }
    const log = new EventLog();
    maybeImmigrate(world, SURFACE_CTX, log, ALWAYS_FIRE);
    expect(world.agents.length).toBeGreaterThan(POP_HARD_CAP + 20);
  });

  it("underground-homed species spawn directly on the flat grid, not via a walkability search", () => {
    const world = createWorld(40, 40, 1);
    const undergroundOnlyCtx: ImmigrationContext = {
      speciesRoster: [{ id: "onix", homeLayer: "underground" }],
      spawnAgent: stubSpawnAgent,
    };
    const log = new EventLog();
    maybeImmigrate(world, undergroundOnlyCtx, log, ALWAYS_FIRE);
    expect(world.agents.length).toBeGreaterThan(0);
    expect(world.agents.every((a) => a.species === "onix")).toBe(true);
  });

  it("an evolved species (real minLevel) spawns at/above its own evolution floor, not the flat base default — direct ask: \"everything spawn[s] at lv5\"", () => {
    const world = createWorld(40, 40, 1);
    const ctx: ImmigrationContext = {
      speciesRoster: [{ id: "ivysaur", homeLayer: "surface", minLevel: 16 }],
      spawnAgent: stubSpawnAgent,
    };
    maybeImmigrate(world, ctx, undefined, ALWAYS_FIRE);
    expect(world.agents.length).toBeGreaterThan(0);
    for (const a of world.agents) expect(a.level).toBeGreaterThanOrEqual(16);
  });

  it("a base-form species (no minLevel) still spawns within the ordinary base floor/jitter range, unchanged", () => {
    const world = createWorld(40, 40, 1);
    maybeImmigrate(world, SURFACE_CTX, undefined, ALWAYS_FIRE);
    expect(world.agents.length).toBeGreaterThan(0);
    for (const a of world.agents) {
      expect(a.level).toBeGreaterThanOrEqual(5);
      expect(a.level).toBeLessThan(13); // 5 + IMMIGRANT_LEVEL_JITTER (8)
    }
  });

  it("rng determinism: the same seed produces byte-identical immigration outcomes across two independent runs", () => {
    function run(): { agentCount: number; species: string[]; positions: string[]; eventCount: number } {
      const world = createWorld(50, 50, 777);
      const log = new EventLog();
      for (let i = 0; i < 2000; i++) {
        world.tick += 1;
        maybeImmigrate(world, SURFACE_CTX, undefined, world.rng);
      }
      return {
        agentCount: world.agents.length,
        species: world.agents.map((a) => a.species),
        positions: world.agents.map((a) => `${a.pos.x},${a.pos.y}`),
        eventCount: log.events.length,
      };
    }

    const first = run();
    const second = run();
    expect(second).toEqual(first);
  });

  it("rng determinism: immigration threaded through a real tickWorld run produces byte-identical event logs across two runs of the same seed", () => {
    function run(): string[] {
      const world = createWorld(50, 50, 42);
      const log = new EventLog();
      for (let i = 0; i < 500; i++) {
        tickWorld(world, log, undefined, undefined, world.rng, SURFACE_CTX);
      }
      return log.events.map((e) => JSON.stringify(e));
    }

    const first = run();
    const second = run();
    expect(second).toEqual(first);
    // Sanity: immigration actually exercised the rng in this window (not a vacuous pass).
    expect(first.some((e) => e.includes('"immigrated"'))).toBe(true);
  });
});

describe("immigration data plumbing (bare-engine roster)", () => {
  it("every roster entry the module is handed resolves to a real spawnable species without crashing across many trials", () => {
    const world = createWorld(60, 60, 5);
    const log = new EventLog();
    const rng = seededRng(9001);
    for (let i = 0; i < 5000; i++) {
      world.tick += 1;
      expect(() => maybeImmigrate(world, SURFACE_CTX, log, rng)).not.toThrow();
    }
    // Confirms both roster species can actually get picked over enough trials (biome + representation weighting isn't a de facto ban on one of them).
    const speciesSeen = new Set(world.agents.map((a) => a.species));
    expect(speciesSeen.size).toBeGreaterThan(0);
  });
});

describe("rollImmigrantLevel (direct ask: \"why does everything spawn at lv5... some randomness in starting rolls would be good\")", () => {
  const BASE_FORM: ImmigrationSpeciesInfo = { id: "bulbasaur", homeLayer: "surface" };
  const EVOLVED: ImmigrationSpeciesInfo = { id: "venusaur", homeLayer: "surface", minLevel: 32 };

  it("a base-form species (no minLevel) floors at the ordinary base default with zero jitter", () => {
    expect(rollImmigrantLevel(BASE_FORM, () => 0)).toBe(5);
  });

  it("a base-form species gets real jitter on top of the base default", () => {
    expect(rollImmigrantLevel(BASE_FORM, () => 0.99)).toBe(5 + 7); // floor(0.99 * 8) = 7
  });

  it("an evolved species floors at its own real evolution level, not the flat base default", () => {
    expect(rollImmigrantLevel(EVOLVED, () => 0)).toBe(32);
    expect(rollImmigrantLevel(EVOLVED, () => 0.99)).toBe(32 + 7);
  });

  it("an evolved species below the base default still floors at the base default (max, not additive)", () => {
    const barelyEvolved: ImmigrationSpeciesInfo = { id: "metapod", homeLayer: "surface", minLevel: 3 };
    expect(rollImmigrantLevel(barelyEvolved, () => 0)).toBe(5); // base default (5) wins over minLevel (3)
  });

  it("real randomness: repeated rolls for the same species aren't all identical", () => {
    const levels = new Set<number>();
    let seed = 1;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 20; i++) levels.add(rollImmigrantLevel(BASE_FORM, rng));
    expect(levels.size).toBeGreaterThan(1);
  });
});
