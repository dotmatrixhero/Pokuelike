/**
 * The Chronicle — a herd's story, told from the event log.
 *
 * Direct ask: "the story of a herd as an entity ... I want to trace what
 * zones they migrated across, what their notables are, what happened to
 * them ... I want stories", and, on how much to include: "just [good] bits.
 * Filter hard."
 *
 * Filtering hard is the whole design. A herd generates thousands of events
 * across a run and almost all of them are weather, foraging and routine
 * scuffles. This keeps only events that would change how you feel about the
 * herd — foundings, splits, disasters survived, titles earned, a run of
 * deaths — groups them into chapters, and reduces the quiet stretches to a
 * single line. A chronicle that lists everything is a log, not a story.
 *
 * Run: `npx tsx packages/runner/src/chronicle.ts [ticks] [seed]`
 */
import {
  EventLog,
  tickWorld,
  agentDisplayName,
  notableFullName,
  notableTale,
  notableUsurpation,
  NOTABLE_TITLE_LABEL,
  type HerdRecord,
} from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 8000);
const seed = Number(process.argv[3] ?? 24757);

/** A herd needs to have amounted to something before it earns a chapter list. */
const MIN_PEAK_SIZE = 3;
/** Deaths inside this window read as one disaster rather than several separate losses. */
const DEATH_CLUSTER_WINDOW = 400;
/** A cluster has to be this bad to be worth telling. */
const MIN_CLUSTER_DEATHS = 2;

interface Beat { tick: number; weight: number; text: string }

const world: any = createDemoWorld(seed);
const log = new EventLog();
for (let t = 0; t < ticks; t++) tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

const herds: Record<string, HerdRecord> = world.herds ?? {};
const events = log.events as any[];

/** Which herd an event belongs to, where that is knowable at all. */
function herdOfEvent(e: any): string | undefined {
  return e.herdId ?? undefined;
}

const byHerd = new Map<string, any[]>();
for (const e of events) {
  const id = herdOfEvent(e);
  if (!id) continue;
  (byHerd.get(id) ?? byHerd.set(id, []).get(id)!).push(e);
}

function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Turn one herd's raw events into a short list of things worth telling. */
function beatsFor(herd: HerdRecord, own: any[]): Beat[] {
  const beats: Beat[] = [];

  const origin =
    herd.origin === "split"
      ? `broke away from ${herds[herd.parentHerdId ?? ""]?.name ?? "an older herd"}`
      : herd.origin === "immigration"
        ? "arrived from beyond the map"
        : "were here when the world began";
  beats.push({ tick: herd.foundedTick, weight: 100, text: `**${cap(herd.name)}** ${origin}.` });

  // Deaths, clustered — a bad season reads as one event, not five.
  const deaths = own
    .filter((e) => e.kind === "killed" || e.kind === "starved")
    .sort((a, b) => a.tick - b.tick);
  let cluster: any[] = [];
  const flush = () => {
    if (cluster.length >= MIN_CLUSTER_DEATHS) {
      const killed = cluster.filter((e) => e.kind === "killed").length;
      const starved = cluster.length - killed;
      const parts: string[] = [];
      if (killed) parts.push(`${plural(killed, "taken by predators", "taken by predators")}`.replace(/^(\d+)/, "$1"));
      if (starved) parts.push(`${starved} starved`);
      beats.push({
        tick: cluster[0].tick,
        weight: 60 + cluster.length * 5,
        text: `A hard stretch: ${parts.join(", ")} over ${cluster[cluster.length - 1].tick - cluster[0].tick} ticks.`,
      });
    }
    cluster = [];
  };
  for (const d of deaths) {
    if (cluster.length && d.tick - cluster[cluster.length - 1].tick > DEATH_CLUSTER_WINDOW) flush();
    cluster.push(d);
  }
  flush();

  for (const e of own) {
    switch (e.kind) {
      case "herdMigrating":
        beats.push({ tick: e.tick, weight: 80, text: `Moved on — ${migrationReason(e.reason)}.` });
        break;
      case "herdClash":
        beats.push({ tick: e.tick, weight: 72, text: `Clashed with a rival herd.` });
        break;
      case "titleClaimed":
        // The herd's line is short — the full tale gets its own section
        // below, because a notable's story is theirs, not a footnote in
        // someone else's chapter.
        beats.push({
          tick: e.tick,
          weight: 98,
          text: `**${notableFullName(e.title, e.agentId)}** rose to become the world's ${NOTABLE_TITLE_LABEL[e.title]}.`,
        });
        break;

      case "leadershipClaimed": {
        // Named, so a repeat claim by the same animal dedupes away while a
        // real change of leadership still reads as a new moment.
        beats.push({ tick: e.tick, weight: 58, text: `${agentDisplayName(e.agentId)} took the lead.` });
        break;
      }
      case "shelterBuilt":
        beats.push({ tick: e.tick, weight: 62, text: `Built a shelter and settled in.` });
        break;
      // Evolutions are deliberately NOT beats. They are frequent, repetitive
        // and identical to each other — an early draft filled every chapter
        // with "X evolved into an ivysaur" eight times and buried the
        // migrations and the deaths that actually carry the story. They are
        // collapsed into a single coming-of-age line below instead.
      case "evolved":
        break;
      case "regionCrossed":
        beats.push({ tick: e.tick, weight: 78, text: `Crossed into new country.` });
        break;
      default:
        break;
    }
  }

  // One coming-of-age line for the whole run, rather than one beat each.
  const evolutions = own.filter((e) => e.kind === "evolved");
  if (evolutions.length >= 2) {
    const forms = [...new Set(evolutions.map((e) => e.toSpecies))];
    beats.push({
      tick: evolutions[Math.floor(evolutions.length / 2)].tick,
      weight: 54,
      text: `The young came of age — ${plural(evolutions.length, "evolution")} over the years, into ${forms.join(" and ")}.`,
    });
  } else if (evolutions.length === 1) {
    beats.push({ tick: evolutions[0].tick, weight: 50, text: `${agentDisplayName(evolutions[0].agentId)} evolved into a ${evolutions[0].toSpecies}.` });
  }

  // Splits: told from the parent's side too, because losing half your herd is the parent's story as much as the child's.
  for (const child of Object.values(herds)) {
    if (child.parentHerdId !== herd.id) continue;
    beats.push({ tick: child.foundedTick, weight: 90, text: `The herd split — a group left to found **${child.name}**.` });
  }

  if (herd.dissolvedTick !== undefined) {
    beats.push({ tick: herd.dissolvedTick, weight: 100, text: `The last of them was gone.` });
  }
  return dedupe(beats).sort((a, b) => a.tick - b.tick);
}

/**
 * Collapses repetition, which is most of what makes a generated chronicle
 * read like a machine wrote it. The same leader reclaiming the lead five
 * times, or a herd rebuilding its shelter every few hundred ticks, is one
 * fact about the herd, not five events — an early draft gave a Pidgey herd
 * five separate "Quillspur took the lead" lines and nothing else.
 */
function dedupe(beats: Beat[]): Beat[] {
  const seen = new Set<string>();
  const out: Beat[] = [];
  for (const beat of [...beats].sort((a, b) => a.tick - b.tick)) {
    if (seen.has(beat.text)) continue;
    seen.add(beat.text);
    out.push(beat);
  }
  return out;
}

function migrationReason(reason: string): string {
  switch (reason) {
    case "scarcity": return "the food had run out";
    case "predator_pressure": return "something was hunting them";
    case "territorial": return "a stronger herd pushed them out";
    case "weather": return "the weather turned against them";
    case "wanderlust": return "restlessness, nothing more";
    default: return String(reason);
  }
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }


const told = Object.values(herds)
  .filter((h) => h.peakSize >= MIN_PEAK_SIZE)
  .sort((a, b) => b.peakSize - a.peakSize);

console.log(`# Chronicle — seed ${seed}, ${ticks} ticks\n`);
console.log(`${Object.keys(herds).length} herds lived here; ${told.length} amounted to enough to have a story.\n`);

for (const herd of told) {
  const own = byHerd.get(herd.id) ?? [];
  const beats = beatsFor(herd, own);
  // Filter hard: keep the strongest beats only, then re-sort into time order.
  const kept = [...beats].sort((a, b) => b.weight - a.weight).slice(0, 8).sort((a, b) => a.tick - b.tick);

  const ended = herd.dissolvedTick !== undefined ? `died out t${herd.dissolvedTick}` : "still going";
  console.log(`\n## ${cap(herd.name)}`);
  console.log(`_peak ${herd.peakSize} · founded t${herd.foundedTick} · ${ended}_\n`);
  for (const beat of kept) console.log(`- **t${beat.tick}** — ${beat.text}`);
  const quiet = beats.length - kept.length;
  if (quiet > 0) console.log(`- _(${quiet} lesser moments not told)_`);
}

// ---------------------------------------------------------------------------
// The Notables — the individuals the world will remember, and why.
// ---------------------------------------------------------------------------

const claims = events.filter((e) => e.kind === "titleClaimed");
if (claims.length > 0) {
  console.log(`\n\n# The Notables\n`);

  // Only ever a handful of titles exist at once (one holder each, world-wide),
  // but a title can change hands many times over a run. Told newest-first per
  // title, so the current holder leads and their predecessors read as the
  // lineage they displaced.
  const byTitle = new Map<string, any[]>();
  for (const claim of claims) {
    (byTitle.get(claim.title) ?? byTitle.set(claim.title, []).get(claim.title)!).push(claim);
  }

  for (const [title, all] of [...byTitle.entries()].sort()) {
    const latest = all[all.length - 1];
    const holderHerd = herds[latest.herdId ?? ""];
    console.log(`\n## ${NOTABLE_TITLE_LABEL[title as keyof typeof NOTABLE_TITLE_LABEL]} — ${notableFullName(latest.title, latest.agentId)}`);
    const of = holderHerd ? ` of ${holderHerd.name}` : "";
    const usurped = notableUsurpation(latest);
    console.log(`_a ${latest.species}${of}, crowned t${latest.tick}${usurped ? `, ${usurped}` : ""}_\n`);
    // The claim event captured the stat at the moment the threshold was
    // crossed, so an Elder crowned at exactly 500 ticks still reads "500"
    // however long they went on to live. For a holder still sitting on the
    // title, the world's live record is the truer number.
    const live = (world.notables ?? {})[title];
    const stillHolds = live?.agentId === latest.agentId;
    console.log(notableTale(latest.title, { ...latest, value: stillHolds ? live.value : latest.value }));

    const predecessors = [...new Set(
      all.slice(0, -1)
        .filter((c: any) => c.agentId !== latest.agentId)
        .map((c: any) => notableFullName(c.title, c.agentId))
    )];
    if (predecessors.length > 0) {
      console.log(`\nBefore them the title was held by ${predecessors.join(", ")}.`);
    }
  }
}
