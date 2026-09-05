import { createOverworld, type Overworld, type Region, type RegionEdge } from "@pokuelike/engine";
import { createDemoWorld, SCENARIO_SEED } from "./scenario.js";

/**
 * The overworld's first real region graph — TODO.md's "start with a small
 * region count (3-4), not a large graph" ask. Each region is a full,
 * independently-generated `createDemoWorld` map (its own seed, its own
 * complete starting roster) rather than a new hand-authored scenario — the
 * cheapest way to get three genuinely different, fully-populated regions
 * without touching `scenario.ts`'s or `worldgen.ts`'s own generation logic
 * (both out of scope for this session — see DESIGN.md's overworld section).
 * A chain topology (`region-a - region-b - region-c`) rather than a fully
 * connected graph: enough to exercise both a promotion/demotion boundary
 * (moving focus along the chain) and an abstract-to-abstract migration edge
 * (`region-b`/`region-c` can both be abstract at once when `region-a` is
 * focused) without over-building for a first cut.
 */
export const OVERWORLD_REGION_SEEDS: Record<string, number> = {
  "region-a": SCENARIO_SEED,
  "region-b": SCENARIO_SEED + 1,
  "region-c": SCENARIO_SEED + 2,
};

export const OVERWORLD_EDGES: RegionEdge[] = [
  { a: "region-a", b: "region-b" },
  { a: "region-b", b: "region-c" },
];

/**
 * Builds the demo region graph with `focusedRegionId` (default "region-a")
 * running full sim and the rest immediately demoted to abstract aggregates
 * — see `createOverworld`'s own doc comment. Every region is deterministic
 * from `OVERWORLD_REGION_SEEDS`, so a specific run is always reproducible
 * the same way a single-region `createDemoWorld(seed)` run already is.
 */
export function createDemoOverworld(focusedRegionId = "region-a"): Overworld {
  const regions: Region[] = Object.entries(OVERWORLD_REGION_SEEDS).map(([id, seed]) => ({
    id,
    world: createDemoWorld(seed),
  }));
  return createOverworld(regions, OVERWORLD_EDGES, focusedRegionId);
}
