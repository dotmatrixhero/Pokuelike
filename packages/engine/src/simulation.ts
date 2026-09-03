import type { Agent, HuntRules, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tickAgentAction, tickAgentNeeds } from "./needs.js";
import { growFlora, maybeDropSeed } from "./flora.js";
import { updateHerdMigrations } from "./herdMigration.js";
import type { LevelingContext } from "./leveling.js";
import { CORPSE_PERSIST_TICKS, effectiveSpeed, movementSpeedFactor } from "./support.js";
import { tileAt } from "./world.js";

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
 *
 * Injury lowers effective Speed on top of that (support.ts's
 * `effectiveSpeed`, floored at `FAINT_SPEED_FLOOR`) — a hurt agent acts less
 * often, not just weaker when it does. See DESIGN.md's "Faint/finish-off,
 * heal over time" section.
 *
 * Elevation/terrain from the agent's last real step (`agent.terrainSpeedFactor`,
 * support.ts's `movementSpeedFactor`) multiplies base Speed *before* the
 * injury fraction is applied — see `movementSpeedFactor`'s doc comment for
 * the exact composition and why it's a post-move snapshot rather than a
 * predictive gate.
 */
function actionSpeedOf(agent: Agent): number {
  const baseSpeed = (agent.stats?.speed ?? ACTION_THRESHOLD) * (agent.terrainSpeedFactor ?? 1);
  return effectiveSpeed(agent, baseSpeed);
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
 * headless runner. A truly-dead agent (see predation.ts's `resolveHit` —
 * `alive: false`, the finishing pool exhausted) is NOT pruned this tick;
 * it persists as a corpse for `CORPSE_PERSIST_TICKS` (support.ts) before
 * `pruneStaleCorpses` removes it, a deliberate change from before this
 * feature (see that function's doc comment).
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
export function tickWorld(world: World, log?: EventLog, rules?: HuntRules, ctx?: LevelingContext): void {
  world.tick += 1;
  // Once per tick, not once per agent — see herdMigration.ts. Runs against
  // this tick's pre-move positions, which is fine: sustained-scarcity
  // detection is a slow-moving signal, not something that needs to react to
  // the exact order agents move in within the same tick.
  updateHerdMigrations(world, log);
  for (const agent of world.agents) {
    if (isDead(agent)) continue;

    tickAgentNeeds(agent, world, ctx, log);

    const acted = accumulateActionEnergy(agent, actionSpeedOf(agent));
    if (!acted) continue;

    const before = { x: agent.pos.x, y: agent.pos.y };
    const beforeLayer = agent.layer;
    const beforeElevation = tileAt(world, beforeLayer, before.x, before.y)?.elevation ?? 0;
    tickAgentAction(world, agent, log, rules, ctx);
    if (!isDead(agent) && agent.layer === beforeLayer && (agent.pos.x !== before.x || agent.pos.y !== before.y)) {
      const afterTile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
      agent.terrainSpeedFactor = movementSpeedFactor(beforeElevation, afterTile?.elevation ?? 0, afterTile?.terrain ?? "floor");
      maybeDropSeed(world, agent.layer, agent.pos, log);
    }
  }
  growFlora(world, log);
  pruneStaleCorpses(world);
}

/**
 * A true kill (`alive: false`, set in predation.ts's `resolveHit` once a
 * fainted agent's finishing pool is exhausted) doesn't vanish the same tick
 * anymore — it persists as an eatable, lootable corpse for
 * `CORPSE_PERSIST_TICKS` (support.ts) so agents other than whoever landed
 * the killing blow get a real scavenge/loot window, then gets pruned. A
 * real, deliberate behavior change from before this feature ("corpse
 * vanishes instantly") — anything elsewhere in the engine that iterates
 * `World.agents` needs to tolerate `alive === false` entries sticking around
 * for a while (predation.ts/reproduction.ts/needs.ts all already filter on
 * `alive !== false` rather than assuming dead agents are simply absent).
 */
function pruneStaleCorpses(world: World): void {
  const hasStale = world.agents.some(
    (agent) => agent.alive === false && world.tick - (agent.diedAtTick ?? world.tick) >= CORPSE_PERSIST_TICKS
  );
  if (!hasStale) return;
  world.agents = world.agents.filter(
    (agent) => agent.alive !== false || world.tick - (agent.diedAtTick ?? world.tick) < CORPSE_PERSIST_TICKS
  );
}
