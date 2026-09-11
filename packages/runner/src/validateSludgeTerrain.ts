/**
 * Does a real Sludge user actually foul real ground in a real run?
 *
 * The unit tests prove `foulTile` does what it says when called. This asks
 * the only question that matters afterwards: does anything ever CALL it in a
 * live world, or is fouled ground content that exists and never fires?
 *
 * The control is a run of the same seeds where no agent knows Sludge — if
 * fouled tiles show up there too, this script is measuring something else.
 *
 * Run: `npx tsx packages/runner/src/validateSludgeTerrain.ts [ticks] [seed,...]`
 */
import { EventLog, tickWorld, tileAt } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, MOVES } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 3000);
const SEEDS = (process.argv[3] ?? "1000,8919,16838,24757").split(",").map(Number);

function run(seed: number, withSludge: boolean) {
  const world: any = createDemoWorld(seed);
  if (!withSludge) {
    for (const a of world.agents) a.moves = (a.moves ?? []).filter((m: any) => m.id !== "sludge");
  } else {
    // Guarantee the mechanic is reachable at all: hand Sludge to a few
    // agents outright. Without this the measurement mostly reports whether
    // a Sludge learner happened to spawn, which is a different question.
    let given = 0;
    for (const a of world.agents) {
      if (given >= 5) break;
      if ((a.moves ?? []).some((m: any) => m.id === "sludge")) continue;
      a.moves = [...(a.moves ?? []), (MOVES as any).sludge];
      given++;
    }
  }
  const log = new EventLog();
  for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

  let sludgeTiles = 0, mudFromSludge = 0, plantsKilled = 0;
  for (let i = 0; i < world.tiles.surface.length; i++) if (world.tiles.surface[i].terrain === "sludge") sludgeTiles++;
  for (const e of log.events as any[]) {
    if (e.kind !== "terrainChanged") continue;
    if (e.cause === "sludge" && e.to === "mud") mudFromSludge++;
    if (e.cause === "sludgeKilledPlant") plantsKilled++;
  }
  const poisoned = (log.events as any[]).filter((e) => e.kind === "statusInflicted" && e.statusKind === "poison").length;
  return { sludgeTiles, mudFromSludge, plantsKilled, poisoned };
}

console.log(`\nsludge terrain over ${ticks} ticks x ${SEEDS.length} seeds\n`);
console.log("seed      sludge tiles  ponds ruined  plants killed  poisonings");
let anyFouled = 0;
for (const seed of SEEDS) {
  const on = run(seed, true);
  anyFouled += on.plantsKilled + on.mudFromSludge + on.sludgeTiles;
  console.log(
    `${String(seed).padEnd(9)} ${String(on.sludgeTiles).padStart(12)} ${String(on.mudFromSludge).padStart(13)} ${String(on.plantsKilled).padStart(14)} ${String(on.poisoned).padStart(11)}`
  );
}
console.log("\nCONTROL (no agent knows Sludge):");
console.log("seed      sludge tiles  ponds ruined  plants killed  poisonings");
for (const seed of SEEDS) {
  const off = run(seed, false);
  console.log(
    `${String(seed).padEnd(9)} ${String(off.sludgeTiles).padStart(12)} ${String(off.mudFromSludge).padStart(13)} ${String(off.plantsKilled).padStart(14)} ${String(off.poisoned).padStart(11)}`
  );
}
if (anyFouled === 0) console.log("\nFINDING: no ground was ever fouled — the mechanic exists and never fires.");
