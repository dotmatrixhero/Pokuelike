import type { SimEvent, World } from "@pokuelike/engine";
import { NOISE_KINDS, STORY_COLOR, STORY_ICON, STORY_KINDS, eventNamesAgent, formatEvent } from "./eventText.js";

/**
 * A real scrollable event log, not a flat forever-growing dump: the in-memory
 * buffer is capped at `MAX_BUFFER` (oldest trimmed first) so a run producing
 * thousands of events doesn't leak memory, and only the newest `MAX_RENDERED`
 * (of whatever's currently in view — the full log, or one agent's filtered
 * history) ever become real DOM nodes, rebuilt wholesale on each render
 * rather than appended-to-forever. Rendering is decoupled from ingestion —
 * `ingest` just buffers, `render` (called once per animation frame by
 * main.ts, same cadence as the canvas redraw) does the actual DOM work, and
 * only when something has actually changed.
 */
export class EventLogPanel {
  private static readonly MAX_BUFFER = 4000;
  private static readonly MAX_RENDERED = 250;

  private buffer: SimEvent[] = [];
  /**
   * The most recently ticked world — used so a `fought`/`missed` row can
   * show the attacker's currently-built move (see `formatEvent`'s `world`
   * param). Always the live reference, not a per-event snapshot: rows show
   * "the move as currently built," which can drift from what it looked
   * like at the exact moment of an old event if the agent's since
   * respec'd — an accepted tradeoff for a live-observer panel, not a
   * historical record.
   */
  private world: World | undefined;
  private filterAgentId: string | undefined;
  /** On by default — most people watching the log want "the Pokemon stuff," not flora/weather/migration/behavior-switch chatter. */
  private hideNoise = true;
  /**
   * A separate, independently-toggleable filter from hideNoise —
   * leveledUp is a real Pokemon event (unlike NOISE_KINDS), just an
   * extremely high-volume one (990 of them in one 3000-tick run), so it
   * gets its own opt-in/out rather than being lumped into "noise" or
   * always shown. Off by default given that volume.
   */
  private hideLevelUps = true;
  private dirty = false;

  constructor(private readonly container: HTMLElement) {}

  ingest(events: readonly SimEvent[], world?: World): void {
    if (world) this.world = world;
    if (events.length === 0) return;
    this.buffer.push(...events);
    const overflow = this.buffer.length - EventLogPanel.MAX_BUFFER;
    if (overflow > 0) this.buffer.splice(0, overflow);
    this.dirty = true;
  }

  setFilter(agentId: string | undefined): void {
    if (this.filterAgentId === agentId) return;
    this.filterAgentId = agentId;
    this.dirty = true;
  }

  setHideNoise(hide: boolean): void {
    if (this.hideNoise === hide) return;
    this.hideNoise = hide;
    this.dirty = true;
  }

  setHideLevelUps(hide: boolean): void {
    if (this.hideLevelUps === hide) return;
    this.hideLevelUps = hide;
    this.dirty = true;
  }

  reset(): void {
    this.buffer = [];
    this.filterAgentId = undefined;
    this.dirty = true;
    this.render();
  }

  /** All buffered events naming `agentId`, before the noise filter is applied in `render`. */
  eventsForAgent(agentId: string): SimEvent[] {
    return this.buffer.filter((event) => eventNamesAgent(event, agentId));
  }

  render(): void {
    if (!this.dirty) return;
    this.dirty = false;

    let source = this.filterAgentId ? this.eventsForAgent(this.filterAgentId) : this.buffer;
    if (this.hideNoise) source = source.filter((event) => !NOISE_KINDS.has(event.kind));
    if (this.hideLevelUps) source = source.filter((event) => event.kind !== "leveledUp");
    const shown = source.slice(-EventLogPanel.MAX_RENDERED).reverse(); // newest first

    this.container.replaceChildren();

    if (source.length > shown.length) {
      const note = document.createElement("div");
      note.className = "log-note";
      note.textContent = `Showing the latest ${shown.length} of ${source.length} matching events.`;
      this.container.appendChild(note);
    }

    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = this.filterAgentId ? "No events yet for this agent." : "No events yet — press Play.";
      this.container.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const event of shown) frag.appendChild(this.renderRow(event));
    this.container.appendChild(frag);
  }

  private renderRow(event: SimEvent): HTMLElement {
    const isStory = STORY_KINDS.has(event.kind);
    const row = document.createElement("div");
    row.className = isStory ? "log-row log-row-story" : "log-row log-row-minor";
    if (isStory) {
      const color = STORY_COLOR[event.kind];
      if (color) row.style.color = color;
    }

    const icon = document.createElement("span");
    icon.className = "log-icon";
    icon.textContent = isStory ? (STORY_ICON[event.kind] ?? "•") : "·";

    const tick = document.createElement("span");
    tick.className = "log-tick";
    tick.textContent = `#${event.tick}`;

    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = formatEvent(event, this.world);

    row.append(icon, tick, text);
    return row;
  }
}
