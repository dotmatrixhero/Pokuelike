/**
 * Real-run validation for cross-zone herd tracking (TODO.md's "keep track
 * of herd through zones" direct ask) — proves a herd's identity actually
 * survives demotion, emigration, and re-promotion on a real
 * `createDemoMacroWorld` run, rather than getting re-invented at every zone
 * transition the way it used to. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateHerdMigration.ts <ticks>`
 */
import { EventLog, tickMacroWorld, type MacroWorld } from "@pokuelike/engine";
import { createDemoMacroWorld, HUNT_RULES, IMMIGRATION_CONTEXT, LEVELING_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 6000);

const mw: MacroWorld = createDemoMacroWorld();
const log = new EventLog();

for (let i = 0; i < ticks; i++) {
  tickMacroWorld(mw, log, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT);
}

const emigrated = log.events.filter((e) => e.kind === "regionEmigrated");
const crossed = log.events.filter((e) => e.kind === "regionCrossed");

const herdJourneys = new Map<string, { species: string; regions: string[] }>();
for (const e of [...emigrated, ...crossed]) {
  if (e.kind !== "regionEmigrated" && e.kind !== "regionCrossed") continue;
  const journey = herdJourneys.get(e.herdId) ?? { species: e.species, regions: [e.fromRegionId] };
  journey.regions.push(e.toRegionId);
  herdJourneys.set(e.herdId, journey);
}

// A herd that shows up under the SAME id at more than 2 regions in its
// journey is the direct proof this was asking for: not just "moved once"
// but a real, continuous, trackable migration pattern across the grid.
const multiHopHerds = [...herdJourneys.entries()]
  .filter(([, j]) => new Set(j.regions).size > 2)
  .map(([herdId, j]) => ({ herdId, species: j.species, regionPath: j.regions }));

console.log(
  JSON.stringify(
    {
      ticks,
      regionEmigratedCount: emigrated.length,
      regionCrossedCount: crossed.length,
      distinctHerdsThatMoved: herdJourneys.size,
      multiHopHerdCount: multiHopHerds.length,
      exampleMultiHopHerds: multiHopHerds.slice(0, 5),
    },
    null,
    2
  )
);
