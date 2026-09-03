import { describe, expect, it } from "vitest";
import {
  calculateDamage,
  pickBestMove,
  tickCooldowns,
  useMove,
  rollCritical,
  rollAccuracy,
  statStageMultiplier,
  accuracyStageMultiplier,
  CRIT_STAGE_CHANCE,
  CRITICAL_MULTIPLIER,
} from "../src/combat.js";
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

describe("critical hits", () => {
  it("rollCritical uses the mainline chance table by stage, deterministically with an injected rng", () => {
    // stage 0 chance is 1/24 — just under that roll always crits, just over never does.
    expect(rollCritical(0, () => 0)).toBe(true);
    expect(rollCritical(0, () => CRIT_STAGE_CHANCE[0] + 0.001)).toBe(false);
    // stage 3 ("always crit" in mainline) always crits regardless of roll.
    expect(rollCritical(3, () => 0.999)).toBe(true);
    // out-of-range stages clamp instead of throwing/indexing out of bounds.
    expect(rollCritical(99, () => 0.999)).toBe(true);
    expect(rollCritical(-5, () => 0.999)).toBe(false);
  });

  it("a critical hit multiplies damage by CRITICAL_MULTIPLIER over an otherwise-identical non-crit", () => {
    const attacker = { level: 20, types: ["normal" as const], stats: calculateStats(BASE, 20) };
    const defender = { types: ["normal" as const], stats: calculateStats(BASE, 20) };
    const normal = calculateDamage(attacker, defender, TACKLE, 1, false);
    const crit = calculateDamage(attacker, defender, TACKLE, 1, true);
    expect(crit.critical).toBe(true);
    expect(normal.critical).toBe(false);
    expect(crit.damage).toBe(Math.floor(normal.damage * CRITICAL_MULTIPLIER));
  });

  it("a crit ignores a defender's positive Defense stage (can't be softer than a normal hit)", () => {
    const attacker = { level: 20, types: ["normal" as const], stats: calculateStats(BASE, 20) };
    const boostedDefender = {
      types: ["normal" as const],
      stats: calculateStats(BASE, 20),
      statStages: { defense: 2 },
    };
    const normalHit = calculateDamage(attacker, boostedDefender, TACKLE, 1, false);
    const critHit = calculateDamage(attacker, boostedDefender, TACKLE, 1, true);
    // Without the crit ignoring the +2 Defense stage, crit damage could come out lower
    // than a normal hit against the *unboosted* stat despite the 1.5x multiplier.
    const unboostedNormalHit = calculateDamage(attacker, { ...boostedDefender, statStages: {} }, TACKLE, 1, false);
    expect(critHit.damage).toBe(Math.floor(unboostedNormalHit.damage * CRITICAL_MULTIPLIER));
    expect(critHit.damage).toBeGreaterThan(normalHit.damage);
  });
});

describe("stat stages", () => {
  it("statStageMultiplier matches the mainline table at a few known points", () => {
    expect(statStageMultiplier(0)).toBe(1);
    expect(statStageMultiplier(1)).toBeCloseTo(1.5, 5);
    expect(statStageMultiplier(-1)).toBeCloseTo(2 / 3, 5);
    expect(statStageMultiplier(6)).toBe(4);
    expect(statStageMultiplier(-6)).toBe(0.25);
    // clamps beyond +-6 instead of continuing to scale.
    expect(statStageMultiplier(12)).toBe(4);
    expect(statStageMultiplier(-12)).toBe(0.25);
  });

  it("a positive attacker stat stage actually increases damage dealt", () => {
    const boosted = {
      level: 20,
      types: ["normal" as const],
      stats: calculateStats(BASE, 20),
      statStages: { attack: 2 },
    };
    const neutral = { level: 20, types: ["normal" as const], stats: calculateStats(BASE, 20) };
    const defender = { types: ["normal" as const], stats: calculateStats(BASE, 20) };
    expect(calculateDamage(boosted, defender, TACKLE, 1).damage).toBeGreaterThan(
      calculateDamage(neutral, defender, TACKLE, 1).damage
    );
  });

  it("a positive defender stat stage actually reduces damage taken", () => {
    const attacker = { level: 20, types: ["normal" as const], stats: calculateStats(BASE, 20) };
    const toughened = { types: ["normal" as const], stats: calculateStats(BASE, 20), statStages: { defense: 2 } };
    const neutral = { types: ["normal" as const], stats: calculateStats(BASE, 20) };
    expect(calculateDamage(attacker, toughened, TACKLE, 1).damage).toBeLessThan(
      calculateDamage(attacker, neutral, TACKLE, 1).damage
    );
  });
});

describe("accuracy", () => {
  it("accuracyStageMultiplier matches the mainline (base-3) table at a few known points", () => {
    expect(accuracyStageMultiplier(0, 0)).toBe(1);
    expect(accuracyStageMultiplier(1, 0)).toBeCloseTo(4 / 3, 5);
    expect(accuracyStageMultiplier(0, 1)).toBeCloseTo(3 / 4, 5);
    expect(accuracyStageMultiplier(6, 0)).toBe(3);
    expect(accuracyStageMultiplier(0, 6)).toBeCloseTo(1 / 3, 5);
  });

  it("rollAccuracy can actually miss for a sub-100 accuracy move, deterministically with an injected rng", () => {
    const shakyMove = { accuracy: 50 };
    expect(rollAccuracy(shakyMove, 0, 0, () => 0.49)).toBe(true); // 49 < 50
    expect(rollAccuracy(shakyMove, 0, 0, () => 0.51)).toBe(false); // 51 >= 50
  });

  it("a negative accuracy (PokeRogue's 'always hits' convention) never misses regardless of roll", () => {
    const neverMisses = { accuracy: -1 };
    expect(rollAccuracy(neverMisses, 0, 0, () => 0.999)).toBe(true);
  });

  it("accuracy/evasion stages shift the effective hit chance", () => {
    const move = { accuracy: 50 };
    // At roll 0.55 (55% threshold), a neutral move at 50 base accuracy misses...
    expect(rollAccuracy(move, 0, 0, () => 0.55)).toBe(false);
    // ...but +1 accuracy stage (50 * 4/3 = 66.7%) turns that same roll into a hit.
    expect(rollAccuracy(move, 1, 0, () => 0.55)).toBe(true);
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
