/**
 * The Chronicle, as terminal text.
 *
 * All the interesting work — which moments are worth telling, how they are
 * worded, what gets thrown away — lives in the engine's `chronicle.ts`, so
 * this and the web app's Chronicle panel can never drift about what a herd's
 * story is. This file is only a renderer.
 *
 * Run: `npx tsx packages/runner/src/chronicle.ts [ticks] [seed]`
 */
import { EventLog, chronicleFor, notableStoriesFor, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, SPECIES } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);
const seed = Number(process.argv[3] ?? 24757);

const world: any = createDemoWorld(seed);
const log = new EventLog();
for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

const speciesInfo = (id: string) => (SPECIES as any)[id];
const stories = chronicleFor(world, log.events, { speciesInfo });
const notables = notableStoriesFor(world, log.events, { speciesInfo });

console.log(`# Chronicle — seed ${seed}, ${ticks} ticks\n`);
console.log(`${Object.keys(world.herds ?? {}).length} herds lived here; ${stories.length} amounted to enough to have a story.`);

for (const story of stories) {
  const { herd } = story;
  const ended = herd.dissolvedTick !== undefined ? `died out t${herd.dissolvedTick}` : "still going";
  console.log(`\n## ${herd.name.replace(/^the /, "The ")}`);
  console.log(`_peak ${herd.peakSize} · founded t${herd.foundedTick} · ${ended}_\n`);
  for (const beat of story.beats) console.log(`- **t${beat.tick}** — ${beat.text}`);
  if (story.untold > 0) console.log(`- _(${story.untold} lesser moments not told)_`);
}

if (notables.length > 0) {
  console.log(`\n\n# The Notables\n`);
  for (const n of notables) {
    console.log(`\n## ${n.label} — ${n.name}`);
    const of = n.herd ? ` of ${n.herd.name}` : "";
    const article = /^[AEIOU]/.test(n.species) ? "an" : "a";
    console.log(`_${article} ${n.species}${of}, crowned t${n.tick}${n.usurpation ? `, ${n.usurpation}` : ""}_\n`);
    console.log(n.tale);
    if (n.predecessors.length > 0) console.log(`\nBefore them the title was held by ${n.predecessors.join(", ")}.`);
  }
}
