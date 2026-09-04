import type { Agent, DispersalReason, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { logBehaviorChange } from "./events.js";
import { stepToward } from "./movement.js";
import { findRandomWalkableTile } from "./migration.js";
import { isMature, MATURITY_AGE } from "./reproduction.js";
import { COHESION_DISTANCE } from "./herding.js";

/**
 * Natal dispersal — see DESIGN.md's "Natal dispersal: real biology's actual
 * fix for the inbreeding bottleneck" section. A confirmed A/B test (seed 42,
 * `isRelated` disabled vs. not) showed inbreeding avoidance genuinely
 * starves the mate pool for the first ~1800 of a 3000-tick run with only 2
 * founding pairs (population 65 vs. 98 at tick 3000, 9 vs. 40 by tick 1800).
 * The fix isn't more genealogical bookkeeping — it's the real mechanism
 * biology actually uses: a maturing individual leaves its birth group and
 * finds mates elsewhere, so the mate pool isn't a single fixed population
 * forever.
 *
 * Two triggers, both routed through the same relocate-then-join-or-found
 * mechanism below:
 * 1. `maybeTriggerDispersal`'s disposition-weighted roll, at the tick an
 *    agent crosses `MATURITY_AGE` or the tick it evolves (leveling.ts sets
 *    `Agent.pendingEvolutionDispersalCheck`) — the flavorful trait DESIGN.md
 *    and TODO.md's original "Evolution as a dispersal trigger" pitch asked
 *    for, reusing the existing boldness/sociability Disposition axes exactly
 *    like predation.ts's flee/hunt thresholds and reproduction.ts's
 *    mate-search radius already do.
 * 2. The guaranteed fallback in that same function: an agent that's gone
 *    `NO_MATES_DISPERSAL_TICKS` sustained ticks mature with zero eligible
 *    mate candidates found nearby disperses regardless of the disposition
 *    roll. This is the one that actually guarantees the mechanical
 *    bottleneck gets solved even for a disposition roll that never favors
 *    it (e.g. a fully timid, fully social agent scores 0 on trigger 1,
 *    forever) — shipping only the flavorful trigger would fix the problem
 *    by luck, not by design.
 *
 * Relocation reuses `migration.ts`'s existing "walk to a random distant
 * point" utility (`findRandomWalkableTile`) rather than `herdMigration.ts`'s
 * resource-aware `pickDestination` — that machinery is built and scored
 * around a whole *herd's* shared centroid/abundance, whereas a single
 * disperser leaving its herd behind has no herd-level resource context left
 * to score against once it's alone; `migrate()`'s simpler "distant random
 * point" is the actual fit for an individual (this module keeps its own
 * `dispersalTarget` field rather than calling `migrate()` itself, since that
 * function hardcodes `agent.behavior = "relocate"` and has no join-or-found
 * step — see `Agent.dispersalTarget`'s doc comment).
 */

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Neutral (0.5 boldness / 0.5 sociability) per-occasion chance for trigger 1
 * — see `dispersalChance`. Sim-original tuning guess, like every other magic
 * number in this codebase: judge against a real run (see DESIGN.md), not
 * canon. Picked high enough that a real fraction of a herd's matured/evolved
 * individuals actually leave within a several-thousand-tick run rather than
 * this reading as a never-fires flavor mechanic.
 */
export const DISPERSAL_BASE_CHANCE = 0.3;

/**
 * Disposition-weighted chance to disperse when trigger 1 fires (maturity
 * crossing or evolving). Bolder, less-sociable individuals disperse more
 * readily — real biology (bolder/more solitary temperaments are the ones
 * that actually strike out from the group), and the same two Disposition
 * axes already driving predation.ts's flee/hunt thresholds and
 * reproduction.ts's mate-search radius, not a new parallel trait.
 * `factor = boldness + (1 - sociability)` ranges 0..2: neutral (0.5/0.5)
 * gives factor 1 -> exactly `DISPERSAL_BASE_CHANCE`; fully bold+solitary
 * (1/0) gives factor 2 -> double that; fully timid+social (0/1) gives factor
 * 0 -> this trigger never fires for that individual at all (it still has the
 * guaranteed no-mates fallback below as a backstop). Sim-original mapping,
 * explicitly flagged open in DESIGN.md — not canon.
 */
function dispersalChance(agent: Agent): number {
  const boldness = agent.disposition?.boldness ?? 0.5;
  const sociability = agent.disposition?.sociability ?? 0.5;
  const factor = boldness + (1 - sociability);
  return Math.min(1, DISPERSAL_BASE_CHANCE * factor);
}

/**
 * Consecutive ticks a mature, sexed agent must go with zero eligible mate
 * candidates found nearby (`Agent.ticksSinceEligibleMate`, maintained by
 * reproduction.ts's `applyMateSeeking`) before the guaranteed fallback
 * trigger fires regardless of the disposition roll. Mirrors this codebase's
 * existing "sustained, not a single bad tick" pattern (e.g.
 * `herdMigration.ts`'s `SCARCITY_SUSTAIN_TICKS`/`PREDATOR_PRESSURE_WINDOW_TICKS`,
 * `needs.ts`'s `MIGRATE_AFTER_TICKS`) at a similar order of magnitude, judged
 * against how long the confirmed A/B test showed the mate pool actually
 * stays starved (up to ~1800 ticks) — 300 is short enough relative to that
 * to matter across a real run's early game, not so short a single unlucky
 * gap of candidates being briefly out of range triggers it. Sim-original
 * tuning guess, explicitly flagged open in DESIGN.md.
 */
export const NO_MATES_DISPERSAL_TICKS = 1000;

/**
 * How close another same-species herd's member must land to a disperser's
 * arrival point to count as "found nearby, join it" rather than "found
 * nothing, found a new one." 3x `herding.ts`'s `COHESION_DISTANCE` — wide
 * enough that landing genuinely within an existing herd's home range counts,
 * without being so wide that a disperser five separate roaming groups away
 * spuriously "joins" one it never actually encountered.
 */
const JOIN_HERD_RADIUS = 3 * COHESION_DISTANCE;

/**
 * How many ticks past `MATURITY_AGE` still count as "just crossed it," for
 * `maybeTriggerDispersal`'s one-shot maturity check. Needed because an
 * agent's action tick (where this check runs) doesn't necessarily land on
 * the exact tick its age crosses the threshold — `tickAgentNeeds` ages every
 * agent every world tick regardless of Speed, but `tickAgentAction` (and
 * this check with it) only runs on that agent's own action tick, which for
 * a slower agent can trail several ticks behind. Generously larger than any
 * real action-tick gap in the demo roster (`simulation.ts`'s
 * `ACTION_THRESHOLD` doc comment: the slowest demo species acts roughly
 * every 4-5 ticks) so a real, organically-aged agent is never missed, while
 * still excluding a hand-built fixture given a large fixed `age` (500, say,
 * a common test convenience for "already mature") purely to skip past
 * `isMature`'s check — that agent didn't just cross anything, it started
 * mature, so it correctly gets no maturity-crossing roll at all (only the
 * on-evolve occasion and the guaranteed no-mates fallback remain available
 * to it).
 */
const MATURITY_CROSSING_WINDOW_TICKS = 30;

/**
 * Checked once per action tick for every living, sexed agent not already
 * dispersing (see needs.ts's `tickAgentAction`) — never re-rolls or
 * re-triggers while `Agent.dispersalTarget` is already set, so an
 * in-progress dispersal is never double-triggered. Genderless agents
 * (`!agent.sex`) are skipped entirely — dispersal exists to solve a
 * mate-finding problem, so it has nothing to do for an agent that never
 * seeks a mate at all.
 */
export function maybeTriggerDispersal(world: World, agent: Agent, log: EventLog | undefined, rng: () => number): void {
  if (agent.dispersalTarget) return;
  if (!agent.sex) return;

  // Trigger 1's evolution occasion — a one-tick flag set by leveling.ts's
  // grantExp the instant an evolution happens, consumed here (win or lose)
  // so an evolution always gets exactly one roll.
  const justEvolved = agent.pendingEvolutionDispersalCheck === true;
  agent.pendingEvolutionDispersalCheck = undefined;

  // Trigger 1's maturity occasion — a one-shot flag rather than an exact
  // `agent.age === MATURITY_AGE` equality check: under the Speed-driven
  // action economy (simulation.ts), an agent's action tick doesn't
  // necessarily land on the exact tick its age crosses the threshold (needs
  // decay/aging happen every tick regardless of Speed), so equality could
  // silently miss the window forever for a slower agent. `age === undefined`
  // agents (founders spawned directly into a scenario — see `isMature`'s doc
  // comment) never set this: there's no real "crossing" to detect for an
  // agent that was already mature from the moment it existed, so they rely
  // on the on-evolve occasion and the guaranteed fallback below instead.
  let crossedMaturity = false;
  if (agent.age !== undefined && agent.age >= MATURITY_AGE && !agent.maturityDispersalRolled) {
    if (agent.age <= MATURITY_AGE + MATURITY_CROSSING_WINDOW_TICKS) crossedMaturity = true;
    agent.maturityDispersalRolled = true; // consumed either way — a fixture that started already well past maturity never gets a maturity-crossing roll, only the on-evolve/no-mates triggers remain
  }

  if ((crossedMaturity || justEvolved) && rng() < dispersalChance(agent)) {
    startDispersal(world, agent, "matured", rng);
    return;
  }

  // Trigger 2, the guaranteed fallback — independent of whether trigger 1
  // fired or even applies to this agent at all this tick.
  if (isMature(agent) && (agent.ticksSinceEligibleMate ?? 0) >= NO_MATES_DISPERSAL_TICKS) {
    startDispersal(world, agent, "no_eligible_mates", rng);
  }
}

function startDispersal(world: World, agent: Agent, reason: DispersalReason, rng: () => number): void {
  const target = findRandomWalkableTile(world, agent.layer, agent.pos, rng);
  // Nowhere reachable to disperse to this tick (e.g. a fully boxed-in map) —
  // stay put rather than getting stuck in a half-triggered state; trigger 1
  // won't get another shot until the next maturity/evolution occasion (rare
  // enough this doesn't need its own retry loop), and trigger 2 simply tries
  // again on `agent`'s next action tick since `ticksSinceEligibleMate` isn't
  // touched here.
  if (!target) return;
  agent.dispersalTarget = target;
  agent.dispersalReason = reason;
  // A fresh start — the no-mates counter shouldn't immediately re-fire
  // mid-walk just because the agent hasn't found a mate while traveling.
  agent.ticksSinceEligibleMate = 0;
}

/**
 * Continues (or starts moving toward) an already-triggered dispersal — see
 * needs.ts's `tickAgentAction`, which calls this whenever
 * `Agent.dispersalTarget` is set, ahead of ordinary needs-driven behavior
 * (ranked below survival instincts/carrying/looting/herd support, same
 * priority slot `applyExploration`'s continuation occupies, but checked
 * first since a dispersal in progress takes priority over idle exploring).
 */
export function applyDispersal(world: World, agent: Agent, log?: EventLog): void {
  if (!agent.dispersalTarget) return;

  logBehaviorChange(log, world, agent, "disperse");
  agent.behavior = "disperse";

  if (manhattan(agent.pos, agent.dispersalTarget) <= 1) {
    agent.pos = agent.dispersalTarget;
    agent.dispersalTarget = undefined;
    finishDispersal(world, agent, log);
    return;
  }

  agent.pos = stepToward(world, agent.layer, agent.pos, agent.dispersalTarget);
}

/**
 * Same-species, same-layer, living herd-mate-to-be within `JOIN_HERD_RADIUS`
 * of the disperser's arrival point, if any — scans `world.agents` directly
 * rather than any separate herd registry, matching how every other
 * herd-aware system in this codebase (herdMigration.ts's
 * `herdLayer`/`herdSpecies`/`herdSize`, herding.ts's `herdCentroid`) already
 * derives its herd list: a brand new `herdId` this function assigns just
 * works as a new entry the moment it's on an agent, no pre-registration
 * needed anywhere.
 */
function findNearbyOtherHerd(world: World, agent: Agent): string | undefined {
  for (const other of world.agents) {
    if (other.id === agent.id || other.alive === false) continue;
    if (other.species !== agent.species || other.layer !== agent.layer) continue;
    if (!other.herdId || other.herdId === agent.herdId) continue;
    if (manhattan(agent.pos, other.pos) > JOIN_HERD_RADIUS) continue;
    return other.herdId;
  }
  return undefined;
}

/**
 * On arrival: join an existing other herd of this species found nearby, or
 * found a brand new one. The new `herdId` (when founding) incorporates the
 * agent's own id and the current tick, so it can't collide with any other
 * herd, past or future, without needing a separate id-allocation registry —
 * consistent with the "scan `world.agents`, no registry" derivation every
 * other herd-aware system already relies on (see `findNearbyOtherHerd`'s
 * doc comment). In the demo scenario specifically, there's only ever one
 * herd per species at world-gen time (packages/data/src/scenario.ts), so in
 * practice most dispersals found new herds rather than join one — expected
 * and fine: that's exactly the "seed multiple independent lineages across
 * the map" payoff DESIGN.md describes, not a sign joining is unreachable
 * (two independently-founded herds of the same species can still end up
 * close enough for a later disperser to join one, or for the existing
 * territorial-displacement migration trigger to notice them).
 */
function finishDispersal(world: World, agent: Agent, log?: EventLog): void {
  const fromHerd = agent.herdId;
  const joinedHerd = findNearbyOtherHerd(world, agent);
  const toHerd = joinedHerd ?? `${agent.species}-lineage-${agent.id}-${world.tick}`;
  agent.herdId = toHerd;
  // A founder's/joiner's new home range starts here, not wherever it was
  // born — see `Agent.homePos`'s doc comment (carryAlly's rescue destination
  // and a newborn's spawn anchor both already treat homePos as "where this
  // agent's group currently calls home," not a birthplace that never moves).
  agent.homePos = { ...agent.pos };
  log?.record({
    kind: "dispersed",
    tick: world.tick,
    agentId: agent.id,
    species: agent.species,
    fromHerd: fromHerd ?? "none",
    toHerd,
    outcome: joinedHerd ? "joined" : "founded",
    reason: agent.dispersalReason ?? "matured",
  });
  agent.dispersalReason = undefined;
}
