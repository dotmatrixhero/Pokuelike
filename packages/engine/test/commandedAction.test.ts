import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyCommandedAction, tickAgentAction } from "../src/needs.js";
import { applyPlayerAction } from "../src/player.js";
import { countOf } from "../src/inventory.js";
import type { Agent, MoveSpec, World } from "../src/types.js";

/**
 * Direct ask: "even before m7... it should be able to have, under 'attack'
 * option a sub menu show up to select your bonded pokemon if its within the
 * same zone as you, and you can select a move and target a space with it -
 * it then uses its own pathfinding to get to the right position and use
 * it." Tests the engine half only: `player.ts`'s new `"command"` case
 * (issuing the order), and `needs.ts`'s `applyCommandedAction` (the
 * partner's own action ticks carrying it out) — the web UI's chooser/
 * targeting is a separate, unverified-here layer.
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
    stats: { hp: 20, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
    ...extra,
  };
}

function partner(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "sandshrew",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    followingId: "me",
    types: ["ground"],
    maxHp: 22,
    hp: 22,
    stats: { hp: 22, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
    ...extra,
  };
}

function prey(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "rattata",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    types: ["normal"],
    maxHp: 25,
    hp: 25,
    stats: { hp: 25, attack: 25, defense: 25, spAttack: 25, spDefense: 25, speed: 30 },
    ...extra,
  };
}

const CLAW: MoveSpec = {
  id: "test_claw",
  name: "Claw",
  shape: { kind: "point" },
  type: "ground",
  category: "physical",
  power: 40,
  accuracy: -1,
  cooldownTicks: 4,
  range: { min: 0, max: 1 },
};

const DIG: MoveSpec = {
  id: "test_dig",
  name: "Dig",
  shape: { kind: "point" },
  type: "ground",
  category: "status",
  power: 0,
  accuracy: -1,
  cooldownTicks: 3,
  range: { min: 0, max: 1 },
  utilityMove: true,
  terrainEffect: { from: ["tree"], to: "floor", yields: "deadwood" },
};

function openWorld(): World {
  return createWorld(20, 20, 1);
}

describe("player.ts: command case — issuing the order", () => {
  it("sets commandedAction on a following partner that knows the move", () => {
    const world = openWorld();
    const me = human(5, 5);
    const s = partner("s", 6, 5, { moves: [CLAW] });
    world.agents.push(me, s);
    expect(applyPlayerAction(world, me, { kind: "command", agentId: "s", moveId: "test_claw", target: { x: 9, y: 5 } })).toBe(true);
    expect(s.commandedAction).toEqual({ moveId: "test_claw", target: { x: 9, y: 5 } });
  });

  it("fails when the target agent is not following the player", () => {
    const world = openWorld();
    const me = human(5, 5);
    const notFollowing = partner("s", 6, 5, { moves: [CLAW], followingId: undefined });
    world.agents.push(me, notFollowing);
    expect(applyPlayerAction(world, me, { kind: "command", agentId: "s", moveId: "test_claw", target: { x: 9, y: 5 } })).toBe(false);
    expect(notFollowing.commandedAction).toBeUndefined();
  });

  it("fails when the partner does not know that move", () => {
    const world = openWorld();
    const me = human(5, 5);
    const s = partner("s", 6, 5, { moves: [] });
    world.agents.push(me, s);
    expect(applyPlayerAction(world, me, { kind: "command", agentId: "s", moveId: "test_claw", target: { x: 9, y: 5 } })).toBe(false);
    expect(s.commandedAction).toBeUndefined();
  });
});

describe("needs.ts: applyCommandedAction — carrying the order out over the partner's own ticks", () => {
  it("paths toward a target out of range, switching behavior to fight, without acting yet", () => {
    const world = openWorld();
    const s = partner("s", 5, 5, { moves: [CLAW], commandedAction: { moveId: "test_claw", target: { x: 10, y: 5 } } });
    world.agents.push(s);
    const before = s.pos.x;
    expect(applyCommandedAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.pos.x).toBeGreaterThan(before);
    expect(s.behavior).toBe("fight");
    expect(s.commandedAction).toBeDefined(); // order still standing — not in range yet
  });

  it("closes distance over several ticks, then resolves the move against a living target at the tile and clears the order", () => {
    const world = openWorld();
    const s = partner("s", 5, 5, { moves: [CLAW], commandedAction: { moveId: "test_claw", target: { x: 9, y: 5 } } });
    const target = prey("rat", 9, 5);
    world.agents.push(s, target);
    const before = target.hp;
    for (let i = 0; i < 10 && s.commandedAction; i++) tickAgentAction(world, s);
    expect(s.commandedAction).toBeUndefined();
    expect(target.hp).toBeLessThan(before!);
    expect(s.moveCooldowns?.test_claw).toBeGreaterThan(0);
  });

  it("with no living target at the tile, resolves the move's terrain effect there instead — and grants no item, since the follower isn't the player", () => {
    const world = openWorld();
    const s = partner("s", 8, 5, { moves: [DIG], commandedAction: { moveId: "test_dig", target: { x: 9, y: 5 } } });
    world.agents.push(s);
    setTile(world, "surface", 9, 5, "tree");
    expect(applyCommandedAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.commandedAction).toBeUndefined();
    expect(tileAt(world, "surface", 9, 5)?.terrain).toBe("floor");
    expect(countOf(s, "deadwood")).toBe(0);
  });

  it("an urgent need pauses the order rather than discarding it", () => {
    const world = openWorld();
    const s = partner("s", 5, 5, {
      moves: [CLAW],
      commandedAction: { moveId: "test_claw", target: { x: 9, y: 5 } },
      needs: createNeeds({ thirst: 0.05 }),
    });
    world.agents.push(s);
    expect(applyCommandedAction(world, s, undefined, undefined, Math.random)).toBe(false);
    expect(s.commandedAction).toEqual({ moveId: "test_claw", target: { x: 9, y: 5 } });
    expect(s.pos).toEqual({ x: 5, y: 5 });
  });

  it("a move no longer known clears the order without acting", () => {
    const world = openWorld();
    const s = partner("s", 5, 5, { moves: [], commandedAction: { moveId: "test_claw", target: { x: 9, y: 5 } } });
    world.agents.push(s);
    expect(applyCommandedAction(world, s, undefined, undefined, Math.random)).toBe(false);
    expect(s.commandedAction).toBeUndefined();
  });

  it("in range but the move is on cooldown: the order stands, no double-resolve", () => {
    const world = openWorld();
    const s = partner("s", 8, 5, {
      moves: [CLAW],
      commandedAction: { moveId: "test_claw", target: { x: 9, y: 5 } },
      moveCooldowns: { test_claw: 2 },
    });
    const target = prey("rat", 9, 5);
    world.agents.push(s, target);
    const before = target.hp;
    expect(applyCommandedAction(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.commandedAction).toBeDefined();
    expect(target.hp).toBe(before);
  });

  it("no order queued is a plain no-op", () => {
    const world = openWorld();
    const s = partner("s", 5, 5, { moves: [CLAW] });
    world.agents.push(s);
    expect(applyCommandedAction(world, s, undefined, undefined, Math.random)).toBe(false);
  });
});
