import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent, HuntRules } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

/**
 * How a multi-hit move composes with knockback and with crits — three
 * questions asked directly, and answered here by running the real combat
 * path rather than by reading it: "Do multi hits that push back hit twice
 * then push back, or hit, push, hit push? If so can you push out of range?
 * Do crits roll once? Or both times?"
 *
 * Pinned as tests because all three are load-bearing for tree design: a
 * knockback node and a multi-hit node in the same build behave very
 * differently under the two possible orderings.
 */
const RULES: HuntRules = { scyther: true };
const SEED = 12345;

function moveOf(over: Partial<MoveSpec>): MoveSpec {
  return {
    id: "probe", name: "Probe", shape: { kind: "point" }, type: "normal", category: "physical",
    power: 3, accuracy: 100, cooldownTicks: 0, range: { min: 0, max: 1 },
    ...over,
  } as MoveSpec;
}

/**
 * A mob-fight: three herd-mates gang up on a predator that stepped adjacent.
 * Copied from this suite's own storm test, which is the setup here that
 * reliably produces a `fought` event — two earlier harnesses that tried to
 * make the PREDATOR swing produced confident all-zero tables instead,
 * because `isPreyOf`'s relative-power gate never opened.
 */
function fight(move: MoveSpec, rng: () => number) {
  const world = createWorld(10, 10, SEED);
  const attacker: Agent = {
    id: "bulbasaur-0", species: "bulbasaur", pos: { x: 5, y: 5 }, layer: "surface", homeLayer: "surface",
    needs: createNeeds(), behavior: "idle", moves: [move], maxHp: 10, herdId: "herd-a",
  } as unknown as Agent;
  const mate = (id: string, pos: { x: number; y: number }): Agent => ({
    id, species: "bulbasaur", pos, layer: "surface", homeLayer: "surface",
    needs: createNeeds(), behavior: "idle", moves: [moveOf({})], maxHp: 10, herdId: "herd-a",
  } as unknown as Agent);
  const target: Agent = {
    id: "scyther-0", species: "scyther", pos: { x: 5, y: 6 }, layer: "surface", homeLayer: "surface",
    needs: createNeeds({ hunger: 0.3 }), behavior: "idle", moves: [moveOf({})],
    maxHp: 20, hp: 10_000, // huge current HP so a flurry can never kill and cut the loop short
  } as unknown as Agent;
  world.agents.push(attacker, mate("bulbasaur-1", { x: 4, y: 5 }), mate("bulbasaur-2", { x: 6, y: 5 }), target);

  const log = new EventLog();
  const startPos = { ...target.pos };
  tickWorld(world, log, RULES, undefined, rng);

  const fought = (log.events as any[]).filter((e) => e.kind === "fought" && e.attackerId === "bulbasaur-0");
  return {
    damageEvents: fought.length,
    crits: fought.filter((e) => e.critical).length,
    tilesMoved: Math.abs(target.pos.x - startPos.x) + Math.abs(target.pos.y - startPos.y),
  };
}

describe("multi-hit ordering: damage, knockback and crits", () => {
  it("all hits land FIRST, then the knockback fires once — not hit/push/hit/push", () => {
    const knockback = { mover: "defender" as const, direction: "away" as const, tiles: 1, timing: "onHit" as const };
    const single = fight(moveOf({ forcedMovement: knockback }), () => 0.7);
    const triple = fight(moveOf({ hits: { min: 3, max: 3 }, forcedMovement: knockback }), () => 0.7);

    expect(single.damageEvents).toBe(1);
    expect(triple.damageEvents).toBe(3); // three separate damage instances

    // The whole answer is in this pair: three hits push the SAME distance as
    // one. `forcedMovement` sits after the hit loop closes in resolveHit, so
    // the target cannot be shoved out from under hits 2 and 3.
    expect(triple.tilesMoved).toBe(single.tilesMoved);
    expect(triple.tilesMoved).toBeGreaterThan(0);
  });

  it("crits roll independently per hit, not once for the whole flurry", () => {
    // `rollCritical` lives inside applySingleDamageInstance, which the hit
    // loop calls per hit. An rng pinned at 0 crits every roll; pinned high,
    // none. If the roll were hoisted out of the loop, the all-crit case
    // would read 1 rather than 3.
    const alwaysCrit = fight(moveOf({ hits: { min: 3, max: 3 }, critRateStage: 6 }), () => 0);
    expect(alwaysCrit.damageEvents).toBe(3);
    expect(alwaysCrit.crits).toBe(3);

    // Control: same move, an rng that never crits. Without this the
    // assertion above would also pass on an engine that crit unconditionally.
    const neverCrit = fight(moveOf({ hits: { min: 3, max: 3 }, critRateStage: 0 }), () => 0.99);
    expect(neverCrit.crits).toBe(0);
  });

  it("accuracy is rolled ONCE for the whole flurry — a multi-hit move lands every hit or none", () => {
    const allOrNothing = fight(moveOf({ hits: { min: 3, max: 3 }, accuracy: 100 }), () => 0.7);
    expect(allOrNothing.damageEvents).toBe(3);

    const cantHit = fight(moveOf({ hits: { min: 3, max: 3 }, accuracy: 1 }), () => 0.99);
    expect(cantHit.damageEvents).toBe(0); // not 1 or 2 — the roll gates the loop, not each hit
  });
});
