import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import type { LevelingContext } from "./leveling.js";
import { IMMIGRANT_BASE_LEVEL_FLOOR, type ImmigrationContext, type ImmigrationSpeciesInfo } from "./immigration.js";
import type { RegionDispersalContext } from "./dispersal.js";
import { tickWorld } from "./simulation.js";
import { findPosInBiome, findWalkableNear, generateWorld } from "./worldgen.js";
import { countTerrainNear, findNearestIndexed, foodStockNear } from "./resourceIndex.js";
import { mulberry32 } from "./rng.js";
import { type MacroGrid, type MacroZone, zoneAt, zoneKey, parseZoneKey, zoneNeighbors, biasForZone, estimateZoneResourceIndex, estimateZoneSpecies, speciesFitsZone } from "./macroGrid.js";

/**
 * The overworld system — a macro grid of thousands of zone-cells (see
 * `macroGrid.ts`), most of which are never anything more than the cheap
 * per-zone facts that module generates up front. This file is what makes
 * ONE grid position at a time a real, fully-simulated place — TODO.md's
 * "Overworld: the current map becomes one cell in a larger grid" item,
 * DESIGN.md's "Correction: overworld and zone are two distinct levels, not
 * one" section. It replaces an earlier, narrower version of this same idea
 * (a small named-graph of 3 independently-seeded regions with abstract
 * adjacency edges) with real 2D grid position — a zone's neighbors are
 * whichever cells are orthogonally adjacent in `macroGrid.ts`'s grid, not an
 * abstract graph edge, and a zone's own terrain is BIASED from the macro
 * grid's facts at that position rather than an unrelated independent seed.
 *
 * Applies the sim's existing agent/combat "promotion boundary" concept (see
 * DESIGN.md's "The sim/combat boundary") one level up, at the zone level,
 * generalized from "3 named slots" to "any (row, col) in a big grid":
 * - The **focused** zone (`MacroWorld.focusedKey`) runs a full per-agent
 *   simulation, every agent every tick, across all three layers — exactly
 *   `tickWorld` as it already exists, completely unchanged.
 * - Every other TRACKED zone is **abstracted**: no individual agents, just a
 *   per-species `RegionAggregate` advanced by cheap statistical rules
 *   (`advanceAbstractRegion`), same as before.
 * - The rest of the grid — the overwhelming majority of it, at real scale —
 *   isn't tracked at all: no `Region` object, no aggregate, nothing. This is
 *   the actual point of the "generation passes, not everything simulated"
 *   principle DESIGN.md and TODO.md both call for: `MacroWorld.regions` is a
 *   sparse map, not a dense array, so ticking cost is bounded by how many
 *   zones have ever actually been visited or exchanged migrants, never by
 *   the grid's total size.
 *
 * **A zone's `Region.world` is now itself optional and lazy** — the real
 * structural change from the old named-region version, where every region's
 * full tile grid was generated eagerly at graph-creation time (fine for 3
 * regions, not for thousands of zones). A zone gets a real `World` for the
 * first time only when it's actually promoted (`promoteZone`); before that,
 * a merely-tracked zone (one that only ever received migrants) holds nothing
 * but a `RegionAggregate` — see `estimateInitialAggregates`/
 * `estimateZoneResourceIndex`'s own doc comments for how that aggregate gets
 * seeded with no real tiles to measure from yet.
 *
 * **Terrain is deterministic by grid position; invented individuals are
 * not** — a deliberate, worth-naming split. `promoteZone` generates a
 * zone's `World` from a seed derived purely from `(MacroWorld.worldSeed,
 * row, col)` (`zoneSeed` below), so the same spot always looks the same
 * regardless of when or how many times it happens to be promoted. The
 * INDIVIDUALS invented onto that terrain, by contrast, are drawn from
 * `MacroWorld.rng`'s shared stream (same non-determinism the old
 * `promoteRegion` already had — see this section further down) — a fresh,
 * different roster each time a zone is (re-)promoted, exactly as lossy and
 * exactly as deliberate as it already was in the named-region version.
 *
 * Every other simplification the old named-region version documented still
 * applies unchanged: demoting a zone discards exactly which individuals
 * existed (not just their species); promoting invents a FRESH set of
 * individuals matching the aggregate numbers, not the same individuals back;
 * a background zone's terrain is frozen (no `growFlora`/`advanceWeather`
 * runs against it) once it HAS terrain; in-flight eggs are discarded on
 * demotion. One exception, direct ask ("keep track of herd through zones"):
 * the HERD identity those fresh individuals join is no longer invented from
 * scratch every promotion — see `RegionAggregate.herdId`.
 *
 * **Migration**, generalized to grid neighbors:
 * - Abstract-to-abstract (`maybeEmigrate`): a background zone can move a
 *   population slice into ANY grid-adjacent neighbor (other than the
 *   focused zone), lazily creating a minimal aggregate-only `Region` entry
 *   for that neighbor if it isn't tracked yet — no species roster needed
 *   for this, since the one species migrating already carries its own data
 *   (mirrors `foldAgentIntoAggregate`'s identical "no existing entry, seed
 *   one from this one data point" pattern).
 * - Individual crossing (`applyRegionCrossings`): the focused zone's own
 *   ordinary natal-dispersal trigger (`dispersal.ts`'s
 *   `RegionDispersalContext`) can target any grid-adjacent neighbor; the
 *   disperser walks to the map edge and, once it arrives, gets folded into
 *   that neighbor's aggregate the same lazy way.
 */

/** Per-species abstract state for a zone that isn't currently focused. */
export interface RegionAggregate {
  species: string;
  homeLayer: Layer;
  /** Real-valued (not rounded) so growth/decline compounds smoothly tick over tick — only rounded when reconstructing individuals or reporting. */
  population: number;
  avgHunger: number;
  avgThirst: number;
  avgEnergy: number;
  /** Frozen at whatever the aggregate was last built/measured from — abstracted zones do NOT advance this (no leveling model exists at the aggregate tier). */
  avgLevel: number;
  /**
   * Abundance baseline, 0-1 — starts at whatever `regionResourceBaseline`
   * measured/estimated at the moment this aggregate was created (a real
   * terrain snapshot via `measureResourceIndex` for a just-demoted zone, or
   * `estimateZoneResourceIndex`'s macro-grid-facts guess for a zone that's
   * never had a `World`). Carrying capacity (`advanceAbstractRegion`) is
   * derived from THIS, not from the dynamic `resourceIndex` below —
   * deriving capacity from a value that itself drifts toward "however much
   * headroom is left under capacity" is a feedback loop that chases 1
   * forever (confirmed by this module's own real-run validation, back when
   * it was the named-region version — see DESIGN.md).
   *
   * It DOES slowly drift afterward, though — toward the zone's static,
   * population-independent biome potential (`estimateZoneResourceIndex`,
   * scaled down for a species whose `biomes` don't match this zone's — see
   * `BASELINE_RECOVERY_RATE`/`BIOME_MISMATCH_FACTOR`), which is safe from
   * the feedback loop above since that target never depends on this
   * aggregate's own population or `resourceIndex`. Without this, a zone
   * demoted while its terrain happened to be freshly foraged-down (a normal
   * moment-to-moment dip a focused, ticking zone would recover from on its
   * own) froze that unlucky snapshot forever — since a demoted zone's
   * `World` never ticks again, its measured resourceIndex literally cannot
   * change on its own. A real run surfaced this directly: a zone demoted
   * mid-dip went to total extinction (every species, not just a poor
   * habitat fit) over the next 3000 ticks, because `baseResourceIndex` sat
   * pinned below `DEATH_HEALTH_THRESHOLD` with no way back up. A biome-
   * appropriate species now recovers toward that biome's real long-run
   * potential regardless of what the zone's resources looked like at the
   * exact instant it went abstract; a genuine mismatch (e.g. a wetland
   * species left in a badlands zone) recovers only to a
   * `BIOME_MISMATCH_FACTOR`-scaled ceiling that (at realistic biome
   * potentials) still sits under `DEATH_HEALTH_THRESHOLD` — a real,
   * habitat-driven decline toward local extinction, not thriving-but-
   * diminished. The difference from before: that decline now traces to an
   * actual bad fit, not to whatever the zone's resources happened to
   * measure at the unlucky instant it went abstract.
   */
  baseResourceIndex: number;
  /** Current abundance, bounded to [0, `baseResourceIndex`] — drifts down under grazing pressure and recovers back toward the fixed baseline otherwise. */
  resourceIndex: number;
  /** Population level the last `regionPopulationBoom`/`regionDieOff` event fired at — prevents re-firing every single tick once a threshold is technically crossed. */
  lastEventPopulation: number;
  /**
   * Direct ask: "keep track of herd through zones." The one herd identity
   * this species-slice of the zone traces back to — carried forward through
   * `demoteRegion` (the majority herd among the agents actually folded in),
   * `maybeEmigrate`/`foldAgentIntoAggregate` (a migrating slice keeps the
   * herd it left with), and `promoteZone` (invented individuals rejoin
   * THIS herd rather than a fresh one). Only a single id per species per
   * zone, same granularity limit `RegionAggregate` already has everywhere
   * else — two distinct herds of the same species sharing one abstracted
   * zone still collapse into one number and one herd id, majority-vote
   * broken by whichever the demotion loop happened to see first. A
   * genuinely fresh zone (no real history yet) invents one the same way
   * `promoteZone` always used to, for every species: `${speciesId}-zone-
   * ${zoneKey}`.
   */
  herdId: string;
}

export interface Region {
  /** `macroGrid.ts`'s `zoneKey(row, col)` — how `MacroWorld.regions` is keyed and how event records/`Agent.crossingToRegionId` address a zone. */
  key: string;
  row: number;
  col: number;
  /**
   * Present once this zone's full terrain has been generated at least once
   * — currently focused, or previously promoted-then-demoted. Absent for a
   * zone that's only ever been tracked abstractly (received migrants, or
   * had its population estimated but never actually promoted) — see this
   * file's top doc comment for why lazy generation is the whole point.
   */
  world?: World;
  /**
   * Present while this zone is tracked but NOT the focused one, whether or
   * not `world` exists yet. The invariant this file maintains throughout:
   * exactly one of `aggregates`/"is the focused zone" holds at any time for
   * every zone actually present in `MacroWorld.regions`.
   */
  aggregates?: Record<string, RegionAggregate>;
}

export interface MacroWorld {
  /** The cheap, dense, whole-grid macro facts — every zone, always present (see `macroGrid.ts`). */
  grid: MacroGrid;
  /** Sparse — only zones actually tracked so far. Most of `grid`'s zones have no entry here at all; see this file's top doc comment. */
  regions: Map<string, Region>;
  focusedKey: string;
  /** Graph-level clock, separate from any individual zone's own `world.tick` (which only advances for the currently-focused zone). Every event this module logs is timestamped with this. */
  tick: number;
  /**
   * Graph-level rng — drives everything that doesn't have a natural
   * existing `World.rng` to draw from: invented-individual placement on
   * promotion, aggregate seed-population estimates, emigration rolls. NOT
   * used for zone terrain generation itself, which is seeded purely from
   * `(worldSeed, row, col)` instead — see this file's top doc comment on
   * why those two are deliberately different determinism regimes.
   */
  rng: () => number;
  /** The seed every zone's own terrain is deterministically derived from — see `zoneSeed`. */
  worldSeed: number;
  /** Every promoted zone's full-resolution map uses these same dimensions. */
  zoneWidth: number;
  zoneHeight: number;
  /** Traveling macro-scale weather fronts currently in flight — see `MacroWeatherFront`. */
  weatherFronts: MacroWeatherFront[];
  /** Monotonically increasing id source for `MacroWeatherFront.id`, so event records can name a specific front across its "began"/"ended" pair. */
  nextWeatherFrontId: number;
}

export function findRegion(mw: MacroWorld, key: string): Region | undefined {
  return mw.regions.get(key);
}

export function findRegionAt(mw: MacroWorld, row: number, col: number): Region | undefined {
  return mw.regions.get(zoneKey(row, col));
}

/** Deterministic per-zone terrain seed — see `MacroWorld.worldSeed`'s doc comment for why this is independent of `MacroWorld.rng`'s stream position. Combines row/col via distinct large odd multipliers (the same "derive a distinct sub-stream" idiom `worldgen.ts` uses for its own xor'd sub-seeds) so nearby zones don't produce visibly-correlated seeds. */
function zoneSeed(worldSeed: number, row: number, col: number): number {
  return (worldSeed ^ Math.imul(row + 1, 0x9e3779b1) ^ Math.imul(col + 1, 0x85ebca77)) >>> 0;
}

/**
 * Whole-map surface food+water abundance, 0-1 — reuses `resourceIndex.ts`'s
 * cached per-terrain-kind lookups with a radius covering the entire grid.
 * Only callable once a zone actually has a `World` — see
 * `estimateZoneResourceIndex` (`macroGrid.ts`) for the analytic stand-in
 * used before that.
 */
function measureResourceIndex(world: World): number {
  const center = { x: world.width / 2, y: world.height / 2 };
  const radius = Math.max(world.width, world.height);
  const foodTotal = foodStockNear(world, "surface", center, radius);
  const waterCount = countTerrainNear(world, "surface", center, "water", radius);
  const area = world.width * world.height;
  return Math.min(1, (foodTotal + waterCount) / area);
}

/** A zone's real terrain, if it has one — the analytic macro-grid estimate otherwise. See `RegionAggregate.baseResourceIndex`'s doc comment. */
function regionResourceBaseline(region: Region, grid: MacroGrid): number {
  if (region.world) return measureResourceIndex(region.world);
  return estimateZoneResourceIndex(zoneAt(grid, region.row, region.col)!);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A brand-new herd identity for a species that has no real history to inherit yet — same naming shape `promoteZone` always used, now also the fallback every other `RegionAggregate`-creating site reaches for once there's genuinely nothing to carry forward. */
function freshHerdId(speciesId: string, regionKey: string): string {
  return `${speciesId}-zone-${regionKey}`;
}

/** Ensures a `Region` shell exists in `mw.regions` for (row, col), without seeding any aggregate data — used by migration paths that already have (or are about to build) exactly the one species entry they need, so they don't need the full roster-driven `estimateInitialAggregates` a fresh promotion does. */
function ensureTrackedRegion(mw: MacroWorld, row: number, col: number): Region {
  const key = zoneKey(row, col);
  let region = mw.regions.get(key);
  if (!region) {
    region = { key, row, col };
    mw.regions.set(key, region);
  }
  return region;
}

/**
 * A never-visited zone's estimated starting `RegionAggregate`s, built purely
 * from macro-grid facts and the species roster — no real tiles exist yet to
 * measure anything from. Only ever called from `promoteZone`, for a zone
 * that has neither `aggregates` nor `world` (i.e. genuinely fresh, not one
 * that already has migrated-in population data to preserve). See
 * `macroGrid.ts`'s `estimateZoneSpecies`/`estimateZoneResourceIndex` for
 * what "estimated" actually means here.
 */
function estimateInitialAggregates(mw: MacroWorld, row: number, col: number, ctx: ImmigrationContext): Record<string, RegionAggregate> {
  const zone = zoneAt(mw.grid, row, col)!;
  const resourceIndex = estimateZoneResourceIndex(zone);
  const aggregates: Record<string, RegionAggregate> = {};
  for (const estimate of estimateZoneSpecies(zone, ctx.speciesRoster, mw.rng)) {
    aggregates[estimate.speciesId] = {
      species: estimate.speciesId,
      homeLayer: estimate.homeLayer,
      population: estimate.population,
      avgHunger: 0.5,
      avgThirst: 0.5,
      avgEnergy: 0.5,
      // Same real evolution-aware floor `immigration.ts`'s `rollImmigrantLevel`
      // uses — direct ask: "why does everything spawn at lv5. Especially
      // evolved Pokemon they should be higher distributed." A never-visited
      // zone's estimated population is exactly as real a "spawn" as an
      // immigrant group; a flat `5` here was the same bug under a different
      // name, just for a species this codebase's own macro-grid ever
      // *guesses* already lives somewhere instead of walking in from an edge.
      avgLevel: Math.max(IMMIGRANT_BASE_LEVEL_FLOOR, estimate.minLevel ?? 1),
      baseResourceIndex: resourceIndex,
      resourceIndex,
      lastEventPopulation: estimate.population,
      herdId: freshHerdId(estimate.speciesId, zoneKey(row, col)),
    };
  }
  return aggregates;
}

/**
 * Collapses a zone's real agents into per-species aggregates and empties
 * `world.agents` — the zone-level demotion, unchanged in substance from the
 * named-region version (only living, non-egg agents count; a species with
 * zero living members gets no aggregate entry, a real local extinction).
 * Only ever called on the zone currently leaving focus, which always has a
 * real `world` — the `!` below is safe for that reason, not a lie.
 */
export function demoteRegion(region: Region, mw: MacroWorld, log?: EventLog): void {
  const world = region.world!;
  const resourceIndex = measureResourceIndex(world);
  const totals = new Map<string, { count: number; hunger: number; thirst: number; energy: number; level: number; homeLayer: Layer; herdCounts: Map<string, number> }>();

  for (const agent of world.agents) {
    if (agent.alive === false || agent.isEgg) continue;
    const entry = totals.get(agent.species) ?? { count: 0, hunger: 0, thirst: 0, energy: 0, level: 0, homeLayer: agent.homeLayer, herdCounts: new Map<string, number>() };
    entry.count += 1;
    entry.hunger += agent.needs.hunger;
    entry.thirst += agent.needs.thirst;
    entry.energy += agent.needs.energy;
    entry.level += agent.level ?? 5;
    // Majority vote, not "whichever agent happened to be first in the
    // array" — the zone's per-species aggregate can only carry ONE herd id
    // forward, so when two herds of the same species share a zone, the
    // bigger one wins rather than iteration order deciding arbitrarily.
    if (agent.herdId) entry.herdCounts.set(agent.herdId, (entry.herdCounts.get(agent.herdId) ?? 0) + 1);
    totals.set(agent.species, entry);
  }

  const aggregates: Record<string, RegionAggregate> = {};
  const speciesCounts: Record<string, number> = {};
  for (const [species, entry] of totals) {
    let herdId = freshHerdId(species, region.key);
    let bestCount = 0;
    for (const [candidate, count] of entry.herdCounts) {
      if (count > bestCount) {
        herdId = candidate;
        bestCount = count;
      }
    }
    aggregates[species] = {
      species,
      homeLayer: entry.homeLayer,
      population: entry.count,
      avgHunger: entry.hunger / entry.count,
      avgThirst: entry.thirst / entry.count,
      avgEnergy: entry.energy / entry.count,
      avgLevel: entry.level / entry.count,
      baseResourceIndex: resourceIndex,
      resourceIndex,
      lastEventPopulation: entry.count,
      herdId,
    };
    speciesCounts[species] = entry.count;
  }

  region.aggregates = aggregates;
  world.agents = [];

  log?.record({ kind: "regionDemoted", tick: mw.tick, regionId: region.key, speciesCounts });
}

/**
 * Random spawn point for a promoted individual — unchanged from the
 * named-region version. Surface species land via
 * `findPosInBiome`/`findWalkableNear`, obligate-aquatic species get the
 * nearest real water tile; underground/canopy are a flat, fully walkable
 * grid at every (x,y), so a plain random point needs no walkability search.
 */
function placeInvented(world: World, speciesInfo: ImmigrationContext["speciesRoster"][number], rng: () => number): Vec2 {
  if (speciesInfo.homeLayer !== "surface") {
    return { x: Math.floor(rng() * world.width), y: Math.floor(rng() * world.height) };
  }
  const anchor = findPosInBiome(world, "surface", speciesInfo.biomes, rng);
  if (!speciesInfo.obligateAquatic) return findWalkableNear(world, "surface", anchor.x, anchor.y);
  return findNearestIndexed(world, "surface", anchor, "water") ?? anchor;
}

/** +/- jitter around an aggregate's average so invented individuals aren't all mechanically identical — narrative color, not a load-bearing statistic. */
const PROMOTION_NEEDS_JITTER = 0.1;

function jitteredNeed(value: number, rng: () => number): number {
  return clamp01(value + (rng() * 2 - 1) * PROMOTION_NEEDS_JITTER);
}

/**
 * Promotes the zone at (row, col) — generalizes the named-region version's
 * `promoteRegion` to any grid position, folding in what used to be a
 * separate "first-ever generate this region's map" step:
 * - A genuinely fresh zone (no `aggregates`, no `world`) gets an estimated
 *   starting population (`estimateInitialAggregates`) — nothing to preserve
 *   yet.
 * - A zone with `aggregates` already (received migrants, or was previously
 *   demoted) keeps that real history — only a fresh zone gets estimated.
 * - A zone with no `world` yet gets one generated now, BIASED from the
 *   macro grid's facts at this position (`biasForZone`) and seeded
 *   deterministically from `(worldSeed, row, col)` — see this file's top
 *   doc comment on why terrain and invented-individual randomness are
 *   deliberately different determinism regimes. A zone that already has a
 *   `world` (previously promoted, currently demoted) keeps its real,
 *   already-generated terrain untouched — same "background zone's terrain
 *   is frozen" idea the named-region version already documented.
 * - Either way, invents individuals from whatever `aggregates` now holds
 *   onto `world.agents`, then clears `aggregates` — the promotion itself.
 */
export function promoteZone(mw: MacroWorld, row: number, col: number, ctx: ImmigrationContext, log?: EventLog): Region {
  const region = ensureTrackedRegion(mw, row, col);

  if (!region.aggregates && !region.world) {
    region.aggregates = estimateInitialAggregates(mw, row, col, ctx);
  }
  if (!region.world) {
    const bias = biasForZone(mw.grid, row, col);
    region.world = generateWorld(mw.zoneWidth, mw.zoneHeight, zoneSeed(mw.worldSeed, row, col), bias);
  }

  const aggregates = region.aggregates ?? {};
  const world = region.world;
  const newAgentIds: string[] = [];
  for (const aggregate of Object.values(aggregates)) {
    const count = Math.round(aggregate.population);
    if (count <= 0) continue;
    const speciesInfo = ctx.speciesRoster.find((s) => s.id === aggregate.species);
    if (!speciesInfo) continue;

    // Rejoins the herd this aggregate already belongs to (real history, or
    // `estimateInitialAggregates`'s freshly-invented one for a genuinely
    // never-visited zone) — no longer invented fresh on every promotion, see
    // `RegionAggregate.herdId`.
    const herdId = aggregate.herdId;
    for (let i = 0; i < count; i++) {
      const pos = placeInvented(world, speciesInfo, mw.rng);
      // Small per-individual variance around the aggregate's own tracked
      // average — direct ask: "some randomness in starting rolls would be
      // good." The aggregate average itself stays the real center (a whole
      // population invented at once shouldn't all drift together), just no
      // longer every single individual landing on the exact same level.
      const level = Math.max(1, Math.round(aggregate.avgLevel + (mw.rng() - 0.5) * 4));
      const agent: Agent = ctx.spawnAgent(aggregate.species, `${aggregate.species}-${region.key}-invented-${mw.tick}-${i}`, pos, level, mw.rng);
      agent.needs = {
        hunger: jitteredNeed(aggregate.avgHunger, mw.rng),
        thirst: jitteredNeed(aggregate.avgThirst, mw.rng),
        energy: jitteredNeed(aggregate.avgEnergy, mw.rng),
        mateDrive: 0,
      };
      agent.sex = mw.rng() < 0.5 ? "male" : "female";
      agent.herdId = herdId;
      agent.homePos = { ...agent.pos };
      world.agents.push(agent);
      newAgentIds.push(agent.id);
    }
  }

  region.aggregates = undefined;
  log?.record({ kind: "regionPromoted", tick: mw.tick, regionId: region.key, agentIds: newAgentIds });
  return region;
}

/**
 * How fast a background zone's average need levels relax toward its
 * resource-driven equilibrium each tick — unchanged from the named-region
 * version; see that history in DESIGN.md for the real-run tuning behind
 * every constant in this section.
 */
const NEED_ADAPT_RATE = 0.02;
const DEATH_HEALTH_THRESHOLD = 0.3;
const POP_GROWTH_RATE = 0.01;
const CAPACITY_SCALE = 50;
const MIN_CAPACITY = 3;
const RESOURCE_ADAPT_RATE = 0.0005;
const EVENT_REFIRE_RATIO = 1.5;

/**
 * How much of the gap between an aggregate's `baseResourceIndex` and its
 * (fit-scaled) biome-potential target closes per tick — see
 * `baseResourceIndex`'s own doc comment for why this specific target is
 * safe from the "chases 1 forever" feedback loop `RESOURCE_ADAPT_RATE`
 * above was built to avoid. Slower than `RESOURCE_ADAPT_RATE` on purpose —
 * this represents a demoted zone's terrain-level condition (foraged-down
 * patches regrowing, water refilling) fading back to its biome's real
 * long-run norm, not the moment-to-moment grazing-pressure response
 * `resourceIndex` itself already models.
 */
const BASELINE_RECOVERY_RATE = 0.0002;
/**
 * A species whose `biomes` don't include this zone's still recovers toward
 * SOME baseline (a wetland species stranded in a badlands zone isn't
 * instantly deleted the moment it's demoted there) — just a small fraction
 * of the zone's real potential, low enough to stay under
 * `DEATH_HEALTH_THRESHOLD` even for the RICHEST biome
 * (`estimateZoneResourceIndex`'s wetland estimate maxes out the 0..1 range
 * at `RESOURCE_ESTIMATE_SCALE`'s current calibration) — otherwise a
 * mismatch in an unusually rich zone could still clear the survival bar by
 * sheer abundance, undermining the whole point of this factor. A real
 * habitat mismatch, not an unlucky demotion-instant measurement, is what
 * should actually doom a population.
 */
const BIOME_MISMATCH_FACTOR = 0.25;

/** `roster` is only used to judge species-biome fit for the recovery target above — `undefined` (no `ImmigrationContext` supplied) or a species missing from it just skips that check, recovering toward the zone's full, unscaled potential rather than guessing at a fit it has no data for. */
function biomeRecoveryTarget(zone: MacroZone, speciesId: string, biomePotential: number, roster?: readonly ImmigrationSpeciesInfo[]): number {
  const info = roster?.find((s) => s.id === speciesId);
  const fits = !info || speciesFitsZone(info, zone);
  return fits ? biomePotential : biomePotential * BIOME_MISMATCH_FACTOR;
}

function maybeEmitPopulationEvent(region: Region, aggregate: RegionAggregate, mw: MacroWorld, log?: EventLog): void {
  if (aggregate.lastEventPopulation <= 0) {
    aggregate.lastEventPopulation = Math.max(1, aggregate.population);
    return;
  }
  if (aggregate.population >= aggregate.lastEventPopulation * EVENT_REFIRE_RATIO) {
    log?.record({ kind: "regionPopulationBoom", tick: mw.tick, regionId: region.key, species: aggregate.species, population: Math.round(aggregate.population) });
    aggregate.lastEventPopulation = aggregate.population;
  } else if (aggregate.population <= aggregate.lastEventPopulation / EVENT_REFIRE_RATIO) {
    log?.record({ kind: "regionDieOff", tick: mw.tick, regionId: region.key, species: aggregate.species, population: Math.round(aggregate.population) });
    aggregate.lastEventPopulation = Math.max(aggregate.population, 0.001);
  }
}

/**
 * Direct ask: "zones talking to each other would be great... cross zone
 * migration patterns." Real-run finding (`validateOverworld.ts`): at the
 * original 0.0005, only a handful of emigrations fired across ~8000 ticks
 * even from a healthy, recovering source population — "thousands of zones"
 * stayed a mostly-static backdrop around whichever one or two a population
 * happened to reach. Raised 4x so a recovering zone spreads into its
 * neighbors as a matter of course over a normal-length run, not a rare
 * event; still per-species-per-tick, so a population with several species
 * doesn't multiply its own effective spread rate.
 */
const EMIGRATION_CHANCE_PER_TICK = 0.002;
const EMIGRATION_FRACTION = 0.1;
/** Lowered alongside the rate above — the overworld extinction fix's own recovering populations often sit in the 5-6 range for a long stretch (see overworld.test.ts), which used to miss this bar entirely and never spread until a population had grown well past its initial recovery. */
const EMIGRATION_MIN_POPULATION = 4;

/**
 * The cheap abstract-tier stand-in for a real individual disperser
 * targeting a neighboring zone — generalized to grid adjacency. Only ever
 * moves population between two zones that are BOTH not the focused one (a
 * neighbor that IS focused has real individuals, not an aggregate — folding
 * a population slice straight into it would mean inventing real individuals
 * mid-tick outside the normal promotion path, not attempted, same
 * restriction the named-region version had). The destination doesn't need
 * to be tracked yet — `ensureTrackedRegion` lazily creates a bare shell, and
 * the migrating species' own data seeds its first aggregate entry, exactly
 * like `foldAgentIntoAggregate`'s identical pattern below; no species
 * roster needed for this (unlike a fresh zone's first-ever `promoteZone`).
 */
function maybeEmigrate(mw: MacroWorld, region: Region, log?: EventLog): void {
  const aggregates = region.aggregates;
  if (!aggregates) return;
  const neighborCoords = zoneNeighbors(mw.grid, region.row, region.col).filter((n) => zoneKey(n.row, n.col) !== mw.focusedKey);
  if (neighborCoords.length === 0) return;

  // A front overhead forces migration, per the user's own ask — lower the
  // population bar and raise the roll chance so even a modest population
  // flees a zone under an active cold snap or drought, not just a
  // thriving one spreading into new territory.
  const underWeather = activeMacroWeatherAt(mw, region.row, region.col) !== undefined;
  const minPopulation = underWeather ? MACRO_WEATHER_EMIGRATION_MIN_POPULATION : EMIGRATION_MIN_POPULATION;
  const chance = underWeather ? EMIGRATION_CHANCE_PER_TICK * MACRO_WEATHER_EMIGRATION_MULTIPLIER : EMIGRATION_CHANCE_PER_TICK;

  for (const aggregate of Object.values(aggregates)) {
    if (aggregate.population < minPopulation) continue;
    if (mw.rng() >= chance) continue;

    const target = neighborCoords[Math.floor(mw.rng() * neighborCoords.length)]!;
    const destination = ensureTrackedRegion(mw, target.row, target.col);
    const moving = aggregate.population * EMIGRATION_FRACTION;
    aggregate.population -= moving;

    if (!destination.aggregates) destination.aggregates = {};
    const destAggregates = destination.aggregates;
    const existing = destAggregates[aggregate.species];
    if (existing) {
      // The destination's own herd (already tracked there, possibly from an
      // earlier, different-herd wave) wins — deliberately NOT overwritten
      // with the incoming slice's herdId, same "one herd id per species per
      // zone, majority-ish" limit `demoteRegion` already accepts.
      existing.population += moving;
    } else {
      // A freshly measured/estimated baseline for the destination, not the
      // source's — abundance is a property of the destination zone's own
      // land, not something that travels with the migrating population.
      const destBaseline = regionResourceBaseline(destination, mw.grid);
      destAggregates[aggregate.species] = {
        species: aggregate.species,
        homeLayer: aggregate.homeLayer,
        population: moving,
        avgHunger: aggregate.avgHunger,
        avgThirst: aggregate.avgThirst,
        avgEnergy: aggregate.avgEnergy,
        avgLevel: aggregate.avgLevel,
        baseResourceIndex: destBaseline,
        resourceIndex: Math.min(aggregate.resourceIndex, destBaseline),
        lastEventPopulation: moving,
        // The migrating slice's own herd travels with it into brand-new
        // territory — direct ask: "keep track of herd through zones."
        herdId: aggregate.herdId,
      };
    }

    log?.record({
      kind: "regionEmigrated",
      tick: mw.tick,
      fromRegionId: region.key,
      toRegionId: destination.key,
      species: aggregate.species,
      population: Math.round(moving),
      herdId: aggregate.herdId,
    });
  }
}

/**
 * A traveling macro-scale weather front spanning many zones — direct ask:
 * "more in depth and larger weather patterns... a cold snap slowly moving
 * across the overworld... droughts really killing existing plants and
 * shrinking water dramatically." Deliberately a *different* system from
 * `weather.ts`'s existing `WeatherCell`s, not a scaled-up version of them:
 * those are small, fast-moving, per-tile phenomena scoped to whichever ONE
 * zone is currently focused (rain/storm included), while this is a slow
 * front drifting across the macro grid in zone units, and only ever
 * `coldSnap`/`drought` — the two kinds with a real cross-zone habitat
 * consequence the user actually asked for. The two systems don't interact;
 * a macro front passing over the focused zone doesn't (yet — see TODO.md)
 * reach into that zone's own live `weather.ts` simulation, only into the
 * abstracted background zones' aggregate math (`advanceAbstractRegion`).
 */
export type MacroWeatherKind = "coldSnap" | "drought";

export interface MacroWeatherFront {
  id: number;
  kind: MacroWeatherKind;
  /** Front center, in fractional zone (row, col) — fractional so a slow sub-1-zone/tick drift accumulates smoothly instead of snapping between whole zones. */
  row: number;
  col: number;
  /** Radius in zones — a zone counts as "under" this front when its distance from center is within this. */
  radius: number;
  /** Zones/tick, fixed for the front's whole lifespan — picked once at spawn so a front reads as one coherent system crossing the map, not a jittering blob. */
  driftRow: number;
  driftCol: number;
  ticksRemaining: number;
}

/**
 * Rare on purpose — this is a rare, dramatic, whole-region event, not
 * ambient background weather; a run should see a handful of these over its
 * whole lifetime, not a constant churn of overlapping fronts.
 */
const MACRO_WEATHER_SPAWN_CHANCE_PER_TICK = 0.00006;
const MACRO_WEATHER_MAX_ACTIVE_FRONTS = 3;
const MACRO_WEATHER_RADIUS_MIN = 4;
const MACRO_WEATHER_RADIUS_MAX = 10;
/** Long-lived at macro-grid timescales — long enough for a slow drift to actually cross a meaningful stretch of the grid, and for the resource-decay effect below to visibly bite before the front dissipates. */
const MACRO_WEATHER_LIFESPAN_MIN = 1500;
const MACRO_WEATHER_LIFESPAN_MAX = 4000;
/** Zones/tick — slow enough that "slowly moving across the overworld" reads as true even on a large grid (a 60-zone-wide grid takes ~2000-6000 ticks to fully cross at this speed). */
const MACRO_WEATHER_DRIFT_SPEED = 0.015;
/** Cold snaps skew far more common than droughts — matches the user's own framing (cold snap first, more casually; drought called out as the more severe, rarer extreme). */
const MACRO_WEATHER_DROUGHT_CHANCE = 0.3;

/** The strongest front covering (row, col), if any — a zone under two overlapping fronts is judged by whichever hits it harder (drought over coldSnap), not just whichever was found first. */
export function activeMacroWeatherAt(mw: MacroWorld, row: number, col: number): MacroWeatherFront | undefined {
  let best: MacroWeatherFront | undefined;
  for (const front of mw.weatherFronts) {
    const dist = Math.hypot(row - front.row, col - front.col);
    if (dist > front.radius) continue;
    if (!best || (front.kind === "drought" && best.kind !== "drought")) best = front;
  }
  return best;
}

function spawnMacroWeatherFront(mw: MacroWorld): MacroWeatherFront {
  const kind: MacroWeatherKind = mw.rng() < MACRO_WEATHER_DROUGHT_CHANCE ? "drought" : "coldSnap";
  const angle = mw.rng() * Math.PI * 2;
  return {
    id: mw.nextWeatherFrontId++,
    kind,
    row: mw.rng() * mw.grid.rows,
    col: mw.rng() * mw.grid.cols,
    radius: MACRO_WEATHER_RADIUS_MIN + mw.rng() * (MACRO_WEATHER_RADIUS_MAX - MACRO_WEATHER_RADIUS_MIN),
    driftRow: Math.sin(angle) * MACRO_WEATHER_DRIFT_SPEED,
    driftCol: Math.cos(angle) * MACRO_WEATHER_DRIFT_SPEED,
    ticksRemaining: Math.round(MACRO_WEATHER_LIFESPAN_MIN + mw.rng() * (MACRO_WEATHER_LIFESPAN_MAX - MACRO_WEATHER_LIFESPAN_MIN)),
  };
}

/**
 * Spawns, drifts, and dissipates macro weather fronts — called once per
 * `tickMacroWorld` call, independent of how many zones are actually
 * tracked (a front exists over the whole grid, tracked or not; only
 * `advanceAbstractRegion`'s per-zone check below cares whether anything is
 * there to feel it).
 */
function advanceMacroWeatherFronts(mw: MacroWorld, log?: EventLog): void {
  if (mw.weatherFronts.length < MACRO_WEATHER_MAX_ACTIVE_FRONTS && mw.rng() < MACRO_WEATHER_SPAWN_CHANCE_PER_TICK) {
    const front = spawnMacroWeatherFront(mw);
    mw.weatherFronts.push(front);
    log?.record({ kind: "macroWeatherChanged", tick: mw.tick, weatherType: front.kind, phase: "began", row: Math.round(front.row), col: Math.round(front.col), radius: Math.round(front.radius) });
  }

  const remaining: MacroWeatherFront[] = [];
  for (const front of mw.weatherFronts) {
    front.row += front.driftRow;
    front.col += front.driftCol;
    front.ticksRemaining -= 1;
    if (front.ticksRemaining <= 0) {
      log?.record({ kind: "macroWeatherChanged", tick: mw.tick, weatherType: front.kind, phase: "ended", row: Math.round(front.row), col: Math.round(front.col), radius: Math.round(front.radius) });
    } else {
      remaining.push(front);
    }
  }
  mw.weatherFronts = remaining;
}

/**
 * How hard an active front scales a zone's biome potential down — droughts
 * "really killing existing plants and shrinking water dramatically" hit
 * far harder than a cold snap "reducing plant growth and freezing water."
 */
const MACRO_WEATHER_COLDSNAP_RESOURCE_FACTOR = 0.5;
const MACRO_WEATHER_DROUGHT_RESOURCE_FACTOR = 0.15;
/**
 * Two-directional, unlike `BASELINE_RECOVERY_RATE` — a front actively kills
 * off standing resources while it's overhead, not just caps how far they
 * can recover. Faster than the baseline recovery rate on purpose: this is a
 * dramatic weather event, not gradual terrain healing, and needs to visibly
 * bite within a front's few-thousand-tick lifespan.
 */
const MACRO_WEATHER_RESOURCE_DECAY_RATE = 0.002;
/** A zone under an active front sees migration pressure spike — "forcing migration" was the user's own explicit ask, not an incidental side effect. */
const MACRO_WEATHER_EMIGRATION_MULTIPLIER = 5;
const MACRO_WEATHER_EMIGRATION_MIN_POPULATION = 2;

/**
 * Advances one background zone's aggregates by one tick — O(species count
 * in this zone), never touches individual agents or the zone's own terrain.
 * Called once per tracked non-focused zone per `tickMacroWorld` call.
 */
export function advanceAbstractRegion(mw: MacroWorld, region: Region, log?: EventLog, roster?: readonly ImmigrationSpeciesInfo[]): void {
  const aggregates = region.aggregates;
  if (!aggregates) return;

  const zone = zoneAt(mw.grid, region.row, region.col)!;
  const activeWeather = activeMacroWeatherAt(mw, region.row, region.col);
  let biomePotential = estimateZoneResourceIndex(zone);
  if (activeWeather) {
    biomePotential *= activeWeather.kind === "drought" ? MACRO_WEATHER_DROUGHT_RESOURCE_FACTOR : MACRO_WEATHER_COLDSNAP_RESOURCE_FACTOR;
  }

  for (const aggregate of Object.values(aggregates)) {
    // One-directional on purpose: this represents a demoted zone's terrain
    // healing back toward its biome's real potential over time, not the
    // biome estimate somehow being more authoritative than an actual
    // measured baseline. A zone whose real snapshot already sits AT or
    // ABOVE its target (the common case for a healthy, well-fit
    // population) must not get pulled back down toward the generic
    // estimate — that would undermine real observed abundance instead of
    // just healing an unlucky low one. An active weather front is the one
    // exception: it drifts `baseResourceIndex` toward its (much lower)
    // target in BOTH directions, since a front is meant to actively kill
    // off standing resources, not just cap recovery — normal one-
    // directional healing resumes as soon as the front moves on.
    const recoveryTarget = biomeRecoveryTarget(zone, aggregate.species, biomePotential, roster);
    if (activeWeather) {
      aggregate.baseResourceIndex += (recoveryTarget - aggregate.baseResourceIndex) * MACRO_WEATHER_RESOURCE_DECAY_RATE;
    } else if (aggregate.baseResourceIndex < recoveryTarget) {
      aggregate.baseResourceIndex += (recoveryTarget - aggregate.baseResourceIndex) * BASELINE_RECOVERY_RATE;
    }

    aggregate.avgHunger = clamp01(aggregate.avgHunger + (aggregate.resourceIndex - aggregate.avgHunger) * NEED_ADAPT_RATE);
    aggregate.avgThirst = clamp01(aggregate.avgThirst + (aggregate.resourceIndex - aggregate.avgThirst) * NEED_ADAPT_RATE);

    const health = (aggregate.avgHunger + aggregate.avgThirst) / 2;
    const capacity = Math.max(MIN_CAPACITY, aggregate.baseResourceIndex * CAPACITY_SCALE);
    let growthRate: number;
    if (health >= DEATH_HEALTH_THRESHOLD) {
      const healthFactor = (health - DEATH_HEALTH_THRESHOLD) / (1 - DEATH_HEALTH_THRESHOLD);
      const logisticTerm = 1 - aggregate.population / capacity;
      growthRate = POP_GROWTH_RATE * healthFactor * logisticTerm;
    } else {
      const starveFactor = (DEATH_HEALTH_THRESHOLD - health) / DEATH_HEALTH_THRESHOLD;
      growthRate = -POP_GROWTH_RATE * starveFactor;
    }
    aggregate.population = Math.max(0, aggregate.population * (1 + growthRate));

    const resourceTarget = aggregate.resourceIndex + (1 - aggregate.population / capacity) * RESOURCE_ADAPT_RATE;
    aggregate.resourceIndex = Math.min(aggregate.baseResourceIndex, Math.max(0, resourceTarget));

    maybeEmitPopulationEvent(region, aggregate, mw, log);
  }

  maybeEmigrate(mw, region, log);

  for (const [species, aggregate] of Object.entries(aggregates)) {
    if (aggregate.population < 1) delete aggregates[species];
  }
}

/**
 * Folds exactly one real individual into a (possibly brand-new) aggregate
 * entry — the individual-crossing counterpart to `maybeEmigrate`'s
 * population-slice version. Unchanged in substance from the named-region
 * version, generalized only in where the destination's resource baseline
 * comes from (`regionResourceBaseline`, since the destination might not
 * have real terrain yet).
 */
/** Returns the herd id the fold ended up filed under — the destination's existing herd if one was already there (same "the local aggregate's herd wins" rule `maybeEmigrate` uses), otherwise the crosser's own (or a fresh one, for an agent that somehow has none). */
function foldAgentIntoAggregate(mw: MacroWorld, destination: Region, agent: Agent): string {
  if (!destination.aggregates) destination.aggregates = {};
  const aggregates = destination.aggregates;
  const existing = aggregates[agent.species];
  if (existing) {
    const totalAfter = existing.population + 1;
    existing.avgHunger = (existing.avgHunger * existing.population + agent.needs.hunger) / totalAfter;
    existing.avgThirst = (existing.avgThirst * existing.population + agent.needs.thirst) / totalAfter;
    existing.avgEnergy = (existing.avgEnergy * existing.population + agent.needs.energy) / totalAfter;
    existing.avgLevel = (existing.avgLevel * existing.population + (agent.level ?? existing.avgLevel)) / totalAfter;
    existing.population = totalAfter;
    return existing.herdId;
  }
  const baseline = regionResourceBaseline(destination, mw.grid);
  const herdId = agent.herdId ?? freshHerdId(agent.species, destination.key);
  aggregates[agent.species] = {
    species: agent.species,
    homeLayer: agent.homeLayer,
    population: 1,
    avgHunger: agent.needs.hunger,
    avgThirst: agent.needs.thirst,
    avgEnergy: agent.needs.energy,
    avgLevel: agent.level ?? 5,
    baseResourceIndex: baseline,
    resourceIndex: baseline,
    lastEventPopulation: 1,
    herdId,
  };
  return herdId;
}

/**
 * Removes every agent that finished walking to this map's edge as a
 * zone-crossing disperser from `world.agents` and returns them — unchanged
 * from the named-region version.
 */
function extractRegionCrossers(world: World): Agent[] {
  const crossers: Agent[] = [];
  const remaining: Agent[] = [];
  for (const agent of world.agents) {
    if (agent.crossingToRegionId && !agent.dispersalTarget && agent.alive !== false && !agent.fainted) {
      crossers.push(agent);
    } else {
      remaining.push(agent);
    }
  }
  world.agents = remaining;
  return crossers;
}

/**
 * Completes every zone-crossing dispersal that finished this tick in the
 * focused zone — `Agent.crossingToRegionId` is a plain `zoneKey(row, col)`
 * string here (see `dispersal.ts`'s `RegionDispersalContext` doc comment:
 * that module never interprets the string itself, only carries whichever
 * neighbor id `tickMacroWorld` handed it). The destination doesn't need to
 * be tracked yet — same lazy-creation idea `maybeEmigrate` uses.
 */
function applyRegionCrossings(mw: MacroWorld, region: Region, log?: EventLog): void {
  const crossers = extractRegionCrossers(region.world!);
  for (const agent of crossers) {
    const { row, col } = parseZoneKey(agent.crossingToRegionId!);
    if (!zoneAt(mw.grid, row, col)) {
      // Shouldn't happen — the id only ever comes from this zone's own
      // neighbor list, itself derived from `macroGrid.ts`'s grid adjacency.
      // Put the agent back rather than silently discarding a real
      // individual over a graph inconsistency.
      region.world!.agents.push(agent);
      continue;
    }
    const destination = ensureTrackedRegion(mw, row, col);
    const herdId = foldAgentIntoAggregate(mw, destination, agent);
    log?.record({
      kind: "regionCrossed",
      tick: mw.tick,
      agentId: agent.id,
      species: agent.species,
      fromRegionId: region.key,
      toRegionId: destination.key,
      herdId,
    });
  }
}

/**
 * Advances the whole tracked portion of the macro grid by one tick: the
 * focused zone gets a real, full `tickWorld` pass (with a
 * `RegionDispersalContext` built from its own grid neighbors); every other
 * TRACKED zone gets the cheap `advanceAbstractRegion` pass. Zones not in
 * `mw.regions` at all — the overwhelming majority, at real scale — are
 * untouched, which is the entire point (see this file's top doc comment).
 */
export function tickMacroWorld(mw: MacroWorld, log?: EventLog, rules?: HuntRules, ctx?: LevelingContext, immigration?: ImmigrationContext): void {
  mw.tick += 1;
  advanceMacroWeatherFronts(mw, log);
  for (const region of mw.regions.values()) {
    if (region.key === mw.focusedKey) {
      const neighborIds = zoneNeighbors(mw.grid, region.row, region.col).map((n) => zoneKey(n.row, n.col));
      const regionDispersal: RegionDispersalContext = { neighborRegionIds: neighborIds };
      const world = region.world!;
      tickWorld(world, log, rules, ctx, world.rng, immigration, regionDispersal);
      applyRegionCrossings(mw, region, log);
    } else {
      advanceAbstractRegion(mw, region, log, immigration?.speciesRoster);
    }
  }
}

/**
 * Moves focus to a different grid position — the zone-level promotion/
 * demotion transition, generalized from named ids to (row, col). A no-op if
 * `(row, col)` is already focused, or out of the grid's bounds, or if the
 * currently-focused zone somehow isn't tracked (shouldn't happen — the
 * focused zone is always tracked by construction).
 */
export function setFocusedZone(mw: MacroWorld, row: number, col: number, ctx: ImmigrationContext, log?: EventLog): void {
  const targetKey = zoneKey(row, col);
  if (targetKey === mw.focusedKey) return;
  if (!zoneAt(mw.grid, row, col)) return;
  const current = mw.regions.get(mw.focusedKey);
  if (!current) return;

  demoteRegion(current, mw, log);
  promoteZone(mw, row, col, ctx, log);
  mw.focusedKey = targetKey;
}

/**
 * Builds a macro world from an already-generated `MacroGrid` (see
 * `macroGrid.ts`'s `generateMacroGrid`), immediately promoting exactly one
 * zone — `(focusedRow, focusedCol)` — to a real, fully-simulated place.
 * Every other zone in the grid stays completely untracked until something
 * (a promotion, an emigration, a crossing disperser) actually touches it —
 * see this file's top doc comment for why that's the point, not an
 * oversight. `worldSeed` is threaded to every future zone's own terrain
 * generation (`zoneSeed`), so the whole grid is reproducible for a given
 * (grid, worldSeed, focusedRow, focusedCol) exactly the way a single
 * `createDemoWorld(seed)` run already is.
 */
export function createMacroWorld(
  grid: MacroGrid,
  focusedRow: number,
  focusedCol: number,
  worldSeed: number,
  zoneWidth: number,
  zoneHeight: number,
  ctx: ImmigrationContext,
  log?: EventLog
): MacroWorld {
  const mw: MacroWorld = {
    grid,
    regions: new Map(),
    focusedKey: zoneKey(focusedRow, focusedCol),
    tick: 0,
    rng: mulberry32(worldSeed ^ 0x6f4d5c1b),
    worldSeed,
    zoneWidth,
    zoneHeight,
    weatherFronts: [],
    nextWeatherFrontId: 0,
  };
  promoteZone(mw, focusedRow, focusedCol, ctx, log);
  return mw;
}
