import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { herdCentroid, applyHerdCohesion } from "../src/herding.js";
import type { Agent } from "../src/types.js";

function member(id: string, pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    herdId: "herd-a",
    ...overrides,
  };
}

describe("herdCentroid", () => {
  it("averages the positions of every living member sharing the herdId", () => {
    const world = createWorld(20, 20);
    world.agents.push(member("a", { x: 0, y: 0 }), member("b", { x: 10, y: 0 }), member("c", { x: 5, y: 10 }));

    expect(herdCentroid(world, "herd-a", "surface")).toEqual({ x: 5, y: 3 });
  });

  it("ignores dead members and other herds", () => {
    const world = createWorld(20, 20);
    world.agents.push(
      member("a", { x: 0, y: 0 }),
      member("b", { x: 100, y: 100 }, { alive: false }),
      member("c", { x: 0, y: 0 }, { herdId: "herd-b" })
    );

    expect(herdCentroid(world, "herd-a", "surface")).toEqual({ x: 0, y: 0 });
  });

  it("is undefined for a herdId with no living members", () => {
    const world = createWorld(20, 20);
    expect(herdCentroid(world, "no-such-herd", "surface")).toBeUndefined();
  });
});

describe("applyHerdCohesion", () => {
  it("walks a straggler back toward the herd's center", () => {
    const world = createWorld(20, 20);
    const straggler = member("a", { x: 0, y: 0 });
    world.agents.push(straggler, member("b", { x: 10, y: 0 }), member("c", { x: 10, y: 0 }));

    const moved = applyHerdCohesion(world, straggler);

    expect(moved).toBe(true);
    expect(straggler.pos.x).toBeGreaterThan(0);
  });

  it("does nothing once within the cohesion distance", () => {
    const world = createWorld(20, 20);
    const nearby = member("a", { x: 5, y: 5 });
    world.agents.push(nearby, member("b", { x: 6, y: 5 }));

    const moved = applyHerdCohesion(world, nearby);

    expect(moved).toBe(false);
    expect(nearby.pos).toEqual({ x: 5, y: 5 });
  });

  it("does nothing for an agent with no herdId", () => {
    const world = createWorld(20, 20);
    const loner = member("a", { x: 0, y: 0 }, { herdId: undefined });
    world.agents.push(loner);

    expect(applyHerdCohesion(world, loner)).toBe(false);
  });
});
