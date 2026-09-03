/** A species' base stats, mainline-accurate where we've bothered to look them up (see packages/data). */
export interface BaseStats {
  hp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

export interface Stats {
  maxHp: number;
  attack: number;
  defense: number;
  spAttack: number;
  spDefense: number;
  speed: number;
}

import { natureMultiplier, type StatKey } from "./nature.js";

/**
 * The mainline games' stat formulas, simplified: perfect-enough IVs/no EVs
 * (31/0), since we're not modeling training — the point is numbers that feel
 * like Pokemon numbers, not competitive-exact ones. HP: floor(2*base*level/100)
 * + level + 10 (never affected by nature, matching mainline). Others:
 * floor((floor(2*base*level/100) + 5) * natureMultiplier) — an optional
 * `nature` name (see nature.ts) applies the real 1.1x/0.9x mainline nature
 * multiplier after the +5 base, same ordering the real games use. Omitting
 * `nature` (or passing an unknown one) is treated as neutral, so existing
 * callers that don't care about individual variance are unaffected.
 */
export function calculateStats(base: BaseStats, level: number, nature?: string): Stats {
  const scale = (b: number) => Math.floor((2 * b * level) / 100);
  const withNature = (stat: StatKey, raw: number) => Math.floor(raw * natureMultiplier(nature, stat));
  return {
    maxHp: scale(base.hp) + level + 10,
    attack: withNature("attack", scale(base.attack) + 5),
    defense: withNature("defense", scale(base.defense) + 5),
    spAttack: withNature("spAttack", scale(base.spAttack) + 5),
    spDefense: withNature("spDefense", scale(base.spDefense) + 5),
    speed: withNature("speed", scale(base.speed) + 5),
  };
}
