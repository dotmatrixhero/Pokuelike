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
  rgbToCss,
  rgbaToCss,
  shade,
  shelterOwnerTint,
  tileLight,
} from "./palette.js";

export const TILE_SIZE = 20;
/**
 * Real sprite art is drawn larger than one tile and bottom-anchored (feet on
 * the tile, head/body overflowing upward into the tile above) rather than
 * squeezed into an exact TILE_SIZE box — direct ask: "Pokemon sprites are
 * tiny make em bigger." A plain fixed multiplier, not per-species-fitted;
 * tune this one constant if it still reads too small/large once watched for
 * real.
 */
const SPRITE_SCALE = 1.6;

/**
 * A tiny cached radial-gradient stamp, reused (via `drawImage`, not a fresh
 * `createRadialGradient` per tile) across every tile in the tile-style
 * render — direct ask: "radial light effects per tile, if possible... just
 * silly simulated lighting stuff." A brighter center fading to a darker
 * edge gives each tile a subtle "domed" look instead of a flat fill, at
 * basically the cost of one extra `drawImage` per tile (an offscreen-canvas
 * stamp is orders of magnitude cheaper per-draw than building a real
 * gradient ~5000+ times a frame on a full map). Purely decorative — no
 * gameplay signal, just texture. Modulated per-tile by `tileLight` (the
 * same pseudo-random 0.65-1.35 ambient factor `drawWorldAscii` already uses
 * for its "unevenly lit stone" look) so the two render styles read as the
 * same underlying lighting concept.
 */
let vignetteTileCache: HTMLCanvasElement | undefined;
function vignetteStamp(): HTMLCanvasElement {
  if (vignetteTileCache) return vignetteTileCache;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const vctx = canvas.getContext("2d")!;
  const grad = vctx.createRadialGradient(TILE_SIZE / 2, TILE_SIZE / 2, 0, TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.75);
  grad.addColorStop(0, "rgba(255,255,255,0.10)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.0)");
  grad.addColorStop(1, "rgba(0,0,0,0.18)");
  vctx.fillStyle = grad;
  vctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  vignetteTileCache = canvas;
  return canvas;
}

/** Stamps the per-tile radial vignette at `(x, y)`, modulated by the same ambient `tileLight` factor `drawWorldAscii` uses. Called once per tile, right before that tile's loop iteration ends. */
function drawTileVignette(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.globalAlpha = 0.5 + tileLight(x, y) * 0.5;
  ctx.drawImage(vignetteStamp(), x * TILE_SIZE, y * TILE_SIZE);
  ctx.restore();
}

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
      renderPos.delete(id);
    }
  }
}

/**
 * Smooth per-agent movement — direct ask: "give the Pokémon some
 * interpolated animation." The engine has no sub-tick position at all (an
 * agent occupies exactly one integer tile each tick — see the big comment on
 * `facingOf` above); without this, a real sprite visibly teleports one tile
 * at a time every tick, which reads much worse with real art than it ever
 * did with a single ASCII letter. Purely a rendering-layer illusion: each
 * frame eases the drawn position a fraction of the way from wherever it was
 * last drawn toward the agent's real current tile, at a rate independent of
 * frame rate (via `dt`, real elapsed seconds since the last frame) so it
 * looks the same whether the browser is doing 30fps or 144fps. Only used by
 * the sprite/tile render style (`drawAgent`) — ASCII mode deliberately
 * collapses to exactly one glyph per grid cell (see `drawWorldAscii`'s
 * `agentAt` map), which a fractional/interpolated position would break.
 */
const renderPos = new Map<string, { x: number; y: number }>();
/** How fast the drawn position catches up to the real one — higher is snappier/closer to instant, lower is floatier. Tuned by eye, not derived from tick rate. */
const ANIM_CATCHUP_RATE = 10;
/**
 * A jump at or beyond this many tiles in one tick is a real teleport (a
 * predator relocation, dispersal, or fresh spawn), not a walk — sliding the
 * sprite smoothly across half the map would look like a hallucination, not
 * an animation. Snap instantly instead.
 */
const TELEPORT_SNAP_TILES = 3;

function interpolatedPos(agent: Agent, dt: number): { x: number; y: number } {
  const target = agent.pos;
  const prev = renderPos.get(agent.id);
  if (!prev || Math.hypot(target.x - prev.x, target.y - prev.y) >= TELEPORT_SNAP_TILES) {
    const snapped = { x: target.x, y: target.y };
    renderPos.set(agent.id, snapped);
    return snapped;
  }
  const factor = 1 - Math.exp(-ANIM_CATCHUP_RATE * dt);
  const next = { x: prev.x + (target.x - prev.x) * factor, y: prev.y + (target.y - prev.y) * factor };
  renderPos.set(agent.id, next);
  return next;
}

/** Real elapsed seconds since the last call, clamped so a backgrounded tab regaining focus (or a long GC pause) can't produce one huge catch-up jump — see `interpolatedPos`. */
let lastFrameTimeMs: number | undefined;
function frameDeltaSeconds(): number {
  const now = performance.now();
  const dt = lastFrameTimeMs === undefined ? 0 : (now - lastFrameTimeMs) / 1000;
  lastFrameTimeMs = now;
  return Math.min(dt, 0.25);
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
  // Always advance the animation clock, even in ASCII mode (which ignores
  // `dt` entirely) — so switching from ASCII back to tile mode doesn't hand
  // `interpolatedPos` one huge accumulated `dt` and produce a visible warp.
  const dt = frameDeltaSeconds();
  if (style === "ascii") return drawWorldAscii(ctx, world, selectedAgentId);
  return drawWorldTiles(ctx, world, selectedAgentId, dt);
}

function drawWorldTiles(ctx: CanvasRenderingContext2D, world: World, selectedAgentId: string | undefined, dt: number): void {
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
        // A real texture (see sprites.ts's getFloorTexture — cave-floor/
        // dirt-path crops) drawn at near-full strength — direct follow-up
        // ask after this was merged in at a barely-visible opacity: "why is
        // the ground tile on tile mode not the nice dirt ones we put in?"
        // The dirt art itself already has real tonal variation, so it
        // doesn't need to be faded down to avoid looking like a flat loud
        // fill the way a single solid color would.
        const texture = getFloorTexture(x, y);
        if (texture) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, 0.82 + tile.elevation * 0.18);
          ctx.drawImage(texture, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          ctx.restore();
        }
        ctx.fillStyle = rgbaToCss(shade([120, 128, 140], tile.elevation), 0.35);
        ctx.fillText(".", x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
        drawTileVignette(ctx, x, y);
        continue;
      }

      // Real tile art (see sprites.ts's getTileSprite) takes priority when it
      // exists for this terrain kind. "shelter" keeps its dynamic per-owner
      // tint and "food"/"flora"/"seedling" get the muted glyph-on-faint-wash
      // treatment right below instead — neither has a fixed piece of art to
      // swap in — so those always fall through here regardless of art
      // availability.
      if (tile.terrain !== "shelter" && tile.terrain !== "food" && tile.terrain !== "flora" && tile.terrain !== "seedling") {
        const sprite = getTileSprite(tile.terrain, x, y);
        if (sprite) {
          ctx.drawImage(sprite, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          drawTileVignette(ctx, x, y);
          continue;
        }
      }

      // Plant tiles (food/flora/seedling) used to fill the *entire* tile with
      // a near-solid wash of their flavor's full-saturation accent color
      // (FLAVOR_FG values like a vivid [255,140,190] pink) — direct ask:
      // "plant tiles are too colorful, make em match the ascii." The ASCII
      // render mode (drawWorldAscii below) never does this: a plant tile
      // there gets the same faint ground wash every other tile gets, plus a
      // small colored *glyph* standing on it, not a colorful full-tile fill.
      // Ported that same treatment here instead of the old mix-to-full-color
      // fill.
      if (tile.terrain === "food" || tile.terrain === "flora" || tile.terrain === "seedling") {
        const groundBg = shade(TERRAIN_BG.floor, tile.elevation);
        ctx.fillStyle = rgbaToCss(groundBg, 0.35);
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        const accent = (tile.flavor && FLAVOR_FG[tile.flavor]) || TERRAIN_FG[tile.terrain];
        const glyph = (tile.flavor && FLAVOR_GLYPH[tile.flavor]) || TERRAIN_GLYPH[tile.terrain];
        // Same "fades back toward nothing as stock runs out" idea the old
        // full-tile fill had, just applied to the glyph's own alpha instead
        // of a whole-tile color mix.
        const glyphAlpha = tile.stock !== undefined ? 0.3 + 0.5 * tile.stock : 0.55;
        ctx.fillStyle = rgbaToCss(accent, glyphAlpha);
        ctx.fillText(glyph, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
        drawTileVignette(ctx, x, y);
        continue;
      }

      const bg = shade(tile.terrain === "shelter" ? shelterOwnerTint(TERRAIN_BG.shelter, tile.shelterOwnerSpecies) : TERRAIN_BG[tile.terrain], tile.elevation);
      ctx.fillStyle = rgbToCss(bg);
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      drawTileVignette(ctx, x, y);
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
    drawAgent(ctx, agent, agent.id === selectedAgentId, dt);
  }

  drawWarmLights(ctx, world);
  drawWeather(ctx, world);

  if (selectedAgentId) {
    const selected = world.agents.find((a) => a.id === selectedAgentId);
    if (selected && selected.layer === "surface") {
      // Drawn again on top of weather so a storm/etc. doesn't obscure the
      // ring — reads the same interpolated position `drawAgent`'s own pass
      // above just set for this frame (not a fresh interpolation step) so
      // the two draws land in exactly the same place.
      const pos = renderPos.get(selected.id) ?? selected.pos;
      drawSelectionRing(ctx, pos.x * TILE_SIZE, pos.y * TILE_SIZE);
    }
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

function drawAgent(ctx: CanvasRenderingContext2D, agent: Agent, isSelected: boolean, dt: number): void {
  const pos = interpolatedPos(agent, dt);
  const px = pos.x * TILE_SIZE;
  const py = pos.y * TILE_SIZE;
  const def = SPECIES[agent.species];
  const direction = facingOf(agent);
  const sprite = def ? getSprite(def.spriteKey, direction) : null;
  const isCorpse = agent.alive === false;

  // Faux drop shadow — direct ask: "faux shadows under the Pokémon, just
  // silly simulated lighting stuff." A flat dark ellipse pinned to the
  // agent's actual tile (not the oversized sprite box above it), so it
  // reads as ground contact regardless of how tall/wide that species'
  // sprite happens to be. Drawn before the sprite/fallback rect so it sits
  // underneath, not on top.
  ctx.save();
  ctx.globalAlpha = (isCorpse ? 0.4 : agent.fainted ? 0.7 : 1) * 0.4;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(px + TILE_SIZE / 2, py + TILE_SIZE * 0.86, TILE_SIZE * 0.32, TILE_SIZE * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = isCorpse ? 0.4 : agent.fainted ? 0.7 : 1;

  if (sprite) {
    // Bigger than one tile (see SPRITE_SCALE) and bottom-anchored so the
    // sprite's feet sit on its actual tile instead of the whole thing being
    // centered/squished into TILE_SIZE. No canvas mirroring needed — see
    // getSprite's doc comment: "_left"/"_right" are genuine, correctly
    // mirrored art once you load the (swapped) right file for each
    // direction, so the plain source image is already correctly oriented.
    const w = TILE_SIZE * SPRITE_SCALE;
    const h = TILE_SIZE * SPRITE_SCALE;
    const dx = px + TILE_SIZE / 2 - w / 2;
    const dy = py + TILE_SIZE - h;
    ctx.drawImage(sprite, dx, dy, w, h);
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

  if (isSelected) drawSelectionRing(ctx, px, py);
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

function drawSelectionRing(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.save();
  ctx.strokeStyle = "#ffe066";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.restore();
}

/** Cheap deterministic per-position hash — gives each light source its own stable shimmer phase without touching `world.rng` (this is pure visual flourish, zero gameplay effect). Same technique sprites.ts's water-tile animation already uses. */
function hashLightPhase(x: number, y: number): number {
  let h = Math.floor(x * 92821) ^ Math.floor(y * 68917);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) % 1000;
}

/**
 * Warm, gently shimmering area-of-effect light glow — direct ask: "some warm
 * color lights kinda do aoe shimmering shit." Live fire-type agents only
 * (`TYPE_COLOR.fire`, already the thematically warm color this codebase
 * uses for the type elsewhere) — a "sunbeam" terrain-tile light source was
 * tried alongside this and dropped on direct follow-up ("let's remove the
 * sunbeam one, fire Pokémon one is awesome"). Drawn with additive
 * ("lighter") blending so it reads as light actually brightening the
 * scene — including punching through `drawDayNightTint`'s darkening, the
 * way a real light source should — rather than a colored shape painted on
 * top. Shimmer is two overlapping sine waves at different frequencies (a
 * single sine reads as a steady metronome pulse; two together read as an
 * organic flicker), phase-offset per source via `hashLightPhase` so
 * multiple lights don't pulse in unison.
 */
function drawWarmLights(ctx: CanvasRenderingContext2D, world: World): void {
  const sources: { cx: number; cy: number; radiusTiles: number; color: [number, number, number]; strength: number; phase: number }[] = [];

  for (const agent of world.agents) {
    if (agent.layer !== "surface" || agent.alive === false) continue;
    if (!agent.types?.includes("fire")) continue;
    const pos = renderPos.get(agent.id) ?? agent.pos;
    sources.push({ cx: pos.x + 0.5, cy: pos.y + 0.5, radiusTiles: 2.5, color: TYPE_COLOR.fire, strength: 0.5, phase: hashLightPhase(pos.x, pos.y) + agent.id.length * 37 });
  }
  if (sources.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const t = performance.now();
  for (const src of sources) {
    const shimmer = 0.82 + 0.1 * Math.sin(t / 340 + src.phase) + 0.08 * Math.sin(t / 130 + src.phase * 1.7);
    const cx = src.cx * TILE_SIZE;
    const cy = src.cy * TILE_SIZE;
    const r = src.radiusTiles * TILE_SIZE * shimmer;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, rgbaToCss(src.color, src.strength * shimmer));
    grad.addColorStop(1, rgbaToCss(src.color, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
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
