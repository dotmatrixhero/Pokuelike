import type { SimEvent } from "@pokuelike/engine";

/**
 * A short human-readable line per event kind — the browser-side equivalent
 * of `packages/runner/src/format.ts`'s `formatEvent`. Not literally shared
 * (this app has no dependency on `@pokuelike/runner`, a CLI-only package),
 * but intentionally the same shape/tone; keep them in sync by hand if an
 * event's fields change.
 */
export function formatEvent(event: SimEvent): string {
  switch (event.kind) {
    case "crossedLayer":
      return `${event.species} (${event.agentId}) crossed ${event.from} -> ${event.to}`;
    case "consumed":
      return `${event.species} (${event.agentId}) ${event.need === "thirst" ? "drank" : "ate"} on ${event.layer}`;
    case "behaviorChanged":
      return `${event.species} (${event.agentId}) switched behavior: ${event.from} -> ${event.to}`;
    case "killed":
      return `${event.predatorSpecies} (${event.predatorId}) killed ${event.preySpecies} (${event.preyId})`;
    case "born":
      return `${event.species} (${event.motherId} x ${event.fatherId}) had offspring ${event.childId} (${event.nature}, ${event.dispositionSummary})`;
    case "floraChanged":
      return `flora ${event.stage} at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "fought":
      return `${event.attackerSpecies} (${event.attackerId}) used ${event.moveId} on ${event.defenderSpecies} (${event.defenderId}) for ${event.damage}${event.critical ? " (crit!)" : ""} (hp left: ${event.defenderHpRemaining})`;
    case "missed":
      return `${event.attackerSpecies} (${event.attackerId}) used ${event.moveId} on ${event.defenderSpecies} (${event.defenderId}) and missed`;
    case "defeated":
      return `${event.winnerSpecies} (${event.winnerId}) defeated ${event.loserSpecies} (${event.loserId})`;
    case "starved":
      return `${event.species} (${event.agentId}) starved to death (${event.cause})`;
    case "diedOfAge":
      return `${event.species} (${event.agentId}) died of old age (${event.age} ticks)`;
    case "leveledUp":
      return `${event.species} (${event.agentId}) leveled up: ${event.fromLevel} -> ${event.toLevel}`;
    case "evolved":
      return `${event.agentId} evolved: ${event.fromSpecies} -> ${event.toSpecies} at level ${event.level}`;
    case "learnedMove":
      return `${event.species} (${event.agentId}) learned ${event.moveId} at level ${event.level}`;
    case "gainedSkillPoint":
      return `${event.species} (${event.agentId}) gained a ${event.pointType} skill point`;
    case "moveRespecced":
      return `${event.species} (${event.agentId}) specced ${event.moveId} into ${event.nodeId}`;
    case "fainted":
      return `${event.species} (${event.agentId}) fainted`;
    case "recovered":
      return `${event.species} (${event.agentId}) recovered consciousness at ${event.hp} hp`;
    case "looted":
      return `${event.looterSpecies} (${event.looterId}) looted ${event.itemKey} from ${event.fromSpecies} (${event.fromId})`;
    case "foodDelivered":
      return `${event.carrierSpecies} (${event.carrierId}) delivered food to ${event.receiverSpecies} (${event.receiverId})`;
    case "carrying":
      return `${event.carrierSpecies} (${event.carrierId}) picked up fainted ${event.carriedSpecies} (${event.carriedId})`;
    case "setDown":
      return `${event.carrierSpecies} (${event.carrierId}) set down ${event.carriedSpecies} (${event.carriedId}) (${event.reason})`;
    case "herdMigrating":
      return `herd ${event.herdId} is migrating (${event.reason})`;
    case "herdSettled":
      return `herd ${event.herdId} ${event.outcome === "arrived" ? "settled" : "gave up migrating"}`;
    case "nightfall":
      return `night falls (light ${event.lightLevel.toFixed(2)})`;
    case "daybreak":
      return `day breaks (light ${event.lightLevel.toFixed(2)})`;
    case "weatherChanged":
      return `${event.weatherType} ${event.phase === "began" ? "moves in" : "clears"} near (${event.center.x},${event.center.y})`;
    case "dispersed":
      return `${event.species} (${event.agentId}) left ${event.fromHerd} and ${event.outcome === "joined" ? `joined ${event.toHerd}` : `founded ${event.toHerd}`} (${event.reason})`;
    case "shelterBuilt":
      return `${event.species} (${event.agentId}) finished building a shelter at (${event.pos.x},${event.pos.y})`;
    case "shelterAbandoned":
      return `a shelter at (${event.pos.x},${event.pos.y}) was abandoned and fell into disrepair`;
    case "fellAsleep":
      return `${event.species} (${event.agentId}) fell asleep`;
    case "wokeUp":
      return `${event.species} (${event.agentId}) woke up (${event.reason === "urgentNeed" ? "hunger/thirst/mate drive" : "a threat was spotted"})`;
    case "longSleepBonus":
      return `${event.species} (${event.agentId}) got a long-sleep exp bonus (+${event.exp})`;
    case "statusInflicted":
      return `${event.species} (${event.agentId}) was ${event.statusKind === "burn" ? "burned" : event.statusKind === "poison" ? "poisoned" : event.statusKind} by ${event.inflictedBy}`;
    case "statusCleared":
      return `${event.species} (${event.agentId}) ${event.reason} (${event.statusKind})`;
    case "supported":
      return `${event.supporterSpecies} (${event.supporterId}) supported ${event.allySpecies} (${event.allyId})${event.healed ? " (healed)" : ""}${event.buffed ? " (buffed)" : ""}`;
  }
}

/**
 * The event kinds that make a story, per the maintainer's ask — get distinct
 * icon/color/size treatment in the log panel. Everything else renders
 * minimal. `shelterBuilt` earns a spot here the same way `dispersed` did: a
 * real milestone completing a multi-tick agent-driven task, not routine
 * environment upkeep. `shelterAbandoned`, by contrast, reads more like
 * `floraChanged`'s "died" stage — ambient world bookkeeping, not a story
 * beat — so it goes to `NOISE_KINDS` below instead.
 */
export const STORY_KINDS = new Set<SimEvent["kind"]>(["born", "killed", "defeated", "fainted", "evolved", "diedOfAge", "dispersed", "shelterBuilt"]);

/**
 * Routine environment/upkeep chatter — real events, just not "the Pokemon
 * stuff" most people watching the log actually want. Filtered out of the
 * panel by default (see EventLogPanel's `hideNoise`); a toggle brings them
 * back for anyone debugging flora/weather/migration systems directly.
 */
export const NOISE_KINDS = new Set<SimEvent["kind"]>([
  "crossedLayer",
  "consumed",
  "behaviorChanged",
  "floraChanged",
  "herdMigrating",
  "herdSettled",
  "nightfall",
  "daybreak",
  "weatherChanged",
  "gainedSkillPoint",
  "shelterAbandoned",
  "fellAsleep",
  "wokeUp",
]);

export const STORY_ICON: Partial<Record<SimEvent["kind"], string>> = {
  born: "\u{1F423}", // hatching chick
  killed: "⚔️", // crossed swords
  defeated: "\u{1F3F3}️", // white flag
  fainted: "\u{1F4AB}", // dizzy
  evolved: "✨", // sparkles
  diedOfAge: "\u{1F480}", // skull
  dispersed: "\u{1F9ED}", // compass
  shelterBuilt: "\u{1F3E0}", // house
};

export const STORY_COLOR: Partial<Record<SimEvent["kind"], string>> = {
  born: "#7be08a",
  killed: "#ff6b6b",
  defeated: "#ffb454",
  fainted: "#f5d76e",
  evolved: "#c792ea",
  diedOfAge: "#9aa0ab",
  dispersed: "#6ec6ff",
  shelterBuilt: "#c9a876",
};

/**
 * Every agent-id-shaped field across the whole `SimEvent` union, checked
 * generically rather than one `switch` arm per kind — cheap (a handful of
 * property reads on an object that's usually not a match) and future-proof
 * against a new event kind adding its own `xId` field later.
 */
export const AGENT_ID_FIELDS = [
  "agentId",
  "attackerId",
  "defenderId",
  "predatorId",
  "preyId",
  "motherId",
  "fatherId",
  "childId",
  "winnerId",
  "loserId",
  "looterId",
  "fromId",
  "carrierId",
  "carriedId",
  "receiverId",
] as const;

/** Does this event name `agentId` in any of its id-shaped fields? Used to scope the log panel to one agent's history. */
export function eventNamesAgent(event: SimEvent, agentId: string): boolean {
  const record = event as unknown as Record<string, unknown>;
  return AGENT_ID_FIELDS.some((field) => record[field] === agentId);
}
