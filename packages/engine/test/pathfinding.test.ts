import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { findPath, stepAlongPath, stepTowardMovingTarget } from "../src/pathfinding.js";
import type { Agent } from "../src/types.js";

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    species: "test",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...overrides,
  };
}

/** Builds a wall of `tree` tiles spanning x in [x0,x1] at row `y` — a real obstacle cluster, not a single blocked tile. */
function buildWallRow(world: ReturnType<typeof createWorld>, y: number, x0: number, x1: number): void {
  for (let x = x0; x <= x1; x++) setTile(world, "surface", x, y, "tree");
}

describe("findPath", () => {
  it("returns an empty array when already at the target", () => {
    const world = createWorld(10, 10);
    expect(findPath(world, "surface", { x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
  });

  it("returns undefined when the target itself is unwalkable", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "tree");
    expect(findPath(world, "surface", { x: 0, y: 0 }, { x: 5, y: 5 })).toBeUndefined();
  });

  it("finds a straight-line path with no obstacles", () => {
    const world = createWorld(10, 10);
    const path = findPath(world, "surface", { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(path).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it("routes AROUND a real obstacle cluster instead of failing (unlike greedy stepToward)", () => {
    const world = createWorld(12, 12);
    // A solid wall of trees spanning the whole width except one gap, between
    // the agent (above) and the target (below) — greedy Manhattan stepping
    // toward the target walks straight into this wall and can oscillate
    // forever; BFS must route through the one gap.
    buildWallRow(world, 5, 0, 11);
    setTile(world, "surface", 6, 5, "floor"); // the one gap
    const from = { x: 5, y: 2 };
    const to = { x: 5, y: 9 };

    const path = findPath(world, "surface", from, to);

    expect(path).toBeDefined();
    expect(path![path!.length - 1]).toEqual(to);
    // The path must actually pass through the gap tile to get from y<5 to y>5.
    expect(path!.some((p) => p.x === 6 && p.y === 5)).toBe(true);
    // Confirms it isn't just a straight line (which would be blocked).
    expect(path!.some((p) => p.y === 5 && p.x !== 6)).toBe(false);
  });

  it("returns undefined when the target is genuinely unreachable (fully enclosed)", () => {
    const world = createWorld(10, 10);
    // Box the target in on all four sides — no gap anywhere.
    for (let x = 4; x <= 6; x++) {
      setTile(world, "surface", x, 4, "tree");
      setTile(world, "surface", x, 6, "tree");
    }
    setTile(world, "surface", 4, 5, "tree");
    setTile(world, "surface", 6, 5, "tree");

    const path = findPath(world, "surface", { x: 0, y: 0 }, { x: 5, y: 5 });
    expect(path).toBeUndefined();
  });

  it("is deterministic: repeated calls on the same inputs return the identical path", () => {
    const world = createWorld(15, 15);
    buildWallRow(world, 7, 0, 14);
    setTile(world, "surface", 10, 7, "floor");
    const from = { x: 3, y: 3 };
    const to = { x: 3, y: 12 };

    const first = findPath(world, "surface", from, to);
    const second = findPath(world, "surface", from, to);
    expect(second).toEqual(first);
  });
});

describe("stepAlongPath", () => {
  it("takes the first step of a fresh route toward the target", () => {
    const world = createWorld(10, 10);
    const agent = makeAgent({ pos: { x: 0, y: 0 } });
    const next = stepAlongPath(world, agent, { x: 3, y: 0 });
    expect(next).toEqual({ x: 1, y: 0 });
  });

  it("caches the remaining route and consumes it one tick at a time without recomputing", () => {
    const world = createWorld(10, 10);
    const agent = makeAgent({ pos: { x: 0, y: 0 } });
    const target = { x: 4, y: 0 };

    agent.pos = stepAlongPath(world, agent, target);
    expect(agent.pos).toEqual({ x: 1, y: 0 });
    expect(agent.pathCache?.steps.length).toBe(3);

    agent.pos = stepAlongPath(world, agent, target);
    expect(agent.pos).toEqual({ x: 2, y: 0 });
    expect(agent.pathCache?.steps.length).toBe(2);

    agent.pos = stepAlongPath(world, agent, target);
    agent.pos = stepAlongPath(world, agent, target);
    expect(agent.pos).toEqual(target);
    // Route fully consumed — cache cleared, not left dangling with an empty array.
    expect(agent.pathCache).toBeUndefined();
  });

  it("recomputes when the target changes instead of reusing a stale cached route", () => {
    const world = createWorld(10, 10);
    const agent = makeAgent({ pos: { x: 0, y: 0 } });
    agent.pos = stepAlongPath(world, agent, { x: 4, y: 0 });
    expect(agent.pathCache?.target).toEqual({ x: 4, y: 0 });

    const next = stepAlongPath(world, agent, { x: 0, y: 4 });
    // Should now route toward the NEW target (a fresh BFS from the agent's
    // current position), not continue along the old cached route toward
    // (4, 0) — the old route's next step would have been (2, 0).
    expect(next).not.toEqual({ x: 2, y: 0 });
    expect(next).toEqual({ x: 1, y: 1 });
    expect(agent.pathCache?.target).toEqual({ x: 0, y: 4 });
  });

  it("recovers if the cached next step becomes unwalkable mid-walk", () => {
    const world = createWorld(10, 10);
    const agent = makeAgent({ pos: { x: 0, y: 0 } });
    const target = { x: 4, y: 0 };
    agent.pathCache = { layer: "surface", target, steps: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }] };
    setTile(world, "surface", 1, 0, "tree"); // sabotage the cached next step

    const next = stepAlongPath(world, agent, target);
    expect(next).not.toEqual({ x: 1, y: 0 });
    expect(world.tiles.surface[0 * world.width + 1]?.walkable).toBe(false);
  });
});

describe("stepTowardMovingTarget: hunt/mate pursuit of a MOVING target", () => {
  function makeTarget(pos: { x: number; y: number }, id = "prey1"): Agent {
    return makeAgent({ id, pos });
  }

  it("takes a fresh BFS route toward a target it hasn't pursued before", () => {
    const world = createWorld(10, 10);
    const agent = makeAgent({ pos: { x: 0, y: 0 } });
    const target = makeTarget({ x: 3, y: 0 });
    const next = stepTowardMovingTarget(world, agent, target);
    expect(next).toEqual({ x: 1, y: 0 });
    expect(agent.pathCache?.targetId).toBe("prey1");
  });

  it("keeps following the cached route (no recompute) when the target barely moves and the pursuer isn't close yet", () => {
    const world = createWorld(20, 20);
    const agent = makeAgent({ pos: { x: 0, y: 10 } });
    const target = makeTarget({ x: 10, y: 10 });

    agent.pos = stepTowardMovingTarget(world, agent, target);
    const cachedStepsAfterFirst = agent.pathCache?.steps.length;
    expect(cachedStepsAfterFirst).toBe(9); // 10-tile route minus the one step just taken

    // Target drifts by only 1 tile (< PURSUIT_RECOMPUTE_DRIFT_TILES) and the
    // pursuer is still far outside the close-recompute radius — the cached
    // route should just be consumed one more step, not recomputed.
    target.pos = { x: 10, y: 11 };
    agent.pos = stepTowardMovingTarget(world, agent, target);
    expect(agent.pathCache?.steps.length).toBe(cachedStepsAfterFirst! - 1);
  });

  it("recomputes when the target drifts far from where the cached route was aimed", () => {
    const world = createWorld(20, 20);
    const agent = makeAgent({ pos: { x: 0, y: 10 } });
    const target = makeTarget({ x: 10, y: 10 });

    agent.pos = stepTowardMovingTarget(world, agent, target);
    const staleCachedTarget = agent.pathCache!.target;
    expect(staleCachedTarget).toEqual({ x: 10, y: 10 });

    // Target jumps far away (well past PURSUIT_RECOMPUTE_DRIFT_TILES) —
    // the stale route (still aimed at the old position) must be discarded
    // for a fresh one aimed at where the target actually is now.
    target.pos = { x: 10, y: 0 };
    agent.pos = stepTowardMovingTarget(world, agent, target);
    expect(agent.pathCache!.target).toEqual({ x: 10, y: 0 });
    // Fresh route now heads north (toward y=0), not continuing east along
    // the stale row-10 route.
    expect(agent.pos.y).toBeLessThan(10);
  });

  it("recomputes every tick once the pursuer closes to within the close-recompute radius, instead of trusting the cache", () => {
    const world = createWorld(20, 20);
    const agent = makeAgent({ pos: { x: 0, y: 0 } });
    const target = makeTarget({ x: 5, y: 0 });

    // Walk most of the way there first.
    for (let i = 0; i < 3; i++) agent.pos = stepTowardMovingTarget(world, agent, target);
    expect(agent.pos).toEqual({ x: 3, y: 0 });
    // Sabotage the (still-cached, 2-steps-remaining) route's next step so a
    // recompute is the only way to make further progress at all.
    agent.pathCache = { layer: "surface", target: { x: 5, y: 0 }, targetId: target.id, steps: [{ x: 40, y: 40 }] };

    // Now within the close-recompute radius (distance 2) — the target also
    // makes a small dodge. This must recompute fresh (both because it's
    // close-range AND because the sabotaged cached step is bogus) and reach
    // the target's real, updated position, not get stuck on the bad cache.
    target.pos = { x: 5, y: 1 };
    agent.pos = stepTowardMovingTarget(world, agent, target);
    expect(manhattan(agent.pos, target.pos)).toBeLessThan(manhattan({ x: 3, y: 0 }, target.pos));
    expect(agent.pathCache?.target).toEqual({ x: 5, y: 1 });
  });

  it("gives up and falls back to plain greedy stepToward when the target is genuinely unreachable (walled off)", () => {
    const world = createWorld(12, 12);
    for (let x = 4; x <= 6; x++) {
      setTile(world, "surface", x, 4, "tree");
      setTile(world, "surface", x, 6, "tree");
    }
    setTile(world, "surface", 4, 5, "tree");
    setTile(world, "surface", 6, 5, "tree");

    const agent = makeAgent({ pos: { x: 0, y: 0 } });
    const target = makeTarget({ x: 5, y: 5 });

    // findPath would return undefined (target fully enclosed) — this must
    // not freeze the pursuer in place; it should still take a real greedy
    // step, matching the pre-pathfinding hunt/mate behavior.
    const next = stepTowardMovingTarget(world, agent, target);
    expect(next).not.toEqual({ x: 0, y: 0 });
    expect(agent.pathCache).toBeUndefined();
  });

  it("stops pursuing a stale target once the caller passes a different one (target left detection range / died)", () => {
    const world = createWorld(20, 20);
    const agent = makeAgent({ pos: { x: 0, y: 0 } });
    const oldTarget = makeTarget({ x: 10, y: 0 }, "prey-old");
    agent.pos = stepTowardMovingTarget(world, agent, oldTarget);
    expect(agent.pathCache?.targetId).toBe("prey-old");

    // Real call sites (predation.ts/reproduction.ts) re-scan for the nearest
    // eligible target every tick, so a target that's no longer eligible
    // (out of detection range, dead, fainted) simply stops being passed in
    // at all — the very next tick's target is a different agent entirely.
    // The stale cache must not be reused for it.
    const newTarget = makeTarget({ x: 0, y: 15 }, "prey-new");
    const next = stepTowardMovingTarget(world, agent, newTarget);
    expect(agent.pathCache?.targetId).toBe("prey-new");
    expect(next).not.toEqual({ x: 2, y: 0 }); // not continuing the old cached route
  });
});

describe("seekWater/seekFood integration: routes around an obstacle cluster instead of getting stuck", () => {
  it("an agent that would oscillate forever via naive greedy stepping reaches water via real pathfinding", () => {
    const world = createWorld(20, 20);
    // A wall spanning the whole width with a single gap, between the agent
    // and the only water tile — this is the exact shape of the real
    // confirmed death (an Onix stuck oscillating near a boulder cluster on
    // seed 20260903, see DESIGN.md/TODO.md).
    buildWallRow(world, 10, 0, 19);
    setTile(world, "surface", 15, 10, "floor"); // the one gap, far from directly between agent and water
    setTile(world, "surface", 5, 18, "water");

    const agent = makeAgent({
      id: "onix-test",
      species: "onix",
      pos: { x: 5, y: 2 },
      needs: { hunger: 1, thirst: 0.1, energy: 1, mateDrive: 0 },
      behavior: "seekWater",
    });
    world.agents.push(agent);

    let reached = false;
    for (let tick = 0; tick < 500 && !reached; tick++) {
      tickWorld(world);
      if (agent.needs.thirst > 0.1) reached = true; // drank
    }

    expect(reached).toBe(true);
  });
});
