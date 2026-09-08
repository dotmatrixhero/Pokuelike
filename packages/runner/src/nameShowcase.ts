/** A spread of generated names across seeds, biomes and types — for eyeballing quality, not a test. */
import { EventLog, tickWorld, generateMacroGrid, displayNameFor, notableFullName } from "@pokuelike/engine";
import { createDemoMacroWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

console.log("=== TERRITORIES (three worlds) ===");
for (const seed of [7, 24757, 90210]) {
  const grid = generateMacroGrid(seed, 64, 64);
  const names = (grid.territories ?? []).sort((a, b) => b.zoneIndices.length - a.zoneIndices.length).slice(0, 12);
  console.log(`\nseed ${seed}: ${names.map((t) => t.name).join(", ")}`);
}

console.log("\n\n=== INDIVIDUAL NAMES BY TYPE ===");
for (const type of ["fire","water","grass","rock","bug","flying","ghost","dragon","ice","dark","steel","fairy"] as const) {
  const names = Array.from({ length: 7 }, (_, i) => displayNameFor(`show-${type}-${i}`, [type]));
  console.log(`${type.padEnd(9)} ${names.join(", ")}`);
}

console.log("\n\n=== NOTABLE FULL NAMES ===");
for (const title of ["hero","rival","elder","wanderer","shaman","underdog","giantSlayer","savant","alpha","beloved"] as const) {
  const names = Array.from({ length: 4 }, (_, i) => notableFullName(title, `n-${title}-${i}`, ["fire"]));
  console.log(`${title.padEnd(12)} ${names.join(" · ")}`);
}

console.log("\n\n=== HERD NAMES FROM REAL RUNS ===");
for (const seed of [24757, 7]) {
  const macro: any = createDemoMacroWorld(seed);
  const world: any = macro.regions.get(macro.focusedKey).world;
  const log = new EventLog();
  for (let t = 0; t < 14000; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  console.log(`\n--- ${world.territoryName} (seed ${seed}) ---`);
  for (const h of (Object.values(world.herds ?? {}) as any[]).sort((a, b) => b.peakSize - a.peakSize).slice(0, 16)) {
    console.log(`  ${h.name.padEnd(46)} ${h.species.padEnd(12)} peak ${String(h.peakSize).padStart(2)} (${h.origin})`);
  }
}
