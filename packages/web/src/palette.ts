import type { PokemonType, TerrainKind } from "@pokuelike/engine";

/**
 * Direct port of `packages/runner/src/ascii.ts`'s color tables — that file is
 * the palette reference (color-by-type for agents, terrain-by-elevation for
 * tiles), just re-expressed as plain RGB triples for canvas `fillStyle`
 * instead of ANSI escape codes. Keep these two files in sync if the ASCII
 * palette changes; there isn't a shared package for it since the ANSI vs.
 * canvas rendering paths are different enough that literally importing
 * across `runner` -> `web` isn't worth the coupling.
 */
export type Rgb = [number, number, number];

export const TYPE_COLOR: Record<PokemonType, Rgb> = {
  normal: [201, 201, 184],
  fire: [255, 107, 74],
  water: [74, 163, 255],
  electric: [245, 215, 66],
  grass: [107, 207, 90],
  ice: [159, 232, 232],
  fighting: [192, 57, 43],
  poison: [163, 95, 201],
  ground: [201, 162, 74],
  flying: [176, 196, 239],
  psychic: [255, 111, 174],
  bug: [168, 201, 60],
  rock: [184, 160, 106],
  ghost: [122, 110, 168],
  dragon: [106, 95, 209],
  dark: [107, 107, 107],
  steel: [176, 184, 192],
  fairy: [245, 168, 208],
};

export const TERRAIN_BG: Record<TerrainKind, Rgb> = {
  floor: [22, 24, 29],
  wall: [44, 47, 54],
  water: [12, 45, 74],
  food: [58, 42, 18],
  flora: [26, 40, 24],
  sunbeam: [74, 63, 12],
  seedling: [28, 58, 22],
  tree: [16, 38, 22],
  boulder: [58, 56, 51],
  bush: [22, 46, 26],
  sand: [92, 80, 50],
  mud: [42, 34, 22],
};

export const TERRAIN_FG: Record<TerrainKind, Rgb> = {
  floor: [50, 53, 60],
  wall: [90, 94, 102],
  water: [90, 150, 200],
  food: [150, 110, 60],
  flora: [110, 150, 90],
  sunbeam: [220, 190, 80],
  seedling: [110, 180, 100],
  tree: [70, 140, 80],
  boulder: [180, 176, 166],
  bush: [110, 190, 110],
  sand: [214, 194, 140],
  mud: [110, 90, 60],
};

/** Per-flavor overrides for "food"/"flora" tiles — see flora.ts's FOOD_FLAVORS/FLORA_FLAVORS. */
export const FLAVOR_FG: Record<string, Rgb> = {
  oran: [90, 140, 255],
  sitrus: [250, 176, 60],
  pecha: [255, 140, 190],
  cheri: [230, 70, 70],
  moss: [120, 165, 100],
  fern: [80, 130, 80],
  bloom: [205, 125, 195],
};

/** Direct port of ascii.ts's TERRAIN_GLYPH/FLAVOR_GLYPH — the "ASCII classic" render mode's glyph set, Brogue-style. */
export const TERRAIN_GLYPH: Record<TerrainKind, string> = {
  floor: ".",
  wall: "#",
  water: "~",
  food: '"',
  flora: "`",
  sunbeam: "o",
  seedling: ",",
  tree: "T",
  boulder: "O",
  bush: "^",
  sand: ":",
  mud: "=",
};

export const FLAVOR_GLYPH: Record<string, string> = {
  oran: "%",
  sitrus: "&",
  pecha: "*",
  cheri: "+",
  moss: "`",
  fern: "'",
  bloom: ";",
};

/** Same elevation-shading formula as ascii.ts's `shade`: lightens toward white as elevation rises. */
export function shade(rgb: Rgb, elevation: number): Rgb {
  const amount = Math.min(0.35, elevation * 0.07);
  return rgb.map((c) => Math.round(c + (255 - c) * amount)) as Rgb;
}

export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((c, i) => Math.round(c + (to[i]! - c) * amount)) as Rgb;
}

export function rgbToCss([r, g, b]: Rgb): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export function rgbaToCss([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Weather-type tint used for the translucent weather-cell overlay — sim-original, not from ascii.ts (which has no weather rendering at all). */
export const WEATHER_TINT: Record<string, Rgb> = {
  rain: [70, 120, 200],
  storm: [60, 60, 120],
  drought: [200, 140, 40],
  coldSnap: [140, 210, 230],
};
