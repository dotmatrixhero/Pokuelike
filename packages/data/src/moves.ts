import type { MoveSpec } from "@pokuelike/engine";

/**
 * Base move definitions. Each is a starting shape/tuning — the "spec" system
 * (not implemented yet, see DESIGN.md) will let a leveled-up move swap its
 * shape or tuning, e.g. Ember: point -> ring, or +radius/-cooldown builds.
 */
export const MOVES: Record<string, MoveSpec> = {
  tackle: {
    id: "tackle",
    name: "Tackle",
    shape: { kind: "point" },
    tuning: { power: 4, cooldown: 0 },
  },
  slash: {
    id: "slash",
    name: "Slash",
    shape: { kind: "line", length: 1 },
    tuning: { power: 7, cooldown: 0 },
  },
  ember: {
    id: "ember",
    name: "Ember",
    shape: { kind: "point" },
    tuning: { power: 3, burnChance: 0.1, cooldown: 1 },
  },
  flamethrower: {
    id: "flamethrower",
    name: "Flamethrower",
    shape: { kind: "cone", length: 4, width: 2 },
    tuning: { power: 9, burnChance: 0.2, cooldown: 3 },
  },
};
