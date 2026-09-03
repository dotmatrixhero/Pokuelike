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

/**
 * The mainline games' stat formulas, simplified: assumes a neutral nature
 * and perfect-enough IVs/no EVs (31/0), since we're not modeling training —
 * the point is numbers that feel like Pokemon numbers, not competitive-exact
 * ones. HP: floor(2*base*level/100) + level + 10. Others: floor(2*base*level/100) + 5.
 */
export function calculateStats(base: BaseStats, level: number): Stats {
  const scale = (b: number) => Math.floor((2 * b * level) / 100);
  return {
    maxHp: scale(base.hp) + level + 10,
    attack: scale(base.attack) + 5,
    defense: scale(base.defense) + 5,
    spAttack: scale(base.spAttack) + 5,
    spDefense: scale(base.spDefense) + 5,
    speed: scale(base.speed) + 5,
  };
}
