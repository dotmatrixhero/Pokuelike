import { agentDisplayName } from "./herds.js";
import type { NotableTitleId } from "./types.js";
import type { PokemonType } from "./typing.js";

/**
 * Epithets and tales for notables.
 *
 * Direct ask: "I need notables as epithets, it'd be cool to tell the tale of
 * the notable as well like how they earned it. Each notable type should spin
 * a story about the individual."
 *
 * A title id is a database key — `titleClaimed: hero` tells you nothing
 * about the animal. What makes a notable land is a NAME you could say out
 * loud ("Thornhide the Red-Clawed") and a reason you could repeat. Every
 * title already has a real, tracked stat behind it (notables.ts's
 * `statValueFor`), so each tale is built from the actual number that earned
 * it — never invented, never generic.
 *
 * Epithets come in sets rather than one per title, picked deterministically
 * from the holder's id, so two heroes in the same world are not both "the
 * Unbroken" and a re-run of a seed names them identically.
 */

/** Several per title, so notables of the same kind still read as individuals. */
const EPITHETS: Record<NotableTitleId, readonly string[]> = {
  hero: ["the Unbroken", "the Red-Clawed", "the Bulwark", "Who Stood Fast"],
  builder: ["the Patient", "Stonelayer", "the Tireless", "Den-Maker"],
  gatherer: ["the Provider", "Open-Claw", "the Generous", "Who Went Hungry"],
  rival: ["the Spiteful", "the Unforgiving", "Grudge-Keeper", "Who Never Forgot"],
  beloved: ["the Beloved", "the Fruitful", "Root-of-the-Line", "Many-Mothered"],
  elder: ["the Ancient", "the Long-Lived", "Grey-Muzzle", "Who Remembers"],
  wanderer: ["the Far-Walked", "Horizon-Chaser", "the Restless", "Who Left"],
  giantSlayer: ["Giantsbane", "the Undaunted", "Who Felled the Mountain", "the Reckless"],
  savant: ["the Adept", "Single-Minded", "the Perfected", "Who Mastered One Thing"],
  alpha: ["the Alpha", "the Undefeated", "Crown-Taker", "Who Never Yielded"],
  shaman: ["the Mender", "Kind-Handed", "the Wellspring", "Who Tends the Fallen"],
  underdog: ["the Unbowed", "Ever-Beaten", "the Stubborn", "Who Rose Again"],
};

/** Plain-language label for a title, for UI that wants the category rather than the flourish. */
export const NOTABLE_TITLE_LABEL: Record<NotableTitleId, string> = {
  hero: "Hero",
  builder: "Builder",
  gatherer: "Gatherer",
  rival: "Rival",
  beloved: "Beloved",
  elder: "Elder",
  wanderer: "Wanderer",
  giantSlayer: "Giant-Slayer",
  savant: "Savant",
  alpha: "Alpha",
  shaman: "Shaman",
  underdog: "Underdog",
};

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** "the Red-Clawed" — stable for a given holder and title. */
export function notableEpithet(title: NotableTitleId, agentId: string): string {
  const set = EPITHETS[title];
  return set[hash(agentId + title) % set.length]!;
}

/** "Thornhide the Red-Clawed" — the full name a chronicle should use once an animal is titled. */
export function notableFullName(title: NotableTitleId, agentId: string, types?: readonly PokemonType[]): string {
  return `${agentDisplayName(agentId, types)} ${notableEpithet(title, agentId)}`;
}

export interface NotableTaleContext {
  /** The stat value that earned it — kills, ticks alive, tiles walked, and so on. */
  value: number;
  /** The holder this one took the title from, if it was a usurpation rather than a first claim. */
  previousHolderId?: string;
  /** For `rival` only: the specific animal the grudge is against. */
  rivalId?: string;
  /** The nemesis's typing, so their name is flavoured like their species. */
  rivalTypes?: readonly PokemonType[];
  species?: string;
}

/**
 * How this animal earned its title, in a sentence, from the real number.
 *
 * Each title gets its own shape deliberately — a shared template with the
 * stat swapped in would make every notable read the same, which is the exact
 * failure the chronicle's filtering already exists to avoid. A hero's tale
 * is about violence, an elder's about time, a wanderer's about distance.
 */
export function notableTale(title: NotableTitleId, ctx: NotableTaleContext): string {
  const v = Math.round(ctx.value * 100) / 100;
  switch (title) {
    case "hero":
      return `${v} kills stood to their name — no living thing in the world had more.`;
    case "builder":
      return `${v} ticks of patient digging and hauling went into their herd's shelters, long after others had wandered off.`;
    case "gatherer":
      return `They carried food to starving herdmates on ${v} separate occasions, when eating it themselves would have been easier.`;
    case "rival":
      return ctx.rivalId
        ? `They nursed a grudge against ${agentDisplayName(ctx.rivalId, ctx.rivalTypes)} bitter enough to be felt across the whole world.`
        : `They nursed a grudge bitter enough to be felt across the whole world.`;
    case "beloved":
      return `${v} young of theirs lived long enough to hatch — a line that outgrew every other.`;
    case "elder":
      return `${v} ticks alive, having outlasted everything they were born beside.`;
    case "wanderer":
      return `They walked ${v} tiles from the place they hatched, and kept going where nothing else would.`;
    case "giantSlayer":
      return v > 1
        ? `${v} times they brought down something far above their own weight — and lived.`
        : `They brought down something far above their own weight, once, and that was enough.`;
    case "savant":
      return `They took one branch of one move as far as it goes, ignoring every other path — mastery of a single thing, bought by giving up all the rest.`;
    case "alpha":
      return `${v} clashes won. Others learned to look elsewhere for a fight.`;
    case "shaman":
      return `${v} times they turned their strength to mending a herdmate instead of harming a rival.`;
    case "underdog":
      return `${v} clashes lost — and they came back for every one of them.`;
  }
}

/** The usurpation clause, when a title changed hands — "taking it from Brameye". */
export function notableUsurpation(ctx: NotableTaleContext): string | undefined {
  return ctx.previousHolderId ? `taking the title from ${agentDisplayName(ctx.previousHolderId)}` : undefined;
}
