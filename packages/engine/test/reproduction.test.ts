import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import type { LevelingContext, LevelingProfile } from "../src/leveling.js";

/**
 * A minimal fake dex: venusaur evolves from ivysaur evolves from bulbasaur,
 * matching real Pokemon. Egg groups matter here too: bulbasaur/charmander
 * share "monster" (a real cross-species breeding pair in the actual
 * games), scyther is "bug"-only (no overlap with either), and
 * "mysteryon" has no eggGroups at all — an unclassified species, which
 * should still breed with its own kind but nothing else.
 */
const FAKE_PROFILES: Record<string, LevelingProfile> = {
  bulbasaur: {
    growthRate: "MEDIUM_SLOW",
    baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 },
    types: ["grass", "poison"],
    baseExp: 64,
    levelMoves: [[1, "TACKLE"]],
    evolutions: [{ targetSpeciesId: "ivysaur", level: 16 }],
    eggGroups: ["monster", "grass"],
  },
  ivysaur: {
    growthRate: "MEDIUM_SLOW",
    baseStats: { hp: 60, attack: 62, defense: 63, spAttack: 80, spDefense: 80, speed: 60 },
    types: ["grass", "poison"],
    baseExp: 142,
    levelMoves: [],
    evolutions: [{ targetSpeciesId: "venusaur", level: 32 }],
    eggGroups: ["monster", "grass"],
  },
  venusaur: {
    growthRate: "MEDIUM_SLOW",
    baseStats: { hp: 80, attack: 82, defense: 83, spAttack: 100, spDefense: 100, speed: 80 },
    types: ["grass", "poison"],
    baseExp: 236,
    levelMoves: [],
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
  mysteryon: {
    growthRate: "MEDIUM_FAST",
    baseStats: { hp: 50, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
    types: ["normal"],
    baseExp: 50,
    levelMoves: [],
    evolutions: [],
    // No eggGroups: unclassified.
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

  it("a Bulbasaur and a Charmander can breed — real cross-species pair sharing the monster egg group", () => {
    const world = createWorld(10, 10);
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "charmander", herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "bulbasaur", herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    // Offspring is always the mother's own line's base form, regardless of
    // the father's species — a Charmander mother's kid is a Charmander,
    // never a Bulbasaur, even though the father was a Bulbasaur.
    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(child.species).toBe("charmander");
  });

  it("species that share no egg group can't breed at all — Scyther and Bulbasaur", () => {
    const world = createWorld(10, 10);
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "scyther", herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "bulbasaur", herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    expect(world.agents).toHaveLength(2); // no offspring, no cross-species pairing
  });

  it("an unclassified species (no eggGroups data) still breeds with its own kind", () => {
    const world = createWorld(10, 10);
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "mysteryon", herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "mysteryon", herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    expect(world.agents).toHaveLength(3);
    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(child.species).toBe("mysteryon");
  });

  it("an unclassified species can't cross-breed with anything else", () => {
    const world = createWorld(10, 10);
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "mysteryon", herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "bulbasaur", herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    expect(world.agents).toHaveLength(2);
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

  describe("inbreeding avoidance", () => {
    it("a parent and its own offspring don't pair", () => {
      // Real bug this fixes: a founding Venusaur guardian with no
      // predator fathered most of a herd's growth over a real run,
      // including with his own daughters and granddaughters.
      const world = createWorld(10, 10);
      const father: Agent = parent("father", "male", { x: 2, y: 2 });
      const daughter: Agent = { ...parent("daughter", "female", { x: 3, y: 2 }), parentIds: ["some-mother", "father"] };
      world.agents.push(father, daughter);

      tickWorld(world);

      expect(world.agents).toHaveLength(2); // no offspring
    });

    it("full siblings (share both parents) don't pair", () => {
      const world = createWorld(10, 10);
      const a: Agent = { ...parent("a", "female", { x: 2, y: 2 }), parentIds: ["m", "f"] };
      const b: Agent = { ...parent("b", "male", { x: 3, y: 2 }), parentIds: ["m", "f"] };
      world.agents.push(a, b);

      tickWorld(world);

      expect(world.agents).toHaveLength(2);
    });

    it("half-siblings (share one parent) don't pair", () => {
      const world = createWorld(10, 10);
      const a: Agent = { ...parent("a", "female", { x: 2, y: 2 }), parentIds: ["m", "f1"] };
      const b: Agent = { ...parent("b", "male", { x: 3, y: 2 }), parentIds: ["m", "f2"] };
      world.agents.push(a, b);

      tickWorld(world);

      expect(world.agents).toHaveLength(2);
    });

    it("a grandparent and grandchild don't pair", () => {
      const world = createWorld(10, 10);
      const grandparent: Agent = parent("grandparent", "male", { x: 2, y: 2 });
      const grandchild: Agent = {
        ...parent("grandchild", "female", { x: 3, y: 2 }),
        grandparentIds: ["grandparent", "grandmother", "other-gp1", "other-gp2"],
      };
      world.agents.push(grandparent, grandchild);

      tickWorld(world);

      expect(world.agents).toHaveLength(2);
    });

    it("unrelated agents (including two founders with no parentIds) still pair normally", () => {
      const world = createWorld(10, 10);
      world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));

      tickWorld(world);

      expect(world.agents).toHaveLength(3);
    });

    it("a newborn's parentIds/grandparentIds are recorded correctly", () => {
      const world = createWorld(10, 10);
      const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), parentIds: ["gm", "gf"] };
      const father: Agent = parent("father", "male", { x: 3, y: 2 }); // a founder, no parentIds
      world.agents.push(mother, father);

      tickWorld(world);

      const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
      expect(child.parentIds).toEqual(["mother", "father"]);
      // Only the mother's side contributes grandparents — the father is a
      // founder with no parentIds of his own.
      expect(child.grandparentIds).toEqual(["gm", "gf"]);
    });
  });
});
