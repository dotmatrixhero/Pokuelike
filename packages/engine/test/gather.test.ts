import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { advancePlayerTurn, tickWorld } from "../src/simulation.js";
import { applyPlayerAction, findPlayer, TORCH_FUEL_TICKS } from "../src/player.js";
import { addItem, carriedWeight, countOf, removeItem } from "../src/inventory.js";
import { GATHER_TURNS, HARVEST_REGROW_TICKS, HARVEST_YIELD_PER_TILE, harvestableAt, harvestLeft } from "../src/harvest.js";
import { updatePlayerVision } from "../src/vision.js";
import type { Agent, World } from "../src/types.js";

function human(x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x, y },
    layer: "underground",
    homeLayer: "underground",
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    maxHp: 20,
    hp: 20,
    stats: { hp: 20, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
    ...extra,
  };
}

/** A cave with water at (10,10) and a sunbeam at (20,10); the player between. */
function cave(): World {
  const world = createWorld(30, 30, 1);
  setTile(world, "underground", 10, 10, "water");
  setTile(world, "underground", 20, 10, "sunbeam");
  world.recipes = {
    fiber: { id: "fiber", name: "Fiber", inputs: [{ itemKey: "lichen", count: 1 }], output: { itemKey: "fiber", count: 1 }, turns: 3, knownAtStart: true },
    torch: { id: "torch", name: "Torch", inputs: [{ itemKey: "deadwood", count: 1 }, { itemKey: "fiber", count: 1 }], output: { itemKey: "torch", count: 1 }, turns: 5, knownAtStart: true },
    knife: { id: "knife", name: "Flint knife", inputs: [{ itemKey: "flint", count: 1 }], output: { itemKey: "knife", count: 1 }, turns: 10, knownAtStart: false },
  };
  world.items = {
    fiber: { key: "fiber", name: "Fiber", weight: 1 },
    torch: { key: "torch", name: "Torch", weight: 2, slot: "held", light: true },
    knife: { key: "knife", name: "Flint knife", weight: 2, slot: "held" },
  };
  return world;
}

describe("inventory stacks", () => {
  it("merges into one stack per key, keeps order, refuses to remove more than held", () => {
    const me = human(1, 1);
    addItem(me, "lichen", 2, 1);
    addItem(me, "deadwood", 1, 2);
    addItem(me, "lichen", 1, 1);
    expect(me.inventory!.map((i) => `${i.itemKey}x${i.count}`)).toEqual(["lichenx3", "deadwoodx1"]);
    expect(carriedWeight(me)).toBe(5);
    expect(removeItem(me, "lichen", 4)).toBe(false);
    expect(countOf(me, "lichen")).toBe(3);
    expect(removeItem(me, "lichen", 3)).toBe(true);
    expect(me.inventory!.map((i) => i.itemKey)).toEqual(["deadwood"]);
  });
});

describe("harvestableAt", () => {
  it("lichen near cave water, deadwood near a sunbeam, flint on rocky ground, nothing on bare rock", () => {
    const world = cave();
    expect(harvestableAt(world, "underground", { x: 12, y: 10 })).toEqual(["lichen"]);
    expect(harvestableAt(world, "underground", { x: 19, y: 10 })).toEqual(["deadwood"]);
    // (17,10) is 7 from the water and 3 from the sunbeam: bare rock.
    expect(harvestableAt(world, "underground", { x: 17, y: 10 })).toEqual([]);
    tileAt(world, "underground", 17, 10)!.groundType = "rocky";
    expect(harvestableAt(world, "underground", { x: 17, y: 10 })).toEqual(["flint"]);
    // Plants over the floor do not hide what grows there: flora near water still yields lichen.
    setTile(world, "underground", 12, 11, "flora");
    expect(harvestableAt(world, "underground", { x: 12, y: 11 })).toEqual(["lichen"]);
    // Surface floor near water is not a lichen source; a sunbeam still gives deadwood.
    setTile(world, "surface", 5, 5, "water");
    expect(harvestableAt(world, "surface", { x: 6, y: 5 })).toEqual([]);
  });
});

describe("gather (ROADMAP M5)", () => {
  it("is a time-spend: GATHER_TURNS turns, then materials land in the pack and the tile remembers", () => {
    const world = cave();
    const me = human(12, 10);
    world.agents.push(me);
    expect(advancePlayerTurn(world, { kind: "gather" })).toBeGreaterThan(0);
    expect(me.activity).toMatchObject({ kind: "gather", turnsLeft: GATHER_TURNS });
    expect(countOf(me, "lichen")).toBe(0);
    for (let i = 0; i < GATHER_TURNS; i++) advancePlayerTurn(world, { kind: "continue" });
    expect(me.activity).toBeUndefined();
    expect(countOf(me, "lichen")).toBe(1);
    expect(me.lastActionOutcome).toMatchObject({ ok: true, completed: "gather", gathered: [{ itemKey: "lichen", count: 1 }] });
    expect(harvestLeft(world, "underground", me.pos)).toBe(HARVEST_YIELD_PER_TILE - 1);
  });

  it("a bare tile refuses; a move mid-gather abandons it with nothing gained", () => {
    const world = cave();
    const me = human(12, 10);
    world.agents.push(me);
    advancePlayerTurn(world, { kind: "gather" });
    advancePlayerTurn(world, { kind: "continue" });
    advancePlayerTurn(world, { kind: "move", dx: 1, dy: 0 });
    expect(me.activity).toBeUndefined();
    expect(countOf(me, "lichen")).toBe(0);
    // Nothing grows on bare rock (7 from water, 3 from the sunbeam).
    me.pos = { x: 17, y: 10 };
    advancePlayerTurn(world, { kind: "gather" });
    expect(me.lastActionOutcome).toMatchObject({ action: { kind: "gather" }, ok: false });
    expect(me.activity).toBeUndefined();
  });

  it("three takes empty a tile; it regrows one take every HARVEST_REGROW_TICKS", () => {
    const world = cave();
    const me = human(12, 10);
    world.agents.push(me);
    for (let take = 0; take < HARVEST_YIELD_PER_TILE; take++) {
      advancePlayerTurn(world, { kind: "gather" });
      for (let i = 0; i < GATHER_TURNS; i++) advancePlayerTurn(world, { kind: "continue" });
    }
    expect(countOf(me, "lichen")).toBe(HARVEST_YIELD_PER_TILE);
    expect(harvestLeft(world, "underground", me.pos)).toBe(0);
    expect(applyPlayerAction(world, me, { kind: "gather" })).toBe(false);
    const until = Math.ceil(world.tick / HARVEST_REGROW_TICKS) * HARVEST_REGROW_TICKS;
    while (world.tick < until) tickWorld(world);
    expect(harvestLeft(world, "underground", me.pos)).toBe(1);
  });

  it("refuses when the pack is full", () => {
    const world = cave();
    const me = human(12, 10, { maxHp: 2 }); // capacity 3
    world.agents.push(me);
    addItem(me, "deadwood", 2, 2);
    expect(applyPlayerAction(world, me, { kind: "gather" })).toBe(false);
  });
});

describe("craft and equip (ROADMAP M5)", () => {
  it("a known recipe with inputs takes its turns, consumes inputs only at the end, and yields the item", () => {
    const world = cave();
    const me = human(15, 10, { knownRecipes: ["fiber", "torch"] });
    world.agents.push(me);
    addItem(me, "lichen", 1, 1);
    expect(applyPlayerAction(world, me, { kind: "craft", recipeId: "fiber" })).toBe(true);
    advancePlayerTurn(world, { kind: "continue" });
    expect(countOf(me, "lichen")).toBe(1); // not consumed yet
    advancePlayerTurn(world, { kind: "continue" });
    advancePlayerTurn(world, { kind: "continue" });
    expect(countOf(me, "lichen")).toBe(0);
    expect(countOf(me, "fiber")).toBe(1);
    expect(me.lastActionOutcome).toMatchObject({ completed: "craft", crafted: "fiber" });
  });

  it("unknown recipes and missing inputs are refused; cancel keeps materials", () => {
    const world = cave();
    const me = human(15, 10, { knownRecipes: ["fiber"] });
    world.agents.push(me);
    addItem(me, "flint", 1, 1);
    expect(applyPlayerAction(world, me, { kind: "craft", recipeId: "knife" })).toBe(false); // unknown
    expect(applyPlayerAction(world, me, { kind: "craft", recipeId: "fiber" })).toBe(false); // no lichen
    addItem(me, "lichen", 1, 1);
    expect(applyPlayerAction(world, me, { kind: "craft", recipeId: "fiber" })).toBe(true);
    applyPlayerAction(world, me, { kind: "continue" });
    applyPlayerAction(world, me, { kind: "cancel" });
    expect(me.activity).toBeUndefined();
    expect(countOf(me, "lichen")).toBe(1);
  });

  it("a held torch restores the full sight radius in the dark — the world doubles", () => {
    const world = cave();
    const me = human(15, 20, { knownRecipes: ["torch"] }); // mid-map: the disc must not clip
    world.agents.push(me);
    updatePlayerVision(world, me);
    const dark = me.vision!.visible.size;
    addItem(me, "torch", 1, 2);
    expect(applyPlayerAction(world, me, { kind: "equip", itemKey: "torch" })).toBe(true);
    expect(me.equipment?.held).toBe("torch");
    updatePlayerVision(world, me);
    const lit = me.vision!.visible.size;
    expect(lit).toBeGreaterThan(dark * 2);
    expect(applyPlayerAction(world, me, { kind: "stow" })).toBe(true);
    updatePlayerVision(world, me);
    expect(me.vision!.visible.size).toBe(dark);
    // Cannot equip what you do not carry, or what has no slot.
    expect(applyPlayerAction(world, me, { kind: "equip", itemKey: "knife" })).toBe(false);
    addItem(me, "fiber", 1, 1);
    expect(applyPlayerAction(world, me, { kind: "equip", itemKey: "fiber" })).toBe(false);
    console.log(`torch: ${dark} tiles dark -> ${lit} lit`);
  });

  it("a held torch burns TORCH_FUEL_TICKS world ticks, then is used up and the hand is empty", () => {
    const world = cave();
    const me = human(15, 20);
    world.agents.push(me);
    addItem(me, "torch", 2, 2);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "torch" });
    expect(me.torchFuel).toBe(TORCH_FUEL_TICKS);
    while (me.equipment?.held === "torch" && world.tick < TORCH_FUEL_TICKS + 50) advancePlayerTurn(world, { kind: "wait" });
    expect(world.tick).toBeGreaterThanOrEqual(TORCH_FUEL_TICKS);
    expect(world.tick).toBeLessThan(TORCH_FUEL_TICKS + 10);
    expect(countOf(me, "torch")).toBe(1);
    expect(me.equipment?.held).toBeUndefined();
    expect(me.lastNotice?.kind).toBe("torchBurnedOut");
    // Stowing pauses the burn; the second torch starts fresh.
    applyPlayerAction(world, me, { kind: "equip", itemKey: "torch" });
    expect(me.torchFuel).toBe(TORCH_FUEL_TICKS);
    advancePlayerTurn(world, { kind: "wait" });
    const afterOne = me.torchFuel!;
    applyPlayerAction(world, me, { kind: "stow" });
    for (let i = 0; i < 5; i++) advancePlayerTurn(world, { kind: "wait" });
    expect(me.torchFuel).toBe(afterOne);
  });

  it("the whole chain on foot: gather lichen, gather deadwood, craft fiber, craft torch, light it", () => {
    const world = cave();
    const me = human(12, 10, { knownRecipes: ["fiber", "torch"] });
    world.agents.push(me);
    const run = (a: Parameters<typeof advancePlayerTurn>[1]) => advancePlayerTurn(world, a);
    run({ kind: "gather" });
    for (let i = 0; i < GATHER_TURNS; i++) run({ kind: "continue" });
    me.pos = { x: 19, y: 10 };
    run({ kind: "gather" });
    for (let i = 0; i < GATHER_TURNS; i++) run({ kind: "continue" });
    expect(countOf(me, "lichen")).toBe(1);
    expect(countOf(me, "deadwood")).toBe(1);
    run({ kind: "craft", recipeId: "fiber" });
    for (let i = 0; i < 3; i++) run({ kind: "continue" });
    run({ kind: "craft", recipeId: "torch" });
    for (let i = 0; i < 5; i++) run({ kind: "continue" });
    expect(countOf(me, "torch")).toBe(1);
    expect(countOf(me, "deadwood")).toBe(0);
    run({ kind: "equip", itemKey: "torch" });
    expect(findPlayer(world)!.equipment?.held).toBe("torch");
  });
});
