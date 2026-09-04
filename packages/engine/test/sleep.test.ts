import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import {
  createNeeds,
  tickAgentAction,
  tickAgentNeeds,
  ENERGY_SLEEP_THRESHOLD,
  LONG_SLEEP_EXP_BONUS,
  LONG_SLEEP_EXP_TICKS,
  SLEEP_ENERGY_RESTORE_RATE,
  SLEEP_HEAL_MULTIPLIER,
} from "../src/needs.js";
import { tickCooldowns } from "../src/combat.js";
import { applyHealOverTime } from "../src/support.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

const RULES: HuntRules = { scyther: true };

const TEST_MOVE: MoveSpec = {
  id: "test-move",
  name: "Test Move",
  shape: { kind: "point" },
  type: "normal",
  category: "physical",
  power: 40,
  accuracy: 100,
  cooldownTicks: 0,
};

function bulbasaur(pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "bulbasaur-0",
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    moves: [TEST_MOVE],
    maxHp: 10,
    ...overrides,
  };
}

function scyther(pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "scyther-0",
    species: "scyther",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ hunger: 0.9 }), // satisfied — isolates sleep-detection tests from an actual hunt
    behavior: "idle",
    moves: [TEST_MOVE],
    maxHp: 20,
    ...overrides,
  };
}

function venusaur(pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "venusaur-0",
    species: "venusaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    moves: [TEST_MOVE],
    maxHp: 50, // never eligible prey against scyther() above
    ...overrides,
  };
}

describe("falling asleep", () => {
  it("falls asleep when idle, energy is low, and no threat is nearby", () => {
    const world = createWorld(10, 10);
    const agent = bulbasaur({ x: 5, y: 5 }, { needs: createNeeds({ energy: ENERGY_SLEEP_THRESHOLD - 0.01 }) });
    world.agents.push(agent);
    const log = new EventLog();

    tickAgentAction(world, agent, log, RULES);

    expect(agent.asleep).toBe(true);
    expect(agent.behavior).toBe("sleep");
    expect(agent.sleepTicks).toBe(0);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "fellAsleep", agentId: "bulbasaur-0" })
    );
  });

  it("does not fall asleep while a need is urgent, even with low energy", () => {
    const world = createWorld(10, 10);
    const agent = bulbasaur({ x: 5, y: 5 }, { needs: createNeeds({ energy: ENERGY_SLEEP_THRESHOLD - 0.01, thirst: 0.05 }) });
    world.agents.push(agent);

    tickAgentAction(world, agent, undefined, RULES);

    expect(agent.asleep).toBeUndefined();
  });

  it("does not fall asleep while energy is still above the threshold", () => {
    const world = createWorld(10, 10);
    const agent = bulbasaur({ x: 5, y: 5 }, { needs: createNeeds({ energy: ENERGY_SLEEP_THRESHOLD + 0.1 }) });
    world.agents.push(agent);

    tickAgentAction(world, agent, undefined, RULES);

    expect(agent.asleep).toBeUndefined();
  });

  it("does not fall asleep with a predator nearby, even when idle and low on energy", () => {
    const world = createWorld(10, 10);
    const agent = bulbasaur({ x: 5, y: 5 }, { needs: createNeeds({ energy: ENERGY_SLEEP_THRESHOLD - 0.01 }) });
    world.agents.push(agent, scyther({ x: 6, y: 5 }));

    tickAgentAction(world, agent, undefined, RULES);

    expect(agent.asleep).toBeUndefined();
  });
});

describe("waking: urgent need", () => {
  it("an urgent need wakes a sleeping agent and lets it act the same tick", () => {
    const world = createWorld(10, 10);
    const agent = bulbasaur({ x: 5, y: 5 }, { asleep: true, sleepTicks: 40, needs: createNeeds({ thirst: 0.05 }) });
    world.agents.push(agent);
    const log = new EventLog();

    tickAgentAction(world, agent, log, RULES);

    expect(agent.asleep).toBe(false);
    expect(agent.sleepTicks).toBe(0);
    expect(agent.behavior).not.toBe("sleep");
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "wokeUp", agentId: "bulbasaur-0", reason: "urgentNeed" })
    );
  });
});

describe("waking: threat + watcher", () => {
  it("wakes when a threat is nearby AND an awake herd-mate is close enough to notice", () => {
    const world = createWorld(10, 10);
    const sleeper = bulbasaur({ x: 5, y: 5 }, { asleep: true, herdId: "herd-a" });
    const watcher = bulbasaur({ x: 6, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" }); // awake, same herd, close
    const threat = scyther({ x: 4, y: 5 });
    world.agents.push(sleeper, watcher, threat);
    const log = new EventLog();

    tickAgentAction(world, sleeper, log, RULES);

    expect(sleeper.asleep).toBe(false);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "wokeUp", agentId: "bulbasaur-0", reason: "threatSpotted" })
    );
  });

  it("sitting duck: stays asleep and takes no action when a threat is nearby but no watcher is around", () => {
    const world = createWorld(10, 10);
    const sleeper = bulbasaur({ x: 5, y: 5 }, { asleep: true, herdId: "herd-a" });
    const threat = scyther({ x: 4, y: 5 });
    world.agents.push(sleeper, threat);
    const log = new EventLog();

    tickAgentAction(world, sleeper, log, RULES);

    expect(sleeper.asleep).toBe(true);
    expect(sleeper.pos).toEqual({ x: 5, y: 5 }); // no flee
    expect(sleeper.behavior).toBe("idle"); // unchanged — nothing ran this tick
    expect(log.events.some((e) => e.kind === "wokeUp")).toBe(false);
  });

  it("a fainted or already-asleep herd-mate does not count as a watcher", () => {
    const world = createWorld(10, 10);
    const sleeper = bulbasaur({ x: 5, y: 5 }, { asleep: true, herdId: "herd-a" });
    const faintedNeighbor = bulbasaur({ x: 6, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a", fainted: true });
    const sleepingNeighbor = bulbasaur({ x: 5, y: 6 }, { id: "bulbasaur-2", herdId: "herd-a", asleep: true });
    const threat = scyther({ x: 4, y: 5 });
    world.agents.push(sleeper, faintedNeighbor, sleepingNeighbor, threat);

    tickAgentAction(world, sleeper, undefined, RULES);

    expect(sleeper.asleep).toBe(true);
  });
});

describe("guardian exception: an asleep guardian still defends a different endangered herd-mate", () => {
  it("intervenes and wakes itself up in the process", () => {
    const world = createWorld(10, 10);
    const guardian = venusaur({ x: 8, y: 5 }, { herdId: "herd-a", asleep: true, sleepTicks: 55 });
    const threatened = bulbasaur({ x: 5, y: 5 }, { herdId: "herd-a", behavior: "flee" });
    const threat = scyther({ x: 6, y: 5 }, { needs: createNeeds({ hunger: 0.9 }) }); // satisfied — isolates the guardian's proactive response
    world.agents.push(guardian, threatened, threat);
    const log = new EventLog();

    tickAgentAction(world, guardian, log, RULES);

    expect(guardian.behavior).toBe("fight");
    expect(guardian.fightTarget).toBe("scyther-0");
    expect(guardian.asleep).toBe(false); // actively fighting isn't consistent with being asleep
    expect(guardian.sleepTicks).toBe(0);
  });
});

describe("needs-decay/heal/cooldown effects while asleep", () => {
  it("hunger and thirst drain much more slowly while asleep than awake", () => {
    const world = createWorld(5, 5);
    const awake = bulbasaur({ x: 0, y: 0 }, { needs: createNeeds() });
    const asleep = bulbasaur({ x: 1, y: 0 }, { id: "bulbasaur-1", asleep: true, needs: createNeeds() });

    tickAgentNeeds(awake, world);
    tickAgentNeeds(asleep, world);

    const awakeHungerDrop = 1 - awake.needs.hunger;
    const asleepHungerDrop = 1 - asleep.needs.hunger;
    const awakeThirstDrop = 1 - awake.needs.thirst;
    const asleepThirstDrop = 1 - asleep.needs.thirst;

    expect(asleepHungerDrop).toBeGreaterThan(0); // still real, non-zero cost
    expect(asleepHungerDrop).toBeLessThan(awakeHungerDrop);
    expect(asleepThirstDrop).toBeGreaterThan(0);
    expect(asleepThirstDrop).toBeLessThan(awakeThirstDrop);
  });

  it("energy rises instead of falling while asleep", () => {
    const world = createWorld(5, 5);
    const agent = bulbasaur({ x: 0, y: 0 }, { asleep: true, needs: createNeeds({ energy: 0.5 }) });

    tickAgentNeeds(agent, world);

    expect(agent.needs.energy).toBeCloseTo(0.5 + SLEEP_ENERGY_RESTORE_RATE, 5);
  });

  it("applyHealOverTime heals faster with the sleep multiplier", () => {
    const fed = { alive: true, hp: 5, maxHp: 10, needs: createNeeds() } as Agent;
    const alsoFed = { alive: true, hp: 5, maxHp: 10, needs: createNeeds() } as Agent;

    applyHealOverTime(fed);
    applyHealOverTime(alsoFed, SLEEP_HEAL_MULTIPLIER);

    const awakeGain = fed.hp! - 5;
    const asleepGain = alsoFed.hp! - 5;
    expect(asleepGain).toBeCloseTo(awakeGain * SLEEP_HEAL_MULTIPLIER, 5);
  });

  it("move cooldowns tick down faster while asleep", () => {
    const awake = { moveCooldowns: { "test-move": 10 } } as unknown as Agent;
    const asleep = { moveCooldowns: { "test-move": 10 } } as unknown as Agent;

    tickCooldowns(awake, 1);
    tickCooldowns(asleep, 2); // needs.ts passes SLEEP_COOLDOWN_TICKS while asleep

    expect(awake.moveCooldowns!["test-move"]).toBe(9);
    expect(asleep.moveCooldowns!["test-move"]).toBe(8);
  });
});

describe("long-sleep exp bonus", () => {
  it("fires exactly once per sleep session, not repeatedly past the threshold", () => {
    const world = createWorld(5, 5);
    const agent = bulbasaur({ x: 0, y: 0 }, { asleep: true, sleepTicks: 0, level: 1, exp: 0 });
    const log = new EventLog();

    for (let i = 0; i < LONG_SLEEP_EXP_TICKS + 20; i++) {
      tickAgentNeeds(agent, world, undefined, log);
    }

    const bonuses = log.events.filter((e) => e.kind === "longSleepBonus");
    expect(bonuses).toHaveLength(1);
    expect(agent.exp).toBeGreaterThanOrEqual(LONG_SLEEP_EXP_BONUS);
  });

  it("a fresh sleep session (sleepTicks reset by waking) can earn the bonus again", () => {
    const world = createWorld(5, 5);
    const agent = bulbasaur({ x: 0, y: 0 }, { asleep: true, sleepTicks: 0, level: 1, exp: 0 });
    const log = new EventLog();

    for (let i = 0; i < LONG_SLEEP_EXP_TICKS + 5; i++) tickAgentNeeds(agent, world, undefined, log);
    expect(log.events.filter((e) => e.kind === "longSleepBonus")).toHaveLength(1);

    // Wakes, sleeps again.
    agent.asleep = false;
    agent.sleepTicks = 0;
    agent.asleep = true;
    for (let i = 0; i < LONG_SLEEP_EXP_TICKS + 5; i++) tickAgentNeeds(agent, world, undefined, log);

    expect(log.events.filter((e) => e.kind === "longSleepBonus")).toHaveLength(2);
  });
});
