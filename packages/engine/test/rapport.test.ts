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
  adjustRapport,
  decayedRapportScore,
  rapportScore,
  strengthenRapportMutual,
} from "../src/rapport.js";
import { applyHerdSupport, DELIVERED_FOOD_HUNGER_RESTORE } from "../src/support.js";
import { applyMateSeeking } from "../src/reproduction.js";
import { applyPredationInstincts } from "../src/predation.js";
import { applyHerdRivalryConflict, HERD_CONFLICT_MIN_BLOCKED_TICKS } from "../src/herdConflict.js";

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
      adjustRapport(world, a, "extra", 0.5, world.rng);
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
    // Not a herd/species-wide effect — an uninvolved same-herd bystander is untouched.
    expect(rapportScore(a, "bystander", world.tick)).toBe(0);
    expect(rapportScore(bystander, "a", world.tick)).toBe(0);
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

    adjustRapport(world, female, "zebra", 1, world.rng);

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
    adjustRapport(world, a, "rival", -1, world.rng);
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

    adjustRapport(world, a, "grudge-rival", -1, world.rng);

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
