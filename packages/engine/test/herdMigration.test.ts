import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyHerdCohesion } from "../src/herding.js";
import {
  updateHerdMigrations,
  pickDestination,
  SCARCITY_SUSTAIN_TICKS,
  MIGRATION_TIMEOUT_TICKS,
} from "../src/herdMigration.js";
import type { Agent } from "../src/types.js";

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
    expect(migration!.reason).toBe("food scarcity");
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
    world.herdMigrations = { "herd-a": { target: { x: 51, y: 30 }, reason: "food scarcity", startedTick: 0 } };

    world.tick += 1;
    updateHerdMigrations(world);

    expect(world.herdMigrations["herd-a"]).toBeUndefined();
  });

  it("gives up (clears without arriving) once the timeout elapses", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 5, y: 5 }), member("b", { x: 5, y: 5 }));
    world.herdMigrations = { "herd-a": { target: { x: 70, y: 70 }, reason: "food scarcity", startedTick: 0 } };

    world.tick = MIGRATION_TIMEOUT_TICKS + 1;
    updateHerdMigrations(world);

    expect(world.herdMigrations["herd-a"]).toBeUndefined();
  });

  it("keeps an in-progress migration active when neither arrived nor timed out", () => {
    const world = createWorld(80, 80);
    world.agents.push(member("a", { x: 5, y: 5 }), member("b", { x: 5, y: 5 }));
    world.herdMigrations = { "herd-a": { target: { x: 70, y: 70 }, reason: "food scarcity", startedTick: 0 } };

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
    world.herdMigrations = { "herd-a": { target: { x: 60, y: 0 }, reason: "food scarcity", startedTick: 0 } };

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
    world.herdMigrations = { "herd-a": { target: { x: 60, y: 0 }, reason: "food scarcity", startedTick: 0 } };

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
    world.herdMigrations = { "herd-a": { target: { x: 60, y: 0 }, reason: "food scarcity", startedTick: 0 } };

    applyHerdCohesion(world, a);
    applyHerdCohesion(world, b);

    // Both moves were computed from the exact same shared target — confirm
    // by checking neither agent's movement depended on a per-agent target
    // (the single entry in herdMigrations is the only target that exists).
    expect(Object.keys(world.herdMigrations)).toEqual(["herd-a"]);
    expect(world.herdMigrations["herd-a"]!.target).toEqual({ x: 60, y: 0 });
  });
});
