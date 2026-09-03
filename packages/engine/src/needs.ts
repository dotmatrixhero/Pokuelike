import type { Agent, BehaviorKind, Layer, Needs, Vec2, World } from "./types.js";
import { otherLayers, tileAt } from "./world.js";
import type { EventLog } from "./events.js";

const DECAY_PER_TICK = {
  hunger: 0.01,
  thirst: 0.015,
  energy: 0.005,
  mateDrive: 0.002,
} as const;

const CONSUME_RATE = {
  seekWater: { need: "thirst", amount: 0.4 },
  seekFood: { need: "hunger", amount: 0.4 },
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
  layer: Layer,
  from: Vec2,
  terrain: "water" | "food" | "sunbeam"
): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestDist = Infinity;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if (tileAt(world, layer, x, y)?.terrain !== terrain) continue;
      const dist = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}

/** Finds a layer other than `from` that has the given terrain, nearest (adjacent) layers first. */
export function findLayerWithTerrain(
  world: World,
  from: Layer,
  origin: Vec2,
  terrain: "water" | "food" | "sunbeam"
): Layer | undefined {
  for (const layer of otherLayers(from)) {
    if (findNearestTerrain(world, layer, origin, terrain)) return layer;
  }
  return undefined;
}

/** Moves an agent one step toward a target using simple Manhattan stepping. */
export function stepToward(world: World, layer: Layer, pos: Vec2, target: Vec2): Vec2 {
  const dx = Math.sign(target.x - pos.x);
  const dy = Math.sign(target.y - pos.y);
  const candidates: Vec2[] = [
    { x: pos.x + dx, y: pos.y + dy },
    { x: pos.x + dx, y: pos.y },
    { x: pos.x, y: pos.y + dy },
  ];
  for (const candidate of candidates) {
    if (candidate.x === pos.x && candidate.y === pos.y) continue;
    if (tileAt(world, layer, candidate.x, candidate.y)?.walkable) return candidate;
  }
  return pos;
}

function consume(needs: Needs, behavior: "seekWater" | "seekFood"): void {
  const { need, amount } = CONSUME_RATE[behavior];
  needs[need] = Math.min(1, needs[need] + amount);
}

/**
 * Needs-seeking routinely crosses layers: a Diglett (home: underground)
 * finds its food on the surface and crosses to get it, then drifts back
 * once satisfied. Crossing itself takes a tick (no position change) so it
 * reads as a discrete, loggable event rather than free teleportation.
 */
export function tickAgent(world: World, agent: Agent, log?: EventLog): void {
  const previousBehavior = agent.behavior;
  decayNeeds(agent.needs);
  agent.behavior = chooseBehavior(agent.needs);

  if (log && agent.behavior !== previousBehavior) {
    log.record({
      kind: "behaviorChanged",
      tick: world.tick,
      agentId: agent.id,
      species: agent.species,
      from: previousBehavior,
      to: agent.behavior,
    });
  }

  if (agent.behavior === "seekWater" || agent.behavior === "seekFood") {
    const terrain = agent.behavior === "seekWater" ? "water" : "food";
    const target = findNearestTerrain(world, agent.layer, agent.pos, terrain);

    if (target) {
      if (target.x === agent.pos.x && target.y === agent.pos.y) {
        const need = agent.behavior === "seekWater" ? "thirst" : "hunger";
        consume(agent.needs, agent.behavior);
        log?.record({
          kind: "consumed",
          tick: world.tick,
          agentId: agent.id,
          species: agent.species,
          layer: agent.layer,
          pos: agent.pos,
          need,
        });
      } else {
        agent.pos = stepToward(world, agent.layer, agent.pos, target);
      }
      return;
    }

    const crossTo = findLayerWithTerrain(world, agent.layer, agent.pos, terrain);
    if (crossTo) {
      const from = agent.layer;
      agent.layer = crossTo;
      log?.record({
        kind: "crossedLayer",
        tick: world.tick,
        agentId: agent.id,
        species: agent.species,
        from,
        to: crossTo,
        pos: agent.pos,
      });
    }
    return;
  }

  if (agent.behavior === "idle" && agent.layer !== agent.homeLayer) {
    const from = agent.layer;
    agent.layer = agent.homeLayer;
    log?.record({
      kind: "crossedLayer",
      tick: world.tick,
      agentId: agent.id,
      species: agent.species,
      from,
      to: agent.homeLayer,
      pos: agent.pos,
    });
  }
}
