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
import { EventLog, notableRapportMemories, rapportMemories, tickWorld } from "@pokuelike/engine";
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

/**
 * How a relationship reads out loud.
 *
 * Rewritten after a blunt and correct note on the first version — *"your
 * phrasing is so stilted and weird"* — which produced lines like:
 *
 *   brought down 2 together, the largest a scyther, came through 3 deaths
 *   beside them, worst a scyther, was defended by them 20 times, fought for
 *   them 3 times, was driven out by hunger beside them
 *
 * Everything wrong with that is worth naming, because the fix is a rule each
 * time: no grammatical subject, so it reads as a dump; telegram-ese
 * appositives ("the largest a scyther"); lowercase species and a broken
 * article ("a onix"); voice flipping between active and passive inside one
 * line; and — the real problem — **it prints every reason.** Eight clauses of
 * equal length is not prose, it is a table with commas.
 *
 * The rules here:
 * 1. **Two clauses. Three at the very most.** Curation is the point.
 * 2. **Verb-first fragments**, so there is no pronoun tangle about who did
 *    what to whom, and the strong word lands first.
 * 3. **Species are proper nouns** — "an Onix", not "a onix".
 * 4. **Numbers only when the number is the point**, spelled as words at
 *    small values. Once or twice does not need a count.
 * 5. **Vary the length.** Heaviest clause leads, a short one follows.
 */

const NUMBERS = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
/** Sentence-initial capital, for a clause that opens on a number or a count. */
function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A plain spelled cardinal — "three", not "3". */
function count(n: number): string {
  return NUMBERS[n] ?? String(n);
}

/**
 * "twenty times", not "20 times" — a spelled number reads as speech, a digit
 * reads as a database field. Past twenty, "again and again" beats either:
 * nobody counting their own fights lands on "twenty-seven".
 */
function times(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  if (n <= 20) return `${NUMBERS[n]} times`;
  return "again and again";
}

/** Species come out of the dex lowercased; they are names. */
function nameOf(label: string | undefined, fallback: string): string {
  const raw = label ?? fallback;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** "an Onix", "a Scyther" — the broken article was half of why the old lines read wrong. */
function a(label: string | undefined, fallback: string): string {
  const name = nameOf(label, fallback);
  return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}`;
}

/**
 * One sentence per reason, **spoken by the agent whose edge this is, about
 * the other one.** Second rewrite: the first was a comma-dump, the second
 * over-corrected into clipped fragments — *"OK you over indexed in like
 * hyper succinct. That's not what I want either. Like watched three die
 * beside them sounds confusing and ominous?"* Both notes were right.
 *
 * The brief for this version: *"be a little more poetic and emotion driven?
 * Try to put yourself in the shoes of the Pokémon that lived through that
 * explaining what you've been through together. Take a little creative
 * liberty but not too much."*
 *
 * So:
 * - **First person, full sentences.** "We brought down a Scyther together",
 *   not "Killed a Scyther together". A relationship is spoken, not tabulated.
 * - **Say who or what**, always. "Three died within sight of us both" fixes
 *   the exact confusion in that note — the old line never said what died.
 * - **One feeling per sentence, carried by the facts.** "and I started most
 *   of it" is a real read of `struck` outweighing `wasStruck`, not a mood
 *   pasted on top.
 * - **Liberty only in the connective tissue.** Every noun, number and event
 *   is real. Nothing invents an event that did not happen — no "never left my
 *   side" on an edge that only knows a count.
 */
const CLAUSE: Record<RapportReason, (n: number, subject?: string, kin?: "ours" | "other") => string> = {
  rescued: (n) =>
    n <= 1 ? `I carried them home when they could not walk.` : `I have carried them home ${times(n)}.`,
  wasRescued: (n) =>
    n <= 1 ? `They carried me home when I could not walk.` : `They have carried me home ${times(n)}.`,
  mourned: (n) =>
    n <= 1 ? `We lost the same friend, and we were both there for it.` : `We have buried the same friends ${times(n)} now.`,
  defeatedTogether: (n, s) =>
    n <= 2
      ? `We brought down ${a(s, "creature")} together.`
      : `We have brought down ${count(n)} between us, one of them ${a(s, "creature")}.`,
  bonded: () => `We are mates.`,
  // "Three have died" was ambiguous in the way that mattered: foes or allies?
  // The subject now carries `kin`, so the sentence can just say.
  survivedTogether: (n, s, kin) =>
    kin === "ours"
      ? n <= 1
        ? `I watched one of our own die in front of us — ${a(s, "herd-mate")}.`
        : `${cap(count(n))} of our own have died in front of us, the last of them ${a(s, "herd-mate")}.`
      : n <= 1
        ? `I watched ${a(s, "creature")} die in front of us. Not one of ours.`
        : `${cap(count(n))} have died in front of us, the last of them ${a(s, "creature")}. None were ours.`,
  weatheredTogether: (n, s) =>
    n <= 1
      ? `${nameOf(s, "The weather")} drove us off our own ground, and we left together.`
      : `The world has driven us out together ${times(n)}.`,
  healed: (n) => (n <= 1 ? `I closed their wounds.` : `I have mended them through ${count(n)} bad stretches.`),
  wasHealed: (n) => (n <= 1 ? `They closed my wounds.` : `They have mended me through ${count(n)} bad stretches.`),
  // Was "stood between them and what was coming" / "put themselves in front of
  // me", which is euphemism — direct note: "put themselves in front sounds
  // like a euphemism... more specificity please." What the mechanic actually
  // is: a predator had locked onto a herd-mate, and this agent hit it.
  defended: (n) =>
    n <= 1
      ? `Something had hold of them, and I hit it until it let go.`
      : `${cap(times(n))} something has had hold of them, and ${times(n) === "twice" ? "both times" : "every time"} I hit it until it let go.`,
  wasDefended: (n) =>
    n <= 1
      ? `Something had hold of me, and they hit it until it let go.`
      : `${cap(times(n))} something has had hold of me, and ${times(n) === "twice" ? "both times" : "every time"} they drove it off.`,
  sleptSafely: (n) =>
    n <= 1 ? `I have slept where they could reach me.` : `I have slept beside them ${times(n)}.`,
  keptWatch: (n) =>
    n <= 1 ? `I stayed awake while they slept.` : `I have stayed awake through their sleep ${times(n)}.`,
  // No "and I started most of it" here, however well it read: this clause only
  // ever sees ONE side's count, so both halves of a mutual rivalry claimed to
  // have started it — a sentence the data cannot support. Liberty in the
  // connective tissue, never in the facts.
  struck: (n) =>
    n <= 1
      ? `We both wanted the same water, and I hit them for it.`
      : `We have wanted the same water ${times(n)}, and ${times(n) === "twice" ? "both times" : "every time"} I hit them for it.`,
  // Was "come at me", which said nothing about what the fight was over.
  wasStruck: (n) =>
    n <= 1 ? `We both wanted the same water, and they hit me for it.` : `They have hit me ${times(n)} over water and feeding-ground we both wanted.`,
  sharedWater: (n) =>
    n <= 1
      ? `We stood over the same water and neither of us started anything.`
      : `We have stood over the same water ${times(n)} without it coming to blows.`,
  trainedTogether: (n) =>
    n <= 1 ? `We practised side by side.` : `We spent whole seasons practising side by side.`,
  gaveFood: (n) => (n <= 1 ? `I brought them food.` : `I have brought them food ${times(n)}.`),
  receivedFood: (n) => (n <= 1 ? `They brought me food.` : `They have brought me food ${times(n)}.`),
  socialized: (n) =>
    n <= 1 ? `We have sat together.` : `We have spent seasons in each other's company.`,
};

/** At most `limit` clauses, most significant first, as one line. */
function describe(
  memories: { reason: RapportReason; count: number; subject?: { label: string; kin?: "ours" | "other" } }[],
  limit = 2,
): string {
  return memories
    .slice(0, limit)
    .map((m) => CLAUSE[m.reason](m.count, m.subject?.label, m.subject?.kin))
    .join(" ");
}

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
            `(${score >= 0 ? "+" : ""}${score.toFixed(2)}) ` + describe(notable as any),
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
