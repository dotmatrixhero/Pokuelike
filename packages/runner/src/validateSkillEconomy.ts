/**
 * Multi-seed skill-point economy check: are expensive nodes reachable at all?
 *
 * WHY MULTI-SEED, emphatically: this sim's population is wildly sensitive to
 * the RNG sequence. Merely inserting one extra `rng()` draw per skill-point
 * grant — with its effect disabled — moved a single seed's 20k-tick
 * population from 129 to 3. Any single-seed before/after population
 * comparison is therefore close to meaningless, and several were made (and
 * over-read) before this was noticed. Average across seeds or don't claim it.
 *
 * Run: `npx tsx packages/runner/src/validateSkillEconomy.ts [ticks] [nSeeds]`
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, MOVES } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 10000);
const nSeeds = Number(process.argv[3] ?? 6);

const costOf: Record<string, number> = {};
for (const mv of Object.values(MOVES as any)) for (const n of Object.values((mv as any).tree ?? {})) costOf[(n as any).id] = (n as any).cost;
const totalByCost: Record<number, number> = {};
for (const c of Object.values(costOf)) totalByCost[c] = (totalByCost[c] ?? 0) + 1;

const pops: number[] = [];
const picksByCost: Record<number, number> = {};
const distinctByCost: Record<number, Set<string>> = {};
let ignitions = 0;

for (let i = 0; i < nSeeds; i++) {
  const seed = 1000 + i * 7919;
  const world: any = createDemoWorld(seed);
  const log = new EventLog();
  for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  const alive = world.agents.filter((a: any) => a.alive !== false);
  pops.push(alive.length);
  for (const a of alive) for (const ch of Object.values(a.moveTreeChoices ?? {})) for (const id of ch as string[]) {
    const c = costOf[id];
    if (c === undefined) continue;
    picksByCost[c] = (picksByCost[c] ?? 0) + 1;
    (distinctByCost[c] ??= new Set()).add(id);
  }
  ignitions += log.events.filter((e: any) => e.kind === "terrainChanged" && e.cause === "fire" && e.to === "fire").length;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
pops.sort((a, b) => a - b);
console.log(`${nSeeds} seeds x ${ticks} ticks`);
console.log(`population: mean ${mean(pops).toFixed(1)}  median ${pops[Math.floor(pops.length / 2)]}  range ${pops[0]}-${pops[pops.length - 1]}  (${pops.join(", ")})`);
for (const c of Object.keys(totalByCost).sort())
  console.log(`  cost ${c}: ${(distinctByCost[+c]?.size ?? 0)}/${totalByCost[+c]} distinct nodes reached, ${picksByCost[+c] ?? 0} picks`);
console.log(`fire: ${ignitions} tiles ignited across all seeds`);
