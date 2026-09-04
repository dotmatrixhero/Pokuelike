import type { Agent, StatusKind, World } from "./types.js";
import type { PokemonType } from "./typing.js";
import type { EventLog } from "./events.js";
import { FINISHING_POOL_FRACTION } from "./support.js";

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
