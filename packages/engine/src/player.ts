import type { Agent, PlayerAction, PlayerActionOutcome, World } from "./types.js";
import { canStepTo } from "./movement.js";
import { consume } from "./needs.js";
import { setTile, tileAt } from "./world.js";
import { FIRE_BURN_TICKS } from "./fire.js";
import { CONSUME_STOCK_AMOUNT, foodNutritionFactor, recordGrazing, thirstReliefFactor } from "./flora.js";
import { EXP_ON_CONSUME, grantExp, type LevelingContext } from "./leveling.js";
import type { EventLog } from "./events.js";
import { FOOD_MATERIAL_IDS, GATHER_TURNS, MATERIALS, foodNutritionMultiplierOf, harvestLeft, harvestableAt, takeHarvest, thirstReliefOf, type MaterialId } from "./harvest.js";
import { addItem, carriedWeight, countOf, hasAll, removeItem } from "./inventory.js";
import { applyLooting, carryCapacityOf, healFromCookedFood, isTrulyDead } from "./support.js";
import { invalidateResourceIndex } from "./resourceIndex.js";
import { GIFT_GRACE_TICKS } from "./threat.js";
import { applyTerrainEffectAt, resolveHit } from "./predation.js";
import { pickBestMove, withinMoveRange } from "./combat.js";

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
  // Direct ask: "G should lock you into finishing the action of
  // gathering." Re-pressing the same gather key mid-gather used to fall
  // into the "any action other than continue abandons it" rule below and
  // then straight back into the "gather" case, which unconditionally
  // resets `turnsLeft` — so a stray double-tap (or, as found live, four
  // rapid presses in a playtest script) silently restarted the countdown
  // forever instead of ever finishing. A genuine no-op here: activity,
  // turnsLeft and everything else are left exactly as they were.
  if (agent.activity?.kind === "gather" && action.kind === "gather") {
    outcome.ok = true;
    agent.lastActionOutcome = outcome;
    return true;
  }
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
        // Direct ask: "can you make berries and tomatoes and apples help
        // thirst too" — a juicy crop's own thirstReliefFactor, on top of
        // the ordinary hunger relief above. 0 for anything that doesn't set it.
        const thirstRelief = thirstReliefFactor(tile);
        if (thirstRelief > 0) consume(agent.needs, "seekWater", thirstRelief);
        // A tile can carry a cooked dish's own flavor too (this same
        // "offer" case sets it to whatever was offered) — "heals as well
        // as satisfies hunger."
        healFromCookedFood(world, agent, tile.flavor);
        tile.stock = Math.max(0, (tile.stock ?? 0) - CONSUME_STOCK_AMOUNT);
        recordGrazing(tile);
        grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
        log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "hunger" });
        signalMirrorToFollowers(world, agent, "eat");
        return true;
      }
      // Direct ask: "make offer and eat only available from inventory after
      // you gather" — nothing underfoot, so eat a carried berry instead.
      // Any real food material (`FOOD_MATERIAL_IDS` — a specific crop now
      // that gathering hands those back distinctly, not just the old
      // generic "food") OR a cooked dish, not literally the item key
      // "food". `action.itemKey` names exactly which one (the pack menu's
      // per-row Eat button) — falling back to "first one found" would
      // silently eat a DIFFERENT carried food than the row the player
      // actually tapped.
      const carried = resolveFoodItem(world, agent, action.itemKey);
      if (!carried) return false;
      removeItem(agent, carried, 1);
      consume(agent.needs, "seekFood", foodNutritionMultiplierOf(carried));
      const carriedThirstRelief = thirstReliefOf(carried);
      if (carriedThirstRelief > 0) consume(agent.needs, "seekWater", carriedThirstRelief);
      // Direct ask: "cooked food... heals as well as satisfies hunger."
      healFromCookedFood(world, agent, carried);
      grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
      log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "hunger" });
      signalMirrorToFollowers(world, agent, "eat");
      return true;
    }
    case "drink": {
      if (waterWithinReach(world, agent)) {
        consume(agent.needs, "seekWater");
      } else if ((agent.waterskinCharges ?? 0) > 0) {
        // Direct ask: "make waterskin... allow gather from water sources
        // and filling it up" — the payoff for having filled it: a real
        // drink away from any water tile, same relief a drink at the
        // water's edge gives (not weakened — same "a tool is not a tax on
        // top of the thing it enables" reasoning this codebase already
        // applies to tool-granted moves).
        consume(agent.needs, "seekWater");
        agent.waterskinCharges!--;
      } else {
        return false;
      }
      grantExp(world, agent, EXP_ON_CONSUME, ctx, log, rng);
      log?.record({ kind: "consumed", tick: world.tick, agentId: agent.id, species: agent.species, layer: agent.layer, pos: agent.pos, need: "thirst" });
      signalMirrorToFollowers(world, agent, "drink");
      return true;
    }
    case "gather": {
      const canHarvest =
        harvestLeft(world, agent.layer, agent.pos) > 0 &&
        harvestableAt(world, agent.layer, agent.pos).length > 0 &&
        carriedWeight(agent) < carryCapacityOf(world, agent);
      // Direct ask: "make waterskin when held, allow gather from water
      // sources and filling it up" — a real vessel, standing (or reaching)
      // adjacent to water, not already full. Weight-blind on purpose: this
      // tops off gear you're already carrying, not new cargo.
      if (!canHarvest && !canFillWaterskin(world, agent)) return false;
      agent.activity = { kind: "gather", turnsLeft: GATHER_TURNS, turnsTotal: GATHER_TURNS };
      signalMirrorToFollowers(world, agent, "gather");
      return true;
    }
    case "craft": {
      const recipe = world.recipes?.[action.recipeId];
      if (!recipe || !knowsRecipe(agent, recipe.id) || !hasAll(agent, recipe.inputs)) return false;
      // Direct ask: "while near you can craft with combos of crops and
      // berries" — a cooking recipe needs a real deployed fire nearby.
      if (recipe.requiresNearFire && !nearFire(world, agent)) return false;
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
      const targetPos = action.target ?? { x: agent.pos.x + action.dx, y: agent.pos.y + action.dy };
      // A tile-targeted swing always names a real move — see this action's
      // own doc comment on why there's no auto-pick equivalent for an
      // arbitrary tile the way the bare directional swing has.
      if (action.target && !action.moveId) return false;
      // Chebyshev, not `manhattan` (predation.ts's own, used everywhere ELSE
      // range is checked) — deliberately. The player moves 8-directionally,
      // one step in any of 8 directions costs the same turn, and the old
      // dx/dy swing this replaces already treated every one of those 8
      // neighbors as "distance 1" by construction (dx/dy each -1/0/1, no
      // distance computed at all). Manhattan would silently shrink melee
      // reach to the 4 orthogonal tiles the instant a swing became
      // tile-targeted instead of directional — a real behavior change this
      // feature isn't meant to make. Ally commands (needs.ts) keep using
      // manhattan; that's a separate, self-correcting case (an out-of-range
      // order just walks the partner one step closer next tick), not this
      // one-shot swing.
      const distance = action.target ? Math.max(Math.abs(action.target.x - agent.pos.x), Math.abs(action.target.y - agent.pos.y)) : 1;
      // Direct ask: "Attack should move list should work when you have a
      // weapon, or tackle if you don't. The player has moves too" — an
      // explicit `moveId` names one of the player's own real moves; a
      // chosen move must exist, be off cooldown, and reach `distance` (1 by
      // construction for the plain dx/dy swing; whatever `target` is
      // actually away for a tile-targeted one) to count as "you swung."
      const chosen = action.moveId ? agent.moves?.find((m) => m.id === action.moveId) : undefined;
      if (action.moveId && (!chosen || agent.moveCooldowns?.[chosen.id] || !withinMoveRange(chosen, distance))) return false;
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
        // happened at all.
        if (!chosen && !pickBestMove(agent, defender.types ?? [], distance, world.tick)) return false;
        resolveHit(world, agent, defender, log, "defeated", ctx, distance, rng, 1, chosen);
        out.attackedId = defender.id;
        return true;
      }
      // No living target — a terrain-directed swing instead (axe against a
      // tree, machete against a bush), MOVES_AND_TOOLS.md's generalised
      // `terrainEffect`. `pickBestMove` never offers these (they're
      // `utilityMove`-flagged, see `terrainMove`'s own doc comment in
      // crafting.ts), so a plain auto-swing (no explicit `moveId`) picks
      // one directly here rather than through the ordinary combat move-
      // selection path; an explicit `moveId` was already resolved above.
      const tile = tileAt(world, agent.layer, targetPos.x, targetPos.y);
      if (!tile) return false;
      const move =
        chosen ??
        (agent.moves ?? []).find((m) => m.terrainEffect && !agent.moveCooldowns?.[m.id] && (!m.terrainEffect.from || m.terrainEffect.from.includes(tile.terrain)));
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
      // Direct follow-up report: "ally doesn't seem to engage much in
      // combat... it should go do that and continue to fight and engage
      // until i like walk away." Captured once, here, at issue time: a
      // living agent standing on the targeted tile becomes a tracked
      // target `needs.ts`'s `applyCommandedAction` chases and keeps
      // fighting until it dies, rather than one swing at a tile that goes
      // stale the instant the target takes a step.
      const targetAgent = world.agents.find((a) => a.id !== partner.id && a.alive !== false && !a.isEgg && a.layer === partner.layer && a.pos.x === action.target.x && a.pos.y === action.target.y);
      partner.commandedAction = { moveId: action.moveId, target: action.target, targetAgentId: targetAgent?.id };
      return true;
    }
    case "setStandingOrder": {
      // Direct ask: "a command button that allows you to set behaviors
      // for each of your allies; patrol, hunt, defend, etc." Same
      // "bonded = currently following" gate `command` above uses.
      const partner = world.agents.find((a) => a.id === action.agentId && a.followingId === agent.id && a.alive !== false);
      if (!partner) return false;
      if (action.order === "follow") {
        partner.standingOrder = undefined;
        partner.huntTarget = undefined;
      } else {
        partner.standingOrder = action.order;
      }
      return true;
    }
    case "crouch": {
      agent.posture = agent.posture === "crouch" ? undefined : "crouch";
      return agent.posture === "crouch";
    }
    case "offer": {
      const offered = resolveFoodItem(world, agent, action.itemKey);
      if (!offered) return false;
      const spot = freeTileBeside(world, agent);
      if (!spot) return false;
      removeItem(agent, offered, 1);
      const tile = tileAt(world, agent.layer, spot.x, spot.y)!;
      tile.terrain = "food";
      tile.stock = OFFERED_FOOD_STOCK;
      // Carries the specific crop through to the ground — the generic
      // "food" fallback still reads as flavorless (undefined), same as
      // every offer before distinct crop items existed.
      tile.flavor = offered === "food" ? undefined : offered;
      tile.offeredBy = agent.id;
      invalidateResourceIndex(world);
      // Lever 2, the gift moment (threat.ts): the instant food goes down,
      // signature collapses for GIFT_GRACE_TICKS — no need to retreat for
      // the offering to actually get taken.
      agent.giftGraceUntil = world.tick + GIFT_GRACE_TICKS;
      return true;
    }
    case "drop": {
      // Direct report: "can't drop items." A plain discard — frees the
      // carry weight. No ground-item/pickup system exists yet, so this
      // does not leave anything retrievable; see TODO.md.
      if (!removeItem(agent, action.itemKey, 1)) return false;
      if (countOf(agent, action.itemKey) <= 0) {
        if (agent.equipment?.held === action.itemKey) {
          agent.equipment.held = undefined;
          syncPlayerMoves(world, agent);
        }
        if (agent.equipment?.worn === action.itemKey) agent.equipment.worn = undefined;
      }
      return true;
    }
    case "placeCampfire": {
      // Direct ask: "get rid of fire building as a direct action - make it
      // a crafting thing that sets down a campfire." Consumes a crafted
      // `campfire` item (`crafting.ts`) rather than a held torch + raw
      // deadwood — the fire-starting is done by the time you're carrying
      // one; this action just plants it.
      if (countOf(agent, "campfire") < 1) return false;
      const targetPos = { x: agent.pos.x + action.dx, y: agent.pos.y + action.dy };
      const tile = tileAt(world, agent.layer, targetPos.x, targetPos.y);
      if (!tile || !tile.walkable || tile.terrain === "water") return false;
      removeItem(agent, "campfire", 1);
      if (tile.terrain === "fire") {
        // Direct follow-up (carried over from the original verb): "burns
        // out but you can feed it more wood to increase fuel" —
        // genuinely additive, not just a refresh-to-full (fire.ts's own
        // `igniteTile`, used by combat's terrainBurn, resets an already-
        // burning tile rather than stacking; deliberately different here,
        // since this is a player choosing to keep a fire going, not a
        // second hit landing on a burning target).
        tile.burnTicksRemaining = (tile.burnTicksRemaining ?? 0) + FIRE_BURN_TICKS;
      } else {
        // Deliberately bypasses fire.ts's own FLAMMABLE_TERRAIN gate — a
        // deployed campfire is fueled by the kit in your pack, not by the
        // ground catching, so (unlike a combat-caused fire) it can be
        // placed on bare floor, not just vegetation.
        const from = tile.terrain;
        setTile(world, agent.layer, targetPos.x, targetPos.y, "fire");
        tileAt(world, agent.layer, targetPos.x, targetPos.y)!.burnTicksRemaining = FIRE_BURN_TICKS;
        log?.record({ kind: "terrainChanged", tick: world.tick, layer: agent.layer, pos: targetPos, from, to: "fire", cause: "fire" });
      }
      invalidateResourceIndex(world);
      return true;
    }
    case "loot": {
      // Direct ask: "can't loot or butcher dead units." Reuses
      // support.ts's `applyLooting` unmodified — the player is just
      // another agent to the sim (this file's own doc comment), and that
      // function already has no relationship restriction ("predator,
      // rival, even the victim's own herd" per its own doc comment), so
      // there's nothing player-specific to add here at all.
      return applyLooting(world, agent, log);
    }
    case "butcher": {
      // Direct follow-up, same report: "maybe you need a knife to do more
      // but that should be a thing." Only a TRULY dead corpse — DESIGN.md's
      // "only true death is consumable" ruling, the same line `eat`/
      // `applyScavenging` already draw between fainted (lootable, not
      // eatable) and truly dead (both).
      const corpse = corpseWithinReach(world, agent, (a) => isTrulyDead(a) && !a.isEgg && !a.butchered);
      if (!corpse) return false;
      const capacity = carryCapacityOf(world, agent);
      const knifeEquipped = agent.equipment?.held === "flintKnife";
      const yields: MaterialId[] = knifeEquipped ? ["meat", "meat", "hide"] : ["meat"];
      const butchered: { itemKey: string; count: number }[] = [];
      for (const m of yields) {
        if (carriedWeight(agent) + MATERIALS[m].weight > capacity) continue;
        addItem(agent, m, 1, MATERIALS[m].weight);
        const existing = butchered.find((b) => b.itemKey === m);
        if (existing) existing.count++;
        else butchered.push({ itemKey: m, count: 1 });
      }
      // Nothing fit at all — leave the corpse un-butchered so a fuller
      // pack later (or dropping something first) can still come back for
      // it, same "no room, nothing happened" shape `gather` already has.
      if (butchered.length === 0) return false;
      corpse.butchered = true;
      out.butchered = butchered;
      log?.record({ kind: "butchered", tick: world.tick, agentId: agent.id, species: agent.species, fromId: corpse.id, fromSpecies: corpse.species, itemKeys: butchered.map((b) => b.itemKey) });
      return true;
    }
  }
}

/** A truly-dead, not-yet-butchered corpse (or anything else `pred` names) on the player's own tile or one of the 8 around it — same reach `waterWithinReach`/`nearFire` already scan. */
function corpseWithinReach(world: World, agent: Agent, pred: (candidate: Agent) => boolean): Agent | undefined {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = agent.pos.x + dx;
      const y = agent.pos.y + dy;
      const found = world.agents.find((a) => a.id !== agent.id && a.layer === agent.layer && a.pos.x === x && a.pos.y === y && pred(a));
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Two bites (a sim `consume` takes `CONSUME_STOCK_AMOUNT` = 0.35). Flora's
 * natural decay eats ~0.008 a tick, so a single bite's worth was gone in
 * ~45 ticks — before a wary creature had backed-off room to come and eat
 * it. This lasts ~90.
 */
const OFFERED_FOOD_STOCK = CONSUME_STOCK_AMOUNT * 2;

/**
 * Which carried food material `eat`/`offer` should act on. An explicit
 * `itemKey` (the pack menu's per-row button, naming exactly which stack was
 * tapped) is honored only if it's a real food material the agent actually
 * carries — never falls back silently to a different one just because the
 * named one turned out to be empty or bogus, which would be the same
 * "wrong item consumed" bug this exists to prevent. Omitted `itemKey` (the
 * 'e' key/HUD button, with no specific row to name) keeps the original
 * "first one found" pick, in `FOOD_MATERIAL_IDS` order.
 */
/**
 * A cooked dish (`ItemDef.cooked`) is real food too — crafted, not a
 * MaterialId, so it isn't in `FOOD_MATERIAL_IDS` at all. Checked alongside
 * it here so a cooked dish gets Eat/Offer treatment the same as any raw
 * crop.
 */
function isFoodItem(world: World, itemKey: string): boolean {
  return (FOOD_MATERIAL_IDS as readonly string[]).includes(itemKey) || world.items?.[itemKey]?.cooked !== undefined;
}

function resolveFoodItem(world: World, agent: Agent, itemKey: string | undefined): string | undefined {
  if (itemKey !== undefined) {
    return isFoodItem(world, itemKey) && countOf(agent, itemKey) > 0 ? itemKey : undefined;
  }
  const firstRaw = FOOD_MATERIAL_IDS.find((id) => countOf(agent, id) > 0);
  if (firstRaw) return firstRaw;
  return (agent.inventory ?? []).find((i) => world.items?.[i.itemKey]?.cooked !== undefined)?.itemKey;
}

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

/** The held item, if it's a waterskin (or any future `holdsWater` item) with room in reach of water. */
function canFillWaterskin(world: World, agent: Agent): boolean {
  const held = agent.equipment?.held ? world.items?.[agent.equipment.held] : undefined;
  if (!held?.holdsWater) return false;
  return waterWithinReach(world, agent) && (agent.waterskinCharges ?? 0) < (held.waterCapacity ?? 0);
}

function finishGather(world: World, agent: Agent, out: PlayerActionOutcome): boolean {
  const capacity = carryCapacityOf(world, agent);
  const taken = takeHarvest(world, agent.layer, agent.pos);
  const gathered: { itemKey: string; count: number }[] = [];
  for (const m of taken) {
    if (carriedWeight(agent) + MATERIALS[m].weight > capacity) continue;
    addItem(agent, m, 1, MATERIALS[m].weight);
    gathered.push({ itemKey: m, count: 1 });
  }
  out.gathered = gathered;
  if (gathered.length > 0) return true;
  // Nothing here to take (or the pack was full) — top off the waterskin
  // instead, same one-take-per-gather-turn cadence ordinary harvesting uses.
  if (canFillWaterskin(world, agent)) {
    const held = world.items![agent.equipment!.held!]!;
    agent.waterskinCharges = Math.min(held.waterCapacity ?? 0, (agent.waterskinCharges ?? 0) + 1);
    out.filledWater = agent.waterskinCharges;
    return true;
  }
  return false;
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
/** Direct ask: "my allies should do what i do, so if i drink they should look for water in the area too. if i gather or eat they should do that too." Set on every agent currently following this one; `needs.ts`'s `applyMirroredAction` carries it out over each follower's own action ticks. */
function signalMirrorToFollowers(world: World, leader: Agent, action: "drink" | "gather" | "eat"): void {
  for (const a of world.agents) {
    if (a.followingId === leader.id && a.alive !== false) a.mirrorAction = action;
  }
}

export function waterWithinReach(world: World, agent: Agent): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tileAt(world, agent.layer, agent.pos.x + dx, agent.pos.y + dy)?.terrain === "water") return true;
    }
  }
  return false;
}

/** A deployed campfire's real cooking range — `RecipeDef.requiresNearFire`'s own precondition. A little wider than "adjacent" (`waterWithinReach`'s radius 1): you cook AROUND a fire, not standing in the one tile it occupies. */
const NEAR_FIRE_RADIUS = 2;

export function nearFire(world: World, agent: Agent): boolean {
  for (let dy = -NEAR_FIRE_RADIUS; dy <= NEAR_FIRE_RADIUS; dy++) {
    for (let dx = -NEAR_FIRE_RADIUS; dx <= NEAR_FIRE_RADIUS; dx++) {
      if (tileAt(world, agent.layer, agent.pos.x + dx, agent.pos.y + dy)?.terrain === "fire") return true;
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
