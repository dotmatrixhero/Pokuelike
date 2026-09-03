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
