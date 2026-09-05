/**
 * Full reference dex imported from PokeRogue (see ../scripts/import-from-pokerogue.mjs).
 * This is library/reference data — separate from the small hand-curated sim roster in
 * ../species.ts and ../moves.ts, which pull their canon numbers from here via
 * `speciesFromDex`/`moveCanon` instead of duplicating them by hand.
 */
export * from "./species.generated.js";
export * from "./moves.generated.js";
export * from "./abilities.generated.js";
export * from "./items.generated.js";
export * from "./type-chart.generated.js";
