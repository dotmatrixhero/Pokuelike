export interface SpeciesDef {
  id: string;
  name: string;
  /** Sprite sheet key the renderer looks up; actual art assets aren't checked in yet. */
  spriteKey: string;
  /** Placeholder color used until real sprites are wired up. */
  placeholderColor: string;
  moves: string[];
}

export const SPECIES: Record<string, SpeciesDef> = {
  bulbasaur: {
    id: "bulbasaur",
    name: "Bulbasaur",
    spriteKey: "bulbasaur",
    placeholderColor: "#78c850",
    moves: ["tackle"],
  },
  scyther: {
    id: "scyther",
    name: "Scyther",
    spriteKey: "scyther",
    placeholderColor: "#4fbf8c",
    moves: ["slash"],
  },
  charmander: {
    id: "charmander",
    name: "Charmander",
    spriteKey: "charmander",
    placeholderColor: "#f08030",
    moves: ["ember"],
  },
};
