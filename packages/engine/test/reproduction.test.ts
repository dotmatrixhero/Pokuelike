import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import type { LevelingContext, LevelingProfile } from "../src/leveling.js";

/** A minimal fake dex: venusaur evolves from ivysaur evolves from bulbasaur, matching real Pokemon. */
const FAKE_PROFILES: Record<string, LevelingProfile> = {
  bulbasaur: {
    growthRate: "MEDIUM_SLOW",
    baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 },
    types: ["grass", "poison"],
    baseExp: 64,
    levelMoves: [[1, "TACKLE"]],
    evolutions: [{ targetSpeciesId: "ivysaur", level: 16 }],
  },
  ivysaur: {
    growthRate: "MEDIUM_SLOW",
    baseStats: { hp: 60, attack: 62, defense: 63, spAttack: 80, spDefense: 80, speed: 60 },
    types: ["grass", "poison"],
    baseExp: 142,
    levelMoves: [],
    evolutions: [{ targetSpeciesId: "venusaur", level: 32 }],
  },
  venusaur: {
    growthRate: "MEDIUM_SLOW",
    baseStats: { hp: 80, attack: 82, defense: 83, spAttack: 100, spDefense: 100, speed: 80 },
    types: ["grass", "poison"],
    baseExp: 236,
    levelMoves: [],
    evolutions: [],
  },
};

const FAKE_CTX: LevelingContext = {
  getProfile: (speciesId) => FAKE_PROFILES[speciesId],
  resolveMove: () => undefined,
  baseSpeciesOf: (speciesId) => {
    if (speciesId === "venusaur") return "bulbasaur";
    if (speciesId === "ivysaur") return "bulbasaur";
    return speciesId;
  },
};

function parent(id: string, sex: "male" | "female", pos: { x: number; y: number }): Agent {
  return {
    id,
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ mateDrive: 0.9 }),
    behavior: "idle",
    herdId: "herd-a",
    sex,
    age: 500,
  };
}

describe("reproduction", () => {
  it("a mature pair closes distance toward each other", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 6, y: 2 }));

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.pos.x).toBeGreaterThan(2);
  });

  it("an adjacent mature pair produces offspring and resets mateDrive", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    tickWorld(world, log);

    expect(world.agents).toHaveLength(3);
    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(child.species).toBe("bulbasaur");
    // Newborns pushed mid-iteration get ticked once more in the same tickWorld call (array iteration
    // picks up appended elements), so age can already be 1 by the time tickWorld returns.
    expect(child.age).toBeLessThanOrEqual(1);
    expect(child.herdId).toBe("herd-a");
    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.needs.mateDrive).toBe(0);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "born", motherId: "mother", fatherId: "father" })
    );
  });

  it("spawns the offspring next to the mother, not stacked exactly on her tile", () => {
    // Regression: spawnOffspring used to place the child at `{ ...mother.pos }`
    // verbatim. Combined with herd cohesion pulling everyone into a tight
    // cluster, that meant every new generation landed on the same tile as
    // the last — a real 2000-tick run ended with 168 of 264 agents stacked
    // on one tile. No herdId here so cohesion can't move the child either,
    // isolating the spawn placement itself.
    const world = createWorld(10, 10);
    const mother: Agent = { ...parent("mother", "female", { x: 5, y: 5 }), herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 5, y: 6 }), herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world);

    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    const dist = Math.abs(child.pos.x - 5) + Math.abs(child.pos.y - 5);
    expect(dist).toBeGreaterThan(0);
    // Diagonal neighbors are Manhattan distance 2, not 1.
    expect(dist).toBeLessThanOrEqual(2);
  });

  it("a bred Venusaur's offspring hatches as a Bulbasaur, not another Venusaur", () => {
    // Mainline-accurate: breeding always produces the base form of the
    // line. Bulbasaur is the "child version" of Venusaur, not a separately-
    // bred species — a Venusaur pair's kid starts over as a Bulbasaur.
    const world = createWorld(10, 10);
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "venusaur" };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "venusaur" };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(child.species).toBe("bulbasaur");
  });

  it("a newborn gets a real combat profile (stats/types/moves) backfilled, not left empty", () => {
    // Newborns used to enter the world with no stats/moves at all — unable
    // to fight, and silently missing their guaranteed per-level-up skill
    // point since grantExp reads agent.types?.[0].
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));

    tickWorld(world, undefined, undefined, FAKE_CTX);

    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(child.types).toEqual(["grass", "poison"]);
    expect(child.stats).toBeDefined();
    expect(child.hp).toBe(child.maxHp);
    expect(child.maxHp).toBeGreaterThan(0);
    expect(child.knownMoves).toContain("TACKLE");
  });

  it("an immature agent doesn't seek a mate even with high mateDrive", () => {
    const world = createWorld(10, 10);
    const youngster: Agent = { ...parent("young", "female", { x: 2, y: 2 }), age: 5 };
    world.agents.push(youngster, parent("father", "male", { x: 3, y: 2 }));

    tickWorld(world);

    expect(world.agents).toHaveLength(2);
  });

  it("same-sex agents don't pair", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("a", "female", { x: 2, y: 2 }), parent("b", "female", { x: 3, y: 2 }));

    tickWorld(world);

    expect(world.agents).toHaveLength(2);
  });
});
