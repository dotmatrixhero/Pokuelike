"""
Rips crop tile art out of legacy-cpp/data/sprites/"berry sprites.png" into
packages/web/public/tiles/food_<crop>.png.

`crops.ts` defines 15 real crops but only the four original berries (Oran,
Pecha, Sitrus, Cheri) ever had art -- the other eleven fell through to
`FLAVOR_GLYPH`'s coloured-letter rendering, including four that the cooking
recipes actually consume (apple, potato, tomato, corn).

The sheet is 4 bands x 16 plants, each plant drawn at three growth stages and
duplicated across two adjacent columns (so 32 content columns per band). Only
the ripe stage is taken, matching what the existing four berry tiles use.

These are fantasy berry plants, not photographs of crops, so each mapping below
is a judgement call about what reads as the crop at 20-odd pixels: the corn cob,
apple tree, wheat blades and mushroom caps are strong matches; rice, groundnut
and groundnut are the closest available shape rather than exact. Every one was
checked by eye on a checkerboard before being fixed here.

Background removal floods in from the cell border rather than keying out every
white pixel, so white *inside* a plant (highlights, pale petals) survives.

Usage: python3 packages/web/scripts/rip_crop_tiles.py [--write]
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

SHEET = "legacy-cpp/data/sprites/berry sprites.png"
OUT_DIR = "packages/web/public/tiles"
TILE_W, TILE_H = 21, 34  # matches the four berry tiles already in public/tiles

# crop id -> (band, column) of its ripe stage on the sheet
PICKS = {
    "apple": (2, 24),      # small tree hung with red fruit
    "corn": (1, 24),       # yellow cob on a stalk
    "wheat": (3, 26),      # tall golden blades
    "tomato": (0, 22),     # low red cluster
    "mango": (0, 20),      # heavy peach-orange fruit
    "potato": (3, 8),      # pale tuber lump close to the ground
    "mushroom": (0, 14),   # grey caps on bent stalks
    "rice": (0, 4),        # slim green grain stalk
    "groundnut": (3, 24),  # low green leaves over yellow pods
    "pumpkin": (3, 30),    # ridged golden gourd
    "herbs": (2, 20),      # loose leafy greens
}


def grid(a):
    """(row spans, column spans) of the sheet's content cells, found from its
    white gridlines rather than assumed."""
    white = np.all(a > 235, axis=-1)

    def spans(flags, n):
        hits = [i for i, v in enumerate(flags) if v > 0.9]
        bands, s, p = [], None, None
        for i in hits:
            if s is None:
                s = p = i
            elif i == p + 1:
                p = i
            else:
                bands.append((s, p))
                s = p = i
        if s is not None:
            bands.append((s, p))
        out, prev = [], 0
        for b0, b1 in bands:
            if b0 - prev > 6:
                out.append((prev, b0))
            prev = b1 + 1
        return out

    rows = spans([white[y].mean() for y in range(a.shape[0])], a.shape[0])[:12]
    cols = spans([white[:, x].mean() for x in range(a.shape[1])], a.shape[1])
    return rows, cols


def cut(cell):
    """Cell -> RGBA with the background removed by flooding in from the border,
    so pale pixels enclosed by the plant are kept."""
    h, w, _ = cell.shape
    bg = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            q.append((y, x))
    while q:
        y, x = q.popleft()
        if not (0 <= y < h and 0 <= x < w) or bg[y, x]:
            continue
        if cell[y, x].min() < 225:  # not background-pale: stop flooding here
            continue
        bg[y, x] = True
        q.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    rgba = np.dstack([cell, np.where(bg, 0, 255)]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA")
    img = img.crop(img.getbbox())
    out = Image.new("RGBA", (TILE_W, TILE_H), (0, 0, 0, 0))
    out.paste(img, ((TILE_W - img.width) // 2, TILE_H - img.height))
    return out


def ripped():
    a = np.asarray(Image.open(SHEET).convert("RGB")).astype(int)
    rows, cols = grid(a)
    ripe = [rows[2], rows[5], rows[8], rows[11]]
    out = {}
    for crop, (band, col) in PICKS.items():
        y0, y1 = ripe[band]
        x0, x1 = cols[col]
        out[crop] = cut(a[y0:y1, x0:x1])
    return out


if __name__ == "__main__":
    tiles = ripped()
    for crop, img in tiles.items():
        if "--write" in sys.argv:
            img.save(os.path.join(OUT_DIR, f"food_{crop}.png"))
        print(f"  food_{crop}.png {img.size}{' written' if '--write' in sys.argv else ''}")
