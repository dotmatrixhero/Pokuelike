import {
  calculateStats,
  createNeeds,
  randomNature,
  dispositionFromNature,
  type Agent,
  type Vec2,
} from "@pokuelike/engine";
import { SPECIES } from "./species.js";
import { MOVES } from "./moves.js";
import { SPECIES_DEX_BY_KEY } from "./dex/index.js";

/**
 * The real level a species learns `moveId` at, per the imported dex's own
 * `levelMoves` — e.g. Sandshrew's Earthquake is 46, not immediately known.
 * Direct report: "why does a lv 10 sandshrew know earthquake." Species.ts's
 * hand-curated `SpeciesDef.moves` is just "these are its moves," with no
 * level annotation of its own — this cross-references the dex's real,
 * already-level-gated learnset (the same one `leveling.ts`'s `grantExp`/
 * `ensureCombatProfile` use) to find the real threshold. A move with no
 * entry in the dex's learnset (a curated move this sim added that isn't a
 * real level-up move for this species at all) reads as level 1 — nothing to
 * gate against, so it stays available from spawn, same as before this fix.
 * A move learned at more than one level (shouldn't happen in a real
 * learnset, but defensive) uses the lowest.
 */
function moveUnlockLevel(speciesId: string, moveId: string): number {
  const entry = SPECIES_DEX_BY_KEY[speciesId.toUpperCase()];
  if (!entry) return 1;
  const moveKey = moveId.toUpperCase();
  let min: number | undefined;
  for (const [unlockLevel, key] of entry.levelMoves) {
    if (key === moveKey) min = min === undefined ? unlockLevel : Math.min(min, unlockLevel);
  }
  return min ?? 1;
}

/**
 * Builds a default agent for a species at a given level: real computed
 * stats (calculateStats(baseStats, level, nature)), its actual typed
 * moveset, full HP, fresh needs, idle behavior, home layer from species
 * data. A random Nature is drawn per spawn (never inherited) and seeds this
 * agent's Disposition too — see DESIGN.md's "Individual variance" section.
 * Callers override whatever else they need (herdId, sex, needs, non-default
 * layer).
 *
 * Moves are gated by `moveUnlockLevel` against the spawn level — a fresh
 * spawn only starts knowing what a real specimen at that level would
 * plausibly know; a higher-tier move still in `species.moves` is picked up
 * naturally later via `leveling.ts`'s `grantExp` once the agent's real level
 * crosses that move's own threshold, the same path an agent that leveled up
 * from scratch already uses. Falls back to the single lowest-threshold move
 * in the list if every one of them would otherwise be gated out (so a very
 * low spawn level never leaves an agent with zero moves at all).
 */
export function spawnAgent(speciesId: string, id: string, pos: Vec2, level = 5, rng: () => number = Math.random): Agent {
  const species = SPECIES[speciesId];
  if (!species) throw new Error(`Unknown species: ${speciesId}`);

  const nature = randomNature(rng);
  const disposition = dispositionFromNature(nature, rng);
  const stats = calculateStats(species.baseStats, level, nature);

  let eligibleMoveIds = species.moves.filter((moveId) => moveUnlockLevel(speciesId, moveId) <= level);
  if (eligibleMoveIds.length === 0) {
    const earliest = species.moves.reduce((best, moveId) =>
      moveUnlockLevel(speciesId, moveId) < moveUnlockLevel(speciesId, best) ? moveId : best
    );
    eligibleMoveIds = [earliest];
  }

  const moves = eligibleMoveIds.map((moveId) => {
    const move = MOVES[moveId];
    if (!move) throw new Error(`Species ${speciesId} references unknown move: ${moveId}`);
    return move;
  });

  return {
    id,
    species: speciesId,
    pos,
    layer: species.homeLayer,
    homeLayer: species.homeLayer,
    // Spawn position doubles as this agent's "home" anchor for carryAlly's
    // rescue destination (support.ts) — see DESIGN.md's carry-capacity/home-
    // range scope call.
    homePos: { ...pos },
    // Notables: The Wanderer's anchor, set once and never mutated again
    // (unlike `homePos`) — a founder/immigrant's real birth position is
    // wherever it entered the sim. See Agent.birthPos's doc comment.
    birthPos: { ...pos },
    needs: createNeeds(),
    behavior: "idle",
    level,
    exp: 0,
    // Stored uppercase to match the dex move-key convention leveling.ts's
    // level-move lookups use ("vine_whip" -> "VINE_WHIP") — every curated
    // MOVES id happens to be the lowercased form of its dex key, so this is
    // a safe, cheap normalization rather than a real key lookup.
    knownMoves: eligibleMoveIds.map((moveId) => moveId.toUpperCase()),
    types: species.types,
    moves,
    stats,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    nature,
    disposition,
    activityPattern: species.activityPattern,
    buildsShelter: species.buildsShelter,
    preferredTerrain: species.preferredTerrain,
    isPredator: species.isPredator,
    obligateAquatic: species.obligateAquatic,
  };
}
