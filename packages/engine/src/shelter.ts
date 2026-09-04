import type { Agent, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { logBehaviorChange } from "./events.js";
import { stepToward } from "./movement.js";
import { manhattan } from "./predation.js";
import { tileAt, setTile } from "./world.js";
import { herdCentroid } from "./herding.js";

/**
 * Shelter-building — see DESIGN.md's "Shelter-building" section. A real
 * spatial task for `buildsShelter`-flagged species (`Agent.buildsShelter`,
 * denormalized from `SpeciesDef.buildsShelter` at spawn — the same
 * "engine reads a plain boolean off the agent, never imports
 * `@pokuelike/data`" pattern `activityPattern` already established, since
 * `@pokuelike/data` itself depends on `@pokuelike/engine`).
 *
 * Three real steps, reusing existing machinery at every one (per direct
 * instruction — "reuse both existing mechanisms rather than inventing new
 * ones" applies just as much to the travel/investment shape as to the
 * concealment/storm-exposure payoffs):
 * 1. `maybeTriggerShelterBuilding` — an eligible, genuinely comfortable
 *    agent (`SHELTER_COMFORT_THRESHOLD`, well past merely-idle) whose herd
 *    has no shelter tile within `SHELTER_SEARCH_RADIUS` picks a build site
 *    at least `SHELTER_MIN_BUILD_DISTANCE` away from its *own* current
 *    position (not the herd centroid) so this specific agent actually has
 *    to travel, not just "the herd already has one nearby."
 * 2. `applyShelterBuilding`'s travel phase — steps toward `shelterTarget`
 *    one tile per action tick via `stepToward`, the exact same "walk it
 *    down over however many ticks it takes" shape as `migrate()`/
 *    `applyDispersal()`.
 * 3. `applyShelterBuilding`'s construction phase, once `agent.pos` reaches
 *    `shelterTarget` — spends `SHELTER_BUILD_TICKS` real action ticks
 *    standing there (tracked by `Agent.shelterBuildTicks`) before the tile
 *    actually becomes `"shelter"` — not instant on arrival.
 *
 * Unlike `dispersal.ts`'s "commits no matter what, real risk-taking" once
 * started, this task is **pausable**: needs.ts's `tickAgentAction` only
 * continues it while `chooseBehavior(agent.needs)` still reads `"idle"`,
 * falling through to ordinary needs-driven behavior (without discarding
 * `shelterTarget`/`shelterBuildTicks`) the instant something more urgent
 * shows up, then resuming later once satisfied again. This is a direct,
 * confirmed-by-a-real-run correction, not a hypothetical: an earlier,
 * dispersal-shaped "runs to completion regardless" version of this feature
 * wiped out every `buildsShelter` founder (2 Diglett, 2 Sandshrew) in the
 * demo scenario within the first ~170 ticks of a seed-42 run — three
 * starved mid-build (the round trip plus build time routinely outlasts the
 * ~150-200 tick starvation window), the fourth got caught by a predator
 * while stranded at a build site far from any cover. Direct instruction
 * ("not overriding survival instincts") already called for this; the run
 * just confirmed how sharply "not overriding" actually mattered here versus
 * `dispersal.ts`'s comparatively short, one-off relocation, and see
 * DESIGN.md's real-run findings for the numbers.
 *
 * Build-site scoring is deliberately the simpler of DESIGN.md's two
 * offered options (a plain distance-floor random pick, not
 * herdMigration.ts's resource/cover-aware `pickDestination`): a shelter's
 * value comes from concealment/storm-exposure at its *own* tile, not from
 * abundance at the destination the way a migration or dispersal target's
 * value does, so `pickDestination`'s abundance-sampling scoring would be
 * scoring the wrong signal here — a plain "far enough, and still bare
 * floor" search is the actual fit, not a shortcut around a harder problem.
 */

/**
 * How far (Chebyshev) around a herd's anchor point counts as "already has a
 * shelter, don't build another" — reuses `dispersal.ts`'s
 * `JOIN_HERD_RADIUS` magnitude (3x `COHESION_DISTANCE`) rather than
 * inventing a third herd-scale radius: both answer the same underlying
 * question ("is this within the herd's real home range"), just for
 * different purposes.
 */
export const SHELTER_SEARCH_RADIUS = 15;

/**
 * Minimum Manhattan distance from a builder's current position to its
 * chosen build site — forces the "real spatial task, not build-on-the-spot"
 * DESIGN.md asks for. Matches `migration.ts`'s `MIN_RELOCATE_DISTANCE`
 * exactly: both exist for the identical reason (make a relocation-flavored
 * behavior actually relocate), so there's no principled reason for this
 * feature's floor to differ.
 */
export const SHELTER_MIN_BUILD_DISTANCE = 8;

/** How many random candidate sites to try before giving up for this tick — mirrors `migration.ts`'s `RELOCATE_ATTEMPTS`. */
const SHELTER_SITE_ATTEMPTS = 10;

/**
 * Hunger/thirst floor for *triggering* a new build — direct feedback:
 * shelter-building is "sorta a nice-to-have," so it should only be
 * something a genuinely comfortable agent takes on, not merely one that
 * isn't in active crisis. `needs.ts`'s ordinary "idle" behavior (the state
 * `maybeTriggerShelterBuilding` is only ever called from) already requires
 * hunger/thirst above `chooseBehavior`'s 0.7 urgency cutoff — this raises
 * the bar well past that, so an agent with real but modest slack in its
 * needs (comfortable, not starving) still waits rather than committing real
 * travel time to something optional. Deliberately not applied to
 * *continuing* an already-started build (`applyShelterBuilding`/needs.ts's
 * pause-on-urgent-need logic already handles bailing out mid-build if
 * things turn bad) — this constant only gates whether a new one starts.
 */
const SHELTER_COMFORT_THRESHOLD = 0.85;

/**
 * Real multi-tick time investment once standing at the build site, before
 * the tile actually completes — sim-original tuning guess, same order of
 * magnitude as `flora.ts`'s `MATURATION_TICKS` (20): long enough to read as
 * genuine construction effort (an agent can be interrupted mid-build by a
 * predator, since survival instincts are still checked ahead of this in
 * needs.ts's `tickAgentAction`), short enough that a single dedicated
 * builder finishes well within the run lengths this codebase actually
 * tests at. Judge against a real run like every other tuning constant here.
 */
export const SHELTER_BUILD_TICKS = 40;

/**
 * How far (Chebyshev) around a shelter tile counts as "still in use" for
 * abandonment purposes — see `decayShelters`. A little wider than
 * `weather.ts`'s `COVER_SCAN_RADIUS` (3): a shelter should read as
 * abandoned only once nothing's using it as a real home base, not the
 * instant its builder happens to wander off foraging.
 */
export const SHELTER_ABANDON_RADIUS = 6;

/**
 * Consecutive ticks a shelter tile must sit with zero living agents within
 * `SHELTER_ABANDON_RADIUS` before it reverts to "floor" — same "long
 * sustained stretch, not a single unlucky gap" reasoning as every other
 * sustained-counter constant in this codebase (`herdMigration.ts`'s
 * `STORM_EXPOSURE_SUSTAIN_TICKS`/`SCARCITY_SUSTAIN_TICKS`,
 * `dispersal.ts`'s `NO_MATES_DISPERSAL_TICKS`), picked long relative to
 * `SHELTER_BUILD_TICKS` so a shelter doesn't decay away almost as fast as
 * it was built, but short enough to actually revert within a several
 * -thousand-tick run rather than accumulating forever. Sim-original
 * tuning guess, judge against a real run.
 */
export const SHELTER_ABANDON_TICKS = 600;

/** True if a "shelter" tile exists within `radius` (Chebyshev) of `pos` on `layer` — same bounded-box scan style as `weather.ts`'s `hasCoverNearby`/flora.ts's `isNearSunbeam`. */
function hasNearbyShelter(world: World, layer: Layer, pos: Vec2, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (tileAt(world, layer, pos.x + dx, pos.y + dy)?.terrain === "shelter") return true;
    }
  }
  return false;
}

/**
 * A random candidate at least `SHELTER_MIN_BUILD_DISTANCE` from `from` whose
 * tile is still bare "floor" (so a completed shelter never silently
 * overwrites food/water/another structure) — same shape as `migration.ts`'s
 * `findRandomWalkableTile`, with the extra floor-only constraint a build
 * site (unlike an ordinary relocation destination) actually needs.
 */
function pickBuildSite(world: World, layer: Layer, from: Vec2, rng: () => number): Vec2 | undefined {
  for (let i = 0; i < SHELTER_SITE_ATTEMPTS; i++) {
    const candidate = { x: Math.floor(rng() * world.width), y: Math.floor(rng() * world.height) };
    if (manhattan(candidate, from) < SHELTER_MIN_BUILD_DISTANCE) continue;
    if (tileAt(world, layer, candidate.x, candidate.y)?.terrain === "floor") return candidate;
  }
  return undefined;
}

/**
 * Checked once per action tick for every living agent not already mid-build
 * (see needs.ts's `tickAgentAction`), only once the agent is otherwise idle
 * (no urgent need) — a settled, satisfied agent is the one that goes off to
 * build, not one mid-hunger-crisis. Never re-picks a site while
 * `agent.shelterTarget` is already set.
 */
export function maybeTriggerShelterBuilding(world: World, agent: Agent, rng: () => number): void {
  if (agent.shelterTarget) return;
  if (!agent.buildsShelter) return;
  if (agent.needs.hunger < SHELTER_COMFORT_THRESHOLD || agent.needs.thirst < SHELTER_COMFORT_THRESHOLD) return;

  const anchor = agent.herdId ? (herdCentroid(world, agent.herdId, agent.layer) ?? agent.pos) : agent.pos;
  if (hasNearbyShelter(world, agent.layer, anchor, SHELTER_SEARCH_RADIUS)) return;

  const site = pickBuildSite(world, agent.layer, agent.pos, rng);
  if (!site) return; // nowhere reachable this tick — next idle tick tries again
  agent.shelterTarget = site;
  agent.shelterBuildTicks = 0;
}

/**
 * Continues (or starts moving toward) an already-triggered shelter task —
 * travel via `stepToward` exactly like `applyDispersal`/`migrate()`, then a
 * real `SHELTER_BUILD_TICKS`-tick investment once arrived. Cancels (clears
 * `shelterTarget`, no event, no penalty) if the site stopped being bare
 * floor by the time this agent got there — something else (flora growth,
 * another builder) claimed it first; the agent simply retries with a fresh
 * site on its next idle tick via `maybeTriggerShelterBuilding`.
 */
export function applyShelterBuilding(world: World, agent: Agent, log?: EventLog): void {
  if (!agent.shelterTarget) return;

  logBehaviorChange(log, world, agent, "buildShelter");
  agent.behavior = "buildShelter";

  if (agent.pos.x !== agent.shelterTarget.x || agent.pos.y !== agent.shelterTarget.y) {
    agent.pos = stepToward(world, agent.layer, agent.pos, agent.shelterTarget);
    return;
  }

  const tile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
  if (tile?.terrain !== "floor") {
    // Site got claimed by something else while this agent was traveling —
    // give up on it silently, a fresh site gets picked on the next idle tick.
    agent.shelterTarget = undefined;
    agent.shelterBuildTicks = undefined;
    return;
  }

  agent.shelterBuildTicks = (agent.shelterBuildTicks ?? 0) + 1;
  if (agent.shelterBuildTicks < SHELTER_BUILD_TICKS) return;

  setTile(world, agent.layer, agent.pos.x, agent.pos.y, "shelter");
  log?.record({
    kind: "shelterBuilt",
    tick: world.tick,
    agentId: agent.id,
    species: agent.species,
    herdId: agent.herdId,
    layer: agent.layer,
    pos: { ...agent.pos },
  });
  agent.shelterTarget = undefined;
  agent.shelterBuildTicks = undefined;
}

/**
 * Once per world tick (see simulation.ts's `tickWorld`), not once per
 * agent — same "world-level system, one pass" style as `growFlora`. Scans
 * every layer's tiles for `"shelter"`, and for each one still standing,
 * checks whether any living agent is within `SHELTER_ABANDON_RADIUS`;
 * resets `Tile.vacantTicks` to 0 if so, increments it otherwise, and
 * reverts the tile to `"floor"` once it crosses `SHELTER_ABANDON_TICKS` —
 * the exact same tile-level counter/reset-on-recovery shape flora.ts's
 * stock decay and herdMigration.ts's sustained-counter triggers already
 * use, just for "how long alone" instead of "how much life left."
 */
export function decayShelters(world: World, log?: EventLog): void {
  for (const layer of Object.keys(world.tiles) as Layer[]) {
    const tiles = world.tiles[layer];
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]!;
      if (tile.terrain !== "shelter") continue;

      const pos = { x: i % world.width, y: Math.floor(i / world.width) };
      const occupied = world.agents.some(
        (agent) => agent.alive !== false && agent.layer === layer && manhattan(agent.pos, pos) <= SHELTER_ABANDON_RADIUS
      );
      tile.vacantTicks = occupied ? 0 : (tile.vacantTicks ?? 0) + 1;

      if (tile.vacantTicks < SHELTER_ABANDON_TICKS) continue;

      setTile(world, layer, pos.x, pos.y, "floor");
      log?.record({ kind: "shelterAbandoned", tick: world.tick, layer, pos });
    }
  }
}
