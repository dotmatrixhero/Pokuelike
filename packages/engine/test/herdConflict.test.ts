import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import {
  HERD_CONFLICT_HP_FLOOR_FRACTION,
  HERD_CONFLICT_MIN_BLOCKED_TICKS,
  HERD_CONFLICT_MIN_POWER_RATIO,
  applyHerdRivalryConflict,
} from "../src/herdConflict.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";
import { EventLog } from "../src/events.js";

/** No predator flagged — herd conflict is scoped to non-predator species only. */
const RULES: HuntRules = { scyther: true };

const TEST_MOVE: MoveSpec = {
  id: "shove",
  name: "Shove",
  shape: { kind: "point" },
  type: "normal",
  category: "physical",
  power: 40,
  accuracy: 100,
  cooldownTicks: 0,
};

function agent(id: string, species: string, herdId: string, pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species,
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "seekWater",
    herdId,
    moves: [TEST_MOVE],
    maxHp: 40,
    hp: 40,
    level: 10,
    types: ["normal"],
    stats: { hp: 40, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 30 },
    ...overrides,
  };
}

/** Always fights, never flees — courage 1.0 (boldness/aggression both 1). */
const BOLD = { boldness: 1, aggression: 1, sociability: 0.5 };
/** Never fights — courage 0.0. */
const TIMID = { boldness: 0, aggression: 0, sociability: 0.5 };

function bumpedUp(agentRef: Agent, ticks = HERD_CONFLICT_MIN_BLOCKED_TICKS): Agent {
  agentRef.ticksBlockedFromResource = ticks;
  return agentRef;
}

const TARGET = { x: 5, y: 5 };
/** 0 always clears `rng() < chance`/`rng() * 100 < accuracy` gates — deterministic "always succeeds" for every roll this module makes. */
const ALWAYS_FIGHT = () => 0;
const NEVER_ROLL = () => 0.999; // fails every probability check that isn't guaranteed

describe("applyHerdRivalryConflict", () => {
  it("does nothing when no rival occupies the contested tile", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD }));
    world.agents.push(a);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("does nothing when the occupant is the agent's own herd-mate", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD }));
    const mate = agent("b", "bulbasaur", "herd-a", TARGET);
    world.agents.push(a, mate);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("does nothing when either side is a predator species (out of scope)", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "scyther", "herd-a", { x: 4, y: 5 }, { disposition: BOLD }));
    const rival = agent("b", "bulbasaur", "herd-b", TARGET);
    world.agents.push(a, rival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("a bold, aggressive, comparably-matched agent fights a real cross-species rival", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);

    const engaged = applyHerdRivalryConflict(world, a, RULES, TARGET, log, ALWAYS_FIGHT);

    expect(engaged).toBe(true);
    expect(log.events.some((e) => e.kind === "herdClash")).toBe(true);
    // Real damage from the shared combat pipeline — rival's hp actually moved.
    expect(rival.hp).toBeLessThan(40);
  });

  it("same-species herds can fight too — not restricted to cross-species", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD }));
    const rival = agent("b", "bulbasaur", "herd-b", TARGET);
    world.agents.push(a, rival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(true);
  });

  it("a timid, low-aggression agent almost never escalates (disposition gate, not a flat chance)", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: TIMID }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);

    // TIMID's chance is HERD_CONFLICT_BASE_CHANCE alone (courage 0 contributes
    // nothing) — a roll just under 1.0 always fails it.
    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, NEVER_ROLL)).toBe(false);
  });

  it("refuses a badly mismatched fight even for a bold agent", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, maxHp: 5, hp: 5 }));
    const rival = agent("b", "pidgey", "herd-b", TARGET, { maxHp: 100, hp: 100 });
    world.agents.push(a, rival);

    expect(a.maxHp! / rival.maxHp!).toBeLessThan(HERD_CONFLICT_MIN_POWER_RATIO);
    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("respects an active cooldown — no re-engagement right after one", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, herdConflictCooldownTicks: 10 }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("never faints or kills — hp is clamped at the non-lethal floor no matter how many hits land", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, moves: [{ ...TEST_MOVE, power: 400 }] }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);

    // Repeatedly resolve hits directly (bypassing cooldown/roll gating that
    // would normally space these out) to confirm the floor holds under
    // worst-case repeated damage, not just "one hit happens not to kill."
    for (let i = 0; i < 50; i++) {
      a.herdConflictCooldownTicks = 0;
      a.moveCooldowns = {};
      applyHerdRivalryConflict(world, a, RULES, TARGET, log, ALWAYS_FIGHT);
    }

    expect(rival.alive).not.toBe(false);
    expect(rival.fainted).not.toBe(true);
    const floor = Math.floor(HERD_CONFLICT_HP_FLOOR_FRACTION * rival.maxHp!);
    expect(rival.hp).toBeGreaterThanOrEqual(floor);
  });

  it("a defender that drops to the retreat threshold physically steps away from the contested tile", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, moves: [{ ...TEST_MOVE, power: 200 }] }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);
    setTile(world, "surface", TARGET.x, TARGET.y, "floor");
    setTile(world, "surface", TARGET.x + 1, TARGET.y, "floor");
    setTile(world, "surface", TARGET.x - 1, TARGET.y, "floor");

    const before = { ...rival.pos };
    applyHerdRivalryConflict(world, a, RULES, TARGET, log, ALWAYS_FIGHT);

    const retreatEvent = log.events.find((e) => e.kind === "herdClash" && e.outcome === "retreated");
    expect(retreatEvent).toBeDefined();
    expect(rival.pos).not.toEqual(before);
    expect(rival.herdConflictCooldownTicks).toBeGreaterThan(0);
    expect(a.herdConflictCooldownTicks).toBeGreaterThan(0);
  });
});
