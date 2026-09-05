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
  shelter: [64, 50, 34],
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
  shelter: [196, 158, 108],
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
  shelter: "h",
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
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Deterministic string hash (FNV-1a-ish, cheap) — purely for deriving a
 * stable per-species hue below, not tied to the sim's own seeded rng.
 */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Plain HSL -> RGB, hue in degrees, s/l in [0,1] — no library needed for this one conversion. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r, g, b] = [0, 0, 0];
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/**
 * Universal shelter, per-species cosmetic look (point 1 — "all units have
 * it, it just looks different for each type"; the mechanics are identical
 * across species, only this rendering hint varies). Derives a stable hue
 * from `Tile.shelterOwnerSpecies` (engine, set by shelter.ts's
 * `applyShelterBuilding`) and mixes a modest amount of it into the base
 * shelter color/glyph tint — a real, per-owner visual variation with zero
 * gameplay effect, `rgb` unchanged when no owner is recorded yet (an older
 * or not-yet-repainted shelter tile).
 */
export function shelterOwnerTint(rgb: Rgb, ownerSpecies: string | undefined): Rgb {
  if (!ownerSpecies) return rgb;
  const hue = hashString(ownerSpecies) % 360;
  const accent = hslToRgb(hue, 0.55, 0.55);
  return mix(rgb, accent, 0.4);
}

/**
 * A stable, per-INDIVIDUAL (not per-species) accent color — direct ask:
 * "when multiple units are in battle esp same species it's quite hard to
 * tell em apart... color code them." Hashing the same-species-but-different
 * `agentId` string (not `species`, which is `shelterOwnerTint`'s key) is
 * exactly what makes two same-species combatants land on two different
 * colors here despite sharing every other visual trait. A bright, readable
 * fixed saturation/lightness rather than `shelterOwnerTint`'s "mix a little
 * accent into a base color" — this is meant to stand alone as a name/HP-bar
 * accent, not tint an existing terrain color.
 */
export function agentAccentColor(agentId: string): string {
  const hue = hashString(agentId) % 360;
  const [r, g, b] = hslToRgb(hue, 0.65, 0.62);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * A cheap, purely-visual per-tile pseudo-random value in [0, 1) — classic
 * GLSL-style sine hash, deterministic by (x, y) alone (not tied to the
 * sim's own seeded rng; this never affects simulation, only how a tile's
 * wash/glyph brightness is rendered). Static per tile rather than animated,
 * so the ground reads as unevenly lit stone — Brogue's "not a uniform flat
 * color" look — without flickering every frame.
 */
export function tileLight(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Weather-type tint used for the translucent weather-cell overlay — sim-original, not from ascii.ts (which has no weather rendering at all). */
export const WEATHER_TINT: Record<string, Rgb> = {
  rain: [70, 120, 200],
  storm: [60, 60, 120],
  drought: [200, 140, 40],
  coldSnap: [140, 210, 230],
};
