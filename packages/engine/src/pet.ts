import type { Agent, World } from "./types.js";
import type { EventLog } from "./events.js";
import { adjustRapport } from "./rapport.js";
import { trustStage, type TrustStage } from "./trust.js";
import { resolveHit } from "./predation.js";
import type { LevelingContext } from "./leveling.js";

/**
 * Reaching out and touching a wild animal.
 *
 * Direct ask: *"And finally I want the ability to pet a Pokémon to try and
 * gain rapport. Need to be in 1unit range, Pokémon can react poorly, walk
 * away, or even clash. But if you have high rapport it tends to work better."*
 *
 * Deliberately the risky counterpart to `offer`. Offering is safe and
 * indirect — you put a berry down and step back, and the creature decides in
 * its own time. Petting is the opposite: it costs nothing from the pack, it
 * is immediate, and it can go wrong, because you are inside the distance a
 * wary animal keeps for a reason. That contrast is the point. The cheap verb
 * is the dangerous one.
 *
 * Two things make it a decision rather than a button you mash:
 *
 * **Trust decides the odds, not a flat roll.** The same `TrustStage` that
 * already governs how close you may come (`trust.ts`) picks the weight table
 * below. A bonded partner almost always leans in; a wary stranger mostly
 * pulls away and sometimes bites.
 *
 * **Doing it again too soon is read as pestering.** Inside
 * `PET_COOLDOWN_TICKS`, the roll uses the weights of the stage BELOW the
 * creature's real one. Not a refusal — a refusal would just be a wasted turn
 * with nothing learned — but the same act landing worse, which is what being
 * pawed at repeatedly actually feels like.
 */

export type PetOutcome =
  /** Leaned into it. Real rapport. */
  | "accepted"
  /** Held still and allowed it. Nothing gained, nothing lost. */
  | "tolerated"
  /** Stepped out of reach. A small souring. */
  | "pulledAway"
  /** Bit you. A real hit through the ordinary combat pipeline, and a real grudge. */
  | "clashed";

/**
 * How long before the same creature will take being touched as a fresh
 * gesture rather than pestering. Sim-original starting number, in the same
 * band as the other "this was a moment, not a habit" constants
 * (`HERD_CONFLICT_COOLDOWN_TICKS` = 80, `MATE_ISOLATION_TICKS` = 200) but
 * deliberately at the short end: petting should be a thing you can do a few
 * times over a camp, not once an hour. For the user to rule on against a real
 * run.
 */
export const PET_COOLDOWN_TICKS = 30;

/**
 * Outcome weights per trust stage, in `PetOutcome` order:
 * accepted / tolerated / pulledAway / clashed. Sim-original guesses — the
 * shape is what matters and is what the ask specifies ("if you have high
 * rapport it tends to work better"); the exact numbers are for the user to
 * rule on once a real run shows what they feel like.
 *
 * A bonded creature can never clash: at that point it is following you
 * through cave levels, and a bite out of nowhere would read as the sim
 * forgetting the relationship rather than as a risk you took.
 */
const PET_WEIGHTS: Record<TrustStage, readonly [number, number, number, number]> = {
  bonded: [0.8, 0.18, 0.02, 0],
  curious: [0.55, 0.25, 0.18, 0.02],
  tolerant: [0.3, 0.25, 0.35, 0.1],
  wary: [0.08, 0.12, 0.55, 0.25],
};

/** Rapport moved on the creature's own edge toward the player, per outcome. */
const PET_RAPPORT: Record<PetOutcome, number> = {
  accepted: 0.04,
  tolerated: 0,
  pulledAway: -0.02,
  clashed: -0.08,
};

const STAGE_ORDER: readonly TrustStage[] = ["wary", "tolerant", "curious", "bonded"];

/** One stage colder — what pestering, or waking something up, is treated as. */
function oneStageDown(stage: TrustStage): TrustStage {
  return STAGE_ORDER[Math.max(0, STAGE_ORDER.indexOf(stage) - 1)]!;
}

/** Chebyshev — this game's adjacency, diagonals included. */
function reach(a: Agent, b: Agent): number {
  return Math.max(Math.abs(a.pos.x - b.pos.x), Math.abs(a.pos.y - b.pos.y));
}

/**
 * Whether `target` is something this agent could reach out and touch right
 * now. The web UI asks this to decide whether to offer the verb at all — a
 * button that is always there and usually fails is worse than no button.
 */
export function canPet(world: World, agent: Agent, target: Agent): boolean {
  if (target.id === agent.id || target.alive === false || target.isEgg) return false;
  if (target.layer !== agent.layer) return false;
  return reach(agent, target) <= 1;
}

function pickOutcome(weights: readonly [number, number, number, number], roll: number): PetOutcome {
  const order: PetOutcome[] = ["accepted", "tolerated", "pulledAway", "clashed"];
  let acc = 0;
  for (let i = 0; i < order.length; i++) {
    acc += weights[i]!;
    if (roll < acc) return order[i]!;
  }
  return "tolerated";
}

/** A walkable, unoccupied tile one step away from `agent`, away from `from` where possible. */
function stepBackFrom(world: World, agent: Agent, from: Agent, tileWalkable: (x: number, y: number) => boolean): { x: number; y: number } | undefined {
  const away = { x: Math.sign(agent.pos.x - from.pos.x), y: Math.sign(agent.pos.y - from.pos.y) };
  const candidates = [
    { x: agent.pos.x + away.x, y: agent.pos.y + away.y },
    { x: agent.pos.x + away.x, y: agent.pos.y },
    { x: agent.pos.x, y: agent.pos.y + away.y },
  ];
  for (const c of candidates) {
    if (!tileWalkable(c.x, c.y)) continue;
    if (world.agents.some((a) => a.alive !== false && a.layer === agent.layer && a.pos.x === c.x && a.pos.y === c.y)) continue;
    return c;
  }
  return undefined;
}

export interface PetResult {
  outcome: PetOutcome;
  /** The stage the roll actually used — one below the creature's real one when pestering or startled. */
  stageUsed: TrustStage;
  /** True when the gesture landed inside `PET_COOLDOWN_TICKS` of the last one. */
  tooSoon: boolean;
  /** True when the creature was asleep and this woke it. */
  woke: boolean;
}

/**
 * Resolves one attempt to pet `target`. Returns undefined only when the
 * gesture could not be attempted at all (out of reach, wrong layer, dead),
 * which the caller should treat as "no turn spent" — everything else is a
 * real outcome, including the bad ones.
 */
export function applyPet(
  world: World,
  agent: Agent,
  target: Agent,
  log: EventLog | undefined,
  ctx: LevelingContext | undefined,
  rng: () => number,
  tileWalkable: (x: number, y: number) => boolean,
): PetResult | undefined {
  if (!canPet(world, agent, target)) return undefined;

  const real = trustStage(world, target, agent.id);
  const lastPet = target.lastPetTick;
  const tooSoon = lastPet !== undefined && world.tick - lastPet < PET_COOLDOWN_TICKS;
  // Waking something by touching it is its own kind of bad start, and stacks
  // with pestering rather than replacing it — being shaken awake by someone
  // who has been at you all morning is worse than either alone.
  const woke = target.asleep === true;
  let stageUsed = real;
  if (tooSoon) stageUsed = oneStageDown(stageUsed);
  if (woke) stageUsed = oneStageDown(stageUsed);

  const outcome = pickOutcome(PET_WEIGHTS[stageUsed], rng());
  target.lastPetTick = world.tick;
  if (woke) target.asleep = false;

  const delta = PET_RAPPORT[outcome];
  if (delta !== 0) {
    // The `"petted"` MEMORY is only written when the creature actually
    // accepted it. The score still moves on the souring outcomes — pulling
    // away and biting are both real — but a memory reading "He has petted me
    // four times" on an edge where three of those were flinches would be the
    // prose lying about what happened. A reason is optional on
    // `adjustRapport` precisely so a score can move without a claim attached.
    const reason = outcome === "accepted" ? ("petted" as const) : undefined;
    adjustRapport(world, target, agent.id, delta, reason, rng, reason ? { label: agent.species, id: agent.id, standing: "friend" } : undefined);
  }

  if (outcome === "pulledAway") {
    const spot = stepBackFrom(world, target, agent, tileWalkable);
    if (spot) target.pos = spot;
  } else if (outcome === "clashed") {
    // A real hit through the ordinary combat pipeline, same as any wild
    // attack — not a special-cased scratch. Getting bitten for touching
    // something that did not want to be touched should cost what being
    // bitten costs.
    resolveHit(world, target, agent, log, "defeated", ctx, 1, rng);
  }

  log?.record({
    kind: "petted",
    tick: world.tick,
    agentId: agent.id,
    species: agent.species,
    targetId: target.id,
    targetSpecies: target.species,
    outcome,
    stage: stageUsed,
  });

  return { outcome, stageUsed, tooSoon, woke };
}
