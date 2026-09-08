/**
 * Do INDIVIDUAL agents reach expensive nodes?
 *
 * The earlier metric — distinct cost-2 nodes reached across the whole roster
 * — turned out to measure how much agents concentrate on the same branches,
 * not whether investment pays off. What matters for "capstones should be
 * reachable" is per-agent: of the agents that actually invested, how many
 * got a keystone or a capstone.
 *
 * Run: `npx tsx packages/runner/src/validateCapstoneReach.ts [ticks] [seeds]`
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, MOVES } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);
const nSeeds = Number(process.argv[3] ?? 4);

const cost: Record<string, number> = {};
const terminal = new Set<string>();
for (const mv of Object.values(MOVES as any)) {
  const tree = (mv as any).tree; if (!tree) continue;
  const dep = new Set<string>();
  for (const n of Object.values(tree) as any[]) {
    cost[n.id] = n.cost ?? 1;
    for (const p of n.prerequisites ?? []) dep.add(p);
    for (const g of n.prerequisitesAnyOf ?? []) for (const p of g) dep.add(p);
  }
  for (const n of Object.values(tree) as any[]) if (!dep.has(n.id)) terminal.add(n.id);
}

let agents = 0, invested = 0, withKeystone = 0, withCapstone = 0, nodes = 0, banked = 0;
const deepest: number[] = [];
for (let i = 0; i < nSeeds; i++) {
  const world: any = createDemoWorld(1000 + i * 7919);
  const log = new EventLog();
  for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  for (const a of world.agents.filter((x: any) => x.alive !== false)) {
    agents++;
    const chosen = Object.values(a.moveTreeChoices ?? {}).flat() as string[];
    nodes += chosen.length;
    banked += (a.wildcardSkillPoints ?? 0) + Object.values(a.skillPoints ?? {}).reduce((s: number, v: any) => s + v, 0);
    if (chosen.length === 0) continue;
    invested++;
    deepest.push(chosen.length);
    if (chosen.some((id) => (cost[id] ?? 1) >= 2 && !terminal.has(id))) withKeystone++;
    if (chosen.some((id) => terminal.has(id))) withCapstone++;
  }
}
const pct = (n: number, d: number) => `${(100 * n / Math.max(1, d)).toFixed(0)}%`;
deepest.sort((a, b) => a - b);
console.log(`${nSeeds} seeds x ${ticks} ticks — ${agents} living agents, ${invested} of them invested at all`);
console.log(`  nodes chosen per investing agent: median ${deepest[Math.floor(deepest.length/2)] ?? 0}, max ${deepest[deepest.length-1] ?? 0}`);
console.log(`  reached a cost-2+ KEYSTONE:  ${withKeystone}/${invested} (${pct(withKeystone, invested)})`);
console.log(`  reached a terminal CAPSTONE: ${withCapstone}/${invested} (${pct(withCapstone, invested)})`);
console.log(`  unspent points still banked, per agent: ${(banked / Math.max(1, agents)).toFixed(2)}`);
