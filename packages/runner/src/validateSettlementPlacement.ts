/**
 * Does a settlement from the history pass become a real place when you walk
 * into it? (HUMAN_PASS.md phase 2.)
 *
 * Promotes the zone a settlement actually sits on and checks what is on the
 * ground: homes, a palisade, named people with roles — and for a RUIN, broken
 * walls and nobody, which is the case most likely to be silently wrong.
 *
 * CONTROL: a wilderness zone promoted the same way must get no settlement, no
 * shelter cluster and no villagers. Without it, "found shelter tiles" proves
 * nothing — worldgen scatters some on its own.
 *
 * Run: npx tsx packages/runner/src/validateSettlementPlacement.ts [seed]
 */
import { createMacroWorld, generateMacroGrid, promoteZone, tileAt } from "@pokuelike/engine";
import type { World } from "@pokuelike/engine";
import { IMMIGRATION_CONTEXT, SCENARIO_WIDTH, SCENARIO_HEIGHT } from "@pokuelike/data";

const SEED = Number(process.argv[2] ?? 11);
const grid = generateMacroGrid(SEED, 64, 64);
const history = grid.history!;

function count(world: World, terrain: string): number {
  let n = 0;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) if (tileAt(world, "surface", x, y)?.terrain === terrain) n++;
  }
  return n;
}

function report(label: string, world: World | undefined) {
  if (!world) { console.log(`${label}: no world`); return; }
  const villagers = world.agents.filter((a) => a.settlementRole);
  const s = world.settlement;
  console.log(
    `${label}\n` +
    `   settlement:  ${s ? `${s.name} (${s.specialty}, ${s.status}, pop ${s.population})` : "(none)"}${s?.ruinedCause ? ` — ${s.ruinedCause}` : ""}\n` +
    `   shelter:     ${count(world, "shelter")}\n` +
    `   wall:        ${count(world, "wall")}\n` +
    `   villagers:   ${villagers.length}  ${villagers.map((v) => v.settlementRole).join(", ") || "(none)"}\n` +
    `   humans total:${world.agents.filter((a) => a.species === "human").length}`
  );
}

const living = history.settlements.find((s) => s.status === "living")!;
const ruined = history.settlements.find((s) => s.status === "ruined");

const mwLiving = createMacroWorld(grid, living.row, living.col, SEED, SCENARIO_WIDTH, SCENARIO_HEIGHT, IMMIGRATION_CONTEXT);
report(`LIVING  ${living.name} @${living.row},${living.col}`, mwLiving.regions.get(`${living.row},${living.col}`)?.world);

if (ruined) {
  const mwRuined = createMacroWorld(grid, ruined.row, ruined.col, SEED, SCENARIO_WIDTH, SCENARIO_HEIGHT, IMMIGRATION_CONTEXT);
  report(`RUINED  ${ruined.name} @${ruined.row},${ruined.col}`, mwRuined.regions.get(`${ruined.row},${ruined.col}`)?.world);
}

// CONTROL: a land zone with no settlement on it.
const occupied = new Set(history.settlements.map((s) => `${s.row},${s.col}`));
const wild = grid.zones.find((z) => !z.isOcean && !occupied.has(`${z.row},${z.col}`))!;
const mwWild = createMacroWorld(grid, wild.row, wild.col, SEED, SCENARIO_WIDTH, SCENARIO_HEIGHT, IMMIGRATION_CONTEXT);
report(`CONTROL wilderness @${wild.row},${wild.col}`, mwWild.regions.get(`${wild.row},${wild.col}`)?.world);
