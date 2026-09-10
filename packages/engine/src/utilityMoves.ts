import type { Agent, World } from "./types.js";
import type { MoveSpec } from "./moves.js";
import { resolveAllyEffect, resolveStatChangesOnHit } from "./moves.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";
import { useMove } from "./combat.js";
import { applyStatStage, getStatStage } from "./status.js";
import { raiseFertility, raiseFertilityCeiling, isNearSunbeam } from "./flora.js";
import { spawnWeatherCellAt } from "./weather.js";
import { agentsWithin, nearest } from "./predation.js";
import { applyAllyEffect, nearestAllyEffectTarget } from "./support.js";

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

    // Building the ground itself, as opposed to `fertilityBoost`'s "get
    // this ground back to its own ceiling faster". On rocky (ceiling 0.25)
    // and sandy (0.6) tiles worldgen already writes fertility AT the
    // ceiling, so this is the only one of the two that changes anything
    // there at all — see `MoveSpec.fertilityCeilingBoost`.
    if (move.fertilityCeilingBoost) {
      const { amount, radius } = move.fertilityCeilingBoost;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          raiseFertilityCeiling(tileAt(world, agent.layer, agent.pos.x + dx, agent.pos.y + dy), amount);
        }
      }
    }

    for (const change of resolveStatChangesOnHit(move).filter((c) => c.target === "self")) {
      applyStatStage(agent, change.stat, change.stage, change.ticks);
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
      spawnWeatherCellAt(world, log, agent.pos.x, agent.pos.y, move.weatherType ?? "rain", rng, {
        radiusBonus: move.weatherRadiusBonus,
        lifespanBonus: move.weatherLifespanBonus,
      });
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

/** A self-buff this move already owns is worth re-spending a fight action on only once it is nearly gone. */
const REFRESH_WHEN_TICKS_LEFT = 5;

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
/**
 * What spending a fight action on `move` is worth right now, 0 meaning "not
 * worth it". Replaces a boolean, because the caller used to take
 * `worthIt[0]` — the FIRST off-cooldown candidate, in movepool order. An
 * agent holding Roost and Safeguard always roosted, however nearly dead its
 * herd-mate was and however poisonous the thing in front of it.
 *
 * The numbers are priorities, not damage estimates: bigger means "do this
 * one first". They are deliberately coarse — the point is a stable ordering
 * (stay alive > stop the thing that ends fights > help the herd > set up >
 * change the weather), not a tuned economy.
 */
function combatUtilityValue(world: World, agent: Agent, opponent: Agent, move: MoveSpec): number {
  let value = 0;

  // 1. Stay alive. Scales with how hurt it is, so a heal at 10% HP outranks
  //    every other thing this function can score.
  if (move.selfHeal && agent.hp !== undefined && agent.maxHp !== undefined && agent.maxHp > 0) {
    const fraction = agent.hp / agent.maxHp;
    if (fraction <= COMBAT_HEAL_HP_FRACTION) value = Math.max(value, 100 + (1 - fraction) * 100);
  }

  // 2. Status immunity, but only against something that can actually inflict
  //    one — an aura raised against a thing with no status move is an action
  //    spent on nothing.
  if (
    move.statusImmunityAura !== undefined &&
    (agent.statusImmuneTicksRemaining ?? 0) <= 0 &&
    (opponent.moves ?? []).some((m) => (m.statusChance ?? 0) > 0)
  ) {
    value = Math.max(value, 90);
  }

  // 3. Help a herd-mate who actually needs it. Only counts when there IS one
  //    in range and it is genuinely hurt — otherwise a support move would
  //    outrank fighting forever in a fight with nobody else in it.
  const ally = resolveAllyEffect(move) ? nearestAllyEffectTarget(world, agent, move) : undefined;
  if (ally) {
    const allyFraction = ally.hp !== undefined && ally.maxHp ? ally.hp / ally.maxHp : 1;
    if (resolveAllyEffect(move)?.healFraction !== undefined && allyFraction <= COMBAT_HEAL_HP_FRACTION) {
      value = Math.max(value, 80 + (1 - allyFraction) * 40);
    } else if ((resolveAllyEffect(move)?.buffs ?? []).length > 0) {
      value = Math.max(value, 40);
    }
  }

  // 4. Setup. Same two rules the boolean version had, kept verbatim in
  //    spirit: not past the ceiling, but DO refresh this move's own entry
  //    before it lapses (entries refresh rather than stack, so rule one
  //    alone would make a landed buff permanently unusable).
  for (const change of resolveStatChangesOnHit(move)) {
    if (change.target !== "self" || change.stage <= 0) continue;
    const mine = (agent.statStages ?? []).find((st) => st.stat === change.stat && st.sourceMoveId === move.id);
    if (!mine) {
      if (getStatStage(agent, change.stat) < COMBAT_MAX_SELF_BUFF_STAGES) value = Math.max(value, 50);
    } else if ((mine.ticksRemaining ?? Infinity) <= REFRESH_WHEN_TICKS_LEFT) {
      value = Math.max(value, 55);
    }
  }

  // 5. Take something off the opponent. Real, but never the thing to do
  //    while dying, so it sits below survival.
  if (move.drainNeeds) {
    const targets = agentsWithin(world, agent, move.drainNeeds.radius).filter(
      (other) => other.herdId === undefined || other.herdId !== agent.herdId
    );
    if (nearest(agent, targets)) value = Math.max(value, 45);
  }

  // 6. Change the weather. Lowest: it is a real effect on a real fight
  //    (weather multiplies damage), but it is the least urgent thing here
  //    and should never be picked over healing.
  const spawnType = move.weatherType ?? "rain";
  if (move.spawnsRain && !(world.weatherCells ?? []).some((cell) => cell.type === spawnType)) value = Math.max(value, 20);

  return value;
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

  // Best, not first. `worthIt[0]` took whichever candidate happened to sit
  // earliest in the movepool, so an agent holding Roost and Safeguard always
  // roosted no matter what the fight actually needed.
  let move: MoveSpec | undefined;
  let best = 0;
  for (const candidate of candidates) {
    const value = combatUtilityValue(world, agent, opponent, candidate);
    if (value > best) {
      best = value;
      move = candidate;
    }
  }
  if (!move) return false;
  if (rng() >= COMBAT_UTILITY_USE_CHANCE) return false;

  useMove(agent, move, world.tick);

  if (move.selfHeal && agent.hp !== undefined && agent.maxHp !== undefined) {
    let fraction = move.selfHeal.fraction;
    if (move.selfHeal.sunbeamBonus && isNearSunbeam(world, agent.pos)) fraction += move.selfHeal.sunbeamBonus;
    agent.hp = Math.min(agent.maxHp, agent.hp + agent.maxHp * fraction);
  }
  for (const change of resolveStatChangesOnHit(move).filter((c) => c.target === "self")) {
    applyStatStage(agent, change.stat, change.stage, change.ticks);
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

  // The three effect families below were applied by the OUT-of-combat path
  // and silently dropped by this one, which is why a status tree only ever
  // had three usable levers: heal yourself, buff yourself, ward off status.
  // Everything a support move exists to do — patch up a herd-mate mid-fight,
  // take something off the thing attacking you, change the weather the fight
  // is happening in — was dead the moment a fight started.
  const allyEffect = resolveAllyEffect(move);
  if (allyEffect) {
    const ally = nearestAllyEffectTarget(world, agent, move);
    if (ally) applyAllyEffect(world, agent, ally, allyEffect, log);
  }

  if (move.drainNeeds) {
    const targets = agentsWithin(world, agent, move.drainNeeds.radius).filter(
      (other) => other.herdId === undefined || other.herdId !== agent.herdId
    );
    const target = nearest(agent, targets);
    if (target) {
      const { need, amount } = move.drainNeeds;
      target.needs[need] = Math.max(0, target.needs[need] - amount);
      agent.needs[need] = Math.min(1, agent.needs[need] + amount);
    }
  }

  if (move.spawnsRain) {
    spawnWeatherCellAt(world, log, agent.pos.x, agent.pos.y, move.weatherType ?? "rain", rng, {
      radiusBonus: move.weatherRadiusBonus,
      lifespanBonus: move.weatherLifespanBonus,
    });
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
