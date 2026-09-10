import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import { SLUDGE_LINGER_TICKS, applySludgeEffects, foulTile, isSludge, tickSludge } from "../src/sludge.js";
import { createNeeds } from "../src/needs.js";
import type { Agent, World } from "../src/types.js";

/**
 * Fouled ground. Direct: "Sludge should create a poisonous tile that kills
 * plants and turns water into mud."
 *
 * The design claim these tests are really checking is the SPLIT: the fouled
 * tile is temporary, but what it destroyed is permanent. A test that only
 * looked at the tile right after the hit would pass either way.
 */
function world(): World {
  return createWorld(15, 15, 31337);
}

function stander(w: World, overrides: Partial<Agent> = {}): Agent {
  const agent: Agent = {
    id: "stander",
    species: "bulbasaur",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    level: 10,
    maxHp: 40,
    hp: 40,
    ...overrides,
  };
  w.agents.push(agent);
  return agent;
}

describe("sludge terrain", () => {
  it("turns water into mud — and leaves it mud, not sludge", () => {
    const w = world();
    setTile(w, "surface", 5, 5, "water");
    expect(foulTile(w, "surface", 5, 5)).toBe(true);
    expect(tileAt(w, "surface", 5, 5)!.terrain).toBe("mud");
  });

  it("kills a plant and fouls the tile it was on", () => {
    const w = world();
    setTile(w, "surface", 5, 5, "flora");
    expect(foulTile(w, "surface", 5, 5)).toBe(true);
    expect(tileAt(w, "surface", 5, 5)!.terrain).toBe("sludge");
  });

  it("CONTROL: leaves solid terrain alone — it does not foul everything indiscriminately", () => {
    const w = world();
    for (const terrain of ["wall", "tree", "boulder"] as const) {
      setTile(w, "surface", 5, 5, terrain);
      expect(foulTile(w, "surface", 5, 5)).toBe(false);
      expect(tileAt(w, "surface", 5, 5)!.terrain).toBe(terrain);
    }
  });

  it("the tile drains back to bare floor, but the plant it killed stays dead", () => {
    const w = world();
    setTile(w, "surface", 5, 5, "flora");
    foulTile(w, "surface", 5, 5);
    for (let t = 0; t < SLUDGE_LINGER_TICKS + 2; t++) tickSludge(w);
    const tile = tileAt(w, "surface", 5, 5)!;
    expect(tile.terrain).toBe("floor"); // drained
    expect(tile.terrain).not.toBe("flora"); // the plant did NOT come back
    expect(tile.sludgeTicksRemaining).toBeUndefined();
  });

  it("the ruined pond stays ruined — mud does not drain back to water", () => {
    const w = world();
    setTile(w, "surface", 5, 5, "water");
    foulTile(w, "surface", 5, 5);
    for (let t = 0; t < SLUDGE_LINGER_TICKS * 3; t++) tickSludge(w);
    expect(tileAt(w, "surface", 5, 5)!.terrain).toBe("mud");
  });

  it("re-fouling refreshes the countdown instead of stacking", () => {
    const w = world();
    foulTile(w, "surface", 5, 5);
    for (let t = 0; t < 20; t++) tickSludge(w);
    const partway = tileAt(w, "surface", 5, 5)!.sludgeTicksRemaining!;
    expect(partway).toBeLessThan(SLUDGE_LINGER_TICKS);
    foulTile(w, "surface", 5, 5);
    expect(tileAt(w, "surface", 5, 5)!.sludgeTicksRemaining).toBe(SLUDGE_LINGER_TICKS);
  });

  it("poisons what stands in it, and does not poison what stands beside it (control)", () => {
    const w = world();
    foulTile(w, "surface", 5, 5);
    const inIt = stander(w, { id: "in-it", pos: { x: 5, y: 5 } });
    const besideIt = stander(w, { id: "beside-it", pos: { x: 7, y: 7 } });
    const rng = () => 0.01; // under SLUDGE_POISON_CHANCE_PER_TICK
    applySludgeEffects(w, new EventLog(), rng);
    expect(inIt.status?.kind).toBe("poison");
    expect(besideIt.status).toBeUndefined();
  });

  it("a Poison-type can stand in its own mess", () => {
    const w = world();
    foulTile(w, "surface", 5, 5);
    const grimer = stander(w, { id: "grimer", types: ["poison"] });
    applySludgeEffects(w, new EventLog(), () => 0.01);
    expect(grimer.status).toBeUndefined();
  });

  it("is wired into the real world tick, not just callable in isolation", () => {
    const w = world();
    setTile(w, "surface", 5, 5, "flora");
    foulTile(w, "surface", 5, 5);
    expect(isSludge(tileAt(w, "surface", 5, 5))).toBe(true);
    for (let t = 0; t < SLUDGE_LINGER_TICKS + 5; t++) tickWorld(w, undefined, {});
    expect(tileAt(w, "surface", 5, 5)!.terrain).toBe("floor");
  });
});
