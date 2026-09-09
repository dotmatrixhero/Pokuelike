import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import {
  HERD_CONFLICT_MIN_BLOCKED_TICKS,
  HERD_CONFLICT_MIN_POWER_RATIO,
  MAX_LOCAL_FIGHT_PARTICIPANTS,
  RETALIATION_LEVEL_TOLERANCE,
  applyHerdRivalryConflict,
  applyRivalryRetaliation,
  applyTerritorialGuard,
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
    // Direct ask: "I am not seeing moves being used in 'clash'... better
    // logs please" — herdClash now carries the same real moveId a "fought"
    // event always has.
    const clash = log.events.find((e) => e.kind === "herdClash");
    expect(clash).toMatchObject({ moveId: "shove" });
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

  it("refuses to start a brand-new fight once the local area already has MAX_LOCAL_FIGHT_PARTICIPANTS busy — direct ask: \"6 unit free for alls that get really confusing\"", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);
    // Fill the local area with MAX_LOCAL_FIGHT_PARTICIPANTS bystanders whose
    // own herdConflict hit just landed this exact tick, well within the cap
    // radius — a brand-new pair should be refused even though every other
    // gate (cooldown, power ratio, disposition roll) would otherwise pass.
    for (let i = 0; i < MAX_LOCAL_FIGHT_PARTICIPANTS; i++) {
      const busy = agent(`busy-${i}`, "bulbasaur", `herd-busy-${i}`, { x: 5, y: 5 }, { lastHerdConflictTick: world.tick });
      world.agents.push(busy);
    }

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("does NOT cap a fight already in progress — only starting a brand-new one", () => {
    // Same busy-area setup as above, but this time via applyRivalryRetaliation
    // (a direct continuation, not a new fight) — must still go through.
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = agent("a", "bulbasaur", "herd-a", { x: 5, y: 5 }, { retaliateAgainstId: "b", level: 10 });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 6 }, { level: 12 });
    world.agents.push(a, rival);
    for (let i = 0; i < MAX_LOCAL_FIGHT_PARTICIPANTS; i++) {
      const busy = agent(`busy-${i}`, "bulbasaur", `herd-busy-${i}`, { x: 5, y: 5 }, { lastHerdConflictTick: world.tick });
      world.agents.push(busy);
    }

    expect(applyRivalryRetaliation(world, a, RULES, log, ALWAYS_FIGHT)).toBe(true);
    expect(log.events.some((e) => e.kind === "herdClash")).toBe(true);
  });

  it("a fresh pair's knockout hit faints, not kills, when neither lethal path fires", () => {
    // 0.1 clears the (BOLD, no-grudge) engagement chance and hits at 100%
    // accuracy, but fails HERD_CONFLICT_LETHAL_CHANCE (0.04) — and a brand
    // new pair has no rapport history to clear HERD_CONFLICT_LETHAL_GRUDGE_
    // THRESHOLD either. Since this is a single constant rng, it's returned
    // for every roll the resolution makes, not just the ones named here.
    const rng = () => 0.1;
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, moves: [{ ...TEST_MOVE, power: 400 }] }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, log, rng)).toBe(true);

    expect(rival.hp).toBe(0);
    expect(rival.fainted).toBe(true);
    expect(rival.alive).not.toBe(false);
    expect(log.events.some((e) => e.kind === "fainted" && e.agentId === "b")).toBe(true);
    expect(log.events.some((e) => e.kind === "defeated")).toBe(false);
  });

  it("a small flat chance can make even a FIRST knockout between strangers lethal", () => {
    // 0.01 clears engagement/accuracy the same way, and additionally clears
    // HERD_CONFLICT_LETHAL_CHANCE (0.01 < 0.04) — with a fresh pair's grudge
    // still at 0, this is exclusively the flat-chance path, not the grudge one.
    const rng = () => 0.01;
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, moves: [{ ...TEST_MOVE, power: 400 }] }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, log, rng)).toBe(true);

    expect(rival.alive).toBe(false);
    expect(rival.fainted).not.toBe(true); // a true kill, not a faint-then-recover
    const defeated = log.events.find((e) => e.kind === "defeated");
    expect(defeated).toMatchObject({ winnerId: "a", loserId: "b" });
  });

  it("Notables: a lethal escalation against a herd leader counts toward lifetimeKingslayerKills; an ordinary rival doesn't", () => {
    const rng = () => 0.01; // same flat-chance-lethal roll as the test above
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, moves: [{ ...TEST_MOVE, power: 400 }] }));
    const leaderRival = agent("b", "pidgey", "herd-b", TARGET, { isHerdLeader: true });
    world.agents.push(a, leaderRival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, rng)).toBe(true);

    expect(leaderRival.alive).toBe(false);
    expect(a.lifetimeKingslayerKills).toBe(1);
  });

  it("a deep, pre-existing grudge makes the next knockout lethal even when the flat chance fails", () => {
    // Same 0.1 as the "faints, not kills" test above — the ONLY difference
    // here is the attacker's own real grudge toward this specific rival,
    // set deep enough to clear HERD_CONFLICT_LETHAL_GRUDGE_THRESHOLD.
    const rng = () => 0.1;
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, moves: [{ ...TEST_MOVE, power: 400 }] }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    a.rapport = { b: { score: -0.9, lastInteractionTick: 0 } };
    world.agents.push(a, rival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, log, rng)).toBe(true);

    expect(rival.alive).toBe(false);
    const defeated = log.events.find((e) => e.kind === "defeated");
    expect(defeated).toMatchObject({ winnerId: "a", loserId: "b" });
  });

  it("a defender that drops to the retreat threshold physically steps away from the contested tile", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    // 120, not 200 — ALWAYS_FIGHT's rng()=0 always crits (0 < 1/24) on top of
    // minimum damage variance, so a much higher power would knock the
    // defender all the way to 0 hp (a genuine knockout) instead of merely
    // crossing the retreat threshold, which is what this test means to show.
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, moves: [{ ...TEST_MOVE, power: 120 }] }));
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

  it("a `nonTerritorial` agent never initiates, even bold/aggressive and comparably matched", () => {
    const world = createWorld(20, 20);
    const a = bumpedUp(agent("a", "snorlax", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, passives: { nonTerritorial: 1 } }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(a, rival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("a `nonTerritorial` agent can still be found and fought as someone else's rival", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    const peaceful = agent("a", "snorlax", "herd-a", TARGET, { passives: { nonTerritorial: 1 } });
    const b = bumpedUp(agent("b", "pidgey", "herd-b", { x: 4, y: 5 }, { disposition: BOLD }));
    world.agents.push(peaceful, b);

    expect(applyHerdRivalryConflict(world, b, RULES, TARGET, log, ALWAYS_FIGHT)).toBe(true);
  });

  /** One standoff with a bystander holding `calmingPresence: calm`, resolved against a fixed roll. */
  const standoffWithCalmer = (calm: number, roll: number): boolean => {
    const world = createWorld(20, 20);
    // Snorlax isn't a party to this standoff at all — just standing nearby.
    const snorlax = agent("snorlax-0", "snorlax", "herd-c", { x: 5, y: 6 }, { passives: { calmingPresence: calm } });
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(snorlax, a, rival);
    return applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, () => roll);
  };

  it("`calmingPresence` dampens a nearby THIRD agent's own escalation chance, regardless of herd", () => {
    // A calmer makes the standoff strictly less likely to escalate: there is
    // a roll that fights without one and backs down with one. Asserted by
    // sweep rather than against a hardcoded chance, so retuning the base
    // constants can't quietly make this vacuous.
    const rolls = Array.from({ length: 200 }, (_, i) => i / 200);
    const uncalmed = rolls.filter((r) => standoffWithCalmer(0, r)).length;
    const calmed = rolls.filter((r) => standoffWithCalmer(1, r)).length;
    expect(calmed).toBeLessThan(uncalmed);
  });

  it("`calmingPresence` can never switch herd conflict off — MIN_CALMING_MULTIPLIER floors it at half", () => {
    // The regression this exists for: the multiplier used to be
    // `max(0, 1 - total)`, and a total summed across a whole movepool. Six
    // species could reach 1.50, so a bystander standing there meant no herd
    // fight ever happened in a radius, to either side. A roll of 0 clears
    // every unmodified chance in this suite, and must still clear a halved
    // one.
    expect(standoffWithCalmer(5, 0)).toBe(true);

    // And the floor really is a floor: past 0.5 of calm, more calm buys
    // nothing at all. Identical outcomes across the whole sweep.
    const rolls = Array.from({ length: 200 }, (_, i) => i / 200);
    const atFloor = rolls.map((r) => standoffWithCalmer(0.5, r));
    const wayPastFloor = rolls.map((r) => standoffWithCalmer(5, r));
    expect(wayPastFloor).toEqual(atFloor);

    // Control: BELOW the floor, calm still does something — otherwise the
    // two assertions above would also pass on a passive that was simply inert.
    const belowFloor = rolls.filter((r) => standoffWithCalmer(0.25, r)).length;
    expect(belowFloor).toBeGreaterThan(atFloor.filter(Boolean).length);
  });

  it("`calmingPresence` has no effect beyond its radius", () => {
    const world = createWorld(20, 20);
    const snorlax = agent("snorlax-0", "snorlax", "herd-c", { x: 19, y: 19 }, { passives: { calmingPresence: 1 } });
    const a = bumpedUp(agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD }));
    const rival = agent("b", "pidgey", "herd-b", TARGET);
    world.agents.push(snorlax, a, rival);

    expect(applyHerdRivalryConflict(world, a, RULES, TARGET, undefined, ALWAYS_FIGHT)).toBe(true);
  });
});

describe("applyTerritorialGuard (proactive patrol/chase-off, CROPS_DESIGN.md-style direct ask: \"more territorial behavior... guarding resources\")", () => {
  function withResources(world: ReturnType<typeof createWorld>, pos: { x: number; y: number }): void {
    // Two real water tiles near the rival — territoryAbundanceAt sums food
    // stock + water-tile count, so this alone clears SCARCITY_SCORE_THRESHOLD
    // (1.5) without needing to fuss with partial food stock values.
    setTile(world, "surface", pos.x, pos.y, "water");
    setTile(world, "surface", pos.x + 1, pos.y, "water");
  }

  it("does nothing when no rival is nearby", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD });
    world.agents.push(a);
    withResources(world, { x: 4, y: 5 });

    expect(applyTerritorialGuard(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("does nothing when the nearby agent is the same herd", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD });
    const mate = agent("b", "bulbasaur", "herd-a", { x: 5, y: 5 });
    world.agents.push(a, mate);
    withResources(world, mate.pos);

    expect(applyTerritorialGuard(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("does nothing when either side is a predator species (out of scope)", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "scyther", "herd-a", { x: 4, y: 5 }, { disposition: BOLD });
    const rival = agent("b", "bulbasaur", "herd-b", { x: 5, y: 5 });
    world.agents.push(a, rival);
    withResources(world, rival.pos);

    expect(applyTerritorialGuard(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("does nothing when there's nothing worth guarding nearby (no real food/water)", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 5 });
    world.agents.push(a, rival);
    // No setTile calls — bare world, nothing worth fighting over.

    expect(applyTerritorialGuard(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("a bold, confident agent chases (or engages) a real cross-species rival near real resources", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 5 });
    world.agents.push(a, rival);
    withResources(world, rival.pos);

    const engaged = applyTerritorialGuard(world, a, RULES, log, ALWAYS_FIGHT);

    expect(engaged).toBe(true);
    expect(a.behavior).toBe("fight");
    expect(a.fightTarget).toBe(rival.id);
  });

  it("a badly outmatched agent doesn't engage — same confidence gate as the reactive trigger", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, maxHp: 10, hp: 10 });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 5 }, { maxHp: 100, hp: 100 });
    world.agents.push(a, rival);
    withResources(world, rival.pos);

    expect(applyTerritorialGuard(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("a timid agent's disposition gate holds even with resources and a beatable rival present", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: TIMID, needs: createNeeds() });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 5 });
    world.agents.push(a, rival);
    withResources(world, rival.pos);

    expect(applyTerritorialGuard(world, a, RULES, undefined, NEVER_ROLL)).toBe(false);
  });

  it("a bonded/high-rapport rival is tolerated — no fight — while resources are plentiful", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 5 });
    world.agents.push(a, rival);
    // Plentiful resources (well above the "comfortable" ceiling) plus a real
    // positive rapport score — both required for the tolerance exemption to
    // actually hold at this abundance level.
    setTile(world, "surface", rival.pos.x, rival.pos.y, "water");
    setTile(world, "surface", rival.pos.x + 1, rival.pos.y, "water");
    setTile(world, "surface", rival.pos.x - 1, rival.pos.y, "water");
    setTile(world, "surface", rival.pos.x, rival.pos.y + 1, "water");
    setTile(world, "surface", rival.pos.x, rival.pos.y - 1, "water");
    a.rapport = { b: { score: 0.9, lastInteractionTick: 0 } };

    expect(applyTerritorialGuard(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("a hungry agent is a more willing invader than a well-fed one — need urgency raises the trigger chance", () => {
    // Rig rng to land strictly between the well-fed chance and the hungry
    // chance so only the hungry agent's roll succeeds.
    const wellFed = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, needs: createNeeds({ hunger: 1, thirst: 1 }) });
    const hungry = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, needs: createNeeds({ hunger: 0, thirst: 1 }) });
    const rivalFor = (id: string) => agent(id, "pidgey", "herd-b", { x: 5, y: 5 });

    function tryEngage(actor: Agent, rng: () => number): boolean {
      const world = createWorld(20, 20);
      const rival = rivalFor("b");
      world.agents.push(actor, rival);
      withResources(world, rival.pos);
      return applyTerritorialGuard(world, actor, RULES, undefined, rng);
    }

    // A roll that clears BOLD's own disposition-only chance (0.015 + 1.0 *
    // 0.4 = 0.415) but not the extra hunger-urgency bonus on top of it
    // (+1.0 * 0.4 = 0.815 for a maximally hungry agent) — the hungry agent
    // should still engage where the well-fed one doesn't.
    const rng = () => 0.6;
    expect(tryEngage(wellFed, rng)).toBe(false);
    expect(tryEngage(hungry, rng)).toBe(true);
  });

  it("respects the shared herdConflictCooldownTicks — no engagement while on cooldown", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { disposition: BOLD, herdConflictCooldownTicks: 10 });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 5 });
    world.agents.push(a, rival);
    withResources(world, rival.pos);

    expect(applyTerritorialGuard(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });
});

describe("applyRivalryRetaliation (direct ask: \"there isn't any fighting back, is there?\")", () => {
  it("does nothing when there's no pending retaliation flag", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 });
    world.agents.push(a);

    expect(applyRivalryRetaliation(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("a comparable-level target gets hit right back, and the flag is consumed", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = agent("a", "bulbasaur", "herd-a", { x: 5, y: 5 }, { retaliateAgainstId: "b", level: 10 });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 6 }, { level: 12 }); // within +/-5
    world.agents.push(a, rival);

    const engaged = applyRivalryRetaliation(world, a, RULES, log, ALWAYS_FIGHT);

    expect(engaged).toBe(true);
    expect(a.retaliateAgainstId).toBeUndefined();
    expect(log.events.some((e) => e.kind === "herdClash" && e.attackerId === "a" && e.defenderId === "b")).toBe(true);
  });

  it("backs away instead of retaliating against a much stronger (level) foe", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = agent("a", "bulbasaur", "herd-a", { x: 5, y: 5 }, { retaliateAgainstId: "b", level: 5 });
    const strongRival = agent("b", "pidgey", "herd-b", { x: 5, y: 6 }, { level: 5 + RETALIATION_LEVEL_TOLERANCE + 1 });
    world.agents.push(a, strongRival);

    const before = { ...a.pos };
    const engaged = applyRivalryRetaliation(world, a, RULES, log, ALWAYS_FIGHT);

    expect(engaged).toBe(true); // the tick was spent backing away, not a no-op
    expect(a.pos).not.toEqual(before);
    expect(a.herdConflictCooldownTicks).toBeGreaterThan(0);
    expect(log.events.some((e) => e.kind === "herdClash")).toBe(false); // no attack was actually made
  });

  it("still retaliates against a foe within the level tolerance, right at the boundary", () => {
    const world = createWorld(20, 20);
    const log = new EventLog();
    const a = agent("a", "bulbasaur", "herd-a", { x: 5, y: 5 }, { retaliateAgainstId: "b", level: 5 });
    const boundaryRival = agent("b", "pidgey", "herd-b", { x: 5, y: 6 }, { level: 5 + RETALIATION_LEVEL_TOLERANCE });
    world.agents.push(a, boundaryRival);

    expect(applyRivalryRetaliation(world, a, RULES, log, ALWAYS_FIGHT)).toBe(true);
    expect(log.events.some((e) => e.kind === "herdClash")).toBe(true);
  });

  it("does nothing (but still consumes the flag) when the target is gone/fainted", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 4, y: 5 }, { retaliateAgainstId: "ghost" });
    world.agents.push(a);

    expect(applyRivalryRetaliation(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
    expect(a.retaliateAgainstId).toBeUndefined();
  });

  it("does nothing when either side is a predator species (out of scope)", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "scyther", "herd-a", { x: 5, y: 5 }, { retaliateAgainstId: "b", level: 10 });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 6 }, { level: 10 });
    world.agents.push(a, rival);

    expect(applyRivalryRetaliation(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("respects the shared herdConflictCooldownTicks — no retaliation while on cooldown", () => {
    const world = createWorld(20, 20);
    const a = agent("a", "bulbasaur", "herd-a", { x: 5, y: 5 }, { retaliateAgainstId: "b", level: 10, herdConflictCooldownTicks: 10 });
    const rival = agent("b", "pidgey", "herd-b", { x: 5, y: 6 }, { level: 10 });
    world.agents.push(a, rival);

    expect(applyRivalryRetaliation(world, a, RULES, undefined, ALWAYS_FIGHT)).toBe(false);
  });

  it("resolveRivalryHit sets retaliateAgainstId on a real hit, but not on a retreat or a miss", () => {
    // Real hit, defender still standing — should carry the flag forward.
    // Same default 40/40 hp fixture the "comparably-matched agent fights"
    // test above already confirms takes real-but-partial damage from one
    // hit at this power (well short of the 60% retreat threshold).
    const hitWorld = createWorld(20, 20);
    const attacker = agent("atk", "bulbasaur", "herd-a", { x: 5, y: 5 });
    const defender = agent("def", "pidgey", "herd-b", { x: 5, y: 6 });
    hitWorld.agents.push(attacker, defender);
    applyHerdRivalryConflict(hitWorld, bumpedUp(attacker), RULES, defender.pos, undefined, ALWAYS_FIGHT);
    expect(defender.retaliateAgainstId).toBe("atk");

    // A hit that crosses the retreat threshold — the defender is backing off, not retaliating.
    const retreatWorld = createWorld(20, 20);
    const bigAttacker = agent("atk2", "bulbasaur", "herd-a", { x: 5, y: 5 }, { moves: [{ ...TEST_MOVE, power: 200 }] });
    const weakDefender = agent("def2", "pidgey", "herd-b", { x: 5, y: 6 });
    retreatWorld.agents.push(bigAttacker, weakDefender);
    applyHerdRivalryConflict(retreatWorld, bumpedUp(bigAttacker), RULES, weakDefender.pos, undefined, ALWAYS_FIGHT);
    expect(weakDefender.retaliateAgainstId).toBeUndefined();
  });
});
