import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { applyMateSeeking } from "../src/reproduction.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import { SHELTER_TILE_EGG_CAP } from "../src/occupancy.js";
import type { LevelingContext, LevelingProfile } from "../src/leveling.js";
import type { Disposition } from "../src/nature.js";
import { EGG_INCUBATION_TICKS, tickEgg } from "../src/eggs.js";

/**
 * Runs `applyMateSeeking` on `mother` (the turn that actually resolves
 * contact — see that function's own doc comment) up to `maxTicks` times,
 * stopping the moment an egg appears in `world.agents`. Direct instruction:
 * mating no longer spawns offspring instantly — a bonded pair only lays an
 * egg once it has real shelter access, so most of this file's old
 * "adjacent pair -> instant offspring" fixtures need a real shelter tile
 * nearby and the two-step bond-then-lay flow this drives through.
 */
function seekUntilEgg(world: ReturnType<typeof createWorld>, mother: Agent, log?: EventLog, maxTicks = 5): Agent | undefined {
  for (let i = 0; i < maxTicks; i++) {
    applyMateSeeking(world, mother, log);
    const egg = world.agents.find((a) => a.isEgg);
    if (egg) return egg;
  }
  return undefined;
}

/** Fast-forwards an already-laid egg through incubation (real `tickEgg` calls) and returns the same (now-hatched) agent object. */
function hatchEgg(world: ReturnType<typeof createWorld>, egg: Agent, ctx?: LevelingContext): Agent {
  for (let i = 0; i <= EGG_INCUBATION_TICKS; i++) {
    tickEgg(world, egg, undefined, ctx, Math.random);
  }
  return egg;
}

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
    level: 16, // meets the new breeding-level floor by default; tests targeting that gate specifically override it
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

  it("an adjacent mature pair bonds (not an instant offspring) and resets mateDrive, when there's no shelter yet", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    tickWorld(world, log);

    // No shelter anywhere on this bare world — bonding happens, but no
    // instant offspring and no egg either (direct instruction: "Pokemon can
    // mate before shelter but that only means they bond... They don't lay
    // egg until after shelter is created").
    expect(world.agents).toHaveLength(2);
    const mother = world.agents.find((a) => a.id === "mother")!;
    const father = world.agents.find((a) => a.id === "father")!;
    expect(mother.bondedPartnerId).toBe("father");
    expect(father.bondedPartnerId).toBe("mother");
    expect(mother.needs.mateDrive).toBe(0);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "bonded", agentId: "mother", partnerId: "father" })
    );
  });

  it("lays a real egg (not an instant newborn) once the household has real shelter access", () => {
    // Real rng: a clutch (EGG_CLUTCH_MIN..MAX = 2-4) is drawn, and this
    // single shelter tile now has room for the whole thing
    // (SHELTER_TILE_EGG_CAP=4) — so this test checks "at least one real
    // egg, not an instant newborn," not an exact count; see the dedicated
    // clutch-size tests below for the exact-count behavior.
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    tickWorld(world, log);

    expect(world.agents.length).toBeGreaterThan(2);
    const eggs = world.agents.filter((a) => a.isEgg);
    expect(eggs.length).toBeGreaterThanOrEqual(1);
    const egg = eggs[0]!;
    expect(egg.species).toBe("bulbasaur");
    expect(egg.parentIds).toEqual(["mother", "father"]);
    expect(egg.herdId).toBe("herd-a");
    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.bondedPartnerId).toBe("father");
    expect(mother.needs.mateDrive).toBe(0);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "eggLaid", motherId: "mother", fatherId: "father" })
    );
  });

  it("a single laying event lays MULTIPLE eggs (a clutch) when the shelter cluster has room for them", () => {
    // Four adjacent shelter tiles -> a 4-tile cluster -> 4 egg slots
    // (SHELTER_TILE_EGG_CAP=1 per tile) -> exactly enough for the whole
    // clutch to fit. Force the clutch-size draw to its max via a fixed rng
    // so this test is deterministic rather than "usually more than one egg."
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    setTile(world, "surface", 3, 3, "shelter");
    setTile(world, "surface", 4, 3, "shelter");
    setTile(world, "surface", 5, 3, "shelter");
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    applyMateSeeking(world, world.agents[0]!, log, undefined, () => 0.999);

    const eggs = world.agents.filter((a) => a.isEgg);
    expect(eggs.length).toBe(4); // EGG_CLUTCH_MAX
    expect(log.events.filter((e) => e.kind === "eggLaid")).toHaveLength(4);
    // Only one exp grant per laying EVENT, not per egg in the clutch.
    expect(world.eggsLaid).toBe(4);
  });

  it("a clutch that doesn't fully fit is capped by real available shelter-cluster capacity, not crammed in regardless", () => {
    // A single shelter tile (SHELTER_TILE_EGG_CAP=1) has exactly 1 real
    // free slot — the clutch-size draw forced to its max (4) should still
    // only place 1, not cram the rest in or drop the whole household's egg
    // count to 0.
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    applyMateSeeking(world, world.agents[0]!, log, undefined, () => 0.999);

    const newEggs = world.agents.filter((a) => a.isEgg);
    expect(newEggs.length).toBe(1); // capped by the 1 real available slot, not the 4-egg clutch draw
    expect(world.eggsLaid).toBe(1);
  });

  it("a bigger, more successful household (more adjacent shelter) reliably gets more eggs out of the same clutch draw", () => {
    // Each shelter tile pre-occupied down to exactly 1 free slot
    // (SHELTER_TILE_EGG_CAP - 1 existing eggs), so free room scales 1:1
    // with tile count regardless of the cap's own absolute value.
    function layWithClusterSize(shelterTiles: number): number {
      const world = createWorld(10, 10);
      const existing: Agent[] = [];
      for (let i = 0; i < shelterTiles; i++) {
        setTile(world, "surface", 2 + i, 3, "shelter");
        for (let j = 0; j < SHELTER_TILE_EGG_CAP - 1; j++) {
          existing.push({ ...parent(`existing-${i}-${j}`, "female", { x: 2 + i, y: 3 }), isEgg: true });
        }
      }
      world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }), ...existing);
      applyMateSeeking(world, world.agents[0]!, undefined, undefined, () => 0.999);
      return world.agents.filter((a) => a.isEgg && !a.id.startsWith("existing-")).length;
    }
    expect(layWithClusterSize(1)).toBe(1);
    expect(layWithClusterSize(2)).toBe(2);
    expect(layWithClusterSize(3)).toBe(3);
    expect(layWithClusterSize(4)).toBe(4); // clamped at EGG_CLUTCH_MAX even with more room than that
  });

  it("each egg in a clutch is an independent Agent instance — hatching/eating one doesn't affect its siblings", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    setTile(world, "surface", 3, 3, "shelter");
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));

    applyMateSeeking(world, world.agents[0]!, undefined, undefined, () => 0.999);
    const [eggA, eggB] = world.agents.filter((a) => a.isEgg);
    expect(eggA).toBeDefined();
    expect(eggB).toBeDefined();
    expect(eggA!.id).not.toBe(eggB!.id);

    // Fast-forward only eggA through incubation — eggB must stay untouched.
    for (let i = 0; i <= EGG_INCUBATION_TICKS; i++) tickEgg(world, eggA!, undefined, undefined, Math.random);
    expect(eggA!.isEgg).toBeUndefined(); // hatched
    expect(eggB!.isEgg).toBe(true); // sibling completely unaffected
    expect(eggB!.eggTicks).toBe(0);

    // Killing eggB (simulating egg-eating) must not touch eggA's now-hatched state.
    eggB!.alive = false;
    expect(eggA!.isEgg).toBeUndefined();
    expect(eggA!.alive).not.toBe(false);
  });

  it("the egg is laid at the shelter tile, not stacked on the mother's own tile", () => {
    // Regression this replaces: spawnOffspring used to place the child at
    // `{ ...mother.pos }` verbatim, which (combined with herd cohesion)
    // collapsed generations onto one tile over a real run. The egg's
    // position is now wherever the actual shelter tile is — a real,
    // different anti-stacking mechanism (occupancy.ts's shelter capacity)
    // layered on top.
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 8, "shelter");
    const mother: Agent = { ...parent("mother", "female", { x: 5, y: 5 }), herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 5, y: 6 }), herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world);

    const egg = world.agents.find((a) => a.isEgg)!;
    expect(egg.pos).toEqual({ x: 5, y: 8 });
  });

  it("a bred Venusaur's offspring hatches as a Bulbasaur, not another Venusaur", () => {
    // Mainline-accurate: breeding always produces the base form of the
    // line. Bulbasaur is the "child version" of Venusaur, not a separately-
    // bred species — a Venusaur pair's kid starts over as a Bulbasaur. The
    // conversion now happens at hatch time (eggs.ts's `tickEgg`), not at lay
    // time — the egg itself carries the mother's own (possibly evolved)
    // species until then.
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "venusaur" };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "venusaur" };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);
    const egg = world.agents.find((a) => a.isEgg)!;
    expect(egg.species).toBe("venusaur");

    const hatchling = hatchEgg(world, egg, FAKE_CTX);
    expect(hatchling.species).toBe("bulbasaur");
    expect(hatchling.isEgg).toBeUndefined();
  });

  it("a Bulbasaur and a Charmander can breed — real cross-species pair sharing the monster egg group", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "charmander", herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "bulbasaur", herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    // The egg (and hatchling) is always the mother's own line, regardless of
    // the father's species — a Charmander mother's egg is a Charmander,
    // never a Bulbasaur, even though the father was a Bulbasaur.
    const egg = world.agents.find((a) => a.isEgg)!;
    expect(egg.species).toBe("charmander");
    expect(hatchEgg(world, egg, FAKE_CTX).species).toBe("charmander");
  });

  it("species that share no egg group can't breed at all — Scyther and Bulbasaur", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "scyther", herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "bulbasaur", herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    expect(world.agents).toHaveLength(2); // no bonding, no egg, no cross-species pairing
  });

  it("an unclassified species (no eggGroups data) still breeds with its own kind", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "mysteryon", herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "mysteryon", herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    // Real rng draws a real clutch (2-4, all fit — SHELTER_TILE_EGG_CAP=4);
    // this test only cares that a real egg of the right species appears.
    expect(world.agents.length).toBeGreaterThan(2);
    const egg = world.agents.find((a) => a.isEgg)!;
    expect(egg.species).toBe("mysteryon");
  });

  it("an unclassified species can't cross-breed with anything else", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), species: "mysteryon", herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), species: "bulbasaur", herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world, undefined, undefined, FAKE_CTX);

    expect(world.agents).toHaveLength(2);
  });

  it("a hatchling gets a real combat profile (stats/types/moves) backfilled, not left empty", () => {
    // Newborns used to enter the world with no stats/moves at all — unable
    // to fight, and silently missing their guaranteed per-level-up skill
    // point since grantExp reads agent.types?.[0]. The backfill now happens
    // at hatch time (eggs.ts's `tickEgg`), same call (`ensureCombatProfile`).
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));

    tickWorld(world, undefined, undefined, FAKE_CTX);
    const egg = world.agents.find((a) => a.isEgg)!;
    const child = hatchEgg(world, egg, FAKE_CTX);

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
      setTile(world, "surface", 2, 3, "shelter");
      world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));

      tickWorld(world);

      expect(world.agents.length).toBeGreaterThan(2); // real rng clutch (2-4), all fit
      expect(world.agents.some((a) => a.isEgg)).toBe(true);
    });

    it("an egg's parentIds/grandparentIds are recorded correctly", () => {
      const world = createWorld(10, 10);
      setTile(world, "surface", 2, 3, "shelter");
      const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), parentIds: ["gm", "gf"] };
      const father: Agent = parent("father", "male", { x: 3, y: 2 }); // a founder, no parentIds
      world.agents.push(mother, father);

      tickWorld(world);

      const egg = world.agents.find((a) => a.isEgg)!;
      expect(egg.parentIds).toEqual(["mother", "father"]);
      // Only the mother's side contributes grandparents — the father is a
      // founder with no parentIds of his own.
      expect(egg.grandparentIds).toEqual(["gm", "gf"]);
    });
  });

  it("a hatchling gets its own randomly-assigned nature and disposition, not inherited from a parent (assigned at hatch, not at lay)", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));

    tickWorld(world);
    const egg = world.agents.find((a) => a.isEgg)!;
    // No nature/disposition yet — those are a hatch-time decision now.
    expect(egg.nature).toBeUndefined();

    const child = hatchEgg(world, egg);
    expect(typeof child.nature).toBe("string");
    expect(child.disposition).toBeDefined();
    expect(child.disposition!.boldness).toBeGreaterThanOrEqual(0);
    expect(child.disposition!.boldness).toBeLessThanOrEqual(1);
  });

  it("hatching logs a real eggHatched event for the narrative log", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 2, 3, "shelter");
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    tickWorld(world, log);
    const egg = world.agents.find((a) => a.isEgg)!;
    for (let i = 0; i <= EGG_INCUBATION_TICKS; i++) tickEgg(world, egg, log, undefined, Math.random);

    const hatchedEvent = log.events.find((e) => e.kind === "eggHatched");
    expect(hatchedEvent).toBeDefined();
    if (hatchedEvent?.kind === "eggHatched") {
      expect(hatchedEvent.agentId).toBe(egg.id);
      expect(hatchedEvent.species).toBe("bulbasaur");
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
  // suitor at rank 1 (full STATUS_DISTANCE_BONUS) and the level-16 suitor at
  // rank 3 (none). All three levels sit at/above MIN_BREEDING_LEVEL_UNEVOLVED
  // (16) so the breeding-level gate itself doesn't interfere with what this
  // describe block is actually testing (rank-driven mate preference).

  it("prefers a higher-status suitor over a merely-nearer lower-status one at a comparable distance", () => {
    const world = createWorld(20, 20);
    // Distance 3 (moves in x) vs distance 4 (moves in y) — a 1-tile gap, well
    // inside STATUS_DISTANCE_BONUS (2), so status should flip the pick.
    world.agents.push(
      parent("mother", "female", { x: 0, y: 0 }, { level: 17 }),
      parent("nearer-lowrank", "male", { x: 3, y: 0 }, { level: 16 }),
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
      parent("mother", "female", { x: 0, y: 0 }, { level: 17 }),
      parent("nearer-lowrank", "male", { x: 2, y: 0 }, { level: 16 }),
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
    setTile(world, "surface", 5, 6, "shelter");
    const solo: Agent = {
      ...parent("mother", "female", { x: 5, y: 5 }, { herdId: "solo-herd-of-one" }),
      ticksSinceEligibleMate: 200, // at MATE_ISOLATION_TICKS threshold
    };
    const other: Agent = parent("father", "male", { x: 6, y: 5 }, { herdId: "other-herd" });
    world.agents.push(solo, other);
    const log = new EventLog();

    tickWorld(world, log);

    expect(world.agents.length).toBeGreaterThan(2); // real rng clutch (2-4), all fit
    const egg = world.agents.find((a) => a.isEgg)!;
    expect(egg.species).toBe("bulbasaur");
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "eggLaid", motherId: "mother", fatherId: "father" })
    );
  });

  it("the escape hatch also opens from the non-isolated side: an isolated male can be accepted by a non-isolated female in another herd", () => {
    // Mating fires on the female's turn (applyMateSeeking), so her own scan
    // has to accept the isolated male even though *she* hasn't been isolated
    // — this is exactly why isEligibleMate checks either party's counter.
    const world = createWorld(20, 20);
    setTile(world, "surface", 5, 6, "shelter");
    const father: Agent = {
      ...parent("father", "male", { x: 6, y: 5 }, { herdId: "solo-herd-of-one" }),
      ticksSinceEligibleMate: 500,
    };
    const mother: Agent = parent("mother", "female", { x: 5, y: 5 }, { herdId: "other-herd" });
    world.agents.push(mother, father);

    tickWorld(world);

    expect(world.agents.length).toBeGreaterThan(2); // real rng clutch (2-4), all fit
    const egg = world.agents.find((a) => a.isEgg)!;
    expect(egg.species).toBe("bulbasaur");
  });

  it("solitary agents (no herdId at all) are unaffected — the escape hatch only concerns herd-locked agents", () => {
    const world = createWorld(20, 20);
    setTile(world, "surface", 2, 3, "shelter");
    const mother: Agent = { ...parent("mother", "female", { x: 2, y: 2 }), herdId: undefined };
    const father: Agent = { ...parent("father", "male", { x: 3, y: 2 }), herdId: undefined };
    world.agents.push(mother, father);

    tickWorld(world);

    expect(world.agents.length).toBeGreaterThan(2); // real rng clutch (2-4), all fit
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
    // A shelter within range so contact actually lays an egg (bonding alone
    // wouldn't flip `born` below) — placed on the mother's own starting
    // tile, well clear of the wall/gap this test is really exercising.
    setTile(world, "surface", 5, 3, "shelter");

    const mother = parent("mother", "female", { x: 5, y: 3 });
    const father = parent("father", "male", { x: 5, y: 7 });
    world.agents.push(mother, father);

    let sawCacheUse = false;
    let born = false;

    for (let tick = 0; tick < 300 && !born; tick++) {
      world.tick = tick;
      // Simulate the father shifting every tick within a small range — a
      // real moving mate-seeking target, not a stationary one. Deliberately
      // a period-3 pattern, not a plain period-2 alternation — see
      // predation.test.ts's identically-reasoned hunt-pursuit test for why:
      // a pursuer that sidesteps to avoid landing on the target's own tile
      // (stepTowardMovingTarget's doc comment) can lock into a stable
      // non-intersecting cycle against a target whose movement exactly
      // matches its own reaction period.
      const dx = [1, 1, -1][tick % 3]!;
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
