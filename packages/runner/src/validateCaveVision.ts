/**
 * ROADMAP.md M2's acceptance — "you cannot see the chamber until you are in
 * it" — measured on the real cave across seeds, plus the walk: how many
 * turns of blind corridor before the first lit tile comes into view, and
 * how big the visible set is in the dark vs. in the chamber.
 *
 *   pnpm --filter @pokuelike/runner exec tsx src/validateCaveVision.ts
 */
import { advancePlayerTurn, findPlayer, tileAt, tileIndex, type PlayerAction } from "@pokuelike/engine";
import { createCaveScenario, walkDistances } from "@pokuelike/data";

const SEEDS = [20260903, 11, 202, 3003, 40404, 7, 99, 1234];

function litTiles(world: ReturnType<typeof createCaveScenario>) {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) if (tileAt(world, "underground", x, y)?.terrain === "sunbeam") out.push({ x, y });
  return out;
}

/** Greedy step toward the nearest sunbeam along BFS distances — the walk a player would take. */
function stepToward(world: ReturnType<typeof createCaveScenario>, dist: Map<string, number>): PlayerAction {
  const me = findPlayer(world)!;
  const steps = [-1, 0, 1] as const;
  let best: { dx: -1 | 0 | 1; dy: -1 | 0 | 1; d: number } | undefined;
  for (const dy of steps)
    for (const dx of steps) {
      if (!dx && !dy) continue;
      const d = dist.get(`${me.pos.x + dx},${me.pos.y + dy}`);
      if (d !== undefined && (!best || d < best.d)) best = { dx, dy, d };
    }
  return best ? { kind: "move" as const, dx: best.dx, dy: best.dy } : { kind: "wait" as const };
}

console.log("seed      spawn    litAtSpawn  visDark  firstLitSeenAtKey  visInChamber  keysToLight");
for (const seed of SEEDS) {
  const world = createCaveScenario(seed);
  const me = findPlayer(world)!;
  const spawn = `(${me.pos.x},${me.pos.y})`;
  const lit = litTiles(world);
  const isLitVisible = () => lit.some((p) => me.vision!.visible.has(tileIndex(world, p.x, p.y)));
  const litAtSpawn = isLitVisible();
  const visDark = me.vision!.visible.size;
  // BFS from the sunbeam field so greedy descent reaches it.
  const dist = walkDistances(world, "underground", lit[0]!);
  for (const p of lit.slice(1)) {
    const d2 = walkDistances(world, "underground", p);
    for (const [k, v] of d2) if (v < (dist.get(k) ?? Infinity)) dist.set(k, v);
  }
  let firstLit = -1;
  let keys = 0;
  let inChamber = -1;
  while (keys < 80 && tileAt(world, "underground", me.pos.x, me.pos.y)?.terrain !== "sunbeam") {
    advancePlayerTurn(world, stepToward(world, dist));
    keys++;
    if (firstLit < 0 && isLitVisible()) firstLit = keys;
  }
  if (tileAt(world, "underground", me.pos.x, me.pos.y)?.terrain === "sunbeam") inChamber = me.vision!.visible.size;
  console.log(
    `${String(seed).padEnd(9)} ${spawn.padEnd(8)} ${String(litAtSpawn).padEnd(11)} ${String(visDark).padEnd(8)} ${String(firstLit).padEnd(18)} ${String(inChamber).padEnd(13)} ${keys}`
  );
}
