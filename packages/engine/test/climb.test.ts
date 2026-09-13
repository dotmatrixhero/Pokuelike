import { describe, expect, it } from "vitest";
import { createWorld, setTile } from "../src/world.js";
import { useStairs, isAtExit, recordEmerged } from "../src/climb.js";
import { EventLog } from "../src/events.js";
import type { Agent, World } from "../src/types.js";

/**
 * ROADMAP.md M7 Climb — direct ask, once the design conversation resolved
 * back to something simple: "i think i just want to be able to move to the
 * next level of the cave and shit." Chained `World`s (`below`/`above`)
 * linked by stairs — see types.ts's `World.below` doc comment for why this
 * architecture was picked over widening `Layer`.
 */

function human(x: number, y: number): Agent {
  return {
    id: "me",
    species: "human",
    pos: { x, y },
    layer: "underground",
    homeLayer: "underground",
    needs: { hunger: 1, thirst: 1, energy: 1, mateDrive: 0 },
    behavior: "idle",
    controlledBy: "player",
    maxHp: 20,
    hp: 20,
    stats: { hp: 20, attack: 30, defense: 30, spAttack: 30, spDefense: 30, speed: 40 },
  };
}

function level(depth: number): World {
  const w = createWorld(10, 10, depth);
  w.depth = depth;
  return w;
}

describe('Direct ask: "move to the next level of the cave" — useStairs', () => {
  it("descends: moves the agent from one world's agents to the next, lands on stairsUpAt", () => {
    const above = level(1);
    const below = level(2);
    above.below = below;
    below.above = above;
    below.stairsUpAt = { x: 3, y: 3 };
    setTile(above, "underground", 5, 5, "stairsDown");
    const me = human(5, 5);
    above.agents.push(me);

    const log = new EventLog();
    const result = useStairs(above, me, log);

    expect(result).toBe(below);
    expect(above.agents).not.toContain(me);
    expect(below.agents).toContain(me);
    expect(me.pos).toEqual({ x: 3, y: 3 });
    expect(log.events).toContainEqual(
      expect.objectContaining({ kind: "crossedCaveLevel", agentId: "me", fromDepth: 1, toDepth: 2, direction: "down" }),
    );
  });

  it("climbs back up the same way, landing on stairsDownAt", () => {
    const above = level(1);
    const below = level(2);
    above.below = below;
    below.above = above;
    above.stairsDownAt = { x: 7, y: 7 };
    setTile(below, "underground", 2, 2, "stairsUp");
    const me = human(2, 2);
    below.agents.push(me);

    const result = useStairs(below, me, new EventLog());

    expect(result).toBe(above);
    expect(me.pos).toEqual({ x: 7, y: 7 });
    expect(above.agents).toContain(me);
    expect(below.agents).not.toContain(me);
  });

  it("does nothing standing on ordinary floor", () => {
    const w = level(1);
    const me = human(5, 5);
    w.agents.push(me);
    expect(useStairs(w, me, new EventLog())).toBeUndefined();
    expect(w.agents).toContain(me);
  });

  it("does nothing on a stairsDown tile with no below level (the deepest level has none)", () => {
    const w = level(5);
    setTile(w, "underground", 5, 5, "stairsDown");
    const me = human(5, 5);
    w.agents.push(me);
    expect(useStairs(w, me, new EventLog())).toBeUndefined();
  });

  it("does nothing on stairsDown missing the linked stairsUpAt (a malformed chain, not a live crossing)", () => {
    const above = level(1);
    const below = level(2);
    above.below = below;
    // below.stairsUpAt intentionally absent
    setTile(above, "underground", 5, 5, "stairsDown");
    const me = human(5, 5);
    above.agents.push(me);
    expect(useStairs(above, me, new EventLog())).toBeUndefined();
  });
});

describe('Direct ask (ROADMAP.md M7): "Done when: you emerge" — isAtExit/recordEmerged', () => {
  it("is true only once the agent is actually standing on the exit tile", () => {
    const w = level(5);
    setTile(w, "underground", 8, 8, "exit");
    const me = human(5, 5);
    expect(isAtExit(w, me)).toBe(false);
    me.pos = { x: 8, y: 8 };
    expect(isAtExit(w, me)).toBe(true);
  });

  it("records a real emerged event with the level's own depth", () => {
    const w = level(5);
    const me = human(5, 5);
    const log = new EventLog();
    recordEmerged(w, me, log);
    expect(log.events).toContainEqual(expect.objectContaining({ kind: "emerged", agentId: "me", depth: 5 }));
  });
});

/**
 * Direct report: "Stairs do not work. Units in party do not follow past
 * stairs." They didn't — `crossLevel` moved exactly one agent. The second
 * half of the damage is less obvious and worse: `needs.ts`'s `applyFollowing`
 * clears `followingId` the moment the leader isn't in the same `world.agents`
 * array, so the staircase didn't just separate the party, it dissolved it.
 */
describe("the party comes with you", () => {
  function follower(id: string, x: number, y: number): Agent {
    const a = human(x, y);
    a.id = id;
    a.species = "venonat";
    a.controlledBy = undefined;
    a.followingId = "me";
    return a;
  }

  function twoLevels(): { above: World; below: World; me: Agent } {
    const above = level(1);
    const below = level(2);
    above.below = below;
    below.above = above;
    below.stairsUpAt = { x: 3, y: 3 };
    setTile(above, "underground", 5, 5, "stairsDown");
    const me = human(5, 5);
    above.agents.push(me);
    return { above, below, me };
  }

  it("carries every bonded follower down, and leaves nobody behind", () => {
    const { above, below, me } = twoLevels();
    const pals = [follower("pal-a", 5, 6), follower("pal-b", 4, 5)];
    above.agents.push(...pals);

    expect(useStairs(above, me, new EventLog())).toBe(below);
    for (const pal of pals) {
      expect(below.agents).toContain(pal);
      expect(above.agents).not.toContain(pal);
      expect(pal.followingId).toBe("me");
    }
  });

  it("lands them on distinct walkable tiles, not stacked on the stairs", () => {
    const { above, below, me } = twoLevels();
    const pals = [follower("pal-a", 5, 6), follower("pal-b", 4, 5), follower("pal-c", 6, 5)];
    above.agents.push(...pals);
    useStairs(above, me, new EventLog());

    const spots = [me, ...pals].map((a) => `${a.pos.x},${a.pos.y}`);
    expect(new Set(spots).size).toBe(spots.length);
    expect(me.pos).toEqual({ x: 3, y: 3 });
    // Close enough that the party is still a party on arrival.
    for (const pal of pals) expect(Math.max(Math.abs(pal.pos.x - 3), Math.abs(pal.pos.y - 3))).toBeLessThanOrEqual(2);
  });

  it("does not drag an unbonded bystander, a corpse, or an egg along", () => {
    const { above, below, me } = twoLevels();
    const stranger = follower("stranger", 5, 6);
    stranger.followingId = undefined;
    const corpse = follower("corpse", 4, 5);
    corpse.alive = false;
    const egg = follower("egg", 6, 5);
    egg.isEgg = true;
    above.agents.push(stranger, corpse, egg);

    useStairs(above, me, new EventLog());
    for (const other of [stranger, corpse, egg]) {
      expect(above.agents).toContain(other);
      expect(below.agents).not.toContain(other);
    }
  });

  it("records a crossing event per party member, so the log can narrate it", () => {
    const { above, me } = twoLevels();
    above.agents.push(follower("pal-a", 5, 6));
    const log = new EventLog();
    useStairs(above, me, log);
    const crossings = log.events.filter((e) => e.kind === "crossedCaveLevel");
    expect(crossings.map((e) => (e as { agentId: string }).agentId).sort()).toEqual(["me", "pal-a"]);
  });

  it("brings them back up too", () => {
    const above = level(1);
    const below = level(2);
    above.below = below;
    below.above = above;
    above.stairsDownAt = { x: 7, y: 7 };
    setTile(below, "underground", 2, 2, "stairsUp");
    const me = human(2, 2);
    const pal = follower("pal-a", 2, 3);
    below.agents.push(me, pal);

    expect(useStairs(below, me, new EventLog())).toBe(above);
    expect(above.agents).toContain(pal);
  });
});
