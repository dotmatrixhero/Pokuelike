/**
 * Population over time, sampled every 2000 ticks — the blunt instrument for
 * "did that balance change quietly break the ecosystem?"
 *
 * Worth knowing before reading the output: population here is genuinely
 * volatile run to run (booms and crashes are the system working, not a
 * bug), so compare bands and extinction risk across several seeds rather
 * than reading a single endpoint as a verdict.
 *
 * Run: `npx tsx packages/runner/src/validatePopulationCurve.ts [ticks] [seed]`
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
const ticks = Number(process.argv[2] ?? 20000);
const seed = Number(process.argv[3] ?? 12345);
const world: any = createDemoWorld(seed);
const log = new EventLog();
const pts: string[] = [];
for (let i = 0; i <= ticks; i++) {
  if (i % 2000 === 0) pts.push(`${i}:${world.agents.filter((a:any)=>a.alive!==false).length}`);
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}
console.log(`${process.env.LABEL ?? ""} ${pts.join("  ")}`);
