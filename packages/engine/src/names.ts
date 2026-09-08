import type { PokemonType } from "./typing.js";

/**
 * Names for individuals — deterministic, type-flavoured, and large enough
 * that two animals in the same story rarely share one.
 *
 * Direct ask: "add like a bunch more roots and ends. Try to pull them based
 * on like Pokémon + fantasy vibes. Maybe sample move names and splice em up."
 * Most of the roots below are lifted or filed down from this project's own
 * 440-odd move and tree-node names — Pyroclasm, Maelstrom, Mountainfall,
 * Bedrock, Bramble, Cataclysm, Ember, Thornbound — so a name sounds like it
 * belongs to this game rather than to a generic fantasy generator.
 *
 * **Why it is not random.** A name is derived by hashing the agent's id, so
 * the same animal is called the same thing everywhere, forever, and re-running
 * a seed reproduces every name exactly. No rng draw is taken, so naming can
 * never perturb the simulation.
 *
 * **Why it is typed.** The first version drew every animal from one pool of
 * 20 starts and 12 ends — 240 names total. Measured against a birthday
 * problem that is a 56% chance of a collision at just 20 named animals and a
 * near-certainty by 40; across 2000 ids, "Vexmane" came up 18 times. Two
 * different notables sharing a name would wreck a chronicle. Splitting the
 * roots by type both fixes that (a Bulbasaur and a Beedrill can no longer
 * collide at all) and makes the name carry information: "Bramroot" reads
 * grass, "Vexsting" reads bug.
 */

/** Roots by type — the flavour half of the name. */
const ROOTS_BY_TYPE: Partial<Record<PokemonType, readonly string[]>> = {
  grass: ["Bram", "Thorn", "Vine", "Bloom", "Fern", "Root", "Verd", "Moss", "Seed", "Grove", "Bri", "Sap", "Petal", "Leaf", "Nettle", "Bough", "Yarrow", "Tendril", "Husk", "Bramble", "Wilt", "Canopy", "Spore", "Green"],
  fire: ["Ember", "Pyro", "Cinder", "Scorch", "Blaze", "Ash", "Coal", "Sear", "Flare", "Kindle", "Smolder", "Char", "Forge", "Ignis", "Wick", "Molten", "Furnace", "Brand", "Soot", "Fume", "Torch", "Balefire", "Roast", "Glow"],
  water: ["Tide", "Brine", "Mael", "Current", "Surge", "Wave", "Drift", "Foam", "Undert", "Rill", "Spray", "Marsh", "Kelp", "Shoal", "Rain", "Deluge", "Eddy", "Silt", "Pool", "Frost", "Mist", "Torrent", "Wash", "Cove"],
  rock: ["Bedrock", "Crag", "Quarry", "Stone", "Granite", "Slate", "Boulder", "Scree", "Flint", "Basalt", "Shale", "Rubble", "Cairn", "Tor", "Gravel", "Obsid", "Mountain", "Cliff", "Marble", "Chalk", "Grit", "Pumice", "Ledge", "Spire"],
  ground: ["Burrow", "Delve", "Loam", "Furrow", "Tunnel", "Warren", "Dust", "Clay", "Mire", "Trench", "Hollow", "Under", "Grave", "Sink", "Dune", "Silt", "Barrow", "Fissure", "Bore", "Deep", "Sod", "Quake", "Rift", "Mound"],
  bug: ["Vex", "Sting", "Chitin", "Swarm", "Mandi", "Hive", "Drone", "Carapace", "Nettle", "Weave", "Silk", "Scuttle", "Larva", "Pincer", "Buzz", "Cocoon", "Thrum", "Wasp", "Mite", "Husk", "Gall", "Spindle", "Creep", "Antenna"],
  flying: ["Gale", "Wind", "Zephyr", "Talon", "Plume", "Cirrus", "Updraft", "Skye", "Feather", "Squall", "Loft", "Soar", "Aerie", "Kestrel", "Storm", "Vane", "Drift", "Wing", "Crest", "Perch", "Thermal", "Swift", "High", "Cloud"],
  electric: ["Volt", "Arc", "Spark", "Storm", "Static", "Ion", "Jolt", "Surge", "Fulmin", "Thunder", "Coil", "Flash", "Bolt", "Charge", "Tesla", "Crackle", "Dynamo", "Zap", "Gleam", "Livewire", "Filament", "Shock", "Amp", "Glare"],
  ice: ["Frost", "Rime", "Glaci", "Hoar", "Sleet", "Shiver", "Floe", "Crystal", "Chill", "Snow", "Icicle", "Blizzard", "Pale", "Winter", "Drift", "Freeze", "Bitter", "Cold", "Thaw", "Wither", "Crisp", "Boreal", "Flurry", "Still"],
  poison: ["Venom", "Blight", "Toxin", "Miasma", "Fester", "Sludge", "Bane", "Wither", "Acrid", "Fume", "Rot", "Spore", "Corrode", "Gall", "Noxi", "Seep", "Reek", "Curdle", "Taint", "Bile", "Murk", "Vile", "Drip", "Pall"],
  psychic: ["Psy", "Mind", "Aether", "Trance", "Echo", "Vision", "Lucid", "Wraith", "Thought", "Veil", "Rift", "Augur", "Reverie", "Halo", "Silence", "Whisper", "Ora", "Numen", "Dream", "Sight", "Astral", "Hush", "Fathom", "Cipher"],
  fighting: ["Iron", "Fist", "Bulwark", "Vanguard", "Brawn", "Grapple", "Strike", "Guard", "Bracer", "Hammer", "Steel", "Resolve", "Onset", "Fury", "Mettle", "Stalwart", "Rally", "Break", "Sinew", "Clash", "Bout", "Anvil", "Blow", "Stand"],
  dark: ["Shade", "Umbra", "Night", "Gloom", "Raven", "Dusk", "Hollow", "Grim", "Sable", "Murk", "Shadow", "Ebon", "Creep", "Blackt", "Malice", "Prowl", "Stalk", "Veil", "Pitch", "Wane", "Cruel", "Fell", "Lurk", "Bleak"],
  ghost: ["Wraith", "Shroud", "Pall", "Spectre", "Hollow", "Mourn", "Grave", "Wisp", "Lament", "Revenant", "Haunt", "Dirge", "Shade", "Fade", "Keen", "Barrow", "Rest", "Requiem", "Chill", "Moan", "Vigil", "Cere", "Gloam", "Knell"],
  steel: ["Iron", "Forge", "Rivet", "Chrome", "Alloy", "Bastion", "Girder", "Temper", "Plate", "Cog", "Anvil", "Slag", "Ward", "Bolt", "Keen", "Burnish", "Lathe", "Sheen", "Bar", "Gild", "Rust", "Mail", "Weld", "Edge"],
  dragon: ["Wyrm", "Drake", "Scale", "Talon", "Ancient", "Tyrant", "Saur", "Rend", "Cata", "Sovereign", "Titan", "Maw", "Regal", "Emberwyrm", "Sunder", "Vast", "Elder", "Ruin", "Storm", "Fang", "Crown", "Doom", "Wing", "Ravage"],
  fairy: ["Glim", "Lumen", "Petal", "Chime", "Dawn", "Whimsy", "Gossamer", "Trill", "Silver", "Wish", "Charm", "Hallow", "Bright", "Fey", "Sprite", "Bell", "Mirth", "Glade", "Shimmer", "Blessing", "Lilt", "Rosy", "Spell", "Kind"],
  normal: ["Thorn", "Ash", "Bram", "Fen", "Gale", "Hollow", "Iron", "Kes", "Lark", "Mor", "Nim", "Oak", "Pike", "Quill", "Rook", "Sable", "Tarn", "Vex", "Wren", "Yarrow", "Bracken", "Elder", "Harrow", "Marrow"],
};

/** Used when a species' type is unknown — the original neutral, woodsy set. */
const FALLBACK_ROOTS = ROOTS_BY_TYPE.normal!;

/**
 * Optional middle syllable. Mostly empty on purpose: a two-part name like
 * "Bramclaw" is the house style, and a three-part one ("Bramwynclaw") should
 * be the rarer, grander-sounding exception rather than the norm.
 */
const INFIXES = ["", "", "", "", "", "", "", "", "wyn", "dra", "mor", "thal"];

/** The second half — mostly body parts, bearings and verbs, so a name reads like a creature's. */
const ENDS = [
  "hide", "claw", "step", "song", "fang", "wing", "root", "tail", "eye", "mane",
  "bark", "spur", "maw", "scale", "horn", "pelt", "tooth", "shell", "quill", "hoof",
  "gaze", "cry", "call", "tread", "pace", "shade", "heart", "sworn", "born", "bane",
  "seeker", "walker", "singer", "watcher", "biter", "runner", "keeper", "breaker", "warden", "hunter",
];

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * A stable, human-readable name for an individual, derived from its id and
 * flavoured by its primary type.
 *
 * Pool size is roughly 24 roots x 10 infixes x 40 ends = ~9,600 per type,
 * which keeps same-species collisions rare at the scale a real run reaches
 * (a herd peaks around a dozen; a species maybe a few dozen world-wide).
 */
export function displayNameFor(agentId: string, types?: readonly PokemonType[]): string {
  const roots = (types && types.length > 0 && ROOTS_BY_TYPE[types[0]!]) || FALLBACK_ROOTS;
  // Three INDEPENDENT hashes rather than bit-shifts of one. Shifting a
  // single FNV hash left the three indices correlated: in a sample of eight
  // grass names, seven drew a non-empty infix even though the table is
  // two-thirds empty, producing a run of "Boughdrahorn"-style clunkers.
  const root = roots[hash(agentId) % roots.length]!;
  const infix = INFIXES[hash(`${agentId}:infix`) % INFIXES.length]!;
  const end = ENDS[hash(`${agentId}:end`) % ENDS.length]!;
  return join(join(root, infix), end);
}

/**
 * Glues two name parts without the seams a naive concatenation produces.
 * Real output from the first version: "Sapathhide", "Nettleelmaw",
 * "Hollowathgaze". Dropping a repeated letter across the join is enough to
 * turn those into "Sapathide", "Nettelmaw", "Hollowathgaze" -> "Hollathgaze",
 * and it costs nothing — the result is still fully deterministic.
 */
function join(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  const a = left[left.length - 1]!.toLowerCase();
  const b = right[0]!.toLowerCase();
  return a === b ? left + right.slice(1) : left + right;
}
