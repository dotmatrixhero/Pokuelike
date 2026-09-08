import { activeWeatherAt } from "./weather.js";
import { setTile, tileAt } from "./world.js";
import { maybeInflictStatus, suppressPassiveHealing } from "./status.js";
import type { EventLog } from "./events.js";
import type { Layer, TerrainKind, Tile, World } from "./types.js";

/**
 * Persistent fire. Direct ask: "for fire based move we gotta add the fire
 * burning down flora mechanic... and it deals dot damage to units standing
 * in fire... gotta have a rendering for it too."
 *
 * Fire is a real `TerrainKind` ("fire"), not a status or an overlay — a
 * burning tile IS the tile, the way "water" and "mud" are. That choice is
 * what makes it visible in every renderer for free, pathable-around by the
 * existing movement code, and persistent across ticks without a parallel
 * "hazards" collection nothing else knows about.
 *
 * Three things happen to a fire tile each tick (`tickFires`): it burns down
 * (`Tile.burnTicksRemaining`), it may spread to adjacent fuel, and it hurts
 * whatever is standing in it. When it burns out the tile is "floor" —
 * scorched ground. That is the whole "burns down flora" mechanic: fire
 * consumes the fuel it spreads into, so a grass fire really does leave a
 * hole in the flora behind it.
 */

/**
 * What fire can spread INTO. Deliberately the vegetation set — a fire
 * doesn't crawl across bare floor, sand or mud, which is what keeps a burn
 * bounded by the terrain rather than eating the whole map. "food" is in
 * here on purpose: a burning crop field is the most legible consequence
 * this mechanic has, and the one that makes a careless fire move a real
 * decision rather than free value.
 */
export const FLAMMABLE_TERRAIN: ReadonlySet<TerrainKind> = new Set<TerrainKind>([
  "flora",
  "bush",
  "tree",
  "food",
  "seedling",
]);

/** How long a freshly lit tile burns before reverting to scorched "floor". */
export const FIRE_BURN_TICKS = 12;

/**
 * Per-tick chance a burning tile spreads into each adjacent flammable tile.
 * Tuned low deliberately: at 0.08 across 4 neighbours a fire expands, but a
 * typical burn dies out on its own well before it can cross a map, because
 * every tile it lights is also counting down its own `FIRE_BURN_TICKS`.
 * See `validateFire.ts` in the runner for the real measured burn sizes.
 */
export const FIRE_SPREAD_CHANCE_PER_TICK = 0.08;

/** Fraction of max HP a fire tile deals per tick to a living agent standing in it. */
export const FIRE_DAMAGE_FRACTION_PER_TICK = 0.04;

/** Chance per tick that standing in fire also inflicts the "burn" status. */
export const FIRE_STATUS_CHANCE_PER_TICK = 0.06;

/** Rain and storms put fires out fast; drought makes them run. Multiplies the per-tick burn-down and the spread roll respectively. */
export const FIRE_RAIN_BURNOUT_MULTIPLIER = 4;
export const FIRE_DROUGHT_SPREAD_MULTIPLIER = 2;

/** Fire is only meaningful on the surface — there is no fuel underground and the canopy grid has its own separate food model. */
const FIRE_LAYER: Layer = "surface";

function isFire(tile: Tile | undefined): boolean {
  return tile?.terrain === "fire";
}

/**
 * Lights a single tile if it has fuel. Returns whether anything caught.
 *
 * Re-igniting an already-burning tile refreshes it back to a full
 * `FIRE_BURN_TICKS` rather than stacking or being a no-op — two Ember hits
 * on the same bush should keep it alight, not double-count it.
 */
export function igniteTile(world: World, layer: Layer, x: number, y: number, log?: EventLog): boolean {
  const tile = tileAt(world, layer, x, y);
  if (!tile) return false;
  if (isFire(tile)) {
    tile.burnTicksRemaining = FIRE_BURN_TICKS;
    return true;
  }
  if (!FLAMMABLE_TERRAIN.has(tile.terrain)) return false;
  const from = tile.terrain;
  setTile(world, layer, x, y, "fire");
  const lit = tileAt(world, layer, x, y);
  if (lit) lit.burnTicksRemaining = FIRE_BURN_TICKS;
  log?.record({ kind: "terrainChanged", tick: world.tick, layer, pos: { x, y }, from, to: "fire", cause: "fire" });
  return true;
}

/**
 * Lights the given tile if it has fuel, otherwise the first adjacent tile
 * that does. Returns whether anything caught.
 *
 * The spill to a neighbour is not generosity, it is what makes the mechanic
 * exist at all: `terrainBurn` fires on a landed hit, and it originally only
 * ever checked the defender's own tile — but fuel is roughly 5% of a real
 * map, so a fight had to happen exactly on a bush for anything to burn.
 * Measured across 6 seeds x 10k ticks with the tile-only rule: ONE ignition.
 * Checking the four neighbours as well is the difference between a shipped
 * mechanic and a shipped mechanic nobody ever sees.
 */
export function igniteNear(world: World, layer: Layer, x: number, y: number, log?: EventLog): boolean {
  if (igniteTile(world, layer, x, y, log)) return true;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    if (igniteTile(world, layer, x + dx, y + dy, log)) return true;
  }
  return false;
}

/**
 * One tick of every burning tile on the surface: spread, burn down, and
 * scorch out. Agent damage is `applyFireDamage` below, kept separate
 * because it walks `world.agents` rather than the tile grid and because
 * damaging agents mid-terrain-pass would mean death handling inside a grid
 * loop.
 *
 * Spread is collected first and applied after the scan so a fire can't
 * chain across an unbounded run of tiles within a single tick (the classic
 * grid-cellular-automaton bug — a tile lit at x=5 this tick must not
 * immediately light x=6 in the same pass).
 */
export function tickFires(world: World, log?: EventLog, rng: () => number = Math.random): void {
  if (!world.tiles?.[FIRE_LAYER]) return;
  const toIgnite: Array<{ x: number; y: number }> = [];
  const toExtinguish: Array<{ x: number; y: number }> = [];

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = tileAt(world, FIRE_LAYER, x, y);
      if (!isFire(tile) || !tile) continue;

      const weather = activeWeatherAt(world, { x, y })?.type;
      const wet = weather === "rain" || weather === "storm";
      const spreadChance = FIRE_SPREAD_CHANCE_PER_TICK * (weather === "drought" ? FIRE_DROUGHT_SPREAD_MULTIPLIER : 1);

      // Rain doesn't stop a fire dead — it burns down several times faster,
      // which reads as "the rain is putting it out" over a few ticks rather
      // than a hard on/off switch, and matches how every other weather
      // effect in this sim is a multiplier rather than a gate.
      const burnDown = wet ? FIRE_RAIN_BURNOUT_MULTIPLIER : 1;
      tile.burnTicksRemaining = (tile.burnTicksRemaining ?? FIRE_BURN_TICKS) - burnDown;

      if (tile.burnTicksRemaining <= 0) {
        toExtinguish.push({ x, y });
        continue;
      }
      if (wet) continue; // a rained-on fire dies where it stands instead of spreading

      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const neighbor = tileAt(world, FIRE_LAYER, nx, ny);
        if (!neighbor || !FLAMMABLE_TERRAIN.has(neighbor.terrain)) continue;
        if (rng() < spreadChance) toIgnite.push({ x: nx, y: ny });
      }
    }
  }

  for (const { x, y } of toExtinguish) {
    setTile(world, FIRE_LAYER, x, y, "floor");
    log?.record({ kind: "terrainChanged", tick: world.tick, layer: FIRE_LAYER, pos: { x, y }, from: "fire", to: "floor", cause: "fire" });
  }
  for (const { x, y } of toIgnite) igniteTile(world, FIRE_LAYER, x, y, log);
}

/**
 * Damage-over-time for every living agent standing in fire. Runs after
 * `tickFires` so a tile that burned out this tick no longer hurts anyone.
 *
 * A fire death gets its own `burned` event rather than being squeezed into
 * `killed`, whose shape is predator/prey — a fire is not a predator, and
 * everything downstream that reads `killed` (hunt stats, rapport, feeding)
 * would be wrong to count it. Same reasoning `starved` already exists
 * separately for.
 */
export function applyFireDamage(world: World, log?: EventLog, rng: () => number = Math.random): void {
  for (const agent of world.agents) {
    if (agent.alive === false || agent.layer !== FIRE_LAYER) continue;
    if (agent.hp === undefined || agent.maxHp === undefined) continue;
    if (!isFire(tileAt(world, agent.layer, agent.pos.x, agent.pos.y))) continue;

    // A fireproof creature stands in its own flames — see the passive's own
    // doc comment for why this covers the hazard tile only, not the burn
    // status or Fire-type damage.
    const fireproof = Math.min(1, agent.passives?.fireproof ?? 0);
    if (fireproof >= 1) continue;
    agent.hp = Math.max(0, agent.hp - agent.maxHp * FIRE_DAMAGE_FRACTION_PER_TICK * (1 - fireproof));
    maybeInflictStatus(
      agent,
      agent.id,
      { statusKind: "burn", statusChance: FIRE_STATUS_CHANCE_PER_TICK },
      world,
      log,
      rng
    );
    // Fire counts as damage for passive-healing purposes, same as a hit —
    // otherwise a high-regen build simply ignores the hazard.
    suppressPassiveHealing(agent);

    if (agent.hp <= 0) {
      agent.alive = false;
      agent.diedAtTick = world.tick;
      log?.record({ kind: "burned", tick: world.tick, agentId: agent.id, species: agent.species, pos: agent.pos, herdId: agent.herdId });
    }
  }
}
