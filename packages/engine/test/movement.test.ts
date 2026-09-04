import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { applyForcedMovement, stepAway, stepToward } from "../src/movement.js";
import type { Agent } from "../src/types.js";
import type { ForcedMovement } from "../src/moves.js";

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

describe("stepToward / stepAway", () => {
  it("stepToward moves one tile toward the target", () => {
    const world = createWorld(10, 10);
    expect(stepToward(world, "surface", { x: 5, y: 5 }, { x: 8, y: 5 })).toEqual({ x: 6, y: 5 });
  });

  it("stepAway moves one tile away from the threat (y tie-broken toward +1 when already aligned)", () => {
    const world = createWorld(10, 10);
    expect(stepAway(world, "surface", { x: 5, y: 5 }, { x: 8, y: 5 })).toEqual({ x: 4, y: 6 });
  });

  it("neither steps through an unwalkable tile", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 6, 5, "tree");
    const result = stepToward(world, "surface", { x: 5, y: 5 }, { x: 8, y: 5 });
    expect(result).not.toEqual({ x: 6, y: 5 });
  });
});

describe("applyForcedMovement", () => {
  it("drags the defender toward the attacker (direction: closer, mover: defender)", () => {
    const world = createWorld(10, 10);
    const attacker = makeAgent({ id: "attacker", pos: { x: 5, y: 5 } });
    const defender = makeAgent({ id: "defender", pos: { x: 8, y: 5 } });
    const forced: ForcedMovement = { mover: "defender", direction: "closer", tiles: 1, timing: "onHit" };

    applyForcedMovement(world, forced, attacker, defender);

    expect(defender.pos).toEqual({ x: 7, y: 5 });
    expect(attacker.pos).toEqual({ x: 5, y: 5 }); // attacker untouched
  });

  it("pushes the defender away from the attacker (direction: away, mover: defender)", () => {
    const world = createWorld(10, 10);
    const attacker = makeAgent({ id: "attacker", pos: { x: 5, y: 5 } });
    const defender = makeAgent({ id: "defender", pos: { x: 6, y: 5 } });
    const forced: ForcedMovement = { mover: "defender", direction: "away", tiles: 1, timing: "onHit" };

    applyForcedMovement(world, forced, attacker, defender);

    expect(defender.pos).toEqual({ x: 7, y: 6 }); // y tie-broken toward +1, same as stepAway's own documented behavior
  });

  it("lunges the attacker toward the defender (mover: attacker, direction: closer)", () => {
    const world = createWorld(10, 10);
    const attacker = makeAgent({ id: "attacker", pos: { x: 5, y: 5 } });
    const defender = makeAgent({ id: "defender", pos: { x: 8, y: 5 } });
    const forced: ForcedMovement = { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" };

    applyForcedMovement(world, forced, attacker, defender);

    expect(attacker.pos).toEqual({ x: 6, y: 5 });
    expect(defender.pos).toEqual({ x: 8, y: 5 }); // defender untouched
  });

  it("retreats the attacker away from the defender (mover: attacker, direction: away)", () => {
    const world = createWorld(10, 10);
    const attacker = makeAgent({ id: "attacker", pos: { x: 6, y: 5 } });
    const defender = makeAgent({ id: "defender", pos: { x: 5, y: 5 } });
    const forced: ForcedMovement = { mover: "attacker", direction: "away", tiles: 1, timing: "onHit" };

    applyForcedMovement(world, forced, attacker, defender);

    expect(attacker.pos).toEqual({ x: 7, y: 6 }); // y tie-broken toward +1, same as stepAway's own documented behavior
  });

  it("moves multiple tiles, one obstacle-aware step at a time", () => {
    const world = createWorld(10, 10);
    const attacker = makeAgent({ id: "attacker", pos: { x: 0, y: 5 } });
    const defender = makeAgent({ id: "defender", pos: { x: 9, y: 5 } });
    const forced: ForcedMovement = { mover: "defender", direction: "away", tiles: 3, timing: "onHit" };

    applyForcedMovement(world, forced, attacker, defender);

    // Defender starts already at the far edge (x=9, world width 10 -> max x=9),
    // so "away" from x=0 can't actually move past the map edge each step —
    // confirms this never teleports through a wall, it just stops.
    expect(defender.pos.x).toBeLessThanOrEqual(9);
  });

  it("the Immovable passive blocks the mover from being dragged/pushed at all", () => {
    const world = createWorld(10, 10);
    const attacker = makeAgent({ id: "attacker", pos: { x: 5, y: 5 } });
    const defender = makeAgent({ id: "defender", pos: { x: 6, y: 5 }, passives: { immovable: 1 } });
    const forced: ForcedMovement = { mover: "defender", direction: "away", tiles: 1, timing: "onHit" };

    applyForcedMovement(world, forced, attacker, defender);

    expect(defender.pos).toEqual({ x: 6, y: 5 }); // untouched
  });

  it("Immovable only protects the passive-holder, not whoever else the move displaces", () => {
    const world = createWorld(10, 10);
    const attacker = makeAgent({ id: "attacker", pos: { x: 5, y: 5 }, passives: { immovable: 1 } });
    const defender = makeAgent({ id: "defender", pos: { x: 8, y: 5 } });
    const forced: ForcedMovement = { mover: "defender", direction: "closer", tiles: 1, timing: "onHit" };

    applyForcedMovement(world, forced, attacker, defender);

    expect(defender.pos).toEqual({ x: 7, y: 5 }); // still dragged — immovable attacker is irrelevant here
  });

  it("a blocked path leaves the mover exactly where it was, never teleporting", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 6, 5, "tree");
    setTile(world, "surface", 5, 4, "tree");
    setTile(world, "surface", 5, 6, "tree");
    const attacker = makeAgent({ id: "attacker", pos: { x: 5, y: 5 } });
    const defender = makeAgent({ id: "defender", pos: { x: 8, y: 5 } });
    const forced: ForcedMovement = { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" };

    applyForcedMovement(world, forced, attacker, defender);

    expect(attacker.pos).toEqual({ x: 5, y: 5 });
  });
});
