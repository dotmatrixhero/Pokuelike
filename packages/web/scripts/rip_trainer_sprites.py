"""
Rips human/NPC overworld sprites out of legacy-cpp/data/sprites/"trainer
sprites.png" into packages/web/public/sprites/.

The sheet holds 80 characters laid out 10 across and 8 down, each a 3x4 grid of
walk frames (3 frames x 4 facings) on its own flat background colour.

TWO things here are deliberately measured rather than assumed, both because
assuming them produced visibly wrong output first:

1. THE GRID DRIFTS. It is very nearly 96x128 per character but not exactly --
   real block starts on different rows read 0,96,192,288,479,... and
   0,95,191,287,383,..., and the row bands measure 128,127,129,128,... Cutting
   a fixed 96x128 grid bled a neighbouring block's background into sprite
   frames as stray coloured lines. So block edges are found per row-band from a
   clean scanline, and every frame is then found from its own content.

2. THE FRAME ORDER IS NOT A STANDARD CHARSET. It reads cleanly as neither
   row-major nor column-major directions. So no packing convention is assumed;
   each cell is classified from its own pixels:
     * horizontal self-mirror difference -> symmetric (up/down) vs side
     * head-region distinct-colour count -> up (solid hair) vs down (face)
     * per-character skin palette        -> which way a side frame faces

   The skin palette is learned per character by diffing the colours in their
   front view's head against their back view's head. A first attempt used
   "brightest pixels in the head" and silently dropped 41 of 80 characters --
   hats, helmets, big hair and dark-skinned characters all broke it. Left vs
   right is decided *within* each mirror-matched pair (a relative call, not an
   absolute threshold), which is what makes it hold for all 80.

Usage: python3 packages/web/scripts/rip_trainer_sprites.py [--write]
"""
import os
import sys

import numpy as np
from PIL import Image

SHEET = "legacy-cpp/data/sprites/trainer sprites.png"
OUT_DIR = "packages/web/public/sprites"
OUT = 32  # emitted frame size, matching the Pokemon sprites already in public/
DIRECTIONS = ("down", "up", "left", "right")


def load():
    return np.asarray(Image.open(SHEET).convert("RGB")).astype(int)


def _runs(vals):
    out, cur, s = [], tuple(vals[0]), 0
    for i in range(1, len(vals)):
        t = tuple(vals[i])
        if t != cur:
            out.append((s, i - s))
            cur, s = t, i
    out.append((s, len(vals) - s))
    return out


def row_bands(a):
    """The 8 character rows, measured from a column that is pure background."""
    return [(s, s + ln) for s, ln in _runs(a[:, 2]) if 110 <= ln <= 145]


def blocks_in_band(a, y0, y1, expect_w=96):
    """Character x-ranges within one row band, read off the flattest scanline in
    that band -- the gap between two sprite rows, which is pure background right
    across all ten characters. (Two rejected attempts: a fixed scanline near the
    band top over-split on rows where hair and hats reach the cell top, and each
    column's dominant colour over-split worse still, since a sprite outnumbers
    background down the middle columns of its own cell.) Adjacent characters
    sometimes share a background colour, so a run that is a multiple of the
    expected width is split evenly."""
    best = min(range(y0, y1), key=lambda y: len(_runs(a[y, :])))
    out = []
    for s, ln in _runs(a[best, :]):
        n = max(1, int(round(ln / expect_w)))
        step = ln / n
        for k in range(n):
            out.append((int(s + k * step), int(s + (k + 1) * step)))
    return out


def _groups(flags, min_gap=2):
    """Index ranges of runs of True, separated by at least min_gap False."""
    out, start, gap = [], None, 0
    for i, v in enumerate(flags):
        if v:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                out.append((start, i - gap + 1))
                start = None
    if start is not None:
        out.append((start, len(flags)))
    return out


def frames_of(a, x0, x1, y0, y1):
    """The 12 (rgb, mask) frames of one character, each found by its own
    content rather than by cutting a fixed grid. Returns None if the character
    does not segment into a clean 3x4."""
    # Trim a 2px margin on ALL FOUR sides: where a detected edge is a pixel or
    # two off, the neighbouring block's (or the credit banner's) flat colour
    # leaks in, and since it is not this block's dominant colour it survives the
    # background knock-out and shows up as a stray coloured line under the
    # sprite's feet. Trimming only left/right left exactly that artefact behind.
    b = a[y0 + 2:y1 - 2, x0 + 2:x1 - 2]
    cols, counts = np.unique(b.reshape(-1, 3), axis=0, return_counts=True)
    bg = cols[counts.argmax()]
    m = ~np.all(b == bg, axis=-1)
    colg = _groups(m.any(axis=0))
    rowg = _groups(m.any(axis=1))
    # Content segmentation is preferred (it is immune to the sheet's grid
    # drift), but on roughly a third of the characters the poses are wide
    # enough that neighbouring frames touch and the gaps vanish. Fall back to
    # an even 3x4 split of the block, which is safe now that the block's own
    # bounds were measured rather than assumed.
    if len(colg) != 3:
        colg = [(round(i * b.shape[1] / 3), round((i + 1) * b.shape[1] / 3)) for i in range(3)]
    if len(rowg) != 4:
        rowg = [(round(i * b.shape[0] / 4), round((i + 1) * b.shape[0] / 4)) for i in range(4)]
    out = []
    for r0, r1 in rowg:
        for c0, c1 in colg:
            sub_m = m[r0:r1, c0:c1]
            if sub_m.sum() < 40:
                return None, bg
            out.append((b[r0:r1, c0:c1], sub_m))
    return out, bg


def head_slice(f, m):
    ys, _ = np.nonzero(m)
    cut = ys.min() + max(1, int((ys.max() - ys.min()) * 0.5))
    return f[ys.min():cut], m[ys.min():cut]


def head_colours(f, m):
    hf, hm = head_slice(f, m)
    return np.unique(hf[hm].reshape(-1, 3), axis=0).shape[0] if hm.sum() else 0


def mirror_diff(f, m):
    ys, xs = np.nonzero(m)
    sub = f[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return np.abs(sub - sub[:, ::-1]).mean()


def skin_palette(down, dmask, up, umask):
    df, dm = head_slice(down, dmask)
    uf, um = head_slice(up, umask)
    return {tuple(c) for c in df[dm].reshape(-1, 3)} - {tuple(c) for c in uf[um].reshape(-1, 3)}


def face_offset(f, m, palette):
    """Where this character's skin sits horizontally within their sprite box.
    Negative = face toward the left, so the frame faces left."""
    if not palette:
        return 0.0
    hit = np.zeros(m.shape, bool)
    for c in palette:
        hit |= np.all(f == np.array(c), axis=-1)
    hit &= m
    if hit.sum() == 0:
        return 0.0
    xs = np.nonzero(m)[1]
    return float(np.nonzero(hit)[1].mean() - (xs.min() + xs.max()) / 2)


def mirror_pairs(frames):
    """Match six side frames into three mirror twins: a left frame and its right
    twin are the same drawing flipped."""
    sq = []
    for f in frames:
        g = np.zeros((max(x.shape[0] for x in frames), max(x.shape[1] for x in frames), 3))
        g[:f.shape[0], :f.shape[1]] = f
        sq.append(g)
    cost = {(i, j): np.abs(sq[i][:, ::-1] - sq[j]).mean()
            for i in range(len(sq)) for j in range(len(sq)) if i != j}
    used, pairs = set(), []
    for (i, j) in sorted(cost, key=cost.get):
        if i not in used and j not in used:
            used |= {i, j}
            pairs.append((i, j))
    return pairs


def order_walk(items):
    """[stand, step, step]. The two mid-stride frames closely resemble each other
    (opposite legs, a few pixels apart at this size), so the standing pose is the
    odd one out. Verified by eye across all four facings."""
    def d(a, b):
        h = min(a.shape[0], b.shape[0])
        w = min(a.shape[1], b.shape[1])
        return np.abs(a[:h, :w] - b[:h, :w]).mean()
    sums = [sum(d(f, g) for g, _ in items) for f, _ in items]
    stand = int(np.argmax(sums))
    return [items[stand]] + [it for i, it in enumerate(items) if i != stand]


def classify(frames):
    stats = [(f, m, mirror_diff(f, m), head_colours(f, m)) for f, m in frames]
    order = sorted(range(12), key=lambda i: stats[i][2])
    sym = sorted(order[:6], key=lambda i: stats[i][3])
    up, down, asym = sym[:3], sym[3:], order[6:]

    pal = skin_palette(stats[down[0]][0], stats[down[0]][1], stats[up[0]][0], stats[up[0]][1])
    off = {i: face_offset(stats[i][0], stats[i][1], pal) for i in asym}
    left, right = [], []
    for i, j in mirror_pairs([stats[k][0] for k in asym]):
        a, b = (asym[i], asym[j]) if off[asym[i]] <= off[asym[j]] else (asym[j], asym[i])
        left.append(a)
        right.append(b)
    if len(left) != 3 or len(right) != 3:
        return None
    return {d: order_walk([(stats[i][0], stats[i][1]) for i in v])
            for d, v in (("down", down), ("up", up), ("left", left), ("right", right))}


def to_png(f, m):
    """Content -> a 32x32 RGBA tile, centred horizontally and bottom-aligned so
    every facing plants its feet on the same line (renderer.ts bottom-anchors)."""
    rgba = np.dstack([f, np.where(m, 255, 0)]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA").crop(Image.fromarray(rgba, "RGBA").getbbox())
    out = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    out.paste(img, ((OUT - img.width) // 2, OUT - img.height - 1))
    return out


def characters(a):
    """-> {(col,row): classified frames} for every character on the sheet."""
    out = {}
    for ry, (y0, y1) in enumerate(row_bands(a)):
        for rx, (x0, x1) in enumerate(blocks_in_band(a, y0, y1)):
            fr, _ = frames_of(a, x0, x1, y0, y1)
            out[(rx, ry)] = classify(fr) if fr else None
    return out


def rip(assignments, write=False):
    """assignments: {spriteKey: (col,row)}. Emits <key>_<dir>.png (the standing
    pose, which getSprite already loads) plus <key>_<dir>_1/_2.png walk frames."""
    chars = characters(load())
    for key, pos in assignments.items():
        g = chars.get(pos)
        if g is None:
            print(f"  !! {key}: character {pos} failed to segment/classify")
            continue
        for d in DIRECTIONS:
            for n, (f, m) in enumerate(g[d]):
                name = f"{key}_{d}.png" if n == 0 else f"{key}_{d}_{n}.png"
                if write:
                    to_png(f, m).save(os.path.join(OUT_DIR, name))
        print(f"  {key}: {pos} -> 12 frames{' written' if write else ''}")


# Which character on the sheet plays which role, as (column, row) counting from
# the sheet's top-left. Every one of these six was checked by eye across all
# four facings before being fixed here -- `confidence()` narrowed the field, but
# the eye made the call (a bald monk and a wide straw hat both defeat the
# automatic front/back test, so a high score is a filter, not a guarantee).
ROLES = {
    "human_player": (0, 5),    # red cap, the classic protagonist read
    "human_hunter": (5, 7),    # bearded man in olive field gear
    "human_forager": (8, 0),   # straw hat and work clothes, reads as a farmer
    "human_traveler": (9, 6),  # green bandana, light travelling clothes
    "human_merchant": (2, 6),  # peaked cap and gold-trimmed coat, a trader
    "human_wanderer": (6, 7),  # bald, white beard, plain robe -- the monk read
}


if __name__ == "__main__":
    if "--write" in sys.argv:
        rip(ROLES, write=True)
    else:
        chars = characters(load())
        ok = sum(1 for v in chars.values() if v)
        print(f"{ok}/{len(chars)} characters segment and classify cleanly")
        if bad := [k for k, v in chars.items() if not v]:
            print("failed:", bad)
        rip(ROLES, write=False)


def confidence(g):
    """How trustworthy this character's direction classification is.
    Bald heads and very large hats can defeat the front/back test (the back of a
    bald head is as skin-coloured as the face), and when that goes wrong the
    left/right split goes with it -- so candidates are scored rather than
    trusted blindly. Higher is better."""
    if g is None:
        return -1e9
    down, up = g["down"][0], g["up"][0]
    face_gap = head_colours(*down) - head_colours(*up)
    lf, lm = g["left"][0]
    rf, rm = g["right"][0]
    h = min(lf.shape[0], rf.shape[0])
    w = min(lf.shape[1], rf.shape[1])
    mirror = np.abs(lf[:h, :w][:, ::-1] - rf[:h, :w]).mean()
    side_vs_front = np.abs(mirror_diff(lf, lm) - mirror_diff(*down))
    return face_gap * 10 - mirror * 0.5 + side_vs_front
