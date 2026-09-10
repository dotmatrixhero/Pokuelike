import type { ItemDef, MoveSpec, RecipeDef } from "@pokuelike/engine";
import { MATERIALS, type MaterialId } from "@pokuelike/engine";
import { MOVES } from "./moves.js";

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

/**
 * MOVES_AND_TOOLS.md's numeric rule: a tool-granted move sits at roughly
 * 60-70% of the creature version's power, at 1.5-2x its cooldown — "if a
 * tool ever matches the innate version, the slice rule has failed and the
 * partner has lost a reason to exist." Reuses the exact same base MoveSpec
 * a real Pokémon knows (`./moves.js`'s `MOVES`) rather than inventing a
 * parallel, hand-tuned roster — so a `player.ts` attack goes through the
 * ordinary `pickBestMove`/`resolveHit` pipeline completely unmodified; the
 * sim genuinely does not know a human swung a knife rather than a
 * Sandshrew's claw.
 */
function toolMove(base: MoveSpec, powerMult = 0.65, cooldownMult = 1.75): MoveSpec {
  return { ...base, power: Math.round(base.power * powerMult), cooldownTicks: Math.round(base.cooldownTicks * cooldownMult) };
}

/**
 * A terrain-only move (fell a tree, clear brush) — MOVES_AND_TOOLS.md's
 * generalised terrain effect (`MoveSpec.terrainEffect`, engine's moves.ts).
 * `utilityMove: true` keeps `pickBestMove` (combat.ts) from ever offering
 * it as a hostile attack; `player.ts`'s `attack` case reaches it directly
 * by scanning the player's own moves for one with `terrainEffect` whose
 * `from` matches the targeted tile, bypassing ordinary combat resolution
 * entirely (there is no living defender to hit here). No `power`/real
 * `accuracy`/`type` to speak of — a plain, always-hits, status-category
 * utility move, same shape the sim's other utility moves (Growth, Agility)
 * already use.
 */
function terrainMove(id: string, name: string, terrainEffect: NonNullable<MoveSpec["terrainEffect"]>, cooldownTicks: number): MoveSpec {
  return { id, name, shape: { kind: "point" }, type: "normal", category: "status", power: 0, accuracy: -1, pp: 1, cooldownTicks, range: { min: 0, max: 1 }, utilityMove: true, terrainEffect };
}

/**
 * MOVES_AND_TOOLS.md's baseline unarmed loadout. Direct correction mid-ask
 * — "Tackle*", not the first-drafted Scratch: an empty-handed human still
 * tackles. `player.ts`'s `syncPlayerMoves` always includes this, on top of
 * whatever the held item grants.
 */
export const BARE_HANDS_MOVES: MoveSpec[] = [toolMove(MOVES.tackle!)];

export const ITEMS: Record<string, ItemDef> = {
  fiber: { key: "fiber", name: "Fiber", weight: 1 },
  cordage: { key: "cordage", name: "Cordage", weight: 1 },
  boundHaft: { key: "boundHaft", name: "Bound haft", weight: 2 },
  knappedFlint: { key: "knappedFlint", name: "Knapped flint", weight: 1 },
  torch: { key: "torch", name: "Torch", weight: 2, slot: "held", light: true, threat: 0.3 },
  // MOVES_AND_TOOLS.md's worked table: knife -> Scratch (the damage slice).
  flintKnife: { key: "flintKnife", name: "Flint knife", weight: 2, slot: "held", threat: 0.3, grantsMoves: [toolMove(MOVES.scratch!)] },
  // Club -> Swing/Slam. Body Slam is this roster's closest real move to
  // "heavy, slow, no secondary effect" at the base (unleveled) level.
  club: { key: "club", name: "Club", weight: 3, slot: "held", threat: 0.5, grantsMoves: [toolMove(MOVES.body_slam!)] },
  // Axe -> Cut, fell-only slice (MOVES_AND_TOOLS.md's knife/machete/axe
  // split: "no tool gets all three"). Deliberately no second, damage-slice
  // grant here (the doc's table also gives axe a Karate Chop-flavoured
  // hit) — this roster has no karate_chop move to slice from yet, and
  // inventing one is its own balance pass, not part of this one. An axe
  // wielder who also wants to fight carries a knife too, same tradeoff
  // the held slot already enforces everywhere else (Shield/Brace).
  axe: {
    key: "axe",
    name: "Axe",
    weight: 4,
    slot: "held",
    threat: 0.4,
    grantsMoves: [terrainMove("fell", "Fell", { from: ["tree"], to: "floor", yields: "deadwood" }, 10)],
  },
  // Machete -> Cut's clearing slice, plus Slash (matches the doc's table
  // exactly: "Machete takes the clearing slice, plus Slash").
  machete: {
    key: "machete",
    name: "Machete",
    weight: 3,
    slot: "held",
    threat: 0.35,
    grantsMoves: [terrainMove("clear", "Clear", { from: ["bush", "flora", "seedling"], to: "floor" }, 6), toolMove(MOVES.slash!)],
  },
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
  // A heavier head than a knife's single edge, sim-original guess (no prior
  // doc table value to draw from, unlike the first-playable-cut items
  // above) — for the user to judge against a real run same as everything
  // else on this list once it's reachable.
  axe: recipe("axe", "Axe", [["boundHaft", 1], ["knappedFlint", 2]], 14, false),
  machete: recipe("machete", "Machete", [["boundHaft", 1], ["knappedFlint", 1], ["cordage", 1]], 11, false),
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
