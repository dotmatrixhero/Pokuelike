import type { RapportMemory, RapportReason } from "./types.js";
import { notableRapportMemories } from "./rapport.js";
import type { Agent } from "./types.js";

/**
 * The one place a relationship gets turned into a sentence.
 *
 * Lives in the engine rather than in `packages/web` — where the rest of this
 * project's prose lives (`eventText.ts`) — for one reason: the runner's
 * validators need it too, and it had already been copy-pasted into two
 * scripts before this file existed. One renderer, one set of rules, so a fix
 * lands everywhere at once.
 *
 * **The rules, which took four rejected rewrites to arrive at** (they are
 * also recorded in CLAUDE.md, since the failure mode was mine and it
 * repeated):
 *
 * 1. **Plain declarative sentences.** The spec is a model sentence given
 *    directly: *"We defeated a foe Onix together. She has defended me."* Not
 *    fragments, not a comma-dump of every fact.
 * 2. **If a word is vague, the data is missing.** Earlier drafts wrote
 *    "something had hold of me" and "it was none of our herd" because the
 *    predator's species and the dead agent's standing were not being
 *    recorded. Both were in scope at the call site the whole time. Go get the
 *    value rather than writing around the hole.
 * 3. **Name things, and say what they are to you** — friend or foe, real
 *    gendered pronouns (`Agent.sex` is set on essentially every agent),
 *    species as proper nouns.
 * 4. **No ornament.** No "besides", no "in front of us", no literary
 *    connectives. If a phrase sounds like writing, cut it.
 * 5. **Two sentences at most.** Printing every reason is a table with commas;
 *    `notableRapportMemories` already ranks them, so trust it.
 */

const NUMBERS = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

/** A plain spelled cardinal — "three", not "3". A digit reads as a database field. */
function count(n: number): string {
  return NUMBERS[n] ?? String(n);
}

/** Past twenty, "again and again" beats a number: nobody counting their own fights lands on "twenty-seven". */
function times(n: number): string {
  if (n === 1) return "once";
  if (n === 2) return "twice";
  if (n <= 20) return `${NUMBERS[n]} times`;
  return "again and again";
}

function properName(label: string | undefined, fallback: string): string {
  const raw = label ?? fallback;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

type Sex = "male" | "female" | undefined;

const subject = (sex: Sex) => (sex === "female" ? "She" : sex === "male" ? "He" : "They");
const lower = (sex: Sex) => subject(sex).toLowerCase();
const object = (sex: Sex) => (sex === "female" ? "her" : sex === "male" ? "him" : "them");
const possessive = (sex: Sex) => (sex === "female" ? "her" : sex === "male" ? "his" : "their");
/** Singular "they" takes plural agreement — "They are my mate", never "They is". */
const toBe = (sex: Sex) => (sex ? "is" : "are");
const toHave = (sex: Sex) => (sex ? "has" : "have");

/** "a foe Onix", "a friend Pidgey" — the standing goes in front of the name. */
function named(label: string | undefined, standing: string | undefined, fallback: string): string {
  const name = properName(label, fallback);
  const phrase = standing ? `${standing} ${name}` : name;
  return `${/^[aeiouAEIOU]/.test(phrase) ? "an" : "a"} ${phrase}`;
}

interface Clause {
  n: number;
  label?: string;
  standing?: "friend" | "foe";
  sex: Sex;
  /** True when an earlier sentence in the same line already named this creature — refer back instead of repeating it. */
  again: boolean;
}

const SENTENCE: Record<RapportReason, (c: Clause) => string> = {
  bonded: ({ sex }) => `${subject(sex)} ${toBe(sex)} my mate.`,
  rescued: ({ n, sex }) =>
    n <= 1 ? `I carried ${object(sex)} home when ${lower(sex)} could not walk.` : `I have carried ${object(sex)} home ${times(n)}.`,
  wasRescued: ({ n, sex }) =>
    n <= 1 ? `${subject(sex)} carried me home when I could not walk.` : `${subject(sex)} ${toHave(sex)} carried me home ${times(n)}.`,
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
  defended: ({ n, sex }) => (n <= 1 ? `I defended ${object(sex)}.` : `I have defended ${object(sex)} ${times(n)}.`),
  wasDefended: ({ n, sex }) =>
    n <= 1 ? `${subject(sex)} defended me.` : `${subject(sex)} ${toHave(sex)} defended me ${times(n)}.`,
  healed: ({ n, sex }) => (n <= 1 ? `I healed ${possessive(sex)} wounds.` : `I have healed ${object(sex)} ${times(n)}.`),
  wasHealed: ({ n, sex }) =>
    n <= 1 ? `${subject(sex)} healed my wounds.` : `${subject(sex)} ${toHave(sex)} healed me ${times(n)}.`,
  weatheredTogether: ({ n, label }) =>
    n <= 1
      ? `${properName(label, "The weather")} drove our herd out, and we left together.`
      : `We have been driven out together ${times(n)}.`,
  sleptSafely: ({ n, sex }) => (n <= 1 ? `I slept beside ${object(sex)}.` : `I have slept beside ${object(sex)} ${times(n)}.`),
  keptWatch: ({ n, sex }) =>
    n <= 1 ? `I watched over ${possessive(sex)} sleep.` : `I have watched over ${possessive(sex)} sleep ${times(n)}.`,
  struck: ({ n, sex }) =>
    n <= 1 ? `I fought ${object(sex)} over water.` : `I have fought ${object(sex)} ${times(n)} over water and feeding ground.`,
  wasStruck: ({ n, sex }) =>
    n <= 1
      ? `${subject(sex)} fought me over water.`
      : `${subject(sex)} ${toHave(sex)} fought me ${times(n)} over water and feeding ground.`,
  sharedWater: ({ n }) =>
    n <= 1 ? `We shared the same water without fighting.` : `We have shared the same water ${times(n)} without fighting.`,
  trainedTogether: ({ n }) => (n <= 1 ? `We trained together.` : `We have trained together for seasons.`),
  gaveFood: ({ n, sex }) => (n <= 1 ? `I brought ${object(sex)} food.` : `I have brought ${object(sex)} food ${times(n)}.`),
  receivedFood: ({ n, sex }) =>
    n <= 1 ? `${subject(sex)} brought me food.` : `${subject(sex)} ${toHave(sex)} brought me food ${times(n)}.`,
  socialized: ({ n }) => (n <= 1 ? `We have sat together.` : `We have kept each other company for seasons.`),
  // Only ever written on an accepted touch — see pet.ts's `applyPet` for why
  // the souring outcomes move the score without claiming this.
  petted: ({ n, sex }) => (n <= 1 ? `${subject(sex)} petted me.` : `${subject(sex)} ${toHave(sex)} petted me ${times(n)}.`),
  witnessedKindness: ({ n, sex, label, standing, again }) =>
    n <= 1
      ? `I watched ${object(sex)} feed ${again ? "another" : named(label, standing, "creature")}.`
      : `I have watched ${object(sex)} feed ${again ? "another" : named(label, standing, "creature")} ${times(n)}.`,
};

/** How many sentences a rendered relationship gets. See rule 5. */
export const RAPPORT_PROSE_SENTENCES = 2;

/**
 * Turns already-ranked memories into at most `limit` sentences. Pass
 * `otherSex` — the sex of the agent this relationship is *about*, not the one
 * remembering — so the pronouns are right.
 *
 * Never names the same creature twice in one line. An earlier version dropped
 * the duplicate sentence instead, which was worse: it threw away the best
 * line on the edge and fell back to filler. Refer back with "another".
 */
export function describeRapportMemories(memories: RapportMemory[], otherSex: Sex, limit = RAPPORT_PROSE_SENTENCES): string {
  const spoken = new Set<string>();
  return memories
    .slice(0, limit)
    .map((m) => {
      const label = m.subject?.label;
      const again = label !== undefined && spoken.has(label);
      if (label) spoken.add(label);
      return SENTENCE[m.reason]({ n: m.count, label, standing: m.subject?.standing, sex: otherSex, again });
    })
    .join(" ");
}

/**
 * The convenience form: what `agent` would say about `other`, ranked and
 * rendered. Empty string when there is no edge or it carries no memories —
 * an edge written before memories existed, or by a caller with no reason to
 * give.
 */
export function describeRapport(agent: Agent, other: Agent | undefined, otherId: string, limit = RAPPORT_PROSE_SENTENCES): string {
  const memories = notableRapportMemories(agent, otherId);
  if (memories.length === 0) return "";
  return describeRapportMemories(memories, other?.sex, limit);
}
