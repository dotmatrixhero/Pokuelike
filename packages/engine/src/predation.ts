import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import type { PokemonType } from "./typing.js";
import type { EventLog } from "./events.js";
import { logBehaviorChange } from "./events.js";
import { stepAway, stepToward } from "./movement.js";
import { migrate } from "./migration.js";
import { calculateDamage, pickBestMove, useMove, withinMoveRange, rollAccuracy, rollCritical } from "./combat.js";
import { grantKillExp, maybeGrantHitSkillPoint, type LevelingContext } from "./leveling.js";
import { FINISHING_POOL_FRACTION } from "./support.js";

/** How far a herd's non-prey members (e.g. Venusaur) will travel to intervene when a herd-mate is in trouble. */
const GUARDIAN_DETECT_RADIUS = 6;

/**
 * Exported so support.ts's `applyCarrying` can reuse the same "is a predator
 * nearby" check when deciding to drop a carried ally and flee. This is the
 * baseline at neutral (0.5) boldness — see `effectiveFleeRadius`, which is
 * what `applyPredationInstincts`'s own flee check actually uses.
 */
export const FLEE_DETECT_RADIUS = 4;
/** How far boldness can push the flee-detection radius from baseline in either direction. */
const FLEE_RADIUS_SPREAD = 2;
/**
 * No boldness value shrinks the flee radius below this — a threat this close
 * always registers, so a sufficiently close/lethal threat can't be ignored
 * into a suicidal non-reaction (DESIGN.md's explicit hard-floor requirement).
 */
const FLEE_RADIUS_FLOOR = 2;
const HUNT_DETECT_RADIUS = 5;
/** A predator starts hunting below this hunger — more eager than the general seekFood threshold, since prey won't wait. Baseline at neutral (0.5) aggression — see `huntHungerThreshold`. */
const HUNT_HUNGER_THRESHOLD = 0.6;
/** How far aggression can push the hunt-hunger threshold from baseline in either direction. */
const HUNT_THRESHOLD_SPREAD = 0.2;
const KILL_HUNGER_RESTORE = 0.6;

/** How close a threat has to be, and how many herd-mates have to be nearby, before prey mob it instead of fleeing. */
const MOB_TRIGGER_RADIUS = 2;
const MOB_MUSTER_RADIUS = 4;
/** Baseline headcount at neutral (0.5) boldness/aggression — see `mobThreshold`. */
const MOB_THRESHOLD = 3;
/** How far the combined boldness+aggression lean can shift the mob-commitment headcount, in either direction. */
const MOB_THRESHOLD_SPREAD = 1;

/**
 * How many nearby allies an agent needs before it commits to a mob-fight
 * instead of fleeing. Bolder and more aggressive agents commit with fewer
 * allies; timid/passive ones need more — DESIGN.md's mob-fight commitment
 * point, wired from both axes since a prey animal's willingness to stand and
 * fight is as much about aggression as nerve. Absent disposition (hand-built
 * fixtures) reads as neutral (0.5/0.5), reproducing the original fixed
 * MOB_THRESHOLD of 3 exactly.
 */
function mobThreshold(agent: Agent): number {
  const boldness = agent.disposition?.boldness ?? 0.5;
  const aggression = agent.disposition?.aggression ?? 0.5;
  const courage = (boldness + aggression) / 2;
  const shift = Math.round((courage - 0.5) * 2 * MOB_THRESHOLD_SPREAD);
  return Math.max(1, MOB_THRESHOLD - shift);
}

/**
 * How close a threat has to get before this agent notices it and flees.
 * Bold agents tolerate a closer/weaker threat before reacting (smaller
 * radius); timid agents flee earlier/farther (larger radius) — DESIGN.md's
 * flee-trigger point. Clamped to `FLEE_RADIUS_FLOOR` so no boldness value
 * makes a threat invisible at point-blank range. Absent disposition (hand-
 * built fixtures) reads as neutral (0.5), reproducing the original fixed
 * FLEE_DETECT_RADIUS of 4 exactly.
 */
function effectiveFleeRadius(agent: Agent): number {
  const boldness = agent.disposition?.boldness ?? 0.5;
  const radius = FLEE_DETECT_RADIUS + (0.5 - boldness) * (2 * FLEE_RADIUS_SPREAD);
  return Math.max(FLEE_RADIUS_FLOOR, radius);
}

/**
 * The hunger level below which this predator switches to `hunt`. Aggressive
 * predators hunt while less hungry (higher threshold); passive ones wait
 * until hungrier (lower threshold) — DESIGN.md's hunt-trigger point. Absent
 * disposition (hand-built fixtures) reads as neutral (0.5), reproducing the
 * original fixed HUNT_HUNGER_THRESHOLD of 0.6 exactly.
 */
function huntHungerThreshold(agent: Agent): number {
  const aggression = agent.disposition?.aggression ?? 0.5;
  return HUNT_HUNGER_THRESHOLD + (aggression - 0.5) * (2 * HUNT_THRESHOLD_SPREAD);
}
/** Fallback HP for an agent with no real combat profile (stats/level/types) — shouldn't happen for fully-statted species. Exported so support.ts's body-weight proxy can match it. */
export const FALLBACK_MAX_HP = 10;
const FALLBACK_DAMAGE = 1;
/** A predator at or below this fraction of max HP flees a fight instead of continuing it. */
const RETREAT_HP_FRACTION = 0.4;

/** How long a predator can go without a kill while actively hunting before it gives up on the area. */
const RELOCATE_AFTER_TICKS = 150;

export function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isPreyOf(rules: HuntRules, predatorSpecies: string, targetSpecies: string): boolean {
  return rules[predatorSpecies]?.includes(targetSpecies) ?? false;
}

/** Nearby living agents (fainted ones included — a fainted agent is still `alive !== false`, and remains a valid hunt/threat target). */
export function agentsWithin(world: World, agent: Agent, radius: number): Agent[] {
  return world.agents.filter(
    (other) =>
      other.id !== agent.id &&
      other.alive !== false &&
      other.layer === agent.layer &&
      manhattan(other.pos, agent.pos) <= radius
  );
}

export function nearest(agent: Agent, others: Agent[]): Agent | undefined {
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

/**
 * Same-species, same-herd, living, conscious agents near `pos`, excluding
 * `excludeId` itself. Fainted allies are excluded on purpose — they're
 * physically present but can't take an action-tick behavior at all (see
 * needs.ts), so counting them toward a mob's muster would overstate how much
 * actual fighting help is nearby.
 */
function countHerdAllies(world: World, excludeId: string, species: string, herdId: string | undefined, layer: Layer, pos: Vec2, radius: number): number {
  if (!herdId) return 0;
  return world.agents.filter(
    (other) =>
      other.id !== excludeId &&
      other.alive !== false &&
      !other.fainted &&
      other.species === species &&
      other.herdId === herdId &&
      other.layer === layer &&
      manhattan(other.pos, pos) <= radius
  ).length;
}

/** Would hunting this candidate mean walking into a mob? Used by predators to avoid unwinnable fights. */
function isProtectedByMob(world: World, candidate: Agent): boolean {
  const allies = countHerdAllies(world, candidate.id, candidate.species, candidate.herdId, candidate.layer, candidate.pos, MOB_MUSTER_RADIUS);
  return allies + 1 >= mobThreshold(candidate);
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

export function isPreyOfAnything(rules: HuntRules, species: string): boolean {
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
 * is the point of having cooldowns.
 *
 * Two distinct outcomes, per DESIGN.md's "Faint/finish-off" section:
 *   - A hit that brings a conscious defender's `hp` to 0 FAINTS it
 *     (`fainted = true`, `hp` pinned at 0, granted a `finishingPool` worth
 *     `FINISHING_POOL_FRACTION * maxHp`) rather than killing it outright.
 *   - A hit landed on an already-fainted defender (from anyone, not just
 *     the original attacker) instead subtracts its damage from
 *     `finishingPool` — multiple smaller hits add up correctly, it isn't a
 *     one-hit threshold check. Only once the pool is exhausted does the
 *     defender actually die (`alive = false`), which is also the moment
 *     kill-exp is granted and the `killed`/`defeated` event fires.
 *
 * Returns true only when this hit caused a TRUE death (`alive` newly
 * `false`) — never on a mere faint. Callers that restore a predator's
 * hunger on a "kill" (see the hunt call site below) must gate on this
 * return value, not on the old hp<=0 check, so eating only ever happens
 * against a truly dead target (design point 7).
 */
function resolveHit(
  world: World,
  attacker: Agent,
  defender: Agent,
  log: EventLog | undefined,
  faintKind: "killed" | "defeated",
  ctx?: LevelingContext
): boolean {
  if (defender.alive === false) return false; // already a corpse — nothing left to finish off here (looting/scavenging is a separate path, see support.ts)

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

  if (damage > 0) maybeGrantHitSkillPoint(attacker, move.type, world, log);

  if (defender.fainted) {
    // Finishing-blow phase: the (already-zero) hp bar is untouched; damage
    // comes out of the finishing pool instead, and it accumulates across
    // however many hits it takes.
    defender.finishingPool = (defender.finishingPool ?? 0) - damage;

    log?.record({
      kind: "fought",
      tick: world.tick,
      attackerId: attacker.id,
      attackerSpecies: attacker.species,
      defenderId: defender.id,
      defenderSpecies: defender.species,
      damage,
      defenderHpRemaining: defender.hp ?? 0,
      critical: isCritical,
    });

    if (defender.finishingPool > 0) return false; // still down, not finished

    defender.alive = false;
    defender.finishingPool = 0;
    defender.diedAtTick = world.tick;
    grantKillExp(world, attacker, defender, ctx, log);
    logKillOrDefeat(world, attacker, defender, faintKind, log);
    return true;
  }

  defender.hp = Math.max(0, defender.hp - damage);

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

  // This hit brought hp to 0 — faint, don't kill outright.
  defender.fainted = true;
  defender.finishingPool = FINISHING_POOL_FRACTION * defender.maxHp;
  log?.record({ kind: "fainted", tick: world.tick, agentId: defender.id, species: defender.species, pos: defender.pos });
  return false; // not a true death yet
}

function logKillOrDefeat(world: World, attacker: Agent, defender: Agent, faintKind: "killed" | "defeated", log: EventLog | undefined): void {
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
}

/** A predator that keeps failing to find a huntable (un-mobbed) meal gives up on this area and wanders off. */
function giveUpAndRelocate(world: World, agent: Agent, log?: EventLog): boolean {
  const result = migrate(world, agent, log);
  if (result === "arrived") agent.ticksSinceMeal = 0; // fresh start in the new area
  return result !== "stuck";
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
      // Deliberately includes a fainted predator: a guardian keeps pressing the
      // fight to finish it off, same reasoning as the general threats filter below.
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

  // Deliberately includes a fainted predator: prey (mobbing or fleeing) keeps
  // treating it as the threat it was until it's truly dead, which is what lets
  // a mob land the finishing blow across multiple ticks/hits rather than the
  // predator's faint silently ending the encounter — see resolveHit/DESIGN.md.
  const threats = agentsWithin(world, agent, effectiveFleeRadius(agent)).filter((other) =>
    isPreyOf(rules, other.species, agent.species)
  );
  const threat = nearest(agent, threats);
  if (threat) {
    const distance = manhattan(agent.pos, threat.pos);
    // Allies must ALSO be within striking distance of the threat right now — not just
    // somewhere in the herd's general area — or a lone agent will "mob" alone and die
    // waiting for backup that's still several tiles away.
    const mobSize = countHerdAllies(world, agent.id, agent.species, agent.herdId, agent.layer, threat.pos, MOB_TRIGGER_RADIUS) + 1;

    if (distance <= MOB_TRIGGER_RADIUS && mobSize >= mobThreshold(agent)) {
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
  if (preySpecies && preySpecies.length > 0 && agent.needs.hunger < huntHungerThreshold(agent)) {
    const candidates = agentsWithin(world, agent, HUNT_DETECT_RADIUS).filter(
      (other) => isPreyOf(rules, agent.species, other.species) && !isProtectedByMob(world, other)
    );
    const target = nearest(agent, candidates);

    if (target) {
      logBehaviorChange(log, world, agent, "hunt");
      agent.behavior = "hunt";
      agent.huntTarget = target.id;

      if (canAttackFromHere(agent, manhattan(agent.pos, target.pos), target.types ?? [])) {
        // A single hit may not be lethal now — real HP, real damage, and even
        // a lethal hit only FAINTS the target (see resolveHit/DESIGN.md). The
        // meal (and hunger restore) only happens once the target is truly
        // dead — resolveHit returns true only at that moment, never on a mere
        // faint — so hunting a fainted target across several ticks to finish
        // it off, then eating, is the normal two-stage path here.
        const died = resolveHit(world, agent, target, log, "killed", ctx);
        if (died) {
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
      return giveUpAndRelocate(world, agent, log);
    }
  }

  return false;
}
