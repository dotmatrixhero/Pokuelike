import { describe, expect, it } from "vitest";
import { resolveShape } from "../src/moves.js";

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
