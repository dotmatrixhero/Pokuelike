import { describe, expect, it } from "vitest";
import { createWorld, setElevation } from "../src/world.js";
import { computeVisible } from "../src/fov.js";

describe("computeVisible", () => {
  it("sees flat ground within the base radius", () => {
    const world = createWorld(11, 11);
    const visible = computeVisible(world, "surface", { x: 5, y: 5 }, 3);

    expect(visible).toContainEqual({ x: 5, y: 8 });
    expect(visible).not.toContainEqual({ x: 5, y: 9 });
  });

  it("blocks sight over a ridge taller than both observer and target", () => {
    const world = createWorld(11, 1);
    setElevation(world, "surface", 5, 0, 3);

    const visible = computeVisible(world, "surface", { x: 2, y: 0 }, 10);

    expect(visible).not.toContainEqual({ x: 8, y: 0 });
  });

  it("extends sight radius when the observer stands on high ground", () => {
    const world = createWorld(21, 1);
    setElevation(world, "surface", 10, 0, 2);

    const visible = computeVisible(world, "surface", { x: 10, y: 0 }, 3);

    expect(visible).toContainEqual({ x: 16, y: 0 });
  });
});
