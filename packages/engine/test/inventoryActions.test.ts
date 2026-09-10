import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyPlayerAction } from "../src/player.js";
import { addItem, countOf } from "../src/inventory.js";
import { harvestableAt, FOOD_MATERIAL_IDS, foodNutritionMultiplierOf } from "../src/harvest.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct reports: "can't drop items or use or equip them?" and "We need
 * distinct crop. Need to add to inventory as it's own thing." A gathered/
 * offered food tile used to always collapse to the single generic "food"
 * material (Berries) regardless of what actually grew there — this suite
 * covers the fix (`harvestableAt` hands back the tile's real crop, `eat`/
 * `offer` recognize any of them, not just literal "food") plus the new
 * `drop` action.
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
  world.items = { club: { key: "club", name: "Club", weight: 3, slot: "held" }, cloak: { key: "cloak", name: "Cloak", weight: 2, slot: "worn" } };
  return world;
}

describe('Direct report: "can\'t drop items" — the drop action', () => {
  it("discards one of a carried material, freeing its weight", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "lichen", 3, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "drop", itemKey: "lichen" })).toBe(true);
    expect(countOf(me, "lichen")).toBe(2);
  });

  it("fails (costs the turn, changes nothing) when you don't carry it", () => {
    const world = openWorld();
    const me = human(5, 5);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "drop", itemKey: "lichen" })).toBe(false);
  });

  it("dropping the last held item clears the held slot and resyncs moves", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "club", 1, 3);
    world.agents.push(me);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "club" });
    expect(me.equipment?.held).toBe("club");
    expect(applyPlayerAction(world, me, { kind: "drop", itemKey: "club" })).toBe(true);
    expect(countOf(me, "club")).toBe(0);
    expect(me.equipment?.held).toBeUndefined();
  });

  it("dropping the last worn item clears the worn slot", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "cloak", 1, 2);
    world.agents.push(me);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "cloak" });
    expect(applyPlayerAction(world, me, { kind: "drop", itemKey: "cloak" })).toBe(true);
    expect(me.equipment?.worn).toBeUndefined();
  });

  it("dropping one of a stack of two keeps the equipped one equipped", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "club", 2, 3);
    world.agents.push(me);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "club" });
    expect(applyPlayerAction(world, me, { kind: "drop", itemKey: "club" })).toBe(true);
    expect(countOf(me, "club")).toBe(1);
    expect(me.equipment?.held).toBe("club");
  });
});

describe('Direct report: "We need distinct crop... add to inventory as its own thing"', () => {
  it("harvestableAt hands back the tile's real crop, not generic food", () => {
    const world = openWorld();
    setTile(world, "surface", 5, 5, "food", 0, "potato");
    expect(harvestableAt(world, "surface", { x: 5, y: 5 })).toEqual(["potato"]);
  });

  it("a food tile with no real crop flavor still falls back to generic food", () => {
    const world = openWorld();
    setTile(world, "surface", 5, 5, "food");
    tileAt(world, "surface", 5, 5)!.stock = 1;
    expect(harvestableAt(world, "surface", { x: 5, y: 5 })).toEqual(["food"]);
  });

  it("FOOD_MATERIAL_IDS covers every real crop plus the generic fallback", () => {
    expect(FOOD_MATERIAL_IDS).toContain("food");
    expect(FOOD_MATERIAL_IDS).toContain("potato");
    expect(FOOD_MATERIAL_IDS).toContain("pumpkin");
    expect(FOOD_MATERIAL_IDS).toContain("herbs");
  });

  it("eating a carried Potato (not literally 'food') works, at Potato's own nutrition multiplier", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "potato", 1, 1);
    world.agents.push(me);
    me.needs.hunger = 0.3;
    const before = me.needs.hunger;
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(true);
    expect(countOf(me, "potato")).toBe(0);
    expect(me.needs.hunger).toBeGreaterThan(before);
    expect(foodNutritionMultiplierOf("potato")).toBeGreaterThan(1); // Potato is a richer crop than a plain berry
  });

  it("offering a carried Apple sets the ground tile's flavor to apple, not blank", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "apple", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "offer" })).toBe(true);
    const offered = world.tiles.surface.find((t) => t.offeredBy === "me")!;
    expect(offered.flavor).toBe("apple");
  });

  it("offering the generic 'food' fallback leaves the ground tile flavorless, same as before distinct crops", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "food", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "offer" })).toBe(true);
    const offered = world.tiles.surface.find((t) => t.offeredBy === "me")!;
    expect(offered.flavor).toBeUndefined();
  });

  it("eat/offer fail with an empty pack, same as before — no food material at all", () => {
    const world = openWorld();
    const me = human(5, 5);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(false);
    expect(applyPlayerAction(world, me, { kind: "offer" })).toBe(false);
  });

  it("an explicit itemKey eats exactly that stack, not whatever sorts first among several foods carried", () => {
    const world = openWorld();
    const me = human(5, 5);
    // "apple" sorts ahead of "potato" in FOOD_MATERIAL_IDS' own crop order —
    // a bare {kind: "eat"} would silently eat the apple instead.
    addItem(me, "apple", 1, 1);
    addItem(me, "potato", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "eat", itemKey: "potato" })).toBe(true);
    expect(countOf(me, "potato")).toBe(0);
    expect(countOf(me, "apple")).toBe(1);
  });

  it("an explicit itemKey offers exactly that stack, and its flavor reaches the ground tile", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "apple", 1, 1);
    addItem(me, "potato", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "offer", itemKey: "potato" })).toBe(true);
    expect(countOf(me, "potato")).toBe(0);
    expect(countOf(me, "apple")).toBe(1);
    const offered = world.tiles.surface.find((t) => t.offeredBy === "me")!;
    expect(offered.flavor).toBe("potato");
  });

  it("an explicit itemKey for something not actually carried fails rather than silently substituting another food", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "apple", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "eat", itemKey: "potato" })).toBe(false);
    expect(countOf(me, "apple")).toBe(1);
  });

  it("an explicit itemKey that isn't a food material at all fails", () => {
    const world = openWorld();
    const me = human(5, 5);
    addItem(me, "lichen", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "eat", itemKey: "lichen" })).toBe(false);
    expect(countOf(me, "lichen")).toBe(1);
  });
});

describe('Direct ask: "can you make berries and tomatoes and apples help thirst too"', () => {
  it("eating a carried Apple restores both hunger and thirst", () => {
    const world = openWorld();
    const me = human(5, 5);
    me.needs.hunger = 0.3;
    me.needs.thirst = 0.3;
    addItem(me, "apple", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(true);
    expect(me.needs.hunger).toBeGreaterThan(0.3);
    expect(me.needs.thirst).toBeGreaterThan(0.3);
  });

  it("eating a carried Potato restores hunger only — Potato sets no thirstRelief", () => {
    const world = openWorld();
    const me = human(5, 5);
    me.needs.hunger = 0.3;
    me.needs.thirst = 0.3;
    addItem(me, "potato", 1, 1);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(true);
    expect(me.needs.hunger).toBeGreaterThan(0.3);
    expect(me.needs.thirst).toBe(0.3);
  });

  it("eating a Tomato tile underfoot also restores thirst (the tile-eat branch, not just the pack)", () => {
    const world = openWorld();
    const me = human(5, 5, { needs: createNeeds({ hunger: 0.3, thirst: 0.3 }) });
    setTile(world, "surface", 5, 5, "food", 0, "tomato");
    tileAt(world, "surface", 5, 5)!.stock = 1;
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(true);
    expect(me.needs.hunger).toBeGreaterThan(0.3);
    expect(me.needs.thirst).toBeGreaterThan(0.3);
  });
});
