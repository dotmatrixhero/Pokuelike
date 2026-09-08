import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import {
  BURN_DAMAGE_FRACTION,
  PASSIVE_HEAL_CEILING,
  REGEN_COMBAT_SUPPRESSION_TICKS,
  softCapHealShare,
  suppressPassiveHealing,
  FREEZE_THAW_CHANCE,
  POISON_DAMAGE_FRACTION,
  SLEEP_TICKS_MAX,
  SLEEP_TICKS_MIN,
  applyStatStage,
  damageReductionFlatOf,
  damageReductionOf,
  defenseBoostOf,
  getStatStage,
  grantPassive,
  isAsleep,
  isBurned,
  isFrozen,
  isImmovable,
  isImmuneToStatus,
  isParalyzed,
  maybeInflictStatus,
  maybeSpreadStatus,
  maybeThawOnFireHit,
  thornsOf,
  tickStatusEffects,
} from "../src/status.js";

/**
 * Seed for every world in this file, so a test never depends on an unseeded
 * RNG draw. Chasing an intermittent full-suite failure showed the cause was
 * not shared state across files (the theory for most of a session) but
 * plain unseeded randomness inside individual tests — a different test lost
 * a coin flip on each run, and every one of them passed in isolation.
 */
const DETERMINISTIC_TEST_SEED = 12345;

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

describe("isImmuneToStatus", () => {
  it("real mainline type immunities", () => {
    expect(isImmuneToStatus(["fire"], "burn")).toBe(true);
    expect(isImmuneToStatus(["electric"], "paralysis")).toBe(true);
    expect(isImmuneToStatus(["poison"], "poison")).toBe(true);
    expect(isImmuneToStatus(["steel"], "poison")).toBe(true);
    expect(isImmuneToStatus(["ice"], "freeze")).toBe(true);
  });

  it("a type isn't immune to a status it has no real immunity to", () => {
    expect(isImmuneToStatus(["grass"], "burn")).toBe(false);
    expect(isImmuneToStatus(["water"], "paralysis")).toBe(false);
  });

  it("sleep has no type immunity", () => {
    expect(isImmuneToStatus(["fire", "water", "electric"], "sleep")).toBe(false);
  });

  it("handles an agent with no types at all", () => {
    expect(isImmuneToStatus(undefined, "burn")).toBe(false);
  });
});

describe("maybeInflictStatus", () => {
  const BURN_MOVE = { statusKind: "burn" as const, statusChance: 0.5 };

  it("inflicts the status on a successful roll", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const log = new EventLog();
    const defender = makeAgent({ types: ["grass"] });
    maybeInflictStatus(defender, "attacker-1", BURN_MOVE, world, log, () => 0.1); // 0.1 < 0.5
    expect(defender.status).toEqual({ kind: "burn", ticksRemaining: undefined });
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "statusInflicted", agentId: "a1", statusKind: "burn", inflictedBy: "attacker-1" })
    );
  });

  it("does nothing on a failed roll", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const defender = makeAgent({ types: ["grass"] });
    maybeInflictStatus(defender, "attacker-1", BURN_MOVE, world, undefined, () => 0.9); // 0.9 >= 0.5
    expect(defender.status).toBeUndefined();
  });

  it("respects type immunity even on a guaranteed roll", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const defender = makeAgent({ types: ["fire"] });
    maybeInflictStatus(defender, "attacker-1", BURN_MOVE, world, undefined, () => 0);
    expect(defender.status).toBeUndefined();
  });

  it("never overwrites an existing status — at most one at a time", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const defender = makeAgent({ types: ["grass"], status: { kind: "paralysis" } });
    maybeInflictStatus(defender, "attacker-1", BURN_MOVE, world, undefined, () => 0);
    expect(defender.status).toEqual({ kind: "paralysis" });
  });

  it("carries statusSeverity from the move onto the inflicted status, for a 'badly poisons' move", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const defender = makeAgent({ types: ["grass"] });
    maybeInflictStatus(defender, "attacker-1", { statusKind: "poison", statusChance: 1, statusSeverity: 2 }, world, undefined, () => 0);
    expect(defender.status).toEqual({ kind: "poison", ticksRemaining: undefined, severityMultiplier: 2 });
  });

  it("no-ops when the move carries no statusKind or statusChance", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const defender = makeAgent({ types: ["grass"] });
    maybeInflictStatus(defender, "attacker-1", {}, world, undefined, () => 0);
    expect(defender.status).toBeUndefined();
  });

  it("gives sleep a bounded random duration; other kinds get none", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const asleep = makeAgent();
    maybeInflictStatus(asleep, "a", { statusKind: "sleep", statusChance: 1 }, world, undefined, () => 0.5);
    expect(asleep.status?.ticksRemaining).toBeGreaterThanOrEqual(SLEEP_TICKS_MIN);
    expect(asleep.status?.ticksRemaining).toBeLessThanOrEqual(SLEEP_TICKS_MAX);

    const poisoned = makeAgent();
    maybeInflictStatus(poisoned, "a", { statusKind: "poison", statusChance: 1 }, world, undefined, () => 0);
    expect(poisoned.status?.ticksRemaining).toBeUndefined();
  });
});

describe("maybeThawOnFireHit", () => {
  it("thaws a frozen agent hit by a fire-type move", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const log = new EventLog();
    const agent = makeAgent({ status: { kind: "freeze" } });
    maybeThawOnFireHit(agent, "fire", world, log);
    expect(agent.status).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "statusCleared", statusKind: "freeze", reason: "thawed" }));
  });

  it("does nothing for a non-fire hit", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "freeze" } });
    maybeThawOnFireHit(agent, "water", world, undefined);
    expect(agent.status).toEqual({ kind: "freeze" });
  });

  it("does nothing if the agent isn't frozen", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "burn" } });
    maybeThawOnFireHit(agent, "fire", world, undefined);
    expect(agent.status).toEqual({ kind: "burn" });
  });
});

describe("tickStatusEffects: burn/poison DOT", () => {
  it("burn deals 1/16 maxHp damage per tick", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "burn" } });
    tickStatusEffects(agent, world);
    expect(agent.hp).toBeCloseTo(50 - 50 * BURN_DAMAGE_FRACTION);
  });

  it("poison deals 1/8 maxHp damage per tick", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "poison" } });
    tickStatusEffects(agent, world);
    expect(agent.hp).toBeCloseTo(50 - 50 * POISON_DAMAGE_FRACTION);
  });

  it("statusSeverity multiplies the DOT fraction — a 'badly poisons' move hits harder every tick, not just once", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "poison", severityMultiplier: 2 } });
    tickStatusEffects(agent, world);
    expect(agent.hp).toBeCloseTo(50 - 50 * POISON_DAMAGE_FRACTION * 2);
  });

  it("no severityMultiplier set behaves exactly like normal-severity poison", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "poison", severityMultiplier: undefined } });
    tickStatusEffects(agent, world);
    expect(agent.hp).toBeCloseTo(50 - 50 * POISON_DAMAGE_FRACTION);
  });

  it("DOT that brings hp to 0 faints — it does not kill outright, and clears the status", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const log = new EventLog();
    const agent = makeAgent({ hp: 1, maxHp: 50, status: { kind: "poison" } });
    tickStatusEffects(agent, world, log);
    expect(agent.hp).toBe(0);
    expect(agent.fainted).toBe(true);
    expect(agent.alive).not.toBe(false);
    expect(agent.finishingPool).toBeGreaterThan(0);
    expect(agent.status).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "fainted", agentId: "a1" }));
  });

  it("no-ops on a corpse or an already-fainted agent", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const corpse = makeAgent({ alive: false, status: { kind: "poison" } });
    tickStatusEffects(corpse, world);
    expect(corpse.hp).toBe(50); // untouched

    const fainted = makeAgent({ fainted: true, status: { kind: "poison" } });
    tickStatusEffects(fainted, world);
    expect(fainted.hp).toBe(50); // untouched
  });
});

describe("tickStatusEffects: sleep", () => {
  it("counts ticksRemaining down without waking early", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "sleep", ticksRemaining: 3 } });
    tickStatusEffects(agent, world);
    expect(agent.status).toEqual({ kind: "sleep", ticksRemaining: 2 });
  });

  it("wakes and clears status once ticksRemaining reaches 0", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const log = new EventLog();
    const agent = makeAgent({ status: { kind: "sleep", ticksRemaining: 1 } });
    tickStatusEffects(agent, world, log);
    expect(agent.status).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "statusCleared", statusKind: "sleep", reason: "woke" }));
  });
});

describe("tickStatusEffects: freeze", () => {
  it("thaws on a successful per-tick roll", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const log = new EventLog();
    const agent = makeAgent({ status: { kind: "freeze" } });
    tickStatusEffects(agent, world, log, () => 0); // 0 < FREEZE_THAW_CHANCE
    expect(agent.status).toBeUndefined();
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "statusCleared", statusKind: "freeze", reason: "thawed" }));
  });

  it("stays frozen on a failed roll", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "freeze" } });
    tickStatusEffects(agent, world, undefined, () => FREEZE_THAW_CHANCE); // not < chance
    expect(agent.status).toEqual({ kind: "freeze" });
  });
});

describe("tickStatusEffects: paralysis has no per-tick effect here", () => {
  it("leaves a paralyzed agent's status and hp untouched", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ status: { kind: "paralysis" } });
    tickStatusEffects(agent, world);
    expect(agent.status).toEqual({ kind: "paralysis" });
    expect(agent.hp).toBe(50);
  });
});

describe("applyStatStage / getStatStage", () => {
  it("stacks multiple entries on the same stat additively", () => {
    const agent = makeAgent();
    applyStatStage(agent, "attack", -1);
    applyStatStage(agent, "attack", -1);
    expect(getStatStage(agent, "attack")).toBe(-2);
    expect(getStatStage(agent, "defense")).toBe(0); // untouched
  });

  it("a permanent entry (no ticksRemaining) survives tickStatusEffects indefinitely", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent();
    applyStatStage(agent, "defense", 1);
    tickStatusEffects(agent, world);
    tickStatusEffects(agent, world);
    expect(getStatStage(agent, "defense")).toBe(1);
  });

  it("a temporary entry (ticksRemaining set) counts down and is removed on expiry", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent();
    applyStatStage(agent, "speed", 2, 2);
    tickStatusEffects(agent, world);
    expect(getStatStage(agent, "speed")).toBe(2); // 1 tick left, still active
    tickStatusEffects(agent, world);
    expect(getStatStage(agent, "speed")).toBe(0); // expired
    expect(agent.statStages).toBeUndefined();
  });

  it("a temporary and a permanent entry on the same stat coexist until the temporary one expires", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent();
    applyStatStage(agent, "attack", 1); // permanent
    applyStatStage(agent, "attack", 3, 1); // temporary, 1 tick
    expect(getStatStage(agent, "attack")).toBe(4);
    tickStatusEffects(agent, world);
    expect(getStatStage(agent, "attack")).toBe(1); // only the permanent one remains
  });

  it("tickStatusEffects on a corpse leaves stat stages untouched", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ alive: false });
    applyStatStage(agent, "speed", 1, 1);
    tickStatusEffects(agent, world);
    expect(getStatStage(agent, "speed")).toBe(1); // not ticked down
  });
});

describe("agent-modifying passives (grantPassive/damageReductionOf/isImmovable)", () => {
  it("grantPassive accumulates into agent.passives", () => {
    const agent = makeAgent();
    grantPassive(agent, "damageReduction", 0.1);
    grantPassive(agent, "damageReduction", 0.15);
    expect(agent.passives?.damageReduction).toBeCloseTo(0.25);
  });

  it("damageReductionOf applies diminishing returns to the accumulated fraction", () => {
    const agent = makeAgent();
    expect(damageReductionOf(agent)).toBe(0);
    // A single small node is worth very nearly its face value...
    grantPassive(agent, "damageReduction", 0.05);
    expect(damageReductionOf(agent)).toBeCloseTo(0.0476, 3);
    // ...while a big stack is pulled back hard: 0.5 raw -> 1/3 effective.
    grantPassive(agent, "damageReduction", 0.45);
    expect(damageReductionOf(agent)).toBeCloseTo(0.3333, 3);
  });

  it("damageReductionOf can never reach immunity, however much is stacked", () => {
    const agent = makeAgent();
    grantPassive(agent, "damageReduction", 100);
    expect(damageReductionOf(agent)).toBeLessThan(1);
    expect(damageReductionOf(agent)).toBeGreaterThan(0.98);
  });

  it("damageReductionOf is monotonic — more is always worth something, just less", () => {
    let prev = 0;
    const agent = makeAgent();
    for (let i = 0; i < 12; i++) {
      grantPassive(agent, "damageReduction", 0.05);
      const now = damageReductionOf(agent);
      expect(now).toBeGreaterThan(prev);
      prev = now;
    }
  });

  it("percentage and flat damage reduction are independent passives", () => {
    const agent = makeAgent();
    grantPassive(agent, "damageReduction", 0.2);
    grantPassive(agent, "damageReductionFlat", 3);
    expect(damageReductionOf(agent)).toBeCloseTo(0.2 / 1.2, 4);
    expect(damageReductionFlatOf(agent)).toBe(3);
  });

  it("damageReductionFlatOf reads the accumulated flat armor", () => {
    const agent = makeAgent();
    expect(damageReductionFlatOf(agent)).toBe(0);
    grantPassive(agent, "damageReductionFlat", 2);
    grantPassive(agent, "damageReductionFlat", 1.5);
    expect(damageReductionFlatOf(agent)).toBeCloseTo(3.5);
  });

  it("isImmovable reflects whether the passive was granted at all", () => {
    const agent = makeAgent();
    expect(isImmovable(agent)).toBe(false);
    grantPassive(agent, "immovable", 1);
    expect(isImmovable(agent)).toBe(true);
  });

  it("defenseBoostOf reads the accumulated Defense stat-stage bonus, unclamped (calculateDamage does its own [-6,6] clamp after summing)", () => {
    const agent = makeAgent();
    expect(defenseBoostOf(agent)).toBe(0);
    grantPassive(agent, "defenseBoost", 0.5);
    grantPassive(agent, "defenseBoost", 0.5);
    expect(defenseBoostOf(agent)).toBe(1);
  });

  it("the regen passive heals a fraction of maxHp every tick, independent of being fed/watered", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ hp: 10, maxHp: 50, needs: createNeeds({ hunger: 0, thirst: 0 }) });
    grantPassive(agent, "regen", 0.1);
    tickStatusEffects(agent, world);
    // 0.1 of maxHp is well past PASSIVE_HEAL_KNEE, so the soft cap applies:
    // an effective share of ~0.0592, not the raw 0.1.
    expect(agent.hp).toBeCloseTo(10 + 50 * softCapHealShare(0.1), 5);
  });
});

describe("multi-action lock (Agent.actionLockTicks)", () => {
  it("tickStatusEffects counts an action lock down to 0", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ actionLockTicks: 2 });
    tickStatusEffects(agent, world);
    expect(agent.actionLockTicks).toBe(1);
    tickStatusEffects(agent, world);
    expect(agent.actionLockTicks).toBe(0);
  });

  it("does not go negative once already at 0", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ actionLockTicks: 0 });
    tickStatusEffects(agent, world);
    expect(agent.actionLockTicks).toBe(0);
  });
});

describe("rally-call focus-fire mark (Agent.rallyMarkTicksRemaining)", () => {
  it("tickStatusEffects counts a rally mark down to 0", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ rallyMarkTicksRemaining: 2 });
    tickStatusEffects(agent, world);
    expect(agent.rallyMarkTicksRemaining).toBe(1);
    tickStatusEffects(agent, world);
    expect(agent.rallyMarkTicksRemaining).toBe(0);
  });

  it("does not go negative once already at 0, and no-ops when never set", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const zeroed = makeAgent({ rallyMarkTicksRemaining: 0 });
    tickStatusEffects(zeroed, world);
    expect(zeroed.rallyMarkTicksRemaining).toBe(0);

    const unset = makeAgent();
    tickStatusEffects(unset, world);
    expect(unset.rallyMarkTicksRemaining).toBeUndefined();
  });

  it("does not tick down on a corpse", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ alive: false, rallyMarkTicksRemaining: 3 });
    tickStatusEffects(agent, world);
    expect(agent.rallyMarkTicksRemaining).toBe(3);
  });
});

describe("thornsOf", () => {
  it("reads the accumulated thorns passive, defaulting to 0", () => {
    const agent = makeAgent();
    expect(thornsOf(agent)).toBe(0);
    grantPassive(agent, "thorns", 0.2);
    expect(thornsOf(agent)).toBeCloseTo(0.2);
  });

  it("never goes negative even if somehow granted a negative value", () => {
    const agent = makeAgent({ passives: { thorns: -0.5 } });
    expect(thornsOf(agent)).toBe(0);
  });
});

describe("healAura passive", () => {
  it("heals every living same-herd, same-layer agent within radius, holder included", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const healer = makeAgent({ id: "healer", herdId: "h1", pos: { x: 2, y: 2 }, hp: 10, maxHp: 50 });
    grantPassive(healer, "healAura", 0.1);
    const nearbyAlly = makeAgent({ id: "ally", herdId: "h1", pos: { x: 3, y: 2 }, hp: 10, maxHp: 50 });
    const farAlly = makeAgent({ id: "far", herdId: "h1", pos: { x: 0, y: 0 }, hp: 10, maxHp: 50 });
    const otherHerd = makeAgent({ id: "other-herd", herdId: "h2", pos: { x: 2, y: 3 }, hp: 10, maxHp: 50 });
    world.agents.push(healer, nearbyAlly, farAlly, otherHerd);

    tickStatusEffects(healer, world);

    expect(healer.hp).toBeCloseTo(15); // self-heals too
    expect(nearbyAlly.hp).toBeCloseTo(15);
    expect(farAlly.hp).toBe(10); // out of radius
    expect(otherHerd.hp).toBe(10); // different herd
  });

  it("no-ops without the passive or without a herdId", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const agent = makeAgent({ hp: 10, maxHp: 50 });
    world.agents.push(agent);
    tickStatusEffects(agent, world);
    expect(agent.hp).toBe(10);
  });
});

describe("maybeSpreadStatus", () => {
  it("spreads the same status to a nearby living agent on a successful roll", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const source = makeAgent({ id: "source", pos: { x: 2, y: 2 }, status: { kind: "burn" } });
    const neighbor = makeAgent({ id: "neighbor", pos: { x: 3, y: 2 }, types: ["grass"] });
    world.agents.push(source, neighbor);
    maybeSpreadStatus(source, "attacker-1", "burn", world, undefined, () => 0);
    expect(neighbor.status).toEqual({ kind: "burn", ticksRemaining: undefined });
  });

  it("does nothing on a failed spread roll", () => {
    const world = createWorld(5, 5, DETERMINISTIC_TEST_SEED);
    const source = makeAgent({ id: "source", pos: { x: 2, y: 2 }, status: { kind: "burn" } });
    const neighbor = makeAgent({ id: "neighbor", pos: { x: 3, y: 2 }, types: ["grass"] });
    world.agents.push(source, neighbor);
    maybeSpreadStatus(source, "attacker-1", "burn", world, undefined, () => 0.999);
    expect(neighbor.status).toBeUndefined();
  });

  it("doesn't spread to an agent out of radius or on a different layer", () => {
    const world = createWorld(10, 10, DETERMINISTIC_TEST_SEED);
    const source = makeAgent({ id: "source", pos: { x: 2, y: 2 }, status: { kind: "burn" } });
    const farNeighbor = makeAgent({ id: "far", pos: { x: 9, y: 9 }, types: ["grass"] });
    world.agents.push(source, farNeighbor);
    maybeSpreadStatus(source, "attacker-1", "burn", world, undefined, () => 0);
    expect(farNeighbor.status).toBeUndefined();
  });
});

describe("status predicates", () => {
  it("isBurned/isParalyzed/isAsleep/isFrozen read the current status kind", () => {
    expect(isBurned(makeAgent({ status: { kind: "burn" } }))).toBe(true);
    expect(isParalyzed(makeAgent({ status: { kind: "paralysis" } }))).toBe(true);
    expect(isAsleep(makeAgent({ status: { kind: "sleep" } }))).toBe(true);
    expect(isFrozen(makeAgent({ status: { kind: "freeze" } }))).toBe(true);
    expect(isBurned(makeAgent())).toBe(false);
  });
});

describe("passive healing: flat vs percent, and the out-of-combat gate", () => {
  it("regenFlat heals its stated amount while a build's total healing stays under the knee", () => {
    // 1 HP is 1% of a 100 HP unit — comfortably below PASSIVE_HEAL_KNEE, so
    // it is delivered exactly. Flat healing is absolute where it matters:
    // on a light build. Only a heavily stacked one meets the soft cap.
    const big = makeAgent({ hp: 10, maxHp: 100, passives: { regenFlat: 1 } });
    tickStatusEffects(big);
    expect(big.hp).toBe(11);

    // On a 30 HP unit the same 1 HP is a 3.3% share, just over the knee, so
    // it is shaved very slightly rather than delivered whole. This is the
    // deliberate consequence of capping healing as a share of max HP.
    const small = makeAgent({ id: "a2", hp: 10, maxHp: 30, passives: { regenFlat: 1 } });
    tickStatusEffects(small);
    expect(small.hp!).toBeGreaterThan(10.98);
    expect(small.hp!).toBeLessThan(11);
  });

  it("is worth proportionally more to a small unit than a big one — the whole point of flat", () => {
    const small = makeAgent({ hp: 10, maxHp: 30, passives: { regenFlat: 1 } });
    const big = makeAgent({ id: "a2", hp: 10, maxHp: 100, passives: { regenFlat: 1 } });
    tickStatusEffects(small);
    tickStatusEffects(big);
    const smallShare = (small.hp! - 10) / small.maxHp!;
    const bigShare = (big.hp! - 10) / big.maxHp!;
    expect(smallShare).toBeGreaterThan(bigShare * 3);
  });

  it("percent regen scales with max HP — the capstone-tier version", () => {
    const small = makeAgent({ hp: 10, maxHp: 30, passives: { regen: 0.1 } });
    const big = makeAgent({ id: "a2", hp: 10, maxHp: 100, passives: { regen: 0.1 } });
    tickStatusEffects(small);
    tickStatusEffects(big);
    expect(big.hp! - 10).toBeGreaterThan(small.hp! - 10);
  });

  it("flat and percent combine into one share, then meet the soft cap together", () => {
    // Raw share is 0.1 + 2/100 = 0.12; the cap is on the TOTAL, which is the
    // whole point — it is the sum of every healing node that matters, not
    // any one of them.
    const agent = makeAgent({ hp: 10, maxHp: 100, passives: { regen: 0.1, regenFlat: 2 } });
    tickStatusEffects(agent);
    expect(agent.hp).toBeCloseTo(10 + 100 * softCapHealShare(0.12), 5);
    expect(agent.hp!).toBeLessThan(22); // what it would have been uncapped
  });

  it("passive healing can never exceed PASSIVE_HEAL_CEILING, however much is stacked", () => {
    const agent = makeAgent({ hp: 0, maxHp: 100, passives: { regen: 5, regenFlat: 500 } });
    tickStatusEffects(agent);
    expect(agent.hp!).toBeLessThan(100 * PASSIVE_HEAL_CEILING);
    expect(agent.hp!).toBeGreaterThan(100 * PASSIVE_HEAL_CEILING * 0.9);
  });

  it("a light healing build is untouched by the cap — a node delivers what it says", () => {
    const agent = makeAgent({ hp: 10, maxHp: 100, passives: { regenFlat: 2 } });
    tickStatusEffects(agent);
    expect(agent.hp).toBe(12);
  });

  it("more healing is always worth something, just progressively less", () => {
    let prev = 0;
    for (const flat of [1, 2, 4, 8, 16, 32]) {
      const a = makeAgent({ hp: 0, maxHp: 50, passives: { regenFlat: flat } });
      tickStatusEffects(a);
      expect(a.hp!).toBeGreaterThan(prev);
      prev = a.hp!;
    }
  });

  it("recent damage suppresses BOTH flat and percent passive healing", () => {
    const agent = makeAgent({ hp: 10, maxHp: 100, passives: { regen: 0.1, regenFlat: 2 } });
    suppressPassiveHealing(agent);
    tickStatusEffects(agent);
    expect(agent.hp).toBe(10);
  });

  it("suppression refreshes rather than stacking", () => {
    const agent = makeAgent();
    suppressPassiveHealing(agent, 5);
    suppressPassiveHealing(agent, 3);
    expect(agent.regenSuppressedTicks).toBe(5);
  });

  it("wears off after REGEN_COMBAT_SUPPRESSION_TICKS so a disengaged unit really does recover", () => {
    const agent = makeAgent({ hp: 10, maxHp: 100, passives: { regenFlat: 2 } });
    suppressPassiveHealing(agent);
    for (let i = 0; i < REGEN_COMBAT_SUPPRESSION_TICKS - 1; i++) tickStatusEffects(agent);
    expect(agent.hp).toBe(10);
    tickStatusEffects(agent);
    expect(agent.hp).toBe(12);
  });
});
