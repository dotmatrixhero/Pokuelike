/**
 * Elevation-delta modifiers for combat, standalone until a combat resolver
 * exists to consume them (see DESIGN.md's promotion boundary). Higher
 * ground favors the attacker's accuracy and the defender's evasion, each
 * capped so a huge height gap can't make a move unmissable/unavoidable.
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

/** Evasion modifier for a defender standing on `defenderElevation` against `attackerElevation`. */
export function elevationEvasionModifier(defenderElevation: number, attackerElevation: number): number {
  const delta = defenderElevation - attackerElevation;
  return clamp(delta * EVASION_PER_ELEVATION, -MODIFIER_CAP, MODIFIER_CAP);
}
