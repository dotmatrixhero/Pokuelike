import type { Agent, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { biomeWeightsAt, findWalkableNear } from "./worldgen.js";
import { findNearbyOtherHerd } from "./dispersal.js";

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

/** The level immigrant agents arrive at — matches `createDemoWorld`'s own starting-agent level for the roster's non-guardian species (bulbasaur/diglett/sandshrew/pidgey/squirtle/charmander all spawn at 5), so an immigrant isn't mechanically distinguishable from a hand-placed starter. */
const IMMIGRANT_LEVEL = 5;

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

function pickImmigrantSpecies(world: World, roster: readonly ImmigrationSpeciesInfo[], biomeWeights: Record<string, number>, rng: () => number): ImmigrationSpeciesInfo | undefined {
  if (roster.length === 0) return undefined;

  const counts = new Map<string, number>();
  for (const agent of world.agents) {
    if (agent.alive === false) continue;
    counts.set(agent.species, (counts.get(agent.species) ?? 0) + 1);
  }

  const weights = roster.map((species) => {
    const repWeight = 1 / ((counts.get(species.id) ?? 0) + 1);
    let biomeMatch = 1;
    if (species.biomes && species.biomes.length > 0) {
      const matched = species.biomes.reduce((sum, name) => sum + (biomeWeights[name] ?? 0), 0);
      biomeMatch = Math.max(UNTAGGED_MATCH_FLOOR, matched);
    }
    return repWeight * biomeMatch;
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
  const arrivalPos =
    species.homeLayer === "surface"
      ? findWalkableNear(world, "surface", edgePos.x, edgePos.y)
      : { x: Math.min(world.width - 1, Math.max(0, Math.round(edgePos.x))), y: Math.min(world.height - 1, Math.max(0, Math.round(edgePos.y))) };

  const newAgents: Agent[] = [];
  for (let i = 0; i < groupSize; i++) {
    const pos =
      species.homeLayer === "surface"
        ? findWalkableNear(world, species.homeLayer, arrivalPos.x + i, arrivalPos.y)
        : { x: Math.min(world.width - 1, Math.max(0, arrivalPos.x + i)), y: arrivalPos.y };
    const agent = ctx.spawnAgent(species.id, `${species.id}-immigrant-${world.tick}-${i}`, pos, IMMIGRANT_LEVEL, rng);
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
