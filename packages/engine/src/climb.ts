import type { Agent, World } from "./types.js";
import type { EventLog } from "./events.js";
import { tileAt } from "./world.js";

/**
 * ROADMAP.md M7 Climb — "Multiple cave layers and transitions between
 * them... Done when: you emerge." Direct ask, once the design question got
 * simple again after a scoping tangent: "i think i just want to be able to
 * move to the next level of the cave and shit."
 *
 * Each cave level is a full, independent `World` (see types.ts's `World.
 * below`/`above` doc comment for why — the chained-worlds architecture over
 * widening `Layer`). Crossing is not automatic on stepping onto a stairs
 * tile (same "terrain is just terrain" split as "food" not auto-eating) —
 * the caller (`main.ts`) calls this when the player deliberately uses the
 * stairs, then re-points its own `world` reference to whatever this
 * returns, the same dance it already does for the macro grid's `focusZone`.
 */
export function useStairs(world: World, agent: Agent, log?: EventLog): World | undefined {
  const tile = tileAt(world, agent.layer, agent.pos.x, agent.pos.y);
  if (tile?.terrain === "stairsDown" && world.below && world.below.stairsUpAt) {
    return crossLevel(world, world.below, agent, world.below.stairsUpAt, "down", log);
  }
  if (tile?.terrain === "stairsUp" && world.above && world.above.stairsDownAt) {
    return crossLevel(world, world.above, agent, world.above.stairsDownAt, "up", log);
  }
  return undefined;
}

/**
 * Direct report: "Units in party do not follow past stairs." They didn't —
 * `crossLevel` used to move exactly one agent, so the party was left standing
 * on the level above. Worse than merely being left behind: `needs.ts`'s
 * `applyFollowing` drops `followingId` the moment the leader isn't in the same
 * `world.agents` array, so the bond itself was quietly destroyed by the
 * crossing. A bond you spent the run earning should not be deletable by a
 * staircase.
 *
 * Every living bonded follower crosses, regardless of how far behind it was
 * standing. Distance-gating reads more diegetic, but its failure mode is
 * silent permanent party loss — the follower that happened to be four tiles
 * back when you pressed `>` is gone and nothing tells you why.
 */
function followersOf(world: World, agent: Agent): Agent[] {
  return world.agents.filter((a) => a !== agent && a.followingId === agent.id && a.alive !== false && !a.isEgg && a.layer === agent.layer);
}

/**
 * Nearest walkable tile to `landAt` with nobody living already on it, so a
 * party of three doesn't stack onto the stairs tile. Local rather than
 * worldgen.ts's `findWalkableNear` because this one also has to dodge
 * occupants, and because climb.ts deliberately depends on world.ts alone.
 */
function freeTileNear(world: World, layer: Agent["layer"], landAt: { x: number; y: number }, taken: Set<string>): { x: number; y: number } {
  const maxRadius = Math.max(world.width, world.height);
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = landAt.x + dx;
        const y = landAt.y + dy;
        if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
        if (taken.has(`${x},${y}`)) continue;
        if (tileAt(world, layer, x, y)?.walkable !== true) continue;
        if (world.agents.some((a) => a.alive !== false && a.layer === layer && a.pos.x === x && a.pos.y === y)) continue;
        return { x, y };
      }
    }
  }
  return { ...landAt };
}

function crossLevel(from: World, to: World, agent: Agent, landAt: { x: number; y: number }, direction: "down" | "up", log?: EventLog): World {
  const party = followersOf(from, agent);
  const crossing = new Set<Agent>([agent, ...party]);
  from.agents = from.agents.filter((a) => !crossing.has(a));

  agent.pos = { ...landAt };
  to.agents.push(agent);

  const taken = new Set<string>([`${landAt.x},${landAt.y}`]);
  for (const follower of party) {
    const spot = freeTileNear(to, agent.layer, landAt, taken);
    taken.add(`${spot.x},${spot.y}`);
    follower.pos = spot;
    follower.layer = agent.layer;
    to.agents.push(follower);
  }

  for (const who of [agent, ...party]) {
    log?.record({
      kind: "crossedCaveLevel",
      tick: to.tick,
      agentId: who.id,
      species: who.species,
      fromDepth: from.depth ?? 0,
      toDepth: to.depth ?? 0,
      direction,
    });
  }
  return to;
}

/** True once the agent has actually stepped onto the deepest level's exit tile. See types.ts's `World.exitAt`. */
export function isAtExit(world: World, agent: Agent): boolean {
  return tileAt(world, agent.layer, agent.pos.x, agent.pos.y)?.terrain === "exit";
}

/** Records the win moment once, for narration — call right after `isAtExit` confirms it. */
export function recordEmerged(world: World, agent: Agent, log?: EventLog): void {
  log?.record({ kind: "emerged", tick: world.tick, agentId: agent.id, species: agent.species, depth: world.depth ?? 0 });
}
