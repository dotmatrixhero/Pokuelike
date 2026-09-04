import type { MoveSpec } from "./moves.js";
import type { PokemonType } from "./typing.js";
import type { Stats } from "./stats.js";
import type { Disposition } from "./nature.js";

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
  | "mud";

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
  | "explore";

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
  /** Ticks spent with hunger or thirst at 0 — dies once this exceeds a threshold. Resets whenever both recover above 0. */
  starvationTicks?: number;
  /** Ticks a non-predator has spent wanting food/water with none reachable anywhere — drives migrating away once too high. */
  ticksWithoutResource?: number;
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

  /**
   * When this agent's species prefers to be active — denormalized from
   * `SpeciesDef.activityPattern` at spawn time (packages/data/src/spawn.ts),
   * the same pattern as `types`/`stats`/`moves` above. Absent (bare
   * fixtures, anything spawned outside `spawnAgent`) reads as `"cathemeral"`
   * everywhere it's consulted — no behavior change for hand-built agents
   * that never set it. See daynight.ts/DESIGN.md's Phase 2.
   */
  activityPattern?: ActivityPattern;
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
   * Bumped whenever a tile's terrain crosses in or out of "water"/"food"/
   * "sunbeam" (setTile always bumps it; flora.ts bumps it only on the
   * transitions that matter) — lets resourceIndex.ts's cache know when it
   * needs rebuilding instead of trusting a naive full-grid rescan every
   * lookup. See TODO.md's "Performance ceiling for the cheap tier" note.
   */
  resourceVersion?: number;
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
   * 1-3 active weather systems at once — see weather.ts/DESIGN.md's Phase 3.
   * Absent (or empty) means no weather is active; every effect consumer
   * (flora.ts/needs.ts/fov.ts/combat.ts/support.ts/herdMigration.ts) treats
   * that as "no local modifier," not an error.
   */
  weatherCells?: WeatherCell[];
}
