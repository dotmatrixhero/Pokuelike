import { describe, expect, it } from "vitest";
import { NOTABLE_TITLE_LABEL, notableEpithet, notableFullName, notableTale, notableUsurpation } from "../src/notableLore.js";
import type { NotableTitleId } from "../src/types.js";

const TITLES: NotableTitleId[] = ["hero", "builder", "gatherer", "rival", "beloved", "elder", "wanderer"];

describe("notable epithets", () => {
  it("gives every title an epithet", () => {
    for (const title of TITLES) expect(notableEpithet(title, "a-1")).toBeTruthy();
  });

  it("is deterministic — the same animal is called the same thing every time", () => {
    expect(notableEpithet("hero", "a-1")).toBe(notableEpithet("hero", "a-1"));
  });

  it("does not give every holder of a title the same epithet", () => {
    const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => notableEpithet("hero", id)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it("reads as a name — 'Thornhide the Red-Clawed', not an id", () => {
    const full = notableFullName("hero", "bulbasaur-egg-3401");
    expect(full).toMatch(/^[A-Z][a-z]+ /);
    expect(full).not.toContain("-");
    expect(full).not.toContain("hero");
  });
});

describe("notable tales", () => {
  it("every title spins its own distinct story, not one template", () => {
    const tales = TITLES.map((title) => notableTale(title, { value: 7 }));
    expect(new Set(tales).size).toBe(TITLES.length);
  });

  it("uses the real earned number", () => {
    expect(notableTale("hero", { value: 12 })).toContain("12");
    expect(notableTale("wanderer", { value: 114 })).toContain("114");
    expect(notableTale("elder", { value: 7154 })).toContain("7154");
  });

  it("names the nemesis when the rival's grudge has a target", () => {
    const withRival = notableTale("rival", { value: 0.6, rivalId: "venusaur-9" });
    expect(withRival).toMatch(/grudge against [A-Z][a-z]+/);
  });

  it("still reads as a sentence when the nemesis is unknown", () => {
    const without = notableTale("rival", { value: 0.6 });
    expect(without).toContain("grudge");
    expect(without).not.toContain("undefined");
  });

  it("rounds a fractional stat rather than printing float noise", () => {
    expect(notableTale("rival", { value: 0.4000000000001 })).not.toContain("0.4000000");
  });

  it("names the displaced holder only on a real transfer", () => {
    expect(notableUsurpation({ value: 1, previousHolderId: "x-1" })).toMatch(/taking the title from [A-Z][a-z]+/);
    expect(notableUsurpation({ value: 1 })).toBeUndefined();
  });

  it("labels every title in plain language for UI that wants the category", () => {
    for (const title of TITLES) expect(NOTABLE_TITLE_LABEL[title]).toBeTruthy();
  });
});
