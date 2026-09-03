import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds, tickAgent } from "../src/needs.js";
import type { Agent } from "../src/types.js";

describe("tickAgent", () => {
  it("moves a thirsty agent toward the nearest water tile", () => {
    const world = createWorld(5, 1);
    setTile(world, 4, 0, "water");

    const agent: Agent = {
      id: "a1",
      species: "bulbasaur",
      pos: { x: 0, y: 0 },
      needs: createNeeds({ thirst: 0.1 }),
      behavior: "idle",
    };

    tickAgent(world, agent);

    expect(agent.behavior).toBe("seekWater");
    expect(agent.pos.x).toBeGreaterThan(0);
  });

  it("stays idle when all needs are satisfied", () => {
    const world = createWorld(5, 1);
    const agent: Agent = {
      id: "a1",
      species: "bulbasaur",
      pos: { x: 2, y: 0 },
      needs: createNeeds(),
      behavior: "idle",
    };

    tickAgent(world, agent);

    expect(agent.behavior).toBe("idle");
    expect(agent.pos).toEqual({ x: 2, y: 0 });
  });
});
