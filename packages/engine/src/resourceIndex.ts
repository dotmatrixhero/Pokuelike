import type { Layer, Vec2, World } from "./types.js";

type IndexedTerrain = "water" | "food" | "sunbeam";

interface LayerIndex {
  version: number;
  positions: Record<IndexedTerrain, Vec2[]>;
}

/**
 * Keyed by World object identity (not by any field on World) so a fresh
 * `createWorld`/generated world always starts with no stale cache, and a
 * garbage-collected World's cache entry is reclaimable too.
 */
const cache = new WeakMap<World, Partial<Record<Layer, LayerIndex>>>();

function rawTileAt(world: World, layer: Layer, x: number, y: number) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return undefined;
  return world.tiles[layer][y * world.width + x];
}

function buildIndex(world: World, layer: Layer): LayerIndex {
  const positions: Record<IndexedTerrain, Vec2[]> = { water: [], food: [], sunbeam: [] };
  const tiles = world.tiles[layer];
  for (let i = 0; i < tiles.length; i++) {
    const terrain = tiles[i]!.terrain;
    if (terrain === "water" || terrain === "food" || terrain === "sunbeam") {
      positions[terrain].push({ x: i % world.width, y: Math.floor(i / world.width) });
    }
  }
  return { version: world.resourceVersion ?? 0, positions };
}

/**
 * Cached, per-(World, layer) coordinate lists for the terrain kinds
 * `findNearestTerrain` (needs.ts) and the food-delivery lookup in support.ts
 * look for — see TODO.md's "Performance ceiling for the cheap tier" note. A
 * naive scan is O(width*height) *per call*; at the ~90x60 generated map size
 * (up from the old 24x16) with a real run's population, that stacked into a
 * genuine bottleneck (a full-grid scan for every hungry/thirsty agent's
 * action tick). This index turns each lookup into O(matching tiles) instead,
 * at the cost of an occasional O(width*height) rebuild — but only when the
 * tiles actually changed (tracked via `World.resourceVersion`), and lazily
 * (on next lookup, not eagerly on every bump).
 */
function getIndex(world: World, layer: Layer): LayerIndex {
  let perWorld = cache.get(world);
  if (!perWorld) {
    perWorld = {};
    cache.set(world, perWorld);
  }
  const existing = perWorld[layer];
  if (existing && existing.version === (world.resourceVersion ?? 0)) return existing;
  const fresh = buildIndex(world, layer);
  perWorld[layer] = fresh;
  return fresh;
}

/**
 * Bump whenever a tile's terrain might have crossed in or out of a tracked
 * kind (water/food/sunbeam) — cheap (an int increment); the actual rebuild
 * is lazy, deferred to the next lookup that needs it.
 */
export function invalidateResourceIndex(world: World): void {
  world.resourceVersion = (world.resourceVersion ?? 0) + 1;
}

/**
 * Nearest tile of `terrain` to `from`, using the cached index. For "food",
 * still checks each candidate's live `stock` (the index only tracks terrain
 * *kind*, not stock, since stock changes every tick from eating/decay
 * without the terrain kind itself changing) — so a depleted patch is
 * correctly skipped even though it's still present in the index until it
 * reverts to "floor".
 */
export function findNearestIndexed(world: World, layer: Layer, from: Vec2, terrain: IndexedTerrain): Vec2 | undefined {
  const { positions } = getIndex(world, layer);
  let best: Vec2 | undefined;
  let bestDist = Infinity;
  for (const pos of positions[terrain]) {
    if (terrain === "food") {
      const tile = rawTileAt(world, layer, pos.x, pos.y);
      if ((tile?.stock ?? 0) <= 0) continue;
    }
    const dist = Math.abs(pos.x - from.x) + Math.abs(pos.y - from.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = pos;
    }
  }
  return best;
}
