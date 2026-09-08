import type { EventLog } from "./events.js";
import type { Agent, Vec2, World } from "./types.js";
import { biomeWeightsAt } from "./worldgen.js";

/**
 * Herds as named, persistent entities with a history — not just a string id
 * scattered across `Agent.herdId`.
 *
 * Direct ask: "the story of a herd as an entity, you know? ... I want to
 * trace what zones they migrated across, what their notables are, what
 * happened to them ... I want stories."
 *
 * The event log already records nearly every beat worth telling (migrations,
 * clashes, splits, titles, droughts, eggs eaten). What it could not do was
 * say WHOSE story a given event belonged to, because a herd had no identity
 * beyond an opaque id like `bulbasaur-lineage-a17-3400`, and no memory of
 * where it came from. This module gives each one a name, a founding, a
 * parent when it split off, and a running record — the spine a chronicle
 * hangs off.
 */

export type HerdOrigin = "founding" | "split" | "immigration";

export interface HerdRecord {
  id: string;
  /** Evocative display name, e.g. "the Bulbasaurs of Thornhollow" — stable for the life of the herd. */
  name: string;
  /** Just the place part ("Thornhollow"), for compact rendering. */
  placeName: string;
  species: string;
  foundedTick: number;
  foundedAt: Vec2;
  origin: HerdOrigin;
  /** The herd this one split away from, when `origin` is "split" — the lineage link that makes a family tree possible. */
  parentHerdId?: string;
  /** The agent whose dispersal founded it, when known. */
  founderId?: string;
  peakSize: number;
  /** Last tick this herd had at least one living member. */
  lastSeenTick: number;
  /** Set once the herd has no living members left — a herd ends, and that ending is part of its story. */
  dissolvedTick?: number;
}

/**
 * Place-name syllables, chosen per biome so a name carries a hint of where
 * the herd actually formed. Deliberately hand-written rather than generated:
 * "Thornhollow" and "Ashreach" read as places, and a procedural mashup of
 * letters does not.
 */
const BIOME_PREFIXES: Record<string, readonly string[]> = {
  grassland: ["Green", "Meadow", "Sun", "Wide", "Clover"],
  forest: ["Thorn", "Moss", "Fern", "Bramble", "Elder"],
  jungle: ["Vine", "Deep", "Emerald", "Tangle", "Rain"],
  wetland: ["Reed", "Mire", "Fen", "Silt", "Heron"],
  beach: ["Salt", "Shell", "Tide", "Drift", "Pale"],
  badlands: ["Ash", "Rust", "Bone", "Scour", "Ember"],
  desert: ["Dust", "Sun", "Bleach", "Amber", "Thirst"],
  highland: ["Storm", "Crag", "Cloud", "Iron", "High"],
  snow: ["Frost", "Rime", "Wither", "Still", "White"],
};
const FALLBACK_PREFIXES = ["Grey", "Old", "Far", "Hollow", "Quiet"];
const SUFFIXES = ["hollow", "reach", "fen", "ridge", "march", "run", "mire", "crest", "wash", "vale", "barrow", "cross"];

/** Stable, order-independent hash of a herd id, so a herd's name never changes and two runs of the same seed agree. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function dominantBiomeAt(world: World, pos: Vec2): string | undefined {
  const weights = biomeWeightsAt(world.biomeSeeds, pos.x, pos.y);
  let best: string | undefined;
  let bestWeight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = name;
    }
  }
  return best;
}

/** "Thornhollow" — a place name for where this herd began, biased by the biome it formed in. */
export function herdPlaceName(world: World, herdId: string, pos: Vec2): string {
  const biome = dominantBiomeAt(world, pos);
  const prefixes = (biome && BIOME_PREFIXES[biome]) || FALLBACK_PREFIXES;
  const h = hashId(herdId);
  return prefixes[h % prefixes.length]! + SUFFIXES[(h >> 5) % SUFFIXES.length]!;
}

/** Plural-ish species label for a name — "Bulbasaurs", "Nidoran". Good enough for prose; not trying to be a real pluralizer. */
function speciesLabel(species: string): string {
  const nice = species.charAt(0).toUpperCase() + species.slice(1);
  if (/(s|x|z|sh|ch)$/i.test(nice)) return nice;
  return `${nice}s`;
}

/**
 * Registers a herd the first time it is seen, or returns the existing
 * record. Safe to call every tick and from every site that mints a herd id.
 */
export function ensureHerd(
  world: World,
  herdId: string,
  info: { species: string; pos: Vec2; origin: HerdOrigin; parentHerdId?: string; founderId?: string },
  log?: EventLog
): HerdRecord {
  world.herds = world.herds ?? {};
  const existing = world.herds[herdId];
  if (existing) return existing;

  const placeName = herdPlaceName(world, herdId, info.pos);
  const record: HerdRecord = {
    id: herdId,
    name: `the ${speciesLabel(info.species)} of ${placeName}`,
    placeName,
    species: info.species,
    foundedTick: world.tick,
    foundedAt: { ...info.pos },
    origin: info.origin,
    parentHerdId: info.parentHerdId,
    founderId: info.founderId,
    peakSize: 0,
    lastSeenTick: world.tick,
  };
  world.herds[herdId] = record;
  log?.record({
    kind: "herdFounded",
    tick: world.tick,
    herdId,
    name: record.name,
    species: info.species,
    origin: info.origin,
    parentHerdId: info.parentHerdId,
    pos: { ...info.pos },
  });
  return record;
}

/**
 * Once-per-tick sweep: registers any herd that appeared without going
 * through `ensureHerd` (the hand-authored scenario herds), tracks peak size,
 * and closes out a herd whose last member has died.
 *
 * Deliberately a single pass over `world.agents` in the same
 * world-level-systems slot as `growFlora`/`decayShelters` — herds are cheap
 * to count and this keeps every other module free of bookkeeping.
 */
export function tickHerds(world: World, log?: EventLog): void {
  world.herds = world.herds ?? {};
  const sizes = new Map<string, { count: number; species: string; pos: Vec2 }>();
  for (const agent of world.agents) {
    if (agent.alive === false || !agent.herdId) continue;
    const entry = sizes.get(agent.herdId);
    if (entry) entry.count++;
    else sizes.set(agent.herdId, { count: 1, species: agent.species, pos: agent.pos });
  }

  for (const [herdId, { count, species, pos }] of sizes) {
    const record = ensureHerd(world, herdId, { species, pos, origin: "founding" }, log);
    record.peakSize = Math.max(record.peakSize, count);
    record.lastSeenTick = world.tick;
    record.dissolvedTick = undefined;
  }

  for (const record of Object.values(world.herds)) {
    if (sizes.has(record.id) || record.dissolvedTick !== undefined) continue;
    record.dissolvedTick = world.tick;
    log?.record({ kind: "herdDissolved", tick: world.tick, herdId: record.id, name: record.name, lastTick: record.lastSeenTick });
  }
}

/**
 * Syllables for individual names. An agent id like `bulbasaur-egg-3401` is
 * useless in prose — "egg evolved into an ivysaur" reads like a bug report.
 * A real name is what makes a notable land: "Thornhide earned the title The
 * Unbroken" is a story, the id is not.
 */
const NAME_STARTS = [
  "Thorn", "Ash", "Bram", "Fen", "Gale", "Hollow", "Iron", "Kes", "Lark", "Mor",
  "Nim", "Oak", "Pike", "Quill", "Rook", "Sable", "Tarn", "Vex", "Wren", "Yarrow",
];
const NAME_ENDS = ["hide", "claw", "step", "song", "fang", "wing", "root", "tail", "eye", "mane", "bark", "spur"];

/**
 * A stable, human-readable name for an individual, derived from its id.
 * Deterministic, so the same animal is called the same thing everywhere and
 * two runs of a seed agree.
 */
export function agentDisplayName(agentId: string): string {
  const h = hashId(agentId);
  return NAME_STARTS[h % NAME_STARTS.length]! + NAME_ENDS[(h >> 7) % NAME_ENDS.length]!;
}

/** The herd record for an agent, if it has one — the lookup a chronicle needs constantly. */
export function herdOf(world: World, agent: Agent): HerdRecord | undefined {
  return agent.herdId ? world.herds?.[agent.herdId] : undefined;
}
