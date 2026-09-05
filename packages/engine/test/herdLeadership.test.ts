import { describe, expect, it } from "vitest";
import { createWorld } from "../src/world.js";
import { createNeeds } from "../src/needs.js";
import { EventLog } from "../src/events.js";
import type { Agent } from "../src/types.js";
import { effectiveDisposition, LEADERSHIP_DISPOSITION_BLEND_WEIGHT, updateHerdLeadership } from "../src/herdLeadership.js";

function agent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    species: "bulbasaur",
    pos: { x: 0, y: 0 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds(),
    behavior: "idle",
    herdId: "herd-a",
    ...overrides,
  };
}

describe("herd leadership: promotion and seniority tie-break", () => {
  it("a herd with exactly one titled member gets it as leader", () => {
    const world = createWorld(10, 10);
    const log = new EventLog();
    const a = agent("a", { notableTitle: "hero" });
    world.agents.push(a);
    world.notables = { hero: { agentId: "a", value: 5, claimedAtTick: 0 } };

    updateHerdLeadership(world, log);

    expect(world.herdLeaders?.["herd-a"]).toBe("a");
    expect(a.isHerdLeader).toBe(true);
    const claimed = log.events.find((e) => e.kind === "leadershipClaimed");
    expect(claimed).toMatchObject({ herdId: "herd-a", agentId: "a" });
  });

  it("with two titled candidates in one herd, the one who claimed its title earlier (senior) leads — the unconfounded proof", () => {
    const world = createWorld(10, 10);
    const log = new EventLog();
    // `junior` claimed later (tick 50) than `senior` (tick 10), even though
    // both are titled right now — seniority, not title kind/value, decides.
    const senior = agent("senior", { notableTitle: "builder" });
    const junior = agent("junior", { notableTitle: "hero" });
    world.agents.push(senior, junior);
    world.notables = {
      builder: { agentId: "senior", value: 100, claimedAtTick: 10 },
      hero: { agentId: "junior", value: 50, claimedAtTick: 50 },
    };

    updateHerdLeadership(world, log);

    expect(world.herdLeaders?.["herd-a"]).toBe("senior");
    expect(senior.isHerdLeader).toBe(true);
    expect(junior.isHerdLeader).toBeUndefined();
  });

  it("does not churn: a still-eligible leader stays put even when a more-senior candidate appears in the SAME herd later", () => {
    const world = createWorld(10, 10);
    const log = new EventLog();
    const incumbent = agent("incumbent", { notableTitle: "hero" });
    world.agents.push(incumbent);
    world.notables = { hero: { agentId: "incumbent", value: 5, claimedAtTick: 20 } };
    updateHerdLeadership(world, log);
    expect(world.herdLeaders?.["herd-a"]).toBe("incumbent");

    // A new, more-senior-looking candidate (earlier claimedAtTick) joins the
    // same herd afterward — the incumbent must NOT be displaced, since it's
    // still eligible and nothing changed FOR THIS HERD (no promotion event,
    // the incumbent didn't lose eligibility).
    const moreSenior = agent("more-senior", { notableTitle: "builder" });
    world.agents.push(moreSenior);
    world.notables.builder = { agentId: "more-senior", value: 100, claimedAtTick: 5 };
    log.events.length = 0;
    updateHerdLeadership(world, log);

    expect(world.herdLeaders?.["herd-a"]).toBe("incumbent");
    expect(log.events.some((e) => e.kind === "leadershipClaimed" || e.kind === "leadershipLost")).toBe(false);
  });

  it("only currently-titled agents are eligible: an untitled agent never becomes leader even alone in its herd", () => {
    const world = createWorld(10, 10);
    const log = new EventLog();
    const untitled = agent("untitled");
    world.agents.push(untitled);

    updateHerdLeadership(world, log);

    expect(world.herdLeaders?.["herd-a"]).toBeUndefined();
    expect(untitled.isHerdLeader).toBeUndefined();
  });
});

describe("herd leadership: loss on title-loss, death, and herd change", () => {
  function setUpLeader(): { world: ReturnType<typeof createWorld>; log: EventLog; leader: Agent } {
    const world = createWorld(10, 10);
    const log = new EventLog();
    const leader = agent("leader", { notableTitle: "hero" });
    world.agents.push(leader);
    world.notables = { hero: { agentId: "leader", value: 5, claimedAtTick: 0 } };
    updateHerdLeadership(world, log);
    expect(world.herdLeaders?.["herd-a"]).toBe("leader");
    log.events.length = 0;
    return { world, log, leader };
  }

  it("losing its title demotes the leader (reason: titleLost), leaving the herd leaderless if no other candidate exists", () => {
    const { world, log, leader } = setUpLeader();
    leader.notableTitle = undefined;

    updateHerdLeadership(world, log);

    expect(world.herdLeaders?.["herd-a"]).toBeUndefined();
    expect(leader.isHerdLeader).toBeUndefined();
    const lost = log.events.find((e) => e.kind === "leadershipLost");
    expect(lost).toMatchObject({ agentId: "leader", herdId: "herd-a", reason: "titleLost" });
  });

  it("dying demotes the leader (reason: died)", () => {
    const { world, log, leader } = setUpLeader();
    leader.alive = false;

    updateHerdLeadership(world, log);

    expect(world.herdLeaders?.["herd-a"]).toBeUndefined();
    expect(leader.isHerdLeader).toBeUndefined();
    const lost = log.events.find((e) => e.kind === "leadershipLost");
    expect(lost).toMatchObject({ agentId: "leader", herdId: "herd-a", reason: "died" });
  });

  it("changing herds demotes the leader from its old herd (reason: herdChanged) and does not carry leadership over automatically", () => {
    const { world, log, leader } = setUpLeader();
    leader.herdId = "herd-b";

    updateHerdLeadership(world, log);

    expect(world.herdLeaders?.["herd-a"]).toBeUndefined();
    const lost = log.events.find((e) => e.kind === "leadershipLost");
    expect(lost).toMatchObject({ agentId: "leader", herdId: "herd-a", reason: "herdChanged" });
    // The agent itself, still titled, becomes the (first, senior-by-default)
    // leader of its NEW herd in this same pass — a genuine promotion for
    // herd-b since herd-b had zero eligible members before.
    expect(world.herdLeaders?.["herd-b"]).toBe("leader");
    expect(leader.isHerdLeader).toBe(true);
  });

  it("demoting a leader immediately promotes the herd's next-best remaining candidate, if any", () => {
    const world = createWorld(10, 10);
    const log = new EventLog();
    const first = agent("first", { notableTitle: "hero" });
    const second = agent("second", { notableTitle: "builder" });
    world.agents.push(first, second);
    world.notables = {
      hero: { agentId: "first", value: 5, claimedAtTick: 0 },
      builder: { agentId: "second", value: 100, claimedAtTick: 10 },
    };
    updateHerdLeadership(world, log);
    expect(world.herdLeaders?.["herd-a"]).toBe("first");

    first.notableTitle = undefined;
    log.events.length = 0;
    updateHerdLeadership(world, log);

    expect(world.herdLeaders?.["herd-a"]).toBe("second");
    expect(second.isHerdLeader).toBe(true);
    expect(log.events.map((e) => e.kind).sort()).toEqual(["leadershipClaimed", "leadershipLost"]);
  });
});

describe("effectiveDisposition: the leader-blend math itself", () => {
  it("returns the agent's own disposition unchanged when its herd has no leader", () => {
    const world = createWorld(10, 10);
    const a = agent("a", { disposition: { boldness: 0.9, aggression: 0.1, sociability: 0.3 } });
    world.agents.push(a);

    expect(effectiveDisposition(world, a)).toEqual({ boldness: 0.9, aggression: 0.1, sociability: 0.3 });
  });

  it("returns the leader's own disposition unchanged — a leader leads, it doesn't follow itself", () => {
    const world = createWorld(10, 10);
    const leader = agent("leader", { disposition: { boldness: 0.9, aggression: 0.9, sociability: 0.9 }, isHerdLeader: true });
    world.agents.push(leader);
    world.herdLeaders = { "herd-a": "leader" };

    expect(effectiveDisposition(world, leader)).toEqual({ boldness: 0.9, aggression: 0.9, sociability: 0.9 });
  });

  it("blends a follower's own disposition toward its leader's by exactly LEADERSHIP_DISPOSITION_BLEND_WEIGHT — the known-value proof", () => {
    const world = createWorld(10, 10);
    const follower = agent("follower", { disposition: { boldness: 0.2, aggression: 0.2, sociability: 0.2 } });
    const leader = agent("leader", { disposition: { boldness: 1.0, aggression: 0.6, sociability: 0.0 }, isHerdLeader: true });
    world.agents.push(follower, leader);
    world.herdLeaders = { "herd-a": "leader" };

    const result = effectiveDisposition(world, follower);
    const w = LEADERSHIP_DISPOSITION_BLEND_WEIGHT;
    expect(w).toBe(0.2);
    // own + (leader - own) * w
    expect(result.boldness).toBeCloseTo(0.2 + (1.0 - 0.2) * w, 10); // 0.36
    expect(result.aggression).toBeCloseTo(0.2 + (0.6 - 0.2) * w, 10); // 0.28
    expect(result.sociability).toBeCloseTo(0.2 + (0.0 - 0.2) * w, 10); // 0.16
  });

  it("an agent with no herd is unaffected regardless of any leader elsewhere", () => {
    const world = createWorld(10, 10);
    const solitary = agent("solitary", { herdId: undefined, disposition: { boldness: 0.4, aggression: 0.4, sociability: 0.4 } });
    const leader = agent("leader", { disposition: { boldness: 1, aggression: 1, sociability: 1 }, isHerdLeader: true });
    world.agents.push(solitary, leader);
    world.herdLeaders = { "herd-a": "leader" };

    expect(effectiveDisposition(world, solitary)).toEqual({ boldness: 0.4, aggression: 0.4, sociability: 0.4 });
  });
});
