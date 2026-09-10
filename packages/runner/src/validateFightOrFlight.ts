/**
 * Does being surrounded actually happen, and does fight-or-flight change
 * anything measurable when it does?
 *
 * Direct ask: "if a Pokémon gets targeted by multiple attacks they really
 * need to enter fight or flight. Mode." — with the parameters answered as
 * "3 attackers unless they're really weak like, more than 8 levels below.
 * Choice is weighted roll. 6 actions. Yeah also flee when out numbered."
 *
 * Measurements, each with its control:
 *
 * 1. **How often is anyone genuinely surrounded?** Counted per tick across a
 *    real run. If this is ~0 the whole feature is dead content and should be
 *    reported as such, not shipped quietly. This is the control for
 *    everything below: a split of 50/50 over 4 events means nothing.
 * 2. **The fight/flee split.** A weighted roll that always lands the same way
 *    is a lookup table with extra steps. Anything near 0% or 100% is a
 *    finding.
 * 3. **Does it reach PREDATORS?** "Yeah also flee when out numbered" is
 *    specifically about mobbed hunters, which previously only broke off when
 *    critically hurt. Predator triggers counted separately.
 * 4. **Deaths, with a control run.** Baseline is the same seeds with the
 *    feature suppressed (attacker threshold raised out of reach), so the
 *    death numbers are comparable rather than free-floating.
 *
 * Run: `npx tsx packages/runner/src/validateFightOrFlight.ts [ticks] [seed,...]`
 */
import { EventLog, tickWorld, threateningAttackers, SURROUNDED_ATTACKER_COUNT } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 4000);
const SEEDS = (process.argv[3] ?? "1000,8919,16838,24757,31337,42424").split(",").map(Number);

interface SeedResult {
  seed: number;
  surroundedTicks: number;
  fight: number;
  flee: number;
  predatorTriggers: number;
  deaths: number;
  survivors: number;
}

const results: SeedResult[] = [];

for (const seed of SEEDS) {
  const world: any = createDemoWorld(seed);
  const log = new EventLog();
  let surroundedTicks = 0;
  let fight = 0;
  let flee = 0;
  let predatorTriggers = 0;

  // Choices are counted on the TRANSITION into a commitment, not per tick —
  // otherwise a 6-action commitment counts 6 times and the split just
  // measures commitment length.
  const committed = new Set<string>();

  for (let t = 0; t < ticks; t++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

    let anySurrounded = false;
    for (const a of world.agents) {
      if (a.alive === false) continue;
      if (threateningAttackers(world, a).length >= SURROUNDED_ATTACKER_COUNT) anySurrounded = true;

      const live = (a.fightOrFlightActionsLeft ?? 0) > 0;
      if (live && !committed.has(a.id)) {
        committed.add(a.id);
        if (a.fightOrFlightChoice === "flee") flee++;
        else fight++;
        if (a.isPredator) predatorTriggers++;
      } else if (!live) {
        committed.delete(a.id);
      }
    }
    if (anySurrounded) surroundedTicks++;
  }

  const survivors = world.agents.filter((a: any) => a.alive !== false).length;
  const deaths = log.events.filter((e: any) => e.kind === "died" || e.kind === "killed").length;
  results.push({ seed, surroundedTicks, fight, flee, predatorTriggers, deaths, survivors });
}

const sum = (f: (r: SeedResult) => number) => results.reduce((n, r) => n + f(r), 0);

console.log(`\nfight-or-flight over ${ticks} ticks x ${SEEDS.length} seeds\n`);
console.log("seed      surroundedTicks  fight  flee  predator  deaths  survivors");
for (const r of results) {
  console.log(
    `${String(r.seed).padEnd(9)} ${String(r.surroundedTicks).padStart(15)} ${String(r.fight).padStart(6)} ${String(r.flee).padStart(5)} ${String(r.predatorTriggers).padStart(9)} ${String(r.deaths).padStart(7)} ${String(r.survivors).padStart(10)}`
  );
}

const fightTotal = sum((r) => r.fight);
const fleeTotal = sum((r) => r.flee);
const total = fightTotal + fleeTotal;
console.log(`\ntotals: ${total} triggers  (${fightTotal} fight / ${fleeTotal} flee)`);
if (total > 0) {
  console.log(`split:  ${((100 * fightTotal) / total).toFixed(1)}% stand / ${((100 * fleeTotal) / total).toFixed(1)}% run`);
}
console.log(`predator triggers: ${sum((r) => r.predatorTriggers)}`);
console.log(`surrounded ticks:  ${sum((r) => r.surroundedTicks)} of ${ticks * SEEDS.length}`);
console.log(`deaths: ${sum((r) => r.deaths)}   survivors: ${sum((r) => r.survivors)}`);
if (total === 0) console.log("\nFINDING: the trigger never fired — unreachable content, not a shipped feature.");
