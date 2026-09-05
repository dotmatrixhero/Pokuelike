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
 * just a single `<kind>.png` file. "water" is animated rather than
 * per-tile-varied — see getTileSprite below — but still uses this count to
 * know how many frames it has.
 */
const TILE_VARIANT_COUNTS: Record<string, number> = {
  tree: 7,
  boulder: 2,
  bush: 4,
  wall: 2,
  water: 4,
};

const WATER_FRAME_MS = 300;

export function getTileSprite(terrainKind: string, x: number, y: number): HTMLImageElement | null {
  const variants = TILE_VARIANT_COUNTS[terrainKind];
  if (!variants) return loadSprite(`tile_${terrainKind}`, `/tiles/${terrainKind}.png`);

  let n: number;
  if (terrainKind === "water") {
    // Every water tile cycles through the same wave frames, but each tile's
    // phase is offset by its own hash so the whole lake doesn't flash in
    // unison — reads as a shimmer travelling across the surface instead.
    const phase = hashTile(x, y) % variants;
    n = ((Math.floor(performance.now() / WATER_FRAME_MS) + phase) % variants) + 1;
  } else {
    // Obstacles/walls just need stable-per-tile variety, not animation.
    n = (hashTile(x, y) % variants) + 1;
  }
  return loadSprite(`tile_${terrainKind}_${n}`, `/tiles/${terrainKind}_${n}.png`);
}

/**
 * Plain "floor" has no fixed art of its own (see renderer.ts's faint "."
 * glyph) — these are real, previously-unused cave-floor textures from the
 * legacy sheets, drawn underneath that glyph at low opacity purely to give
 * open ground some varied texture/lighting instead of a flat wash.
 *
 * Only cave-floor and dirt-path variants are used here — all the same
 * brownish family — not the grass/stone textures also sitting in
 * public/tiles/: mixing hues that different produced a patchwork of
 * visibly clashing colored squares instead of a subtle surface, since
 * each is a small flat-color source crop with no blending between
 * neighbors. Picking a variant per 4x4 block of tiles (not per individual
 * tile) likewise avoids a "static" look — real cave floor reads as a few
 * big irregular patches, not per-tile noise.
 */
const FLOOR_TEXTURES = ["floor_cave", "floor_cave_2", "floor_cave_3", "floor_dirt_1", "floor_dirt_2", "floor_dirt_3"];
const FLOOR_PATCH_SIZE = 4;

export function getFloorTexture(x: number, y: number): HTMLImageElement | null {
  const name = FLOOR_TEXTURES[hashTile(Math.floor(x / FLOOR_PATCH_SIZE), Math.floor(y / FLOOR_PATCH_SIZE)) % FLOOR_TEXTURES.length]!;
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
