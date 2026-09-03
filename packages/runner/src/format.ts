import type { SimEvent } from "@pokuelike/engine";

export function formatEvent(event: SimEvent): string {
  const prefix = `[tick ${event.tick}] ${event.species} (${event.agentId})`;
  switch (event.kind) {
    case "crossedLayer":
      return `${prefix} crossed ${event.from} -> ${event.to} at (${event.pos.x},${event.pos.y})`;
    case "consumed":
      return `${prefix} ${event.need === "thirst" ? "drank" : "ate"} at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "behaviorChanged":
      return `${prefix} switched behavior: ${event.from} -> ${event.to}`;
  }
}

export function summarize(events: SimEvent[]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  const lines = [...counts.entries()].map(([kind, count]) => `  ${kind}: ${count}`);
  return [`Total events: ${events.length}`, ...lines].join("\n");
}
