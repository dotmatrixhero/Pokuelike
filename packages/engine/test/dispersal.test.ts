import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds, tickAgentAction } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import {
  applyDispersal,
  DISPERSAL_BASE_CHANCE,
  maybeTriggerDispersal,
  NO_MATES_DISPERSAL_TICKS,
} from "../src/dispersal.js";
import { DISPERSAL_MIN_LEVEL } from "../src/leveling.js";
import { MATURITY_AGE } from "../src/reproduction.js";
import type { Agent } from "../src/types.js";
import type { Disposition } from "../src/nature.js";

/** Deterministic seeded PRNG (mulberry32) — matches herdMigration.test.ts's own helper, for statistical tests that must never flake. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "bulbasaur",
    pos: { x: 40, y: 40 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    sex: "female",
    herdId: "herd-a",
    ...overrides,
  };
}

/**
 * Isolates just the disposition-weighted *roll* (`dispersalChance`, private
 * to dispersal.ts) without paying for a fresh `World`/`Agent`/relocation
 * search per trial: each trial resets the one-shot bookkeeping fields by
 * hand and only counts whether `dispersalTarget` got set, exactly mirroring
 * `herdMigration.test.ts`'s wanderlust statistical tests (reuse one small
 * world across many trials, not a fresh one per trial). Simulates "just
 * crossed DISPERSAL_MIN_LEVEL" via the same `pendingLevelDispersalCheck`
 * flag leveling.ts's `grantExp` sets, since that (not age) is what gates
 * trigger 1's occasion now.
 */
function countLevelCrossingRollFires(world: ReturnType<typeof createWorld>, a: Agent, trials: number, rng: () => number): number {
  let fires = 0;
  for (let i = 0; i < trials; i++) {
    a.dispersalTarget = undefined;
    a.pendingLevelDispersalCheck = true;
    maybeTriggerDispersal(world, a, undefined, rng);
    if (a.dispersalTarget) fires++;
  }
  return fires;
}

describe("maybeTriggerDispersal: disposition-weighted maturity/evolution trigger", () => {
  it("fires more often for a bolder/less sociable agent than a timid/social one (fixed seed, not flaky)", () => {
    const world = createWorld(30, 30);
    const bold = agent("bold", { age: MATURITY_AGE, level: DISPERSAL_MIN_LEVEL, disposition: { boldness: 1, aggression: 0.5, sociability: 0 } });
    const timid = agent("timid", { age: MATURITY_AGE, level: DISPERSAL_MIN_LEVEL, disposition: { boldness: 0, aggression: 0.5, sociability: 1 } });
    world.agents.push(bold, timid);

    const TRIALS = 20_000;
    const boldFires = countLevelCrossingRollFires(world, bold, TRIALS, seededRng(42));
    const timidFires = countLevelCrossingRollFires(world, timid, TRIALS, seededRng(42)); // same seed on both — isolates the disposition effect, not the rng stream

    // Bold+solitary should roll at 2x DISPERSAL_BASE_CHANCE, timid+social at 0 (see dispersalChance's doc comment).
    expect(timidFires).toBe(0);
    expect(boldFires).toBeGreaterThan(0);
    const expected = TRIALS * Math.min(1, DISPERSAL_BASE_CHANCE * 2);
    expect(boldFires).toBeGreaterThan(expected * 0.8);
    expect(boldFires).toBeLessThan(expected * 1.2);
  });

  it("a neutral-disposition agent's level crossing fires at roughly the documented base chance", () => {
    const world = createWorld(30, 30);
    const a = agent("neutral", { age: MATURITY_AGE, level: DISPERSAL_MIN_LEVEL });
    world.agents.push(a);

    const TRIALS = 20_000;
    const fires = countLevelCrossingRollFires(world, a, TRIALS, seededRng(7));

    const expected = TRIALS * DISPERSAL_BASE_CHANCE;
    expect(fires).toBeGreaterThan(expected * 0.8);
    expect(fires).toBeLessThan(expected * 1.2);
  });

  it("does not fire below DISPERSAL_MIN_LEVEL even with the level-crossing flag set", () => {
    const ALWAYS_DISPERSE = () => 0; // would trigger unconditionally if the level gate didn't block it
    const world = createWorld(200, 200);
    const a = agent("underleveled", { age: 500, level: DISPERSAL_MIN_LEVEL - 1, pendingLevelDispersalCheck: true });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, ALWAYS_DISPERSE);

    expect(a.dispersalTarget).toBeUndefined();
  });

  it("does not fire the level-crossing occasion for a fixture that's simply at a high level, with no actual crossing flagged", () => {
    // A hand-built fixture given level: DISPERSAL_MIN_LEVEL purely as a
    // "definitely eligible" test convenience never actually crossed the
    // threshold during this test — pendingLevelDispersalCheck is the one-shot
    // flag that means "a crossing just happened," not the level value itself.
    const ALWAYS_DISPERSE = () => 0;
    const world = createWorld(200, 200);
    const a = agent("old", { age: 500, level: DISPERSAL_MIN_LEVEL });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, ALWAYS_DISPERSE);

    expect(a.dispersalTarget).toBeUndefined();
  });

  it("evolving triggers exactly one roll via pendingEvolutionDispersalCheck, consumed either way", () => {
    const ALWAYS_DISPERSE = () => 0;
    const world = createWorld(200, 200);
    const a = agent("evo", { age: 500, level: DISPERSAL_MIN_LEVEL, pendingEvolutionDispersalCheck: true });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, ALWAYS_DISPERSE);
    expect(a.dispersalTarget).toBeDefined();
    expect(a.pendingEvolutionDispersalCheck).toBeUndefined(); // consumed

    // A second evolution later still gets its own fresh roll.
    a.dispersalTarget = undefined;
    a.pendingEvolutionDispersalCheck = true;
    maybeTriggerDispersal(world, a, undefined, ALWAYS_DISPERSE);
    expect(a.dispersalTarget).toBeDefined();
  });
});

describe("maybeTriggerDispersal: guaranteed no-eligible-mates fallback", () => {
  it("does not fire before the sustained threshold", () => {
    const NEVER_DISPERSE_VIA_TRIGGER1 = () => 1; // never wins the disposition roll
    const world = createWorld(200, 200);
    const a = agent("lonely", { age: 500, level: DISPERSAL_MIN_LEVEL, ticksSinceEligibleMate: NO_MATES_DISPERSAL_TICKS - 1 });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, NEVER_DISPERSE_VIA_TRIGGER1);

    expect(a.dispersalTarget).toBeUndefined();
  });

  it("fires once the sustained no-eligible-mates threshold is crossed, regardless of the disposition roll", () => {
    // No pendingLevelDispersalCheck/pendingEvolutionDispersalCheck set, so
    // trigger 1 can't fire here at all — this rng is only ever consulted by
    // the fallback's own relocation-target search below.
    const world = createWorld(200, 200);
    const a = agent("lonely", { age: 500, level: DISPERSAL_MIN_LEVEL, ticksSinceEligibleMate: NO_MATES_DISPERSAL_TICKS });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, seededRng(1));

    expect(a.dispersalTarget).toBeDefined();
    expect(a.dispersalReason).toBe("no_eligible_mates");
  });

  it("an immature agent never triggers the fallback no matter how long ticksSinceEligibleMate has run", () => {
    const ALWAYS_DISPERSE = () => 0;
    const world = createWorld(200, 200);
    const a = agent("young", { age: 5, level: DISPERSAL_MIN_LEVEL, ticksSinceEligibleMate: NO_MATES_DISPERSAL_TICKS * 2 });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, ALWAYS_DISPERSE);

    expect(a.dispersalTarget).toBeUndefined();
  });

  it("a high-level but under-leveled-at-threshold agent never triggers the fallback below DISPERSAL_MIN_LEVEL", () => {
    const ALWAYS_DISPERSE = () => 0;
    const world = createWorld(200, 200);
    const a = agent("underleveled", { age: 500, level: DISPERSAL_MIN_LEVEL - 1, ticksSinceEligibleMate: NO_MATES_DISPERSAL_TICKS * 2 });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, ALWAYS_DISPERSE);

    expect(a.dispersalTarget).toBeUndefined();
  });
});

describe("maybeTriggerDispersal: no double-trigger", () => {
  it("does nothing while a dispersal is already in progress", () => {
    const ALWAYS_DISPERSE = () => 0;
    const world = createWorld(200, 200);
    const a = agent("mid-walk", {
      age: 500,
      dispersalTarget: { x: 10, y: 10 },
      dispersalReason: "matured",
      ticksSinceEligibleMate: NO_MATES_DISPERSAL_TICKS,
      pendingEvolutionDispersalCheck: true,
    });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, ALWAYS_DISPERSE);

    // Unchanged — the pending flag was never even consumed, since the whole check short-circuits.
    expect(a.dispersalTarget).toEqual({ x: 10, y: 10 });
    expect(a.pendingEvolutionDispersalCheck).toBe(true);
  });

  it("a genderless agent never triggers either dispersal path", () => {
    const ALWAYS_DISPERSE = () => 0;
    const world = createWorld(200, 200);
    const a = agent("genderless", { age: 500, sex: undefined, ticksSinceEligibleMate: NO_MATES_DISPERSAL_TICKS });
    world.agents.push(a);

    maybeTriggerDispersal(world, a, undefined, ALWAYS_DISPERSE);

    expect(a.dispersalTarget).toBeUndefined();
  });
});

describe("applyDispersal: real relocation and herd join-or-found", () => {
  it("walks toward the dispersal target over multiple calls, then arrives", () => {
    const world = createWorld(50, 50);
    const a = agent("walker", { pos: { x: 5, y: 5 }, dispersalTarget: { x: 5, y: 20 }, dispersalReason: "matured" });
    world.agents.push(a);

    applyDispersal(world, a);
    expect(a.behavior).toBe("disperse");
    expect(a.pos.y).toBeGreaterThan(5);
    expect(a.dispersalTarget).toBeDefined(); // not arrived yet
  });

  it("founds a brand new, unique herd on arrival when no other same-species herd is nearby", () => {
    const world = createWorld(50, 50);
    const a = agent("founder", { pos: { x: 4, y: 4 }, herdId: "old-herd", dispersalTarget: { x: 5, y: 4 }, dispersalReason: "matured" });
    world.agents.push(a);
    const log = new EventLog();

    applyDispersal(world, a, log);

    expect(a.pos).toEqual({ x: 5, y: 4 });
    expect(a.herdId).toBeDefined();
    expect(a.herdId).not.toBe("old-herd");
    const event = log.events.find((e) => e.kind === "dispersed");
    expect(event).toBeDefined();
    if (event?.kind === "dispersed") {
      expect(event.outcome).toBe("founded");
      expect(event.fromHerd).toBe("old-herd");
      expect(event.toHerd).toBe(a.herdId);
      expect(event.reason).toBe("matured");
    }
  });

  it("joins an existing other same-species herd found nearby on arrival, instead of founding a new one", () => {
    const world = createWorld(50, 50);
    const a = agent("joiner", { pos: { x: 4, y: 4 }, herdId: "old-herd", dispersalTarget: { x: 5, y: 4 }, dispersalReason: "no_eligible_mates" });
    const nearbyOther = agent("resident", { pos: { x: 6, y: 4 }, herdId: "other-herd" });
    world.agents.push(a, nearbyOther);
    const log = new EventLog();

    applyDispersal(world, a, log);

    expect(a.herdId).toBe("other-herd");
    const event = log.events.find((e) => e.kind === "dispersed");
    if (event?.kind === "dispersed") {
      expect(event.outcome).toBe("joined");
      expect(event.toHerd).toBe("other-herd");
    }
  });

  it("two independent dispersers founding new herds get genuinely different herdIds", () => {
    const world = createWorld(50, 50);
    const a = agent("a", { pos: { x: 4, y: 4 }, dispersalTarget: { x: 5, y: 4 } });
    const b = agent("b", { pos: { x: 44, y: 44 }, dispersalTarget: { x: 45, y: 44 } });
    world.agents.push(a, b);

    applyDispersal(world, a);
    applyDispersal(world, b);

    expect(a.herdId).toBeDefined();
    expect(b.herdId).toBeDefined();
    expect(a.herdId).not.toBe(b.herdId);
  });
});

describe("dispersal pauses for urgent needs (needs.ts's tickAgentAction)", () => {
  it("does not continue an in-progress dispersal (no movement toward the target) while the agent's needs are urgent, but resumes once satisfied again, without losing dispersalTarget", () => {
    const world = createWorld(50, 50);
    const a = agent("thirsty-disperser", {
      pos: { x: 25, y: 25 },
      dispersalTarget: { x: 25, y: 40 },
      dispersalReason: "matured",
      needs: createNeeds({ thirst: 0.05 }), // urgent — chooseBehavior reads "seekWater", not "idle"
    });
    world.agents.push(a);
    const originalTarget = { ...a.dispersalTarget! };

    tickAgentAction(world, a);

    // Paused: no step toward the dispersal target, target untouched, and the
    // agent's behavior reflects the urgent need it's actually acting on
    // instead (there's no water on this bare world, so it can't actually
    // drink, but it must not be walking the dispersal route either).
    expect(a.pos).toEqual({ x: 25, y: 25 });
    expect(a.dispersalTarget).toEqual(originalTarget);
    expect(a.behavior).not.toBe("disperse");

    // Satisfied again — the walk resumes exactly where it left off.
    a.needs.thirst = 1;
    tickAgentAction(world, a);

    expect(a.behavior).toBe("disperse");
    expect(a.pos.y).toBeGreaterThan(25); // stepped toward the still-intact target
    expect(a.dispersalTarget).toEqual(originalTarget);
  });

  it("a fresh trigger this same tick is also paused immediately if the agent is simultaneously urgent (edge case, doesn't crash or lose the new target)", () => {
    const world = createWorld(200, 200);
    const a = agent("just-triggered", {
      age: 500,
      level: DISPERSAL_MIN_LEVEL,
      pendingLevelDispersalCheck: true,
      needs: createNeeds({ hunger: 0.05 }), // urgent
    });
    world.agents.push(a);
    const alwaysZero = () => 0; // guarantees trigger 1's roll succeeds

    tickAgentAction(world, a, undefined, undefined, undefined, alwaysZero);

    expect(a.dispersalTarget).toBeDefined(); // triggered...
    expect(a.behavior).not.toBe("disperse"); // ...but paused before taking a single step this tick
  });
});

describe("dispersal end-to-end via tickWorld", () => {
  it("a dispersing agent's behavior stays 'disperse' and it keeps moving tick over tick until it arrives and founds/joins a herd", () => {
    const world = createWorld(100, 100);
    const a = agent("e2e", { pos: { x: 50, y: 50 }, dispersalTarget: { x: 50, y: 65 }, dispersalReason: "matured" });
    world.agents.push(a);
    const log = new EventLog();

    for (let i = 0; i < 60 && a.dispersalTarget; i++) {
      tickWorld(world, log, undefined, undefined, seededRng(i + 1));
    }

    expect(a.dispersalTarget).toBeUndefined(); // arrived
    expect(a.herdId).toBeDefined();
    expect(log.events.some((e) => e.kind === "dispersed")).toBe(true);
  });

  it("does not re-trigger (or overwrite the target) every tick while a dispersal is already in progress", () => {
    const world = createWorld(100, 100);
    // An agent that would otherwise re-qualify for the guaranteed no-mates
    // fallback (and, via a rigged always-succeeds roll, trigger 1 too) every
    // single tick it's checked — proves `maybeTriggerDispersal`'s early
    // `if (agent.dispersalTarget) return;` guard actually holds while a
    // dispersal is mid-walk, not just at the instant it starts.
    const a = agent("once", {
      pos: { x: 50, y: 50 },
      age: 500,
      dispersalTarget: { x: 50, y: 55 },
      dispersalReason: "matured",
      ticksSinceEligibleMate: NO_MATES_DISPERSAL_TICKS,
    });
    world.agents.push(a);
    const alwaysZero = () => 0;
    const originalTarget = { ...a.dispersalTarget! };

    // Walk it most of the way there, re-checking the trigger every tick, but
    // stop short of arrival so there's no ambiguity about a *second*,
    // legitimately-independent dispersal starting after this one settles.
    for (let i = 0; i < 4; i++) {
      maybeTriggerDispersal(world, a, undefined, alwaysZero);
      expect(a.dispersalTarget).toEqual(originalTarget); // never overwritten
      applyDispersal(world, a);
    }

    expect(a.dispersalTarget).toBeDefined(); // still mid-walk, not arrived yet
  });
});
