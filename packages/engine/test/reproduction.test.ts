import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { applyMateSeeking } from "../src/reproduction.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import type { LevelingContext, LevelingProfile } from "../src/leveling.js";
import type { Disposition } from "../src/nature.js";

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

function parent(id: string, sex: "male" | "female", pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
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
    ...overrides,
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

  it("offspring get their own randomly-assigned nature and disposition, not inherited from a parent", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));

    tickWorld(world);

    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(typeof child.nature).toBe("string");
    expect(child.disposition).toBeDefined();
    expect(child.disposition!.boldness).toBeGreaterThanOrEqual(0);
    expect(child.disposition!.boldness).toBeLessThanOrEqual(1);
  });

  it("the born event carries the newborn's nature and a disposition summary for the narrative log", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    tickWorld(world, log);

    const bornEvent = log.events.find((e) => e.kind === "born");
    expect(bornEvent).toBeDefined();
    if (bornEvent?.kind === "born") {
      expect(typeof bornEvent.nature).toBe("string");
      expect(typeof bornEvent.dispositionSummary).toBe("string");
      expect(bornEvent.dispositionSummary).toMatch(/^(low|moderate|high) (boldness|aggression|sociability)$/);
    }
  });
});

describe("sociability-driven mate-seeking radius", () => {
  it("a sociable agent closes distance on a mate a neutral agent wouldn't even detect", () => {
    const sociable: Disposition = { boldness: 0.5, aggression: 0.5, sociability: 1 };
    const world = createWorld(20, 20);
    // Distance 6 — beyond the neutral 5-tile search radius, within a fully sociable agent's ~7-tile radius.
    world.agents.push(
      parent("mother", "female", { x: 2, y: 2 }, { disposition: sociable }),
      parent("father", "male", { x: 8, y: 2 })
    );

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.pos.x).toBeGreaterThan(2);
  });

  it("a neutral (no disposition) agent does NOT react to that same distant mate", () => {
    const world = createWorld(20, 20);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 8, y: 2 }));

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.pos.x).toBe(2);
  });

  it("an unsociable agent doesn't close distance on a mate a neutral agent would", () => {
    const unsociable: Disposition = { boldness: 0.5, aggression: 0.5, sociability: 0 };
    const world = createWorld(20, 20);
    // Distance 4 — within the neutral 5-tile radius, beyond an unsociable agent's ~3-tile radius.
    world.agents.push(
      parent("mother", "female", { x: 2, y: 2 }, { disposition: unsociable }),
      parent("father", "male", { x: 6, y: 2 })
    );

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.pos.x).toBe(2);
  });
});

describe("herd-status-driven mate preference", () => {
  // All three fixtures below share one herd (herd-a, from `parent`'s default),
  // which is exactly what makes the level spread on the two suitors resolve
  // to a real top-vs-bottom herdRank rather than an arbitrary one: with the
  // seeker herself in the mix, a herd of 3 sorted by level puts the level-20
  // suitor at rank 1 (full STATUS_DISTANCE_BONUS) and the level-1 suitor at
  // rank 3 (none).

  it("prefers a higher-status suitor over a merely-nearer lower-status one at a comparable distance", () => {
    const world = createWorld(20, 20);
    // Distance 3 (moves in x) vs distance 4 (moves in y) — a 1-tile gap, well
    // inside STATUS_DISTANCE_BONUS (2), so status should flip the pick.
    world.agents.push(
      parent("mother", "female", { x: 0, y: 0 }, { level: 5 }),
      parent("nearer-lowrank", "male", { x: 3, y: 0 }, { level: 1 }),
      parent("farther-highrank", "male", { x: 0, y: 4 }, { level: 20 })
    );

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    // Moved along y (toward the higher-status, farther suitor), not x.
    expect(mother.pos).toEqual({ x: 0, y: 1 });
  });

  it("distance still dominates a large gap — a much-farther higher-status suitor does NOT beat a much-nearer lower-status one", () => {
    const world = createWorld(20, 20);
    // Distance 2 (moves in x) vs distance 5 (moves in y, still within the
    // neutral 5-tile search radius so both are real candidates) — a 3-tile
    // gap, exceeding STATUS_DISTANCE_BONUS (2), so the nearer suitor must
    // still win the effective-distance comparison even though the farther
    // one is top-ranked.
    world.agents.push(
      parent("mother", "female", { x: 0, y: 0 }, { level: 5 }),
      parent("nearer-lowrank", "male", { x: 2, y: 0 }, { level: 1 }),
      parent("farther-highrank", "male", { x: 0, y: 5 }, { level: 20 })
    );

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    // Moved along x (toward the nearer suitor despite its lower status).
    expect(mother.pos).toEqual({ x: 1, y: 0 });
  });
});

describe("cross-herd mating escape hatch (MATE_ISOLATION_TICKS)", () => {
  // Confirmed real mechanism this fixes: dispersal.ts's finishDispersal can
  // found a brand-new herd containing exactly one disperser — a solo herd
  // that, under the plain herd-locked rule, could never mate again since it
  // has zero same-herd candidates by construction. These tests build that
  // exact scenario directly (solo herd + a nearby different-herd candidate)
  // rather than going through a full dispersal walk.

  it("a solo-herd agent does NOT mate across herds immediately — herd preference still holds before sustained isolation", () => {
    const world = createWorld(20, 20);
    const solo: Agent = { ...parent("mother", "female", { x: 5, y: 5 }, { herdId: "solo-herd-of-one" }) };
    const other: Agent = { ...parent("father", "male", { x: 6, y: 5 }, { herdId: "other-herd" }) };
    world.agents.push(solo, other);

    tickWorld(world);

    // No offspring — solo hasn't been isolated long enough yet to widen its search.
    expect(world.agents).toHaveLength(2);
    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.ticksSinceEligibleMate).toBe(1);
  });

  it("a same-herd mate is still preferred over widening the search, even once isolated", () => {
    // Once the same-herd candidate becomes visible, ticksSinceEligibleMate
    // resets to 0 and normal herd-locked behavior applies again.
    const world = createWorld(20, 20);
    const mother: Agent = {
      ...parent("mother", "female", { x: 5, y: 5 }, { herdId: "herd-a" }),
      ticksSinceEligibleMate: 500,
    };
    const sameHerdFather: Agent = parent("father", "male", { x: 6, y: 5 }, { herdId: "herd-a" });
    world.agents.push(mother, sameHerdFather);

    tickWorld(world);

    const updated = world.agents.find((a) => a.id === "mother")!;
    expect(updated.ticksSinceEligibleMate).toBe(0);
  });

  it("a solo-herd agent eventually mates across herds once its own herd has been sterile long enough", () => {
    const world = createWorld(20, 20);
    const solo: Agent = {
      ...parent("mother", "female", { x: 5, y: 5 }, { herdId: "solo-herd-of-one" }),
      ticksSinceEligibleMate: 200, // at MATE_ISOLATION_TICKS threshold
    };
    const other: Agent = parent("father", "male", { x: 6, y: 5 }, { herdId: "other-herd" });
    world.agents.push(solo, other);
    const log = new EventLog();

    tickWorld(world, log);

    expect(world.agents).toHaveLength(3);
    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(child.species).toBe("bulbasaur");
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "born", motherId: "mother", fatherId: "father" })
    );
  });

  it("the escape hatch also opens from the non-isolated side: an isolated male can be accepted by a non-isolated female in another herd", () => {
    // Mating fires on the female's turn (applyMateSeeking), so her own scan
    // has to accept the isolated male even though *she* hasn't been isolated
    // — this is exactly why isEligibleMate checks either party's counter.
    const world = createWorld(20, 20);
    const father: Agent = {
      ...parent("father", "male", { x: 6, y: 5 }, { herdId: "solo-herd-of-one" }),
      ticksSinceEligibleMate: 500,
    };
    const mother: Agent = parent("mother", "female", { x: 5, y: 5 }, { herdId: "other-herd" });
    world.agents.push(mother, father);

    tickWorld(world);

    expect(world.agents).toHaveLength(3);
    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(child.species).toBe("bulbasaur");
  });

  it("solitary agents (no herdId at all) are unaffected — the escape hatch only concerns herd-locked agents", () => {
    const world = createWorld(20, 20);
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world);

    expect(world.agents).toHaveLength(3);
  });
});

/**
 * pathfinding.ts's `stepTowardMovingTarget`, wired into `applyMateSeeking`'s
 * approach step (mate-seeking equivalent of predation.test.ts's hunt
 * pathfinding suite — see that function's own doc comment for the
 * recompute-trigger reasoning shared by both call sites).
 */
describe("mate-seeking approach uses real BFS pathfinding for a MOVING partner (stepTowardMovingTarget)", () => {
  it("routes around an obstacle cluster while closing on a partner that keeps moving, instead of getting stuck", () => {
    const world = createWorld(12, 12);
    // A wall spanning the whole width with a single gap, between the two
    // mates — kept within `mateSearchRadius`'s neutral 5-tile radius
    // throughout, since eligibility here is plain Manhattan distance,
    // oblivious to the wall.
    for (let x = 0; x <= 11; x++) setTile(world, "surface", x, 5, "tree");
    setTile(world, "surface", 6, 5, "floor");

    const mother = parent("mother", "female", { x: 5, y: 3 });
    const father = parent("father", "male", { x: 5, y: 7 });
    world.agents.push(mother, father);

    let sawCacheUse = false;
    let born = false;

    for (let tick = 0; tick < 300 && !born; tick++) {
      world.tick = tick;
      // Simulate the father shifting every tick within a small range — a
      // real moving mate-seeking target, not a stationary one.
      const dx = tick % 2 === 0 ? 1 : -1;
      const nextX = Math.max(4, Math.min(7, father.pos.x + dx));
      if (tileAt(world, "surface", nextX, father.pos.y)?.walkable) father.pos = { ...father.pos, x: nextX };

      applyMateSeeking(world, mother);
      if (mother.pathCache) sawCacheUse = true;
      born = world.agents.some((a) => a.species === "bulbasaur" && a.id !== "mother" && a.id !== "father");
    }

    // The approach actually made progress and eventually connected — the
    // mother crossed the wall via the gap and reached the father closely
    // enough to breed, rather than getting stuck near the wall the way
    // plain greedy `stepToward` could.
    expect(born).toBe(true);
    expect(sawCacheUse).toBe(true);
  });

  it("gives up cleanly (falls back to greedy stepping, never throws) when the partner is genuinely unreachable", () => {
    const world = createWorld(12, 12);
    // Box the father in on all four sides — no gap anywhere.
    for (let x = 4; x <= 6; x++) {
      setTile(world, "surface", x, 4, "tree");
      setTile(world, "surface", x, 6, "tree");
    }
    setTile(world, "surface", 4, 5, "tree");
    setTile(world, "surface", 6, 5, "tree");

    const mother = parent("mother", "female", { x: 0, y: 0 });
    const father = parent("father", "male", { x: 5, y: 5 });
    world.agents.push(mother, father);

    for (let tick = 0; tick < 60; tick++) {
      world.tick = tick;
      expect(() => applyMateSeeking(world, mother)).not.toThrow();
    }

    // Never actually bred (genuinely unreachable), and never left a bogus
    // cached route behind (findPath correctly reports "unreachable" every
    // time here, so the cache is never populated).
    expect(world.agents.length).toBe(2);
    expect(mother.pathCache).toBeUndefined();
  });

  it("stops pathfinding toward a partner once it leaves mate-search range mid-approach", () => {
    const world = createWorld(20, 20);
    const mother = parent("mother", "female", { x: 5, y: 0 });
    const father = parent("father", "male", { x: 5, y: 3 }); // within the neutral 5-tile mateSearchRadius
    world.agents.push(mother, father);

    world.tick = 0;
    applyMateSeeking(world, mother);
    expect(mother.pathCache?.targetId).toBe("father");
    const posAfterFirstApproach = { ...mother.pos };

    // The father wanders far outside mateSearchRadius.
    father.pos = { x: 19, y: 19 };
    world.tick = 1;
    applyMateSeeking(world, mother);

    // No longer an eligible-and-nearby candidate this tick, so
    // applyMateSeeking's own `if (!partner) return;` short-circuits before
    // ever calling stepTowardMovingTarget again — the stale pathCache from
    // the old approach is simply never reused.
    expect(mother.pos).toEqual(posAfterFirstApproach);
  });
});
