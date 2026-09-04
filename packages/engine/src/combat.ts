import type { Agent } from "./types.js";
import type { MoveSpec } from "./moves.js";
import type { PokemonType } from "./typing.js";
import { typeEffectiveness } from "./typing.js";

export interface DamageResult {
  damage: number;
  effectiveness: number;
  stab: boolean;
  critical: boolean;
}

/**
 * Mainline critical-hit chance by crit stage (stage 0 = base rate), Gen VI+
 * values: 1/24, 1/8, 1/2, always. Stage is clamped to [0, 3] — nothing in the
 * sim currently grants crit-stage bonuses, so every roll uses stage 0 unless
 * a caller passes one explicitly.
 */
export const CRIT_STAGE_CHANCE: readonly number[] = [1 / 24, 1 / 8, 1 / 2, 1];

/** Mainline (Gen VI+) critical-hit damage multiplier. */
export const CRITICAL_MULTIPLIER = 1.5;

/** Rolls whether a hit at the given crit stage is a critical hit. */
export function rollCritical(critStage = 0, rng: () => number = Math.random): boolean {
  const stage = Math.max(0, Math.min(3, Math.floor(critStage)));
  return rng() < CRIT_STAGE_CHANCE[stage];
}

/**
 * Mainline stat-stage multiplier: a stage of +N multiplies the base stat by
 * (2+N)/2 (capped at 4x per side), -N by 2/(2-N). Stage is clamped to
 * [-6, +6]. Applies to Attack/Defense/SpAttack/SpDefense/Speed — accuracy and
 * evasion use a different formula, see `accuracyStageMultiplier`.
 */
export function statStageMultiplier(stage: number): number {
  const clamped = Math.max(-6, Math.min(6, Math.round(stage)));
  return Math.max(2, 2 + clamped) / Math.max(2, 2 - clamped);
}

/**
 * Mainline accuracy/evasion-stage multiplier (a different formula from
 * `statStageMultiplier`, base 3 instead of base 2): the net (accuracy stage -
 * evasion stage), each independently clamped to [-6, +6] beforehand, is 1 at
 * 0, up to 3x at +6 net, down to 1/3x at -6 net.
 */
export function accuracyStageMultiplier(accuracyStage: number, evasionStage: number): number {
  const acc = Math.max(-6, Math.min(6, Math.round(accuracyStage)));
  const eva = Math.max(-6, Math.min(6, Math.round(evasionStage)));
  const diff = acc - eva;
  if (diff === 0) return 1;
  return diff > 0 ? (3 + Math.min(diff, 6)) / 3 : 3 / (3 + Math.min(-diff, 6));
}

/**
 * Rolls whether a move hits. `move.accuracy` of -1 (or any negative value,
 * PokeRogue's convention for "can't miss") always hits regardless of
 * stages/`extraMultiplier` — a guaranteed-hit move stays guaranteed even
 * mid-storm, matching how it already ignores accuracy/evasion stages.
 * Stages default to 0 (no agent in the sim currently has accuracy/evasion
 * stages), so `accuracyStageMultiplier` is a no-op multiplier until
 * something changes them — but the roll itself is real: a move with
 * `accuracy < 100` can now actually miss. See TODO.md.
 *
 * `extraMultiplier` (default 1) is a second, independent multiplier on top
 * of the stage-based one — currently weather.ts's Phase 3 storm accuracy
 * penalty (`stormAccuracyMultiplier`) is the only real caller, but it's a
 * plain multiplier rather than a storm-specific parameter so any future
 * accuracy-affecting effect composes the same way rather than needing its
 * own bespoke parameter.
 */
export function rollAccuracy(
  move: Pick<MoveSpec, "accuracy">,
  accuracyStage = 0,
  evasionStage = 0,
  rng: () => number = Math.random,
  extraMultiplier = 1
): boolean {
  if (move.accuracy < 0) return true;
  const chance = move.accuracy * accuracyStageMultiplier(accuracyStage, evasionStage) * extraMultiplier;
  return rng() * 100 < chance;
}

export interface CombatantOffense {
  level: number;
  types: PokemonType[];
  stats: { attack: number; spAttack: number };
  /** Battle-only volatile stat stages, e.g. from a boosting move. Absent = all 0. */
  statStages?: { attack?: number; spAttack?: number };
}

export interface CombatantDefense {
  types: PokemonType[];
  stats: { defense: number; spDefense: number };
  statStages?: { defense?: number; spDefense?: number };
}

/**
 * The mainline damage formula, with stat stages and an optional critical hit
 * folded in: (((2*level/5 + 2) * power * effectiveAtk/effectiveDef) / 50 + 2)
 * * STAB * type * crit. `randomFactor` is the 0.85-1x mainline damage roll —
 * pass it explicitly so callers can be deterministic in tests and random in
 * the actual sim. An immune matchup (0x) deals 0, not the usual floor-of-1
 * minimum. On a critical hit, mainline rules ignore a negative attacker
 * stage and a positive defender stage (a crit can't be worse than a normal
 * hit) before applying `CRITICAL_MULTIPLIER`.
 */
export function calculateDamage(
  attacker: CombatantOffense,
  defender: CombatantDefense,
  move: MoveSpec,
  randomFactor = 1,
  isCritical = false
): DamageResult {
  const effectiveness = typeEffectiveness(move.type, defender.types);
  if (effectiveness === 0) return { damage: 0, effectiveness, stab: false, critical: false };

  const isPhysical = move.category === "physical";
  const rawAttackStat = isPhysical ? attacker.stats.attack : attacker.stats.spAttack;
  const rawDefenseStat = isPhysical ? defender.stats.defense : defender.stats.spDefense;

  let attackStage = (isPhysical ? attacker.statStages?.attack : attacker.statStages?.spAttack) ?? 0;
  let defenseStage = (isPhysical ? defender.statStages?.defense : defender.statStages?.spDefense) ?? 0;
  if (isCritical) {
    attackStage = Math.max(attackStage, 0);
    defenseStage = Math.min(defenseStage, 0);
  }
  const attackStat = rawAttackStat * statStageMultiplier(attackStage);
  const defenseStat = rawDefenseStat * statStageMultiplier(defenseStage);

  const stab = attacker.types.includes(move.type);
  const critMultiplier = isCritical ? CRITICAL_MULTIPLIER : 1;

  const base = (((2 * attacker.level) / 5 + 2) * move.power * (attackStat / defenseStat)) / 50 + 2;
  const damage = Math.max(1, Math.floor(base * (stab ? 1.5 : 1) * effectiveness * critMultiplier * randomFactor));

  return { damage, effectiveness, stab, critical: isCritical };
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

/**
 * Derives the old shape-only reach (point=1, line/cone=their length,
 * ring/burst=1 since they're centered on the caster, not aimed at a target
 * tile) — used only as a fallback for a `MoveSpec` that doesn't set `range`
 * explicitly (older test fixtures, hand-rolled specs). The curated roster in
 * packages/data sets `range` directly instead of relying on this.
 */
function deriveRangeFromShape(move: MoveSpec): number {
  switch (move.shape.kind) {
    case "point":
      return 1;
    case "line":
      return move.shape.length;
    case "cone":
      return move.shape.length;
    case "ring":
    case "burst":
      return 1;
  }
}

/**
 * How far a move reaches in a straight line toward its target — used by
 * predation.ts to decide "attack now" vs. "close distance" instead of
 * assuming everything is melee. Reads `move.range.max` when set (see
 * moves.ts); falls back to deriving it from `shape` when it isn't.
 */
export function moveRange(move: MoveSpec): number {
  return move.range?.max ?? deriveRangeFromShape(move);
}

/**
 * Full range check, including `min` (0 for every curated move today — see
 * moves.ts — but a future thrown-only move could set it above 0 to mean
 * "can't be used at melee"). Prefer this over a bare `distance <=
 * moveRange(move)` comparison wherever the caller has a real distance to a
 * target, since it's the one that actually honors `min`.
 */
export function withinMoveRange(move: MoveSpec, distance: number): boolean {
  const min = move.range?.min ?? 0;
  return distance >= min && distance <= moveRange(move);
}
