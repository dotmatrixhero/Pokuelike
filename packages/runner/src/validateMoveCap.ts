/**
 * Does the four-move cap hold in a real run, and does the forget AI make
 * choices a person would defend?
 *
 * Controls throughout: a cap that "works" because nothing ever levelled is
 * not a working cap, and a forget AI that "keeps the best move" in a
 * population that only ever knows one move has proven nothing.
 *
 * Run: `npx tsx packages/runner/src/validateMoveCap.ts [ticks] [nSeeds]`
 */
import { EventLog, tickWorld, MAX_KNOWN_MOVES } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);
const nSeeds = Number(process.argv[3] ?? 4);

let agents = 0;
let overCap = 0;
let forgets = 0;
let declines = 0;
let refunded = 0;
let learned = 0;
let withStatus = 0;
let withDamage = 0;
const levels: number[] = [];
const known: number[] = [];
const wildcardHeld: number[] = [];
const forgottenWithInvestment: number[] = [];
const dropped = new Map<string, number>();
const reasons = new Map<string, number>();

for (let i = 0; i < nSeeds; i++) {
  const world: any = createDemoWorld(3000 + i * 7919);
  const log = new EventLog();
  for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

  for (const e of log.events as any[]) {
    if (e.kind === "learnedMove") learned++;
    if (e.kind !== "forgotMove") continue;
    forgets++;
    refunded += e.refundedPoints;
    if (e.reason === "declined") declines++;
    reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);
    if (e.refundedPoints > 0) forgottenWithInvestment.push(e.refundedPoints);
    dropped.set(e.moveId, (dropped.get(e.moveId) ?? 0) + 1);
  }

  for (const a of world.agents.filter((x: any) => x.alive !== false)) {
    agents++;
    const n = (a.knownMoves ?? []).length;
    known.push(n);
    levels.push(a.level ?? 1);
    wildcardHeld.push(a.wildcardSkillPoints ?? 0);
    const specs = (a.knownMoves ?? []).map((k: string) => (LEVELING_CONTEXT as any).resolveMove(k)).filter(Boolean);
    if (specs.some((m: any) => m.utilityMove)) withStatus++;
    if (specs.some((m: any) => m.power > 0 && !m.utilityMove)) withDamage++;
    if (n > MAX_KNOWN_MOVES) {
      overCap++;
      if (overCap <= 3) console.log(`  OVER CAP: ${a.species} lvl ${a.level} knows ${n}: ${(a.knownMoves ?? []).join(", ")}`);
    }
  }
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const max = (a: number[]) => (a.length ? Math.max(...a) : 0);

console.log(`${nSeeds} seeds x ${ticks} ticks, ${agents} living agents\n`);
console.log(`level (control)        mean ${mean(levels).toFixed(1)}  max ${max(levels)}   <-- a cap only binds if levels are reached`);
console.log(`moves learned (control) ${learned}                <-- and only if moves are actually learned`);
console.log(`knownMoves             mean ${mean(known).toFixed(2)}  max ${max(known)}  (cap ${MAX_KNOWN_MOVES})`);
console.log(`agents over the cap    ${overCap} of ${agents}`);
console.log(`\nforgets                ${forgets}  (${declines} were the NEW move being declined as not worth a slot)`);
console.log(`points refunded        ${refunded} total, ${forgets ? (refunded / forgets).toFixed(1) : 0} per forget`);
console.log(`  forgets that cost a built tree: ${forgottenWithInvestment.length} (${forgets ? ((100 * forgottenWithInvestment.length) / forgets).toFixed(1) : 0}%), biggest ${max(forgottenWithInvestment)} pts`);
console.log(`wildcard points held   mean ${mean(wildcardHeld).toFixed(1)}  max ${max(wildcardHeld)}   <-- refunds should be getting re-spent, not piling up`);
// The interaction that matters most right now: status moves were JUST made
// combat-usable, and a cap that quietly deletes all of them from every
// movepool would undo that without failing a single assertion. Measured, with
// damage moves as the control.
console.log(`\nwhy moves were given up:`);
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${r.padEnd(12)} ${n}`);

console.log(`\nstatus moves surviving the cap:`);
console.log(`  living agents knowing >=1 usable status move  ${withStatus} of ${agents} (${agents ? ((100 * withStatus) / agents).toFixed(1) : 0}%)`);
console.log(`  living agents knowing >=1 damage move         ${withDamage} of ${agents} (${agents ? ((100 * withDamage) / agents).toFixed(1) : 0}%)   <-- control`);

console.log(`\nmost-dropped moves:`);
for (const [id, n] of [...dropped].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${id.padEnd(18)} ${n}`);

let bad = 0;
if (overCap > 0) { console.error(`\nFAIL: ${overCap} living agents are over the ${MAX_KNOWN_MOVES}-move cap`); bad++; }
if (learned > 0 && forgets === 0) { console.error(`\nFAIL: ${learned} moves were learned and nothing was ever forgotten`); bad++; }
process.exit(bad ? 1 : 0);
