import type { Agent, Layer, Vec2, World } from "./types.js";
import { stepToward } from "./movement.js";

/** How far an idle agent tolerates being from its herd's centroid before drifting back. */
const COHESION_DISTANCE = 5;

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
 * Called when an agent is idle (no need urgent enough to act on) and
 * already on its home layer. If it's drifted more than COHESION_DISTANCE
 * from its herd's current center, it walks back toward the group instead
 * of just standing still. Returns true if it moved.
 */
export function applyHerdCohesion(world: World, agent: Agent): boolean {
  if (!agent.herdId) return false;

  const centroid = herdCentroid(world, agent.herdId, agent.layer);
  if (!centroid || manhattan(agent.pos, centroid) <= COHESION_DISTANCE) return false;

  agent.pos = stepToward(world, agent.layer, agent.pos, centroid);
  return true;
}
