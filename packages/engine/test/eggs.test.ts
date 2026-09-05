import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { spawnEgg, tickEgg, EGG_INCUBATION_TICKS, isLivingEgg } from "../src/eggs.js";
import { applyEggEating, applyPredationInstincts } from "../src/predation.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { LevelingContext, LevelingProfile } from "../src/leveling.js";

const FAKE_PROFILES: Record<string, LevelingProfile> = {
  bulbasaur: {
    growthRate: "MEDIUM_SLOW",
    baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 },
    types: ["grass", "poison"],
    baseExp: 64,
    levelMoves: [[1, "TACKLE"]],
    evolutions: [],
    eggGroups: ["monster", "grass"],
  },
  charmander: {
    growthRate: "MEDIUM_SLOW",
    baseStats: { hp: 39, attack: 52, defense: 43, spAttack: 60, spDefense: 50, speed: 65 },
    types: ["fire"],
    baseExp: 62,
    levelMoves: [],
    evolutions: [],
    eggGroups: ["monster", "dragon"],
  },
  scyther: {
    growthRate: "MEDIUM_FAST",
    baseStats: { hp: 70, attack: 110, defense: 80, spAttack: 55, spDefense: 80, speed: 105 },
    types: ["bug", "flying"],
    baseExp: 100,
    levelMoves: [],
    evolutions: [],
    eggGroups: ["bug"],
  },
};

const FAKE_CTX: LevelingContext = {
  getProfile: (speciesId) => FAKE_PROFILES[speciesId],
  resolveMove: () => undefined,
  baseSpeciesOf: (speciesId) => speciesId,
};

const TEST_MOVE = {
  id: "test-move",
  name: "Test Move",
  shape: { kind: "point" as const },
  type: "normal" as const,
  category: "physical" as const,
  power: 40,
  accuracy: 100,
  cooldownTicks: 0,
};

function bulbasaurParent(id: string, pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    age: 500,
    level: 16,
    parentIds: undefined,
    ...overrides,
  };
}

function eggAgent(overrides: Partial<Agent> = {}): Agent {
  const world = createWorld(10, 10);
  const mother = bulbasaurParent("mother", { x: 5, y: 5 });
  const father = bulbasaurParent("father", { x: 5, y: 6 });
  return { ...spawnEgg(world, mother, father, { x: 5, y: 5 }, 1), ...overrides };
}

describe("eggs.ts: spawnEgg", () => {
  it("produces an unhatched egg with no nature/sex/level yet — those are a hatch-time decision", () => {
    const world = createWorld(10, 10);
    const mother = bulbasaurParent("mother", { x: 5, y: 5 });
    const father = bulbasaurParent("father", { x: 5, y: 6 });
    const egg = spawnEgg(world, mother, father, { x: 5, y: 5 }, 1);

    expect(egg.isEgg).toBe(true);
    expect(egg.eggTicks).toBe(0);
    expect(egg.species).toBe("bulbasaur");
    expect(egg.pos).toEqual({ x: 5, y: 5 });
    expect(egg.sex).toBeUndefined();
    expect(egg.nature).toBeUndefined();
    expect(egg.level).toBeUndefined();
    expect(isLivingEgg(egg)).toBe(true);
  });
});

describe("eggs.ts: tickEgg (incubation and hatching)", () => {
  it("does not hatch before EGG_INCUBATION_TICKS", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent();

    for (let i = 0; i < EGG_INCUBATION_TICKS - 1; i++) tickEgg(world, egg, undefined, FAKE_CTX, Math.random);

    expect(egg.isEgg).toBe(true);
    expect(isLivingEgg(egg)).toBe(true);
  });

  it("hatches into a real newborn with a full combat profile once incubation completes", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent();

    for (let i = 0; i <= EGG_INCUBATION_TICKS; i++) tickEgg(world, egg, undefined, FAKE_CTX, Math.random);

    expect(egg.isEgg).toBeUndefined();
    expect(egg.eggTicks).toBeUndefined();
    expect(egg.sex === "male" || egg.sex === "female").toBe(true);
    expect(egg.level).toBe(1);
    expect(egg.age).toBe(0);
    expect(typeof egg.nature).toBe("string");
    expect(egg.disposition).toBeDefined();
    expect(egg.types).toEqual(["grass", "poison"]);
    expect(egg.stats).toBeDefined();
    expect(egg.hp).toBe(egg.maxHp);
    expect(egg.maxHp).toBeGreaterThan(0);
  });

  it("logs a real eggHatched event exactly at the incubation threshold", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent();
    const log = new EventLog();

    for (let i = 0; i < EGG_INCUBATION_TICKS - 1; i++) tickEgg(world, egg, log, FAKE_CTX, Math.random);
    expect(log.events.some((e) => e.kind === "eggHatched")).toBe(false);

    tickEgg(world, egg, log, FAKE_CTX, Math.random);
    expect(log.events.some((e) => e.kind === "eggHatched")).toBe(true);
  });

  it("rng-determinism: the same seed produces the same hatchling nature/sex, a different seed can produce a different one", () => {
    function run(seed: number) {
      const world = createWorld(10, 10, seed);
      const egg = eggAgent();
      for (let i = 0; i <= EGG_INCUBATION_TICKS; i++) tickEgg(world, egg, undefined, FAKE_CTX, world.rng);
      return JSON.stringify({ nature: egg.nature, sex: egg.sex });
    }
    expect(run(42)).toEqual(run(42));
    const outcomes = new Set([1, 2, 3, 4, 5].map(run));
    expect(outcomes.size).toBeGreaterThan(1);
  });
});

describe("predation.ts: applyEggEating (opportunistic, cross-species-only)", () => {
  it("a hungry agent that does NOT share an egg group with the egg eats it — same bonuses as a real kill", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent({ pos: { x: 5, y: 5 } });
    const eater: Agent = {
      id: "scyther-0",
      species: "scyther",
      pos: { x: 5, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds({ hunger: 0.5 }),
      behavior: "idle",
      moves: [TEST_MOVE],
      level: 10,
    };
    world.agents.push(egg, eater);
    const log = new EventLog();

    const ate = applyEggEating(world, eater, FAKE_CTX, log);

    expect(ate).toBe(true);
    expect(eater.needs.hunger).toBe(1); // same full-restore bonus as a real kill
    expect(egg.alive).toBe(false);
    expect(world.eggsEaten).toBe(1);
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "eggEaten", eaterId: "scyther-0" }));
  });

  it("a same-egg-group (breeding-compatible) species will NOT eat the egg, even starving", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent({ pos: { x: 5, y: 5 } }); // bulbasaur egg
    // Charmander shares the "monster" egg group with bulbasaur — a real
    // cross-species breeding pair, so per direct instruction it must not
    // eat this egg.
    const compatible: Agent = {
      id: "charmander-0",
      species: "charmander",
      pos: { x: 5, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds({ hunger: 0 }),
      behavior: "idle",
    };
    world.agents.push(egg, compatible);

    expect(applyEggEating(world, compatible, FAKE_CTX, undefined)).toBe(false);
    expect(egg.alive).not.toBe(false);
  });

  it("same species never eats its own egg type", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent({ pos: { x: 5, y: 5 } });
    const sameSpecies: Agent = { ...bulbasaurParent("bulbasaur-1", { x: 5, y: 5 }), needs: createNeeds({ hunger: 0 }) };
    world.agents.push(egg, sameSpecies);

    expect(applyEggEating(world, sameSpecies, FAKE_CTX, undefined)).toBe(false);
  });

  it("a comfortable (not hungry) agent doesn't opportunistically eat it despite being 'super desired' only up to the hunger gate", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent({ pos: { x: 5, y: 5 } });
    const eater: Agent = {
      id: "scyther-0",
      species: "scyther",
      pos: { x: 5, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds({ hunger: 1 }),
      behavior: "idle",
    };
    world.agents.push(egg, eater);

    expect(applyEggEating(world, eater, FAKE_CTX, undefined)).toBe(false);
  });

  it("only eats an ADJACENT egg, not one merely somewhere on the map", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent({ pos: { x: 5, y: 5 } });
    const eater: Agent = {
      id: "scyther-0",
      species: "scyther",
      pos: { x: 8, y: 8 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds({ hunger: 0.5 }),
      behavior: "idle",
    };
    world.agents.push(egg, eater);

    expect(applyEggEating(world, eater, FAKE_CTX, undefined)).toBe(false);
  });
});

describe("predation.ts: extreme egg defense overrides ordinary flee/self-preservation", () => {
  const RULES: HuntRules = { scyther: true };

  it("a same-herd defender fights a threat adjacent to its herd's egg instead of fleeing, even critically hurt", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "shelter");
    const egg = eggAgent({ pos: { x: 5, y: 5 }, herdId: "herd-a" });
    // A critically hurt defender — would flee under the ordinary
    // isCriticallyHurt check, but egg defense is checked first and
    // overrides that entirely.
    const defender: Agent = {
      id: "bulbasaur-defender",
      species: "bulbasaur",
      pos: { x: 5, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
      herdId: "herd-a",
      moves: [TEST_MOVE],
      level: 10,
      hp: 1,
      maxHp: 100, // 1% hp — deep past any ordinary retreat threshold
    };
    const threat: Agent = {
      id: "scyther-0",
      species: "scyther",
      pos: { x: 6, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
      moves: [TEST_MOVE],
      level: 5,
    };
    world.agents.push(egg, defender, threat);
    const log = new EventLog();

    const handled = applyPredationInstincts(world, defender, RULES, log, FAKE_CTX);

    expect(handled).toBe(true);
    expect(defender.behavior).toBe("fight");
    expect(defender.fightTarget).toBe("scyther-0");
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "eggDefended", defenderId: "bulbasaur-defender" }));
  });

  it("does not fight a same-egg-group species standing near the egg — only a real (incompatible) threat", () => {
    const world = createWorld(10, 10);
    const egg = eggAgent({ pos: { x: 5, y: 5 }, herdId: "herd-a" });
    const defender: Agent = {
      id: "bulbasaur-defender",
      species: "bulbasaur",
      pos: { x: 5, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
      herdId: "herd-a",
      moves: [TEST_MOVE],
      level: 10,
    };
    const friendly: Agent = {
      id: "charmander-0",
      species: "charmander",
      pos: { x: 5, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
    };
    world.agents.push(egg, defender, friendly);

    const handled = applyPredationInstincts(world, defender, RULES, undefined, FAKE_CTX);
    expect(defender.behavior).not.toBe("fight");
  });

  it("a full population run still respects the ordinary flee reflex when no egg is nearby", () => {
    const world = createWorld(10, 10);
    const prey: Agent = {
      id: "bulbasaur-0",
      species: "bulbasaur",
      pos: { x: 5, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
      moves: [TEST_MOVE],
    };
    const predator: Agent = {
      id: "scyther-0",
      species: "scyther",
      pos: { x: 6, y: 5 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds({ hunger: 0.1 }),
      behavior: "idle",
      moves: [TEST_MOVE],
    };
    world.agents.push(prey, predator);

    applyPredationInstincts(world, prey, RULES, undefined, FAKE_CTX);
    expect(prey.behavior).toBe("flee");
  });
});
