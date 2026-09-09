/**
 * Before/after check for the cooldown rebalance: does widening base cooldowns
 * actually change how much combat happens, and what kills things? Balance
 * numbers moved across 21 moves, so this needs a real run, not a typecheck.
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
const TICKS = Number(process.argv[2] ?? 4000);
const SEEDS = (process.argv[3] ?? "11,22,33,44").split(",").map(Number);
let fought = 0, killed = 0, alive = 0, starved = 0, deaths = 0;
const causes = new Map<string, number>();
for (const seed of SEEDS) {
  const world = createDemoWorld(seed);
  const log = new EventLog();
  for (let i = 0; i < TICKS; i++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  for (const e of (log as any).events ?? []) {
    if (e.kind === "fought") fought++;
    if (e.kind === "died" || e.kind === "killed") {
      deaths++;
      const c = e.cause ?? e.kind;
      causes.set(c, (causes.get(c) ?? 0) + 1);
      if (String(c).includes("starv")) starved++;
      if (String(c).includes("kill") || e.kind === "killed") killed++;
    }
  }
  alive += (world.agents as any[]).filter((a) => a.alive !== false).length;
}
console.log(`${SEEDS.length} seeds x ${TICKS} ticks`);
console.log(`  fought events: ${fought}   deaths: ${deaths}   living at end: ${alive}`);
console.log(`  causes: ${[...causes].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ") || "(none)"}`);
