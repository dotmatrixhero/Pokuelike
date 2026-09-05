import type { Agent, HuntRules, Layer, TerrainKind, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { logBehaviorChange } from "./events.js";
import { applyForcedMovement, stepAway, stepToward } from "./movement.js";
import { migrate } from "./migration.js";
import { calculateDamage, pickBestMove, useMove, rollAccuracy, rollCritical, rollHitCount } from "./combat.js";
import type { Direction } from "./moves.js";
import { resolveShape } from "./moves.js";
import type { MoveSpec } from "./moves.js";
import { canBreed, grantKillExp, maybeGrantHitSkillPoint, type LevelingContext } from "./leveling.js";
import { FINISHING_POOL_FRACTION, applyAllyEffect, nearestAllyEffectTarget } from "./support.js";
import { RAPPORT_MOB_DEFENSE_DELTA, strengthenRapportMutual } from "./rapport.js";
import { effectiveDisposition } from "./herdLeadership.js";
import { isPathClear } from "./fov.js";
import { stepTowardMovingTarget } from "./pathfinding.js";
import { tileAt, setTile } from "./world.js";
import { recordPredatorPressure } from "./herdMigration.js";
import { isNight, isTwilight, lightLevel } from "./daynight.js";
import { activeWeatherAt, isInColdSnap, stormAccuracyMultiplier } from "./weather.js";
import {
  applyStatStage,
  BURN_ATTACK_STAGE,
  damageReductionOf,
  defenseBoostOf,
  getStatStage,
  isBurned,
  maybeInflictStatus,
  maybeSpreadStatus,
  maybeThawOnFireHit,
  thornsOf,
} from "./status.js";

/** How far a herd's non-prey members (e.g. Venusaur) will travel to intervene when a herd-mate is in trouble. */
const GUARDIAN_DETECT_RADIUS = 6;

/** Dry, walkable terrain kinds `MoveSpec.terrainFill` can convert into standing water — deliberately narrow, not every non-water tile (a wall/tree obviously shouldn't become a puddle). */
const TERRAIN_FILLABLE = new Set<TerrainKind>(["floor", "sand", "mud"]);

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
 * MOB_THRESHOLD of 3 exactly. Reads `effectiveDisposition` (herdLeadership.ts),
 * not `agent.disposition` directly, so a herd's current leader's own
 * boldness/aggression pulls its herd-mates' mob-commitment threshold toward
 * its own — see DESIGN.md's "Herd Leadership" section.
 */
function mobThreshold(world: World, agent: Agent): number {
  const disposition = effectiveDisposition(world, agent);
  const boldness = disposition.boldness;
  const aggression = disposition.aggression;
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
 * FLEE_DETECT_RADIUS of 4 exactly. Reads `effectiveDisposition`
 * (herdLeadership.ts), so a herd's current leader's own boldness nudges its
 * herd-mates' flee-trigger radius toward its own.
 */
function effectiveFleeRadius(world: World, agent: Agent): number {
  const boldness = effectiveDisposition(world, agent).boldness;
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
 * Reads `effectiveDisposition` (herdLeadership.ts), so a herd's current
 * leader's own aggression nudges its herd-mates' hunt-trigger threshold
 * toward its own.
 */
export function huntHungerThreshold(world: World, agent: Agent, tick: number): number {
  const aggression = effectiveDisposition(world, agent).aggression;
  return (
    HUNT_HUNGER_THRESHOLD +
    (aggression - 0.5) * (2 * HUNT_THRESHOLD_SPREAD) +
    activityHuntShift(agent, tick)
  );
}
/** Fallback HP for an agent with no real combat profile (stats/level/types) — shouldn't happen for fully-statted species. Exported so support.ts's body-weight proxy can match it. */
export const FALLBACK_MAX_HP = 10;
const FALLBACK_DAMAGE = 1;
/** A predator at or below this fraction of max HP flees a fight instead of continuing it. See `retreatHpFraction` for the juvenile-aware version actually used. */
const RETREAT_HP_FRACTION = 0.4;
/**
 * Juveniles flee a losing fight noticeably earlier than an adult of the same
 * species — real biology, and a genuine mechanical difference (not just a
 * flag), per the ontogenetic-niche-shift ask: young animals are markedly
 * more risk-averse than adults, not just less capable. Applies to `isCriticallyHurt`
 * generally (any species, not just predators — `isJuvenile` is purely
 * age-gated, no `rules` lookup involved), which is a deliberate, harmless
 * generalization: nothing in this codebase's existing tests sets `agent.age`
 * on a fixture, so every pre-existing scenario (`agent.age === undefined`,
 * `isJuvenile` false) is completely unaffected — only a genuinely young agent
 * sees the earlier flee point.
 */
const JUVENILE_RETREAT_HP_FRACTION = 0.6;
/**
 * How young (in `Agent.age` ticks) counts as a juvenile for the ontogenetic
 * niche shift — deliberately well below `reproduction.ts`'s `MATURITY_AGE`
 * (200), reusing that module's existing "age is the maturity proxy" convention
 * rather than inventing a second age concept (see DESIGN.md). `agent.age ===
 * undefined` (a hand-built fixture, or an agent spawned directly into a
 * scenario) reads as already-adult, matching `isMature`'s own "absent = mature"
 * default exactly.
 */
export const JUVENILE_AGE_THRESHOLD = 60;

/**
 * Is `agent` a juvenile — too young to hunt independently, more skittish in
 * a fight than an adult of the same species? See `JUVENILE_AGE_THRESHOLD`'s
 * doc comment for why the cutoff sits well below `MATURITY_AGE`, and this
 * function's callers (the hunt-eligibility gate below, `retreatHpFraction`,
 * and support.ts's `applyScavenging`) for the concrete behavior differences.
 */
export function isJuvenile(agent: Agent): boolean {
  return agent.age !== undefined && agent.age < JUVENILE_AGE_THRESHOLD;
}

/** The real HP fraction `isCriticallyHurt` flees at — earlier (higher) for a juvenile, see `JUVENILE_RETREAT_HP_FRACTION`'s doc comment. */
function retreatHpFraction(agent: Agent): number {
  return isJuvenile(agent) ? JUVENILE_RETREAT_HP_FRACTION : RETREAT_HP_FRACTION;
}

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
 * How much bigger than `PREY_POWER_RATIO` a target can be and still be worth
 * a coordinated PACK hunt — real biology: a lone wolf won't take on a moose,
 * but a pack will. Wider than the solo `PREY_POWER_RATIO` (0.75) but still
 * bounded, not "anything goes with enough friends" — `isPackPreyOf` only ever
 * covers the band strictly above solo-eligible (would already be hunted
 * alone) and at/below this ratio (still hopeless even for a pack). Sim-
 * original magnitude, judge against a real run like every other tuning
 * constant here.
 */
const PACK_PREY_POWER_RATIO = 1.15;
/** How far a same-species conspecific has to be to join/be counted toward a pack hunt — muster range, matching `MOB_MUSTER_RADIUS`'s own shape for the mirrored offense-side mechanic. */
const PACK_MUSTER_RADIUS = 5;
/** Minimum total pack size (the hunting agent itself plus at least this many nearby same-species conspecifics) before a pack hunt is even attempted — 1 real ally, not zero (a "pack" of one is just a solo hunt). */
const MIN_PACK_ALLIES = 1;
/** Real per-ally accuracy bonus for a coordinated pack hunt — more hunters genuinely land more hits, the actual mechanical lever this feature exists to provide (not flavor text). Composes additively per already-committed packmate, capped below. */
const PACK_ACCURACY_BONUS_PER_ALLY = 0.15;
/** Ceiling on the pack accuracy bonus — even a large pack doesn't guarantee a hit outright. */
const PACK_ACCURACY_BONUS_CAP = 0.45;

/**
 * The dynamic pack-hunting equivalent of `isPreyOf`: `target` is too strong
 * for `predator` to take on alone (fails `isPreyOf`'s own `PREY_POWER_RATIO`
 * gate) but still within reach of a coordinated pack, per
 * `PACK_PREY_POWER_RATIO`. Same same-species exclusion as `isPreyOf` for the
 * same reason (no cannibalism, and the acyclic-relation argument in that
 * function's doc comment applies here too). Deliberately does NOT also
 * require `rules[predator.species]` here — callers already gate on that
 * before ever reaching this, same convention as `isPreyOf`.
 */
export function isPackPreyOf(rules: HuntRules, predator: Agent, target: Agent): boolean {
  if (!rules[predator.species]) return false;
  if (target.species === predator.species) return false;
  const targetPower = powerOf(target);
  const predatorPower = powerOf(predator);
  return targetPower > predatorPower * PREY_POWER_RATIO && targetPower <= predatorPower * PACK_PREY_POWER_RATIO;
}

/**
 * Living, conscious same-species conspecifics near `pos` — the pack-hunting
 * equivalent of `countHerdAllies`, but deliberately NOT herd-gated: unlike
 * prey's mob-fighting (which only ever musters actual herd-mates), this
 * sim's predator species mostly spawn and stay solitary (no `herdId` at all
 * in the demo scenario — see `packages/data/src/scenario.ts`), so gating a
 * predator-side pack mechanic on shared `herdId` the way `countHerdAllies`
 * does would mean it essentially never fires. Real pack behavior in nature
 * doesn't require formal herd bookkeeping either — proximity plus species is
 * the real trigger.
 */
function nearbySameSpeciesConspecifics(world: World, agent: Agent, pos: Vec2, radius: number): Agent[] {
  return world.agents.filter(
    (other) =>
      other.id !== agent.id &&
      other.alive !== false &&
      !other.fainted &&
      other.species === agent.species &&
      other.layer === agent.layer &&
      manhattan(other.pos, pos) <= radius
  );
}

/**
 * How many OTHER same-species conspecifics are already actively committed to
 * hunting this exact `targetId` (`Agent.huntTarget`, set the tick they
 * themselves picked this same target — a real, positioning-driven signal,
 * not an invented dice roll) within pack range. This is what the accuracy
 * bonus is actually computed from — a wider "conspecifics somewhere nearby"
 * count would reward mere proximity, not real coordination on the same
 * target.
 */
function committedPackmates(world: World, agent: Agent, targetId: string, targetPos: Vec2): number {
  return nearbySameSpeciesConspecifics(world, agent, targetPos, PACK_MUSTER_RADIUS).filter(
    (other) => other.huntTarget === targetId
  ).length;
}

/** The real accuracy multiplier a coordinated pack hunt grants, given how many packmates are already committed to the same target. 1 (no change) with zero committed packmates. */
function packAccuracyMultiplier(committedAllies: number): number {
  if (committedAllies <= 0) return 1;
  return 1 + Math.min(committedAllies * PACK_ACCURACY_BONUS_PER_ALLY, PACK_ACCURACY_BONUS_CAP);
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

/**
 * Nearby living agents (fainted ones included — a fainted agent is still
 * `alive !== false`, and remains a valid hunt/threat target). Eggs
 * (`Agent.isEgg`) are deliberately excluded — the single choke point that
 * keeps an egg out of every ordinary flee/hunt/mob/threat scan built on top
 * of this function: eggs are only ever touched by `applyEggDefense`/
 * `applyEggEating` below (a real, intentionally-widened predation-adjacent
 * mechanic, not the ordinary predator/prey `HuntRules` pipeline — see those
 * functions' own doc comments for why).
 */
export function agentsWithin(world: World, agent: Agent, radius: number): Agent[] {
  return world.agents.filter(
    (other) =>
      other.id !== agent.id &&
      other.alive !== false &&
      !other.isEgg &&
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
      !other.isEgg &&
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
 * The real "focus fire" primitive: prefers a rally-marked candidate
 * (`Agent.rallyMarkTicksRemaining`, set by `MoveSpec.rallyCall` on a landed,
 * non-killing hit) over a merely-closer one, falling back to plain
 * `nearest` when nothing among `others` is marked. Ties among multiple
 * marked candidates resolve by distance, same as the unmarked fallback —
 * marking isn't itself a tie-break priority, just a filter applied first.
 * Used at every threat/hunt-target pick where several independent agents
 * choosing the *same* target actually matters (mob-fight, a guardian's own
 * pick, a predator's hunt target) — not at every `nearest` call site (e.g.
 * "who's currently attacking me" while fleeing isn't a pick worth biasing).
 */
export function preferMarked(agent: Agent, others: Agent[]): Agent | undefined {
  const marked = others.filter((other) => (other.rallyMarkTicksRemaining ?? 0) > 0);
  return nearest(agent, marked.length > 0 ? marked : others);
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
      !other.isEgg &&
      other.species === species &&
      other.herdId === herdId &&
      other.layer === layer &&
      manhattan(other.pos, pos) <= radius
  ).length;
}

/** Would hunting this candidate mean walking into a mob? Used by predators to avoid unwinnable fights. */
function isProtectedByMob(world: World, candidate: Agent): boolean {
  const allies = countHerdAllies(world, candidate.id, candidate.species, candidate.herdId, candidate.layer, candidate.pos, MOB_MUSTER_RADIUS);
  return allies + 1 >= mobThreshold(world, candidate);
}

function isCriticallyHurt(agent: Agent): boolean {
  if (agent.hp === undefined || agent.maxHp === undefined || agent.maxHp === 0) return false;
  return agent.hp / agent.maxHp <= retreatHpFraction(agent);
}

// --- Eggs: extreme defense and opportunistic eating (points 5 and 6 — see
// eggs.ts's top-of-file doc comment for the egg entity itself, and
// DESIGN.md's "Bonding, shelter, and eggs" section for the full design).
// Both live here, not in eggs.ts, so they can reuse this file's existing
// private combat primitives (`canAttackFromHere`/`resolveHit`/`nearest`)
// exactly like the guardian-intervention branch above already does, rather
// than exporting those primitives just to duplicate this logic elsewhere. ---

/** How far (Manhattan) an agent will travel to defend an egg it's territorial about. */
const EGG_DEFENSE_RADIUS = 8;
/** How close a non-egg-group-compatible agent has to get to an egg before it counts as an active threat worth fighting over (as opposed to merely somewhere in the area). */
const EGG_THREAT_RADIUS = 4;
/**
 * Hunger floor for *opportunistically* eating an egg — direct wording is
 * "super desired... given the chance," not "only when literally starving."
 * Set well above `chooseBehavior`'s 0.7 urgency cutoff (same relationship
 * `SHELTER_COMFORT_THRESHOLD` has to it) so a genuinely comfortable agent
 * still takes a free, easy, high-value meal sitting right next to it, not
 * only a desperate one — matching "super desired," a real, standing
 * preference, not a last resort.
 */
const EGG_EAT_HUNGER_THRESHOLD = 0.9;

/**
 * Every living, unhatched egg this agent is territorial about — its own
 * herd's eggs (any species sharing `herdId`, matching how a guardian
 * defends herd-mates it isn't related to either), or, for a herdless agent,
 * only its own species' eggs — within `EGG_DEFENSE_RADIUS`.
 */
function nearbyOwnEggs(world: World, agent: Agent): Agent[] {
  return world.agents.filter(
    (other) =>
      other.isEgg === true &&
      other.alive !== false &&
      other.layer === agent.layer &&
      (agent.herdId ? other.herdId === agent.herdId : other.species === agent.species) &&
      manhattan(agent.pos, other.pos) <= EGG_DEFENSE_RADIUS
  );
}

/**
 * "Pokemon are extremely territorial about their eggs. Will defend them to
 * death" — direct instruction, and a real, explicit departure from
 * herdConflict.ts's deliberately non-lethal rivalry model: this fights to a
 * true kill (`resolveHit(..., "killed", ...)`), not herdConflict's
 * retreat-before-fainting cap, and it overrides this agent's own flee
 * reflex/self-preservation entirely — checked first in
 * `applyPredationInstincts`, ahead of the critically-hurt flee check, so a
 * defender can and does keep fighting (and can die) even at HP where it
 * would otherwise flee. Also wakes a sleeping defender (unlike this
 * function's sibling self-defense branches, which stay dormant while
 * `agent.asleep` — a threat to the eggs is worth waking up for even though
 * an ordinary threat to the sleeper itself isn't).
 *
 * A "threat" here is simply any nearby agent that doesn't share an egg
 * group with the egg's species (`!canBreed`, the same egg-group
 * compatibility `applyEggEating` uses to decide who's willing to eat it) —
 * proximity alone is enough to provoke a defense, since an egg can't be
 * gradually "attacked" the way a real prey animal can; the danger is simply
 * an eater standing close enough to consume it (`applyEggEating`'s own
 * `EGG_THREAT_RADIUS`-scale adjacency check). Same-herd agents are never
 * treated as threats (a guardian of a different species than the egg's own
 * still isn't hostile to it), independent of the egg-group check.
 *
 * **Species-dependent, "not to the death"** (direct follow-up ask:
 * "predators... maybe they don't have the protect to death mentality with
 * it. Species dependent I guess"): an `agent.isPredator` defender still
 * fights for its egg — it isn't undefended — but two real things change
 * relative to the original universal design:
 *
 * 1. **Priority.** See `applyPredationInstincts`'s own call site: a
 *    predator's own critically-hurt flee check is allowed to run FIRST, so a
 *    badly hurt predator genuinely flees instead of unconditionally
 *    committing to a fight over its egg — this is the real "no longer
 *    overrides self-preservation" half of "not to the death," and the
 *    actual mechanism that reduces a predator's own risk of dying in this
 *    situation (this session's whole reason for touching this feature at
 *    all — predator population fragility).
 * 2. **Event labeling.** `resolveHit` is called with `"defeated"` (the same
 *    label `applyPredationInstincts`'s own guardian/herdmate-defense
 *    branches already use) instead of `"killed"`. Documented honestly: in
 *    the CURRENT combat model this is a real distinction for anything
 *    reading the event log (an ordinary combat loss reads differently from
 *    a predation kill), but it is NOT a change in survivability —
 *    `resolveHitAgainstTarget`'s actual death branch sets
 *    `defender.alive = false` unconditionally regardless of `faintKind`;
 *    only `herdConflict.ts`'s separate, HP-floor-clamped `resolveRivalryHit`
 *    can truly guarantee non-lethality, and reusing that resolver here was
 *    judged out of scope for this pass (a real follow-up, see TODO.md) since
 *    the priority change above is what actually moves the predator-survival
 *    needle, not the label.
 *
 * A non-predator defender is completely unaffected by either change — still
 * the original, direct-instruction "will defend them to death," checked
 * first, unconditionally.
 */
function applyEggDefense(world: World, agent: Agent, ctx: LevelingContext | undefined, log: EventLog | undefined, rng: () => number): boolean {
  if (agent.isEgg || agent.fainted || agent.beingCarriedBy) return false;
  const eggs = nearbyOwnEggs(world, agent);
  if (eggs.length === 0) return false;

  const faintKind: "killed" | "defeated" = agent.isPredator ? "defeated" : "killed";

  for (const egg of eggs) {
    const threats = world.agents.filter(
      (other) =>
        other.id !== agent.id &&
        !other.isEgg &&
        other.alive !== false &&
        other.layer === egg.layer &&
        !(other.herdId !== undefined && other.herdId === egg.herdId) &&
        !canBreed(other.species, egg.species, ctx) &&
        manhattan(other.pos, egg.pos) <= EGG_THREAT_RADIUS
    );
    const threat = nearest(egg, threats);
    if (!threat) continue;

    agent.asleep = false;
    agent.sleepTicks = 0;
    logBehaviorChange(log, world, agent, "fight");
    agent.behavior = "fight";
    agent.fightTarget = threat.id;
    const distance = manhattan(agent.pos, threat.pos);
    if (canAttackFromHere(world, agent, threat, distance)) {
      resolveHit(world, agent, threat, log, faintKind, ctx, distance, rng);
    } else {
      // stopAdjacent=true — combat approach never lands on the target's own
      // tile (see stepToward's doc comment).
      agent.pos = stepToward(world, agent.layer, agent.pos, threat.pos, undefined, true);
    }
    log?.record({
      kind: "eggDefended",
      tick: world.tick,
      defenderId: agent.id,
      defenderSpecies: agent.species,
      eggId: egg.id,
      threatId: threat.id,
      threatSpecies: threat.species,
      pos: { ...agent.pos },
    });
    return true;
  }
  return false;
}

/**
 * "Eggs are highly edible. Super desired as food by any Pokémon that does
 * not share egg type... Same species Pokémon will not eat eggs of same
 * type. Eating an egg is the same bonuses as killing and eating prey" —
 * direct instruction. Deliberately NOT routed through the ordinary
 * `HuntRules`/`isPreyOf` predator/prey pipeline (`applyPredationInstincts`'s
 * hunt branch): that system is keyed on predefined predator-prey species
 * pairs, but this is explicitly wider — ANY species that doesn't share an
 * egg group with the egg (`!canBreed`, reusing the exact compatibility
 * check that already gates cross-species breeding eligibility in
 * `reproduction.ts`) is willing to eat it, prey and non-prey species alike.
 * A separate, simpler "opportunistic, instant" check is the better fit for
 * that: an egg can't fight back or flee, so there's no real combat
 * encounter to resolve the way a live hunt has one — eating an egg is a
 * single action once adjacent, not a multi-hit fight.
 *
 * Reuses the real kill-exp/hunger-restore formulas verbatim (`grantKillExp`,
 * `agent.needs.hunger = 1`) rather than inventing new numbers, per direct
 * instruction ("same bonuses as killing and eating prey").
 */
/**
 * `needs.ts`'s `tickAgentAction` calls this right after
 * `applyPredationInstincts` (same tier as `applyScavenging`, another
 * fallback feeding source checked once ordinary hunting/fleeing/fighting
 * found nothing to do this tick), ahead of ordinary foraging: a real, highly
 * desired opportunistic meal, per direct instruction ("super desired").
 */
export function applyEggEating(world: World, agent: Agent, ctx: LevelingContext | undefined, log: EventLog | undefined, rng: () => number = Math.random): boolean {
  if (agent.isEgg || agent.fainted || agent.beingCarriedBy) return false;
  if (agent.needs.hunger >= EGG_EAT_HUNGER_THRESHOLD) return false;

  const candidates = world.agents.filter(
    (other) =>
      other.isEgg === true &&
      other.alive !== false &&
      other.layer === agent.layer &&
      !canBreed(agent.species, other.species, ctx) &&
      manhattan(agent.pos, other.pos) <= 1
  );
  const egg = nearest(agent, candidates);
  if (!egg) return false;

  grantKillExp(world, agent, egg, ctx, log, rng);
  agent.needs.hunger = 1;
  agent.digestingTicksRemaining = KILL_SATIATION_TICKS;
  egg.alive = false;
  egg.diedAtTick = world.tick;
  world.eggsEaten = (world.eggsEaten ?? 0) + 1;
  log?.record({
    kind: "eggEaten",
    tick: world.tick,
    eaterId: agent.id,
    eaterSpecies: agent.species,
    eggId: egg.id,
    eggSpecies: egg.species,
    layer: egg.layer,
    pos: { ...egg.pos },
  });
  logBehaviorChange(log, world, agent, "seekFood");
  agent.behavior = "seekFood";
  return true;
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
  if ((agent.burrowedTicksRemaining ?? 0) > 0) return true;
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
  if (isCritical && move.critCooldownReset && attacker.moveCooldowns) {
    attacker.moveCooldowns[move.id] = 0;
  }
  const situational = situationalMultiplier(world, attacker, defender, move);

  // Consumes the attacker's own tile (e.g. an actual boulder) for a damage
  // multiplier — checked before the damage formula runs, since it changes
  // the damage itself rather than reacting to a landed hit. Reverting the
  // tile to floor here (not gated on the hit landing/killing) means a
  // multi-hit flurry only ever gets this once: the second hit's own check
  // just sees plain floor already.
  let consumedTerrainMultiplier = 1;
  if (move.consumesOwnTerrain) {
    const ownTile = tileAt(world, attacker.layer, attacker.pos.x, attacker.pos.y);
    if (ownTile?.terrain === move.consumesOwnTerrain.terrain) {
      consumedTerrainMultiplier = move.consumesOwnTerrain.damageMultiplier;
      setTile(world, attacker.layer, attacker.pos.x, attacker.pos.y, "floor");
    }
  }

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
          {
            types: defender.types ?? [],
            stats: defender.stats,
            statStages: { defense: getStatStage(defender, "defense") + defenseBoostOf(defender), spDefense: getStatStage(defender, "spDefense") },
          },
          effectiveMove,
          0.85 + rng() * 0.15,
          isCritical
        ).damage
      : FALLBACK_DAMAGE;

  const damage = Math.max(0, Math.floor(rawDamage * situational * consumedTerrainMultiplier * (1 - damageReductionOf(defender))));

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
    // Notables: The Hero's real stat — every true kill counts, both the
    // ordinary hunt path ("killed") and the guardian mob-defense finishing
    // blow ("defeated") — see Agent.lifetimeKills's doc comment.
    attacker.lifetimeKills = (attacker.lifetimeKills ?? 0) + 1;
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
  rng: () => number = Math.random,
  accuracyBonusMultiplier = 1
): boolean {
  if (defender.alive === false) return false; // already a corpse — nothing left to finish off here (looting/scavenging is a separate path, see support.ts)

  defender.maxHp = defender.maxHp ?? defender.stats?.maxHp ?? FALLBACK_MAX_HP;
  defender.hp = defender.hp ?? defender.maxHp;
  const wasFaintedBefore = defender.fainted === true;

  if (!rollAccuracy(move, 0, 0, rng, stormAccuracyMultiplier(world, attacker.layer, attacker.pos) * accuracyBonusMultiplier)) {
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
      maybeSpreadStatus(defender, attacker.id, defender.status.kind, world, log, rng, move.statusSeverity);
    }
    if (move.statChangeOnHit?.target === "defender") {
      applyStatStage(defender, move.statChangeOnHit.stat, move.statChangeOnHit.stage, move.statChangeOnHit.ticks);
    }
    if (move.forcedMovement?.timing === "onHit") applyForcedMovement(world, move.forcedMovement, attacker, defender);
    if (move.positionSwap) {
      const attackerPos = { ...attacker.pos };
      attacker.pos = { ...defender.pos };
      defender.pos = attackerPos;
      if (move.positionSwapPull) {
        applyForcedMovement(world, { mover: "defender", direction: "away", tiles: move.positionSwapPull, timing: "onHit" }, attacker, defender);
      }
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
    if (move.terrainFill) {
      const tile = tileAt(world, defender.layer, defender.pos.x, defender.pos.y);
      if (tile && TERRAIN_FILLABLE.has(tile.terrain)) setTile(world, defender.layer, defender.pos.x, defender.pos.y, move.terrainFill.terrain);
    }
    if (move.rallyCall) {
      defender.rallyMarkTicksRemaining = move.rallyCall.ticks;
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
  rng: () => number = Math.random,
  accuracyBonusMultiplier = 1
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
    // The pack-hunting accuracy bonus only ever applies to the deliberately-picked
    // primary target — an AoE move's incidental side-targets aren't who the pack
    // coordinated on.
    const died = resolveHitAgainstTarget(world, attacker, target, move, log, faintKind, ctx, isPrimary, rng, isPrimary ? accuracyBonusMultiplier : 1);
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
  rng: () => number = Math.random,
  /**
   * Real accuracy multiplier from a coordinated pack hunt (predation.ts's
   * own `packAccuracyMultiplier`, computed by `applyPredationInstincts`
   * before this is called) — 1 (no change) for every solo hit, which is
   * every pre-existing caller of `resolveHit` (mob-fighting's defensive
   * fights, the guardian branch), so none of them need updating.
   */
  accuracyBonusMultiplier = 1
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

  // `allyEffectOnAttack`: the ally-effect piggybacks on a hostile attack,
  // additively — same "the moment the move is used" timing as the self-side
  // stat change above, independent of whether this attack itself lands. A
  // no-op if no eligible herd-mate is in range this tick.
  if (move.allyEffectOnAttack && move.allyEffect) {
    const ally = nearestAllyEffectTarget(world, attacker, move);
    if (ally) applyAllyEffect(world, attacker, ally, move.allyEffect, log);
  }

  if (move.hitsArea) return resolveAreaHit(world, attacker, defender, move, log, faintKind, ctx, rng, accuracyBonusMultiplier);
  return resolveHitAgainstTarget(world, attacker, defender, move, log, faintKind, ctx, true, rng, accuracyBonusMultiplier);
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
  // Egg defense (point 6 — direct instruction: "Pokemon are extremely
  // territorial about their eggs. Will defend them to death"). Checked
  // FIRST, ahead of even the critically-hurt flee check right below — the
  // single highest priority in this whole function, deliberately overriding
  // self-preservation, unlike every other branch here. A real, explicit
  // departure from herdConflict.ts's non-lethal rivalry model: this can and
  // does result in a real death (either side's — `resolveHit` below is
  // called with `"killed"`, the same true-death path a real hunt uses, not
  // herdConflict's retreat-before-fainting cap), and it wakes a sleeping
  // defender (unlike this function's other self-defense branches, which
  // stay silent while `agent.asleep`) — see `applyEggDefense`'s own doc
  // comment.
  //
  // **`agent.isPredator` is a real, deliberate exception to this
  // priority**, not just to the fight's lethality (`applyEggDefense`'s own
  // outcome already downgrades to `"defeated"` for a predator): a predator
  // doesn't have the "no matter what, even to the death" mentality at all,
  // so its own critically-hurt self-preservation check gets to run FIRST —
  // a badly hurt predator can and does flee instead of committing to a
  // fight over its egg, falling through to whatever ordinary flee/fight
  // logic would apply as if this feature didn't single it out. A
  // non-predator's priority is completely unchanged.
  if (!agent.isPredator && applyEggDefense(world, agent, ctx, log, rng)) return true;

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

  // A predator that's NOT critically hurt (or has no live attacker to flee
  // from right now) still defends its egg — just non-lethally, and only
  // after its own survival check above has had first refusal.
  if (agent.isPredator && applyEggDefense(world, agent, ctx, log, rng)) return true;

  if (!isPreyOfAnything(rules, world, agent)) {
    const herdmate = findHerdmateInDanger(world, agent);
    if (herdmate) {
      // Deliberately includes a fainted predator: a guardian keeps pressing the
      // fight to finish it off, same reasoning as the general threats filter below.
      const herdmateThreats = agentsWithin(world, herdmate, FLEE_DETECT_RADIUS).filter((other) =>
        isHunterSpecies(rules, other.species, herdmate.species)
      );
      const threat = preferMarked(herdmate, herdmateThreats);
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
          // Rapport: joint mob-defense — `agent` just actually landed a hit
          // defending `herdmate`, a real, risk-bearing act. Different
          // guardians defending the same herdmate over multiple ticks/events
          // is what makes this genuinely "joint" over a run. See
          // rapport.ts's doc comment.
          strengthenRapportMutual(world, agent, herdmate, RAPPORT_MOB_DEFENSE_DELTA, rng);
        } else {
          // stopAdjacent=true — see stepToward's doc comment.
          agent.pos = stepToward(world, agent.layer, agent.pos, threat.pos, undefined, true);
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
    : agentsWithin(world, agent, effectiveFleeRadius(world, agent)).filter(
        (other) =>
          isHunterSpecies(rules, other.species, agent.species) &&
          isDetectable(world, agent.pos, other, effectiveFleeRadius(world, agent))
      );
  const threat = preferMarked(agent, threats);
  if (threat) {
    const distance = manhattan(agent.pos, threat.pos);
    // Allies must ALSO be within striking distance of the threat right now — not just
    // somewhere in the herd's general area — or a lone agent will "mob" alone and die
    // waiting for backup that's still several tiles away.
    const mobSize = countHerdAllies(world, agent.id, agent.species, agent.herdId, agent.layer, threat.pos, MOB_TRIGGER_RADIUS) + 1;

    if (distance <= MOB_TRIGGER_RADIUS && mobSize >= mobThreshold(world, agent)) {
      logBehaviorChange(log, world, agent, "fight");
      agent.behavior = "fight";
      agent.fightTarget = threat.id;
      if (canAttackFromHere(world, agent, threat, distance)) {
        resolveHit(world, agent, threat, log, "defeated", ctx, distance, rng);
      } else {
        // stopAdjacent=true — see stepToward's doc comment.
        agent.pos = stepToward(world, agent.layer, agent.pos, threat.pos, undefined, true);
      }
      return true;
    }

    logBehaviorChange(log, world, agent, "flee");
    agent.behavior = "flee";
    agent.huntTarget = undefined;
    agent.fightTarget = undefined;

    // A real escape hatch: burrow instead of the normal flee step, if this
    // agent knows an off-cooldown `burrow` move. Real protection from
    // anything not also underground comes free from the engine's own
    // strict same-layer targeting (see `Agent.burrowedTicksRemaining`'s own
    // doc comment) — this just needs to actually relocate the agent and
    // start the clock. `useMove` puts it on cooldown same as any other use,
    // so the balance lever is a longer `cooldownTicks` than a plain
    // step-away flee costs nothing to spam, not a cap on `ticks` itself.
    const burrowMove = (agent.moves ?? []).find((move) => move.burrow && !agent.moveCooldowns?.[move.id]);
    if (burrowMove) {
      useMove(agent, burrowMove);
      agent.burrowedFromLayer = agent.layer;
      agent.layer = "underground";
      agent.burrowedTicksRemaining = burrowMove.burrow!.ticks;
    } else {
      agent.pos = stepAway(world, agent.layer, agent.pos, threat.pos);
    }
    return true;
  }

  // Also skipped while asleep — a sleeping predator doesn't hunt on its own
  // initiative either, same reasoning as the flee/mob block above.
  if (!agent.asleep && rules[agent.species] && agent.needs.hunger < huntHungerThreshold(world, agent, world.tick)) {
    // Ontogenetic niche shift: a juvenile predator never initiates an
    // independent hunt at all (solo OR pack) — real biology, per the direct
    // ask ("young predators are often more cautious/less effective hunters,
    // sometimes relying on scavenging or parental provisioning... before
    // graduating into full adult behavior"). `candidates` stays empty, so a
    // hungry juvenile falls straight through to the same
    // ticksSinceMeal/relocate bookkeeping a solo adult that simply couldn't
    // find prey would — it just never had a real hunt attempt to begin with.
    // It still gets a real fallback meal: needs.ts calls `applyScavenging`
    // (support.ts) right after this function returns false, and juveniles
    // get a much more lenient hunger gate there specifically because this is
    // now their PRIMARY feeding strategy, not an occasional opportunistic
    // one — see that function's doc comment. A hungry juvenile can also still
    // be fed directly by a herd-mate via the pre-existing `applyHerdSupport`
    // food-delivery mechanic, unaffected by any of this.
    const juvenile = isJuvenile(agent);
    const soloCandidates = juvenile
      ? []
      : agentsWithin(world, agent, HUNT_DETECT_RADIUS).filter(
          (other) =>
            isPreyOf(rules, agent, other) &&
            !isProtectedByMob(world, other) &&
            isDetectable(world, agent.pos, other, HUNT_DETECT_RADIUS)
        );
    let target = preferMarked(agent, soloCandidates);

    // Pack hunting: only attempted once a solo target couldn't be found —
    // this is what makes it a real lever against target that a solo predator
    // would otherwise never even attempt (too strong to be worth the risk
    // alone), not a strictly-better replacement for solo hunting. Real,
    // positioning-driven trigger (same shape as the existing defensive
    // mob-fighting above, flipped to offense): a real, nearby, same-species
    // conspecific has to actually be there before a pack hunt is even
    // attempted — no invented dice roll gates whether the pack "forms."
    if (!juvenile && !target) {
      const packCandidates = agentsWithin(world, agent, HUNT_DETECT_RADIUS).filter(
        (other) =>
          isPackPreyOf(rules, agent, other) &&
          !isProtectedByMob(world, other) &&
          isDetectable(world, agent.pos, other, HUNT_DETECT_RADIUS)
      );
      const packTarget = preferMarked(agent, packCandidates);
      if (packTarget && nearbySameSpeciesConspecifics(world, agent, packTarget.pos, PACK_MUSTER_RADIUS).length >= MIN_PACK_ALLIES) {
        target = packTarget;
      }
    }

    if (target) {
      logBehaviorChange(log, world, agent, "hunt");
      agent.behavior = "hunt";
      agent.huntTarget = target.id;

      const huntDistance = manhattan(agent.pos, target.pos);
      // Real, positioning-driven pack bonus: how many OTHER same-species
      // conspecifics are already actually committed to this exact target
      // (not just "somewhere nearby") — see `committedPackmates`'s own doc
      // comment. Computed for every hunt attempt, solo-eligible targets
      // included: if packmates happen to already be piling onto a target a
      // lone predator would also have gone for anyway, that's still real
      // coordination worth the same accuracy bonus.
      const packmates = committedPackmates(world, agent, target.id, target.pos);
      const accuracyBonus = packAccuracyMultiplier(packmates);
      if (packmates > 0) {
        log?.record({
          kind: "packHunt",
          tick: world.tick,
          attackerId: agent.id,
          attackerSpecies: agent.species,
          targetId: target.id,
          targetSpecies: target.species,
          packmates,
          pos: agent.pos,
        });
      }
      if (canAttackFromHere(world, agent, target, huntDistance)) {
        // A single hit may not be lethal now — real HP, real damage, and even
        // a lethal hit only FAINTS the target (see resolveHit/DESIGN.md). The
        // meal (and hunger restore) only happens once the target is truly
        // dead — resolveHit returns true only at that moment, never on a mere
        // faint — so hunting a fainted target across several ticks to finish
        // it off, then eating, is the normal two-stage path here.
        const died = resolveHit(world, agent, target, log, "killed", ctx, huntDistance, rng, accuracyBonus);
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
        // A currently-visible, currently-being-chased prey target moves
        // every tick, unlike seekWater/seekFood's static resource tile — see
        // `stepTowardMovingTarget`'s own doc comment (pathfinding.ts) for
        // why that needs its own staleness/recompute handling rather than
        // `stepAlongPath`'s exact-position cache match.
        agent.pos = stepTowardMovingTarget(world, agent, target);
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
