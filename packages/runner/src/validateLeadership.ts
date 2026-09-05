/**
 * Real multi-seed validation for Herd Leadership — see DESIGN.md's "Herd
 * Leadership" section. Modeled directly on validateNotables.ts's shape.
 * Usage: `pnpm --filter @pokuelike/runner exec tsx src/validateLeadership.ts <seed> <ticks>`.
 */
import { EventLog, tickWorld, type SimEvent } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const seed = Number(process.argv[2] ?? 42);
const ticks = Number(process.argv[3] ?? 8000);

const world = createDemoWorld(seed);
const log = new EventLog();

// Every distinct herdId that ever existed on a living agent over the whole
// run — the real denominator for "herds that ever had a leader vs never,"
// since herd ids are created/dissolved dynamically (dispersal, immigration)
// and there's no separate world-level registry of "every herd that ever
// existed" to read back from at the end.
const everHerdIds = new Set<string>();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  for (const agent of world.agents) {
    if (agent.alive !== false && !agent.isEgg && agent.herdId) everHerdIds.add(agent.herdId);
  }
}

const claimed = log.events.filter((e): e is Extract<SimEvent, { kind: "leadershipClaimed" }> => e.kind === "leadershipClaimed");
const lost = log.events.filter((e): e is Extract<SimEvent, { kind: "leadershipLost" }> => e.kind === "leadershipLost");

const uniqueLeaders = new Set(claimed.map((e) => e.agentId));
const herdsEverLed = new Set(claimed.map((e) => e.herdId));
const herdsNeverLed = [...everHerdIds].filter((h) => !herdsEverLed.has(h));

const lostByReason: Record<string, number> = {};
for (const e of lost) lostByReason[e.reason] = (lostByReason[e.reason] ?? 0) + 1;

// Churn check: per herd, the tick gaps between consecutive leadershipClaimed
// events. A real red flag is a herd whose leader changes every few ticks —
// report the minimum gap seen anywhere, and how many gaps fall under a
// generously-real "this is too fast to be a real earned transition" bar
// (50 ticks — HERD_CONFLICT_COOLDOWN_TICKS/dispersal-scale order of
// magnitude, well below which nothing in this sim's other social systems
// considers a "settled" state).
const claimsByHerd = new Map<string, number[]>();
for (const e of claimed) {
  const arr = claimsByHerd.get(e.herdId) ?? [];
  arr.push(e.tick);
  claimsByHerd.set(e.herdId, arr);
}
let minGap = Infinity;
let fastGapCount = 0;
const FAST_GAP_THRESHOLD = 50;
for (const gaps of claimsByHerd.values()) {
  for (let i = 1; i < gaps.length; i++) {
    const gap = gaps[i] - gaps[i - 1];
    if (gap < minGap) minGap = gap;
    if (gap < FAST_GAP_THRESHOLD) fastGapCount++;
  }
}

const alive = world.agents.filter((a) => a.alive !== false && !a.isEgg);

console.log(
  JSON.stringify(
    {
      seed,
      ticks,
      finalPopulation: alive.length,
      totalLeadershipTransfers: claimed.length,
      totalLeadershipLossEvents: lost.length,
      lossReasons: lostByReason,
      uniqueAgentsEverLed: uniqueLeaders.size,
      herdsEverExisted: everHerdIds.size,
      herdsEverLed: herdsEverLed.size,
      herdsNeverLed: herdsNeverLed.length,
      churnCheck: {
        minTicksBetweenSuccessiveLeadersInSameHerd: minGap === Infinity ? null : minGap,
        fastTransitionsUnder50Ticks: fastGapCount,
      },
      currentHerdLeaders: world.herdLeaders ?? {},
    },
    null,
    2
  )
);
