import type { PokemonType, TerrainKind, World } from "@pokuelike/engine";

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
  sunbeam: "o",
  seedling: ",",
};

const TERRAIN_BG: Record<TerrainKind, Rgb> = {
  floor: [22, 24, 29],
  wall: [44, 47, 54],
  water: [12, 45, 74],
  food: [58, 42, 18],
  sunbeam: [74, 63, 12],
  seedling: [28, 58, 22],
};

const TERRAIN_FG: Record<TerrainKind, Rgb> = {
  floor: [50, 53, 60],
  wall: [90, 94, 102],
  water: [90, 150, 200],
  food: [150, 110, 60],
  sunbeam: [220, 190, 80],
  seedling: [110, 180, 100],
};

function shade(rgb: Rgb, elevation: number): Rgb {
  const amount = Math.min(0.35, elevation * 0.07);
  return rgb.map((c) => Math.round(c + (255 - c) * amount)) as Rgb;
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
      row.push({
        char: TERRAIN_GLYPH[tile.terrain],
        fg: TERRAIN_FG[tile.terrain],
        bg: shade(TERRAIN_BG[tile.terrain], tile.elevation),
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
