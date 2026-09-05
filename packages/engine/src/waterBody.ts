import type { Agent, Layer, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";

/**
 * Connected-component sizing for "water" terrain — the missing concept
 * `weather.ts`'s `advanceWaterCycle` needed to tell a big lake/spring apart
 * from an isolated puddle (direct ask: "Bigger 'lake' or 'spring' water
 * bodies might shrink but never run out"). Before this module,
 * `advanceWaterCycle` treated every "water" tile identically — a single
 * roll of `DROUGHT_WATER_DRY_CHANCE_PER_TICK` applied the same to a
 * 200-tile lake's center as to a lone 1-tile puddle, so nothing distinguished
 * a major map feature from incidental wet ground.
 *
 * **4-connected, not 8-connected.** A diagonal-only touch between two water
 * tiles reads, visually and hydrologically, as two separate pools that
 * happen to corner-touch, not one contiguous body — worldgen.ts's own
 * moisture-field generation already produces plenty of these near-miss
 * diagonal adjacencies at biome boundaries and lake edges, and 8-connecting
 * them would silently merge visually-distinct puddles into one inflated
 * "lake," overstating how much of the map counts as a protected large body.
 * flora.ts's `trySpread`/weather.ts's `isAdjacentToWater` use 8-connectivity
 * for *spread* (a seed or a rain-formed tile can take root diagonally
 * adjacent to an existing patch/water tile — germination doesn't need a
 * shared edge), which is a different question ("can new growth start here")
 * from this module's ("are these two tiles part of the same body of water")
 * — deliberately not reusing that offset table for a different purpose.
 *
 * **Caching.** Follows `resourceIndex.ts`'s established idiom exactly: a
 * `WeakMap<World, ...>` keyed by object identity, rebuilt lazily on next
 * query rather than eagerly on every tile change, and invalidated via a
 * version counter. Reuses `World.resourceVersion` itself (rather than
 * minting a second, parallel version field) since every water-terrain
 * mutation already goes through `setTile`, which already bumps
 * `resourceVersion` unconditionally — a water body's membership can only
 * change on exactly the same writes that already invalidate the resource
 * index, so a second counter would just track the same signal under a
 * different name.
 */

interface WaterBodyIndex {
  version: number;
  /** Component size for each tile index in `world.tiles.surface`; 0 for a non-water tile. */
  sizeByTileIndex: Int32Array;
}

const cache = new WeakMap<World, WaterBodyIndex>();

/** 4-connected (von Neumann) neighbors — see this module's doc comment for why not 8. */
const NEIGHBOR_OFFSETS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function buildIndex(world: World): WaterBodyIndex {
  const tiles = world.tiles.surface;
  const width = world.width;
  const height = world.height;
  const sizeByTileIndex = new Int32Array(tiles.length);
  const visited = new Uint8Array(tiles.length);

  // Iterative BFS flood fill per unvisited water tile — iterative, not
  // recursive, since a large lake could otherwise blow the call stack on a
  // big generated map.
  const queue: number[] = [];
  for (let start = 0; start < tiles.length; start++) {
    if (visited[start] || tiles[start]!.terrain !== "water") continue;

    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    const component: number[] = [start];

    while (queue.length > 0) {
      const i = queue.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const offset of NEIGHBOR_OFFSETS) {
        const nx = x + offset.x;
        const ny = y + offset.y;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (visited[ni] || tiles[ni]!.terrain !== "water") continue;
        visited[ni] = 1;
        queue.push(ni);
        component.push(ni);
      }
    }

    for (const i of component) sizeByTileIndex[i] = component.length;
  }

  return { version: world.resourceVersion ?? 0, sizeByTileIndex };
}

function getIndex(world: World): WaterBodyIndex {
  const existing = cache.get(world);
  if (existing && existing.version === (world.resourceVersion ?? 0)) return existing;
  const fresh = buildIndex(world);
  cache.set(world, fresh);
  return fresh;
}

/**
 * Size (tile count) of the connected water body containing `pos`, or 0 if
 * `pos` isn't currently a "water" tile at all. Surface-layer only — water
 * bodies, like every other weather/terrain-mutation concept in this
 * codebase, are a Surface-layer concern (see weather.ts's own doc comment).
 */
export function waterBodySizeAt(world: World, pos: Vec2): number {
  if (pos.x < 0 || pos.y < 0 || pos.x >= world.width || pos.y >= world.height) return 0;
  const { sizeByTileIndex } = getIndex(world);
  return sizeByTileIndex[pos.y * world.width + pos.x] ?? 0;
}

/**
 * A water body at or above this tile count reads as a "lake"/"spring" — a
 * real, persistent map feature rather than incidental wet ground. Picked
 * against a real generated map's actual water-body size distribution
 * (see DESIGN.md's "Built, real-run findings" for this feature): most
 * wetland-biome water sits in bodies well into the dozens-to-hundreds of
 * tiles, while badlands/highland water tends to show up as isolated single-
 * or low-digit-tile puddles — 12 sits comfortably above "a few puddled
 * tiles that happened to touch" while well below "a real lake."
 */
export const LARGE_WATER_BODY_MIN_SIZE = 12;

export function isLargeWaterBody(size: number): boolean {
  return size >= LARGE_WATER_BODY_MIN_SIZE;
}

/**
 * A water tile counts as "shore" when at least one 4-connected neighbor is
 * itself walkable, non-water terrain — direct-adjacency-to-land, same
 * adjacency shape `occupancy.ts`'s `shelterCluster` already uses for "is
 * this tile part of the same contiguous feature," reused here for "does
 * this water tile actually touch land" rather than inventing a second
 * offset table. `NEIGHBOR_OFFSETS` above (this module's own 4-connected
 * table, used for water-body component sizing) is reused rather than
 * `flora.ts`/`weather.ts`'s 8-connected spread offsets — see this module's
 * doc comment for why 4- vs 8-connectivity is a deliberate, non-interchangeable
 * choice per use.
 */
function isShoreTile(world: World, layer: Layer, pos: Vec2): boolean {
  for (const offset of NEIGHBOR_OFFSETS) {
    const neighbor = tileAt(world, layer, pos.x + offset.x, pos.y + offset.y);
    if (neighbor?.walkable && neighbor.terrain !== "water") return true;
  }
  return false;
}

/**
 * Direct ask: "non water Pokemon can't move across large bodies of water...
 * They still need water to drink, so they wade into maybe the first shore
 * level, but anything deeper is no good." A hard physical constraint —
 * categorically different from `occupancy.ts`'s soft, opt-in-by-`mover`
 * crowding gate (see `movement.ts`/`pathfinding.ts`'s own doc comments for
 * why those two are NOT the same kind of restriction, and why this one is
 * always applied rather than skippable by omitting an optional parameter):
 * a landlocked non-water Pokémon physically cannot swim, full stop, whether
 * or not the caller remembered to opt in.
 *
 * Only meaningful when `pos` is water terrain on `layer` — returns `true`
 * unconditionally otherwise, so callers can use this as a blanket "can this
 * agent actually enter this tile, water-wise" check stacked directly
 * alongside the existing terrain `walkable` flag without a separate
 * "is this even water" branch of their own.
 *
 * The rule, in order:
 *  - Water-type agents (`agent.types?.includes("water")`): always `true`,
 *    everywhere, no restriction at all — a water Pokémon can obviously swim.
 *  - A water tile belonging to a body that ISN'T "large"
 *    (`!isLargeWaterBody`) — an ordinary pond/puddle/stream: always `true`
 *    for every type, completely unrestricted. This is deliberately the
 *    common case left untouched: most of this sim's incidental wet ground
 *    is exactly this, and it's also where an ordinary land Pokémon drinks
 *    freely, same as before this feature existed.
 *  - A LARGE water body's shore tile (`isShoreTile`) — `true` for every
 *    non-water type uniformly (wading in to drink). An earlier draft singled
 *    out Rock/Fire for a stricter shore exclusion; direct user feedback
 *    corrected that — the "esp rock and fire" in the original ask was
 *    emphasis on how bad swimming is for those types, not a request for a
 *    separate stricter tier, so there's no type-specific exception here.
 *  - Anything deeper into a large body (not touching land at all): `false`
 *    for every non-water type, no exception — this is the actual "can't
 *    move across large bodies of water" restriction the feature is about.
 */
export function canEnterWater(world: World, agent: Agent, layer: Layer, pos: Vec2): boolean {
  const tile = tileAt(world, layer, pos.x, pos.y);
  if (!tile || tile.terrain !== "water") return true;
  if (agent.types?.includes("water")) return true;

  const size = waterBodySizeAt(world, pos);
  if (!isLargeWaterBody(size)) return true;

  return isShoreTile(world, layer, pos);
}
