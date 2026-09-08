import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import { agentDisplayName, ensureHerd, herdPlaceName, tickHerds } from "../src/herds.js";
import type { Agent, World } from "../src/types.js";

const SEED = 12345;

function member(id: string, herdId: string | undefined, species = "bulbasaur"): Agent {
  return {
    id, species, pos: { x: 2, y: 2 }, layer: "surface", homeLayer: "surface",
    needs: createNeeds(), behavior: "idle", herdId,
  };
}

describe("herd registry", () => {
  it("registers a herd the first time it is seen, with a name", () => {
    const world: World = createWorld(8, 8, SEED);
    world.agents.push(member("a", "h1"));
    tickHerds(world);
    const herd = world.herds!.h1!;
    expect(herd.name).toContain("Bulbasaurs of");
    expect(herd.species).toBe("bulbasaur");
    expect(herd.foundedTick).toBe(world.tick);
  });

  it("names are stable across ticks and deterministic for a given id", () => {
    const world: World = createWorld(8, 8, SEED);
    world.agents.push(member("a", "h1"));
    tickHerds(world);
    const first = world.herds!.h1!.name;
    world.tick += 50;
    tickHerds(world);
    expect(world.herds!.h1!.name).toBe(first);
    expect(herdPlaceName(world, "h1", { x: 2, y: 2 })).toBe(herdPlaceName(world, "h1", { x: 2, y: 2 }));
  });

  it("tracks peak size rather than current size — a herd's story keeps its high-water mark", () => {
    const world: World = createWorld(8, 8, SEED);
    world.agents.push(member("a", "h1"), member("b", "h1"), member("c", "h1"));
    tickHerds(world);
    expect(world.herds!.h1!.peakSize).toBe(3);
    world.agents[2]!.alive = false;
    world.agents[1]!.alive = false;
    tickHerds(world);
    expect(world.herds!.h1!.peakSize).toBe(3);
  });

  it("closes out a herd once its last member dies, and keeps the record", () => {
    const world: World = createWorld(8, 8, SEED);
    const log = new EventLog();
    world.agents.push(member("a", "h1"));
    tickHerds(world, log);
    world.tick = 400;
    world.agents[0]!.alive = false;
    tickHerds(world, log);
    expect(world.herds!.h1!.dissolvedTick).toBe(400);
    expect(log.events.some((e) => e.kind === "herdDissolved")).toBe(true);
  });

  it("remembers lineage when a herd splits off from a parent", () => {
    const world: World = createWorld(8, 8, SEED);
    ensureHerd(world, "parent", { species: "bulbasaur", pos: { x: 1, y: 1 }, origin: "founding" });
    ensureHerd(world, "child", { species: "bulbasaur", pos: { x: 5, y: 5 }, origin: "split", parentHerdId: "parent" });
    expect(world.herds!.child!.parentHerdId).toBe("parent");
    expect(world.herds!.child!.origin).toBe("split");
  });

  it("does not overwrite an existing record when the sweep sees it again", () => {
    const world: World = createWorld(8, 8, SEED);
    ensureHerd(world, "h1", { species: "bulbasaur", pos: { x: 1, y: 1 }, origin: "immigration" });
    world.agents.push(member("a", "h1"));
    world.tick = 900;
    tickHerds(world);
    // The sweep's fallback origin is "founding"; it must not clobber the real one.
    expect(world.herds!.h1!.origin).toBe("immigration");
    expect(world.herds!.h1!.foundedTick).toBe(0);
  });
});

describe("agentDisplayName", () => {
  it("is deterministic and readable", () => {
    expect(agentDisplayName("bulbasaur-egg-3401")).toBe(agentDisplayName("bulbasaur-egg-3401"));
    expect(agentDisplayName("bulbasaur-egg-3401")).toMatch(/^[A-Z][a-z]+$/);
  });

  it("gives different animals different names", () => {
    const names = new Set(["a", "b", "c", "d", "e", "f"].map(agentDisplayName));
    expect(names.size).toBeGreaterThan(3);
  });
});
