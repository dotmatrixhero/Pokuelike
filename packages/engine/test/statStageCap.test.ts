import { describe, expect, it } from "vitest";
import type { Agent } from "../src/types.js";
import { applyStatStage, getStatStage } from "../src/status.js";

const agentOf = (): Agent => ({ id: "a", species: "snorlax", pos: { x: 0, y: 0 }, layer: "surface", needs: {} } as unknown as Agent);

describe("stat stages: once per move per use, not once per use", () => {
  it("using the SAME move again refreshes the timer instead of stacking another stage", () => {
    // Direct: "if something gives you +1 stage of attack, using it again
    // should not give you another stage, merely refresh timer."
    const agent = agentOf();
    applyStatStage(agent, "defense", 1, 20, "harden");
    expect(getStatStage(agent, "defense")).toBe(1);

    // Let it tick down a bit, then use it again.
    agent.statStages![0].ticksRemaining = 3;
    applyStatStage(agent, "defense", 1, 20, "harden");

    expect(getStatStage(agent, "defense")).toBe(1); // NOT 2
    expect(agent.statStages).toHaveLength(1);
    expect(agent.statStages![0].ticksRemaining).toBe(20); // timer refreshed
  });

  it("a DIFFERENT move still adds its own stage", () => {
    // "However a DIFFERENT move could give you another stage."
    const agent = agentOf();
    applyStatStage(agent, "defense", 1, 20, "harden");
    applyStatStage(agent, "defense", 1, 20, "withdraw");

    expect(getStatStage(agent, "defense")).toBe(2);
    expect(agent.statStages).toHaveLength(2);
  });

  it("one use can reach +3 from a single move, and a second use does NOT make it +6", () => {
    // "you COULD get to +3 stage with one use, but NOT +6 if you use the
    // move twice." Callers resolve a move's own nodes to one change per stat
    // before applying (resolveStatChangesOnHit), so the +3 arrives as one call.
    const agent = agentOf();
    applyStatStage(agent, "defense", 3, 20, "body_slam");
    applyStatStage(agent, "defense", 3, 20, "body_slam");

    expect(getStatStage(agent, "defense")).toBe(3);
    expect(agent.statStages).toHaveLength(1);
  });

  it("re-applying a WEAKER version overwrites rather than keeping the old peak", () => {
    // A build re-specced into a smaller node should read as smaller. max()
    // would quietly preserve a stage the agent no longer earns.
    const agent = agentOf();
    applyStatStage(agent, "attack", 3, 20, "tackle");
    applyStatStage(agent, "attack", 1, 20, "tackle");
    expect(getStatStage(agent, "attack")).toBe(1);
  });

  it("a debuff from one move refreshes; two different moves stack downward", () => {
    const agent = agentOf();
    applyStatStage(agent, "speed", -2, 15, "rock_throw");
    applyStatStage(agent, "speed", -2, 15, "rock_throw");
    expect(getStatStage(agent, "speed")).toBe(-2);

    applyStatStage(agent, "speed", -1, 15, "string_shot");
    expect(getStatStage(agent, "speed")).toBe(-3);
  });

  it("entries with no source move never merge — the pre-existing behaviour is untouched", () => {
    // Control: a designed permanent effect (Growl's AoE) and every bare-engine
    // caller pass no move id, and must keep stacking exactly as before. Without
    // this the whole rule would be a silent behaviour change everywhere.
    const agent = agentOf();
    applyStatStage(agent, "attack", -1);
    applyStatStage(agent, "attack", -1);
    expect(getStatStage(agent, "attack")).toBe(-2);
    expect(agent.statStages).toHaveLength(2);
  });
});
