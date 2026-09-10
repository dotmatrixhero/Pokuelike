import type { Agent, World } from "./types.js";
import type { EventLog } from "./events.js";
import { rapportScore } from "./rapport.js";

/**
 * Trust stages — ROADMAP.md M6. A creature's rapport edge *toward the
 * player* (the same edges every agent holds toward every other), read as
 * four words a player can act on. Thresholds are sim-original guesses;
 * the user rules on them once `validateBond.ts` shows what they cost in
 * turns of feeding.
 *
 * The stage has teeth: it scales how close the player can come before
 * the creature bolts (threat.ts's `playerFleeRadius`). Wary is the full
 * threat-signature radius; tolerant halves it; curious quarters it; bonded
 * does not flee the player at all. That is what "She has stopped watching
 * you." means mechanically — and it is why the first berry has to be set
 * down and walked away from, while the fifth can be handed over.
 */
export type TrustStage = "wary" | "tolerant" | "curious" | "bonded";

export const TRUST_TOLERANT = 0.05;
export const TRUST_CURIOUS = 0.2;
export const TRUST_BONDED = 0.5;

export function trustStage(world: World, agent: Agent, playerId: string): TrustStage {
  const score = rapportScore(agent, playerId, world.tick);
  if (score >= TRUST_BONDED) return "bonded";
  if (score >= TRUST_CURIOUS) return "curious";
  if (score >= TRUST_TOLERANT) return "tolerant";
  return "wary";
}

/** Multiplier on the flee radius the creature applies to the player. */
export function trustFleeFactor(stage: TrustStage): number {
  return stage === "bonded" ? 0 : stage === "curious" ? 0.25 : stage === "tolerant" ? 0.5 : 1;
}

/** How far a curious creature will notice the player leaving and decide to come. */
export const FOLLOW_ENTRY_RADIUS = 3;
/** Per player turn, for a curious creature within range: chance it starts following. Sim-original. */
export const FOLLOW_ENTRY_CHANCE = 0.05;

/**
 * The follower door, run once per player turn. A creature at `curious` or
 * better, awake, within `FOLLOW_ENTRY_RADIUS`, rolls to start following;
 * one already following whose trust has fallen below `tolerant` stops.
 */
export function tickFollowers(world: World, player: Agent, log?: EventLog, rng: () => number = world.rng): void {
  for (const other of world.agents) {
    if (other.id === player.id || other.alive === false || other.isEgg || other.controlledBy) continue;
    const stage = trustStage(world, other, player.id);
    if (other.followingId === player.id) {
      if (stage === "wary") {
        other.followingId = undefined;
        log?.record({ kind: "stoppedFollowing", tick: world.tick, agentId: other.id, species: other.species, targetId: player.id, targetSpecies: player.species });
      }
      continue;
    }
    if (other.refusedFollow || other.asleep || other.fainted || other.layer !== player.layer) continue;
    if (stage !== "curious" && stage !== "bonded") continue;
    if (Math.abs(other.pos.x - player.pos.x) + Math.abs(other.pos.y - player.pos.y) > FOLLOW_ENTRY_RADIUS) continue;
    if (rng() >= FOLLOW_ENTRY_CHANCE * (stage === "bonded" ? 2 : 1)) continue;
    other.followingId = player.id;
    log?.record({ kind: "startedFollowing", tick: world.tick, agentId: other.id, species: other.species, targetId: player.id, targetSpecies: player.species });
  }
}
