#!/usr/bin/env python3
"""Erase leftover sheet grid lines from ripped tile art.

Several source sheets draw a 1px black rule between cells. A rip that crops on
the cell boundary keeps that rule, and it arrives as a fully opaque pure-black
row or column along the edge of the sprite.

That is not cosmetic. `seedling_1..7.png` all carried a black top row, and once
renderer.ts started drawing plants at their true 21x34 aspect instead of
squashing them into a 20x20 box, the row rendered as a crisp black bar floating
one tile wide above every seedling. Direct report: "The black lines are
problematic too" / "You see the straight lines around the tiles with berries on
em?" Found by tracing every canvas draw in one frame and correlating the
artifact's pixels with the draw that produced them -- reading the art alone
would not have shown it, because squashed into 20px the row just looked like
part of the sprite.

Erases (sets alpha 0 on) any edge row/column that is almost entirely opaque and
pure black. Idempotent, and a no-op on art that never had the rule.
"""
import os
import sys

import numpy as np
from PIL import Image

TILES = os.path.join(os.path.dirname(__file__), "..", "public", "tiles")
# A "rule" is near-black and near-fully-opaque across the whole edge. A real
# sprite edge that happens to be dark is never both.
MAX_LEVEL = 12
MIN_OPAQUE = 0.9


def is_rule(line):
    opaque = line[:, 3] > 128
    return opaque.mean() > MIN_OPAQUE and line[opaque][:, :3].max() <= MAX_LEVEL


def strip(path):
    a = np.asarray(Image.open(path).convert("RGBA")).astype(int)
    edges = []
    if is_rule(a[0]):
        a[0, :, 3] = 0
        edges.append("top")
    if is_rule(a[-1]):
        a[-1, :, 3] = 0
        edges.append("bottom")
    if is_rule(a[:, 0]):
        a[:, 0, 3] = 0
        edges.append("left")
    if is_rule(a[:, -1]):
        a[:, -1, 3] = 0
        edges.append("right")
    if edges:
        Image.fromarray(a.astype(np.uint8), "RGBA").save(path)
    return edges


def main():
    import glob

    changed = 0
    for path in sorted(glob.glob(os.path.join(TILES, "*.png"))):
        edges = strip(path)
        if edges:
            changed += 1
            print(f"{os.path.basename(path)}: cleared {', '.join(edges)}")
    print(f"{changed} file(s) changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
