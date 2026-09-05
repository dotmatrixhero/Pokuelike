/**
 * Dumps generateWorld's terrain-only grid (no sim ticks, no agents) as an
 * ANSI-colored map to the terminal, plus terrain-kind counts — the fastest
 * way to actually *look at* a generated map (land/ocean shape, rivers) as
 * opposed to trusting the algorithm on paper. See DESIGN.md's "Overworld
 * generation vision" / macro elevation + rivers section for what this
 * verified. Usage: `pnpm --filter @pokuelike/runner exec tsx src/dump-map.ts
 * <seed> <width> <height> [outPath]` — `outPath`, if given, also writes the
 * plain (no-color) glyph grid to a file for diffing/sharing.
 */
import { generateWorld } from "@pokuelike/engine";
import { captureTerrainGrid, frameToAnsi } from "./ascii.js";
import { writeFileSync } from "node:fs";

const seed = Number(process.argv[2] ?? 20260903);
const width = Number(process.argv[3] ?? 90);
const height = Number(process.argv[4] ?? 60);
const outPath = process.argv[5];

const world = generateWorld(width, height, seed);
const cells = captureTerrainGrid(world);
const frame = { tick: 0, width, height, cells };
const ansi = frameToAnsi(frame);

const plain = cells.map((row) => row.map((c) => c.char).join("")).join("\n");

const counts: Record<string, number> = {};
for (const t of world.tiles.surface) counts[t.terrain] = (counts[t.terrain] ?? 0) + 1;

console.log(`Seed ${seed}, ${width}x${height}`);
console.log("Terrain counts:", JSON.stringify(counts, null, 2));
const total = width * height;
console.log(`Ocean fraction: ${(((counts.water ?? 0) / total) * 100).toFixed(1)}%`);
console.log(ansi);

if (outPath) writeFileSync(outPath, plain);
