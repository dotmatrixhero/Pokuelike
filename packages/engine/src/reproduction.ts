import type { Agent, Layer, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { stepTowardMovingTarget } from "./pathfinding.js";
import { tileAt } from "./world.js";
import { EXP_ON_BIRTH_PARENT, EXP_ON_MATE_ATTEMPT, canBreed, grantExp, type LevelingContext } from "./leveling.js";
import { herdCentroid, herdRank, herdSize } from "./herding.js";
import { RAPPORT_BONDING_DELTA, rapportScore, strengthenRapportMutual } from "./rapport.js";
import { hasNearbyShelter, SHELTER_SEARCH_RADIUS } from "./shelter.js";
import { canLayEggAt, shelterCluster } from "./occupancy.js";
import { pickClutchSize, spawnEgg } from "./eggs.js";

/**
 * Ticks before an agent can mate. A single global constant for now — real
 * per-species maturity rates (a Venusaur maturing slower than a Pidgey) are
 * a data-layer refinement for later, not an engine change.
 */
export const MATURITY_AGE = 200;
/** Baseline mate-search radius at neutral (0.5) sociability — see `mateSearchRadius`. */
const MATE_SEARCH_RADIUS = 5;
/** How far sociability can push the search radius from baseline in either direction. */
const MATE_SEARCH_SPREAD = 2;

/**
 * More sociable agents search farther/more readily for a mate; less sociable
 * ones are choosier about proximity. Deliberately the *only* sociability
 * hook for now — full herd cohesion is still unbuilt, see DESIGN.md. Absent
 * disposition (hand-built fixtures) reads as neutral (0.5), reproducing the
 * original fixed 5-tile radius exactly.
 */
function mateSearchRadius(agent: Agent): number {
  const sociability = agent.disposition?.sociability ?? 0.5;
  return MATE_SEARCH_RADIUS + (sociability - 0.5) * (2 * MATE_SEARCH_SPREAD);
}

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isMature(agent: Agent): boolean {
  return agent.age === undefined || agent.age >= MATURITY_AGE;
}

/**
 * Direct instruction: breeding needs a real earned edge on top of plain
 * age-maturity — either an evolution, or enough levels to get there some
 * other way. Lowered from 16 -> 12, paired with a slight exp-gain bump
 * (`EXP_TRICKLE_PER_TICK`/`EXP_ON_CONSUME` in leveling.ts): a real run at
 * 16 showed births collapsing to 1-4 per 3000-tick run even after
 * quartering hunger/thirst decay — the bottleneck was exp pace, not
 * survival time, so lowering the threshold (973 vs. 2535 total exp for a
 * Medium Slow species at 12 vs. 16) is the more direct fix. See TODO.md.
 */
export const MIN_BREEDING_LEVEL_UNEVOLVED = 12;

/**
 * Extra breeding gate on top of `isMature`'s plain age check: an agent may
 * breed once it's *either* evolved at least once (any stage past its base
 * form — `ctx.baseSpeciesOf` maps a species id back to its base form, so
 * `species !== baseSpeciesOf(species)` means "has evolved") *or* reached
 * `MIN_BREEDING_LEVEL_UNEVOLVED` without evolving (e.g. a species whose
 * evolution threshold sits well above 12, or one that never evolves at
 * all). Without `ctx` or `agent.level` (bare test fixtures that don't set
 * either), reads as eligible — same "no data, don't block" convention
 * `isMature` itself uses for `agent.age`.
 */
export function meetsBreedingRequirement(agent: Agent, ctx?: LevelingContext): boolean {
  const baseSpecies = ctx?.baseSpeciesOf?.(agent.species);
  if (baseSpecies !== undefined && baseSpecies !== agent.species) return true;
  if (agent.level === undefined) return true;
  return agent.level >= MIN_BREEDING_LEVEL_UNEVOLVED;
}

/**
 * Inbreeding avoidance: blocks direct parent/offspring, full or half
 * siblings (share at least one parent), and grandparent/grandchild pairs.
 * Founders (spawned directly into a scenario, no `parentIds`) are never
 * "related" to anything by this check — real gap, since two founders of
 * the same species are conceptually unrelated strangers, which is exactly
 * right. Confirmed real bug this fixes: a founding Venusaur guardian with
 * no predator fathered most of a herd's growth over a real run, including
 * with his own daughters and granddaughters.
 */
function isRelated(agent: Agent, candidate: Agent): boolean {
  const agentParents: string[] = agent.parentIds ?? [];
  const candidateParents: string[] = candidate.parentIds ?? [];
  if (agentParents.includes(candidate.id) || candidateParents.includes(agent.id)) return true;
  if (agentParents.length > 0 && candidateParents.some((id) => agentParents.includes(id))) return true;
  if ((agent.grandparentIds ?? []).includes(candidate.id)) return true;
  if ((candidate.grandparentIds ?? []).includes(agent.id)) return true;
  return false;
}

/**
 * Consecutive ticks a herd-locked agent must go with zero eligible mates
 * spotted (`Agent.ticksSinceEligibleMate`, maintained just below in
 * `applyMateSeeking` and already consumed by dispersal.ts's own guaranteed
 * fallback trigger) before its herd affiliation stops blocking an
 * otherwise-eligible candidate in a *different* nearby herd. This is the fix
 * for the confirmed "permanently locked to a herd of one" dead end: when
 * `finishDispersal` (dispersal.ts) can't find an existing herd to join, it
 * founds a brand-new herd containing exactly that one disperser — with the
 * unconditional `agent.herdId && agent.herdId !== candidate.herdId` rule
 * this replaces, that individual (and any solo/small herd that simply has no
 * opposite-sex mature member right now) could never mate again short of
 * another disperser independently wandering into that exact herd later, a
 * low-probability event on a large map. See DESIGN.md's "Cross-herd mating
 * escape hatch" section (next to "Natal dispersal") for the full reasoning
 * and real before/after run numbers.
 *
 * Deliberately much shorter than dispersal.ts's `NO_MATES_DISPERSAL_TICKS`
 * (1000): that threshold gates *physically relocating* an agent across the
 * map to go look for a new herd, which is rightly patient. This threshold
 * instead only widens who an agent *already standing right where it is* (the
 * common case for a solo founder, which never moves again once founded) is
 * willing to consider within its ordinary, unchanged `mateSearchRadius` —
 * there's no relocation cost to letting that happen sooner, so it doesn't
 * need dispersal's own tuning. Set at this codebase's usual "sustained, not
 * a single bad tick" order of magnitude (matching
 * `herdMigration.ts`'s `SCARCITY_SUSTAIN_TICKS`-style constants) — long
 * enough that a herd's mate briefly stepping outside search range for a few
 * ticks doesn't make the whole herd distinction meaningless, short enough
 * that a genuinely sterile herd doesn't sit dead for anywhere near
 * dispersal's full 1000-tick patience before this kicks in.
 */
export const MATE_ISOLATION_TICKS = 200;

function isEligibleMate(agent: Agent, candidate: Agent, ctx?: LevelingContext): boolean {
  if (candidate.id === agent.id || candidate.alive === false) return false;
  if (candidate.isEgg) return false; // an unhatched egg is never a mate candidate
  if (candidate.fainted || candidate.beingCarriedBy) return false; // downed or being carried — not available to mate
  // Real mainline rule: species mate if they share an egg group, not only
  // with their own exact species — e.g. Bulbasaur and Charmander (both
  // "monster") are a real cross-species breeding pair. See canBreed.
  if (!canBreed(agent.species, candidate.species, ctx) || candidate.layer !== agent.layer) return false;
  if (!agent.sex || !candidate.sex || agent.sex === candidate.sex) return false;
  if (!isMature(candidate) || !meetsBreedingRequirement(candidate, ctx)) return false;
  if (candidate.behavior === "flee") return false; // don't interrupt a fleeing mate
  if (isRelated(agent, candidate)) return false;
  // Herd animals normally pair within their herd; solitary agents (no
  // herdId) aren't restricted. Escape hatch: once *either* party's own herd
  // has gone MATE_ISOLATION_TICKS with zero eligible mates in range, herd
  // affiliation stops blocking this otherwise-eligible candidate — checking
  // both sides (not just `agent`'s) matters because mating actually happens
  // on the *female's* turn in applyMateSeeking below: without this, an
  // isolated male could walk right up to a non-isolated female in another
  // herd and still never breed, since her own (unwidened) scan would never
  // have listed him as a candidate to begin with.
  if (agent.herdId && agent.herdId !== candidate.herdId) {
    const agentIsolated = (agent.ticksSinceEligibleMate ?? 0) >= MATE_ISOLATION_TICKS;
    const candidateIsolated = (candidate.ticksSinceEligibleMate ?? 0) >= MATE_ISOLATION_TICKS;
    if (!agentIsolated && !candidateIsolated) return false;
  }
  return true;
}

/**
 * Rank-aware mate preference — DESIGN.md's "Herd status" payoff 2. A
 * higher-status candidate (lower `herdRank`, i.e. higher level relative to
 * its herd-mates) is worth walking a little farther for, but distance still
 * dominates a real gap: this awards a top-ranked candidate a "discount" of
 * at most `STATUS_DISTANCE_BONUS` tiles off its effective distance, scaled
 * down toward 0 for a lower-ranked one. That bonus can only ever tip a close
 * call (candidates within ~`STATUS_DISTANCE_BONUS` tiles of each other) —
 * it's small next to `mateSearchRadius`'s ~3-7 tile range, so a candidate
 * that's merely nearer by more than the bonus always still wins, matching
 * the direct instruction ("distance still matters, status tips close calls,
 * it doesn't override a huge distance gap").
 */
const STATUS_DISTANCE_BONUS = 2;

/**
 * Rapport-aware mate preference — the other half of `mateScore`'s
 * composition, added alongside (not replacing) `STATUS_DISTANCE_BONUS`
 * above: an agent with an existing positive rapport edge to a candidate (a
 * herd-mate it's repeatedly food-delivered to, fought alongside in a
 * mob-defense, or simply already bonded to before — re-encountering an
 * already-bonded partner is exactly this path too) is worth walking a little
 * farther for than a stranger at the same distance/rank, same "discount off
 * effective distance, distance still dominates a real gap" shape
 * `STATUS_DISTANCE_BONUS` already established, reused rather than a parallel
 * mechanism. Set slightly above `STATUS_DISTANCE_BONUS` (3 vs. 2) — a real,
 * earned relationship (which for a full 1.0 score most realistically means
 * an already-bonded partner) is a stronger signal than relative herd rank,
 * but both remain small next to `mateSearchRadius`'s ~3-7 tile range, so
 * this still only ever tips a close call, never overrides a real distance
 * gap. Only the *positive* half of the -1..1 range attracts here — a
 * negative (grudge) rapport doesn't repel mate choice on its own; that's
 * `herdConflict.ts`'s targeting concern, not this one.
 */
const RAPPORT_DISTANCE_BONUS = 3;

/**
 * Notable-title mate preference — direct ask ("socially they are
 * respected"), the mate-preference half of that (see notables.ts's
 * top-of-file doc comment; the other half is `NOTABLE_XP_MULTIPLIER`). Same
 * "discount off effective distance, distance still dominates a real gap"
 * shape as `STATUS_DISTANCE_BONUS`/`RAPPORT_DISTANCE_BONUS` above, applied
 * as a flat bonus (not scaled 0..1 like the other two — holding a title is
 * binary, there's no "partial" title to scale by) whenever `candidate`
 * currently holds any Notables title. Set between the two existing bonuses
 * (2.5, vs. status's 2 and rapport's 3): a title is a real, earned,
 * world-wide distinction — a stronger signal than relative herd rank, since
 * it's judged against literally everyone in the world, not just herd-mates
 * — but a full, already-earned rapport bond (which most realistically means
 * an actual existing mate) is still judged the stronger of the two.
 */
const NOTABLE_DISTANCE_BONUS = 2.5;

/** 0 (no/negative rapport) .. 1 (a full, earned bond) — how much of `RAPPORT_DISTANCE_BONUS` a candidate earns. */
function rapportAdvantage(agent: Agent, candidate: Agent, tick: number): number {
  return Math.max(0, rapportScore(agent, candidate.id, tick));
}

/**
 * 0 (lowest-ranked herd-mate) .. 1 (highest-ranked, rank 1) — how much of
 * `STATUS_DISTANCE_BONUS` a candidate earns. A solitary candidate (herd size
 * 1, e.g. no herdId) is trivially top-ranked but there's no one to outrank,
 * so it still resolves to 1 rather than being penalized for having no herd —
 * harmless either way since `nearestMate` only compares candidates that are
 * already otherwise eligible.
 */
function statusAdvantage(world: World, candidate: Agent): number {
  const size = candidate.herdId ? herdSize(world, candidate.herdId) : 1;
  if (size <= 1) return 1;
  const rank = herdRank(world, candidate);
  return (size - rank) / (size - 1);
}

/**
 * Effective distance used to rank candidates: real Manhattan distance minus
 * a status-scaled discount (see `statusAdvantage`/`STATUS_DISTANCE_BONUS`
 * above). Lower is more attractive, same sense as the old pure-distance
 * comparison this replaces.
 */
function mateScore(world: World, agent: Agent, candidate: Agent, distance: number): number {
  return (
    distance -
    statusAdvantage(world, candidate) * STATUS_DISTANCE_BONUS -
    rapportAdvantage(agent, candidate, world.tick) * RAPPORT_DISTANCE_BONUS -
    (candidate.notableTitle !== undefined ? NOTABLE_DISTANCE_BONUS : 0)
  );
}

function nearestMate(world: World, agent: Agent, candidates: Agent[]): Agent | undefined {
  let best: Agent | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const dist = manhattan(agent.pos, candidate.pos);
    const score = mateScore(world, agent, candidate, dist);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * A shelter tile this agent's household (its own current position, or its
 * herd's live centroid — same anchor `shelter.ts`'s
 * `maybeTriggerShelterBuilding` uses) actually has access to right now, or
 * `undefined` if none is within range. Point 4's gate for egg-laying: a
 * bonded pair only produces an egg once this resolves to a real tile —
 * before that, mating just bonds (see `applyMateSeeking`).
 */
function householdShelterTile(world: World, agent: Agent): Vec2 | undefined {
  const anchor = agent.herdId ? (herdCentroid(world, agent.herdId, agent.layer) ?? agent.pos) : agent.pos;
  if (!hasNearbyShelter(world, agent.layer, anchor, SHELTER_SEARCH_RADIUS)) return undefined;
  // hasNearbyShelter only answers yes/no — find the actual nearest shelter
  // tile (from the agent's own position, not the anchor, since that's where
  // the egg needs to actually sit reachably) to hand to the capacity check
  // and `spawnEgg`. A plain bounded scan, same shape as `hasNearbyShelter`
  // itself — shelters are sparse, this is cheap.
  let best: Vec2 | undefined;
  let bestDist = Infinity;
  for (let dy = -SHELTER_SEARCH_RADIUS; dy <= SHELTER_SEARCH_RADIUS; dy++) {
    for (let dx = -SHELTER_SEARCH_RADIUS; dx <= SHELTER_SEARCH_RADIUS; dx++) {
      const pos = { x: agent.pos.x + dx, y: agent.pos.y + dy };
      if (tileAt(world, agent.layer, pos.x, pos.y)?.terrain !== "shelter") continue;
      const dist = manhattan(agent.pos, pos);
      if (dist < bestDist) {
        bestDist = dist;
        best = pos;
      }
    }
  }
  return best;
}

/**
 * A shelter tile in `anchor`'s cluster with room for one more egg
 * (`canLayEggAt`), preferring `anchor` itself, otherwise the nearest
 * cluster-mate with room. `undefined` if the whole cluster is already at its
 * egg cap — a real, testable capacity gate (point 2), not just "a shelter
 * exists somewhere."
 */
function pickEggTile(world: World, layer: Layer, anchor: Vec2): Vec2 | undefined {
  if (canLayEggAt(world, layer, anchor)) return anchor;
  for (const tile of shelterCluster(world, layer, anchor)) {
    if (canLayEggAt(world, layer, tile)) return tile;
  }
  return undefined;
}

/**
 * Called when chooseBehavior has already picked "seekMate". Finds the
 * nearest eligible mate (same species/layer, normally same herd — see
 * `isEligibleMate`'s `MATE_ISOLATION_TICKS` escape hatch for the sustained-
 * isolation exception — opposite sex, mature) and either closes distance or,
 * once adjacent, bonds/breeds — the mother's turn triggers this so a pair
 * doesn't double-act the same tick.
 *
 * Direct instruction ("I will want eggs rather than them just spawning
 * offspring... Pokemon can mate before shelter but that only means they
 * bond and increase need for shelter... They don't lay egg until after
 * shelter is created"): contact between an eligible pair no longer produces
 * an instant newborn (see DESIGN.md's "Bonding, shelter, and eggs" section
 * for the full design and real-run numbers):
 * 1. First contact bonds the pair (`Agent.bondedPartnerId` on both) if not
 *    already bonded to each other — a real, lasting state
 *    `shelter.ts`'s `maybeTriggerShelterBuilding` biases toward resolving.
 * 2. Every contact after that (bonded or not — an already-bonded pair meets
 *    up again the same way) checks whether the household already has real
 *    shelter access with egg-capacity room (`householdShelterTile`/
 *    `pickEggTile`, occupancy.ts's shelter cluster cap) — only then does an
 *    egg actually get laid (`eggs.ts`'s `spawnEgg`), at the shelter, not the
 *    parents' own tile.
 * Both parents' mateDrive resets on any contact either way (bonding-only or
 * a real egg) — mating "happened," just not always with an egg to show for
 * it yet, matching the direct ask that mating before shelter still means
 * something (the bond + the shelter drive it feeds) rather than a no-op.
 */
export function applyMateSeeking(
  world: World,
  agent: Agent,
  log?: EventLog,
  ctx?: LevelingContext,
  rng: () => number = Math.random
): void {
  if (!agent.sex || !isMature(agent) || !meetsBreedingRequirement(agent, ctx)) return;

  const candidates = world.agents.filter(
    (other) => isEligibleMate(agent, other, ctx) && manhattan(agent.pos, other.pos) <= mateSearchRadius(agent)
  );
  // Feeds dispersal.ts's guaranteed "sustained zero eligible mates" fallback
  // trigger — piggybacks on this scan (already paid for every time this
  // function runs) rather than dispersal.ts paying for a second one of its
  // own. Reset to 0 the moment even one candidate is visible, regardless of
  // whether a partner ends up close enough to actually breed with this tick.
  agent.ticksSinceEligibleMate = candidates.length > 0 ? 0 : (agent.ticksSinceEligibleMate ?? 0) + 1;
  const partner = nearestMate(world, agent, candidates);
  if (!partner) return;

  if (manhattan(agent.pos, partner.pos) <= 1) {
    if (agent.sex === "female") {
      if (agent.bondedPartnerId !== partner.id) {
        agent.bondedPartnerId = partner.id;
        partner.bondedPartnerId = agent.id;
        world.bondsFormed = (world.bondsFormed ?? 0) + 1;
        // Rapport: a real, immediate jump — bonding is already a deliberate,
        // rare, significant event (fires once per pair, never incrementally
        // repeated), so it carries a much bigger single jump than an
        // ordinary interaction's small nudge. See rapport.ts's doc comment.
        strengthenRapportMutual(world, agent, partner, RAPPORT_BONDING_DELTA, rng);
        log?.record({
          kind: "bonded",
          tick: world.tick,
          agentId: agent.id,
          species: agent.species,
          partnerId: partner.id,
          partnerSpecies: partner.species,
          pos: { ...agent.pos },
        });
      }

      const shelterTile = householdShelterTile(world, agent);
      // Follow-up: clutch, not one egg (see DESIGN.md's "Follow-up: clutch
      // size" subsection). `pickClutchSize` decides how many eggs this
      // laying event is TRYING for; the loop below places as many as
      // actually fit, re-checking `pickEggTile`'s real shelter-cluster
      // capacity (`canLayEggAt`) after each placement — each pushed egg
      // immediately counts against the next check via
      // `occupancy.ts`'s live `world.agents` scan, so a clutch is capped by
      // genuine available room, not just dumped in regardless of it. A
      // clutch that doesn't fully fit simply lays fewer eggs; the excess is
      // dropped (not queued or held for later) — the simplest, most
      // defensible choice given the whole point is "a bigger, more
      // successful household reliably gets more eggs out of a clutch," and
      // the user didn't ask for an egg-holding-pattern mechanic.
      let laidThisEvent = 0;
      if (shelterTile) {
        const clutchSize = pickClutchSize(rng);
        for (let i = 0; i < clutchSize; i++) {
          const eggTile = pickEggTile(world, agent.layer, shelterTile);
          if (!eggTile) break; // cluster's egg capacity is exhausted — rest of the clutch is lost
          world.offspringSequence = (world.offspringSequence ?? 0) + 1;
          const egg = spawnEgg(world, agent, partner, eggTile, world.offspringSequence);
          world.agents.push(egg);
          world.eggsLaid = (world.eggsLaid ?? 0) + 1;
          laidThisEvent++;
          log?.record({
            kind: "eggLaid",
            tick: world.tick,
            motherId: agent.id,
            fatherId: partner.id,
            eggId: egg.id,
            species: egg.species,
            layer: egg.layer,
            pos: { ...egg.pos },
          });
        }
      }
      if (laidThisEvent > 0) {
        // Exp is granted once per successful laying EVENT, not once per egg
        // in the clutch — a deliberate choice: the parents did one real
        // thing (successfully laid a clutch), and scaling exp with clutch
        // size would let clutch-size rng also swing leveling speed, which
        // isn't what this follow-up is about.
        grantExp(world, agent, EXP_ON_BIRTH_PARENT, ctx, log, rng);
        grantExp(world, partner, EXP_ON_BIRTH_PARENT, ctx, log, rng);
      }
      // No household shelter (or its cluster is already at egg capacity)
      // yet — bonded (or already was), but no egg this contact. The pair
      // just keeps meeting up until shelter access exists somewhere in
      // range; shelter.ts's bonded comfort discount biases them toward
      // resolving that sooner rather than later.
    }
    agent.needs.mateDrive = 0;
    partner.needs.mateDrive = 0;
  } else {
    grantExp(world, agent, EXP_ON_MATE_ATTEMPT, ctx, log, rng);
    // A mate-seeking partner moves every tick, same as a hunt target — see
    // `stepTowardMovingTarget`'s own doc comment (pathfinding.ts) for why
    // this needs its own staleness/recompute handling rather than plain
    // `stepToward` or `stepAlongPath`'s static-target cache match.
    agent.pos = stepTowardMovingTarget(world, agent, partner);
  }
}
