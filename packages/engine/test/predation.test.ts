import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorld, setElevation, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { applyPredationInstincts, preferMarked } from "../src/predation.js";
import { EventLog } from "../src/events.js";
import { mulberry32 } from "../src/rng.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";
import type { Disposition } from "../src/nature.js";
import { DAY_LENGTH_TICKS } from "../src/daynight.js";

const RULES: HuntRules = { scyther: true };
const MIDNIGHT = 0;
const NOON = DAY_LENGTH_TICKS / 2;

/**
 * `createWorld`'s default (no explicit seed) mints a fresh, non-reproducible
 * seed each call (see rng.ts's `randomSeed()`) — before this feature, every
 * bare `tickWorld(world, ...)` call below relied on `Math.random` the same
 * way, so this isn't new: it's the exact same latent flakiness this suite
 * always had, just now routed through a seeded-but-randomly-seeded
 * generator instead of `Math.random` directly. It surfaced for real during
 * this feature's own testing (weather.ts's Phase 3 spawn roll,
 * `WEATHER_SPAWN_CHANCE_PER_TICK` = 1/150, coincidentally firing on a single
 * `tickWorld` call and pulling in a storm's accuracy/speed modifiers that
 * this file's flee/fight/hunt assertions never accounted for). A single
 * shared `mulberry32` generator (a real, varied sequence, not a constant —
 * a constant broke anything needing multiple distinct draws in one call,
 * e.g. `findRandomWalkableTile`'s retry loop or a spawn-offset shuffle,
 * confirmed by a real failure here), passed explicitly to every bare
 * `tickWorld` call in this file and left running across the whole file
 * (same "one persistent generator threaded through many ticks" shape as a
 * real `World.rng`), keeps this suite deterministic without changing any of
 * its actual intent, matching the "thread a seeded generator into it" fix
 * DESIGN.md's determinism section calls for on a test whose behavior
 * implicitly depended on Math.random's statistics. Tests that need a
 * specific, meaningfully different roll (e.g. the storm-accuracy test
 * below) still pass their own explicit rng.
 */
const SAFE_RNG = mulberry32(20260904);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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
    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).not.toBe("hunt");
  });

  it("without rules, agents behave exactly as before predation existed", () => {
    const world = createWorld(10, 10);
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 6, y: 5 }, 0.1));

    tickWorld(world, undefined, undefined, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).toBe("hunt");
    expect(hunter.huntTarget).toBe("charmander-0");
  });

  it("a predator does NOT hunt something too close to its own size, even of a species it usually preys on", () => {
    const world = createWorld(10, 10);
    // maxHp 18 is above predator()'s 20 * PREY_POWER_RATIO (0.75) = 15 — too big to be worth it.
    const tooBig = prey({ x: 5, y: 5 }, { maxHp: 18 });
    world.agents.push(tooBig, predator({ x: 8, y: 5 }));

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).not.toBe("hunt");
  });

  it("same species is never prey, regardless of a power gap", () => {
    const world = createWorld(10, 10);
    // A second, much weaker scyther — same species as the hungry predator, well within
    // the power ratio that would make anything else fair game.
    const weakerKin = predator({ x: 5, y: 5 }, 1, { id: "scyther-1", maxHp: 5 });
    world.agents.push(weakerKin, predator({ x: 8, y: 5 }));

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).not.toBe("hunt");
  });

  it("a target grown too big (e.g. leveled up) stops being prey to a predator that used to be able to eat it", () => {
    const world = createWorld(10, 10);
    const grownUp = prey({ x: 5, y: 5 }, { maxHp: 10 }); // eligible prey at this size
    const hunter = predator({ x: 8, y: 5 });
    world.agents.push(grownUp, hunter);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);
    expect(world.agents.find((a) => a.id === "scyther-0")!.behavior).toBe("hunt");

    // It grows past the predator's threshold — no longer worth hunting.
    grownUp.maxHp = 18;
    hunter.behavior = "idle";
    hunter.huntTarget = undefined;

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);
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
    //
    // A fixed-output rng passed explicitly to `tickWorld`, not a
    // `vi.spyOn(Math, "random")` mock — `tickWorld` now defaults its `rng`
    // parameter to `world.rng` (the engine's one shared seeded generator,
    // see DESIGN.md's determinism section), not `Math.random`, so mocking
    // the latter no longer reaches any roll made through a real tick.
    const fixedRng = () => 0.7;

    const clearWorld = createWorld(10, 10);
    clearWorld.agents.push(
      prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" }),
      prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" }),
      prey({ x: 6, y: 5 }, { id: "bulbasaur-2", herdId: "herd-a" }),
      predator({ x: 5, y: 6 })
    );
    const clearLog = new EventLog();
    tickWorld(clearWorld, clearLog, RULES, undefined, fixedRng);
    expect(clearLog.events).toContainEqual(
      expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0", moveId: TEST_MOVE.id, pos: { x: 5, y: 6 } })
    );

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
    tickWorld(stormWorld, stormLog, RULES, undefined, fixedRng);
    expect(stormLog.events).not.toContainEqual(expect.objectContaining({ kind: "fought", attackerId: "bulbasaur-0" }));
    expect(stormLog.events).toContainEqual(
      expect.objectContaining({ kind: "missed", attackerId: "bulbasaur-0", moveId: TEST_MOVE.id, pos: { x: 5, y: 6 } })
    );
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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(solo.behavior).toBe("flee");
  });

  it("a lone or small group still flees rather than fights", () => {
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a" });
    const mobber2 = prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a" });
    world.agents.push(mobber1, mobber2, predator({ x: 5, y: 6 }));
    const log = new EventLog();

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

    expect(mobber1.behavior).toBe("flee");
  });

  it("a predator avoids hunting prey protected by a large enough herd", () => {
    const world = createWorld(10, 10);
    const hungry = predator({ x: 10, y: 5 }, 0.1);
    const group = [0, 1, 2].map((i) => prey({ x: 5 + i, y: 5 }, { id: `bulbasaur-${i}`, herdId: "herd-a" }));
    world.agents.push(hungry, ...group);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(target.behavior).toBe("flee");
  });

  it("a neutral (no disposition) prey does NOT react to that same distant predator", () => {
    const world = createWorld(20, 20);
    const target = prey({ x: 5, y: 5 });
    world.agents.push(target, predator({ x: 10, y: 5 }));

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(target.behavior).not.toBe("flee");
  });

  it("a bold prey tolerates a closer predator that a neutral prey would flee from", () => {
    const world = createWorld(20, 20);
    // Distance 3 — within the neutral FLEE_DETECT_RADIUS (4), but beyond a bold agent's shrunk radius.
    const target = prey({ x: 5, y: 5 }, { disposition: BOLD });
    world.agents.push(target, predator({ x: 8, y: 5 }));

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(target.behavior).not.toBe("flee");
  });

  it("a bold prey still flees a predator that is genuinely close (hard floor holds)", () => {
    const world = createWorld(20, 20);
    const target = prey({ x: 5, y: 5 }, { disposition: BOLD });
    world.agents.push(target, predator({ x: 6, y: 5 })); // distance 1
    const log = new EventLog();

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

    expect(target.behavior).toBe("flee");
  });

  it("a bold+aggressive pair mobs a threat that a neutral pair of the same size would flee from", () => {
    const boldAndAggressive: Disposition = { boldness: 1, aggression: 1, sociability: 0.5 };
    const world = createWorld(10, 10);
    const mobber1 = prey({ x: 5, y: 5 }, { id: "bulbasaur-0", herdId: "herd-a", disposition: boldAndAggressive });
    const mobber2 = prey({ x: 4, y: 5 }, { id: "bulbasaur-1", herdId: "herd-a", disposition: boldAndAggressive });
    world.agents.push(mobber1, mobber2, predator({ x: 5, y: 6 }));

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    const hunter = world.agents.find((a) => a.id === "scyther-0")!;
    expect(hunter.behavior).toBe("hunt");
  });

  it("a passive predator waits longer than a neutral predator to hunt", () => {
    const passive: Disposition = { boldness: 0.5, aggression: 0, sociability: 0.5 };
    const world = createWorld(10, 10);
    // hunger 0.5 is below the neutral threshold (0.6, would normally hunt) but above
    // the passive predator's lowered threshold (0.4).
    world.agents.push(prey({ x: 5, y: 5 }), predator({ x: 8, y: 5 }, 0.5, { disposition: passive }));

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

    expect(protector.behavior).toBe("fight");
    expect(protector.fightTarget).toBe("scyther-0");
    expect(protector.pos.x).toBeLessThan(8); // closing in — TEST_MOVE is melee-only, can't hit from 2 away yet
  });

  it("a guardian with no herd-mate in danger behaves normally", () => {
    const world = createWorld(10, 10);
    const protector = guardian({ x: 8, y: 5 }, { herdId: "herd-a" });
    world.agents.push(protector);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

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
    tickWorld(openWorld, undefined, RULES, undefined, SAFE_RNG);
    const openHunter = openWorld.agents.find((a) => a.id === "scyther-0")!;
    expect(openHunter.behavior).toBe("hunt"); // sanity: this distance is normally detectable

    const bushWorld = createWorld(20, 20);
    setTile(bushWorld, "surface", 5, 5, "bush");
    bushWorld.agents.push(
      prey({ x: 5, y: 5 }, { disposition: bold, age: 0 }),
      predator({ x: 9, y: 5 }, 0.1, { age: 0 })
    );
    tickWorld(bushWorld, undefined, RULES, undefined, SAFE_RNG);
    const concealedHunter = bushWorld.agents.find((a) => a.id === "scyther-0")!;
    expect(concealedHunter.behavior).not.toBe("hunt");
  });

  it("prey doesn't notice a predator lurking in a bush at a distance it would otherwise flee from", () => {
    // Distance 3 is within FLEE_DETECT_RADIUS (4) normally.
    const openWorld = createWorld(20, 20);
    const openTarget = prey({ x: 5, y: 5 });
    openWorld.agents.push(openTarget, predator({ x: 8, y: 5 }));
    tickWorld(openWorld, undefined, RULES, undefined, SAFE_RNG);
    expect(openTarget.behavior).toBe("flee"); // sanity: this distance is normally detectable

    const bushWorld = createWorld(20, 20);
    setTile(bushWorld, "surface", 8, 5, "bush");
    const concealedTarget = prey({ x: 5, y: 5 });
    bushWorld.agents.push(concealedTarget, predator({ x: 8, y: 5 }));
    tickWorld(bushWorld, undefined, RULES, undefined, SAFE_RNG);
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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

    tickWorld(world, log, RULES, undefined, SAFE_RNG);

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

describe("multi-hit wired into real combat (resolveHit)", () => {
  it("strikes exactly hits.min===max times, each its own 'fought' event, until the hit count is used up or the target dies", () => {
    const FLURRY_MOVE: MoveSpec = { ...TEST_MOVE, id: "flurry-move", hits: { min: 3, max: 3 } };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100 }); // survives all 3 FALLBACK_DAMAGE (1 each) hits
    const hunter = predator({ x: 6, y: 5 }, undefined, { maxHp: 200, moves: [FLURRY_MOVE] }); // maxHp raised so a maxHp:100 target still qualifies as prey (see isPreyOf/PREY_POWER_RATIO)
    world.agents.push(hunter, target);
    const log = new EventLog();

    tickWorld(world, log, RULES);

    const foughtEvents = log.events.filter((e) => e.kind === "fought");
    expect(foughtEvents).toHaveLength(3);
    // 100 - 3 (one FALLBACK_DAMAGE hit each) + 1 (prey()'s default needs are
    // fully fed/watered, so its own later tickAgentNeeds this same tick
    // applies its normal 1%-of-maxHp heal-over-time) = 98.
    expect(target.hp).toBe(98);
  });

  it("stops early once the target truly dies mid-flurry", () => {
    const FLURRY_MOVE: MoveSpec = { ...TEST_MOVE, id: "flurry-move-2", hits: { min: 5, max: 5 } };
    const world = createWorld(10, 10);
    // Already fainted with a tiny finishing pool — the first hit of the
    // flurry (FALLBACK_DAMAGE=1) exhausts it, killing it outright; the
    // remaining 4 hits of this same move-use never get a chance to land.
    const target = prey({ x: 5, y: 5 }, { hp: 0, maxHp: 10, fainted: true, finishingPool: 1 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [FLURRY_MOVE] });
    world.agents.push(hunter, target);
    const log = new EventLog();

    tickWorld(world, log, RULES);

    expect(target.alive).toBe(false);
    expect(log.events.filter((e) => e.kind === "fought")).toHaveLength(1);
  });
});

describe("positionSwap wired into real combat (resolveHit)", () => {
  it("attacker and defender trade tiles on a landed, non-killing hit", () => {
    const SWAP_MOVE: MoveSpec = { ...TEST_MOVE, id: "swap-move", positionSwap: true };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [SWAP_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES);

    expect(hunter.pos).toEqual({ x: 5, y: 5 });
    expect(target.pos).toEqual({ x: 6, y: 5 });
  });

  it("does not swap on a killing/finishing hit", () => {
    const SWAP_MOVE: MoveSpec = { ...TEST_MOVE, id: "swap-move-2", positionSwap: true };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 1, maxHp: 1 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [SWAP_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES);

    expect(hunter.pos).toEqual({ x: 6, y: 5 }); // untouched
    expect(target.fainted).toBe(true);
  });
});

describe("statChangeOnHit wired into real combat (resolveHit)", () => {
  it("a self-side stat change applies the instant the move is used, regardless of whether it lands", () => {
    const SELF_BUFF_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "self-buff-move",
      accuracy: 0, // never lands
      statChangeOnHit: { target: "self", stat: "attack", stage: 1 },
    };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [SELF_BUFF_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES);

    expect(hunter.statStages).toEqual([{ stat: "attack", stage: 1, ticksRemaining: undefined }]);
  });

  it("a defender-side stat change applies only on a landed, non-killing hit", () => {
    const DEBUFF_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "debuff-move",
      statChangeOnHit: { target: "defender", stat: "defense", stage: -1, ticks: 10 },
    };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [DEBUFF_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES);

    // ticksRemaining is 9, not 10: the debuff is applied during the hunter's
    // own action tick, then the target's own tickAgentNeeds (later in the
    // same tickWorld iteration) immediately counts it down by 1 — real,
    // same-tick behavior, not a bug.
    expect(target.statStages).toEqual([{ stat: "defense", stage: -1, ticksRemaining: 9 }]);
  });

  it("no defender-side stat change on a killing/finishing hit", () => {
    const DEBUFF_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "debuff-move-2",
      statChangeOnHit: { target: "defender", stat: "defense", stage: -1 },
    };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 1, maxHp: 1 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [DEBUFF_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES);

    expect(target.statStages).toBeUndefined();
  });
});

describe("damage-reduction passive wired into real combat (resolveHit)", () => {
  it("a defender with the damageReduction passive takes proportionally less damage", () => {
    const attackerStats = { maxHp: 100, attack: 50, defense: 30, spAttack: 30, spDefense: 30, speed: 40 };
    const defenderStats = { maxHp: 100, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 10 };

    const reducedWorld = createWorld(10, 10);
    const reducedAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...attackerStats }, maxHp: 200, moves: [TEST_MOVE] });
    const reducedVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...defenderStats }, passives: { damageReduction: 0.5 } });
    reducedWorld.agents.push(reducedAttacker, reducedVictim);
    const reducedLog = new EventLog();
    tickWorld(reducedWorld, reducedLog, RULES);
    const reducedDamage = (reducedLog.events.find((e) => e.kind === "fought")! as Extract<(typeof reducedLog.events)[number], { kind: "fought" }>).damage;

    const normalWorld = createWorld(10, 10);
    const normalAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...attackerStats }, maxHp: 200, moves: [TEST_MOVE] });
    const normalVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...defenderStats } });
    normalWorld.agents.push(normalAttacker, normalVictim);
    const normalLog = new EventLog();
    tickWorld(normalWorld, normalLog, RULES);
    const normalDamage = (normalLog.events.find((e) => e.kind === "fought")! as Extract<(typeof normalLog.events)[number], { kind: "fought" }>).damage;

    expect(reducedDamage).toBeLessThan(normalDamage);
  });
});

describe("situational bonus wired into real combat (resolveHit)", () => {
  it("targetLowHp multiplies damage only when the defender is at or below half HP", () => {
    const LOW_HP_MOVE: MoveSpec = { ...TEST_MOVE, id: "low-hp-move", situationalBonus: { condition: "targetLowHp", multiplier: 3 } };
    const attackerStats = { maxHp: 100, attack: 50, defense: 30, spAttack: 30, spDefense: 30, speed: 40 };
    const defenderStats = { maxHp: 100, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 10 };

    const lowHpWorld = createWorld(10, 10);
    const lowHpAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...attackerStats }, maxHp: 200, moves: [LOW_HP_MOVE] });
    const lowHpVictim = prey({ x: 5, y: 5 }, { hp: 40, maxHp: 100, types: ["normal"], stats: { ...defenderStats } });
    lowHpWorld.agents.push(lowHpAttacker, lowHpVictim);
    const lowHpLog = new EventLog();
    tickWorld(lowHpWorld, lowHpLog, RULES);
    const lowHpDamage = (lowHpLog.events.find((e) => e.kind === "fought")! as Extract<(typeof lowHpLog.events)[number], { kind: "fought" }>).damage;

    const fullHpWorld = createWorld(10, 10);
    const fullHpAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...attackerStats }, maxHp: 200, moves: [LOW_HP_MOVE] });
    const fullHpVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...defenderStats } });
    fullHpWorld.agents.push(fullHpAttacker, fullHpVictim);
    const fullHpLog = new EventLog();
    tickWorld(fullHpWorld, fullHpLog, RULES);
    const fullHpDamage = (fullHpLog.events.find((e) => e.kind === "fought")! as Extract<(typeof fullHpLog.events)[number], { kind: "fought" }>).damage;

    expect(lowHpDamage).toBeGreaterThan(fullHpDamage);
  });
});

describe("multi-target/AoE resolution wired into real combat (resolveHit)", () => {
  it("a hitsArea move (Growl-shaped: ring around the attacker) hits every agent in its shape, not just the picked target", () => {
    const GROWL_LIKE_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "growl-like-move",
      shape: { kind: "ring", radius: 1 },
      hitsArea: true,
    };
    const world = createWorld(10, 10);
    const primaryTarget = prey({ x: 6, y: 5 }, { id: "bulbasaur-primary", hp: 10 });
    // A bystander on the same ring (radius 1 around the attacker at (5,5)) but
    // not the deliberately-picked target — should still take a hit.
    const bystander = prey({ x: 5, y: 6 }, { id: "bulbasaur-bystander", hp: 10 });
    const hunter = predator({ x: 5, y: 5 }, undefined, { moves: [GROWL_LIKE_MOVE] });
    world.agents.push(hunter, primaryTarget, bystander);
    const log = new EventLog();

    tickWorld(world, log, RULES);

    const foughtDefenders = log.events.filter((e) => e.kind === "fought").map((e) => (e as { defenderId: string }).defenderId);
    expect(foughtDefenders).toContain("bulbasaur-primary");
    expect(foughtDefenders).toContain("bulbasaur-bystander");
  });

  it("onHit forced movement/positionSwap/status only ever apply to the primary target, not incidental AoE bystanders", () => {
    const BLAST_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "blast-move",
      shape: { kind: "ring", radius: 1 },
      hitsArea: true,
      forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" },
    };
    const world = createWorld(10, 10);
    const primaryTarget = prey({ x: 6, y: 5 }, { id: "bulbasaur-primary", hp: 10 });
    const bystander = prey({ x: 5, y: 6 }, { id: "bulbasaur-bystander", hp: 10 });
    const hunter = predator({ x: 5, y: 5 }, undefined, { moves: [BLAST_MOVE] });
    world.agents.push(hunter, primaryTarget, bystander);

    tickWorld(world, undefined, RULES);

    expect(primaryTarget.pos).not.toEqual({ x: 6, y: 5 }); // knocked back
    expect(bystander.pos).toEqual({ x: 5, y: 6 }); // untouched — not the primary target
  });

  it("returns true (a real 'kill') only if the primary target itself truly dies, not an incidental AoE side-kill", () => {
    const GROWL_LIKE_MOVE: MoveSpec = {
      ...TEST_MOVE,
      id: "growl-like-move-2",
      shape: { kind: "ring", radius: 1 },
      hitsArea: true,
    };
    const world = createWorld(10, 10);
    const primaryTarget = prey({ x: 6, y: 5 }, { id: "bulbasaur-primary", hp: 10 }); // survives
    const bystander = prey({ x: 5, y: 6 }, { id: "bulbasaur-bystander", hp: 1, maxHp: 1 }); // dies to FALLBACK_DAMAGE
    const hunter = predator({ x: 5, y: 5 }, 0.9, { moves: [GROWL_LIKE_MOVE] }); // very hungry — restores hunger only on a true "kill" per applyPredationInstincts
    world.agents.push(hunter, primaryTarget, bystander);

    tickWorld(world, undefined, RULES);

    // The bystander fainted (not truly dead — FALLBACK_DAMAGE=1 exactly zeroes
    // hp: 1, which faints rather than kills outright), and the primary target
    // survived — so the hunter's own hunger should only have decayed
    // naturally (~0.01), never jumped by KILL_HUNGER_RESTORE (0.6).
    expect(hunter.needs.hunger).toBeLessThan(0.95);
  });
});

const ATTACKER_STATS = { maxHp: 100, attack: 50, defense: 30, spAttack: 30, spDefense: 30, speed: 40 };
const DEFENDER_STATS = { maxHp: 100, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 10 };
// `effectiveSpeed` (support.ts) discounts action speed by an injured
// attacker's own hp/maxHp fraction (floored at FAINT_SPEED_FLOOR, 0.35) — a
// plain speed:40 attacker started below full HP wouldn't reliably cross
// ACTION_THRESHOLD (40) on the very first tick these tests all rely on, so
// tests that deliberately start the attacker hurt use this instead.
const ATTACKER_STATS_FAST = { ...ATTACKER_STATS, speed: 120 };

function foughtDamage(events: EventLog["events"]): number {
  return (events.find((e) => e.kind === "fought")! as Extract<(typeof events)[number], { kind: "fought" }>).damage;
}

describe("weightScaling wired into real combat", () => {
  it("a heavier attacker (higher maxHp) deals more bonus damage than a lighter one", () => {
    const HEAVY_MOVE: MoveSpec = { ...TEST_MOVE, id: "heavy-move", weightScaling: { factor: 0.5 } };

    const heavyWorld = createWorld(10, 10);
    const heavyAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 300, moves: [HEAVY_MOVE] });
    const heavyVictim = prey({ x: 5, y: 5 }, { hp: 20, maxHp: 20, types: ["normal"], stats: { ...DEFENDER_STATS } });
    heavyWorld.agents.push(heavyAttacker, heavyVictim);
    const heavyLog = new EventLog();
    // Explicit rng (not the default world.rng from an unseeded createWorld)
    // — confirmed via 30 repeated real runs that leaving this on a fresh
    // random seed each time flakes about 1/30 (the accuracy roll can, on an
    // unlucky seed, cause no "fought" event this single tick at all).
    tickWorld(heavyWorld, heavyLog, RULES, undefined, SAFE_RNG);

    const lightWorld = createWorld(10, 10);
    const lightAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 50, moves: [HEAVY_MOVE] });
    const lightVictim = prey({ x: 5, y: 5 }, { hp: 20, maxHp: 20, types: ["normal"], stats: { ...DEFENDER_STATS } });
    lightWorld.agents.push(lightAttacker, lightVictim);
    const lightLog = new EventLog();
    tickWorld(lightWorld, lightLog, RULES, undefined, SAFE_RNG);

    expect(foughtDamage(heavyLog.events)).toBeGreaterThan(foughtDamage(lightLog.events));
  });
});

describe("critRateStage wired into real combat", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a positive critRateStage can crit on a roll that stage 0 would not", () => {
    // 0.1 is >= CRIT_STAGE_CHANCE[0] (1/24 ~= 0.0417) but < CRIT_STAGE_CHANCE[1] (1/8 = 0.125).
    // Passed as an explicit rng override (not a global Math.random mock) —
    // predation.ts threads a real rng end-to-end for determinism (see
    // DESIGN.md's "Determinism" section), so tickWorld's default of
    // `world.rng` (a seeded PRNG, not Math.random) is what the actual crit
    // roll consumes; a Math.random mock has no effect on it.
    const fixedRng = () => 0.1;
    const CRIT_MOVE: MoveSpec = { ...TEST_MOVE, id: "crit-move", critRateStage: 1 };

    const critWorld = createWorld(10, 10);
    const critAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [CRIT_MOVE] });
    const critVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    critWorld.agents.push(critAttacker, critVictim);
    const critLog = new EventLog();
    tickWorld(critWorld, critLog, RULES, undefined, fixedRng);

    const noCritWorld = createWorld(10, 10);
    const noCritAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [TEST_MOVE] });
    const noCritVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    noCritWorld.agents.push(noCritAttacker, noCritVictim);
    const noCritLog = new EventLog();
    tickWorld(noCritWorld, noCritLog, RULES, undefined, fixedRng);

    expect(critLog.events).toContainEqual(expect.objectContaining({ kind: "fought", critical: true }));
    expect(foughtDamage(critLog.events)).toBeGreaterThan(foughtDamage(noCritLog.events));
  });
});

describe("lifesteal/recoil/thorns wired into real combat", () => {
  it("lifestealFraction heals the attacker by a fraction of the damage it dealt", () => {
    const LIFESTEAL_MOVE: MoveSpec = { ...TEST_MOVE, id: "lifesteal-move", lifestealFraction: 0.5 };
    const world = createWorld(10, 10);
    const hunter = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS_FAST }, hp: 100, maxHp: 200, moves: [LIFESTEAL_MOVE] });
    const target = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    world.agents.push(hunter, target);
    const log = new EventLog();
    tickWorld(world, log, RULES);
    expect(hunter.hp).toBeGreaterThan(100);
    expect(hunter.hp).toBeLessThanOrEqual(200);
  });

  it("recoilFraction damages the attacker by a fraction of the damage it dealt, floored at 1hp", () => {
    const RECOIL_MOVE: MoveSpec = { ...TEST_MOVE, id: "recoil-move", recoilFraction: 0.5 };
    const world = createWorld(10, 10);
    const hunter = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, hp: 200, maxHp: 200, moves: [RECOIL_MOVE] });
    const target = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    world.agents.push(hunter, target);
    tickWorld(world, undefined, RULES);
    expect(hunter.hp).toBeLessThan(200);
  });

  it("recoilFraction never faints the attacker outright — floors at 1hp", () => {
    const RECOIL_MOVE: MoveSpec = { ...TEST_MOVE, id: "recoil-move-2", recoilFraction: 50 };
    const world = createWorld(10, 10);
    const hunter = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS_FAST }, hp: 5, maxHp: 200, moves: [RECOIL_MOVE] });
    const target = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    world.agents.push(hunter, target);
    tickWorld(world, undefined, RULES);
    expect(hunter.hp).toBe(1);
  });

  it("a defender's thorns passive reflects a fraction of damage back onto the attacker", () => {
    const world = createWorld(10, 10);
    const hunter = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, hp: 200, maxHp: 200, moves: [TEST_MOVE] });
    const target = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS }, passives: { thorns: 0.5 } });
    world.agents.push(hunter, target);
    tickWorld(world, undefined, RULES);
    expect(hunter.hp).toBeLessThan(200);
  });
});

describe("jamCooldownTicks/terrainBurn/statusSpreads wired into real combat", () => {
  it("bumps every entry in the defender's active moveCooldowns on a landed, non-killing hit", () => {
    const JAM_MOVE: MoveSpec = { ...TEST_MOVE, id: "jam-move", jamCooldownTicks: 3 };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10, moveCooldowns: { "some-move": 2 } });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [JAM_MOVE] });
    world.agents.push(hunter, target);
    tickWorld(world, undefined, RULES);
    // 2 (start) + 3 (jam, applied during the hunter's own action tick) - 1
    // (target's own tickAgentNeeds/tickCooldowns, which runs later this same
    // tickWorld iteration since it's processed after the hunter) = 4.
    expect(target.moveCooldowns?.["some-move"]).toBe(4);
  });

  it("terrainBurn reverts a bush tile the defender stands on to floor", () => {
    const BURN_TERRAIN_MOVE: MoveSpec = { ...TEST_MOVE, id: "burn-terrain-move", terrainBurn: true };
    const world = createWorld(10, 10);
    setTile(world, "surface", 5, 5, "bush");
    const target = prey({ x: 5, y: 5 }, { hp: 10 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [BURN_TERRAIN_MOVE] });
    world.agents.push(hunter, target);
    tickWorld(world, undefined, RULES);
    expect(world.tiles.surface[5 * world.width + 5].terrain).toBe("floor");
  });

  it("statusSpreads inflicts the same status on a nearby agent once the primary status lands", () => {
    // 0 beats both the status-inflict and spread rolls. Passed as an
    // explicit rng override, not a global Math.random mock — see the
    // critRateStage test above's comment for why a Math.random mock has no
    // effect on a real tickWorld call.
    const fixedRng = () => 0;
    // Ranged (line, reach 2) so the hunter can stand 2 tiles from the target
    // — outside maybeSpreadStatus's own 1-tile spread radius itself, unlike
    // a melee move that would put it adjacent and eligible to catch its own
    // spread instead of the intended bystander.
    const SPREADING_BURN: MoveSpec = { ...RANGED_MOVE, id: "spreading-burn", statusChance: 1, statusKind: "burn", statusSpreads: true };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10, types: ["grass"] });
    const neighbor = prey({ x: 5, y: 6 }, { id: "bulbasaur-neighbor", hp: 10, types: ["grass"] });
    const hunter = predator({ x: 5, y: 3 }, undefined, { moves: [SPREADING_BURN] });
    world.agents.push(hunter, target, neighbor);
    tickWorld(world, undefined, RULES, undefined, fixedRng);
    expect(target.status).toEqual({ kind: "burn", ticksRemaining: undefined });
    expect(neighbor.status).toEqual({ kind: "burn", ticksRemaining: undefined });
  });
});

describe("selfCostPerUse wired into real combat", () => {
  it("deducts the configured need by the configured amount once the move is used", () => {
    const COSTLY_MOVE: MoveSpec = { ...TEST_MOVE, id: "costly-move", selfCostPerUse: { need: "energy", amount: 0.2 } };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [COSTLY_MOVE] });
    hunter.needs.energy = 0.8;
    world.agents.push(hunter, target);
    tickWorld(world, undefined, RULES);
    expect(hunter.needs.energy).toBeCloseTo(0.6, 1);
  });

  it("floors at 0, never goes negative", () => {
    const COSTLY_MOVE: MoveSpec = { ...TEST_MOVE, id: "costly-move-2", selfCostPerUse: { need: "energy", amount: 5 } };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [COSTLY_MOVE] });
    world.agents.push(hunter, target);
    tickWorld(world, undefined, RULES);
    expect(hunter.needs.energy).toBe(0);
  });
});

describe("new situational conditions wired into real combat", () => {
  // Fixed rng: an unmocked crit roll (~1/24) or the 0.85-1.15 damage-variance
  // roll can otherwise coincidentally land the same rounded damage on both
  // sides of a comparison, flaking a test that isn't actually testing crit
  // variance. 0.5 always misses the crit roll and lands mid-range variance.
  beforeEach(() => vi.spyOn(Math, "random").mockReturnValue(0.5));
  afterEach(() => vi.restoreAllMocks());

  it("elevation grants the bonus only when the attacker is higher than the defender", () => {
    const ELEVATION_MOVE: MoveSpec = { ...TEST_MOVE, id: "elevation-move", situationalBonus: { condition: "elevation", multiplier: 3 } };

    const highWorld = createWorld(10, 10);
    setElevation(highWorld, "surface", 6, 5, 2);
    const highAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [ELEVATION_MOVE] });
    const highVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    highWorld.agents.push(highAttacker, highVictim);
    const highLog = new EventLog();
    tickWorld(highWorld, highLog, RULES);

    const flatWorld = createWorld(10, 10);
    const flatAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [ELEVATION_MOVE] });
    const flatVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    flatWorld.agents.push(flatAttacker, flatVictim);
    const flatLog = new EventLog();
    tickWorld(flatWorld, flatLog, RULES);

    expect(foughtDamage(highLog.events)).toBeGreaterThan(foughtDamage(flatLog.events));
  });

  it("concealed grants the bonus only when the attacker is standing in a bush", () => {
    const CONCEALED_MOVE: MoveSpec = { ...TEST_MOVE, id: "concealed-move", situationalBonus: { condition: "concealed", multiplier: 3 } };

    const bushWorld = createWorld(10, 10);
    setTile(bushWorld, "surface", 6, 5, "bush");
    const bushAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [CONCEALED_MOVE] });
    const bushVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    bushWorld.agents.push(bushAttacker, bushVictim);
    const bushLog = new EventLog();
    tickWorld(bushWorld, bushLog, RULES);

    const openWorld = createWorld(10, 10);
    const openAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [CONCEALED_MOVE] });
    const openVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    openWorld.agents.push(openAttacker, openVictim);
    const openLog = new EventLog();
    tickWorld(openWorld, openLog, RULES);

    expect(foughtDamage(bushLog.events)).toBeGreaterThan(foughtDamage(openLog.events));
  });

  it("storm/drought/rain check the active weather cell at the attacker's position", () => {
    const RAIN_MOVE: MoveSpec = { ...TEST_MOVE, id: "rain-move", situationalBonus: { condition: "rain", multiplier: 3 } };

    const rainWorld = createWorld(10, 10);
    rainWorld.weatherCells = [{ id: "r", type: "rain", center: { x: 6, y: 5 }, radius: 5, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } }];
    const rainAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [RAIN_MOVE] });
    const rainVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    rainWorld.agents.push(rainAttacker, rainVictim);
    const rainLog = new EventLog();
    tickWorld(rainWorld, rainLog, RULES);

    const clearWorld = createWorld(10, 10);
    const clearAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [RAIN_MOVE] });
    const clearVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    clearWorld.agents.push(clearAttacker, clearVictim);
    const clearLog = new EventLog();
    tickWorld(clearWorld, clearLog, RULES);

    expect(foughtDamage(rainLog.events)).toBeGreaterThan(foughtDamage(clearLog.events));
  });

  it("coldSnap checks isInColdSnap at the attacker's position", () => {
    const COLD_MOVE: MoveSpec = { ...TEST_MOVE, id: "cold-move", situationalBonus: { condition: "coldSnap", multiplier: 3 } };

    const coldWorld = createWorld(10, 10);
    coldWorld.weatherCells = [{ id: "c", type: "coldSnap", center: { x: 6, y: 5 }, radius: 5, startedTick: 0, lifespanTicks: 999, drift: { x: 0, y: 0 } }];
    // A cold snap also slows the attacker's own action speed (weather.ts's
    // COLD_SNAP_SPEED_MULTIPLIER, composed into actionSpeedOf) — a plain
    // speed:40 wouldn't cross ACTION_THRESHOLD at all this tick under it, so
    // both sides of this comparison use the faster stat block instead.
    const coldAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS_FAST }, maxHp: 200, moves: [COLD_MOVE] });
    const coldVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    coldWorld.agents.push(coldAttacker, coldVictim);
    const coldLog = new EventLog();
    tickWorld(coldWorld, coldLog, RULES);

    const warmWorld = createWorld(10, 10);
    const warmAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS_FAST }, maxHp: 200, moves: [COLD_MOVE] });
    const warmVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    warmWorld.agents.push(warmAttacker, warmVictim);
    const warmLog = new EventLog();
    tickWorld(warmWorld, warmLog, RULES);

    expect(foughtDamage(coldLog.events)).toBeGreaterThan(foughtDamage(warmLog.events));
  });

  it("targetBurning/targetStatused key off the defender's current status", () => {
    const BURNING_BONUS_MOVE: MoveSpec = { ...TEST_MOVE, id: "burning-bonus-move", situationalBonus: { condition: "targetBurning", multiplier: 3 } };
    const STATUSED_BONUS_MOVE: MoveSpec = { ...TEST_MOVE, id: "statused-bonus-move", situationalBonus: { condition: "targetStatused", multiplier: 3 } };

    const burningWorld = createWorld(10, 10);
    const burningAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [BURNING_BONUS_MOVE] });
    const burningVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS }, status: { kind: "burn" } });
    burningWorld.agents.push(burningAttacker, burningVictim);
    const burningLog = new EventLog();
    tickWorld(burningWorld, burningLog, RULES);

    const healthyWorld = createWorld(10, 10);
    const healthyAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [BURNING_BONUS_MOVE] });
    const healthyVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    healthyWorld.agents.push(healthyAttacker, healthyVictim);
    const healthyLog = new EventLog();
    tickWorld(healthyWorld, healthyLog, RULES);

    // targetBurning fires on the burning target but not the healthy one.
    expect(foughtDamage(burningLog.events)).toBeGreaterThan(foughtDamage(healthyLog.events));

    const paralyzedWorld = createWorld(10, 10);
    const paralyzedAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [STATUSED_BONUS_MOVE] });
    const paralyzedVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS }, status: { kind: "paralysis" } });
    paralyzedWorld.agents.push(paralyzedAttacker, paralyzedVictim);
    const paralyzedLog = new EventLog();
    tickWorld(paralyzedWorld, paralyzedLog, RULES);

    const unstatusedWorld = createWorld(10, 10);
    const unstatusedAttacker = predator({ x: 6, y: 5 }, undefined, { level: 10, types: ["normal"], stats: { ...ATTACKER_STATS }, maxHp: 200, moves: [STATUSED_BONUS_MOVE] });
    const unstatusedVictim = prey({ x: 5, y: 5 }, { hp: 100, maxHp: 100, types: ["normal"], stats: { ...DEFENDER_STATS } });
    unstatusedWorld.agents.push(unstatusedAttacker, unstatusedVictim);
    const unstatusedLog = new EventLog();
    tickWorld(unstatusedWorld, unstatusedLog, RULES);

    // targetStatused fires on ANY status (paralysis here), not just burn.
    expect(foughtDamage(paralyzedLog.events)).toBeGreaterThan(foughtDamage(unstatusedLog.events));
  });
});

describe("preferMarked (rally-call focus fire)", () => {
  it("prefers a rally-marked candidate over a merely-closer one", () => {
    const agent = prey({ x: 5, y: 5 });
    const close = prey({ x: 6, y: 5 }, { id: "close" });
    const far = prey({ x: 9, y: 5 }, { id: "far", rallyMarkTicksRemaining: 3 });
    expect(preferMarked(agent, [close, far])?.id).toBe("far");
  });

  it("falls back to plain nearest when nothing is marked", () => {
    const agent = prey({ x: 5, y: 5 });
    const close = prey({ x: 6, y: 5 }, { id: "close" });
    const far = prey({ x: 9, y: 5 }, { id: "far" });
    expect(preferMarked(agent, [close, far])?.id).toBe("close");
  });

  it("resolves ties among multiple marked candidates by distance, same as the fallback", () => {
    const agent = prey({ x: 5, y: 5 });
    const nearMarked = prey({ x: 6, y: 5 }, { id: "near-marked", rallyMarkTicksRemaining: 1 });
    const farMarked = prey({ x: 9, y: 5 }, { id: "far-marked", rallyMarkTicksRemaining: 1 });
    expect(preferMarked(agent, [farMarked, nearMarked])?.id).toBe("near-marked");
  });

  it("a mark of 0 (expired) doesn't count as marked", () => {
    const agent = prey({ x: 5, y: 5 });
    const close = prey({ x: 6, y: 5 }, { id: "close" });
    const far = prey({ x: 9, y: 5 }, { id: "far", rallyMarkTicksRemaining: 0 });
    expect(preferMarked(agent, [close, far])?.id).toBe("close");
  });

  it("returns undefined for an empty candidate list", () => {
    const agent = prey({ x: 5, y: 5 });
    expect(preferMarked(agent, [])).toBeUndefined();
  });
});

describe("rally-call wired into real predation instincts", () => {
  it("prey flees toward a rally-marked (farther) threat instead of the merely-closer one", () => {
    const world = createWorld(20, 20);
    const target = prey({ x: 10, y: 10 }, { id: "bulbasaur-0" });
    const closeThreat = predator({ x: 8, y: 10 }, undefined, { id: "scyther-close" }); // distance 2, west
    const farThreat = predator({ x: 13, y: 10 }, undefined, { id: "scyther-far", rallyMarkTicksRemaining: 5 }); // distance 3, east, marked
    world.agents.push(target, closeThreat, farThreat);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(target.behavior).toBe("flee");
    // Fleeing the marked (east) threat moves the target west (x decreases);
    // fleeing the merely-closer (west) threat would have moved it east instead.
    expect(target.pos.x).toBeLessThan(10);
  });

  it("baseline sanity: with nothing marked, the same layout flees the actually-nearest threat", () => {
    const world = createWorld(20, 20);
    const target = prey({ x: 10, y: 10 }, { id: "bulbasaur-0" });
    const closeThreat = predator({ x: 8, y: 10 }, undefined, { id: "scyther-close" });
    const farThreat = predator({ x: 13, y: 10 }, undefined, { id: "scyther-far" });
    world.agents.push(target, closeThreat, farThreat);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(target.behavior).toBe("flee");
    expect(target.pos.x).toBeGreaterThan(10);
  });

  it("a hungry predator hunts a rally-marked prey over a merely-closer one", () => {
    const world = createWorld(20, 20);
    const hungry = predator({ x: 10, y: 10 }, 0.1, { id: "scyther-hungry" });
    const closePrey = prey({ x: 11, y: 10 }, { id: "bulbasaur-close" }); // distance 1
    const farPrey = prey({ x: 14, y: 10 }, { id: "bulbasaur-far", rallyMarkTicksRemaining: 5 }); // distance 4, marked
    world.agents.push(hungry, closePrey, farPrey);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(hungry.behavior).toBe("hunt");
    expect(hungry.huntTarget).toBe("bulbasaur-far");
  });

  it("a guardian intervenes against a rally-marked threat over a merely-closer one", () => {
    const world = createWorld(20, 20);
    const protector = guardian({ x: 5, y: 3 }, { herdId: "herd-a" });
    const threatened = prey({ x: 5, y: 5 }, { herdId: "herd-a", behavior: "flee" });
    const closeThreat = predator({ x: 6, y: 5 }, 0.9, { id: "scyther-close" }); // distance 1
    const farThreat = predator({ x: 8, y: 5 }, 0.9, { id: "scyther-far", rallyMarkTicksRemaining: 5 }); // distance 3, marked
    world.agents.push(protector, threatened, closeThreat, farThreat);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(protector.behavior).toBe("fight");
    expect(protector.fightTarget).toBe("scyther-far");
  });

  it("a landed, non-killing hit with rallyCall marks the defender for the configured duration", () => {
    const RALLY_MOVE: MoveSpec = { ...TEST_MOVE, id: "rally-move", rallyCall: { ticks: 8 } };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 10 }); // survives FALLBACK_DAMAGE (1)
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [RALLY_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    // 8 (set during the hunter's own action tick) - 1 (the target's own
    // tickStatusEffects, which runs later this same tickWorld iteration
    // since it's processed after the hunter) = 7.
    expect(target.rallyMarkTicksRemaining).toBe(7);
  });

  it("no mark on a killing/finishing hit", () => {
    const RALLY_MOVE: MoveSpec = { ...TEST_MOVE, id: "rally-move-2", rallyCall: { ticks: 8 } };
    const world = createWorld(10, 10);
    const target = prey({ x: 5, y: 5 }, { hp: 1, maxHp: 1 });
    const hunter = predator({ x: 6, y: 5 }, undefined, { moves: [RALLY_MOVE] });
    world.agents.push(hunter, target);

    tickWorld(world, undefined, RULES, undefined, SAFE_RNG);

    expect(target.rallyMarkTicksRemaining).toBeUndefined();
    expect(target.fainted).toBe(true);
  });
});
