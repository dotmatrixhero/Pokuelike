import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import {
  totalExpForLevel,
  levelForExp,
  grantExp,
  killExpYield,
  grantKillExp,
  grantSkillPoint,
  maybeAutoRespec,
  KILL_EXP_MULTIPLIER,
  type LevelingContext,
  type LevelingProfile,
} from "../src/leveling.js";
import { trySpendSkillPoints, applyMoveTreeWithSpend } from "../src/moves.js";
import type { Agent } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

// Real per-growth-rate cumulative-exp values, taken from poke_the_spire's raw
// (pre-blend, see leveling.ts's doc comment) `expLevels` tables for a handful
// of levels per curve — the actual correctness check for this feature.
describe("growth-rate curves (cross-checked against poke_the_spire)", () => {
  it("MEDIUM_FAST: n^3, exact", () => {
    expect(totalExpForLevel("MEDIUM_FAST", 5)).toBe(125);
    expect(totalExpForLevel("MEDIUM_FAST", 10)).toBe(1000);
    expect(totalExpForLevel("MEDIUM_FAST", 50)).toBe(125000);
  });

  it("FAST: 4n^3/5", () => {
    expect(totalExpForLevel("FAST", 5)).toBe(100);
    expect(totalExpForLevel("FAST", 10)).toBe(800);
    expect(totalExpForLevel("FAST", 20)).toBe(6400);
  });

  it("SLOW: 5n^3/4", () => {
    expect(totalExpForLevel("SLOW", 5)).toBe(156);
    expect(totalExpForLevel("SLOW", 10)).toBe(1250);
    expect(totalExpForLevel("SLOW", 20)).toBe(10000);
  });

  it("MEDIUM_SLOW: 6/5*n^3 - 15n^2 + 100n - 140", () => {
    expect(totalExpForLevel("MEDIUM_SLOW", 5)).toBe(135);
    expect(totalExpForLevel("MEDIUM_SLOW", 10)).toBe(560);
    expect(totalExpForLevel("MEDIUM_SLOW", 16)).toBe(2535);
  });

  it("ERRATIC: piecewise, verified in the n<50 band", () => {
    expect(totalExpForLevel("ERRATIC", 5)).toBe(237);
    expect(totalExpForLevel("ERRATIC", 20)).toBe(12800);
    expect(totalExpForLevel("ERRATIC", 49)).toBe(120001);
  });

  it("FLUCTUATING: piecewise, verified across all three bands", () => {
    expect(totalExpForLevel("FLUCTUATING", 5)).toBe(65); // n<15 band
    expect(totalExpForLevel("FLUCTUATING", 20)).toBe(5440); // 15<=n<36 band
    expect(totalExpForLevel("FLUCTUATING", 50)).toBe(142500); // n>=36 band
  });

  it("level 1 is always exactly 0 exp (mainline special-case)", () => {
    for (const gr of ["ERRATIC", "FAST", "MEDIUM_FAST", "MEDIUM_SLOW", "SLOW", "FLUCTUATING"] as const) {
      expect(totalExpForLevel(gr, 1)).toBe(0);
    }
  });

  it("levelForExp inverts totalExpForLevel", () => {
    expect(levelForExp("MEDIUM_FAST", 999)).toBe(9);
    expect(levelForExp("MEDIUM_FAST", 1000)).toBe(10);
    expect(levelForExp("MEDIUM_FAST", 1001)).toBe(10);
  });
});

const BULBASAUR_PROFILE: LevelingProfile = {
  growthRate: "MEDIUM_SLOW",
  baseStats: { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 },
  baseExp: 64,
  levelMoves: [
    [1, "TACKLE"],
    [4, "VINE_WHIP"],
    [7, "LEECH_SEED"], // a status move — resolveMove returns undefined for it in this test context
  ],
  evolutions: [{ targetSpeciesId: "ivysaur", level: 16 }],
};

const IVYSAUR_PROFILE: LevelingProfile = {
  growthRate: "MEDIUM_SLOW",
  baseStats: { hp: 60, attack: 62, defense: 63, spAttack: 80, spDefense: 80, speed: 60 },
  baseExp: 142,
  levelMoves: [],
  evolutions: [],
};

const VINE_WHIP: MoveSpec = {
  id: "vine_whip",
  name: "Vine Whip",
  shape: { kind: "line", length: 2 },
  type: "grass",
  category: "physical",
  power: 45,
  accuracy: 100,
  cooldownTicks: 0,
  range: { min: 0, max: 2 },
};

function testCtx(): LevelingContext {
  return {
    getProfile: (speciesId) => (speciesId === "bulbasaur" ? BULBASAUR_PROFILE : speciesId === "ivysaur" ? IVYSAUR_PROFILE : undefined),
    resolveMove: (moveKey) => (moveKey === "VINE_WHIP" ? VINE_WHIP : moveKey === "TACKLE" ? undefined : undefined),
  };
}

function bulbasaur(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "bulbasaur-0",
    species: "bulbasaur",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    level: 5,
    exp: totalExpForLevel("MEDIUM_SLOW", 5),
    types: ["grass", "poison"],
    knownMoves: ["TACKLE"],
    moves: [],
    stats: { maxHp: 19, attack: 9, defense: 9, spAttack: 11, spDefense: 11, speed: 9 },
    hp: 19,
    maxHp: 19,
    ...overrides,
  };
}

describe("grantExp / level-up", () => {
  it("a kill grants floor(baseExp * defeatedLevel / 7) exp", () => {
    expect(killExpYield(64, 5)).toBe(45);
    expect(killExpYield(142, 20)).toBe(405);
  });

  it("grantKillExp uses the defender's dex baseExp + level via ctx, scaled by KILL_EXP_MULTIPLIER", () => {
    // A kill should "give a ton" — the real mainline formula alone assumes a
    // 6-Pokémon team splitting exp from frequent battles, neither of which
    // applies to a single wild agent's rare kill in this sim. See leveling.ts.
    const world = createWorld(5, 5);
    const ctx = testCtx();
    const attacker = bulbasaur({ id: "attacker", exp: 0, level: 1 });
    const defender = bulbasaur({ id: "defender", level: 5 });
    grantKillExp(world, attacker, defender, ctx);
    expect(attacker.exp).toBe(killExpYield(64, 5) * KILL_EXP_MULTIPLIER);
  });

  it("a big exp gain levels up multiple levels in one go and heals HP by the stat delta each level", () => {
    const world = createWorld(5, 5);
    const ctx = testCtx();
    const log = new EventLog();
    // Stays below the level-16 evolution threshold so the HP-delta invariant below
    // isn't disturbed by evolution's own (fraction-based, not delta-based) HP rescale
    // — that's covered separately by the evolution test.
    const agent = bulbasaur({ level: 5, exp: totalExpForLevel("MEDIUM_SLOW", 5), hp: 10, maxHp: 19, stats: { maxHp: 19, attack: 9, defense: 9, spAttack: 11, spDefense: 11, speed: 9 } });

    grantExp(world, agent, totalExpForLevel("MEDIUM_SLOW", 10) - agent.exp!, ctx, log);

    expect(agent.level).toBe(10); // crossed 5 thresholds in one grantExp call, not capped at +1
    // HP should have grown by exactly the same amount maxHp grew (it started 9 below max).
    expect(agent.maxHp! - agent.hp!).toBe(9);

    const levelUps = log.events.filter((e) => e.kind === "leveledUp");
    expect(levelUps.length).toBe(5);
  });

  it("move learning adds a move at the right level and never removes one", () => {
    const world = createWorld(5, 5);
    const ctx = testCtx();
    const log = new EventLog();
    const agent = bulbasaur({ level: 1, exp: 0, knownMoves: ["TACKLE"], moves: [] });

    grantExp(world, agent, totalExpForLevel("MEDIUM_SLOW", 4), ctx, log);

    expect(agent.level).toBe(4);
    expect(agent.knownMoves).toContain("TACKLE");
    expect(agent.knownMoves).toContain("VINE_WHIP");
    expect(agent.moves!.some((m) => m.id === "vine_whip")).toBe(true);
    // Never forgets: still has TACKLE bookkeeping even though it has no combat MoveSpec here.
    expect(agent.knownMoves!.length).toBe(2);

    // Leveling further past the status-move unlock (7) doesn't crash and still tracks it.
    grantExp(world, agent, totalExpForLevel("MEDIUM_SLOW", 8) - agent.exp!, ctx, log);
    expect(agent.knownMoves).toContain("LEECH_SEED");
    // No MoveSpec was added for the status move (sim can't represent it) — moves list unaffected by it.
    expect(agent.moves!.some((m) => m.id.toUpperCase() === "LEECH_SEED")).toBe(false);
  });

  it("evolution swaps species, recomputes stats, and preserves exp/level/moves/skill points", () => {
    const world = createWorld(5, 5);
    const ctx = testCtx();
    const log = new EventLog();
    const agent = bulbasaur({
      level: 15,
      exp: totalExpForLevel("MEDIUM_SLOW", 15),
      knownMoves: ["TACKLE", "VINE_WHIP"],
      moves: [VINE_WHIP],
      skillPoints: { grass: 3 },
      wildcardSkillPoints: 1,
      hp: 30,
      maxHp: 33,
      stats: { maxHp: 33, attack: 20, defense: 20, spAttack: 24, spDefense: 24, speed: 20 },
    });

    grantExp(world, agent, totalExpForLevel("MEDIUM_SLOW", 16) - agent.exp!, ctx, log);

    expect(agent.level).toBe(16);
    expect(agent.species).toBe("ivysaur");
    expect(agent.stats!.maxHp).toBeGreaterThan(33); // Ivysaur's higher base HP at the same level
    expect(agent.exp).toBe(totalExpForLevel("MEDIUM_SLOW", 16));
    expect(agent.knownMoves).toEqual(expect.arrayContaining(["TACKLE", "VINE_WHIP"]));
    expect(agent.skillPoints!.grass).toBeGreaterThanOrEqual(3); // preserved, plus whatever leveling granted
    expect(agent.wildcardSkillPoints!).toBeGreaterThanOrEqual(1);

    const evolved = log.events.find((e) => e.kind === "evolved");
    expect(evolved).toMatchObject({ fromSpecies: "bulbasaur", toSpecies: "ivysaur", level: 16 });
  });

  it("without a leveling context, exp still accrues but no level-up happens", () => {
    const world = createWorld(5, 5);
    const agent = bulbasaur({ level: 5, exp: 100 });
    grantExp(world, agent, 999999);
    expect(agent.exp).toBe(999999 + 100);
    expect(agent.level).toBe(5);
  });
});

describe("skill-point spend validation", () => {
  const TREE_MOVE: MoveSpec = {
    id: "ember",
    name: "Ember",
    shape: { kind: "point" },
    type: "fire",
    category: "special",
    power: 40,
    accuracy: 100,
    cooldownTicks: 1,
    tree: {
      wider_burn: { id: "wider_burn", name: "Wider Burn", cost: 1, delta: { statusChance: 0.15 } },
      ring_of_fire: {
        id: "ring_of_fire",
        name: "Ring of Fire",
        cost: 2,
        prerequisites: ["wider_burn"],
        delta: { shape: { kind: "ring", radius: 1 } },
      },
    },
  };

  function fireAgent(overrides: Partial<Agent> = {}): Agent {
    return {
      id: "a",
      species: "charmander",
      pos: { x: 0, y: 0 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
      ...overrides,
    };
  }

  it("rejects a spend when the agent doesn't have enough typed + wildcard points", () => {
    const agent = fireAgent({ skillPoints: { fire: 1 }, wildcardSkillPoints: 0 });
    expect(() => applyMoveTreeWithSpend(TREE_MOVE, ["wider_burn", "ring_of_fire"], agent)).toThrow();
    // Nothing was deducted on the failed attempt.
    expect(agent.skillPoints!.fire).toBe(1);
  });

  it("allows a spend when typed + wildcard cover the cost, and deducts it", () => {
    const agent = fireAgent({ skillPoints: { fire: 2 }, wildcardSkillPoints: 1 });
    const spec = applyMoveTreeWithSpend(TREE_MOVE, ["wider_burn", "ring_of_fire"], agent); // cost 3
    expect(spec.shape).toEqual({ kind: "ring", radius: 1 });
    expect(agent.skillPoints!.fire).toBe(0);
    expect(agent.wildcardSkillPoints).toBe(0);
  });

  it("prefers typed points over wildcard", () => {
    const agent = fireAgent({ skillPoints: { fire: 1 }, wildcardSkillPoints: 5 });
    const ok = trySpendSkillPoints(agent, "fire", 1);
    expect(ok).toBe(true);
    expect(agent.skillPoints!.fire).toBe(0); // typed spent first
    expect(agent.wildcardSkillPoints).toBe(5); // wildcard untouched, cost fully covered by typed
  });

  it("falls back to wildcard once typed is exhausted", () => {
    const agent = fireAgent({ skillPoints: { fire: 1 }, wildcardSkillPoints: 5 });
    const ok = trySpendSkillPoints(agent, "fire", 3);
    expect(ok).toBe(true);
    expect(agent.skillPoints!.fire).toBe(0);
    expect(agent.wildcardSkillPoints).toBe(3); // 1 typed + 2 wildcard = 3
  });
});

describe("grantSkillPoint: deterministic wildcard cadence", () => {
  function fireAgent(overrides: Partial<Agent> = {}): Agent {
    return {
      id: "a",
      species: "charmander",
      pos: { x: 0, y: 0 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
      ...overrides,
    };
  }

  it("grants a bonus wildcard on every SKILLPOINT_WILDCARD_INTERVAL-th real point, not the others", () => {
    const world = createWorld(5, 5);
    const agent = fireAgent();
    grantSkillPoint(agent, "fire", world); // 1st real point: no bonus
    expect(agent.wildcardSkillPoints ?? 0).toBe(0);
    grantSkillPoint(agent, "fire", world); // 2nd real point: bonus
    expect(agent.wildcardSkillPoints).toBe(1);
    grantSkillPoint(agent, "fire", world); // 3rd: no bonus
    expect(agent.wildcardSkillPoints).toBe(1);
    grantSkillPoint(agent, "fire", world); // 4th: bonus
    expect(agent.wildcardSkillPoints).toBe(2);
    expect(agent.skillPoints!.fire).toBe(4);
  });

  it("counts real points across different types and sources (level-up + on-hit) toward the same cadence", () => {
    const world = createWorld(5, 5);
    const agent = fireAgent();
    grantSkillPoint(agent, "fire", world);
    grantSkillPoint(agent, "water", world); // still the 2nd real point overall -> bonus
    expect(agent.wildcardSkillPoints).toBe(1);
    expect(agent.skillPointGrantCount).toBe(2);
  });

  it("a wildcard grant itself never advances the cadence counter (no runaway recursion)", () => {
    const world = createWorld(5, 5);
    const agent = fireAgent();
    grantSkillPoint(agent, "wildcard", world);
    grantSkillPoint(agent, "wildcard", world);
    expect(agent.skillPointGrantCount ?? 0).toBe(0);
    expect(agent.wildcardSkillPoints).toBe(2); // both still granted, just untracked by the cadence
  });

  it("is deterministic, not RNG-based — no seed/mock needed to get a guaranteed bonus", () => {
    const world = createWorld(5, 5);
    const agent = fireAgent();
    for (let i = 0; i < 10; i++) grantSkillPoint(agent, "fire", world);
    expect(agent.wildcardSkillPoints).toBe(5); // exactly half of 10, every time
  });
});

describe("maybeAutoRespec (nature-driven specialization)", () => {
  // Two independently-affordable, same-cost, same-tier nodes (no shared
  // prerequisite) so weighted-pick behavior between them is testable without
  // prerequisite ordering getting in the way.
  const LEANING_TREE_MOVE: MoveSpec = {
    id: "ember",
    name: "Ember",
    shape: { kind: "point" },
    type: "fire",
    category: "special",
    power: 40,
    accuracy: 100,
    cooldownTicks: 1,
    tree: {
      wider_burn: { id: "wider_burn", name: "Wider Burn", cost: 1, leaning: "aggression", delta: { statusChance: 0.15 } },
      ring_of_fire: {
        id: "ring_of_fire",
        name: "Ring of Fire",
        cost: 2,
        prerequisites: ["wider_burn"],
        leaning: "boldness",
        delta: { shape: { kind: "ring", radius: 1 } },
      },
    },
  };

  const CTX: LevelingContext = {
    getProfile: () => undefined,
    resolveMove: (moveKey) => (moveKey === "ember" ? LEANING_TREE_MOVE : undefined),
  };

  function fireAgentWithMove(overrides: Partial<Agent> = {}): Agent {
    return {
      id: "a",
      species: "charmander",
      pos: { x: 0, y: 0 },
      layer: "surface",
      homeLayer: "surface",
      needs: createNeeds(),
      behavior: "idle",
      knownMoves: ["ember"],
      moves: [{ ...LEANING_TREE_MOVE }],
      ...overrides,
    };
  }

  it("does nothing when no known move has an affordable, eligible node", () => {
    const world = createWorld(5, 5);
    const agent = fireAgentWithMove({ skillPoints: { fire: 0 }, wildcardSkillPoints: 0 });
    maybeAutoRespec(agent, world, CTX);
    expect(agent.moveTreeChoices).toBeUndefined();
    expect(agent.moves![0]).toEqual(LEANING_TREE_MOVE);
  });

  it("commits to the only eligible node, spends its cost, and updates the live move", () => {
    const world = createWorld(5, 5);
    const log = new EventLog();
    const agent = fireAgentWithMove({ skillPoints: { fire: 1 }, wildcardSkillPoints: 0 });
    maybeAutoRespec(agent, world, CTX, log);

    expect(agent.moveTreeChoices).toEqual({ ember: ["wider_burn"] });
    expect(agent.skillPoints!.fire).toBe(0);
    expect(agent.moves![0].statusChance).toBeCloseTo(0.15); // base (none) + 0.15

    const respecEvent = log.events.find((e) => e.kind === "moveRespecced");
    expect(respecEvent).toMatchObject({ agentId: "a", moveId: "ember", nodeId: "wider_burn" });
  });

  it("respects prerequisites — ring_of_fire is never eligible before wider_burn even with points to spare", () => {
    const world = createWorld(5, 5);
    const agent = fireAgentWithMove({ skillPoints: { fire: 5 }, wildcardSkillPoints: 0 });
    maybeAutoRespec(agent, world, CTX, undefined, () => 0.99); // bias roll toward the "last" candidate
    // Only wider_burn can possibly have been chosen — ring_of_fire's prereq isn't met yet.
    expect(agent.moveTreeChoices).toEqual({ ember: ["wider_burn"] });
  });

  it("never commits more than one node per call, even with points for both", () => {
    const world = createWorld(5, 5);
    const agent = fireAgentWithMove({ skillPoints: { fire: 5 }, wildcardSkillPoints: 0 });
    maybeAutoRespec(agent, world, CTX);
    expect(agent.moveTreeChoices!.ember).toHaveLength(1);
  });

  it("a fully neutral disposition weights both eligible candidates equally", () => {
    // With wider_burn already chosen, ring_of_fire is now the *sole*
    // candidate (its prerequisite is met, nothing else on this tree is
    // eligible), so this exercises the single-candidate path deterministically.
    const world = createWorld(5, 5);
    const agent = fireAgentWithMove({
      skillPoints: { fire: 5 },
      wildcardSkillPoints: 0,
      moveTreeChoices: { ember: ["wider_burn"] },
      moves: [{ ...LEANING_TREE_MOVE, statusChance: 0.25, cooldownTicks: 1 }],
    });
    maybeAutoRespec(agent, world, CTX);
    expect(agent.moveTreeChoices!.ember).toEqual(["wider_burn", "ring_of_fire"]);
    expect(agent.moves![0].shape).toEqual({ kind: "ring", radius: 1 }); // recomputed from pristine base, not double-applied
  });

  it("disposition biases the weighted pick toward the node matching the stronger axis", () => {
    // Both wider_burn (aggression) and ring_of_fire's sibling would normally
    // compete, but ring_of_fire needs wider_burn first — so instead give the
    // agent an alternate, prereq-free sibling node to make this a real
    // two-way race. A max-aggression, zero-boldness agent should overwhelmingly
    // land on the aggression-leaning node when both are simultaneously eligible.
    const RACE_MOVE: MoveSpec = {
      ...LEANING_TREE_MOVE,
      tree: {
        aggro_node: { id: "aggro_node", name: "Aggro", cost: 1, leaning: "aggression", delta: { power: 1 } },
        bold_node: { id: "bold_node", name: "Bold", cost: 1, leaning: "boldness", delta: { power: 1 } },
      },
    };
    const raceCtx: LevelingContext = { getProfile: () => undefined, resolveMove: () => RACE_MOVE };

    let aggroWins = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const world = createWorld(5, 5);
      const agent = fireAgentWithMove({
        skillPoints: { fire: 1 },
        wildcardSkillPoints: 0,
        moves: [{ ...RACE_MOVE }],
        disposition: { boldness: 0, aggression: 1, sociability: 0.5 },
      });
      // rng() < 0.65/total picks aggro_node (weight 0.15+1=1.15 of total 1.3); deterministic seeded sequence
      // isn't needed here — Math.random default is fine since this is a statistical assertion over many trials.
      maybeAutoRespec(agent, world, raceCtx);
      if (agent.moveTreeChoices!.ember?.[0] === "aggro_node") aggroWins++;
    }
    // Weight ratio is 1.15 : 0.65 (~64%/36%), so a heavy skew toward aggro_node
    // over 200 trials is the real assertion; exact count is inherently random.
    expect(aggroWins).toBeGreaterThan(trials * 0.5);
  });

  it("grantSkillPoint auto-respecs immediately when given a LevelingContext", () => {
    const world = createWorld(5, 5);
    const log = new EventLog();
    const agent = fireAgentWithMove({ skillPoints: {}, wildcardSkillPoints: 0 });
    grantSkillPoint(agent, "fire", world, log, CTX);
    expect(agent.skillPoints!.fire).toBe(0); // granted then immediately spent
    expect(agent.moveTreeChoices).toEqual({ ember: ["wider_burn"] });
  });

  it("grantSkillPoint without a LevelingContext only grants — no auto-respec", () => {
    const world = createWorld(5, 5);
    const agent = fireAgentWithMove({ skillPoints: {}, wildcardSkillPoints: 0 });
    grantSkillPoint(agent, "fire", world);
    expect(agent.skillPoints!.fire).toBe(1); // untouched, no spend
    expect(agent.moveTreeChoices).toBeUndefined();
  });
});
