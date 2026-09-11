import type { Agent, TerrainKind, Tile, Vec2, Vision, World, Layer } from "@pokuelike/engine";
import { biomeWeightsAt, dayPhase, findPlayer, isLitTile, lightLevel, tileAt, type DecalSlot } from "@pokuelike/engine";
import { SPECIES } from "@pokuelike/data";
import {
  getFertilePatch,
  getFloorBaseName,
  getGroundPatch,
  decalArt,
  GROUND_CELL,
  GROUND_PATCH_CELLS,
  getFloraSprite,
  getFoodSprite,
  getSeedlingSprite,
  getSprite,
  humanSpriteKey,
  getTileSprite,
  tileWindow,
  getWaterFrame,
  currentWaterFrame,
  type SpriteDirection,
} from "./sprites.js";
import type { ActivePopup } from "./eventPopups.js";
import type { ActiveMoveFlash } from "./moveEffects.js";
import {
  BIOME_FLORA_TINT,
  BIOME_TINT,
  CROP_EMOJI,
  FLAVOR_FG,
  FLAVOR_GLYPH,
  GROUND_TYPE_TINT,
  TERRAIN_BG,
  TERRAIN_FG,
  TERRAIN_GLYPH,
  TYPE_COLOR,
  WATER_DEPTH_DARKEN_MAX,
  WEATHER_TINT,
  rgbToCss,
  rgbaToCss,
  shade,
  shelterOwnerTint,
  terrainBgColor,
  type Rgb,
  tileLight,
  waterDepthFactor,
  waterDepthShade,
} from "./palette.js";

export const TILE_SIZE = 20;

/**
 * A wild human's emoji, keyed by `Agent.archetype` (engine's
 * `assignHumanArchetype`) and `Agent.sex`. Direct ask's own proposed set —
 * hunter/forager/traveler/merchant/wanderer — with the plainest gendered
 * variant available for each; the ninja emoji has no official female
 * variant, so hunter is unisex. `wanderer` also doubles as the fallback for
 * a human with no `archetype` set (the player, or a pre-archetype save).
 */
const HUMAN_ARCHETYPE_EMOJI: Record<"hunter" | "forager" | "traveler" | "merchant" | "wanderer", { male: string; female: string }> = {
  hunter: { male: "🥷", female: "🥷" },
  forager: { male: "👨‍🌾", female: "👩‍🌾" },
  traveler: { male: "🚴‍♂️", female: "🚴‍♀️" },
  merchant: { male: "🙋‍♂️", female: "🙋‍♀️" },
  wanderer: { male: "🧘‍♂️", female: "🧘‍♀️" },
};
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
 * silly simulated lighting stuff." Purely decorative — no gameplay signal,
 * just texture. Modulated per-tile by `tileLight` (the same pseudo-random
 * 0.65-1.35 ambient factor `drawWorldAscii` already uses for its "unevenly
 * lit stone" look) so the two render styles read as the same underlying
 * lighting concept.
 *
 * Deliberately much weaker than the first version, which had a highlight
 * up to 0.10 and an edge darkening up to 0.18 at up to full alpha — direct
 * follow-up ask once real floor/ground art was the primary thing on
 * screen rather than a faint wash: "some of the tiles have weird shadow
 * on them to make look like beveled." A per-tile bright-center/dark-edge
 * gradient repeated across every tile is, by construction, an embossed-
 * grid look; real biome art has no such per-tile edge darkening at all.
 * Kept as a much subtler ambient variation instead of removed outright,
 * since the original ask for "silly lighting stuff" was real too.
 */
let vignetteTileCache: HTMLCanvasElement | undefined;
function vignetteStamp(): HTMLCanvasElement {
  if (vignetteTileCache) return vignetteTileCache;
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const vctx = canvas.getContext("2d")!;
  const grad = vctx.createRadialGradient(TILE_SIZE / 2, TILE_SIZE / 2, 0, TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.75);
  grad.addColorStop(0, "rgba(255,255,255,0.03)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.0)");
  grad.addColorStop(1, "rgba(0,0,0,0.05)");
  vctx.fillStyle = grad;
  vctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  vignetteTileCache = canvas;
  return canvas;
}

/**
 * The ambient per-tile vignette, for the WHOLE map, as one cached layer.
 *
 * This used to be a `save`/`globalAlpha`/`drawImage`/`restore` per tile, and
 * profiling put it at 30ms of a 65ms frame — 46% of the entire render, for a
 * 0.03-alpha gradient. `tileLight` is a pure hash of (x, y), so the layer
 * never changes: it is built once per world size and blitted in one call.
 */
const vignetteLayerCache = new WeakMap<World, HTMLCanvasElement>();
function drawVignetteLayer(ctx: CanvasRenderingContext2D, world: World): void {
  let layer = vignetteLayerCache.get(world);
  if (!layer || layer.width !== world.width * TILE_SIZE) {
    layer = document.createElement("canvas");
    layer.width = world.width * TILE_SIZE;
    layer.height = world.height * TILE_SIZE;
    const vctx = layer.getContext("2d")!;
    vctx.imageSmoothingEnabled = false;
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        vctx.globalAlpha = 0.3 + tileLight(x, y) * 0.3;
        vctx.drawImage(vignetteStamp(), x * TILE_SIZE, y * TILE_SIZE);
      }
    }
    vignetteLayerCache.set(world, layer);
  }
  blitVisible(ctx, layer, world);
}

/** `fillRect` over the on-screen slice only — same reasoning as `blitVisible`. */
function fillVisible(ctx: CanvasRenderingContext2D, world: World): void {
  const view = culledBounds(world);
  const w = (view.x1 - view.x0) * TILE_SIZE;
  const h = (view.y1 - view.y0) * TILE_SIZE;
  if (w <= 0 || h <= 0) return;
  ctx.fillRect(view.x0 * TILE_SIZE, view.y0 * TILE_SIZE, w, h);
}

/**
 * Blits only the on-screen slice of a full-map cached layer. The source and
 * destination rects are identical — this is a crop, not a transform — it just
 * avoids pushing 1800x1200 of pixels when a fraction of that is visible.
 */
function blitVisible(ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, world: World): void {
  const view = culledBounds(world);
  const sx = view.x0 * TILE_SIZE;
  const sy = view.y0 * TILE_SIZE;
  const w = (view.x1 - view.x0) * TILE_SIZE;
  const h = (view.y1 - view.y0) * TILE_SIZE;
  if (w <= 0 || h <= 0) return;
  ctx.drawImage(layer, sx, sy, w, h, sx, sy, w, h);
}

/**
 * The real tile art for boulders/trees/bushes/walls and berry plants are all
 * small icons with transparent corners (a rounded rock, a plant sprouting
 * out of a pot), not full-tile-opaque textures — direct ask: "behind the
 * berries needs to be a dirt tile or something. same with boulders.
 * otherwise its just black behind it" (the near-black canvas base, per
 * `drawWorldTiles`'s own base `fillRect`, was showing straight through
 * those transparent corners). Draws the same dirt/cave floor texture
 * `plain "floor" terrain already uses underneath every one of those
 * object-on-ground sprites, with a flat-color fallback for the brief window
 * before the texture image has actually loaded (`getFloorTexture` returns
 * `null` until then — see `loadSprite`). NOT used for "water", which is
 * its own full-tile opaque surface, not an object standing on ground.
 */
/**
 * Which biome (by name) dominates this tile, per worldgen.ts's real
 * per-tile blend (`biomeWeightsAt`) — memoized per `World` object since
 * biome seed placement is fixed at generation time and never changes
 * mid-simulation, so this is real work only once per tile ever, not once
 * per tile per frame. Returns `undefined` for a `World` with no biome data
 * at all (a bare test fixture, or worldgen never run), same as
 * `biomeWeightsAt` itself returning `{}` in that case.
 */
const dominantBiomeCache = new WeakMap<World, (string | undefined)[]>();
function dominantBiomeAt(world: World, x: number, y: number): string | undefined {
  if (!world.biomeSeeds || world.biomeSeeds.length === 0) return undefined;
  let cache = dominantBiomeCache.get(world);
  if (!cache) {
    cache = new Array(world.width * world.height);
    dominantBiomeCache.set(world, cache);
  }
  const idx = y * world.width + x;
  if (cache[idx] === undefined) {
    const weights = biomeWeightsAt(world.biomeSeeds, x, y);
    let best: string | undefined;
    let bestWeight = 0;
    for (const [name, weight] of Object.entries(weights)) {
      if (weight > bestWeight) {
        bestWeight = weight;
        best = name;
      }
    }
    cache[idx] = best ?? ""; // "" sentinel: computed, no dominant biome
  }
  return cache[idx] || undefined;
}

/**
 * One tile's ground, windowed out of its biome's multi-tile ground patch in
 * WORLD space: tile `(x, y)` draws source cell `(x % 6, y % 6)`, so two
 * neighbouring tiles draw two neighbouring source cells and a run of ground
 * reads as one continuous surface instead of the same sixteen pixels stamped
 * over and over. See sprites.ts's `BIOME_GROUND` for what that does and does
 * not buy (measured: some of the source grounds are genuinely one repeated
 * tile, and for those the win comes from the scatter layer instead).
 */
function drawGroundBacking(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, elevation: number): void {
  const biome = dominantBiomeAt(world, x, y);
  // A "sand" TERRAIN tile is ground, so it is painted here in the ground pass
  // rather than in the tile loop. Drawn in the loop it landed AFTER
  // `drawElevationShade`, so every sand tile kept full brightness while the
  // ground around it was shaded — a scatter of pale squares, which is the
  // exact artifact this pass exists to remove.
  const terrain = world.tiles[activeViewLayer][y * world.width + x]!.terrain;
  const patch = terrain === "sand" ? getGroundPatch("beach", "surface") : getGroundPatch(biome, activeViewLayer);
  if (patch && patch.width >= GROUND_CELL) {
    drawPatchCell(ctx, patch, x, y);
    // Elevation shading is NOT applied here — see `drawElevationShade`.
  } else {
    // The art has not finished loading. Flagged so `groundLayerCanvas` does
    // NOT cache this frame: the first frame runs before any PNG is decoded, so
    // caching it bakes a whole map of fallback fill and, since the cache key
    // never changes, keeps it forever. That shipped as an entirely black map
    // while the profiler happily reported a much better frame rate — it was
    // faster because it had stopped drawing the ground at all.
    groundArtPending = true;
    ctx.fillStyle = rgbToCss(shade(TERRAIN_BG.floor, elevation));
    ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  }

  // Direct ask: "border edging around different tiles to blend would be
  // nice" — see drawBiomeEdgeBlend's own doc comment for why this is a
  // generated gradient blend rather than real edge art.
  drawBiomeEdgeBlend(ctx, world, x, y, elevation, biome);
}

/**
 * An object that STANDS on a tile — a tree, a bush, a berry plant — drawn at
 * its own aspect ratio, fitted to the tile's width and anchored so its base
 * sits on the tile's bottom edge.
 *
 * Every one of these used to be squashed into a TILE_SIZE square: `tree_1` is
 * 32x42 and the berry plants are 21x34, so they were being vertically
 * compressed by a third and rendered squat. They are drawn in top-to-bottom
 * row order, so the overflow above the tile lands on rows already painted.
 * Height is capped so a very tall sprite can't cover the tile two rows up.
 */
const STANDING_MAX_TILES = 1.7;
function drawStandingSprite(ctx: CanvasRenderingContext2D, sprite: CanvasImageSource, srcW: number, srcH: number, x: number, y: number): void {
  const height = Math.min(TILE_SIZE * STANDING_MAX_TILES, (srcH / srcW) * TILE_SIZE);
  drawContactShadow(ctx, (x + 0.5) * TILE_SIZE, (y + 1) * TILE_SIZE - TILE_SIZE * 0.12, TILE_SIZE);
  ctx.drawImage(sprite, x * TILE_SIZE, (y + 1) * TILE_SIZE - height, TILE_SIZE, height);
  drawGoldenRim(ctx, sprite, srcW, srcH, x * TILE_SIZE, (y + 1) * TILE_SIZE - height, TILE_SIZE, height);
}

/**
 * How high the sun is (0 at midnight, 1 at noon) and how golden the light is
 * (0 when neutral or cold, 1 at the warmest minute of dawn/dusk). Set once per
 * frame from the world clock and read by the shadow/highlight helpers, the
 * same module-level-per-frame idiom `activeViewLayer` already uses — passing
 * them down through every draw call would mean touching a dozen signatures for
 * two numbers that are constant for the whole frame.
 */
let sunHeight = 1;
let goldenAmount = 0;

/** Shadow opacity with the sun overhead, and the residue left at midnight (ambient contact darkening never fully disappears — an object still occludes the sky). */
const CONTACT_SHADOW_SUN = 0.42;
const CONTACT_SHADOW_AMBIENT = 0.12;

/**
 * The soft dark ellipse that sits an object ON the ground instead of letting
 * it float above it.
 *
 * Deliberately centred and round rather than cast off to one side: the source
 * art is lit from straight above with no side light (measured: +37 to +43
 * top-to-bottom, within a point left-to-right), so a shadow thrown sideways
 * would contradict every sprite's own baked highlight. What varies with the
 * clock is tightness and depth, not direction — crisp and dark under a high
 * sun, wide and faint at dawn and dusk, down to a faint ambient smudge at
 * midnight.
 */
let contactShadowCache: HTMLCanvasElement | undefined;
function contactShadowStamp(): HTMLCanvasElement {
  if (contactShadowCache) return contactShadowCache;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const sctx = canvas.getContext("2d")!;
  const grad = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.75)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, size, size);
  contactShadowCache = canvas;
  return canvas;
}

function drawContactShadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, footprint: number): void {
  const alpha = CONTACT_SHADOW_AMBIENT + CONTACT_SHADOW_SUN * sunHeight;
  if (alpha <= 0.01) return;
  // A low sun spreads and softens the contact patch; a high one pulls it in.
  const spread = 1.3 - 0.35 * sunHeight;
  // Wider than the tile on purpose. At 0.9 of a tile the ellipse sat almost
  // entirely BEHIND the sprite casting it and changed 0.4% of the frame —
  // measured against a zeroed control, and reported as "I don't really see
  // the contact shadows that distinctly". A shadow has to spill past the
  // silhouette to read as one.
  const w = footprint * 1.45 * spread;
  const h = w * 0.42;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(contactShadowStamp(), cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
}

/** How strongly golden-hour light rims an object at its warmest. */
const GOLDEN_RIM_MAX = 0.5;
/** Golden amount is quantised into this many buckets so the rim variants can be cached per sprite instead of rebuilt every draw. */
const GOLDEN_BUCKETS = 6;

/**
 * A warm light on an object's upper half at dawn and dusk.
 *
 * The day grade (see `drawDayNightTint`) multiplies, which can only ever take
 * light away — it warms the world by darkening blue, so at golden hour
 * everything goes amber but nothing actually looks LIT. This adds the other
 * half: real light, composited with `lighter`, masked to the sprite's own
 * pixels and weighted toward its top, which is exactly where the source art
 * already puts its baked highlight. It reinforces the art's light direction
 * rather than arguing with it.
 */
const goldenRimCache = new Map<string, HTMLCanvasElement>();
function goldenRimStamp(sprite: CanvasImageSource, key: string, srcW: number, srcH: number): HTMLCanvasElement {
  const cached = goldenRimCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = srcW;
  canvas.height = srcH;
  const rctx = canvas.getContext("2d")!;
  rctx.drawImage(sprite, 0, 0, srcW, srcH);
  rctx.globalCompositeOperation = "source-atop";
  const grad = rctx.createLinearGradient(0, 0, 0, srcH);
  // Two rejected settings bracket this one. Fading to a quarter strength by
  // the halfway mark was invisible — 2.5% of the frame against a zeroed
  // control, reported as "certainly not highlight?". Running warm light most
  // of the way down at 0.85 went the other way and turned every tree solid
  // peach: light stops reading as light once it eats the object's own colour.
  // So a pale gold rather than an orange, real strength only in the top
  // third, gone by two thirds.
  grad.addColorStop(0, "rgba(255, 226, 178, 0.95)");
  grad.addColorStop(0.32, "rgba(255, 198, 136, 0.45)");
  grad.addColorStop(0.62, "rgba(255, 170, 110, 0.08)");
  grad.addColorStop(1, "rgba(255, 160, 100, 0)");
  rctx.fillStyle = grad;
  rctx.fillRect(0, 0, srcW, srcH);
  goldenRimCache.set(key, canvas);
  return canvas;
}

function drawGoldenRim(ctx: CanvasRenderingContext2D, sprite: CanvasImageSource, srcW: number, srcH: number, dx: number, dy: number, dw: number, dh: number): void {
  const bucket = Math.round(goldenAmount * GOLDEN_BUCKETS) / GOLDEN_BUCKETS;
  if (bucket <= 0) return;
  const key = spriteCacheKey(sprite, srcW, srcH);
  if (!key) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = bucket * GOLDEN_RIM_MAX;
  ctx.drawImage(goldenRimStamp(sprite, key, srcW, srcH), dx, dy, dw, dh);
  ctx.restore();
}

/** A stable cache key for a sprite source — its URL for an <img>, its size for a generated canvas (tinted obstacle variants, which are already cached by their own key upstream). */
function spriteCacheKey(sprite: CanvasImageSource, srcW: number, srcH: number): string | null {
  if (sprite instanceof HTMLImageElement) return sprite.src;
  if (sprite instanceof HTMLCanvasElement) return `canvas:${srcW}x${srcH}:${(sprite as HTMLCanvasElement).dataset.rimKey ?? ""}`;
  return null;
}

/** Draws tile `(x, y)`'s cell of a multi-tile ground patch, windowed in world space so neighbouring tiles are continuous. */
function drawPatchCell(ctx: CanvasRenderingContext2D, patch: HTMLImageElement, x: number, y: number): void {
  const sx = (x % GROUND_PATCH_CELLS) * GROUND_CELL;
  const sy = (y % GROUND_PATCH_CELLS) * GROUND_CELL;
  ctx.drawImage(patch, sx, sy, GROUND_CELL, GROUND_CELL, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}

/** Elevation at which ground is neither lit nor shaded. */
const ELEVATION_MID = 0.5;
/** How dark the lowest hollows get, and how bright the highest ground. Light is weaker than shade on purpose — a washed-out highlight reads as fog, a slightly darker hollow reads as depth. */
const ELEVATION_SHADE_MAX = 0.2;
const ELEVATION_LIGHT_MAX = 0.1;
const ELEVATION_SHADE: Rgb = [18, 26, 48];
const ELEVATION_SUNLIT: Rgb = [255, 244, 214];

/**
 * Elevation shading for the whole ground layer, as one smoothly interpolated
 * wash instead of a per-tile fill.
 *
 * Elevation is a smooth field, but shading it a tile at a time quantises it
 * into flat rectangular plateaus — measured on a live frame, two adjacent
 * ground regions read 231,224,182 and 195,182,141, a uniform 0.84 multiply
 * with a hard rectangular boundary, which looks exactly like the "square and
 * ugly" tiling this whole pass is about. (The version before it, a per-tile
 * `globalAlpha` on the ground texture, had the same shape of bug.)
 *
 * So the field is rasterised once into a canvas ONE PIXEL PER TILE and then
 * blown up to map size with image smoothing deliberately turned on — the
 * browser's bilinear filter does the interpolation, in one drawImage, and
 * smoothing is restored afterwards so nothing else in the frame gets
 * filtered (it is off globally, on purpose: see main.ts). The small canvas is
 * cached per World, since elevation doesn't change over a world's life.
 */
const elevationShadeCache = new WeakMap<World, Partial<Record<Layer, HTMLCanvasElement>>>();
function drawElevationShade(ctx: CanvasRenderingContext2D, world: World): void {
  let perLayer = elevationShadeCache.get(world);
  if (!perLayer) {
    perLayer = {};
    elevationShadeCache.set(world, perLayer);
  }
  // Keyed by layer as well as by world: surface and underground are separate
  // tile arrays with their own elevations, and the world object is the same
  // for both, so a world-only key would show the cave the surface's relief.
  let small = perLayer[activeViewLayer];
  if (!small) {
    small = document.createElement("canvas");
    small.width = world.width;
    small.height = world.height;
    const sctx = small.getContext("2d")!;
    const image = sctx.createImageData(world.width, world.height);
    const tiles = world.tiles[activeViewLayer];
    for (let i = 0; i < world.width * world.height; i++) {
      // Two-sided, not just a shadow. High ground catches a warm light and
      // hollows fall into a cool one, which is what makes the source art's
      // terrain read as having FORM rather than being a flat plane with
      // darker patches on it. Centred on mid elevation so ordinary ground is
      // untouched and only real relief is picked out.
      const relief = tiles[i]!.elevation - ELEVATION_MID;
      const lit = relief > 0;
      const tint = lit ? ELEVATION_SUNLIT : ELEVATION_SHADE;
      const alpha = Math.min(1, Math.abs(relief) / ELEVATION_MID) * (lit ? ELEVATION_LIGHT_MAX : ELEVATION_SHADE_MAX);
      image.data[i * 4 + 0] = tint[0];
      image.data[i * 4 + 1] = tint[1];
      image.data[i * 4 + 2] = tint[2];
      image.data[i * 4 + 3] = Math.round(alpha * 255);
    }
    sctx.putImageData(image, 0, 0);
    perLayer[activeViewLayer] = small;
  }
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);
  ctx.imageSmoothingEnabled = smoothing;
}

/**
 * The ground, drawn for the whole visible grid BEFORE anything else, in two
 * passes: every tile's base, then every tile's scatter decal.
 *
 * Both the two-pass split and the separate loop are load-bearing. A decal is
 * drawn at its NATIVE size at a hash-jittered sub-tile offset — that is the
 * entire point, it's what stops the decal layer from being a lattice — so a
 * 32x24 decal overhangs its own tile. Drawn inside the main tile loop it
 * would be overpainted by the next tile's base a moment later, and the
 * overhang would only ever survive upward and leftward. Drawn here, after
 * every base is down, it survives in all four directions.
 */
function drawGroundLayer(ctx: CanvasRenderingContext2D, world: World): void {
  blitVisible(ctx, groundLayerCanvas(world), world);
  // The scatter passes stay LIVE, outside the cache: their contact shadows and
  // golden rim track the sun, and baking them would freeze both at whatever
  // hour the cache happened to be built. They cost ~3ms of the ~40ms this
  // whole layer used to take, so there is nothing to gain by freezing them.
  drawScatterPass(ctx, world, "scatter", SCATTER_ALPHA);
  // Landmarks go down after the fine detail so a boulder sits ON the tufts,
  // not under them.
  drawScatterPass(ctx, world, "feature", 1);
}

/**
 * The ground layer is STATIC, so it is rendered once into an offscreen canvas
 * and blitted from then on.
 *
 * Profiled at 113ms/frame, the per-tile base pass alone was 36.5ms — 32% of
 * the frame, spent redrawing identical pixels. Nothing it bakes depends on the
 * clock: the biome ground patch and the elevation field are functions of
 * position only. (The day colour grade and the contact
 * shadows DO move, so the scatter passes and the grade stay outside this
 * cache — see `drawGroundLayer`.)
 *
 * Cached per world and per layer, keyed by a signature over the one piece of
 * mutable state it reads — which tiles are "sand" terrain. Deliberately not a
 * hash of ALL terrain: crops grow and fires burn every tick, and that would
 * invalidate this every frame for changes it does not draw.
 */
/** Set by `drawGroundBacking` whenever it falls back for art that has not loaded — see its `else` branch. */
let groundArtPending = false;

const groundLayerCache = new WeakMap<World, Partial<Record<Layer, { signature: number; canvas: HTMLCanvasElement }>>>();

/** Hash of which tiles are "sand" — the only mutable input the ground layer reads. See `groundLayerCanvas`. */
function sandSignature(tiles: readonly Tile[]): number {
  let h = 2166136261;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i]!.terrain === "sand") h = Math.imul(h ^ i, 16777619);
  }
  return h >>> 0;
}

function groundLayerCanvas(world: World): HTMLCanvasElement {
  let perLayer = groundLayerCache.get(world);
  if (!perLayer) {
    perLayer = {};
    groundLayerCache.set(world, perLayer);
  }
  const signature = sandSignature(world.tiles[activeViewLayer]);
  const cached = perLayer[activeViewLayer];
  if (cached && cached.signature === signature) return cached.canvas;

  groundArtPending = false;
  const canvas = cached?.canvas ?? document.createElement("canvas");
  canvas.width = world.width * TILE_SIZE;
  canvas.height = world.height * TILE_SIZE;
  const gctx = canvas.getContext("2d")!;
  gctx.imageSmoothingEnabled = false;
  gctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      drawGroundBacking(gctx, world, x, y, world.tiles[activeViewLayer][y * world.width + x]!.elevation);
    }
  }
  drawElevationShade(gctx, world);
  // Only keep it once every tile drew real art; otherwise rebuild next frame.
  if (!groundArtPending) perLayer[activeViewLayer] = { signature, canvas };
  return canvas;
}

/**
 * One scatter pass over the whole grid — see `drawGroundLayer` for why decals
 * need a pass of their own, and `BIOME_FEATURES` (engine's decals.ts) for why
 * there are two.
 *
 * This reads `Tile.scatterDecal`/`featureDecal` rather than re-deriving a
 * hash. It used to hash, which meant the renderer and the engine disagreed
 * about what was on a tile — you could stand on a drawn log and be told there
 * was no deadwood — and it meant nothing could ever take a decal away.
 */
function drawScatterPass(ctx: CanvasRenderingContext2D, world: World, slot: DecalSlot, alpha: number): void {
  const view = culledBounds(world);
  for (let y = view.y0; y < view.y1; y++) {
    for (let x = view.x0; x < view.x1; x++) {
      const tile = tileAt(world, activeViewLayer, x, y);
      const id = slot === "scatter" ? tile?.scatterDecal : tile?.featureDecal;
      if (!id) continue;
      const decal = decalArt(id, x, y, slot);
      if (!decal) continue;
      const scale = TILE_SIZE / GROUND_CELL;
      const w = decal.image.width * scale;
      const h = decal.image.height * scale;
      // Bottom-anchored like every other standing art: a cactus three tiles
      // tall should have its base on its own tile, not be centred across the
      // two tiles above it.
      const dx = (x + decal.jitterX) * TILE_SIZE + (TILE_SIZE - w) / 2;
      const dy = (y + decal.jitterY + 1) * TILE_SIZE - h;
      // Per DECAL, not per layer — see `STANDING_DECALS` (sprites.ts). A fern
      // and a moss patch are both 32x32 and both in the fine pool, but only
      // one of them stands up.
      if (decal.standing) drawContactShadow(ctx, dx + w / 2, dy + h - TILE_SIZE * 0.1, Math.min(w, TILE_SIZE * 1.6));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(decal.image, dx, dy, w, h);
      ctx.restore();
      // Light lands on ground detail too. Skipping it here is why ferns, tufts
      // and the landmark decals stayed flat while the trees lit up — they are
      // drawn in this pass, not through `drawStandingSprite`. Direct report:
      // "Love it on the trees. But not seeing much on the bushes".
      drawGoldenRim(ctx, decal.image, decal.image.width, decal.image.height, dx, dy, w, h);
    }
  }
}

// Decal DENSITY moved to the engine (decals.ts's SCATTER_ONE_IN /
// FEATURE_ONE_IN) along with placement itself — the renderer no longer
// decides which tiles get a decal, it draws the ones the world says are
// there.
/** Slightly translucent so a decal reads as part of the ground rather than an object sitting on it — real objects (trees, boulders, crops) are drawn opaque later and need to stay distinguishable from ground detail. */
const SCATTER_ALPHA = 0.85;

/**
 * A low-opacity color wash for this tile's `groundType` — direct design
 * principle ("mechanics should be visible on the map, not hidden in a
 * meter") applied to the new soil/rock system: sandy/clay/rocky/peat each
 * read as a genuinely different-looking patch of ground, not just a
 * different number underneath the same dirt texture. "loam" (the default)
 * has no `GROUND_TYPE_TINT` entry, so this is a no-op for the overwhelming
 * majority of ordinary ground — deliberately subtle (low alpha) so it
 * reads as a color CAST over the real floor texture/decals already drawn,
 * not a flat paint-over.
 */
function drawGroundTypeTint(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number): void {
  const tint = GROUND_TYPE_TINT[tile.groundType ?? "loam"];
  if (!tint) return;
  ctx.fillStyle = rgbaToCss(tint, 0.16);
  ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}

/** Same idea as `drawGroundTypeTint` above, keyed by dominant biome instead of soil type — see `BIOME_TINT`'s own doc comment (palette.ts) for which biomes get one and why. */
function drawBiomeTint(ctx: CanvasRenderingContext2D, biome: string | undefined, x: number, y: number): void {
  const tint = biome ? BIOME_TINT[biome] : undefined;
  if (!tint) return;
  ctx.fillStyle = rgbaToCss(tint, 0.14);
  ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
}

/**
 * A pre-tinted copy of one obstacle sprite, built once on its own isolated
 * offscreen canvas and cached — see `BIOME_FLORA_TINT`'s own doc comment
 * (palette.ts) for the "one real sprite, several recolors" reasoning.
 * `source-atop`, run on a canvas that holds ONLY this one sprite (not the
 * whole scene), composites the tint exclusively over pixels the sprite
 * itself already painted — a tree's transparent corners stay transparent —
 * without needing to know or touch whatever's already on the real map
 * canvas underneath it. Same "build once, cache, `drawImage` from it every
 * frame" idiom `vignetteStamp`/`contiguousPatchStamp` above already use for
 * their own generated decals.
 */
const tintedSpriteCache = new Map<string, HTMLCanvasElement>();
function tintedSprite(sprite: HTMLImageElement, key: string, tint: Rgb): HTMLCanvasElement {
  const cacheKey = `${key}:${tint.join(",")}`;
  let cached = tintedSpriteCache.get(cacheKey);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  // The sprite's own pixel size, not a TILE_SIZE box — `drawStandingSprite`
  // does the fitting, and pre-squashing here would undo it.
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  const tctx = canvas.getContext("2d")!;
  tctx.drawImage(sprite, 0, 0);
  tctx.globalCompositeOperation = "source-atop";
  tctx.fillStyle = rgbaToCss(tint, 0.4);
  tctx.fillRect(0, 0, canvas.width, canvas.height);
  tintedSpriteCache.set(cacheKey, canvas);
  cached = canvas;
  return cached;
}

/**
 * A food/flora/seedling tile's own identity mark — real fruit emoji, real
 * berry-plant art, a growing sprout, or the muted fallback glyph. Called
 * once per crop tile, after `drawDayNightTint`, instead of inline in
 * `drawWorldTiles`'s own tile loop — see that loop's `cropIdentityTiles`
 * doc comment for the direct report and the root cause this fixes. Sets its
 * own `textAlign`/`textBaseline` since it now runs after the tile loop's
 * `ctx.restore()` un-sets the ones set at that loop's own top.
 */
function drawCropIdentity(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const plantSprite =
    tile.terrain === "food" && tile.flavor
      ? getFoodSprite(tile.flavor)
      : tile.terrain === "flora" && tile.flavor
        ? getFloraSprite(tile.flavor)
        : tile.terrain === "seedling"
          ? getSeedlingSprite(x, y)
          : null;
  const cropEmoji = tile.terrain === "food" && tile.flavor ? CROP_EMOJI[tile.flavor] : undefined;
  // Real growth-stage rendering (CROPS_DESIGN.md: a canopy Apple tree
  // "reading as 'growing' before 'ready to pick'") — a food tile placed
  // unripe (`worldgen.ts`'s canopy Apple placement, `stock: 0` with a real
  // `Tile.growth` counting up — see flora.ts's `growCanopyFood`) isn't
  // actually harvestable yet, so it shouldn't read as the same ready-to-eat
  // fruit emoji, just faded. A small sprout stands in for "still growing"
  // until `growCanopyFood` flips it over to real stock and clears `growth`,
  // at which point this tile falls straight through to the ordinary
  // `cropEmoji` branch.
  const unripe = tile.terrain === "food" && (tile.stock ?? 0) <= 0 && tile.growth !== undefined;
  if (cropEmoji && !unripe) {
    // Real emoji art for the 8 new crops (direct ask: "do them for tile
    // mode at least", then a direct follow-up: "I don't see eggs and crops
    // on the map. Can we make them very apparent emoji even in tile
    // mode?"). Checked BEFORE `plantSprite` (not just as its fallback) so a
    // crop's own real look is never a barely-there colored letter and never
    // quietly displaced if pixel art for one of these 8 flavors ever gets
    // added later — bigger than before, a higher opacity floor so a
    // low-stock patch still reads clearly instead of fading toward
    // invisible, and a soft dark backing disc so the emoji stays legible
    // against a bright grass tile the same way the egg emoji below does.
    ctx.save();
    const cropAlpha = tile.stock !== undefined ? 0.65 + 0.35 * tile.stock : 0.95;
    ctx.globalAlpha = cropAlpha;
    ctx.beginPath();
    ctx.ellipse(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE * 0.44, TILE_SIZE * 0.44, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fill();
    ctx.font = `${TILE_SIZE * 0.85}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    // Colour-emoji glyphs ignore fillStyle's colour but keep its alpha, so
    // the 0.22 backing fill above was also painting the crop at 22% (on top
    // of the deliberate stock fade). Direct report: "Why are all our emoji
    // sorta faded out opacity?" — this line was the answer. Opaque fill.
    ctx.fillStyle = "#fff";
    ctx.fillText(cropEmoji, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
    ctx.restore();
  } else if (plantSprite) {
    ctx.save();
    ctx.globalAlpha = tile.terrain === "seedling" ? 0.7 : 0.4 + (tile.stock ?? 1) * 0.6;
    // Berry plants are 21x34 — drawn into a TILE_SIZE square they were
    // squashed by a third and read as squat potted things. Same
    // stands-on-the-tile treatment trees and bushes get.
    drawStandingSprite(ctx, plantSprite, plantSprite.width, plantSprite.height, x, y);
    ctx.restore();
  } else if (unripe) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.font = `${TILE_SIZE * 0.55}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = "#fff"; // whatever translucent fill the tile loop left behind must not stack on the deliberate 0.55
    ctx.fillText("🌱", x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
    ctx.restore();
  } else {
    const accent = (tile.flavor && FLAVOR_FG[tile.flavor]) || TERRAIN_FG[tile.terrain];
    const glyph = (tile.flavor && FLAVOR_GLYPH[tile.flavor]) || TERRAIN_GLYPH[tile.terrain];
    // Same "fades back toward nothing as stock runs out" idea the real art
    // gets above, just applied to the glyph's own alpha instead of a
    // whole-tile color mix.
    const glyphAlpha = tile.stock !== undefined ? 0.3 + 0.5 * tile.stock : 0.55;
    ctx.save();
    ctx.font = `${TILE_SIZE * 0.55}px monospace, "Segoe UI Emoji", "Noto Color Emoji"`;
    ctx.fillStyle = rgbaToCss(accent, glyphAlpha);
    ctx.fillText(glyph, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
    ctx.restore();
  }
}

/**
 * A soft-edged version of a floor-decal image — the source crop is a
 * plain opaque square, so drawn as-is it reads as a hard-edged square
 * patch sitting on the base texture ("make decals a little less
 * square"). A first attempt masked it into a perfect circle (radial
 * gradient, destination-in), but that read as too geometric the other
 * way ("maybe too round... can we go half way or do some border
 * radius") — this masks it to a rounded-rectangle instead (roundRect,
 * corner radius a third of the tile) with a light blur on the mask edge
 * for a touch of softness, a middle ground between the hard square and
 * a full circle. Cached per source image — there are only a handful of
 * overlay crops total, reused across every tile that rolls that
 * variant, so this runs once per image ever, not once per tile per
 * frame.
 */
const featheredOverlayCache = new Map<HTMLImageElement, HTMLCanvasElement>();
function featheredOverlayStamp(img: HTMLImageElement): HTMLCanvasElement {
  const cached = featheredOverlayCache.get(img);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const octx = canvas.getContext("2d")!;
  octx.drawImage(img, 0, 0, TILE_SIZE, TILE_SIZE);
  octx.globalCompositeOperation = "destination-in";
  octx.filter = "blur(1.5px)";
  octx.beginPath();
  octx.roundRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2, TILE_SIZE / 3);
  octx.fillStyle = "black";
  octx.fill();
  featheredOverlayCache.set(img, canvas);
  return canvas;
}

/**
 * A rounded-rect stamp like `featheredOverlayStamp` above, but only
 * rounded on sides that DON'T continue into a matching neighbor tile —
 * direct ask: "fertile ground next to each other can be contiguous
 * grass." A run of adjacent fertile (food/flora/seedling) tiles should
 * read as one blended meadow, not a chain of independent isolated blobs;
 * the side(s) facing a matching neighbor are drawn flush to the tile edge
 * (radius 0, no inset) so two adjacent stamps butt up against each other
 * seamlessly, while any side facing something else still gets the usual
 * soft rounded edge. Canvas's 4-radius `roundRect` overload
 * ([topLeft, topRight, bottomRight, bottomLeft]) makes this a matter of
 * zeroing the two corners touching each open side, not a from-scratch
 * shape. Cached per (image, open-sides combo) — only 16 combos per image,
 * same "build once, reuse forever" shape as the plain stamp above.
 */
/** Whether this terrain kind gets the green fertile-patch decal at all — the "which neighbors count as continuing the same patch" check for `contiguousPatchStamp` below. */
function isFertileDecalTerrain(terrain: TerrainKind): boolean {
  return terrain === "food" || terrain === "flora" || terrain === "seedling";
}

let patchScratch: HTMLCanvasElement | undefined;
function contiguousPatchStamp(img: HTMLImageElement, openUp: boolean, openDown: boolean, openLeft: boolean, openRight: boolean, x: number, y: number): HTMLCanvasElement {
  if (!patchScratch) {
    patchScratch = document.createElement("canvas");
    patchScratch.width = TILE_SIZE;
    patchScratch.height = TILE_SIZE;
  }
  const octx = patchScratch.getContext("2d")!;
  octx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  octx.globalCompositeOperation = "source-over";
  octx.filter = "none";
  // The source is a multi-tile ground patch now, so it gets the same
  // world-space windowing every other ground draw uses — a run of fertile
  // tiles is continuous ground, not the same cell stamped repeatedly. Built
  // on a shared scratch canvas rather than cached per (image, sides), since
  // the right cell now depends on the tile.
  const sx = (x % GROUND_PATCH_CELLS) * GROUND_CELL;
  const sy = (y % GROUND_PATCH_CELLS) * GROUND_CELL;
  octx.drawImage(img, sx, sy, GROUND_CELL, GROUND_CELL, 0, 0, TILE_SIZE, TILE_SIZE);
  octx.globalCompositeOperation = "destination-in";
  octx.filter = "blur(2.5px)";
  const r = TILE_SIZE / 2.2;
  const left = openLeft ? 0 : 2;
  const top = openUp ? 0 : 2;
  const right = TILE_SIZE - (openRight ? 0 : 2);
  const bottom = TILE_SIZE - (openDown ? 0 : 2);
  octx.beginPath();
  octx.roundRect(left, top, right - left, bottom - top, [
    openUp || openLeft ? 0 : r, // top-left
    openUp || openRight ? 0 : r, // top-right
    openDown || openRight ? 0 : r, // bottom-right
    openDown || openLeft ? 0 : r, // bottom-left
  ]);
  octx.fillStyle = "black";
  octx.fill();
  return patchScratch;
}

/**
 * Procedural biome-floor edge blend — direct ask: "border edging around
 * different tiles to blend would be nice." Unlike water's shoreline
 * (`drawWaterLayer`), there's no dedicated hand-drawn edge art for a
 * desert-meets-cave or cave-meets-stone seam, so this generates the
 * transition instead of cropping one: a linear alpha gradient, strongest
 * at the tile edge and fading out over roughly 60% of the tile, masks the
 * NEIGHBOR's own floor texture before it's drawn on top of this tile's
 * base — same `destination-in` masking trick `featheredOverlayStamp`
 * already uses, just with a directional gradient instead of a rounded
 * rect. Two adjacent tiles on either side of a biome boundary each blend
 * the other's texture in from their own edge, so the seam becomes a real
 * two-tile-wide gradient rather than a hard cut. Gradients are cached per
 * direction (only 4 ever exist); the masked result is cached per
 * (texture image, direction) since there are only a handful of floor
 * textures total.
 */
type EdgeDirection = "up" | "down" | "left" | "right";
const EDGE_BLEND_REACH = 0.6; // fraction of the tile the gradient extends into
const edgeGradientCache = new Map<EdgeDirection, HTMLCanvasElement>();
function edgeGradientMask(direction: EdgeDirection): HTMLCanvasElement {
  const cached = edgeGradientCache.get(direction);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const gctx = canvas.getContext("2d")!;
  const reach = TILE_SIZE * EDGE_BLEND_REACH;
  const grad =
    direction === "left"
      ? gctx.createLinearGradient(0, 0, reach, 0)
      : direction === "right"
        ? gctx.createLinearGradient(TILE_SIZE, 0, TILE_SIZE - reach, 0)
        : direction === "up"
          ? gctx.createLinearGradient(0, 0, 0, reach)
          : gctx.createLinearGradient(0, TILE_SIZE, 0, TILE_SIZE - reach);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  edgeGradientCache.set(direction, canvas);
  return canvas;
}

/**
 * The neighbour's ground, masked to a one-directional fade. Not cached per
 * (image, direction) the way it used to be: the neighbour's ground is now a
 * multi-tile patch windowed in world space (see drawGroundBacking), so the
 * right source cell depends on the tile, and caching 6x6x4 stamps per texture
 * to avoid one drawImage on boundary tiles only isn't worth it. Reuses one
 * scratch canvas instead of allocating per call.
 */
let edgeScratch: HTMLCanvasElement | undefined;
function edgeBlendStamp(texture: HTMLImageElement, direction: EdgeDirection, x: number, y: number): HTMLCanvasElement {
  if (!edgeScratch) {
    edgeScratch = document.createElement("canvas");
    edgeScratch.width = TILE_SIZE;
    edgeScratch.height = TILE_SIZE;
  }
  const octx = edgeScratch.getContext("2d")!;
  octx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  octx.globalCompositeOperation = "source-over";
  const sx = (x % GROUND_PATCH_CELLS) * GROUND_CELL;
  const sy = (y % GROUND_PATCH_CELLS) * GROUND_CELL;
  octx.drawImage(texture, sx, sy, GROUND_CELL, GROUND_CELL, 0, 0, TILE_SIZE, TILE_SIZE);
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(edgeGradientMask(direction), 0, 0);
  return edgeScratch;
}

const EDGE_NEIGHBORS: readonly { dir: EdgeDirection; dx: number; dy: number }[] = [
  { dir: "up", dx: 0, dy: -1 },
  { dir: "down", dx: 0, dy: 1 },
  { dir: "left", dx: -1, dy: 0 },
  { dir: "right", dx: 1, dy: 0 },
];

/**
 * Draws a soft blend of each cardinal neighbor's floor texture onto this
 * tile wherever that neighbor's biome-driven ground art actually differs
 * (`getFloorBaseName`) — see the doc comment above `edgeGradientMask` for
 * why this is generated rather than real edge art. Skips a neighbor that's
 * "water" (its own full-tile opaque surface with a dedicated shoreline
 * system already) or off the map edge. Called from `drawGroundBacking`
 * for every ground tile, so a boulder or plant sitting right on a biome
 * boundary gets the same blended ground under it as plain floor does.
 */
function drawBiomeEdgeBlend(ctx: CanvasRenderingContext2D, world: World, x: number, y: number, elevation: number, ownBiome: string | undefined): void {
  const ownBase = getFloorBaseName(ownBiome);
  const surface = world.tiles[activeViewLayer];
  for (const { dir, dx, dy } of EDGE_NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
    const neighbor = surface[ny * world.width + nx]!;
    if (neighbor.terrain === "water") continue;
    const neighborBiome = dominantBiomeAt(world, nx, ny);
    if (getFloorBaseName(neighborBiome) === ownBase) continue;
    const neighborTexture = getGroundPatch(neighborBiome, activeViewLayer);
    if (!neighborTexture) continue;
    // Only ONE flowing blend per tile — direct ask, after seeing this
    // draw all 4 directions independently: "the gradient should flow in
    // one direction... painted in layers like decals... I'm seeing a lot
    // of cross gradient murkiness." A corner tile bordering two different
    // biomes (say highland above, badlands to the right) was drawing BOTH
    // directional gradients stacked on top of each other — two
    // semi-transparent layers of two different textures compositing at
    // the corner reads as a muddy cross, not a clean fade. Taking just
    // the first differing neighbor in a fixed, stable direction order
    // gives every tile a single directional fade instead, at the cost of
    // a true four-biome corner only showing one of its two real
    // boundaries — a real, deliberate trade for a much cleaner look.
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.82 + elevation * 0.18);
    ctx.drawImage(edgeBlendStamp(neighborTexture, dir, x, y), x * TILE_SIZE, y * TILE_SIZE);
    ctx.restore();
    return;
  }
}

/**
 * The water layer: every water tile on the map, drawn as ONE smoothed body
 * rather than tile by tile.
 *
 * Water is grid terrain, so a lake outline is always a run of 90-degree
 * steps, and a river that runs diagonally is a checkerboard of tiles that
 * touch only at their corners. Two per-tile attempts at this failed in ways
 * worth recording, because both looked plausible in code:
 * - Full square tiles: the outline is a literal staircase. On a map that is
 *   roughly half water this was the loudest thing on screen.
 * - Per-tile rounded/inset shapes, flush on water-facing sides and pulled
 *   back on land-facing ones: lakes came out fine, but every tile of a
 *   diagonal river has land on all four sides, so each one became a circle.
 *   With no bridging the run had gaps ("the rivers have holes in em"); with
 *   corner bridges it became a string of beads ("Looks like train tracks.
 *   Not contiguous.."). No per-tile rule can fix that, because per-tile is
 *   the problem: two diagonal tiles share a point, not an edge.
 *
 * So the shape is computed for the whole map at once. The water mask is
 * rasterised ONE PIXEL PER TILE, scaled up to map size with image smoothing
 * on (the browser's bilinear filter does the work), and thresholded. Any two
 * tiles that touch — orthogonally or diagonally — end up above the threshold
 * in between, so a diagonal run comes out as one continuous ribbon with a
 * smooth, non-grid outline, and so does a coastline. Same trick as
 * `drawElevationShade`, used for shape instead of shading.
 *
 * The whole composed layer is cached per animation frame, so a render frame
 * costs one drawImage; it is rebuilt only when the water actually changes
 * (drought, a dug spring), detected by hashing the water tiles.
 */
const WATER_THRESHOLD = 0.42;
/** Width of the threshold ramp, for an anti-aliased waterline instead of a jagged one. */
const WATER_EDGE_SOFT = 0.1;
/** Everything under this much mask coverage is shallows — the band between the waterline and open water. */
const WATER_SHALLOW_TO = 0.78;
const SHALLOW_ALPHA = 0.3;
const SHALLOW_TINT: Rgb = [214, 238, 246];

type WaterLayer = {
  signature: number;
  /** Alpha = how much of the smoothed body covers this pixel, already thresholded. */
  body: HTMLCanvasElement;
  /** Alpha = the shallows ring only. */
  shallow: HTMLCanvasElement;
  /** Alpha = per-tile depth darkening, smoothly interpolated and masked to the body. */
  depth: HTMLCanvasElement;
  frames: Map<number, HTMLCanvasElement>;
};

const waterLayerCache = new WeakMap<World, Partial<Record<Layer, WaterLayer>>>();

/** Cheap hash of which tiles are water, so the cached layer rebuilds when the map's water actually changes and not otherwise. */
function waterSignature(tiles: readonly Tile[]): number {
  let h = 2166136261;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i]!.terrain === "water") h = Math.imul(h ^ i, 16777619);
  }
  return h >>> 0;
}

function scratchCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Upscales a one-pixel-per-tile alpha field to map size with bilinear smoothing. */
function upscaleField(world: World, alphaAt: (index: number) => number): ImageData {
  const small = scratchCanvas(world.width, world.height);
  const sctx = small.getContext("2d")!;
  const image = sctx.createImageData(world.width, world.height);
  for (let i = 0; i < world.width * world.height; i++) image.data[i * 4 + 3] = alphaAt(i);
  sctx.putImageData(image, 0, 0);
  const big = scratchCanvas(world.width * TILE_SIZE, world.height * TILE_SIZE);
  const bctx = big.getContext("2d")!;
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(small, 0, 0, big.width, big.height);
  return bctx.getImageData(0, 0, big.width, big.height);
}

function buildWaterLayer(world: World, tiles: readonly Tile[], signature: number): WaterLayer {
  const width = world.width * TILE_SIZE;
  const height = world.height * TILE_SIZE;
  const coverage = upscaleField(world, (i) => (tiles[i]!.terrain === "water" ? 255 : 0));
  const depthField = upscaleField(world, (i) => {
    if (tiles[i]!.terrain !== "water") return 0;
    const x = i % world.width;
    // "Deep water is darker" — direct ask. Interpolated across the map for
    // the same reason elevation is: per-tile it quantises into flat squares.
    return Math.round(waterDepthFactor(world, { x, y: (i - x) / world.width }) * WATER_DEPTH_DARKEN_MAX * 255);
  });

  const body = scratchCanvas(width, height);
  const shallow = scratchCanvas(width, height);
  const depth = scratchCanvas(width, height);
  const bodyData = new ImageData(width, height);
  const shallowData = new ImageData(width, height);
  const depthData = new ImageData(width, height);
  for (let p = 0; p < width * height; p++) {
    const cover = coverage.data[p * 4 + 3]! / 255;
    const inside = Math.max(0, Math.min(1, (cover - WATER_THRESHOLD) / WATER_EDGE_SOFT));
    bodyData.data[p * 4 + 3] = Math.round(inside * 255);
    // Shallows fade out as coverage climbs toward open water.
    const shallowness = Math.max(0, Math.min(1, (WATER_SHALLOW_TO - cover) / (WATER_SHALLOW_TO - WATER_THRESHOLD)));
    shallowData.data[p * 4 + 0] = SHALLOW_TINT[0];
    shallowData.data[p * 4 + 1] = SHALLOW_TINT[1];
    shallowData.data[p * 4 + 2] = SHALLOW_TINT[2];
    shallowData.data[p * 4 + 3] = Math.round(inside * shallowness * SHALLOW_ALPHA * 255);
    depthData.data[p * 4 + 3] = Math.round(inside * (depthField.data[p * 4 + 3]! / 255) * 255);
  }
  body.getContext("2d")!.putImageData(bodyData, 0, 0);
  shallow.getContext("2d")!.putImageData(shallowData, 0, 0);
  depth.getContext("2d")!.putImageData(depthData, 0, 0);
  return { signature, body, shallow, depth, frames: new Map() };
}

/**
 * The composed water layer for one animation frame: the water texture tiled
 * across the map, masked to the smoothed body, then the depth wash and the
 * shallows ring.
 *
 * The texture is one repeating pattern for the whole map rather than a
 * per-tile phase-shifted sprite, which is what it used to be. That per-tile
 * phase was itself a grid artifact — adjacent tiles animated out of step, so
 * open water visibly shimmered in squares.
 */
function waterLayerFrame(layer: WaterLayer, frame: HTMLImageElement, index: number): HTMLCanvasElement | null {
  const cached = layer.frames.get(index);
  if (cached) return cached;
  const composed = scratchCanvas(layer.body.width, layer.body.height);
  const cctx = composed.getContext("2d")!;
  const pattern = cctx.createPattern(frame, "repeat");
  if (!pattern) return null;
  cctx.imageSmoothingEnabled = false;
  cctx.fillStyle = pattern;
  cctx.fillRect(0, 0, composed.width, composed.height);
  cctx.drawImage(layer.depth, 0, 0);
  cctx.drawImage(layer.shallow, 0, 0);
  cctx.globalCompositeOperation = "destination-in";
  cctx.drawImage(layer.body, 0, 0);
  layer.frames.set(index, composed);
  return composed;
}

/** Draws the whole water layer. Called once, between the ground and the tile loop. */
function drawWaterLayer(ctx: CanvasRenderingContext2D, world: World): void {
  const tiles = world.tiles[activeViewLayer];
  const index = currentWaterFrame();
  const frame = getWaterFrame();
  if (!frame || !frame.complete || frame.naturalWidth === 0) return;
  let perLayer = waterLayerCache.get(world);
  if (!perLayer) {
    perLayer = {};
    waterLayerCache.set(world, perLayer);
  }
  const signature = waterSignature(tiles);
  let layer = perLayer[activeViewLayer];
  if (!layer || layer.signature !== signature) {
    layer = buildWaterLayer(world, tiles, signature);
    perLayer[activeViewLayer] = layer;
  }
  const composed = waterLayerFrame(layer, frame, index);
  if (composed) blitVisible(ctx, composed, world);
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
/** Set by `facingOf` each frame: did this agent change tile since the last draw? Read by `walkFrameOf`. */
const movedThisFrame = new Map<string, boolean>();

function facingOf(agent: Agent): SpriteDirection {
  const prev = lastPos.get(agent.id);
  lastPos.set(agent.id, { x: agent.pos.x, y: agent.pos.y });
  movedThisFrame.set(agent.id, !!prev && (prev.x !== agent.pos.x || prev.y !== agent.pos.y));
  if (!prev) return lastFacing.get(agent.id) ?? "down";

  const dx = agent.pos.x - prev.x;
  const dy = agent.pos.y - prev.y;
  if (dx === 0 && dy === 0) return lastFacing.get(agent.id) ?? "down";

  const direction: SpriteDirection = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  lastFacing.set(agent.id, direction);
  return direction;
}

/**
 * Which walk frame an agent is on. Every species now has a standing pose and
 * one step frame per facing (see packages/web/scripts/rip_pokemon_frames.py),
 * so the cycle is simply stand/step alternating on each tile the agent
 * actually enters — the sim moves agents a whole tile at a time, so tile
 * changes ARE the footfalls, and driving the animation off a wall clock
 * instead would have everything paddling in place at the same rate regardless
 * of how fast it is really moving.
 *
 * An agent that has stopped settles back to standing rather than freezing
 * mid-stride, but the timeout is measured in MILLISECONDS, not render frames:
 * the canvas redraws at ~60fps while agents move on much slower sim ticks, so
 * a frame-counted timeout expired between every footfall and the step pose was
 * only ever on screen for a single frame — i.e. invisible.
 */
const walkPhase = new Map<string, { parity: number; lastMoveMs: number }>();
const WALK_REST_MS = 400;

function walkFrameOf(agent: Agent, moved: boolean): number {
  const now = performance.now();
  const state = walkPhase.get(agent.id) ?? { parity: 0, lastMoveMs: 0 };
  if (moved) {
    state.parity ^= 1;
    state.lastMoveMs = now;
  }
  walkPhase.set(agent.id, state);
  return now - state.lastMoveMs > WALK_REST_MS ? 0 : state.parity;
}

/** Drops facing/position memory for agent ids no longer in the world (dead, despawned) so the maps don't grow forever. */
function pruneStaleFacings(world: World): void {
  const liveIds = new Set(world.agents.map((a) => a.id));
  for (const id of lastPos.keys()) {
    if (!liveIds.has(id)) {
      lastPos.delete(id);
      lastFacing.delete(id);
      renderPos.delete(id);
      walkPhase.delete(id);
      movedThisFrame.delete(id);
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
/**
 * Which `Layer` this frame draws — ROADMAP.md M1. The renderer was hard-wired
 * to `surface` at ten sites (tiles, agents, highlights, fire glow, hit-test);
 * an agent underground "simply isn't drawn" (see `drawAgent`'s doc comment
 * history). A cave player has to be drawn, so `drawWorld` takes the layer
 * and every pass reads it from here. Module state rather than a threaded
 * parameter because six helpers would otherwise gain a pass-through arg for
 * one value that is constant for the whole frame; `agentAtCanvasPos` reads
 * the same value so clicks resolve on the layer the eye is looking at.
 */
let activeViewLayer: Layer = "surface";

/**
 * The player's field of view for this frame, or undefined in the spectator
 * app (no player, nothing hidden) — ROADMAP.md M2. Read once per frame here
 * and threaded through the two passes that care (agents, fog) rather than
 * looked up per tile: `findPlayer` is a linear scan of `world.agents`.
 */
function playerVision(world: World): Vision | undefined {
  return findPlayer(world)?.vision;
}

/** Whether the frame's viewer can see tile `(x, y)` on the active layer. */
function tileVisible(world: World, vision: Vision | undefined, x: number, y: number): boolean {
  return !vision || vision.visible.has(y * world.width + x);
}

/**
 * Fog of war, drawn over the ground and under everything alive (agents,
 * crop emoji), exactly where `drawDayNightTint` sits: a tile never seen is
 * solid dark; a tile seen before but not now is drawn dimmed — the memory
 * of the map, with nothing alive on it (agents and crop identity on unseen
 * tiles are never drawn at all, see those passes). Underground,
 * tiles the player can see but that no sunbeam lights get a lighter wash
 * too, so the chamber reads as *lit* and the corridor as merely *seen*.
 */
function drawFog(ctx: CanvasRenderingContext2D, world: World, vision: Vision | undefined): void {
  if (!vision) return;
  const explored = vision.explored[activeViewLayer];
  const underground = activeViewLayer !== "surface";
  ctx.save();
  const view = culledBounds(world);
  for (let y = view.y0; y < view.y1; y++) {
    for (let x = view.x0; x < view.x1; x++) {
      const idx = y * world.width + x;
      if (vision.visible.has(idx)) {
        if (!underground || isLitTile(world, activeViewLayer, { x, y })) continue;
        ctx.fillStyle = "rgba(4, 6, 16, 0.32)";
      } else if (explored?.has(idx)) {
        ctx.fillStyle = "rgba(4, 6, 14, 0.66)";
      } else {
        ctx.fillStyle = "#05060a";
      }
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.restore();
}

/**
 * The slice of the map actually on screen, in TILES, set once per frame by
 * main.ts from the scroll container and the zoom factor.
 *
 * The canvas is the whole world at TILE_SIZE per tile — 1800x1200 for a 90x60
 * map — and `#canvas-wrap` scrolls it while CSS scales it. So every frame used
 * to paint all 5400 tiles regardless of the handful actually visible. The
 * browser only COMPOSITES the visible part; it does not skip the paint.
 *
 * Margins are generous on purpose. Standing sprites are bottom-anchored and up
 * to 1.7 tiles tall, scatter decals jitter half a tile in each direction, and a
 * cactus is four tiles tall — anything whose tile is off-screen can still have
 * art reaching onto it, so the loop bounds are grown well past the strict rect
 * rather than clipping something's head off at the edge.
 */
let visibleRect: { x0: number; y0: number; x1: number; y1: number } | undefined;

/** Tiles of slack around the visible rect — see `visibleRect`. Top gets more because tall art is drawn upward from its own tile. */
const CULL_MARGIN = 3;
const CULL_MARGIN_TOP = 6;

/** Called by main.ts each frame with the scroll container's rect in CANVAS pixels. `undefined` disables culling (used by anything that renders the whole map at once). */
export function setVisibleRect(rect: { left: number; top: number; width: number; height: number } | undefined): void {
  visibleRect = rect
    ? {
        x0: Math.floor(rect.left / TILE_SIZE) - CULL_MARGIN,
        y0: Math.floor(rect.top / TILE_SIZE) - CULL_MARGIN_TOP,
        x1: Math.ceil((rect.left + rect.width) / TILE_SIZE) + CULL_MARGIN,
        y1: Math.ceil((rect.top + rect.height) / TILE_SIZE) + CULL_MARGIN,
      }
    : undefined;
}

/** The tile range to iterate for `world`, clamped to the map and to `visibleRect`. */
function culledBounds(world: World): { x0: number; y0: number; x1: number; y1: number } {
  const r = visibleRect;
  return {
    x0: Math.max(0, r ? r.x0 : 0),
    y0: Math.max(0, r ? r.y0 : 0),
    x1: Math.min(world.width, r ? r.x1 : world.width),
    y1: Math.min(world.height, r ? r.y1 : world.height),
  };
}

/** Whether a tile is inside the culled range — for the per-agent check, where there is no loop to bound. */
function inView(x: number, y: number): boolean {
  const r = visibleRect;
  return !r || (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1);
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  selectedAgentId: string | undefined,
  style: RenderStyle = "tile",
  autoCamHighlightIds?: ReadonlySet<string>,
  /**
   * Every OTHER currently-tracked battle's id set — drawn as a dimmer, more
   * sparsely-dashed box alongside `autoCamHighlightIds`'s own solid-following
   * one. Direct ask: "draw the yellow bounding box anyways on all cool
   * events happening around the map [while not on auto cam mode]" — see
   * `autoCamera.ts`'s `listBattleEngagements` for why this is always
   * populated (detection now runs regardless of Auto Camera's on/off
   * toggle) and scoped to battles only, not every notable one-shot.
   */
  passiveHighlights?: readonly ReadonlySet<string>[],
  /** Ids of agents that used a move recently enough to still be jiggling — see moveEffects.ts's `MoveEffects.jigglingAgentIds`. */
  jigglingAgentIds?: ReadonlySet<string>,
  /**
   * Every member of the herd/species the viewer clicked in the inspector —
   * direct ask: "clicking on herd name or species should auto zoom to them
   * and highlight them on the map." Drawn distinctly from the yellow
   * battle boxes (see `drawGroupHighlight`) because it answers a different
   * question: those say "something is happening here", this says "these are
   * the ones you asked about."
   */
  focusGroupIds?: ReadonlySet<string>,
  /** The layer to draw — the player's own in player mode, `surface` otherwise. See `activeViewLayer`. */
  viewLayer: Layer = "surface"
): void {
  activeViewLayer = viewLayer;
  // Always advance the animation clock, even in ASCII mode (which ignores
  // `dt` entirely) — so switching from ASCII back to tile mode doesn't hand
  // `interpolatedPos` one huge accumulated `dt` and produce a visible warp.
  const dt = frameDeltaSeconds();
  if (style === "ascii") return drawWorldAscii(ctx, world, selectedAgentId);
  return drawWorldTiles(ctx, world, selectedAgentId, dt, autoCamHighlightIds, passiveHighlights, jigglingAgentIds, focusGroupIds);
}

function drawWorldTiles(
  ctx: CanvasRenderingContext2D,
  world: World,
  selectedAgentId: string | undefined,
  dt: number,
  autoCamHighlightIds?: ReadonlySet<string>,
  passiveHighlights?: readonly ReadonlySet<string>[],
  jigglingAgentIds?: ReadonlySet<string>,
  focusGroupIds?: ReadonlySet<string>
): void {
  const surface = world.tiles[activeViewLayer];
  // Collected while walking the tile grid below, drawn in a second pass
  // after `drawDayNightTint` — see `drawCropIdentity`'s own doc comment.
  const cropIdentityTiles: { x: number; y: number; tile: Tile }[] = [];

  // Set once per frame, read by drawContactShadow/drawGoldenRim.
  sunHeight = activeViewLayer === "surface" ? lightLevel(world.tick) : 0;
  const tint = activeViewLayer === "surface" ? dayTint(world.tick) : ([255, 255, 255] as Rgb);
  goldenAmount = Math.max(0, Math.min(1, (tint[0] - tint[2]) / 120));

  ctx.fillStyle = rgbToCss(TERRAIN_BG.floor);
  fillVisible(ctx, world);
  drawGroundLayer(ctx, world);
  drawWaterLayer(ctx, world);

  ctx.save();
  // Emoji fonts appended as fallback, not a replacement — plain ASCII
  // terrain glyphs still render via "monospace" same as always; only a
  // character "monospace" itself can't draw (a crop emoji, see
  // CROP_EMOJI below) falls through to these.
  ctx.font = `${TILE_SIZE * 0.55}px monospace, "Segoe UI Emoji", "Noto Color Emoji"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const view = culledBounds(world);
  for (let y = view.y0; y < view.y1; y++) {
    for (let x = view.x0; x < view.x1; x++) {
      const tile = surface[y * world.width + x]!;
      // Plain floor is the overwhelming majority of the map — a loud solid
      // fill (and elevation shading turning it increasingly bright) per
      // tile drowns out everything that's actually interesting. Render it
      // as a faint "." on the near-transparent base instead, same idea as
      // a roguelike's open ground, deliberately ignoring elevation shading
      // (which is still visible on every non-floor terrain).
      if (tile.terrain === "floor") {
        // The ground texture itself is already down — `drawGroundLayer`
        // painted every tile's base plus the off-grid scatter decals before
        // this loop started (see its doc comment for why it has to be a
        // separate pass). Only the per-tile tints and the faint glyph are
        // left to do here.
        drawGroundTypeTint(ctx, tile, x, y);
        drawBiomeTint(ctx, dominantBiomeAt(world, x, y), x, y);
        ctx.fillStyle = rgbaToCss(shade([120, 128, 140], tile.elevation), 0.35);
        ctx.fillText(".", x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2);
          continue;
      }

      // Water is not drawn per tile at all — `drawWaterLayer` already put
      // the whole body down over the ground, before this loop. See its doc
      // comment for why it cannot be a per-tile shape.
      if (tile.terrain === "water") continue;

      // Real tile art (see sprites.ts's getTileSprite) takes priority when it
      // exists for this terrain kind. "shelter" keeps its dynamic per-owner
      // tint and "food"/"flora"/"seedling" get the muted glyph-on-faint-wash
      // treatment right below instead — neither has a fixed piece of art to
      // swap in — so those always fall through here regardless of art
      // availability.
      // "sand" terrain is ground, and `drawGroundLayer` already painted it —
      // see drawGroundBacking's own note on why it cannot be drawn here.
      if (tile.terrain === "sand") {
          continue;
      }

      if (tile.terrain !== "shelter" && tile.terrain !== "food" && tile.terrain !== "flora" && tile.terrain !== "seedling") {
        const sprite = getTileSprite(tile.terrain, x, y);
        if (sprite) {
          // Boulders/trees/bushes/walls are all small icons with transparent
          // corners, not full-tile-opaque art — ground needs to show through
          // those corners instead of the near-black canvas base. "water" is
          // its own full-tile opaque surface, not an object standing on
          // ground, so it's excluded.
          // Biome-flavored recolor for tree/bush only (see BIOME_FLORA_TINT's
          // own doc comment, palette.ts) — boulder/wall/sand/mud already read
          // fine as plain, and a recolored rock/wall would just look wrong.
          const floraTint = (tile.terrain === "tree" || tile.terrain === "bush") && BIOME_FLORA_TINT[dominantBiomeAt(world, x, y) ?? ""];
          if (floraTint) {
            // Keyed by the sprite's own image URL (e.g. "/tiles/tree_3.png"),
            // NOT by (x, y) — the underlying art only has a handful of real
            // variants (`TILE_VARIANT_COUNTS`, sprites.ts), so this caches at
            // most a few tinted copies total, reused across every tile that
            // happens to roll the same variant, instead of one cache entry
            // per map tile ever drawn.
            const tinted = tintedSprite(sprite, sprite.src, floraTint);
            drawStandingSprite(ctx, tinted, tinted.width, tinted.height, x, y);
          } else {
            // A tiling surface texture far bigger than a tile (mud is
            // 128x128, wall 144x144) gets a tile-sized window drawn 1:1
            // instead of the whole image squashed down — full fidelity, and a
            // different crop per tile so the terrain stops repeating. See
            // sprites.ts's `tileWindow`; null for object icons like trees,
            // which are drawn whole however big their art is.
            const win = tileWindow(sprite, tile.terrain, x, y, TILE_SIZE);
            if (win) {
              ctx.drawImage(sprite, win.sx, win.sy, TILE_SIZE, TILE_SIZE, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            } else {
              drawStandingSprite(ctx, sprite, sprite.width, sprite.height, x, y);
            }
          }
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
        // Real ground texture underneath comes from `drawGroundLayer`'s
        // whole-grid pass, not from here — same "black behind transparent
        // corners" fix as boulders/trees/etc. above, since the real
        // berry-plant art (below) also has transparent corners.
        drawGroundTypeTint(ctx, tile, x, y);
        drawBiomeTint(ctx, dominantBiomeAt(world, x, y), x, y);

        // A green "fertile ground" patch under the plant itself — direct
        // ask: "can we decal a little green patch under the plants...
        // simulate the ground underneath the plants becoming fertile...
        // with intermediate states." Opacity tracks the tile's real
        // `fertility` (flora.ts) so a freshly-harvested, still-recovering
        // patch reads as faint and a fully-fertile one as vivid — the
        // actual mechanic, not a stand-in.
        const fertilePatch = getFertilePatch();
        if (fertilePatch) {
          const fertility = tile.fertility ?? 1;
          // Direct ask: "fertile ground next to each other can be
          // contiguous grass" — a run of adjacent fertile tiles reads as
          // one blended meadow instead of independent isolated blobs (see
          // contiguousPatchStamp's own doc comment for how). "Open" means
          // a same-decal neighbor continues the patch in that direction,
          // so that side is drawn flush instead of rounded.
          const openUp = y > 0 && isFertileDecalTerrain(surface[(y - 1) * world.width + x]!.terrain);
          const openDown = y < world.height - 1 && isFertileDecalTerrain(surface[(y + 1) * world.width + x]!.terrain);
          const openLeft = x > 0 && isFertileDecalTerrain(surface[y * world.width + (x - 1)]!.terrain);
          const openRight = x < world.width - 1 && isFertileDecalTerrain(surface[y * world.width + (x + 1)]!.terrain);
          ctx.save();
          ctx.globalAlpha = 0.18 + fertility * 0.42;
          ctx.drawImage(contiguousPatchStamp(fertilePatch, openUp, openDown, openLeft, openRight, x, y), x * TILE_SIZE, y * TILE_SIZE);
          ctx.restore();
        }

        // Real berry-plant art (see sprites.ts's getFoodSprite/getFloraSprite/
        // getSeedlingSprite) is the primary visual when it exists — faded by
        // the tile's own stock so a nearly-depleted patch still reads as
        // thinning out, not popping in/out. Falls back to the muted
        // glyph-on-faint-wash treatment below only when there's no real art
        // for this flavor (or none assigned yet) — same "match the ascii,
        // don't fill the whole tile with a loud color" reasoning as before,
        // just as a fallback now instead of the only option.
        // The crop's own identity mark (real fruit emoji, plant sprite, growth
        // sprout, or fallback glyph) is drawn in a later pass, after
        // `drawDayNightTint` — see `drawCropIdentity` below for why: direct
        // report: "Crops and eggs are still hard to see... behind the tiles?"
        // Root cause, found by instrumenting real fillText calls against a
        // live dev server: the mark rendered here, inline in this loop, was
        // real (confirmed 243/256 green pixels sampled right after the
        // `fillText` call) but then silently got dimmed toward invisible by
        // `drawDayNightTint`'s whole-canvas night wash, which runs *after*
        // this loop — exactly the treatment Pokémon are already deliberately
        // exempted from ("Pokémon should always read at full brightness
        // regardless of time of day", `drawAgent`'s own call site below).
        // Crops never got that same exemption. Since this demo world's tick 0
        // is midnight, that dimming was in effect from the very first frame.
        cropIdentityTiles.push({ x, y, tile });
          continue;
      }

      const bg = tile.terrain === "shelter" ? shade(shelterOwnerTint(TERRAIN_BG.shelter, tile.shelterOwnerSpecies), tile.elevation) : terrainBgColor(tile.terrain, tile.elevation);
      ctx.fillStyle = rgbToCss(bg);
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.restore();

  // One blit for the whole ambient vignette, where there used to be one
  // drawImage per tile — see `drawVignetteLayer`. Drawn after the tile loop so
  // it still sits ON TOP of the terrain art, exactly where the per-tile
  // version did.
  drawVignetteLayer(ctx, world);

  // Night darkening applies to the ground only, drawn before agents step in
  // on top of it — Pokémon should always read at full brightness regardless
  // of time of day, not get dimmed along with the terrain underneath them.
  drawDayNightTint(ctx, world);
  // Fog is ground, same as the night tint: it goes under everything alive.
  // It used to run after agents and crops, and its "seen but unlit" wash
  // sat on top of every emoji and sprite in the cave — direct report: "Why
  // are all our emoji sorta faded out opacity? Want em on top."
  const vision = playerVision(world);
  drawFog(ctx, world, vision);

  // Crops get that same "always legible" treatment as agents (see
  // `cropIdentityTiles`'s own doc comment above for the root cause this
  // fixes) — drawn now, on top of the night tint, instead of back in the
  // tile loop where the tint would wash over them. Only on tiles the
  // player can see right now: a remembered tile is a memory of ground, not
  // a live view of what grows there.
  for (const { x, y, tile } of cropIdentityTiles) {
    if (tileVisible(world, vision, x, y)) drawCropIdentity(ctx, tile, x, y);
  }

  pruneStaleFacings(world);
  for (const agent of world.agents) {
    if (agent.layer !== activeViewLayer) continue;
    // Off-screen agents are skipped before anything else — see `visibleRect`.
    if (!inView(agent.pos.x, agent.pos.y)) continue;
    // Out of sight is out of the frame entirely — not dimmed, absent. A
    // Sandshrew you cannot see is not there yet.
    if (!tileVisible(world, vision, agent.pos.x, agent.pos.y)) continue;
    drawAgent(ctx, agent, agent.id === selectedAgentId, dt, jigglingAgentIds?.has(agent.id) ?? false);
  }

  drawWarmLights(ctx, world);
  drawWeather(ctx, world);

  if (autoCamHighlightIds && autoCamHighlightIds.size > 0) drawAutoCamHighlight(ctx, world, autoCamHighlightIds);
  if (passiveHighlights) {
    for (const ids of passiveHighlights) {
      // Skip whatever's already got the solid, actively-followed box above —
      // this loop is only for the OTHER battles the viewer isn't currently
      // looking at.
      if (autoCamHighlightIds && setsShareAnId(ids, autoCamHighlightIds)) continue;
      drawPassiveHighlight(ctx, world, ids);
    }
  }
  // Last of the three, so the group the viewer explicitly asked to see is
  // never drawn under a battle box it happens to overlap.
  if (focusGroupIds && focusGroupIds.size > 0) drawGroupHighlight(ctx, world, focusGroupIds);

  if (selectedAgentId) {
    const selected = world.agents.find((a) => a.id === selectedAgentId);
    if (selected && selected.layer === activeViewLayer) {
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
  const surface = world.tiles[activeViewLayer];

  ctx.fillStyle = "#08090c";
  ctx.fillRect(0, 0, world.width * TILE_SIZE, world.height * TILE_SIZE);

  ctx.save();
  ctx.font = `${TILE_SIZE * 0.68}px ui-monospace, "SF Mono", Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const vision = playerVision(world);
  const agentAt = new Map<string, Agent>();
  for (const agent of world.agents) {
    if (agent.layer !== activeViewLayer) continue;
    if (!tileVisible(world, vision, agent.pos.x, agent.pos.y)) continue;
    agentAt.set(`${agent.pos.x},${agent.pos.y}`, agent);
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
        // "water" gets its own body-size-based depth darkening instead of
        // elevation shading — see `waterDepthShade`'s doc comment for why
        // elevation carries no usable depth signal for water tiles.
        const bg =
          tile.terrain === "water"
            ? waterDepthShade(TERRAIN_BG.water, waterDepthFactor(world, { x, y }))
            : tile.terrain === "shelter"
              ? shade(shelterOwnerTint(TERRAIN_BG.shelter, tile.shelterOwnerSpecies), tile.elevation)
              : terrainBgColor(tile.terrain, tile.elevation);
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
  // Under the glyphs, same as in tile mode — see drawWorldTiles.
  drawFog(ctx, world, vision);

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

  if (agent.controlledBy === "player") {
    // The player is 👱 in both render styles — see drawAgent's own branch.
    ctx.font = `${TILE_SIZE * 1.0}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = "#fff"; // the halo's 0.28-alpha fill would otherwise apply to the emoji
    ctx.fillText("👱", cx, cy);
  } else {
    const letter = agent.species.charAt(0).toUpperCase();
    ctx.font = `bold ${TILE_SIZE * 0.78}px ui-monospace, "SF Mono", Consolas, monospace`;
    ctx.fillStyle = rgbToCss(color);
    ctx.fillText(letter, cx, cy);
  }
  ctx.restore();

  if (isSelected) {
    ctx.save();
    ctx.strokeStyle = "#ffe066";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - TILE_SIZE / 2 + 1, cy - TILE_SIZE / 2 + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.restore();
  }
}

/** Cheap deterministic per-id phase (0..2π) so several agents jiggling at once don't all shake in lockstep. */
function idPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000 * Math.PI * 2;
}

function drawAgent(ctx: CanvasRenderingContext2D, agent: Agent, isSelected: boolean, dt: number, jiggling: boolean): void {
  const pos = interpolatedPos(agent, dt);
  const px = pos.x * TILE_SIZE;
  const py = pos.y * TILE_SIZE;
  // Direct ask: "make the tile/sprite sorta jiggle when its using a move" —
  // a small, fast shake applied only to the sprite/fallback draw below (not
  // the drop shadow, which stays pinned to the tile so the shake reads as
  // the body moving above a fixed ground contact point, not the whole tile
  // sliding around).
  let jitterX = 0;
  let jitterY = 0;
  if (jiggling) {
    const t = performance.now() / 35 + idPhase(agent.id);
    jitterX = Math.sin(t) * TILE_SIZE * 0.07;
    jitterY = Math.cos(t * 1.3) * TILE_SIZE * 0.04;
  }
  const def = SPECIES[agent.species];
  const direction = facingOf(agent);
  // `def` only exists for the small hand-curated roster (species.ts) — an
  // evolved mid-stage form reachable purely through leveling (e.g. Ivysaur,
  // Wartortle) has no entry there at all, even though its own sprite files
  // exist (public/sprites/ivysaur_*.png etc.) and every curated entry's own
  // spriteKey is just its lowercased species name anyway (leveling.ts's
  // `Agent.species` doc comment: always the lowercased dex key, the same
  // convention sprite filenames use). Falling back to `agent.species`
  // itself here — rather than dropping straight to the letter fallback —
  // lets any species with real art render it, curated or not; getSprite
  // already degrades to null (and drawAgent to the letter) for a species
  // with genuinely no art.
  // A human resolves to one of the ripped trainer sprites (by archetype, or
  // the player's own character) rather than to `def.spriteKey` — "human" has
  // no art in the Pokemon sheet. See sprites.ts's `humanSpriteKey`.
  const spriteKey =
    agent.species === "human"
      ? humanSpriteKey(agent.controlledBy === "player", agent.archetype)
      : (def?.spriteKey ?? agent.species);
  const sprite = getSprite(spriteKey, direction, walkFrameOf(agent, movedThisFrame.get(agent.id) ?? false));
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

  if (agent.isEgg) {
    // Direct ask: "I don't see eggs and crops on the map. Can we make them
    // very apparent emoji even in tile mode?" Root cause: an egg is a real
    // `Agent` with `isEgg: true` and its eventual hatchling's own
    // `species` already set (eggs.ts), so before this it fell straight
    // into the ordinary `sprite`/letter-fallback branch below and rendered
    // as a full-grown Bulbasaur sprite walking around — nothing about it
    // read as "egg" at all. A big, unmistakable 🥚 on a soft dark backing
    // circle (so it still reads against a light grass tile) takes priority
    // over every other branch here.
    ctx.beginPath();
    ctx.ellipse(px + TILE_SIZE / 2 + jitterX, py + TILE_SIZE / 2 + jitterY, TILE_SIZE * 0.42, TILE_SIZE * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fill();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${TILE_SIZE * 0.85}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = "#fff"; // the backing circle's 0.28 alpha would otherwise apply to the egg — see the player branch
    ctx.fillText("🥚", px + TILE_SIZE / 2 + jitterX, py + TILE_SIZE / 2 + jitterY);
  } else if (agent.controlledBy === "player" && !sprite) {
    // Fallback only, now that real trainer art exists (see `humanSpriteKey`):
    // this still draws for the frame or two before the PNG finishes loading,
    // and if the file is ever missing.
    // Direct ask: "change the player icon to a 👱 emoji." The human has no
    // sprite art, and the letter fallback read as one more glyph among
    // the terrain. Same backing-circle treatment as the egg so it holds up
    // on a light tile and under fog.
    // Drawn at sprite scale, not tile scale — at 17px on a 20px tile it
    // read as a smudge next to the oversized Pokémon sprites ("Its still
    // not visible"). Bottom-anchored like a sprite so the feet sit on the
    // tile, on a solid dark disc with a white ring so it holds against
    // any ground and under fog.
    const cx = px + TILE_SIZE / 2 + jitterX;
    const cy = py + TILE_SIZE * 0.45 + jitterY;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE * 0.68, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${TILE_SIZE * 1.15}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    // Colour-emoji glyphs ignore fillStyle's colour but KEEP its alpha —
    // the translucent disc fill above would paint the face at 55%. Direct
    // report: "It's still semi transparent." Opaque fill before every emoji.
    ctx.fillStyle = "#fff";
    ctx.fillText("👱", cx, cy);
  } else if (agent.species === "human" && !sprite) {
    // Fallback only — real per-archetype trainer art is the normal path now.
    // A wild/NPC human — direct ask: "make humans spawn with different
    // types... Should also have sex and that should affect which emoji
    // you choose for them." Same backing-disc treatment as the player
    // branch above (no sprite art exists for "human" either), keyed by
    // `agent.archetype` (immigration.ts's `assignHumanArchetype`) and
    // `agent.sex`. No official gendered variant for the ninja emoji, so
    // hunter reads the same either way.
    const cx = px + TILE_SIZE / 2 + jitterX;
    const cy = py + TILE_SIZE * 0.45 + jitterY;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE_SIZE * 0.68, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${TILE_SIZE * 1.15}px "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.fillText(HUMAN_ARCHETYPE_EMOJI[agent.archetype ?? "wanderer"][agent.sex === "female" ? "female" : "male"], cx, cy);
  } else if (sprite) {
    // Bigger than one tile (see SPRITE_SCALE) and bottom-anchored so the
    // sprite's feet sit on its actual tile instead of the whole thing being
    // centered/squished into TILE_SIZE. No canvas mirroring needed — see
    // getSprite's doc comment: "_left"/"_right" are genuine, correctly
    // mirrored art once you load the (swapped) right file for each
    // direction, so the plain source image is already correctly oriented.
    const w = TILE_SIZE * SPRITE_SCALE;
    const h = TILE_SIZE * SPRITE_SCALE;
    const dx = px + TILE_SIZE / 2 - w / 2 + jitterX;
    const dy = py + TILE_SIZE - h + jitterY;
    // A corpse lies on the ground rather than standing on it, so it gets no
    // contact shadow — the shadow is what says "this thing is upright".
    if (!isCorpse) drawContactShadow(ctx, px + TILE_SIZE / 2 + jitterX, py + TILE_SIZE - TILE_SIZE * 0.14 + jitterY, TILE_SIZE);
    ctx.drawImage(sprite, dx, dy, w, h);
    drawGoldenRim(ctx, sprite, sprite.width, sprite.height, dx, dy, w, h);
  } else {
    const primaryType = agent.types?.[0];
    const fill = isCorpse ? [90, 90, 90] : primaryType ? TYPE_COLOR[primaryType] : ([200, 200, 200] as const);
    ctx.fillStyle = rgbToCss(fill as [number, number, number]);
    ctx.fillRect(px + 2 + jitterX, py + 2 + jitterY, TILE_SIZE - 4, TILE_SIZE - 4);
    ctx.fillStyle = "#0d0d0d";
    ctx.font = `${TILE_SIZE * 0.6}px monospace`;
    ctx.fillText((def?.name ?? agent.species)[0]!, px + TILE_SIZE * 0.22 + jitterX, py + TILE_SIZE * 0.75 + jitterY);
  }

  if (agent.fainted && !isCorpse) {
    ctx.fillStyle = "#fff";
    ctx.font = `${TILE_SIZE * 0.5}px monospace`;
    ctx.fillText("z", px + TILE_SIZE * 0.55, py + TILE_SIZE * 0.4);
  }

  ctx.restore();

  if (agent.notableTitle && !isCorpse) drawNotableStar(ctx, px, py);
  if (isSelected) drawSelectionRing(ctx, px, py);
}

/**
 * A small persistent star at a notable's upper right — direct ask:
 * "notables on zone map should have a persistent star above their heads,
 * small, to the right to show they are special."
 *
 * Persistent is the operative word, and it is why this is drawn here rather
 * than reusing the popup/flash machinery: everything else that marks an
 * agent on this map is transient (a move flash, an event popup, a battle
 * box) and disappears within a second or two. A title is a permanent fact
 * about an animal, so its mark has to survive being looked at.
 *
 * Hand-drawn as a path rather than a "*" glyph or an emoji: at this size a
 * text star renders differently on every platform and an emoji star brings
 * its own colour, which fights the type-coloured sprites underneath. A
 * stroked path also gets a dark outline for free, which is what keeps it
 * legible over both a snow tile and a night-shaded forest one.
 *
 * Corpses are skipped — `Agent.notableTitle` is not cleared on death (the
 * chronicle still wants to know who this was), but a star floating over a
 * body reads as a live marker.
 */
function drawNotableStar(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  const cx = px + TILE_SIZE * 0.80;
  const cy = py + TILE_SIZE * 0.18;
  // Sized by measurement, not by eye. The first version used 0.17 of a tile
  // (a ~3px star at TILE_SIZE 20) and a full-width dark outline, which left
  // 7 fill pixels on screen at default zoom — a pixel-scan of the live canvas
  // found it, a screenshot could not. Small was the ask; invisible was not.
  const outer = TILE_SIZE * 0.26;
  const inner = outer * 0.44;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    // -90deg start so a point faces up rather than the star sitting rotated.
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffd94a";
  // A hairline outline, not a full pixel: at this size a 1px stroke centred
  // on the path eats half the fill from both sides.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.lineWidth = 0.75;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
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

/**
 * A quick, bright flash on whichever tile a move just targeted — direct
 * ask: "light up the square it effects," sharpened later to "I cannot see
 * what units are attacking what tiles... flash the space red." A landed
 * hit fills the whole tile red (unmissable — this is the "something took
 * damage here" signal); a clean miss only draws the fading ring the
 * original version always used, dimmer, so a miss still marks the
 * targeted tile without reading as real damage.
 */
export function drawMoveFlashes(ctx: CanvasRenderingContext2D, flashes: readonly ActiveMoveFlash[]): void {
  if (flashes.length === 0) return;
  ctx.save();
  for (const flash of flashes) {
    const px = flash.pos.x * TILE_SIZE;
    const py = flash.pos.y * TILE_SIZE;
    const cx = px + TILE_SIZE / 2;
    const cy = py + TILE_SIZE / 2;
    if (flash.hit) {
      // A solid red fill, fading out — the actual "you got hit here" tell.
      ctx.globalAlpha = Math.max(0, flash.fade) * 0.55;
      ctx.fillStyle = "#ff2d2d";
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      // A brighter, fully-opaque outline on top so the tile reads clearly
      // even once the fill has mostly faded.
      ctx.globalAlpha = Math.max(0, flash.fade);
      ctx.strokeStyle = "#ff2d2d";
      ctx.lineWidth = Math.max(1, TILE_SIZE * 0.1 * flash.fade);
      ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    } else {
      // A miss: still real news ("something is attacking this tile"), but
      // dimmer and outline-only so it never reads as landed damage.
      const radius = TILE_SIZE * (0.3 + (1 - flash.fade) * 0.35);
      ctx.globalAlpha = Math.max(0, flash.fade) * 0.5;
      ctx.strokeStyle = "#ff8a8a";
      ctx.lineWidth = Math.max(1, TILE_SIZE * 0.07 * flash.fade);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Direct ask: "Even the targeting for allies should like show the cone or
 * the aoe of a target." While picking a tile for a move — the player's own
 * or a commanded ally's — this outlines every tile the move would actually
 * resolve against (`resolveShape`'s real output for the hovered tile, not
 * just the single tile the cursor sits on), so a cone/line/blast move's
 * true reach is visible before it's committed, not just guessed at. A
 * steady cyan wash, deliberately distinct from `drawMoveFlashes`'s red (a
 * live outcome) and `drawSelectionRing`'s yellow (whose agent is
 * inspected) — this is a preview of something not yet real.
 */
export function drawTargetPreview(ctx: CanvasRenderingContext2D, tiles: readonly Vec2[]): void {
  if (tiles.length === 0) return;
  ctx.save();
  ctx.fillStyle = "#22d3ee";
  ctx.globalAlpha = 0.28;
  for (const t of tiles) ctx.fillRect(t.x * TILE_SIZE, t.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 1.5;
  for (const t of tiles) ctx.strokeRect(t.x * TILE_SIZE + 1, t.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.restore();
}

function drawSelectionRing(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  ctx.save();
  ctx.strokeStyle = "#ffe066";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.restore();
}

/**
 * A dashed spotlight box around whatever Auto Camera is currently following
 * — direct ask: "on mobile auto cam is great. on desktop its a bit too wide
 * to know whats going on. can you either zoom in further or draw a box
 * around it." A fixed zoom level (`AUTO_CAM_ZOOM`) covers proportionally
 * less of a wide desktop viewport than a narrow mobile one, so the same
 * zoom can read as "too far out" on one and fine on the other — a box drawn
 * around the actual participants scales with the situation instead of
 * fighting one fixed number for every screen size. Covers every live
 * participant's own tile (not just a single focus point), using the same
 * interpolated `renderPos` `drawAgent` just drew them at so the box tracks
 * their smoothed on-screen position exactly, not a half-tile-behind raw
 * grid position. An id with no live surface agent (an egg, a despawned
 * participant, a herd id) is simply skipped rather than guessed at.
 */
export interface HighlightBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Pixel-space bounding box (canvas coordinates, tile-render mode only)
 * covering every `ids` member with a live surface agent — the shared math
 * behind both `drawAutoCamHighlight` (the solid, actively-followed box) and
 * `drawPassiveHighlight`/main.ts's click-to-follow hit test (the dimmer
 * boxes for every other currently-tracked battle). An id with no live
 * surface agent is simply skipped, same as before this was extracted;
 * `undefined` when nothing in `ids` currently resolves to one.
 */
export function highlightBounds(world: World, ids: ReadonlySet<string>): HighlightBounds | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const id of ids) {
    const agent = world.agents.find((a) => a.id === id);
    if (!agent || agent.layer !== activeViewLayer) continue;
    const pos = renderPos.get(id) ?? agent.pos;
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x);
    maxY = Math.max(maxY, pos.y);
    found = true;
  }
  if (!found) return undefined;

  const pad = 0.85; // tiles of breathing room around the tightest bounding box, not a flush outline right on the sprites' edges
  return {
    left: (minX - pad) * TILE_SIZE,
    top: (minY - pad) * TILE_SIZE,
    right: (maxX + 1 + pad) * TILE_SIZE,
    bottom: (maxY + 1 + pad) * TILE_SIZE,
  };
}

function drawAutoCamHighlight(ctx: CanvasRenderingContext2D, world: World, ids: ReadonlySet<string>): void {
  const bounds = highlightBounds(world, ids);
  if (!bounds) return;
  ctx.save();
  ctx.strokeStyle = "#ffe066";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  ctx.restore();
}

/**
 * The dimmer, more-sparsely-dashed sibling of `drawAutoCamHighlight` — one
 * of these per OTHER currently-tracked battle (see `drawWorld`'s
 * `passiveHighlights` param), so a viewer not currently following anything
 * (or following a different fight) can still see "something's happening
 * over there" and click it. Same yellow, deliberately less visually loud
 * than the solid actively-followed box so the two read as "this one has my
 * attention" vs. "these are also going on."
 */
function drawPassiveHighlight(ctx: CanvasRenderingContext2D, world: World, ids: ReadonlySet<string>): void {
  const bounds = highlightBounds(world, ids);
  if (!bounds) return;
  ctx.save();
  ctx.strokeStyle = "#ffe066";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([3, 5]);
  ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  ctx.restore();
}

/**
 * The inspector's "show me this group" highlight — a ring around each
 * member plus one box around the lot of them.
 *
 * Cyan, not the highlights' yellow, and solid rather than dashed: the yellow
 * dashed boxes mean "a battle is happening here" and are driven by the
 * simulation, while this is driven by the viewer asking a question. Two
 * different meanings sharing one visual language would make both harder to
 * read, especially since they can be on screen at the same time.
 *
 * The per-member rings matter more than the box. A herd spread across a
 * quarter of the map produces a bounding box so large it says nothing; the
 * rings are what actually let a viewer pick its members out of a crowd of
 * the same species.
 */
function drawGroupHighlight(ctx: CanvasRenderingContext2D, world: World, ids: ReadonlySet<string>): void {
  ctx.save();
  ctx.strokeStyle = "#5fe3ff";
  ctx.lineWidth = 1.75;
  for (const id of ids) {
    const agent = world.agents.find((a) => a.id === id);
    if (!agent || agent.layer !== activeViewLayer || agent.alive === false) continue;
    const pos = renderPos.get(id) ?? agent.pos;
    ctx.beginPath();
    ctx.arc((pos.x + 0.5) * TILE_SIZE, (pos.y + 0.5) * TILE_SIZE, TILE_SIZE * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  }
  const bounds = highlightBounds(world, ids);
  if (bounds) {
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 4]);
    ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  }
  ctx.restore();
}

function setsShareAnId(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const v of a) if (b.has(v)) return true;
  return false;
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
    if (agent.layer !== activeViewLayer || agent.alive === false) continue;
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
/**
 * The day's colour, as a MULTIPLY filter over the ground.
 *
 * This replaced a single flat wash of `rgba(4, 6, 16, darkness * 0.6)` — one
 * colour on one axis, so the world was either its own colour or a bit closer
 * to black, and never warm at any hour. Direct ask, about the source art: "I
 * think the reason this image looks so beautiful is that the lighting is so
 * well done. If there was a way to simulate it dynamically, holy shit."
 *
 * Keyed off `dayPhase` rather than `lightLevel`, because lightLevel is a
 * cosine and cannot tell dawn from dusk — the two want different colours.
 *
 * Multiply rather than a translucent overlay: multiplying by a dark blue
 * darkens AND cools in one pass while leaving the art's own blacks black,
 * whereas painting blue over the top washes everything toward flat blue and
 * kills the contrast the pixel art depends on. Noon multiplies by white,
 * which is a no-op, so the brightest hours cost nothing.
 *
 * Deliberately NOT a moving directional light. Measured on the source art:
 * every object is lit from straight above (top-to-bottom luminance +37 to
 * +43) with no side light at all (left-to-right within ±1). A sun that
 * tracked across the sky would cast shadows the baked sprites contradict.
 */
const DAY_GRADE: readonly { phase: number; tint: Rgb }[] = [
  { phase: 0.0, tint: [92, 104, 158] }, // midnight — deep and cold
  { phase: 0.2, tint: [120, 120, 170] }, // the sky starts to lift
  { phase: 0.26, tint: [255, 186, 140] }, // dawn — the warmest minute of the day
  { phase: 0.34, tint: [255, 232, 205] },
  { phase: 0.5, tint: [255, 255, 255] }, // noon — neutral, no-op
  { phase: 0.66, tint: [255, 236, 212] },
  { phase: 0.74, tint: [255, 160, 110] }, // dusk
  { phase: 0.82, tint: [130, 116, 168] },
  { phase: 1.0, tint: [92, 104, 158] },
];

/** The day's multiply colour at a tick, interpolated between `DAY_GRADE` keyframes. */
function dayTint(tick: number): Rgb {
  const phase = dayPhase(tick);
  let previous = DAY_GRADE[0]!;
  for (const key of DAY_GRADE) {
    if (key.phase >= phase) {
      const span = key.phase - previous.phase;
      const t = span <= 0 ? 0 : (phase - previous.phase) / span;
      return [0, 1, 2].map((i) => Math.round(previous.tint[i]! + (key.tint[i]! - previous.tint[i]!) * t)) as Rgb;
    }
    previous = key;
  }
  return previous.tint;
}

function drawDayNightTint(ctx: CanvasRenderingContext2D, world: World): void {
  // No day underground: the cave's darkness is fog-of-war's job (see
  // `drawFog`), not the surface clock's.
  if (activeViewLayer !== "surface") return;
  const tint = dayTint(world.tick);
  if (tint[0] > 250 && tint[1] > 250 && tint[2] > 250) return; // noon: nothing to do
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = rgbToCss(tint);
  fillVisible(ctx, world);
  ctx.restore();
}

/** Maps a canvas click to the topmost surface-layer agent at that tile, if any. */
export function agentAtCanvasPos(world: World, canvasX: number, canvasY: number, layer: Layer = activeViewLayer): Agent | undefined {
  const tileX = Math.floor(canvasX / TILE_SIZE);
  const tileY = Math.floor(canvasY / TILE_SIZE);
  // What you cannot see you cannot click — the inspector would otherwise be
  // a wallhack.
  if (!tileVisible(world, playerVision(world), tileX, tileY)) return undefined;
  // Last-drawn-wins order (same order world.agents is iterated for drawing) so
  // a click resolves to whichever agent visually renders on top of the others.
  let found: Agent | undefined;
  for (const agent of world.agents) {
    if (agent.layer === layer && agent.pos.x === tileX && agent.pos.y === tileY) found = agent;
  }
  return found;
}
