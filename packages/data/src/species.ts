import type { Layer } from "@pokuelike/engine";

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
  moves: string[];
}

export const SPECIES: Record<string, SpeciesDef> = {
  bulbasaur: {
    id: "bulbasaur",
    name: "Bulbasaur",
    spriteKey: "bulbasaur",
    placeholderColor: "#78c850",
    homeLayer: "surface",
    moves: ["tackle"],
  },
  scyther: {
    id: "scyther",
    name: "Scyther",
    spriteKey: "scyther",
    placeholderColor: "#4fbf8c",
    homeLayer: "surface",
    preysOn: ["bulbasaur"],
    moves: ["slash"],
  },
  charmander: {
    id: "charmander",
    name: "Charmander",
    spriteKey: "charmander",
    placeholderColor: "#f08030",
    homeLayer: "surface",
    moves: ["ember"],
  },
  diglett: {
    id: "diglett",
    name: "Diglett",
    spriteKey: "diglett",
    placeholderColor: "#966037",
    homeLayer: "underground",
    moves: ["tackle"],
  },
  pidgey: {
    id: "pidgey",
    name: "Pidgey",
    spriteKey: "pidgey",
    placeholderColor: "#a89060",
    homeLayer: "canopy",
    moves: ["tackle"],
  },
};
