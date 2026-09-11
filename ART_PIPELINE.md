# Art pipeline: ripping sheets and rendering them

How art gets from `legacy-cpp/data/sprites/*.png` onto the map, and the
mistakes that shaped each step. Every technique here exists because the
obvious version of it shipped something visibly wrong first.

Scripts live in `packages/web/scripts/`. Output lives in
`packages/web/public/sprites/` (agents) and `packages/web/public/tiles/`
(terrain, ground, decals).

---

## 0. The one rule

**Never conclude anything about art by reading code or by looking at a
thumbnail.** Measure it, or render it and look at it at 5-10x zoom.

Every wrong call in this project's art history came from skipping that:

| What was assumed | What was true |
|---|---|
| The sheet has a constant grid pitch | It drifts by 1px per column |
| Sprites at least 2 tiles wide are tiling surfaces | Two of them were trees |
| The source art avoids repetition with varied ground tiles | Its grass is ONE tile repeated byte-identical |
| An all-red panel is a lava biome | It's a flat red rectangle |
| The alpha key cut this decal cleanly | It punched holes through the middle |
| The black bars are a highlight box | They were baked into the source PNG |

Corollary: **a check that can only agree with you is not a check.** Reading
back a flag you just set, or measuring a region where the answer is trivially
"yes", proves nothing.

---

## 1. Recon the sheet before writing any code

Sheets in this repo are not uniform. Three different kinds have turned up:

- **Charsets** — a grid of characters, each a small grid of walk frames
  (`trainer sprites.png`: 80 characters, 10 x 8, each a 3 x 4 frame grid).
- **Species blocks** — a grid of blocks, each holding one creature's facings
  (`kanto sprites.png`: 11 rows of blocks, 4 x 2 cells each).
- **Pre-composed scenes** — *not a tileset at all*. `biome sprites unripped.png`
  is 14 finished 128 x 320 map panels drawn on an internal 16px grid. There is
  no tile atlas to slice; you are mining finished scenes for material.

Do this first, every time:

```python
im = Image.open(SHEET); print(im.size, im.mode)
# separators: fully-uniform rows/columns
rgb = np.asarray(im)[:, :, :3].astype(int)
print([i for i, v in enumerate(rgb.std(axis=(0, 2))) if v < 1.0])
```

Then **export the sheet at 3x with a grid overlay and coordinate labels, and
look at every panel.** This costs five minutes and is how the fake lava panel,
the perspective mushrooms, and the mushroom-wood-that-looked-like-a-stump-forest
were all caught.

```python
d.line([(gx * Z, 0), (gx * Z, H * Z)], fill=(255, 0, 255))
d.text((gx * Z + 2, 2), str(gx // 16), fill=(255, 255, 0))
```

---

## 2. Measure the geometry — never compute it from a pitch

**Grids drift.** Both real sheets here do:

- `trainer sprites.png`: nominally 96 x 128 per character. Real block starts on
  different rows read `0, 96, 192, 288, 479` and `0, 95, 191, 287, 383`; row
  bands measure `128, 127, 129, 128`.
- `kanto sprites.png`: block x-starts are `0, 65, 130, 195, 259, 324, 389, ...`
  A constant pitch of 64.73 is off by a pixel on most columns — enough that
  only Bulbasaur (offset 0) matched, which is how it was caught.

So: **find block edges per row-band from the flattest scanline in that band**,
not from a formula.

Two scanline strategies that were tried and rejected:

- *Fixed row near the band top* — over-splits wherever hair or a hat reaches the
  top of its cell.
- *Per-column dominant colour* — over-splits worse; a sprite outnumbers the
  background down its own middle columns.

Two more traps:

- **Trim on all four sides, not just left/right.** Trimming only horizontally
  left a neighbour's background bleeding in as a line under the sprites' feet.
- **Pad both axes before slicing.** The last block column *and* the last block
  row overran the image. Padding only the width silently dropped the entire
  final row — which is where Dragonite, Mewtwo and Mew live.

---

## 3. Establish the mapping with anchors, then a formula

When you need "which cell is which species/direction", do not guess a
convention and do not let an optimiser decide.

1. **Find exact anchors.** Compare against art already shipped; cells that
   match at a score of 0.0 tell you exactly where those came from.
2. **Read the roles off the anchors**, not off a charset convention. The trainer
   sheet reads cleanly as neither row-major nor column-major.
3. **Derive a closed-form mapping and then verify it by eye across the whole
   range.** Kanto is dex order with two inserted blocks:
   `block = (dex - 1) + (dex >= 4) + (dex >= 26)` — a spare Venusaur at 3,
   and Pikachu occupying two blocks (male/female; adjacent-block similarity
   16.6 against 159 for the next closest pair).

**Greedy best-match assignment is a trap.** It reproduced all 27 exact anchors —
it looked like success — and still put Arcanine on Venusaur's spare block,
because once a block is taken the loser silently gets the next best thing. It
was caught by ranking assignments by similarity and *looking at the worst 22*.

Where the sheet and shipped art disagree, work out which is wrong rather than
trusting the old rip: `sandslash_down.png` actually matched Sandshrew's block
and `nidoranf_down.png` matched Sandslash's — an off-by-one **mislabel** in the
old rip, proven by exact pixel comparison, not an error in the new mapping.

When a cell's role can't be read from layout, **classify it from its own
pixels**:

- horizontal self-mirror difference -> symmetric (up/down) vs. side-facing
- head-region distinct-colour count -> up (solid hair) vs. down (face)
- per-character skin palette -> which way a side frame faces

That last one matters: a first attempt used "the brightest pixels in the head"
and silently dropped **41 of 80** characters — hats, helmets, big hair and
dark-skinned characters all broke it. The fix was to learn each character's skin
palette by diffing their front view's head colours against their back view's,
and to decide left vs. right **relatively, within each mirror-matched pair**,
not against an absolute threshold. That holds for all 80.

---

## 4. Cutting art out of a background

Scene panels have no alpha. The cutout is four steps, and **all four are
needed** — each was added after the previous version shipped a visible fault.

### 4a. Key against the *local* ground colour

Sample the ground next to the crop, not a global constant:

```python
ground = np.median(sheet[y0+gy-3:y0+gy+3, x0+gx-3:x0+gx+3].reshape(-1, 3), axis=0)
alpha = np.clip((np.linalg.norm(region - ground, axis=2) - 45) / 30, 0, 1)
```

### 4b. Background is what *reaches the crop's edge*, not what the key matched

The raw key punches transparent holes straight through a decal anywhere its own
colour lands near the ground colour — the pale green inside a fern against
grass, the tan inside a mushroom cap against dirt. Direct report: *"Some are
transparent in the wrong spots."*

Flood-fill the keyed-out region from the crop border. Anything enclosed by the
decal is filled back in opaque.

**With a size cap.** Reeds and moss touch all four borders and enclose most of
their own crop, so unconditional hole-filling painted a solid rectangle behind
them. Fill an enclosed pocket only if it is under ~15% of the crop.

### 4c. Drop small opaque fragments that touch the crop edge

A crop out of a scene panel almost always clips a sliver of what's next door —
the lip of a snow drift, a stripe of pond, the corner of a bush. Those arrive as
their own little opaque islands hanging off the border.

Label connected opaque components; erase any that **both** touch the border
**and** are under ~20% of the largest component. Something that touches the
border and is big (a tuft cluster drawn wider than its crop) is kept.

### 4d. Erase sheet grid rules

Several sheets draw a 1px black rule between cells, and a crop on the cell
boundary keeps it as a fully opaque pure-black edge row.

This is not cosmetic. All seven `seedling_*.png` carried one. Squashed into a
20px box it passed for part of the sprite; the moment plants were drawn at true
aspect it became **a crisp black bar one tile wide floating above every
seedling** — 47 of them in a single frame. `strip_sheet_gridlines.py` clears
any edge row/column that is >90% opaque and entirely under level 12. It's
idempotent, and it also caught a left-edge rule on `food_cheri.png`.

### 4e. For a separated object, key against the ground's PALETTE and cut by blob

4a–4d cut a *hand-cropped rectangle*. That works for ground detail (tufts,
blossoms, moss) and fails for anything the artist drew as a separate object on
open ground — a stump, a log, a boulder, a mushroom cluster. Hand-cropping
those is a trap with no winning move: a crop tight enough to exclude the
neighbouring bush runs through the decal's own edge, and a crop loose enough to
hold the whole decal drags the bush in with it. Both are visible on a
checkerboard — half a log, or a log welded to a block of grass.

Three keys were tried against one crop (a cut stump on panel 5's forest grass)
before one worked:

| Key | What it measured | Why it failed |
| --- | --- | --- |
| Hand-picked seed pixel | one colour | lands on the wrong side of a two-ground crop, or on a neighbouring fern |
| Median of the crop's rim | one colour | a scene crop's rim is routinely pale grass on one side and dark canopy on the other; the median sits between them, matches neither, and the canopy half survives as a solid block |
| k-means tones off the rim | 3 colours | the cluster **means** sit up to 33 away from the ground pixels they came from — further than the stump sits from the grass. No threshold separated them. |

The fix is to stop averaging. **This is pixel art: the ground is not a colour
and not three colours, it is a palette of about twenty exact values, and every
ground pixel is one of them exactly.** Take every colour that appears at least
twice on the crop's rim and key against the distance to the *nearest* of them.
The same crop then reads **0–7 on ground and 22–33 on the stump**.

That separation is what lets the floor drop from `lo=45` to `lo=9`, and the low
floor is what makes the rest work:

```python
alpha = keyed_alpha(region, border_palette(region), lo=9, hi=15)
# keep only the connected blob the point landed in, plus blobs within a few
# pixels of it (a mushroom cluster is several blobs)
# the tight crop falls out of that blob's bounding box
```

So you never tune a coordinate against the neighbour. You point at the object
inside a generous box whose **rim is clear ground**, and the neighbour is
dropped because it is a different blob. Pass `None` for the point and the cut
takes the pixel furthest from the ground palette — needed for sparse objects
(a grass tuft is strokes with ground showing between them, and there is no
reliable pixel to point at by eye).

Two things this still cannot cut, both real and both worth knowing:

* **An object drawn wider than any clean-rim box.** Panel 10's cobwebs are
  drawn wide, so the web's own white reaches the rim of every box containing
  it, the key adopts white as a ground colour, and what survives is the green
  shadow the web was drawn over.
* **A detail drawn *on* a band rather than standing on ground.** Panel 4's
  "boulders" are bumps outlined on a cliff face in the cliff's own colour.
  Three were cut and all three came back as background — correctly.

---

## 5. Verify the rip before wiring it up

- **Contact-sheet every crop at 5-9x on a checkerboard**, and on the real
  ground it will actually sit on. A decal that looks fine on grey checks can
  read as a green swatch on sand.
- **Count solid pixels.** `rubble_1` came out at **0** solid pixels and
  `rubble_2` at 18 — both were silently empty crops that a thumbnail would not
  have shown.
- **Prove transparency on a checkerboard**, don't assert it.
- **Count distinct cells** when mining ground: `byte-unique`, plus a
  perceptual-distance dedupe. That number is often the finding (see §6a).
- **Ask whether the art's projection matches the map's.** Panel 3's mushrooms
  cut cleanly and still looked like smudges at 20px, because they are drawn in
  *perspective* — caps seen from the side on long stems — and the map is
  top-down. The cutout was fine; the art was wrong for the use. Direct report:
  *"the mushroom decals are a little messy."*

---

## 6. Rendering ripped art without drawing a grid

Good art renders badly if the renderer reintroduces the grid. Four independent
causes were found in one pass, all by measuring live frames.

### 6a. Sample ground in WORLD space, not per tile

One 16x16 crop stamped at every tile origin *is* a drawn grid. Ground patches
are 6x6 source cells (`GROUND_CELL = 16`, `GROUND_PATCH_CELLS = 6`) and tile
`(x, y)` draws cell `(x % 6, y % 6)`, so neighbouring tiles draw neighbouring
source pixels.

**But measure what that buys you first.** On this sheet:

| ground | clean cells | byte-unique | same-tone (usable) |
|---|---|---|---|
| water | 14 | **1** | 1 |
| grass | 15 | **1** | 1 |
| grass_deep | 23 | **1** | 1 |
| cave | 26 | 2 | 1 |
| sand | 47 | 2 | 1 |
| snow | 18 | 6 | 5 |
| dirt | 40 | 14 | 5 |
| field | 44 | 31 | 9 |
| stone | 49 | 42 | 11 |

`byte-unique` is how many genuinely different ground tiles the artist drew;
`same-tone` is how many survive the §6b tone filter and actually go into a patch.

The source art **does not avoid tiling repetition with base variety** — its
grass and water are one tile repeated byte-identical. What makes those panels
read as organic is the scatter layer (§6b) and irregular non-grid boundaries.
World-space windowing is still right, but it only pays for snow, dirt, field
and stone — for grass, water and sand the patch is one cell and the win comes
entirely from the scatter layer.

### 6b. A mosaic of tonally different cells is itself a checkerboard

Assembling a patch from several source cells only works if they are *detail*
variants of one surface. Cells within a panel differ in mean colour by up to
15 (sand), 30 (dirt), 43 (field) — those are a sunlit patch and a worn track,
not variants, and laying them out paints a checkerboard of coloured squares.

Keep only cells within `TONE_SPREAD = 8.0` of the modal tone.

Also: **do not cross-fade pixel art.** A photographic-style quilt with feathered
overlaps was tried first; blending invents off-palette colours and softens every
edge, and the result was a visibly blurry smear. These are tileset tiles — the
artist drew them to butt against each other — so hard joins are both faithful
and invisible. Flips multiply the pool without inventing anything.

### 6c. Decals go off-grid, in a pass of their own

A decal masked to exactly one tile and drawn at the tile origin is a perfect
lattice of rounded squares. Instead:

- draw decals at **native size** (a 32x24 decal straddles two tiles)
- at **hash-jittered sub-tile offsets**, from a second hash independent of the
  "does this tile get one" hash, so two tiles that rolled the same decal don't
  also land at the same offset
- in a **separate pass after every base tile is down**, or the overhang gets
  overpainted by the next tile's base and only ever survives up and left
- sparsely (`SCATTER_ONE_IN = 7`), from a per-biome pool

### 6d. Any per-tile lighting is a grid

Elevation shading applied per tile quantises a smooth field into flat
rectangular plateaus. Measured on a live frame: two adjacent ground regions read
`231,224,182` and `195,182,141` — a uniform 0.84 multiply with a hard
rectangular boundary.

Rasterise the field **one pixel per tile**, then upscale to map size with
`imageSmoothingEnabled = true` and let the browser's bilinear filter do the
interpolation in one `drawImage`. Cache it (elevation doesn't change) and
restore the smoothing flag afterwards, since it's off globally on purpose.

The same trick does shape, not just shading: the water body's mask is
rasterised a pixel per tile, upscaled, and thresholded (`WATER_THRESHOLD = 0.42`
with a soft ramp). Any two tiles that touch — orthogonally *or diagonally* —
come out above the threshold in between.

**Why not per-tile shapes:** two attempts failed. Full squares give a literal
staircase. Rounded/inset per-tile shapes flush on water-facing sides fix lakes,
but every tile of a diagonal river has land on all four sides and becomes a
circle — with gaps (*"the rivers have holes in em"*), or once bridged, beads
(*"Looks like train tracks. Not contiguous.."*). No per-tile rule can fix it,
because **two diagonal tiles share a point, not an edge.**

### 6e. Keep the source aspect ratio

Objects that stand on a tile — trees, bushes, berry plants — must keep their
aspect. Berry plants are 21x34 and trees 32x42 to 48x57; drawn into a 20x20 box
they were compressed by a third and read squat.

Fit **width** to the tile, keep the ratio, anchor the base on the tile's bottom
edge, cap the height (`STANDING_MAX_TILES = 1.7`). Tiles draw top-to-bottom, so
the overflow lands on rows already painted.

Related: **never infer "is this a tiling surface?" from image size.** The old
rule was "at least 2 tiles across", and `tree_6` (48x55) and `tree_7` (48x57)
clear it — so two of seven tree variants rendered as a random 20x20 crop out of
the middle of a tree. Direct report: *"The trees are kina incorrectly cropped
there."* Gate it on terrain kind (`mud`, `wall`), explicitly.

### 6f. Fidelity

- `ctx.imageSmoothingEnabled = false` — and set it **after** every
  `canvas.width`/`height` assignment, which resets it.
- CSS `image-rendering: pixelated` only at or above 1:1. Below 1:1 nearest-
  neighbour *deletes* rows: a 1800x1200 canvas shown at 1440x960 drops every
  5th row and column, and one-pixel features vanish (*"Krabbys left eye is
  missing a black pixel"*). Use `auto` below 1:1 — soft beats missing.
- Per-tile animation phase is a grid artifact. Water tiles animating out of step
  made open water shimmer in squares; one global frame tiled as a pattern is
  both calmer and cacheable as one image.
- A texture that is mostly walked on wants to be the *calmest* option
  available, not the most detailed: the first cave floor pick was chunky cobble
  (*"Rock floor looks a little chunky"*), replaced with a fine even pebble.
- Biome art is a surface concept. The underground shares the surface's
  coordinates, so a cave under a highland zone rendered as grey rock slabs —
  force the cave floor on non-surface layers.

---

## 7. Debugging a visual artifact

**Instrument the canvas. Don't guess.**

For the black bars, four guesses from reading the code — highlight boxes, move
flashes, a missing emoji glyph, the fertile-patch stamp — were all wrong, and
two were disproven by disabling the code and re-counting the artifact. What
found it in one shot:

```js
// addInitScript: wrap the draw calls on the scene canvas
for (const name of ['fillText', 'drawImage', 'fillRect', 'strokeRect']) {
  const orig = CanvasRenderingContext2D.prototype[name];
  CanvasRenderingContext2D.prototype[name] = function (...args) {
    if (this.canvas.id === 'scene' && window.__trace) window.__ops.push({ name, dx, dy, stack });
    return orig.apply(this, args);
  };
}
```

Then, **in the same `page.evaluate`**, trace one frame *and* dump the canvas:

```js
window.__ops = []; window.__trace = true;
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
window.__trace = false;
return { ops: window.__ops, png: document.getElementById('scene').toDataURL('image/png') };
```

Find the artifact's pixels programmatically, then correlate their coordinates
against the ops list. Every bar matched a `seedling_*.png` draw at exactly its
position.

Two things this depends on:

- **Trace and dump the same frame.** A first attempt traced a frame at tick 0
  with nothing happening and found zero artifacts.
- **Detect the artifact by shape, not by eye.** "Isolated 1px horizontal runs
  14-26px long with nothing above or below" gave a hard count — 47 before, 0
  after — which is what makes the fix provable.

Other things worth knowing:

- **`page.screenshot()` captures the CSS-scaled view.** At 0.8 that's a
  downscale, and every screenshot in one session was silently lossy.
  `canvas.toDataURL()` gives true 1:1 pixels.
- **Screenshot in daylight.** The first before/after pair was taken at in-sim
  midnight with a 0.55-alpha night wash and everything looked like mud. Drive
  the clock (`#speed` to max, `#play-pause`, wait for `#clock-label` to read
  10:00-14:00) before judging any colour.
- **The world is reachable** in dev via `window.__pokuelike.world` — use it to
  answer "is that actually water?" with topology instead of squinting. It was:
  43.8% of the map, 2364 tiles, 1426 with all four orthogonal neighbours water,
  44 with none.
- **Every measurement needs a control.** "8-10 fps" meant nothing until the same
  numbers were taken on the previous commit (8.2 paused, before; 10.0 after) —
  the app was always that slow in software-rendered headless.

---

## 8. Checklist for a new rip

1. Print size/mode; scan for uniform separator rows and columns.
2. Export every panel/block at 3x with a labelled grid overlay. **Look at it.**
3. Measure block edges per band from a clean scanline. Pad both axes.
4. Anchor the mapping against shipped art; prefer a formula; eyeball the worst
   matches, not just the best.
5. Cut: local key -> border-connected flood fill (size-capped) -> drop small
   edge fragments -> strip grid rules.
6. Contact-sheet at 5-9x on a checkerboard **and** on the real destination
   ground. Count solid pixels. Count distinct cells.
7. Wire it up, render it live, dump the canvas at true 1:1 in daylight, and
   zoom in.
8. Commit the script. Three earlier rips were never committed, which is why
   every sheet's layout had to be re-derived from scratch.

---

## 9. Script index

| Script | Sheet | Output |
|---|---|---|
| `rip_pokemon_frames.py` | `kanto sprites.png` | 1208 frames, 151 species x 4 facings x 2 walk frames |
| `rip_trainer_sprites.py` | `trainer sprites.png` | 72 files: 6 picked roles x 4 facings x 3 frames (all 80 characters are parsed and classified; `ROLES` picks which 6 ship) |
| `rip_crop_tiles.py` | `berry sprites.png` | 11 crop tiles (the other 4 `food_*` predate it) |
| `rip_biome_ground.py` | `biome sprites unripped.png` | 9 ground patches + 15 scatter decals |
| `strip_sheet_gridlines.py` | *(maintenance)* | clears baked-in grid rules from any tile |

`rip_pokemon_frames.py`, `rip_trainer_sprites.py` and `rip_crop_tiles.py` take
`--write`; without it they print what they would emit. `rip_biome_ground.py`
and `strip_sheet_gridlines.py` write directly — both are cheap to re-run and
their output is checked in, so `git diff` is the dry run.
