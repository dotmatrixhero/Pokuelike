import type { Agent, PassiveKind, StatusKind, World } from "./types.js";
import type { PokemonType } from "./typing.js";
import type { StatKey } from "./nature.js";
import type { EventLog } from "./events.js";
import { FINISHING_POOL_FRACTION } from "./support.js";
import { herdMembers } from "./herdIndex.js";
import { RAPPORT_HEALED_DELTA, strengthenRapportMutual } from "./rapport.js";
import { findWalkableNear } from "./worldgen.js";

/** Chance a burn spreads to another nearby agent when `MoveSpec.statusSpreads` is set — rolled once per successful `maybeInflictStatus` call, not once per tick. Sim-original magnitude, not canon. */
export const STATUS_SPREAD_CHANCE = 0.3;
/** How far a spreading status can jump — small on purpose, this is "the fire caught on whatever's standing right next to the target," not a plague. */
export const STATUS_SPREAD_RADIUS = 1;

/** Fraction of `maxHp` burn deals every tick — mainline value. */
export const BURN_DAMAGE_FRACTION = 1 / 16;
/** Fraction of `maxHp` poison deals every tick — mainline value. */
export const POISON_DAMAGE_FRACTION = 1 / 8;
/** Chance a paralyzed agent's action tick is skipped outright, on top of its speed cut — mainline (Gen VII+) value. */
export const PARALYSIS_SKIP_CHANCE = 0.25;
/** Multiplies a paralyzed agent's effective Speed in `actionSpeedOf` (simulation.ts) — mainline (Gen VII+) value; pre-Gen-VII was 0.25. */
export const PARALYSIS_SPEED_MULTIPLIER = 0.5;
/** Chance a frozen agent thaws on any given tick, independent of being hit. */
export const FREEZE_THAW_CHANCE = 0.2;
/** Bounded random sleep duration, in ticks. This sim's ticks are far finer-grained than mainline turns, so mainline's "1-3 turns" doesn't transfer directly — picked to be a real, felt lockout without being a de facto death sentence. */
export const SLEEP_TICKS_MIN = 10;
export const SLEEP_TICKS_MAX = 30;
/**
 * The stat stage burn applies to the burned agent's own Attack whenever it's
 * the attacker in `calculateDamage` (combat.ts). -2 stages is exactly a 50%
 * multiplier (`statStageMultiplier(-2) === 2/(2+2)`) — mainline burn halves
 * physical Attack specifically, so this only matters for physical moves
 * (`calculateDamage` only reads `statStages.attack` when `move.category ===
 * "physical"`). Reuses the stat-stage math that already exists in
 * combat.ts rather than inventing a second, parallel damage multiplier.
 */
export const BURN_ATTACK_STAGE = -2;

/**
 * Real mainline type immunities to specific statuses — free, since
 * `defender.types` is already on hand wherever a status roll happens.
 */
const STATUS_IMMUNE_TYPES: Record<StatusKind, PokemonType[]> = {
  burn: ["fire"],
  paralysis: ["electric"],
  poison: ["poison", "steel"],
  freeze: ["ice"],
  sleep: [],
};

export function isImmuneToStatus(types: PokemonType[] | undefined, kind: StatusKind): boolean {
  return (types ?? []).some((t) => STATUS_IMMUNE_TYPES[kind].includes(t));
}

export function isParalyzed(agent: Agent): boolean {
  return agent.status?.kind === "paralysis";
}

export function isAsleep(agent: Agent): boolean {
  return agent.status?.kind === "sleep";
}

export function isFrozen(agent: Agent): boolean {
  return agent.status?.kind === "freeze";
}

export function isBurned(agent: Agent): boolean {
  return agent.status?.kind === "burn";
}

/**
 * Rolls and applies a move's status on a landed, damaging, non-killing hit
 * — called from `resolveHit` (predation.ts) right where
 * `maybeGrantHitSkillPoint` already piggybacks on the same hit. No-ops if
 * the move doesn't carry a `statusKind`, the roll fails, the defender
 * already carries any status (at most one at a time, mainline-real), or the
 * defender's typing is immune to this particular kind.
 */
export function maybeInflictStatus(
  defender: Agent,
  attackerId: string,
  move: { statusKind?: StatusKind; statusChance?: number; statusSeverity?: number },
  world: World,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  if (!move.statusKind || !move.statusChance) return;
  if (defender.status) return;
  if (defender.statusImmuneTicksRemaining) return;
  if (isImmuneToStatus(defender.types, move.statusKind)) return;
  if (rng() >= move.statusChance) return;

  const ticksRemaining =
    move.statusKind === "sleep" ? SLEEP_TICKS_MIN + Math.floor(rng() * (SLEEP_TICKS_MAX - SLEEP_TICKS_MIN + 1)) : undefined;
  defender.status = { kind: move.statusKind, ticksRemaining, severityMultiplier: move.statusSeverity };
  log?.record({
    kind: "statusInflicted",
    tick: world.tick,
    agentId: defender.id,
    species: defender.species,
    statusKind: move.statusKind,
    inflictedBy: attackerId,
  });
}

/**
 * When `MoveSpec.statusSpreads` is set and `maybeInflictStatus` just landed a
 * status on `defender`, rolls a second, independent chance to inflict the
 * same status on one other living agent within `STATUS_SPREAD_RADIUS` —
 * "the fire caught on whatever's standing right next to the target too."
 * Deliberately a plain manhattan-distance scan over `world.agents` rather
 * than importing predation.ts's `agentsWithin` (which would create a real
 * import cycle — predation.ts already imports this module). No-op if the
 * roll fails, no other living agent is in range, or that agent is already
 * statused/immune (same checks `maybeInflictStatus` itself makes).
 */
export function maybeSpreadStatus(
  defender: Agent,
  attackerId: string,
  statusKind: StatusKind,
  world: World,
  log?: EventLog,
  rng: () => number = Math.random,
  statusSeverity?: number
): void {
  if (rng() >= STATUS_SPREAD_CHANCE) return;

  const nearby = world.agents.filter(
    (other) =>
      other.id !== defender.id &&
      other.alive !== false &&
      other.layer === defender.layer &&
      Math.abs(other.pos.x - defender.pos.x) + Math.abs(other.pos.y - defender.pos.y) <= STATUS_SPREAD_RADIUS
  );
  for (const other of nearby) {
    maybeInflictStatus(other, attackerId, { statusKind, statusChance: 1, statusSeverity }, world, log, rng);
    if (other.status?.kind === statusKind) return; // spread to the first eligible neighbor only
  }
}

/**
 * A landed Fire-type hit thaws a frozen target instantly, mainline-real —
 * called from `resolveHit` alongside `maybeInflictStatus`, independent of
 * whether that hit's own move inflicts anything itself.
 */
export function maybeThawOnFireHit(defender: Agent, moveType: PokemonType, world: World, log?: EventLog): void {
  if (!isFrozen(defender) || moveType !== "fire") return;
  defender.status = undefined;
  log?.record({ kind: "statusCleared", tick: world.tick, agentId: defender.id, species: defender.species, statusKind: "freeze", reason: "thawed" });
}

/** Sets `fainted`/`finishingPool` and clears any status — the same faint transition `resolveHit` applies on a killing hit, reused here so a DOT tick that finishes an agent off behaves identically either way. */
function faintFromStatus(agent: Agent, world: World, log?: EventLog): void {
  agent.fainted = true;
  agent.finishingPool = FINISHING_POOL_FRACTION * (agent.maxHp ?? 0);
  agent.status = undefined;
  log?.record({ kind: "fainted", tick: world.tick, agentId: agent.id, species: agent.species, pos: agent.pos });
}

/**
 * The always-runs-every-tick half of status resolution — called from
 * `tickAgentNeeds` (needs.ts), the same architectural slot `tickCooldowns`/
 * `decayNeeds` already occupy, so a statused agent keeps ticking down even
 * on ticks it doesn't act. Handles:
 * - Burn/poison: a fixed fraction of `maxHp` in damage. Reaching 0 faints
 *   (via `faintFromStatus`), it never kills outright — same as a normal
 *   attack's own faint/finishing-pool pipeline (`resolveHit`).
 * - Sleep: counts `ticksRemaining` down, clearing (`reason: "woke"`) at 0.
 * - Freeze: rolls `FREEZE_THAW_CHANCE` to clear early (`reason: "thawed"`).
 * - Paralysis: no per-tick effect here — its speed cut lives in
 *   `actionSpeedOf` (simulation.ts) and its skip-the-action-tick roll in
 *   `tickAgentAction` (needs.ts), both real-time/action-tick concerns, not
 *   this always-runs one.
 * No-ops on a corpse or an agent already fainted (nothing left to tick).
 */
export function tickStatusEffects(agent: Agent, world: World, log?: EventLog, rng: () => number = Math.random): void {
  tickStatStages(agent);
  tickActionLock(agent);
  tickRallyMark(agent);
  tickStatusImmunity(agent);
  tickMatingRadiusBoost(agent);
  tickBurrow(agent, world);
  tickChargingAttack(agent);
  tickUnshaken(agent);
  // Ticked here rather than in fire.ts so it counts down every tick even
  // once the agent has stepped off the fire — same always-runs placement as
  // every other per-tick countdown in this function.
  if (agent.regenSuppressedTicks) agent.regenSuppressedTicks = Math.max(0, agent.regenSuppressedTicks - 1);
  applyRegenPassive(agent);
  applyHealAuraPassive(agent, world);

  if (agent.alive === false || agent.fainted) return;
  const status = agent.status;
  if (!status) return;

  if (status.kind === "burn" || status.kind === "poison") {
    if (agent.hp === undefined || agent.maxHp === undefined) return;
    const fraction = (status.kind === "burn" ? BURN_DAMAGE_FRACTION : POISON_DAMAGE_FRACTION) * (status.severityMultiplier ?? 1);
    agent.hp = Math.max(0, agent.hp - agent.maxHp * fraction);
    if (agent.hp <= 0) faintFromStatus(agent, world, log);
    return;
  }

  if (status.kind === "sleep") {
    const remaining = (status.ticksRemaining ?? 1) - 1;
    if (remaining <= 0) {
      agent.status = undefined;
      log?.record({ kind: "statusCleared", tick: world.tick, agentId: agent.id, species: agent.species, statusKind: "sleep", reason: "woke" });
    } else {
      status.ticksRemaining = remaining;
    }
    return;
  }

  if (status.kind === "freeze" && rng() < FREEZE_THAW_CHANCE) {
    agent.status = undefined;
    log?.record({ kind: "statusCleared", tick: world.tick, agentId: agent.id, species: agent.species, statusKind: "freeze", reason: "thawed" });
  }
}

// --- Persistent/temporary stat stages (Agent.statStages) ---

/**
 * Adds one stat-stage entry — a permanent one (no `ticksRemaining`, e.g.
 * Growl's designed Attack-lowering AoE) or a temporary one (counted down and
 * removed by `tickStatStages`, e.g. Bubble Shield's self-buff-on-hit).
 *
 * ONE ENTRY PER (stat, sourceMoveId). Using the same move again does not
 * stack a second copy — it overwrites the stage and refreshes the timer.
 * Direct: "if something gives you +1 stage of attack, using it again should
 * not give you another stage, merely refresh timer. However a DIFFERENT move
 * could give you another stage."
 *
 * This is a real cap, not bookkeeping. `applyStatStage` used to push
 * unconditionally, so a self-buffing move used N times was +N stages
 * forever — and `maybeUseUtilityMoveInCombat`'s own two-stage ceiling was
 * the ONLY thing standing between a status move and unbounded stacking, on
 * one of the two paths that call this. Spamming was strictly better than
 * building.
 *
 * What still stacks, on purpose:
 *   - Different moves. Harden and Withdraw both buying Defense is a real
 *     build, and each keeps its own entry.
 *   - Different nodes of the SAME move within ONE use, because the caller
 *     sums them before calling here — "+1 stage from one node, and +2 stage
 *     from another, you COULD get to +3 stage with one use, but NOT +6 if
 *     you use the move twice."
 *
 * `sourceMoveId` absent means "no move behind this" and never merges — a
 * designed permanent effect or a bare-engine test keeps the old behaviour.
 */
export function applyStatStage(
  agent: Agent,
  stat: StatKey,
  stage: number,
  ticksRemaining?: number,
  sourceMoveId?: string
): void {
  agent.statStages = agent.statStages ?? [];
  if (sourceMoveId !== undefined) {
    const existing = agent.statStages.find((s) => s.stat === stat && s.sourceMoveId === sourceMoveId);
    if (existing) {
      // Overwrite rather than max(): a build that has since been re-specced
      // into a WEAKER version of the same node should read as weaker, and a
      // debuff (negative stage) refreshing has to move the same direction.
      existing.stage = stage;
      existing.ticksRemaining = ticksRemaining;
      return;
    }
  }
  agent.statStages.push({ stat, stage, ticksRemaining, sourceMoveId });
}

/** Sum of every stacked entry's `stage` for `stat` — what `calculateDamage`/`actionSpeedOf` feed into `statStageMultiplier`. 0 if none. */
export function getStatStage(agent: Agent, stat: StatKey): number {
  return (agent.statStages ?? []).filter((s) => s.stat === stat).reduce((sum, s) => sum + s.stage, 0);
}

/** Ticks down every temporary (has `ticksRemaining`) stat-stage entry, dropping it once it expires. Permanent entries (no `ticksRemaining`) are untouched. No-op on a corpse. */
function tickStatStages(agent: Agent): void {
  if (agent.alive === false || !agent.statStages) return;
  agent.statStages = agent.statStages.filter((s) => {
    if (s.ticksRemaining === undefined) return true;
    s.ticksRemaining -= 1;
    return s.ticksRemaining > 0;
  });
  if (agent.statStages.length === 0) agent.statStages = undefined;
}

// --- Multi-action lock (Agent.actionLockTicks) ---

/** Ticks down a move-imposed action lock (`MoveSpec.lockTicks`, set via `useMove` in combat.ts). No-op on a corpse. */
function tickActionLock(agent: Agent): void {
  if (agent.alive === false || !agent.actionLockTicks) return;
  agent.actionLockTicks = Math.max(0, agent.actionLockTicks - 1);
}

/** Ticks down a `MoveSpec.rallyCall` focus-fire mark (`predation.ts`'s `preferMarked`). No-op on a corpse. */
function tickRallyMark(agent: Agent): void {
  if (agent.alive === false || !agent.rallyMarkTicksRemaining) return;
  agent.rallyMarkTicksRemaining = Math.max(0, agent.rallyMarkTicksRemaining - 1);
}

/** Ticks down a `MoveSpec.statusImmunityAura` grant (`maybeInflictStatus`'s early guard above). No-op on a corpse. */
function tickStatusImmunity(agent: Agent): void {
  if (agent.alive === false || !agent.statusImmuneTicksRemaining) return;
  agent.statusImmuneTicksRemaining = Math.max(0, agent.statusImmuneTicksRemaining - 1);
}

/** Ticks down a `MoveSpec.matingRadiusBoost` grant (`reproduction.ts`'s mate search). No-op on a corpse. */
function tickMatingRadiusBoost(agent: Agent): void {
  if (agent.alive === false || !agent.matingRadiusBoostTicksRemaining) return;
  agent.matingRadiusBoostTicksRemaining = Math.max(0, agent.matingRadiusBoostTicksRemaining - 1);
}

/**
 * Ticks down a `MoveSpec.burrow` self-escape (set in `applyPredationInstincts`'s
 * flee branch, predation.ts) — reaching 0 resurfaces the agent to
 * `burrowedFromLayer` and clears both fields. No-op on a corpse.
 */
function tickBurrow(agent: Agent, world: World): void {
  if (agent.alive === false || !agent.burrowedTicksRemaining) return;
  agent.burrowedTicksRemaining = Math.max(0, agent.burrowedTicksRemaining - 1);
  if (agent.burrowedTicksRemaining === 0 && agent.burrowedFromLayer) {
    agent.layer = agent.burrowedFromLayer;
    agent.burrowedFromLayer = undefined;
    // Same real bug as needs.ts's seekWater/seekFood cross-layer fix: this
    // agent's (x, y) hasn't moved since it burrowed, and resurfacing to
    // Surface (the layer it almost always fled FROM) at that unchanged
    // position has no guarantee it's not the middle of a lake. Reuses the
    // identical relocate-to-nearest-safe-tile fix.
    agent.pos = findWalkableNear(world, agent.layer, agent.pos.x, agent.pos.y);
  }
}

/**
 * Ticks down a `MoveSpec.chargeAttack` wind-up (`Agent.chargingAttack`'s own
 * doc comment, types.ts) — pure bookkeeping only, same shape as `tickBurrow`
 * above. Deliberately does NOT resolve the attack itself when it reaches 0:
 * that needs predation.ts's own hit-resolution machinery, which status.ts
 * doesn't import (a real cycle with predation.ts — see this file's own
 * `maybeSpreadStatus` for the same constraint elsewhere). `tickAgentNeeds`
 * (needs.ts, which already imports from predation.ts) checks
 * `ticksRemaining <= 0` right after calling `tickStatusEffects` and calls
 * `resolveChargedAttack` (predation.ts) itself. No-op on a corpse.
 */
function tickChargingAttack(agent: Agent): void {
  if (agent.alive === false || !agent.chargingAttack) return;
  agent.chargingAttack.ticksRemaining = Math.max(0, agent.chargingAttack.ticksRemaining - 1);
}

/** Ticks down the `"unshaken"` passive's recharge — see `Agent.unshakenCooldownTicks`'s own doc comment (types.ts). Pure bookkeeping, same shape as `tickBurrow`/`tickChargingAttack` above; the shield itself is checked and consumed directly in `resolveHitAgainstTarget` (predation.ts). No-op on a corpse. */
function tickUnshaken(agent: Agent): void {
  if (agent.alive === false || !agent.unshakenCooldownTicks) return;
  agent.unshakenCooldownTicks = Math.max(0, agent.unshakenCooldownTicks - 1);
}

/**
 * How long any damage taken holds `regen`/`healAura` down. Roughly a couple
 * of move cooldowns: long enough that passive healing can't out-tick a real
 * fight, short enough that a unit that disengages is genuinely recovering
 * rather than permanently locked out. See `Agent.regenSuppressedTicks`.
 */
export const REGEN_COMBAT_SUPPRESSION_TICKS = 8;

/** Marks an agent as recently hurt, suppressing its PASSIVE healing for `REGEN_COMBAT_SUPPRESSION_TICKS`. Called from every damage site (predation.ts's hit/recoil/thorns, fire.ts). Refreshes rather than stacking. */
export function suppressPassiveHealing(agent: Agent, ticks = REGEN_COMBAT_SUPPRESSION_TICKS): void {
  agent.regenSuppressedTicks = Math.max(agent.regenSuppressedTicks ?? 0, ticks);
}

/** True while passive healing (`regen`/`healAura`) is gated off by recent damage. */
export function isPassiveHealingSuppressed(agent: Agent): boolean {
  return (agent.regenSuppressedTicks ?? 0) > 0;
}

// --- Agent-modifying passives (Agent.passives) ---

/** Grants (accumulates into) a permanent passive — called from `maybeAutoRespec` (leveling.ts) when a node with `grantsPassive` is chosen. */
export function grantPassive(agent: Agent, kind: PassiveKind, value: number): void {
  agent.passives = agent.passives ?? {};
  agent.passives[kind] = (agent.passives[kind] ?? 0) + value;
}

/**
 * Takes a passive back — the exact inverse of `grantPassive`, used by
 * `forgetMove` (leveling.ts) when a whole move tree is unlearned.
 *
 * Without this, forgetting would be pure upside: an agent could max a tree,
 * bank every passive it granted permanently, forget the move, take the full
 * skill-point refund and spend it again elsewhere. Passives are the game's
 * scarcest currency precisely because they stack across every move an agent
 * knows, so "knows" has to mean something.
 *
 * Clamps at zero and clears the key entirely when it lands there, so a
 * passive nothing grants any more reads as absent rather than as a 0 that
 * every `?? 0` would treat identically but every dump would still show.
 */
export function revokePassive(agent: Agent, kind: PassiveKind, value: number): void {
  if (!agent.passives) return;
  const next = (agent.passives[kind] ?? 0) - value;
  if (next > 1e-9) agent.passives[kind] = next;
  else delete agent.passives[kind];
}

/**
 * The fraction of incoming damage the `"damageReduction"` passive takes
 * off, **after diminishing returns** — read by `resolveHit` (predation.ts).
 * 0 if the agent has none.
 *
 * The raw passive is an uncapped running sum (`grantPassive` is a `+=` and
 * tree choices are permanent), so it has the same runaway shape `regen` did:
 * measured on a pre-fix 20k-tick run, 1234 of 1368 living agents carried
 * some, median 0.15, p90 0.25, max 0.33 — a third of all incoming damage
 * simply deleted, on every hit, forever.
 *
 * The curve is hyperbolic, `x / (1 + x)`:
 *
 * | raw sum | effective |
 * |---|---|
 * | 0.05 | 0.048 |
 * | 0.15 | 0.130 |
 * | 0.25 | 0.200 |
 * | 0.33 | 0.248 |
 * | 1.00 | 0.500 |
 * | 3.00 | 0.750 |
 *
 * Chosen over a hard cap for two reasons: a single node is worth almost
 * exactly its face value (so early nodes still feel like what they say),
 * and there is no cliff where further investment silently does nothing —
 * it just gets progressively worse value, and can never reach immunity.
 * Percentage reduction is the capstone-tier version of this passive; the
 * common nodes grant `"damageReductionFlat"` instead, same split as
 * `regen`/`regenFlat`.
 */
export function damageReductionOf(agent: Agent): number {
  const raw = Math.max(0, agent.passives?.damageReduction ?? 0);
  return raw / (1 + raw);
}

/**
 * Flat HP taken off an incoming hit by the `"damageReductionFlat"` passive,
 * applied AFTER the percentage reduction above — read by `resolveHit`
 * (predation.ts), which enforces that a landed hit still does at least
 * `MIN_LANDED_DAMAGE`, so flat armor can blunt a weak hit but never make a
 * unit outright immune to one. 0 if the agent has none.
 *
 * Scales the way flat healing does and for the same reason: 2 points off a
 * 12-damage early hit matters, 2 points off a 60-damage late one barely
 * registers.
 */
export function damageReductionFlatOf(agent: Agent): number {
  return Math.max(0, agent.passives?.damageReductionFlat ?? 0);
}

/** True if the `"immovable"` passive should block this agent from being forced-moved — read by `applyForcedMovement` (movement.ts). */
export function isImmovable(agent: Agent): boolean {
  return (agent.passives?.immovable ?? 0) > 0;
}

/**
 * Extra permanent Defense stat-stage from the `"defenseBoost"` passive —
 * added on top of the agent's own stacked `statStages` entries in
 * `applySingleDamageInstance` (predation.ts). Physical-only for free: a
 * special move never reads the `defense` field at all (`calculateDamage`
 * reads `spDefense` instead), so this never needs its own category check.
 * 0 if the agent has none.
 */
export function defenseBoostOf(agent: Agent): number {
  return agent.passives?.defenseBoost ?? 0;
}

/** Per-tick HP regen from the `"regen"` (fraction of max HP) and `"regenFlat"` (absolute HP) passives, on top of (independent of) the fed/watered `applyHealOverTime` (support.ts) — a regen agent heals even while starving. No-op on a corpse or one with no regen passive. */
function applyRegenPassive(agent: Agent): void {
  const fraction = agent.passives?.regen ?? 0;
  const flat = agent.passives?.regenFlat ?? 0;
  if (agent.alive === false || (fraction <= 0 && flat <= 0)) return;
  // Any recent damage holds passive regen down — see
  // `Agent.regenSuppressedTicks` for why passive healing specifically is
  // the kind that needs an out-of-combat gate.
  if (isPassiveHealingSuppressed(agent)) return;
  if (agent.hp === undefined || agent.maxHp === undefined) return;
  const share = softCapHealShare(fraction + flat / agent.maxHp);
  agent.hp = Math.min(agent.maxHp, agent.hp + agent.maxHp * share);
}

/**
 * Below this share of max HP per tick, passive healing is worth exactly its
 * face value — a node that says it heals 2 HP heals 2 HP. Above it, the
 * excess is squeezed toward `PASSIVE_HEAL_CEILING` and never reaches it.
 */
export const PASSIVE_HEAL_KNEE = 0.03;

/** Hard asymptote on passive healing per tick, as a share of max HP. Approached, never attained. */
export const PASSIVE_HEAL_CEILING = 0.08;

/**
 * Soft-caps total passive healing (percentage `regen` plus `regenFlat`
 * expressed as a share of max HP) for the same reason `damageReductionOf`
 * has diminishing returns: passives accumulate permanently across every
 * move a unit knows, so what matters is the SUM, not any single node.
 *
 * This one is a correction of a mistake made in this very system. Converting
 * the common healing nodes from percentage to flat was supposed to make
 * healing weaker late and stronger early — and it did — but flat values
 * stack additively just like percentages, and dividing by a SMALL maxHp
 * makes a stack worse rather than better. Measured after that change: a 51
 * HP unit at 17.65%/tick, above the 11%/tick that prompted the original
 * work. The shape was right; nothing bounded the total.
 *
 * Piecewise rather than a plain hyperbolic, deliberately. `x / (1 + x/C)`
 * would asymptote correctly but shaves ~20% off even a single small node,
 * which breaks the rule that a node delivers what it says. Instead
 * everything up to `PASSIVE_HEAL_KNEE` passes through untouched, and only
 * the excess is compressed:
 *
 * | raw share | effective |
 * |---|---|
 * | 0.02 | 0.020 (untouched) |
 * | 0.03 | 0.030 (untouched) |
 * | 0.05 | 0.044 |
 * | 0.09 | 0.058 |
 * | 0.1765 | 0.067 |
 * | infinity | 0.080 |
 *
 * So a couple of healing nodes are exactly as good as they read, a heavily
 * stacked build still heals faster than a light one, and no build reaches
 * the six-tick full heal the flat conversion had accidentally created.
 */
export function softCapHealShare(raw: number): number {
  if (raw <= PASSIVE_HEAL_KNEE) return Math.max(0, raw);
  const excess = raw - PASSIVE_HEAL_KNEE;
  const headroom = PASSIVE_HEAL_CEILING - PASSIVE_HEAL_KNEE;
  return PASSIVE_HEAL_KNEE + excess / (1 + excess / headroom);
}

/** The flat fraction of damage taken the `"thorns"` passive reflects back at the attacker — read by `applySingleDamageInstance` (predation.ts). 0 if the agent has none. */
export function thornsOf(agent: Agent): number {
  return Math.max(0, agent.passives?.thorns ?? 0);
}

/**
 * Per-tick HP regen from the `"healAura"` passive, applied to every living,
 * same-herd agent within `HEAL_AURA_RADIUS` of the passive-holder (the
 * holder itself included — its own `regen`, if any, already covers the
 * holder-only case, but there's no reason this aura should skip it) —
 * distinct from `applyRegenPassive` above, which only ever heals the
 * passive-holder itself. No-op on a corpse, one with no `healAura` passive,
 * or when `world` isn't available (bare test fixtures calling
 * `tickStatusEffects` with a world are the norm; this simply skips without
 * one, same graceful-absence pattern as every other world-dependent check
 * in this file).
 */
const HEAL_AURA_RADIUS = 3;
function applyHealAuraPassive(agent: Agent, world: World): void {
  const fraction = agent.passives?.healAura ?? 0;
  if (agent.alive === false || fraction <= 0 || !agent.herdId) return;
  // The aura HOLDER being in combat doesn't stop it; each RECIPIENT is
  // checked below instead. A support unit hanging back should still be
  // healing, and a unit being hit should still not be passively healing —
  // gating on the holder would get both of those backwards.
  // Scoped to this agent's own herd (herdIndex.ts) rather than a scan of
  // every living agent in the world — see herdMembers's doc comment for the
  // real O(agents²) regression this fixes once more than a handful of
  // agents carry this passive in a large population.
  for (const other of herdMembers(world, agent.herdId)) {
    if (other.layer !== agent.layer) continue;
    if (Math.abs(other.pos.x - agent.pos.x) + Math.abs(other.pos.y - agent.pos.y) > HEAL_AURA_RADIUS) continue;
    if (other.hp === undefined || other.maxHp === undefined) continue;
    if (isPassiveHealingSuppressed(other)) continue;
    const before = other.hp;
    other.hp = Math.min(other.maxHp, other.hp + other.maxHp * fraction);
    // Rapport: real agent-to-agent healing, which until now built nothing.
    // Gated on HP having actually moved — topping up a herd-mate already at
    // full health is arithmetically a no-op, and letting a no-op read as
    // care would make every aura holder "close" to everyone standing near
    // it. Throttled per `RAPPORT_REASON_MEMORY_INTERVAL`, since this runs
    // every tick a hurt ally is in range.
    if (other.hp > before) {
      strengthenRapportMutual(world, agent, other, RAPPORT_HEALED_DELTA, "healed", "wasHealed");
    }
  }
}
