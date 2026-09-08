/**
 * Predator/prey dynamics over time — the shape, not the endpoint.
 *
 * An endpoint reading cannot tell a healthy oscillation from a collapse.
 * This samples both populations plus the food supply across a run so the
 * failure mode is visible: are predators crashing to zero, overshooting and
 * eating out their prey, or genuinely cycling?
 *
 * Run: `npx tsx packages/runner/src/validateEcology.ts [ticks] [seeds]`
 */
import { EventLog, tickWorld, tileAt } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 12000);
const nSeeds = Number(process.argv[3] ?? 4);
const SAMPLE = Math.max(1, Math.floor(ticks / 24));

interface Row { pred: number; prey: number; food: number }

let zeroPredTicks = 0, totalSamples = 0;
const allCv: number[] = [];
const allMeanPop: number[] = [];
const predShares: number[] = [];

for (let i = 0; i < nSeeds; i++) {
  const seed = 1000 + i * 7919;
  const world: any = createDemoWorld(seed);
  const log = new EventLog();
  const rows: Row[] = [];
  for (let t = 0; t < ticks; t++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    if (t % SAMPLE === 0) {
      const alive = world.agents.filter((a: any) => a.alive !== false);
      const pred = alive.filter((a: any) => HUNT_RULES[a.species]).length;
      let food = 0;
      for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
        const tile = tileAt(world, "surface", x, y);
        if (tile?.terrain === "food") food++;
      }
      rows.push({ pred, prey: alive.length - pred, food });
      totalSamples++;
      if (pred === 0) zeroPredTicks++;
      if (alive.length > 0) predShares.push(pred / alive.length);
    }
  }
  const spark = (vals: number[]) => {
    const max = Math.max(1, ...vals);
    return vals.map((v) => " ▁▂▃▄▅▆▇█"[Math.min(8, Math.round(8 * v / max))]).join("");
  };
  const ev = (k: string) => log.events.filter((e: any) => e.kind === k).length;
  console.log(`\n--- seed ${seed} ---`);
  console.log(`  predators ${spark(rows.map(r => r.pred))}  max ${Math.max(...rows.map(r => r.pred))}`);
  console.log(`  prey      ${spark(rows.map(r => r.prey))}  max ${Math.max(...rows.map(r => r.prey))}`);
  console.log(`  food      ${spark(rows.map(r => r.food))}  max ${Math.max(...rows.map(r => r.food))}`);
  const pops = rows.map((r) => r.pred + r.prey);
  const meanPop = pops.reduce((a, b) => a + b, 0) / pops.length;
  const cv = Math.sqrt(pops.reduce((s, v) => s + (v - meanPop) ** 2, 0) / pops.length) / Math.max(1, meanPop);
  console.log(`  pop mean ${meanPop.toFixed(0)} (cv ${cv.toFixed(2)})  eggLaid ${ev("eggLaid")} hatched ${ev("eggHatched")}  killed ${ev("killed")} starved ${ev("starved")}  immigrated ${ev("immigrated")}`);
  allCv.push(cv);
  allMeanPop.push(meanPop);
}

// Equilibrium summary: a stable world is one where BOTH populations persist
// at a moderate share, rather than one crashing or one taking over.
predShares.sort((a, b) => a - b);
const q = (p: number) => predShares[Math.min(predShares.length - 1, Math.floor(p * predShares.length))] ?? 0;
console.log(`\npredator share across all samples: p10 ${(100*q(0.1)).toFixed(0)}%  median ${(100*q(0.5)).toFixed(0)}%  p90 ${(100*q(0.9)).toFixed(0)}%`);
console.log(`samples with ZERO predators: ${zeroPredTicks}/${totalSamples} (${(100*zeroPredTicks/Math.max(1,totalSamples)).toFixed(0)}%)`);
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
console.log(`population: mean ${mean(allMeanPop).toFixed(0)}, spread across seeds ${Math.min(...allMeanPop).toFixed(0)}-${Math.max(...allMeanPop).toFixed(0)}`);
console.log(`population volatility (cv, lower is steadier): mean ${mean(allCv).toFixed(2)}, worst ${Math.max(...allCv).toFixed(2)}`);
