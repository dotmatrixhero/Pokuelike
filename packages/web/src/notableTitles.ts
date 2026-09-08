import type { Agent, NotableTitleId, World } from "@pokuelike/engine";
import { notableFullName, speciesDisplayName } from "@pokuelike/engine";

/**
 * Real agent/egg ids are internal bookkeeping strings, not display text —
 * `"bulbasaur-immigrant-1523-0"`, `"egg-cubone-1204-3"` — and the battle log
 * was printing them in full, direct ask: "shrink the Id and origin... pretty
 * print two words at most... like cubone (32, immigrant)." Every id this
 * codebase generates (`scenario.ts`'s `${species}-${i}`, `immigration.ts`'s
 * `${species}-immigrant-${tick}-${i}`, `overworld.ts`'s
 * `${species}-${region}-invented-${tick}-${i}`, `eggs.ts`'s
 * `egg-${species}-${tick}-${seq}`) ends in a real per-batch index that's
 * already small — pulling just the TRAILING digits (not the whole id) skips
 * right past the large embedded tick number in the middle, giving a short,
 * stable-enough-to-recognize number without ever needing to know which of
 * these four shapes a given id actually is.
 */
export function shortId(id: string): string {
  const match = /(\d+)$/.exec(id);
  return match ? match[1]! : id;
}

/**
 * The "origin" word the battle log's `(id, origin)` pairing wants —
 * `undefined` for an ordinary founding-population agent, which gets no
 * second word at all. Direct ask: "in battle log can we not call em
 * immigrant? call em 'nomad'. and 'native' instead of 'invented'. and idk,
 * somethign else cool instead of just 'born'" — "hatched" reused rather
 * than invented from scratch, matching this exact origin's own real event
 * kind (`eggHatched`, eggs.ts) instead of a new, disconnected word.
 */
function originWord(id: string): string | undefined {
  if (id.startsWith("egg-")) return "hatched";
  if (id.includes("-immigrant-")) return "nomad";
  if (id.includes("-invented-")) return "native";
  return undefined;
}

/**
 * The display identity for an id/species pair — the shared helper every
 * consumer that only has a bare id and species on hand (a `SimEvent`'s
 * fields, not a live `Agent` reference) uses, so `eventText.ts` and
 * `autoCamera.ts` render the same identity for the same agent rather than
 * two independent conventions. `world` is optional — without it this falls
 * back to the plain `"Species (id)"` form, the same "no world, same plain
 * text as before" contract `formatEvent` already established.
 *
 * Two shapes, both driven by direct asks:
 *
 * - Ordinary agent: `"Kingler (32, the Kinglers of the Bright Coast)"` —
 *   "in battle logs and their hp bar, use herd name in the logs like kingler
 *   (kinglers of the bright coast) takes 7 damage."
 * - Title-holder: `"Surgeshade Single-Minded (Kingler, the Kinglers of the
 *   Bright Coast)"` — "notables should have their full name like Surgeshade
 *   Single-Minded in battle logs and in hp bar." That is the engine's own
 *   `notableFullName`, the same name the chronicle prints, rather than the
 *   bare title ("The Warrior") this used to show.
 *
 * **The short id survives on purpose.** The obvious reading of the ask is to
 * replace the id outright with the herd name, but a herd routinely holds
 * several animals of one species — two Kinglers of the same herd would then
 * be literally identical in the log, which is the exact problem an earlier
 * ask ("shrink the Id and origin... like cubone (32, immigrant)") had
 * already been fixed. So the herd name takes the *origin* word's slot
 * instead: a herd name strictly dominates it (an immigrant herd is called
 * "the Wandering Kin", a splinter "the Severed Flame"), so nothing is lost.
 * An agent with no herd at all still gets the old `(32, nomad)` form.
 */
export function idLabel(world: World | undefined, id: string, rawSpecies: string): string {
  // Pokemon names are proper nouns — the roster stores ids lowercase.
  const species = speciesDisplayName(rawSpecies);
  const agent = world?.agents.find((a) => a.id === id);
  const leader = agent ? leaderPrefix(agent) : "";
  const herd = agent?.herdId ? world?.herds?.[agent.herdId]?.name : undefined;
  if (agent?.notableTitle) {
    const full = notableFullName(agent.notableTitle, agent.id, agent.types);
    return `${leader}${full} (${herd ? `${species}, ${herd}` : species})`;
  }
  const qualifier = herd ?? originWord(id);
  const suffix = qualifier ? `${shortId(id)}, ${qualifier}` : shortId(id);
  return `${leader}${species} (${suffix})`;
}

/**
 * Notables — web-side display helpers. See DESIGN.md's "Notables" section
 * for the engine-side record-holder mechanism this renders; nothing here
 * touches simulation state, it's pure presentation.
 */

/** Human-readable display name per title, e.g. "The Hero" — used everywhere a title-holder's identity is rendered. */
export const TITLE_DISPLAY_NAME: Record<NotableTitleId, string> = {
  // Direct ask: "shoudl rename hero to warrior probably" — display text
  // only; the internal id ("hero") and every doc comment referencing it
  // elsewhere are unchanged, same "id is plumbing, this is the name a
  // player actually sees" split every other title already has.
  hero: "The Warrior",
  builder: "The Builder",
  gatherer: "The Gatherer",
  rival: "The Rival",
  beloved: "The Beloved",
  elder: "The Elder",
  wanderer: "The Wanderer",
  // Direct ask: "add a title for knocking out a pokemon more than 5 lvls
  // above you. it makes you notable."
  giantSlayer: "The Giant Slayer",
  // Direct ask: "maybe like 'savant' for maxing out a branch of skill
  // points for a move."
  savant: "The Savant",
  // Direct ask: "'alpha' - which is win over 40 clashes."
  alpha: "The Alpha",
  // Direct ask: "'shaman' for healing or supporting units in battle a lot
  // giving them buffs."
  shaman: "The Shaman",
  // Direct ask: "'underdog' for losing 40 clashes."
  underdog: "The Underdog",
  // Direct ask: "another notable for killing another herd leader or
  // notable."
  kingslayer: "The Kingslayer",
};

/** One emoji per title, matching this file's `STORY_ICON` convention in eventText.ts. */
export const TITLE_ICON: Record<NotableTitleId, string> = {
  hero: "⚔️",
  builder: "\u{1F3D7}️", // building construction
  gatherer: "\u{1F33E}", // sheaf of rice
  rival: "\u{1F624}", // face with steam
  beloved: "\u{1F495}", // two hearts
  elder: "\u{1F9D3}", // older person
  wanderer: "\u{1F9ED}", // compass
  giantSlayer: "\u{1F409}", // dragon — felled something much bigger
  savant: "\u{1F393}", // graduation cap
  alpha: "\u{1F43A}", // wolf — pack dominance
  shaman: "\u{1F33F}", // herb — healing/buffing
  underdog: "\u{1F415}", // dog — scrappy, keeps getting back up
  kingslayer: "\u{1F5E1}️", // dagger — struck down a leader or a name everyone knew
};

/**
 * "Surgeshade Single-Minded (Kingler)" — a title-holder's display identity
 * wherever an agent is normally shown as a bare species name. Keeps the raw
 * id out of the common case (a title is meant to read as a real, earned
 * identity, not a decorated id) while still surfacing the species, since a
 * name on its own loses which Pokémon it belongs to at a glance.
 */
export function agentDisplayName(agent: Agent, def: { name: string } | undefined): string {
  const speciesName = def?.name ?? speciesDisplayName(agent.species);
  const leader = leaderPrefix(agent);
  // The engine's own generated name ("Surgeshade Single-Minded"), not the
  // bare title ("The Warrior") — direct ask, and it matches what the
  // chronicle already calls this same animal.
  if (agent.notableTitle) return `${leader}${notableFullName(agent.notableTitle, agent.id, agent.types)} (${speciesName})`;
  return `${leader}${speciesName}`;
}

// --- Herd Leadership: web-side display helpers (builds on Notables — see
// DESIGN.md's "Herd Leadership" section; nothing here touches simulation
// state, it's pure presentation) --------------------------------------------

/**
 * A leader's marker, distinct from `TITLE_ICON` on purpose (a title is a
 * global, individual record; leadership is a local, herd-scoped role — the
 * SAME agent's inspector row can carry both at once, e.g. "⚔️🛡️ The Hero
 * (bulbasaur)" for a Hero who also leads its herd, so the two icons need to
 * read as clearly separate marks, not one combined glyph).
 */
export const LEADER_ICON = "\u{1F396}️"; // military medal

/** `"{icon} "` prefix for a herd leader, or `""` for an ordinary agent — prepend to any existing title-icon/name string. */
export function leaderPrefix(agent: Agent): string {
  return agent.isHerdLeader ? `${LEADER_ICON} ` : "";
}

// --- Herd naming ---------------------------------------------------------

/**
 * A herd's display name — now the engine's own `HerdRecord.name` ("the
 * Kinglers of the Bright Coast"), the same name the chronicle tells its
 * story under.
 *
 * This used to hash a titled member's id into a 16-word flavor pool and
 * return "Ember's Pack". That pool predates herds being real entities at
 * all: at the time a herd was nothing but an opaque `Agent.herdId` string,
 * so naming one after whichever member happened to hold a title was the only
 * material available. Herds now have records with a founding, an origin, a
 * lineage and a permanent name (engine's herds.ts), and having the UI invent
 * a *second*, unrelated name for the same herd meant the inspector and the
 * chronicle disagreed about what a group was called — direct ask: "inspector
 * should show the names of the chronicle herds."
 *
 * The old pool is gone rather than kept as a fallback: an unnamed herd id is
 * a herd `tickHerds` has not registered yet (it registers every herd it sees
 * once per tick), so the raw id shows for at most one tick, and a stable
 * wrong name would be worse than a momentary ugly one.
 */
export function herdDisplayName(world: World, herdId: string): string {
  return world.herds?.[herdId]?.name ?? herdId;
}

/** A herd's name for an agent, or `undefined` for one with no herd — the lookup every "show which group this animal belongs to" caller wants. */
export function herdNameOf(world: World | undefined, agent: Agent): string | undefined {
  return agent.herdId ? world?.herds?.[agent.herdId]?.name : undefined;
}
