/**
 * How many moves do agents actually END UP knowing, and how deep are their
 * trees? Baseline for the 4-move cap + forgetting design.
 *
 * Control: the same run reports level distribution alongside, because
 * knownMoves only grows on level-up — a movepool of 3 in a population that
 * never passes level 12 says nothing about whether a cap would ever bind.
 *
 * Run: `npx tsx packages/runner/src/measureMovepool.ts [ticks] [nSeeds]`
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, MOVES } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 10000);
const nSeeds = Number(process.argv[3] ?? 4);

const leaningOf: Record<string, string> = {};
for (const mv of Object.values(MOVES as any))
  for (const n of Object.values((mv as any).tree ?? {})) leaningOf[(n as any).id] = (n as any).leaning ?? "";

const known: number[] = [];
const combat: number[] = [];
const levels: number[] = [];
const invested: number[] = [];
let savantAgents = 0;
let agents = 0;
const branchMax: number[] = [];

for (let i = 0; i < nSeeds; i++) {
  const world: any = createDemoWorld(1000 + i * 7919);
  const log = new EventLog();
  for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  for (const a of world.agents.filter((x: any) => x.alive !== false)) {
    agents++;
    known.push((a.knownMoves ?? []).length);
    combat.push((a.moves ?? []).length);
    levels.push(a.level ?? 1);
    let inv = 0;
    let best = 0;
    for (const ch of Object.values(a.moveTreeChoices ?? {}) as string[][]) {
      inv += ch.length;
      const byLean: Record<string, number> = {};
      for (const id of ch) { const l = leaningOf[id]; if (l) byLean[l] = (byLean[l] ?? 0) + 1; }
      for (const c of Object.values(byLean)) best = Math.max(best, c);
    }
    invested.push(inv);
    branchMax.push(best);
    if (best >= 6) savantAgents++;
  }
}

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const hist = (a: number[]) => { const m: Record<number, number> = {}; for (const v of a) m[v] = (m[v] ?? 0) + 1; return Object.keys(m).map(Number).sort((x, y) => x - y).map((k) => `${k}:${m[k]}`).join("  "); };

console.log(`${nSeeds} seeds x ${ticks} ticks, ${agents} living agents\n`);
console.log(`knownMoves    mean ${mean(known).toFixed(2)}  p50 ${pct(known, 0.5)}  p90 ${pct(known, 0.9)}  max ${Math.max(...known)}`);
console.log(`  histogram   ${hist(known)}`);
console.log(`  >4 moves    ${known.filter((n) => n > 4).length} agents (${((100 * known.filter((n) => n > 4).length) / agents).toFixed(1)}%)`);
console.log(`combat moves  mean ${mean(combat).toFixed(2)}  p90 ${pct(combat, 0.9)}  max ${Math.max(...combat)}`);
console.log(`level         mean ${mean(levels).toFixed(1)}  p50 ${pct(levels, 0.5)}  p90 ${pct(levels, 0.9)}  max ${Math.max(...levels)}   <-- control: caps only bind if levels are reached`);
console.log(`nodes chosen  mean ${mean(invested).toFixed(1)}  p90 ${pct(invested, 0.9)}  max ${Math.max(...invested)}`);
console.log(`deepest single branch  mean ${mean(branchMax).toFixed(1)}  p90 ${pct(branchMax, 0.9)}  max ${Math.max(...branchMax)}`);
console.log(`  savant at >=6 (today)  ${savantAgents} agents (${((100 * savantAgents) / agents).toFixed(1)}%)`);
for (const bar of [8, 10, 11, 12, 13, 14, 15]) {
  const n = branchMax.filter((b) => b >= bar).length;
  console.log(`  savant at >=${bar}          ${n} agents (${((100 * n) / agents).toFixed(1)}%)`);
}
