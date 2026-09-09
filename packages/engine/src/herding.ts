import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import { stepAway, stepToward } from "./movement.js";
import { isPreyOfAnything, isJuvenile } from "./predation.js";

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
/**
 * How far below its herd's own top living level an agent has to be before
 * it counts as "low-level" for the tighter cohesion leash below — direct
 * report of one-sided fights from the level spread: "lower level Pokemon
 * travel together more." Reuses `GIANT_SLAYER_LEVEL_GAP`'s "5+ levels is a
 * real gap" bar (see predation.ts's `SEVERE_LEVEL_GAP`) rather than a third
 * independently-tuned number for the same underlying idea.
 */
const LOW_LEVEL_COHESION_GAP = 5;
/** Tighter leash than the ordinary `COHESION_DISTANCE` — same magnitude as `GUARDIAN_COHESION_DISTANCE`, for the same reason: staying close to the group is a real survival behavior, not just idle drift-correction. */
const LOW_LEVEL_COHESION_DISTANCE = 3;
/**
 * Direct report, after the earlier attraction-only cohesion shipped:
 * herd-mates that are ALREADY within their leash never move for their own
 * sake, so they pile onto the same tile/cluster and then just sit —
 * TODO.md's own "no personal-space/repulsion behavior" gap. Adjacent
 * (Manhattan 1, "practically touching") is the trigger — genuinely tight,
 * not a general spacing-out rule that would fight the attraction leash
 * above at longer range.
 */
const PERSONAL_SPACE_RADIUS = 1;

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

/** The highest `level` among a herd's living, non-egg members (any layer) — backs `applyHerdCohesion`'s low-level tighter-leash check, see `LOW_LEVEL_COHESION_GAP`. 0 for an empty/nonexistent herd (no living member could ever read as "low-level relative to" it). */
function herdMaxLevel(world: World, herdId: string): number {
  let max = 0;
  for (const other of world.agents) {
    if (other.alive === false || other.isEgg || other.herdId !== herdId) continue;
    if ((other.level ?? 1) > max) max = other.level ?? 1;
  }
  return max;
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

/** The nearest OTHER living, same-herd, same-layer agent within `PERSONAL_SPACE_RADIUS`, if any — backs `applyHerdCohesion`'s repulsion step below. Ties (equal distance) break by `id` for a stable, deterministic pick, same convention `herdRank` already uses. */
function nearestCrowdingHerdmate(world: World, agent: Agent): Agent | undefined {
  let best: Agent | undefined;
  let bestDist = Infinity;
  for (const other of world.agents) {
    if (other.id === agent.id || other.alive === false || other.isEgg) continue;
    if (other.herdId !== agent.herdId || other.layer !== agent.layer) continue;
    const dist = manhattan(agent.pos, other.pos);
    if (dist > PERSONAL_SPACE_RADIUS) continue;
    if (dist < bestDist || (dist === bestDist && best && other.id < best.id)) {
      best = other;
      bestDist = dist;
    }
  }
  return best;
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
 *
 * **Personal-space repulsion**: once an agent is already within its leash
 * (nothing pulling it toward the centroid), it still nudges away from a
 * herd-mate standing right on top of it (`PERSONAL_SPACE_RADIUS`) instead
 * of just stopping there — direct report: idle herd-mates end up clustered
 * on the same tile and then visibly "just stand still." Attraction always
 * takes priority (a genuinely far-flung agent heads home first, spacing
 * out only matters once it's actually back with the group).
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
  // A low-level member relative to its own herd's current top level sticks
  // closer to the group instead of drifting the same wide leash a
  // full-grown/veteran herd-mate tolerates — direct ask: "lower level
  // Pokemon travel together more." Guardians keep their own tighter leash
  // regardless (already the tightest, and level isn't the reason a
  // guardian stays close).
  //
  // `isJuvenile(agent)` is checked directly too, not just inferred from the
  // level gap — direct follow-up ask: "stay closer" (about young
  // specifically, alongside "protect while alive"/"avenge when dead" — see
  // predation.ts's `isBeingHunted`/DESIGN.md). A juvenile is nearly always
  // low-level relative to its herd already, so this mostly overlapped in
  // practice, but a slow-growing herd (or one that's lost its veterans)
  // could leave a genuinely young agent NOT 5+ levels behind anyone —
  // `age`, not just `level`, is the actual thing "young" means here.
  const isLowLevel = !isGuardian && (isJuvenile(agent) || herdMaxLevel(world, agent.herdId) - (agent.level ?? 1) >= LOW_LEVEL_COHESION_GAP);
  const distance = isGuardian ? GUARDIAN_COHESION_DISTANCE : isLowLevel ? LOW_LEVEL_COHESION_DISTANCE : COHESION_DISTANCE;
  if (!centroid || manhattan(agent.pos, centroid) <= distance) {
    const crowder = nearestCrowdingHerdmate(world, agent);
    if (!crowder) return false;
    const before = { ...agent.pos };
    agent.pos = stepAway(world, agent.layer, agent.pos, crowder.pos, agent, agent);
    return agent.pos.x !== before.x || agent.pos.y !== before.y;
  }

  agent.pos = stepToward(world, agent.layer, agent.pos, centroid, agent, agent);
  return true;
}
