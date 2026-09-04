import { describe, expect, it } from "vitest";
import { resolveShape, applyMoveTree } from "../src/moves.js";
import type { MoveSpec } from "../src/moves.js";

describe("resolveShape", () => {
  it("point hits only the origin", () => {
    const tiles = resolveShape({ kind: "point" }, { x: 3, y: 3 }, "N");
    expect(tiles).toEqual([{ x: 3, y: 3 }]);
  });

  it("ring at radius 1 forms a hollow square around the origin", () => {
    const tiles = resolveShape({ kind: "ring", radius: 1 }, { x: 0, y: 0 }, "N");
    expect(tiles).toHaveLength(8);
    expect(tiles).not.toContainEqual({ x: 0, y: 0 });
  });

  it("cone widens with depth away from the origin, facing north", () => {
    const tiles = resolveShape({ kind: "cone", length: 2, width: 2 }, { x: 0, y: 0 }, "N");
    const depth1 = tiles.filter((t) => t.y === -1);
    const depth2 = tiles.filter((t) => t.y === -2);
    expect(depth2.length).toBeGreaterThan(depth1.length);
  });
});

const EMBER: MoveSpec = {
  id: "ember",
  name: "Ember",
  shape: { kind: "point" },
  type: "fire",
  category: "special",
  power: 40,
  accuracy: 100,
  cooldownTicks: 1,
  statusChance: 0.1,
  range: { min: 0, max: 1 },
  tree: {
    wider_burn: {
      id: "wider_burn",
      name: "Wider Burn",
      cost: 1,
      delta: { statusChance: 0.15, cooldownTicks: -1 },
    },
    ring_of_fire: {
      id: "ring_of_fire",
      name: "Ring of Fire",
      cost: 2,
      prerequisites: ["wider_burn"],
      delta: { shape: { kind: "ring", radius: 1 }, power: -10, cooldownTicks: 1 },
    },
  },
};

describe("applyMoveTree", () => {
  it("applies a single node's deltas on top of the base spec", () => {
    const respec = applyMoveTree(EMBER, ["wider_burn"]);
    expect(respec.statusChance).toBeCloseTo(0.25, 5);
    expect(respec.cooldownTicks).toBe(0);
    expect(respec.shape).toEqual({ kind: "point" }); // untouched by this node
  });

  it("applies multiple nodes in order, including a shape swap", () => {
    const respec = applyMoveTree(EMBER, ["wider_burn", "ring_of_fire"]);
    expect(respec.shape).toEqual({ kind: "ring", radius: 1 });
    expect(respec.power).toBe(30); // 40 - 10
    expect(respec.cooldownTicks).toBe(1); // 1 - 1 (wider_burn) + 1 (ring_of_fire)
  });

  it("rejects a selection missing a prerequisite", () => {
    expect(() => applyMoveTree(EMBER, ["ring_of_fire"])).toThrow(/requires/);
  });

  it("rejects an unknown node id", () => {
    expect(() => applyMoveTree(EMBER, ["not-a-real-node"])).toThrow(/no tree node/);
  });

  it("rejects a move with no tree at all", () => {
    const noTree: MoveSpec = { ...EMBER, id: "no-tree", tree: undefined };
    expect(() => applyMoveTree(noTree, ["wider_burn"])).toThrow(/no respec tree/);
  });

  it("is pure: never mutates the base spec passed in", () => {
    const shapeBefore = EMBER.shape;
    const rangeBefore = EMBER.range;
    const snapshot = JSON.parse(JSON.stringify(EMBER));

    applyMoveTree(EMBER, ["wider_burn", "ring_of_fire"]);

    expect(EMBER).toEqual(snapshot);
    expect(EMBER.shape).toBe(shapeBefore); // same reference, not just equal value
    expect(EMBER.range).toBe(rangeBefore);
  });
});

describe("applyMoveTree: excludes (real forks)", () => {
  const FORKED: MoveSpec = {
    id: "forked",
    name: "Forked",
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 0,
    tree: {
      opener: { id: "opener", name: "Opener", cost: 1, delta: { accuracy: 5 } },
      option_a: { id: "option_a", name: "Option A", cost: 1, prerequisites: ["opener"], excludes: ["option_b"], delta: { power: 20 } },
      option_b: { id: "option_b", name: "Option B", cost: 1, prerequisites: ["opener"], excludes: ["option_a"], delta: { accuracy: 20 } },
    },
  };

  it("allows either exclusive option on its own", () => {
    expect(applyMoveTree(FORKED, ["opener", "option_a"]).power).toBe(60);
    expect(applyMoveTree(FORKED, ["opener", "option_b"]).accuracy).toBe(125);
  });

  it("rejects choosing both sides of a fork", () => {
    expect(() => applyMoveTree(FORKED, ["opener", "option_a", "option_b"])).toThrow(/conflicts with already-chosen/);
  });

  it("catches the conflict regardless of which side declared excludes (one-sided authoring still works)", () => {
    const oneSided: MoveSpec = {
      ...FORKED,
      id: "one-sided",
      tree: {
        opener: FORKED.tree!.opener,
        option_a: { ...FORKED.tree!.option_a, excludes: ["option_b"] },
        option_b: { id: "option_b", name: "Option B", cost: 1, prerequisites: ["opener"], delta: { accuracy: 20 } }, // no excludes of its own
      },
    };
    expect(() => applyMoveTree(oneSided, ["opener", "option_b", "option_a"])).toThrow(/conflicts with already-chosen/);
  });
});

describe("applyMoveTree: prerequisitesAnyOf (crosslink shortcuts)", () => {
  const MESHED: MoveSpec = {
    id: "meshed",
    name: "Meshed",
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 0,
    tree: {
      branch_filler: { id: "branch_filler", name: "Branch Filler", cost: 1, delta: { accuracy: 5 } },
      crosslink: { id: "crosslink", name: "Crosslink", cost: 1, delta: { power: 5 } },
      shared_notable: {
        id: "shared_notable",
        name: "Shared Notable",
        cost: 1,
        prerequisitesAnyOf: [["branch_filler"], ["crosslink"]],
        delta: { power: 25 },
      },
    },
  };

  it("is reachable via the normal branch path", () => {
    const respec = applyMoveTree(MESHED, ["branch_filler", "shared_notable"]);
    expect(respec.power).toBe(65);
  });

  it("is also reachable via the alternative (crosslink) path alone", () => {
    const respec = applyMoveTree(MESHED, ["crosslink", "shared_notable"]);
    expect(respec.power).toBe(70);
  });

  it("rejects it when neither alternative set is satisfied", () => {
    expect(() => applyMoveTree(MESHED, ["shared_notable"])).toThrow(/alternative prerequisite set/);
  });
});

describe("applyMoveTree: forcedMovement delta (overwrite, like shape)", () => {
  const LUNGE: MoveSpec = {
    id: "lunge-move",
    name: "Lunge Move",
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 0,
    tree: {
      feint: {
        id: "feint",
        name: "Feint",
        cost: 1,
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" } },
      },
      retreat: {
        id: "retreat",
        name: "Retreat",
        cost: 1,
        prerequisites: ["feint"],
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 1, timing: "onHit" } },
      },
    },
  };

  it("has no forcedMovement by default", () => {
    expect(LUNGE.forcedMovement).toBeUndefined();
  });

  it("a node's forcedMovement delta applies to the respec'd spec", () => {
    const respec = applyMoveTree(LUNGE, ["feint"]);
    expect(respec.forcedMovement).toEqual({ mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" });
  });

  it("a later node's forcedMovement overwrites an earlier one, same as shape — never stacks", () => {
    const respec = applyMoveTree(LUNGE, ["feint", "retreat"]);
    expect(respec.forcedMovement).toEqual({ mover: "attacker", direction: "away", tiles: 1, timing: "onHit" });
  });

  it("is pure: never mutates the base spec's forcedMovement", () => {
    applyMoveTree(LUNGE, ["feint"]);
    expect(LUNGE.forcedMovement).toBeUndefined();
  });
});

describe("applyMoveTree: newer delta fields", () => {
  const KITCHEN_SINK: MoveSpec = {
    id: "kitchen-sink",
    name: "Kitchen Sink",
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 3,
    tree: {
      additive_stack: {
        id: "additive_stack",
        name: "Additive Stack",
        cost: 1,
        delta: { defensePenetration: 0.1, lockTicks: 1, critRateStage: 1, lifestealFraction: 0.1, recoilFraction: 0.05, jamCooldownTicks: 1 },
      },
      additive_stack_2: {
        id: "additive_stack_2",
        name: "Additive Stack 2",
        cost: 1,
        prerequisites: ["additive_stack"],
        delta: { defensePenetration: 0.1, lockTicks: 1, critRateStage: 1, lifestealFraction: 0.1, recoilFraction: 0.05, jamCooldownTicks: 1 },
      },
      overwrite_stack: {
        id: "overwrite_stack",
        name: "Overwrite Stack",
        cost: 1,
        delta: {
          hits: { min: 2, max: 3 },
          situationalBonus: { condition: "night", multiplier: 1.5 },
          statChangeOnHit: { target: "defender", stat: "defense", stage: -1 },
          positionSwap: true,
          targetsAlly: true,
          hitsArea: true,
          terrainBurn: true,
          statusSpreads: true,
          weightScaling: { factor: 0.5 },
          bonusVsType: { type: "grass", multiplier: 1.5 },
          resistanceBreaker: { multiplier: 2 },
          selfCostPerUse: { need: "energy", amount: 0.1 },
        },
      },
      overwrite_stack_2: {
        id: "overwrite_stack_2",
        name: "Overwrite Stack 2",
        cost: 1,
        prerequisites: ["overwrite_stack"],
        delta: {
          hits: { min: 3, max: 5 },
          situationalBonus: { condition: "flanking", multiplier: 2 },
          weightScaling: { factor: 1 },
          bonusVsType: { type: "water", multiplier: 2 },
          resistanceBreaker: { multiplier: 4 },
          selfCostPerUse: { need: "hunger", amount: 0.2 },
        },
      },
    },
  };

  it("applies additive fields cumulatively across multiple nodes", () => {
    const respec = applyMoveTree(KITCHEN_SINK, ["additive_stack", "additive_stack_2"]);
    expect(respec.defensePenetration).toBeCloseTo(0.2);
    expect(respec.lockTicks).toBe(2);
    expect(respec.critRateStage).toBe(2);
    expect(respec.lifestealFraction).toBeCloseTo(0.2);
    expect(respec.recoilFraction).toBeCloseTo(0.1);
    expect(respec.jamCooldownTicks).toBe(2);
  });

  it("overwrite fields take the latest node's value, never stacking", () => {
    const respec = applyMoveTree(KITCHEN_SINK, ["overwrite_stack", "overwrite_stack_2"]);
    expect(respec.hits).toEqual({ min: 3, max: 5 });
    expect(respec.situationalBonus).toEqual({ condition: "flanking", multiplier: 2 });
    expect(respec.weightScaling).toEqual({ factor: 1 });
    expect(respec.bonusVsType).toEqual({ type: "water", multiplier: 2 });
    expect(respec.resistanceBreaker).toEqual({ multiplier: 4 });
    expect(respec.selfCostPerUse).toEqual({ need: "hunger", amount: 0.2 });
    // Fields not touched by the second node keep the first node's value.
    expect(respec.positionSwap).toBe(true);
    expect(respec.targetsAlly).toBe(true);
    expect(respec.hitsArea).toBe(true);
    expect(respec.terrainBurn).toBe(true);
    expect(respec.statusSpreads).toBe(true);
    expect(respec.statChangeOnHit).toEqual({ target: "defender", stat: "defense", stage: -1 });
  });

  it("is pure: never mutates the base spec", () => {
    const snapshot = JSON.parse(JSON.stringify(KITCHEN_SINK));
    applyMoveTree(KITCHEN_SINK, ["additive_stack", "overwrite_stack"]);
    expect(KITCHEN_SINK).toEqual(snapshot);
  });
});
