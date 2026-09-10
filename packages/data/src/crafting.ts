import type { ItemDef, RecipeDef } from "@pokuelike/engine";
import { MATERIALS, type MaterialId } from "@pokuelike/engine";

/**
 * The crafting tables — ROADMAP.md M5, from CRAFTABLES_V1.md's
 * "first-playable cut" and nothing more:
 *
 *   Fiber · Cordage · Bound haft · Knapped flint · Torch · Flint knife ·
 *   Club · Poultice · Forage pouch · Camouflage cloak
 *
 * Weights and turns are the doc's tables, not retuned. Known at start:
 * "You are a human. These need no discovery." — fiber, cordage, bound
 * haft, torch, club, poultice. Everything else is learned later (M6+:
 * examine, being taught, a written recipe).
 *
 * Materials (lichen, deadwood, flint, herbs, food) are the engine's
 * `harvest.ts` ids — gathered, not crafted. `crafting.test.ts` walks
 * these tables so an unreachable recipe is a failing test, not a paper
 * prototype finding.
 */

export const ITEMS: Record<string, ItemDef> = {
  fiber: { key: "fiber", name: "Fiber", weight: 1 },
  cordage: { key: "cordage", name: "Cordage", weight: 1 },
  boundHaft: { key: "boundHaft", name: "Bound haft", weight: 2 },
  knappedFlint: { key: "knappedFlint", name: "Knapped flint", weight: 1 },
  torch: { key: "torch", name: "Torch", weight: 2, slot: "held", light: true, threat: 0.3 },
  flintKnife: { key: "flintKnife", name: "Flint knife", weight: 2, slot: "held", threat: 0.3 },
  club: { key: "club", name: "Club", weight: 3, slot: "held", threat: 0.5 },
  poultice: { key: "poultice", name: "Poultice", weight: 1 },
  foragePouch: { key: "foragePouch", name: "Forage pouch", weight: 1, capacity: 8 },
  camouflageCloak: { key: "camouflageCloak", name: "Camouflage cloak", weight: 2, slot: "worn", threat: -0.4 },
};

function recipe(id: string, name: string, inputs: [string, number][], turns: number, knownAtStart: boolean, outputCount = 1): RecipeDef {
  return { id, name, inputs: inputs.map(([itemKey, count]) => ({ itemKey, count })), output: { itemKey: id, count: outputCount }, turns, knownAtStart };
}

/** Keyed by id; a recipe's id is the item key it makes. */
export const RECIPES: Record<string, RecipeDef> = {
  fiber: recipe("fiber", "Fiber", [["lichen", 1]], 3, true),
  cordage: recipe("cordage", "Cordage", [["fiber", 2]], 3, true),
  boundHaft: recipe("boundHaft", "Bound haft", [["deadwood", 1], ["cordage", 1]], 4, true),
  knappedFlint: recipe("knappedFlint", "Knapped flint", [["flint", 1]], 3, false),
  torch: recipe("torch", "Torch", [["deadwood", 1], ["fiber", 1]], 5, true),
  flintKnife: recipe("flintKnife", "Flint knife", [["boundHaft", 1], ["knappedFlint", 1]], 10, false),
  club: recipe("club", "Club", [["boundHaft", 1]], 6, true),
  poultice: recipe("poultice", "Poultice", [["herbs", 1], ["lichen", 1]], 5, true),
  foragePouch: recipe("foragePouch", "Forage pouch", [["cordage", 1], ["fiber", 1]], 6, false),
  camouflageCloak: recipe("camouflageCloak", "Camouflage cloak", [["fiber", 1], ["lichen", 1]], 8, false),
};

export const KNOWN_AT_START: string[] = Object.values(RECIPES).filter((r) => r.knownAtStart).map((r) => r.id);

/** Display name for anything that can be in a pack: a made item or a gathered material. */
export function itemName(key: string): string {
  return ITEMS[key]?.name ?? MATERIALS[key as MaterialId]?.name ?? key;
}

export function itemWeight(key: string): number {
  return ITEMS[key]?.weight ?? MATERIALS[key as MaterialId]?.weight ?? 1;
}
