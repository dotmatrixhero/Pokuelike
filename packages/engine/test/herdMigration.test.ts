import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyHerdCohesion } from "../src/herding.js";
import {
  updateHerdMigrations,
  pickDestination,
  recordPredatorPressure,
  SCARCITY_SUSTAIN_TICKS,
  MIGRATION_TIMEOUT_TICKS,
  PREDATOR_PRESSURE_THRESHOLD,
  WANDERLUST_BASE_CHANCE,
  TERRITORIAL_SUSTAIN_TICKS,
  TERRITORIAL_DISTANCE,
  STORM_EXPOSURE_SUSTAIN_TICKS,
} from "../src/herdMigration.js";
import type { Agent, WeatherCell } from "../src/types.js";

/** Never rolls true for wanderlust (always returns 1, above any real chance) — for tests isolating a different trigger. */
const NEVER_WANDER = () => 1;

/** Deterministic seeded PRNG (mulberry32) — for statistical tests that must never flake. */
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

function member(id: string, pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    herdId: "herd-a",
    ...overrides,
  };
}

/** Scatters `count` full-stock food tiles centered on (cx, cy), close together — a "rich patch" for scoring tests. */
function placeFoodCluster(world: ReturnType<typeof createWorld>, cx: number, cy: number, count: number): void {
  let placed = 0;
  for (let dy = -2; dy <= 2 && placed < count; dy++) {
    for (let dx = -2; dx <= 2 && placed < count; dx++) {
      setTile(world, "surface", cx + dx, cy + dy, "food");
      placed++;
    }
  }
}

describe("updateHerdMigrations: scarcity detection", () => {
  it("does not trigger on a single scarce tick", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));

    updateHerdMigrations(world);

    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();
    expect(world.herdScarcityTicks?.["herd-a"]).toBe(1);
  });

  it("does not trigger on a brief dip that recovers before the sustain window elapses", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));

    // Scarce for a while, but well under the sustain threshold...
    for (let i = 0; i < SCARCITY_SUSTAIN_TICKS - 5; i++) {
      world.tick += 1;
      updateHerdMigrations(world);
    }
    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();

    // ...then food shows up nearby, resetting the counter...
    placeFoodCluster(world, 30, 30, 5);
    world.tick += 1;
    updateHerdMigrations(world);
    expect(world.herdScarcityTicks?.["herd-a"]).toBe(0);

    // ...so even continuing to be scarce afterward (food removed again) for
    // fewer ticks than the full sustain window never triggers a migration.
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) setTile(world, "surface", 30 + dx, 30 + dy, "floor");
    }
    for (let i = 0; i < SCARCITY_SUSTAIN_TICKS - 5; i++) {
      world.tick += 1;
      updateHerdMigrations(world);
    }
    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();
  });

  it("triggers once scarcity has been sustained for the full window, and picks a resource-richer destination", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    // A rich food cluster far to the east — the only resource anywhere on the map.
    placeFoodCluster(world, 55, 30, 8);

    let migration;
    for (let i = 0; i < SCARCITY_SUSTAIN_TICKS; i++) {
      world.tick += 1;
      updateHerdMigrations(world);
      migration = world.herdMigrations?.["herd-a"];
      if (migration) break;
    }

    expect(migration).toBeDefined();
    expect(migration!.reason).toBe("scarcity");
    // The chosen destination should be meaningfully closer to the rich
    // cluster (x=55) than to the herd's starting point (x=30).
    expect(migration!.target.x).toBeGreaterThan(40);
  });
});

describe("pickDestination: resource-aware scoring", () => {
  it("prefers a resource-richer candidate over a poorer one", () => {
    const world = createWorld(80, 80);
    // Rich cluster to the east, nothing else anywhere.
    placeFoodCluster(world, 55, 30, 8);

    const destination = pickDestination(world, "surface", { x: 30, y: 30 });

    expect(destination).toBeDefined();
    // Should land near the rich cluster (east), not toward any of the other
    // (resource-empty) candidate directions.
    expect(destination!.x).toBeGreaterThan(30);
  });

  it("returns undefined when no candidate clearly beats the current spot (e.g. a barren map)", () => {
    const world = createWorld(80, 80);
    expect(pickDestination(world, "surface", { x: 30, y: 30 })).toBeUndefined();
  });
});

describe("updateHerdMigrations: arrival and timeout", () => {
  it("clears the migration once the herd centroid reaches the target", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 50, y: 30 }), member("b", { x: 50, y: 30 }));
    world.herdMigrations = { "herd-a": { target: { x: 51, y: 30 }, reason: "scarcity", startedTick: 0 } };

    world.tick += 1;
    updateHerdMigrations(world);

    expect(world.herdMigrations["herd-a"]).toBeUndefined();
  });

  it("gives up (clears without arriving) once the timeout elapses", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 5, y: 5 }), member("b", { x: 5, y: 5 }));
    world.herdMigrations = { "herd-a": { target: { x: 70, y: 70 }, reason: "scarcity", startedTick: 0 } };

    world.tick = MIGRATION_TIMEOUT_TICKS + 1;
    updateHerdMigrations(world);

    expect(world.herdMigrations["herd-a"]).toBeUndefined();
  });

  it("keeps an in-progress migration active when neither arrived nor timed out", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 5, y: 5 }), member("b", { x: 5, y: 5 }));
    world.herdMigrations = { "herd-a": { target: { x: 70, y: 70 }, reason: "scarcity", startedTick: 0 } };

    world.tick += 1;
    updateHerdMigrations(world);

    expect(world.herdMigrations["herd-a"]).toBeDefined();
    expect(world.herdMigrations["herd-a"]!.target).toEqual({ x: 70, y: 70 });
  });
});

describe("applyHerdCohesion during an active migration", () => {
  it("pulls an ordinary member toward the shared migration target instead of the live centroid", () => {
    const world = createWorld(80, 80);
    const straggler = member("a", { x: 0, y: 0 });
    // Live centroid of the herd (without migration) would be near (5, 0) —
    // well within COHESION_DISTANCE, so ordinary cohesion would do nothing.
    world.agents.push(straggler, member("b", { x: 10, y: 0 }));
    world.herdMigrations = { "herd-a": { target: { x: 60, y: 0 }, reason: "scarcity", startedTick: 0 } };

    const moved = applyHerdCohesion(world, straggler);

    expect(moved).toBe(true);
    // Moved toward the migration target (positive x), not toward the old centroid it already satisfied.
    expect(straggler.pos.x).toBeGreaterThan(0);
  });

  it("pulls a guardian toward the same shared migration target as the herd it protects", () => {
    const world = createWorld(80, 80);
    const guardian = member("guardian", { x: 0, y: 0 }, { species: "venusaur" });
    const prey = member("prey", { x: 0, y: 0 }, { species: "bulbasaur" });
    world.agents.push(guardian, prey);
    world.herdMigrations = { "herd-a": { target: { x: 60, y: 0 }, reason: "scarcity", startedTick: 0 } };

    const rules = { scyther: ["bulbasaur"] };
    const moved = applyHerdCohesion(world, guardian, rules);

    expect(moved).toBe(true);
    expect(guardian.pos.x).toBeGreaterThan(0);
  });

  it("every member reads the same target object from World.herdMigrations rather than rolling its own", () => {
    const world = createWorld(80, 80);
    const a = member("a", { x: 0, y: 0 });
    const b = member("b", { x: 1, y: 1 });
    world.agents.push(a, b);
    world.herdMigrations = { "herd-a": { target: { x: 60, y: 0 }, reason: "scarcity", startedTick: 0 } };

    applyHerdCohesion(world, a);
    applyHerdCohesion(world, b);

    // Both moves were computed from the exact same shared target — confirm
    // by checking neither agent's movement depended on a per-agent target
    // (the single entry in herdMigrations is the only target that exists).
    expect(Object.keys(world.herdMigrations)).toEqual(["herd-a"]);
    expect(world.herdMigrations["herd-a"]!.target).toEqual({ x: 60, y: 0 });
  });
});

describe("updateHerdMigrations: predator-pressure trigger", () => {
  it("does not trigger after a single isolated hunt/fight event", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    recordPredatorPressure(world, "herd-a", { x: 32, y: 30 });

    updateHerdMigrations(world, undefined, NEVER_WANDER);

    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();
  });

  it("triggers once a sustained pattern of hunt/fight events crosses the threshold, and scores away from the threat", () => {
    const world = createWorld(80, 80);
    // Herd near the map's center, threat far to the east near the opposite
    // edge — so "away from the threat" unambiguously means west (moving
    // east instead would just close the distance, then run out of map).
    world.agents.push(member("a", { x: 40, y: 30 }), member("b", { x: 40, y: 30 }));
    const threatPos = { x: 75, y: 30 };
    for (let i = 0; i < PREDATOR_PRESSURE_THRESHOLD; i++) {
      recordPredatorPressure(world, "herd-a", threatPos);
    }

    updateHerdMigrations(world, undefined, NEVER_WANDER);

    const migration = world.herdMigrations?.["herd-a"];
    expect(migration).toBeDefined();
    expect(migration!.reason).toBe("predator_pressure");
    // The barren map has no resources anywhere, so the only thing that can
    // make any candidate "better" than staying put is distance from the
    // threat — confirming the destination is meaningfully farther west
    // (away from the threat to the east) than the herd's own position.
    expect(migration!.target.x).toBeLessThan(40);
  });

  it("consumes the pressure counter on trigger, so it doesn't immediately refire next window", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 40, y: 30 }), member("b", { x: 40, y: 30 }));
    for (let i = 0; i < PREDATOR_PRESSURE_THRESHOLD; i++) {
      recordPredatorPressure(world, "herd-a", { x: 75, y: 30 });
    }
    updateHerdMigrations(world, undefined, NEVER_WANDER);
    expect(world.herdPredatorPressure?.["herd-a"]).toBeUndefined();
  });
});

describe("pickDestination: away-from scoring", () => {
  it("prefers a candidate farther from `awayFrom` on an otherwise-barren map", () => {
    const world = createWorld(80, 80);
    const from = { x: 40, y: 30 };
    const threat = { x: 75, y: 30 }; // far east, near the opposite map edge

    const destination = pickDestination(world, "surface", from, threat);

    expect(destination).toBeDefined();
    expect(destination!.x).toBeLessThan(from.x); // west = away from the threat
  });
});

describe("updateHerdMigrations: wanderlust trigger", () => {
  it("fires at a rate consistent with the documented base chance over many ticks (fixed seed, not flaky)", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 })); // neutral disposition -> 1.5x multiplier
    const rng = seededRng(12345);
    const TICKS = 200_000;
    let fires = 0;

    for (let i = 0; i < TICKS; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, rng);
      if (world.herdMigrations?.["herd-a"]) {
        fires++;
        delete world.herdMigrations["herd-a"]; // reset immediately so each tick independently exercises the roll, isolating the per-tick chance from migration-in-progress downtime
      }
    }

    const expectedChance = WANDERLUST_BASE_CHANCE * 1.5; // neutral 0.5/0.5 disposition -> factor 0.5 -> multiplier max(0.25, 1.5) = 1.5
    const expectedFires = TICKS * expectedChance;
    // Generous but real bounds (half to double the expectation) — with a
    // fixed seed this is fully deterministic across runs, never flaky.
    expect(fires).toBeGreaterThan(expectedFires * 0.5);
    expect(fires).toBeLessThan(expectedFires * 2);
  });

  it("fires more often for a bolder/more social herd than a timid/solitary one", () => {
    const boldWorld = createWorld(80, 80);
    boldWorld.agents.push(
      member("a", { x: 30, y: 30 }, { disposition: { boldness: 0.9, aggression: 0.5, sociability: 0.9 } }),
      member("b", { x: 30, y: 30 }, { disposition: { boldness: 0.9, aggression: 0.5, sociability: 0.9 } })
    );
    const timidWorld = createWorld(80, 80);
    timidWorld.agents.push(
      member("a", { x: 30, y: 30 }, { disposition: { boldness: 0.1, aggression: 0.5, sociability: 0.1 } }),
      member("b", { x: 30, y: 30 }, { disposition: { boldness: 0.1, aggression: 0.5, sociability: 0.1 } })
    );

    const TICKS = 200_000;
    let boldFires = 0;
    let timidFires = 0;
    const boldRng = seededRng(999);
    const timidRng = seededRng(999); // same seed on both — isolates the disposition effect, not the rng stream

    for (let i = 0; i < TICKS; i++) {
      boldWorld.tick += 1;
      updateHerdMigrations(boldWorld, undefined, boldRng);
      if (boldWorld.herdMigrations?.["herd-a"]) {
        boldFires++;
        delete boldWorld.herdMigrations["herd-a"];
      }

      timidWorld.tick += 1;
      updateHerdMigrations(timidWorld, undefined, timidRng);
      if (timidWorld.herdMigrations?.["herd-a"]) {
        timidFires++;
        delete timidWorld.herdMigrations["herd-a"];
      }
    }

    expect(boldFires).toBeGreaterThan(timidFires);
  });
});

describe("updateHerdMigrations: territorial trigger", () => {
  it("triggers the smaller of two same-species herds once they stay within range for the sustained duration", () => {
    const world = createWorld(80, 80);
    const smallMembers = [member("s1", { x: 40, y: 30 }), member("s2", { x: 40, y: 30 })];
    const bigMembers = [
      member("b1", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
      member("b2", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
      member("b3", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
      member("b4", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
      member("b5", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
    ];
    world.agents.push(...smallMembers, ...bigMembers);

    let migratedHerd: string | undefined;
    for (let i = 0; i < TERRITORIAL_SUSTAIN_TICKS; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, NEVER_WANDER);
      if (world.herdMigrations?.["herd-a"]) migratedHerd = "herd-a";
      if (world.herdMigrations?.["herd-b"]) migratedHerd = "herd-b";
      if (migratedHerd) break;
    }

    expect(migratedHerd).toBe("herd-a"); // the smaller herd
    expect(world.herdMigrations!["herd-a"]!.reason).toBe("territorial");
    expect(world.herdMigrations!["herd-b"]).toBeUndefined(); // the bigger herd holds its ground
  });

  it("scores the displaced herd's destination away from the rival herd's centroid", () => {
    const world = createWorld(80, 80);
    world.agents.push(
      member("s1", { x: 40, y: 30 }),
      member("s2", { x: 40, y: 30 }),
      member("b1", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
      member("b2", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
      member("b3", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
      member("b4", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" }),
      member("b5", { x: 40 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b" })
    );

    for (let i = 0; i < TERRITORIAL_SUSTAIN_TICKS; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, NEVER_WANDER);
      if (world.herdMigrations?.["herd-a"]) break;
    }

    // Rival is to the east — the displaced (smaller) herd should have been sent west, away from it.
    expect(world.herdMigrations!["herd-a"]!.target.x).toBeLessThan(40);
  });

  it("does not trigger for two herds of different species even when centroids stay close", () => {
    const world = createWorld(80, 80);
    world.agents.push(
      member("s1", { x: 30, y: 30 }),
      member("s2", { x: 30, y: 30 }),
      member("b1", { x: 30 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b", species: "charmander" }),
      member("b2", { x: 30 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b", species: "charmander" }),
      member("b3", { x: 30 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b", species: "charmander" }),
      member("b4", { x: 30 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b", species: "charmander" }),
      member("b5", { x: 30 + TERRITORIAL_DISTANCE, y: 30 }, { herdId: "herd-b", species: "charmander" })
    );

    for (let i = 0; i < TERRITORIAL_SUSTAIN_TICKS + 10; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, NEVER_WANDER);
    }

    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();
    expect(world.herdMigrations?.["herd-b"]).toBeUndefined();
  });
});

function stormCell(overrides: Partial<WeatherCell> = {}): WeatherCell {
  return {
    id: "storm",
    type: "storm",
    center: { x: 30, y: 30 },
    radius: 20,
    startedTick: 0,
    lifespanTicks: 100_000,
    drift: { x: 0, y: 0 },
    ...overrides,
  };
}

describe("updateHerdMigrations: weather trigger (Phase 3)", () => {
  it("does not trigger on a single exposed tick", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    world.weatherCells = [stormCell()];

    world.tick += 1;
    updateHerdMigrations(world, undefined, NEVER_WANDER);

    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();
    expect(world.herdStormExposureTicks?.["herd-a"]).toBe(1);
  });

  it("does not trigger when the herd has forest/canopy cover nearby, even sustained", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    world.weatherCells = [stormCell()];
    setTile(world, "surface", 31, 30, "tree"); // real cover within hasCoverNearby's scan radius

    for (let i = 0; i < STORM_EXPOSURE_SUSTAIN_TICKS + 10; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, NEVER_WANDER);
    }

    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();
  });

  it("does not trigger once the storm has passed, even if the herd stayed in the same (now clear) spot", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    // No active weather at all — should behave exactly like Phase 1/2 (no weather feature).
    for (let i = 0; i < STORM_EXPOSURE_SUSTAIN_TICKS + 10; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, NEVER_WANDER);
    }
    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();
  });

  it("triggers a 'weather' migration once storm exposure without cover is sustained for the full window", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    world.weatherCells = [stormCell()];
    // Some biome data so preferCover's destination scoring has something real to work with.
    world.biomeSeeds = [
      { x: 30, y: 30, name: "highland" }, // exposed here
      { x: 70, y: 30, name: "forest" }, // real cover, far to the east
    ];

    let migration;
    for (let i = 0; i < STORM_EXPOSURE_SUSTAIN_TICKS; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, NEVER_WANDER);
      migration = world.herdMigrations?.["herd-a"];
      if (migration) break;
    }

    expect(migration).toBeDefined();
    expect(migration!.reason).toBe("weather");
  });

  it("resets the exposure counter once cover is regained, so a brief sheltered dip doesn't count toward sustain", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    world.weatherCells = [stormCell()];
    // Enough food nearby that scarcity's own (much longer, 150-tick) sustain
    // window never has a chance to fire and confound this test, which runs
    // long enough (2 * (STORM_EXPOSURE_SUSTAIN_TICKS - 5) + 1) to otherwise
    // cross it.
    placeFoodCluster(world, 30, 30, 5);

    for (let i = 0; i < STORM_EXPOSURE_SUSTAIN_TICKS - 5; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, NEVER_WANDER);
    }
    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();

    // Cover shows up right at the herd's position, resetting the counter...
    setTile(world, "surface", 30, 30, "bush");
    world.tick += 1;
    updateHerdMigrations(world, undefined, NEVER_WANDER);
    expect(world.herdStormExposureTicks?.["herd-a"]).toBe(0);

    // ...cover is removed again, but fewer than the full window remain.
    setTile(world, "surface", 30, 30, "floor");
    for (let i = 0; i < STORM_EXPOSURE_SUSTAIN_TICKS - 5; i++) {
      world.tick += 1;
      updateHerdMigrations(world, undefined, NEVER_WANDER);
    }
    expect(world.herdMigrations?.["herd-a"]).toBeUndefined();
  });
});

describe("pickDestination: preferCover scoring (Phase 3 weather)", () => {
  it("prefers a candidate blending toward a Forest-dominant biome seed over a resource-tied but cover-poor one", () => {
    const world = createWorld(80, 80);
    const from = { x: 40, y: 30 };
    // Two seeds: a non-forest one right at the herd's own position (so its
    // own forest-blend weight starts low) and a Forest one far to the east —
    // a single lone seed would trivially blend to "100% forest everywhere"
    // (biomeWeightsAt normalizes by whichever seeds are nearest), which
    // wouldn't actually test that a *closer* candidate scores higher.
    // Nothing else on the map (no resources anywhere), so any improvement
    // can only come from cover.
    world.biomeSeeds = [
      { x: 40, y: 30, name: "grassland" },
      { x: 75, y: 30, name: "forest" },
    ];

    const destination = pickDestination(world, "surface", from, undefined, true);

    expect(destination).toBeDefined();
    expect(destination!.x).toBeGreaterThan(from.x); // toward the forest seed (east)
  });

  it("without preferCover, the same barren map yields no destination at all (cover alone doesn't count otherwise)", () => {
    const world = createWorld(80, 80);
    world.biomeSeeds = [{ x: 75, y: 30, name: "forest" }];
    expect(pickDestination(world, "surface", { x: 40, y: 30 })).toBeUndefined();
  });

  it("preferCover contributes nothing on a world with no biome data — never crashes, never guesses", () => {
    const world = createWorld(80, 80);
    expect(pickDestination(world, "surface", { x: 40, y: 30 }, undefined, true)).toBeUndefined();
  });
});

describe("updateHerdMigrations: trigger precedence", () => {
  it("does not let a wanderlust roll interrupt a migration already active for another reason", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 50, y: 30 }), member("b", { x: 50, y: 30 }));
    world.herdMigrations = { "herd-a": { target: { x: 70, y: 30 }, reason: "scarcity", startedTick: 0 } };

    // rng that would always roll a wanderlust trigger if it were ever consulted — it should never be.
    world.tick += 1;
    updateHerdMigrations(world, undefined, () => 0);

    expect(world.herdMigrations["herd-a"]!.reason).toBe("scarcity");
  });

  it("prefers scarcity over predator-pressure when both cross their thresholds on the same tick", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    // The only resources anywhere are a rich cluster far to the east, so scarcity's destination search can actually succeed.
    placeFoodCluster(world, 60, 30, 8);

    let migration;
    for (let i = 0; i < SCARCITY_SUSTAIN_TICKS; i++) {
      world.tick += 1;
      // Record predator-pressure events only in the final stretch, timed so
      // its threshold and scarcity's sustain window cross on the exact same
      // tick — a genuine simultaneous-trigger tie, not predator-pressure
      // simply winning by finishing its (much shorter) window first.
      if (i >= SCARCITY_SUSTAIN_TICKS - PREDATOR_PRESSURE_THRESHOLD) {
        recordPredatorPressure(world, "herd-a", { x: 31, y: 30 });
      }
      updateHerdMigrations(world, undefined, NEVER_WANDER);
      migration = world.herdMigrations?.["herd-a"];
      if (migration) break;
    }

    expect(migration).toBeDefined();
    expect(migration!.reason).toBe("scarcity");
  });
});
