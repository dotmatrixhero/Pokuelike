/**
 * Is the world destroying itself faster than it grows back?
 *
 * The concern, in plain terms: moves already change terrain — fire moves
 * call `igniteNear` on the live hit path, and fire spreads. If we widen the
 * move roster so more moves fell trees, clear brush and start fires, then
 * thousands of agents are doing that constantly, forever. If destruction
 * outpaces regrowth, the world ends up bare.
 *
 * That's answerable rather than arguable. This measures two things over a
 * real run:
 *
 * 1. **Flow** — how many tiles change, and what caused each change
 *    (`terrainChanged` carries a `cause`).
 * 2. **Stock** — the standing count of each terrain kind at the start
 *    versus the end. This is the one that actually matters: flow can be
 *    high and harmless if regrowth keeps pace. A falling stock is the
 *    failure.
 *
 * Note: `terrainBurn` (a hit stripping a bush to floor) and `terrainFill`
 * do NOT log `terrainChanged` today, so they are invisible to the flow
 * numbers and only show up in the stock comparison. Worth fixing if this
 * measurement is ever used to tune.
 *
 * Run: `npx tsx packages/runner/src/validateTerrainChurn.ts [ticks] [seeds]`
 */
import { EventLog, tickWorld, tileAt } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 6000);
const SEEDS = (process.argv[3] ?? "1000,8919,16838,24757").split(",").map(Number);

const VEGETATION = new Set(["tree", "bush", "flora", "food", "seedling"]);

function census(world: any): Map<string, number> {
  const counts = new Map<string, number>();
  for (const layer of ["surface", "underground", "canopy"] as const) {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const t = tileAt(world, layer, x, y);
        if (!t) continue;
        counts.set(t.terrain, (counts.get(t.terrain) ?? 0) + 1);
      }
    }
  }
  return counts;
}

const causeTotals = new Map<string, number>();
const stockDelta = new Map<string, number>();
let vegBefore = 0;
let vegAfter = 0;

for (const seed of SEEDS) {
  const world: any = createDemoWorld(seed);
  const before = census(world);
  const log = new EventLog();

  for (let t = 0; t < ticks; t++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  }

  const after = census(world);
  for (const e of log.events as any[]) {
    if (e.kind !== "terrainChanged") continue;
    const key = `${e.cause}: ${e.from} -> ${e.to}`;
    causeTotals.set(key, (causeTotals.get(key) ?? 0) + 1);
  }
  for (const kind of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(kind) ?? 0) - (before.get(kind) ?? 0);
    stockDelta.set(kind, (stockDelta.get(kind) ?? 0) + delta);
    if (VEGETATION.has(kind)) {
      vegBefore += before.get(kind) ?? 0;
      vegAfter += after.get(kind) ?? 0;
    }
  }
}

const perK = (n: number) => ((1000 * n) / (ticks * SEEDS.length)).toFixed(1);

console.log(`\n=== terrain churn — ${SEEDS.length} seeds x ${ticks} ticks ===\n`);

console.log("--- FLOW: logged terrain changes (per 1000 ticks, averaged) ---");
if (causeTotals.size === 0) {
  console.log("  (none logged)");
} else {
  for (const [key, n] of [...causeTotals.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(34)} ${String(n).padStart(6)} total   ${perK(n).padStart(7)} /1k ticks`);
  }
}

console.log("\n--- STOCK: standing tile counts, end minus start (summed over seeds) ---");
console.log("    (this is the one that matters — negative means it is not growing back)");
for (const [kind, delta] of [...stockDelta.entries()].sort((a, b) => a[1] - b[1])) {
  if (delta === 0) continue;
  const arrow = delta < 0 ? "DOWN" : "up  ";
  console.log(`  ${kind.padEnd(12)} ${arrow} ${String(delta).padStart(7)}`);
}

console.log("\n--- the headline ---");
const vegPct = vegBefore === 0 ? 0 : (100 * (vegAfter - vegBefore)) / vegBefore;
console.log(`  vegetation tiles (tree/bush/flora/food/seedling)`);
console.log(`    start ${vegBefore}   end ${vegAfter}   change ${vegPct >= 0 ? "+" : ""}${vegPct.toFixed(1)}%`);
console.log(
  vegPct < -10
    ? "  => STRIPPING. Destruction is outpacing regrowth."
    : vegPct > 10
      ? "  => Overgrowing. Regrowth outpaces everything consuming it."
      : "  => Roughly in equilibrium."
);
console.log();
