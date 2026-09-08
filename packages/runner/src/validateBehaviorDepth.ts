/**
 * Throwaway live-run check for the "shallow behavior" batch: revisit-penalty,
 * herd personal-space repulsion, exploration resource-discovery memory,
 * training/XP fallback, and a sanity check on proactive shelter-building
 * frequency (task #22 — decide whether SHELTER_COMFORT_THRESHOLD needs
 * tuning, rather than guessing).
 *
 * Run: `npx tsx packages/runner/src/validateBehaviorDepth.ts [ticks] [seed]`
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);
const seed = Number(process.argv[3] ?? 777);
const world: any = createDemoWorld(seed);
const log = new EventLog();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}

const alive = world.agents.filter((a: any) => a.alive !== false && !a.isEgg);
const behaviorCounts: Record<string, number> = {};
for (const a of alive) behaviorCounts[a.behavior] = (behaviorCounts[a.behavior] ?? 0) + 1;
console.log("current behavior distribution (live agents):", behaviorCounts);

const withMemory = alive.filter((a: any) => (a.knownResourceTiles?.length ?? 0) > 0);
const memCounts = alive.map((a: any) => a.knownResourceTiles?.length ?? 0).filter((n: number) => n > 0);
console.log(
  `resource-discovery memory: ${withMemory.length}/${alive.length} agents hold ≥1 known tile, ` +
    `avg ${(memCounts.reduce((a: number, b: number) => a + b, 0) / Math.max(1, memCounts.length)).toFixed(1)} tiles, ` +
    `max ${Math.max(0, ...memCounts)}`
);

const withVisit = alive.filter((a: any) => a.lastResourceVisit).length;
console.log(`revisit-penalty tracking: ${withVisit}/${alive.length} agents carry a lastResourceVisit`);

const behaviorChangeCounts: Record<string, number> = {};
for (const e of log.events) if (e.kind === "behaviorChanged") behaviorChangeCounts[(e as any).to] = (behaviorChangeCounts[(e as any).to] ?? 0) + 1;
console.log("all behaviorChanged->X counts over the run:", behaviorChangeCounts);

const trainEvents = behaviorChangeCounts["train"] ?? 0;
console.log(`training fallback: ${trainEvents} behaviorChanged->train events over ${ticks} ticks`);

const shelterTiles = (() => {
  let n = 0;
  for (const layer of ["surface", "underground", "canopy"] as const) {
    for (const t of world.tiles[layer]) if (t.terrain === "shelter") n++;
  }
  return n;
})();
console.log(`shelters built: ${shelterTiles} shelter tiles on the map after ${ticks} ticks`);

const restEvents = log.events.filter((e: any) => e.kind === "behaviorChanged" && e.to === "restAtShelter").length;
console.log(`restAtShelter transitions: ${restEvents}`);

// crude "stuck" check: sample every agent's position at two points 200 ticks apart via re-run isn't
// available post-hoc, so instead report how many living agents currently sit adjacent (<=1) to
// another same-herd agent, as a proxy for whether repulsion is keeping herds from stacking.
function manhattan(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
let adjacentHerdPairs = 0;
const herded = alive.filter((a: any) => a.herdId);
for (let i = 0; i < herded.length; i++) {
  for (let j = i + 1; j < herded.length; j++) {
    if (herded[i].herdId !== herded[j].herdId) continue;
    if (herded[i].layer !== herded[j].layer) continue;
    if (manhattan(herded[i].pos, herded[j].pos) <= 1) adjacentHerdPairs++;
  }
}
console.log(`herd-mate pairs standing adjacent (<=1 tile) at end of run: ${adjacentHerdPairs} (out of ${herded.length} herded agents)`);

console.log(`\nalive ${alive.length} | total events ${log.events.length}`);
