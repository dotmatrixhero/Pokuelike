import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import {
  applyPredationInstincts,
  threateningAttackers,
  FIGHT_OR_FLIGHT_COMMIT_ACTIONS,
  OUTMATCHED_ATTACKER_LEVEL_GAP,
  SURROUNDED_ATTACKER_COUNT,
} from "../src/predation.js";
import type { Agent, HuntRules, World } from "../src/types.js";
import type { MoveSpec } from "../src/moves.js";

const RULES: HuntRules = {};

/** Can't miss — this file tests the decision, not the accuracy roll. */
const MOVE: MoveSpec = {
  id: "fof-move",
  name: "FoF Move",
  shape: { kind: "melee" },
  type: "normal",
  category: "physical",
  power: 10,
  accuracy: -1,
  cooldownTicks: 0,
};

function defender(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "defender",
    species: "bulbasaur",
    pos: { x: 5, y: 5 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    moves: [MOVE],
    level: 20,
    maxHp: 60,
    hp: 60,
    ...overrides,
  };
}

function attacker(i: number, overrides: Partial<Agent> = {}): Agent {
  return {
    id: `attacker-${i}`,
    species: "scyther",
    pos: { x: 4 + i, y: 4 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "fight",
    fightTarget: "defender",
    moves: [MOVE],
    level: 20,
    maxHp: 60,
    hp: 60,
    ...overrides,
  };
}

/** rng that always returns `v` — 0 forces flee, 0.999 forces fight. */
const fixed = (v: number) => () => v;

function setup(attackerCount: number, attackerOverrides: Partial<Agent> = {}): { world: World; target: Agent } {
  const world = createWorld(20, 20, 999);
  world.tick = 0;
  const target = defender();
  world.agents.push(target);
  for (let i = 0; i < attackerCount; i++) world.agents.push(attacker(i, attackerOverrides));
  return { world, target };
}

describe("fight or flight when surrounded", () => {
  it("does nothing below the attacker threshold (control)", () => {
    const { world, target } = setup(SURROUNDED_ATTACKER_COUNT - 1);
    applyPredationInstincts(world, target, RULES, new EventLog(), undefined, fixed(0));
    expect(target.fightOrFlightChoice).toBeUndefined();
    expect(target.fightOrFlightActionsLeft ?? 0).toBe(0);
  });

  it("triggers at the attacker threshold", () => {
    const { world, target } = setup(SURROUNDED_ATTACKER_COUNT);
    applyPredationInstincts(world, target, RULES, new EventLog(), undefined, fixed(0));
    expect(target.fightOrFlightChoice).toBe("flee");
  });

  it("attackers more than the level gap below don't count toward the threshold", () => {
    const { world, target } = setup(SURROUNDED_ATTACKER_COUNT, {
      level: (defender().level ?? 20) - OUTMATCHED_ATTACKER_LEVEL_GAP - 1,
    });
    expect(threateningAttackers(world, target)).toHaveLength(0);
    applyPredationInstincts(world, target, RULES, new EventLog(), undefined, fixed(0));
    expect(target.fightOrFlightChoice).toBeUndefined();
  });

  it("attackers exactly at the level gap still count (boundary control)", () => {
    const { world, target } = setup(SURROUNDED_ATTACKER_COUNT, {
      level: (defender().level ?? 20) - OUTMATCHED_ATTACKER_LEVEL_GAP,
    });
    expect(threateningAttackers(world, target)).toHaveLength(SURROUNDED_ATTACKER_COUNT);
  });

  it("a low roll flees and a high roll stands, from the same state", () => {
    const fled = setup(SURROUNDED_ATTACKER_COUNT);
    applyPredationInstincts(fled.world, fled.target, RULES, new EventLog(), undefined, fixed(0));
    expect(fled.target.fightOrFlightChoice).toBe("flee");
    expect(fled.target.behavior).toBe("flee");

    const stood = setup(SURROUNDED_ATTACKER_COUNT);
    applyPredationInstincts(stood.world, stood.target, RULES, new EventLog(), undefined, fixed(0.999));
    expect(stood.target.fightOrFlightChoice).toBe("fight");
    expect(stood.target.behavior).toBe("fight");
    expect(stood.target.fightTarget).toBeDefined();
  });

  it("holds the choice for the committed number of actions, then re-rolls", () => {
    const { world, target } = setup(SURROUNDED_ATTACKER_COUNT);
    // First action commits to standing.
    applyPredationInstincts(world, target, RULES, new EventLog(), undefined, fixed(0.999));
    expect(target.fightOrFlightActionsLeft).toBe(FIGHT_OR_FLIGHT_COMMIT_ACTIONS - 1);

    // Subsequent actions keep standing even though the rng now says flee.
    for (let i = 1; i < FIGHT_OR_FLIGHT_COMMIT_ACTIONS; i++) {
      applyPredationInstincts(world, target, RULES, new EventLog(), undefined, fixed(0));
      expect(target.fightOrFlightChoice).toBe("fight");
    }
    expect(target.fightOrFlightActionsLeft).toBe(0);

    // Commitment spent — the same flee-forcing rng now takes effect.
    applyPredationInstincts(world, target, RULES, new EventLog(), undefined, fixed(0));
    expect(target.fightOrFlightChoice).toBe("flee");
  });

  it("drops the commitment as soon as nothing is pointed at it", () => {
    const { world, target } = setup(SURROUNDED_ATTACKER_COUNT);
    applyPredationInstincts(world, target, RULES, new EventLog(), undefined, fixed(0.999));
    expect(target.fightOrFlightActionsLeft).toBeGreaterThan(0);

    for (const a of world.agents) if (a.id !== target.id) a.fightTarget = undefined;
    applyPredationInstincts(world, target, RULES, new EventLog(), undefined, fixed(0.999));
    expect(target.fightOrFlightActionsLeft).toBe(0);
    expect(target.fightOrFlightChoice).toBeUndefined();
  });

  it("a mobbed PREDATOR can break off, which it previously could only do when nearly dead", () => {
    const world = createWorld(20, 20, 999);
    const hunter = defender({ id: "hunter", species: "scyther", isPredator: true, huntTarget: "attacker-0" });
    world.agents.push(hunter);
    for (let i = 0; i < SURROUNDED_ATTACKER_COUNT; i++) {
      world.agents.push(attacker(i, { species: "bulbasaur", fightTarget: "hunter" }));
    }
    applyPredationInstincts(world, hunter, RULES, new EventLog(), undefined, fixed(0));
    expect(hunter.behavior).toBe("flee");
    expect(hunter.huntTarget).toBeUndefined();
  });

  it("more attackers push the roll toward fleeing", () => {
    // Same disposition, same HP, same rng — only the headcount differs. The
    // control is that the smaller mob, at a roll the bigger mob flees at,
    // still stands.
    const ROLL = 0.62;
    const three = setup(SURROUNDED_ATTACKER_COUNT);
    applyPredationInstincts(three.world, three.target, RULES, new EventLog(), undefined, fixed(ROLL));

    const six = setup(SURROUNDED_ATTACKER_COUNT + 3);
    applyPredationInstincts(six.world, six.target, RULES, new EventLog(), undefined, fixed(ROLL));

    expect(three.target.fightOrFlightChoice).toBe("fight");
    expect(six.target.fightOrFlightChoice).toBe("flee");
  });

  it("being hurt pushes the roll toward fleeing", () => {
    const ROLL = 0.62;
    const healthy = setup(SURROUNDED_ATTACKER_COUNT);
    applyPredationInstincts(healthy.world, healthy.target, RULES, new EventLog(), undefined, fixed(ROLL));

    const hurt = setup(SURROUNDED_ATTACKER_COUNT);
    hurt.target.hp = 6; // 10% of maxHp
    applyPredationInstincts(hurt.world, hurt.target, RULES, new EventLog(), undefined, fixed(ROLL));

    expect(healthy.target.fightOrFlightChoice).toBe("fight");
    expect(hurt.target.fightOrFlightChoice).toBe("flee");
  });
});
