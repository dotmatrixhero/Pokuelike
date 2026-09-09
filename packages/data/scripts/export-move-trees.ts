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
import { PROPOSED_TREES } from "./proposed-trees.js";

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
    pp: move.pp,
    shape: move.shape,
    range: move.range,
    hitsArea: move.hitsArea ?? false,
    tree: move.tree,
  };
}

// Proposed (unbuilt) trees are merged in alongside the shipped ones, each
// flagged `proposed: true` so the atlas can badge them, filter them, and
// keep them visually distinct. They live in proposed-trees.ts and are NOT
// part of `MOVES` — the game never reads them. See MOVES_DESIGN.md's
// "proposed mode" note and that file's own doc comment.
for (const [id, move] of Object.entries(PROPOSED_TREES)) {
  if (out[id]) {
    console.error(`export-move-trees: "${id}" is both shipped and proposed — the shipped tree wins; drop it from proposed-trees.ts.`);
    continue;
  }
  out[id] = {
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    power: move.power,
    accuracy: move.accuracy,
    cooldownTicks: move.cooldownTicks,
    pp: move.pp,
    shape: move.shape,
    range: move.range,
    hitsArea: move.hitsArea ?? false,
    proposed: true,
    fantasy: move.fantasy,
    learners: move.learners,
    tree: move.tree,
  };
}

console.log(JSON.stringify(out));
