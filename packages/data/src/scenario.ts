import {
  createWorld,
  setTile,
  setElevation,
  createNeeds,
  type TerrainKind,
  type World,
} from "@pokuelike/engine";
import { spawnAgent } from "./spawn.js";

export const SCENARIO_WIDTH = 24;
export const SCENARIO_HEIGHT = 16;

function fillRect(
  world: World,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  terrain: TerrainKind
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) setTile(world, "surface", x, y, terrain);
  }
}

/**
 * The one demo world both the browser app and the headless runner show: a
 * Bulbasaur herd near a water hole, a Scyther hunting from its own separate
 * territory, a Diglett (home: underground) and a Pidgey (home: canopy) that
 * both routinely cross to the surface for food/water. Every agent gets real
 * stats/types/moves via spawnAgent — see DESIGN.md's combat section.
 *
 * The map used to be almost entirely open floor with exactly one food tile
 * and one water tile — every hungry or thirsty agent in the whole
 * population funneled onto the same couple of tiles, which (combined with
 * a since-fixed bug where offspring spawned directly on their mother) is
 * why a real run ended with 168 of 264 agents stacked on a single tile.
 * Multiple separated resource clusters plus real obstacles fix the
 * "everyone converges on one point" failure mode at the source instead of
 * just papering over it in the renderer.
 */
export function createDemoWorld(): World {
  const world = createWorld(SCENARIO_WIDTH, SCENARIO_HEIGHT);

  // Northwest pond (the herd's water) and a second pool up in the
  // Scyther's northeast hunting ground, so thirst doesn't force the whole
  // map to one corner.
  fillRect(world, 1, 1, 3, 2, "water");
  fillRect(world, SCENARIO_WIDTH - 4, 2, SCENARIO_WIDTH - 3, 3, "water");

  // ~20 starting food tiles instead of 3 — food now dies off and gets
  // eaten out fast (see flora.ts), so the population needs a real starting
  // buffer while natural seeding/spreading catches up. Clustered around
  // the same three territories as before (herd/southwest/Scyther), plus
  // scattered singles so no single area is a single point of failure.
  const FOOD_FLAVOR_CYCLE = ["oran", "pecha", "cheri", "sitrus"] as const;
  const STARTING_FOOD_TILES: Array<[number, number]> = [
    // herd's usual patch, southeast (near (20,13), avoiding Diglett's spawn at (21,13))
    [19, 12], [20, 12], [19, 13], [20, 13],
    // southwest
    [4, 12], [5, 12], [4, 13], [5, 13],
    // Scyther's territory, northeast
    [21, 4], [22, 4], [21, 5], [22, 5],
    // scattered singles, spread across the rest of the map
    [10, 3], [14, 3], [16, 9], [19, 9], [10, 13], [16, 12], [3, 9], [7, 4],
  ];
  STARTING_FOOD_TILES.forEach(([x, y], i) => {
    setTile(world, "surface", x, y, "food", undefined, FOOD_FLAVOR_CYCLE[i % FOOD_FLAVOR_CYCLE.length]);
  });

  setTile(world, "surface", SCENARIO_WIDTH - 5, 2, "sunbeam");

  // A low ridge with a small peak running through the middle of the map —
  // elevation the Venusaur guardians hold as high ground.
  for (let x = 6; x <= 14; x++) setElevation(world, "surface", x, 7, 2);
  for (let x = 9; x <= 11; x++) setElevation(world, "surface", x, 6, 3);

  // Real obstacles: a rocky outcrop, a wall corner, a scattered boulder
  // pair, and a broken wall line with a gap to duck through — breaking up
  // the open floor and giving the tactical combat something to route
  // around instead of every fight happening on a featureless plain.
  fillRect(world, 13, 9, 14, 10, "wall");
  setTile(world, "surface", 17, 4, "wall");
  setTile(world, "surface", 18, 4, "wall");
  setTile(world, "surface", 17, 5, "wall");
  setTile(world, "surface", 7, 12, "wall");
  setTile(world, "surface", 8, 12, "wall");
  setTile(world, "surface", 10, 11, "wall");
  setTile(world, "surface", 11, 11, "wall");
  // gap at (12, 11) — a chokepoint, not a wall
  setTile(world, "surface", 13, 11, "wall");

  // Two mated pairs, so reproduction has someone to pair with from the start.
  // No `age` set — undefined is treated as already mature (see reproduction.ts).
  const herd = Array.from({ length: 4 }, (_, i) => ({
    ...spawnAgent("bulbasaur", `bulbasaur-${i}`, { x: 5 + i, y: 6 }, 5),
    needs: createNeeds({ thirst: 0.4 + i * 0.1 }),
    herdId: "bulbasaur-herd",
    sex: (i % 2 === 0 ? "male" : "female") as "male" | "female",
  }));

  // Two Venusaur guard the herd — much higher level, so genuinely dangerous to
  // Scyther despite Grass being quadruply resisted by its Bug/Flying typing
  // (Vine Whip barely tickles it; Tackle, with no type penalty, is the smarter
  // pick there — pickBestMove actually gets this right on its own).
  const guardians = [
    {
      ...spawnAgent("venusaur", "venusaur-0", { x: 4, y: 7 }, 20),
      herdId: "bulbasaur-herd",
      sex: "male" as const,
    },
    {
      ...spawnAgent("venusaur", "venusaur-1", { x: 9, y: 7 }, 20),
      herdId: "bulbasaur-herd",
      sex: "female" as const,
    },
  ];

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

  world.agents.push(...herd, ...guardians, hunter, diglett, pidgey);
  return world;
}
