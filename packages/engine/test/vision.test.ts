import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { lightLevel } from "../src/daynight.js";
import { advancePlayerTurn } from "../src/simulation.js";
import {
  ambientLightAt,
  canPlayerSee,
  isLitTile,
  LIT_TILE_SIGHT_RADIUS,
  PLAYER_SIGHT_RADIUS,
  playerVisibleTiles,
  tileIndex,
  updatePlayerVision,
  visionScope,
} from "../src/vision.js";
import { NIGHT_FOV_PENALTY } from "../src/fov.js";
import type { Agent, Layer } from "../src/types.js";

function player(x: number, y: number, layer: Layer = "underground"): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x, y },
    layer,
    homeLayer: layer,
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
  };
}

/** A 40x40 world whose underground is all open floor (createWorld's default grid). */
function openWorld() {
  return createWorld(40, 40, 1);
}

function sees(world: ReturnType<typeof openWorld>, me: Agent, x: number, y: number): boolean {
  return playerVisibleTiles(world, me).some((p) => p.x === x && p.y === y);
}

describe("ambient light (ROADMAP M2)", () => {
  it("on the surface it is the day/night clock", () => {
    const world = openWorld();
    expect(ambientLightAt(world, "surface", { x: 5, y: 5 }, 0)).toBe(lightLevel(0));
    expect(ambientLightAt(world, "surface", { x: 5, y: 5 }, 100)).toBe(lightLevel(100));
  });

  it("underground it is 0, except on or beside a sunbeam where it is 1", () => {
    const world = openWorld();
    expect(ambientLightAt(world, "underground", { x: 5, y: 5 }, 100)).toBe(0);
    setTile(world, "underground", 5, 5, "sunbeam");
    expect(isLitTile(world, "underground", { x: 5, y: 5 })).toBe(true);
    expect(isLitTile(world, "underground", { x: 6, y: 6 })).toBe(true);
    expect(isLitTile(world, "underground", { x: 7, y: 5 })).toBe(false);
    expect(ambientLightAt(world, "underground", { x: 6, y: 6 }, 100)).toBe(1);
  });
});

describe("playerVisibleTiles", () => {
  it("in the dark the radius is PLAYER_SIGHT_RADIUS minus NIGHT_FOV_PENALTY — about four tiles", () => {
    const world = openWorld();
    const me = player(20, 20);
    const dark = PLAYER_SIGHT_RADIUS - NIGHT_FOV_PENALTY;
    expect(dark).toBeGreaterThanOrEqual(4);
    expect(dark).toBeLessThan(5);
    expect(sees(world, me, 20, 20)).toBe(true);
    expect(sees(world, me, 20, 24)).toBe(true);
    expect(sees(world, me, 20, 25)).toBe(false);
    expect(sees(world, me, 20, 27)).toBe(false);
  });

  it("standing in a sunbeam underground, the full radius comes back", () => {
    const world = openWorld();
    setTile(world, "underground", 20, 20, "sunbeam");
    const me = player(20, 20);
    expect(sees(world, me, 20, 27)).toBe(true);
    expect(sees(world, me, 20, 28)).toBe(false);
  });

  it("a lit tile far down a dark tunnel is visible; the dark tunnel in between is not", () => {
    const world = openWorld();
    const me = player(20, 20);
    setTile(world, "underground", 20, 32, "sunbeam");
    // The sunbeam and the tiles it lights, 11-13 away — well past the dark radius.
    expect(sees(world, me, 20, 32)).toBe(true);
    expect(sees(world, me, 20, 31)).toBe(true);
    expect(sees(world, me, 21, 33)).toBe(true);
    // The unlit corridor between is still dark.
    expect(sees(world, me, 20, 28)).toBe(false);
    // Past LIT_TILE_SIGHT_RADIUS it is not.
    setTile(world, "underground", 20, 20 + LIT_TILE_SIGHT_RADIUS + 2, "sunbeam");
    expect(sees(world, me, 20, 20 + LIT_TILE_SIGHT_RADIUS + 2)).toBe(false);
  });

  it("a wall between you and the light hides it", () => {
    const world = openWorld();
    const me = player(20, 20);
    setTile(world, "underground", 20, 32, "sunbeam");
    for (let x = 15; x <= 25; x++) setTile(world, "underground", x, 26, "wall");
    expect(sees(world, me, 20, 32)).toBe(false);
  });

  it("on the surface a sunbeam does not glow at night — the far-lit rule is underground only", () => {
    const world = openWorld();
    const me = player(20, 20, "surface");
    setTile(world, "surface", 20, 32, "sunbeam");
    world.tick = 0; // midnight
    expect(sees(world, me, 20, 32)).toBe(false);
  });
});

describe("updatePlayerVision: memory", () => {
  it("visible is replaced each turn; explored only grows, per world AND layer", () => {
    const world = openWorld();
    const me = player(20, 20);
    updatePlayerVision(world, me);
    const first = new Set(me.vision!.visible);
    expect(first.has(tileIndex(world, 20, 20))).toBe(true);

    me.pos = { x: 20, y: 30 };
    updatePlayerVision(world, me);
    expect(me.vision!.visible.has(tileIndex(world, 20, 20))).toBe(false);
    expect(me.vision!.visible.has(tileIndex(world, 20, 30))).toBe(true);
    const explored = me.vision!.explored[visionScope(world, "underground")]!;
    for (const idx of first) expect(explored.has(idx)).toBe(true);
    expect(explored.has(tileIndex(world, 20, 30))).toBe(true);
    expect(me.vision!.explored[visionScope(world, "surface")]).toBeUndefined();

    me.layer = "surface";
    updatePlayerVision(world, me);
    expect(me.vision!.explored[visionScope(world, "surface")]!.size).toBeGreaterThan(0);
    expect(me.vision!.explored[visionScope(world, "underground")]!.size).toBe(explored.size);
  });

  /**
   * Direct report: "is the level 2 exactly the same as level 1? i feel like
   * the fog of war doesn't reset so all the places ive been looked the same."
   * Two worlds, same layer name, same dimensions — the shape every cave level
   * and every overworld zone has.
   */
  it("a second world does NOT inherit the first world's map memory", () => {
    const first = openWorld();
    const second = openWorld();
    expect(first.id).not.toBe(second.id);
    const me = player(20, 20);
    updatePlayerVision(first, me);
    const knownOnFirst = me.vision!.explored[visionScope(first, "underground")]!;
    expect(knownOnFirst.size).toBeGreaterThan(0);
    expect(me.vision!.explored[visionScope(second, "underground")]).toBeUndefined();

    // Arriving somewhere else on the second world reveals only what is in
    // sight there — the first world's tiles stay remembered, separately.
    me.pos = { x: 30, y: 30 };
    updatePlayerVision(second, me);
    expect(me.vision!.explored[visionScope(second, "underground")]!.has(tileIndex(second, 20, 20))).toBe(false);
    expect(knownOnFirst.has(tileIndex(first, 20, 20))).toBe(true);
  });

  it("advancePlayerTurn leaves vision computed for the new position", () => {
    const world = openWorld();
    const me = player(20, 20);
    world.agents.push(me);
    expect(me.vision).toBeUndefined();
    advancePlayerTurn(world, { kind: "move", dx: 0, dy: 1 });
    expect(me.pos).toEqual({ x: 20, y: 21 });
    expect(me.vision!.visible.has(tileIndex(world, 20, 21))).toBe(true);
    expect(canPlayerSee(world, "underground", 20, 21)).toBe(true);
    expect(canPlayerSee(world, "underground", 20, 35)).toBe(false);
    // Other layer: nothing is visible.
    expect(canPlayerSee(world, "surface", 20, 21)).toBe(false);
  });

  it("a world with no player hides nothing — the spectator app is unchanged", () => {
    const world = openWorld();
    expect(canPlayerSee(world, "surface", 0, 0)).toBe(true);
  });
});
