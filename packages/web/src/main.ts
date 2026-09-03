import { createWorld, setTile, tickAgent, createNeeds, type Agent } from "@pokuelike/engine";
import { drawWorld, TILE_SIZE } from "./renderer.js";

const WIDTH = 20;
const HEIGHT = 14;
const TICK_MS = 400;

const world = createWorld(WIDTH, HEIGHT);
setTile(world, 2, 2, "water");
setTile(world, 3, 2, "water");
setTile(world, WIDTH - 3, HEIGHT - 3, "food");
setTile(world, WIDTH - 4, 2, "sunbeam");

const herd: Agent[] = Array.from({ length: 4 }, (_, i) => ({
  id: `bulbasaur-${i}`,
  species: "bulbasaur",
  pos: { x: 5 + i, y: 6 },
  needs: createNeeds({ thirst: 0.4 + i * 0.1 }),
  behavior: "idle",
  herdId: "bulbasaur-herd",
}));

const hunter: Agent = {
  id: "scyther-0",
  species: "scyther",
  pos: { x: WIDTH - 2, y: 1 },
  needs: createNeeds({ hunger: 0.3 }),
  behavior: "idle",
};

world.agents.push(...herd, hunter);

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
