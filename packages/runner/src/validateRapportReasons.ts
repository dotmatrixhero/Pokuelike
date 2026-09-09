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

/**
 * "an Onix", "a Scyther" — the broken article was half of why the old lines
 * read wrong. `repeated` is for the second clause in a line that would name
 * the same creature again: "We brought down a Scyther together. They have
 * pulled a Scyther off me" reads as a stutter or a bug, while "pulled another
 * off me" refers back the way speech does.
 */
function a(label: string | undefined, fallback: string, repeated = false): string {
  if (repeated) return "another";
  const name = nameOf(label, fallback);
  return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name}`;
}

/**
 * One sentence per reason, spoken by the agent whose edge this is, about the
 * other one.
 *
 * **Fourth rewrite, and the notes that got here are worth keeping**, because
 * every earlier version failed the same way — reaching for literary phrasing
 * instead of saying the plain thing:
 *
 * 1. *"your phrasing is so stilted and weird"* — a comma-dump of every reason.
 * 2. *"you over indexed in like hyper succinct"* — clipped fragments.
 * 3. *"put themselves in front sounds like a euphemism... more specificity"*
 *    — vague verbs standing in for data I had not bothered to record.
 * 4. *"Get rid of it was none of herd. Just say foe or friend."* /
 *    *"And four things besides? Wtf does that mean"* — ornament that carried
 *    no information at all.
 *
 * The spec is the model sentence in that last note:
 *
 *   "We defeated a foe Onix together. She has defended me."
 *
 * Plain declarative sentences. A `friend`/`foe` label rather than a
 * circumlocution. Real gendered pronouns — `Agent.sex` is set on essentially
 * every agent in a real run, so there is no reason to write "they". Nothing
 * decorative: no "besides", no "had hold of", no "in front of us".
 */

/** `Agent.sex` is set on nearly every agent, so use it. Genderless species fall back to they/them. */
function subj(sex?: "male" | "female"): string {
  return sex === "female" ? "She" : sex === "male" ? "He" : "They";
}
function obj(sex?: "male" | "female"): string {
  return sex === "female" ? "her" : sex === "male" ? "him" : "them";
}
function poss(sex?: "male" | "female"): string {
  return sex === "female" ? "her" : sex === "male" ? "his" : "their";
}
/** Singular "they" takes plural agreement — "They are my mate", never "They is". */
function isVerb(sex?: "male" | "female"): string {
  return sex ? "is" : "are";
}
function hasVerb(sex?: "male" | "female"): string {
  return sex ? "has" : "have";
}
/** The subject pronoun in mid-sentence position — "she", not "She". */
function subjLower(sex?: "male" | "female"): string {
  return subj(sex).toLowerCase();
}
/** "a foe Onix" / "a friend Pidgey" — the label the note asked for, in front of the name. */
function named(label: string | undefined, standing: "friend" | "foe" | undefined, fallback: string): string {
  const name = nameOf(label, fallback);
  const word = standing ? `${standing} ${name}` : name;
  return `${/^[aeiouAEIOU]/.test(word) ? "an" : "a"} ${word}`;
}

type Ctx = { n: number; label?: string; standing?: "friend" | "foe"; sex?: "male" | "female"; again?: boolean };

const CLAUSE: Record<RapportReason, (c: Ctx) => string> = {
  bonded: ({ sex }) => `${subj(sex)} ${isVerb(sex)} my mate.`,
  rescued: ({ n, sex }) =>
    n <= 1 ? `I carried ${obj(sex)} home when ${subjLower(sex)} could not walk.` : `I have carried ${obj(sex)} home ${times(n)}.`,
  wasRescued: ({ n, sex }) =>
    n <= 1 ? `${subj(sex)} carried me home when I could not walk.` : `${subj(sex)} ${hasVerb(sex)} carried me home ${times(n)}.`,
  mourned: ({ n }) => (n <= 1 ? `We mourned a friend together.` : `We have mourned ${count(n)} friends together.`),
  defeatedTogether: ({ n, label, standing, again }) =>
    n <= 2
      ? `We defeated ${again ? "another" : named(label, standing ?? "foe", "creature")} together.`
      : `We have defeated ${count(n)} foes together, one of them ${named(label, undefined, "creature")}.`,
  survivedTogether: ({ n, label, standing, again }) =>
    n <= 1
      ? `We watched ${again ? "another" : named(label, standing, "creature")} die.`
      : standing === "friend"
        ? `We have watched ${count(n)} friends die.`
        : `We have watched ${count(n)} foes die.`,
  defended: ({ n, sex }) => (n <= 1 ? `I defended ${obj(sex)}.` : `I have defended ${obj(sex)} ${times(n)}.`),
  wasDefended: ({ n, sex }) => (n <= 1 ? `${subj(sex)} defended me.` : `${subj(sex)} ${hasVerb(sex)} defended me ${times(n)}.`),
  healed: ({ n, sex }) => (n <= 1 ? `I healed ${poss(sex)} wounds.` : `I have healed ${obj(sex)} ${times(n)}.`),
  wasHealed: ({ n, sex }) => (n <= 1 ? `${subj(sex)} healed my wounds.` : `${subj(sex)} ${hasVerb(sex)} healed me ${times(n)}.`),
  weatheredTogether: ({ n, label }) =>
    n <= 1 ? `${nameOf(label, "The weather")} drove our herd out, and we left together.` : `We have been driven out together ${times(n)}.`,
  sleptSafely: ({ n, sex }) => (n <= 1 ? `I slept beside ${obj(sex)}.` : `I have slept beside ${obj(sex)} ${times(n)}.`),
  keptWatch: ({ n, sex }) => (n <= 1 ? `I watched over ${poss(sex)} sleep.` : `I have watched over ${poss(sex)} sleep ${times(n)}.`),
  struck: ({ n, sex }) => (n <= 1 ? `I fought ${obj(sex)} over water.` : `I have fought ${obj(sex)} ${times(n)} over water and feeding ground.`),
  wasStruck: ({ n, sex }) => (n <= 1 ? `${subj(sex)} fought me over water.` : `${subj(sex)} ${hasVerb(sex)} fought me ${times(n)} over water and feeding ground.`),
  sharedWater: ({ n, sex }) =>
    n <= 1 ? `We shared the same water without fighting.` : `We have shared the same water ${times(n)} without fighting.`,
  trainedTogether: ({ n }) => (n <= 1 ? `We trained together.` : `We have trained together for seasons.`),
  gaveFood: ({ n, sex }) => (n <= 1 ? `I brought ${obj(sex)} food.` : `I have brought ${obj(sex)} food ${times(n)}.`),
  receivedFood: ({ n, sex }) => (n <= 1 ? `${subj(sex)} brought me food.` : `${subj(sex)} ${hasVerb(sex)} brought me food ${times(n)}.`),
  socialized: ({ n, sex }) => (n <= 1 ? `We have sat together.` : `We have kept each other company for seasons.`),
};

/** At most `limit` sentences, most significant first. */
function describe(
  memories: { reason: RapportReason; count: number; subject?: { label: string; standing?: "friend" | "foe" } }[],
  sex: "male" | "female" | undefined,
  limit = 2,
): string {
  // Never name the same creature twice in one breath. An earlier attempt at
  // this DROPPED the duplicate clause, which was worse: it threw away the
  // best line on the edge and fell back to filler. Refer back instead.
  const spoken = new Set<string>();
  return memories
    .slice(0, limit)
    .map((m) => {
      const label = m.subject?.label;
      const again = label !== undefined && spoken.has(label);
      if (label) spoken.add(label);
      return CLAUSE[m.reason]({ n: m.count, label, standing: m.subject?.standing, sex, again });
    })
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
            `(${score >= 0 ? "+" : ""}${score.toFixed(2)}) ` + describe(notable as any, other?.sex),
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
