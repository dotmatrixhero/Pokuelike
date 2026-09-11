/**
 * Live measurement of Surf's three reworked properties, each against a
 * control that should FAIL to do the thing. Usage:
 *   pnpm --filter @pokuelike/runner exec tsx src/validateSurf.ts [seeds]
 *
 * Pieces 1 and 3 are measured on real generated worlds (`createDemoWorld`),
 * across several seeds, because run-to-run variance here is large. Piece 2
 * (the ferry) needs two allies standing on opposite-facing shores of the
 * same lake with a home across it, which a random world will not reliably
 * produce inside a short run, so it is measured on a purpose-built map that
 * is nonetheless ticked through the real `tickWorld`.
 */
import {
  EventLog,
  tickWorld,
  createWorld,
  setTile,
  resolveShape,
  canStepTo,
  canEnterWater,
  tileAt,
  ridesWater,
  type Agent,
  type MoveShape,
  type World,
} from "@pokuelike/engine";
import { MOVES, createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const seeds = (process.argv[2] ?? "1,2,3,4,5").split(",").map(Number);
const surf = MOVES.surf;
const OLD_SHAPE: MoveShape = { kind: "ring", radius: 2 };

function line(label: string, value: unknown) {
  console.log(`${label.padEnd(46)} ${value}`);
}

// ---------------------------------------------------------------- piece 1
console.log("=== 1. SHAPE: the wave vs. the ring it replaces ===");
line("surf.shape", JSON.stringify(surf.shape));
line("surf.range", JSON.stringify(surf.range));

const origin = { x: 5, y: 5 };
const wave = resolveShape(surf.shape, origin, "E");
const ring = resolveShape(OLD_SHAPE, origin, "E");
const rel = (tiles: { x: number; y: number }[]) => tiles.map((t) => `(${t.x - origin.x},${t.y - origin.y})`).sort();
const adjacentOffsets = ["(1,-1)", "(1,0)", "(1,1)"];

line("wave tiles", `${wave.length}  ${rel(wave).join(" ")}`);
line("ring tiles (CONTROL)", `${ring.length}  ${rel(ring).join(" ")}`);
line("wave covers the 3 tiles directly ahead", adjacentOffsets.every((o) => rel(wave).includes(o)));
line("ring covers ANY of them (CONTROL)", adjacentOffsets.some((o) => rel(ring).includes(o)));
line("wave is aimed (E footprint !== N footprint)", JSON.stringify(rel(wave)) !== JSON.stringify(rel(resolveShape(surf.shape, origin, "N"))));
line("ring is aimed (CONTROL)", JSON.stringify(rel(ring)) !== JSON.stringify(rel(resolveShape(OLD_SHAPE, origin, "N"))));

// A printed grid, so the footprint is looked at rather than counted.
console.log("\n  wave, facing east (@ = user, # = hit):");
for (let dy = -2; dy <= 2; dy++) {
  let row = "    ";
  for (let dx = -2; dx <= 5; dx++) {
    if (dx === 0 && dy === 0) row += "@";
    else row += rel(wave).includes(`(${dx},${dy})`) ? "#" : ".";
  }
  console.log(row);
}
console.log("  ring, the old shape (CONTROL — note the hole at distance 1):");
for (let dy = -2; dy <= 2; dy++) {
  let row = "    ";
  for (let dx = -2; dx <= 5; dx++) {
    if (dx === 0 && dy === 0) row += "@";
    else row += rel(ring).includes(`(${dx},${dy})`) ? "#" : ".";
  }
  console.log(row);
}

// ---------------------------------------------------------------- piece 3
console.log("\n=== 3. WATER TRAVEL: deep-water tiles open to a land Pokemon ===");
console.log("Counting, on real generated maps, how many surface water tiles a");
console.log("Rock-type could stand on WITH Surf vs. the identical agent without it.");

function landProbe(id: string, moves: Agent["moves"]): Agent {
  return {
    id,
    species: "geodude",
    types: ["rock"],
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1, social: 1 },
    behavior: "idle",
    hp: 30,
    maxHp: 30,
    moves,
  } as unknown as Agent;
}

const rider = landProbe("rider", [surf as any]);
const control = landProbe("control", [{ ...(surf as any), watercraft: undefined }]);
console.log(`  ridesWater(rider)=${ridesWater(rider)}  ridesWater(control)=${ridesWater(control)}`);
console.log("  seed    water tiles   open WITH surf   open WITHOUT (CONTROL)");
let totalWater = 0;
let totalWith = 0;
let totalWithout = 0;
for (const seed of seeds) {
  const world = createDemoWorld(seed);
  let water = 0;
  let openWith = 0;
  let openWithout = 0;
  for (let x = 0; x < world.width; x++) {
    for (let y = 0; y < world.height; y++) {
      const pos = { x, y };
      if (tileAt(world, "surface", x, y)?.terrain !== "water") continue;
      water++;
      if (canEnterWater(world, rider, "surface", pos)) openWith++;
      if (canEnterWater(world, control, "surface", pos)) openWithout++;
    }
  }
  totalWater += water;
  totalWith += openWith;
  totalWithout += openWithout;
  console.log(
    `  ${String(seed).padEnd(7)} ${String(water).padEnd(13)} ${String(openWith).padEnd(16)} ${openWithout}`
  );
}
line("\n  totals across seeds: with surf", `${totalWith}/${totalWater} (${((100 * totalWith) / totalWater).toFixed(1)}%)`);
line("  totals across seeds: CONTROL", `${totalWithout}/${totalWater} (${((100 * totalWithout) / totalWater).toFixed(1)}%)`);

// ---------------------------------------------------------------- piece 2
console.log("\n=== 2. FERRY: an ally carried across a lake, in a ticked world ===");

/** Land at x<=2, a 7-wide lake, land again at x>=10. */
function lakeWorld(): World {
  const world = createWorld(14, 9);
  for (let x = 3; x <= 9; x++) for (let y = 0; y < 9; y++) setTile(world, "surface", x, y, "water");
  return world;
}

function ferryRun(carrierHasSurf: boolean) {
  const world = lakeWorld();
  const carrier = {
    id: "carrier",
    species: "wartortle",
    types: ["water"],
    herdId: "h1",
    pos: { x: 2, y: 4 },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1, social: 1 },
    behavior: "idle",
    hp: 60,
    maxHp: 60,
    homePos: { x: 2, y: 4 },
    moves: [carrierHasSurf ? (surf as any) : { ...(surf as any), watercraft: undefined }],
  } as unknown as Agent;
  const passenger = {
    id: "passenger",
    species: "geodude",
    types: ["rock"],
    herdId: "h2",
    followingId: "carrier",
    pos: { x: 2, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1, social: 1 },
    behavior: "idle",
    hp: 30,
    maxHp: 30,
    homePos: { x: 12, y: 4 }, // home is across the water
    moves: [],
  } as unknown as Agent;
  world.agents.push(carrier, passenger);

  const log = new EventLog();
  const startedAt = { ...passenger.pos };
  let boarded = false;
  let landedAt: { x: number; y: number } | undefined;
  let carriedTicks = 0;
  let pickups = 0;

  for (let i = 0; i < 400; i++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    if (carrier.carryingId) {
      if (!boarded) pickups++;
      boarded = true;
      carriedTicks++;
    } else if (boarded && !landedAt) {
      landedAt = { ...passenger.pos };
      boarded = false;
    }
  }
  return {
    startedAt,
    landedAt,
    carriedTicks,
    pickups,
    finalPassengerPos: { ...passenger.pos },
    canPassengerWalkHome: canStepTo(world, passenger, "surface", { x: 5, y: 4 }),
    carrying: log.events.filter((e) => e.kind === "carrying").length,
    setDown: log.events.filter((e) => e.kind === "setDown").length,
  };
}

const withSurf = ferryRun(true);
const withoutSurf = ferryRun(false);

line("carrier knows Surf   -> picked up", withSurf.pickups > 0);
line("  started at", JSON.stringify(withSurf.startedAt));
line("  set down at", JSON.stringify(withSurf.landedAt));
line("  ticks spent being carried", withSurf.carriedTicks);
line("  carrying/setDown events", `${withSurf.carrying}/${withSurf.setDown}`);
line("  crossed to the far bank (x >= 10)", (withSurf.landedAt?.x ?? -1) >= 10);
line("  total pickups in 400 ticks (1 = no shuttle)", withSurf.pickups);
line("CONTROL: no watercraft -> picked up", withoutSurf.pickups > 0);
line("  passenger final position", JSON.stringify(withoutSurf.finalPassengerPos));
line("  carrying/setDown events", `${withoutSurf.carrying}/${withoutSurf.setDown}`);
line("  passenger could swim it alone anyway", withoutSurf.canPassengerWalkHome);

const pass =
  adjacentOffsets.every((o) => rel(wave).includes(o)) &&
  !adjacentOffsets.some((o) => rel(ring).includes(o)) &&
  totalWith > totalWithout &&
  (withSurf.landedAt?.x ?? -1) >= 10 &&
  withSurf.pickups === 1 &&
  withoutSurf.pickups === 0;
console.log(`\nALL THREE PIECES + CONTROLS: ${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
