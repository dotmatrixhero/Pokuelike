import { createWorld, setTile, setElevation, tickAgent, createNeeds, type Agent } from "@pokuelike/engine";
import { drawWorld, TILE_SIZE } from "./renderer.js";

const WIDTH = 20;
const HEIGHT = 14;
const TICK_MS = 400;

const world = createWorld(WIDTH, HEIGHT);
setTile(world, "surface", 2, 2, "water");
setTile(world, "surface", 3, 2, "water");
setTile(world, "surface", WIDTH - 3, HEIGHT - 3, "food");
setTile(world, "surface", WIDTH - 4, 2, "sunbeam");

// A low ridge across the middle of the map, for FOV/elevation to matter later.
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
  pos: { x: WIDTH - 2, y: 1 },
  layer: "surface",
  homeLayer: "surface",
  needs: createNeeds({ hunger: 0.3 }),
  behavior: "idle",
};

// Diglett lives underground but its food is on the surface, so it surfaces
// routinely — same x,y, different layer, so it appears/disappears in the
// surface view as it comes and goes.
const diglett: Agent = {
  id: "diglett-0",
  species: "diglett",
  pos: { x: WIDTH - 3, y: HEIGHT - 3 },
  layer: "underground",
  homeLayer: "underground",
  needs: createNeeds({ hunger: 0.2 }),
  behavior: "idle",
};

// Pidgey lives in the canopy but drinks from the surface water hole.
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

const canvas = document.getElementById("scene") as HTMLCanvasElement;
canvas.width = WIDTH * TILE_SIZE;
canvas.height = HEIGHT * TILE_SIZE;
const ctx = canvas.getContext("2d")!;

function tick(): void {
  world.tick += 1;
  for (const agent of world.agents) tickAgent(world, agent);
}

function render(): void {
  drawWorld(ctx, world);
  requestAnimationFrame(render);
}

setInterval(tick, TICK_MS);
render();
