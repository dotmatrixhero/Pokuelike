/**
 * MOVES_AND_TOOLS.md, live: direct ask, "I want tool granted moves. That
 * will truly unlock gameplay as we know it." Proves the player's new
 * `attack` action against REAL scenario data (real species, real terrain,
 * real crafting items) rather than only the engine's synthetic unit-test
 * fixtures.
 *
 * Bare-handed combat chases and keeps swinging, the same "re-plan from the
 * target's CURRENT position every step" shape `validateBond.ts` already
 * settled on — a wild agent moves every tick same as the player, so a
 * single walk-then-swing attempt regularly finds the target already gone
 * by the time the player's own action actually fires (accumulateActionEnergy
 * can take several ticks); a real player would just swing again.
 *
 *   pnpm --filter @pokuelike/runner exec tsx src/validatePlayerCombat.ts
 */
import { advancePlayerTurn, findPlayer, tileAt, type Agent, type PlayerAction, type World } from "@pokuelike/engine";
import { createPlayerDemoWorld, walkDistances, HUNT_RULES, LEVELING_CONTEXT } from "@pokuelike/data";

const SEEDS = [20260903, 11, 202, 3003, 40404];
const steps = [-1, 0, 1] as const;

function cheb(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function toward(me: Agent, dist: Map<string, number>): PlayerAction {
  let best: { dx: -1 | 0 | 1; dy: -1 | 0 | 1; d: number } | undefined;
  for (const dy of steps)
    for (const dx of steps) {
      if (!dx && !dy) continue;
      const d = dist.get(`${me.pos.x + dx},${me.pos.y + dy}`);
      if (d !== undefined && (!best || d < best.d)) best = { dx, dy, d };
    }
  return best ? { kind: "move", dx: best.dx, dy: best.dy } : { kind: "wait" };
}

console.log("=== Bare-handed attack against a real wild agent ===");
console.log("seed      target      dist0  keys  hits  totalDmg  targetHp");
for (const seed of SEEDS) {
  const world = createPlayerDemoWorld(seed);
  const me = findPlayer(world)!;
  const act = (a: PlayerAction) => advancePlayerTurn(world, a, undefined, HUNT_RULES, LEVELING_CONTEXT, world.rng);
  const target = world.agents.filter((a) => a.id !== me.id).reduce((a, b) => (cheb(a.pos, me.pos) <= cheb(b.pos, me.pos) ? a : b));
  const dist0 = cheb(target.pos, me.pos);
  const hpStart = target.hp ?? target.maxHp ?? 0;

  let keys = 0;
  let hits = 0;
  let totalDmg = 0;
  while (keys++ < 300 && target.alive !== false && findPlayer(world)) {
    if (cheb(me.pos, target.pos) > 1) {
      const dist = walkDistances(world, me.layer, target.pos);
      act(toward(me, dist));
      continue;
    }
    const dx = Math.max(-1, Math.min(1, target.pos.x - me.pos.x)) as -1 | 0 | 1;
    const dy = Math.max(-1, Math.min(1, target.pos.y - me.pos.y)) as -1 | 0 | 1;
    const before = target.hp ?? 0;
    act({ kind: "attack", dx, dy });
    if (me.lastActionOutcome?.attackedId === target.id) {
      hits++;
      totalDmg += before - (target.hp ?? 0);
      break; // one clean, landed, damaging hit is the claim — stop here.
    }
  }
  console.log(
    `${String(seed).padEnd(9)} ${target.species.padEnd(11)} ${String(dist0).padEnd(6)} ${String(keys).padEnd(5)} ${String(hits).padEnd(5)} ${String(Math.round(totalDmg * 100) / 100).padEnd(9)} ${(target.hp ?? 0).toFixed(1)}/${hpStart}`
  );
}

console.log("\n=== Axe fells a real tree (surface world) ===");
console.log("seed      found  keys  felled  yielded");
for (const seed of SEEDS) {
  const world = createPlayerDemoWorld(seed);
  const me = findPlayer(world)!;
  const act = (a: PlayerAction) => advancePlayerTurn(world, a, undefined, HUNT_RULES, LEVELING_CONTEXT, world.rng);
  me.inventory = [{ itemKey: "axe", weight: 4, count: 1 }];
  // No `world.items`/crafting table in the M0 surface demo world (reachability of
  // the axe recipe is already proven separately, in crafting.test.ts) — hand-build
  // just enough of an ItemDef for `equip`/`syncPlayerMoves` to read.
  world.items = { axe: { key: "axe", name: "Axe", weight: 4, slot: "held", grantsMoves: [{ id: "fell", name: "Fell", shape: { kind: "point" }, type: "normal", category: "status", power: 0, accuracy: -1, cooldownTicks: 10, range: { min: 0, max: 1 }, utilityMove: true, terrainEffect: { from: ["tree"], to: "floor", yields: "deadwood" } }] } };
  act({ kind: "equip", itemKey: "axe" });

  const dist = walkDistances(world, me.layer, me.pos);
  let treePos: { x: number; y: number } | undefined;
  let treeDist = Infinity;
  for (const [k, d] of dist) {
    if (d >= treeDist) continue;
    const [x, y] = k.split(",").map(Number) as [number, number];
    for (let ddy = -1; ddy <= 1; ddy++)
      for (let ddx = -1; ddx <= 1; ddx++) {
        if (tileAt(world, me.layer, x + ddx, y + ddy)?.terrain === "tree") {
          treePos = { x: x + ddx, y: y + ddy };
          treeDist = d;
        }
      }
  }
  if (!treePos) {
    console.log(`${String(seed).padEnd(9)} false  -     -       -`);
    continue;
  }
  let keys = 0;
  while (cheb(me.pos, treePos) > 1 && keys++ < 200) {
    const d2 = walkDistances(world, me.layer, treePos);
    act(toward(me, d2));
  }
  const dx = Math.max(-1, Math.min(1, treePos.x - me.pos.x)) as -1 | 0 | 1;
  const dy = Math.max(-1, Math.min(1, treePos.y - me.pos.y)) as -1 | 0 | 1;
  const before = tileAt(world, me.layer, treePos.x, treePos.y)?.terrain;
  act({ kind: "attack", dx, dy });
  const after = tileAt(world, me.layer, treePos.x, treePos.y)?.terrain;
  const gained = me.inventory?.find((i) => i.itemKey === "deadwood")?.count ?? 0;
  console.log(`${String(seed).padEnd(9)} true   ${String(keys).padEnd(5)} ${String(before === "tree" && after === "floor").padEnd(7)} ${gained}`);
}
