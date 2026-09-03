import type { MoveSpec } from "./moves.js";
import type { PokemonType } from "./typing.js";
import type { Stats } from "./stats.js";
import type { Disposition } from "./nature.js";

export interface Vec2 {
  x: number;
  y: number;
}

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
  | "carryAlly";

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
}

/** predator species id -> the species ids it hunts. */
export type HuntRules = Record<string, string[]>;

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
  herdMigrations?: Record<string, { target: Vec2; reason: string; startedTick: number }>;
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
}
