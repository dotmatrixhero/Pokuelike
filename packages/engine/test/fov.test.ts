import { describe, expect, it } from "vitest";
import { createWorld, setElevation, setTile } from "../src/world.js";
import { computeVisible, isPathClear, NIGHT_FOV_PENALTY } from "../src/fov.js";

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

  it("a bush tile is effectively harder to see: visible at close range but not at the edge of the base radius", () => {
    const world = createWorld(21, 1);
    setTile(world, "surface", 15, 0, "bush");

    const closeUp = computeVisible(world, "surface", { x: 14, y: 0 }, 5);
    expect(closeUp).toContainEqual({ x: 15, y: 0 }); // distance 1 — well within range even with the penalty

    // Distance 5 (the base radius) with no obstruction would normally be
    // visible — the concealment penalty alone pushes it out of range.
    const atEdge = computeVisible(world, "surface", { x: 10, y: 0 }, 5);
    expect(atEdge).not.toContainEqual({ x: 15, y: 0 });
    // A non-concealed tile at the same true distance is still visible.
    expect(atEdge).toContainEqual({ x: 5, y: 0 });
  });

  it("a target on higher ground is effectively harder to see than the ridge-blocking rule alone accounts for", () => {
    const world = createWorld(21, 1);
    setElevation(world, "surface", 15, 0, 4); // elevated, but not tall enough to ridge-block (see hasLineOfSight)

    const fromLevel = computeVisible(world, "surface", { x: 10, y: 0 }, 5);
    // Raw distance 5 would normally be in range; the higher-ground penalty pushes it out.
    expect(fromLevel).not.toContainEqual({ x: 15, y: 0 });
  });

  it("a target on lower ground is effectively easier to see (a visibility bonus, not just neutral)", () => {
    const world = createWorld(21, 1);
    // Observer stays at elevation 0 (no ELEVATION_SIGHT_BONUS radius
    // extension in play) so this isolates the asymmetry effect specifically —
    // a target below the observer's own elevation.
    setElevation(world, "surface", 17, 0, -6);

    // Raw distance is 7, past the base radius of 5 — only the lower-ground
    // bonus (elevationDelta * ELEVATION_FOV_ASYMMETRY_PER_UNIT, negative
    // here) pulls its effective distance back under 5.
    const visible = computeVisible(world, "surface", { x: 10, y: 0 }, 5);
    expect(visible).toContainEqual({ x: 17, y: 0 });
  });
});

describe("computeVisible: night reduces FOV (see daynight.ts/DESIGN.md Phase 2)", () => {
  it("defaults to full daylight (lightLevel omitted) — every pre-existing elevation/ridge/concealment rule is unchanged", () => {
    const world = createWorld(11, 11);
    // Same assertions as the very first "sees flat ground" test above, called
    // without a lightLevel argument at all — proves the new parameter is
    // fully backward compatible for every caller that predates this feature.
    const visible = computeVisible(world, "surface", { x: 5, y: 5 }, 3);
    expect(visible).toContainEqual({ x: 5, y: 8 });
    expect(visible).not.toContainEqual({ x: 5, y: 9 });

    // And explicitly passing lightLevel 1 (full daylight) is identical to omitting it.
    const explicitDaylight = computeVisible(world, "surface", { x: 5, y: 5 }, 3, 1);
    expect(explicitDaylight).toEqual(visible);
  });

  it("still extends radius on high ground and still blocks over a ridge at full daylight", () => {
    const ridgeWorld = createWorld(11, 1);
    setElevation(ridgeWorld, "surface", 5, 0, 3);
    expect(computeVisible(ridgeWorld, "surface", { x: 2, y: 0 }, 10, 1)).not.toContainEqual({ x: 8, y: 0 });

    const highGroundWorld = createWorld(21, 1);
    setElevation(highGroundWorld, "surface", 10, 0, 2);
    expect(computeVisible(highGroundWorld, "surface", { x: 10, y: 0 }, 3, 1)).toContainEqual({ x: 16, y: 0 });
  });

  it("shrinks the visible radius at full darkness by a real, measurable amount", () => {
    const world = createWorld(21, 1);
    const origin = { x: 10, y: 0 };
    const baseRadius = 5;

    const daylight = computeVisible(world, "surface", origin, baseRadius, 1);
    const midnight = computeVisible(world, "surface", origin, baseRadius, 0);

    expect(daylight).toContainEqual({ x: 15, y: 0 }); // distance 5, in range at full daylight
    // At full darkness the radius shrinks by NIGHT_FOV_PENALTY (2.5) to 2.5 —
    // distance 5 is now well outside it.
    expect(midnight).not.toContainEqual({ x: 15, y: 0 });
    expect(midnight.length).toBeLessThan(daylight.length);

    // A tile still well within the shrunken radius stays visible.
    expect(midnight).toContainEqual({ x: 11, y: 0 }); // distance 1
  });

  it("scales linearly between full daylight and full darkness, and never goes negative", () => {
    const world = createWorld(5, 5);
    const halfLight = computeVisible(world, "surface", { x: 2, y: 2 }, 3, 0.5);
    const fullDark = computeVisible(world, "surface", { x: 2, y: 2 }, 3, 0);
    const fullLight = computeVisible(world, "surface", { x: 2, y: 2 }, 3, 1);

    // Half darkness is a real penalty (NIGHT_FOV_PENALTY / 2), strictly between full light and full dark.
    expect(halfLight.length).toBeLessThanOrEqual(fullLight.length);
    expect(halfLight.length).toBeGreaterThanOrEqual(fullDark.length);

    // A tiny base radius at full darkness still returns something sane (no negative-radius crash).
    const tinyRadius = computeVisible(world, "surface", { x: 2, y: 2 }, 1, 0);
    expect(tinyRadius).toContainEqual({ x: 2, y: 2 });
    expect(NIGHT_FOV_PENALTY).toBeGreaterThan(0);
  });
});

describe("isPathClear", () => {
  it("a clear straight line between two open tiles is unobstructed", () => {
    const world = createWorld(10, 1);
    expect(isPathClear(world, "surface", { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(true);
  });

  it("a tree or boulder between the endpoints blocks the path", () => {
    const world = createWorld(10, 1);
    setTile(world, "surface", 5, 0, "tree");
    expect(isPathClear(world, "surface", { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(false);

    const world2 = createWorld(10, 1);
    setTile(world2, "surface", 5, 0, "boulder");
    expect(isPathClear(world2, "surface", { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(false);
  });

  it("an obstacle at either endpoint itself doesn't block (only tiles strictly between do)", () => {
    const world = createWorld(10, 1);
    setTile(world, "surface", 9, 0, "tree"); // the target tile itself
    expect(isPathClear(world, "surface", { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(true);
  });
});
