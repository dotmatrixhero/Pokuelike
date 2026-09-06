import type { Agent, SimEvent, Vec2, World } from "@pokuelike/engine";
import { idLabel } from "./notableTitles.js";

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

export type NotableCategory = "immigration" | "courtship" | "hatch" | "battle" | "clash" | "evolution" | "death";

/** Fixed camera-hold time for a one-shot notable moment (immigration/courtship/hatch/evolution/death not extending a battle). Real ticks, not wall-clock — see `DWELL_TICKS`'s doc comment for why ticks, not ms. */
const DWELL_TICKS = 24;
/**
 * A concluded battle gets a short "epilogue" hold on the same view before the
 * camera releases — long enough to actually see the kill/retreat land, short
 * enough not to stall the queue behind a fight that's already over. Real
 * wall-clock ms, not ticks — direct follow-up ask after the tick-based
 * version (6 ticks at battle-step's ~650ms/tick cadence, ~3.9s) still
 * "lingered a long time in step-level speed after the fight was over": "After
 * hp hits 0, just cut away back to full speed after 1000ms." Ticks-based
 * timing here was really just a proxy for real time anyway (nothing about
 * the epilogue cares how many ticks passed), so this reads `performance.now()`
 * directly instead of waiting for however many battle-step ticks happen to
 * land in that window.
 */
const BATTLE_EPILOGUE_MS = 1000;
/**
 * A battle with no new `fought`/`missed`/`herdClash` hit involving either
 * participant for this many ticks is treated as silently disengaged (one
 * side wandered off without a clean "flee"/death signal) — a fallback, not
 * the primary conclusion path; see the three explicit conclusion checks in
 * `maybeConcludeBattle`.
 */
const BATTLE_STALE_TICKS = 40;
/**
 * A `herdClash` skirmish — direct ask: "clashes that don't do nothing are
 * lame... time out faster." A herd rivalry fight is non-lethal by design
 * (`herdConflict.ts`'s own doc comment: "cannot faint or kill, full stop"),
 * so it doesn't earn a real battle's patience for a lull between hits — a
 * skirmish that's gone quiet this briefly almost always really is over, not
 * mid-standoff, and shouldn't hold the camera/speed override waiting to find
 * out.
 */
const CLASH_STALE_TICKS = 8;
/** `CLASH_STALE_TICKS`'s own real-ms epilogue counterpart — see `BATTLE_EPILOGUE_MS`'s doc comment for why this is wall-clock, not ticks. Proportionally shorter than a real battle's, same "it's over, move on" reasoning. */
const CLASH_EPILOGUE_MS = 400;
/**
 * How many ticks a `herdClash` pair's own still-unanswered hit stays
 * "pending" — eligible to be confirmed into a real camera engagement by a
 * genuine retaliation (a hit or retreat whose attacker is the OPPOSITE side
 * of whoever struck first) — before it's forgotten as a one-sided,
 * unanswered skirmish instead. Direct follow-up ask chain, after
 * territorial guarding made `herdClash` far more frequent: a single hit is
 * real (a move genuinely landed), but reads as noise, not "a fight," on its
 * own — refined further once retaliation (`herdConflict.ts`'s
 * `Agent.retaliateAgainstId`) existed at all: "auto cam shouldn't focus at
 * all until retaliation hit," not merely any second hit from either side.
 * Wide enough to comfortably cover an ordinary move's real cooldown (every
 * curated attack move now floors at `cooldownTicks: 2`) plus the one extra
 * action tick retaliation itself needs to fire, without holding the bar
 * open indefinitely for a pair that's plainly moved on.
 */
const CLASH_ESCALATION_WINDOW_TICKS = 20;
/** Hard cap on queued-but-not-yet-shown engagements — a chaotic tick (mass death event, say) shouldn't grow this unboundedly; overflow drops the oldest still-queued entries first. */
const MAX_QUEUE = 20;
/**
 * Playback speed (the `SPEED_STEPS` value, not an index) auto-camera holds a
 * followed *non-battle* event (immigration/courtship/hatch/evolution/death)
 * to. Direct ask: "Maybe for evolutions. And stuff make it be x8. Not x2" —
 * these are quick, self-contained visual moments (unlike a battle, which
 * needs `enterBattleStep`'s one-tick-at-a-time precision to actually read
 * hit-by-hit), so pinning all the way down to 2x read as too sluggish; 8x
 * keeps things snappier while still well below a fast viewer's likely
 * 16x/32x. Raised `SLOWDOWN_THRESHOLD_SPEED` to match — see its own doc
 * comment for why the two have to move together.
 */
export const AUTO_CAM_SLOWDOWN_SPEED = 8;
/**
 * Auto-camera only intervenes on speed at/above this for a non-battle event
 * — below it, playback is already at or under `AUTO_CAM_SLOWDOWN_SPEED`, so
 * "slowing down" to it would actually speed play back up. Kept strictly
 * above `AUTO_CAM_SLOWDOWN_SPEED` for exactly that reason: this is only ever
 * a genuine slowdown, never an accidental speedup.
 */
const SLOWDOWN_THRESHOLD_SPEED = 16;
/**
 * A battle no longer just drops the *speed multiplier* to a slow-motion
 * value (was 0.25x, real cinematic slow-motion) — direct follow-up ask:
 * "step through them one tick at a time rather than super slow speed, it's
 * too hard to follow." Continuous timer-driven ticking, even slow, still
 * blurs several hits/log lines together before a viewer can react; a battle
 * now instead pauses ordinary speed-driven ticking entirely and advances
 * exactly one tick at a time on its own fixed real-time cadence (see
 * `AutoCameraHost.enterBattleStep`/`exitBattleStep`, and `main.ts`'s
 * `BATTLE_STEP_INTERVAL_MS`) — a deliberate, watchable beat per tick,
 * regardless of what speed the viewer was previously at. Every other
 * notable category — including "clash" (`herdClash`, direct follow-up ask:
 * "keep the slow down, but time out faster. Don't even enter battle step,
 * just go 1x or some shit" — a non-lethal herd skirmish never earns the
 * hit-by-hit precision a real fight needs) — keeps the unchanged ≥16x-only
 * / 8x-target ordinary speed-slowdown behavior below, never `enterBattleStep`.
 */

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
  /** Set once conclusion fires on a continuous engagement — it keeps a short epilogue hold rather than vanishing on the same tick as the kill/retreat. Still used for the -1 "marked, not yet stamped" sentinel (see `onBattleParticipantLeft`) and by `BATTLE_STALE_TICKS`'s own tick-based check; the actual epilogue hold duration is real-ms, via `concludedAtRealMs` below. */
  concludedAtTick?: number;
  /** `performance.now()` at the same moment `concludedAtTick` gets its real (non-sentinel) value — what `BATTLE_EPILOGUE_MS` actually counts against, since the epilogue hold is real wall-clock time, not ticks (see `BATTLE_EPILOGUE_MS`'s own doc comment for why). */
  concludedAtRealMs?: number;
  /**
   * A monotonically increasing id, one per real `Engagement` object (assigned
   * once, at construction, in `nextSeq`) — lets a consumer like
   * `BattleScreenPanel` (see battleScreenPanel.ts) tell "the same battle,
   * widened by a new hit or pack-hunt assist" apart from "a genuinely new
   * engagement just got promoted," which `category`/`sourceKind` alone can't
   * do (two battles in a row both have `category: "battle"`,
   * `sourceKind: "fought"`).
   */
  seq: number;
}

/** Everything a consumer needs to render the currently-active engagement without reaching into `AutoCameraController`'s private state — see `currentEngagement()`. */
export interface ActiveEngagementInfo {
  seq: number;
  category: NotableCategory;
  ids: ReadonlySet<string>;
  label: string;
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
  /**
   * Pause ordinary speed-driven ticking and start advancing exactly one tick
   * per fixed real-time interval instead — called once, the moment a battle
   * becomes the active engagement. See `AUTO_CAM_BATTLE_SLOWDOWN_SPEED`'s
   * (now removed) doc comment above for why: continuous slow-motion was
   * still too blurry to follow hit-by-hit.
   */
  enterBattleStep(): void;
  /** Hand ticking back to the ordinary speed slider — called once, the moment a battle stops being the active engagement (concluded, or superseded). */
  exitBattleStep(): void;
  /** Scope the event log to exactly these agent/egg ids, or `undefined` to clear the auto-cam filter. */
  setLogFilter(ids: Set<string> | undefined): void;
}

function speciesLabel(a: string, b?: string): string {
  return b ? `${a} vs ${b}` : a;
}

export class AutoCameraController {
  /** Backs `Engagement.seq` — module-instance-scoped rather than a static counter so two independent controllers (tests) don't share a sequence. */
  private nextSeq = 1;
  private enabled = false;
  private queue: Engagement[] = [];
  private active: Engagement | undefined;
  /** Set once, the tick auto-camera first takes the view over from idle; cleared (and `host.restoreView()` fired) once the queue drains back to nothing. Not per-engagement — the point is "give the view back when there's nothing left to show," not after every single moment. */
  private controllingView = false;
  /** Speed the viewer had selected before auto-camera's slowdown kicked in — restored once no engagement needs the slowdown any more, unless the viewer changed speed by hand in the meantime (see `noteManualSpeedChange`). */
  private savedSpeed: number | undefined;
  /** True while a battle has ordinary ticking paused in favor of `host.enterBattleStep()`'s one-tick-at-a-time cadence — mirrors `savedSpeed`'s "already applied, don't re-apply" guard, but as its own flag since battle-step mode doesn't go through `getSpeed`/`setSpeed` at all. */
  private battleStepping = false;
  /** Sticky "the viewer took the wheel" flag — set by `noteManualViewChange`, cleared whenever a *new* engagement becomes active. While set, the currently-active engagement keeps running (log filter, dwell/conclusion logic) but stops re-centering the camera; a fresh notable event still takes it back, since that's a deliberate new thing to look at, not a continuation of what the viewer already panned away from. */
  private viewerTookOver = false;
  /**
   * Pair-key -> the tick and attacker of a `herdClash` pair's still-
   * unanswered hit, held back from becoming a camera-worthy "clash"
   * engagement — direct follow-up ask chain, after territorial guarding
   * made `herdClash` far more frequent: "a lot more clashing now. But they
   * aren't fighting" (refined once into "only once a skirmish shows real
   * escalation, a second hit or a retreat"), then refined further once
   * `herdConflict.ts` grew a real retaliation mechanic
   * (`Agent.retaliateAgainstId`): "auto cam shouldn't focus at all until
   * retaliation hit." A hit from the SAME attacker again (still no
   * response) just refreshes this, never escalates on its own — this only
   * promotes to a real engagement on a hit or retreat whose attacker is the
   * ORIGINAL DEFENDER (a genuine direction-reversed retaliation), never
   * merely a second hit from whoever struck first. See `maybeEscalateClash`.
   */
  private clashPendingFirstHit = new Map<string, { sinceTick: number; attackerId: string }>();

  constructor(private readonly host: AutoCameraHost) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) {
      // Turning off releases camera/speed/log-filter control immediately,
      // not at the next natural conclusion — an explicit toggle-off is the
      // viewer saying "stop driving the view for me." Deliberately does NOT
      // clear `this.active`/`this.queue` the way `reset()` does — detection
      // keeps running even while disabled (see `ingest`), which is what
      // lets `listBattleEngagements`'s passive bounding-box overlay keep
      // working with Auto Camera toggled off. Use `reset()` instead for an
      // actual "everything tracked is now meaningless" moment (world reload).
      this.releaseControl();
      return;
    }
    // Turning on while something was already being passively tracked (the
    // overlay above was already showing a box for it) — catch the camera up
    // to it immediately, since `reconcile`'s own promotion branch only fires
    // when `this.active` transitions from unset, which it won't here.
    this.takeControlOfActive();
  }

  /** The "start actively driving the view for whatever `this.active` currently is" half of `setEnabled(true)` — also called directly by `focusEngagement` for the already-enabled case, where `setEnabled(true)` itself would no-op (already on) and so never reach this logic on its own. */
  private takeControlOfActive(): void {
    if (!this.active) return;
    this.viewerTookOver = false;
    this.host.setLogFilter(this.active.ids);
    if (!this.controllingView) {
      this.controllingView = true;
      this.host.captureHomeView();
    }
    this.applySlowdownIfNeeded();
  }

  /** The shared "let go of the view/speed/log-filter" logic behind both `setEnabled(false)` and `reset()` — see their own doc comments for how they differ (this alone leaves `active`/`queue` untouched). */
  private releaseControl(): void {
    this.releaseSpeedOverride();
    if (this.controllingView) {
      this.controllingView = false;
      // Only snap back to the pre-auto-camera view if the viewer never took
      // the wheel during whatever was just released — see `reconcile`'s
      // identical rule for why.
      if (!this.viewerTookOver) this.host.restoreHomeView();
    }
    this.viewerTookOver = false;
    this.host.setLogFilter(undefined);
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
    this.clashPendingFirstHit.clear();
    this.releaseControl();
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
   *
   * Deliberately NOT gated on `isEnabled()` (unlike before this passive
   * overlay feature existed) — detection needs to keep running even while
   * Auto Camera is toggled off, so `listBattleEngagements` has something
   * real to show. `update`/`reconcile` below are the ones responsible for
   * making sure this doesn't touch the camera/speed/log filter unless
   * `enabled`.
   */
  ingest(events: readonly SimEvent[], world: World): void {
    if (events.length === 0) return;
    for (const event of events) this.observe(event, world);
  }

  /**
   * Called once per animation frame to advance the state machine (promote
   * the next queued engagement, expire a finished one) and, while enabled,
   * apply the active engagement's camera focus. `reconcile` itself always
   * runs (detection/expiry needs to keep working while disabled — see
   * `ingest`); only the actual camera pan is gated here.
   */
  update(world: World): void {
    this.reconcile(world);
    if (this.enabled && this.active && !this.viewerTookOver) this.host.focusOn(this.focusPos(this.active, world));
  }

  /** The ids the log should currently be scoped to, or `undefined` for no auto-cam filter — gated on `isEnabled()` since this reflects what the log/status UI should show, unchanged by this file's passive-tracking-while-disabled feature. */
  currentIds(): Set<string> | undefined {
    return this.enabled ? this.active?.ids : undefined;
  }

  currentLabel(): string | undefined {
    return this.enabled ? this.active?.label : undefined;
  }

  /** The active engagement's full public shape (`undefined` when idle or disabled), for a consumer that needs more than `currentIds`/`currentLabel` alone — see `ActiveEngagementInfo`. Gated on `isEnabled()`, same as those — see `listBattleEngagements` for the enabled-independent equivalent. */
  currentEngagement(): ActiveEngagementInfo | undefined {
    if (!this.enabled || !this.active) return undefined;
    return { seq: this.active.seq, category: this.active.category, ids: this.active.ids, label: this.active.label };
  }

  /**
   * Every currently-tracked *continuous combat* engagement — battle or clash
   * (the active one, if it's one of those, plus any still queued behind it)
   * — unlike `currentEngagement()`, NOT gated on `isEnabled()`, since
   * detection now always runs (see `ingest`). Direct ask: "draw the yellow
   * bounding box anyways on all cool events happening around the map" while
   * Auto Camera is off. Deliberately scoped to the two continuous
   * categories, not every notable one-shot (immigration/courtship/hatch/
   * evolution/death) — those are momentary and don't have a meaningful
   * "still ongoing, still worth a box" window the way a continuous
   * engagement naturally tracks via `expiresOrLastActiveTick`/
   * `concludedAtTick`; a real follow-up if the one-shot case is wanted too.
   */
  listBattleEngagements(): ActiveEngagementInfo[] {
    const all = this.active ? [this.active, ...this.queue] : this.queue;
    return all.filter((e) => e.continuous).map((e) => ({ seq: e.seq, category: e.category, ids: e.ids, label: e.label }));
  }

  /**
   * Click-to-follow for the passive overlay above — direct ask: "clicking in
   * it enters auto cam just for that one event." Turns Auto Camera on (if
   * not already — reusing `setEnabled`'s own "catch up to an already-active
   * engagement" logic) and force-promotes `seq` to active immediately,
   * ahead of whatever else is active/queued, rather than waiting its turn
   * in the ordinary battle-priority/FIFO order. A no-op if `seq` no longer
   * corresponds to a still-tracked engagement (it concluded/expired between
   * the click and this call).
   */
  focusEngagement(seq: number): void {
    const found = this.active?.seq === seq ? this.active : this.queue.find((e) => e.seq === seq);
    if (!found) return;
    if (this.active && this.active.seq !== seq) this.queue.unshift(this.active);
    this.queue = this.queue.filter((e) => e.seq !== seq);
    this.active = found;
    this.enabled = true;
    this.takeControlOfActive();
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
        this.onDeath(event.kind, new Set([event.predatorId, event.preyId]), event.pos, `${idLabel(world, event.predatorId, event.predatorSpecies)} killed ${idLabel(world, event.preyId, event.preySpecies)}`);
        return;
      case "defeated":
        this.onDeath(event.kind, new Set([event.winnerId, event.loserId]), event.pos, `${idLabel(world, event.winnerId, event.winnerSpecies)} defeated ${idLabel(world, event.loserId, event.loserSpecies)}`);
        return;
      case "starved":
        this.onDeath(event.kind, new Set([event.agentId]), event.pos, `${event.species} starved`);
        return;
      case "diedOfAge":
        this.onDeath(event.kind, new Set([event.agentId]), event.pos, `${event.species} died of old age`);
        return;
      case "fought":
        this.onBattleHit("battle", new Set([event.attackerId, event.defenderId]), event.pos, `${idLabel(world, event.attackerId, event.attackerSpecies)} vs ${idLabel(world, event.defenderId, event.defenderSpecies)} fighting`, world);
        return;
      case "herdClash":
        // "clash" — a lower-drama, faster-timing-out category than "battle",
        // direct ask: real fights ("fought") are the dramatic thing worth a
        // hard one-tick-at-a-time pause; a non-lethal herd resource
        // skirmish isn't. See `CLASH_STALE_TICKS`/`CLASH_EPILOGUE_MS`'s own
        // doc comments. `outcome !== "missed"` alone used to be enough to
        // engage the camera — direct follow-up, once territorial guarding
        // made real hits far more frequent: a lone opening hit reads as
        // noise, not "a fight" — see `maybeEscalateClash`'s own real
        // escalation bar (a second hit, or a retreat).
        if (event.outcome !== "missed") {
          this.maybeEscalateClash(
            event.tick,
            event.attackerId,
            event.defenderId,
            event.outcome,
            new Set([event.attackerId, event.defenderId]),
            event.pos,
            `${idLabel(world, event.attackerId, event.attackerSpecies)} vs ${idLabel(world, event.defenderId, event.defenderSpecies)} clashing`,
            world
          );
        }
        if (event.outcome === "retreated") this.onBattleParticipantLeft(event.defenderId);
        return;
      case "fainted":
        this.onBattleParticipantLeft(event.agentId);
        return;
      case "behaviorChanged":
        if (event.to === "flee") this.onBattleParticipantLeft(event.agentId);
        // A fresh `behaviorChanged` to "fight" is the earliest possible
        // signal a battle is starting — predation.ts sets `agent.fightTarget`
        // in the exact same call that logs this, so it's already resolvable
        // here even before any hit lands. Direct ask ("I feel like I'm only
        // cutting auto cam to AFTER a Pokémon fainted... feels bad to miss
        // it"): most fights take at least one tick to close distance before
        // the first hit connects (only `canAttackFromHere` lets the very
        // same tick land a hit too), so hooking this instead of waiting for
        // the first `fought` gives the camera a real head start in that
        // common case. An instant point-blank ambush still can't be caught
        // any earlier than this — `fought` fires the same tick either way —
        // that's a genuine, honest limit, not something this fixes.
        if (event.to === "fight") {
          const agent = world.agents.find((a) => a.id === event.agentId);
          if (agent?.fightTarget) {
            const target = world.agents.find((a) => a.id === agent.fightTarget);
            this.onBattleHit(
              "battle",
              new Set([event.agentId, agent.fightTarget]),
              agent.pos,
              `${idLabel(world, event.agentId, event.species)} vs ${target ? idLabel(world, target.id, target.species) : "something"} engaging`,
              world
            );
          }
        }
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
    this.queue.push({ category, sourceKind, ids, fallbackPos: pos, label, continuous: false, expiresOrLastActiveTick: 0, seq: this.nextSeq++ });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  /**
   * The real escalation gate a `herdClash` pair's own hit has to clear
   * before it's allowed to become (or extend) a camera-worthy "clash"
   * engagement — see `clashPendingFirstHit`'s own doc comment for the
   * direct ask this exists for. A pair already mid-engagement (widening an
   * existing one — this exact pair already active from an earlier real
   * retaliation) always qualifies immediately, from either direction; the
   * bar below is specifically for a pair's first PROMOTION, not every hit
   * forever. Direct ask: "auto cam shouldn't focus at all until retaliation
   * hit" — a hit (or a retreat) only counts as that real retaliation when
   * its attacker is the OPPOSITE side of whichever attacker struck first;
   * the original attacker landing a second, third, Nth hit on the same
   * still-unanswered defender never promotes on its own, no matter how many
   * times it happens — it only keeps the pending window alive.
   */
  private maybeEscalateClash(
    tick: number,
    attackerId: string,
    defenderId: string,
    outcome: "hit" | "retreated",
    ids: Set<string>,
    pos: Vec2,
    label: string,
    world: World
  ): void {
    const pairKey = [attackerId, defenderId].sort().join("|");
    if (this.findContinuous(ids)) {
      this.clashPendingFirstHit.delete(pairKey);
      this.onBattleHit("clash", ids, pos, label, world);
      return;
    }
    const pending = this.clashPendingFirstHit.get(pairKey);
    const isRealRetaliation = pending !== undefined && pending.attackerId !== attackerId && tick - pending.sinceTick <= CLASH_ESCALATION_WINDOW_TICKS;
    if (isRealRetaliation) {
      this.clashPendingFirstHit.delete(pairKey);
      this.onBattleHit("clash", ids, pos, label, world);
      return;
    }
    // No real retaliation yet — a first hit, a same-side repeat hit, or a
    // retreat with nothing to answer it. `outcome === "retreated"` ends the
    // skirmish either way (the engine applies a real cooldown), so there's
    // nothing left to remain pending for; a same-side "hit" refreshes the
    // window instead, giving the defender a real chance to still respond.
    if (outcome === "retreated") {
      this.clashPendingFirstHit.delete(pairKey);
    } else {
      this.clashPendingFirstHit.set(pairKey, { sinceTick: tick, attackerId });
    }
  }

  /**
   * A `fought`/non-missed `herdClash` hit — starts a new continuous
   * engagement for this pair, or keeps an existing one (for either
   * participant) alive. `category` distinguishes a real fight ("battle",
   * `enterBattleStep`-worthy) from a herd rivalry skirmish ("clash", faster
   * timeouts, never `enterBattleStep` — see `CLASH_STALE_TICKS`).
   */
  private onBattleHit(category: "battle" | "clash", ids: Set<string>, pos: Vec2, label: string, world: World): void {
    const existing = this.findContinuous(ids);
    if (existing) {
      // A new participant can join mid-fight (e.g. a pack-hunt assist) —
      // widen the tracked id set so the log filter/camera follow both
      // pick it up, rather than starting a second, competing engagement.
      for (const id of ids) existing.ids.add(id);
      existing.fallbackPos = pos;
      existing.expiresOrLastActiveTick = world.tick;
      return;
    }
    // A real battle is the single most important thing on screen — direct
    // ask: "prioritize battles if there are multiple things going on." A
    // brand new fight preempts whatever one-shot moment (immigration/
    // courtship/hatch/evolution/death) OR lower-priority clash is currently
    // active instead of waiting for its own dwell/stale timer to run out;
    // expiring it now (rather than removing it outright) lets `reconcile`
    // finish it through its normal path on the very next tick. A clash only
    // preempts a one-shot — never an already-active battle (which always
    // outranks it) or another already-active clash (which just queues
    // behind, same FIFO-among-equals as any other category). The `existing`
    // check above already widens a same-pair match instead of racing a
    // second engagement for it.
    if (this.active) {
      const preempt = category === "battle" ? this.active.category !== "battle" : this.active.category !== "battle" && this.active.category !== "clash";
      if (preempt) this.active.expiresOrLastActiveTick = world.tick;
    }
    this.queue.push({
      category,
      sourceKind: category === "battle" ? "fought" : "herdClash",
      ids: new Set(ids),
      fallbackPos: pos,
      label,
      continuous: true,
      expiresOrLastActiveTick: world.tick,
      seq: this.nextSeq++,
    });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  /** A death, fainting, or successful-retreat signal naming a continuous engagement's participant — the real conclusion path (see `BATTLE_STALE_TICKS`/`CLASH_STALE_TICKS` for the fallback path). Idempotent against an engagement already concluding. */
  private onBattleParticipantLeft(agentId: string): void {
    const engagement = this.findContinuous(new Set([agentId]));
    if (engagement && engagement.concludedAtTick === undefined) engagement.concludedAtTick = -1; // marked now, epilogue tick stamped once we know world.tick in reconcile()
  }

  /** A true death (`killed`/`defeated`/`starved`/`diedOfAge`) both concludes any continuous engagement it belongs to (via `onBattleParticipantLeft`, called by the same switch arms above through `fainted`/`killed` sharing a victim) and is itself notable on its own — queued as a fresh one-shot only when it isn't already the natural end of an active/queued engagement for the same id, so a kill doesn't show twice back to back. */
  private onDeath(sourceKind: SimEvent["kind"], ids: Set<string>, pos: Vec2, label: string): void {
    for (const id of ids) this.onBattleParticipantLeft(id);
    const covered = (this.active?.continuous && setsOverlap(this.active.ids, ids)) || this.queue.some((e) => e.continuous && setsOverlap(e.ids, ids));
    if (!covered) this.enqueueOneShot("death", sourceKind, ids, pos, label);
  }

  /**
   * Pop the next engagement to show, preferring any queued *battle*, then any
   * queued *clash*, over however long everything else has been waiting —
   * direct ask: "prioritize battles if there are multiple things going on."
   * Falls back to plain FIFO among the remaining one-shot categories
   * (unchanged from before this method existed). A currently-*active*
   * one-shot doesn't go through here at all — see `onBattleHit`'s own
   * preemption of `this.active` for that half.
   */
  private popNextEngagement(): Engagement {
    const battleIndex = this.queue.findIndex((e) => e.category === "battle");
    if (battleIndex >= 0) return this.queue.splice(battleIndex, 1)[0]!;
    const clashIndex = this.queue.findIndex((e) => e.category === "clash");
    if (clashIndex >= 0) return this.queue.splice(clashIndex, 1)[0]!;
    return this.queue.shift()!;
  }

  /** Any active/queued continuous (battle or clash) engagement overlapping `ids`. */
  private findContinuous(ids: Set<string>): Engagement | undefined {
    if (this.active?.continuous && setsOverlap(this.active.ids, ids)) return this.active;
    return this.queue.find((e) => e.continuous && setsOverlap(e.ids, ids));
  }

  // --- state machine -----------------------------------------------------------

  private reconcile(world: World): void {
    const tick = world.tick;

    // Forget any clash pair's pending first hit once it's aged out of
    // `CLASH_ESCALATION_WINDOW_TICKS` without a real follow-up — otherwise a
    // pair that hits once and never escalates again would sit in this map
    // forever, and (worse) could wrongly "confirm" an unrelated much-later
    // hit between the same two agents as if it were the same skirmish.
    for (const [pairKey, pending] of this.clashPendingFirstHit) {
      if (tick - pending.sinceTick > CLASH_ESCALATION_WINDOW_TICKS) this.clashPendingFirstHit.delete(pairKey);
    }

    // Stamp any continuous engagement marked-concluded-this-batch (see onBattleParticipantLeft's -1 sentinel) with a real epilogue deadline now that we know the tick — and the real-ms clock its own epilogue duration actually counts against.
    for (const e of [this.active, ...this.queue]) {
      if (e && e.continuous && e.concludedAtTick === -1) {
        e.concludedAtTick = tick;
        e.concludedAtRealMs = performance.now();
      }
    }

    if (this.active) {
      if (this.active.continuous) {
        // "clash" (a non-lethal herd skirmish) gets a much shorter leash on
        // both halves than a real "battle" — see CLASH_STALE_TICKS/
        // CLASH_EPILOGUE_MS's own doc comments for why.
        const staleTicks = this.active.category === "clash" ? CLASH_STALE_TICKS : BATTLE_STALE_TICKS;
        const epilogueMs = this.active.category === "clash" ? CLASH_EPILOGUE_MS : BATTLE_EPILOGUE_MS;
        if (this.active.concludedAtTick === undefined && tick - this.active.expiresOrLastActiveTick > staleTicks) {
          // Fallback path: no explicit death/flee/retreat signal, but nothing's landed a hit in a while either — treat as disengaged.
          this.active.concludedAtTick = tick;
          this.active.concludedAtRealMs = performance.now();
        }
        if (this.active.concludedAtRealMs !== undefined && performance.now() - this.active.concludedAtRealMs >= epilogueMs) {
          this.finishActive(world);
        }
      } else if (tick >= this.active.expiresOrLastActiveTick) {
        this.finishActive(world);
      }
    }

    if (!this.active && this.queue.length > 0) {
      const next = this.popNextEngagement();
      if (!next.continuous) next.expiresOrLastActiveTick = tick + DWELL_TICKS;
      this.active = next;
      this.viewerTookOver = false; // a genuinely new thing to look at re-earns camera control even if the viewer panned away from the last one
      // Promotion bookkeeping (`this.active`/`viewerTookOver` above) always
      // happens — detection/tracking runs regardless of `enabled` (see
      // `ingest`) — but only actually take the view/speed/log-filter over
      // while Auto Camera is switched on; `listBattleEngagements`'s passive
      // overlay is what a disabled viewer sees instead.
      if (this.enabled) this.takeControlOfActive();
    }

    if (!this.active && this.enabled) this.releaseControl();
  }

  private finishActive(world: World): void {
    this.active = undefined;
    // Immediately try to promote the next queued engagement on the same
    // reconcile pass so a back-to-back run of events (e.g. a kill right as
    // an evolution fires elsewhere) doesn't sit on an empty frame first.
    this.reconcile(world);
  }

  private applySlowdownIfNeeded(): void {
    if (this.active?.category === "battle") {
      if (!this.battleStepping) {
        this.battleStepping = true;
        this.host.enterBattleStep();
      }
      return;
    }
    if (this.savedSpeed !== undefined) return; // already slowed down for a still-ongoing earlier engagement
    const current = this.host.getSpeed();
    if (current >= SLOWDOWN_THRESHOLD_SPEED) {
      this.savedSpeed = current;
      this.host.setSpeed(AUTO_CAM_SLOWDOWN_SPEED);
    }
  }

  private releaseSpeedOverride(): void {
    if (this.battleStepping) {
      this.battleStepping = false;
      this.host.exitBattleStep();
    }
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
