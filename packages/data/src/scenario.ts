import { createWorld, setTile, setElevation, createNeeds, type Agent, type World } from "@pokuelike/engine";

export const SCENARIO_WIDTH = 20;
export const SCENARIO_HEIGHT = 14;

/**
 * The one demo world both the browser app and the headless runner show: a
 * Bulbasaur herd near a water hole, a Scyther, a Diglett (home:
 * underground) and a Pidgey (home: canopy) that both routinely cross to
 * the surface for food/water.
 */
export function createDemoWorld(): World {
  const world = createWorld(SCENARIO_WIDTH, SCENARIO_HEIGHT);
  setTile(world, "surface", 2, 2, "water");
  setTile(world, "surface", 3, 2, "water");
  setTile(world, "surface", SCENARIO_WIDTH - 3, SCENARIO_HEIGHT - 3, "food");
  setTile(world, "surface", SCENARIO_WIDTH - 4, 2, "sunbeam");
  for (let x = 6; x <= 10; x++) setElevation(world, "surface", x, 7, 2);

  const herd: Agent[] = Array.from({ length: 4 }, (_, i) => ({
    id: `bulbasaur-${i}`,
    species: "bulbasaur",
    pos: { x: 5 + i, y: 6 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ thirst: 0.4 + i * 0.1 }),
    behavior: "idle",
    herdId: "bulbasaur-herd",
  }));

  const hunter: Agent = {
    id: "scyther-0",
    species: "scyther",
    pos: { x: SCENARIO_WIDTH - 2, y: 1 },
    layer: "surface",
    homeLayer: "surface",
    needs: createNeeds({ hunger: 0.3 }),
    behavior: "idle",
  };

  const diglett: Agent = {
    id: "diglett-0",
    species: "diglett",
    pos: { x: SCENARIO_WIDTH - 3, y: SCENARIO_HEIGHT - 3 },
    layer: "underground",
    homeLayer: "underground",
    needs: createNeeds({ hunger: 0.2 }),
    behavior: "idle",
  };

  const pidgey: Agent = {
    id: "pidgey-0",
    species: "pidgey",
    pos: { x: 2, y: 2 },
    layer: "canopy",
    homeLayer: "canopy",
    needs: createNeeds({ thirst: 0.2 }),
    behavior: "idle",
  };

  world.agents.push(...herd, hunter, diglett, pidgey);
  return world;
}
