import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { stepAway, stepToward } from "./movement.js";
import { tileAt } from "./world.js";

const FLEE_DETECT_RADIUS = 4;
const HUNT_DETECT_RADIUS = 5;
/** A predator starts hunting below this hunger — more eager than the general seekFood threshold, since prey won't wait. */
const HUNT_HUNGER_THRESHOLD = 0.6;
const KILL_HUNGER_RESTORE = 0.6;

/** How close a threat has to be, and how many herd-mates have to be nearby, before prey mob it instead of fleeing. */
const MOB_TRIGGER_RADIUS = 2;
const MOB_MUSTER_RADIUS = 4;
const MOB_THRESHOLD = 3;
const FIGHT_DAMAGE = 1;
const DEFAULT_COMBAT_HP = 3;
/** A predator at or below this fraction of max HP flees a fight instead of continuing it. */
const RETREAT_HP_FRACTION = 0.4;

/** How long a predator can go without a kill while actively hunting before it gives up on the area. */
const RELOCATE_AFTER_TICKS = 150;
const MIN_RELOCATE_DISTANCE = 8;
const RELOCATE_ATTEMPTS = 10;

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

/** Same-species, same-herd, living agents near `pos`, excluding `excludeId` itself. */
function countHerdAllies(world: World, excludeId: string, species: string, herdId: string | undefined, layer: Layer, pos: Vec2, radius: number): number {
  if (!herdId) return 0;
  return world.agents.filter(
    (other) =>
      other.id !== excludeId &&
      other.alive !== false &&
      other.species === species &&
      other.herdId === herdId &&
      other.layer === layer &&
      manhattan(other.pos, pos) <= radius
  ).length;
}

/** Would hunting this candidate mean walking into a mob? Used by predators to avoid unwinnable fights. */
function isProtectedByMob(world: World, candidate: Agent): boolean {
  const allies = countHerdAllies(world, candidate.id, candidate.species, candidate.herdId, candidate.layer, candidate.pos, MOB_MUSTER_RADIUS);
  return allies + 1 >= MOB_THRESHOLD;
}

function isCriticallyHurt(agent: Agent): boolean {
  if (agent.hp === undefined || agent.maxHp === undefined || agent.maxHp === 0) return false;
  return agent.hp / agent.maxHp <= RETREAT_HP_FRACTION;
}

function dealMobDamage(world: World, attacker: Agent, defender: Agent, log?: EventLog): void {
  if (defender.alive === false) return;
  defender.maxHp = defender.maxHp ?? DEFAULT_COMBAT_HP;
  defender.hp = defender.hp ?? defender.maxHp;
  defender.hp = Math.max(0, defender.hp - FIGHT_DAMAGE);

  log?.record({
    kind: "fought",
    tick: world.tick,
    attackerId: attacker.id,
    attackerSpecies: attacker.species,
    defenderId: defender.id,
    defenderSpecies: defender.species,
    damage: FIGHT_DAMAGE,
    defenderHpRemaining: defender.hp,
  });

  if (defender.hp <= 0) {
    defender.alive = false;
    log?.record({
      kind: "defeated",
      tick: world.tick,
      winnerId: attacker.id,
      winnerSpecies: attacker.species,
      loserId: defender.id,
      loserSpecies: defender.species,
      pos: defender.pos,
    });
  }
}

function findRandomWalkableTile(world: World, layer: Layer, from: Vec2): Vec2 | undefined {
  for (let i = 0; i < RELOCATE_ATTEMPTS; i++) {
    const candidate = { x: Math.floor(Math.random() * world.width), y: Math.floor(Math.random() * world.height) };
    if (manhattan(candidate, from) < MIN_RELOCATE_DISTANCE) continue;
    if (tileAt(world, layer, candidate.x, candidate.y)?.walkable) return candidate;
  }
  return undefined;
}

/** A predator that keeps failing to find a huntable (un-mobbed) meal gives up on this area and wanders off. */
function relocate(world: World, agent: Agent, log?: EventLog): boolean {
  if (!agent.relocateTarget) {
    agent.relocateTarget = findRandomWalkableTile(world, agent.layer, agent.pos);
    if (!agent.relocateTarget) return false;
  }

  logBehaviorChange(log, world, agent, "relocate");
  agent.behavior = "relocate";

  if (manhattan(agent.pos, agent.relocateTarget) <= 1) {
    agent.pos = agent.relocateTarget;
    agent.relocateTarget = undefined;
    agent.ticksSinceMeal = 0; // fresh start in the new area
  } else {
    agent.pos = stepToward(world, agent.layer, agent.pos, agent.relocateTarget);
  }
  return true;
}

/**
 * Survival instincts that override normal need-seeking. In priority order:
 *
 * 1. A predator critically hurt by a mob flees the fight rather than
 *    continuing to hunt.
 * 2. Prey with a predator too close: mob it (converge and deal chip damage)
 *    if enough herd-mates are nearby to make that a fight worth having,
 *    otherwise flee as before.
 * 3. A hungry predator hunts the nearest prey that ISN'T protected by a mob
 *    (it won't walk into a fight it would lose) and kills on contact. If it
 *    can't find a safe meal for too long, it gives up on the area and
 *    relocates instead of camping the same spot forever.
 *
 * Returns true if this tick was handled here, so the caller should skip its
 * normal needs-driven behavior.
 */
export function applyPredationInstincts(world: World, agent: Agent, rules: HuntRules, log?: EventLog): boolean {
  if (isCriticallyHurt(agent)) {
    const attackers = agentsWithin(world, agent, FLEE_DETECT_RADIUS).filter(
      (other) => other.behavior === "fight" && other.fightTarget === agent.id
    );
    const attacker = nearest(agent, attackers);
    if (attacker) {
      logBehaviorChange(log, world, agent, "flee");
      agent.behavior = "flee";
      agent.huntTarget = undefined;
      agent.pos = stepAway(world, agent.layer, agent.pos, attacker.pos);
      return true;
    }
  }

  const threats = agentsWithin(world, agent, FLEE_DETECT_RADIUS).filter((other) =>
    isPreyOf(rules, other.species, agent.species)
  );
  const threat = nearest(agent, threats);
  if (threat) {
    const distance = manhattan(agent.pos, threat.pos);
    const mobSize = countHerdAllies(world, agent.id, agent.species, agent.herdId, agent.layer, agent.pos, MOB_MUSTER_RADIUS) + 1;

    if (distance <= MOB_TRIGGER_RADIUS && mobSize >= MOB_THRESHOLD) {
      logBehaviorChange(log, world, agent, "fight");
      agent.behavior = "fight";
      agent.fightTarget = threat.id;
      if (distance <= 1) {
        dealMobDamage(world, agent, threat, log);
      } else {
        agent.pos = stepToward(world, agent.layer, agent.pos, threat.pos);
      }
      return true;
    }

    logBehaviorChange(log, world, agent, "flee");
    agent.behavior = "flee";
    agent.huntTarget = undefined;
    agent.fightTarget = undefined;
    agent.pos = stepAway(world, agent.layer, agent.pos, threat.pos);
    return true;
  }

  const preySpecies = rules[agent.species];
  if (preySpecies && preySpecies.length > 0 && agent.needs.hunger < HUNT_HUNGER_THRESHOLD) {
    const candidates = agentsWithin(world, agent, HUNT_DETECT_RADIUS).filter(
      (other) => isPreyOf(rules, agent.species, other.species) && !isProtectedByMob(world, other)
    );
    const target = nearest(agent, candidates);

    if (target) {
      logBehaviorChange(log, world, agent, "hunt");
      agent.behavior = "hunt";
      agent.huntTarget = target.id;

      if (manhattan(agent.pos, target.pos) <= 1) {
        target.alive = false;
        agent.needs.hunger = Math.min(1, agent.needs.hunger + KILL_HUNGER_RESTORE);
        agent.huntTarget = undefined;
        agent.ticksSinceMeal = 0;
        agent.relocateTarget = undefined;
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

    agent.ticksSinceMeal = (agent.ticksSinceMeal ?? 0) + 1;
    if (agent.ticksSinceMeal >= RELOCATE_AFTER_TICKS) {
      return relocate(world, agent, log);
    }
  }

  return false;
}
