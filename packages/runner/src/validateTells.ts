/**
 * ROADMAP.md M4 — the tells, on a real run. Every 100 ticks of the demo
 * world, describe every living agent from the outside and count the
 * sentences. Shows the actual prose (judge it cold) and which behaviours
 * the read ever produces — a tell that never appears in 2000 ticks is
 * unreachable content.
 *
 *   pnpm --filter @pokuelike/runner exec tsx src/validateTells.ts
 */
import { describeBehavior, tickWorld, EventLog } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, SPECIES } from "@pokuelike/data";

const name = (id: string) => SPECIES[id]?.name ?? id;
const counts = new Map<string, number>();
const shapes = new Map<string, number>();
for (const seed of [20260903, 7, 99]) {
  const world = createDemoWorld(seed);
  const log = new EventLog();
  for (let t = 0; t < 2000; t++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    if (t % 100 !== 99) continue;
    for (const a of world.agents) {
      if (a.alive === false || a.isEgg) continue;
      const s = describeBehavior(world, a, { name });
      counts.set(s, (counts.get(s) ?? 0) + 1);
      const shape = s.replace(/^The \S+ /, "").replace(/\b(the|you) [A-Z][a-z]+/g, "X").replace(/ (north|south|east|west)(-(east|west))?/g, " DIR");
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }
  }
}
const total = [...shapes.values()].reduce((a, b) => a + b, 0);
console.log(`--- tell shapes over ${total} reads (3 seeds x 20 samples) ---`);
for (const [s, n] of [...shapes].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${(100 * n / total).toFixed(1).padStart(5)}%  ${s}`);
console.log("--- 25 real sentences, most common first ---");
for (const [s, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(n).padStart(5)}  ${s}`);
