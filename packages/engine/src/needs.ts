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
import {
  EXP_ON_CONSUME,
  EXP_TRICKLE_PER_TICK,
  MAX_TRACKED_SPECIES,
  grantExp,
  markSectorVisited,
  markSpeciesEncountered,
  type LevelingContext,
} from "./leveling.js";
import { applyCarrying, applyHealOverTime, applyHerdSupport, applyLooting, maybeRecoverFromFaint, maybeStartCarrying } from "./support.js";
import { findNearestIndexed } from "./resourceIndex.js";
import { thirstDecayMultiplier } from "./weather.js";

const DECAY_PER_TICK = {
  hunger: 0.01,
  thirst: 0.015,
  energy: 0.005,
  mateDrive: 0.01,
} as const;

/** Ticks an agent can sit at 0 hunger or thirst before it dies of it. */
const STARVATION_GRACE_TICKS = 100;
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
 */
export function decayNeeds(needs: Needs, thirstMultiplier = 1): void {
  needs.hunger = Math.max(0, needs.hunger - DECAY_PER_TICK.hunger);
  needs.thirst = Math.max(0, needs.thirst - DECAY_PER_TICK.thirst * thirstMultiplier);
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
 */
export function tickAgentNeeds(agent: Agent, world?: World, ctx?: LevelingContext, log?: EventLog): void {
  if (agent.alive === false) return;
  if (agent.age !== undefined) agent.age += 1;
  tickCooldowns(agent);
  const thirstMultiplier = world ? thirstDecayMultiplier(world, agent.layer, agent.pos) : 1;
  decayNeeds(agent.needs, thirstMultiplier);

  if (world && agent.age !== undefined && Math.random() < ageMortalityChance(agent.age)) {
    agent.alive = false;
    agent.diedAtTick = world.tick;
    log?.record({ kind: "diedOfAge", tick: world.tick, agentId: agent.id, species: agent.species, pos: agent.pos, age: agent.age });
    return;
  }

  if (world && (agent.needs.hunger <= 0 || agent.needs.thirst <= 0)) {
    agent.starvationTicks = (agent.starvationTicks ?? 0) + 1;
    if (agent.starvationTicks >= STARVATION_GRACE_TICKS) {
      agent.alive = false;
      agent.diedAtTick = world.tick;
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

  applyHealOverTime(agent);
  if (world) maybeRecoverFromFaint(agent, world, log);
  if (world) grantExp(world, agent, EXP_TRICKLE_PER_TICK, ctx, log);
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
 */
export function tickAgentAction(world: World, agent: Agent, log?: EventLog, rules?: HuntRules, ctx?: LevelingContext): void {
  if (agent.alive === false) return;
  if (agent.fainted) return;
  if (agent.beingCarriedBy) return;

  if (applyCarrying(world, agent, rules, log)) return;
  if (rules && applyPredationInstincts(world, agent, rules, log, ctx)) return;
  if (maybeStartCarrying(world, agent, log)) return;
  if (applyLooting(world, agent, log)) return;
  if (applyHerdSupport(world, agent, log)) return;

  markSectorVisited(agent, world, ctx, log);
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
      markSpeciesEncountered(agent, other.species, world, ctx, log);
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
    applyMateSeeking(world, agent, log, ctx);
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
        grantExp(world, agent, EXP_ON_CONSUME, ctx, log);
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
    applyHerdCohesion(world, agent, rules);
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
export function tickAgent(world: World, agent: Agent, log?: EventLog, rules?: HuntRules, ctx?: LevelingContext): void {
  tickAgentNeeds(agent, world, ctx, log);
  tickAgentAction(world, agent, log, rules, ctx);
}
