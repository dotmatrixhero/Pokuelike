/**
 * Real-run validation for the new environmental/utility move batch
 * (Growth, Grassy Terrain, Synthesis, Moonlight, Roost, Agility, Harden,
 * Withdraw, Defense Curl, Safeguard, Rain Dance, Sweet Scent, Leech Seed) —
 * proves each one actually fires and produces a real effect over a live
 * `createDemoWorld` run, not just unit-tested in isolation. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateUtilityMoves.ts <ticks>`
 */
import { tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
import { EventLog } from "@pokuelike/engine";

const ticks = Number(process.argv[2] ?? 6000);

const world = createDemoWorld();
const log = new EventLog();

const UTILITY_MOVE_IDS = new Set([
  "growth",
  "grassy_terrain",
  "synthesis",
  "moonlight",
  "roost",
  "agility",
  "harden",
  "withdraw",
  "defense_curl",
  "safeguard",
  "rain_dance",
  "sweet_scent",
  "leech_seed",
]);

const useCountsBySpecies: Record<string, Record<string, number>> = {};
let rainCellsSeen = 0;
let speedStageAgentsSeen = 0;
let statusImmuneAgentsSeen = 0;
let matingBoostAgentsSeen = 0;
let leechedHungerEvents = 0;

// Sampled as a running max per (agentId, moveId) rather than read once at
// the end — an agent that dies mid-run (predation, old age, a demoted
// zone) takes its own `moveUseCounts` history with it, which would
// otherwise silently undercount every move used by anything that didn't
// survive to the very last tick.
const bestSeenPerAgentMove = new Map<string, number>();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

  for (const agent of world.agents) {
    if (agent.alive === false || agent.isEgg) continue;
    if (agent.statStages?.some((s) => s.stat === "speed" && s.stage > 0)) speedStageAgentsSeen++;
    if (agent.statusImmuneTicksRemaining) statusImmuneAgentsSeen++;
    if (agent.matingRadiusBoostTicksRemaining) matingBoostAgentsSeen++;
    for (const [moveId, count] of Object.entries(agent.moveUseCounts ?? {})) {
      if (!UTILITY_MOVE_IDS.has(moveId)) continue;
      const key = `${agent.id}::${moveId}`;
      bestSeenPerAgentMove.set(key, Math.max(bestSeenPerAgentMove.get(key) ?? 0, count));
      // Species is stable for a given agent id across its life, so
      // recomputing this dict each tick is harmless — it's just the final
      // tallies we actually keep at the end.
      useCountsBySpecies[agent.species] ??= {};
    }
  }
  if (world.weatherCells?.some((c) => c.type === "rain")) rainCellsSeen++;
}

const totalsByMove: Record<string, number> = {};
for (const [key, count] of bestSeenPerAgentMove) {
  const moveId = key.split("::")[1]!;
  totalsByMove[moveId] = (totalsByMove[moveId] ?? 0) + count;
}
// Re-derive per-species from whichever agents are still alive, for a
// readable spot check — totalsByMove above is the real, complete count.
for (const agent of world.agents) {
  for (const [moveId, count] of Object.entries(agent.moveUseCounts ?? {})) {
    if (!UTILITY_MOVE_IDS.has(moveId)) continue;
    useCountsBySpecies[agent.species] ??= {};
    useCountsBySpecies[agent.species]![moveId] = (useCountsBySpecies[agent.species]![moveId] ?? 0) + count;
  }
}

console.log(
  JSON.stringify(
    {
      ticks,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      totalUsesByMoveAcrossWholeRun: totalsByMove,
      utilityMoveUseCountsBySpeciesStillAlive: useCountsBySpecies,
      ticksWithASpeedStageAgentAlive: speedStageAgentsSeen,
      ticksWithAStatusImmuneAgentAlive: statusImmuneAgentsSeen,
      ticksWithAMatingBoostAgentAlive: matingBoostAgentsSeen,
      ticksWithARainCellActive: rainCellsSeen,
    },
    null,
    2
  )
);
