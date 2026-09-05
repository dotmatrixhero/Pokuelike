import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import { stepToward } from "./movement.js";
import { isPreyOfAnything } from "./predation.js";

/**
 * How far an idle agent tolerates being from its herd's centroid before
 * drifting back. Exported so herdMigration.ts can reuse the same "how far
 * counts as local" answer for its own resource-sampling radius, rather than
 * picking a second, possibly-inconsistent number.
 */
export const COHESION_DISTANCE = 5;
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
 * An agent's standing within its herd, per DESIGN.md's "Herd status: level
 * buys real standing" section: 1 = highest-ranked (highest level) living
 * herd-mate, counting up from there. Deliberately derived live every call,
 * the same "no registry, scan `world.agents` on demand" convention every
 * other herd-aware system here already follows (`herdCentroid` above,
 * `herdMigration.ts`'s herd-list derivation, `dispersal.ts`'s
 * `findNearbyOtherHerd`) — nothing is cached or stored on `Agent`, so a
 * level-up, a death, or a birth changes every affected agent's rank the very
 * next time this is called, never a stale snapshot.
 *
 * Membership is herd-wide, not restricted to the caller's current `layer`
 * (unlike `herdCentroid`/cohesion, which are inherently spatial) — status is
 * a social fact about the herd, not a local one; a Diglett foraging on the
 * surface doesn't lose or gain rank relative to underground herd-mates it
 * isn't currently standing near. Solitary agents (no `herdId`) are trivially
 * rank 1 of 1 — nothing to outrank.
 *
 * Ties (equal `level`) are broken by `id` (ascending string comparison) —
 * arbitrary but deterministic, so two same-level herd-mates get a stable,
 * reproducible order across calls/ticks instead of one that depends on
 * `Array.prototype.sort`'s stability guarantees interacting with insertion
 * order in some indirect way.
 */
export function herdRank(world: World, agent: Agent): number {
  if (!agent.herdId) return 1;

  const members = world.agents
    .filter((other) => other.alive !== false && !other.isEgg && other.herdId === agent.herdId)
    .sort((a, b) => (b.level ?? 1) - (a.level ?? 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const index = members.findIndex((member) => member.id === agent.id);
  return index === -1 ? members.length + 1 : index + 1;
}

/** Herd size backing `herdRank`'s denominator — living members sharing `herdId`, any layer. */
export function herdSize(world: World, herdId: string): number {
  return world.agents.filter((other) => other.alive !== false && !other.isEgg && other.herdId === herdId).length;
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
    (other) => other.alive !== false && !other.isEgg && other.herdId === herdId && other.layer === layer
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
      other.alive !== false &&
      !other.isEgg &&
      other.herdId === herdId &&
      other.layer === layer &&
      isPreyOfAnything(rules, world, other)
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
 *
 * **Herd migration** (see herdMigration.ts/DESIGN.md): when
 * `world.herdMigrations` has an active entry for this agent's `herdId`,
 * *everyone* — ordinary members and guardians alike — pulls toward the
 * shared migration target instead of the live centroid, so the whole herd
 * actually walks together toward one real destination rather than each
 * member drifting toward its own idea of "the group." A guardian still
 * keeps its tighter `GUARDIAN_COHESION_DISTANCE` leash while migrating
 * (simplest reasonable choice: it tracks the same shared point everyone
 * else does, just tolerates less drift from it, rather than computing some
 * separate "vicinity of the target" offset) — a deliberate scope call,
 * documented here and in DESIGN.md, not a distinction the design doc forced
 * either way.
 */
export function applyHerdCohesion(world: World, agent: Agent, rules?: HuntRules): boolean {
  if (!agent.herdId) return false;

  const isGuardian = rules !== undefined && !isPreyOfAnything(rules, world, agent);
  const migration = world.herdMigrations?.[agent.herdId];
  const centroid = migration
    ? migration.target
    : isGuardian
      ? protectedHerdCentroid(world, agent.herdId, agent.layer, rules!)
      : herdCentroid(world, agent.herdId, agent.layer);
  const distance = isGuardian ? GUARDIAN_COHESION_DISTANCE : COHESION_DISTANCE;
  if (!centroid || manhattan(agent.pos, centroid) <= distance) return false;

  agent.pos = stepToward(world, agent.layer, agent.pos, centroid);
  return true;
}
