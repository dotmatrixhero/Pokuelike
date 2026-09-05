import type { Agent, NotableTitleId, World } from "@pokuelike/engine";

/**
 * `"Species (id)"` for an ordinary agent, or `"The Hero (Species)"` for a
 * current title-holder — the shared "look up an id, render its display
 * identity" helper every consumer that only has a bare id/species pair on
 * hand (a `SimEvent`'s fields, not a live `Agent` reference) uses, so
 * `eventText.ts` and `autoCamera.ts` render the same identity for the same
 * agent rather than two independent conventions. `world` is optional —
 * without it, this always falls back to the plain `"Species (id)"` form
 * (the same "no world, same plain text as before" contract `eventText.ts`'s
 * `formatEvent` already established).
 */
export function idLabel(world: World | undefined, id: string, species: string): string {
  const agent = world?.agents.find((a) => a.id === id);
  if (agent?.notableTitle) return `${TITLE_DISPLAY_NAME[agent.notableTitle]} (${species})`;
  return `${species} (${id})`;
}

/**
 * Notables — web-side display helpers. See DESIGN.md's "Notables" section
 * for the engine-side record-holder mechanism this renders; nothing here
 * touches simulation state, it's pure presentation.
 */

/** Human-readable display name per title, e.g. "The Hero" — used everywhere a title-holder's identity is rendered. */
export const TITLE_DISPLAY_NAME: Record<NotableTitleId, string> = {
  hero: "The Hero",
  builder: "The Builder",
  gatherer: "The Gatherer",
  rival: "The Rival",
  beloved: "The Beloved",
  elder: "The Elder",
  wanderer: "The Wanderer",
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
};

/**
 * "The Hero (bulbasaur)" — a title-holder's display identity wherever an
 * agent is normally shown as `${species}-${idSuffix}`. Keeps the raw id out
 * of the common case (a title is meant to read as a real, earned identity,
 * not a decorated id) while still surfacing the species, since "The Hero" on
 * its own loses which specific Pokémon that is at a glance.
 */
export function agentDisplayName(agent: Agent, def: { name: string } | undefined): string {
  const speciesName = def?.name ?? agent.species;
  if (agent.notableTitle) return `${TITLE_DISPLAY_NAME[agent.notableTitle]} (${speciesName})`;
  return speciesName;
}

// --- Herd naming ---------------------------------------------------------

/**
 * A small, curated flavor-name pool — deliberately not a random-name
 * generator (out of scope per the task brief: "No procedurally-generated
 * individual names beyond the title itself"). Picking deterministically from
 * a fixed list by hashing the title-holder's own id keeps this stable across
 * re-renders and re-simulations of the same run without inventing new
 * per-run state to store it in.
 */
const HERD_NAME_POOL = [
  "Ember",
  "Thistle",
  "Briar",
  "Moss",
  "Flint",
  "Hollow",
  "Sable",
  "Wren",
  "Cinder",
  "Bramble",
  "Frost",
  "Copper",
  "Slate",
  "Marigold",
  "Rowan",
  "Onyx",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Wherever herd identity is shown, a herd containing a living title-holder
 * gets a real display name derived from that agent ("Ember's Pack") instead
 * of its raw `herdId` — direct ask: "the herd can be named around it."
 * Falls back to the raw `herdId` for a herd with no titled member, unchanged
 * from before this feature. Deterministic (a pure hash of the holder's own
 * id, no rng) so the same holder always gets the same name across renders.
 */
export function herdDisplayName(world: World, herdId: string): string {
  const holder = world.agents.find((a) => a.herdId === herdId && a.alive !== false && a.notableTitle !== undefined);
  if (!holder) return herdId;
  const name = HERD_NAME_POOL[hashString(holder.id) % HERD_NAME_POOL.length];
  return `${name}'s Pack`;
}
