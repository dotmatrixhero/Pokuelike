import { createWorld, setTile, setElevation, createNeeds, type World } from "@pokuelike/engine";
import { spawnAgent } from "./spawn.js";

export const SCENARIO_WIDTH = 20;
export const SCENARIO_HEIGHT = 14;

/**
 * The one demo world both the browser app and the headless runner show: a
 * Bulbasaur herd near a water hole, a Scyther, a Diglett (home:
 * underground) and a Pidgey (home: canopy) that both routinely cross to
 * the surface for food/water. Every agent gets real stats/types/moves via
 * spawnAgent — see DESIGN.md's combat section.
 */
export function createDemoWorld(): World {
  const world = createWorld(SCENARIO_WIDTH, SCENARIO_HEIGHT);
  setTile(world, "surface", 2, 2, "water");
  setTile(world, "surface", 3, 2, "water");
  setTile(world, "surface", SCENARIO_WIDTH - 3, SCENARIO_HEIGHT - 3, "food");
  setTile(world, "surface", SCENARIO_WIDTH - 4, 2, "sunbeam");
  for (let x = 6; x <= 10; x++) setElevation(world, "surface", x, 7, 2);

  // Two mated pairs, so reproduction has someone to pair with from the start.
  // No `age` set — undefined is treated as already mature (see reproduction.ts).
  const herd = Array.from({ length: 4 }, (_, i) => ({
    ...spawnAgent("bulbasaur", `bulbasaur-${i}`, { x: 5 + i, y: 6 }, 5),
    needs: createNeeds({ thirst: 0.4 + i * 0.1 }),
    herdId: "bulbasaur-herd",
    sex: (i % 2 === 0 ? "male" : "female") as "male" | "female",
  }));

  const hunter = {
    ...spawnAgent("scyther", "scyther-0", { x: SCENARIO_WIDTH - 2, y: 1 }, 8),
    needs: createNeeds({ hunger: 0.3 }),
    sex: "female" as const,
  };

  const diglett = {
    ...spawnAgent("diglett", "diglett-0", { x: SCENARIO_WIDTH - 3, y: SCENARIO_HEIGHT - 3 }, 5),
    needs: createNeeds({ hunger: 0.2 }),
    sex: "male" as const,
  };

  const pidgey = {
    ...spawnAgent("pidgey", "pidgey-0", { x: 2, y: 2 }, 5),
    needs: createNeeds({ thirst: 0.2 }),
    sex: "female" as const,
  };

  world.agents.push(...herd, hunter, diglett, pidgey);
  return world;
}
