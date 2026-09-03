import { calculateStats, createNeeds, type Agent, type Vec2 } from "@pokuelike/engine";
import { SPECIES } from "./species.js";
import { MOVES } from "./moves.js";

/**
 * Builds a default agent for a species at a given level: real computed
 * stats (calculateStats(baseStats, level)), its actual typed moveset, full
 * HP, fresh needs, idle behavior, home layer from species data. Callers
 * override whatever else they need (herdId, sex, needs, non-default layer).
 */
export function spawnAgent(speciesId: string, id: string, pos: Vec2, level = 5): Agent {
  const species = SPECIES[speciesId];
  if (!species) throw new Error(`Unknown species: ${speciesId}`);

  const stats = calculateStats(species.baseStats, level);
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
    needs: createNeeds(),
    behavior: "idle",
    level,
    types: species.types,
    moves,
    stats,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
  };
}
