import type { MoveSpec } from "@pokuelike/engine";

/**
 * Base move definitions, canon-scale power/accuracy/type/category. Shape is
 * still the spec'able axis for later leveling (see DESIGN.md) — e.g. Ember:
 * point -> ring, or +radius/-cooldown builds — nothing consumes that yet.
 */
export const MOVES: Record<string, MoveSpec> = {
  tackle: {
    id: "tackle",
    name: "Tackle",
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 0,
  },
  slash: {
    id: "slash",
    name: "Slash",
    shape: { kind: "line", length: 1 },
    type: "normal",
    category: "physical",
    power: 70,
    accuracy: 100,
    cooldownTicks: 0,
  },
  vine_whip: {
    id: "vine_whip",
    name: "Vine Whip",
    shape: { kind: "line", length: 2 },
    type: "grass",
    category: "physical",
    power: 45,
    accuracy: 100,
    cooldownTicks: 0,
  },
  ember: {
    id: "ember",
    name: "Ember",
    shape: { kind: "point" },
    type: "fire",
    category: "special",
    power: 40,
    accuracy: 100,
    cooldownTicks: 1,
    statusChance: 0.1,
  },
  flamethrower: {
    id: "flamethrower",
    name: "Flamethrower",
    shape: { kind: "cone", length: 4, width: 2 },
    type: "fire",
    category: "special",
    power: 90,
    accuracy: 100,
    cooldownTicks: 3,
    statusChance: 0.1,
  },
};
