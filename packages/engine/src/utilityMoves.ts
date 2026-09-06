import type { Agent, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";
import { useMove } from "./combat.js";
import { applyStatStage } from "./status.js";
import { raiseFertility, isNearSunbeam } from "./flora.js";
import { spawnWeatherCellAt } from "./weather.js";
import { agentsWithin, nearest } from "./predation.js";

/**
 * Real structural gap this file closes (see MOVES_DESIGN.md's "why status
 * effects and environmental moves are two different systems"): every move
 * before this one either rides the hostile hit pipeline (`resolveHit`,
 * predation.ts) or the ally-support pipeline (`applySupportMove`,
 * support.ts) — both need a real other agent in range. A self/tile-effect
 * move (Growth, Agility, Rain Dance) targets neither, so it needs its own
 * trigger, checked in the same idle-tick slot `applyExploration` occupies
 * (needs.ts) rather than either existing pipeline.
 */

/** Per-idle-tick chance to actually try an eligible utility move, so an off-cooldown one doesn't fire literally every single idle tick — a deliberate, occasional choice, not a reflex. */
const UTILITY_MOVE_USE_CHANCE = 0.15;

/**
 * Tries each of `agent`'s off-cooldown `utilityMove`-flagged moves in turn,
 * applying whichever effect field(s) it carries and putting it on cooldown
 * the moment one actually does something. Returns whether a move fired (the
 * needs.ts caller treats that the same as any other "this tick is spoken
 * for" action). A `drainNeeds` move with no valid target in range is
 * skipped WITHOUT going on cooldown — there was nothing to use it on, so
 * the next off-cooldown check should try again rather than waste it.
 */
export function maybeUseUtilityMove(world: World, agent: Agent, log: EventLog | undefined, rng: () => number): boolean {
  const candidates = (agent.moves ?? []).filter((m) => m.utilityMove && !agent.moveCooldowns?.[m.id]);
  if (candidates.length === 0) return false;
  if (rng() >= UTILITY_MOVE_USE_CHANCE) return false;

  for (const move of candidates) {
    if (move.drainNeeds) {
      const targets = agentsWithin(world, agent, move.drainNeeds.radius).filter((other) => other.herdId === undefined || other.herdId !== agent.herdId);
      const target = nearest(agent, targets);
      if (!target) continue; // nothing to drain from yet — try again next eligible tick, not wasted on cooldown
      useMove(agent, move, world.tick);
      const { need, amount } = move.drainNeeds;
      target.needs[need] = Math.max(0, target.needs[need] - amount);
      agent.needs[need] = Math.min(1, agent.needs[need] + amount);
      return true;
    }

    useMove(agent, move, world.tick);

    if (move.selfHeal && agent.hp !== undefined && agent.maxHp !== undefined) {
      let fraction = move.selfHeal.fraction;
      if (move.selfHeal.sunbeamBonus && isNearSunbeam(world, agent.pos)) fraction += move.selfHeal.sunbeamBonus;
      agent.hp = Math.min(agent.maxHp, agent.hp + agent.maxHp * fraction);
    }

    if (move.fertilityBoost) {
      const { amount, radius } = move.fertilityBoost;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          raiseFertility(tileAt(world, agent.layer, agent.pos.x + dx, agent.pos.y + dy), amount);
        }
      }
    }

    if (move.statChangeOnHit?.target === "self") {
      applyStatStage(agent, move.statChangeOnHit.stat, move.statChangeOnHit.stage, move.statChangeOnHit.ticks);
    }

    if (move.statusImmunityAura) {
      const { ticks, radius } = move.statusImmunityAura;
      agent.statusImmuneTicksRemaining = ticks;
      if (agent.herdId) {
        for (const other of agentsWithin(world, agent, radius)) {
          if (other.herdId === agent.herdId) other.statusImmuneTicksRemaining = ticks;
        }
      }
    }

    if (move.spawnsRain) {
      spawnWeatherCellAt(world, log, agent.pos.x, agent.pos.y, "rain", rng);
    }

    if (move.matingRadiusBoost) {
      agent.matingRadiusBoostTicksRemaining = move.matingRadiusBoost.ticks;
    }

    return true;
  }
  return false;
}
