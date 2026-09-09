import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds, tickAgentAction } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";
import {
  RAPPORT_BONDING_DELTA,
  RAPPORT_DECAY_PER_TICK,
  RAPPORT_FOOD_DELIVERY_DELTA,
  RAPPORT_HERD_CLASH_DELTA,
  RAPPORT_MAX_EDGES_PER_AGENT,
  RAPPORT_MOB_DEFENSE_DELTA,
  RAPPORT_PRUNE_THRESHOLD,
  RAPPORT_REASON_MEMORY_INTERVAL,
  RAPPORT_RESCUE_DELTA,
  RAPPORT_SOCIALIZE_DELTA,
  adjustRapport,
  decayedRapportScore,
  notableRapportMemories,
  rapportMemories,
  rapportScore,
  strengthenRapportMutual,
} from "../src/rapport.js";
import { applyHerdSupport, DELIVERED_FOOD_HUNGER_RESTORE } from "../src/support.js";
import { applyMateSeeking } from "../src/reproduction.js";
import { applyPredationInstincts } from "../src/predation.js";
import { applyHerdRivalryConflict, HERD_CONFLICT_MIN_BLOCKED_TICKS } from "../src/herdConflict.js";
import { MOURNING_MIN_RAPPORT, recordDeathWitnesses, WITNESS_RADIUS } from "../src/witness.js";
import { dropCarriedAllyForTest } from "../src/support.js";
import { tickStatusEffects } from "../src/status.js";

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "bulbasaur",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...overrides,
  };
}

describe("rapport: core data structure, decay, prune, cap", () => {
  it("absence reads as neutral (0), not a stored zero", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);
    expect(rapportScore(a, "stranger", world.tick)).toBe(0);
    expect(a.rapport).toBeUndefined();
  });

  it("adjustRapport creates a sparse edge only for the touched pair", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 0.1);

    expect(Object.keys(a.rapport ?? {})).toEqual(["b"]);
    expect(rapportScore(a, "b", world.tick)).toBeCloseTo(0.1, 5);
  });

  it("clamps to [-1, 1]", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 5);
    expect(rapportScore(a, "b", world.tick)).toBe(1);

    adjustRapport(world, a, "c", -5);
    expect(rapportScore(a, "c", world.tick)).toBe(-1);
  });

  it("can represent a real grudge (negative) as well as a bond (positive)", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "friend", 0.3);
    adjustRapport(world, a, "rival", -0.3);

    expect(rapportScore(a, "friend", world.tick)).toBeGreaterThan(0);
    expect(rapportScore(a, "rival", world.tick)).toBeLessThan(0);
  });

  it("decays toward 0 over elapsed ticks (decayedRapportScore, pure function of elapsed ticks)", () => {
    const edge = { score: 0.5, lastInteractionTick: 0 };
    const soon = decayedRapportScore(edge, 10);
    const later = decayedRapportScore(edge, 5000);

    expect(soon).toBeLessThan(0.5);
    expect(soon).toBeGreaterThan(later);
    expect(later).toBeGreaterThanOrEqual(0);
    expect(later).toBeLessThan(0.02);
  });

  it("a decayed score under the prune threshold is deleted entirely on read, not left at ~0 forever", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);
    a.rapport = { b: { score: RAPPORT_PRUNE_THRESHOLD * 2, lastInteractionTick: 0 } };

    // Advance far enough that RAPPORT_DECAY_PER_TICK^elapsed drops the score below the prune threshold.
    world.tick = 5000;
    const decayed = decayedRapportScore(a.rapport.b, world.tick);
    expect(Math.abs(decayed)).toBeLessThan(RAPPORT_PRUNE_THRESHOLD);

    const score = rapportScore(a, "b", world.tick);
    expect(score).toBe(0);
    expect(a.rapport.b).toBeUndefined();
  });

  it("adjustRapport also prunes the edge away when a delta brings a decayed score under the threshold", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);
    adjustRapport(world, a, "b", 0.05);
    expect(a.rapport?.b).toBeDefined();

    // A small negative nudge that lands inside the dead zone prunes the edge outright.
    adjustRapport(world, a, "b", -0.045);
    expect(a.rapport?.b).toBeUndefined();
  });

  it("enforces a hard cap on edges per agent, evicting the weakest/stalest first", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    // Fill to the cap with distinguishable, increasing scores/recency.
    for (let i = 0; i < RAPPORT_MAX_EDGES_PER_AGENT; i++) {
      world.tick = i;
      adjustRapport(world, a, `p${i}`, 0.05 + i * 0.01);
    }
    expect(Object.keys(a.rapport ?? {})).toHaveLength(RAPPORT_MAX_EDGES_PER_AGENT);
    // p0 is both the weakest score (0.05) and the stalest (tick 0) — the clear eviction candidate.
    expect(a.rapport?.p0).toBeDefined();

    world.tick = RAPPORT_MAX_EDGES_PER_AGENT;
    adjustRapport(world, a, "new-partner", 0.5);

    expect(Object.keys(a.rapport ?? {})).toHaveLength(RAPPORT_MAX_EDGES_PER_AGENT); // still capped, not grown
    expect(a.rapport?.p0).toBeUndefined(); // evicted
    expect(a.rapport?.["new-partner"]).toBeDefined(); // the new edge made it in
  });

  it("the cap holds even before natural decay/pruning would have cleaned things up (fresh, undecayed edges)", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);
    world.tick = 0;
    for (let i = 0; i < RAPPORT_MAX_EDGES_PER_AGENT + 5; i++) {
      adjustRapport(world, a, `p${i}`, 0.9); // all strong, all fresh — decay/pruning would never touch any of these
    }
    expect(Object.keys(a.rapport ?? {}).length).toBeLessThanOrEqual(RAPPORT_MAX_EDGES_PER_AGENT);
  });

  it("eviction tie-break rng is deterministic given the same seeded rng sequence", () => {
    function run(seed: number): string[] {
      const world = createWorld(5, 5, seed);
      const a = agent("a");
      world.agents.push(a);
      // All identical score+tick, so every insertion beyond the cap is a genuine tie.
      for (let i = 0; i < RAPPORT_MAX_EDGES_PER_AGENT; i++) {
        a.rapport = a.rapport ?? {};
        a.rapport[`p${i}`] = { score: 0.5, lastInteractionTick: 0 };
      }
      adjustRapport(world, a, "extra", 0.5, undefined, world.rng);
      return Object.keys(a.rapport ?? {}).sort();
    }

    expect(run(42)).toEqual(run(42));
  });

  it("strengthenRapportMutual updates both sides", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    const b = agent("b");
    world.agents.push(a, b);

    strengthenRapportMutual(world, a, b, 0.2);

    expect(rapportScore(a, "b", world.tick)).toBeCloseTo(0.2, 5);
    expect(rapportScore(b, "a", world.tick)).toBeCloseTo(0.2, 5);
  });
});

describe("rapport: real triggers create/strengthen edges", () => {
  it("a successful herd food delivery strengthens rapport between carrier and receiver", () => {
    const world = createWorld(6, 6);
    const carrier = agent("carrier", {
      herdId: "herd-a",
      pos: { x: 1, y: 0 },
      deliverTargetId: "receiver",
      inventory: [{ itemKey: "food", weight: 1 }],
    });
    const receiver = agent("receiver", { herdId: "herd-a", pos: { x: 0, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });
    world.agents.push(carrier, receiver);
    const log = new EventLog();

    const acted = applyHerdSupport(world, carrier, log);

    expect(acted).toBe(true);
    expect(log.events.some((e) => e.kind === "foodDelivered")).toBe(true);
    expect(rapportScore(carrier, "receiver", world.tick)).toBeCloseTo(RAPPORT_FOOD_DELIVERY_DELTA, 5);
    expect(rapportScore(receiver, "carrier", world.tick)).toBeCloseTo(RAPPORT_FOOD_DELIVERY_DELTA, 5);
  });

  it("repeated food deliveries add up — a single delivery alone is a small nudge", () => {
    const world = createWorld(6, 6);
    const carrier = agent("carrier", { herdId: "herd-a", pos: { x: 0, y: 0 } });
    const receiver = agent("receiver", { herdId: "herd-a", pos: { x: 0, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });
    world.agents.push(carrier, receiver);

    for (let i = 0; i < 5; i++) {
      carrier.deliverTargetId = "receiver";
      carrier.inventory = [{ itemKey: "food", weight: 1 }];
      receiver.needs.hunger = 0.1;
      applyHerdSupport(world, carrier);
    }

    expect(rapportScore(carrier, "receiver", world.tick)).toBeGreaterThan(RAPPORT_FOOD_DELIVERY_DELTA * 2);
  });

  it("bonding creates a real, meaningfully strong positive rapport edge immediately (not an incremental nudge)", () => {
    const world = createWorld(10, 10);
    const mother = agent("mother", {
      species: "bulbasaur",
      sex: "female",
      age: 500,
      level: 16,
      pos: { x: 2, y: 2 },
      needs: createNeeds({ mateDrive: 0.9 }),
    });
    const father = agent("father", {
      species: "bulbasaur",
      sex: "male",
      age: 500,
      level: 16,
      pos: { x: 3, y: 2 },
      needs: createNeeds({ mateDrive: 0.9 }),
    });
    world.agents.push(mother, father);
    const log = new EventLog();

    applyMateSeeking(world, mother, log);

    expect(log.events.some((e) => e.kind === "bonded")).toBe(true);
    expect(rapportScore(mother, "father", world.tick)).toBeCloseTo(RAPPORT_BONDING_DELTA, 5);
    expect(rapportMemories(mother, "father").map((m) => m.reason)).toEqual(["bonded"]);
    expect(rapportScore(father, "mother", world.tick)).toBeCloseTo(RAPPORT_BONDING_DELTA, 5);
    // Meaningfully bigger than a single ordinary interaction nudge.
    expect(rapportScore(mother, "father", world.tick)).toBeGreaterThan(RAPPORT_FOOD_DELIVERY_DELTA * 5);
  });

  const MOVE: MoveSpec = {
    id: "tackle",
    name: "Tackle",
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 0,
  };
  const HUNT_RULES: HuntRules = { scyther: true };

  it("joint mob-defense (a guardian actually landing a hit) strengthens rapport between defender and defended", () => {
    const world = createWorld(10, 10);
    const guardian = agent("guardian", {
      species: "bulbasaur",
      herdId: "herd-a",
      pos: { x: 5, y: 5 },
      moves: [MOVE],
      maxHp: 40,
      hp: 40,
      level: 10,
      types: ["normal"],
      stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 30 },
    });
    const herdmate = agent("herdmate", {
      species: "bulbasaur",
      herdId: "herd-a",
      pos: { x: 5, y: 6 },
      behavior: "fight",
      maxHp: 40,
      hp: 40,
    });
    const predator = agent("predator", {
      species: "scyther",
      pos: { x: 5, y: 6 },
      maxHp: 40,
      hp: 40,
      types: ["bug"],
      stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 30 },
    });
    world.agents.push(guardian, herdmate, predator);
    const log = new EventLog();

    const acted = applyPredationInstincts(world, guardian, HUNT_RULES, log, undefined, () => 0);

    expect(acted).toBe(true);
    expect(guardian.behavior).toBe("fight");
    expect(rapportScore(guardian, "herdmate", world.tick)).toBeCloseTo(RAPPORT_MOB_DEFENSE_DELTA, 5);
    expect(rapportScore(herdmate, "guardian", world.tick)).toBeCloseTo(RAPPORT_MOB_DEFENSE_DELTA, 5);
    // ...and each side remembers its own role in it, not a shared neutral fact.
    expect(rapportMemories(guardian, "herdmate").map((m) => m.reason)).toEqual(["defended"]);
    expect(rapportMemories(herdmate, "guardian").map((m) => m.reason)).toEqual(["wasDefended"]);
  });

  it("herd-clash fights weaken/negative-shift rapport between exactly the two individuals involved, not species/herd-wide", () => {
    const world = createWorld(10, 10);
    const a = agent("a", {
      species: "bulbasaur",
      herdId: "herd-a",
      pos: { x: 4, y: 5 },
      moves: [MOVE],
      maxHp: 40,
      hp: 40,
      level: 10,
      types: ["normal"],
      stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 30 },
      disposition: { boldness: 1, aggression: 1, sociability: 0.5 },
      ticksBlockedFromResource: HERD_CONFLICT_MIN_BLOCKED_TICKS,
    });
    const rival = agent("rival", { species: "pidgey", herdId: "herd-b", pos: { x: 5, y: 5 }, maxHp: 40, hp: 40 });
    const bystander = agent("bystander", { species: "pidgey", herdId: "herd-b", pos: { x: 8, y: 8 }, maxHp: 40, hp: 40 });
    world.agents.push(a, rival, bystander);

    const engaged = applyHerdRivalryConflict(world, a, HUNT_RULES, rival.pos, undefined, () => 0);

    expect(engaged).toBe(true);
    expect(rapportScore(a, "rival", world.tick)).toBeCloseTo(RAPPORT_HERD_CLASH_DELTA, 5);
    expect(rapportScore(rival, "a", world.tick)).toBeCloseTo(RAPPORT_HERD_CLASH_DELTA, 5);
    // The aggressor and the one who got hit remember different things.
    expect(rapportMemories(a, "rival").map((m) => m.reason)).toEqual(["struck"]);
    expect(rapportMemories(rival, "a").map((m) => m.reason)).toEqual(["wasStruck"]);
    // Not a herd/species-wide effect — an uninvolved same-herd bystander is untouched.
    expect(rapportScore(a, "bystander", world.tick)).toBe(0);
    expect(rapportScore(bystander, "a", world.tick)).toBe(0);
  });
});

describe("rapport memories: an edge remembers WHY, not just how much", () => {
  it("records a reason as an aggregated entry, not one entry per event", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 0.1, "gaveFood");
    adjustRapport(world, a, "b", 0.1, "gaveFood");
    adjustRapport(world, a, "b", 0.1, "gaveFood");

    expect(rapportMemories(a, "b")).toEqual([{ reason: "gaveFood", count: 3, lastTick: world.tick }]);
  });

  it("keeps distinct reasons side by side, strongest-evidence first", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 0.1, "socialized");
    adjustRapport(world, a, "b", 0.1, "gaveFood");
    adjustRapport(world, a, "b", 0.1, "gaveFood");

    expect(rapportMemories(a, "b").map((m) => [m.reason, m.count])).toEqual([
      ["gaveFood", 2],
      ["socialized", 1],
    ]);
  });

  it("lastTick tracks the most recent occurrence, while count keeps the whole history", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 0.1, "struck");
    world.tick = 40;
    adjustRapport(world, a, "b", 0.1, "struck");

    expect(rapportMemories(a, "b")).toEqual([{ reason: "struck", count: 2, lastTick: 40 }]);
  });

  it("a reason-less adjustment leaves existing memories intact rather than clearing them", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 0.1, "gaveFood");
    adjustRapport(world, a, "b", 0.1);

    expect(rapportMemories(a, "b")).toEqual([{ reason: "gaveFood", count: 1, lastTick: world.tick }]);
  });

  it("reading memories for a pair that never interacted is empty, not a throw", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);
    expect(rapportMemories(a, "stranger")).toEqual([]);
  });

  it("memories die with the edge when it prunes — a forgotten relationship keeps no grievances", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 0.05, "struck");
    expect(rapportMemories(a, "b")).toHaveLength(1);

    // Nudge the score back under the prune threshold — the edge goes, and the
    // memory with it, rather than a scoreless grudge surviving forever.
    adjustRapport(world, a, "b", -0.045, "socialized");

    expect(a.rapport?.b).toBeUndefined();
    expect(rapportMemories(a, "b")).toEqual([]);
  });

  it("the two sides of one interaction record DIFFERENT reasons — the edge is directional", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    const b = agent("b");
    world.agents.push(a, b);

    strengthenRapportMutual(world, a, b, 0.2, "defended", "wasDefended");

    expect(rapportMemories(a, "b").map((m) => m.reason)).toEqual(["defended"]);
    expect(rapportMemories(b, "a").map((m) => m.reason)).toEqual(["wasDefended"]);
  });

  it("notableRapportMemories leads with the rarer reason on a count tie", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    // 500 socialize occurrences throttle down to 2 milestones (one at the
    // first, one on crossing 501)... so make it a clean tie against a single
    // defense and let significance decide.
    for (let i = 0; i < 2; i++) adjustRapport(world, a, "b", RAPPORT_SOCIALIZE_DELTA, "socialized");
    adjustRapport(world, a, "b", RAPPORT_MOB_DEFENSE_DELTA, "wasDefended");

    expect(notableRapportMemories(a, "b").map((m) => m.reason)).toEqual(["wasDefended", "socialized"]);
  });

  it("throttles socialized into milestones so a per-tick habit cannot swamp the edge", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    // The real shape: one measured pair logged 2,907 socialize events in a
    // 6,000-tick run — they sat together every other tick.
    for (let i = 0; i < 2907; i++) adjustRapport(world, a, "b", RAPPORT_SOCIALIZE_DELTA, "socialized");

    const [memory] = rapportMemories(a, "b");
    // 1 for the first shared moment, then one per RAPPORT_REASON_MEMORY_INTERVAL.
    expect(memory).toMatchObject({
      reason: "socialized",
      count: 1 + Math.floor(2906 / RAPPORT_REASON_MEMORY_INTERVAL.socialized!),
      occurrences: 2907,
    });
    // The depth is kept, not discarded — the raw total is still there.
    expect(memory!.occurrences).toBe(2907);
    // And a real, risk-bearing act now outranks the habit on raw count alone.
    adjustRapport(world, a, "b", RAPPORT_MOB_DEFENSE_DELTA, "defended");
    for (let i = 0; i < 18; i++) adjustRapport(world, a, "b", RAPPORT_MOB_DEFENSE_DELTA, "defended");
    expect(rapportMemories(a, "b")[0]!.reason).toBe("defended");
  });

  it("the first shared moment records immediately — a throttled reason never sits invisible", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", RAPPORT_SOCIALIZE_DELTA, "socialized");

    expect(rapportMemories(a, "b")).toEqual([
      { reason: "socialized", count: 1, lastTick: world.tick, occurrences: 1 },
    ]);
  });

  it("a throttled reason's lastTick marks the last MILESTONE, not the last occurrence", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", RAPPORT_SOCIALIZE_DELTA, "socialized"); // milestone 1, tick 0
    world.tick = 50;
    adjustRapport(world, a, "b", RAPPORT_SOCIALIZE_DELTA, "socialized"); // occurrence only

    const [memory] = rapportMemories(a, "b");
    expect(memory).toMatchObject({ count: 1, lastTick: 0, occurrences: 2 });
  });

  it("notableRapportMemories does not disturb the stored order or the mechanical view", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 0.05, "socialized");
    adjustRapport(world, a, "b", 0.05, "socialized");
    adjustRapport(world, a, "b", 0.05, "bonded");

    notableRapportMemories(a, "b");

    expect(rapportMemories(a, "b").map((m) => m.reason)).toEqual(["socialized", "bonded"]);
  });

  it("a symmetric interaction records the same reason on both sides (reasonForB defaults to reasonForA)", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    const b = agent("b");
    world.agents.push(a, b);

    strengthenRapportMutual(world, a, b, 0.2, "socialized");

    expect(rapportMemories(a, "b").map((m) => m.reason)).toEqual(["socialized"]);
    expect(rapportMemories(b, "a").map((m) => m.reason)).toEqual(["socialized"]);
  });
});

describe("rapport memories: the real triggers tag themselves correctly", () => {
  it("a real food delivery records gaveFood on the carrier and receivedFood on the receiver", () => {
    const world = createWorld(6, 6);
    const carrier = agent("carrier", {
      herdId: "herd-a",
      pos: { x: 1, y: 0 },
      deliverTargetId: "receiver",
      inventory: [{ itemKey: "food", weight: 1 }],
    });
    const receiver = agent("receiver", { herdId: "herd-a", pos: { x: 0, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });
    world.agents.push(carrier, receiver);
    const log = new EventLog();

    expect(applyHerdSupport(world, carrier, log)).toBe(true);
    expect(log.events.some((e) => e.kind === "foodDelivered")).toBe(true);

    expect(rapportMemories(carrier, "receiver")).toEqual([{ reason: "gaveFood", count: 1, lastTick: world.tick }]);
    expect(rapportMemories(receiver, "carrier")).toEqual([{ reason: "receivedFood", count: 1, lastTick: world.tick }]);
  });

  it("five real deliveries between the same pair aggregate to one memory with count 5", () => {
    const world = createWorld(6, 6);
    const carrier = agent("carrier", { herdId: "herd-a", pos: { x: 0, y: 0 } });
    const receiver = agent("receiver", { herdId: "herd-a", pos: { x: 0, y: 0 }, needs: createNeeds({ hunger: 0.1 }) });
    world.agents.push(carrier, receiver);

    for (let i = 0; i < 5; i++) {
      carrier.deliverTargetId = "receiver";
      carrier.inventory = [{ itemKey: "food", weight: 1 }];
      receiver.needs.hunger = 0.1;
      applyHerdSupport(world, carrier);
    }

    expect(rapportMemories(carrier, "receiver")).toEqual([{ reason: "gaveFood", count: 5, lastTick: world.tick }]);
  });
});

describe("rapport: shared experience, not just transactions", () => {
  const MOVE2: MoveSpec = {
    id: "tackle",
    name: "Tackle",
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 0,
  };
  const RULES2: HuntRules = { scyther: true };

  it("declining a fight over a contested tile is itself remembered — restraint is an interaction", () => {
    const world = createWorld(10, 10);
    const a = agent("a", {
      species: "bulbasaur",
      herdId: "herd-a",
      pos: { x: 4, y: 5 },
      moves: [MOVE2],
      maxHp: 40,
      hp: 40,
      level: 10,
      types: ["normal"],
      stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 30 },
      // Timid and unaggressive: every other gate holds, but the disposition
      // roll will refuse — which is exactly the branch under test.
      disposition: { boldness: 0, aggression: 0, sociability: 0.5 },
      ticksBlockedFromResource: HERD_CONFLICT_MIN_BLOCKED_TICKS,
    });
    const rival = agent("rival", { species: "pidgey", herdId: "herd-b", pos: { x: 5, y: 5 }, maxHp: 40, hp: 40 });
    world.agents.push(a, rival);

    // rng ~1 => the escalation roll always fails, so this is the declined branch.
    const engaged = applyHerdRivalryConflict(world, a, RULES2, rival.pos, undefined, () => 0.999);

    expect(engaged).toBe(false);
    expect(rapportMemories(a, "rival").map((m) => m.reason)).toEqual(["sharedWater"]);
    expect(rapportMemories(rival, "a").map((m) => m.reason)).toEqual(["sharedWater"]);
    // ...and it moved the relationship the OTHER way from a clash.
    expect(rapportScore(a, "rival", world.tick)).toBeGreaterThan(0);
  });

  it("a death nearby bonds the two who watched it and were not it", () => {
    const world = createWorld(20, 20);
    const w1 = agent("w1", { pos: { x: 5, y: 5 } });
    const w2 = agent("w2", { pos: { x: 6, y: 5 } });
    const doomed = agent("doomed", { pos: { x: 5, y: 6 } });
    world.agents.push(w1, w2, doomed);

    doomed.alive = false;
    doomed.diedAtTick = world.tick;
    recordDeathWitnesses(world, () => 0.5);

    expect(rapportMemories(w1, "w2").map((m) => m.reason)).toEqual(["survivedTogether"]);
    expect(rapportMemories(w2, "w1").map((m) => m.reason)).toEqual(["survivedTogether"]);
  });

  it("...but grief instead, when both of them actually cared about the one who died", () => {
    const world = createWorld(20, 20);
    const w1 = agent("w1", { pos: { x: 5, y: 5 } });
    const w2 = agent("w2", { pos: { x: 6, y: 5 } });
    const friend = agent("friend", { pos: { x: 5, y: 6 } });
    world.agents.push(w1, w2, friend);

    adjustRapport(world, w1, "friend", MOURNING_MIN_RAPPORT + 0.1, "socialized");
    adjustRapport(world, w2, "friend", MOURNING_MIN_RAPPORT + 0.1, "socialized");

    friend.alive = false;
    friend.diedAtTick = world.tick;
    recordDeathWitnesses(world, () => 0.5);

    expect(rapportMemories(w1, "w2").map((m) => m.reason)).toEqual(["mourned"]);
    // Grief replaces the plain survival memory rather than stacking with it.
    expect(rapportMemories(w1, "w2")).toHaveLength(1);
  });

  it("one mourner and one stranger is survival, not grief — BOTH have to have cared", () => {
    const world = createWorld(20, 20);
    const w1 = agent("w1", { pos: { x: 5, y: 5 } });
    const w2 = agent("w2", { pos: { x: 6, y: 5 } });
    const friend = agent("friend", { pos: { x: 5, y: 6 } });
    world.agents.push(w1, w2, friend);

    adjustRapport(world, w1, "friend", MOURNING_MIN_RAPPORT + 0.1, "socialized");

    friend.alive = false;
    friend.diedAtTick = world.tick;
    recordDeathWitnesses(world, () => 0.5);

    expect(rapportMemories(w1, "w2").map((m) => m.reason)).toEqual(["survivedTogether"]);
  });

  it("a death out of range bonds nobody, and a death last tick is not re-counted", () => {
    const world = createWorld(40, 40);
    const w1 = agent("w1", { pos: { x: 1, y: 1 } });
    const w2 = agent("w2", { pos: { x: 2, y: 1 } });
    const farAway = agent("far", { pos: { x: 1 + WITNESS_RADIUS + 5, y: 1 } });
    world.agents.push(w1, w2, farAway);

    farAway.alive = false;
    farAway.diedAtTick = world.tick;
    recordDeathWitnesses(world, () => 0.5);
    expect(rapportMemories(w1, "w2")).toEqual([]);

    // Now in range, but it died on a previous tick — already accounted for.
    const stale = agent("stale", { pos: { x: 1, y: 2 } });
    stale.alive = false;
    stale.diedAtTick = world.tick - 1;
    world.agents.push(stale);
    recordDeathWitnesses(world, () => 0.5);
    expect(rapportMemories(w1, "w2")).toEqual([]);
  });

  it("the hunter that caused a death does not come away bonded to its victim's neighbours", () => {
    const world = createWorld(20, 20);
    const hunter = agent("hunter", { species: "scyther", pos: { x: 5, y: 5 }, behavior: "hunt" });
    const bystander = agent("bystander", { pos: { x: 6, y: 5 } });
    const prey = agent("prey", { pos: { x: 5, y: 6 } });
    world.agents.push(hunter, bystander, prey);

    prey.alive = false;
    prey.diedAtTick = world.tick;
    recordDeathWitnesses(world, () => 0.5);

    expect(rapportMemories(hunter, "bystander")).toEqual([]);
    expect(rapportMemories(bystander, "hunter")).toEqual([]);
  });
});

describe("rapport: named subjects, rescue, healing and displacement", () => {
  it("a memory names what it was about, and keeps the most NOTABLE subject", () => {
    const world = createWorld(5, 5);
    const a = agent("a");
    world.agents.push(a);

    adjustRapport(world, a, "b", 0.1, "defeatedTogether", world.rng, { label: "Rattata", id: "r1", level: 4 });
    adjustRapport(world, a, "b", 0.1, "defeatedTogether", world.rng, { label: "Scyther", id: "s1", level: 30 });
    adjustRapport(world, a, "b", 0.1, "defeatedTogether", world.rng, { label: "Rattata", id: "r2", level: 5 });

    const [memory] = rapportMemories(a, "b");
    // Three kills, and the one worth telling somebody about is kept.
    expect(memory).toMatchObject({ count: 3, subject: { label: "Scyther", level: 30 } });
  });

  it("two agents fighting when something dies beside them get a NAMED defeat, not a generic survival", () => {
    const world = createWorld(20, 20);
    const f1 = agent("f1", { pos: { x: 5, y: 5 }, behavior: "fight" });
    const f2 = agent("f2", { pos: { x: 6, y: 5 }, behavior: "fight" });
    const enemy = agent("enemy", { species: "scyther", pos: { x: 5, y: 6 }, level: 22 });
    world.agents.push(f1, f2, enemy);

    enemy.alive = false;
    enemy.diedAtTick = world.tick;
    recordDeathWitnesses(world, () => 0.5);

    const [memory] = rapportMemories(f1, "f2");
    expect(memory).toMatchObject({ reason: "defeatedTogether", subject: { label: "scyther", level: 22 } });
  });

  it("...but only when BOTH were in the fight — one bystander makes it survival again", () => {
    const world = createWorld(20, 20);
    const fighter = agent("fighter", { pos: { x: 5, y: 5 }, behavior: "fight" });
    const bystander = agent("bystander", { pos: { x: 6, y: 5 }, behavior: "idle" });
    const enemy = agent("enemy", { species: "scyther", pos: { x: 5, y: 6 }, level: 22 });
    world.agents.push(fighter, bystander, enemy);

    enemy.alive = false;
    enemy.diedAtTick = world.tick;
    recordDeathWitnesses(world, () => 0.5);

    // Still named — you remember what died even if you only watched.
    expect(rapportMemories(fighter, "bystander")[0]).toMatchObject({
      reason: "survivedTogether",
      subject: { label: "scyther" },
    });
  });

  it("carrying a fainted ally home builds rapport — the Rescue verb, which built none before", () => {
    const world = createWorld(10, 10);
    const carrier = agent("carrier", { herdId: "h", pos: { x: 3, y: 3 }, homePos: { x: 3, y: 3 } });
    const downed = agent("downed", { herdId: "h", pos: { x: 3, y: 3 }, hp: 0, maxHp: 20, fainted: true });
    carrier.carryingId = "downed";
    downed.beingCarriedBy = "carrier";
    world.agents.push(carrier, downed);

    dropCarriedAllyForTest(world, carrier, "arrived");

    expect(rapportMemories(carrier, "downed").map((m) => m.reason)).toEqual(["rescued"]);
    expect(rapportMemories(downed, "carrier").map((m) => m.reason)).toEqual(["wasRescued"]);
    expect(rapportScore(carrier, "downed", world.tick)).toBeCloseTo(RAPPORT_RESCUE_DELTA, 5);
  });

  it("the healAura passive builds rapport — but only when it actually closed a wound", () => {
    const world = createWorld(10, 10);
    const healer = agent("healer", {
      herdId: "h",
      pos: { x: 3, y: 3 },
      hp: 20,
      maxHp: 20,
      passives: { healAura: 0.1 },
    });
    const hurt = agent("hurt", { herdId: "h", pos: { x: 4, y: 3 }, hp: 5, maxHp: 20 });
    const unhurt = agent("unhurt", { herdId: "h", pos: { x: 2, y: 3 }, hp: 20, maxHp: 20 });
    world.agents.push(healer, hurt, unhurt);

    tickStatusEffects(healer, world);

    expect(hurt.hp).toBeGreaterThan(5);
    expect(rapportMemories(healer, "hurt").map((m) => m.reason)).toEqual(["healed"]);
    expect(rapportMemories(hurt, "healer").map((m) => m.reason)).toEqual(["wasHealed"]);
    // Topping up somebody already at full HP is arithmetically a no-op, and a
    // no-op must not read as care — otherwise every aura holder ends up
    // "close" to everyone who ever stood near it.
    expect(rapportMemories(healer, "unhurt")).toEqual([]);
  });

  it("dropping an ally because a predator turned up is NOT a rescue", () => {
    const world = createWorld(10, 10);
    const carrier = agent("carrier", { herdId: "h", pos: { x: 3, y: 3 } });
    const downed = agent("downed", { herdId: "h", pos: { x: 3, y: 3 }, hp: 0, maxHp: 20, fainted: true });
    carrier.carryingId = "downed";
    downed.beingCarriedBy = "carrier";
    world.agents.push(carrier, downed);

    dropCarriedAllyForTest(world, carrier, "threat");

    expect(rapportMemories(carrier, "downed")).toEqual([]);
    expect(rapportMemories(downed, "carrier")).toEqual([]);
  });
});

describe("rapport consumer: mate preference favors an existing positive-rapport candidate", () => {
  // Deliberately solitary (no herdId) — isolates the rapport-distance bonus
  // from `STATUS_DISTANCE_BONUS`'s own herd-rank scoring (a solitary
  // candidate's `statusAdvantage` is a constant 1 for everyone, so it cancels
  // out of the comparison entirely) rather than fighting a second confound.
  function suitor(id: string, pos: { x: number; y: number }, sex: "male" | "female" = "male"): Agent {
    return agent(id, {
      species: "bulbasaur",
      sex,
      age: 500,
      level: 16,
      pos,
      needs: createNeeds({ mateDrive: 0.9 }),
    });
  }

  it("a real behavioral effect: agent moves toward the bonded/positive-rapport candidate over a nearer stranger", () => {
    const world = createWorld(20, 20);
    const female = suitor("female", { x: 10, y: 10 }, "female");
    const nearerStranger = suitor("apple", { x: 12, y: 10 }); // distance 2, no rapport
    const fartherFriend = suitor("zebra", { x: 13, y: 10 }); // distance 3, full positive rapport
    world.agents.push(female, nearerStranger, fartherFriend);

    adjustRapport(world, female, "zebra", 1, undefined, world.rng);

    for (let i = 0; i < 10 && female.bondedPartnerId === undefined; i++) {
      applyMateSeeking(world, female);
    }
    expect(female.bondedPartnerId).toBe("zebra");
  });

  it("without the rapport edge, the same setup prefers the nearer stranger instead", () => {
    const world = createWorld(20, 20);
    const female = suitor("female", { x: 10, y: 10 }, "female");
    const nearerStranger = suitor("apple", { x: 12, y: 10 });
    const fartherStranger = suitor("zebra", { x: 13, y: 10 });
    world.agents.push(female, nearerStranger, fartherStranger);

    for (let i = 0; i < 10 && female.bondedPartnerId === undefined; i++) {
      applyMateSeeking(world, female);
    }
    expect(female.bondedPartnerId).toBe("apple");
  });
});

describe("rapport consumer: herd-conflict re-targets and re-escalates against a real grudge", () => {
  const HUNT_RULES: HuntRules = { scyther: true };
  const MOVE: MoveSpec = {
    id: "tackle",
    name: "Tackle",
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 0,
  };

  function contestant(id: string, pos: { x: number; y: number }, herdId: string): Agent {
    return agent(id, {
      species: "bulbasaur",
      herdId,
      pos,
      moves: [MOVE],
      maxHp: 40,
      hp: 40,
      level: 10,
      types: ["normal"],
      stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 30 },
      disposition: { boldness: 0, aggression: 0, sociability: 0.5 }, // courage 0 — isolates the grudge bonus from disposition
      ticksBlockedFromResource: HERD_CONFLICT_MIN_BLOCKED_TICKS,
    });
  }

  it("escalates against a rival it already has a strong grudge against, at a roll that would otherwise fail", () => {
    const world = createWorld(10, 10);
    const a = contestant("a", { x: 5, y: 5 }, "herd-a");
    const rival = contestant("rival", { x: 5, y: 6 }, "herd-b");
    world.agents.push(a, rival);

    // Roll sits strictly between the plain (grudge-free) chance and the grudge-boosted chance.
    const plainChance = 0.03; // HERD_CONFLICT_BASE_CHANCE, courage 0 contributes nothing
    const roll = () => plainChance + 0.001;

    // No prior grudge — this roll fails.
    expect(applyHerdRivalryConflict(world, a, HUNT_RULES, rival.pos, undefined, roll)).toBe(false);

    // Give "a" a strong existing grudge against "rival" (as if from a past herdClash).
    adjustRapport(world, a, "rival", -1, undefined, world.rng);
    a.herdConflictCooldownTicks = 0;

    // The exact same roll now succeeds, purely because of the grudge bonus.
    expect(applyHerdRivalryConflict(world, a, HUNT_RULES, rival.pos, undefined, roll)).toBe(true);
  });

  it("targets the specific individual it has a grudge against over an equally-near stranger", () => {
    const world = createWorld(10, 10);
    const a = contestant("a", { x: 5, y: 5 }, "herd-a");
    const grudgeRival = contestant("grudge-rival", { x: 5, y: 6 }, "herd-b");
    const stranger = contestant("stranger", { x: 4, y: 5 }, "herd-c"); // same distance (1) from the contested tile
    world.agents.push(a, grudgeRival, stranger);

    adjustRapport(world, a, "grudge-rival", -1, undefined, world.rng);

    // ALWAYS_FIGHT-style rng: succeeds every probability gate deterministically.
    const target = { x: 5, y: 6 }; // stranger and grudgeRival are both within RIVAL_DETECT_RADIUS of one of the two tested targets below
    // Use a target equidistant (1 tile) from both candidates: (5,5)-ish midpoint isn't on a grid,
    // so instead confirm targeting directly against a target where both are within radius 1.
    // grudgeRival at (5,6) and stranger at (4,5) are each exactly distance 1 from (5,5).
    const engaged = applyHerdRivalryConflict(world, a, HUNT_RULES, { x: 5, y: 5 }, undefined, () => 0);
    expect(engaged).toBe(true);
    // The grudge partner should have taken the hit, not the stranger.
    expect(grudgeRival.hp).toBeLessThan(40);
    expect(stranger.hp).toBe(40);
  });
});
