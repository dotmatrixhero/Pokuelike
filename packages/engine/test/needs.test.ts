import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds, tickAgent } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    species: "bulbasaur",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...overrides,
  };
}

describe("tickAgent", () => {
  it("moves a thirsty agent toward the nearest water tile on its layer", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 4, 0, "water");
    const agent = makeAgent({ needs: createNeeds({ thirst: 0.1 }) });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("seekWater");
    expect(agent.pos.x).toBeGreaterThan(0);
  });

  it("stays idle when all needs are satisfied", () => {
    const world = createWorld(5, 1);
    const agent = makeAgent({ pos: { x: 2, y: 0 } });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("idle");
    expect(agent.pos).toEqual({ x: 2, y: 0 });
  });

  it("drinks and restores thirst once it reaches the water tile", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "water");
    const agent = makeAgent({ pos: { x: 2, y: 0 }, needs: createNeeds({ thirst: 0.1 }) });

    tickAgent(world, agent);

    expect(agent.needs.thirst).toBeGreaterThan(0.1);
    expect(agent.pos).toEqual({ x: 2, y: 0 });
  });

  it("crosses to a neighboring layer when its resource isn't on the home layer", () => {
    const world = createWorld(3, 1);
    setTile(world, "surface", 1, 0, "food");
    const agent = makeAgent({
      species: "diglett",
      pos: { x: 1, y: 0 },
      layer: "underground",
      homeLayer: "underground",
      needs: createNeeds({ hunger: 0.1 }),
    });

    tickAgent(world, agent);

    expect(agent.layer).toBe("surface");
  });

  it("returns to its home layer once idle away from home", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ layer: "surface", homeLayer: "underground" });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("idle");
    expect(agent.layer).toBe("underground");
  });

  it("eating depletes the food patch's stock, and a depleted patch is skipped as a target", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    const agent = makeAgent({ pos: { x: 2, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });

    tickAgent(world, agent);
    expect(tileAt(world, "surface", 2, 0)!.stock).toBeCloseTo(0.8);

    tileAt(world, "surface", 2, 0)!.stock = 0;
    const secondAgent = makeAgent({ id: "a2", pos: { x: 2, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });
    tickAgent(world, secondAgent);
    expect(secondAgent.pos).toEqual({ x: 2, y: 0 }); // no reachable food, so it doesn't just sit "on" the depleted tile pretending to eat
    expect(secondAgent.behavior).toBe("seekFood");
  });
});

describe("starvation", () => {
  it("survives a while at 0 hunger, then dies once the grace period runs out", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ needs: createNeeds({ hunger: 0 }) });

    for (let i = 0; i < 99; i++) tickAgent(world, agent);
    expect(agent.alive).not.toBe(false);

    tickAgent(world, agent);
    expect(agent.alive).toBe(false);
  });

  it("records a starved event with the right cause", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ needs: createNeeds({ thirst: 0, hunger: 1 }) });
    const log = new EventLog();

    // Keep hunger topped up so this test isolates thirst as the sole cause of death.
    for (let i = 0; i < 100 && agent.alive !== false; i++) {
      tickAgent(world, agent, log);
      agent.needs.hunger = 1;
    }

    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "starved", agentId: "a1", cause: "thirst" })
    );
  });

  it("recovering above 0 resets the starvation clock", () => {
    const world = createWorld(3, 1);
    setTile(world, "surface", 1, 0, "food");
    const agent = makeAgent({ pos: { x: 1, y: 0 }, needs: createNeeds({ hunger: 0 }) });
    agent.starvationTicks = 90; // pretend it's already been starving a while

    tickAgent(world, agent); // starvationTicks -> 91 (checked before eating this tick), then eats
    expect(agent.needs.hunger).toBeGreaterThan(0);

    tickAgent(world, agent); // hunger already >0 from last tick's meal -> clock resets
    expect(agent.starvationTicks).toBe(0);
    expect(agent.alive).not.toBe(false);
  });
});

describe("migration on unreachable resources", () => {
  it("an agent that can never find food eventually migrates instead of standing still forever", () => {
    const world = createWorld(30, 30); // no food anywhere on any layer
    const agent = makeAgent({ pos: { x: 15, y: 15 }, needs: createNeeds({ hunger: 0.5, thirst: 1 }) });
    // Keep hunger from ever reaching the starvation floor so this test isolates migration, not starvation.
    for (let i = 0; i < 149; i++) {
      tickAgent(world, agent);
      agent.needs.hunger = 0.5;
    }

    tickAgent(world, agent);

    expect(agent.behavior).toBe("relocate");
    expect(agent.relocateTarget).toBeDefined();
  });
});
