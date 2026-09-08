import type { Agent, NotableTitleId, World } from "./types.js";
import type { EventLog } from "./events.js";
import { rapportScore } from "./rapport.js";
import type { LevelingContext } from "./leveling.js";

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
 * rival/elder/wanderer.
 *
 * **A new claim/transfer is a random chance, not instant on crossing the
 * threshold.** Direct report: seeing savant/elder/beloved/shaman all held
 * within the same herd at once read as titles being handed out too freely,
 * plus a real bug (below) that made Elder unfairly easy for hatchlings —
 * and the direct fix requested: "make it a random chance to obtain the
 * title." Once a challenger clears a title's threshold, the actual
 * hand-of-title only happens on a tick where a `NOTABLE_GRANT_CHANCE_PER_
 * TICK` roll hits — otherwise the challenger stays eligible-but-uncrowned
 * and gets re-rolled next tick (and every tick after, until either it wins
 * the roll or a still-better challenger takes its place first). This
 * doesn't affect determinism — the same seed still produces the same
 * sequence of `rng()` draws — but does mean `updateNotables` needs an
 * explicit `rng` now (threaded from `tickWorld`, same as `growFlora` etc.);
 * a title genuinely dying-and-vacating is NOT gated by this roll (no reason
 * to keep a title artificially unclaimed once its old holder is gone and
 * nobody else is competing for the delay).
 */

/**
 * Real minimum bar per title, below which the title is left unclaimed
 * entirely rather than crowning whatever the best (possibly trivial) value
 * happens to be in an early or small-population world — see this module's
 * top-of-file doc comment and DESIGN.md's "Notables" section for the real
 * multi-seed numbers these were calibrated against.
 */
/**
 * Direct report, after the thresholds below had already been calibrated
 * once: "Titles seems too common in general. I see a savant, elder,
 * beloved, shaman all in the same group. That's incorrect. Maybe we need to
 * slow it down a lot more." Every threshold here was raised well past its
 * previous bar (roughly 2.5-3x on the counters that scale, elder pushed out
 * to a genuine rare-survivor bar) on top of the separate random-chance gate
 * this module's top doc comment describes — the two changes compound, so
 * this second pass leans on real headroom rather than re-deriving each
 * number from scratch; still to be judged against a real multi-seed run
 * like every other tuning number in this file.
 */
export const NOTABLE_TITLE_MIN_THRESHOLDS: Record<NotableTitleId, number> = {
  // A real, sustained combat record — several real kills/mob-defenses, not
  // a single lucky hunt. See DESIGN.md's real-run kill-count distribution.
  hero: 15,
  // Several shelters' worth of real build-tick investment
  // (SHELTER_BUILD_TICKS = 40, or 20 for a predator) — a genuine, repeated
  // contributor, not whoever happened to finish a couple of shelters.
  builder: 150,
  // DESIGN.md's Rapport section found foodDelivered fires 0-1 times per
  // 8000-tick run under the existing applyHerdSupport gate — deliberately
  // NOT inflated to make this title common; 5 real deliveries is a
  // genuinely rare, earned bar at this sim's actual population dynamics.
  gatherer: 5,
  // |rapport score| on the -1..1 scale — 0.6 needs sustained, repeated
  // conflict with the same rival (a single herdClash hit is only ±0.06), not
  // one bad encounter, and close to the scale's own practical ceiling.
  rival: 0.6,
  // Real, hatched (not merely laid — see Agent.lifetimeOffspring's doc
  // comment) surviving offspring from the same parent.
  beloved: 10,
  // Ticks alive — a genuine multi-thousand-tick survivor, several times
  // MATURITY_AGE (200) past merely "grown up." Also fixes a real bug: prior
  // to `spawn.ts` giving every fresh spawn (worldgen founder or immigrant) a
  // real starting `age`, only egg-hatched agents ever tracked age at all —
  // a hatchling could claim Elder at the old, lower bar while every founder/
  // immigrant was permanently ineligible. Both now age on equal footing.
  elder: 1500,
  // Manhattan tiles from birth position (lifetime high-water mark, see
  // Agent.maxDispersalDistance's doc comment) — calibrated up from an
  // initial 30 after a real run showed that bar let ordinary movement
  // contest the title constantly (see DESIGN.md's "Notables" section for
  // the real before/after transfer-count numbers); 100 is a real, deliberate
  // disperser on a SCENARIO_WIDTH x SCENARIO_HEIGHT = 90x60 map (further
  // than the map's own shorter dimension), not an agent that merely
  // wandered its home range.
  wanderer: 100,
  // A single real kill against a target GIANT_SLAYER_LEVEL_GAP levels above
  // the killer is already the whole notable moment — direct ask: "it makes
  // you notable" — unlike Hero's ordinary kill count, this deliberately
  // does NOT need repetition to earn the title. The random-chance grant
  // gate is what slows this one down now, not the threshold.
  giantSlayer: 1,
  // One genuinely maxed branch (see SAVANT_MIN_BRANCH_NODES) is a real,
  // deliberate specialization — same "the single instance is already
  // notable" reasoning as giantSlayer above, not a count that needs
  // padding out; the random-chance grant gate slows this one down instead.
  savant: 1,
  // Raised well past the original direct ask ("'alpha' - which is win over
  // 40 clashes") per this section's own top-of-block report — 100 real
  // clash wins is a genuine standout, not a moderately active fighter.
  alpha: 100,
  // Sim-original guess, to be judged against a real run like every other
  // tuning number in this file — DESIGN.md's Rapport section found the
  // OTHER real support trigger (foodDelivered) fires 0-1 times per
  // 8000-tick run under its own gate; ally-effect support moves need a
  // real targetsAlly move build in the first place (not every agent ever
  // gets one via the respec tree), so this is likely similarly rare. 15 is
  // a real, sustained pattern rather than a handful of lucky heals.
  shaman: 15,
  // Raised to match Alpha's own new bar, mirrored from the original direct
  // ask ("'underdog' for losing 40 clashes") the same way Alpha was.
  underdog: 100,
  // A single real kill against a herd leader or another notable is already
  // the whole notable moment — same "the single instance is already
  // notable" reasoning as giantSlayer/savant above, not a count that needs
  // padding out; the random-chance grant gate slows this one down instead.
  kingslayer: 1,
};

/**
 * Once a challenger clears a title's threshold, the actual claim only goes
 * through on a tick this roll hits — see this module's top-of-file doc
 * comment ("A new claim/transfer is a random chance, not instant"). ~1 in
 * 80 ticks on average for an uninterrupted eligible challenger; titles
 * still land in a reasonable time over a multi-thousand-tick run, but stop
 * snapping on the very tick a stat crosses its bar.
 */
export const NOTABLE_GRANT_CHANCE_PER_TICK = 0.0125;

/** Fixed, documented priority order for resolving "one title per agent" — see this module's top-of-file doc comment. */
const TITLE_ORDER: NotableTitleId[] = [
  "hero",
  "builder",
  "gatherer",
  "rival",
  "beloved",
  "elder",
  "wanderer",
  "giantSlayer",
  "savant",
  "alpha",
  "shaman",
  "underdog",
  "kingslayer",
];

/**
 * How far above the attacker's own level a defeated target has to be for
 * the kill to count toward `Agent.lifetimeGiantSlayerKills` — direct ask:
 * "add a title for knocking out a pokemon more than 5 lvls above you."
 * Exported so the two real kill sites (predation.ts's finishing blow,
 * herdConflict.ts's lethal escalation) share the exact same bar rather than
 * two independently-tuned numbers.
 */
export const GIANT_SLAYER_LEVEL_GAP = 5;

/**
 * Minimum distinct nodes chosen within a single move-tree "branch" (all
 * nodes sharing one `MoveTreeNode.leaning`) for `statValueFor`'s "savant"
 * case to count it as maxed — see that function's own doc comment for why
 * this can't mean literally every node in the group (a real fork's mutually
 * `excludes`-ing pair can never both be chosen at once).
 */
const SAVANT_MIN_BRANCH_NODES = 6;

/**
 * This agent's own current live stat value for `title`, or `undefined` if
 * it doesn't apply at all (e.g. a genderless/unaged agent for `elder`).
 * Every stat here is a real, already-tracked (or cheaply derivable) number —
 * no new tracking invented purely to feed this function beyond the lifetime
 * counters/`birthPos` this feature itself adds (see types.ts's `Agent` doc
 * comments for each).
 */
function statValueFor(title: NotableTitleId, agent: Agent, world: World, ctx?: LevelingContext): number | undefined {
  switch (title) {
    case "hero":
      return agent.lifetimeKills ?? 0;
    case "giantSlayer":
      return agent.lifetimeGiantSlayerKills ?? 0;
    case "kingslayer":
      return agent.lifetimeKingslayerKills ?? 0;
    case "alpha":
      return agent.lifetimeClashWins ?? 0;
    case "shaman":
      return agent.lifetimeSupportActs ?? 0;
    case "underdog":
      return agent.lifetimeClashLosses ?? 0;
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
    case "savant": {
      // Direct ask: "'savant' for maxing out a branch of skill points for a
      // move." A "branch" here is every node sharing one `MoveTreeNode.
      // leaning` within a single move's tree — real, already-authored
      // structure (moves.ts), no new data needed. Counts every DISTINCT
      // (move, leaning) pair this agent has driven to `SAVANT_MIN_BRANCH_
      // NODES` chosen nodes or more — a real multi-move specialist ranks
      // higher than a single-branch dabbler, and (since `moveTreeChoices`
      // only ever grows — see maybeAutoRespec's own doc comment) this stays
      // a genuine, non-decreasing lifetime record like every other title.
      if (!ctx || !agent.moveTreeChoices) return undefined;
      let maxedBranches = 0;
      for (const [moveId, chosen] of Object.entries(agent.moveTreeChoices)) {
        const base = ctx.resolveMove(moveId);
        if (!base?.tree) continue;
        const chosenSet = new Set(chosen);
        const countByLeaning = new Map<string, number>();
        for (const node of Object.values(base.tree)) {
          if (!node.leaning || !chosenSet.has(node.id)) continue;
          countByLeaning.set(node.leaning, (countByLeaning.get(node.leaning) ?? 0) + 1);
        }
        for (const count of countByLeaning.values()) {
          if (count >= SAVANT_MIN_BRANCH_NODES) maxedBranches++;
        }
      }
      return maxedBranches > 0 ? maxedBranches : undefined;
    }
  }
}

/**
 * Who the `rival` title-holder's grudge is actually against — the single
 * most-negative rapport partner. Recorded on the claim event because "they
 * nursed a grudge against Brameye" is a story and "they nursed a grudge" is
 * a stat; the nemesis is the whole point of the title.
 */
function nemesisOf(agent: Agent, world: World): string | undefined {
  const rapport = agent.rapport;
  if (!rapport) return undefined;
  let worstId: string | undefined;
  let worst = 0;
  for (const otherId of Object.keys(rapport)) {
    const score = rapportScore(agent, otherId, world.tick);
    if (score < worst) {
      worst = score;
      worstId = otherId;
    }
  }
  return worstId;
}

function isLivingNonEgg(agent: Agent): boolean {
  return agent.alive !== false && agent.isEgg !== true;
}

/**
 * Once per world tick (see `tickWorld`, simulation.ts): re-derives every
 * title's current best living, eligible challenger and transfers the title
 * if it beats the incumbent (or the incumbent has died) — see this module's
 * top-of-file doc comment for the full mechanism, including the random-
 * chance gate on new claims/transfers that `rng` drives.
 */
export function updateNotables(world: World, log?: EventLog, ctx?: LevelingContext, rng: () => number = Math.random): void {
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
      const value = statValueFor(title, agent, world, ctx);
      if (value === undefined) continue;
      if (value > bestValue) {
        bestValue = value;
        bestAgent = agent;
      }
    }

    const threshold = NOTABLE_TITLE_MIN_THRESHOLDS[title];
    const challengerQualifies = bestAgent !== undefined && bestValue >= threshold;
    const sameHolder = challengerQualifies && holderAlive && bestAgent === holderAgent;
    // A genuinely new claim/transfer is gated behind a random-chance roll
    // (see NOTABLE_GRANT_CHANCE_PER_TICK's own doc comment) — an eligible
    // challenger stays eligible-but-uncrowned until the roll hits, rather
    // than snapping the instant the threshold is crossed. Only drawn when
    // there's actually a decision to gate, so an ineligible/unchanged tick
    // costs no rng draw. Vacating a dead incumbent's title (the `else if`
    // branch below) is NOT gated by this.
    const grantRollHits = challengerQualifies && !sameHolder && rng() < NOTABLE_GRANT_CHANCE_PER_TICK;

    if (challengerQualifies && !sameHolder && grantRollHits) {
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
        rivalId: title === "rival" ? nemesisOf(bestAgent!, world) : undefined,
        herdId: bestAgent!.herdId,
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
