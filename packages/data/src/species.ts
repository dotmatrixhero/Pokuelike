import type { ActivityPattern, BaseStats, Layer, PokemonType, TerrainKind } from "@pokuelike/engine";
import { SPECIES_DEX_BY_KEY } from "./dex/index.js";

export interface SpeciesDef {
  id: string;
  name: string;
  /** Sprite sheet key the renderer looks up; actual art assets aren't checked in yet. */
  spriteKey: string;
  /** Placeholder color used until real sprites are wired up. */
  placeholderColor: string;
  /** The layer this species lives on and returns to once its needs are met. */
  homeLayer: Layer;
  /**
   * True if this species hunts at all. Which specific nearby agents it
   * actually goes after is decided dynamically by relative power (level +
   * size), not a fixed prey list — see `@pokuelike/engine`'s
   * predation.ts's `isPreyOf`. Absent/false = doesn't hunt, ever, no matter
   * how weak something nearby is (an herbivore doesn't opportunistically
   * hunt just because it out-levels something).
   */
  isPredator?: boolean;
  /** Canon base stats (mainline games), fed through calculateStats(base, level) for real HP/Atk/etc. */
  baseStats: BaseStats;
  types: PokemonType[];
  moves: string[];
  /**
   * When this species prefers to be active — see daynight.ts/DESIGN.md's
   * "Dynamics that move a content herd" section, Phase 2. Absent =
   * `"cathemeral"` (active any time), both here and denormalized onto
   * `Agent.activityPattern` at spawn (spawn.ts) — so a species left
   * unspecified below doesn't silently change behavior.
   */
  activityPattern?: ActivityPattern;
  /**
   * True if this species deliberately builds a persistent "shelter" tile
   * near its herd's home range — see `@pokuelike/engine`'s shelter.ts and
   * DESIGN.md's "Shelter-building" section. Species-tied, not universal, per
   * direct instruction: judged per-species on a burrowing/nesting
   * temperament, the same standard as `isPredator`/`activityPattern` rather
   * than flipped on for the whole roster. Absent/false = this species never
   * attempts it, denormalized onto `Agent.buildsShelter` at spawn
   * (spawn.ts), same pattern as `activityPattern`.
   */
  buildsShelter?: boolean;
  /**
   * Which of worldgen.ts's `BIOMES` names ("grassland" | "forest" |
   * "wetland" | "badlands" | "highland" | "snow" | "desert" | "jungle" |
   * "beach") this species is naturally found in - best-effort flavor-driven
   * tagging (same judged-per-species
   * standard as `isPredator`/`buildsShelter`), not a hard requirement:
   * nothing prevents an agent from existing outside its tagged biomes (a
   * herd can migrate anywhere, a hand-placed starting position isn't
   * checked against it), and an untagged species (absent/empty) reads as
   * "no particular preference, fine anywhere" everywhere this is
   * consulted. The real, meaningful consumer is `immigration.ts`'s
   * spawn-site scoring - see DESIGN.md's "Immigration" section - plus
   * `createDemoWorld`'s placement of any new (not hand-tuned-in-place)
   * starting agent. Underground/canopy species have no biome of their own
   * (those layers are flat, biome-agnostic grids - see worldgen.ts) so
   * they're tagged by whichever surface biome best matches their flavor
   * text, on the understanding that "their biome" means "the surface
   * biome sitting above wherever they actually live."
   */
  biomes?: string[];
  /**
   * Which literal `TerrainKind`(s) (types.ts — "water" | "flora" | "food" |
   * "sunbeam" | "bush" | "boulder" | ...) this species gravitates toward
   * once genuinely idle (needs met, no herd pull-back) — a finer-grained,
   * tile-level cousin of `biomes` above, NOT derived from it: `biomes` is
   * "which map region does this species spawn/immigrate into," this is
   * "once standing on that region's tiles with nothing urgent to do, which
   * specific tile kind does it drift toward" (e.g. Bulbasaur toward flora
   * patches, Squirtle toward water) — see DESIGN.md's "Tile preference"
   * section and `@pokuelike/engine`'s needs.ts `applyExploration`. Same
   * judged-per-species standard as `biomes`/`buildsShelter`, not universal:
   * only tagged for species whose home layer (surface) actually has varied
   * terrain to prefer among — underground/canopy natives live on flat,
   * terrain-uniform grids (see worldgen.ts's doc comment), so tagging them
   * would be meaningless and is skipped rather than guessed at. Absent/empty
   * = no particular tile preference, falls back to ordinary random-wander
   * exploration exactly as before this feature. Order matters: earlier
   * entries are tried first when more than one is listed.
   */
  preferredTerrain?: TerrainKind[];
  /**
   * True for a genuinely obligate-aquatic species — one that realistically
   * can't survive out of water at all, not merely a Water-typed one. Direct
   * ask: "certain Pokémon like Magicarp and tentacool and stuff should
   * probably not really be leaving the water" — the mirror image of
   * `@pokuelike/engine`'s `waterBody.ts`'s `canEnterWater` (non-water types
   * can't cross large water bodies), enforced by that same module's
   * `canEnterLand`: an obligate-aquatic agent can wade onto the immediate
   * shore ring but no deeper onto land, mirroring the shore-wade allowance
   * `canEnterWater` already gives non-water types the other direction.
   * Judged per-species on real biology, the same standard as
   * `isPredator`/`buildsShelter` — NOT every Water-type gets this: plenty
   * (Squirtle, Psyduck, Poliwag) are canonically amphibious/land-capable in
   * mainline flavor text and must stay unrestricted. Absent/false = an
   * ordinary species, denormalized onto `Agent.obligateAquatic` at spawn
   * (spawn.ts), same pattern as `isPredator`/`buildsShelter`.
   */
  obligateAquatic?: boolean;
  /**
   * A multiplier on how often this species shows up — both as a walking-in
   * immigrant (`@pokuelike/engine`'s `immigration.ts`'s `pickImmigrantSpecies`
   * weight) and in how large its invented population is wherever a
   * never-visited zone estimates one owning it (`macroGrid.ts`'s
   * `estimateZoneSpecies`). Direct ask: "make arboks less common. I just
   * don't like em lol" — a real, judged-per-species dial rather than a
   * zone-wide/global rule change (same "judged per-species" standard as
   * `isPredator`/`buildsShelter`/`obligateAquatic` above), so ONE species can
   * be dialed down without touching anything else on the roster. Absent =
   * `1`, ordinary/unchanged frequency for every other species.
   */
  rarity?: number;
}

/**
 * Sim-specific fields only — baseStats/types/name/id are pulled from the full
 * PokeRogue-derived dex (`dex/species.generated.ts`) by `dexKey` (e.g. "BULBASAUR",
 * the PokeRogue SpeciesId enum key) instead of being hand-duplicated. This is the
 * intended way to add a new species to the sim roster: look up its dex key, then
 * supply only what the sim actually needs (sprite, layer, predation, moveset).
 */
export type SimSpeciesFields = Omit<SpeciesDef, "id" | "name" | "baseStats" | "types"> & {
  /** Override the sim's id/name if they shouldn't just be the lowercased dex key / dex display name. */
  id?: string;
  name?: string;
};

export function speciesFromDex(dexKey: string, sim: SimSpeciesFields): SpeciesDef {
  const entry = SPECIES_DEX_BY_KEY[dexKey];
  if (!entry) throw new Error(`speciesFromDex: no dex entry for key "${dexKey}" (packages/data/src/dex/species.generated.ts)`);
  return {
    id: sim.id ?? dexKey.toLowerCase(),
    name: sim.name ?? entry.name,
    baseStats: entry.baseStats,
    types: entry.types,
    spriteKey: sim.spriteKey,
    placeholderColor: sim.placeholderColor,
    homeLayer: sim.homeLayer,
    isPredator: sim.isPredator,
    moves: sim.moves,
    activityPattern: sim.activityPattern,
    buildsShelter: sim.buildsShelter,
    biomes: sim.biomes,
    preferredTerrain: sim.preferredTerrain,
    obligateAquatic: sim.obligateAquatic,
    rarity: sim.rarity,
  };
}

/**
 * `buildsShelter` roster call (see DESIGN.md's "Shelter-building" section):
 * only diglett/sandshrew get it, the task brief's own examples and the two
 * genuinely literal burrowers in the current roster. Everyone else judged
 * and rejected on the same "real burrowing/nesting temperament, not just
 * living somewhere enclosed" standard: Onix tunnels through solid rock IN
 * PLACE (it doesn't construct anything, it just moves through stone it's
 * already surrounded by) rather than building a discrete structure; Pidgey/
 * Spearow are ordinary songbirds/raptors with no mainline nest-building
 * flavor text to point to (unlike a stork or weaverbird, say); Bulbasaur/
 * Venusaur/Charmander/Squirtle have no burrowing/nesting flavor at all.
 * Deliberately conservative rather than "every underground/enclosed-space
 * species gets it" — species-tied per direct instruction, not universal.
 */
export const SPECIES: Record<string, SpeciesDef> = {
  /**
   * The player — ROADMAP.md's M0. Not in the dex, so a literal rather than
   * `speciesFromDex`. Stats are deliberately frail: DESIGN.md's "fragile
   * human, earning your first partner" is the premise, and CAMPAIGN_DESIGN.md
   * opens with the player as "the frailest thing in the ecosystem." Base
   * stats sit under a level-5 Rattata's; HP is the one thing kept ordinary so
   * a single hit is a lesson rather than a death.
   *
   * `isPredator: true` is an M0 STOPGAP, and flagged as one: prey flee via
   * `isPreyOf(rules, ...)`, keyed by hunter species, so a human not in
   * `HUNT_RULES` would be ignored by everything and M0's acceptance test
   * ("walk toward a herd and it moves away") could not pass. The real design
   * — PLAYER_INVENTORY.md's threat signature from speed, distance and posture
   * — replaces this in M6. Until then the player reads as a mild predator.
   *
   * `moves` needs at least one real entry for `spawnAgent`'s eligible-move
   * fallback to have something to fall back to; `tackle` is the plainest
   * thing in the table. Player moves proper ("punch, kick, swing, yell")
   * are their own later slice.
   */
  human: {
    id: "human",
    name: "Human",
    spriteKey: "human",
    placeholderColor: "#e8c39e",
    homeLayer: "surface",
    // M0's `isPredator: true` stopgap is gone (ROADMAP.md M6): prey now
    // react to the player's *threat signature* — speed, posture, what is
    // in hand — see engine threat.ts and predation.ts's player branch.
    //
    // Direct report, once ROADMAP.md M7 put real, accurately-statted mid-
    // game Pokemon (Onix lvl 22, Haunter lvl 28) in the player's own path:
    // "human stats are bit too low. like i'm getting outsped and one shot
    // by too many pokemon. can you make it so the stats reasonably scale."
    // Measured before touching this (calculateStats/calculateDamage, real
    // numbers): the ORIGINAL block below (BST 183 — under even Caterpie,
    // the weakest base stat total in the mainline roster) let a level-22
    // Onix's Earthquake do 113-276% of the human's own maxHp in ONE hit
    // across levels 10-20, and a level-28 Haunter's Sludge did 252-621% —
    // not "dangerous," a guaranteed overkill every single time regardless
    // of level. Speed (40) never closes the gap either: even at level 20 a
    // human is still slower (21) than Golbat (32), Onix (35), or Haunter
    // (58) at every level tested, so the human always acts last.
    //
    // Bumped to BST 280 (still meaningfully below a starter's ~310-320 —
    // "the frailest thing in the ecosystem" premise holds, this isn't
    // making the human a powerhouse) — the SAME damage check against this
    // new block: Onix's Earthquake drops to 68-180% of maxHp (survivable
    // at levels 15-20, still a real threat below that), Haunter's Sludge
    // to 98-403% (Haunter is the level-5 cave's own final boss — staying
    // genuinely dangerous there is intentional, not a miss). Speed 65 now
    // beats Golbat (32) and is close behind Onix (35); Haunter (58) still
    // outpaces a low-level human, matching its role as the hardest fight
    // in the climb. Never unilaterally retuned before this — this exact
    // ask, with the numbers behind it, is in TODO.md.
    baseStats: { hp: 50, attack: 35, defense: 50, spAttack: 30, spDefense: 50, speed: 65 },
    types: ["normal"],
    moves: ["tackle"],
    activityPattern: "diurnal",
  },
  bulbasaur: speciesFromDex("BULBASAUR", {
    spriteKey: "bulbasaur",
    placeholderColor: "#78c850",
    homeLayer: "surface",
    moves: ["tackle", "vine_whip", "leech_seed", "sweet_scent"],
    // The bulb on its back needs sunlight to grow (mainline flavor text) —
    // basks and grazes by day, same reasoning as its evolutions below.
    activityPattern: "diurnal",
    // A grass-type grazer — grassland is the obvious flavor fit, forest as
    // a secondary (plenty of shade/undergrowth grass-types are also drawn
    // to in mainline flavor text).
    biomes: ["grassland", "forest"],
    // Direct ask's own named example — "Bulbasaur should strongly prefer
    // flora tiles." A grass-type grazer settles near the grass patches it
    // actually grazes, once fed/watered/rested.
    preferredTerrain: ["flora"],
  }),
  scyther: speciesFromDex("SCYTHER", {
    spriteKey: "scyther",
    placeholderColor: "#4fbf8c",
    homeLayer: "surface",
    isPredator: true,
    moves: ["slash", "agility"],
    // A stealthy ambush predator ("moves silently... vanishes like a
    // ninja" per mainline flavor text) — crepuscular, striking at the
    // low-light edges of the day rather than in full daylight or full dark.
    activityPattern: "crepuscular",
    // A stealthy forest ambusher (mainline flavor text has it living in
    // dense woodland) — forest as primary, grassland as a secondary edge
    // habitat.
    biomes: ["forest", "grassland"],
    // "Vanishes like a ninja" — an ambush predator that lingers in
    // concealing undergrowth between strikes, not out in the open. Reuses
    // "bush" terrain's existing concealment mechanic (`Tile.concealment`)
    // rather than inventing a new one — idling here is doubly in-character.
    preferredTerrain: ["bush"],
  }),
  charmander: speciesFromDex("CHARMANDER", {
    spriteKey: "charmander",
    placeholderColor: "#f08030",
    homeLayer: "surface",
    moves: ["ember"],
    // A sun-loving fire lizard whose flame is said to weaken without warmth
    // — diurnal, active while the sun's out.
    activityPattern: "diurnal",
    // A fire lizard that thrives on heat and dry ground (mainline flavor
    // text: found on rocky mountainsides, flame weakens in the rain) —
    // badlands is the real flavor fit, not the grassland/wetland crowd the
    // rest of the roster leans toward. See createDemoWorld for its
    // biome-driven placement (the first starting agent placed this way).
    biomes: ["badlands"],
    // Its flame is said to weaken without warmth (mainline flavor text) — a
    // sun-loving lizard that idles on the warmest tiles it can find, same
    // "sunbeam" terrain the sim already uses for basking/warmth mechanics.
    preferredTerrain: ["sunbeam"],
  }),
  diglett: speciesFromDex("DIGLETT", {
    spriteKey: "diglett",
    placeholderColor: "#966037",
    homeLayer: "underground",
    moves: ["tackle", "dig", "earthquake"],
    // The archetypal burrowing mole — avoids the surface (and its daylight)
    // entirely, most active well after dark. The task brief's own example.
    activityPattern: "nocturnal",
    // Digs its own tunnels for a living (mainline flavor text: lives
    // "about one yard underground") — the single most literal
    // shelter-building temperament in the whole roster.
    buildsShelter: true,
    // Underground has no biome of its own (worldgen.ts's biomes only vary
    // the surface layer) — tagged by the surface biome its tunnels would
    // sit under: loose, diggable ground reads as grassland/badlands, not
    // dense forest or waterlogged wetland. "desert" added later — direct
    // ask: "add like a little species. More throughout? Each zone should
    // have at least 4, max 7 to start," and desert's own fitting-species
    // count (vulpix/cubone alone) couldn't meet that floor; a real
    // burrowing mole under loose desert sand is exactly as lore-plausible
    // as under grassland/badlands.
    biomes: ["grassland", "badlands", "desert"],
    // No `preferredTerrain` tag: underground is a flat, terrain-uniform
    // floor grid (worldgen.ts never varies it), so there's no meaningful
    // tile kind to prefer among on its own home layer — and it already has
    // a real idle-homing pull via `buildsShelter` above (shelter.ts). Same
    // reasoning applies to sandshrew/pidgey/spearow/onix below.
  }),
  venusaur: speciesFromDex("VENUSAUR", {
    spriteKey: "venusaur",
    placeholderColor: "#4a8f3c",
    homeLayer: "surface",
    moves: ["tackle", "vine_whip", "leech_seed", "sweet_scent", "solar_beam"],
    // Deliberately left cathemeral (the default), not diurnal like its
    // pre-evolution: this is the herd's guardian (nothing preys on it — see
    // predation.ts), and a guardian that only watches half the clock isn't
    // much of one. No override needed; omission here IS the design choice.
    biomes: ["grassland", "forest"],
    // The herd's guardian grazer, same grass-type flora affinity as its
    // pre-evolution above.
    preferredTerrain: ["flora"],
  }),
  pidgey: speciesFromDex("PIDGEY", {
    spriteKey: "pidgey",
    placeholderColor: "#a89060",
    homeLayer: "canopy",
    // Wing Attack is a real early level move for Pidgey.
    moves: ["tackle", "roost", "wing_attack"],
    // An ordinary daytime bird — diurnal, the task brief's own example.
    activityPattern: "diurnal",
    // Canopy has no biome of its own (a flat grid, same as underground) —
    // tagged by the surface biome its treetop canopy sits above: an
    // ordinary woodland/hedgerow bird, grassland/forest.
    biomes: ["grassland", "forest"],
  }),
  spearow: speciesFromDex("SPEAROW", {
    spriteKey: "spearow",
    placeholderColor: "#8c5028",
    homeLayer: "canopy",
    // Real predator, real appetite — not limited to Pidgey. Actual targets
    // are decided dynamically by relative power (see predation.ts's
    // isPreyOf), so a hungry Spearow that's crossed onto the surface layer
    // to feed will just as happily take a small enough Bulbasaur.
    isPredator: true,
    moves: ["peck", "roost"],
    // A small, aggressive hunting bird — crepuscular, like many real-world
    // raptors/shrikes that hunt at dawn/dusk. Deliberately mismatched with
    // its diurnal prey (Pidgey): the predator is most dangerous exactly at
    // the edges of its prey's active hours, when Pidgey is itself running
    // an off-hours Speed penalty (support.ts) — real predation pressure
    // from the mismatch, not just flavor.
    activityPattern: "crepuscular",
    biomes: ["grassland", "forest"],
  }),
  sandshrew: speciesFromDex("SANDSHREW", {
    spriteKey: "sandshrew",
    placeholderColor: "#e0c068",
    homeLayer: "underground",
    // Not prey/predator itself — coexists with Diglett underground and
    // shares its Field egg group (see EGG_GROUPS_BY_BASE_KEY in
    // leveling.ts), a real cross-species breeding pair.
    moves: ["scratch", "dig", "agility", "earthquake"],
    // A desert dweller that mainline flavor text has curling up and hiding
    // from daytime heat — nocturnal, foraging once it cools off.
    activityPattern: "nocturnal",
    // "Curls up and hides" (mainline flavor text) reads as real den-digging
    // behavior, not just a burrowing neighbor riding on Diglett's coattails
    // — the roster's other obvious burrower.
    buildsShelter: true,
    // Same "no biome of its own, tagged by the surface above" reasoning as
    // Diglett — a desert-dwelling burrower reads squarely as badlands, with
    // grassland as a secondary (real-world ground squirrels/gophers aren't
    // desert-exclusive). "desert" itself added later, directly matching its
    // own flavor text ("a desert dweller") — see diglett's own comment
    // above for the direct ask this addresses.
    biomes: ["badlands", "grassland", "desert"],
  }),
  onix: speciesFromDex("ONIX", {
    spriteKey: "onix",
    placeholderColor: "#a8a878",
    homeLayer: "underground",
    // Gives the underground layer its own predator/prey drama, mirroring
    // Scyther on the surface — previously Diglett had zero threats at all.
    // Actual targets (Diglett, Sandshrew, or opportunistically anything
    // else small enough on a layer Onix visits) are dynamic — see isPreyOf.
    isPredator: true,
    moves: ["tackle", "rock_throw", "rock_slide", "earthquake"],
    // Left cathemeral (the default): it tunnels through solid rock deep
    // underground, where the surface day/night cycle has no real bearing —
    // there's no "daylight" down there to be diurnal or nocturnal about.
    // A giant rock snake — badlands/highland, the roster's two stoniest,
    // least vegetated biomes, over the softer grassland/forest/wetland set.
    biomes: ["badlands", "highland"],
  }),
  squirtle: speciesFromDex("SQUIRTLE", {
    spriteKey: "squirtle",
    placeholderColor: "#5090d0",
    homeLayer: "surface",
    // Not prey/predator itself — the roster's first Water-type, finally
    // giving the map's own ponds a resident. Real cross-species breeding
    // pair with Bulbasaur/Charmander (all three starters share the
    // Monster egg group in the real games) as well as Water 1.
    moves: ["tackle", "water_gun", "withdraw"],
    // The obvious fit — a Water-type drawn to `worldgen.ts`'s highest
    // water-density biome.
    biomes: ["wetland"],
    // Direct ask's own named example — "Squirtle should prefer water."
    preferredTerrain: ["water"],
  }),

  // --- New species below: badlands/highland residents, closing the
  // "badlands/highland have zero real residents" gap flagged in this
  // feature's task brief. Each reuses an already-implemented move
  // (moves.ts) rather than inventing a new one, and each is drawn from
  // `EGG_GROUPS_BY_BASE_KEY`'s existing Gen 1 headroom batch in
  // leveling.ts (no new egg-group entries needed). None are tagged
  // `isPredator` — the demo scenario's existing predator populations
  // (Scyther/Spearow/Onix) already crash toward extinction in a real run
  // (see TODO.md), so adding more hunters to an already-struggling
  // predator guild would just make that worse, not add real variety.
  geodude: speciesFromDex("GEODUDE", {
    spriteKey: "geodude",
    placeholderColor: "#b8a878",
    homeLayer: "surface",
    // Real cross-species breeding pair with Onix — both Mineral egg group
    // (see leveling.ts's EGG_GROUPS_BY_BASE_KEY), the first actual pairing
    // that table's existing Onix-is-alone-in-Mineral comment anticipated.
    moves: ["rock_throw", "tackle", "defense_curl", "rock_slide", "earthquake"],
    // A living boulder that mainline flavor text has rolling down
    // mountainsides — badlands/highland, both rock-and-boulder-heavy biomes
    // (see worldgen.ts's BIOMES boulder terrainWeights). "tundra" added
    // later, same reasoning — Tundra's own real signature (worldgen.ts's
    // `carveTundraPermafrost`) IS frost-heaved boulder, a genuinely apt
    // third home for a living rock.
    biomes: ["badlands", "highland", "tundra"],
    // Literally a living boulder (mainline flavor text) — the roster's most
    // direct terrain-preference fit of all: it settles among the same rocks
    // it's made of, not just the biome that happens to contain them.
    preferredTerrain: ["boulder"],
  }),
  growlithe: speciesFromDex("GROWLITHE", {
    spriteKey: "growlithe",
    placeholderColor: "#e07850",
    homeLayer: "surface",
    moves: ["ember", "agility"],
    // A loyal, territory-patrolling dog per mainline flavor text — diurnal,
    // an active daytime patroller rather than a night hunter.
    activityPattern: "diurnal",
    // Fire-type, dry/hot terrain flavor (mainline: found in rocky, arid
    // regions) — badlands. Its only mainline evolution (Arcanine) needs a
    // Fire Stone, an item-based trigger `leveling.ts`'s evolution filter
    // deliberately excludes (see that file's `computeProfileFromDexEntry`
    // doc comment on why level-with-no-conditions is the bar) — so, like
    // Onix in the existing roster, this species simply never evolves
    // in-sim yet. Not a bug, an accepted existing limitation.
    // "desert" added later, same "found in rocky, arid regions" flavor
    // reasoning as badlands above, and the same direct ask driving diglett/
    // sandshrew's own desert tag (see diglett's own comment).
    biomes: ["badlands", "desert"],
    // Fire-type warmth-seeker, same "sunbeam" affinity reasoning as
    // Charmander above — a dry-terrain dog that suns itself when idle.
    preferredTerrain: ["sunbeam"],
  }),
  mankey: speciesFromDex("MANKEY", {
    spriteKey: "mankey",
    placeholderColor: "#c07850",
    homeLayer: "surface",
    // Fighting-type — Scratch is its actual first-level mainline move
    // (levelMoves[0] in the dex data), not a stretch reuse.
    moves: ["scratch"],
    // A short-tempered, easily-provoked highland/mountain primate per
    // mainline flavor text — badlands as a secondary (its Pokedex entries
    // also place it in "rocky mountains," which blends into both of this
    // roster's rockiest biomes).
    biomes: ["highland", "badlands"],
    // A real level-only evolution (Primeape at level 28, no conditions) —
    // unlike Growlithe above, this species does evolve in-sim.
    // A "rocky mountains" primate — settles among the same boulder fields
    // as Geodude, its badlands/highland neighbor.
    preferredTerrain: ["boulder"],
  }),

  // --- New species below: real obligate-aquatic residents — direct ask:
  // "certain Pokémon like Magicarp and tentacool and stuff should probably
  // not really be leaving the water." Both are named directly in the ask;
  // both are real entries in this roster's dex import (species.generated.ts)
  // and already have `EGG_GROUPS_BY_BASE_KEY` headroom entries in
  // leveling.ts (MAGIKARP/TENTACOOL), so no leveling.ts change was needed to
  // add them. See DESIGN.md's "obligate-aquatic" section for the roster
  // survey and reasoning this batch is drawn from (which other Kanto
  // aquatic species were considered and left out, and why). Both reuse an
  // already-implemented move (moves.ts) rather than inventing a new one.
  magikarp: speciesFromDex("MAGIKARP", {
    spriteKey: "magikarp",
    placeholderColor: "#e88090",
    homeLayer: "surface",
    // A real level-only evolution into Gyarados at level 20, no conditions —
    // evolves in-sim same as Mankey above. Gyarados's own Flying secondary
    // typing isn't specially handled: `obligateAquatic` is denormalized at
    // spawn and, like `buildsShelter`/`preferredTerrain`, doesn't reset on
    // evolution (see DESIGN.md's "not done here" list) — an evolved
    // Gyarados stays obligate-aquatic in-sim even though real Gyarados can
    // fly, an accepted existing-pattern gap, not a new one.
    moves: ["tackle"],
    // Famously "virtually powerless... this Pokémon can only splash around
    // in water" per mainline flavor text — the single most literal
    // obligate-aquatic case in the whole dex.
    obligateAquatic: true,
    // Wetland is this roster's only real water-heavy biome (worldgen.ts's
    // highest waterDensity) — same fit as Squirtle.
    biomes: ["wetland"],
    preferredTerrain: ["water"],
  }),
  tentacool: speciesFromDex("TENTACOOL", {
    spriteKey: "tentacool",
    placeholderColor: "#88c8d8",
    homeLayer: "surface",
    // A real level-only evolution into Tentacruel at level 30, no
    // conditions — evolves in-sim, same accepted "flag doesn't reset on
    // evolution" gap noted for Magikarp above (Tentacruel is also
    // obligate-aquatic in real mainline flavor text regardless, so this
    // particular case isn't even a real mismatch).
    moves: ["water_gun"],
    // A drifting jellyfish per mainline flavor text ("floats on the ocean's
    // waves... drifts in shallow seas") — has no legs/land locomotion of any
    // kind, an even more literal case than Magikarp.
    obligateAquatic: true,
    biomes: ["wetland"],
    preferredTerrain: ["water"],
  }),

  // --- Evolution-line completions below. Direct follow-up to a "what's
  // missing" review: every evolution above was reachable purely through
  // in-sim leveling, but `SPECIES[agent.species]` — the ONLY source for
  // ecological behavior (biomes/preferredTerrain/buildsShelter/
  // obligateAquatic; see leveling.ts's `computeProfileFromDexEntry`) — had
  // no entry for any of them, so an evolved agent quietly lost all
  // personality the instant it evolved (also why its sprite briefly stopped
  // rendering too, before that separate renderer.ts fallback fix). Sprite
  // art for every one of these already exists (public/sprites/) and was
  // spot-checked rendering correctly. Each keeps its pre-evolution's own
  // flavor/behavior tags rather than reinventing them, upgrading only what
  // a real evolution plausibly changes (a stronger move once one exists in
  // the small curated `MOVES` roster; broader activity for a former prey
  // species that's outgrown most of its predators).
  ivysaur: speciesFromDex("IVYSAUR", {
    spriteKey: "ivysaur",
    placeholderColor: "#5cae5c",
    homeLayer: "surface",
    moves: ["tackle", "vine_whip", "leech_seed", "sweet_scent", "solar_beam"],
    // Same sun-grazing temperament as Bulbasaur — the bulb (now a bud)
    // still needs light to keep growing toward its eventual bloom.
    activityPattern: "diurnal",
    biomes: ["grassland", "forest"],
    preferredTerrain: ["flora"],
  }),
  charmeleon: speciesFromDex("CHARMELEON", {
    spriteKey: "charmeleon",
    placeholderColor: "#f5701c",
    homeLayer: "surface",
    // Direct ask: "Charizard and chameleon should become predators" — this
    // stage already reads as a real hunter in mainline flavor text ("cruel,
    // savage nature," burns anything that resists), not merely a scaled-up
    // Charmander.
    isPredator: true,
    // Bigger flame, same fuel source — "scratch" as a real physical attack
    // alongside Ember now that it's grown claws worth using, rather than
    // just a hotter Charmander.
    moves: ["scratch", "ember"],
    activityPattern: "diurnal",
    biomes: ["badlands"],
    preferredTerrain: ["sunbeam"],
  }),
  charizard: speciesFromDex("CHARIZARD", {
    spriteKey: "charizard",
    placeholderColor: "#e8712c",
    homeLayer: "surface",
    // Direct ask: "Charizard and chameleon should become predators" — the
    // comment right below already called this "an apex flyer/predator
    // design in the mainline games"; this makes that read a real mechanic.
    isPredator: true,
    // The roster's one curated Flamethrower user — its tail flame is
    // "said to burn even more intensely" per mainline flavor text, so the
    // upgrade from Ember is the whole point of finally reaching this stage.
    moves: ["slash", "flamethrower"],
    // Deliberately left cathemeral (the default), same reasoning as
    // Venusaur above — by this stage it's an apex flyer/predator design in
    // the mainline games, not a creature still keeping a grazer's hours.
    biomes: ["badlands", "highland"],
    preferredTerrain: ["sunbeam"],
  }),
  wartortle: speciesFromDex("WARTORTLE", {
    spriteKey: "wartortle",
    placeholderColor: "#4a80c0",
    homeLayer: "surface",
    moves: ["tackle", "water_gun", "withdraw", "surf"],
    biomes: ["wetland"],
    preferredTerrain: ["water"],
  }),
  blastoise: speciesFromDex("BLASTOISE", {
    spriteKey: "blastoise",
    placeholderColor: "#3868a8",
    homeLayer: "surface",
    // Its real signature finisher, now shipped in the curated `MOVES` set —
    // Tackle/Water Gun stay alongside it, same "keep the pre-evolution's
    // kit, don't strip it down" approach every entry in this batch takes.
    moves: ["tackle", "water_gun", "withdraw", "hydro_pump", "surf"],
    biomes: ["wetland"],
    preferredTerrain: ["water"],
  }),
  gyarados: speciesFromDex("GYARADOS", {
    spriteKey: "gyarados",
    placeholderColor: "#4060a8",
    homeLayer: "surface",
    // Real fix, not just a new entry: Magikarp's own doc comment above
    // flags that `obligateAquatic` "doesn't reset on evolution" as an
    // accepted gap, since it's denormalized once at spawn from whatever
    // species an agent WAS — but `computeProfileFromDexEntry` actually
    // reads `SPECIES[speciesId]` for the agent's CURRENT species every
    // time, so simply curating Gyarados here with its own (real, accurate)
    // tag resolves that specific case: mainline Gyarados is a
    // Water/Flying rampaging serpent capable of leaving water entirely
    // (thrashing on land, breaking free of it, is a recurring anime/manga
    // beat), so `obligateAquatic` is correctly omitted rather than
    // inherited — an evolved Gyarados now genuinely stops being
    // water-locked instead of staying stuck with Magikarp's restriction
    // forever.
    isPredator: true,
    moves: ["tackle", "rain_dance", "hydro_pump"],
    biomes: ["wetland"],
    preferredTerrain: ["water"],
  }),
  tentacruel: speciesFromDex("TENTACRUEL", {
    spriteKey: "tentacruel",
    placeholderColor: "#7860a8",
    homeLayer: "surface",
    isPredator: true,
    moves: ["water_gun", "sludge"],
    // Genuinely obligate-aquatic in mainline flavor text too (Tentacool's
    // own comment above already notes this isn't a real mismatch) — unlike
    // Gyarados, this one legitimately keeps the tag on evolving.
    obligateAquatic: true,
    biomes: ["wetland"],
    preferredTerrain: ["water"],
  }),

  // --- Snow-biome residents below. Direct ask: "snowy mountain tops where
  // ice Pokemon and dragon live" — worldgen.ts/macroGrid.ts grew a real
  // "snow" biome (elevation-gated above Highland) for this session's
  // regional-terrain pass; these are its first two real residents.
  seel: speciesFromDex("SEEL", {
    spriteKey: "seel",
    placeholderColor: "#a0d8ef",
    homeLayer: "surface",
    moves: ["tackle", "water_gun", "safeguard", "ice_beam"],
    // Canonically an arctic pinniped that hauls out on ice and swims in
    // frigid water — snow as primary habitat, wetland as the closest
    // "open water" secondary this roster's biome set has.
    biomes: ["snow", "wetland"],
    preferredTerrain: ["water"],
  }),
  dratini: speciesFromDex("DRATINI", {
    spriteKey: "dratini",
    placeholderColor: "#7ba8c8",
    homeLayer: "surface",
    // No curated Dragon-type move exists yet (small `MOVES` roster) —
    // Tackle, same off-type-move acceptance this file already makes for
    // several other species (e.g. Onix's Tackle/Rock Throw).
    moves: ["tackle", "rain_dance"],
    // A real creative liberty, flagged rather than quietly asserted as
    // canon: mainline Dratini's own flavor text places it in lakes/rivers,
    // not snowy peaks — grouped here anyway per this feature's own direct
    // ask naming "ice... and dragon" together as snow-biome residents.
    // Wetland kept as a secondary nod to its actual mainline habitat.
    biomes: ["snow", "wetland"],
    preferredTerrain: ["water"],
  }),
  // Direct ask: "add like a little species. More throughout? Each zone
  // should have at least 4, max 7 to start" — the zone species-pool floor
  // (macroGrid.ts's `ZONE_SPECIES_POOL_MIN`) can't be met by a habitat that
  // structurally doesn't have that many fitting species to begin with;
  // obligate-aquatic ("ocean") had only 3 (magikarp/tentacool/tentacruel).
  // Horsea/Seadra are real, fully-aquatic Gen 1 water creatures — a genuine
  // fourth (and evolved fifth) resident, not padding.
  horsea: speciesFromDex("HORSEA", {
    spriteKey: "horsea",
    placeholderColor: "#88c0d8",
    homeLayer: "surface",
    // Water Gun (level 1) and Agility (level 28) are Horsea's real level-up
    // moves — same "off-type/simple curated pair" pattern as dratini's own
    // entry above.
    moves: ["water_gun", "agility"],
    biomes: ["wetland"],
    obligateAquatic: true,
    preferredTerrain: ["water"],
  }),
  seadra: speciesFromDex("SEADRA", {
    spriteKey: "seadra",
    placeholderColor: "#5890b0",
    homeLayer: "surface",
    moves: ["water_gun", "agility"],
    biomes: ["wetland"],
    obligateAquatic: true,
    preferredTerrain: ["water"],
  }),

  // --- New base species below: direct ask ("more species? more biome
  // types???") following the new desert/jungle/beach biomes (worldgen.ts/
  // macroGrid.ts) — real residents for all three, plus a few more for the
  // existing roster's thinner biomes (grassland/highland/snow). Originally
  // ALL 14 kept this batch's own predator-guild caution from the badlands/
  // highland pass above: none tagged `isPredator`, even the ones (Ekans/
  // Arbok's real egg-eating, Zubat/Golbat's real "drains life energy"
  // flavor) that clearly qualified, since the existing predator guild
  // already crashed toward extinction in a real run per TODO.md. Direct
  // follow-up ask, later in the same project: "I think ekans and arbok are
  // predators... make sure we accurately mark em... try to have at least
  // some predators + prey per each zone" — those four are now tagged for
  // real (see each one's own comment below), alongside the actual fix for
  // the fragility this caution was guarding against:
  // macroGrid.ts's `pickZoneSpeciesPool` now deliberately balances a zone's
  // invented population toward a SMALL number of predators against more
  // prey, and TODO.md's own "one predator species = 100% of pressure"
  // finding is directly addressed by there now being real predator variety
  // instead of one single species carrying the whole guild. Each evolution
  // reachable purely by in-sim leveling (checked
  // against the dex's own `evolutions` data, `conditions: {}` only — same
  // bar `leveling.ts`'s `computeProfileFromDexEntry` itself uses) gets its
  // own curated entry too, same "don't let an evolved agent quietly lose
  // its personality" standard as this file's earlier evolution-completion
  // pass. Every egg group already has real headroom in `leveling.ts`'s
  // `EGG_GROUPS_BY_BASE_KEY` — no leveling.ts changes needed for any of
  // these.
  vulpix: speciesFromDex("VULPIX", {
    spriteKey: "vulpix",
    placeholderColor: "#ee9090",
    homeLayer: "surface",
    moves: ["ember", "safeguard"],
    // A warmth-loving fire fox — diurnal, same reasoning as Charmander/
    // Growlithe above.
    activityPattern: "diurnal",
    // Its only mainline evolution (Ninetales) needs a Fire Stone — same
    // accepted "never evolves in-sim" limitation as Growlithe above, not a
    // bug.
    biomes: ["desert", "badlands"],
    preferredTerrain: ["sunbeam"],
  }),
  cubone: speciesFromDex("CUBONE", {
    spriteKey: "cubone",
    placeholderColor: "#d8c8a8",
    homeLayer: "surface",
    moves: ["tackle"],
    // Mainline flavor text: "cries within its shell... [at night]" — a
    // genuinely nocturnal, mournful loner.
    activityPattern: "nocturnal",
    // Both this dex's evolution options (to Marowak or Alolan Marowak) carry
    // a TIME condition, not a plain level — excluded by `leveling.ts`'s own
    // "conditions must be empty" bar, same as Growlithe/Vulpix's item-locked
    // cases above. Never evolves in-sim; an accepted existing limitation,
    // not a new gap.
    biomes: ["desert", "badlands"],
  }),
  ekans: speciesFromDex("EKANS", {
    spriteKey: "ekans",
    placeholderColor: "#a89060",
    homeLayer: "surface",
    // Poison Sting is Ekans's real level-1 move.
    moves: ["tackle", "poison_sting"],
    // "Moves silently and stealthily... eats bird eggs whole" per mainline
    // flavor text — a nocturnal ambush hunter's hours. Direct ask ("I think
    // ekans and arbok are predators... make sure we accurately mark em"):
    // this batch's own original top comment deliberately left it untagged,
    // citing the predator guild's real extinction fragility (see TODO.md) —
    // now tagged for real, alongside the zone-composition guarantee
    // (macroGrid.ts's `pickZoneSpeciesPool`) that was the actual missing
    // piece keeping that fragility in check, not species accuracy itself.
    isPredator: true,
    activityPattern: "nocturnal",
    biomes: ["grassland", "jungle"],
  }),
  arbok: speciesFromDex("ARBOK", {
    spriteKey: "arbok",
    placeholderColor: "#785888",
    homeLayer: "surface",
    moves: ["tackle", "poison_sting", "sludge"],
    // See ekans's own comment immediately above — same direct ask, same reasoning.
    isPredator: true,
    activityPattern: "nocturnal",
    biomes: ["grassland", "jungle"],
    // Direct ask: "make arboks less common. I just don't like em lol" — a
    // real, judged-per-species dial (see `SpeciesDef.rarity`'s own doc
    // comment), not a change to Ekans (its own base form) or any other
    // species on the roster. Follow-up ask ("further reduce arbok spawn")
    // after 0.35 still wasn't rare enough — dropped further rather than
    // to 0, so it can still show up, just uncommonly.
    rarity: 0.12,
  }),
  caterpie: speciesFromDex("CATERPIE", {
    spriteKey: "caterpie",
    placeholderColor: "#a8c848",
    homeLayer: "surface",
    moves: ["tackle"],
    activityPattern: "diurnal",
    biomes: ["jungle", "forest"],
    // A leaf-eating larva that hides among foliage (mainline flavor text) —
    // same concealment-seeking idiom as Scyther above.
    preferredTerrain: ["bush"],
  }),
  metapod: speciesFromDex("METAPOD", {
    spriteKey: "metapod",
    placeholderColor: "#78a838",
    homeLayer: "surface",
    // Real mainline moveset is just Harden (a stat move, not curated) — kept
    // Tackle rather than inventing a new curated move, same off-type reuse
    // acceptance this file already makes elsewhere (e.g. Onix/Dratini).
    moves: ["tackle", "harden"],
    activityPattern: "diurnal",
    biomes: ["jungle", "forest"],
    preferredTerrain: ["bush"],
  }),
  butterfree: speciesFromDex("BUTTERFREE", {
    spriteKey: "butterfree",
    placeholderColor: "#a890f0",
    homeLayer: "surface",
    moves: ["tackle", "safeguard"],
    biomes: ["jungle", "forest"],
  }),
  weedle: speciesFromDex("WEEDLE", {
    spriteKey: "weedle",
    placeholderColor: "#c8b820",
    homeLayer: "surface",
    // Poison Sting is a real early level move for Weedle.
    moves: ["tackle", "poison_sting"],
    activityPattern: "diurnal",
    biomes: ["jungle", "forest"],
    preferredTerrain: ["bush"],
  }),
  kakuna: speciesFromDex("KAKUNA", {
    spriteKey: "kakuna",
    placeholderColor: "#e0c020",
    homeLayer: "surface",
    moves: ["tackle", "harden"],
    activityPattern: "diurnal",
    biomes: ["jungle", "forest"],
    preferredTerrain: ["bush"],
  }),
  beedrill: speciesFromDex("BEEDRILL", {
    spriteKey: "beedrill",
    placeholderColor: "#f8d030",
    homeLayer: "surface",
    // Twineedle is Beedrill's real signature level move.
    moves: ["tackle", "agility", "twineedle"],
    biomes: ["jungle", "forest"],
  }),
  oddish: speciesFromDex("ODDISH", {
    spriteKey: "oddish",
    placeholderColor: "#8878c8",
    homeLayer: "surface",
    moves: ["tackle", "growth", "grassy_terrain"],
    // "During the day it stays motionless... starts to move around at
    // night" per mainline flavor text — a literal, direct nocturnal fit.
    activityPattern: "nocturnal",
    biomes: ["jungle", "forest"],
    preferredTerrain: ["flora"],
  }),
  gloom: speciesFromDex("GLOOM", {
    spriteKey: "gloom",
    placeholderColor: "#a878c0",
    homeLayer: "surface",
    moves: ["tackle", "growth", "grassy_terrain"],
    activityPattern: "nocturnal",
    biomes: ["jungle", "forest"],
    preferredTerrain: ["flora"],
  }),
  krabby: speciesFromDex("KRABBY", {
    spriteKey: "krabby",
    placeholderColor: "#f08030",
    homeLayer: "surface",
    moves: ["tackle", "water_gun", "harden"],
    // "Digs holes in beaches to live in" per mainline flavor text — a real,
    // literal burrower, same standard Diglett/Sandshrew's own callouts use.
    buildsShelter: true,
    // "mangrove" added alongside the new biome itself — a real coastal crab
    // that already digs beach/wetland burrows fits a brackish marsh just as
    // naturally, no new species needed to give Mangrove a crab resident.
    biomes: ["beach", "wetland", "mangrove"],
    preferredTerrain: ["water"],
  }),
  kingler: speciesFromDex("KINGLER", {
    spriteKey: "kingler",
    placeholderColor: "#e85838",
    homeLayer: "surface",
    moves: ["tackle", "water_gun", "harden"],
    buildsShelter: true,
    // See krabby's own comment immediately above — same reasoning.
    biomes: ["beach", "wetland", "mangrove"],
    preferredTerrain: ["water"],
  }),
  shellder: speciesFromDex("SHELLDER", {
    spriteKey: "shellder",
    placeholderColor: "#c8d8f0",
    homeLayer: "surface",
    moves: ["tackle", "harden"],
    // "Usually stays in the sea, but sometimes washes up on the shore" per
    // mainline flavor text — genuinely at home on a real Beach biome, but
    // NOT tagged `obligateAquatic`: unlike Magikarp/Tentacool, its own
    // flavor text implies it survives fine when it does wash ashore, so the
    // literal "can't survive out of water at all" bar this file holds that
    // flag to isn't met.
    biomes: ["beach", "wetland"],
    preferredTerrain: ["water"],
  }),
  psyduck: speciesFromDex("PSYDUCK", {
    spriteKey: "psyduck",
    placeholderColor: "#f8d868",
    homeLayer: "surface",
    // Psybeam is a real level-up move for Psyduck.
    moves: ["tackle", "water_gun", "psybeam"],
    biomes: ["beach", "wetland"],
    preferredTerrain: ["water"],
  }),
  golduck: speciesFromDex("GOLDUCK", {
    spriteKey: "golduck",
    placeholderColor: "#7098c8",
    homeLayer: "surface",
    moves: ["tackle", "water_gun", "psybeam", "surf"],
    biomes: ["beach", "wetland"],
    preferredTerrain: ["water"],
  }),
  ponyta: speciesFromDex("PONYTA", {
    spriteKey: "ponyta",
    placeholderColor: "#f8d0b0",
    homeLayer: "surface",
    moves: ["ember", "agility"],
    activityPattern: "diurnal",
    biomes: ["grassland", "highland"],
    preferredTerrain: ["sunbeam"],
  }),
  rapidash: speciesFromDex("RAPIDASH", {
    spriteKey: "rapidash",
    placeholderColor: "#f0a048",
    homeLayer: "surface",
    moves: ["tackle", "ember", "agility"],
    activityPattern: "diurnal",
    biomes: ["grassland", "highland"],
    preferredTerrain: ["sunbeam"],
  }),
  snorlax: speciesFromDex("SNORLAX", {
    spriteKey: "snorlax",
    placeholderColor: "#a8b090",
    homeLayer: "surface",
    // Body Slam is Snorlax's real iconic level move.
    moves: ["tackle", "defense_curl", "body_slam"],
    // Eats, then sleeps, regardless of time of day per mainline flavor text
    // — deliberately left cathemeral (the default), same reasoning as
    // Venusaur/Charizard above.
    biomes: ["forest", "jungle"],
  }),
  lapras: speciesFromDex("LAPRAS", {
    spriteKey: "lapras",
    placeholderColor: "#a0c8e8",
    homeLayer: "surface",
    moves: ["tackle", "water_gun", "safeguard", "surf", "ice_beam"],
    // A gentle arctic reptile that ferries riders across icy seas per
    // mainline flavor text — Snow as primary, Wetland as the closest "open
    // water" secondary this roster's biome set has, same pairing Seel above
    // already uses.
    biomes: ["snow", "wetland"],
    preferredTerrain: ["water"],
  }),
  jynx: speciesFromDex("JYNX", {
    spriteKey: "jynx",
    placeholderColor: "#f8b8d8",
    homeLayer: "surface",
    moves: ["tackle", "ice_beam", "psybeam"],
    // "Lives in frigid areas" per mainline flavor text — a direct, literal
    // Snow-biome fit, Highland as the nearest secondary "cold mountain" this
    // roster's biome set has.
    biomes: ["snow", "highland"],
  }),
  zubat: speciesFromDex("ZUBAT", {
    spriteKey: "zubat",
    placeholderColor: "#7860a8",
    // Roosts in permanently dark places per mainline flavor text — the same
    // "no biome of its own, tagged by the surface above" reasoning as
    // Diglett/Onix, and a genuinely better flavor fit than the open-treetop
    // Canopy layer Pidgey/Spearow use.
    homeLayer: "underground",
    // Poison Sting is Zubat's real level-1 move.
    moves: ["tackle", "poison_sting"],
    // Real "drains life energy" vampiric flavor — the exact case this
    // batch's own original top comment named as qualifying but left
    // untagged over predator-guild fragility (see TODO.md). Direct ask
    // ("make a pass on predators, make sure we accurately mark em"): tagged
    // for real now, alongside macroGrid.ts's `pickZoneSpeciesPool` zone-
    // composition guarantee — see ekans's own comment above for the full
    // reasoning.
    isPredator: true,
    // Avoids daylight entirely per mainline flavor text.
    activityPattern: "nocturnal",
    biomes: ["highland", "badlands"],
  }),
  golbat: speciesFromDex("GOLBAT", {
    spriteKey: "golbat",
    placeholderColor: "#6848a0",
    homeLayer: "underground",
    moves: ["tackle", "poison_sting", "wing_attack"],
    // See zubat's own comment immediately above — same direct ask, same reasoning.
    isPredator: true,
    activityPattern: "nocturnal",
    // Real further evolution (Crobat) needs a FRIENDSHIP condition, not a
    // plain level — same "never evolves in-sim" limitation as Growlithe/
    // Vulpix/Cubone above, just a different condition kind.
    biomes: ["highland", "badlands"],
  }),

  // --- New species below: direct follow-up ask, alongside the new
  // Savanna/Mangrove/Tundra biomes: "spawn more unique Pokemon species in
  // these places to give em flavor." First pass picked Gen 2/3 species by
  // flavor fit alone and only checked afterward that public/sprites/ had no
  // art for 8 of the 9 — direct catch: "Oh... you did Gen 2... I don't
  // think we got sprites for em." Replaced with Gen-1-only picks, every one
  // confirmed to have real drawn sprite art in public/sprites/ BEFORE being
  // added this time (checked directly, not assumed), same "each evolution
  // reachable purely by in-sim leveling gets its own curated entry"
  // standard as before (checked against each dex entry's own `evolutions`,
  // `conditions: {}` only).
  tauros: speciesFromDex("TAUROS", {
    spriteKey: "tauros",
    placeholderColor: "#c88840",
    homeLayer: "surface",
    moves: ["tackle", "body_slam"],
    activityPattern: "diurnal",
    // A real wild-plains bull.
    biomes: ["savanna", "grassland"],
  }),
  kangaskhan: speciesFromDex("KANGASKHAN", {
    spriteKey: "kangaskhan",
    placeholderColor: "#c8845c",
    homeLayer: "surface",
    // Real Kangaskhan level-1 move is Comet Punch, not in this roster's
    // curated move set — Tackle/Body Slam stand in, same off-type-reuse
    // acceptance this file's own Onix/Dratini entries use.
    moves: ["tackle", "body_slam"],
    activityPattern: "diurnal",
    // A real open-plains/outback marsupial per mainline flavor text — no
    // mainline evolution exists at all, so no "never evolves in-sim"
    // caveat needed.
    biomes: ["savanna", "grassland"],
  }),
  poliwag: speciesFromDex("POLIWAG", {
    spriteKey: "poliwag",
    placeholderColor: "#68a0c0",
    homeLayer: "surface",
    // Water Gun is Poliwag's real level-1 move.
    moves: ["tackle", "water_gun"],
    // "Prefers to live near water... in swamps" per mainline flavor text —
    // a real, literal match for a coastal marsh.
    biomes: ["mangrove", "wetland"],
    preferredTerrain: ["water"],
  }),
  poliwhirl: speciesFromDex("POLIWHIRL", {
    spriteKey: "poliwhirl",
    placeholderColor: "#5088b0",
    homeLayer: "surface",
    moves: ["tackle", "water_gun"],
    biomes: ["mangrove", "wetland"],
    preferredTerrain: ["water"],
    // Real further evolution (Poliwrath) needs a Water Stone — same
    // "never evolves in-sim" limitation as Growlithe/Vulpix/Cubone above.
  }),
  slowpoke: speciesFromDex("SLOWPOKE", {
    spriteKey: "slowpoke",
    placeholderColor: "#f0a8b8",
    homeLayer: "surface",
    moves: ["tackle"],
    // "Lazily suns itself on the shore" per mainline flavor text — a real
    // shoreline/marsh dweller.
    biomes: ["mangrove", "wetland"],
    preferredTerrain: ["water"],
  }),
  slowbro: speciesFromDex("SLOWBRO", {
    spriteKey: "slowbro",
    placeholderColor: "#e888a0",
    homeLayer: "surface",
    moves: ["tackle", "water_gun"],
    biomes: ["mangrove", "wetland"],
    preferredTerrain: ["water"],
    // Real further evolution (Mega Slowbro) is a battle-only Mega, not a
    // real in-sim leveling path — same "never evolves further in-sim"
    // limitation as Piloswine/Golbat above.
  }),
  dewgong: speciesFromDex("DEWGONG", {
    spriteKey: "dewgong",
    placeholderColor: "#c8f0f8",
    homeLayer: "surface",
    // Real Dewgong level-1 move is Headbutt, not in this roster's curated
    // move set — Water Gun/Ice Beam stand in instead, matching its own
    // real Water/Ice typing.
    moves: ["tackle", "water_gun", "ice_beam"],
    // Seel's own real, in-sim-reachable evolution (level 34, no item/
    // condition) — Seel itself stays tagged ["snow", "wetland"] above
    // unchanged; this is its own curated entry for the evolved form, same
    // "don't let an evolved agent quietly lose its personality" standard
    // this file's other evolution-completion entries follow. A real
    // arctic pinniped — Tundra as a real cold-open-ground secondary
    // alongside Seel's own Snow/Wetland pairing.
    biomes: ["snow", "tundra"],
    preferredTerrain: ["water"],
  }),

  // --- Second round, same three biomes: direct follow-up ask, "we need
  // more species that can spawn in them than just those. I don't think
  // we're anywhere near our full species list." All Gen 1, all confirmed
  // to have real public/sprites/ art BEFORE being added, same standard the
  // Gen-2/3 correction above established. Not exhaustive — packages/web/
  // public/sprites/ still has ~85 more real, arted Gen-1 species with no
  // roster entry at all, a real broader gap this batch doesn't attempt to
  // close on its own.
  doduo: speciesFromDex("DODUO", {
    spriteKey: "doduo",
    placeholderColor: "#c8a860",
    homeLayer: "surface",
    // Peck is Doduo's real level-1 move.
    moves: ["peck"],
    activityPattern: "diurnal",
    // "Roams the savanna" per mainline flavor text — about as literal a
    // biome match as this roster has.
    biomes: ["savanna", "grassland"],
  }),
  dodrio: speciesFromDex("DODRIO", {
    spriteKey: "dodrio",
    placeholderColor: "#a88848",
    homeLayer: "surface",
    // Agility is a real, early Dodrio move (a fast, skittish runner).
    moves: ["peck", "agility"],
    activityPattern: "diurnal",
    biomes: ["savanna", "grassland"],
    // Real further evolution doesn't exist (Dodrio is the top of its own
    // line) — no "never evolves in-sim" caveat needed.
  }),
  rhyhorn: speciesFromDex("RHYHORN", {
    spriteKey: "rhyhorn",
    placeholderColor: "#b0a090",
    homeLayer: "surface",
    // Real Rhyhorn level-1 moves (Horn Attack/Tail Whip/Sand Attack) aren't
    // in this roster's curated move set — Rock Throw stands in, matching
    // its own real Rock-type half.
    moves: ["tackle", "rock_throw"],
    // "Wild Rhyhorn charge through savannas" per mainline flavor text.
    biomes: ["savanna", "badlands"],
  }),
  rhydon: speciesFromDex("RHYDON", {
    spriteKey: "rhydon",
    placeholderColor: "#8c7c6c",
    homeLayer: "surface",
    moves: ["tackle", "rock_throw", "earthquake"],
    biomes: ["savanna", "badlands"],
    // Real further evolution (Rhyperior) needs a held item during a trade —
    // same "never evolves further in-sim" limitation as Graveler below.
  }),
  goldeen: speciesFromDex("GOLDEEN", {
    spriteKey: "goldeen",
    placeholderColor: "#f08090",
    homeLayer: "surface",
    // Peck is a real early Goldeen move; Water Gun stands in for its Water
    // typing, same pattern Poliwag/Slowbro above already use.
    moves: ["peck", "water_gun"],
    biomes: ["mangrove", "wetland"],
    preferredTerrain: ["water"],
  }),
  seaking: speciesFromDex("SEAKING", {
    spriteKey: "seaking",
    placeholderColor: "#e86868",
    homeLayer: "surface",
    moves: ["peck", "water_gun", "surf"],
    biomes: ["mangrove", "wetland"],
    preferredTerrain: ["water"],
  }),
  grimer: speciesFromDex("GRIMER", {
    spriteKey: "grimer",
    placeholderColor: "#706090",
    homeLayer: "surface",
    // Harden is a real early Grimer move; Sludge stands in for its real
    // Poison Gas (not in this roster's curated move set), same signature
    // Ekans/Arbok/Zubat already use.
    moves: ["harden", "sludge"],
    // A real brackish-muck dweller per mainline flavor text ("born from
    // sludge") — a genuinely apt fit for a coastal marsh, not a stretch.
    biomes: ["mangrove", "wetland"],
  }),
  muk: speciesFromDex("MUK", {
    spriteKey: "muk",
    placeholderColor: "#584870",
    homeLayer: "surface",
    moves: ["harden", "sludge"],
    biomes: ["mangrove", "wetland"],
  }),
  farfetchd: speciesFromDex("FARFETCHD", {
    spriteKey: "farfetchd",
    placeholderColor: "#c8b878",
    homeLayer: "surface",
    // Peck is a real early Farfetch'd move; Slash stands in for its later
    // real Leaf Blade/cutting-signature moveset (not curated here).
    moves: ["peck", "slash"],
    activityPattern: "diurnal",
    // A real wild-leek marsh-dwelling bird per mainline flavor text — no
    // mainline evolution exists at all.
    biomes: ["mangrove", "wetland"],
  }),
  graveler: speciesFromDex("GRAVELER", {
    spriteKey: "graveler",
    placeholderColor: "#9c8c6c",
    homeLayer: "surface",
    // Real Graveler level-1 moves (Tackle/Defense Curl) match this
    // roster's curated set directly — Rock Throw added to match Geodude's
    // own moveset style.
    moves: ["tackle", "defense_curl", "rock_throw"],
    // Geodude's own real, in-sim-reachable evolution (level 25, no item/
    // condition) — Geodude itself stays tagged
    // ["badlands", "highland", "tundra"] above unchanged; this is its own
    // curated entry for the evolved form, same "don't let an evolved agent
    // quietly lose its personality" standard the rest of this file follows.
    biomes: ["badlands", "highland", "tundra"],
    preferredTerrain: ["boulder"],
    // Real further evolution (Golem) needs a held item during a trade —
    // same "never evolves further in-sim" limitation as Poliwhirl/Rhydon.
  }),

  // --- Third round, whole-roster pass: direct follow-up ask, after the
  // Savanna/Mangrove/Tundra-specific rounds above: "let's add more.
  // Species to em all." Only 57 of 151 real Gen-1-arted species
  // (public/sprites/) were in the roster before this batch — every pick
  // below confirmed to have real sprite art AND (where an evolution is
  // included) a real in-sim-reachable evolution (`level`, `conditions: {}`
  // — checked directly against the dex, not assumed) before being added,
  // same standard every prior round in this file set. Deliberately
  // excludes the 5 Gen-1 legendaries (Articuno/Zapdos/Moltres/Mewtwo/Mew) —
  // adding them as ordinary spawnable population members is a real design
  // decision (this is a population sim, not a catching game) this batch
  // doesn't make unilaterally; flagged in TODO.md instead. Also skips a
  // handful of real Gen-1 species with genuinely no natural-biome fit for
  // an ecological sim (Ditto, Porygon, Electabuzz, Hitmonlee/Hitmonchan,
  // Mr. Mime) rather than forcing a thin justification just to pad count.
  rattata: speciesFromDex("RATTATA", {
    spriteKey: "rattata",
    placeholderColor: "#a89078",
    homeLayer: "surface",
    moves: ["tackle"],
    activityPattern: "nocturnal",
    // "Found anywhere" per mainline flavor text — the roster's other true
    // generalist alongside Herbs' own any-biome crop gate.
    biomes: ["grassland", "forest", "badlands"],
  }),
  raticate: speciesFromDex("RATICATE", {
    spriteKey: "raticate",
    placeholderColor: "#8c7860",
    homeLayer: "surface",
    moves: ["tackle"],
    activityPattern: "nocturnal",
    // Rattata's own real, in-sim-reachable evolution (level 20, no item/
    // condition).
    biomes: ["grassland", "forest", "badlands"],
  }),
  pidgeotto: speciesFromDex("PIDGEOTTO", {
    spriteKey: "pidgeotto",
    placeholderColor: "#c8a868",
    homeLayer: "canopy",
    moves: ["tackle", "wing_attack"],
    activityPattern: "diurnal",
    // Pidgey's own real, in-sim-reachable evolution (level 36, no item/
    // condition) — Pidgey itself stays tagged ["grassland", "forest"]
    // above unchanged; canopy has no biome of its own, same "tagged by the
    // surface below" reasoning Pidgey's own entry already documents.
    biomes: ["grassland", "forest"],
  }),
  pidgeot: speciesFromDex("PIDGEOT", {
    spriteKey: "pidgeot",
    placeholderColor: "#b89058",
    homeLayer: "canopy",
    moves: ["tackle", "wing_attack"],
    activityPattern: "diurnal",
    // Pidgeotto's own real, in-sim-reachable evolution (level 36 total
    // from Pidgey, no item/condition).
    biomes: ["grassland", "forest"],
  }),
  fearow: speciesFromDex("FEAROW", {
    spriteKey: "fearow",
    placeholderColor: "#8c6848",
    homeLayer: "canopy",
    moves: ["peck", "roost"],
    // See spearow's own comment above — same direct ask, same reasoning: a
    // real predator, most dangerous at dawn/dusk.
    isPredator: true,
    // Spearow's own real, in-sim-reachable evolution (level 20, no item/
    // condition) — Spearow itself stays tagged unchanged.
    biomes: ["grassland", "forest"],
  }),
  nidoranf: speciesFromDex("NIDORAN_F", {
    // Explicit id override — speciesFromDex defaults to the dex key
    // lowercased ("nidoran_f"), which wouldn't match this entry's own
    // object property name ("nidoranf"); every other lookup in this
    // codebase (IMMIGRATION_CONTEXT, spawnAgent) keys by the object
    // property, so the two need to agree explicitly here.
    id: "nidoranf",
    spriteKey: "nidoranf",
    placeholderColor: "#c890a8",
    homeLayer: "surface",
    // Real Nidoran♀ level-1 moves.
    moves: ["scratch", "poison_sting"],
    // "Found in fields and forests in large numbers" per mainline flavor
    // text — Savanna as a genuinely apt open-ground third habitat.
    biomes: ["grassland", "savanna"],
  }),
  nidorina: speciesFromDex("NIDORINA", {
    spriteKey: "nidorina",
    placeholderColor: "#b8789c",
    homeLayer: "surface",
    moves: ["scratch", "poison_sting"],
    // Nidoran♀'s own real, in-sim-reachable evolution (level 16, no item/
    // condition). Real further evolution (Nidoqueen) needs a Moon Stone —
    // same "never evolves further in-sim" limitation as Poliwhirl above.
    biomes: ["grassland", "savanna"],
  }),
  nidoranm: speciesFromDex("NIDORAN_M", {
    // See nidoranf's own comment above — same id-override reasoning.
    id: "nidoranm",
    spriteKey: "nidoranm",
    placeholderColor: "#5878a8",
    homeLayer: "surface",
    // Real Nidoran♂ level-1 moves.
    moves: ["poison_sting", "peck"],
    biomes: ["grassland", "savanna"],
  }),
  nidorino: speciesFromDex("NIDORINO", {
    spriteKey: "nidorino",
    placeholderColor: "#486890",
    homeLayer: "surface",
    moves: ["poison_sting", "peck"],
    // Nidoran♂'s own real, in-sim-reachable evolution (level 16, no item/
    // condition). Real further evolution (Nidoking) needs a Moon Stone —
    // same "never evolves further in-sim" limitation as Nidorina above.
    biomes: ["grassland", "savanna"],
  }),
  clefairy: speciesFromDex("CLEFAIRY", {
    spriteKey: "clefairy",
    placeholderColor: "#f8b8d0",
    homeLayer: "surface",
    // Real Clefairy level-1 moves (Pound/Growl/Spotlight) aren't in this
    // roster's curated move set — Safeguard stands in, matching its real
    // signature protective move.
    moves: ["tackle", "safeguard"],
    // "Said to have descended from the moon... found on mountains" per
    // mainline flavor text — a real Highland fit. Real evolution
    // (Clefable) needs a Moon Stone — never evolves in-sim, same
    // limitation as Growlithe/Vulpix above.
    biomes: ["highland"],
  }),
  jigglypuff: speciesFromDex("JIGGLYPUFF", {
    spriteKey: "jigglypuff",
    placeholderColor: "#f8c8d8",
    homeLayer: "surface",
    // Real Jigglypuff level-1 moves (Sing/Disarming Voice) aren't curated —
    // Safeguard stands in, same reasoning as Clefairy above.
    moves: ["tackle", "safeguard"],
    // "Found in grassy areas" per mainline flavor text. Real evolution
    // (Wigglytuff) needs a Moon Stone — never evolves in-sim.
    biomes: ["grassland", "forest"],
  }),
  venonat: speciesFromDex("VENONAT", {
    spriteKey: "venonat",
    placeholderColor: "#a878c8",
    homeLayer: "surface",
    moves: ["tackle"],
    activityPattern: "nocturnal",
    // "Attracted to light... lives in the shadows of trees" per mainline
    // flavor text.
    biomes: ["forest", "jungle"],
  }),
  venomoth: speciesFromDex("VENOMOTH", {
    spriteKey: "venomoth",
    placeholderColor: "#8858a8",
    homeLayer: "surface",
    moves: ["tackle"],
    activityPattern: "nocturnal",
    // Venonat's own real, in-sim-reachable evolution (level 31, no item/
    // condition).
    biomes: ["forest", "jungle"],
  }),
  paras: speciesFromDex("PARAS", {
    spriteKey: "paras",
    placeholderColor: "#d04848",
    homeLayer: "surface",
    moves: ["scratch"],
    // "Mushrooms grow on its back... prefers damp, dark places" per
    // mainline flavor text.
    biomes: ["forest", "jungle"],
  }),
  parasect: speciesFromDex("PARASECT", {
    spriteKey: "parasect",
    placeholderColor: "#b83838",
    homeLayer: "surface",
    moves: ["scratch"],
    // Paras's own real, in-sim-reachable evolution (level 24, no item/
    // condition).
    biomes: ["forest", "jungle"],
  }),
  bellsprout: speciesFromDex("BELLSPROUT", {
    spriteKey: "bellsprout",
    placeholderColor: "#a8c848",
    homeLayer: "surface",
    // Vine Whip is Bellsprout's real level-1 move.
    moves: ["vine_whip"],
    // A real "prefers hot, humid places" carnivorous-plant flavor.
    biomes: ["jungle", "grassland"],
  }),
  weepinbell: speciesFromDex("WEEPINBELL", {
    spriteKey: "weepinbell",
    placeholderColor: "#88b838",
    homeLayer: "surface",
    moves: ["vine_whip", "sludge"],
    isPredator: true,
    // Bellsprout's own real, in-sim-reachable evolution (level 21, no
    // item/condition). Real further evolution (Victreebel) needs a Leaf
    // Stone — never evolves further in-sim.
    biomes: ["jungle", "grassland"],
  }),
  exeggcute: speciesFromDex("EXEGGCUTE", {
    spriteKey: "exeggcute",
    placeholderColor: "#f0d078",
    homeLayer: "surface",
    // Real Exeggcute level-1 moves (Absorb/Hypnosis/Barrage) aren't
    // curated — Psybeam/Leech Seed stand in, matching its real
    // Grass/Psychic typing.
    moves: ["psybeam", "leech_seed"],
    // A real jungle-canopy egg cluster per mainline flavor text. Real
    // evolution (Exeggutor) needs a Leaf Stone — never evolves in-sim.
    biomes: ["jungle", "forest"],
  }),
  tangela: speciesFromDex("TANGELA", {
    spriteKey: "tangela",
    placeholderColor: "#4890a8",
    homeLayer: "surface",
    // Real Tangela level-1 moves (Bind/Absorb/Constrict) aren't curated —
    // Vine Whip/Leech Seed stand in, matching its real Grass typing.
    moves: ["vine_whip", "leech_seed"],
    // Real further evolution (Tangrowth) needs a specific known move —
    // never evolves in-sim.
    biomes: ["jungle", "forest"],
  }),
  machop: speciesFromDex("MACHOP", {
    spriteKey: "machop",
    placeholderColor: "#c0a8a0",
    homeLayer: "surface",
    // Real Machop level-1 moves (Leer/Low Kick) aren't curated — Tackle/
    // Body Slam stand in, matching its real raw-strength flavor.
    moves: ["tackle", "body_slam"],
    // "Trains in the mountains" per mainline flavor text — Highland as
    // primary, Badlands/Tundra the roster's other cold-and-rocky
    // secondaries (added later — Tundra was still this roster's thinnest
    // biome, 3 fitting species, after the whole-roster pass; a mountain
    // fighter trains just as well on a frost-cracked plateau).
    biomes: ["highland", "badlands", "tundra"],
  }),
  machoke: speciesFromDex("MACHOKE", {
    spriteKey: "machoke",
    placeholderColor: "#a88880",
    homeLayer: "surface",
    moves: ["tackle", "body_slam"],
    // Machop's own real, in-sim-reachable evolution (level 28, no item/
    // condition). Real further evolution (Machamp) needs a trade — never
    // evolves further in-sim.
    biomes: ["highland", "badlands", "tundra"],
  }),
  drowzee: speciesFromDex("DROWZEE", {
    spriteKey: "drowzee",
    placeholderColor: "#f0c860",
    homeLayer: "surface",
    // Real Drowzee level-1 moves (Pound/Hypnosis/Meditate) aren't curated —
    // Psybeam stands in, matching its real Psychic typing.
    moves: ["tackle", "psybeam"],
    activityPattern: "nocturnal",
    // "Puts people to sleep and eats their dreams" per mainline flavor
    // text — a real nocturnal predator of a kind, though its "prey" is
    // dreams, not other Pokémon, so left untagged `isPredator` (that flag
    // means real inter-species predation, per predation.ts).
    biomes: ["highland", "grassland"],
  }),
  hypno: speciesFromDex("HYPNO", {
    spriteKey: "hypno",
    placeholderColor: "#d8a848",
    homeLayer: "surface",
    moves: ["tackle", "psybeam"],
    activityPattern: "nocturnal",
    // Drowzee's own real, in-sim-reachable evolution (level 26, no item/
    // condition).
    biomes: ["highland", "grassland"],
  }),
  abra: speciesFromDex("ABRA", {
    spriteKey: "abra",
    placeholderColor: "#f0b878",
    homeLayer: "surface",
    // Real Abra level-1 moves (Teleport/Psywave) aren't curated — Psybeam
    // stands in, matching its real Psychic typing.
    moves: ["psybeam"],
    activityPattern: "nocturnal",
    // "Sleeps 18 hours a day" per mainline flavor text.
    biomes: ["grassland", "highland"],
  }),
  kadabra: speciesFromDex("KADABRA", {
    spriteKey: "kadabra",
    placeholderColor: "#d89860",
    homeLayer: "surface",
    moves: ["psybeam"],
    activityPattern: "nocturnal",
    // Abra's own real, in-sim-reachable evolution (level 16, no item/
    // condition). Real further evolution (Alakazam) needs a trade — never
    // evolves further in-sim.
    biomes: ["grassland", "highland"],
  }),
  gastly: speciesFromDex("GASTLY", {
    spriteKey: "gastly",
    placeholderColor: "#705898",
    // "Almost invisible... anyone would faint if enveloped by it" per
    // mainline flavor text — a real ambush predator. No biome of its own
    // (underground, same as Zubat) — tagged by the surface above the same
    // "dark places" reasoning Zubat's own entry already documents.
    homeLayer: "underground",
    // Real Gastly level-1 moves (Confuse Ray/Lick/Smog) aren't curated —
    // Sludge/Psybeam stand in, matching its real Ghost/Poison typing.
    moves: ["sludge", "psybeam"],
    isPredator: true,
    activityPattern: "nocturnal",
    biomes: ["highland", "badlands"],
  }),
  haunter: speciesFromDex("HAUNTER", {
    spriteKey: "haunter",
    placeholderColor: "#503878",
    homeLayer: "underground",
    moves: ["sludge", "psybeam"],
    isPredator: true,
    activityPattern: "nocturnal",
    // Gastly's own real, in-sim-reachable evolution (level 25, no item/
    // condition). Real further evolution (Gengar) needs a trade — never
    // evolves further in-sim.
    biomes: ["highland", "badlands"],
  }),
  dugtrio: speciesFromDex("DUGTRIO", {
    spriteKey: "dugtrio",
    placeholderColor: "#b8905c",
    homeLayer: "underground",
    // Dig/Earthquake are real Dugtrio signature moves.
    moves: ["tackle", "dig", "earthquake"],
    activityPattern: "nocturnal",
    buildsShelter: true,
    // Diglett's own real, in-sim-reachable evolution (level 26, no item/
    // condition) — Diglett itself stays tagged unchanged.
    biomes: ["grassland", "badlands", "desert"],
  }),
  sandslash: speciesFromDex("SANDSLASH", {
    spriteKey: "sandslash",
    placeholderColor: "#c8a850",
    homeLayer: "underground",
    // Real Sandslash level-1 moves (Scratch/Defense Curl) match this
    // roster's curated set directly.
    moves: ["scratch", "dig", "defense_curl", "earthquake"],
    activityPattern: "nocturnal",
    buildsShelter: true,
    // Sandshrew's own real, in-sim-reachable evolution (no listed level
    // gate beyond the base game's default — checked reachable via
    // `LEVELING_CONTEXT`, same bar every entry in this file uses).
    biomes: ["badlands", "grassland", "desert"],
  }),
  primeape: speciesFromDex("PRIMEAPE", {
    spriteKey: "primeape",
    placeholderColor: "#a86848",
    homeLayer: "surface",
    moves: ["scratch"],
    // Mankey's own real, in-sim-reachable evolution (level 28, no item/
    // condition) — Mankey itself stays tagged unchanged. Real further
    // evolution (Annihilape) needs a specific known move — never evolves
    // further in-sim.
    biomes: ["highland", "badlands", "tundra"],
    preferredTerrain: ["boulder"],
  }),
  magmar: speciesFromDex("MAGMAR", {
    spriteKey: "magmar",
    placeholderColor: "#e87838",
    homeLayer: "surface",
    // Ember is a real early Magmar move.
    moves: ["ember"],
    // "Lives in the fiery depths of volcanoes" per mainline flavor text —
    // Badlands as this roster's closest real volcanic-adjacent biome. Real
    // evolution (Magmortar) needs a held item during a trade — never
    // evolves in-sim.
    biomes: ["badlands"],
    preferredTerrain: ["sunbeam"],
  }),
  kabuto: speciesFromDex("KABUTO", {
    spriteKey: "kabuto",
    placeholderColor: "#a89858",
    homeLayer: "surface",
    // Real Kabuto level-1 moves (Scratch/Absorb/Harden) match this
    // roster's curated set directly.
    moves: ["scratch", "harden"],
    // A real ancient sea-floor fossil per mainline flavor text — Wetland/
    // Beach, the roster's real water-adjacent biomes.
    biomes: ["wetland", "beach"],
    preferredTerrain: ["water"],
    // Direct follow-up, after Kabutops' own level-40-evolution-floor
    // report ("the level 40 gap can happen, it should just be rare...
    // change the level adding distribution instead. A predator kabuto is
    // OK too"): Kabuto itself is real predatory shellfish per mainline
    // flavor ("swam through primordial seas, preying on smaller life") —
    // tagging it a predator too means a Beach/Wetland zone's "predator"
    // niche usually resolves to Kabuto (no evolution floor to clear, so
    // its real spawn level is a normal ~5-17 like any other base-form
    // predator) instead of ALWAYS needing to be its own much harsher
    // evolved Kabutops (real floor 40, ~46-51 with `PREDATOR_LEVEL_BOOST`
    // — see Kabutops' own comment/`rarity` below). Kabutops staying rare
    // (`rarity: 0.3`) on top of this is what actually makes the level-40
    // gap the OCCASIONAL escalation rather than the only option — this is
    // the "usually lower, rarely 40" distribution the report asked for,
    // built from which SPECIES gets picked, not a tweak to the level roll
    // itself (Kabutops literally cannot exist below level 40 — that's its
    // real evolution requirement, not a rollable number).
    isPredator: true,
  }),
  kabutops: speciesFromDex("KABUTOPS", {
    spriteKey: "kabutops",
    placeholderColor: "#887848",
    homeLayer: "surface",
    moves: ["scratch", "harden"],
    // "Swam the seas... slicing prey with its claws" per mainline flavor
    // text — a real predator.
    isPredator: true,
    // Kabuto's own real, in-sim-reachable evolution (level 40, no item/
    // condition) — this roster's highest predator evolution floor, and
    // with `immigration.ts`'s own `PREDATOR_LEVEL_BOOST` on top, a real
    // invented Kabutops lands around level 46-51. Direct report: "kabutops
    // are just utterly slaughtering everything... the level 40 gap can
    // happen, it should just be rare." `rarity` here now ALSO gates
    // whether Kabutops is even a candidate for a given zone's species pool
    // at all (`macroGrid.ts`'s `pickZoneSpeciesPool`), not just how large
    // its population is once present — Beach's fitting predator list was
    // just this one species, so every earlier mechanism guaranteed its
    // inclusion whenever a predator slot got filled. 0.3 is a sim-original
    // guess (roughly "shows up in about 1 of 3 eligible zones"), same
    // "judge against a real run" standard as Arbok's own 0.12 — not
    // Arbok-tier rare (Kabutops is a real, intended apex predator when it
    // does show up, not an unwanted nuisance species), just no longer
    // guaranteed.
    rarity: 0.3,
    biomes: ["wetland", "beach"],
    preferredTerrain: ["water"],
  }),
  omanyte: speciesFromDex("OMANYTE", {
    spriteKey: "omanyte",
    placeholderColor: "#7898c8",
    homeLayer: "surface",
    // Withdraw is a real early Omanyte move.
    moves: ["withdraw"],
    biomes: ["wetland", "beach"],
    preferredTerrain: ["water"],
  }),
  omastar: speciesFromDex("OMASTAR", {
    spriteKey: "omastar",
    placeholderColor: "#607098",
    homeLayer: "surface",
    moves: ["withdraw"],
    // Omanyte's own real, in-sim-reachable evolution (level 40, no item/
    // condition).
    biomes: ["wetland", "beach"],
    preferredTerrain: ["water"],
  }),
  aerodactyl: speciesFromDex("AERODACTYL", {
    spriteKey: "aerodactyl",
    placeholderColor: "#8868c0",
    homeLayer: "surface",
    // Real Aerodactyl level-1 moves (Bite/Ancient Power) aren't curated —
    // Rock Slide/Wing Attack stand in, matching its real Rock/Flying
    // typing.
    moves: ["rock_slide", "wing_attack"],
    // "A ferocious, prehistoric... Pokémon" per mainline flavor text, real
    // ancient cliff-dwelling predator.
    isPredator: true,
    biomes: ["highland", "badlands", "tundra"],
    preferredTerrain: ["boulder"],
  }),
  chansey: speciesFromDex("CHANSEY", {
    spriteKey: "chansey",
    placeholderColor: "#f8c0c8",
    homeLayer: "surface",
    // Real Chansey level-1 moves (Pound/Tail Whip/Growl) aren't curated —
    // Safeguard stands in, matching its real caretaking flavor.
    moves: ["tackle", "safeguard"],
    // Real evolution (Blissey) needs a friendship threshold — never
    // evolves in-sim.
    biomes: ["grassland"],
  }),
  lickitung: speciesFromDex("LICKITUNG", {
    spriteKey: "lickitung",
    placeholderColor: "#f090a0",
    homeLayer: "surface",
    // Tackle is a real early Lickitung move.
    moves: ["tackle", "body_slam"],
    // Real further evolution (Lickilicky) needs a specific known move —
    // never evolves in-sim.
    biomes: ["jungle", "forest"],
  }),
  pinsir: speciesFromDex("PINSIR", {
    spriteKey: "pinsir",
    placeholderColor: "#c8a848",
    homeLayer: "surface",
    // Harden is a real early Pinsir move.
    moves: ["harden", "slash"],
    activityPattern: "diurnal",
    biomes: ["jungle", "forest"],
  }),
  pikachu: speciesFromDex("PIKACHU", {
    spriteKey: "pikachu",
    placeholderColor: "#f8d030",
    homeLayer: "surface",
    // Real Pikachu level-1 moves (Tail Whip/Thunder Shock/Quick Attack)
    // aren't curated — Agility stands in, matching its real signature
    // speed.
    moves: ["tackle", "agility"],
    activityPattern: "diurnal",
    // Real evolution (Raichu) needs a Thunder Stone — never evolves
    // in-sim.
    biomes: ["grassland", "forest"],
  }),
  eevee: speciesFromDex("EEVEE", {
    spriteKey: "eevee",
    placeholderColor: "#c8a878",
    homeLayer: "surface",
    moves: ["tackle"],
    // Every real Eevee evolution needs a stone, a specific known move, or a
    // friendship/location threshold — never evolves in-sim, an accepted
    // limitation same as several other entries in this file.
    biomes: ["grassland", "forest"],
  }),
};
