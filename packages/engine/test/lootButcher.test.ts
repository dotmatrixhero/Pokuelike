import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyPlayerAction } from "../src/player.js";
import { carryCapacityOf } from "../src/support.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct ask: "can't loot or butcher dead units. need to be able to -
 * maybe you need a knife to do more but that should be a thing." Two
 * distinct verbs: `loot` takes an item the corpse was already carrying
 * (reuses support.ts's own `applyLooting`, unmodified); `butcher` is a
 * brand-new, one-time real-material harvest off the corpse's own body
 * (meat bare-handed, meat+hide with a flint knife held).
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

function corpse(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "rattata",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    alive: false,
    diedAtTick: 0,
    ...extra,
  };
}

function openWorld(): World {
  return createWorld(20, 20, 1);
}

describe('Direct ask: "can\'t loot... dead units" — loot', () => {
  it("takes one item from an adjacent corpse's own inventory", () => {
    const world = openWorld();
    const me = human(5, 5);
    const c = corpse("c", 5, 6, { inventory: [{ itemKey: "flint", weight: 1, count: 1 }] });
    world.agents.push(me, c);
    expect(applyPlayerAction(world, me, { kind: "loot" })).toBe(true);
    expect(me.inventory).toEqual([{ itemKey: "flint", weight: 1, count: 1 }]);
    expect(c.inventory).toEqual([]);
  });

  it("also works on a merely fainted agent, not just a true kill", () => {
    const world = openWorld();
    const me = human(5, 5);
    const fainted = corpse("f", 5, 6, { alive: undefined, fainted: true, inventory: [{ itemKey: "flint", weight: 1, count: 1 }] });
    world.agents.push(me, fainted);
    expect(applyPlayerAction(world, me, { kind: "loot" })).toBe(true);
    expect(me.inventory?.[0]?.itemKey).toBe("flint");
  });

  it("nothing nearby with any inventory — fails", () => {
    const world = openWorld();
    const me = human(5, 5);
    const c = corpse("c", 5, 6);
    world.agents.push(me, c);
    expect(applyPlayerAction(world, me, { kind: "loot" })).toBe(false);
  });
});

describe('Direct ask: "...or butcher dead units" — butcher', () => {
  it("bare-handed: a truly dead corpse yields meat only", () => {
    const world = openWorld();
    const me = human(5, 5);
    const c = corpse("c", 5, 6);
    world.agents.push(me, c);
    const outcome = applyPlayerAction(world, me, { kind: "butcher" });
    expect(outcome).toBe(true);
    expect(me.lastActionOutcome?.butchered).toEqual([{ itemKey: "meat", count: 1 }]);
    expect(me.inventory?.find((i) => i.itemKey === "meat")?.count).toBe(1);
    expect(c.butchered).toBe(true);
  });

  it('"maybe you need a knife to do more" — a held flint knife yields more (meat and hide)', () => {
    const world = openWorld();
    const me = human(5, 5, { equipment: { held: "flintKnife" } });
    const c = corpse("c", 5, 6);
    world.agents.push(me, c);
    expect(applyPlayerAction(world, me, { kind: "butcher" })).toBe(true);
    expect(me.lastActionOutcome?.butchered).toEqual([
      { itemKey: "meat", count: 2 },
      { itemKey: "hide", count: 1 },
    ]);
  });

  it("a merely fainted agent (not truly dead) cannot be butchered — DESIGN.md's fainted-vs-dead line", () => {
    const world = openWorld();
    const me = human(5, 5);
    const fainted = corpse("f", 5, 6, { alive: undefined, fainted: true });
    world.agents.push(me, fainted);
    expect(applyPlayerAction(world, me, { kind: "butcher" })).toBe(false);
    expect(me.inventory ?? []).toEqual([]);
  });

  it("an already-butchered corpse can't be butchered again", () => {
    const world = openWorld();
    const me = human(5, 5);
    const c = corpse("c", 5, 6, { butchered: true });
    world.agents.push(me, c);
    expect(applyPlayerAction(world, me, { kind: "butcher" })).toBe(false);
  });

  it("nothing dead nearby — fails", () => {
    const world = openWorld();
    const me = human(5, 5);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "butcher" })).toBe(false);
  });

  it("no carry headroom for any of it — fails, and the corpse stays butcherable", () => {
    const world = openWorld();
    const me = human(5, 5);
    const capacity = carryCapacityOf(world, me);
    // Fill the pack to exactly capacity with something else first.
    me.inventory = [{ itemKey: "flint", weight: capacity, count: 1 }];
    const c = corpse("c", 5, 6);
    world.agents.push(me, c);
    expect(applyPlayerAction(world, me, { kind: "butcher" })).toBe(false);
    expect(c.butchered).toBeUndefined();
  });

  it("partial capacity: takes what fits, corpse is still marked used up", () => {
    const world = openWorld();
    const me = human(5, 5, { equipment: { held: "flintKnife" } });
    const capacity = carryCapacityOf(world, me);
    // Room for exactly one more weight-2 item (meat), not two more.
    me.inventory = [{ itemKey: "flint", weight: capacity - 2, count: 1 }];
    const c = corpse("c", 5, 6);
    world.agents.push(me, c);
    expect(applyPlayerAction(world, me, { kind: "butcher" })).toBe(true);
    expect(me.lastActionOutcome?.butchered).toEqual([{ itemKey: "meat", count: 1 }]);
    expect(c.butchered).toBe(true);
  });
});
