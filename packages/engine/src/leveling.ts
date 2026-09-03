import type { Agent, World } from "./types.js";
import type { PokemonType } from "./typing.js";
import type { MoveSpec } from "./moves.js";
import type { BaseStats } from "./stats.js";
import { calculateStats } from "./stats.js";
import type { EventLog } from "./events.js";

/** PokeRogue's `GrowthRate` enum keys, e.g. as imported onto `SpeciesDexEntry.growthRate`. */
export type GrowthRateKey = "ERRATIC" | "FAST" | "MEDIUM_FAST" | "MEDIUM_SLOW" | "SLOW" | "FLUCTUATING";

/**
 * The six mainline growth-rate curves, implemented directly from the public
 * piecewise polynomial formulas (not scraped from PokeRogue — see DESIGN.md).
 * Returns the *cumulative total* exp required to reach `level` (matches the
 * shape of the reference table this was checked against).
 *
 * Verified numerically against every entry (levels 2-100, level 1 excepted —
 * see below) of `poke_the_spire/src/data/exp.ts`'s raw per-growth-rate
 * `expLevels` arrays for all six curves: zero mismatches. (Level 1 is
 * special-cased to 0 here, matching real mainline; the raw formulas alone
 * produce a small nonzero residual at level 1 for several curves, which
 * PokeRogue's own table also overrides to 0.) Deliberately NOT cross-checked
 * against PokeRogue's *exported* `getLevelTotalExp` function — that function
 * additionally blends every non-Medium-Fast curve 32.5%/67.5% with Medium
 * Fast (a PokeRogue-specific balance house-rule, not real mainline behavior),
 * so its output differs from pure mainline on purpose; the raw tables (pre-
 * blend) are the real correctness reference and that's what this was checked
 * against.
 */
export function totalExpForLevel(growthRate: GrowthRateKey, level: number): number {
  if (level <= 1) return 0;
  const n = level;
  switch (growthRate) {
    case "ERRATIC": {
      if (n < 50) return Math.floor((n ** 3 * (100 - n)) / 50);
      if (n < 68) return Math.floor((n ** 3 * (150 - n)) / 100);
      if (n < 98) return Math.floor((n ** 3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n ** 3 * (160 - n)) / 100);
    }
    case "FAST":
      return Math.floor((4 * n ** 3) / 5);
    case "MEDIUM_FAST":
      return n ** 3;
    case "MEDIUM_SLOW":
      return Math.floor((6 / 5) * n ** 3 - 15 * n ** 2 + 100 * n - 140);
    case "SLOW":
      return Math.floor((5 * n ** 3) / 4);
    case "FLUCTUATING": {
      if (n < 15) return Math.floor(n ** 3 * ((Math.floor((n + 1) / 3) + 24) / 50));
      if (n < 36) return Math.floor((n ** 3 * (n + 14)) / 50);
      return Math.floor((n ** 3 * (Math.floor(n / 2) + 32)) / 50);
    }
  }
}

const MAX_LEVEL = 100;

/** The highest level whose cumulative exp threshold `exp` has crossed, capped at `MAX_LEVEL`. */
export function levelForExp(growthRate: GrowthRateKey, exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && totalExpForLevel(growthRate, level + 1) <= exp) level++;
  return level;
}

/** Per-species data `grantExp` needs that only `packages/data`'s dex actually has — injected, same pattern as `HuntRules`. */
export interface LevelingProfile {
  growthRate: GrowthRateKey;
  baseStats: BaseStats;
  /** Base form's typing — a newborn's starting types (see `baseSpeciesOf` below: breeding produces the base form, not whatever the parent evolved into). */
  types: PokemonType[];
  /** Wild-battle base exp yield: floor(baseExp * defeatedLevel / 7) on a kill. */
  baseExp: number;
  /** [level, move key] pairs, unsorted-safe — every entry with level <= newLevel is learned. */
  levelMoves: Array<[number, string]>;
  /** Level-gated evolutions only (item/trade/friendship deferred — see DESIGN.md). */
  evolutions: Array<{ targetSpeciesId: string; level: number }>;
}

export interface LevelingContext {
  /** Looks up a `LevelingProfile` by the sim's `Agent.species` id. Undefined = exp still accrues but nothing can level/evolve/learn (unknown species). */
  getProfile(speciesId: string): LevelingProfile | undefined;
  /** Resolves a level-move's key to a usable `MoveSpec`. Undefined = can't be represented in combat (e.g. a status move — see DESIGN.md) but is still recorded in `knownMoves` and logged. */
  resolveMove(moveKey: string): MoveSpec | undefined;
  /**
   * The root (pre-evolution) species of `speciesId`'s line — e.g.
   * "venusaur" -> "bulbasaur". Breeding always produces the base form
   * (mainline-accurate: a bred Venusaur's offspring hatches as a
   * Bulbasaur, never another Venusaur), so `spawnOffspring` uses this
   * instead of the mother's own (possibly evolved) species. Optional so
   * bare-engine tests without dex data keep working — falls back to the
   * parent's own species when absent.
   */
  baseSpeciesOf?(speciesId: string): string;
}

// --- Tuning constants for non-combat exp sources (sim-original, no canon formula exists for these — see DESIGN.md) ---
export const EXP_TRICKLE_PER_TICK = 0.02;
export const EXP_ON_CONSUME = 0.5;
export const EXP_ON_MATE_ATTEMPT = 1;
export const EXP_ON_BIRTH_PARENT = 3;
export const EXP_ON_NEW_SECTOR = 2;
export const EXP_ON_NEW_SPECIES_ENCOUNTERED = 2;

/** Sector size (tiles per side) for the coarse "visited a new area" bucketing. */
export const SECTOR_SIZE = 5;
export const MAX_TRACKED_SECTORS = 40;
export const MAX_TRACKED_SPECIES = 20;

/** Chance a landed hit grants the attacker one skill point of the move's own type. */
export const SKILLPOINT_ON_HIT_CHANCE = 0.05;
/** Chance a level-up additionally grants one wildcard skill point (on top of the guaranteed typed one). */
export const SKILLPOINT_LEVELUP_WILDCARD_CHANCE = 0.1;

export function sectorId(x: number, y: number): string {
  return `${Math.floor(x / SECTOR_SIZE)},${Math.floor(y / SECTOR_SIZE)}`;
}

/** Appends `value` to a capped list (oldest dropped first) if not already present. Mutates and returns the list. */
function rememberCapped(list: string[] | undefined, value: string, cap: number): string[] {
  const arr = list ?? [];
  if (arr.includes(value)) return arr;
  arr.push(value);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
  return arr;
}

/** Records a newly-entered map sector; grants a small exp trickle the first time this agent visits it. */
export function markSectorVisited(agent: Agent, world: World, ctx?: LevelingContext, log?: EventLog): void {
  const id = sectorId(agent.pos.x, agent.pos.y);
  if (agent.visitedSectors?.includes(id)) return;
  agent.visitedSectors = rememberCapped(agent.visitedSectors, id, MAX_TRACKED_SECTORS);
  grantExp(world, agent, EXP_ON_NEW_SECTOR, ctx, log);
}

/** Records a newly-encountered species (an agent within `radius` of `others`); grants a small exp trickle the first time. */
export function markSpeciesEncountered(agent: Agent, species: string, world: World, ctx?: LevelingContext, log?: EventLog): void {
  if (species === agent.species || agent.encounteredSpecies?.includes(species)) return;
  agent.encounteredSpecies = rememberCapped(agent.encounteredSpecies, species, MAX_TRACKED_SPECIES);
  grantExp(world, agent, EXP_ON_NEW_SPECIES_ENCOUNTERED, ctx, log);
}

/** Grants one skill point (typed or wildcard) and logs it. */
export function grantSkillPoint(agent: Agent, pointType: PokemonType | "wildcard", world: World, log?: EventLog): void {
  if (pointType === "wildcard") {
    agent.wildcardSkillPoints = (agent.wildcardSkillPoints ?? 0) + 1;
  } else {
    agent.skillPoints = agent.skillPoints ?? {};
    agent.skillPoints[pointType] = (agent.skillPoints[pointType] ?? 0) + 1;
  }
  log?.record({ kind: "gainedSkillPoint", tick: world.tick, agentId: agent.id, species: agent.species, pointType });
}

/** Rolls `SKILLPOINT_ON_HIT_CHANCE` for a landed hit of type `moveType` — call from combat/predation on a successful hit. */
export function maybeGrantHitSkillPoint(
  agent: Agent,
  moveType: PokemonType,
  world: World,
  log?: EventLog,
  rng: () => number = Math.random
): void {
  if (rng() < SKILLPOINT_ON_HIT_CHANCE) grantSkillPoint(agent, moveType, world, log);
}

/**
 * Fills in a combat profile (`stats`/`hp`/`maxHp`/`types`/`moves`/
 * `knownMoves`) for an agent that doesn't have one yet — currently just
 * newborns (`spawnOffspring` in reproduction.ts), which used to enter the
 * world with no stats or moves at all, unable to fight or be targeted by
 * `pickBestMove` despite being full `Agent` records. Uses the *current*
 * `agent.level` (1 for a newborn) and `agent.species`, same dex-backed math
 * `grantExp`'s level-up loop already uses, so a level-5 agent constructed
 * this way ends up identical to one that leveled there naturally. No-op if
 * `ctx` or a profile for the species is unavailable, or if the agent
 * already has stats (never overwrites an existing combat profile).
 */
export function ensureCombatProfile(agent: Agent, ctx?: LevelingContext): void {
  if (agent.stats) return;
  if (!ctx) return;
  const profile = ctx.getProfile(agent.species);
  if (!profile) return;

  const level = agent.level ?? 1;
  const stats = calculateStats(profile.baseStats, level);
  agent.stats = stats;
  agent.maxHp = stats.maxHp;
  agent.hp = stats.maxHp;
  agent.types = profile.types;

  agent.knownMoves = agent.knownMoves ?? [];
  agent.moves = agent.moves ?? [];
  for (const [unlockLevel, moveKey] of profile.levelMoves) {
    if (unlockLevel > level) continue;
    if (agent.knownMoves.includes(moveKey)) continue;
    agent.knownMoves.push(moveKey);
    const spec = ctx.resolveMove(moveKey);
    if (spec && !agent.moves.some((m) => m.id === spec.id)) agent.moves.push(spec);
  }
}

/**
 * Grants `amount` exp to `agent`, then loops applying every level gained in
 * one go (a single big kill against a much-higher-level target can cross
 * several thresholds at once — not capped at +1). Each level crossed:
 * recomputes stats via `calculateStats` (using the *current* species' base
 * stats — this can change mid-loop if an evolution fires), heals current HP
 * by the same delta as the max-HP gain (mainline-accurate: it heals by the
 * gain, it doesn't reset to full or leave HP unchanged), learns every
 * `levelMoves` entry now unlocked, grants one guaranteed skill point of the
 * agent's own primary type plus a rare wildcard chance, then checks for a
 * level-gated evolution and applies it if the new level qualifies.
 *
 * One `leveledUp` event is emitted per level gained (not one summary event
 * for a multi-level jump) — a 5-level jump from one kill reads as five
 * distinct entries in the log, which matches this project's "the event log
 * needs semantic content" north star better than a single "+5 levels" blob.
 *
 * Without `ctx` (or without a profile for this agent's current species), exp
 * still accrues but nothing can level, evolve, or learn a move — this is the
 * same "optional injected policy" pattern as `HuntRules`, so callers that
 * don't have dex data on hand (bare engine tests) keep working unchanged.
 */
export function grantExp(world: World, agent: Agent, amount: number, ctx?: LevelingContext, log?: EventLog): void {
  if (agent.alive === false || amount <= 0) return;
  agent.exp = (agent.exp ?? 0) + amount;
  agent.level = agent.level ?? 1;

  if (!ctx) return;

  for (;;) {
    const profile = ctx.getProfile(agent.species);
    if (!profile) return;
    if (agent.level >= MAX_LEVEL) return;
    if (totalExpForLevel(profile.growthRate, agent.level + 1) > agent.exp) return;

    const fromLevel = agent.level;
    agent.level += 1;

    const newStats = calculateStats(profile.baseStats, agent.level);
    const oldMaxHp = agent.stats?.maxHp ?? agent.maxHp ?? newStats.maxHp;
    const hpDelta = Math.max(0, newStats.maxHp - oldMaxHp);
    agent.stats = newStats;
    agent.maxHp = newStats.maxHp;
    agent.hp = Math.min(agent.maxHp, (agent.hp ?? oldMaxHp) + hpDelta);

    log?.record({
      kind: "leveledUp",
      tick: world.tick,
      agentId: agent.id,
      species: agent.species,
      fromLevel,
      toLevel: agent.level,
      exp: agent.exp,
    });

    agent.knownMoves = agent.knownMoves ?? [];
    for (const [unlockLevel, moveKey] of profile.levelMoves) {
      if (unlockLevel > agent.level) continue;
      if (agent.knownMoves.includes(moveKey)) continue;
      agent.knownMoves.push(moveKey);
      const spec = ctx.resolveMove(moveKey);
      if (spec) {
        agent.moves = agent.moves ?? [];
        if (!agent.moves.some((m) => m.id === spec.id)) agent.moves.push(spec);
      }
      log?.record({ kind: "learnedMove", tick: world.tick, agentId: agent.id, species: agent.species, moveId: moveKey, level: agent.level });
    }

    const primaryType = agent.types?.[0];
    if (primaryType) grantSkillPoint(agent, primaryType, world, log);
    if (Math.random() < SKILLPOINT_LEVELUP_WILDCARD_CHANCE) grantSkillPoint(agent, "wildcard", world, log);

    const levelAfterUp = agent.level;
    const evo = profile.evolutions.find((e) => levelAfterUp >= e.level);
    if (evo) {
      const fromSpecies = agent.species;
      agent.species = evo.targetSpeciesId;
      const newProfile = ctx.getProfile(agent.species);
      if (newProfile) {
        const hpFraction = agent.maxHp && agent.maxHp > 0 ? (agent.hp ?? agent.maxHp) / agent.maxHp : 1;
        const evoStats = calculateStats(newProfile.baseStats, agent.level);
        agent.stats = evoStats;
        agent.maxHp = evoStats.maxHp;
        agent.hp = Math.max(1, Math.round(evoStats.maxHp * hpFraction));
      }
      log?.record({ kind: "evolved", tick: world.tick, agentId: agent.id, fromSpecies, toSpecies: agent.species, level: agent.level });
    }
  }
}

/** floor(baseExp * defeatedLevel / 7) — the real mainline wild-battle exp-yield formula. */
export function killExpYield(baseExp: number, defeatedLevel: number): number {
  return Math.floor((baseExp * defeatedLevel) / 7);
}

/** Grants a kill's exp to the attacker, using the defender's dex `baseExp` and level (via `ctx`). No-op if `ctx` or the defender's profile is unavailable. */
export function grantKillExp(world: World, attacker: Agent, defender: Agent, ctx?: LevelingContext, log?: EventLog): void {
  if (!ctx) return;
  const profile = ctx.getProfile(defender.species);
  if (!profile) return;
  const amount = killExpYield(profile.baseExp, defender.level ?? 1);
  grantExp(world, attacker, amount, ctx, log);
}
