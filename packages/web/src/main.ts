import { tickWorld } from "@pokuelike/engine";
import { createDemoWorld } from "@pokuelike/data";
import { drawWorld, TILE_SIZE } from "./renderer.js";

const TICK_MS = 400;

const world = createDemoWorld();

const canvas = document.getElementById("scene") as HTMLCanvasElement;
canvas.width = world.width * TILE_SIZE;
canvas.height = world.height * TILE_SIZE;
const ctx = canvas.getContext("2d")!;

function render(): void {
  drawWorld(ctx, world);
  requestAnimationFrame(render);
}

setInterval(() => tickWorld(world), TICK_MS);
render();
