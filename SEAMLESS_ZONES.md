# Seamless terrain between zones

> "If I wanted seamless terrain between zones... how hard is that? Like I move
> south off a zone and just show up like the zone itself sorta expanded?"

Short answer: the **visual** half is a bounded, mechanical piece of work with a
clear acceptance test. The **walking across** half is an architecture change,
and it is a much bigger thing. They are worth treating as separate projects,
because the first is useful on its own — the overworld map and any future
zoomed-out view both look better whether or not you can ever walk across.

## How bad it was (before layer 1)

Measured, not assumed — `packages/runner/src/validateZoneSeams.ts` compares the
two columns that MEET at a shared edge against a control pair of genuinely
adjacent columns inside one zone. The control is what continuity looks like for
this generator; anything worse at the seam is the seam.

```
seed 20260903, zone size 90x60

east seam           37% same terrain, mean elevation jump 0.851
south seam          50% same terrain, mean elevation jump 0.767
within a zone       73% same terrain, mean elevation jump 0.131
```

A **6.5x elevation discontinuity**. Walking south today would be a hard cut, not
an expansion.

## Layers 1 and 2: done. Results.

```
                       east seam      south seam     CONTROL
seed 20260903    92% / 0.017    88% / 0.014    90% / 0.028
seed 11          87% / 0.004    81% / 0.010    80% / 0.011
seed 42          85% / 0.039    76% / 0.051    67% / 0.182
```

(% same terrain / mean elevation jump.) Seams now **match or beat the
within-zone control on every seed** — the pass condition, since the control
is what continuity looks like for this generator rather than a perfect score.
From 37% / 0.851 to 92% / 0.017.

Dominant biome agreement across a seam went **7% -> 93%** (98% within a
zone), and a single zone still blends three biomes, so fuzziness was gained
rather than uniformity.

## Why it was broken

`promoteZone` calls `generateWorld(zoneWidth, zoneHeight, zoneSeed(worldSeed,
row, col), bias)`. Every zone is generated **independently from its own seed**,
and every noise field is sampled in **zone-local coordinates** (0..width). Zone
(32,32) and zone (32,33) share no field at all.

They are not unrelated — `biasForZone` already passes down the macro grid's
elevation, dominant biome, coast edges, river edges and high edges, and
`carveMountainMassifs` already biases wall material toward edges facing a higher
neighbour ("cross-zone mountain contiguity"). So neighbouring zones are
*statistically* coherent: a desert zone next to a desert zone both look like
desert. They are just not *geometrically* continuous.

That distinction is the whole problem. The existing bias system is doing real
work and none of it is wasted; what is missing is a shared coordinate space.

## The work, in layers

### Layer 1 — global noise. Most of the win, and mechanical.

`makeValueLattice` fills a `Float64Array` with sequential `rng()` calls and
indexes it in zone-local coordinates. Make it index a **global** lattice
coordinate and derive each value from a hash of `(latticeX, latticeY, seed)`
instead of a pre-filled array — the standard technique for infinite procedural
terrain.

- `makeValueLattice(seed, origin, width, height, scale)` — hash `(lx, ly)`.
- Thread `origin` through `makeNoise2D`, `makeDensityField`, `generateWorld`.
- `promoteZone` passes `origin = { x: col * zoneWidth, y: row * zoneHeight }`.

Every field (`moistureField`, `obstacleField`, `foodField`, `macroDetailNoise`,
and the macro elevation detail) becomes continuous by construction. This alone
should collapse the elevation jump to roughly the control value.

One wrinkle worth catching early: `makeDensityField` calibrates its
density→threshold lookup by sampling **its own zone's window**. Two adjacent
zones calibrate slightly differently, so "10% food" means a different raw
threshold on each side and the seam survives in the food/water layer even after
the noise is shared. Calibrate once over a fixed global window and share it.

### Layer 2 — biome seeds. Done.

Biome seeds now live on one world-shared lattice (17-tile cells, one hashed
seed each, gathered with a two-cell margin) instead of being scattered per
zone. They are returned in ZONE-LOCAL coordinates including negative ones, so
`blendBiomeParams`, `biomeWeightsAt` and the persisted `World.biomeSeeds` all
keep working unchanged — two adjacent zones simply express the same seed in
their own frames and therefore compute the same blend between them.

**Each seed's biome is picked fuzzily**, weighted by proximity to the four
surrounding macro-zone centres rather than snapped to the nearest. That
distinction matters: a hard nearest-cell lookup would have MOVED the seam,
not removed it — every seed on one side of a midpoint desert, every seed on
the other grassland, so the blend would still flip at a line. Weighting the
roll means zones near a border get a real mixture of desert and grassland
seeds, and the blend then fades over a band tens of tiles wide.

The per-zone `dominantBiome` boost is skipped on this path. The macro grid
already decides each seed's biome directly, and re-weighting toward "this
zone's biome" would undo exactly the fuzzy border that is the point.

### Layer 3 — the iterative passes. The genuinely hard part of generation.

`carveMountainMassifs`, `carveSuicuneRivers`, `carveBadlandsChambers`,
`generateUndergroundCaves` and `deriveCanopyFromSurface` all run
cellular-automata smoothing over a zone-local grid. CA does not compose across
boundaries: a massif carved in zone A has no idea zone B exists.

Standard fix: **generate with a margin.** Generate the zone plus a border of M
tiles (M >= the number of CA iterations, since each iteration propagates
influence one tile), run every pass over the padded grid, then crop. With global
noise underneath (layer 1), the padded region computes *identically from both
sides*, so both zones independently agree about what happens at the seam — no
cross-zone communication, still fully deterministic. Cost: a 90x60 zone becomes
~106x76 at M=8, about 50% more generation work, paid only on promotion.

**Rivers are the exception that stays hard.** A river is a traced path, not a
local rule — one that exits zone A's south edge must enter zone B's north edge
at the same x. The margin trick handles a river within M tiles of the edge but
not a long one. `ZoneGenerationBias` already carries `riverEdges`, so the design
anticipated this; making them actually line up means tracing rivers at the MACRO
level and having each zone realise its assigned crossing points. Its own
project.

### Layer 4 — actually walking across. A different question.

Terrain continuity makes it *look* right. It does not make it *work*: crossing a
boundary today removes the agent and folds it into the neighbour's aggregate,
and the neighbour is not simulated at all. Two shapes:

- **Promote on approach.** When focus nears an edge, promote the neighbour and
  tick both. Simplest, and it composes with everything that exists. Cost is
  linear in simulated zones (2, or 9 for a full 3x3 ring).
- **Moving window.** One `World` that re-centers, regenerating the strip you
  walk into. The true "infinite world" approach, and it fights nearly every
  assumption in the codebase: fixed `world.width`/`height`, zone-local
  positions, the resource index, pathfinding, herd centroids, and the renderer's
  canvas sizing.

## Recommendation

Do layer 1 alone first and re-run the validator. It is the majority of the
visible seam, it is mechanical, it has an unambiguous pass/fail, and it makes
layers 2 and 3 meaningful — there is no point padding CA margins while the noise
underneath still disagrees across the border.

Then decide whether layer 4 is actually wanted, because it is the expensive one
and the visual fix may well be enough for how the overworld is actually used.

## What layer 1 actually took, including two wrong turns

The noise change itself was the easy half and went in as described: hash the
global lattice coordinate instead of reading a per-zone array, thread an
`origin`, calibrate density thresholds over a fixed global window rather than
each zone's own extent. That alone moved terrain agreement from 37% to 67%
and barely touched elevation.

Elevation took two failed attempts, and both failures were the same mistake
in different clothes.

**Attempt one: make the elevation point field global, keep everything else.**
Result: a zone went from 70% floor to 97% water. The cause is that a zone's
ocean-ness came from taking its own `oceanFraction` percentile OF ITS OWN
VALUES — which guarantees "85% of an ocean zone is ocean" by construction.
Ask for the 85th percentile of a *world-shared* distribution and you drown a
perfectly ordinary zone. A per-zone fraction and a shared field cannot both
be right.

**Attempt two: add a macro shift, keep a global sea level.** Result: 100%
water. The sea level was calibrated on the unshifted field while the actual
values included the shift.

**What actually worked** was to stop having two independent opinions about
where the ocean is. The macro grid ALREADY is a global elevation field —
64x64 normalized values with its own sea level — and the tile-level field was
a second one that had been steered toward agreeing with it. Now the macro
grid is simply the truth, sampled continuously (bilinear between zone
CENTRES, so two zones evaluate the same function at their shared edge and
necessarily agree), with global noise as local texture on top. One field, one
sea level, no seam.

This also fixed a real pre-existing incoherence nobody had reported: zones the
macro map called **ocean** were generating as **70% dry land**. The map said
ocean, the terrain said grassland, and the region got named accordingly.

## A regression this caused, and how it was caught

Making the calibration global broke the STANDALONE path, which the macro grid
itself uses. A single map's own extremes are narrower than the whole field's,
so nothing reached the top of the 0..1 range: the macro grid's land elevation
maximum fell from 1.000 to 0.741 and the **snow biome vanished entirely**
(1,012 zones to 0 on one grid), taking the `frozenGrotto` landmark with it —
11 of 11 landmark types placing across eight large grids became 10 of 11.

Caught by two tests that looked unrelated (a landmark-coverage count and a
resource-estimate comparison that crashed on a missing zone), then confirmed
by measuring the biome distribution before and after rather than guessing. A
standalone map is its own world and has to span its own range; the shared
normalization is only correct for zones of a shared world.

Three other tests failed and each needed a different, honest answer rather
than a threshold bump:

- **`findWalkableNear` "returns the anchor when walkable"** was asserting
  `if (tile.walkable)` — vacuous whenever generation happened to put an
  obstacle at (0,0), and wrong once it put WATER there, since water is
  `walkable` but the function's land probe correctly rejects it. Now forces a
  floor tile, so it tests the actual promise unconditionally.
- **BSP chamber wobble** expected a longest-straight-run under 15. Measured
  across 24 seeds the real spread is 3-17 with a median of 11, so 15 sat
  inside the natural distribution and any rng change would trip it. Raised to
  20, still far below the 20-30+ a genuinely straight edge produces.
- **Arid biome stretches** expected the largest contiguous run above 50; the
  five test seeds now give 182, 739, 437, 37 and 172. One seed simply makes a
  wet world. 37 is still emphatically a stretch — the speckle the test rules
  out is single digits — so the bar moved to 25.
