import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import { ACTION_THRESHOLD, advancePlayerTurn, tickWorld } from "../src/simulation.js";
import { applyPlayerAction, findPlayer, foodUnderfoot, waterWithinReach } from "../src/player.js";
import type { Agent } from "../src/types.js";

function human(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "human",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
    ...extra,
  };
}

describe("player agent (ROADMAP M0)", () => {
  it("findPlayer returns the controlled agent and nothing else", () => {
    const world = createWorld(8, 8, 1);
    const npc: Agent = { ...human("npc", 1, 1), controlledBy: undefined };
    const me = human("me", 2, 2);
    world.agents.push(npc, me);
    expect(findPlayer(world)?.id).toBe("me");
  });

  it("a move steps to the neighbour; a blocked move is a no-op that still returns false", () => {
    const world = createWorld(8, 8, 1);
    const me = human("me", 3, 3);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "move", dx: 1, dy: 1 })).toBe(true);
    expect(me.pos).toEqual({ x: 4, y: 4 });

    setTile(world, "surface", 5, 5, "wall");
    expect(applyPlayerAction(world, me, { kind: "move", dx: 1, dy: 1 })).toBe(false);
    expect(me.pos).toEqual({ x: 4, y: 4 });
  });

  it("tickWorld does NOT run the behaviour tree for the player — it sits still with nothing queued", () => {
    const world = createWorld(12, 12, 1);
    const me = human("me", 5, 5, { needs: createNeeds({ thirst: 0.1, hunger: 0.1 }) });
    world.agents.push(me);
    for (let i = 0; i < 30; i++) tickWorld(world);
    // A sim-driven agent this thirsty would have gone looking for water.
    expect(me.pos).toEqual({ x: 5, y: 5 });
    expect(me.behavior).toBe("idle");
  });

  it("advancePlayerTurn consumes the action on the tick the player's energy is ready, then stops", () => {
    const world = createWorld(12, 12, 1);
    const me = human("me", 5, 5);
    world.agents.push(me);

    const ticks = advancePlayerTurn(world, { kind: "move", dx: 1, dy: 0 });

    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(50);
    expect(me.pos).toEqual({ x: 6, y: 5 });
    expect(me.queuedAction).toBeUndefined();
    expect(world.tick).toBe(ticks);
  });

  it("the world keeps moving between player turns — a slower human lets more ticks pass per step", () => {
    const fastWorld = createWorld(12, 12, 1);
    const fast = human("fast", 5, 5, { stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 120 } });
    fastWorld.agents.push(fast);
    const slowWorld = createWorld(12, 12, 1);
    const slow = human("slow", 5, 5, { stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 20 } });
    slowWorld.agents.push(slow);

    const fastTicks = advancePlayerTurn(fastWorld, { kind: "wait" });
    const slowTicks = advancePlayerTurn(slowWorld, { kind: "wait" });

    expect(slowTicks).toBeGreaterThan(fastTicks);
  });

  it("needs still decay on the player — it is an ordinary agent to the sim", () => {
    const world = createWorld(12, 12, 1);
    const me = human("me", 5, 5, { needs: createNeeds({ hunger: 1, thirst: 1 }) });
    world.agents.push(me);
    for (let i = 0; i < 10; i++) advancePlayerTurn(world, { kind: "wait" });
    expect(me.needs.hunger).toBeLessThan(1);
    expect(me.needs.thirst).toBeLessThan(1);
  });

  it("a dead player never spins the gate", () => {
    const world = createWorld(8, 8, 1);
    const me = human("me", 2, 2, { alive: false });
    world.agents.push(me);
    expect(advancePlayerTurn(world, { kind: "wait" })).toBe(0);
  });
});

describe("eat and drink (ROADMAP M3)", () => {
  it("eating on a food tile restores hunger, depletes the patch, and logs a consumed event", () => {
    const world = createWorld(8, 8, 1);
    setTile(world, "surface", 3, 3, "food");
    const tile = tileAt(world, "surface", 3, 3)!;
    tile.stock = 1;
    const me = human("me", 3, 3, { needs: createNeeds({ hunger: 0.2 }) });
    world.agents.push(me);
    const log = new EventLog();
    const ticks = advancePlayerTurn(world, { kind: "eat" }, log);
    expect(ticks).toBeGreaterThan(0);
    expect(me.needs.hunger).toBeGreaterThan(0.2);
    expect(tile.stock).toBeLessThan(1);
    expect(me.lastActionOutcome).toMatchObject({ action: { kind: "eat" }, ok: true });
    expect(log.events.some((e) => e.kind === "consumed" && e.agentId === "me" && e.need === "hunger")).toBe(true);
  });

  it("eating on bare floor does nothing, still costs the turn, and says so", () => {
    const world = createWorld(8, 8, 1);
    const me = human("me", 3, 3, { needs: createNeeds({ hunger: 0.2 }) });
    world.agents.push(me);
    const hungerBefore = me.needs.hunger;
    const ticks = advancePlayerTurn(world, { kind: "eat" });
    expect(ticks).toBeGreaterThan(0);
    expect(me.needs.hunger).toBeLessThanOrEqual(hungerBefore);
    expect(me.lastActionOutcome).toMatchObject({ action: { kind: "eat" }, ok: false });
  });

  it("an eaten-out patch (stock 0) is not food", () => {
    const world = createWorld(8, 8, 1);
    setTile(world, "surface", 3, 3, "food");
    tileAt(world, "surface", 3, 3)!.stock = 0;
    const me = human("me", 3, 3);
    world.agents.push(me);
    expect(foodUnderfoot(world, me)).toBe(false);
    expect(applyPlayerAction(world, me, { kind: "eat" })).toBe(false);
  });

  it("drinking works beside water, not only on it", () => {
    const world = createWorld(8, 8, 1);
    setTile(world, "surface", 4, 4, "water");
    const me = human("me", 3, 3, { needs: createNeeds({ thirst: 0.2 }) });
    world.agents.push(me);
    expect(waterWithinReach(world, me)).toBe(true);
    const log = new EventLog();
    advancePlayerTurn(world, { kind: "drink" }, log);
    expect(me.needs.thirst).toBeGreaterThan(0.2);
    expect(me.lastActionOutcome).toMatchObject({ action: { kind: "drink" }, ok: true });
    expect(log.events.some((e) => e.kind === "consumed" && e.agentId === "me" && e.need === "thirst")).toBe(true);
  });

  it("drinking with no water within reach fails and costs the turn", () => {
    const world = createWorld(8, 8, 1);
    setTile(world, "surface", 6, 6, "water"); // two tiles off — not adjacent
    const me = human("me", 3, 3, { needs: createNeeds({ thirst: 0.2 }) });
    world.agents.push(me);
    expect(waterWithinReach(world, me)).toBe(false);
    const ticks = advancePlayerTurn(world, { kind: "drink" });
    expect(ticks).toBeGreaterThan(0);
    expect(me.lastActionOutcome).toMatchObject({ action: { kind: "drink" }, ok: false });
  });
});

describe("you can starve (ROADMAP M3)", () => {
  it("a player who only waits dies of hunger, with a starved event naming them, and the gate stops", () => {
    const world = createWorld(8, 8, 1);
    const me = human("me", 3, 3, { needs: createNeeds({ hunger: 0.05, thirst: 1 }) });
    world.agents.push(me);
    const log = new EventLog();
    let turns = 0;
    let ticksTotal = 0;
    while (findPlayer(world) && turns < 5000) {
      ticksTotal += advancePlayerTurn(world, { kind: "wait" }, log);
      turns++;
    }
    expect(findPlayer(world)).toBeUndefined();
    expect(me.alive).toBe(false);
    const death = log.events.find((e) => e.kind === "starved" && e.agentId === "me");
    expect(death).toBeDefined();
    expect(death!.kind === "starved" && death!.cause).toBe("hunger");
    // The gate is closed for good.
    expect(advancePlayerTurn(world, { kind: "wait" }, log)).toBe(0);
    // Measured, so the roadmap can say how long you have (see ROADMAP M3 STATUS).
    console.log(`starved from hunger 0.05 after ${turns} turns / ${ticksTotal} ticks`);
  });

  it("from full, waiting the whole way is real rest — dying takes ~7x longer than standing needs-decay alone", () => {
    // "Wait should recover [energy]" (direct ask): a player who only ever
    // queues `wait` is asleep the entire run (player.ts's "wait" case), so
    // hunger/thirst decay at needs.ts's SLEEP_NEEDS_DECAY_MULTIPLIER (0.15x)
    // the whole time instead of the bare rate. This test used to bound
    // ticksTotal under 5000 — that was the number for waiting as a pure
    // no-op; asleep waiting is a deliberately more forgiving scenario, and
    // 10431 is the real, deterministic result now, not noise.
    const world = createWorld(8, 8, 1);
    const me = human("me", 3, 3);
    world.agents.push(me);
    const log = new EventLog();
    let ticksTotal = 0;
    while (findPlayer(world) && ticksTotal < 20000) ticksTotal += advancePlayerTurn(world, { kind: "wait" }, log);
    expect(findPlayer(world)).toBeUndefined();
    const death = log.events.find((e) => e.kind === "starved" && e.agentId === "me")!;
    expect(death).toBeDefined();
    expect(ticksTotal).toBeGreaterThan(8000);
    expect(ticksTotal).toBeLessThan(13000);
    console.log(`from full: died of ${death.kind === "starved" ? death.cause : "?"} at tick ${world.tick}`);
  });
});

// Keep the threshold import honest — the gate's whole premise is that it exists.
void ACTION_THRESHOLD;
