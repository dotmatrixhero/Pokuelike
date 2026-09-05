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
      return `[tick ${event.tick}] ${event.species} (${event.motherId} x ${event.fatherId}) had offspring ${event.childId} (${event.nature}, ${event.dispositionSummary}) at (${event.pos.x},${event.pos.y})`;
    case "floraChanged":
      return `[tick ${event.tick}] flora ${event.stage} at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "terrainChanged":
      return `[tick ${event.tick}] ${event.from} at (${event.pos.x},${event.pos.y}) on ${event.layer} turned to ${event.to} (${event.cause})`;
    case "fought":
      return `[tick ${event.tick}] ${event.attackerSpecies} (${event.attackerId}) used ${event.moveId} on ${event.defenderSpecies} (${event.defenderId}) at (${event.pos.x},${event.pos.y}) for ${event.damage}${event.critical ? " (critical hit!)" : ""} (hp left: ${event.defenderHpRemaining})`;
    case "missed":
      return `[tick ${event.tick}] ${event.attackerSpecies} (${event.attackerId}) used ${event.moveId} on ${event.defenderSpecies} (${event.defenderId}) at (${event.pos.x},${event.pos.y}) and missed`;
    case "defeated":
      return `[tick ${event.tick}] ${event.winnerSpecies} (${event.winnerId}) defeated ${event.loserSpecies} (${event.loserId}) at (${event.pos.x},${event.pos.y})`;
    case "starved":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) starved to death (${event.cause}) at (${event.pos.x},${event.pos.y})`;
    case "diedOfAge":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) died of old age (${event.age} ticks) at (${event.pos.x},${event.pos.y})`;
    case "leveledUp":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) leveled up: ${event.fromLevel} -> ${event.toLevel} (exp ${event.exp})`;
    case "evolved":
      return `[tick ${event.tick}] ${event.agentId} evolved: ${event.fromSpecies} -> ${event.toSpecies} at level ${event.level}`;
    case "learnedMove":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) learned ${event.moveId} at level ${event.level}`;
    case "gainedSkillPoint":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) gained a ${event.pointType} skill point`;
    case "moveRespecced":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) specced ${event.moveId} into ${event.nodeId}`;
    case "fainted":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) fainted at (${event.pos.x},${event.pos.y})`;
    case "recovered":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) recovered consciousness at ${event.hp} hp`;
    case "looted":
      return `[tick ${event.tick}] ${event.looterSpecies} (${event.looterId}) looted ${event.itemKey} from ${event.fromSpecies} (${event.fromId})`;
    case "foodDelivered":
      return `[tick ${event.tick}] ${event.carrierSpecies} (${event.carrierId}) delivered food to ${event.receiverSpecies} (${event.receiverId})`;
    case "carrying":
      return `[tick ${event.tick}] ${event.carrierSpecies} (${event.carrierId}) picked up fainted ${event.carriedSpecies} (${event.carriedId})`;
    case "setDown":
      return `[tick ${event.tick}] ${event.carrierSpecies} (${event.carrierId}) set down ${event.carriedSpecies} (${event.carriedId}) (${event.reason})`;
    case "herdMigrating":
      return `[tick ${event.tick}] herd ${event.herdId} is migrating from (${event.from.x},${event.from.y}) to (${event.to.x},${event.to.y}) — ${event.reason}`;
    case "herdSettled":
      return `[tick ${event.tick}] herd ${event.herdId} ${event.outcome === "arrived" ? "settled" : "gave up migrating"} near (${event.pos.x},${event.pos.y})`;
    case "nightfall":
      return `[tick ${event.tick}] night falls (light ${event.lightLevel.toFixed(2)})`;
    case "daybreak":
      return `[tick ${event.tick}] day breaks (light ${event.lightLevel.toFixed(2)})`;
    case "weatherChanged":
      return `[tick ${event.tick}] ${event.weatherType} ${event.phase === "began" ? "moves in" : "clears"} near (${event.center.x},${event.center.y}), radius ${event.radius}`;
    case "dispersed":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) left ${event.fromHerd} and ${event.outcome === "joined" ? `joined ${event.toHerd}` : `founded ${event.toHerd}`} (${event.reason})`;
    case "immigrated":
      return `[tick ${event.tick}] ${event.agentIds.length} ${event.species} arrived from outside at (${event.pos.x},${event.pos.y}) on ${event.layer} and ${event.outcome === "joined" ? `joined ${event.herdId}` : `founded ${event.herdId}`} (${event.agentIds.join(", ")})`;
    case "shelterBuilt":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) finished building a shelter at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "shelterAbandoned":
      return `[tick ${event.tick}] a shelter at (${event.pos.x},${event.pos.y}) on ${event.layer} was abandoned and fell into disrepair`;
    case "fellAsleep":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) fell asleep at (${event.pos.x},${event.pos.y})`;
    case "wokeUp":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) woke up at (${event.pos.x},${event.pos.y}) (${event.reason})`;
    case "longSleepBonus":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) got a long-sleep exp bonus (+${event.exp}) at (${event.pos.x},${event.pos.y})`;
    case "statusInflicted":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) was ${event.statusKind === "burn" ? "burned" : event.statusKind === "poison" ? "poisoned" : event.statusKind} by ${event.inflictedBy}`;
    case "statusCleared":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) ${event.reason} (${event.statusKind})`;
    case "supported":
      return `[tick ${event.tick}] ${event.supporterSpecies} (${event.supporterId}) supported ${event.allySpecies} (${event.allyId})${event.healed ? " (healed)" : ""}${event.buffed ? " (buffed)" : ""}`;
    case "herdClash": {
      const rival = event.attackerHerdId && event.defenderHerdId && event.attackerHerdId !== event.defenderHerdId ? ` (herd ${event.attackerHerdId} vs ${event.defenderHerdId})` : "";
      if (event.outcome === "missed") {
        return `[tick ${event.tick}] ${event.attackerSpecies} (${event.attackerId}) clashed with ${event.defenderSpecies} (${event.defenderId}) over a resource at (${event.pos.x},${event.pos.y}) and missed${rival}`;
      }
      const retreat = event.outcome === "retreated" ? `, ${event.defenderSpecies} (${event.defenderId}) backs off` : "";
      return `[tick ${event.tick}] ${event.attackerSpecies} (${event.attackerId}) clashed with ${event.defenderSpecies} (${event.defenderId}) over a resource at (${event.pos.x},${event.pos.y}) for ${event.damage}${event.critical ? " (critical hit!)" : ""}${retreat}${rival}`;
    }
    case "packHunt":
      return `[tick ${event.tick}] ${event.attackerSpecies} (${event.attackerId}) pack-hunts ${event.targetSpecies} (${event.targetId}) at (${event.pos.x},${event.pos.y}) with ${event.packmates} packmate${event.packmates === 1 ? "" : "s"}`;
    case "scavenged":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) scavenged a meal from ${event.corpseSpecies} (${event.corpseId}) at (${event.pos.x},${event.pos.y})`;
    case "bonded":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) bonded with ${event.partnerSpecies} (${event.partnerId}) at (${event.pos.x},${event.pos.y})`;
    case "eggLaid":
      return `[tick ${event.tick}] ${event.species} (${event.motherId} x ${event.fatherId}) laid an egg (${event.eggId}) at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "eggHatched":
      return `[tick ${event.tick}] ${event.species} egg (${event.agentId}) hatched at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "eggEaten":
      return `[tick ${event.tick}] ${event.eaterSpecies} (${event.eaterId}) ate a ${event.eggSpecies} egg (${event.eggId}) at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "eggDefended":
      return `[tick ${event.tick}] ${event.defenderSpecies} (${event.defenderId}) fought off ${event.threatSpecies} (${event.threatId}) to defend its egg at (${event.pos.x},${event.pos.y})`;
    case "titleClaimed":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) became The ${event.title[0]!.toUpperCase()}${event.title.slice(1)} (value ${event.value})${event.previousHolderId ? `, taking it from ${event.previousHolderId}` : ""}`;
    case "titleLost":
      return `[tick ${event.tick}] ${event.species} (${event.agentId}) lost The ${event.title[0]!.toUpperCase()}${event.title.slice(1)} (${event.reason})`;
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
