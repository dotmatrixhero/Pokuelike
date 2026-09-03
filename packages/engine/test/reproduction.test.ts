import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { tickWorld } from "../src/simulation.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import type { Disposition } from "../src/nature.js";

function parent(id: string, sex: "male" | "female", pos: { x: number; y: number }, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "bulbasaur",
    pos,
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ mateDrive: 0.9 }),
    behavior: "idle",
    herdId: "herd-a",
    sex,
    age: 500,
    ...overrides,
  };
}

describe("reproduction", () => {
  it("a mature pair closes distance toward each other", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 6, y: 2 }));

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.pos.x).toBeGreaterThan(2);
  });

  it("an adjacent mature pair produces offspring and resets mateDrive", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    tickWorld(world, log);

    expect(world.agents).toHaveLength(3);
    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(child.species).toBe("bulbasaur");
    // Newborns pushed mid-iteration get ticked once more in the same tickWorld call (array iteration
    // picks up appended elements), so age can already be 1 by the time tickWorld returns.
    expect(child.age).toBeLessThanOrEqual(1);
    expect(child.herdId).toBe("herd-a");
    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.needs.mateDrive).toBe(0);
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "born", motherId: "mother", fatherId: "father" })
    );
  });

  it("an immature agent doesn't seek a mate even with high mateDrive", () => {
    const world = createWorld(10, 10);
    const youngster: Agent = { ...parent("young", "female", { x: 2, y: 2 }), age: 5 };
    world.agents.push(youngster, parent("father", "male", { x: 3, y: 2 }));

    tickWorld(world);

    expect(world.agents).toHaveLength(2);
  });

  it("same-sex agents don't pair", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("a", "female", { x: 2, y: 2 }), parent("b", "female", { x: 3, y: 2 }));

    tickWorld(world);

    expect(world.agents).toHaveLength(2);
  });

  it("offspring get their own randomly-assigned nature and disposition, not inherited from a parent", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));

    tickWorld(world);

    const child = world.agents.find((a) => a.id !== "mother" && a.id !== "father")!;
    expect(typeof child.nature).toBe("string");
    expect(child.disposition).toBeDefined();
    expect(child.disposition!.boldness).toBeGreaterThanOrEqual(0);
    expect(child.disposition!.boldness).toBeLessThanOrEqual(1);
  });

  it("the born event carries the newborn's nature and a disposition summary for the narrative log", () => {
    const world = createWorld(10, 10);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 3, y: 2 }));
    const log = new EventLog();

    tickWorld(world, log);

    const bornEvent = log.events.find((e) => e.kind === "born");
    expect(bornEvent).toBeDefined();
    if (bornEvent?.kind === "born") {
      expect(typeof bornEvent.nature).toBe("string");
      expect(typeof bornEvent.dispositionSummary).toBe("string");
      expect(bornEvent.dispositionSummary).toMatch(/^(low|moderate|high) (boldness|aggression|sociability)$/);
    }
  });
});

describe("sociability-driven mate-seeking radius", () => {
  it("a sociable agent closes distance on a mate a neutral agent wouldn't even detect", () => {
    const sociable: Disposition = { boldness: 0.5, aggression: 0.5, sociability: 1 };
    const world = createWorld(20, 20);
    // Distance 6 — beyond the neutral 5-tile search radius, within a fully sociable agent's ~7-tile radius.
    world.agents.push(
      parent("mother", "female", { x: 2, y: 2 }, { disposition: sociable }),
      parent("father", "male", { x: 8, y: 2 })
    );

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.pos.x).toBeGreaterThan(2);
  });

  it("a neutral (no disposition) agent does NOT react to that same distant mate", () => {
    const world = createWorld(20, 20);
    world.agents.push(parent("mother", "female", { x: 2, y: 2 }), parent("father", "male", { x: 8, y: 2 }));

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.pos.x).toBe(2);
  });

  it("an unsociable agent doesn't close distance on a mate a neutral agent would", () => {
    const unsociable: Disposition = { boldness: 0.5, aggression: 0.5, sociability: 0 };
    const world = createWorld(20, 20);
    // Distance 4 — within the neutral 5-tile radius, beyond an unsociable agent's ~3-tile radius.
    world.agents.push(
      parent("mother", "female", { x: 2, y: 2 }, { disposition: unsociable }),
      parent("father", "male", { x: 6, y: 2 })
    );

    tickWorld(world);

    const mother = world.agents.find((a) => a.id === "mother")!;
    expect(mother.pos.x).toBe(2);
  });
});
