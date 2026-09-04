import type { SimEvent } from "@pokuelike/engine";
import { STORY_COLOR, STORY_ICON, STORY_KINDS, eventNamesAgent, formatEvent } from "./eventText.js";

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
  private filterAgentId: string | undefined;
  private dirty = false;

  constructor(private readonly container: HTMLElement) {}

  ingest(events: readonly SimEvent[]): void {
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

  reset(): void {
    this.buffer = [];
    this.filterAgentId = undefined;
    this.dirty = true;
    this.render();
  }

  /** All buffered events naming `agentId` — used by the inspector panel, not just this log's own filtered view. */
  eventsForAgent(agentId: string): SimEvent[] {
    return this.buffer.filter((event) => eventNamesAgent(event, agentId));
  }

  render(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const source = this.filterAgentId ? this.eventsForAgent(this.filterAgentId) : this.buffer;
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
    text.textContent = formatEvent(event);

    row.append(icon, tick, text);
    return row;
  }
}
