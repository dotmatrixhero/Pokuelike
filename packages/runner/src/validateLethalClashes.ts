/**
 * Real-run validation for the two herd-conflict direct asks: "i do want
 * them to escalate to death sometimes" (herdConflict.ts's new lethal
 * knockout path) and "multi-way 6 unit free for alls that get really
 * confusing" (the local-fight cap). Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateLethalClashes.ts <ticks>`
 */
import { tickWorld, EventLog, MAX_LOCAL_FIGHT_PARTICIPANTS } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);

const world = createDemoWorld();
const log = new EventLog();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}

const herdClashHits = log.events.filter((e) => e.kind === "herdClash" && (e.outcome === "hit" || e.outcome === "retreated"));
const fainted = log.events.filter((e) => e.kind === "fainted");
const defeated = log.events.filter((e) => e.kind === "defeated");

// A herdClash-caused faint/defeat is one whose agentId/loserId also appears
// as a herdClash defenderId at roughly the same tick — approximate but good
// enough for a real-run sanity check (predation's own faint/defeat events
// share the same event kinds).
const clashDefenderTicks = new Set(herdClashHits.map((e) => (e.kind === "herdClash" ? `${e.defenderId}@${e.tick}` : "")));
const clashFaints = fainted.filter((e) => e.kind === "fainted" && clashDefenderTicks.has(`${e.agentId}@${e.tick}`));
const clashDeaths = defeated.filter((e) => e.kind === "defeated" && clashDefenderTicks.has(`${e.loserId}@${e.tick}`));

// Local-fight-cap sanity: for every herdClash hit, count how many OTHER
// distinct agents had a herdClash hit within MAX_LOCAL_FIGHT_PARTICIPANTS-
// worth of ticks beforehand at roughly the same position — a crude proxy,
// just to confirm we never see an obviously huge pile-up.
const positionsByTick = new Map<number, { x: number; y: number }[]>();
for (const e of herdClashHits) {
  if (e.kind !== "herdClash") continue;
  const arr = positionsByTick.get(e.tick) ?? [];
  arr.push(e.pos);
  positionsByTick.set(e.tick, arr);
}
let maxSameTickSamePos = 0;
for (const arr of positionsByTick.values()) {
  const counts = new Map<string, number>();
  for (const p of arr) {
    const key = `${p.x},${p.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const c of counts.values()) maxSameTickSamePos = Math.max(maxSameTickSamePos, c);
}

console.log(
  JSON.stringify(
    {
      ticks,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      herdClashHitCount: herdClashHits.length,
      herdClashCausedFaints: clashFaints.length,
      herdClashCausedDeaths: clashDeaths.length,
      maxLocalFightParticipantsConfig: MAX_LOCAL_FIGHT_PARTICIPANTS,
      maxObservedSameTickSamePosHits: maxSameTickSamePos,
    },
    null,
    2
  )
);
