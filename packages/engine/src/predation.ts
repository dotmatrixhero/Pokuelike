import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { logBehaviorChange } from "./events.js";
import { applyForcedMovement, stepAway, stepToward } from "./movement.js";
import { migrate } from "./migration.js";
import { calculateDamage, pickBestMove, useMove, rollAccuracy, rollCritical, rollHitCount } from "./combat.js";
import type { Direction } from "./moves.js";
import { resolveShape } from "./moves.js";
import type { MoveSpec } from "./moves.js";
import { grantKillExp, maybeGrantHitSkillPoint, type LevelingContext } from "./leveling.js";
import { FINISHING_POOL_FRACTION } from "./support.js";
import { isPathClear } from "./fov.js";
import { tileAt, setTile } from "./world.js";
import { recordPredatorPressure } from "./herdMigration.js";
import { isNight, isTwilight, lightLevel } from "./daynight.js";
import { activeWeatherAt, isInColdSnap, stormAccuracyMultiplier } from "./weather.js";
import {
  applyStatStage,
  BURN_ATTACK_STAGE,
  damageReductionOf,
  getStatStage,
  isBurned,
  maybeInflictStatus,
  maybeSpreadStatus,
  maybeThawOnFireHit,
  thornsOf,
} from "./status.js";

/** How far a herd's non-prey members (e.g. Venusaur) will travel to intervene when a herd-mate is in trouble. */
const GUARDIAN_DETECT_RADIUS = 6;

/**
 * How close an awake, conscious, same-herd agent has to be to a SLEEPING
 * agent to notice a nearby threat and rouse it — needs.ts's "herd protects
 * and wakes each other" sleep mechanic. A bit tighter than
 * `GUARDIAN_DETECT_RADIUS` (noticing your sleeping neighbor is in danger is
 * a closer-range thing than a guardian actively patrolling for trouble) but
 * still comfortably wider than `MOB_TRIGGER_RADIUS`, so a herd genuinely
 * bunched up together (not just coincidentally adjacent) protects its
 * sleepers. Sim-original tuning guess, judge against a real run like every
 * other magic number in this codebase.
 */
export const SLEEP_WATCH_RADIUS = 5;

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
/**
 * A predator starts hunting below this hunger — deliberately well above the
 * general seekFood threshold (chooseBehavior's own 0.7 cutoff in needs.ts),
 * per direct ask: hunting should be tried "a lot more," valued over grazing,
 * not just an emergency fallback once truly starving. Since
 * `applyPredationInstincts`'s hunt check runs (and returns, short-circuiting
 * ordinary needs-seeking) before `tickAgentAction` ever gets to plant
 * foraging, a predator this eager to hunt only ever falls back to eating
 * plants once genuinely hungry AND no huntable prey is currently
 * detectable — exactly "can still eat plants, but a kill is valued higher."
 * Baseline at neutral (0.5) aggression — see `huntHungerThreshold`. Raised
 * from the original 0.6 (was barely above chooseBehavior's own 0.7 seekFood
 * cutoff, meaning a predator often wasn't even hunt-eligible until it was
 * already plant-food-hungry too).
 */
const HUNT_HUNGER_THRESHOLD = 0.85;
/** How far aggression can push the hunt-hunger threshold from baseline in either direction. */
const HUNT_THRESHOLD_SPREAD = 0.2;
/**
 * How far activityPattern+darkness can push the hunt-hunger threshold from
 * baseline in either direction, on top of (composing with, not replacing)
 * the aggression-based shift above — a nocturnal predator at full darkness
 * shifts by this much toward "hunts even when not very hungry"; a diurnal
 * one shifts the opposite way at night (needs to be hungrier before it
 * bothers). Deliberately a bit smaller than `HUNT_THRESHOLD_SPREAD` so
 * Disposition (an individual trait) still matters at least as much as
 * species-level activity pattern. Sim-original magnitude, not canon.
 */
const NOCTURNAL_HUNT_THRESHOLD_SPREAD = 0.15;
/**
 * How long a kill's post-meal "digesting" hunger-decay slowdown lasts —
 * see needs.ts's `KILL_SATIATION_HUNGER_DECAY_MULTIPLIER` for the actual
 * decay effect this window applies. Sim-original magnitude: long enough
 * that a fed predator genuinely stops needing to hunt/forage for a real
 * stretch (not just a few dozen ticks), judged against a real run like
 * every other tuning constant here.
 */
const KILL_SATIATION_TICKS = 300;

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
 * The activityPattern+darkness term of `huntHungerThreshold`, independent of
 * (and additive with) the aggression-based term above — see
 * DESIGN.md's "Dynamics that move a content herd", Phase 2. `darkness` is 0
 * at full daylight, 1 at full darkness (`1 - lightLevel`):
 *  - `"nocturnal"`: shifts *up* (more eager to hunt) as it gets darker, down
 *    (less eager, needs to be hungrier) by day — a nocturnal predator
 *    genuinely hunts more at night, not just flavor text.
 *  - `"diurnal"`: the exact mirror — more eager by day, less at night.
 *  - `"crepuscular"`: a smaller, flat eagerness bump during the two dawn/dusk
 *    twilight windows only (daynight.ts's `isTwilight`), neutral otherwise —
 *    crepuscular hunters key off a specific window, not a continuous
 *    light-level gradient the way strictly diurnal/nocturnal ones do.
 *  - `"cathemeral"` (default): no shift at all.
 */
function activityHuntShift(agent: Agent, tick: number): number {
  const darkness = 1 - lightLevel(tick);
  switch (agent.activityPattern ?? "cathemeral") {
    case "nocturnal":
      return (darkness - 0.5) * (2 * NOCTURNAL_HUNT_THRESHOLD_SPREAD);
    case "diurnal":
      return -(darkness - 0.5) * (2 * NOCTURNAL_HUNT_THRESHOLD_SPREAD);
    case "crepuscular":
      return isTwilight(tick) ? NOCTURNAL_HUNT_THRESHOLD_SPREAD * 0.5 : 0;
    case "cathemeral":
    default:
      return 0;
  }
}

/**
 * The hunger level below which this predator switches to `hunt`. Aggressive
 * predators hunt while less hungry (higher threshold); passive ones wait
 * until hungrier (lower threshold) — DESIGN.md's hunt-trigger point. Absent
 * disposition (hand-built fixtures) reads as neutral (0.5), reducing to
 * `HUNT_HUNGER_THRESHOLD` exactly. Composes additively
 * with `activityHuntShift`'s day/night-and-activity-pattern term — an
 * aggressive nocturnal predator at midnight stacks both shifts, hunting
 * while barely hungry at all; absent both disposition and activityPattern
 * (bare fixtures), this reduces exactly to the original fixed threshold.
 */
function huntHungerThreshold(agent: Agent, tick: number): number {
  const aggression = agent.disposition?.aggression ?? 0.5;
  return (
    HUNT_HUNGER_THRESHOLD +
    (aggression - 0.5) * (2 * HUNT_THRESHOLD_SPREAD) +
    activityHuntShift(agent, tick)
  );
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

// A plain function call (rather than an inline `agent.alive === false` check)
// so TS's control-flow narrowing doesn't lock `alive`'s type down across a
// loop that calls out to a function (`applySingleDamageInstance`) that can
// mutate it — same reasoning as simulation.ts's own `isDead` helper.
function isDead(agent: Agent): boolean {
  return agent.alive === false;
}

/**
 * How much smaller a target's power has to be, relative to the predator's,
 * to be worth hunting — a predator won't bother with something its own size
 * or bigger. Tuned against this roster's real spawn-level numbers: Scyther
 * (level 8, power ~29) vs. Bulbasaur (level 5, power ~19) is right at the
 * edge of a real predator/prey pair (19/29 ≈ 0.66), and Onix (level 10,
 * power ~27) vs. Sandshrew (level 5, power ~20) is even tighter (~0.74) —
 * 0.75 keeps both working without also letting a predator take on something
 * close to its own weight class.
 */
const PREY_POWER_RATIO = 0.75;

/**
 * A rough "how big and capable is this thing" score for predation purposes.
 * `maxHp` alone already bakes in both level and species size/bulk (it's
 * `floor(2*baseHp*level/100) + level + 10` — see stats.ts), so it doubles as
 * a reasonable proxy for "level and size" without this sim needing separate
 * weight/height data it doesn't import. Falls back to a small constant for
 * an agent with no combat profile yet (shouldn't happen for a real
 * predator/prey pair, but keeps this total).
 */
function powerOf(agent: Agent): number {
  return agent.maxHp ?? agent.stats?.maxHp ?? FALLBACK_MAX_HP;
}

/**
 * Real predator/prey eligibility is dynamic, not a fixed species list: any
 * species flagged as a hunter in `rules` will go after ANY sufficiently
 * smaller/weaker nearby creature, regardless of species — a hungry Spearow
 * doesn't only eat Pidgey, it'll take a small enough Bulbasaur too if
 * they're ever on the same layer. Same species is never prey (no
 * cannibalism modeled) — checked first since two same-species agents can
 * otherwise have very different power at different levels. The target must
 * be strictly weaker than `PREY_POWER_RATIO` of the predator's own power,
 * which also makes this relation acyclic: if A preys on B, B's power is
 * already too low for B to simultaneously prey on A.
 */
export function isPreyOf(rules: HuntRules, predator: Agent, target: Agent): boolean {
  if (!rules[predator.species]) return false;
  if (target.species === predator.species) return false;
  return powerOf(target) <= powerOf(predator) * PREY_POWER_RATIO;
}

/**
 * Is `species` a hunter at all, regardless of its current power? Used for a
 * prey's own flee/mob reaction and a guardian's threat scan — deliberately
 * NOT power-gated like `isPreyOf` above. Whether something is worth
 * *hunting* is the predator's own size-aware judgment call, but whether
 * something is worth *fleeing* is prey's judgment call, and prey doesn't
 * have detailed knowledge of exactly how strong a given predator currently
 * is — a wounded or fainted predator is still a predator worth staying away
 * from or mobbing, not something to casually ignore because its HP is low.
 * Same-species exclusion mirrors `isPreyOf` for the same reason (no
 * conspecific "threat").
 */
export function isHunterSpecies(rules: HuntRules, hunterCandidateSpecies: string, ownSpecies: string): boolean {
  return !!rules[hunterCandidateSpecies] && hunterCandidateSpecies !== ownSpecies;
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

/**
 * Is any hunter-flagged threat within `FLEE_DETECT_RADIUS` of `agent`? Used
 * by needs.ts's sleep trigger/wake checks. Deliberately the simpler flat-
 * radius primitive (`agentsWithin` + `isHunterSpecies` + the fixed
 * `FLEE_DETECT_RADIUS`), not the boldness-tuned `effectiveFleeRadius` or the
 * concealment-aware `isDetectable` this file keeps private — sleep's "is
 * anything dangerous in the area at all" check doesn't need that individual
 * nuance the way an active flee/fight decision does, so there's no reason to
 * export those two just for this.
 */
export function hasNearbyThreat(world: World, agent: Agent, rules: HuntRules): boolean {
  return agentsWithin(world, agent, FLEE_DETECT_RADIUS).some((other) => isHunterSpecies(rules, other.species, agent.species));
}

/**
 * An awake, conscious, same-herd agent within `SLEEP_WATCH_RADIUS` of `agent`
 * (the sleeper) — the "herd protects each other, can wake each other up"
 * half of needs.ts's sleep mechanic. Fainted and already-asleep herd-mates
 * don't count as watchers: they can't actually notice or act on a threat
 * themselves right now.
 */
export function hasAwakeHerdmateNearby(world: World, agent: Agent): boolean {
  if (!agent.herdId) return false;
  return world.agents.some(
    (other) =>
      other.id !== agent.id &&
      other.alive !== false &&
      !other.fainted &&
      !other.asleep &&
      other.herdId === agent.herdId &&
      other.layer === agent.layer &&
      manhattan(other.pos, agent.pos) <= SLEEP_WATCH_RADIUS
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

/**
 * Can `agent` actually hit `target` (already known to be `distance` tiles
 * away) right now? Requires both a move whose reach covers `distance` AND an
 * unobstructed straight-line path to the target — a tree, boulder, or wall
 * between attacker and target now blocks a line-shaped move's path exactly
 * like it blocks ambient line of sight (fov.ts's `isPathClear`), not just
 * cosmetic FOV. Previously this only checked range, so a ranged attacker
 * could "shoot" straight through an obstacle it couldn't see or walk
 * through — see DESIGN.md's obstacle-combat section.
 */
function canAttackFromHere(world: World, agent: Agent, target: Agent, distance: number): boolean {
  // Passing `distance` here (not just checking it after the fact) is the
  // fix for a real bug: picking "the best move on paper" and only then
  // checking whether it happens to reach would reject an attack even when a
  // different, in-range move was available the whole time. See
  // pickBestMove's own doc comment and DESIGN.md's "Move selection" section.
  const move = pickBestMove(agent, target.types ?? [], distance);
  if (!move) return false;
  return isPathClear(world, agent.layer, agent.pos, target.pos);
}

/** True if a "bush" tile is what `agent` is currently standing on — see `Tile.concealment`. */
function isConcealed(world: World, agent: Agent): boolean {
  return tileAt(world, agent.layer, agent.pos.x, agent.pos.y)?.concealment === true;
}

/** How much a bush shrinks the effective radius at which something standing in it gets noticed — real, not cosmetic. Sim-original magnitude, not canon. */
const BUSH_CONCEALMENT_DETECTION_REDUCTION = 2;

/**
 * Is `target` within `baseRadius` of `observerPos`, accounting for
 * concealment? A concealed target effectively needs to be
 * `BUSH_CONCEALMENT_DETECTION_REDUCTION` tiles *closer* than an exposed one
 * before it's noticed — floored so concealment can never make a target
 * fully undetectable at any distance, only harder to spot at range.
 */
function isDetectable(world: World, observerPos: Vec2, target: Agent, baseRadius: number): boolean {
  const radius = isConcealed(world, target) ? Math.max(1, baseRadius - BUSH_CONCEALMENT_DETECTION_REDUCTION) : baseRadius;
  return manhattan(observerPos, target.pos) <= radius;
}

/**
 * Whether ANY currently-alive hunter-flagged agent in the world has enough
 * power to treat `agent` as prey right now — the dynamic replacement for a
 * static "this species is never prey" fact. A newly-hatched Bulbasaur is
 * vulnerable; the same individual once it's leveled up (or evolved into
 * Venusaur) past every hunter's threshold isn't, without needing a
 * species-level guardian flag anywhere. Checked against every hunter in the
 * world, not just ones nearby right now, so a herd correctly keeps treating
 * its vulnerable members as vulnerable even in the tick before a predator
 * actually shows up (used for the guardian-vs-ordinary-member leash choice
 * in herding.ts, and to gate the guardian-intervention behavior below).
 */
export function isPreyOfAnything(rules: HuntRules, world: World, agent: Agent): boolean {
  return world.agents.some(
    (other) => other.id !== agent.id && other.alive !== false && isPreyOf(rules, other, agent)
  );
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
 * A move's damage-formula-independent situational multiplier
 * (`MoveSpec.situationalBonus`), evaluated at the moment of the hit —
 * real battlefield state, not a tree-time delta. `"targetLowHp"`: the
 * defender is at or below half HP. `"flanking"`: the defender isn't
 * currently reacting to *this* attacker specifically (its `fightTarget`/
 * `huntTarget` points elsewhere or is unset) — a rough "caught it off
 * guard" proxy, since the sim has no richer facing/awareness model to check
 * against. `"night"`: the world is currently in its night phase
 * (daynight.ts's `isNight`). 1 (no change) if the move sets no
 * `situationalBonus`, or its condition doesn't currently hold.
 */
function situationalMultiplier(world: World, attacker: Agent, defender: Agent, move: MoveSpec): number {
  const bonus = move.situationalBonus;
  if (!bonus) return 1;
  switch (bonus.condition) {
    case "targetLowHp":
      return defender.hp !== undefined && defender.maxHp !== undefined && defender.maxHp > 0 && defender.hp / defender.maxHp <= 0.5
        ? bonus.multiplier
        : 1;
    case "flanking":
      return defender.fightTarget !== attacker.id && defender.huntTarget !== attacker.id ? bonus.multiplier : 1;
    case "night":
      return isNight(world.tick) ? bonus.multiplier : 1;
    case "elevation": {
      const attackerElevation = tileAt(world, attacker.layer, attacker.pos.x, attacker.pos.y)?.elevation ?? 0;
      const defenderElevation = tileAt(world, defender.layer, defender.pos.x, defender.pos.y)?.elevation ?? 0;
      return attackerElevation > defenderElevation ? bonus.multiplier : 1;
    }
    case "concealed":
      return isConcealed(world, attacker) ? bonus.multiplier : 1;
    case "coldSnap":
      return isInColdSnap(world, attacker.layer, attacker.pos) ? bonus.multiplier : 1;
    case "storm":
      return activeWeatherAt(world, attacker.pos)?.type === "storm" ? bonus.multiplier : 1;
    case "drought":
      return activeWeatherAt(world, attacker.pos)?.type === "drought" ? bonus.multiplier : 1;
    case "rain":
      return activeWeatherAt(world, attacker.pos)?.type === "rain" ? bonus.multiplier : 1;
    case "targetBurning":
      return isBurned(defender) ? bonus.multiplier : 1;
    case "targetStatused":
      return defender.status !== undefined ? bonus.multiplier : 1;
  }
}

/**
 * One damage instance against `defender` — the shared core of a single hit,
 * reused for every hit of a multi-hit move and for every target of an AoE
 * move. Returns true only on a true death (see `resolveHit`'s own doc
 * comment). `rng` is threaded all the way through (crit roll, damage
 * variance, skill-point/kill-exp grants) rather than left on the module's
 * default `Math.random` — this project's determinism guarantee (see
 * DESIGN.md's "Determinism" section) requires every random draw to come
 * from `World.rng`, and this function is on that path for every real hit
 * in the sim.
 */
function applySingleDamageInstance(
  world: World,
  attacker: Agent,
  defender: Agent,
  move: MoveSpec,
  log: EventLog | undefined,
  faintKind: "killed" | "defeated",
  ctx: LevelingContext | undefined,
  rng: () => number = Math.random
): boolean {
  const isCritical = rollCritical(move.critRateStage ?? 0, rng);
  const situational = situationalMultiplier(world, attacker, defender, move);

  // `weightScaling` adds bonus power proportional to the attacker's own
  // maxHp (this sim's proxy for size/weight — see `powerOf`'s own doc
  // comment) — computed into an effective move rather than mutating `move`
  // itself, since `move` is the live, shared `MoveSpec` on the attacker.
  const effectiveMove = move.weightScaling
    ? { ...move, power: move.power + move.weightScaling.factor * (attacker.maxHp ?? attacker.stats?.maxHp ?? FALLBACK_MAX_HP) }
    : move;

  const rawDamage =
    attacker.level !== undefined && attacker.types && attacker.stats && defender.stats
      ? calculateDamage(
          {
            level: attacker.level,
            types: attacker.types,
            stats: attacker.stats,
            statStages: {
              attack: (isBurned(attacker) ? BURN_ATTACK_STAGE : 0) + getStatStage(attacker, "attack"),
              spAttack: getStatStage(attacker, "spAttack"),
            },
          },
          { types: defender.types ?? [], stats: defender.stats, statStages: { defense: getStatStage(defender, "defense"), spDefense: getStatStage(defender, "spDefense") } },
          effectiveMove,
          0.85 + rng() * 0.15,
          isCritical
        ).damage
      : FALLBACK_DAMAGE;

  const damage = Math.max(0, Math.floor(rawDamage * situational * (1 - damageReductionOf(defender))));

  if (damage > 0) maybeGrantHitSkillPoint(attacker, move.type, world, log, ctx, rng);

  // Lifesteal, recoil, and thorns are all attacker/defender HP side-effects
  // of a landed hit, independent of whether it faints/finishes anyone —
  // applied against the real damage dealt, before the fainted/finishing-pool
  // branches below (which only ever touch `defender`'s own hp bookkeeping).
  if (damage > 0 && move.lifestealFraction) {
    const attackerMaxHp = attacker.maxHp ?? attacker.stats?.maxHp ?? FALLBACK_MAX_HP;
    attacker.hp = Math.min(attackerMaxHp, (attacker.hp ?? attackerMaxHp) + Math.floor(damage * move.lifestealFraction));
  }
  if (damage > 0 && move.recoilFraction) {
    attacker.hp = Math.max(1, (attacker.hp ?? attacker.maxHp ?? FALLBACK_MAX_HP) - Math.floor(damage * move.recoilFraction));
  }
  const thorns = thornsOf(defender);
  if (damage > 0 && thorns > 0) {
    attacker.hp = Math.max(1, (attacker.hp ?? attacker.maxHp ?? FALLBACK_MAX_HP) - Math.floor(damage * thorns));
  }

  // Every real hit against a herd member counts toward that herd's
  // predator-pressure trigger (herdMigration.ts) — the running-counter
  // "updated at the event-emission site" this landed on, rather than a
  // per-tick EventLog scan. Recorded here (once, above both "fought"
  // log sites below) since both the finishing-blow and normal-hit phases
  // are equally real pressure on the defender's herd.
  recordPredatorPressure(world, defender.herdId, attacker.pos);

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
      moveId: move.id,
      pos: defender.pos,
    });

    if (defender.finishingPool > 0) return false; // still down, not finished

    defender.alive = false;
    defender.finishingPool = 0;
    defender.diedAtTick = world.tick;
    grantKillExp(world, attacker, defender, ctx, log, rng);
    logKillOrDefeat(world, attacker, defender, faintKind, log);
    return true;
  }

  defender.hp = Math.max(0, (defender.hp ?? defender.maxHp ?? FALLBACK_MAX_HP) - damage);

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
    moveId: move.id,
    pos: defender.pos,
  });

  if (defender.hp > 0) return false;

  // This hit brought hp to 0 — faint, don't kill outright. Fainting always
  // cures status, mainline-real (same as the DOT-causes-faint path in
  // status.ts's tickStatusEffects).
  defender.fainted = true;
  defender.finishingPool = FINISHING_POOL_FRACTION * (defender.maxHp ?? FALLBACK_MAX_HP);
  defender.status = undefined;
  log?.record({ kind: "fainted", tick: world.tick, agentId: defender.id, species: defender.species, pos: defender.pos });
  return false; // not a true death yet
}

/**
 * Resolves an already-picked, already-`useMove`'d move against one
 * `defender`: an accuracy roll, `move.hits`' multi-hit loop (each hit its
 * own damage instance via `applySingleDamageInstance`, stopping early on a
 * true death), then — only when `isPrimaryTarget` and the defender wasn't
 * already fainted going in and ends this resolution alive/conscious/hp>0 —
 * the "landed, damaging, non-killing hit" hooks: status infliction,
 * `statChangeOnHit`'s defender-side effect, onHit forced movement, and
 * `positionSwap`. `isPrimaryTarget` is false for an AoE move's incidental
 * targets (`resolveAreaHit`) — a knockback/position-swap/status effect only
 * ever targets the one deliberately-picked defender, not everyone caught in
 * a Growl-style blast. Returns true only on a true death.
 */
function resolveHitAgainstTarget(
  world: World,
  attacker: Agent,
  defender: Agent,
  move: MoveSpec,
  log: EventLog | undefined,
  faintKind: "killed" | "defeated",
  ctx: LevelingContext | undefined,
  isPrimaryTarget: boolean,
  rng: () => number = Math.random
): boolean {
  if (defender.alive === false) return false; // already a corpse — nothing left to finish off here (looting/scavenging is a separate path, see support.ts)

  defender.maxHp = defender.maxHp ?? defender.stats?.maxHp ?? FALLBACK_MAX_HP;
  defender.hp = defender.hp ?? defender.maxHp;
  const wasFaintedBefore = defender.fainted === true;

  if (!rollAccuracy(move, 0, 0, rng, stormAccuracyMultiplier(world, attacker.layer, attacker.pos))) {
    log?.record({
      kind: "missed",
      tick: world.tick,
      attackerId: attacker.id,
      attackerSpecies: attacker.species,
      defenderId: defender.id,
      defenderSpecies: defender.species,
      moveId: move.id,
      pos: defender.pos,
    });
    return false;
  }

  // A landed Fire hit thaws a frozen defender instantly, independent of
  // whether this move itself inflicts anything — real mainline behavior.
  maybeThawOnFireHit(defender, move.type, world, log);

  let diedTrue = false;
  const hitCount = rollHitCount(move.hits, rng);
  for (let i = 0; i < hitCount; i++) {
    if (isDead(defender)) break; // died mid-flurry — nothing left for later hits of this same move to land on
    if (applySingleDamageInstance(world, attacker, defender, move, log, faintKind, ctx, rng)) {
      diedTrue = true;
      break;
    }
  }

  if (isPrimaryTarget && !diedTrue && !wasFaintedBefore && !isDead(defender) && !defender.fainted && (defender.hp ?? 0) > 0) {
    // A landed, damaging, non-killing hit — the one place status, the
    // defender-side stat change, on-hit forced movement, and a position
    // swap get a chance to apply.
    maybeInflictStatus(defender, attacker.id, move, world, log, rng);
    if (move.statusSpreads && defender.status) {
      maybeSpreadStatus(defender, attacker.id, defender.status.kind, world, log, rng);
    }
    if (move.statChangeOnHit?.target === "defender") {
      applyStatStage(defender, move.statChangeOnHit.stat, move.statChangeOnHit.stage, move.statChangeOnHit.ticks);
    }
    if (move.forcedMovement?.timing === "onHit") applyForcedMovement(world, move.forcedMovement, attacker, defender);
    if (move.positionSwap) {
      const attackerPos = { ...attacker.pos };
      attacker.pos = { ...defender.pos };
      defender.pos = attackerPos;
    }
    if (move.jamCooldownTicks && defender.moveCooldowns) {
      for (const moveId of Object.keys(defender.moveCooldowns)) {
        defender.moveCooldowns[moveId]! += move.jamCooldownTicks;
      }
    }
    if (move.terrainBurn) {
      const tile = tileAt(world, defender.layer, defender.pos.x, defender.pos.y);
      if (tile?.terrain === "bush") setTile(world, defender.layer, defender.pos.x, defender.pos.y, "floor");
    }
  }

  return diedTrue;
}

/** Derives a facing (moves.ts's `Direction`) from `from` toward `to` — whichever axis has the larger displacement wins; ties resolve toward south, an arbitrary but harmless default (only reachable when `to === from`). */
function facingToward(from: Vec2, to: Vec2): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "E" : "W";
  return dy > 0 ? "S" : "N";
}

/**
 * Resolves a `MoveSpec.hitsArea` move: every living agent standing on a
 * tile the move's `shape` covers (facing derived from attacker toward
 * `primaryTarget` via `facingToward`), attacker itself excluded — a
 * Growl/Ring-of-Fire-style blast, not just the one deliberately-picked
 * target. `primaryTarget` still gets the primary-target-only hooks (status,
 * `statChangeOnHit`'s defender side, forced movement, position swap);
 * everyone else caught in the blast only takes the raw hit-count/damage
 * loop. Returns true only if `primaryTarget` itself was truly killed by
 * this resolution — matches `resolveHit`'s existing "did the hunt's own
 * target die" contract; incidental AoE kills still fire their own
 * `killed`/`defeated` + kill-exp events inside `applySingleDamageInstance`,
 * they just don't drive the calling predator's own hunger-restore/hunt-
 * cleared bookkeeping in `applyPredationInstincts`.
 */
function resolveAreaHit(
  world: World,
  attacker: Agent,
  primaryTarget: Agent,
  move: MoveSpec,
  log: EventLog | undefined,
  faintKind: "killed" | "defeated",
  ctx: LevelingContext | undefined,
  rng: () => number = Math.random
): boolean {
  const facing = facingToward(attacker.pos, primaryTarget.pos);
  const tiles = resolveShape(move.shape, attacker.pos, facing);
  const tileSet = new Set(tiles.map((t) => `${t.x},${t.y}`));
  const targets = world.agents.filter(
    (other) => other.id !== attacker.id && other.alive !== false && other.layer === attacker.layer && tileSet.has(`${other.pos.x},${other.pos.y}`)
  );

  let primaryDied = false;
  for (const target of targets) {
    const isPrimary = target.id === primaryTarget.id;
    const died = resolveHitAgainstTarget(world, attacker, target, move, log, faintKind, ctx, isPrimary, rng);
    if (died && isPrimary) primaryDied = true;
  }
  return primaryDied;
}

/**
 * One attack: picks the attacker's best off-cooldown, in-range move against
 * the defender (see `pickBestMove`), commits to it (`useMove` — cooldown,
 * and any `lockTicks`), resolves its `beforeHit` forced movement and
 * `statChangeOnHit`'s self-side effect (both apply the instant the move is
 * used, independent of whether it goes on to hit anything), then resolves
 * the actual hit(s) — either against just `defender` or, for a
 * `hitsArea` move, against every agent caught in its resolved shape
 * (`resolveAreaHit`). See `resolveHitAgainstTarget`/`applySingleDamageInstance`
 * for the real accuracy/damage/faint machinery, and DESIGN.md's "Faint/
 * finish-off" section for the two-stage faint/true-death model.
 *
 * Returns true only when `defender` itself suffered a TRUE death (`alive`
 * newly `false`) this call — never on a mere faint, and never for an
 * incidental AoE side-target's own death. Callers that restore a predator's
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
  ctx: LevelingContext | undefined,
  distance: number,
  rng: () => number = Math.random
): boolean {
  if (defender.alive === false) return false; // already a corpse — nothing left to finish off here (looting/scavenging is a separate path, see support.ts)

  defender.maxHp = defender.maxHp ?? defender.stats?.maxHp ?? FALLBACK_MAX_HP;
  defender.hp = defender.hp ?? defender.maxHp;

  // `distance` is passed by every call site's own `canAttackFromHere` check
  // right above it, so this picks consistently with what was just validated
  // as reachable, rather than re-deriving its own (possibly different, now
  // that scoring is tempo-weighted too) answer independently.
  const move = pickBestMove(attacker, defender.types ?? [], distance);
  if (!move) return false; // every move on cooldown, or none reach from here, this tick

  useMove(attacker, move);

  if (move.selfCostPerUse) {
    attacker.needs[move.selfCostPerUse.need] = Math.max(0, attacker.needs[move.selfCostPerUse.need] - move.selfCostPerUse.amount);
  }

  // A lunge resolves before the hit itself — the attacker's range was
  // already validated by canAttackFromHere before resolveHit was ever
  // called, so this doesn't change whether THIS hit lands, only where the
  // attacker ends up standing for whatever comes next.
  if (move.forcedMovement?.timing === "beforeHit") applyForcedMovement(world, move.forcedMovement, attacker, defender);

  // A self-side stat change (e.g. a windup buff) always applies the moment
  // the move is used — see `MoveSpec.statChangeOnHit`'s own doc comment.
  if (move.statChangeOnHit?.target === "self") {
    applyStatStage(attacker, move.statChangeOnHit.stat, move.statChangeOnHit.stage, move.statChangeOnHit.ticks);
  }

  if (move.hitsArea) return resolveAreaHit(world, attacker, defender, move, log, faintKind, ctx, rng);
  return resolveHitAgainstTarget(world, attacker, defender, move, log, faintKind, ctx, true, rng);
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
function giveUpAndRelocate(world: World, agent: Agent, log: EventLog | undefined, rng: () => number): boolean {
  const result = migrate(world, agent, log, rng);
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
 *
 * `agent.asleep` (needs.ts's sleep mechanic) guards this function's
 * self-defense branches specifically — the critically-hurt flee check right
 * below, the general threats flee/mob block, and the hunt-for-food block
 * near the bottom — since a genuinely sleeping agent is meant to be a
 * sitting duck that won't flee or fight back on its own (DESIGN.md's "sleep:
 * a real vulnerable-rest state" section). The guardian-intervention branch
 * (a non-prey herd-mate defending a *different* endangered herd-mate) is
 * deliberately NOT guarded: a guardian still notices and intercepts a threat
 * to someone else even while it happens to be asleep itself, and firing that
 * branch also clears the guardian's own `asleep` flag below, since actively
 * moving to fight isn't consistent with still being asleep.
 *
 * `thirstIsUrgent` (default false, computed by the caller) gates only the
 * "give up hunting and wander off" relocate mechanic near the bottom
 * (`giveUpAndRelocate`/`migrate`): a real bug this guards against, confirmed
 * in an actual run — a predator that commits to a directionless multi-
 * hundred-tick relocate walk never got a chance to drink along the way (the
 * same "commits no matter what" shape natal dispersal used to have before
 * its own fix), and died of thirst mid-walk. Deliberately just thirst, not
 * `chooseBehavior`'s general urgency: hunger is what's driving the hunt/
 * relocate in the first place, so a hungry predator can and should still
 * start/continue relocating — that IS how it pursues its own hunger. Flee/
 * fight/hunting-a-visible-target are all unaffected either way — only the
 * open-ended wandering search pauses, resuming automatically (via
 * `agent.relocateTarget`'s own persistence, unchanged by this) once thirst
 * is satisfied again.
 */
export function applyPredationInstincts(
  world: World,
  agent: Agent,
  rules: HuntRules,
  log?: EventLog,
  ctx?: LevelingContext,
  rng: () => number = Math.random,
  thirstIsUrgent = false
): boolean {
  if (!agent.asleep && isCriticallyHurt(agent)) {
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

  if (!isPreyOfAnything(rules, world, agent)) {
    const herdmate = findHerdmateInDanger(world, agent);
    if (herdmate) {
      // Deliberately includes a fainted predator: a guardian keeps pressing the
      // fight to finish it off, same reasoning as the general threats filter below.
      const herdmateThreats = agentsWithin(world, herdmate, FLEE_DETECT_RADIUS).filter((other) =>
        isHunterSpecies(rules, other.species, herdmate.species)
      );
      const threat = nearest(herdmate, herdmateThreats);
      if (threat) {
        const distance = manhattan(agent.pos, threat.pos);
        // Actively fighting to defend a herd-mate isn't consistent with
        // still being asleep — clears it even though this guardian branch
        // fires regardless of `agent.asleep` (see this function's doc
        // comment above).
        agent.asleep = false;
        agent.sleepTicks = 0;
        logBehaviorChange(log, world, agent, "fight");
        agent.behavior = "fight";
        agent.fightTarget = threat.id;
        if (canAttackFromHere(world, agent, threat, distance)) {
          resolveHit(world, agent, threat, log, "defeated", ctx, distance, rng);
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
  // Skipped entirely while `agent.asleep` — a sleeping agent doesn't flee or
  // mob on its own initiative, per this function's doc comment above.
  const threats = agent.asleep
    ? []
    : agentsWithin(world, agent, effectiveFleeRadius(agent)).filter(
        (other) =>
          isHunterSpecies(rules, other.species, agent.species) &&
          isDetectable(world, agent.pos, other, effectiveFleeRadius(agent))
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
      if (canAttackFromHere(world, agent, threat, distance)) {
        resolveHit(world, agent, threat, log, "defeated", ctx, distance, rng);
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

  // Also skipped while asleep — a sleeping predator doesn't hunt on its own
  // initiative either, same reasoning as the flee/mob block above.
  if (!agent.asleep && rules[agent.species] && agent.needs.hunger < huntHungerThreshold(agent, world.tick)) {
    const candidates = agentsWithin(world, agent, HUNT_DETECT_RADIUS).filter(
      (other) =>
        isPreyOf(rules, agent, other) &&
        !isProtectedByMob(world, other) &&
        isDetectable(world, agent.pos, other, HUNT_DETECT_RADIUS)
    );
    const target = nearest(agent, candidates);

    if (target) {
      logBehaviorChange(log, world, agent, "hunt");
      agent.behavior = "hunt";
      agent.huntTarget = target.id;

      const huntDistance = manhattan(agent.pos, target.pos);
      if (canAttackFromHere(world, agent, target, huntDistance)) {
        // A single hit may not be lethal now — real HP, real damage, and even
        // a lethal hit only FAINTS the target (see resolveHit/DESIGN.md). The
        // meal (and hunger restore) only happens once the target is truly
        // dead — resolveHit returns true only at that moment, never on a mere
        // faint — so hunting a fainted target across several ticks to finish
        // it off, then eating, is the normal two-stage path here.
        const died = resolveHit(world, agent, target, log, "killed", ctx, huntDistance, rng);
        if (died) {
          // A real kill is a much bigger deal than grazing — full restore
          // plus an extended "digesting" slowdown on top (needs.ts's
          // `KILL_SATIATION_HUNGER_DECAY_MULTIPLIER`), not just a flat
          // instant bump back toward normal hunger-seeking.
          agent.needs.hunger = 1;
          agent.digestingTicksRemaining = KILL_SATIATION_TICKS;
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
      // Paused, not abandoned, while an urgent need outranks it —
      // `agent.relocateTarget` (if already set from an earlier tick) is left
      // untouched, so the walk resumes exactly where it left off once the
      // agent is idle again. See this function's own doc comment.
      if (!thirstIsUrgent) return giveUpAndRelocate(world, agent, log, rng);
    }
  }

  return false;
}
