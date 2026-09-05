import type { Layer, TerrainKind, Vec2, WeatherCell, WeatherType, World } from "./types.js";
import type { EventLog } from "./events.js";
import { setElevation, setTile, tileAt } from "./world.js";
import { biomeWeightsAt } from "./worldgen.js";
import { LARGE_WATER_BODY_MIN_SIZE, isLargeWaterBody, waterBodySizeAt } from "./waterBody.js";

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
 * Is there real forest/canopy-style cover (a "tree", "bush", or player-built
 * "shelter" tile) within `COVER_SCAN_RADIUS` of `pos`? A direct bounded-box
 * terrain scan (same "small local box, not a full-grid scan" style as
 * flora.ts's `isNearSunbeam`), not a biome-blend lookup — DESIGN.md's
 * storm-exposure mechanic is about literal physical shelter (an agent
 * standing under an actual tree), which is a tile-level fact; `pickDestination`'s
 * `preferCover` term (herdMigration.ts), by contrast, deliberately *does*
 * use biome data, since picking a *destination region* is exactly the kind
 * of "which neighborhood is this" question biome blending answers well —
 * two different questions, two different (documented) data sources.
 *
 * "shelter" (shelter.ts/DESIGN.md's "Shelter-building" section) counts here
 * for exactly the same reason "tree"/"bush" do: a real, physical structure
 * an agent can stand under — this is the entire real mechanism behind
 * shelter's "reduces storm-exposure accumulation" payoff, reused verbatim
 * rather than a second, parallel storm-exposure check.
 */
export function hasCoverNearby(world: World, layer: Layer, pos: Vec2): boolean {
  for (let dy = -COVER_SCAN_RADIUS; dy <= COVER_SCAN_RADIUS; dy++) {
    for (let dx = -COVER_SCAN_RADIUS; dx <= COVER_SCAN_RADIUS; dx++) {
      const terrain = tileAt(world, layer, pos.x + dx, pos.y + dy)?.terrain;
      if (terrain === "tree" || terrain === "bush" || terrain === "shelter") return true;
    }
  }
  return false;
}

/**
 * Rain eases flora's own decay/spread math (below 1 shrinks the decay rate,
 * above 1 boosts spread chance — see flora.ts's call sites); drought does
 * the reverse. Was 1.6/0.45 — direct ask ("a little stronger about killing
 * off flora and reducing water/increasing it... more dynamic") widened both:
 * drought now roughly *quadruples* decay (was *2.22) and roughly *halves*
 * spread chance (was *0.45), enough to visibly thin a food patch over a
 * sustained (hundreds-of-ticks) dry spell rather than a marginal wobble;
 * rain now roughly *triples* the decay divisor (was *1.6, i.e. survival
 * time up ~3x instead of ~1.6x) and boosts spread chance to match. See
 * DESIGN.md's "Built, real-run findings" for the actual before/after tile
 * counts these produced.
 */
export const RAIN_FLORA_DECAY_DIVISOR = 3;
export const DROUGHT_FLORA_DECAY_DIVISOR = 0.25;

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

// ---------------------------------------------------------------------------
// Water-tile lifecycle: real terrain mutation under sustained drought/rain
// ---------------------------------------------------------------------------

/**
 * Water was previously static, undepletable terrain — weather never touched
 * it. Direct ask ("reducing water/increasing it... more dynamic") wanted
 * real terrain mutation, not another rate multiplier, and explicitly pointed
 * at flora.ts's own spread idiom as the pattern to reuse rather than
 * inventing a new one: a flat per-tile-per-tick chance, rolled only for
 * tiles that currently qualify, same shape as `growFlora`'s spread roll and
 * `maybeDropSeed`'s germination roll. So: a "water" tile sitting inside an
 * active drought cell has a small per-tick chance to dry out to "mud" (the
 * driest already-existing walkable terrain — reads as a cracked lakebed,
 * not an instant flood/drought); a "floor"/"mud"/"sand" tile adjacent to an
 * existing "water" tile, sitting inside an active rain cell, has a small
 * per-tick chance to become water itself (naturally-wet low ground filling
 * in, spreading from existing water exactly the way flora spreads from an
 * existing patch — `RAIN_CONVERTIBLE_TERRAIN`'s only non-"floor" additions
 * are "mud"/"sand", both already-damp terrain kinds, not e.g. "food"/"tree").
 *
 * Magnitudes are deliberately conservative first-pass guesses, tuned against
 * real headless runs rather than picked blind: at
 * `DROUGHT_WATER_DRY_CHANCE_PER_TICK`, a water tile continuously inside a
 * drought cell for a full `WEATHER_LIFESPAN_MAX_TICKS` (500 ticks) has
 * roughly a 1-in-3 chance of drying (1 - (1 - 1/500)^500 ~= 0.63 at full,
 * uninterrupted exposure — in practice much lower, since a drifting cell
 * rarely sits on one tile that long) — real, visible thinning over one
 * sustained drought, not a wipeout. `RAIN_WATER_FORM_CHANCE_PER_TICK` is set
 * noticeably lower per-roll than the drought rate, not just "slightly" —
 * this asymmetry is deliberate and NOT the same as flora's rain/drought
 * asymmetry above: forming water has a structural growth advantage drying
 * doesn't (each newly-formed water tile immediately becomes a new adjacency
 * source for its own neighbors next tick, the same self-reinforcing
 * perimeter-growth shape flora's spread has — but flora's spread is capped
 * by patches eventually dying of natural decay, while water tiles never
 * decay on their own). A real 10,000-tick headless run at a naive
 * "similar magnitude" pair of rates (1/500 dry, 1/600 form) showed exactly
 * this: water tiles crept from 472 up to 554 (+17%) over the run because
 * rain's compounding perimeter growth quietly out-paced drought's shrinking-
 * pool decline — a slow one-way ratchet in the making, the same bug class
 * flora.ts's own doc comments already warn about (see `FLORA_LIFESPAN_TICKS`).
 * The current, much lower `RAIN_WATER_FORM_CHANCE_PER_TICK` was chosen to
 * counteract exactly that structural advantage. See DESIGN.md's "Built,
 * real-run findings" for the real before/after tile counts multiple runs
 * produced, and TODO.md for the open question this doesn't fully resolve
 * (long-run drift still tracks whichever weather type a given seed happens
 * to roll more of, rather than converging to a stable equilibrium).
 */
// ---------------------------------------------------------------------------
// Water-cycle tuning constants — grouped here on purpose (direct ask:
// "parametrize things like food durability and regrowth stuff... so I can
// tune it"), same rationale as flora.ts's own tuning-constants section: one
// place to find and hand-edit every water-durability/formation rate, each
// with a doc comment carrying what a real headless run actually showed.
// ---------------------------------------------------------------------------

/**
 * Per-tick drying chance for a water tile belonging to a *small* body (below
 * `LARGE_WATER_BODY_MIN_SIZE` tiles — waterBody.ts) sitting inside an active
 * drought cell. Was a single flat `1/500` for every water tile regardless of
 * size; direct ask ("Make certain water sources dry out and refill more
 * during droughts and rain... Bigger 'lake' or 'spring' water bodies might
 * shrink but never run out") wants a real size-aware split, and specifically
 * wants MORE visible terrain transformation than before, not less. Raised
 * to `1/150` for small bodies specifically — over a full drought-cell
 * lifespan (500 ticks) that's `1 - (1 - 1/150)^500 ≈ 0.96`, i.e. a small,
 * isolated puddle sitting continuously inside one sustained drought is very
 * likely to fully dry out, exactly the "dry out and refill" dynamism asked
 * for. Large bodies get their own, much lower rate — see
 * `LARGE_WATER_BODY_DRY_CHANCE_PER_TICK` below — so this number is no
 * longer a single global compromise between "small puddles should be able
 * to vanish" and "lakes shouldn't." See DESIGN.md's "Built, real-run
 * findings" for this feature for the actual before/after water-tile counts
 * and dried/formed event counts a real multi-thousand-tick run produced.
 */
export const DROUGHT_WATER_DRY_CHANCE_PER_TICK = 1 / 150;
/**
 * Per-tick drying chance for a water tile belonging to a *large* body (a
 * "lake"/"spring", `LARGE_WATER_BODY_MIN_SIZE`+ tiles) under drought — much
 * lower than the small-body rate above by direct request ("Bigger 'lake' or
 * 'spring' water bodies might shrink but never run out"). Over a full
 * 500-tick drought lifespan that's `1 - (1 - 1/3000)^500 ≈ 0.15` per tile —
 * real, visible edge-shrinkage of a big lake over a sustained drought
 * without threatening to empty it, especially combined with
 * `LARGE_WATER_BODY_FLOOR_SIZE`'s hard floor below.
 */
export const LARGE_WATER_BODY_DRY_CHANCE_PER_TICK = 1 / 3000;
/**
 * Once a large water body's *current* size (recomputed once per
 * `advanceWaterCycle` call, before any of that tick's mutations — see the
 * function body) has shrunk down to this many tiles, it stops drying
 * further for the rest of that tick, regardless of roll outcome — the
 * literal "never run out" half of the direct ask.
 *
 * Deliberately set equal to `LARGE_WATER_BODY_MIN_SIZE` (12), not lower.
 * An earlier version of this feature used a lower floor (6) to give a
 * shrinking lake more visible room to recede before stopping — but that
 * left a real, confirmed gap: a body between the floor and
 * `LARGE_WATER_BODY_MIN_SIZE` no longer reads as "large" (`isLargeWaterBody`
 * is a simple current-size check, with no memory of a body's own history),
 * so it silently fell back to the much faster *small*-body drying rate with
 * no floor protection at all — a synthetic worst-case unit test (a lake
 * pinned under one permanently-active drought cell, no dissipation) showed
 * exactly this: a 25-tile lake reached 0 tiles by tick ~2000 instead of
 * stopping at the intended floor. Setting the floor equal to the large-body
 * threshold itself closes that gap by construction: `isLargeWaterBody`
 * reads `>= LARGE_WATER_BODY_MIN_SIZE`, so a body can only ever be skipped
 * by this floor check (`bodySize <= floor`) at exactly `bodySize ===
 * LARGE_WATER_BODY_MIN_SIZE` — the instant before it *would* cross out of
 * "large" territory, never after. A body that started well above the
 * threshold still gets real, substantial, visible shrinkage room (down to
 * 12 tiles, however large it started); a genuinely small body was never
 * "large" to begin with and is unaffected by this floor at all — same
 * "small bodies can fully dry out" behavior as before this feature. See
 * DESIGN.md's "Built, real-run findings" for this feature for the
 * before/after numbers from both the original (gapped) version and this fix.
 */
export const LARGE_WATER_BODY_FLOOR_SIZE = LARGE_WATER_BODY_MIN_SIZE;
/**
 * Per-tick chance an eligible tile (`RAIN_CONVERTIBLE_TERRAIN`, adjacent to
 * existing water) becomes water under an active rain cell. Was `1/1500` —
 * deliberately much lower per-roll than the (then-single) drought-dry rate,
 * to counteract forming water's own structural growth advantage (each new
 * water tile immediately becomes a new adjacency source for its own
 * neighbors next tick — see this section's older doc comment, preserved
 * below, for the full "one-way ratchet" story a real 10,000-tick run
 * surfaced at a naively-matched 1/500-vs-1/600 pair of rates).
 *
 * Tried raising this to `1/1000` first — direct ask for MORE dynamism
 * ("increasing it... more dynamic") — on the theory that this pass's tiered
 * drying rates change the runaway-growth risk calculus that motivated the
 * original steep discount (newly rain-formed tiles are small, isolated
 * additions, themselves subject to the much-stronger small-body drought-dry
 * rate above). **A real terrain-only 10,000-tick run (no agents — isolates
 * the water cycle itself from the unrelated population-performance ceiling
 * noted in TODO.md) showed that theory was incomplete**: net water tiles
 * grew from 494 to 593 (seed 42, +20%), 495 to 728 (seed 7, +47%), and 472
 * to 598 (seed 20260903, +27%) — worse runaway growth than the original
 * 1/500-vs-1/600 pair's +17% finding, not better. Root cause, found by
 * checking rather than assuming: `LARGE_WATER_BODY_FLOOR_SIZE`'s protection
 * (this feature's main point) means the large majority of a real generated
 * map's water tiles — a real check on seed 42's own water-body distribution
 * found roughly 89% of its water tiles belong to bodies at/above
 * `LARGE_WATER_BODY_MIN_SIZE` — now dry at the *much* slower
 * `LARGE_WATER_BODY_DRY_CHANCE_PER_TICK`, not the old flat rate; raising
 * the forming rate on top of that newly-stronger protection compounded
 * rather than balanced.
 *
 * Settled on `1/1800` instead (lower than even the original `1/1500`) once
 * that root cause was in hand: the same terrain-only 10,000-tick run at
 * this rate landed at 503/531/510 tiles respectively (-2% to +8%) — real
 * near-equilibrium, not a wipeout and not a runaway, closing most of the
 * gap the original version's own TODO.md entry flagged as unresolved (see
 * that entry — still not a mathematically guaranteed long-run
 * equilibrium, just a real, checked, much-improved one). This still reads
 * as "more dynamic" than the pre-this-pass system overall: small puddles
 * now form and fully evaporate on a real, visible cycle (the small-body
 * drying-rate increase above), it's specifically large-lake permanence that
 * got the protection the direct ask wanted, not a wholesale rate hike on
 * top of it. See DESIGN.md's "Built, real-run findings" for this feature
 * for the full before/after numbers, including both attempts.
 */
export const RAIN_WATER_FORM_CHANCE_PER_TICK = 1 / 1800;

/** What a dried-out water tile becomes — see this section's doc comment. */
const DRIED_WATER_TERRAIN: TerrainKind = "mud";
/** Terrain kinds eligible to become water under sustained rain, when adjacent to existing water — deliberately narrow (no "food"/"tree"/"bush"/etc). */
const RAIN_CONVERTIBLE_TERRAIN: ReadonlySet<TerrainKind> = new Set<TerrainKind>(["floor", "mud", "sand"]);

/** Same 8-neighbor adjacency flora.ts's `trySpread`/`NEIGHBOR_OFFSETS` uses — kept as its own local copy rather than a shared export, matching this codebase's existing per-file duplication of that one small constant. */
const WATER_NEIGHBOR_OFFSETS: Vec2[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

function isAdjacentToWater(world: World, pos: Vec2): boolean {
  for (const offset of WATER_NEIGHBOR_OFFSETS) {
    if (tileAt(world, "surface", pos.x + offset.x, pos.y + offset.y)?.terrain === "water") return true;
  }
  return false;
}

/**
 * Once per world tick (called from simulation.ts's `tickWorld`, alongside
 * `growFlora` — same "world-level system, one full-grid pass" shape). Every
 * surface tile currently under an active weather cell is checked once:
 * "water" tiles under drought roll to dry to `DRIED_WATER_TERRAIN`;
 * `RAIN_CONVERTIBLE_TERRAIN` tiles under rain, adjacent to existing water,
 * roll to become water. Both branches go through `setTile` (not a hand-
 * rolled field assignment) so walkable/opaque/stock/flavor/concealment and
 * `invalidateResourceIndex` (resourceIndex.ts indexes "water" tiles for
 * thirst-seeking) all stay consistent with every other terrain-change call
 * site in this codebase. Surface-layer only, matching every other weather
 * effect in this file.
 */
export function advanceWaterCycle(world: World, log?: EventLog, rng: () => number = Math.random): void {
  const tiles = world.tiles.surface;

  // A snapshot of every water tile's connected-body size, taken once up
  // front before this tick's mutations start — see waterBody.ts's own doc
  // comment for why this is a single-pass, checked-once-per-tick read
  // (mirrors this codebase's established "commits/checks once, doesn't
  // re-derive mid-loop" convention, e.g. needs.ts's `needsAreUrgent`): every
  // water tile still standing at the start of this tick is scored against
  // the map's water-body layout as it existed at the *start* of the tick,
  // not against a partially-dried-this-tick intermediate state, which would
  // make results depend on iteration order over the tile array.
  const bodySizeByIndex = new Int32Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i]!.terrain !== "water") continue;
    const pos = { x: i % world.width, y: Math.floor(i / world.width) };
    bodySizeByIndex[i] = waterBodySizeAt(world, pos);
  }

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]!;
    const pos = { x: i % world.width, y: Math.floor(i / world.width) };
    const cell = activeWeatherAt(world, pos);
    if (!cell) continue;

    if (tile.terrain === "water" && cell.type === "drought") {
      const bodySize = bodySizeByIndex[i]!;
      const large = isLargeWaterBody(bodySize);
      // The "never run out" hard floor — a large body already at or below
      // this size doesn't dry any further this tick, regardless of roll.
      if (large && bodySize <= LARGE_WATER_BODY_FLOOR_SIZE) continue;
      const dryChance = large ? LARGE_WATER_BODY_DRY_CHANCE_PER_TICK : DROUGHT_WATER_DRY_CHANCE_PER_TICK;
      if (rng() < dryChance) {
        setTile(world, "surface", pos.x, pos.y, DRIED_WATER_TERRAIN);
        log?.record({ kind: "terrainChanged", tick: world.tick, layer: "surface", pos, from: "water", to: DRIED_WATER_TERRAIN, cause: "drought" });
      }
    } else if (cell.type === "rain" && RAIN_CONVERTIBLE_TERRAIN.has(tile.terrain) && isAdjacentToWater(world, pos)) {
      if (rng() < RAIN_WATER_FORM_CHANCE_PER_TICK) {
        const from = tile.terrain;
        setTile(world, "surface", pos.x, pos.y, "water");
        setElevation(world, "surface", pos.x, pos.y, 0); // matches worldgen.ts's "a lakebed is flat" convention for freshly-formed water
        log?.record({ kind: "terrainChanged", tick: world.tick, layer: "surface", pos, from, to: "water", cause: "rain" });
      }
    }
  }
}
