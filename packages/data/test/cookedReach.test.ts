import { describe, expect, it } from "vitest";
import { RECIPES, ITEMS, KNOWN_AT_START } from "../src/crafting.js";
import { MATERIALS, FOOD_MATERIAL_IDS, CROP_IDS, pickCrop, SEASON_LENGTH, type MaterialId } from "@pokuelike/engine";
import { mulberry32 } from "@pokuelike/engine";

/**
 * Direct ask: *"can we make more food recipes available at beginning."*
 *
 * The measurement that motivated it: across 5 seeds x 6 cave levels, nine
 * gatherable foods had no dish at all, including the two most abundant crops
 * in the game (herbs at 1528 harvestable tiles, shroom at 652). These tests
 * keep that from creeping back.
 */

const COOKED = Object.values(RECIPES).filter((r) => r.requiresNearFire);

describe("every cooked dish is actually makeable", () => {
  it("is known from the start — nothing in this game discovers a recipe", () => {
    const locked = COOKED.filter((r) => !KNOWN_AT_START.includes(r.id)).map((r) => r.id);
    expect(locked).toEqual([]);
  });

  it("names only real materials, and produces a real item with cooked stats", () => {
    for (const r of COOKED) {
      for (const input of r.inputs) {
        const real = input.itemKey in MATERIALS || input.itemKey in ITEMS;
        expect(real, `${r.id} wants unknown input ${input.itemKey}`).toBe(true);
      }
      expect(ITEMS[r.output.itemKey]?.cooked, `${r.id} has no cooked stats`).toBeDefined();
    }
  });

  it("yields a shareable number of servings, not a single bite", () => {
    for (const r of COOKED) expect(r.output.count, r.id).toBeGreaterThan(1);
  });
});

describe("no gatherable food is left without a dish", () => {
  /** Foods a player can actually pick up: crops, plus the non-crop food materials. */
  const gatherableFoods = [...FOOD_MATERIAL_IDS].filter((m) => m !== "food") as MaterialId[];

  it("every crop and food material feeds at least one cooked recipe", () => {
    const used = new Set(COOKED.flatMap((r) => r.inputs.map((i) => i.itemKey)));
    const orphans = gatherableFoods.filter((m) => !used.has(m));
    expect(orphans, "gatherable food with no cooked recipe").toEqual([]);
  });

  it("and every crop a recipe names can really grow in some season", () => {
    // CONTROL for the orphan check above: a dish whose crop never spawns is
    // no better than no dish. An earlier sweep read tomato and pumpkin as
    // never spawning — they are simply seasonal, and a generation-time
    // sample only ever sees spring. This asks `pickCrop` across a whole year.
    const rng = mulberry32(3);
    const biomes = ["grassland", "jungle", "forest", "wetland", "highland", "savanna", "mangrove", "tundra", "badlands", "desert", "snow"];
    const everGrows = new Set<string>();
    for (let q = 0; q < 40; q++) {
      const tick = Math.floor((q / 40) * SEASON_LENGTH) + 2;
      for (const biome of biomes) for (let i = 0; i < 400; i++) everGrows.add(pickCrop(biome, 0.2, tick, false, rng));
    }
    expect(CROP_IDS.filter((c) => !everGrows.has(c)), "crops that grow in no season").toEqual([]);

    const cropInputs = COOKED.flatMap((r) => r.inputs.map((i) => i.itemKey)).filter((k) => (CROP_IDS as readonly string[]).includes(k));
    expect(cropInputs.length).toBeGreaterThan(0); // the assertion below is not vacuous
    for (const c of cropInputs) expect(everGrows.has(c), `${c} grows in no season`).toBe(true);
  });
});
