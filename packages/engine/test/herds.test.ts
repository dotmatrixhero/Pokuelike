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

describe("herd naming: territory, then type-flavoured qualifiers", () => {
  function worldWithTerritory(): World {
    const world = createWorld(8, 8, SEED);
    world.territoryName = "the Elderwood";
    return world;
  }

  it("names the first herd of a species after the territory", () => {
    const world = worldWithTerritory();
    ensureHerd(world, "h1", { species: "bulbasaur", pos: { x: 1, y: 1 }, origin: "founding", types: ["grass"] });
    expect(world.herds!.h1!.name).toBe("the Bulbasaurs of the Elderwood");
  });

  it("gives a SECOND herd of the same species a qualifier instead", () => {
    const world = worldWithTerritory();
    ensureHerd(world, "h1", { species: "charmeleon", pos: { x: 1, y: 1 }, origin: "founding", types: ["fire"] });
    ensureHerd(world, "h2", { species: "charmeleon", pos: { x: 5, y: 5 }, origin: "split", types: ["fire"] });
    const second = world.herds!.h2!.name;
    expect(second).not.toBe(world.herds!.h1!.name);
    expect(second).toMatch(/of the Elderwood$/);
    expect(second).not.toMatch(/Charmeleons/);
  });

  it("flavours the qualifier by the herd's typing — a fire herd gets fire words", () => {
    const world = worldWithTerritory();
    ensureHerd(world, "h1", { species: "charmeleon", pos: { x: 1, y: 1 }, origin: "founding", types: ["fire"] });
    ensureHerd(world, "h2", { species: "charmeleon", pos: { x: 5, y: 5 }, origin: "split", types: ["fire"] });
    expect(world.herds!.h2!.name).toMatch(/Flame|Ember|Cinder|Pyre|Ashen|Burning|Molten|Smoldering/);
  });

  it("a grass herd and a water herd get different words for the same situation", () => {
    const grass = worldWithTerritory();
    ensureHerd(grass, "a", { species: "ivysaur", pos: { x: 1, y: 1 }, origin: "founding", types: ["grass"] });
    ensureHerd(grass, "b", { species: "ivysaur", pos: { x: 2, y: 2 }, origin: "split", types: ["grass"] });
    const water = worldWithTerritory();
    ensureHerd(water, "a", { species: "squirtle", pos: { x: 1, y: 1 }, origin: "founding", types: ["water"] });
    ensureHerd(water, "b", { species: "squirtle", pos: { x: 2, y: 2 }, origin: "split", types: ["water"] });
    expect(grass.herds!.b!.name).not.toBe(water.herds!.b!.name);
  });

  it("never reuses a name, even across different species", () => {
    // A real run produced a Golbat herd and an Onix herd both called
    // "the Wandering Kin of the Crag Heights".
    const world = worldWithTerritory();
    const names = new Set<string>();
    const species: Array<[string, "poison" | "rock" | "fire"]> = [
      ["golbat", "poison"], ["golbat", "poison"], ["onix", "rock"], ["onix", "rock"],
      ["charmeleon", "fire"], ["charmeleon", "fire"],
    ];
    species.forEach(([id, type], i) => {
      ensureHerd(world, `h${i}`, { species: id, pos: { x: i, y: 1 }, origin: "immigration", types: [type] });
      names.add(world.herds![`h${i}`]!.name);
    });
    expect(names.size).toBe(species.length);
  });

  it("keeps a dead herd's name spent — the record has to stay unambiguous", () => {
    const world = worldWithTerritory();
    ensureHerd(world, "h1", { species: "onix", pos: { x: 1, y: 1 }, origin: "founding", types: ["rock"] });
    world.herds!.h1!.dissolvedTick = 500;
    ensureHerd(world, "h2", { species: "onix", pos: { x: 2, y: 2 }, origin: "immigration", types: ["rock"] });
    expect(world.herds!.h2!.name).not.toBe(world.herds!.h1!.name);
  });

  it("falls back to an invented place when there is no overworld above this world", () => {
    const world = createWorld(8, 8, SEED); // no territoryName
    ensureHerd(world, "h1", { species: "bulbasaur", pos: { x: 1, y: 1 }, origin: "founding", types: ["grass"] });
    expect(world.herds!.h1!.name).toMatch(/^the Bulbasaurs of \w+$/);
  });
});
