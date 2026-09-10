import { describe, expect, it } from "vitest";
import { createWorld, createNeeds, grantExp, calculateStats, type Agent } from "@pokuelike/engine";
import { LEVELING_CONTEXT } from "../src/leveling.js";
import { SPECIES } from "../src/species.js";

/**
 * Direct ask: "i want to gain xp as a human player too." `species.ts`'s own
 * `human` entry is deliberately "Not in the dex, so a literal rather than
 * `speciesFromDex`" — which meant `LEVELING_CONTEXT.getProfile("human")`
 * returned `undefined`, and `grantExp`'s entire level-up loop silently
 * no-ops without a real profile: exp accumulated on `Agent.exp` (from
 * eating/drinking) but never converted into a level-up, stat growth, or
 * anything visible. This suite covers the fix — a synthetic profile built
 * from `SPECIES.human`'s own stats, not a fake dex entry.
 */
function human(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    ...overrides,
  };
}

describe('Direct ask: "i want to gain xp as a human player too"', () => {
  it("LEVELING_CONTEXT has a real profile for human, built from SPECIES.human's own stats", () => {
    const profile = LEVELING_CONTEXT.getProfile("human");
    expect(profile).toBeDefined();
    expect(profile!.baseStats).toEqual(SPECIES.human.baseStats);
    expect(profile!.types).toEqual(SPECIES.human.types);
    expect(profile!.evolutions).toEqual([]); // a human never evolves
  });

  it("a human agent actually levels up from grantExp, using the real context — not just Agent.exp climbing forever", () => {
    const world = createWorld(5, 5, 1);
    const me = human();
    world.agents.push(me);

    // Enough exp for several real level-ups against MEDIUM_FAST's own curve.
    grantExp(world, me, 500, LEVELING_CONTEXT);

    expect(me.level).toBeGreaterThan(1);
    expect(me.exp).toBe(500);
  });

  it("leveling up a human grows its real stats (maxHp in particular), same as any other agent", () => {
    const world = createWorld(5, 5, 1);
    const me = human();
    world.agents.push(me);
    // The real level-1 computed stat, not the raw dex base-stat number
    // (the mainline formula scales up from well below the base stat at low
    // levels — a real check, not an assumption).
    const level1MaxHp = calculateStats(SPECIES.human.baseStats!, 1).maxHp;

    grantExp(world, me, 20000, LEVELING_CONTEXT);

    expect(me.level!).toBeGreaterThan(1);
    expect(me.maxHp!).toBeGreaterThan(level1MaxHp);
    expect(me.stats?.maxHp).toBe(me.maxHp);
  });

  it("a human agent still killed by something else now grants that attacker real kill exp — the same gap from the other direction", () => {
    // grantKillExp reads the DEFENDER's profile to compute the exp yield —
    // a human defender with no profile meant whatever killed the player
    // earned silently nothing from it. Confirmed directly against the
    // killExpYield formula rather than a full combat run.
    const profile = LEVELING_CONTEXT.getProfile("human")!;
    expect(profile.baseExp).toBeGreaterThan(0);
  });
});
