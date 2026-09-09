import type { Agent, World } from "./types.js";
import type { StatKey } from "./nature.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";
import { useMove } from "./combat.js";
import { applyStatStage, getStatStage } from "./status.js";
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
      // Deliberately falls through to the effect checks below instead of
      // returning here. A `drainNeeds` move can carry other utility fields
      // too (Leech Seed's own tree puts what it steals back into the
      // ground via `fertilityBoost`), and the old early return made every
      // one of those silently dead on any move that also drains — a real
      // composition gap, not just a missed feature.
    } else {
      useMove(agent, move, world.tick);
    }

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

    log?.record({ kind: "utilityMoveUsed", tick: world.tick, agentId: agent.id, species: agent.species, moveId: move.id, inCombat: false });
    return true;
  }
  return false;
}

/**
 * Per-action chance to spend a fight action on a worthwhile utility move
 * rather than attacking. Lower than `UTILITY_MOVE_USE_CHANCE` on purpose:
 * out of combat an idle tick costs nothing, in a fight it costs a hit.
 */
const COMBAT_UTILITY_USE_CHANCE = 0.2;

/** Below this HP fraction a `selfHeal` is worth an action mid-fight. */
const COMBAT_HEAL_HP_FRACTION = 0.6;

/**
 * How many stages of a stat an agent will stack from utility moves before it
 * stops being worth another action. Mainline caps stages at +6; this is
 * deliberately far lower, because an agent that spends six actions buffing
 * has spent the whole fight not fighting.
 */
const COMBAT_MAX_SELF_BUFF_STAGES = 2;

/**
 * Is this utility move worth an ACTION IN A FIGHT, right now?
 *
 * Deliberately keyed on the effect fields rather than on move ids: nothing
 * here knows what Harden or Growth are, so a new status move written
 * tomorrow is combat-usable the moment it carries a field this understands,
 * and one that only changes the weather stays out of fights without needing
 * to be listed anywhere.
 *
 * The setups are NOT wired up explicitly. Direct: "Don't make the setups
 * explicit. Use systems to abstract em." A stat-stage buff applied here is
 * read by `calculateDamage` (combat.ts) and by `weightScaling`
 * (predation.ts) like any other stage — so bracing before a heavy hit works
 * because bracing and heavy hits both already talk to the stat-stage system,
 * not because anything pairs the two moves together.
 */
function worthAnActionInCombat(agent: Agent, move: { selfHeal?: unknown; statChangeOnHit?: { target?: string; stat: StatKey; stage: number }; statusImmunityAura?: unknown }): boolean {
  if (move.selfHeal && agent.hp !== undefined && agent.maxHp !== undefined && agent.maxHp > 0) {
    if (agent.hp / agent.maxHp <= COMBAT_HEAL_HP_FRACTION) return true;
  }
  const change = move.statChangeOnHit;
  if (change?.target === "self" && change.stage > 0) {
    // Only while the buff is still buying something. Re-applying a stat the
    // agent has already stacked is the classic "AI wastes its whole fight
    // on setup" failure, and it is a real one here: `applyStatStage` PUSHES
    // rather than replaces, so nothing else stops it.
    if (getStatStage(agent, change.stat) < COMBAT_MAX_SELF_BUFF_STAGES) return true;
  }
  // Status immunity is worth an action only against something that can
  // actually inflict a status — checked by the caller, which has the
  // opponent in scope.
  return false;
}

/**
 * The in-combat half of `maybeUseUtilityMove`: lets an agent spend a fight
 * action on a status/utility move instead of a hit.
 *
 * Real gap this closes — status moves were learnable, resolvable and fully
 * built, and could never fire in a fight: `pickBestMove` (combat.ts)
 * excludes every `utilityMove`, and `maybeUseUtilityMove` above is gated
 * behind `chooseBehavior(agent.needs) === "idle"` in needs.ts. So an agent
 * in a fight had no path to one at all. Direct: "Status moves need to be
 * usable in combat."
 *
 * Returns whether the action was spent. Weather, fertility and mating-radius
 * moves are deliberately unreachable from here — they are real effects with
 * nothing to say mid-fight, and firing them would read as the agent
 * ignoring the fight.
 */
export function maybeUseUtilityMoveInCombat(
  world: World,
  agent: Agent,
  opponent: Agent,
  log: EventLog | undefined,
  rng: () => number
): boolean {
  const candidates = (agent.moves ?? []).filter((m) => m.utilityMove && !agent.moveCooldowns?.[m.id]);
  if (candidates.length === 0) return false;

  const opponentCanInflictStatus = (opponent.moves ?? []).some((m) => (m.statusChance ?? 0) > 0);
  const worthIt = candidates.filter(
    (m) =>
      worthAnActionInCombat(agent, m) ||
      (m.statusImmunityAura !== undefined && opponentCanInflictStatus && (agent.statusImmuneTicksRemaining ?? 0) <= 0)
  );
  if (worthIt.length === 0) return false;
  if (rng() >= COMBAT_UTILITY_USE_CHANCE) return false;

  const move = worthIt[0];
  useMove(agent, move, world.tick);

  if (move.selfHeal && agent.hp !== undefined && agent.maxHp !== undefined) {
    let fraction = move.selfHeal.fraction;
    if (move.selfHeal.sunbeamBonus && isNearSunbeam(world, agent.pos)) fraction += move.selfHeal.sunbeamBonus;
    agent.hp = Math.min(agent.maxHp, agent.hp + agent.maxHp * fraction);
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

  log?.record({
    kind: "utilityMoveUsed",
    tick: world.tick,
    agentId: agent.id,
    species: agent.species,
    moveId: move.id,
    inCombat: true,
  });
  return true;
}
