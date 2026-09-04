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

/**
 * Builds a default agent for a species at a given level: real computed
 * stats (calculateStats(baseStats, level, nature)), its actual typed
 * moveset, full HP, fresh needs, idle behavior, home layer from species
 * data. A random Nature is drawn per spawn (never inherited) and seeds this
 * agent's Disposition too — see DESIGN.md's "Individual variance" section.
 * Callers override whatever else they need (herdId, sex, needs, non-default
 * layer).
 */
export function spawnAgent(speciesId: string, id: string, pos: Vec2, level = 5): Agent {
  const species = SPECIES[speciesId];
  if (!species) throw new Error(`Unknown species: ${speciesId}`);

  const nature = randomNature();
  const disposition = dispositionFromNature(nature);
  const stats = calculateStats(species.baseStats, level, nature);
  const moves = species.moves.map((moveId) => {
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
    needs: createNeeds(),
    behavior: "idle",
    level,
    exp: 0,
    // Stored uppercase to match the dex move-key convention leveling.ts's
    // level-move lookups use ("vine_whip" -> "VINE_WHIP") — every curated
    // MOVES id happens to be the lowercased form of its dex key, so this is
    // a safe, cheap normalization rather than a real key lookup.
    knownMoves: species.moves.map((moveId) => moveId.toUpperCase()),
    types: species.types,
    moves,
    stats,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    nature,
    disposition,
    activityPattern: species.activityPattern,
  };
}
