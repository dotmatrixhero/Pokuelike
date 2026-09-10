import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyPlayerAction, syncPlayerMoves } from "../src/player.js";
import type { Agent, ItemDef, MoveSpec } from "../src/types.js";

/**
 * MOVES_AND_TOOLS.md: "the player's loadout is their moveset." Direct ask:
 * "I want tool granted moves. That will truly unlock gameplay as we know
 * it" — a real player attack action, reusing the ordinary
 * pickBestMove/resolveHit combat pipeline any wild agent's own attack goes
 * through, plus the generalised terrain effect (axe fells a tree, machete
 * clears brush) for tool-granted moves that aren't attacks at all.
 *
 * Deliberately synthetic move/item fixtures rather than importing the real
 * curated roster from `@pokuelike/data` — this suite is testing the ENGINE
 * mechanism (does a held item's grant reach combat, does a terrain effect
 * fire correctly), not this project's specific balance numbers, and the
 * engine package shouldn't depend on data in the first place.
 */

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
    stats: { hp: 25, attack: 25, defense: 25, spAttack: 25, spDefense: 25, speed: 30 },
    hp: 25,
    maxHp: 25,
    ...extra,
  };
}

const BARE_HANDS: MoveSpec = {
  id: "test_tackle",
  name: "Tackle",
  shape: { kind: "point" },
  type: "normal",
  category: "physical",
  power: 26,
  accuracy: -1,
  cooldownTicks: 5,
  range: { min: 0, max: 1 },
};

const KNIFE_SCRATCH: MoveSpec = {
  id: "test_scratch",
  name: "Scratch",
  shape: { kind: "point" },
  type: "normal",
  category: "physical",
  power: 26,
  accuracy: -1,
  cooldownTicks: 5,
  range: { min: 0, max: 1 },
};

const AXE_FELL: MoveSpec = {
  id: "test_fell",
  name: "Fell",
  shape: { kind: "point" },
  type: "normal",
  category: "status",
  power: 0,
  accuracy: -1,
  cooldownTicks: 10,
  range: { min: 0, max: 1 },
  utilityMove: true,
  terrainEffect: { from: ["tree"], to: "floor", yields: "deadwood" },
};

const MACHETE_CLEAR: MoveSpec = {
  id: "test_clear",
  name: "Clear",
  shape: { kind: "point" },
  type: "normal",
  category: "status",
  power: 0,
  accuracy: -1,
  cooldownTicks: 6,
  range: { min: 0, max: 1 },
  utilityMove: true,
  terrainEffect: { from: ["bush"], to: "floor" },
};

const ITEMS: Record<string, ItemDef> = {
  knife: { key: "knife", name: "Knife", weight: 2, slot: "held", grantsMoves: [KNIFE_SCRATCH] },
  axe: { key: "axe", name: "Axe", weight: 4, slot: "held", grantsMoves: [AXE_FELL] },
  machete: { key: "machete", name: "Machete", weight: 3, slot: "held", grantsMoves: [MACHETE_CLEAR] },
  torch: { key: "torch", name: "Torch", weight: 2, slot: "held", light: true },
};

function worldWithPlayer(): { world: ReturnType<typeof createWorld>; me: Agent } {
  const world = createWorld(12, 12, 1);
  world.items = ITEMS;
  world.playerBaseMoves = [BARE_HANDS];
  const me = human("me", 5, 5);
  me.moves = [BARE_HANDS];
  world.agents.push(me);
  return { world, me };
}

describe("MOVES_AND_TOOLS.md: a held item grants real moves (Agent.moves)", () => {
  it("bare hands: the player already carries the baseline loadout", () => {
    const { me } = worldWithPlayer();
    expect(me.moves).toEqual([BARE_HANDS]);
  });

  it("equipping a held item adds its grants on top of bare hands; stowing reverts", () => {
    const { world, me } = worldWithPlayer();
    me.inventory = [{ itemKey: "knife", weight: 2, count: 1 }];
    expect(applyPlayerAction(world, me, { kind: "equip", itemKey: "knife" })).toBe(true);
    expect(me.moves?.map((m) => m.id)).toEqual(["test_tackle", "test_scratch"]);

    expect(applyPlayerAction(world, me, { kind: "stow" })).toBe(true);
    expect(me.moves?.map((m) => m.id)).toEqual(["test_tackle"]);
  });

  it("switching items swaps the granted move, not just adds to it", () => {
    const { world, me } = worldWithPlayer();
    me.inventory = [
      { itemKey: "knife", weight: 2, count: 1 },
      { itemKey: "axe", weight: 4, count: 1 },
    ];
    applyPlayerAction(world, me, { kind: "equip", itemKey: "knife" });
    expect(me.moves?.map((m) => m.id)).toEqual(["test_tackle", "test_scratch"]);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "axe" });
    expect(me.moves?.map((m) => m.id)).toEqual(["test_tackle", "test_fell"]);
  });

  it("a worn item grants no moves — only held", () => {
    const { world, me } = worldWithPlayer();
    world.items!.cloak = { key: "cloak", name: "Cloak", weight: 2, slot: "worn" };
    me.inventory = [{ itemKey: "cloak", weight: 2, count: 1 }];
    applyPlayerAction(world, me, { kind: "equip", itemKey: "cloak" });
    expect(me.moves?.map((m) => m.id)).toEqual(["test_tackle"]);
  });

  it("syncPlayerMoves is idempotent and safe to call with no equipment at all", () => {
    const { world, me } = worldWithPlayer();
    syncPlayerMoves(world, me);
    expect(me.moves?.map((m) => m.id)).toEqual(["test_tackle"]);
  });
});

describe("MOVES_AND_TOOLS.md: attack — a living target takes a real hit", () => {
  it("bare-handed, the player can still land a hit on an adjacent hostile", () => {
    const { world, me } = worldWithPlayer();
    const target = prey("rat", 6, 5);
    world.agents.push(target);
    const before = target.hp;
    const outcome = applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 });
    expect(outcome).toBe(true);
    expect(target.hp).toBeLessThan(before!);
    expect(me.lastActionOutcome?.attackedId).toBe("rat");
  });

  it("nothing adjacent in that direction: fails, costs nothing extra", () => {
    const { world, me } = worldWithPlayer();
    expect(applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 })).toBe(false);
  });

  it("respects the move's own cooldown — a second swing right away whiffs for lack of an available move", () => {
    const { world, me } = worldWithPlayer();
    const target = prey("rat", 6, 5, { stats: { hp: 999, attack: 25, defense: 25, spAttack: 25, spDefense: 25, speed: 30 }, hp: 999, maxHp: 999 });
    world.agents.push(target);
    expect(applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 })).toBe(true);
    // Tackle just went on a 5-tick cooldown and bare hands has nothing else.
    expect(applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 })).toBe(false);
  });

  it("a real weapon's granted move is used instead of/alongside bare hands, and goes on its own cooldown", () => {
    const { world, me } = worldWithPlayer();
    me.inventory = [{ itemKey: "knife", weight: 2, count: 1 }];
    applyPlayerAction(world, me, { kind: "equip", itemKey: "knife" });
    const target = prey("rat", 6, 5);
    world.agents.push(target);
    applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 });
    expect(me.moveCooldowns?.test_scratch ?? me.moveCooldowns?.test_tackle).toBeGreaterThan(0);
  });
});

describe("MOVES_AND_TOOLS.md: attack — terrain effect when nothing living is there", () => {
  it("an axe fells a tree in front of the player and drops deadwood", () => {
    const { world, me } = worldWithPlayer();
    me.inventory = [{ itemKey: "axe", weight: 4, count: 1 }];
    applyPlayerAction(world, me, { kind: "equip", itemKey: "axe" });
    setTile(world, "surface", 6, 5, "tree");

    const outcome = applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 });
    expect(outcome).toBe(true);
    expect(tileAt(world, "surface", 6, 5)?.terrain).toBe("floor");
    expect(me.inventory?.find((i) => i.itemKey === "deadwood")?.count).toBe(1);
    expect(me.lastActionOutcome?.felled).toEqual({ from: "tree", to: "floor", yields: "deadwood" });
  });

  it("a machete clears a bush but does not fell a tree — the slice rule, gated by `from`", () => {
    const { world, me } = worldWithPlayer();
    me.inventory = [{ itemKey: "machete", weight: 3, count: 1 }];
    applyPlayerAction(world, me, { kind: "equip", itemKey: "machete" });
    setTile(world, "surface", 6, 5, "tree");

    expect(applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 })).toBe(false);
    expect(tileAt(world, "surface", 6, 5)?.terrain).toBe("tree");

    setTile(world, "surface", 6, 5, "bush");
    expect(applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 })).toBe(true);
    expect(tileAt(world, "surface", 6, 5)?.terrain).toBe("floor");
  });

  it("bare hands cannot fell anything — no terrain-effect move in the loadout at all", () => {
    const { world, me } = worldWithPlayer();
    setTile(world, "surface", 6, 5, "tree");
    expect(applyPlayerAction(world, me, { kind: "attack", dx: 1, dy: 0 })).toBe(false);
  });
});
