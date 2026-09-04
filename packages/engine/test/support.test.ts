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
  effectiveSpeed,
  FED_THRESHOLD,
  WAKE_HP_FRACTION,
  FINISHING_POOL_FRACTION,
  elevationSpeedMultiplier,
  terrainSpeedMultiplier,
  movementSpeedFactor,
  activityScheduleMultiplier,
  OFF_HOURS_SPEED_MULTIPLIER,
  coldSnapSpeedMultiplier,
  applySupportMove,
} from "../src/support.js";
import type { MoveSpec } from "../src/moves.js";
import { DAY_LENGTH_TICKS } from "../src/daynight.js";
import { COLD_SNAP_SPEED_MULTIPLIER } from "../src/weather.js";
import type { WeatherCell } from "../src/types.js";

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

describe("elevation/terrain movement-speed modifiers", () => {
  it("moving to higher ground slows (multiplier below 1); to lower ground speeds up (above 1); flat is neutral", () => {
    expect(elevationSpeedMultiplier(0, 3)).toBeLessThan(1);
    expect(elevationSpeedMultiplier(3, 0)).toBeGreaterThan(1);
    expect(elevationSpeedMultiplier(2, 2)).toBe(1);
  });

  it("clamps so an extreme height gap isn't a literal never-acts/always-double-acts", () => {
    expect(elevationSpeedMultiplier(0, 100)).toBeGreaterThan(0);
    expect(elevationSpeedMultiplier(100, 0)).toBeLessThan(2);
  });

  it("sand and mud slow movement; every other terrain is neutral", () => {
    expect(terrainSpeedMultiplier("sand")).toBeLessThan(1);
    expect(terrainSpeedMultiplier("mud")).toBeLessThan(1);
    expect(terrainSpeedMultiplier("mud")).toBeLessThan(terrainSpeedMultiplier("sand")); // mud is the worse of the two
    expect(terrainSpeedMultiplier("floor")).toBe(1);
    expect(terrainSpeedMultiplier("bush")).toBe(1);
  });

  it("movementSpeedFactor composes elevation and terrain multiplicatively", () => {
    const elevationOnly = movementSpeedFactor(0, 2, "floor");
    const terrainOnly = movementSpeedFactor(0, 0, "mud");
    const both = movementSpeedFactor(0, 2, "mud");
    expect(both).toBeCloseTo(elevationOnly * terrainOnly, 10);
  });

  it("a real tick applies the last step's terrain factor to the NEXT action's pace, via ordinary needs-driven movement", () => {
    const world = createWorld(10, 1);
    setTile(world, "surface", 5, 0, "mud"); // directly between the agent and the water it's walking toward
    setTile(world, "surface", 6, 0, "water");
    const agent = makeAgent({
      pos: { x: 4, y: 0 },
      layer: "surface",
      stats: { maxHp: 10, attack: 5, defense: 5, spAttack: 5, spDefense: 5, speed: 40 },
      needs: createNeeds({ thirst: 0 }), // seekWater — walks straight toward the water, through the mud tile
    });
    world.agents.push(agent);

    tickWorld(world);

    expect(agent.pos).toEqual({ x: 5, y: 0 }); // stepped onto the mud tile on the way
    // terrainSpeedFactor is now < 1 (mud, flat ground) — applies to next tick's
    // actionSpeedOf, composed multiplicatively with the (here neutral, full-hp)
    // injury fraction from effectiveSpeed.
    expect(agent.terrainSpeedFactor).toBeCloseTo(terrainSpeedMultiplier("mud"), 10);
  });
});

describe("activityScheduleMultiplier: off-hours Speed penalty (see DESIGN.md's day/night Phase 2)", () => {
  const MIDNIGHT = 0;
  const NOON = DAY_LENGTH_TICKS / 2;

  it("cathemeral (and unset) is always full speed, day or night — no behavior change for existing species", () => {
    expect(activityScheduleMultiplier("cathemeral", MIDNIGHT)).toBe(1);
    expect(activityScheduleMultiplier("cathemeral", NOON)).toBe(1);
    expect(activityScheduleMultiplier(undefined, MIDNIGHT)).toBe(1);
    expect(activityScheduleMultiplier(undefined, NOON)).toBe(1);
  });

  it("diurnal is full speed by day, penalized at night", () => {
    expect(activityScheduleMultiplier("diurnal", NOON)).toBe(1);
    expect(activityScheduleMultiplier("diurnal", MIDNIGHT)).toBe(OFF_HOURS_SPEED_MULTIPLIER);
  });

  it("nocturnal is full speed at night, penalized by day — the exact mirror of diurnal", () => {
    expect(activityScheduleMultiplier("nocturnal", MIDNIGHT)).toBe(1);
    expect(activityScheduleMultiplier("nocturnal", NOON)).toBe(OFF_HOURS_SPEED_MULTIPLIER);
  });

  it("crepuscular is full speed only near dawn/dusk, penalized at both noon and midnight", () => {
    expect(activityScheduleMultiplier("crepuscular", NOON)).toBe(OFF_HOURS_SPEED_MULTIPLIER);
    expect(activityScheduleMultiplier("crepuscular", MIDNIGHT)).toBe(OFF_HOURS_SPEED_MULTIPLIER);

    // Scan for a genuine twilight tick and confirm it's full speed there.
    let sawFullSpeed = false;
    for (let tick = 0; tick < DAY_LENGTH_TICKS; tick++) {
      if (activityScheduleMultiplier("crepuscular", tick) === 1) sawFullSpeed = true;
    }
    expect(sawFullSpeed).toBe(true);
  });

  it("the penalty is real but partial — never full speed, never anywhere close to zero", () => {
    expect(OFF_HOURS_SPEED_MULTIPLIER).toBeLessThan(1);
    expect(OFF_HOURS_SPEED_MULTIPLIER).toBeGreaterThan(0.5);
  });

  it("composes multiplicatively with the existing injury (effectiveSpeed) and elevation/terrain modifiers — not in isolation", () => {
    // An injured (half HP) nocturnal agent, active during the day (off-hours),
    // that just climbed uphill through mud: all three penalties should stack
    // as one product, matching movementSpeedFactor's own documented
    // composition order (terrain/elevation, then off-hours, then injury).
    const baseSpeed = 40;
    const terrainFactor = movementSpeedFactor(0, 3, "mud"); // uphill + mud, both penalize
    const offHours = activityScheduleMultiplier("nocturnal", NOON); // daytime — off-hours for a nocturnal agent
    const speedBeforeInjury = baseSpeed * terrainFactor * offHours;

    const injuredAgent = makeAgent({ hp: 5, maxHp: 10 });
    const finalSpeed = effectiveSpeed(injuredAgent, speedBeforeInjury);

    expect(terrainFactor).toBeLessThan(1);
    expect(offHours).toBe(OFF_HOURS_SPEED_MULTIPLIER);
    expect(finalSpeed).toBeCloseTo(baseSpeed * terrainFactor * offHours * 0.5, 10);
    // All three penalties really did stack — strictly less than any one or two of them applied alone.
    expect(finalSpeed).toBeLessThan(baseSpeed * terrainFactor);
    expect(finalSpeed).toBeLessThan(baseSpeed * offHours);
    expect(finalSpeed).toBeLessThan(effectiveSpeed(injuredAgent, baseSpeed));
  });
});

describe("coldSnapSpeedMultiplier: the fourth composable Speed modifier (Phase 3 weather)", () => {
  function coldSnapCell(overrides: Partial<WeatherCell> = {}): WeatherCell {
    return {
      id: "cold",
      type: "coldSnap",
      center: { x: 5, y: 5 },
      radius: 5,
      startedTick: 0,
      lifespanTicks: 999,
      drift: { x: 0, y: 0 },
      ...overrides,
    };
  }

  it("is a real but partial penalty, same order of magnitude as the other terrain-ish penalties", () => {
    expect(COLD_SNAP_SPEED_MULTIPLIER).toBeLessThan(1);
    expect(COLD_SNAP_SPEED_MULTIPLIER).toBeGreaterThan(0.5);
  });

  it("applies flatly inside an active cold snap, regardless of species", () => {
    const world = createWorld(20, 20);
    world.weatherCells = [coldSnapCell()];
    expect(coldSnapSpeedMultiplier(world, "surface", { x: 5, y: 5 })).toBe(COLD_SNAP_SPEED_MULTIPLIER);
  });

  it("is neutral (1) outside the cold snap's radius, off the surface layer, and with no active weather at all", () => {
    const world = createWorld(20, 20);
    world.weatherCells = [coldSnapCell()];
    expect(coldSnapSpeedMultiplier(world, "surface", { x: 19, y: 19 })).toBe(1);
    expect(coldSnapSpeedMultiplier(world, "underground", { x: 5, y: 5 })).toBe(1);

    const clearWorld = createWorld(20, 20);
    expect(coldSnapSpeedMultiplier(clearWorld, "surface", { x: 5, y: 5 })).toBe(1);
  });

  it("composes multiplicatively as a fourth term alongside terrain/off-hours/injury, not replacing any of them", () => {
    const baseSpeed = 40;
    const terrainFactor = movementSpeedFactor(0, 3, "mud");
    const offHours = activityScheduleMultiplier("nocturnal", DAY_LENGTH_TICKS / 2);
    const world = createWorld(20, 20);
    world.weatherCells = [coldSnapCell()];
    const coldSnap = coldSnapSpeedMultiplier(world, "surface", { x: 5, y: 5 });
    const speedBeforeInjury = baseSpeed * terrainFactor * offHours * coldSnap;

    const injuredAgent = makeAgent({ hp: 5, maxHp: 10 });
    const finalSpeed = effectiveSpeed(injuredAgent, speedBeforeInjury);

    expect(coldSnap).toBe(COLD_SNAP_SPEED_MULTIPLIER);
    // All four penalties really did stack — strictly less than terrain/off-hours alone, without the cold snap.
    expect(finalSpeed).toBeLessThan(effectiveSpeed(injuredAgent, baseSpeed * terrainFactor * offHours));
  });
});

describe("applySupportMove: ally-targeting effects", () => {
  const HEAL_ALLY: MoveSpec = {
    id: "nurture",
    name: "Nurture",
    shape: { kind: "point" },
    type: "grass",
    category: "special",
    power: 0,
    accuracy: 100,
    cooldownTicks: 3,
    range: { min: 0, max: 3 },
    targetsAlly: true,
    allyEffect: { healFraction: 0.2 },
  };

  const BUFF_ALLY: MoveSpec = {
    ...HEAL_ALLY,
    id: "rally",
    allyEffect: { buff: { stat: "attack", stage: 1, ticks: 5 } },
  };

  it("heals the nearest hurt herd-mate in range and puts the move on cooldown", () => {
    const world = createWorld(10, 10);
    const supporter = makeAgent({ id: "s1", pos: { x: 5, y: 5 }, herdId: "h1", moves: [HEAL_ALLY] });
    const ally = makeAgent({ id: "a2", pos: { x: 6, y: 5 }, herdId: "h1", hp: 40, maxHp: 100 });
    world.agents.push(supporter, ally);
    const log = new EventLog();

    expect(applySupportMove(world, supporter, log)).toBe(true);

    expect(ally.hp).toBeCloseTo(60); // 40 + 0.2*100
    expect(supporter.moveCooldowns?.nurture).toBe(3);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "supported", supporterId: "s1", allyId: "a2", healed: true, buffed: false })
    );
  });

  it("applies a buff (with duration) instead of/in addition to healing", () => {
    const world = createWorld(10, 10);
    const supporter = makeAgent({ id: "s1", pos: { x: 5, y: 5 }, herdId: "h1", moves: [BUFF_ALLY] });
    const ally = makeAgent({ id: "a2", pos: { x: 6, y: 5 }, herdId: "h1", hp: 100, maxHp: 100 });
    world.agents.push(supporter, ally);

    expect(applySupportMove(world, supporter, undefined)).toBe(true);

    expect(ally.statStages).toEqual([{ stat: "attack", stage: 1, ticksRemaining: 5 }]);
  });

  it("does nothing without a herd, an in-range ally, or an off-cooldown support move", () => {
    const world = createWorld(10, 10);
    const lonely = makeAgent({ id: "s1", pos: { x: 5, y: 5 }, moves: [HEAL_ALLY] }); // no herdId
    world.agents.push(lonely);
    expect(applySupportMove(world, lonely, undefined)).toBe(false);

    const supporter = makeAgent({ id: "s2", pos: { x: 5, y: 5 }, herdId: "h1", moves: [HEAL_ALLY] });
    const farAlly = makeAgent({ id: "a3", pos: { x: 9, y: 9 }, herdId: "h1", hp: 10, maxHp: 100 });
    world.agents.push(supporter, farAlly);
    expect(applySupportMove(world, supporter, undefined)).toBe(false);

    const onCooldown = makeAgent({
      id: "s3",
      pos: { x: 0, y: 0 },
      herdId: "h2",
      moves: [HEAL_ALLY],
      moveCooldowns: { nurture: 2 },
    });
    const nearAlly = makeAgent({ id: "a4", pos: { x: 1, y: 0 }, herdId: "h2", hp: 10, maxHp: 100 });
    world.agents.push(onCooldown, nearAlly);
    expect(applySupportMove(world, onCooldown, undefined)).toBe(false);
  });
});
