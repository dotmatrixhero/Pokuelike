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
  };
}

export const SPECIES: Record<string, SpeciesDef> = {
  bulbasaur: speciesFromDex("BULBASAUR", {
    spriteKey: "bulbasaur",
    placeholderColor: "#78c850",
    homeLayer: "surface",
    moves: ["tackle", "vine_whip"],
    // The bulb on its back needs sunlight to grow (mainline flavor text) —
    // basks and grazes by day, same reasoning as its evolutions below.
    activityPattern: "diurnal",
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
  }),
  charmander: speciesFromDex("CHARMANDER", {
    spriteKey: "charmander",
    placeholderColor: "#f08030",
    homeLayer: "surface",
    moves: ["ember"],
    // A sun-loving fire lizard whose flame is said to weaken without warmth
    // — diurnal, active while the sun's out.
    activityPattern: "diurnal",
  }),
  diglett: speciesFromDex("DIGLETT", {
    spriteKey: "diglett",
    placeholderColor: "#966037",
    homeLayer: "underground",
    moves: ["tackle"],
    // The archetypal burrowing mole — avoids the surface (and its daylight)
    // entirely, most active well after dark. The task brief's own example.
    activityPattern: "nocturnal",
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
  }),
  pidgey: speciesFromDex("PIDGEY", {
    spriteKey: "pidgey",
    placeholderColor: "#a89060",
    homeLayer: "canopy",
    moves: ["tackle"],
    // An ordinary daytime bird — diurnal, the task brief's own example.
    activityPattern: "diurnal",
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
  }),
};
