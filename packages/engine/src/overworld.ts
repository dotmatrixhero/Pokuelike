import type { Agent, HuntRules, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import type { LevelingContext } from "./leveling.js";
import type { ImmigrationContext, ImmigrationSpeciesInfo } from "./immigration.js";
import { tickWorld } from "./simulation.js";
import { findPosInBiome, findWalkableNear } from "./worldgen.js";
import { countTerrainNear, findNearestIndexed, foodStockNear } from "./resourceIndex.js";

/**
 * The overworld/region-graph system — TODO.md's "Overworld: the current map
 * becomes one region in a larger graph" item, DESIGN.md's "World scale:
 * layers, elevation, and regions" section. Applies the sim's existing
 * agent/combat "promotion boundary" concept (see DESIGN.md's "The sim/combat
 * boundary") one level up, at the region level:
 *
 * - The **focused** region (`Overworld.focusedRegionId`) runs a full
 *   per-agent simulation, every agent every tick, across all three layers —
 *   exactly `tickWorld` as it already exists, completely unchanged.
 * - Every OTHER region is **abstracted**: no individual agents at all, just
 *   a per-species `RegionAggregate` (population, average needs, a resource
 *   abundance index) advanced by cheap statistical rules
 *   (`advanceAbstractRegion`) and occasionally emitting a `SimEvent`
 *   (boom/die-off/emigration) — O(species count), not O(agent count), per
 *   unobserved region per tick.
 * - Moving focus (`setFocusedRegion`) is a **region-level promotion/
 *   demotion**, symmetric with the agent-level combat one: `demoteRegion`
 *   collapses a region's real agents into an aggregate when focus leaves;
 *   `promoteRegion` invents plausible individuals from an aggregate when
 *   focus arrives.
 *
 * **This is explicitly lossy, not an implementation detail to gloss over**:
 * demoting a region discards exactly which individuals existed (their
 * nature/disposition/rapport/notable-title/parentage/build history — all of
 * it), keeping only per-species population and average need levels.
 * Promoting a region invents a FRESH set of individuals matching those
 * aggregate numbers, not the ones that were there before — a Bulbasaur that
 * was The Hero before its region went abstract does not come back as The
 * Hero (or even the same individual) when the region is promoted again.
 * Two more real, deliberate simplifications, worth naming plainly rather
 * than discovering by surprise:
 * - **A background region's terrain is frozen**, not simulated — no
 *   `growFlora`/`advanceWeather`/`decayShelters` runs against it while
 *   abstracted. `RegionAggregate.resourceIndex` (measured once at demotion,
 *   drifted cheaply afterward — see `advanceAbstractRegion`) stands in for
 *   "how the land is doing" instead of a real terrain tick, which is the
 *   actual cost this system exists to avoid paying for every region every
 *   tick.
 * - **In-flight eggs are discarded on demotion.** `demoteRegion` only folds
 *   living, non-egg agents into the aggregate — an egg mid-incubation when
 *   its region goes abstract simply doesn't exist anymore once promoted.
 *
 * **Migration edges** (`RegionEdge`) connect regions for the stretch-goal
 * idea TODO.md flags: "a disperser could eventually target another region."
 * What's actually built here is the CHEAP half only —
 * `advanceAbstractRegion`'s `maybeEmigrate` moves a small population
 * fraction between two regions that are BOTH currently abstract, no
 * individuals involved. The harder half — `dispersal.ts`'s real per-agent
 * disperser actually walking off the edge of the focused region's map and
 * landing as a promoted individual in a neighboring one — is genuinely not
 * built. That would mean `dispersal.ts` (sibling-session territory this
 * session stayed out of) knowing about region edges at all, which is a real
 * follow-up, not attempted here.
 */

/** Per-species abstract state for a region that isn't currently focused. */
export interface RegionAggregate {
  species: string;
  homeLayer: Layer;
  /** Real-valued (not rounded) so growth/decline compounds smoothly tick over tick — only rounded when reconstructing individuals or reporting. */
  population: number;
  avgHunger: number;
  avgThirst: number;
  avgEnergy: number;
  /**
   * Frozen at whatever `demoteRegion` measured off real individuals —
   * abstracted regions do NOT advance this (no leveling model exists at the
   * aggregate tier). A real, open simplification: a population that spends
   * a long stretch abstracted doesn't get any stronger, unlike a promoted
   * region's real agents would via the ordinary leveling system.
   */
  avgLevel: number;
  /**
   * Fixed abundance baseline, 0-1, measured ONCE at demotion (or inherited
   * on an emigration-created aggregate — see `maybeEmigrate`) and never
   * drifted afterward — see `measureResourceIndex`. Carrying capacity
   * (`advanceAbstractRegion`) is derived from THIS, not from the dynamic
   * `resourceIndex` below: deriving capacity from a value that itself
   * drifts toward "however much headroom is left under capacity" is a
   * feedback loop that chases 1 forever (confirmed by this module's own
   * real-run validation — see DESIGN.md) rather than settling anywhere.
   */
  baseResourceIndex: number;
  /**
   * Current abundance, bounded to [0, `baseResourceIndex`] — drifts down
   * under grazing pressure (population near/over capacity) and recovers
   * back toward the fixed baseline otherwise. Drives the needs-equilibrium
   * calculation in `advanceAbstractRegion`; never exceeds the baseline (a
   * background region's terrain is frozen, so it never becomes MORE
   * abundant than whatever was measured at demotion — see this file's top
   * doc comment).
   */
  resourceIndex: number;
  /** Population level the last `regionPopulationBoom`/`regionDieOff` event fired at — prevents re-firing every single tick once a threshold is technically crossed. */
  lastEventPopulation: number;
}

/** One undirected connection between two regions — see this file's "Migration edges" doc comment above. */
export interface RegionEdge {
  a: string;
  b: string;
}

export interface Region {
  id: string;
  world: World;
  /**
   * Present only while this region is NOT the focused one. Absent means
   * this region's population lives in `world.agents` and is ticked for real
   * by `tickOverworld` via the ordinary `tickWorld`.
   */
  aggregates?: Record<string, RegionAggregate>;
}

export interface Overworld {
  regions: Region[];
  edges: RegionEdge[];
  focusedRegionId: string;
  /**
   * Graph-level clock, separate from any individual region's own
   * `world.tick` (which only advances for the currently-focused region,
   * since a background region's world is frozen — see this file's top
   * doc comment). Every event this module logs is timestamped with this,
   * not a region's own `world.tick`, so region-graph narrative stays on one
   * consistent timeline regardless of which region happens to be focused.
   */
  tick: number;
}

/** Start a graph from a set of already-populated regions (each `world.agents` filled in by the caller, same as any ordinary scenario). Every region except `focusedRegionId` is immediately demoted. */
export function createOverworld(regions: Region[], edges: RegionEdge[], focusedRegionId: string, log?: EventLog): Overworld {
  const overworld: Overworld = { regions, edges, focusedRegionId, tick: 0 };
  for (const region of regions) {
    if (region.id !== focusedRegionId) demoteRegion(region, overworld, log);
  }
  return overworld;
}

export function findRegion(overworld: Overworld, id: string): Region | undefined {
  return overworld.regions.find((r) => r.id === id);
}

/**
 * Whole-map surface food+water abundance, 0-1 — reuses `resourceIndex.ts`'s
 * cached per-terrain-kind lookups (`foodStockNear`/`countTerrainNear`) with
 * a radius covering the entire grid rather than a herd-local sample, so this
 * is one O(matching tiles) pass, not O(width*height). Deliberately
 * surface-only regardless of a species' `homeLayer` — matches the real
 * engine's own cross-layer need-seeking (underground/canopy have no food or
 * water of their own; every agent there already crosses to the surface for
 * both, see needs.ts's `findLayerWithTerrain`).
 */
function measureResourceIndex(world: World): number {
  const center = { x: world.width / 2, y: world.height / 2 };
  const radius = Math.max(world.width, world.height);
  const foodTotal = foodStockNear(world, "surface", center, radius);
  const waterCount = countTerrainNear(world, "surface", center, "water", radius);
  const area = world.width * world.height;
  return Math.min(1, (foodTotal + waterCount) / area);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Collapses a region's real agents into per-species aggregates and empties
 * `world.agents` — the region-level demotion. Only living, non-egg agents
 * count (see this file's top doc comment for why corpses/eggs are excluded
 * rather than folded in some other way). A species with zero living members
 * this pass simply gets no aggregate entry — a real local extinction, not
 * an error.
 */
export function demoteRegion(region: Region, overworld: Overworld, log?: EventLog): void {
  const resourceIndex = measureResourceIndex(region.world);
  const totals = new Map<string, { count: number; hunger: number; thirst: number; energy: number; level: number; homeLayer: Layer }>();

  for (const agent of region.world.agents) {
    if (agent.alive === false || agent.isEgg) continue;
    const entry = totals.get(agent.species) ?? { count: 0, hunger: 0, thirst: 0, energy: 0, level: 0, homeLayer: agent.homeLayer };
    entry.count += 1;
    entry.hunger += agent.needs.hunger;
    entry.thirst += agent.needs.thirst;
    entry.energy += agent.needs.energy;
    entry.level += agent.level ?? 5;
    totals.set(agent.species, entry);
  }

  const aggregates: Record<string, RegionAggregate> = {};
  const speciesCounts: Record<string, number> = {};
  for (const [species, entry] of totals) {
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
    };
    speciesCounts[species] = entry.count;
  }

  region.aggregates = aggregates;
  region.world.agents = [];

  log?.record({ kind: "regionDemoted", tick: overworld.tick, regionId: region.id, speciesCounts });
}

/**
 * Random spawn point for a promoted individual — surface species land via
 * `findPosInBiome`/`findWalkableNear` (species with no tagged biomes just
 * get a plain random walkable tile), obligate-aquatic species get the
 * nearest real water tile to that point (mirrors `packages/data`'s own
 * `createDemoWorld`'s `findWaterNear` reasoning: a merely-walkable tile can
 * just as easily be dry land). Underground/canopy are a flat, fully
 * walkable grid at every (x,y) — see worldgen.ts — so a plain random point
 * needs no walkability search at all.
 */
function placeInvented(world: World, speciesInfo: ImmigrationSpeciesInfo, rng: () => number): Vec2 {
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
 * Invents plausible individuals from a region's aggregates — the region-
 * level promotion. Needs a roster/spawn hook into `@pokuelike/data` the same
 * way `immigration.ts` already does (the engine has no access to `SPECIES`
 * itself — see that module's own doc comment for the dependency direction),
 * so this deliberately reuses `ImmigrationContext` wholesale rather than
 * inventing a parallel context type: "spawn a real agent of this species at
 * this position/level" is exactly the same primitive immigration already
 * needed. A species aggregate with no matching roster entry is honestly
 * skipped (can't reconstruct what the caller's data layer doesn't know
 * about) rather than silently dropped with no signal.
 */
export function promoteRegion(region: Region, ctx: ImmigrationContext, rng: () => number, overworld: Overworld, log?: EventLog): void {
  const aggregates = region.aggregates;
  if (!aggregates) return;

  const newAgentIds: string[] = [];
  for (const aggregate of Object.values(aggregates)) {
    const count = Math.round(aggregate.population);
    if (count <= 0) continue;
    const speciesInfo = ctx.speciesRoster.find((s) => s.id === aggregate.species);
    if (!speciesInfo) continue;

    const herdId = `${aggregate.species}-region-${region.id}`;
    for (let i = 0; i < count; i++) {
      const pos = placeInvented(region.world, speciesInfo, rng);
      const level = Math.max(1, Math.round(aggregate.avgLevel));
      const agent: Agent = ctx.spawnAgent(aggregate.species, `${aggregate.species}-${region.id}-invented-${overworld.tick}-${i}`, pos, level, rng);
      agent.needs = {
        hunger: jitteredNeed(aggregate.avgHunger, rng),
        thirst: jitteredNeed(aggregate.avgThirst, rng),
        energy: jitteredNeed(aggregate.avgEnergy, rng),
        mateDrive: 0,
      };
      agent.sex = rng() < 0.5 ? "male" : "female";
      agent.herdId = herdId;
      agent.homePos = { ...agent.pos };
      region.world.agents.push(agent);
      newAgentIds.push(agent.id);
    }
  }

  region.aggregates = undefined;
  log?.record({ kind: "regionPromoted", tick: overworld.tick, regionId: region.id, agentIds: newAgentIds });
}

/**
 * How fast a background region's average need levels relax toward its
 * resource-driven equilibrium each tick — a smoothing rate standing in for
 * real agents actually foraging/drinking to stay near "satisfied," not a
 * literal per-agent decay curve (see needs.ts for the real one). Sim-
 * original tuning guess, judged against a real run like every other magic
 * number in this codebase.
 */
const NEED_ADAPT_RATE = 0.02;
/** Mean of avgHunger/avgThirst below this reads as "declining," at/above as "growing" — see `advanceAbstractRegion`. */
const DEATH_HEALTH_THRESHOLD = 0.3;
/** Net per-tick population growth/decline rate at the extremes of the health scale. */
const POP_GROWTH_RATE = 0.01;
/**
 * Scales `baseResourceIndex` into a per-species carrying capacity. Tuned
 * against this module's own real-run validation (a `createDemoWorld`-sized
 * 90x60 map measures `baseResourceIndex` around ~0.5 — see
 * `measureResourceIndex`), targeting per-species aggregate populations in
 * roughly the same tens-not-hundreds ballpark this codebase's real
 * single-region full-sim runs land in (see TODO.md/DESIGN.md's "final
 * population currently lands roughly in the 10-40 range" real-run notes) —
 * a sim-original tuning guess, not canon, like every other magic number in
 * this codebase.
 */
const CAPACITY_SCALE = 50;
/** Floor under carrying capacity so a resource-poor region doesn't mathematically starve a species to a literal zero ceiling. */
const MIN_CAPACITY = 3;
/** How fast resource abundance itself drifts toward a population-relief equilibrium — the abstract tier's stand-in for real grazing/regrowth (flora.ts), not a real terrain tick (background-region terrain is frozen, see this file's top doc comment). */
const RESOURCE_ADAPT_RATE = 0.0005;
/** A boom/die-off event only re-fires once population has moved at least this multiplicative factor from the last one it fired at, so the log doesn't spam every tick a threshold is technically still crossed. */
const EVENT_REFIRE_RATIO = 1.5;

function maybeEmitPopulationEvent(region: Region, aggregate: RegionAggregate, overworld: Overworld, log?: EventLog): void {
  if (aggregate.lastEventPopulation <= 0) {
    aggregate.lastEventPopulation = Math.max(1, aggregate.population);
    return;
  }
  if (aggregate.population >= aggregate.lastEventPopulation * EVENT_REFIRE_RATIO) {
    log?.record({ kind: "regionPopulationBoom", tick: overworld.tick, regionId: region.id, species: aggregate.species, population: Math.round(aggregate.population) });
    aggregate.lastEventPopulation = aggregate.population;
  } else if (aggregate.population <= aggregate.lastEventPopulation / EVENT_REFIRE_RATIO) {
    log?.record({ kind: "regionDieOff", tick: overworld.tick, regionId: region.id, species: aggregate.species, population: Math.round(aggregate.population) });
    aggregate.lastEventPopulation = Math.max(aggregate.population, 0.001);
  }
}

/**
 * How often (per tick, per eligible species) a background region rolls to
 * emigrate a slice of its population along an edge — see `maybeEmigrate`.
 * Tuned down from an initial 0.002 guess after a real 3000-tick/2-region
 * validation run fired ~130 emigrations at that rate (a species with a
 * shared edge to another abstract region emigrated almost every 20-odd
 * ticks) — this codebase's own convention (DESIGN.md) is a rare, "worth
 * noticing" event, not routine background noise.
 */
const EMIGRATION_CHANCE_PER_TICK = 0.0005;
/** Fraction of a species' population that moves on a successful emigration roll. */
const EMIGRATION_FRACTION = 0.1;
/** A species needs at least this many (abstract) individuals before it's eligible to emigrate at all — no point rolling for a population of 1-2. */
const EMIGRATION_MIN_POPULATION = 6;

function neighborsOf(overworld: Overworld, regionId: string): Region[] {
  const neighborIds = overworld.edges
    .filter((edge) => edge.a === regionId || edge.b === regionId)
    .map((edge) => (edge.a === regionId ? edge.b : edge.a));
  return overworld.regions.filter((r) => neighborIds.includes(r.id));
}

/**
 * The cheap abstract-tier stand-in for a real individual disperser
 * targeting another region — see this file's top-of-file "Migration edges"
 * doc comment for what's genuinely NOT built here. Only ever moves
 * population between two regions that are BOTH currently abstract (a
 * neighbor without `aggregates` is the focused region, and folding a slice
 * of an abstract population straight into it would mean inventing real
 * individuals mid-tick outside the normal promotion path — skipped, not
 * attempted).
 */
function maybeEmigrate(overworld: Overworld, region: Region, rng: () => number, log?: EventLog): void {
  const aggregates = region.aggregates;
  if (!aggregates) return;
  const neighbors = neighborsOf(overworld, region.id).filter((r) => r.aggregates);
  if (neighbors.length === 0) return;

  for (const aggregate of Object.values(aggregates)) {
    if (aggregate.population < EMIGRATION_MIN_POPULATION) continue;
    if (rng() >= EMIGRATION_CHANCE_PER_TICK) continue;

    const destination = neighbors[Math.floor(rng() * neighbors.length)]!;
    const moving = aggregate.population * EMIGRATION_FRACTION;
    aggregate.population -= moving;

    const destAggregates = destination.aggregates!;
    const existing = destAggregates[aggregate.species];
    if (existing) {
      existing.population += moving;
    } else {
      // A freshly measured baseline for the destination, not the source's —
      // abundance is a property of the region's own (frozen) terrain, not
      // something that travels with the migrating population.
      const destBaseline = measureResourceIndex(destination.world);
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
      };
    }

    log?.record({
      kind: "regionEmigrated",
      tick: overworld.tick,
      fromRegionId: region.id,
      toRegionId: destination.id,
      species: aggregate.species,
      population: Math.round(moving),
    });
  }
}

/**
 * Advances one background region's aggregates by one tick — O(species
 * count in this region), never touches individual agents (there are none)
 * or the region's own terrain (frozen while abstract, see this file's top
 * doc comment). Called once per non-focused region per `tickOverworld`
 * call, the direct aggregate-tier analog of `tickWorld`'s per-agent loop.
 */
export function advanceAbstractRegion(overworld: Overworld, region: Region, rng: () => number, log?: EventLog): void {
  const aggregates = region.aggregates;
  if (!aggregates) return;

  for (const aggregate of Object.values(aggregates)) {
    // Needs relax toward the region's own resource abundance — real agents
    // forage/drink to stay near "satisfied" rather than decaying to 0
    // unconditionally; this is the cheap population-level stand-in for that
    // self-correcting behavior.
    aggregate.avgHunger = clamp01(aggregate.avgHunger + (aggregate.resourceIndex - aggregate.avgHunger) * NEED_ADAPT_RATE);
    aggregate.avgThirst = clamp01(aggregate.avgThirst + (aggregate.resourceIndex - aggregate.avgThirst) * NEED_ADAPT_RATE);

    const health = (aggregate.avgHunger + aggregate.avgThirst) / 2;
    // Capacity comes from the FIXED baseline, not the dynamic `resourceIndex`
    // below — see `RegionAggregate.baseResourceIndex`'s doc comment for why
    // deriving it from the dynamic value is a feedback loop that chases 1
    // forever rather than settling.
    const capacity = Math.max(MIN_CAPACITY, aggregate.baseResourceIndex * CAPACITY_SCALE);
    // Two separate regimes, deliberately NOT one signed logistic formula
    // (`rN(1-N/K)`) applied uniformly: with a negative growth rate `r`
    // (starving) and an over-capacity population (`N > K`), that single
    // formula flips sign (negative * negative) and reports GROWTH — a real
    // bug an early version of this function had, caught by this file's own
    // test suite. A starving population always declines, full stop,
    // regardless of how it compares to capacity; only a healthy, growing
    // population is capacity-limited at all.
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

    // Resource abundance itself drifts: relief (regrowth outpaces grazing)
    // while population sits below capacity, depletion above it — but never
    // past the fixed baseline in either direction (0 floor, baseline
    // ceiling), so this settles instead of racing toward 1.
    const resourceTarget = aggregate.resourceIndex + (1 - aggregate.population / capacity) * RESOURCE_ADAPT_RATE;
    aggregate.resourceIndex = Math.min(aggregate.baseResourceIndex, Math.max(0, resourceTarget));

    maybeEmitPopulationEvent(region, aggregate, overworld, log);
  }

  maybeEmigrate(overworld, region, rng, log);

  // A background species whose population has decayed below one real
  // individual is dropped — a real local extinction, and it also stops
  // this loop (and a later `promoteRegion`) from carrying a permanently
  // near-zero entry forever.
  for (const [species, aggregate] of Object.entries(aggregates)) {
    if (aggregate.population < 1) delete aggregates[species];
  }
}

/**
 * Advances the whole region graph by one tick: the focused region gets a
 * real, full `tickWorld` pass; every other region gets the cheap
 * `advanceAbstractRegion` pass. Mirrors `tickWorld`'s own
 * `rng`/`rules`/`ctx`/`immigration` dependency-injection shape — each
 * region's own `world.rng` (seeded at that region's own creation) drives
 * its own randomness, never a shared graph-level generator, so two regions
 * ticked in the same call don't have their random rolls entangled.
 */
export function tickOverworld(overworld: Overworld, log?: EventLog, rules?: HuntRules, ctx?: LevelingContext, immigration?: ImmigrationContext): void {
  overworld.tick += 1;
  for (const region of overworld.regions) {
    if (region.id === overworld.focusedRegionId) {
      tickWorld(region.world, log, rules, ctx, region.world.rng, immigration);
    } else {
      advanceAbstractRegion(overworld, region, region.world.rng, log);
    }
  }
}

/**
 * Moves focus to a different region — the region-level promotion/demotion
 * transition. A no-op if `targetRegionId` is already focused, or if either
 * id doesn't resolve to a real region in this graph (silently, matching
 * this codebase's existing "absent/not-found reads as no-op" convention for
 * optional world state elsewhere, e.g. `World.herdMigrations` missing an
 * entry).
 */
export function setFocusedRegion(overworld: Overworld, targetRegionId: string, ctx: ImmigrationContext, rng: () => number, log?: EventLog): void {
  if (targetRegionId === overworld.focusedRegionId) return;
  const current = findRegion(overworld, overworld.focusedRegionId);
  const target = findRegion(overworld, targetRegionId);
  if (!current || !target) return;

  demoteRegion(current, overworld, log);
  promoteRegion(target, ctx, rng, overworld, log);
  overworld.focusedRegionId = targetRegionId;
}
