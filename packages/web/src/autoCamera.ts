import type { Agent, SimEvent, Vec2, World } from "@pokuelike/engine";

/**
 * "Auto Camera" — a toggleable observer mode that watches the live event
 * stream and, when something narratively notable happens, pans/zooms the
 * canvas onto it, temporarily slows playback so it's actually watchable, and
 * scopes the event log down to exactly what's relevant. Direct ask: "I want
 * to be able to see a battle happen in real time... follows interesting
 * events... zoom in... slow down time."
 *
 * This module owns the *detection and state machine* only — no DOM, no
 * canvas. `main.ts` wires it to the real camera (zoom + `canvas-wrap` scroll
 * position), the speed slider, and `EventLogPanel` via the small
 * `AutoCameraHost` interface below, and calls `ingest`/`update` from the
 * existing tick loop.
 */

export type NotableCategory = "immigration" | "courtship" | "hatch" | "battle" | "evolution" | "death";

/** Fixed camera-hold time for a one-shot notable moment (immigration/courtship/hatch/evolution/death not extending a battle). Real ticks, not wall-clock — see `DWELL_TICKS`'s doc comment for why ticks, not ms. */
const DWELL_TICKS = 24;
/**
 * A concluded battle gets a short "epilogue" hold on the same view before the
 * camera releases — long enough to actually see the kill/retreat land,
 * short enough not to stall the queue behind a fight that's already over.
 */
const BATTLE_EPILOGUE_TICKS = 16;
/**
 * A battle with no new `fought`/`missed`/`herdClash` hit involving either
 * participant for this many ticks is treated as silently disengaged (one
 * side wandered off without a clean "flee"/death signal) — a fallback, not
 * the primary conclusion path; see the three explicit conclusion checks in
 * `maybeConcludeBattle`.
 */
const BATTLE_STALE_TICKS = 40;
/** Hard cap on queued-but-not-yet-shown engagements — a chaotic tick (mass death event, say) shouldn't grow this unboundedly; overflow drops the oldest still-queued entries first. */
const MAX_QUEUE = 20;
/** Playback speed (the `SPEED_STEPS` value, not an index) auto-camera holds a followed event to. */
export const AUTO_CAM_SLOWDOWN_SPEED = 2;
/** Auto-camera only intervenes on speed at/above this — below it, playback is already slow enough to watch without help. */
const SLOWDOWN_THRESHOLD_SPEED = 4;

interface Engagement {
  category: NotableCategory;
  /**
   * The literal `SimEvent["kind"]` that created this engagement — used only
   * for de-duplication (`enqueueOneShot`), kept distinct from `category`
   * because "courtship" deliberately covers three real, separately-notable
   * moments (`bonded`, `shelterBuilt`, `eggLaid`) that routinely share the
   * same pair's ids; de-duping on `category` there would wrongly collapse a
   * bonded pair's later shelter-completion into a no-op because it "looks
   * like" the same courtship engagement already queued.
   */
  sourceKind: SimEvent["kind"];
  /** Every agent/egg id this moment concerns — drives both camera focus (their live positions, averaged) and the "more specific" log filter. */
  ids: Set<string>;
  /** Fallback focus point for an id-having-no-live-agent event (e.g. a herd id, or an agent already pruned) — always set from the triggering event's own `pos`. */
  fallbackPos: Vec2;
  label: string;
  /** True only for "battle" — kept alive tick-to-tick by new hits instead of expiring after one fixed dwell. */
  continuous: boolean;
  /** Tick this engagement should stop being displayed (for a one-shot) or was last kept alive by a relevant hit (for a continuous battle, compared against `BATTLE_STALE_TICKS`). */
  expiresOrLastActiveTick: number;
  /** Set once conclusion fires on a continuous engagement — it keeps a short epilogue hold rather than vanishing on the same tick as the kill/retreat. */
  concludedAtTick?: number;
}

/** What `main.ts` needs to actually move the camera/speed/log — kept tiny and DOM-agnostic so this file stays testable without a real browser. */
export interface AutoCameraHost {
  /** Called once, the moment auto-camera takes the view over from idle (before the first `focusOn`) — the host's chance to snapshot its current zoom/scroll so `restoreHomeView` can put it back. */
  captureHomeView(): void;
  /** Pan/zoom the canvas onto this world position (tile coords) at auto-camera's fixed close-in zoom. Called only while an engagement is active and the viewer hasn't manually taken over the view (see `noteManualViewChange`). */
  focusOn(pos: Vec2): void;
  /** Return the view (zoom + scroll) to wherever `captureHomeView` found it. Called once, when the queue empties back to fully idle. */
  restoreHomeView(): void;
  /** Read the user's current speed-slider value (a `SPEED_STEPS` entry, not an index). */
  getSpeed(): number;
  /** Drive the speed slider to a specific `SPEED_STEPS` value. */
  setSpeed(speed: number): void;
  /** Scope the event log to exactly these agent/egg ids, or `undefined` to clear the auto-cam filter. */
  setLogFilter(ids: Set<string> | undefined): void;
}

function speciesLabel(a: string, b?: string): string {
  return b ? `${a} vs ${b}` : a;
}

export class AutoCameraController {
  private enabled = false;
  private queue: Engagement[] = [];
  private active: Engagement | undefined;
  /** Set once, the tick auto-camera first takes the view over from idle; cleared (and `host.restoreView()` fired) once the queue drains back to nothing. Not per-engagement — the point is "give the view back when there's nothing left to show," not after every single moment. */
  private controllingView = false;
  /** Speed the viewer had selected before auto-camera's slowdown kicked in — restored once no engagement needs the slowdown any more, unless the viewer changed speed by hand in the meantime (see `noteManualSpeedChange`). */
  private savedSpeed: number | undefined;
  /** Sticky "the viewer took the wheel" flag — set by `noteManualViewChange`, cleared whenever a *new* engagement becomes active. While set, the currently-active engagement keeps running (log filter, dwell/conclusion logic) but stops re-centering the camera; a fresh notable event still takes it back, since that's a deliberate new thing to look at, not a continuation of what the viewer already panned away from. */
  private viewerTookOver = false;

  constructor(private readonly host: AutoCameraHost) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    // Turning it off mid-event releases everything immediately, not at the
    // next natural conclusion — an explicit toggle-off is the viewer saying
    // "stop," not "finish this one first."
    if (!on) this.reset();
  }

  /**
   * Clears all in-flight tracking (queue, active engagement, manual-override
   * flags, view/speed overrides) without touching whether auto-camera is
   * enabled. Call this when the world itself resets (a new/reloaded seed) —
   * every tracked agent/egg id is about to become meaningless. Also the
   * guts of `setEnabled(false)`.
   */
  reset(): void {
    this.queue = [];
    this.active = undefined;
    this.releaseSpeedOverride();
    if (this.controllingView) {
      this.controllingView = false;
      // Same "don't stomp a deliberate manual pan" rule as the ordinary
      // idle-cleanup path in `reconcile` — see its comment.
      if (!this.viewerTookOver) this.host.restoreHomeView();
    }
    this.viewerTookOver = false;
    this.host.setLogFilter(undefined);
  }

  /** The viewer manually panned/scrolled/zoomed while an engagement was in progress — stop re-centering for it, but keep tracking it (log filter, conclusion checks) until it ends or a new one takes over. */
  noteManualViewChange(): void {
    if (this.active) this.viewerTookOver = true;
  }

  /** The viewer manually moved the speed slider — take that as their new intended speed; don't stomp it back down/up when the current slowdown (if any) later releases. */
  noteManualSpeedChange(): void {
    this.savedSpeed = undefined;
  }

  /**
   * Feed every event from the tick that just ran — enqueues/extends
   * engagements only. Deliberately does *not* run the state machine itself:
   * `step()` only fires on a timer (and not at all while paused), so a
   * dwell/epilogue deadline could stall indefinitely if expiry were only
   * ever checked here — `update` (driven by `requestAnimationFrame`, so it
   * keeps running even across ticks with zero new events) owns that.
   */
  ingest(events: readonly SimEvent[], world: World): void {
    if (!this.enabled || events.length === 0) return;
    for (const event of events) this.observe(event, world);
  }

  /** Called once per animation frame to advance the state machine (promote the next queued engagement, expire a finished one) and apply the active engagement's camera focus. Cheap no-op when idle. */
  update(world: World): void {
    if (!this.enabled) return;
    this.reconcile(world);
    if (this.active && !this.viewerTookOver) this.host.focusOn(this.focusPos(this.active, world));
  }

  /** The ids the log should currently be scoped to, or `undefined` for no auto-cam filter — `main.ts` doesn't need this directly (the host callback already receives it), but it's exposed for a status readout/tests. */
  currentIds(): Set<string> | undefined {
    return this.active?.ids;
  }

  currentLabel(): string | undefined {
    return this.active?.label;
  }

  // --- detection -------------------------------------------------------------

  private observe(event: SimEvent, world: World): void {
    switch (event.kind) {
      case "immigrated":
        this.enqueueOneShot("immigration", event.kind, new Set(event.agentIds), event.pos, `${event.agentIds.length} ${event.species} arrived`);
        return;
      case "bonded":
        this.enqueueOneShot("courtship", event.kind, new Set([event.agentId, event.partnerId]), event.pos, `${speciesLabel(event.species, event.partnerSpecies)} bonded`);
        return;
      case "shelterBuilt":
        this.enqueueOneShot("courtship", event.kind, new Set([event.agentId]), event.pos, `${event.species} finished a shelter`);
        return;
      case "eggLaid":
        this.enqueueOneShot("courtship", event.kind, new Set([event.motherId, event.fatherId, event.eggId]), event.pos, `${event.species} laid an egg`);
        return;
      case "eggHatched":
        this.enqueueOneShot("hatch", event.kind, new Set([event.agentId]), event.pos, `${event.species} hatched`);
        return;
      case "evolved": {
        const pos = world.agents.find((a) => a.id === event.agentId)?.pos ?? { x: 0, y: 0 };
        this.enqueueOneShot("evolution", event.kind, new Set([event.agentId]), pos, `${event.fromSpecies} evolved into ${event.toSpecies}`);
        return;
      }
      case "killed":
        this.onDeath(event.kind, new Set([event.predatorId, event.preyId]), event.pos, `${event.predatorSpecies} killed ${event.preySpecies}`);
        return;
      case "defeated":
        this.onDeath(event.kind, new Set([event.winnerId, event.loserId]), event.pos, `${event.winnerSpecies} defeated ${event.loserSpecies}`);
        return;
      case "starved":
        this.onDeath(event.kind, new Set([event.agentId]), event.pos, `${event.species} starved`);
        return;
      case "diedOfAge":
        this.onDeath(event.kind, new Set([event.agentId]), event.pos, `${event.species} died of old age`);
        return;
      case "fought":
        this.onBattleHit(new Set([event.attackerId, event.defenderId]), event.pos, `${speciesLabel(event.attackerSpecies, event.defenderSpecies)} fighting`, world);
        return;
      case "herdClash":
        if (event.outcome !== "missed") {
          this.onBattleHit(new Set([event.attackerId, event.defenderId]), event.pos, `${speciesLabel(event.attackerSpecies, event.defenderSpecies)} clashing`, world);
        }
        if (event.outcome === "retreated") this.onBattleParticipantLeft(event.defenderId);
        return;
      case "fainted":
        this.onBattleParticipantLeft(event.agentId);
        return;
      case "behaviorChanged":
        if (event.to === "flee") this.onBattleParticipantLeft(event.agentId);
        return;
      default:
        return;
    }
  }

  private enqueueOneShot(category: NotableCategory, sourceKind: SimEvent["kind"], ids: Set<string>, pos: Vec2, label: string): void {
    // Same *exact* moment (same originating event kind, overlapping
    // participants) already the subject of the currently-active or a
    // still-queued engagement (e.g. a hatch that immediately re-triggers via
    // a duplicate log entry) — don't pile up a redundant duplicate. Keyed on
    // `sourceKind`, not `category` — see `Engagement.sourceKind`'s doc
    // comment for why a shared category isn't enough here.
    if (this.active && this.active.sourceKind === sourceKind && setsOverlap(this.active.ids, ids)) return;
    if (this.queue.some((e) => e.sourceKind === sourceKind && setsOverlap(e.ids, ids))) return;
    this.queue.push({ category, sourceKind, ids, fallbackPos: pos, label, continuous: false, expiresOrLastActiveTick: 0 });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  /** A `fought`/non-missed `herdClash` hit — starts a new battle engagement for this pair, or keeps an existing one (for either participant) alive. */
  private onBattleHit(ids: Set<string>, pos: Vec2, label: string, world: World): void {
    const existing = this.findBattle(ids);
    if (existing) {
      // A new participant can join mid-fight (e.g. a pack-hunt assist) —
      // widen the tracked id set so the log filter/camera follow both
      // pick it up, rather than starting a second, competing engagement.
      for (const id of ids) existing.ids.add(id);
      existing.fallbackPos = pos;
      existing.expiresOrLastActiveTick = world.tick;
      return;
    }
    this.queue.push({ category: "battle", sourceKind: "fought", ids: new Set(ids), fallbackPos: pos, label, continuous: true, expiresOrLastActiveTick: world.tick });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  /** A death, fainting, or successful-retreat signal naming a battle's participant — the real conclusion path (see `BATTLE_STALE_TICKS` for the fallback path). Idempotent against an engagement already concluding. */
  private onBattleParticipantLeft(agentId: string): void {
    const battle = this.findBattle(new Set([agentId]));
    if (battle && battle.concludedAtTick === undefined) battle.concludedAtTick = -1; // marked now, epilogue tick stamped once we know world.tick in reconcile()
  }

  /** A true death (`killed`/`defeated`/`starved`/`diedOfAge`) both concludes any battle it belongs to (via `onBattleParticipantLeft`, called by the same switch arms above through `fainted`/`killed` sharing a victim) and is itself notable on its own — queued as a fresh one-shot only when it isn't already the natural end of an active/queued battle for the same id, so a kill doesn't show twice back to back. */
  private onDeath(sourceKind: SimEvent["kind"], ids: Set<string>, pos: Vec2, label: string): void {
    for (const id of ids) this.onBattleParticipantLeft(id);
    const coveredByBattle = (this.active?.category === "battle" && setsOverlap(this.active.ids, ids)) || this.queue.some((e) => e.category === "battle" && setsOverlap(e.ids, ids));
    if (!coveredByBattle) this.enqueueOneShot("death", sourceKind, ids, pos, label);
  }

  private findBattle(ids: Set<string>): Engagement | undefined {
    if (this.active?.category === "battle" && setsOverlap(this.active.ids, ids)) return this.active;
    return this.queue.find((e) => e.category === "battle" && setsOverlap(e.ids, ids));
  }

  // --- state machine -----------------------------------------------------------

  private reconcile(world: World): void {
    const tick = world.tick;

    // Stamp any battle marked-concluded-this-batch (see onBattleParticipantLeft's -1 sentinel) with a real epilogue deadline now that we know the tick.
    for (const e of [this.active, ...this.queue]) {
      if (e && e.category === "battle" && e.concludedAtTick === -1) e.concludedAtTick = tick;
    }

    if (this.active) {
      if (this.active.category === "battle") {
        if (this.active.concludedAtTick === undefined && tick - this.active.expiresOrLastActiveTick > BATTLE_STALE_TICKS) {
          // Fallback path: no explicit death/flee/retreat signal, but nothing's landed a hit in a while either — treat as disengaged.
          this.active.concludedAtTick = tick;
        }
        if (this.active.concludedAtTick !== undefined && tick - this.active.concludedAtTick >= BATTLE_EPILOGUE_TICKS) {
          this.finishActive(world);
        }
      } else if (tick >= this.active.expiresOrLastActiveTick) {
        this.finishActive(world);
      }
    }

    if (!this.active && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (!next.continuous) next.expiresOrLastActiveTick = tick + DWELL_TICKS;
      this.active = next;
      this.viewerTookOver = false; // a genuinely new thing to look at re-earns camera control even if the viewer panned away from the last one
      this.host.setLogFilter(next.ids);
      if (!this.controllingView) {
        this.controllingView = true;
        this.host.captureHomeView();
      }
      this.applySlowdownIfNeeded();
    }

    if (!this.active) {
      this.host.setLogFilter(undefined);
      this.releaseSpeedOverride();
      if (this.controllingView) {
        this.controllingView = false;
        // Only snap back to the pre-auto-camera view if the viewer never
        // took the wheel during whatever just concluded — if they manually
        // panned/zoomed away from the last followed moment, that's their
        // deliberate choice of where to look now, not something a "give the
        // view back" cleanup step should override.
        if (!this.viewerTookOver) this.host.restoreHomeView();
      }
    }
  }

  private finishActive(world: World): void {
    this.active = undefined;
    // Immediately try to promote the next queued engagement on the same
    // reconcile pass so a back-to-back run of events (e.g. a kill right as
    // an evolution fires elsewhere) doesn't sit on an empty frame first.
    this.reconcile(world);
  }

  private applySlowdownIfNeeded(): void {
    if (this.savedSpeed !== undefined) return; // already slowed down for a still-ongoing earlier engagement
    const current = this.host.getSpeed();
    if (current >= SLOWDOWN_THRESHOLD_SPEED) {
      this.savedSpeed = current;
      this.host.setSpeed(AUTO_CAM_SLOWDOWN_SPEED);
    }
  }

  private releaseSpeedOverride(): void {
    if (this.savedSpeed === undefined) return;
    this.host.setSpeed(this.savedSpeed);
    this.savedSpeed = undefined;
  }

  private focusPos(engagement: Engagement, world: World): Vec2 {
    const positions: Vec2[] = [];
    for (const id of engagement.ids) {
      const agent = world.agents.find((a) => a.id === id) as Agent | undefined;
      if (agent) positions.push(agent.pos);
    }
    if (positions.length === 0) return engagement.fallbackPos;
    const x = positions.reduce((sum, p) => sum + p.x, 0) / positions.length;
    const y = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
    return { x, y };
  }
}

function setsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const v of b) if (a.has(v)) return true;
  return false;
}
