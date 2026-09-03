import type { MoveSpec } from "./moves.js";
import type { PokemonType } from "./typing.js";
import type { Stats } from "./stats.js";

export interface Vec2 {
  x: number;
  y: number;
}

/** "seedling" is a planted, not-yet-mature food source — see flora.ts. */
export type TerrainKind = "floor" | "wall" | "water" | "food" | "sunbeam" | "seedling";

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
  /** "food" tiles only: how much is currently available (0-1). Depletes when eaten from, regrows over time — see flora.ts. */
  stock?: number;
  /** "seedling" tiles only: ticks since it took root. Becomes "food" once mature. */
  growth?: number;
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
}
