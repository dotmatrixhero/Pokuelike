"""
Rips all four facings x two walk frames for every Kanto species out of
legacy-cpp/data/sprites/"kanto sprites.png" into packages/web/public/sprites/.

WHY A RE-RIP RATHER THAN JUST ADDING FRAMES. The 604 sprites already shipped
are native 32x32 (their 2x2-block uniformity measures 0.62-0.81, nowhere near
the ~1.0 that would mean they had been upscaled from 16x16) and they draw at
exactly TILE_SIZE * SPRITE_SCALE = 32, i.e. 1:1 — so they were never being
compressed. What they lacked was walk frames. But only 27 of the 151 match this
sheet pixel-for-pixel, so most came from a different sheet; walk frames taken
from here would visibly jitter against those stand poses. Taking both frames
from this one sheet keeps every species internally consistent.

SHEET GEOMETRY, measured rather than assumed:
  * Block x-starts are read off a clean scanline: 0,65,130,195,259,324,389,...
    The grid DRIFTS, so a constant pitch is wrong by a pixel on most columns —
    enough to destroy exact matching entirely, which is how it was caught.
  * Rows are a clean 129 (128px block + 1px divider), 11 of them.
  * The last block column AND the last block row each overrun the image by a
    few pixels, so the sheet is edge-padded on both axes before slicing.
    Padding only the width silently dropped the entire final row — which is
    where Dragonite, Mewtwo and Mew live.

BLOCK LAYOUT, established from the species that match exactly:
    (0,0) up    stand   (1,0) up    step
    (2,0) down  stand   (3,0) down  step
    (0,1) right stand   (1,1) right step
    (2,1) left  stand   (3,1) left  step
These roles were not assumed from a charset convention — they were read off
Bulbasaur and Charizard, whose shipped sprites match cells here at a score of
0.0, so the cell each shipped file came from is known. That also means the
emitted `_left`/`_right` files keep exactly the same convention the existing
ones used, so `getSprite`'s deliberate left/right swap keeps working unchanged.

SPECIES -> BLOCK is dex order with two inserted blocks: an extra Venusaur at
index 3, and Pikachu occupying two blocks (25 male, 26 female — adjacent-block
similarity 16.6 against 159 for the next closest pair). Hence:

    block = (dex - 1) + (dex >= 4) + (dex >= 26)

A greedy best-match assignment was tried first and rejected: it reproduced all
27 exact anchors but still mis-assigned a handful elsewhere (Arcanine landed on
Venusaur's spare block), because once a block is taken the loser silently gets
the next best thing. The formula above was then verified by reading blocks
22-45 and 143-157 off the sheet directly — every one matches its predicted
species, through the ambiguous Pikachu/Nidoran stretch and all the way to Mew.

Two shipped sprites disagree with it: `sandslash_down.png` actually matches
block 28 (Sandshrew) and `nidoranf_down.png` matches block 29 (Sandslash). Those
are off-by-one MISLABELS in the old rip, not errors in the mapping — the sheet
itself plainly shows Raichu at 27, Sandshrew at 28, Sandslash at 29. This
re-rip corrects them.

Usage: python3 packages/web/scripts/rip_pokemon_frames.py [--write]
"""
import glob
import os
import re
import sys

import numpy as np
from PIL import Image

SHEET = "legacy-cpp/data/sprites/kanto sprites.png"
DEX_SRC = "packages/data/src/dex/species.generated.ts"
OUT_DIR = "packages/web/public/sprites"
BLOCK_X = [0, 65, 130, 195, 259, 324, 389, 454, 519, 584, 649, 714, 779, 844, 909]
BLOCK_Y = list(range(0, 11 * 129, 129))
BW, BH, FW, FH = 64, 128, 32, 32
ROLES = {
    (0, 0): ("up", 0), (1, 0): ("up", 1),
    (2, 0): ("down", 0), (3, 0): ("down", 1),
    (0, 1): ("right", 0), (1, 1): ("right", 1),
    (2, 1): ("left", 0), (3, 1): ("left", 1),
}


def load():
    a = np.asarray(Image.open(SHEET).convert("RGB")).astype(int)
    return np.pad(a, ((0, 8), (0, 8), (0, 0)), mode="edge")


def block(a, index):
    ci, ri = index % 15, index // 15
    if ri >= len(BLOCK_Y):
        return None
    x0, y0 = BLOCK_X[ci], BLOCK_Y[ri]
    b = a[y0:y0 + BH, x0:x0 + BW]
    if b.shape[0] < BH or b.shape[1] < BW:
        return None
    cols, counts = np.unique(b.reshape(-1, 3), axis=0, return_counts=True)
    bg = cols[counts.argmax()]
    cells = {}
    for r in range(4):
        for c in range(2):
            f = b[r * FH:(r + 1) * FH, c * FW:(c + 1) * FW]
            cells[(r, c)] = (f, ~np.all(f == bg, axis=-1))
    return cells if cells[(2, 0)][1].sum() >= 30 else None


def dex_numbers():
    src = open(DEX_SRC).read()
    return {k.lower().replace("_", ""): int(i)
            for i, k in re.findall(r'id:\s*(\d+),\s*\n\s*key:\s*"([A-Z0-9_]+)"', src)}


def block_for(dex):
    return (dex - 1) + (1 if dex >= 4 else 0) + (1 if dex >= 26 else 0)


def to_png(rgb, mask):
    return Image.fromarray(np.dstack([rgb, np.where(mask, 255, 0)]).astype(np.uint8), "RGBA")


def rip(write=False):
    a = load()
    dex = dex_numbers()
    species = sorted({os.path.basename(f).rsplit("_", 1)[0]
                      for f in glob.glob(OUT_DIR + "/*_down.png")
                      if not os.path.basename(f).startswith("human_")})
    written, skipped = 0, []
    for sp in species:
        d = dex.get(sp)
        if d is None or d > 151:
            skipped.append(sp)
            continue
        cells = block(a, block_for(d))
        if cells is None:
            skipped.append(sp)
            continue
        for cell, (direction, frame) in ROLES.items():
            rgb, mask = cells[cell]
            if mask.sum() < 20:
                continue
            name = f"{sp}_{direction}.png" if frame == 0 else f"{sp}_{direction}_{frame}.png"
            if write:
                to_png(rgb, mask).save(os.path.join(OUT_DIR, name))
            written += 1
    print(f"{len(species) - len(skipped)}/{len(species)} species, {written} frames{' written' if write else ''}")
    if skipped:
        print("skipped:", skipped)


if __name__ == "__main__":
    rip(write="--write" in sys.argv)
