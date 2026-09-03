import { describe, expect, it } from "vitest";
import { calculateDamage, pickBestMove, tickCooldowns, useMove } from "../src/combat.js";
import { calculateStats } from "../src/stats.js";
import { createNeeds } from "../src/needs.js";
import type { Agent } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

const TACKLE: MoveSpec = {
  id: "tackle",
  name: "Tackle",
  shape: { kind: "point" },
  type: "normal",
  category: "physical",
  power: 40,
  accuracy: 100,
  cooldownTicks: 0,
};

const EMBER: MoveSpec = {
  id: "ember",
  name: "Ember",
  shape: { kind: "point" },
  type: "fire",
  category: "special",
  power: 40,
  accuracy: 100,
  cooldownTicks: 2,
};

const BASE = { hp: 50, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 };

describe("calculateDamage", () => {
  it("deals more damage with STAB (same type as the attacker)", () => {
    const attacker = { level: 20, types: ["fire" as const], stats: calculateStats(BASE, 20) };
    const defender = { types: ["normal" as const], stats: calculateStats(BASE, 20) };
    const withStab = calculateDamage(attacker, defender, EMBER, 1);
    const withoutStab = calculateDamage({ ...attacker, types: ["water"] }, defender, EMBER, 1);
    expect(withStab.damage).toBeGreaterThan(withoutStab.damage);
    expect(withStab.stab).toBe(true);
  });

  it("deals double damage on a super-effective hit", () => {
    const attacker = { level: 20, types: ["fire" as const], stats: calculateStats(BASE, 20) };
    const grassDefender = { types: ["grass" as const], stats: calculateStats(BASE, 20) };
    const waterDefender = { types: ["water" as const], stats: calculateStats(BASE, 20) };
    const superEffective = calculateDamage(attacker, grassDefender, EMBER, 1);
    const resisted = calculateDamage(attacker, waterDefender, EMBER, 1);
    expect(superEffective.effectiveness).toBe(2);
    expect(resisted.effectiveness).toBe(0.5);
    expect(superEffective.damage).toBeGreaterThan(resisted.damage);
  });

  it("deals zero damage on an immune matchup, not the usual minimum of 1", () => {
    const attacker = { level: 20, types: ["normal" as const], stats: calculateStats(BASE, 20) };
    const ghost = { types: ["ghost" as const], stats: calculateStats(BASE, 20) };
    expect(calculateDamage(attacker, ghost, TACKLE, 1).damage).toBe(0);
  });

  it("scales with level and attacker/defender stat ratio", () => {
    const attacker = { level: 50, types: ["normal" as const], stats: calculateStats(BASE, 50) };
    const weakDefender = { types: ["normal" as const], stats: { ...calculateStats(BASE, 50), defense: 5 } };
    const toughDefender = { types: ["normal" as const], stats: { ...calculateStats(BASE, 50), defense: 500 } };
    expect(calculateDamage(attacker, weakDefender, TACKLE, 1).damage).toBeGreaterThan(
      calculateDamage(attacker, toughDefender, TACKLE, 1).damage
    );
  });
});

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

describe("cooldowns", () => {
  it("useMove sets a cooldown that pickBestMove then respects", () => {
    const agent = makeAgent({ moves: [EMBER] });
    expect(pickBestMove(agent, ["normal"])).toBe(EMBER);

    useMove(agent, EMBER);
    expect(pickBestMove(agent, ["normal"])).toBeUndefined();
  });

  it("tickCooldowns counts down and eventually frees the move up again", () => {
    const agent = makeAgent({ moves: [EMBER] });
    useMove(agent, EMBER);

    tickCooldowns(agent);
    expect(pickBestMove(agent, ["normal"])).toBeUndefined(); // cooldownTicks: 2, one tick down

    tickCooldowns(agent);
    expect(pickBestMove(agent, ["normal"])).toBe(EMBER); // now off cooldown
  });

  it("picks the higher-expected-damage move against the current defender's type", () => {
    const agent = makeAgent({ types: ["fire"], moves: [TACKLE, EMBER] });
    // Against a Grass defender, Ember (Fire, super effective + STAB) clearly beats Tackle (Normal, neutral, no STAB).
    expect(pickBestMove(agent, ["grass"])).toBe(EMBER);
  });
});
