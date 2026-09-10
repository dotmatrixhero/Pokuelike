import type { Agent, Layer, Vec2, World } from "./types.js";
import { computeVisible, hasLineOfSight } from "./fov.js";
import { lightLevel } from "./daynight.js";
import { stormFovPenalty } from "./weather.js";
import { tileAt } from "./world.js";
import { holdsLight } from "./player.js";

/**
 * What the player can see — ROADMAP.md's M2.
 *
 * fov.ts's `computeVisible` already knows about walls, ridges, concealment
 * and darkness; it was tested and called by nobody. This module is the
 * caller. Three decisions live here, none in fov.ts:
 *
 *  1. How dark it is where the player stands (`ambientLightAt`). On the
 *     surface that is daynight.ts's clock. Underground there is no day: the
 *     only light is a sunbeam tile, and standing on or beside one is full
 *     light. (M5's torch will be the next light source; it slots in here.)
 *  2. Lit tiles are visible from far away in the dark. You cannot see the
 *     corridor four tiles ahead, but you can see the glow of the chamber
 *     down the tunnel the moment nothing is between you and it. That is
 *     the whole M1 fantasy — "spawn in the dark and walk to the light" —
 *     and it is what makes the light a destination rather than a surprise.
 *  3. Memory. Tiles once seen stay drawn, dimmed, per layer.
 */

/**
 * The player's sight radius in full light. Sim-original: a little wider
 * than the 3–5 the behaviour tree gives sim agents, because a screen is a
 * wider window than an instinct. In full darkness `NIGHT_FOV_PENALTY` (2.5)
 * comes off it — about four tiles, the "sight radius ~4 without light"
 * ROADMAP.md asks for.
 */
export const PLAYER_SIGHT_RADIUS = 7;

/** How far off a lit tile can be seen in the dark, given a clear line of sight. */
export const LIT_TILE_SIGHT_RADIUS = 14;

export function tileIndex(world: World, x: number, y: number): number {
  return y * world.width + x;
}

/** A tile is lit if it, or any of its eight neighbours, is a sunbeam. */
export function isLitTile(world: World, layer: Layer, pos: Vec2): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (tileAt(world, layer, pos.x + dx, pos.y + dy)?.terrain === "sunbeam") return true;
    }
  }
  return false;
}

/**
 * 0..1 light where an observer stands, in `computeVisible`'s `lightLevel`
 * units. Surface: the day/night clock. Underground: 1 on a lit tile, else 0.
 */
export function ambientLightAt(world: World, layer: Layer, pos: Vec2, tick: number, observer?: Agent): number {
  // ROADMAP.md M5: a held torch lights *you*, anywhere. This one line is
  // "the world doubles in size" — the full radius comes back in the dark.
  if (observer && holdsLight(world, observer)) return 1;
  if (layer === "surface") return lightLevel(tick);
  return isLitTile(world, layer, pos) ? 1 : 0;
}

/**
 * Every tile the player can see this turn: the ordinary FOV at the local
 * light level, plus — underground only, where lit tiles are the only light
 * there is — any lit tile within `LIT_TILE_SIGHT_RADIUS` with a clear line
 * of sight, however dark it is where the player stands.
 */
export function playerVisibleTiles(world: World, agent: Agent): Vec2[] {
  const { layer, pos } = agent;
  const light = ambientLightAt(world, layer, pos, world.tick, agent);
  const storm = stormFovPenalty(world, layer, pos);
  const visible = computeVisible(world, layer, pos, PLAYER_SIGHT_RADIUS, light, storm);
  if (layer === "surface") return visible;

  const seen = new Set(visible.map((p) => tileIndex(world, p.x, p.y)));
  const observerElevation = tileAt(world, layer, pos.x, pos.y)?.elevation ?? 0;
  const r = LIT_TILE_SIGHT_RADIUS;
  for (let y = Math.max(0, pos.y - r); y <= Math.min(world.height - 1, pos.y + r); y++) {
    for (let x = Math.max(0, pos.x - r); x <= Math.min(world.width - 1, pos.x + r); x++) {
      const idx = tileIndex(world, x, y);
      if (seen.has(idx)) continue;
      if (Math.hypot(x - pos.x, y - pos.y) > r) continue;
      if (!isLitTile(world, layer, { x, y })) continue;
      if (!hasLineOfSight(world, layer, pos, { x, y }, observerElevation)) continue;
      seen.add(idx);
      visible.push({ x, y });
    }
  }
  return visible;
}

/**
 * Recomputes `agent.vision.visible` and folds it into the per-layer
 * `explored` memory. Called at the end of every player turn (simulation.ts's
 * `advancePlayerTurn`) and once when a scenario places the player, so the
 * first frame is already honest.
 */
export function updatePlayerVision(world: World, agent: Agent): void {
  const vision = agent.vision ?? { visible: new Set<number>(), explored: {} };
  vision.visible = new Set(playerVisibleTiles(world, agent).map((p) => tileIndex(world, p.x, p.y)));
  const explored = (vision.explored[agent.layer] ??= new Set<number>());
  for (const idx of vision.visible) explored.add(idx);
  agent.vision = vision;
}

/** Whether the player (if any, with vision computed) can currently see tile `(x, y)` on `layer`. Everything is visible in a world with no player. */
export function canPlayerSee(world: World, layer: Layer, x: number, y: number): boolean {
  const player = world.agents.find((a) => a.controlledBy === "player");
  if (!player?.vision) return true;
  if (player.layer !== layer) return false;
  return player.vision.visible.has(tileIndex(world, x, y));
}
