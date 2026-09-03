export interface Vec2 {
  x: number;
  y: number;
}

export type TerrainKind = "floor" | "wall" | "water" | "food" | "sunbeam";

export interface Tile {
  terrain: TerrainKind;
  walkable: boolean;
}

/** Needs decay over time and drive an agent's behavior via simple utility AI. */
export interface Needs {
  hunger: number; // 0 = starving, 1 = full
  thirst: number; // 0 = parched, 1 = hydrated
  energy: number; // 0 = exhausted, 1 = rested
  mateDrive: number; // 0 = none, 1 = urgent
}

export type BehaviorKind = "idle" | "seekWater" | "seekFood" | "seekMate" | "flee" | "hunt";

export interface Agent {
  id: string;
  species: string;
  pos: Vec2;
  needs: Needs;
  behavior: BehaviorKind;
  /** Agents in the same herd share a home range and will regroup. */
  herdId?: string;
}

export interface World {
  width: number;
  height: number;
  tiles: Tile[];
  agents: Agent[];
  tick: number;
}
