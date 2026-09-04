import { tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, SCENARIO_SEED } from "@pokuelike/data";
import { drawWorld, TILE_SIZE } from "./renderer.js";

const TICK_MS = 400;

/**
 * `?seed=<number>` overrides the demo's default fixed seed
 * (`SCENARIO_SEED`) — lets a specific run be reloaded/shared by URL. This is
 * the one bit of seed-threading Part 2 (a real live browser viewer, a
 * separate follow-up) will build on directly, per that task's ask to "get
 * its rng handling right now rather than leaving it inconsistent" — this
 * app doesn't otherwise need anything more than what it already gets for
 * free: `tickWorld`'s `rng` parameter defaults to `world.rng` (see
 * simulation.ts), so every random roll here is already threaded from
 * `world`'s own seeded generator, not raw `Math.random`, with no further
 * change needed in this file.
 */
const seedParam = new URLSearchParams(location.search).get("seed");
const seed = seedParam !== null && seedParam !== "" ? Number(seedParam) : SCENARIO_SEED;
console.log(`Seed: ${seed}`);

const world = createDemoWorld(seed);

const canvas = document.getElementById("scene") as HTMLCanvasElement;
canvas.width = world.width * TILE_SIZE;
canvas.height = world.height * TILE_SIZE;
const ctx = canvas.getContext("2d")!;

function render(): void {
  drawWorld(ctx, world);
  requestAnimationFrame(render);
}

setInterval(() => tickWorld(world, undefined, HUNT_RULES, LEVELING_CONTEXT), TICK_MS);
render();
