import type { World } from "@pokuelike/engine";
import { SPECIES } from "@pokuelike/data";
import { getSprite } from "./sprites.js";

const TERRAIN_COLOR: Record<string, string> = {
  floor: "#1c2128",
  wall: "#3a3f4b",
  water: "#2b6cb0",
  food: "#8b5a2b",
  sunbeam: "#e8c547",
};

export const TILE_SIZE = 24;

/** Elevation shades the floor lighter — a cheap stand-in until real tile art exists. */
function shade(color: string, elevation: number): string {
  if (elevation <= 0) return color;
  const amount = Math.min(0.4, elevation * 0.08);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(color.slice(i, i + 2), 16);
    return Math.min(255, Math.round(channel + (255 - channel) * amount));
  });
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Only draws the surface layer — agents on underground/canopy simply aren't
 * drawn, so a Diglett surfacing or a Pidgey landing visibly pops in and out.
 */
export function drawWorld(ctx: CanvasRenderingContext2D, world: World): void {
  const surface = world.tiles.surface;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = surface[y * world.width + x]!;
      const base = TERRAIN_COLOR[tile.terrain] ?? "#000";
      ctx.fillStyle = shade(base, tile.elevation);
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  for (const agent of world.agents) {
    if (agent.layer !== "surface") continue;

    const px = agent.pos.x * TILE_SIZE;
    const py = agent.pos.y * TILE_SIZE;
    const def = SPECIES[agent.species];
    const sprite = def ? getSprite(def.spriteKey) : null;

    if (sprite) {
      ctx.drawImage(sprite, px, py, TILE_SIZE, TILE_SIZE);
    } else {
      ctx.fillStyle = def?.placeholderColor ?? "#ccc";
      ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      ctx.fillStyle = "#111";
      ctx.font = `${TILE_SIZE * 0.6}px monospace`;
      ctx.fillText((def?.name ?? agent.species)[0]!, px + TILE_SIZE * 0.25, py + TILE_SIZE * 0.75);
    }
  }
}
