import type { MoveSpec, SimEvent, World } from "@pokuelike/engine";

/**
 * The attacker's own live copy of the move it just used, if `world` still
 * has that agent around — reflects any skill-tree respec already baked into
 * `Agent.moves` (see `applyMoveTreeWithSpend`), not just the move's base
 * data. Only meaningful for `fought`/`missed`, the two event kinds that
 * carry both an `attackerId` and a `moveId`. Best-effort: the attacker may
 * since have died/been pruned, or its moveset changed since this exact hit
 * (a later respec) — this is read at log-render time, not snapshotted at
 * the moment the event fired, so it's "the move as currently built," which
 * is what the ask ("show what was used and all its build modifiers") is
 * really after rather than a strict historical record.
 */
function findMoveUsed(event: { attackerId: string; moveId: string }, world: World): MoveSpec | undefined {
  const attacker = world.agents.find((a) => a.id === event.attackerId);
  return attacker?.moves?.find((m) => m.id === event.moveId);
}

/**
 * Every optional `MoveSpec` field that represents a real build/skill-tree
 * modifier away from a plain vanilla attack, rendered only when actually
 * set (a move with none of these reads as empty, not padded with "no
 * lifesteal" noise). Deliberately generic over the whole field list rather
 * than special-cased per curated move, so a new modifier field added to
 * moves.ts shows up here without another edit.
 */
function describeMoveModifiers(move: MoveSpec): string {
  const parts: string[] = [];
  if (move.critRateStage) parts.push(`crit+${move.critRateStage}`);
  if (move.hits) parts.push(`${move.hits.min}-${move.hits.max} hits`);
  if (move.weightScaling) parts.push(`weight x${move.weightScaling.factor}`);
  if (move.lifestealFraction) parts.push(`lifesteal ${Math.round(move.lifestealFraction * 100)}%`);
  if (move.recoilFraction) parts.push(`recoil ${Math.round(move.recoilFraction * 100)}%`);
  if (move.defensePenetration) parts.push(`pen ${Math.round(move.defensePenetration * 100)}%`);
  if (move.jamCooldownTicks) parts.push(`jam +${move.jamCooldownTicks}`);
  if (move.lockTicks) parts.push(`lock +${move.lockTicks}`);
  if (move.statusChance && move.statusKind) parts.push(`${Math.round(move.statusChance * 100)}% ${move.statusKind}${move.statusSpreads ? " (spreads)" : ""}`);
  if (move.situationalBonus) parts.push(`${move.situationalBonus.condition} x${move.situationalBonus.multiplier}`);
  if (move.selfStateBonus) parts.push(`${move.selfStateBonus.condition} scoring x${move.selfStateBonus.multiplier}`);
  if (move.statChangeOnHit) parts.push(`${move.statChangeOnHit.target} ${move.statChangeOnHit.stat} ${move.statChangeOnHit.stage > 0 ? "+" : ""}${move.statChangeOnHit.stage}`);
  if (move.positionSwap) parts.push("swap");
  if (move.hitsArea) parts.push("area");
  if (move.forcedMovement) parts.push(`${move.forcedMovement.mover} ${move.forcedMovement.tiles} tiles`);
  if (move.bonusVsType) parts.push(`vs ${move.bonusVsType.type} x${move.bonusVsType.multiplier}`);
  if (move.resistanceBreaker) parts.push(`resist-break x${move.resistanceBreaker.multiplier}`);
  if (move.selfCostPerUse) parts.push(`costs ${Math.round(move.selfCostPerUse.amount * 100)}% ${move.selfCostPerUse.need}`);
  if (move.terrainBurn) parts.push("burns terrain");
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

/**
 * A short human-readable line per event kind — the browser-side equivalent
 * of `packages/runner/src/format.ts`'s `formatEvent`. Not literally shared
 * (this app has no dependency on `@pokuelike/runner`, a CLI-only package),
 * but intentionally the same shape/tone; keep them in sync by hand if an
 * event's fields change. `world`, when given, additionally resolves the
 * attacker's live move for `fought`/`missed` so their line can show its
 * current build modifiers — omit it (or pass none) to get the same plain
 * text as before this existed.
 */
export function formatEvent(event: SimEvent, world?: World): string {
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
    case "terrainChanged":
      return `${event.from} at (${event.pos.x},${event.pos.y}) turned to ${event.to} on ${event.layer} (${event.cause})`;
    case "immigrated":
      return `${event.agentIds.length} ${event.species} arrived from outside and ${event.outcome === "joined" ? `joined ${event.herdId}` : `founded ${event.herdId}`} on ${event.layer}`;
    case "fought": {
      const move = world ? findMoveUsed(event, world) : undefined;
      return `${event.attackerSpecies} (${event.attackerId}) used ${event.moveId} on ${event.defenderSpecies} (${event.defenderId}) for ${event.damage}${event.critical ? " (crit!)" : ""} (hp left: ${event.defenderHpRemaining})${move ? describeMoveModifiers(move) : ""}`;
    }
    case "missed": {
      const move = world ? findMoveUsed(event, world) : undefined;
      return `${event.attackerSpecies} (${event.attackerId}) used ${event.moveId} on ${event.defenderSpecies} (${event.defenderId}) and missed${move ? describeMoveModifiers(move) : ""}`;
    }
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
    case "herdClash": {
      const rival = event.attackerHerdId && event.defenderHerdId && event.attackerHerdId !== event.defenderHerdId ? ` (herd ${event.attackerHerdId} vs ${event.defenderHerdId})` : "";
      if (event.outcome === "missed") return `${event.attackerSpecies} (${event.attackerId}) clashed with ${event.defenderSpecies} (${event.defenderId}) over a resource and missed${rival}`;
      const retreat = event.outcome === "retreated" ? `, ${event.defenderSpecies} (${event.defenderId}) backs off` : "";
      return `${event.attackerSpecies} (${event.attackerId}) clashed with ${event.defenderSpecies} (${event.defenderId}) over a resource for ${event.damage}${event.critical ? " (crit!)" : ""}${retreat}${rival}`;
    }
    case "packHunt":
      return `${event.attackerSpecies} (${event.attackerId}) pack-hunts ${event.targetSpecies} (${event.targetId}) with ${event.packmates} packmate${event.packmates === 1 ? "" : "s"}`;
    case "scavenged":
      return `${event.species} (${event.agentId}) scavenged a meal from ${event.corpseSpecies} (${event.corpseId})`;
  }
}

/**
 * The event kinds that make a story, per the maintainer's ask — get distinct
 * icon/color/size treatment in the log panel. Everything else renders
 * minimal. `shelterBuilt` earns a spot here the same way `dispersed` did: a
 * real milestone completing a multi-tick agent-driven task, not routine
 * environment upkeep. `shelterAbandoned`, by contrast, reads more like
 * `floraChanged`'s "died" stage — ambient world bookkeeping, not a story
 * beat — so it goes to `NOISE_KINDS` below instead. `fought` earns a spot
 * too, per direct ask ("want more of an animation... when a user uses a
 * move. want to see it") — a landed, damaging hit is the moment worth a
 * pop on the map; `missed` deliberately stays out of both this set and
 * `NOISE_KINDS` (plain/small in the log, no popup) since a miss is real
 * information but not a moment worth the same visual weight as a
 * connecting hit.
 */
export const STORY_KINDS = new Set<SimEvent["kind"]>(["born", "killed", "defeated", "fainted", "evolved", "diedOfAge", "dispersed", "shelterBuilt", "fought", "immigrated", "herdClash", "packHunt"]);

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
  "terrainChanged",
  "herdMigrating",
  "herdSettled",
  "nightfall",
  "daybreak",
  "weatherChanged",
  "gainedSkillPoint",
  "moveRespecced",
  "shelterAbandoned",
  "fellAsleep",
  "wokeUp",
  // Real feeding, but the same "routine, not a moment" bucket `consumed`
  // (self-feeding on flora) already occupies — a scavenged meal is a genuine
  // alternative to a live hunt, not on the visual weight of one.
  "scavenged",
]);

/**
 * The real headline events — births, true deaths, and evolutions — for a
 * long-lived "quiet mode" that skips even the rest of `STORY_KINDS` (a
 * fight landing, a shelter completing, a dispersal). Direct ask: watching a
 * long run, sometimes you just want population-shaping moments, not every
 * fight. `killed`/`defeated`/`starved`/`diedOfAge` are all real, permanent
 * deaths (`Agent.alive` newly `false`); `fainted` is deliberately excluded
 * — it's a recoverable knockdown, not a death (see DESIGN.md's "Faint/
 * finish-off" section).
 */
// "immigrated" is a population-shaping event, same category as
// "born"/"evolved" — a new headline-worthy way the population changes, not
// a routine per-tick occurrence like "consumed"/"behaviorChanged".
export const HEADLINE_KINDS = new Set<SimEvent["kind"]>(["born", "killed", "defeated", "starved", "diedOfAge", "evolved", "immigrated"]);

export const STORY_ICON: Partial<Record<SimEvent["kind"], string>> = {
  born: "\u{1F423}", // hatching chick
  killed: "⚔️", // crossed swords
  defeated: "\u{1F3F3}️", // white flag
  fainted: "\u{1F4AB}", // dizzy
  evolved: "✨", // sparkles
  diedOfAge: "\u{1F480}", // skull
  dispersed: "\u{1F9ED}", // compass
  shelterBuilt: "\u{1F3E0}", // house
  fought: "\u{1F4A5}", // boom
  immigrated: "\u{1F6F6}", // canoe
  herdClash: "\u{1F93C}", // wrestlers — rivalry, not a hunt
  packHunt: "\u{1F43A}", // wolf — coordinated hunting
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
  fought: "#ff9d3c",
  immigrated: "#5ee6c4",
  herdClash: "#e0c341",
  packHunt: "#d16b4c",
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
  "targetId",
  "corpseId",
] as const;

/** Does this event name `agentId` in any of its id-shaped fields? Used to scope the log panel to one agent's history. */
export function eventNamesAgent(event: SimEvent, agentId: string): boolean {
  const record = event as unknown as Record<string, unknown>;
  return AGENT_ID_FIELDS.some((field) => record[field] === agentId);
}
