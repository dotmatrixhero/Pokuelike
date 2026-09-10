import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { applyConfusedStumble, createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { CONFUSION_STUMBLE_CHANCE, CONFUSION_TICKS_MAX, isConfused, maybeInflictStatus } from "../src/status.js";
import { EventLog } from "../src/events.js";
import type { Agent, World } from "../src/types.js";

/**
 * Confusion. Direct: "Confusion should make you move in a random direction
 * with a 50% chance while you have the status."
 *
 * The thing that makes these tests non-vacuous is the CONTROL in each: an
 * identical agent without the status, or with an rng that never rolls under
 * the stumble chance. A confused agent that happened to walk somewhere for
 * its own reasons would otherwise look exactly like a stumble.
 */
function subject(world: World, overrides: Partial<Agent> = {}): Agent {
  const agent: Agent = {
    id: "subject",
    species: "bulbasaur",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    level: 10,
    maxHp: 40,
    hp: 40,
    ...overrides,
  };
  world.agents.push(agent);
  return agent;
}

/** Fraction of actions that ended somewhere new, over many ticks. */
function stumbleRate(confused: boolean, seed: number): number {
  const world = createWorld(21, 21, seed);
  const agent = subject(world);
  if (confused) agent.status = { kind: "confusion", ticksRemaining: 100000 };
  let moved = 0;
  const samples = 400;
  for (let t = 0; t < samples; t++) {
    const before = { x: agent.pos.x, y: agent.pos.y };
    tickWorld(world, undefined, {});
    if (agent.pos.x !== before.x || agent.pos.y !== before.y) moved++;
  }
  return moved / samples;
}

describe("confusion", () => {
  it("a confused agent changes position far more often than an identical unconfused one (control)", () => {
    const confusedRate = stumbleRate(true, 4242);
    const controlRate = stumbleRate(false, 4242);
    expect(confusedRate).toBeGreaterThan(controlRate);
    // Not asserting an exact 50%: the agent also gets a normal action on the
    // other half of the rolls, and an idle agent sometimes wanders on its
    // own. The claim is that the stumble is a large, real effect.
    expect(confusedRate).toBeGreaterThan(0.25);
  });

  // The three tests below drive `applyConfusedStumble` DIRECTLY rather than
  // through `tickWorld`. A first pass asserted on the agent's position after
  // ticking, which cannot tell a stumble from the ordinary behaviour tree
  // walking the same agent somewhere for its own reasons — with the stumble
  // roll disabled entirely the agent still strolled from (5,5) to (20,20).
  // The rate test above is the integration-level claim; these are the
  // mechanical ones.

  it("moves the agent exactly one orthogonal tile, and only to a legal one", () => {
    const world = createWorld(21, 21, 99);
    const agent = subject(world);
    for (let i = 0; i < 100; i++) {
      const before = { ...agent.pos };
      const stumbled = applyConfusedStumble(world, agent, () => i / 100);
      expect(stumbled).toBe(true);
      const dx = Math.abs(agent.pos.x - before.x);
      const dy = Math.abs(agent.pos.y - before.y);
      expect(dx + dy).toBe(1); // orthogonal, exactly one tile
      expect(tileAt(world, "surface", agent.pos.x, agent.pos.y)!.walkable).toBe(true);
    }
  });

  it("never steps into a wall — with three sides blocked it always takes the one legal neighbour", () => {
    const world = createWorld(21, 21, 99);
    for (const [x, y] of [[4, 5], [6, 5], [5, 4]]) setTile(world, "surface", x, y, "wall");
    const agent = subject(world);
    // The control: those three ARE the neighbours a stumble would otherwise
    // reach, so if walls were ignored this would land on one of them.
    for (let i = 0; i < 40; i++) {
      agent.pos = { x: 5, y: 5 };
      expect(applyConfusedStumble(world, agent, () => i / 40)).toBe(true);
      expect(agent.pos).toEqual({ x: 5, y: 6 });
    }
  });

  it("fully boxed in it returns false rather than eating the action — not a second, hidden paralysis", () => {
    const world = createWorld(21, 21, 5);
    for (const [x, y] of [[4, 5], [6, 5], [5, 4], [5, 6]]) setTile(world, "surface", x, y, "wall");
    const agent = subject(world);
    expect(applyConfusedStumble(world, agent, () => 0.5)).toBe(false);
    expect(agent.pos).toEqual({ x: 5, y: 5 });
  });

  it("wears off on its own clock", () => {
    const world = createWorld(21, 21, 11);
    const agent = subject(world);
    agent.status = { kind: "confusion", ticksRemaining: 3 };
    for (let t = 0; t < 10; t++) tickWorld(world, undefined, {});
    expect(agent.status).toBeUndefined();
  });

  it("is inflictable by a real move and lasts a bounded time", () => {
    const world = createWorld(21, 21, 3);
    const agent = subject(world);
    maybeInflictStatus(agent, "attacker", { statusKind: "confusion", statusChance: 1 }, world, new EventLog(), () => 0.5);
    expect(isConfused(agent)).toBe(true);
    expect(agent.status!.ticksRemaining).toBeGreaterThan(0);
    expect(agent.status!.ticksRemaining).toBeLessThanOrEqual(CONFUSION_TICKS_MAX);
  });

  it("no typing is immune, unlike every other status that has one", () => {
    const world = createWorld(21, 21, 3);
    const psychic = subject(world, { types: ["psychic"] });
    maybeInflictStatus(psychic, "attacker", { statusKind: "confusion", statusChance: 1 }, world, undefined, () => 0.5);
    expect(isConfused(psychic)).toBe(true);
    expect(CONFUSION_STUMBLE_CHANCE).toBe(0.5);
  });
});
