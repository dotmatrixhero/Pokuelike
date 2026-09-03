import { describe, expect, it } from "vitest";
import { calculateStats } from "../src/stats.js";
import {
  NATURE_NAMES,
  NATURES,
  dispositionFromNature,
  dispositionSummary,
  natureMultiplier,
  randomNature,
} from "../src/nature.js";

const BULBASAUR_BASE = { hp: 45, attack: 49, defense: 49, spAttack: 65, spDefense: 65, speed: 45 };

describe("NATURES table", () => {
  it("has exactly the 25 real mainline natures", () => {
    expect(NATURE_NAMES).toHaveLength(25);
  });

  it("has exactly 5 neutral natures (no raise/lower)", () => {
    const neutral = NATURE_NAMES.filter((name) => !NATURES[name].raises && !NATURES[name].lowers);
    expect(neutral.sort()).toEqual(["Bashful", "Docile", "Hardy", "Quirky", "Serious"]);
  });

  it("no nature raises and lowers the same stat, and non-neutral natures always set both", () => {
    for (const name of NATURE_NAMES) {
      const effect = NATURES[name];
      const isNeutral = !effect.raises && !effect.lowers;
      if (isNeutral) continue;
      expect(effect.raises).toBeDefined();
      expect(effect.lowers).toBeDefined();
      expect(effect.raises).not.toBe(effect.lowers);
    }
  });

  it("spot-checks a few real mainline pairings", () => {
    expect(NATURES.Adamant).toEqual({ raises: "attack", lowers: "spAttack" });
    expect(NATURES.Modest).toEqual({ raises: "spAttack", lowers: "attack" });
    expect(NATURES.Jolly).toEqual({ raises: "speed", lowers: "spAttack" });
    expect(NATURES.Timid).toEqual({ raises: "speed", lowers: "attack" });
    expect(NATURES.Bold).toEqual({ raises: "defense", lowers: "attack" });
    expect(NATURES.Calm).toEqual({ raises: "spDefense", lowers: "attack" });
  });
});

describe("randomNature", () => {
  it("always returns a real nature name, driven by the injected rng", () => {
    expect(randomNature(() => 0)).toBe(NATURE_NAMES[0]);
    expect(randomNature(() => 0.999)).toBe(NATURE_NAMES[NATURE_NAMES.length - 1]);
  });
});

describe("natureMultiplier / calculateStats nature wiring", () => {
  it("neutral natures produce identical stats to no nature at all", () => {
    const base = calculateStats(BULBASAUR_BASE, 20);
    for (const neutral of ["Hardy", "Docile", "Serious", "Bashful", "Quirky"]) {
      expect(calculateStats(BULBASAUR_BASE, 20, neutral)).toEqual(base);
    }
  });

  it("an unknown or absent nature is treated as neutral", () => {
    const base = calculateStats(BULBASAUR_BASE, 20);
    expect(calculateStats(BULBASAUR_BASE, 20, "NotARealNature")).toEqual(base);
  });

  it("Adamant raises attack and lowers spAttack by ~10% relative to neutral", () => {
    const neutral = calculateStats(BULBASAUR_BASE, 50, "Hardy");
    const adamant = calculateStats(BULBASAUR_BASE, 50, "Adamant");
    expect(adamant.attack).toBe(Math.floor(neutral.attack * 1.1));
    expect(adamant.spAttack).toBe(Math.floor(neutral.spAttack * 0.9));
    // Untouched stats are unaffected.
    expect(adamant.defense).toBe(neutral.defense);
    expect(adamant.speed).toBe(neutral.speed);
    expect(adamant.maxHp).toBe(neutral.maxHp);
  });

  it("Jolly raises speed and lowers spAttack", () => {
    const neutral = calculateStats(BULBASAUR_BASE, 50);
    const jolly = calculateStats(BULBASAUR_BASE, 50, "Jolly");
    expect(jolly.speed).toBe(Math.floor(neutral.speed * 1.1));
    expect(jolly.spAttack).toBe(Math.floor(neutral.spAttack * 0.9));
  });

  it("HP is never affected by nature", () => {
    const neutral = calculateStats(BULBASAUR_BASE, 50);
    for (const name of NATURE_NAMES) {
      expect(calculateStats(BULBASAUR_BASE, 50, name).maxHp).toBe(neutral.maxHp);
    }
  });
});

describe("dispositionFromNature", () => {
  it("is deterministic given a fixed rng", () => {
    const rng = () => 0.5; // zero jitter (rng()*2-1 == 0)
    const a = dispositionFromNature("Adamant", rng);
    const b = dispositionFromNature("Adamant", rng);
    expect(a).toEqual(b);
  });

  it("leans aggression higher for an Attack-family-raising nature (no jitter)", () => {
    const zeroJitter = () => 0.5;
    const adamant = dispositionFromNature("Adamant", zeroJitter); // raises attack
    const modest = dispositionFromNature("Modest", zeroJitter); // raises spAttack
    expect(adamant.aggression).toBeCloseTo(0.7);
    expect(modest.aggression).toBeCloseTo(0.7);
  });

  it("leans boldness higher for a Speed-raising/Defense-lowering nature (no jitter)", () => {
    const zeroJitter = () => 0.5;
    const timid = dispositionFromNature("Timid", zeroJitter); // raises speed
    expect(timid.boldness).toBeCloseTo(0.7);
    const hasty = dispositionFromNature("Hasty", zeroJitter); // raises speed AND lowers defense — stacks
    expect(hasty.boldness).toBeCloseTo(0.9);
  });

  it("leans boldness lower for a Defense/SpDefense-raising nature (no jitter)", () => {
    const zeroJitter = () => 0.5;
    const bold = dispositionFromNature("Bold", zeroJitter); // raises defense
    expect(bold.boldness).toBeCloseTo(0.3);
    const calm = dispositionFromNature("Calm", zeroJitter); // raises spDefense
    expect(calm.boldness).toBeCloseTo(0.3);
  });

  it("seeds sociability higher for neutral natures than non-neutral ones (no jitter)", () => {
    const zeroJitter = () => 0.5;
    const hardy = dispositionFromNature("Hardy", zeroJitter);
    const adamant = dispositionFromNature("Adamant", zeroJitter);
    expect(hardy.sociability).toBeGreaterThan(adamant.sociability);
  });

  it("jitter stays within the documented +/-0.15 range", () => {
    const rng = () => 1; // max positive jitter: (1*2-1)*0.15 = +0.15
    const disposition = dispositionFromNature("Hardy", rng);
    // Hardy baseline: boldness 0.5, aggression 0.5, sociability 0.65; +0.15 each.
    expect(disposition.boldness).toBeCloseTo(0.65);
    expect(disposition.aggression).toBeCloseTo(0.65);
    expect(disposition.sociability).toBeCloseTo(0.8);
  });

  it("clamps at the 0 and 1 boundaries", () => {
    const rngLow = () => 0; // most negative jitter: (0*2-1)*0.15 = -0.15
    const bold = dispositionFromNature("Bold", rngLow); // baseline boldness 0.3 - 0.15 = 0.15, fine, not clamped
    expect(bold.boldness).toBeCloseTo(0.15);

    // Force an out-of-range baseline by stacking Hasty (0.9 baseline boldness) with max jitter.
    const rngHigh = () => 1;
    const hasty = dispositionFromNature("Hasty", rngHigh); // 0.9 + 0.15 = 1.05 -> clamped to 1
    expect(hasty.boldness).toBe(1);
  });
});

describe("dispositionSummary", () => {
  it("names the most distinctive axis", () => {
    expect(dispositionSummary({ boldness: 0.9, aggression: 0.5, sociability: 0.5 })).toBe("high boldness");
    expect(dispositionSummary({ boldness: 0.5, aggression: 0.1, sociability: 0.5 })).toBe("low aggression");
    expect(dispositionSummary({ boldness: 0.5, aggression: 0.5, sociability: 0.5 })).toBe("moderate boldness");
  });
});
