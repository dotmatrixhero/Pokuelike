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
  /** Combat hit points — only agents that have ever been in a fight track this. Absent = not (yet) trackable. */
  hp?: number;
  maxHp?: number;
  /** The agent this one is currently mobbing, if mid-fight. Bookkeeping only — re-evaluated each tick. */
  fightTarget?: string;
  /** Ticks a predator has gone without a successful kill while actively hunting — drives "relocate" once too high. */
  ticksSinceMeal?: number;
  /** Where a "relocate" agent is walking to. Cleared on arrival or once it feeds again. */
  relocateTarget?: Vec2;
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
