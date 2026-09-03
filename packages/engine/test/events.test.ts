import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";

describe("event log", () => {
  it("records a crossedLayer event when an agent crosses to reach a resource", () => {
    const world = createWorld(3, 1);
    setTile(world, "surface", 1, 0, "food");
    const agent: Agent = {
      id: "diglett-1",
      species: "diglett",
      pos: { x: 1, y: 0 },
      layer: "underground",
      homeLayer: "underground",
      needs: createNeeds({ hunger: 0.1 }),
      behavior: "idle",
    };
    world.agents.push(agent);
    const log = new EventLog();

    tickWorld(world, log);

    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "crossedLayer", agentId: "diglett-1", from: "underground", to: "surface" })
    );
  });

  it("records a consumed event when an agent eats/drinks at a resource tile", () => {
    const world = createWorld(3, 1);
    setTile(world, "surface", 1, 0, "water");
    const agent: Agent = {
      id: "a1",
      species: "bulbasaur",
      pos: { x: 1, y: 0 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds({ thirst: 0.1 }),
      behavior: "idle",
    };
    world.agents.push(agent);
    const log = new EventLog();

    tickWorld(world, log);

    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "consumed", agentId: "a1", need: "thirst" })
    );
  });

  it("records behaviorChanged when urgency crosses the idle threshold", () => {
    const world = createWorld(3, 1);
    const agent: Agent = {
      id: "a1",
      species: "bulbasaur",
      pos: { x: 0, y: 0 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds({ thirst: 0.1 }),
      behavior: "idle",
    };
    world.agents.push(agent);
    const log = new EventLog();

    tickWorld(world, log);

    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "behaviorChanged", from: "idle", to: "seekWater" })
    );
  });
});
