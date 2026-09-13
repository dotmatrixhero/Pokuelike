/**
 * Baseline for the human species pass (HUMAN_PASS.md phase 0). Before tuning
 * anything, measure what wild humans actually DO today: do they spawn at all,
 * do they get a herdId (mob defense is herd-gated via `countHerdAllies`, so
 * without one the "humans mob-defend well" trait would be unreachable), do
 * they ever stand and fight, and what kills them.
 *
 * Run: npx tsx packages/runner/src/measureHumanBaseline.ts [ticks] [seeds]
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const TICKS = Number(process.argv[2] ?? 6000);
const SEEDS = (process.argv[3] ?? "11,22,33").split(",").map(Number);

let everSeen = 0, withHerd = 0, herdOfOne = 0, aliveEnd = 0;
let humanAttacks = 0, humanDefends = 0, humanDeaths = 0, humanArchetyped = 0;
const causes = new Map<string, number>();
const herdSizes: number[] = [];

for (const seed of SEEDS) {
  const world = createDemoWorld(seed);
  const log = new EventLog();
  const seenHumans = new Set<string>();
  for (let i = 0; i < TICKS; i++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    for (const a of world.agents as any[]) {
      if (a.species === "human" && a.alive !== false) seenHumans.add(a.id);
    }
  }
  everSeen += seenHumans.size;

  const humans = (world.agents as any[]).filter((a) => a.species === "human");
  const living = humans.filter((a) => a.alive !== false);
  aliveEnd += living.length;
  for (const h of living) {
    if (h.herdId) {
      withHerd++;
      const size = (world.agents as any[]).filter((a) => a.herdId === h.herdId && a.alive !== false).length;
      herdSizes.push(size);
      if (size === 1) herdOfOne++;
    }
    if (h.archetype) humanArchetyped++;
  }

  const humanIds = new Set(humans.map((h) => h.id));
  for (const e of (log as any).events ?? []) {
    if (e.kind === "fought" || e.kind === "missed") {
      if (humanIds.has(e.attackerId)) humanAttacks++;
      if (humanIds.has(e.defenderId)) humanDefends++;
    }
    if ((e.kind === "died" || e.kind === "defeated" || e.kind === "starved") && humanIds.has(e.agentId ?? e.loserId)) {
      humanDeaths++;
      const c = e.cause ?? e.kind;
      causes.set(c, (causes.get(c) ?? 0) + 1);
    }
  }
}

const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : "n/a");
console.log(`${SEEDS.length} seeds x ${TICKS} ticks`);
console.log(`humans ever alive:        ${everSeen}`);
console.log(`humans alive at end:      ${aliveEnd}`);
console.log(`  ...with a herdId:       ${withHerd}   (mob defense is herd-gated, so 0 here = trait unreachable)`);
console.log(`  ...whose herd is size 1: ${herdOfOne}  (a herd of one can never reach MOB_THRESHOLD)`);
console.log(`  mean herd size:         ${avg(herdSizes)}`);
console.log(`  ...with an archetype:   ${humanArchetyped}`);
console.log(`human attacks made:       ${humanAttacks}`);
console.log(`human times attacked:     ${humanDefends}`);
console.log(`human deaths:             ${humanDeaths}  causes: ${[...causes].map(([c, n]) => `${c} ${n}`).join(", ") || "(none)"}`);
