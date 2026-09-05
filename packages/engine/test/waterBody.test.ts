import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { LARGE_WATER_BODY_MIN_SIZE, isLargeWaterBody, waterBodySizeAt } from "../src/waterBody.js";

describe("waterBodySizeAt", () => {
  it("is 0 for a non-water tile", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 3, 3, "floor");
    expect(waterBodySizeAt(world, { x: 3, y: 3 })).toBe(0);
  });

  it("is 0 out of bounds", () => {
    const world = createWorld(10, 10);
    expect(waterBodySizeAt(world, { x: -1, y: 0 })).toBe(0);
    expect(waterBodySizeAt(world, { x: 0, y: 10 })).toBe(0);
  });

  it("is 1 for an isolated single water tile", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    expect(waterBodySizeAt(world, { x: 5, y: 5 })).toBe(1);
  });

  it("counts every tile in a straight line of 4-connected water as one body", () => {
    const world = createWorld(10, 10);
    for (let x = 0; x < 5; x++) setTile(world, "surface", x, 5, "water");
    for (let x = 0; x < 5; x++) expect(waterBodySizeAt(world, { x, y: 5 })).toBe(5);
  });

  it("does NOT connect two water tiles that only touch diagonally (4-connected, not 8)", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 3, 3, "water");
    setTile(world, "surface", 4, 4, "water"); // diagonal neighbor only
    expect(waterBodySizeAt(world, { x: 3, y: 3 })).toBe(1);
    expect(waterBodySizeAt(world, { x: 4, y: 4 })).toBe(1);
  });

  it("connects an L-shaped/irregular body via edge-adjacency and sizes every tile the same", () => {
    const world = createWorld(10, 10);
    const positions = [
      { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ];
    for (const p of positions) setTile(world, "surface", p.x, p.y, "water");
    for (const p of positions) expect(waterBodySizeAt(world, p)).toBe(positions.length);
  });

  it("treats two separate bodies (not adjacent at all) as independently sized", () => {
    const world = createWorld(20, 20);
    // A 3-tile body.
    setTile(world, "surface", 1, 1, "water");
    setTile(world, "surface", 2, 1, "water");
    setTile(world, "surface", 3, 1, "water");
    // A far-away 12-tile body (a 3x4 block).
    for (let y = 10; y < 13; y++) for (let x = 10; x < 14; x++) setTile(world, "surface", x, y, "water");

    expect(waterBodySizeAt(world, { x: 1, y: 1 })).toBe(3);
    expect(waterBodySizeAt(world, { x: 10, y: 10 })).toBe(12);
  });

  it("updates after a tile is added to a body (cache invalidation via setTile/resourceVersion)", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    expect(waterBodySizeAt(world, { x: 5, y: 5 })).toBe(1);

    setTile(world, "surface", 6, 5, "water"); // now adjacent — merges into one body
    expect(waterBodySizeAt(world, { x: 5, y: 5 })).toBe(2);
    expect(waterBodySizeAt(world, { x: 6, y: 5 })).toBe(2);
  });

  it("updates after a tile is removed from a body (drying/terraforming), splitting it if needed", () => {
    const world = createWorld(10, 10);
    // A 5-tile plus-shape body, center at (5,5).
    setTile(world, "surface", 5, 5, "water");
    setTile(world, "surface", 4, 5, "water");
    setTile(world, "surface", 6, 5, "water");
    setTile(world, "surface", 5, 4, "water");
    setTile(world, "surface", 5, 6, "water");
    expect(waterBodySizeAt(world, { x: 5, y: 5 })).toBe(5);

    setTile(world, "surface", 5, 5, "mud"); // remove the center — the arms are no longer connected
    expect(waterBodySizeAt(world, { x: 4, y: 5 })).toBe(1);
    expect(waterBodySizeAt(world, { x: 6, y: 5 })).toBe(1);
    expect(waterBodySizeAt(world, { x: 5, y: 4 })).toBe(1);
    expect(waterBodySizeAt(world, { x: 5, y: 6 })).toBe(1);
  });

  it("two independent World instances get independent caches (no shared module-level state)", () => {
    const worldA = createWorld(10, 10);
    setTile(worldA, "surface", 1, 1, "water");
    const worldB = createWorld(10, 10);
    setTile(worldB, "surface", 1, 1, "water");
    setTile(worldB, "surface", 2, 1, "water");

    expect(waterBodySizeAt(worldA, { x: 1, y: 1 })).toBe(1);
    expect(waterBodySizeAt(worldB, { x: 1, y: 1 })).toBe(2);
  });
});

describe("isLargeWaterBody", () => {
  it("is false below LARGE_WATER_BODY_MIN_SIZE and true at/above it", () => {
    expect(isLargeWaterBody(LARGE_WATER_BODY_MIN_SIZE - 1)).toBe(false);
    expect(isLargeWaterBody(LARGE_WATER_BODY_MIN_SIZE)).toBe(true);
    expect(isLargeWaterBody(LARGE_WATER_BODY_MIN_SIZE + 50)).toBe(true);
    expect(isLargeWaterBody(0)).toBe(false);
  });
});
