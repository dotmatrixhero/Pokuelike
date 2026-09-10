import type { Agent, PassiveKind, StatusKind, TerrainKind, Vec2 } from "./types.js";
import type { Disposition, StatKey } from "./nature.js";
import type { PokemonType } from "./typing.js";

/**
 * A move's area is described as a shape resolved against an origin + facing
 * direction, independent of any specific move. Leveling/spec'ing a move later
 * just swaps or parameterizes the shape (e.g. Ember: point -> ring) without
 * touching how shapes themselves are resolved.
 */
export type Direction = "N" | "S" | "E" | "W";

/**
 * Every battlefield condition `situationalBonus` can key off, evaluated at
 * the moment of the hit (`situationalMultiplier`, predation.ts) — each one
 * rides an existing subsystem rather than inventing new world state:
 * `"targetLowHp"`/`"flanking"`/`"night"` shipped earlier; `"elevation"`
 * (attacker's tile is higher than the defender's — fov.ts/world.ts's
 * existing elevation data), `"concealed"` (the attacker itself is standing
 * in a bush — `Tile.concealment`), `"coldSnap"`/`"storm"`/`"drought"`/
 * `"rain"` (weather.ts's `activeWeatherAt`), `"targetBurning"` (the specific
 * status, for a move that only cares about its own signature effect), and
 * `"targetStatused"` (any of the five `StatusKind`s — a predator finishing
 * off something already weakened, not fussy about the cause) are all new.
 * `"rallyMarked"` (the defender currently has an active
 * `rallyMarkTicksRemaining` — see `MoveSpec.rallyCall`) is the connective
 * primitive MOVES_DESIGN.md's "deeper crosslinks" pass asked for: a real
 * payoff for following up on a Sociability branch's own mark, instead of
 * the two mechanics merely coexisting.
 */
export type SituationalCondition =
  | "targetLowHp"
  | "flanking"
  | "night"
  | "elevation"
  | "concealed"
  | "coldSnap"
  | "storm"
  | "drought"
  | "rain"
  | "targetBurning"
  | "targetStatused"
  | "rallyMarked";

export type MoveShape =
  | { kind: "point" }
  | { kind: "line"; length: number }
  | { kind: "cone"; length: number; width: number }
  | { kind: "ring"; radius: number }
  | { kind: "burst"; radius: number };

/** One condition -> damage-multiplier pair. See `MoveSpec.situationalBonus(es)`. */
export interface SituationalBonus {
  condition: SituationalCondition;
  multiplier: number;
}

/** One stat-stage change applied on use/hit. See `MoveSpec.statChangeOnHit`/`statChangesOnHit`. */
export interface StatChangeOnHit {
  target: "self" | "defender";
  stat: StatKey;
  stage: number;
  ticks?: number;
}

/** One temporary stat buff handed to an ally. See `MoveSpec.allyEffect(s)`. */
export interface AllyBuff {
  stat: StatKey;
  stage: number;
  ticks?: number;
}

/** A heal and/or a buff handed to an ally. See `MoveSpec.allyEffect`/`allyEffects`. */
export interface AllyEffect {
  healFraction?: number;
  buff?: AllyBuff;
}

const DIRECTION_VECTORS: Record<Direction, Vec2> = {
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
};

/**
 * How far a move can be targeted, independent of the shape it resolves once
 * used — a real tactics-grid distinction (cast range vs. effect footprint)
 * that the shape system alone conflates. `max` is the farthest tile a move
 * can be aimed at; `min` (0 for every move today) is reserved for a future
 * thrown-only move that can't be used at melee. See DESIGN.md's "Action
 * economy" section.
 */
export interface MoveRange {
  min: number;
  max: number;
}

export interface MoveSpec {
  id: string;
  name: string;
  shape: MoveShape;
  type: PokemonType;
  /** `"status"` is real (a genuine mainline status-move category, e.g. Growth/Agility/Rain Dance), but only ever meaningful on a `utilityMove`-flagged spec — `calculateDamage` (combat.ts) only ever branches on `"physical"` vs. anything else, and a utility move's `power` is always 0 anyway, so this never actually reaches that branch in practice. */
  category: "physical" | "special" | "status";
  /** Mainline-scale base power (Tackle 40, Flamethrower 90, etc.). */
  power: number;
  /**
   * Mainline max PP (Tackle 35, Hydro Pump 5) — the real dex value, sourced
   * by `moveCanon`/`statusMoveCanon` from `dex/moves.generated.ts`, which has
   * carried a `pp` for every move since the import and never surfaced it.
   *
   * **Inert.** Nothing spends it: `useMove` (combat.ts) sets cooldowns and
   * increments `moveUseCounts`, and no code path reads this field. It is
   * present so the number exists, is displayable, and is sourced from canon
   * rather than invented later — see MOVES_DESIGN.md's PP section for the
   * measurement of what a real PP budget would actually do to this sim, and
   * the open decisions (regen shape, behaviour at zero) that gate building it.
   */
  pp?: number;
  /**
   * 0-100. **Live** — `combat.ts`'s `rollAccuracy` consumes this on every
   * real hit, via `resolveHitAgainstTarget` (predation.ts) and
   * `resolveClashHit` (herdConflict.ts); a failed roll emits a `"missed"`
   * outcome. A negative value (-1) means "never misses," matching the
   * mainline convention for moves with no accuracy check.
   *
   * `weather.ts`'s `stormAccuracyMultiplier` already composes onto the roll.
   * Accuracy/evasion *stages* are plumbed through `rollAccuracy` but always
   * passed as 0 — no agent carries stages yet, and `elevation.ts`'s
   * `elevationAccuracyModifier`/`elevationEvasionModifier` are written,
   * exported and tested but still have zero callers.
   */
  accuracy: number;
  /** Ticks before this move can be used again. */
  cooldownTicks: number;
  /**
   * Chance (0-1) that a landed, damaging, non-killing hit inflicts
   * `statusKind` on the defender — rolled in `resolveHit` (predation.ts) via
   * `maybeInflictStatus` (status.ts), right where skill points already
   * piggyback on the same hit. Meaningless without `statusKind` set.
   */
  statusChance?: number;
  /**
   * Which status this move can inflict, if `statusChance` rolls. Hand-set
   * only on the curated roster (`packages/data/src/moves.ts`) — the
   * generated dex only records *that* a mainline move has a status effect,
   * not which one (see DESIGN.md's "Status effects" section). Absent =
   * `statusChance` (if set) is inert, same as before this field existed.
   */
  statusKind?: StatusKind;
  /**
   * Explicit cast range. Optional so specs that predate this field (test
   * fixtures, hand-rolled MoveSpec literals) keep working unchanged —
   * `moveRange()`/`withinMoveRange()` in combat.ts fall back to deriving the
   * old shape-based reach (point=1, line/cone=length) when this is absent.
   * The curated roster in packages/data sets it explicitly.
   */
  range?: MoveRange;
  /**
   * Forces the attacker or defender to move as part of this move — a drag,
   * knockback, lunge, or retreat, applied via `applyForcedMovement`
   * (movement.ts) from `resolveHit` (predation.ts). Absent = this move
   * never moves anyone beyond their own normal steps. See `ForcedMovement`.
   */
  forcedMovement?: ForcedMovement;
  /**
   * Strikes 2-5 times in one use — mainline multi-hit shape (Fury Attack,
   * Bullet Seed, etc.). Rolled once per use in `resolveHit`/`resolveAreaHit`
   * (predation.ts) via `rollHitCount`; each hit gets its own accuracy roll
   * and damage instance, stopping early the moment the defender faints or
   * dies. Absent = a normal single-hit move (the default, unchanged).
   */
  hits?: { min: number; max: number };
  /**
   * Fraction (0-1) of the defender's Defense/SpDefense stat this move
   * ignores — e.g. `0.5` halves effective Defense before the damage formula
   * runs (`calculateDamage`, combat.ts). Absent/0 = no penetration, the
   * default for every move that doesn't set it.
   */
  defensePenetration?: number;
  /**
   * Locks the user out of acting for this many *additional* ticks after
   * using the move — set on `agent.actionLockTicks` by `useMove` (combat.ts),
   * ticked down in `tickAgentNeeds` and checked as a no-action guard in
   * `tickAgentAction` (needs.ts), same shape as fainted/asleep/frozen.
   * Absent/0 = no lock (the default) — a normal move never costs the user a
   * future action tick beyond its own cooldown.
   */
  lockTicks?: number;
  /**
   * A flat multiplier applied to this move's damage when `condition` holds,
   * evaluated at the moment of the hit (`situationalMultiplier`, predation.ts)
   * — real battlefield state, not a tree-time delta. `"targetLowHp"`: the
   * defender is at or below half HP. `"flanking"`: the attacker isn't the
   * nearest threat the defender is currently reacting to (a rough "caught it
   * off guard" proxy — see `situationalMultiplier`'s own doc comment for the
   * exact check). `"night"`: the world is currently in its night phase
   * (daynight.ts's `isNight`). Absent = no situational bonus, the default.
   */
  situationalBonus?: { condition: SituationalCondition; multiplier: number };
  /**
   * The STACKING form of `situationalBonus`, and the one a tree writes into
   * (`MoveTreeNode.delta.situationalBonuses` appends rather than overwrites).
   * Resolution (`resolveSituationalBonuses`) is deliberately two-rule, and
   * both rules come straight from how these trees are authored:
   *
   * - **Different conditions compose** — a build that pays for "hits harder
   *   from high ground" AND "hits harder from a flank" gets both when both
   *   hold. This is the whole point: "I like the idea of ADDING modifiers so
   *   you can stack your build, not setting them."
   * - **Same condition: the strongest wins, it does not multiply.** Every
   *   ladder in the roster restates a full value rather than a delta
   *   (concealed 1.25 -> 1.4 -> 1.7 on one chain), so multiplying a ladder
   *   would silently hand out 2.98x where the designer wrote 1.7x.
   *
   * The result is order-independent either way, which is the actual defect
   * being fixed — `situationalBonus` alone was last-writer-wins.
   */
  situationalBonuses?: SituationalBonus[];
  /**
   * A flat multiplier on this move's *scoring* (not its actual damage) in
   * `pickBestMove` (combat.ts) when `condition` holds against the attacker's
   * own current state — `"selfLowHp"`: the attacker itself is at or below
   * half HP, biasing selection toward a move built for exactly that moment
   * (e.g. a "cornered" desperation move) without needing to touch the actual
   * damage formula. Absent = no self-state scoring bonus, the default.
   */
  selfStateBonus?: { condition: "selfLowHp"; multiplier: number };
  /**
   * Applies a stat-stage change via `resolveHit` (predation.ts) —
   * `target: "self"` applies the moment the move is used (even on a miss or
   * a killing blow, like a self-hyping windup); `target: "defender"` only on
   * a landed, non-killing hit, same hook `maybeInflictStatus` uses. `ticks`,
   * if set, makes it a temporary buff (removed after that many ticks —
   * status.ts's `tickStatStages`); absent means permanent until some other
   * effect removes it. See `Agent.statStages`. Absent `statChangeOnHit` =
   * this move never touches stat stages, the default.
   */
  statChangeOnHit?: { target: "self" | "defender"; stat: StatKey; stage: number; ticks?: number };
  /**
   * The STACKING form of `statChangeOnHit` (`delta.statChangesOnHit`
   * appends). Same two rules as `situationalBonuses`: different
   * `target`+`stat` pairs compose — a move can drop the defender's Speed
   * AND raise its own Defense — while two entries on the same pair resolve
   * to the strongest stage rather than summing, because the roster's
   * ladders restate full values (defense +1 -> +2 on one chain).
   * `resolveStatChangesOnHit` is the single reader; nothing outside it
   * should look at `statChangeOnHit` directly.
   */
  statChangesOnHit?: StatChangeOnHit[];
  /** Attacker and defender swap tiles on a landed, non-killing hit — a Bodyblock-style position swap. Absent = no swap, the default. */
  positionSwap?: boolean;
  /**
   * This move ALSO gets a real ally-support use, on top of remaining an
   * ordinary attack — additive, not a replacement of its combat identity.
   * The dedicated support use only ever resolves via `applySupportMove`
   * (support.ts) on the agent's own idle/support tick (which needs.ts only
   * reaches once predation already gets first refusal that tick);
   * `pickBestMove` (combat.ts) does NOT exclude a `targetsAlly` move from
   * hostile selection, so the same move (with whatever power/accuracy/other
   * combat deltas it's accumulated) is a genuine attack option whenever the
   * agent is actually fighting. Meaningless without `allyEffect` set.
   * Absent = an ordinary hostile-only move, the default. See
   * `allyEffectOnAttack` for a second, independent way the ally-effect
   * itself can also fire from a hostile attack.
   */
  targetsAlly?: boolean;
  /** What a `targetsAlly`/`allyEffectOnAttack` move does to the ally it resolves against — a heal, a buff, or both. */
  allyEffect?: { healFraction?: number; buff?: { stat: StatKey; stage: number; ticks?: number } };
  /**
   * The STACKING form of `allyEffect` (`delta.allyEffects` appends). Resolved
   * by `resolveAllyEffect` into ONE payload: the largest `healFraction` any
   * entry asks for, plus the strongest buff PER STAT — so a heal node and a
   * Speed-buff node taken together do both, while a heal ladder
   * (0.08 -> 0.20 on one chain) lands on 0.20 rather than 0.28. Same
   * compose-across-keys / strongest-within-a-key rule as
   * `situationalBonuses` and `statChangesOnHit`.
   */
  allyEffects?: AllyEffect[];
  /**
   * A second, independent way `allyEffect` can fire, on top of (not instead
   * of) `targetsAlly`'s dedicated idle-tick support use: every time this
   * move is used against an enemy (`resolveHit`, predation.ts — the moment
   * the move is used, same timing as `statChangeOnHit`'s self-side effect,
   * independent of whether the attack itself lands), it ALSO checks for the
   * nearest in-range, hurt-preferred herd-mate (`nearestAllyEffectTarget`,
   * support.ts) and applies `allyEffect` to them too, at no extra cost — a
   * real "as you strike the enemy, your ally nearby benefits too" effect,
   * not a second attack. Meaningless without `allyEffect` set; works
   * whether or not `targetsAlly` is also set (a move can auto-trigger on
   * attack without ever being a dedicated idle-tick support move, or do
   * both). Absent/false = the ally-effect never fires from a hostile
   * attack, the default — a plain `targetsAlly` move stays exactly as
   * before.
   */
  allyEffectOnAttack?: boolean;
  /**
   * Resolves against every living agent within the move's `shape` (not just
   * one picked target) via `resolveAreaHit` (predation.ts), which reuses
   * `resolveShape` (this file) with a facing derived from attacker->primary-
   * target direction. Absent/false = ordinary single-target resolution, the
   * default; a move with a non-`"point"` shape but no `hitsArea` still only
   * ever resolves against the one picked defender (shape then only matters
   * for `moveRange`'s reach derivation).
   */
  hitsArea?: boolean;
  /**
   * Meaningful only alongside `hitsArea`: excludes the attacker's own
   * herd-mates from the resolved-shape hit — see `resolveAreaHit`
   * (predation.ts), whose target filter otherwise checks only that a
   * living agent shares the attacker's layer and stands in the shape,
   * genuinely not distinguishing ally from enemy. Absent/false = a
   * same-herd agent caught in the blast takes the hit exactly like an
   * enemy would, the default (and the real, current behavior every AoE
   * move had before this field existed).
   */
  excludesAllies?: boolean;
  /**
   * Bonus power scaling with the attacker's own bulk (`agent.maxHp`, the
   * sim's existing weight proxy — see support.ts's `bodyWeightOf` for the
   * same proxy used elsewhere), added on top of `power` at the moment of the
   * hit (`predation.ts`'s `applySingleDamageInstance`) rather than baked
   * into the respec'd spec — a Venusaur and a Diglett wielding the same
   * `weightScaling` move hit very differently. `factor` is the fraction of
   * `maxHp` added as bonus power (e.g. `0.15` on a 200-maxHp attacker adds
   * 30 power). Absent = no weight scaling, the default.
   */
  weightScaling?: { factor: number };
  /**
   * Added to the crit-stage passed into `rollCritical` (combat.ts) —
   * `rollCritical` already supports a stage argument (mainline's 1/24, 1/8,
   * 1/2, always table), nothing before this move-tree pass ever fed it
   * anything but the default 0. Absent/0 = no change, the default.
   */
  critRateStage?: number;
  /** Heals the attacker this fraction of the damage a landed hit dealt — applied once per damage instance in `applySingleDamageInstance`, capped at `maxHp`. Absent/0 = no lifesteal, the default. */
  lifestealFraction?: number;
  /**
   * Costs the attacker this fraction of the damage a landed hit dealt, as
   * self-damage — applied once per damage instance, alongside lifesteal.
   * Deliberately floored at 1 hp rather than allowed to faint the user: a
   * true recoil-can-faint-you mechanic needs attacker-side faint plumbing
   * this pass doesn't build. Absent/0 = no recoil, the default.
   */
  recoilFraction?: number;
  /**
   * On a landed, non-killing hit, adds this many ticks to every move
   * currently on cooldown for the defender — a "your last move recovers
   * slower now" jam, not a fresh cooldown on a move that wasn't already
   * winding down. Absent/0 = no jam, the default.
   */
  jamCooldownTicks?: number;
  /** A flat multiplier applied on top of the normal type-effectiveness result specifically when the defender is this type — read in `calculateDamage`. Absent = no bonus, the default. */
  bonusVsType?: { type: PokemonType; multiplier: number };
  /**
   * Partially ignores a matchup this move would normally be resisted on:
   * when the type chart's own effectiveness comes back below 1 (a real
   * resist, not immune), it's multiplied by this and capped at 1 (a
   * resisted hit can become neutral, never super-effective, from this alone)
   * — read in `calculateDamage`, composing with (not replacing)
   * `bonusVsType`. Absent = the type chart's own number stands, the default.
   */
  resistanceBreaker?: { multiplier: number };
  /** Deducts this fraction of the given need from the attacker once per use (on `useMove`, regardless of whether the hit lands) — a real cost distinct from recoil (which scales with damage dealt). Absent = no cost, the default. */
  selfCostPerUse?: { need: "energy" | "hunger"; amount: number };
  /** On a landed hit, reverts a "bush" tile the defender is standing on back to plain floor, stripping its concealment for good — a real terrain interaction, not cosmetic. Absent/false = no terrain effect, the default. */
  terrainBurn?: boolean;
  /** A burn this move inflicts has a chance to jump to another nearby agent too — rolled once per successful `maybeInflictStatus` call, see status.ts's `maybeSpreadStatus`. Absent/false = no spread, the default. */
  statusSpreads?: boolean;
  /**
   * On a landed, non-killing hit, marks the defender as a priority target
   * for `ticks` — see `Agent.rallyMarkTicksRemaining`'s own doc comment for
   * how other agents' independent target selection reads this mark. A
   * "focus fire" lever: calling out (or striking) a threat gets herd-mates'
   * own, separately-run threat/hunt-target picks to converge on the same
   * one, instead of each agent just picking whatever's nearest to itself.
   * Absent = no marking, the default.
   */
  rallyCall?: { ticks: number };
  /**
   * On a landed critical hit, resets this move's own cooldown on the
   * attacker to 0 — read in `applySingleDamageInstance` (predation.ts)
   * right where the crit roll itself already happens, independent of
   * whether the hit goes on to kill or just land. A precision-reward lever
   * distinct from `critRateStage` (which only makes crits *more likely*):
   * this makes landing one actually *matter* tempo-wise. Absent/false = a
   * crit is still just bonus damage, the default.
   */
  critCooldownReset?: boolean;
  /**
   * On a landed, non-killing `positionSwap` hit, additionally pushes the
   * defender this many extra tiles further away from the attacker's new
   * (post-swap) position — reuses `applyForcedMovement` (movement.ts) with
   * `direction: "away"`, so it's obstacle-aware and respects the
   * `"immovable"` passive same as any other forced movement. Meaningless
   * without `positionSwap` also set. Absent/0 = a plain swap, the default.
   */
  positionSwapPull?: number;
  /**
   * Multiplies the per-tick damage fraction of whatever status this move's
   * `statusChance` inflicts (`BURN_DAMAGE_FRACTION`/`POISON_DAMAGE_FRACTION`,
   * status.ts) — a "badly poisons/burns" lever, set on `Agent.status` at
   * infliction time (`maybeInflictStatus`) and read every tick alongside it
   * (`tickStatusEffects`). Deliberately a flat multiplier for the sim's
   * whole DOT duration, not mainline Toxic's turn-by-turn escalation — a
   * real severity difference without a second counter to track. Absent = a
   * normal-severity status, the default (equivalent to `1`).
   */
  statusSeverity?: number;
  /**
   * While the attacker's own tile is `terrain`, a hit multiplies its damage
   * by `damageMultiplier` and reverts that tile to `"floor"` — the boulder
   * (or whatever) is consumed as part of throwing it, checked and applied in
   * `applySingleDamageInstance` (predation.ts) before the damage formula
   * runs, since it changes the damage itself rather than reacting to a
   * landed hit after the fact. A miss never reaches this check (accuracy is
   * rolled first, in `resolveHitAgainstTarget`), so a clean miss doesn't
   * waste the terrain — only an actual attack attempt does. On a multi-hit
   * move this naturally only ever fires once: the first hit reverts the
   * tile to `"floor"`, so every later hit in the same flurry just sees plain
   * floor and gets no bonus, no special-casing needed. Absent = this move
   * never reads or consumes the attacker's own tile, the default.
   */
  consumesOwnTerrain?: { terrain: TerrainKind; damageMultiplier: number };
  /**
   * On a landed, non-killing hit, converts a `"floor"`/`"sand"`/`"mud"` tile
   * at the *defender's* position into `terrain` (e.g. Water Gun leaving a
   * puddle where it hit) — the inverse of `terrainBurn`, same "landed hit"
   * hook (`resolveHitAgainstTarget`). Deliberately permanent, like
   * `terrainBurn`, not a temporary tile that reverts on its own — this sim
   * has no generic "this tile change expires" mechanism yet (shelter.ts's
   * `vacantTicks` is shelter-specific), so a real decaying puddle is a
   * follow-up, not part of this pass. No-op if the defender's tile isn't
   * one of the fillable kinds. Absent = no terrain fill, the default.
   */
  terrainFill?: { terrain: TerrainKind };
  /**
   * Lets a fleeing agent burrow instead of taking its normal flee step —
   * see `Agent.burrowedTicksRemaining`'s own doc comment (types.ts) for the
   * full mechanic. Checked only in `applyPredationInstincts`'s main flee
   * branch (predation.ts), never as an offensive move — `pickBestMove`
   * (combat.ts) excludes any move with this set from hostile move
   * selection (unlike `targetsAlly`, which stays a real attack option
   * too — a fleeing burrow genuinely never makes sense as an attack, so
   * this one really is exclusive, not additive).
   * Absent = this move never lets its user burrow, the default.
   */
  burrow?: { ticks: number };
  /**
   * Extra `Agent.digTicksAccrued`/`Agent.springDigTicksAccrued` this move
   * grants per use while gathering, on top of whichever base burst its own
   * path already gives (needs.ts). It composes with all three real gather
   * paths rather than adding a fourth:
   * - digging an underground-native crop out (`DIG_MOVE_BURST_TICKS`),
   * - digging a brand-new spring (`SPRING_DIG_TICKS`'s same burst),
   * - knocking a canopy-native crop down (`CANOPY_HARVEST_MOVE_BASE_BURST`
   *   plus its `range.max` scaling).
   *
   * It never grants access a move didn't already have: those paths still
   * pick a `burrow`-flagged move for digging and a damage-dealing move for
   * canopy harvest, so this only ever makes a move that ALREADY qualifies
   * better at it. A Vine Whip node speeds up fruit harvesting; it can't
   * dig, and this field doesn't change that.
   *
   * Absent = no bonus, the default (every move before this field existed).
   */
  gatherBurst?: number;
  /**
   * Marks this move as usable stand-alone, with no enemy or ally target at
   * all — Growth, Agility, Rain Dance, etc. Real structural gap this closes:
   * every move before this one either rides the hostile hit pipeline
   * (`resolveHit`, predation.ts) or the ally-support pipeline
   * (`applySupportMove`, support.ts), both of which need a real other agent
   * in range. `utilityMoves.ts`'s `maybeUseUtilityMove` is the new,
   * separate trigger path for this — checked during the same idle-tick slot
   * `applyExploration` (needs.ts) occupies, since a self/tile-effect move
   * doesn't fit either existing target-driven pipeline (see MOVES_DESIGN.md's
   * "why status effects and environmental moves are two different systems").
   * `pickBestMove` (combat.ts) excludes any move with this set from hostile
   * selection, same as `burrow` — it's exclusive, not additive, since none
   * of these effects make sense as a reaction to being attacked. Which
   * specific effect(s) fire is driven by whichever of `selfHeal`/
   * `fertilityBoost`/`statChangeOnHit`/`statusImmunityAura`/`spawnsRain`/
   * `matingRadiusBoost`/`drainNeeds` the move also sets — this flag only
   * marks eligibility for the idle path, it carries no effect of its own.
   * Absent = never eligible for idle/stand-alone use, the default.
   */
  /**
   * Extends STATUS infliction (and `statusSpreads`) to every target caught in
   * a `hitsArea` move's shape, not just the deliberately-picked one.
   *
   * Off by default, which is the base rule `resolveHitAgainstTarget` has
   * always had and still has: a Growl-style blast damages everyone and
   * statuses only who you aimed at. This exists so a skill tree can BUY that
   * out — direct: "I do not like the aoe status thing. That's fine as a base
   * but should be modified with notable nodes in the skill tree."
   *
   * Deliberately status-only. On-hit forced movement and `positionSwap` are
   * defined relative to the one picked defender and stay primary-only.
   */
  areaStatus?: boolean;

  utilityMove?: boolean;
  /** Heals this fraction of the user's own maxHp — `sunbeamBonus`, if set, adds an extra fraction when used within `flora.ts`'s `SUNBEAM_RADIUS` of a real "sunbeam" tile (reuses the same terrain-scaled-healing idea `isNearSunbeam` already drives for germination). Requires `utilityMove`. Absent = no self-heal, the default. */
  selfHeal?: { fraction: number; sunbeamBonus?: number };
  /** Bumps the fertility (`flora.ts`'s `bumpFertility`) of every tile within `radius` (Chebyshev distance; 0 = just the user's own tile) of the user's position by `amount`. Requires `utilityMove`. Absent = no fertility effect, the default. */
  fertilityBoost?: { amount: number; radius: number };
  /** Grants the user (and, within `radius`, every living same-herd ally) `ticks` of new-status immunity — see `Agent.statusImmuneTicksRemaining`'s own doc comment. Requires `utilityMove`. Absent = no immunity aura, the default. */
  statusImmunityAura?: { ticks: number; radius: number };
  /** Spawns (or refreshes) a real rain `WeatherCell` (weather.ts) centered on the user's own position — a move-driven weather trigger, not a passive spawn roll. Requires `utilityMove`. Absent/false = no weather effect, the default. */
  spawnsRain?: boolean;
  /** Multiplies the user's own mate-search radius (`reproduction.ts`'s `MATE_SEARCH_RADIUS`) by `multiplier` for `ticks` — see `Agent.matingRadiusBoostTicksRemaining`'s own doc comment. Requires `utilityMove`. Absent = no boost, the default. */
  matingRadiusBoost?: { multiplier: number; ticks: number };
  /** On use, finds the nearest living, non-same-herd agent within `radius` and transfers `amount` of the user's target `need` from them to the user — real resource theft, distinct from any hostile hit. A no-op (still goes on cooldown) if no such agent is in range. Requires `utilityMove`. Absent = no drain effect, the default. */
  drainNeeds?: { need: "hunger" | "thirst"; amount: number; radius: number };
  /**
   * A genuine multi-tick wind-up: instead of resolving immediately,
   * `resolveHit` (predation.ts) sets `Agent.chargingAttack` for `ticks` and
   * returns without hitting anything — see that field's own doc comment
   * (types.ts) for the full mechanic (invulnerable and unable to act while
   * charging, then a `leapTiles` lunge and a `bonusPower` hit on release, or
   * a fizzle if the original target's gone by then). The single biggest new
   * primitive on the whole "Engine primitives needed" checklist — a real
   * mid-commit agent state, not just another `MoveSpec` delta field. Absent
   * = this move resolves the instant it's used, the default for every move
   * that doesn't set it.
   */
  chargeAttack?: { ticks: number; bonusPower: number; leapTiles: number };
  /**
   * Optional respec DAG (see `applyMoveTree`). Each node is a delta applied
   * on top of the base spec, gated by a point cost and prerequisite node
   * id(s). Absent = this move can't be respec'd (the common case — only
   * moves with an actual designed tree, like Ember, carry one). Wild agents
   * auto-respec into an eligible, affordable node whenever they earn a
   * skill point — see `maybeAutoRespec` (leveling.ts) and DESIGN.md's
   * "Specialization" section.
   */
  tree?: Record<string, MoveTreeNode>;
}

/**
 * Describes a move's forced-movement effect — a drag, knockback, lunge, or
 * retreat, distinct from an agent's own ordinary flee/hunt/idle stepping.
 * `mover` is displaced `tiles` steps, one obstacle-aware step at a time
 * (`movement.ts`'s `stepToward`/`stepAway`), toward or away from whichever
 * party isn't `mover`. `timing` decides when: `"beforeHit"` resolves right
 * after the move is committed to but before the accuracy/damage roll (a
 * lunge that can change the attacker's footing for follow-up ticks, even
 * though this hit's own range was already validated before `resolveHit`
 * was called); `"onHit"` resolves only after a landed, damaging,
 * non-killing hit (drag/knockback/retreat) — the same "landed hit" hook
 * `maybeInflictStatus` (status.ts) uses.
 */
export interface ForcedMovement {
  /** Which party is displaced. */
  mover: "attacker" | "defender";
  /** Relative to the other party: `"closer"` drags/lunges them together, `"away"` pushes/retreats them apart. */
  direction: "closer" | "away";
  tiles: number;
  timing: "beforeHit" | "onHit";
}

/**
 * One node in a move's respec tree. `delta` is applied on top of whatever
 * the spec looks like after all previously-applied nodes (order given to
 * `applyMoveTree` matters for overwriting fields like `shape`, though
 * numeric deltas like `power`/`cooldownTicks` are additive regardless of
 * order). `prerequisites` must all already be in the chosen set for this
 * node to apply.
 */
export interface MoveTreeNode {
  id: string;
  name: string;
  cost: number;
  prerequisites?: string[];
  /**
   * Alternative prerequisite sets: the node is eligible if it satisfies its
   * (possibly absent) `prerequisites` list AND at least one of these inner
   * arrays is fully satisfied — each inner array is itself AND'd together,
   * same as `prerequisites`, but only one of the arrays needs to hold. This
   * is what lets a crosslink node stand in for a branch's own earlier chain
   * node as an alternate way to reach something downstream (see
   * MOVES_DESIGN.md's "crosslinks" section) — the same shape also covers a
   * keystone reachable from either of two forks. The common authoring
   * pattern is to use this *instead of* `prerequisites`, not alongside it —
   * a node with both must satisfy both (AND between the two mechanisms).
   */
  prerequisitesAnyOf?: string[][];
  /**
   * Node ids this one permanently locks out once chosen, and vice versa —
   * checked in both directions regardless of which side declares it, so a
   * one-sided declaration still works, though authoring both sides is
   * clearer to read. This is the real-fork primitive: two nodes that
   * `excludes` each other are a mutually exclusive, permanent choice (see
   * MOVES_DESIGN.md's skill-tree template). Absent = no exclusivity.
   */
  excludes?: string[];
  /**
   * Grants a permanent `Agent`-level passive the moment this node is chosen
   * (`maybeAutoRespec`, leveling.ts) — deliberately NOT part of `delta`,
   * since a passive modifies the *agent*, not the `MoveSpec` this tree
   * respecs. `value` accumulates into `agent.passives[kind]` (e.g. two
   * separate `damageReduction` nodes on two different moves both stack).
   * Absent = this node is a pure `MoveSpec` delta, the default. See
   * `PassiveKind`'s own doc comment (types.ts) for what each kind does.
   */
  grantsPassive?: { kind: PassiveKind; value: number };
  /**
   * Same as `grantsPassive`, plural — for the rare node that grants more
   * than one passive at once (e.g. a keystone that's both a damage-taking
   * lightning rod AND takes less damage while it's at it). A node with both
   * `grantsPassive` and `grantsPassives` grants all of them; the common case
   * is exactly one or the other, not both. Absent = no extra passives beyond
   * whatever `grantsPassive` alone specifies.
   */
  grantsPassives?: Array<{ kind: PassiveKind; value: number }>;
  /**
   * Which Disposition axis (nature.ts) this node appeals to, if any — used
   * only by `maybeAutoRespec` (leveling.ts) to weight a wild agent's pick
   * among several currently-affordable/eligible nodes on the same tree.
   * Absent means the node has no particular behavioral lean (e.g. a pure
   * numeric buff nobody would pick "because they're bold") and is weighted
   * neutrally. This never gates eligibility or cost — it only nudges *which*
   * eligible node an individual is more likely to grab first.
   */
  leaning?: keyof Disposition;
  delta: {
    /**
     * Overwrite, and deliberately staying that way: a cone genuinely is not
     * a ring plus a line, so a move has exactly one FORM. Rival forms must
     * `excludes` each other (enforced by check-proposed-trees.ts). Area SIZE
     * is `areaBonus`, which is additive.
     */
    shape?: MoveShape;
    /**
     * Additive, like `power` — how much BIGGER this move's area gets: `+N`
     * on a ring/burst radius, or on a line/cone length. A `point` shape
     * becomes a burst of radius N. Also turns on `hitsArea`, since an area
     * this size that doesn't hit an area would be dead weight.
     */
    areaBonus?: number;
    /** Overwrite. Prefer `rangeBonus`: two independent nodes setting this silently race, and "+1 Range" nodes are the roster's most duplicated shape. */
    range?: Partial<MoveRange>;
    /** Additive, like `power` — `+N` tiles onto the move's current `range.max`. */
    rangeBonus?: number;
    power?: number;
    accuracy?: number;
    cooldownTicks?: number;
    statusChance?: number;
    /** Overwrite, like `shape` — a move has at most one forced-movement effect at a time, not a stack of them. */
    forcedMovement?: ForcedMovement;
    /** Additive, like `power`. */
    defensePenetration?: number;
    /** Overwrite, like `shape` — a move has at most one multi-hit spec at a time. Prefer `hitsBonus`: two independent nodes setting this silently race. */
    hits?: { min: number; max: number };
    /**
     * Additive, like `power` — the STACKING form of `hits`. `+N` means N more
     * strikes than the move currently makes, so two nodes that each add a
     * needle really do add two. A move with no base `hits` counts as one
     * strike, so `hitsBonus: 2` on a single-hit move makes it a 3-hit move.
     */
    hitsBonus?: number;
    /** Additive, like `power` — a move that's already locking can lock longer. */
    lockTicks?: number;
    /** Overwrite, like `shape`. Prefer `situationalBonuses`: two independent nodes setting this silently race. */
    situationalBonus?: { condition: SituationalCondition; multiplier: number };
    /**
     * APPENDS to `MoveSpec.situationalBonuses` rather than overwriting — the
     * stacking form. Different conditions compose; the strongest entry wins
     * within one condition (see `MoveSpec.situationalBonuses`).
     */
    situationalBonuses?: SituationalBonus[];
    /** Overwrite, like `shape`. */
    selfStateBonus?: { condition: "selfLowHp"; multiplier: number };
    /** Overwrite, like `shape`. Prefer `statChangesOnHit`: two independent nodes setting this silently race. */
    statChangeOnHit?: { target: "self" | "defender"; stat: StatKey; stage: number; ticks?: number };
    /** APPENDS to `MoveSpec.statChangesOnHit` rather than overwriting — the stacking form. */
    statChangesOnHit?: StatChangeOnHit[];
    /** OR-merge, like a boolean flag being turned on for good once any node sets it. */
    positionSwap?: boolean;
    targetsAlly?: boolean;
    allyEffectOnAttack?: boolean;
    hitsArea?: boolean;
    excludesAllies?: boolean;
    terrainBurn?: boolean;
    statusSpreads?: boolean;
    areaStatus?: boolean;
    /** Overwrite, like `shape`. Prefer `allyEffects`: two independent nodes setting this silently race. */
    allyEffect?: { healFraction?: number; buff?: { stat: StatKey; stage: number; ticks?: number } };
    /** APPENDS to `MoveSpec.allyEffects` rather than overwriting — the stacking form. */
    allyEffects?: AllyEffect[];
    /** Overwrite, like `shape`. */
    weightScaling?: { factor: number };
    /** Additive, like `power`. */
    critRateStage?: number;
    /** Additive, like `power`. */
    lifestealFraction?: number;
    /** Additive, like `power`. */
    recoilFraction?: number;
    /** Additive, like `power`. */
    jamCooldownTicks?: number;
    /** Overwrite, like `shape`. */
    bonusVsType?: { type: PokemonType; multiplier: number };
    /** Overwrite, like `shape`. */
    resistanceBreaker?: { multiplier: number };
    /** Overwrite, like `shape`. */
    selfCostPerUse?: { need: "energy" | "hunger"; amount: number };
    /** Overwrite, like `shape`. Prefer `rallyCallTicks`. */
    rallyCall?: { ticks: number };
    /** Additive, like `power` — the STACKING form of `rallyCall`: `+N` ticks onto however long this move's mark already lasts. */
    rallyCallTicks?: number;
    /** OR-merge, like a boolean flag being turned on for good once any node sets it. */
    critCooldownReset?: boolean;
    /** Additive, like `power` — meaningless without `positionSwap` also set by some node in the chosen set. */
    positionSwapPull?: number;
    /** Overwrite, like `shape` — a move has at most one severity multiplier at a time, not a stack of them. */
    statusSeverity?: number;
    /** Overwrite, like `shape`. */
    consumesOwnTerrain?: { terrain: TerrainKind; damageMultiplier: number };
    /** Overwrite, like `shape`. */
    terrainFill?: { terrain: TerrainKind };
    /** Overwrite, like `shape` — a move has at most one charge commitment at a time. */
    chargeAttack?: { ticks: number; bonusPower: number; leapTiles: number };
    /**
     * Overwrite, like `shape` — restate the full object (need/amount/radius),
     * not just whichever sub-field changed, since a later node's value
     * replaces the earlier one entirely rather than merging field-by-field.
     * Only meaningful on a move that already has a base `drainNeeds` (e.g.
     * Leech Seed) — utilityMoves.ts's `maybeUseUtilityMove` is what actually
     * reads it.
     */
    drainNeeds?: { need: "hunger" | "thirst"; amount: number; radius: number };
    /** Overwrite, like `shape`. Only meaningful on a move that already has a base `matingRadiusBoost` (e.g. Sweet Scent). */
    matingRadiusBoost?: { multiplier: number; ticks: number };
    /**
     * Overwrite, like `shape`. Enriches the ground around the caster
     * (flora.ts's `raiseFertility`, applied by utilityMoves.ts's
     * `maybeUseUtilityMove`). Requires the move to be `utilityMove`-flagged
     * to ever fire — a plain attack move setting this would be dead weight.
     */
    fertilityBoost?: { amount: number; radius: number };
    /**
     * Overwrite, like `shape`. Restate the whole object.
     *
     * These next three are the only `MoveSpec` fields
     * `maybeUseUtilityMoveInCombat` (utilityMoves.ts) will spend a FIGHT
     * action on — it decides by effect field, not by move id — so without
     * them a status move's tree could deepen the move everywhere except
     * where it matters most, and no node on such a tree could ever fire
     * mid-fight. Leech Seed's v4 tree is the first to use them, one per
     * branch. All three require `utilityMove` to do anything.
     */
    selfHeal?: { fraction: number; sunbeamBonus?: number };
    /** Overwrite, like `shape` — see `selfHeal` above. */
    statusImmunityAura?: { ticks: number; radius: number };
    /** OR-merge, like a boolean flag being turned on for good once any node sets it — see `selfHeal` above. */
    spawnsRain?: boolean;
    /** Additive, like `power` — see `MoveSpec.gatherBurst`. Real on any move that already qualifies for one of the gather paths (a `burrow` move for digging, a damage move for canopy harvest). */
    gatherBurst?: number;
  };
}

/** Resolves the set of tiles (relative to origin, in the given facing) a shape covers. */
export function resolveShape(shape: MoveShape, origin: Vec2, facing: Direction): Vec2[] {
  const forward = DIRECTION_VECTORS[facing];
  const tiles: Vec2[] = [];

  switch (shape.kind) {
    case "point":
      tiles.push({ ...origin });
      break;

    case "line":
      for (let i = 1; i <= shape.length; i++) {
        tiles.push({ x: origin.x + forward.x * i, y: origin.y + forward.y * i });
      }
      break;

    case "cone":
      for (let depth = 1; depth <= shape.length; depth++) {
        const spread = Math.floor((depth * shape.width) / shape.length);
        for (let s = -spread; s <= spread; s++) {
          const perp = { x: -forward.y, y: forward.x };
          tiles.push({
            x: origin.x + forward.x * depth + perp.x * s,
            y: origin.y + forward.y * depth + perp.y * s,
          });
        }
      }
      break;

    case "ring":
      for (let dx = -shape.radius; dx <= shape.radius; dx++) {
        for (let dy = -shape.radius; dy <= shape.radius; dy++) {
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          if (dist === shape.radius) tiles.push({ x: origin.x + dx, y: origin.y + dy });
        }
      }
      break;

    case "burst":
      for (let dx = -shape.radius; dx <= shape.radius; dx++) {
        for (let dy = -shape.radius; dy <= shape.radius; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= shape.radius) {
            tiles.push({ x: origin.x + dx, y: origin.y + dy });
          }
        }
      }
      break;
  }

  return tiles;
}

/**
 * Grows a shape by `bonus` (`delta.areaBonus`) — radius for a ring/burst,
 * length for a line/cone, and a `point` becomes a burst of that radius,
 * since "make the area bigger" on something with no area has to start one.
 * Area SIZE is additive on purpose while `shape` (the FORM) stays an
 * overwrite: "Hits area should be additive. Make it scalar with range of
 * area. Agreed on shape though."
 */
function growShape(shape: MoveShape, bonus: number | undefined): MoveShape {
  if (bonus === undefined) return shape;
  switch (shape.kind) {
    case "point":
      return { kind: "burst", radius: bonus };
    case "line":
      return { kind: "line", length: shape.length + bonus };
    case "cone":
      return { kind: "cone", length: shape.length + bonus, width: shape.width };
    case "ring":
      return { kind: "ring", radius: shape.radius + bonus };
    case "burst":
      return { kind: "burst", radius: shape.radius + bonus };
  }
}

/**
 * The single reader of a move's situational damage bonuses — folds the
 * legacy singular `situationalBonus` together with the stacking
 * `situationalBonuses` list and collapses it to one entry per condition,
 * keeping the strongest multiplier. See `MoveSpec.situationalBonuses` for
 * why "strongest" rather than "product". Order-independent by construction.
 */
export function resolveSituationalBonuses(move: MoveSpec): SituationalBonus[] {
  const all = [...(move.situationalBonus ? [move.situationalBonus] : []), ...(move.situationalBonuses ?? [])];
  const best = new Map<SituationalCondition, SituationalBonus>();
  for (const bonus of all) {
    const current = best.get(bonus.condition);
    if (!current || bonus.multiplier > current.multiplier) best.set(bonus.condition, bonus);
  }
  return [...best.values()];
}

/**
 * The single reader of a move's stat-stage changes — folds the legacy
 * singular `statChangeOnHit` together with the stacking `statChangesOnHit`
 * list, keeping the largest-magnitude stage per `target`+`stat` pair (a
 * ladder restates a full value, so +1 then +2 is +2, not +3). Different
 * targets or different stats all survive and all apply.
 */
export function resolveStatChangesOnHit(move: MoveSpec): StatChangeOnHit[] {
  const all = [...(move.statChangeOnHit ? [move.statChangeOnHit] : []), ...(move.statChangesOnHit ?? [])];
  const best = new Map<string, StatChangeOnHit>();
  for (const change of all) {
    const key = `${change.target}:${change.stat}`;
    const current = best.get(key);
    if (!current || Math.abs(change.stage) > Math.abs(current.stage)) best.set(key, change);
  }
  return [...best.values()];
}

/**
 * The single reader of a move's ally payload — folds the legacy singular
 * `allyEffect` together with the stacking `allyEffects` list into ONE
 * application: the largest heal any entry asks for, plus the strongest buff
 * per stat. `undefined` when the move has no ally payload at all, which is
 * what the `targetsAlly` call sites gate on.
 */
export function resolveAllyEffect(move: MoveSpec): { healFraction?: number; buffs: AllyBuff[] } | undefined {
  const all = [...(move.allyEffect ? [move.allyEffect] : []), ...(move.allyEffects ?? [])];
  if (all.length === 0) return undefined;

  let healFraction: number | undefined;
  const buffs = new Map<StatKey, AllyBuff>();
  for (const effect of all) {
    if (effect.healFraction !== undefined && (healFraction === undefined || effect.healFraction > healFraction)) {
      healFraction = effect.healFraction;
    }
    if (effect.buff) {
      const current = buffs.get(effect.buff.stat);
      if (!current || Math.abs(effect.buff.stage) > Math.abs(current.stage)) buffs.set(effect.buff.stat, effect.buff);
    }
  }
  return { healFraction, buffs: [...buffs.values()] };
}

/**
 * Derives a new `MoveSpec` by applying a chosen set of a move's tree nodes,
 * in the given order, on top of `base`. Never mutates `base` — every field
 * (including nested `range`) is copied into a fresh object as it's touched,
 * so the canonical `MOVES`/dex data stays untouched no matter what a caller
 * respecs. Throws if `base` has no tree, references an unknown node id, or a
 * node's prerequisites aren't already satisfied by nodes earlier in
 * `chosenNodeIds` — an invalid selection is a caller bug, not something to
 * silently ignore or partially apply.
 *
 * Numeric deltas (power/accuracy/cooldownTicks/statusChance) are additive and
 * order-independent; `shape` and `range` are overwrites, applied in the order
 * given, so a tree that offers alternative branches (e.g. Ember: "grow into
 * a ring" vs. "stay a point but hit faster/more often") depends on the caller
 * choosing one, not both, deltas that touch the same field. Also validates
 * `prerequisitesAnyOf` (satisfying `prerequisites` alone isn't enough if this
 * is set — at least one alternative set must also be fully chosen) and
 * `excludes` (two mutually-exclusive nodes can't both appear in
 * `chosenNodeIds`, checked in both directions) — see `MoveTreeNode`'s own
 * doc comments.
 */
export function applyMoveTree(base: MoveSpec, chosenNodeIds: string[]): MoveSpec {
  const tree = base.tree;
  if (!tree) throw new Error(`applyMoveTree: move "${base.id}" has no respec tree`);

  const chosen = new Set<string>();
  let result: MoveSpec = { ...base, range: base.range ? { ...base.range } : undefined };
  // Area SIZE is accumulated separately from area FORM, and applied once at
  // the end. Growing the shape in place would lose the bonus the moment a
  // later node overwrote `shape` — which made the result depend on whether
  // the form node or the size node was bought first, the exact defect this
  // whole pass exists to remove. Measured: form-then-size gave radius 2,
  // size-then-form gave radius 1.
  let areaBonusTotal = 0;
  let formShape = base.shape;

  for (const nodeId of chosenNodeIds) {
    const node = tree[nodeId];
    if (!node) throw new Error(`applyMoveTree: move "${base.id}" has no tree node "${nodeId}"`);

    const missing = (node.prerequisites ?? []).filter((prereq) => !chosen.has(prereq));
    if (missing.length > 0) {
      throw new Error(
        `applyMoveTree: node "${nodeId}" on move "${base.id}" requires [${missing.join(", ")}] to be chosen first`
      );
    }

    if (node.prerequisitesAnyOf && node.prerequisitesAnyOf.length > 0) {
      const satisfied = node.prerequisitesAnyOf.some((set) => set.every((prereq) => chosen.has(prereq)));
      if (!satisfied) {
        throw new Error(
          `applyMoveTree: node "${nodeId}" on move "${base.id}" requires one of its alternative prerequisite sets to already be chosen`
        );
      }
    }

    const conflict = [...chosen].find(
      (chosenId) => (node.excludes ?? []).includes(chosenId) || (tree[chosenId]?.excludes ?? []).includes(nodeId)
    );
    if (conflict) {
      throw new Error(`applyMoveTree: node "${nodeId}" on move "${base.id}" conflicts with already-chosen node "${conflict}"`);
    }

    chosen.add(nodeId);

    const { delta } = node;
    result = {
      ...result,
      hitsArea: delta.areaBonus !== undefined ? true : delta.hitsArea ?? result.hitsArea,
      power: delta.power !== undefined ? result.power + delta.power : result.power,
      accuracy: delta.accuracy !== undefined ? result.accuracy + delta.accuracy : result.accuracy,
      cooldownTicks:
        delta.cooldownTicks !== undefined ? Math.max(0, result.cooldownTicks + delta.cooldownTicks) : result.cooldownTicks,
      statusChance:
        delta.statusChance !== undefined ? (result.statusChance ?? 0) + delta.statusChance : result.statusChance,
      range: delta.rangeBonus !== undefined || delta.range
        ? {
            min: delta.range?.min ?? result.range?.min ?? 0,
            max: (delta.range?.max ?? result.range?.max ?? 1) + (delta.rangeBonus ?? 0),
          }
        : result.range,
      forcedMovement: delta.forcedMovement ?? result.forcedMovement,
      defensePenetration:
        delta.defensePenetration !== undefined ? (result.defensePenetration ?? 0) + delta.defensePenetration : result.defensePenetration,
      hits:
        delta.hitsBonus !== undefined
          ? {
              min: (delta.hits?.min ?? result.hits?.min ?? 1) + delta.hitsBonus,
              max: (delta.hits?.max ?? result.hits?.max ?? 1) + delta.hitsBonus,
            }
          : delta.hits ?? result.hits,
      lockTicks: delta.lockTicks !== undefined ? (result.lockTicks ?? 0) + delta.lockTicks : result.lockTicks,
      situationalBonus: delta.situationalBonus ?? result.situationalBonus,
      situationalBonuses: delta.situationalBonuses
        ? [...(result.situationalBonuses ?? []), ...delta.situationalBonuses]
        : result.situationalBonuses,
      selfStateBonus: delta.selfStateBonus ?? result.selfStateBonus,
      statChangeOnHit: delta.statChangeOnHit ?? result.statChangeOnHit,
      statChangesOnHit: delta.statChangesOnHit
        ? [...(result.statChangesOnHit ?? []), ...delta.statChangesOnHit]
        : result.statChangesOnHit,
      positionSwap: delta.positionSwap ?? result.positionSwap,
      targetsAlly: delta.targetsAlly ?? result.targetsAlly,
      allyEffectOnAttack: delta.allyEffectOnAttack ?? result.allyEffectOnAttack,
      excludesAllies: delta.excludesAllies ?? result.excludesAllies,
      terrainBurn: delta.terrainBurn ?? result.terrainBurn,
      statusSpreads: delta.statusSpreads ?? result.statusSpreads,
      areaStatus: delta.areaStatus ?? result.areaStatus,
      allyEffect: delta.allyEffect ?? result.allyEffect,
      allyEffects: delta.allyEffects ? [...(result.allyEffects ?? []), ...delta.allyEffects] : result.allyEffects,
      weightScaling: delta.weightScaling ?? result.weightScaling,
      critRateStage: delta.critRateStage !== undefined ? (result.critRateStage ?? 0) + delta.critRateStage : result.critRateStage,
      lifestealFraction:
        delta.lifestealFraction !== undefined ? (result.lifestealFraction ?? 0) + delta.lifestealFraction : result.lifestealFraction,
      recoilFraction: delta.recoilFraction !== undefined ? (result.recoilFraction ?? 0) + delta.recoilFraction : result.recoilFraction,
      jamCooldownTicks:
        delta.jamCooldownTicks !== undefined ? (result.jamCooldownTicks ?? 0) + delta.jamCooldownTicks : result.jamCooldownTicks,
      bonusVsType: delta.bonusVsType ?? result.bonusVsType,
      resistanceBreaker: delta.resistanceBreaker ?? result.resistanceBreaker,
      selfCostPerUse: delta.selfCostPerUse ?? result.selfCostPerUse,
      rallyCall:
        delta.rallyCallTicks !== undefined
          ? { ticks: (delta.rallyCall?.ticks ?? result.rallyCall?.ticks ?? 0) + delta.rallyCallTicks }
          : delta.rallyCall ?? result.rallyCall,
      critCooldownReset: delta.critCooldownReset ?? result.critCooldownReset,
      positionSwapPull:
        delta.positionSwapPull !== undefined ? (result.positionSwapPull ?? 0) + delta.positionSwapPull : result.positionSwapPull,
      statusSeverity: delta.statusSeverity ?? result.statusSeverity,
      consumesOwnTerrain: delta.consumesOwnTerrain ?? result.consumesOwnTerrain,
      terrainFill: delta.terrainFill ?? result.terrainFill,
      chargeAttack: delta.chargeAttack ?? result.chargeAttack,
      drainNeeds: delta.drainNeeds ?? result.drainNeeds,
      matingRadiusBoost: delta.matingRadiusBoost ?? result.matingRadiusBoost,
      fertilityBoost: delta.fertilityBoost ?? result.fertilityBoost,
      selfHeal: delta.selfHeal ?? result.selfHeal,
      statusImmunityAura: delta.statusImmunityAura ?? result.statusImmunityAura,
      spawnsRain: delta.spawnsRain ?? result.spawnsRain,
      gatherBurst: delta.gatherBurst !== undefined ? (result.gatherBurst ?? 0) + delta.gatherBurst : result.gatherBurst,
    };
    if (delta.shape) formShape = delta.shape;
    if (delta.areaBonus !== undefined) areaBonusTotal += delta.areaBonus;
  }

  return { ...result, shape: areaBonusTotal === 0 ? formShape : growShape(formShape, areaBonusTotal) };
}

/** Sum of the chosen nodes' own `cost` fields — what `applyMoveTreeWithSpend` actually charges. */
export function totalTreeCost(base: MoveSpec, chosenNodeIds: string[]): number {
  const tree = base.tree;
  if (!tree) throw new Error(`totalTreeCost: move "${base.id}" has no respec tree`);
  return chosenNodeIds.reduce((sum, id) => {
    const node = tree[id];
    if (!node) throw new Error(`totalTreeCost: move "${base.id}" has no tree node "${id}"`);
    return sum + node.cost;
  }, 0);
}

/**
 * Validates and spends `cost` skill points of `pointType` from `agent`,
 * preferring typed points over wildcard (don't burn the rarer currency
 * first — see DESIGN.md). Returns false and mutates nothing if the agent
 * doesn't have enough (typed + wildcard) to cover `cost`.
 */
export function trySpendSkillPoints(agent: Agent, pointType: PokemonType, cost: number): boolean {
  const typed = agent.skillPoints?.[pointType] ?? 0;
  const wildcard = agent.wildcardSkillPoints ?? 0;
  if (typed + wildcard < cost) return false;

  const spendTyped = Math.min(typed, cost);
  const spendWildcard = cost - spendTyped;
  agent.skillPoints = agent.skillPoints ?? {};
  agent.skillPoints[pointType] = typed - spendTyped;
  agent.wildcardSkillPoints = wildcard - spendWildcard;
  return true;
}

/**
 * The real spend-validation path for `applyMoveTree`: computes the chosen
 * nodes' total cost, tries to pay it out of `agent`'s typed (matching
 * `base.type`) + wildcard skill points (typed preferred), and only derives
 * the respec'd `MoveSpec` — deducting the currency — if that succeeds.
 * Throws (rather than silently no-op'ing) on insufficient points, same
 * failure style as `applyMoveTree`'s own prerequisite/unknown-node checks —
 * an invalid spend attempt is a caller bug to catch, not swallow. Called by
 * `maybeAutoRespec` (leveling.ts) whenever a wild agent's disposition-weighted
 * pick turns out to be affordable — see DESIGN.md's "Specialization" section.
 */
export function applyMoveTreeWithSpend(base: MoveSpec, chosenNodeIds: string[], agent: Agent): MoveSpec {
  const cost = totalTreeCost(base, chosenNodeIds);
  if (!trySpendSkillPoints(agent, base.type, cost)) {
    const typed = agent.skillPoints?.[base.type] ?? 0;
    const wildcard = agent.wildcardSkillPoints ?? 0;
    throw new Error(
      `applyMoveTreeWithSpend: insufficient skill points for "${base.id}" — need ${cost} (${base.type}), have ${typed} typed + ${wildcard} wildcard`
    );
  }
  return applyMoveTree(base, chosenNodeIds);
}
