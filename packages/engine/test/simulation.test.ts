import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds, tickAgentNeeds, tickAgentAction } from "../src/needs.js";
import { tickWorld, accumulateActionEnergy, actionSpeedOf, ACTION_THRESHOLD } from "../src/simulation.js";
import { useMove, tickCooldowns } from "../src/combat.js";
import { EventLog } from "../src/events.js";
import { DAY_LENGTH_TICKS, isNight, lightLevel } from "../src/daynight.js";
import type { Agent } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    species: "test",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...overrides,
  };
}

describe("accumulateActionEnergy", () => {
  it("acts only once threshold is crossed, and never banks more than one action per tick", () => {
    const agent = makeAgent();
    // Below threshold: no action.
    expect(accumulateActionEnergy(agent, ACTION_THRESHOLD - 1)).toBe(false);
    expect(agent.actionEnergy).toBe(ACTION_THRESHOLD - 1);

    // A speed value more than double the threshold in one shot still yields
    // exactly one action, with the remainder clamped to at most the threshold.
    const fast = makeAgent({ id: "fast" });
    expect(accumulateActionEnergy(fast, ACTION_THRESHOLD * 3)).toBe(true);
    expect(fast.actionEnergy).toBeLessThanOrEqual(ACTION_THRESHOLD);
  });

  it("a fast agent (high Speed) acts more often than a slow one over N ticks", () => {
    const fast = makeAgent({ id: "fast" });
    const slow = makeAgent({ id: "slow" });
    const FAST_SPEED = 37; // Venusaur lvl 20, see simulation.ts's ACTION_THRESHOLD comment
    const SLOW_SPEED = 9; // Bulbasaur lvl 5
    const TICKS = 200;

    let fastActions = 0;
    let slowActions = 0;
    for (let i = 0; i < TICKS; i++) {
      if (accumulateActionEnergy(fast, FAST_SPEED)) fastActions++;
      if (accumulateActionEnergy(slow, SLOW_SPEED)) slowActions++;
    }

    expect(fastActions).toBeGreaterThan(slowActions);
    // Sanity-check against the expected long-run rate (speed / threshold per tick).
    expect(fastActions).toBeCloseTo((FAST_SPEED * TICKS) / ACTION_THRESHOLD, 0);
    expect(slowActions).toBeCloseTo((SLOW_SPEED * TICKS) / ACTION_THRESHOLD, 0);
  });

  it("an agent with no computed stats falls back to acting every tick", () => {
    const agent = makeAgent();
    // No `stats` set -> tickWorld should use ACTION_THRESHOLD as the fallback
    // speed, i.e. every tickWorld call is an action tick for it.
    const world = createWorld(5, 1);
    world.agents.push(agent);
    tickWorld(world);
    expect(agent.actionEnergy).toBe(0); // crossed exactly once, remainder is 0
  });
});

describe("actionSpeedOf: paralysis halves effective Speed", () => {
  it("a paralyzed agent's action speed is half of the same agent unparalyzed", () => {
    const world = createWorld(5, 1);
    const healthy = makeAgent({ stats: { maxHp: 50, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 20 }, hp: 50, maxHp: 50 });
    const paralyzed = makeAgent({
      stats: { maxHp: 50, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 20 },
      hp: 50,
      maxHp: 50,
      status: { kind: "paralysis" },
    });
    expect(actionSpeedOf(world, paralyzed, 0)).toBeCloseTo(actionSpeedOf(world, healthy, 0) / 2);
  });
});

describe("actionSpeedOf: a real Speed stat-stage grant (e.g. Agility) actually changes action frequency", () => {
  it("an agent with a +2 speed stage acts noticeably more often than the same agent without one", () => {
    const world = createWorld(5, 1);
    const baseline = makeAgent({ stats: { maxHp: 50, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 20 }, hp: 50, maxHp: 50 });
    const hasted = makeAgent({
      stats: { maxHp: 50, attack: 10, defense: 10, spAttack: 10, spDefense: 10, speed: 20 },
      hp: 50,
      maxHp: 50,
      statStages: [{ stat: "speed", stage: 2, ticksRemaining: 40 }],
    });
    // Before this feature, "speed" was a real computed stat with zero consumer
    // beyond nature.ts flavor — this is the actual regression check that
    // actionSpeedOf now folds a Speed stage into its multiplier stack.
    expect(actionSpeedOf(world, hasted, 0)).toBeGreaterThan(actionSpeedOf(world, baseline, 0));
  });
});

describe("action economy via tickWorld", () => {
  it("needs still decay every tick even for an agent that doesn't act that tick", () => {
    const world = createWorld(5, 1);
    const slowAgent = makeAgent({
      needs: createNeeds({ thirst: 1 }),
      stats: { maxHp: 1, attack: 1, defense: 1, spAttack: 1, spDefense: 1, speed: 1 }, // far below ACTION_THRESHOLD
    });
    world.agents.push(slowAgent);

    const thirstBefore = slowAgent.needs.thirst;
    tickWorld(world);

    // Speed 1 << ACTION_THRESHOLD, so this agent did not act this tick...
    expect(slowAgent.actionEnergy).toBe(1);
    // ...but its needs decayed anyway.
    expect(slowAgent.needs.thirst).toBeLessThan(thirstBefore);
  });

  it("cooldowns count down on the owner's own action tick, not in real world-tick time", () => {
    const world = createWorld(5, 1);
    const move: MoveSpec = {
      id: "slow-move",
      name: "Slow Move",
      shape: { kind: "point" },
      type: "normal",
      category: "physical",
      power: 10,
      accuracy: 100,
      cooldownTicks: 5,
      range: { min: 0, max: 1 },
    };
    const agent = makeAgent({
      moves: [move],
      stats: { maxHp: 1, attack: 1, defense: 1, spAttack: 1, spDefense: 1, speed: 1 }, // never crosses ACTION_THRESHOLD in a few ticks
    });
    useMove(agent, move);
    world.agents.push(agent);

    expect(agent.moveCooldowns?.[move.id]).toBe(5);
    tickWorld(world);
    tickWorld(world);
    tickWorld(world);

    // Three world ticks passed, but Speed 1 never crossed ACTION_THRESHOLD —
    // this agent never got an action tick of its own, so its cooldown never
    // moved. A move's cooldownTicks is measured in the owner's own turns,
    // the same fix that stops a fast-recharging move from already being
    // off-cooldown before a slow agent's very first reuse opportunity.
    expect(agent.moveCooldowns?.[move.id]).toBe(5);
  });

  it("tickAgentAction ticks cooldowns down once per real action tick; tickAgentNeeds no longer touches them", () => {
    const agent = makeAgent();
    agent.moveCooldowns = { x: 2 };

    // tickAgentNeeds is the always-runs-every-world-tick half of an agent's
    // tick — cooldown recovery deliberately isn't there any more (see its
    // own doc comment on why), so it must leave this alone.
    tickAgentNeeds(agent);
    expect(agent.moveCooldowns?.x).toBe(2);

    // tickAgentAction only ever runs on the agent's own action tick — this
    // is where cooldowns actually recover now.
    tickAgentAction(createWorld(3, 1), agent);
    expect(agent.moveCooldowns?.x).toBe(1);

    // tickCooldowns itself is exercised directly elsewhere (combat.test.ts);
    // this just confirms tickAgentAction wires it in.
    tickCooldowns(agent);
    expect(agent.moveCooldowns?.x).toBeUndefined();
  });

  it("end-to-end: cooldownTicks genuinely gates reuse across the owner's own action ticks, not world ticks", () => {
    // Speed 20 crosses ACTION_THRESHOLD (40) every other world tick: 20, 40
    // (acts, remainder 0), 20, 40 (acts), ... — a real, uneven action cadence
    // to prove the gate tracks the agent's own turns through it.
    const world = createWorld(5, 1);
    const move: MoveSpec = {
      id: "gated-move",
      name: "Gated Move",
      shape: { kind: "point" },
      type: "normal",
      category: "physical",
      power: 10,
      accuracy: 100,
      cooldownTicks: 2,
      range: { min: 0, max: 1 },
    };
    const agent = makeAgent({
      moves: [move],
      stats: { maxHp: 1, attack: 1, defense: 1, spAttack: 1, spDefense: 1, speed: 20 },
    });
    useMove(agent, move); // simulates the agent having just used it on its own first action tick
    world.agents.push(agent);

    expect(agent.moveCooldowns?.[move.id]).toBe(2);
    tickWorld(world); // world tick 1: no action tick (energy 20 < 40) — untouched
    expect(agent.moveCooldowns?.[move.id]).toBe(2);
    tickWorld(world); // world tick 2: action tick (energy crosses 40) — decrements once
    expect(agent.moveCooldowns?.[move.id]).toBe(1);
    tickWorld(world); // world tick 3: no action tick — untouched
    expect(agent.moveCooldowns?.[move.id]).toBe(1);
    tickWorld(world); // world tick 4: action tick — decrements to 0, off cooldown
    expect(agent.moveCooldowns?.[move.id]).toBeUndefined();
  });

  it("a fast agent moves toward its goal in fewer world ticks than a slow one", () => {
    function thirstyWorld(speed: number): { world: ReturnType<typeof createWorld>; agent: Agent } {
      const world = createWorld(20, 1);
      setTile(world, "surface", 19, 0, "water");
      const agent = makeAgent({
        needs: createNeeds({ thirst: 0.1 }),
        stats: { maxHp: 1, attack: 1, defense: 1, spAttack: 1, spDefense: 1, speed },
      });
      world.agents.push(agent);
      return { world, agent };
    }

    const fast = thirstyWorld(37);
    const slow = thirstyWorld(9);
    const TICKS = 20;
    for (let i = 0; i < TICKS; i++) {
      tickWorld(fast.world);
      tickWorld(slow.world);
    }

    expect(fast.agent.pos.x).toBeGreaterThan(slow.agent.pos.x);
  });
});

describe("day/night events (see DESIGN.md's Phase 2)", () => {
  it("fires exactly one nightfall and one daybreak per full cycle, each at the real tick the phase actually flips", () => {
    const world = createWorld(3, 3);
    const log = new EventLog();

    for (let i = 0; i < DAY_LENGTH_TICKS; i++) {
      tickWorld(world, log);
    }

    const nightfalls = log.events.filter((e) => e.kind === "nightfall");
    const daybreaks = log.events.filter((e) => e.kind === "daybreak");
    expect(nightfalls).toHaveLength(1);
    expect(daybreaks).toHaveLength(1);

    // Each event's own tick is exactly where isNight actually flips value —
    // not fired early/late, and not fired on every tick.
    for (const event of [...nightfalls, ...daybreaks]) {
      if (event.kind !== "nightfall" && event.kind !== "daybreak") continue;
      expect(isNight(event.tick)).toBe(event.kind === "nightfall");
      expect(isNight(event.tick - 1)).toBe(event.kind === "daybreak");
      expect(event.lightLevel).toBeCloseTo(lightLevel(event.tick), 10);
    }
  });

  it("does not fire on every tick — most ticks produce neither event", () => {
    const world = createWorld(3, 3);
    const log = new EventLog();

    for (let i = 0; i < DAY_LENGTH_TICKS; i++) {
      tickWorld(world, log);
    }

    const dayNightEvents = log.events.filter((e) => e.kind === "nightfall" || e.kind === "daybreak");
    expect(dayNightEvents.length).toBeLessThan(DAY_LENGTH_TICKS / 4);
  });
});
