import { typeEffectiveness, type Agent, type SimEvent, type World } from "@pokuelike/engine";
import type { ActiveEngagementInfo, NotableCategory } from "./autoCamera.js";
import { eventNamesAnyOf, findMoveUsed } from "./eventText.js";
import { LEADER_ICON, TITLE_DISPLAY_NAME } from "./notableTitles.js";

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
 * battles. Only "battle" gets the rich turn-by-turn scrollback + HP bars
 * treatment, though: a one-shot moment doesn't have "turns" to scroll
 * through, and forcing one into that shape would just be an empty box with a
 * single line in it.
 */
export class BattleScreenPanel {
  private static readonly MAX_LINES = 60;

  private activeSeq: number | undefined;
  private activeCategory: NotableCategory | undefined;
  private ids: ReadonlySet<string> | undefined;
  private label: string | undefined;
  private lines: BattleLine[] = [];
  /** Set once a battle's conclusion (a death/faint/flee) has been rendered — the epilogue hold that follows shouldn't add a fresh "battle begins" framing if somehow re-entered, and gets a distinct "concluded" visual treatment (see render's `.battle-screen-concluded`). */
  private concluded = false;
  private dirty = true;

  constructor(private readonly container: HTMLElement) {}

  /** Hard reset for a fresh/reloaded world — every tracked id is about to become meaningless, unlike `setActive(undefined)` (a no-op when already idle) which exists only for the ordinary "engagement ended" transition. */
  reset(): void {
    this.activeSeq = undefined;
    this.activeCategory = undefined;
    this.ids = undefined;
    this.label = undefined;
    this.lines = [];
    this.concluded = false;
    this.dirty = true;
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
    if (info && info.category !== "battle") {
      this.lines.push({ kind: "scene", text: sceneLine(info.category, info.label) });
    } else if (info) {
      this.lines.push({ kind: "intro", text: `${info.label}!` });
    }
  }

  /** Feed every event from the tick that just ran — only ever produces turn-by-turn lines for a "battle" category engagement; one-shot categories already got their single scene line from `setActive`. */
  ingest(events: readonly SimEvent[], world: World): void {
    if (events.length === 0 || this.activeCategory !== "battle" || !this.ids) return;
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
    if (overflow > 0) this.lines.splice(0, overflow);
  }

  /**
   * Renders every frame, not gated on `dirty` alone: the HP bars/names in the
   * "vs" header read live `Agent.hp`/`pos`-adjacent state that can change
   * tick-to-tick without a new line being appended this exact frame (e.g. a
   * DoT-style status tick, or simply the very next hit not having landed
   * yet) — same "live, recomputed every frame" spirit as `autoCamera.ts`'s
   * own `focusPos`. Cheap: this panel is only ever a handful of DOM nodes.
   */
  render(world: World): void {
    if (!this.activeCategory) {
      if (!this.dirty) return;
      this.dirty = false;
      this.container.replaceChildren(emptyNote("Nothing to show — Auto Camera will frame a battle here once one breaks out."));
      return;
    }

    this.container.replaceChildren();
    this.container.classList.toggle("battle-screen-concluded", this.concluded);

    if (this.activeCategory === "battle" && this.ids) {
      this.container.appendChild(this.renderVsHeader(world));
    }

    const log = document.createElement("div");
    log.className = "battle-screen-log";
    const shown = this.lines.slice(-40);
    shown.forEach((line, i) => log.appendChild(renderLine(line, i === shown.length - 1)));
    this.container.appendChild(log);
    log.scrollTop = log.scrollHeight;
    this.dirty = false;
  }

  private renderVsHeader(world: World): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "battle-screen-vs";
    const ids = [...this.ids!];
    const extra = ids.length - 2;
    const combatants = ids.slice(0, 2).map((id) => this.renderCombatant(id, world));
    wrap.appendChild(combatants[0] ?? emptyCombatant());
    const vsLabel = document.createElement("div");
    vsLabel.className = "battle-screen-vs-label";
    vsLabel.textContent = "VS";
    wrap.appendChild(vsLabel);
    wrap.appendChild(combatants[1] ?? emptyCombatant());
    if (extra > 0) {
      const more = document.createElement("div");
      more.className = "battle-screen-extra";
      more.textContent = `+${extra} more`;
      wrap.appendChild(more);
    }
    return wrap;
  }

  private renderCombatant(id: string, world: World): HTMLElement {
    const agent = world.agents.find((a) => a.id === id) as Agent | undefined;
    const box = document.createElement("div");
    box.className = "battle-screen-combatant";
    const name = document.createElement("div");
    name.className = "battle-screen-name";
    name.textContent = agent
      ? `${agent.isHerdLeader ? `${LEADER_ICON} ` : ""}${agent.notableTitle ? TITLE_DISPLAY_NAME[agent.notableTitle] : agent.species} (${agent.alive === false ? "down" : "Lv" + (agent.level ?? "?")})`
      : id;
    box.appendChild(name);
    if (agent && agent.maxHp) {
      // Rounded for display only — combat math elsewhere in the engine can
      // leave HP as a non-integer fraction (partial-tick regen, fractional
      // damage), which is real and unrelated to this panel; showing "12" is
      // presentation, not a claim the underlying value is actually a whole
      // number.
      const hp = Math.max(0, Math.round(agent.hp ?? 0));
      const max = Math.round(agent.maxHp);
      const frac = Math.max(0, Math.min(1, hp / max));
      const track = document.createElement("div");
      track.className = "battle-screen-hp-track";
      const fill = document.createElement("div");
      fill.className = "battle-screen-hp-fill";
      fill.style.width = `${Math.round(frac * 100)}%`;
      fill.style.background = frac > 0.5 ? "#7be08a" : frac > 0.2 ? "#f5d76e" : "#ff6b6b";
      track.appendChild(fill);
      box.appendChild(track);
      const value = document.createElement("div");
      value.className = "battle-screen-hp-value";
      value.textContent = `${hp} / ${max} HP`;
      box.appendChild(value);
    }
    return box;
  }
}

/** Display-only rounding for a raw engine damage/HP number that can carry float noise (partial-tick regen, fractional damage) — see the doc comment on the HP-bar rendering above for why this is presentation, not a claim about the underlying value's precision. */
function roundForDisplay(n: number | undefined): number | string {
  return n === undefined ? "?" : Math.round(n);
}

function emptyCombatant(): HTMLElement {
  const box = document.createElement("div");
  box.className = "battle-screen-combatant";
  box.textContent = "?";
  return box;
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
}

const FLASH_KINDS: ReadonlySet<LineKind> = new Set(["crit", "conclusion", "faint"]);

function renderLine(line: BattleLine, isNewest: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = `battle-screen-line battle-screen-line-${line.kind}`;
  if (isNewest && FLASH_KINDS.has(line.kind)) el.classList.add("battle-screen-line-newest");
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
    case "herdClash":
      if (event.outcome === "missed") {
        return [{ kind: "move", text: `${event.attackerSpecies} clashes with ${event.defenderSpecies}!` }, { kind: "miss", text: "But it missed!" }];
      }
      return [
        { kind: "move", text: `${event.attackerSpecies} clashes with ${event.defenderSpecies}!` },
        ...(event.critical ? [{ kind: "crit" as const, text: "A critical hit!" }] : []),
        { kind: "damage", text: `${event.defenderSpecies} takes ${roundForDisplay(event.damage)} damage!${event.defenderHpRemaining !== undefined ? ` (HP left: ${roundForDisplay(event.defenderHpRemaining)})` : ""}` },
        ...(event.outcome === "retreated" ? [{ kind: "retreat" as const, text: `${event.defenderSpecies} backs off!` }] : []),
      ];
    case "fainted":
      return [{ kind: "faint", text: `${event.species} fainted!` }];
    case "behaviorChanged":
      return event.to === "flee" ? [{ kind: "retreat", text: `${event.species} flees from the battle!` }] : [];
    case "killed":
      return [{ kind: "conclusion", text: `${event.preySpecies} was defeated by ${event.predatorSpecies}!` }];
    case "defeated":
      return [{ kind: "conclusion", text: `${event.winnerSpecies} defeated ${event.loserSpecies}!` }];
    default:
      return [];
  }
}

/** The "X used Move!" opening line(s) shared by both `fought` and `missed` — a super/not-very-effective callout is only ever meaningful on `fought` (a miss deals no damage to be effective *against*), so this stays deliberately narrower than `moveLines`. */
function moveOpeningLines(event: { attackerId: string; attackerSpecies: string; moveId: string }, verb: string, world: World): BattleLine[] {
  const move = findMoveUsed(event, world);
  return [{ kind: "move", text: `${event.attackerSpecies} ${verb} ${move?.name ?? event.moveId}!` }];
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

  lines.push({ kind: "damage", text: `${event.defenderSpecies} takes ${roundForDisplay(event.damage)} damage! (HP left: ${roundForDisplay(event.defenderHpRemaining)})` });
  return lines;
}
