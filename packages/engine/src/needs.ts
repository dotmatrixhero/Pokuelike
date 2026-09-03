import type { Agent, BehaviorKind, Needs, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";

const DECAY_PER_TICK = {
  hunger: 0.01,
  thirst: 0.015,
  energy: 0.005,
  mateDrive: 0.002,
} as const;

export function createNeeds(overrides: Partial<Needs> = {}): Needs {
  return { hunger: 1, thirst: 1, energy: 1, mateDrive: 0, ...overrides };
}

export function decayNeeds(needs: Needs): void {
  needs.hunger = Math.max(0, needs.hunger - DECAY_PER_TICK.hunger);
  needs.thirst = Math.max(0, needs.thirst - DECAY_PER_TICK.thirst);
  needs.energy = Math.max(0, needs.energy - DECAY_PER_TICK.energy);
  needs.mateDrive = Math.min(1, needs.mateDrive + DECAY_PER_TICK.mateDrive);
}

/**
 * Picks the single most urgent need and maps it to a behavior. Thirst and
 * hunger are weighted above mating so herds don't starve chasing romance —
 * tune these thresholds once real playtesting exists.
 */
export function chooseBehavior(needs: Needs): BehaviorKind {
  const urgency: Array<[BehaviorKind, number]> = [
    ["seekWater", 1 - needs.thirst],
    ["seekFood", 1 - needs.hunger],
    ["seekMate", needs.mateDrive * 0.5],
  ];
  urgency.sort((a, b) => b[1] - a[1]);
  const [behavior, score] = urgency[0]!;
  return score > 0.3 ? behavior : "idle";
}

export function findNearestTerrain(
  world: World,
  from: Vec2,
  terrain: "water" | "food" | "sunbeam"
): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestDist = Infinity;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (tileAt(world, x, y)?.terrain !== terrain) continue;
      const dist = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Moves an agent one step toward a target using simple Manhattan stepping. */
export function stepToward(world: World, pos: Vec2, target: Vec2): Vec2 {
  const dx = Math.sign(target.x - pos.x);
  const dy = Math.sign(target.y - pos.y);
  const candidates: Vec2[] = [
    { x: pos.x + dx, y: pos.y + dy },
    { x: pos.x + dx, y: pos.y },
    { x: pos.x, y: pos.y + dy },
  ];
  for (const candidate of candidates) {
    if (candidate.x === pos.x && candidate.y === pos.y) continue;
    if (tileAt(world, candidate.x, candidate.y)?.walkable) return candidate;
  }
  return pos;
}

export function tickAgent(world: World, agent: Agent): void {
  decayNeeds(agent.needs);
  agent.behavior = chooseBehavior(agent.needs);

  if (agent.behavior === "seekWater" || agent.behavior === "seekFood") {
    const target = findNearestTerrain(
      world,
      agent.pos,
      agent.behavior === "seekWater" ? "water" : "food"
    );
    if (target) agent.pos = stepToward(world, agent.pos, target);
  }
}
