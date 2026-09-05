/**
 * Sprite loading with a graceful fallback. Directional overworld sprites
 * (ripped from legacy-cpp/data/sprites/Sir_Henry's_32x32 and sprites.png —
 * see MOVES_DESIGN.md-adjacent extraction notes) live at
 * public/sprites/<spriteKey>_<direction>.png, one file per
 * up/down/left/right; species without a full set (or without any sprite at
 * all) fall back first to that species' own "down" sprite, then to the
 * letter-based rendering `renderer.ts` already draws when this returns null.
 */
export type SpriteDirection = "up" | "down" | "left" | "right";

const cache = new Map<string, HTMLImageElement | null>();

/**
 * A path like "/sprites/pikachu_down.png" resolves normally against the
 * real dev server / built `packages/web/dist` (served from `public/`) —
 * but the single-file observer artifact has no server behind that path at
 * all, so it would silently 404 there. The artifact-splicing step embeds
 * every referenced asset as a base64 data URI in a `window.__INLINE_ASSETS__`
 * map (path -> data URI) injected as an inline `<script>` before this
 * bundle; this indirection checks that map first and only falls back to the
 * bare path (the normal dev/build case, where the map is simply absent)
 * when it isn't there. Keeps the ordinary Vite dev/build flow completely
 * unchanged.
 */
function resolveAssetUrl(path: string): string {
  const inline = (window as unknown as { __INLINE_ASSETS__?: Record<string, string> }).__INLINE_ASSETS__;
  return inline?.[path] ?? path;
}

function loadSprite(cacheKey: string, src: string): HTMLImageElement | null {
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const img = new Image();
  cache.set(cacheKey, null);
  img.onload = () => cache.set(cacheKey, img);
  img.onerror = () => cache.set(cacheKey, null);
  img.src = resolveAssetUrl(src);
  return null;
}

export function getSprite(spriteKey: string, direction: SpriteDirection = "down"): HTMLImageElement | null {
  // Real finding, checked at full resolution (a first pass mistakenly
  // judged these from tiny scaled-down thumbnails and got it backwards —
  // see DESIGN.md): "_left.png" and "_right.png" ARE genuine, correctly
  // hand-drawn mirror images of each other — they're just swapped.
  // "_left.png" actually depicts the pose facing right (eye/snout on the
  // image's right side), "_right.png" actually depicts the pose facing
  // left. Confirmed on pikachu and charizard at 10x scale. So the fix is
  // just swapping which file loads for which requested direction — no
  // canvas mirroring needed, the art is already correct once you ask for
  // the right file.
  const resolvedDirection = direction === "left" ? "right" : direction === "right" ? "left" : direction;
  const direct = loadSprite(`${spriteKey}_${resolvedDirection}`, `/sprites/${spriteKey}_${resolvedDirection}.png`);
  if (direct) return direct;
  if (resolvedDirection === "down") return null;
  // Still loading, or this species has no art for `direction` specifically
  // (an incomplete set) — the "down" sprite is always the safest fallback
  // rather than dropping straight to the letter while the real one loads.
  return loadSprite(`${spriteKey}_down`, `/sprites/${spriteKey}_down.png`);
}

/**
 * Terrain tile art — ripped from legacy-cpp/data/sprites/"building and lake
 * sprites.png" (plus "biome sprites unripped.png" for mud and the floor_*
 * variants below) into public/tiles/. Only some terrain kinds have real
 * art; the rest simply have no file at that path, so this returns null
 * exactly like a missing Pokémon sprite would, and renderer.ts falls back
 * to its existing colored-rect rendering for them.
 */

/** Cheap deterministic hash — picks a stable variant/phase per tile position, no shared RNG needed. */
function hashTile(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * How many `<kind>_<n>.png` variants exist for a terrain kind that isn't
 * just a single `<kind>.png` file. Water is handled separately by
 * getWaterSprite below (it needs a shore/interior flag, not just x/y).
 */
const TILE_VARIANT_COUNTS: Record<string, number> = {
  tree: 7,
  boulder: 2,
  bush: 4,
  wall: 2,
};

export function getTileSprite(terrainKind: string, x: number, y: number): HTMLImageElement | null {
  const variants = TILE_VARIANT_COUNTS[terrainKind];
  if (!variants) return loadSprite(`tile_${terrainKind}`, `/tiles/${terrainKind}.png`);
  // Obstacles/walls just need stable-per-tile variety, not animation.
  const n = (hashTile(x, y) % variants) + 1;
  return loadSprite(`tile_${terrainKind}_${n}`, `/tiles/${terrainKind}_${n}.png`);
}

const WATER_FRAMES = 4;
const WATER_FRAME_MS = 300;

/**
 * The current animation frame (1-based), shared by getWaterInterior/
 * getWaterEdge so a given tile's two images (seamless base + bordered
 * source for edge strips) always stay in sync with each other.
 */
function waterFrame(x: number, y: number): number {
  const phase = hashTile(x, y) % WATER_FRAMES;
  return ((Math.floor(performance.now() / WATER_FRAME_MS) + phase) % WATER_FRAMES) + 1;
}

/** The seamless, border-free water crop — used as every water tile's base fill regardless of its neighbors. */
export function getWaterInterior(x: number, y: number): HTMLImageElement | null {
  const n = waterFrame(x, y);
  return loadSprite(`tile_water_${n}`, `/tiles/water_${n}.png`);
}

/**
 * The full lake tile with its sandy border on all 4 sides. The source
 * sheet only has this one bordered shape (no separate N/S/E/W edge
 * pieces), so renderer.ts crops a strip off whichever side(s) of this
 * image actually face a non-water neighbor and overlays just that strip
 * on top of the interior fill — real per-side directional shorelines,
 * built by compositing rather than needing dedicated edge art.
 */
export function getWaterEdge(x: number, y: number): HTMLImageElement | null {
  const n = waterFrame(x, y);
  return loadSprite(`tile_water_edge_${n}`, `/tiles/water_edge_${n}.png`);
}

/**
 * Plain "floor" has no fixed art of its own (see renderer.ts's faint "."
 * glyph) — these are real, previously-unused cave-floor/dirt-path textures
 * from the legacy sheets, drawn underneath that glyph at low opacity
 * purely to give open ground some texture/lighting instead of a flat
 * wash.
 *
 * Went through two wrong extremes before landing here: picking among all
 * 6 crops per 4x4-tile BLOCK made every block boundary a visible seam (a
 * literal grid of differently-textured squares); dropping to a single
 * texture for the whole map fixed the seams but then just looked like
 * the same tile stamped over and over ("really try to make the floor
 * varied and beautiful... same tile over and over can look bad"). This
 * picks per INDIVIDUAL tile instead, at low opacity — real tilesets do
 * exactly this (several near-identical floor variants scattered
 * pseudo-randomly) specifically because at small scale and low contrast
 * it reads as natural grain, not a patchwork; only a hard-edged multi-
 * tile block of one texture read as "chunks" before.
 */
const FLOOR_TEXTURES = ["floor_cave", "floor_cave_2", "floor_cave_3", "floor_dirt_1", "floor_dirt_2", "floor_dirt_3"];

export function getFloorTexture(x: number, y: number): HTMLImageElement | null {
  const name = FLOOR_TEXTURES[hashTile(x, y) % FLOOR_TEXTURES.length]!;
  return loadSprite(`tile_${name}`, `/tiles/${name}.png`);
}

/**
 * Real berry-plant art (ripped from legacy-cpp/data/sprites/"berry
 * sprites.png", a growth-stage sheet: each berry has a small/medium/ripe
 * stage) for "food"/"flora" tiles, keyed by the same flavor name
 * flora.ts's FOOD_FLAVORS/FLORA_FLAVORS already assigns — so a "cheri"
 * food tile always draws the same real Cheri-Berry-ish plant, not a
 * random one. Ripe (fruit-visible) stage only; renderer.ts scales opacity
 * by the tile's own stock so a depleted patch still visually fades like
 * it did before this art existed.
 */
export function getFoodSprite(flavor: string): HTMLImageElement | null {
  return loadSprite(`tile_food_${flavor}`, `/tiles/food_${flavor}.png`);
}

export function getFloraSprite(flavor: string): HTMLImageElement | null {
  return loadSprite(`tile_flora_${flavor}`, `/tiles/flora_${flavor}.png`);
}

/** A "seedling" hasn't been assigned a flavor yet (flora.ts only picks one once it matures), so this is hash-varied per tile instead of flavor-keyed. */
const SEEDLING_VARIANTS = 7;

export function getSeedlingSprite(x: number, y: number): HTMLImageElement | null {
  const n = (hashTile(x, y) % SEEDLING_VARIANTS) + 1;
  return loadSprite(`tile_seedling_${n}`, `/tiles/seedling_${n}.png`);
}
