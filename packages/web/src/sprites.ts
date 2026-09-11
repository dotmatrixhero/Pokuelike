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

export function getSprite(spriteKey: string, direction: SpriteDirection = "down", frame = 0): HTMLImageElement | null {
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
  // ...but ONLY for the Pokemon sheet. The trainer rip
  // (scripts/rip_trainer_sprites.py) classifies each frame's facing from its
  // own pixels and writes the file under the direction it actually depicts,
  // so `human_*_left.png` really does face left. Applying the Pokemon sheet's
  // swap to those flipped them the wrong way and the humans moonwalked —
  // direct report: "the trainer is moonwalking. I think its facing left and
  // right sprites have to be switched." Verified at 9x on a checkerboard
  // before changing anything: `pikachu_left` has its face on the image's
  // RIGHT (mislabelled, swap needed), `human_hunter_left` has its face on the
  // image's LEFT (correct, swap must not apply).
  const mislabelledSource = !spriteKey.startsWith("human_");
  const resolvedDirection = mislabelledSource && direction === "left" ? "right" : mislabelledSource && direction === "right" ? "left" : direction;
  // frame 0 is the standing pose and keeps the plain `<key>_<dir>.png` name
  // every sprite has always used; walk frames are `_1`. A missing walk frame
  // just falls back to standing, so a species with no animation still draws.
  const suffix = frame > 0 ? `_${frame}` : "";
  const direct = loadSprite(`${spriteKey}_${resolvedDirection}${suffix}`, `/sprites/${spriteKey}_${resolvedDirection}${suffix}.png`);
  if (direct) return direct;
  if (frame > 0) return getSprite(spriteKey, direction, 0);
  if (resolvedDirection === "down") return null;
  // Still loading, or this species has no art for `direction` specifically
  // (an incomplete set) — the "down" sprite is always the safest fallback
  // rather than dropping straight to the letter while the real one loads.
  return loadSprite(`${spriteKey}_down`, `/sprites/${spriteKey}_down.png`);
}

/**
 * Which trainer sprite a human renders as. "human" has no sprite of its own in
 * the Pokemon sheet (the species entry's `spriteKey` is a placeholder), so
 * humans fell through to an emoji — 👱 for the player, an archetype emoji for
 * everyone else. These come from legacy-cpp/data/sprites/"trainer sprites.png"
 * instead, ripped by packages/web/scripts/rip_trainer_sprites.py: real
 * directional art, one distinct character per archetype, with the same
 * `<key>_<direction>.png` naming every Pokemon sprite already uses (plus
 * `_1`/`_2` walk frames alongside).
 *
 * The player keeps their own character rather than sharing an archetype's:
 * their role is earned through play (HUMANS_DESIGN.md), so they should not
 * look like a wild human who spawned as one.
 */
export function humanSpriteKey(isPlayer: boolean, archetype?: string): string {
  if (isPlayer) return "human_player";
  return `human_${archetype ?? "wanderer"}`;
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

/**
 * A 1:1 source window for a surface texture that is much larger than a tile.
 *
 * `mud.png` is 128x128 and `wall_1.png` is 144x144, but both were being drawn
 * with `drawImage(img, dx, dy, TILE_SIZE, TILE_SIZE)` — the WHOLE image
 * squashed into 20x20. That resampled a 144px texture down to 20px, keeping
 * roughly 2% of its pixels, and did it every frame; it also made every tile of
 * that terrain identical, since they all showed the same squashed image.
 *
 * Taking a tile-sized window instead is strictly better on both counts: drawn
 * 1:1 there is no resampling at all (full fidelity), and the window is chosen
 * per tile position, so the terrain stops repeating. Direct report: "Are the
 * pixels getting super ugly compressed when rendered? I think we are losing a
 * lot of fidelity."
 *
 * Only applies when the source is at least twice the tile in BOTH dimensions,
 * which is exactly the full-tile surface textures. Object icons (a tree at
 * 32x42, a bush at 16x35) are meant to be seen whole and fail that test.
 */
/**
 * Which terrains are a TILING SURFACE — a texture that covers the whole tile
 * and continues into the next one — rather than an object icon standing on
 * the ground.
 *
 * `tileWindow` used to decide this from the image's size alone: anything at
 * least two tiles across was assumed to be a surface. That is not something
 * size can tell you, and it was wrong for real art: `tree_6` (48x55) and
 * `tree_7` (48x57) clear the threshold, so two of the seven tree variants
 * rendered as a random 20x20 crop out of the middle of a tree — half a
 * canopy, or a bare length of trunk. Direct report: "The trees are kina
 * incorrectly cropped there."
 */
const TILING_SURFACE_TERRAIN = new Set(["mud", "wall"]);

export function tileWindow(img: HTMLImageElement, terrainKind: string, x: number, y: number, tileSize: number): { sx: number; sy: number } | null {
  if (!TILING_SURFACE_TERRAIN.has(terrainKind)) return null;
  if (img.width < tileSize * 2 || img.height < tileSize * 2) return null;
  const cols = Math.floor(img.width / tileSize);
  const rows = Math.floor(img.height / tileSize);
  const h = hashTile(x, y);
  return { sx: (h % cols) * tileSize, sy: (Math.floor(h / cols) % rows) * tileSize };
}

export function getTileSprite(terrainKind: string, x: number, y: number): HTMLImageElement | null {
  const variants = TILE_VARIANT_COUNTS[terrainKind];
  if (!variants) return loadSprite(`tile_${terrainKind}`, `/tiles/${terrainKind}.png`);
  // Obstacles/walls just need stable-per-tile variety, not animation.
  const n = (hashTile(x, y) % variants) + 1;
  return loadSprite(`tile_${terrainKind}_${n}`, `/tiles/${terrainKind}_${n}.png`);
}

const WATER_FRAMES = 4;
const WATER_FRAME_MS = 300;

/** How many frames the water animation has. */
export const WATER_FRAME_COUNT = WATER_FRAMES;

/**
 * The current water frame for the WHOLE map.
 *
 * There used to be a per-tile phase (`hashTile(x, y) % 4`) so neighbouring
 * tiles animated out of step. That was itself a grid artifact — open water
 * visibly shimmered in squares — and it also made the water layer
 * un-cacheable as one image. renderer.ts now tiles this single frame across
 * the map as a repeating pattern and masks it to the water body.
 */
export function currentWaterFrame(): number {
  return (Math.floor(performance.now() / WATER_FRAME_MS) % WATER_FRAMES) + 1;
}

export function getWaterFrame(): HTMLImageElement | null {
  const n = currentWaterFrame();
  return loadSprite(`tile_water_${n}`, `/tiles/water_${n}.png`);
}


/**
 * ONE ground cell of the biome ground patches, in source pixels — see
 * `getGroundPatch`.
 */
export const GROUND_CELL = 16;
/** How many cells across a ground patch is; the repeat period, in game tiles. */
export const GROUND_PATCH_CELLS = 6;

/**
 * Which multi-tile ground patch (public/tiles/ground/*.png, built by
 * scripts/rip_biome_ground.py) a biome draws its floor from.
 *
 * This replaced a set of single 16x16 crops that were stamped once per tile,
 * identically, everywhere — which is literally why the map read as "so square
 * and ugly": every tile of a biome was the same sixteen pixels, so the tile
 * grid was being drawn into the texture. A patch is 6x6 of the source
 * artist's own ground cells, and renderer.ts windows into it in WORLD space
 * (cell `(x % 6, y % 6)` for tile `(x, y)`), so neighbouring tiles draw
 * neighbouring source pixels.
 *
 * Two things worth knowing, both measured off the source sheet rather than
 * assumed (see the script's docstring):
 * - The panels' own grass, water and cave ground are each ONE 16x16 tile
 *   repeated — byte-identical, 1 distinct cell out of 15/14/53 clean ones.
 *   The source art does not avoid repetition with base variety at all. It
 *   avoids it with the scatter layer below and with irregular, non-grid
 *   boundaries between ground types.
 * - Dirt (14), stone (16), field (31) and snow (6) DO have real multi-tile
 *   variety, and those are the patches the world-space windowing actually
 *   buys something for.
 * Grassland/forest previously resolved to `floor_cave_2` — a cave floor — so
 * grassland rendered as gray-brown rock. That is fixed here by there finally
 * being real grass art ripped for it.
 */
const BIOME_GROUND: Record<string, string> = {
  grassland: "grass",        // pale mint, open plains
  forest: "grass_forest",    // mid green under canopy
  jungle: "grass_deep",      // dark mossy floor
  wetland: "marsh",          // damp olive-green
  mangrove: "dirt",          // brackish mud, plus its own teal tint
  beach: "shore",            // very pale cream
  desert: "sand",
  badlands: "clay",          // warm red-brown
  savanna: "grass_dry",      // dry gold grass
  highland: "stone",         // warm grey rock
  tundra: "frost",           // cool grey, plus its own blue tint
  snow: "snow",
};

/** The default patch for a tile with no biome data (bare test worlds) and for the underground layer. */
const GROUND_DEFAULT = "cave";

/**
 * The off-grid scatter layer: which transparent decals
 * (public/tiles/decal/*.png) a biome scatters over its ground.
 *
 * This is the technique the source panels actually use to stop reading as a
 * grid — not base-tile variety (see `BIOME_GROUND` above for the measurement
 * that settled that). renderer.ts places these at hash-jittered sub-tile
 * offsets at their NATIVE size, so a 32x24 decal straddles two tiles and
 * lands wherever the hash puts it rather than snapping to a tile origin.
 * That is the whole difference from the old `getFloorOverlay` decals, which
 * were masked to exactly one tile and drawn at the tile origin — a perfect
 * lattice of rounded squares, visible in a before-shot as a checkerboard.
 */
const BIOME_SCATTER: Record<string, readonly string[]> = {
  grassland: ["bloom_1", "bloom_2", "flower_red_1", "tuft_green_1"],
  forest: ["fern_1", "bloom_1", "flower_red_1", "moss_1"],
  jungle: ["fern_1", "reed_1", "tuft_green_1", "moss_1"],
  wetland: ["reed_1", "lily_1", "moss_1", "tuft_green_1"],
  mangrove: ["reed_1", "lily_1", "lily_2", "moss_1"],
  badlands: ["tuft_dry_1", "tuft_dry_2", "succulent_1"],
  desert: ["tuft_dry_1", "tuft_dry_3", "succulent_1"],
  beach: ["tuft_dry_2", "tuft_dry_3"],
  savanna: ["tuft_dry_1", "tuft_dry_2", "tuft_dry_3", "succulent_1"],
  highland: ["moss_1", "tuft_dry_1", "tuft_green_1"],
  tundra: ["blade_cold_2", "moss_1", "tuft_dry_2"],
  snow: ["blade_cold_1", "blade_cold_2"],
};

/**
 * The sparse FEATURE layer: landmark-sized art (a cactus cluster, a palm, a
 * boulder, a fallen log) scattered far more thinly than the ground detail
 * above.
 *
 * Separate from `BIOME_SCATTER` because size and density are coupled. These
 * are two to four tiles tall; at the fine layer's one-in-seven they would read
 * as a hedge rather than as a landmark, and they would bury the ground the
 * rest of this pass exists to show.
 */
const BIOME_FEATURES: Record<string, readonly string[]> = {
  grassland: ["boulder_1", "log_1"],
  forest: ["log_1", "boulder_1"],
  jungle: ["log_1", "boulder_1"],
  wetland: ["cattail_1", "log_1"],
  mangrove: ["cattail_1", "log_1"],
  badlands: ["cactus_1", "boulder_1"],
  desert: ["cactus_1", "cactus_2", "boulder_1"],
  beach: ["log_1", "boulder_1"],
  savanna: ["cactus_1", "boulder_1", "log_1"],
  highland: ["boulder_1"],
  tundra: ["boulder_1", "log_1"],
  snow: ["boulder_1", "log_1"],
};

const SCATTER_DEFAULT: readonly string[] = ["moss_1", "tuft_green_1"];
/** Cave/underground features. */
const FEATURE_DEFAULT: readonly string[] = ["boulder_1"];

/**
 * Which decals STAND UP off the ground, and so cast a contact shadow.
 *
 * Not a size test and not a per-layer rule, because neither works: `moss_1`
 * and `fern_1` are both 32x32 and both live in the fine scatter pool, but one
 * is flat ground cover and the other is a waist-high plant. The first pass
 * gave the whole fine layer no shadow at all, which left ferns sitting flat
 * beside shadowed trees — direct report: "Ferns don't have much shadow."
 * Lily pads float, blossoms lie in the grass, moss and tufts ARE the ground;
 * ferns, reeds, cattails, cacti, boulders and logs are objects on it.
 */
const STANDING_DECALS = new Set(["fern_1", "reed_1", "cattail_1", "cactus_1", "cactus_2", "boulder_1", "log_1", "succulent_1"]);

/** Which ground patch a biome resolves to — exported so renderer.ts's edge-blend code can tell "same art, different biome name" (grassland vs. forest) apart from a real texture change without duplicating this lookup. */
export function getFloorBaseName(biome?: string): string {
  return (biome && BIOME_GROUND[biome]) ?? GROUND_DEFAULT;
}

/**
 * The biome's multi-tile ground patch. renderer.ts windows one `GROUND_CELL`
 * cell out of it per tile.
 *
 * `underground` ignores the biome entirely and always gets the cave floor.
 * Biome weights are a surface concept but the cave shares the surface's
 * coordinates, so a cave under a highland zone was rendering the grey rock
 * SLABS — big shapes with dark cracks, and the report was that it did not
 * look calm. A cave floor is a cave floor whatever is above it.
 */
export function getGroundPatch(biome?: string, layer?: string): HTMLImageElement | null {
  const name = layer && layer !== "surface" ? GROUND_DEFAULT : getFloorBaseName(biome);
  return loadSprite(`ground_${name}`, `/tiles/ground/${name}.png`);
}

/**
 * The scatter decal for this tile, or null for the (large) majority of tiles
 * that get none. Returns the image plus the sub-tile offset it should be
 * drawn at, both derived from the same tile hash so a given tile's decal is
 * stable across frames and across zoom changes.
 */
export type ScatterDecal = { image: HTMLImageElement; jitterX: number; jitterY: number; standing: boolean };

export function getScatterDecal(x: number, y: number, biome: string | undefined, oneIn: number): ScatterDecal | null {
  return pickDecal(BIOME_SCATTER, SCATTER_DEFAULT, x, y, biome, oneIn, 31337, 7919);
}

/** The sparse landmark layer — see `BIOME_FEATURES`. Same placement rules as the fine scatter, different pool, different hash, much lower density. */
export function getFeatureDecal(x: number, y: number, biome: string | undefined, oneIn: number): ScatterDecal | null {
  return pickDecal(BIOME_FEATURES, FEATURE_DEFAULT, x, y, biome, oneIn, 15485863, 32452843);
}

function pickDecal(
  pools: Record<string, readonly string[]>,
  fallback: readonly string[],
  x: number,
  y: number,
  biome: string | undefined,
  oneIn: number,
  saltX: number,
  saltY: number
): ScatterDecal | null {
  const pool = (biome ? pools[biome] : undefined) ?? fallback;
  if (pool.length === 0) return null;
  // Offset so "which tiles get a decal" doesn't correlate with anything else
  // keyed off (x, y) — same reason getFloorOverlay offset its own hash.
  const h = hashTile(x + saltX, y + saltY);
  if (h % oneIn !== 0) return null;
  const name = pool[Math.floor(h / oneIn) % pool.length]!;
  const image = loadSprite(`decal_${name}`, `/tiles/decal/${name}.png`);
  if (!image) return null;
  // A second, independent hash for placement, so two tiles that rolled the
  // same decal don't also land at the same offset within their tile.
  const j = hashTile(x + saltX + 104729, y + saltY + 1299709);
  return {
    image,
    jitterX: ((j % 16) / 16) - 0.5,
    jitterY: ((Math.floor(j / 16) % 16) / 16) - 0.5,
    standing: STANDING_DECALS.has(name),
  };
}

/**
 * The "fertile ground" patch drawn under food/flora/seedling tiles — direct
 * ask: "can we decal a little green patch under the plants."
 *
 * This is the real `grass_deep` biome ground, not the old `floor_grass_1`
 * crop. That one was a flat, fully saturated green with a dot pattern, and on
 * the new ground art it read as a bright green SWATCH — a UI rectangle with
 * the berry's soil mound sitting on it like a plant in a tray, rather than a
 * richer patch of earth. `grass_deep` is a real, desaturated ground texture
 * from the same sheet, so the patch reads as lusher ground and the plant
 * reads as growing out of it.
 */
export function getFertilePatch(): HTMLImageElement | null {
  return loadSprite("ground_grass_deep", "/tiles/ground/grass_deep.png");
}

/**
 * Real berry-plant art (ripped from legacy-cpp/data/sprites/"berry
 * sprites.png", a growth-stage sheet: each berry has a small/medium/ripe
 * stage) for "food"/"flora" tiles, keyed by the tile's own flavor — a
 * `crops.ts` `CropId` for "food" (CROPS_DESIGN.md; no dedicated art exists
 * — all 15 now have real art, ripped from the same sheet by
 * packages/web/scripts/rip_crop_tiles.py; before that only the four
 * original berries did and the other eleven fell back to
 * `FLAVOR_FG`/`FLAVOR_GLYPH`'s colored-glyph rendering) or `flora.ts`'s
 * `FLORA_FLAVORS` for "flora".
 * Ripe (fruit-visible) stage only; renderer.ts scales opacity by the
 * tile's own stock so a depleted patch still visually fades like it did
 * before this art existed.
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
