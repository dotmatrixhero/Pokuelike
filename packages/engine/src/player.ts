import type { Agent, PlayerAction, PlayerActionOutcome, World } from "./types.js";
import { canStepTo } from "./movement.js";
import { consume } from "./needs.js";
import { tileAt } from "./world.js";
import { CONSUME_STOCK_AMOUNT, foodNutritionFactor, recordGrazing } from "./flora.js";
import { EXP_ON_CONSUME, grantExp, type LevelingContext } from "./leveling.js";
import type { EventLog } from "./events.js";
import { GATHER_TURNS, MATERIALS, harvestLeft, harvestableAt, takeHarvest, type MaterialId } from "./harvest.js";
import { addItem, carriedWeight, countOf, hasAll, removeItem } from "./inventory.js";
import { carryCapacityOf } from "./support.js";

/**
 * The player-controlled agent — ROADMAP.md's M0.
 *
 * The one design decision here is that there is no separate player system.
 * `Agent.controlledBy === "player"` is the whole difference: `tickWorld`
 * skips the behaviour tree for that agent and applies `queuedAction`
 * instead, on the tick its action energy is ready. Needs, action energy,
 * predation, rapport — all unchanged, all real. DESIGN.md: "the player is
 * just another agent to the sim."
 */

/** The player-controlled agent, if this world has one. Linear scan; there is at most one and this is called once per input, not per tick. */
export function findPlayer(world: World): Agent | undefined {
  return world.agents.find((a) => a.controlledBy === "player" && a.alive !== false);
}

/**
 * Applies one queued action to a player-controlled agent. A blocked move
 * (wall, water the species cannot enter, a full tile) is a no-op that still
 * costs the turn — bumping into a wall is not free, same as any roguelike.
 * Returns whether the action did what it set out to do (moved, ate, drank);
 * the same answer is left on `agent.lastActionOutcome` for the UI, since
 * this runs inside `tickWorld` where the caller cannot see the return.
 *
 * Moves use `movement.ts`'s `canStepTo` — the exact predicate every sim
 * agent's step goes through — with the player as its own `mover` so tile
 * capacity applies too. Not `canEnterTile` alone: that is occupancy only,
 * and the first draft of this walked through walls.
 *
 * Eat and drink (ROADMAP.md M3) go through the same `consume` the
 * behaviour tree's seekFood/seekWater arrive at, with the same stock
 * depletion, grazing scar, exp and `consumed` event — the sim does not know
 * a human ate rather than a Sandshrew.
 *
 * Gather and craft (ROADMAP.md M5) are time-spends: the first action starts
 * an `Activity`, `continue` advances it one turn, and anything else clears
 * it — turns are lost, materials are not, nothing is consumed or produced
 * until the last turn. The UI owns the loop and the stop rule.
 */
export function applyPlayerAction(
  world: World,
  agent: Agent,
  action: PlayerAction,
  log?: EventLog,
  ctx?: LevelingContext,
  rng: () => number = world.rng,
): boolean {
  const outcome: PlayerActionOutcome = { action, ok: false, tick: world.tick };
  // Any action other than continuing the activity abandons it.
  if (agent.activity && action.kind !== "continue") agent.activity = undefined;
  outcome.ok = apply(world, agent, action, outcome, log, ctx, rng);
  agent.lastActionOutcome = outcome;
  return outcome.ok;
}

function apply(world: World, agent: Agent, action: PlayerAction, out: PlayerActionOutcome, log: EventLog | undefined, ctx: LevelingContext | undefined, rng: () => number): boolean {
  switch (action.kind) {
    case "wait":
    case "cancel":
      return false;
    case "move": {
      const next = { x: agent.pos.x + action.dx, y: agent.pos.y + action.dy };
      if (!canStepTo(world, agent, agent.layer, next, agent)) return false;
      agent.pos = next;
      return true;
    }
    case "eat": {
      const tile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
      if (!tile || tile.terrain !== "food" || (tile.stock ?? 0) <= 0) return false;
      consume(agent.needs, "seekFood", foodNutritionFactor(tile));
      tile.stock = Math.max(0, (tile.stock ?? 0) - CONSUME_STOCK_AMOUNT);
      recordGrazing(tile);
      grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
      log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "hunger" });
      return true;
    }
    case "drink": {
      if (!waterWithinReach(world, agent)) return false;
      consume(agent.needs, "seekWater");
      grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
      log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "thirst" });
      return true;
    }
    case "gather": {
      if (harvestLeft(world, agent.layer, agent.pos) <= 0 || harvestableAt(world, agent.layer, agent.pos).length === 0) return false;
      if (carriedWeight(agent) >= carryCapacityOf(agent)) return false;
      agent.activity = { kind: "gather", turnsLeft: GATHER_TURNS, turnsTotal: GATHER_TURNS };
      return true;
    }
    case "craft": {
      const recipe = world.recipes?.[action.recipeId];
      if (!recipe || !knowsRecipe(agent, recipe.id) || !hasAll(agent, recipe.inputs)) return false;
      agent.activity = { kind: "craft", recipeId: recipe.id, turnsLeft: recipe.turns, turnsTotal: recipe.turns };
      return true;
    }
    case "continue": {
      const act = agent.activity;
      if (!act) return false;
      act.turnsLeft--;
      if (act.turnsLeft > 0) return true;
      agent.activity = undefined;
      out.completed = act.kind;
      if (act.kind === "gather") return finishGather(world, agent, out);
      return finishCraft(world, agent, act.recipeId!, out);
    }
    case "equip": {
      const def = world.items?.[action.itemKey];
      if (!def?.slot || countOf(agent, action.itemKey) <= 0) return false;
      const eq = (agent.equipment ??= {});
      eq[def.slot] = action.itemKey;
      // A fresh light gets a full burn; a torch put away and taken out again keeps what it had.
      if (def.light && agent.torchFuel === undefined) agent.torchFuel = TORCH_FUEL_TICKS;
      return true;
    }
    case "stow": {
      if (!agent.equipment?.held) return false;
      agent.equipment.held = undefined;
      return true;
    }
  }
}

function finishGather(world: World, agent: Agent, out: PlayerActionOutcome): boolean {
  const capacity = carryCapacityOf(agent);
  const taken = takeHarvest(world, agent.layer, agent.pos);
  const gathered: { itemKey: string; count: number }[] = [];
  for (const m of taken) {
    if (carriedWeight(agent) + MATERIALS[m].weight > capacity) continue;
    addItem(agent, m, 1, MATERIALS[m].weight);
    gathered.push({ itemKey: m, count: 1 });
  }
  out.gathered = gathered;
  return gathered.length > 0;
}

function finishCraft(world: World, agent: Agent, recipeId: string, out: PlayerActionOutcome): boolean {
  const recipe = world.recipes?.[recipeId];
  if (!recipe || !hasAll(agent, recipe.inputs)) return false;
  for (const input of recipe.inputs) removeItem(agent, input.itemKey, input.count);
  const weight = world.items?.[recipe.output.itemKey]?.weight ?? MATERIALS[recipe.output.itemKey as MaterialId]?.weight ?? 1;
  addItem(agent, recipe.output.itemKey, recipe.output.count, weight);
  out.crafted = recipe.output.itemKey;
  return true;
}

export function knowsRecipe(agent: Agent, recipeId: string): boolean {
  return agent.knownRecipes?.includes(recipeId) ?? false;
}

/** Water on the player's own tile or any of the eight around it — you kneel at the edge; you do not have to wade in. */
export function waterWithinReach(world: World, agent: Agent): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tileAt(world, agent.layer, agent.pos.x + dx, agent.pos.y + dy)?.terrain === "water") return true;
    }
  }
  return false;
}

/** Whether the tile under the player is food with anything left on it. */
export function foodUnderfoot(world: World, agent: Agent): boolean {
  const tile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
  return tile?.terrain === "food" && (tile.stock ?? 0) > 0;
}

/** Whether the player holds an item that gives light (the torch) — read by vision.ts. */
export function holdsLight(world: World, agent: Agent): boolean {
  const held = agent.equipment?.held;
  return !!held && world.items?.[held]?.light === true && countOf(agent, held) > 0;
}

/** Ruling: "1000 ticks torch." Roughly 250 keys of light per torch. */
export const TORCH_FUEL_TICKS = 1000;

/**
 * One world tick of burn while a light is held. At 0 the torch is used up:
 * one leaves the pack, the hand is empty, and `lastNotice` tells the HUD.
 * Called from `tickWorld`'s player branch every tick, not per turn — a
 * torch burns while the world moves, whether or not you are acting.
 */
export function tickTorch(world: World, agent: Agent): void {
  if (!holdsLight(world, agent)) return;
  agent.torchFuel = (agent.torchFuel ?? TORCH_FUEL_TICKS) - 1;
  if (agent.torchFuel > 0) return;
  const held = agent.equipment!.held!;
  removeItem(agent, held, 1);
  agent.equipment!.held = undefined;
  agent.torchFuel = undefined;
  agent.lastNotice = { kind: "torchBurnedOut", tick: world.tick };
}
