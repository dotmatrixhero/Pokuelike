import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import type { Agent, Vec2, World } from "../src/types.js";
import type { ImmigrationContext } from "../src/immigration.js";
import {
  advanceAbstractRegion,
  createOverworld,
  demoteRegion,
  promoteRegion,
  setFocusedRegion,
  tickOverworld,
  type Region,
  type RegionEdge,
} from "../src/overworld.js";

/** Deterministic seeded PRNG (mulberry32) — matches this codebase's other statistical tests' own helper. */
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

const CTX: ImmigrationContext = {
  speciesRoster: [
    { id: "bulbasaur", homeLayer: "surface", biomes: ["grassland"] },
    { id: "diglett", homeLayer: "underground" },
  ],
  spawnAgent: stubSpawnAgent,
};

function livingAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "bulbasaur",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ hunger: 0.6, thirst: 0.8, energy: 0.7 }),
    behavior: "idle",
    alive: true,
    level: 5,
    ...overrides,
  };
}

function makeRegion(id: string, world: World): Region {
  return { id, world };
}

describe("demoteRegion", () => {
  it("folds living, non-egg agents into per-species aggregates and empties world.agents", () => {
    const world = createWorld(20, 20, 1);
    world.agents.push(
      livingAgent("b0", { needs: createNeeds({ hunger: 0.4, thirst: 0.6, energy: 0.5 }) }),
      livingAgent("b1", { needs: createNeeds({ hunger: 0.8, thirst: 1.0, energy: 0.9 }) }),
      livingAgent("corpse", { alive: false }),
      livingAgent("egg", { isEgg: true })
    );
    const region = makeRegion("r0", world);
    const overworld = { regions: [region], edges: [], focusedRegionId: "r0", tick: 0 };
    const log = new EventLog();

    demoteRegion(region, overworld, log);

    expect(world.agents).toEqual([]);
    expect(region.aggregates).toBeDefined();
    const agg = region.aggregates!["bulbasaur"]!;
    expect(agg.population).toBe(2);
    expect(agg.avgHunger).toBeCloseTo(0.6, 5);
    expect(agg.avgThirst).toBeCloseTo(0.8, 5);
    expect(agg.avgEnergy).toBeCloseTo(0.7, 5);
    expect(agg.homeLayer).toBe("surface");

    const event = log.events.find((e) => e.kind === "regionDemoted");
    expect(event).toBeDefined();
    if (event?.kind === "regionDemoted") {
      expect(event.speciesCounts).toEqual({ bulbasaur: 2 });
    }
  });

  it("a region with no living agents demotes to an empty aggregate map, not an error", () => {
    const world = createWorld(10, 10, 1);
    const region = makeRegion("r0", world);
    const overworld = { regions: [region], edges: [], focusedRegionId: "r0", tick: 0 };
    demoteRegion(region, overworld);
    expect(region.aggregates).toEqual({});
  });
});

describe("promoteRegion", () => {
  it("invents individuals matching the aggregate population and clears the aggregate", () => {
    const world = createWorld(30, 30, 1);
    const region = makeRegion("r0", world);
    region.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 4,
        avgHunger: 0.5,
        avgThirst: 0.5,
        avgEnergy: 0.5,
        avgLevel: 8,
        baseResourceIndex: 0.3,
        resourceIndex: 0.3,
        lastEventPopulation: 4,
      },
    };
    const overworld = { regions: [region], edges: [], focusedRegionId: "r0", tick: 5 };
    const log = new EventLog();

    promoteRegion(region, CTX, seededRng(42), overworld, log);

    expect(world.agents.length).toBe(4);
    expect(region.aggregates).toBeUndefined();
    for (const agent of world.agents) {
      expect(agent.species).toBe("bulbasaur");
      expect(agent.level).toBe(8);
      expect(agent.sex === "male" || agent.sex === "female").toBe(true);
      expect(agent.needs.hunger).toBeGreaterThanOrEqual(0);
      expect(agent.needs.hunger).toBeLessThanOrEqual(1);
    }
    const event = log.events.find((e) => e.kind === "regionPromoted");
    expect(event).toBeDefined();
    if (event?.kind === "regionPromoted") {
      expect(event.agentIds.length).toBe(4);
    }
  });

  it("skips a species aggregate with no matching roster entry rather than crashing", () => {
    const world = createWorld(20, 20, 1);
    const region = makeRegion("r0", world);
    region.aggregates = {
      mysterymon: {
        species: "mysterymon",
        homeLayer: "surface",
        population: 3,
        avgHunger: 0.5,
        avgThirst: 0.5,
        avgEnergy: 0.5,
        avgLevel: 5,
        baseResourceIndex: 0.2,
        resourceIndex: 0.2,
        lastEventPopulation: 3,
      },
    };
    const overworld = { regions: [region], edges: [], focusedRegionId: "r0", tick: 0 };
    promoteRegion(region, CTX, seededRng(1), overworld);
    expect(world.agents).toEqual([]);
  });

  it("is a no-op on an already-focused (aggregate-less) region", () => {
    const world = createWorld(10, 10, 1);
    world.agents.push(livingAgent("b0"));
    const region = makeRegion("r0", world);
    const overworld = { regions: [region], edges: [], focusedRegionId: "r0", tick: 0 };
    promoteRegion(region, CTX, seededRng(1), overworld);
    expect(world.agents.length).toBe(1);
  });
});

describe("advanceAbstractRegion", () => {
  it("grows a healthy, under-capacity population and emits a boom event on a big enough jump", () => {
    const world = createWorld(20, 20, 1);
    const region = makeRegion("r0", world);
    region.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 10,
        avgHunger: 0.9,
        avgThirst: 0.9,
        avgEnergy: 0.9,
        avgLevel: 5,
        baseResourceIndex: 0.9,
        resourceIndex: 0.9,
        lastEventPopulation: 10,
      },
    };
    const overworld = { regions: [region], edges: [], focusedRegionId: "other", tick: 0 };
    const log = new EventLog();
    const rng = seededRng(7);

    for (let i = 0; i < 2000; i++) {
      overworld.tick += 1;
      advanceAbstractRegion(overworld, region, rng, log);
    }

    const agg = region.aggregates["bulbasaur"]!;
    expect(agg.population).toBeGreaterThan(10);
    expect(log.events.some((e) => e.kind === "regionPopulationBoom")).toBe(true);
  });

  it("shrinks a starving population toward extinction and emits a die-off event", () => {
    const world = createWorld(20, 20, 1);
    const region = makeRegion("r0", world);
    region.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 20,
        avgHunger: 0.0,
        avgThirst: 0.0,
        avgEnergy: 0.0,
        avgLevel: 5,
        baseResourceIndex: 0.0,
        resourceIndex: 0.0,
        lastEventPopulation: 20,
      },
    };
    const overworld = { regions: [region], edges: [], focusedRegionId: "other", tick: 0 };
    const log = new EventLog();
    const rng = seededRng(3);

    for (let i = 0; i < 500; i++) {
      overworld.tick += 1;
      advanceAbstractRegion(overworld, region, rng, log);
    }

    // A sustained zero-resource region should have died the species off
    // entirely — the aggregate entry is dropped once population < 1.
    expect(region.aggregates["bulbasaur"]).toBeUndefined();
    expect(log.events.some((e) => e.kind === "regionDieOff")).toBe(true);
  });

  it("does nothing to a focused (aggregate-less) region", () => {
    const world = createWorld(10, 10, 1);
    world.agents.push(livingAgent("b0"));
    const region = makeRegion("r0", world);
    const overworld = { regions: [region], edges: [], focusedRegionId: "r0", tick: 0 };
    advanceAbstractRegion(overworld, region, seededRng(1));
    expect(world.agents.length).toBe(1);
  });
});

describe("tickOverworld", () => {
  it("fully ticks the focused region's agents but only advances aggregates for the others", () => {
    const focusedWorld = createWorld(20, 20, 1);
    focusedWorld.agents.push(livingAgent("b0", { needs: createNeeds({ hunger: 1, thirst: 1, energy: 1 }) }));
    const focused = makeRegion("focused", focusedWorld);

    const backgroundWorld = createWorld(20, 20, 2);
    for (let i = 0; i < 5; i++) {
      backgroundWorld.agents.push(
        livingAgent(`d${i}`, { species: "diglett", homeLayer: "underground", layer: "underground", needs: createNeeds({ hunger: 0.9, thirst: 0.9, energy: 0.9 }) })
      );
    }
    const background = makeRegion("background", backgroundWorld);

    const overworld = createOverworld([focused, background], [], "focused");
    const log = new EventLog();

    const hungerBefore = focusedWorld.agents[0]!.needs.hunger;
    const popBefore = background.aggregates["diglett"]!.population;

    tickOverworld(overworld, log);

    expect(focusedWorld.tick).toBe(1);
    expect(focusedWorld.agents[0]!.needs.hunger).toBeLessThan(hungerBefore);
    // The background world's own tick clock never advances — its terrain/tick
    // stay frozen while abstracted (see overworld.ts's top-of-file doc comment).
    expect(backgroundWorld.tick).toBe(0);
    expect(background.aggregates["diglett"]).toBeDefined();
    expect(background.aggregates["diglett"]!.population).not.toBe(popBefore);
    expect(overworld.tick).toBe(1);
  });
});

describe("createOverworld / setFocusedRegion", () => {
  it("demotes every non-focused region up front", () => {
    const worldA = createWorld(15, 15, 1);
    worldA.agents.push(livingAgent("a0"));
    const worldB = createWorld(15, 15, 2);
    worldB.agents.push(livingAgent("b0"));

    const regionA = makeRegion("a", worldA);
    const regionB = makeRegion("b", worldB);
    const overworld = createOverworld([regionA, regionB], [], "a");

    expect(regionA.aggregates).toBeUndefined();
    expect(worldA.agents.length).toBe(1);
    expect(regionB.aggregates).toBeDefined();
    expect(worldB.agents.length).toBe(0);
  });

  it("moving focus demotes the old focus and promotes the new one", () => {
    const worldA = createWorld(15, 15, 1);
    worldA.agents.push(livingAgent("a0"), livingAgent("a1"));
    const worldB = createWorld(15, 15, 2);

    const regionA = makeRegion("a", worldA);
    const regionB = makeRegion("b", worldB);
    regionB.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 3,
        avgHunger: 0.5,
        avgThirst: 0.5,
        avgEnergy: 0.5,
        avgLevel: 5,
        baseResourceIndex: 0.4,
        resourceIndex: 0.4,
        lastEventPopulation: 3,
      },
    };
    const overworld = { regions: [regionA, regionB], edges: [], focusedRegionId: "a", tick: 0 };
    const log = new EventLog();

    setFocusedRegion(overworld, "b", CTX, seededRng(9), log);

    expect(overworld.focusedRegionId).toBe("b");
    expect(regionA.aggregates).toBeDefined();
    expect(worldA.agents).toEqual([]);
    expect(regionB.aggregates).toBeUndefined();
    expect(worldB.agents.length).toBe(3);
    expect(log.events.some((e) => e.kind === "regionDemoted")).toBe(true);
    expect(log.events.some((e) => e.kind === "regionPromoted")).toBe(true);
  });

  it("is a no-op when the target is already focused", () => {
    const world = createWorld(10, 10, 1);
    world.agents.push(livingAgent("a0"));
    const region = makeRegion("a", world);
    const overworld = { regions: [region], edges: [], focusedRegionId: "a", tick: 0 };
    setFocusedRegion(overworld, "a", CTX, seededRng(1));
    expect(world.agents.length).toBe(1);
    expect(region.aggregates).toBeUndefined();
  });
});

describe("migration edges: individual region-crossing dispersal", () => {
  it("tickOverworld extracts a disperser that just arrived at the map edge and folds it into the destination region's aggregate", () => {
    const focusedWorld = createWorld(30, 30, 1);
    const crosser = livingAgent("crosser", {
      pos: { x: 28, y: 15 },
      dispersalTarget: { x: 29, y: 15 }, // one tile away — arrives this very tick
      dispersalReason: "matured",
      crossingToRegionId: "b",
      herdId: "old-herd",
      needs: createNeeds(), // fully satisfied — chooseBehavior reads "idle" so applyDispersal actually runs (and arrives) this tick
      level: 12,
    });
    const focused = makeRegion("a", focusedWorld);
    focused.world.agents.push(crosser);

    const destinationWorld = createWorld(30, 30, 2);
    const destination = makeRegion("b", destinationWorld);
    destination.aggregates = {}; // already abstract, no existing bulbasaur entry

    const overworld = { regions: [focused, destination], edges: [{ a: "a", b: "b" }], focusedRegionId: "a", tick: 0 };
    const log = new EventLog();

    tickOverworld(overworld, log);

    // Gone from the focused region entirely.
    expect(focusedWorld.agents.find((a) => a.id === "crosser")).toBeUndefined();

    // Folded into the destination's aggregate, matching the individual's own
    // numbers — `toBeCloseTo` at coarse precision rather than an exact `1`,
    // since `destination` (not focused this tick) also gets its own single
    // `advanceAbstractRegion` tick applied in this same `tickOverworld` call,
    // nudging the freshly-created population by that tick's own growth math.
    const agg = destination.aggregates["bulbasaur"];
    expect(agg).toBeDefined();
    expect(agg!.population).toBeCloseTo(1, 1);
    expect(agg!.avgLevel).toBe(12); // avgLevel is frozen — advanceAbstractRegion never touches it

    const event = log.events.find((e) => e.kind === "regionCrossed");
    expect(event).toBeDefined();
    if (event?.kind === "regionCrossed") {
      expect(event.agentId).toBe("crosser");
      expect(event.fromRegionId).toBe("a");
      expect(event.toRegionId).toBe("b");
    }
  });

  it("folding a second individual of the same species into an existing aggregate averages needs in by population rather than overwriting", () => {
    const focusedWorld = createWorld(30, 30, 1);
    const crosser = livingAgent("crosser2", {
      pos: { x: 28, y: 15 },
      dispersalTarget: { x: 29, y: 15 },
      dispersalReason: "matured",
      crossingToRegionId: "b",
      needs: createNeeds({ hunger: 1, thirst: 1, energy: 1 }),
      level: 10,
    });
    const focused = makeRegion("a", focusedWorld);
    focused.world.agents.push(crosser);

    const destinationWorld = createWorld(30, 30, 2);
    const destination = makeRegion("b", destinationWorld);
    destination.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 3,
        avgHunger: 0.4,
        avgThirst: 0.4,
        avgEnergy: 0.4,
        avgLevel: 6,
        baseResourceIndex: 0.3,
        resourceIndex: 0.3,
        lastEventPopulation: 3,
      },
    };

    const overworld = { regions: [focused, destination], edges: [{ a: "a", b: "b" }], focusedRegionId: "a", tick: 0 };
    tickOverworld(overworld);

    // Coarse precision throughout, not exact-float — `destination` (not
    // focused this tick) also gets its own single `advanceAbstractRegion`
    // tick applied in this same `tickOverworld` call, nudging population/
    // avgHunger slightly away from the pure fold-in arithmetic below.
    const agg = destination.aggregates["bulbasaur"]!;
    expect(agg.population).toBeCloseTo(4, 1);
    // Weighted average before that tick's own drift: (0.4*3 + 1*1) / 4 = 0.55
    expect(agg.avgHunger).toBeCloseTo(0.55, 1);
    // avgLevel is frozen — advanceAbstractRegion never touches it, so this
    // one IS exact: (6*3 + 10*1) / 4 = 7
    expect(agg.avgLevel).toBeCloseTo(7, 5);
  });

  it("a disperser mid-walk toward the edge (not yet arrived) is left alone, not extracted", () => {
    const focusedWorld = createWorld(30, 30, 1);
    const stillWalking = livingAgent("mid-walk", {
      pos: { x: 5, y: 15 },
      dispersalTarget: { x: 29, y: 15 }, // far away — won't arrive this tick
      dispersalReason: "matured",
      crossingToRegionId: "b",
    });
    const focused = makeRegion("a", focusedWorld);
    focused.world.agents.push(stillWalking);
    const destination = makeRegion("b", createWorld(30, 30, 2));
    destination.aggregates = {};

    const overworld = { regions: [focused, destination], edges: [{ a: "a", b: "b" }], focusedRegionId: "a", tick: 0 };
    tickOverworld(overworld);

    expect(focusedWorld.agents.find((a) => a.id === "mid-walk")).toBeDefined();
    expect(destination.aggregates["bulbasaur"]).toBeUndefined();
  });

  it("puts the agent back rather than discarding it if crossingToRegionId names a region not in the graph (defensive)", () => {
    const focusedWorld = createWorld(30, 30, 1);
    const crosser = livingAgent("orphan-crosser", {
      pos: { x: 28, y: 15 },
      dispersalTarget: { x: 29, y: 15 },
      dispersalReason: "matured",
      crossingToRegionId: "nonexistent-region",
    });
    const focused = makeRegion("a", focusedWorld);
    focused.world.agents.push(crosser);

    const overworld = { regions: [focused], edges: [], focusedRegionId: "a", tick: 0 };
    tickOverworld(overworld);

    expect(focusedWorld.agents.find((a) => a.id === "orphan-crosser")).toBeDefined();
  });

  it("end-to-end: a rigged-to-always-disperse agent in a real tickOverworld loop eventually leaves the focused region and shows up in a neighbor's aggregate", () => {
    // Force every RNG draw in the whole tick to succeed the maximally
    // relevant path (dispersal trigger, region-crossing roll, neighbor
    // pick) — deterministic, not a statistical/flaky test.
    const alwaysZero = () => 0;
    const focusedWorld = createWorld(40, 40, 1);
    focusedWorld.rng = alwaysZero;
    const disperser = livingAgent("eager", {
      pos: { x: 20, y: 20 },
      age: 500,
      level: 999999, // comfortably above DISPERSAL_MIN_LEVEL
      pendingLevelDispersalCheck: true,
      sex: "female",
      needs: createNeeds(), // fully satisfied — chooseBehavior reads "idle" the whole walk, never paused
    });
    const focused = makeRegion("a", focusedWorld);
    focused.world.agents.push(disperser);
    const destination = makeRegion("b", createWorld(40, 40, 2));
    destination.aggregates = {};

    const overworld = { regions: [focused, destination], edges: [{ a: "a", b: "b" }], focusedRegionId: "a", tick: 0 };
    const log = new EventLog();

    // Edge target lands near (0,0) under an always-0 rng (see the trigger's
    // own math) — Chebyshev distance from (20,20) is 20 tiles; generous
    // margin below in case a weather effect slows its pace along the way.
    for (let i = 0; i < 60 && focusedWorld.agents.some((a) => a.id === "eager"); i++) {
      tickOverworld(overworld, log);
    }

    expect(focusedWorld.agents.find((a) => a.id === "eager")).toBeUndefined();
    expect(destination.aggregates["bulbasaur"]).toBeDefined();
    expect(log.events.some((e) => e.kind === "regionCrossed")).toBe(true);
  });
});

describe("migration edges (emigration stretch goal)", () => {
  it("moves a population slice from one abstract region to a connected abstract neighbor", () => {
    const worldA = createWorld(20, 20, 1);
    const worldB = createWorld(20, 20, 2);
    const regionA = makeRegion("a", worldA);
    const regionB = makeRegion("b", worldB);
    regionA.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 50,
        avgHunger: 0.8,
        avgThirst: 0.8,
        avgEnergy: 0.8,
        avgLevel: 5,
        baseResourceIndex: 0.6,
        resourceIndex: 0.6,
        lastEventPopulation: 50,
      },
    };
    regionB.aggregates = {};
    const edges: RegionEdge[] = [{ a: "a", b: "b" }];
    const overworld = { regions: [regionA, regionB], edges, focusedRegionId: "other", tick: 0 };

    // Force every roll to succeed (chance roll, then neighbor pick).
    const alwaysFire = () => 0;
    for (let i = 0; i < 5; i++) {
      overworld.tick += 1;
      advanceAbstractRegion(overworld, regionA, alwaysFire);
    }

    expect(regionB.aggregates["bulbasaur"]).toBeDefined();
    expect(regionB.aggregates["bulbasaur"]!.population).toBeGreaterThan(0);
    expect(regionA.aggregates["bulbasaur"]!.population).toBeLessThan(50);
  });

  it("never emigrates into the currently-focused region (no aggregates to receive into)", () => {
    const worldA = createWorld(20, 20, 1);
    const worldB = createWorld(20, 20, 2);
    worldB.agents.push(livingAgent("b0"));
    const regionA = makeRegion("a", worldA);
    const regionB = makeRegion("b", worldB); // focused — no `aggregates`
    regionA.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 50,
        avgHunger: 0.8,
        avgThirst: 0.8,
        avgEnergy: 0.8,
        avgLevel: 5,
        baseResourceIndex: 0.6,
        resourceIndex: 0.6,
        lastEventPopulation: 50,
      },
    };
    const edges: RegionEdge[] = [{ a: "a", b: "b" }];
    const overworld = { regions: [regionA, regionB], edges, focusedRegionId: "b", tick: 0 };
    const alwaysFire = () => 0;
    const log = new EventLog();

    for (let i = 0; i < 5; i++) {
      overworld.tick += 1;
      advanceAbstractRegion(overworld, regionA, alwaysFire, log);
    }

    // No emigration event ever fires (there's no eligible abstract
    // neighbor) — regionA's own population still moves from its ordinary
    // growth/decline dynamics, just never via emigration into `b`.
    expect(log.events.filter((e) => e.kind === "regionEmigrated")).toEqual([]);
    expect(worldB.agents.length).toBe(1);
  });
});
