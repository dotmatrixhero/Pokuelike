/**
 * Does elevation actually matter in combat, and does wiring it into the
 * accuracy roll change anything measurable?
 *
 * Written to answer a specific design question: `elevation.ts` exports
 * `elevationAccuracyModifier`/`elevationEvasionModifier` (high ground helps
 * the attacker hit, capped at +-0.3) and they had zero callers. Before
 * wiring them, the thing worth knowing is whether real fights ever HAPPEN at
 * a nonzero elevation delta — if terrain under combat is essentially flat,
 * the whole change is a no-op and should be reported as one rather than
 * shipped.
 *
 * Three measurements:
 *
 * 1. **The control.** Distribution of elevation deltas between attacker and
 *    defender across every real hit attempt. If this is overwhelmingly 0,
 *    nothing else in this script matters.
 * 2. **Overall miss rate**, per seed — the aggregate before/after number.
 * 3. **Miss rate bucketed by elevation delta.** Before wiring this should be
 *    FLAT across buckets (elevation can't be affecting a roll that doesn't
 *    read it); after, it should slope. A flat "after" means the wiring
 *    didn't take.
 *
 * Precision caveat, stated because it affects how much the bucket numbers
 * can be trusted: `fought`/`missed` events carry the DEFENDER's position
 * exactly, but not the attacker's, so the attacker's position is joined from
 * a snapshot taken immediately before that tick. An attacker that moved
 * during the tick before striking is attributed its pre-move elevation.
 * Elevation is spatially smooth, so this is a small error on a large N, but
 * it is a real one — bucket boundaries are approximate, the aggregate miss
 * rate (measurement 2) is exact.
 *
 * Run: `npx tsx packages/runner/src/validateElevationAccuracy.ts [ticks] [seed,seed,...]`
 */
import { EventLog, tickWorld, tileAt } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 6000);
const SEEDS = (process.argv[3] ?? "1000,8919,16838,24757,31337,42424").split(",").map(Number);

interface Attempt {
  hit: boolean;
  delta: number;
}

/** Aggregated across every seed, so the bucket table has enough N to read. */
const allAttempts: Attempt[] = [];
const perSeedSummary: { seed: number; attempts: number; misses: number; nonzero: number }[] = [];

for (const seed of SEEDS) {
  const world: any = createDemoWorld(seed);
  const log = new EventLog();
  const attempts: Attempt[] = [];

  let cursor = 0;
  for (let t = 0; t < ticks; t++) {
    // Snapshot positions BEFORE the tick — see the precision caveat above.
    const posById = new Map<string, { x: number; y: number; layer: string }>();
    for (const a of world.agents) {
      if (a.alive !== false) posById.set(a.id, { x: a.pos.x, y: a.pos.y, layer: a.layer });
    }

    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

    // Only events produced by this tick.
    for (; cursor < log.events.length; cursor++) {
      const e: any = log.events[cursor];
      const isHit = e.kind === "fought";
      const isMiss = e.kind === "missed";
      const isClash = e.kind === "herdClash";
      if (!isHit && !isMiss && !isClash) continue;

      const attackerPos = posById.get(e.attackerId);
      if (!attackerPos || !e.pos) continue;

      const attackerTile = tileAt(world, attackerPos.layer as any, attackerPos.x, attackerPos.y);
      const defenderTile = tileAt(world, attackerPos.layer as any, e.pos.x, e.pos.y);
      if (!attackerTile || !defenderTile) continue;

      const delta = (attackerTile.elevation ?? 0) - (defenderTile.elevation ?? 0);
      const hit = isClash ? e.outcome !== "missed" : isHit;
      attempts.push({ hit, delta });
    }
  }

  const misses = attempts.filter((a) => !a.hit).length;
  const nonzero = attempts.filter((a) => a.delta !== 0).length;
  perSeedSummary.push({ seed, attempts: attempts.length, misses, nonzero });
  allAttempts.push(...attempts);
}

const pct = (n: number, d: number) => (d === 0 ? "  n/a" : `${((100 * n) / d).toFixed(1)}%`);

console.log(`\n=== elevation vs. accuracy — ${SEEDS.length} seeds x ${ticks} ticks ===\n`);

console.log("--- 2. overall miss rate (exact) ---");
for (const s of perSeedSummary) {
  console.log(
    `seed ${String(s.seed).padStart(6)}  attempts ${String(s.attempts).padStart(6)}  ` +
      `miss ${pct(s.misses, s.attempts)}  nonzero-elev ${pct(s.nonzero, s.attempts)}`
  );
}
const totalAttempts = allAttempts.length;
const totalMisses = allAttempts.filter((a) => !a.hit).length;
const totalNonzero = allAttempts.filter((a) => a.delta !== 0).length;
console.log(
  `\nALL      attempts ${String(totalAttempts).padStart(6)}  miss ${pct(totalMisses, totalAttempts)}  ` +
    `nonzero-elev ${pct(totalNonzero, totalAttempts)}`
);

console.log("\n--- 1. THE CONTROL: elevation-delta distribution across hit attempts ---");
console.log("(if this is ~all ~0, wiring elevation into accuracy is a no-op)");
console.log("NOTE: Tile.elevation is a continuous float, not an integer — so an");
console.log("exact-0 delta means the two combatants are on the SAME tile-elevation");
console.log("(flat terrain), and everything else is a real, fractional gradient.");
const absDelta = allAttempts.map((a) => Math.abs(a.delta)).sort((x, y) => x - y);
const q = (p: number) => (absDelta.length ? absDelta[Math.floor(p * (absDelta.length - 1))]!.toFixed(3) : "n/a");
const exactZero = allAttempts.filter((a) => a.delta === 0).length;
console.log(`  exactly 0 (flat):     ${String(exactZero).padStart(6)}  ${pct(exactZero, totalAttempts)}`);
console.log(`  |delta| > 0.1:        ${String(allAttempts.filter((a) => Math.abs(a.delta) > 0.1).length).padStart(6)}  ${pct(allAttempts.filter((a) => Math.abs(a.delta) > 0.1).length, totalAttempts)}`);
console.log(`  |delta| > 0.5:        ${String(allAttempts.filter((a) => Math.abs(a.delta) > 0.5).length).padStart(6)}  ${pct(allAttempts.filter((a) => Math.abs(a.delta) > 0.5).length, totalAttempts)}`);
console.log(`  |delta| > 1.0:        ${String(allAttempts.filter((a) => Math.abs(a.delta) > 1).length).padStart(6)}  ${pct(allAttempts.filter((a) => Math.abs(a.delta) > 1).length, totalAttempts)}`);
console.log(`  |delta| percentiles:  p50 ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${q(1)}`);
console.log(`  => accuracy multiplier at p90 |delta|: ${(1 + Math.max(-0.3, Math.min(0.3, Number(q(0.9)) * 0.05))).toFixed(4)}`);

console.log("\n--- 3. miss rate bucketed by elevation delta ---");
console.log("(flat = elevation is not affecting the roll; sloped = it is)");
const buckets: { label: string; test: (d: number) => boolean }[] = [
  { label: "attacker >1.0 below ", test: (d) => d < -1 },
  { label: "attacker 0.1-1 below", test: (d) => d < -0.1 && d >= -1 },
  { label: "level (|d|<=0.1)    ", test: (d) => Math.abs(d) <= 0.1 },
  { label: "attacker 0.1-1 above", test: (d) => d > 0.1 && d <= 1 },
  { label: "attacker >1.0 above ", test: (d) => d > 1 },
];
for (const b of buckets) {
  const inBucket = allAttempts.filter((a) => b.test(a.delta));
  const m = inBucket.filter((a) => !a.hit).length;
  console.log(`  ${b.label}  n=${String(inBucket.length).padStart(6)}  miss ${pct(m, inBucket.length)}`);
}
console.log();
