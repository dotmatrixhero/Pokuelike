import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyStandingOrder, PATROL_RADIUS, DEFEND_RADIUS, HUNT_ORDER_RADIUS } from "../src/needs.js";
import { applyPlayerAction } from "../src/player.js";
import type { Agent, MoveSpec, World } from "../src/types.js";

/**
 * Direct ask: "perhaps instead of campfire building, there's a command
 * button that allows you to set behaviors for each of your allies;
 * patrol, hunt, defend, etc." Scoped to "Simple standing states" (the
 * user's own choice between options offered): a persistent mode a bonded
 * follower keeps until told otherwise, no placed guard points or patrol
 * routes.
 */

function human(x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    maxHp: 20,
    hp: 20,
    ...extra,
  };
}

function partner(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "sandshrew",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    followingId: "me",
    types: ["ground"],
    maxHp: 40,
    hp: 40,
    stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
    moves: [CLAW],
    ...extra,
  };
}

function foe(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "rattata",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    types: ["normal"],
    maxHp: 10,
    hp: 10,
    stats: { hp: 10, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 10 },
    ...extra,
  };
}

const CLAW: MoveSpec = {
  id: "test_claw",
  name: "Claw",
  shape: { kind: "point" },
  type: "ground",
  category: "physical",
  power: 40,
  accuracy: -1,
  cooldownTicks: 4,
  range: { min: 0, max: 1 },
};

function openWorld(): World {
  return createWorld(30, 30, 1);
}

describe('Direct ask: "a command button that allows you to set behaviors for each of your allies" — issuing the order', () => {
  it("setStandingOrder sets Agent.standingOrder on a bonded follower", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 11);
    world.agents.push(me, s);
    expect(applyPlayerAction(world, me, { kind: "setStandingOrder", agentId: "s", order: "hunt" })).toBe(true);
    expect(s.standingOrder).toBe("hunt");
  });

  it('"follow" clears the standing order back to undefined (ordinary passive following)', () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 11, { standingOrder: "patrol", huntTarget: "stale" });
    world.agents.push(me, s);
    expect(applyPlayerAction(world, me, { kind: "setStandingOrder", agentId: "s", order: "follow" })).toBe(true);
    expect(s.standingOrder).toBeUndefined();
    expect(s.huntTarget).toBeUndefined();
  });

  it("fails on a non-follower", () => {
    const world = openWorld();
    const me = human(10, 10);
    const stranger = partner("stranger", 10, 11, { followingId: undefined });
    world.agents.push(me, stranger);
    expect(applyPlayerAction(world, me, { kind: "setStandingOrder", agentId: "stranger", order: "hunt" })).toBe(false);
  });
});

describe("needs.ts: applyStandingOrder — patrol", () => {
  it("stays within PATROL_RADIUS rather than tailing the leader tightly", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 10, { standingOrder: "patrol" });
    world.agents.push(me, s);
    expect(applyStandingOrder(world, s, undefined, undefined, () => 0.99)).toBe(true); // high roll — no wander step this tick
    expect(s.pos).toEqual({ x: 10, y: 10 }); // already adjacent to leader, well within radius — stands
  });

  it("steps back toward the leader once beyond PATROL_RADIUS", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 10 + PATROL_RADIUS + 3, { standingOrder: "patrol" });
    world.agents.push(me, s);
    const before = s.pos.y;
    expect(applyStandingOrder(world, s, undefined, undefined, () => 0.99)).toBe(true);
    expect(s.pos.y).toBeLessThan(before);
  });

  it("clears the order and yields when the leader is gone", () => {
    const world = openWorld();
    const s = partner("s", 10, 10, { standingOrder: "patrol", followingId: "nobody" });
    world.agents.push(s);
    expect(applyStandingOrder(world, s, undefined, undefined, Math.random)).toBe(false);
    expect(s.standingOrder).toBeUndefined();
  });

  it("yields to an urgent need instead of patrolling", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 11, { standingOrder: "patrol", needs: createNeeds({ hunger: 0.05 }) });
    world.agents.push(me, s);
    expect(applyStandingOrder(world, s, undefined, undefined, Math.random)).toBe(false);
  });
});

describe("needs.ts: applyStandingOrder — hunt", () => {
  it("engages a weak nearby target within HUNT_ORDER_RADIUS, regardless of the ally's own hunger", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 10, { standingOrder: "hunt", needs: createNeeds({ hunger: 1 }) }); // NOT hungry
    const f = foe("f", 11, 10);
    world.agents.push(me, s, f);
    const before = f.hp;
    expect(applyStandingOrder(world, s, undefined, undefined, () => 0.01)).toBe(true);
    expect(f.hp).toBeLessThan(before!);
    expect(s.huntTarget).toBe("f");
  });

  it("does not engage something far stronger than itself (STANDING_ORDER_POWER_RATIO)", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 10, { standingOrder: "hunt" });
    const strong = foe("strong", 11, 10, { maxHp: 999, hp: 999 });
    world.agents.push(me, s, strong);
    expect(applyStandingOrder(world, s, undefined, undefined, () => 0.01)).toBe(true); // wanders instead
    expect(strong.hp).toBe(999); // untouched
    expect(s.huntTarget).toBeUndefined();
  });

  it("never targets a herd-mate (another follower of the same leader)", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 10, { standingOrder: "hunt" });
    const herdmate = partner("herdmate", 11, 10, { maxHp: 5, hp: 5, stats: { hp: 5, attack: 5, defense: 5, spAttack: 5, spDefense: 5, speed: 5 } });
    world.agents.push(me, s, herdmate);
    expect(applyStandingOrder(world, s, undefined, undefined, () => 0.01)).toBe(true);
    expect(herdmate.hp).toBe(5); // untouched — not a valid target
  });

  it("chases the same tracked target across ticks until it dies", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 10, { standingOrder: "hunt" });
    const f = foe("f", 12, 10); // 2 tiles away — first tick paths in, doesn't land a hit yet
    world.agents.push(me, s, f);
    applyStandingOrder(world, s, undefined, undefined, () => 0.01);
    expect(s.huntTarget).toBe("f");
    expect(s.pos.x).toBeGreaterThan(10); // stepped toward it
  });

  it("nothing within reach — wanders instead of standing frozen", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 10 + PATROL_RADIUS + 3, { standingOrder: "hunt" });
    world.agents.push(me, s);
    const before = s.pos.y;
    expect(applyStandingOrder(world, s, undefined, undefined, () => 0.01)).toBe(true);
    expect(s.pos.y).toBeLessThan(before); // stepped back toward leader, out of patrol radius
  });
});

describe("needs.ts: applyStandingOrder — defend", () => {
  it("engages a weak target near the LEADER even if it's not adjacent to the ally itself", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 12, 12, { standingOrder: "defend" }); // ally is a bit away from the leader
    const f = foe("f", 11, 10); // adjacent to the LEADER, not the ally
    world.agents.push(me, s, f);
    expect(applyStandingOrder(world, s, undefined, undefined, () => 0.01)).toBe(true);
    expect(s.huntTarget).toBe("f");
  });

  it("ignores a weak target beyond DEFEND_RADIUS of the leader", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 10, { standingOrder: "defend" });
    const f = foe("f", 10, 10 + DEFEND_RADIUS + 2);
    world.agents.push(me, s, f);
    expect(applyStandingOrder(world, s, undefined, undefined, () => 0.01)).toBe(true);
    expect(f.hp).toBe(10); // untouched — out of defend range
  });

  it("stays close to the leader (tighter than patrol) when nothing to defend against", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = partner("s", 10, 15, { standingOrder: "defend" });
    const before = s.pos.y;
    world.agents.push(me, s);
    expect(applyStandingOrder(world, s, undefined, undefined, Math.random)).toBe(true);
    expect(s.pos.y).toBeLessThan(before);
  });
});

// Sanity: HUNT_ORDER_RADIUS is at least as wide as PATROL_RADIUS/DEFEND_RADIUS — a hunting ally should search at least as far as it wanders.
describe("standing-order radii", () => {
  it("HUNT_ORDER_RADIUS is the widest detection radius", () => {
    expect(HUNT_ORDER_RADIUS).toBeGreaterThanOrEqual(PATROL_RADIUS);
    expect(HUNT_ORDER_RADIUS).toBeGreaterThanOrEqual(DEFEND_RADIUS);
  });
});
