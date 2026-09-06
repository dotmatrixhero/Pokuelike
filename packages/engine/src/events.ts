import type { Agent, BehaviorKind, DispersalReason, Layer, MigrationReason, NotableTitleId, StatusKind, TerrainKind, Vec2, WeatherType, World } from "./types.js";
import type { PokemonType } from "./typing.js";

export type SimEvent =
  | {
      kind: "crossedLayer";
      tick: number;
      agentId: string;
      species: string;
      from: Layer;
      to: Layer;
      pos: Vec2;
    }
  | {
      kind: "consumed";
      tick: number;
      agentId: string;
      species: string;
      layer: Layer;
      pos: Vec2;
      need: "hunger" | "thirst";
    }
  | {
      kind: "behaviorChanged";
      tick: number;
      agentId: string;
      species: string;
      from: BehaviorKind;
      to: BehaviorKind;
    }
  | {
      kind: "killed";
      tick: number;
      predatorId: string;
      predatorSpecies: string;
      preyId: string;
      preySpecies: string;
      pos: Vec2;
    }
  | {
      kind: "born";
      tick: number;
      motherId: string;
      fatherId: string;
      childId: string;
      species: string;
      layer: Layer;
      pos: Vec2;
      /** The newborn's randomly-assigned Nature (nature.ts) — narrative color, see DESIGN.md. */
      nature: string;
      /** A short tag for the newborn's most distinctive Disposition axis, e.g. "high boldness" — see `dispositionSummary`. */
      dispositionSummary: string;
    }
  | {
      kind: "floraChanged";
      tick: number;
      layer: Layer;
      pos: Vec2;
      stage: "seeded" | "sprouted" | "died" | "overgrazed" | "recovered";
      /** Set on "sprouted" only — which specific plant it grew into (see flora.ts). */
      flavor?: string;
    }
  | {
      kind: "fought";
      tick: number;
      attackerId: string;
      attackerSpecies: string;
      defenderId: string;
      defenderSpecies: string;
      damage: number;
      defenderHpRemaining: number;
      critical: boolean;
      /** The move actually used — see predation.ts's `resolveHit`, which already has it in scope from `pickBestMove`. */
      moveId: string;
      /** The defender's position at the moment of the hit — matches every other combat-adjacent event (`killed`/`fainted`/`defeated`). */
      pos: Vec2;
      /**
       * True when the defender was already fainted (unconscious, hp already
       * at 0) BEFORE this hit landed — a finishing-blow hit against a downed
       * body (`predation.ts`'s `finishingPool` mechanic: a mob keeps hitting
       * an already-fainted predator across several ticks until it's truly
       * dead). Absent/`false` for an ordinary hit. Consumers that show a live
       * play-by-play (the web app's event log, battle screen, and map
       * popups) use this to skip re-announcing "0 HP" every one of those
       * ticks — real, direct ask: "if a unit is already fainted it shouldn't
       * say 0 hp in the log... just fast forward to the death" — while the
       * eventual `killed`/`defeated` event (unaffected by this flag) still
       * always fires and is always shown.
       */
      finishingBlow?: boolean;
    }
  | {
      kind: "missed";
      tick: number;
      attackerId: string;
      attackerSpecies: string;
      defenderId: string;
      defenderSpecies: string;
      /** The move actually used — see predation.ts's `resolveHit`, which already has it in scope from `pickBestMove`. */
      moveId: string;
      /** The defender's position at the moment of the attack — matches every other combat-adjacent event (`killed`/`fainted`/`defeated`). */
      pos: Vec2;
    }
  | {
      kind: "defeated";
      tick: number;
      winnerId: string;
      winnerSpecies: string;
      loserId: string;
      loserSpecies: string;
      pos: Vec2;
    }
  | {
      kind: "starved";
      tick: number;
      agentId: string;
      species: string;
      pos: Vec2;
      cause: "hunger" | "thirst";
    }
  | {
      kind: "diedOfAge";
      tick: number;
      agentId: string;
      species: string;
      pos: Vec2;
      age: number;
    }
  | {
      kind: "leveledUp";
      tick: number;
      agentId: string;
      species: string;
      fromLevel: number;
      toLevel: number;
      exp: number;
    }
  | {
      kind: "evolved";
      tick: number;
      agentId: string;
      fromSpecies: string;
      toSpecies: string;
      level: number;
    }
  | {
      kind: "learnedMove";
      tick: number;
      agentId: string;
      species: string;
      moveId: string;
      level: number;
    }
  | {
      kind: "gainedSkillPoint";
      tick: number;
      agentId: string;
      species: string;
      pointType: PokemonType | "wildcard";
    }
  | {
      kind: "moveRespecced";
      tick: number;
      agentId: string;
      species: string;
      moveId: string;
      nodeId: string;
    }
  | {
      kind: "fainted";
      tick: number;
      agentId: string;
      species: string;
      pos: Vec2;
    }
  | {
      kind: "recovered";
      tick: number;
      agentId: string;
      species: string;
      hp: number;
    }
  | {
      kind: "looted";
      tick: number;
      looterId: string;
      looterSpecies: string;
      fromId: string;
      fromSpecies: string;
      itemKey: string;
    }
  | {
      kind: "foodDelivered";
      tick: number;
      carrierId: string;
      carrierSpecies: string;
      receiverId: string;
      receiverSpecies: string;
    }
  | {
      kind: "carrying";
      tick: number;
      carrierId: string;
      carrierSpecies: string;
      carriedId: string;
      carriedSpecies: string;
    }
  | {
      kind: "setDown";
      tick: number;
      carrierId: string;
      carrierSpecies: string;
      carriedId: string;
      carriedSpecies: string;
      reason: "arrived" | "threat";
    }
  | {
      kind: "herdMigrating";
      tick: number;
      herdId: string;
      from: Vec2;
      to: Vec2;
      /** Why the herd is relocating — see `MigrationReason`/herdMigration.ts. */
      reason: MigrationReason;
    }
  | {
      kind: "herdSettled";
      tick: number;
      herdId: string;
      pos: Vec2;
      /** "arrived" = reached the migration target; "gaveUp" = timed out first — mirrors migration.ts's own give-up pattern. */
      outcome: "arrived" | "gaveUp";
    }
  | {
      kind: "nightfall";
      tick: number;
      /** The light level (daynight.ts's `lightLevel`) at the exact tick this fired. Always just under `NIGHT_THRESHOLD`. */
      lightLevel: number;
    }
  | {
      kind: "daybreak";
      tick: number;
      /** The light level (daynight.ts's `lightLevel`) at the exact tick this fired. Always just at/over `NIGHT_THRESHOLD`. */
      lightLevel: number;
    }
  | {
      kind: "weatherChanged";
      tick: number;
      weatherType: WeatherType;
      /**
       * "began" fires once at spawn, "ended" once at dissipation (age-out,
       * not a real-time interrupt — weather.ts's `advanceWeather`) — no
       * separate per-agent "entered/left this cell" event: a herd's actual
       * exposure is already narrated indirectly via the `"weather"`
       * `herdMigrating` reason when it matters enough to move a herd, and a
       * per-tick per-agent in/out event for up to 3 slowly-drifting cells
       * would be a lot of low-value log volume for something with no other
       * consumer yet — a deliberate scope call, not an oversight.
       */
      phase: "began" | "ended";
      /** Rounded cell center at the moment this fired — narrative color, not a precise hitbox. */
      center: Vec2;
      radius: number;
    }
  | {
      kind: "macroWeatherChanged";
      tick: number;
      /** Only the two types with real cross-zone effects — see overworld.ts's `MacroWeatherKind`; rain/storm aren't part of the macro-scale system. */
      weatherType: "coldSnap" | "drought";
      /** Same "began"/"ended" narrative-color convention as `weatherChanged` above, one level up: a macro front spanning many zones, not weather.ts's single-map cells. */
      phase: "began" | "ended";
      /** Rounded front center, in zone (row, col) — not tile coordinates. */
      row: number;
      col: number;
      /** Radius in zones. */
      radius: number;
    }
  | {
      kind: "dispersed";
      tick: number;
      agentId: string;
      species: string;
      /** `"none"` for an agent that had no herdId to leave (a solitary agent — see reproduction.ts's isEligibleMate). */
      fromHerd: string;
      toHerd: string;
      /** Whether `toHerd` was an existing herd the agent joined or a fresh one it founded — see dispersal.ts's `finishDispersal`. */
      outcome: "joined" | "founded";
      reason: DispersalReason;
    }
  | {
      kind: "immigrated";
      tick: number;
      /** One or more agent ids (`immigration.ts` spawns a 1-3-member group at once) — every id shares the same `species`/`herdId`/arrival `pos`. */
      agentIds: string[];
      species: string;
      layer: Layer;
      pos: Vec2;
      /** Whether this group joined an existing nearby herd or founded a new one — same idea as `dispersed`'s `outcome`. */
      herdId: string;
      outcome: "joined" | "founded";
    }
  | {
      kind: "shelterBuilt";
      tick: number;
      /** The agent whose build-time investment completed the structure — see shelter.ts's `applyShelterBuilding`. */
      agentId: string;
      species: string;
      /** Absent for a solitary (herdless) builder. */
      herdId?: string;
      layer: Layer;
      pos: Vec2;
    }
  | {
      kind: "shelterAbandoned";
      tick: number;
      layer: Layer;
      pos: Vec2;
    }
  | {
      kind: "fellAsleep";
      tick: number;
      agentId: string;
      species: string;
      pos: Vec2;
    }
  | {
      kind: "wokeUp";
      tick: number;
      agentId: string;
      species: string;
      pos: Vec2;
      /** Why this agent woke — an urgent need jumping the queue, or a threat noticed by a nearby watcher. See needs.ts's sleep wake check. */
      reason: "urgentNeed" | "threatSpotted";
    }
  | {
      kind: "longSleepBonus";
      tick: number;
      agentId: string;
      species: string;
      pos: Vec2;
      exp: number;
    }
  | {
      kind: "statusInflicted";
      tick: number;
      agentId: string;
      species: string;
      statusKind: StatusKind;
      /** The agent whose landed hit caused this — see `maybeInflictStatus` (status.ts). */
      inflictedBy: string;
    }
  | {
      kind: "supported";
      tick: number;
      /** The agent whose ally-targeting move (`MoveSpec.targetsAlly`/`allyEffect`) resolved — see `applySupportMove` (support.ts). */
      supporterId: string;
      supporterSpecies: string;
      allyId: string;
      allySpecies: string;
      /** What it actually did — a move can heal, buff, or both, but not neither (see `MoveSpec.allyEffect`). */
      healed: boolean;
      buffed: boolean;
    }
  | {
      kind: "terrainChanged";
      tick: number;
      layer: Layer;
      pos: Vec2;
      from: TerrainKind;
      to: TerrainKind;
      /** Which sustained weather condition caused it — see weather.ts's `advanceWaterCycle`, currently the only producer of this event. */
      cause: "drought" | "rain";
    }
  | {
      kind: "herdClash";
      tick: number;
      attackerId: string;
      attackerSpecies: string;
      /** Absent for a solitary (herdless) participant — same-or-different-species conflict doesn't require either side to actually have a herd. */
      attackerHerdId?: string;
      defenderId: string;
      defenderSpecies: string;
      defenderHerdId?: string;
      /** Absent on a "missed" outcome (see below) — no damage was dealt. */
      damage?: number;
      /** Absent on a "missed" outcome. */
      defenderHpRemaining?: number;
      critical?: boolean;
      pos: Vec2;
      /**
       * "missed": the accuracy roll failed, nothing happened. "hit": a real
       * hit landed but the defender wasn't hurt enough to back off yet.
       * "retreated": the defender crossed `herdConflict.ts`'s
       * `HERD_CONFLICT_RETREAT_HP_FRACTION` and stepped away — this
       * mechanic's actual resolution; see herdConflict.ts's doc comment for
       * why this can never be "fainted"/"killed" the way predation's
       * `fought`/`defeated` can.
       */
      outcome: "missed" | "hit" | "retreated";
    }
  | {
      kind: "packHunt";
      tick: number;
      /** The pack member whose attack this tick actually landed (or missed) with pack assistance — see predation.ts's `applyPredationInstincts`. */
      attackerId: string;
      attackerSpecies: string;
      targetId: string;
      targetSpecies: string;
      /** How many OTHER same-species conspecifics were already committed to this exact target (`Agent.huntTarget`) within pack range — the real, positioning-driven count the accuracy bonus is computed from, not the wider "nearby" muster count. Always >= 1 (this event only fires once real coordination is happening). */
      packmates: number;
      pos: Vec2;
    }
  | {
      kind: "scavenged";
      tick: number;
      agentId: string;
      species: string;
      /** The corpse fed from — see support.ts's `applyScavenging`/`isTrulyDead`. */
      corpseId: string;
      corpseSpecies: string;
      pos: Vec2;
    }
  | {
      kind: "statusCleared";
      tick: number;
      agentId: string;
      species: string;
      statusKind: StatusKind;
      /** Sleep's duration running out, or freeze's per-tick/fire-hit thaw. A faint (burn/poison DOT or any other cause) clears status silently — the "fainted" event itself narrates that, no separate reason needed here. */
      reason: "woke" | "thawed";
    }
  | {
      kind: "bonded";
      tick: number;
      /** The pair that formed a `bondedPartnerId` link — see reproduction.ts's `applyMateSeeking`. Order matches the calling (female-turn) convention: `agentId` is the female, `partnerId` the male. */
      agentId: string;
      species: string;
      partnerId: string;
      partnerSpecies: string;
      pos: Vec2;
    }
  | {
      kind: "eggLaid";
      tick: number;
      motherId: string;
      fatherId: string;
      eggId: string;
      species: string;
      layer: Layer;
      pos: Vec2;
    }
  | {
      kind: "eggHatched";
      tick: number;
      agentId: string;
      species: string;
      layer: Layer;
      pos: Vec2;
    }
  | {
      kind: "eggEaten";
      tick: number;
      eaterId: string;
      eaterSpecies: string;
      eggId: string;
      eggSpecies: string;
      layer: Layer;
      pos: Vec2;
    }
  | {
      kind: "eggDefended";
      tick: number;
      /** The parent/herd-mate defending the egg. */
      defenderId: string;
      defenderSpecies: string;
      eggId: string;
      threatId: string;
      threatSpecies: string;
      pos: Vec2;
    }
  | {
      kind: "titleClaimed";
      tick: number;
      title: NotableTitleId;
      agentId: string;
      species: string;
      value: number;
      /** The previous holder, if this was a transfer rather than the title's first-ever claim. */
      previousHolderId?: string;
    }
  | {
      kind: "titleLost";
      tick: number;
      title: NotableTitleId;
      agentId: string;
      species: string;
      reason: "died" | "dethroned";
    }
  | {
      kind: "leadershipClaimed";
      tick: number;
      herdId: string;
      agentId: string;
      species: string;
      /** The previous leader, if this was a transfer rather than the herd's first-ever leader. */
      previousLeaderId?: string;
    }
  | {
      kind: "leadershipLost";
      tick: number;
      herdId: string;
      agentId: string;
      species: string;
      reason: "died" | "titleLost" | "herdChanged";
    }
  | {
      kind: "regionDemoted";
      tick: number;
      regionId: string;
      /** Per-species population folded into the aggregate, rounded — see overworld.ts's `demoteRegion`. */
      speciesCounts: Record<string, number>;
    }
  | {
      kind: "regionPromoted";
      tick: number;
      regionId: string;
      /** Every invented individual's id — mirrors `immigrated`'s `agentIds` shape. */
      agentIds: string[];
    }
  | {
      kind: "regionPopulationBoom";
      tick: number;
      regionId: string;
      species: string;
      population: number;
    }
  | {
      kind: "regionDieOff";
      tick: number;
      regionId: string;
      species: string;
      population: number;
    }
  | {
      kind: "regionEmigrated";
      tick: number;
      fromRegionId: string;
      toRegionId: string;
      species: string;
      /** Rounded head count that moved — see overworld.ts's abstract-tier emigration roll. */
      population: number;
    }
  | {
      kind: "regionCrossed";
      tick: number;
      /** The individual disperser that actually left the focused region's map — see dispersal.ts's `RegionDispersalContext`/`Agent.crossingToRegionId`. */
      agentId: string;
      species: string;
      fromRegionId: string;
      toRegionId: string;
    };

/**
 * The sim's narratable output. Semantic events, not state diffs — the north
 * star in DESIGN.md is that this log should be rich enough for a narrator
 * (human or Claude) to summarize as a story.
 */
export class EventLog {
  readonly events: SimEvent[] = [];

  record(event: SimEvent): void {
    this.events.push(event);
  }
}

/** Shared by anything that changes an agent's behavior and wants it logged only when it actually changes. */
export function logBehaviorChange(log: EventLog | undefined, world: World, agent: Agent, to: BehaviorKind): void {
  if (!log || agent.behavior === to) return;
  log.record({
    kind: "behaviorChanged",
    tick: world.tick,
    agentId: agent.id,
    species: agent.species,
    from: agent.behavior,
    to,
  });
}
