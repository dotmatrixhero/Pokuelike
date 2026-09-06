#!/usr/bin/env node
/**
 * Builds the Move Tree Atlas artifact's HTML from the checked-in template
 * (`move-tree-atlas.template.html`) plus a fresh export of every shipped
 * move tree — the standardized, repeatable process MOVES_DESIGN.md's
 * "Move Tree Atlas: how to keep it updated" section describes, so an
 * update to this tool builds on the existing one instead of starting from
 * scratch each time.
 *
 * Usage (from the repo root):
 *
 *   npx tsx packages/data/scripts/export-move-trees.ts > /tmp/trees.json
 *   node packages/data/scripts/build-move-tree-atlas.mjs /tmp/trees.json /tmp/tree_atlas.html
 *
 * Then publish /tmp/tree_atlas.html with the Artifact tool, passing the
 * existing artifact's `url` so it updates in place rather than creating a
 * new one — see MOVES_DESIGN.md for that URL.
 *
 * The export step is intentionally a separate `tsx` invocation rather than
 * something this plain-`node` script imports directly: `export-move-trees.ts`
 * pulls in `moves.ts`'s real TypeScript (through the engine package too),
 * which plain `node` can't run without a build step — `tsx` is this repo's
 * existing convention for running a TS file straight (see how the session
 * that built this tool used it). Keeping the two steps separate also means
 * this build script has zero dependencies of its own.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , dataPath, outPath] = process.argv;
if (!dataPath || !outPath) {
  console.error("Usage: node build-move-tree-atlas.mjs <trees.json> <output.html>");
  process.exit(1);
}

const templatePath = new URL("./move-tree-atlas.template.html", import.meta.url);
const template = readFileSync(templatePath, "utf-8");
const data = readFileSync(dataPath, "utf-8");

// Confirm it's real JSON before embedding it — a malformed export should
// fail loudly here, not silently ship a broken artifact.
JSON.parse(data);

const dataSafe = data.replace(/<\/script/g, "<\\/script");
const html = template.replace("__TREE_DATA__", () => dataSafe);

if (html === template) {
  console.error("build-move-tree-atlas: template's __TREE_DATA__ placeholder not found — check the template wasn't already filled in.");
  process.exit(1);
}

writeFileSync(outPath, html, "utf-8");
console.log(`Wrote ${outPath} (${html.length} bytes)`);
