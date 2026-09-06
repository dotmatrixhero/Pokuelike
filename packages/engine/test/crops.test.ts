import { describe, expect, it } from "vitest";
import { CROP_IDS, FOOD_CROPS, pickCrop, seasonName, seasonPhase, seasonalMultiplier, SEASON_LENGTH, WINTER_NON_HARDY_FOOD_CHANCE_MULTIPLIER } from "../src/crops.js";

describe("seasonPhase / seasonName", () => {
  it("seasonPhase stays within 0..1 and wraps at SEASON_LENGTH", () => {
    expect(seasonPhase(0)).toBe(0);
    expect(seasonPhase(SEASON_LENGTH)).toBe(0);
    expect(seasonPhase(SEASON_LENGTH / 2)).toBeCloseTo(0.5, 5);
    for (let tick = 0; tick < 4000; tick += 137) {
      const phase = seasonPhase(tick);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  it("names the four quartiles in order", () => {
    expect(seasonName(0)).toBe("spring");
    expect(seasonName(SEASON_LENGTH * 0.3)).toBe("summer");
    expect(seasonName(SEASON_LENGTH * 0.6)).toBe("autumn");
    expect(seasonName(SEASON_LENGTH * 0.9)).toBe("winter");
  });

  it("seasonalMultiplier (the pre-existing decay wave) stays within 0..1 — unchanged by moving it here", () => {
    for (let tick = 0; tick < 2000; tick += 137) {
      const m = seasonalMultiplier(tick);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});

describe("pickCrop", () => {
  const alwaysFirst = () => 0;

  it("picks Herbs (the first ungated crop) when rng always favors the first option and nothing biome-gated is eligible", () => {
    expect(pickCrop(undefined, undefined, 0, false, alwaysFirst)).toBe("herbs");
  });

  it("with no biome data at all, only the ungated crops (Herbs and the four original berries) are ever eligible", () => {
    for (let i = 0; i < 50; i++) {
      const crop = pickCrop(undefined, undefined, 0, false, () => i / 50);
      expect(["herbs", "oran", "pecha", "sitrus", "cheri"]).toContain(crop);
    }
  });

  it("never picks a biome-gated crop for a biome it doesn't list", () => {
    // Badlands has no crop of its own besides Potato, plus the ungated
    // Herbs/berries — confirm Wheat/Corn/etc (grassland-only) never show up
    // here across many rolls.
    for (let i = 0; i < 50; i++) {
      const crop = pickCrop("badlands", undefined, 0, false, () => i / 50);
      expect(["herbs", "oran", "pecha", "sitrus", "cheri", "potato"]).toContain(crop);
    }
  });

  it("Rice requires both its biome AND a real, achievable moisture band — biome alone isn't enough", () => {
    // 0.05 is below Rice's real moisture floor (0.1, calibrated against a
    // real sampled run — see crops.ts's own doc comment on why an
    // unreachable [0.6, 1] band would have been a real bug).
    const lowMoisture = new Set<string>();
    for (let i = 0; i < 50; i++) lowMoisture.add(pickCrop("wetland", 0.05, 0, false, () => i / 50));
    expect(lowMoisture.has("rice")).toBe(false);

    const highMoisture = new Set<string>();
    for (let i = 0; i < 50; i++) highMoisture.add(pickCrop("wetland", 0.25, 0, false, () => i / 50));
    expect(highMoisture.has("rice")).toBe(true);
  });

  it("Tomato is favored (not required) near a sunbeam — real sunbeam tiles never actually generate in its own Grassland/Jungle biomes, so a hard requirement would make it unreachable", () => {
    // Still eligible without a sunbeam nearby...
    const noSun = new Set<string>();
    for (let i = 0; i < 50; i++) noSun.add(pickCrop("grassland", undefined, SEASON_LENGTH * 0.3, false, () => i / 50));
    expect(noSun.has("tomato")).toBe(true);

    // ...but appears more often (double weight) when one is.
    function tomatoHitRate(nearSun: boolean): number {
      let hits = 0;
      const trials = 200;
      for (let i = 0; i < trials; i++) {
        if (pickCrop("grassland", undefined, SEASON_LENGTH * 0.3, nearSun, () => i / trials) === "tomato") hits++;
      }
      return hits / trials;
    }
    expect(tomatoHitRate(true)).toBeGreaterThan(tomatoHitRate(false));
  });

  it("Apple and Pumpkin only appear in their own (offset, non-overlapping) Autumn half", () => {
    // Apple's window (Autumn first half)
    const appleWindow = new Set<string>();
    for (let i = 0; i < 50; i++) appleWindow.add(pickCrop("forest", undefined, SEASON_LENGTH * 0.55, false, () => i / 50));
    expect(appleWindow.has("apple")).toBe(true);

    // Outside Autumn entirely, Apple never appears even in its own biome.
    const outsideAutumn = new Set<string>();
    for (let i = 0; i < 50; i++) outsideAutumn.add(pickCrop("forest", undefined, SEASON_LENGTH * 0.1, false, () => i / 50));
    expect(outsideAutumn.has("apple")).toBe(false);

    // Pumpkin's window (Autumn second half) never overlaps Apple's.
    const pumpkinWindow = new Set<string>();
    for (let i = 0; i < 50; i++) pumpkinWindow.add(pickCrop("grassland", undefined, SEASON_LENGTH * 0.7, false, () => i / 50));
    expect(pumpkinWindow.has("pumpkin")).toBe(true);
    expect(appleWindow.has("pumpkin")).toBe(false);
    expect(pumpkinWindow.has("apple")).toBe(false);
  });

  it("is deterministic for a fixed rng sequence", () => {
    const rng1 = (() => {
      let i = 0;
      const seq = [0.1, 0.4, 0.9];
      return () => seq[i++ % seq.length]!;
    })();
    const rng2 = (() => {
      let i = 0;
      const seq = [0.1, 0.4, 0.9];
      return () => seq[i++ % seq.length]!;
    })();
    const a = pickCrop("grassland", 0.5, SEASON_LENGTH * 0.3, false, rng1);
    const b = pickCrop("grassland", 0.5, SEASON_LENGTH * 0.3, false, rng2);
    expect(a).toBe(b);
  });
});

describe("FOOD_CROPS registry", () => {
  it("every crop has a positive nutrition multiplier, and the ladder is monotonic with restriction (Herbs lowest, Pumpkin highest)", () => {
    for (const id of CROP_IDS) {
      expect(FOOD_CROPS[id].nutritionMultiplier).toBeGreaterThan(0);
    }
    expect(FOOD_CROPS.herbs.nutritionMultiplier).toBeLessThan(FOOD_CROPS.wheat.nutritionMultiplier);
    expect(FOOD_CROPS.wheat.nutritionMultiplier).toBeLessThan(FOOD_CROPS.rice.nutritionMultiplier);
    expect(FOOD_CROPS.rice.nutritionMultiplier).toBeLessThan(FOOD_CROPS.potato.nutritionMultiplier);
    expect(FOOD_CROPS.potato.nutritionMultiplier).toBeLessThan(FOOD_CROPS.pumpkin.nutritionMultiplier);
  });

  it("only Potato is winterHardy/droughtResistant", () => {
    for (const id of CROP_IDS) {
      if (id === "potato") continue;
      expect(FOOD_CROPS[id].winterHardy).toBeFalsy();
      expect(FOOD_CROPS[id].droughtResistant).toBeFalsy();
    }
    expect(FOOD_CROPS.potato.winterHardy).toBe(true);
    expect(FOOD_CROPS.potato.droughtResistant).toBe(true);
  });

  it("WINTER_NON_HARDY_FOOD_CHANCE_MULTIPLIER is a real reduction, not a token one", () => {
    expect(WINTER_NON_HARDY_FOOD_CHANCE_MULTIPLIER).toBeGreaterThan(0);
    expect(WINTER_NON_HARDY_FOOD_CHANCE_MULTIPLIER).toBeLessThan(0.5);
  });
});
