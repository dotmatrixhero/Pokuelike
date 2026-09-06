/**
 * Real-run validation for the overworld macro-grid system (TODO.md's
 * "Overworld: the current map becomes one cell in a larger grid" item) —
 * proves promotion/demotion and migration actually fire and produce sane
 * aggregate numbers over a real run, not just "should work" reasoning. Same
 * style/purpose as `validate.ts`. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateOverworld.ts <ticks> [switchTick] [switchToZoneKey]`
 * — `switchToZoneKey` is a plain `"row,col"` string (`zoneKey`'s own
 * format); `switchTick`/`switchToZoneKey` (default: none) move focus once
 * mid-run via `setFocusedZone`, so a real promotion AND a real demotion both
 * fire in the same run.
 */
import { EventLog, setFocusedZone, tickMacroWorld, zoneAt, parseZoneKey, type MacroWorld, type Region } from "@pokuelike/engine";
import { createDemoMacroWorld, HUNT_RULES, IMMIGRATION_CONTEXT, LEVELING_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 3000);
const switchTick = process.argv[3] !== undefined ? Number(process.argv[3]) : undefined;
const switchToZoneKey = process.argv[4];

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
  return region.world?.agents.filter((a) => a.alive !== false && !a.isEgg).length ?? 0;
}

function trackedSnapshot(mw: MacroWorld): Record<string, unknown> {
  return Object.fromEntries([...mw.regions.values()].map((r) => [r.key, r.key === mw.focusedKey ? livePopulation(r) : aggregateSnapshot(r)]));
}

const genStart = Date.now();
const mw = createDemoMacroWorld();
const genMs = Date.now() - genStart;
const log = new EventLog();

const initialTrackedCount = mw.regions.size;
const initialSnapshot = trackedSnapshot(mw);

let switched = false;
const tickStart = Date.now();
for (let i = 0; i < ticks; i++) {
  tickMacroWorld(mw, log, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT);
  if (!switched && switchTick !== undefined && switchToZoneKey && mw.tick >= switchTick) {
    const { row, col } = parseZoneKey(switchToZoneKey);
    if (zoneAt(mw.grid, row, col)) {
      setFocusedZone(mw, row, col, IMMIGRATION_CONTEXT, log);
    }
    switched = true;
  }
}
const tickMs = Date.now() - tickStart;

const finalSnapshot = trackedSnapshot(mw);

const eventCounts: Record<string, number> = {};
for (const e of log.events) eventCounts[e.kind] = (eventCounts[e.kind] ?? 0) + 1;

console.log(
  JSON.stringify(
    {
      gridZones: mw.grid.rows * mw.grid.cols,
      gridGenMs: genMs,
      ticks,
      tickMs,
      switchTick,
      switchToZoneKey,
      focusedKey: mw.focusedKey,
      initialTrackedZoneCount: initialTrackedCount,
      finalTrackedZoneCount: mw.regions.size,
      initialSnapshot,
      finalSnapshot,
      regionEventCounts: {
        regionDemoted: eventCounts.regionDemoted ?? 0,
        regionPromoted: eventCounts.regionPromoted ?? 0,
        regionPopulationBoom: eventCounts.regionPopulationBoom ?? 0,
        regionDieOff: eventCounts.regionDieOff ?? 0,
        regionEmigrated: eventCounts.regionEmigrated ?? 0,
        regionCrossed: eventCounts.regionCrossed ?? 0,
      },
      regionEvents: log.events.filter((e) => e.kind.startsWith("region")).slice(0, 40),
    },
    null,
    2
  )
);
