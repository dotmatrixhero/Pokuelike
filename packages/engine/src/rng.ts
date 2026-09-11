/**
 * The engine's one shared seeded-PRNG implementation — see DESIGN.md's
 * "Determinism: a seeded PRNG threaded through the whole engine" section.
 *
 * This used to live in worldgen.ts (the only consumer before this feature)
 * and is still re-exported from there for every existing import site
 * (`import { mulberry32 } from "./worldgen.js"`, used throughout
 * worldgen.test.ts). It moved to its own dependency-free module so
 * world.ts (which worldgen.ts itself imports from — `createWorld`,
 * `setElevation`, `setTile`, `tileAt`) can also import `mulberry32` for
 * `World.rng` without creating a `world.ts` <-> `worldgen.ts` import cycle.
 */

/**
 * A seeded generator that can also report where in its sequence it currently
 * is, so a run can be saved and resumed without rewinding its randomness.
 *
 * `state` is optional because plenty of callers legitimately pass a plain
 * `() => number` — a fixed-output stub in a test, say (see `World.rng`'s own
 * doc comment). Anything that saves state must therefore tolerate its
 * absence rather than assume it.
 */
export interface SeededRng {
  (): number;
  /** This generator's complete internal state right now. Feed it back to `mulberry32` to resume exactly here. */
  state?: () => number;
}

/**
 * mulberry32 — a small, fast, well-known 32-bit seeded PRNG (public domain).
 * Deterministic: the same seed always produces the same sequence, which is
 * the whole point (reproducible generated worlds, and now reproducible
 * *behavior*, for debugging/replaying a specific run).
 *
 * The generator's entire state is the single 32-bit `a`, and the constructor
 * does nothing but `a = seed >>> 0` — so `mulberry32(rng.state!())` is not an
 * approximation of where the stream had got to, it *is* the exact
 * continuation. That property is what lets a saved run resume without either
 * replaying every tick or rewinding to worldgen and handing the player the
 * same "random" numbers a second time.
 */
export function mulberry32(seed: number): SeededRng {
  let a = seed >>> 0;
  const random: SeededRng = function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  random.state = () => a >>> 0;
  return random;
}

/**
 * A real (non-reproducible) seed for when the caller doesn't supply one —
 * `createWorld`/`createDemoWorld`'s fallback, and `packages/runner`'s CLI
 * when invoked without an explicit seed argument. Prefers
 * `crypto.getRandomValues` (available in both Node's global `crypto` and
 * every browser this sim's `packages/web` targets) for real entropy; falls
 * back to `Date.now()` XORed with `Math.random()`'s own entropy source on
 * the rare runtime where `crypto` isn't available. Either way, this is the
 * *only* place in the engine that still touches non-seeded randomness, and
 * only to mint a fresh seed to print/log so an unseeded run can still be
 * identified and, from then on, reproduced — never used to drive simulation
 * behavior directly.
 */
export function randomSeed(): number {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const arr = new Uint32Array(1);
    cryptoObj.getRandomValues(arr);
    return arr[0]!;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}
