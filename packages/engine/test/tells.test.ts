import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { compass, describeBehavior, examine, hasNoticed } from "../src/tells.js";
import type { Agent, BehaviorKind } from "../src/types.js";

function agent(id: string, species: string, x: number, y: number, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    species,
    pos: { x, y },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    ...extra,
  };
}

describe("describeBehavior (ROADMAP M4)", () => {
  it("drinking is only drinking when standing on water; otherwise it is looking", () => {
    const world = createWorld(10, 10, 1);
    setTile(world, "surface", 5, 5, "water");
    const a = agent("a", "sandshrew", 5, 5, { behavior: "seekWater" });
    expect(describeBehavior(world, a)).toBe("The Sandshrew is drinking.");
    a.pos = { x: 2, y: 2 };
    expect(describeBehavior(world, a)).toBe("The Sandshrew is looking for water.");
  });

  it("names what it stalks, carries, runs from — and 'you' when that is the observer", () => {
    const world = createWorld(10, 10, 1);
    const me = agent("me", "human", 1, 1, { controlledBy: "player" });
    const prey = agent("p", "rattata", 3, 3);
    const hunter = agent("h", "charmeleon", 4, 4, { behavior: "hunt", huntTarget: "p" });
    world.agents.push(me, prey, hunter);
    expect(describeBehavior(world, hunter)).toBe("The Charmeleon is stalking the Rattata.");
    hunter.huntTarget = "me";
    expect(describeBehavior(world, hunter, { observer: me })).toBe("The Charmeleon is stalking you.");
    prey.behavior = "flee";
    prey.fleeingFromId = "h";
    expect(describeBehavior(world, prey)).toBe("The Rattata is running from the Charmeleon.");
    const carrier = agent("c", "machop", 6, 6, { behavior: "carryAlly", carryingId: "p" });
    expect(describeBehavior(world, carrier)).toBe("The Machop is carrying the Rattata.");
    const courier = agent("d", "pidgey", 6, 7, { behavior: "deliverFood", deliverTargetId: "p" });
    expect(describeBehavior(world, courier)).toBe("The Pidgey is carrying food to the Rattata.");
  });

  it("travelling says which way", () => {
    const world = createWorld(20, 20, 1);
    const a = agent("a", "sandshrew", 5, 5, { behavior: "relocate", relocateTarget: { x: 15, y: 5 }, herdId: "h" });
    expect(describeBehavior(world, a)).toBe("The Sandshrew is travelling east with its herd.");
    a.relocateTarget = { x: 1, y: 1 };
    a.herdId = undefined;
    expect(describeBehavior(world, a)).toBe("The Sandshrew is travelling north-west.");
    expect(compass(0, 0)).toBe("nowhere");
    // A target on the agent's own tile is no direction at all — a real run
    // once produced "is wandering nowhere."
    const w = agent("w", "diglett", 3, 3, { behavior: "explore", exploreTarget: { x: 3, y: 3 } });
    expect(describeBehavior(world, w)).toBe("The Diglett is wandering.");
  });

  it("dead, down and asleep come before behaviour", () => {
    const world = createWorld(10, 10, 1);
    expect(describeBehavior(world, agent("a", "sandshrew", 1, 1, { behavior: "hunt", alive: false }))).toBe("The Sandshrew is dead.");
    expect(describeBehavior(world, agent("a", "sandshrew", 1, 1, { behavior: "hunt", fainted: true }))).toBe("The Sandshrew is down and not moving.");
    expect(describeBehavior(world, agent("a", "sandshrew", 1, 1, { behavior: "seekFood", asleep: true }))).toBe("The Sandshrew is asleep.");
    expect(describeBehavior(world, agent("a", "sandshrew", 1, 1, { isEgg: true }))).toBe("An egg.");
  });

  it("every behaviour kind has a sentence and none of them is vague", () => {
    const world = createWorld(10, 10, 1);
    const kinds: BehaviorKind[] = ["idle", "seekWater", "seekFood", "seekMate", "flee", "hunt", "fight", "relocate", "deliverFood", "carryAlly", "explore", "disperse", "buildShelter", "sleep", "restAtShelter", "scavenge", "train", "socialize"];
    for (const behavior of kinds) {
      const s = describeBehavior(world, agent("a", "sandshrew", 1, 1, { behavior }));
      expect(s.startsWith("The Sandshrew ")).toBe(true);
      expect(s.endsWith(".")).toBe(true);
      expect(s).not.toMatch(/something|somehow|besides/);
    }
  });
});

describe("hasNoticed / examine", () => {
  it("noticed within the flee-detection radius with line of sight; not behind a wall; not from farther off", () => {
    const world = createWorld(20, 20, 1);
    const me = agent("me", "human", 5, 5, { controlledBy: "player" });
    const s = agent("s", "sandshrew", 8, 5);
    world.agents.push(me, s);
    expect(hasNoticed(world, s, me)).toBe(true);
    expect(examine(world, s, { observer: me, name: () => "Sandshrew" })).toBe("The Sandshrew is standing still. It has not noticed you.".replace("has not noticed you", "has seen you"));
    setTile(world, "surface", 6, 5, "wall");
    setTile(world, "surface", 7, 5, "wall");
    expect(hasNoticed(world, s, me)).toBe(false);
    expect(examine(world, s, { observer: me })).toBe("The Sandshrew is standing still. It has not noticed you.");
    s.pos = { x: 5, y: 12 };
    expect(hasNoticed(world, s, me)).toBe(false);
  });

  it("uses the creature's real pronoun and does not notice while asleep", () => {
    const world = createWorld(20, 20, 1);
    const me = agent("me", "human", 5, 5, { controlledBy: "player" });
    const s = agent("s", "sandshrew", 6, 5, { sex: "female", asleep: true });
    world.agents.push(me, s);
    expect(examine(world, s, { observer: me })).toBe("The Sandshrew is asleep. She has not noticed you.");
  });

  it("without an observer, a visible status is the second sentence", () => {
    const world = createWorld(10, 10, 1);
    const s = agent("s", "sandshrew", 6, 5, { sex: "male", status: { kind: "poison" } });
    expect(examine(world, s)).toBe("The Sandshrew is standing still. He is poisoned.");
  });
});
