import type { Agent, BehaviorKind, HuntRules, Layer, Needs, Vec2, World } from "./types.js";
import { otherLayers, tileAt } from "./world.js";
import { stepToward } from "./movement.js";
import { applyPredationInstincts } from "./predation.js";
import { applyMateSeeking } from "./reproduction.js";
import { CONSUME_STOCK_AMOUNT } from "./flora.js";
import { tickCooldowns } from "./combat.js";
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

const DECAY_PER_TICK = {
  hunger: 0.01,
  thirst: 0.015,
  energy: 0.005,
  mateDrive: 0.01,
} as const;

const CONSUME_RATE = {
  seekWater: { need: "thirst", amount: 0.4 },
  seekFood: { need: "hunger", amount: 0.4 },
} as const;

export function createNeeds(overrides: Partial<Needs> = {}): Needs {
  return { hunger: 1, thirst: 1, energy: 1, mateDrive: 0, ...overrides };
}

export function decayNeeds(needs: Needs): void {
  needs.hunger = Math.max(0, needs.hunger - DECAY_PER_TICK.hunger);
  needs.thirst = Math.max(0, needs.thirst - DECAY_PER_TICK.thirst);
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

export function findNearestTerrain(
  world: World,
  layer: Layer,
  from: Vec2,
  terrain: "water" | "food" | "sunbeam"
): Vec2 | undefined {
  let best: Vec2 | undefined;
  let bestDist = Infinity;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = tileAt(world, layer, x, y);
      if (tile?.terrain !== terrain) continue;
      if (terrain === "food" && (tile.stock ?? 0) <= 0) continue; // depleted patch, keep looking
      const dist = Math.abs(x - from.x) + Math.abs(y - from.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
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
  decayNeeds(agent.needs);
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
