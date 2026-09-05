/**
 * Real-run validation for the overworld/region-graph system (TODO.md's
 * "Overworld: the current map becomes one region in a larger graph" item) —
 * proves promotion/demotion actually fire and produce sane aggregate
 * numbers, not just "should work" reasoning. Same style/purpose as
 * `validate.ts`. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateOverworld.ts <ticks> [switchTick] [switchToRegionId]`
 * — `switchTick`/`switchToRegionId` (default: none) move focus once
 * mid-run via `setFocusedRegion`, so a real promotion AND a real demotion
 * both fire in the same run.
 */
import { EventLog, findRegion, setFocusedRegion, tickOverworld, type Region } from "@pokuelike/engine";
import { createDemoOverworld, HUNT_RULES, IMMIGRATION_CONTEXT, LEVELING_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 3000);
const switchTick = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
const switchToRegionId = process.argv[4];

function aggregateSnapshot(region: Region): Record<string, { population: number; avgHunger: number; avgThirst: number; resourceIndex: number }> | "focused" {
  if (!region.aggregates) return "focused";
  const out: Record<string, { population: number; avgHunger: number; avgThirst: number; resourceIndex: number }> = {};
  for (const [species, agg] of Object.entries(region.aggregates)) {
    out[species] = {
      population: Math.round(agg.population * 100) / 100,
      avgHunger: Math.round(agg.avgHunger * 100) / 100,
      avgThirst: Math.round(agg.avgThirst * 100) / 100,
      resourceIndex: Math.round(agg.resourceIndex * 100) / 100,
    };
  }
  return out;
}

function livePopulation(region: Region): number {
  return region.world.agents.filter((a) => a.alive !== false && !a.isEgg).length;
}

const overworld = createDemoOverworld();
const log = new EventLog();

const initialSnapshot = Object.fromEntries(
  overworld.regions.map((r) => [r.id, r.id === overworld.focusedRegionId ? livePopulation(r) : aggregateSnapshot(r)])
);

let switched = false;
for (let i = 0; i < ticks; i++) {
  tickOverworld(overworld, log, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT);
  if (!switched && switchTick !== undefined && switchToRegionId && overworld.tick >= switchTick) {
    const target = findRegion(overworld, switchToRegionId);
    if (target) {
      setFocusedRegion(overworld, switchToRegionId, IMMIGRATION_CONTEXT, target.world.rng, log);
    }
    switched = true;
  }
}

const finalSnapshot = Object.fromEntries(
  overworld.regions.map((r) => [r.id, r.id === overworld.focusedRegionId ? livePopulation(r) : aggregateSnapshot(r)])
);

const eventCounts: Record<string, number> = {};
for (const e of log.events) eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;

console.log(JSON.stringify({
  ticks,
  switchTick,
  switchToRegionId,
  focusedRegionId: overworld.focusedRegionId,
  initialSnapshot,
  finalSnapshot,
  regionEventCounts: {
    regionDemoted: eventCounts.regionDemoted ?? 0,
    regionPromoted: eventCounts.regionPromoted ?? 0,
    regionPopulationBoom: eventCounts.regionPopulationBoom ?? 0,
    regionDieOff: eventCounts.regionDieOff ?? 0,
    regionEmigrated: eventCounts.regionEmigrated ?? 0,
  },
  regionEvents: log.events.filter((e) => e.kind.startsWith("region")),
}, null, 2));
