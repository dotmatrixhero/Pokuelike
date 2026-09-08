import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import {
  FIRE_BURN_TICKS,
  FIRE_DAMAGE_FRACTION_PER_TICK,
  FLAMMABLE_TERRAIN,
  applyFireDamage,
  igniteTile,
  tickFires,
} from "../src/fire.js";
import { REGEN_COMBAT_SUPPRESSION_TICKS, tickStatusEffects } from "../src/status.js";
import type { Agent, World } from "../src/types.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    species: "charmander",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    hp: 50,
    maxHp: 50,
    ...overrides,
  };
}

/** A world with no weather cells, so nothing is being rained on unless a test says so. */
function fireWorld(w = 5, h = 5): World {
  const world = createWorld(w, h);
  world.weatherCells = [];
  return world;
}

describe("igniteTile", () => {
  it("lights a flammable tile and gives it a full fuel load", () => {
    const world = fireWorld();
    setTile(world, "surface", 2, 2, "bush");
    expect(igniteTile(world, "surface", 2, 2)).toBe(true);
    const tile = tileAt(world, "surface", 2, 2)!;
    expect(tile.terrain).toBe("fire");
    expect(tile.burnTicksRemaining).toBe(FIRE_BURN_TICKS);
  });

  it("refuses to light bare ground — fire needs fuel, which is what bounds a burn", () => {
    const world = fireWorld();
    setTile(world, "surface", 2, 2, "floor");
    expect(igniteTile(world, "surface", 2, 2)).toBe(false);
    expect(tileAt(world, "surface", 2, 2)!.terrain).toBe("floor");
  });

  it("refreshes an already-burning tile back to full rather than no-oping", () => {
    const world = fireWorld();
    setTile(world, "surface", 2, 2, "bush");
    igniteTile(world, "surface", 2, 2);
    tileAt(world, "surface", 2, 2)!.burnTicksRemaining = 2;
    igniteTile(world, "surface", 2, 2);
    expect(tileAt(world, "surface", 2, 2)!.burnTicksRemaining).toBe(FIRE_BURN_TICKS);
  });

  it("logs the terrain change with a fire cause", () => {
    const world = fireWorld();
    const log = new EventLog();
    setTile(world, "surface", 1, 1, "flora");
    igniteTile(world, "surface", 1, 1, log);
    const event = log.events.find((e) => e.kind === "terrainChanged");
    expect(event).toMatchObject({ from: "flora", to: "fire", cause: "fire" });
  });

  it("every terrain in FLAMMABLE_TERRAIN really does catch", () => {
    for (const terrain of FLAMMABLE_TERRAIN) {
      const world = fireWorld();
      setTile(world, "surface", 2, 2, terrain);
      expect(igniteTile(world, "surface", 2, 2), `${terrain} should catch`).toBe(true);
    }
  });
});

describe("tickFires", () => {
  it("burns down and leaves scorched floor — the 'burns down flora' end state", () => {
    const world = fireWorld();
    setTile(world, "surface", 2, 2, "flora");
    igniteTile(world, "surface", 2, 2);
    for (let i = 0; i < FIRE_BURN_TICKS; i++) tickFires(world, undefined, () => 1);
    const tile = tileAt(world, "surface", 2, 2)!;
    expect(tile.terrain).toBe("floor");
    expect(tile.burnTicksRemaining).toBeUndefined();
  });

  it("spreads into adjacent fuel when the roll succeeds", () => {
    const world = fireWorld();
    setTile(world, "surface", 2, 2, "bush");
    setTile(world, "surface", 3, 2, "bush");
    igniteTile(world, "surface", 2, 2);
    tickFires(world, undefined, () => 0); // always-spread rng
    expect(tileAt(world, "surface", 3, 2)!.terrain).toBe("fire");
  });

  it("does not spread onto bare floor even on a guaranteed roll", () => {
    const world = fireWorld();
    setTile(world, "surface", 2, 2, "bush");
    setTile(world, "surface", 3, 2, "floor");
    igniteTile(world, "surface", 2, 2);
    tickFires(world, undefined, () => 0);
    expect(tileAt(world, "surface", 3, 2)!.terrain).toBe("floor");
  });

  it("cannot chain across a whole row of fuel in a single tick", () => {
    // The classic cellular-automaton bug: a tile lit during this pass must
    // not immediately light its own neighbor in the same pass.
    const world = fireWorld(6, 1);
    for (let x = 0; x < 6; x++) setTile(world, "surface", x, 0, "bush");
    igniteTile(world, "surface", 0, 0);
    tickFires(world, undefined, () => 0);
    expect(tileAt(world, "surface", 1, 0)!.terrain).toBe("fire");
    expect(tileAt(world, "surface", 2, 0)!.terrain).toBe("bush");
  });

  it("rain burns a fire out several times faster and stops it spreading", () => {
    const world = fireWorld();
    world.weatherCells = [{ type: "rain", center: { x: 2, y: 2 }, radius: 5, ticksRemaining: 100 } as never];
    setTile(world, "surface", 2, 2, "bush");
    setTile(world, "surface", 3, 2, "bush");
    igniteTile(world, "surface", 2, 2);
    tickFires(world, undefined, () => 0); // rng that would otherwise always spread
    expect(tileAt(world, "surface", 3, 2)!.terrain).toBe("bush");
    expect(tileAt(world, "surface", 2, 2)!.burnTicksRemaining).toBeLessThan(FIRE_BURN_TICKS - 1);
  });
});

describe("applyFireDamage", () => {
  it("damages an agent standing in fire", () => {
    const world = fireWorld();
    const agent = makeAgent({ pos: { x: 2, y: 2 } });
    world.agents.push(agent);
    setTile(world, "surface", 2, 2, "bush");
    igniteTile(world, "surface", 2, 2);
    applyFireDamage(world, undefined, () => 1);
    expect(agent.hp).toBeCloseTo(50 - 50 * FIRE_DAMAGE_FRACTION_PER_TICK);
  });

  it("leaves an agent on an adjacent, unburnt tile alone", () => {
    const world = fireWorld();
    const agent = makeAgent({ pos: { x: 3, y: 2 } });
    world.agents.push(agent);
    setTile(world, "surface", 2, 2, "bush");
    igniteTile(world, "surface", 2, 2);
    applyFireDamage(world, undefined, () => 1);
    expect(agent.hp).toBe(50);
  });

  it("logs a `burned` death, not a `killed` — a fire is not a predator", () => {
    const world = fireWorld();
    const log = new EventLog();
    const agent = makeAgent({ pos: { x: 2, y: 2 }, hp: 1 });
    world.agents.push(agent);
    setTile(world, "surface", 2, 2, "bush");
    igniteTile(world, "surface", 2, 2);
    applyFireDamage(world, log, () => 1);
    expect(agent.alive).toBe(false);
    expect(log.events.some((e) => e.kind === "burned")).toBe(true);
    expect(log.events.some((e) => e.kind === "killed")).toBe(false);
  });

  it("suppresses the regen passive so a high-regen build can't just stand in it", () => {
    const world = fireWorld();
    const agent = makeAgent({ pos: { x: 2, y: 2 }, hp: 20, passives: { regen: 0.5 } });
    world.agents.push(agent);
    setTile(world, "surface", 2, 2, "bush");
    igniteTile(world, "surface", 2, 2);
    applyFireDamage(world, undefined, () => 1);
    const afterBurn = agent.hp!;
    tickStatusEffects(agent, world);
    expect(agent.hp).toBe(afterBurn); // regen did NOT fire
  });

  it("lets regen resume once the agent is clear of the fire", () => {
    const world = fireWorld();
    const agent = makeAgent({ pos: { x: 2, y: 2 }, hp: 20, passives: { regen: 0.1 } });
    world.agents.push(agent);
    setTile(world, "surface", 2, 2, "bush");
    igniteTile(world, "surface", 2, 2);
    applyFireDamage(world, undefined, () => 1);
    agent.pos = { x: 4, y: 4 }; // walked out
    const hpOnExit = agent.hp!;
    for (let i = 0; i < REGEN_COMBAT_SUPPRESSION_TICKS - 1; i++) tickStatusEffects(agent, world);
    expect(agent.hp!, "still suppressed while the timer runs").toBe(hpOnExit);
    // The counter is decremented before regen is applied in the same tick,
    // so the tick that zeroes it is also the first one that heals.
    tickStatusEffects(agent, world);
    expect(agent.hp!, "regen resumes once clear").toBeGreaterThan(hpOnExit);
  });
});
