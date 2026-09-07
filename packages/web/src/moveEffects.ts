import type { SimEvent, Vec2 } from "@pokuelike/engine";

const LIFETIME_MS = 350;

interface Effect {
  attackerId: string;
  tilePos: Vec2;
  bornAt: number;
}

export interface ActiveMoveFlash {
  pos: Vec2;
  /** 1 = just landed, 0 = about to be pruned. */
  fade: number;
}

/**
 * "On the map can you add some kind of effect whenever a pokemon uses a
 * move? like light up the square it effects or something, maybe make the
 * tile/sprite sorta jiggle when its using a move" — direct ask. Tracks
 * every real move-use hit (`fought`/`herdClash`, any outcome including a
 * miss — the ask is "using a move," not "landing one") for a short,
 * deliberately brief window: a quick flash/jiggle, not a lingering glow —
 * this fires constantly in a busy fight, unlike `EventPopups`'s much rarer
 * `STORY_KINDS`-only scope.
 */
export class MoveEffects {
  private effects: Effect[] = [];

  ingest(events: readonly SimEvent[]): void {
    const now = performance.now();
    for (const event of events) {
      if (event.kind !== "fought" && event.kind !== "herdClash") continue;
      // `event.pos` is always the defender's tile — the same field both
      // event kinds already carry on every outcome, hit or miss.
      const pos = (event as { pos?: Vec2 }).pos;
      const attackerId = (event as { attackerId?: string }).attackerId;
      if (!pos || !attackerId) continue;
      this.effects.push({ attackerId, tilePos: pos, bornAt: now });
    }
  }

  reset(): void {
    this.effects = [];
  }

  /** Currently-visible tile flashes, pruning anything expired. */
  activeFlashes(): ActiveMoveFlash[] {
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.bornAt < LIFETIME_MS);
    return this.effects.map((e) => ({ pos: e.tilePos, fade: 1 - (now - e.bornAt) / LIFETIME_MS }));
  }

  /** Ids of agents that used a move recently enough to still be jiggling — does its own freshness check, independent of whether `activeFlashes()` has run this frame (call order between the two doesn't matter). */
  jigglingAgentIds(): ReadonlySet<string> {
    const now = performance.now();
    return new Set(this.effects.filter((e) => now - e.bornAt < LIFETIME_MS).map((e) => e.attackerId));
  }
}
