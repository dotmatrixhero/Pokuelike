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
  // Real finding, checked visually across several species (pikachu,
  // charizard, squirtle): the ripped "_right.png" frame isn't actually
  // mirrored from "_left.png" — it's the same left-facing pose again, just
  // duplicated into the wrong slot. Rather than trust that broken asset,
  // "right" always resolves to the same canonical "_left" image; the
  // renderer (see drawAgent in renderer.ts) draws it flipped horizontally
  // via a canvas transform to get an actually-rightward-facing sprite.
  const resolvedDirection = direction === "right" ? "left" : direction;
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
 * sprites.png" (plus "biome sprites unripped.png" for mud) into
 * public/tiles/<terrainKind>.png. Only some terrain kinds have real art;
 * the rest simply have no file at that path, so this returns null exactly
 * like a missing Pokémon sprite would, and renderer.ts falls back to its
 * existing colored-rect rendering for them.
 */
export function getTileSprite(terrainKind: string): HTMLImageElement | null {
  return loadSprite(`tile_${terrainKind}`, `/tiles/${terrainKind}.png`);
}
