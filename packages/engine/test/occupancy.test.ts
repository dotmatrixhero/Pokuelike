import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import {
  canEnterShelter,
  canEnterTile,
  canLayEggAt,
  SHELTER_TILE_ADULT_CAP,
  SHELTER_TILE_EGG_CAP,
  shelterCluster,
  tileOccupantCount,
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

describe("occupancy: one living occupant per tile, everywhere, always", () => {
  // Direct ask, after a fainted Scyther and a fleeing Diglett were visibly
  // sharing a tile mid-fight: "I think we want to avoid units on the same
  // tile altogether... everywhere, always." Replaces the old weight-based
  // (surface) / flat-5 (underground/canopy) / same-species-only crowding
  // system entirely — shelter terrain is the one deliberate exception (see
  // the "shelter capacity" describe block below).
  it("an empty tile always admits an agent, any species, any layer", () => {
    const world = createWorld(10, 10);
    expect(canEnterTile(world, makeAgent({ species: "charmander" }), "surface", { x: 3, y: 3 })).toBe(true);
    expect(canEnterTile(world, makeAgent({ species: "diglett", layer: "underground" }), "underground", { x: 3, y: 3 })).toBe(true);
  });

  it("blocks a second, unrelated agent from entering an already-occupied non-shelter tile", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    world.agents = [makeAgent({ id: "a", pos })];
    expect(canEnterTile(world, makeAgent({ id: "b" }), "surface", pos)).toBe(false);
  });

  it("blocks a would-be occupant of the SAME species too — no species exemption anymore", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    world.agents = [makeAgent({ id: "a", species: "bulbasaur", pos })];
    expect(canEnterTile(world, makeAgent({ id: "b", species: "bulbasaur" }), "surface", pos)).toBe(false);
  });

  it("applies the same one-occupant rule underground and in the canopy", () => {
    const world = createWorld(10, 10);
    const pos = { x: 2, y: 2 };
    world.agents = [makeAgent({ id: "a", species: "diglett", pos, layer: "underground" })];
    expect(canEnterTile(world, makeAgent({ id: "b", species: "sandshrew", layer: "underground" }), "underground", pos)).toBe(false);
  });

  it("an agent already standing on a tile can still 're-enter'/stay there — it doesn't block itself", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    const agent = makeAgent({ id: "a", pos });
    world.agents = [agent];
    expect(canEnterTile(world, agent, "surface", pos)).toBe(true);
  });

  it("a fainted ally being carried doesn't count toward occupancy (mirrors its carrier's tile, not a second occupant)", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    world.agents = [
      makeAgent({ id: "carrier", pos }),
      makeAgent({ id: "carried", pos, beingCarriedBy: "carrier", fainted: true }),
    ];
    expect(tileOccupantCount(world, "surface", pos)).toBe(1);
    expect(canEnterTile(world, makeAgent({ id: "newcomer" }), "surface", pos)).toBe(false);
  });

  it("a truly dead agent doesn't count toward occupancy", () => {
    const world = createWorld(10, 10);
    const pos = { x: 4, y: 4 };
    world.agents = [makeAgent({ id: "corpse", pos, alive: false })];
    expect(tileOccupantCount(world, "surface", pos)).toBe(0);
    expect(canEnterTile(world, makeAgent({ id: "scavenger" }), "surface", pos)).toBe(true);
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

  it("shelter keeps its own universal, any-species rule — unlike ordinary tiles, a different species can share it", () => {
    const world = createWorld(10, 10);
    const pos = { x: 5, y: 5 };
    setTile(world, "surface", 5, 5, "shelter");
    world.agents = [makeAgent({ id: "a", species: "bulbasaur", pos, maxHp: 1 })];
    expect(canEnterTile(world, makeAgent({ id: "b", species: "charmander", maxHp: 1 }), "surface", pos)).toBe(true);
  });

  it("a shelter tile with only 1 adult still admits a 2nd (unlike an ordinary tile, which would block any 2nd occupant)", () => {
    const world = createWorld(10, 10);
    const pos = { x: 5, y: 5 };
    setTile(world, "surface", 5, 5, "shelter");
    world.agents = [makeAgent({ id: "a", pos })];
    expect(canEnterTile(world, makeAgent({ id: "b" }), "surface", pos)).toBe(true);
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

  it("SHELTER_TILE_ADULT_CAP/SHELTER_TILE_EGG_CAP are the real per-tile numbers from the direct instruction (2 adults + 1 egg) — briefly raised to 4 to un-stick clutches, reverted back to 1 by direct follow-up ask once the resulting growth was confirmed real but more than wanted", () => {
    expect(SHELTER_TILE_ADULT_CAP).toBe(2);
    expect(SHELTER_TILE_EGG_CAP).toBe(1);
  });
});
