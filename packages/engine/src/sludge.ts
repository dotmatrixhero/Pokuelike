/**
 * Fouled ground — the "sludge" terrain and what it does.
 *
 * Direct instruction: *"Sludge should create a poisonous tile that kills
 * plants and turns water into mud."*
 *
 * Modelled deliberately on fire.ts, which already solved the same problems
 * (a hazard terrain with a countdown, a per-tick effect on whoever stands in
 * it, and a revert target), and NOT on it in one respect: sludge does not
 * spread. Fire runs; sludge sits where it was thrown. A spreading poison
 * would turn one landed hit into a map-scale event, and this is a move
 * effect, not a weather system.
 *
 * THE TILE IS TEMPORARY; WHAT IT DESTROYED IS NOT. The fouled tile drains
 * back to bare "floor" after `SLUDGE_LINGER_TICKS`, but a plant it landed on
 * is dead and a pond it landed in is mud, permanently. That split is the
 * whole design: the hazard is a passing thing you can wait out, the damage
 * to the land is the part you have to live with. It is the same "visible on
 * the map, not hidden in a meter" bar the drought mechanic was held to.
 */
import type { EventLog } from "./events.js";
import type { Layer, Tile, TerrainKind, World } from "./types.js";
import { setTile, tileAt } from "./world.js";
import { maybeInflictStatus } from "./status.js";

/**
 * Plant terrain a sludge hit KILLS outright. Same membership as fire.ts's
 * `FLAMMABLE_TERRAIN` and for the same underlying reason — these are the
 * tiles that carry living plant matter — but deliberately its own constant:
 * the two lists agreeing today is a coincidence of content, not a rule, and
 * importing fire's would couple a poison mechanic to a combustion one.
 *
 * "tree" is deliberately ABSENT where fire has it. A thrown handful of filth
 * does not kill a standing tree, and letting it would hand one move the
 * power to clear canopy, which is a much larger world change than this was
 * asked to be.
 */
export const SLUDGE_KILLS_PLANTS: ReadonlySet<TerrainKind> = new Set<TerrainKind>([
  "flora",
  "bush",
  "food",
  "seedling",
]);

/** How long fouled ground stays fouled before draining back to "floor". Longer than a fire burns (`FIRE_BURN_TICKS` = 12) — filth outlasts flame. */
export const SLUDGE_LINGER_TICKS = 40;

/** Chance per tick that standing in sludge inflicts "poison". No direct HP damage: the poison status is the damage, and stacking a second DOT on top would double-count it. */
export const SLUDGE_POISON_CHANCE_PER_TICK = 0.08;

/** Like fire, sludge is a surface mechanic — the flora and water it ruins only exist there. */
const SLUDGE_LAYER: Layer = "surface";

export function isSludge(tile: Tile | undefined): boolean {
  return tile?.terrain === "sludge";
}

/**
 * Fouls one tile, resolving what that means from what was there.
 *
 * Three outcomes, all of them permanent except the fouling itself:
 * - **Water becomes mud.** Named explicitly in the instruction. The tile is
 *   NOT left as sludge — the pond is simply ruined, which is the lasting
 *   consequence, and mud already carries a real 0.5x movement penalty
 *   (`TERRAIN_SPEED_MULTIPLIER`, support.ts) so the ruin is felt.
 * - **A plant is killed**, and the tile is fouled on top of it.
 * - **Bare ground is fouled.**
 *
 * Anything else (wall, tree, boulder, shelter, an existing fire) is left
 * alone and this returns false. Re-fouling an already-fouled tile refreshes
 * its countdown rather than stacking, same as `igniteTile` does.
 */
export function foulTile(world: World, layer: Layer, x: number, y: number, log?: EventLog): boolean {
  const tile = tileAt(world, layer, x, y);
  if (!tile) return false;

  if (tile.terrain === "water") {
    // A ruined pond, not a fouled one: no countdown, nothing to drain away.
    setTile(world, layer, x, y, "mud");
    log?.record({ kind: "terrainChanged", tick: world.tick, layer, pos: { x, y }, from: "water", to: "mud", cause: "sludge" });
    return true;
  }

  if (isSludge(tile)) {
    tile.sludgeTicksRemaining = SLUDGE_LINGER_TICKS;
    return true;
  }

  const killedPlant = SLUDGE_KILLS_PLANTS.has(tile.terrain);
  if (!killedPlant && tile.terrain !== "floor" && tile.terrain !== "sand" && tile.terrain !== "mud") return false;

  const from = tile.terrain;
  setTile(world, layer, x, y, "sludge");
  const fouled = tileAt(world, layer, x, y);
  if (fouled) fouled.sludgeTicksRemaining = SLUDGE_LINGER_TICKS;
  log?.record({ kind: "terrainChanged", tick: world.tick, layer, pos: { x, y }, from, to: "sludge", cause: killedPlant ? "sludgeKilledPlant" : "sludge" });
  return true;
}

/** Counts every fouled tile down, draining the expired ones back to bare "floor". */
export function tickSludge(world: World): void {
  const tiles = world.tiles[SLUDGE_LAYER];
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (!isSludge(tile)) continue;
    const remaining = (tile.sludgeTicksRemaining ?? 1) - 1;
    if (remaining > 0) {
      tile.sludgeTicksRemaining = remaining;
      continue;
    }
    const x = i % world.width;
    const y = Math.floor(i / world.width);
    setTile(world, SLUDGE_LAYER, x, y, "floor");
    const drained = tileAt(world, SLUDGE_LAYER, x, y);
    if (drained) drained.sludgeTicksRemaining = undefined;
  }
}

/**
 * Poisons living agents standing in sludge. Poison-types are already immune
 * via `maybeInflictStatus`'s own `isImmuneToStatus` check, so the thing that
 * throws sludge can stand in its own mess — which is the point of throwing it.
 */
export function applySludgeEffects(world: World, log?: EventLog, rng: () => number = Math.random): void {
  for (const agent of world.agents) {
    if (agent.alive === false || agent.fainted || agent.layer !== SLUDGE_LAYER) continue;
    if (!isSludge(tileAt(world, SLUDGE_LAYER, agent.pos.x, agent.pos.y))) continue;
    maybeInflictStatus(agent, agent.id, { statusKind: "poison", statusChance: SLUDGE_POISON_CHANCE_PER_TICK }, world, log, rng);
  }
}
