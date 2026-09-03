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

export function drawWorld(ctx: CanvasRenderingContext2D, world: World): void {
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = world.tiles[y * world.width + x]!;
      ctx.fillStyle = TERRAIN_COLOR[tile.terrain] ?? "#000";
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }

  for (const agent of world.agents) {
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
