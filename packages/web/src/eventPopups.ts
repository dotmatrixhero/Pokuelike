import type { SimEvent, Vec2, World } from "@pokuelike/engine";
import { AGENT_ID_FIELDS, STORY_COLOR, STORY_ICON, STORY_KINDS } from "./eventText.js";

const LIFETIME_MS = 1500;

interface Popup {
  pos: Vec2;
  icon: string;
  color: string;
  bornAt: number;
}

export interface ActivePopup {
  pos: Vec2;
  icon: string;
  color: string;
  /** 1 = just appeared, 0 = about to be pruned. */
  fade: number;
}

/**
 * "Something happened here" — a brief icon that appears on an event's own
 * tile and fades out, instead of the event only ever showing up as a line
 * of text in the log panel. Scoped to STORY_KINDS (the same events already
 * highlighted in the log) so it stays a handful of signals, not spam.
 */
export class EventPopups {
  private popups: Popup[] = [];

  ingest(events: readonly SimEvent[], world: World): void {
    const now = performance.now();
    for (const event of events) {
      if (!STORY_KINDS.has(event.kind)) continue;
      const pos = eventPosition(event, world);
      if (!pos) continue;
      this.popups.push({
        pos,
        icon: STORY_ICON[event.kind] ?? "•",
        color: STORY_COLOR[event.kind] ?? "#e8eaed",
        bornAt: now,
      });
    }
  }

  reset(): void {
    this.popups = [];
  }

  /** Currently-visible popups with their fade, pruning anything expired. */
  active(): ActivePopup[] {
    const now = performance.now();
    this.popups = this.popups.filter((p) => now - p.bornAt < LIFETIME_MS);
    return this.popups.map((p) => ({
      pos: p.pos,
      icon: p.icon,
      color: p.color,
      fade: 1 - (now - p.bornAt) / LIFETIME_MS,
    }));
  }
}

/** The event's own `pos` if it has one, else the live position of whichever agent it names. */
function eventPosition(event: SimEvent, world: World): Vec2 | undefined {
  const record = event as unknown as Record<string, unknown>;
  const pos = record.pos;
  if (pos && typeof pos === "object") return pos as Vec2;

  for (const field of AGENT_ID_FIELDS) {
    const id = record[field];
    if (typeof id !== "string") continue;
    const agent = world.agents.find((a) => a.id === id);
    if (agent) return agent.pos;
  }
  return undefined;
}
