/**
 * How many distinct true things can an ambient describer actually say about
 * a real generated cave?
 *
 * Written because of a direct concern, and a fair one: "imagine if the
 * entire time youre in the cave you read 'moss on the walls here'." An
 * ambient description layer is only worth building if the world affords
 * enough genuinely different observations to fill a whole cave without
 * cycling. That is a countable question, so count it rather than promising.
 *
 * Measures, over real generated underground layers: which terrain kinds
 * actually occur, which flora flavors actually get assigned, and how much
 * of the theoretical vocabulary is reachable in practice. The answer bounds
 * the feature before anyone builds it.
 *
 * Run: `npx tsx packages/runner/src/validateAmbientVocabulary.ts [seeds]`
 */
import { generateWorld, tileAt } from "@pokuelike/engine";

const SEEDS = (process.argv[2] ?? "1000,8919,16838,24757,31337,42424").split(",").map(Number);
const W = 90;
const H = 60;

const terrainTotals = new Map<string, number>();
const flavorTotals = new Map<string, number>();
let tilesSeen = 0;
const perSeedKinds: number[] = [];

for (const seed of SEEDS) {
  const world = generateWorld(W, H, seed);
  const kindsHere = new Set<string>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tile = tileAt(world, "underground", x, y);
      if (!tile) continue;
      tilesSeen++;
      terrainTotals.set(tile.terrain, (terrainTotals.get(tile.terrain) ?? 0) + 1);
      kindsHere.add(tile.terrain);
      if (tile.flavor) flavorTotals.set(tile.flavor, (flavorTotals.get(tile.flavor) ?? 0) + 1);
    }
  }
  perSeedKinds.push(kindsHere.size);
}

const pct = (n: number) => `${((100 * n) / tilesSeen).toFixed(2)}%`;

console.log(`\n=== ambient vocabulary available underground — ${SEEDS.length} seeds, ${W}x${H} ===\n`);

console.log("--- terrain kinds actually present ---");
const sorted = [...terrainTotals.entries()].sort((a, b) => b[1] - a[1]);
for (const [kind, count] of sorted) {
  console.log(`  ${kind.padEnd(12)} ${String(count).padStart(7)}  ${pct(count)}`);
}

console.log("\n--- flora flavors actually assigned ---");
if (flavorTotals.size === 0) {
  console.log("  (none)");
} else {
  for (const [flavor, count] of [...flavorTotals.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${flavor.padEnd(12)} ${String(count).padStart(7)}`);
  }
}

console.log("\n--- the honest ceiling ---");
console.log(`  distinct terrain kinds underground: ${terrainTotals.size} (per seed: ${perSeedKinds.join(", ")})`);
console.log(`  distinct flora flavors:             ${flavorTotals.size}`);

// A describer keyed on "terrain kind appeared" plus a handful of derived
// conditions. Derived ones are estimated, not measured, and named as such.
const DERIVED = ["passage narrows", "opens out", "floor rising", "floor falling", "small water body", "large water body"];
const ceiling = terrainTotals.size + flavorTotals.size + DERIVED.length;
console.log(`  derived conditions (estimate):      ${DERIVED.length}  [${DERIVED.join(", ")}]`);
console.log(`  => rough distinct-line ceiling:     ~${ceiling}`);
console.log();
console.log(`  A 5-6 layer cave at even 150 turns/layer is 750+ turns. At one`);
console.log(`  ambient line every 5 turns that is ~150 lines drawn from ~${ceiling}.`);
console.log(`  Each line would repeat roughly ${(150 / ceiling).toFixed(0)}x.`);
console.log();
