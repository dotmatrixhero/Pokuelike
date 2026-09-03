import type { Agent, BehaviorKind, HuntRules, Layer, Needs, Vec2, World } from "./types.js";
import { otherLayers, tileAt } from "./world.js";
import { stepToward } from "./movement.js";
import { applyPredationInstincts } from "./predation.js";
import { applyMateSeeking } from "./reproduction.js";
import { CONSUME_STOCK_AMOUNT } from "./flora.js";
import { tickCooldowns } from "./combat.js";
import { applyHerdCohesion } from "./herding.js";
import { migrate } from "./migration.js";
import type { EventLog } from "./events.js";

const DECAY_PER_TICK = {
  hunger: 0.01,
  thirst: 0.015,
  energy: 0.005,
  mateDrive: 0.01,
} as const;

/** Ticks an agent can sit at 0 hunger or thirst before it dies of it. */
const STARVATION_GRACE_TICKS = 100;
/** Ticks a non-predator can go wanting food/water with none reachable anywhere before it gives up and migrates. */
const MIGRATE_AFTER_TICKS = 150;

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
      const tile = tileAt(world, layer, x, y);
      if (tile?.terrain !== terrain) continue;
      if (terrain === "food" && (tile.stock ?? 0) <= 0) continue; // depleted patch, keep looking
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

function consume(needs: Needs, behavior: "seekWater" | "seekFood"): void {
  const { need, amount } = CONSUME_RATE[behavior];
  needs[need] = Math.min(1, needs[need] + amount);
}

/**
 * Needs-seeking routinely crosses layers: a Diglett (home: underground)
 * finds its food on the surface and crosses to get it, then drifts back
 * once satisfied. Crossing itself takes a tick (no position change) so it
 * reads as a discrete, loggable event rather than free teleportation.
 *
 * Survival instincts (flee a nearby predator, hunt nearby prey when hungry)
 * take priority over normal need-seeking when `rules` is provided — see
 * predation.ts. Without rules, agents behave exactly as before predation
 * existed.
 */
export function tickAgent(world: World, agent: Agent, log?: EventLog, rules?: HuntRules): void {
  if (agent.alive === false) return;

  if (agent.age !== undefined) agent.age += 1;
  tickCooldowns(agent);
  decayNeeds(agent.needs);

  if (agent.needs.hunger <= 0 || agent.needs.thirst <= 0) {
    agent.starvationTicks = (agent.starvationTicks ?? 0) + 1;
    if (agent.starvationTicks >= STARVATION_GRACE_TICKS) {
      agent.alive = false;
      log?.record({
        kind: "starved",
        tick: world.tick,
        agentId: agent.id,
        species: agent.species,
        pos: agent.pos,
        cause: agent.needs.hunger <= 0 ? "hunger" : "thirst",
      });
      return;
    }
  } else {
    agent.starvationTicks = 0;
  }

  if (rules && applyPredationInstincts(world, agent, rules, log)) return;

  const previousBehavior = agent.behavior;
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

  if (agent.behavior === "seekMate") {
    applyMateSeeking(world, agent, log);
    return;
  }

  if (agent.behavior === "seekWater" || agent.behavior === "seekFood") {
    const terrain = agent.behavior === "seekWater" ? "water" : "food";
    const target = findNearestTerrain(world, agent.layer, agent.pos, terrain);

    if (target) {
      agent.ticksWithoutResource = 0;
      if (target.x === agent.pos.x && target.y === agent.pos.y) {
        const need = agent.behavior === "seekWater" ? "thirst" : "hunger";
        consume(agent.needs, agent.behavior);
        if (agent.behavior === "seekFood") {
          const tile = tileAt(world, agent.layer, target.x, target.y);
          if (tile?.stock !== undefined) tile.stock = Math.max(0, tile.stock - CONSUME_STOCK_AMOUNT);
        }
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
      agent.ticksWithoutResource = 0;
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
      return;
    }

    // No layer has the resource at all — this agent isn't starving-immediately
    // (that's the check above), but if this drags on, standing in place forever
    // isn't better than trying somewhere else.
    agent.ticksWithoutResource = (agent.ticksWithoutResource ?? 0) + 1;
    if (agent.ticksWithoutResource >= MIGRATE_AFTER_TICKS) {
      if (migrate(world, agent, log) === "arrived") agent.ticksWithoutResource = 0;
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
    return;
  }

  if (agent.behavior === "idle") {
    applyHerdCohesion(world, agent);
  }
}
