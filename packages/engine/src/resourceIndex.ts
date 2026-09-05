import type { Layer, Vec2, World } from "./types.js";

/**
 * "shelter" joined this list for `shelter.ts`'s `applyShelterResting`/
 * `maybeFeedFromShelterCache` — same reasoning as `food`: a `buildsShelter`
 * agent looking for "my nearest shelter" every idle tick shouldn't fall back
 * to a naive full-grid scan any more than a hungry agent looking for its
 * nearest food patch should.
 *
 * "flora" joined this list for needs.ts's `applyExploration` terrain-
 * preference wander: with two roster species (bulbasaur/venusaur) tagged
 * `preferredTerrain: ["flora"]` — see DESIGN.md's "Tile preference" section
 * — an idle satisfied grazer looking for "my nearest flora patch" every
 * idle tick earns the same indexed-lookup treatment as food/water/shelter
 * above, rather than a naive scan. Preference kinds tagged by only a single
 * species (e.g. "bush"/"boulder") stay off this list and fall back to a
 * bounded local scan instead — see `findPreferredTerrainTarget` in
 * needs.ts.
 */
export type IndexedTerrain = "water" | "food" | "sunbeam" | "shelter" | "flora";

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
  const positions: Record<IndexedTerrain, Vec2[]> = { water: [], food: [], sunbeam: [], shelter: [], flora: [] };
  const tiles = world.tiles[layer];
  for (let i = 0; i < tiles.length; i++) {
    const terrain = tiles[i]!.terrain;
    if (terrain === "water" || terrain === "food" || terrain === "sunbeam" || terrain === "shelter" || terrain === "flora") {
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
 * The underground layer never generates its own water (it's a pure flat
 * floor grid — see `createDemoWorld`'s doc comment) — direct ask:
 * "underground should share water with the ground," real groundwater
 * access rather than every drink requiring an explicit cross-to-surface
 * trip. Redirects a water lookup FROM the underground layer to the surface
 * layer's own water index; every other (layer, terrain) combination is
 * unaffected. The agent doing the lookup still walks there and drinks
 * while staying on the underground layer the whole time (underground is a
 * full flat grid at every x,y, so any surface water coordinate is also a
 * valid underground position) — `consume()` (needs.ts) never checks the
 * current tile's terrain kind, only that the agent's position matches the
 * target, so this needs no other plumbing. Canopy is deliberately NOT
 * included — it still requires an explicit surface crossing for every
 * resource, unchanged.
 */
function effectiveLookupLayer(layer: Layer, terrain: IndexedTerrain): Layer {
  return layer === "underground" && terrain === "water" ? "surface" : layer;
}

/**
 * Bump whenever a tile's terrain might have crossed in or out of a tracked
 * kind (water/food/sunbeam) — cheap (an int increment); the actual rebuild
 * is lazy, deferred to the next lookup that needs it.
 */
export function invalidateResourceIndex(world: World): void {
  world.resourceVersion = (world.resourceVersion ?? 0) + 1;
}

function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Sum of live "food" tile `stock` within Chebyshev `radius` of `from`, via
 * the cached index rather than a naive full-grid scan — used by
 * herdMigration.ts to sample local food abundance around a herd's centroid
 * (scarcity detection) and around candidate migration destinations
 * (destination scoring). Sums `stock` rather than just counting matching
 * tiles: a single near-full patch means more food is actually available
 * than several nearly-drained ones, consistent with what `stock` already
 * means in flora.ts.
 */
export function foodStockNear(world: World, layer: Layer, from: Vec2, radius: number): number {
  const { positions } = getIndex(world, effectiveLookupLayer(layer, "food"));
  let total = 0;
  for (const pos of positions.food) {
    if (chebyshev(pos, from) > radius) continue;
    total += Math.max(0, rawTileAt(world, layer, pos.x, pos.y)?.stock ?? 0);
  }
  return total;
}

/**
 * Count of tiles of `terrain` within Chebyshev `radius` of `from`, via the
 * cached index — same performance rationale as `foodStockNear` above.
 * Currently only ever called with "water" (herdMigration.ts), but kept
 * general since the index already tracks "sunbeam" too.
 */
export function countTerrainNear(world: World, layer: Layer, from: Vec2, terrain: IndexedTerrain, radius: number): number {
  const { positions } = getIndex(world, effectiveLookupLayer(layer, terrain));
  let count = 0;
  for (const pos of positions[terrain]) {
    if (chebyshev(pos, from) <= radius) count++;
  }
  return count;
}

/**
 * Nearest tile of `terrain` to `from`, using the cached index. For "food",
 * still checks each candidate's live `stock` (the index only tracks terrain
 * *kind*, not stock, since stock changes every tick from eating/decay
 * without the terrain kind itself changing) — so a depleted patch is
 * correctly skipped even though it's still present in the index until it
 * reverts to "floor".
 *
 * `exclude` (default none) skips any candidate whose coordinates exactly
 * match an entry in the list — needs.ts's blocked-resource fallback uses
 * this to ask "nearest tile of this terrain, NOT counting the one(s) I
 * already know are crowded right now" once its grace period on the current
 * target runs out, without needing a second index or a live capacity check
 * baked into this module (occupancy.ts's tile-capacity concept is a
 * movement-time concern; this stays a pure terrain lookup).
 */
export function findNearestIndexed(
  world: World,
  layer: Layer,
  from: Vec2,
  terrain: IndexedTerrain,
  exclude: readonly Vec2[] = []
): Vec2 | undefined {
  const lookupLayer = effectiveLookupLayer(layer, terrain);
  const { positions } = getIndex(world, lookupLayer);
  let best: Vec2 | undefined;
  let bestDist = Infinity;
  for (const pos of positions[terrain]) {
    if (exclude.some((e) => e.x === pos.x && e.y === pos.y)) continue;
    if (terrain === "food") {
      const tile = rawTileAt(world, lookupLayer, pos.x, pos.y);
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
