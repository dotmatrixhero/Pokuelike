import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import { hasCoverNearby } from "../src/weather.js";
import { updateHerdMigrations, STORM_EXPOSURE_SUSTAIN_TICKS } from "../src/herdMigration.js";
import { mulberry32 } from "../src/rng.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";
import {
  applyShelterBuilding,
  applyShelterResting,
  decayShelters,
  maybeFeedFromShelterCache,
  maybeTriggerShelterBuilding,
  SHELTER_ABANDON_TICKS,
  SHELTER_BUILD_TICKS,
  SHELTER_CACHE_DEPOSIT_PER_TICK,
  SHELTER_CACHE_FEED_AMOUNT,
  SHELTER_CACHE_MAX,
  SHELTER_HEAL_MULTIPLIER,
  SHELTER_MIN_BUILD_DISTANCE,
  SHELTER_NEEDS_DECAY_MULTIPLIER,
  SHELTER_REST_RADIUS,
} from "../src/shelter.js";
import { decayNeeds } from "../src/needs.js";
import { applyHealOverTime } from "../src/support.js";

/** Deterministic seeded PRNG (mulberry32) — matches dispersal.test.ts's/herdMigration.test.ts's own helper. */
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
    species: "diglett",
    pos: { x: 40, y: 40 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    age: 500,
    buildsShelter: true,
    ...overrides,
  };
}

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

describe("maybeTriggerShelterBuilding", () => {
  it("universal shelter: any species (not just buildsShelter-flagged ones) attempts it once comfortable — direct instruction reversing the earlier species-tied design", () => {
    const world = createWorld(100, 100);
    // `buildsShelter: false` on a bulbasaur — the field is a legacy/cosmetic
    // leftover (still denormalized from data for now) but no longer gates
    // anything in shelter.ts, so this should behave identically to any
    // other comfortable idle agent.
    const a = agent("non-builder", { species: "bulbasaur", buildsShelter: false });
    world.agents.push(a);

    maybeTriggerShelterBuilding(world, a, seededRng(3));

    expect(a.shelterTarget).toBeDefined();
  });

  it("an eligible species with no nearby shelter picks a real distant build site, not build-on-the-spot", () => {
    const world = createWorld(100, 100);
    const a = agent("builder", { pos: { x: 50, y: 50 } });
    world.agents.push(a);

    maybeTriggerShelterBuilding(world, a, seededRng(3));

    expect(a.shelterTarget).toBeDefined();
    // Forces actual travel — the site is never the agent's own tile.
    expect(manhattan(a.pos, a.shelterTarget!)).toBeGreaterThanOrEqual(SHELTER_MIN_BUILD_DISTANCE);
  });

  it("does not trigger for a merely-idle agent that isn't genuinely comfortable yet (direct feedback: shelter is a nice-to-have)", () => {
    const world = createWorld(100, 100);
    // Above chooseBehavior's 0.7 "idle" cutoff (so needs.ts would call this
    // at all) but below SHELTER_COMFORT_THRESHOLD (0.85) -- exactly the gap
    // this gate exists to close.
    const a = agent("barely-idle", { pos: { x: 50, y: 50 }, needs: { hunger: 0.75, thirst: 0.75, energy: 1, mateDrive: 0 } });
    world.agents.push(a);

    maybeTriggerShelterBuilding(world, a, seededRng(3));

    expect(a.shelterTarget).toBeUndefined();
  });

  it("a bonded, shelterless pair triggers at a lower comfort level than an unbonded agent (real, testable bias toward building)", () => {
    // Direct instruction: mating before shelter "increases need for
    // shelter" — real, measurable bias, not just "now eligible." Needs sit
    // between the bonded-discounted threshold (0.85 - 0.15 = 0.70) and the
    // ordinary threshold (0.85): an unbonded agent at these needs does NOT
    // trigger, a bonded one DOES.
    const needs = { hunger: 0.8, thirst: 0.8, energy: 1, mateDrive: 0 };
    const world1 = createWorld(100, 100);
    const unbonded = agent("unbonded", { pos: { x: 50, y: 50 }, needs: { ...needs } });
    world1.agents.push(unbonded);
    maybeTriggerShelterBuilding(world1, unbonded, seededRng(3));
    expect(unbonded.shelterTarget).toBeUndefined();

    const world2 = createWorld(100, 100);
    const bonded = agent("bonded", { pos: { x: 50, y: 50 }, needs: { ...needs }, bondedPartnerId: "someone" });
    world2.agents.push(bonded);
    maybeTriggerShelterBuilding(world2, bonded, seededRng(3));
    expect(bonded.shelterTarget).toBeDefined();
  });

  it("does not trigger (or re-pick) while a shelter task is already in progress", () => {
    const world = createWorld(100, 100);
    const a = agent("mid-task", { pos: { x: 50, y: 50 }, shelterTarget: { x: 10, y: 10 } });
    world.agents.push(a);

    maybeTriggerShelterBuilding(world, a, seededRng(1));

    expect(a.shelterTarget).toEqual({ x: 10, y: 10 }); // unchanged
  });

  it("does not trigger when the herd already has a shelter tile nearby", () => {
    const world = createWorld(100, 100);
    setTile(world, "surface", 50, 45, "shelter"); // within SHELTER_SEARCH_RADIUS of the herd centroid
    const a = agent("has-shelter", { pos: { x: 50, y: 50 }, herdId: "herd-a" });
    world.agents.push(a);

    maybeTriggerShelterBuilding(world, a, seededRng(2));

    expect(a.shelterTarget).toBeUndefined();
  });
});

describe("applyShelterBuilding: real spatial task, three real steps", () => {
  it("travels toward the build site over multiple calls before arriving", () => {
    const world = createWorld(100, 100);
    const a = agent("walker", { pos: { x: 10, y: 10 }, shelterTarget: { x: 10, y: 30 } });
    world.agents.push(a);

    applyShelterBuilding(world, a);

    expect(a.behavior).toBe("buildShelter");
    expect(a.pos.y).toBeGreaterThan(10);
    expect(a.shelterTarget).toBeDefined(); // not arrived yet
    expect(a.shelterBuildTicks ?? 0).toBe(0); // hasn't started the time investment
  });

  it("takes multiple ticks of real time investment once arrived — not instant", () => {
    const world = createWorld(100, 100);
    const a = agent("arrived", { pos: { x: 10, y: 10 }, shelterTarget: { x: 10, y: 10 }, shelterBuildTicks: 0 });
    world.agents.push(a);
    const log = new EventLog();

    applyShelterBuilding(world, a, log);

    expect(a.shelterBuildTicks).toBe(1);
    expect(tileAt(world, "surface", 10, 10)?.terrain).toBe("floor"); // not built yet
    expect(log.events.some((e) => e.kind === "shelterBuilt")).toBe(false);
  });

  it("completes the shelter only once SHELTER_BUILD_TICKS have been invested, and fires shelterBuilt", () => {
    const world = createWorld(100, 100);
    const a = agent("builder", { pos: { x: 10, y: 10 }, shelterTarget: { x: 10, y: 10 }, shelterBuildTicks: 0 });
    world.agents.push(a);
    const log = new EventLog();

    for (let i = 0; i < SHELTER_BUILD_TICKS - 1; i++) {
      applyShelterBuilding(world, a, log);
      expect(tileAt(world, "surface", 10, 10)?.terrain).toBe("floor");
    }
    expect(log.events.some((e) => e.kind === "shelterBuilt")).toBe(false);

    applyShelterBuilding(world, a, log);

    expect(tileAt(world, "surface", 10, 10)?.terrain).toBe("shelter");
    expect(a.shelterTarget).toBeUndefined();
    expect(a.shelterBuildTicks).toBeUndefined();
    const event = log.events.find((e) => e.kind === "shelterBuilt");
    expect(event).toBeDefined();
    if (event?.kind === "shelterBuilt") {
      expect(event.agentId).toBe("builder");
      expect(event.pos).toEqual({ x: 10, y: 10 });
    }
  });

  it("cancels (without building) if the site stopped being bare floor before this agent arrived", () => {
    const world = createWorld(100, 100);
    setTile(world, "surface", 10, 10, "water"); // something else claimed it
    const a = agent("displaced", { pos: { x: 10, y: 10 }, shelterTarget: { x: 10, y: 10 }, shelterBuildTicks: 0 });
    world.agents.push(a);

    applyShelterBuilding(world, a);

    expect(a.shelterTarget).toBeUndefined();
    expect(a.shelterBuildTicks).toBeUndefined();
    expect(tileAt(world, "surface", 10, 10)?.terrain).toBe("water"); // untouched
  });
});

describe("shelter-building end-to-end via tickWorld", () => {
  it("an idle, eligible agent picks a distant site, travels, builds, and the tile becomes 'shelter'", () => {
    // A real, spatially-distributed grid of food/water (not one single pair
    // right next to spawn) — matters here: an earlier version of this test
    // placed just one food/water tile next to the agent's spawn point in a
    // mostly-empty 100x100 world, which meant every hunger/thirst dip forced
    // a round trip all the way back to that one spot, however far the
    // in-progress build site was — a real (if artificial) trap that never
    // converged. Real generated maps (and this grid) scatter resources
        // widely enough that an agent is rarely far from *something* to eat or
    // drink, matching how the actual demo scenario behaves.
    const world = createWorld(90, 60);
    for (let x = 5; x < 90; x += 8) {
      for (let y = 5; y < 60; y += 8) {
        setTile(world, "surface", x, y, "food");
        setTile(world, "surface", x + 2, y, "water");
      }
    }
    const a = agent("e2e", { pos: { x: 45, y: 30 } });
    world.agents.push(a);
    const log = new EventLog();

    let built = false;
    for (let i = 0; i < 3000 && !built; i++) {
      tickWorld(world, log, undefined, undefined, seededRng(i + 1));
      // A genderless test fixture's mateDrive still rises every tick
      // (decayNeeds doesn't gate on `sex`), and a genderless agent's own
      // `applyMateSeeking` early-returns without ever resetting it (see
      // reproduction.ts) — an unrelated, pre-existing quirk of chooseBehavior
      // this test isn't about, but left alone it eventually dominates
      // chooseBehavior's urgency ranking and locks this fixture out of
      // "idle" forever, which would make this test about that interaction
      // instead of shelter-building. Zeroed here to isolate what this test
      // actually exercises: a real mate-seeking herd-mate nearby (the demo
      // scenario always has one) would reset it exactly the same way.
      a.needs.mateDrive = 0;
      built = log.events.some((e) => e.kind === "shelterBuilt");
    }

    expect(built).toBe(true);
    const event = log.events.find((e) => e.kind === "shelterBuilt")!;
    if (event.kind === "shelterBuilt") {
      expect(tileAt(world, "surface", event.pos.x, event.pos.y)?.terrain).toBe("shelter");
      // Real travel happened — the build site isn't the agent's spawn tile.
      // Not asserting the full SHELTER_MIN_BUILD_DISTANCE from the original
      // spawn specifically: the production guarantee is "at least that far
      // from wherever the agent was *when it picked the site*," which can
      // differ from its original spawn position if it wandered beforehand
      // (e.g. idle exploration before the shelter trigger fires) — a real
      // gap this test's tighter assertion didn't account for.
      expect(manhattan(event.pos, { x: 45, y: 30 })).toBeGreaterThan(0);
    }
  });
});

describe("shelter concealment reuses bush's exact mechanism", () => {
  it("a 'shelter' tile grants the same concealment as a 'bush' tile (Tile.concealment)", () => {
    const world = createWorld(20, 20);
    setTile(world, "surface", 5, 5, "shelter");
    expect(tileAt(world, "surface", 5, 5)?.concealment).toBe(true);
  });

  it("measurably reduces detection the same way bush already does, in a real predator/prey encounter", () => {
    // Fixtures/rng mirror predation.test.ts's own "bush concealment" describe
    // block exactly (same TEST_MOVE/prey/predator shape, same SAFE_RNG seed)
    // — this is a direct A/B comparison against that existing, passing test,
    // just standing on "shelter" instead of "bush".
    const RULES: HuntRules = { scyther: true };
    const SAFE_RNG = mulberry32(20260904);
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
        maxHp: 10,
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
        maxHp: 20,
        ...overrides,
      };
    }
    const bold = { boldness: 1, aggression: 0.5, sociability: 0.5 };
    // The prey keeps age: 0 (below MIN_EXPLORE_AGE, needs.ts) so it doesn't
    // wander off on its idle turn. The predator gets a real adult age
    // instead of 0 — predation.ts's `isJuvenile` (this session's ontogenetic-
    // niche-shift feature) makes a juvenile predator never hunt independently
    // at all, which would corrupt this test's own "hunt" assertions; the
    // predator's hunger (well below satisfied) already keeps it from
    // exploring regardless of age, so this is safe.
    const ADULT_PREDATOR_AGE = 200;

    // Distance 4 is within HUNT_DETECT_RADIUS (5) normally.
    const openWorld = createWorld(20, 20);
    openWorld.agents.push(prey({ x: 5, y: 5 }, { disposition: bold, age: 0 }), predator({ x: 9, y: 5 }, 0.1, { age: ADULT_PREDATOR_AGE }));
    tickWorld(openWorld, undefined, RULES, undefined, SAFE_RNG);
    expect(openWorld.agents.find((a) => a.id === "scyther-0")!.behavior).toBe("hunt"); // sanity

    const shelterWorld = createWorld(20, 20);
    setTile(shelterWorld, "surface", 5, 5, "shelter");
    shelterWorld.agents.push(prey({ x: 5, y: 5 }, { disposition: bold, age: 0 }), predator({ x: 9, y: 5 }, 0.1, { age: ADULT_PREDATOR_AGE }));
    tickWorld(shelterWorld, undefined, RULES, undefined, SAFE_RNG);
    expect(shelterWorld.agents.find((a) => a.id === "scyther-0")!.behavior).not.toBe("hunt");
  });
});

describe("shelter reduces storm-exposure accumulation (weather.ts's hasCoverNearby)", () => {
  it("counts as real cover, same as tree/bush", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    expect(hasCoverNearby(world, "surface", { x: 20, y: 20 })).toBe(true);
  });

  it("prevents the 'weather' herd-migration trigger from ever firing while a shelter is nearby, unlike no cover at all", () => {
    function member(id: string, pos: { x: number; y: number }): Agent {
      return {
        id,
        species: "bulbasaur",
        pos,
        layer: "surface",
        homeLayer: "surface",
        needs: createNeeds(),
        behavior: "idle",
        herdId: "herd-a",
      };
    }
    const NEVER_WANDER = () => 1;
    const stormCell = () => ({
      id: "storm-1",
      type: "storm" as const,
      center: { x: 30, y: 30 },
      radius: 20,
      startedTick: 0,
      lifespanTicks: 100_000,
      drift: { x: 0, y: 0 },
    });

    const exposedWorld = createWorld(80, 80);
    exposedWorld.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    exposedWorld.weatherCells = [stormCell()];
    // Real cover-seeking destination for pickDestination's preferCover term
    // to actually find — without any biome data at all, there's nowhere for
    // the migration to go, so it would never actually start even once the
    // sustain threshold is crossed (see herdMigration.test.ts's own
    // "weather trigger" tests, which set this up identically).
    exposedWorld.biomeSeeds = [
      { x: 30, y: 30, name: "highland" },
      { x: 70, y: 30, name: "forest" },
    ];
    let exposedMigrated = false;
    for (let i = 0; i < STORM_EXPOSURE_SUSTAIN_TICKS + 5 && !exposedMigrated; i++) {
      exposedWorld.tick += 1;
      updateHerdMigrations(exposedWorld, undefined, NEVER_WANDER);
      exposedMigrated = Boolean(exposedWorld.herdMigrations?.["herd-a"]);
    }
    expect(exposedMigrated).toBe(true); // sanity: without shelter it does trigger

    const shelteredWorld = createWorld(80, 80);
    shelteredWorld.agents.push(member("a", { x: 30, y: 30 }), member("b", { x: 30, y: 30 }));
    shelteredWorld.weatherCells = [stormCell()];
    setTile(shelteredWorld, "surface", 31, 30, "shelter"); // real shelter within hasCoverNearby's scan radius
    for (let i = 0; i < STORM_EXPOSURE_SUSTAIN_TICKS + 5; i++) {
      shelteredWorld.tick += 1;
      updateHerdMigrations(shelteredWorld, undefined, NEVER_WANDER);
    }
    expect(shelteredWorld.herdMigrations?.["herd-a"]).toBeUndefined();
    expect(shelteredWorld.herdStormExposureTicks?.["herd-a"]).toBe(0);
  });
});

describe("decayShelters: abandonment reverts an unused shelter to floor", () => {
  it("does not revert before the sustained-absence threshold", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");

    for (let i = 0; i < SHELTER_ABANDON_TICKS - 1; i++) {
      world.tick += 1;
      decayShelters(world);
    }

    expect(tileAt(world, "surface", 20, 20)?.terrain).toBe("shelter");
  });

  it("reverts to floor once no agent has been nearby for the full sustained-absence threshold, and fires shelterAbandoned", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    const log = new EventLog();

    for (let i = 0; i < SHELTER_ABANDON_TICKS; i++) {
      world.tick += 1;
      decayShelters(world, log);
    }

    expect(tileAt(world, "surface", 20, 20)?.terrain).toBe("floor");
    const event = log.events.find((e) => e.kind === "shelterAbandoned");
    expect(event).toBeDefined();
    if (event?.kind === "shelterAbandoned") {
      expect(event.pos).toEqual({ x: 20, y: 20 });
    }
  });

  it("resets the vacancy counter (never reverts) while a living agent stays within the abandonment radius", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    world.agents.push(agent("resident", { pos: { x: 21, y: 20 } }));

    for (let i = 0; i < SHELTER_ABANDON_TICKS + 50; i++) {
      world.tick += 1;
      decayShelters(world);
    }

    expect(tileAt(world, "surface", 20, 20)?.terrain).toBe("shelter");
    expect(tileAt(world, "surface", 20, 20)?.vacantTicks).toBe(0);
  });

  it("a dead (alive: false) agent nearby does not count as occupancy", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    world.agents.push(agent("corpse", { pos: { x: 21, y: 20 }, alive: false }));

    for (let i = 0; i < SHELTER_ABANDON_TICKS; i++) {
      world.tick += 1;
      decayShelters(world);
    }

    expect(tileAt(world, "surface", 20, 20)?.terrain).toBe("floor");
  });
});

describe("applyShelterResting: the 'incentivize staying' behavior", () => {
  it("returns false (nothing to do) when this species has no shelter anywhere yet", () => {
    const world = createWorld(40, 40);
    const a = agent("no-home", { pos: { x: 20, y: 20 } });
    world.agents.push(a);

    expect(applyShelterResting(world, a)).toBe(false);
    expect(a.pos).toEqual({ x: 20, y: 20 }); // never moved
  });

  it("walks toward a known-but-distant shelter instead of standing still", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 5, "shelter");
    const a = agent("commuter", { pos: { x: 20, y: 20 } });
    world.agents.push(a);
    const log = new EventLog();

    const acted = applyShelterResting(world, a, log);

    expect(acted).toBe(true);
    expect(a.behavior).toBe("restAtShelter");
    expect(a.pos.y).toBeLessThan(20); // stepped toward the shelter at y=5
    expect(log.events.some((e) => e.kind === "behaviorChanged" && e.to === "restAtShelter")).toBe(true);
  });

  it("once at/near home, deposits into the tile's cache each tick, capped at SHELTER_CACHE_MAX", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    const a = agent("resident", { pos: { x: 20, y: 20 } });
    world.agents.push(a);

    applyShelterResting(world, a);
    expect(tileAt(world, "surface", 20, 20)?.cache).toBeCloseTo(SHELTER_CACHE_DEPOSIT_PER_TICK);
    expect(world.shelterCacheDeposited).toBeCloseTo(SHELTER_CACHE_DEPOSIT_PER_TICK);

    // Enough ticks to exceed SHELTER_CACHE_MAX -- deposit stops growing past the cap.
    for (let i = 0; i < 500; i++) applyShelterResting(world, a);
    expect(tileAt(world, "surface", 20, 20)?.cache).toBeLessThanOrEqual(SHELTER_CACHE_MAX);
    expect(tileAt(world, "surface", 20, 20)?.cache).toBeCloseTo(SHELTER_CACHE_MAX);
  });

  it("counts SHELTER_REST_RADIUS as home, not just the exact tile", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    const a = agent("nearby", { pos: { x: 20 + SHELTER_REST_RADIUS, y: 20 } });
    world.agents.push(a);

    applyShelterResting(world, a);

    expect(a.pos).toEqual({ x: 20 + SHELTER_REST_RADIUS, y: 20 }); // didn't need to move
    expect(tileAt(world, "surface", 20, 20)?.cache).toBeGreaterThan(0); // still deposited
  });
});

describe("maybeFeedFromShelterCache: the food-cache safety net", () => {
  it("returns false and touches nothing when there is no shelter nearby at all", () => {
    const world = createWorld(40, 40);
    const a = agent("no-home", { pos: { x: 20, y: 20 }, needs: createNeeds({ hunger: 0.2 }) });
    world.agents.push(a);

    expect(maybeFeedFromShelterCache(world, a)).toBe(false);
    expect(a.needs.hunger).toBe(0.2);
  });

  it("returns false (not a trap) when a nearby shelter's cache is empty -- caller must fall through to normal foraging", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter"); // cache starts at 0
    const a = agent("home-but-hungry", { pos: { x: 20, y: 20 }, needs: createNeeds({ hunger: 0.2 }) });
    world.agents.push(a);

    expect(maybeFeedFromShelterCache(world, a)).toBe(false);
    expect(a.needs.hunger).toBe(0.2); // untouched -- needs.ts's caller falls through to live foraging this same tick
  });

  it("draws SHELTER_CACHE_FEED_AMOUNT from a stocked cache and restores hunger by exactly that much", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    tileAt(world, "surface", 20, 20)!.cache = 1;
    const a = agent("fed-from-home", { pos: { x: 20, y: 20 }, needs: createNeeds({ hunger: 0.2 }) });
    world.agents.push(a);
    const log = new EventLog();

    const ate = maybeFeedFromShelterCache(world, a, log);

    expect(ate).toBe(true);
    expect(a.needs.hunger).toBeCloseTo(0.2 + SHELTER_CACHE_FEED_AMOUNT);
    expect(tileAt(world, "surface", 20, 20)?.cache).toBeCloseTo(1 - SHELTER_CACHE_FEED_AMOUNT);
    expect(world.shelterCacheWithdrawn).toBeCloseTo(SHELTER_CACHE_FEED_AMOUNT);
    expect(a.behavior).toBe("restAtShelter");
  });

  it("a near-empty cache restores only what's actually left, never more", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    tileAt(world, "surface", 20, 20)!.cache = 0.1; // less than SHELTER_CACHE_FEED_AMOUNT
    const a = agent("partial", { pos: { x: 20, y: 20 }, needs: createNeeds({ hunger: 0.2 }) });
    world.agents.push(a);

    maybeFeedFromShelterCache(world, a);

    expect(a.needs.hunger).toBeCloseTo(0.3); // +0.1, not the full 0.4
    expect(tileAt(world, "surface", 20, 20)?.cache).toBeCloseTo(0);
  });

  it("only reaches from within SHELTER_REST_RADIUS -- a distant stocked shelter doesn't feed a hungry agent that hasn't walked home", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    tileAt(world, "surface", 20, 20)!.cache = 1;
    const a = agent("far-away", { pos: { x: 20, y: 20 + SHELTER_REST_RADIUS + 5 }, needs: createNeeds({ hunger: 0.2 }) });
    world.agents.push(a);

    expect(maybeFeedFromShelterCache(world, a)).toBe(false);
    expect(a.needs.hunger).toBe(0.2);
  });
});

describe("shelter proximity buff: heal + needs-decay bonus, composed via decayNeeds/applyHealOverTime's existing multiplier hooks", () => {
  it("SHELTER_NEEDS_DECAY_MULTIPLIER measurably slows hunger/thirst decay versus baseline", () => {
    const baseline = createNeeds({ hunger: 0.9, thirst: 0.9 });
    const sheltered = createNeeds({ hunger: 0.9, thirst: 0.9 });

    decayNeeds(baseline);
    decayNeeds(sheltered, 1, false, 1, SHELTER_NEEDS_DECAY_MULTIPLIER);

    expect(sheltered.hunger).toBeGreaterThan(baseline.hunger);
    expect(sheltered.thirst).toBeGreaterThan(baseline.thirst);
  });

  it("SHELTER_HEAL_MULTIPLIER measurably speeds healing versus baseline, for a fed/watered agent", () => {
    const baseline: Agent = agent("baseline-heal", { hp: 50, maxHp: 100, needs: createNeeds({ hunger: 1, thirst: 1 }) });
    const sheltered: Agent = agent("sheltered-heal", { hp: 50, maxHp: 100, needs: createNeeds({ hunger: 1, thirst: 1 }) });

    applyHealOverTime(baseline, 1);
    applyHealOverTime(sheltered, SHELTER_HEAL_MULTIPLIER);

    expect(sheltered.hp!).toBeGreaterThan(baseline.hp!);
  });

  it("real end-to-end via tickWorld: a resting buildsShelter agent's hunger drains slower than an identical agent with no shelter", () => {
    const withShelter = createWorld(40, 40);
    setTile(withShelter, "surface", 20, 20, "shelter");
    const resident = agent("resident", { pos: { x: 20, y: 20 }, needs: createNeeds({ hunger: 0.9, thirst: 0.9 }) });
    withShelter.agents.push(resident);

    const noShelter = createWorld(40, 40);
    const wanderer = agent("wanderer", { pos: { x: 20, y: 20 }, needs: createNeeds({ hunger: 0.9, thirst: 0.9 }) });
    noShelter.agents.push(wanderer);

    for (let i = 0; i < 50; i++) {
      tickWorld(withShelter, undefined, undefined, undefined, seededRng(i + 1));
      tickWorld(noShelter, undefined, undefined, undefined, seededRng(i + 1));
    }

    expect(resident.needs.hunger).toBeGreaterThan(wanderer.needs.hunger);
  });
});

describe("real-run shape: shelter abandonment vs. an actively-used shelter with the new resting/cache incentive", () => {
  it("a herd that keeps resting at its shelter never lets it decay -- vacantTicks stays at 0 the entire abandonment window", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    const a = agent("stays-home", { pos: { x: 20, y: 20 }, needs: createNeeds() });
    world.agents.push(a);
    const log = new EventLog();

    for (let i = 0; i < SHELTER_ABANDON_TICKS + 50; i++) {
      world.tick += 1;
      // Resting keeps this agent within SHELTER_ABANDON_RADIUS the whole time
      // (SHELTER_REST_RADIUS is well inside it), the same real mechanical
      // reason a well-used shelter shouldn't accumulate vacantTicks the way
      // an ignored one does.
      applyShelterResting(world, a);
      decayShelters(world, log);
    }

    expect(tileAt(world, "surface", 20, 20)?.terrain).toBe("shelter");
    expect(tileAt(world, "surface", 20, 20)?.vacantTicks).toBe(0);
    expect(log.events.some((e) => e.kind === "shelterAbandoned")).toBe(false);
  });

  it("abandonment clears the accumulated cache along with the structure itself", () => {
    const world = createWorld(40, 40);
    setTile(world, "surface", 20, 20, "shelter");
    tileAt(world, "surface", 20, 20)!.cache = 0.8;

    for (let i = 0; i < SHELTER_ABANDON_TICKS; i++) {
      world.tick += 1;
      decayShelters(world);
    }

    expect(tileAt(world, "surface", 20, 20)?.terrain).toBe("floor");
    expect(tileAt(world, "surface", 20, 20)?.cache).toBeUndefined();
  });
});
