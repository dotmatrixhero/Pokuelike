import type { Agent, RapportEdge, RapportMemory, RapportReason, RapportSubject, World } from "./types.js";

/**
 * Rapport: a real, sparse agent-to-agent relationship graph — the general,
 * in-sim foundation for a future player-recruitment mechanic (a herd becomes
 * the player's team, but which specific individuals actually want to join
 * will eventually depend on a real relationship, not just herd membership).
 * See DESIGN.md's "Rapport" section for the full design and real-run
 * findings; this module owns the data structure, its decay/prune/cap
 * bookkeeping, and every tuning constant it introduces. The two real
 * consumers — reproduction.ts's mate preference and herdConflict.ts's rival
 * targeting/escalation — live in their own files, reusing what's exported
 * here.
 *
 * **Sparse by construction.** `Agent.rapport` only ever holds an entry for a
 * pair that has actually interacted; absence reads as neutral (score 0), not
 * a stored zero. Every write goes through `adjustRapport` below, which
 * decays the existing edge (if any) to the current tick before applying a
 * delta, then deletes the edge outright once its magnitude decays under
 * `RAPPORT_PRUNE_THRESHOLD` — this is what keeps the map sparse over a long
 * run for pairs whose interactions have actually stopped, on top of (not
 * instead of) `RAPPORT_MAX_EDGES_PER_AGENT`'s hard cap, which bounds the
 * pathological case (heavy, sustained interaction with many distinct
 * partners) even before decay would ever have caught up.
 */

/**
 * Multiplicative per-tick decay applied to a score based on ticks elapsed
 * since `lastInteractionTick` (see `decayedRapportScore`) — chosen for a
 * ~300-tick half-life (`0.5 ** (1/300) ≈ 0.99769`, rounded), the same order
 * of magnitude as this codebase's other "sustained, not a single bad tick"
 * social/behavioral time constants (`MATE_ISOLATION_TICKS` = 200,
 * `HERD_CONFLICT_COOLDOWN_TICKS` = 80) rather than `grazingPressure`'s much
 * slower ecological fade (its own real-run tuning note explains why a food
 * patch's regrowth cycle needed pressure to survive multi-hundred-tick gaps
 * between feeding waves) — a relationship should still feel present after a
 * few dozen ticks apart (a herd-mate briefly out of sight), but a real
 * dry-spell of many hundreds of ticks with zero fresh interaction should
 * genuinely fade it back toward stranger-neutral, matching the real-biology
 * framing every other decaying field in this file already uses.
 */
export const RAPPORT_DECAY_PER_TICK = 0.9977;

/**
 * The slower decay rate for a wild creature's edge TOWARD THE PLAYER
 * specifically (`RapportEdge.towardPlayer`, set in `adjustRapport`) —
 * ~1386-tick half-life (`0.5 ** (1/1386) ≈ 0.9995`) versus the ordinary
 * 300-tick one. ROADMAP.md M6, the user's own words: "we just have to
 * let them actually grow bond." `runner/validateBond.ts`'s bot — doing
 * everything right (gather, court, crouch, offer, back off, wait out the
 * treat cooldown) — earned a follower on 0 of 5 seeds under
 * `RAPPORT_DECAY_PER_TICK`: its real cadence between successful treats
 * (restocking berries, drinking, chasing a roaming target) ran many
 * hundreds of ticks, and ordinary decay erased most of each gain before
 * the next one landed. A wild animal's memory of every OTHER wild animal
 * still decays at the ordinary rate — only "how it feels about the one
 * consistently strange, slow-moving thing that keeps leaving food" gets
 * to be stickier. First lever pulled on this problem; TODO.md tracks the
 * before/after table and the levers still on the table if this alone
 * isn't enough.
 */
export const RAPPORT_PLAYER_EDGE_DECAY_PER_TICK = 0.9995;

/**
 * Once a decayed score's absolute value drops below this, the edge is
 * deleted outright rather than left sitting at a value indistinguishable
 * from "never interacted" forever — the pruning half of the sparsity
 * guarantee (see this file's doc comment). Small enough that it never
 * discards a relationship that still means anything (the smallest real
 * single-interaction delta this module produces, `RAPPORT_FOOD_DELIVERY_DELTA`
 * = 0.03, comfortably clears it and needs real decay time to fall back under
 * it), but real enough to actually matter for sparsity — an edge that
 * decayed here has typically gone many hundreds of ticks with zero fresh
 * interaction (at this decay rate, 0.03 takes ~940 ticks to fall under
 * 0.0002, an order of magnitude below this threshold, so a genuinely fading
 * relationship gets pruned well before it would ever round to a
 * floating-point zero on its own).
 */
export const RAPPORT_PRUNE_THRESHOLD = 0.02;

/**
 * Defensive bound on `Agent.rapport`'s size — "should never be approached in
 * practice, but bounds the pathological case" in the same spirit as
 * `SHELTER_CLUSTER_SCAN_CAP` (occupancy.ts): a long, heavy-interaction run
 * (a large, stable herd with constant food delivery/mob-defense traffic)
 * could in principle accumulate more distinct interaction partners than
 * decay/pruning has had time to clean up between them. 16 is comfortably
 * above what a real herd-scale social circle needs (this sim's herds
 * typically run well under that many living members at once — see
 * DESIGN.md's herd-size real-run numbers elsewhere in this file) while still
 * being a real, felt limit: once it's full, a genuinely new interaction
 * evicts the weakest/stalest existing edge rather than growing further.
 */
export const RAPPORT_MAX_EDGES_PER_AGENT = 16;

// --- Interaction magnitudes, all sim-original guesses to be judged against a real run ---

/**
 * A single successful herd food delivery (`support.ts`'s `applyHerdSupport`,
 * `foodDelivered` event) — deliberately the smallest magnitude here: an
 * ordinary, fairly frequent errand, not a significant moment on its own.
 * Meant to need real repetition (several deliveries between the same two
 * individuals) before it adds up to something a consumer would actually feel
 * — see `RAPPORT_BONDING_DELTA`'s doc comment for the contrasting "rare,
 * deliberate, already-significant event deserves a real jump" case.
 */
export const RAPPORT_FOOD_DELIVERY_DELTA = 0.03;

/**
 * ROADMAP.md M6's Feed verb: a berry set down by a stranger and eaten. Bigger
 * than a herd-mate's routine delivery (0.03) because it is a deliberate gift
 * across a species line, and it is the one lever the player has on day one.
 * Sim-original guess: at trust.ts's thresholds, ~3 eaten offerings reach
 * `curious`, ~7 reach `bonded`, decay permitting. For the user to judge
 * against validateBond.ts.
 */
export const RAPPORT_OFFERED_FOOD_DELTA = 0.08;

/**
 * Deliberately socializing (`needs.ts`'s `applySocializing`, the idle-stack
 * fallback right before `applyTraining`) — direct ask: "socialize as an
 * intention/unit action to spend time, could help create rapport with your
 * herd." Bigger than a food delivery (this is the whole point of the tick,
 * not an errand's side effect) but still modest — repetition, the same as
 * every other incremental delta here, is expected to do most of the real
 * work over a relationship's life. Deliberately NOT as big as
 * `RAPPORT_MOB_DEFENSE_DELTA` — sitting together costs nothing and risks
 * nothing, unlike actually fighting for a herd-mate.
 */
export const RAPPORT_SOCIALIZE_DELTA = 0.04;

/**
 * Joint mob-defense — predation.ts's guardian mechanic (`findHerdmateInDanger`
 * inside `applyPredationInstincts`), where one herd-mate actually lands a hit
 * defending another that's currently fleeing/fighting a threat. Bigger than a
 * food delivery: this is a real, risk-bearing act (the defender is picking a
 * fight with whatever's threatening its herd-mate, not just running an
 * errand), but still modest — a single defense shouldn't instantly read as a
 * bond, and a herd with an active predator problem produces many of these
 * between the same pairs over time (see real-run findings in DESIGN.md),
 * so repetition is still expected to do most of the work.
 */
export const RAPPORT_MOB_DEFENSE_DELTA = 0.06;

/**
 * Bonding (`reproduction.ts`'s `applyMateSeeking`, `bonded` event) — a
 * deliberate, rare, already-significant event (first contact between an
 * eligible pair), so this is a real, immediate jump, not an incremental
 * nudge that needs repeating: bonding only ever fires once per pair (checked
 * via `Agent.bondedPartnerId` before this delta is ever applied), so there's
 * no "many small deliveries" repetition path available for it the way there
 * is for food delivery/mob-defense — the single application has to carry the
 * whole weight of "these two are now mates." 0.6 lands solidly in "clearly a
 * bond" territory on the -1..1 scale without maxing it out outright, leaving
 * room for a bonded pair's later real interactions (shared shelter, more
 * food delivery between the same two) to still push it higher.
 */
export const RAPPORT_BONDING_DELTA = 0.6;

/**
 * A real herd-conflict hit landing (`herdConflict.ts`'s `herdClash`, outcome
 * `"hit"` or `"retreated"` — not `"missed"`, which never actually connected)
 * between the same two specific individuals — a real grudge forming, not a
 * herd- or species-level effect (this is applied to exactly the attacker/
 * defender pair, nowhere else). Magnitude-matched to `RAPPORT_MOB_DEFENSE_DELTA`
 * (same order of size, opposite sign): a single clash is a real, felt
 * negative moment (getting hit, or being the one who threw the first punch)
 * but sustained rivalry between the same pair — which `herdConflict.ts`'s own
 * cooldown/re-blocking structure makes likely once two herds keep contesting
 * the same tile — is what's meant to build a real, escalating grudge.
 */
export const RAPPORT_HERD_CLASH_DELTA = -0.06;

// --- Shared experience (see RapportReason's own doc comment for why these are a
// different category from everything above). All five magnitudes are
// sim-original guesses in the same spirit as every constant above it: judge
// them against a real run, not against canon.

/**
 * Two power-matched rivals stood over the same contested resource, were
 * eligible to fight for it, and didn't — `herdConflict.ts`'s declined
 * escalation. Deliberately magnitude-matched to `RAPPORT_HERD_CLASH_DELTA`'s
 * 0.06, slightly under it: **restraint is worth about what a clash costs**,
 * which is the whole point of adding it. The existing code notes that "a
 * grudge biases escalation, a positive relationship never suppresses it" —
 * so escalation compounded and restraint earned nothing, and this is the
 * missing half of that loop.
 */
export const RAPPORT_SHARED_RESOURCE_DELTA = 0.05;

/** Drilling moves within sight of each other. Sized like socializing — shared time, with a bit more purpose in it. */
export const RAPPORT_TRAINED_TOGETHER_DELTA = 0.04;

/**
 * One asleep, one awake beside it. Bigger than socializing because it is not
 * merely co-presence: the sleeper is a genuine sitting duck (`needs.ts`
 * refuses it any movement, attack or flee while asleep) and chose that spot
 * anyway. Real trust, not company.
 */
export const RAPPORT_SLEPT_NEAR_DELTA = 0.05;

/** Something died within sight of both of them, and neither was it. A real shared moment, so bigger than any ordinary errand. */
export const RAPPORT_SURVIVED_TOGETHER_DELTA = 0.08;

/**
 * The same death, where the dead agent was someone *both* of them held real
 * positive rapport with. The largest non-bonding delta here, because it is
 * the rarest thing in the vocabulary and the only one about a third party —
 * grief is not an errand.
 */
export const RAPPORT_MOURNED_DELTA = 0.12;

/**
 * Both were fighting when something died beside them. Sized just above
 * `RAPPORT_SURVIVED_TOGETHER_DELTA` — standing in a fight together is more
 * than standing near one — and it carries a named subject, which is the part
 * that actually does the work.
 */
export const RAPPORT_DEFEATED_TOGETHER_DELTA = 0.1;

/**
 * The herd migrated together because the weather (or the scarcity it caused)
 * left it no choice. Modest per migration: a real shared upheaval, but every
 * member of the herd gets it with every other member, so this multiplies
 * across a herd in a way the one-to-one reasons do not.
 */
export const RAPPORT_WEATHERED_TOGETHER_DELTA = 0.04;

/**
 * Carrying a fainted ally to safety — `support.ts`'s completed carry, and
 * `DESIGN.md`'s **Rescue**, the strongest of the four bonding verbs ("the
 * Pokémon chooses you as much as you chose it"). Until this constant existed
 * the entire carry mechanic built **zero** rapport, which was an oversight
 * rather than a decision: nothing in DESIGN.md or TODO.md records a choice
 * to leave it out. The largest delta in this file after bonding itself,
 * because a rescue should not need repeating to mean something.
 */
export const RAPPORT_RESCUE_DELTA = 0.35;

/**
 * A tick of the `healAura` passive that actually closed a wound — counted
 * only when the recipient was genuinely hurt, since healing somebody at full
 * HP is arithmetically a no-op and should not read as care. Small and
 * throttled (see `RAPPORT_REASON_MEMORY_INTERVAL`) because an aura holder
 * mends the same herd-mates every tick they stand near it; the *milestone*
 * is what means something, not the tick.
 *
 * Like the carry mechanic, this had no rapport hook at all before — real
 * agent-to-agent healing, running every tick, building nothing.
 */
export const RAPPORT_HEALED_DELTA = 0.03;

function clampScore(score: number): number {
  return Math.max(-1, Math.min(1, score));
}

/**
 * The reasons on `agent`'s edge toward `otherId`, strongest-evidence first
 * (highest `count`, ties broken by most recent) — empty if there's no edge or
 * the edge predates/omits the field. Every consumer should read through this
 * rather than touching `RapportEdge.memories` directly, so "no edge",
 * "edge with no memories" and "edge written before this field existed" all
 * collapse to the same harmless empty list.
 *
 * Returns a fresh sorted array rather than the stored one — this is a
 * read-only view, and callers ordering or slicing it must not disturb the
 * edge's own storage order.
 */
export function rapportMemories(agent: Agent, otherId: string): RapportMemory[] {
  const memories = agent.rapport?.[otherId]?.memories;
  if (!memories?.length) return [];
  return [...memories].sort((a, b) => b.count - a.count || b.lastTick - a.lastTick);
}

/**
 * How much a reason *distinguishes* a relationship, highest first — which is
 * emphatically NOT how much it contributed to the score. Added because of a
 * real-run measurement, not a guess: over 4 seeds x 6000 ticks,
 * `"socialized"` was **95.2%** of all recorded reason-events (16,168 of
 * 16,975), so a count-ordered read puts the least interesting fact first on
 * essentially every edge in the world — *"kept their company 2907 times,
 * fought for them 19 times"* leads with the wrong clause.
 *
 * Contribution ordering does not fix that, because socializing genuinely did
 * drive most of those scores; it is simply the boring reason a relationship
 * is strong. What a reader wants is the **rare** reason, so this ranks by
 * scarcity-of-meaning instead: taking a mate happens once ever, being
 * defended is a risk somebody took, a grudge is a grudge, and sitting
 * together is what everyone does all day.
 *
 * This is `NARRATIVE_PILLARS.md`'s curation mandate in miniature — the game
 * is responsible for noticing on the player's behalf — which is exactly why
 * it lives behind `notableRapportMemories` rather than being baked into
 * `rapportMemories`: the honest mechanical order and the editorial order are
 * different questions, and conflating them would hide the judgement.
 */
export const RAPPORT_REASON_SIGNIFICANCE: Record<RapportReason, number> = {
  // Being carried out when you could not walk is the strongest thing one
  // agent can do for another short of dying for it.
  wasRescued: 7,
  rescued: 7,
  // Rarest and heaviest: a third party both of them cared about is dead.
  mourned: 6,
  wasHealed: 5,
  healed: 5,
  // Carries a named subject, which makes it the most specific thing an edge
  // can say about itself.
  defeatedTogether: 6,
  bonded: 5,
  survivedTogether: 5,
  weatheredTogether: 4,
  wasDefended: 4,
  defended: 4,
  // Sleeping beside someone who could reach you is a real, costly choice —
  // ranked with the risk-bearing acts rather than with shared time.
  sleptSafely: 4,
  keptWatch: 4,
  struck: 3,
  wasStruck: 3,
  // Choosing not to fight over water reads as strongly as choosing to.
  sharedWater: 3,
  trainedTogether: 3,
  // A socialized *milestone* is 500 ticks of chosen company (see
  // RAPPORT_REASON_MEMORY_INTERVAL), which distinguishes a relationship about
  // as much as a single clash does — not the near-worthless per-tick event
  // this entry used to represent.
  socialized: 3,
  gaveFood: 2,
  receivedFood: 2,
};

/**
 * How many raw occurrences of a reason it takes to add one to a memory's
 * `count` — absent means 1, i.e. every occurrence is its own memory, which is
 * right for everything rare and deliberate.
 *
 * **`socialized` is throttled because a real run proved it had to be.**
 * Measured over 4 seeds x 6000 ticks, socializing was **95.2%** of all
 * recorded reason-events (16,168 of 16,975), and one pair alone logged 2,907
 * of them — they sat together every other tick. At that density the count
 * carries no information: *"kept their company 2907 times"* says nothing a
 * reader can use, and it swamps *"fought for them 19 times"* on the same
 * edge.
 *
 * The fix is a milestone, not a deletion — direct steer: *"I would rather
 * have more depth to the social then drop it. But yeah the raw 3k events on
 * its own isn't really that useful i guess. Maybe every 500 social it creates
 * a useful memory."* 500 is that number. So the first shared moment records
 * immediately (these two have met, and that is real), and every 500
 * thereafter adds another — a count of long stretches together rather than of
 * ticks. `RapportMemory.occurrences` keeps the raw total so the depth is
 * still there for anything that wants it.
 */
export const RAPPORT_REASON_MEMORY_INTERVAL: Partial<Record<RapportReason, number>> = {
  socialized: 500,
  // Training is an idle-stack fallback, so a pair with nothing better to do
  // can drill side by side for hundreds of consecutive ticks — the same
  // per-tick-habit shape socializing had, at a shorter interval because it
  // is a deliberate activity rather than ambient company.
  trainedTogether: 200,
  // A watch is recorded once per *sleep episode* (see needs.ts — it fires as
  // an agent falls asleep, not every tick it stays asleep), so these are
  // already nights rather than ticks. A handful of nights is a real habit;
  // this keeps a long-lived pair from turning that into a four-digit count.
  keptWatch: 20,
  sleptSafely: 20,
  // Restraint is checked whenever a standoff is live, which can be many
  // consecutive ticks over one contested tile. Throttled so a single long
  // standoff reads as one act of restraint rather than fifty.
  sharedWater: 50,
  // The aura fires every tick a hurt herd-mate stands in it, so these are
  // per-tick habits in exactly the way socializing was. A milestone is
  // roughly "you have patched me up through a whole bad stretch."
  healed: 100,
  wasHealed: 100,
};

/**
 * `rapportMemories` reordered for a reader — most *distinguishing* reason
 * first (see `RAPPORT_REASON_SIGNIFICANCE`), ties broken by count and then
 * recency. This is the view a narration or inspector surface wants;
 * `rapportMemories` stays the honest mechanical order for anything counting
 * events.
 */
export function notableRapportMemories(agent: Agent, otherId: string): RapportMemory[] {
  return rapportMemories(agent, otherId).sort(
    (a, b) =>
      RAPPORT_REASON_SIGNIFICANCE[b.reason] - RAPPORT_REASON_SIGNIFICANCE[a.reason] ||
      b.count - a.count ||
      b.lastTick - a.lastTick,
  );
}

/**
 * Folds one fresh occurrence of `reason` into `memories`, incrementing the
 * existing entry for that reason or appending a new one. Bounded by
 * construction: there are only as many entries as there are `RapportReason`
 * values, so this never needs a cap or a prune of its own the way `score`
 * does.
 *
 * Takes and returns the array rather than mutating an edge, so
 * `adjustRapport` can carry memories across the edge object it rebuilds.
 */
/**
 * Which of two subjects is worth keeping — the more notable one, judged by
 * `level`, ties going to the newer. An edge keeps exactly one subject per
 * reason (see `RapportMemory.subject`), so this is the whole of that
 * curation: bringing down a Scyther outranks the four Rattata before it, and
 * `count` still records that there were five.
 */
function moreNotableSubject(prior: RapportSubject | undefined, next: RapportSubject | undefined): RapportSubject | undefined {
  if (!next) return prior;
  if (!prior) return next;
  return (next.level ?? 0) >= (prior.level ?? 0) ? next : prior;
}

function withMemory(
  memories: RapportMemory[] | undefined,
  reason: RapportReason,
  tick: number,
  subject?: RapportSubject,
): RapportMemory[] {
  const next = memories ? [...memories] : [];
  const interval = RAPPORT_REASON_MEMORY_INTERVAL[reason] ?? 1;
  const at = next.findIndex((m) => m.reason === reason);

  if (at < 0) {
    // The first occurrence always records, throttled or not — "these two have
    // met" is real information, and it means a throttled reason never sits
    // invisible at count 0 waiting for a milestone that may never come.
    const fresh: RapportMemory = { reason, count: 1, lastTick: tick };
    if (interval > 1) fresh.occurrences = 1;
    if (subject) fresh.subject = subject;
    next.push(fresh);
    return next;
  }

  const prior = next[at]!;
  const keptSubject = moreNotableSubject(prior.subject, subject);
  if (interval <= 1) {
    const updated: RapportMemory = { reason, count: prior.count + 1, lastTick: tick };
    if (keptSubject) updated.subject = keptSubject;
    next[at] = updated;
    return next;
  }

  // Throttled: always advance the raw total, but only cross into a new
  // milestone (and refresh lastTick) every `interval` occurrences since the
  // first. `lastTick` therefore means "when this last became worth
  // remembering", which is what a reader wants from it.
  const occurrences = (prior.occurrences ?? prior.count) + 1;
  const crossed = (occurrences - 1) % interval === 0;
  const throttled: RapportMemory = {
    reason,
    count: crossed ? prior.count + 1 : prior.count,
    lastTick: crossed ? tick : prior.lastTick,
    occurrences,
  };
  if (keptSubject) throttled.subject = keptSubject;
  next[at] = throttled;
  return next;
}

/**
 * `edge`'s score decayed forward to `tick`, without mutating `edge` itself —
 * every consumer reads through this (directly via `rapportScore`, or via
 * `adjustRapport` before applying a fresh delta) so a stale-but-still-stored
 * edge never reports a value it hasn't actually earned just because nothing
 * has touched it recently. Purely deterministic arithmetic — no rng, so
 * nothing here needs threading.
 */
export function decayedRapportScore(edge: RapportEdge, tick: number): number {
  const elapsed = Math.max(0, tick - edge.lastInteractionTick);
  if (elapsed === 0) return edge.score;
  const rate = edge.towardPlayer ? RAPPORT_PLAYER_EDGE_DECAY_PER_TICK : RAPPORT_DECAY_PER_TICK;
  return edge.score * Math.pow(rate, elapsed);
}

/**
 * Current rapport `agent` holds toward `otherId` — 0 (neutral/unacquainted)
 * if no edge exists. Read-only in intent, but opportunistically prunes: if
 * the decayed score has fallen under `RAPPORT_PRUNE_THRESHOLD`, the stale
 * edge is deleted right here rather than waiting for a future write to
 * notice — a real edge that nothing has touched in a very long time (no
 * future interaction ever comes to trigger `adjustRapport`) would otherwise
 * sit in the map forever at a value indistinguishable from "never met",
 * which is exactly the silent-bloat failure mode this whole module exists to
 * avoid. Mutation here is pure bookkeeping (no rng, no behavioral side
 * effect beyond the map shrinking), so it doesn't affect determinism.
 */
export function rapportScore(agent: Agent, otherId: string, tick: number): number {
  const edge = agent.rapport?.[otherId];
  if (!edge) return 0;
  const decayed = decayedRapportScore(edge, tick);
  if (Math.abs(decayed) < RAPPORT_PRUNE_THRESHOLD) {
    delete agent.rapport![otherId];
    return 0;
  }
  return decayed;
}

/**
 * Evicts the weakest/stalest edge in `agent.rapport` to make room for a new
 * one once `RAPPORT_MAX_EDGES_PER_AGENT` is already full — "weakest" by
 * current decayed |score| (an edge that's already faded close to neutral is
 * the least meaningful relationship to keep), breaking ties by the oldest
 * `lastInteractionTick` (longest since anything real happened between that
 * pair), and finally by `rng` (threaded from `world.rng`, never bare
 * `Math.random` — see this codebase's determinism rules) for a genuine tie on
 * both. No-ops if the map isn't actually full or doesn't exist.
 */
function evictWeakestEdge(agent: Agent, tick: number, rng: () => number): void {
  const rapport = agent.rapport;
  if (!rapport) return;
  const ids = Object.keys(rapport);
  if (ids.length < RAPPORT_MAX_EDGES_PER_AGENT) return;

  let weakestId: string | undefined;
  let weakestAbs = Infinity;
  let weakestTick = Infinity;
  let tieCount = 0;
  for (const id of ids) {
    const edge = rapport[id]!;
    const abs = Math.abs(decayedRapportScore(edge, tick));
    if (abs < weakestAbs || (abs === weakestAbs && edge.lastInteractionTick < weakestTick)) {
      weakestId = id;
      weakestAbs = abs;
      weakestTick = edge.lastInteractionTick;
      tieCount = 1;
    } else if (abs === weakestAbs && edge.lastInteractionTick === weakestTick) {
      // A genuine tie on both axes — pick uniformly among tied candidates via rng,
      // reservoir-sampling style so this doesn't favor whichever id iterates first.
      tieCount++;
      if (rng() < 1 / tieCount) weakestId = id;
    }
  }
  if (weakestId !== undefined) delete rapport[weakestId];
}

/**
 * Applies `delta` to the rapport `agent` holds toward `otherId`, decaying
 * any existing edge to `tick` first, clamping the result to [-1, 1], and
 * pruning it away entirely if the result falls under
 * `RAPPORT_PRUNE_THRESHOLD` (e.g. a strong negative edge nudged back toward
 * 0 by a small positive delta). Enforces `RAPPORT_MAX_EDGES_PER_AGENT` by
 * evicting the weakest existing edge first — but only when this delta would
 * actually create a *new* edge; adjusting an existing partner never counts
 * against the cap. One-directional by design (see `strengthenRapportMutual`
 * below for the "both sides felt it" helper every real call site uses) —
 * kept separate so a future asymmetric interaction (one side remembers a
 * slight more than the other) has a place to plug in without inventing a new
 * function.
 *
 * `reason` records *what happened*, folded into the edge's `memories` (see
 * `RapportReason`) — it is directional, describing this agent's side of the
 * interaction, so a food delivery writes `"gaveFood"` here on the carrier and
 * `"receivedFood"` on the receiver. Optional only so a test or a future
 * caller with genuinely nothing to say can omit it; every real trigger in
 * this codebase passes one, and an untagged edge is exactly the
 * cause-less relationship this field exists to eliminate.
 *
 * **A pruned edge loses its memories with it**, which is deliberate: an edge
 * only prunes once its score has decayed to indistinguishable-from-stranger,
 * and a relationship that faded that far should not keep its grievances on
 * file. Same for eviction under `RAPPORT_MAX_EDGES_PER_AGENT`.
 */
export function adjustRapport(
  world: World,
  agent: Agent,
  otherId: string,
  delta: number,
  reason?: RapportReason,
  rng: () => number = world.rng,
  subject?: RapportSubject,
): void {
  if (agent.id === otherId) return;
  const rapport = agent.rapport ?? (agent.rapport = {});
  const existing = rapport[otherId];
  const decayed = existing ? decayedRapportScore(existing, world.tick) : 0;
  const next = clampScore(decayed + delta);

  if (Math.abs(next) < RAPPORT_PRUNE_THRESHOLD) {
    delete rapport[otherId];
    return;
  }

  if (!existing) evictWeakestEdge(agent, world.tick, rng);
  const memories = reason ? withMemory(existing?.memories, reason, world.tick, subject) : existing?.memories;
  // ROADMAP.md M6: recomputed on every write (not just once at edge
  // creation) — cheap (one `find` over living agents, and `adjustRapport`
  // fires far less often than `decayedRapportScore` reads), and correct
  // even in the edge case of a fresh edge appearing after `otherId`
  // stopped being the controlled agent. See RapportEdge.towardPlayer.
  const towardPlayer = world.agents.find((a) => a.id === otherId)?.controlledBy === "player";
  const edge: RapportEdge = { score: next, lastInteractionTick: world.tick };
  if (memories?.length) edge.memories = memories;
  if (towardPlayer) edge.towardPlayer = true;
  rapport[otherId] = edge;
}

/**
 * The shape every real trigger in this codebase actually uses: both
 * participants in a real interaction (food delivery, mob-defense, bonding,
 * a herd-conflict hit) come away with an adjusted opinion of each other, not
 * just one side. Takes the two live `Agent` references directly (every real
 * call site already has both in hand — the carrier/receiver, attacker/
 * defender, agent/herdmate, agent/partner — so this deliberately doesn't
 * re-look them up by id) and is a thin wrapper over two `adjustRapport`
 * calls, kept as its own function so every call site reads as "these two
 * just had a real interaction" rather than repeating the pair of calls
 * inline at every trigger.
 *
 * **The two reasons are separate because the edges are.** Each agent's edge
 * records that agent's own side of what happened, so an asymmetric
 * interaction writes different reasons on each: `"gaveFood"`/`"receivedFood"`,
 * `"defended"`/`"wasDefended"`, `"struck"`/`"wasStruck"`. `reasonForB`
 * defaults to `reasonForA` for the genuinely symmetric cases (`"socialized"`,
 * `"bonded"`), where both sides did the same thing and there is no role to
 * distinguish. The *score* delta stays shared — only the memory differs,
 * since "how much this moved us" is mutual here even where "what I did" is
 * not.
 */
export function strengthenRapportMutual(
  world: World,
  a: Agent,
  b: Agent,
  delta: number,
  reasonForA?: RapportReason,
  reasonForB: RapportReason | undefined = reasonForA,
  rng: () => number = world.rng,
  subject?: RapportSubject,
): void {
  if (a.id === b.id) return;
  adjustRapport(world, a, b.id, delta, reasonForA, rng, subject);
  adjustRapport(world, b, a.id, delta, reasonForB, rng, subject);
}
