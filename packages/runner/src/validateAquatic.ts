/**
 * Species-focused validation for the obligate-aquatic movement restriction —
 * reports Magikarp/Tentacool population and starvation counts, run against
 * `createDemoWorld`'s real generated maps. Usage:
 *   pnpm --filter @pokuelike/runner exec tsx <path>/validateAquatic.ts <seed> <ticks>
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const seed = Number(process.argv[2] ?? 42);
const ticks = Number(process.argv[3] ?? 6000);

const world = createDemoWorld(seed);
const log = new EventLog();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}

const AQUATIC = new Set(["magikarp", "gyarados", "tentacool", "tentacruel"]);

const alive = world.agents.filter((a) => a.alive !== false && !a.isEgg);
const aquaticAlive = alive.filter((a) => AQUATIC.has(a.species));

const starvedBySpeciesCause: Record<string, { hunger: number; thirst: number }> = {};
const starvedDetails: Array<{ tick: number; agentId: string; species: string; cause: string; pos: unknown }> = [];
let killedAquatic = 0;
let bornAquatic = 0; // hatched into base form (magikarp/tentacool) — evolutions counted separately
for (const e of log.events) {
  if (e.kind === "starved" && AQUATIC.has(e.species)) {
    starvedBySpeciesCause[e.species] ??= { hunger: 0, thirst: 0 };
    starvedBySpeciesCause[e.species]![e.cause]++;
    starvedDetails.push({ tick: e.tick, agentId: e.agentId, species: e.species, cause: e.cause, pos: e.pos });
  }
  if (e.kind === "defeated" && AQUATIC.has(e.loserSpecies)) killedAquatic++;
  if (e.kind === "eggHatched" && "species" in e && AQUATIC.has((e as any).species)) bornAquatic++;
}

console.log(
  JSON.stringify(
    {
      seed,
      ticks,
      finalPopulationTotal: alive.length,
      aquaticAliveNow: Object.fromEntries(
        [...AQUATIC].map((sp) => [sp, aquaticAlive.filter((a) => a.species === sp).length])
      ),
      aquaticAliveTotal: aquaticAlive.length,
      aquaticStarvedByCause: starvedBySpeciesCause,
      aquaticStarvedDetails: starvedDetails,
      aquaticKilledByPredator: killedAquatic,
      aquaticHatched: bornAquatic,
    },
    null,
    2
  )
);
