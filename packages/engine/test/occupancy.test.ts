import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import {
  canEnterShelter,
  canEnterTile,
  canLayEggAt,
  FLAT_TILE_HEADCOUNT_CAP,
  SHELTER_TILE_ADULT_CAP,
  SHELTER_TILE_EGG_CAP,
  shelterCluster,
  TILE_WEIGHT_CAPACITY,
  tileOccupantCount,
  tileOccupantWeight,
} from "../src/occupancy.js";
import type { Agent } from "../src/types.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    species: "test",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...overrides,
  };
}

describe("occupancy: surface weight-based tile capacity", () => {
  it("an empty tile always admits an agent, even one heavier than the whole capacity", () => {
    const world = createWorld(10, 10);
    const heavy = makeAgent({ id: "heavy", maxHp: TILE_WEIGHT_CAPACITY * 5 });
    expect(canEnterTile(world, heavy, "surface", { x: 3, y: 3 })).toBe(true);
  });

  it("admits roughly 3 average-weight agents, then blocks a 4th", () => {
    const world = createWorld(10, 10);
    const avgWeight = TILE_WEIGHT_CAPACITY / 3;
    const pos = { x: 4, y: 4 };
    world.agents = [
      makeAgent({ id: "a", pos, maxHp: avgWeight }),
      makeAgent({ id: "b", pos, maxHp: avgWeight }),
      makeAgent({ id: "c", pos, maxHp: avgWeight }),
    ];
    const newcomer = makeAgent({ id: "d", maxHp: avgWeight });
    expect(canEnterTile(world, newcomer, "surface", pos)).toBe(false);
  });

  it("admits a newcomer whose addition would exactly hit the cap", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    world.agents = [makeAgent({ id: "a", pos, maxHp: TILE_WEIGHT_CAPACITY - 10 })];
    const newcomer = makeAgent({ id: "b", maxHp: 10 });
    expect(canEnterTile(world, newcomer, "surface", pos)).toBe(true);
  });

  it("blocks a newcomer that would push total weight over the cap", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    world.agents = [makeAgent({ id: "a", pos, maxHp: TILE_WEIGHT_CAPACITY - 5 })];
    const newcomer = makeAgent({ id: "b", maxHp: 10 });
    expect(canEnterTile(world, newcomer, "surface", pos)).toBe(false);
  });

  it("a fainted ally being carried doesn't count toward occupancy (mirrors its carrier's tile, not a second occupant)", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    world.agents = [
      makeAgent({ id: "carrier", pos, maxHp: TILE_WEIGHT_CAPACITY - 5 }),
      makeAgent({ id: "carried", pos, maxHp: 999, beingCarriedBy: "carrier", fainted: true }),
    ];
    expect(tileOccupantWeight(world, "surface", pos)).toBe(TILE_WEIGHT_CAPACITY - 5);
    expect(tileOccupantCount(world, "surface", pos)).toBe(1);
  });

  it("a truly dead agent doesn't count toward occupancy", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    world.agents = [makeAgent({ id: "corpse", pos, maxHp: 999, alive: false })];
    expect(tileOccupantCount(world, "surface", pos)).toBe(0);
    expect(canEnterTile(world, makeAgent({ maxHp: TILE_WEIGHT_CAPACITY * 2 }), "surface", pos)).toBe(true);
  });
});

describe("occupancy: underground/canopy flat headcount cap", () => {
  it("admits up to FLAT_TILE_HEADCOUNT_CAP agents regardless of weight", () => {
    const world = createWorld(10, 10);
    const pos = { x: 2, y: 2 };
    world.agents = Array.from({ length: FLAT_TILE_HEADCOUNT_CAP - 1 }, (_, i) =>
      makeAgent({ id: `u${i}`, pos, layer: "underground", maxHp: 500 })
    );
    const newcomer = makeAgent({ id: "newcomer", layer: "underground", maxHp: 500 });
    expect(canEnterTile(world, newcomer, "underground", pos)).toBe(true);
  });

  it("blocks the agent that would exceed FLAT_TILE_HEADCOUNT_CAP, even featherweight ones", () => {
    const world = createWorld(10, 10);
    const pos = { x: 2, y: 2 };
    world.agents = Array.from({ length: FLAT_TILE_HEADCOUNT_CAP }, (_, i) => makeAgent({ id: `c${i}`, pos, layer: "canopy", maxHp: 1 }));
    const newcomer = makeAgent({ id: "newcomer", layer: "canopy", maxHp: 1 });
    expect(canEnterTile(world, newcomer, "canopy", pos)).toBe(false);
  });

  it("an empty underground/canopy tile always admits one agent (5 >= 1 makes this automatic, but confirm it holds)", () => {
    const world = createWorld(10, 10);
    const newcomer = makeAgent({ layer: "canopy", maxHp: 99999 });
    expect(canEnterTile(world, newcomer, "canopy", { x: 1, y: 1 })).toBe(true);
  });

  it("a heavy surface-legal weight would be blocked at capacity underground/canopy purely by headcount, not weight", () => {
    const world = createWorld(10, 10);
    const pos = { x: 2, y: 2 };
    // 5 featherweight occupants already fill the flat cap even though their
    // combined weight is nowhere near TILE_WEIGHT_CAPACITY — proves this
    // branch is headcount-driven, not weight-driven.
    world.agents = Array.from({ length: FLAT_TILE_HEADCOUNT_CAP }, (_, i) => makeAgent({ id: `f${i}`, pos, layer: "underground", maxHp: 1 }));
    expect(tileOccupantWeight(world, "underground", pos)).toBeLessThan(TILE_WEIGHT_CAPACITY);
    expect(canEnterTile(world, makeAgent({ layer: "underground", maxHp: 1 }), "underground", pos)).toBe(false);
  });
});

describe("occupancy: per-tick cache", () => {
  it("reflects agents added before the tick, and stays consistent across repeated calls within the same tick", () => {
    const world = createWorld(10, 10);
    const pos = { x: 6, y: 6 };
    world.agents = [makeAgent({ id: "a", pos, maxHp: 20 })];
    expect(tileOccupantCount(world, "surface", pos)).toBe(1);
    expect(tileOccupantCount(world, "surface", pos)).toBe(1); // same tick, cached, same answer
  });

  it("rebuilds once world.tick advances", () => {
    const world = createWorld(10, 10);
    const pos = { x: 6, y: 6 };
    world.agents = [makeAgent({ id: "a", pos, maxHp: 20 })];
    expect(tileOccupantCount(world, "surface", pos)).toBe(1);
    world.agents.push(makeAgent({ id: "b", pos, maxHp: 20 }));
    world.tick += 1;
    expect(tileOccupantCount(world, "surface", pos)).toBe(2);
  });
});

describe("occupancy: shelter capacity (2 adults + 1 egg per tile, adjacency-extended)", () => {
  it("a single shelter tile admits exactly 2 adults, then blocks a 3rd", () => {
    const world = createWorld(10, 10);
    const pos = { x: 5, y: 5 };
    setTile(world, "surface", 5, 5, "shelter");
    world.agents = [makeAgent({ id: "a", pos, maxHp: 9999 }), makeAgent({ id: "b", pos, maxHp: 9999 })];
    expect(canEnterShelter(world, "surface", pos)).toBe(false);
    expect(canEnterTile(world, makeAgent({ id: "c", maxHp: 9999 }), "surface", pos)).toBe(false);
  });

  it("a shelter tile with only 1 adult still admits a 2nd (weight is irrelevant on shelter terrain)", () => {
    const world = createWorld(10, 10);
    const pos = { x: 5, y: 5 };
    setTile(world, "surface", 5, 5, "shelter");
    // Heavier than the whole surface weight cap — would fail the ordinary
    // weight rule, but shelter terrain uses the headcount rule instead.
    world.agents = [makeAgent({ id: "a", pos, maxHp: TILE_WEIGHT_CAPACITY * 5 })];
    expect(canEnterTile(world, makeAgent({ id: "b", maxHp: TILE_WEIGHT_CAPACITY * 5 }), "surface", pos)).toBe(true);
  });

  it("a lone shelter tile admits up to SHELTER_TILE_EGG_CAP eggs, then blocks the next one", () => {
    const world = createWorld(10, 10);
    const pos = { x: 5, y: 5 };
    setTile(world, "surface", 5, 5, "shelter");
    world.agents = [];
    for (let i = 0; i < SHELTER_TILE_EGG_CAP; i++) {
      expect(canLayEggAt(world, "surface", pos)).toBe(true);
      world.agents.push(makeAgent({ id: `egg-${i}`, pos, isEgg: true }));
    }
    expect(canLayEggAt(world, "surface", pos)).toBe(false);
  });

  it("adjacent shelter tiles form one cluster whose capacity is the sum of each tile's own cap", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "shelter");
    setTile(world, "surface", 6, 5, "shelter"); // adjacent — same cluster
    setTile(world, "surface", 8, 5, "shelter"); // NOT adjacent (gap at x=7) — a separate cluster

    const cluster = shelterCluster(world, "surface", { x: 5, y: 5 });
    expect(cluster).toHaveLength(2);
    expect(cluster.map((p) => `${p.x},${p.y}`).sort()).toEqual(["5,5", "6,5"]);

    // Fill tile (5,5) to its own 2-adult cap — the cluster as a whole still
    // has room (the (6,5) tile's own 2 slots), so a 3rd adult can still
    // enter the CLUSTER even though the specific tile it started at is full.
    world.agents = [
      makeAgent({ id: "a", pos: { x: 5, y: 5 }, maxHp: 10 }),
      makeAgent({ id: "b", pos: { x: 5, y: 5 }, maxHp: 10 }),
    ];
    expect(canEnterShelter(world, "surface", { x: 5, y: 5 })).toBe(true); // 2 < 2*2 cluster cap
    expect(canEnterShelter(world, "surface", { x: 6, y: 5 })).toBe(true); // same cluster, same answer

    // Fill the whole 2-tile cluster (4 adults) — now genuinely full.
    world.agents.push(
      makeAgent({ id: "c", pos: { x: 6, y: 5 }, maxHp: 10 }),
      makeAgent({ id: "d", pos: { x: 6, y: 5 }, maxHp: 10 })
    );
    expect(canEnterShelter(world, "surface", { x: 5, y: 5 })).toBe(false);

    // The isolated 3rd shelter tile is its own cluster, unaffected by the
    // first cluster being full.
    expect(canEnterShelter(world, "surface", { x: 8, y: 5 })).toBe(true);
  });

  it("a non-shelter tile trivially 'clusters' with only itself", () => {
    const world = createWorld(10, 10);
    expect(shelterCluster(world, "surface", { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });

  it("SHELTER_TILE_ADULT_CAP is the real per-tile number from the direct instruction (2 adults); SHELTER_TILE_EGG_CAP was raised from 1 to fit a full clutch on a single tile (direct follow-up)", () => {
    expect(SHELTER_TILE_ADULT_CAP).toBe(2);
    expect(SHELTER_TILE_EGG_CAP).toBe(4);
  });
});
