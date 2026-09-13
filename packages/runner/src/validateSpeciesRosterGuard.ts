/**
 * Regression harness for the "Unknown species: dragonair" crash.
 *
 * The dex is far larger than the curated SPECIES roster, and evolution
 * targets come from the DEX — so `dratini` (in the roster) evolves into
 * `dragonair` (not in it). `resolveSpawnEvolution` runs inside `spawnAgent`,
 * so a high-level dratini roll resolved off-roster and then threw on the
 * roster lookup, taking the whole zone promotion down.
 *
 * Two checks:
 *  1. Direct: resolve a high-level dratini many times; it must never come
 *     back as a species the roster cannot build.
 *  2. End-to-end: promote a pile of real zones and count crashes.
 *
 * Note which check tests what. Removing the roster guard makes check 1 fail
 * loudly (400/400 off-roster: dragonite 309, dragonair 91) but leaves check 2
 * at zero crashes, because overworld.ts's defensive try/catch around the
 * invented-agent spawn absorbs the throw and drops that agent. So check 1 is
 * the real test of the guard; check 2 is the test of the safety net behind
 * it. Both were verified by removing the guard and re-running.
 *
 * Run: npx tsx packages/runner/src/validateSpeciesRosterGuard.ts
 */
import { createMacroWorld, generateMacroGrid, resolveSpawnEvolution, mulberry32 } from "@pokuelike/engine";
import { LEVELING_CONTEXT, SPECIES, IMMIGRATION_CONTEXT, SCENARIO_WIDTH, SCENARIO_HEIGHT } from "@pokuelike/data";

let offRoster = 0;
const seen = new Map<string, number>();
for (let i = 0; i < 400; i++) {
  const out = resolveSpawnEvolution("dratini", 55, LEVELING_CONTEXT, mulberry32(1000 + i));
  seen.set(out, (seen.get(out) ?? 0) + 1);
  if (!(out in SPECIES)) offRoster++;
}
console.log(`dratini @lvl55 resolved 400x -> ${[...seen].map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`  OFF-ROSTER results: ${offRoster}   <- must be 0`);

let crashes = 0, promoted = 0;
const errors = new Set<string>();
for (const seed of [11, 22, 33]) {
  const grid = generateMacroGrid(seed, 64, 64);
  const land = grid.zones.filter((z) => !z.isOcean);
  // A deterministic spread across the grid rather than the first N, which
  // would all sit in one corner.
  for (let i = 0; i < land.length; i += Math.max(1, Math.floor(land.length / 25))) {
    const z = land[i]!;
    try {
      createMacroWorld(grid, z.row, z.col, seed, SCENARIO_WIDTH, SCENARIO_HEIGHT, IMMIGRATION_CONTEXT);
      promoted++;
    } catch (e) {
      crashes++;
      errors.add(String((e as Error).message).slice(0, 60));
    }
  }
}
console.log(`\npromoted ${promoted} zones across 3 seeds`);
console.log(`  crashes: ${crashes}   <- must be 0`);
if (errors.size) console.log(`  errors seen: ${[...errors].join(" | ")}`);
