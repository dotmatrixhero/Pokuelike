import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyMirroredAction, tickAgentAction } from "../src/needs.js";
import { applyPlayerAction } from "../src/player.js";
import { addItem } from "../src/inventory.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct asks: "my allies should do what i do, so if i drink they should
 * look for water in the area too. if i gather or eat they should do that
 * too" and "they should eat things in their inventory if they have edible
 * stuff when hungry."
 */

function human(x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    maxHp: 20,
    hp: 20,
    ...extra,
  };
}

function follower(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "sandshrew",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    followingId: "me",
    ...extra,
  };
}

function openWorld(): World {
  return createWorld(20, 20, 1);
}

describe('Direct ask: "my allies should do what i do" — player.ts signals followers', () => {
  it("drinking sets mirrorAction on every follower", () => {
    const world = openWorld();
    const me = human(5, 5);
    const s = follower("s", 5, 6);
    world.agents.push(me, s);
    setTile(world, "surface", 5, 4, "water");
    expect(applyPlayerAction(world, me, { kind: "drink" })).toBe(true);
    expect(s.mirrorAction).toBe("drink");
  });

  it("eating sets mirrorAction on every follower", () => {
    const world = openWorld();
    const me = human(5, 5);
    const s = follower("s", 5, 6);
    world.agents.push(me, s);
    setTile(world, "surface", 5, 5, "food", 0, "oran");
    world.tiles.surface[5 * 20 + 5]!.stock = 1;
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(true);
    expect(s.mirrorAction).toBe("eat");
  });

  it("gathering sets mirrorAction on every follower", () => {
    const world = openWorld();
    const me = human(5, 5);
    const s = follower("s", 5, 6);
    world.agents.push(me, s);
    setTile(world, "surface", 5, 5, "food", 0, "oran");
    world.tiles.surface[5 * 20 + 5]!.stock = 1;
    expect(applyPlayerAction(world, me, { kind: "gather" })).toBe(true);
    expect(s.mirrorAction).toBe("gather");
  });

  it("a non-follower is unaffected", () => {
    const world = openWorld();
    const me = human(5, 5);
    const stranger = follower("stranger", 5, 6, { followingId: undefined });
    world.agents.push(me, stranger);
    setTile(world, "surface", 5, 4, "water");
    applyPlayerAction(world, me, { kind: "drink" });
    expect(stranger.mirrorAction).toBeUndefined();
  });
});

describe("needs.ts: applyMirroredAction — carrying the imitation out", () => {
  it("drink: adjacent to water, drinks immediately and clears", () => {
    const world = openWorld();
    const s = follower("s", 5, 5, { mirrorAction: "drink", needs: createNeeds({ thirst: 0.6 }) });
    setTile(world, "surface", 5, 4, "water");
    world.agents.push(s);
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.mirrorAction).toBeUndefined();
    expect(s.needs.thirst).toBeGreaterThan(0.6);
  });

  it("drink: not adjacent, paths toward the nearest water instead", () => {
    const world = openWorld();
    const s = follower("s", 2, 5, { mirrorAction: "drink", needs: createNeeds({ thirst: 0.6 }) });
    setTile(world, "surface", 15, 5, "water");
    world.agents.push(s);
    const before = s.pos.x;
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.pos.x).toBeGreaterThan(before);
    expect(s.mirrorAction).toBe("drink"); // still standing, not there yet
  });

  it("eat: a real food item already carried is eaten first, before ever looking at the ground", () => {
    const world = openWorld();
    const s = follower("s", 5, 5, { mirrorAction: "eat", needs: createNeeds({ hunger: 0.6 }) });
    addItem(s, "apple", 1, 1);
    world.agents.push(s);
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.mirrorAction).toBeUndefined();
    expect(s.needs.hunger).toBeGreaterThan(0.6);
    expect(s.inventory).toEqual([]);
  });

  it("eat: nothing carried, eats the tile underfoot if it's food", () => {
    const world = openWorld();
    const s = follower("s", 5, 5, { mirrorAction: "eat", needs: createNeeds({ hunger: 0.6 }) });
    setTile(world, "surface", 5, 5, "food", 0, "oran");
    world.tiles.surface[5 * 20 + 5]!.stock = 1;
    world.agents.push(s);
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.mirrorAction).toBeUndefined();
    expect(s.needs.hunger).toBeGreaterThan(0.6);
  });

  it("eat: nothing carried or underfoot, paths toward the nearest food tile", () => {
    const world = openWorld();
    const s = follower("s", 2, 5, { mirrorAction: "eat", needs: createNeeds({ hunger: 0.6 }) });
    setTile(world, "surface", 15, 5, "food", 0, "oran");
    world.tiles.surface[5 * 20 + 15]!.stock = 1;
    world.agents.push(s);
    const before = s.pos.x;
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.pos.x).toBeGreaterThan(before);
    expect(s.mirrorAction).toBe("eat");
  });

  it("gather: harvests whatever is right here and clears", () => {
    const world = openWorld();
    const s = follower("s", 5, 5, { mirrorAction: "gather" });
    setTile(world, "surface", 5, 5, "food", 0, "oran");
    world.tiles.surface[5 * 20 + 5]!.stock = 1;
    world.agents.push(s);
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.mirrorAction).toBeUndefined();
    expect(s.inventory?.length).toBeGreaterThan(0);
  });

  it("gather: nothing harvestable within reach — the cue just expires, no cross-map hunt", () => {
    const world = openWorld();
    const s = follower("s", 5, 5, { mirrorAction: "gather" });
    world.agents.push(s);
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(false);
    expect(s.mirrorAction).toBeUndefined();
  });

  it("yields to the ordinary needs tree when the SAME need is already urgent for this agent", () => {
    const world = openWorld();
    const s = follower("s", 2, 5, { mirrorAction: "drink", needs: createNeeds({ thirst: 0.1 }) });
    setTile(world, "surface", 15, 5, "water");
    world.agents.push(s);
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(false);
    expect(s.mirrorAction).toBeUndefined();
  });

  it("no mirror cue queued is a plain no-op", () => {
    const world = openWorld();
    const s = follower("s", 5, 5);
    world.agents.push(s);
    expect(applyMirroredAction(world, s, undefined, undefined, Math.random)).toBe(false);
  });
});

describe('Direct ask: "eat things in their inventory... when hungry" — the ordinary seekFood tree', () => {
  it("a genuinely hungry agent with real food carried eats from it instead of searching the ground", () => {
    const world = openWorld();
    const s = follower("s", 5, 5, { needs: createNeeds({ hunger: 0.1, thirst: 1, energy: 1 }) });
    addItem(s, "apple", 1, 1);
    world.agents.push(s);
    const before = s.pos.x;
    tickAgentAction(world, s);
    expect(s.needs.hunger).toBeGreaterThan(0.1);
    expect(s.inventory).toEqual([]);
    expect(s.pos.x).toBe(before); // never had to move at all
  });
});
