/**
 * A controlled egg raid: one egg, one parent, one hungry raider, on flat
 * ground. Does the egg survive?
 *
 * Whole-run numbers could not answer this. Changing defender behaviour
 * changes the rng stream, so the "before" and "after" runs diverge into
 * different worlds — eggs laid went 46 -> 30 between two runs of the same
 * seeds, which makes any rate comparison meaningless. This is the controlled
 * version: the same fixed board every time, sweeping how far the parent and
 * the raider each start from the egg, so the only thing that varies is the
 * thing being measured.
 *
 * Run: `npx tsx packages/runner/src/validateEggRaid.ts`
 */
import { EventLog, createWorld, ensureCombatProfile, setTile, tickWorld, type Agent, type World } from "@pokuelike/engine";
import { spawnEgg } from "@pokuelike/engine/src/eggs.js";
import { HUNT_RULES, LEVELING_CONTEXT } from "@pokuelike/data";

const SIZE = 40;
const TICKS = 40;
const EGG_AT = { x: 20, y: 20 };

function flatWorld(seed: number): World {
  const world = createWorld(SIZE, SIZE, seed);
  for (const layer of ["surface"] as const)
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) setTile(world, layer, x, y, "floor", 0.5);
  return world;
}

function agent(id: string, species: string, pos: { x: number; y: number }, extra: Partial<Agent>): Agent {
  const a = {
    id, species, pos: { ...pos }, layer: "surface", homeLayer: "surface", homePos: { ...pos },
    needs: { hunger: 1, thirst: 1, energy: 1, mateDrive: 0 },
    behavior: "idle", age: 500, level: 16, ...extra,
  } as Agent;
  // Without this a hand-built agent has no hp, no stats and NO MOVES, so it
  // cannot attack at all. The first version of this harness skipped it and
  // produced a grid of 0/10 everywhere: the "defender" was standing next to
  // its egg in `fight` state, logging `eggDefended` every tick, and never
  // landing a blow. A test that cannot pass is not a measurement.
  ensureCombatProfile(a, LEVELING_CONTEXT);
  return a;
}

/** One raid. Returns true if the egg was still alive and unhatched-or-hatched (i.e. never eaten). */
function raid(parentDist: number | undefined, raiderDist: number, seed: number): boolean {
  const world = flatWorld(seed);
  const mother = agent("mother", "bulbasaur", { x: EGG_AT.x, y: EGG_AT.y - 1 }, { herdId: "nest" });
  const father = agent("father", "bulbasaur", { x: EGG_AT.x, y: EGG_AT.y + 1 }, { herdId: "nest" });
  const egg = spawnEgg(world, mother, father, EGG_AT, 1);

  // The parent stands `parentDist` west of the egg; the raider starts
  // `raiderDist` east of it, so the raider is never walking through the
  // parent to get there.
  const parent = parentDist === undefined
    ? undefined
    : agent("parent", "bulbasaur", { x: EGG_AT.x - parentDist, y: EGG_AT.y }, { herdId: "nest" });
  const raider = agent("raider", "scyther", { x: EGG_AT.x + raiderDist, y: EGG_AT.y }, {
    herdId: "raiders",
    // Below EGG_EAT_HUNGER_THRESHOLD (0.9), so it genuinely wants the egg.
    needs: { hunger: 0.5, thirst: 1, energy: 1, mateDrive: 0 },
  });

  world.agents.push(egg, raider);
  if (parent) world.agents.push(parent);
  const log = new EventLog();
  for (let t = 0; t < TICKS; t++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng);
    if (log.events.some((e) => e.kind === "eggEaten")) return false;
  }
  return true;
}

// `undefined` is the CONTROL: no parent at all. An undefended egg must still
// be eaten, every time. Without this row a grid of all-survived would read as
// "defence works" when it actually meant "eating is broken".
const parentDists: (number | undefined)[] = [undefined, 1, 2, 3, 4, 5, 6, 7, 8];
// Only distances INSIDE `EGG_EAT_DETECT_RADIUS` (5). Beyond it the raider
// never notices the egg at all, so those columns measure "did the raider
// happen to wander into range", not "did the defence work" — the NO PARENT
// control made that obvious by surviving 5/5 at r=6,7,8.
const raiderDists = [1, 2, 3, 4, 5];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

console.log("egg survival — rows: how far the parent starts from the egg, cols: how far the raider starts");
console.log("          " + raiderDists.map((r) => `r=${r}`.padStart(6)).join(""));
let survived = 0, total = 0;
for (const p of parentDists) {
  const cells = raiderDists.map((r) => {
    const wins = SEEDS.filter((s) => raid(p, r, s)).length;
    if (p !== undefined) { survived += wins; total += SEEDS.length; }
    return `${wins}/${SEEDS.length}`.padStart(6);
  });
  console.log(`${p === undefined ? "NO PARENT" : `parent=${p}`.padEnd(9)} ${cells.join("")}`);
}
console.log(`\noverall (defended rows only): egg survived ${survived}/${total} raids (${((100 * survived) / total).toFixed(0)}%)`);
