import type { MoveSpec } from "./moves.js";
import type { PokemonType } from "./typing.js";
import type { Stats } from "./stats.js";

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * "seedling" is a planted, not-yet-mature patch — see flora.ts. It matures
 * into either "food" (edible, has stock) or "flora" (decorative only —
 * not edible, just a nicer tile to be standing on than bare floor).
 */
export type TerrainKind = "floor" | "wall" | "water" | "food" | "flora" | "sunbeam" | "seedling";

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
  /** "seedling" tiles only: ticks since it took root. Becomes "food" or "flora" once mature — see flora.ts. */
  growth?: number;
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
  | "relocate";

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
  /** Absent/true = alive. Dead agents are pruned from World.agents at the end of the tick they die in. */
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
