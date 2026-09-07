/**
 * Real-run validation for proactive territorial guarding (herdConflict.ts's
 * `applyTerritorialGuard`) — confirms a live `tickWorld` run actually
 * produces herd-rivalry fights that fire WITHOUT the resource-contention
 * trigger's own `HERD_CONFLICT_MIN_BLOCKED_TICKS` (8) prerequisite ever
 * being met — the real, distinguishing signature of the new proactive path
 * vs. the pre-existing reactive one (`applyHerdRivalryConflict`), since both
 * ultimately produce the same `herdClash` event shape. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateTerritorialGuard.ts <ticks>`
 */
import { tickWorld, EventLog, HERD_CONFLICT_MIN_BLOCKED_TICKS } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);

const world = createDemoWorld();
const log = new EventLog();

let herdClashCount = 0;
let proactiveGuardTicks = 0;

for (let i = 0; i < ticks; i++) {
  for (const agent of world.agents) {
    if (agent.alive === false || agent.isEgg) continue;
    if (
      agent.behavior === "fight" &&
      agent.fightTarget &&
      agent.herdId &&
      !HUNT_RULES[agent.species] &&
      (agent.ticksBlockedFromResource ?? 0) < HERD_CONFLICT_MIN_BLOCKED_TICKS
    ) {
      const target = world.agents.find((a) => a.id === agent.fightTarget);
      if (target && target.herdId && target.herdId !== agent.herdId && !HUNT_RULES[target.species]) {
        proactiveGuardTicks++;
      }
    }
  }
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}

for (const event of log.events) if (event.kind === "herdClash") herdClashCount++;

console.log(
  JSON.stringify(
    {
      ticks,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      herdClashEventCount: herdClashCount,
      proactiveGuardTicks,
    },
    null,
    2
  )
);
