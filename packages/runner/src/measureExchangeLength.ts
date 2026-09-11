/**
 * Direct ask, after the chebyshev reach change raised the fight rate 24%:
 * "So... Are lots of clashes and hunts resulting in things getting one shot?
 * I do want a little back and forth..."
 *
 * Fight COUNT tells you nothing about fight SHAPE. This measures shape:
 *
 *  - one-shot rate: a defender at full HP taken to 0 by a single hit.
 *  - hits-to-down:  how many hits a victim actually absorbed before going down.
 *  - mutuality:     did the victim ever land a hit back on its killer? A
 *                   4-hit beatdown where the victim never swings is not
 *                   "back and forth", so hit count alone is not enough.
 *  - damage/hpBefore histogram, for predation and herdClash separately,
 *                   since they run through different resolvers.
 *
 * Two measurement traps this harness explicitly avoids, both found the hard
 * way on the first run:
 *  1. The killing blow is ALWAYS 100% of the defender's remaining HP, so a
 *     naive damage/hpBefore histogram puts ~37% of all hits in the top
 *     bucket and "proves" every hit is nearly lethal. Killing blows are
 *     therefore excluded from the chip-damage histogram and counted apart.
 *  2. A victim's hits must be segmented into ENGAGEMENTS by a tick gap.
 *     Summing every hit an agent ever took conflates three separate fights
 *     across a long life into one 13-hit "exchange", and hands the
 *     swing-back check a lifetime-wide window in which to find a hit,
 *     overstating mutuality.
 *
 * maxHp is read off the live agents each tick rather than inferred from
 * events, so level-ups that raise maxHp mid-run don't skew "was at full HP".
 * Finishing blows against an already-downed body are excluded from every
 * hit count — they'd inflate exchange length with hits on a corpse.
 *
 * Run: npx tsx packages/runner/src/measureExchangeLength.ts [ticks] [seeds]
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const TICKS = Number(process.argv[2] ?? 6000);
const SEEDS = (process.argv[3] ?? "11,22,33,44,55,66").split(",").map(Number);
/** Hits on one victim separated by more than this many ticks are different fights. */
const ENGAGEMENT_GAP_TICKS = Number(process.argv[4] ?? 30);

type Hit = { tick: number; attacker: string; defender: string; dmg: number; before: number; source: "predation" | "clash"; crit: boolean };

let oneShotFull = 0, totalDownings = 0;
const hitsToDown: number[] = [];
const mutualDownings = { mutual: 0, oneSided: 0 };
const fracBuckets = { predation: new Map<string, number>(), clash: new Map<string, number>() };
let predHits = 0, clashHits = 0, crits = 0, misses = 0, killingBlows = 0;
/**
 * The parameter-free headline: of all hits that landed on a defender who was
 * at FULL hp, how many took it straight to 0? This needs no engagement
 * window and no faint-event join, so unlike hits-to-down it cannot be moved
 * by the choice of ENGAGEMENT_GAP_TICKS.
 */
const atFull = { predation: { hits: 0, lethal: 0 }, clash: { hits: 0, lethal: 0 } };
const oneShotGaps: number[] = [];
const bySource = { predation: { oneShot: 0, downings: 0 }, clash: { oneShot: 0, downings: 0 } };

const BUCKETS = [0.1, 0.2, 0.35, 0.5, 0.75, 1.0];
function bucketOf(f: number): string {
  for (const b of BUCKETS) if (f <= b) return `<=${Math.round(b * 100)}%`;
  return ">100% (overkill)";
}

for (const seed of SEEDS) {
  const world = createDemoWorld(seed);
  const log = new EventLog();
  const maxHp = new Map<string, number>();
  const level = new Map<string, number>();
  for (let i = 0; i < TICKS; i++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    for (const a of world.agents as any[]) {
      if (a.maxHp) maxHp.set(a.id, a.maxHp);
      if (a.level) level.set(a.id, a.level);
    }
  }

  // Replay the event stream in tick order, tracking each agent's live hit history.
  const hits: Hit[] = [];
  const downTicks: { agentId: string; tick: number }[] = [];
  for (const e of (log as any).events ?? []) {
    if (e.kind === "fought") {
      if (e.finishingBlow) continue;
      hits.push({ tick: e.tick, attacker: e.attackerId, defender: e.defenderId, dmg: e.damage,
        before: e.damage + e.defenderHpRemaining, source: "predation", crit: !!e.critical });
      predHits++; if (e.critical) crits++;
    } else if (e.kind === "herdClash" && e.outcome !== "missed" && e.damage != null) {
      hits.push({ tick: e.tick, attacker: e.attackerId, defender: e.defenderId, dmg: e.damage,
        before: e.damage + (e.defenderHpRemaining ?? 0), source: "clash", crit: !!e.critical });
      clashHits++; if (e.critical) crits++;
    } else if (e.kind === "missed") {
      misses++;
    } else if (e.kind === "fainted") {
      downTicks.push({ agentId: e.agentId, tick: e.tick });
    }
  }
  hits.sort((a, b) => a.tick - b.tick);

  for (const h of hits) {
    const fullHp = maxHp.get(h.defender);
    if (fullHp != null && h.before >= fullHp - 0.001) {
      atFull[h.source].hits++;
      if (h.dmg >= h.before) atFull[h.source].lethal++;
    }
    if (h.dmg >= h.before) { killingBlows++; continue; } // definitionally 100%; counted apart
    const frac = h.before > 0 ? h.dmg / h.before : 1;
    const m = fracBuckets[h.source === "predation" ? "predation" : "clash"];
    const k = bucketOf(frac);
    m.set(k, (m.get(k) ?? 0) + 1);
  }

  // For each downing, isolate the ENGAGEMENT that produced it: walk back from
  // the faint tick over the victim's received hits while the gap between
  // consecutive hits stays under ENGAGEMENT_GAP_TICKS. Only that window counts.
  for (const d of downTicks) {
    totalDownings++;
    const full = maxHp.get(d.agentId);
    const received = hits.filter((h) => h.defender === d.agentId && h.tick <= d.tick);
    if (received.length === 0) continue;
    let start = received.length - 1;
    while (start > 0 && received[start].tick - received[start - 1].tick <= ENGAGEMENT_GAP_TICKS) start--;
    const window = received.slice(start);
    hitsToDown.push(window.length);
    const openedAtFull = full != null && window[0].before >= full - 0.001;
    if (window.length === 1 && openedAtFull) {
      oneShotFull++;
      bySource[window[0].source].oneShot++;
      const gap = (level.get(window[0].attacker) ?? 0) - (level.get(d.agentId) ?? 0);
      oneShotGaps.push(gap);
    }
    bySource[window[window.length - 1].source].downings++;

    const killer = window[window.length - 1].attacker;
    const swungBack = hits.some((h) => h.attacker === d.agentId && h.defender === killer &&
      h.tick >= window[0].tick && h.tick <= d.tick);
    if (swungBack) mutualDownings.mutual++; else mutualDownings.oneSided++;
  }
}

const n = hitsToDown.length;
const sorted = [...hitsToDown].sort((a, b) => a - b);
const pct = (k: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(k * sorted.length))] : 0;
const dist = new Map<string, number>();
for (const h of hitsToDown) { const k = h >= 6 ? "6+" : String(h); dist.set(k, (dist.get(k) ?? 0) + 1); }

console.log(`${SEEDS.length} seeds x ${TICKS} ticks`);
console.log(`hits: predation ${predHits}, clash ${clashHits}, misses ${misses}, crits ${crits} (${(100*crits/Math.max(1,predHits+clashHits)).toFixed(1)}% of hits)`);
console.log(`\ndownings analysed: ${n} (of ${totalDownings} faint events)`);
console.log(`ONE-SHOT from full HP: ${oneShotFull} / ${n} = ${(100*oneShotFull/Math.max(1,n)).toFixed(1)}%`);
for (const src of ["predation", "clash"] as const) {
  const b = bySource[src];
  console.log(`    ${src.padEnd(10)} one-shots ${b.oneShot} of ${b.downings} downings it caused = ${(100*b.oneShot/Math.max(1,b.downings)).toFixed(1)}%`);
}
if (oneShotGaps.length) {
  const g = [...oneShotGaps].sort((a,b)=>a-b);
  console.log(`    attacker-minus-defender LEVEL GAP on one-shots: mean ${(g.reduce((a,b)=>a+b,0)/g.length).toFixed(1)}  median ${g[Math.floor(g.length/2)]}  min ${g[0]}  max ${g[g.length-1]}`);
}
console.log(`killing blows (excluded from histogram below): ${killingBlows}`);
console.log(`\nPARAMETER-FREE: hit a defender who was at FULL HP -> did it die outright?`);
for (const src of ["predation", "clash"] as const) {
  const a = atFull[src];
  console.log(`    ${src.padEnd(10)} ${a.lethal} lethal of ${a.hits} full-hp hits = ${(100*a.lethal/Math.max(1,a.hits)).toFixed(1)}% deleted in one blow`);
}
console.log(`hits-to-down: mean ${(hitsToDown.reduce((a,b)=>a+b,0)/Math.max(1,n)).toFixed(2)}  median ${pct(0.5)}  p90 ${pct(0.9)}`);
console.log(`  distribution: ${[...dist].sort((a,b)=> (a[0]==="6+"?99:+a[0]) - (b[0]==="6+"?99:+b[0])).map(([k,v])=>`${k} hit${k==="1"?"":"s"}: ${v} (${(100*v/Math.max(1,n)).toFixed(0)}%)`).join("  ")}`);
console.log(`\nmutuality of downings: victim swung back ${mutualDownings.mutual} (${(100*mutualDownings.mutual/Math.max(1,mutualDownings.mutual+mutualDownings.oneSided)).toFixed(1)}%), never swung back ${mutualDownings.oneSided}`);
for (const src of ["predation", "clash"] as const) {
  const m = fracBuckets[src];
  const tot = [...m.values()].reduce((a,b)=>a+b,0);
  const order = [...BUCKETS.map(b=>`<=${Math.round(b*100)}%`), ">100% (overkill)"];
  console.log(`\nCHIP damage as fraction of defender's CURRENT hp, killing blows EXCLUDED — ${src} (n=${tot}):`);
  for (const k of order) if (m.get(k)) console.log(`  ${k.padEnd(16)} ${String(m.get(k)).padStart(6)} (${(100*(m.get(k)??0)/Math.max(1,tot)).toFixed(1)}%)`);
}
