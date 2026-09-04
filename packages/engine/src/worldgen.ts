import type { BiomeSeedInfo, Layer, Vec2, World } from "./types.js";
import { createWorld, setElevation, setTile, tileAt } from "./world.js";
import { FOOD_FLAVORS } from "./flora.js";
import { mulberry32 } from "./rng.js";

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
 * Five biomes per DESIGN.md's list. Every numeric value here is a
 * sim-original guess to be judged against a real run, exactly like every
 * other tuning constant in this codebase — not remotely canon, not
 * validated against anything but "does the generated map look/feel varied,"
 * see DESIGN.md's real-run findings for this feature.
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
    name: "highland",
    seedCount: 2,
    foodDensity: 0.02,
    waterDensity: 0.03,
    obstacleDensity: 0.18,
    elevationBase: 2.2,
    elevationVariance: 1.3,
    terrainWeights: { tree: 0.4, boulder: 4, bush: 0.25, sand: 0.15, mud: 0.1 },
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

export function generateWorld(width: number, height: number, seed: number): World {
  const world = createWorld(width, height, seed ^ BEHAVIOR_RNG_SEED_XOR);
  const placementRng = mulberry32(seed);
  const seeds = placeBiomeSeeds(placementRng, width, height);
  // Name-only projection persisted on the World — see types.ts's
  // `BiomeSeedInfo` doc comment for why weather.ts needs this and can't just
  // reuse the full internal `BiomeSeed[]` (private to this module's own
  // generation params).
  world.biomeSeeds = seeds.map((s) => ({ x: s.x, y: s.y, name: s.biome.name }));

  const noiseScale = Math.max(width, height);
  const elevationNoise = makeNoise2D(mulberry32(seed ^ 0x9e3779b9), width, height, noiseScale / 6);
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
      const params = blendBiomeParams(seeds, x, y);
      const elevation = Math.max(0, params.elevationBase + (elevationNoise(x, y) - 0.5) * 2 * params.elevationVariance);

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
        const flavor = FOOD_FLAVORS[Math.floor(flavorRng() * FOOD_FLAVORS.length)]!;
        setTile(world, "surface", x, y, "food", elevation, flavor);
        continue;
      }

      setElevation(world, "surface", x, y, elevation);
      if (elevation >= SUNBEAM_ELEVATION_THRESHOLD && sunbeamRng() < SUNBEAM_CHANCE) {
        setTile(world, "surface", x, y, "sunbeam", elevation);
      }
    }
  }

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
        if (tileAt(world, layer, nx, ny)?.walkable) return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}
