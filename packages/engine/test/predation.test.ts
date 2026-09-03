import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules } from "../src/types.js";

const RULES: HuntRules = { scyther: ["bulbasaur"] };

function prey(pos: { x: number; y: number }): Agent {
  return {
    id: "bulbasaur-0",
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
  };
}

function predator(pos: { x: number; y: number }, hunger = 0.3): Agent {
  return {
    id: "scyther-0",
    species: "scyther",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ hunger }),
    behavior: "idle",
  };
}

describe("predation", () => {
  it("prey flees a nearby predator instead of pursuing its own needs", () => {
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 });
    world.agents.push(target, predator({ x: 6, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(target.behavior).toBe("flee");
    expect(target.pos.x).toBeLessThan(5);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "behaviorChanged", agentId: "bulbasaur-0", to: "flee" })
    );
  });

  it("a hungry predator hunts and closes distance on nearby prey", () => {
    const world = createWorld(10, 10);
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 8, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).toBe("hunt");
    expect(hunter.pos.x).toBeLessThan(8);
  });

  it("kills prey on contact, restores predator hunger, and prunes the corpse", () => {
    const world = createWorld(10, 10);
    // Predator ticks first so it strikes before the prey has a chance to flee this tick.
    world.agents.push(predator({ x: 5, y: 6 }, 0.1), prey({ x: 5, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(world.agents).toHaveLength(1);
    expect(world.agents[0]!.id).toBe("scyther-0");
    expect(world.agents[0]!.needs.hunger).toBeGreaterThan(0.5);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "killed", predatorId: "scyther-0", preyId: "bulbasaur-0" })
    );
  });

  it("a satisfied predator ignores nearby prey", () => {
    const world = createWorld(10, 10);
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 6, y: 5 }, 0.9));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).not.toBe("hunt");
  });

  it("without rules, agents behave exactly as before predation existed", () => {
    const world = createWorld(10, 10);
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 6, y: 5 }, 0.1));

    tickWorld(world);

    expect(world.agents).toHaveLength(2);
  });
});
