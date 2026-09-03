import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds, tickAgent, tickAgentAction, tickAgentNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules } from "../src/types.js";
import {
  applyHealOverTime,
  applyLooting,
  carryCapacityOf,
  maybeRecoverFromFaint,
  maybeStartCarrying,
  applyCarrying,
  FED_THRESHOLD,
  WAKE_HP_FRACTION,
  FINISHING_POOL_FRACTION,
} from "../src/support.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    species: "bulbasaur",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...overrides,
  };
}

describe("heal over time", () => {
  it("heals a hurt agent only while both hunger and thirst are above the fed threshold", () => {
    const fed = makeAgent({ hp: 5, maxHp: 10, needs: createNeeds({ hunger: FED_THRESHOLD, thirst: FED_THRESHOLD }) });
    applyHealOverTime(fed);
    expect(fed.hp).toBeGreaterThan(5);

    const hungry = makeAgent({ hp: 5, maxHp: 10, needs: createNeeds({ hunger: FED_THRESHOLD - 0.1, thirst: 1 }) });
    applyHealOverTime(hungry);
    expect(hungry.hp).toBe(5);

    const thirsty = makeAgent({ hp: 5, maxHp: 10, needs: createNeeds({ hunger: 1, thirst: FED_THRESHOLD - 0.1 }) });
    applyHealOverTime(thirsty);
    expect(thirsty.hp).toBe(5);
  });

  it("never heals past maxHp and is a no-op on a truly dead agent", () => {
    const full = makeAgent({ hp: 10, maxHp: 10, needs: createNeeds({ hunger: 1, thirst: 1 }) });
    applyHealOverTime(full);
    expect(full.hp).toBe(10);

    const corpse = makeAgent({ hp: 0, maxHp: 10, alive: false, needs: createNeeds({ hunger: 1, thirst: 1 }) });
    applyHealOverTime(corpse);
    expect(corpse.hp).toBe(0);
  });
});

describe("faint recovery", () => {
  it("recovers a fainted agent once healed hp crosses the wake threshold, discarding the finishing pool", () => {
    const world = createWorld(5, 5);
    const agent = makeAgent({
      hp: Math.ceil(10 * WAKE_HP_FRACTION),
      maxHp: 10,
      fainted: true,
      finishingPool: 3,
      needs: createNeeds(),
    });
    const log = new EventLog();

    maybeRecoverFromFaint(agent, world, log);

    expect(agent.fainted).toBe(false);
    expect(agent.finishingPool).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "recovered", agentId: "a1" }));
  });

  it("does not recover below the wake threshold", () => {
    const world = createWorld(5, 5);
    const agent = makeAgent({ hp: 1, maxHp: 10, fainted: true, finishingPool: 3 });

    maybeRecoverFromFaint(agent, world);

    expect(agent.fainted).toBe(true);
    expect(agent.finishingPool).toBe(3);
  });

  it("a fainted agent takes no action-tick behavior but still needs-decays and heals via tickAgent", () => {
    const world = createWorld(5, 5);
    const agent = makeAgent({
      pos: { x: 2, y: 2 },
      hp: 0,
      maxHp: 10,
      fainted: true,
      finishingPool: 5,
      behavior: "hunt",
      needs: createNeeds({ hunger: 1, thirst: 1 }),
    });

    tickAgentNeeds(agent, world);
    tickAgentAction(world, agent);

    expect(agent.pos).toEqual({ x: 2, y: 2 }); // didn't move
    expect(agent.behavior).toBe("hunt"); // unchanged — no behavior choice ran
    expect(agent.hp).toBeGreaterThan(0); // healed
    expect(agent.needs.hunger).toBeLessThan(1); // still decayed
  });
});

describe("looting", () => {
  it("loots from a fainted agent and from a truly dead one, respecting the looter's carry capacity", () => {
    const world = createWorld(5, 5);
    const looter = makeAgent({ id: "looter", pos: { x: 1, y: 1 }, maxHp: 10 });
    const fainted = makeAgent({
      id: "fainted-target",
      pos: { x: 1, y: 2 },
      fainted: true,
      hp: 0,
      maxHp: 5,
      inventory: [{ itemKey: "oran_berry", weight: 1 }],
    });
    world.agents.push(looter, fainted);
    const log = new EventLog();

    const looted = applyLooting(world, looter, log);

    expect(looted).toBe(true);
    expect(looter.inventory).toEqual([{ itemKey: "oran_berry", weight: 1 }]);
    expect(fainted.inventory).toEqual([]);
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "looted", looterId: "looter", fromId: "fainted-target" }));

    const corpse = makeAgent({
      id: "corpse",
      pos: { x: 1, y: 1 },
      alive: false,
      inventory: [{ itemKey: "oran_berry", weight: 1 }],
    });
    world.agents.push(corpse);
    const lootedFromCorpse = applyLooting(world, looter, log);
    expect(lootedFromCorpse).toBe(true);
    expect(looter.inventory).toHaveLength(2);
  });

  it("won't loot past its own carry capacity", () => {
    const world = createWorld(5, 5);
    const looter = makeAgent({ id: "looter", pos: { x: 1, y: 1 }, maxHp: 1 }); // tiny capacity
    const capacity = carryCapacityOf(looter);
    const heavyTarget = makeAgent({
      id: "heavy",
      pos: { x: 1, y: 2 },
      alive: false,
      inventory: [{ itemKey: "heavy_rock", weight: capacity + 100 }],
    });
    world.agents.push(looter, heavyTarget);

    expect(applyLooting(world, looter)).toBe(false);
    expect(looter.inventory ?? []).toHaveLength(0);
  });
});

describe("herd food delivery", () => {
  it("picks up food from a flora tile (deducting stock) and delivers it to a hungry herd-mate, restoring hunger", () => {
    const world = createWorld(6, 6);
    setTile(world, "surface", 0, 0, "food");
    const deliverer = makeAgent({
      id: "helper",
      pos: { x: 0, y: 0 },
      herdId: "herd-a",
      maxHp: 20,
      needs: createNeeds({ hunger: 1, thirst: 1 }),
    });
    const hungryMate = makeAgent({
      id: "hungry",
      pos: { x: 3, y: 0 },
      herdId: "herd-a",
      needs: createNeeds({ hunger: 0.1 }),
    });
    world.agents.push(deliverer, hungryMate);
    const log = new EventLog();

    // Tick until the food is delivered (pickup, several steps toward the target, delivery).
    for (let i = 0; i < 20 && hungryMate.needs.hunger < 0.4; i++) {
      tickAgentAction(world, deliverer, log);
      if (deliverer.pos.x === hungryMate.pos.x && deliverer.pos.y === hungryMate.pos.y) break;
    }

    const stockTile = tileAt(world, "surface", 0, 0);
    expect(stockTile?.stock).toBeLessThan(1); // stock was deducted on pickup

    // Finish the delivery explicitly once the deliverer is adjacent (loop above stops walking, not exact hand-off).
    for (let i = 0; i < 10 && hungryMate.needs.hunger < 0.4; i++) {
      tickAgentAction(world, deliverer, log);
    }

    expect(hungryMate.needs.hunger).toBeGreaterThan(0.4);
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "foodDelivered", receiverId: "hungry" }));
  });
});

describe("carrying a fainted ally", () => {
  const RULES: HuntRules = { scyther: true };

  it("picks up an adjacent fainted ally, mirrors its position every tick, and sets it down on arrival at home", () => {
    const world = createWorld(10, 10);
    const carrier = makeAgent({
      id: "carrier",
      pos: { x: 5, y: 5 },
      herdId: "herd-a",
      homePos: { x: 0, y: 0 },
      maxHp: 30,
    });
    const fainted = makeAgent({
      id: "fainted-ally",
      pos: { x: 5, y: 6 },
      herdId: "herd-a",
      fainted: true,
      hp: 0,
      maxHp: 10,
      finishingPool: FINISHING_POOL_FRACTION * 10,
    });
    world.agents.push(carrier, fainted);
    const log = new EventLog();

    expect(maybeStartCarrying(world, carrier, log)).toBe(true);
    expect(carrier.carryingId).toBe("fainted-ally");
    expect(fainted.beingCarriedBy).toBe("carrier");
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "carrying", carriedId: "fainted-ally" }));

    const before = { ...carrier.pos };
    applyCarrying(world, carrier, RULES, log);
    expect(carrier.pos).not.toEqual(before); // stepped toward home
    expect(fainted.pos).toEqual(carrier.pos); // carried agent mirrors carrier

    // Walk it all the way home.
    for (let i = 0; i < 20 && carrier.carryingId; i++) {
      applyCarrying(world, carrier, RULES, log);
    }

    expect(carrier.carryingId).toBeUndefined();
    expect(fainted.beingCarriedBy).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "setDown", reason: "arrived" }));
  });

  it("drops the ally immediately if the carrier comes under predator threat, prioritizing its own survival", () => {
    const world = createWorld(10, 10);
    const carrier = makeAgent({
      id: "carrier",
      species: "bulbasaur",
      pos: { x: 5, y: 5 },
      herdId: "herd-a",
      homePos: { x: 0, y: 0 },
      maxHp: 30,
      carryingId: "fainted-ally",
    });
    const fainted = makeAgent({
      id: "fainted-ally",
      species: "bulbasaur",
      pos: { x: 5, y: 5 },
      herdId: "herd-a",
      fainted: true,
      hp: 0,
      maxHp: 10,
      beingCarriedBy: "carrier",
    });
    const predator = makeAgent({ id: "predator", species: "scyther", pos: { x: 6, y: 5 } });
    world.agents.push(carrier, fainted, predator);
    const log = new EventLog();

    const continuedCarrying = applyCarrying(world, carrier, RULES, log);

    expect(continuedCarrying).toBe(false); // dropped, not a carry action this tick
    expect(carrier.carryingId).toBeUndefined();
    expect(fainted.beingCarriedBy).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "setDown", reason: "threat" }));
  });
});

describe("integration: fainting and recovery through tickWorld", () => {
  const RULES: HuntRules = { scyther: true };

  it("a full run: faint -> heal above wake threshold -> recover -> resume acting", () => {
    const world = createWorld(10, 10);
    const agent = makeAgent({
      id: "recoverer",
      pos: { x: 2, y: 2 },
      hp: 0,
      maxHp: 10,
      fainted: true,
      finishingPool: 7.5,
      needs: createNeeds({ hunger: 1, thirst: 1 }),
      stats: { maxHp: 10, attack: 5, defense: 5, spAttack: 5, spDefense: 5, speed: 40 },
    });
    world.agents.push(agent);
    const log = new EventLog();

    let recovered = false;
    for (let i = 0; i < 500 && !recovered; i++) {
      tickWorld(world, log, RULES);
      recovered = agent.fainted === false;
    }

    expect(recovered).toBe(true);
    expect(agent.finishingPool).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "recovered", agentId: "recoverer" }));
  });
});
