import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { examineTile, verbsForTile } from "../src/tileQuery.js";
import type { Agent, World } from "../src/types.js";

function makeAgent(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "sandshrew",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1 },
    behavior: "idle",
    ...extra,
  } as Agent;
}

function world(): World {
  const w = createWorld(12, 12, 42);
  return w;
}

describe("examineTile", () => {
  it("reports terrain, walkability and standing effects", () => {
    const w = world();
    setTile(w, "surface", 3, 3, "bush");
    setTile(w, "surface", 4, 3, "wall");
    setTile(w, "surface", 5, 3, "sludge");
    setTile(w, "surface", 6, 3, "sunbeam");

    expect(examineTile(w, "surface", { x: 3, y: 3 })!.conceals).toBe(true);
    expect(examineTile(w, "surface", { x: 4, y: 3 })!.walkable).toBe(false);
    expect(examineTile(w, "surface", { x: 5, y: 3 })!.poisons).toBe(true);
    expect(examineTile(w, "surface", { x: 6, y: 3 })!.lit).toBe(true);
    expect(examineTile(w, "surface", { x: 0, y: 0 })!.poisons).toBe(false);
  });

  it("separates a living occupant from a corpse on the same tile", () => {
    const w = world();
    w.agents.push(makeAgent("alive", 2, 2));
    w.agents.push(makeAgent("dead", 2, 2, { alive: false }));
    const report = examineTile(w, "surface", { x: 2, y: 2 })!;
    expect(report.occupantId).toBe("alive");
    expect(report.corpseId).toBe("dead");
  });

  it("reports what a food tile yields, and that bare floor yields nothing", () => {
    const w = world();
    setTile(w, "surface", 1, 1, "food");
    const food = examineTile(w, "surface", { x: 1, y: 1 })!;
    expect(food.harvestable.length).toBeGreaterThan(0);
    expect(food.harvestsLeft).toBeGreaterThan(0);
    expect(examineTile(w, "surface", { x: 9, y: 9 })!.harvestable).toEqual([]);
  });

  it("names stairs and the exit", () => {
    const w = world();
    setTile(w, "surface", 1, 2, "stairsDown");
    setTile(w, "surface", 2, 2, "stairsUp");
    setTile(w, "surface", 3, 2, "exit");
    expect(examineTile(w, "surface", { x: 1, y: 2 })!.stairs).toBe("down");
    expect(examineTile(w, "surface", { x: 2, y: 2 })!.stairs).toBe("up");
    expect(examineTile(w, "surface", { x: 3, y: 2 })!.stairs).toBe("exit");
    expect(examineTile(w, "surface", { x: 4, y: 2 })!.stairs).toBeUndefined();
  });

  it("returns undefined off the map rather than throwing", () => {
    expect(examineTile(world(), "surface", { x: -1, y: 5 })).toBeUndefined();
    expect(examineTile(world(), "surface", { x: 999, y: 5 })).toBeUndefined();
  });
});

describe("verbsForTile", () => {
  it("always offers examine, even on a wall you can do nothing else with", () => {
    const w = world();
    setTile(w, "surface", 8, 8, "wall");
    const me = makeAgent("me", 0, 0);
    w.agents.push(me);
    expect(verbsForTile(w, me, "surface", { x: 8, y: 8 })).toEqual(["examine"]);
  });

  it("offers gather only on the tile you are standing on", () => {
    const w = world();
    setTile(w, "surface", 5, 5, "food");
    setTile(w, "surface", 6, 5, "food");
    const me = makeAgent("me", 5, 5);
    w.agents.push(me);
    expect(verbsForTile(w, me, "surface", { x: 5, y: 5 })).toContain("gather");
    // Same terrain one step away: gather acts on agent.pos, so offering it
    // there would be a button that silently does nothing.
    expect(verbsForTile(w, me, "surface", { x: 6, y: 5 })).not.toContain("gather");
  });

  it("offers loot and butcher only next to an actual corpse", () => {
    const w = world();
    const me = makeAgent("me", 4, 4);
    w.agents.push(me, makeAgent("body", 5, 4, { alive: false }), makeAgent("faraway", 9, 9, { alive: false }));
    expect(verbsForTile(w, me, "surface", { x: 5, y: 4 })).toEqual(expect.arrayContaining(["loot", "butcher"]));
    // A corpse across the room is out of reach.
    expect(verbsForTile(w, me, "surface", { x: 9, y: 9 })).not.toContain("loot");
    // Empty adjacent ground is not a corpse.
    expect(verbsForTile(w, me, "surface", { x: 3, y: 4 })).not.toContain("butcher");
  });

  it("offers command only while a bonded follower is actually with you", () => {
    const w = world();
    const me = makeAgent("me", 4, 4);
    w.agents.push(me);
    expect(verbsForTile(w, me, "surface", { x: 5, y: 5 })).not.toContain("command");

    const ally = makeAgent("ally", 5, 5, { followingId: "me" });
    w.agents.push(ally);
    expect(verbsForTile(w, me, "surface", { x: 5, y: 5 })).toContain("command");

    // A follower on another layer is not with you.
    ally.layer = "underground";
    expect(verbsForTile(w, me, "surface", { x: 5, y: 5 })).not.toContain("command");
  });

  it("offers moveHere for walkable ground elsewhere, never for your own tile or a wall", () => {
    const w = world();
    setTile(w, "surface", 7, 7, "wall");
    const me = makeAgent("me", 4, 4);
    w.agents.push(me);
    expect(verbsForTile(w, me, "surface", { x: 6, y: 6 })).toContain("moveHere");
    expect(verbsForTile(w, me, "surface", { x: 4, y: 4 })).not.toContain("moveHere");
    expect(verbsForTile(w, me, "surface", { x: 7, y: 7 })).not.toContain("moveHere");
  });

  it("offers attack on an occupied tile, and on adjacent ground, but never on yourself", () => {
    const w = world();
    const me = makeAgent("me", 4, 4);
    w.agents.push(me, makeAgent("wild", 9, 4));
    // A creature across the room is still a target (attack is tile-targeted).
    expect(verbsForTile(w, me, "surface", { x: 9, y: 4 })).toContain("attack");
    // Adjacent bare ground is swingable — terrain-effect moves target ground.
    expect(verbsForTile(w, me, "surface", { x: 5, y: 4 })).toContain("attack");
    // Your own tile is not.
    expect(verbsForTile(w, me, "surface", { x: 4, y: 4 })).not.toContain("attack");
  });

  it("offers drink beside water, and stairs only underfoot", () => {
    const w = world();
    setTile(w, "surface", 5, 4, "water");
    setTile(w, "surface", 4, 4, "stairsDown");
    setTile(w, "surface", 1, 1, "stairsDown");
    const me = makeAgent("me", 4, 4);
    w.agents.push(me);
    expect(verbsForTile(w, me, "surface", { x: 5, y: 4 })).toContain("drink");
    expect(verbsForTile(w, me, "surface", { x: 4, y: 4 })).toContain("useStairs");
    expect(verbsForTile(w, me, "surface", { x: 1, y: 1 })).not.toContain("useStairs");
  });

  it("never offers more than six verbs — a radial with more is worse than a list", () => {
    const w = world();
    setTile(w, "surface", 4, 4, "food");
    const me = makeAgent("me", 4, 4);
    w.agents.push(me, makeAgent("ally", 5, 5, { followingId: "me" }), makeAgent("body", 4, 5, { alive: false }));
    for (let x = 3; x <= 5; x++) {
      for (let y = 3; y <= 5; y++) {
        expect(verbsForTile(w, me, "surface", { x, y }).length).toBeLessThanOrEqual(6);
      }
    }
  });
});
