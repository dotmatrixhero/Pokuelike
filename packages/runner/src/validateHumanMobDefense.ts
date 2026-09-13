/**
 * Does the human mob-defense trait actually fire? (HUMAN_PASS.md phase 0.)
 *
 * The claim: two humans beside a threat should stand and fight, where two of
 * anything else would flee. `isProtectedByMob` tests `allies + 1 >=
 * mobThreshold`, MOB_THRESHOLD is 3 at neutral disposition, and
 * measureHumanBaseline.ts measured the mean living human herd at size 2.00 —
 * so without the bonus, 2 >= 3 fails and humans can never mob.
 *
 * CONTROL: the identical arrangement with bulbasaur (no `mobDefenseBonus`).
 * If the control also fights, the test proves nothing about the trait.
 *
 * Run: npx tsx packages/runner/src/validateHumanMobDefense.ts
 */
import { createWorld, EventLog, tickWorld, createNeeds, mulberry32 } from "@pokuelike/engine";
import type { Agent, HuntRules, MoveSpec } from "@pokuelike/engine";

const RULES: HuntRules = { scyther: true };
const MOVE: MoveSpec = {
  id: "test-move", name: "Test Move", shape: { kind: "point" }, type: "normal",
  category: "physical", power: 10, accuracy: 100, cooldownTicks: 0,
};

function defender(species: string, pos: { x: number; y: number }, id: string, bonus?: number): Agent {
  return {
    id, species, pos, layer: "surface", homeLayer: "surface", needs: createNeeds(),
    behavior: "idle", moves: [MOVE], maxHp: 60, level: 10, herdId: "group-a",
    mobDefenseBonus: bonus,
  } as any;
}
function threat(pos: { x: number; y: number }): Agent {
  return {
    id: "scyther-0", species: "scyther", pos, layer: "surface", homeLayer: "surface",
    needs: createNeeds(), behavior: "idle", moves: [MOVE], maxHp: 120, level: 12, isPredator: true,
  } as any;
}

const TRIALS = 40;
for (const [label, species, bonus] of [
  ["HUMAN   (mobDefenseBonus 1)", "human", 1],
  ["CONTROL (no bonus)         ", "bulbasaur", undefined],
] as const) {
  let fought = 0, fled = 0;
  for (let t = 0; t < TRIALS; t++) {
    const world = createWorld(12, 12, 7000 + t);
    world.agents.push(
      defender(species, { x: 5, y: 5 }, "d-0", bonus),
      defender(species, { x: 4, y: 5 }, "d-1", bonus),
      threat({ x: 5, y: 6 })
    );
    const log = new EventLog();
    let didFight = false;
    for (let i = 0; i < 12; i++) {
      tickWorld(world, log, RULES, undefined, mulberry32(31 + t * 7 + i));
      for (const e of log.events as any[]) {
        if ((e.kind === "fought" || e.kind === "missed") && (e.attackerId === "d-0" || e.attackerId === "d-1")) didFight = true;
      }
      if (didFight) break;
    }
    if (didFight) fought++; else fled++;
  }
  console.log(`${label}: stood and fought ${fought}/${TRIALS}, did not ${fled}`);
}
