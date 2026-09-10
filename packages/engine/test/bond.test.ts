import { describe, expect, it } from "vitest";
import { createWorld, setTile, tileAt } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { advancePlayerTurn, tickWorld } from "../src/simulation.js";
import { applyPlayerAction } from "../src/player.js";
import { addItem, countOf } from "../src/inventory.js";
import { threatSignatureOf, playerFleeRadius } from "../src/threat.js";
import { FLEE_DETECT_RADIUS } from "../src/predation.js";
import { rapportScore } from "../src/rapport.js";
import { FOLLOW_ENTRY_RADIUS, TRUST_CURIOUS, TRUST_TOLERANT, tickFollowers, trustStage } from "../src/trust.js";
import { examine } from "../src/tells.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules, World } from "../src/types.js";

function human(x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    controlledBy: "player",
    maxHp: 20,
    hp: 20,
    level: 5,
    stats: { hp: 20, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
    ...extra,
  };
}

function prey(id: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "sandshrew",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    sex: "female",
    maxHp: 22,
    hp: 22,
    level: 6,
    stats: { hp: 22, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
    ...extra,
  };
}

/** Rules where nothing hunts anything: the only thing prey can react to is the player's signature. */
const NO_HUNTERS: HuntRules = {};

function openWorld(): World {
  const world = createWorld(30, 30, 1);
  world.items = { club: { key: "club", name: "Club", weight: 3, slot: "held", threat: 0.5 }, cloak: { key: "cloak", name: "Cloak", weight: 2, slot: "worn", threat: -0.4 } };
  return world;
}

describe("threat signature (ROADMAP M6)", () => {
  it("is 0 for anything but the player, 1 standing still, halves crouched, grows with a club, shrinks with a cloak", () => {
    const world = openWorld();
    const me = human(10, 10);
    expect(threatSignatureOf(world, prey("s", 1, 1))).toBe(0);
    expect(threatSignatureOf(world, me)).toBe(1);
    me.posture = "crouch";
    expect(threatSignatureOf(world, me)).toBe(0.5);
    me.posture = undefined;
    addItem(me, "club", 1, 3);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "club" });
    expect(threatSignatureOf(world, me)).toBe(1.5);
    applyPlayerAction(world, me, { kind: "stow" });
    addItem(me, "cloak", 1, 2);
    applyPlayerAction(world, me, { kind: "equip", itemKey: "cloak" });
    expect(threatSignatureOf(world, me)).toBeCloseTo(0.6);
    // A step just taken reads as movement.
    me.equipment = undefined;
    world.agents.push(me);
    advancePlayerTurn(world, { kind: "move", dx: 1, dy: 0 });
    expect(threatSignatureOf(world, me)).toBe(1.25);
    expect(playerFleeRadius(world, me, FLEE_DETECT_RADIUS)).toBe(5);
  });

  it("prey flee a standing human at 3 tiles, but not a crouched, still one — and the human is no predator any more", () => {
    const run = (crouch: boolean) => {
      const world = openWorld();
      const me = human(10, 10, { posture: crouch ? "crouch" : undefined });
      const s = prey("s", 13, 10);
      world.agents.push(me, s);
      for (let i = 0; i < 6; i++) tickWorld(world, undefined, NO_HUNTERS);
      return s;
    };
    const standing = run(false);
    expect(standing.behavior === "flee" || Math.abs(standing.pos.x - 10) > 3).toBe(true);
    const crouched = run(true);
    expect(crouched.behavior).not.toBe("flee");
    expect(crouched.fleeingFromId).toBeUndefined();
    expect(human(0, 0).isPredator).toBeUndefined();
  });

  it("trust shrinks the radius: a tolerant creature lets a crouched human to 1 tile; a bonded one never flees the player", () => {
    const world = openWorld();
    const me = human(10, 10, { posture: "crouch" });
    const tolerant = prey("t", 11, 10, { rapport: { me: { score: TRUST_TOLERANT + 0.01, lastInteractionTick: 0 } } });
    world.agents.push(me, tolerant);
    for (let i = 0; i < 6; i++) tickWorld(world, undefined, NO_HUNTERS);
    expect(tolerant.behavior).not.toBe("flee");
    const world2 = openWorld();
    const me2 = human(10, 10); // standing, moving would be worse — still no flee when bonded
    const bonded = prey("b", 11, 10, { rapport: { me: { score: 0.9, lastInteractionTick: 0 } } });
    world2.agents.push(me2, bonded);
    for (let i = 0; i < 6; i++) tickWorld(world2, undefined, NO_HUNTERS);
    expect(bonded.behavior).not.toBe("flee");
  });

  it("a crouched step costs more action energy than a standing one", () => {
    const worldA = openWorld();
    const a = human(5, 5);
    worldA.agents.push(a);
    const standingTicks = advancePlayerTurn(worldA, { kind: "move", dx: 1, dy: 0 }) + advancePlayerTurn(worldA, { kind: "move", dx: 1, dy: 0 });
    const worldB = openWorld();
    const b = human(5, 5, { posture: "crouch" });
    worldB.agents.push(b);
    const crouchedTicks = advancePlayerTurn(worldB, { kind: "move", dx: 1, dy: 0 }) + advancePlayerTurn(worldB, { kind: "move", dx: 1, dy: 0 });
    expect(crouchedTicks).toBeGreaterThan(standingTicks);
  });
});

describe("offer (the Feed verb)", () => {
  it("sets a berry down beside you; whoever eats it remembers you", () => {
    const world = openWorld();
    const me = human(10, 10);
    addItem(me, "food", 2, 1);
    const s = prey("s", 12, 10, { needs: createNeeds({ hunger: 0.2 }) });
    world.agents.push(me, s);
    expect(applyPlayerAction(world, me, { kind: "offer" })).toBe(true);
    expect(countOf(me, "food")).toBe(1);
    const offered: { x: number; y: number }[] = [];
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) if (tileAt(world, "surface", x, y)?.offeredBy === "me") offered.push({ x, y });
    expect(offered).toHaveLength(1);
    // Set it down and step back: a wary creature will not come within the
    // flee radius (4, manhattan) of a standing human. Six tiles off is outside it.
    me.pos = { x: 4, y: 10 };
    // The hungry Sandshrew finds it and eats it.
    const log = new EventLog();
    for (let i = 0; i < 200 && rapportScore(s, "me", world.tick) === 0; i++) tickWorld(world, log, NO_HUNTERS);
    expect(rapportScore(s, "me", world.tick)).toBeGreaterThan(0);
    expect(s.rapport?.me?.memories?.some((m) => m.reason === "receivedFood")).toBe(true);
    expect(me.rapport?.s?.memories?.some((m) => m.reason === "gaveFood")).toBe(true);
    expect(tileAt(world, "surface", offered[0]!.x, offered[0]!.y)?.offeredBy).toBeUndefined();
  });

  it("a set-down berry is a treat: a well-fed creature within reach still comes for it, once per cooldown", () => {
    const world = openWorld();
    const me = human(10, 10, { posture: "crouch" });
    addItem(me, "food", 3, 1);
    const s = prey("s", 13, 10); // full, not hungry
    world.agents.push(me, s);
    applyPlayerAction(world, me, { kind: "offer" });
    me.pos = { x: 5, y: 10 };
    for (let i = 0; i < 40 && rapportScore(s, "me", world.tick) === 0; i++) tickWorld(world, undefined, NO_HUNTERS);
    expect(rapportScore(s, "me", world.tick)).toBeGreaterThan(0);
    expect(s.lastTreatTick).toBeDefined();
    // A second berry right away is ignored until the cooldown passes.
    me.pos = { x: 10, y: 10 };
    applyPlayerAction(world, me, { kind: "offer" });
    me.pos = { x: 5, y: 10 };
    const scoreAfterOne = rapportScore(s, "me", world.tick);
    for (let i = 0; i < 20; i++) tickWorld(world, undefined, NO_HUNTERS);
    expect(rapportScore(s, "me", world.tick)).toBeLessThanOrEqual(scoreAfterOne);
  });

  it("refuses with no berries, and with no free ground", () => {
    const world = openWorld();
    const me = human(10, 10);
    world.agents.push(me);
    expect(applyPlayerAction(world, me, { kind: "offer" })).toBe(false);
    addItem(me, "food", 1, 1);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) setTile(world, "surface", 10 + dx, 10 + dy, "wall");
    expect(applyPlayerAction(world, me, { kind: "offer" })).toBe(false);
    expect(countOf(me, "food")).toBe(1);
  });
});

describe("presence: a creature that falls asleep near the player remembers being watched over", () => {
  it("keptWatch/sleptSafely fire for the player like for any awake agent", () => {
    const world = openWorld();
    // A tired creature walks off to build a shelter first (traced: 13 tiles,
    // ~50 ticks), so presence means *staying with it*: the crouched human
    // keeps three tiles off — outside a wary creature's radius (2), inside
    // the watch radius — every tick until it goes under.
    const me = human(13, 10, { posture: "crouch" });
    // mateDrive pinned: a creature that wants a mate never sleeps, even at
    // zero energy (see TODO.md, "energy has no teeth").
    const s = prey("s", 10, 10, { needs: createNeeds({ energy: 0.1, mateDrive: 0 }) });
    // A shelter to sleep in, or it spends 40 ticks building one and by then
    // mate drive has climbed past its threshold and it never sleeps at all
    // (traced; TODO.md "mate drive beats sleep").
    setTile(world, "surface", 10, 10, "shelter");
    world.agents.push(me, s);
    for (let i = 0; i < 120 && !s.asleep; i++) {
      me.pos = { x: Math.min(29, s.pos.x + 3), y: s.pos.y };
      tickWorld(world, undefined, NO_HUNTERS);
    }
    expect(s.asleep).toBe(true);
    expect(s.rapport?.me?.memories?.some((m) => m.reason === "sleptSafely")).toBe(true);
    expect(me.rapport?.s?.memories?.some((m) => m.reason === "keptWatch")).toBe(true);
  });
});

describe("trust stages and the follower door", () => {
  it("stages follow the creature's edge toward the player, and examine says so", () => {
    const world = openWorld();
    const me = human(10, 10);
    const s = prey("s", 11, 10);
    world.agents.push(me, s);
    expect(trustStage(world, s, "me")).toBe("wary");
    s.rapport = { me: { score: TRUST_TOLERANT + 0.01, lastInteractionTick: 0 } };
    expect(trustStage(world, s, "me")).toBe("tolerant");
    expect(examine(world, s, { observer: me })).toContain("She has stopped watching you.");
    s.rapport.me!.score = TRUST_CURIOUS + 0.01;
    expect(examine(world, s, { observer: me })).toContain("She comes a little closer.");
  });

  it("a curious creature within reach starts following, walks with you, and stops when trust is gone", () => {
    const world = openWorld();
    const me = human(10, 10);
    // West of the player, so the walk east never has to step through it.
    const s = prey("s", 9, 10, { rapport: { me: { score: TRUST_CURIOUS + 0.05, lastInteractionTick: 0 } } });
    world.agents.push(me, s);
    const log = new EventLog();
    tickFollowers(world, me, log, () => 0); // rng 0 always passes the roll
    expect(s.followingId).toBe("me");
    expect(log.events.some((e) => e.kind === "startedFollowing" && e.agentId === "s")).toBe(true);
    // Walk 12 tiles east; the follower keeps within reach.
    for (let i = 0; i < 12; i++) advancePlayerTurn(world, { kind: "move", dx: 1, dy: 0 }, log, NO_HUNTERS, undefined, () => 0.99);
    expect(me.pos.x).toBe(22);
    expect(Math.max(Math.abs(s.pos.x - me.pos.x), Math.abs(s.pos.y - me.pos.y))).toBeLessThanOrEqual(3);
    expect(examine(world, s, { observer: me })).toContain("is following you");
    // Trust gone: it stops.
    s.rapport = {};
    tickFollowers(world, me, log, () => 0);
    expect(s.followingId).toBeUndefined();
    expect(log.events.some((e) => e.kind === "stoppedFollowing" && e.agentId === "s")).toBe(true);
  });

  it("a wary creature never follows, and one out of range is not asked", () => {
    const world = openWorld();
    const me = human(10, 10);
    const wary = prey("w", 11, 10);
    const far = prey("f", 10 + FOLLOW_ENTRY_RADIUS + 3, 10, { rapport: { me: { score: 0.9, lastInteractionTick: 0 } } });
    world.agents.push(me, wary, far);
    tickFollowers(world, me, undefined, () => 0);
    expect(wary.followingId).toBeUndefined();
    expect(far.followingId).toBeUndefined();
  });
});
