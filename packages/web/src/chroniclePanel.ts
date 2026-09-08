import { chronicleFor, notableStoriesFor, type Beat, type SimEvent, type World } from "@pokuelike/engine";
import { SPECIES } from "@pokuelike/data";

/**
 * The Chronicle panel — herd stories and the world's notables, rendered live.
 *
 * All the judgement (which moments are worth telling, how they are worded,
 * what gets dropped) lives in the engine's `chronicle.ts`, shared with the
 * runner's text version so the two can never disagree about what a herd's
 * story is. This file is presentation only.
 *
 * Rebuilt on demand rather than every frame: a chronicle is a whole-run
 * summary, so re-deriving it sixty times a second would be pure waste. It
 * re-renders when the tab is opened and then at most once every
 * `REFRESH_TICKS` while it stays open.
 */

/** A colour per beat category, so a chapter is skimmable without reading it. */
const BEAT_COLOR: Record<Beat["kind"], string> = {
  founding: "#8fd6a0",
  loss: "#e8737d",
  movement: "#7fb2e8",
  conflict: "#e8a33d",
  notable: "#d9a5f0",
  growth: "#9fd3c7",
  split: "#f0c674",
  end: "#8a8f98",
};

const BEAT_ICON: Record<Beat["kind"], string> = {
  founding: "\u{1F331}", // seedling
  loss: "\u{1F480}", // skull
  movement: "\u{1F9ED}", // compass
  conflict: "⚔️", // crossed swords
  notable: "⭐", // star
  growth: "\u{1F3E1}", // house
  split: "\u{1F500}", // shuffle
  end: "\u{1F5FF}", // moai
};

/** How often, in world ticks, an open panel re-derives the chronicle. */
const REFRESH_TICKS = 200;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** `**bold**` -> `<b>`, on already-escaped text. The engine's beats are the only source, so this needs no wider markdown. */
function renderInline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

function titleCase(name: string): string {
  return name.replace(/^the /, "The ");
}

export class ChroniclePanel {
  private lastRenderedTick = -Infinity;
  private open = false;

  constructor(private readonly root: HTMLElement) {}

  /** Called when the tab is shown or hidden — an unseen panel does no work at all. */
  setOpen(open: boolean): void {
    this.open = open;
    if (open) this.lastRenderedTick = -Infinity;
  }

  render(world: World, events: readonly SimEvent[]): void {
    if (!this.open) return;
    if (world.tick - this.lastRenderedTick < REFRESH_TICKS) return;
    this.lastRenderedTick = world.tick;

    const speciesInfo = (id: string) => SPECIES[id];
    const stories = chronicleFor(world, events, { speciesInfo });
    const notables = notableStoriesFor(world, events, { speciesInfo });
    const herdCount = Object.keys(world.herds ?? {}).length;

    const parts: string[] = [];
    parts.push(
      `<div class="chron-intro">${herdCount} herd${herdCount === 1 ? "" : "s"} have lived here; ` +
        `<b>${stories.length}</b> amounted to enough to have a story.</div>`
    );

    if (stories.length === 0) {
      parts.push(
        `<div class="chron-empty">Nothing has a story yet. Herds need to grow before their history is worth telling — let the world run a while.</div>`
      );
    }

    for (const story of stories) {
      const h = story.herd;
      const ended =
        h.dissolvedTick !== undefined
          ? `<span class="chron-dead">died out t${h.dissolvedTick}</span>`
          : `<span class="chron-alive">still going</span>`;
      parts.push(`<section class="chron-herd">`);
      parts.push(`<h3>${escapeHtml(titleCase(h.name))}</h3>`);
      parts.push(`<div class="chron-sub">peak ${h.peakSize} · founded t${h.foundedTick} · ${ended}</div>`);
      parts.push(`<ol class="chron-beats">`);
      for (const beat of story.beats) {
        parts.push(
          `<li style="--beat: ${BEAT_COLOR[beat.kind]}">` +
            `<span class="chron-icon">${BEAT_ICON[beat.kind]}</span>` +
            `<span class="chron-tick">t${beat.tick}</span>` +
            `<span class="chron-text">${renderInline(beat.text)}</span>` +
            `</li>`
        );
      }
      parts.push(`</ol>`);
      if (story.untold > 0) parts.push(`<div class="chron-untold">${story.untold} lesser moments not told</div>`);
      parts.push(`</section>`);
    }

    if (notables.length > 0) {
      parts.push(`<h2 class="chron-notables-head">The Notables</h2>`);
      for (const n of notables) {
        const article = /^[AEIOU]/.test(n.species) ? "an" : "a";
        const of = n.herd ? ` of ${escapeHtml(titleCase(n.herd.name))}` : "";
        parts.push(`<section class="chron-notable">`);
        parts.push(`<div class="chron-notable-label">${escapeHtml(n.label)}</div>`);
        parts.push(`<h3>${escapeHtml(n.name)}</h3>`);
        parts.push(
          `<div class="chron-sub">${article} ${escapeHtml(n.species)}${of}, crowned t${n.tick}` +
            `${n.usurpation ? `, ${escapeHtml(n.usurpation)}` : ""}</div>`
        );
        parts.push(`<p class="chron-tale">${escapeHtml(n.tale)}</p>`);
        if (n.predecessors.length > 0) {
          parts.push(
            `<div class="chron-before">Before them: ${n.predecessors.map(escapeHtml).join(", ")}</div>`
          );
        }
        parts.push(`</section>`);
      }
    }

    this.root.innerHTML = parts.join("");
  }
}
