import { describe, expect, it } from "vitest";
import { createCaveRun } from "../src/scenario.js";
import { findPlayer, useStairs, EventLog, applyPlayerAction, type World } from "@pokuelike/engine";

/**
 * Direct report: "I'm losing all my recipes when going up and down stairs."
 *
 * The player's `knownRecipes` travels with the agent and was never the
 * problem. `World.recipes` and `World.items` are per-world catalogs, and only
 * level 1 (`createCaveScenario`) ever set them — `buildDeeperLevel` did not.
 * So the moment you take the stairs, `player.ts`'s `craft` looks up
 * `world.recipes?.[id]` on a world that has no catalog at all, and every
 * recipe you know becomes unmakeable.
 */

function levels(top: World): World[] {
  const chain: World[] = [];
  for (let w: World | undefined = top; w && chain.length < 10; w = w.below) chain.push(w);
  return chain;
}

describe("every cave level carries the item and recipe catalogs", () => {
  it("all five levels have recipes, items, and the player's base moves", () => {
    const chain = levels(createCaveRun(7));
    expect(chain.length).toBe(5);
    for (const level of chain) {
      expect(Object.keys(level.recipes ?? {}).length, `depth ${level.depth} recipes`).toBeGreaterThan(5);
      expect(Object.keys(level.items ?? {}).length, `depth ${level.depth} items`).toBeGreaterThan(5);
      expect((level.playerBaseMoves ?? []).length, `depth ${level.depth} base moves`).toBeGreaterThan(0);
    }
  });

  it("the same catalog object, so the levels cannot drift apart", () => {
    const chain = levels(createCaveRun(7));
    for (const level of chain.slice(1)) expect(level.recipes).toBe(chain[0]!.recipes);
  });

  it("a recipe you knew upstairs is still craftable after taking the stairs", () => {
    const level1 = createCaveRun(7);
    const me = findPlayer(level1)!;
    expect(me.knownRecipes).toContain("torch");
    me.inventory = [
      { itemKey: "deadwood", weight: 1, count: 2 },
      { itemKey: "fiber", weight: 1, count: 2 },
    ];

    me.pos = { ...level1.stairsDownAt! };
    const level2 = useStairs(level1, me, new EventLog())!;
    expect(level2.depth).toBe(2);
    // The real failure shape: knownRecipes survived, the catalog did not.
    expect(me.knownRecipes).toContain("torch");
    expect(applyPlayerAction(level2, me, { kind: "craft", recipeId: "torch" }, new EventLog())).toBe(true);
  });
});
