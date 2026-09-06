/**
 * Real-run validation for macro-scale weather fronts (TODO.md's "multi-zone
 * weather patterns" item) — proves a front actually suppresses a real
 * tracked background zone's resource baseline and boosts its emigration
 * while overhead, then lets it recover once the front dissipates, on a real
 * `createDemoMacroWorld` grid with real biomes/species. Natural front
 * spawns are deliberately rare (a handful per whole-run lifetime — see
 * `MACRO_WEATHER_SPAWN_CHANCE_PER_TICK`), and `MacroWorld.regions` growing
 * without bound as migration spreads (a known, already-flagged TODO.md
 * item) makes a long enough natural-spawn wait impractically slow for a
 * one-off validation script — so this drives the same spawn/drift/dissipate
 * machinery deterministically instead of waiting on the natural roll,
 * exactly the "rig the rng, run a real loop" idiom `overworld.test.ts`'s own
 * end-to-end tests already use. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateMacroWeather.ts`
 */
import { EventLog, tickMacroWorld, activeMacroWeatherAt, type MacroWorld, type Region } from "@pokuelike/engine";
import { createDemoMacroWorld, HUNT_RULES, IMMIGRATION_CONTEXT, LEVELING_CONTEXT } from "@pokuelike/data";

const mw: MacroWorld = createDemoMacroWorld();
const log = new EventLog();

function tick(n: number): void {
  for (let i = 0; i < n; i++) tickMacroWorld(mw, log, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT);
}

function biggestTrackedRegion(): Region {
  let best: Region | undefined;
  let bestPop = -1;
  for (const region of mw.regions.values()) {
    if (region.key === mw.focusedKey || !region.aggregates) continue;
    const pop = Object.values(region.aggregates).reduce((sum, a) => sum + a.population, 0);
    if (pop > bestPop) {
      best = region;
      bestPop = pop;
    }
  }
  if (!best) throw new Error("no tracked background region with population found — increase the phase-1 tick count");
  return best;
}

function snapshot(region: Region): Record<string, { population: number; baseResourceIndex: number }> {
  const out: Record<string, { population: number; baseResourceIndex: number }> = {};
  for (const [species, agg] of Object.entries(region.aggregates ?? {})) {
    out[species] = { population: Math.round(agg.population * 100) / 100, baseResourceIndex: Math.round(agg.baseResourceIndex * 1000) / 1000 };
  }
  return out;
}

// Phase 1: let real migration spread population into background zones —
// same mechanism validateOverworld.ts already exercises.
tick(6000);
const target = biggestTrackedRegion();
const beforeFront = snapshot(target);

// Phase 2: inject a drought front squarely over the target zone (a real
// generated-terrain zone with a real migrated-in aggregate) and run it for
// long enough for MACRO_WEATHER_RESOURCE_DECAY_RATE to visibly bite.
mw.weatherFronts.push({ id: 999, kind: "drought", row: target.row, col: target.col, radius: 6, driftRow: 0, driftCol: 0, ticksRemaining: 2000 });
const emigrationsBeforeWeather = log.events.filter((e) => e.kind === "regionEmigrated" && e.fromRegionId === target.key).length;

tick(1800);
const underFront = activeMacroWeatherAt(mw, target.row, target.col) !== undefined;
const duringFront = snapshot(target);
const emigrationsDuringWeather = log.events.filter((e) => e.kind === "regionEmigrated" && e.fromRegionId === target.key).length - emigrationsBeforeWeather;

// Phase 3: let the front dissipate (force it, rather than waiting out its
// remaining lifespan) and confirm the zone starts recovering.
for (const front of mw.weatherFronts) front.ticksRemaining = 1;
tick(1);
const stillActive = mw.weatherFronts.length;
tick(3000);
const afterFront = snapshot(target);

console.log(
  JSON.stringify(
    {
      targetRegion: target.key,
      wasUnderFrontDuringPhase2: underFront,
      emigrationsFromTargetBeforeWeather: emigrationsBeforeWeather,
      emigrationsFromTargetDuringWeather: emigrationsDuringWeather,
      frontsStillActiveRightAfterForcedDissipation: stillActive,
      beforeFront,
      duringFront,
      afterFrontRecovery: afterFront,
      macroWeatherEvents: log.events.filter((e) => e.kind === "macroWeatherChanged"),
    },
    null,
    2
  )
);
