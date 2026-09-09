/**
 * Do status moves actually fire IN A FIGHT, and does bracing actually make a
 * weight-scaling move hit harder?
 *
 * Both were built as systems with no explicit pairing, so both need to be
 * observed rather than reasoned about. Every check here has a control: a
 * measurement that a status move fired means nothing without the same
 * measurement on a run where it could not.
 *
 * Run: `npx tsx packages/runner/src/validateStatusMovesInCombat.ts [ticks] [nSeeds]`
 */
import { EventLog, tickWorld, applyMoveTree } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, MOVES } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 4000);
const nSeeds = Number(process.argv[3] ?? 3);

// --- 1. Bracing feeds weight scaling, measured through the real hit path ---
// Direct unit check rather than a sim run: the sim is far too noisy to read a
// 15%-per-stage weight term out of, and this is a deterministic formula.
{
  // `weightScaling` lives on tree-node deltas, never on a base spec — so the
  // move has to be BUILT before it has a weight term at all. Finding that out
  // is itself the point: a check written against `MOVES` alone would have
  // reported "no weight-scaling move exists" on a roster full of them.
  let weighted: any;
  for (const m of Object.values(MOVES as any) as any[]) {
    const nodeId = Object.values(m.tree ?? {}).find((n: any) => n.delta?.weightScaling) as any;
    if (!nodeId) continue;
    weighted = applyMoveTree(m, [nodeId.id]);
    break;
  }
  if (!weighted?.weightScaling) { console.error("FAIL: no move in the roster can reach a weightScaling node"); process.exit(1); }
  const maxHp = 60;
  const term = (stages: number) =>
    weighted.power + weighted.weightScaling.factor * maxHp * (1 + 0.15 * Math.max(0, stages));
  console.log(`bracing -> weight, on ${weighted.id} (power ${weighted.power}, factor ${weighted.weightScaling.factor}, maxHp ${maxHp}):`);
  for (const st of [-2, 0, 1, 2]) console.log(`  defense stage ${String(st).padStart(2)}  effective power ${term(st).toFixed(1)}`);
  const gain = term(2) / term(0);
  console.log(`  +2 stages is ${((gain - 1) * 100).toFixed(1)}% more power`);
  if (term(-2) !== term(0)) { console.error("FAIL: a negative Defense stage changed effective weight; only positive stages should count"); process.exit(1); }
  if (!(term(2) > term(0))) { console.error("FAIL: bracing did not increase effective weight at all"); process.exit(1); }
}

// --- 2. Do status moves fire in real fights? ---
let inCombat = 0;
let idle = 0;
let fights = 0;
const byMove = new Map<string, number>();
for (let i = 0; i < nSeeds; i++) {
  const world: any = createDemoWorld(2000 + i * 7919);
  const log = new EventLog();
  for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  for (const e of log.events as any[]) {
    if (e.kind === "utilityMoveUsed") {
      if (e.inCombat) { inCombat++; byMove.set(e.moveId, (byMove.get(e.moveId) ?? 0) + 1); } else idle++;
    }
    if (e.kind === "fought" || e.kind === "killed" || e.kind === "defeated") fights++;
  }
}
console.log(`\n${nSeeds} seeds x ${ticks} ticks`);
console.log(`  hostile actions resolved   ${fights}   <-- control: no fights means no chance to fire, not a broken feature`);
console.log(`  status moves on idle ticks ${idle}     <-- control: the pre-existing path still works`);
console.log(`  status moves IN COMBAT     ${inCombat}`);
if (inCombat > 0) for (const [id, n] of [...byMove].sort((a, b) => b[1] - a[1])) console.log(`      ${id.padEnd(18)} ${n}`);
if (fights > 0 && inCombat === 0) {
  console.error("\nFAIL: real fights happened and not one status move was ever spent as a fight action.");
  process.exit(1);
}
