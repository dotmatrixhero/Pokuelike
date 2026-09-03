import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { herdCentroid, applyHerdCohesion } from "../src/herding.js";
import type { Agent, HuntRules } from "../src/types.js";

/** Scyther preys on bulbasaur; venusaur is prey of nothing, so it's a guardian in any herd it shares. */
const RULES: HuntRules = { scyther: ["bulbasaur"] };

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

  it("a guardian tracks the prey's centroid, not the whole herd's — regression for its own drift diluting the pull-back signal", () => {
    // Real bug: a guardian's cohesion target used to be the whole herd's
    // (guardian included) blended centroid. With the guardian far from the
    // herd and only one prey member, that blend lands roughly halfway
    // between them — close enough to the guardian's own position that the
    // old whole-herd check considered it "close enough" and never moved it
    // at all, even though the actual prey it's meant to protect was 10
    // tiles away. Confirm the old behavior first, then confirm the fix.
    const world = createWorld(20, 20);
    const guardian = member("guardian", { x: 0, y: 0 }, { species: "venusaur" });
    const prey = member("prey", { x: 10, y: 0 }, { species: "bulbasaur" });
    world.agents.push(guardian, prey);

    // Without rules (or an ordinary member), the whole-herd centroid is
    // (5, 0) — distance 5 from the guardian, right at the ordinary
    // COHESION_DISTANCE boundary, so it doesn't move.
    expect(applyHerdCohesion(world, guardian)).toBe(false);
    expect(guardian.pos).toEqual({ x: 0, y: 0 });

    // With rules, the guardian is recognized as a guardian (nothing preys
    // on venusaur) and tracks only the prey's centroid (10, 0) — 10 tiles
    // away, well past its tighter 3-tile leash, so it corrects.
    const moved = applyHerdCohesion(world, guardian, RULES);
    expect(moved).toBe(true);
    expect(guardian.pos.x).toBeGreaterThan(0);
  });

  it("an ordinary (non-guardian) herd member keeps the wider leash and whole-herd centroid even when rules are provided", () => {
    const world = createWorld(20, 20);
    const nearby = member("a", { x: 5, y: 5 }, { species: "bulbasaur" });
    world.agents.push(nearby, member("b", { x: 6, y: 5 }, { species: "bulbasaur" }));

    const moved = applyHerdCohesion(world, nearby, RULES);

    expect(moved).toBe(false);
    expect(nearby.pos).toEqual({ x: 5, y: 5 });
  });
});
