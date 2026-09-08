/**
 * Can a melee (range-1) attacker hit a DIAGONALLY adjacent target?
 *
 * Answer, measured: **no**. Movement is 8-way everywhere in this engine
 * (`movement.ts`'s `stepToward`/`stepAway` try the true diagonal first;
 * `pathfinding.ts`'s BFS uses all 8 `NEIGHBOR_OFFSETS` at unweighted cost 1),
 * but every range check measures distance with `manhattan()`, where a
 * diagonal neighbor is distance **2**. A point-shape move derives range 1,
 * so it can never reach diagonally.
 *
 * The two metrics disagree with each other: BFS says a diagonal step costs
 * 1, Manhattan says the diagonal target is 2 away. An agent one step from
 * its target is out of melee range.
 *
 * Result on 40 trials per arrangement, identical apart from the predator
 * being orthogonally vs. diagonally adjacent:
 *
 *   ORTHOGONAL (manhattan 1): 39/40 trials produced an attack
 *   DIAGONAL   (manhattan 2):  0/40 trials produced an attack
 *
 * Consequences: standing diagonally adjacent to a melee attacker is safe
 * until it steps orthogonally, corner-dancing is an exploit waiting for a
 * player to find it, and "range 2" quietly means "diagonal, or two tiles
 * orthogonally" rather than a clean radius. See TODO.md for the options.
 *
 * Run: `npx tsx packages/runner/src/validateDiagonalReach.ts`
 */
import { createWorld, EventLog, tickWorld, createNeeds, mulberry32 } from "@pokuelike/engine";
import type { Agent, HuntRules, MoveSpec } from "@pokuelike/engine";

const RULES: HuntRules = { scyther: true };
const MOVE: MoveSpec = {
  id: "test-move", name: "Test Move", shape: { kind: "point" }, type: "normal",
  category: "physical", power: 10, accuracy: 100, cooldownTicks: 0,
};

function prey(pos: { x: number; y: number }, id: string): Agent {
  return { id, species: "bulbasaur", pos, layer: "surface", homeLayer: "surface",
    needs: createNeeds(), behavior: "idle", moves: [MOVE], maxHp: 10, herdId: "herd-a" } as Agent;
}
function predator(pos: { x: number; y: number }): Agent {
  return { id: "scyther-0", species: "scyther", pos, layer: "surface", homeLayer: "surface",
    needs: createNeeds(), behavior: "idle", moves: [MOVE], maxHp: 100 } as Agent;
}

// A mob of 3 prey attacks the predator (same shape as predation.test.ts's storm test).
// Orthogonal: predator directly below the lead prey. Diagonal: offset by one on both axes.
for (const [label, predPos] of [
  ["ORTHOGONAL (manhattan 1)", { x: 5, y: 6 }],
  ["DIAGONAL   (manhattan 2)", { x: 6, y: 6 }],
] as const) {
  let fought = 0, missed = 0;
  const TRIALS = 40;
  for (let t = 0; t < TRIALS; t++) {
    const world = createWorld(12, 12, 5000 + t);
    world.agents.push(
      prey({ x: 5, y: 5 }, "bulbasaur-0"),
      prey({ x: 4, y: 5 }, "bulbasaur-1"),
      prey({ x: 6, y: 5 }, "bulbasaur-2"),
      predator({ ...predPos })
    );
    const log = new EventLog();
    tickWorld(world, log, RULES, undefined, mulberry32(777 + t));
    for (const e of log.events as any[]) {
      if (e.kind === "fought" && e.attackerId === "bulbasaur-0") fought++;
      if (e.kind === "missed" && e.attackerId === "bulbasaur-0") missed++;
    }
  }
  console.log(`${label}: attacks resolved by lead prey = ${fought + missed} / ${TRIALS} trials  (fought ${fought}, missed ${missed})`);
}
