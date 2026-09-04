import type { Agent, World } from "@pokuelike/engine";
import { lightLevel } from "@pokuelike/engine";
import { SPECIES } from "@pokuelike/data";
import { getSprite } from "./sprites.js";
import {
  FLAVOR_FG,
  FLAVOR_GLYPH,
  TERRAIN_BG,
  TERRAIN_FG,
  TERRAIN_GLYPH,
  TYPE_COLOR,
  WEATHER_TINT,
  mix,
  rgbToCss,
  rgbaToCss,
  shade,
} from "./palette.js";

export const TILE_SIZE = 20;

export type RenderStyle = "tile" | "ascii";

/**
 * Only draws the surface layer, same limitation the original bare renderer
 * had — an agent on underground/canopy simply isn't drawn, so a Diglett
 * surfacing or a Pidgey landing visibly pops in and out. Fine for a first
 * pass; a real per-layer view is future work (see DESIGN.md/TODO.md).
 */
export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  selectedAgentId: string | undefined,
  style: RenderStyle = "tile"
): void {
  if (style === "ascii") return drawWorldAscii(ctx, world, selectedAgentId);
  return drawWorldTiles(ctx, world, selectedAgentId);
}

function drawWorldTiles(ctx: CanvasRenderingContext2D, world: World, selectedAgentId: string | undefined): void {
  const surface = world.tiles.surface;

  ctx.fillStyle = rgbToCss(TERRAIN_BG.floor);
  ctx.fillRect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);

  ctx.save();
  ctx.font = `${TILE_SIZE * 0.55}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = surface[y * world.width + x]!;
      // Plain floor is the overwhelming majority of the map — a loud solid
      // fill (and elevation shading turning it increasingly bright) per
      // tile drowns out everything that's actually interesting. Render it
      // as a faint "." on the near-transparent base instead, same idea as
      // a roguelike's open ground, deliberately ignoring elevation shading
      // (which is still visible on every non-floor terrain).
      if (tile.terrain === "floor") {
        ctx.fillStyle = "rgba(120, 128, 140, 0.35)";
        ctx.fillText(".", x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
        continue;
      }

      let bg = shade(TERRAIN_BG[tile.terrain], tile.elevation);
      // A depleted food/flora patch fades from its flavor accent back toward plain floor as stock runs out —
      // same idea as the original renderer's mixColor, now mixing ascii.ts's actual FLAVOR_FG/TERRAIN_BG tables.
      if ((tile.terrain === "food" || tile.terrain === "flora") && tile.stock !== undefined) {
        const accent = (tile.flavor && FLAVOR_FG[tile.flavor]) || TERRAIN_BG[tile.terrain];
        bg = mix(TERRAIN_BG.floor, accent, tile.stock);
      }

      ctx.fillStyle = rgbToCss(bg);
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.restore();

  for (const agent of world.agents) {
    if (agent.layer !== "surface") continue;
    drawAgent(ctx, agent, agent.id === selectedAgentId);
  }

  drawWeather(ctx, world);
  drawDayNightTint(ctx, world);

  if (selectedAgentId) {
    const selected = world.agents.find((a) => a.id === selectedAgentId);
    if (selected && selected.layer === "surface") drawSelectionRing(ctx, selected);
  }
}

/**
 * "ASCII classic" — a Brogue-inspired glyph render: a near-black ground,
 * every tile a single colored character rather than a filled block, and
 * translucent (not solid) per-tile backgrounds so the glyphs read as marks
 * on a surface instead of tiles in a grid. Shares `captureFrame`/
 * `TERRAIN_GLYPH`'s palette conventions with `packages/runner/src/ascii.ts`
 * (this app doesn't depend on `@pokuelike/runner`, so the tables are ported
 * into `palette.ts` rather than imported — keep them in sync by hand).
 */
function drawWorldAscii(ctx: CanvasRenderingContext2D, world: World, selectedAgentId: string | undefined): void {
  const surface = world.tiles.surface;

  ctx.fillStyle = "#08090c";
  ctx.fillRect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);

  ctx.save();
  ctx.font = `${TILE_SIZE * 0.68}px ui-monospace, "SF Mono", Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const agentAt = new Map<string, Agent>();
  for (const agent of world.agents) {
    if (agent.layer === "surface") agentAt.set(`${agent.pos.x},${agent.pos.y}`, agent);
  }

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = surface[y * world.width + x]!;
      const cx = x * TILE_SIZE + TILE_SIZE / 2;
      const cy = y * TILE_SIZE + TILE_SIZE / 2;

      // A faint, translucent wash of the terrain's own color instead of a
      // solid fill — Brogue's ground reads as lit stone, not a flat tile.
      const bg = shade(TERRAIN_BG[tile.terrain], tile.elevation);
      ctx.fillStyle = rgbaToCss(bg, tile.terrain === "floor" ? 0.25 : 0.55);
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

      const agent = agentAt.get(`${x},${y}`);
      if (agent) {
        drawAgentGlyph(ctx, agent, cx, cy, agent.id === selectedAgentId);
        continue;
      }

      const flavorGlyph = tile.flavor ? FLAVOR_GLYPH[tile.flavor] : undefined;
      const glyph = flavorGlyph ?? TERRAIN_GLYPH[tile.terrain];
      const fg = (tile.flavor && FLAVOR_FG[tile.flavor]) || TERRAIN_FG[tile.terrain];
      ctx.fillStyle = rgbaToCss(fg, tile.terrain === "floor" ? 0.45 : 0.9);
      ctx.fillText(glyph, cx, cy);
    }
  }
  ctx.restore();

  drawWeather(ctx, world);
  drawDayNightTint(ctx, world);
}

function drawAgentGlyph(ctx: CanvasRenderingContext2D, agent: Agent, cx: number, cy: number, isSelected: boolean): void {
  const isCorpse = agent.alive === false;
  const primaryType = agent.types?.[0];
  const color = isCorpse ? ([120, 120, 120] as const) : primaryType ? TYPE_COLOR[primaryType] : ([230, 230, 230] as const);

  ctx.save();
  ctx.globalAlpha = isCorpse ? 0.5 : agent.fainted ? 0.6 : 1;
  ctx.fillStyle = rgbToCss(color as [number, number, number]);
  ctx.fillText(agent.species.charAt(0).toUpperCase(), cx, cy);
  ctx.restore();

  if (isSelected) {
    ctx.save();
    ctx.strokeStyle = "#ffe066";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - TILE_SIZE / 2 + 1, cy - TILE_SIZE / 2 + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.restore();
  }
}

function drawAgent(ctx: CanvasRenderingContext2D, agent: Agent, isSelected: boolean): void {
  const px = agent.pos.x * TILE_SIZE;
  const py = agent.pos.y * TILE_SIZE;
  const def = SPECIES[agent.species];
  const sprite = def ? getSprite(def.spriteKey) : null;
  const isCorpse = agent.alive === false;

  ctx.save();
  ctx.globalAlpha = isCorpse ? 0.4 : agent.fainted ? 0.7 : 1;

  if (sprite) {
    ctx.drawImage(sprite, px, py, TILE_SIZE, TILE_SIZE);
  } else {
    const primaryType = agent.types?.[0];
    const fill = isCorpse ? [90, 90, 90] : primaryType ? TYPE_COLOR[primaryType] : ([200, 200, 200] as const);
    ctx.fillStyle = rgbToCss(fill as [number, number, number]);
    ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    ctx.fillStyle = "#0d0d0d";
    ctx.font = `${TILE_SIZE * 0.6}px monospace`;
    ctx.fillText((def?.name ?? agent.species)[0]!, px + TILE_SIZE * 0.22, py + TILE_SIZE * 0.75);
  }

  if (agent.fainted && !isCorpse) {
    ctx.fillStyle = "#fff";
    ctx.font = `${TILE_SIZE * 0.5}px monospace`;
    ctx.fillText("z", px + TILE_SIZE * 0.55, py + TILE_SIZE * 0.4);
  }

  ctx.restore();

  if (isSelected) drawSelectionRing(ctx, agent);
}

function drawSelectionRing(ctx: CanvasRenderingContext2D, agent: Agent): void {
  const px = agent.pos.x * TILE_SIZE;
  const py = agent.pos.y * TILE_SIZE;
  ctx.save();
  ctx.strokeStyle = "#ffe066";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.restore();
}

/**
 * Weather cells as translucent tinted circles — there's no ANSI equivalent
 * in ascii.ts to port (it doesn't render weather at all), so this is
 * sim-original: enough to see a storm/drought/etc. sweeping over the map
 * without trying to shade every individual affected tile.
 */
function drawWeather(ctx: CanvasRenderingContext2D, world: World): void {
  if (!world.weatherCells || world.weatherCells.length === 0) return;
  ctx.save();
  for (const cell of world.weatherCells) {
    const tint = WEATHER_TINT[cell.type] ?? [255, 255, 255];
    ctx.fillStyle = rgbaToCss(tint, 0.16);
    ctx.beginPath();
    ctx.arc(
      cell.center.x * TILE_SIZE + TILE_SIZE / 2,
      cell.center.y * TILE_SIZE + TILE_SIZE / 2,
      cell.radius * TILE_SIZE,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A flat darkening overlay driven by daynight.ts's real `lightLevel` — basic
 * (no gradient, no light sources), a deliberate first-pass scope call rather
 * than an oversight; see DESIGN.md/TODO.md.
 */
function drawDayNightTint(ctx: CanvasRenderingContext2D, world: World): void {
  const darkness = 1 - lightLevel(world.tick);
  if (darkness <= 0.02) return;
  ctx.save();
  ctx.fillStyle = `rgba(4, 6, 16, ${Math.min(0.55, darkness * 0.6)})`;
  ctx.fillRect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);
  ctx.restore();
}

/** Maps a canvas click to the topmost surface-layer agent at that tile, if any. */
export function agentAtCanvasPos(world: World, canvasX: number, canvasY: number): Agent | undefined {
  const tileX = Math.floor(canvasX / TILE_SIZE);
  const tileY = Math.floor(canvasY / TILE_SIZE);
  // Last-drawn-wins order (same order world.agents is iterated for drawing) so
  // a click resolves to whichever agent visually renders on top of the others.
  let found: Agent | undefined;
  for (const agent of world.agents) {
    if (agent.layer === "surface" && agent.pos.x === tileX && agent.pos.y === tileY) found = agent;
  }
  return found;
}
