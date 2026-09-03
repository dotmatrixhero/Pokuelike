import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import type { PokemonType } from "./typing.js";
import type { EventLog } from "./events.js";
import { stepAway, stepToward } from "./movement.js";
import { tileAt } from "./world.js";
import { calculateDamage, pickBestMove, useMove, withinMoveRange, rollAccuracy, rollCritical } from "./combat.js";
import { grantKillExp, maybeGrantHitSkillPoint, type LevelingContext } from "./leveling.js";

/** How far a herd's non-prey members (e.g. Venusaur) will travel to intervene when a herd-mate is in trouble. */
const GUARDIAN_DETECT_RADIUS = 6;

const FLEE_DETECT_RADIUS = 4;
const HUNT_DETECT_RADIUS = 5;
/** A predator starts hunting below this hunger — more eager than the general seekFood threshold, since prey won't wait. */
const HUNT_HUNGER_THRESHOLD = 0.6;
const KILL_HUNGER_RESTORE = 0.6;

/** How close a threat has to be, and how many herd-mates have to be nearby, before prey mob it instead of fleeing. */
const MOB_TRIGGER_RADIUS = 2;
const MOB_MUSTER_RADIUS = 4;
const MOB_THRESHOLD = 3;
/** Fallback HP for an agent with no real combat profile (stats/level/types) — shouldn't happen for fully-statted species. */
const FALLBACK_MAX_HP = 10;
const FALLBACK_DAMAGE = 1;
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

/** Can `agent` actually hit something `distance` away right now, given its best move's reach? */
function canAttackFromHere(agent: Agent, distance: number, defenderTypes: PokemonType[]): boolean {
  const move = pickBestMove(agent, defenderTypes);
  return move !== undefined && withinMoveRange(move, distance);
}

function isPreyOfAnything(rules: HuntRules, species: string): boolean {
  return Object.values(rules).some((preyList) => preyList.includes(species));
}

/** A herd-mate (any species) that's currently fleeing or fighting something, for a guardian to notice. */
function findHerdmateInDanger(world: World, agent: Agent): Agent | undefined {
  if (!agent.herdId) return undefined;
  const inDanger = world.agents.filter(
    (other) =>
      other.id !== agent.id &&
      other.alive !== false &&
      other.herdId === agent.herdId &&
      other.layer === agent.layer &&
      (other.behavior === "flee" || other.behavior === "fight") &&
      manhattan(other.pos, agent.pos) <= GUARDIAN_DETECT_RADIUS
  );
  return nearest(agent, inDanger);
}

/**
 * One attack: picks the attacker's best off-cooldown move against the
 * defender's types, rolls whether it hits at all (real accuracy, not a
 * guaranteed connect — see TODO.md), then real mainline-formula damage
 * (STAB, type effectiveness, a real crit-stage roll, a 0.85-1x variance
 * roll), applies it, and puts that move on cooldown. If every move is on
 * cooldown, nothing happens this tick — the weapon just isn't ready, which
 * is the point of having cooldowns. Returns true if the defender fainted
 * from this hit.
 */
function resolveHit(
  world: World,
  attacker: Agent,
  defender: Agent,
  log: EventLog | undefined,
  faintKind: "killed" | "defeated",
  ctx?: LevelingContext
): boolean {
  if (defender.alive === false) return false;

  defender.maxHp = defender.maxHp ?? defender.stats?.maxHp ?? FALLBACK_MAX_HP;
  defender.hp = defender.hp ?? defender.maxHp;

  const move = pickBestMove(attacker, defender.types ?? []);
  if (!move) return false; // every move on cooldown this tick

  useMove(attacker, move);

  if (!rollAccuracy(move)) {
    log?.record({
      kind: "missed",
      tick: world.tick,
      attackerId: attacker.id,
      attackerSpecies: attacker.species,
      defenderId: defender.id,
      defenderSpecies: defender.species,
    });
    return false;
  }

  const isCritical = rollCritical();
  const damage =
    attacker.level !== undefined && attacker.types && attacker.stats && defender.stats
      ? calculateDamage(
          { level: attacker.level, types: attacker.types, stats: attacker.stats },
          { types: defender.types ?? [], stats: defender.stats },
          move,
          0.85 + Math.random() * 0.15,
          isCritical
        ).damage
      : FALLBACK_DAMAGE;

  defender.hp = Math.max(0, defender.hp - damage);
  if (damage > 0) maybeGrantHitSkillPoint(attacker, move.type, world, log);

  log?.record({
    kind: "fought",
    tick: world.tick,
    attackerId: attacker.id,
    attackerSpecies: attacker.species,
    defenderId: defender.id,
    defenderSpecies: defender.species,
    damage,
    defenderHpRemaining: defender.hp,
    critical: isCritical,
  });

  if (defender.hp > 0) return false;

  defender.alive = false;
  grantKillExp(world, attacker, defender, ctx, log);
  if (faintKind === "killed") {
    log?.record({
      kind: "killed",
      tick: world.tick,
      predatorId: attacker.id,
      predatorSpecies: attacker.species,
      preyId: defender.id,
      preySpecies: defender.species,
      pos: defender.pos,
    });
  } else {
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
  return true;
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
 * 2. A guardian (a species nothing preys on, e.g. Venusaur) whose herd-mate
 *    is fleeing or fighting something moves to intercept that threat,
 *    whether or not the guardian itself is in any danger.
 * 3. Prey with a predator too close: mob it (converge and deal chip damage)
 *    if enough herd-mates are nearby to make that a fight worth having,
 *    otherwise flee as before.
 * 4. A hungry predator hunts the nearest prey that ISN'T protected by a mob
 *    (it won't walk into a fight it would lose) and kills on contact. If it
 *    can't find a safe meal for too long, it gives up on the area and
 *    relocates instead of camping the same spot forever.
 *
 * An attack (steps 2-4) only actually lands when the attacker's best move
 * can reach — a melee move (shape "point") needs distance 1, but something
 * like Vine Whip (a "line" of length 2) can hit from two tiles out, so a
 * ranged attacker doesn't have to close all the way in first.
 *
 * Returns true if this tick was handled here, so the caller should skip its
 * normal needs-driven behavior.
 */
export function applyPredationInstincts(world: World, agent: Agent, rules: HuntRules, log?: EventLog, ctx?: LevelingContext): boolean {
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

  if (!isPreyOfAnything(rules, agent.species)) {
    const herdmate = findHerdmateInDanger(world, agent);
    if (herdmate) {
      const herdmateThreats = agentsWithin(world, herdmate, FLEE_DETECT_RADIUS).filter((other) =>
        isPreyOf(rules, other.species, herdmate.species)
      );
      const threat = nearest(herdmate, herdmateThreats);
      if (threat) {
        const distance = manhattan(agent.pos, threat.pos);
        logBehaviorChange(log, world, agent, "fight");
        agent.behavior = "fight";
        agent.fightTarget = threat.id;
        if (canAttackFromHere(agent, distance, threat.types ?? [])) {
          resolveHit(world, agent, threat, log, "defeated", ctx);
        } else {
          agent.pos = stepToward(world, agent.layer, agent.pos, threat.pos);
        }
        return true;
      }
    }
  }

  const threats = agentsWithin(world, agent, FLEE_DETECT_RADIUS).filter((other) =>
    isPreyOf(rules, other.species, agent.species)
  );
  const threat = nearest(agent, threats);
  if (threat) {
    const distance = manhattan(agent.pos, threat.pos);
    // Allies must ALSO be within striking distance of the threat right now — not just
    // somewhere in the herd's general area — or a lone agent will "mob" alone and die
    // waiting for backup that's still several tiles away.
    const mobSize = countHerdAllies(world, agent.id, agent.species, agent.herdId, agent.layer, threat.pos, MOB_TRIGGER_RADIUS) + 1;

    if (distance <= MOB_TRIGGER_RADIUS && mobSize >= MOB_THRESHOLD) {
      logBehaviorChange(log, world, agent, "fight");
      agent.behavior = "fight";
      agent.fightTarget = threat.id;
      if (canAttackFromHere(agent, distance, threat.types ?? [])) {
        resolveHit(world, agent, threat, log, "defeated", ctx);
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

      if (canAttackFromHere(agent, manhattan(agent.pos, target.pos), target.types ?? [])) {
        // A single hit may not be lethal now — real HP, real damage. The
        // meal (and hunger restore) only happens once the target actually faints;
        // otherwise it's a wounded prey that gets another chance to flee next tick.
        const fainted = resolveHit(world, agent, target, log, "killed", ctx);
        if (fainted) {
          agent.needs.hunger = Math.min(1, agent.needs.hunger + KILL_HUNGER_RESTORE);
          agent.huntTarget = undefined;
          agent.ticksSinceMeal = 0;
          agent.relocateTarget = undefined;
        }
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
