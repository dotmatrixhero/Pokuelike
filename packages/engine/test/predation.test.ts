import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { applyPredationInstincts } from "../src/predation.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";
import type { Disposition } from "../src/nature.js";
import { DAY_LENGTH_TICKS } from "../src/daynight.js";

const RULES: HuntRules = { scyther: true };
const MIDNIGHT = 0;
const NOON = DAY_LENGTH_TICKS / 2;

// No types/stats set on the fixtures below, deliberately: that keeps these
// tests on predation.ts's FALLBACK_DAMAGE (1 per hit) path, so they're testing
// flee/fight/hunt/relocate *behavior*, not the damage formula (see combat.test.ts
// for that). A move is still required or pickBestMove finds nothing to swing.
// `maxHp` IS set explicitly on each factory below, though — predation eligibility
// is now power-based (see predation.ts's isPreyOf/PREY_POWER_RATIO), so prey/
// predator/guardian need a real, deliberate power gap between them or nothing
// would ever qualify as prey of anything.
const TEST_MOVE: MoveSpec = {
  id: "test-move",
  name: "Test Move",
  shape: { kind: "point" },
  type: "normal",
  category: "physical",
  power: 40,
  accuracy: 100,
  cooldownTicks: 0,
};

const RANGED_MOVE: MoveSpec = {
  id: "ranged-move",
  name: "Ranged Move",
  shape: { kind: "line", length: 2 },
  type: "normal",
  category: "physical",
  power: 40,
  accuracy: 100,
  cooldownTicks: 0,
};

function guardian(pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "venusaur-0",
    species: "venusaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    moves: [TEST_MOVE],
    maxHp: 50, // well above any predator() default * PREY_POWER_RATIO — never eligible prey
    ...overrides,
  };
}

function prey(pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "bulbasaur-0",
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    moves: [TEST_MOVE],
    maxHp: 10, // FALLBACK_MAX_HP — small enough for predator()'s default to treat as prey
    ...overrides,
  };
}

function predator(pos: { x: number; y: number }, hunger = 0.3, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "scyther-0",
    species: "scyther",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ hunger }),
    behavior: "idle",
    moves: [TEST_MOVE],
    maxHp: 20, // comfortably above prey()'s default(10) / PREY_POWER_RATIO(0.75) = 13.3
    ...overrides,
  };
}

describe("predation", () => {
  it("prey flees a nearby predator instead of pursuing its own needs", () => {
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 });
    world.agents.push(target, predator({ x: 6, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(target.behavior).toBe("flee");
    expect(target.pos.x).toBeLessThan(5);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "behaviorChanged", agentId: "bulbasaur-0", to: "flee" })
    );
  });

  it("a hungry predator hunts and closes distance on nearby prey", () => {
    const world = createWorld(10, 10);
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 8, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).toBe("hunt");
    expect(hunter.pos.x).toBeLessThan(8);
  });

  it("a lethal hit faints prey rather than killing it outright, and a follow-up hit finishes it off", () => {
    const world = createWorld(10, 10);
    // Predator ticks first so it strikes before the prey has a chance to flee this tick.
    // Prey hp set to 1 so a single fallback-damage hit (1) would have been fatal under
    // the old instant-death model — now it only faints (see predation.ts/support.ts).
    world.agents.push(predator({ x: 5, y: 6 }, 0.1), prey({ x: 5, y: 5 }, { hp: 1, maxHp: 1 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    // Still alive (fainted, not dead) — the corpse-pruning length assertion below
    // would have caught an instant-death regression.
    expect(world.agents).toHaveLength(2);
    const fainted = world.agents.find((a) => a.id === "bulbasaur-0")!;
    expect(fainted.alive).not.toBe(false);
    expect(fainted.fainted).toBe(true);
    expect(fainted.finishingPool).toBeCloseTo(0.75); // FINISHING_POOL_FRACTION * maxHp(1)
    const huntingPredator = world.agents.find((a) => a.id === "scyther-0")!;
    expect(huntingPredator.needs.hunger).toBeLessThan(0.5); // no meal yet — not truly dead
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "fainted", agentId: "bulbasaur-0" }));
    expect(log.events).not.toContainEqual(expect.objectContaining({ kind: "killed" }));

    // Second hit exhausts the 0.75 finishing pool (1 fallback damage > 0.75 remaining) — true death now.
    tickWorld(world, log, RULES);

    const corpse = world.agents.find((a) => a.id === "bulbasaur-0")!;
    expect(corpse.alive).toBe(false); // truly dead, but NOT pruned this same tick (corpse persistence)
    const fedPredator = world.agents.find((a) => a.id === "scyther-0")!;
    expect(fedPredator.needs.hunger).toBeGreaterThan(0.5); // hunger only restores on the true-death hit
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "killed", predatorId: "scyther-0", preyId: "bulbasaur-0" })
    );
  });

  it("a satisfied predator ignores nearby prey", () => {
    const world = createWorld(10, 10);
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 6, y: 5 }, 0.9));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).not.toBe("hunt");
  });

  it("without rules, agents behave exactly as before predation existed", () => {
    const world = createWorld(10, 10);
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 6, y: 5 }, 0.1));

    tickWorld(world);

    expect(world.agents).toHaveLength(2);
  });
});

describe("dynamic (size-based) predation — not a fixed species list", () => {
  it("a predator hunts a species that was never in any fixed prey list, purely because it's small enough", () => {
    // "spearow probably goes for bulbasaurs too" — a hunter species isn't
    // limited to a hardcoded menu; anything sufficiently smaller/weaker
    // nearby is fair game. "charmander" here stands in for any species this
    // predator was never explicitly paired with in HUNT_RULES/data.
    const world = createWorld(10, 10);
    const smallStranger = prey({ x: 5, y: 5 }, { id: "charmander-0", species: "charmander", maxHp: 8 });
    world.agents.push(smallStranger, predator({ x: 8, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).toBe("hunt");
    expect(hunter.huntTarget).toBe("charmander-0");
  });

  it("a predator does NOT hunt something too close to its own size, even of a species it usually preys on", () => {
    const world = createWorld(10, 10);
    // maxHp 18 is above predator()'s 20 * PREY_POWER_RATIO (0.75) = 15 — too big to be worth it.
    const tooBig = prey({ x: 5, y: 5 }, { maxHp: 18 });
    world.agents.push(tooBig, predator({ x: 8, y: 5 }));

    tickWorld(world, undefined, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).not.toBe("hunt");
  });

  it("same species is never prey, regardless of a power gap", () => {
    const world = createWorld(10, 10);
    // A second, much weaker scyther — same species as the hungry predator, well within
    // the power ratio that would make anything else fair game.
    const weakerKin = predator({ x: 5, y: 5 }, 1, { id: "scyther-1", maxHp: 5 });
    world.agents.push(weakerKin, predator({ x: 8, y: 5 }));

    tickWorld(world, undefined, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).not.toBe("hunt");
  });

  it("a target grown too big (e.g. leveled up) stops being prey to a predator that used to be able to eat it", () => {
    const world = createWorld(10, 10);
    const grownUp = prey({ x: 5, y: 5 }, { maxHp: 10 }); // eligible prey at this size
    const hunter = predator({ x: 8, y: 5 });
    world.agents.push(grownUp, hunter);

    tickWorld(world, undefined, RULES);
    expect(world.agents.find((a) => a.id === "scyther-0")!.behavior).toBe("hunt");

    // It grows past the predator's threshold — no longer worth hunting.
    grownUp.maxHp = 18;
    hunter.behavior = "idle";
    hunter.huntTarget = undefined;

    tickWorld(world, undefined, RULES);
    expect(world.agents.find((a) => a.id === "scyther-0")!.behavior).not.toBe("hunt");
  });
});

describe("storm accuracy penalty composes into a real fight (Phase 3 weather)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a roll that would hit in clear weather misses the same fight inside an active storm", () => {
    // TEST_MOVE has 100 accuracy: with no storm, chance is 100 and 0.7*100=70
    // always hits (70 < 100). Under a storm, weather.ts's
    // STORM_ACCURACY_MULTIPLIER (0.6) drops the chance to 60, and that same
    // roll (70 >= 60) now misses — a real, measurable behavior change, not
    // just a smaller number nothing reads.
    vi.spyOn(Math, "random").mockReturnValue(0.7);

    const clearWorld = createWorld(10, 10);
    clearWorld.agents.push(
      prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" }),
      prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" }),
      prey({ x: 6, y: 5 }, { id: "bulbasaur-2", herdId: "herd-a" }),
      predator({ x: 5, y: 6 })
    );
    const clearLog = new EventLog();
    tickWorld(clearWorld, clearLog, RULES);
    expect(clearLog.events).toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0" }));

    const stormWorld = createWorld(10, 10);
    stormWorld.weatherCells = [
      { id: "s", type: "storm", center: { x: 5, y: 5 }, radius: 5, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } },
    ];
    stormWorld.agents.push(
      prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" }),
      prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" }),
      prey({ x: 6, y: 5 }, { id: "bulbasaur-2", herdId: "herd-a" }),
      predator({ x: 5, y: 6 })
    );
    const stormLog = new EventLog();
    tickWorld(stormWorld, stormLog, RULES);
    expect(stormLog.events).not.toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0" }));
    expect(stormLog.events).toContainEqual(expect.objectContaining({ kind: "missed", attackerId: "bulbasaur-0" }));
  });
});

describe("mob-fighting", () => {
  it("a large enough, close enough herd mobs the predator instead of fleeing", () => {
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" });
    const mobber2 = prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" });
    const mobber3 = prey({ x: 6, y: 5 }, { id: "bulbasaur-2", herdId: "herd-a" });
    world.agents.push(mobber1, mobber2, mobber3, predator({ x: 5, y: 6 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    // mobber1 is adjacent (distance 1) and lands a fallback-damage (1) hit;
    // the predator()'s explicit maxHp default (see the factory) is 20.
    expect(mobber1.behavior).toBe("fight");
    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.hp).toBe(19);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0", defenderHpRemaining: 19 })
    );
  });

  it("a mob of 3+ can finish off a fainted predator within the same tick (faint, then a follow-up hit exhausts the pool)", () => {
    const world = createWorld(10, 10);
    const mobbers = [
      prey({ x: 4, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" }),
      prey({ x: 6, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" }),
      prey({ x: 5, y: 4 }, { id: "bulbasaur-2", herdId: "herd-a" }),
    ];
    // hp/maxHp set to 1: the first fallback-damage (1) hit faints it (finishingPool
    // becomes 0.75*1 = 0.75), and the second mobber's hit that same tick (1 damage)
    // exceeds the remaining pool — a real multi-hit finishing blow, not one big hit.
    world.agents.push(...mobbers, predator({ x: 5, y: 5 }, 0.3, { hp: 1, maxHp: 1 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(log.events).toContainEqual(expect.objectContaining({ kind: "fainted", agentId: "scyther-0" }));
    const corpse = world.agents.find((a) => a.id === "scyther-0")!;
    expect(corpse.alive).toBe(false); // truly dead this same tick, but corpse persists (not pruned yet)
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "defeated", loserId: "scyther-0", winnerSpecies: "bulbasaur" })
    );
  });

  it("regression: a lone agent doesn't mob alone just because its herd is big somewhere nearby", () => {
    // This is the exact tick-97 bug from the 1000-tick run: bulbasaur-0 is right on
    // top of the predator, but its herd-mates are still several tiles away (mid-flee),
    // not actually in striking distance. It must flee, not fight alone and die.
    const world = createWorld(20, 20);
    const solo = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" });
    const farAlly1 = prey({ x: 12, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" });
    const farAlly2 = prey({ x: 13, y: 5 }, { id: "bulbasaur-2", herdId: "herd-a" });
    world.agents.push(solo, farAlly1, farAlly2, predator({ x: 5, y: 6 }));

    tickWorld(world, undefined, RULES);

    expect(solo.behavior).toBe("flee");
  });

  it("a lone or small group still flees rather than fights", () => {
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" });
    const mobber2 = prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" });
    world.agents.push(mobber1, mobber2, predator({ x: 5, y: 6 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(mobber1.behavior).toBe("flee");
  });

  it("a predator avoids hunting prey protected by a large enough herd", () => {
    const world = createWorld(10, 10);
    const hungry = predator({ x: 10, y: 5 }, 0.1);
    const group = [0, 1, 2].map((i) => prey({ x: 5 + i, y: 5 }, { id: `bulbasaur-${i}`, herdId: "herd-a" }));
    world.agents.push(hungry, ...group);

    tickWorld(world, undefined, RULES);

    expect(hungry.behavior).not.toBe("hunt");
    expect(hungry.ticksSinceMeal).toBe(1);
  });

  it("a critically hurt predator flees a fight instead of continuing to hunt", () => {
    const world = createWorld(10, 10);
    const attacker = prey({ x: 6, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a", behavior: "fight", fightTarget: "scyther-0" });
    const hurt = predator({ x: 5, y: 5 });
    hurt.hp = 1;
    hurt.maxHp = 3;
    world.agents.push(attacker, hurt);
    const log = new EventLog();

    const handled = applyPredationInstincts(world, hurt, RULES, log);

    expect(handled).toBe(true);
    expect(hurt.behavior).toBe("flee");
    expect(hurt.pos.x).toBeLessThan(5); // away from the attacker at x=6
  });

  it("a predator that can't find safe prey for long enough relocates instead of camping", () => {
    const world = createWorld(30, 30);
    const hungry = predator({ x: 15, y: 15 }, 0.1);
    hungry.ticksSinceMeal = 149;
    world.agents.push(hungry);
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(hungry.behavior).toBe("relocate");
    expect(hungry.relocateTarget).toBeDefined();
  });
});

describe("ranged attacks", () => {
  it("a move with real reach (e.g. Vine Whip) can hit without closing to melee", () => {
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 3 }, { id: "bulbasaur-0", herdId: "herd-a", moves: [RANGED_MOVE] });
    const mobber2 = prey({ x: 4, y: 4 }, { id: "bulbasaur-1", herdId: "herd-a", moves: [RANGED_MOVE] });
    const mobber3 = prey({ x: 6, y: 4 }, { id: "bulbasaur-2", herdId: "herd-a", moves: [RANGED_MOVE] });
    // predator at (5,5): mobber1 is exactly 2 tiles away (Ranged Move's reach), mobber2/3 are 2 away too (mob-eligible).
    world.agents.push(mobber1, mobber2, mobber3, predator({ x: 5, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(mobber1.pos).toEqual({ x: 5, y: 3 }); // didn't move — attacked from range instead
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0" }));
  });

  it("a melee-only move still requires closing to distance 1", () => {
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 3 }, { id: "bulbasaur-0", herdId: "herd-a" }); // TEST_MOVE default: melee only
    const mobber2 = prey({ x: 4, y: 4 }, { id: "bulbasaur-1", herdId: "herd-a" });
    const mobber3 = prey({ x: 6, y: 4 }, { id: "bulbasaur-2", herdId: "herd-a" });
    world.agents.push(mobber1, mobber2, mobber3, predator({ x: 5, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(mobber1.pos).not.toEqual({ x: 5, y: 3 }); // stepped closer instead of attacking
    expect(log.events).not.toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0" }));
  });
});

describe("disposition wiring", () => {
  const TIMID: Disposition = { boldness: 0, aggression: 0.5, sociability: 0.5 };
  const BOLD: Disposition = { boldness: 1, aggression: 0.5, sociability: 0.5 };

  it("a timid prey flees a predator at a distance a neutral prey would ignore", () => {
    const world = createWorld(20, 20);
    // Distance 5 — beyond the neutral FLEE_DETECT_RADIUS (4), within a timid agent's expanded radius.
    const target = prey({ x: 5, y: 5 }, { disposition: TIMID });
    world.agents.push(target, predator({ x: 10, y: 5 }));

    tickWorld(world, undefined, RULES);

    expect(target.behavior).toBe("flee");
  });

  it("a neutral (no disposition) prey does NOT react to that same distant predator", () => {
    const world = createWorld(20, 20);
    const target = prey({ x: 5, y: 5 });
    world.agents.push(target, predator({ x: 10, y: 5 }));

    tickWorld(world, undefined, RULES);

    expect(target.behavior).not.toBe("flee");
  });

  it("a bold prey tolerates a closer predator that a neutral prey would flee from", () => {
    const world = createWorld(20, 20);
    // Distance 3 — within the neutral FLEE_DETECT_RADIUS (4), but beyond a bold agent's shrunk radius.
    const target = prey({ x: 5, y: 5 }, { disposition: BOLD });
    world.agents.push(target, predator({ x: 8, y: 5 }));

    tickWorld(world, undefined, RULES);

    expect(target.behavior).not.toBe("flee");
  });

  it("a bold prey still flees a predator that is genuinely close (hard floor holds)", () => {
    const world = createWorld(20, 20);
    const target = prey({ x: 5, y: 5 }, { disposition: BOLD });
    world.agents.push(target, predator({ x: 6, y: 5 })); // distance 1
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(target.behavior).toBe("flee");
  });

  it("a bold+aggressive pair mobs a threat that a neutral pair of the same size would flee from", () => {
    const boldAndAggressive: Disposition = { boldness: 1, aggression: 1, sociability: 0.5 };
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a", disposition: boldAndAggressive });
    const mobber2 = prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a", disposition: boldAndAggressive });
    world.agents.push(mobber1, mobber2, predator({ x: 5, y: 6 }));

    tickWorld(world, undefined, RULES);

    // With only 2 herd-mates in range, the default (neutral) threshold of 3 would flee
    // (see "a lone or small group still flees rather than fights" above) — bold+aggressive
    // lowers the effective threshold enough to commit instead.
    expect(mobber1.behavior).toBe("fight");
  });

  it("a timid pair flees rather than mobs even where a neutral trio would fight", () => {
    const timid: Disposition = { boldness: 0, aggression: 0, sociability: 0.5 };
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a", disposition: timid });
    const mobber2 = prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a", disposition: timid });
    const mobber3 = prey({ x: 6, y: 5 }, { id: "bulbasaur-2", herdId: "herd-a", disposition: timid });
    world.agents.push(mobber1, mobber2, mobber3, predator({ x: 5, y: 6 }));

    tickWorld(world, undefined, RULES);

    // 3 herd-mates would meet the neutral MOB_THRESHOLD (see the "large enough herd" test
    // above), but timid+passive raises the effective threshold enough that it isn't met.
    expect(mobber1.behavior).toBe("flee");
  });

  it("an aggressive predator hunts at a hunger level a neutral predator would ignore", () => {
    const aggressive: Disposition = { boldness: 0.5, aggression: 1, sociability: 0.5 };
    const world = createWorld(10, 10);
    // hunger 0.7 is above the neutral HUNT_HUNGER_THRESHOLD (0.6) — a neutral predator
    // wouldn't hunt (see "a satisfied predator ignores nearby prey" above), but an
    // aggressive one's raised threshold (0.8) still triggers it.
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 8, y: 5 }, 0.7, { disposition: aggressive }));

    tickWorld(world, undefined, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).toBe("hunt");
  });

  it("a passive predator waits longer than a neutral predator to hunt", () => {
    const passive: Disposition = { boldness: 0.5, aggression: 0, sociability: 0.5 };
    const world = createWorld(10, 10);
    // hunger 0.5 is below the neutral threshold (0.6, would normally hunt) but above
    // the passive predator's lowered threshold (0.4).
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 8, y: 5 }, 0.5, { disposition: passive }));

    tickWorld(world, undefined, RULES);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).not.toBe("hunt");
  });
});

describe("nocturnal/diurnal hunt-eagerness (see DESIGN.md's day/night Phase 2)", () => {
  it("a nocturnal predator hunts at night at a hunger level a cathemeral predator would ignore", () => {
    const world = createWorld(10, 10);
    world.tick = MIDNIGHT;
    const nocturnalHunter = predator({ x: 8, y: 5 }, 0.65, { activityPattern: "nocturnal" });
    world.agents.push(prey({ x: 5, y: 5 }), nocturnalHunter);

    applyPredationInstincts(world, nocturnalHunter, RULES);

    expect(nocturnalHunter.behavior).toBe("hunt");

    // Same hunger, same tick, no activityPattern set — the baseline (unshifted) case.
    const world2 = createWorld(10, 10);
    world2.tick = MIDNIGHT;
    const cathemeralHunter = predator({ x: 8, y: 5 }, 0.65);
    world2.agents.push(prey({ x: 5, y: 5 }), cathemeralHunter);

    applyPredationInstincts(world2, cathemeralHunter, RULES);

    expect(cathemeralHunter.behavior).not.toBe("hunt");
  });

  it("that same nocturnal predator is LESS eager by day than a cathemeral predator at the same hunger", () => {
    const world = createWorld(10, 10);
    world.tick = NOON;
    const nocturnalHunter = predator({ x: 8, y: 5 }, 0.65, { activityPattern: "nocturnal" });
    world.agents.push(prey({ x: 5, y: 5 }), nocturnalHunter);

    applyPredationInstincts(world, nocturnalHunter, RULES);

    expect(nocturnalHunter.behavior).not.toBe("hunt");
  });

  it("a diurnal predator is the exact mirror: eager by day, less eager at night", () => {
    const dayWorld = createWorld(10, 10);
    dayWorld.tick = NOON;
    const dayHunter = predator({ x: 8, y: 5 }, 0.7, { activityPattern: "diurnal" });
    dayWorld.agents.push(prey({ x: 5, y: 5 }), dayHunter);
    applyPredationInstincts(dayWorld, dayHunter, RULES);
    expect(dayHunter.behavior).toBe("hunt");

    const nightWorld = createWorld(10, 10);
    nightWorld.tick = MIDNIGHT;
    const nightHunter = predator({ x: 8, y: 5 }, 0.7, { activityPattern: "diurnal" });
    nightWorld.agents.push(prey({ x: 5, y: 5 }), nightHunter);
    applyPredationInstincts(nightWorld, nightHunter, RULES);
    expect(nightHunter.behavior).not.toBe("hunt");
  });

  it("composes with the existing aggression-based shift rather than replacing it — both stack", () => {
    // Neutral aggression, nocturnal, at night: threshold 0.6 + 0.15 (activity) = 0.75.
    const world = createWorld(10, 10);
    world.tick = MIDNIGHT;
    const neutralNocturnal = predator({ x: 8, y: 5 }, 0.72, { activityPattern: "nocturnal" });
    world.agents.push(prey({ x: 5, y: 5 }), neutralNocturnal);
    applyPredationInstincts(world, neutralNocturnal, RULES);
    expect(neutralNocturnal.behavior).toBe("hunt"); // 0.72 < 0.75

    // Aggressive AND nocturnal, at night: threshold 0.6 + 0.2 (aggression) + 0.15 (activity) = 0.95 —
    // hunts at a hunger level neither shift alone would cover.
    const aggressive: Disposition = { boldness: 0.5, aggression: 1, sociability: 0.5 };
    const world2 = createWorld(10, 10);
    world2.tick = MIDNIGHT;
    const aggressiveNocturnal = predator({ x: 8, y: 5 }, 0.9, { activityPattern: "nocturnal", disposition: aggressive });
    world2.agents.push(prey({ x: 5, y: 5 }), aggressiveNocturnal);
    applyPredationInstincts(world2, aggressiveNocturnal, RULES);
    expect(aggressiveNocturnal.behavior).toBe("hunt"); // 0.9 < 0.95, but not < 0.75 (activity alone) or < 0.8 (aggression alone)

    // Aggression alone (no activityPattern) does NOT reach 0.9 hunger.
    const world3 = createWorld(10, 10);
    world3.tick = MIDNIGHT;
    const aggressiveOnly = predator({ x: 8, y: 5 }, 0.9, { disposition: aggressive });
    world3.agents.push(prey({ x: 5, y: 5 }), aggressiveOnly);
    applyPredationInstincts(world3, aggressiveOnly, RULES);
    expect(aggressiveOnly.behavior).not.toBe("hunt");
  });
});

describe("guardians", () => {
  it("a non-prey herd-mate (e.g. Venusaur) intervenes when another member is threatened", () => {
    const world = createWorld(10, 10);
    const protector = guardian({ x: 8, y: 5 }, { herdId: "herd-a" });
    const threatened = prey({ x: 5, y: 5 }, { herdId: "herd-a", behavior: "flee" });
    const threat = predator({ x: 6, y: 5 }, 0.9); // satisfied — isolates the guardian's proactive response
    world.agents.push(protector, threatened, threat);
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(protector.behavior).toBe("fight");
    expect(protector.fightTarget).toBe("scyther-0");
    expect(protector.pos.x).toBeLessThan(8); // closing in — TEST_MOVE is melee-only, can't hit from 2 away yet
  });

  it("a guardian with no herd-mate in danger behaves normally", () => {
    const world = createWorld(10, 10);
    const protector = guardian({ x: 8, y: 5 }, { herdId: "herd-a" });
    world.agents.push(protector);

    tickWorld(world, undefined, RULES);

    expect(protector.behavior).not.toBe("fight");
  });
});

describe("bush concealment", () => {
  it("a predator that would otherwise detect and hunt prey at this distance fails to when the prey is in a bush", () => {
    // A bold prey (large enough boldness shrinks its own flee-detection
    // radius below 4) stays put instead of fleeing the predator this same
    // tick, which would otherwise change the distance out from under this
    // test before the predator's own hunt check runs (agents tick in push
    // order within the same tickWorld call).
    const bold = { boldness: 1, aggression: 0.5, sociability: 0.5 };
    // age: 0 keeps both agents below MIN_EXPLORE_AGE (needs.ts) so neither
    // wanders off on its own idle turn in this large (20x20) world — the
    // exp-motivated exploration feature otherwise moves the prey before the
    // predator's own hunt check runs this same tick (agents tick in push
    // order), corrupting the exact distance this test depends on.

    // Distance 4 is within HUNT_DETECT_RADIUS (5) normally.
    const openWorld = createWorld(20, 20);
    openWorld.agents.push(
      prey({ x: 5, y: 5 }, { disposition: bold, age: 0 }),
      predator({ x: 9, y: 5 }, 0.1, { age: 0 })
    );
    tickWorld(openWorld, undefined, RULES);
    const openHunter = openWorld.agents.find((a) => a.id === "scyther-0")!;
    expect(openHunter.behavior).toBe("hunt"); // sanity: this distance is normally detectable

    const bushWorld = createWorld(20, 20);
    setTile(bushWorld, "surface", 5, 5, "bush");
    bushWorld.agents.push(
      prey({ x: 5, y: 5 }, { disposition: bold, age: 0 }),
      predator({ x: 9, y: 5 }, 0.1, { age: 0 })
    );
    tickWorld(bushWorld, undefined, RULES);
    const concealedHunter = bushWorld.agents.find((a) => a.id === "scyther-0")!;
    expect(concealedHunter.behavior).not.toBe("hunt");
  });

  it("prey doesn't notice a predator lurking in a bush at a distance it would otherwise flee from", () => {
    // Distance 3 is within FLEE_DETECT_RADIUS (4) normally.
    const openWorld = createWorld(20, 20);
    const openTarget = prey({ x: 5, y: 5 });
    openWorld.agents.push(openTarget, predator({ x: 8, y: 5 }));
    tickWorld(openWorld, undefined, RULES);
    expect(openTarget.behavior).toBe("flee"); // sanity: this distance is normally detectable

    const bushWorld = createWorld(20, 20);
    setTile(bushWorld, "surface", 8, 5, "bush");
    const concealedTarget = prey({ x: 5, y: 5 });
    bushWorld.agents.push(concealedTarget, predator({ x: 8, y: 5 }));
    tickWorld(bushWorld, undefined, RULES);
    expect(concealedTarget.behavior).not.toBe("flee");
  });
});

describe("obstacles block combat move lines", () => {
  it("a tree between a mobbing prey and its target blocks the ranged attack — it closes distance instead", () => {
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 4, "tree"); // directly between mobber1 (5,3) and the predator (5,5)
    const mobber1 = prey({ x: 5, y: 3 }, { id: "bulbasaur-0", herdId: "herd-a", moves: [RANGED_MOVE] });
    const mobber2 = prey({ x: 4, y: 4 }, { id: "bulbasaur-1", herdId: "herd-a", moves: [RANGED_MOVE] });
    const mobber3 = prey({ x: 6, y: 4 }, { id: "bulbasaur-2", herdId: "herd-a", moves: [RANGED_MOVE] });
    world.agents.push(mobber1, mobber2, mobber3, predator({ x: 5, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    // In range (distance 2, RANGED_MOVE's reach) but the tree blocks the
    // straight-line path between them — must NOT attack through it. (It also
    // doesn't manage to route around in this exact layout — directly north
    // of the predator with the tree directly south of itself, there's no
    // lateral step available either — so it just stays put this tick; the
    // point of this test is the blocked attack, not stepToward's general
    // pathing, which is covered elsewhere.)
    expect(log.events).not.toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0" }));
  });

  it("the same layout with no obstacle DOES let the ranged attack land (control case)", () => {
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 3 }, { id: "bulbasaur-0", herdId: "herd-a", moves: [RANGED_MOVE] });
    const mobber2 = prey({ x: 4, y: 4 }, { id: "bulbasaur-1", herdId: "herd-a", moves: [RANGED_MOVE] });
    const mobber3 = prey({ x: 6, y: 4 }, { id: "bulbasaur-2", herdId: "herd-a", moves: [RANGED_MOVE] });
    world.agents.push(mobber1, mobber2, mobber3, predator({ x: 5, y: 5 }));
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(mobber1.pos).toEqual({ x: 5, y: 3 });
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0" }));
  });
});

describe("status effects wired into real combat (resolveHit)", () => {
  const BURNING_MOVE: MoveSpec = { ...TEST_MOVE, id: "burning-move", statusChance: 1, statusKind: "burn" };

  it("a landed, non-killing hit inflicts the move's status on the defender", () => {
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 }); // survives FALLBACK_DAMAGE (1)
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [BURNING_MOVE] });
    world.agents.push(hunter, target); // predator ticks first, strikes before prey can flee
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(target.status).toEqual({ kind: "burn", ticksRemaining: undefined });
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "statusInflicted", agentId: "bulbasaur-0", statusKind: "burn", inflictedBy: "scyther-0" })
    );
  });

  it("a fire-typed target can't be burned even on a guaranteed roll", () => {
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10, types: ["fire"] });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [BURNING_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES);

    expect(target.status).toBeUndefined();
  });

  it("burn halves the burned attacker's physical damage output (via calculateDamage's stat stages)", () => {
    const attackerStats = { maxHp: 100, attack: 50, defense: 30, spAttack: 30, spDefense: 30, speed: 40 }; // speed >= ACTION_THRESHOLD so it acts on the very first tick
    const defenderStats = { maxHp: 100, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 10 };

    const burnedWorld = createWorld(10, 10);
    const burnedAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...attackerStats }, maxHp: 200, moves: [TEST_MOVE] });
    burnedAttacker.status = { kind: "burn" };
    const victim1 = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...defenderStats } });
    burnedWorld.agents.push(burnedAttacker, victim1);
    const burnedLog = new EventLog();
    tickWorld(burnedWorld, burnedLog, RULES);
    const burnedDamage = burnedLog.events.find((e) => e.kind === "fought")! as Extract<(typeof burnedLog.events)[number], { kind: "fought" }>;

    const healthyWorld = createWorld(10, 10);
    const healthyAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...attackerStats }, maxHp: 200, moves: [TEST_MOVE] });
    const victim2 = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...defenderStats } });
    healthyWorld.agents.push(healthyAttacker, victim2);
    const healthyLog = new EventLog();
    tickWorld(healthyWorld, healthyLog, RULES);
    const healthyDamage = healthyLog.events.find((e) => e.kind === "fought")! as Extract<(typeof healthyLog.events)[number], { kind: "fought" }>;

    expect(burnedDamage.damage).toBeLessThan(healthyDamage.damage);
  });
});

describe("forced movement wired into real combat (resolveHit)", () => {
  it("a beforeHit lunge closes distance as part of using the move, without affecting whether it lands", () => {
    const LUNGE_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "lunge-move",
      range: { min: 0, max: 2 },
      forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" },
    };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 });
    const hunter = predator({ x: 7, y: 5 }, undefined, { moves: [LUNGE_MOVE] }); // starts distance 2, within LUNGE_MOVE's range
    world.agents.push(hunter, target);
    const log = new EventLog();

    tickWorld(world, log, RULES);

    // The lunge moves the attacker 1 tile closer as part of resolving the
    // hit — it should end up adjacent to where it started 2 tiles out,
    // not still at its original distance.
    expect(hunter.pos).toEqual({ x: 6, y: 5 });
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "scyther-0", defenderId: "bulbasaur-0" }));
  });

  it("an onHit knockback pushes the defender back after a landed, non-killing hit", () => {
    const KNOCKBACK_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "knockback-move",
      forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" },
    };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 }); // survives FALLBACK_DAMAGE (1), so this is a non-killing hit
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [KNOCKBACK_MOVE] });
    world.agents.push(hunter, target);
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(target.pos).not.toEqual({ x: 5, y: 5 }); // pushed away from where it started
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "scyther-0", defenderId: "bulbasaur-0" }));
  });

  it("no onHit forced movement fires on a killing/finishing hit — only a landed, non-killing one", () => {
    const KNOCKBACK_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "knockback-move-2",
      forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" },
    };
    const world = createWorld(10, 10);
    // hp:1, no types/stats -> this fixture's FALLBACK_DAMAGE (1) brings it to
    // exactly 0, a fainting hit, not a survived one.
    const target = prey({ x: 5, y: 5 }, { hp: 1, maxHp: 1 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [KNOCKBACK_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES);

    // Fainted in place — a fainting hit doesn't trigger onHit forced movement.
    expect(target.pos).toEqual({ x: 5, y: 5 });
    expect(target.fainted).toBe(true);
  });
});
