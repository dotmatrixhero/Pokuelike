/**
 * Are eggs actually defended, or does anything just walk up and eat one?
 *
 * Direct report: "parents are not defending them well. Enemy units just walk
 * up and eat em lol."
 *
 * The radii look fine on paper — a defender notices its own eggs within
 * EGG_DEFENSE_RADIUS 8, an eater only notices an egg within
 * EGG_EAT_DETECT_RADIUS 5 — so this measures the thing paper cannot: how
 * often a defender is actually THERE. For every tick of every egg's life it
 * records the distance to the nearest eligible defender, then reports what
 * that distance was on the tick an egg got eaten.
 *
 * Run: `npx tsx packages/runner/src/validateEggDefense.ts [ticks] [seeds]`
 */
import { EventLog, tickWorld, type Agent, type World } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 12000);
const nSeeds = Number(process.argv[3] ?? 4);

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** The same eligibility `nearbyOwnEggs` uses, from the egg's side. */
function nearestDefender(world: World, egg: Agent): number {
  let best = Infinity;
  for (const a of world.agents) {
    if (a.isEgg || a.alive === false || a.layer !== egg.layer) continue;
    if (a.fainted || a.beingCarriedBy) continue;
    const eligible = a.herdId ? a.herdId === egg.herdId : a.species === egg.species;
    if (!eligible) continue;
    best = Math.min(best, manhattan(a.pos, egg.pos));
  }
  return best;
}

let totals = { laid: 0, hatched: 0, eaten: 0, defended: 0 };
const guardedEggTicks: number[] = [];
const eatenGuardDist: number[] = [];
const rows: string[] = [];

for (let i = 0; i < nSeeds; i++) {
  const seed = 1000 + i * 7919;
  const world = createDemoWorld(seed) as World;
  const log = new EventLog();
  let guarded = 0;
  let eggTicks = 0;
  const eaten: number[] = [];

  for (let t = 0; t < ticks; t++) {
    // Snapshot every living egg's nearest defender BEFORE the tick resolves,
    // so an egg eaten this tick reports the distance that actually applied.
    const before = new Map<string, number>();
    for (const a of world.agents) {
      if (a.isEgg === true && a.alive !== false) before.set(a.id, nearestDefender(world, a));
    }
    eggTicks += before.size;
    for (const d of before.values()) if (d <= 8) guarded++;

    const seenBefore = log.events.length;
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, (world as unknown as { rng: () => number }).rng, IMMIGRATION_CONTEXT);
    // An egg eaten THIS tick reports the defender distance that actually
    // applied, snapshotted above before anything moved.
    for (let e = seenBefore; e < log.events.length; e++) {
      const ev = log.events[e] as { kind: string; eggId?: string };
      if (ev.kind === "eggEaten" && ev.eggId !== undefined) {
        const d = before.get(ev.eggId);
        if (d !== undefined) eaten.push(d);
      }
    }
  }

  const events = log.events as unknown as { kind: string }[];
  const laid = events.filter((e) => e.kind === "eggLaid").length;
  const hatched = events.filter((e) => e.kind === "eggHatched").length;
  const ate = events.filter((e) => e.kind === "eggEaten").length;
  const defended = events.filter((e) => e.kind === "eggDefended").length;
  totals.laid += laid; totals.hatched += hatched; totals.eaten += ate; totals.defended += defended;
  const guardShare = eggTicks ? (100 * guarded) / eggTicks : 0;
  guardedEggTicks.push(guardShare);
  eatenGuardDist.push(...eaten);
  rows.push(`${seed}  laid ${String(laid).padStart(4)}  hatched ${String(hatched).padStart(4)}  eaten ${String(ate).padStart(4)}  defended ${String(defended).padStart(4)}  egg-ticks ${String(eggTicks).padStart(6)}  guarded ${guardShare.toFixed(1)}%`);
}

console.log(rows.join("\n"));
const survived = totals.laid ? (100 * totals.hatched) / totals.laid : 0;
console.log(`\nTOTAL over ${nSeeds} seeds x ${ticks} ticks`);
console.log(`  laid ${totals.laid}  hatched ${totals.hatched} (${survived.toFixed(0)}%)  eaten ${totals.eaten}  defence actions ${totals.defended}`);
console.log(`  mean share of egg-ticks with an eligible defender within 8: ${(guardedEggTicks.reduce((a, b) => a + b, 0) / Math.max(1, guardedEggTicks.length)).toFixed(1)}%`);

// The discriminating number. If eggs die while a defender was in range, the
// DEFENCE is failing. If they die with the nearest defender far away, nothing
// keeps a parent home and the defence never gets a chance to run.
if (eatenGuardDist.length > 0) {
  const inRange = eatenGuardDist.filter((d) => d <= 8).length;
  const none = eatenGuardDist.filter((d) => !Number.isFinite(d)).length;
  const finite = eatenGuardDist.filter((d) => Number.isFinite(d));
  finite.sort((a, b) => a - b);
  const median = finite.length ? finite[Math.floor(finite.length / 2)] : NaN;
  console.log(`\n  when an egg was EATEN, nearest eligible defender was:`);
  console.log(`    within 8 (defence should have fired): ${inRange}/${eatenGuardDist.length} (${((100 * inRange) / eatenGuardDist.length).toFixed(0)}%)`);
  console.log(`    no eligible defender alive at all:    ${none}`);
  console.log(`    median distance:                      ${Number.isFinite(median) ? median : "n/a"}`);
  const buckets = [0, 1, 2, 4, 8, 16, 32];
  const hist = buckets.map((b, i) => {
    const hi = buckets[i + 1] ?? Infinity;
    return `${b}-${hi === Infinity ? "inf" : hi}: ${finite.filter((d) => d >= b && d < hi).length}`;
  });
  console.log(`    histogram: ${hist.join("  ")}`);
}
