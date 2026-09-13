/**
 * The whole world on one image: all 64x64 macro zones, coloured by biome,
 * with the settlement history pass drawn on top.
 *
 * A promoted zone (renderZonePng.ts) is one square of this — 1/4096 of the
 * world — which is why a single zone shows one biome and no mountains or
 * desert. Direct question: "are the screenshots like the entire world? I
 * don't see deserts and mountains."
 *
 * Usage: npx tsx packages/runner/src/renderWorldMapPng.ts <outDir> [seeds]
 */
import { BIOME_NAMES, generateMacroGrid } from "@pokuelike/engine";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "/tmp/zones";
const SEEDS = (process.argv[3] ?? "11").split(",").map(Number);
const S = 10; // pixels per zone

const BIOME: Record<string, [number, number, number]> = {
  ocean: [40, 78, 132], beach: [214, 200, 150], grassland: [140, 176, 96],
  savanna: [190, 178, 104], forest: [58, 104, 62], wetland: [96, 134, 120],
  mangrove: [76, 112, 92], swamp: [88, 108, 84], desert: [222, 196, 136],
  tundra: [196, 204, 206], snow: [228, 234, 238], highland: [136, 130, 120],
  badlands: [168, 118, 86], cave: [92, 84, 80], jungle: [40, 96, 48],
  cliff: [122, 132, 134],
  taiga: [72, 104, 84], steppe: [176, 172, 112], volcanic: [104, 68, 62],
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

// A biome with no colour would render magenta and quietly misrepresent the
// map, which is exactly the failure mode a "look at it" tool must not have.
const unmapped = BIOME_NAMES.filter((n) => !(n in BIOME));
if (unmapped.length) throw new Error(`renderWorldMapPng: no colour for biome(s): ${unmapped.join(", ")}`);

mkdirSync(OUT, { recursive: true });
for (const seed of SEEDS) {
  const grid = generateMacroGrid(seed, 64, 64);
  const W = grid.cols * S, H = grid.rows * S;
  const px = new Uint8Array(W * H * 3);
  const put = (x: number, y: number, c: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
  };

  for (const z of grid.zones) {
    const base = BIOME[z.isOcean ? "ocean" : z.biome] ?? [255, 0, 255];
    // Shade by elevation so the land reads as terrain, not flat colour.
    const k = z.isOcean ? 1 : 0.72 + z.elevation * 0.5;
    const col: [number, number, number] = [
      Math.max(0, Math.min(255, Math.round(base[0] * k))),
      Math.max(0, Math.min(255, Math.round(base[1] * k))),
      Math.max(0, Math.min(255, Math.round(base[2] * k))),
    ];
    for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put(z.col * S + dx, z.row * S + dy, col);
    // Rivers: a bright line on the edge each one crosses.
    for (const dir of z.riverEdges) {
      for (let i = 2; i < S - 2; i++) {
        if (dir === "N") put(z.col * S + i, z.row * S + 1, [90, 150, 220]);
        if (dir === "S") put(z.col * S + i, z.row * S + S - 2, [90, 150, 220]);
        if (dir === "W") put(z.col * S + 1, z.row * S + i, [90, 150, 220]);
        if (dir === "E") put(z.col * S + S - 2, z.row * S + i, [90, 150, 220]);
      }
    }
  }

  const history = grid.history!;
  // Roads under settlements, so a town sits on top of its own roads.
  for (const [index] of history.traffic) {
    const r = Math.floor(index / grid.cols), c = index % grid.cols;
    for (let dy = 4; dy < 6; dy++) for (let dx = 4; dx < 6; dx++) put(c * S + dx, r * S + dy, [226, 210, 170]);
  }
  for (const s of history.settlements) {
    const col: [number, number, number] = s.status === "living" ? [250, 240, 120] : [120, 40, 40];
    for (let dy = 2; dy < S - 2; dy++) for (let dx = 2; dx < S - 2; dx++) put(s.col * S + dx, s.row * S + dy, col);
    for (let dy = 1; dy < S - 1; dy++) for (let dx = 1; dx < S - 1; dx++) {
      if (dy === 1 || dy === S - 2 || dx === 1 || dx === S - 2) put(s.col * S + dx, s.row * S + dy, [30, 25, 20]);
    }
  }

  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[o++] = px[i]!; raw[o++] = px[i + 1]!; raw[o++] = px[i + 2]!; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
  const path = `${OUT}/world_seed${seed}.png`;
  writeFileSync(path, png);
  const biomes = new Map<string, number>();
  for (const z of grid.zones) if (!z.isOcean) biomes.set(z.biome, (biomes.get(z.biome) ?? 0) + 1);
  console.log(`${path}  ${[...biomes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`   settlements ${history.settlements.length} (${history.settlements.filter((s) => s.status === "living").length} living), road zones ${history.traffic.size}`);
}
