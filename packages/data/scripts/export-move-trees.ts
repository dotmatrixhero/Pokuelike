/**
 * Exports every move that carries a respec `tree` (see moves.ts's own
 * `MoveTreeNode` doc comment) to a single JSON blob on stdout — the exact
 * data the Move Tree Atlas artifact embeds. Run via tsx (this repo's real
 * TS-script runner, see build-move-tree-atlas.mjs's own comment on why
 * plain node can't run this file directly):
 *
 *   npx tsx packages/data/scripts/export-move-trees.ts > /tmp/trees.json
 *
 * Or, more usually, let build-move-tree-atlas.mjs call this for you — see
 * that script's own doc comment, and MOVES_DESIGN.md's "Move Tree Atlas:
 * how to keep it updated" section for the full, standardized process.
 */
import { MOVES } from "../src/moves.js";

const out: Record<string, unknown> = {};
for (const [id, move] of Object.entries(MOVES)) {
  if (!move.tree) continue;
  out[id] = {
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    power: move.power,
    accuracy: move.accuracy,
    cooldownTicks: move.cooldownTicks,
    shape: move.shape,
    range: move.range,
    hitsArea: move.hitsArea ?? false,
    tree: move.tree,
  };
}

console.log(JSON.stringify(out));
