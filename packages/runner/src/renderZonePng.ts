/**
 * Renders promoted zones straight to PNG, so terrain changes can be judged by
 * LOOKING rather than from percentages. No browser and no dependencies — the
 * runner had only ANSI dumps, and ANSI cannot show a river as a shape.
 *
 * Usage: npx tsx packages/runner/src/renderZonePng.ts <outDir> <label> [seeds]
 */
import { createMacroWorld, generateMacroGrid, tileAt } from "@pokuelike/engine";
import type { World } from "@pokuelike/engine";
import { IMMIGRATION_CONTEXT, SCENARIO_WIDTH, SCENARIO_HEIGHT } from "@pokuelike/data";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "/tmp/zones";
const LABEL = process.argv[3] ?? "after";
const SEEDS = (process.argv[4] ?? "11,33").split(",").map(Number);
const SCALE = 6;

const COLORS: Record<string, [number, number, number]> = {
  water: [58, 108, 173], floor: [138, 154, 106], wall: [92, 88, 84], tree: [46, 92, 54],
  bush: [78, 116, 66], flora: [110, 148, 88], sand: [204, 190, 140], mud: [122, 102, 78],
  boulder: [126, 120, 112], shelter: [156, 114, 74], food: [190, 168, 84], seedling: [128, 160, 96],
  sunbeam: [200, 206, 150], stone: [140, 134, 126], sludge: [104, 84, 132],
};

function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width: number, height: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) { const [r, g, b] = rgb(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function renderWorld(w: World, path: string) {
  const buf = png(w.width * SCALE, w.height * SCALE, (px, py) => {
    const t = tileAt(w, "surface", Math.floor(px / SCALE), Math.floor(py / SCALE));
    return (t && COLORS[t.terrain]) || [255, 0, 255];
  });
  writeFileSync(path, buf);
}

mkdirSync(OUT, { recursive: true });
for (const seed of SEEDS) {
  const grid = generateMacroGrid(seed, 64, 64);
  const land = grid.zones.filter((z) => !z.isOcean);
  // Pick river zones that are NOT highland — highland zones are ~78% wall for
  // an unrelated reason, and would confound a river comparison.
  const rivers = land.filter((z) => z.riverEdges.length > 0 && z.biome !== "highland" && z.biome !== "cave");
  for (const [i, z] of rivers.slice(0, 3).entries()) {
    const mw = createMacroWorld(grid, z.row, z.col, seed, SCENARIO_WIDTH, SCENARIO_HEIGHT, IMMIGRATION_CONTEXT);
    const w = mw.regions.get(mw.focusedKey)!.world!;
    let water = 0;
    for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) if (tileAt(w, "surface", x, y)!.terrain === "water") water++;
    const pct = Math.round((100 * water) / (w.width * w.height));
    const name = `${OUT}/seed${seed}_river${i}_${z.biome}_${LABEL}.png`;
    renderWorld(w, name);
    console.log(`${name}  zone @${z.row},${z.col} elev ${z.elevation.toFixed(2)} ${z.biome} water ${pct}%`);
  }
}
