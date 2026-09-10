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

  // MEANING CHANGED, deliberately, and narrowed to what the model actually
  // guarantees. It used to claim any invested move beat an untouched one at
  // any damage gap. It no longer does, and should not: investment and
  // potential are two halves of one budget traded node for node, so building
  // is near score-neutral and a genuinely better move CAN win the slot. What
  // survives is a cushion — a part-built tree is not displaced by a marginal
  // upgrade — and that is what this tests now, with the size of the gap as
  // the variable.
  it("a part-built move survives a marginal upgrade but not a real one", () => {
    // Failure mode (a): an agent throwing away the build it spent its whole
    // life on. The points come back, but a Solar Beam specialist that drops
    // Solar Beam for a fresh Tackle has thrown away its own story.
    const treeOf = (prefix: string) =>
      Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`${prefix}${i}`, { id: `${prefix}${i}`, name: `${prefix}${i}`, cost: 1, leaning: "aggression" as const }])
      );
    const bigTree = (prefix: string) =>
      Object.fromEntries(
        Array.from({ length: 45 }, (_, i) => [`${prefix}${i}`, { id: `${prefix}${i}`, name: `${prefix}${i}`, cost: 1, leaning: "aggression" as const }])
      );
    const tree = treeOf("n"); // 10 of 45 bought below — part-built, not finished
    // BOTH moves get a tree of the same size, so investment is the only thing
    // that differs. An earlier version of this test gave a tree to Solar Beam
    // alone, which meant its control was really measuring the tree-potential
    // term and would have passed with the investment term deleted entirely.
    const ctx = ctxOf({
      BUILT: spec("built", { type: "grass", power: 40, cooldownTicks: 3, tree: bigTree("n") } as Partial<MoveSpec>),
      MARGINAL: spec("marginal", { type: "grass", power: 44, cooldownTicks: 3, tree: bigTree("t") } as Partial<MoveSpec>),
      REAL_UPGRADE: spec("real_upgrade", { type: "grass", power: 120, cooldownTicks: 1, tree: bigTree("u") } as Partial<MoveSpec>),
    });
    const built = () => ({ BUILT: Object.keys(tree) }); // 10 of 45

    // A 4-power edge is noise, and the cushion holds.
    const vsMarginal = agentOf({ knownMoves: ["BUILT", "MARGINAL"], moveTreeChoices: built() });
    expect(pickMoveToForget(vsMarginal, vsMarginal.knownMoves!, ctx)).toBe("MARGINAL");

    // Nine times the damage per action is a reason, and the build gives way —
    // the points come back and fund the new one.
    const vsReal = agentOf({ knownMoves: ["BUILT", "REAL_UPGRADE"], moveTreeChoices: built() });
    expect(pickMoveToForget(vsReal, vsReal.knownMoves!, ctx)).toBe("BUILT");

    // Control: strip the investment and even the marginal move wins, so the
    // first assertion is measuring the cushion and not just the ordering.
    const bare = agentOf({ knownMoves: ["BUILT", "MARGINAL"] });
    expect(pickMoveToForget(bare, bare.knownMoves!, ctx)).toBe("BUILT");
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
    const treeOf = (n: number) =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [`n${i}`, { id: `n${i}`, name: `n${i}`, cost: 1, leaning: "aggression" as const }])
      );
    const ctx = ctxOf({
      SLASH: spec("slash", { power: 70, tree: treeOf(45) } as Partial<MoveSpec>),
      DRAGON_CLAW: spec("dragon_claw", { power: 80 }),
    });
    const agent = agentOf({ knownMoves: ["SLASH", "DRAGON_CLAW"] });

    expect(pickMoveToForget(agent, agent.knownMoves!, ctx)).toBe("DRAGON_CLAW");

    // Tree SIZE must not decide between two designed moves. The first version
    // of this term scaled by node count, and a level-50 Charizard promptly
    // started dropping Slash (36 nodes) for Scratch (45) the moment Scratch
    // was converted — purely on the count, though Slash wins on damage per
    // action and both are Normal. Converting the remaining trees would have
    // reshuffled every movepool in the game for no design reason.
    const bothDesigned = ctxOf({
      BIG_TREE: spec("big_tree", { power: 40, cooldownTicks: 3, tree: treeOf(45) } as Partial<MoveSpec>),
      SMALL_TREE: spec("small_tree", { power: 70, cooldownTicks: 5, tree: treeOf(36) } as Partial<MoveSpec>),
    });
    const both = agentOf({ knownMoves: ["BIG_TREE", "SMALL_TREE"] });
    // 70/6 beats 40/4, so the stronger move survives on its numbers, not on
    // having twelve more nodes than the other one.
    expect(pickMoveToForget(both, both.knownMoves!, bothDesigned)).toBe("BIG_TREE");

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

  it("drops a BUILT move for a clearly better one, refunds the points, and says why", () => {
    // Direct: "It's okay to drop an invested move but there should be
    // reasoning behind it." The reasoning is that the refund makes
    // investment transferable rather than destroyed — every point comes back
    // as wildcard and maybeAutoRespec starts spending it again on whatever
    // won the slot. So investment is friction, not a veto.
    const treeOf = (p: string) =>
      Object.fromEntries(
        Array.from({ length: 45 }, (_, i) => [`${p}${i}`, { id: `${p}${i}`, name: `${p}${i}`, cost: 1, leaning: "aggression" as const }])
      );
    const ctx = ctxOf({
      OLD: spec("old", { type: "normal", power: 40, cooldownTicks: 3, tree: treeOf("o") } as Partial<MoveSpec>),
      FILLER1: spec("filler1", { type: "water", power: 60, tree: treeOf("a") } as Partial<MoveSpec>),
      FILLER2: spec("filler2", { type: "fire", power: 60, tree: treeOf("b") } as Partial<MoveSpec>),
      FILLER3: spec("filler3", { type: "rock", power: 60, tree: treeOf("c") } as Partial<MoveSpec>),
      // Same type as OLD, and far stronger per action.
      NEW: spec("new", { type: "normal", power: 110, cooldownTicks: 1, tree: treeOf("n") } as Partial<MoveSpec>),
    });
    // Every slot carries investment, so there is no cheap one to free —
    // which is exactly the situation the live sim does not currently reach
    // (measured: no agent has all four slots invested, so the AI always has
    // an uninvested slot and never NEEDS to spend a built one).
    const agent = agentOf({
      types: ["normal"],
      knownMoves: ["OLD", "FILLER1", "FILLER2", "FILLER3", "NEW"],
      moveTreeChoices: { OLD: Object.keys(treeOf("o")).slice(0, 12), FILLER1: ["a0"], FILLER2: ["b0"], FILLER3: ["c0"], NEW: [] },
      wildcardSkillPoints: 0,
    });
    const log = new EventLog();

    enforceMoveCap(agent, "NEW", world, ctx, log);

    expect(agent.knownMoves).not.toContain("OLD");
    expect(agent.knownMoves).toContain("NEW");
    // The twelve points are not lost — they come back to fund the new build.
    expect(agent.wildcardSkillPoints).toBe(12);
    const forgot = (log.events as any[]).find((e) => e.kind === "forgotMove");
    expect(forgot.refundedPoints).toBe(12);
    expect(forgot.reason).toBe("redundant"); // same type as one it kept — the cheapest slot to free, and named as such

    // Control: make the new move only marginally better and the built move
    // survives, so this is a real threshold and not "the newest move always
    // wins".
    const marginal = ctxOf({
      OLD: spec("old", { type: "normal", power: 40, cooldownTicks: 3, tree: treeOf("o") } as Partial<MoveSpec>),
      NEW: spec("new", { type: "normal", power: 45, cooldownTicks: 3, tree: treeOf("n") } as Partial<MoveSpec>),
    });
    const settled = agentOf({
      types: ["normal"],
      knownMoves: ["OLD", "NEW"],
      moveTreeChoices: { OLD: Object.keys(treeOf("o")).slice(0, 12) },
    });
    expect(pickMoveToForget(settled, settled.knownMoves!, marginal)).toBe("NEW");
  });

  it("cashes in a FINISHED tree to fund an unfinished one — the reason the refund exists", () => {
    // Direct: "if they have other things to spend skill points on to build
    // anew then that's the chance to do it. A reason to get your skill points
    // back." A maxed tree has nothing left to buy and is sitting on 45 points;
    // an untouched one is a whole build waiting to be afforded.
    const treeOf = (p: string) =>
      Object.fromEntries(
        Array.from({ length: 45 }, (_, i) => [`${p}${i}`, { id: `${p}${i}`, name: `${p}${i}`, cost: 1, leaning: "aggression" as const }])
      );
    const finished = treeOf("f");
    const ctx = ctxOf({
      // Identical moves in every respect except how much of each is built,
      // so nothing but the exhaustion can decide it.
      FINISHED: spec("finished", { type: "normal", power: 60, cooldownTicks: 3, tree: finished } as Partial<MoveSpec>),
      FRESH: spec("fresh", { type: "water", power: 60, cooldownTicks: 3, tree: treeOf("n") } as Partial<MoveSpec>),
    });
    const agent = agentOf({
      types: ["normal"], // STAB favours the FINISHED move, so it is given up despite scoring better on damage
      knownMoves: ["FINISHED", "FRESH"],
      moveTreeChoices: { FINISHED: Object.keys(finished) },
      wildcardSkillPoints: 0,
    });

    expect(pickMoveToForget(agent, agent.knownMoves!, ctx)).toBe("FINISHED");

    const log = new EventLog();
    forgetMove(agent, "FINISHED", world, ctx, log, "exhausted");
    // The 45 points are not lost — they are exactly what pays for the new tree.
    expect(agent.wildcardSkillPoints).toBe(45);
    expect((log.events as any[])[0].reason).toBe("exhausted");

    // Control: one node short of finished and it stays. The cash-in is a
    // deliberate cliff at "nothing left to learn", not a slope.
    const nearlyDone = agentOf({
      types: ["normal"],
      knownMoves: ["FINISHED", "FRESH"],
      moveTreeChoices: { FINISHED: Object.keys(finished).slice(0, 44) },
    });
    expect(pickMoveToForget(nearlyDone, nearlyDone.knownMoves!, ctx)).toBe("FRESH");
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
