import { describe, expect, it } from "vitest";
import {
  decayNeeds,
  CAMPFIRE_ENERGY_RESTORE_RATE,
  ENERGY_DRAIN_DIVISOR,
  REST_RESTORE_STEP,
  REST_RAMP_MAX_TICKS,
  SLEEP_ENERGY_RESTORE_RATE,
  tickAgentNeeds,
} from "../src/needs.js";
import { createWorld, setTile } from "../src/world.js";
import type { Agent, Needs, World } from "../src/types.js";

/**
 * Direct asks, one message:
 *   "i want waiting to restore a lot more energy - non linear though. like
 *    quadratic, so you have to rest multiple turns in a row to recharge, and
 *    generaly energy drains too quick. should be 1/3 the speed. being near a
 *    campfire should auto restore energy."
 */

function needs(energy: number): Needs {
  return { hunger: 1, thirst: 1, energy, mateDrive: 0 } as Needs;
}

/** Ticks to get from `from` to `to` under a per-tick step, with a hard guard. */
function ticksUntil(n: Needs, done: (n: Needs) => boolean, step: (n: Needs, i: number) => void): number {
  let i = 0;
  while (!done(n) && i < 5000) {
    i++;
    step(n, i);
  }
  return i;
}

describe("energy drains at a third of the old speed", () => {
  it("takes three times as long to run out", () => {
    const n = needs(1);
    const ticks = ticksUntil(n, (x) => x.energy <= 0, (x) => decayNeeds(x, 1, false));
    // The old rate was 0.005/tick — 200 ticks from full to empty.
    expect(ticks).toBe(200 * ENERGY_DRAIN_DIVISOR);
    expect(ticks).toBe(600);
  });
});

describe("resting ramps up — you have to commit to it", () => {
  it("one rest turn is nearly worthless compared to the old flat rate", () => {
    const n = needs(0.5);
    decayNeeds(n, 1, true, 1, 1, 1, false);
    const gained = n.energy - 0.5;
    expect(gained).toBeCloseTo(REST_RESTORE_STEP, 6);
    // A fifth of what a single tick used to give. That asymmetry is the ask.
    expect(gained).toBeLessThan(SLEEP_ENERGY_RESTORE_RATE / 2);
  });

  it("total recovered is quadratic in turns rested", () => {
    // sum of step*1 + step*2 + ... + step*n  ==  step * n(n+1)/2
    for (const n of [4, 9, 16]) {
      const state = needs(0);
      for (let i = 1; i <= n; i++) decayNeeds(state, 1, true, 1, 1, i, false);
      expect(state.energy).toBeCloseTo(REST_RESTORE_STEP * ((n * (n + 1)) / 2), 6);
    }
  });

  it("a committed rest is much faster than the old flat rate", () => {
    let rest = 0;
    const ramped = needs(0);
    const rampedTicks = ticksUntil(ramped, (x) => x.energy >= 1, (x) => decayNeeds(x, 1, true, 1, 1, ++rest, false));
    const flat = needs(0);
    const flatTicks = ticksUntil(flat, (x) => x.energy >= 1, (x) => decayNeeds(x, 1, true));
    expect(rampedTicks).toBe(22);
    expect(flatTicks).toBe(50); // control: a caller that does not track rest is unchanged
    expect(rampedTicks).toBeLessThan(flatTicks / 2);
  });

  it("the ramp is capped, so a very long rest cannot run away", () => {
    const capped = needs(0);
    decayNeeds(capped, 1, true, 1, 1, REST_RAMP_MAX_TICKS + 500, false);
    expect(capped.energy).toBeCloseTo(REST_RESTORE_STEP * REST_RAMP_MAX_TICKS, 6);
  });
});

describe("a campfire restores energy on its own", () => {
  it("holds you steady and then some while awake, where bare ground drains", () => {
    const byFire = needs(0.5);
    const control = needs(0.5);
    for (let i = 0; i < 50; i++) {
      decayNeeds(byFire, 1, false, 1, 1, 0, true);
      decayNeeds(control, 1, false, 1, 1, 0, false);
    }
    expect(byFire.energy).toBeGreaterThan(0.5);
    expect(control.energy).toBeLessThan(0.5);
  });

  it("stacks with resting rather than replacing it", () => {
    const both = needs(0.5);
    const restOnly = needs(0.5);
    decayNeeds(both, 1, true, 1, 1, 3, true);
    decayNeeds(restOnly, 1, true, 1, 1, 3, false);
    expect(both.energy - restOnly.energy).toBeCloseTo(CAMPFIRE_ENERGY_RESTORE_RATE, 6);
  });
});

describe("wired into the real tick", () => {
  function scene(): { world: World; me: Agent } {
    const world = createWorld(12, 12, 4);
    const me = {
      id: "player",
      species: "human",
      pos: { x: 6, y: 6 },
      layer: "surface",
      homeLayer: "surface",
      needs: needs(0.4),
      behavior: "idle",
      controlledBy: "player",
      hp: 20,
      maxHp: 20,
    } as unknown as Agent;
    world.agents.push(me);
    return { world, me };
  }

  it("counts consecutive rest, and an interruption starts the ramp over", () => {
    const { world, me } = scene();
    me.asleep = true;
    for (let i = 0; i < 5; i++) tickAgentNeeds(me, world);
    expect(me.restTicks).toBe(5);

    // Any action wakes you; the next rest begins at 1, not 6. That restart IS
    // the cost of being interrupted.
    me.asleep = false;
    tickAgentNeeds(me, world);
    expect(me.restTicks).toBeUndefined();
    me.asleep = true;
    tickAgentNeeds(me, world);
    expect(me.restTicks).toBe(1);
  });

  it("standing near a real fire tile restores energy through the ordinary tick", () => {
    const { world, me } = scene();
    const before = me.needs.energy;
    setTile(world, "surface", 7, 6, "fire");
    tickAgentNeeds(me, world);
    expect(me.needs.energy).toBeGreaterThan(before);
  });

  it("control: the same tick with no fire drains instead", () => {
    const { world, me } = scene();
    const before = me.needs.energy;
    tickAgentNeeds(me, world);
    expect(me.needs.energy).toBeLessThan(before);
  });
});
