import { speciesDisplayName, type SimEvent, type World } from "@pokuelike/engine";
import { NOISE_KINDS, eventNamesAnyOf, formatEvent } from "./eventText.js";

/**
 * What you did and what happened to you, kept.
 *
 * Direct ask: "I need logs and things that are just about me and my party
 * visible. I want one place to see like results of look, gather, like
 * actions. This can be in said action log."
 *
 * The gap this fills: `hudMessageEl` is a single line that every new message
 * overwrites. Examining a creature, gathering, being bitten — all of it
 * appeared for one action and was then gone with no way back. Nothing was
 * ever kept.
 *
 * **Two sources, deliberately in two different voices.**
 * - `say` takes text already written for the player, second person: "You
 *   gather 3 lichen.", "You stop. The Zubat is wounded and hostile."
 * - `ingest` takes engine `SimEvent`s naming a bonded follower and formats
 *   them third person, because a follower is not you: "Sandshrew fainted."
 *
 * Events naming the PLAYER are deliberately excluded from `ingest`: the
 * player's own actions already arrive through `say` in second person, and
 * letting both in produced every action twice, once in each voice.
 *
 * **Not merged into the `SimEvent` union.** The tempting shortcut is to push
 * these lines in as synthetic events so one panel renders everything. Don't:
 * `SimEvent` is a strict union with non-defaulted exhaustive switches in
 * three packages (`eventText.ts` here, `format.ts` in the runner, and any
 * other formatter), so adding a kind breaks builds that the engine's own
 * typecheck will not catch. Separate typed buffer, merged at render.
 */
export interface ActionLogEntry {
  tick: number;
  text: string;
  /** "you" renders emphasised — it is the thing you did, and the reason you opened the log. */
  kind: "you" | "party";
  /** Consecutive identical lines collapse into one row carrying a count, so holding a movement key does not bury the run in "You wait." */
  count: number;
}

/** Rows are cheap but not free, and nobody scrolls back past a few hundred. The BUFFER is uncapped — see `entries`. */
const MAX_RENDERED = 300;

/**
 * Party news in the player's voice, not the spectator's.
 *
 * `formatEvent` is the world-log formatter and reads like one — the same
 * fight comes out as "Zubat (1) used tackle on Venonat (0, the Venonats of
 * Deepfen) for 6 (hp left: 15)". Ids in parentheses, herd names, a raw move
 * key. That is correct for watching a whole simulation and wrong for a panel
 * about the two creatures walking next to you.
 *
 * House style (CLAUDE.md): plain declarative sentences, name things, no
 * ornament, at most two. So: "A Zubat bit Venonat for 6."
 *
 * Deliberately a partial switch with a `formatEvent` fallback rather than an
 * exhaustive one. An exhaustive switch over `SimEvent` here would become a
 * fourth place that fails to compile every time the engine gains an event
 * kind — a trap this codebase has already been bitten by three times over.
 * A new kind simply falls through to the spectator wording until someone
 * decides it deserves better.
 */
function partyText(event: SimEvent, world: World): string {
  const who = (species: string) => speciesDisplayName(species);
  switch (event.kind) {
    case "fought":
      return `${who(event.attackerSpecies)} hit ${who(event.defenderSpecies)} for ${event.damage}.${event.critical ? " A hard one." : ""}`;
    case "missed":
      return `${who(event.attackerSpecies)} missed ${who(event.defenderSpecies)}.`;
    case "fainted":
      return `${who(event.species)} fainted.`;
    case "recovered":
      return `${who(event.species)} is back up.`;
    case "killed":
      return `${who(event.predatorSpecies)} killed ${who(event.preySpecies)}.`;
    case "leveledUp":
      return `${who(event.species)} reached level ${event.toLevel}.`;
    case "evolved":
      return `${who(event.fromSpecies)} evolved into ${who(event.toSpecies)}.`;
    case "learnedMove":
      return `${who(event.species)} learned ${event.moveId}.`;
    default:
      return formatEvent(event, world);
  }
}

export class ActionLogPanel {
  /**
   * Uncapped on purpose. Direct ask, from the round that built the
   * player-only event filter: "don't make em expire. Always have em.
   * Stored." One short line per action is small enough that a whole run fits
   * comfortably; only the DOM is capped.
   */
  private entries: ActionLogEntry[] = [];
  private world: World | undefined;
  private dirty = true;

  constructor(private readonly container: HTMLElement) {}

  private push(entry: ActionLogEntry): void {
    const last = this.entries[this.entries.length - 1];
    if (last && last.text === entry.text && last.kind === entry.kind) {
      last.count += 1;
      last.tick = entry.tick;
      this.dirty = true;
      return;
    }
    this.entries.push(entry);
    this.dirty = true;
  }

  /** A line already written for the player, second person. Blank text is ignored so clearing the HUD does not log an empty row. */
  say(tick: number, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.push({ tick, text: trimmed, kind: "you", count: 1 });
  }

  /**
   * Engine events naming one of `partyIds` — evaluated per tick by the
   * caller, so an event counts as your party's if they were following you
   * *at the time*, which is the honest reading of "who was with me then".
   * `NOISE_KINDS` is dropped for the same reason the world log drops it by
   * default: flora/weather/behaviour-switch chatter is not news about your
   * party.
   */
  ingest(events: readonly SimEvent[], world: World, partyIds: ReadonlySet<string>): void {
    this.world = world;
    if (partyIds.size === 0) return;
    for (const event of events) {
      if (NOISE_KINDS.has(event.kind)) continue;
      if (!eventNamesAnyOf(event, partyIds)) continue;
      this.push({ tick: event.tick, text: partyText(event, world), kind: "party", count: 1 });
    }
  }

  reset(): void {
    this.entries = [];
    this.world = undefined;
    this.dirty = true;
    this.render();
  }

  /** For the autosave. Plain data, so it survives a JSON round trip as-is. */
  snapshot(): ActionLogEntry[] {
    return this.entries;
  }

  restore(entries: readonly ActionLogEntry[]): void {
    this.entries = entries.map((e) => ({ ...e }));
    this.dirty = true;
    this.render();
  }

  render(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const shown = this.entries.slice(-MAX_RENDERED).reverse(); // newest first
    this.container.replaceChildren();

    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "you-empty";
      empty.textContent = "Nothing yet. Move, look, gather.";
      this.container.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const entry of shown) {
      const row = document.createElement("div");
      row.className = `action-row action-${entry.kind}`;

      const tick = document.createElement("span");
      tick.className = "action-tick";
      tick.textContent = `#${entry.tick}`;

      const text = document.createElement("span");
      text.className = "action-text";
      text.textContent = entry.count > 1 ? `${entry.text} ×${entry.count}` : entry.text;

      row.append(tick, text);
      frag.appendChild(row);
    }
    this.container.appendChild(frag);
  }
}
