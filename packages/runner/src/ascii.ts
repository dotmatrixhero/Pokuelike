import type { PokemonType, TerrainKind, World } from "@pokuelike/engine";
import { waterBodySizeAt } from "@pokuelike/engine";

export type Rgb = [number, number, number];

/** Brogue-ish: saturated glyphs, near-black grounds. */
const TYPE_COLOR: Record<PokemonType, Rgb> = {
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

const TERRAIN_GLYPH: Record<TerrainKind, string> = {
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

const TERRAIN_BG: Record<TerrainKind, Rgb> = {
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

const TERRAIN_FG: Record<TerrainKind, Rgb> = {
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

/**
 * Per-flavor overrides for "food"/"flora" tiles (see flora.ts's
 * FOOD_FLAVORS/FLORA_FLAVORS) — cute, distinct glyph+color per specific
 * plant instead of every berry bush looking identical.
 */
const FLAVOR_GLYPH: Record<string, string> = {
  oran: "%",
  sitrus: "&",
  pecha: "*",
  cheri: "+",
  moss: "`",
  fern: "'",
  bloom: ";",
};

const FLAVOR_FG: Record<string, Rgb> = {
  oran: [90, 140, 255],
  sitrus: [250, 176, 60],
  pecha: [255, 140, 190],
  cheri: [230, 70, 70],
  moss: [120, 165, 100],
  fern: [80, 130, 80],
  bloom: [205, 125, 195],
};

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((c, i) => Math.round(c + (to[i]! - c) * amount)) as Rgb;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/**
 * Below this elevation, `shade` darkens toward black instead of lightening —
 * direct ask: "tiles with lower elevation are darker... subtle stuff." Most
 * of a generated map's non-Highland terrain sits well under this (see
 * worldgen.ts's `BIOMES` — Wetland/Grassland/Badlands' `elevationBase` +
 * `elevationVariance` mostly land in [0, ~1]), so this is real, visible
 * low-ground shading, not a corner case that rarely fires.
 */
const LOW_ELEVATION_DARKEN_THRESHOLD = 0.3;
/** How dark the very lowest ground (elevation 0) gets — deliberately smaller than the existing high-elevation lighten cap (0.35) below, since "subtle" was the explicit ask. */
const LOW_ELEVATION_DARKEN_MAX = 0.12;

/**
 * Elevation-based ground shading — same formula as `@pokuelike/web`'s
 * `palette.ts`'s `shade` (kept in sync by hand, per that file's own doc
 * comment on why these two aren't a shared import). Two symmetric halves
 * around `LOW_ELEVATION_DARKEN_THRESHOLD`: below it, darkens toward black
 * as elevation drops toward 0 (new); at/above it, lightens toward white as
 * elevation rises (original behavior, byte-for-byte unchanged).
 *
 * Deliberately NOT used for "water" depth — every water tile's elevation is
 * permanently forced to 0 (worldgen.ts: "a lakebed is flat, not textured by
 * the elevation field"), so this would just apply one flat darken to
 * literally all water uniformly. See `waterDepthShade` below for the real
 * depth-ish signal this codebase actually has for water: body size.
 */
function shade(rgb: Rgb, elevation: number): Rgb {
  if (elevation < LOW_ELEVATION_DARKEN_THRESHOLD) {
    const amount = LOW_ELEVATION_DARKEN_MAX * (1 - elevation / LOW_ELEVATION_DARKEN_THRESHOLD);
    return mix(rgb, BLACK, amount);
  }
  const amount = Math.min(0.35, elevation * 0.07);
  return mix(rgb, WHITE, amount);
}

/** Same idea as `palette.ts`'s `WATER_DEPTH_SIZE_CAP`/`WATER_DEPTH_DARKEN_MAX` — a body this size or larger reads as "fully deep." */
const WATER_DEPTH_SIZE_CAP = 60;
const WATER_DEPTH_DARKEN_MAX = 0.22;

/** "Deep water is darker" — see `palette.ts`'s `waterDepthFactor`/`waterDepthShade` doc comments for why body size (not elevation) is the signal used. */
function waterDepthShade(rgb: Rgb, world: World, x: number, y: number): Rgb {
  const depthFactor = Math.min(1, waterBodySizeAt(world, { x, y }) / WATER_DEPTH_SIZE_CAP);
  return mix(rgb, BLACK, WATER_DEPTH_DARKEN_MAX * depthFactor);
}

export interface FrameCell {
  char: string;
  fg: Rgb;
  bg: Rgb;
}

export interface Frame {
  tick: number;
  width: number;
  height: number;
  cells: FrameCell[][];
}

/** Canonical terrain-kind order, shared with anything that needs to encode terrain compactly (e.g. dump-replay.ts). */
export const TERRAIN_ORDER = Object.keys(TERRAIN_GLYPH) as TerrainKind[];

/** The terrain-only grid (no agents overlaid) for the surface layer. */
export function captureTerrainGrid(world: World): FrameCell[][] {
  const surface = world.tiles.surface;
  const cells: FrameCell[][] = [];

  for (let y = 0; y < world.height; y++) {
    const row: FrameCell[] = [];
    for (let x = 0; x < world.width; x++) {
      const tile = surface[y * world.width + x]!;
      const flavorGlyph = tile.flavor ? FLAVOR_GLYPH[tile.flavor] : undefined;
      const flavorFg = tile.flavor ? FLAVOR_FG[tile.flavor] : undefined;
      row.push({
        char: flavorGlyph ?? TERRAIN_GLYPH[tile.terrain],
        fg: flavorFg ?? TERRAIN_FG[tile.terrain],
        bg: tile.terrain === "water" ? waterDepthShade(TERRAIN_BG.water, world, x, y) : shade(TERRAIN_BG[tile.terrain], tile.elevation),
      });
    }
    cells.push(row);
  }

  return cells;
}

/** A Brogue-style snapshot of the surface layer: tile glyph+background, or an agent's species-initial glyph colored by its primary type. */
export function captureFrame(world: World): Frame {
  const cells = captureTerrainGrid(world);

  for (const agent of world.agents) {
    if (agent.layer !== "surface" || agent.alive === false) continue;
    const cell = cells[agent.pos.y]?.[agent.pos.x];
    if (!cell) continue;
    const primaryType = agent.types?.[0];
    cell.char = agent.species.charAt(0).toUpperCase();
    cell.fg = primaryType ? TYPE_COLOR[primaryType] : [230, 230, 230];
  }

  return { tick: world.tick, width: world.width, height: world.height, cells };
}

/** Renders a Frame as a 24-bit-color ANSI string for terminal display. */
export function frameToAnsi(frame: Frame): string {
  const RESET = "\x1b[0m";
  return frame.cells
    .map((row) =>
      row
        .map((cell) => {
          const fg = `\x1b[38;2;${cell.fg[0]};${cell.fg[1]};${cell.fg[2]}m`;
          const bg = `\x1b[48;2;${cell.bg[0]};${cell.bg[1]};${cell.bg[2]}m`;
          return `${bg}${fg}${cell.char}${RESET}`;
        })
        .join("")
    )
    .join("\n");
}
