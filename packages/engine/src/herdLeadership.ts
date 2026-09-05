import type { Agent, World } from "./types.js";
import type { Disposition } from "./nature.js";
import type { EventLog } from "./events.js";

/**
 * Herd Leadership — builds directly on Notables (see notables.ts,
 * DESIGN.md's "Notables" section) and Disposition (nature.ts). Direct,
 * verbatim ask: "I think over time they can lead their herd if there are no
 * other notables (there can be multiple in a herd but only one can lead) and
 * then their herd sorta changes to follow their behaviors a bit." Confirmed
 * follow-up: tie-break multiple eligible candidates by seniority (whoever's
 * held their qualifying status longest), and blend the leader's Disposition
 * into herd-mates' effective behavior. See DESIGN.md's "Herd Leadership"
 * section for the full design and real multi-seed calibration numbers.
 *
 * **Eligibility.** Only a currently-titled agent (`Agent.notableTitle !==
 * undefined`) is eligible to lead — a titled agent already earned a real,
 * global, "gotta earn it" record; leadership is that same earned standing
 * translated into local, herd-scoped authority, not a second independent
 * bar. An agent stops being eligible the instant it loses its title, leaves/
 * changes herd, or dies — checked fresh every tick in `updateHerdLeadership`
 * below, immediately after `updateNotables` has already resolved this tick's
 * title transfers (see simulation.ts's `tickWorld`).
 *
 * **Promotion rule, and the deliberate "no re-evaluation" guard.** A herd
 * gets a leader when it has at least one eligible member and currently has
 * no leader. Among multiple eligible candidates, the one with the lowest
 * `World.notables[title].claimedAtTick` (longest-held current title) wins —
 * see `NotableRecord.claimedAtTick`'s doc comment for why this is the
 * seniority clock (an agent's tenure under whichever title it holds RIGHT
 * NOW, not a broader "ever eligible" history that would need extra state).
 * Critically, a herd's leadership is only ever *re-evaluated* when something
 * changes for THAT herd specifically — its current leader becomes
 * ineligible, or the herd's eligible-member count goes from zero to
 * nonzero. A herd with a perfectly fine, still-eligible leader is never
 * swapped out just because a nominally more-senior candidate happens to
 * exist somewhere else in the world; that would make leadership flap/churn
 * purely from unrelated title activity in other herds, which the direct ask
 * ("their herd sorta changes to follow their behaviors") implies should be a
 * real, comparatively stable relationship, not noise.
 */

/**
 * How strongly a herd-mate's *effective* Disposition is pulled toward its
 * herd's current leader's own Disposition — see `effectiveDisposition`.
 * 0.2: a real, measurable nudge (roughly a fifth of the gap between a
 * follower's own value and its leader's is closed) without erasing
 * individual variance — deliberately inside this codebase's existing
 * "modest, real nudge" range (`RAPPORT_MOB_DEFENSE_DELTA`/
 * `NOTABLE_DISTANCE_BONUS` are similarly "clearly felt, never dominant"
 * magnitudes on their own scales), landing in the middle of the task's own
 * suggested 0.15-0.25 band rather than either edge: strong enough that a
 * genuinely bold leader visibly shifts a timid herd's flee/hunt/mob
 * thresholds over a real run, but never strong enough that a herd-mate's own
 * nature stops mattering (a maximally-different follower still keeps 80% of
 * its own value).
 */
export const LEADERSHIP_DISPOSITION_BLEND_WEIGHT = 0.2;

const NEUTRAL_DISPOSITION: Disposition = { boldness: 0.5, aggression: 0.5, sociability: 0.5 };

function isLivingNonEgg(agent: Agent): boolean {
  return agent.alive !== false && agent.isEgg !== true;
}

/**
 * This agent's own Disposition, nudged toward its herd's current leader's
 * Disposition by `LEADERSHIP_DISPOSITION_BLEND_WEIGHT` — the mechanical
 * shape of "their herd sorta changes to follow their behaviors a bit."
 * Returns the agent's own (or neutral-fallback, matching every other
 * disposition consumer's `?? 0.5` convention) Disposition UNCHANGED when:
 * the herd has no leader, the agent itself IS the leader (a leader leads, it
 * doesn't follow itself), or the agent has no herd at all. Pure, no rng, no
 * mutation — safe to call from any read site the six existing per-individual
 * disposition consumers already call from (predation.ts, herdConflict.ts,
 * dispersal.ts, reproduction.ts — see DESIGN.md's "Herd Leadership" section
 * for why herdMigration.ts's own herd-*aggregate* disposition read is
 * handled separately instead of through this function).
 */
export function effectiveDisposition(world: World, agent: Agent): Disposition {
  const own = agent.disposition ?? NEUTRAL_DISPOSITION;
  if (!agent.herdId) return own;
  const leaderId = world.herdLeaders?.[agent.herdId];
  if (!leaderId || leaderId === agent.id) return own;
  const leader = world.agents.find((a) => a.id === leaderId);
  if (!leader) return own;
  const target = leader.disposition ?? NEUTRAL_DISPOSITION;
  const w = LEADERSHIP_DISPOSITION_BLEND_WEIGHT;
  return {
    boldness: own.boldness + (target.boldness - own.boldness) * w,
    aggression: own.aggression + (target.aggression - own.aggression) * w,
    sociability: own.sociability + (target.sociability - own.sociability) * w,
  };
}

/**
 * Once per world tick (see `tickWorld`, simulation.ts), immediately after
 * `updateNotables` has resolved this tick's title transfers: re-checks every
 * herd that currently has a leader (demoting one that's become ineligible,
 * then immediately promoting the herd's next-best remaining candidate if any
 * exists), then promotes a leader for any herd that now has an eligible
 * member but never had a leader — see this module's top-of-file doc comment
 * for the full mechanism and the deliberate no-churn guarantee. Pure
 * bookkeeping plus `leadershipClaimed`/`leadershipLost` event emission; no
 * rng, so it doesn't affect determinism.
 */
export function updateHerdLeadership(world: World, log?: EventLog): void {
  // The best (most senior) eligible candidate per herd, computed once up
  // front — used both to find a demoted herd's replacement and to promote a
  // never-led herd's first leader. "Best" = lowest claimedAtTick for the
  // agent's own current title (longest tenure); ties broken by agent id
  // (stable, deterministic, no rng — an arbitrary but reproducible order,
  // the same role plain id/insertion-order tie-breaks play elsewhere in this
  // codebase when nothing more meaningful distinguishes two candidates).
  const bestByHerd = new Map<string, Agent>();
  const claimTickOf = (a: Agent): number => world.notables?.[a.notableTitle!]?.claimedAtTick ?? world.tick;
  for (const a of world.agents) {
    if (!isLivingNonEgg(a) || a.notableTitle === undefined || !a.herdId) continue;
    const current = bestByHerd.get(a.herdId);
    if (!current) {
      bestByHerd.set(a.herdId, a);
      continue;
    }
    const currentClaim = claimTickOf(current);
    const candidateClaim = claimTickOf(a);
    if (candidateClaim < currentClaim || (candidateClaim === currentClaim && a.id < current.id)) {
      bestByHerd.set(a.herdId, a);
    }
  }

  world.herdLeaders = world.herdLeaders ?? {};

  const promote = (herdId: string, agent: Agent, previousLeaderId: string | undefined): void => {
    agent.isHerdLeader = true;
    world.herdLeaders![herdId] = agent.id;
    log?.record({ kind: "leadershipClaimed", tick: world.tick, herdId, agentId: agent.id, species: agent.species, previousLeaderId });
  };

  // Re-check every herd that currently has a leader: demote + immediately
  // hand off to the herd's next-best remaining candidate if one's still
  // eligible there, otherwise the herd genuinely goes leaderless (a real,
  // possible state — see notableTitles.ts's herdDisplayName fallback).
  for (const herdId of Object.keys(world.herdLeaders)) {
    const leaderId = world.herdLeaders[herdId];
    const leaderAgent = world.agents.find((a) => a.id === leaderId);
    const stillEligible = leaderAgent !== undefined && isLivingNonEgg(leaderAgent) && leaderAgent.notableTitle !== undefined && leaderAgent.herdId === herdId;
    if (stillEligible) continue; // No churn: a still-eligible leader is never re-evaluated just because a more-senior candidate exists elsewhere.

    delete world.herdLeaders[herdId];
    if (leaderAgent) {
      leaderAgent.isHerdLeader = undefined;
      const reason = !isLivingNonEgg(leaderAgent) ? "died" : leaderAgent.herdId !== herdId ? "herdChanged" : "titleLost";
      log?.record({ kind: "leadershipLost", tick: world.tick, herdId, agentId: leaderAgent.id, species: leaderAgent.species, reason });
    }

    const replacement = bestByHerd.get(herdId);
    if (replacement) promote(herdId, replacement, leaderId);
  }

  // Herds with an eligible member but no leader yet at all (the common
  // "gained its first eligible member" case — a herd whose leader was JUST
  // demoted above and immediately re-promoted is already excluded, since
  // `world.herdLeaders[herdId]` is set again by `promote` before this loop
  // runs).
  for (const [herdId, candidate] of bestByHerd) {
    if (world.herdLeaders[herdId]) continue;
    promote(herdId, candidate, undefined);
  }
}
