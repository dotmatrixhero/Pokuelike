import type { Agent, Layer, Needs, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { ensureCombatProfile, type LevelingContext } from "./leveling.js";
import { dispositionFromNature, randomNature } from "./nature.js";

/**
 * Eggs — point 4 of the bonding/shelter/egg feature (see reproduction.ts's
 * top-of-file doc comment and DESIGN.md's "Bonding, shelter, and eggs"
 * section). Direct instruction: once a bonded pair has real shelter access,
 * mating produces a real egg instead of an instant newborn — represented as
 * a real `Agent` with `isEgg: true` (reusing the existing type gets
 * position/hp/predation-targeting/rendering almost for free, per direct
 * instruction, rather than inventing a whole parallel entity type).
 *
 * An egg is stationary and behavior-less: `simulation.ts`'s `tickWorld`
 * routes every `isEgg` agent straight to `tickEgg` below and skips the
 * ordinary `tickAgentNeeds`/`tickAgentAction` pipeline for it entirely — no
 * hunger/thirst decay, no movement, no action-economy participation, and (see
 * predation.ts/herding.ts/reproduction.ts) it's explicitly excluded from
 * every herd/threat/mate/prey scan elsewhere in the engine, so it can never
 * get swept into ordinary fleeing/hunting/herd-cohesion/mate-seeking logic.
 * The only things that ever touch an egg are: `tickEgg` (incubation/hatch),
 * predation.ts's `applyEggDefense` (a nearby parent/herd-mate fighting to
 * protect it), and predation.ts's `applyEggEating` (a non-egg-group-
 * compatible agent opportunistically eating it).
 */

function freshNeeds(): Needs {
  return { hunger: 1, thirst: 1, energy: 1, mateDrive: 0 };
}

/**
 * How many ticks an egg incubates before hatching — same order of magnitude
 * as this codebase's other real multi-stage-process constants
 * (`shelter.ts`'s `SHELTER_BUILD_TICKS` = 40, `reproduction.ts`'s
 * `MATURITY_AGE` = 200): long enough to read as a genuine, real incubation
 * period a predator/egg-eater has a real window to interrupt (point 6's
 * whole reason to exist), short enough that a real multi-thousand-tick run
 * sees several full bond -> shelter -> egg -> hatch cycles, not just the
 * first one barely completing. Sim-original tuning guess — judge against a
 * real run like every other constant in this codebase; see DESIGN.md's
 * real-run findings for whether this needs to move.
 */
export const EGG_INCUBATION_TICKS = 80;

/**
 * Clutch size — follow-up to the original single-egg design, per direct
 * ask ("maybe we can have multiple eggs spawn at once instead of one at a
 * time"). Real-run validation of the original point-4 design (see
 * DESIGN.md) showed the bond -> shelter -> lay pipeline itself is the slow,
 * high-stakes part (80-tick incubation, a real ~40-tick shelter build/travel
 * task before that), and that pacing is explicitly NOT being touched here —
 * the user likes it. A clutch is the intended lever instead: a SINGLE
 * successful laying event now produces multiple eggs at once, so a
 * household that clears the whole slow pipeline gets more population out of
 * that one success, without making the pipeline itself any easier or faster
 * to clear.
 *
 * Real animal clutch sizes vary enormously (a bird lays 1-2, a reptile can
 * lay dozens) — no attempt at canon accuracy here, just a real, modest,
 * sim-original number in the same "judge it against a real run" spirit as
 * every other tuning constant in this file. 2-4 (uniform, inclusive) is
 * deliberately small: enough to meaningfully raise the population curve
 * without letting one lucky laying event dominate growth on its own (that
 * would just move the "one contact = a population explosion" problem this
 * whole feature was built to avoid from the mating step to the laying
 * step). See `pickClutchSize`.
 */
export const EGG_CLUTCH_MIN = 2;
export const EGG_CLUTCH_MAX = 4;

/**
 * Draws a real clutch size in `[EGG_CLUTCH_MIN, EGG_CLUTCH_MAX]` — always
 * through the passed-in `rng`, never `Math.random` directly, per this
 * codebase's determinism rule (see `determinism.test.ts`). The caller
 * (`reproduction.ts`'s `applyMateSeeking`) is responsible for actually
 * placing that many eggs against real shelter-cluster capacity — this
 * function only decides how many eggs a household is TRYING to lay, not how
 * many actually fit.
 */
export function pickClutchSize(rng: () => number): number {
  const span = EGG_CLUTCH_MAX - EGG_CLUTCH_MIN + 1;
  return EGG_CLUTCH_MIN + Math.floor(rng() * span);
}

/**
 * An egg's own hp/maxHp — small and mostly cosmetic (predation.ts/
 * support.ts's combat-adjacent code paths expect *some* hp/maxHp on any
 * agent they might touch, and eggs are never actually damaged down through
 * this — `applyEggEating` consumes an egg outright in one action, matching
 * "eating an egg is the same as killing and eating prey," not a multi-hit
 * fight the way a real prey animal's hp bar is). Deliberately tiny: an egg
 * is fragile, not something anyone would need to "fight through."
 */
const EGG_HP = 5;

/**
 * Builds (but does not push onto `world.agents` or log — the caller,
 * `reproduction.ts`'s `applyMateSeeking`, does both, matching how
 * `spawnOffspring` used to work before this feature) a new unhatched egg at
 * `pos`. Species/herd/parentage/home-range are all inherited from the
 * mother at lay time, exactly as an instant newborn's used to be — only the
 * nature/disposition/stat-block assignment moves to hatch time (`tickEgg`
 * below), since a hatchling's individual traits reading as "decided the
 * moment it hatches" is the more natural fit for an egg than "already fixed
 * inside the shell."
 */
export function spawnEgg(world: World, mother: Agent, father: Agent, pos: Vec2, sequence: number): Agent {
  return {
    id: `egg-${mother.species}-${world.tick}-${sequence}`,
    species: mother.species,
    pos: { ...pos },
    layer: mother.layer,
    homeLayer: mother.homeLayer,
    homePos: mother.homePos ?? { ...mother.pos },
    needs: freshNeeds(),
    behavior: "idle",
    herdId: mother.herdId,
    isEgg: true,
    eggTicks: 0,
    hp: EGG_HP,
    maxHp: EGG_HP,
    age: 0,
    parentIds: [mother.id, father.id],
    grandparentIds: [...new Set([...(mother.parentIds ?? []), ...(father.parentIds ?? [])])],
    // Denormalized straight from the mother (same species family — an
    // evolved/base-form pair still shares the same hunting temperament) so
    // `applyEggDefense`'s species-conditional lethality check (predation.ts)
    // has something to read the moment an egg exists, not only after it
    // hatches.
    isPredator: mother.isPredator,
    // Same "denormalized straight from the mother" reasoning as `isPredator`
    // immediately above — an obligate-aquatic mother's egg (and, once
    // hatched, hatchling) is restricted from the moment it exists, not just
    // once `ensureCombatProfile` happens to run for it.
    obligateAquatic: mother.obligateAquatic,
  };
}

/**
 * Once per world tick, for every living `isEgg` agent (see `simulation.ts`'s
 * `tickWorld`, which routes eggs here instead of the ordinary needs/action
 * pipeline). Increments `eggTicks`; once it crosses `EGG_INCUBATION_TICKS`,
 * hatches in place — the exact same agent object turns into the real
 * newborn `spawnOffspring` (reproduction.ts) used to create directly, just
 * delayed and gated on the egg actually surviving incubation. Mutating in
 * place (rather than removing the egg and pushing a fresh agent) keeps the
 * id stable and avoids any array-splice bookkeeping mid-`tickWorld` loop.
 */
export function tickEgg(world: World, agent: Agent, log: EventLog | undefined, ctx: LevelingContext | undefined, rng: () => number): void {
  // Defensive no-op for an already-hatched agent — `simulation.ts` only
  // ever calls this while `agent.isEgg` is still true, but tests (and any
  // future caller) shouldn't have to call this exactly N times to stay
  // safe.
  if (!agent.isEgg) return;
  agent.eggTicks = (agent.eggTicks ?? 0) + 1;
  if (agent.eggTicks < EGG_INCUBATION_TICKS) return;

  // Breeding always produces the base (pre-evolution) form — same rule
  // `spawnOffspring` applies, just evaluated at hatch time here since an
  // egg is laid as its mother's own (possibly evolved) species.
  const baseSpecies = ctx?.baseSpeciesOf?.(agent.species) ?? agent.species;
  agent.species = baseSpecies;
  agent.isEgg = undefined;
  agent.eggTicks = undefined;
  agent.needs = freshNeeds();
  agent.behavior = "idle";
  agent.sex = rng() < 0.5 ? "male" : "female";
  agent.age = 0;
  // Notables: The Wanderer's anchor — a hatchling's real birth position is
  // wherever its egg was laid (still its current `pos`, an egg never
  // moves), not inherited from its mother's own `homePos` (see
  // Agent.birthPos's doc comment).
  agent.birthPos = { ...agent.pos };
  agent.level = 1;
  agent.exp = 0;
  agent.hp = undefined;
  agent.maxHp = undefined;
  const nature = randomNature(rng);
  agent.nature = nature;
  agent.disposition = dispositionFromNature(nature, rng);
  // Backfills stats/hp/types/moves for the base species at level 1 — see
  // `spawnOffspring`'s identical call for why this is needed at all.
  ensureCombatProfile(agent, ctx);

  world.eggsHatched = (world.eggsHatched ?? 0) + 1;
  // Notables: The Beloved's real stat — counted for both parents once this
  // egg actually survives incubation and hatches (not at lay time — see
  // Agent.lifetimeOffspring's doc comment for why "hatched," not "laid,"
  // was chosen). `parentIds` is still this hatchling's own, set once at
  // `spawnEgg` and untouched by anything above.
  for (const parentId of agent.parentIds ?? []) {
    const parent = world.agents.find((a) => a.id === parentId);
    if (parent) parent.lifetimeOffspring = (parent.lifetimeOffspring ?? 0) + 1;
  }
  log?.record({
    kind: "eggHatched",
    tick: world.tick,
    agentId: agent.id,
    species: agent.species,
    layer: agent.layer,
    pos: { ...agent.pos },
  });
}

/** True for a living, unhatched egg — the shared "is this thing an egg, not a normal agent" guard other modules filter on. */
export function isLivingEgg(agent: Agent): boolean {
  return agent.isEgg === true && agent.alive !== false;
}
