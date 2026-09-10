/**
 * ROADMAP.md M5's acceptance — "you light a torch and the world doubles in
 * size" — as a number, on the real cave, 5 seeds. A greedy bot walks to
 * the nearest tile that yields both lichen and deadwood, gathers twice,
 * makes fiber then a torch, holds it, and we count visible tiles before
 * and after. Also reports keys to the first torch.
 *
 *   pnpm --filter @pokuelike/runner exec tsx src/validateTorch.ts
 */
import { advancePlayerTurn, findPlayer, harvestableAt, countOf, GATHER_TURNS, tileAt, type PlayerAction, type World } from "@pokuelike/engine";
import { createCaveScenario, walkDistances, RECIPES } from "@pokuelike/data";

const SEEDS = [20260903, 11, 202, 3003, 40404];
const steps = [-1, 0, 1] as const;

function toward(world: World, dist: Map<string, number>): PlayerAction {
  const me = findPlayer(world)!;
  let best: { dx: -1 | 0 | 1; dy: -1 | 0 | 1; d: number } | undefined;
  for (const dy of steps)
    for (const dx of steps) {
      if (!dx && !dy) continue;
      const d = dist.get(`${me.pos.x + dx},${me.pos.y + dy}`);
      if (d !== undefined && (!best || d < best.d)) best = { dx, dy, d };
    }
  return best ? { kind: "move", dx: best.dx, dy: best.dy } : { kind: "wait" };
}

console.log("seed      spot     keysToSpot  gathers  keysToTorch  darkStowed  darkHeld  ratio");
for (const seed of SEEDS) {
  const world = createCaveScenario(seed);
  const me = findPlayer(world)!;
  const spawn = { x: me.pos.x, y: me.pos.y };
  const from = walkDistances(world, "underground", me.pos);
  let spot: { x: number; y: number; d: number } | undefined;
  for (const [k, d] of from) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (!tileAt(world, "underground", x, y)?.walkable) continue;
    const ys = harvestableAt(world, "underground", { x, y });
    if (ys.includes("lichen") && ys.includes("deadwood") && (!spot || d < spot.d)) spot = { x, y, d };
  }
  if (!spot) {
    console.log(`${seed}: no tile yields both lichen and deadwood`);
    continue;
  }
  const dist = walkDistances(world, "underground", spot);
  let keys = 0;
  while (keys < 200 && (me.pos.x !== spot.x || me.pos.y !== spot.y)) {
    advancePlayerTurn(world, toward(world, dist));
    keys++;
  }
  const keysToSpot = keys;
  let gathers = 0;
  let refusals = 0;
  while (keys < 400 && (countOf(me, "lichen") < 1 || countOf(me, "deadwood") < 1)) {
    advancePlayerTurn(world, { kind: "gather" });
    if (!me.activity) {
      // The tile changed under the bot (seed 202: a berry patch grew over
      // it between planning and arrival). Re-plan from where we stand.
      console.log(`  ${seed}: gather refused at (${me.pos.x},${me.pos.y}) terrain=${tileAt(world, "underground", me.pos.x, me.pos.y)?.terrain} yields=${harvestableAt(world, "underground", me.pos)} — re-finding a spot`);
      if (++refusals > 3) break;
      const here = walkDistances(world, "underground", me.pos);
      let next: { x: number; y: number; d: number } | undefined;
      for (const [k, d] of here) {
        const [x, y] = k.split(",").map(Number) as [number, number];
        const ys = harvestableAt(world, "underground", { x, y });
        if (ys.includes("lichen") && ys.includes("deadwood") && (!next || d < next.d)) next = { x, y, d };
      }
      if (!next) break;
      const d2 = walkDistances(world, "underground", next);
      let k2 = 0;
      while (k2++ < 60 && (me.pos.x !== next.x || me.pos.y !== next.y)) advancePlayerTurn(world, toward(world, d2));
      keys += k2;
      continue;
    }
    for (let i = 0; i < GATHER_TURNS; i++) advancePlayerTurn(world, { kind: "continue" });
    keys += 1 + GATHER_TURNS;
    gathers++;
  }
  const craft = (id: string) => {
    advancePlayerTurn(world, { kind: "craft", recipeId: id });
    for (let i = 0; i < RECIPES[id]!.turns; i++) advancePlayerTurn(world, { kind: "continue" });
    keys += 1 + RECIPES[id]!.turns;
  };
  craft("fiber");
  craft("torch");
  advancePlayerTurn(world, { kind: "equip", itemKey: "torch" });
  keys++;
  // The spot is in the lit chamber (deadwood only grows near sunbeams), so
  // "the world doubles" has to be measured back in the dark — all the way
  // back at spawn, out of the chamber's far-lit range, then stowed vs held.
  const back = walkDistances(world, "underground", spawn);
  let steps = 0;
  while (steps < 80 && (me.pos.x !== spawn.x || me.pos.y !== spawn.y)) {
    advancePlayerTurn(world, toward(world, back));
    steps++;
  }
  advancePlayerTurn(world, { kind: "stow" });
  const darkVisible = me.vision!.visible.size;
  advancePlayerTurn(world, { kind: "equip", itemKey: "torch" });
  const torchVisible = me.vision!.visible.size;
  console.log(
    `${String(seed).padEnd(9)} ${`(${spot.x},${spot.y})`.padEnd(8)} ${String(keysToSpot).padEnd(11)} ${String(gathers).padEnd(8)} ${String(keys).padEnd(12)} ${String(darkVisible).padEnd(12)} ${String(torchVisible).padEnd(13)} ${(torchVisible / darkVisible).toFixed(2)}${me.equipment?.held === "torch" ? "" : "  (NO TORCH)"}`
  );
}
