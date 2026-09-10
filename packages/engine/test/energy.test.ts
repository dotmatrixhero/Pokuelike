import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { LOW_ENERGY_SPEED_PENALTY, LOW_ENERGY_THRESHOLD, actionSpeedOf, advancePlayerTurn, lowEnergySpeedMultiplier } from "../src/simulation.js";
import type { Agent } from "../src/types.js";

function human(energy: number): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ energy, hunger: 1, thirst: 1 }),
    behavior: "idle",
    controlledBy: "player",
    stats: { hp: 20, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
  };
}

describe("exhaustion slows everyone (ruling: 20% slower at 0 energy, only under 20%)", () => {
  it("no penalty at or above the threshold; 20% at zero; linear between", () => {
    expect(lowEnergySpeedMultiplier(human(1))).toBe(1);
    expect(lowEnergySpeedMultiplier(human(LOW_ENERGY_THRESHOLD))).toBe(1);
    expect(lowEnergySpeedMultiplier(human(0))).toBeCloseTo(1 - LOW_ENERGY_SPEED_PENALTY);
    expect(lowEnergySpeedMultiplier(human(LOW_ENERGY_THRESHOLD / 2))).toBeCloseTo(1 - LOW_ENERGY_SPEED_PENALTY / 2);
    expect(LOW_ENERGY_SPEED_PENALTY).toBe(0.2);
    expect(LOW_ENERGY_THRESHOLD).toBe(0.2);
  });

  it("a zero-energy human's action speed is lower, so more world ticks pass per key", () => {
    const rested = createWorld(12, 12, 1);
    const a = human(1);
    rested.agents.push(a);
    const tired = createWorld(12, 12, 1);
    const b = human(0);
    tired.agents.push(b);
    expect(actionSpeedOf(tired, b, 0)).toBeLessThan(actionSpeedOf(rested, a, 0));
    let restedTicks = 0;
    let tiredTicks = 0;
    for (let i = 0; i < 20; i++) {
      restedTicks += advancePlayerTurn(rested, { kind: "wait" });
      tiredTicks += advancePlayerTurn(tired, { kind: "wait" });
      // Keep the needs where the test put them; the world's own decay is not under test.
      a.needs.energy = 1;
      b.needs.energy = 0;
    }
    expect(tiredTicks).toBeGreaterThan(restedTicks);
    console.log(`20 waits: rested ${restedTicks} ticks, exhausted ${tiredTicks} ticks`);
  });
});
