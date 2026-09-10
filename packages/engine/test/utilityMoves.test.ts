import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { maybeUseUtilityMove, maybeUseUtilityMoveInCombat } from "../src/utilityMoves.js";
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

  it("a drainNeeds move also applies its other utility effects in the same use, not just the drain", () => {
    // Regression guard for a real composition gap: `drainNeeds` used to
    // early-return, so any other utility field on the same move (Leech
    // Seed's own tree puts what it steals back into the ground via
    // `fertilityBoost`) was silently dead.
    const world = createWorld(10, 10, 1);
    const move = makeMove({
      id: "leech_seed",
      drainNeeds: { need: "hunger", amount: 0.2, radius: 4 },
      fertilityBoost: { amount: 0.25, radius: 0 },
    });
    const agent = makeAgent({ moves: [move], herdId: "h1", needs: createNeeds({ hunger: 0.5 }) });
    const target = makeAgent({ id: "victim", pos: { x: 7, y: 5 }, herdId: "h2", needs: createNeeds({ hunger: 0.6 }) });
    world.agents.push(agent, target);
    setTile(world, "surface", agent.pos.x, agent.pos.y, "floor");
    tileAt(world, "surface", agent.pos.x, agent.pos.y)!.fertility = 0.2;

    const fired = maybeUseUtilityMove(world, agent, undefined, alwaysFire);

    expect(fired).toBe(true);
    expect(agent.needs.hunger).toBeCloseTo(0.7, 5); // the drain still happens
    expect(target.needs.hunger).toBeCloseTo(0.4, 5);
    // ...and so does the soil enrichment, which used to be silently skipped
    expect(tileAt(world, "surface", agent.pos.x, agent.pos.y)!.fertility).toBeCloseTo(0.45, 5);
    expect(agent.moveCooldowns?.["leech_seed"]).toBe(10); // still exactly one useMove call, not two
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

/**
 * Widening the in-combat picker. Before this, `maybeUseUtilityMoveInCombat`
 * applied exactly three effect families — `selfHeal`, self `statChangeOnHit`
 * and `statusImmunityAura` — while the out-of-combat path applied several
 * more. That is why a status-move skill tree had only three usable levers:
 * everything a support move exists to do went dead the moment a fight
 * started.
 *
 * Each test below pairs the new lever with the control that shows it was
 * genuinely off before: the same move used through the SAME function with
 * the thing it needs absent.
 */
describe("maybeUseUtilityMoveInCombat: the widened lever set", () => {
  const opponent = () => makeAgent({ id: "opp", pos: { x: 6, y: 5 }, hp: 100, maxHp: 100 });

  it("heals a hurt herd-mate mid-fight, and does not fire with no ally in range (control)", () => {
    const world = createWorld(15, 15, 1);
    const user = makeAgent({ id: "user", herdId: "h", moves: [makeMove({ id: "mend", range: { min: 0, max: 3 }, allyEffect: { healFraction: 0.5 } })] });
    const ally = makeAgent({ id: "ally", herdId: "h", species: "bulbasaur", pos: { x: 6, y: 6 }, hp: 10, maxHp: 100 });
    const foe = opponent();
    world.agents.push(user, ally, foe);
    expect(maybeUseUtilityMoveInCombat(world, user, foe, undefined, alwaysFire)).toBe(true);
    expect(ally.hp!).toBeGreaterThan(10);

    // CONTROL: identical, but the ally is elsewhere entirely.
    const w2 = createWorld(15, 15, 1);
    const user2 = makeAgent({ id: "user", herdId: "h", moves: [makeMove({ id: "mend", range: { min: 0, max: 3 }, allyEffect: { healFraction: 0.5 } })] });
    const foe2 = opponent();
    w2.agents.push(user2, foe2);
    expect(maybeUseUtilityMoveInCombat(w2, user2, foe2, undefined, alwaysFire)).toBe(false);
  });

  it("drains a need off the opponent mid-fight", () => {
    const world = createWorld(15, 15, 1);
    const user = makeAgent({ id: "user", herdId: "h", moves: [makeMove({ id: "siphon", drainNeeds: { need: "hunger", amount: 0.3, radius: 3 } })] });
    const foe = opponent();
    foe.needs.hunger = 0.9;
    world.agents.push(user, foe);
    const before = foe.needs.hunger;
    expect(maybeUseUtilityMoveInCombat(world, user, foe, undefined, alwaysFire)).toBe(true);
    expect(foe.needs.hunger).toBeLessThan(before);
  });

  it("spawns real weather mid-fight", () => {
    const world = createWorld(15, 15, 1);
    const user = makeAgent({ id: "user", moves: [makeMove({ id: "downpour", spawnsRain: true })] });
    const foe = opponent();
    world.agents.push(user, foe);
    expect((world.weatherCells ?? []).length).toBe(0);
    expect(maybeUseUtilityMoveInCombat(world, user, foe, undefined, alwaysFire)).toBe(true);
    expect((world.weatherCells ?? []).some((c) => c.type === "rain")).toBe(true);
  });

  it("picks the most valuable candidate, not whichever sits first in the movepool", () => {
    const world = createWorld(15, 15, 1);
    // Movepool order puts the weather move first. Survival must still win.
    const user = makeAgent({
      id: "user",
      hp: 5,
      maxHp: 100,
      moves: [makeMove({ id: "downpour", spawnsRain: true }), makeMove({ id: "recover", selfHeal: { fraction: 0.5 } })],
    });
    const foe = opponent();
    world.agents.push(user, foe);
    expect(maybeUseUtilityMoveInCombat(world, user, foe, undefined, alwaysFire)).toBe(true);
    expect(user.hp!).toBeGreaterThan(5); // healed
    expect(user.moveCooldowns?.recover).toBeGreaterThan(0); // and it was recover that fired
    expect(world.weatherCells ?? []).toHaveLength(0); // downpour did not
  });

  it("does not spend an action on a ward against something with no status move (control)", () => {
    const world = createWorld(15, 15, 1);
    const user = makeAgent({ id: "user", moves: [makeMove({ id: "ward", statusImmunityAura: { ticks: 100, radius: 3 } })] });
    const harmless = opponent();
    harmless.moves = [makeMove({ id: "plain", utilityMove: false, statusChance: 0 })];
    world.agents.push(user, harmless);
    expect(maybeUseUtilityMoveInCombat(world, user, harmless, undefined, alwaysFire)).toBe(false);

    const venomous = opponent();
    venomous.moves = [makeMove({ id: "toxic", utilityMove: false, statusChance: 0.5, statusKind: "poison" })];
    const w2 = createWorld(15, 15, 1);
    const user2 = makeAgent({ id: "user", moves: [makeMove({ id: "ward", statusImmunityAura: { ticks: 100, radius: 3 } })] });
    w2.agents.push(user2, venomous);
    expect(maybeUseUtilityMoveInCombat(w2, user2, venomous, undefined, alwaysFire)).toBe(true);
  });
});
