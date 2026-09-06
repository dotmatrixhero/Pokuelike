/**
 * Compass-edge directions shared between `worldgen.ts` (a promoted zone's
 * per-tile generation bias — which edge of the tile grid should pull toward
 * ocean/higher ground) and `macroGrid.ts` (the macro zone grid's own
 * neighbor/coastline/river bookkeeping). Pulled out to its own
 * dependency-free module, same reason `mulberry32` lives in `rng.ts` instead
 * of `worldgen.ts` (see that file's own doc comment): `macroGrid.ts` needs
 * `worldgen.ts`'s `generateMacroElevation`, and `worldgen.ts` needs this
 * `ZoneDirection` type for its bias parameter — a direct import either way would
 * be a cycle.
 */
export type ZoneDirection = "N" | "E" | "S" | "W";

export const DIRECTIONS: readonly ZoneDirection[] = ["N", "E", "S", "W"];

/** Row/col step for one grid move in this direction — row is the N/S axis, col is the E/W axis. */
export const DIRECTION_DELTA: Readonly<Record<ZoneDirection, { dr: number; dc: number }>> = {
  N: { dr: -1, dc: 0 },
  S: { dr: 1, dc: 0 },
  E: { dr: 0, dc: 1 },
  W: { dr: 0, dc: -1 },
};

export const OPPOSITE_DIRECTION: Readonly<Record<ZoneDirection, ZoneDirection>> = {
  N: "S",
  S: "N",
  E: "W",
  W: "E",
};
