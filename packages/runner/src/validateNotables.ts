/**
 * Real multi-seed validation for the Notables feature — see DESIGN.md's
 * "Notables" section. Modeled directly on validate.ts's shape. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateNotables.ts <seed> <ticks>`.
 */
import { EventLog, tickWorld, type SimEvent } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const seed = Number(process.argv[2] ?? 42);
const ticks = Number(process.argv[3] ?? 8000);

const world = createDemoWorld(seed);
const founderCount = world.agents.length;
const log = new EventLog();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}

const claimed = log.events.filter((e): e is Extract<SimEvent, { kind: "titleClaimed" }> => e.kind === "titleClaimed");
const lost = log.events.filter((e): e is Extract<SimEvent, { kind: "titleLost" }> => e.kind === "titleLost");

const uniqueHolders = new Set(claimed.map((e) => e.agentId));
const transfersByTitle: Record<string, number> = {};
for (const e of claimed) transfersByTitle[e.title] = (transfersByTitle[e.title] ?? 0) + 1;

const allTitles = ["hero", "builder", "gatherer", "rival", "beloved", "elder", "wanderer"] as const;
const unclaimedEver = allTitles.filter((t) => !claimed.some((e) => e.title === t));

const alive = world.agents.filter((a) => a.alive !== false && !a.isEgg);

// Every real "a new agent came to exist" event — founders (world.agents'
// initial size before this loop ran) plus every birth/hatch/immigration
// arrival over the whole run — for an honest "what fraction of everyone who
// ever lived held a title" denominator, since `finalPopulation` alone badly
// undercounts it (most agents that ever existed have since died).
const bornCount = log.events.filter((e) => e.kind === "eggLaid").length; // an egg IS the new agent from this point on
const immigrantCount = log.events.filter((e) => e.kind === "immigrated").reduce((n, e) => n + e.agentIds.length, 0);
const everExisted = founderCount + bornCount + immigrantCount;

console.log(
  JSON.stringify(
    {
      seed,
      ticks,
      finalPopulation: alive.length,
      everExistedApprox: everExisted,
      totalTitleTransfers: claimed.length,
      totalTitleLossEvents: lost.length,
      uniqueAgentsEverTitled: uniqueHolders.size,
      uniqueAgentsEverTitledFractionOfEverExisted: Number((uniqueHolders.size / everExisted).toFixed(4)),
      transfersByTitle,
      unclaimedEver,
      currentHolders: world.notables ?? {},
    },
    null,
    2
  )
);
