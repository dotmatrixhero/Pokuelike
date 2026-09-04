import type { Agent, BehaviorKind, DispersalReason, Layer, MigrationReason, StatusKind, Vec2, WeatherType, World } from "./types.js";
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
      stage: "seeded" | "sprouted" | "died";
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
      kind: "statusCleared";
      tick: number;
      agentId: string;
      species: string;
      statusKind: StatusKind;
      /** Sleep's duration running out, or freeze's per-tick/fire-hit thaw. A faint (burn/poison DOT or any other cause) clears status silently — the "fainted" event itself narrates that, no separate reason needed here. */
      reason: "woke" | "thawed";
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
