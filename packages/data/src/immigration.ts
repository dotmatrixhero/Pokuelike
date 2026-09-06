import type { ImmigrationContext } from "@pokuelike/engine";
import { SPECIES } from "./species.js";
import { spawnAgent } from "./spawn.js";
import { naturalMinLevelFor, isSingleStageSpecies } from "./leveling.js";

/**
 * Wires `@pokuelike/engine`'s `immigration.ts` up to this package's actual
 * roster — the same dependency-injection shape `HUNT_RULES`
 * (predation.ts) and `LEVELING_CONTEXT` (leveling.ts) already use to hand
 * the engine's generic mechanisms real species data without the engine
 * depending on this package. `spawnAgent` is passed directly (not wrapped)
 * since its signature already matches what `ImmigrationContext.spawnAgent`
 * expects.
 */
export const IMMIGRATION_CONTEXT: ImmigrationContext = {
  speciesRoster: Object.values(SPECIES).map((species) => ({
    id: species.id,
    homeLayer: species.homeLayer,
    biomes: species.biomes,
    obligateAquatic: species.obligateAquatic,
    // Real evolution-stage-aware floor — direct ask: "everything spawn[s]
    // at lv5. Especially evolved Pokémon they should be higher
    // distributed." See `naturalMinLevelFor`'s own doc comment.
    minLevel: naturalMinLevelFor(species.id),
    // Direct ask: "make all Pokémon with just base form have a wider range
    // of base level." See `isSingleStageSpecies`'s own doc comment.
    singleStage: isSingleStageSpecies(species.id),
  })),
  spawnAgent,
};
