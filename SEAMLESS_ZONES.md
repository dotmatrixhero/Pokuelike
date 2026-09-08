# Seamless terrain between zones

> "If I wanted seamless terrain between zones... how hard is that? Like I move
> south off a zone and just show up like the zone itself sorta expanded?"

Short answer: the **visual** half is a bounded, mechanical piece of work with a
clear acceptance test. The **walking across** half is an architecture change,
and it is a much bigger thing. They are worth treating as separate projects,
because the first is useful on its own — the overworld map and any future
zoomed-out view both look better whether or not you can ever walk across.

## How bad is it today

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

## Why

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

### Layer 2 — biome seeds. Contained.

`placeBiomeSeeds` scatters seed points in zone-local space and
`blendBiomeParams` blends from them, so biome identity jumps at the border.
Scatter seeds per macro cell deterministically from `(row, col, worldSeed)`, and
when generating a zone include the seeds from the 8 neighbouring cells so the
blend is continuous across the edge.

Bonus: this also makes `biomeWeightsAt` globally coherent, which weather
(`pickWeatherType`) and herd place-naming both read.

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
