import { agentDisplayName, type HerdRecord } from "./herds.js";
import { NOTABLE_TITLE_LABEL, notableFullName, notableTale, notableUsurpation } from "./notableLore.js";
import { speciesDisplayName, withArticle } from "./names.js";
import type { SimEvent } from "./events.js";
import type { NotableTitleId, World } from "./types.js";
import type { PokemonType } from "./typing.js";

/**
 * The Chronicle — turning an event log into herd stories.
 *
 * Lives in the engine rather than in either consumer because there are two:
 * the runner prints it as text and the web app renders it as a panel, and
 * the whole value of the feature is the FILTERING. Two copies of "which
 * moments are worth telling" would drift within a week, and the interesting
 * half of this module is not the prose but the decisions about what to throw
 * away — a herd generates thousands of events and a story is a handful.
 *
 * Nothing here touches simulation state; it is a pure read over a world
 * snapshot plus the events collected so far.
 */

export interface Beat {
  tick: number;
  /** Higher survives the cut — see `chronicleFor`'s `maxBeats`. */
  weight: number;
  /** Plain text with `**bold**` spans; a renderer decides what bold means. */
  text: string;
  /** Coarse category, so a renderer can colour or icon a beat without parsing its prose. */
  kind: "founding" | "loss" | "movement" | "conflict" | "notable" | "growth" | "split" | "end";
}

export interface HerdStory {
  herd: HerdRecord;
  beats: Beat[];
  /** How many real beats were dropped by the filter, so a renderer can say "12 lesser moments not told". */
  untold: number;
}

export interface NotableStory {
  title: NotableTitleId;
  label: string;
  /** "Buzzpelt Grudge-Keeper" */
  name: string;
  agentId: string;
  species: string;
  tick: number;
  /** How they earned it, in a sentence. */
  tale: string;
  /** "taking the title from Piketail", when it was a transfer. */
  usurpation?: string;
  /** Everyone who held it before, most recent last. */
  predecessors: string[];
  herd?: HerdRecord;
  /**
   * The "a Rapidash of the Rapidash of the Crag Heights" line, already
   * de-stuttered — a herd named after its own species would otherwise repeat
   * it, which is what the first version printed. Renderers should use this
   * rather than composing species and herd themselves.
   */
  subtitle: string;
}

export interface ChronicleOptions {
  /** A herd below this peak size never amounted to enough to be worth a chapter. */
  minPeakSize?: number;
  /** Deaths closer together than this read as one disaster rather than several losses. */
  deathClusterWindow?: number;
  /** How many beats survive per herd. The single most important knob in the whole feature. */
  maxBeats?: number;
  /** Species id -> display name and typing, so names and prose match the roster. The engine cannot import the data package, so callers supply it. */
  speciesInfo?: (species: string) => { name?: string; types?: readonly PokemonType[] } | undefined;
}

const DEFAULTS = { minPeakSize: 3, deathClusterWindow: 400, maxBeats: 8, minClusterDeaths: 2 };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function migrationReason(reason: string): string {
  switch (reason) {
    case "scarcity": return "the food had run out";
    case "predator_pressure": return "something was hunting them";
    case "weather": return "the weather turned against them";
    case "wanderlust": return "restlessness, nothing more";
    case "territorial": return "a stronger herd pushed them out";
    default: return String(reason);
  }
}

/**
 * Collapses repetition, which is most of what makes a generated chronicle
 * read like a machine wrote it. The same leader reclaiming the lead five
 * times, or a herd rebuilding its shelter every few hundred ticks, is one
 * fact about the herd rather than five events.
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

/** Every herd's story, strongest herds first. */
export function chronicleFor(world: World, events: readonly SimEvent[], options: ChronicleOptions = {}): HerdStory[] {
  const opts = { ...DEFAULTS, ...options };
  const herds = world.herds ?? {};
  const info = options.speciesInfo ?? (() => undefined);
  const nameOf = (species: string | undefined): string =>
    species ? info(species)?.name ?? speciesDisplayName(species) : "creature";
  const typesOf = (species: string | undefined) => (species ? info(species)?.types : undefined);
  const who = (agentId: string, species?: string) => agentDisplayName(agentId, typesOf(species));

  const byHerd = new Map<string, SimEvent[]>();
  for (const event of events) {
    const id = (event as { herdId?: string }).herdId;
    if (!id) continue;
    const list = byHerd.get(id);
    if (list) list.push(event);
    else byHerd.set(id, [event]);
  }

  const stories: HerdStory[] = [];
  for (const herd of Object.values(herds)) {
    if (herd.peakSize < opts.minPeakSize) continue;
    const own = byHerd.get(herd.id) ?? [];
    const beats: Beat[] = [];

    // Deliberately does NOT repeat the herd's own name: every renderer shows
    // it as the chapter heading directly above, so "The Spearows of Stormfen"
    // followed by "the Spearows of Stormfen were here when the world began"
    // reads as a stutter — and the lowercase "the" mid-sentence made it worse.
    const origin =
      herd.origin === "split"
        ? `Broke away from **${herds[herd.parentHerdId ?? ""]?.name ?? "an older herd"}**.`
        : herd.origin === "immigration"
          ? "Arrived from beyond the map."
          : "Were here when the world began.";
    beats.push({ tick: herd.foundedTick, weight: 100, kind: "founding", text: origin });

    // Deaths, clustered — a bad season is one event, not five.
    const deaths = own
      .filter((e) => e.kind === "killed" || e.kind === "starved" || e.kind === "burned")
      .sort((a, b) => a.tick - b.tick);
    let cluster: SimEvent[] = [];
    const flush = (): void => {
      if (cluster.length >= DEFAULTS.minClusterDeaths) {
        const killed = cluster.filter((e) => e.kind === "killed").length;
        const burned = cluster.filter((e) => e.kind === "burned").length;
        const starved = cluster.length - killed - burned;
        const parts: string[] = [];
        if (killed) parts.push(`${killed} taken by predators`);
        if (starved) parts.push(`${starved} starved`);
        if (burned) parts.push(`${burned} lost to fire`);
        beats.push({
          tick: cluster[0]!.tick,
          weight: 60 + cluster.length * 5,
          kind: "loss",
          text: `A hard stretch: ${parts.join(", ")} over ${cluster[cluster.length - 1]!.tick - cluster[0]!.tick} ticks.`,
        });
      }
      cluster = [];
    };
    for (const death of deaths) {
      if (cluster.length && death.tick - cluster[cluster.length - 1]!.tick > opts.deathClusterWindow) flush();
      cluster.push(death);
    }
    flush();

    for (const e of own) {
      switch (e.kind) {
        case "herdMigrating":
          beats.push({ tick: e.tick, weight: 80, kind: "movement", text: `Moved on — ${migrationReason(e.reason)}.` });
          break;
        case "herdClash":
          beats.push({ tick: e.tick, weight: 72, kind: "conflict", text: `Clashed with a rival herd.` });
          break;
        case "titleClaimed":
          beats.push({
            tick: e.tick,
            weight: 98,
            kind: "notable",
            text: `**${notableFullName(e.title, e.agentId, typesOf(e.species))}** rose to become the world's ${NOTABLE_TITLE_LABEL[e.title]}.`,
          });
          break;
        case "leadershipClaimed":
          beats.push({ tick: e.tick, weight: 58, kind: "growth", text: `${who(e.agentId, e.species)} took the lead.` });
          break;
        case "shelterBuilt":
          beats.push({ tick: e.tick, weight: 62, kind: "growth", text: `Built a shelter and settled in.` });
          break;
        case "regionCrossed":
          beats.push({ tick: e.tick, weight: 78, kind: "movement", text: `Crossed into new country.` });
          break;
        default:
          break;
      }
    }

    // One coming-of-age line for the whole run rather than one beat each:
    // an early draft filled every chapter with eight identical evolution
    // lines and buried the migrations and deaths that carry the story.
    const evolutions = own.filter((e): e is Extract<SimEvent, { kind: "evolved" }> => e.kind === "evolved");
    if (evolutions.length >= 2) {
      const forms = [...new Set(evolutions.map((e) => nameOf(e.toSpecies)))];
      beats.push({
        tick: evolutions[Math.floor(evolutions.length / 2)]!.tick,
        weight: 54,
        kind: "growth",
        text: `The young came of age — ${plural(evolutions.length, "evolution")} over the years, into ${forms.join(" and ")}.`,
      });
    } else if (evolutions.length === 1) {
      const one = evolutions[0]!;
      beats.push({
        tick: one.tick,
        weight: 50,
        kind: "growth",
        text: `${who(one.agentId, one.fromSpecies)} evolved into ${withArticle(nameOf(one.toSpecies))}.`,
      });
    }

    // Splits are told from the parent's side too — losing half your herd is
    // the parent's story as much as the child's.
    for (const child of Object.values(herds)) {
      if (child.parentHerdId !== herd.id) continue;
      beats.push({ tick: child.foundedTick, weight: 90, kind: "split", text: `The herd split — a group left to found **${child.name}**.` });
    }

    if (herd.dissolvedTick !== undefined) {
      beats.push({
        tick: herd.dissolvedTick,
        weight: 100,
        kind: "end",
        text: endingText(herd, deaths, nameOf, opts.deathClusterWindow),
      });
    }

    const all = dedupe(beats);
    const kept = [...all].sort((a, b) => b.weight - a.weight).slice(0, opts.maxBeats).sort((a, b) => a.tick - b.tick);
    stories.push({ herd, beats: kept, untold: all.length - kept.length });
  }

  return stories.sort((a, b) => b.herd.peakSize - a.herd.peakSize);
}


/**
 * What actually ended a herd, rather than the placeholder this used to
 * print. Direct verdict on that placeholder: "Are we not following what
 * kills them? Just dying out is sad and vague."
 *
 * We were, in fact, already following it — every death this simulation can
 * inflict records a typed event (`killed` with the predator's own species,
 * `starved` with hunger vs thirst, `burned` from fire.ts) and each one is
 * stamped with the victim's herd. The chronicle simply was not reading them
 * at the one moment they matter most. This reads the herd's own deaths in
 * the stretch leading up to its dissolution and names the dominant cause.
 *
 * **The honest cases matter as much as the dramatic ones.** A herd can end
 * without a single death: its last members can walk into another region and
 * be folded into a different herd there (overworld.ts's
 * `foldAgentIntoAggregate`), or split away entirely. Inventing a death for
 * that would be a lie in the record, so it gets its own line.
 *
 * Nothing dies of old age here, so "they grew old" is a sentence this
 * function can never write — but that is a DELIBERATE removal ("dying of
 * old age is kinda dumb"), not a gap. `ageMortalityChance` still exists in
 * needs.ts, unwired, and needs.test.ts asserts it stays that way.
 */
function endingText(
  herd: HerdRecord,
  deaths: readonly SimEvent[],
  nameOf: (species: string | undefined) => string,
  window: number
): string {
  const end = herd.dissolvedTick ?? herd.lastSeenTick;
  // The final stretch, not the whole run: a herd that lost half its number
  // to predators a thousand ticks ago and then quietly starved should be
  // remembered for the starving.
  const last = deaths.filter((e) => e.tick >= end - window);
  const final = last.length > 0 ? last : deaths;
  if (final.length === 0) {
    return `The herd came to an end without a death to mark it — the last of them moved on and were counted among others.`;
  }

  const predators = new Map<string, number>();
  let killed = 0;
  let hunger = 0;
  let thirst = 0;
  let burned = 0;
  for (const e of final) {
    if (e.kind === "killed") {
      killed++;
      predators.set(e.predatorSpecies, (predators.get(e.predatorSpecies) ?? 0) + 1);
    } else if (e.kind === "burned") burned++;
    else if (e.kind === "starved") {
      if (e.cause === "thirst") thirst++;
      else hunger++;
    }
  }

  // "the last one" rather than "1 of them" — a herd's final member deserves
  // better than a count of one.
  const them = (n: number): string => (n === 1 ? "the last one" : `${n} of them`);
  const causes: { n: number; text: string }[] = [
    {
      n: killed,
      text: (() => {
        const worst = [...predators.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([sp]) => nameOf(sp));
        // Naming the animal that did it is the whole point — "hunted to the
        // last by Spearow" is a story, "predation" is a statistic.
        return worst.length > 0
          ? `Hunted to the last — ${them(killed)} taken by **${worst.join(" and ")}**.`
          : `Hunted to the last — ${them(killed)} taken by predators.`;
      })(),
    },
    { n: hunger, text: `Starved out — ${them(hunger)} died with nothing left to eat.` },
    { n: thirst, text: `The water failed them — ${them(thirst)} died of thirst.` },
    { n: burned, text: `Fire took them — ${them(burned)} burned in their final days.` },
  ].filter((c) => c.n > 0);
  causes.sort((a, b) => b.n - a.n);

  const primary = causes[0]!.text;
  // A second cause is named only when it is a real share of the ending, not
  // a single stray death that would read as more important than it was.
  const second = causes[1];
  if (second && second.n * 2 >= causes[0]!.n) {
    return `${primary} ${second.text}`;
  }
  return primary;
}

/**
 * "an Ivysaur of the Bulbasaurs of Saltrun" — or just "of the Rapidash of
 * the Crag Heights" when the herd is already named for the species, since
 * repeating it reads as a bug.
 */
function notableSubtitle(species: string, herd: HerdRecord | undefined): string {
  if (!herd) return withArticle(species);
  const namedForSpecies = herd.name.toLowerCase().startsWith(`the ${species.toLowerCase()}`);
  return namedForSpecies ? `of ${herd.name}` : `${withArticle(species)} of ${herd.name}`;
}

/** The individuals the world will remember, and how each earned it. */
export function notableStoriesFor(world: World, events: readonly SimEvent[], options: ChronicleOptions = {}): NotableStory[] {
  const info = options.speciesInfo ?? (() => undefined);
  const typesOf = (species: string | undefined) => (species ? info(species)?.types : undefined);
  const nameOf = (species: string | undefined): string =>
    species ? info(species)?.name ?? speciesDisplayName(species) : "creature";

  const claims = events.filter((e): e is Extract<SimEvent, { kind: "titleClaimed" }> => e.kind === "titleClaimed");
  const byTitle = new Map<NotableTitleId, Extract<SimEvent, { kind: "titleClaimed" }>[]>();
  for (const claim of claims) {
    const list = byTitle.get(claim.title);
    if (list) list.push(claim);
    else byTitle.set(claim.title, [claim]);
  }

  const stories: NotableStory[] = [];
  for (const [title, all] of byTitle) {
    const latest = all[all.length - 1]!;
    // The claim event captured the stat when the threshold was crossed, so an
    // Elder crowned at exactly 500 ticks would read "500" forever. For a
    // holder still sitting on the title, the world's live record is truer.
    const live = world.notables?.[title];
    const stillHolds = live?.agentId === latest.agentId;
    const nemesis = latest.rivalId ? world.agents.find((a) => a.id === latest.rivalId) : undefined;

    stories.push({
      title,
      label: NOTABLE_TITLE_LABEL[title],
      name: notableFullName(title, latest.agentId, typesOf(latest.species)),
      agentId: latest.agentId,
      species: nameOf(latest.species),
      tick: latest.tick,
      tale: notableTale(title, {
        value: stillHolds && live ? live.value : latest.value,
        previousHolderId: latest.previousHolderId,
        rivalId: latest.rivalId,
        rivalTypes: typesOf(nemesis?.species),
      }),
      usurpation: notableUsurpation({ value: latest.value, previousHolderId: latest.previousHolderId }),
      predecessors: [
        ...new Set(
          all
            .slice(0, -1)
            .filter((c) => c.agentId !== latest.agentId)
            .map((c) => notableFullName(c.title, c.agentId, typesOf(c.species)))
        ),
      ],
      herd: latest.herdId ? world.herds?.[latest.herdId] : undefined,
      subtitle: notableSubtitle(nameOf(latest.species), latest.herdId ? world.herds?.[latest.herdId] : undefined),
    });
  }
  return stories.sort((a, b) => a.label.localeCompare(b.label));
}
