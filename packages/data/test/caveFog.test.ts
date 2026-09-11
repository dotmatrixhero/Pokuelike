import { describe, expect, it } from "vitest";
import { createCaveRun } from "../src/scenario.js";
import { useStairs, findPlayer, updatePlayerVision, visionScope, tileIndex, EventLog } from "@pokuelike/engine";

/**
 * Direct report: "is the level 2 exactly the same as level 1? i feel like the
 * fog of war doesn't reset so all the places ive been looked the same or
 * something, and it spawns me someqwhere random."
 *
 * It wasn't the same level — a descent probe showed five distinct terrain
 * fingerprints — but it looked like it, because `Vision.explored` was keyed by
 * `Layer` alone and every cave level calls its one populated layer
 * "underground". Measured on seed 7 before the fix: 96 tiles arrived
 * pre-explored on a level the player had never set foot on, 65 of them with
 * matching terrain. Against a real generated cave run, not a hand-built
 * fixture, because the bug only exists where two `World`s share a layer name.
 */
describe("fog of war is per level, not per layer", () => {
  it("level 2 arrives dark — the map memory from level 1 does not follow you down", () => {
    const level1 = createCaveRun(7);
    const me = findPlayer(level1)!;
    updatePlayerVision(level1, me);

    me.pos = { ...level1.stairsDownAt! };
    updatePlayerVision(level1, me);
    const knownUpstairs = me.vision!.explored[visionScope(level1, "underground")]!;
    expect(knownUpstairs.size).toBeGreaterThan(20);

    const level2 = useStairs(level1, me, new EventLog())!;
    expect(level2.depth).toBe(2);

    // Nothing remembered here yet: the only thing that could be is what the
    // player can see from the stairs they just stepped off.
    const knownDownstairs = me.vision!.explored[visionScope(level2, "underground")];
    expect(knownDownstairs).toBeUndefined();

    updatePlayerVision(level2, me);
    const fresh = me.vision!.explored[visionScope(level2, "underground")]!;
    // Most of what the player remembers upstairs is still dark down here.
    // Not "none of it": the two chambers overlap by coincidence of index,
    // and whatever is in sight from the landing tile is legitimately known.
    const carried = [...knownUpstairs].filter((i) => fresh.has(i)).length;
    expect(carried).toBeLessThan(knownUpstairs.size * 0.5);

    // And level 1 keeps its own memory, so climbing back up isn't re-fogged.
    expect(knownUpstairs.has(tileIndex(level1, level1.stairsDownAt!.x, level1.stairsDownAt!.y))).toBe(true);
  });
});
