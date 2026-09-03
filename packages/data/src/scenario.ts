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

  // Three separated food patches instead of one.
  setTile(world, "surface", SCENARIO_WIDTH - 4, SCENARIO_HEIGHT - 3, "food"); // herd's usual patch, southeast
  setTile(world, "surface", 4, SCENARIO_HEIGHT - 3, "food"); // southwest
  setTile(world, "surface", SCENARIO_WIDTH - 3, 4, "food"); // Scyther's territory, northeast

  setTile(world, "surface", SCENARIO_WIDTH - 5, 2, "sunbeam");

  // A low ridge with a small peak running through the middle of the map —
  // elevation the Venusaur guardians hold as high ground.
  for (let x = 6; x <= 14; x++) setElevation(world, "surface", x, 7, 2);
  for (let x = 9; x <= 11; x++) setElevation(world, "surface", x, 6, 3);

  // Real obstacles: a rocky outcrop plus a small wall corner, breaking up
  // the open floor and giving the tactical combat something to route
  // around instead of every fight happening on a featureless plain.
  fillRect(world, 13, 9, 14, 10, "wall");
  setTile(world, "surface", 17, 4, "wall");
  setTile(world, "surface", 18, 4, "wall");
  setTile(world, "surface", 17, 5, "wall");

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
