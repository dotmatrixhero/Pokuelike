import type { ActivityPattern, BaseStats, Layer, PokemonType } from "@pokuelike/engine";
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
   * "wetland" | "badlands" | "highland") this species is naturally found
   * in - best-effort flavor-driven tagging (same judged-per-species
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
  bulbasaur: speciesFromDex("BULBASAUR", {
    spriteKey: "bulbasaur",
    placeholderColor: "#78c850",
    homeLayer: "surface",
    moves: ["tackle", "vine_whip"],
    // The bulb on its back needs sunlight to grow (mainline flavor text) —
    // basks and grazes by day, same reasoning as its evolutions below.
    activityPattern: "diurnal",
    // A grass-type grazer — grassland is the obvious flavor fit, forest as
    // a secondary (plenty of shade/undergrowth grass-types are also drawn
    // to in mainline flavor text).
    biomes: ["grassland", "forest"],
  }),
  scyther: speciesFromDex("SCYTHER", {
    spriteKey: "scyther",
    placeholderColor: "#4fbf8c",
    homeLayer: "surface",
    isPredator: true,
    moves: ["slash"],
    // A stealthy ambush predator ("moves silently... vanishes like a
    // ninja" per mainline flavor text) — crepuscular, striking at the
    // low-light edges of the day rather than in full daylight or full dark.
    activityPattern: "crepuscular",
    // A stealthy forest ambusher (mainline flavor text has it living in
    // dense woodland) — forest as primary, grassland as a secondary edge
    // habitat.
    biomes: ["forest", "grassland"],
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
  }),
  diglett: speciesFromDex("DIGLETT", {
    spriteKey: "diglett",
    placeholderColor: "#966037",
    homeLayer: "underground",
    moves: ["tackle"],
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
    // dense forest or waterlogged wetland.
    biomes: ["grassland", "badlands"],
  }),
  venusaur: speciesFromDex("VENUSAUR", {
    spriteKey: "venusaur",
    placeholderColor: "#4a8f3c",
    homeLayer: "surface",
    moves: ["tackle", "vine_whip"],
    // Deliberately left cathemeral (the default), not diurnal like its
    // pre-evolution: this is the herd's guardian (nothing preys on it — see
    // predation.ts), and a guardian that only watches half the clock isn't
    // much of one. No override needed; omission here IS the design choice.
    biomes: ["grassland", "forest"],
  }),
  pidgey: speciesFromDex("PIDGEY", {
    spriteKey: "pidgey",
    placeholderColor: "#a89060",
    homeLayer: "canopy",
    moves: ["tackle"],
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
    moves: ["peck"],
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
    moves: ["scratch"],
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
    // desert-exclusive).
    biomes: ["badlands", "grassland"],
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
    moves: ["tackle", "rock_throw"],
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
    moves: ["tackle", "water_gun"],
    // The obvious fit — a Water-type drawn to `worldgen.ts`'s highest
    // water-density biome.
    biomes: ["wetland"],
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
    moves: ["rock_throw", "tackle"],
    // A living boulder that mainline flavor text has rolling down
    // mountainsides — badlands/highland, both rock-and-boulder-heavy biomes
    // (see worldgen.ts's BIOMES boulder terrainWeights).
    biomes: ["badlands", "highland"],
  }),
  growlithe: speciesFromDex("GROWLITHE", {
    spriteKey: "growlithe",
    placeholderColor: "#e07850",
    homeLayer: "surface",
    moves: ["ember"],
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
    biomes: ["badlands"],
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
  }),
};
