/**
 * Live-run check on rapport MEMORIES — the reasons half of a relationship,
 * added because `RapportEdge` was `{score, lastInteractionTick}` and could
 * therefore report outcomes but never causes (see EMERGENT_SITUATIONS.md).
 *
 * The question this answers is not "does the field populate" (a unit test
 * covers that) but the design one: **over a real run, do the reasons read as
 * a story, and does the vocabulary actually get exercised?** A reason kind
 * that never fires in thousands of ticks is unreachable content, which this
 * project treats as a bug rather than a curiosity.
 *
 * Run: `npx tsx packages/runner/src/validateRapportReasons.ts [ticks] [seed]`
 */
import { describeRapportMemories, EventLog, notableRapportMemories, rapportMemories, tickWorld } from "@pokuelike/engine";
import type { RapportReason } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 6000);
const seeds = process.argv[3] ? [Number(process.argv[3])] : [11, 202, 3003, 40404];

/** Every reason the engine can record, so a never-fired one shows as a zero row rather than an absent one. */
const ALL_REASONS: RapportReason[] = [
  "gaveFood",
  "receivedFood",
  "defended",
  "wasDefended",
  "struck",
  "wasStruck",
  "socialized",
  "bonded",
  "sharedWater",
  "trainedTogether",
  "keptWatch",
  "sleptSafely",
  "survivedTogether",
  "mourned",
  "defeatedTogether",
  "weatheredTogether",
  "rescued",
  "wasRescued",
  "healed",
  "wasHealed",
];

const totals: Record<string, number> = Object.fromEntries(ALL_REASONS.map((r) => [r, 0]));
/** Raw occurrences behind the milestones — how the table WOULD read untrottled. */
const rawTotals: Record<string, number> = Object.fromEntries(ALL_REASONS.map((r) => [r, 0]));
let edgeTotal = 0;
let edgesWithMemory = 0;
let edgesMultiReason = 0;
let mixedValence = 0;
let curationChangedLead = 0;
let edgesWithSharedExperience = 0;
/** The shared-experience group — "what we went through", as opposed to "what I did to you". */
const SHARED = new Set<RapportReason>([
  "sharedWater", "trainedTogether", "keptWatch", "sleptSafely", "survivedTogether", "mourned",
  "defeatedTogether", "weatheredTogether",
]);
const sampleLines: string[] = [];

for (const seed of seeds) {
  const world: any = createDemoWorld(seed);
  const log = new EventLog();
  for (let i = 0; i < ticks; i++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  }

  const alive = world.agents.filter((a: any) => a.alive !== false && !a.isEgg);
  const byId = new Map<string, any>(world.agents.map((a: any) => [a.id, a]));

  for (const agent of alive) {
    for (const otherId of Object.keys(agent.rapport ?? {})) {
      edgeTotal++;
      const memories = rapportMemories(agent, otherId);
      const notable = notableRapportMemories(agent, otherId);
      if (!memories.length) continue;
      edgesWithMemory++;
      if (memories.length > 1) edgesMultiReason++;

      const positive = memories.some((m) => m.reason !== "struck" && m.reason !== "wasStruck");
      const negative = memories.some((m) => m.reason === "struck" || m.reason === "wasStruck");
      if (memories.some((m) => SHARED.has(m.reason))) edgesWithSharedExperience++;
      if (positive && negative) mixedValence++;

      for (const m of memories) {
        totals[m.reason] = (totals[m.reason] ?? 0) + m.count;
        rawTotals[m.reason] = (rawTotals[m.reason] ?? 0) + (m.occurrences ?? m.count);
      }
      if (memories.length > 1 && memories[0]!.reason !== notable[0]!.reason) curationChangedLead++;

      // Keep a handful of the richest edges (most distinct reasons, then most
      // total events) to eyeball — the actual deliverable of this script.
      if (sampleLines.length < 400) {
        const other = byId.get(otherId);
        const score = agent.rapport[otherId].score as number;
        const events = memories.reduce((s, m) => s + m.count, 0);
        sampleLines.push(
          [
            String(memories.length).padStart(2),
            String(events).padStart(4),
            `seed ${seed} · ${agent.species} ${agent.id.slice(0, 8)} → ${other?.species ?? "?"} ${otherId.slice(0, 8)}`,
            `(${score >= 0 ? "+" : ""}${score.toFixed(2)}) ` + describeRapportMemories(notable, other?.sex),
          ].join("\t")
        );
      }
    }
  }
}

console.log(`=== rapport reasons over ${seeds.length} seeds x ${ticks} ticks ===\n`);

console.log("reason vocabulary exercised (memories, i.e. after throttling):");
const grand = Object.values(totals).reduce((a, b) => a + b, 0);
const rawGrand = Object.values(rawTotals).reduce((a, b) => a + b, 0);
console.log("  reason           memories   share      raw   raw share");
for (const reason of ALL_REASONS) {
  const n = totals[reason] ?? 0;
  const raw = rawTotals[reason] ?? 0;
  const share = grand > 0 ? ((n / grand) * 100).toFixed(1) : "0.0";
  const rawShare = rawGrand > 0 ? ((raw / rawGrand) * 100).toFixed(1) : "0.0";
  const flag = n === 0 ? "   <-- NEVER FIRED (unreachable content)" : "";
  console.log(
    `  ${reason.padEnd(14)} ${String(n).padStart(8)}  ${share.padStart(5)}%  ${String(raw).padStart(7)}  ${rawShare.padStart(6)}%${flag}`
  );
}

console.log(
  `\nedges: ${edgeTotal} total, ${edgesWithMemory} carry a reason ` +
    `(${edgeTotal ? ((edgesWithMemory / edgeTotal) * 100).toFixed(1) : "0"}%), ` +
    `${edgesMultiReason} have more than one, ${mixedValence} mix a positive reason with a grudge`
);
console.log(
  `shared experience: ${edgesWithSharedExperience}/${edgeTotal} edges carry at least one ` +
    `(${edgeTotal ? ((edgesWithSharedExperience / edgeTotal) * 100).toFixed(1) : "0"}%)`
);
console.log(
  `curation: on ${curationChangedLead}/${edgesMultiReason} multi-reason edges ` +
    `(${edgesMultiReason ? ((curationChangedLead / edgesMultiReason) * 100).toFixed(1) : "0"}%), ` +
    `notableRapportMemories leads with a different reason than raw count would`
);

// Richest first — the most-layered relationships are the ones worth reading.
sampleLines.sort((a, b) => {
  const [ar, ae] = a.split("\t");
  const [br, be] = b.split("\t");
  return Number(br) - Number(ar) || Number(be) - Number(ae);
});
console.log(`\n=== the 20 most layered relationships in these runs ===`);
for (const line of sampleLines.slice(0, 20)) {
  const parts = line.split("\t");
  console.log(`  ${parts[2]}\n      ${parts[3]}`);
}
