/**
 * Real-run measurement: direct report "I'm seeing like level 50 weedles
 * and bellsprouts and charmander... Maybe you are not re-simulating them
 * being prompted to evolve after the level in which they are initially
 * offered to?" — measures how often a base-form (unevolved) agent is
 * sitting well past its own evolution threshold in a real generated
 * world's initial population + a real tickWorld run.
 *
 * Usage: pnpm --filter @pokuelike/runner exec tsx src/validateEvolutionRate.ts <ticks> <seeds>
 */
import { tickWorld, EventLog } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 5000);
const seedCount = Number(process.argv[3] ?? 8);

// How far past a species' own evolution threshold counts as "should really
// have evolved by now" for this report — 10 levels of slack (well beyond
// what even a genuinely rare decline streak should produce).
const SLACK = 10;

let sampled = 0;
let overdue = 0;
const overdueExamples: string[] = [];

for (let s = 1; s <= seedCount; s++) {
  const world = createDemoWorld(5000 + s);
  const log = new EventLog();
  for (let i = 0; i < ticks; i++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

  for (const agent of world.agents) {
    if (agent.alive === false || agent.isEgg) continue;
    const profile = LEVELING_CONTEXT.getProfile(agent.species);
    if (!profile || profile.evolutions.length === 0) continue; // already a final form, or unknown
    const nextEvo = profile.evolutions[0]!; // base-form profiles here only ever have one entry
    sampled++;
    if ((agent.level ?? 1) >= nextEvo.level + SLACK) {
      overdue++;
      if (overdueExamples.length < 10) overdueExamples.push(`${agent.species} lv${agent.level} (evolves at ${nextEvo.level})`);
    }
  }
}

console.log(
  JSON.stringify(
    { ticks, seedCount, sampledUnevolvedBaseForms: sampled, overdueBy10PlusLevels: overdue, overdueRate: sampled > 0 ? overdue / sampled : 0, overdueExamples },
    null,
    2
  )
);
