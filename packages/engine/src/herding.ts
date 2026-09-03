import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import { stepToward } from "./movement.js";
import { isPreyOfAnything } from "./predation.js";

/** How far an idle agent tolerates being from its herd's centroid before drifting back. */
const COHESION_DISTANCE = 5;
/**
 * A guardian's leash is shorter than an ordinary herd member's. Without
 * this, a guardian's own idle-cohesion target is the *whole* herd's
 * centroid (guardians included), which drifts every time the guardian
 * itself wanders off to eat/drink — diluting the very signal that's
 * supposed to pull it back. A tighter distance plus tracking only the
 * actual prey members (see `protectedHerdCentroid`) means a guardian
 * that strays now corrects toward where the vulnerable herd actually is,
 * not an averaged blob that includes its own drift.
 */
const GUARDIAN_COHESION_DISTANCE = 3;

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * The live average position of every agent sharing `herdId` on `layer` —
 * not a fixed anchor, so the herd's "center" naturally drifts with it over
 * time (e.g. toward wherever most members ended up after foraging).
 * Includes every species with that herdId, so guardians (see predation.ts)
 * pull toward the same center as the herd they protect.
 */
export function herdCentroid(world: World, herdId: string, layer: Layer): Vec2 | undefined {
  const members = world.agents.filter(
    (other) => other.alive !== false && other.herdId === herdId && other.layer === layer
  );
  if (members.length === 0) return undefined;

  const sum = members.reduce((acc, member) => ({ x: acc.x + member.pos.x, y: acc.y + member.pos.y }), {
    x: 0,
    y: 0,
  });
  return { x: Math.round(sum.x / members.length), y: Math.round(sum.y / members.length) };
}

/**
 * Like `herdCentroid`, but only averages members whose species is actually
 * preyed upon by something (per `rules`) — i.e. the herd a guardian is
 * meant to be protecting, not the guardian(s) themselves. Falls back to
 * `herdCentroid` if nothing in the herd qualifies as prey (shouldn't
 * happen for an actual guardian species, but keeps this total).
 */
function protectedHerdCentroid(world: World, herdId: string, layer: Layer, rules: HuntRules): Vec2 | undefined {
  const members = world.agents.filter(
    (other) =>
      other.alive !== false && other.herdId === herdId && other.layer === layer && isPreyOfAnything(rules, other.species)
  );
  if (members.length === 0) return herdCentroid(world, herdId, layer);

  const sum = members.reduce((acc, member) => ({ x: acc.x + member.pos.x, y: acc.y + member.pos.y }), {
    x: 0,
    y: 0,
  });
  return { x: Math.round(sum.x / members.length), y: Math.round(sum.y / members.length) };
}

/**
 * Called when an agent is idle (no need urgent enough to act on) and
 * already on its home layer. If it's drifted too far from where it should
 * be, it walks back toward the group instead of just standing still.
 * Returns true if it moved.
 *
 * A guardian (a species nothing preys on, given `rules`) uses a tighter
 * leash and tracks only the herd's actual prey members — see
 * `GUARDIAN_COHESION_DISTANCE`/`protectedHerdCentroid` — so it stays near
 * the herd it protects instead of the whole herd's (guardians-included)
 * averaged center, which used to let a guardian's own wandering dilute its
 * own pull-back signal. Ordinary herd members keep the old wider leash and
 * whole-herd centroid. Without `rules`, everyone uses the ordinary
 * behavior (bare-engine tests keep working unchanged).
 */
export function applyHerdCohesion(world: World, agent: Agent, rules?: HuntRules): boolean {
  if (!agent.herdId) return false;

  const isGuardian = rules !== undefined && !isPreyOfAnything(rules, agent.species);
  const centroid = isGuardian
    ? protectedHerdCentroid(world, agent.herdId, agent.layer, rules)
    : herdCentroid(world, agent.herdId, agent.layer);
  const distance = isGuardian ? GUARDIAN_COHESION_DISTANCE : COHESION_DISTANCE;
  if (!centroid || manhattan(agent.pos, centroid) <= distance) return false;

  agent.pos = stepToward(world, agent.layer, agent.pos, centroid);
  return true;
}
