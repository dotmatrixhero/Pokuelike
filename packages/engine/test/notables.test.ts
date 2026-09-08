import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import { NOTABLE_TITLE_MIN_THRESHOLDS, updateNotables } from "../src/notables.js";
import { adjustRapport } from "../src/rapport.js";
import { grantExp, NOTABLE_XP_MULTIPLIER } from "../src/leveling.js";

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

describe("notables: record-holder transfer mechanism", () => {
  it("nobody holds a title below the real minimum threshold", () => {
    const world = createWorld(10, 10);
    const a = agent("a", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero - 1 });
    world.agents.push(a);

    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.hero).toBeUndefined();
    expect(a.notableTitle).toBeUndefined();
  });

  it("crosses the threshold: a first-ever claim is made and an agent-level flag is set", () => {
    const world = createWorld(10, 10);
    const log = new EventLog();
    const a = agent("a", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero });
    world.agents.push(a);

    updateNotables(world, log, undefined, () => 0);

    expect(world.notables?.hero).toEqual({ agentId: "a", value: NOTABLE_TITLE_MIN_THRESHOLDS.hero, claimedAtTick: 0 });
    expect(a.notableTitle).toBe("hero");
    const claimed = log.events.find((e) => e.kind === "titleClaimed");
    expect(claimed).toMatchObject({ title: "hero", agentId: "a" });
  });

  it("the title transfers to whichever of two agents' real, fixed kill counts is higher — the unconfounded proof", () => {
    const world = createWorld(10, 10);
    const log = new EventLog();
    const low = agent("low", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero });
    const high = agent("high", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero + 1 });
    world.agents.push(low, high);

    // Tick once with only `low` qualifying-relevant — both present from the
    // start, so the very first tick should already crown the higher one.
    updateNotables(world, log, undefined, () => 0);

    expect(world.notables?.hero?.agentId).toBe("high");
    expect(high.notableTitle).toBe("hero");
    expect(low.notableTitle).toBeUndefined();

    // Now `low` genuinely surpasses `high` — the exact same comparison
    // flips the other way purely because the tracked stat changed, nothing
    // else.
    low.lifetimeKills = high.lifetimeKills! + 5;
    updateNotables(world, log, undefined, () => 0);

    expect(world.notables?.hero?.agentId).toBe("low");
    expect(low.notableTitle).toBe("hero");
    expect(high.notableTitle).toBeUndefined();
    const claims = log.events.filter((e) => e.kind === "titleClaimed" && e.title === "hero");
    expect(claims).toHaveLength(2);
    expect((claims[1] as { previousHolderId?: string }).previousHolderId).toBe("high");
  });

  it("a dead incumbent's title transfers to the next-best living challenger", () => {
    const world = createWorld(10, 10);
    const holder = agent("holder", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero + 10 });
    const challenger = agent("challenger", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero });
    world.agents.push(holder, challenger);
    updateNotables(world, undefined, undefined, () => 0);
    expect(world.notables?.hero?.agentId).toBe("holder");

    holder.alive = false;
    const log = new EventLog();
    updateNotables(world, log, undefined, () => 0);

    expect(world.notables?.hero?.agentId).toBe("challenger");
    expect(challenger.notableTitle).toBe("hero");
    expect(holder.notableTitle).toBeUndefined();
    expect(log.events.some((e) => e.kind === "titleLost" && e.agentId === "holder" && e.reason === "died")).toBe(true);
  });

  it("a dead incumbent with no qualifying living challenger leaves the title genuinely unclaimed", () => {
    const world = createWorld(10, 10);
    const holder = agent("holder", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero });
    world.agents.push(holder);
    updateNotables(world, undefined, undefined, () => 0);
    expect(world.notables?.hero?.agentId).toBe("holder");

    holder.alive = false;
    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.hero).toBeUndefined();
    expect(holder.notableTitle).toBeUndefined();
  });

  it("one title per agent: a challenger already holding a different title is skipped in favor of the next-best untitled agent", () => {
    const world = createWorld(10, 10);
    // `star` would be the best hero AND the best builder, but should only
    // ever hold one title at a time.
    const star = agent("star", { lifetimeKills: 100, lifetimeShelterTicks: 100 });
    const runnerUpBuilder = agent("runnerUp", { lifetimeShelterTicks: NOTABLE_TITLE_MIN_THRESHOLDS.builder });
    world.agents.push(star, runnerUpBuilder);

    updateNotables(world, undefined, undefined, () => 0);

    // TITLE_ORDER processes "hero" before "builder" — star claims hero first.
    expect(world.notables?.hero?.agentId).toBe("star");
    expect(star.notableTitle).toBe("hero");
    // builder's slot goes to the next-best UNTITLED agent, not left vacant
    // just because the raw-best agent is unavailable.
    expect(world.notables?.builder?.agentId).toBe("runnerUp");
    expect(runnerUpBuilder.notableTitle).toBe("builder");
  });

  it("The Rival: the most intensely negative live rapport edge, magnitude only", () => {
    const world = createWorld(10, 10);
    const a = agent("a");
    const b = agent("b");
    world.agents.push(a, b);
    adjustRapport(world, a, "b", -(NOTABLE_TITLE_MIN_THRESHOLDS.rival + 0.1), () => 0.5);

    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.rival?.agentId).toBe("a");
    expect(a.notableTitle).toBe("rival");
  });

  it("The Elder: highest age among living agents that actually track age (absent age never wins)", () => {
    const world = createWorld(10, 10);
    const untracked = agent("untracked"); // no `age` — a founder, per Agent.age's own doc comment
    const tracked = agent("tracked", { age: NOTABLE_TITLE_MIN_THRESHOLDS.elder });
    world.agents.push(untracked, tracked);

    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.elder?.agentId).toBe("tracked");
  });

  it("The Wanderer: live Manhattan distance from birthPos, not homePos", () => {
    const world = createWorld(200, 200);
    const near = agent("near", { birthPos: { x: 0, y: 0 }, pos: { x: 5, y: 5 } });
    const far = agent("far", { birthPos: { x: 0, y: 0 }, pos: { x: NOTABLE_TITLE_MIN_THRESHOLDS.wanderer, y: 0 } });
    world.agents.push(near, far);

    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.wanderer?.agentId).toBe("far");
    expect(far.notableTitle).toBe("wanderer");
  });

  it("The Beloved/The Gatherer/The Builder all key off their own lifetime counters", () => {
    const world = createWorld(10, 10);
    const a = agent("a", { lifetimeOffspring: NOTABLE_TITLE_MIN_THRESHOLDS.beloved });
    const b = agent("b", { lifetimeFoodDeliveries: NOTABLE_TITLE_MIN_THRESHOLDS.gatherer });
    const c = agent("c", { lifetimeShelterTicks: NOTABLE_TITLE_MIN_THRESHOLDS.builder });
    world.agents.push(a, b, c);

    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.beloved?.agentId).toBe("a");
    expect(world.notables?.gatherer?.agentId).toBe("b");
    expect(world.notables?.builder?.agentId).toBe("c");
  });

  it("The Giant Slayer: keys off its own lifetime counter, same as Beloved/Gatherer/Builder", () => {
    const world = createWorld(10, 10);
    const a = agent("a", { lifetimeGiantSlayerKills: NOTABLE_TITLE_MIN_THRESHOLDS.giantSlayer });
    world.agents.push(a);

    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.giantSlayer?.agentId).toBe("a");
    expect(a.notableTitle).toBe("giantSlayer");
  });

  it("The Kingslayer: keys off its own lifetime counter, same as Beloved/Gatherer/Builder", () => {
    const world = createWorld(10, 10);
    const a = agent("a", { lifetimeKingslayerKills: NOTABLE_TITLE_MIN_THRESHOLDS.kingslayer });
    world.agents.push(a);

    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.kingslayer?.agentId).toBe("a");
    expect(a.notableTitle).toBe("kingslayer");
  });

  it("The Savant: a real, deeply-chosen move-tree branch (by leaning) qualifies; a shallow one doesn't", () => {
    const world = createWorld(10, 10);
    const tree = {
      n1: { id: "n1", name: "n1", cost: 1, leaning: "aggression" as const },
      n2: { id: "n2", name: "n2", cost: 1, leaning: "aggression" as const },
      n3: { id: "n3", name: "n3", cost: 1, leaning: "aggression" as const },
      n4: { id: "n4", name: "n4", cost: 1, leaning: "aggression" as const },
      n5: { id: "n5", name: "n5", cost: 1, leaning: "aggression" as const },
      n6: { id: "n6", name: "n6", cost: 1, leaning: "aggression" as const },
    };
    const ctx = { getProfile: () => undefined, resolveMove: () => ({ id: "m", name: "m", shape: { kind: "point" as const }, type: "normal" as const, category: "physical" as const, power: 10, accuracy: 100, cooldownTicks: 1, tree }) };

    const shallow = agent("shallow", { moveTreeChoices: { M: ["n1", "n2", "n3"] } });
    const deep = agent("deep", { moveTreeChoices: { M: ["n1", "n2", "n3", "n4", "n5", "n6"] } });
    world.agents.push(shallow, deep);

    updateNotables(world, undefined, ctx, () => 0);

    expect(world.notables?.savant?.agentId).toBe("deep");
    expect(deep.notableTitle).toBe("savant");
    expect(shallow.notableTitle).toBeUndefined();
  });

  it("an egg is never eligible for any title (isLivingNonEgg excludes it)", () => {
    const world = createWorld(10, 10);
    const egg = agent("egg", { isEgg: true, lifetimeKills: 1000, age: 1000 });
    world.agents.push(egg);

    updateNotables(world, undefined, undefined, () => 0);

    expect(world.notables?.hero).toBeUndefined();
    expect(world.notables?.elder).toBeUndefined();
  });
});

describe("notables: random-chance grant gate", () => {
  it("an eligible challenger stays uncrowned on a tick the grant roll misses, then claims once it hits", () => {
    const world = createWorld(10, 10);
    const log = new EventLog();
    const a = agent("a", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero });
    world.agents.push(a);

    // rng() returns 1 (never < any chance in (0,1)) — the roll always misses.
    updateNotables(world, log, undefined, () => 1);
    expect(world.notables?.hero).toBeUndefined();
    expect(a.notableTitle).toBeUndefined();
    expect(log.events.some((e) => e.kind === "titleClaimed")).toBe(false);

    // Same still-eligible challenger, this time the roll hits (0 < any chance).
    updateNotables(world, log, undefined, () => 0);
    expect(world.notables?.hero?.agentId).toBe("a");
    expect(a.notableTitle).toBe("hero");
  });

  it("vacating a dead incumbent's title is NOT gated by the grant roll", () => {
    const world = createWorld(10, 10);
    const holder = agent("holder", { lifetimeKills: NOTABLE_TITLE_MIN_THRESHOLDS.hero });
    world.agents.push(holder);
    updateNotables(world, undefined, undefined, () => 0);
    expect(world.notables?.hero?.agentId).toBe("holder");

    holder.alive = false;
    // Roll always misses, but the title should still vacate immediately —
    // this path isn't gated at all.
    updateNotables(world, undefined, undefined, () => 1);
    expect(world.notables?.hero).toBeUndefined();
    expect(holder.notableTitle).toBeUndefined();
  });
});

describe("notables: XP-multiplier payoff", () => {
  it("a title-holder's grantExp is multiplied by NOTABLE_XP_MULTIPLIER; a non-holder's is not", () => {
    const world = createWorld(10, 10);
    const holder = agent("holder", { notableTitle: "hero", exp: 0 });
    const plain = agent("plain", { exp: 0 });
    world.agents.push(holder, plain);

    grantExp(world, holder, 10);
    grantExp(world, plain, 10);

    expect(holder.exp).toBeCloseTo(10 * NOTABLE_XP_MULTIPLIER, 5);
    expect(plain.exp).toBe(10);
  });
});
