import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { applyPlayerAction } from "../src/player.js";
import { EventLog } from "../src/events.js";
import { mulberry32 } from "../src/rng.js";
import type { Agent, World } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

/**
 * Direct ask: "I want to be able to use utility moves too." Before this these
 * were reachable only through utilityMoves.ts's ambient 15%-per-tick roll,
 * which wild agents get for free and a player — having no ambient behaviour —
 * never got at all.
 */

function healMove(overrides: Partial<MoveSpec> = {}): MoveSpec {
  return {
    id: "growth",
    name: "Growth",
    type: "grass",
    category: "status",
    power: 0,
    accuracy: 100,
    pp: 10,
    shape: { kind: "point" },
    range: { min: 0, max: 0 },
    utilityMove: true,
    selfHeal: { fraction: 0.25 },
    ...overrides,
  } as MoveSpec;
}

function playerWith(moves: MoveSpec[], extra: Partial<Agent> = {}): { world: World; me: Agent } {
  const world = createWorld(12, 12, 7);
  const me = {
    id: "player",
    species: "human",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1 },
    behavior: "idle",
    controlledBy: "player",
    hp: 10,
    maxHp: 40,
    moves,
    ...extra,
  } as Agent;
  world.agents.push(me);
  return { world, me };
}

describe("player-driven utility moves", () => {
  it("fires the named move immediately — no ambient random gate", () => {
    const { world, me } = playerWith([healMove()]);
    // rng fixed at a value that would FAIL the 15% ambient roll, proving this
    // path does not go through it.
    const ok = applyPlayerAction(world, me, { kind: "useUtilityMove", moveId: "growth" }, new EventLog(), undefined, () => 0.99);
    expect(ok).toBe(true);
    expect(me.hp).toBeGreaterThan(10);
    expect(me.lastActionOutcome?.utilityMoveId).toBe("growth");
  });

  it("refuses a move the player does not know", () => {
    const { world, me } = playerWith([healMove()]);
    expect(applyPlayerAction(world, me, { kind: "useUtilityMove", moveId: "surf" }, new EventLog(), undefined, mulberry32(1))).toBe(false);
  });

  it("refuses a NON-utility move — that is what attack is for", () => {
    const tackle = healMove({ id: "tackle", name: "Tackle", utilityMove: false, selfHeal: undefined });
    const { world, me } = playerWith([tackle]);
    expect(applyPlayerAction(world, me, { kind: "useUtilityMove", moveId: "tackle" }, new EventLog(), undefined, mulberry32(1))).toBe(false);
  });

  it("refuses while the move is on cooldown", () => {
    const { world, me } = playerWith([healMove()], { moveCooldowns: { growth: 3 } });
    expect(applyPlayerAction(world, me, { kind: "useUtilityMove", moveId: "growth" }, new EventLog(), undefined, mulberry32(1))).toBe(false);
    expect(me.hp).toBe(10);
  });

  it("records a utilityMoveUsed event, so the action log can report it", () => {
    const { world, me } = playerWith([healMove()]);
    const log = new EventLog();
    applyPlayerAction(world, me, { kind: "useUtilityMove", moveId: "growth" }, log, undefined, mulberry32(1));
    expect(log.events.some((e) => e.kind === "utilityMoveUsed")).toBe(true);
  });

  it("a drainNeeds move with nobody in range does not fire, and is not wasted on cooldown", () => {
    const drain = healMove({ id: "leech", name: "Leech Seed", selfHeal: undefined, drainNeeds: { need: "hunger", amount: 0.2, radius: 2 } });
    const { world, me } = playerWith([drain]);
    expect(applyPlayerAction(world, me, { kind: "useUtilityMove", moveId: "leech" }, new EventLog(), undefined, mulberry32(1))).toBe(false);
    expect(me.moveCooldowns?.leech ?? 0).toBe(0);
  });
});

describe("terrain moves stay tile-targeted", () => {
  /**
   * Direct note: "tile target might be necessary for like cut to cut a tree
   * down or something later. Or like rock throw to clear paths."
   *
   * The trap this guards: Fell and Clear (packages/data crafting.ts) are
   * flagged `utilityMove: true` AND carry a `terrainEffect`. Routing every
   * utilityMove through `useUtilityMove` therefore swallowed them — it has no
   * terrainEffect branch, so the move spent its turn and its cooldown and
   * felled nothing.
   */
  const fell = (): MoveSpec =>
    ({
      id: "fell",
      name: "Fell",
      type: "normal",
      category: "status",
      power: 0,
      accuracy: -1,
      pp: 1,
      cooldownTicks: 10,
      shape: { kind: "point" },
      range: { min: 0, max: 1 },
      utilityMove: true,
      terrainEffect: { from: ["tree"], to: "floor", yields: "deadwood" },
    }) as MoveSpec;

  it("useUtilityMove REFUSES a terrain move, so it cannot be silently wasted", () => {
    const { world, me } = playerWith([fell()]);
    const ok = applyPlayerAction(world, me, { kind: "useUtilityMove", moveId: "fell" }, new EventLog(), undefined, mulberry32(1));
    expect(ok).toBe(false);
    expect(me.moveCooldowns?.fell ?? 0).toBe(0);
  });

  it("attack with a terrain move fells the targeted tile", () => {
    const { world, me } = playerWith([fell()]);
    setTile(world, "surface", 6, 5, "tree");
    const ok = applyPlayerAction(
      world,
      me,
      { kind: "attack", dx: 1, dy: 0, moveId: "fell", target: { x: 6, y: 5 } },
      new EventLog(),
      undefined,
      mulberry32(1)
    );
    expect(ok).toBe(true);
    expect(tileAt(world, "surface", 6, 5)!.terrain).toBe("floor");
  });
});
