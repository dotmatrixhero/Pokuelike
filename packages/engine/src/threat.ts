import type { Agent, World } from "./types.js";
import { trustFleeFactor, trustStage } from "./trust.js";

/**
 * Threat signature — ROADMAP.md M6, PLAYER_INVENTORY.md. What the player
 * reads as to a creature deciding whether to bolt: not a species flag but
 * how they move, how they stand, and what is in their hand.
 *
 * Replaces M0's `isPredator: true` on the human. Prey used to flee the
 * player inside the ordinary radius no matter what; now a crouched,
 * unarmed, still human reads as half a threat and a running one with a
 * club as a large one. `predation.ts` multiplies the prey's own flee
 * radius by this number for the player specifically.
 *
 * Magnitudes are sim-original guesses to be judged against
 * `validateBond.ts`, not canon:
 *   base 1.0 · crouched ×0.5 · moved this turn ×1.25 · held item + its
 *   `threat` · worn item ×(1 + its `threat`) · clamped to 0..2.
 * A cloak is `threat: -0.4` (×0.6); a club `+0.5`; a torch `+0.3` (the
 * "seen from further" cost CRAFTABLES_V1.md names).
 */
export function threatSignatureOf(world: World, agent: Agent): number {
  if (agent.controlledBy !== "player") return 0;
  let sig = 1;
  if (agent.posture === "crouch") sig *= 0.5;
  if (agent.lastActionOutcome?.action.kind === "move" && agent.lastActionOutcome.ok) sig *= 1.25;
  const held = agent.equipment?.held ? world.items?.[agent.equipment.held] : undefined;
  if (held?.threat) sig += held.threat;
  const worn = agent.equipment?.worn ? world.items?.[agent.equipment.worn] : undefined;
  if (worn?.threat) sig *= 1 + worn.threat;
  return Math.max(0, Math.min(2, sig));
}

/**
 * A creature's effective flee radius against the player: its own radius,
 * scaled by the player's signature, scaled again by how far it has come
 * to trust them (trust.ts's `trustFleeFactor`). Under 1 tile means "does
 * not read as a threat at all" — a bonded creature never flees the player.
 */
export function playerFleeRadius(world: World, player: Agent, baseRadius: number, observer?: Agent): number {
  const trust = observer ? trustFleeFactor(trustStage(world, observer, player.id)) : 1;
  return baseRadius * threatSignatureOf(world, player) * trust;
}
