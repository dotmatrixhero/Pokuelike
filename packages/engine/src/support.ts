import type { ActivityPattern, Agent, HuntRules, InventoryItem, Layer, TerrainKind, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { logBehaviorChange } from "./events.js";
import { stepToward } from "./movement.js";
import { tileAt } from "./world.js";
import { CONSUME_STOCK_AMOUNT } from "./flora.js";
import { isNight, isTwilight } from "./daynight.js";
import { agentsWithin, isHunterSpecies, manhattan, nearest, FALLBACK_MAX_HP, FLEE_DETECT_RADIUS } from "./predation.js";
import { findNearestIndexed } from "./resourceIndex.js";
import { COLD_SNAP_SPEED_MULTIPLIER, isInColdSnap } from "./weather.js";
import { useMove, withinMoveRange } from "./combat.js";

/**
 * Faint/finish-off, heal-over-time, and herd support (inventory, food
 * delivery, carrying). See DESIGN.md's section of the same name for the full
 * design; this file holds every tuning constant it introduces plus the
 * logic that isn't `resolveHit` itself (predation.ts owns the faint/finish
 * transition since it's a natural extension of the existing hit-resolution
 * code there; this file owns everything downstream of that state).
 */

// --- Tuning constants, all sim-original guesses to be judged against a real run (see DESIGN.md) ---

/** Never let injury drop effective Speed below this fraction of base — a badly hurt agent should act less, not go fully inert. */
export const FAINT_SPEED_FLOOR = 0.35;
/** Per-tick heal, as a fraction of maxHp, while fed/watered. ~1%/tick means a full heal from 0 takes on the order of 100 ticks — see DESIGN.md's real-run findings for whether that's actually observed as sane. */
export const HEAL_PER_TICK_FRACTION = 0.01;
/**
 * "Reasonably fed/watered" gate for heal-over-time and for starting herd
 * food delivery. Deliberately reuses `chooseBehavior`'s existing urgency
 * cutoff in needs.ts (a need only drives behavior once its urgency — `1 -
 * need` — exceeds 0.3, i.e. the need itself is below 0.7) rather than
 * inventing a second, unrelated "satisfied" concept.
 */
export const FED_THRESHOLD = 0.7;
/** Size of the finishing pool at the moment of fainting, as a fraction of maxHp. */
export const FINISHING_POOL_FRACTION = 0.75;
/** HP fraction a fainted agent must heal back up to before it wakes on its own, discarding the finishing pool. Picked mid-range of the "~15-20%" the design calls for. */
export const WAKE_HP_FRACTION = 0.18;
/** Ticks a true corpse stays in World.agents (eatable/lootable) before being pruned. */
export const CORPSE_PERSIST_TICKS = 40;

/**
 * Weight/capacity proxy: maxHp, not a full six-stat total or an imported
 * body-weight figure. Explicit scope call (see DESIGN.md point 9) — pulling
 * real species height/weight would mean extending the importer again
 * (`poke_the_spire` has it, like `baseExp`/`levelMoves` before it), which
 * wasn't judged worth a second importer pass for this feature. maxHp is
 * already computed on every combat-capable agent, needs no extra data, and
 * correlates with bulk about as well as a stat total would (a Venusaur
 * should plausibly carry/weigh more than a Diglett, and it does under this
 * proxy). Agents with no computed stats (bare fixtures, newborns) fall back
 * to `FALLBACK_MAX_HP`/`FALLBACK_CARRY_CAPACITY` — the same graceful-absence
 * pattern as `actionSpeedOf` in simulation.ts.
 */
export const FALLBACK_CARRY_CAPACITY = 8;
const CARRY_CAPACITY_PER_MAXHP = 1.5;

/** A simple carried food unit's weight — small relative to any real agent's carry capacity. */
export const FOOD_ITEM_WEIGHT = 1;
export const FOOD_ITEM_KEY = "food";
/** Restores the same amount as self-feeding (`CONSUME_RATE.seekFood` in needs.ts) — delivered food should feel identical to eating it yourself. */
const DELIVERED_FOOD_HUNGER_RESTORE = 0.4;
/** Below this hunger, a herd-mate is "hungry enough to help" for delivery purposes — a bit more lenient than seekFood's own 0.7 trigger since delivery is opportunistic, not urgent. */
const HUNGRY_HERDMATE_THRESHOLD = 0.4;
/** How far a well-fed herd-mate will notice a hungry ally to help, and a carrier will look for an adjacent fainted ally. */
const HERD_SUPPORT_RADIUS = 8;
const LOOT_RADIUS = 1;
const ADJACENT_RADIUS = 1;
/** How close "home" counts as "arrived" for a carrier. */
const CARRY_ARRIVAL_RADIUS = 1;

// --- Status queries ---

/** True death: the only state that makes an agent eatable/lootable-as-a-corpse and prunable. */
export function isTrulyDead(agent: Agent): boolean {
  return agent.alive === false;
}

/** Downed but not dead: excluded from the action tick, but still needs-decays/heals, and can be looted (not eaten) or carried. */
export function isFainted(agent: Agent): boolean {
  return agent.alive !== false && agent.fainted === true;
}

function isFedAndWatered(agent: Agent): boolean {
  return agent.needs.hunger >= FED_THRESHOLD && agent.needs.thirst >= FED_THRESHOLD;
}

/**
 * Exported (previously module-private) so `occupancy.ts`'s tile-capacity
 * rule can point back to this as the canonical "how much does this agent
 * weigh" convention in its own doc comments — see that module's writeup for
 * why it keeps a small local duplicate of this exact formula instead of
 * importing it directly (a real import would close a circular-dependency
 * loop through movement.ts).
 */
export function bodyWeightOf(agent: Agent): number {
  return agent.maxHp ?? FALLBACK_MAX_HP;
}

/** How much an agent can carry — items plus, if it's currently carrying a fainted ally, that ally's body weight. */
export function carryCapacityOf(agent: Agent): number {
  if (agent.maxHp === undefined) return FALLBACK_CARRY_CAPACITY;
  return agent.maxHp * CARRY_CAPACITY_PER_MAXHP;
}

function inventoryWeight(agent: Agent): number {
  return (agent.inventory ?? []).reduce((sum, item) => sum + item.weight, 0);
}

/** Total weight currently occupying `agent`'s carry capacity: its inventory plus any fainted ally it's physically carrying. */
export function usedCarryWeight(world: World, agent: Agent): number {
  let used = inventoryWeight(agent);
  if (agent.carryingId) {
    const carried = world.agents.find((a) => a.id === agent.carryingId);
    if (carried) used += bodyWeightOf(carried);
  }
  return used;
}

function remainingCarryCapacity(world: World, agent: Agent): number {
  return carryCapacityOf(agent) - usedCarryWeight(world, agent);
}

// --- Injury -> effective Speed ---

/**
 * Scales `baseSpeed` down by current HP fraction, floored at
 * `FAINT_SPEED_FLOOR` so a badly hurt (or freshly-fainted, hp === 0) agent
 * still gets *some* chance to act rather than going fully inert. Agents
 * without real hp/maxHp (bare fixtures) are unaffected — matches
 * `actionSpeedOf`'s existing graceful-absence behavior in simulation.ts.
 */
export function effectiveSpeed(agent: Agent, baseSpeed: number): number {
  if (agent.hp === undefined || agent.maxHp === undefined || agent.maxHp <= 0) return baseSpeed;
  const fraction = Math.max(FAINT_SPEED_FLOOR, agent.hp / agent.maxHp);
  return baseSpeed * fraction;
}

// --- Elevation/terrain -> effective movement speed (see DESIGN.md's "Environmental generation..." section) ---

/**
 * Sand/mud/boulder slow movement; every other terrain kind is neutral.
 * Boulder is the slowest of the three (0.4) — direct ask: "boulders being
 * so blocking... if anything it should cost movement speed to get past
 * 'em" — real rock is harder to scramble over than mud is to wade through.
 * Composes multiplicatively with `elevationSpeedMultiplier` below, so a
 * boulder placed on genuinely higher ground (see worldgen.ts's boulder
 * elevation bump) costs even more than this flat number alone. Sim-original
 * magnitudes, not canon.
 */
const TERRAIN_SPEED_MULTIPLIER: Partial<Record<TerrainKind, number>> = { sand: 0.75, mud: 0.5, boulder: 0.4 };

/** The flat per-terrain-kind multiplier for whichever tile an agent just moved onto. 1 (neutral) for anything not in the table above. */
export function terrainSpeedMultiplier(terrain: TerrainKind): number {
  return TERRAIN_SPEED_MULTIPLIER[terrain] ?? 1;
}

/** How much effective speed one unit of elevation gain/loss is worth, per step taken. */
const ELEVATION_SPEED_PER_UNIT = 0.06;
/** Floors/caps so a single very steep step can't zero out an agent's speed or double it outright. */
const MIN_ELEVATION_SPEED_MULTIPLIER = 0.4;
const MAX_ELEVATION_SPEED_MULTIPLIER = 1.5;

/**
 * Moving to a higher tile than the one an agent just left costs speed (the
 * multiplier drops below 1); moving to a lower one is a discount (above 1).
 * Flat ground (delta 0) is neutral. Sim-original magnitude/shape — not
 * canon, a genuine design call for this feature — clamped at both ends so
 * neither a cliff nor a chasm is a literal "never acts again"/"acts twice."
 */
export function elevationSpeedMultiplier(fromElevation: number, toElevation: number): number {
  const delta = toElevation - fromElevation;
  const multiplier = 1 - delta * ELEVATION_SPEED_PER_UNIT;
  return Math.max(MIN_ELEVATION_SPEED_MULTIPLIER, Math.min(MAX_ELEVATION_SPEED_MULTIPLIER, multiplier));
}

/**
 * The combined elevation+terrain multiplier for the step an agent just took,
 * as one number — called once right after movement (simulation.ts's
 * `tickWorld`) and stashed on `agent.terrainSpeedFactor` until the agent's
 * next move overwrites it. Composes **multiplicatively** with the existing
 * injury-based `effectiveSpeed`, applied in that order: `actionSpeedOf`
 * (simulation.ts) multiplies base Speed by this factor first, then hands
 * the result to `effectiveSpeed`'s HP-fraction scaling — i.e.
 * `finalSpeed = baseSpeed * elevationSpeedMultiplier * terrainSpeedMultiplier * injuryFraction(floored)`.
 * A badly hurt agent trudging uphill through mud is slower on both axes at
 * once, not just whichever one is worse.
 *
 * Deliberately a *post-move* snapshot rather than gating the move that
 * produced it: Speed is spent to decide whether an action happens before
 * that action's movement is even chosen (see simulation.ts's
 * `accumulateActionEnergy`), so a genuinely predictive "this step will be
 * slow, don't let it happen yet" isn't available without restructuring that
 * order — a scope call forced by the existing architecture, not a design
 * preference. The qualitative effect (climb slows you down, descend speeds
 * you up, rough ground is generally slower) still shows up in a real run,
 * just applied to the *next* action rather than the one just taken.
 */
/**
 * The canopy is meant to be genuinely easy to move through — real branch-
 * to-branch travel, not the same trudge-across-open-ground pace as the
 * surface — direct ask: "canopy should be super easy to move around in
 * anywhere." A flat, generous boost rather than terrain/elevation-shaped
 * (the layer has no terrain variety or elevation at all — see
 * `createDemoWorld`'s doc comment, a pure flat floor grid), applied as its
 * own independent multiplicative term in `actionSpeedOf` (simulation.ts)
 * rather than folded into `movementSpeedFactor` (which is specifically the
 * per-*step* elevation/terrain effect, snapshotted onto
 * `Agent.terrainSpeedFactor` — this is a standing property of the layer
 * itself, checked fresh every tick instead). Sim-original magnitude, judge
 * against a real run like every other tuning constant here.
 */
export const CANOPY_SPEED_MULTIPLIER = 2;

/** 1 (neutral) everywhere except the canopy, which gets `CANOPY_SPEED_MULTIPLIER` — see its doc comment. */
export function canopySpeedMultiplier(layer: Layer): number {
  return layer === "canopy" ? CANOPY_SPEED_MULTIPLIER : 1;
}

export function movementSpeedFactor(fromElevation: number, toElevation: number, toTerrain: TerrainKind): number {
  return elevationSpeedMultiplier(fromElevation, toElevation) * terrainSpeedMultiplier(toTerrain);
}

// --- Day/night activity pattern -> effective Speed (see DESIGN.md's "Dynamics that move a content herd", Phase 2) ---

/**
 * The partial Speed multiplier applied to an agent caught active outside its
 * `activityPattern`'s preferred window — a real but not crippling penalty,
 * the same order of magnitude as `terrainSpeedMultiplier`'s sand/mud
 * penalties (0.75/0.5) rather than anything close to zero: this is "sluggish
 * off-hours," not "can't act at all," per DESIGN.md's explicit ask that a
 * nocturnal predator hunting by day is merely less effective, not disabled.
 * Sim-original magnitude, not canon.
 */
export const OFF_HOURS_SPEED_MULTIPLIER = 0.8;

/**
 * Composes multiplicatively with `movementSpeedFactor`'s elevation/terrain
 * modifier and `effectiveSpeed`'s injury fraction, applied third: see
 * simulation.ts's `actionSpeedOf`, which multiplies all three together (order
 * doesn't matter for a product, but that's the call site to look at for the
 * full chain). `"cathemeral"` (active any time — the default for anything
 * that doesn't set `activityPattern`) is always 1, exactly reproducing
 * pre-Phase-2 behavior for every existing species/fixture.
 *
 * Windows, using daynight.ts's `isNight`/`isTwilight`:
 *  - `"diurnal"`: full speed by day, penalized at night.
 *  - `"nocturnal"`: full speed at night, penalized by day.
 *  - `"crepuscular"`: full speed only during the two dawn/dusk twilight
 *    windows each cycle, penalized the rest of the time (day AND night) —
 *    a real, narrower "always somewhat off-schedule" species, matching how
 *    a genuinely crepuscular animal behaves.
 */
export function activityScheduleMultiplier(pattern: ActivityPattern | undefined, tick: number): number {
  switch (pattern ?? "cathemeral") {
    case "cathemeral":
      return 1;
    case "diurnal":
      return isNight(tick) ? OFF_HOURS_SPEED_MULTIPLIER : 1;
    case "nocturnal":
      return isNight(tick) ? 1 : OFF_HOURS_SPEED_MULTIPLIER;
    case "crepuscular":
      return isTwilight(tick) ? 1 : OFF_HOURS_SPEED_MULTIPLIER;
  }
}

// --- Cold snap -> effective Speed (see DESIGN.md's "Dynamics that move a content herd", Phase 3) ---

/**
 * The fourth composable Speed modifier in `simulation.ts`'s `actionSpeedOf`
 * chain (terrain/elevation, off-hours activity schedule, injury, and now
 * this — see `movementSpeedFactor`/`activityScheduleMultiplier`/
 * `effectiveSpeed`'s own doc comments for the first three). A flat penalty
 * for every agent caught in an active cold-snap weather cell (weather.ts),
 * regardless of species — see `COLD_SNAP_SPEED_MULTIPLIER`'s doc comment in
 * weather.ts for why this sim deliberately skips per-species cold-tolerance
 * data rather than half-building it. `1` (no penalty) outside a cold snap,
 * off the surface layer, or for an agent with no real position yet.
 */
export function coldSnapSpeedMultiplier(world: World, layer: Layer, pos: Vec2): number {
  return isInColdSnap(world, layer, pos) ? COLD_SNAP_SPEED_MULTIPLIER : 1;
}

// --- Heal over time + recovery ---

/**
 * A small per-tick HP regen for every living agent, gated on being fed AND
 * watered (see `FED_THRESHOLD`) — an agent that isn't getting food/water
 * doesn't recover, which is exactly what makes herd food delivery matter for
 * a fainted ally that can't feed itself. Belongs in the always-runs
 * needs-decay tick (needs.ts's `tickAgentNeeds`), not the action-gated one —
 * healing doesn't pause because an agent is too hurt to act.
 *
 * `multiplier` (default 1) composes multiplicatively with the flat per-tick
 * rate — needs.ts's sleep effects pass a larger value ("replenishes hp...
 * more" while asleep, per DESIGN.md's sleep section), the same optional-
 * multiplier shape `decayNeeds`'s `thirstMultiplier` already uses. Every
 * pre-existing caller that doesn't pass it heals at exactly the original
 * flat rate.
 */
export function applyHealOverTime(agent: Agent, multiplier = 1): void {
  if (agent.alive === false) return;
  if (agent.hp === undefined || agent.maxHp === undefined || agent.hp >= agent.maxHp) return;
  if (!isFedAndWatered(agent)) return;
  agent.hp = Math.min(agent.maxHp, agent.hp + agent.maxHp * HEAL_PER_TICK_FRACTION * multiplier);
}

/**
 * If a fainted agent's healed hp has crossed `WAKE_HP_FRACTION` before its
 * finishing pool ran out, it wakes up: `fainted` clears, the pool is
 * discarded entirely (a fresh faint later gets a fresh pool, never a
 * carried-over remainder), and it resumes normal action-tick behavior next
 * time it gets an action (see needs.ts's `tickAgentAction`).
 */
export function maybeRecoverFromFaint(agent: Agent, world: World, log?: EventLog): void {
  if (agent.alive === false || !agent.fainted) return;
  if (agent.hp === undefined || agent.maxHp === undefined || agent.maxHp <= 0) return;
  if (agent.hp / agent.maxHp < WAKE_HP_FRACTION) return;

  agent.fainted = false;
  agent.finishingPool = undefined;
  log?.record({ kind: "recovered", tick: world.tick, agentId: agent.id, species: agent.species, hp: agent.hp });
}

// --- Looting (fainted or dead, any looter, no relationship restriction) ---

/**
 * Any nearby agent — predator, rival, even the victim's own herd-mates, per
 * direct instruction — can loot one item off a fainted OR truly dead agent's
 * inventory, provided the looter has carry headroom for it. Transfers a
 * single item per call (called once per action tick, same cadence as every
 * other behavior here) and returns whether a transfer happened, so the
 * caller can treat it as this tick's action.
 */
export function applyLooting(world: World, agent: Agent, log?: EventLog): boolean {
  const capacity = carryCapacityOf(agent);
  const used = usedCarryWeight(world, agent);

  const lootable = world.agents.filter(
    (other) =>
      other.id !== agent.id &&
      other.layer === agent.layer &&
      (other.fainted || other.alive === false) &&
      (other.inventory?.length ?? 0) > 0 &&
      manhattan(other.pos, agent.pos) <= LOOT_RADIUS
  );
  const target = nearest(agent, lootable);
  if (!target?.inventory?.length) return false;

  const item = target.inventory[0]!;
  if (used + item.weight > capacity) return false;

  target.inventory = target.inventory.slice(1);
  agent.inventory = [...(agent.inventory ?? []), item];
  log?.record({
    kind: "looted",
    tick: world.tick,
    looterId: agent.id,
    looterSpecies: agent.species,
    fromId: target.id,
    fromSpecies: target.species,
    itemKey: item.itemKey,
  });
  return true;
}

// --- Herd food delivery ---

function isSameHerd(a: Agent, b: Agent): boolean {
  return a.herdId !== undefined && a.herdId === b.herdId && a.species === b.species;
}

function nearbyHerdmates(world: World, agent: Agent, radius: number): Agent[] {
  if (!agent.herdId) return [];
  return world.agents.filter(
    (other) => other.id !== agent.id && other.alive !== false && isSameHerd(agent, other) && other.layer === agent.layer && manhattan(other.pos, agent.pos) <= radius
  );
}

function hasFoodItem(agent: Agent): boolean {
  return (agent.inventory ?? []).some((item) => item.itemKey === FOOD_ITEM_KEY);
}

function isHungryEnoughToHelp(agent: Agent): boolean {
  return agent.needs.hunger < HUNGRY_HERDMATE_THRESHOLD;
}

function findHungryHerdmate(world: World, agent: Agent): Agent | undefined {
  const candidates = nearbyHerdmates(world, agent, HERD_SUPPORT_RADIUS).filter(isHungryEnoughToHelp);
  return nearest(agent, candidates);
}

function findNearestFoodTile(world: World, agent: Agent): Vec2 | undefined {
  return findNearestIndexed(world, agent.layer, agent.pos, "food");
}

function deliverFoodItem(agent: Agent): InventoryItem | undefined {
  const index = (agent.inventory ?? []).findIndex((item) => item.itemKey === FOOD_ITEM_KEY);
  if (index === -1) return undefined;
  const [item] = agent.inventory!.splice(index, 1);
  return item;
}

/**
 * A well-fed, non-threatened herd member with inventory headroom notices a
 * hungry herd-mate, picks up food from the nearest stocked flora tile (same
 * `stock` depletion accounting as direct self-feeding — flora.ts's
 * `CONSUME_STOCK_AMOUNT`), and walks it over — consumed on arrival to
 * restore the receiver's hunger exactly like self-feeding would. Two-phase,
 * tracked via `deliverTargetId` + whether the agent is already holding a
 * food item, the same "resumable multi-tick errand" pattern as `relocate` in
 * predation.ts. Returns true if this tick was spent on delivery (so the
 * caller should skip normal needs-driven behavior).
 *
 * `needsAreUrgent` (default false, from `chooseBehavior(agent.needs) !==
 * "idle"` in needs.ts's `tickAgentAction`) pauses an in-progress errand
 * exactly like dispersal/shelter-building's own pause-on-urgent-need fix —
 * `deliverTargetId` is left untouched so the errand resumes once the
 * deliverer is satisfied again. Before this, an errand only checked the
 * deliverer's own needs once, at the moment it started (`isFedAndWatered`
 * below) — never again during the walk, letting a real multi-hundred-tick
 * delivery run straight through the deliverer's own hunger/thirst the same
 * way the pre-fix versions of dispersal/shelter-building used to.
 */
export function applyHerdSupport(world: World, agent: Agent, log?: EventLog, needsAreUrgent = false): boolean {
  if (!agent.herdId) return false;

  if (agent.deliverTargetId) {
    if (needsAreUrgent) return false; // paused, not abandoned — deliverTargetId untouched, resumes later
    const target = world.agents.find((a) => a.id === agent.deliverTargetId);
    const targetGone = !target || target.alive === false || !isSameHerd(agent, target);

    if (!targetGone && hasFoodItem(agent)) {
      if (manhattan(agent.pos, target!.pos) <= ADJACENT_RADIUS) {
        const item = deliverFoodItem(agent);
        if (item) {
          target!.needs.hunger = Math.min(1, target!.needs.hunger + DELIVERED_FOOD_HUNGER_RESTORE);
          log?.record({
            kind: "foodDelivered",
            tick: world.tick,
            carrierId: agent.id,
            carrierSpecies: agent.species,
            receiverId: target!.id,
            receiverSpecies: target!.species,
          });
        }
        agent.deliverTargetId = undefined;
        return true;
      }
      logBehaviorChange(log, world, agent, "deliverFood");
      agent.behavior = "deliverFood";
      agent.pos = stepToward(world, agent.layer, agent.pos, target!.pos);
      return true;
    }

    if (!targetGone && !hasFoodItem(agent)) {
      const foodTile = findNearestFoodTile(world, agent);
      if (!foodTile) {
        agent.deliverTargetId = undefined; // no food to be had right now — give up this errand
        return false;
      }
      logBehaviorChange(log, world, agent, "deliverFood");
      agent.behavior = "deliverFood";
      if (manhattan(agent.pos, foodTile) === 0) {
        const tile = tileAt(world, agent.layer, foodTile.x, foodTile.y);
        if (tile?.stock !== undefined) tile.stock = Math.max(0, tile.stock - CONSUME_STOCK_AMOUNT);
        agent.inventory = [...(agent.inventory ?? []), { itemKey: FOOD_ITEM_KEY, weight: FOOD_ITEM_WEIGHT }];
      } else {
        agent.pos = stepToward(world, agent.layer, agent.pos, foodTile);
      }
      return true;
    }

    agent.deliverTargetId = undefined; // target died or left the herd mid-errand
    return false;
  }

  // Not already on an errand — only start one while well-fed/watered and not
  // otherwise occupied (the caller only reaches this once survival instincts
  // and an in-progress carry have already had first refusal this tick).
  if (!isFedAndWatered(agent)) return false;
  if (remainingCarryCapacity(world, agent) < FOOD_ITEM_WEIGHT) return false;

  const hungryMate = findHungryHerdmate(world, agent);
  if (!hungryMate) return false;

  agent.deliverTargetId = hungryMate.id;
  return applyHerdSupport(world, agent, log, needsAreUrgent);
}

// --- Ally-targeting support moves (MoveSpec.targetsAlly/allyEffect) ---

/**
 * Resolves an off-cooldown ally-targeting move (`MoveSpec.targetsAlly` +
 * `allyEffect`) against the nearest in-range, conscious herd-mate — a Vine
 * Link/Nurturing Vines-style "cross-agent effect," distinct from
 * `resolveHit`'s hostile hit-resolution path entirely (no accuracy roll, no
 * damage, never targets a threat). Prefers an ally that's actually hurt
 * (below max HP) over a full-health one when both are in range, so a heal
 * doesn't waste itself on someone who doesn't need it while a hurt ally
 * waits; falls back to any in-range ally (for a pure-buff move with no heal
 * component) if none are hurt. Returns true if this tick was spent
 * supporting, so the caller skips normal needs-driven behavior.
 */
export function applySupportMove(world: World, agent: Agent, log?: EventLog): boolean {
  const supportMoves = (agent.moves ?? []).filter((m) => m.targetsAlly && m.allyEffect && !agent.moveCooldowns?.[m.id]);
  if (supportMoves.length === 0) return false;

  const allies = nearbyHerdmates(world, agent, HERD_SUPPORT_RADIUS).filter((a) => !a.fainted);
  if (allies.length === 0) return false;

  const hurtAllies = allies.filter((a) => a.hp !== undefined && a.maxHp !== undefined && a.hp < a.maxHp);
  const pool = hurtAllies.length > 0 ? hurtAllies : allies;

  for (const move of supportMoves) {
    const target = nearest(
      agent,
      pool.filter((a) => withinMoveRange(move, manhattan(agent.pos, a.pos)))
    );
    if (!target) continue;

    useMove(agent, move);
    const effect = move.allyEffect!;
    let healed = false;
    let buffed = false;

    if (effect.healFraction && target.hp !== undefined && target.maxHp !== undefined) {
      target.hp = Math.min(target.maxHp, target.hp + target.maxHp * effect.healFraction);
      healed = true;
    }
    if (effect.buff) {
      target.statStages = target.statStages ?? [];
      target.statStages.push({ stat: effect.buff.stat, stage: effect.buff.stage, ticksRemaining: effect.buff.ticks });
      buffed = true;
    }

    log?.record({
      kind: "supported",
      tick: world.tick,
      supporterId: agent.id,
      supporterSpecies: agent.species,
      allyId: target.id,
      allySpecies: target.species,
      healed,
      buffed,
    });
    return true;
  }
  return false;
}

// --- Literal carrying (fainted allies only) ---

function findAdjacentFaintedAlly(world: World, agent: Agent): Agent | undefined {
  return nearbyHerdmates(world, agent, ADJACENT_RADIUS).find((other) => other.fainted === true && !other.beingCarriedBy);
}

/**
 * A herd-mate adjacent to a fully fainted ally picks it up. Starting a carry
 * doesn't require being fed/watered — rescuing isn't gated the same way
 * delivery is. No-ops (and returns false) if there's nothing to pick up or
 * the carrier doesn't have the spare capacity for the ally's body weight.
 */
export function maybeStartCarrying(world: World, agent: Agent, log?: EventLog): boolean {
  if (agent.carryingId || agent.beingCarriedBy) return false;

  const ally = findAdjacentFaintedAlly(world, agent);
  if (!ally) return false;

  if (remainingCarryCapacity(world, agent) < bodyWeightOf(ally)) return false;

  agent.carryingId = ally.id;
  ally.beingCarriedBy = agent.id;
  log?.record({
    kind: "carrying",
    tick: world.tick,
    carrierId: agent.id,
    carrierSpecies: agent.species,
    carriedId: ally.id,
    carriedSpecies: ally.species,
  });
  return true;
}

function dropCarriedAlly(world: World, agent: Agent, reason: "arrived" | "threat", log?: EventLog): void {
  const carried = world.agents.find((a) => a.id === agent.carryingId);
  if (carried) {
    carried.beingCarriedBy = undefined;
    carried.pos = { ...agent.pos };
    carried.layer = agent.layer;
    log?.record({
      kind: "setDown",
      tick: world.tick,
      carrierId: agent.id,
      carrierSpecies: agent.species,
      carriedId: carried.id,
      carriedSpecies: carried.species,
      reason,
    });
  }
  agent.carryingId = undefined;
}

/**
 * Continues an in-progress carry: the carried ally's position mirrors the
 * carrier's every tick, and the carrier heads for its `homePos` (the
 * cheapest available "herd home range" stand-in — see `Agent.homePos`).
 * Drops the ally (switching to `flee` via the caller's next check, same
 * tick) the instant the carrier itself comes under predator threat — the
 * carrier's own survival instinct isn't overridden by rescuing, per direct
 * instruction — or sets it down normally on arrival. Returns true only when
 * the carry itself was this tick's action (i.e. NOT when it just dropped the
 * ally for a threat, so the caller falls through to normal survival
 * instincts that same tick).
 */
export function applyCarrying(world: World, agent: Agent, rules: HuntRules | undefined, log?: EventLog): boolean {
  if (!agent.carryingId) return false;

  const carried = world.agents.find((a) => a.id === agent.carryingId);
  if (!carried || carried.alive === false || carried.fainted !== true) {
    // Ally recovered consciousness, died, or vanished mid-carry — release without ceremony.
    if (carried) carried.beingCarriedBy = undefined;
    agent.carryingId = undefined;
    return false;
  }

  if (rules) {
    const threats = agentsWithin(world, agent, FLEE_DETECT_RADIUS).filter(
      (other) => !other.fainted && isHunterSpecies(rules, other.species, agent.species)
    );
    if (threats.length > 0) {
      dropCarriedAlly(world, agent, "threat", log);
      return false;
    }
  }

  const home = agent.homePos ?? agent.pos;
  if (manhattan(agent.pos, home) <= CARRY_ARRIVAL_RADIUS) {
    dropCarriedAlly(world, agent, "arrived", log);
    return false;
  }

  logBehaviorChange(log, world, agent, "carryAlly");
  agent.behavior = "carryAlly";
  agent.pos = stepToward(world, agent.layer, agent.pos, home);
  carried.pos = { ...agent.pos };
  carried.layer = agent.layer;
  return true;
}
