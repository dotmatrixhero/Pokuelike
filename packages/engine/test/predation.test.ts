import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { applyPredationInstincts } from "../src/predation.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules } from "../src/types.js";

const RULES: HuntRules = { scyther: ["bulbasaur"] };

function prey(pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "bulbasaur-0",
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...overrides,
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

describe("mob-fighting", () => {
  it("a large enough, close enough herd mobs the predator instead of fleeing", () => {
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" });
    const mobber2 = prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" });
    const mobber3 = prey({ x: 6, y: 5 }, { id: "bulbasaur-2", herdId: "herd-a" });
    world.agents.push(mobber1, mobber2, mobber3, predator({ x: 5, y: 6 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    // mobber1 is adjacent (distance 1) and lands a hit; the predator's default hp is 3.
    expect(mobber1.behavior).toBe("fight");
    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.hp).toBe(2);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0", defenderHpRemaining: 2 })
    );
  });

  it("a mob of 3+ can defeat a predator outright", () => {
    const world = createWorld(10, 10);
    const mobbers = [
      prey({ x: 4, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" }),
      prey({ x: 6, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" }),
      prey({ x: 5, y: 4 }, { id: "bulbasaur-2", herdId: "herd-a" }),
    ];
    world.agents.push(...mobbers, predator({ x: 5, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(world.agents.find((a) => a.id === "scyther-0")).toBeUndefined();
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "defeated", loserId: "scyther-0", winnerSpecies: "bulbasaur" })
    );
  });

  it("a lone or small group still flees rather than fights", () => {
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" });
    const mobber2 = prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" });
    world.agents.push(mobber1, mobber2, predator({ x: 5, y: 6 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(mobber1.behavior).toBe("flee");
  });

  it("a predator avoids hunting prey protected by a large enough herd", () => {
    const world = createWorld(10, 10);
    const hungry = predator({ x: 10, y: 5 }, 0.1);
    const group = [0, 1, 2].map((i) => prey({ x: 5 + i, y: 5 }, { id: `bulbasaur-${i}`, herdId: "herd-a" }));
    world.agents.push(hungry, ...group);

    tickWorld(world, undefined, RULES);

    expect(hungry.behavior).not.toBe("hunt");
    expect(hungry.ticksSinceMeal).toBe(1);
  });

  it("a critically hurt predator flees a fight instead of continuing to hunt", () => {
    const world = createWorld(10, 10);
    const attacker = prey({ x: 6, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a", behavior: "fight", fightTarget: "scyther-0" });
    const hurt = predator({ x: 5, y: 5 });
    hurt.hp = 1;
    hurt.maxHp = 3;
    world.agents.push(attacker, hurt);
    const log = new EventLog();

    const handled = applyPredationInstincts(world, hurt, RULES, log);

    expect(handled).toBe(true);
    expect(hurt.behavior).toBe("flee");
    expect(hurt.pos.x).toBeLessThan(5); // away from the attacker at x=6
  });

  it("a predator that can't find safe prey for long enough relocates instead of camping", () => {
    const world = createWorld(30, 30);
    const hungry = predator({ x: 15, y: 15 }, 0.1);
    hungry.ticksSinceMeal = 149;
    world.agents.push(hungry);
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(hungry.behavior).toBe("relocate");
    expect(hungry.relocateTarget).toBeDefined();
  });
});
