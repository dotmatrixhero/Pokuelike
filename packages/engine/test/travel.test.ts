import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { advancePlayerTurn } from "../src/simulation.js";
import { updatePlayerVision, tileIndex, visionScope } from "../src/vision.js";
import { nextTravelStep, visibleAgentIds } from "../src/travel.js";
import type { Agent } from "../src/types.js";

function human(x: number, y: number): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
  };
}

describe("nextTravelStep (tap to walk)", () => {
  it("walks the shortest known path and arrives", () => {
    const world = createWorld(20, 20, 1);
    const me = human(5, 5);
    world.agents.push(me);
    updatePlayerVision(world, me); // daylight surface, tick 0 is midnight: radius 4.5 — walk in hops
    const target = { x: 9, y: 5 };
    let steps = 0;
    for (; steps < 20; steps++) {
      const step = nextTravelStep(world, me, target);
      if (!step) break;
      advancePlayerTurn(world, step);
    }
    expect(me.pos).toEqual(target);
    expect(steps).toBe(4);
  });

  it("does not path through tiles never seen", () => {
    const world = createWorld(30, 30, 1);
    const me = human(5, 5);
    world.agents.push(me);
    updatePlayerVision(world, me);
    // 20 tiles away: far outside anything seen — no plan, not even a first step.
    expect(nextTravelStep(world, me, { x: 25, y: 5 })).toBeUndefined();
  });

  it("routes around a wall it knows about", () => {
    const world = createWorld(20, 20, 1);
    for (let y = 3; y <= 7; y++) setTile(world, "surface", 7, y, "wall");
    const me = human(5, 5);
    world.agents.push(me);
    updatePlayerVision(world, me);
    // Pretend the player has seen this whole area.
    const explored = (me.vision!.explored[visionScope(world, "surface")] ??= new Set());
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) explored.add(tileIndex(world, x, y));
    const first = nextTravelStep(world, me, { x: 9, y: 5 })!;
    expect(first.kind).toBe("move");
    // The first step goes around the wall's end, not straight into it.
    expect(first.kind === "move" && first.dy !== 0).toBe(true);
    let guard = 0;
    while (guard++ < 30 && (me.pos.x !== 9 || me.pos.y !== 5)) {
      const step = nextTravelStep(world, me, { x: 9, y: 5 });
      if (!step) break;
      advancePlayerTurn(world, step);
    }
    expect(me.pos).toEqual({ x: 9, y: 5 });
  });

  it("tapping a wall walks to the tile beside it; tapping yourself is nothing", () => {
    const world = createWorld(20, 20, 1);
    setTile(world, "surface", 8, 5, "wall");
    const me = human(5, 5);
    world.agents.push(me);
    updatePlayerVision(world, me);
    const explored = (me.vision!.explored[visionScope(world, "surface")] ??= new Set());
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) explored.add(tileIndex(world, x, y));
    let guard = 0;
    while (guard++ < 10) {
      const step = nextTravelStep(world, me, { x: 8, y: 5 });
      if (!step) break;
      advancePlayerTurn(world, step);
    }
    expect(Math.max(Math.abs(me.pos.x - 8), Math.abs(me.pos.y - 5))).toBe(1);
    expect(nextTravelStep(world, me, me.pos)).toBeUndefined();
  });

  it("visibleAgentIds lists only living agents in the visible set on the same layer", () => {
    const world = createWorld(20, 20, 1);
    const me = human(5, 5);
    const near: Agent = { ...human(7, 5), id: "near", controlledBy: undefined };
    const far: Agent = { ...human(15, 5), id: "far", controlledBy: undefined };
    const dead: Agent = { ...human(6, 5), id: "dead", controlledBy: undefined, alive: false };
    const below: Agent = { ...human(6, 6), id: "below", controlledBy: undefined, layer: "underground" };
    world.agents.push(me, near, far, dead, below);
    updatePlayerVision(world, me);
    expect([...visibleAgentIds(world, me)]).toEqual(["near"]);
  });
});
