import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { isLitTile, isLightSource, playerVisibleTiles, tileIndex, updatePlayerVision, visionScope, LIT_TILE_SIGHT_RADIUS } from "../src/vision.js";
import { examineTile } from "../src/tileQuery.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct report: "Also stairs a are really hard to see. Make em have a light
 * radius like sunbeams."
 *
 * Stairs are the one thing in a cave run you HAVE to find, and they were the
 * only landmark with no light of their own — invisible until you walked onto
 * them. Making them a light source is the right lever rather than a palette
 * tweak, because it buys both halves at once: `LIT_TILE_SIGHT_RADIUS`
 * visibility through the dark, and undimmed rendering in fog.
 */

function caveWithPlayer(): { world: World; me: Agent } {
  const world = createWorld(40, 40, 5);
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) setTile(world, "underground", x, y, "floor");
  const me = {
    id: "player",
    species: "human",
    pos: { x: 5, y: 20 },
    layer: "underground",
    homeLayer: "underground",
    needs: { hunger: 1, thirst: 1, energy: 1 },
    behavior: "idle",
    controlledBy: "player",
    hp: 20,
    maxHp: 20,
  } as unknown as Agent;
  world.agents.push(me);
  return { world, me };
}

function canSee(world: World, me: Agent, x: number, y: number): boolean {
  return playerVisibleTiles(world, me).some((p) => p.x === x && p.y === y);
}

describe("stairs carry their own light", () => {
  it("a staircase is a light source; plain floor is not", () => {
    expect(isLightSource("stairsDown")).toBe(true);
    expect(isLightSource("stairsUp")).toBe(true);
    expect(isLightSource("exit")).toBe(true);
    expect(isLightSource("sunbeam")).toBe(true);
    expect(isLightSource("floor")).toBe(false);
    expect(isLightSource("stone")).toBe(false);
  });

  it("lights its eight neighbours, the same radius a sunbeam has", () => {
    const { world } = caveWithPlayer();
    setTile(world, "underground", 20, 20, "stairsDown");
    expect(isLitTile(world, "underground", { x: 20, y: 20 })).toBe(true);
    expect(isLitTile(world, "underground", { x: 21, y: 21 })).toBe(true);
    expect(isLitTile(world, "underground", { x: 22, y: 20 })).toBe(false);
  });

  /**
   * The measurement the report is actually about, with its control: the SAME
   * tile, at the SAME distance, in the SAME dark — once as bare floor and
   * once as a staircase. Without the control this only proves the player can
   * see, which was never in doubt.
   */
  it("is visible from across a dark room, where bare floor is not", () => {
    const far = { x: 16, y: 20 }; // 11 tiles off, well past PLAYER_SIGHT_RADIUS
    const control = caveWithPlayer();
    expect(canSee(control.world, control.me, far.x, far.y)).toBe(false);

    const lit = caveWithPlayer();
    setTile(lit.world, "underground", far.x, far.y, "stairsDown");
    expect(canSee(lit.world, lit.me, far.x, far.y)).toBe(true);
  });

  it("stops at the lit-tile sight radius, and a wall still blocks it", () => {
    const tooFar = caveWithPlayer();
    const beyond = { x: 5 + LIT_TILE_SIGHT_RADIUS + 2, y: 20 };
    setTile(tooFar.world, "underground", beyond.x, beyond.y, "stairsDown");
    expect(canSee(tooFar.world, tooFar.me, beyond.x, beyond.y)).toBe(false);

    const blocked = caveWithPlayer();
    setTile(blocked.world, "underground", 16, 20, "stairsDown");
    for (let y = 18; y <= 22; y++) setTile(blocked.world, "underground", 10, y, "wall");
    expect(canSee(blocked.world, blocked.me, 16, 20)).toBe(false);
  });

  it("seeing it from afar puts it in map memory, so it stays drawn", () => {
    const { world, me } = caveWithPlayer();
    setTile(world, "underground", 16, 20, "stairsDown");
    updatePlayerVision(world, me);
    const explored = me.vision!.explored[visionScope(world, "underground")]!;
    expect(explored.has(tileIndex(world, 16, 20))).toBe(true);
  });

  it("Look reports a staircase as lit", () => {
    const { world } = caveWithPlayer();
    setTile(world, "underground", 20, 20, "stairsUp");
    expect(examineTile(world, "underground", { x: 20, y: 20 })!.lit).toBe(true);
    expect(examineTile(world, "underground", { x: 25, y: 25 })!.lit).toBe(false);
  });

  it("standing beside stairs is full light, so your own sight radius opens up", () => {
    const dark = caveWithPlayer();
    const darkCount = playerVisibleTiles(dark.world, dark.me).length;

    const beside = caveWithPlayer();
    setTile(beside.world, "underground", 6, 20, "stairsDown");
    expect(playerVisibleTiles(beside.world, beside.me).length).toBeGreaterThan(darkCount);
  });
});
