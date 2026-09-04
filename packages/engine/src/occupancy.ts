import type { Agent, Layer, Vec2, World } from "./types.js";

/**
 * Per-tile occupancy/crowding — direct ask: "a weight limit for how many
 * Pokémon can be in a given tile... always allow at least 1." See DESIGN.md's
 * "Tile capacity" section for the full writeup (calibration arithmetic, the
 * per-layer split, and real-run contention/fallback numbers).
 *
 * **Caching shape directly modeled on herdIndex.ts**, per that module's own
 * instruction: keyed by `World` object identity, rebuilt once per
 * `world.tick` on first lookup that tick (not eagerly), since agent
 * positions — like herd membership — can shift on essentially any tick and
 * a `resourceVersion`-style "only bump on a real change" counter has no
 * clean equivalent here (nothing marks "a position changed" the way
 * `setTile` marks "a terrain changed"). Known, accepted imprecision this
 * inherits from that same shape: within one tick, several agents that each
 * independently decide to step onto the same currently-empty tile all see
 * the same tick-start snapshot and can all be admitted at once, briefly
 * overshooting capacity until the very next tick's rebuild reflects it —
 * exactly the kind of same-tick race this codebase already accepts
 * elsewhere (needs.ts's `yieldsToHigherRankedFeeder` doc comment describes
 * the same-tile food-stock race in identical terms). A real run showed this
 * doesn't produce runaway overcrowding (see DESIGN.md) — it self-corrects
 * within a tick or two, not a sustained violation.
 *
 * A carried fainted ally (`Agent.beingCarriedBy`) does NOT independently
 * occupy a tile — its position mirrors its carrier's every tick (support.ts)
 * and it isn't standing under its own power, so counting it separately would
 * double-count one physical "spot" as two occupants.
 */

interface OccupancyIndex {
  tick: number;
  countByKey: Map<string, number>;
  weightByKey: Map<string, number>;
}

const cache = new WeakMap<World, OccupancyIndex>();

/**
 * Deliberately NOT imported from support.ts's `bodyWeightOf`/predation.ts's
 * `FALLBACK_MAX_HP`: `movement.ts` needs this module for capacity-aware
 * stepping, and `support.ts` already imports `movement.ts` (for
 * `stepToward`) — importing support.ts (or predation.ts, which support.ts
 * also depends on) from here would close a `movement.ts -> occupancy.ts ->
 * support.ts -> movement.ts` cycle. This is a small, deliberate duplicate of
 * the exact same fallback figure support.ts's `bodyWeightOf` uses, not a
 * second invented convention.
 */
const FALLBACK_BODY_WEIGHT = 10;

function bodyWeight(agent: Agent): number {
  return agent.maxHp ?? FALLBACK_BODY_WEIGHT;
}

function tileKey(layer: Layer, pos: Vec2): string {
  return `${layer}:${pos.x},${pos.y}`;
}

function buildIndex(world: World): OccupancyIndex {
  const countByKey = new Map<string, number>();
  const weightByKey = new Map<string, number>();
  for (const agent of world.agents) {
    if (agent.alive === false || agent.beingCarriedBy) continue;
    const k = tileKey(agent.layer, agent.pos);
    countByKey.set(k, (countByKey.get(k) ?? 0) + 1);
    weightByKey.set(k, (weightByKey.get(k) ?? 0) + bodyWeight(agent));
  }
  return { tick: world.tick, countByKey, weightByKey };
}

function getIndex(world: World): OccupancyIndex {
  const existing = cache.get(world);
  if (existing && existing.tick === world.tick) return existing;
  const fresh = buildIndex(world);
  cache.set(world, fresh);
  return fresh;
}

/**
 * Surface tiles are weight-limited: calibrated (see DESIGN.md's "Tile
 * capacity" section for the real-run arithmetic) so roughly 3 average-weight
 * agents from a real, matured population fit on one tile — a real 3000-tick
 * run across seeds 42/7/20260903 put the living population's average
 * `maxHp`-as-body-weight at ~29-32 (mean ~30.6), so 3 * ~30 = 90.
 */
export const TILE_WEIGHT_CAPACITY = 90;

/**
 * Underground and canopy are flat, generic, non-biome-varied layers (no
 * elevation or terrain texture at all — see `createDemoWorld`'s doc
 * comment) — direct ask: "underground and canopy don't have the same weight
 * restriction, just go by hard number - up to 5 max per tile." A plain
 * headcount cap fits a layer with no real terrain texture to justify
 * weight-based crowding logic better than importing the surface's
 * weight-based rule would. `>= 1` is guaranteed automatically (5 >= 1), so
 * no separate "always admit one" carve-out is needed for this branch the
 * way the weight rule needs one below.
 */
export const FLAT_TILE_HEADCOUNT_CAP = 5;

function isFlatCapacityLayer(layer: Layer): boolean {
  return layer === "underground" || layer === "canopy";
}

/** Current occupant headcount of `(layer, pos)` — living, not-currently-carried agents only. Exported for tests/diagnostics. */
export function tileOccupantCount(world: World, layer: Layer, pos: Vec2): number {
  return getIndex(world).countByKey.get(tileKey(layer, pos)) ?? 0;
}

/** Current summed occupant body-weight of `(layer, pos)` — see `TILE_WEIGHT_CAPACITY`'s doc comment. Exported for tests/diagnostics. */
export function tileOccupantWeight(world: World, layer: Layer, pos: Vec2): number {
  return getIndex(world).weightByKey.get(tileKey(layer, pos)) ?? 0;
}

/**
 * Can `agent` move onto `(layer, pos)` right now, capacity-wise? An
 * already-empty tile always admits at least one agent regardless of weight
 * or species — direct requirement, so a single heavy/populous species is
 * never unable to stand anywhere. Otherwise: underground/canopy use the flat
 * headcount cap; every other layer (surface) uses the weight rule. This is a
 * pure capacity check — it says nothing about terrain walkability, which
 * callers (movement.ts, pathfinding.ts) check separately and first.
 */
export function canEnterTile(world: World, agent: Agent, layer: Layer, pos: Vec2): boolean {
  const count = tileOccupantCount(world, layer, pos);
  if (count === 0) return true;
  if (isFlatCapacityLayer(layer)) return count < FLAT_TILE_HEADCOUNT_CAP;
  return tileOccupantWeight(world, layer, pos) + bodyWeight(agent) <= TILE_WEIGHT_CAPACITY;
}
