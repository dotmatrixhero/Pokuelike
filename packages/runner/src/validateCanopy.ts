/**
 * Real-run validation for canopy derivation from surface (CROPS_DESIGN.md) —
 * confirms a live `generateWorld` map actually produces real canopy
 * structure (tree-linked floor patches, massif ridges, and real unwalkable
 * gaps between them) rather than the old plain flat grid, and that the demo
 * scenario's canopy-native agents (Pidgey/Spearow) land on walkable tiles.
 * Usage: `pnpm --filter @pokuelike/runner exec tsx src/validateCanopy.ts`
 */
import { generateWorld } from "@pokuelike/engine";
import { createDemoWorld } from "@pokuelike/data";

const world = generateWorld(90, 60, 4242);

let floorCount = 0;
let wallCount = 0;
let otherCount = 0;
for (const tile of world.tiles.canopy) {
  if (tile.terrain === "floor") floorCount++;
  else if (tile.terrain === "wall") wallCount++;
  else otherCount++;
}

const demo = createDemoWorld();
const canopyAgentReport = demo.agents
  .filter((a) => a.layer === "canopy")
  .map((a) => ({
    id: a.id,
    pos: a.pos,
    walkable: demo.tiles.canopy[a.pos.y * demo.width + a.pos.x]?.walkable,
  }));

console.log(
  JSON.stringify(
    {
      canopyTileCount: world.tiles.canopy.length,
      floorCount,
      wallCount,
      otherCount,
      floorFraction: floorCount / world.tiles.canopy.length,
      canopyAgentsInDemoWorld: canopyAgentReport,
      allCanopyAgentsOnWalkableTiles: canopyAgentReport.every((a) => a.walkable === true),
    },
    null,
    2
  )
);
