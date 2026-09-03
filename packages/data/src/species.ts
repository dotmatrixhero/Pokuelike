import type { BaseStats, Layer, PokemonType } from "@pokuelike/engine";
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
  /** Species ids this one hunts, when hungry and one is nearby. Absent = doesn't hunt. */
  preysOn?: string[];
  /** Canon base stats (mainline games), fed through calculateStats(base, level) for real HP/Atk/etc. */
  baseStats: BaseStats;
  types: PokemonType[];
  moves: string[];
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
    preysOn: sim.preysOn,
    moves: sim.moves,
  };
}

export const SPECIES: Record<string, SpeciesDef> = {
  bulbasaur: speciesFromDex("BULBASAUR", {
    spriteKey: "bulbasaur",
    placeholderColor: "#78c850",
    homeLayer: "surface",
    moves: ["tackle", "vine_whip"],
  }),
  scyther: speciesFromDex("SCYTHER", {
    spriteKey: "scyther",
    placeholderColor: "#4fbf8c",
    homeLayer: "surface",
    preysOn: ["bulbasaur"],
    moves: ["slash"],
  }),
  charmander: speciesFromDex("CHARMANDER", {
    spriteKey: "charmander",
    placeholderColor: "#f08030",
    homeLayer: "surface",
    moves: ["ember"],
  }),
  diglett: speciesFromDex("DIGLETT", {
    spriteKey: "diglett",
    placeholderColor: "#966037",
    homeLayer: "underground",
    moves: ["tackle"],
  }),
  venusaur: speciesFromDex("VENUSAUR", {
    spriteKey: "venusaur",
    placeholderColor: "#4a8f3c",
    homeLayer: "surface",
    moves: ["tackle", "vine_whip"],
  }),
  pidgey: speciesFromDex("PIDGEY", {
    spriteKey: "pidgey",
    placeholderColor: "#a89060",
    homeLayer: "canopy",
    moves: ["tackle"],
  }),
  spearow: speciesFromDex("SPEAROW", {
    spriteKey: "spearow",
    placeholderColor: "#8c5028",
    homeLayer: "canopy",
    // Mirrors the Bulbasaur/Scyther/Venusaur pattern: Spearow only preys on
    // the base "pidgey" id, never "pidgeotto"/"pidgeot" (species changes on
    // evolution — see leveling.ts's applyLevelUp), so a Pidgey that evolves
    // automatically becomes a guardian, no separate guardian mechanic needed.
    preysOn: ["pidgey"],
    moves: ["peck"],
  }),
  sandshrew: speciesFromDex("SANDSHREW", {
    spriteKey: "sandshrew",
    placeholderColor: "#e0c068",
    homeLayer: "underground",
    // Not prey/predator itself — coexists with Diglett underground and
    // shares its Field egg group (see EGG_GROUPS_BY_BASE_KEY in
    // leveling.ts), a real cross-species breeding pair.
    moves: ["scratch"],
  }),
  onix: speciesFromDex("ONIX", {
    spriteKey: "onix",
    placeholderColor: "#a8a878",
    homeLayer: "underground",
    // Gives the underground layer its own predator/prey drama, mirroring
    // Scyther on the surface — previously Diglett had zero threats at all.
    preysOn: ["diglett", "sandshrew"],
    moves: ["tackle", "rock_throw"],
  }),
};
