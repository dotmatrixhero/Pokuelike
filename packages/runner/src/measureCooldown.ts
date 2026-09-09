/**
 * Is a move's cooldown even a real constraint? Measures how often agents
 * actually ACT, so cooldown values can be judged against the action economy
 * rather than against nothing. A cooldown shorter than the gap between an
 * agent's actions is inert.
 */
import { EventLog, tickWorld, randomSeed, actionSpeedOf, ACTION_THRESHOLD } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
const TICKS = Number(process.argv[2] ?? 3000);
const gaps: number[] = [];
for (const seed of [11, 22, 33]) {
  const world = createDemoWorld(seed);
  const log = new EventLog();
  for (let i = 0; i < TICKS; i++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  for (const a of world.agents as any[]) {
    if (a.alive === false) continue;
    const speed = actionSpeedOf(world, a, world.tick);
    if (speed > 0) gaps.push(ACTION_THRESHOLD / speed);
  }
}
gaps.sort((a, b) => a - b);
const q = (p: number) => gaps[Math.floor(gaps.length * p)];
console.log(`ACTION_THRESHOLD ${ACTION_THRESHOLD}; ${gaps.length} living agents`);
console.log(`ticks between actions:  p10 ${q(0.1).toFixed(1)}  p50 ${q(0.5).toFixed(1)}  p90 ${q(0.9).toFixed(1)}  max ${gaps[gaps.length - 1].toFixed(1)}`);
for (const cd of [1, 2, 3, 4, 15, 30, 40, 50]) {
  const inert = gaps.filter((g) => g >= cd).length;
  console.log(`  a ${String(cd).padStart(2)}-tick cooldown is INERT for ${inert}/${gaps.length} agents (${(inert / gaps.length * 100).toFixed(0)}%) — they act slower than that anyway`);
}
