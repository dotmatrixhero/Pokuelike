import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { ageMortalityChance, createNeeds, decayNeeds, tickAgent, tickAgentAction, tickAgentNeeds } from "../src/needs.js";
import { CONSUME_STOCK_AMOUNT, FOOD_MAX_STOCK } from "../src/flora.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

// A real leak this session already hit once (see vitest.config.ts's "forks"
// pool comment, added for the cross-FILE version of this bug): a bare
// `vi.spyOn(Math, "random")` a few tests down (the "no tagged preference"
// exploration test) was never restored, so it silently pinned `Math.random`
// to 0 for every test that ran after it in this same file/process —
// harmless while shelter-building was species-gated (nothing else in this
// file called unmocked `Math.random`), but a real, order-dependent flake
// once shelter-building became universal (needs.ts's default `rng` param):
// later "idle, comfortable" fixtures would deterministically (or not) walk
// into `maybeTriggerShelterBuilding`'s `pickBuildSite` depending on whether
// this mock was still active, purely a function of test execution order.
afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("tickAgent", () => {
  it("moves a thirsty agent toward the nearest water tile on its layer", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 4, 0, "water");
    const agent = makeAgent({ needs: createNeeds({ thirst: 0.1 }) });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("seekWater");
    expect(agent.pos.x).toBeGreaterThan(0);
  });

  it("stays idle when all needs are satisfied", () => {
    const world = createWorld(5, 1);
    const agent = makeAgent({ pos: { x: 2, y: 0 } });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("idle");
    expect(agent.pos).toEqual({ x: 2, y: 0 });
  });

  it("drinks and restores thirst once it reaches the water tile", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "water");
    const agent = makeAgent({ pos: { x: 2, y: 0 }, needs: createNeeds({ thirst: 0.1 }) });

    tickAgent(world, agent);

    expect(agent.needs.thirst).toBeGreaterThan(0.1);
    expect(agent.pos).toEqual({ x: 2, y: 0 });
  });

  it("crosses to a neighboring layer when its resource isn't on the home layer", () => {
    const world = createWorld(3, 1);
    setTile(world, "surface", 1, 0, "food");
    const agent = makeAgent({
      species: "diglett",
      pos: { x: 1, y: 0 },
      layer: "underground",
      homeLayer: "underground",
      needs: createNeeds({ hunger: 0.1 }),
    });

    tickAgent(world, agent);

    expect(agent.layer).toBe("surface");
  });

  it("returns to its home layer once idle away from home", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ layer: "surface", homeLayer: "underground" });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("idle");
    expect(agent.layer).toBe("underground");
  });

  it("eating depletes the food patch's stock, and a depleted patch is skipped as a target", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    const agent = makeAgent({ pos: { x: 2, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });

    tickAgent(world, agent);
    expect(tileAt(world, "surface", 2, 0)!.stock).toBeCloseTo(FOOD_MAX_STOCK - CONSUME_STOCK_AMOUNT);

    tileAt(world, "surface", 2, 0)!.stock = 0;
    const secondAgent = makeAgent({ id: "a2", pos: { x: 2, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });
    tickAgent(world, secondAgent);
    expect(secondAgent.pos).toEqual({ x: 2, y: 0 }); // no reachable food, so it doesn't just sit "on" the depleted tile pretending to eat
    expect(secondAgent.behavior).toBe("seekFood");
  });

  it("eating Herbs grants a real, short status-immunity window — CROPS_DESIGN.md's own 'humble remedy' hook, reusing Safeguard's field", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    tileAt(world, "surface", 2, 0)!.flavor = "herbs";
    const agent = makeAgent({ pos: { x: 2, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });
    expect(agent.statusImmuneTicksRemaining).toBeUndefined();

    tickAgent(world, agent);

    expect(agent.statusImmuneTicksRemaining).toBeGreaterThan(0);
  });

  it("eating a real nutrition crop (not Herbs) does not grant status immunity", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    // corn, not pumpkin — pumpkin is underground-native and would require
    // digging (see the "layer-gated crop access" describe block below),
    // which is unrelated to what this test is actually checking.
    tileAt(world, "surface", 2, 0)!.flavor = "corn";
    const agent = makeAgent({ pos: { x: 2, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });

    tickAgent(world, agent);

    expect(agent.statusImmuneTicksRemaining).toBeUndefined();
  });

  it("eating a high-quality patch restores noticeably more hunger than eating a low-quality one — direct ask: \"fully fertile plant gives super higher quality berries\"", () => {
    function hungerRestored(quality: number): number {
      const world = createWorld(5, 1);
      setTile(world, "surface", 2, 0, "food");
      tileAt(world, "surface", 2, 0)!.quality = quality;
      const agent = makeAgent({ pos: { x: 2, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });

      tickAgent(world, agent);

      return agent.needs.hunger - 0.1;
    }

    expect(hungerRestored(1)).toBeGreaterThan(hungerRestored(0));
  });
});

/** Real, reusable test fixture for a `burrow`-flagged move — shared by the digging and dig-a-spring describe blocks below, since both real mechanics reuse the same move-speedup hook. */
const DIG_MOVE: MoveSpec = {
  id: "test-dig",
  name: "Test Dig",
  shape: { kind: "point" },
  type: "ground",
  category: "status",
  power: 0,
  accuracy: 100,
  cooldownTicks: 15,
  burrow: { ticks: 20 },
};

describe("layer-gated crop access + digging (CROPS_DESIGN.md)", () => {

  it("a surface agent can't eat an underground-native crop (Potato) instantly — it has to dig first", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    const tile = tileAt(world, "surface", 2, 0)!;
    tile.flavor = "potato";
    const startingStock = tile.stock;
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "surface", needs: createNeeds({ hunger: 0.1 }) });

    tickAgent(world, agent);

    expect(tile.stock).toBe(startingStock); // no real consume happened yet
    expect(agent.digTicksAccrued).toBe(1);
  });

  it("digging completes after enough real ticks standing there, then the agent actually eats", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    const tile = tileAt(world, "surface", 2, 0)!;
    tile.flavor = "potato";
    const startingStock = tile.stock!;
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "surface", needs: createNeeds({ hunger: 0.1 }) });

    let completedTick: number | undefined;
    for (let t = 0; t < 20 && completedTick === undefined; t++) {
      tickAgent(world, agent);
      if (tile.stock! < startingStock) completedTick = t; // a real consume actually happened
    }

    expect(completedTick).toBeDefined();
    // Completes once digTicksAccrued crosses DIG_TICKS_DEFAULT (15) — real
    // multi-tick cost, not instant, and not wildly off that number either.
    expect(completedTick!).toBeGreaterThanOrEqual(14);
    expect(completedTick!).toBeLessThan(20);
  });

  it("an agent already on the crop's native layer pays no dig tax at all — eats immediately", () => {
    const world = createWorld(5, 1);
    setTile(world, "underground", 2, 0, "food");
    tileAt(world, "underground", 2, 0)!.flavor = "potato";
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "underground", homeLayer: "underground", needs: createNeeds({ hunger: 0.1 }) });

    tickAgent(world, agent);

    expect(agent.needs.hunger).toBeGreaterThan(0.1); // ate immediately, no digging
    expect(agent.digTicksAccrued).toBeUndefined();
  });

  it("an ordinary surface-native crop (Corn) is never gated by digging, on any layer", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    tileAt(world, "surface", 2, 0)!.flavor = "corn";
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "surface", needs: createNeeds({ hunger: 0.1 }) });

    tickAgent(world, agent);

    expect(agent.needs.hunger).toBeGreaterThan(0.1);
    expect(agent.digTicksAccrued).toBeUndefined();
  });

  it("an off-cooldown dig move grants a real burst of dig progress, not just +1/tick", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    tileAt(world, "surface", 2, 0)!.flavor = "potato";
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "surface", needs: createNeeds({ hunger: 0.1 }), moves: [DIG_MOVE] });

    tickAgent(world, agent);

    expect(agent.digTicksAccrued).toBeGreaterThan(1);
    expect(agent.moveCooldowns?.[DIG_MOVE.id]).toBe(DIG_MOVE.cooldownTicks); // real cooldown applied — can't spam every tick
  });
});

/** Real, low-power melee attack move — for canopy-harvest-by-damage tests. */
const MELEE_ATTACK_MOVE: MoveSpec = {
  id: "test-melee",
  name: "Test Tackle",
  shape: { kind: "point" },
  type: "normal",
  category: "physical",
  power: 40,
  accuracy: 100,
  cooldownTicks: 5,
  range: { min: 0, max: 1 },
};

/** Same, but with a much longer range — for the "higher range gives advantage" assertion. */
const RANGED_ATTACK_MOVE: MoveSpec = {
  id: "test-ranged",
  name: "Test Peck",
  shape: { kind: "point" },
  type: "flying",
  category: "physical",
  power: 35,
  accuracy: 100,
  cooldownTicks: 5,
  range: { min: 0, max: 4 },
};

describe("canopy harvest by damage (CROPS_DESIGN.md: \"canopy foods can also be processed by damage, with higher range giving advantage\")", () => {
  it("a non-canopy agent can't eat a canopy-native crop (Apple) instantly — it has to process it out first", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    const tile = tileAt(world, "surface", 2, 0)!;
    tile.flavor = "apple";
    const startingStock = tile.stock;
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "surface", needs: createNeeds({ hunger: 0.1 }) });

    tickAgent(world, agent);

    expect(tile.stock).toBe(startingStock);
    expect(agent.digTicksAccrued).toBe(1); // no move known — falls back to +1/tick, same as digging's own fallback
  });

  it("an off-cooldown damage move (not a dig/burrow move) processes an Apple out over real time", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    const tile = tileAt(world, "surface", 2, 0)!;
    tile.flavor = "apple";
    const startingStock = tile.stock!;
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "surface", needs: createNeeds({ hunger: 0.1 }), moves: [MELEE_ATTACK_MOVE] });

    let completedTick: number | undefined;
    for (let t = 0; t < 20 && completedTick === undefined; t++) {
      tickAgent(world, agent);
      if (tile.stock! < startingStock) completedTick = t;
    }

    expect(completedTick).toBeDefined();
    expect(agent.needs.hunger).toBeGreaterThan(0.1); // it actually ate once processing finished
  });

  it("a higher-range damage move processes an Apple out faster than a melee-only one — \"higher range giving advantage\"", () => {
    function ticksToHarvest(move: MoveSpec): number {
      const world = createWorld(5, 1);
      setTile(world, "surface", 2, 0, "food");
      const tile = tileAt(world, "surface", 2, 0)!;
      tile.flavor = "apple";
      const startingStock = tile.stock!;
      const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "surface", needs: createNeeds({ hunger: 0.1 }), moves: [move] });

      for (let t = 0; t < 20; t++) {
        tickAgent(world, agent);
        if (tile.stock! < startingStock) return t;
      }
      throw new Error("never completed");
    }

    expect(ticksToHarvest(RANGED_ATTACK_MOVE)).toBeLessThan(ticksToHarvest(MELEE_ATTACK_MOVE));
  });

  it("a status move (real power 0) never substitutes for a damage move — falls back to +1/tick", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    tileAt(world, "surface", 2, 0)!.flavor = "apple";
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "surface", needs: createNeeds({ hunger: 0.1 }), moves: [DIG_MOVE] }); // DIG_MOVE is category "status", power 0

    tickAgent(world, agent);

    expect(agent.digTicksAccrued).toBe(1); // no damage-move bonus, and burrow doesn't count for Canopy either
    expect(agent.moveCooldowns?.[DIG_MOVE.id]).toBeUndefined(); // never actually used
  });

  it("a canopy agent already on the crop's native layer pays no processing tax at all — eats immediately", () => {
    const world = createWorld(5, 1);
    setTile(world, "canopy", 2, 0, "food");
    tileAt(world, "canopy", 2, 0)!.flavor = "apple";
    const agent = makeAgent({ pos: { x: 2, y: 0 }, layer: "canopy", homeLayer: "canopy", needs: createNeeds({ hunger: 0.1 }) });

    tickAgent(world, agent);

    expect(agent.needs.hunger).toBeGreaterThan(0.1);
    expect(agent.digTicksAccrued).toBeUndefined();
  });
});

describe("dig a spring (CROPS_DESIGN.md water rework: real last resort when water genuinely doesn't exist anywhere)", () => {
  it("an agent with no reachable water anywhere digs a real new spring at its own position, over real time", () => {
    const world = createWorld(3, 1); // no water anywhere on any layer
    const agent = makeAgent({ pos: { x: 1, y: 0 }, needs: createNeeds({ thirst: 0.3 }) });

    let dugTick: number | undefined;
    for (let t = 0; t < 25 && dugTick === undefined; t++) {
      tickAgent(world, agent);
      agent.needs.thirst = Math.max(agent.needs.thirst, 0.05); // isolate from starvation
      if (tileAt(world, "surface", 1, 0)!.terrain === "water") dugTick = t;
    }

    expect(dugTick).toBeDefined();
    expect(dugTick!).toBeGreaterThanOrEqual(19); // SPRING_DIG_TICKS = 20, real multi-tick cost
    expect(agent.springDigTicksAccrued).toBeUndefined(); // reset once finished
  });

  it("does NOT dig a spring while known water tiles exist but are merely crowded — falls through to the ordinary wait/relocate path instead", () => {
    const world = createWorld(10, 3);
    setTile(world, "surface", 2, 1, "water");
    // Crowd it to capacity.
    world.agents = [
      makeAgent({ id: "c1", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c2", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c3", pos: { x: 2, y: 1 }, maxHp: 30 }),
    ];
    const agent = makeAgent({ id: "thirsty", pos: { x: 0, y: 1 }, maxHp: 30, needs: createNeeds({ thirst: 0.1 }) });
    world.agents.push(agent);

    for (let t = 0; t < 60; t++) {
      tickAgentAction(world, agent);
      agent.needs.thirst = Math.max(agent.needs.thirst, 0.1);
    }

    expect(agent.springDigTicksAccrued).toBeUndefined();
    expect(tileAt(world, "surface", 0, 1)!.terrain).not.toBe("water");
  });

  it("never carves through an obstacle — only real bare 'floor'", () => {
    const world = createWorld(3, 1); // no water anywhere
    setTile(world, "surface", 1, 0, "boulder");
    const agent = makeAgent({ pos: { x: 1, y: 0 }, needs: createNeeds({ thirst: 0.3 }) });

    for (let t = 0; t < 30; t++) {
      tickAgent(world, agent);
      agent.needs.thirst = Math.max(agent.needs.thirst, 0.05);
    }

    expect(tileAt(world, "surface", 1, 0)!.terrain).toBe("boulder"); // never dug
    expect(agent.springDigTicksAccrued).toBeUndefined();
  });

  it("an off-cooldown dig move speeds up digging a spring the same way it speeds up crop-digging", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ pos: { x: 1, y: 0 }, needs: createNeeds({ thirst: 0.3 }), moves: [DIG_MOVE] });

    tickAgent(world, agent);

    expect(agent.springDigTicksAccrued).toBeGreaterThan(1);
    expect(agent.moveCooldowns?.[DIG_MOVE.id]).toBe(DIG_MOVE.cooldownTicks);
  });
});

describe("herd-status feeding priority", () => {
  // Real contention mechanism (see needs.ts's `yieldsToHigherRankedFeeder`
  // doc comment): `tickWorld`'s per-agent loop lets multiple herd-mates
  // reach and target the very same food tile within one call, since
  // `findNearestIndexed` only drops a tile once its `stock` actually hits 0
  // (a tile doesn't revert to "floor" until `growFlora` runs once, after the
  // whole loop) — this exercises that real mechanism directly via
  // `tickAgent`, calling each herd-mate's turn in an explicit order to prove
  // rank decides who eats first regardless of which one's turn came first.

  it("a lower-ranked herd-mate yields to a higher-ranked, equally-hungry one on the same dwindling-stock tile, even when its own turn comes first", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    tileAt(world, "surface", 2, 0)!.stock = 0.4; // below the 0.5 dwindling threshold

    const low = makeAgent({ id: "low", pos: { x: 2, y: 0 }, herdId: "h", level: 1, needs: createNeeds({ hunger: 0.5 }) });
    const high = makeAgent({ id: "high", pos: { x: 2, y: 0 }, herdId: "h", level: 10, needs: createNeeds({ hunger: 0.5 }) });
    world.agents.push(low, high);

    // Low-rank's turn happens first — without rank-awareness it would simply
    // eat, since it's the first (and currently only-considered) claimant.
    tickAgent(world, low);
    // Yielded: hunger only moved by this tick's ordinary decay, not the 0.4
    // consume() restore — nowhere near what a successful feeding would give.
    expect(low.needs.hunger).toBeLessThan(0.5);
    expect(low.needs.hunger).toBeGreaterThan(0.49);
    expect(low.pos).toEqual({ x: 2, y: 0 });

    // High-rank's turn: nothing stops it, it eats normally.
    tickAgent(world, high);
    expect(high.needs.hunger).toBeGreaterThan(0.85);

    // High-rank is now satisfied (no longer reads as seekFood), so low-rank
    // no longer has anyone to yield to and gets its turn — "whatever's left."
    tickAgent(world, low);
    expect(low.needs.hunger).toBeGreaterThan(0.85);
  });

  it("does not make an agent yield to a herd-mate that isn't also hungry", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food");
    tileAt(world, "surface", 2, 0)!.stock = 0.4;

    const low = makeAgent({ id: "low", pos: { x: 2, y: 0 }, herdId: "h", level: 1, needs: createNeeds({ hunger: 0.5 }) });
    const high = makeAgent({ id: "high", pos: { x: 2, y: 0 }, herdId: "h", level: 10, needs: createNeeds({ hunger: 1 }) });
    world.agents.push(low, high);

    tickAgent(world, low);
    expect(low.needs.hunger).toBeGreaterThan(0.85); // eats freely: the higher-rank mate isn't contesting the tile
  });

  it("does not make anyone yield while the tile's stock isn't actually dwindling yet", () => {
    const world = createWorld(5, 1);
    setTile(world, "surface", 2, 0, "food"); // default full stock (1), well above the threshold

    const low = makeAgent({ id: "low", pos: { x: 2, y: 0 }, herdId: "h", level: 1, needs: createNeeds({ hunger: 0.5 }) });
    const high = makeAgent({ id: "high", pos: { x: 2, y: 0 }, herdId: "h", level: 10, needs: createNeeds({ hunger: 0.5 }) });
    world.agents.push(low, high);

    tickAgent(world, low);
    expect(low.needs.hunger).toBeGreaterThan(0.85); // plenty for both — no reason to make it wait
  });
});

describe("starvation", () => {
  it("survives a while at 0 hunger, then dies once the grace period runs out", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ needs: createNeeds({ hunger: 0 }) });

    for (let i = 0; i < 99; i++) tickAgent(world, agent);
    expect(agent.alive).not.toBe(false);

    tickAgent(world, agent);
    expect(agent.alive).toBe(false);
  });

  it("records a starved event with the right cause", () => {
    const world = createWorld(3, 1);
    // Real, undiggable trap: no floor at the agent's own position, so the
    // dig-a-spring last resort (CROPS_DESIGN.md's water rework) can't
    // rescue it — this test is specifically about genuine, unrecoverable
    // thirst-starvation death, not "does digging save it."
    setTile(world, "surface", 0, 0, "boulder");
    const agent = makeAgent({ needs: createNeeds({ thirst: 0, hunger: 1 }) });
    const log = new EventLog();

    // Keep hunger topped up so this test isolates thirst as the sole cause of
    // death. Thirst's own grace period (THIRST_STARVATION_GRACE_TICKS, 150)
    // is longer than hunger's (100) — see the dedicated grace-period test
    // below for the exact boundary.
    for (let i = 0; i < 150 && agent.alive !== false; i++) {
      tickAgent(world, agent, log);
      agent.needs.hunger = 1;
    }

    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "starved", agentId: "a1", cause: "thirst" })
    );
  });

  it("gives thirst its own, longer grace period — survives past the old 100-tick hunger threshold", () => {
    const world = createWorld(3, 1);
    // Thirst hits 0 immediately; hunger stays comfortably positive the whole
    // time (kept topped up each tick) so this isolates thirst's own
    // THIRST_STARVATION_GRACE_TICKS (150) from hunger's STARVATION_GRACE_TICKS
    // (100) — confirms thirst does NOT die at the old shared 100-tick
    // threshold, and DOES die once its own longer window actually runs out.
    // Real, undiggable trap (see the previous test's own comment) so
    // dig-a-spring can't rescue this agent before the grace period runs out.
    setTile(world, "surface", 0, 0, "boulder");
    const agent = makeAgent({ needs: createNeeds({ thirst: 0, hunger: 1 }) });

    for (let i = 0; i < 149; i++) {
      tickAgent(world, agent);
      agent.needs.hunger = 1;
    }
    expect(agent.alive).not.toBe(false); // still alive well past the old 100-tick hunger threshold

    agent.needs.hunger = 1;
    tickAgent(world, agent);
    expect(agent.alive).toBe(false);
  });

  it("recovering above 0 resets the starvation clock", () => {
    const world = createWorld(3, 1);
    setTile(world, "surface", 1, 0, "food");
    const agent = makeAgent({ pos: { x: 1, y: 0 }, needs: createNeeds({ hunger: 0 }) });
    agent.starvationTicks = 90; // pretend it's already been starving a while

    tickAgent(world, agent); // starvationTicks -> 91 (checked before eating this tick), then eats
    expect(agent.needs.hunger).toBeGreaterThan(0);

    tickAgent(world, agent); // hunger already >0 from last tick's meal -> clock resets
    expect(agent.starvationTicks).toBe(0);
    expect(agent.alive).not.toBe(false);
  });
});

describe("ageMortalityChance", () => {
  it("is zero before old age onset", () => {
    expect(ageMortalityChance(0)).toBe(0);
    expect(ageMortalityChance(1499)).toBe(0);
  });

  it("ramps up between onset and the hazard cap age", () => {
    const early = ageMortalityChance(1600);
    const late = ageMortalityChance(2900);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
  });

  it("saturates at the max chance from the cap age onward", () => {
    const atCap = ageMortalityChance(3000);
    const wellPast = ageMortalityChance(10000);
    expect(atCap).toBe(wellPast);
    expect(atCap).toBeGreaterThan(0);
  });
});

describe("old-age mortality", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Disabled per direct instruction ("dying of old age is kinda dumb") —
  // tickAgent no longer calls ageMortalityChance at all. The function
  // itself is left in place, unused, same call as the skill-point removal:
  // easy to re-wire later if wanted, harmless sitting idle in the meantime.
  it("no agent dies of old age regardless of age or roll, even at a fully-saturated hazard", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ age: 3000 /* OLD_AGE_HAZARD_CAP_AGE, hazard would be fully saturated */ });
    const log = new EventLog();
    vi.spyOn(Math, "random").mockReturnValue(0); // would have killed anything with a nonzero hazard

    tickAgent(world, agent, log);

    expect(agent.alive).not.toBe(false);
    expect(log.events).not.toContainEqual(expect.objectContaining({ kind: "diedOfAge" }));
  });

  it("an agent with no age (spawned directly into a scenario) is unaffected either way", () => {
    const world = createWorld(3, 1);
    const agent = makeAgent({ age: undefined });
    vi.spyOn(Math, "random").mockReturnValue(0);

    tickAgent(world, agent);

    expect(agent.alive).not.toBe(false);
  });
});

// Below `SHELTER_COMFORT_THRESHOLD` (0.85) but well above `chooseBehavior`'s
// 0.7 urgency cutoff — "idle enough to explore" without also being
// "comfortable enough to trigger shelter-building" (universal now, per
// shelter.ts's doc comment, so a plain fully-satisfied `makeAgent` fixture
// would otherwise nondeterministically divert into building a shelter
// instead of exploring, depending on `pickBuildSite`'s unseeded rng roll).
const EXPLORE_NOT_SHELTER_NEEDS = { hunger: 0.8, thirst: 0.8 };

describe("exp-motivated exploration", () => {
  it("a fully-satisfied idle agent in a large world wanders toward unexplored territory instead of standing still", () => {
    const world = createWorld(40, 40);
    const agent = makeAgent({ pos: { x: 20, y: 20 }, needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("explore");
    expect(agent.pos).not.toEqual({ x: 20, y: 20 });
  });

  it("keeps walking toward the same exploreTarget across multiple ticks rather than re-rolling every tick", () => {
    const world = createWorld(40, 40);
    const agent = makeAgent({ pos: { x: 20, y: 20 }, needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });

    tickAgent(world, agent);
    const target = agent.exploreTarget;
    expect(target).toBeDefined();

    tickAgent(world, agent);
    // Still walking toward the very same target, not a freshly re-rolled one.
    expect(agent.exploreTarget ?? agent.pos).toEqual(target);
  });

  it("an urgent need interrupts an in-progress exploration walk", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 0, 0, "water");
    const agent = makeAgent({ pos: { x: 20, y: 20 }, needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });

    tickAgent(world, agent);
    expect(agent.behavior).toBe("explore");

    agent.needs.thirst = 0.1; // now urgent
    tickAgent(world, agent);

    expect(agent.behavior).toBe("seekWater");
    expect(agent.exploreTarget).toBeUndefined();
  });

  it("does nothing (stays idle) when the entire reachable world is already one visited sector", () => {
    const world = createWorld(3, 3); // one sector total (SECTOR_SIZE=5) — markSectorVisited marks it before exploration is even considered
    const agent = makeAgent({ pos: { x: 1, y: 1 } });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("idle");
    expect(agent.pos).toEqual({ x: 1, y: 1 });
  });
});

describe("tile preference (Agent.preferredTerrain, applyExploration)", () => {
  it("a satisfied agent with a tagged flora preference heads toward the nearest flora tile instead of a random unvisited one", () => {
    const world = createWorld(40, 40);
    // Only one flora tile anywhere on the map — deterministic single target,
    // no reliance on rng at all for this path.
    setTile(world, "surface", 35, 20, "flora");
    const agent = makeAgent({ pos: { x: 20, y: 20 }, preferredTerrain: ["flora"], needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("explore");
    expect(agent.exploreTarget).toEqual({ x: 35, y: 20 });
    // Actually moved toward it this tick, not just picked a target and stalled.
    expect(agent.pos.x).toBeGreaterThan(20);
  });

  it("a satisfied agent with a tagged water preference heads toward water, not wherever ordinary random exploration would otherwise go", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 5, 20, "water");
    const agent = makeAgent({ pos: { x: 20, y: 20 }, preferredTerrain: ["water"], needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });

    tickAgent(world, agent);

    expect(agent.exploreTarget).toEqual({ x: 5, y: 20 });
    expect(agent.pos.x).toBeLessThan(20);
  });

  it("an agent already lingering near its preferred terrain stays idle instead of wandering off to a new spot", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 21, 20, "flora"); // 1 tile away, inside the "already satisfied" radius
    const agent = makeAgent({ pos: { x: 20, y: 20 }, preferredTerrain: ["flora"], needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });

    tickAgent(world, agent);

    expect(agent.behavior).toBe("idle");
    expect(agent.pos).toEqual({ x: 20, y: 20 });
    expect(agent.exploreTarget).toBeUndefined();
  });

  it("falls back to a bounded local scan for a preference kind outside the cheap resource index (e.g. boulder)", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 25, 20, "boulder");
    const agent = makeAgent({ pos: { x: 20, y: 20 }, preferredTerrain: ["boulder"], needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });

    tickAgent(world, agent);

    expect(agent.exploreTarget).toEqual({ x: 25, y: 20 });
  });

  it("tries preferred terrain kinds in order, falling through to the next when the first has no reachable tile anywhere", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 30, 20, "water"); // no "flora" placed anywhere on this map
    const agent = makeAgent({ pos: { x: 20, y: 20 }, preferredTerrain: ["flora", "water"], needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });

    tickAgent(world, agent);

    expect(agent.exploreTarget).toEqual({ x: 30, y: 20 });
  });

  it("an agent with no tagged preference is completely unaffected — same random-wander behavior as before this feature", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 35, 20, "flora"); // present on the map, but this agent isn't tagged to care
    const agent = makeAgent({ pos: { x: 20, y: 20 }, needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) }); // no preferredTerrain

    vi.spyOn(Math, "random").mockReturnValue(0); // deterministic: findNearbyUnvisitedTile's first roll always lands top-left of the search box

    tickAgent(world, agent);

    expect(agent.behavior).toBe("explore");
    // Never even looks at the flora tile — target is the ordinary
    // rng-driven unvisited-sector pick, not the flora tile placed above.
    expect(agent.exploreTarget).not.toEqual({ x: 35, y: 20 });
  });

  it("rng-determinism: the preference-driven wander consumes no rng and is byte-identical across two independent runs from the same state", () => {
    function run(): { pos: Agent["pos"]; target: Agent["exploreTarget"] } {
      const world = createWorld(40, 40);
      setTile(world, "surface", 35, 20, "flora");
      const agent = makeAgent({ pos: { x: 20, y: 20 }, preferredTerrain: ["flora"], needs: createNeeds(EXPLORE_NOT_SHELTER_NEEDS) });
      tickAgent(world, agent);
      return { pos: agent.pos, target: agent.exploreTarget };
    }
    const first = run();
    const second = run();
    expect(second).toEqual(first);
  });
});

describe("water-graze foraging (Agent.obligateAquatic / preferredTerrain water)", () => {
  it("a hungry water-affiliated agent standing on water can feed without any 'food' tile existing anywhere", () => {
    const world = createWorld(10, 10); // no "food" terrain placed anywhere
    setTile(world, "surface", 5, 5, "water");
    const agent = makeAgent({ pos: { x: 5, y: 5 }, obligateAquatic: true, needs: createNeeds({ hunger: 0.3 }) });

    vi.spyOn(Math, "random").mockReturnValue(0); // always wins the WATER_FORAGE_CHANCE_PER_TICK roll
    tickAgentAction(world, agent);

    expect(agent.needs.hunger).toBeGreaterThan(0.3);
    expect(agent.pos).toEqual({ x: 5, y: 5 }); // never had to travel anywhere
  });

  it("a merely water-preferring (not obligate-aquatic) agent standing on water also gets the graze", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    const agent = makeAgent({ pos: { x: 5, y: 5 }, preferredTerrain: ["water"], needs: createNeeds({ hunger: 0.3 }) });

    vi.spyOn(Math, "random").mockReturnValue(0);
    tickAgentAction(world, agent);

    expect(agent.needs.hunger).toBeGreaterThan(0.3);
  });

  it("never fires for a water-affiliated agent standing on dry land", () => {
    const world = createWorld(10, 10); // no water anywhere
    const agent = makeAgent({ pos: { x: 5, y: 5 }, obligateAquatic: true, needs: createNeeds({ hunger: 0.3 }) });

    vi.spyOn(Math, "random").mockReturnValue(0);
    tickAgentAction(world, agent);

    // Falls through to the ordinary (here fruitless, no food tile) seekFood
    // search instead — hunger stays exactly where it was, not restored by
    // the water graze.
    expect(agent.needs.hunger).toBe(0.3);
  });

  it("never fires for an ordinary (non-water-affiliated) agent even when standing on water", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "water");
    const agent = makeAgent({ pos: { x: 5, y: 5 }, needs: createNeeds({ hunger: 0.3 }) }); // no obligateAquatic, no water preference

    vi.spyOn(Math, "random").mockReturnValue(0);
    tickAgentAction(world, agent);

    expect(agent.needs.hunger).toBe(0.3);
  });
});

describe("decayNeeds: thirstMultiplier composes with the flat decay rate (Phase 3 weather)", () => {
  it("defaults to the original flat rate when no multiplier is passed", () => {
    const needs = createNeeds();
    decayNeeds(needs);
    expect(needs.thirst).toBeCloseTo(1 - 0.00125, 10);
  });

  it("a multiplier below 1 (rain) eases thirst decay relative to the base rate", () => {
    const needs = createNeeds();
    decayNeeds(needs, 0.6);
    const eased = 1 - needs.thirst;
    expect(eased).toBeCloseTo(0.00125 * 0.6, 10);
    expect(eased).toBeLessThan(0.00125);
  });

  it("a multiplier above 1 (drought) raises thirst decay relative to the base rate", () => {
    const needs = createNeeds();
    decayNeeds(needs, 1.8);
    const raised = 1 - needs.thirst;
    expect(raised).toBeCloseTo(0.00125 * 1.8, 10);
    expect(raised).toBeGreaterThan(0.00125);
  });

  it("does not touch hunger/energy/mateDrive — only thirst is weather-modulated", () => {
    const eased = createNeeds();
    const base = createNeeds();
    decayNeeds(eased, 0.6);
    decayNeeds(base);
    expect(eased.hunger).toBe(base.hunger);
    expect(eased.energy).toBe(base.energy);
    expect(eased.mateDrive).toBe(base.mateDrive);
  });
});

describe("tickAgentNeeds: local weather composes with thirst decay through a real World", () => {
  it("an agent standing in an active drought cell loses thirst faster than one on a clear tile", () => {
    const droughtWorld = createWorld(10, 10);
    droughtWorld.weatherCells = [
      { id: "d", type: "drought", center: { x: 5, y: 5 }, radius: 3, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];
    const droughtAgent = makeAgent({ pos: { x: 5, y: 5 } });

    const clearWorld = createWorld(10, 10);
    const clearAgent = makeAgent({ pos: { x: 5, y: 5 } });

    tickAgentNeeds(droughtAgent, droughtWorld);
    tickAgentNeeds(clearAgent, clearWorld);

    expect(droughtAgent.needs.thirst).toBeLessThan(clearAgent.needs.thirst);
  });

  it("an agent outside the drought cell's radius decays at the ordinary rate", () => {
    const world = createWorld(30, 30);
    world.weatherCells = [
      { id: "d", type: "drought", center: { x: 25, y: 25 }, radius: 2, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];
    const farAgent = makeAgent({ pos: { x: 1, y: 1 } });
    tickAgentNeeds(farAgent, world);
    expect(farAgent.needs.thirst).toBeCloseTo(1 - 0.00125, 10);
  });
});

describe("tile-capacity: blocked-resource fallback", () => {
  // 3 rows tall (not 1) in every test below — a real route around a crowded
  // tile needs to actually exist. A single-row world would force every path
  // straight through the crowded tile, which is a dead end, not the "blocked
  // resource with a way around" scenario this feature targets.

  it("waits near a crowded target rather than instantly bailing on it", () => {
    const world = createWorld(10, 3);
    setTile(world, "surface", 2, 1, "water");
    setTile(world, "surface", 8, 1, "water");
    // Crowd the nearer tile (x=2,y=1) to capacity — three 30-weight
    // occupants at the 90 capacity ceiling.
    world.agents = [
      makeAgent({ id: "c1", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c2", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c3", pos: { x: 2, y: 1 }, maxHp: 30 }),
    ];
    const agent = makeAgent({ id: "thirsty", pos: { x: 0, y: 1 }, maxHp: 30, needs: createNeeds({ thirst: 0.1 }) });
    world.agents.push(agent);

    for (let i = 0; i < 10; i++) tickAgentAction(world, agent);

    // Still hasn't drunk (never got a slot on the crowded tile) and hasn't
    // given up on it yet either (grace period not exhausted).
    expect(agent.needs.thirst).toBeCloseTo(0.1, 5);
    expect(agent.blockedResourceTiles ?? []).toHaveLength(0);
    expect(world.resourceBlockedFallbackCount ?? 0).toBe(0);
  });

  it("gives up on a persistently crowded tile after its grace period and tries a different one", () => {
    const world = createWorld(10, 3);
    setTile(world, "surface", 2, 1, "water");
    setTile(world, "surface", 8, 1, "water");
    world.agents = [
      makeAgent({ id: "c1", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c2", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c3", pos: { x: 2, y: 1 }, maxHp: 30 }),
    ];
    const agent = makeAgent({ id: "thirsty", pos: { x: 0, y: 1 }, maxHp: 30, needs: createNeeds({ thirst: 0.1 }) });
    world.agents.push(agent);

    // Run exactly past the grace period (25 ticks) — one tick past where the
    // fallback should have just fired, before it's had time to also walk all
    // the way to and drink from the alternate.
    for (let i = 0; i < 25; i++) {
      tickAgentAction(world, agent);
      if (agent.needs.thirst < 0.1) agent.needs.thirst = 0.1;
    }

    expect(world.resourceBlockedFallbackCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(agent.blockedResourceTiles?.some((p) => p.x === 2 && p.y === 1)).toBe(true);

    // Now let it actually walk to and drink from the alternate (x=8,y=1),
    // which isn't crowded — confirms the fallback produces a real, working
    // target, not just a memory entry.
    for (let i = 0; i < 30; i++) {
      tickAgentAction(world, agent);
      if (agent.needs.thirst < 0.1) agent.needs.thirst = 0.1;
      if (agent.needs.thirst > 0.1) break;
    }
    expect(agent.needs.thirst).toBeGreaterThan(0.1);
  });

  it("does not infinite-loop between two mutually-crowded tiles — eventually relocates instead of oscillating forever", () => {
    const world = createWorld(10, 3);
    setTile(world, "surface", 2, 1, "water");
    setTile(world, "surface", 8, 1, "water");
    // Crowd BOTH tiles to capacity.
    world.agents = [
      makeAgent({ id: "c1", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c2", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c3", pos: { x: 2, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c4", pos: { x: 8, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c5", pos: { x: 8, y: 1 }, maxHp: 30 }),
      makeAgent({ id: "c6", pos: { x: 8, y: 1 }, maxHp: 30 }),
    ];
    const agent = makeAgent({ id: "thirsty", pos: { x: 0, y: 1 }, maxHp: 30, needs: createNeeds({ thirst: 0.1 }) });
    world.agents.push(agent);

    let sawRelocate = false;
    for (let i = 0; i < 300; i++) {
      tickAgentAction(world, agent);
      agent.needs.thirst = Math.max(agent.needs.thirst, 0.1); // isolate from starvation/death
      if (agent.behavior === "relocate") {
        sawRelocate = true;
        break;
      }
    }

    // With both known water tiles perpetually full, the agent must eventually
    // fall through to the existing, already-tested relocate/migrate escape
    // valve rather than bouncing between the two forever.
    expect(sawRelocate).toBe(true);
  });
});

describe("migration on unreachable resources", () => {
  it("an agent that can never find food eventually migrates instead of standing still forever", () => {
    const world = createWorld(30, 30); // no food anywhere on any layer
    const agent = makeAgent({ pos: { x: 15, y: 15 }, needs: createNeeds({ hunger: 0.5, thirst: 1 }) });
    // Keep hunger from ever reaching the starvation floor so this test isolates migration, not starvation.
    for (let i = 0; i < 149; i++) {
      tickAgent(world, agent);
      agent.needs.hunger = 0.5;
    }

    tickAgent(world, agent);

    expect(agent.behavior).toBe("relocate");
    expect(agent.relocateTarget).toBeDefined();
  });
});

describe("seekWater near a large lake: targets a genuinely reachable tile, not the raw-nearest one", () => {
  /**
   * `findNearestTerrain` is purely geometric ("nearest water tile by
   * Manhattan distance") — it has no idea `waterBody.ts`'s `canEnterWater`
   * can rule an otherwise-nearer tile out for a non-water-type agent. This
   * builds exactly that trap: a large lake walled in on every side except
   * one gap, so the raw-nearest water tile to an agent approaching from the
   * WRONG side is one whose only "land" neighbor is an unwalkable wall (so
   * `waterBody.ts`'s `isShoreTile` correctly refuses it) even though it's
   * still the closest water tile in straight-line terms — while the real,
   * reachable shore sits behind the one gap, farther away by raw distance.
   * Before this session's fix, `seekWater` would just keep re-targeting the
   * nearer, unreachable tile forever (`stepAlongPath`/`findPath` correctly
   * refusing to route into it every single tick) and the agent would never
   * drink — exactly the "silently unreachable target" bug class flagged in
   * `pathfinding.ts`'s `stepTowardMovingTarget` doc comment, just for
   * drinking instead of hunting.
   */
  function buildWalledLake(world: ReturnType<typeof createWorld>): void {
    for (let x = 5; x <= 14; x++) {
      for (let y = 5; y <= 14; y++) setTile(world, "surface", x, y, "water");
    }
    // Wall the entire ring immediately outside the lake...
    for (let x = 4; x <= 15; x++) {
      setTile(world, "surface", x, 4, "wall");
      setTile(world, "surface", x, 15, "wall");
    }
    for (let y = 4; y <= 15; y++) {
      setTile(world, "surface", 4, y, "wall");
      setTile(world, "surface", 15, y, "wall");
    }
    // ...except one gap on the north side (9,4), the only real way in.
    setTile(world, "surface", 9, 4, "floor");
  }

  it("a land-type agent approaching from the walled side still finds and drinks from the real shore, not the nearer walled-off tile", () => {
    const world = createWorld(20, 20);
    buildWalledLake(world);
    // West side, well outside the wall ring, so the raw-nearest water tile
    // (x=5, same row) sits behind the wall — genuinely unreachable — while
    // the real shore is behind the single north gap at (9,4)->(9,5).
    const agent = makeAgent({
      id: "thirsty",
      pos: { x: 0, y: 9 },
      needs: createNeeds({ thirst: 0.1, hunger: 1, energy: 1, mateDrive: 0 }),
    });
    world.agents.push(agent);

    let drank = false;
    for (let tick = 0; tick < 300 && !drank; tick++) {
      tickAgentAction(world, agent);
      if (agent.needs.thirst > 0.1) drank = true;
    }

    expect(drank).toBe(true);
  });

  it("a Rock-type agent (no special shore restriction) also successfully drinks via the real shore", () => {
    const world = createWorld(20, 20);
    buildWalledLake(world);
    const agent = makeAgent({
      id: "thirsty-rock",
      species: "geodude",
      types: ["rock"],
      pos: { x: 0, y: 9 },
      needs: createNeeds({ thirst: 0.1, hunger: 1, energy: 1, mateDrive: 0 }),
    });
    world.agents.push(agent);

    let drank = false;
    for (let tick = 0; tick < 300 && !drank; tick++) {
      tickAgentAction(world, agent);
      if (agent.needs.thirst > 0.1) drank = true;
    }

    expect(drank).toBe(true);
  });
});

describe("tickAgentAction: status-effect action-tick guards", () => {
  it("an asleep agent takes no action at all", () => {
    const world = createWorld(5, 5);
    const agent = makeAgent({ pos: { x: 0, y: 0 }, status: { kind: "sleep", ticksRemaining: 5 }, needs: createNeeds({ thirst: 0.1 }) });
    setTile(world, "surface", 4, 0, "water");
    tickAgentAction(world, agent);
    expect(agent.pos).toEqual({ x: 0, y: 0 }); // never moved toward water
  });

  it("a frozen agent takes no action at all", () => {
    const world = createWorld(5, 5);
    const agent = makeAgent({ pos: { x: 0, y: 0 }, status: { kind: "freeze" }, needs: createNeeds({ thirst: 0.1 }) });
    setTile(world, "surface", 4, 0, "water");
    tickAgentAction(world, agent);
    expect(agent.pos).toEqual({ x: 0, y: 0 });
  });

  it("a paralyzed agent skips this action tick on a failed roll, acts normally on a passed one", () => {
    const world = createWorld(5, 5);
    setTile(world, "surface", 4, 0, "water");
    const skipped = makeAgent({ pos: { x: 0, y: 0 }, status: { kind: "paralysis" }, needs: createNeeds({ thirst: 0.1 }) });
    tickAgentAction(world, skipped, undefined, undefined, undefined, () => 0); // 0 < PARALYSIS_SKIP_CHANCE
    expect(skipped.pos).toEqual({ x: 0, y: 0 });

    const acted = makeAgent({ pos: { x: 0, y: 0 }, status: { kind: "paralysis" }, needs: createNeeds({ thirst: 0.1 }) });
    tickAgentAction(world, acted, undefined, undefined, undefined, () => 0.99); // not < PARALYSIS_SKIP_CHANCE
    expect(acted.pos).not.toEqual({ x: 0, y: 0 });
  });

  it("a move-locked agent (MoveSpec.lockTicks, set via useMove) takes no action at all", () => {
    const world = createWorld(5, 5);
    setTile(world, "surface", 4, 0, "water");
    const agent = makeAgent({ pos: { x: 0, y: 0 }, actionLockTicks: 2, needs: createNeeds({ thirst: 0.1 }) });
    tickAgentAction(world, agent);
    expect(agent.pos).toEqual({ x: 0, y: 0 });
  });
});

describe("tickAgentNeeds: soil tending (direct ask: Grass-type Pokémon till/tend the ground they stand on)", () => {
  it("a live Grass-type agent raises the fertility of the tile under it, every tick", () => {
    const world = createWorld(3, 3);
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.fertility = 0.35;
    const grassAgent = makeAgent({ pos: { x: 1, y: 1 }, types: ["grass"] });

    tickAgentNeeds(grassAgent, world);

    expect(tile.fertility!).toBeGreaterThan(0.35);
  });

  it("a non-Grass-type agent standing on the same tile does nothing to its fertility", () => {
    const world = createWorld(3, 3);
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.fertility = 0.35;
    const waterAgent = makeAgent({ pos: { x: 1, y: 1 }, types: ["water"] });

    tickAgentNeeds(waterAgent, world);

    expect(tile.fertility).toBe(0.35);
  });

  it("a fainted (alive === false) Grass-type agent doesn't tend the ground — tickAgentNeeds returns before any of this", () => {
    const world = createWorld(3, 3);
    const tile = tileAt(world, "surface", 1, 1)!;
    tile.fertility = 0.35;
    const deadGrassAgent = makeAgent({ pos: { x: 1, y: 1 }, types: ["grass"], alive: false });

    tickAgentNeeds(deadGrassAgent, world);

    expect(tile.fertility).toBe(0.35);
  });

  it("a Grass-type agent underground (not surface) doesn't tend a surface tile at the same x,y", () => {
    const world = createWorld(3, 3);
    const surfaceTile = tileAt(world, "surface", 1, 1)!;
    surfaceTile.fertility = 0.35;
    const undergroundGrassAgent = makeAgent({ pos: { x: 1, y: 1 }, layer: "underground", homeLayer: "underground", types: ["grass"] });

    tickAgentNeeds(undergroundGrassAgent, world);

    expect(surfaceTile.fertility).toBe(0.35);
  });

  it("works with no world at all (bare-fixture caller) — same graceful-degradation shape as the rest of tickAgentNeeds", () => {
    const grassAgent = makeAgent({ types: ["grass"] });
    expect(() => tickAgentNeeds(grassAgent)).not.toThrow();
  });
});
