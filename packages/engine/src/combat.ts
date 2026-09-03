import type { Agent } from "./types.js";
import type { MoveSpec } from "./moves.js";
import type { PokemonType } from "./typing.js";
import { typeEffectiveness } from "./typing.js";

export interface DamageResult {
  damage: number;
  effectiveness: number;
  stab: boolean;
}

/**
 * The mainline damage formula, simplified (no random 0.85-1x roll baked in —
 * pass `randomFactor` explicitly so callers can be deterministic in tests
 * and random in the actual sim): (((2*level/5 + 2) * power * atk/def) / 50 + 2) * STAB * type.
 * An immune matchup (0x) deals 0, not the usual floor-of-1 minimum.
 */
export function calculateDamage(
  attacker: { level: number; types: PokemonType[]; stats: { attack: number; spAttack: number } },
  defender: { types: PokemonType[]; stats: { defense: number; spDefense: number } },
  move: MoveSpec,
  randomFactor = 1
): DamageResult {
  const effectiveness = typeEffectiveness(move.type, defender.types);
  if (effectiveness === 0) return { damage: 0, effectiveness, stab: false };

  const attackStat = move.category === "physical" ? attacker.stats.attack : attacker.stats.spAttack;
  const defenseStat = move.category === "physical" ? defender.stats.defense : defender.stats.spDefense;
  const stab = attacker.types.includes(move.type);

  const base = (((2 * attacker.level) / 5 + 2) * move.power * (attackStat / defenseStat)) / 50 + 2;
  const damage = Math.max(1, Math.floor(base * (stab ? 1.5 : 1) * effectiveness * randomFactor));

  return { damage, effectiveness, stab };
}

/** Cooldowns tick down for every agent that has any, regardless of what it does this tick. */
export function tickCooldowns(agent: Agent): void {
  if (!agent.moveCooldowns) return;
  for (const moveId of Object.keys(agent.moveCooldowns)) {
    const remaining = agent.moveCooldowns[moveId]! - 1;
    if (remaining <= 0) delete agent.moveCooldowns[moveId];
    else agent.moveCooldowns[moveId] = remaining;
  }
}

/**
 * Picks the off-cooldown move that does the most expected damage against
 * `defenderTypes` — a simple greedy heuristic, not full tactical planning.
 * Undefined means every move is on cooldown (the attacker still closes
 * distance, it just can't land a hit this tick).
 */
export function pickBestMove(attacker: Agent, defenderTypes: PokemonType[]): MoveSpec | undefined {
  const available = (attacker.moves ?? []).filter((move) => !attacker.moveCooldowns?.[move.id]);
  if (available.length === 0) return undefined;

  let best: MoveSpec | undefined;
  let bestScore = -Infinity;
  for (const move of available) {
    const stab = attacker.types?.includes(move.type) ? 1.5 : 1;
    const score = move.power * stab * typeEffectiveness(move.type, defenderTypes);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

export function useMove(agent: Agent, move: MoveSpec): void {
  agent.moveCooldowns = agent.moveCooldowns ?? {};
  agent.moveCooldowns[move.id] = move.cooldownTicks;
}
