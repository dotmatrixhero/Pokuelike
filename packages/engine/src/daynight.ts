/**
 * A fast local day/night cycle, independent of flora.ts's existing 1000-tick
 * seasonal sine wave — see DESIGN.md's "Dynamics that move a content herd"
 * section, Phase 2. Deliberately its own tiny module rather than folded into
 * flora.ts: the two cycles have different periods, different consumers
 * (flora's season only ever fed decay/spread rates; this one feeds FOV,
 * Speed, and hunt-eagerness across three different files), and nothing about
 * the season's sine-wave *shape* needs to be shared code, just the same
 * general "cheap deterministic function of world.tick" style.
 */

/** Ticks per full day/night cycle (midnight -> noon -> midnight). Sim-original magnitude, not canon — DESIGN.md suggested "something like 200". */
export const DAY_LENGTH_TICKS = 200;

/**
 * Light level at a given tick: 0 at midnight, 1 at noon, smoothly cycling —
 * same sine-wave style as flora.ts's `seasonalMultiplier`, just phase-shifted
 * (`-cos` instead of `sin`) so tick 0 lands exactly at midnight (0) rather
 * than mid-rise, which makes `isNight`/`isTwilight` below land on tidy,
 * predictable tick boundaries for tests.
 */
export function lightLevel(tick: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * tick) / DAY_LENGTH_TICKS);
}

/**
 * The single threshold everything in this feature treats as the day/night
 * split: exactly half of every cycle reads as "night" (light below this) and
 * half as "day" — deliberately simple (no separate dawn/dusk "grace" built
 * into this particular check; that's what `isTwilight` below is for) so a
 * diurnal and a nocturnal species each get an equal-length active window by
 * default.
 */
export const NIGHT_THRESHOLD = 0.5;

/** True for exactly the darker half of each cycle — see `NIGHT_THRESHOLD`. */
export function isNight(tick: number): boolean {
  return lightLevel(tick) < NIGHT_THRESHOLD;
}

/**
 * How wide a band of light level, centered on `NIGHT_THRESHOLD`, counts as
 * "dawn or dusk" for crepuscular species. Since light crosses that threshold
 * exactly twice per cycle (once rising, once falling), this band picks out
 * two real twilight windows per day — not the whole transition, just the
 * portion nearest the day/night crossing. Sim-original magnitude, not canon.
 */
const TWILIGHT_BAND = 0.15;

/** True during the two dawn/dusk windows each cycle — see `TWILIGHT_BAND`. */
export function isTwilight(tick: number): boolean {
  return Math.abs(lightLevel(tick) - NIGHT_THRESHOLD) <= TWILIGHT_BAND;
}
