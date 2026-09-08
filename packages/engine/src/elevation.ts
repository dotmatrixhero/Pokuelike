/**
 * Elevation-delta modifiers for combat. Higher ground favors the attacker's
 * accuracy and the defender's evasion, each capped so a huge height gap
 * can't make a move unmissable/unavoidable.
 *
 * **Now live** via `elevationAccuracyMultiplier` below, which
 * `predation.ts`'s `resolveHitAgainstTarget` and `herdConflict.ts`'s
 * `resolveRivalryHit` compose onto `rollAccuracy`'s `extraMultiplier`
 * alongside the storm penalty. This file stays pure math — the call sites
 * read the tiles, matching how `situationalMultiplier`'s own `"elevation"`
 * case already does it.
 *
 * **Scale caveat, measured — read before tuning these constants.**
 * `Tile.elevation` is a continuous float, not an integer tier, and the
 * deltas between two agents close enough to fight are small: over 6 seeds x
 * 6000 ticks (2,244 real hit attempts) the median |delta| was 0.017, p90
 * 0.783, p99 2.04, max 3.59. At `ACCURACY_PER_ELEVATION` = 0.05 that is a
 * ~4% accuracy swing at p90 and ~18% at the observed maximum, and
 * `MODIFIER_CAP` (which would need |delta| >= 6) is never reached in
 * practice. These constants were plausibly written for integer elevation
 * tiers; against real terrain they are subtle by default. See
 * `packages/runner/src/validateElevationAccuracy.ts` and TODO.md.
 */
const ACCURACY_PER_ELEVATION = 0.05;
const EVASION_PER_ELEVATION = 0.05;
const MODIFIER_CAP = 0.3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Accuracy modifier for an attacker firing from `attackerElevation` at `defenderElevation`. */
export function elevationAccuracyModifier(attackerElevation: number, defenderElevation: number): number {
  const delta = attackerElevation - defenderElevation;
  return clamp(delta * ACCURACY_PER_ELEVATION, -MODIFIER_CAP, MODIFIER_CAP);
}

/**
 * Evasion modifier for a defender standing on `defenderElevation` against
 * `attackerElevation`.
 *
 * **Deliberately NOT applied to the accuracy roll**, and this is the one
 * real trap in this file: with `ACCURACY_PER_ELEVATION` and
 * `EVASION_PER_ELEVATION` equal, this is the exact arithmetic negative of
 * `elevationAccuracyModifier` for the same pair (same delta, opposite sign,
 * symmetric clamp). Applying both to a single hit roll would double-count
 * the same height gap rather than modelling two separate effects. One roll
 * needs one modifier — see `elevationAccuracyMultiplier`.
 *
 * It stays exported because it is the right value for any *separate*
 * defender-side calculation (a dodge check resolved independently of the
 * attacker's roll, or UI showing a defender's terrain advantage on its own
 * terms). It has no callers in the sim today.
 */
export function elevationEvasionModifier(defenderElevation: number, attackerElevation: number): number {
  const delta = defenderElevation - attackerElevation;
  return clamp(delta * EVASION_PER_ELEVATION, -MODIFIER_CAP, MODIFIER_CAP);
}

/**
 * `elevationAccuracyModifier` as a plain multiplier for `rollAccuracy`'s
 * `extraMultiplier` — 1 on level ground, >1 attacking downhill, <1 uphill,
 * bounded to [0.7, 1.3] by `MODIFIER_CAP`.
 *
 * A multiplier rather than an accuracy *stage* because the stage formula
 * (`accuracyStageMultiplier`) is the mainline base-3 curve for discrete
 * -6..+6 stages, which a continuous terrain gradient is not; `extraMultiplier`
 * is the composition point this codebase already uses for exactly this kind
 * of environmental effect (weather.ts's `stormAccuracyMultiplier`), so
 * elevation and weather multiply together without either needing to know
 * about the other.
 */
export function elevationAccuracyMultiplier(attackerElevation: number, defenderElevation: number): number {
  return 1 + elevationAccuracyModifier(attackerElevation, defenderElevation);
}
