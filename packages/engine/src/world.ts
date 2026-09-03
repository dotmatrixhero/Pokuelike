import { LAYER_ORDER, type Layer, type Tile, type TerrainKind, type World } from "./types.js";

export function createTile(terrain: TerrainKind, elevation = 0): Tile {
  return { terrain, walkable: terrain !== "wall", elevation };
}

function createLayerGrid(width: number, height: number): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < width * height; i++) {
    tiles.push(createTile("floor"));
  }
  return tiles;
}

export function createWorld(width: number, height: number): World {
  const tiles = {} as Record<Layer, Tile[]>;
  for (const layer of LAYER_ORDER) {
    tiles[layer] = createLayerGrid(width, height);
  }
  return { width, height, tiles, agents: [], tick: 0 };
}

export function tileAt(world: World, layer: Layer, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return undefined;
  return world.tiles[layer][y * world.width + x];
}

export function setTile(
  world: World,
  layer: Layer,
  x: number,
  y: number,
  terrain: TerrainKind,
  elevation?: number
): void {
  const tile = tileAt(world, layer, x, y);
  if (!tile) return;
  tile.terrain = terrain;
  tile.walkable = terrain !== "wall";
  if (elevation !== undefined) tile.elevation = elevation;
}

export function setElevation(world: World, layer: Layer, x: number, y: number, elevation: number): void {
  const tile = tileAt(world, layer, x, y);
  if (tile) tile.elevation = elevation;
}

/** Layers adjacent to the given one, in the order they should be tried when crossing. */
export function adjacentLayers(layer: Layer): Layer[] {
  const index = LAYER_ORDER.indexOf(layer);
  const result: Layer[] = [];
  if (index > 0) result.push(LAYER_ORDER[index - 1]!);
  if (index < LAYER_ORDER.length - 1) result.push(LAYER_ORDER[index + 1]!);
  return result;
}

/** All layers other than the given one, nearest (adjacent) first. */
export function otherLayers(layer: Layer): Layer[] {
  const adjacent = adjacentLayers(layer);
  return [...adjacent, ...LAYER_ORDER.filter((l) => l !== layer && !adjacent.includes(l))];
}
