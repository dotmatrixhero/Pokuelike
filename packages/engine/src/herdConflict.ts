import type { Agent, HuntRules, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { calculateDamage, pickBestMove, rollAccuracy, rollCritical, useMove } from "./combat.js";
import { stepAway } from "./movement.js";
import { stormAccuracyMultiplier } from "./weather.js";
import { FALLBACK_MAX_HP, manhattan } from "./predation.js";

/**
 * Herd-vs-herd resource conflict — the direct ask ("I think escalated
 * rivalry, even between species or same species, having them fight over
 * resources would be cool"). See DESIGN.md's "Herd conflict: fighting over
 * resources" section for the full design writeup and real-run findings.
 *
 * **Trigger: real resource contention, not territorial crowding.** Two herds
 * (same or different species) that both want the same scarce water/food tile
 * is already a real, frequent, instrumented event since occupancy.ts's tile
 * capacity landed — needs.ts's existing `ticksBlockedFromResource` counter
 * (a seekWater/seekFood agent stuck waiting because `canEnterTile` says the
 * target is full) is the natural hook, not a new detection system. This is
 * deliberately NOT built as an extension of herdMigration.ts's existing
 * territorial-rivalry trigger (same-species herd crowding) — that trigger is
 * herd-centroid-level and fires only for same-species pairs; resource
 * contention is individual-level (whoever's actually standing at the
 * crowded tile), fires for cross-species pairs too (the user's explicit
 * ask), and is a strictly more concrete "the two of them both physically
 * want THIS tile right now" condition than "two centroids happen to be
 * close." Extending the territorial trigger to escalate into combat instead
 * of always relocating is flagged as a real follow-up in TODO.md, not built
 * here — this module covers the resource-contention half of the design
 * brief.
 *
 * **Scope: no predators, either side.** The single biggest constraint on
 * this whole feature (see TODO.md) is that predator populations in this sim
 * are already fragile and crash toward extinction easily — any new source of
 * death risk needs real validation that it doesn't make that worse. Rather
 * than trying to carefully tune a mechanism that's safe for predators too,
 * this is scoped out entirely: both the acting agent and the rival occupant
 * must be non-predator species (`!isHunterSpecies`) or this trigger never
 * even considers firing. A predator herd squabbling with another predator
 * herd, or a predator muscling a herbivore off a water hole, are both real
 * follow-up ideas (see TODO.md) but neither is built here.
 *
 * **Lethality model: cannot faint or kill, full stop.** Real animal
 * conflicts over a resource are almost always about establishing who backs
 * off, not a fight to the death — and given the predator-fragility
 * constraint above, "more fighting" absolutely cannot mean "a new,
 * unbounded death channel." Rather than reusing predation.ts's faint/
 * finishing-pool machinery (which CAN kill) and trying to tune around it,
 * `resolveRivalryHit` below clamps the defender's hp at
 * `HERD_CONFLICT_HP_FLOOR_FRACTION * maxHp` — real damage from the same
 * `calculateDamage` formula predator/prey combat uses, but this mechanic
 * itself can never bring an agent to 0 hp, never faints it, and never kills
 * it, regardless of how many times it fires. The defender retreats (steps
 * away, gets a cooldown) once its hp crosses `HERD_CONFLICT_RETREAT_HP_FRACTION`
 * — a real, felt cost (an agent can walk away from a rivalry fight
 * meaningfully hurt and take longer to heal) without ever being a death
 * mechanism.
 *
 * **Gating: disposition-weighted roll + real relative strength, not a flat
 * chance.** `herdConflictChance` follows the exact same shape as
 * herdMigration.ts's `wanderlustChance` (a real, established convention in
 * this codebase for "a per-tick chance scaled by disposition, not a plain
 * dice roll") — a bold/aggressive agent is meaningfully more likely to pick
 * a fight than a timid one, which is what lets low-aggression herds keep
 * doing what they already do (wait out the grace period, then relocate to a
 * different resource tile) instead of escalating. `HERD_CONFLICT_MIN_POWER_RATIO`
 * additionally refuses to let a badly outmatched agent start a fight it has
 * no real chance of winning — comparably-matched, confident herds fight;
 * mismatched ones still just avoid/relocate.
 */

/** How many consecutive ticks an agent must already have been blocked from a resource tile before it's even eligible to consider fighting over it — a fresh block tries waiting first, same as before this feature; only a genuinely sustained standoff considers escalating. */
export const HERD_CONFLICT_MIN_BLOCKED_TICKS = 8;

/** How close the rival occupant has to be to the contested tile to be a valid target — melee-range only, matching "whoever's actually adjacent/contesting the tile," not a ranged skirmish. */
const RIVAL_DETECT_RADIUS = 1;

/**
 * Base unscaled per-tick roll once every other gate (blocked long enough,
 * rival present, non-predator both sides, comparable power, off cooldown)
 * already holds — see herdMigration.ts's `WANDERLUST_BASE_CHANCE` for the
 * same "floor value, disposition pushes it up" shape. Deliberately small: a
 * standoff that lasts many ticks gets many rolls, so this doesn't need to be
 * high per-tick to still produce real fights in a multi-thousand-tick run.
 */
const HERD_CONFLICT_BASE_CHANCE = 0.03;
/** How much combined boldness+aggression (0..1) scales the base chance — at courage 1.0 the per-tick chance is base + this. */
const HERD_CONFLICT_DISPOSITION_SCALE = 0.4;

/** A rival occupant this much weaker (or more) than the acting agent isn't worth fighting for it to be "comparably matched, confident" rather than a hopeless mismatch — see this module's doc comment. Symmetric: also refuses if the agent itself is this much weaker than the rival. */
export const HERD_CONFLICT_MIN_POWER_RATIO = 0.6;

/** Once the defender's hp falls to/below this fraction of its max, it backs off rather than the fight continuing — "loser retreats once meaningfully hurt," not fight-to-faint. */
export const HERD_CONFLICT_RETREAT_HP_FRACTION = 0.6;
/** Hard floor: this mechanic can never push a defender's hp below this fraction of its max — the population-safety guarantee. See this module's doc comment. */
export const HERD_CONFLICT_HP_FLOOR_FRACTION = 0.15;

/** Ticks a defender that just retreated (or an attacker that just fought) won't re-engage in a rivalry fight — prevents the same pair grinding on each other every eligible tick once one side is already backing off. */
export const HERD_CONFLICT_COOLDOWN_TICKS = 80;

const FALLBACK_DAMAGE = 1;

function powerOf(agent: Agent): number {
  return agent.maxHp ?? agent.stats?.maxHp ?? FALLBACK_MAX_HP;
}

/** Combined boldness+aggression (0..1) — "courage" in the same sense predation.ts's `mobThreshold` uses it. Absent disposition reads neutral (0.5), same convention as every other disposition consumer in this codebase. */
function courageOf(agent: Agent): number {
  const boldness = agent.disposition?.boldness ?? 0.5;
  const aggression = agent.disposition?.aggression ?? 0.5;
  return (boldness + aggression) / 2;
}

function herdConflictChance(agent: Agent): number {
  return HERD_CONFLICT_BASE_CHANCE + courageOf(agent) * HERD_CONFLICT_DISPOSITION_SCALE;
}

/**
 * A living, conscious, non-predator agent from a different herd standing
 * at/adjacent to `target` — the "who's actually contesting this tile"
 * candidate. `undefined` if nothing eligible is there (the tile might just
 * be crowded with the agent's own herd-mates, or with a predator, neither of
 * which this trigger touches).
 */
function findRivalOccupant(world: World, agent: Agent, rules: HuntRules, target: Vec2): Agent | undefined {
  let best: Agent | undefined;
  let bestDist = Infinity;
  for (const other of world.agents) {
    if (other.id === agent.id || other.alive === false || other.fainted) continue;
    if (other.layer !== agent.layer) continue;
    if (other.herdId !== undefined && other.herdId === agent.herdId) continue; // same herd — never a rival
    if (rules[agent.species] || rules[other.species]) continue; // predator on either side — out of scope, see doc comment
    const dist = manhattan(other.pos, target);
    if (dist > RIVAL_DETECT_RADIUS) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = other;
    }
  }
  return best;
}

/**
 * A single rivalry hit, reusing the same accuracy/crit/damage pipeline
 * predator/prey combat uses (`rollAccuracy`/`rollCritical`/`calculateDamage`
 * — combat.ts) but with its own non-lethal resolution (see this module's doc
 * comment) rather than predation.ts's faint/finishing-pool machinery, which
 * this mechanic deliberately never touches.
 */
function resolveRivalryHit(world: World, attacker: Agent, defender: Agent, log: EventLog | undefined, rng: () => number): void {
  defender.maxHp = defender.maxHp ?? defender.stats?.maxHp ?? FALLBACK_MAX_HP;
  defender.hp = defender.hp ?? defender.maxHp;

  const distance = manhattan(attacker.pos, defender.pos);
  const move = pickBestMove(attacker, defender.types ?? [], distance);
  if (!move) return; // nothing off-cooldown/in-range — no-op this tick, tried again on a later eligible tick

  useMove(attacker, move);

  if (!rollAccuracy(move, 0, 0, rng, stormAccuracyMultiplier(world, attacker.layer, attacker.pos))) {
    log?.record({
      kind: "herdClash",
      tick: world.tick,
      attackerId: attacker.id,
      attackerSpecies: attacker.species,
      attackerHerdId: attacker.herdId,
      defenderId: defender.id,
      defenderSpecies: defender.species,
      defenderHerdId: defender.herdId,
      pos: defender.pos,
      outcome: "missed",
    });
    return;
  }

  const isCritical = rollCritical(move.critRateStage ?? 0, rng);
  const rawDamage =
    attacker.level !== undefined && attacker.types && attacker.stats && defender.stats
      ? calculateDamage(
          { level: attacker.level, types: attacker.types, stats: attacker.stats },
          { types: defender.types ?? [], stats: defender.stats },
          move,
          0.85 + rng() * 0.15,
          isCritical
        ).damage
      : FALLBACK_DAMAGE;

  const floor = Math.max(1, Math.floor(HERD_CONFLICT_HP_FLOOR_FRACTION * defender.maxHp));
  const hpBefore = defender.hp;
  defender.hp = Math.max(floor, hpBefore - rawDamage);
  const damageDealt = hpBefore - defender.hp;

  const retreated = defender.hp / defender.maxHp <= HERD_CONFLICT_RETREAT_HP_FRACTION;

  log?.record({
    kind: "herdClash",
    tick: world.tick,
    attackerId: attacker.id,
    attackerSpecies: attacker.species,
    attackerHerdId: attacker.herdId,
    defenderId: defender.id,
    defenderSpecies: defender.species,
    defenderHerdId: defender.herdId,
    damage: damageDealt,
    defenderHpRemaining: defender.hp,
    critical: isCritical,
    pos: defender.pos,
    outcome: retreated ? "retreated" : "hit",
  });

  if (retreated) {
    defender.pos = stepAway(world, defender.layer, defender.pos, attacker.pos, defender);
    defender.herdConflictCooldownTicks = HERD_CONFLICT_COOLDOWN_TICKS;
    attacker.herdConflictCooldownTicks = HERD_CONFLICT_COOLDOWN_TICKS;
  }
}

/**
 * Called from needs.ts's seekWater/seekFood blocked-tile branch, once
 * `agent` has already been waiting on a crowded `target` tile for
 * `HERD_CONFLICT_MIN_BLOCKED_TICKS`. Returns true if a rivalry fight
 * actually happened this tick (caller should treat the tick as spent, same
 * as the ordinary wait/path branches it's an alternative to) — false means
 * every gate held except the final disposition roll, or no eligible rival
 * was even there, so the caller falls through to its existing wait/relocate
 * logic unchanged.
 */
export function applyHerdRivalryConflict(world: World, agent: Agent, rules: HuntRules, target: Vec2, log: EventLog | undefined, rng: () => number): boolean {
  if ((agent.herdConflictCooldownTicks ?? 0) > 0) return false;
  if (rules[agent.species]) return false; // predator — out of scope, see doc comment

  const rival = findRivalOccupant(world, agent, rules, target);
  if (!rival) return false;

  const ratio = powerOf(agent) / powerOf(rival);
  if (ratio < HERD_CONFLICT_MIN_POWER_RATIO || ratio > 1 / HERD_CONFLICT_MIN_POWER_RATIO) return false;

  if (rng() >= herdConflictChance(agent)) return false;

  resolveRivalryHit(world, agent, rival, log, rng);
  return true;
}
