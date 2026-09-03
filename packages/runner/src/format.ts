import type { SimEvent } from "@pokuelike/engine";

export function formatEvent(event: SimEvent): string {
  switch (event.kind) {
    case "crossedLayer":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) crossed ${event.from} -> ${event.to} at (${event.pos.x},${event.pos.y})`;
    case "consumed":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) ${event.need === "thirst" ? "drank" : "ate"} at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "behaviorChanged":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) switched behavior: ${event.from} -> ${event.to}`;
    case "killed":
      return `[tick ${event.tick}] ${event.predatorSpecies} (${event.predatorId}) killed ${event.preySpecies} (${event.preyId}) at (${event.pos.x},${event.pos.y})`;
    case "born":
      return `[tick ${event.tick}] ${event.species} (${event.motherId} x ${event.fatherId}) had offspring (${event.childId}) at (${event.pos.x},${event.pos.y})`;
    case "floraChanged":
      return `[tick ${event.tick}] flora ${event.stage} at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "fought":
      return `[tick ${event.tick}] ${event.attackerSpecies} (${event.attackerId}) hit ${event.defenderSpecies} (${event.defenderId}) for ${event.damage}${event.critical ? " (critical hit!)" : ""} (hp left: ${event.defenderHpRemaining})`;
    case "missed":
      return `[tick ${event.tick}] ${event.attackerSpecies} (${event.attackerId}) attacked ${event.defenderSpecies} (${event.defenderId}) and missed`;
    case "defeated":
      return `[tick ${event.tick}] ${event.winnerSpecies} (${event.winnerId}) defeated ${event.loserSpecies} (${event.loserId}) at (${event.pos.x},${event.pos.y})`;
    case "leveledUp":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) leveled up: ${event.fromLevel} -> ${event.toLevel} (exp ${event.exp})`;
    case "evolved":
      return `[tick ${event.tick}] ${event.agentId} evolved: ${event.fromSpecies} -> ${event.toSpecies} at level ${event.level}`;
    case "learnedMove":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) learned ${event.moveId} at level ${event.level}`;
    case "gainedSkillPoint":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) gained a ${event.pointType} skill point`;
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
