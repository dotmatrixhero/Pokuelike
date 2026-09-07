/**
 * Real-run validation for evolution-aware, randomized immigrant levels
 * (immigration.ts's `rollImmigrantLevel`) — confirms a live `tickWorld` run
 * actually produces real variety across levels, and that evolved species
 * land meaningfully higher than base-form ones. Wraps `spawnAgent` to
 * record the level actually rolled AT SPAWN TIME — reading `agent.level`
 * off `world.agents` at the end of the run would be misleading, since a
 * still-living immigrant keeps gaining real exp/levels after arriving
 * (and can evolve further), unrelated to what it actually spawned at.
 * Usage: `pnpm --filter @pokuelike/runner exec tsx src/validateImmigrantLevels.ts <ticks>`
 */
import { tickWorld, EventLog } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);

const world = createDemoWorld();
const log = new EventLog();

const spawnRecords: { species: string; level: number }[] = [];
const realSpawnAgent = IMMIGRATION_CONTEXT.spawnAgent;
const instrumentedCtx = {
  ...IMMIGRATION_CONTEXT,
  spawnAgent: (speciesId: string, id: string, pos: { x: number; y: number }, level: number, rng: () => number) => {
    spawnRecords.push({ species: speciesId, level });
    return realSpawnAgent(speciesId, id, pos, level, rng);
  },
};

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, instrumentedCtx);
}

const levelsBySpecies = new Map<string, number[]>();
for (const rec of spawnRecords) {
  if (!levelsBySpecies.has(rec.species)) levelsBySpecies.set(rec.species, []);
  levelsBySpecies.get(rec.species)!.push(rec.level);
}

const summary: Record<string, { count: number; min: number; max: number; distinctLevels: number }> = {};
for (const [species, levels] of levelsBySpecies) {
  summary[species] = {
    count: levels.length,
    min: Math.min(...levels),
    max: Math.max(...levels),
    distinctLevels: new Set(levels).size,
  };
}

console.log(
  JSON.stringify(
    {
      ticks,
      totalImmigrantsSpawned: spawnRecords.length,
      spawnLevelsBySpecies: summary,
    },
    null,
    2
  )
);
