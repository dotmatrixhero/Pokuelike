import type { Agent, NotableTitleId, World } from "./types.js";
import type { EventLog } from "./events.js";
import { rapportScore } from "./rapport.js";

/**
 * Notables — rare, earned individual titles. Direct, verbatim asks from the
 * user across several messages: "I like the idea of notables... what makes
 * a Pokémon notable?", "give it xp boosts and name it. And like the herd can
 * be named around it. And then socially they are respected", and, most
 * important for this module's actual shape, "I don't want them in every
 * herd. They gotta earn it." See DESIGN.md's "Notables" section for the full
 * design and real multi-seed calibration numbers.
 *
 * **Record-holder, not a per-herd threshold.** Exactly one living agent
 * holds each title across the *entire world* at a time (or nobody, if no
 * living agent has ever met the title's real minimum threshold yet) — this
 * is the single mechanism that makes "gotta earn it" literally true rather
 * than a decoration every well-fed herd eventually accumulates one of.
 * `World.notables` is the source of truth (`NotableTitleId -> {agentId,
 * value}`); `Agent.notableTitle` is a cheap denormalized copy for the web
 * UI's common per-agent rendering case, the same pattern `Agent.isPredator`
 * already established for `SpeciesDef.isPredator`.
 *
 * **One title per agent.** `TITLE_ORDER` below is a fixed, arbitrary but
 * documented priority — an agent already holding a title is skipped when a
 * different title's challenger is being picked, so a single standout
 * individual can't be crowned twice; the second title's slot goes to the
 * next-best *untitled* agent instead of being left vacant, or genuinely
 * stays vacant if no untitled agent clears that title's threshold either.
 * The order itself (hero, builder, gatherer, rival, beloved, elder,
 * wanderer) has no deeper meaning than "some order had to be picked" — it
 * only matters on the rare tick a single agent would otherwise qualify for
 * more than one title at once.
 *
 * **Checked once per tick, not per triggering event.** Every title's real
 * stat (kills, shelter ticks, deliveries, grudge intensity, offspring, age,
 * dispersal distance) only ever *increases* while an agent is alive (or, for
 * rival/elder/wanderer, is recomputed fresh each check) — the one case a
 * per-event hook can't cheaply cover is an incumbent *dying*, which has to
 * fall through to the next-best living challenger, and that requires a scan
 * regardless of which event caused it. A single once-per-tick pass over
 * `world.agents` (bounded by real population size, same order of cost as
 * `growFlora`/`decayShelters`'s own once-per-tick world-level passes in
 * simulation.ts) covers every title's transfer condition — new claim,
 * dethroning, and holder-died-so-transfer — in one place, simpler than
 * threading a bespoke check into each of the four separate trigger sites
 * (predation.ts's kill, shelter.ts's build-tick, support.ts's delivery,
 * eggs.ts's hatch) on top of a *second*, separate periodic scan for
 * rival/elder/wanderer. `updateNotables` is pure bookkeeping plus event
 * emission — no rng, so it doesn't affect determinism.
 */

/**
 * Real minimum bar per title, below which the title is left unclaimed
 * entirely rather than crowning whatever the best (possibly trivial) value
 * happens to be in an early or small-population world — see this module's
 * top-of-file doc comment and DESIGN.md's "Notables" section for the real
 * multi-seed numbers these were calibrated against.
 */
export const NOTABLE_TITLE_MIN_THRESHOLDS: Record<NotableTitleId, number> = {
  // A real, sustained combat record — several real kills/mob-defenses, not
  // a single lucky hunt. See DESIGN.md's real-run kill-count distribution.
  hero: 5,
  // More than one shelter's worth of real build-tick investment
  // (SHELTER_BUILD_TICKS = 40, or 20 for a predator) — a genuine, repeated
  // contributor, not whoever happened to finish the very first shelter.
  builder: 60,
  // DESIGN.md's Rapport section found foodDelivered fires 0-1 times per
  // 8000-tick run under the existing applyHerdSupport gate — deliberately
  // NOT inflated to make this title common; 2 real deliveries is already a
  // genuinely rare, earned bar at this sim's actual population dynamics.
  gatherer: 2,
  // |rapport score| on the -1..1 scale — 0.4 needs sustained, repeated
  // conflict with the same rival (a single herdClash hit is only ±0.06), not
  // one bad encounter.
  rival: 0.4,
  // Real, hatched (not merely laid — see Agent.lifetimeOffspring's doc
  // comment) surviving offspring from the same parent.
  beloved: 4,
  // Ticks alive — well past MATURITY_AGE (200) and EGG_INCUBATION_TICKS
  // (80), a real multi-thousand-tick survivor, not just "grown up."
  elder: 500,
  // Manhattan tiles from birth position (lifetime high-water mark, see
  // Agent.maxDispersalDistance's doc comment) — calibrated up from an
  // initial 30 after a real run showed that bar let ordinary movement
  // contest the title constantly (see DESIGN.md's "Notables" section for
  // the real before/after transfer-count numbers); 60 is a real, deliberate
  // disperser on a SCENARIO_WIDTH x SCENARIO_HEIGHT = 90x60 map (roughly
  // two-thirds of the map's shorter dimension), not an agent that merely
  // wandered its home range.
  wanderer: 60,
};

/** Fixed, documented priority order for resolving "one title per agent" — see this module's top-of-file doc comment. */
const TITLE_ORDER: NotableTitleId[] = ["hero", "builder", "gatherer", "rival", "beloved", "elder", "wanderer"];

/**
 * This agent's own current live stat value for `title`, or `undefined` if
 * it doesn't apply at all (e.g. a genderless/unaged agent for `elder`).
 * Every stat here is a real, already-tracked (or cheaply derivable) number —
 * no new tracking invented purely to feed this function beyond the lifetime
 * counters/`birthPos` this feature itself adds (see types.ts's `Agent` doc
 * comments for each).
 */
function statValueFor(title: NotableTitleId, agent: Agent, world: World): number | undefined {
  switch (title) {
    case "hero":
      return agent.lifetimeKills ?? 0;
    case "builder":
      return agent.lifetimeShelterTicks ?? 0;
    case "gatherer":
      return agent.lifetimeFoodDeliveries ?? 0;
    case "beloved":
      return agent.lifetimeOffspring ?? 0;
    case "elder":
      // Absent age means "never tracked" (a founder, per Agent.age's own doc
      // comment — see needs.ts's tickAgentNeeds, which only ever increments
      // an already-defined age), not "age 0" — a founder shouldn't silently
      // out-rank a real hatchling that's actually been alive for centuries
      // of ticks just because its own age was never initialized.
      return agent.age;
    case "wanderer": {
      if (!agent.birthPos) return undefined;
      // A lifetime high-water mark, not a live snapshot — see
      // Agent.maxDispersalDistance's doc comment for why: a live-distance
      // version churned the title on ordinary back-and-forth wandering, not
      // genuine new dispersal. Updated here (called once per tick, per
      // `updateNotables`'s doc comment) rather than at a separate site,
      // since this is the one place already computing the live distance for
      // every living agent every tick.
      const liveDistance = Math.abs(agent.pos.x - agent.birthPos.x) + Math.abs(agent.pos.y - agent.birthPos.y);
      agent.maxDispersalDistance = Math.max(agent.maxDispersalDistance ?? 0, liveDistance);
      return agent.maxDispersalDistance;
    }
    case "rival": {
      const rapport = agent.rapport;
      if (!rapport) return undefined;
      let mostNegative = 0;
      for (const otherId of Object.keys(rapport)) {
        const score = rapportScore(agent, otherId, world.tick);
        if (score < mostNegative) mostNegative = score;
      }
      return mostNegative < 0 ? -mostNegative : undefined; // magnitude — 0/positive reads as "no real grudge," not a valid challenge
    }
  }
}

function isLivingNonEgg(agent: Agent): boolean {
  return agent.alive !== false && agent.isEgg !== true;
}

/**
 * Once per world tick (see `tickWorld`, simulation.ts): re-derives every
 * title's current best living, eligible challenger and transfers the title
 * if it beats the incumbent (or the incumbent has died) — see this module's
 * top-of-file doc comment for the full mechanism. Pure bookkeeping plus
 * `titleClaimed`/`titleLost` event emission; no rng.
 */
export function updateNotables(world: World, log?: EventLog): void {
  for (const title of TITLE_ORDER) {
    const holderRecord = world.notables?.[title];
    // The holder may no longer even be in `world.agents` (a corpse pruned by
    // `pruneStaleCorpses` long after this agent's title was already lost to
    // death) — `holderAgent` is `undefined` in that case, same as if it had
    // never existed.
    const holderAgent = holderRecord ? world.agents.find((a) => a.id === holderRecord.agentId) : undefined;
    const holderAlive = holderAgent !== undefined && isLivingNonEgg(holderAgent);

    let bestAgent: Agent | undefined;
    let bestValue = -Infinity;
    for (const agent of world.agents) {
      if (!isLivingNonEgg(agent)) continue;
      // One title per agent: an agent already holding a DIFFERENT title is
      // not eligible to be picked for this one — its current title stays
      // put, and this title's slot goes to the next-best untitled (or
      // already-this-title, for the incumbent) agent instead.
      if (agent.notableTitle !== undefined && agent.notableTitle !== title) continue;
      const value = statValueFor(title, agent, world);
      if (value === undefined) continue;
      if (value > bestValue) {
        bestValue = value;
        bestAgent = agent;
      }
    }

    const threshold = NOTABLE_TITLE_MIN_THRESHOLDS[title];
    const challengerQualifies = bestAgent !== undefined && bestValue >= threshold;
    const sameHolder = challengerQualifies && holderAlive && bestAgent === holderAgent;

    if (challengerQualifies && !sameHolder) {
      // A genuine transfer (or first-ever claim) — bestAgent either beat the
      // living incumbent's own current value, or the incumbent is gone
      // (dead, or already pruned).
      if (holderAlive && holderAgent) {
        holderAgent.notableTitle = undefined;
        log?.record({ kind: "titleLost", tick: world.tick, title, agentId: holderAgent.id, species: holderAgent.species, reason: "dethroned" });
      } else if (holderAgent) {
        holderAgent.notableTitle = undefined;
        log?.record({ kind: "titleLost", tick: world.tick, title, agentId: holderAgent.id, species: holderAgent.species, reason: "died" });
      }
      bestAgent!.notableTitle = title;
      world.notables = world.notables ?? {};
      // A genuine new claim (or transfer) — `claimedAtTick` starts fresh here,
      // NOT inherited from the previous holder, even for the "same agent
      // reclaiming the same title after briefly losing it" edge case (a real
      // gap in eligibility, so a fresh tenure). See NotableRecord's doc
      // comment and herdLeadership.ts's seniority tie-break, which reads this.
      world.notables[title] = { agentId: bestAgent!.id, value: bestValue, claimedAtTick: world.tick };
      log?.record({
        kind: "titleClaimed",
        tick: world.tick,
        title,
        agentId: bestAgent!.id,
        species: bestAgent!.species,
        value: bestValue,
        previousHolderId: holderAgent?.id,
      });
    } else if (sameHolder && holderAgent) {
      // Same holder, refreshed value — keep World.notables current (e.g. a
      // living Elder's age keeps climbing every tick) without emitting an
      // event for a title that hasn't actually changed hands. `claimedAtTick`
      // is preserved from `holderRecord`, not reset — the holder's tenure
      // didn't restart just because their stat ticked up.
      world.notables = world.notables ?? {};
      world.notables[title] = { agentId: holderAgent.id, value: bestValue, claimedAtTick: holderRecord!.claimedAtTick };
    } else if (!challengerQualifies && holderRecord && !holderAlive) {
      // The incumbent is gone (died, or its corpse was already pruned) and
      // no living agent currently clears the threshold — the title
      // genuinely goes unclaimed rather than being handed to a challenger
      // that hasn't actually earned it yet.
      if (holderAgent) {
        holderAgent.notableTitle = undefined;
        log?.record({ kind: "titleLost", tick: world.tick, title, agentId: holderAgent.id, species: holderAgent.species, reason: "died" });
      }
      delete world.notables![title];
    }
  }
}
