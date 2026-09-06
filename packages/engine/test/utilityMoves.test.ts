import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { maybeUseUtilityMove } from "../src/utilityMoves.js";
import { getStatStage } from "../src/status.js";
import type { Agent } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    species: "bulbasaur",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    hp: 50,
    maxHp: 100,
    ...overrides,
  };
}

function makeMove(overrides: Partial<MoveSpec> = {}): MoveSpec {
  return {
    id: "test_move",
    name: "Test Move",
    shape: { kind: "point" },
    type: "normal",
    category: "status",
    power: 0,
    accuracy: 100,
    cooldownTicks: 10,
    utilityMove: true,
    ...overrides,
  };
}

const alwaysFire = () => 0; // clears the UTILITY_MOVE_USE_CHANCE roll every time

describe("maybeUseUtilityMove", () => {
  it("does nothing for an agent with no utilityMove-flagged moves", () => {
    const world = createWorld(10, 10, 1);
    const agent = makeAgent({ moves: [makeMove({ utilityMove: false })] });
    expect(maybeUseUtilityMove(world, agent, undefined, alwaysFire)).toBe(false);
  });

  it("skips a move still on cooldown", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "growth", selfHeal: { fraction: 0.5 } });
    const agent = makeAgent({ moves: [move], moveCooldowns: { growth: 5 }, hp: 10 });
    expect(maybeUseUtilityMove(world, agent, undefined, alwaysFire)).toBe(false);
    expect(agent.hp).toBe(10);
  });

  it("respects the per-tick use-chance roll", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "growth", selfHeal: { fraction: 0.5 } });
    const agent = makeAgent({ moves: [move], hp: 10 });
    const neverFire = () => 0.99; // above UTILITY_MOVE_USE_CHANCE (0.15)
    expect(maybeUseUtilityMove(world, agent, undefined, neverFire)).toBe(false);
    expect(agent.hp).toBe(10);
  });

  it("selfHeal restores a fraction of maxHp, plus a bonus fraction near a sunbeam tile", () => {
    const world = createWorld(10, 10, 1);
    setTile(world, "surface", 5, 5, "sunbeam");
    const move = makeMove({ id: "synthesis", selfHeal: { fraction: 0.1, sunbeamBonus: 0.2 } });
    const agent = makeAgent({ moves: [move], hp: 10, maxHp: 100 });

    expect(maybeUseUtilityMove(world, agent, undefined, alwaysFire)).toBe(true);

    expect(agent.hp).toBe(40); // 10 + (0.1 + 0.2) * 100
    expect(agent.moveCooldowns?.["synthesis"]).toBe(10);
  });

  it("selfHeal without a nearby sunbeam only applies the base fraction, and never exceeds maxHp", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "roost", selfHeal: { fraction: 0.5 } });
    const agent = makeAgent({ moves: [move], hp: 90, maxHp: 100 });

    maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(agent.hp).toBe(100); // 90 + 50 clamps to maxHp
  });

  it("fertilityBoost raises the fertility of every tile within radius (Chebyshev), not just the agent's own tile", () => {
    const world = createWorld(10, 10, 1);
    setTile(world, "surface", 5, 5, "floor");
    tileAt(world, "surface", 5, 5)!.fertility = 0.2;
    setTile(world, "surface", 6, 5, "floor");
    tileAt(world, "surface", 6, 5)!.fertility = 0.2;
    setTile(world, "surface", 8, 5, "floor");
    tileAt(world, "surface", 8, 5)!.fertility = 0.2; // outside radius 2

    const move = makeMove({ id: "grassy_terrain", fertilityBoost: { amount: 0.3, radius: 2 } });
    const agent = makeAgent({ moves: [move] });

    maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(tileAt(world, "surface", 5, 5)!.fertility).toBeCloseTo(0.5, 5);
    expect(tileAt(world, "surface", 6, 5)!.fertility).toBeCloseTo(0.5, 5);
    expect(tileAt(world, "surface", 8, 5)!.fertility).toBeCloseTo(0.2, 5); // untouched — out of radius
  });

  it("fertilityBoost with radius 0 only touches the agent's own tile (Growth)", () => {
    const world = createWorld(10, 10, 1);
    setTile(world, "surface", 5, 5, "floor");
    tileAt(world, "surface", 5, 5)!.fertility = 0.1;
    setTile(world, "surface", 6, 5, "floor");
    tileAt(world, "surface", 6, 5)!.fertility = 0.1;

    const move = makeMove({ id: "growth", fertilityBoost: { amount: 0.3, radius: 0 } });
    const agent = makeAgent({ moves: [move] });

    maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(tileAt(world, "surface", 5, 5)!.fertility).toBeCloseTo(0.4, 5);
    expect(tileAt(world, "surface", 6, 5)!.fertility).toBeCloseTo(0.1, 5);
  });

  it("a self statChangeOnHit move (Agility) applies a real stat stage, which actionSpeedOf's real multiplier stack now reads", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "agility", statChangeOnHit: { target: "self", stat: "speed", stage: 2, ticks: 40 } });
    const agent = makeAgent({ moves: [move] });

    maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(getStatStage(agent, "speed")).toBe(2);
  });

  it("statusImmunityAura grants the caster (and same-herd allies in range, not out-of-range or other-herd ones) new-status immunity", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "safeguard", statusImmunityAura: { ticks: 60, radius: 3 } });
    const agent = makeAgent({ moves: [move], herdId: "h1" });
    const nearAlly = makeAgent({ id: "ally-near", pos: { x: 6, y: 5 }, herdId: "h1" });
    const farAlly = makeAgent({ id: "ally-far", pos: { x: 9, y: 5 }, herdId: "h1" });
    const stranger = makeAgent({ id: "stranger", pos: { x: 6, y: 5 }, herdId: "h2" });
    world.agents.push(agent, nearAlly, farAlly, stranger);

    maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(agent.statusImmuneTicksRemaining).toBe(60);
    expect(nearAlly.statusImmuneTicksRemaining).toBe(60);
    expect(farAlly.statusImmuneTicksRemaining).toBeUndefined();
    expect(stranger.statusImmuneTicksRemaining).toBeUndefined();
  });

  it("spawnsRain creates a real rain WeatherCell centered on the caster's own position", () => {
    const world = createWorld(20, 20, 1);
    const move = makeMove({ id: "rain_dance", spawnsRain: true });
    const agent = makeAgent({ moves: [move], pos: { x: 8, y: 8 } });

    maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(world.weatherCells?.length).toBe(1);
    const cell = world.weatherCells![0]!;
    expect(cell.type).toBe("rain");
    expect(cell.center).toEqual({ x: 8, y: 8 });
  });

  it("matingRadiusBoost sets the agent's own boost counter", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "sweet_scent", matingRadiusBoost: { multiplier: 2, ticks: 60 } });
    const agent = makeAgent({ moves: [move] });

    maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(agent.matingRadiusBoostTicksRemaining).toBe(60);
  });

  it("drainNeeds transfers the target need from the nearest non-herd agent in range to the caster", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "leech_seed", drainNeeds: { need: "hunger", amount: 0.2, radius: 4 } });
    const agent = makeAgent({ moves: [move], herdId: "h1", needs: createNeeds({ hunger: 0.5 }) });
    const target = makeAgent({ id: "victim", pos: { x: 7, y: 5 }, herdId: "h2", needs: createNeeds({ hunger: 0.6 }) });
    world.agents.push(agent, target);

    const fired = maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(fired).toBe(true);
    expect(agent.needs.hunger).toBeCloseTo(0.7, 5);
    expect(target.needs.hunger).toBeCloseTo(0.4, 5);
    expect(agent.moveCooldowns?.["leech_seed"]).toBe(10);
  });

  it("drainNeeds ignores a same-herd agent as a target, even if it's the only one in range", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "leech_seed", drainNeeds: { need: "hunger", amount: 0.2, radius: 4 } });
    const agent = makeAgent({ moves: [move], herdId: "h1", needs: createNeeds({ hunger: 0.5 }) });
    const ally = makeAgent({ id: "ally", pos: { x: 7, y: 5 }, herdId: "h1", needs: createNeeds({ hunger: 0.6 }) });
    world.agents.push(agent, ally);

    const fired = maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(fired).toBe(false);
    expect(agent.needs.hunger).toBeCloseTo(0.5, 5);
    expect(ally.needs.hunger).toBeCloseTo(0.6, 5);
    expect(agent.moveCooldowns?.["leech_seed"]).toBeUndefined(); // no target found — not wasted on cooldown
  });

  it("drainNeeds with no valid target anywhere in range does not go on cooldown, so a later tick can try again", () => {
    const world = createWorld(10, 10, 1);
    const move = makeMove({ id: "leech_seed", drainNeeds: { need: "hunger", amount: 0.2, radius: 2 } });
    const agent = makeAgent({ moves: [move] });
    world.agents.push(agent);

    expect(maybeUseUtilityMove(world, agent, undefined, alwaysFire)).toBe(false);
    expect(agent.moveCooldowns?.["leech_seed"]).toBeUndefined();
  });

  it("only ever fires one move per call, even with multiple off-cooldown utility moves available", () => {
    const world = createWorld(10, 10, 1);
    const growth = makeMove({ id: "growth", fertilityBoost: { amount: 0.3, radius: 0 } });
    const roost = makeMove({ id: "roost", selfHeal: { fraction: 0.3 } });
    const agent = makeAgent({ moves: [growth, roost], hp: 10, maxHp: 100 });

    maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    const usedGrowth = agent.moveCooldowns?.["growth"] !== undefined;
    const usedRoost = agent.moveCooldowns?.["roost"] !== undefined;
    expect(usedGrowth !== usedRoost).toBe(true); // exactly one, not both
  });
});
