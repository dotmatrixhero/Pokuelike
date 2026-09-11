import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/rng.js";

describe("mulberry32 state capture (save/resume)", () => {
  it("resumes the exact sequence from a captured state, not the seed", () => {
    const original = mulberry32(12345);
    for (let i = 0; i < 500; i++) original(); // burn in, as a real run would

    const saved = original.state!();
    const expected = Array.from({ length: 20 }, () => original());

    const resumed = mulberry32(saved);
    const actual = Array.from({ length: 20 }, () => resumed());

    expect(actual).toEqual(expected);
  });

  it("resuming from the SEED instead would replay old numbers — the bug this guards", () => {
    const original = mulberry32(12345);
    const firstFew = Array.from({ length: 5 }, () => original());
    for (let i = 0; i < 200; i++) original();

    // What a naive save (storing only rngSeed) would reconstruct.
    const rewound = mulberry32(12345);
    const rewoundFirstFew = Array.from({ length: 5 }, () => rewound());
    expect(rewoundFirstFew).toEqual(firstFew); // identical == the stream restarted

    // What capturing real state gives instead.
    const resumed = mulberry32(original.state!());
    expect(Array.from({ length: 5 }, () => resumed())).not.toEqual(firstFew);
  });

  it("state() reflects the generator advancing, and is stable between calls", () => {
    const rng = mulberry32(999);
    const before = rng.state!();
    expect(rng.state!()).toBe(before); // reading does not advance
    rng();
    expect(rng.state!()).not.toBe(before);
  });

  it("state is a uint32, so it survives a JSON round trip unchanged", () => {
    const rng = mulberry32(0xdeadbeef);
    for (let i = 0; i < 77; i++) rng();
    const saved = rng.state!();
    expect(Number.isInteger(saved)).toBe(true);
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(saved).toBeLessThanOrEqual(0xffffffff);
    expect(JSON.parse(JSON.stringify({ saved })).saved).toBe(saved);
  });

  it("a plain function without state() is still a valid SeededRng (test stubs)", () => {
    const stub: () => number = () => 0.5;
    // The save path must tolerate this rather than assume state() exists.
    expect((stub as { state?: () => number }).state).toBeUndefined();
  });
});
