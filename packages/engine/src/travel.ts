import type { Agent, PlayerAction, Vec2, World } from "./types.js";
import { canStepTo } from "./movement.js";
import { exploredTiles, tileIndex } from "./vision.js";

/**
 * Tap-to-walk — direct ask: "I can't play at all on mobile. Can you allow a
 * click based control scheme?"
 *
 * The player taps a tile; this plans one step of the way there and the UI
 * takes it as an ordinary `move` turn, then asks again. Planning is a BFS
 * over the tiles the player *knows* — seen now or remembered — through
 * `canStepTo`, the same predicate every step already goes through. Unknown
 * tiles are not walked through: you cannot path through the dark you have
 * never seen, only into it one step at a time. Re-planned every step so a
 * Sandshrew stepping into the corridor is walked around, not into.
 *
 * Interruption (stopping when something new comes into view) is the UI's
 * job: it owns the loop. `visibleAgentIds` is the helper for it.
 */

const STEPS: readonly (readonly [-1 | 0 | 1, -1 | 0 | 1])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

/** Tiles the player has seen at some point on this world's current layer, or sees now. */
function knownTiles(world: World, agent: Agent): Set<number> | undefined {
  const v = agent.vision;
  if (!v) return undefined;
  const known = new Set(exploredTiles(world, agent) ?? []);
  for (const i of v.visible) known.add(i);
  return known;
}

/**
 * The first step of the shortest known path from the player to `target`,
 * or undefined when there is none (target unknown, unreachable, or the
 * player is already there). A target the player cannot stand on (a wall,
 * an occupied tile) still gets a path to the nearest tile beside it.
 */
export function nextTravelStep(world: World, agent: Agent, target: Vec2): PlayerAction | undefined {
  if (target.x === agent.pos.x && target.y === agent.pos.y) return undefined;
  const known = knownTiles(world, agent);
  if (!known || !known.has(tileIndex(world, target.x, target.y))) return undefined;

  // BFS from the target back to the player so the first step falls out of
  // the parent map directly, no path reversal needed.
  const goalIdx = tileIndex(world, target.x, target.y);
  const standable = canStepTo(world, agent, agent.layer, target, agent);
  const parent = new Map<number, number>();
  const queue: Vec2[] = [];
  const seen = new Set<number>();
  if (standable) {
    queue.push(target);
    seen.add(goalIdx);
  } else {
    // Seed with the target's known, steppable neighbours instead.
    for (const [dx, dy] of STEPS) {
      const n = { x: target.x + dx, y: target.y + dy };
      const ni = tileIndex(world, n.x, n.y);
      if (!known.has(ni) || !canStepTo(world, agent, agent.layer, n, agent)) continue;
      queue.push(n);
      seen.add(ni);
    }
  }
  const startIdx = tileIndex(world, agent.pos.x, agent.pos.y);
  while (queue.length) {
    const cur = queue.shift()!;
    const curIdx = tileIndex(world, cur.x, cur.y);
    for (const [dx, dy] of STEPS) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (n.x < 0 || n.y < 0 || n.x >= world.width || n.y >= world.height) continue;
      const ni = tileIndex(world, n.x, n.y);
      if (seen.has(ni)) continue;
      if (ni === startIdx) {
        // cur is the tile to step onto next.
        const sx = Math.sign(cur.x - agent.pos.x) as -1 | 0 | 1;
        const sy = Math.sign(cur.y - agent.pos.y) as -1 | 0 | 1;
        return { kind: "move", dx: sx, dy: sy };
      }
      if (!known.has(ni) || !canStepTo(world, agent, agent.layer, n, agent)) continue;
      seen.add(ni);
      parent.set(ni, curIdx);
      queue.push(n);
    }
  }
  return undefined;
}

/** Ids of living agents the player can currently see, for the UI's "something new came into view" stop rule. */
export function visibleAgentIds(world: World, agent: Agent): Set<string> {
  const out = new Set<string>();
  const v = agent.vision;
  if (!v) return out;
  for (const a of world.agents) {
    if (a.id === agent.id || a.layer !== agent.layer || a.alive === false) continue;
    if (v.visible.has(tileIndex(world, a.pos.x, a.pos.y))) out.add(a.id);
  }
  return out;
}
