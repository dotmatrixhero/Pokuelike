/**
 * Balance report for a move tree, against the rest of the roster as control.
 *
 *   npx tsx packages/data/scripts/tree-balance.ts            # whole roster
 *   npx tsx packages/data/scripts/tree-balance.ts earthquake # one tree vs roster
 *
 * The structural checker (check-proposed-trees.ts) says whether a tree is
 * SHAPED right. This says whether it is BALANCED — what a fully-invested build
 * actually multiplies, how many distinct levers and colour-pie flavours it
 * draws on, and how deep its capstones sit. Every number is printed next to
 * the roster median so a result is interpretable rather than just a number.
 */
import { MOVES } from "../src/moves.js";

const FLAVOUR: Record<string, string[]> = {
  "raw damage": ["power", "hits", "hitsBonus", "critRateStage", "critCooldownReset", "statusSeverity", "weightScaling", "recoilFraction", "lifestealFraction"],
  "stealth/ambush": ["situationalBonus", "situationalBonuses", "burrow"],
  "aggressive movement": ["chargeAttack", "forcedMovement", "reposition", "lockTicks"],
  "piercing": ["defensePenetration", "resistanceBreaker", "bonusVsType", "rangeBonus"],
  "defence": ["p:damageReduction", "p:damageReductionFlat", "p:defenseBoost", "p:thorns", "p:unshaken", "p:immovable", "p:fireproof"],
  "environment": ["terrainBurn", "terrainFill", "consumesOwnTerrain", "createsTerrain", "spawnsRain", "fertilityBoost"],
  "wider aoe": ["shape", "hitsArea", "areaBonus"],
  "reposition others": ["positionSwap", "positionSwapPull"],
  "planted/duration": ["statChangeOnHit", "statChangesOnHit", "p:terrainUnhindered", "p:dispersalSpeed"],
  healing: ["p:healAura", "p:regen", "p:regenFlat", "selfHeal", "gatherBurst"],
  "no friendly fire": ["excludesAllies"],
  rallying: ["rallyCall", "rallyCallTicks"],
  "ally buffing": ["targetsAlly", "allyEffect", "allyEffects", "allyEffectOnAttack", "p:aquaticHaste"],
  calming: ["p:calmingPresence", "p:nonTerritorial", "statusImmunityAura"],
  "resource economy": ["ppCost", "maxPPBonus", "selfCostPerUse", "drainNeeds"],
};
const flavourOf = new Map<string, string>();
for (const [f, ks] of Object.entries(FLAVOUR)) for (const k of ks) flavourOf.set(k, f);
const levers = (n: any) => [...new Set([
  ...Object.keys(n.delta ?? {}),
  ...(n.grantsPassive ? [`p:${n.grantsPassive.kind}`] : []),
  ...(n.grantsPassives ?? []).map((g: any) => `p:${g.kind}`),
])];

function report(m: any) {
  const t = m.tree, ns: any[] = Object.values(t);
  const cut = -ns.reduce((s, n) => s + Math.min(0, n.delta?.cooldownTicks ?? 0), 0);
  const floor = Math.max(0, m.cooldownTicks - cut);
  const cdFloor = Math.ceil((m.cooldownTicks + 1) / 3) - 1;
  const powGain = ns.reduce((s, n) => s + Math.max(0, n.delta?.power ?? 0), 0);
  const hitsMax = Math.max(1, ...ns.map((n) => (n.delta?.hitsBonus ? 1 + n.delta.hitsBonus : n.delta?.hits?.max ?? 1)));
  const all = new Set<string>(), fl = new Set<string>();
  for (const n of ns) for (const k of levers(n)) { all.add(k); const f = flavourOf.get(k); if (f) fl.add(f); }
  // Cheapest legal route to each terminal node.
  const memo = new Map<string, Set<string>>();
  const need = (id: string): Set<string> => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, new Set([id]));
    const n = t[id], acc = new Set([id]);
    for (const p of n?.prerequisites ?? []) for (const x of need(p)) acc.add(x);
    const sets = n?.prerequisitesAnyOf ?? [];
    if (sets.length) {
      let best: Set<string> | null = null;
      for (const set of sets) { const a = new Set<string>(); for (const p of set) for (const x of need(p)) a.add(x); if (!best || a.size < best.size) best = a; }
      for (const x of best!) acc.add(x);
    }
    memo.set(id, acc); return acc;
  };
  const terminal = ns.filter((n) => !ns.some((o) => (o.prerequisites ?? []).includes(n.id) || (o.prerequisitesAnyOf ?? []).some((s: string[]) => s.includes(n.id))));
  const caps = terminal.map((n) => [...need(n.id)].reduce((s, id) => s + (t[id]?.cost ?? 0), 0));
  return {
    id: m.id, nodes: ns.length, levers: all.size, flavours: fl.size,
    tempo: (m.cooldownTicks + 1) / (floor + 1),
    tempoCap: (m.cooldownTicks + 1) / (cdFloor + 1),
    power: m.power ? (m.power + powGain) / m.power : 1,
    hits: hitsMax,
    capstonePts: caps.length ? Math.min(...caps) : 0,
  };
}

const all = (Object.values(MOVES) as any[]).filter((m) => m.tree && Object.keys(m.tree).length).map(report);
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const M = {
  nodes: med(all.map((r) => r.nodes)), levers: med(all.map((r) => r.levers)), flavours: med(all.map((r) => r.flavours)),
  tempo: med(all.map((r) => r.tempo)), power: med(all.map((r) => r.power)), hits: med(all.map((r) => r.hits)),
  capstonePts: med(all.map((r) => r.capstonePts)),
};
const only = process.argv[2];
const rows = only ? all.filter((r) => r.id === only) : all;
console.log("move            nodes levers flav  tempo(cap)  power  hits  cheapest capstone");
for (const r of rows) {
  const flag = (v: number, m: number, tol = 0.35) => (Math.abs(v - m) / (m || 1) > tol ? " *" : "  ");
  console.log(
    `${r.id.padEnd(15)} ${String(r.nodes).padStart(3)}${flag(r.nodes, M.nodes)} ${String(r.levers).padStart(4)}${flag(r.levers, M.levers)} ${String(r.flavours).padStart(3)}${flag(r.flavours, M.flavours)} ` +
    `${r.tempo.toFixed(2)}x(${r.tempoCap.toFixed(2)})${r.tempo > r.tempoCap + 0.001 ? " OVER" : "    "} ${r.power.toFixed(2)}x ${r.hits.toFixed(1)}x ${String(r.capstonePts).padStart(6)} pts${flag(r.capstonePts, M.capstonePts)}`
  );
}
console.log(`\nroster median   ${String(M.nodes).padStart(3)}   ${String(M.levers).padStart(4)}   ${String(M.flavours).padStart(3)}   ${M.tempo.toFixed(2)}x        ${M.power.toFixed(2)}x ${M.hits.toFixed(1)}x ${String(M.capstonePts).padStart(6)} pts`);
console.log(`  * = more than 35% off the roster median. OVER = past the 3x tempo cap.`);
console.log(`  Levers below ~20 usually means an under-explored fantasy, not a small move.`);
