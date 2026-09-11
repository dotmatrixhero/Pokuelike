import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyPlayerAction } from "../src/player.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct report: "I can't apply poultice to heal units." Poultice
 * (crafting.ts: herbs + lichen) was craftable but had no way to actually
 * use it at all — CRAFTING_REFERENCE.md's own basic-effect table: "Heal
 * away from shelter."
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
    inventory: [{ itemKey: "poultice", weight: 1, count: 1 }],
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
    behavior: "follow",
    maxHp: 20,
    hp: 20,
    followingId: "me",
    ...extra,
  };
}

function openWorld(): World {
  return createWorld(20, 20, 1);
}

describe('Direct report: "I can\'t apply poultice to heal units"', () => {
  it("heals the player themselves when hurt and nobody else is around, consuming one poultice", () => {
    const world = openWorld();
    const me = human(5, 5, { hp: 10 });
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "usePoultice" })).toBe(true);
    expect(me.hp).toBe(16); // 10 + 20*0.3
    expect(me.inventory).toEqual([]);
    expect(me.lastActionOutcome?.healed).toEqual({ targetId: "me", amount: 6 });
  });

  it("prefers a hurt bonded follower adjacent to the player over the player themselves — \"heal units\"", () => {
    const world = openWorld();
    const me = human(5, 5, { hp: 10 }); // player is also hurt, but the follower is preferred
    const ally = follower("ally", 5, 6, { hp: 8 });
    world.agents.push(me, ally);
    expect(applyPlayerAction(world, me, { kind: "usePoultice" })).toBe(true);
    expect(ally.hp).toBe(14); // 8 + 20*0.3
    expect(me.hp).toBe(10); // untouched
  });

  it("clamps to maxHp — never overheals", () => {
    const world = openWorld();
    const me = human(5, 5, { hp: 19 });
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "usePoultice" })).toBe(true);
    expect(me.hp).toBe(20);
    expect(me.lastActionOutcome?.healed).toEqual({ targetId: "me", amount: 1 });
  });

  it("fails without a carried poultice — nothing consumed, nobody healed", () => {
    const world = openWorld();
    const me = human(5, 5, { hp: 10, inventory: [] });
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "usePoultice" })).toBe(false);
    expect(me.hp).toBe(10);
  });

  it("fails when nobody in reach is actually hurt — the poultice is not wasted", () => {
    const world = openWorld();
    const me = human(5, 5, { hp: 20 });
    const ally = follower("ally", 5, 6, { hp: 20 });
    world.agents.push(me, ally);
    expect(applyPlayerAction(world, me, { kind: "usePoultice" })).toBe(false);
    expect(me.inventory).toEqual([{ itemKey: "poultice", weight: 1, count: 1 }]);
  });

  it("a non-follower nearby (not bonded to the player) is never a valid target", () => {
    const world = openWorld();
    const me = human(5, 5, { hp: 20 }); // player is fine
    const stranger = follower("stranger", 5, 6, { hp: 5, followingId: undefined });
    world.agents.push(me, stranger);
    expect(applyPlayerAction(world, me, { kind: "usePoultice" })).toBe(false);
    expect(stranger.hp).toBe(5);
  });
});
