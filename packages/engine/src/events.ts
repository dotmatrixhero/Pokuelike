import type { BehaviorKind, Layer, Vec2 } from "./types.js";

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
    }
  | {
      kind: "floraChanged";
      tick: number;
      layer: Layer;
      pos: Vec2;
      stage: "seeded" | "sprouted";
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
    }
  | {
      kind: "defeated";
      tick: number;
      winnerId: string;
      winnerSpecies: string;
      loserId: string;
      loserSpecies: string;
      pos: Vec2;
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
