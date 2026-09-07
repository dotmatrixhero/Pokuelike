/**
 * Passive-healing balance validation.
 *
 * Exists because a direct worry — "heal over time will be too strong...
 * with all these stacking effects will users just be unkillable?" — turned
 * out to be measurably true. `grantPassive` accumulates permanently across
 * every node of every move a unit knows, with no cap, so a long-lived agent
 * trends toward the SUM of every regen node it can reach. Measured on a
 * 20k-tick run before the fix: 117 of 167 living agents carried regen, p90
 * 6%/tick, max 11% — a full heal every 9 ticks, mid-fight, forever.
 *
 * Two changes address it (status.ts): passive healing is gated on being out
 * of combat, and non-capstone nodes grant flat HP rather than a percentage.
 * Re-run this after touching either.
 *
 * Run: `npx tsx packages/runner/src/validatePassiveHealing.ts [ticks] [seed]`
 */
import { EventLog, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
const ticks = Number(process.argv[2] ?? 4000);
const seed = Number(process.argv[3] ?? 12345);
const world: any = createDemoWorld(seed);
const log = new EventLog();
let suppressed = 0, samples = 0;
for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  if (i % 100 === 0) for (const a of world.agents) if (a.alive !== false) { samples++; if ((a.regenSuppressedTicks ?? 0) > 0) suppressed++; }
}
const alive = world.agents.filter((a: any) => a.alive !== false);
const q = (arr: number[], p: number) => { const s=[...arr].sort((x,y)=>x-y); return s.length? s[Math.min(s.length-1, Math.floor(p*s.length))] : 0; };
for (const kind of ["regen","regenFlat","healAura"]) {
  const vals = alive.map((a: any) => a.passives?.[kind] ?? 0);
  const nz = vals.filter((v:number)=>v>0);
  console.log(kind.padEnd(10), `holders ${String(nz.length).padStart(3)}/${alive.length}`, `max ${Math.max(0,...vals).toFixed(3)}`, `p90 ${q(nz,0.9).toFixed(3)}`);
}
// effective %/tick of maxHp, combining flat and percent, for the worst offenders
const eff = alive.map((a:any)=>({sp:a.species, maxHp:a.maxHp,
  pct:(a.passives?.regen??0) + (a.passives?.regenFlat??0)/(a.maxHp||1)}));
eff.sort((x,y)=>y.pct-x.pct);
console.log("\ntop effective passive heal (%/tick of maxHp), when NOT suppressed:");
for(const e of eff.slice(0,5)) console.log(`  ${e.sp.padEnd(12)} ${(e.pct*100).toFixed(2)}%/tick  maxHp ${e.maxHp} => full heal in ${(1/e.pct).toFixed(0)} ticks`);
console.log(`\npassive healing suppressed in ${(100*suppressed/Math.max(1,samples)).toFixed(1)}% of agent-samples`);
const ev = (k:string)=>log.events.filter((e:any)=>e.kind===k).length;
console.log(`alive ${alive.length} | fought ${ev("fought")} killed ${ev("killed")} starved ${ev("starved")} burned ${ev("burned")} | kills/fight ${(ev("killed")/Math.max(1,ev("fought"))).toFixed(3)}`);
