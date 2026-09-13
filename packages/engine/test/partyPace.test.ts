import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { tickWorld, actionSpeedOf, partyPaceBonusOf, accumulatePartyStepEnergy, ACTION_THRESHOLD, PARTY_PACE_FRACTION } from "../src/simulation.js";
import { applyPartyCatchUpStep, FOLLOW_KEEP_DISTANCE } from "../src/needs.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct ask: *"Can you normalize the movement speed of the entire party? As
 * in bring slower Pokémon up to your party speed? Using moves, gathering,
 * eating etc. For them can still be slow, and their movement should be kinda
 * still reflective of overall speed but waiting for them is quite painful."*
 *
 * The split that ask describes is the thing under test: a bonded follower's
 * MOVEMENT is floored at its leader's action rate, on a second accumulator
 * (`Agent.partyStepEnergy`) that can only ever buy a step. Its own
 * `actionEnergy` — what pays for attacks, gathering and meals — is untouched.
 */

function mk(id: string, x: number, y: number, speed: number, extra: Partial<Agent> = {}): Agent {
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
    stats: { maxHp: 60, attack: 25, defense: 10, spAttack: 10, spDefense: 10, speed },
    moves: [
      // `cooldownTicks` is mandatory in practice: `pickBestMove` scores
      // `1/(1+w*cd)`, and an undefined cd makes that NaN so the move is never
      // chosen. A fixture has bitten this project before.
      { id: "tackle", name: "Tackle", type: "normal", category: "physical", power: 40, accuracy: 100, pp: 20, cooldownTicks: 2, shape: { kind: "point" }, range: { min: 1, max: 1 } },
    ],
    ...extra,
  } as unknown as Agent;
}

/** Open floor, a player, and a follower `gap` tiles west of them. */
function party(leaderSpeed: number, followerSpeed: number, gap: number): { world: World; me: Agent; ally: Agent } {
  const world = createWorld(40, 20, 3);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) setTile(world, "surface", x, y, "floor");
  const me = mk("player", 20, 10, leaderSpeed, { controlledBy: "player" });
  const ally = mk("ally", 20 - gap, 10, followerSpeed, { followingId: "player" });
  world.agents.push(me, ally);
  return { world, me, ally };
}

describe("partyPaceBonusOf — who gets a movement floor, and how much", () => {
  it("tops a slow follower's movement up to its leader's rate, no further", () => {
    const { world, me, ally } = party(30, 10, 5);
    const bonus = partyPaceBonusOf(world, ally, 0);
    expect(bonus).toBeCloseTo(actionSpeedOf(world, me, 0) * PARTY_PACE_FRACTION - actionSpeedOf(world, ally, 0), 5);
    expect(actionSpeedOf(world, ally, 0) + bonus).toBeCloseTo(actionSpeedOf(world, me, 0) * PARTY_PACE_FRACTION, 5);
  });

  it("gives a follower already faster than its leader nothing — 'still reflective of overall speed'", () => {
    const { world, ally } = party(10, 30, 5);
    expect(partyPaceBonusOf(world, ally, 0)).toBe(0);
  });

  it("is zero for anything that is not a player's follower", () => {
    const { world, ally } = party(30, 10, 5);

    const wild = mk("wild", 5, 5, 10);
    world.agents.push(wild);
    expect(partyPaceBonusOf(world, wild, 0)).toBe(0); // no leader at all

    ally.followingId = "ally"; // following another creature, not the player
    expect(partyPaceBonusOf(world, ally, 0)).toBe(0);

    ally.followingId = "player";
    ally.layer = "underground"; // a level away
    expect(partyPaceBonusOf(world, ally, 0)).toBe(0);
  });

  it("tracks the pace the leader is ACTUALLY setting, not a nominal one", () => {
    const { world, me, ally } = party(30, 10, 5);
    const full = partyPaceBonusOf(world, ally, 0);
    me.terrainSpeedFactor = 0.5; // the player bogged down
    const bogged = partyPaceBonusOf(world, ally, 0);
    expect(bogged).toBeLessThan(full);
  });
});

describe("applyPartyCatchUpStep — a step, and only a step", () => {
  it("closes on the leader when past the keep-distance", () => {
    const { world, me, ally } = party(30, 10, 6);
    const before = { ...ally.pos };
    expect(applyPartyCatchUpStep(world, ally)).toBe(true);
    const moved = Math.abs(ally.pos.x - before.x) + Math.abs(ally.pos.y - before.y);
    expect(moved).toBeGreaterThan(0);
    expect(Math.max(Math.abs(ally.pos.x - me.pos.x), Math.abs(ally.pos.y - me.pos.y))).toBeLessThan(6);
  });

  it("spends nothing once at heel", () => {
    const { world, ally } = party(30, 10, FOLLOW_KEEP_DISTANCE);
    const before = { ...ally.pos };
    expect(applyPartyCatchUpStep(world, ally)).toBe(false);
    expect(ally.pos).toEqual(before);
  });

  it("never lands a hit — the bonus clock cannot buy an attack", () => {
    const { world, ally } = party(30, 10, 6);
    const foe = mk("foe", ally.pos.x + 1, ally.pos.y, 10, { species: "machop" });
    world.agents.push(foe);
    ally.commandedAction = { moveId: "tackle", target: { ...foe.pos }, targetAgentId: foe.id };
    const hp0 = foe.hp;
    // Adjacent, so the order is already in range: the step declines and the
    // swing is left for the follower's own action clock to pay for.
    expect(applyPartyCatchUpStep(world, ally)).toBe(false);
    expect(foe.hp).toBe(hp0);
  });

  it("marches a standing order toward its target when out of range", () => {
    const { world, ally } = party(30, 10, 0);
    const foe = mk("foe", ally.pos.x + 8, ally.pos.y, 10, { species: "machop" });
    world.agents.push(foe);
    ally.commandedAction = { moveId: "tackle", target: { ...foe.pos }, targetAgentId: foe.id };
    const before = { ...ally.pos };
    expect(applyPartyCatchUpStep(world, ally)).toBe(true);
    expect(ally.pos.x).toBeGreaterThan(before.x);
  });

  it("stands down for a hungry follower, so a stalled order still READS as stalled", () => {
    const { world, ally } = party(30, 10, 6);
    ally.needs.hunger = 0.1;
    const before = { ...ally.pos };
    expect(applyPartyCatchUpStep(world, ally)).toBe(false);
    expect(ally.pos).toEqual(before);
  });

  it("stands down while asleep or fainted", () => {
    for (const flag of ["asleep", "fainted"] as const) {
      const { world, ally } = party(30, 10, 6);
      (ally as unknown as Record<string, unknown>)[flag] = true;
      expect(applyPartyCatchUpStep(world, ally)).toBe(false);
    }
  });
});

describe("accumulatePartyStepEnergy", () => {
  it("banks below the threshold and spends exactly one step's worth above it", () => {
    const agent = mk("a", 0, 0, 10);
    expect(accumulatePartyStepEnergy(agent, ACTION_THRESHOLD - 1)).toBe(false);
    expect(agent.partyStepEnergy).toBe(ACTION_THRESHOLD - 1);
    expect(accumulatePartyStepEnergy(agent, 2)).toBe(true);
    expect(agent.partyStepEnergy).toBe(1);
  });

  it("cannot bank a double step", () => {
    const agent = mk("a", 0, 0, 10);
    expect(accumulatePartyStepEnergy(agent, ACTION_THRESHOLD * 5)).toBe(true);
    expect(agent.partyStepEnergy).toBe(ACTION_THRESHOLD);
  });
});

describe("end to end through tickWorld", () => {
  /** Walk the player east one tile every `everyNTicks`, and report how far the follower trails. */
  function walk(followerSpeed: number, ticks: number): { maxGap: number; endGap: number; allyActions: number } {
    const { world, me, ally } = party(30, followerSpeed, 0);
    let maxGap = 0;
    let allyActions = 0;
    let lastActionEnergy = ally.actionEnergy ?? 0;
    for (let t = 0; t < ticks; t++) {
      me.queuedAction = { kind: "move", dx: 1, dy: 0 };
      tickWorld(world);
      // A drop in actionEnergy means the threshold was crossed and spent —
      // the follower's OWN clock firing, as distinct from a catch-up step.
      if ((ally.actionEnergy ?? 0) < lastActionEnergy) allyActions++;
      lastActionEnergy = ally.actionEnergy ?? 0;
      maxGap = Math.max(maxGap, Math.max(Math.abs(ally.pos.x - me.pos.x), Math.abs(ally.pos.y - me.pos.y)));
    }
    return { maxGap, endGap: Math.max(Math.abs(ally.pos.x - me.pos.x), Math.abs(ally.pos.y - me.pos.y)), allyActions };
  }

  it("a much slower follower still keeps up with a sprinting leader", () => {
    const slow = walk(8, 120);
    // CONTROL: a follower at the leader's own speed is the best case there is.
    // The slow one has to land in the same neighbourhood, not merely improve.
    const matched = walk(30, 120);
    expect(slow.maxGap).toBeLessThanOrEqual(matched.maxGap + 1);
    expect(slow.endGap).toBeLessThanOrEqual(FOLLOW_KEEP_DISTANCE + 1);
  });

  it("...without its own action clock speeding up — that is the half the ask left slow", () => {
    const slow = walk(8, 120);
    const matched = walk(30, 120);
    // Roughly speed-proportional: 8 vs 30 through the same compression curve.
    // The point is only that it is FAR fewer, not a specific ratio.
    expect(slow.allyActions).toBeLessThan(matched.allyActions * 0.75);
  });
});
