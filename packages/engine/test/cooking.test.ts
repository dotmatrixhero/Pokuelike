import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyPlayerAction, nearFire } from "../src/player.js";
import { applyPlayerFeedingBonus } from "../src/needs.js";
import { addItem, countOf } from "../src/inventory.js";
import { FIRE_BURN_TICKS } from "../src/fire.js";
import { rapportScore } from "../src/rapport.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct ask: "you know im gonna have to add cooking lol. building a fire
 * you can deploy (ex. torch + 2x wood or something) to cook, and while
 * near you can craft with combos of crops and berries. cooked food gets
 * you more rapport when offered. heals as well as satisfies hunger." Plus
 * the scoping follow-up: fixed named dishes, and a fire that "burns out
 * but you can feed it more wood to increase fuel."
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

function openWorld(): World {
  const world = createWorld(20, 20, 1);
  world.items = {
    torch: { key: "torch", name: "Torch", weight: 2, slot: "held", light: true },
    roastedApple: { key: "roastedApple", name: "Roasted Apple", weight: 1, cooked: { healFraction: 0.15, rapportMultiplier: 2 } },
  };
  return world;
}

describe('Direct ask: "building a fire you can deploy... to cook" — lightFire', () => {
  it("requires a held torch and 2 deadwood, consumes only the deadwood", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "torch", 1, 2);
    addItem(me, "deadwood", 2, 2);
    world.agents.push(me);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "torch" });
    expect(applyPlayerAction(world, me, { kind: "lightFire", dx: 1, dy: 0 })).toBe(true);
    expect(countOf(me, "deadwood")).toBe(0);
    expect(me.equipment?.held).toBe("torch"); // the tool, not consumed
    expect(tileAt(world, "surface", 6, 5)?.terrain).toBe("fire");
    expect(tileAt(world, "surface", 6, 5)?.burnTicksRemaining).toBe(FIRE_BURN_TICKS);
  });

  it("fails without a held torch", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "deadwood", 2, 2);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "lightFire", dx: 1, dy: 0 })).toBe(false);
    expect(tileAt(world, "surface", 6, 5)?.terrain).not.toBe("fire");
  });

  it("fails with fewer than 2 deadwood", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "torch", 1, 2);
    addItem(me, "deadwood", 1, 2);
    world.agents.push(me);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "torch" });
    expect(applyPlayerAction(world, me, { kind: "lightFire", dx: 1, dy: 0 })).toBe(false);
    expect(countOf(me, "deadwood")).toBe(1);
  });

  it("lights on bare floor — deliberately bypasses fire.ts's own FLAMMABLE_TERRAIN gate (fueled by carried wood, not the ground)", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "torch", 1, 2);
    addItem(me, "deadwood", 2, 2);
    world.agents.push(me);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "torch" });
    expect(tileAt(world, "surface", 6, 5)?.terrain).toBe("floor"); // not flammable per fire.ts's own rules
    expect(applyPlayerAction(world, me, { kind: "lightFire", dx: 1, dy: 0 })).toBe(true);
    expect(tileAt(world, "surface", 6, 5)?.terrain).toBe("fire");
  });

  it("fails against water or a wall", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "torch", 1, 2);
    addItem(me, "deadwood", 4, 2);
    world.agents.push(me);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "torch" });
    setTile(world, "surface", 6, 5, "water");
    expect(applyPlayerAction(world, me, { kind: "lightFire", dx: 1, dy: 0 })).toBe(false);
    setTile(world, "surface", 6, 5, "wall");
    expect(applyPlayerAction(world, me, { kind: "lightFire", dx: 1, dy: 0 })).toBe(false);
    expect(countOf(me, "deadwood")).toBe(4); // neither attempt spent any wood
  });

  it('feeding an already-burning tile ADDS fuel rather than just refreshing it — direct follow-up: "feed it more wood to increase fuel"', () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "torch", 1, 2);
    addItem(me, "deadwood", 4, 2);
    world.agents.push(me);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "torch" });
    applyPlayerAction(world, me, { kind: "lightFire", dx: 1, dy: 0 });
    const tile = tileAt(world, "surface", 6, 5)!;
    tile.burnTicksRemaining = 3; // let it burn down some
    expect(applyPlayerAction(world, me, { kind: "lightFire", dx: 1, dy: 0 })).toBe(true);
    expect(tile.burnTicksRemaining).toBe(3 + FIRE_BURN_TICKS); // additive, not reset to FIRE_BURN_TICKS alone
  });
});

describe('Direct ask: "while near you can craft with combos of crops and berries" — requiresNearFire', () => {
  it("nearFire is false with nothing burning nearby, true within its own radius", () => {
    const world = openWorld();
    const me = human(5, 5);
    world.agents.push(me);
    expect(nearFire(world, me)).toBe(false);
    setTile(world, "surface", 6, 6, "fire");
    expect(nearFire(world, me)).toBe(true);
  });

  it("a recipe with requiresNearFire fails to craft without a fire nearby, and succeeds once one is", () => {
    const world = openWorld();
    world.recipes = { test_cooked: { id: "test_cooked", name: "Test Dish", inputs: [], output: { itemKey: "test_cooked", count: 1 }, turns: 1, knownAtStart: true, requiresNearFire: true } };
    const me = human(5, 5, { knownRecipes: ["test_cooked"] });
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "craft", recipeId: "test_cooked" })).toBe(false);
    setTile(world, "surface", 5, 6, "fire");
    expect(applyPlayerAction(world, me, { kind: "craft", recipeId: "test_cooked" })).toBe(true);
  });

  it("an ordinary recipe (no requiresNearFire) is unaffected by there being no fire anywhere", () => {
    const world = openWorld();
    world.recipes = { test_plain: { id: "test_plain", name: "Test Plain", inputs: [], output: { itemKey: "test_plain", count: 1 }, turns: 1, knownAtStart: true } };
    const me = human(5, 5, { knownRecipes: ["test_plain"] });
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "craft", recipeId: "test_plain" })).toBe(true);
  });
});

describe('Direct ask: "cooked food gets you more rapport when offered. heals as well as satisfies hunger"', () => {
  it("eating a carried cooked dish heals in addition to satisfying hunger", () => {
    const world = openWorld();
    const me = human(5, 5, { hp: 10, maxHp: 20, needs: createNeeds({ hunger: 0.3 }) });
    addItem(me, "roastedApple", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(true);
    expect(me.needs.hunger).toBeGreaterThan(0.3);
    expect(me.hp).toBeGreaterThan(10);
    expect(me.hp).toBeCloseTo(10 + 20 * 0.15, 5);
  });

  it("eating a cooked dish placed on a tile (offered, then eaten while standing on it) also heals", () => {
    const world = openWorld();
    const me = human(5, 5, { hp: 10, maxHp: 20 });
    world.agents.push(me);
    setTile(world, "surface", 5, 5, "food", 0, "roastedApple");
    tileAt(world, "surface", 5, 5)!.stock = 1;
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(true);
    expect(me.hp).toBeGreaterThan(10);
  });

  it("offering a cooked dish grants a wild eater a bigger rapport bonus than an ordinary food item would", () => {
    const world = openWorld();
    const me = human(5, 5);
    world.agents.push(me);
    const eater: Agent = {
      id: "eater",
      species: "bulbasaur",
      pos: { x: 0, y: 0 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
      maxHp: 20,
      hp: 20,
    };
    const eaterPlain: Agent = { ...eater, id: "eaterPlain" };
    world.agents.push(eater, eaterPlain);

    applyPlayerFeedingBonus(world, eater, me, () => 0.999, 2); // cooked, rapportMultiplier 2
    applyPlayerFeedingBonus(world, eaterPlain, me, () => 0.999, 1); // ordinary food, multiplier 1

    const cookedScore = rapportScore(eater, "me", world.tick);
    const plainScore = rapportScore(eaterPlain, "me", world.tick);
    expect(cookedScore).toBeCloseTo(plainScore * 2, 5);
  });
});
