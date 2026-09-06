import type { MoveSpec, SimEvent, World } from "@pokuelike/engine";
import { TITLE_DISPLAY_NAME, herdDisplayName, idLabel, shortId } from "./notableTitles.js";

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
export function findMoveUsed(event: { attackerId: string; moveId: string }, world: World): MoveSpec | undefined {
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
      return `${idLabel(world, event.agentId, event.species)} crossed ${event.from} -> ${event.to}`;
    case "consumed":
      return `${idLabel(world, event.agentId, event.species)} ${event.need === "thirst" ? "drank" : "ate"} on ${event.layer}`;
    case "behaviorChanged":
      return `${idLabel(world, event.agentId, event.species)} switched behavior: ${event.from} -> ${event.to}`;
    case "killed":
      return `${idLabel(world, event.predatorId, event.predatorSpecies)} killed ${idLabel(world, event.preyId, event.preySpecies)}`;
    case "born":
      return `${idLabel(world, event.motherId, event.species)} x ${idLabel(world, event.fatherId, event.species)} had offspring ${idLabel(world, event.childId, event.species)} (${event.nature}, ${event.dispositionSummary})`;
    case "floraChanged":
      return `flora ${event.stage} at (${event.pos.x},${event.pos.y}) on ${event.layer}`;
    case "terrainChanged":
      return `${event.from} at (${event.pos.x},${event.pos.y}) turned to ${event.to} on ${event.layer} (${event.cause})`;
    case "immigrated": {
      const herdName = world ? herdDisplayName(world, event.herdId) : event.herdId;
      return `${event.agentIds.length} ${event.species} arrived from outside and ${event.outcome === "joined" ? `joined ${herdName}` : `founded ${herdName}`} on ${event.layer}`;
    }
    case "fought": {
      const move = world ? findMoveUsed(event, world) : undefined;
      return `${idLabel(world, event.attackerId, event.attackerSpecies)} used ${event.moveId} on ${idLabel(world, event.defenderId, event.defenderSpecies)} for ${event.damage}${event.critical ? " (crit!)" : ""} (hp left: ${event.defenderHpRemaining})${move ? describeMoveModifiers(move) : ""}`;
    }
    case "missed": {
      const move = world ? findMoveUsed(event, world) : undefined;
      return `${idLabel(world, event.attackerId, event.attackerSpecies)} used ${event.moveId} on ${idLabel(world, event.defenderId, event.defenderSpecies)} and missed${move ? describeMoveModifiers(move) : ""}`;
    }
    case "defeated":
      return `${idLabel(world, event.winnerId, event.winnerSpecies)} defeated ${idLabel(world, event.loserId, event.loserSpecies)}`;
    case "starved":
      return `${idLabel(world, event.agentId, event.species)} starved to death (${event.cause})`;
    case "diedOfAge":
      return `${idLabel(world, event.agentId, event.species)} died of old age (${event.age} ticks)`;
    case "leveledUp":
      return `${idLabel(world, event.agentId, event.species)} leveled up: ${event.fromLevel} -> ${event.toLevel}`;
    case "evolved":
      return `${idLabel(world, event.agentId, event.fromSpecies)} evolved: ${event.fromSpecies} -> ${event.toSpecies} at level ${event.level}`;
    case "learnedMove":
      return `${idLabel(world, event.agentId, event.species)} learned ${event.moveId} at level ${event.level}`;
    case "gainedSkillPoint":
      return `${idLabel(world, event.agentId, event.species)} gained a ${event.pointType} skill point`;
    case "moveRespecced":
      return `${idLabel(world, event.agentId, event.species)} specced ${event.moveId} into ${event.nodeId}`;
    case "fainted":
      return `${idLabel(world, event.agentId, event.species)} fainted`;
    case "recovered":
      return `${idLabel(world, event.agentId, event.species)} recovered consciousness at ${event.hp} hp`;
    case "looted":
      return `${idLabel(world, event.looterId, event.looterSpecies)} looted ${event.itemKey} from ${idLabel(world, event.fromId, event.fromSpecies)}`;
    case "foodDelivered":
      return `${idLabel(world, event.carrierId, event.carrierSpecies)} delivered food to ${idLabel(world, event.receiverId, event.receiverSpecies)}`;
    case "carrying":
      return `${idLabel(world, event.carrierId, event.carrierSpecies)} picked up fainted ${idLabel(world, event.carriedId, event.carriedSpecies)}`;
    case "setDown":
      return `${idLabel(world, event.carrierId, event.carrierSpecies)} set down ${idLabel(world, event.carriedId, event.carriedSpecies)} (${event.reason})`;
    case "herdMigrating": {
      const herdName = world ? herdDisplayName(world, event.herdId) : event.herdId;
      return `herd ${herdName} is migrating (${event.reason})`;
    }
    case "herdSettled": {
      const herdName = world ? herdDisplayName(world, event.herdId) : event.herdId;
      return `herd ${herdName} ${event.outcome === "arrived" ? "settled" : "gave up migrating"}`;
    }
    case "nightfall":
      return `night falls (light ${event.lightLevel.toFixed(2)})`;
    case "daybreak":
      return `day breaks (light ${event.lightLevel.toFixed(2)})`;
    case "weatherChanged":
      return `${event.weatherType} ${event.phase === "began" ? "moves in" : "clears"} near (${event.center.x},${event.center.y})`;
    case "macroWeatherChanged":
      return `a macro ${event.weatherType} ${event.phase === "began" ? "front forms" : "front dissipates"} around zone (${event.row},${event.col}), radius ${event.radius}`;
    case "dispersed":
      return `${idLabel(world, event.agentId, event.species)} left ${event.fromHerd} and ${event.outcome === "joined" ? `joined ${event.toHerd}` : `founded ${event.toHerd}`} (${event.reason})`;
    case "shelterBuilt":
      return `${idLabel(world, event.agentId, event.species)} finished building a shelter at (${event.pos.x},${event.pos.y})`;
    case "shelterAbandoned":
      return `a shelter at (${event.pos.x},${event.pos.y}) was abandoned and fell into disrepair`;
    case "fellAsleep":
      return `${idLabel(world, event.agentId, event.species)} fell asleep`;
    case "wokeUp":
      return `${idLabel(world, event.agentId, event.species)} woke up (${event.reason === "urgentNeed" ? "hunger/thirst/mate drive" : "a threat was spotted"})`;
    case "longSleepBonus":
      return `${idLabel(world, event.agentId, event.species)} got a long-sleep exp bonus (+${event.exp})`;
    case "statusInflicted":
      return `${idLabel(world, event.agentId, event.species)} was ${event.statusKind === "burn" ? "burned" : event.statusKind === "poison" ? "poisoned" : event.statusKind} by ${shortId(event.inflictedBy)}`;
    case "statusCleared":
      return `${idLabel(world, event.agentId, event.species)} ${event.reason} (${event.statusKind})`;
    case "supported":
      return `${idLabel(world, event.supporterId, event.supporterSpecies)} supported ${idLabel(world, event.allyId, event.allySpecies)}${event.healed ? " (healed)" : ""}${event.buffed ? " (buffed)" : ""}`;
    case "herdClash": {
      // Direct ask: "I am not seeing moves being used in 'clash'. Just hp
      // being lost. Better logs please" — same "used <moveId>" convention
      // (and live-moveset lookup for its build modifiers) as "fought"/
      // "missed" above, which herdClash never had of its own until now.
      const move = world ? findMoveUsed(event, world) : undefined;
      const rival = event.attackerHerdId && event.defenderHerdId && event.attackerHerdId !== event.defenderHerdId ? ` (herd ${event.attackerHerdId} vs ${event.defenderHerdId})` : "";
      if (event.outcome === "missed") {
        return `${idLabel(world, event.attackerId, event.attackerSpecies)} used ${event.moveId} on ${idLabel(world, event.defenderId, event.defenderSpecies)} over a resource and missed${move ? describeMoveModifiers(move) : ""}${rival}`;
      }
      const retreat = event.outcome === "retreated" ? `, ${idLabel(world, event.defenderId, event.defenderSpecies)} backs off` : "";
      return `${idLabel(world, event.attackerId, event.attackerSpecies)} used ${event.moveId} on ${idLabel(world, event.defenderId, event.defenderSpecies)} over a resource for ${event.damage}${event.critical ? " (crit!)" : ""} (hp left: ${event.defenderHpRemaining})${move ? describeMoveModifiers(move) : ""}${retreat}${rival}`;
    }
    case "packHunt":
      return `${idLabel(world, event.attackerId, event.attackerSpecies)} pack-hunts ${idLabel(world, event.targetId, event.targetSpecies)} with ${event.packmates} packmate${event.packmates === 1 ? "" : "s"}`;
    case "scavenged":
      return `${idLabel(world, event.agentId, event.species)} scavenged a meal from ${idLabel(world, event.corpseId, event.corpseSpecies)}`;
    case "bonded":
      return `${idLabel(world, event.agentId, event.species)} bonded with ${idLabel(world, event.partnerId, event.partnerSpecies)}`;
    case "eggLaid":
      return `${idLabel(world, event.motherId, event.species)} x ${idLabel(world, event.fatherId, event.species)} laid an egg (${shortId(event.eggId)}) at (${event.pos.x},${event.pos.y})`;
    case "eggHatched":
      return `${idLabel(world, event.agentId, event.species)} hatched at (${event.pos.x},${event.pos.y})`;
    case "eggEaten":
      return `${idLabel(world, event.eaterId, event.eaterSpecies)} ate a ${event.eggSpecies} egg (${shortId(event.eggId)})`;
    case "eggDefended":
      return `${idLabel(world, event.defenderId, event.defenderSpecies)} fought off ${idLabel(world, event.threatId, event.threatSpecies)} to defend its egg`;
    case "titleClaimed":
      return `${idLabel(world, event.agentId, event.species)} became ${TITLE_DISPLAY_NAME[event.title]}!`;
    case "titleLost":
      return `${idLabel(world, event.agentId, event.species)} is no longer ${TITLE_DISPLAY_NAME[event.title]} (${event.reason})`;
    case "leadershipClaimed": {
      const herdName = world ? herdDisplayName(world, event.herdId) : event.herdId;
      return `${idLabel(world, event.agentId, event.species)} now leads herd ${herdName}`;
    }
    case "leadershipLost":
      return `${idLabel(world, event.agentId, event.species)} no longer leads its herd (${event.reason})`;
    case "regionDemoted": {
      const counts = Object.entries(event.speciesCounts).map(([species, count]) => `${species}: ${count}`).join(", ");
      return `region ${event.regionId} demoted to abstract (${counts || "no living population"})`;
    }
    case "regionPromoted":
      return `region ${event.regionId} promoted to full sim (${event.agentIds.length} individuals invented)`;
    case "regionPopulationBoom":
      return `region ${event.regionId}'s ${event.species} population is booming (~${event.population})`;
    case "regionDieOff":
      return `region ${event.regionId}'s ${event.species} population is dying off (~${event.population})`;
    case "regionEmigrated":
      return `~${event.population} ${event.species} of herd ${event.herdId} emigrated from region ${event.fromRegionId} to region ${event.toRegionId}`;
    case "regionCrossed":
      return `${idLabel(world, event.agentId, event.species)} crossed from region ${event.fromRegionId} into region ${event.toRegionId}, joining herd ${event.herdId}`;
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
export const STORY_KINDS = new Set<SimEvent["kind"]>([
  "born",
  "killed",
  "defeated",
  "fainted",
  "evolved",
  "diedOfAge",
  "dispersed",
  "shelterBuilt",
  "fought",
  "immigrated",
  "herdClash",
  "packHunt",
  "eggLaid",
  "eggHatched",
  "eggEaten",
  "eggDefended",
  "titleClaimed",
  "leadershipClaimed",
  "regionPromoted",
  "regionDemoted",
  "regionPopulationBoom",
  "regionDieOff",
  // The individual half of the migration-edges stretch goal — a real
  // disperser leaving the map entirely, the cross-region analog of
  // `dispersed` (already in this set) rather than `regionEmigrated`'s
  // routine abstract-tier population-slice roll (NOISE_KINDS).
  "regionCrossed",
  // Deliberately rare and dramatic (see `MACRO_WEATHER_SPAWN_CHANCE_PER_TICK`
  // in overworld.ts) — a handful per run, not ambient churn, so it earns a
  // story beat rather than joining `weatherChanged`'s own per-tile-scale
  // entry in NOISE_KINDS below.
  "macroWeatherChanged",
]);

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
  // A pair forming a bond happens routinely (every eligible contact before
  // shelter access exists) — the real milestones are `eggLaid` (an egg
  // finally exists) and `eggHatched` (a real newborn), both in STORY_KINDS.
  "bonded",
  // A title changing hands away from an agent — either a real death (already
  // its own headline event: `killed`/`starved`/`diedOfAge`) or a dethroning,
  // which reads as the mirror image of the `titleClaimed` moment that
  // already got the spotlight — not its own second headline.
  "titleLost",
  // Same reasoning as `titleLost` immediately above — a leader stepping
  // down is the mirror image of `leadershipClaimed` (already a STORY_KINDS
  // moment), not its own second headline.
  "leadershipLost",
  // The abstract tier's cheap population-transfer roll (overworld.ts's
  // `maybeEmigrate`) — real, but routine background-region bookkeeping, not
  // a moment involving any individual the player has ever seen.
  "regionEmigrated",
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
export const HEADLINE_KINDS = new Set<SimEvent["kind"]>([
  "born",
  "killed",
  "defeated",
  "starved",
  "diedOfAge",
  "evolved",
  "immigrated",
  "eggHatched",
  "regionPromoted",
  "regionDemoted",
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
  fought: "\u{1F4A5}", // boom
  immigrated: "\u{1F6F6}", // canoe
  herdClash: "\u{1F93C}", // wrestlers — rivalry, not a hunt
  packHunt: "\u{1F43A}", // wolf — coordinated hunting
  eggLaid: "\u{1F95A}", // egg
  eggHatched: "\u{1F423}", // hatching chick
  eggEaten: "\u{1F374}", // fork and knife
  eggDefended: "\u{1F6E1}️", // shield
  titleClaimed: "\u{1F451}", // crown
  leadershipClaimed: "\u{1F396}️", // military medal — matches notableTitles.ts's LEADER_ICON
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
  eggLaid: "#e8d48a",
  eggHatched: "#7be08a",
  eggEaten: "#ff6b6b",
  eggDefended: "#5ee6c4",
  titleClaimed: "#ffd76e",
  leadershipClaimed: "#a0c9ff",
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
  // Added alongside auto-camera's per-event log filtering (see autoCamera.ts)
  // — these were always real agent/egg-id-shaped fields the original list
  // just hadn't gotten to yet (bonded/egg events didn't exist when this list
  // was first written); including them here makes the single-agent click-to-
  // filter behavior more complete too, e.g. clicking a bonded partner now
  // surfaces the "bonded" row it's named in.
  "partnerId",
  "eggId",
  "eaterId",
  "threatId",
] as const;

/** Does this event name `agentId` in any of its id-shaped fields? Used to scope the log panel to one agent's history. */
export function eventNamesAgent(event: SimEvent, agentId: string): boolean {
  const record = event as unknown as Record<string, unknown>;
  return AGENT_ID_FIELDS.some((field) => record[field] === agentId);
}

/**
 * Does this event name ANY of `ids` in any id-shaped field, including the
 * multi-id `agentIds` array (`immigrated`)? The generic-across-`ids` sibling
 * of `eventNamesAgent` — auto-camera's "more specific" log filter (see
 * `autoCamera.ts`) needs to match a small *set* of participants (both sides
 * of a fight, an egg plus both its parents), not just one agent.
 */
export function eventNamesAnyOf(event: SimEvent, ids: ReadonlySet<string>): boolean {
  const record = event as unknown as Record<string, unknown>;
  if (AGENT_ID_FIELDS.some((field) => typeof record[field] === "string" && ids.has(record[field] as string))) return true;
  const many = record["agentIds"];
  return Array.isArray(many) && many.some((id) => ids.has(id as string));
}
