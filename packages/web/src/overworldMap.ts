import type { Agent, World } from "@pokuelike/engine";
import { TERRAIN_BG, TYPE_COLOR, rgbToCss, shade } from "./palette.js";

/**
 * A real, zoomed-all-the-way-out satellite view of one region's own
 * generated terrain — one physical canvas pixel per tile, upscaled with
 * `image-rendering: pixelated` by the caller's CSS so it reads as a crisp
 * minimap rather than a blur. Direct follow-up ask, after the first
 * overworld pass shipped as a plain data-card strip: "I kinda thought
 * overworld would be it's own tileset we can zoom out to... its own
 * renderer... see the bigger picture." This is that — literally that
 * region's real `World.tiles.surface`, not an abstract color swatch or a
 * fabricated macro-map. Every living agent gets its own bright, type-colored
 * pixel on top of the terrain, so population presence/clustering is visible
 * at a glance even at this scale.
 *
 * Deliberately reuses `TERRAIN_BG`/`shade` — the exact same palette
 * `renderer.ts`'s ordinary tile view derives its colors from — so a region's
 * minimap and its full drilled-in view always agree on what a biome "looks
 * like," just at wildly different zoom levels.
 */
export function drawRegionThumbnail(canvas: HTMLCanvasElement, world: World): void {
  canvas.width = world.width;
  canvas.height = world.height;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(world.width, world.height);
  const surface = world.tiles.surface;

  for (let i = 0; i < surface.length; i++) {
    const tile = surface[i]!;
    const [r, g, b] = shade(TERRAIN_BG[tile.terrain], tile.elevation);
    const o = i * 4;
    image.data[o] = r;
    image.data[o + 1] = g;
    image.data[o + 2] = b;
    image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  // Living agents as bright, type-colored single pixels — real population
  // presence, not a fabricated "settlement icon." An agent on a non-surface
  // layer shares its (x, y) footprint with surface (see types.ts's layer
  // doc comment), which is exactly what makes plotting it directly onto
  // this surface-only minimap a reasonable stand-in rather than a lie: it's
  // still "roughly where that individual actually is," just collapsed to
  // one shared 2D footprint the same way the underground/canopy layers
  // already share it with surface everywhere else in this codebase.
  ctx.save();
  for (const agent of world.agents as Agent[]) {
    if (agent.alive === false || agent.isEgg) continue;
    const color = agent.types?.[0] ? TYPE_COLOR[agent.types[0]] : undefined;
    ctx.fillStyle = color ? rgbToCss(color) : "#e8eaed";
    ctx.fillRect(Math.floor(agent.pos.x), Math.floor(agent.pos.y), 1, 1);
  }
  ctx.restore();
}
