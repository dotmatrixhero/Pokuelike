import { describe, expect, it } from "vitest";
import { DAY_LENGTH_TICKS, NIGHT_THRESHOLD, isNight, isTwilight, lightLevel } from "../src/daynight.js";

describe("lightLevel", () => {
  it("is 0 at midnight (tick 0) and every full cycle after", () => {
    expect(lightLevel(0)).toBeCloseTo(0, 10);
    expect(lightLevel(DAY_LENGTH_TICKS)).toBeCloseTo(0, 10);
    expect(lightLevel(DAY_LENGTH_TICKS * 3)).toBeCloseTo(0, 10);
  });

  it("is 1 at noon (half a cycle in)", () => {
    expect(lightLevel(DAY_LENGTH_TICKS / 2)).toBeCloseTo(1, 10);
  });

  it("rises from midnight to noon, then falls back to midnight — a real cycle, not a monotonic ramp", () => {
    const midnight = lightLevel(0);
    const quarter = lightLevel(DAY_LENGTH_TICKS / 4);
    const noon = lightLevel(DAY_LENGTH_TICKS / 2);
    const threeQuarter = lightLevel((DAY_LENGTH_TICKS * 3) / 4);
    const nextMidnight = lightLevel(DAY_LENGTH_TICKS);

    expect(midnight).toBeLessThan(quarter);
    expect(quarter).toBeLessThan(noon);
    expect(noon).toBeGreaterThan(threeQuarter);
    expect(threeQuarter).toBeGreaterThan(nextMidnight);
  });

  it("stays within [0, 1] and is deterministic (same tick, same value)", () => {
    for (let tick = 0; tick < DAY_LENGTH_TICKS * 2; tick += 7) {
      const value = lightLevel(tick);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      expect(lightLevel(tick)).toBe(value); // pure function of tick, no hidden state
    }
  });
});

describe("isNight", () => {
  it("is true for exactly the darker half of each cycle, false for the brighter half", () => {
    expect(isNight(0)).toBe(true); // midnight
    expect(isNight(DAY_LENGTH_TICKS / 2)).toBe(false); // noon
    expect(isNight(DAY_LENGTH_TICKS / 4)).toBe(true); // rising toward noon, still below threshold
    expect(isNight((DAY_LENGTH_TICKS * 3) / 4)).toBe(false); // falling from noon, still above threshold
  });

  it("agrees exactly with the NIGHT_THRESHOLD light-level cutoff", () => {
    for (let tick = 0; tick < DAY_LENGTH_TICKS; tick++) {
      expect(isNight(tick)).toBe(lightLevel(tick) < NIGHT_THRESHOLD);
    }
  });
});

describe("isTwilight", () => {
  it("is true near the day/night threshold crossing (dawn and dusk), false at noon and midnight", () => {
    expect(isTwilight(DAY_LENGTH_TICKS / 2)).toBe(false); // noon — full daylight, not twilight
    expect(isTwilight(0)).toBe(false); // midnight — full dark, not twilight

    // Find the tick where light crosses NIGHT_THRESHOLD rising (dawn) by scanning.
    let dawnTick = -1;
    for (let tick = 0; tick < DAY_LENGTH_TICKS / 2; tick++) {
      if (lightLevel(tick) >= NIGHT_THRESHOLD) {
        dawnTick = tick;
        break;
      }
    }
    expect(dawnTick).toBeGreaterThan(0);
    expect(isTwilight(dawnTick)).toBe(true);
  });

  it("fires twice per cycle (dawn and dusk), not continuously", () => {
    let twilightWindows = 0;
    let wasTwilight = false;
    for (let tick = 0; tick < DAY_LENGTH_TICKS; tick++) {
      const nowTwilight = isTwilight(tick);
      if (nowTwilight && !wasTwilight) twilightWindows++;
      wasTwilight = nowTwilight;
    }
    expect(twilightWindows).toBe(2);
  });
});
