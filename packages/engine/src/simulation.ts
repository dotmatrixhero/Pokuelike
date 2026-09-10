import type { Agent, HuntRules, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tickAgentAction, tickAgentNeeds } from "./needs.js";
import type { RegionDispersalContext } from "./dispersal.js";
import { growCanopyFood, growFlora, growUndergroundFlora, maybeDropSeed } from "./flora.js";
import { applyFireDamage, tickFires } from "./fire.js";
import { tickHerds } from "./herds.js";
import { decayShelters } from "./shelter.js";
import { tickEgg } from "./eggs.js";
import { updateHerdMigrations } from "./herdMigration.js";
import { maybeImmigrate, type ImmigrationContext } from "./immigration.js";
import type { LevelingContext } from "./leveling.js";
import { CORPSE_PERSIST_TICKS, activityScheduleMultiplier, aquaticHasteMultiplier, canopySpeedMultiplier, coldSnapSpeedMultiplier, effectiveSpeed, movementSpeedFactor } from "./support.js";
import { tileAt } from "./world.js";
import { isNight, lightLevel } from "./daynight.js";
import { advanceBiomeDrift, advanceWaterCycle, advanceWeather } from "./weather.js";
import { PARALYSIS_SPEED_MULTIPLIER, isParalyzed, getStatStage } from "./status.js";
import { statStageMultiplier } from "./combat.js";
import { updateNotables } from "./notables.js";
import { updateHerdLeadership } from "./herdLeadership.js";
import { recordDeathWitnesses } from "./witness.js";
import { applyPlayerAction, findPlayer, tickTorch } from "./player.js";
import { updatePlayerVision } from "./vision.js";
import { tickHarvestRegrowth } from "./harvest.js";
import { canEnterWater, canEnterLand } from "./waterBody.js";
import { canFlyOverObstacle } from "./movement.js";

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
 * How much an agent's computed Speed still drives its action frequency,
 * applied in `actionSpeedOf` as `ACTION_THRESHOLD * (speed /
 * ACTION_THRESHOLD) ** SPEED_ACTION_COMPRESSION` — 1 would be today's
 * uncompressed behavior (pure Speed, linear); lower narrows the gap between
 * a fast and a slow agent's action rate without erasing it. Direct ask,
 * after watching a much-faster Arbok land two Sludge hits before a slower
 * Ivysaur got a single action: "tweak the speed to action economy tick calc
 * to be a little less influential. To give Pokémon who are weaker a chance
 * to actually escape or use a move."
 *
 * A power on the *ratio* to `ACTION_THRESHOLD`, not a flat additive floor —
 * it leaves speed 0 at 0 (a genuinely stat-less agent isn't granted false
 * actions), and leaves speed `ACTION_THRESHOLD` exactly fixed (an agent
 * already "acting every tick" at 1:1 stays there), while everything below
 * that pivot gets pulled disproportionately upward the slower it already
 * was — because raising a fraction below 1 to a power below 1 moves it
 * closer to 1, and moves it further the smaller the fraction started out.
 * Worked example against this file's own demo-roster numbers above: raw
 * Bulbasaur/Venusaur action-rate ratio 37/9 ≈ 4.11x narrows to roughly
 * 37.6/12.1 ≈ 3.11x at 0.8 — Bulbasaur still acts markedly less often, but
 * the gap closes by about a quarter, not to zero. Applied uniformly to
 * every multiplier this function already composes (paralysis, injury,
 * terrain, and the rest) rather than singled out to base Speed alone —
 * simpler, and it's the *net* frequency gap between two agents this was
 * asked to soften, not just the raw stat's share of it.
 */
export const SPEED_ACTION_COMPRESSION = 0.8;

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
 *
 * A third, independent multiplier composes the same way: an agent caught
 * active outside its `activityPattern`'s preferred day/night window
 * (support.ts's `activityScheduleMultiplier`) is also slower — see
 * DESIGN.md's "Dynamics that move a content herd" section, Phase 2.
 *
 * A fourth, same-pattern multiplier: an agent caught in an active cold-snap
 * weather cell (support.ts's `coldSnapSpeedMultiplier`, weather.ts's Phase
 * 3) is slower too, flat across every species — see that function's doc
 * comment for why.
 *
 * A fifth: paralysis (`status.ts`'s `PARALYSIS_SPEED_MULTIPLIER`) — the
 * *permanent, real-time* half of what paralysis does, independent of its
 * separate per-action-tick skip-chance roll in `tickAgentAction`
 * (needs.ts).
 *
 * A sixth: the `"aquaticHaste"` passive (support.ts's
 * `aquaticHasteMultiplier`) — a real Speed bonus for a same-herd agent
 * standing on water near whoever holds the passive, itself included. First
 * real content: Hydro Pump's Tidal Communion keystone.
 *
 * Order doesn't matter for a product of multipliers, but for the record:
 * terrain, then off-hours, then cold snap, then aquatic haste, then
 * paralysis, then injury last. Exported (like `accumulateActionEnergy`) so
 * it's directly testable without needing a full `tickWorld` pass.
 */
export function actionSpeedOf(world: World, agent: Agent, tick: number): number {
  const baseSpeed =
    (agent.stats?.speed ?? ACTION_THRESHOLD) *
    (agent.terrainSpeedFactor ?? 1) *
    activityScheduleMultiplier(agent.activityPattern, tick) *
    coldSnapSpeedMultiplier(world, agent.layer, agent.pos) *
    canopySpeedMultiplier(agent.layer) *
    aquaticHasteMultiplier(world, agent) *
    (isParalyzed(agent) ? PARALYSIS_SPEED_MULTIPLIER : 1) *
    // A temporary Speed stat-stage grant (e.g. `MoveSpec.statChangeOnHit`'s
    // self-side effect, or utilityMoves.ts's Agility) composes here, same
    // machinery `calculateDamage`'s Attack/Defense stages already use
    // (combat.ts's `statStageMultiplier`). The base "speed" STAT was
    // already the real input to this whole function (and has been since
    // `actionSpeedOf` existed) — what's new is the temporary STAGE on top
    // of it: `getStatStage`/`statStageMultiplier` had a real consumer for
    // Attack/Defense before this line, but nothing ever read a Speed stage
    // specifically, so a landed Agility (or any other speed-stage grant)
    // had no way to actually change how often its user acts.
    statStageMultiplier(getStatStage(agent, "speed"));
  const speed = effectiveSpeed(agent, baseSpeed);
  // See `SPEED_ACTION_COMPRESSION`'s own doc comment for why this is a
  // power on the ratio to `ACTION_THRESHOLD`, not a flat floor.
  return ACTION_THRESHOLD * Math.pow(Math.max(0, speed) / ACTION_THRESHOLD, SPEED_ACTION_COMPRESSION);
}

/** The eight neighbors (orthogonal first, then diagonal), fixed order — deterministic, no rng, matching this codebase's "same seed, same result" requirement. See `resolveTileOverlaps`. */
const OVERLAP_RESOLVE_OFFSETS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/**
 * Direct ask, after watching a fainted Scyther and a fleeing Diglett
 * visibly sharing a tile mid-fight: "avoid units on the same tile
 * altogether... everywhere, always." `stopAdjacent`/capacity-aware
 * `stepToward`/`stepAway` (movement.ts, threaded through most of the
 * engine's own movement call sites) already stop a *deliberate* step from
 * landing on an occupied tile — but a few genuinely-unconditional position
 * snaps still exist (dispersal/migration arrival when nothing else claimed
 * the spot first, birth/hatch/immigration placement), plus
 * occupancy.ts's own documented same-tick race: two agents that each
 * independently pick the same currently-empty tile in the same tick both
 * see the same tick-start snapshot and can both be admitted at once.
 * Rather than chase every direct `agent.pos =` assignment across the engine
 * individually (a wide, ever-growing surface as new features add new ones),
 * this is a single, cheap, once-per-tick correction pass, run right after
 * every agent has acted (see `tickWorld`): for any tile still holding more
 * than one living, uncarried occupant, every occupant but one gets nudged
 * onto the nearest free orthogonal neighbor.
 *
 * An egg, if present, is always the one left in place — eggs are stationary
 * by design (eggs.ts's own doc comment); a living agent that ended up
 * sharing its tile is the one that moves. Otherwise the lowest `id` stays
 * put, the same deterministic tie-break `herdRank`/`nearestCrowdingHerdmate`
 * already use elsewhere. Shelter tiles are exempt — the multi-occupant
 * "den" rule (`SHELTER_TILE_ADULT_CAP`/`_EGG_CAP`, occupancy.ts) is a
 * separate, still-deliberate feature this pass was never meant to unwind.
 *
 * Checks the 8 neighbors (orthogonal, then diagonal), not a wider search —
 * real overlaps are almost always between a small handful of agents with
 * open space nearby; a tile with no free neighbor at all (fully boxed in)
 * is left as-is, a rare, accepted edge case rather than a reason to search
 * further.
 *
 * Deliberately builds its own live `occupied` set from every agent's
 * CURRENT position, rather than reusing `occupancy.ts`'s `canEnterTile`/
 * cached index — that cache is a tick-START snapshot (by design, see its
 * own doc comment), already stale by the time this runs at the END of the
 * same tick, after every agent has already potentially moved. Checking
 * candidates against the stale cache here would misjudge which neighbors
 * are actually free right now, undermining the very thing this pass exists
 * to guarantee.
 */
export function resolveTileOverlaps(world: World): void {
  const byKey = new Map<string, Agent[]>();
  const occupied = new Set<string>();
  for (const agent of world.agents) {
    if (agent.alive === false || agent.beingCarriedBy) continue;
    const key = `${agent.layer}:${agent.pos.x},${agent.pos.y}`;
    if (tileAt(world, agent.layer, agent.pos.x, agent.pos.y)?.terrain === "shelter") continue;
    occupied.add(key);
    const list = byKey.get(key);
    if (list) list.push(agent);
    else byKey.set(key, [agent]);
  }

  for (const occupants of byKey.values()) {
    if (occupants.length <= 1) continue;
    occupants.sort((a, b) => {
      if (a.isEgg !== b.isEgg) return a.isEgg ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    for (const agent of occupants.slice(1)) {
      for (const offset of OVERLAP_RESOLVE_OFFSETS) {
        const candidate = { x: agent.pos.x + offset.x, y: agent.pos.y + offset.y };
        const candidateKey = `${agent.layer}:${candidate.x},${candidate.y}`;
        if (occupied.has(candidateKey)) continue;
        const tile = tileAt(world, agent.layer, candidate.x, candidate.y);
        // Never nudge someone onto shelter terrain via this mechanism — that
        // tile kind has its own separate, capacity-aware entry path
        // (occupancy.ts's `canEnterShelter`); simplest to just leave it to
        // that path rather than duplicate its rules here.
        if (!tile || tile.terrain === "shelter") continue;
        if (!tile.walkable && !canFlyOverObstacle(agent, agent.layer)) continue;
        if (!canEnterWater(world, agent, agent.layer, candidate)) continue;
        if (!canEnterLand(world, agent, agent.layer, candidate)) continue;
        agent.pos = candidate;
        occupied.add(candidateKey);
        break;
      }
    }
  }
}

// A plain function call (rather than an inline `agent.alive === false` check)
// so TS's control-flow narrowing doesn't lock `agent.alive`'s type down
// across the loop body — it's still reassigned by tickAgentAction/predation.ts
// further down in the same iteration.
function isDead(agent: Agent): boolean {
  return agent.alive === false;
}

/**
 * The turn gate — ROADMAP.md's M0. Queues `action` on the player and runs
 * world ticks until it has been consumed, i.e. until the player's action
 * energy came round. A fast human spends one tick per step; a slow one lets
 * the world move several ticks between its steps. Other agents act at their
 * own rates inside those ticks, unchanged.
 *
 * `maxTicks` is a guard, not a tuning knob: with `ACTION_THRESHOLD` = 40 and
 * any sane speed the action lands within a handful of ticks, so hitting the
 * cap means something is wrong (a dead player, a zero speed) and the caller
 * should not spin. Returns the number of ticks advanced.
 */
export function advancePlayerTurn(
  world: World,
  action: import("./types.js").PlayerAction,
  log?: EventLog,
  rules?: HuntRules,
  ctx?: LevelingContext,
  rng: () => number = world.rng,
  immigration?: ImmigrationContext,
  maxTicks = 50,
): number {
  const player = findPlayer(world);
  if (!player) return 0;
  player.queuedAction = action;
  let ticks = 0;
  while (player.queuedAction && ticks < maxTicks && player.alive !== false) {
    tickWorld(world, log, rules, ctx, rng, immigration);
    ticks++;
  }
  // What the player sees when it is their turn again — after the world has
  // moved, not before. See vision.ts.
  if (player.alive !== false) updatePlayerVision(world, player);
  return ticks;
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
 * Speed-driven action economy (see DESIGN.md): need decay/aging
 * (`tickAgentNeeds`) run for every living agent every tick regardless of
 * Speed; behavior choice, movement, attacks, and move-cooldown recovery
 * (`tickAgentAction`) only run on an agent's own action tick, gated by
 * `accumulateActionEnergy` — a move's `cooldownTicks` counts down in that
 * agent's own turns, not world ticks.
 */
/**
 * `rng` defaults to `world.rng` (the seeded generator `createWorld`/
 * `generateWorld` always attach — see types.ts's `World.rng` doc comment),
 * not `Math.random` — this is the one place that matters most: every real
 * simulation run goes through here, so this default is what actually makes
 * a run reproducible from its seed without every caller needing to remember
 * to pass `world.rng` explicitly. A caller can still override it (tests
 * that want a different/fixed generator without touching `world.rng`
 * itself), matching the existing `log`/`rules`/`ctx` optional-override
 * convention.
 *
 * `regionDispersal` (absent for every plain single-`World` caller) lets a
 * triggered natal dispersal target a neighboring region instead of a random
 * point on this map — see dispersal.ts's `RegionDispersalContext`. Only
 * `overworld.ts`'s `tickOverworld` ever supplies one, and only for the
 * currently-focused region's own call.
 */
export function tickWorld(
  world: World,
  log?: EventLog,
  rules?: HuntRules,
  ctx?: LevelingContext,
  rng: () => number = world.rng,
  immigration?: ImmigrationContext,
  regionDispersal?: RegionDispersalContext
): void {
  const previousTick = world.tick;
  world.tick += 1;
  // Once per tick, not once per agent — the day/night cycle is a world-level
  // clock, not something each agent computes independently. Comparing the
  // previous tick's phase to this one's is enough to catch the exact tick a
  // transition happens on without needing any extra persisted world state —
  // see daynight.ts/DESIGN.md's Phase 2.
  const wasNight = isNight(previousTick);
  const nowNight = isNight(world.tick);
  if (nowNight !== wasNight) {
    log?.record({ kind: nowNight ? "nightfall" : "daybreak", tick: world.tick, lightLevel: lightLevel(world.tick) });
  }
  // Once per tick, not once per agent — a world-level system, the same
  // "advance the shared clock/weather once, not per-agent" style as the
  // day/night block above. Runs before `updateHerdMigrations` so this
  // tick's storm-exposure check (herdMigration.ts's `"weather"` trigger)
  // sees this tick's weather state, not last tick's stale one — see
  // weather.ts/DESIGN.md's Phase 3.
  advanceWeather(world, log, rng);
  // Once per tick, not once per agent — see herdMigration.ts. Runs against
  // this tick's pre-move positions, which is fine: sustained-scarcity
  // detection is a slow-moving signal, not something that needs to react to
  // the exact order agents move in within the same tick.
  updateHerdMigrations(world, log, rng, regionDispersal);
  // Once per tick, not once per agent — same "world-level system, one pass"
  // shape as `updateHerdMigrations` above (see immigration.ts). A newly
  // arrived immigrant pushed here is picked up by this same tick's agent
  // loop below, same as a same-tick newborn (see this function's own doc
  // comment) — harmless, just means an immigrant can already act once
  // before this call returns.
  maybeImmigrate(world, immigration, log, rng);
  for (const agent of world.agents) {
    if (isDead(agent)) continue;
    // Eggs (`Agent.isEgg`) are stationary and behavior-less — routed
    // straight to `eggs.ts`'s `tickEgg` (incubation/hatch) instead of the
    // ordinary needs-decay/action-economy pipeline, which would otherwise
    // starve/move/act an egg the same as any other agent. See eggs.ts's
    // top-of-file doc comment.
    if (agent.isEgg) {
      tickEgg(world, agent, log, ctx, rng);
      continue;
    }

    tickAgentNeeds(agent, world, ctx, log, rng);

    const acted = accumulateActionEnergy(agent, actionSpeedOf(world, agent, world.tick));
    if (!acted) continue;

    const before = { x: agent.pos.x, y: agent.pos.y };
    const beforeLayer = agent.layer;
    const beforeElevation = tileAt(world, beforeLayer, before.x, before.y)?.elevation ?? 0;
    if (agent.controlledBy === "player") {
      tickTorch(world, agent);
      // Input decides, not the behaviour tree — see player.ts. If nothing is
      // queued the turn is simply held: energy stays banked at threshold
      // (accumulateActionEnergy caps it), so the world is effectively paused
      // for this agent until the UI queues something and ticks again.
      if (agent.queuedAction) {
        applyPlayerAction(world, agent, agent.queuedAction, log, ctx, rng);
        agent.queuedAction = undefined;
      } else {
        agent.actionEnergy = ACTION_THRESHOLD;
      }
    } else {
      tickAgentAction(world, agent, log, rules, ctx, rng, regionDispersal);
    }
    if (!isDead(agent) && agent.layer === beforeLayer && (agent.pos.x !== before.x || agent.pos.y !== before.y)) {
      const afterTile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
      agent.terrainSpeedFactor = movementSpeedFactor(beforeElevation, afterTile?.elevation ?? 0, afterTile?.terrain ?? "floor");
      maybeDropSeed(world, agent.layer, agent.pos, log, rng);
    }
  }
  // Once per tick, after every agent has acted — see `resolveTileOverlaps`'s
  // own doc comment for why this exists on top of `stopAdjacent`/capacity-
  // aware stepping rather than instead of it.
  resolveTileOverlaps(world);
  // Before growFlora, so a tile that burned out this tick is already
  // scorched "floor" when the flora pass considers regrowth — fire clears
  // ground first, then the world decides what grows back into it.
  // Once per tick, not once per agent, same as growFlora below.
  // Once per tick, not once per agent — registers new herds, tracks peak
  // size, and closes out herds whose last member died. Same world-level slot
  // as growFlora below.
  tickHerds(world, log);
  tickFires(world, log, rng);
  applyFireDamage(world, log, rng);
  // Once per tick, after every system that can kill has run (the agent loop
  // above, plus applyFireDamage immediately before) and before
  // `pruneStaleCorpses` below removes this tick's corpses — see witness.ts.
  // Reads `Agent.diedAtTick` rather than the event log, deliberately: `log`
  // here is optional, and a mechanic that quietly stops working when nobody
  // passes a logger is how a test ends up passing for the wrong reason.
  recordDeathWitnesses(world, rng);
  tickHarvestRegrowth(world);
  growFlora(world, log, rng);
  // Once per tick, not once per agent — same "world-level system, one pass"
  // shape as growFlora above, its Underground counterpart: real crops
  // (Potato/Pumpkin) down there now regrow and spread too instead of just
  // decaying after worldgen — see flora.ts's own doc comment on
  // growUndergroundFlora for why it's a genuine second copy of the loop
  // rather than growFlora reused.
  growUndergroundFlora(world, log, rng);
  // Once per tick, not once per agent — same "world-level system, one pass"
  // shape as growFlora above, its own much smaller Canopy-only counterpart
  // (real growth-stage rendering, CROPS_DESIGN.md) — see flora.ts's own doc
  // comment on why this is a genuinely separate pass, not growFlora reused.
  growCanopyFood(world);
  // Once per tick, not once per agent — same "world-level system, one pass"
  // shape as growFlora above: sustained drought/rain drying out or forming
  // water tiles (see weather.ts's `advanceWaterCycle` doc comment).
  advanceWaterCycle(world, log, rng);
  // Once per tick, not once per agent — same "world-level system, one pass"
  // shape as growFlora above, except a plain deterministic accumulator (no
  // rng draw) rather than a chance roll — see weather.ts's `advanceBiomeDrift`
  // doc comment.
  advanceBiomeDrift(world);
  // Once per tick, not once per agent — same "world-level system, one pass"
  // shape as growFlora above (see shelter.ts's `decayShelters`).
  decayShelters(world, log);
  pruneStaleCorpses(world);
  // Once per tick, not per triggering event — see notables.ts's top-of-file
  // doc comment for why a single per-tick scan covers every title's
  // transfer condition (new claim, dethroning, and holder-died-so-transfer)
  // more simply than a bespoke hook at each of the four separate trigger
  // sites plus a second periodic scan for the three "currently highest"
  // titles (rival/elder/wanderer).
  updateNotables(world, log, ctx, rng);
  // Herd Leadership builds directly on Notables — must run strictly after
  // updateNotables so a title lost/claimed THIS tick is already reflected in
  // `Agent.notableTitle` before leadership eligibility is re-checked. See
  // herdLeadership.ts's top-of-file doc comment.
  updateHerdLeadership(world, log);
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
