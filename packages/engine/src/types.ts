import type { MoveSpec } from "./moves.js";
import type { PokemonType } from "./typing.js";
import type { Stats } from "./stats.js";
import type { Disposition, StatKey } from "./nature.js";

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The five mainline major status conditions this sim actually models.
 * Mainline-real invariant: an agent carries at most one of these at a time
 * (inflicting a new one on an already-statused agent is a no-op — see
 * `maybeInflictStatus` in status.ts). See DESIGN.md's "Status effects"
 * section.
 */
export type StatusKind = "burn" | "poison" | "paralysis" | "sleep" | "freeze";

/**
 * Agent-modifying passives — a tree node's effect that permanently changes
 * how the *agent itself* behaves/is calculated, rather than a delta on a
 * `MoveSpec` (see `MoveTreeNode.grantsPassive` in moves.ts). Deliberately a
 * short, hand-interpreted enum rather than an open-ended effect DSL — each
 * kind is read at exactly one real call site: `"damageReduction"`
 * (predation.ts's `resolveHit`, a flat fraction taken off incoming damage),
 * `"immovable"` (movement.ts's `applyForcedMovement`, ignores being
 * dragged/knocked back/lunged at as the forced mover), `"regen"` (needs.ts's
 * `tickAgentNeeds`, a fraction of maxHp healed every tick regardless of
 * being fed/watered), `"thorns"` (predation.ts's `applySingleDamageInstance`,
 * reflects a fraction of incoming damage back at the attacker), `"healAura"`
 * (needs.ts's `tickAgentNeeds`, heals nearby herd-mates every tick, not just
 * the passive-holder itself). See MOVES_DESIGN.md's primitives checklist.
 */
export type PassiveKind = "damageReduction" | "immovable" | "regen" | "thorns" | "healAura";

/**
 * Why a herd is (or was) migrating — see herdMigration.ts/DESIGN.md's
 * "Dynamics that move a content herd" Phase 1 and Phase 3. `"scarcity"` is
 * the original (Phase 0) trigger, spelled `"food scarcity"` back then;
 * `"predator_pressure"`/`"wanderlust"`/`"territorial"` are Phase 1's
 * generalization; `"weather"` (Phase 3, weather.ts) is sustained storm
 * exposure without nearby cover. Shared by `World.herdMigrations` (internal
 * state, also feeds destination scoring) and `SimEvent`'s
 * `herdMigrating.reason` (external/narrative surface) so both always agree.
 */
export type MigrationReason = "scarcity" | "predator_pressure" | "wanderlust" | "territorial" | "weather";

/**
 * Why an agent dispersed — see dispersal.ts/DESIGN.md's "Natal dispersal"
 * section. `"matured"` covers BOTH of that feature's trigger (1) occasions
 * (crossing `MATURITY_AGE`, or evolving) — the design only distinguishes
 * "the flavorful disposition-weighted trigger" from "the guaranteed
 * mechanical fallback," not which specific occasion of the former fired.
 * `"no_eligible_mates"` is that guaranteed fallback: a sustained stretch
 * mature with zero eligible mate candidates found nearby. Shared by
 * `Agent.dispersalReason` (internal, set the moment dispersal triggers) and
 * `SimEvent`'s `dispersed.reason` (external/narrative surface).
 */
export type DispersalReason = "matured" | "no_eligible_mates";

/**
 * A minimal, name-only view of a biome seed point (worldgen.ts's `BiomeSeed`
 * has a full `BiomeDef` with density/terrain-weight tables that weather.ts
 * has no use for) — just enough for `worldgen.ts`'s `biomeWeightsAt` to
 * answer "which biome(s), and how strongly, does this point blend toward,"
 * reused by weather.ts/DESIGN.md's Phase 3 for biome-influenced weather
 * spawn likelihood and cover-seeking destination scoring. Stored on `World`
 * (`biomeSeeds` below) rather than recomputed, since the full seed placement
 * is otherwise private to `generateWorld`'s call.
 */
export interface BiomeSeedInfo {
  x: number;
  y: number;
  name: string;
}

/**
 * One of the four weather kinds DESIGN.md's Phase 3 asks for — see
 * weather.ts. `"coldSnap"` (not `"cold_snap"`) matches this codebase's
 * existing camelCase convention for multi-word string-union members (see
 * `BehaviorKind`'s `"seekWater"` etc.), unlike `MigrationReason`'s
 * snake_case members, which predate this feature and aren't worth
 * retroactively renaming.
 */
export type WeatherType = "rain" | "storm" | "drought" | "coldSnap";

/**
 * One active weather system — see weather.ts/DESIGN.md's Phase 3. `center`
 * is continuous (not rounded to a tile) so slow drift accumulates smoothly
 * tick over tick rather than getting stuck at the same integer position for
 * several ticks in a row; every consumer (flora/needs/fov/combat/support)
 * reads `center`/`radius` directly rather than needing a materialized set of
 * covered tiles. Surface-layer only, matching worldgen.ts's existing
 * Surface-only scope for biome/elevation data — see weather.ts's top-of-file
 * comment for why every effect function gates on `layer === "surface"`.
 */
export interface WeatherCell {
  id: string;
  type: WeatherType;
  center: Vec2;
  radius: number;
  startedTick: number;
  lifespanTicks: number;
  /** Constant per-tick displacement for the life of the cell — a real but slow drift, not a random walk. */
  drift: Vec2;
}

/**
 * When a species prefers to be active — see daynight.ts/DESIGN.md's "Dynamics
 * that move a content herd" section, Phase 2. `"cathemeral"` (active any
 * time) is the default for anything unspecified, both on `SpeciesDef`
 * (packages/data/src/species.ts) and here on `Agent`, so existing
 * species/hand-built fixtures don't silently change behavior just because
 * this feature landed — see support.ts's `activityScheduleMultiplier` and
 * predation.ts's `huntHungerThreshold` for the two places this actually
 * changes anything.
 */
export type ActivityPattern = "diurnal" | "nocturnal" | "crepuscular" | "cathemeral";

/**
 * "seedling" is a planted, not-yet-mature patch — see flora.ts. It matures
 * into either "food" (edible, has stock) or "flora" (decorative only —
 * not edible, just a nicer tile to be standing on than bare floor).
 *
 * "tree"/"boulder" are unwalkable obstacles (see world.ts's
 * `isWalkableTerrain`) — blocking movement gets them line-of-sight blocking
 * for free too, since `hasLineOfSight` (fov.ts) already treats any
 * non-walkable tile as opaque. "bush" is walkable but grants concealment
 * (see `Tile.concealment`). "sand"/"mud" are walkable but slow movement
 * (see support.ts's `terrainSpeedMultiplier`). All five are placed by
 * procedural generation — see worldgen.ts.
 *
 * "shelter" is a player-agent-built structure (see shelter.ts/DESIGN.md's
 * "Shelter-building" section), never placed by `generateWorld` — walkable,
 * grants the exact same concealment as "bush" (`Tile.concealment`, reused
 * verbatim rather than a parallel mechanism), and counts as real cover for
 * weather.ts's `hasCoverNearby` (reducing storm-exposure accumulation)
 * alongside "tree"/"bush". Reverts to "floor" on its own if left
 * unattended for a long sustained stretch — see `Tile.vacantTicks`.
 */
export type TerrainKind =
  | "floor"
  | "wall"
  | "water"
  | "food"
  | "flora"
  | "sunbeam"
  | "seedling"
  | "tree"
  | "boulder"
  | "bush"
  | "sand"
  | "mud"
  | "shelter";

/**
 * Three layers share one x,y footprint. A species is native to one layer
 * (Diglett underground, Pidgey canopy, most things surface) but routinely
 * crosses to a neighboring layer to meet needs — see needs.ts. Only
 * adjacent layers connect directly (underground <-> surface <-> canopy).
 */
export type Layer = "underground" | "surface" | "canopy";

export const LAYER_ORDER: readonly Layer[] = ["underground", "surface", "canopy"];

export interface Tile {
  terrain: TerrainKind;
  walkable: boolean;
  /**
   * Blocks sight and ranged attacks (`fov.ts`'s `hasLineOfSight`/
   * `isPathClear`) independent of `walkable` — "wall"/"tree"/"boulder" are
   * all real, solid obstructions you can't see or shoot through, but only
   * "wall"/"tree" also block *movement* outright; a boulder is climbable
   * (slowly — see `support.ts`'s `terrainSpeedMultiplier`), just still
   * opaque, matching "a big rock you can scramble over but can't see
   * through." Previously derived implicitly from `!walkable`; split out once
   * boulder became walkable-but-slow instead of a full obstacle (direct
   * ask: "boulders being so blocking... should cost movement speed to get
   * past 'em" rather than block outright).
   */
  opaque: boolean;
  /**
   * Continuous height within this layer's grid, currently only meaningful
   * on "surface" (open question: whether underground/canopy get their own
   * elevation later). Drives FOV and combat accuracy/evasion.
   */
  elevation: number;
  /**
   * "food"/"flora" tiles only: remaining life (0-1). For "food" this is
   * also how much is currently available to eat — depletes when eaten
   * from and decays on its own over time; for "flora" (decorative, not
   * edible) it only decays. Either way it dies (reverts to "floor") at 0
   * — see flora.ts.
   */
  stock?: number;
  /** "seedling" tiles only: ticks since it took root. Becomes "food" or "flora" once mature — see flora.ts. */
  growth?: number;
  /**
   * "bush" tiles only: true if standing here makes an agent harder to
   * detect — a real (not cosmetic) reduction to predation.ts's flee/hunt
   * detection radius and to fov.ts's `computeVisible` effective visibility.
   * A plain boolean rather than a graded number: only one terrain kind
   * grants it today, so there's nothing yet to grade between.
   */
  concealment?: boolean;
  /**
   * "food"/"flora" tiles only: which specific plant this is (e.g. an Oran
   * berry bush vs. a mossy tuft) — purely cosmetic for now (glyph/color in
   * the renderer), no gameplay effect. See flora.ts's FOOD_FLAVORS/FLORA_FLAVORS.
   */
  flavor?: string;
  /**
   * "shelter" tiles only: consecutive ticks since any living agent was last
   * within `shelter.ts`'s abandonment-check radius of this tile — reset to 0
   * the moment someone's back in range, reverts the tile to "floor" once it
   * crosses `SHELTER_ABANDON_TICKS`. Same tile-level counter/decay shape as
   * flora.ts's `stock` (a per-tile timer checked once per tick in a single
   * scan, not per-agent), just counting "how long alone" instead of "how
   * much life left." Set to 0 at construction, `undefined` once reverted.
   */
  vacantTicks?: number;
  /**
   * Any terrain kind — cumulative grazing pressure, independent of what the
   * tile's terrain currently is (a food patch eaten out and reverted to
   * "floor" keeps its pressure, which is the whole point: the SCAR outlives
   * the patch's own life-cycle). Incremented on every real consumption event
   * at this tile's coordinates (self-feeding via needs.ts's `consume()`, or
   * herd food-delivery pickup via support.ts — both call flora.ts's
   * `recordGrazing`), and decayed a little every tick in `growFlora`
   * regardless of terrain, the same "single per-tick scan, not per-agent"
   * shape as `stock`/`vacantTicks` above. Crossing
   * `OVERGRAZED_ENTER_PRESSURE` flips `overgrazed` on; decaying back below
   * `OVERGRAZED_EXIT_PRESSURE` flips it off — see flora.ts's "Grazing scars"
   * section for the hysteresis reasoning and the real suppression this
   * drives. `undefined` until the first grazing event ever touches this
   * tile (never reset to `undefined` afterward — decays asymptotically
   * toward, but only ever reaches exactly, 0).
   */
  grazingPressure?: number;
  /**
   * True while `grazingPressure` is at/above the "overgrazed" threshold —
   * see `grazingPressure`'s doc comment above. While true, flora.ts's
   * `growFlora` measurably suppresses new growth onto or from this specific
   * tile (germination chance, spread eligibility, seedling maturation rate)
   * without touching decay of whatever's already grown elsewhere — a
   * temporary "this ground needs to rest" state, not a permanent dead zone:
   * it clears itself once grazing pressure decays back down, the same
   * self-recovering shape as `vacantTicks`-driven shelter abandonment.
   */
  overgrazed?: boolean;
  /**
   * "shelter" tiles only: a real food stockpile, 0-`SHELTER_CACHE_MAX`
   * (shelter.ts) — direct ask: "shelter should also like give other buff
   * too... maybe food cache and stuff." Built up gradually while a
   * `buildsShelter` agent rests at its own shelter (already fed/watered,
   * since `applyShelterResting` only ever runs once `chooseBehavior` reads
   * "idle" — see that function's doc comment), and drawn down when a
   * genuinely hungry `buildsShelter` agent is back home with nothing else to
   * eat nearby — a real safety net during scarcity, not a trap: an empty
   * cache (0/`undefined`) just falls through to ordinary live-foraging, it
   * never blocks or delays a hungry agent from breaking off to eat elsewhere.
   * Same per-tile-timer shape as `stock`/`vacantTicks` above. Set to 0 at
   * construction, `undefined` once the tile reverts away from "shelter"
   * (abandonment included — an abandoned shelter's stockpile is lost along
   * with the structure itself, same as any other "you stopped maintaining
   * this" consequence).
   */
  cache?: number;
}

/** Needs decay over time and drive an agent's behavior via simple utility AI. */
export interface Needs {
  hunger: number; // 0 = starving, 1 = full
  thirst: number; // 0 = parched, 1 = hydrated
  energy: number; // 0 = exhausted, 1 = rested
  mateDrive: number; // 0 = none, 1 = urgent
}

export type BehaviorKind =
  | "idle"
  | "seekWater"
  | "seekFood"
  | "seekMate"
  | "flee"
  | "hunt"
  | "fight"
  | "relocate"
  | "deliverFood"
  | "carryAlly"
  | "explore"
  | "disperse"
  | "buildShelter"
  | "sleep"
  | "restAtShelter"
  | "scavenge";

/** One held/carried item stack. See DESIGN.md's "Faint/finish-off, heal over time, and herd support" section. */
export interface InventoryItem {
  itemKey: string;
  weight: number;
}

export interface Agent {
  id: string;
  species: string;
  pos: Vec2;
  /** Current layer. Usually equals homeLayer; differs while crossing for resources. */
  layer: Layer;
  /** The layer this agent lives on and returns to once its needs are met. */
  homeLayer: Layer;
  needs: Needs;
  behavior: BehaviorKind;
  /** Agents in the same herd share a home range and will regroup. */
  herdId?: string;
  /**
   * Absent/true = alive. `false` = truly dead (a corpse — eatable, lootable),
   * which persists in `World.agents` for `CORPSE_PERSIST_TICKS` (see
   * simulation.ts/support.ts) before being pruned — not the same tick it
   * died, a deliberate change from before this feature. See `fainted` below
   * for the intermediate "downed but not dead" state, which does NOT set
   * `alive` to false.
   */
  alive?: boolean;
  /** The agent currently being hunted, if this agent is mid-hunt. Bookkeeping only — re-evaluated each tick. */
  huntTarget?: string;
  /** Absent = genderless (doesn't seek a mate). */
  sex?: "male" | "female";
  /** Ticks alive. Absent is treated as already mature (for agents spawned directly into a scenario). */
  age?: number;
  /** Current/max HP. Set from `stats.maxHp` at spawn for combat-capable agents. */
  hp?: number;
  maxHp?: number;
  /** Combat profile, denormalized onto the agent at spawn time (not looked up live from species data). */
  level?: number;
  types?: PokemonType[];
  moves?: MoveSpec[];
  stats?: Stats;
  /** Ticks remaining before each move (by id) can be used again. Absent entry = off cooldown. */
  moveCooldowns?: Record<string, number>;
  /** The agent this one is currently mobbing, if mid-fight. Bookkeeping only — re-evaluated each tick. */
  fightTarget?: string;
  /** Ticks a predator has gone without a successful kill while actively hunting — drives "relocate" once too high. */
  ticksSinceMeal?: number;
  /** Where a "relocate" agent is walking to. Cleared on arrival or once it feeds again. */
  relocateTarget?: Vec2;
  /**
   * Consecutive ticks spent with `hunger` at 0 — dies once this exceeds
   * `needs.ts`'s `STARVATION_GRACE_TICKS`. Resets to 0 the instant hunger
   * recovers above 0. Hunger-specific (not shared with thirst) since the two
   * needs now have different grace periods — see `thirstStarvationTicks`
   * below and needs.ts's "Extend thirst's survival margin" doc comment.
   */
  starvationTicks?: number;
  /**
   * Thirst's own version of `starvationTicks` above — consecutive ticks
   * spent with `thirst` at 0, dies once this exceeds `needs.ts`'s
   * `THIRST_STARVATION_GRACE_TICKS` (longer than hunger's, closing most of
   * the gap between the two needs' total survival budgets — see DESIGN.md).
   * Tracked separately from `starvationTicks` precisely because hunger and
   * thirst can independently cross 0 at different ticks with different
   * grace windows; a single shared counter can't correctly judge "has THIS
   * need's own grace period run out" once the two thresholds differ.
   */
  thirstStarvationTicks?: number;
  /** Ticks a non-predator has spent wanting food/water with none reachable anywhere — drives migrating away once too high. */
  ticksWithoutResource?: number;
  /**
   * Consecutive ticks the current seekWater/seekFood target tile has been
   * at tile capacity (occupancy.ts) and therefore unreachable — see
   * needs.ts's blocked-resource handling. Resets to 0 the instant the
   * tracked target has room again, is reached, or a new target is picked.
   * Distinct from `ticksWithoutResource` (that one fires when NO resource
   * tile exists/is reachable anywhere; this one fires when a real resource
   * tile exists nearby but is currently too crowded to stand on).
   */
  ticksBlockedFromResource?: number;
  /**
   * Ticks remaining before this agent can start or be drawn into another
   * herd-conflict rivalry fight (herdConflict.ts) — set on both participants
   * once one of them retreats, so the same pair doesn't immediately grind on
   * each other again the very next eligible tick. Ticked down every world
   * tick in `tickAgentNeeds`, same shape as `actionLockTicks`. Absent/0 = no
   * cooldown, the default.
   */
  herdConflictCooldownTicks?: number;
  /**
   * Rolling memory of resource tiles (same terrain kind as the current
   * seekWater/seekFood target) found crowded during the current seeking
   * episode — excluded from the next nearest-tile pick once
   * `ticksBlockedFromResource` crosses its grace period, so the agent tries
   * a genuinely different tile instead of immediately re-targeting the one
   * it just gave up on. Cleared whenever the episode ends (a successful
   * consume, or `chooseBehavior` moves on to something else) so a tile's
   * crowding is never remembered longer than the attempt that found it
   * crowded — a tile that frees up later gets a clean fresh chance next
   * time thirst/hunger drives an agent back to it. See needs.ts's
   * "Blocked-resource fallback" section in DESIGN.md for the full
   * oscillation-prevention reasoning.
   */
  blockedResourceTiles?: Vec2[];
  /**
   * Speed-driven action-economy accumulator (see simulation.ts). Gains the
   * agent's real Speed stat every world tick; once it crosses
   * `ACTION_THRESHOLD` the agent takes one action and the threshold is
   * subtracted. Absent/0 is the correct starting value for a freshly spawned
   * agent. Agents with no computed `stats` (bare test fixtures, newborns —
   * see reproduction.ts) fall back to acting every tick, matching
   * pre-action-economy behavior, rather than being silently slowed down by
   * missing data.
   */
  actionEnergy?: number;
  /**
   * Combined elevation-delta + terrain multiplier from this agent's last
   * actual step (support.ts's `movementSpeedFactor`), applied to base Speed
   * on top of injury (`effectiveSpeed`) — see `actionSpeedOf` in
   * simulation.ts. Absent/1 for an agent that hasn't moved yet. Deliberately
   * a snapshot of the *last* move's terrain, not the upcoming one: Speed is
   * consumed to decide *whether* an action happens before that action's
   * movement is chosen, so this can only affect the next tick's pace, not
   * gate the current one — a scope call forced by the existing
   * accumulate-then-act architecture, see DESIGN.md.
   */
  terrainSpeedFactor?: number;

  /**
   * Total accumulated exp (cumulative, not "toward next level" — matches the
   * growth-curve threshold functions in leveling.ts, which are also
   * cumulative-total functions). Absent/0 for a freshly spawned agent that
   * hasn't earned any yet; `spawnAgent` sets this to 0 explicitly. See
   * DESIGN.md's "Leveling" section.
   */
  exp?: number;
  /**
   * Move ids/keys this agent has ever learned, unbounded (no forgetting, no
   * 4-move cap — a deliberate departure from mainline, see DESIGN.md). Not
   * every entry necessarily has a corresponding `MoveSpec` in `moves` — a
   * learned move that's a status move (no MoveSpec representation in this
   * sim yet) is still recorded here for bookkeeping/event purposes even
   * though it can't be selected in combat. `moves` stays the actual
   * combat-usable subset that `pickBestMove` reads.
   */
  knownMoves?: string[];
  /** Typed skill-point currency for `applyMoveTreeWithSpend` (moves.ts) — see DESIGN.md. */
  skillPoints?: Partial<Record<PokemonType, number>>;
  /** Untyped skill points that can fund any move's respec tree, regardless of type. */
  wildcardSkillPoints?: number;
  /**
   * Running count of "real" (non-wildcard) skill points ever granted to this
   * agent — level-up and on-hit alike — used only by `grantSkillPoint`
   * (leveling.ts) to know when the next `SKILLPOINT_WILDCARD_INTERVAL`th
   * bonus wildcard point is due. Never decremented (spending points doesn't
   * un-grant them) and unrelated to `skillPoints`/`wildcardSkillPoints`
   * themselves, which do shrink as they're spent.
   */
  skillPointGrantCount?: number;
  /**
   * Permanent record of which tree nodes this agent has committed to on each
   * known move, keyed by move id — e.g. `{ ember: ["wider_burn"] }`. Grown
   * one node at a time by `maybeAutoRespec` (leveling.ts) whenever a skill
   * point is granted and an eligible, affordable node exists; never
   * reversed (no respec-back — a real, permanent build choice, same as
   * mainline EV/nature investment). The move actually used in combat is
   * recomputed from this list via `applyMoveTree` each time it changes, so
   * `moves` always reflects the agent's current build, not just the dex
   * base. See DESIGN.md's "Specialization" section.
   */
  moveTreeChoices?: Record<string, string[]>;
  /**
   * Coarse "have I been here" tracking for the new-area exp trickle — sector
   * ids (e.g. "3,2" for a fixed-size grid bucket), not raw tiles, and capped
   * (oldest dropped) so this can't grow unboundedly over a long run. See
   * leveling.ts's `MAX_TRACKED_SECTORS`.
   */
  visitedSectors?: string[];
  /**
   * Species ids this agent has personally encountered before, for the
   * "met a new species" exp trickle — capped for the same unbounded-growth
   * reason as `visitedSectors`. Deliberately NOT per-agent-id memory (that
   * really would grow forever); this is coarser, species-level "have I seen
   * one of these before."
   */
  encounteredSpecies?: string[];

  // --- Faint/finish-off, heal-over-time, and herd support (see DESIGN.md) ---

  /**
   * True once a hit has brought `hp` to 0 and it hasn't yet recovered or been
   * finished off. `alive` stays true while merely fainted — a fainted agent
   * is excluded from the action tick entirely (see `tickAgentAction` in
   * needs.ts) but still needs-decays and heals. `alive === false` is the
   * only true-death signal; `fainted` may still read `true` on a corpse
   * (harmless — every "is this eatable/lootable" check reads `alive`, not
   * `fainted`, see support.ts's `isTrulyDead`/`isEatable`).
   */
  fainted?: boolean;
  /**
   * Set to `0.75 * maxHp` at the moment of fainting (support.ts's
   * `FINISHING_POOL_FRACTION`), a second bar that absorbs every follow-up
   * hit (from anyone) while fainted instead of `hp`, which stays pinned at
   * 0. Reaching <= 0 is true death. Discarded (set to `undefined`) on
   * recovery — a fresh faint later gets a fresh pool, never a carried-over
   * remainder.
   */
  finishingPool?: number;
  /** World.tick a true kill happened, for the corpse-persistence pruning window in simulation.ts. */
  diedAtTick?: number;
  /**
   * The one major status condition this agent currently carries, if any —
   * see `StatusKind` and status.ts. `ticksRemaining` only matters for
   * sleep/freeze (bounded duration, decremented in `tickStatusEffects`);
   * burn/poison/paralysis have no independent duration or cure in this sim
   * (no item/ability system exists to cure them early) — they persist until
   * the agent faints, at which point this is cleared unconditionally, same
   * as every other status kind (mainline-real: fainting always cures
   * status).
   */
  status?: { kind: StatusKind; ticksRemaining?: number };
  /**
   * Stacked stat-stage modifiers, each independent of `status`/burn's own
   * one-off computed halving — see `getStatStage`/`applyStatStage`
   * (status.ts). An entry with `ticksRemaining` set is a *temporary* buff
   * (counted down and removed in `tickAgentNeeds`, e.g. Bubble Shield's
   * self-buff-on-hit); one without it is *permanent* until some other effect
   * removes it (e.g. Growl's designed Attack-lowering AoE) — the same array
   * covers both of MOVES_DESIGN.md's "real-duration temporary buffs" and
   * "persistent stat stages" primitives, distinguished only by whether a
   * duration is set. Multiple entries on the same `stat` stack additively
   * (clamped downstream by `statStageMultiplier`'s own [-6,+6] clamp).
   */
  statStages?: Array<{ stat: StatKey; stage: number; ticksRemaining?: number }>;
  /**
   * Granted permanently by a move-tree node's `grantsPassive` (moves.ts) once
   * chosen — see `PassiveKind`'s own doc comment for what each key does and
   * where it's read. Absent/0 for any kind means "no such passive," same as
   * every other optional agent field in this file.
   */
  passives?: Partial<Record<PassiveKind, number>>;
  /**
   * Ticks remaining during which this agent cannot act at all — set by a
   * move with `MoveSpec.lockTicks` (a move committing its user for more than
   * one action tick, e.g. a Reaping Slash follow-through) via `useMove`
   * (combat.ts), ticked down every world tick in `tickAgentNeeds` regardless
   * of whether the agent gets an action tick this tick. Checked as an early
   * no-action guard in `tickAgentAction` (needs.ts), same shape as
   * fainted/asleep/frozen. Absent/0 = no lock, the default for every move
   * that doesn't set `lockTicks`.
   */
  actionLockTicks?: number;
  /** General item slots — simple food units and/or ITEM_DEX entries, each carrying its own weight. Capped by `carryCapacityOf` (support.ts). */
  inventory?: InventoryItem[];
  /** The id of a fully-fainted ally this agent is currently carrying, if any. Mutually exclusive in practice with `beingCarriedBy` on the same agent. */
  carryingId?: string;
  /** The id of the herd-mate currently carrying this agent, if any. While set, this agent takes no action-tick behavior (see needs.ts) regardless of `fainted`. */
  beingCarriedBy?: string;
  /** The hungry/fainted herd-mate this agent is currently walking a food item to, mid-`deliverFood`. */
  deliverTargetId?: string;
  /**
   * Anchor position this agent (or its herd) treats as "home" — where a
   * carrier heads with a fainted ally. Set once at spawn to the agent's
   * spawn position (`spawnAgent`/`spawnOffspring`); there's no richer
   * "herd home range" concept in the engine yet, so this is the cheapest
   * reasonable stand-in (see DESIGN.md).
   */
  homePos?: Vec2;
  /**
   * [motherId, fatherId] — absent for a founder spawned directly into a
   * scenario, set for anything born via `spawnOffspring` (reproduction.ts).
   * Drives the inbreeding-avoidance check in `isEligibleMate`: without
   * this, nothing stopped a long-lived founder with no predator (e.g. a
   * guardian Venusaur) from fathering its own daughters and
   * granddaughters, confirmed in a real run. Deliberately just the
   * immediate parents, not a full pedigree — see `grandparentIds` for how
   * one more generation is covered without needing a live lookup.
   */
  parentIds?: [string, string];
  /**
   * The (deduplicated) ids of this agent's up-to-four grandparents,
   * computed once at birth from the parents' own `parentIds` — not looked
   * up live, since an ancestor can easily be pruned from `World.agents`
   * (corpses persist only `CORPSE_PERSIST_TICKS`) long before this agent
   * matures enough to mate. Absent for a founder or a first-generation
   * offspring (founders have no `parentIds` of their own to combine).
   */
  grandparentIds?: string[];

  /**
   * Where a fully-satisfied, herd-settled idle agent is wandering to, in
   * search of a not-yet-visited sector — the "motivated by exp too"
   * exploration drive (see needs.ts's `applyExploration` and leveling.ts's
   * `EXP_ON_NEW_SECTOR`). Cleared on arrival, once no unvisited sector can
   * be found nearby, or the moment any need becomes urgent enough to
   * interrupt it.
   */
  exploreTarget?: Vec2;

  // --- Individual variance: Nature and Disposition (see DESIGN.md) ---

  /**
   * One of the 25 real mainline nature names (nature.ts's `NATURES`).
   * Assigned uniformly at random at creation (spawnAgent/spawnOffspring),
   * never inherited from parents — matches mainline absent the Everstone
   * item, which this sim doesn't have. Also the seed for `disposition`
   * below, and for `calculateStats`'s per-stat multiplier. Absent only on
   * bare test fixtures built by hand rather than through a real creation
   * site; those are treated as neutral everywhere nature is read.
   */
  nature?: string;
  /**
   * The 3-axis behavioral vector seeded from `nature` via
   * `dispositionFromNature` (nature.ts) plus a small per-individual random
   * jitter — two agents sharing a nature aren't behaviorally identical
   * either. Wired into predation.ts's flee/mob/hunt thresholds and
   * reproduction.ts's mate-seeking radius; absent is treated as the neutral
   * 0.5 on every axis, so those thresholds fall back to their original
   * fixed values for hand-built fixtures.
   */
  disposition?: Disposition;

  // --- Natal dispersal (see DESIGN.md's "Natal dispersal" section, dispersal.ts) ---

  /**
   * Ticks since a mature, sexed agent last had at least one eligible mate
   * candidate found nearby — updated by reproduction.ts's `applyMateSeeking`
   * (which already computes the candidate list every time it runs, so this
   * piggybacks on that scan rather than paying for a second one) and read by
   * dispersal.ts's guaranteed fallback trigger. Absent/0 for an immature
   * agent, or one that's never yet gone a tick without a candidate.
   */
  ticksSinceEligibleMate?: number;
  /**
   * Set for exactly one tick by leveling.ts's `grantExp` the instant this
   * agent's level crosses `dispersal.ts`'s `DISPERSAL_MIN_LEVEL` (dispersal
   * is gated to older/more-experienced individuals, not any agent the
   * instant it's biologically mature — see DISPERSAL_MIN_LEVEL's doc
   * comment) — dispersal.ts's `maybeTriggerDispersal` reads and clears it on
   * its very next check, so the crossing always gets exactly one dispersal
   * roll, never zero (missed, since level jumps can skip past an exact
   * equality check in one `grantExp` call) or more than one. Replaced an
   * earlier "just crossed MATURITY_AGE" version of this same flag — gating
   * on level made the age-based crossing moot, since reaching
   * DISPERSAL_MIN_LEVEL now takes far longer than reaching MATURITY_AGE in
   * practice (see leveling.ts's EXP_TRICKLE_PER_TICK doc comment).
   */
  pendingLevelDispersalCheck?: boolean;
  /**
   * Set for exactly one tick by leveling.ts's `grantExp` the instant this
   * agent evolves — dispersal.ts's `maybeTriggerDispersal` reads and clears
   * it on its very next check (whether or not the roll it triggers
   * succeeds), so an evolution always gets exactly one dispersal roll, never
   * zero (missed) or more than one (double-counted).
   */
  pendingEvolutionDispersalCheck?: boolean;
  /**
   * Where a dispersing agent (`"disperse"` behavior) is walking to — see
   * dispersal.ts. Deliberately a separate field from `relocateTarget`
   * (migration.ts's own "give up on this area and walk to a random distant
   * point" utility, which dispersal.ts's relocation step reuses the *logic*
   * of via `findRandomWalkableTile`, not the field): the two are
   * conceptually different triggers (giving up on a foraging area vs.
   * leaving the natal group to find mates) that could, in principle, both
   * want to be "in flight" independently, even though the current trigger
   * ordering never actually lets that happen. Cleared on arrival.
   */
  dispersalTarget?: Vec2;
  /**
   * Which of dispersal.ts's two triggers is driving the current/most recent
   * dispersal — set the moment dispersal starts, read (and cleared) when the
   * `dispersed` event is logged on arrival. See `DispersalReason`.
   */
  dispersalReason?: DispersalReason;

  /**
   * When this agent's species prefers to be active — denormalized from
   * `SpeciesDef.activityPattern` at spawn time (packages/data/src/spawn.ts),
   * the same pattern as `types`/`stats`/`moves` above. Absent (bare
   * fixtures, anything spawned outside `spawnAgent`) reads as `"cathemeral"`
   * everywhere it's consulted — no behavior change for hand-built agents
   * that never set it. See daynight.ts/DESIGN.md's Phase 2.
   */
  activityPattern?: ActivityPattern;

  // --- Shelter-building (see DESIGN.md's "Shelter-building" section, shelter.ts) ---

  /**
   * Denormalized from `SpeciesDef.buildsShelter` at spawn time
   * (packages/data/src/spawn.ts), the same pattern as `activityPattern`
   * above — so shelter.ts's engine-side checks never need to import
   * `@pokuelike/data` (which itself depends on `@pokuelike/engine`, so the
   * reverse import would be circular). Absent/false = this individual never
   * attempts shelter-building, no matter how idle/settled it is.
   */
  buildsShelter?: boolean;
  /**
   * Where a shelter-building agent is headed (still traveling) or already
   * standing (mid-construction) — set once by `shelter.ts`'s
   * `maybeTriggerShelterBuilding` and cleared only on completion or
   * cancellation (the site turned out to no longer be bare floor by the
   * time this agent arrived). Distinct from `dispersalTarget`/`exploreTarget`
   * for the same reason those stay separate from each other: independent
   * concepts that could in principle coexist, even though the current
   * priority ordering in needs.ts's `tickAgentAction` never actually lets
   * that happen. Whether the agent has arrived yet is read directly off
   * `agent.pos` vs. this field, rather than a separate boolean — one less
   * piece of state that could drift out of sync.
   */
  shelterTarget?: Vec2;
  /**
   * Ticks spent standing at `shelterTarget` actually building, once arrived
   * — the real multi-tick time investment DESIGN.md's "Shelter-building"
   * section asks for (not instant on arrival). Only starts counting once
   * `agent.pos` matches `shelterTarget`; absent/0 while still traveling.
   */
  shelterBuildTicks?: number;

  // --- Sleep (see DESIGN.md's "Sleep" section, needs.ts/predation.ts) ---

  /**
   * True while this agent is genuinely asleep — a real vulnerable-rest
   * state, not just an idle animation label (`behavior === "sleep"` gets
   * overwritten most ticks like every other `behavior` value, so this is
   * the actual progress/state field, mirroring how `dispersalTarget`/
   * `shelterTarget` are the real state behind `"disperse"`/`"buildShelter"`).
   * While true, `applyPredationInstincts` (predation.ts) skips this agent's
   * own self-defense branches entirely — it will not flee, mob, or hunt on
   * its own initiative — and needs.ts's `tickAgentAction` skips its normal
   * behavior for the tick unless a wake condition fires (see needs.ts's
   * sleep block doc comment). A sleeping agent can still be the *target* of
   * an attack, a rescue, or a guardian's intervention.
   */
  asleep?: boolean;
  /**
   * Consecutive ticks spent asleep — increments in `tickAgentNeeds` while
   * `asleep` is true, resets to 0 the instant the agent wakes (either wake
   * condition). Crossing `needs.ts`'s `LONG_SLEEP_EXP_TICKS` grants a
   * one-time exp bonus for that sleep session (detected as a threshold
   * crossing in the same place it's incremented, so no separate one-shot
   * flag is needed the way `pendingLevelDispersalCheck` needs one — that
   * flag exists because its trigger and its consumer live in different
   * modules; here both happen in the same `tickAgentNeeds` call).
   */
  sleepTicks?: number;
  /**
   * Ticks remaining on a post-kill "digesting" hunger-decay slowdown — set
   * by `predation.ts` on a real (not merely fainted) kill, ticked down and
   * cleared in `tickAgentNeeds` (needs.ts). A big meal should actually last:
   * see `KILL_SATIATION_TICKS`/`KILL_SATIATION_HUNGER_DECAY_MULTIPLIER` in
   * needs.ts for the exact effect. Absent/0 = not currently digesting, the
   * default.
   */
  digestingTicksRemaining?: number;

  /**
   * Cached BFS route (pathfinding.ts's `findPath`) for the current
   * `seekWater`/`seekFood` walk, so a multi-tile walk doesn't recompute a
   * full BFS every tick — only when the target moves, the layer changes, the
   * route is exhausted, or the next queued step is unexpectedly no longer
   * walkable. `steps` excludes the agent's current position; the array
   * shrinks by one each tick as `stepAlongPath` consumes it, and the whole
   * field is cleared (`undefined`) once exhausted or invalidated. Deliberately
   * per-agent rather than a shared per-(layer, target) cache — see
   * `stepAlongPath`'s doc comment for why. Scoped to `seekWater`/`seekFood`
   * only; every other behavior that moves an agent (flee/hunt/mate-seeking/
   * exploration/dispersal/shelter-travel/herd-migration/relocate) still uses
   * `movement.ts`'s plain greedy `stepToward`/`stepAway` and never touches
   * this field. Also reused (with `targetId` set) by `stepTowardMovingTarget`
   * for hunt/mate-seeking pursuit of a moving target — see that function's
   * own doc comment in pathfinding.ts for the staleness/recompute rules that
   * differ from the static seekWater/seekFood case. `targetId` is what tells
   * the two apart: a static-target cache never sets it, so switching from
   * one kind of walk to the other (or onto a different pursuit target)
   * always safely misses the cache instead of reusing a stale route.
   */
  pathCache?: { layer: Layer; target: Vec2; targetId?: string; steps: Vec2[] };

  /**
   * Lifetime count of real uses of each move (by `MoveSpec.id`), incremented
   * once per call inside `useMove` (combat.ts) — the single call site every
   * move-use path (predation.ts's hit resolution, support.ts's
   * `applySupportMove`) already goes through, so every caller gets counted
   * for free without touching each site individually. Purely observational
   * (the inspector UI's "used Nx" display) — nothing in the engine itself
   * reads this back, so it can't affect simulation behavior or determinism.
   * Absent/0 = never used, same convention as every other optional counter
   * on this type.
   */
  moveUseCounts?: Record<string, number>;
}

/**
 * Species ids that hunt at all — presence as a key (value always `true`)
 * marks a species as a hunter. Deliberately NOT a fixed species -> prey-list
 * mapping any more: real predators go after whatever's small/weak enough to
 * be worth it, not an exact enumerated menu (a Spearow that's crossed onto
 * the surface layer to feed will just as happily take a small enough
 * Bulbasaur as it would a Pidgey). See predation.ts's `isPreyOf`, which
 * decides actual eligibility per encounter from each agent's current power
 * (level + size, via `maxHp`), not from this table.
 */
export type HuntRules = Record<string, true>;

export interface World {
  width: number;
  height: number;
  /** One tile grid per layer, all sharing the same width/height footprint. */
  tiles: Record<Layer, Tile[]>;
  agents: Agent[];
  tick: number;
  /**
   * The seed `rng` below was constructed from — always set by `createWorld`
   * (world.ts), explicit or freshly minted via `rng.ts`'s `randomSeed()`.
   * Recorded on `World` (not just passed around and discarded) so a caller
   * that only has a `World` in hand — `packages/runner`'s CLI, a bug report,
   * a saved run — can still read back and print/log exactly which seed
   * produced it, the whole point of seeding in the first place: reproducing
   * a specific run, not just a specific *map* (worldgen.ts's seed already
   * did that half; this is the other half — deterministic *behavior*, see
   * DESIGN.md's determinism section).
   */
  rngSeed: number;
  /**
   * The ONE shared seeded generator (`rng.ts`'s `mulberry32(rngSeed)`) every
   * random roll anywhere in the engine must be threaded from — flora growth,
   * migration targets, combat variance, reproduction, leveling's wildcard
   * roll, and every other former raw `Math.random()` call site (see
   * DESIGN.md's determinism section for the full converted-call-site list).
   * Stored live on `World` (a function, not serializable data) rather than
   * only threading a bare generator function through every tick call by
   * itself — this codebase's `World` already isn't purely serializable data
   * either way (it holds live `Agent` objects), and keeping the live
   * generator reachable from the `World` it belongs to means any function
   * that already receives `world` can reach `world.rng` directly without
   * every intermediate caller needing its own separate `rng` parameter JUST
   * to pass one further down — though the tick functions below still thread
   * an explicit optional `rng` parameter too (matching the existing
   * `log`/`rules`/`ctx` convention), so a test can substitute a different
   * generator (or a fixed-output stub) without needing to mutate `world.rng`
   * out from under a shared fixture. Two worlds ticked in the same process
   * (tests do this constantly) each carry their own independent generator —
   * never a hidden module-level global.
   */
  rng: () => number;
  /**
   * Counter behind each newborn's id suffix (reproduction.ts's
   * `spawnOffspring`, `${species}-${tick}-${offspringSequence}`) — used to be
   * a module-level global, which meant two separate `World`s ticked in the
   * same process (every test file, and any determinism check that runs the
   * same seed twice in-process) could produce agent ids — and therefore
   * event-log content — that differed purely by which world happened to
   * spawn first in that process, not by anything about the world itself. Now
   * per-`World`, like `rngSeed`/`rng` above, for the same reason: reproduce a
   * specific run, not "whatever this process's shared counters happened to
   * be at the time." Absent/0 for a freshly created world.
   */
  offspringSequence?: number;
  /**
   * Bumped whenever a tile's terrain crosses in or out of "water"/"food"/
   * "sunbeam" (setTile always bumps it; flora.ts bumps it only on the
   * transitions that matter) — lets resourceIndex.ts's cache know when it
   * needs rebuilding instead of trusting a naive full-grid rescan every
   * lookup. See TODO.md's "Performance ceiling for the cheap tier" note.
   */
  resourceVersion?: number;
  /**
   * Lifetime count of tile-capacity blocked-resource fallback firings (an
   * agent's seekWater/seekFood target sat at capacity past its grace period
   * and it switched to a different tile of the same terrain — see
   * needs.ts's `BLOCKED_RESOURCE_GRACE_TICKS` handling). A plain counter
   * rather than a `SimEvent`, deliberately: see needs.ts's own doc comment
   * at the increment site for why (packages/web's exhaustive event-kind
   * switch is off-limits this session). Purely observational — nothing in
   * the engine reads this back, so it can't affect simulation behavior or
   * determinism. Absent/0 = never fired.
   */
  resourceBlockedFallbackCount?: number;
  /**
   * Lifetime count of agent-ticks spent actually waiting on a crowded
   * seekWater/seekFood target (whether or not that particular tick is the
   * one where `BLOCKED_RESOURCE_GRACE_TICKS` runs out) — a much bigger
   * number than `resourceBlockedFallbackCount` is the real-run signal that
   * agents genuinely queue/wait near a contested resource rather than just
   * instantly relocating to an alternate every time (see DESIGN.md's "Tile
   * capacity" section). Same observational, non-`SimEvent` shape and
   * reasoning as `resourceBlockedFallbackCount` — see needs.ts's increment
   * site.
   */
  resourceWaitTicks?: number;
  /**
   * Per-herd migration state — see herdMigration.ts/DESIGN.md's "Herd-level
   * migration" section. Keyed by `herdId`, not present on every agent: a
   * whole herd shares exactly one migration target at a time, so this is
   * the single source of truth `herding.ts`'s `applyHerdCohesion` reads
   * from when deciding what every member (and guardian) pulls toward.
   * Absent, or missing a given herdId, means that herd isn't migrating —
   * ordinary centroid-based cohesion applies.
   */
  herdMigrations?: Record<string, { target: Vec2; reason: MigrationReason; startedTick: number }>;
  /**
   * Per-herd consecutive-tick counter for "was this herd's local food/water
   * below the scarcity threshold this tick" — see herdMigration.ts. Tracked
   * separately from `herdMigrations` (rather than folded into it) because it
   * needs to keep counting *before* a migration exists yet, and gets reset
   * to 0 whenever a scarcity check comes back fine, or once a migration
   * actually starts (successful or not) so a single sustained-scarcity
   * window doesn't retrigger a fresh destination search every tick.
   */
  herdScarcityTicks?: Record<string, number>;
  /**
   * Per-herd rolling predator-pressure tracker — see herdMigration.ts's
   * `recordPredatorPressure`/`PREDATOR_PRESSURE_*` constants. `count` is
   * hunt/fight events landed against that herd's members within the current
   * window (`windowStart`..now); `lastThreatPos` is the attacker's position
   * at the most recent such event, used to bias migration destinations away
   * from the threat. A running counter updated at the event-emission site
   * (predation.ts), not a per-tick `EventLog` scan — cheaper, and the log
   * isn't indexed by herd/tick anyway.
   */
  herdPredatorPressure?: Record<string, { count: number; windowStart: number; lastThreatPos: Vec2 }>;
  /**
   * Per-herd-*pair* consecutive-tick counter for "these two same-species
   * herds' centroids have been within the territorial-displacement distance
   * this tick" — see herdMigration.ts's territorial trigger. Keyed by a
   * canonical `"herdIdA|herdIdB"` (sorted) so the pair is counted once
   * regardless of iteration order. Mirrors `herdScarcityTicks`'s
   * reset-on-recovery pattern.
   */
  herdTerritorialTicks?: Record<string, number>;
  /**
   * Per-herd consecutive-tick counter for "this herd's centroid is inside an
   * active storm cell with no forest/canopy cover nearby this tick" — see
   * weather.ts/herdMigration.ts's `"weather"` trigger, Phase 3. Mirrors
   * `herdScarcityTicks`'s exact reset-on-recovery/reset-on-migration
   * pattern.
   */
  herdStormExposureTicks?: Record<string, number>;
  /**
   * The biome seed points `generateWorld` (worldgen.ts) scattered for this
   * world, name-only (see `BiomeSeedInfo`) — populated only by procedurally
   * generated worlds, absent on a bare `createWorld`/hand-built test world.
   * Lets weather.ts weight spawn likelihood and cover-seeking destination
   * scoring by real biome identity (Phase 3) without `generateWorld` having
   * to export its full internal seed-placement machinery. Absent reads as
   * "no biome data" everywhere it's consulted — every consumer falls back to
   * a documented biome-agnostic default rather than crashing or silently
   * favoring one biome.
   */
  biomeSeeds?: BiomeSeedInfo[];
  /**
   * The tick `immigration.ts`'s `maybeImmigrate` last actually spawned a new
   * herd, or absent if none has happened yet this world's life — the
   * cooldown gate for `MIN_TICKS_BETWEEN_IMMIGRATIONS`, so a lucky run of
   * per-tick rolls can't cluster several immigrations in quick succession.
   * Mirrors the `herd*Ticks` fields above: per-world state, keyed by
   * nothing (there's only ever one "last immigration," not one per herd),
   * absent reads as "never happened."
   */
  lastImmigrationTick?: number;
  /**
   * 1-3 active weather systems at once — see weather.ts/DESIGN.md's Phase 3.
   * Absent (or empty) means no weather is active; every effect consumer
   * (flora.ts/needs.ts/fov.ts/combat.ts/support.ts/herdMigration.ts) treats
   * that as "no local modifier," not an error.
   */
  weatherCells?: WeatherCell[];
  /**
   * Lifetime total (not a live balance — that's `Tile.cache` itself) of food
   * deposited into every `buildsShelter` agent's home shelter cache, across
   * every shelter tile that's ever existed — see `shelter.ts`'s
   * `applyShelterResting`. Same observational, non-`SimEvent` shape and
   * reasoning as `resourceBlockedFallbackCount` (packages/web's exhaustive
   * event-kind switch is off-limits this session): a real-run validation
   * signal for whether the cache mechanic is actually accumulating anything,
   * not a value anything in the engine reads back.
   */
  shelterCacheDeposited?: number;
  /**
   * Lifetime total food actually drawn from a shelter cache to feed a
   * genuinely hungry `buildsShelter` agent — see `shelter.ts`'s
   * `maybeFeedFromShelterCache`. The real "did the safety net ever actually
   * get used" number DESIGN.md's real-run findings look for; mirrors
   * `shelterCacheDeposited`'s reasoning exactly.
   */
  shelterCacheWithdrawn?: number;
}
