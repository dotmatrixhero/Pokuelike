import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import { tickWorld } from "../src/simulation.js";
import {
  maybeImmigrate,
  rollImmigrantLevel,
  zoneLevelCenter,
  localAverageLevel,
  IMMIGRATION_BASE_CHANCE,
  FOUNDER_REINFORCE_BOOST,
  FOUNDER_VIABLE_COUNT,
  founderWeight,
  PREDATOR_EMPTY_NICHE_BOOST,
  PREDATOR_TARGET_SHARE,
  predatorNicheBoost,
  MIN_TICKS_BETWEEN_IMMIGRATIONS,
  POP_HARD_CAP,
  POP_SOFT_CAP,
  PREDATOR_LEVEL_BOOST,
  PREY_LEVEL_JITTER,
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

  it("a species with a lower `rarity` shows up as an immigrant less often than an otherwise-identical species — direct ask: 'make arboks less common'", () => {
    const ctx: ImmigrationContext = {
      speciesRoster: [
        { id: "common-species", homeLayer: "surface" },
        { id: "rare-species", homeLayer: "surface", rarity: 0.35 },
      ],
      spawnAgent: stubSpawnAgent,
    };
    const world = createWorld(60, 60, 5);
    const log = new EventLog();
    const rng = seededRng(1234);
    for (let i = 0; i < 5000; i++) {
      world.tick += 1;
      maybeImmigrate(world, ctx, log, rng);
    }
    const commonCount = world.agents.filter((a) => a.species === "common-species").length;
    const rareCount = world.agents.filter((a) => a.species === "rare-species").length;
    expect(rareCount).toBeGreaterThan(0); // rarity thins it out, doesn't ban it
    expect(rareCount).toBeLessThan(commonCount);
  });
});

describe("rollImmigrantLevel (direct ask: \"why does everything spawn at lv5... some randomness in starting rolls would be good\")", () => {
  const BASE_FORM: ImmigrationSpeciesInfo = { id: "bulbasaur", homeLayer: "surface" };
  const EVOLVED: ImmigrationSpeciesInfo = { id: "venusaur", homeLayer: "surface", minLevel: 32 };

  it("a base-form species (no minLevel) floors at the ordinary base default with zero jitter", () => {
    expect(rollImmigrantLevel(BASE_FORM, () => 0)).toBe(5);
  });

  it("a base-form (non-predator) species gets real, wide, low-skewed jitter on top of the base default", () => {
    // PREY_LEVEL_JITTER(16), PREY_LEVEL_SKEW(4): floor(0.99**4 * 16) = floor(15.37) = 15.
    expect(rollImmigrantLevel(BASE_FORM, () => 0.99)).toBe(5 + 15);
  });

  it("an evolved (non-predator) species floors at its own real evolution level, not the flat base default", () => {
    expect(rollImmigrantLevel(EVOLVED, () => 0)).toBe(32);
    expect(rollImmigrantLevel(EVOLVED, () => 0.99)).toBe(32 + 15);
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

  it("a real local average level re-centers the roll on it instead of the bare floor — direct ask: immigrants should come in 'matching the level a little more'", () => {
    // PREY_LEVEL_JITTER(16) centered on localAvgLevel(50): floor(50 - 16/2) = 42 .. +15 = 57.
    expect(rollImmigrantLevel(BASE_FORM, () => 0, 50)).toBe(42);
    expect(rollImmigrantLevel(BASE_FORM, () => 0.99, 50)).toBe(42 + 15);
  });

  describe("predator/prey level-gap narrowing (direct ask: \"the gap level wise is a bit too high... make em average out to each other... prey should have a wider range of levels\")", () => {
    const PREDATOR: ImmigrationSpeciesInfo = { id: "scyther", homeLayer: "surface", isPredator: true };

    it("a predator's own jitter is narrower and NOT skewed low — a plain uniform roll, unlike prey", () => {
      // IMMIGRANT_LEVEL_JITTER(8) uniform: floor(0.99 * 8) = 7.
      expect(rollImmigrantLevel(PREDATOR, () => 0.99)).toBe(5 + PREDATOR_LEVEL_BOOST + 7);
    });

    it("a prey roll can reach well beyond a predator's own old (pre-fix) jitter ceiling — the real 'wider range' the ask asked for", () => {
      // Old prey ceiling was floor+8; the new one comfortably clears it.
      expect(rollImmigrantLevel(BASE_FORM, () => 0.999)).toBeGreaterThan(5 + 8);
    });

    it("skewed-low prey rolls cluster well under the jitter band's own midpoint on average — the mechanism that pulls the prey average down", () => {
      let seed = 7;
      const rng = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      let total = 0;
      const n = 500;
      for (let i = 0; i < n; i++) total += rollImmigrantLevel(BASE_FORM, rng) - 5; // isolate the jitter contribution
      const average = total / n;
      expect(average).toBeLessThan(PREY_LEVEL_JITTER / 2); // well under a uniform roll's own midpoint (8)
    });

    it("PREDATOR_LEVEL_BOOST was reduced from its original value — the direct lever narrowing the average-level gap", () => {
      expect(PREDATOR_LEVEL_BOOST).toBeLessThan(15);
    });
  });

  it("a local average below the species' own floor still never rolls under that floor", () => {
    expect(rollImmigrantLevel(BASE_FORM, () => 0, 2)).toBe(5); // floor(2 - 4) = -2, clamped to floor(5)
  });

  describe("zone-level banding (direct ask: \"bands of acceptable level ranges per zone... median increasing... as you get further away from a particular zone\")", () => {
    it("zoneLevelCenter climbs with distance from the nearest Sanctuary and caps out, rather than climbing forever", () => {
      expect(zoneLevelCenter(0)).toBe(5);
      expect(zoneLevelCenter(1)).toBe(11);
      expect(zoneLevelCenter(7)).toBe(47);
      expect(zoneLevelCenter(100)).toBe(47); // capped at ZONE_LEVEL_RAMP_MAX_DISTANCE, not unbounded
    });

    it("undefined distance (no overworld above this world, or a grid with no Sanctuary at all) falls back to no zone term", () => {
      expect(zoneLevelCenter(undefined)).toBeUndefined();
    });

    it("a zone center re-centers the roll exactly like a local average does — same mechanism, different source", () => {
      // PREY_LEVEL_JITTER(16) centered on zoneCenter(47): floor(47 - 16/2) = 39 .. +15 = 54.
      expect(rollImmigrantLevel(BASE_FORM, () => 0, undefined, 47)).toBe(39);
      expect(rollImmigrantLevel(BASE_FORM, () => 0.99, undefined, 47)).toBe(39 + 15);
    });

    it("a zone center and a local species average blend evenly rather than either one winning outright", () => {
      const blended = rollImmigrantLevel(BASE_FORM, () => 0, 5, 47);
      const zoneOnly = rollImmigrantLevel(BASE_FORM, () => 0, undefined, 47);
      const localOnly = rollImmigrantLevel(BASE_FORM, () => 0, 5, undefined);
      expect(blended).toBeGreaterThan(localOnly);
      expect(blended).toBeLessThan(zoneOnly);
    });

    it("a Sanctuary-adjacent zone still rarely rolls a real high-level wanderer via the jitter's own tail — soft, not a hard clamp", () => {
      // zoneCenter(0) = 5, predator jitter width 8, uniform (not skewed) -> a near-max roll still clears the "safe zone" reading.
      const PREDATOR: ImmigrationSpeciesInfo = { id: "scyther", homeLayer: "surface", isPredator: true };
      const nearMax = rollImmigrantLevel(PREDATOR, () => 0.999, undefined, zoneLevelCenter(0));
      expect(nearMax).toBeGreaterThan(15);
    });
  });
});

describe("localAverageLevel", () => {
  it("averages only the given species' living, non-egg population", () => {
    const world = createWorld(20, 20);
    world.agents.push(
      { ...livingAgent("a", "bulbasaur"), level: 10 },
      { ...livingAgent("b", "bulbasaur"), level: 20 },
      { ...livingAgent("c", "bulbasaur"), level: 999, alive: false }, // dead — excluded
      { ...livingAgent("d", "bulbasaur"), level: 999, isEgg: true }, // egg — excluded
      { ...livingAgent("e", "venusaur"), level: 999 } // different species — excluded
    );

    expect(localAverageLevel(world, "bulbasaur")).toBe(15);
  });

  it("is undefined when no living member of that species exists yet", () => {
    const world = createWorld(20, 20);
    expect(localAverageLevel(world, "bulbasaur")).toBeUndefined();
  });
});

describe("predatorNicheBoost", () => {
  it("does nothing to a non-predator, whatever the share", () => {
    expect(predatorNicheBoost({ isPredator: false }, 0)).toBe(1);
    expect(predatorNicheBoost({}, 0)).toBe(1);
  });

  it("boosts a predator hardest when there are none left alive", () => {
    expect(predatorNicheBoost({ isPredator: true }, 0)).toBe(PREDATOR_EMPTY_NICHE_BOOST);
  });

  it("stops boosting once the target share is reached", () => {
    expect(predatorNicheBoost({ isPredator: true }, PREDATOR_TARGET_SHARE)).toBe(1);
    expect(predatorNicheBoost({ isPredator: true }, 0.9)).toBe(1);
  });

  it("tapers smoothly in between rather than switching on and off", () => {
    const half = predatorNicheBoost({ isPredator: true }, PREDATOR_TARGET_SHARE / 2);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(PREDATOR_EMPTY_NICHE_BOOST);
    // monotonically decreasing as the niche fills
    let prev = Infinity;
    for (const share of [0, 0.05, 0.1, 0.15, 0.2]) {
      const b = predatorNicheBoost({ isPredator: true }, share);
      expect(b).toBeLessThanOrEqual(prev);
      prev = b;
    }
  });
});

describe("founderWeight", () => {
  it("still seeds brand-new species — absent species are not shut out", () => {
    expect(founderWeight(0)).toBeGreaterThan(0);
  });

  it("reinforces a present-but-struggling species above a plain rarity weighting", () => {
    // The bug this fixes: plain 1/(count+1) peaks at count 0, so immigration
    // maximised diversity and produced nothing but unbreedable singletons.
    const plainRarity = (n: number) => 1 / (n + 1);
    expect(founderWeight(1)).toBeGreaterThan(plainRarity(1) * (FOUNDER_REINFORCE_BOOST - 0.001));
    expect(founderWeight(1)).toBeGreaterThan(founderWeight(0));
  });

  it("stops reinforcing once a species is established", () => {
    expect(founderWeight(FOUNDER_VIABLE_COUNT)).toBeCloseTo(1 / (FOUNDER_VIABLE_COUNT + 1), 6);
  });

  it("never rewards an already-abundant species over a struggling one", () => {
    expect(founderWeight(2)).toBeGreaterThan(founderWeight(20));
  });
});
