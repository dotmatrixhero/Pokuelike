import type { Agent, TerrainKind, World } from "@pokuelike/engine";
import { lightLevel } from "@pokuelike/engine";
import { SPECIES } from "@pokuelike/data";
import { getFloorTexture, getSprite, getTileSprite, type SpriteDirection } from "./sprites.js";
import type { ActivePopup } from "./eventPopups.js";
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
  shelterOwnerTint,
  tileLight,
} from "./palette.js";

export const TILE_SIZE = 20;

export type RenderStyle = "tile" | "ascii";

/**
 * The engine has no facing concept at all (see Agent in
 * packages/engine/src/types.ts) — an agent is just a position each tick.
 * Direction is purely a client-side rendering concern, derived here by
 * comparing this frame's position to whatever we saw for the same agent id
 * last frame. Larger axis of movement wins ties (matches predation.ts's own
 * `facingToward` convention); no movement at all keeps the last known
 * direction instead of snapping back to "down", so a agent that pauses
 * mid-walk doesn't visibly spin. Cleared for ids no longer present so a
 * despawned agent's id can't pin memory forever, then repopulated fresh by
 * whichever new agent (if any) reuses that id.
 */
const lastFacing = new Map<string, SpriteDirection>();
const lastPos = new Map<string, { x: number; y: number }>();

function facingOf(agent: Agent): SpriteDirection {
  const prev = lastPos.get(agent.id);
  lastPos.set(agent.id, { x: agent.pos.x, y: agent.pos.y });
  if (!prev) return lastFacing.get(agent.id) ?? "down";

  const dx = agent.pos.x - prev.x;
  const dy = agent.pos.y - prev.y;
  if (dx === 0 && dy === 0) return lastFacing.get(agent.id) ?? "down";

  const direction: SpriteDirection = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  lastFacing.set(agent.id, direction);
  return direction;
}

/** Drops facing/position memory for agent ids no longer in the world (dead, despawned) so the maps don't grow forever. */
function pruneStaleFacings(world: World): void {
  const liveIds = new Set(world.agents.map((a) => a.id));
  for (const id of lastPos.keys()) {
    if (!liveIds.has(id)) {
      lastPos.delete(id);
      lastFacing.delete(id);
    }
  }
}

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
        // A real texture (see sprites.ts's getFloorTexture — cave/grass/stone
        // scraps previously left unused) at low, elevation-scaled opacity
        // gives open ground some varied lighting without it becoming the
        // loud, everything-else-drowning tile a full-strength fill would be.
        const texture = getFloorTexture(x, y);
        if (texture) {
          ctx.save();
          ctx.globalAlpha = 0.05 + tile.elevation * 0.03;
          ctx.drawImage(texture, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          ctx.restore();
        }
        ctx.fillStyle = rgbaToCss(shade([120, 128, 140], tile.elevation), 0.35);
        ctx.fillText(".", x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
        continue;
      }

      // Real tile art (see sprites.ts's getTileSprite) takes priority when it
      // exists for this terrain kind. "shelter" keeps its dynamic per-owner
      // tint and "food"/"flora"/"seedling" their stock-based color fade —
      // neither has a fixed piece of art to swap in — so those three always
      // fall through to the flat-color rect below regardless of availability.
      if (tile.terrain !== "shelter" && tile.terrain !== "food" && tile.terrain !== "flora" && tile.terrain !== "seedling") {
        const sprite = getTileSprite(tile.terrain, x, y);
        if (sprite) {
          ctx.drawImage(sprite, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          continue;
        }
      }

      let bg = shade(tile.terrain === "shelter" ? shelterOwnerTint(TERRAIN_BG.shelter, tile.shelterOwnerSpecies) : TERRAIN_BG[tile.terrain], tile.elevation);
      // A depleted food/flora patch fades from its flavor accent back toward plain floor as stock runs out —
      // same idea as the original renderer's mixColor, now mixing ascii.ts's actual FLAVOR_FG/TERRAIN_BG tables.
      const isPlant = tile.terrain === "food" || tile.terrain === "flora" || tile.terrain === "seedling";
      if ((tile.terrain === "food" || tile.terrain === "flora") && tile.stock !== undefined) {
        const accent = (tile.flavor && FLAVOR_FG[tile.flavor]) || TERRAIN_BG[tile.terrain];
        bg = mix(TERRAIN_BG.floor, accent, tile.stock);
      }

      // Living plant matter reads a bit more translucent than solid terrain
      // — direct ask: "plants and flora should always be a little more
      // transparent."
      ctx.fillStyle = isPlant ? rgbaToCss(bg, 0.75) : rgbToCss(bg);
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.restore();

  // Night darkening applies to the ground only, drawn before agents step in
  // on top of it — Pokémon should always read at full brightness regardless
  // of time of day, not get dimmed along with the terrain underneath them.
  drawDayNightTint(ctx, world);

  pruneStaleFacings(world);
  for (const agent of world.agents) {
    if (agent.layer !== "surface") continue;
    drawAgent(ctx, agent, agent.id === selectedAgentId);
  }

  drawWeather(ctx, world);

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

  // Things that stand *on* the ground rather than being their own kind of
  // ground — berries, flora, trees, boulders — get the same faint floor
  // wash as everything around them, colored glyph on top, instead of a
  // distinct tinted background that reads as a separate tile.
  const standsOnGround = (terrain: TerrainKind) =>
    terrain === "food" || terrain === "flora" || terrain === "seedling" || terrain === "tree" || terrain === "boulder";

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = surface[y * world.width + x]!;
      const cx = x * TILE_SIZE + TILE_SIZE / 2;
      const cy = y * TILE_SIZE + TILE_SIZE / 2;
      const accent =
        (tile.flavor && FLAVOR_FG[tile.flavor]) ||
        (tile.terrain === "shelter" ? shelterOwnerTint(TERRAIN_FG.shelter, tile.shelterOwnerSpecies) : TERRAIN_FG[tile.terrain]);
      // Faux ambient light: a static per-tile factor (0.65-1.35) so the
      // ground reads as unevenly lit stone instead of a flat repeated color
      // — the actual thing that makes Brogue's ASCII look alive rather than
      // a uniform grid.
      const light = 0.65 + tileLight(x, y) * 0.7;

      if (standsOnGround(tile.terrain)) {
        // Same faint ground wash floor itself gets (not a block glyph, not
        // no background at all — those both read wrong: one looked like a
        // filled tile, the other like a hole of pure black) so a berry
        // patch/tree/boulder sits on the same ground as everything around
        // it, just with a colored glyph standing on top of it.
        const groundBg = shade(TERRAIN_BG.floor, tile.elevation);
        ctx.fillStyle = rgbaToCss(groundBg, 0.25 * light);
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        const flavorGlyph = tile.flavor ? FLAVOR_GLYPH[tile.flavor] : undefined;
        // Living plant matter (food/flora/seedling) reads a bit lighter/more
        // translucent than a tree or boulder's glyph — those two are solid
        // obstacles, these are meant to feel soft/growing rather than as
        // visually loud as a rock. Direct ask: "plants and flora should
        // always be a little more transparent."
        const isPlant = tile.terrain === "food" || tile.terrain === "flora" || tile.terrain === "seedling";
        ctx.fillStyle = rgbaToCss(accent, (isPlant ? 0.6 : 0.85) * light);
        ctx.fillText(flavorGlyph ?? TERRAIN_GLYPH[tile.terrain], cx, cy);
      } else {
        // Everything else keeps a faint translucent wash of its own color —
        // Brogue's ground reads as lit stone, not a flat tile — plus its glyph.
        const bg = shade(tile.terrain === "shelter" ? shelterOwnerTint(TERRAIN_BG.shelter, tile.shelterOwnerSpecies) : TERRAIN_BG[tile.terrain], tile.elevation);
        ctx.fillStyle = rgbaToCss(bg, (tile.terrain === "floor" ? 0.25 : 0.55) * light);
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = rgbaToCss(accent, (tile.terrain === "floor" ? 0.45 : 0.9) * light);
        ctx.fillText(TERRAIN_GLYPH[tile.terrain], cx, cy);
      }

    }
  }
  ctx.restore();

  // Night darkening applies to the ground only, drawn before agent glyphs go
  // in on top of it — Pokémon should always read at full brightness
  // regardless of time of day, not get dimmed along with the terrain
  // underneath them. Agents used to be drawn inline in the tile loop above
  // (before this tint existed as a separate final pass); pulled into their
  // own pass here so the draw order is tiles -> tint -> agents.
  drawDayNightTint(ctx, world);

  ctx.save();
  ctx.font = `${TILE_SIZE * 0.68}px ui-monospace, "SF Mono", Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const agent of agentAt.values()) {
    const cx = agent.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = agent.pos.y * TILE_SIZE + TILE_SIZE / 2;
    drawAgentGlyph(ctx, agent, cx, cy, agent.id === selectedAgentId);
  }
  ctx.restore();

  drawWeather(ctx, world);
}

/**
 * Agents need to read as unmistakably "the important thing" against a
 * busy glyph-covered map: a soft colored halo (a filled circle, well
 * outside the letter's own footprint) behind a bold, slightly oversized,
 * outlined letter — brighter and heavier than any terrain glyph, on
 * purpose, so a Pokemon never gets lost among the ASCII scenery.
 */
function drawAgentGlyph(ctx: CanvasRenderingContext2D, agent: Agent, cx: number, cy: number, isSelected: boolean): void {
  const isCorpse = agent.alive === false;
  const primaryType = agent.types?.[0];
  const color: [number, number, number] = isCorpse ? [150, 150, 150] : primaryType ? TYPE_COLOR[primaryType] : [230, 230, 230];
  const alpha = isCorpse ? 0.5 : agent.fainted ? 0.65 : 1;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.arc(cx, cy, TILE_SIZE * 0.46, 0, Math.PI * 2);
  ctx.fillStyle = rgbaToCss(color, 0.28);
  ctx.fill();

  // A crisp white ring on top of the colored fill — the actual "unmissable
  // against busy ASCII" signal; the tinted fill alone read as too subtle.
  ctx.beginPath();
  ctx.arc(cx, cy, TILE_SIZE * 0.46, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const letter = agent.species.charAt(0).toUpperCase();
  ctx.font = `bold ${TILE_SIZE * 0.78}px ui-monospace, "SF Mono", Consolas, monospace`;
  ctx.fillStyle = rgbToCss(color);
  ctx.fillText(letter, cx, cy);
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
  const sprite = def ? getSprite(def.spriteKey, facingOf(agent)) : null;
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

/** A brief icon floating up and fading out over an event's own tile — see eventPopups.ts. */
export function drawEventPopups(ctx: CanvasRenderingContext2D, popups: readonly ActivePopup[]): void {
  if (popups.length === 0) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${TILE_SIZE * 0.75}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  for (const popup of popups) {
    const cx = popup.pos.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = popup.pos.y * TILE_SIZE + TILE_SIZE / 2 - (1 - popup.fade) * TILE_SIZE * 1.4;
    ctx.globalAlpha = Math.max(0, popup.fade);
    ctx.fillStyle = popup.color;
    ctx.fillText(popup.icon, cx, cy);
  }
  ctx.restore();
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
