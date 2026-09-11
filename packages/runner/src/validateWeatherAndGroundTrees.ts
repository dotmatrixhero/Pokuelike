/**
 * Does a specced Rain Dance / Grassy Terrain actually CHANGE THE WORLD?
 *
 *   npx tsx packages/runner/src/validateWeatherAndGroundTrees.ts [ticks] [seeds...]
 *
 * These two trees claim to be the roster's world-changing pair — one puts a
 * real `WeatherCell` on the map, the other rebuilds the soil under it — so
 * the only honest test is a real `tickWorld` run measured against a control
 * that has no such user in it at all.
 *
 * Three arms per move per seed, on the SAME generated world:
 *   - none     — nobody knows the move (the control)
 *   - base     — the shipped base move, untouched by any tree
 *   - specced  — the same agents holding a real tree build
 *
 * The `base` arm is what makes the `specced` numbers mean anything: without
 * it, "more water appeared" would only prove that agents were standing
 * there, not that the tree did it.
 *
 * Each pair is run twice: FREE (agents decide for themselves, which is the
 * honest number) and FORCED (the same real `maybeUseUtilityMove` driven on a
 * fixed cadence). The forced pass exists because the free one is throttled
 * by something outside these trees entirely: `chooseBehavior` only returns
 * "idle" while every need is satisfied, and `mateDrive` climbs to 1 and
 * stays there until an agent actually mates — at mateDrive 1 the urgency
 * term is 0.5, over the 0.3 idle threshold, so a healthy, well-fed adult is
 * permanently ineligible to use ANY utility move out of combat. Forcing the
 * cadence measures the tree; the free pass measures how often the sim lets
 * it happen at all.
 */
import {
  EventLog,
  applyMoveTree,
  maybeUseUtilityMove,
  fertilityCeiling,
  generateWorld,
  tickWorld,
  tileAt,
  type Agent,
  type MoveSpec,
  type World,
} from "@pokuelike/engine";
import { HUNT_RULES, IMMIGRATION_CONTEXT, LEVELING_CONTEXT, MOVES, spawnAgent } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 4000);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [42, 7, 20260903];
const WIDTH = 90;
const HEIGHT = 70;
const DANCERS = 8;
/**
 * Deliberately 50, not a plausible field level. Both moves sit very late in
 * their learners' real dex learnsets (`spawn.ts`'s `moveUnlockLevel`):
 * Dratini gets Rain Dance at 45, Gyarados at ~60, Oddish gets Grassy
 * Terrain at 45, Gloom at ~60. Spawning lower produces agents that do not
 * know the move at all and a table of honest zeroes measuring nothing. See
 * this run's own report for what that means for the live roster.
 */
const DANCER_LEVEL = 50;

/** Cheapest dependency closure of `id` — every prerequisite, and the first `prerequisitesAnyOf` set. */
function closure(move: MoveSpec, id: string, acc = new Set<string>()): Set<string> {
  if (acc.has(id)) return acc;
  acc.add(id);
  const node = move.tree![id]!;
  for (const pre of node.prerequisites ?? []) closure(move, pre, acc);
  const sets = node.prerequisitesAnyOf ?? [];
  if (sets.length) for (const pre of sets[0]!) closure(move, pre, acc);
  return acc;
}

function build(moveId: string, targets: string[]): MoveSpec {
  const base = MOVES[moveId]!;
  const chosen = new Set<string>();
  for (const t of targets) for (const id of closure(base, t)) chosen.add(id);
  // Ancestry order, so an overwrite ladder's later rung is applied last —
  // the same purchase-order dependence `applyMoveTree`'s own doc comment
  // warns about.
  const ordered = [...chosen].sort((a, b) => closure(base, a).size - closure(base, b).size);
  return applyMoveTree(base, ordered);
}

interface Metrics {
  water: number;
  floraAndFood: number;
  seedlings: number;
  meanCeiling: number;
  ceilingRaisedTiles: number;
  cellsSpawned: number;
  meanRadius: number;
  meanLifespan: number;
  moveUses: number;
  usesIdle: number;
  usesInCombat: number;
}

function measure(
  world: World,
  spawnedCells: { radius: number; lifespan: number }[],
  agents: Agent[],
  moveId: string,
  log: EventLog
): Metrics {
  let water = 0;
  let floraAndFood = 0;
  let seedlings = 0;
  let ceilingSum = 0;
  let ceilingRaised = 0;
  let land = 0;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = tileAt(world, "surface", x, y);
      if (!tile) continue;
      if (tile.terrain === "water") { water++; continue; }
      land++;
      ceilingSum += fertilityCeiling(tile);
      if ((tile.fertilityCeilingBonus ?? 0) > 0) ceilingRaised++;
      if (tile.terrain === "flora" || tile.terrain === "food") floraAndFood++;
      if (tile.terrain === "seedling") seedlings++;
    }
  }
  let uses = 0;
  for (const agent of agents) uses += agent.moveUseCounts?.[moveId] ?? 0;
  // Which PATH fired matters: `maybeUseUtilityMoveInCombat` deliberately
  // never applies a fertility/ceiling/weather effect, so a use counted in a
  // fight is not a use that could have changed the ground.
  let usesIdle = 0;
  let usesInCombat = 0;
  for (const event of log.events) {
    if (event.kind !== "utilityMoveUsed" || event.moveId !== moveId) continue;
    if (event.inCombat) usesInCombat++;
    else usesIdle++;
  }
  return {
    water,
    floraAndFood,
    seedlings,
    meanCeiling: land ? ceilingSum / land : 0,
    ceilingRaisedTiles: ceilingRaised,
    cellsSpawned: spawnedCells.length,
    meanRadius: spawnedCells.length ? spawnedCells.reduce((s, c) => s + c.radius, 0) / spawnedCells.length : 0,
    meanLifespan: spawnedCells.length ? spawnedCells.reduce((s, c) => s + c.lifespan, 0) / spawnedCells.length : 0,
    moveUses: uses,
    usesIdle,
    usesInCombat,
  };
}

/** A walkable land tile matching `want`, as close to the map centre as possible. */
function findSpot(world: World, want: (t: NonNullable<ReturnType<typeof tileAt>>, x: number, y: number) => boolean) {
  let best: { x: number; y: number } | undefined;
  let bestD = Infinity;
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 2; x++) {
      const tile = tileAt(world, "surface", x, y);
      if (!tile || !tile.walkable || tile.terrain === "water") continue;
      if (!want(tile, x, y)) continue;
      const d = Math.abs(x - world.width / 2) + Math.abs(y - world.height / 2);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
  }
  return best;
}

function nearWater(world: World, x: number, y: number): boolean {
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++)
      if (tileAt(world, "surface", x + dx, y + dy)?.terrain === "water") return true;
  return false;
}

function runArm(
  seed: number,
  species: string,
  moveId: string,
  arm: "none" | "base" | "specced",
  spec: MoveSpec | undefined,
  place: (world: World) => { x: number; y: number } | undefined,
  forceEvery = 0
): Metrics {
  const world = generateWorld(WIDTH, HEIGHT, seed);
  const log = new EventLog();
  const agents: Agent[] = [];
  const spot = place(world);
  if (arm !== "none" && spot) {
    for (let i = 0; i < DANCERS; i++) {
      const agent = spawnAgent(species, `${arm}-${i}`, { x: spot.x + (i % 4), y: spot.y + Math.floor(i / 4) }, DANCER_LEVEL, world.rng);
      agent.herdId = `${arm}-herd`;
      agent.sex = i % 2 === 0 ? "male" : "female";
      if (arm === "specced" && spec) {
        const idx = agent.moves?.findIndex((m) => m.id === moveId) ?? -1;
        if (idx >= 0) agent.moves![idx] = spec;
      }
      if (!(agent.moves ?? []).some((m) => m.id === moveId)) {
        throw new Error(`${species} at level ${DANCER_LEVEL} does not know ${moveId} — nothing to measure`);
      }
      // Every OTHER utility move is stripped, in every arm equally, and it
      // is not a convenience: `maybeUseUtilityMove` walks the movepool in
      // order and returns the moment the FIRST eligible one fires. An
      // Oddish knows Growth before Grassy Terrain, so with both in hand it
      // used Growth every single time and Grassy Terrain fired 0 times in
      // 1,500 ticks. Measuring that would be measuring movepool order.
      agent.moves = (agent.moves ?? []).filter((m) => m.id === moveId || !m.utilityMove);
      agents.push(agent);
      world.agents.push(agent);
    }
  }

  const spawnedCells: { radius: number; lifespan: number }[] = [];
  const seenCellIds = new Set<string>();
  for (let t = 0; t < ticks; t++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    if (forceEvery > 0 && t % forceEvery === 0) {
      // The real engine function, with only its own 15% "do I feel like it"
      // roll cleared — every effect it applies is applied by the shipped
      // code path, not by this harness.
      for (const agent of agents) if (agent.alive !== false) maybeUseUtilityMove(world, agent, log, () => 0);
    }
    for (const cell of world.weatherCells ?? []) {
      if (seenCellIds.has(cell.id)) continue;
      seenCellIds.add(cell.id);
      // Only cells this herd actually called down: a natural spawn lands at
      // a random point, so "centred on a living dancer" separates the two
      // without needing a new field on WeatherCell.
      const called = agents.some((a) => a.alive !== false && Math.abs(a.pos.x - cell.center.x) < 1.5 && Math.abs(a.pos.y - cell.center.y) < 1.5);
      if (arm !== "none" && !called) continue;
      if (arm === "none") continue;
      spawnedCells.push({ radius: cell.radius, lifespan: cell.lifespanTicks });
    }
  }
  return measure(world, spawnedCells, agents, moveId, log);
}

const rainBuild = build("rain_dance", ["mist_after", "sheet_rain"]);
const grassBuild = build("grassy_terrain", ["it_holds_now", "whole_field"]);

console.log(`ticks=${ticks} seeds=${seeds.join(",")} dancers=${DANCERS}`);
console.log(
  `rain_dance build: radius +${rainBuild.weatherRadiusBonus ?? 0}, lifespan +${rainBuild.weatherLifespanBonus ?? 0}, cooldown ${MOVES.rain_dance!.cooldownTicks} -> ${rainBuild.cooldownTicks}`
);
console.log(
  `grassy_terrain build: fertilityBoost ${JSON.stringify(grassBuild.fertilityBoost)}, ceilingBoost ${JSON.stringify(grassBuild.fertilityCeilingBoost)}, cooldown ${MOVES.grassy_terrain!.cooldownTicks} -> ${grassBuild.cooldownTicks}`
);

const rows: string[] = [];
for (const seed of seeds) {
  for (const mode of ["free", "forced"] as const) {
    const every = mode === "forced" ? 120 : 0;
    for (const arm of ["none", "base", "specced"] as const) {
      const m = runArm(seed, "dratini", "rain_dance", arm, rainBuild, (w) => findSpot(w, (_t, x, y) => nearWater(w, x, y)), every);
      rows.push(
        `rain   ${mode.padEnd(6)} seed ${seed} ${arm.padEnd(7)} uses ${String(m.moveUses).padStart(3)} (idle ${m.usesIdle}/fight ${m.usesInCombat})  calledCells ${String(m.cellsSpawned).padStart(3)} (r ${m.meanRadius.toFixed(1)}, life ${m.meanLifespan.toFixed(0)})  water ${m.water}  flora+food ${m.floraAndFood}`
      );
    }
    for (const arm of ["none", "base", "specced"] as const) {
      const m = runArm(
        seed,
        "oddish",
        "grassy_terrain",
        arm,
        grassBuild,
        (w) => findSpot(w, (t) => t.groundType === "rocky" || t.groundType === "sandy"),
        every
      );
      rows.push(
        `ground ${mode.padEnd(6)} seed ${seed} ${arm.padEnd(7)} uses ${String(m.moveUses).padStart(3)} (idle ${m.usesIdle}/fight ${m.usesInCombat})  ceilingRaisedTiles ${String(m.ceilingRaisedTiles).padStart(4)}  meanCeiling ${m.meanCeiling.toFixed(4)}  flora+food ${m.floraAndFood}  seedlings ${m.seedlings}`
      );
    }
  }
}
rows.forEach((r) => console.log(r));
