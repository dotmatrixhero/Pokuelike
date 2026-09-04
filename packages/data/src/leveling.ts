import type { GrowthRateKey, LevelingContext, LevelingProfile, MoveSpec } from "@pokuelike/engine";
import { SPECIES_DEX, SPECIES_DEX_BY_KEY, MOVE_DEX_BY_KEY } from "./dex/index.js";
import { MOVES, moveCanon } from "./moves.js";
import { SPECIES } from "./species.js";

/** Reverse lookup: PokeRogue numeric species id -> its dex key, for resolving evolution targets. */
const SPECIES_KEY_BY_ID: Record<number, string> = Object.fromEntries(SPECIES_DEX.map((s) => [s.id, s.key]));

/**
 * Reverse of the dex's forward-only `evolutions` links: dex key -> the
 * species it evolves *from* (its immediate pre-evolution), for walking a
 * line back down to its base form. The dex only records "X evolves into Y
 * at level N", never "Y evolves from X", so this is built once by scanning
 * every species' evolutions and recording the target's prevo.
 */
const PREVO_KEY_BY_KEY: Record<string, string> = {};
for (const species of SPECIES_DEX) {
  for (const evo of species.evolutions) {
    const targetKey = SPECIES_KEY_BY_ID[evo.target];
    if (targetKey) PREVO_KEY_BY_KEY[targetKey] = species.key;
  }
}

/**
 * Walks a species back to the root of its evolutionary line — e.g.
 * "venusaur" -> "ivysaur" -> "bulbasaur". Breeding always produces the base
 * form (see `LevelingContext.baseSpeciesOf`'s doc comment in engine).
 * Species outside the dex (shouldn't happen for a sim species id, but
 * defensive) just return themselves.
 */
function baseSpeciesOf(speciesId: string): string {
  let key = speciesId.toUpperCase();
  // A cycle would spin forever; the dex has none, but this is cheap insurance.
  const seen = new Set<string>();
  while (PREVO_KEY_BY_KEY[key] && !seen.has(key)) {
    seen.add(key);
    key = PREVO_KEY_BY_KEY[key]!;
  }
  return key.toLowerCase();
}

/**
 * Real mainline egg groups, keyed by the *base* (root) species of the line
 * — every evolution stage shares its line's groups, so this only needs one
 * entry per line rather than one per stage. Hand-curated because the
 * source dex (PokeRogue) doesn't carry egg-group data at all — see
 * `LevelingProfile.eggGroups`'s doc comment in engine/leveling.ts. Scoped
 * to species reachable from the current sim roster (`species.ts`) and
 * their evolution lines; extend this whenever a new base species is added
 * to the roster. Bulbasaur and Charmander both include "monster" — a real
 * cross-species breeding pair in the actual games, unlike same-species-only
 * pairs like Scyther or Pidgey.
 */
const EGG_GROUPS_BY_BASE_KEY: Record<string, string[]> = {
  BULBASAUR: ["monster", "grass"],
  CHARMANDER: ["monster", "dragon"],
  SCYTHER: ["bug"],
  DIGLETT: ["field"],
  PIDGEY: ["flying"],
  // Real cross-species pair with Pidgey (both Flying group) — verified
  // against Bulbapedia, same precedent as Bulbasaur/Charmander sharing
  // Monster.
  SPEAROW: ["flying"],
  // Real cross-species pair with Diglett (both Field group) — verified
  // against Bulbapedia.
  SANDSHREW: ["field"],
  // Mineral group — distinct from Diglett's Field group despite both being
  // "underground" thematically; verified against Bulbapedia, so Onix does
  // NOT cross-breed with Diglett/Sandshrew, matching the real games.
  ONIX: ["mineral"],
  // Real cross-species pair with Bulbasaur AND Charmander (all three
  // starters share Monster in the real games) as well as with anything
  // else in Water 1 — verified against Bulbapedia.
  SQUIRTLE: ["monster", "water1"],

  // --- Gen 1 batch below: recalled from training knowledge (Bulbapedia's
  // canon Egg Group data), not scraped/machine-verified — this sandbox's
  // network egress is locked to an allowlist that excludes PokeAPI/
  // Bulbapedia, so a real fetch-and-generate script wasn't possible (see
  // chat). Spot-check against Bulbapedia if a cross-species pairing here
  // ever looks wrong in a real run. None of these are in the current spawn
  // roster yet — this is headroom for whenever the roster grows, same as
  // the entries above were before their species were added.
  // Known simplification: a few lines have a real per-stage breeding
  // exception in the actual games (e.g. Nidorina/Nidoqueen and Nidorino/
  // Nidoking can't breed at all, only their unevolved Nidoran forms can) —
  // not modeled here, since this table (like the ones above) is keyed by
  // base species and applies line-wide, matching this file's existing
  // baseSpeciesOf-driven convention.
  CATERPIE: ["bug"],
  WEEDLE: ["bug"],
  RATTATA: ["field"],
  EKANS: ["field", "dragon"],
  PIKACHU: ["field", "fairy"],
  NIDORAN_F: ["field", "fairy"],
  NIDORAN_M: ["field", "fairy"],
  CLEFAIRY: ["fairy"],
  VULPIX: ["field"],
  JIGGLYPUFF: ["fairy"],
  ZUBAT: ["flying"],
  ODDISH: ["grass"],
  PARAS: ["bug", "grass"],
  VENONAT: ["bug"],
  MEOWTH: ["field"],
  PSYDUCK: ["water1"],
  MANKEY: ["field"],
  GROWLITHE: ["field"],
  POLIWAG: ["water1"],
  ABRA: ["human-like"],
  MACHOP: ["human-like"],
  BELLSPROUT: ["grass"],
  TENTACOOL: ["water3"],
  GEODUDE: ["mineral"],
  PONYTA: ["field"],
  SLOWPOKE: ["monster", "water1"],
  MAGNEMITE: ["mineral"],
  FARFETCHD: ["flying", "field"],
  DODUO: ["flying", "field"],
  SEEL: ["water1", "field"],
  GRIMER: ["amorphous"],
  SHELLDER: ["water1", "water3"],
  GASTLY: ["amorphous"],
  DROWZEE: ["human-like"],
  KRABBY: ["water3"],
  VOLTORB: ["mineral"],
  EXEGGCUTE: ["grass"],
  CUBONE: ["monster", "field"],
  HITMONLEE: ["human-like"],
  HITMONCHAN: ["human-like"],
  LICKITUNG: ["monster"],
  KOFFING: ["amorphous"],
  RHYHORN: ["monster", "field"],
  CHANSEY: ["fairy"],
  TANGELA: ["grass"],
  KANGASKHAN: ["monster"],
  HORSEA: ["water1", "dragon"],
  GOLDEEN: ["water2"],
  STARYU: ["water3"],
  MR_MIME: ["fairy", "human-like"],
  JYNX: ["human-like"],
  ELECTABUZZ: ["human-like"],
  MAGMAR: ["human-like"],
  PINSIR: ["bug"],
  TAUROS: ["field"],
  MAGIKARP: ["water2", "dragon"],
  LAPRAS: ["monster", "water1"],
  // Ditto's real "breeds with anything but Ditto/Undiscovered" wildcard
  // rule isn't modeled by `canBreed` yet (see TODO.md) — this entry alone
  // does nothing useful until that wildcard logic exists, added now so it's
  // not forgotten when it does.
  DITTO: ["ditto"],
  EEVEE: ["field"],
  PORYGON: ["mineral"],
  OMANYTE: ["water3", "water1"],
  KABUTO: ["water3", "water1"],
  AERODACTYL: ["flying"],
  SNORLAX: ["monster"],
  DRATINI: ["water1", "dragon"],
  // Articuno/Zapdos/Moltres/Mewtwo/Mew deliberately omitted: real
  // Undiscovered-group legendaries, can't breed at all — same effect as an
  // explicit empty array via this map's `?? []` fallback, just without a
  // redundant entry.
};

/**
 * A sim species id (`Agent.species`) is always the lowercased dex key
 * (`speciesFromDex` in species.ts) — including for species that aren't part
 * of the curated `SPECIES` roster, since evolution can land an agent on one
 * (e.g. bulbasaur -> "ivysaur", which has no hand-curated `SpeciesDef`).
 * `getProfile` reads straight from the full dex, so this works for any of
 * the 1083 imported species, not just the demo roster.
 */
function profileFromDexEntry(speciesId: string): LevelingProfile | undefined {
  const entry = SPECIES_DEX_BY_KEY[speciesId.toUpperCase()];
  if (!entry) return undefined;
  return {
    growthRate: entry.growthRate as GrowthRateKey,
    baseStats: entry.baseStats,
    types: entry.types,
    baseExp: entry.baseExp,
    levelMoves: entry.levelMoves,
    eggGroups: EGG_GROUPS_BY_BASE_KEY[baseSpeciesOf(speciesId).toUpperCase()] ?? [],
    // `speciesId` here is always lowercase (`Agent.species`'s convention —
    // see `speciesFromDex`), matching `SPECIES`'s own keys directly. Only
    // the curated roster's own entries (not every one of the dex's 1083
    // species) ever carry `buildsShelter` — an evolved form not itself in
    // `SPECIES` (e.g. a hypothetical Dugtrio, absent from the current
    // roster) reads as `undefined`/false here, the same known "denormalized
    // at spawn, doesn't follow evolution" scope this sim already accepts
    // for `activityPattern` (see `Agent.activityPattern`'s doc comment) —
    // not a new gap, an existing one this feature doesn't attempt to close.
    buildsShelter: SPECIES[speciesId.toLowerCase()]?.buildsShelter,
    // Level-gated evolutions only — item/trade/friendship evolutions are
    // explicitly deferred, see DESIGN.md. Real bug caught while adding Onix:
    // `level` alone isn't sufficient — PokeRogue's dex stamps a `level: 1`
    // placeholder on trade evolutions too (e.g. Onix -> Steelix, which needs
    // Metal Coat + trade), so a pure `level !== undefined` check would have
    // "evolved" Onix into Steelix on its very first level-up. `conditions`
    // being non-empty is the real signal that this isn't a pure level
    // evolution, so it's excluded here regardless of what `level` says.
    evolutions: entry.evolutions
      .filter((e): e is typeof e & { level: number } => e.level !== undefined && Object.keys(e.conditions).length === 0)
      .map((e) => ({ targetSpeciesId: (SPECIES_KEY_BY_ID[e.target] ?? String(e.target)).toLowerCase(), level: e.level })),
  };
}

/** Curated sim move id (e.g. "vine_whip") <-> its dex key ("VINE_WHIP") — every curated id is the lowercased dex key. */
const CURATED_MOVE_BY_DEX_KEY: Record<string, MoveSpec> = Object.fromEntries(
  Object.values(MOVES).map((move) => [move.id.toUpperCase(), move])
);

/**
 * A level-learned move that isn't in the small curated `MOVES` roster still
 * needs a usable `MoveSpec` for combat. Scope call: derive one straight from
 * the reference dex's numbers via `moveCanon` (real type/category/power/
 * accuracy) with a flat, sensible default shape/range/cooldown, since the
 * dex doesn't carry those sim-specific fields — a melee point-shape hit,
 * range {0,1}, cooldown 1. This is a deliberately simple fallback, not a
 * real per-move design pass (that's what promotes a move into the curated
 * roster later, same as the existing five). Status moves (no damage/shape to
 * derive at all — `moveCanon` throws for them) return undefined: they're
 * still recorded in `Agent.knownMoves` and logged via `learnedMove`, they
 * just can't be selected in combat, since this sim has no status-effect
 * engine yet (see DESIGN.md/TODO.md).
 */
function resolveMove(moveKey: string): MoveSpec | undefined {
  const curated = CURATED_MOVE_BY_DEX_KEY[moveKey];
  if (curated) return curated;

  const entry = MOVE_DEX_BY_KEY[moveKey];
  if (!entry || entry.category === "status") return undefined;

  return {
    id: moveKey.toLowerCase(),
    name: entry.name,
    shape: { kind: "point" },
    ...moveCanon(moveKey),
    cooldownTicks: 1,
    range: { min: 0, max: 1 },
  };
}

/**
 * The full dex-backed `LevelingContext` (see `@pokuelike/engine`'s
 * leveling.ts): growth-rate/baseExp/levelMoves/evolutions straight from the
 * imported species dex, move resolution preferring the curated roster and
 * falling back to a dex-derived default `MoveSpec` (or `undefined` for
 * status moves). Passed as `tickWorld`'s optional last argument, same
 * injection pattern as `HUNT_RULES`.
 */
export const LEVELING_CONTEXT: LevelingContext = {
  getProfile: profileFromDexEntry,
  resolveMove,
  baseSpeciesOf,
};
