import type { SimEvent, Vec2 } from "@pokuelike/engine";

const LIFETIME_MS = 350;

interface Effect {
  attackerId: string;
  tilePos: Vec2;
  bornAt: number;
  /** Direct ask: "flash the space red" — a landed hit reads differently from a miss so a targeted-but-missed tile doesn't look like real damage. */
  hit: boolean;
}

export interface ActiveMoveFlash {
  pos: Vec2;
  /** 1 = just landed, 0 = about to be pruned. */
  fade: number;
  hit: boolean;
}

/**
 * "On the map can you add some kind of effect whenever a pokemon uses a
 * move? like light up the square it effects or something, maybe make the
 * tile/sprite sorta jiggle when its using a move" — direct ask, later
 * sharpened: "I cannot see what units are attacking what tiles... flash
 * the space red." Tracks every real move-use hit (`fought`/`herdClash`),
 * AND a clean miss (`missed`) too — a miss is still an attack targeting a
 * tile, which is exactly what the ask is about seeing — for a short,
 * deliberately brief window: a quick flash/jiggle, not a lingering glow —
 * this fires constantly in a busy fight, unlike `EventPopups`'s much rarer
 * `STORY_KINDS`-only scope.
 */
export class MoveEffects {
  private effects: Effect[] = [];

  ingest(events: readonly SimEvent[]): void {
    const now = performance.now();
    for (const event of events) {
      if (event.kind !== "fought" && event.kind !== "herdClash" && event.kind !== "missed") continue;
      // `event.pos` is always the defender's tile — the same field every
      // one of these event kinds already carries on every outcome, hit or
      // miss.
      const pos = (event as { pos?: Vec2 }).pos;
      const attackerId = (event as { attackerId?: string }).attackerId;
      if (!pos || !attackerId) continue;
      this.effects.push({ attackerId, tilePos: pos, bornAt: now, hit: event.kind !== "missed" });
    }
  }

  reset(): void {
    this.effects = [];
  }

  /** Currently-visible tile flashes, pruning anything expired. */
  activeFlashes(): ActiveMoveFlash[] {
    const now = performance.now();
    this.effects = this.effects.filter((e) => now - e.bornAt < LIFETIME_MS);
    return this.effects.map((e) => ({ pos: e.tilePos, fade: 1 - (now - e.bornAt) / LIFETIME_MS, hit: e.hit }));
  }

  /** Ids of agents that used a move recently enough to still be jiggling — does its own freshness check, independent of whether `activeFlashes()` has run this frame (call order between the two doesn't matter). */
  jigglingAgentIds(): ReadonlySet<string> {
    const now = performance.now();
    return new Set(this.effects.filter((e) => now - e.bornAt < LIFETIME_MS).map((e) => e.attackerId));
  }
}
