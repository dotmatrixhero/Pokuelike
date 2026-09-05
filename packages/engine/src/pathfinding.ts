import type { Agent, Layer, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";
import { stepToward } from "./movement.js";
import { canEnterTile } from "./occupancy.js";

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
 *
 * `mover`, when given, treats a tile at capacity (`occupancy.ts`'s
 * `canEnterTile`) as impassable for this search too — a full tile "routes
 * around, same as an obstacle" per direct instruction, applied uniformly to
 * every tile BFS would step onto, `to` included. That last part is a
 * deliberate scope call: if `to` itself is currently at capacity, this
 * returns `undefined` (unreachable right now) rather than finding a route to
 * some tile adjacent to it — needs.ts's blocked-resource handling treats
 * that `undefined` as "can't make progress toward this target right now"
 * and reacts (waits out a grace period, then tries a different resource
 * tile), which in practice still reads as "stopped near the resource" for
 * the common case (an agent that had been closing in over many prior ticks,
 * only blocked in the final stretch once other agents got there first) —
 * see DESIGN.md's "Tile capacity" section for the real-run read on this.
 */
export function findPath(world: World, layer: Layer, from: Vec2, to: Vec2, mover?: Agent): Vec2[] | undefined {
  if (from.x === to.x && from.y === to.y) return [];
  if (!tileAt(world, layer, to.x, to.y)?.walkable) return undefined;
  if (mover && !canEnterTile(world, mover, layer, to)) return undefined;

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
      // `to` was already capacity-checked above (the early-return guard);
      // re-checking it here would be redundant, not wrong, but this keeps
      // the capacity check scoped to intermediate tiles being expanded.
      if (mover && !(next.x === to.x && next.y === to.y) && !canEnterTile(world, mover, layer, next)) continue;
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
    steps = findPath(world, agent.layer, agent.pos, target, agent);
    if (!steps || steps.length === 0) {
      agent.pathCache = undefined;
      return agent.pos;
    }
  }

  let next = steps[0]!;
  if (!tileAt(world, agent.layer, next.x, next.y)?.walkable || !canEnterTile(world, agent, agent.layer, next)) {
    // Defensive: the cached next step is no longer walkable, OR (far more
    // common now — crowding shifts tick to tick) no longer has room.
    // Recompute fresh rather than walking into a wall or a full tile.
    const fresh = findPath(world, agent.layer, agent.pos, target, agent);
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

/**
 * How far a pursuit target has to drift from the position the cached route
 * was aimed at before that route counts as stale and gets recomputed. A
 * moving hunt/mate target invalidates `stepAlongPath`'s exact-position cache
 * match almost every tick (the target's `Vec2` is different from one tick to
 * the next even when it barely moved), which would make a naive swap to
 * `stepAlongPath` recompute a full BFS every single tick anyway — no
 * caching benefit at all, the exact problem this function exists to avoid.
 * Instead the cached route is kept and simply walked one more step as long
 * as the target hasn't wandered far from where the route was actually
 * heading. 3 tiles is chosen to sit between this sim's tight
 * combat-adjacency radii (`MOB_TRIGGER_RADIUS` = 2 in predation.ts — once a
 * threat/prey is this close, exact positioning starts to matter a lot) and
 * its wider detection radii (`HUNT_DETECT_RADIUS` = 5, `MATE_SEARCH_RADIUS`
 * = 5): a route stays valid through a couple of tiles of normal target
 * drift, which is most of what happens tick to tick since prey/mates move
 * at the same one-tile-per-tick pace as everything else, but a route aimed
 * 3+ tiles wide of where the target actually is now would start meaningfully
 * misdirecting the chase, so that's where a refresh is worth the BFS cost.
 */
const PURSUIT_RECOMPUTE_DRIFT_TILES = 3;

/**
 * Once a pursuer is this close to a moving target, recompute a fresh route
 * every tick instead of trusting the cache at all — matches
 * `MOB_TRIGGER_RADIUS`/melee-attack range (predation.ts) plus a one-tile
 * margin: this is exactly the zone where the last couple of steps decide
 * whether the chase actually connects (attack range, or mate adjacency at
 * distance 1), so precision matters more than saving a BFS call, and BFS
 * from this close is trivially cheap anyway (a handful of tile expansions
 * at most, not the map-spanning worst case `MAX_EXPANSIONS` guards against).
 */
const PURSUIT_CLOSE_RECOMPUTE_RADIUS = 3;

/**
 * `stepAlongPath`'s counterpart for a MOVING pursuit target (a currently-
 * visible hunt target in predation.ts, or a mate-seeking partner in
 * reproduction.ts) — real BFS routing around obstacles instead of
 * `movement.ts`'s greedy `stepToward`, but with its own staleness/recompute
 * rules instead of `stepAlongPath`'s exact-position cache match, which would
 * defeat the whole point of caching against a target that moves most ticks.
 *
 * The cached route (still `agent.pathCache`, tagged with `targetId` so it
 * never collides with a `stepAlongPath` static-target cache or a stale
 * pursuit of a *different* target — see `Agent.pathCache`'s own doc comment
 * in types.ts) is kept and walked one more step unless any of:
 *  - the cache is for a different layer or a different target entirely
 *    (`targetId` mismatch) — always a hard recompute, same as `stepAlongPath`;
 *  - the route is exhausted;
 *  - the target has drifted `PURSUIT_RECOMPUTE_DRIFT_TILES`+ tiles from
 *    where the cached route was actually aimed (see that constant's own doc
 *    comment for the reasoning behind the number);
 *  - the pursuer is now within `PURSUIT_CLOSE_RECOMPUTE_RADIUS` of the
 *    target, where precision matters more than the caching benefit;
 *  - the next queued step unexpectedly became unwalkable (same defensive
 *    case `stepAlongPath` already handles).
 *
 * "Give up if can't find [a route]": when `findPath` returns `undefined`
 * (the target is genuinely unreachable right now — e.g. walled off), this
 * does NOT freeze the pursuer in place the way `stepAlongPath` does for the
 * static seekWater/seekFood case (freezing there is fine — a stalled
 * approach to an unreachable resource just means the outer give-up-and-
 * relocate timeout fires normally). Freezing a hunt/mate chase would instead
 * look like the pursuer just standing there doing nothing, indistinguishable
 * from a bug — so this falls back to plain `stepToward` instead: the exact
 * greedy behavior this sim already had for hunt/mate approach before this
 * change, not a new failure mode. That greedy step may not make real
 * progress around the obstacle, but it's a pre-existing, already-tolerated
 * outcome (predation.ts's own `RELOCATE_AFTER_TICKS`/`giveUpAndRelocate` and
 * reproduction.ts's `ticksSinceEligibleMate` both already exist precisely to
 * eventually route around a hunt/mate attempt that isn't going anywhere), so
 * this reuses that existing shape rather than inventing a new one.
 *
 * A target that dies, faints out of predation's `isPreyOf`, or wanders out
 * of detection range mid-chase doesn't need any special handling HERE: both
 * call sites already re-scan for a fresh nearest-candidate every tick
 * (predation.ts's `candidates`/`nearest`, reproduction.ts's
 * `candidates`/`nearestMate`), so a target that's no longer a valid pursuit
 * target simply stops being passed to this function at all the very next
 * tick — the stale `pathCache` entry is left on the agent but is harmless:
 * it just won't `targetId`-match whatever (if anything) is pursued next.
 */
export function stepTowardMovingTarget(world: World, agent: Agent, target: Agent): Vec2 {
  // Deliberately capacity-BLIND (no `mover` threaded to `findPath`/
  // `stepToward` here), unlike `stepAlongPath` above — real-run finding
  // (see DESIGN.md's "Tile capacity" section): a hunt/mate pursuit only
  // ever needs to reach *adjacency* to its target, never to physically
  // stand on the target's own tile, so gating this on tile capacity gained
  // nothing but a real, measured cost — a pursuer's route to a target
  // standing amid a normal herd cluster (a live-agent tile easily at or
  // near capacity just from the herd itself) would go through `findPath`'s
  // early "`to` is blocked" check and come back `undefined`, misreading
  // ordinary herd density as "unreachable." A 3000-tick real run showed
  // this tanking births by up to ~90% on one seed (225 -> 21) with the gate
  // on; reverting just this function back to its pre-feature capacity-blind
  // behavior restored normal hunt/mate-seeking while `stepAlongPath`'s
  // consumption-gate (the part the feature is actually about) stays intact.
  const cache = agent.pathCache;
  const sameTarget = !!cache && cache.layer === agent.layer && cache.targetId === target.id;
  const drifted = sameTarget && manhattanDistance(cache!.target, target.pos) >= PURSUIT_RECOMPUTE_DRIFT_TILES;
  const closingIn = manhattanDistance(agent.pos, target.pos) <= PURSUIT_CLOSE_RECOMPUTE_RADIUS;

  let steps = sameTarget && !drifted && !closingIn ? cache!.steps : undefined;

  if (!steps || steps.length === 0) {
    const fresh = findPath(world, agent.layer, agent.pos, target.pos);
    if (!fresh) {
      // Genuinely unreachable right now — give up on routing and fall back
      // to the pre-existing greedy approach rather than freezing in place.
      agent.pathCache = undefined;
      return stepToward(world, agent.layer, agent.pos, target.pos);
    }
    if (fresh.length === 0) {
      // Already standing on the target's own tile (shouldn't normally
      // happen for a live pursuit target, but matches stepAlongPath's own
      // handling of the same edge case).
      agent.pathCache = undefined;
      return agent.pos;
    }
    steps = fresh;
  }

  let next = steps[0]!;
  if (!tileAt(world, agent.layer, next.x, next.y)?.walkable) {
    // Defensive: the cached next step is no longer walkable.
    const fresh = findPath(world, agent.layer, agent.pos, target.pos);
    if (!fresh) {
      agent.pathCache = undefined;
      return stepToward(world, agent.layer, agent.pos, target.pos);
    }
    if (fresh.length === 0) {
      agent.pathCache = undefined;
      return agent.pos;
    }
    steps = fresh;
    next = steps[0]!;
  }

  // `findPath`'s destination is `target.pos` itself, so the final real step
  // of any path to a live target IS `target.pos` — direct ask: "two units in
  // combat should never share the same tile." Once this close (one BFS step
  // short of `target`), don't take that last step onto its tile; sidestep
  // onto an orthogonal neighbor of `target` instead via `stepToward`'s
  // `stopAdjacent` guard — from a position diagonally adjacent to a
  // stationary (or slow) target, that lands exactly on a real Manhattan-1
  // attack-range tile in one hop, same as the pre-fix behavior converged to,
  // just next to the target instead of on it.
  //
  // Known, accepted edge case: an adversary that relocates by exactly 1
  // tile, every single tick, in a fixed pattern precisely matched to the
  // pursuer's own reaction cadence can in principle keep re-creating
  // diagonal adjacency forever (a stable pursuit-evasion 2-cycle). No real
  // engine-driven behavior in this codebase moves like that — flee/wander/
  // dispersal all have real randomness or converge — so this is treated as
  // a synthetic-test-only concern, not a real gameplay one (see
  // predation.test.ts's moving-target pursuit test, whose synthetic prey
  // movement was deliberately detuned off an exact period-2 pattern for
  // this reason). Discards the path cache since this tick diverges from the
  // cached route.
  if (next.x === target.pos.x && next.y === target.pos.y) {
    agent.pathCache = undefined;
    return stepToward(world, agent.layer, agent.pos, target.pos, undefined, true);
  }

  const remaining = steps.slice(1);
  agent.pathCache =
    remaining.length > 0 ? { layer: agent.layer, target: { ...target.pos }, targetId: target.id, steps: remaining } : undefined;
  return next;
}

function manhattanDistance(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
