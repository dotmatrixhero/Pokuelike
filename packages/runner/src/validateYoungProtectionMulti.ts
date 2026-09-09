/**
 * Multi-seed wrapper around validateYoungProtection's own measurement logic
 * — a single demo-world run only ever produced 0-1 juvenile deaths in
 * 10,000 ticks (too few to compare before/after against), so this runs
 * several independently-seeded worlds and aggregates. Usage:
 * pnpm --filter @pokuelike/runner exec tsx src/validateYoungProtectionMulti.ts <ticksPerSeed> <seedCount>
 */
import { tickWorld, EventLog, JUVENILE_AGE_THRESHOLD } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticksPerSeed = Number(process.argv[2] ?? 10000);
const seedCount = Number(process.argv[3] ?? 8);

let totalJuvenileFlees = 0;
let totalJuvenileDeaths = 0;
let totalGuardianInterventions = 0;
let totalDeaths = 0;
const perSeedResults: Array<{ seed: number; juvenileFlees: number; juvenileDeaths: number; guardianInterventions: number }> = [];

for (let s = 1; s <= seedCount; s++) {
  const world = createDemoWorld(1000 + s);
  const log = new EventLog();

  let prevSnapshot = new Map<string, { age?: number; herdId?: string }>();
  function snapshot(): Map<string, { age?: number; herdId?: string }> {
    const m = new Map<string, { age?: number; herdId?: string }>();
    for (const a of world.agents) {
      if (a.alive === false || a.isEgg) continue;
      m.set(a.id, { age: a.age, herdId: a.herdId });
    }
    return m;
  }
  prevSnapshot = snapshot();

  const herdmateFightEvents: { tick: number; herdId: string; fighterId: string; targetId: string | undefined }[] = [];
  let juvenileFlees = 0;
  let juvenileDeaths = 0;
  let guardianInterventions = 0;
  let seedTotalDeaths = 0;

  for (let i = 0; i < ticksPerSeed; i++) {
    const beforeCount = log.events.length;
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    const newEvents = log.events.slice(beforeCount);

    for (const event of newEvents) {
      if (event.kind === "behaviorChanged" && event.to === "flee") {
        const info = prevSnapshot.get(event.agentId);
        if (info?.age !== undefined && info.age < JUVENILE_AGE_THRESHOLD) juvenileFlees++;
      }
      if (event.kind === "behaviorChanged" && event.to === "fight") {
        const agent = world.agents.find((a) => a.id === event.agentId);
        if (agent?.herdId) herdmateFightEvents.push({ tick: event.tick, herdId: agent.herdId, fighterId: agent.id, targetId: agent.fightTarget });
      }
      if (event.kind === "killed") {
        seedTotalDeaths++;
        const victimInfo = prevSnapshot.get(event.preyId);
        const wasJuvenile = victimInfo?.age !== undefined && victimInfo.age < JUVENILE_AGE_THRESHOLD;
        if (wasJuvenile) {
          juvenileDeaths++;
          if (victimInfo?.herdId) {
            const intervened = herdmateFightEvents.some(
              (rec) => rec.herdId === victimInfo.herdId && rec.fighterId !== event.preyId && rec.targetId === event.predatorId && rec.tick <= event.tick
            );
            if (intervened) guardianInterventions++;
          }
        }
      }
    }
    prevSnapshot = snapshot();
  }

  totalJuvenileFlees += juvenileFlees;
  totalJuvenileDeaths += juvenileDeaths;
  totalGuardianInterventions += guardianInterventions;
  totalDeaths += seedTotalDeaths;
  perSeedResults.push({ seed: 1000 + s, juvenileFlees, juvenileDeaths, guardianInterventions });
}

console.log(
  JSON.stringify(
    {
      ticksPerSeed,
      seedCount,
      totalDeaths,
      totalJuvenileFlees,
      totalJuvenileDeaths,
      totalGuardianInterventions,
      perSeedResults,
    },
    null,
    2
  )
);
