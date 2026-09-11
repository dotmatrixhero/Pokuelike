import type { Agent, Layer, TerrainKind, Vec2, World } from "./types.js";
import { tileAt } from "./world.js";
import { harvestLeft, harvestableAt } from "./harvest.js";
import type { MaterialId } from "./harvest.js";

/**
 * Read-only questions about one tile: what is there, and what can this agent
 * do to it.
 *
 * Built for the tile menu (PLAY_UX_DESIGN.md slice 3) — long-press on mobile,
 * right-click on desktop — which inverts the game from verb-first ("press g to
 * gather") to noun-first ("touch the tile, it tells you what it offers").
 * Direct ask: "Long press a tile to open radial, then drag up to one radial
 * section examine it, seeing what items are harvestabls, what kind of terrain
 * and what effects standing on it does."
 *
 * Two deliberate choices:
 *
 * **Facts, not prose.** `examineTile` returns structured data rather than a
 * sentence. The house rule for generated text is that a vague word means the
 * data is missing — returning fields makes it impossible for the caller to
 * write *around* a hole instead of going and getting the value.
 *
 * **In the engine, not the web app.** "What may this agent legally do here" is
 * a rules question, and putting it here means it can be unit-tested without a
 * browser — which matters, because "does a corpse tile actually offer Butcher"
 * is exactly the sort of thing that rots silently.
 */

export interface TileReport {
  terrain: TerrainKind;
  walkable: boolean;
  opaque: boolean;
  elevation: number;
  /** What a `gather` here would yield. Empty on bare ground. */
  harvestable: MaterialId[];
  /** Takes left before the tile is picked clean. */
  harvestsLeft: number;
  /** Standing here hides you — bush and shelter. */
  conceals: boolean;
  /** Fouled ground: standing here poisons you (sludge.ts). */
  poisons: boolean;
  drinkable: boolean;
  /** A sunbeam: the lit tiles a cave run navigates by. */
  lit: boolean;
  /** A living agent standing here, if any. */
  occupantId?: string;
  /** A truly-dead body here — what `loot`/`butcher` need. */
  corpseId?: string;
  stairs?: "down" | "up" | "exit";
}

const CONCEALING: ReadonlySet<TerrainKind> = new Set<TerrainKind>(["bush", "shelter"]);

export function examineTile(world: World, layer: Layer, pos: Vec2): TileReport | undefined {
  const tile = tileAt(world, layer, pos.x, pos.y);
  if (!tile) return undefined;

  // One pass over agents rather than two: the living occupant and a corpse can
  // both be on the same tile, and callers want each named separately.
  let occupantId: string | undefined;
  let corpseId: string | undefined;
  for (const agent of world.agents) {
    if (agent.layer !== layer || agent.pos.x !== pos.x || agent.pos.y !== pos.y) continue;
    if (agent.alive === false) corpseId ??= agent.id;
    else occupantId ??= agent.id;
  }

  return {
    terrain: tile.terrain,
    walkable: tile.walkable !== false,
    opaque: tile.opaque === true,
    elevation: tile.elevation ?? 0,
    harvestable: harvestableAt(world, layer, pos),
    harvestsLeft: harvestLeft(world, layer, pos),
    conceals: tile.concealment === true || CONCEALING.has(tile.terrain),
    poisons: tile.terrain === "sludge",
    drinkable: tile.terrain === "water",
    lit: tile.terrain === "sunbeam",
    occupantId,
    corpseId,
    stairs: tile.terrain === "stairsDown" ? "down" : tile.terrain === "stairsUp" ? "up" : tile.terrain === "exit" ? "exit" : undefined,
  };
}

/**
 * The verbs a tile menu should offer for this tile. Ordered most-expected
 * first, which is also the order the wedges are laid out in.
 *
 * `examine` is always present and always free — it costs no turn, which is
 * what makes looking before you commit a real option rather than a tax.
 */
export type TileVerb = "examine" | "moveHere" | "gather" | "drink" | "attack" | "command" | "loot" | "butcher" | "useStairs";

/** Chebyshev distance — this game's adjacency, diagonals included. */
function reach(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function verbsForTile(world: World, agent: Agent, layer: Layer, pos: Vec2): TileVerb[] {
  const report = examineTile(world, layer, pos);
  if (!report) return [];

  const here = agent.layer === layer && reach(agent.pos, pos) === 0;
  const adjacent = agent.layer === layer && reach(agent.pos, pos) <= 1;
  const verbs: TileVerb[] = ["examine"];

  // Walking to your own tile is not a move, and an unwalkable tile is not a
  // destination.
  if (!here && report.walkable) verbs.push("moveHere");
  // gather and useStairs both act on the tile you are STANDING on (see
  // player.ts) — offering them for a tile across the room would be a button
  // that silently does nothing.
  if (here && report.harvestable.length > 0 && report.harvestsLeft > 0) verbs.push("gather");
  if (adjacent && report.drinkable) verbs.push("drink");
  // A living occupant who is not you is a target. A merely adjacent tile is
  // also swingable — terrain-effect moves (axe on a tree) target ground.
  if ((report.occupantId && report.occupantId !== agent.id) || (adjacent && !here)) verbs.push("attack");
  if (world.agents.some((a) => a.followingId === agent.id && a.alive !== false && a.layer === agent.layer)) verbs.push("command");
  if (report.corpseId && adjacent) verbs.push("loot", "butcher");
  if (here && report.stairs) verbs.push("useStairs");

  return verbs;
}

/**
 * What this agent can do from where it is standing, independent of any tile it
 * might be pointing at.
 *
 * Direct ask: "THINGS you can do from your current position should be on one
 * section of radial... That way I don't have to precisely target the tile I'm
 * on to drink water when I'm standing on it."
 *
 * Not expressible as `verbsForTile(agent.pos)`: `drink` there asks whether the
 * PASSED tile is water, so querying your own tile never reports it — you are
 * standing beside the pond, not in it. Same for a corpse one step away. This
 * asks the question the other way round: given where I am, what is in reach?
 */
export function selfVerbsFor(world: World, agent: Agent, layer: Layer): TileVerb[] {
  const here = examineTile(world, layer, agent.pos);
  if (!here) return [];
  const verbs: TileVerb[] = [];
  if (here.harvestable.length > 0 && here.harvestsLeft > 0) verbs.push("gather");

  // Anything within one step, diagonals included.
  let waterNear = false;
  let corpseNear = false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const near = examineTile(world, layer, { x: agent.pos.x + dx, y: agent.pos.y + dy });
      if (!near) continue;
      if (near.drinkable) waterNear = true;
      if (near.corpseId) corpseNear = true;
    }
  }
  if (waterNear) verbs.push("drink");
  if (corpseNear) verbs.push("loot", "butcher");
  if (here.stairs) verbs.push("useStairs");
  return verbs;
}
