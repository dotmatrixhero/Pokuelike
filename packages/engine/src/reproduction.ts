import type { Agent, Layer, Needs, Vec2, World } from "./types.js";
import type { EventLog } from "./events.js";
import { stepToward } from "./movement.js";
import { tileAt } from "./world.js";
import { EXP_ON_BIRTH_PARENT, EXP_ON_MATE_ATTEMPT, canBreed, ensureCombatProfile, grantExp, type LevelingContext } from "./leveling.js";

/**
 * Ticks before an agent can mate. A single global constant for now — real
 * per-species maturity rates (a Venusaur maturing slower than a Pidgey) are
 * a data-layer refinement for later, not an engine change.
 */
export const MATURITY_AGE = 200;
const MATE_SEARCH_RADIUS = 5;

function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function isMature(agent: Agent): boolean {
  return agent.age === undefined || agent.age >= MATURITY_AGE;
}

function isEligibleMate(agent: Agent, candidate: Agent, ctx?: LevelingContext): boolean {
  if (candidate.id === agent.id || candidate.alive === false) return false;
  if (candidate.fainted || candidate.beingCarriedBy) return false; // downed or being carried — not available to mate
  // Real mainline rule: species mate if they share an egg group, not only
  // with their own exact species — e.g. Bulbasaur and Charmander (both
  // "monster") are a real cross-species breeding pair. See canBreed.
  if (!canBreed(agent.species, candidate.species, ctx) || candidate.layer !== agent.layer) return false;
  if (!agent.sex || !candidate.sex || agent.sex === candidate.sex) return false;
  if (!isMature(candidate)) return false;
  if (candidate.behavior === "flee") return false; // don't interrupt a fleeing mate
  // Herd animals pair within their herd; solitary agents (no herdId) aren't restricted.
  if (agent.herdId && agent.herdId !== candidate.herdId) return false;
  return true;
}

function nearestMate(agent: Agent, candidates: Agent[]): Agent | undefined {
  let best: Agent | undefined;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = manhattan(agent.pos, candidate.pos);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

function freshNeeds(): Needs {
  return { hunger: 1, thirst: 1, energy: 1, mateDrive: 0 };
}

const SPAWN_OFFSETS: Vec2[] = [
  { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 1, y: 1 },
  { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }, { x: -1, y: -1 },
];

/**
 * A tile next to the mother, not literally on top of her. Without this,
 * a herd whose cohesion has already pulled it into a tight cluster spawns
 * every new generation on the exact same tile as the last, and the whole
 * population collapses into a single stacked point within a few hundred
 * ticks (confirmed in a real run: 168 of 264 agents on one tile by tick
 * 2000). Falls back to the mother's own tile only if she's fully boxed in.
 */
function nearbySpawnTile(world: World, layer: Layer, origin: Vec2): Vec2 {
  const shuffled = [...SPAWN_OFFSETS].sort(() => Math.random() - 0.5);
  for (const offset of shuffled) {
    const candidate = { x: origin.x + offset.x, y: origin.y + offset.y };
    if (tileAt(world, layer, candidate.x, candidate.y)?.walkable) return candidate;
  }
  return origin;
}

let offspringSequence = 0;

function spawnOffspring(world: World, mother: Agent, father: Agent, ctx?: LevelingContext): Agent {
  offspringSequence += 1;
  // Breeding always produces the base (pre-evolution) form, mainline-accurate:
  // a bred Venusaur's offspring hatches as a Bulbasaur, never another
  // Venusaur — Bulbasaur is the "child version," Venusaur just what an adult
  // grows into, not a separately-bred species. See LevelingContext.baseSpeciesOf.
  const species = ctx?.baseSpeciesOf?.(mother.species) ?? mother.species;
  const child: Agent = {
    id: `${species}-${world.tick}-${offspringSequence}`,
    species,
    pos: nearbySpawnTile(world, mother.layer, mother.pos),
    layer: mother.layer,
    homeLayer: mother.homeLayer,
    // Cheapest available "home range" stand-in for carryAlly's rescue destination
    // (support.ts) — there's no richer herd-home-range concept in the engine yet.
    // A newborn's home is simply where it was born, same as the mother's own
    // homePos when she has one.
    homePos: mother.homePos ?? { ...mother.pos },
    needs: freshNeeds(),
    behavior: "idle",
    herdId: mother.herdId,
    // 50/50 for now — real per-species gender ratios are a data-layer concern, see TODO.
    sex: Math.random() < 0.5 ? "male" : "female",
    age: 0,
    level: 1,
    exp: 0,
  };
  // Backfills stats/hp/types/moves for the base species at level 1 — without
  // this a newborn had no combat profile at all (couldn't fight, and its
  // guaranteed per-level-up skill point silently never fired, since
  // `grantExp` reads `agent.types?.[0]`). No-op without `ctx` (bare tests).
  ensureCombatProfile(child, ctx);
  return child;
}

/**
 * Called when chooseBehavior has already picked "seekMate". Finds the
 * nearest eligible mate (same species/layer/herd, opposite sex, mature) and
 * either closes distance or, once adjacent, produces an offspring — the
 * mother's turn triggers the birth so a pair doesn't double-spawn the same
 * tick. Both parents' mateDrive resets afterward, which is the sim's only
 * "cooldown": rebuilding it naturally takes a while (see needs.ts).
 */
export function applyMateSeeking(world: World, agent: Agent, log?: EventLog, ctx?: LevelingContext): void {
  if (!agent.sex || !isMature(agent)) return;

  const candidates = world.agents.filter(
    (other) => isEligibleMate(agent, other, ctx) && manhattan(agent.pos, other.pos) <= MATE_SEARCH_RADIUS
  );
  const partner = nearestMate(agent, candidates);
  if (!partner) return;

  if (manhattan(agent.pos, partner.pos) <= 1) {
    if (agent.sex === "female") {
      const child = spawnOffspring(world, agent, partner, ctx);
      world.agents.push(child);
      log?.record({
        kind: "born",
        tick: world.tick,
        motherId: agent.id,
        fatherId: partner.id,
        childId: child.id,
        species: child.species,
        layer: child.layer,
        pos: child.pos,
      });
      grantExp(world, agent, EXP_ON_BIRTH_PARENT, ctx, log);
      grantExp(world, partner, EXP_ON_BIRTH_PARENT, ctx, log);
    }
    agent.needs.mateDrive = 0;
    partner.needs.mateDrive = 0;
  } else {
    grantExp(world, agent, EXP_ON_MATE_ATTEMPT, ctx, log);
    agent.pos = stepToward(world, agent.layer, agent.pos, partner.pos);
  }
}
