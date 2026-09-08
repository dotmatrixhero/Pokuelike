/**
 * Combat and predator-population health across seeds.
 *
 * Written to answer "why is there so little combat", and the answer was not
 * what it looked like: fights ran 15-28 per 1000 ticks all along. The real
 * problem was that predators did not PERSIST — two of four seeds ended with
 * literally zero living predators and a third with 77% (having eaten out
 * its own prey), so predation stopped being a source of conflict even
 * though herd clashes continued.
 *
 * Run: `npx tsx packages/runner/src/validateCombat.ts [ticks] [seed,seed,...]`
 */
import { EventLog, tickWorld, isPreyOf } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
const ticks = Number(process.argv[2] ?? 8000);
const SEEDS = (process.argv[3] ?? "1000,8919,16838,24757").split(",").map(Number);
for (const seed of SEEDS) {
const world: any = createDemoWorld(seed);
const log = new EventLog();
for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
console.log(`\n--- seed ${seed} ---`);
const alive = world.agents.filter((a: any) => a.alive !== false);
const preds = alive.filter((a: any) => HUNT_RULES[a.species]);
console.log(`alive ${alive.length}  predators ${preds.length} (${(100*preds.length/Math.max(1,alive.length)).toFixed(0)}%)`);
const bySpecies: Record<string, number> = {};
for (const a of alive) bySpecies[a.species] = (bySpecies[a.species] ?? 0) + 1;
console.log('species:', Object.entries(bySpecies).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' '));
// how many living agents are valid prey for at least one living predator?
let huntable = 0, pairs = 0;
for (const a of alive) {
  let any = false;
  for (const p of preds) if (p.id !== a.id && isPreyOf(HUNT_RULES, p, a)) { any = true; pairs++; }
  if (any) huntable++;
}
console.log(`agents that are valid prey for SOME living predator: ${huntable}/${alive.length}; total predator-prey pairs ${pairs}`);
// distance: are predators near anything they can eat?
let nearPrey = 0;
for (const p of preds) {
  const near = alive.some((a: any) => a.id !== p.id && a.layer === p.layer
    && Math.abs(a.pos.x-p.pos.x)+Math.abs(a.pos.y-p.pos.y) <= 10 && isPreyOf(HUNT_RULES, p, a));
  if (near) nearPrey++;
}
console.log(`predators with valid prey within 10 tiles: ${nearPrey}/${preds.length}`);
const ev = (k: string) => log.events.filter((e: any) => e.kind === k).length;
console.log(`events: fought ${ev("fought")} missed ${ev("missed")} killed ${ev("killed")} defeated ${ev("defeated")} starved ${ev("starved")} herdClash ${ev("herdClash")} packHunt ${ev("packHunt")}`);
console.log(`fights per 1000 ticks: ${(1000*ev("fought")/ticks).toFixed(1)}`);
const behav: Record<string, number> = {};
for (const a of alive) behav[a.behavior] = (behav[a.behavior] ?? 0) + 1;
console.log('current behaviors:', Object.entries(behav).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' '));
}
