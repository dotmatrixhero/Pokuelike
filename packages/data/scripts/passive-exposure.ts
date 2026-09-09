/**
 * Cross-tree passive exposure per species.
 *
 *   npx tsx packages/data/scripts/passive-exposure.ts
 *
 * `grantPassive` does `agent.passives[kind] += value` with no cap, and an
 * agent spends points across the trees of EVERY move it knows — so the real
 * exposure is not per tree, it is the sum over a species' whole movepool.
 * Nothing else in this repo checks that: check-proposed-trees.ts and
 * tree-balance.ts are both per-tree and cannot see it.
 *
 * This already bit once ("with all these stacking effects will users just be
 * unkillable?" — measured at 11%/tick max regen, a full heal every 9 ticks)
 * and `softCapHealShare` was added in response. That cap covers healing ONLY.
 * damageReduction, thorns, defenseBoost and the rest still stack linearly.
 */
import { MOVES, SPECIES, LEVELING_CONTEXT } from "../src/index.js";

const resolve = (k: string) => (LEVELING_CONTEXT as any).resolveMove(String(k)) ?? (MOVES as any)[String(k)];
const HEAL = new Set(["regen", "regenFlat", "healAura"]);

const rows: any[] = [];
for (const sp of Object.values(SPECIES) as any[]) {
  const totals = new Map<string, number>();
  for (const key of sp.moves ?? []) {
    const move: any = resolve(key);
    if (!move?.tree) continue;
    for (const n of Object.values(move.tree) as any[]) {
      const grants = [...(n.grantsPassive ? [n.grantsPassive] : []), ...(n.grantsPassives ?? [])];
      for (const g of grants) totals.set(g.kind, (totals.get(g.kind) ?? 0) + g.value);
    }
  }
  if (!totals.size) continue;
  const healFrac = (totals.get("regen") ?? 0) + (totals.get("healAura") ?? 0);
  rows.push({ id: sp.id, totals, healFrac, dr: totals.get("damageReduction") ?? 0, thorns: totals.get("thorns") ?? 0, calm: totals.get("calmingPresence") ?? 0 });
}

console.log("Worst-case passive totals if a species takes EVERY passive node across its whole movepool.\n");
console.log("species        regen+aura  dmgReduction  thorns  defBoost  every kind");
for (const r of rows.sort((a, b) => b.dr - a.dr).slice(0, 12)) {
  const kinds = [...r.totals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v as number).toFixed(2)}`).join(", ");
  console.log(
    `${r.id.padEnd(14)} ${(r.healFrac * 100).toFixed(1).padStart(9)}% ${(r.dr * 100).toFixed(0).padStart(12)}% ${(r.thorns * 100).toFixed(0).padStart(6)}% ` +
    `${String((r.totals.get("defenseBoost") ?? 0).toFixed(1)).padStart(8)}  ${kinds.slice(0, 60)}`
  );
}
const worstDR = Math.max(...rows.map((r) => r.dr));
const worstHeal = Math.max(...rows.map((r) => r.healFrac));
const worstThorns = Math.max(...rows.map((r) => r.thorns));
console.log(`\nworst case across ${rows.length} species:`);
console.log(`  damageReduction ${(worstDR * 100).toFixed(0)}%  ${worstDR >= 1 ? "<-- IMMUNE. UNCAPPED." : worstDR > 0.5 ? "<-- over half of all damage, uncapped" : ""}`);
console.log(`  thorns          ${(worstThorns * 100).toFixed(0)}%  ${worstThorns > 0.5 ? "<-- reflects more than half the hit, uncapped" : ""}`);
console.log(`  regen + aura    ${(worstHeal * 100).toFixed(1)}%/tick raw — softCapHealShare bends this one; nothing bends the others.`);

// `calmingPresence` has a HARD CLIFF the other passives don't, and it is easy
// to miss: herdConflict.ts's `calmingMultiplier` does `Math.max(0, 1 -
// strongest)`, where `strongest` is one agent's SUMMED total. It does not
// stack across agents, but it absolutely stacks within one — so a species
// whose movepool totals 1.0 reduces every nearby rivalry-escalation chance to
// exactly zero, for both sides, permanently. That is not a strong passive, it
// is a switch that turns off a whole mechanic in a radius.
const calmRows = rows.filter((r: any) => r.calm > 0).sort((a: any, b: any) => b.calm - a.calm);
if (calmRows.length) {
  console.log("\ncalmingPresence (herd-conflict escalation multiplier is 1 - total; at 1.0 conflict near this agent is OFF)");
  for (const r of calmRows.slice(0, 8)) {
    const flag = r.calm >= 1 ? "  <-- CONFLICT DISABLED" : r.calm >= 0.5 ? "  <-- halves escalation" : "";
    console.log(`  ${String(r.id).padEnd(14)} ${r.calm.toFixed(2)}${flag}`);
  }
  const worst = calmRows[0].calm;
  console.log(`  worst ${worst.toFixed(2)} of the 1.00 cliff (${((100 * worst) / 1).toFixed(0)}% of the way there)`);
}
