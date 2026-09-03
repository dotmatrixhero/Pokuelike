import type { Agent, HuntRules, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tickAgentAction, tickAgentNeeds } from "./needs.js";
import { growFlora, maybeDropSeed } from "./flora.js";

/**
 * Energy an agent needs to accumulate before it gets to act. Chosen against
 * the demo roster's actual `calculateStats` speed output at their spawned
 * levels (packages/data/src/scenario.ts): Bulbasaur lvl 5 -> 9, Pidgey lvl 5
 * -> 10, Diglett lvl 5 -> 14, Scyther lvl 8 -> 21, Venusaur lvl 20 -> 37.
 * At 40, the fastest of those (Venusaur) acts on nearly every tick
 * (37/40, effectively ~every 1.1 ticks) while the slowest (Bulbasaur) acts
 * roughly every 4-5 ticks (40/9) — a real, visible frequency gradient
 * without needing every existing need/behavior threshold in the codebase
 * (tuned for "one action = one tick") retuned at the same time. See
 * DESIGN.md's "Action economy" section for the full reasoning and what's
 * still open about it.
 */
export const ACTION_THRESHOLD = 40;

/**
 * Adds `speed` to `agent.actionEnergy` and returns whether that crosses
 * `ACTION_THRESHOLD` this tick. On a crossing, exactly `ACTION_THRESHOLD` is
 * subtracted and the remainder is clamped to at most `ACTION_THRESHOLD` —
 * an agent can only ever take one action per world tick, no matter how much
 * Speed it has, and no excess energy is banked toward a future double-action.
 * Exported (rather than kept private to tickWorld) so it's directly,
 * deterministically testable without needing a full agent/behavior fixture.
 */
export function accumulateActionEnergy(agent: Agent, speed: number): boolean {
  agent.actionEnergy = (agent.actionEnergy ?? 0) + speed;
  if (agent.actionEnergy < ACTION_THRESHOLD) return false;
  agent.actionEnergy -= ACTION_THRESHOLD;
  if (agent.actionEnergy > ACTION_THRESHOLD) agent.actionEnergy = ACTION_THRESHOLD;
  return true;
}

/**
 * An agent's real computed Speed stat drives action frequency. Agents with
 * no computed `stats` (bare test fixtures that don't set up a combat
 * profile, and reproduction.ts's newborns, which don't get a stat block at
 * birth yet — see TODO.md) fall back to `ACTION_THRESHOLD` itself, i.e. they
 * act every tick, matching the sim's pre-action-economy behavior rather than
 * being silently slowed down by missing data they were never meant to carry.
 */
function actionSpeedOf(agent: Agent): number {
  return agent.stats?.speed ?? ACTION_THRESHOLD;
}

// A plain function call (rather than an inline `agent.alive === false` check)
// so TS's control-flow narrowing doesn't lock `agent.alive`'s type down
// across the loop body — it's still reassigned by tickAgentAction/predation.ts
// further down in the same iteration.
function isDead(agent: Agent): boolean {
  return agent.alive === false;
}

/**
 * Advances the whole world by one tick. Shared by the browser app and the
 * headless runner. Agents killed this tick (see predation.ts) are pruned
 * from World.agents afterward, so a kill's own tick still sees the victim.
 * A newborn (see reproduction.ts) pushed mid-loop may itself get ticked
 * once more in the same call, since array iteration picks up appended
 * elements — harmless, just means a same-tick newborn can already be at
 * age 1 by the time this returns.
 *
 * Speed-driven action economy (see DESIGN.md): need decay/aging/cooldowns
 * (`tickAgentNeeds`) run for every living agent every tick regardless of
 * Speed; behavior choice, movement, and attacks (`tickAgentAction`) only run
 * on an agent's action tick, gated by `accumulateActionEnergy`.
 */
export function tickWorld(world: World, log?: EventLog, rules?: HuntRules): void {
  world.tick += 1;
  for (const agent of world.agents) {
    if (isDead(agent)) continue;

    tickAgentNeeds(agent);

    const acted = accumulateActionEnergy(agent, actionSpeedOf(agent));
    if (!acted) continue;

    const before = { x: agent.pos.x, y: agent.pos.y };
    const beforeLayer = agent.layer;
    tickAgentAction(world, agent, log, rules);
    if (!isDead(agent) && agent.layer === beforeLayer && (agent.pos.x !== before.x || agent.pos.y !== before.y)) {
      maybeDropSeed(world, agent.layer, agent.pos, log);
    }
  }
  growFlora(world, log);
  if (world.agents.some((agent) => agent.alive === false)) {
    world.agents = world.agents.filter((agent) => agent.alive !== false);
  }
}
