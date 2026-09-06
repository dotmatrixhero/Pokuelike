import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import type { Agent, Vec2, World } from "../src/types.js";
import type { ImmigrationContext } from "../src/immigration.js";
import { zoneKey, type MacroGrid, type MacroZone } from "../src/macroGrid.js";
import {
  activeMacroWeatherAt,
  advanceAbstractRegion,
  createMacroWorld,
  demoteRegion,
  promoteZone,
  setFocusedZone,
  tickMacroWorld,
  type MacroWorld,
  type Region,
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

/** A plain, all-land grid — every zone grassland, no ocean/coast/river data — so tests can freely place zones without incidental macro-elevation bias getting in the way. Real macro-grid generation (biomes, coastlines, rivers) is covered separately in macroGrid.test.ts. */
function makeGrid(rows: number, cols: number): MacroGrid {
  const zones: MacroZone[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      zones.push({ row, col, elevation: 0.5, isOcean: false, biome: "grassland", coastEdges: [], riverEdges: [], isRiverSource: false, isLake: false });
    }
  }
  return { rows, cols, zones };
}

/** Same as `makeGrid` but wetland — real terrain-recovery timescales differ enough by biome potential (`estimateZoneResourceIndex`) that a couple of `advanceAbstractRegion` tests below specifically need to match a real live run's own zone, not just "any land biome." */
function makeWetlandGrid(rows: number, cols: number): MacroGrid {
  const zones: MacroZone[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      zones.push({ row, col, elevation: 0.5, isOcean: false, biome: "wetland", coastEdges: [], riverEdges: [], isRiverSource: false, isLake: false });
    }
  }
  return { rows, cols, zones };
}

function makeRegion(row: number, col: number, world?: World): Region {
  return { key: zoneKey(row, col), row, col, world };
}

function makeMacroWorld(grid: MacroGrid, regions: Region[], focusedRow: number, focusedCol: number, rng: () => number = seededRng(1)): MacroWorld {
  return {
    grid,
    regions: new Map(regions.map((r) => [r.key, r])),
    focusedKey: zoneKey(focusedRow, focusedCol),
    tick: 0,
    rng,
    worldSeed: 1,
    zoneWidth: 30,
    zoneHeight: 30,
    weatherFronts: [],
    nextWeatherFrontId: 0,
  };
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
    const region = makeRegion(0, 0, world);
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 0, 0);
    const log = new EventLog();

    demoteRegion(region, mw, log);

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
    const region = makeRegion(0, 0, world);
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 0, 0);
    demoteRegion(region, mw);
    expect(region.aggregates).toEqual({});
  });
});

describe("promoteZone", () => {
  it("invents individuals matching an already-tracked zone's aggregate population and clears the aggregate, without regenerating its existing terrain", () => {
    const world = createWorld(30, 30, 1);
    const region = makeRegion(0, 0, world);
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
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 1, 1, seededRng(42));
    mw.tick = 5;
    const log = new EventLog();

    const result = promoteZone(mw, 0, 0, CTX, log);

    expect(result.world).toBe(world); // the existing world object, not a freshly regenerated one
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
    const region = makeRegion(0, 0, world);
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
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 1, 1, seededRng(1));
    promoteZone(mw, 0, 0, CTX);
    expect(world.agents).toEqual([]);
  });

  it("a genuinely fresh zone (never tracked before) estimates a starting aggregate from the roster and macro-grid biome match, then generates real terrain", () => {
    const mw = makeMacroWorld(makeGrid(3, 3), [], 1, 1, seededRng(7));
    const region = promoteZone(mw, 0, 0, CTX);

    expect(region.world).toBeDefined();
    expect(region.world!.width).toBe(mw.zoneWidth);
    expect(region.world!.height).toBe(mw.zoneHeight);
    // bulbasaur matches the grid's "grassland" biome; diglett has no biome
    // preference at all (matches everywhere) — both should have invented at
    // least one individual from the roster-driven estimate.
    const species = new Set(region.world!.agents.map((a) => a.species));
    expect(species.has("bulbasaur")).toBe(true);
    expect(species.has("diglett")).toBe(true);
    expect(region.aggregates).toBeUndefined();
  });

  it("promoting the same fresh zone twice generates the exact same terrain both times (position-deterministic, not stream-order-dependent)", () => {
    const mwA = makeMacroWorld(makeGrid(3, 3), [], 1, 1, seededRng(7));
    const regionA = promoteZone(mwA, 2, 2, CTX);

    // A second macro world, with unrelated prior rng consumption before this
    // zone is ever touched, still produces byte-identical terrain at the
    // same (worldSeed, row, col) — see overworld.ts's top doc comment on why
    // terrain and invented individuals are deliberately different
    // determinism regimes.
    const mwB = makeMacroWorld(makeGrid(3, 3), [], 0, 0, seededRng(999));
    mwB.rng(); // burn a few rolls to move the stream, unrelated to terrain
    mwB.rng();
    const regionB = promoteZone(mwB, 2, 2, CTX);

    expect(regionA.world!.tiles.surface.map((t) => t.terrain)).toEqual(regionB.world!.tiles.surface.map((t) => t.terrain));
  });

  it("is a no-op-ish reuse on an already-focused (aggregate-less) region — no agents added twice", () => {
    const world = createWorld(10, 10, 1);
    world.agents.push(livingAgent("b0"));
    const region = makeRegion(0, 0, world);
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 0, 0, seededRng(1));
    promoteZone(mw, 0, 0, CTX);
    expect(world.agents.length).toBe(1);
  });
});

describe("advanceAbstractRegion", () => {
  it("grows a healthy, under-capacity population and emits a boom event on a big enough jump", () => {
    const world = createWorld(20, 20, 1);
    const region = makeRegion(0, 0, world);
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
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 1, 1, seededRng(7));
    const log = new EventLog();

    for (let i = 0; i < 2000; i++) {
      mw.tick += 1;
      advanceAbstractRegion(mw, region, log);
    }

    const agg = region.aggregates["bulbasaur"]!;
    expect(agg.population).toBeGreaterThan(10);
    expect(log.events.some((e) => e.kind === "regionPopulationBoom")).toBe(true);
  });

  it("shrinks a starving population toward extinction and emits a die-off event", () => {
    const world = createWorld(20, 20, 1);
    const region = makeRegion(0, 0, world);
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
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 1, 1, seededRng(3));
    const log = new EventLog();

    for (let i = 0; i < 500; i++) {
      mw.tick += 1;
      advanceAbstractRegion(mw, region, log);
    }

    expect(region.aggregates["bulbasaur"]).toBeUndefined();
    expect(log.events.some((e) => e.kind === "regionDieOff")).toBe(true);
  });

  it("does nothing to a focused (aggregate-less) region", () => {
    const world = createWorld(10, 10, 1);
    world.agents.push(livingAgent("b0"));
    const region = makeRegion(0, 0, world);
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 0, 0, seededRng(1));
    advanceAbstractRegion(mw, region);
    expect(world.agents.length).toBe(1);
  });

  it("recovers a population pinned by an unlucky low baseResourceIndex snapshot instead of dying forever", () => {
    // Real bug this guards against, exactly as found via a real overworld
    // run (validateOverworld.ts): a zone demoted right as its TERRAIN
    // happened to be freshly foraged-down measured a depressed
    // baseResourceIndex even though the population living there was
    // otherwise doing fine — and since a demoted zone's World never ticks
    // again to let its terrain regrow, that measurement was frozen forever,
    // eventually starving out the whole zone regardless of species fit.
    // Numbers below (0.42 hunger, 0.23-ish resourceIndex, population just
    // above 5) are the real values a live run's demoted squirtle population
    // (a real wetland-fitting species, matching squirtle's own `biomes`)
    // actually had ~50 ticks after demotion — not a hypothetical worst
    // case, an observed one. A wetland zone's real potential (`makeWetlandGrid`,
    // `estimateZoneResourceIndex`) is ~1.0, matching the live run's own
    // zone; the species roster below tags this species for wetland the same
    // way squirtle's own `biomes` does.
    const roster: ImmigrationContext["speciesRoster"] = [{ id: "bulbasaur", homeLayer: "surface", biomes: ["wetland"] }];
    const world = createWorld(20, 20, 1);
    const region = makeRegion(0, 0, world);
    region.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 5.5,
        avgHunger: 0.42,
        avgThirst: 0.42,
        avgEnergy: 0.5,
        avgLevel: 5,
        baseResourceIndex: 0.23,
        resourceIndex: 0.23,
        lastEventPopulation: 5.5,
      },
    };
    const mw = makeMacroWorld(makeWetlandGrid(3, 3), [region], 1, 1, seededRng(11));

    let minPopulation = Infinity;
    for (let i = 0; i < 6000; i++) {
      mw.tick += 1;
      advanceAbstractRegion(mw, region, undefined, roster);
      const agg = region.aggregates["bulbasaur"];
      if (!agg) break;
      minPopulation = Math.min(minPopulation, agg.population);
    }

    const agg = region.aggregates["bulbasaur"];
    expect(agg).toBeDefined();
    // A real mid-run dip (matching the live run this test is modeled on) is
    // expected and fine — the bug this guards against is the dip never
    // reversing, so the real assertion is recovery PAST the starting point,
    // not a monotonic climb the whole way.
    expect(minPopulation).toBeGreaterThan(0);
    expect(agg!.baseResourceIndex).toBeGreaterThan(0.5);
    expect(agg!.population).toBeGreaterThan(5.5);
  });

  it("still lets a genuine biome mismatch decline toward extinction, even with the recovery drift", () => {
    // The other half of the fix above: recovery is real, but only up to a
    // species' actual habitat fit — a species tagged for a biome this
    // all-grassland test grid doesn't have should still trend toward
    // extinction, so a demoted zone's die-off stays a real ecological
    // signal rather than becoming unconditional. Starting numbers are the
    // real values a live run's mismatched onix population actually had
    // (see the "recovers" test above) shortly before it died out for real.
    const roster: ImmigrationContext["speciesRoster"] = [{ id: "onix", homeLayer: "surface", biomes: ["badlands"] }];
    const world = createWorld(20, 20, 1);
    const region = makeRegion(0, 0, world);
    region.aggregates = {
      onix: {
        species: "onix",
        homeLayer: "surface",
        population: 1.2,
        avgHunger: 0.3,
        avgThirst: 0.3,
        avgEnergy: 0.5,
        avgLevel: 5,
        baseResourceIndex: 0.22,
        resourceIndex: 0.22,
        lastEventPopulation: 1.2,
      },
    };
    const mw = makeMacroWorld(makeGrid(3, 3), [region], 1, 1, seededRng(11));

    for (let i = 0; i < 2000; i++) {
      mw.tick += 1;
      advanceAbstractRegion(mw, region, undefined, roster);
    }

    expect(region.aggregates["onix"]).toBeUndefined();
  });
});

describe("tickMacroWorld", () => {
  it("fully ticks the focused zone's agents but only advances aggregates for other tracked zones", () => {
    const focusedWorld = createWorld(20, 20, 1);
    focusedWorld.agents.push(livingAgent("b0", { needs: createNeeds({ hunger: 1, thirst: 1, energy: 1 }) }));
    const focused = makeRegion(1, 1, focusedWorld);

    const backgroundWorld = createWorld(20, 20, 2);
    for (let i = 0; i < 5; i++) {
      backgroundWorld.agents.push(
        livingAgent(`d${i}`, { species: "diglett", homeLayer: "underground", layer: "underground", needs: createNeeds({ hunger: 0.9, thirst: 0.9, energy: 0.9 }) })
      );
    }
    const background = makeRegion(0, 0, backgroundWorld);
    background.aggregates = {
      diglett: {
        species: "diglett",
        homeLayer: "underground",
        population: 5,
        avgHunger: 0.9,
        avgThirst: 0.9,
        avgEnergy: 0.9,
        avgLevel: 5,
        baseResourceIndex: 0.5,
        resourceIndex: 0.5,
        lastEventPopulation: 5,
      },
    };

    const mw = makeMacroWorld(makeGrid(3, 3), [focused, background], 1, 1, seededRng(2));
    const log = new EventLog();

    const hungerBefore = focusedWorld.agents[0]!.needs.hunger;
    const popBefore = background.aggregates["diglett"]!.population;

    tickMacroWorld(mw, log);

    expect(focusedWorld.tick).toBe(1);
    expect(focusedWorld.agents[0]!.needs.hunger).toBeLessThan(hungerBefore);
    // The background zone's own tick clock never advances — its terrain
    // stays frozen while abstracted (see overworld.ts's top-of-file doc
    // comment). background's world here is a stand-in never actually
    // promoted, so this just confirms tickWorld was never called on it.
    expect(backgroundWorld.tick).toBe(0);
    expect(background.aggregates["diglett"]).toBeDefined();
    expect(background.aggregates["diglett"]!.population).not.toBe(popBefore);
    expect(mw.tick).toBe(1);
  });
});

describe("createMacroWorld / setFocusedZone", () => {
  it("createMacroWorld promotes exactly the requested zone, leaving every other zone untracked", () => {
    const grid = makeGrid(5, 5);
    const mw = createMacroWorld(grid, 2, 2, 123, 20, 20, CTX);

    expect(mw.focusedKey).toBe(zoneKey(2, 2));
    expect(mw.regions.size).toBe(1);
    const focused = mw.regions.get(zoneKey(2, 2))!;
    expect(focused.world).toBeDefined();
    expect(focused.aggregates).toBeUndefined();
  });

  it("moving focus demotes the old focus and promotes the new one, generating the new zone's terrain lazily", () => {
    const grid = makeGrid(5, 5);
    const mw = createMacroWorld(grid, 0, 0, 42, 20, 20, CTX);
    mw.regions.get(zoneKey(0, 0))!.world!.agents.push(livingAgent("extra"));
    const log = new EventLog();

    expect(mw.regions.has(zoneKey(1, 1))).toBe(false); // not tracked at all before focus ever moves there

    setFocusedZone(mw, 1, 1, CTX, log);

    expect(mw.focusedKey).toBe(zoneKey(1, 1));
    const oldFocus = mw.regions.get(zoneKey(0, 0))!;
    expect(oldFocus.aggregates).toBeDefined();
    expect(oldFocus.world!.agents).toEqual([]);
    const newFocus = mw.regions.get(zoneKey(1, 1))!;
    expect(newFocus.aggregates).toBeUndefined();
    expect(newFocus.world).toBeDefined();
    expect(log.events.some((e) => e.kind === "regionDemoted")).toBe(true);
    expect(log.events.some((e) => e.kind === "regionPromoted")).toBe(true);
  });

  it("is a no-op when the target is already focused", () => {
    const grid = makeGrid(3, 3);
    const mw = createMacroWorld(grid, 0, 0, 1, 15, 15, CTX);
    const before = mw.regions.get(zoneKey(0, 0))!.world!.agents.length;
    setFocusedZone(mw, 0, 0, CTX);
    expect(mw.regions.get(zoneKey(0, 0))!.world!.agents.length).toBe(before);
  });
});

describe("migration: individual zone-crossing dispersal", () => {
  it("tickMacroWorld extracts a disperser that just arrived at the map edge and folds it into the destination zone's aggregate, lazily tracking it", () => {
    const focusedWorld = createWorld(30, 30, 1);
    const crosser = livingAgent("crosser", {
      pos: { x: 28, y: 15 },
      dispersalTarget: { x: 29, y: 15 }, // one tile away — arrives this very tick
      dispersalReason: "matured",
      crossingToRegionId: zoneKey(1, 2),
      herdId: "old-herd",
      needs: createNeeds(), // fully satisfied — chooseBehavior reads "idle" so applyDispersal actually runs (and arrives) this tick
      level: 12,
    });
    const focused = makeRegion(1, 1, focusedWorld);
    focused.world!.agents.push(crosser);

    const mw = makeMacroWorld(makeGrid(5, 5), [focused], 1, 1, seededRng(5));
    const log = new EventLog();

    expect(mw.regions.has(zoneKey(1, 2))).toBe(false); // not tracked before the crossing lands

    tickMacroWorld(mw, log);

    expect(focusedWorld.agents.find((a) => a.id === "crosser")).toBeUndefined();

    const destination = mw.regions.get(zoneKey(1, 2));
    expect(destination).toBeDefined();
    const agg = destination!.aggregates!["bulbasaur"];
    expect(agg).toBeDefined();
    // Coarse precision, not exact — a JS Map's iterator visits an entry
    // added during iteration (this destination didn't exist in mw.regions
    // until the focused zone's own crossing lazily tracked it, partway
    // through this same tickMacroWorld loop), so it still gets its own
    // advanceAbstractRegion pass in this same tick, same as the old
    // named-region version's tests already accounted for.
    expect(agg!.population).toBeCloseTo(1, 1);
    expect(agg!.avgLevel).toBe(12); // avgLevel is frozen — advanceAbstractRegion never touches it

    const event = log.events.find((e) => e.kind === "regionCrossed");
    expect(event).toBeDefined();
    if (event?.kind === "regionCrossed") {
      expect(event.agentId).toBe("crosser");
      expect(event.fromRegionId).toBe(zoneKey(1, 1));
      expect(event.toRegionId).toBe(zoneKey(1, 2));
    }
  });

  it("folding a second individual of the same species into an existing aggregate averages needs in by population rather than overwriting", () => {
    const focusedWorld = createWorld(30, 30, 1);
    const crosser = livingAgent("crosser2", {
      pos: { x: 28, y: 15 },
      dispersalTarget: { x: 29, y: 15 },
      dispersalReason: "matured",
      crossingToRegionId: zoneKey(1, 2),
      needs: createNeeds({ hunger: 1, thirst: 1, energy: 1 }),
      level: 10,
    });
    const focused = makeRegion(1, 1, focusedWorld);
    focused.world!.agents.push(crosser);

    const destination = makeRegion(1, 2);
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

    const mw = makeMacroWorld(makeGrid(5, 5), [focused, destination], 1, 1, seededRng(1));
    tickMacroWorld(mw);

    const agg = destination.aggregates["bulbasaur"]!;
    // Coarse precision — `destination` (not focused this tick) also gets its
    // own single `advanceAbstractRegion` tick applied in this same
    // `tickMacroWorld` call, nudging population/avgHunger slightly.
    expect(agg.population).toBeCloseTo(4, 1);
    expect(agg.avgHunger).toBeCloseTo(0.55, 1); // weighted average before drift: (0.4*3 + 1*1) / 4 = 0.55
    expect(agg.avgLevel).toBeCloseTo(7, 5); // avgLevel is frozen — advanceAbstractRegion never touches it: (6*3 + 10*1) / 4 = 7
  });

  it("a disperser mid-walk toward the edge (not yet arrived) is left alone, not extracted", () => {
    const focusedWorld = createWorld(30, 30, 1);
    const stillWalking = livingAgent("mid-walk", {
      pos: { x: 5, y: 15 },
      dispersalTarget: { x: 29, y: 15 }, // far away — won't arrive this tick
      dispersalReason: "matured",
      crossingToRegionId: zoneKey(1, 2),
    });
    const focused = makeRegion(1, 1, focusedWorld);
    focused.world!.agents.push(stillWalking);
    const mw = makeMacroWorld(makeGrid(5, 5), [focused], 1, 1, seededRng(1));

    tickMacroWorld(mw);

    expect(focusedWorld.agents.find((a) => a.id === "mid-walk")).toBeDefined();
    expect(mw.regions.has(zoneKey(1, 2))).toBe(false);
  });

  it("puts the agent back rather than discarding it if crossingToRegionId names a position outside the grid (defensive)", () => {
    const focusedWorld = createWorld(30, 30, 1);
    const crosser = livingAgent("orphan-crosser", {
      pos: { x: 28, y: 15 },
      dispersalTarget: { x: 29, y: 15 },
      dispersalReason: "matured",
      crossingToRegionId: zoneKey(99, 99), // out of a 5x5 grid's bounds
    });
    const focused = makeRegion(1, 1, focusedWorld);
    focused.world!.agents.push(crosser);
    const mw = makeMacroWorld(makeGrid(5, 5), [focused], 1, 1, seededRng(1));

    tickMacroWorld(mw);

    expect(focusedWorld.agents.find((a) => a.id === "orphan-crosser")).toBeDefined();
  });

  it("end-to-end: a rigged-to-always-disperse agent in a real tickMacroWorld loop eventually leaves the focused zone and shows up in a neighbor's aggregate", () => {
    const alwaysZero = () => 0;
    const focusedWorld = createWorld(40, 40, 1);
    focusedWorld.rng = alwaysZero;
    const disperser = livingAgent("eager", {
      pos: { x: 20, y: 20 },
      age: 500,
      level: 999999,
      pendingLevelDispersalCheck: true,
      sex: "female",
      needs: createNeeds(),
    });
    const focused = makeRegion(2, 2, focusedWorld);
    focused.world!.agents.push(disperser);
    const mw = makeMacroWorld(makeGrid(5, 5), [focused], 2, 2, alwaysZero);
    const log = new EventLog();

    for (let i = 0; i < 60 && focusedWorld.agents.some((a) => a.id === "eager"); i++) {
      tickMacroWorld(mw, log);
    }

    expect(focusedWorld.agents.find((a) => a.id === "eager")).toBeUndefined();
    const crossed = log.events.some((e) => e.kind === "regionCrossed");
    expect(crossed).toBe(true);
  });
});

describe("migration: abstract-to-abstract emigration", () => {
  it("moves a population slice from one tracked zone into a lazily-created, previously-untracked neighbor", () => {
    const regionA = makeRegion(1, 1);
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
    const alwaysFire = () => 0;
    const mw = makeMacroWorld(makeGrid(5, 5), [regionA], 3, 3, alwaysFire); // focused zone (3,3) is nowhere near (1,1) or its neighbors

    expect(mw.regions.size).toBe(1);

    for (let i = 0; i < 5; i++) {
      mw.tick += 1;
      advanceAbstractRegion(mw, regionA);
    }

    // A neighbor got lazily tracked (mw.regions grew) purely from the
    // emigration roll, with no species roster/promotion involved at all.
    expect(mw.regions.size).toBeGreaterThan(1);
    const grown = [...mw.regions.values()].find((r) => r !== regionA);
    expect(grown).toBeDefined();
    expect(grown!.aggregates!["bulbasaur"]).toBeDefined();
    expect(grown!.aggregates!["bulbasaur"]!.population).toBeGreaterThan(0);
    expect(regionA.aggregates["bulbasaur"]!.population).toBeLessThan(50);
  });

  it("never emigrates into the currently-focused zone (no aggregates to receive into)", () => {
    const worldB = createWorld(20, 20, 2);
    worldB.agents.push(livingAgent("b0"));
    const regionA = makeRegion(0, 1, undefined); // the only non-focused neighbor of the focused zone below
    const regionB = makeRegion(0, 0, worldB); // focused — no `aggregates`
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
    // A 1x2 grid: regionA's only neighbor is the focused regionB — nowhere else to emigrate to.
    const alwaysFire = () => 0;
    const mw = makeMacroWorld(makeGrid(1, 2), [regionA, regionB], 0, 0, alwaysFire);
    const log = new EventLog();

    for (let i = 0; i < 5; i++) {
      mw.tick += 1;
      advanceAbstractRegion(mw, regionA, log);
    }

    expect(log.events.filter((e) => e.kind === "regionEmigrated")).toEqual([]);
    expect(worldB.agents.length).toBe(1);
  });
});

describe("macro weather fronts", () => {
  it("activeMacroWeatherAt finds a front covering (row, col) and nothing outside its radius", () => {
    const mw = makeMacroWorld(makeGrid(20, 20), [], 0, 0);
    mw.weatherFronts.push({ id: 1, kind: "coldSnap", row: 10, col: 10, radius: 3, driftRow: 0, driftCol: 0, ticksRemaining: 100 });

    expect(activeMacroWeatherAt(mw, 10, 10)?.kind).toBe("coldSnap");
    expect(activeMacroWeatherAt(mw, 10, 12)?.kind).toBe("coldSnap"); // within radius 3
    expect(activeMacroWeatherAt(mw, 10, 20)).toBeUndefined(); // well outside
  });

  it("prefers drought over an overlapping coldSnap when a zone sits under both", () => {
    const mw = makeMacroWorld(makeGrid(20, 20), [], 0, 0);
    mw.weatherFronts.push(
      { id: 1, kind: "coldSnap", row: 10, col: 10, radius: 5, driftRow: 0, driftCol: 0, ticksRemaining: 100 },
      { id: 2, kind: "drought", row: 10, col: 10, radius: 5, driftRow: 0, driftCol: 0, ticksRemaining: 100 }
    );

    expect(activeMacroWeatherAt(mw, 10, 10)?.kind).toBe("drought");
  });

  it("an active front pulls a healthy zone's baseResourceIndex down toward a much lower target, faster than ordinary baseline recovery", () => {
    const region = makeRegion(5, 5);
    region.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 20,
        avgHunger: 0.8,
        avgThirst: 0.8,
        avgEnergy: 0.8,
        avgLevel: 5,
        baseResourceIndex: 0.9, // already healthy, above what any front-scaled target would be
        resourceIndex: 0.6,
        lastEventPopulation: 20,
      },
    };
    const mw = makeMacroWorld(makeGrid(20, 20), [region], 0, 0, seededRng(1));
    mw.weatherFronts.push({ id: 1, kind: "drought", row: 5, col: 5, radius: 5, driftRow: 0, driftCol: 0, ticksRemaining: 5000 });

    const before = region.aggregates["bulbasaur"]!.baseResourceIndex;
    for (let i = 0; i < 200; i++) {
      mw.tick += 1;
      advanceAbstractRegion(mw, region, undefined, CTX.speciesRoster);
    }

    expect(region.aggregates["bulbasaur"]!.baseResourceIndex).toBeLessThan(before);
  });

  it("recovers back toward the biome's real potential once the front has moved on", () => {
    // Realistic drought-survivor numbers (same shape as overworld.test.ts's
    // own "recovers a population pinned by an unlucky low baseResourceIndex
    // snapshot" case above) — not an invented worst case: `resourceIndex`
    // needs to sit high enough relative to `baseResourceIndex` that
    // avgHunger/avgThirst don't starve the population to extinction before
    // the baseline has a chance to climb back.
    const region = makeRegion(5, 5);
    region.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 6,
        avgHunger: 0.42,
        avgThirst: 0.42,
        avgEnergy: 0.5,
        avgLevel: 5,
        baseResourceIndex: 0.23, // drought-suppressed low value
        resourceIndex: 0.23,
        lastEventPopulation: 6,
      },
    };
    const mw = makeMacroWorld(makeGrid(20, 20), [region], 0, 0, seededRng(1));
    // No active front this time — the front has already moved off (row 5, col 5).

    for (let i = 0; i < 6000; i++) {
      mw.tick += 1;
      advanceAbstractRegion(mw, region, undefined, CTX.speciesRoster);
    }

    expect(region.aggregates["bulbasaur"]!.baseResourceIndex).toBeGreaterThan(0.23);
  });

  it("boosts emigration chance and lowers the population bar for a zone under an active front", () => {
    const regionUnderWeather = makeRegion(1, 1);
    regionUnderWeather.aggregates = {
      bulbasaur: {
        species: "bulbasaur",
        homeLayer: "surface",
        population: 2, // below the ordinary EMIGRATION_MIN_POPULATION, above the weather-forced one
        avgHunger: 0.5,
        avgThirst: 0.5,
        avgEnergy: 0.5,
        avgLevel: 5,
        baseResourceIndex: 0.3,
        resourceIndex: 0.3,
        lastEventPopulation: 2,
      },
    };
    // rng just above the ordinary emigration chance, but below the weather-boosted one.
    const rng = () => 0.005;
    const mw = makeMacroWorld(makeGrid(5, 5), [regionUnderWeather], 3, 3, rng);
    mw.weatherFronts.push({ id: 1, kind: "coldSnap", row: 1, col: 1, radius: 3, driftRow: 0, driftCol: 0, ticksRemaining: 1000 });

    mw.tick += 1;
    advanceAbstractRegion(mw, regionUnderWeather);

    expect(regionUnderWeather.aggregates["bulbasaur"]!.population).toBeLessThan(2);
    const grown = [...mw.regions.values()].find((r) => r !== regionUnderWeather);
    expect(grown?.aggregates?.["bulbasaur"]).toBeDefined();
  });

  it("spawns, drifts, and dissipates a front over a real tickMacroWorld loop, logging macroWeatherChanged began/ended events", () => {
    // A rng rigged to always clear the spawn-chance roll on the very first
    // call each tick, then behave normally for everything after — enough to
    // force a front into existence deterministically without needing
    // thousands of real ticks to hit the (deliberately rare) natural spawn
    // chance.
    let callCount = 0;
    const rng = () => {
      callCount++;
      if (callCount === 1) return 0; // guarantees the spawn-chance check fires
      return seededRng(7)();
    };
    const focusedWorld = createWorld(20, 20, 1);
    const focused = makeRegion(10, 10, focusedWorld);
    const mw = makeMacroWorld(makeGrid(20, 20), [focused], 10, 10, rng);
    const log = new EventLog();

    tickMacroWorld(mw, log, undefined, undefined, CTX);

    expect(mw.weatherFronts.length).toBe(1);
    const began = log.events.find((e) => e.kind === "macroWeatherChanged" && e.phase === "began");
    expect(began).toBeDefined();

    const front = mw.weatherFronts[0]!;
    const startRow = front.row;
    const startCol = front.col;
    front.ticksRemaining = 1; // force dissipation on the very next tick

    tickMacroWorld(mw, log, undefined, undefined, CTX);

    expect(mw.weatherFronts.length).toBe(0);
    const ended = log.events.find((e) => e.kind === "macroWeatherChanged" && e.phase === "ended");
    expect(ended).toBeDefined();
    // Drifted at least a little before dissipating (unless drift happened to land exactly back on the start, astronomically unlikely for a random angle).
    expect(front.row === startRow && front.col === startCol).toBe(false);
  });
});
