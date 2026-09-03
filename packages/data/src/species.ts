import type { BaseStats, Layer, PokemonType } from "@pokuelike/engine";

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

export const SPECIES: Record<string, SpeciesDef> = {
  bulbasaur: {
    id: "bulbasaur",
    name: "Bulbasaur",
    spriteKey: "bulbasaur",
    placeholderColor: "#78c850",
    homeLayer: "surface",
    baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 },
    types: ["grass", "poison"],
    moves: ["tackle", "vine_whip"],
  },
  scyther: {
    id: "scyther",
    name: "Scyther",
    spriteKey: "scyther",
    placeholderColor: "#4fbf8c",
    homeLayer: "surface",
    preysOn: ["bulbasaur"],
    baseStats: { hp: 70, attack: 110, defense: 80, spAttack: 55, spDefense: 80, speed: 105 },
    types: ["bug", "flying"],
    moves: ["slash"],
  },
  charmander: {
    id: "charmander",
    name: "Charmander",
    spriteKey: "charmander",
    placeholderColor: "#f08030",
    homeLayer: "surface",
    baseStats: { hp: 39, attack: 52, defense: 43, spAttack: 60, spDefense: 50, speed: 65 },
    types: ["fire"],
    moves: ["ember"],
  },
  diglett: {
    id: "diglett",
    name: "Diglett",
    spriteKey: "diglett",
    placeholderColor: "#966037",
    homeLayer: "underground",
    baseStats: { hp: 10, attack: 55, defense: 25, spAttack: 35, spDefense: 45, speed: 95 },
    types: ["ground"],
    moves: ["tackle"],
  },
  venusaur: {
    id: "venusaur",
    name: "Venusaur",
    spriteKey: "venusaur",
    placeholderColor: "#4a8f3c",
    homeLayer: "surface",
    baseStats: { hp: 80, attack: 82, defense: 83, spAttack: 100, spDefense: 100, speed: 80 },
    types: ["grass", "poison"],
    moves: ["tackle", "vine_whip"],
  },
  pidgey: {
    id: "pidgey",
    name: "Pidgey",
    spriteKey: "pidgey",
    placeholderColor: "#a89060",
    homeLayer: "canopy",
    baseStats: { hp: 40, attack: 45, defense: 40, spAttack: 35, spDefense: 35, speed: 56 },
    types: ["normal", "flying"],
    moves: ["tackle"],
  },
};
