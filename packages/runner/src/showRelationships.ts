/**
 * What a creature's relationships actually look like, rendered the way a game
 * panel would show them — one agent, its herd, and everyone it has a real
 * history with. `validateRapportReasons.ts` answers "is the vocabulary
 * exercised"; this answers "does it read."
 *
 * Prose rules are the ones in CLAUDE.md's "Generated prose" section: plain
 * declaratives, friend/foe, real pronouns, no ornament, two sentences at
 * most.
 *
 * Run: `npx tsx packages/runner/src/showRelationships.ts [ticks] [seed] [howMany]`
 */
import { EventLog, notableRapportMemories, rapportScore, tickWorld } from "@pokuelike/engine";
import type { RapportReason } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 6000);
const seed = Number(process.argv[3] ?? 11);
const howMany = Number(process.argv[4] ?? 8);

const NUMBERS = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];
const count = (n: number) => NUMBERS[n] ?? String(n);
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : n <= 20 ? `${NUMBERS[n]} times` : "again and again");
const nameOf = (l: string | undefined, f: string) => {
  const raw = l ?? f;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};
const subj = (s?: string) => (s === "female" ? "She" : s === "male" ? "He" : "They");
const low = (s?: string) => subj(s).toLowerCase();
const obj = (s?: string) => (s === "female" ? "her" : s === "male" ? "him" : "them");
const poss = (s?: string) => (s === "female" ? "her" : s === "male" ? "his" : "their");
const isV = (s?: string) => (s ? "is" : "are");
const hasV = (s?: string) => (s ? "has" : "have");
function named(label: string | undefined, standing: string | undefined, fallback: string): string {
  const word = standing ? `${standing} ${nameOf(label, fallback)}` : nameOf(label, fallback);
  return `${/^[aeiouAEIOU]/.test(word) ? "an" : "a"} ${word}`;
}

type Ctx = { n: number; label?: string; standing?: string; sex?: string; again?: boolean };
const CLAUSE: Record<RapportReason, (c: Ctx) => string> = {
  bonded: ({ sex }) => `${subj(sex)} ${isV(sex)} my mate.`,
  rescued: ({ n, sex }) =>
    n <= 1 ? `I carried ${obj(sex)} home when ${low(sex)} could not walk.` : `I have carried ${obj(sex)} home ${times(n)}.`,
  wasRescued: ({ n, sex }) =>
    n <= 1 ? `${subj(sex)} carried me home when I could not walk.` : `${subj(sex)} ${hasV(sex)} carried me home ${times(n)}.`,
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
  wasDefended: ({ n, sex }) => (n <= 1 ? `${subj(sex)} defended me.` : `${subj(sex)} ${hasV(sex)} defended me ${times(n)}.`),
  healed: ({ n, sex }) => (n <= 1 ? `I healed ${poss(sex)} wounds.` : `I have healed ${obj(sex)} ${times(n)}.`),
  wasHealed: ({ n, sex }) => (n <= 1 ? `${subj(sex)} healed my wounds.` : `${subj(sex)} ${hasV(sex)} healed me ${times(n)}.`),
  weatheredTogether: ({ n, label }) =>
    n <= 1 ? `${nameOf(label, "The weather")} drove our herd out, and we left together.` : `We have been driven out together ${times(n)}.`,
  sleptSafely: ({ n, sex }) => (n <= 1 ? `I slept beside ${obj(sex)}.` : `I have slept beside ${obj(sex)} ${times(n)}.`),
  keptWatch: ({ n, sex }) => (n <= 1 ? `I watched over ${poss(sex)} sleep.` : `I have watched over ${poss(sex)} sleep ${times(n)}.`),
  struck: ({ n, sex }) =>
    n <= 1 ? `I fought ${obj(sex)} over water.` : `I have fought ${obj(sex)} ${times(n)} over water and feeding ground.`,
  wasStruck: ({ n, sex }) =>
    n <= 1 ? `${subj(sex)} fought me over water.` : `${subj(sex)} ${hasV(sex)} fought me ${times(n)} over water and feeding ground.`,
  sharedWater: ({ n }) =>
    n <= 1 ? `We shared the same water without fighting.` : `We have shared the same water ${times(n)} without fighting.`,
  trainedTogether: ({ n }) => (n <= 1 ? `We trained together.` : `We have trained together for seasons.`),
  gaveFood: ({ n, sex }) => (n <= 1 ? `I brought ${obj(sex)} food.` : `I have brought ${obj(sex)} food ${times(n)}.`),
  receivedFood: ({ n, sex }) => (n <= 1 ? `${subj(sex)} brought me food.` : `${subj(sex)} ${hasV(sex)} brought me food ${times(n)}.`),
  socialized: ({ n }) => (n <= 1 ? `We have sat together.` : `We have kept each other company for seasons.`),
};

function describe(memories: any[], sex?: string, limit = 2): string {
  const spoken = new Set<string>();
  return memories
    .slice(0, limit)
    .map((m) => {
      const label = m.subject?.label;
      const again = label !== undefined && spoken.has(label);
      if (label) spoken.add(label);
      return CLAUSE[m.reason as RapportReason]({ n: m.count, label, standing: m.subject?.standing, sex, again });
    })
    .join(" ");
}

// --- run ---
const world: any = createDemoWorld(seed);
const log = new EventLog();
for (let i = 0; i < ticks; i++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

const byId = new Map<string, any>(world.agents.map((a: any) => [a.id, a]));
const alive = world.agents.filter((a: any) => a.alive !== false && !a.isEgg);

// The most socially connected survivors — the ones with a story to tell.
const cast = alive
  .map((a: any) => ({ a, edges: Object.keys(a.rapport ?? {}).length }))
  .filter((r: any) => r.edges > 0)
  .sort((x: any, y: any) => y.edges - x.edges)
  .slice(0, howMany);

console.log(`\nSeed ${seed}, ${ticks} ticks. ${alive.length} alive.\n`);

for (const { a } of cast) {
  const herd = a.herdId ? world.herds?.[a.herdId] : undefined;
  const who = `${nameOf(a.species, "creature")} ${a.id}`;
  const bits = [`level ${a.level ?? "?"}`, a.sex ?? "genderless"];
  if (a.notableTitle) bits.push(`THE ${String(a.notableTitle).toUpperCase()}`);

  console.log(`${"─".repeat(76)}`);
  console.log(`${who}   ${bits.join(" · ")}`);
  if (herd) console.log(`${herd.name}`);
  console.log();

  const rows = Object.keys(a.rapport ?? {})
    .map((id) => ({ id, score: rapportScore(a, id, world.tick), memories: notableRapportMemories(a, id) }))
    .filter((r) => r.memories.length > 0)
    .sort((x, y) => Math.abs(y.score) - Math.abs(x.score));

  for (const r of rows) {
    const other = byId.get(r.id);
    const gone = !other || other.alive === false;
    const label = other ? `${nameOf(other.species, "creature")} ${r.id}` : r.id;
    const tag = gone ? " (dead)" : "";
    const score = `${r.score >= 0 ? "+" : "\u2212"}${Math.abs(r.score).toFixed(2)}`;
    console.log(`  ${(label + tag).padEnd(32)} ${score.padStart(5)}   ${describe(r.memories, other?.sex)}`);
  }
  console.log();
}
