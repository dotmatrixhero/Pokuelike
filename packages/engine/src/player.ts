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
import { invalidateResourceIndex } from "./resourceIndex.js";
import { GIFT_GRACE_TICKS } from "./threat.js";
import { applyTerrainEffectAt, resolveHit } from "./predation.js";
import { pickBestMove } from "./combat.js";

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
  // Anything other than waiting wakes the player up — see the "wait" case
  // below. Deliberately no `wokeUp` event/reason here: that union is
  // `"urgentNeed" | "threatSpotted"` (events.ts), both NPC-only triggers;
  // widening it for "player moved" would touch every exhaustive SimEvent
  // switch (eventText.ts, format.ts) for a case with nothing to say.
  if (agent.asleep && action.kind !== "wait") {
    agent.asleep = false;
    agent.sleepTicks = 0;
  }
  outcome.ok = apply(world, agent, action, outcome, log, ctx, rng);
  agent.lastActionOutcome = outcome;
  return outcome.ok;
}

function apply(world: World, agent: Agent, action: PlayerAction, out: PlayerActionOutcome, log: EventLog | undefined, ctx: LevelingContext | undefined, rng: () => number): boolean {
  switch (action.kind) {
    case "wait":
      // Direct ask: "wait should recover [energy]." The player is just
      // another agent to the sim (this file's own doc comment) — reused
      // needs.ts's existing sleep state rather than inventing a second,
      // weaker rest mechanic (CLAUDE.md: "check whether it already exists
      // before building it"). While `asleep`, `tickAgentNeeds` already
      // gives ANY agent energy recovery instead of drain, slower hunger/
      // thirst decay, and faster healing and cooldown recovery. A wait
      // that keeps getting queued keeps it true; any other action wakes
      // the player up (see applyPlayerAction above).
      agent.asleep = true;
      return false;
    case "cancel":
      return false;
    case "move": {
      const next = { x: agent.pos.x + action.dx, y: agent.pos.y + action.dy };
      if (!canStepTo(world, agent, agent.layer, next, agent)) return false;
      agent.pos = next;
      // ROADMAP.md M6: moving slowly matters. A crouched step pays extra
      // action energy, so the world moves more between your steps.
      if (agent.posture === "crouch") agent.actionEnergy = (agent.actionEnergy ?? 0) - CROUCH_STEP_EXTRA_ENERGY;
      return true;
    }
    case "eat": {
      const tile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
      if (tile?.terrain === "food" && (tile.stock ?? 0) > 0) {
        consume(agent.needs, "seekFood", foodNutritionFactor(tile));
        tile.stock = Math.max(0, (tile.stock ?? 0) - CONSUME_STOCK_AMOUNT);
        recordGrazing(tile);
        grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
        log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "hunger" });
        return true;
      }
      // Direct ask: "make offer and eat only available from inventory after
      // you gather" — nothing underfoot, so eat a carried berry instead.
      // `foodNutritionFactor(undefined)` is already the neutral (1x) default
      // this function returns for exactly this "no tile" case.
      if (countOf(agent, "food") <= 0) return false;
      removeItem(agent, "food", 1);
      consume(agent.needs, "seekFood", foodNutritionFactor(undefined));
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
      syncPlayerMoves(world, agent);
      return true;
    }
    case "stow": {
      if (!agent.equipment?.held) return false;
      agent.equipment.held = undefined;
      syncPlayerMoves(world, agent);
      return true;
    }
    case "attack": {
      const targetPos = { x: agent.pos.x + action.dx, y: agent.pos.y + action.dy };
      const defender = world.agents.find(
        (a) => a.id !== agent.id && a.alive !== false && !a.isEgg && a.layer === agent.layer && a.pos.x === targetPos.x && a.pos.y === targetPos.y
      );
      if (defender) {
        // `resolveHit`'s own return value only ever says whether this hit
        // was a true KILL (see its doc comment) — a landed-but-nonlethal
        // hit and "nothing was off cooldown or in range" both come back
        // false, so it can't tell those two apart for `out.ok`. Checked
        // here first, the same pre-check `canAttackFromHere` already does
        // at every other real call site, to know whether a swing actually
        // happened at all. Distance is always 1 by construction — dx/dy
        // are each -1/0/1, comfortably within every move on the player's
        // loadout (`range: {max: 1}`).
        if (!pickBestMove(agent, defender.types ?? [], 1, world.tick)) return false;
        resolveHit(world, agent, defender, log, "defeated", ctx, 1, rng);
        out.attackedId = defender.id;
        return true;
      }
      // No living target — a terrain-directed swing instead (axe against a
      // tree, machete against a bush), MOVES_AND_TOOLS.md's generalised
      // `terrainEffect`. `pickBestMove` never offers these (they're
      // `utilityMove`-flagged, see `terrainMove`'s own doc comment in
      // crafting.ts), so they're picked directly here rather than through
      // the ordinary combat move-selection path.
      const tile = tileAt(world, agent.layer, targetPos.x, targetPos.y);
      if (!tile) return false;
      const move = (agent.moves ?? []).find(
        (m) => m.terrainEffect && !agent.moveCooldowns?.[m.id] && (!m.terrainEffect.from || m.terrainEffect.from.includes(tile.terrain))
      );
      if (!move?.terrainEffect) return false;
      const felled = applyTerrainEffectAt(world, agent, agent.layer, targetPos, move);
      if (!felled) return false;
      out.felled = felled;
      return true;
    }
    case "command": {
      // Direct ask: "under the attack option a sub menu show up to select
      // your bonded pokemon if its within the same zone as you, and you can
      // select a move and target a space with it - it then uses its own
      // pathfinding to get to the right position and use it." Costs the
      // PLAYER's turn to issue; `needs.ts`'s `applyCommandedAction` spends
      // the partner's own, separate action ticks closing distance and
      // acting. "Bonded" here is the existing follower relationship
      // (`Agent.followingId`), not a separate command-specific gate.
      const partner = world.agents.find((a) => a.id === action.agentId && a.followingId === agent.id && a.alive !== false);
      if (!partner) return false;
      const move = partner.moves?.find((m) => m.id === action.moveId);
      if (!move) return false;
      partner.commandedAction = { moveId: action.moveId, target: action.target };
      return true;
    }
    case "crouch": {
      agent.posture = agent.posture === "crouch" ? undefined : "crouch";
      return agent.posture === "crouch";
    }
    case "offer": {
      if (countOf(agent, "food") <= 0) return false;
      const spot = freeTileBeside(world, agent);
      if (!spot) return false;
      removeItem(agent, "food", 1);
      const tile = tileAt(world, agent.layer, spot.x, spot.y)!;
      tile.terrain = "food";
      tile.stock = OFFERED_FOOD_STOCK;
      tile.flavor = undefined;
      tile.offeredBy = agent.id;
      invalidateResourceIndex(world);
      // Lever 2, the gift moment (threat.ts): the instant food goes down,
      // signature collapses for GIFT_GRACE_TICKS — no need to retreat for
      // the offering to actually get taken.
      agent.giftGraceUntil = world.tick + GIFT_GRACE_TICKS;
      return true;
    }
  }
}

/**
 * Two bites (a sim `consume` takes `CONSUME_STOCK_AMOUNT` = 0.35). Flora's
 * natural decay eats ~0.008 a tick, so a single bite's worth was gone in
 * ~45 ticks — before a wary creature had backed-off room to come and eat
 * it. This lasts ~90.
 */
const OFFERED_FOOD_STOCK = CONSUME_STOCK_AMOUNT * 2;

/** A walkable, empty floor tile among the eight around the player — the offering goes down beside you, not under you. */
function freeTileBeside(world: World, agent: Agent): { x: number; y: number } | undefined {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const pos = { x: agent.pos.x + dx, y: agent.pos.y + dy };
      const tile = tileAt(world, agent.layer, pos.x, pos.y);
      if (!tile || tile.terrain !== "floor") continue;
      if (world.agents.some((a) => a.alive !== false && a.layer === agent.layer && a.pos.x === pos.x && a.pos.y === pos.y)) continue;
      return pos;
    }
  }
  return undefined;
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

/**
 * MOVES_AND_TOOLS.md: "the player's loadout is their moveset." Recomputes
 * `agent.moves` as `world.playerBaseMoves` (bare hands) plus whatever the
 * currently held item grants — called after every equip/stow (and after
 * `tickTorch`'s own auto-unequip), so `pickBestMove`/`resolveHit`
 * (combat.ts/predation.ts) always see the real, current loadout without
 * needing to know a player did anything special to get there. A worn item
 * never grants moves (MOVES_AND_TOOLS.md's worked table: worn slots are
 * passive-only), so only `equipment.held` is read here.
 */
export function syncPlayerMoves(world: World, agent: Agent): void {
  const held = agent.equipment?.held;
  const granted = (held ? world.items?.[held]?.grantsMoves : undefined) ?? [];
  agent.moves = [...(world.playerBaseMoves ?? []), ...granted];
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

/** Half an `ACTION_THRESHOLD` (40): a crouched step takes one and a half turns' worth of world. Kept here, not imported, to avoid a simulation.ts cycle. */
export const CROUCH_STEP_EXTRA_ENERGY = 20;

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
  syncPlayerMoves(world, agent);
}
