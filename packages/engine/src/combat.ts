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
  let effectiveness = typeEffectiveness(move.type, defender.types);
  if (effectiveness === 0) return { damage: 0, effectiveness, stab: false, critical: false };
  // `resistanceBreaker` partially cancels a type-chart resist (0 < eff < 1)
  // by multiplying it up, capped at neutral (1) — it can never turn a resist
  // into an actual weakness, only claw it back toward neutral.
  if (move.resistanceBreaker && effectiveness < 1) {
    effectiveness = Math.min(1, effectiveness * move.resistanceBreaker.multiplier);
  }

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
  // `defensePenetration` (0-1) shaves a flat fraction off the defender's
  // Defense/SpDefense before stages even apply — a Piercing Beak-style
  // "ignores some of the target's bulk," independent of (and composing
  // with) stat stages rather than replacing them.
  const defenseStat = rawDefenseStat * (1 - (move.defensePenetration ?? 0)) * statStageMultiplier(defenseStage);

  const stab = attacker.types.includes(move.type);
  const critMultiplier = isCritical ? CRITICAL_MULTIPLIER : 1;

  const base = (((2 * attacker.level) / 5 + 2) * move.power * (attackStat / defenseStat)) / 50 + 2;
  const bonusVsType = move.bonusVsType && defender.types.includes(move.bonusVsType.type) ? move.bonusVsType.multiplier : 1;
  const damage = Math.max(1, Math.floor(base * (stab ? 1.5 : 1) * effectiveness * critMultiplier * randomFactor * bonusVsType));

  return { damage, effectiveness, stab, critical: isCritical };
}

/** Cooldowns tick down for every agent that has any, regardless of what it does this tick. */
/**
 * `ticks` (default 1) is how many cooldown ticks to subtract this call —
 * needs.ts's sleep effects pass a larger value so cooldowns (this sim's
 * real stand-in for mainline PP) recover faster while an agent sleeps, the
 * same optional-multiplier shape `decayNeeds`'s `thirstMultiplier` and
 * `applyHealOverTime`'s multiplier already use. Every pre-existing caller
 * that doesn't pass it keeps ticking down at exactly the original rate.
 */
export function tickCooldowns(agent: Agent, ticks = 1): void {
  if (!agent.moveCooldowns) return;
  for (const moveId of Object.keys(agent.moveCooldowns)) {
    const remaining = agent.moveCooldowns[moveId]! - ticks;
    if (remaining <= 0) delete agent.moveCooldowns[moveId];
    else agent.moveCooldowns[moveId] = remaining;
  }
}

/**
 * How much a move's own `cooldownTicks` discounts its score in
 * `pickBestMove` — small on purpose. At 0.15, a 3-tick cooldown discounts a
 * move to ~69% of its raw power/STAB/effectiveness score: enough that a
 * fast, modest move can beat a slow, only-somewhat-stronger one (real tempo
 * awareness), but not enough to override a genuine type/STAB advantage on
 * its own (a 3x-effective move stays clearly ahead of a same-power neutral
 * one even at a real cooldown gap) — see DESIGN.md's "Move selection"
 * section for the worked-through numbers that picked this constant.
 */
export const MOVE_SCORE_TEMPO_WEIGHT = 0.15;

/**
 * Picks the off-cooldown, in-range (when `distance` is given) move that does
 * the most expected damage per tick against `defenderTypes` — a simple
 * greedy heuristic, not full tactical planning. Undefined means nothing
 * usable: every move is on cooldown, or (when `distance` is given) none of
 * the off-cooldown moves actually reach that far.
 *
 * `distance` is optional and, when omitted, this ignores range entirely —
 * kept for the handful of callers (bare unit tests among them) that only
 * want a raw damage comparison with no positional context. Every real
 * combat call site should pass it: without it, this used to happily return
 * a move that scores highest on paper but can't actually be used from here,
 * which `canAttackFromHere` would then reject outright even when a
 * different owned move *was* in range — a real bug, not a hypothetical one,
 * fixed by filtering to reachable moves before scoring instead of scoring
 * first and checking range after.
 */
export function pickBestMove(attacker: Agent, defenderTypes: PokemonType[], distance?: number): MoveSpec | undefined {
  // `burrow` moves (a flee-only escape, resolved directly in predation.ts's
  // flee branch) never make sense as an attack, so they're excluded here.
  // `targetsAlly` moves are NOT excluded, on purpose: the ally-buff/heal
  // itself only ever resolves via `applySupportMove` (support.ts) on the
  // agent's own idle/support tick, which runs strictly after predation
  // already gets first refusal (needs.ts) — so a `targetsAlly` move is a
  // real, ordinary attack option here (using whatever power/accuracy/other
  // combat deltas it's accumulated) whenever the agent is actually in a
  // fight, and only ever gets its support effect on a tick with nothing
  // hostile going on. One move, two contexts, additive rather than a
  // branch that trades its combat identity away for a support one.
  const offCooldown = (attacker.moves ?? []).filter((move) => !attacker.moveCooldowns?.[move.id] && !move.burrow);
  const available = distance === undefined ? offCooldown : offCooldown.filter((move) => withinMoveRange(move, distance));
  if (available.length === 0) return undefined;

  const selfLowHp = attacker.hp !== undefined && attacker.maxHp !== undefined && attacker.maxHp > 0 && attacker.hp / attacker.maxHp <= 0.5;

  let best: MoveSpec | undefined;
  let bestScore = -Infinity;
  for (const move of available) {
    const stab = attacker.types?.includes(move.type) ? 1.5 : 1;
    const tempo = 1 / (1 + MOVE_SCORE_TEMPO_WEIGHT * move.cooldownTicks);
    // A multi-hit move's expected damage scales with its average hit count —
    // scoring by single-hit power alone would undervalue it against a
    // one-hit move of similar per-hit power.
    const avgHits = move.hits ? (move.hits.min + move.hits.max) / 2 : 1;
    const selfBonus = move.selfStateBonus?.condition === "selfLowHp" && selfLowHp ? move.selfStateBonus.multiplier : 1;
    let effectiveness = typeEffectiveness(move.type, defenderTypes);
    if (move.resistanceBreaker && effectiveness < 1) effectiveness = Math.min(1, effectiveness * move.resistanceBreaker.multiplier);
    const bonusVsType = move.bonusVsType && defenderTypes.includes(move.bonusVsType.type) ? move.bonusVsType.multiplier : 1;
    const score = move.power * stab * effectiveness * tempo * avgHits * selfBonus * bonusVsType;
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
  if (move.lockTicks) agent.actionLockTicks = (agent.actionLockTicks ?? 0) + move.lockTicks;
  agent.moveUseCounts = agent.moveUseCounts ?? {};
  agent.moveUseCounts[move.id] = (agent.moveUseCounts[move.id] ?? 0) + 1;
}

/** Rolls a random hit count within `hits`' [min, max] range (inclusive) — undefined `hits` always means exactly 1 hit. */
export function rollHitCount(hits: { min: number; max: number } | undefined, rng: () => number = Math.random): number {
  if (!hits) return 1;
  return hits.min + Math.floor(rng() * (hits.max - hits.min + 1));
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
