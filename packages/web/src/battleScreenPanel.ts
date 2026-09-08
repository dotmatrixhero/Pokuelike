import { notableFullName, speciesDisplayName, typeEffectiveness, type Agent, type SimEvent, type World } from "@pokuelike/engine";
import type { ActiveEngagementInfo, NotableCategory } from "./autoCamera.js";
import { eventNamesAnyOf, findMoveUsed } from "./eventText.js";
import { herdNameOf, leaderPrefix } from "./notableTitles.js";
import { agentAccentColor } from "./palette.js";
import { getSprite } from "./sprites.js";

/**
 * "Battle Screen" — a second, differently-formatted view of Auto Camera's
 * currently-tracked event, styled like a mainline Pokémon battle text box
 * rather than a log line. Direct ask: "something outside of event log that
 * kinda shows better text as the auto cam events are happening... more
 * pretty printed... framed like a Pokémon battle."
 *
 * This is *additive*, not a replacement for `EventLogPanel`'s auto-cam
 * filter (see `main.ts` — both panels update off the same tick data and stay
 * visible together): the plain log keeps its complete, precise per-event
 * detail (including move build modifiers `describeMoveModifiers` renders),
 * while this panel is the punchy narrative version — "Scyther used Slash!
 * A critical hit! Charmander took 24 damage!" — with running HP bars,
 * exactly the framing the ask was after. Someone who wants the raw numbers
 * still has the log open; someone who just wants to watch the story now has
 * somewhere better to look than an unstyled text line.
 *
 * Scope decision: every notable category gets *something* here, not just
 * battles — a hatch/evolution/immigration/death still gets a single
 * flavor-text "scene" line in the same visual voice, since they read fine in
 * this format too and the task brief explicitly said not to hard-restrict to
 * battles. Only "battle" and "clash" get the rich turn-by-turn scrollback +
 * HP bars treatment: those are the only two categories with real per-tick
 * combat events (`fought`/`missed`/`herdClash`) to ingest turn by turn — a
 * one-shot moment like a hatch doesn't have "turns" to scroll through, and
 * forcing one into that shape would just be an empty box with a single line
 * in it.
 *
 * Direct bug report: "I also still see clashing as a thing but with no
 * moves used or hp bars showing up?" Root cause: `battleLinesFor` below
 * already had full `herdClash` handling (move/crit/damage/HP-remaining
 * lines, same shape as a real battle's `fought`), but `ingest`/`render`
 * both gated the rich treatment on `activeCategory === "battle"` literally
 * — "clash" fell through to the one-shot single-scene-line path even
 * though it's exactly as turn-by-turn as a battle (see `autoCamera.ts`'s
 * own `onBattleHit`, which already tracks "battle" and "clash" as the same
 * kind of continuous engagement). `hasRichBattleScreen` below is the one
 * place that decision now lives.
 */
function hasRichBattleScreen(category: NotableCategory | undefined): boolean {
  return category === "battle" || category === "clash";
}

/**
 * Plain display name for a combatant, used everywhere WITHIN the Battle
 * Screen — leader icon + notable full name or species, deliberately
 * WITHOUT `notableTitles.ts`'s own `idLabel`'s "(id, herd)" suffix. Direct
 * ask: "Lets remove the parentheses altogether in the battle log (but
 * keep the herd name above hp bar)." This panel's header chips already
 * show id/level/herd on their own separate lines (see
 * `applyCombatantState`), so repeating "(32, the Kinglers of the Bright
 * Coast)" after every single name in every scrolling log line was the
 * actual clutter — `idLabel` itself is untouched for every OTHER consumer
 * (the plain Event Log, Chronicle) that still wants that full identity in
 * one line.
 */
function battleName(world: World, id: string, rawSpecies: string): string {
  const agent = world.agents.find((a) => a.id === id) as Agent | undefined;
  if (!agent) return speciesDisplayName(rawSpecies);
  return `${leaderPrefix(agent)}${agent.notableTitle ? notableFullName(agent.notableTitle, agent.id, agent.types) : speciesDisplayName(agent.species)}`;
}

/**
 * How long a freshly-ingested line waits before it's actually revealed in
 * the log, one at a time — direct ask: "It'd be nice to have battle logs
 * and go loss and moves and the moves in a battle pop up in animated form,
 * like just for human eye to follow along. One log entry at a time." Root
 * gap: `ingest` already received a whole tick's lines as one batch (a
 * single hit routinely produces 3-4: "X used Move!", "A critical hit!",
 * "It's super effective!", "Y takes N damage!") and `render` used to paint
 * every one of them into the DOM in the same frame — readable on replay,
 * but nothing for a human eye to actually follow *as it happens*. Chosen
 * well under `BATTLE_STEP_INTERVAL_MS` (main.ts, now 950ms) so a typical
 * 3-4-line hit finishes revealing itself before the NEXT tick's beat lands
 * a new batch on top of it, rather than the reveal queue perpetually
 * trailing the sim.
 *
 * Direct follow-up ask: "Need more pause between each log line" — raised
 * from the original 160ms.
 *
 * **Unresolved tension, flagged rather than silently retuned.** A parallel
 * branch independently raised this to 200ms, reasoning against the tick
 * cadence (now `BATTLE_STEP_INTERVAL_MS` = 950ms in main.ts): at 200ms a
 * four-line hit consumes 800 of the available 950, leaving a real gap
 * between exchanges without the reveal queue ever trailing the sim. At
 * 450ms that same four-line hit needs 1800ms against a 950ms tick, so
 * during a sustained exchange the reveal *does* fall behind and
 * `MAX_PENDING_LINES`'s instant-catch-up path is what bounds the lag.
 *
 * 450ms is kept because it came from an explicit direct ask and is the more
 * recent decision; the cadence argument for 200ms is recorded here because
 * it is a real objection, not because it has been overruled on the merits.
 * This is a balance number and belongs to the user — see TODO.md.
 */
const LINE_REVEAL_INTERVAL_MS = 450;
/**
 * Extra hold once the reveal has fully caught up (nothing pending) before
 * the FIRST line of the next batch is allowed to appear — direct ask: "and
 * a 1000 ms pause after the last one." Only the one line right after a
 * catch-up waits this long; every line after that within the same new
 * batch still just uses `LINE_REVEAL_INTERVAL_MS`. See `caughtUpAtMs`.
 */
const POST_CATCHUP_HOLD_MS = 1000;
/**
 * If the reveal queue ever falls behind by more than this many lines (a
 * mob fight landing several simultaneous hits in one tick, or the viewer
 * having been away/backgrounded), catch up by revealing the overflow
 * instantly instead of drawing out an ever-growing lag between "what
 * happened" and "what's on screen" — the one-at-a-time reveal is for
 * *readability*, not a hard guarantee, and a real backlog defeats its own
 * purpose past this point.
 */
const MAX_REVEAL_BACKLOG = 6;

export class BattleScreenPanel {
  private static readonly MAX_LINES = 60;

  private activeSeq: number | undefined;
  private activeCategory: NotableCategory | undefined;
  private ids: ReadonlySet<string> | undefined;
  private label: string | undefined;
  private lines: BattleLine[] = [];
  /** How many of `lines`, from the front, have actually been revealed to the DOM — see `LINE_REVEAL_INTERVAL_MS`. `render` advances this at most one line per interval (or catches up instantly past `MAX_REVEAL_BACKLOG`), so a freshly-`ingest`-ed batch of lines animates in individually rather than appearing all at once. */
  private revealedCount = 0;
  /** `performance.now()` the last time `revealedCount` advanced — what `LINE_REVEAL_INTERVAL_MS`/`POST_CATCHUP_HOLD_MS` count elapsed real time against. `undefined` means "reveal immediately," used right after a reset/new engagement so the opening line never waits on the timer. */
  private lastRevealAtMs: number | undefined;
  /** `performance.now()` the moment `revealedCount` most recently caught all the way up to `lines.length` (nothing left pending) — `undefined` while there's still a backlog, or once the post-catchup hold has already been consumed by revealing the next batch's first line. See `POST_CATCHUP_HOLD_MS`. */
  private caughtUpAtMs: number | undefined;
  /** Set once a battle's conclusion (a death/faint/flee) has been rendered — the epilogue hold that follows shouldn't add a fresh "battle begins" framing if somehow re-entered, and gets a distinct "concluded" visual treatment (see render's `.battle-screen-concluded`). */
  private concluded = false;
  private dirty = true;
  /**
   * Persistent DOM handles + the `activeSeq` they were last built for — see
   * `render`'s own doc comment for why these survive frame to frame instead
   * of being torn down and rebuilt every time.
   */
  private logEl: HTMLElement | undefined;
  private headerEl: HTMLElement | undefined;
  private renderedSeq: number | undefined;
  /**
   * Per-combatant DOM handles, keyed by agent id — populated by
   * `renderVsHeader` on a full (re)build, then mutated in place by
   * `updateVsHeader` every ordinary frame instead of tearing the header
   * down and rebuilding it. Direct ask: "Hp should be interpolating down,
   * animated when unit takes damage." A CSS `transition` on
   * `.battle-screen-hp-fill`'s `width` (index.html) can only ever animate
   * a change on the SAME element across frames — the old code called
   * `headerEl.replaceWith(fresh)` every single frame regardless of whether
   * anything changed, so the fill bar's width always "changed" on a brand
   * new element with no prior width to transition from, snapping instantly
   * no matter what CSS said. `undefined` while idle/between engagements.
   */
  private combatantEls: Map<string, CombatantEls> | undefined;

  constructor(private readonly container: HTMLElement) {}

  /** Hard reset for a fresh/reloaded world — every tracked id is about to become meaningless, unlike `setActive(undefined)` (a no-op when already idle) which exists only for the ordinary "engagement ended" transition. */
  reset(): void {
    this.activeSeq = undefined;
    this.activeCategory = undefined;
    this.ids = undefined;
    this.label = undefined;
    this.lines = [];
    this.revealedCount = 0;
    this.lastRevealAtMs = undefined;
    this.caughtUpAtMs = undefined;
    this.concluded = false;
    this.dirty = true;
    this.logEl = undefined;
    this.headerEl = undefined;
    this.renderedSeq = undefined;
    this.combatantEls = undefined;
  }

  /**
   * Called once per animation frame (same cadence as `EventLogPanel.render`)
   * with Auto Camera's current engagement, or `undefined` when idle. Cheap
   * no-op unless the engagement actually changed — widening `ids` (a
   * pack-hunt assist joining an already-active battle) is deliberately not a
   * "new" engagement (same `seq`), so it doesn't reset the scrollback.
   */
  setActive(info: ActiveEngagementInfo | undefined): void {
    const seq = info?.seq;
    if (seq === this.activeSeq) {
      // Same engagement, but `ids` can still have widened in place (a
      // pack-hunt assist) — keep the live reference current for the HP/vs
      // header without touching the scrollback.
      this.ids = info?.ids;
      return;
    }
    this.activeSeq = seq;
    this.activeCategory = info?.category;
    this.ids = info?.ids;
    this.label = info?.label;
    this.lines = [];
    this.concluded = false;
    this.dirty = true;
    if (info && !hasRichBattleScreen(info.category)) {
      this.lines.push({ kind: "scene", text: sceneLine(info.category, info.label) });
    } else if (info) {
      this.lines.push({ kind: "intro", text: `${info.label}!` });
    }
    // The opening line shows immediately — only lines `ingest` adds AFTER
    // this point wait on `LINE_REVEAL_INTERVAL_MS`'s one-at-a-time reveal.
    this.revealedCount = this.lines.length;
    this.lastRevealAtMs = undefined;
  }

  /** Feed every event from the tick that just ran — only ever produces turn-by-turn lines for a "battle"/"clash" category engagement (see `hasRichBattleScreen`); one-shot categories already got their single scene line from `setActive`. */
  ingest(events: readonly SimEvent[], world: World): void {
    if (events.length === 0 || !hasRichBattleScreen(this.activeCategory) || !this.ids) return;
    for (const event of events) {
      if (!eventNamesAnyOf(event, this.ids)) continue;
      const produced = battleLinesFor(event, world);
      if (produced.length === 0) continue;
      this.lines.push(...produced);
      // "conclusion" (a true death), "faint" (recoverable knockout), and
      // "retreat" (a successful flee/backing-off) are exactly the three real
      // conclusion signals `autoCamera.ts`'s `onBattleParticipantLeft`
      // recognizes — the stale-timeout fallback path produces no event at
      // all, so it has no line to key off here and just keeps the last-drawn
      // state through the epilogue hold, an accepted gap for a silent
      // disengagement.
      if (produced.some((l) => l.kind === "conclusion" || l.kind === "faint" || l.kind === "retreat")) this.concluded = true;
      this.dirty = true;
    }
    const overflow = this.lines.length - BattleScreenPanel.MAX_LINES;
    if (overflow > 0) {
      this.lines.splice(0, overflow);
      this.revealedCount = Math.max(0, this.revealedCount - overflow);
    }
  }

  /**
   * Renders every frame, not gated on `dirty` alone: the HP bars/names in the
   * "vs" header read live `Agent.hp`/`pos`-adjacent state that can change
   * tick-to-tick without a new line being appended this exact frame (e.g. a
   * DoT-style status tick, or simply the very next hit not having landed
   * yet) — same "live, recomputed every frame" spirit as `autoCamera.ts`'s
   * own `focusPos`. Cheap: this panel is only ever a handful of DOM nodes.
   *
   * Direct report: "when I pause while autocam focuses on a battle, I can't
   * scroll and see battle log." Root cause: this used to tear down and
   * rebuild the ENTIRE panel (`container.replaceChildren()`, a brand new
   * `log` div) every single frame, regardless of whether anything actually
   * changed — a fresh DOM node has no scroll position, so any manual scroll
   * was destroyed within one frame (~16ms) even with zero new lines, which
   * is exactly the case while paused. Now the header/log DOM nodes persist
   * across frames (`headerEl`/`logEl`/`renderedSeq`): the log's own children
   * (and its scroll position) are only touched when `dirty` says real new
   * content arrived, and even then only re-snapped to the bottom if the
   * viewer was already reading from the bottom — scrolled up to reread
   * something, a fresh line no longer yanks them back down.
   */
  render(world: World): void {
    if (!this.activeCategory) {
      if (!this.dirty) return;
      this.dirty = false;
      this.container.replaceChildren(emptyNote("Nothing to show — Auto Camera will frame a battle here once one breaks out."));
      this.logEl = undefined;
      this.headerEl = undefined;
      this.renderedSeq = undefined;
      return;
    }

    const isNewEngagement = this.renderedSeq !== this.activeSeq;

    // Advance the one-at-a-time reveal — see `LINE_REVEAL_INTERVAL_MS`'s own
    // doc comment. Runs every frame (not gated on `dirty`, same reasoning as
    // the HP header below it) so lines keep animating in on their own timer
    // even on a frame `ingest` didn't touch at all.
    if (this.revealedCount < this.lines.length) {
      const now = performance.now();
      const backlog = this.lines.length - this.revealedCount;
      // The first line of a fresh batch (right after a real catch-up) waits
      // the longer `POST_CATCHUP_HOLD_MS`; every line after that within the
      // same batch uses the ordinary `LINE_REVEAL_INTERVAL_MS` pace.
      const requiredGap = this.caughtUpAtMs !== undefined ? POST_CATCHUP_HOLD_MS : LINE_REVEAL_INTERVAL_MS;
      const dueByTimer = this.lastRevealAtMs === undefined || now - this.lastRevealAtMs >= requiredGap;
      const toReveal = backlog > MAX_REVEAL_BACKLOG ? backlog - MAX_REVEAL_BACKLOG : dueByTimer ? 1 : 0;
      if (toReveal > 0) {
        this.revealedCount = Math.min(this.lines.length, this.revealedCount + toReveal);
        this.lastRevealAtMs = now;
        this.caughtUpAtMs = undefined; // the hold (if any) has now been spent
        this.dirty = true;
      }
    } else if (this.caughtUpAtMs === undefined) {
      // Just now fully caught up (this is the frame `revealedCount` reached
      // `lines.length`) — stamp it so the next `ingest`'s first line gets
      // the longer `POST_CATCHUP_HOLD_MS` gap instead of the ordinary pace.
      this.caughtUpAtMs = performance.now();
    }

    const linesChanged = this.dirty;

    // Widened mid-battle (a pack-hunt assist joining) — same `seq`, so not
    // `isNewEngagement`, but `updateVsHeader` below has nothing to update
    // for an id it's never seen, so this still needs a real rebuild.
    const idsWidened = !isNewEngagement && !!this.ids && !!this.combatantEls && [...this.ids].some((id) => !this.combatantEls!.has(id));

    if (isNewEngagement || idsWidened) {
      this.container.replaceChildren();
      this.headerEl = hasRichBattleScreen(this.activeCategory) && this.ids ? this.renderVsHeader(world) : undefined;
      if (this.headerEl) this.container.appendChild(this.headerEl);
      this.logEl = document.createElement("div");
      this.logEl.className = "battle-screen-log";
      this.container.appendChild(this.logEl);
      this.renderedSeq = this.activeSeq;
    } else if (hasRichBattleScreen(this.activeCategory) && this.ids && this.headerEl) {
      // HP/names are live state — updated in place every frame (text/src
      // attributes, and the HP fill bar's `width`) without touching the log
      // element at all (that's what preserves its scroll position across
      // frames it isn't otherwise dirty) and, just as importantly, without
      // tearing down and rebuilding the fill bar itself — see
      // `combatantEls`'s own doc comment for why that used to defeat the
      // HP bar's CSS transition entirely.
      this.updateVsHeader(world);
    }

    this.container.classList.toggle("battle-screen-concluded", this.concluded);

    if (this.logEl && (isNewEngagement || linesChanged)) {
      const wasAtBottom = isNewEngagement || this.logEl.scrollTop + this.logEl.clientHeight >= this.logEl.scrollHeight - 4;
      // Only ever paints what's actually been revealed so far — see
      // `revealedCount`'s own doc comment. A still-pending line simply isn't
      // in the DOM yet; it appears on a later frame once its own turn comes.
      const shown = this.lines.slice(0, this.revealedCount).slice(-40);
      this.logEl.replaceChildren();
      shown.forEach((line, i) => this.logEl!.appendChild(renderLine(line, i === shown.length - 1)));
      if (wasAtBottom) this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    this.dirty = false;
  }

  /**
   * Every participant gets its own chip now, not just the first two plus a
   * "+N more" — direct ask: "when multiple units are in battle esp same
   * species it's quite hard to tell em apart. Can you add their hp to the
   * battle log side and also color code them + their sprite." A "VS"
   * separator still sits between consecutive chips for the common 1-vs-1
   * case's familiar reading; a mob fight just reads as a longer wrapped row
   * of chips instead of a lost "+N more" count.
   *
   * Direct follow-up ask, on a real narrow-viewport screenshot: "can you
   * just really limit the ui to two units hp bar at a time and just say
   * there's more units in the fight on mobile? It's hard to see what's
   * going on." A mob fight's chips wrapping across several rows genuinely
   * doesn't fit a phone-width panel the way it does on desktop. Rather than
   * ripping out the richer desktop behavior above, every chip/VS-label
   * still gets built (`data-idx`, in participant order) and a
   * `.battle-screen-extra` "+N more" note is always appended when there
   * are more than two — index.html's own `@media (max-width: 900px)` rule
   * (the same breakpoint the rest of this app already treats as "mobile
   * layout") is what actually hides everything past the first two chips
   * and shows the note; nothing here needs to know the viewport width
   * itself, or re-run on resize.
   */
  private renderVsHeader(world: World): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "battle-screen-vs";
    const ids = [...this.ids!];
    const map = new Map<string, CombatantEls>();
    ids.forEach((id, i) => {
      const els = buildCombatant(id);
      els.box.dataset.idx = String(i);
      this.applyCombatantState(els, id, world);
      wrap.appendChild(els.box);
      map.set(id, els);
      if (i < ids.length - 1) {
        const vsLabel = document.createElement("div");
        vsLabel.className = "battle-screen-vs-label";
        vsLabel.dataset.idx = String(i);
        vsLabel.textContent = "VS";
        wrap.appendChild(vsLabel);
      }
    });
    if (ids.length > 2) {
      const extra = document.createElement("div");
      extra.className = "battle-screen-extra";
      extra.textContent = `+${ids.length - 2} more in this fight`;
      wrap.appendChild(extra);
    }
    this.combatantEls = map;
    return wrap;
  }

  /** Updates every already-built combatant chip in place (text/src/HP-bar width) — see `combatantEls`'s own doc comment for why this, not a rebuild, is what lets the HP bar's CSS transition actually animate. */
  private updateVsHeader(world: World): void {
    for (const id of this.ids ?? []) {
      const els = this.combatantEls?.get(id);
      if (els) this.applyCombatantState(els, id, world);
    }
  }

  /** Writes one combatant's current live state into its already-built DOM handles — called both right after `buildCombatant` (initial paint) and every ordinary frame after (an in-place update, not a rebuild). */
  private applyCombatantState(els: CombatantEls, id: string, world: World): void {
    const agent = world.agents.find((a) => a.id === id) as Agent | undefined;
    const sprite = agent ? getSprite(agent.species, "down") : null;
    if (sprite && els.img.src !== sprite.src) {
      els.img.src = sprite.src;
      els.img.alt = agent!.species;
      els.img.hidden = false;
    } else if (!sprite) {
      els.img.hidden = true;
    }

    // A notable fights under its full earned name ("Surgeshade
    // Single-Minded"), not the bare title ("The Warrior") this used to show
    // — direct ask, and it is the same name the chronicle and the event log
    // now use for the same animal. Direct follow-up ask: "Lets remove the
    // parentheses altogether in the battle log" — name and level/status are
    // now two separate lines instead of "Name (Lv42)"/"Name (down)"; a
    // downed unit still shows its level too ("A downed unit should still
    // say their lvl"), not just "down" in place of it.
    els.nameEl.textContent = agent ? battleName(world, id, agent.species) : id;
    els.levelEl.textContent = agent ? `${agent.alive === false ? "Down · " : ""}Lv ${agent.level ?? "?"}` : "";
    els.levelEl.hidden = !agent;

    // Which group this animal is fighting for. Direct ask: "in battle logs
    // and their hp bar, use herd name." It earns its line here more than
    // anywhere else — a mob fight is a wrapped row of same-species chips,
    // and the herd is the only thing that says which side each one is on.
    // Direct follow-up: "keep the herd name above hp bar" — unchanged
    // position, own line, no parentheses either.
    const herd = agent ? herdNameOf(world, agent) : undefined;
    els.herdEl.textContent = herd ?? "";
    els.herdEl.hidden = !herd;

    if (agent && agent.maxHp) {
      // Rounded for display only — combat math elsewhere in the engine can
      // leave HP as a non-integer fraction (partial-tick regen, fractional
      // damage), which is real and unrelated to this panel; showing "12" is
      // presentation, not a claim the underlying value is actually a whole
      // number.
      const hp = Math.max(0, Math.round(agent.hp ?? 0));
      const max = Math.round(agent.maxHp);
      const frac = Math.max(0, Math.min(1, hp / max));
      els.hpTrack.hidden = false;
      // Only the WIDTH is set here every frame — `.battle-screen-hp-fill`'s
      // own CSS `transition` (index.html) is what actually animates it from
      // whatever width it was already at down/up to this one. Direct ask:
      // "Hp should be interpolating down, animated when unit takes damage."
      els.hpFill.style.width = `${Math.round(frac * 100)}%`;
      els.hpFill.style.background = frac > 0.5 ? "#7be08a" : frac > 0.2 ? "#f5d76e" : "#ff6b6b";
      els.hpValue.textContent = `${hp} / ${max} HP`;
    } else {
      els.hpTrack.hidden = true;
    }
  }
}

/** Persistent per-combatant DOM handles — see `BattleScreenPanel.combatantEls`'s own doc comment for why these survive frame to frame instead of being torn down and rebuilt. */
interface CombatantEls {
  box: HTMLElement;
  img: HTMLImageElement;
  nameEl: HTMLElement;
  levelEl: HTMLElement;
  herdEl: HTMLElement;
  hpTrack: HTMLElement;
  hpFill: HTMLElement;
  hpValue: HTMLElement;
}

/** Builds one combatant chip's DOM skeleton once — content/visibility is filled in (and later kept live) by `BattleScreenPanel.applyCombatantState`. */
function buildCombatant(id: string): CombatantEls {
  const accent = agentAccentColor(id);
  const box = document.createElement("div");
  box.className = "battle-screen-combatant";
  box.style.borderLeftColor = accent;

  const identRow = document.createElement("div");
  identRow.className = "battle-screen-combatant-ident";
  const img = document.createElement("img");
  img.className = "battle-screen-sprite";
  img.hidden = true;
  identRow.appendChild(img);
  const nameEl = document.createElement("div");
  nameEl.className = "battle-screen-name";
  nameEl.style.color = accent;
  identRow.appendChild(nameEl);
  box.appendChild(identRow);

  const levelEl = document.createElement("div");
  levelEl.className = "battle-screen-level";
  box.appendChild(levelEl);

  const herdEl = document.createElement("div");
  herdEl.className = "battle-screen-herd";
  box.appendChild(herdEl);

  const hpTrack = document.createElement("div");
  hpTrack.className = "battle-screen-hp-track";
  const hpFill = document.createElement("div");
  hpFill.className = "battle-screen-hp-fill";
  hpTrack.appendChild(hpFill);
  box.appendChild(hpTrack);
  const hpValue = document.createElement("div");
  hpValue.className = "battle-screen-hp-value";
  box.appendChild(hpValue);

  return { box, img, nameEl, levelEl, herdEl, hpTrack, hpFill, hpValue };
}

/** Display-only rounding for a raw engine damage/HP number that can carry float noise (partial-tick regen, fractional damage) — see the doc comment on the HP-bar rendering above for why this is presentation, not a claim about the underlying value's precision. */
function roundForDisplay(n: number | undefined): number | string {
  return n === undefined ? "?" : Math.round(n);
}

function emptyNote(text: string): HTMLElement {
  const note = document.createElement("div");
  note.className = "battle-screen-empty";
  note.textContent = text;
  return note;
}

type LineKind = "intro" | "scene" | "move" | "miss" | "crit" | "effective" | "notvery" | "damage" | "retreat" | "faint" | "conclusion";

interface BattleLine {
  kind: LineKind;
  text: string;
  /**
   * The one agent this line is "about" (the mover for a move/crit/
   * effectiveness line, the one taking the hit for damage/faint/retreat) —
   * absent for a line with no single clear subject (scene-setting, a
   * conclusion naming two agents by name already). Used only to tint the
   * line the same accent color as that agent's chip in the header above —
   * direct ask: color-coding to help tell same-species combatants apart as
   * the log scrolls, not just at the header's HP bars.
   */
  agentId?: string;
}

const FLASH_KINDS: ReadonlySet<LineKind> = new Set(["crit", "conclusion", "faint"]);

function renderLine(line: BattleLine, isNewest: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = `battle-screen-line battle-screen-line-${line.kind}`;
  if (isNewest && FLASH_KINDS.has(line.kind)) el.classList.add("battle-screen-line-newest");
  // Only "move"/"damage" get the per-agent tint — every other kind (crit,
  // effectiveness, miss, faint, retreat, conclusion) already carries real
  // semantic meaning through its own fixed CSS color (see the .battle-
  // screen-line-* rules in index.html); overriding those with a per-agent
  // color would trade away "this was a critical hit" for "this was
  // scyther-1," which isn't the ask.
  if (line.agentId && (line.kind === "move" || line.kind === "damage")) el.style.color = agentAccentColor(line.agentId);
  el.textContent = line.text;
  return el;
}

/** A single flavor-text "scene" line for a one-shot (non-battle) notable category, in the same battle-textbox voice as everything else in this panel. */
function sceneLine(category: NotableCategory, label: string): string {
  switch (category) {
    case "immigration":
      return `${label}!`;
    case "courtship":
      return `${label}!`;
    case "hatch":
      return `Oh? ${label}!`;
    case "evolution":
      return `What? ${label}!`;
    case "death":
      return `${label}...`;
    case "battle":
      return `${label}!`;
    case "clash":
      return `${label}!`;
  }
}

/**
 * Turns one raw `SimEvent` belonging to the active battle into zero or more
 * battle-textbox lines. Deliberately reuses exactly what the engine already
 * logged (`event.damage`/`event.critical`/`event.defenderHpRemaining`) —
 * see this file's header comment and DESIGN.md's "Battle Screen" section for
 * why effectiveness is the one callout computed client-side (via the
 * engine's own exported `typeEffectiveness`, not a reimplemented chart) and
 * only when the live defender agent still has resolvable `types`.
 */
function battleLinesFor(event: SimEvent, world: World): BattleLine[] {
  switch (event.kind) {
    case "fought":
      return moveLines(event, "used", world);
    case "missed":
      return [...moveOpeningLines(event, "used", world), { kind: "miss", text: "But it missed!" }];
    case "herdClash": {
      const attacker = battleName(world, event.attackerId, event.attackerSpecies);
      const defender = battleName(world, event.defenderId, event.defenderSpecies);
      if (event.outcome === "missed") {
        return [
          { kind: "move", text: `${attacker} clashes with ${defender}!`, agentId: event.attackerId },
          { kind: "miss", text: "But it missed!" },
        ];
      }
      return [
        { kind: "move", text: `${attacker} clashes with ${defender}!`, agentId: event.attackerId },
        ...(event.critical ? [{ kind: "crit" as const, text: "A critical hit!" }] : []),
        {
          kind: "damage",
          text: `${defender} takes ${roundForDisplay(event.damage)} damage!`,
          agentId: event.defenderId,
        },
        ...(event.outcome === "retreated" ? [{ kind: "retreat" as const, text: `${defender} backs off!` }] : []),
      ];
    }
    case "fainted":
      return [{ kind: "faint", text: `${battleName(world, event.agentId, event.species)} fainted!` }];
    case "behaviorChanged":
      return event.to === "flee" ? [{ kind: "retreat", text: `${battleName(world, event.agentId, event.species)} flees from the battle!` }] : [];
    case "killed":
      return [{ kind: "conclusion", text: `${battleName(world, event.preyId, event.preySpecies)} was defeated by ${battleName(world, event.predatorId, event.predatorSpecies)}!` }];
    case "defeated":
      return [{ kind: "conclusion", text: `${battleName(world, event.winnerId, event.winnerSpecies)} defeated ${battleName(world, event.loserId, event.loserSpecies)}!` }];
    default:
      return [];
  }
}

/** The "X used Move!" opening line(s) shared by both `fought` and `missed` — a super/not-very-effective callout is only ever meaningful on `fought` (a miss deals no damage to be effective *against*), so this stays deliberately narrower than `moveLines`. */
function moveOpeningLines(event: { attackerId: string; attackerSpecies: string; moveId: string }, verb: string, world: World): BattleLine[] {
  const move = findMoveUsed(event, world);
  return [{ kind: "move", text: `${battleName(world, event.attackerId, event.attackerSpecies)} ${verb} ${move?.name ?? event.moveId}!`, agentId: event.attackerId }];
}

function moveLines(event: Extract<SimEvent, { kind: "fought" }>, verb: string, world: World): BattleLine[] {
  const lines = moveOpeningLines(event, verb, world);
  if (event.critical) lines.push({ kind: "crit", text: "A critical hit!" });

  const move = findMoveUsed(event, world);
  const defender = world.agents.find((a) => a.id === event.defenderId) as Agent | undefined;
  if (move && defender?.types && defender.types.length > 0) {
    const multiplier = typeEffectiveness(move.type, defender.types);
    if (multiplier > 1) lines.push({ kind: "effective", text: "It's super effective!" });
    else if (multiplier > 0 && multiplier < 1) lines.push({ kind: "notvery", text: "It's not very effective..." });
    else if (multiplier === 0) lines.push({ kind: "notvery", text: "It had no effect!" });
  }

  lines.push({
    kind: "damage",
    text: `${battleName(world, event.defenderId, event.defenderSpecies)} takes ${roundForDisplay(event.damage)} damage!`,
    agentId: event.defenderId,
  });
  return lines;
}
