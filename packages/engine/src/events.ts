import type { Agent, BehaviorKind, Layer, MigrationReason, Vec2, World } from "./types.js";
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
    }
  | {
      kind: "missed";
      tick: number;
      attackerId: string;
      attackerSpecies: string;
      defenderId: string;
      defenderSpecies: string;
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
