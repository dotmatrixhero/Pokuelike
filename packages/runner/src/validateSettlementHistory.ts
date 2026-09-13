/**
 * Does the settlement history pass produce a world worth walking around?
 * (HUMAN_PASS.md phase 1.) Checks the rules it is supposed to hold to:
 *
 *  - every settlement on FRESH water (the founding rule; coast is salt)
 *  - wilderness stays dominant (decision 6: "populated world is good, just
 *    gotta not be... everything") — measured as the share of land zones that
 *    are settled or roaded
 *  - real variety of specialities, not one dominant answer
 *  - failures leave ruins WITH a recorded cause
 *  - lineages actually form (daughters, not just origins)
 *  - it is cheap: the macro grid generates a 64x64 world in ~2.5s, and this
 *    runs inside that budget
 *
 * Run: npx tsx packages/runner/src/validateSettlementHistory.ts [seeds]
 */
import { generateMacroGrid, hasFreshWater } from "@pokuelike/engine";

const SEEDS = (process.argv[2] ?? "11,22,33").split(",").map(Number);

let totalSettled = 0, totalRuined = 0, totalLand = 0, totalFootprint = 0;
let onFreshWater = 0, ruinsWithCause = 0, daughters = 0, origins = 0;
let orphanRoads = 0;
const specialties = new Map<string, number>();
const times: number[] = [];

for (const seed of SEEDS) {
  const t0 = Date.now();
  const grid = generateMacroGrid(seed, 64, 64);
  times.push(Date.now() - t0);
  const h = grid.history!;
  const land = grid.zones.filter((z) => !z.isOcean);
  totalLand += land.length;

  for (const s of h.settlements) {
    totalSettled++;
    const zone = grid.zones[s.row * grid.cols + s.col]!;
    if (hasFreshWater(zone)) onFreshWater++;
    if (s.status === "ruined") {
      totalRuined++;
      if (s.ruinedCause) ruinsWithCause++;
    }
    if (s.origin === "daughter") daughters++; else origins++;
    specialties.set(s.specialty, (specialties.get(s.specialty) ?? 0) + 1);
  }

  // Footprint: zones that are a settlement or carry road traffic.
  const marked = new Set<number>(h.traffic.keys());
  for (const s of h.settlements) marked.add(s.row * grid.cols + s.col);
  totalFootprint += marked.size;

  for (const r of h.roads) {
    if (!h.settlements.some((s) => s.id === r.fromId) || !h.settlements.some((s) => s.id === r.toId)) orphanRoads++;
  }

  if (seed === SEEDS[0]) {
    console.log(`--- seed ${seed}: ${h.settlements.length} settlements, ${h.roads.length} roads, ${h.eraEvents.length} era events`);
    for (const s of h.settlements.slice(0, 6)) {
      console.log(`  ${s.name.padEnd(14)} ${s.specialty.padEnd(11)} pop ${String(s.population).padStart(4)}  site ${s.siteScore.toFixed(2)}  ${s.status}${s.ruinedCause ? ` (${s.ruinedCause})` : ""}`);
    }
    console.log(`  era events: ${h.eraEvents.map((e) => e.text).join(" ") || "(none)"}`);
    const withStory = h.settlements.find((s) => s.chronicle.length > 1);
    if (withStory) {
      console.log(`\n  chronicle for ${withStory.name}:`);
      for (const line of withStory.chronicle) console.log(`    ${line}`);
    }
  }
}

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
console.log(`\n${SEEDS.length} seeds, 64x64`);
console.log(`settlements: ${totalSettled}  (origins ${origins}, daughters ${daughters})  ruined ${totalRuined} = ${pct(totalRuined, totalSettled)}`);
console.log(`ON FRESH WATER:        ${onFreshWater}/${totalSettled} = ${pct(onFreshWater, totalSettled)}   <- founding rule, must be 100%`);
console.log(`ruins with a cause:    ${ruinsWithCause}/${totalRuined}`);
console.log(`orphan roads:          ${orphanRoads}  <- must be 0`);
console.log(`human footprint:       ${totalFootprint}/${totalLand} land zones = ${pct(totalFootprint, totalLand)}   <- wilderness must dominate`);
console.log(`specialities:          ${[...specialties].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`macro grid gen time:   ${times.map((t) => `${t}ms`).join(", ")}  (budget ~2500ms)`);
