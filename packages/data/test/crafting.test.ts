import { describe, expect, it } from "vitest";
import { MATERIALS, harvestableAt, type MaterialId } from "@pokuelike/engine";
import { BARE_HANDS_MOVES, ITEMS, KNOWN_AT_START, RECIPES } from "../src/crafting.js";
import { createCaveScenario, walkDistances } from "../src/scenario.js";
import { MOVES } from "../src/moves.js";

/**
 * The automated form of "unreachable content is a bug" — HANDOFF.md §3.2.
 * CRAFTING_TREE.md found a real circular dependency (pick needs stone
 * needs pick) by hand; this is that trace, run on every change.
 */
const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];
const FIRST_PLAYABLE = ["fiber", "cordage", "boundHaft", "knappedFlint", "torch", "flintKnife", "club", "poultice", "foragePouch", "camouflageCloak"];

describe("crafting tables (ROADMAP M5)", () => {
  it("every recipe input is a material or an item, and every recipe makes an item", () => {
    for (const r of Object.values(RECIPES)) {
      for (const input of r.inputs) {
        expect(MATERIAL_IDS.includes(input.itemKey as MaterialId) || input.itemKey in ITEMS, `${r.id} input ${input.itemKey}`).toBe(true);
      }
      expect(r.output.itemKey in ITEMS, `${r.id} output`).toBe(true);
      expect(r.turns).toBeGreaterThan(0);
    }
  });

  it("has no cycles", () => {
    const state = new Map<string, "visiting" | "done">();
    const visit = (id: string): void => {
      const s = state.get(id);
      if (s === "done") return;
      expect(s, `cycle through ${id}`).not.toBe("visiting");
      state.set(id, "visiting");
      for (const input of RECIPES[id]?.inputs ?? []) if (input.itemKey in RECIPES) visit(input.itemKey);
      state.set(id, "done");
    };
    for (const id of Object.keys(RECIPES)) visit(id);
  });

  it("the whole first-playable set is reachable from nothing but bare-hand materials", () => {
    const owned = new Set<string>(MATERIAL_IDS);
    const order: string[] = [];
    let progress = true;
    while (progress) {
      progress = false;
      for (const r of Object.values(RECIPES)) {
        if (owned.has(r.output.itemKey)) continue;
        if (r.inputs.every((i) => owned.has(i.itemKey))) {
          owned.add(r.output.itemKey);
          order.push(r.id);
          progress = true;
        }
      }
    }
    for (const id of FIRST_PLAYABLE) expect(owned.has(id), `${id} unreachable`).toBe(true);
    console.log("craft order from nothing:", order.join(" → "));
  });

  it("known-at-start covers the torch chain, so the first thing the opening promises is makeable", () => {
    expect(KNOWN_AT_START).toEqual(expect.arrayContaining(["fiber", "torch"]));
    // Every input of a known recipe is a material or another known recipe.
    for (const id of KNOWN_AT_START) {
      for (const input of RECIPES[id]!.inputs) {
        expect(MATERIAL_IDS.includes(input.itemKey as MaterialId) || KNOWN_AT_START.includes(input.itemKey), `${id} needs unknown ${input.itemKey}`).toBe(true);
      }
    }
  });

  it("in the real cave, lichen and deadwood are gatherable within 60 walked steps of spawn on every seed", () => {
    for (const seed of [20260903, 11, 202, 3003, 40404]) {
      const world = createCaveScenario(seed);
      const me = world.agents.find((a) => a.controlledBy === "player")!;
      const dist = walkDistances(world, "underground", me.pos);
      const nearest: Partial<Record<MaterialId, number>> = {};
      for (const [k, d] of dist) {
        if (d > 60) continue;
        const [x, y] = k.split(",").map(Number) as [number, number];
        for (const m of harvestableAt(world, "underground", { x, y })) nearest[m] = Math.min(nearest[m] ?? Infinity, d);
      }
      expect(nearest.lichen, `seed ${seed}: no lichen within 60`).toBeDefined();
      expect(nearest.deadwood, `seed ${seed}: no deadwood within 60`).toBeDefined();
      // Ruling: "I want gathering on layer 1." Every material the cut needs.
      expect(nearest.flint, `seed ${seed}: no flint within 60`).toBeDefined();
      expect(nearest.herbs, `seed ${seed}: no herbs within 60`).toBeDefined();
      console.log(`seed ${seed}: lichen ${nearest.lichen} steps, deadwood ${nearest.deadwood}, flint ${nearest.flint ?? "none"}, herbs ${nearest.herbs ?? "none"}, berries ${nearest.food ?? "none"}`);
    }
  });
});

describe("MOVES_AND_TOOLS.md: tool-granted moves", () => {
  it("bare hands is a real, full-strength Tackle — direct correction mid-ask, 'Tackle*'", () => {
    expect(BARE_HANDS_MOVES).toHaveLength(1);
    const move = BARE_HANDS_MOVES[0]!;
    expect(move.id).toBe("tackle");
    // The numeric rule got overruled mid-build: "it should not be weakened.
    // Just make it a normal vanilla move." Full parity with the real thing.
    expect(move.power).toBe(MOVES.tackle!.power);
    expect(move.cooldownTicks).toBe(MOVES.tackle!.cooldownTicks);
  });

  it("flint knife grants a real Scratch, club a real Pound — vanilla, not a weakened copy", () => {
    for (const [itemKey, baseId] of [
      ["flintKnife", "scratch"],
      ["club", "pound"],
    ] as const) {
      const granted = ITEMS[itemKey]!.grantsMoves!;
      expect(granted.map((m) => m.id)).toContain(baseId);
      const move = granted.find((m) => m.id === baseId)!;
      const base = MOVES[baseId]!;
      expect(move.power).toBe(base.power);
      expect(move.cooldownTicks).toBe(base.cooldownTicks);
    }
    // Direct correction, mid-build: "Club should not be body slam... Maybe
    // pound?" — Body Slam is gone from the club's grant entirely.
    expect(ITEMS.club!.grantsMoves!.some((m) => m.id === "body_slam")).toBe(false);
  });

  it("axe fells trees only; machete clears brush and grants a real, vanilla Slash — the slice rule, and no tool gets all of Cut", () => {
    const axeFell = ITEMS.axe!.grantsMoves!.find((m) => m.terrainEffect)!;
    expect(axeFell.terrainEffect!.from).toEqual(["tree"]);
    expect(axeFell.terrainEffect!.to).toBe("floor");
    expect(axeFell.terrainEffect!.yields).toBe("deadwood");
    // Axe grants no damage-dealing move — the felling slice only.
    expect(ITEMS.axe!.grantsMoves!.every((m) => m.power === 0)).toBe(true);

    const macheteClear = ITEMS.machete!.grantsMoves!.find((m) => m.terrainEffect)!;
    expect(macheteClear.terrainEffect!.to).toBe("floor");
    expect(macheteClear.terrainEffect!.yields).toBeUndefined();
    expect(macheteClear.terrainEffect!.from).not.toContain("tree");
    const macheteSlash = ITEMS.machete!.grantsMoves!.find((m) => m.id === "slash")!;
    expect(macheteSlash.power).toBe(MOVES.slash!.power);
    expect(macheteSlash.cooldownTicks).toBe(MOVES.slash!.cooldownTicks);
  });

  it("axe and machete are eventually reachable from nothing but bare-hand materials (learned later, like the flint knife)", () => {
    const owned = new Set<string>(Object.keys(MATERIALS));
    let progress = true;
    while (progress) {
      progress = false;
      for (const r of Object.values(RECIPES)) {
        if (owned.has(r.output.itemKey)) continue;
        if (r.inputs.every((i) => owned.has(i.itemKey))) {
          owned.add(r.output.itemKey);
          progress = true;
        }
      }
    }
    expect(owned.has("axe")).toBe(true);
    expect(owned.has("machete")).toBe(true);
  });
});
