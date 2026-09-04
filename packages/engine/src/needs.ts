import type { Agent, BehaviorKind, HuntRules, Layer, Needs, Vec2, World } from "./types.js";
import { otherLayers, tileAt } from "./world.js";
import { stepToward } from "./movement.js";
import { applyPredationInstincts, hasAwakeHerdmateNearby, hasNearbyThreat, manhattan } from "./predation.js";
import { applyMateSeeking } from "./reproduction.js";
import { CONSUME_STOCK_AMOUNT } from "./flora.js";
import { tickCooldowns } from "./combat.js";
import { applyHerdCohesion, herdRank } from "./herding.js";
import { migrate } from "./migration.js";
import { applyDispersal, maybeTriggerDispersal } from "./dispersal.js";
import { applyShelterBuilding, maybeTriggerShelterBuilding } from "./shelter.js";
import { logBehaviorChange, type EventLog } from "./events.js";
import {
  EXP_ON_CONSUME,
  EXP_TRICKLE_PER_TICK,
  MAX_TRACKED_SPECIES,
  grantExp,
  markSectorVisited,
  markSpeciesEncountered,
  sectorId,
  type LevelingContext,
} from "./leveling.js";
import { applyCarrying, applyHealOverTime, applyHerdSupport, applyLooting, applySupportMove, maybeRecoverFromFaint, maybeStartCarrying } from "./support.js";
import { findNearestIndexed } from "./resourceIndex.js";
import { thirstDecayMultiplier } from "./weather.js";
import { PARALYSIS_SKIP_CHANCE, isAsleep, isFrozen, isParalyzed, tickStatusEffects } from "./status.js";

const DECAY_PER_TICK = {
  /**
   * Extended from the original 0.015 — see "Extend thirst's survival
   * margin" in DESIGN.md. At 0.010, thirst empties in ~100 ticks (was ~67),
   * closing most of the gap with hunger's own (much longer, exponential)
   * budget without touching thirst's deliberately-kept-linear curve.
   */
  thirst: 0.01,
  energy: 0.005,
  mateDrive: 0.01,
} as const;

/**
 * Hunger decay is no longer a flat per-tick subtraction — direct feedback
 * that a flat rate reads as too punishing. Real appetite doesn't work that
 * way: you get hungry fairly fast right after a meal, but once genuinely
 * hungry you can go a long while before it's actually dangerous. Modeled as
 * exponential decay of the *remaining* hunger value (a multiplicative term
 * proportional to current hunger, so the absolute drop is largest at full
 * and shrinks as hunger falls) plus a small flat floor so it still reaches
 * true 0 in finite time instead of asymptoting forever — from full (1.0),
 * this reaches the 0.7 "seek food" threshold (`chooseBehavior`'s urgency
 * cutoff) in ~27 ticks, but takes ~213 total to fall the rest of the way to
 * 0 (more than double the old flat rate's 100), where `STARVATION_GRACE_TICKS`
 * (100 more) still has
 * to run out before actual death — sim-original tuning, judge against a
 * real run like everything else here, not a canon formula.
 */
const HUNGER_DECAY_RATE = 0.012;
const HUNGER_DECAY_FLOOR = 0.001;

/** Ticks an agent can sit at 0 hunger before it dies of it. */
const STARVATION_GRACE_TICKS = 100;
/**
 * Thirst's own, longer, grace period — see "Extend thirst's survival
 * margin" in DESIGN.md. Hunger's full curve (exponential decay of the
 * remaining value, see `HUNGER_DECAY_RATE`'s doc comment) takes ~213 ticks
 * to empty, then 100 more before death — ~313 total. Thirst's flat rate now
 * empties in ~100 ticks (`DECAY_PER_TICK.thirst`); giving it the same 100
 * grace period would leave its total survival budget (~200 ticks) at barely
 * two thirds of hunger's, for no principled reason. 150 brings it to ~250,
 * closing most of that gap without touching hunger's own curve or thirst's
 * deliberate linearity. Tracked independently of `STARVATION_GRACE_TICKS`
 * via `Agent.thirstStarvationTicks` (a separate counter from
 * `Agent.starvationTicks`) since hunger and thirst can cross 0 at different
 * ticks — a single shared counter can't correctly judge two different
 * thresholds.
 */
const THIRST_STARVATION_GRACE_TICKS = 150;
/**
 * Age (ticks) at which old-age mortality starts being possible at all. A
 * single global constant for now, same call as `MATURITY_AGE` above — real
 * per-species lifespans (a Pidgey aging out faster than a Venusaur) are a
 * data-layer refinement for later.
 */
const OLD_AGE_ONSET = 1500;
/** Age at which the per-tick death chance saturates at `OLD_AGE_MAX_CHANCE`. */
const OLD_AGE_HAZARD_CAP_AGE = 3000;
/** The per-tick death chance a sufficiently old agent asymptotically approaches. */
const OLD_AGE_MAX_CHANCE = 0.02;

/**
 * A gentle, ramping hazard rather than a hard cutoff age — a species with no
 * predator and no famine (a guardian Venusaur, say) should still eventually
 * die of old age instead of living forever once every other cause of death
 * is dodged, but a sharp "everyone dies at exactly age X" cutoff would read
 * as an obvious game-of-life rule rather than mortality. 0 before
 * `OLD_AGE_ONSET`, then rises linearly to `OLD_AGE_MAX_CHANCE` by
 * `OLD_AGE_HAZARD_CAP_AGE` and stays there for anything older.
 */
export function ageMortalityChance(age: number): number {
  if (age < OLD_AGE_ONSET) return 0;
  const span = OLD_AGE_HAZARD_CAP_AGE - OLD_AGE_ONSET;
  const progress = Math.min(1, (age - OLD_AGE_ONSET) / span);
  return progress * OLD_AGE_MAX_CHANCE;
}
/** Ticks a non-predator can go wanting food/water with none reachable anywhere before it gives up and migrates. */
const MIGRATE_AFTER_TICKS = 150;

/**
 * Sleep — see DESIGN.md's "Sleep: a real vulnerable-rest state" section.
 * `Needs.energy` decays at `DECAY_PER_TICK.energy` (0.005/tick), so a fully
 * rested (1.0) agent that never sleeps takes ~140 ticks to fall below this
 * threshold — a real, reachable-within-a-normal-run floor (not so low it
 * almost never fires), while still comfortably below `chooseBehavior`'s
 * urgency band so falling asleep never looks like an emergency reaction.
 * Sim-original tuning guess, explicitly flagged in DESIGN.md as unconfirmed
 * until a real run shows agents actually reaching it — see this feature's
 * "Built, and real-run findings" writeup.
 */
export const ENERGY_SLEEP_THRESHOLD = 0.3;

/**
 * How much slower hunger/thirst drain while genuinely asleep — real cost to
 * oversleeping (DESIGN.md's explicit ask: "dramatically reduced," not
 * paused), not free. 0.15 means an asleep agent's hunger/thirst budget
 * stretches to roughly 6-7x its awake rate — long enough that a multi-
 * hundred-tick sleep doesn't quietly kill the sleeper of thirst, short
 * enough that oversleeping still visibly costs something on a long enough
 * nap. Sim-original tuning guess, judge against a real run.
 */
export const SLEEP_NEEDS_DECAY_MULTIPLIER = 0.15;

/**
 * How fast `energy` rises while asleep — 4x `DECAY_PER_TICK.energy`'s awake
 * drain rate, so a full night's sleep is a real, visible recovery (a nap of
 * a few hundred ticks meaningfully refills energy) without being instant.
 */
export const SLEEP_ENERGY_RESTORE_RATE = 0.02;

/**
 * Heal-over-time multiplier while asleep — support.ts's `applyHealOverTime`
 * gets this on top of its existing flat rate, per DESIGN.md's "replenishes
 * hp... more" ask. 3x is a real, noticeable difference from awake healing
 * without being an instant full-heal nap.
 */
export const SLEEP_HEAL_MULTIPLIER = 3;

/** Move-cooldown ticks (combat.ts's `tickCooldowns`) consumed per world tick while asleep — double speed, DESIGN.md's "pp" (cooldown) recovery ask. */
export const SLEEP_COOLDOWN_TICKS = 2;

/**
 * Consecutive `sleepTicks` before a long, uninterrupted sleep grants a
 * one-time exp bonus — DESIGN.md's "long sleep can give xp" ask. Set above
 * a single ordinary nap's likely length (a sleep session this long means the
 * agent found genuinely safe, sustained rest) so this reads as a real
 * milestone, not something every nap trivially grants. Sim-original tuning
 * guess, judge against a real run.
 */
export const LONG_SLEEP_EXP_TICKS = 200;

/** One-time exp bonus granted at `LONG_SLEEP_EXP_TICKS` — same order of magnitude as leveling.ts's `EXP_ON_NEW_SECTOR` (20), a comparable "real milestone" reward. */
export const LONG_SLEEP_EXP_BONUS = 25;

/**
 * How far a fully-satisfied idle agent will look for a not-yet-visited
 * sector to wander to — the exp-motivated exploration drive. Deliberately
 * local (`SECTOR_SIZE` in leveling.ts is 5, so this reaches a handful of
 * neighboring sectors), not a full migrate()-style jump across the map —
 * this is idle curiosity, not desperation.
 */
const EXPLORE_SEARCH_RADIUS = 8;
const EXPLORE_SEARCH_ATTEMPTS = 8;
/**
 * A newborn doesn't wander off exploring the instant it's born — it settles
 * in near its birthplace for a few ticks first. Also fixes a real same-tick
 * interaction: a newborn (age 0) pushed mid-loop by `spawnOffspring` gets
 * ticked once more in the very same `tickWorld` call (see simulation.ts's
 * doc comment) — by the time ITS OWN turn runs, `tickAgentNeeds` has
 * already incremented its age to 1, and without this floor it could
 * immediately wander a step back onto its mother's own tile, defeating the
 * "don't spawn stacked on the mother" placement `nearbySpawnTile` exists
 * for (confirmed: this exact interaction intermittently failed that test).
 */
const MIN_EXPLORE_AGE = 10;

/** A random nearby walkable tile that lands in a sector this agent hasn't visited yet, if one can be found in a few tries. */
function findNearbyUnvisitedTile(world: World, agent: Agent, rng: () => number): Vec2 | undefined {
  for (let i = 0; i < EXPLORE_SEARCH_ATTEMPTS; i++) {
    const dx = Math.floor(rng() * (EXPLORE_SEARCH_RADIUS * 2 + 1)) - EXPLORE_SEARCH_RADIUS;
    const dy = Math.floor(rng() * (EXPLORE_SEARCH_RADIUS * 2 + 1)) - EXPLORE_SEARCH_RADIUS;
    const candidate = { x: agent.pos.x + dx, y: agent.pos.y + dy };
    if (!tileAt(world, agent.layer, candidate.x, candidate.y)?.walkable) continue;
    if (agent.visitedSectors?.includes(sectorId(candidate.x, candidate.y))) continue;
    return candidate;
  }
  return undefined;
}

/**
 * Called only once an agent is otherwise fully idle (no urgent need, no
 * herd pull-back needed) — instead of just standing on the last tile it
 * ate/drank at forever, it wanders toward nearby unexplored territory,
 * motivated by the exp `markSectorVisited` grants for genuinely new ground
 * (see leveling.ts). Requested directly: agents should be "somewhat
 * motivated by gaining exp too," not just gain it as a side effect of
 * need-seeking. Incidentally also closes the pre-existing "no reason to
 * leave a resource tile once satisfied" gap noted in TODO.md's tile-
 * stacking section. A no-op (stays idle) if nothing new is reachable
 * nearby right now — exploring is optional flavor, not another need that
 * can starve.
 */
function applyExploration(world: World, agent: Agent, log: EventLog | undefined, rng: () => number): void {
  if (agent.age !== undefined && agent.age < MIN_EXPLORE_AGE) return;

  if (!agent.exploreTarget) {
    agent.exploreTarget = findNearbyUnvisitedTile(world, agent, rng);
    if (!agent.exploreTarget) return;
  }

  logBehaviorChange(log, world, agent, "explore");
  agent.behavior = "explore";

  if (manhattan(agent.pos, agent.exploreTarget) <= 1) {
    agent.pos = agent.exploreTarget;
    agent.exploreTarget = undefined;
  } else {
    agent.pos = stepToward(world, agent.layer, agent.pos, agent.exploreTarget);
  }
}

const CONSUME_RATE = {
  seekWater: { need: "thirst", amount: 0.4 },
  seekFood: { need: "hunger", amount: 0.4 },
} as const;

export function createNeeds(overrides: Partial<Needs> = {}): Needs {
  return { hunger: 1, thirst: 1, energy: 1, mateDrive: 0, ...overrides };
}

/**
 * `thirstMultiplier` (default 1) composes multiplicatively with the flat
 * per-tick thirst decay rate — a local weather effect (rain eases it,
 * drought raises it — see weather.ts's `thirstDecayMultiplier`), not a
 * replacement for the base rate. Every pre-existing caller that doesn't pass
 * it keeps decaying at exactly the original flat rate.
 *
 * `asleep` (default false) is the sleep mechanic's three needs-decay effects
 * at once (DESIGN.md's "Sleep" section): while true, hunger and thirst decay
 * are both further multiplied by `SLEEP_NEEDS_DECAY_MULTIPLIER` (composing
 * with `thirstMultiplier` for thirst — a sleeping agent caught in a drought
 * still gets some relief, just less), and `energy` rises
 * (`SLEEP_ENERGY_RESTORE_RATE`) instead of falling. A single boolean rather
 * than a third numeric multiplier parameter: sleep doesn't just scale
 * energy's decay, it inverts its direction entirely, which a multiplier
 * alone can't express.
 */
export function decayNeeds(needs: Needs, thirstMultiplier = 1, asleep = false): void {
  const needsMultiplier = asleep ? SLEEP_NEEDS_DECAY_MULTIPLIER : 1;
  needs.hunger = Math.max(0, needs.hunger - (needs.hunger * HUNGER_DECAY_RATE + HUNGER_DECAY_FLOOR) * needsMultiplier);
  needs.thirst = Math.max(0, needs.thirst - DECAY_PER_TICK.thirst * thirstMultiplier * needsMultiplier);
  needs.energy = asleep
    ? Math.min(1, needs.energy + SLEEP_ENERGY_RESTORE_RATE)
    : Math.max(0, needs.energy - DECAY_PER_TICK.energy);
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

/**
 * Nearest tile of the given terrain kind, if any — delegates to
 * resourceIndex.ts's cached index rather than a naive full-grid scan (was
 * O(width*height) *per call*, flagged in TODO.md as the cheap tier's
 * performance ceiling; became a real bottleneck once the generated map grew
 * from 24x16 to ~90x60 — see DESIGN.md). Same signature/behavior as before,
 * so every existing caller/test is unaffected.
 */
export function findNearestTerrain(
  world: World,
  layer: Layer,
  from: Vec2,
  terrain: "water" | "food" | "sunbeam"
): Vec2 | undefined {
  return findNearestIndexed(world, layer, from, terrain);
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
 * DESIGN.md's "Herd status" payoff 1 — feeding priority. **Real contention
 * finding**: same-tick, same-tile contention over a food patch's dwindling
 * `stock` genuinely happens in this codebase's model — `tickWorld`'s
 * per-agent loop (simulation.ts) runs every agent's action tick within one
 * call, and `resourceIndex.ts`'s `findNearestIndexed` re-checks a food
 * tile's live `stock` on every lookup (only reverting to unindexed "floor"
 * once `growFlora` runs, once per tick, *after* the whole per-agent loop) —
 * so two herd-mates who both converge on the same nearest food tile
 * routinely both reach and target it inside the same `tickWorld` call, with
 * whichever one's turn came first in `world.agents`' iteration order
 * (arbitrary spawn order, nothing to do with status) draining the stock
 * first. This is that real mechanism, not an invented analog.
 *
 * What wasn't already real: consuming never actually depended on how much
 * `stock` was left — `consume()` always grants the full flat need-restore
 * amount regardless, `stock` was purely bookkeeping for when a patch reverts
 * to floor. So "getting whatever's left, possibly nothing" needed an actual
 * gate to attach to, added here: once a tile's `stock` is already low enough
 * that it can't obviously feed a second herd-mate too
 * (`FEEDING_PRIORITY_STOCK_THRESHOLD`), a lower-ranked agent that finds a
 * *higher-ranked, also-currently-hungry* herd-mate standing on the exact
 * same tile yields its turn (does nothing this tick, stays `seekFood`, tries
 * again next tick) instead of eating — so the higher-rank member's next
 * action tick (same tick or shortly after, whichever its own Speed-gated
 * turn allows) drains the tile first, and the lower-rank member only gets
 * "whatever's left" once the higher-rank one is no longer contesting it
 * (satisfied, or has moved on). Above the threshold, stock isn't actually
 * dwindling yet — both eat freely, no reason to make either wait.
 */
const FEEDING_PRIORITY_STOCK_THRESHOLD = 2 * CONSUME_STOCK_AMOUNT;

function yieldsToHigherRankedFeeder(world: World, agent: Agent, tileStock: number | undefined): boolean {
  if (!agent.herdId) return false;
  if (tileStock === undefined || tileStock >= FEEDING_PRIORITY_STOCK_THRESHOLD) return false;

  const myRank = herdRank(world, agent);
  return world.agents.some(
    (other) =>
      other.id !== agent.id &&
      other.alive !== false &&
      other.herdId === agent.herdId &&
      other.pos.x === agent.pos.x &&
      other.pos.y === agent.pos.y &&
      other.layer === agent.layer &&
      chooseBehavior(other.needs) === "seekFood" &&
      herdRank(world, other) < myRank
  );
}

/**
 * The part of an agent's tick that happens every world tick regardless of
 * the Speed-driven action economy (see simulation.ts): aging, cooldown
 * countdown (real-time, deliberately orthogonal to Speed — see DESIGN.md),
 * need decay, and the passive exp trickle (tiny, per-tick, for every living
 * agent — deliberately in this always-runs path rather than the action-
 * gated one, consistent with the rest of the action-economy split: surviving
 * doesn't pause because you're slow). `world`/`ctx`/`log` are optional so
 * callers without a leveling context (bare fixtures, anything that predates
 * this feature) keep working — no world/ctx means the trickle simply isn't
 * granted (nothing to log a tick number against).
 *
 * Heal-over-time and faint-recovery (support.ts) also live here, for the
 * same reason: a fainted agent still needs-decays and heals every tick even
 * though it's excluded from the action tick entirely (see `tickAgentAction`
 * below) — DESIGN.md's "Faint/finish-off, heal over time" section.
 *
 * `tickStatusEffects` (status.ts) lives here too, same reasoning: burn/
 * poison DOT and sleep/freeze's own duration/thaw all tick down regardless
 * of whether this is the agent's action tick. Paralysis's speed cut and
 * skip-the-action-tick roll are the two status effects that *aren't* here —
 * see `actionSpeedOf` (simulation.ts) and `tickAgentAction` below.
 */
export function tickAgentNeeds(
  agent: Agent,
  world?: World,
  ctx?: LevelingContext,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  if (agent.alive === false) return;
  if (agent.age !== undefined) agent.age += 1;
  tickCooldowns(agent, agent.asleep ? SLEEP_COOLDOWN_TICKS : 1);
  if (world) tickStatusEffects(agent, world, log);
  const thirstMultiplier = world ? thirstDecayMultiplier(world, agent.layer, agent.pos) : 1;
  decayNeeds(agent.needs, thirstMultiplier, agent.asleep === true);

  // Hunger and thirst each get their own consecutive-zero-ticks counter and
  // their own grace threshold (`STARVATION_GRACE_TICKS` /
  // `THIRST_STARVATION_GRACE_TICKS`) — a single shared counter can't
  // correctly judge two different thresholds once hunger and thirst can
  // independently cross 0 at different ticks (see `Agent.thirstStarvationTicks`'s
  // doc comment).
  if (world && agent.needs.hunger <= 0) {
    agent.starvationTicks = (agent.starvationTicks ?? 0) + 1;
  } else {
    agent.starvationTicks = 0;
  }
  if (world && agent.needs.thirst <= 0) {
    agent.thirstStarvationTicks = (agent.thirstStarvationTicks ?? 0) + 1;
  } else {
    agent.thirstStarvationTicks = 0;
  }

  if (
    world &&
    ((agent.starvationTicks ?? 0) >= STARVATION_GRACE_TICKS ||
      (agent.thirstStarvationTicks ?? 0) >= THIRST_STARVATION_GRACE_TICKS)
  ) {
    agent.alive = false;
    agent.diedAtTick = world.tick;
    log?.record({
      kind: "starved",
      tick: world.tick,
      agentId: agent.id,
      species: agent.species,
      pos: agent.pos,
      // Ties (both thresholds crossed the same tick) report hunger, matching
      // this codebase's pre-existing convention for a tied cause.
      cause: (agent.starvationTicks ?? 0) >= STARVATION_GRACE_TICKS ? "hunger" : "thirst",
    });
    return;
  }

  applyHealOverTime(agent, agent.asleep ? SLEEP_HEAL_MULTIPLIER : 1);
  if (world) maybeRecoverFromFaint(agent, world, log);
  if (world) grantExp(world, agent, EXP_TRICKLE_PER_TICK, ctx, log, rng);

  // Long-sleep exp bonus (DESIGN.md's "long sleep can give xp" ask) — granted
  // exactly once per sleep session, detected as a threshold crossing right
  // here (both the increment and the grant happen in this same function, so
  // no separate one-shot flag is needed the way `pendingLevelDispersalCheck`
  // needs one for a trigger/consumer split across modules). `sleepTicks`
  // itself resets to 0 on waking (needs.ts's `tickAgentAction` sleep block),
  // so a later nap gets a fresh shot at the bonus rather than being
  // permanently spent.
  if (agent.asleep) {
    const wasBelowThreshold = (agent.sleepTicks ?? 0) < LONG_SLEEP_EXP_TICKS;
    agent.sleepTicks = (agent.sleepTicks ?? 0) + 1;
    if (wasBelowThreshold && agent.sleepTicks >= LONG_SLEEP_EXP_TICKS && world) {
      grantExp(world, agent, LONG_SLEEP_EXP_BONUS, ctx, log, rng);
      log?.record({
        kind: "longSleepBonus",
        tick: world.tick,
        agentId: agent.id,
        species: agent.species,
        pos: agent.pos,
        exp: LONG_SLEEP_EXP_BONUS,
      });
    }
  }
}

/**
 * The part of an agent's tick that only runs on an action tick: survival
 * instincts, behavior choice, movement, mate-seeking, attacks. Needs-seeking
 * routinely crosses layers: a Diglett (home: underground) finds its food on
 * the surface and crosses to get it, then drifts back once satisfied.
 * Crossing itself takes a tick (no position change) so it reads as a
 * discrete, loggable event rather than free teleportation.
 *
 * Survival instincts (flee a nearby predator, hunt nearby prey when hungry)
 * take priority over normal need-seeking when `rules` is provided — see
 * predation.ts. Without rules, agents behave exactly as before predation
 * existed.
 *
 * A fainted agent, or one currently being physically carried by a herd-mate
 * (`beingCarriedBy`), takes NO action-tick behavior at all — no movement,
 * attack, flee, hunt, mate-seeking, or food delivery — per DESIGN.md; it
 * still needs-decays and heals via `tickAgentNeeds` above. Everything else
 * here (carrying an ally, looting, herd food delivery) runs for a normal,
 * conscious agent, ahead of ordinary needs-driven behavior: an in-progress
 * carry gets first refusal (so a threat can still make the carrier drop the
 * ally and flee this same tick, see support.ts's `applyCarrying`), then
 * survival instincts, then starting a new carry/loot/delivery, then the
 * original needs-based behavior choice.
 *
 * Asleep or frozen is the same shape as fainted/beingCarriedBy — no action
 * at all while it lasts (status.ts's `tickStatusEffects` handles counting
 * the affliction itself down, this just blocks acting while it's active).
 * Paralysis doesn't block acting outright; instead it rolls a real chance
 * (`PARALYSIS_SKIP_CHANCE`) to skip *this* action tick, on top of the
 * separate, permanent Speed cut it applies in `actionSpeedOf`
 * (simulation.ts) — mainline's two independent paralysis effects (fewer
 * turns overall, plus a full-lockout chance on the turns you do get),
 * modeled as two independent mechanisms here too rather than one that
 * approximates both.
 */
export function tickAgentAction(
  world: World,
  agent: Agent,
  log?: EventLog,
  rules?: HuntRules,
  ctx?: LevelingContext,
  rng: () => number = Math.random
): void {
  if (agent.alive === false) return;
  if (agent.fainted) return;
  if (agent.beingCarriedBy) return;
  if (isAsleep(agent) || isFrozen(agent)) return;
  if (isParalyzed(agent) && rng() < PARALYSIS_SKIP_CHANCE) return;
  if ((agent.actionLockTicks ?? 0) > 0) return;

  if (applyCarrying(world, agent, rules, log)) return;
  if (rules && applyPredationInstincts(world, agent, rules, log, ctx, rng)) return;
  if (maybeStartCarrying(world, agent, log)) return;
  if (applyLooting(world, agent, log)) return;
  if (applySupportMove(world, agent, log)) return;
  if (applyHerdSupport(world, agent, log)) return;

  // Natal dispersal (dispersal.ts) — checked once per action tick for every
  // agent not already dispersing, ranked below survival/carrying/looting/
  // herd-support (those get first refusal, same as everything above) but
  // ahead of ordinary needs-driven behavior. Direct instruction: "needs
  // should be able to jump queue in priority, definitely based on urgency" —
  // so an in-progress dispersal is PAUSABLE, the exact same shape
  // shelter-building's own pause-on-urgent-need logic uses just below: it
  // only continues (`applyDispersal`) while `chooseBehavior` still reads
  // `"idle"`, and falls through to ordinary needs-driven behavior for as many
  // ticks as it takes to resolve otherwise, without touching
  // `agent.dispersalTarget` — the walk resumes exactly where it left off once
  // the agent is satisfied again. This replaces an earlier "commits no matter
  // what" version: a real run confirmed agents dying of thirst standing right
  // next to water turned out to be exactly this dispersal side effect
  // (overriding hunger/thirst/mate-seeking for the entire multi-hundred-tick
  // walk), not a crowding or water-scarcity problem — see DESIGN.md's
  // "Urgency-based need priority" section. `maybeTriggerDispersal`'s own
  // trigger conditions (level gate, disposition-weighted roll, no-mates
  // fallback timer) are untouched by this — it's still a no-op whenever
  // `agent.dispersalTarget` is already set, so this never re-triggers a
  // dispersal already in progress.
  if (agent.dispersalTarget) {
    if (chooseBehavior(agent.needs) === "idle") {
      applyDispersal(world, agent, log);
      return;
    }
    // Paused, not abandoned — resumes on a later tick once satisfied again.
  } else {
    maybeTriggerDispersal(world, agent, log, rng);
    if (agent.dispersalTarget && chooseBehavior(agent.needs) === "idle") {
      applyDispersal(world, agent, log);
      return;
    }
  }

  // Shelter-building (shelter.ts) — deliberately NOT given dispersal's
  // "commits no matter what" priority: a real run at seed 42 confirmed why.
  // With that first design (checked/continued unconditionally, like
  // dispersal), all 4 of the demo scenario's buildsShelter founders
  // (2 Diglett, 2 Sandshrew) either starved mid-build or got caught by a
  // predator while traveling to a build site far from any resource, wiping
  // out the entire underground lineage before tick 170 — every one of them
  // committed to the multi-hundred-tick round trip the instant they first
  // went idle, then never broke off to eat/drink because the check was
  // unconditional. Direct instruction is explicit that this feature should
  // NOT override survival instincts, so an in-progress task pauses (without
  // losing its travel/build progress — `Agent.shelterTarget`/
  // `shelterBuildTicks` are left untouched) the moment a real need becomes
  // urgent, and falls through to ordinary needs-driven behavior for as many
  // ticks as it takes to resolve — the same "checked fresh every tick, drop
  // out the instant something more urgent shows up" shape `applyExploration`
  // already uses below, not dispersal's shape. The trigger itself is gated
  // the same way: only an agent that's currently satisfied goes to start a
  // build in the first place.
  if (agent.shelterTarget) {
    if (chooseBehavior(agent.needs) === "idle") {
      applyShelterBuilding(world, agent, log);
      return;
    }
    // Paused, not abandoned — resumes on a later tick once satisfied again.
  } else if (chooseBehavior(agent.needs) === "idle") {
    maybeTriggerShelterBuilding(world, agent, rng);
    if (agent.shelterTarget) {
      applyShelterBuilding(world, agent, log);
      return;
    }
  }

  // Sleep (needs.ts + predation.ts) — DESIGN.md's "Sleep: a real
  // vulnerable-rest state" section, verbatim ask: "lets add sleeping. make
  // it so it replenishes hp and pp more, but you're sitting duck. sometimes
  // herd protects each other and can wake each other up. hunger and thirst
  // drain is dramatically reduced while sleeping. long sleep can give xp."
  // Same tier as shelter-building/exploration: checked here, after
  // survival/carrying/looting/herd-support/dispersal/shelter all get their
  // existing first-refusal priority above.
  //
  // While asleep, checked fresh every action tick, the same "drop out the
  // instant something wins priority" shape shelter/dispersal use above: two
  // things wake the agent and let it fall through to ordinary behavior THIS
  // SAME tick rather than wasting it — (1) an urgent need
  // (`chooseBehavior(needs) !== "idle"`), sleep never lets an agent starve in
  // its sleep, and (2) a threat within detection range AND an awake,
  // conscious, same-herd watcher close enough to notice and rouse it (the
  // "herd protects each other" ask) — deliberately not a random roll, same
  // "chance emergent from real positioning, not an invented dice roll"
  // approach `applyPredationInstincts`'s own mob-fighting already uses.
  // (Note: `applyPredationInstincts` above already ran THIS tick with
  // `agent.asleep` still true and skipped its self-defense branches — see its
  // doc comment — so a wake here doesn't retroactively grant an in-tick
  // flee/fight reaction; that begins on this agent's next action tick, now
  // that `asleep` reads false. "Falls through to ordinary behavior" here
  // means needs-seeking/exploring resumes immediately, not that the tick is
  // wasted standing still.) Otherwise (safe, or a threat is near with no one
  // to notice) the agent stays asleep and does nothing this tick at all — no
  // movement, no attack, no flee — the "sitting duck" half.
  if (agent.asleep) {
    const urgentNeed = chooseBehavior(agent.needs) !== "idle";
    const threatNearby = rules ? hasNearbyThreat(world, agent, rules) : false;
    const watcherNearby = threatNearby && hasAwakeHerdmateNearby(world, agent);
    if (urgentNeed || watcherNearby) {
      agent.asleep = false;
      agent.sleepTicks = 0;
      log?.record({
        kind: "wokeUp",
        tick: world.tick,
        agentId: agent.id,
        species: agent.species,
        pos: agent.pos,
        reason: urgentNeed ? "urgentNeed" : "threatSpotted",
      });
      // Falls through to ordinary needs-driven behavior below.
    } else {
      return; // Sitting duck: no movement, attack, or flee while genuinely asleep.
    }
  } else if (
    chooseBehavior(agent.needs) === "idle" &&
    agent.needs.energy < ENERGY_SLEEP_THRESHOLD &&
    !(rules && hasNearbyThreat(world, agent, rules))
  ) {
    agent.asleep = true;
    agent.sleepTicks = 0;
    logBehaviorChange(log, world, agent, "sleep");
    agent.behavior = "sleep";
    log?.record({ kind: "fellAsleep", tick: world.tick, agentId: agent.id, species: agent.species, pos: agent.pos });
    return;
  }

  // Continue an in-progress exploration walk as long as nothing more urgent
  // has come up since it started (checked fresh, not read from the stale
  // `agent.behavior` — see applyExploration's doc comment on why an urgent
  // need always wins).
  if (agent.exploreTarget) {
    if (chooseBehavior(agent.needs) === "idle") {
      applyExploration(world, agent, log, rng);
      return;
    }
    agent.exploreTarget = undefined;
  }

  markSectorVisited(agent, world, ctx, log, rng);
  // Once an agent has racked up a handful of distinct species, it's very likely seen
  // everything currently in play (the demo roster is ~6 species) — skip the O(agents)
  // nearby-scan entirely past that point rather than re-scanning forever for a trickle
  // that will never fire again. Without this cap, this scan alone turns a long run with
  // an exploding population (see DESIGN.md's Venusaur/Bulbasaur growth findings) into an
  // O(agents^2)-per-tick cost that made even a 5000-tick run impractically slow.
  if ((agent.encounteredSpecies?.length ?? 0) < MAX_TRACKED_SPECIES) {
    for (const other of world.agents) {
      if (other.id === agent.id || other.alive === false) continue;
      if (Math.abs(other.pos.x - agent.pos.x) + Math.abs(other.pos.y - agent.pos.y) > 3) continue;
      markSpeciesEncountered(agent, other.species, world, ctx, log, rng);
    }
  }

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
    applyMateSeeking(world, agent, log, ctx, rng);
    return;
  }

  if (agent.behavior === "seekWater" || agent.behavior === "seekFood") {
    const terrain = agent.behavior === "seekWater" ? "water" : "food";
    const target = findNearestTerrain(world, agent.layer, agent.pos, terrain);

    if (target) {
      agent.ticksWithoutResource = 0;
      if (target.x === agent.pos.x && target.y === agent.pos.y) {
        if (agent.behavior === "seekFood" && yieldsToHigherRankedFeeder(world, agent, tileAt(world, agent.layer, target.x, target.y)?.stock)) {
          // Defers to a higher-ranked, also-hungry herd-mate on this exact
          // tile while the patch is running low — see
          // `yieldsToHigherRankedFeeder`'s doc comment. Stays put, doesn't
          // consume; re-checked fresh next tick.
          return;
        }
        const need = agent.behavior === "seekWater" ? "thirst" : "hunger";
        consume(agent.needs, agent.behavior);
        if (agent.behavior === "seekFood") {
          const tile = tileAt(world, agent.layer, target.x, target.y);
          if (tile?.stock !== undefined) tile.stock = Math.max(0, tile.stock - CONSUME_STOCK_AMOUNT);
        }
        grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
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
      if (migrate(world, agent, log, rng) === "arrived") agent.ticksWithoutResource = 0;
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
    const drewBack = applyHerdCohesion(world, agent, rules);
    if (!drewBack) applyExploration(world, agent, log, rng);
  }
}

/**
 * Convenience wrapper that runs both halves unconditionally — needs decay
 * *and* a full action — for callers that don't go through `tickWorld`'s
 * Speed-gated action economy (direct unit tests, anything that wants "tick
 * this one agent once, fully" without wiring up actionEnergy/stats). Real
 * simulation ticking goes through `tickWorld` (simulation.ts), which calls
 * `tickAgentNeeds` every tick and `tickAgentAction` only on an agent's
 * action tick.
 */
export function tickAgent(
  world: World,
  agent: Agent,
  log?: EventLog,
  rules?: HuntRules,
  ctx?: LevelingContext,
  rng: () => number = Math.random
): void {
  tickAgentNeeds(agent, world, ctx, log, rng);
  tickAgentAction(world, agent, log, rules, ctx, rng);
}
