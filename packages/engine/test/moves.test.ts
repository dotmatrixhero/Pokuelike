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
