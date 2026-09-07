/**
 * Real-run validation for herd-rivalry retaliation (herdConflict.ts's
 * `applyRivalryRetaliation`) — confirms a live `tickWorld` run actually
 * produces real back-and-forth exchanges (both sides of a pair landing at
 * least one hit on each other) rather than the old one-sided "whoever's
 * tick fires first, the other just takes it" pattern, and that a
 * sufficiently outmatched agent backs away instead. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateRivalryRetaliation.ts <ticks>`
 */
import { tickWorld, EventLog } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);

const world = createDemoWorld();
const log = new EventLog();

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
}

const clashes = log.events.filter((e) => e.kind === "herdClash");
const hits = clashes.filter((e) => e.outcome === "hit" || e.outcome === "retreated");

// Group hits by unordered pair, tracking which direction(s) actually landed.
const pairDirections = new Map<string, Set<string>>();
for (const e of hits) {
  if (e.kind !== "herdClash") continue;
  const pairKey = [e.attackerId, e.defenderId].sort().join("|");
  const dirKey = `${e.attackerId}->${e.defenderId}`;
  if (!pairDirections.has(pairKey)) pairDirections.set(pairKey, new Set());
  pairDirections.get(pairKey)!.add(dirKey);
}

let mutualPairs = 0;
let oneSidedPairs = 0;
for (const dirs of pairDirections.values()) {
  if (dirs.size >= 2) mutualPairs++;
  else oneSidedPairs++;
}

console.log(
  JSON.stringify(
    {
      ticks,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      herdClashHitCount: hits.length,
      distinctPairs: pairDirections.size,
      mutualPairs,
      oneSidedPairs,
    },
    null,
    2
  )
);
