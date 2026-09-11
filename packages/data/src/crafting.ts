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
 * MOVES_AND_TOOLS.md's numeric rule ("a tool-granted move sits at roughly
 * 60-70% of the creature version's power") is EXPLICITLY OVERRULED —
 * direct ask: *"If you have a tool, the move it grants, it should not be
 * weakened. Just make it a normal vanilla move."* A held item grants the
 * exact same base `MoveSpec` a real Pokémon knows (`./moves.js`'s
 * `MOVES`), unmodified — the balance lever is the slice rule alone
 * (*which* move, and how much of its effect, per the worked table below),
 * not an artificial power/cooldown tax on top of it. Also why a
 * `player.ts` attack goes through the ordinary `pickBestMove`/`resolveHit`
 * pipeline completely unmodified either way — the sim genuinely does not
 * know a human swung a knife rather than a Sandshrew's claw.
 */

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
export const BARE_HANDS_MOVES: MoveSpec[] = [MOVES.tackle!];

export const ITEMS: Record<string, ItemDef> = {
  fiber: { key: "fiber", name: "Fiber", weight: 1 },
  cordage: { key: "cordage", name: "Cordage", weight: 1 },
  boundHaft: { key: "boundHaft", name: "Bound haft", weight: 2 },
  knappedFlint: { key: "knappedFlint", name: "Knapped flint", weight: 1 },
  // Direct ask: "the held torch should give me access to ember (1 range) as
  // a move." A held flame is fire, same reasoning as the knife/club/axe
  // grants below — `MOVES.ember` unmodified (base move, no skill-tree
  // deltas; those are wild-agent auto-respec only), range 1 already.
  torch: { key: "torch", name: "Torch", weight: 2, slot: "held", light: true, threat: 0.3, grantsMoves: [MOVES.ember!] },
  // MOVES_AND_TOOLS.md's worked table: knife -> Scratch (the damage slice).
  flintKnife: { key: "flintKnife", name: "Flint knife", weight: 2, slot: "held", threat: 0.3, grantsMoves: [MOVES.scratch!] },
  // Club -> Pound. Direct correction: "Club should not be body slam...
  // Maybe pound?" — Body Slam reads as a full-body creature move; Pound is
  // the plain "hit it with the thing in your hand" swing a human club
  // actually is. `moves.ts`'s `pound` entry was added for exactly this.
  club: { key: "club", name: "Club", weight: 3, slot: "held", threat: 0.5, grantsMoves: [MOVES.pound!] },
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
    grantsMoves: [terrainMove("clear", "Clear", { from: ["bush", "flora", "seedling"], to: "floor" }, 6), MOVES.slash!],
  },
  poultice: { key: "poultice", name: "Poultice", weight: 1 },
  foragePouch: { key: "foragePouch", name: "Forage pouch", weight: 1, capacity: 8 },
  camouflageCloak: { key: "camouflageCloak", name: "Camouflage cloak", weight: 2, slot: "worn", threat: -0.4 },
  // Direct ask: "you know im gonna have to add cooking lol. building a fire
  // you can deploy... to cook, and while near you can craft with combos of
  // crops and berries. cooked food gets you more rapport when offered.
  // heals as well as satisfies hunger." Fixed named dishes (the scoping
  // ruling: "fixed named dishes... Recommended", over one flexible
  // any-2-foods combiner) — each its own real ingredients, each a real
  // `cooked` bonus on top of whatever nutrition its raw ingredients already
  // carried. `RECIPES` below gates every one of these on `requiresNearFire`.
  roastedApple: { key: "roastedApple", name: "Roasted Apple", weight: 1, cooked: { healFraction: 0.15, rapportMultiplier: 2 } },
  berryStew: { key: "berryStew", name: "Berry Stew", weight: 1, cooked: { healFraction: 0.15, rapportMultiplier: 2 } },
  potatoMash: { key: "potatoMash", name: "Potato Mash", weight: 1, cooked: { healFraction: 0.2, rapportMultiplier: 2.2 } },
  vegetableStew: { key: "vegetableStew", name: "Vegetable Stew", weight: 1, cooked: { healFraction: 0.2, rapportMultiplier: 2.5 } },
};

function recipe(id: string, name: string, inputs: [string, number][], turns: number, knownAtStart: boolean, outputCount = 1, requiresNearFire = false): RecipeDef {
  return { id, name, inputs: inputs.map(([itemKey, count]) => ({ itemKey, count })), output: { itemKey: id, count: outputCount }, turns, knownAtStart, requiresNearFire };
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
  // Direct ask: "i also want to craft a backpack eather early on if
  // possible, if only a small one, that increases your capacity" — its
  // inputs (cordage, fiber) are both already `knownAtStart`, so this was
  // already reachable from nothing; the only thing keeping it out of reach
  // "early on" was this flag.
  foragePouch: recipe("foragePouch", "Forage pouch", [["cordage", 1], ["fiber", 1]], 6, true),
  camouflageCloak: recipe("camouflageCloak", "Camouflage cloak", [["fiber", 1], ["lichen", 1]], 8, false),
  // Cooking — direct ask, "building a fire you can deploy... to cook, and
  // while near you can craft with combos of crops and berries." Each needs
  // a real nearby fire (`player.ts`'s "lightFire" action deploys one);
  // `requiresNearFire: true` is the last positional arg on every one below.
  //
  // Direct report, live-verified: "i dont see fire crafting or cooking
  // recipes as an option" — a real reachability bug, not a UI glitch.
  // These originally shipped `knownAtStart: false`, on the same footing as
  // axe/machete/knappedFlint ("learned later... M6+: examine, being
  // taught, a written recipe" per this file's own top doc comment) — but
  // that discovery mechanic was never built, for ANY recipe, so
  // `knownAtStart: false` here meant "permanently unreachable," not
  // "reachable once you find X." Confirmed live: a fresh spawn's
  // `knownRecipes` was `["fiber","cordage","boundHaft","torch","club",
  // "poultice","foragePouch"]` — none of the four below, ever. Flipped to
  // `true`, same fix and same reasoning as `foragePouch` just above: every
  // ingredient here is a gatherable crop, nothing else gates them, and the
  // user's own original ask ("building a fire you can deploy") reads as
  // day-one survival kit, not a late-game unlock — axe/machete/
  // knappedFlint are left exactly as they were; that's a real, separate,
  // still-open gap (nothing discovers ANY non-knownAtStart recipe), not
  // something this fix should paper over.
  roastedApple: recipe("roastedApple", "Roasted Apple", [["apple", 1]], 4, true, 1, true),
  berryStew: recipe("berryStew", "Berry Stew", [["oran", 1], ["pecha", 1]], 5, true, 1, true),
  potatoMash: recipe("potatoMash", "Potato Mash", [["potato", 2]], 5, true, 1, true),
  vegetableStew: recipe("vegetableStew", "Vegetable Stew", [["tomato", 1], ["corn", 1]], 6, true, 1, true),
};

export const KNOWN_AT_START: string[] = Object.values(RECIPES).filter((r) => r.knownAtStart).map((r) => r.id);

/** Display name for anything that can be in a pack: a made item or a gathered material. */
export function itemName(key: string): string {
  return ITEMS[key]?.name ?? MATERIALS[key as MaterialId]?.name ?? key;
}

export function itemWeight(key: string): number {
  return ITEMS[key]?.weight ?? MATERIALS[key as MaterialId]?.weight ?? 1;
}
