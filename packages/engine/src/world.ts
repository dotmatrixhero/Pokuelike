import type { Tile, TerrainKind, World } from "./types.js";

export function createTile(terrain: TerrainKind): Tile {
  return { terrain, walkable: terrain !== "wall" };
}

export function createWorld(width: number, height: number): World {
  const tiles: Tile[] = [];
  for (let i = 0; i < width * height; i++) {
    tiles.push(createTile("floor"));
  }
  return { width, height, tiles, agents: [], tick: 0 };
}

export function tileAt(world: World, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return undefined;
  return world.tiles[y * world.width + x];
}

export function setTile(world: World, x: number, y: number, terrain: TerrainKind): void {
  const tile = tileAt(world, x, y);
  if (!tile) return;
  tile.terrain = terrain;
  tile.walkable = terrain !== "wall";
}
