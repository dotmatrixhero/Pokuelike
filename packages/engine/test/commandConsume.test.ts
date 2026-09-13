import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { applyPlayerAction } from "../src/player.js";
import { applyCommandedAction, preemptOrder } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import { mulberry32 } from "../src/rng.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct asks, one round:
 *   - *"You should be able to command a Pokémon to drink or eat."*
 *   - on whether that should wait behind the hungry/thirsty stall:
 *     *"queue but make it jump to top of queue."*
 *   - *"Drop where you are at but if targeted offer they immediately move to
 *     eat it."*
 */

function mk(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "venonat",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1, mateDrive: 0 },
    behavior: "idle",
    hp: 60,
    maxHp: 60,
    stats: { maxHp: 60, attack: 25, defense: 10, spAttack: 10, spDefense: 10, speed: 20 },
    moves: [
      { id: "tackle", name: "Tackle", type: "normal", category: "physical", power: 40, accuracy: 100, pp: 20, cooldownTicks: 2, shape: { kind: "point" }, range: { min: 1, max: 1 } },
    ],
    ...extra,
  } as unknown as Agent;
}

/** Open floor, a player at (5,5), a bonded partner beside them. */
function scene(): { world: World; me: Agent; ally: Agent } {
  const world = createWorld(20, 20, 3);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) setTile(world, "surface", x, y, "floor");
  const me = mk("player", 5, 5, { controlledBy: "player" });
  const ally = mk("ally", 6, 5, { followingId: "player" });
  world.agents.push(me, ally);
  return { world, me, ally };
}

const rng = () => mulberry32(9)();
/** Run the partner's own action ticks until it stops having something to do. */
function runOrder(world: World, ally: Agent, ticks = 30): void {
  for (let i = 0; i < ticks && ally.commandedAction; i++) {
    applyCommandedAction(world, ally, new EventLog(), undefined, rng);
    world.tick++;
  }
}

describe("commandConsume — sending a partner to eat or drink somewhere specific", () => {
  it("walks the partner to the food tile the PLAYER picked and eats there", () => {
    const { world, me, ally } = scene();
    setTile(world, "surface", 12, 5, "food");
    tileAt(world, "surface", 12, 5)!.stock = 5;
    ally.needs.hunger = 0.6;

    expect(applyPlayerAction(world, me, { kind: "commandConsume", agentId: ally.id, need: "eat", target: { x: 12, y: 5 } })).toBe(true);
    expect(ally.commandedAction?.kind).toBe("eat");
    runOrder(world, ally);

    expect(ally.pos).toEqual({ x: 12, y: 5 });
    expect(ally.needs.hunger).toBeGreaterThan(0.6);
    expect(ally.commandedAction).toBeUndefined();
    expect(tileAt(world, "surface", 12, 5)!.stock).toBeLessThan(5);
  });

  it("drinks from the BANK, not by standing in the water", () => {
    const { world, me, ally } = scene();
    setTile(world, "surface", 12, 5, "water");
    ally.needs.thirst = 0.5;

    expect(applyPlayerAction(world, me, { kind: "commandConsume", agentId: ally.id, need: "drink", target: { x: 12, y: 5 } })).toBe(true);
    runOrder(world, ally);

    expect(ally.pos).not.toEqual({ x: 12, y: 5 });
    expect(Math.max(Math.abs(ally.pos.x - 12), Math.abs(ally.pos.y - 5))).toBeLessThanOrEqual(1);
    expect(ally.needs.thirst).toBeGreaterThan(0.5);
    expect(ally.commandedAction).toBeUndefined();
  });

  it("refuses at issue time when there is nothing there to consume", () => {
    const { world, me, ally } = scene();
    expect(applyPlayerAction(world, me, { kind: "commandConsume", agentId: ally.id, need: "eat", target: { x: 12, y: 5 } })).toBe(false);
    expect(applyPlayerAction(world, me, { kind: "commandConsume", agentId: ally.id, need: "drink", target: { x: 12, y: 5 } })).toBe(false);
    expect(ally.commandedAction).toBeUndefined();
  });

  it("stalls as `nothingThere` when the food is gone by the time it arrives", () => {
    const { world, me, ally } = scene();
    setTile(world, "surface", 12, 5, "food");
    tileAt(world, "surface", 12, 5)!.stock = 5;
    applyPlayerAction(world, me, { kind: "commandConsume", agentId: ally.id, need: "eat", target: { x: 12, y: 5 } });
    // Something else eats it while the partner is still walking.
    setTile(world, "surface", 12, 5, "floor");
    runOrder(world, ally);
    expect(ally.commandedAction?.stalled).toBe("nothingThere");
  });

  it("only takes orders from the player it is bonded to", () => {
    const { world, me, ally } = scene();
    setTile(world, "surface", 12, 5, "food");
    tileAt(world, "surface", 12, 5)!.stock = 5;
    ally.followingId = undefined;
    expect(applyPlayerAction(world, me, { kind: "commandConsume", agentId: ally.id, need: "eat", target: { x: 12, y: 5 } })).toBe(false);
  });
});

describe("an eat order jumps the queue rather than waiting behind the stall it fixes", () => {
  it("a hungry partner refuses a FIGHT order (the control) but takes an EAT order", () => {
    const { world, me, ally } = scene();
    setTile(world, "surface", 8, 5, "food");
    tileAt(world, "surface", 8, 5)!.stock = 5;
    const foe = mk("foe", 12, 5, { species: "machop" });
    world.agents.push(foe);
    ally.needs.hunger = 0.1; // under `hasUrgentNeed`'s floor

    // CONTROL: the ordinary order stalls, exactly as before this feature.
    ally.commandedAction = { kind: "move", moveId: "tackle", target: { ...foe.pos }, targetAgentId: foe.id };
    applyCommandedAction(world, ally, new EventLog(), undefined, rng);
    expect(ally.commandedAction?.stalled).toBe("hungry");
    expect(ally.pos).toEqual({ x: 6, y: 5 });

    // The eat order, issued on top, is not gated by the same hunger.
    expect(applyPlayerAction(world, me, { kind: "commandConsume", agentId: ally.id, need: "eat", target: { x: 8, y: 5 } })).toBe(true);
    expect(ally.commandedAction?.kind).toBe("eat");
    applyCommandedAction(world, ally, new EventLog(), undefined, rng);
    expect(ally.pos).not.toEqual({ x: 6, y: 5 }); // it moved
  });

  it("hands the fight back once it has eaten, without the player re-issuing it", () => {
    const { world, me, ally } = scene();
    setTile(world, "surface", 8, 5, "food");
    tileAt(world, "surface", 8, 5)!.stock = 5;
    const foe = mk("foe", 14, 5, { species: "machop" });
    world.agents.push(foe);

    ally.needs.hunger = 0.1;
    ally.commandedAction = { kind: "move", moveId: "tackle", target: { ...foe.pos }, targetAgentId: foe.id };
    applyPlayerAction(world, me, { kind: "commandConsume", agentId: ally.id, need: "eat", target: { x: 8, y: 5 } });

    runOrder(world, ally, 40);
    expect(ally.commandedAction?.kind).toBe("move");
    expect(ally.commandedAction?.targetAgentId).toBe(foe.id);
  });

  it("a second eat order replaces the first rather than stacking — the queue stays one deep", () => {
    const ally = mk("ally", 0, 0, { followingId: "player" });
    const fight = { kind: "move" as const, moveId: "tackle", target: { x: 9, y: 9 } };
    ally.commandedAction = fight;
    preemptOrder(ally, { kind: "eat", target: { x: 1, y: 1 } });
    preemptOrder(ally, { kind: "eat", target: { x: 2, y: 2 } });
    expect(ally.commandedAction?.target).toEqual({ x: 2, y: 2 });
    expect(ally.commandedAction?.next).toBe(fight);
    expect(ally.commandedAction?.next?.next).toBeUndefined();
  });
});

describe("a targeted offering sends the creature to come and take it", () => {
  it("gives a BONDED partner a real eat order, at the tile the food actually landed on", () => {
    const { world, me, ally } = scene();
    me.inventory = [{ itemKey: "oran", weight: 1, count: 1 }] as Agent["inventory"];
    expect(applyPlayerAction(world, me, { kind: "offer", itemKey: "oran", targetId: ally.id })).toBe(true);

    expect(ally.commandedAction?.kind).toBe("eat");
    const spot = ally.commandedAction!.target;
    expect(tileAt(world, "surface", spot.x, spot.y)!.terrain).toBe("food");
    // Beside the player, not beside the partner — "drop where you are at".
    expect(Math.max(Math.abs(spot.x - me.pos.x), Math.abs(spot.y - me.pos.y))).toBe(1);

    runOrder(world, ally);
    expect(ally.pos).toEqual(spot);
  });

  it("nudges a WILD creature with the existing mirror cue instead of pretending it takes orders", () => {
    const { world, me } = scene();
    const wild = mk("wild", 7, 7, { species: "oddish" }); // no followingId
    world.agents.push(wild);
    me.inventory = [{ itemKey: "oran", weight: 1, count: 1 }] as Agent["inventory"];

    expect(applyPlayerAction(world, me, { kind: "offer", itemKey: "oran", targetId: wild.id })).toBe(true);
    expect(wild.commandedAction).toBeUndefined();
    expect(wild.mirrorAction).toBe("eat");
  });

  it("an UNTARGETED offer still just puts food down — nobody is sent anywhere", () => {
    const { world, me, ally } = scene();
    me.inventory = [{ itemKey: "oran", weight: 1, count: 1 }] as Agent["inventory"];
    expect(applyPlayerAction(world, me, { kind: "offer", itemKey: "oran" })).toBe(true);
    expect(ally.commandedAction).toBeUndefined();
    expect(ally.mirrorAction).toBeUndefined();
  });
});
