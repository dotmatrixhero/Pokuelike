import type { Agent, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { biomeWeightsAt, findWalkableNear } from "./worldgen.js";
import { findNearbyOtherHerd } from "./dispersal.js";
import { findNearestIndexed } from "./resourceIndex.js";

/**
 * Immigration — new herds arriving into the world from outside it, over the
 * course of a run, rather than the population being fixed forever to
 * whatever `createDemoWorld` hand-placed at tick 0. See DESIGN.md's
 * "Immigration" section for the full design reasoning and real-run numbers.
 *
 * Deliberately reuses this codebase's existing idioms rather than inventing
 * new ones: `herdMigration.ts`'s per-tick flat-chance-roll pattern (see
 * `updateHerdMigrations`) for "every so often, something happens," and
 * `dispersal.ts`'s `finishDispersal`/`findNearbyOtherHerd` "join a nearby
 * existing herd, or found a new one" pattern for how a freshly-arrived group
 * integrates — once spawned, an immigrant group is an ordinary herd; nothing
 * else in the engine needs to special-case it.
 *
 * The engine layer has no access to `@pokuelike/data`'s `SPECIES` table (the
 * dependency runs the other way — data depends on engine, never the
 * reverse), so this module takes an `ImmigrationContext` — the same
 * dependency-injection shape `leveling.ts`'s `LevelingContext` and
 * `types.ts`'s `HuntRules` already use — supplying the roster to pick from
 * and the actual agent-construction function (`spawn.ts`'s `spawnAgent`, not
 * duplicated here).
 */

export interface ImmigrationSpeciesInfo {
  id: string;
  homeLayer: Layer;
  /** See species.ts's `SpeciesDef.biomes` — absent/empty reads as "no particular biome preference." */
  biomes?: string[];
  /**
   * See species.ts's `SpeciesDef.obligateAquatic`. Changes ONLY where an
   * immigrating group of this species actually lands (below) — an ordinary
   * `findWalkableNear` pick treats any walkable tile, water included, as an
   * equally valid hit, which for a genuinely obligate-aquatic species could
   * land a whole immigrant group on dry land with no water anywhere in
   * `canEnterLand`'s one-shore-tile-deep reach, stranding them from the
   * moment they arrive. Absent/false = unchanged existing behavior.
   */
  obligateAquatic?: boolean;
  /**
   * The lowest level a real specimen of this species could plausibly exist
   * at — 1 for a base form, or its own real evolution-level threshold
   * otherwise (`@pokuelike/data`'s `naturalMinLevelFor`). Absent = treated
   * as 1, the safe "no evolution data available" fallback (bare-engine
   * tests that build a roster by hand). See `rollImmigrantLevel`'s own doc
   * comment for how this actually turns into a spawn level.
   */
  minLevel?: number;
  /**
   * True for a species that never evolves at all AND isn't itself an
   * evolved form (`@pokuelike/data`'s `isSingleStageSpecies`) — e.g. Tauros,
   * Farfetch'd, Lapras, Scyther, Snorlax. Direct ask: "make all Pokémon with
   * just base form have a wider range of base level." A species partway
   * through a multi-stage line (Bulbasaur) is realistically "young" at its
   * floor — it hasn't had time to evolve yet — but a species with only one
   * form ever has no such tell: a wild population of it plausibly spans its
   * entire adult lifespan, so its spawn range should reflect that instead of
   * the same narrow just-hatched spread every base form gets. Absent/false =
   * unchanged existing behavior. See `rollImmigrantLevel`.
   */
  singleStage?: boolean;
  /**
   * See species.ts's `SpeciesDef.isPredator`. Carried through so
   * `macroGrid.ts`'s `pickZoneSpeciesPool` can deliberately balance a fresh
   * zone's invented population — direct ask: "try to have at least some
   * predators + prey per each zone typically. With a smaller number of
   * predators." Absent/false = an ordinary prey/neutral species, unchanged
   * existing behavior.
   */
  isPredator?: boolean;
  /**
   * See `@pokuelike/data`'s `SpeciesDef.rarity` — a multiplier on how often
   * this species shows up, both as an immigrant (`pickImmigrantSpecies`'s
   * weight, below) and in how large its invented population is
   * (`macroGrid.ts`'s `estimateZoneSpecies`). Absent = `1`, ordinary
   * frequency.
   */
  rarity?: number;
}

export interface ImmigrationContext {
  /** Every spawnable roster species — `@pokuelike/data`'s `IMMIGRATION_CONTEXT` builds this from `SPECIES`. */
  speciesRoster: ImmigrationSpeciesInfo[];
  /** Builds a full new `Agent` for `speciesId` at `pos`/`level` — `@pokuelike/data`'s `spawn.ts`'s `spawnAgent`, reused rather than duplicating agent-construction logic here. */
  spawnAgent(speciesId: string, id: string, pos: Vec2, level: number, rng: () => number): Agent;
}

/**
 * Base unscaled per-tick chance of an immigration roll — before the
 * population-cap scaling in `immigrationScale` and the
 * `MIN_TICKS_BETWEEN_IMMIGRATIONS` cooldown below. Picked so a 3000-tick run
 * (this project's standard real-run length — see DESIGN.md) sees roughly
 * 6 rolls' worth of *chance* before the cooldown/cap start trimming that
 * down to what a real run below shows (1/500 * 3000 ≈ 6) — frequent enough
 * to be a real, observable, checkable-in-a-single-run mechanic, not a
 * once-in-a-blue-moon flavor event nobody ever actually sees fire. Sim-
 * original tuning guess, like every other magic number in this codebase —
 * judge against a real run, not canon.
 */
export const IMMIGRATION_BASE_CHANCE = 1 / 500;

/**
 * Minimum ticks between two immigration events, regardless of how the
 * per-tick roll lands — prevents a lucky short run of rolls from dumping
 * several new herds onto the map back to back. Picked at the same order of
 * magnitude as `herdMigration.ts`'s sustained-trigger windows
 * (`SCARCITY_SUSTAIN_TICKS`/`TERRITORIAL_SUSTAIN_TICKS`, both 150) but a
 * bit longer, since an immigration is a rarer, bigger-impact event than a
 * migration — one new herd should have time to actually settle in and
 * become visible before the next one shows up.
 */
export const MIN_TICKS_BETWEEN_IMMIGRATIONS = 250;

/**
 * Population ceiling design (task brief's explicit ask: immigration must
 * not be allowed to run unbounded). Nothing else in this codebase caps
 * population at all yet (a confirmed gap — see TODO.md), so this is the
 * first real cap, scoped only to immigration's own contribution rather than
 * trying to solve unbounded population growth in general (breeding is still
 * uncapped; that's a separate, bigger follow-up, not attempted here).
 *
 * `POP_SOFT_CAP`: below this many living agents, immigration rolls at full
 * strength. `POP_HARD_CAP`: at or above this many, immigration is skipped
 * entirely (chance forced to exactly 0). Between the two, the chance scales
 * linearly down from full to zero — a soft landing rather than a hard cliff,
 * so the population doesn't visibly "slam" into a ceiling.
 *
 * Picked from this session's own real-run context (see the task brief/
 * DESIGN.md): a normal 3000-tick run's final population currently lands
 * roughly in the 10-40 range (e.g. seed 42: 37, seed 7: 22, seed
 * 20260903: 13, after this session's breeding-gate tuning). 70/110 sits
 * comfortably above that normal range — immigration should be able to push
 * a low-growth seed further before capping, not choke off a seed that's
 * already growing healthily on its own — while still being a real, finite
 * ceiling rather than "no cap in practice."
 */
export const POP_SOFT_CAP = 70;
export const POP_HARD_CAP = 110;

function immigrationScale(livingCount: number): number {
  if (livingCount >= POP_HARD_CAP) return 0;
  if (livingCount <= POP_SOFT_CAP) return 1;
  return 1 - (livingCount - POP_SOFT_CAP) / (POP_HARD_CAP - POP_SOFT_CAP);
}

/** How many new agents arrive together in one immigration event — a small founding group, not a single wanderer or a whole herd's worth. */
const MIN_GROUP_SIZE = 1;
const MAX_GROUP_SIZE = 3;

/**
 * Floor level for a base-form immigrant (no real evolution threshold of its
 * own) — matches `createDemoWorld`'s own starting-agent level for the
 * roster's non-guardian base-form species (bulbasaur/diglett/sandshrew/
 * pidgey/squirtle/charmander all spawn at 5), preserved as the low end of
 * the roll below rather than changed outright. Exported so `overworld.ts`'s
 * own region-invention level pick (`estimateInitialAggregates`) can apply
 * the identical "at least this, or the species' own real evolution
 * threshold if higher" floor instead of a second, independently-hardcoded
 * default.
 */
export const IMMIGRANT_BASE_LEVEL_FLOOR = 5;
/**
 * Real spread on top of a species' own floor — direct ask: "some randomness
 * in starting rolls would be good." `rng() * this`, floored, added to the
 * floor below — e.g. a base-form immigrant now arrives anywhere from 5 to
 * 12, not a single fixed value every time.
 */
export const IMMIGRANT_LEVEL_JITTER = 8;
/**
 * Jitter used instead of `IMMIGRANT_LEVEL_JITTER` for a `singleStage`
 * species — direct ask: "make all Pokémon with just base form have a wider
 * range of base level." A species that never evolves has no "still young,
 * hasn't evolved yet" reason to cluster near the floor, so its spawn range
 * spans something closer to a real wild population's full adult spread
 * (floor 5 to ~35) instead of the same narrow 5-12 every base form gets.
 * Exported for the same direct-testability reason as `IMMIGRANT_LEVEL_
 * JITTER`.
 */
export const SINGLE_STAGE_LEVEL_JITTER = 30;
/**
 * Added on top of a predator species' own ordinary floor — direct ask,
 * after the earlier predator pass: "a lot of em are too low leveled... we
 * need at least a couple higher leveld predators." A BASE-form predator
 * (Scyther/Spearow/Onix/Ekans/Zubat — real `minLevel` 1, same as any
 * ordinary base-form prey species) previously floored at the exact same
 * 5-12 range as anything else, which reads as a weak, unthreatening
 * "predator" — real apex hunters are established, mature individuals, not
 * fresh hatchlings. `species.isPredator` (`ImmigrationSpeciesInfo`,
 * `@pokuelike/data`'s `SpeciesDef.isPredator`) adds this flat boost before
 * jitter, on top of whichever floor (ordinary or evolution-threshold-based)
 * already applied — an evolved predator (Gyarados/Tentacruel/Arbok/Golbat,
 * already floored higher via their own real evolution level) gets pushed
 * higher still, same as a base-form one.
 *
 * Halved from 15, direct follow-up ask after that predator pass shipped:
 * "Predator and prey gap level wise is a bit too high. Make em average out
 * to each other." Still a real, meaningful bump (predators read as
 * established individuals, not fresh hatchlings) — just no longer wide
 * enough on its own to make every encounter one-sided; see
 * `PREY_LEVEL_JITTER`'s own doc comment for the other half of the fix, on
 * the prey side.
 */
export const PREDATOR_LEVEL_BOOST = 6;
/**
 * Prey's own (non-predator) jitter width, replacing `IMMIGRANT_LEVEL_JITTER`
 * for a base-form prey species — direct ask, same report as
 * `PREDATOR_LEVEL_BOOST`'s reduction: "Prey should have a wider range of
 * levels. That skew their avg level down." Twice `IMMIGRANT_LEVEL_JITTER`
 * (8), so a wild prey population genuinely spans more of its possible range
 * — from fresh hatchlings up to real veterans — rather than clustering in
 * the same narrow band every base-form species got before. Composed with
 * `PREY_LEVEL_SKEW` below (not sampled uniformly), so the wider range's
 * extra mass sits toward the LOW end: more young/weak individuals pulling
 * the population's average down, which is what actually narrows the
 * predator/prey average-level gap alongside `PREDATOR_LEVEL_BOOST`'s own
 * reduction — a uniform-random widening alone would have left the average
 * unchanged (or pushed it up), not down.
 */
export const PREY_LEVEL_JITTER = 16;
/**
 * The `singleStage` prey counterpart to `PREY_LEVEL_JITTER` — replaces
 * `SINGLE_STAGE_LEVEL_JITTER` for a non-predator `singleStage` species.
 * Widened further still (from 30 to 40): a `singleStage` species already
 * plausibly spans its whole adult lifespan (see `SINGLE_STAGE_LEVEL_JITTER`'s
 * own doc comment), so the same "wider range, skewed low" treatment applies
 * with an even bigger ceiling.
 */
export const SINGLE_STAGE_PREY_LEVEL_JITTER = 40;
/**
 * The exponent `rollLevelJitter` raises a `[0,1)` roll to before scaling it
 * by a prey species' jitter width — `rng() ** PREY_LEVEL_SKEW` has mean
 * `1 / (PREY_LEVEL_SKEW + 1)`, so a value of 4 means the "average" fraction
 * of the jitter band actually used is 1/5 (20%), not the 50% a uniform roll
 * would give: most rolls land near the low end, with a real but
 * infrequent tail reaching the wider ceiling above. This is the mechanism
 * behind `PREY_LEVEL_JITTER`'s "wider range... skewed low" — see that
 * constant's own doc comment. Predators are NOT skewed (still a plain
 * uniform `rng() * jitter`, same as before this feature) — the ask was
 * specifically about prey.
 */
const PREY_LEVEL_SKEW = 4;

/** The real jitter-band width `rollImmigrantLevel` uses for `species` — see `PREY_LEVEL_JITTER`/`SINGLE_STAGE_PREY_LEVEL_JITTER`'s own doc comments for why prey and predators use different widths. Exported so `overworld.ts`'s zone-promotion individual-variance spread can reuse the identical width instead of a second, possibly-diverging guess. */
export function levelJitterWidth(species: Pick<ImmigrationSpeciesInfo, "isPredator" | "singleStage">): number {
  if (species.isPredator) {
    return species.singleStage ? SINGLE_STAGE_LEVEL_JITTER : IMMIGRANT_LEVEL_JITTER;
  }
  return species.singleStage ? SINGLE_STAGE_PREY_LEVEL_JITTER : PREY_LEVEL_JITTER;
}

/** One real jitter roll for `species`, already scaled to its own width — a plain uniform roll for a predator, `PREY_LEVEL_SKEW`-biased-low for prey. See `levelJitterWidth`/`PREY_LEVEL_SKEW`'s own doc comments. */
function rollLevelJitter(species: Pick<ImmigrationSpeciesInfo, "isPredator" | "singleStage">, rng: () => number): number {
  const width = levelJitterWidth(species);
  const fraction = species.isPredator ? rng() : Math.pow(rng(), PREY_LEVEL_SKEW);
  return Math.floor(fraction * width);
}

/**
 * A real, species-aware immigrant level — direct ask, after noticing every
 * immigrant arrived at the exact same flat level regardless of species:
 * "why does everything spawn at lv5. Especially evolved Pokémon they should
 * be higher distributed." `species.minLevel` (`ImmigrationSpeciesInfo`,
 * `@pokuelike/data`'s `naturalMinLevelFor`) is the real floor an already-
 * evolved species could plausibly exist at — `Math.max` against the
 * ordinary base-form floor so an unclassified/base species keeps its
 * existing 5+ range unchanged, while a genuinely evolved species floors
 * meaningfully higher (its own real evolution-level threshold) before a
 * real jitter on top (`rollLevelJitter` — see `levelJitterWidth`/
 * `PREY_LEVEL_SKEW` for the real predator/prey asymmetry that narrows the
 * two populations' average levels toward each other). A predator
 * (`species.isPredator`) also gets `PREDATOR_LEVEL_BOOST` added to its
 * floor — see that constant's own doc comment. Exported (like
 * `accumulateActionEnergy` in simulation.ts) so it's directly,
 * deterministically testable without needing to reverse-engineer
 * `maybeImmigrate`'s own internal rng call order just to isolate this one
 * roll.
 *
 * `localAvgLevel`, when given (see `localAverageLevel` — the real average
 * level of this species' own currently-living population in the world),
 * re-centers the same jitter band on it instead of on the bare species
 * floor — direct ask, after a report of one-sided fights from the level
 * spread: "the ones that migrate in come in matching the level a little
 * more." Still clamped at `floor` (an evolved/predator species never
 * arrives below its own real minimum just because a struggling local
 * population's average happens to be lower). Absent (no living member of
 * this species yet to match against — a genuinely first arrival) falls back
 * to the original species-only floor+jitter roll unchanged.
 */
export function rollImmigrantLevel(species: ImmigrationSpeciesInfo, rng: () => number, localAvgLevel?: number): number {
  const floor = Math.max(IMMIGRANT_BASE_LEVEL_FLOOR, species.minLevel ?? 1) + (species.isPredator ? PREDATOR_LEVEL_BOOST : 0);
  if (localAvgLevel === undefined) {
    return floor + rollLevelJitter(species, rng);
  }
  const width = levelJitterWidth(species);
  const center = Math.max(floor, Math.round(localAvgLevel - width / 2));
  return center + rollLevelJitter(species, rng);
}

/**
 * The real average level of `speciesId`'s currently-living, non-egg
 * population in `world` — `undefined` if none exist yet (a genuinely first
 * arrival has nothing local to match). See `rollImmigrantLevel`'s own doc
 * comment for why this is what an immigrant's level gets centered on.
 */
export function localAverageLevel(world: World, speciesId: string): number | undefined {
  let sum = 0;
  let count = 0;
  for (const agent of world.agents) {
    if (agent.alive === false || agent.isEgg || agent.species !== speciesId) continue;
    sum += agent.level ?? 1;
    count++;
  }
  return count > 0 ? sum / count : undefined;
}

/**
 * Picks a random point on one of the four map edges — "arrives from
 * outside" is the whole premise of immigration, so unlike
 * `herdMigration.ts`'s `pickDestination` (which searches outward from an
 * existing herd's centroid), this starts from the map's boundary, not
 * anywhere already-occupied.
 */
function pickEdgePos(world: World, rng: () => number): Vec2 {
  const edge = Math.floor(rng() * 4);
  const t = rng();
  switch (edge) {
    case 0: // north
      return { x: Math.round(t * (world.width - 1)), y: 0 };
    case 1: // east
      return { x: world.width - 1, y: Math.round(t * (world.height - 1)) };
    case 2: // south
      return { x: Math.round(t * (world.width - 1)), y: world.height - 1 };
    default: // west
      return { x: 0, y: Math.round(t * (world.height - 1)) };
  }
}

/**
 * Which species arrives, and how strongly it's favored — two multiplicative
 * factors, real design decisions documented here rather than left as an
 * unexplained formula:
 *
 * 1. **Under-representation weight** (`1 / (currentCount + 1)`): a species
 *    with few or zero living members right now is more likely to be the one
 *    that immigrates. This is the "wandering in from outside, drawn to
 *    where there's room" reading DESIGN.md settled on — it also means a
 *    species that's struggling or newly extinct locally (this codebase's
 *    own predator-population-crash finding, see TODO.md) has a real,
 *    mechanical chance of being replenished from outside rather than just
 *    staying gone forever once wiped out.
 * 2. **Biome-match weight**: the arrival point (an edge tile) is scored via
 *    `biomeWeightsAt` against the species' own tagged `biomes` (species.ts).
 *    A species with no biome tag reads as neutral (weight 1 everywhere); a
 *    tagged species gets its summed blend weight for its own biomes, floored
 *    at `UNTAGGED_MATCH_FLOOR` so an untagged-match arrival is disfavored
 *    but never literally impossible (a badlands-tagged species can still,
 *    rarely, wander in at a grassland edge — real animals don't
 *    hard-respect biome boundaries either).
 *
 * This is the "component 2 — biome affinity connected to the world for
 * real" payoff for immigration specifically: which species shows up, and
 * where, is a real function of the map's generated biome layout, not a
 * flat/uniform random pick.
 */
const UNTAGGED_MATCH_FLOOR = 0.15;

/**
 * Predator share of the living population the world drifts back toward. Not
 * a cap or a quota — only the immigration weighting notices it, and only to
 * make a hunter more likely to WALK IN when the niche is empty.
 */
export const PREDATOR_TARGET_SHARE = 0.2;

/** Strongest immigration boost a predator species gets, applied when there are none left alive at all. */
export const PREDATOR_EMPTY_NICHE_BOOST = 6;

/**
 * How much more likely a predator species is to be the one that immigrates,
 * given the current predator share of the living population. 1 (no boost)
 * once the share reaches `PREDATOR_TARGET_SHARE`, rising to
 * `PREDATOR_EMPTY_NICHE_BOOST` when there are no predators left.
 *
 * This exists because the ecosystem measurably falls off both sides of the
 * ridge: across four 8k-tick seeds, two ended with zero living predators
 * and one with 77% predators (having eaten out its own prey). A world with
 * no hunters still has herd conflict, but nothing is being hunted, and
 * predation is where most of the interesting combat comes from.
 *
 * Deliberately only a nudge on WHICH species arrives, never on whether
 * immigration happens or how many — an empty niche makes a hunter's arrival
 * likelier, it does not conjure one on demand, and a healthy predator
 * population turns this off entirely.
 */
export function predatorNicheBoost(species: { isPredator?: boolean }, predatorShare: number): number {
  if (!species.isPredator) return 1;
  const deficit = Math.max(0, 1 - predatorShare / PREDATOR_TARGET_SHARE);
  return 1 + (PREDATOR_EMPTY_NICHE_BOOST - 1) * deficit;
}

function pickImmigrantSpecies(world: World, roster: readonly ImmigrationSpeciesInfo[], biomeWeights: Record<string, number>, rng: () => number): ImmigrationSpeciesInfo | undefined {
  if (roster.length === 0) return undefined;

  const predatorIds = new Set(roster.filter((species) => species.isPredator).map((species) => species.id));

  const counts = new Map<string, number>();
  for (const agent of world.agents) {
    if (agent.alive === false) continue;
    counts.set(agent.species, (counts.get(agent.species) ?? 0) + 1);
  }

  // Share of the living population that currently hunts. The existing
  // `repWeight` already favours rare SPECIES, but a predator is only ever
  // one rare species among many, which is not enough to refill an empty
  // predatory niche — measured across four seeds, two ended with literally
  // zero living predators and a third with 77% (the prey eaten out
  // instead). Both ends kill predation as a source of conflict.
  let living = 0;
  let livingPredators = 0;
  for (const agent of world.agents) {
    if (agent.alive === false) continue;
    living++;
    if (predatorIds.has(agent.species)) livingPredators++;
  }
  const predatorShare = living > 0 ? livingPredators / living : 0;

  const weights = roster.map((species) => {
    const repWeight = 1 / ((counts.get(species.id) ?? 0) + 1);
    let biomeMatch = 1;
    if (species.biomes && species.biomes.length > 0) {
      const matched = species.biomes.reduce((sum, name) => sum + (biomeWeights[name] ?? 0), 0);
      biomeMatch = Math.max(UNTAGGED_MATCH_FLOOR, matched);
    }
    // Direct ask: "make arboks less common" — a per-species dial
    // (`ImmigrationSpeciesInfo.rarity`) on top of the under-representation/
    // biome-match weighting above, absent = 1 (no change) for every other
    // species — combined with the predator-niche boost below, both are
    // independent multipliers on the same base weight.
    return repWeight * biomeMatch * (species.rarity ?? 1) * predatorNicheBoost(species, predatorShare);
  });

  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return roster[0];

  let roll = rng() * total;
  for (let i = 0; i < roster.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return roster[i];
  }
  return roster[roster.length - 1];
}

/**
 * Once per world tick (not once per agent — a world-level system, the same
 * "single per-tick check" shape as `herdMigration.ts`'s
 * `updateHerdMigrations` and weather.ts's `advanceWeather`), called from
 * `simulation.ts`'s `tickWorld`. A no-op with no `ImmigrationContext`
 * (bare-engine tests, or a caller that hasn't wired one up) — the existing
 * "optional dependency-injected context, absent means this feature simply
 * doesn't run" convention `rules`/`ctx` already establish for `tickWorld`.
 *
 * Gate order: cooldown first (cheapest check, no rng consumed if it fails —
 * matters for determinism-sensitive callers that want to reason about
 * exactly how many rng draws a tick consumes), then the population-scaled
 * chance roll, then (only once something's actually going to happen) the
 * edge/species/spawn-position work.
 */
export function maybeImmigrate(world: World, ctx: ImmigrationContext | undefined, log: EventLog | undefined, rng: () => number): void {
  if (!ctx || ctx.speciesRoster.length === 0) return;
  if (world.lastImmigrationTick !== undefined && world.tick - world.lastImmigrationTick < MIN_TICKS_BETWEEN_IMMIGRATIONS) return;

  const livingCount = world.agents.reduce((n, a) => n + (a.alive === false ? 0 : 1), 0);
  const scale = immigrationScale(livingCount);
  if (scale <= 0) return;
  if (rng() >= IMMIGRATION_BASE_CHANCE * scale) return;

  const edgePos = pickEdgePos(world, rng);
  const biomeWeights = biomeWeightsAt(world.biomeSeeds, edgePos.x, edgePos.y);
  const species = pickImmigrantSpecies(world, ctx.speciesRoster, biomeWeights, rng);
  if (!species) return;

  const groupSize = MIN_GROUP_SIZE + Math.floor(rng() * (MAX_GROUP_SIZE - MIN_GROUP_SIZE + 1));
  // Real walkability search on every layer, not just Surface — Underground
  // (cellular-automata cave walls) and Canopy (derived-from-Surface walls,
  // CROPS_DESIGN.md) both now carve genuine unwalkable terrain too, the same
  // "no longer a plain flat grid" fix scenario.ts's own `undergroundAnchor`/
  // `canopyAnchor` already made for hand-placed scenario spawns. A raw
  // clamped `edgePos` could otherwise land an immigrant group directly
  // inside solid cave/canopy wall.
  const arrivalPos = findWalkableNear(world, species.homeLayer, edgePos.x, edgePos.y);

  // Obligate-aquatic species (`ImmigrationSpeciesInfo.obligateAquatic`, see
  // its own doc comment) need a real water tile, not merely a walkable one —
  // `findWalkableNear` treats the two as equally valid hits. Excludes each
  // already-picked tile so a `groupSize` > 1 arrival spreads across distinct
  // nearby water tiles instead of stacking every member on the exact same
  // one; falls back to whatever the last (possibly land) candidate was if
  // the map genuinely runs out of nearby distinct water tiles to offer —
  // vanishingly unlikely on a real generated map, and no worse than this
  // species' pre-feature placement in that edge case.
  const usedWaterTiles: Vec2[] = [];
  function nextArrivalPos(i: number): Vec2 {
    if (!species!.obligateAquatic) {
      return findWalkableNear(world, species!.homeLayer, arrivalPos.x + i, arrivalPos.y);
    }
    const waterPos = findNearestIndexed(world, "surface", arrivalPos, "water", usedWaterTiles) ?? arrivalPos;
    usedWaterTiles.push(waterPos);
    return waterPos;
  }

  const localAvgLevel = localAverageLevel(world, species.id);
  const newAgents: Agent[] = [];
  for (let i = 0; i < groupSize; i++) {
    const pos = nextArrivalPos(i);
    const agent = ctx.spawnAgent(species.id, `${species.id}-immigrant-${world.tick}-${i}`, pos, rollImmigrantLevel(species, rng, localAvgLevel), rng);
    agent.sex = rng() < 0.5 ? "male" : "female";
    newAgents.push(agent);
  }

  // Same join-or-found decision `dispersal.ts`'s `finishDispersal` makes on
  // arrival — checked against the first arrival only (mirroring that
  // module's own "first living member stands in for the herd" convention
  // used throughout herdMigration.ts too), then applied to every member of
  // this group so they land together as one herd from the start rather than
  // each independently re-deriving the same answer.
  const joinedHerd = findNearbyOtherHerd(world, newAgents[0]!);
  const herdId = joinedHerd ?? `${species.id}-immigrant-lineage-${world.tick}`;
  for (const agent of newAgents) {
    agent.herdId = herdId;
    agent.homePos = { ...agent.pos };
  }

  world.agents.push(...newAgents);
  world.lastImmigrationTick = world.tick;

  log?.record({
    kind: "immigrated",
    tick: world.tick,
    agentIds: newAgents.map((a) => a.id),
    species: species.id,
    layer: species.homeLayer,
    pos: newAgents[0]!.pos,
    herdId,
    outcome: joinedHerd ? "joined" : "founded",
  });
}
