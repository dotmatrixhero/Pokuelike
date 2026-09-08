import type { EventLog } from "./events.js";
import type { Agent, Vec2, World } from "./types.js";
import { biomeWeightsAt } from "./worldgen.js";
import { displayNameFor } from "./names.js";
import type { PokemonType } from "./typing.js";

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
  /** This herd's living-member centroid as of `lastSeenTick` — where a consumer (e.g. the web app's Auto Camera, focusing a `herdDissolved` moment with no living agent left to find a position from) should point a camera at a herd that's gone. Absent only for a herd that predates this field (none in practice — set on every `tickHerds` pass a herd has members). */
  lastSeenPos?: Vec2;
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

/**
 * Collective nouns for a herd that is NOT the first of its species in this
 * place, keyed by how it came to exist. Direct ask: "do the zone name,
 * unless one herd of that type already exists. Then give it a second name
 * like 'the exiles of the elder wood'."
 *
 * Origin-flavoured because the reason a second herd exists IS its character:
 * a herd that split off genuinely is a breakaway, and one that walked in
 * from outside genuinely is a band of strangers. A single shared word for
 * both would throw that away.
 */
/**
 * The adjective half, carrying WHY this herd is a second one. Moodier
 * entries are deliberate — the reason a group broke away is a character
 * note, so "the Sinister Vine" is doing the same job as "the Severed Vine"
 * with more menace.
 */
const ORIGIN_ADJECTIVES: Record<HerdOrigin, readonly string[]> = {
  split: ["Severed", "Exiled", "Sundered", "Riven", "Cast-Out", "Broken", "Sinister", "Bitter", "Apostate"],
  immigration: ["Wandering", "Far-Come", "Drifting", "Wayfaring", "Unbidden", "Stranger", "Restless", "Nameless"],
  founding: ["Lesser", "Quiet", "Shadowed", "Forgotten", "Remnant", "Second", "Old", "Patient"],
};

/**
 * The noun half, from the herd's own typing. Direct ask: "try to make the
 * qualifiers flavorful to the typing of the Pokemon too? ... The severed
 * flame sounds super cool for example."
 *
 * It really is the better half: "the Severed" is a label, "the Severed
 * Flame" is a group of Charmeleon you can picture.
 */
const TYPE_NOUNS: Record<string, readonly string[]> = {
  fire: ["Flame", "Ember", "Cinder", "Pyre"],
  water: ["Tide", "Current", "Wave", "Deep"],
  grass: ["Vine", "Root", "Bough", "Bloom"],
  rock: ["Stone", "Crag", "Slate", "Scree"],
  ground: ["Burrow", "Loam", "Hollow", "Furrow"],
  bug: ["Swarm", "Hive", "Chitin", "Brood"],
  flying: ["Wing", "Gale", "Flock", "Feather"],
  electric: ["Spark", "Storm", "Arc", "Coil"],
  ice: ["Frost", "Rime", "Chill", "Drift"],
  poison: ["Blight", "Venom", "Miasma", "Fume"],
  psychic: ["Mind", "Vision", "Echo", "Reverie"],
  fighting: ["Fist", "Fury", "Stand", "Sinew"],
  dark: ["Shadow", "Gloom", "Night", "Umbra"],
  ghost: ["Shroud", "Wraith", "Pall", "Vigil"],
  steel: ["Iron", "Forge", "Edge", "Alloy"],
  dragon: ["Wyrm", "Scale", "Tyrant", "Maw"],
  fairy: ["Charm", "Glimmer", "Wish", "Lilt"],
  normal: ["Kin", "Blood", "Band", "Herd"],
};
const FALLBACK_TYPE_NOUNS = TYPE_NOUNS.normal!;

/**
 * A second naming shape: a type ADJECTIVE with a collective noun, for
 * "the Aquatic Zealots" — a direct suggestion, and a genuinely different
 * register from "the Severed Flame". One pattern for every herd in the
 * world would get samey however good it is, so both are in rotation.
 */
const TYPE_ADJECTIVES: Record<string, readonly string[]> = {
  fire: ["Ashen", "Burning", "Molten", "Smoldering"],
  water: ["Aquatic", "Tidal", "Drowned", "Brackish"],
  grass: ["Verdant", "Thorned", "Overgrown", "Rooted"],
  rock: ["Stonebound", "Craggy", "Petrified", "Weathered"],
  ground: ["Buried", "Deep-Dug", "Earthen", "Sunken"],
  bug: ["Teeming", "Chittering", "Hivebound", "Many-Legged"],
  flying: ["Windborne", "High-Flying", "Storm-Tossed", "Feathered"],
  electric: ["Charged", "Crackling", "Galvanic", "Stormlit"],
  ice: ["Frozen", "Rimebound", "Glacial", "Bitter-Cold"],
  poison: ["Blighted", "Venomous", "Fetid", "Corrupted"],
  psychic: ["Far-Seeing", "Dreaming", "Silent", "Uncanny"],
  fighting: ["Iron-Willed", "Unyielding", "Battle-Worn", "Disciplined"],
  dark: ["Shadowed", "Nightbound", "Blackhearted", "Furtive"],
  ghost: ["Haunted", "Unquiet", "Fading", "Grave-Bound"],
  steel: ["Ironclad", "Tempered", "Riveted", "Unbending"],
  dragon: ["Ancient", "Tyrant", "Scaled", "Imperious"],
  fairy: ["Gleaming", "Fey", "Charmed", "Whimsical"],
  normal: ["Plain", "Steadfast", "Common", "Unremarkable"],
};

/** Collective nouns for the type-adjective pattern — what a group of them calls itself. */
const COLLECTIVE_NOUNS = ["Zealots", "Wardens", "Choir", "Coven", "Court", "Host", "Band", "Congregation", "Circle", "Vanguard"];

/**
 * What to call this herd: its species ("the Bulbasaurs of the Elderwood")
 * when it is the first of that species here, or a collective noun ("the
 * Exiles of the Elderwood") when one already exists.
 *
 * Checks every herd of the species this world has EVER had, not just the
 * living ones. Freeing a name when its herd dies out was the first version
 * and it reads fine in the moment but wrecks the chronicle, which lists a
 * world's whole history: a real run produced two separate "the Onix of the
 * Crag Heights" entries, one long dead before the other arrived, with no way
 * to tell them apart. A name is an identity in the record, so it is spent
 * permanently.
 */
function herdEpithetFor(world: World, species: string, origin: HerdOrigin, types?: readonly PokemonType[]): string {
  const allHerds = Object.values(world.herds ?? {});
  const everHere = allHerds.filter((h) => h.species === species);
  if (everHere.length === 0) return speciesLabel(species);

  // Uniqueness is checked against EVERY herd in the world, not just this
  // species'. A name is an identity in the chronicle's record, and a real
  // run produced a Golbat herd and an Onix herd both called "the Wandering
  // Kin of the Crag Heights" — same place, same name, different animals.
  const taken = new Set(allHerds.map((h) => h.name));
  const isFree = (label: string): boolean => ![...taken].some((name) => name.startsWith(`the ${label} `));

  const type = types && types.length > 0 ? types[0]! : "normal";
  const originAdjectives = ORIGIN_ADJECTIVES[origin];
  const typeNouns = TYPE_NOUNS[type] ?? FALLBACK_TYPE_NOUNS;
  const typeAdjectives = TYPE_ADJECTIVES[type] ?? TYPE_ADJECTIVES.normal!;

  // Two shapes in rotation: "the Severed Flame" (why they left + what they
  // are) and "the Aquatic Zealots" (what they are + what they became).
  // Alternating by herd index keeps both in play across one world.
  const candidates: string[] = [];
  const start = everHere.length - 1;
  for (let i = 0; i < 40; i++) {
    const n = start + i;
    candidates.push(
      n % 2 === 0
        ? `${originAdjectives[n % originAdjectives.length]!} ${typeNouns[Math.floor(n / 2) % typeNouns.length]!}`
        : `${typeAdjectives[n % typeAdjectives.length]!} ${COLLECTIVE_NOUNS[Math.floor(n / 2) % COLLECTIVE_NOUNS.length]!}`
    );
  }
  for (const candidate of candidates) if (isFree(candidate)) return candidate;

  // Hundreds of combinations exist, so this needs an implausible number of
  // herds of one species in one place. Numbering is ugly but honest, and an
  // ambiguous name in the record would be worse.
  for (let n = 2; n < 99; n++) {
    const candidate = `${originAdjectives[0]!} ${typeNouns[0]!} ${n}`;
    if (isFree(candidate)) return candidate;
  }
  return `${originAdjectives[0]!} ${typeNouns[0]!}`;
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
  info: { species: string; pos: Vec2; origin: HerdOrigin; parentHerdId?: string; founderId?: string; types?: readonly PokemonType[] },
  log?: EventLog
): HerdRecord {
  world.herds = world.herds ?? {};
  const existing = world.herds[herdId];
  if (existing) return existing;

  // A real named territory from the overworld if this world was promoted
  // from one, so a herd's name points at somewhere findable on the map;
  // otherwise an invented local place name (a standalone scenario world has
  // no overworld above it).
  const placeName = world.territoryName ?? herdPlaceName(world, herdId, info.pos);
  const record: HerdRecord = {
    id: herdId,
    name: `the ${herdEpithetFor(world, info.species, info.origin, info.types)} of ${placeName}`,
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
  const sizes = new Map<string, { count: number; species: string; pos: Vec2; types?: readonly PokemonType[] }>();
  for (const agent of world.agents) {
    if (agent.alive === false || !agent.herdId) continue;
    const entry = sizes.get(agent.herdId);
    if (entry) entry.count++;
    else sizes.set(agent.herdId, { count: 1, species: agent.species, pos: agent.pos, types: agent.types });
  }

  for (const [herdId, { count, species, pos, types }] of sizes) {
    const record = ensureHerd(world, herdId, { species, pos, origin: "founding", types }, log);
    record.peakSize = Math.max(record.peakSize, count);
    record.lastSeenTick = world.tick;
    record.lastSeenPos = pos;
    record.dissolvedTick = undefined;
  }

  for (const record of Object.values(world.herds)) {
    if (sizes.has(record.id) || record.dissolvedTick !== undefined) continue;
    record.dissolvedTick = world.tick;
    log?.record({ kind: "herdDissolved", tick: world.tick, herdId: record.id, name: record.name, lastTick: record.lastSeenTick });
  }
}

/**
 * A stable, human-readable name for an individual, derived from its id.
 *
 * Delegates to names.ts, which holds the real (type-flavoured, much larger)
 * pools — see that module for why naming is deterministic rather than random
 * and why the original single 240-name pool had to go. Kept here as the
 * convenient no-types entry point: callers that know the animal's typing
 * should prefer `displayNameFor`, which produces a name that actually sounds
 * like the species.
 */
export function agentDisplayName(agentId: string, types?: readonly PokemonType[]): string {
  return displayNameFor(agentId, types);
}

/** The herd record for an agent, if it has one — the lookup a chronicle needs constantly. */
export function herdOf(world: World, agent: Agent): HerdRecord | undefined {
  return agent.herdId ? world.herds?.[agent.herdId] : undefined;
}
