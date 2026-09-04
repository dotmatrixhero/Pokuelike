import type { Agent, Layer, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";

/**
 * Fixed neighbor visit order for BFS — deterministic regardless of any
 * agent/world state, never touches `world.rng`. Orthogonal-first (matching
 * `movement.ts`'s own Manhattan-flavored stepping) then diagonals, so a BFS
 * path prefers the same kind of moves `stepToward` would already take when
 * there's no obstacle to route around.
 */
const NEIGHBOR_OFFSETS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** Upper bound on tiles BFS will expand before giving up — cheap insurance against a pathological huge-map worst case; real maps are ~90x60 (5400 tiles), well under this. */
const MAX_EXPANSIONS = 20000;

function key(pos: Vec2): string {
  return `${pos.x},${pos.y}`;
}

/**
 * Breadth-first search for a real, obstacle-routing path from `from` to
 * `to` on `(world, layer)`, respecting `tileAt(...)?.walkable` exactly like
 * `movement.ts`'s greedy `stepToward` does. Unweighted grid, so BFS already
 * finds a shortest path — no need for Dijkstra/A* here (see this module's
 * doc comment in DESIGN.md for why). Returns the ordered steps EXCLUDING
 * `from` and INCLUDING `to`, or `undefined` if `to` is unreachable (or is
 * itself unwalkable, or `from === to`, in which case an empty array is
 * returned instead — "no steps needed", not "unreachable").
 *
 * Deterministic: fixed `NEIGHBOR_OFFSETS` order, no randomness anywhere in
 * this function — safe to call from anywhere without touching `world.rng`
 * or otherwise affecting the seeded-replay guarantee (see DESIGN.md's
 * "Determinism" section).
 */
export function findPath(world: World, layer: Layer, from: Vec2, to: Vec2): Vec2[] | undefined {
  if (from.x === to.x && from.y === to.y) return [];
  if (!tileAt(world, layer, to.x, to.y)?.walkable) return undefined;

  const startKey = key(from);
  const cameFrom = new Map<string, Vec2>();
  const visited = new Set<string>([startKey]);
  const queue: Vec2[] = [from];
  let head = 0;
  let expansions = 0;

  while (head < queue.length) {
    const current = queue[head]!;
    head++;
    if (++expansions > MAX_EXPANSIONS) return undefined;

    for (const offset of NEIGHBOR_OFFSETS) {
      const next: Vec2 = { x: current.x + offset.x, y: current.y + offset.y };
      const nextKey = key(next);
      if (visited.has(nextKey)) continue;
      if (!tileAt(world, layer, next.x, next.y)?.walkable) continue;
      visited.add(nextKey);
      cameFrom.set(nextKey, current);
      if (next.x === to.x && next.y === to.y) {
        // Reconstruct by walking `cameFrom` back to `from`, then reverse.
        const path: Vec2[] = [next];
        let walk = current;
        while (key(walk) !== startKey) {
          path.push(walk);
          walk = cameFrom.get(key(walk))!;
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }
  return undefined;
}

/**
 * Path-following version of `movement.ts`'s `stepToward`, backed by a real
 * BFS route (`findPath` above) instead of single-step greedy stepping —
 * built specifically for `needs.ts`'s `seekWater`/`seekFood`, the one
 * confirmed real death case (an Onix got stuck oscillating near a boulder
 * cluster, see DESIGN.md/TODO.md). NOT a drop-in replacement for
 * `stepToward` everywhere: flee/hunt/mate-seeking/exploration/dispersal/
 * shelter-travel/herd-migration all deliberately keep using plain
 * `stepToward`/`stepAway` — see this function's call site in needs.ts for
 * why the scope stops here.
 *
 * Caches the computed path on `agent.pathCache` (types.ts) so a multi-tile
 * walk doesn't re-run BFS every single tick — only recomputed when the
 * target moved, the cache is for a different layer (a resource target can
 * flip layers between calls, e.g. crossing to seek elsewhere), the cached
 * route is exhausted, or the next queued step is unexpectedly no longer
 * walkable (rare — a tile turning solid mid-walk isn't a normal occurrence
 * in this sim, but this is cheap defensive handling rather than assuming it
 * can't happen). Per-agent rather than a shared per-(layer, target) cache:
 * see this module's DESIGN.md writeup for the reasoning (many agents share
 * a herd's nearest water tile, so a shared flow-field would dedupe more
 * work, but per-agent BFS on this map size is already cheap — a handful of
 * thousand tile expansions worst case — and a real 2000-tick run showed no
 * measurable slowdown; not worth the extra invalidation surface unless a
 * real run shows otherwise).
 */
export function stepAlongPath(world: World, agent: Agent, target: Vec2): Vec2 {
  const cache = agent.pathCache;
  const targetMatches = cache && cache.layer === agent.layer && cache.target.x === target.x && cache.target.y === target.y;

  let steps = targetMatches ? cache!.steps : undefined;
  if (!steps || steps.length === 0) {
    steps = findPath(world, agent.layer, agent.pos, target);
    if (!steps || steps.length === 0) {
      agent.pathCache = undefined;
      return agent.pos;
    }
  }

  let next = steps[0]!;
  if (!tileAt(world, agent.layer, next.x, next.y)?.walkable) {
    // Defensive: the cached next step is no longer walkable (a tile changed
    // state mid-walk). Recompute fresh rather than walking into a wall.
    const fresh = findPath(world, agent.layer, agent.pos, target);
    if (!fresh || fresh.length === 0) {
      agent.pathCache = undefined;
      return agent.pos;
    }
    steps = fresh;
    next = steps[0]!;
  }

  const remaining = steps.slice(1);
  agent.pathCache = remaining.length > 0 ? { layer: agent.layer, target, steps: remaining } : undefined;
  return next;
}
