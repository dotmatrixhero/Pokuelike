import type { Agent, BiomeSeedInfo, Layer, Vec2, World } from "./types.js";
import { createWorld, setElevation, setTile, tileAt } from "./world.js";
import { pickCrop } from "./crops.js";
import { mulberry32 } from "./rng.js";
import { canEnterWater } from "./waterBody.js";
import type { ZoneDirection } from "./directions.js";
import type { LandmarkType } from "./landmarks.js";

/**
 * Stand-in for `canEnterWater`'s `agent` parameter — an ordinary land
 * species (no `types`, not obligate-aquatic) — used by `findWalkableNear`
 * below so it asks the same question `canEnterWater` already answers for
 * movement ("can a plain land Pokémon actually stand here"), rather than a
 * second, duplicated water-body check. Real bug this closes: `.walkable` is
 * true for water tiles too (see `waterBody.ts`'s own doc comment —
 * `UNWALKABLE_TERRAIN` never lists "water"), so a hand-placed or biome-
 * scored spawn point could previously land dead-center in a large lake, a
 * tile `canEnterWater` would then permanently refuse to let a non-water
 * agent step off of — stranded from tick 0. Deliberately reused by every
 * `findWalkableNear` caller, not opt-in: the handful of callers that
 * actually want a genuine water tile (obligate-aquatic placement) already
 * go through a different, water-specific primitive (`findWaterNear` in
 * `@pokuelike/data`'s scenario.ts, `findNearestIndexed(..., "water")` in
 * immigration.ts) rather than `findWalkableNear`, so nothing that needed
 * water was ever relying on this function returning one.
 */
const LAND_PROBE: Agent = { types: [] } as unknown as Agent;

// Re-exported for backward compatibility — this used to be defined here
// (every existing import site, e.g. worldgen.test.ts, still does
// `import { mulberry32 } from "./worldgen.js"`) before it moved to its own
// dependency-free rng.ts so world.ts could import it too without a
// world.ts <-> worldgen.ts cycle. See rng.ts's doc comment.
export { mulberry32 };

/**
 * Procedural surface-layer generation — see DESIGN.md's "Environmental
 * generation, biomes, obstacles, and elevation-aware movement/fog" section.
 * Underground/canopy are untouched (still the plain flat grid `createWorld`
 * always produces) — this is a Surface-only pass, an explicit scope call
 * matching DESIGN.md's existing open question about whether the other two
 * layers ever get their own elevation/terrain model.
 */

// ---------------------------------------------------------------------------
// Smoothed value noise (mulberry32 itself now lives in rng.ts, re-exported above)
// ---------------------------------------------------------------------------

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * A single-octave value-noise lattice: independent random values at integer
 * grid points spaced `scale` tiles apart, bilinearly interpolated between
 * them with a smoothstep ease (not a raw lerp, so the seams between lattice
 * cells don't show as visible creases). This is plain value noise, not true
 * Perlin noise (no gradient vectors) — deliberately: it's simple, needs no
 * dependency, and is smooth enough for continuous-looking terrain, which is
 * all this needs.
 */
function makeValueLattice(rng: () => number, width: number, height: number, scale: number): (x: number, y: number) => number {
  const lw = Math.floor(width / scale) + 2;
  const lh = Math.floor(height / scale) + 2;
  const grid = new Float64Array(lw * lh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();

  return (x: number, y: number) => {
    const gx = x / scale;
    const gy = y / scale;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, lw - 1);
    const y1 = Math.min(y0 + 1, lh - 1);
    const sx = smoothstep(gx - x0);
    const sy = smoothstep(gy - y0);
    const v00 = grid[y0 * lw + x0]!;
    const v10 = grid[y0 * lw + x1]!;
    const v01 = grid[y1 * lw + x0]!;
    const v11 = grid[y1 * lw + x1]!;
    const top = v00 + (v10 - v00) * sx;
    const bottom = v01 + (v11 - v01) * sx;
    return top + (bottom - top) * sy;
  };
}

/**
 * A 2-octave smoothed value-noise field over roughly [0, 1] (a weighted sum
 * of a coarse lattice for broad shape and a finer one for local texture —
 * enough octaves to avoid the "obviously one blurry blob" look of a single
 * octave without needing real Perlin noise).
 */
export function makeNoise2D(rng: () => number, width: number, height: number, baseScale: number): (x: number, y: number) => number {
  const coarse = makeValueLattice(rng, width, height, Math.max(1, baseScale));
  const fine = makeValueLattice(rng, width, height, Math.max(1, baseScale / 3));
  return (x: number, y: number) => coarse(x, y) * 0.65 + fine(x, y) * 0.35;
}

// ---------------------------------------------------------------------------
// Density fields: a noise field plus a calibrated density->threshold lookup
// ---------------------------------------------------------------------------

/**
 * A multi-octave value-noise field is a weighted average of several
 * independent uniform-ish samples, so its *own* values cluster toward the
 * middle (like averaging several dice rolls) rather than spreading evenly
 * across [0, 1] — a raw `noise(x, y) < density` threshold check badly
 * under-fires for any small `density` (e.g. 0.05 almost never beats a
 * distribution bunched around 0.5), which is exactly what a biome's
 * `foodDensity`/`waterDensity`/`obstacleDensity` are meant to mean ("about
 * this fraction of tiles"). A `DensityField` fixes that by calibrating: it
 * Monte-Carlo-samples the field once up front, sorts the samples, and
 * `thresholdFor(density)` returns the value at that percentile — so
 * `sample(x, y) < thresholdFor(density)` fires for close to the requested
 * fraction of tiles, regardless of the field's actual raw distribution
 * shape.
 */
export interface DensityField {
  sample: (x: number, y: number) => number;
  /** The raw-noise threshold below which roughly `density` (0..1) of the map's tiles fall. */
  thresholdFor: (density: number) => number;
}

const DENSITY_CALIBRATION_SAMPLES = 800;

export function makeDensityField(seed: number, width: number, height: number, baseScale: number): DensityField {
  const sample = makeNoise2D(mulberry32(seed), width, height, baseScale);
  const calibrationRng = mulberry32(seed ^ 0x5bd1e995);
  const samples: number[] = [];
  for (let i = 0; i < DENSITY_CALIBRATION_SAMPLES; i++) {
    samples.push(sample(calibrationRng() * width, calibrationRng() * height));
  }
  samples.sort((a, b) => a - b);

  return {
    sample,
    thresholdFor(density: number): number {
      const clamped = Math.max(0, Math.min(1, density));
      const index = Math.min(samples.length - 1, Math.floor(clamped * samples.length));
      return samples[index]!;
    },
  };
}

// ---------------------------------------------------------------------------
// Macro elevation: land/ocean boundary and mountain ranges — "Kyogre/Groudon",
// algorithmic, not literally simulated ------------------------------------
// ---------------------------------------------------------------------------
//
// See DESIGN.md's "Overworld generation vision" section — this is the first
// *built* slice of it. Before this, `elevation` was a small-scale 2-octave
// value-noise field (`makeNoise2D` above): plausible-looking speckle, but
// with no large-scale coherence — no real continents, no real mountain
// ranges, just locally-varying bumps. This section replaces *only* that one
// noise source with a coherent macro-scale field, built the same way real
// procedural-terrain tools commonly do it: a handful of seeded "influence
// points" each push elevation up or down within a falloff radius, and the
// tile's final macro elevation is the sum of every point's contribution,
// normalized across the whole map. A small number of points with a wide
// falloff radius is what produces large, continuous landmass/mountain
// shapes instead of speckle — that's the entire trick.
//
// Named `applyGroudonUplift`/`applyKyogreBasin` per DESIGN.md's own framing
// of "how literally simulated does each process need to be" — for this
// first slice the answer is "algorithmic, narratively flavored," not a
// literal multi-agent tug-of-war between two simulated Pokémon.

interface MacroInfluencePoint {
  x: number;
  y: number;
  /** Positive for an uplift point, negative for a basin point — baked in so both kinds sum the same way. */
  strength: number;
  /** Influence radius in tiles; contributes 0 at/beyond this distance. */
  radius: number;
}

/** How many uplift ("Groudon") and basin ("Kyogre") points seed the macro elevation field. Few points + wide radius = large coherent shapes, not speckle. */
const UPLIFT_POINT_COUNT = 6;
const BASIN_POINT_COUNT = 6;

/**
 * Each point's falloff radius, as a fraction of the map's larger dimension.
 * Real-run tuning note: the first pass here used 0.45 (roughly half the map)
 * and it was too big — with 6+6 points at that radius nearly every basin
 * overlapped every other basin, so instead of several distinct oceans and
 * continents the map collapsed into one giant merged ocean blob covering
 * most of the map (confirmed by an actual ASCII dump, not just eyeballing
 * the algorithm — see DESIGN.md's real-run findings). 0.22 gives each point
 * real individual shape while still letting 2-3 nearby points of the same
 * sign merge into one bigger landmass/ocean, which is the actual "coherent
 * continents" look this is going for.
 */
const MACRO_INFLUENCE_RADIUS_FRACTION = 0.22;

/** How much of the final macro field is small-scale detail noise (coastline roughness) vs. the pure point-influence shape — kept low so the macro shape dominates. */
const MACRO_DETAIL_WEIGHT = 0.16;

/** Target fraction of the map that ends up below sea level — roughly matching Kyogre/Groudon's canonical even split, tuned slightly toward more ocean than land per the real-run findings (see DESIGN.md). */
const OCEAN_FRACTION = 0.44;

/**
 * Smooth falloff from 1 at the influence point's center to 0 at/beyond its
 * radius (a smoothstep of the linear falloff, not a raw linear ramp, so
 * points blend into each other without a visible cone-shaped crease where
 * two points' circles overlap).
 */
function macroFalloff(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return t * t * (3 - 2 * t);
}

function placeMacroInfluencePoints(rng: () => number, width: number, height: number, count: number, sign: 1 | -1): MacroInfluencePoint[] {
  const baseRadius = Math.max(width, height) * MACRO_INFLUENCE_RADIUS_FRACTION;
  const points: MacroInfluencePoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: rng() * width,
      y: rng() * height,
      // +/-30% strength variance and +/-30% radius variance so points don't
      // all look identical — some uplifts are bigger mountain ranges than
      // others, some basins are deeper ocean trenches than others.
      strength: sign * (0.7 + 0.6 * rng()),
      radius: baseRadius * (0.7 + 0.6 * rng()),
    });
  }
  return points;
}

export interface MacroElevation {
  /** Normalized (0..1) macro elevation at an integer tile — the coherent, large-scale component that per-biome elevationBase/elevationVariance rides on top of. */
  normalized: (x: number, y: number) => number;
  /** True if this tile fell below the generated sea level in the Groudon/Kyogre tug-of-war — Kyogre won here. */
  isOcean: (x: number, y: number) => boolean;
}

/**
 * Optional steering for `generateMacroElevation`, used ONLY when generating a
 * single zone's full-resolution map as a promoted cell of a larger
 * `macroGrid.ts` macro grid (see that module's `biasForZone`) — every
 * existing caller that omits this (a bare `generateWorld(width, height,
 * seed)`, exactly as `createDemoWorld` still calls it) gets byte-identical
 * behavior to before this existed. The whole point: a promoted zone's
 * terrain should read as "the zoomed-in version of that macro spot," not an
 * independent reroll — see DESIGN.md's "overworld and zone are two distinct
 * levels" correction.
 */
export interface MacroElevationBias {
  /**
   * Where this zone's macro elevation sits, roughly -1 (deep basin) to 1
   * (high uplift) — re-centers `.normalized()`'s reported value so a
   * highland-marked zone's per-tile elevation actually reads as
   * higher/mountainous, not just independently re-rolled. Does NOT move the
   * land/ocean boundary itself (that's `oceanFraction`/`lowEdges`/
   * `highEdges` below) — this only biases the reported elevation *within*
   * whatever land this zone generates.
   */
  elevationShift: number;
  /** Overrides the fixed `OCEAN_FRACTION` percentile target — a zone the macro grid marked as ocean should generate mostly ocean, a fully inland zone almost none. */
  oceanFraction: number;
  /** Edges of the tile grid to pull elevation DOWN toward — a zone with an ocean neighbor in this direction should form its own coastline on the matching edge, not a random one. */
  lowEdges: readonly ZoneDirection[];
  /** Edges of the tile grid to pull elevation UP toward — the mirror of `lowEdges`, for a neighbor the macro grid marked as higher elevation. */
  highEdges: readonly ZoneDirection[];
  /**
   * Edges the macro grid recorded a river actually crossing at
   * (`MacroZone.riverEdges`, carved by `carveMacroRivers`) — real macro-level
   * fact that used to exist and go completely unread by per-zone generation
   * (see DESIGN.md's own "still open" list). Carves a narrow low-elevation
   * trench near just that edge (see `RIVER_EDGE_TRENCH_STRENGTH`'s doc
   * comment for why this is deliberately narrower than `lowEdges`' whole-zone
   * tilt), so a real river reaching this zone is measurably more likely to
   * actually route out through the specific edge the macro grid marked —
   * a bias, not a guaranteed pixel-for-pixel stitch across the zone
   * boundary, same honesty every other lossy macro-to-zone fact in this file
   * already holds itself to.
   */
  riverEdges: readonly ZoneDirection[];
}

/** How strongly `lowEdges`/`highEdges` pull the raw macro field toward/away from a tile-grid edge — a linear gradient from 1 at the named edge to 0 at the opposite one, scaled by this. Tuned against a real generated zone (see DESIGN.md) so a coastline reliably lands on the biased edge without flattening the rest of the zone's own local variety. */
const EDGE_BIAS_STRENGTH = 0.6;
/**
 * `riverEdges`' own version of `EDGE_BIAS_STRENGTH` — deliberately applied
 * to `edgeCloseness(...)` raised to `RIVER_EDGE_TRENCH_EXPONENT` rather than
 * the raw linear gradient `lowEdges`/`highEdges` use, so the pull is a real
 * narrow trench near just the marked edge instead of a whole-zone tilt (a
 * whole-zone tilt is exactly right for "this zone borders ocean," but wrong
 * for "a river happens to cross here" — most of the zone shouldn't read as
 * lowland just because one river passes through one edge of it).
 */
const RIVER_EDGE_TRENCH_STRENGTH = 1.4;
/** Higher = the river-edge trench decays faster moving away from the marked edge, keeping it a narrow band rather than spanning the zone. */
const RIVER_EDGE_TRENCH_EXPONENT = 2;

/** How much of `.normalized()`'s reported value is pulled toward `MacroElevationBias.elevationShift` vs. this zone's own locally generated shape — kept well under 1 so a highland zone still has real local peaks/valleys, not a flat plateau at the target height. */
const ELEVATION_SHIFT_WEIGHT = 0.35;

/** 1 at the named tile-grid edge, 0 at the opposite edge, linear in between — the gradient `lowEdges`/`highEdges` ride on. */
function edgeCloseness(dir: ZoneDirection, x: number, y: number, width: number, height: number): number {
  switch (dir) {
    case "N": return 1 - y / height;
    case "S": return y / height;
    case "W": return 1 - x / width;
    case "E": return x / width;
  }
}

/**
 * `applyGroudonUplift` + `applyKyogreBasin`, blended: places a few uplift
 * and basin points, sums every point's falloff-weighted contribution at
 * every tile (plus a little detail noise for coastline roughness), then
 * normalizes the whole grid to 0..1 and calibrates a sea-level threshold so
 * roughly `OCEAN_FRACTION` of the map ends up ocean — the same
 * exact-percentile calibration idea `makeDensityField` uses above, just
 * computed over the full grid (already materialized here) rather than a
 * Monte Carlo sample. This is the one function that decides the land/ocean
 * boundary; `generateWorld` below feeds its `.normalized` output into the
 * existing per-biome elevation formula (unchanged) wherever the old
 * `elevationNoise` used to go, and uses `.isOcean` directly to place true
 * ocean tiles, overriding the per-biome water-density roll (which still
 * independently places small in-land ponds/wetland water — see the tile
 * loop below).
 */
export function generateMacroElevation(
  rng: () => number,
  width: number,
  height: number,
  detailNoise: (x: number, y: number) => number,
  bias?: MacroElevationBias
): MacroElevation {
  const upliftPoints = placeMacroInfluencePoints(rng, width, height, UPLIFT_POINT_COUNT, 1);
  const basinPoints = placeMacroInfluencePoints(rng, width, height, BASIN_POINT_COUNT, -1);
  const allPoints = [...upliftPoints, ...basinPoints];

  const raw = new Float64Array(width * height);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (const p of allPoints) {
        const d = Math.hypot(p.x - x, p.y - y);
        v += p.strength * macroFalloff(d, p.radius);
      }
      // Detail noise centered on 0 so it can push the field either way, same
      // (-0.5)*2 recentering the tile loop below already uses elsewhere.
      v += (detailNoise(x, y) - 0.5) * 2 * MACRO_DETAIL_WEIGHT;
      if (bias) {
        for (const dir of bias.lowEdges) v -= edgeCloseness(dir, x, y, width, height) * EDGE_BIAS_STRENGTH;
        for (const dir of bias.highEdges) v += edgeCloseness(dir, x, y, width, height) * EDGE_BIAS_STRENGTH;
        for (const dir of bias.riverEdges) v -= edgeCloseness(dir, x, y, width, height) ** RIVER_EDGE_TRENCH_EXPONENT * RIVER_EDGE_TRENCH_STRENGTH;
      }
      raw[y * width + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const range = max - min || 1;
  const sorted = Float64Array.from(raw).sort();
  const oceanFraction = bias?.oceanFraction ?? OCEAN_FRACTION;
  const seaLevel = sorted[Math.min(sorted.length - 1, Math.floor(oceanFraction * sorted.length))]!;
  const shiftTarget = bias ? (bias.elevationShift + 1) / 2 : 0;

  return {
    normalized: (x: number, y: number) => {
      const n = Math.max(0, Math.min(1, (raw[y * width + x]! - min) / range));
      return bias ? n * (1 - ELEVATION_SHIFT_WEIGHT) + shiftTarget * ELEVATION_SHIFT_WEIGHT : n;
    },
    isOcean: (x: number, y: number) => raw[y * width + x]! < seaLevel,
  };
}

// ---------------------------------------------------------------------------
// Rivers: steepest-descent flow from mountain peaks — "Suicune's purifying
// path," algorithmic, not literally simulated ------------------------------
// ---------------------------------------------------------------------------

/** 8-directional neighbor offsets, used by both river carving and its steepest-descent search. */
const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/** How many rivers carve the map — a light function of map size, not a fixed count, so a bigger map gets proportionally more rivers. */
function riverCountFor(width: number, height: number): number {
  return Math.max(3, Math.round(Math.max(width, height) / 18));
}

/** Minimum spacing enforced between two river sources, as a fraction of the map's larger dimension — keeps rivers from all starting on the same mountain. */
const RIVER_SOURCE_MIN_SPACING_FRACTION = 0.12;

/** Hard cap on how many tiles a single river walks — a real safety bound, not expected to bite (steepest descent is monotonically decreasing, so it can't cycle), but cheap insurance against a pathological flat plateau. */
function maxRiverSteps(width: number, height: number): number {
  return width + height;
}

/**
 * Picks `count` distinct local elevation maxima on land (never ocean) as
 * river sources — real mountain peaks in the just-generated elevation, not
 * random points. Greedily takes the highest remaining candidate that's at
 * least `minSpacing` away from every already-chosen source, so rivers start
 * spread across different mountain ranges instead of clustering on the
 * single tallest peak.
 */
function selectRiverSources(world: World, width: number, height: number, count: number, minSpacing: number): Vec2[] {
  const candidates: { x: number; y: number; elevation: number }[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tileAt(world, "surface", x, y)!;
      // Only plain "floor"/"sunbeam" tiles reflect the real biome+macro
      // elevation cleanly. "boulder" gets a flat +BOULDER_ELEVATION_BOOST
      // bump wherever it happens to roll (see the tile loop above) — a real
      // bug found on the first real-run ASCII dump: boulders dominated
      // every top-elevation slot regardless of where they landed, so rivers
      // kept sourcing from scattered coastal boulder outcrops instead of
      // real inland mountain ranges, producing near-zero-length "rivers"
      // that hit the coast in 1-2 steps. Excluding obstacle terrain from
      // candidacy entirely fixes it — a mountain peak here is real high
      // ground, not wherever the independent obstacle-kind noise happened
      // to roll "boulder".
      if (tile.terrain !== "floor" && tile.terrain !== "sunbeam") continue;
      candidates.push({ x, y, elevation: tile.elevation });
    }
  }
  candidates.sort((a, b) => b.elevation - a.elevation);

  const chosen: Vec2[] = [];
  for (const c of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= minSpacing)) {
      chosen.push({ x: c.x, y: c.y });
    }
  }
  return chosen;
}

/**
 * Walks one river from a mountain-peak source via steepest descent: at each
 * step, move to whichever of the 8 neighbors has the lowest elevation
 * (strictly lower than the current tile), marking every tile it crosses as
 * "water" — Suicune's path, purifying the land it crosses. Ends one of three
 * ways: it reaches a tile bordering the ocean (marked "sand" — a real beach
 * at the river mouth, not another water tile, so the coastline stays
 * visually readable); it flows into a tile that's already water (a
 * pre-existing biome-density pond, or another river already carved this
 * pass) and simply merges as a tributary, no extra marking needed; or it
 * finds no lower neighbor anywhere nearby and pools into a brand-new lake
 * right there — the literal "forming a lake where a river's flow can't find
 * a lower neighbor before reaching the sea" case from the task description.
 * `visited` is shared across every river carved this generation pass, both
 * so two rivers don't redundantly re-walk the same tiles and as a hard
 * guard against ever revisiting a tile (steepest descent is monotonically
 * decreasing so this should never fire, but it's cheap insurance).
 */
function carveRiver(
  world: World,
  width: number,
  height: number,
  source: Vec2,
  oceanMask: MacroElevation,
  visited: Set<string>,
  elevationSnapshot: Float64Array
): void {
  let x = source.x;
  let y = source.y;
  const steps = maxRiverSteps(width, height);

  for (let step = 0; step < steps; step++) {
    const key = `${x},${y}`;
    if (visited.has(key)) return;
    const tile = tileAt(world, "surface", x, y);
    if (!tile || tile.terrain === "water") return; // flowed straight into existing water — a silent tributary merge
    visited.add(key);

    const touchesOcean = NEIGHBOR_OFFSETS.some(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < width && ny < height && oceanMask.isOcean(nx, ny);
    });
    if (touchesOcean) {
      // Suicune's purifying rain meets the sea — a real beach, not another
      // water tile, so a river mouth actually reads as a river mouth.
      setTile(world, "surface", x, y, "sand", tile.elevation);
      return;
    }

    setTile(world, "surface", x, y, "water", 0);

    // Steepest-descent search reads `elevationSnapshot` — the terrain's
    // elevation as generated, frozen before any river started carving —
    // never the live `tile.elevation` a carved-to-water tile now reports (a
    // real bug found on the first real-run ASCII dump: every river was
    // finding its OWN just-carved previous tile, freshly zeroed by the
    // `setTile(..., "water", 0)` two lines up, as the "lowest neighbor" and
    // immediately flowing back into itself — which the `visited` check then
    // caught on the very next iteration, terminating every river after
    // essentially one step regardless of the real surrounding terrain).
    let bestX = -1;
    let bestY = -1;
    let bestElevation = elevationSnapshot[y * width + x]!;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const neighborElevation = elevationSnapshot[ny * width + nx]!;
      if (neighborElevation < bestElevation) {
        bestElevation = neighborElevation;
        bestX = nx;
        bestY = ny;
      }
    }

    if (bestX === -1) return; // no lower ground anywhere adjacent — pools into a new lake right here
    x = bestX;
    y = bestY;
  }
}

/** Carves every river for this map — see `carveRiver`'s doc comment for the per-river rule. Runs once, after the full terrain grid (land/ocean/biome/obstacle) is already in place, so steepest descent has real final elevations to work from. */
function carveSuicuneRivers(world: World, width: number, height: number, macroElevation: MacroElevation): void {
  const count = riverCountFor(width, height);
  const minSpacing = Math.max(width, height) * RIVER_SOURCE_MIN_SPACING_FRACTION;
  const sources = selectRiverSources(world, width, height, count, minSpacing);

  // Frozen once, before any carving — see carveRiver's doc comment for why.
  const elevationSnapshot = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      elevationSnapshot[y * width + x] = tileAt(world, "surface", x, y)!.elevation;
    }
  }

  const visited = new Set<string>();
  for (const source of sources) carveRiver(world, width, height, source, macroElevation, visited, elevationSnapshot);
}

// ---------------------------------------------------------------------------
// Biomes: data + distance-weighted blending
// ---------------------------------------------------------------------------

export type ObstacleKind = "tree" | "boulder" | "bush" | "sand" | "mud";
const OBSTACLE_KINDS: readonly ObstacleKind[] = ["tree", "boulder", "bush", "sand", "mud"];

interface BiomeDef {
  name: string;
  /** How many seed points of this biome get scattered across the map. */
  seedCount: number;
  /** Per-tile chance-ish threshold that a tile becomes "food" (checked against a smooth noise field, not a raw dice roll — see `generateWorld`). */
  foodDensity: number;
  /** Same idea, for "water". */
  waterDensity: number;
  /** Same idea, for rolling an obstacle at all (which specific obstacle kind wins is a separate roll — see `terrainWeights`). */
  obstacleDensity: number;
  /** Elevation this biome sits at, absent variance. */
  elevationBase: number;
  /** How much local elevation noise can push a tile away from `elevationBase`, in either direction. */
  elevationVariance: number;
  /** Relative likelihood of each obstacle kind, once a tile has already rolled "yes, place an obstacle here". */
  terrainWeights: Record<ObstacleKind, number>;
}

/**
 * Nine biomes: the original five per DESIGN.md's list, plus "snow" (direct
 * ask: "snowy mountain tops where ice Pokemon and dragon live"), plus
 * "jungle"/"beach"/"desert" (direct follow-up ask: "more other types of
 * terrain generation... stretches of desert... islands... variance that
 * really helps flesh the world out"). "Snow" is elevation-gated ABOVE
 * Highland (see macroGrid.ts's `SNOW_ELEVATION_THRESHOLD`) — a snowy peak
 * literally caps the tallest mountains, it doesn't compete with the others
 * for territory the way ordinary seed-scatter does. `floor_snow.png`
 * (public/tiles/) already existed unused before this — sprites.ts's own doc
 * comment flagged it as "no biome maps to snow yet." "Jungle" and "desert"
 * are carved out of Forest's/Badlands' own moisture extremes respectively
 * (see macroGrid.ts's `JUNGLE_MOISTURE_THRESHOLD`/`DESERT_MOISTURE_
 * THRESHOLD`) rather than competing head-on for the same moisture range;
 * "beach" is different again — a coastline post-process
 * (`applyBeachReclassification`), not a moisture/elevation band at all,
 * since "coastal strip" isn't expressible as a threshold on either field.
 *
 * Every numeric value here is a sim-original guess to be judged against a
 * real run, exactly like every other tuning constant in this codebase —
 * not remotely canon, not validated against anything but "does the
 * generated map look/feel varied," see DESIGN.md's real-run findings for
 * this feature.
 */
const BIOMES: readonly BiomeDef[] = [
  {
    name: "grassland",
    seedCount: 3,
    foodDensity: 0.05,
    waterDensity: 0.08,
    obstacleDensity: 0.05,
    elevationBase: 0.4,
    elevationVariance: 0.5,
    terrainWeights: { tree: 1, boulder: 0.4, bush: 2, sand: 0.3, mud: 0.2 },
  },
  {
    name: "forest",
    seedCount: 2,
    foodDensity: 0.03,
    waterDensity: 0.07,
    obstacleDensity: 0.22,
    elevationBase: 0.6,
    elevationVariance: 0.7,
    terrainWeights: { tree: 5, boulder: 0.4, bush: 2.5, sand: 0.05, mud: 0.3 },
  },
  {
    // Carved out of Forest's own wettest end (see macroGrid.ts's
    // `JUNGLE_MOISTURE_THRESHOLD`) — denser canopy, more food (real
    // rainforest-floor abundance), and noticeably more water than plain
    // Forest, but still land-dominant unlike Wetland below it.
    name: "jungle",
    seedCount: 2,
    foodDensity: 0.045,
    waterDensity: 0.12,
    obstacleDensity: 0.28,
    elevationBase: 0.55,
    elevationVariance: 0.6,
    // Heavier tree/bush than even Forest — a real dense-canopy feel — with a
    // touch of mud (humid, damp undergrowth) Forest itself barely has.
    terrainWeights: { tree: 6, boulder: 0.2, bush: 3.5, sand: 0.05, mud: 0.6 },
  },
  {
    name: "wetland",
    seedCount: 2,
    foodDensity: 0.04,
    waterDensity: 0.28,
    obstacleDensity: 0.09,
    elevationBase: 0.1,
    elevationVariance: 0.15,
    terrainWeights: { tree: 0.5, boulder: 0.1, bush: 1.5, sand: 0.2, mud: 4 },
  },
  {
    // A real, low-lying coastal strip — see macroGrid.ts's
    // `applyBeachReclassification` for how a zone actually lands here (a
    // coastal-adjacent, low-elevation post-process, not a moisture band).
    // Overwhelmingly sand, almost no obstacles or food of its own — the
    // point of a beach zone is the water access right next to it
    // (`biasForZone`'s own coastal ocean-fraction boost already handles
    // that), not standalone habitat richness.
    name: "beach",
    seedCount: 2,
    foodDensity: 0.01,
    waterDensity: 0.06,
    obstacleDensity: 0.03,
    elevationBase: 0.08,
    elevationVariance: 0.1,
    terrainWeights: { tree: 0.05, boulder: 0.1, bush: 0.1, sand: 8, mud: 0.05 },
  },
  {
    name: "badlands",
    seedCount: 2,
    foodDensity: 0.015,
    waterDensity: 0.015,
    obstacleDensity: 0.07,
    elevationBase: 0.35,
    elevationVariance: 0.5,
    terrainWeights: { tree: 0.1, boulder: 1.5, bush: 0.15, sand: 5, mud: 0.05 },
  },
  {
    // Carved out of Badlands' own driest end (see macroGrid.ts's
    // `DESERT_MOISTURE_THRESHOLD`) — deliberately NOT another rocky-canyon
    // biome: `carveBadlandsChambers`'s `isBadlandsDominant` check is keyed by
    // name, so Desert tiles never get BSP chamber-carved, staying open sand
    // dunes instead. Harsher than Badlands on every resource axis — the
    // driest possible extreme of the whole biome set.
    name: "desert",
    seedCount: 2,
    foodDensity: 0.008,
    waterDensity: 0.008,
    obstacleDensity: 0.04,
    elevationBase: 0.3,
    elevationVariance: 0.4,
    // Almost entirely sand dunes with the rare boulder outcrop — no BSP
    // structure, so this is the raw terrain-weight profile doing all the
    // "open desert, not canyon" work on its own.
    terrainWeights: { tree: 0.02, boulder: 0.3, bush: 0.05, sand: 9, mud: 0.02 },
  },
  {
    name: "highland",
    seedCount: 2,
    foodDensity: 0.02,
    waterDensity: 0.03,
    obstacleDensity: 0.18,
    elevationBase: 2.2,
    elevationVariance: 1.3,
    terrainWeights: { tree: 0.4, boulder: 4, bush: 0.25, sand: 0.15, mud: 0.1 },
  },
  {
    name: "snow",
    // 1, not 2 like every other biome — a snowcap should read as the rare
    // tip of the tallest peaks, not a whole region competing for territory
    // the way Highland/Badlands/etc. do (see this section's top doc
    // comment: elevation-gated above Highland, not scattered independently).
    seedCount: 1,
    // Harsher than even Badlands (0.015/0.015) — a real "barren, for a
    // reason" habitat (see the overworld extinction fix's own doc comment
    // for that same standard applied one level up, at the macro-grid tier).
    foodDensity: 0.01,
    waterDensity: 0.02,
    obstacleDensity: 0.2,
    // Above Highland's own 2.2 base (and comfortably above its 2.2+1.3=3.5
    // max range floor) — only the genuine tip of a tall mountain clears
    // this, same "one biome literally caps another" idea Highland already
    // established relative to the other four.
    elevationBase: 3.6,
    elevationVariance: 0.6,
    // Overwhelmingly boulder (icy rock/snowdrift) — barely any of the
    // others; a snowcap isn't wooded or sandy.
    terrainWeights: { tree: 0.05, boulder: 6, bush: 0.05, sand: 0.1, mud: 0.05 },
  },
];

interface BiomeSeed {
  x: number;
  y: number;
  biome: BiomeDef;
}

function placeBiomeSeeds(rng: () => number, width: number, height: number): BiomeSeed[] {
  const seeds: BiomeSeed[] = [];
  for (const biome of BIOMES) {
    for (let i = 0; i < biome.seedCount; i++) {
      seeds.push({ x: rng() * width, y: rng() * height, biome });
    }
  }
  return seeds;
}

export interface BlendedBiomeParams {
  foodDensity: number;
  waterDensity: number;
  obstacleDensity: number;
  elevationBase: number;
  elevationVariance: number;
  terrainWeights: Record<ObstacleKind, number>;
}

/** How many nearest biome seeds contribute to a tile's blended parameters — DESIGN.md's "2-3 nearest seeds", picked at 3. */
const NEAREST_BIOME_SEEDS = 3;

/**
 * A tile's actual generation parameters are a distance-weighted (inverse
 * distance squared, +1 to avoid a division blowing up exactly at a seed)
 * blend of its `NEAREST_BIOME_SEEDS` nearest biome seeds — this, not a
 * single "which region is this tile in" lookup, is what makes biomes bleed
 * into each other with continuous parameter transitions instead of a hard
 * edge. See worldgen.test.ts for a test sampling a line of tiles across a
 * boundary and confirming the change is gradual.
 */
export function blendBiomeParams(seeds: readonly BiomeSeed[], x: number, y: number): BlendedBiomeParams {
  const nearest = seeds
    .map((seed) => ({ seed, distSq: (seed.x - x) ** 2 + (seed.y - y) ** 2 }))
    .sort((a, b) => a.distSq - b.distSq)
    .slice(0, NEAREST_BIOME_SEEDS);

  const weights = nearest.map(({ distSq }) => 1 / (distSq + 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const blended: BlendedBiomeParams = {
    foodDensity: 0,
    waterDensity: 0,
    obstacleDensity: 0,
    elevationBase: 0,
    elevationVariance: 0,
    terrainWeights: { tree: 0, boulder: 0, bush: 0, sand: 0, mud: 0 },
  };

  nearest.forEach(({ seed }, i) => {
    const w = weights[i]! / totalWeight;
    const b = seed.biome;
    blended.foodDensity += b.foodDensity * w;
    blended.waterDensity += b.waterDensity * w;
    blended.obstacleDensity += b.obstacleDensity * w;
    blended.elevationBase += b.elevationBase * w;
    blended.elevationVariance += b.elevationVariance * w;
    for (const kind of OBSTACLE_KINDS) blended.terrainWeights[kind] += b.terrainWeights[kind] * w;
  });

  return blended;
}

/**
 * Same distance-weighted-nearest-seeds machinery as `blendBiomeParams`, but
 * classifying by biome *name* rather than blending the full `BiomeDef`
 * parameter set — this is what weather.ts (Phase 3) needs: "how strongly
 * does this point read as Wetland vs. Badlands vs. ...", not a
 * food/water/obstacle density blend. Takes `World.biomeSeeds`'s name-only
 * `BiomeSeedInfo[]` (see types.ts) rather than the full internal
 * `BiomeSeed[]` this module builds for generation, so it works from what a
 * generated `World` actually persists. Returns a `{biomeName: weight}` map
 * whose values sum to ~1 across whichever named biomes are among the
 * nearest `NEAREST_BIOME_SEEDS` seeds (two seeds of the same name — this map
 * blends by *name*, not by seed — contribute to one combined entry); an
 * absent or empty `seeds` (a bare `createWorld` world, or any hand-built
 * test fixture that never set `biomeSeeds`) returns `{}` rather than
 * throwing or guessing — every consumer documents its own biome-agnostic
 * fallback for that case.
 */
export function biomeWeightsAt(seeds: readonly BiomeSeedInfo[] | undefined, x: number, y: number): Record<string, number> {
  if (!seeds || seeds.length === 0) return {};

  const nearest = seeds
    .map((seed) => ({ seed, distSq: (seed.x - x) ** 2 + (seed.y - y) ** 2 }))
    .sort((a, b) => a.distSq - b.distSq)
    .slice(0, NEAREST_BIOME_SEEDS);

  const weights = nearest.map(({ distSq }) => 1 / (distSq + 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const result: Record<string, number> = {};
  nearest.forEach(({ seed }, i) => {
    result[seed.name] = (result[seed.name] ?? 0) + weights[i]! / totalWeight;
  });
  return result;
}

/** `BIOMES` indexed by name, for the runtime (post-generation) lookups below — generation itself still walks the array directly. */
const BIOME_BY_NAME: Readonly<Record<string, BiomeDef>> = Object.fromEntries(BIOMES.map((b) => [b.name, b]));

/** Every real per-tile biome name this module knows how to generate — `macroGrid.ts` picks a zone's dominant biome from exactly this list (plus its own "ocean" for a zone the macro elevation pass marked below sea level, which isn't a `BiomeDef` at all). */
export const BIOME_NAMES: readonly string[] = BIOMES.map((b) => b.name);

/**
 * A biome's raw food/water density parameters, for `macroGrid.ts`'s cheap
 * per-zone resource-abundance estimate (`estimateResourceIndexForZone`) —
 * used ONLY to seed a never-visited zone's `RegionAggregate.baseResourceIndex`
 * before any real tiles exist to `measureResourceIndex` from (see
 * `overworld.ts`). Returns `undefined` for an unknown name (e.g. "ocean",
 * which isn't a `BiomeDef` — callers handle that case with their own ocean
 * estimate) rather than guessing.
 */
export function biomeFoodWaterDensity(name: string): { foodDensity: number; waterDensity: number } | undefined {
  const biome = BIOME_BY_NAME[name];
  return biome ? { foodDensity: biome.foodDensity, waterDensity: biome.waterDensity } : undefined;
}

/** The driest biome's own `waterDensity` — the fixed target every seed's own `effectiveWaterDensityAt` drifts toward under sustained local drought (see `World.biomeSeedDrift`'s doc comment). */
const BADLANDS_WATER_DENSITY = BIOME_BY_NAME["badlands"]!.waterDensity;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * A tile's real, moisture-field-aware water density at *runtime* — the
 * missing piece TODO.md flagged: `generateWorld` above already blends each
 * seed's `waterDensity` at generation time, but nothing after that ever
 * re-reads it, so weather.ts's `advanceWaterCycle` (rain forming water,
 * drought drying it) ran at one flat global rate everywhere regardless of
 * which biome a tile actually sits in. This is the same nearest-`
 * NEAREST_BIOME_SEEDS`-seeds inverse-distance-squared blend `biomeWeightsAt`
 * uses (so a Wetland/Badlands boundary still reads as a smooth gradient, not
 * a hard step), except each contributing seed's own `waterDensity` is first
 * pulled toward `BADLANDS_WATER_DENSITY` by that seed's own
 * `World.biomeSeedDrift` factor (0 = the seed's original biome, 1 = fully
 * badlands-arid) — see weather.ts's `advanceBiomeDrift` for what actually
 * moves that factor over time. A seed with no recorded drift (`drift`
 * absent/0, including every seed on a world that predates this feature)
 * behaves exactly as `blendBiomeParams`'s own `waterDensity` term always did.
 *
 * Returns `undefined` — not a guessed default — when there's no biome data
 * to blend at all (`seeds` absent/empty, a bare `createWorld`/hand-built test
 * world), matching `biomeWeightsAt`'s own "no data, don't pretend" contract;
 * every real call site (weather.ts) documents its own biome-agnostic
 * fallback for that case so existing biome-agnostic tests/worlds see zero
 * behavior change.
 */
export function effectiveWaterDensityAt(seeds: readonly BiomeSeedInfo[] | undefined, drift: readonly number[] | undefined, x: number, y: number): number | undefined {
  if (!seeds || seeds.length === 0) return undefined;

  const nearest = seeds
    .map((seed, index) => ({ seed, index, distSq: (seed.x - x) ** 2 + (seed.y - y) ** 2 }))
    .sort((a, b) => a.distSq - b.distSq)
    .slice(0, NEAREST_BIOME_SEEDS);

  const weights = nearest.map(({ distSq }) => 1 / (distSq + 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let density = 0;
  nearest.forEach(({ seed, index }, i) => {
    const base = BIOME_BY_NAME[seed.name]?.waterDensity ?? BADLANDS_WATER_DENSITY;
    const seedDrift = drift?.[index] ?? 0;
    density += lerp(base, BADLANDS_WATER_DENSITY, seedDrift) * (weights[i]! / totalWeight);
  });
  return density;
}

// ---------------------------------------------------------------------------
// Badlands BSP chambers — direct ask: partition each Badlands region into
// chambers/canyons via binary space partitioning. Chamber boundaries are
// mostly "boulder" (already walkable-but-slow — support.ts's
// `terrainSpeedMultiplier` — and opaque — world.ts's `isOpaqueTerrain`), not
// hard "wall": most of a boundary line should read as rough, slow terrain to
// push through, not a corridor maze. A sparse fraction of each line's tiles
// become real "wall" instead, for occasional genuine chokepoints/dead-ends —
// the exception, not the rule, per direct request.
//
// Composes with, doesn't replace, the per-tile terrainWeights/obstacleDensity
// system and `blendBiomeParams`'s continuous cross-biome blending above: this
// runs as a post-hoc structural overlay, the same idiom `carveSuicuneRivers`
// below already uses, masked tile-by-tile to wherever a point reads as
// Badlands-*dominant* (`isBadlandsDominant`) — a boundary line simply isn't
// painted once it crosses out of Badlands' own footprint, so a hard BSP grid
// never fights the smooth transition at a biome edge; it only ever adds
// structure inside ground that was already going to be sand/boulder/badlands
// anyway. Runs after `carveSuicuneRivers` (skips any tile a river already
// carved to "water") specifically so it never has to reason about rivers at
// all beyond that one exclusion.
// ---------------------------------------------------------------------------

/**
 * A chamber rectangle stops splitting once either side would fall below this
 * many tiles — small enough that this codebase's ~90x60 default scenario map
 * (`SCENARIO_WIDTH`/`HEIGHT`, packages/data/src/scenario.ts) gets several
 * real chambers per Badlands region, large enough that a chamber still reads
 * as a real room, not a sliver.
 */
const BSP_MIN_LEAF_SIZE = 10;

/**
 * Chance a given boundary-line tile — outside its own line's reserved safe
 * gap, see `BSP_SAFE_GAP_FRACTION` below — becomes a real "wall" tile instead
 * of boulder. Deliberately low: "should feel like the exception, not the
 * rule," direct request. Sim-original guess, judge against a real generated
 * map like every other tuning constant in this file.
 */
const BSP_WALL_CHANCE = 0.08;

/**
 * Fraction of a boundary line's own length reserved as a guaranteed-crossable
 * "canyon mouth" — these tiles always paint as boulder, never rolled for the
 * `BSP_WALL_CHANCE` upgrade, regardless of how the rest of that line's rolls
 * land. This is what keeps a chamber from ever being fully sealed off by
 * unlucky rolls: even in the (astronomically unlikely) worst case where every
 * other tile on every one of a chamber's boundary lines rolls "wall," each
 * line's own reserved gap stays open. At least 1 tile even on a short line.
 */
const BSP_SAFE_GAP_FRACTION = 0.25;

/**
 * Direct ask: "the badlands bsp is cool, but needs to be less rigidly room
 * like... more organic, wobbly, rock shelf like." A raw `BspBoundary` is a
 * mathematically perfect straight line — this is the fix, not a
 * replacement generator: keep BSP's actual room layout (still splits into
 * `BSP_MIN_LEAF_SIZE`+ rectangular chambers, still the same recursive
 * partition), but PAINT each line with a smooth per-tile offset
 * perpendicular to its own direction instead of tracing it exactly, so a
 * chamber wall meanders like a real eroded rock shelf rather than reading
 * as a ruler-straight dungeon wall. `BSP_WOBBLE_AMPLITUDE` tiles either
 * side is a real, visible waver without threatening `BSP_MIN_LEAF_SIZE`
 * chambers' own floor space (a chamber's interior is never wobbled, only
 * its boundary lines are).
 */
const BSP_WOBBLE_AMPLITUDE = 3;

/**
 * How slowly the wobble noise varies along a line's length — a bigger
 * number reads as a long, lazy meander (the "rock shelf" look actually
 * asked for); a small one would just look like jittery static, closer to
 * per-tile independent noise than an eroded edge. Comparable to
 * `BSP_MIN_LEAF_SIZE` so a wobble's own "wavelength" is on the same visual
 * scale as the chambers it's carving, rather than either much shorter
 * (busy/noisy) or much longer (barely visible over one line's length).
 */
const BSP_WOBBLE_NOISE_SCALE = 12;

interface BspBoundary {
  /** "vertical": a line of constant `x`, spanning `y` in `[y, y + length)`. "horizontal": constant `y`, spanning `x` in `[x, x + length)`. */
  orientation: "vertical" | "horizontal";
  x: number;
  y: number;
  length: number;
}

/**
 * Recursively splits the rectangle `[x0, x1) x [y0, y1)` into two
 * sub-rectangles, one call at a time, and records each split as a
 * `BspBoundary` line — classic BSP dungeon generation. Splits whichever axis
 * is currently longer (keeps chambers roughly square rather than ever-
 * thinner slivers), with a coin flip when the two sides are within a tile of
 * each other; stops recursing once a rectangle can't be split without either
 * side falling below `BSP_MIN_LEAF_SIZE`.
 */
function splitBspRect(rng: () => number, x0: number, y0: number, x1: number, y1: number, out: BspBoundary[]): void {
  const w = x1 - x0;
  const h = y1 - y0;
  const canSplitVertical = w >= BSP_MIN_LEAF_SIZE * 2 + 1;
  const canSplitHorizontal = h >= BSP_MIN_LEAF_SIZE * 2 + 1;
  if (!canSplitVertical && !canSplitHorizontal) return;

  const splitVertical = canSplitVertical && (!canSplitHorizontal || (w === h ? rng() < 0.5 : w > h));

  if (splitVertical) {
    const splitX = x0 + BSP_MIN_LEAF_SIZE + Math.floor(rng() * (w - 2 * BSP_MIN_LEAF_SIZE - 1));
    out.push({ orientation: "vertical", x: splitX, y: y0, length: h });
    splitBspRect(rng, x0, y0, splitX, y1, out);
    splitBspRect(rng, splitX + 1, y0, x1, y1, out); // +1 skips the line tile itself, so children never overlap it
  } else {
    const splitY = y0 + BSP_MIN_LEAF_SIZE + Math.floor(rng() * (h - 2 * BSP_MIN_LEAF_SIZE - 1));
    out.push({ orientation: "horizontal", x: x0, y: splitY, length: w });
    splitBspRect(rng, x0, y0, x1, splitY, out);
    splitBspRect(rng, x0, splitY + 1, x1, y1, out);
  }
}

/**
 * True if `(x, y)` reads as Badlands more strongly than every other biome in
 * `biomeWeightsAt`'s blend — deliberately *dominant*, not merely "Badlands
 * has some nonzero weight here." This is what keeps the BSP grid inside
 * Badlands' own footprint (see this section's doc comment) instead of
 * spilling into the continuous cross-biome transition band at its edges.
 */
function isBadlandsDominant(seeds: readonly BiomeSeedInfo[], x: number, y: number): boolean {
  const weights = biomeWeightsAt(seeds, x, y);
  const badlandsWeight = weights["badlands"] ?? 0;
  if (badlandsWeight <= 0) return false;
  for (const [name, weight] of Object.entries(weights)) {
    if (name !== "badlands" && weight >= badlandsWeight) return false;
  }
  return true;
}

/**
 * The single highest-weight biome name at (x, y) in `biomeWeightsAt`'s
 * blend — undefined on a world with no biome data at all
 * (`biomeWeightsAt` returns `{}`). Used by `flora.ts`'s crop-maturation
 * pick (`crops.ts`'s `pickCrop`) to decide which real crop a maturing
 * seedling is even eligible to become — a general "what biome is this,
 * really" helper, generalized out of `isBadlandsDominant`'s own
 * single-biome check just above rather than duplicating the same
 * highest-weight scan for a second purpose.
 */
export function dominantBiomeAt(seeds: readonly BiomeSeedInfo[] | undefined, x: number, y: number): string | undefined {
  const weights = biomeWeightsAt(seeds, x, y);
  let best: string | undefined;
  let bestWeight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = name;
    }
  }
  return best;
}

/**
 * Carves BSP chamber/canyon boundaries into every Badlands-dominant tile —
 * see this section's doc comment. A no-op on a world with no biome data at
 * all (`world.biomeSeeds` absent/empty), same contract every other biome-
 * aware function in this file follows. A boundary tile's elevation reuses
 * whatever ambient elevation the main generation loop already gave that spot
 * — undoing the existing `BOULDER_ELEVATION_BOOST` first if it happened to
 * already be boulder, so re-painting it is a no-op, not a double boost —
 * plus that same boost, so BSP-placed boulder/wall reads exactly like a
 * hand-placed boulder: raised terrain, consistent with every other boulder
 * on the map.
 */
function carveBadlandsChambers(world: World, width: number, height: number, rng: () => number): void {
  const seeds = world.biomeSeeds;
  if (!seeds || seeds.length === 0) return;

  const boundaries: BspBoundary[] = [];
  splitBspRect(rng, 0, 0, width, height, boundaries);

  // Sampled at (position-along-line, this-line's-own-fixed-coordinate) below
  // — the fixed coordinate differs per line, so every boundary automatically
  // gets its own independent-looking noise "row" with no extra bookkeeping,
  // while still varying smoothly along any single line's length.
  const wobbleNoise = makeNoise2D(rng, Math.max(width, height), Math.max(width, height), BSP_WOBBLE_NOISE_SCALE);

  for (const boundary of boundaries) {
    const safeGapLength = Math.max(1, Math.round(boundary.length * BSP_SAFE_GAP_FRACTION));
    const safeGapStart = Math.floor(rng() * Math.max(1, boundary.length - safeGapLength));

    for (let i = 0; i < boundary.length; i++) {
      const wobble = Math.round((wobbleNoise(i, boundary.orientation === "vertical" ? boundary.x : boundary.y) - 0.5) * 2 * BSP_WOBBLE_AMPLITUDE);
      const x = boundary.orientation === "vertical" ? boundary.x + wobble : boundary.x + i;
      const y = boundary.orientation === "vertical" ? boundary.y + i : boundary.y + wobble;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;

      const tile = tileAt(world, "surface", x, y);
      if (!tile || tile.terrain === "water") continue;
      if (!isBadlandsDominant(seeds, x, y)) continue;

      const ambientElevation = tile.terrain === "boulder" ? tile.elevation - BOULDER_ELEVATION_BOOST : tile.elevation;
      const boostedElevation = ambientElevation + BOULDER_ELEVATION_BOOST;
      const inSafeGap = i >= safeGapStart && i < safeGapStart + safeGapLength;
      const kind = !inSafeGap && rng() < BSP_WALL_CHANCE ? "wall" : "boulder";
      setTile(world, "surface", x, y, kind, boostedElevation);
    }
  }
}

// ---------------------------------------------------------------------------
// Underground caves — cellular automata. Underground has always been a flat,
// terrain-uniform grid (see this file's top doc comment: "Underground/canopy
// are untouched... this is a Surface-only pass") — this is the first time it
// gets any real generated structure at all. Classic "random fill + smoothing"
// cellular automata produces an organic, blobby cavern shape — a
// deliberately different character from Badlands' angular BSP chambers above
// (a natural cave, not a carved chamber), fitting for a layer that has no
// biome/elevation/moisture concept of its own to give it any other shape
// language. Writes directly onto `world.tiles.underground`, independent of
// every Surface-only concept (biome seeds, macro elevation, moisture) the
// main generation loop below uses.
// ---------------------------------------------------------------------------

/**
 * Fraction of underground tiles that start as "wall" before smoothing —
 * picked, together with the smoothing rule below, to land the *surviving*
 * cave at a real-but-modest wall fraction, not a maze: underground movement/
 * hunting was tuned against a flat, fully-open grid, so this adds real
 * structure without turning every existing behavior into a pathfinding
 * nightmare. Sim-original guess, judge against a real generated map like
 * every other tuning constant in this file.
 */
const CAVE_INITIAL_WALL_CHANCE = 0.4;

/** How many "5+ of 8 neighbors are wall -> become wall, else floor" smoothing passes run — enough for the initial static to settle into smooth-edged blobs (the standard cellular-automata cave-gen recipe) without over-iterating toward a nearly-solid or nearly-empty fixed point. */
const CAVE_SMOOTHING_ITERATIONS = 4;

/** A cell becomes (or stays) "wall" this pass if at least this many of its 8 Moore neighbors are "wall" this pass — off the map edge counts as wall too, so a cave never opens directly onto the world's border. */
const CAVE_WALL_NEIGHBOR_THRESHOLD = 5;

function countWallNeighbors(grid: Uint8Array, width: number, height: number, x: number, y: number): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        count++; // off-map counts as wall — keeps a cave from opening onto the border
        continue;
      }
      if (grid[ny * width + nx]) count++;
    }
  }
  return count;
}

/**
 * Keeps only the single largest 4-connected "floor" (non-wall) region in
 * `grid`, walling off every smaller disconnected pocket — same connectivity
 * convention `waterBody.ts` uses for "is this one contiguous feature." Random
 * CA smoothing alone can (and does) leave several disconnected floor
 * pockets; without this, the underground layer could end up with isolated,
 * unreachable cave rooms no path could ever reach.
 */
function keepOnlyLargestFloorRegion(grid: Uint8Array, width: number, height: number): void {
  const visited = new Uint8Array(grid.length);
  let bestComponent: number[] = [];

  for (let start = 0; start < grid.length; start++) {
    if (visited[start] || grid[start]) continue; // already visited, or a wall cell
    const component: number[] = [start];
    visited[start] = 1;
    const queue = [start];
    while (queue.length > 0) {
      const i = queue.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue;
        const ni = ny! * width + nx!;
        if (visited[ni] || grid[ni]) continue;
        visited[ni] = 1;
        queue.push(ni);
        component.push(ni);
      }
    }
    if (component.length > bestComponent.length) bestComponent = component;
  }

  const keep = new Uint8Array(grid.length);
  for (const i of bestComponent) keep[i] = 1;
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] && !keep[i]) grid[i] = 1; // a floor cell outside the largest region becomes wall
  }
}

/**
 * Generates cellular-automata cave structure for the Underground layer — see
 * this section's doc comment. Deterministic for a given rng, same contract
 * as every other generation step in this file.
 *
 * Doesn't know or care about any hand-placed agent spawn coordinate
 * (`@pokuelike/data`'s scenario.ts) — a fixed anchor could land inside solid
 * rock with no guarantee of exactly missing every wall this generates. That's
 * `findWalkableNear`'s job, the same primitive that already fixed the
 * analogous Surface-layer problem (a fixed anchor landing mid-lake) — every
 * caller placing an agent onto a specific Underground coordinate needs to go
 * through it now, for exactly the same reason.
 */
function generateUndergroundCaves(world: World, width: number, height: number, rng: () => number): void {
  const grid = new Uint8Array(width * height); // 1 = wall, 0 = floor
  for (let i = 0; i < grid.length; i++) grid[i] = rng() < CAVE_INITIAL_WALL_CHANCE ? 1 : 0;

  for (let iter = 0; iter < CAVE_SMOOTHING_ITERATIONS; iter++) {
    const next = new Uint8Array(grid.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        next[y * width + x] = countWallNeighbors(grid, width, height, x, y) >= CAVE_WALL_NEIGHBOR_THRESHOLD ? 1 : 0;
      }
    }
    grid.set(next);
  }

  keepOnlyLargestFloorRegion(grid, width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x]) setTile(world, "underground", x, y, "wall");
    }
  }
}

// ---------------------------------------------------------------------------
// Mountain massifs — Surface's own version of the underground caves' CA
// technique just above, reused rather than reinvented: direct question "do
// we have solid wall chunks yet like mountain terrain?" Answer at the time
// this was written: no — Highland/Snow were elevation-biased *scatter*
// (each obstacle tile independently rolled from its own noise field), never
// a real contiguous landform. This carves one: random-fill-then-smooth
// cellular automata, scoped strictly to Highland/Snow-dominant tiles (the
// same `dominantBiomeAt`-driven gating `carveBadlandsChambers` already
// established for its own biome-scoped generation), keeping only genuinely
// large connected wall components — real solid massifs, not speckle — as
// distinct from Badlands' own BSP chambers (thin carved corridor dividers,
// most of the biome stays open) or ordinary boulder scatter (independent
// single tiles, no landform). A massif's own outer rim is exactly what a
// later canopy-derivation pass reads as a "ridge" (CROPS_DESIGN.md).
// ---------------------------------------------------------------------------

/**
 * Same shape as `CAVE_INITIAL_WALL_CHANCE`, but deliberately ABOVE 0.5, not
 * mirroring its value — a real, sampled-and-caught bug: `CAVE_INITIAL_WALL_
 * CHANCE` (0.4) works for underground caves because *floor* is what needs
 * to survive and consolidate into one big region there, and under this
 * majority-vote smoothing rule, whichever phase starts as the majority is
 * the one that reliably consolidates — wall being the minority phase is
 * exactly why caves stay mostly open. This generator wants the opposite
 * outcome (wall consolidates, floor stays open), so wall has to start as
 * the majority, not the same-looking-but-wrong 0.45 an initial pass used
 * (confirmed by real sampling: only 7/20 generated worlds had ANY massif at
 * all, averaging ~11 wall tiles against an ~867-tile Highland/Snow
 * footprint — the CA was shrinking wall away almost everywhere, same
 * mechanism that makes caves mostly floor, just not what a massif needs).
 */
const MASSIF_INITIAL_WALL_CHANCE = 0.58;
/** Same recipe as the cave CA — random fill settles into smooth-edged blobs after a few neighbor-majority passes. */
const MASSIF_SMOOTHING_ITERATIONS = 4;
/** Same rule as `CAVE_WALL_NEIGHBOR_THRESHOLD`, but off-footprint neighbors (a tile that isn't Highland/Snow-dominant) are NOT forced to count as wall the way underground's off-map edge is — a massif should taper naturally at its own biome boundary, not wall itself off from the surrounding land the way a cave never opens onto the world border. */
const MASSIF_WALL_NEIGHBOR_THRESHOLD = 5;
/** A connected wall component smaller than this many tiles reads as leftover CA speckle, not a real massif — cleared back to open ground rather than left as scattered single-tile noise. */
const MASSIF_MIN_COMPONENT_SIZE = 12;
/** Deliberately bigger than `BOULDER_ELEVATION_BOOST` (0.8) — a real mountain massif should read taller than an ordinary boulder outcrop, not the same height. */
const MASSIF_ELEVATION_BOOST = 1.6;
/**
 * How much extra initial-fill chance a `highEdges`-marked boundary band
 * gets, on top of `MASSIF_INITIAL_WALL_CHANCE` — cross-zone contiguity for
 * mountains, the same "even if it doesn't perfectly line up" bias
 * `riverEdges`' trench already established for rivers: a zone whose macro
 * neighbor across this edge is also elevated gets more raw wall material
 * seeded near that specific edge, so a real massif is more likely to
 * actually grow toward (and plausibly abut) whatever the neighboring zone
 * generates on its own side — a nudge, not a guaranteed stitch.
 */
const MASSIF_EDGE_SEED_BOOST = 0.3;
/** Same idea as `RIVER_EDGE_TRENCH_EXPONENT` — keeps the seed-chance boost a real narrow band near the edge, not a whole-zone-wide bump. */
const MASSIF_EDGE_SEED_EXPONENT = 2;

/**
 * True if `(x, y)` reads as Highland or Snow more strongly than every other
 * biome in `biomeWeightsAt`'s blend — the same *dominant*, not merely
 * nonzero-weight, standard `isBadlandsDominant` already established, so a
 * massif stays inside its own biome's real footprint instead of spilling
 * into the cross-biome transition band at its edges.
 */
function isMassifBiomeDominant(seeds: readonly BiomeSeedInfo[], x: number, y: number): boolean {
  const weights = biomeWeightsAt(seeds, x, y);
  let bestName: string | undefined;
  let bestWeight = 0;
  for (const [name, weight] of Object.entries(weights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestName = name;
    }
  }
  return bestName === "highland" || bestName === "snow";
}

/**
 * Clears (sets to floor/0) every 4-connected wall component smaller than
 * `MASSIF_MIN_COMPONENT_SIZE` — the massif's own version of
 * `keepOnlyLargestFloorRegion`, but the mirror concern: that function keeps
 * exactly one open region and walls off every smaller pocket (an
 * underground cave must stay fully reachable); this keeps every
 * sufficiently large WALL mass (a real generated world can and should have
 * more than one separate mountain range) and clears only the small leftover
 * speckle CA smoothing didn't fully resolve.
 */
function clearSmallWallComponents(grid: Uint8Array, width: number, height: number, minSize: number): void {
  const visited = new Uint8Array(grid.length);

  for (let start = 0; start < grid.length; start++) {
    if (visited[start] || !grid[start]) continue; // already visited, or already floor
    const component: number[] = [start];
    visited[start] = 1;
    const queue = [start];
    while (queue.length > 0) {
      const i = queue.pop()!;
      const x = i % width;
      const y = Math.floor(i / width);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx! < 0 || ny! < 0 || nx! >= width || ny! >= height) continue;
        const ni = ny! * width + nx!;
        if (visited[ni] || !grid[ni]) continue;
        visited[ni] = 1;
        queue.push(ni);
        component.push(ni);
      }
    }
    if (component.length < minSize) {
      for (const i of component) grid[i] = 0;
    }
  }
}

/**
 * Carves real, contiguous mountain-massif wall structure into every
 * Highland/Snow-dominant tile — see this section's doc comment. A no-op on
 * a world with no biome data at all (`world.biomeSeeds` absent/empty), same
 * contract every other biome-aware function in this file follows. Runs
 * after `carveSuicuneRivers` (skips any tile a river already carved to
 * "water" via the `tile.terrain === "water"` check below) — the same
 * ordering `carveBadlandsChambers` already established, for the same
 * reason: simpler for this pass to skip the handful of tiles a river
 * already claimed than for river carving to have to reason about massifs.
 * `highEdges` (from `ZoneGenerationBias.elevation`, when this zone has one)
 * biases extra initial wall material toward those specific edges — cross-
 * zone mountain contiguity, see `MASSIF_EDGE_SEED_BOOST`'s doc comment.
 */
function carveMountainMassifs(world: World, width: number, height: number, rng: () => number, highEdges: readonly ZoneDirection[] = []): void {
  const seeds = world.biomeSeeds;
  if (!seeds || seeds.length === 0) return;

  const dominant = new Uint8Array(width * height);
  const grid = new Uint8Array(width * height); // 1 = wall (massif), 0 = floor
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = tileAt(world, "surface", x, y);
      if (!tile || tile.terrain === "water" || !isMassifBiomeDominant(seeds, x, y)) continue;
      dominant[y * width + x] = 1;
      let fillChance = MASSIF_INITIAL_WALL_CHANCE;
      for (const dir of highEdges) {
        fillChance += edgeCloseness(dir, x, y, width, height) ** MASSIF_EDGE_SEED_EXPONENT * MASSIF_EDGE_SEED_BOOST;
      }
      grid[y * width + x] = rng() < Math.min(0.95, fillChance) ? 1 : 0;
    }
  }

  for (let iter = 0; iter < MASSIF_SMOOTHING_ITERATIONS; iter++) {
    const next = new Uint8Array(grid.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        // Off the massif's own biome footprint entirely — never a wall,
        // regardless of how many wall neighbors it has, so a massif tapers
        // to its real biome boundary instead of bleeding into Grassland.
        if (!dominant[i]) continue;
        next[i] = countWallNeighbors(grid, width, height, x, y) >= MASSIF_WALL_NEIGHBOR_THRESHOLD ? 1 : 0;
      }
    }
    grid.set(next);
  }

  clearSmallWallComponents(grid, width, height, MASSIF_MIN_COMPONENT_SIZE);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!grid[i]) continue;
      const tile = tileAt(world, "surface", x, y)!;
      // Undo any existing BOULDER_ELEVATION_BOOST first (same "re-painting
      // is a no-op, not a double boost" pattern carveBadlandsChambers
      // already uses) before applying the massif's own, taller boost.
      const ambientElevation = tile.terrain === "boulder" ? tile.elevation - BOULDER_ELEVATION_BOOST : tile.elevation;
      setTile(world, "surface", x, y, "wall", ambientElevation + MASSIF_ELEVATION_BOOST);
    }
  }
}

// ---------------------------------------------------------------------------
// Landmark terrain — direct ask: "particularly unique zone gen" and "make
// 'em interesting to look at." Each landmark carves a real, spatially
// localized feature (a bounded patch, not the whole zone) on top of the
// zone's ordinary biome-blended generation, run last (after rivers/BSP/
// caves) so it always wins. Reuses this file's own existing primitives
// (the CA cave algorithm above, `setTile`) rather than inventing per-
// landmark generation from scratch — same "one small carving pass, same
// shape as the others" idiom `carveBadlandsChambers` already established.
// ---------------------------------------------------------------------------

/** How far in from a zone's edge a landmark's center can land — keeps the feature from getting clipped by the map border. */
const LANDMARK_EDGE_MARGIN = 8;

function pickLandmarkCenter(rng: () => number, width: number, height: number): Vec2 {
  const margin = Math.min(LANDMARK_EDGE_MARGIN, Math.floor(Math.min(width, height) / 3));
  return {
    x: margin + Math.floor(rng() * Math.max(1, width - margin * 2)),
    y: margin + Math.floor(rng() * Math.max(1, height - margin * 2)),
  };
}

/** A filled circle (Euclidean, with a little per-tile edge jitter so it doesn't read as a perfect compass-drawn ring) — the shared shape underneath Great Lake/Sacred Spring/Meteor Crater's floor. */
function forEachTileInJitteredCircle(center: Vec2, radius: number, width: number, height: number, rng: () => number, fn: (x: number, y: number, distFrac: number) => void): void {
  const r = Math.round(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const jitter = (rng() - 0.5) * 1.5;
      if (dist + jitter > radius) continue;
      fn(x, y, dist / radius);
    }
  }
}

const GREAT_LAKE_RADIUS = 7;
function applyGreatLake(world: World, width: number, height: number, rng: () => number): void {
  const center = pickLandmarkCenter(rng, width, height);
  forEachTileInJitteredCircle(center, GREAT_LAKE_RADIUS, width, height, rng, (x, y) => {
    setTile(world, "surface", x, y, "water", 0);
  });
}

const SACRED_SPRING_RADIUS = 2;
function applySacredSpring(world: World, width: number, height: number, rng: () => number): void {
  const center = pickLandmarkCenter(rng, width, height);
  // Small and deliberate — a real spring, not another lake; the surrounding
  // ring gets a food-stock bump (real oasis-adjacent growth), not more water.
  forEachTileInJitteredCircle(center, SACRED_SPRING_RADIUS, width, height, rng, (x, y) => {
    setTile(world, "surface", x, y, "water", 0);
  });
  forEachTileInJitteredCircle(center, SACRED_SPRING_RADIUS + 3, width, height, rng, (x, y, distFrac) => {
    if (distFrac < 0.5) return; // the water ring itself, already handled above
    const tile = tileAt(world, "surface", x, y);
    if (tile?.terrain === "floor" && rng() < 0.4) setTile(world, "surface", x, y, "food", 0.8);
  });
}

const METEOR_CRATER_RADIUS = 6;
function applyMeteorCrater(world: World, width: number, height: number, rng: () => number): void {
  const center = pickLandmarkCenter(rng, width, height);
  forEachTileInJitteredCircle(center, METEOR_CRATER_RADIUS, width, height, rng, (x, y, distFrac) => {
    const tile = tileAt(world, "surface", x, y);
    if (!tile || tile.terrain === "water") return;
    if (distFrac > 0.8) {
      // The rim — real impact debris, a ring of boulders thrown up by the strike.
      setTile(world, "surface", x, y, "boulder", tile.elevation + BOULDER_ELEVATION_BOOST);
    } else {
      // The crater floor — cleared and, per real "impact site enriches the
      // ground" flavor, unusually food-rich.
      setTile(world, "surface", x, y, rng() < 0.35 ? "food" : "floor", Math.max(0, tile.elevation - 0.3));
    }
  });
}

/** A local, bounded cellular-automata cave patch — same recipe `generateUndergroundCaves` uses (random fill + neighbor-majority smoothing + keep-largest-region), just sized to one landmark's footprint instead of a whole layer. Returns which local cells are "wall" (1) vs. "floor" (0). */
function carveOrganicCavePatch(diameter: number, rng: () => number): Uint8Array {
  const grid = new Uint8Array(diameter * diameter);
  for (let i = 0; i < grid.length; i++) grid[i] = rng() < CAVE_INITIAL_WALL_CHANCE ? 1 : 0;
  for (let iter = 0; iter < CAVE_SMOOTHING_ITERATIONS; iter++) {
    const next = new Uint8Array(grid.length);
    for (let y = 0; y < diameter; y++) {
      for (let x = 0; x < diameter; x++) {
        next[y * diameter + x] = countWallNeighbors(grid, diameter, diameter, x, y) >= CAVE_WALL_NEIGHBOR_THRESHOLD ? 1 : 0;
      }
    }
    grid.set(next);
  }
  keepOnlyLargestFloorRegion(grid, diameter, diameter);
  return grid;
}

const DEEP_CAVERN_RADIUS = 9;
function applyDeepCavern(world: World, width: number, height: number, rng: () => number): void {
  const diameter = DEEP_CAVERN_RADIUS * 2 + 1;
  const patch = carveOrganicCavePatch(diameter, rng);
  const centerPick = pickLandmarkCenter(rng, width, height);
  const origin: Vec2 = { x: Math.min(width - diameter, Math.max(0, centerPick.x - DEEP_CAVERN_RADIUS)), y: Math.min(height - diameter, Math.max(0, centerPick.y - DEEP_CAVERN_RADIUS)) };
  for (let y = 0; y < diameter; y++) {
    for (let x = 0; x < diameter; x++) {
      const wx = origin.x + x;
      const wy = origin.y + y;
      const tile = tileAt(world, "surface", wx, wy);
      if (!tile || tile.terrain === "water") continue;
      if (patch[y * diameter + x]) setTile(world, "surface", wx, wy, "wall", tile.elevation + BOULDER_ELEVATION_BOOST);
    }
  }
}

/** Frozen Grotto's own version of Deep Cavern's cave shape — "boulder" (climbable icy rock) instead of "wall" (a real blocking cliff face), a softer, more traversable cave befitting an ice cave you can wander into rather than a sealed cavern. */
function applyFrozenGrotto(world: World, width: number, height: number, rng: () => number): void {
  const diameter = DEEP_CAVERN_RADIUS * 2 + 1;
  const patch = carveOrganicCavePatch(diameter, rng);
  const centerPick = pickLandmarkCenter(rng, width, height);
  const origin: Vec2 = { x: Math.min(width - diameter, Math.max(0, centerPick.x - DEEP_CAVERN_RADIUS)), y: Math.min(height - diameter, Math.max(0, centerPick.y - DEEP_CAVERN_RADIUS)) };
  for (let y = 0; y < diameter; y++) {
    for (let x = 0; x < diameter; x++) {
      const wx = origin.x + x;
      const wy = origin.y + y;
      const tile = tileAt(world, "surface", wx, wy);
      if (!tile || tile.terrain === "water") continue;
      if (patch[y * diameter + x]) setTile(world, "surface", wx, wy, "boulder", tile.elevation + BOULDER_ELEVATION_BOOST);
    }
  }
}

const TUNNEL_WARREN_RADIUS = 8;
/** How many separate burrow-entrance clusters get scattered across the warren's footprint. */
const TUNNEL_WARREN_BURROW_COUNT = 6;
function applyTunnelWarren(world: World, width: number, height: number, rng: () => number): void {
  const center = pickLandmarkCenter(rng, width, height);
  // The colony's own dug ground — a wide patch of loose sand/mud, real digging
  // material, not rock (distinct from Deep Cavern's carved-rock read).
  forEachTileInJitteredCircle(center, TUNNEL_WARREN_RADIUS, width, height, rng, (x, y) => {
    const tile = tileAt(world, "surface", x, y);
    if (tile?.terrain === "floor" && rng() < 0.5) setTile(world, "surface", x, y, rng() < 0.5 ? "sand" : "mud", tile.elevation);
  });
  // Several distinct burrow-entrance clusters (small boulder rings marking a
  // real dug-out mound) scattered through that footprint — many separate
  // holes, not one single den.
  for (let i = 0; i < TUNNEL_WARREN_BURROW_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = rng() * TUNNEL_WARREN_RADIUS * 0.8;
    const bx = Math.round(center.x + Math.cos(angle) * dist);
    const by = Math.round(center.y + Math.sin(angle) * dist);
    forEachTileInJitteredCircle({ x: bx, y: by }, 1, width, height, rng, (x, y) => {
      const tile = tileAt(world, "surface", x, y);
      if (tile && tile.terrain !== "water") setTile(world, "surface", x, y, "mud", tile.elevation);
    });
  }
}

const BONE_GROUNDS_RADIUS = 6;
function applyBoneGrounds(world: World, width: number, height: number, rng: () => number): void {
  const center = pickLandmarkCenter(rng, width, height);
  // A real "elephant graveyard" clearing — starkly open ground, almost every
  // obstacle stripped away, nothing planted here on purpose; whatever life
  // this patch gets comes only from what's died and decayed on it.
  forEachTileInJitteredCircle(center, BONE_GROUNDS_RADIUS, width, height, rng, (x, y) => {
    const tile = tileAt(world, "surface", x, y);
    if (tile && tile.terrain !== "water" && tile.terrain !== "floor") setTile(world, "surface", x, y, "floor", tile.elevation);
  });
}

const GEOTHERMAL_VENT_RADIUS = 5;
function applyGeothermalVent(world: World, width: number, height: number, rng: () => number): void {
  const center = pickLandmarkCenter(rng, width, height);
  // A real cluster of "sunbeam" tiles (worldgen.ts's own rare warmth terrain,
  // elsewhere only a scattered 3% roll on high ground) — reliably dense here
  // instead of incidental, so this genuinely reads as a warm spot on the map.
  forEachTileInJitteredCircle(center, GEOTHERMAL_VENT_RADIUS, width, height, rng, (x, y) => {
    const tile = tileAt(world, "surface", x, y);
    if (tile?.terrain === "floor" && rng() < 0.6) setTile(world, "surface", x, y, "sunbeam", tile.elevation);
  });
}

const CROSSROADS_RADIUS = 7;
function applyCrossroads(world: World, width: number, height: number, rng: () => number): void {
  const center = pickLandmarkCenter(rng, width, height);
  // A real geographic junction reads as open ground — obstacles thinned out,
  // wide sightlines, the paths that actually converge here left legible
  // instead of choked with whatever the ordinary biome would have scattered.
  forEachTileInJitteredCircle(center, CROSSROADS_RADIUS, width, height, rng, (x, y) => {
    const tile = tileAt(world, "surface", x, y);
    if (tile && tile.terrain !== "water" && tile.terrain !== "floor" && rng() < 0.7) setTile(world, "surface", x, y, "floor", tile.elevation);
  });
}

/** Fertile Basin's own signature — real overgrowth, denser bush/tree cover than the zone's ordinary biome blend would place on its own, read as a lush hollow rather than just "grassland, but higher numbers underneath." */
const FERTILE_BASIN_RADIUS = 7;
function applyFertileBasin(world: World, width: number, height: number, rng: () => number): void {
  const center = pickLandmarkCenter(rng, width, height);
  forEachTileInJitteredCircle(center, FERTILE_BASIN_RADIUS, width, height, rng, (x, y) => {
    const tile = tileAt(world, "surface", x, y);
    if (tile?.terrain === "floor" && rng() < 0.5) setTile(world, "surface", x, y, rng() < 0.6 ? "bush" : "food", tile.elevation);
  });
}

function applyLandmarkFeature(world: World, width: number, height: number, rng: () => number, landmark: LandmarkType | undefined): void {
  switch (landmark) {
    case "greatLake":
      return applyGreatLake(world, width, height, rng);
    case "fertileBasin":
      return applyFertileBasin(world, width, height, rng);
    case "sacredSpring":
      return applySacredSpring(world, width, height, rng);
    case "geothermalVent":
      return applyGeothermalVent(world, width, height, rng);
    case "meteorCrater":
      return applyMeteorCrater(world, width, height, rng);
    case "deepCavern":
      return applyDeepCavern(world, width, height, rng);
    case "tunnelWarren":
      return applyTunnelWarren(world, width, height, rng);
    case "boneGrounds":
      return applyBoneGrounds(world, width, height, rng);
    case "frozenGrotto":
      return applyFrozenGrotto(world, width, height, rng);
    case "crossroads":
      return applyCrossroads(world, width, height, rng);
    case undefined:
      return;
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** A tile this elevated (or higher) has a small chance of generating a "sunbeam" tile — feeds flora.ts's near-sunbeam food-flavor boost. */
const SUNBEAM_ELEVATION_THRESHOLD = 1.5;
const SUNBEAM_CHANCE = 0.03;

/** Flat elevation bump applied to a boulder tile on top of the ambient field at that spot — see the "boulders sit higher" comment at its one call site below. Sim-original magnitude, not canon. */
const BOULDER_ELEVATION_BOOST = 0.8;

/**
 * Generates a full surface-layer world: biome seeds scattered by `seed`,
 * every tile's water/obstacle/food placement and elevation drawn from a
 * distance-weighted blend of nearby seeds plus a handful of independent
 * smoothed-noise fields (so, e.g., which *specific* obstacle kind wins at a
 * given tile is its own noise roll scaled by the blended terrain weights,
 * not a single deterministic "biome X always means terrain Y"). Fully
 * deterministic for a given (width, height, seed) — see worldgen.test.ts.
 */
/**
 * `world.rng` (the behavior generator every other engine subsystem draws
 * from — see types.ts's `World.rng` doc comment) is seeded from `seed ^
 * BEHAVIOR_RNG_SEED_XOR`, not bare `seed` — deliberately a different derived
 * stream from the one this function's own terrain-placement rngs below (all
 * seeded from `seed` or `seed ^ <some other constant>`) consume, on the same
 * "derive a distinct sub-stream per xor constant" pattern this function
 * already uses for elevation/moisture/obstacle/food/flavor/sunbeam noise.
 * Without this, `world.rng`'s very first roll would exactly replay
 * `placementRng`'s first roll (both `mulberry32(seed)`, just two separate,
 * uncorrelated-in-effect-but-textually-identical instances) — harmless
 * either way since both are already fully deterministic, but a needless and
 * confusing coincidence to leave in place when every other sub-stream here
 * already gets its own distinct xor'd seed.
 */
const BEHAVIOR_RNG_SEED_XOR = 0x632be5ab;

/**
 * Optional steering for `generateWorld`, threaded straight into
 * `generateMacroElevation` (see `MacroElevationBias`'s own doc comment) plus
 * one more per-tile concern that lives at this level instead: which biome
 * should actually dominate this zone's land, so a promoted zone matches its
 * macro grid cell's own dominant biome rather than whatever the ordinary
 * random biome-seed scatter happens to roll. Absent entirely for every
 * existing caller (`createDemoWorld`'s plain `generateWorld(w, h, seed)`) —
 * zero behavior change there.
 */
export interface ZoneGenerationBias {
  elevation: MacroElevationBias;
  /** A `BIOME_NAMES` entry to bias this zone's biome-seed scatter toward — absent (or a name `generateWorld` doesn't recognize, e.g. "ocean") leaves biome placement exactly as unbiased `placeBiomeSeeds` would. */
  dominantBiome?: string;
  /** This zone's `MacroZone.landmark`, if any — carves genuinely distinct terrain on top of the ordinary biome-blended generation above (`applyLandmarkFeature`, run last, after rivers/BSP/caves). Absent = an ordinary zone, ordinary terrain. */
  landmark?: LandmarkType;
}

/** How many extra seeds of `ZoneGenerationBias.dominantBiome` get scattered on top of the ordinary biome mix — enough to make it genuinely dominate the blend (see `blendBiomeParams`'s nearest-`NEAREST_BIOME_SEEDS` weighting) without completely erasing the variety a real zone should still have. Sim-original guess, judge against a real promoted zone like every other tuning constant in this file. */
const DOMINANT_BIOME_EXTRA_SEEDS = 8;

function addDominantBiomeSeeds(seeds: BiomeSeed[], biomeName: string | undefined, rng: () => number, width: number, height: number): void {
  const biome = biomeName ? BIOME_BY_NAME[biomeName] : undefined;
  if (!biome) return;
  for (let i = 0; i < DOMINANT_BIOME_EXTRA_SEEDS; i++) {
    seeds.push({ x: rng() * width, y: rng() * height, biome });
  }
}

export function generateWorld(width: number, height: number, seed: number, bias?: ZoneGenerationBias): World {
  const world = createWorld(width, height, seed ^ BEHAVIOR_RNG_SEED_XOR);
  const placementRng = mulberry32(seed);
  const seeds = placeBiomeSeeds(placementRng, width, height);
  addDominantBiomeSeeds(seeds, bias?.dominantBiome, mulberry32(seed ^ 0x6a09e667), width, height);
  // Name-only projection persisted on the World — see types.ts's
  // `BiomeSeedInfo` doc comment for why weather.ts needs this and can't just
  // reuse the full internal `BiomeSeed[]` (private to this module's own
  // generation params).
  world.biomeSeeds = seeds.map((s) => ({ x: s.x, y: s.y, name: s.biome.name }));

  const noiseScale = Math.max(width, height);
  // Macro elevation (land/ocean boundary + mountain ranges) replaces the old
  // small-scale `elevationNoise` value-noise field entirely — see the
  // "Macro elevation" section above. `macroDetailNoise` feeds it as the tiny
  // coastline-roughness detail component (MACRO_DETAIL_WEIGHT), reusing the
  // same xor constant the old elevation noise used since it plays the same
  // "elevation-ish detail texture" role.
  const macroDetailNoise = makeNoise2D(mulberry32(seed ^ 0x9e3779b9), width, height, noiseScale / 10);
  const macroPointsRng = mulberry32(seed ^ 0x51c48a7d);
  const macroElevation = generateMacroElevation(macroPointsRng, width, height, macroDetailNoise, bias?.elevation);
  const moistureField = makeDensityField(seed ^ 0x85ebca6b, width, height, noiseScale / 8);
  const obstacleField = makeDensityField(seed ^ 0xc2b2ae35, width, height, 4);
  const foodField = makeDensityField(seed ^ 0x27d4eb2f, width, height, 3);
  const flavorRng = mulberry32(seed ^ 0x1b873593);
  const sunbeamRng = mulberry32(seed ^ 0x0ff51afd);

  const kindNoise: Record<ObstacleKind, (x: number, y: number) => number> = {
    tree: makeNoise2D(mulberry32(seed ^ 0x1000193), width, height, 5),
    boulder: makeNoise2D(mulberry32(seed ^ 0x1000197), width, height, 5),
    bush: makeNoise2D(mulberry32(seed ^ 0x100019b), width, height, 4),
    sand: makeNoise2D(mulberry32(seed ^ 0x100019f), width, height, 6),
    mud: makeNoise2D(mulberry32(seed ^ 0x10001a3), width, height, 6),
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // True ocean: Kyogre won the tug-of-war here (see `generateMacroElevation`).
      // This overrides the per-biome water-density roll below entirely —
      // that roll still independently places small in-land ponds/wetland
      // water on LAND tiles, but a tile the macro field placed below sea
      // level is ocean regardless of which biome it blends toward.
      if (macroElevation.isOcean(x, y)) {
        setTile(world, "surface", x, y, "water", 0);
        continue;
      }

      const params = blendBiomeParams(seeds, x, y);
      const elevation = Math.max(0, params.elevationBase + (macroElevation.normalized(x, y) - 0.5) * 2 * params.elevationVariance);

      // Water: a smooth, calibrated moisture field thresholded by this
      // tile's own blended waterDensity — a Wetland-leaning tile has a much
      // bigger "count as water" band than a Badlands-leaning one, and that
      // band itself shifts continuously across a biome boundary (no step).
      if (moistureField.sample(x, y) < moistureField.thresholdFor(params.waterDensity)) {
        setTile(world, "surface", x, y, "water");
        setElevation(world, "surface", x, y, 0); // a lakebed is flat, not textured by the elevation field
        continue;
      }

      // Obstacles: one calibrated field decides IF this tile gets an
      // obstacle; each kind has its own independent noise field, scaled by
      // this tile's blended weight for that kind, and the highest score
      // wins — so a Forest-leaning tile is likely (not guaranteed) to roll
      // "tree", a Highland-leaning one "boulder", with a genuinely mixed,
      // gradual hand-off in between rather than a hard per-biome table.
      if (obstacleField.sample(x, y) < obstacleField.thresholdFor(params.obstacleDensity)) {
        let bestKind: ObstacleKind = "tree";
        let bestScore = -Infinity;
        for (const kind of OBSTACLE_KINDS) {
          const score = kindNoise[kind](x, y) * params.terrainWeights[kind];
          if (score > bestScore) {
            bestScore = score;
            bestKind = kind;
          }
        }
        // Boulders sit visibly higher than the ambient terrain around them —
        // real raised rock, not just a flat obstacle painted onto the same
        // elevation as everything else. Direct ask: "maybe they are higher
        // elevated" (offered alongside the movement-speed cost, not instead
        // of it — see support.ts's `terrainSpeedMultiplier`, which composes
        // with this via `elevationSpeedMultiplier` for a real combined cost).
        const tileElevation = bestKind === "boulder" ? elevation + BOULDER_ELEVATION_BOOST : elevation;
        setTile(world, "surface", x, y, bestKind, tileElevation);
        continue;
      }

      if (foodField.sample(x, y) < foodField.thresholdFor(params.foodDensity)) {
        // Real biome/moisture-gated crop pick (crops.ts's pickCrop), same
        // runtime biome-blend/moisture-proxy functions flora.ts's own
        // maturation pick reuses — nearSun is always false here since
        // sunbeam tiles aren't placed until after this loop runs (see
        // below). Tomato (sunLoving) can still be picked here at its base
        // rate — nearSun only doubles its odds, it was never a hard
        // requirement (see crops.ts's own doc comment on why one would be
        // unreachable in Tomato's assigned biomes anyway).
        const biome = dominantBiomeAt(world.biomeSeeds, x, y);
        const moisture = effectiveWaterDensityAt(world.biomeSeeds, world.biomeSeedDrift, x, y);
        const crop = pickCrop(biome, moisture, world.tick, false, flavorRng);
        setTile(world, "surface", x, y, "food", elevation, crop);
        continue;
      }

      setElevation(world, "surface", x, y, elevation);
      if (elevation >= SUNBEAM_ELEVATION_THRESHOLD && sunbeamRng() < SUNBEAM_CHANCE) {
        setTile(world, "surface", x, y, "sunbeam", elevation);
      }
    }
  }

  // Rivers run last, once the full land/ocean/biome/obstacle grid (and its
  // real final elevations) already exists for steepest descent to work from.
  carveSuicuneRivers(world, width, height, macroElevation);

  // Badlands BSP chambers run after rivers — see this file's own section doc
  // comment for why — using their own derived rng sub-stream, same "distinct
  // xor'd seed per generation concern" pattern as every other noise field
  // above.
  carveBadlandsChambers(world, width, height, mulberry32(seed ^ 0x2545f491));

  // Mountain massifs, same "after rivers, skip existing water" ordering as
  // Badlands BSP chambers just above — its own derived rng sub-stream, same
  // "distinct xor'd seed per generation concern" pattern as every other
  // noise field in this function.
  carveMountainMassifs(world, width, height, mulberry32(seed ^ 0xbb67ae85), bias?.elevation.highEdges);

  // Underground caves are independent of everything Surface-only above (no
  // biome/elevation/moisture data to read) — its own derived rng sub-stream,
  // same "distinct xor'd seed per generation concern" pattern as every other
  // noise field in this function.
  generateUndergroundCaves(world, width, height, mulberry32(seed ^ 0x27220a95));

  // Landmark terrain runs last of all — it deliberately overwrites whatever
  // ordinary biome/river/cave generation already placed on top of a
  // promoted zone's footprint, same "distinct xor'd seed per generation
  // concern" pattern as every other step above.
  applyLandmarkFeature(world, width, height, mulberry32(seed ^ 0x9e3779b1), bias?.landmark);

  return world;
}

/**
 * Finds the nearest walkable tile to (x, y) via an expanding ring search —
 * used to place a scenario's starting agents on a procedurally generated map
 * without needing to know in advance whether the exact anchor coordinate
 * happens to be an obstacle or water. Falls back to the clamped anchor
 * itself if nothing walkable exists anywhere on the map (shouldn't happen in
 * practice; obstacle/water densities never approach 100%).
 */
export function findWalkableNear(world: World, layer: Layer, x: number, y: number): Vec2 {
  const cx = Math.min(world.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(world.height - 1, Math.max(0, Math.round(y)));
  const maxRadius = Math.max(world.width, world.height);

  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // ring only, not the filled square (already visited at a smaller r)
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        const tile = tileAt(world, layer, nx, ny);
        if (tile?.walkable && canEnterWater(world, LAND_PROBE, layer, { x: nx, y: ny })) return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}

/**
 * Samples `attempts` random points across the whole map and returns the
 * nearest walkable tile to whichever one most strongly reads as
 * `biomeNames` (summed `biomeWeightsAt` weight across every name in the
 * list — a species with more than one tagged biome, per species.ts's
 * `SpeciesDef.biomes`, is happy to land in any of them). This is the "find
 * me a spot that's actually this biome, not just any random tile" primitive
 * behind `createDemoWorld`'s biome-driven starting placements (e.g.
 * Charmander -> badlands) — see DESIGN.md's "Species/biome/immigration"
 * section. `immigration.ts` doesn't reuse this directly (it needs its
 * candidates biased toward a map *edge*, not the whole map, for "arrives
 * from outside" to mean anything), but shares the same
 * `biomeWeightsAt`-scoring idea.
 *
 * Falls back to a plain random walkable point when there's no biome
 * preference to honor (`biomeNames` absent/empty) or no biome data to score
 * against at all (`world.biomeSeeds` absent — a bare `createWorld`/hand-built
 * test world) — never throws, never silently ignores the rng.
 */
export function findPosInBiome(world: World, layer: Layer, biomeNames: readonly string[] | undefined, rng: () => number, attempts = 40): Vec2 {
  if (!biomeNames || biomeNames.length === 0 || !world.biomeSeeds || world.biomeSeeds.length === 0) {
    return findWalkableNear(world, layer, rng() * world.width, rng() * world.height);
  }

  let bestPos = { x: rng() * world.width, y: rng() * world.height };
  let bestScore = -1;
  for (let i = 0; i < attempts; i++) {
    const candidate = { x: rng() * world.width, y: rng() * world.height };
    const weights = biomeWeightsAt(world.biomeSeeds, candidate.x, candidate.y);
    const score = biomeNames.reduce((sum, name) => sum + (weights[name] ?? 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestPos = candidate;
    }
  }
  return findWalkableNear(world, layer, bestPos.x, bestPos.y);
}
