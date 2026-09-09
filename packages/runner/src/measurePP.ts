/**
 * How hard would a PP budget actually bite? Measures real per-agent move
 * usage rates across several seeds, so the PP design is tuned against
 * observed behaviour rather than an invented number. Read-only: adds no
 * mechanic, just counts what `useMove` already records in
 * `Agent.moveUseCounts`.
 */
import { EventLog, tickWorld, randomSeed } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, LEVELING_CONTEXT as CTX } from "@pokuelike/data";

const TICKS = Number(process.argv[2] ?? 4000);
const SEEDS = (process.argv[3] ?? "11,22,33").split(",").map(Number);
// MoveSpec.pp is now sourced from the dex by moveCanon/statusMoveCanon.
const ppOf = (id: string) => (CTX as any).resolveMove(id.toUpperCase())?.pp ?? null;

const perMove = new Map<string, { uses: number; agents: number; maxOnOne: number }>();
let totalAgents = 0, agentsThatUsedAnything = 0, sleepers = 0;

for (const seed of SEEDS) {
  const world = createDemoWorld(seed);
  const log = new EventLog();
  for (let i = 0; i < TICKS; i++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  for (const a of world.agents as any[]) {
    if (a.alive === false) continue;
    totalAgents++;
    if (a.asleep) sleepers++;
    const counts = a.moveUseCounts ?? {};
    if (Object.keys(counts).length) agentsThatUsedAnything++;
    for (const [id, n] of Object.entries(counts) as [string, number][]) {
      const e = perMove.get(id) ?? { uses: 0, agents: 0, maxOnOne: 0 };
      e.uses += n; e.agents++; e.maxOnOne = Math.max(e.maxOnOne, n);
      perMove.set(id, e);
    }
  }
}

console.log(`${SEEDS.length} seeds x ${TICKS} ticks. ${totalAgents} living agents, ${agentsThatUsedAnything} used a move at all, ${sleepers} asleep at end.\n`);
console.log("move            canonPP  totalUses  agents  mean/agent  MAX on one agent  ppBudgetsBurned");
const rows = [...perMove].map(([id, e]) => ({ id, pp: ppOf(id), ...e, mean: e.uses / e.agents }))
  .sort((a, b) => b.maxOnOne - a.maxOnOne);
for (const r of rows) {
  const burned = r.pp ? (r.maxOnOne / r.pp).toFixed(1) : "-";
  console.log(`${r.id.padEnd(16)} ${String(r.pp ?? "-").padStart(4)} ${String(r.uses).padStart(10)} ${String(r.agents).padStart(7)} ${r.mean.toFixed(1).padStart(11)} ${String(r.maxOnOne).padStart(17)} ${burned.padStart(16)}x`);
}
const withPP = rows.filter((r) => r.pp);
console.log(`\nWorst case: one agent burned ${Math.max(...withPP.map((r) => r.maxOnOne / r.pp!)).toFixed(1)}x a full PP pool in ${TICKS} ticks.`);
console.log(`Median agent's heaviest move: ${(withPP.reduce((s, r) => s + r.mean / r.pp!, 0) / withPP.length).toFixed(2)}x its pool.`);
