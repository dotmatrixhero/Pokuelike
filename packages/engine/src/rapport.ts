import type { Agent, RapportEdge, RapportMemory, RapportReason, World } from "./types.js";

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
  bonded: 5,
  wasDefended: 4,
  defended: 4,
  struck: 3,
  wasStruck: 3,
  gaveFood: 2,
  receivedFood: 2,
  socialized: 1,
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
function withMemory(memories: RapportMemory[] | undefined, reason: RapportReason, tick: number): RapportMemory[] {
  const next = memories ? [...memories] : [];
  const existing = next.findIndex((m) => m.reason === reason);
  if (existing >= 0) {
    const prior = next[existing]!;
    next[existing] = { reason, count: prior.count + 1, lastTick: tick };
  } else {
    next.push({ reason, count: 1, lastTick: tick });
  }
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
  return edge.score * Math.pow(RAPPORT_DECAY_PER_TICK, elapsed);
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
  const memories = reason ? withMemory(existing?.memories, reason, world.tick) : existing?.memories;
  const edge: RapportEdge = { score: next, lastInteractionTick: world.tick };
  if (memories?.length) edge.memories = memories;
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
): void {
  if (a.id === b.id) return;
  adjustRapport(world, a, b.id, delta, reasonForA, rng);
  adjustRapport(world, b, a.id, delta, reasonForB, rng);
}
