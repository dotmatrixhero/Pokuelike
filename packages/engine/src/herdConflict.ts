import type { Agent, HuntRules, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { calculateDamage, pickBestMove, rollAccuracy, rollCritical, useMove } from "./combat.js";
import { stepAway, stepToward } from "./movement.js";
import { stormAccuracyMultiplier } from "./weather.js";
import { FALLBACK_MAX_HP, manhattan } from "./predation.js";
import { RAPPORT_HERD_CLASH_DELTA, rapportScore, strengthenRapportMutual } from "./rapport.js";
import { effectiveDisposition } from "./herdLeadership.js";
import { SCARCITY_SCORE_THRESHOLD } from "./herdMigration.js";
import { foodStockNear, countTerrainNear } from "./resourceIndex.js";
import { canBreed, type LevelingContext } from "./leveling.js";

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
 * Rival-selection half of the grudge bias (see `HERD_CONFLICT_GRUDGE_SCALE`
 * for the escalation-chance half): when more than one eligible rival is
 * actually contesting the tile at once, `findRivalOccupant` prefers a
 * specific individual `agent` already has a real grudge against over a
 * merely-nearer stranger, same "distance minus a scaled discount" scoring
 * composition `reproduction.ts`'s `mateScore` already established for this
 * codebase (reused here rather than a parallel mechanism) — a full -1.0
 * grudge is worth this many tiles of "closer," which at
 * `RIVAL_DETECT_RADIUS` = 1 is enough to flip a genuine tie but never to
 * reach past a rival that's meaningfully farther inside the detect radius.
 */
const RAPPORT_TARGET_BIAS_TILES = 1;

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

/**
 * Rapport consumer #2 (see reproduction.ts's `RAPPORT_DISTANCE_BONUS` for
 * consumer #1): how much an existing grudge (a strongly negative rapport
 * edge toward the specific rival occupying the contested tile, from a past
 * `herdClash` between exactly these two) scales the per-tick escalation
 * chance on top of disposition — at a full -1.0 rapport, the per-tick chance
 * gets `HERD_CONFLICT_GRUDGE_SCALE` added, same order of magnitude as
 * `HERD_CONFLICT_DISPOSITION_SCALE` so a real grudge is a comparably strong
 * driver of re-escalation as raw boldness/aggression, not a token nudge —
 * this is the direct mechanism for "re-escalating against a specific
 * individual with an existing grudge, not treating every contest as if the
 * two parties were strangers."
 */
const HERD_CONFLICT_GRUDGE_SCALE = 0.4;

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

/**
 * Combined boldness+aggression (0..1) — "courage" in the same sense
 * predation.ts's `mobThreshold` uses it. Reads `effectiveDisposition`
 * (herdLeadership.ts), so a herd's current leader's own courage nudges its
 * herd-mates' rivalry-escalation chance toward its own — see DESIGN.md's
 * "Herd Leadership" section.
 */
function courageOf(world: World, agent: Agent): number {
  const disposition = effectiveDisposition(world, agent);
  return (disposition.boldness + disposition.aggression) / 2;
}

/**
 * `grudge` is the agent's own rapport score toward the specific rival being
 * considered (-1..1, positive values contribute nothing — only an existing
 * grudge biases escalation, a positive relationship never suppresses it
 * below the plain disposition-driven baseline, matching the "biased toward,
 * doesn't invent a new suppression path" scope of this consumer). `baseChance`/
 * `dispositionScale` default to this module's own resource-contention tuning
 * (`HERD_CONFLICT_BASE_CHANCE`/`HERD_CONFLICT_DISPOSITION_SCALE`) — the
 * proactive territorial-guard trigger below passes its own, slightly
 * different tuning instead of reusing these defaults unchanged.
 */
function herdConflictChance(
  world: World,
  agent: Agent,
  grudge: number,
  baseChance = HERD_CONFLICT_BASE_CHANCE,
  dispositionScale = HERD_CONFLICT_DISPOSITION_SCALE
): number {
  const grudgeBonus = Math.max(0, -grudge) * HERD_CONFLICT_GRUDGE_SCALE;
  return baseChance + courageOf(world, agent) * dispositionScale + grudgeBonus;
}

/**
 * A living, conscious, non-predator agent from a different herd standing
 * at/adjacent to `target` — the "who's actually contesting this tile"
 * candidate. `undefined` if nothing eligible is there (the tile might just
 * be crowded with the agent's own herd-mates, or with a predator, neither of
 * which this trigger touches). `radius` defaults to `RIVAL_DETECT_RADIUS`
 * (melee-range, resource-contention's own scope) — the territorial-guard
 * trigger below passes a much wider radius, since it's scanning a whole
 * claimed area around a herd's centroid, not just who's standing on one
 * specific contested tile.
 */
function findRivalOccupant(world: World, agent: Agent, rules: HuntRules, target: Vec2, radius = RIVAL_DETECT_RADIUS): Agent | undefined {
  let best: Agent | undefined;
  let bestScore = Infinity;
  for (const other of world.agents) {
    if (other.id === agent.id || other.alive === false || other.fainted || other.isEgg) continue;
    if (other.layer !== agent.layer) continue;
    if (other.herdId !== undefined && other.herdId === agent.herdId) continue; // same herd — never a rival
    if (rules[agent.species] || rules[other.species]) continue; // predator on either side — out of scope, see doc comment
    const dist = manhattan(other.pos, target);
    if (dist > radius) continue;
    const grudge = Math.max(0, -rapportScore(agent, other.id, world.tick));
    const score = dist - grudge * RAPPORT_TARGET_BIAS_TILES;
    if (score < bestScore) {
      bestScore = score;
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
  const move = pickBestMove(attacker, defender.types ?? [], distance, world.tick);
  if (!move) return; // nothing off-cooldown/in-range — no-op this tick, tried again on a later eligible tick

  useMove(attacker, move, world.tick);

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
      moveId: move.id,
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

  // Rapport: a real, negative shift between exactly these two individuals —
  // never a species-/herd-level effect — for a hit that actually landed
  // (never for "missed", which never connected). This is the grudge
  // `HERD_CONFLICT_GRUDGE_SCALE`/`RAPPORT_TARGET_BIAS_TILES` above read back
  // on a later contested tile. See rapport.ts's doc comment.
  strengthenRapportMutual(world, attacker, defender, RAPPORT_HERD_CLASH_DELTA, rng);

  log?.record({
    kind: "herdClash",
    tick: world.tick,
    attackerId: attacker.id,
    attackerSpecies: attacker.species,
    attackerHerdId: attacker.herdId,
    defenderId: defender.id,
    defenderSpecies: defender.species,
    defenderHerdId: defender.herdId,
    moveId: move.id,
    damage: damageDealt,
    defenderHpRemaining: defender.hp,
    critical: isCritical,
    pos: defender.pos,
    outcome: retreated ? "retreated" : "hit",
  });

  if (retreated) {
    defender.pos = stepAway(world, defender.layer, defender.pos, attacker.pos, defender, defender);
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

  const grudge = rapportScore(agent, rival.id, world.tick);
  if (rng() >= herdConflictChance(world, agent, grudge)) return false;

  resolveRivalryHit(world, agent, rival, log, rng);
  return true;
}

// ---------------------------------------------------------------------------
// Territorial guarding — direct follow-up ask: "more territorial behavior.
// Around guarding resources," refined to proactive patrol/chase-off (any
// herd with a claimed home area, not just species flagged as guardians)
// rather than the resource-contention trigger above, which only ever fires
// once an agent is already stuck `HERD_CONFLICT_MIN_BLOCKED_TICKS` deep
// waiting on one specific crowded tile. `applyTerritorialGuard` below is
// checked every action tick, for every eligible agent, regardless of
// whether it's currently trying to reach a resource at all — the exact
// "extending the territorial trigger to escalate into combat" follow-up
// this module's own top doc comment already flagged as future work.
//
// Deliberately symmetric rather than "owner vs. intruder": there's no
// separate herd-territory-center concept to check "is this MY land" against
// (this codebase's only per-agent equivalent, `Agent.homePos`, is
// individual-scoped and set once at spawn — not a herd-level claim). Instead
// this checks "is there a different-herd agent, not tolerated, standing near
// me somewhere with real resources" — which reads correctly from EITHER
// side's own tick: a resident whose turf a stranger wandered into chases it
// off; that same stranger, on ITS OWN turn, is equally free to stand its
// ground and fight back for a foothold instead of retreating, if it judges
// it can win. Direct ask: "the unit wandering into a territorial space
// would... be incentivized to try to fight and take over resources... if
// they thought they could win" — `HERD_CONFLICT_MIN_POWER_RATIO` already
// encodes "thought they could win"; the trigger chance below additionally
// factors in the acting agent's own hunger/thirst, so a genuinely needy
// invader is more willing to risk it than one just passing through well-fed.
// ---------------------------------------------------------------------------

/** How far from the acting agent this trigger looks for a different-herd rival — deliberately wider than `RIVAL_DETECT_RADIUS` (melee-range, "who's on this exact tile"), since this is scanning a whole nearby area for an intruder/rival, not one contested tile. */
const TERRITORY_GUARD_RADIUS = 4;

/**
 * Real resource abundance a rival has to actually be standing near before
 * territorial guarding bothers with them at all — same formula
 * herdMigration.ts's own `abundanceAt` composes (`foodStockNear` +
 * `countTerrainNear(..., "water", ...)`), reimplemented locally rather than
 * imported (that helper is private to herdMigration.ts, and its own
 * scarcity-vs-migration framing doesn't need to leak into a resource-
 * guarding decision) — but sharing herdMigration.ts's own real, already-
 * calibrated `SCARCITY_SCORE_THRESHOLD` as the cutoff rather than a second,
 * redundant number.
 */
function territoryAbundanceAt(world: World, layer: Agent["layer"], pos: Vec2, radius: number): number {
  return foodStockNear(world, layer, pos, radius) + countTerrainNear(world, layer, pos, "water", radius);
}

/**
 * 0 (comfortably abundant) .. 1 (barely worth fighting over at all) — the
 * real "how scarce is it right now" read tolerance erodes against, direct
 * ask: "if food or water became scarce that tolerance may lessen." Scaled
 * against `territoryAbundanceAt`'s own real range, not a flat 0-to-max: the
 * caller only ever reaches this once abundance already clears
 * `SCARCITY_SCORE_THRESHOLD` (the "worth guarding at all" floor just above),
 * so pinning `scarcity = 1` there — not at literal zero abundance, which
 * this function would otherwise never actually see — is what lets full
 * scarcity (and its "no more exceptions" consequence, `isToleratedIntruder`)
 * genuinely happen. Bottoms out at `scarcity = 0` once abundance reaches 3x
 * the threshold — "comfortably plentiful," not literally infinite.
 */
function scarcityFactor(abundance: number): number {
  const comfortable = SCARCITY_SCORE_THRESHOLD * 3;
  return 1 - Math.min(1, Math.max(0, (abundance - SCARCITY_SCORE_THRESHOLD) / (comfortable - SCARCITY_SCORE_THRESHOLD)));
}

/** A real, positive relationship (mate, past mutual-defense ally — `rapport.ts`) still earns tolerance, but only up to a bar that itself falls as `scarcity` rises — at full scarcity even a bonded pair from different herds stops being exempt. */
const TOLERATED_RAPPORT_AT_ABUNDANCE = 0.2;

/** How unaggressive a same-egg-group (mainline-real breeding-kin, `leveling.ts`'s `canBreed`) stranger's own current disposition has to read before it's tolerated on species grounds alone — same erosion-with-scarcity treatment as the rapport exemption above. */
const TOLERATED_KIN_AGGRESSION_AT_ABUNDANCE = 0.3;

/**
 * Whether `other` gets a pass from territorial guarding rather than being
 * treated as a fair-game rival — direct ask: "units who have developed
 * relationships (known safe) or bonded or species that are esp not
 * aggressive/same egg type... could be tolerated. But new outsiders would
 * not be." Both exemptions shrink toward nothing as `scarcity` (0..1, see
 * `scarcityFactor`) rises — "that tolerance may lessen" — so a genuinely
 * hard-times territory stops making exceptions even for a bonded kin agent.
 */
function isToleratedIntruder(world: World, agent: Agent, other: Agent, scarcity: number, ctx: LevelingContext | undefined): boolean {
  const tolerance = 1 - scarcity;
  if (rapportScore(agent, other.id, world.tick) >= TOLERATED_RAPPORT_AT_ABUNDANCE * tolerance) return true;
  if (tolerance > 0 && canBreed(agent.species, other.species, ctx) && effectiveDisposition(world, other).aggression < TOLERATED_KIN_AGGRESSION_AT_ABUNDANCE * tolerance) {
    return true;
  }
  return false;
}

/** How much of `courageOf`'s own (0..1-ish) scale the acting agent's own hunger/thirst urgency additionally contributes — a needy agent is a more willing invader than a well-fed one just passing through, same order of magnitude as `HERD_CONFLICT_DISPOSITION_SCALE` so neither dwarfs the other. */
const GUARD_NEED_URGENCY_SCALE = 0.4;
/** `herdConflictChance`'s own resource-contention `HERD_CONFLICT_BASE_CHANCE`/`_DISPOSITION_SCALE`, at a slightly lower base — this trigger runs unconditionally every tick (not gated behind a sustained multi-tick standoff first), so a much higher per-tick rate would escalate far more often overall despite the smaller base. */
const GUARD_BASE_CHANCE = 0.015;
const GUARD_DISPOSITION_SCALE = 0.4;

/** Whichever of hunger/thirst is currently more pressing — the real "hungry/thirsty enough to risk a fight for it" signal the direct ask calls for. */
function needUrgencyOf(agent: Agent): number {
  return Math.max(1 - agent.needs.hunger, 1 - agent.needs.thirst);
}

/**
 * Checked every action tick (needs.ts), for every non-predator, herded
 * agent not already on this mechanic's shared cooldown — see this section's
 * own doc comment for why this is symmetric ("am I near a non-tolerated
 * rival somewhere worth fighting for") rather than an owner/intruder split.
 * Returns true if the tick was spent chasing/attacking (caller should treat
 * it as consumed, same contract as `applyHerdRivalryConflict`).
 */
export function applyTerritorialGuard(world: World, agent: Agent, rules: HuntRules, log: EventLog | undefined, rng: () => number, ctx?: LevelingContext): boolean {
  if ((agent.herdConflictCooldownTicks ?? 0) > 0) return false;
  if (rules[agent.species]) return false; // predator — out of scope, see this module's top doc comment
  if (!agent.herdId) return false; // no herd, nothing to be territorial about

  const rival = findRivalOccupant(world, agent, rules, agent.pos, TERRITORY_GUARD_RADIUS);
  if (!rival) return false;

  const abundance = territoryAbundanceAt(world, agent.layer, rival.pos, TERRITORY_GUARD_RADIUS);
  const scarcity = scarcityFactor(abundance);
  if (abundance < SCARCITY_SCORE_THRESHOLD) return false; // nothing worth fighting over here

  if (isToleratedIntruder(world, agent, rival, scarcity, ctx)) return false;

  const ratio = powerOf(agent) / powerOf(rival);
  if (ratio < HERD_CONFLICT_MIN_POWER_RATIO || ratio > 1 / HERD_CONFLICT_MIN_POWER_RATIO) return false;

  const grudge = rapportScore(agent, rival.id, world.tick);
  const chance = herdConflictChance(world, agent, grudge, GUARD_BASE_CHANCE, GUARD_DISPOSITION_SCALE) + needUrgencyOf(agent) * GUARD_NEED_URGENCY_SCALE;
  if (rng() >= chance) return false;

  agent.behavior = "fight";
  agent.fightTarget = rival.id;
  if (manhattan(agent.pos, rival.pos) <= 1) {
    resolveRivalryHit(world, agent, rival, log, rng);
  } else {
    // stopAdjacent=true — see stepToward's doc comment.
    agent.pos = stepToward(world, agent.layer, agent.pos, rival.pos, agent, undefined, true);
  }
  return true;
}
