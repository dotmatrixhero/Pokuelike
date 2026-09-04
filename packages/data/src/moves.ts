import type { MoveSpec } from "@pokuelike/engine";
import { MOVE_DEX_BY_KEY } from "./dex/index.js";

/**
 * Looks up a move's canon type/category/power/accuracy from the full PokeRogue-
 * derived move dex (`dex/moves.generated.ts`) by `dexKey` (its MoveId enum key,
 * e.g. "VINE_WHIP") — the intended way to source real numbers when adding a new
 * move here, instead of hand-copying them. Assumes an attacking move (dex
 * category "status" isn't representable by `MoveSpec` yet — the sim doesn't
 * model status moves, see TODO.md); pass an explicit `category` override if a
 * looked-up move is ever needed for its status-move fields instead.
 */
export function moveCanon(
  dexKey: string
): Pick<MoveSpec, "type" | "category" | "power" | "accuracy"> {
  const entry = MOVE_DEX_BY_KEY[dexKey];
  if (!entry) throw new Error(`moveCanon: no dex entry for key "${dexKey}" (packages/data/src/dex/moves.generated.ts)`);
  if (entry.category === "status") {
    throw new Error(`moveCanon: "${dexKey}" is a status move; MoveSpec only models physical/special attacks (see TODO.md)`);
  }
  return { type: entry.type, category: entry.category, power: entry.power, accuracy: entry.accuracy };
}

/**
 * Base move definitions. Type/category/power/accuracy come from the canon dex
 * via `moveCanon`; shape/cooldownTicks/statusChance are sim-specific tuning —
 * shape is still the spec'able axis for later leveling (see DESIGN.md), e.g.
 * Ember: point -> ring, or +radius/-cooldown builds — nothing consumes that yet.
 */
export const MOVES: Record<string, MoveSpec> = {
  tackle: {
    id: "tackle",
    name: "Tackle",
    shape: { kind: "point" },
    ...moveCanon("TACKLE"),
    cooldownTicks: 0,
    range: { min: 0, max: 1 },
  },
  slash: {
    id: "slash",
    name: "Slash",
    shape: { kind: "line", length: 1 },
    ...moveCanon("SLASH"),
    cooldownTicks: 0,
    range: { min: 0, max: 1 },
  },
  vine_whip: {
    id: "vine_whip",
    name: "Vine Whip",
    shape: { kind: "line", length: 2 },
    ...moveCanon("VINE_WHIP"),
    cooldownTicks: 0,
    range: { min: 0, max: 2 },
  },
  ember: {
    id: "ember",
    name: "Ember",
    shape: { kind: "point" },
    ...moveCanon("EMBER"),
    cooldownTicks: 1,
    statusChance: 0.1,
    range: { min: 0, max: 1 },
    // Two real, independent 3-tier branches (no cross-branch prerequisite —
    // each is a complete build on its own) rather than one 2-node chain: the
    // original chain fully maxed out on ~level 4 of guaranteed level-up
    // income alone (3 total points against a 100-level curve), which left no
    // room for the disposition-weighted pick to matter beyond the very start
    // of a Charmander's life, or for anything to still be "in progress"
    // later. 12 total points to fully clear both branches is a real mid-game
    // commitment. Wild agents auto-respec into this via `maybeAutoRespec`
    // (leveling.ts) as they earn skill points, weighted by their own
    // Disposition against each node's `leaning` — see DESIGN.md's
    // "Specialization" section.
    tree: {
      // Aggression branch — "Wildfire": press the attack harder each tier,
      // at a real cost (accuracy, then reach at the expense of raw shape
      // simplicity) rather than being strictly better than staying put.
      wider_burn: {
        id: "wider_burn",
        name: "Wider Burn",
        cost: 1,
        leaning: "aggression",
        delta: { statusChance: 0.15, cooldownTicks: -1 },
      },
      roaring_blaze: {
        id: "roaring_blaze",
        name: "Roaring Blaze",
        cost: 2,
        prerequisites: ["wider_burn"],
        leaning: "aggression",
        delta: { power: 15, accuracy: -5 },
      },
      inferno: {
        id: "inferno",
        name: "Inferno",
        cost: 3,
        prerequisites: ["roaring_blaze"],
        leaning: "aggression",
        delta: { shape: { kind: "line", length: 2 }, range: { max: 2 }, statusChance: 0.1 },
      },
      // Boldness branch — "Ring of Fire": trade power for area, letting a
      // bold individual stand its ground against several attackers instead
      // of needing to path into range of one. Fully independent of the
      // aggression branch — an agent can commit to either, both, or neither.
      ring_of_fire: {
        id: "ring_of_fire",
        name: "Ring of Fire",
        cost: 1,
        leaning: "boldness",
        delta: { shape: { kind: "ring", radius: 1 }, power: -10, cooldownTicks: 1 },
      },
      wide_ring: {
        id: "wide_ring",
        name: "Wide Ring",
        cost: 2,
        prerequisites: ["ring_of_fire"],
        leaning: "boldness",
        delta: { shape: { kind: "ring", radius: 2 } },
      },
      lingering_ring: {
        id: "lingering_ring",
        name: "Lingering Ring",
        cost: 3,
        prerequisites: ["wide_ring"],
        leaning: "boldness",
        delta: { cooldownTicks: -1, statusChance: 0.1 },
      },
    },
  },
  flamethrower: {
    id: "flamethrower",
    name: "Flamethrower",
    shape: { kind: "cone", length: 4, width: 2 },
    ...moveCanon("FLAMETHROWER"),
    cooldownTicks: 3,
    statusChance: 0.1,
    range: { min: 0, max: 4 },
  },
  peck: {
    id: "peck",
    name: "Peck",
    shape: { kind: "point" },
    ...moveCanon("PECK"),
    cooldownTicks: 0,
    range: { min: 0, max: 1 },
  },
  scratch: {
    id: "scratch",
    name: "Scratch",
    shape: { kind: "point" },
    ...moveCanon("SCRATCH"),
    cooldownTicks: 0,
    range: { min: 0, max: 1 },
  },
  rock_throw: {
    id: "rock_throw",
    name: "Rock Throw",
    shape: { kind: "line", length: 3 },
    ...moveCanon("ROCK_THROW"),
    cooldownTicks: 1,
    range: { min: 0, max: 3 },
  },
  water_gun: {
    id: "water_gun",
    name: "Water Gun",
    shape: { kind: "line", length: 2 },
    ...moveCanon("WATER_GUN"),
    cooldownTicks: 0,
    range: { min: 0, max: 2 },
  },
};
