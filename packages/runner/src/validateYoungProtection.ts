/**
 * Real-run investigation (not a permanent regression check): does a herd
 * ever actually protect a juvenile member while it's alive, or avenge one
 * after it dies? Direct report: "do herds protect their young at all? I
 * don't seem to see it. Maybe the young die in one shot so quickly."
 *
 * Usage: pnpm --filter @pokuelike/runner exec tsx src/validateYoungProtection.ts <ticks>
 */
import { tickWorld, EventLog, JUVENILE_AGE_THRESHOLD } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);

const world = createDemoWorld();
const log = new EventLog();

// Snapshot of every living agent's age/level/herdId/species/behavior right
// before each tick, so when a "killed" event fires we can look up what the
// victim actually was at the moment it died (a fainted/killed agent's own
// fields can still change or the entry can get pruned soon after).
let prevSnapshot = new Map<string, { age?: number; level?: number; herdId?: string; species: string }>();
function snapshot(): Map<string, { age?: number; level?: number; herdId?: string; species: string }> {
  const m = new Map<string, { age?: number; level?: number; herdId?: string; species: string }>();
  for (const a of world.agents) {
    if (a.alive === false || a.isEgg) continue;
    m.set(a.id, { age: a.age, level: a.level, herdId: a.herdId, species: a.species });
  }
  return m;
}
prevSnapshot = snapshot();

interface JuvenileDeathRecord {
  tick: number;
  preyId: string;
  preySpecies: string;
  age: number | undefined;
  level: number | undefined;
  herdId: string | undefined;
  predatorId: string;
  predatorSpecies: string;
  guardianEverFought: boolean; // did ANY herdmate transition to "fight" targeting the killer, any time before this death
  guardianFightTick: number | undefined;
  ticksFromDetectToDeath: number | undefined; // ticks between the killer first entering "fight" against this victim and the victim's death
}

// Track, per (killerId, victimId) pair, the tick the killer first started fighting this specific victim — our best proxy for "when did the threat become real."
const fightStartTick = new Map<string, number>();
// Track, per herdId, the tick any member of that herd was last seen in "fight" behavior AND the id of what they were fighting.
const herdmateFightEvents: { tick: number; herdId: string; fighterId: string; targetId: string | undefined }[] = [];

const juvenileDeaths: JuvenileDeathRecord[] = [];
let totalDeaths = 0;
let juvenileDeathCount = 0;
let hatchCount = 0;
let bornCount = 0;
let maxConcurrentJuveniles = 0;
let juvenileFleeEvents = 0;
let juvenileStarvedDeaths = 0;
let juvenileAgeDeaths = 0;
const allKillVictimAges: (number | undefined)[] = [];

for (let i = 0; i < ticks; i++) {
  const beforeCount = log.events.length;
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  const newEvents = log.events.slice(beforeCount);

  for (const event of newEvents) {
    if (event.kind === "behaviorChanged" && event.to === "flee") {
      const info = prevSnapshot.get(event.agentId);
      if (info?.age !== undefined && info.age < JUVENILE_AGE_THRESHOLD) juvenileFleeEvents++;
    }
    if (event.kind === "starved") {
      const info = prevSnapshot.get(event.agentId);
      if (info?.age !== undefined && info.age < JUVENILE_AGE_THRESHOLD) juvenileStarvedDeaths++;
    }
    if (event.kind === "diedOfAge") {
      const info = prevSnapshot.get(event.agentId);
      if (info?.age !== undefined && info.age < JUVENILE_AGE_THRESHOLD) juvenileAgeDeaths++;
    }
    if (event.kind === "behaviorChanged" && event.to === "fight") {
      const agent = world.agents.find((a) => a.id === event.agentId);
      if (agent?.herdId) {
        herdmateFightEvents.push({ tick: event.tick, herdId: agent.herdId, fighterId: agent.id, targetId: agent.fightTarget });
      }
      if (agent?.fightTarget) {
        const key = `${agent.id}->${agent.fightTarget}`;
        if (!fightStartTick.has(key)) fightStartTick.set(key, event.tick);
      }
    }
    if (event.kind === "eggHatched") hatchCount++;
    if (event.kind === "born") bornCount++;
    if (event.kind === "killed") {
      totalDeaths++;
      const victimInfo = prevSnapshot.get(event.preyId);
      allKillVictimAges.push(victimInfo?.age);
      const wasJuvenile = victimInfo?.age !== undefined && victimInfo.age < JUVENILE_AGE_THRESHOLD;
      if (wasJuvenile) {
        juvenileDeathCount++;
        // Did ANY herdmate of the victim ever fight the killer, at or before this tick?
        let guardianEverFought = false;
        let guardianFightTick: number | undefined;
        if (victimInfo?.herdId) {
          for (const rec of herdmateFightEvents) {
            if (rec.herdId === victimInfo.herdId && rec.fighterId !== event.preyId && rec.targetId === event.predatorId && rec.tick <= event.tick) {
              guardianEverFought = true;
              guardianFightTick = rec.tick;
              break;
            }
          }
        }
        const key = `${event.predatorId}->${event.preyId}`;
        const detectTick = fightStartTick.get(key);
        juvenileDeaths.push({
          tick: event.tick,
          preyId: event.preyId,
          preySpecies: event.preySpecies,
          age: victimInfo?.age,
          level: victimInfo?.level,
          herdId: victimInfo?.herdId,
          predatorId: event.predatorId,
          predatorSpecies: event.predatorSpecies,
          guardianEverFought,
          guardianFightTick,
          ticksFromDetectToDeath: detectTick !== undefined ? event.tick - detectTick : undefined,
        });
      }
    }
  }

  prevSnapshot = snapshot();
  const concurrentJuveniles = world.agents.filter((a) => a.alive !== false && !a.isEgg && a.age !== undefined && a.age < JUVENILE_AGE_THRESHOLD).length;
  if (concurrentJuveniles > maxConcurrentJuveniles) maxConcurrentJuveniles = concurrentJuveniles;
}

const oneShot = juvenileDeaths.filter((d) => d.ticksFromDetectToDeath !== undefined && d.ticksFromDetectToDeath <= 1);
const guardianIntervened = juvenileDeaths.filter((d) => d.guardianEverFought);

console.log(
  JSON.stringify(
    {
      ticks,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      hatchCount,
      bornCount,
      maxConcurrentJuveniles,
      juvenileFleeEvents,
      juvenileStarvedDeaths,
      juvenileAgeDeaths,
      allKillVictimAges,
      totalDeaths,
      juvenileDeathCount,
      juvenileDeathsWithKnownDetectTick: juvenileDeaths.filter((d) => d.ticksFromDetectToDeath !== undefined).length,
      oneShotJuvenileDeaths: oneShot.length, // killer's fight-behavior toward this exact victim started the SAME tick (or one before) the kill landed
      medianTicksFromDetectToDeath: median(juvenileDeaths.map((d) => d.ticksFromDetectToDeath).filter((x): x is number => x !== undefined)),
      juvenileDeathsWithAnyGuardianIntervention: guardianIntervened.length,
      sampleJuvenileDeaths: juvenileDeaths.slice(0, 10),
    },
    null,
    2
  )
);

function median(nums: number[]): number | undefined {
  if (nums.length === 0) return undefined;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
