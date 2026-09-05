import type { Agent, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { logBehaviorChange } from "./events.js";
import { stepToward } from "./movement.js";
import { manhattan } from "./predation.js";
import { tileAt, setTile } from "./world.js";
import { herdCentroid } from "./herding.js";
import { findNearestIndexed } from "./resourceIndex.js";

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
 *
 * **Incentive to actually stay** (direct follow-up ask: "shelter should
 * also like give other buff too. Something that incentivizes the Pokémon
 * to stay in it. Maybe food cache and stuff") — two more real, composable
 * pieces on top of the three above, both gated the same `agent.buildsShelter`
 * way everything else here is:
 * 1. `applyShelterResting` — once idle (needs.ts's very last idle-tier
 *    check, after herd cohesion, replacing pure exploration for this
 *    species), a `buildsShelter` agent with a known shelter walks home to it
 *    instead of wandering, then genuinely lingers there: `tickAgentNeeds`
 *    applies `SHELTER_HEAL_MULTIPLIER`/`SHELTER_NEEDS_DECAY_MULTIPLIER`
 *    while within `SHELTER_REST_RADIUS` of any shelter tile — composing
 *    multiplicatively with sleep's own multipliers, the exact same
 *    `applyHealOverTime`/`decayNeeds` multiplier hooks sleep already
 *    established, just a real (smaller) bonus for being merely *home*
 *    rather than asleep.
 * 2. `Tile.cache` — the user's own named idea, a real food stockpile. Each
 *    tick spent actually resting there (not just passing through) deposits
 *    `SHELTER_CACHE_DEPOSIT_PER_TICK`, capped at `SHELTER_CACHE_MAX`; a
 *    genuinely hungry `buildsShelter` agent back home draws
 *    `SHELTER_CACHE_FEED_AMOUNT` from it before ever walking to a live food
 *    patch (`maybeFeedFromShelterCache`, called from needs.ts's `seekFood`
 *    branch). An empty cache is never a trap — it's checked and, if bare,
 *    falls straight through to the existing live-foraging path the same
 *    tick, so a hungry agent with nothing stored still breaks off to eat
 *    elsewhere exactly like every other "commits no matter what" fix this
 *    session already had to make for dispersal/shelter-building/food
 *    delivery.
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
 * How much `SHELTER_COMFORT_THRESHOLD` drops for a bonded, shelterless
 * agent — see `maybeTriggerShelterBuilding`'s doc comment. Sim-original
 * tuning guess, same "judge against a real run" convention as every other
 * constant in this file: big enough to be a real, measurable difference
 * (0.15 is nearly a fifth of the 0.0-1.0 needs range) without dropping the
 * bar so far a bonded pair starts building while still genuinely needy.
 */
const BOND_COMFORT_DISCOUNT = 0.15;

/**
 * Direct ask: "predators should have it easier to make shelter... species
 * dependent." Stacks additively with `BOND_COMFORT_DISCOUNT` (a bonded
 * predator gets both, dropping the effective trigger threshold to
 * 0.85 - 0.15 - 0.15 = 0.55) rather than replacing it — the two are
 * independent reasons to be more eager to build (partnered, and
 * population-starved), and this codebase's other stacking multipliers
 * (`SHELTER_HEAL_MULTIPLIER` x `SLEEP_HEAL_MULTIPLIER`, etc.) already
 * compose the same way. Same magnitude as `BOND_COMFORT_DISCOUNT` — this
 * session's other predator-fragility fixes (pack hunting, scavenging, a
 * bigger starting predator roster) all picked "a real, measurable
 * difference, not a token one" over a barely-there nudge, and 0.15 is
 * already established in this file as that bar. See DESIGN.md's
 * "Species-dependent shelter ease and egg-defense lethality" section for
 * the real-run validation this was judged against.
 */
const PREDATOR_COMFORT_DISCOUNT = 0.15;

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
 * Multiplier applied to `SHELTER_BUILD_TICKS` for a predator agent
 * (`agent.isPredator`) — the second concrete "easier to make shelter" lever,
 * alongside `PREDATOR_COMFORT_DISCOUNT` above: not just triggering a build
 * sooner, but actually finishing it faster once standing at the site. 0.5
 * (half the ordinary 40-tick investment, i.e. 20) is a real, obviously-
 * measurable difference without making a predator's shelter free/instant —
 * it still has to travel `SHELTER_MIN_BUILD_DISTANCE` and stand there
 * `buildersOwnTicks(agent)` real ticks, exposed to interruption the whole
 * time, same as anyone else. Sim-original tuning guess, judged against a
 * real run (see DESIGN.md).
 */
const PREDATOR_BUILD_TICKS_MULTIPLIER = 0.5;

/**
 * The real number of build ticks this specific agent needs to invest —
 * `SHELTER_BUILD_TICKS`, halved for a predator. Exported so tests can assert
 * the exact predator-vs-non-predator difference directly instead of
 * re-deriving it.
 */
export function builderShelterTicks(agent: Agent): number {
  return agent.isPredator ? Math.round(SHELTER_BUILD_TICKS * PREDATOR_BUILD_TICKS_MULTIPLIER) : SHELTER_BUILD_TICKS;
}

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

/**
 * True if a "shelter" tile exists within `radius` (Chebyshev) of `pos` on
 * `layer` — same bounded-box scan style as `weather.ts`'s `hasCoverNearby`/
 * flora.ts's `isNearSunbeam`. Exported (previously module-private) so
 * `tickAgentNeeds` (needs.ts) can gate the resting-at-home heal/needs-decay
 * bonus on it every tick, not just at trigger time.
 */
export function hasNearbyShelter(world: World, layer: Layer, pos: Vec2, radius: number): boolean {
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
  // Universal shelter (direct instruction: shelter is no longer species-tied
  // — "all units have it, it just looks different for each type") reverses
  // the earlier `agent.buildsShelter`-gated design: every species can now
  // build/use a shelter. `Agent.buildsShelter` still exists (denormalized
  // from data) but is no longer read here at all — see DESIGN.md's
  // "Universal shelter and capacity" section.
  //
  // A bonded, shelterless pair (reproduction.ts's `applyMateSeeking`) gets a
  // real, testable comfort discount, not just "now eligible": direct
  // instruction was that mating before shelter exists should "increase need
  // for shelter." `BOND_COMFORT_DISCOUNT` lowers the bar at which this
  // agent's own hunger/thirst counts as "comfortable enough to build,"
  // biasing a bonded agent toward starting a build measurably sooner (in
  // expectation, across many idle ticks where hunger/thirst are still
  // climbing back up) than an unbonded one would at the exact same needs.
  // Direct ask: "predators should have it easier to make shelter... species
  // dependent." Stacks with the bonded discount above rather than
  // replacing it — see `PREDATOR_COMFORT_DISCOUNT`'s own doc comment.
  let threshold = SHELTER_COMFORT_THRESHOLD;
  if (agent.bondedPartnerId) threshold -= BOND_COMFORT_DISCOUNT;
  if (agent.isPredator) threshold -= PREDATOR_COMFORT_DISCOUNT;
  if (agent.needs.hunger < threshold || agent.needs.thirst < threshold) return;

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
  if (agent.shelterBuildTicks < builderShelterTicks(agent)) return;

  setTile(world, agent.layer, agent.pos.x, agent.pos.y, "shelter");
  // Cosmetic-only rendering hint (point 1: universal mechanics, per-species
  // look) — see `Tile.shelterOwnerSpecies`'s doc comment.
  const tileNow = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
  if (tileNow) tileNow.shelterOwnerSpecies = agent.species;
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

// --- Incentive to stay: resting-at-home buffs + food cache ---
// See this file's top-of-file doc comment ("Incentive to actually stay")
// for the full design; everything below is the implementation of that.

/**
 * How close (Chebyshev, matching `SHELTER_ABANDON_RADIUS`'s own convention)
 * counts as "home" for the resting bonus/cache deposit/cache withdrawal —
 * deliberately much tighter than `SHELTER_ABANDON_RADIUS` (6) or
 * `SHELTER_SEARCH_RADIUS` (15): those answer "is a shelter part of this
 * herd's home range at all," this answers "is this agent standing right
 * there, actually resting" — the whole point of a *proximity* buff.
 */
export const SHELTER_REST_RADIUS = 2;

/**
 * Per-tick HP heal multiplier while within `SHELTER_REST_RADIUS` of any
 * shelter tile — composes multiplicatively with `needs.ts`'s
 * `SLEEP_HEAL_MULTIPLIER` via `applyHealOverTime`'s existing multiplier
 * parameter (an agent asleep at its own shelter heals fastest of all,
 * exactly as it should). Picked below sleep's own 3x: this is a passive
 * "you're safe and comfortable" bonus for merely being home, not the much
 * bigger commitment/vulnerability trade sleep represents — a real,
 * noticeable difference from the flat 1x baseline without eclipsing why
 * sleep is worth the "sitting duck" risk. Sim-original tuning guess, judge
 * against a real run like every other constant in this file.
 */
export const SHELTER_HEAL_MULTIPLIER = 2;

/**
 * Hunger/thirst decay multiplier while within `SHELTER_REST_RADIUS` of any
 * shelter tile — composes multiplicatively with sleep's own
 * `SLEEP_NEEDS_DECAY_MULTIPLIER` inside `decayNeeds` (needs.ts). Deliberately
 * a much smaller reduction than sleep's 0.15: this fires for a merely-idle,
 * fully-awake agent (no "sitting duck" vulnerability traded away for it),
 * so it should read as "a real perk of home," not sleep's "dramatically
 * reduced, real cost to oversleeping" territory duplicated for free.
 */
export const SHELTER_NEEDS_DECAY_MULTIPLIER = 0.6;

/** Ceiling on `Tile.cache` — roughly `SHELTER_CACHE_FEED_AMOUNT`'s own 3 feedings' worth, the same "a patch has about 3 feedings in it" order of magnitude flora.ts's `CONSUME_STOCK_AMOUNT` establishes for live food. */
export const SHELTER_CACHE_MAX = 1.2;

/**
 * How much `Tile.cache` grows per tick of genuine resting (not just
 * traveling home) — same order of magnitude as `support.ts`'s
 * `HEAL_PER_TICK_FRACTION` (0.01): a slow, real accumulation, not
 * instant — filling the cache from empty to `SHELTER_CACHE_MAX` takes on
 * the order of 120 ticks of actual continuous resting, comparable to
 * `SHELTER_BUILD_TICKS` (40) itself, so it reads as a genuine second
 * investment on top of the build, not something that fills itself
 * overnight.
 */
export const SHELTER_CACHE_DEPOSIT_PER_TICK = 0.01;

/**
 * How much hunger a single cache withdrawal restores — deliberately
 * identical to needs.ts's own `CONSUME_RATE.seekFood.amount` (0.4), same
 * "delivered/stored food restores exactly what self-feeding would"
 * precedent support.ts's `DELIVERED_FOOD_HUNGER_RESTORE` already
 * established for herd food delivery. A withdrawal that's smaller than the
 * remaining cache still restores the full amount; one bigger than what's
 * left restores only what's actually there (see
 * `maybeFeedFromShelterCache`) — no free hunger from an empty or
 * near-empty cache.
 */
export const SHELTER_CACHE_FEED_AMOUNT = 0.4;

/**
 * Once genuinely idle (needs.ts's very last idle-tier check, after herd
 * cohesion gets first refusal — a herd pulling an agent back together still
 * wins over going home specifically), a `buildsShelter` agent with a known
 * shelter walks to it instead of wandering off exploring, then genuinely
 * lingers there once arrived — logged as `"restAtShelter"`
 * (`BehaviorKind`), the real, legible-in-the-log signal that this agent
 * chose to go home rather than just happening to be standing near a
 * shelter for some other reason. Returns false (letting the caller fall
 * back to ordinary exploration) only when this agent's herd genuinely has
 * no shelter anywhere findable yet — never once one exists, so from that
 * point on a `buildsShelter` agent's idle time is spent at home rather than
 * wandering, which is the actual "incentivize... to stay in it" ask.
 *
 * Only ever called from needs.ts's idle tier (`chooseBehavior` already
 * reads "idle"), so an agent reaching here is already fed/watered above
 * `FED_THRESHOLD` by construction — no separate "well-fed enough to
 * contribute to the cache" gate is needed the way `applyHerdSupport`'s own
 * `isFedAndWatered` check needs one (that function can be reached from
 * behaviors other than pure idle).
 */
export function applyShelterResting(world: World, agent: Agent, log?: EventLog): boolean {
  const home = findNearestIndexed(world, agent.layer, agent.pos, "shelter");
  if (!home) return false; // no shelter built yet anywhere nearby -- nothing to go home to

  logBehaviorChange(log, world, agent, "restAtShelter");
  agent.behavior = "restAtShelter";

  if (manhattan(agent.pos, home) > SHELTER_REST_RADIUS) {
    agent.pos = stepToward(world, agent.layer, agent.pos, home);
    return true;
  }

  // Arrived (or already close by) -- genuinely resting, not just passing
  // through. Deposits into the cache every tick spent here, capped at
  // SHELTER_CACHE_MAX; the heal/needs-decay bonus itself is applied
  // separately, every tick, by tickAgentNeeds's own hasNearbyShelter check
  // (not gated on this specific behavior label, so it still applies on the
  // rarer tick an agent happens to be home for some other reason).
  const tile = tileAt(world, agent.layer, home.x, home.y);
  if (tile?.cache !== undefined && tile.cache < SHELTER_CACHE_MAX) {
    const deposit = Math.min(SHELTER_CACHE_DEPOSIT_PER_TICK, SHELTER_CACHE_MAX - tile.cache);
    tile.cache += deposit;
    world.shelterCacheDeposited = (world.shelterCacheDeposited ?? 0) + deposit;
  }
  return true;
}

/**
 * The food-cache safety net itself — called from needs.ts's `seekFood`
 * branch, ahead of the ordinary live-food search, only for a
 * `buildsShelter` agent whose `chooseBehavior` already picked `"seekFood"`
 * (i.e. genuinely hungry, per `chooseBehavior`'s own 0.3 urgency cutoff).
 * Deliberately NOT gated on the agent already being mid-`"restAtShelter"` —
 * a hungry agent that happens to already be standing within
 * `SHELTER_REST_RADIUS` of its shelter (having just walked home, or simply
 * gotten hungry while resting there) should eat from the stockpile before
 * setting off across the map, which is exactly the "safety net during a
 * real lean period" the cache exists for.
 *
 * Returns false (never touching `needs.hunger`) whenever there's nothing to
 * draw on — no shelter within range, or one with an empty/undefined
 * `cache` — so the caller falls straight through to the existing
 * live-foraging path the same tick. This is the load-bearing "not a trap"
 * guarantee: an agent is never made to wait on, or prefer, an empty cache
 * over breaking off to actually eat.
 */
export function maybeFeedFromShelterCache(world: World, agent: Agent, log?: EventLog): boolean {
  const home = findNearestIndexed(world, agent.layer, agent.pos, "shelter");
  if (!home || manhattan(agent.pos, home) > SHELTER_REST_RADIUS) return false;

  const tile = tileAt(world, agent.layer, home.x, home.y);
  if (!tile?.cache) return false; // 0 or undefined -- nothing stored, forage normally instead

  const restore = Math.min(SHELTER_CACHE_FEED_AMOUNT, tile.cache);
  tile.cache -= restore;
  agent.needs.hunger = Math.min(1, agent.needs.hunger + restore);
  world.shelterCacheWithdrawn = (world.shelterCacheWithdrawn ?? 0) + restore;

  logBehaviorChange(log, world, agent, "restAtShelter");
  agent.behavior = "restAtShelter";
  return true;
}
