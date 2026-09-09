import { describe, expect, it } from "vitest";
import type { Agent, World } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";
import { EventLog } from "../src/events.js";
import { MAX_KNOWN_MOVES, enforceMoveCap, forgetMove, pickMoveToForget, type LevelingContext } from "../src/leveling.js";

const world = { tick: 100, agents: [] } as unknown as World;

function spec(id: string, over: Partial<MoveSpec> = {}): MoveSpec {
  return {
    id,
    name: id,
    shape: { kind: "point" },
    type: "normal",
    category: "physical",
    power: 40,
    accuracy: 100,
    cooldownTicks: 1,
    ...over,
  } as MoveSpec;
}

/** A context whose `resolveMove` is keyed by the SAME id the knownMoves entry uses, so tests read straightforwardly. */
function ctxOf(specs: Record<string, MoveSpec>): LevelingContext {
  return { getProfile: () => undefined, resolveMove: (key: string) => specs[key] };
}

function agentOf(over: Partial<Agent> = {}): Agent {
  return { id: "a", species: "bulbasaur", pos: { x: 0, y: 0 }, layer: "surface", needs: {}, types: ["grass"], ...over } as unknown as Agent;
}

describe("the four-move cap", () => {
  it("forgetting refunds every point spent in that tree, as WILDCARD rather than typed", () => {
    const tree = {
      a: { id: "a", name: "a", cost: 1, leaning: "aggression" as const },
      b: { id: "b", name: "b", cost: 2, leaning: "aggression" as const },
    };
    const ctx = ctxOf({ VINE_WHIP: spec("vine_whip", { type: "grass", tree } as Partial<MoveSpec>) });
    const agent = agentOf({
      knownMoves: ["VINE_WHIP"],
      moves: [spec("vine_whip")],
      moveTreeChoices: { VINE_WHIP: ["a", "b"] },
      skillPoints: { grass: 0 },
      wildcardSkillPoints: 1,
    });

    const refund = forgetMove(agent, "VINE_WHIP", world, ctx);

    // 1 + 2, read from the node costs — NOT one per node. Older trees still
    // carry cost-2 notables, and flat-rating them would quietly short-change
    // exactly the builds that invested most.
    expect(refund).toBe(3);
    expect(agent.wildcardSkillPoints).toBe(4);
    expect(agent.skillPoints?.grass ?? 0).toBe(0); // typed pool untouched — a typed refund would just re-buy the branch it came from
    expect(agent.knownMoves).toEqual([]);
    expect(agent.moves).toEqual([]);
    expect(agent.moveTreeChoices).toBeUndefined();
  });

  it("forgetting takes back the passives that tree granted — otherwise forgetting is pure upside", () => {
    // The exploit this exists for: max a tree, bank its permanent passives,
    // forget the move, take the full refund, spend it again elsewhere. Passives
    // stack across every move an agent knows, so "knows" has to mean something.
    const tree = {
      thorny: { id: "thorny", name: "thorny", cost: 1, leaning: "boldness" as const, grantsPassive: { kind: "thorns" as const, value: 0.2 } },
      tough: {
        id: "tough",
        name: "tough",
        cost: 1,
        leaning: "boldness" as const,
        grantsPassives: [
          { kind: "damageReduction" as const, value: 0.1 },
          { kind: "regen" as const, value: 0.02 },
        ],
      },
    };
    const ctx = ctxOf({ LEECH_SEED: spec("leech_seed", { tree } as Partial<MoveSpec>) });
    const agent = agentOf({
      knownMoves: ["LEECH_SEED"],
      moves: [spec("leech_seed")],
      moveTreeChoices: { LEECH_SEED: ["thorny", "tough"] },
      // 0.3 thorns: 0.2 from this tree, 0.1 from some other move it also knows.
      passives: { thorns: 0.3, damageReduction: 0.1, regen: 0.02 },
    });

    forgetMove(agent, "LEECH_SEED", world, ctx);

    expect(agent.passives?.thorns).toBeCloseTo(0.1); // the OTHER move's share survives
    expect(agent.passives?.damageReduction).toBeUndefined(); // nothing else granted it — gone, not left as a 0
    expect(agent.passives?.regen).toBeUndefined();
  });

  it("keeps the deeply-invested move and drops the untouched one, even when the untouched one hits harder", () => {
    // Failure mode (a): an agent throwing away the build it spent its whole
    // life on. The points come back, but a Solar Beam specialist that drops
    // Solar Beam for a fresh Tackle has thrown away its own story.
    const treeOf = (prefix: string) =>
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`${prefix}${i}`, { id: `${prefix}${i}`, name: `${prefix}${i}`, cost: 1, leaning: "aggression" as const }])
      );
    const tree = treeOf("n");
    // BOTH moves get a tree of the same size, so investment is the only thing
    // that differs. An earlier version of this test gave a tree to Solar Beam
    // alone, which meant its control was really measuring the tree-potential
    // term and would have passed with the investment term deleted entirely.
    const ctx = ctxOf({
      SOLAR_BEAM: spec("solar_beam", { type: "grass", power: 60, cooldownTicks: 9, tree } as Partial<MoveSpec>),
      TACKLE: spec("tackle", { power: 40, cooldownTicks: 1, tree: treeOf("t") } as Partial<MoveSpec>),
    });
    const agent = agentOf({
      knownMoves: ["SOLAR_BEAM", "TACKLE"],
      moveTreeChoices: { SOLAR_BEAM: Object.keys(tree) },
    });

    // Tackle alone is worth far more per action (40/2 vs 60/10), so a
    // pure-damage AI would drop the invested move. Control: with the
    // investment stripped, it does exactly that — which is what makes the
    // first assertion mean something.
    expect(pickMoveToForget(agent, agent.knownMoves!, ctx)).toBe("TACKLE");
    agent.moveTreeChoices = undefined;
    expect(pickMoveToForget(agent, agent.knownMoves!, ctx)).toBe("SOLAR_BEAM");
  });

  it("declines a genuinely worse new move instead of forcing it into a slot", () => {
    // Failure mode (b), the other half: a cap that can only displace an
    // EXISTING move forces every new move in whether or not it is an upgrade.
    const ctx = ctxOf({
      A: spec("a", { power: 90 }),
      B: spec("b", { power: 85 }),
      C: spec("c", { power: 80 }),
      D: spec("d", { power: 75 }),
      JUNK: spec("junk", { power: 5, cooldownTicks: 9 }),
    });
    const agent = agentOf({ knownMoves: ["A", "B", "C", "D", "JUNK"], moves: [] });
    const log = new EventLog();

    enforceMoveCap(agent, "JUNK", world, ctx, log);

    expect(agent.knownMoves).toEqual(["A", "B", "C", "D"]);
    const forgot = (log.events as any[]).find((e) => e.kind === "forgotMove");
    expect(forgot.moveId).toBe("JUNK");
    expect(forgot.reason).toBe("declined"); // a different story from being displaced, and logged as one
  });

  it("keeps a curated move that has a tree over undesigned filler that hits slightly harder", () => {
    // The regression this exists for, found only by running the sim: a
    // level-42 Charizard spawn came out knowing Dragon Claw, Metal Claw,
    // Fire Fang and Flame Burst — four generic dex-derived specs with no
    // tree — having dropped Slash, the curated move with a full 45-node
    // tree, on raw damage per action. Every curated move in the roster was
    // being displaced by filler with marginally better numbers, which would
    // have quietly deleted the whole specialisation system.
    const tree = Object.fromEntries(
      Array.from({ length: 45 }, (_, i) => [`n${i}`, { id: `n${i}`, name: `n${i}`, cost: 1, leaning: "aggression" as const }])
    );
    const ctx = ctxOf({
      SLASH: spec("slash", { power: 70, tree } as Partial<MoveSpec>),
      DRAGON_CLAW: spec("dragon_claw", { power: 80 }),
    });
    const agent = agentOf({ knownMoves: ["SLASH", "DRAGON_CLAW"] });

    expect(pickMoveToForget(agent, agent.knownMoves!, ctx)).toBe("DRAGON_CLAW");

    // Control: strip the tree and the stronger move wins on its numbers, as
    // it should. Without this the assertion above would also pass on a
    // scorer that simply preferred whichever move came first.
    const flat = ctxOf({ SLASH: spec("slash", { power: 70 }), DRAGON_CLAW: spec("dragon_claw", { power: 80 }) });
    expect(pickMoveToForget(agent, agent.knownMoves!, flat)).toBe("SLASH");
  });

  it("values type coverage, so a movepool doesn't collapse into four of the same type", () => {
    const ctx = ctxOf({
      N1: spec("n1", { type: "normal", power: 60 }),
      N2: spec("n2", { type: "normal", power: 60 }),
      N3: spec("n3", { type: "normal", power: 60 }),
      N4: spec("n4", { type: "normal", power: 60 }),
      // Weaker, and the only water move it has.
      W: spec("w", { type: "water", power: 45 }),
    });
    const agent = agentOf({ types: ["normal"], knownMoves: ["N1", "N2", "N3", "N4", "W"] });

    // Raw damage would drop the water move; coverage saves it and drops a
    // redundant normal one instead.
    expect(pickMoveToForget(agent, agent.knownMoves!, ctx)).not.toBe("W");
  });

  it("a player-owned agent parks the decision instead of having it made for them", () => {
    const ctx = ctxOf({ A: spec("a"), B: spec("b"), C: spec("c"), D: spec("d"), E: spec("e") });
    const agent = agentOf({ playerOwned: true, knownMoves: ["A", "B", "C", "D", "E"] });
    const log = new EventLog();

    enforceMoveCap(agent, "E", world, ctx, log);

    expect(agent.knownMoves).toHaveLength(5); // deliberately still over the cap
    expect(agent.pendingMoveChoice).toEqual({ newMoveId: "E", atTick: 100 });
    expect((log.events as any[]).some((e) => e.kind === "forgotMove")).toBe(false);

    // Control: the same agent, wild, resolves it the same tick.
    const wild = agentOf({ knownMoves: ["A", "B", "C", "D", "E"] });
    enforceMoveCap(wild, "E", world, ctx, log);
    expect(wild.knownMoves).toHaveLength(MAX_KNOWN_MOVES);
    expect(wild.pendingMoveChoice).toBeUndefined();
  });
});
