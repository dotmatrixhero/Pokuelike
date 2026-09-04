import type { Agent, PassiveKind, StatusKind, World } from "./types.js";
import type { PokemonType } from "./typing.js";
import type { StatKey } from "./nature.js";
import type { EventLog } from "./events.js";
import { FINISHING_POOL_FRACTION } from "./support.js";
import { herdMembers } from "./herdIndex.js";

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
  move: { statusKind?: StatusKind; statusChance?: number },
  world: World,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  if (!move.statusKind || !move.statusChance) return;
  if (defender.status) return;
  if (isImmuneToStatus(defender.types, move.statusKind)) return;
  if (rng() >= move.statusChance) return;

  const ticksRemaining =
    move.statusKind === "sleep" ? SLEEP_TICKS_MIN + Math.floor(rng() * (SLEEP_TICKS_MAX - SLEEP_TICKS_MIN + 1)) : undefined;
  defender.status = { kind: move.statusKind, ticksRemaining };
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
  rng: () => number = Math.random
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
    maybeInflictStatus(other, attackerId, { statusKind, statusChance: 1 }, world, log, rng);
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
  applyRegenPassive(agent);
  applyHealAuraPassive(agent, world);

  if (agent.alive === false || agent.fainted) return;
  const status = agent.status;
  if (!status) return;

  if (status.kind === "burn" || status.kind === "poison") {
    if (agent.hp === undefined || agent.maxHp === undefined) return;
    const fraction = status.kind === "burn" ? BURN_DAMAGE_FRACTION : POISON_DAMAGE_FRACTION;
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
 * removed by `tickStatStages`, e.g. Bubble Shield's self-buff-on-hit). Never
 * merges with an existing entry on the same `stat` — multiple entries stack
 * additively, read back by `getStatStage`.
 */
export function applyStatStage(agent: Agent, stat: StatKey, stage: number, ticksRemaining?: number): void {
  agent.statStages = agent.statStages ?? [];
  agent.statStages.push({ stat, stage, ticksRemaining });
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

// --- Agent-modifying passives (Agent.passives) ---

/** Grants (accumulates into) a permanent passive — called from `maybeAutoRespec` (leveling.ts) when a node with `grantsPassive` is chosen. */
export function grantPassive(agent: Agent, kind: PassiveKind, value: number): void {
  agent.passives = agent.passives ?? {};
  agent.passives[kind] = (agent.passives[kind] ?? 0) + value;
}

/** The flat fraction of incoming damage the `"damageReduction"` passive takes off — read by `resolveHit` (predation.ts). 0 if the agent has none. */
export function damageReductionOf(agent: Agent): number {
  return Math.min(1, agent.passives?.damageReduction ?? 0);
}

/** True if the `"immovable"` passive should block this agent from being forced-moved — read by `applyForcedMovement` (movement.ts). */
export function isImmovable(agent: Agent): boolean {
  return (agent.passives?.immovable ?? 0) > 0;
}

/** Per-tick HP regen from the `"regen"` passive, on top of (independent of) the fed/watered `applyHealOverTime` (support.ts) — a regen agent heals even while starving. No-op on a corpse or one with no regen passive. */
function applyRegenPassive(agent: Agent): void {
  const fraction = agent.passives?.regen ?? 0;
  if (agent.alive === false || fraction <= 0) return;
  if (agent.hp === undefined || agent.maxHp === undefined) return;
  agent.hp = Math.min(agent.maxHp, agent.hp + agent.maxHp * fraction);
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
  // Scoped to this agent's own herd (herdIndex.ts) rather than a scan of
  // every living agent in the world — see herdMembers's doc comment for the
  // real O(agents²) regression this fixes once more than a handful of
  // agents carry this passive in a large population.
  for (const other of herdMembers(world, agent.herdId)) {
    if (other.layer !== agent.layer) continue;
    if (Math.abs(other.pos.x - agent.pos.x) + Math.abs(other.pos.y - agent.pos.y) > HEAL_AURA_RADIUS) continue;
    if (other.hp === undefined || other.maxHp === undefined) continue;
    other.hp = Math.min(other.maxHp, other.hp + other.maxHp * fraction);
  }
}
