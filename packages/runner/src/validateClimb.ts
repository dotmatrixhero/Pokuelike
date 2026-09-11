/**
 * ROADMAP.md M7 Climb's own acceptance measurement, same spirit as
 * validateBond.ts's M6 bot: "a layer that kills the bot every time is a
 * balance report for the user, not a number to tune yourself" (HANDOFF.md
 * §5). A bot walks toward each level's stairs (or the exit on the deepest
 * level), fighting back when a predator closes to melee range and drinking/
 * eating opportunistically — then reports deaths per depth across several
 * seeds, so the escalating Zubat -> Golbat -> Onix -> Haunter curve is a
 * measured finding, not a guess.
 *
 *   pnpm --filter @pokuelike/runner exec tsx src/validateClimb.ts
 */
import { advancePlayerTurn, findPlayer, harvestableAt, countOf, tileAt, useStairs, isAtExit, EventLog, type Agent, type PlayerAction, type World } from "@pokuelike/engine";
import { createCaveRun, CAVE_RUN_DEPTH, walkDistances, HUNT_RULES, LEVELING_CONTEXT } from "@pokuelike/data";

const SEEDS = [20260903, 11, 202, 3003, 40404];
const steps = [-1, 0, 1] as const;
const BUDGET_PER_LEVEL = 400;
const PREDATOR_SPECIES = new Set(["zubat", "golbat", "onix", "haunter"]);

function cheb(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function toward(world: World, dist: Map<string, number>, me: Agent): PlayerAction {
  let best: { dx: -1 | 0 | 1; dy: -1 | 0 | 1; d: number } | undefined;
  for (const dy of steps)
    for (const dx of steps) {
      if (!dx && !dy) continue;
      const d = dist.get(`${me.pos.x + dx},${me.pos.y + dy}`);
      if (d !== undefined && (!best || d < best.d)) best = { dx, dy, d };
    }
  return best ? { kind: "move", dx: best.dx, dy: best.dy } : { kind: "wait" };
}

function adjacentPredator(world: World, me: Agent): Agent | undefined {
  return world.agents.find((a) => a !== me && a.alive !== false && PREDATOR_SPECIES.has(a.species) && cheb(a.pos, me.pos) <= 1);
}

console.log("seed      outcome              diedAtDepth  ticks  hpAtEachLevel");
const deathsPerDepth = new Map<number, number>();
for (let d = 2; d <= CAVE_RUN_DEPTH; d++) deathsPerDepth.set(d, 0);
let emerged = 0;
const encountersPerDepth = new Map<number, number>();
for (let d = 2; d <= CAVE_RUN_DEPTH; d++) encountersPerDepth.set(d, 0);

for (const seed of SEEDS) {
  let world = createCaveRun(seed);
  const me = findPlayer(world)!;
  const log = new EventLog();
  let ticks = 0;
  let diedAtDepth: number | undefined;

  const act = (a: PlayerAction) => {
    advancePlayerTurn(world, a, log, HUNT_RULES, LEVELING_CONTEXT, world.rng);
    ticks++;
  };
  const nearestWater = () => {
    const dist = walkDistances(world, "underground", me.pos);
    let best: { x: number; y: number; d: number } | undefined;
    for (const [k, d] of dist) {
      const [x, y] = k.split(",").map(Number) as [number, number];
      if (tileAt(world, "underground", x, y)?.terrain === "water" && (!best || d < best.d)) best = { x, y, d };
    }
    return best;
  };
  const nearestFood = () => {
    const dist = walkDistances(world, "underground", me.pos);
    let best: { x: number; y: number; d: number } | undefined;
    for (const [k, d] of dist) {
      const [x, y] = k.split(",").map(Number) as [number, number];
      if (harvestableAt(world, "underground", { x, y }).includes("food") && (!best || d < best.d)) best = { x, y, d };
    }
    return best;
  };
  const upkeep = () => {
    // Direct ask from the M6 round: "Wait should recover [energy]." A bot
    // that only ever walks never rests — energy hits 0 in well under a
    // level's own width, and exhaustion at 0 energy is real HP damage
    // (traced live: seed 20260903 died at depth 1, no predators present
    // at all, purely from marching non-stop). A real player would rest;
    // so does this bot.
    if (me.needs.energy < 0.3) {
      let waited = 0;
      while (me.needs.energy < 0.8 && waited++ < 40 && findPlayer(world)) act({ kind: "wait" });
    }
    if (me.needs.thirst < 0.5) {
      const w = nearestWater();
      if (w && w.d < 30) {
        while (cheb(me.pos, w) > 1 && findPlayer(world)) act(toward(world, walkDistances(world, "underground", w), me));
        if (findPlayer(world)) act({ kind: "drink" });
      }
    }
    if (me.needs.hunger < 0.5 && countOf(me, "food") > 0) act({ kind: "eat" });
  };

  const hpAtEachLevel: number[] = [me.hp ?? 0];
  for (let depth = 1; depth <= CAVE_RUN_DEPTH && findPlayer(world); depth++) {
    const target = depth < CAVE_RUN_DEPTH ? world.stairsDownAt! : world.exitAt!;
    let n = 0;
    while (n++ < BUDGET_PER_LEVEL && findPlayer(world) && cheb(me.pos, target) > 0) {
      const threat = adjacentPredator(world, me);
      if (threat) {
        encountersPerDepth.set(depth, (encountersPerDepth.get(depth) ?? 0) + 1);
        act({ kind: "attack", dx: Math.sign(threat.pos.x - me.pos.x) as -1 | 0 | 1, dy: Math.sign(threat.pos.y - me.pos.y) as -1 | 0 | 1 });
      } else {
        if (n % 5 === 0) upkeep();
        if (!findPlayer(world)) break;
        act(toward(world, walkDistances(world, "underground", target), me));
      }
    }
    if (!findPlayer(world)) {
      diedAtDepth = depth;
      deathsPerDepth.set(depth, (deathsPerDepth.get(depth) ?? 0) + 1);
      break;
    }
    hpAtEachLevel.push(Math.round((me.hp ?? 0) * 10) / 10);
    if (depth < CAVE_RUN_DEPTH) {
      const next = useStairs(world, me, log);
      if (!next) {
        console.log(`  (seed ${seed}: stuck at depth ${depth}, no stairs reached — budget too small or a real bug)`);
        break;
      }
      world = next;
    } else if (isAtExit(world, me)) {
      emerged++;
    }
  }

  const outcome = diedAtDepth ? `died at depth ${diedAtDepth}` : isAtExit(world, me) ? "emerged" : "ran out of budget";
  console.log(`${seed}`.padEnd(10) + outcome.padEnd(21) + `${diedAtDepth ?? "-"}`.padEnd(13) + `${ticks}`.padEnd(7) + hpAtEachLevel.join(" -> "));
}

console.log("\nDeaths by depth (of 5 seeds):");
for (const [depth, deaths] of deathsPerDepth) console.log(`  depth ${depth}: ${deaths}/5`);
console.log("\nMelee encounters (adjacent-predator attack turns) by depth, summed over 5 seeds:");
for (const [depth, count] of encountersPerDepth) console.log(`  depth ${depth}: ${count}`);
console.log(`\nEmerged: ${emerged}/5`);
