/**
 * Sprite loading with a graceful fallback. No sprite art is checked into the
 * repo (copyright — the user supplies their own assets); drop PNGs into
 * public/sprites/<spriteKey>.png and they'll be picked up automatically.
 * Until then, agents render as colored squares with their initial.
 */
const cache = new Map<string, HTMLImageElement | null>();

export function getSprite(spriteKey: string): HTMLImageElement | null {
  const cached = cache.get(spriteKey);
  if (cached !== undefined) return cached;

  const img = new Image();
  cache.set(spriteKey, null);
  img.onload = () => cache.set(spriteKey, img);
  img.onerror = () => cache.set(spriteKey, null);
  img.src = `/sprites/${spriteKey}.png`;
  return null;
}
