import type { SimEvent, World } from "@pokuelike/engine";
import { HEADLINE_KINDS, NOISE_KINDS, STORY_COLOR, STORY_ICON, STORY_KINDS, eventNamesAgent, eventNamesAnyOf, formatEvent } from "./eventText.js";

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
   * Every `HEADLINE_KINDS` event ever ingested, kept separately from
   * `buffer` and never trimmed — direct ask: quiet-mode announcements
   * shouldn't expire just because `buffer`'s 4000-event cap rolled past
   * them on a long run (a birth from early on would otherwise silently
   * vanish from "Quiet mode" once enough later noise pushed `buffer`'s
   * window past it, even though quiet mode is specifically for watching
   * the population arc over a *long* run). Headline events are a small
   * fraction of total volume, so this stays cheap in practice without
   * needing its own cap.
   */
  private headlineCache: SimEvent[] = [];
  /**
   * Direct ask: "Can we get event logs like for just player as well? And
   * don't make em expire. Always have em stored." Same shape as
   * `headlineCache` just above (and the same efficiency argument: the
   * player's own events are a small fraction of total volume) — every
   * event naming the player, kept forever, regardless of how far
   * `buffer`'s 4000-event cap has rolled past them. `setPlayerId` is
   * called once main.ts knows who the player is; `undefined` (no game in
   * progress, or observer mode) means nothing gets cached here at all.
   */
  private playerCache: SimEvent[] = [];
  private playerId: string | undefined;
  /** Direct ask, same report — a dedicated one-click "just my history" view, not dependent on the map selection still pointing at the player (tapping any other creature to examine it moves `filterAgentId` away). Reads from `playerCache`, never `buffer`, so it is also never trimmed. */
  private myLogOnly = false;
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
  /**
   * Set while Auto Camera (autoCamera.ts) is actively following a notable
   * event — overrides every other filter/toggle below with exactly the
   * participants of *that specific moment* (both fighters in a battle, the
   * one hatchling, the pair that bonded, ...), per the direct ask to make
   * the log "more specific" than a generic per-agent filter. `undefined`
   * when auto-camera is off or idle between moments, restoring whatever the
   * viewer had manually selected.
   */
  private autoCamIds: Set<string> | undefined;
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
  /**
   * Overrides `hideNoise`/`hideLevelUps` entirely when on — a long-lived,
   * even-quieter mode for watching a run over many thousands of ticks
   * without every fight/dispersal/shelter scrolling past, just the
   * population-shaping headlines (see `HEADLINE_KINDS`). Off by default;
   * an explicit opt-in.
   */
  private headlinesOnly = false;
  private dirty = false;

  constructor(private readonly container: HTMLElement) {}

  ingest(events: readonly SimEvent[], world?: World): void {
    if (world) this.world = world;
    if (events.length === 0) return;
    this.buffer.push(...events);
    const overflow = this.buffer.length - EventLogPanel.MAX_BUFFER;
    if (overflow > 0) this.buffer.splice(0, overflow);
    for (const event of events) {
      if (HEADLINE_KINDS.has(event.kind)) this.headlineCache.push(event);
      if (this.playerId && eventNamesAgent(event, this.playerId)) this.playerCache.push(event);
    }
    this.dirty = true;
  }

  setFilter(agentId: string | undefined): void {
    if (this.filterAgentId === agentId) return;
    this.filterAgentId = agentId;
    this.dirty = true;
  }

  /** Who counts as "the player" for `playerCache`/`myLogOnly` — call once main.ts knows (a fresh game, a new player agent). Does NOT retroactively backfill `playerCache` from `buffer`'s own history — only events ingested from here on are cached, same as `headlineCache` never claimed to reconstruct the past either. */
  setPlayerId(agentId: string | undefined): void {
    this.playerId = agentId;
  }

  setMyLogOnly(myLogOnly: boolean): void {
    if (this.myLogOnly === myLogOnly) return;
    this.myLogOnly = myLogOnly;
    this.dirty = true;
  }

  /**
   * Sets/clears the auto-camera filter (see `autoCamIds`'s doc comment).
   * Deliberately doesn't early-return on an unchanged-looking `ids` — the
   * caller mutates the very same `Set` in place as a battle gains a
   * participant, so a reference-equal call still needs to mark the panel
   * dirty for the next render to pick up the widened membership.
   */
  setAutoCamFilter(ids: Set<string> | undefined): void {
    this.autoCamIds = ids;
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

  setHeadlinesOnly(headlinesOnly: boolean): void {
    if (this.headlinesOnly === headlinesOnly) return;
    this.headlinesOnly = headlinesOnly;
    this.dirty = true;
  }

  reset(): void {
    this.buffer = [];
    this.headlineCache = [];
    this.playerCache = [];
    this.playerId = undefined;
    this.filterAgentId = undefined;
    this.dirty = true;
    this.render();
  }

  /**
   * All events naming `agentId`, before the noise filter is applied in
   * `render`. Reads from the never-trimmed `playerCache` when `agentId` is
   * the player — same underlying data `myLogOnly` uses, just reached by
   * selecting the player's own agent (on the map, or via the inspector)
   * instead of the dedicated checkbox — otherwise falls back to filtering
   * the ordinary (trimmable) `buffer`.
   */
  eventsForAgent(agentId: string): SimEvent[] {
    if (agentId === this.playerId) return this.playerCache;
    return this.buffer.filter((event) => eventNamesAgent(event, agentId));
  }

  render(): void {
    if (!this.dirty) return;
    this.dirty = false;

    // Quiet mode reads from the never-trimmed headlineCache, not buffer —
    // see headlineCache's own doc comment for why.
    let source: SimEvent[];
    if (this.autoCamIds) {
      // Auto-camera's filter wins outright over hideNoise/hideLevelUps/
      // headlinesOnly and the manual per-agent filter — this is a
      // deliberately curated, temporary view of exactly one moment's
      // participants, not a variant of the ambient log preferences (a flee
      // right before a kill is `behaviorChanged`, ordinarily NOISE_KINDS,
      // but it's exactly the context a followed battle should show).
      source = this.buffer.filter((event) => eventNamesAnyOf(event, this.autoCamIds!));
    } else if (this.myLogOnly) {
      // Direct ask: "event logs like for just player as well... don't
      // make em expire." Wins over headlinesOnly/the manual per-agent
      // filter — a dedicated, always-available "my own history" view,
      // reading from playerCache (never trimmed) regardless of what's
      // currently selected on the map. Still respects hideNoise/
      // hideLevelUps, same as the ordinary per-agent filter below — those
      // are display preferences, not a storage decision, and leaving them
      // inert here would make the same two checkboxes mean different
      // things depending on whether "My log" happens to be checked too.
      source = this.playerCache;
      if (this.hideNoise) source = source.filter((event) => !NOISE_KINDS.has(event.kind));
      if (this.hideLevelUps) source = source.filter((event) => event.kind !== "leveledUp");
    } else if (this.headlinesOnly) {
      source = this.filterAgentId ? this.headlineCache.filter((event) => eventNamesAgent(event, this.filterAgentId!)) : this.headlineCache;
    } else {
      source = this.filterAgentId ? this.eventsForAgent(this.filterAgentId) : this.buffer;
      if (this.hideNoise) source = source.filter((event) => !NOISE_KINDS.has(event.kind));
      if (this.hideLevelUps) source = source.filter((event) => event.kind !== "leveledUp");
    }
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
      empty.textContent = this.autoCamIds
        ? "No events yet for this moment."
        : this.myLogOnly
          ? "No events yet for the player."
          : this.filterAgentId
            ? "No events yet for this agent."
            : "No events yet — press Play.";
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
