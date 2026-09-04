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
  moveRange,
  withinMoveRange,
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

  it("extraMultiplier (Phase 3's storm accuracy penalty) shifts the effective hit chance the same way stages do", () => {
    const move = { accuracy: 80 };
    // At roll 0.5 (50% threshold), a neutral 80-accuracy move hits...
    expect(rollAccuracy(move, 0, 0, () => 0.5)).toBe(true);
    // ...but a 0.6x extraMultiplier (80 * 0.6 = 48%) turns that same roll into a miss.
    expect(rollAccuracy(move, 0, 0, () => 0.5, 0.6)).toBe(false);
  });

  it("extraMultiplier defaults to 1 — every pre-existing call site unaffected", () => {
    const move = { accuracy: 70 };
    expect(rollAccuracy(move, 0, 0, () => 0.65)).toBe(rollAccuracy(move, 0, 0, () => 0.65, 1));
  });

  it("a negative accuracy ('always hits') still always hits regardless of extraMultiplier", () => {
    const neverMisses = { accuracy: -1 };
    expect(rollAccuracy(neverMisses, 0, 0, () => 0.999, 0.1)).toBe(true);
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

describe("move range", () => {
  const LINE_2: MoveSpec = { ...TACKLE, id: "line2", shape: { kind: "line", length: 2 }, range: { min: 0, max: 2 } };
  const NO_RANGE_LINE: MoveSpec = { ...TACKLE, id: "line-no-range", shape: { kind: "line", length: 3 } };
  const THROWN_ONLY: MoveSpec = { ...TACKLE, id: "thrown", range: { min: 2, max: 4 } };

  it("moveRange reads an explicit range.max when set", () => {
    expect(moveRange(LINE_2)).toBe(2);
  });

  it("moveRange falls back to deriving reach from shape when range is absent", () => {
    expect(moveRange(TACKLE)).toBe(1); // point
    expect(moveRange(NO_RANGE_LINE)).toBe(3); // line length 3
  });

  it("withinMoveRange honors both min and max", () => {
    expect(withinMoveRange(LINE_2, 0)).toBe(true);
    expect(withinMoveRange(LINE_2, 2)).toBe(true);
    expect(withinMoveRange(LINE_2, 3)).toBe(false);

    // A thrown-only move can't be used at melee (distance below its min).
    expect(withinMoveRange(THROWN_ONLY, 1)).toBe(false);
    expect(withinMoveRange(THROWN_ONLY, 3)).toBe(true);
    expect(withinMoveRange(THROWN_ONLY, 5)).toBe(false);
  });
});

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

describe("pickBestMove: range and tempo awareness", () => {
  const STRONG_SHORT_RANGE: MoveSpec = { ...TACKLE, id: "strong-short", power: 100, range: { min: 0, max: 1 } };
  const WEAK_LONG_RANGE: MoveSpec = { ...TACKLE, id: "weak-long", power: 20, range: { min: 0, max: 5 } };

  it("without a distance, ignores range and picks purely by score (backward-compatible)", () => {
    const agent = makeAgent({ moves: [STRONG_SHORT_RANGE, WEAK_LONG_RANGE] });
    expect(pickBestMove(agent, ["normal"])).toBe(STRONG_SHORT_RANGE);
  });

  it("with a distance, filters to reachable moves before scoring — the real bug this fixes", () => {
    const agent = makeAgent({ moves: [STRONG_SHORT_RANGE, WEAK_LONG_RANGE] });
    // STRONG_SHORT_RANGE can't reach distance 3; WEAK_LONG_RANGE can. Scoring
    // first and checking range after (the old behavior) would have picked
    // STRONG_SHORT_RANGE, found it out of range, and reported "no usable
    // move" even though WEAK_LONG_RANGE was perfectly usable from here.
    expect(pickBestMove(agent, ["normal"], 3)).toBe(WEAK_LONG_RANGE);
  });

  it("returns undefined when nothing owned actually reaches that far", () => {
    const agent = makeAgent({ moves: [STRONG_SHORT_RANGE, WEAK_LONG_RANGE] });
    expect(pickBestMove(agent, ["normal"], 10)).toBeUndefined();
  });

  it("tempo-discounts a slow move enough that a faster, weaker one can win", () => {
    const FAST_WEAK: MoveSpec = { ...TACKLE, id: "fast-weak", power: 30, cooldownTicks: 0 };
    const SLOW_STRONG: MoveSpec = { ...TACKLE, id: "slow-strong", power: 40, cooldownTicks: 3 };
    const agent = makeAgent({ moves: [FAST_WEAK, SLOW_STRONG] });
    // Same type, no STAB either side — isolates the tempo term:
    // 30 vs. 40 / (1 + 0.15*3) ≈ 27.6, so the weaker-but-faster move wins.
    expect(pickBestMove(agent, ["normal"])).toBe(FAST_WEAK);
  });
});
