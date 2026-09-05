import type { ImmigrationContext } from "@pokuelike/engine";
import { SPECIES } from "./species.js";
import { spawnAgent } from "./spawn.js";

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
  })),
  spawnAgent,
};
