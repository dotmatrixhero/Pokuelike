import type { Agent, Layer, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";

/**
 * Per-tile occupancy — direct ask, evolved twice: first "a weight limit for
 * how many Pokémon can be in a given tile... always allow at least 1," then
 * a full reversal after watching a fainted Scyther and a fleeing Diglett
 * visibly sharing a tile mid-fight: "I think we want to avoid units on the
 * same tile altogether... everywhere, always." `canEnterTile` below is now a
 * flat "one living occupant, full stop" rule outside shelter terrain — see
 * its own doc comment. The old weight/headcount/species-exclusivity system
 * (`TILE_WEIGHT_CAPACITY`, `FLAT_TILE_HEADCOUNT_CAP`, same-species-only
 * sharing) is gone; shelter's own separate multi-occupant "den" rule below
 * is the one deliberate, explicitly-scoped exception this still respects
 * (that's its own distinct feature — pair-bonding/nesting — not incidental
 * crowding). See DESIGN.md's "Tile capacity" and "No shared tiles" sections.
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
 * overshooting capacity — `simulation.ts`'s `resolveTileOverlaps` cleans
 * this up as a final per-tick pass rather than leaving it to "self-correct
 * eventually" the way the old, more tolerant weight-cap design could.
 *
 * A carried fainted ally (`Agent.beingCarriedBy`) does NOT independently
 * occupy a tile — its position mirrors its carrier's every tick (support.ts)
 * and it isn't standing under its own power, so counting it separately would
 * double-count one physical "spot" as two occupants.
 */

interface OccupancyIndex {
  tick: number;
  countByKey: Map<string, number>;
}

const cache = new WeakMap<World, OccupancyIndex>();

function tileKey(layer: Layer, pos: Vec2): string {
  return `${layer}:${pos.x},${pos.y}`;
}

function buildIndex(world: World): OccupancyIndex {
  const countByKey = new Map<string, number>();
  for (const agent of world.agents) {
    if (agent.alive === false || agent.beingCarriedBy) continue;
    const k = tileKey(agent.layer, agent.pos);
    countByKey.set(k, (countByKey.get(k) ?? 0) + 1);
  }
  return { tick: world.tick, countByKey };
}

function getIndex(world: World): OccupancyIndex {
  const existing = cache.get(world);
  if (existing && existing.tick === world.tick) return existing;
  const fresh = buildIndex(world);
  cache.set(world, fresh);
  return fresh;
}

/** Current occupant headcount of `(layer, pos)` — living, not-currently-carried agents only. Exported for tests/diagnostics. */
export function tileOccupantCount(world: World, layer: Layer, pos: Vec2): number {
  return getIndex(world).countByKey.get(tileKey(layer, pos)) ?? 0;
}

/**
 * Can `agent` move onto `(layer, pos)` right now? Outside shelter terrain,
 * this is now a flat "one living occupant, full stop" rule: an already-empty
 * tile admits exactly one agent, an occupied one admits none — direct ask,
 * after watching two combatants visibly sharing a tile mid-fight: "avoid
 * units on the same tile altogether... everywhere, always." Replaces the
 * earlier weight-based (surface) / flat-5 (underground, canopy) / same-
 * species-only crowding system entirely — those were real, deliberately
 * tuned features in their own right, but the direct reversal above
 * supersedes them rather than layering on top. Shelter terrain keeps its
 * own separate, still-deliberate multi-occupant "den" rule (see the section
 * below) — a genuinely different feature (pair-bonding/nesting), not
 * incidental crowding, and the one exception this rule was told to respect.
 * `agent` matters again now, for one real case: asking "can I enter (or
 * stay at) `pos`" when `agent` is already standing exactly there itself —
 * arrival/re-confirmation callers (`applyDispersal`, `migrate`) genuinely
 * need that to read as "yes," not "no, this tile already has an occupant
 * (you)." `agent` doesn't count toward its OWN blocking check for that
 * reason; it still fully counts toward anyone else's. This is a pure
 * capacity check regardless of any of that — it says nothing about terrain
 * walkability, which callers (movement.ts, pathfinding.ts) check separately
 * and first.
 */
export function canEnterTile(world: World, agent: Agent, layer: Layer, pos: Vec2): boolean {
  if (tileAt(world, layer, pos.x, pos.y)?.terrain === "shelter") return canEnterShelter(world, layer, pos);
  const count = tileOccupantCount(world, layer, pos);
  const selfAlreadyThere = agent.alive !== false && !agent.beingCarriedBy && agent.layer === layer && agent.pos.x === pos.x && agent.pos.y === pos.y ? 1 : 0;
  return count - selfAlreadyThere <= 0;
}

// --- Shelter capacity (direct instruction: "only 2 units and an egg can
// share a single tile of shelter, though multiple adjacent shelter can
// increase the number who can live in it") — a shelter-specific headcount
// cap layered ON TOP OF the general capacity model above, not a variant of
// it: a shelter tile's terrain kind ("shelter") short-circuits the ordinary
// weight rule entirely in `canEnterTile` above, since 2 real adults (any
// species — universal shelter, point 1) is a headcount question, not a
// weight one. See DESIGN.md's "Universal shelter and capacity" section. ---

/** Adults (non-egg occupants) a single shelter tile holds on its own. */
export const SHELTER_TILE_ADULT_CAP = 2;
/**
 * Eggs a single shelter tile holds on its own. Back to the original 1 (the
 * literal "only 2 units and an egg" instruction) after a real round-trip:
 * briefly raised to `EGG_CLUTCH_MAX` (4) so clutches (`eggs.ts`'s
 * `EGG_CLUTCH_MIN`/`EGG_CLUTCH_MAX`, 2-4) weren't structurally inert (every
 * real shelter cluster observed was 1 tile, so a cap of 1 dropped every
 * clutch egg past the first) — real runs confirmed the mechanism working
 * (seed 7 reached population 414 by tick 8000, up from ~20), but the
 * resulting growth was more than the user wanted ("reduce the cap back to
 * 1"). Clutches still draw 2-4 eggs per laying event as before; with the
 * cap back at 1, only the first egg of any clutch actually gets placed on
 * a lone shelter tile — real growth again requires shelter tiles to
 * actually cluster (see the still-open, still-real "bias pickBuildSite
 * toward existing shelter" follow-up in TODO.md) for a clutch to matter.
 */
export const SHELTER_TILE_EGG_CAP = 1;

/** Cap on how large a connected shelter cluster's BFS is allowed to grow before giving up — a real map should never approach this; it's a defensive bound against a pathological all-shelter map, not a tuning constant. */
const SHELTER_CLUSTER_SCAN_CAP = 200;

/**
 * Every "shelter" tile reachable from `pos` via 4-directional adjacency
 * (including `pos` itself, which must already be shelter terrain — returns
 * just `[pos]` otherwise, so a non-shelter tile trivially "clusters" with
 * only itself and every capacity check below degrades to the single-tile
 * case). This is the "household" a bonded pair's egg-laying/hatching and a
 * resting agent's movement range within its home range — adjacent shelter
 * tiles pool their capacity rather than each capping independently, per
 * direct instruction ("multiple adjacent shelter can increase the number
 * who can live in it").
 */
export function shelterCluster(world: World, layer: Layer, pos: Vec2): Vec2[] {
  if (tileAt(world, layer, pos.x, pos.y)?.terrain !== "shelter") return [pos];
  const seen = new Set<string>();
  const tiles: Vec2[] = [];
  const stack: Vec2[] = [pos];
  while (stack.length > 0 && tiles.length < SHELTER_CLUSTER_SCAN_CAP) {
    const p = stack.pop()!;
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (tileAt(world, layer, p.x, p.y)?.terrain !== "shelter") continue;
    tiles.push(p);
    stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  return tiles;
}

/**
 * Real occupant headcount of `pos`'s whole shelter cluster — adults (living,
 * not-currently-carried, non-egg agents) and eggs (`Agent.isEgg`) counted
 * separately, since they have separate caps (`SHELTER_TILE_ADULT_CAP`/
 * `SHELTER_TILE_EGG_CAP`, both scaled by cluster size). A direct
 * `world.agents` scan restricted to the (small) cluster's tile set, not the
 * cached weight/count index above — that index doesn't distinguish eggs from
 * adults and is keyed per-tile, not per-cluster, so reusing it here would
 * need its own cluster-aware cache; shelters are sparse enough on a real map
 * that a plain scan per call is cheap in practice. Exported for tests/diagnostics.
 */
export function shelterOccupants(world: World, layer: Layer, pos: Vec2): { tiles: Vec2[]; adults: number; eggs: number } {
  const tiles = shelterCluster(world, layer, pos);
  const tileSet = new Set(tiles.map((t) => `${t.x},${t.y}`));
  let adults = 0;
  let eggs = 0;
  for (const agent of world.agents) {
    if (agent.alive === false || agent.beingCarriedBy) continue;
    if (agent.layer !== layer) continue;
    if (!tileSet.has(`${agent.pos.x},${agent.pos.y}`)) continue;
    if (agent.isEgg) eggs += 1;
    else adults += 1;
  }
  return { tiles, adults, eggs };
}

/** Can one more adult (non-egg) agent move onto/stand at `pos`'s shelter cluster right now? */
export function canEnterShelter(world: World, layer: Layer, pos: Vec2): boolean {
  const { tiles, adults } = shelterOccupants(world, layer, pos);
  return adults < tiles.length * SHELTER_TILE_ADULT_CAP;
}

/** Is there room for one more egg somewhere in `pos`'s shelter cluster right now? */
export function canLayEggAt(world: World, layer: Layer, pos: Vec2): boolean {
  const { tiles, eggs } = shelterOccupants(world, layer, pos);
  return eggs < tiles.length * SHELTER_TILE_EGG_CAP;
}
