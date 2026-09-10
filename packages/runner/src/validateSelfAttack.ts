/**
 * Real-run investigation: direct report (screenshot) of a Weepinbell
 * apparently fighting itself — "Weepinbell vs Weepinbell fighting!",
 * "Weepinbell used Poison Jab! Weepinbell takes 89 damage! Weepinbell
 * fainted!" with only ONE combatant chip visible on the Battle Screen
 * (suggesting attacker and defender are the literal same agent id, not
 * just two different Weepinbells sharing a display name).
 *
 * Usage: pnpm --filter @pokuelike/runner exec tsx src/validateSelfAttack.ts <ticks> <seeds>
 */
import { tickWorld, EventLog } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 10000);
const seedCount = Number(process.argv[3] ?? 8);

let selfFoughtEvents = 0;
let selfRivalryEvents = 0;
const samples: unknown[] = [];

for (let s = 1; s <= seedCount; s++) {
  const world = createDemoWorld(2000 + s);
  const log = new EventLog();

  for (let i = 0; i < ticks; i++) {
    const beforeCount = log.events.length;
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    const newEvents = log.events.slice(beforeCount);
    for (const event of newEvents) {
      if (event.kind === "fought" && event.attackerId === event.defenderId) {
        selfFoughtEvents++;
        if (samples.length < 5) samples.push({ seed: 2000 + s, ...event });
      }
      if (event.kind === "herdClash" && event.attackerId === event.defenderId) {
        selfRivalryEvents++;
        if (samples.length < 5) samples.push({ seed: 2000 + s, ...event });
      }
    }
  }
}

console.log(JSON.stringify({ ticks, seedCount, selfFoughtEvents, selfRivalryEvents, samples }, null, 2));
