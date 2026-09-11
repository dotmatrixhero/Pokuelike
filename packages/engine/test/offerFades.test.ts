import { describe, expect, it } from "vitest";
import { createWorld, tileAt } from "../src/world.js";
import { applyPlayerAction } from "../src/player.js";
import { applyTreatSeeking } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import { mulberry32 } from "../src/rng.js";
import { tickWorld } from "../src/simulation.js";
import type { Agent, Tile, World } from "../src/types.js";

/**
 * Direct report: "Also when I offer a crop it gets eaten but never fades away.
 * That's weird."
 *
 * It wasn't a rendering bug. An offering went down with `CONSUME_STOCK_AMOUNT
 * * 2` stock, so one feeding ate half and left the other half on the ground as
 * an ordinary food tile — which `growFlora` will even let spread. A gift is
 * one gift.
 */

function scene(layer: "surface" | "underground"): { world: World; me: Agent } {
  const world = createWorld(16, 16, 3);
  const me = {
    id: "player",
    species: "human",
    pos: { x: 8, y: 8 },
    layer,
    homeLayer: layer,
    needs: { hunger: 1, thirst: 1, energy: 1 },
    behavior: "idle",
    controlledBy: "player",
    hp: 20,
    maxHp: 20,
    inventory: [{ itemKey: "oran", weight: 1, count: 3 }],
  } as unknown as Agent;
  world.agents.push(me);
  return { world, me };
}

function offeredTile(world: World, me: Agent): { tile: Tile; x: number; y: number } | undefined {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = me.pos.x + dx;
      const y = me.pos.y + dy;
      const tile = tileAt(world, me.layer, x, y);
      if (tile?.terrain === "food" && tile.offeredBy) return { tile, x, y };
    }
  }
  return undefined;
}

/** A calm, unhungry wild agent standing on the offering — `applyTreatSeeking`'s own case. */
function eaterOn(world: World, x: number, y: number, layer: "surface" | "underground"): Agent {
  const a = {
    id: "venonat",
    species: "venonat",
    pos: { x, y },
    layer,
    homeLayer: layer,
    needs: { hunger: 0.9, thirst: 0.9, energy: 0.9 },
    behavior: "idle",
    hp: 20,
    maxHp: 20,
  } as unknown as Agent;
  world.agents.push(a);
  return a;
}

describe("an offering is one gift, and it goes when it is taken", () => {
  it("vanishes the moment it is eaten — no half-patch left behind", () => {
    const { world, me } = scene("surface");
    expect(applyPlayerAction(world, me, { kind: "offer", itemKey: "oran" }, new EventLog(), undefined, mulberry32(1))).toBe(true);
    const placed = offeredTile(world, me)!;
    expect(placed.tile.flavor).toBe("oran");

    const eater = eaterOn(world, placed.x, placed.y, "surface");
    expect(applyTreatSeeking(world, eater, new EventLog(), mulberry32(2))).toBe(true);

    expect(placed.tile.terrain).toBe("floor");
    expect(placed.tile.stock).toBeUndefined();
    expect(placed.tile.offeredBy).toBeUndefined();
    expect(placed.tile.flavor).toBeUndefined();
  });

  it("still pays the giver their rapport — the gift lands before the tile clears", () => {
    const { world, me } = scene("surface");
    applyPlayerAction(world, me, { kind: "offer", itemKey: "oran" }, new EventLog(), undefined, mulberry32(1));
    const placed = offeredTile(world, me)!;
    const eater = eaterOn(world, placed.x, placed.y, "surface");
    applyTreatSeeking(world, eater, new EventLog(), mulberry32(2));
    expect(eater.rapport?.[me.id]?.score ?? 0).toBeGreaterThan(0);
  });

  it("works underground too — the cave run is where offerings actually happen", () => {
    const { world, me } = scene("underground");
    applyPlayerAction(world, me, { kind: "offer", itemKey: "oran" }, new EventLog(), undefined, mulberry32(1));
    const placed = offeredTile(world, me)!;
    const eater = eaterOn(world, placed.x, placed.y, "underground");
    applyTreatSeeking(world, eater, new EventLog(), mulberry32(2));
    expect(placed.tile.terrain).toBe("floor");
  });

  it("does NOT clear an ordinary wild food patch", () => {
    const { world } = scene("surface");
    const tile = tileAt(world, "surface", 9, 8)!;
    tile.terrain = "food";
    tile.stock = 1;
    tile.walkable = true;
    const eater = eaterOn(world, 9, 8, "surface");
    // Stated plainly so this cannot read as stronger than it is: a patch with
    // no `offeredBy` is not a treat at all, so `applyTreatSeeking` declines it
    // outright. What is being checked is that `takeWholeOffering`'s guard is
    // on `offeredBy` — wild food never reaches the clearing path.
    expect(applyTreatSeeking(world, eater, new EventLog(), mulberry32(2))).toBe(false);
    expect(tile.terrain).toBe("food");
    expect(tile.stock).toBe(1);
  });

  it("an untaken offering still rots away on its own", () => {
    const { world, me } = scene("surface");
    applyPlayerAction(world, me, { kind: "offer", itemKey: "oran" }, new EventLog(), undefined, mulberry32(1));
    const placed = offeredTile(world, me)!;
    for (let i = 0; i < 200 && placed.tile.terrain === "food"; i++) tickWorld(world);
    expect(placed.tile.terrain).toBe("floor");
  });
});
