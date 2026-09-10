import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { ACTION_THRESHOLD, advancePlayerTurn, tickWorld } from "../src/simulation.js";
import { applyPlayerAction, findPlayer } from "../src/player.js";
import type { Agent } from "../src/types.js";

function human(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "human",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
    ...extra,
  };
}

describe("player agent (ROADMAP M0)", () => {
  it("findPlayer returns the controlled agent and nothing else", () => {
    const world = createWorld(8, 8, 1);
    const npc: Agent = { ...human("npc", 1, 1), controlledBy: undefined };
    const me = human("me", 2, 2);
    world.agents.push(npc, me);
    expect(findPlayer(world)?.id).toBe("me");
  });

  it("a move steps to the neighbour; a blocked move is a no-op that still returns false", () => {
    const world = createWorld(8, 8, 1);
    const me = human("me", 3, 3);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "move", dx: 1, dy: 1 })).toBe(true);
    expect(me.pos).toEqual({ x: 4, y: 4 });

    setTile(world, "surface", 5, 5, "wall");
    expect(applyPlayerAction(world, me, { kind: "move", dx: 1, dy: 1 })).toBe(false);
    expect(me.pos).toEqual({ x: 4, y: 4 });
  });

  it("tickWorld does NOT run the behaviour tree for the player — it sits still with nothing queued", () => {
    const world = createWorld(12, 12, 1);
    const me = human("me", 5, 5, { needs: createNeeds({ thirst: 0.1, hunger: 0.1 }) });
    world.agents.push(me);
    for (let i = 0; i < 30; i++) tickWorld(world);
    // A sim-driven agent this thirsty would have gone looking for water.
    expect(me.pos).toEqual({ x: 5, y: 5 });
    expect(me.behavior).toBe("idle");
  });

  it("advancePlayerTurn consumes the action on the tick the player's energy is ready, then stops", () => {
    const world = createWorld(12, 12, 1);
    const me = human("me", 5, 5);
    world.agents.push(me);

    const ticks = advancePlayerTurn(world, { kind: "move", dx: 1, dy: 0 });

    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(50);
    expect(me.pos).toEqual({ x: 6, y: 5 });
    expect(me.queuedAction).toBeUndefined();
    expect(world.tick).toBe(ticks);
  });

  it("the world keeps moving between player turns — a slower human lets more ticks pass per step", () => {
    const fastWorld = createWorld(12, 12, 1);
    const fast = human("fast", 5, 5, { stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 120 } });
    fastWorld.agents.push(fast);
    const slowWorld = createWorld(12, 12, 1);
    const slow = human("slow", 5, 5, { stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 20 } });
    slowWorld.agents.push(slow);

    const fastTicks = advancePlayerTurn(fastWorld, { kind: "wait" });
    const slowTicks = advancePlayerTurn(slowWorld, { kind: "wait" });

    expect(slowTicks).toBeGreaterThan(fastTicks);
  });

  it("needs still decay on the player — it is an ordinary agent to the sim", () => {
    const world = createWorld(12, 12, 1);
    const me = human("me", 5, 5, { needs: createNeeds({ hunger: 1, thirst: 1 }) });
    world.agents.push(me);
    for (let i = 0; i < 10; i++) advancePlayerTurn(world, { kind: "wait" });
    expect(me.needs.hunger).toBeLessThan(1);
    expect(me.needs.thirst).toBeLessThan(1);
  });

  it("a dead player never spins the gate", () => {
    const world = createWorld(8, 8, 1);
    const me = human("me", 2, 2, { alive: false });
    world.agents.push(me);
    expect(advancePlayerTurn(world, { kind: "wait" })).toBe(0);
  });
});

// Keep the threshold import honest — the gate's whole premise is that it exists.
void ACTION_THRESHOLD;
