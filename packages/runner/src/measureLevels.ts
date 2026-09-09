/**
 * If a skill point comes per level, a capstone 26 points deep needs a level-27
 * agent to exist. Measures the real level distribution so tree depth is set
 * against observed progression rather than a guess.
 */
import { EventLog, tickWorld, randomSeed } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
const TICKS = Number(process.argv[2] ?? 4000);
const SEEDS = (process.argv[3] ?? "11,22,33").split(",").map(Number);
const levels: number[] = [];
const pts: number[] = [];
let peakEver = 0;
for (const seed of SEEDS) {
  const world = createDemoWorld(seed);
  const log = new EventLog();
  for (let i = 0; i < TICKS; i++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  for (const a of world.agents as any[]) {
    if (a.alive === false) continue;
    const lvl = a.level ?? 1;
    levels.push(lvl);
    peakEver = Math.max(peakEver, lvl);
    const chosen = Object.values(a.moveTreeChoices ?? {}).flat() as string[];
    pts.push(chosen.length);
  }
}
levels.sort((a, b) => a - b);
const q = (p: number) => levels[Math.floor(levels.length * p)] ?? 0;
console.log(`${SEEDS.length} seeds x ${TICKS} ticks, ${levels.length} living agents`);
console.log(`level  min ${levels[0]}  p50 ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${levels[levels.length - 1]}`);
console.log(`nodes chosen per agent: mean ${(pts.reduce((a, b) => a + b, 0) / pts.length).toFixed(1)}, max ${Math.max(...pts)}`);
for (const depth of [8, 12, 16, 21, 26]) {
  const reach = levels.filter((l) => l >= depth).length;
  console.log(`  a ${String(depth).padStart(2)}-point node is reachable by ${reach}/${levels.length} agents (${(reach / levels.length * 100).toFixed(0)}%)`);
}
