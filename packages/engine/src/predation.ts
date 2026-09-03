import type { Agent, HuntRules, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { stepAway, stepToward } from "./movement.js";

const FLEE_DETECT_RADIUS = 4;
const HUNT_DETECT_RADIUS = 5;
/** A predator starts hunting below this hunger — more eager than the general seekFood threshold, since prey won't wait. */
const HUNT_HUNGER_THRESHOLD = 0.6;
const KILL_HUNGER_RESTORE = 0.6;

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isPreyOf(rules: HuntRules, predatorSpecies: string, targetSpecies: string): boolean {
  return rules[predatorSpecies]?.includes(targetSpecies) ?? false;
}

function agentsWithin(world: World, agent: Agent, radius: number): Agent[] {
  return world.agents.filter(
    (other) =>
      other.id !== agent.id &&
      other.alive !== false &&
      other.layer === agent.layer &&
      manhattan(other.pos, agent.pos) <= radius
  );
}

function nearest(agent: Agent, others: Agent[]): Agent | undefined {
  let best: Agent | undefined;
  let bestDist = Infinity;
  for (const other of others) {
    const dist = manhattan(agent.pos, other.pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = other;
    }
  }
  return best;
}

function logBehaviorChange(log: EventLog | undefined, world: World, agent: Agent, to: Agent["behavior"]): void {
  if (!log || agent.behavior === to) return;
  log.record({
    kind: "behaviorChanged",
    tick: world.tick,
    agentId: agent.id,
    species: agent.species,
    from: agent.behavior,
    to,
  });
}

/**
 * Survival instincts that override normal need-seeking: flee a nearby
 * predator (always wins), or hunt nearby prey when hungry enough. Returns
 * true if this tick was handled here, so the caller should skip its normal
 * needs-driven behavior.
 */
export function applyPredationInstincts(world: World, agent: Agent, rules: HuntRules, log?: EventLog): boolean {
  const threats = agentsWithin(world, agent, FLEE_DETECT_RADIUS).filter((other) =>
    isPreyOf(rules, other.species, agent.species)
  );
  const threat = nearest(agent, threats);
  if (threat) {
    logBehaviorChange(log, world, agent, "flee");
    agent.behavior = "flee";
    agent.huntTarget = undefined;
    agent.pos = stepAway(world, agent.layer, agent.pos, threat.pos);
    return true;
  }

  const preySpecies = rules[agent.species];
  if (preySpecies && preySpecies.length > 0 && agent.needs.hunger < HUNT_HUNGER_THRESHOLD) {
    const prey = agentsWithin(world, agent, HUNT_DETECT_RADIUS).filter((other) =>
      isPreyOf(rules, agent.species, other.species)
    );
    const target = nearest(agent, prey);
    if (target) {
      logBehaviorChange(log, world, agent, "hunt");
      agent.behavior = "hunt";
      agent.huntTarget = target.id;

      if (manhattan(agent.pos, target.pos) <= 1) {
        target.alive = false;
        agent.needs.hunger = Math.min(1, agent.needs.hunger + KILL_HUNGER_RESTORE);
        agent.huntTarget = undefined;
        log?.record({
          kind: "killed",
          tick: world.tick,
          predatorId: agent.id,
          predatorSpecies: agent.species,
          preyId: target.id,
          preySpecies: target.species,
          pos: target.pos,
        });
      } else {
        agent.pos = stepToward(world, agent.layer, agent.pos, target.pos);
      }
      return true;
    }
  }

  return false;
}
