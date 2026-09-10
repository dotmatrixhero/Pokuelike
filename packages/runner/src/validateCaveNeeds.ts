/**
 * ROADMAP.md M3 — is the cave survivable at all? From spawn, walk to the
 * chamber, then eat and drink there. Reports food/water in the chamber,
 * whether the player can stand on a food tile and reach water, and how
 * many ticks one meal and one drink buy. Also the blind case: how long a
 * player who only waits lasts.
 *
 *   pnpm --filter @pokuelike/runner exec tsx src/validateCaveNeeds.ts
 */
import { advancePlayerTurn, findPlayer, foodUnderfoot, tileAt, waterWithinReach, EventLog, type PlayerAction } from "@pokuelike/engine";
import { createCaveScenario, walkDistances } from "@pokuelike/data";

const SEEDS = [20260903, 11, 202, 3003, 40404];
const steps = [-1, 0, 1] as const;

function toward(world: ReturnType<typeof createCaveScenario>, dist: Map<string, number>): PlayerAction {
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

function tilesOf(world: ReturnType<typeof createCaveScenario>, terrain: string) {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) if (tileAt(world, "underground", x, y)?.terrain === terrain) out.push({ x, y });
  return out;
}

console.log("seed      food  water  keysToFood  ateOk  hungerAfter  keysToWater  drankOk  thirstAfter  waitOnlyDeathTick");
for (const seed of SEEDS) {
  const world = createCaveScenario(seed);
  const me = findPlayer(world)!;
  const log = new EventLog();
  const food = tilesOf(world, "food");
  const water = tilesOf(world, "water");
  // Walk to the nearest food tile (greedy along BFS from all food).
  let dist = new Map<string, number>();
  for (const f of food) for (const [k, v] of walkDistances(world, "underground", f)) if (v < (dist.get(k) ?? Infinity)) dist.set(k, v);
  let keys = 0;
  while (keys < 120 && !foodUnderfoot(world, me)) { advancePlayerTurn(world, toward(world, dist), log); keys++; }
  const keysToFood = keys;
  const hungerBefore = me.needs.hunger;
  advancePlayerTurn(world, { kind: "eat" }, log);
  const ateOk = me.lastActionOutcome?.ok;
  const hungerAfter = me.needs.hunger;
  // Then to water.
  dist = new Map();
  for (const w of water) for (const [k, v] of walkDistances(world, "underground", w)) if (v < (dist.get(k) ?? Infinity)) dist.set(k, v);
  keys = 0;
  while (keys < 120 && !waterWithinReach(world, me)) { advancePlayerTurn(world, toward(world, dist), log); keys++; }
  const keysToWater = keys;
  advancePlayerTurn(world, { kind: "drink" }, log);
  const drankOk = me.lastActionOutcome?.ok;
  const thirstAfter = me.needs.thirst;
  // Blind control: a fresh world, wait only.
  const blind = createCaveScenario(seed);
  const blindLog = new EventLog();
  let t = 0;
  while (findPlayer(blind) && t < 20000) t += advancePlayerTurn(blind, { kind: "wait" }, blindLog);
  const death = blindLog.events.find((e) => e.kind === "starved" && e.agentId === "player");
  console.log(
    `${String(seed).padEnd(9)} ${String(food.length).padEnd(5)} ${String(water.length).padEnd(6)} ${String(keysToFood).padEnd(11)} ${String(ateOk).padEnd(6)} ${hungerBefore.toFixed(2)}->${hungerAfter.toFixed(2)}   ${String(keysToWater).padEnd(12)} ${String(drankOk).padEnd(8)} ${thirstAfter.toFixed(2)}         ${blind.tick} (${death && death.kind === "starved" ? death.cause : "alive?"})`
  );
}
