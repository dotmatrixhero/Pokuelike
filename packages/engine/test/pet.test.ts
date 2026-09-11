import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { applyPlayerAction } from "../src/player.js";
import { applyPet, canPet, PET_COOLDOWN_TICKS } from "../src/pet.js";
import { rapportScore } from "../src/rapport.js";
import { EventLog } from "../src/events.js";
import { mulberry32 } from "../src/rng.js";
import type { Agent, World } from "../src/types.js";

/**
 * Direct ask: "And finally I want the ability to pet a Pokémon to try and gain
 * rapport. Need to be in 1unit range, Pokémon can react poorly, walk away, or
 * even clash. But if you have high rapport it tends to work better."
 */

function human(x: number, y: number): Agent {
  return {
    id: "player",
    species: "human",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1 },
    behavior: "idle",
    controlledBy: "player",
    hp: 40,
    maxHp: 40,
    stats: { hp: 40, attack: 20, defense: 20, spAttack: 20, spDefense: 20, speed: 20 },
  } as unknown as Agent;
}

function beast(id: string, x: number, y: number, trustScore = 0): Agent {
  const a = {
    id,
    species: "venonat",
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: { hunger: 1, thirst: 1, energy: 1 },
    behavior: "idle",
    hp: 30,
    maxHp: 30,
    stats: { hp: 30, attack: 20, defense: 15, spAttack: 15, spDefense: 15, speed: 25 },
    moves: [
      // `cooldownTicks` is NOT optional in practice: `pickBestMove` scores
      // `1 / (1 + w * move.cooldownTicks)`, so leaving it off makes the score
      // NaN and the move is silently never picked. Cost half an hour once.
      { id: "tackle", name: "Tackle", type: "normal", category: "physical", power: 40, accuracy: 100, pp: 20, cooldownTicks: 2, shape: { kind: "point" }, range: { min: 1, max: 1 } },
    ],
  } as unknown as Agent;
  if (trustScore !== 0) a.rapport = { player: { score: trustScore, lastInteractionTick: 0, towardPlayer: true } };
  return a;
}

function scene(trustScore = 0): { world: World; me: Agent; them: Agent } {
  const world = createWorld(16, 16, 11);
  const me = human(8, 8);
  const them = beast("venonat-0", 9, 8, trustScore);
  world.agents.push(me, them);
  return { world, me, them };
}

/** A generator that returns the given rolls in order, so an outcome can be named rather than hoped for. */
function rolls(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

const walkableEverywhere = () => true;

describe("reach", () => {
  it("is one unit, diagonals included", () => {
    const { world, me, them } = scene();
    expect(canPet(world, me, them)).toBe(true);
    them.pos = { x: 9, y: 9 };
    expect(canPet(world, me, them)).toBe(true);
    them.pos = { x: 10, y: 8 };
    expect(canPet(world, me, them)).toBe(false);
  });

  it("refuses a corpse, an egg, yourself, and anything on another layer", () => {
    const { world, me, them } = scene();
    expect(canPet(world, me, me)).toBe(false);
    them.alive = false;
    expect(canPet(world, me, them)).toBe(false);
    them.alive = true;
    them.isEgg = true;
    expect(canPet(world, me, them)).toBe(false);
    them.isEgg = false;
    them.layer = "underground";
    expect(canPet(world, me, them)).toBe(false);
  });
});

describe("higher rapport tends to work better", () => {
  /**
   * The ask's actual requirement, measured rather than asserted about one
   * lucky roll: across many attempts at each trust stage, acceptance should
   * rise with trust and biting should fall. Fresh scene per attempt so a
   * cooldown or a step-back from the previous one cannot contaminate the
   * next — that exact artifact has bitten this project before.
   */
  function sample(trustScore: number, attempts: number): { accepted: number; clashed: number } {
    let accepted = 0;
    let clashed = 0;
    const rng = mulberry32(99);
    for (let i = 0; i < attempts; i++) {
      const { world, me, them } = scene(trustScore);
      const result = applyPet(world, me, them, new EventLog(), undefined, rng, walkableEverywhere)!;
      if (result.outcome === "accepted") accepted++;
      if (result.outcome === "clashed") clashed++;
    }
    return { accepted, clashed };
  }

  it("a bonded creature accepts far more often than a wary one, and never bites", () => {
    const wary = sample(0, 400);
    const bonded = sample(0.9, 400);
    expect(bonded.accepted).toBeGreaterThan(wary.accepted * 3);
    expect(bonded.clashed).toBe(0);
    expect(wary.clashed).toBeGreaterThan(0);
  });

  it("the gradient is monotonic across all four stages", () => {
    const accepted = [0, 0.1, 0.3, 0.9].map((t) => sample(t, 400).accepted);
    for (let i = 1; i < accepted.length; i++) expect(accepted[i]!).toBeGreaterThan(accepted[i - 1]!);
  });
});

describe("outcomes", () => {
  it("accepted raises the creature's rapport toward the player", () => {
    const { world, me, them } = scene(0.9);
    const before = rapportScore(them, me.id, world.tick);
    const result = applyPet(world, me, them, new EventLog(), undefined, rolls(0.01), walkableEverywhere)!;
    expect(result.outcome).toBe("accepted");
    expect(rapportScore(them, me.id, world.tick)).toBeGreaterThan(before);
    expect(them.rapport![me.id]!.memories?.some((m) => m.reason === "petted")).toBe(true);
  });

  it("pulling away steps them out of reach and sours it slightly", () => {
    const { world, me, them } = scene(0.1);
    const before = rapportScore(them, me.id, world.tick);
    const result = applyPet(world, me, them, new EventLog(), undefined, rolls(0.7), walkableEverywhere)!;
    expect(result.outcome).toBe("pulledAway");
    expect(them.pos).not.toEqual({ x: 9, y: 8 });
    expect(rapportScore(them, me.id, world.tick)).toBeLessThan(before);
  });

  it("a clash is a real hit through the ordinary combat pipeline", () => {
    const { world, me, them } = scene(0);
    const hp = me.hp!;
    const result = applyPet(world, me, them, new EventLog(), undefined, rolls(0.99, 0.01, 0.01, 0.01, 0.01), walkableEverywhere)!;
    expect(result.outcome).toBe("clashed");
    expect(me.hp!).toBeLessThan(hp);
  });

  it("the souring outcomes move the score but write NO 'petted' memory", () => {
    const { world, me, them } = scene(0.1);
    applyPet(world, me, them, new EventLog(), undefined, rolls(0.7), walkableEverywhere);
    // The prose would otherwise read "He has petted me" about a flinch.
    expect(them.rapport?.[me.id]?.memories?.some((m) => m.reason === "petted") ?? false).toBe(false);
    expect(rapportScore(them, me.id, world.tick)).toBeLessThan(0.1);
  });

  it("records a petted event on every outcome, so the log can narrate it", () => {
    const { world, me, them } = scene(0.9);
    const log = new EventLog();
    applyPet(world, me, them, log, undefined, rolls(0.01), walkableEverywhere);
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "petted", targetId: "venonat-0", outcome: "accepted" }));
  });
});

describe("pestering", () => {
  it("a second pet inside the cooldown rolls on one stage lower", () => {
    const { world, me, them } = scene(0.9);
    applyPet(world, me, them, new EventLog(), undefined, rolls(0.01), walkableEverywhere);
    world.tick += PET_COOLDOWN_TICKS - 1;
    const second = applyPet(world, me, them, new EventLog(), undefined, rolls(0.01), walkableEverywhere)!;
    expect(second.tooSoon).toBe(true);
    expect(second.stageUsed).toBe("curious"); // bonded, knocked down one
  });

  it("waiting out the cooldown restores the real stage", () => {
    const { world, me, them } = scene(0.9);
    applyPet(world, me, them, new EventLog(), undefined, rolls(0.01), walkableEverywhere);
    world.tick += PET_COOLDOWN_TICKS;
    const second = applyPet(world, me, them, new EventLog(), undefined, rolls(0.01), walkableEverywhere)!;
    expect(second.tooSoon).toBe(false);
    expect(second.stageUsed).toBe("bonded");
  });

  it("waking something by touching it also costs a stage, and stacks with pestering", () => {
    const { world, me, them } = scene(0.9);
    them.asleep = true;
    const first = applyPet(world, me, them, new EventLog(), undefined, rolls(0.01), walkableEverywhere)!;
    expect(first.woke).toBe(true);
    expect(first.stageUsed).toBe("curious");
    expect(them.asleep).toBe(false);

    them.asleep = true;
    const second = applyPet(world, me, them, new EventLog(), undefined, rolls(0.01), walkableEverywhere)!;
    expect(second.stageUsed).toBe("tolerant"); // bonded, minus pestering, minus startled
  });
});

describe("the player action", () => {
  it("picks the single adjacent creature with no targetId", () => {
    const { world, me } = scene(0.9);
    const log = new EventLog();
    expect(applyPlayerAction(world, me, { kind: "pet" }, log, undefined, mulberry32(5))).toBe(true);
    expect(me.lastActionOutcome?.petted?.targetId).toBe("venonat-0");
  });

  it("refuses to guess between two in reach", () => {
    const { world, me } = scene(0.9);
    world.agents.push(beast("venonat-1", 7, 8, 0.9));
    expect(applyPlayerAction(world, me, { kind: "pet" }, new EventLog(), undefined, mulberry32(5))).toBe(false);
  });

  it("a named target is exact, even with two in reach", () => {
    const { world, me } = scene(0.9);
    world.agents.push(beast("venonat-1", 7, 8, 0.9));
    expect(applyPlayerAction(world, me, { kind: "pet", targetId: "venonat-1" }, new EventLog(), undefined, mulberry32(5))).toBe(true);
    expect(me.lastActionOutcome?.petted?.targetId).toBe("venonat-1");
  });

  it("spends no turn when nothing is in reach", () => {
    const { world, me, them } = scene(0.9);
    them.pos = { x: 14, y: 14 };
    expect(applyPlayerAction(world, me, { kind: "pet" }, new EventLog(), undefined, mulberry32(5))).toBe(false);
  });

  it("a bite still counts as a turn spent — ok says the gesture happened, not that it was welcome", () => {
    const { world, me } = scene(0);
    setTile(world, "surface", 9, 8, "floor");
    const ok = applyPlayerAction(world, me, { kind: "pet" }, new EventLog(), undefined, rolls(0.99));
    expect(ok).toBe(true);
    expect(me.lastActionOutcome?.petted?.outcome).toBe("clashed");
  });
});
