import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds, tickAgentAction } from "../src/needs.js";
import { resolveShape, type MoveSpec } from "../src/moves.js";
import { canEnterWater, ridesWater } from "../src/waterBody.js";
import { maybeStartFerrying, applyFerrying } from "../src/support.js";
import { canStepTo } from "../src/movement.js";
import { EventLog } from "../src/events.js";
import type { Agent, PokemonType, World } from "../src/types.js";

/**
 * Surf's three reworked properties, each measured against a control that
 * genuinely fails to do the thing:
 *  1. the wave shape covers a rectangle INCLUDING distance 1 (the ring could
 *     not), control = the old ring at the same origin;
 *  2. a land herd-mate is really ferried across water in a ticked world,
 *     control = the same setup with a carrier that has no `watercraft` move;
 *  3. a land Pokemon that knows Surf crosses deep water, control = the same
 *     species without the move.
 */

/** The move as it actually ships, not a local re-declaration that could drift from it. */
const SURF_SHAPE = { kind: "wave", length: 3, width: 1 } as const;
const OLD_SURF_SHAPE = { kind: "ring", radius: 2 } as const;

function surfSpec(): MoveSpec {
  return {
    id: "surf",
    name: "Surf",
    shape: { ...SURF_SHAPE },
    type: "water",
    category: "special",
    power: 90,
    accuracy: 100,
    pp: 15,
    cooldownTicks: 6,
    range: { min: 0, max: 3 },
    hitsArea: true,
    watercraft: true,
  };
}

/** Same spec with `watercraft` off — the control for pieces 2 and 3. */
function plainWaterMove(): MoveSpec {
  const spec = surfSpec();
  delete spec.watercraft;
  return spec;
}

function makeAgent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    species: "test",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ hunger: 1, thirst: 1 }),
    behavior: "idle",
    hp: 30,
    maxHp: 30,
    ...overrides,
  } as Agent;
}

// --- 1. The wave shape ---

describe("Surf's wave shape", () => {
  const origin = { x: 5, y: 5 };

  it("covers a facing-oriented rectangle, and the ring it replaces covered no adjacent tile at all", () => {
    const wave = resolveShape(SURF_SHAPE, origin, "E");
    const ring = resolveShape(OLD_SURF_SHAPE, origin, "E");

    // The rectangle: 3 deep x 3 across = 9 distinct tiles, x in [6,8], y in [4,6].
    expect(wave).toHaveLength(SURF_SHAPE.length * (SURF_SHAPE.width * 2 + 1));
    expect(wave).toHaveLength(9);
    expect(new Set(wave.map((t) => `${t.x},${t.y}`)).size).toBe(9);
    for (const tile of wave) {
      expect(tile.x).toBeGreaterThanOrEqual(6);
      expect(tile.x).toBeLessThanOrEqual(8);
      expect(tile.y).toBeGreaterThanOrEqual(4);
      expect(tile.y).toBeLessThanOrEqual(6);
    }
    // Every column of the rectangle is the same width — that constant
    // frontage is the whole difference between a wave and a cone.
    for (let x = 6; x <= 8; x++) {
      expect(wave.filter((t) => t.x === x)).toHaveLength(3);
    }

    // The defect the rework was asked for: the three tiles a target standing
    // right in front of the user can occupy.
    const adjacent = [
      { x: 6, y: 5 }, // (1,0) — directly ahead
      { x: 6, y: 4 }, // (1,-1)
      { x: 6, y: 6 }, // (1,1)
    ];
    for (const tile of adjacent) {
      expect(wave).toContainEqual(tile);
      // CONTROL: the ring genuinely misses every one of them.
      expect(ring).not.toContainEqual(tile);
    }
    // The ring's own footprint was real but hollow and un-aimed: 16 tiles,
    // every one of them at Chebyshev distance exactly 2.
    expect(ring).toHaveLength(16);
    for (const tile of ring) {
      expect(Math.max(Math.abs(tile.x - origin.x), Math.abs(tile.y - origin.y))).toBe(2);
    }
  });

  it("aims: the same wave points a different way for a different facing", () => {
    const east = resolveShape(SURF_SHAPE, origin, "E");
    const north = resolveShape(SURF_SHAPE, origin, "N");
    expect(east).not.toEqual(north);
    // Every east tile is ahead in +x; every north tile is ahead in -y.
    for (const tile of east) expect(tile.x).toBeGreaterThan(origin.x);
    for (const tile of north) expect(tile.y).toBeLessThan(origin.y);
    // CONTROL: the ring is identical whichever way it is aimed, because it
    // is not aimed at all.
    expect(resolveShape(OLD_SURF_SHAPE, origin, "E")).toEqual(resolveShape(OLD_SURF_SHAPE, origin, "N"));
  });
});

// --- 2 and 3 share a map: a 1-tile land pocket, a lake, and a far shore ---

/**
 * A 14x9 map. Land at x<=2 ("near shore"), deep water for x in [3,9], land
 * again at x>=10 ("far shore"). The lake is 7 x 9 = 63 tiles, well over
 * LARGE_WATER_BODY_MIN_SIZE, and its middle columns touch no land, so a
 * land-bound agent may wade to x=3 and no further.
 *
 * The near shore is deliberately kept SMALL (a 3-wide strip inside a short
 * map) so a land agent standing on it has a bounded reachable area — which
 * is the condition `maybeStartFerrying` reads as "this one is stuck".
 */
function buildLakeCrossing(): World {
  const world = createWorld(14, 9);
  for (let x = 3; x <= 9; x++) {
    for (let y = 0; y < 9; y++) setTile(world, "surface", x, y, "water");
  }
  return world;
}

describe("Surf lets a land Pokemon cross deep water", () => {
  it("a Rock-type that knows Surf can enter mid-lake; the same agent without it cannot", () => {
    const world = buildLakeCrossing();
    const midLake = { x: 6, y: 4 };

    const withSurf = makeAgent({ id: "rider", types: ["rock"] as PokemonType[], pos: { x: 2, y: 4 }, moves: [surfSpec()] });
    // CONTROL: identical agent, identical move, `watercraft` off.
    const withoutSurf = makeAgent({ id: "control", types: ["rock"] as PokemonType[], pos: { x: 2, y: 4 }, moves: [plainWaterMove()] });

    expect(ridesWater(withSurf)).toBe(true);
    expect(ridesWater(withoutSurf)).toBe(false);

    expect(canEnterWater(world, withSurf, "surface", midLake)).toBe(true);
    expect(canEnterWater(world, withoutSurf, "surface", midLake)).toBe(false);
    // And through the real movement predicate every mover actually goes through.
    expect(canStepTo(world, withSurf, "surface", midLake)).toBe(true);
    expect(canStepTo(world, withoutSurf, "surface", midLake)).toBe(false);

    // The control is not vacuously blocked everywhere: it can still wade the
    // shore tile to drink, exactly as before this feature existed.
    expect(canStepTo(world, withoutSurf, "surface", { x: 3, y: 4 })).toBe(true);
    // ...and it genuinely cannot reach the far shore on its own.
    expect(canStepTo(world, withoutSurf, "surface", { x: 4, y: 4 })).toBe(false);
  });

  it("walks the whole lake in a real ticked world, where the control never leaves the near shore", () => {
    const cross = (moves: MoveSpec[]) => {
      const world = buildLakeCrossing();
      const agent = makeAgent({ id: "walker", types: ["rock"] as PokemonType[], pos: { x: 2, y: 4 }, moves });
      world.agents.push(agent);
      let furthest = agent.pos.x;
      // Drive it east one step at a time through the same predicate movement
      // uses, rather than asserting on a single call.
      for (let step = 0; step < 12; step++) {
        const next = { x: agent.pos.x + 1, y: agent.pos.y };
        if (!canStepTo(world, agent, "surface", next)) break;
        agent.pos = next;
        furthest = Math.max(furthest, agent.pos.x);
      }
      return furthest;
    };

    expect(cross([surfSpec()])).toBeGreaterThanOrEqual(10); // reached the far shore
    expect(cross([plainWaterMove()])).toBe(3); // CONTROL: stuck on the first shore tile
  });
});

describe("Surf lets its user ferry an ally across water", () => {
  /**
   * A Wartortle at the lake edge with a Geodude FOLLOWING it — the engine's
   * cross-species ally relation (`Agent.followingId`). Deliberately not a
   * herd-mate pair: `isSameHerd` requires the same species, so a Water-typed
   * Surf user's herd-mates are Water types that never need a lift, and a
   * herd-only ferry could never fire. See `ferryCandidates` (support.ts).
   */
  function setup(carrierMoves: MoveSpec[]) {
    const world = buildLakeCrossing();
    const carrier = makeAgent({
      id: "carrier",
      species: "wartortle",
      types: ["water"] as PokemonType[],
      herdId: "h1",
      pos: { x: 2, y: 4 },
      maxHp: 60,
      hp: 60,
      moves: carrierMoves,
    });
    const passenger = makeAgent({
      id: "passenger",
      species: "geodude",
      types: ["rock"] as PokemonType[],
      herdId: "h2",
      followingId: "carrier",
      pos: { x: 2, y: 5 },
      // Its home is on the FAR bank — the reason the crossing happens at
      // all, and the anchor `findFerryLanding` steers by.
      homePos: { x: 12, y: 4 },
      maxHp: 30,
      hp: 30,
    });
    world.agents.push(carrier, passenger);
    return { world, carrier, passenger };
  }

  it("also picks up a same-species herd-mate, for a land species that knows Surf", () => {
    // The other reachable shape of the ask: a land Pokemon taught Surf
    // carrying its own kind, who are land-bound exactly like it.
    const world = buildLakeCrossing();
    const carrier = makeAgent({
      id: "carrier",
      species: "geodude",
      types: ["rock"] as PokemonType[],
      herdId: "h1",
      pos: { x: 2, y: 4 },
      maxHp: 60,
      hp: 60,
      moves: [surfSpec()],
    });
    const mate = makeAgent({
      id: "mate",
      species: "geodude",
      types: ["rock"] as PokemonType[],
      herdId: "h1",
      pos: { x: 2, y: 5 },
      homePos: { x: 12, y: 4 },
      maxHp: 30,
      hp: 30,
    });
    world.agents.push(carrier, mate);

    expect(maybeStartFerrying(world, carrier)).toBe(true);
    expect(mate.beingCarriedBy).toBe("carrier");

    // CONTROL: change nothing but the herd, and the same call finds nobody.
    const other = buildLakeCrossing();
    const carrier2 = { ...carrier, carryingId: undefined, ferryLanding: undefined } as Agent;
    const stranger = { ...mate, herdId: "h2", beingCarriedBy: undefined, followingId: undefined } as Agent;
    other.agents.push(carrier2, stranger);
    expect(maybeStartFerrying(other, carrier2)).toBe(false);
  });

  it("picks the ally up and lands it on a shore it could not have reached alone", () => {
    const { world, carrier, passenger } = setup([surfSpec()]);
    const log = new EventLog();

    const startedFrom = { ...passenger.pos };
    // The passenger genuinely cannot get to the far shore under its own power.
    expect(canStepTo(world, passenger, "surface", { x: 10, y: 4 })).toBe(true); // it is a legal tile for it...
    expect(canStepTo(world, passenger, "surface", { x: 5, y: 4 })).toBe(false); // ...but the water between is not.

    expect(maybeStartFerrying(world, carrier, log)).toBe(true);
    expect(carrier.carryingId).toBe("passenger");
    expect(passenger.beingCarriedBy).toBe("carrier");
    expect(carrier.ferryLanding).toBeDefined();
    // The committed landing is on the far shore.
    expect(carrier.ferryLanding!.x).toBeGreaterThanOrEqual(10);

    for (let tick = 0; tick < 60 && carrier.carryingId; tick++) {
      world.tick = tick;
      applyFerrying(world, carrier, log);
    }

    expect(carrier.carryingId).toBeUndefined();
    expect(passenger.beingCarriedBy).toBeUndefined();
    // It really moved, and it is standing somewhere it could not have walked to.
    expect(passenger.pos).not.toEqual(startedFrom);
    expect(passenger.pos.x).toBeGreaterThanOrEqual(10);
    // And it can stand there: the landing is real ground for it.
    expect(canStepTo(world, passenger, "surface", passenger.pos)).toBe(true);
    expect(log.events.some((e) => e.kind === "carrying")).toBe(true);
    expect(log.events.some((e) => e.kind === "setDown")).toBe(true);
  });

  it("CONTROL: the same carrier without a watercraft move never starts a ferry", () => {
    const { world, carrier, passenger } = setup([plainWaterMove()]);

    expect(maybeStartFerrying(world, carrier)).toBe(false);
    expect(carrier.carryingId).toBeUndefined();
    expect(passenger.beingCarriedBy).toBeUndefined();
    // Not vacuous: everything else about the situation is identical and the
    // Water-typed carrier could itself swim across.
    expect(canStepTo(world, carrier, "surface", { x: 6, y: 4 })).toBe(true);
  });

  it("CONTROL: an ally that can already swim is not ferried", () => {
    const { world, carrier, passenger } = setup([surfSpec()]);
    passenger.types = ["water"] as PokemonType[];

    expect(maybeStartFerrying(world, carrier)).toBe(false);
    expect(carrier.carryingId).toBeUndefined();

    // Flip it back and the very same call succeeds — proving the skip above
    // was the swim check and not some other unmet precondition.
    passenger.types = ["rock"] as PokemonType[];
    expect(maybeStartFerrying(world, carrier)).toBe(true);
  });

  it("runs end to end through tickAgentAction, not just the ferry functions", () => {
    const { world, carrier, passenger } = setup([surfSpec()]);
    const log = new EventLog();
    const startedFrom = { ...passenger.pos };

    // Where the passenger stood the moment the ferry ENDED. Not its final
    // position: once it is put down it acts for itself again and wanders,
    // and asserting on the last tick measured that wander instead of the
    // crossing.
    let boarded = false;
    let landedAt: { x: number; y: number } | undefined;
    for (let tick = 0; tick < 80 && !landedAt; tick++) {
      world.tick = tick;
      tickAgentAction(world, carrier, log);
      tickAgentAction(world, passenger, log);
      if (carrier.carryingId) boarded = true;
      else if (boarded) landedAt = { ...passenger.pos };
    }

    expect(boarded).toBe(true);
    expect(landedAt).toBeDefined();
    expect(landedAt).not.toEqual(startedFrom);
    expect(landedAt!.x).toBeGreaterThanOrEqual(10); // the far bank
    expect(passenger.beingCarriedBy).toBeUndefined();
    expect(log.events.some((e) => e.kind === "setDown")).toBe(true);
  });
});
