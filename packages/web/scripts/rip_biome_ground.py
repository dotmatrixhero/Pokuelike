#!/usr/bin/env python3
"""Rip layered biome art out of `legacy-cpp/data/sprites/biome sprites unripped.png`.

Why this exists
---------------
The sheet is not a tileset. It is fourteen pre-composed 128x320 scene panels
(2 rows x 7 columns) drawn on an internal 16px grid. Everything the renderer
had been using from it was a single 16x16 crop, stamped once per tile -- which
is exactly why the map read as "so square and ugly": every tile of a biome was
the *same sixteen pixels*, so the tile grid was drawn in the texture itself.

Two products come out of here, matching the two things that make the source
panels look good:

1. `public/tiles/ground/*.png` -- MULTI-TILE ground patches (96x96 = ~5x5 game
   tiles). renderer.ts samples these in world space, so neighbouring tiles draw
   neighbouring source pixels and the repeat period becomes the patch, not the
   tile. Built by quilting random windows out of the panel's clean ground
   regions with feathered overlaps, then made edge-seamless with the standard
   offset-and-crossfade trick, so there is no hard seam at the repeat either.

2. `public/tiles/decal/*.png` -- transparent SCATTER decals (grass tufts,
   blossoms, reeds, ferns, lily pads, cold-weather blades, loose rock). Cut out
   with an alpha key against the local ground colour sampled from the same
   panel. renderer.ts scatters these at hash-jittered sub-tile offsets in a
   pass of their own, so they land off the grid instead of on it.

Coordinates below were read off the panels by eye at 3x zoom with a 16px grid
overlaid, then every crop was checked on a checkerboard before being kept --
this sheet has already produced two wrong-crop mistakes in earlier sessions
(an all-red "lava" panel that is just flat red, and a mis-measured coordinate),
so nothing here is trusted until it has been looked at.
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "..")
SHEET = os.path.join(ROOT, "legacy-cpp", "data", "sprites", "biome sprites unripped.png")
TILES = os.path.join(os.path.dirname(__file__), "..", "public", "tiles")

PANEL_W, PANEL_H, COLS = 128, 320, 7
CELL = 16  # the source art's own internal tile size


def panel_origin(i):
    return (i % COLS) * PANEL_W, (i // COLS) * PANEL_H


# --- ground patches -------------------------------------------------------
# (output name, panel index, seed pixel inside the panel that is known ground)
GROUND = [
    # One tone per biome. An earlier pass seeded `grass_deep` from the same
    # mint-grass cell as `grass` and the two came out BYTE-IDENTICAL, so
    # jungle rendered exactly like grassland -- caught by diffing the emitted
    # patches against each other, not by looking at them. Every entry here is
    # now checked against the others for that.
    ("grass", 4, (24, 130)),          # pale mint, open plains
    ("grass_forest", 5, (72, 56)),    # mid green under canopy
    ("grass_deep", 3, (88, 56)),      # dark olive, jungle floor
    ("marsh", 10, (88, 120)),         # damp bright olive-green, wetland
    ("sand", 6, (56, 40)),            # desert sand
    ("shore", 12, (72, 40)),          # very pale cream, beach
    ("clay", 1, (8, 8)),              # light red-brown, badlands
    ("grass_dry", 13, (72, 104)),     # dry gold grass, savanna
    ("stone", 11, (72, 104)),         # warm grey rock, highland
    ("frost", 11, (24, 152)),         # cool grey, tundra
    ("snow", 9, (40, 8)),             # white, snow
    ("cave", 7, (60, 140)),           # fine pebble, underground
    ("dirt", 3, (80, 120)),           # plain brown dirt
    ("water", 0, (70, 90)),
]


PATCH_CELLS = 6  # 6x6 source cells = 96x96 px = ~5x5 game tiles per repeat


def clean_cells(panel, seed, tol=62, outlier=0.05):
    """Bool grid of 16px cells that are pure ground: almost no pixel far from
    the ground colour. Rejects anything carrying an object's dark outline,
    while still accepting the large-scale mottling that makes the good ground
    textures good."""
    sx, sy = seed
    ground = np.median(panel[max(0, sy - 3):sy + 3, max(0, sx - 3):sx + 3].reshape(-1, 3), axis=0)
    rows, cols = panel.shape[0] // CELL, panel.shape[1] // CELL
    ok = np.zeros((rows, cols), bool)
    for r in range(rows):
        for c in range(cols):
            cell = panel[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL].reshape(-1, 3)
            ok[r, c] = (np.linalg.norm(cell - ground, axis=1) > tol).mean() < outlier
    return ok


def distinct_cells(panel, ok, tol=3.0):
    """The clean cells, deduplicated. The source panels repeat their own ground
    tiles constantly, so the raw list is mostly copies; what matters for
    breaking up repetition is how many genuinely DIFFERENT ground tiles the
    artist drew."""
    out = []
    rows, cols = ok.shape
    for r in range(rows):
        for c in range(cols):
            if not ok[r, c]:
                continue
            cell = panel[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
            if any(np.abs(cell - prev).mean() < tol for prev in out):
                continue
            out.append(cell)
    return out


TONE_SPREAD = 8.0


def ground_colour(panel, seed):
    """The ground colour a target's seed pixel names."""
    sx, sy = seed
    return np.median(panel[max(0, sy - 3):sy + 3, max(0, sx - 3):sx + 3].reshape(-1, 3), axis=0)


def same_tone(cells, anchor=None):
    """Keep only the cells that share the ground's dominant TONE.

    Measured on this sheet: the "clean ground" cells of a panel can differ in
    mean colour by 15 (sand), 30 (dirt) or 43 (farm field) — those are not
    detail variants of one surface, they are different shades of it (a sunlit
    patch, a worn track). Laying them out as a mosaic paints a checkerboard of
    visibly different-coloured squares, which is the same mistake an earlier
    pass made with whole textures and had to undo. Only cells within
    `TONE_SPREAD` of the modal tone are detail variation; the rest are dropped.
    """
    means = np.array([c.mean(axis=(0, 1)) for c in cells])
    if anchor is None:
        # Modal tone: the cell with the most neighbours inside the threshold.
        counts = [(np.linalg.norm(means - m, axis=1) <= TONE_SPREAD).sum() for m in means]
        anchor = means[int(np.argmax(counts))]
    kept = [c for c, m in zip(cells, means) if np.linalg.norm(m - anchor) <= TONE_SPREAD]
    # The seed pixel is how a target NAMES the tone it wants, so it anchors the
    # filter. Letting the modal cluster anchor it instead meant a seed aimed at
    # warm highland rock drifted to the panel's more populous cool grey, and
    # highland came out identical to tundra.
    if not kept:
        nearest = int(np.argmin(np.linalg.norm(means - anchor, axis=1)))
        kept = [cells[nearest]]
    return kept


def mosaic(cells, rng, n=PATCH_CELLS):
    """Lay the artist's own ground cells out in an n x n arrangement.

    Deliberately NOT cross-faded like a photographic texture quilt would be:
    blending pixel art invents off-palette colours and softens every edge (the
    first attempt here did exactly that and the result read as a blurry smear,
    visibly worse than the source). These cells are tileset tiles -- the artist
    drew them to butt against each other -- so a hard join is both faithful and
    invisible. Horizontal/vertical flips multiply the pool without inventing
    anything, and the arrangement is seamless by construction, since every
    edge is a cell edge.
    """
    out = np.zeros((n * CELL, n * CELL, 3), float)
    for r in range(n):
        for c in range(n):
            cell = cells[rng.integers(len(cells))]
            if rng.integers(2):
                cell = cell[:, ::-1]
            if rng.integers(2):
                cell = cell[::-1, :]
            out[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = cell
    return out


def keyed_alpha(region, ground, lo=45, hi=75):
    """Alpha-key a decal out of its panel against the local ground colour.

    The raw distance key alone is not enough, and the failure is visible:
    anywhere the decal's OWN colour lands near the ground colour -- the pale
    green inside a fern against grass, the tan inside a mushroom cap against
    dirt -- it punches a transparent hole through the middle of the decal.
    Direct report: "Some are transparent in the wrong spots."

    So the key only decides what the BACKGROUND is, and background is then
    defined as the keyed-out region that actually reaches the edge of the
    crop. Anything enclosed by the decal is filled back in opaque, holes and
    all. Soft edges survive, because the partial alpha is kept on exactly the
    pixels that border reachable background.
    """
    d = np.linalg.norm(region - ground, axis=2)
    alpha = np.clip((d - lo) / (hi - lo), 0, 1)
    h, w = alpha.shape
    transparent = alpha < 0.5
    filled = np.zeros((h, w), bool)
    seen = np.zeros((h, w), bool)
    for sy in range(h):
        for sx in range(w):
            if not transparent[sy, sx] or seen[sy, sx]:
                continue
            stack, pixels, touches = [(sy, sx)], [], False
            seen[sy, sx] = True
            while stack:
                y, x = stack.pop()
                pixels.append((y, x))
                if y in (0, h - 1) or x in (0, w - 1):
                    touches = True
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and transparent[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            # An enclosed pocket is a hole in the decal and gets filled; an
            # enclosed pocket that is a big share of the crop is not a hole,
            # it is background the decal happens to ring (reeds and moss both
            # touch all four borders and enclose most of their own crop --
            # filling those painted a solid rectangle behind them). Anything
            # reaching the border is background outright.
            if not touches and len(pixels) < h * w * 0.15:
                for y, x in pixels:
                    filled[y, x] = True
    alpha = np.where(filled, 1.0, alpha)
    return drop_edge_fragments(alpha)


def drop_edge_fragments(alpha, share=0.2):
    """Erase small opaque blobs that touch the edge of the crop.

    A crop cut out of a scene panel almost always clips a sliver of whatever
    is next door -- the lip of a snow drift, a stripe of pond, the corner of a
    bush -- and those arrive as their own little opaque islands hanging off
    the border. Anything that both touches the border AND is small next to the
    decal itself is one of those, not part of the decal. Something that
    touches the border and is big (a tuft cluster drawn wider than its crop)
    is kept.
    """
    h, w = alpha.shape
    solid = alpha > 0.5
    label = np.full((h, w), -1, int)
    blobs = []
    for sy in range(h):
        for sx in range(w):
            if not solid[sy, sx] or label[sy, sx] >= 0:
                continue
            idx = len(blobs)
            stack, pixels, touches = [(sy, sx)], [], False
            label[sy, sx] = idx
            while stack:
                y, x = stack.pop()
                pixels.append((y, x))
                if y in (0, h - 1) or x in (0, w - 1):
                    touches = True
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and label[ny, nx] < 0:
                        label[ny, nx] = idx
                        stack.append((ny, nx))
            blobs.append((pixels, touches))
    if not blobs:
        return alpha
    biggest = max(len(px) for px, _ in blobs)
    out = alpha.copy()
    for pixels, touches in blobs:
        if touches and len(pixels) < biggest * share:
            for y, x in pixels:
                out[y, x] = 0.0
    return out


# --- decals ---------------------------------------------------------------
# (name, panel, x, y, w, h, ground-sample pixel) -- all in panel-local pixels.
DECALS = [
    ("tuft_dry_1", 6, 16, 96, 16, 16, (48, 140)),
    ("tuft_dry_2", 6, 32, 96, 16, 16, (48, 140)),
    ("tuft_dry_3", 6, 16, 112, 32, 16, (48, 140)),
    ("succulent_1", 6, 96, 32, 16, 16, (48, 140)),
    ("bloom_1", 8, 64, 128, 32, 24, (48, 80)),
    ("bloom_2", 8, 32, 64, 32, 24, (48, 80)),
    ("reed_1", 8, 16, 64, 16, 32, (48, 80)),
    ("fern_1", 8, 16, 96, 32, 32, (48, 80)),
    ("lily_1", 0, 48, 112, 32, 24, (70, 90)),
    ("lily_2", 0, 32, 88, 40, 24, (70, 90)),
    ("moss_1", 3, 32, 112, 32, 32, (80, 120)),
    # Panel 10's forest floor. Panel 3's mushrooms were tried here first and
    # dropped -- direct report: "the mushroom decals are a little messy." They
    # are drawn in PERSPECTIVE, caps seen from the side on long stems against
    # a dark cave wall, so keying them out leaves stringy dark stems and at
    # 20px they read as smudges rather than as anything. Nothing was wrong
    # with the cutout; the art is side-on and the map is top-down.
    ("flower_red_1", 10, 80, 32, 16, 16, (72, 44)),
    ("tuft_green_1", 10, 32, 96, 16, 16, (24, 88)),
    # Bigger "feature" decals. These are landmarks, not ground detail, so
    # renderer.ts scatters them from their own much sparser pool -- a cactus
    # cluster is three tiles tall and would read as a hedge at the fine
    # scatter layer's density.
    ("cactus_1", 6, 80, 48, 32, 48, (56, 40)),
    ("cactus_2", 6, 16, 0, 32, 64, (56, 40)),
    ("palm_1", 12, 64, 272, 48, 48, (72, 40)),
    ("boulder_1", 10, 24, 128, 32, 32, (88, 120)),
    ("cattail_1", 0, 96, 64, 16, 48, (70, 90)),
    ("log_1", 8, 48, 112, 48, 16, (48, 80)),
    ("blade_cold_1", 9, 20, 72, 12, 40, (24, 216)),
    ("blade_cold_2", 9, 98, 92, 12, 32, (24, 216)),
]


def main():
    sheet = np.asarray(Image.open(SHEET).convert("RGB")).astype(float)
    os.makedirs(os.path.join(TILES, "ground"), exist_ok=True)
    os.makedirs(os.path.join(TILES, "decal"), exist_ok=True)

    emitted = {}
    for name, pi, seed in GROUND:
        x0, y0 = panel_origin(pi)
        panel = sheet[y0:y0 + PANEL_H, x0:x0 + PANEL_W]
        ok = clean_cells(panel, seed)
        distinct = distinct_cells(panel, ok)
        assert distinct, f"no clean ground found for {name}"
        cells = same_tone(distinct, ground_colour(panel, seed))
        rng = np.random.default_rng(1234)
        patch = mosaic(cells, rng)
        emitted[name] = np.clip(patch, 0, 255).astype(np.uint8)
        Image.fromarray(emitted[name]).save(os.path.join(TILES, "ground", f"{name}.png"))
        print(f"ground/{name}.png  {int(ok.sum())} clean cells, {len(distinct)} distinct, {len(cells)} same-tone  tone={tuple(int(v) for v in patch.mean(axis=(0, 1)))}")

    # Two biomes sharing one texture is a decision; two biomes sharing one
    # texture BY ACCIDENT is a bug that looks like a decision. `grass_deep`
    # was once seeded from the same cell as `grass` and shipped
    # byte-identical, so jungle rendered exactly like grassland and nothing
    # flagged it. Cheap to check, so it is checked.
    names = list(emitted)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if emitted[a].shape == emitted[b].shape and np.abs(emitted[a].astype(int) - emitted[b].astype(int)).mean() < 1.0:
                raise SystemExit(f"ERROR: ground/{a}.png and ground/{b}.png are the same texture — reseed one of them")

    for name, pi, cx, cy, w, h, (gx, gy) in DECALS:
        x0, y0 = panel_origin(pi)
        region = sheet[y0 + cy:y0 + cy + h, x0 + cx:x0 + cx + w]
        ground = np.median(sheet[y0 + gy - 3:y0 + gy + 3, x0 + gx - 3:x0 + gx + 3].reshape(-1, 3), axis=0)
        alpha = keyed_alpha(region, ground)
        rgba = np.dstack([region, alpha * 255]).astype(np.uint8)
        Image.fromarray(rgba, "RGBA").save(os.path.join(TILES, "decal", f"{name}.png"))
        print(f"decal/{name}.png  {w}x{h}  {int((alpha > 0.5).sum())} solid px")


if __name__ == "__main__":
    main()
