/**
 * What a creature's relationships actually look like, rendered the way a game
 * panel would show them — one agent, its herd, and everyone it has a real
 * history with. `validateRapportReasons.ts` answers "is the vocabulary
 * exercised"; this answers "does it read."
 *
 * The sentences come from the engine's `rapportProse.ts`, which is the one
 * renderer this project has — the same one the web inspector uses, so what
 * prints here is literally what shows in game.
 *
 * Run: `npx tsx packages/runner/src/showRelationships.ts [ticks] [seed] [howMany]`
 */
import { describeRapportMemories, EventLog, notableRapportMemories, rapportScore, tickWorld } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 6000);
const seed = Number(process.argv[3] ?? 11);
const howMany = Number(process.argv[4] ?? 8);

/** Species come out of the dex lowercased; they are names. */
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const who = `${title(a.species)} ${a.id}`;
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
    const label = other ? `${title(other.species)} ${r.id}` : r.id;
    const tag = gone ? " (dead)" : "";
    const score = `${r.score >= 0 ? "+" : "\u2212"}${Math.abs(r.score).toFixed(2)}`;
    console.log(`  ${(label + tag).padEnd(32)} ${score.padStart(5)}   ${describeRapportMemories(r.memories, other?.sex)}`);
  }
  console.log();
}
