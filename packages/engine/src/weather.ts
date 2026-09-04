import type { Layer, Vec2, WeatherCell, WeatherType, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";
import { biomeWeightsAt } from "./worldgen.js";

/**
 * Spatial, moving weather — see DESIGN.md's "Dynamics that move a content
 * herd" section, Phase 3, the last of the three phases (Phase 1 generalized
 * herd migration triggers; Phase 2 was the day/night cycle). Deliberately
 * its own small module, matching daynight.ts's own precedent: a self-
 * contained piece of world state (`World.weatherCells`) plus a handful of
 * cheap query functions that other files' existing systems call into,
 * rather than folding weather logic into flora.ts/needs.ts/fov.ts/
 * combat.ts/support.ts directly. Those files each get one or two new call
 * sites that *compose* a weather-driven multiplier/penalty with whatever
 * local math they already do — see each file's own doc comments for the
 * exact composition — not a parallel weather-specific code path.
 *
 * Surface-layer only, matching worldgen.ts's existing Surface-only scope for
 * biome/elevation/terrain data: weather cells are spawned and biome-weighted
 * using `World.biomeSeeds`, which only a `generateWorld` Surface pass ever
 * populates. Every effect query below takes a `layer` and returns the
 * "no effect" value for anything other than `"surface"` — an underground
 * Diglett colony or a canopy Pidgey flock is never rained on or caught in a
 * storm, which is the right call for a Surface-only weather system rather
 * than a gap to eventually close (see DESIGN.md's own open question about
 * whether the other two layers ever get their own elevation/terrain model
 * at all).
 */

// ---------------------------------------------------------------------------
// Weather-cell lifecycle: spawn, drift, dissipate
// ---------------------------------------------------------------------------

/** DESIGN.md's "a small number (1-3) of active weather systems at once." */
export const MAX_ACTIVE_WEATHER_CELLS = 3;

/**
 * Flat per-tick chance of spawning a new cell, while below
 * `MAX_ACTIVE_WEATHER_CELLS` — the same "constant per-tick roll" style as
 * herdMigration.ts's wanderlust trigger, at a sim-original magnitude picked
 * so a fresh cell appears every ~150 ticks on average when there's room for
 * one (`1/150`), i.e. multiple times over a several-thousand-tick run
 * without weather feeling constantly present. Judge against a real run, not
 * canon, like every other tuning constant in this codebase.
 */
export const WEATHER_SPAWN_CHANCE_PER_TICK = 1 / 150;

/** A new cell's radius (tiles) is drawn uniformly from this range — sim-original guess. */
export const WEATHER_RADIUS_MIN = 8;
export const WEATHER_RADIUS_MAX = 18;

/** A new cell's lifespan (ticks) is drawn uniformly from this range — sim-original guess, long enough to be a real, observable presence, not a single-tick blip. */
export const WEATHER_LIFESPAN_MIN_TICKS = 200;
export const WEATHER_LIFESPAN_MAX_TICKS = 500;

/**
 * Constant per-tick drift speed (tiles/tick) in a random direction chosen
 * once at spawn — "drifts slowly in a random direction over its life" per
 * DESIGN.md, not a random walk (a wandering, direction-changing cell would
 * be much harder to reason about as "one weather system passing through").
 * At this speed a cell crosses roughly its own radius every ~50-120 ticks,
 * a real, visible-over-a-run drift without the cell crossing the whole map
 * before it dissipates.
 */
export const WEATHER_DRIFT_SPEED = 0.15;

const WEATHER_TYPES: readonly WeatherType[] = ["rain", "storm", "drought", "coldSnap"];

/**
 * Biome-influenced spawn-type weighting — DESIGN.md: "Wetland/Grassland skew
 * rain, Badlands skew drought/heat, Highland skews storms/cold." This exact
 * table is sim-original, not canon, same as every other tuning table in this
 * codebase: each entry is a relative weight (not a probability — normalized
 * at roll time against whichever biomes actually blend at the candidate
 * point), 1 is neutral, and the intent is "clearly skewed, not exclusive" —
 * e.g. a Badlands-leaning point is 15x as likely to roll drought as rain
 * (3 vs. 0.2), but rain isn't literally impossible there. Forest (mostly a
 * cover biome for the migration-destination side of this feature, see
 * `pickDestination`'s `preferCover` in herdMigration.ts) gets a mild,
 * unremarkable profile — nothing in DESIGN.md's phrasing calls out a forest
 * skew, so it isn't invented one.
 */
const BIOME_WEATHER_AFFINITY: Record<string, Partial<Record<WeatherType, number>>> = {
  grassland: { rain: 2, storm: 1, drought: 0.5, coldSnap: 0.5 },
  forest: { rain: 1.5, storm: 1, drought: 0.3, coldSnap: 0.7 },
  wetland: { rain: 3, storm: 1.2, drought: 0.2, coldSnap: 0.4 },
  badlands: { rain: 0.2, storm: 0.5, drought: 3, coldSnap: 0.3 },
  highland: { rain: 0.5, storm: 2.5, drought: 0.3, coldSnap: 2.5 },
};
/** Every weather type equally likely — the fallback for a spawn point with no biome weighting at all (a hand-built `createWorld` test world, no `biomeSeeds`) and for any biome name not in the table above (shouldn't happen for a real generated world, but keeps this total). */
const NEUTRAL_AFFINITY: Record<WeatherType, number> = { rain: 1, storm: 1, drought: 1, coldSnap: 1 };

/**
 * Rolls a weather type for a candidate spawn point, weighted by
 * `BIOME_WEATHER_AFFINITY` against the point's real biome blend
 * (`worldgen.ts`'s `biomeWeightsAt`, reading `World.biomeSeeds`) — real use
 * of the biome-generation data, not a second invented biome concept.
 * Combines every biome contributing to this point's blend (not just the
 * single dominant one), each biome's affinity table scaled by how strongly
 * this point blends toward it, so a boundary point between two biomes gets a
 * genuinely blended weather likelihood rather than an all-or-nothing jump.
 * A world with no biome data at all (`biomeWeightsAt` returns `{}`) falls
 * back to `NEUTRAL_AFFINITY` — every type equally likely — rather than
 * crashing or silently favoring one type for hand-built test worlds.
 *
 * Exported (rather than kept private to `spawnWeatherCell`) so the
 * biome-weighting itself is directly, deterministically statistically
 * testable — a fixed-seed rng over many rolls at a known biome point,
 * confirming the documented skew, without needing to reverse-engineer
 * `spawnWeatherCell`'s full rng-call sequence (x, then y, then this, then
 * radius, then lifespan, then drift angle) just to isolate the type roll.
 */
export function pickWeatherType(world: World, x: number, y: number, rng: () => number): WeatherType {
  const biomeWeights = biomeWeightsAt(world.biomeSeeds, x, y);
  const biomeNames = Object.keys(biomeWeights);

  const scores: Record<WeatherType, number> = { rain: 0, storm: 0, drought: 0, coldSnap: 0 };
  if (biomeNames.length === 0) {
    for (const type of WEATHER_TYPES) scores[type] = NEUTRAL_AFFINITY[type];
  } else {
    for (const name of biomeNames) {
      const affinity = BIOME_WEATHER_AFFINITY[name] ?? NEUTRAL_AFFINITY;
      const weight = biomeWeights[name]!;
      for (const type of WEATHER_TYPES) scores[type] += weight * (affinity[type] ?? 1);
    }
  }

  const total = WEATHER_TYPES.reduce((sum, type) => sum + scores[type], 0);
  let roll = rng() * total;
  for (const type of WEATHER_TYPES) {
    roll -= scores[type];
    if (roll <= 0) return type;
  }
  return WEATHER_TYPES[WEATHER_TYPES.length - 1]!; // floating-point fallback, shouldn't normally be reached
}

function spawnWeatherCell(world: World, log: EventLog | undefined, rng: () => number): void {
  const x = rng() * world.width;
  const y = rng() * world.height;
  const type = pickWeatherType(world, x, y, rng);
  const radius = WEATHER_RADIUS_MIN + rng() * (WEATHER_RADIUS_MAX - WEATHER_RADIUS_MIN);
  const lifespanTicks = Math.round(WEATHER_LIFESPAN_MIN_TICKS + rng() * (WEATHER_LIFESPAN_MAX_TICKS - WEATHER_LIFESPAN_MIN_TICKS));
  const angle = rng() * 2 * Math.PI;
  const drift: Vec2 = { x: Math.cos(angle) * WEATHER_DRIFT_SPEED, y: Math.sin(angle) * WEATHER_DRIFT_SPEED };

  const cell: WeatherCell = {
    id: `${type}-${world.tick}-${Math.round(x)}-${Math.round(y)}`,
    type,
    center: { x, y },
    radius,
    startedTick: world.tick,
    lifespanTicks,
    drift,
  };
  world.weatherCells ??= [];
  world.weatherCells.push(cell);
  log?.record({
    kind: "weatherChanged",
    tick: world.tick,
    weatherType: type,
    phase: "began",
    center: { x: Math.round(x), y: Math.round(y) },
    radius: Math.round(radius),
  });
}

/**
 * Once per world tick (called from simulation.ts's `tickWorld`, before
 * `updateHerdMigrations` so this tick's storm-exposure check sees this
 * tick's weather, not last tick's): ages out and removes any cell past its
 * lifespan (logging `weatherChanged`'s `"ended"` phase), drifts every
 * surviving cell by its fixed per-tick `drift` (clamped to stay on the map —
 * a cell drifting to the edge just stops advancing in that direction rather
 * than sailing off into undefined territory), then — if there's room under
 * `MAX_ACTIVE_WEATHER_CELLS` — rolls `WEATHER_SPAWN_CHANCE_PER_TICK` for a
 * fresh one.
 */
export function advanceWeather(world: World, log?: EventLog, rng: () => number = Math.random): void {
  const cells = world.weatherCells ?? [];
  const survivors: WeatherCell[] = [];

  for (const cell of cells) {
    const age = world.tick - cell.startedTick;
    if (age >= cell.lifespanTicks) {
      log?.record({
        kind: "weatherChanged",
        tick: world.tick,
        weatherType: cell.type,
        phase: "ended",
        center: { x: Math.round(cell.center.x), y: Math.round(cell.center.y) },
        radius: Math.round(cell.radius),
      });
      continue;
    }
    cell.center = {
      x: Math.min(world.width - 1, Math.max(0, cell.center.x + cell.drift.x)),
      y: Math.min(world.height - 1, Math.max(0, cell.center.y + cell.drift.y)),
    };
    survivors.push(cell);
  }
  world.weatherCells = survivors;

  if (survivors.length < MAX_ACTIVE_WEATHER_CELLS && rng() < WEATHER_SPAWN_CHANCE_PER_TICK) {
    spawnWeatherCell(world, log, rng);
  }
}

// ---------------------------------------------------------------------------
// Local effect queries — every other file's composition point
// ---------------------------------------------------------------------------

/**
 * The weather cell (if any) covering `pos`, by real Euclidean distance to
 * `center` within `radius` — deliberately circular, unlike the Chebyshev
 * "box" radius resourceIndex.ts/herdMigration.ts use for tile scans: a
 * weather system reads as a round front moving across the map, not a
 * square one. If more than one cell somehow overlaps the same point (only
 * 1-3 cells ever active, so rare, but not impossible near the end of one
 * cell's life and the start of another's), the first match in
 * `World.weatherCells` wins — an arbitrary but documented tie-break, same
 * spirit as herdMigration.ts's `pairKey`/territorial tie-breaks; effects
 * are not designed to stack.
 */
export function activeWeatherAt(world: World, pos: Vec2): WeatherCell | undefined {
  return world.weatherCells?.find((cell) => Math.hypot(cell.center.x - pos.x, cell.center.y - pos.y) <= cell.radius);
}

/** How far (Chebyshev) around a point counts as "sheltered right now" for storm-exposure purposes — small and local, a literal "is there a tree/bush right here," not a biome-scale search. */
const COVER_SCAN_RADIUS = 3;

/**
 * Is there real forest/canopy-style cover (a "tree" or "bush" tile) within
 * `COVER_SCAN_RADIUS` of `pos`? A direct bounded-box terrain scan (same
 * "small local box, not a full-grid scan" style as flora.ts's
 * `isNearSunbeam`), not a biome-blend lookup — DESIGN.md's storm-exposure
 * mechanic is about literal physical shelter (an agent standing under an
 * actual tree), which is a tile-level fact; `pickDestination`'s
 * `preferCover` term (herdMigration.ts), by contrast, deliberately *does*
 * use biome data, since picking a *destination region* is exactly the kind
 * of "which neighborhood is this" question biome blending answers well —
 * two different questions, two different (documented) data sources.
 */
export function hasCoverNearby(world: World, layer: Layer, pos: Vec2): boolean {
  for (let dy = -COVER_SCAN_RADIUS; dy <= COVER_SCAN_RADIUS; dy++) {
    for (let dx = -COVER_SCAN_RADIUS; dx <= COVER_SCAN_RADIUS; dx++) {
      const terrain = tileAt(world, layer, pos.x + dx, pos.y + dy)?.terrain;
      if (terrain === "tree" || terrain === "bush") return true;
    }
  }
  return false;
}

/** Rain eases flora's own decay/spread math (below 1 shrinks the decay rate, above 1 boosts spread chance — see flora.ts's call sites); drought does the reverse. Sim-original magnitudes. */
export const RAIN_FLORA_DECAY_DIVISOR = 1.6;
export const DROUGHT_FLORA_DECAY_DIVISOR = 0.45;

/**
 * Divides flora.ts's decay-rate term (bigger divisor = slower decay = a
 * patch survives longer, the closest this codebase's stock/decay/spread
 * model gets to "regrowth boost" — see flora.ts's `growFlora` doc comment
 * for why there's no direct "add stock back" mechanic to instead scale up)
 * and multiplies its spread-chance term directly (so drought's suppression
 * also means fewer *new* patches taking root, not just faster death of
 * existing ones) — composes with, doesn't replace, `seasonalMultiplier`.
 * `1` (no weather effect) outside rain/drought or off the surface layer.
 */
export function floraDecayDivisor(world: World, layer: Layer, pos: Vec2): number {
  if (layer !== "surface") return 1;
  const cell = activeWeatherAt(world, pos);
  if (cell?.type === "rain") return RAIN_FLORA_DECAY_DIVISOR;
  if (cell?.type === "drought") return DROUGHT_FLORA_DECAY_DIVISOR;
  return 1;
}

/** Rain eases thirst decay, drought raises it — see needs.ts's `decayNeeds` call site. Sim-original magnitudes, same "noticeable but not dominant" order as the off-hours Speed penalty (Phase 2). */
export const RAIN_THIRST_DECAY_MULTIPLIER = 0.6;
export const DROUGHT_THIRST_DECAY_MULTIPLIER = 1.8;

/** `1` outside rain/drought or off the surface layer — composes multiplicatively with needs.ts's flat per-tick thirst decay rate. */
export function thirstDecayMultiplier(world: World, layer: Layer, pos: Vec2): number {
  if (layer !== "surface") return 1;
  const cell = activeWeatherAt(world, pos);
  if (cell?.type === "rain") return RAIN_THIRST_DECAY_MULTIPLIER;
  if (cell?.type === "drought") return DROUGHT_THIRST_DECAY_MULTIPLIER;
  return 1;
}

/**
 * Storm accuracy penalty — DESIGN.md's "meaningfully reduces ... accuracy."
 * This is the sim's first-ever *real* accuracy debuff (every existing
 * accuracy/evasion stage in combat.ts defaults to 0 and nothing currently
 * sets one), so there's no existing "elevation-accuracy-modifier" magnitude
 * to match; 0.6 (a 40% cut to hit chance) is a sim-original guess picked to
 * read as "genuinely dangerous to fight in," on top of `rollAccuracy`'s
 * existing stage-based multiplier rather than replacing it — see
 * combat.ts's `rollAccuracy`.
 */
export const STORM_ACCURACY_MULTIPLIER = 0.6;

/** `1` outside a storm or off the surface layer. */
export function stormAccuracyMultiplier(world: World, layer: Layer, pos: Vec2): number {
  if (layer !== "surface") return 1;
  return activeWeatherAt(world, pos)?.type === "storm" ? STORM_ACCURACY_MULTIPLIER : 1;
}

/**
 * Storm FOV penalty — DESIGN.md: "bigger penalty than night." Deliberately
 * bigger than `fov.ts`'s `NIGHT_FOV_PENALTY` (2.5): 4 tiles at the center of
 * a storm, vs. night's 2.5 at full darkness. A separate, sibling parameter
 * on `computeVisible` (`stormPenalty`, additive with the existing
 * `lightLevel`-driven night penalty) rather than folding storm darkness
 * into the same `lightLevel` number that already drives night: the two are
 * independently controllable (a storm can happen by day, and does compose
 * with night when both occur together — see `computeVisible`'s doc comment)
 * and describe physically different things (time of day vs. local weather),
 * so conflating them into one "how dark is it" scalar the caller would have
 * to reconstruct correctly every time was judged the worse trade. Both
 * terms are subtracted from the same `radius` and the whole thing is
 * floored at 0 by `computeVisible`'s existing `Math.max(0, ...)` — i.e.
 * "additive severity, capped at a floor of zero visibility," the simplest
 * of the composition options DESIGN.md left open.
 */
export const STORM_FOV_PENALTY = 4;

/** `0` outside a storm or off the surface layer — the "no extra penalty" value for `computeVisible`'s `stormPenalty` parameter. */
export function stormFovPenalty(world: World, layer: Layer, pos: Vec2): number {
  if (layer !== "surface") return 0;
  return activeWeatherAt(world, pos)?.type === "storm" ? STORM_FOV_PENALTY : 0;
}

/**
 * Cold-snap Speed penalty — DESIGN.md: "a further Speed penalty ... for
 * species without documented cold tolerance," with an explicit "still open"
 * note that a flat default is fine for a first pass rather than real
 * per-species cold-tolerance data. This sim takes that explicit offer: no
 * new species-data field, a flat penalty for every agent caught in a cold
 * snap regardless of species — the simpler, still-honest reading of an
 * intentionally-deferred design question, not a shortcut around it. Same
 * order of magnitude as `support.ts`'s other terrain-ish Speed penalties
 * (sand 0.75, mud 0.5, off-hours 0.8).
 */
export const COLD_SNAP_SPEED_MULTIPLIER = 0.7;

/** `1` outside a cold snap or off the surface layer — see support.ts's `coldSnapSpeedMultiplier`, the fourth composable term in `simulation.ts`'s `actionSpeedOf` chain. */
export function isInColdSnap(world: World, layer: Layer, pos: Vec2): boolean {
  if (layer !== "surface") return false;
  return activeWeatherAt(world, pos)?.type === "coldSnap";
}
