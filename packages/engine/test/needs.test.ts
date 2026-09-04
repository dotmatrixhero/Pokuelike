import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { ageMortalityChance, createNeeds, decayNeeds, tickAgent, tickAgentAction, tickAgentNeeds } from "../src/needs.js";
import { CONSUME_STOCK_AMOUNT } from "../src/flora.js";
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
    expect(tileAt(world, "surface", 2, 0)!.stock).toBeCloseTo(1 - CONSUME_STOCK_AMOUNT);

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

describe("ageMortalityChance", () => {
  it("is zero before old age onset", () => {
    expect(ageMortalityChance(0)).toBe(0);
    expect(ageMortalityChance(1499)).toBe(0);
  });

  it("ramps up between onset and the hazard cap age", () => {
    const early = ageMortalityChance(1600);
    const late = ageMortalityChance(2900);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it("saturates at the max chance from the cap age onward", () => {
    const atCap = ageMortalityChance(3000);
    const wellPast = ageMortalityChance(10000);
    expect(atCap).toBe(wellPast);
    expect(atCap).toBeGreaterThan(0);
  });
});

describe("old-age mortality", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a young agent never dies of old age, however the roll lands", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ age: 500 });
    vi.spyOn(Math, "random").mockReturnValue(0); // would kill anything with a nonzero hazard

    tickAgent(world, agent);

    expect(agent.alive).not.toBe(false);
  });

  it("a sufficiently old agent dies of old age when the roll beats its hazard chance", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ age: 3000 /* OLD_AGE_HAZARD_CAP_AGE, hazard is fully saturated here */ });
    const log = new EventLog();
    vi.spyOn(Math, "random").mockReturnValue(0); // 0 always beats a nonzero chance

    tickAgent(world, agent, log);

    expect(agent.alive).toBe(false);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "diedOfAge", agentId: "a1", species: "bulbasaur" })
    );
  });

  it("an old agent survives the tick when the roll doesn't beat its hazard chance", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ age: 3000 /* OLD_AGE_HAZARD_CAP_AGE, hazard is fully saturated here */ });
    vi.spyOn(Math, "random").mockReturnValue(0.999); // beats any chance below 1

    tickAgent(world, agent);

    expect(agent.alive).not.toBe(false);
  });

  it("an agent with no age (spawned directly into a scenario) is never subject to old-age mortality", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ age: undefined });
    vi.spyOn(Math, "random").mockReturnValue(0);

    tickAgent(world, agent);

    expect(agent.alive).not.toBe(false);
  });
});

describe("exp-motivated exploration", () => {
  it("a fully-satisfied idle agent in a large world wanders toward unexplored territory instead of standing still", () => {
    const world = createWorld(40, 40);
    const agent = makeAgent({ pos: { x: 20, y: 20 } });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("explore");
    expect(agent.pos).not.toEqual({ x: 20, y: 20 });
  });

  it("keeps walking toward the same exploreTarget across multiple ticks rather than re-rolling every tick", () => {
    const world = createWorld(40, 40);
    const agent = makeAgent({ pos: { x: 20, y: 20 } });

    tickAgent(world, agent);
    const target = agent.exploreTarget;
    expect(target).toBeDefined();

    tickAgent(world, agent);
    // Still walking toward the very same target, not a freshly re-rolled one.
    expect(agent.exploreTarget ?? agent.pos).toEqual(target);
  });

  it("an urgent need interrupts an in-progress exploration walk", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 0, 0, "water");
    const agent = makeAgent({ pos: { x: 20, y: 20 } });

    tickAgent(world, agent);
    expect(agent.behavior).toBe("explore");

    agent.needs.thirst = 0.1; // now urgent
    tickAgent(world, agent);

    expect(agent.behavior).toBe("seekWater");
    expect(agent.exploreTarget).toBeUndefined();
  });

  it("does nothing (stays idle) when the entire reachable world is already one visited sector", () => {
    const world = createWorld(3, 3); // one sector total (SECTOR_SIZE=5) — markSectorVisited marks it before exploration is even considered
    const agent = makeAgent({ pos: { x: 1, y: 1 } });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("idle");
    expect(agent.pos).toEqual({ x: 1, y: 1 });
  });
});

describe("decayNeeds: thirstMultiplier composes with the flat decay rate (Phase 3 weather)", () => {
  it("defaults to the original flat rate when no multiplier is passed", () => {
    const needs = createNeeds();
    decayNeeds(needs);
    expect(needs.thirst).toBeCloseTo(1 - 0.015, 10);
  });

  it("a multiplier below 1 (rain) eases thirst decay relative to the base rate", () => {
    const needs = createNeeds();
    decayNeeds(needs, 0.6);
    const eased = 1 - needs.thirst;
    expect(eased).toBeCloseTo(0.015 * 0.6, 10);
    expect(eased).toBeLessThan(0.015);
  });

  it("a multiplier above 1 (drought) raises thirst decay relative to the base rate", () => {
    const needs = createNeeds();
    decayNeeds(needs, 1.8);
    const raised = 1 - needs.thirst;
    expect(raised).toBeCloseTo(0.015 * 1.8, 10);
    expect(raised).toBeGreaterThan(0.015);
  });

  it("does not touch hunger/energy/mateDrive — only thirst is weather-modulated", () => {
    const eased = createNeeds();
    const base = createNeeds();
    decayNeeds(eased, 0.6);
    decayNeeds(base);
    expect(eased.hunger).toBe(base.hunger);
    expect(eased.energy).toBe(base.energy);
    expect(eased.mateDrive).toBe(base.mateDrive);
  });
});

describe("tickAgentNeeds: local weather composes with thirst decay through a real World", () => {
  it("an agent standing in an active drought cell loses thirst faster than one on a clear tile", () => {
    const droughtWorld = createWorld(10, 10);
    droughtWorld.weatherCells = [
      { id: "d", type: "drought", center: { x: 5, y: 5 }, radius: 3, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];
    const droughtAgent = makeAgent({ pos: { x: 5, y: 5 } });

    const clearWorld = createWorld(10, 10);
    const clearAgent = makeAgent({ pos: { x: 5, y: 5 } });

    tickAgentNeeds(droughtAgent, droughtWorld);
    tickAgentNeeds(clearAgent, clearWorld);

    expect(droughtAgent.needs.thirst).toBeLessThan(clearAgent.needs.thirst);
  });

  it("an agent outside the drought cell's radius decays at the ordinary rate", () => {
    const world = createWorld(30, 30);
    world.weatherCells = [
      { id: "d", type: "drought", center: { x: 25, y: 25 }, radius: 2, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];
    const farAgent = makeAgent({ pos: { x: 1, y: 1 } });
    tickAgentNeeds(farAgent, world);
    expect(farAgent.needs.thirst).toBeCloseTo(1 - 0.015, 10);
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

describe("tickAgentAction: status-effect action-tick guards", () => {
  it("an asleep agent takes no action at all", () => {
    const world = createWorld(5, 5);
    const agent = makeAgent({ pos: { x: 0, y: 0 }, status: { kind: "sleep", ticksRemaining: 5 }, needs: createNeeds({ thirst: 0.1 }) });
    setTile(world, "surface", 4, 0, "water");
    tickAgentAction(world, agent);
    expect(agent.pos).toEqual({ x: 0, y: 0 }); // never moved toward water
  });

  it("a frozen agent takes no action at all", () => {
    const world = createWorld(5, 5);
    const agent = makeAgent({ pos: { x: 0, y: 0 }, status: { kind: "freeze" }, needs: createNeeds({ thirst: 0.1 }) });
    setTile(world, "surface", 4, 0, "water");
    tickAgentAction(world, agent);
    expect(agent.pos).toEqual({ x: 0, y: 0 });
  });

  it("a paralyzed agent skips this action tick on a failed roll, acts normally on a passed one", () => {
    const world = createWorld(5, 5);
    setTile(world, "surface", 4, 0, "water");
    const skipped = makeAgent({ pos: { x: 0, y: 0 }, status: { kind: "paralysis" }, needs: createNeeds({ thirst: 0.1 }) });
    tickAgentAction(world, skipped, undefined, undefined, undefined, () => 0); // 0 < PARALYSIS_SKIP_CHANCE
    expect(skipped.pos).toEqual({ x: 0, y: 0 });

    const acted = makeAgent({ pos: { x: 0, y: 0 }, status: { kind: "paralysis" }, needs: createNeeds({ thirst: 0.1 }) });
    tickAgentAction(world, acted, undefined, undefined, undefined, () => 0.99); // not < PARALYSIS_SKIP_CHANCE
    expect(acted.pos).not.toEqual({ x: 0, y: 0 });
  });
});
