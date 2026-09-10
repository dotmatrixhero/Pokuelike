import { totalExpForLevel, type Agent, type SimEvent, type Vec2, type World } from "@pokuelike/engine";
import { LEVELING_CONTEXT } from "@pokuelike/data";
import { idLabel, TITLE_DISPLAY_NAME } from "./notableTitles.js";

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

export type NotableCategory = "immigration" | "courtship" | "hatch" | "battle" | "clash" | "evolution" | "death" | "extinction" | "notable";

/**
 * Fixed camera-hold time for a one-shot notable moment (immigration/hatch/
 * evolution/death not extending a battle — "courtship" uses its own,
 * shorter `COURTSHIP_DWELL_MS` instead, see that constant's own doc
 * comment). Real wall-clock ms, not ticks — direct follow-up report: "our
 * attempt to shorten autocam lingering was a bit too aggressive... doesn't
 * feel like it's lingering for 3 seconds... even on 32x it should be at
 * least 2 seconds." Root cause: this used to be a real TICK count (24),
 * the same "ticks are a bad proxy for wall-clock time" mistake
 * `BATTLE_STALE_MS`/`BATTLE_EPILOGUE_MS`'s own doc comments already caught
 * for the continuous-engagement case — 24 ticks is a real ~4s hold at 1x
 * (6 ticks/sec) but collapses to ~0.125s at 32x (192 ticks/sec), and this
 * one-shot dwell had never gotten the same real-ms fix they did. See
 * `Engagement.dwellUntilRealMs`.
 *
 * Raised again — direct follow-up after living with 2500ms: "add more
 * linger to autocam. It feels too fast still on 32x." The real-ms
 * conversion above fixed the SPEED-dependent shrinkage (the actual bug),
 * but the flat 2500ms itself still just reads as short at a glance,
 * independent of speed.
 */
const DWELL_MS = 4000;
/**
 * `DWELL_MS`'s own shorter counterpart for "courtship" specifically —
 * direct ask: "bonding takes too much air time on the autocam. reduce it
 * and shorten how long it follows them." Courtship (bonded/shelterBuilt/
 * eggLaid) is real but the least individually dramatic of the one-shot
 * categories — a brief glance is enough, it doesn't need the same hold time
 * as a rarer immigration/hatch/evolution/death moment. Raised alongside
 * `DWELL_MS`'s own "still feels too fast" follow-up, same proportion as
 * before (roughly half of `DWELL_MS`).
 */
const COURTSHIP_DWELL_MS = 2000;
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
 * land in that window. Raised back up to 3000ms — direct follow-up ask,
 * after living with 1000ms: "battles not end after 1000ms. i think it needs
 * to be liek 3000 ms" — 1000ms cut away before a viewer had time to actually
 * register the finishing blow.
 */
const BATTLE_EPILOGUE_MS = 4000;
/**
 * A battle with no new `fought`/`missed`/`herdClash` hit involving either
 * participant for this many real ms is treated as silently disengaged (one
 * side wandered off without a clean "flee"/death signal) — a fallback, not
 * the primary conclusion path; see the three explicit conclusion checks in
 * `maybeConcludeBattle`.
 *
 * Real wall-clock ms, not ticks — direct report: "Sometimes if autocam
 * doesn't have anything happen it lingers way too long. If nothing else to
 * cut to, just give it 3 seconds and then resume speed." Root cause: this
 * used to be a real TICK count (40), which reads fine on paper but a
 * "battle" engagement always runs in `enterBattleStep`'s fixed one-tick-
 * per-`BATTLE_STEP_INTERVAL_MS` (650ms) cadence the moment it becomes
 * active (see `applySlowdownIfNeeded`) — so 40 quiet ticks was actually 26
 * real seconds of a frozen, silent slow-motion camera before staleness was
 * even detected, before the (already real-ms) `BATTLE_EPILOGUE_MS` hold
 * even started counting down. Same "ticks are a bad proxy for wall-clock
 * time under a fixed real-time cadence" lesson `BATTLE_EPILOGUE_MS`'s own
 * doc comment already documents for the post-conclusion hold — this is the
 * same fix applied to the PRE-conclusion staleness check instead. `onBattle
 * Hit` now stamps `Engagement.lastActiveRealMs` on every real hit, and
 * `reconcile` compares against that directly (gated on `playing`, exactly
 * like `BATTLE_EPILOGUE_MS`'s check).
 */
const BATTLE_STALE_MS = 4500;

/**
 * The floor on how long a battle stays framed once the camera actually
 * picks it up, regardless of how quickly it ends.
 *
 * Direct report: "battles are so short now, i can't follow em at all... its
 * too fast too follow." Measured before changing anything, and the headline
 * is that the SIMULATION's fights really are that short — over 6,000 ticks a
 * real run produced 20 engagements whose duration was a median of **1 tick**
 * and a 90th percentile of 6. A one-tick fight is a single exchange, so
 * without a floor the camera correctly frames it, shows one beat, and
 * releases. Nothing was broken; there was simply nothing to watch.
 *
 * A minimum hold is the right lever precisely because it does not lie about
 * the simulation — the fight really is over, we just keep looking at the
 * result long enough to read it. The alternative (a long staleness timeout)
 * would be worse: it was tried, at 40 ticks, and produced ~26 seconds of
 * dead air on a quiet battle, which is the thing the previous fix removed.
 */
const BATTLE_MIN_ONSCREEN_MS = 5000;
/**
 * A `herdClash` skirmish — direct ask: "clashes that don't do nothing are
 * lame... time out faster." A herd rivalry fight is non-lethal by design
 * (`herdConflict.ts`'s own doc comment: "cannot faint or kill, full stop"),
 * so it doesn't earn a real battle's patience for a lull between hits — a
 * skirmish that's gone quiet this briefly almost always really is over, not
 * mid-standoff, and shouldn't hold the camera/speed override waiting to find
 * out. Real ms now too, same reasoning/fix as `BATTLE_STALE_MS` above.
 * Nudged up alongside `DWELL_MS`'s own "still feels too fast on 32x"
 * follow-up — clash still keeps noticeably less patience than a real
 * battle, just not quite this clipped.
 */
const CLASH_STALE_MS = 2800;
/** `CLASH_STALE_MS`'s own real-ms epilogue counterpart — see `BATTLE_EPILOGUE_MS`'s doc comment for why this is wall-clock, not ticks. Proportionally shorter than a real battle's, same "it's over, move on" reasoning. */
const CLASH_EPILOGUE_MS = 1500;

/**
 * A clash's own, shorter counterpart to `BATTLE_MIN_ONSCREEN_MS`.
 *
 * Clashes need this MORE than battles do, not less, and the measurement is
 * stark: over 6,000 ticks a real run produced **594 herd clashes against 45
 * battle hits** — 13 to 1. So a viewer watching Auto Camera is watching
 * clashes almost all of the time, and a clash was the one continuous
 * engagement that never slowed the sim down (see `applySlowdownIfNeeded`)
 * and held for only 400ms after concluding. Direct report: "on 4x speed it
 * barely flashes." It did, and at 4x that is exactly what it would look
 * like.
 *
 * Shorter than a battle's floor rather than equal to it, because the same
 * 13:1 ratio means a clash holding the camera as long as a real battle
 * would crowd out everything else worth seeing.
 */
const CLASH_MIN_ONSCREEN_MS = 3000;
/**
 * Minimum real ticks between two separate PROMOTIONS of a brand-new pair
 * into a camera-worthy "clash" engagement — direct ask, after watching a
 * live run with the earlier retaliation-required bar in place: "auto cam is
 * now skipping boring stuff. but i'm not seeing like any battles. like
 * these move usages are interesting! but i dont get to see any of em."
 * `herdConflict.ts`'s own design ("cannot faint or kill... loser retreats
 * once meaningfully hurt") means most skirmishes genuinely are one-sided —
 * a defender backing off rather than trading hits back — so requiring a
 * real direction-reversed retaliation before ever engaging the camera (this
 * constant's own prior incarnation, `CLASH_ESCALATION_WINDOW_TICKS`) made
 * almost every real, damage-dealing hit invisible, not just the boring
 * ones. A landed hit is real on its own — it's a genuine move connecting
 * for genuine damage — so it's camera-worthy again without waiting for a
 * response; this cooldown is what keeps that from regressing into the
 * EARLIER complaint ("a lot more clashing now... clashes that don't do
 * anything are lame") — a brand-new pair's promotion is throttled the same
 * way `ONE_SHOT_CLUSTER_COOLDOWN_TICKS` throttles one-shot bursts, so a
 * herd's many simultaneous one-sided skirmishes surface an occasional real
 * one instead of spamming a cut per hit. See `maybeEngageClash`. Does NOT
 * apply to widening an already-active/queued pair's own engagement — every
 * real hit between a pair already on screen still extends it, same as
 * before.
 */
/*
 * Raised 40 -> 100 alongside the clash pacing changes. Each clash now holds
 * the camera for several seconds rather than flashing past, and at 594
 * clashes per 6,000 ticks a 40-tick promotion gate would let them monopolise
 * Auto Camera and crowd out every other kind of moment.
 */
const CLASH_PROMOTION_COOLDOWN_TICKS = 100;
/** Hard cap on queued-but-not-yet-shown engagements — a chaotic tick (mass death event, say) shouldn't grow this unboundedly; overflow drops an entry — see `trimQueueOverflow` for which one and why not always the oldest any more. */
const MAX_QUEUE = 20;
/**
 * How long a queued "courtship" entry can wait before it jumps back to the
 * front of the one-shot tier regardless of `popNextEngagement`'s usual
 * "courtship always loses to a fresher non-courtship one-shot" rule —
 * direct report, a real empirical check (0 courtship promotions across
 * 8000 real ticks despite 51 real bonded/eggLaid/shelterBuilt events):
 * "you got rid of all the other autocam stuff like bonds." Root cause:
 * that strict, unconditional priority order has no floor — in a busy
 * world where SOME non-courtship one-shot (or, ranking even higher,
 * battle/clash) is essentially always available, courtship can lose every
 * single time, forever, not just "usually." This restores the original
 * intent (routine bonding/egg-laying shouldn't compete evenly with rarer
 * immigration/hatch/evolution/death) while guaranteeing courtship still
 * gets a turn eventually rather than never. Deliberately does NOT also
 * override battle/clash — those stay the two truly time-sensitive
 * categories (`popNextEngagement` checks them first, unconditionally) —
 * this only ever promotes a stale courtship entry ahead of a FRESHER
 * one-shot competing for the same slot.
 */
const COURTSHIP_STARVATION_TICKS = 400;
/**
 * A hard, category-agnostic ceiling: ANY queued one-shot (courtship
 * included) waiting this long jumps the ENTIRE queue, ahead of even a
 * currently-queued battle/clash — the one exception to "battle/clash
 * always outranks a one-shot." Direct requirement: "make sure herd
 * extinction events are captured on autocam and clearly explained." Real
 * empirical check (the same kind that caught the courtship starvation
 * bug): 8000 ticks through the demo scenario produced 10 real
 * `herdDissolved` events and 16 real `titleClaimed` events, but ZERO
 * "extinction"/"notable" promotions — `popNextEngagement`'s unconditional
 * "battle/clash first" rule has no floor either, and in a world busy
 * enough that SOME clash is essentially always sitting in the queue (this
 * scenario: 55 clash + 30 battle promotions in the same window), the
 * entire one-shot tier below it — not just courtship, every category —
 * can starve forever, not just "usually lose." `COURTSHIP_STARVATION_TICKS`
 * only ever reorders one-shots AMONG each other; it can't reach past
 * battle/clash, so it didn't help here. This constant is deliberately
 * higher than `COURTSHIP_STARVATION_TICKS` (a much bigger ask — cutting
 * away from a real, live fight, not just reordering the one-shot queue)
 * and is meant to bite rarely: a healthy world drains its one-shot tier
 * well before this ever fires.
 */
const ONE_SHOT_HARD_STARVATION_TICKS = 900;
/**
 * Minimum real ticks between two separate one-shot engagements of the SAME
 * category getting queued at all — direct ask, after actually running the
 * app and watching auto-camera for a while: "autocam is still so
 * uncomfortable... It skips around a lot and focuses on boring shit."
 * First built courtship-only (`bonded`/`shelterBuilt`/`eggLaid` — a healthy
 * herd routinely bonds/lays several eggs within a handful of ticks of each
 * other), then generalized once a longer live run showed the exact same
 * clustering in "evolution" (a whole same-age cohort crossing its level
 * threshold together: 8 separate "bulbasaur evolved into ivysaur" cuts back
 * to back) and "death" (3 separate "arbok killed ivysaur" cuts in a row) —
 * any category CAN burst once a population is large/synchronized enough,
 * not just courtship. A cooldown per category collapses a burst like that
 * down to just its first moment — the camera still shows that flavor of
 * beat, it just doesn't chase every single individual instance a
 * synchronized population produces back to back, so a real fight or
 * immigration elsewhere doesn't end up buried behind a run of five
 * near-identical cuts. NOT applied to "immigration" (already engine-side
 * rate-limited to at most one group every `MIN_TICKS_BETWEEN_IMMIGRATIONS`
 * ticks — see `@pokuelike/engine`'s immigration.ts — so it can't burst the
 * same way) or to battle/clash (their own dedicated continuous-engagement
 * machinery already handles "the same fight keeps producing hits" by
 * widening one engagement rather than queuing a new one per hit).
 */
const ONE_SHOT_CLUSTER_COOLDOWN_TICKS = 60;
/**
 * `ONE_SHOT_CLUSTER_COOLDOWN_TICKS`'s own longer counterpart for
 * "courtship" specifically — direct ask: "bonding takes too much air time
 * on the autocam. reduce it." Courtship is both the most frequent one-shot
 * category (a growing herd routinely bonds/lays eggs/finishes shelters) and
 * the least individually dramatic, so it gets a real extra cooldown on top
 * of the shared baseline instead of sharing it with the rarer immigration/
 * hatch/evolution/death categories.
 */
const COURTSHIP_CLUSTER_COOLDOWN_TICKS = 150;
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
  /** Legacy tick-based bookkeeping, now dead weight for a one-shot's actual expiry (see `dwellUntilRealMs`) — kept only because it's still a convenient "was this preempted" tick stamp elsewhere in the file; not read by `reconcile`'s dwell check any more. Unused for a continuous battle/clash beyond that same stamping. */
  expiresOrLastActiveTick: number;
  /** `performance.now()` deadline a one-shot engagement's fixed camera hold expires at — what `DWELL_MS`/`COURTSHIP_DWELL_MS` actually count against (see `DWELL_MS`'s own doc comment for why real ms, not ticks). Set the moment a one-shot is popped/promoted to active, and stamped to "now" (an immediate deadline) on preemption by something higher-priority. Unused for a continuous battle/clash. */
  dwellUntilRealMs?: number;
  /** Tick this engagement was first queued (for a one-shot) — what `COURTSHIP_STARVATION_TICKS` counts elapsed WAITING time against, distinct from `expiresOrLastActiveTick` (which only gets a real dwell deadline once actually popped/active). See `popNextEngagement`'s own doc comment for why this exists. */
  queuedAtTick: number;
  /** `performance.now()` at the last real hit involving this continuous (battle/clash) engagement — what `BATTLE_STALE_MS`/`CLASH_STALE_MS` count elapsed real time against (see their own doc comments for why real ms, not ticks). Stamped on construction and on every widening hit in `onBattleHit`; unused for a one-shot engagement. */
  lastActiveRealMs: number;
  /** Set once conclusion fires on a continuous engagement — it keeps a short epilogue hold rather than vanishing on the same tick as the kill/retreat. Still used for the -1 "marked, not yet stamped" sentinel (see `onBattleParticipantLeft`) and by `BATTLE_STALE_MS`'s own real-ms staleness check; the actual epilogue hold duration is real-ms too, via `concludedAtRealMs` below. */
  concludedAtTick?: number;
  /** `performance.now()` at the moment this engagement actually became the ACTIVE one — what `BATTLE_MIN_ONSCREEN_MS` counts against. Deliberately not creation time: an engagement can sit in the queue behind another, and the hold is about how long it was ON SCREEN. */
  activeSinceRealMs?: number;
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
  /**
   * Pan/zoom the canvas onto this world position (tile coords) — auto-
   * camera's fixed close-in zoom by default, but the host zooms OUT (never
   * in past that default) far enough to keep every id in `ids` on screen
   * when they're spread out — direct ask: "sometimes it's hard to see the
   * auto cam targets like if they're bonded Pokemon but far away from each
   * other" (mobile's narrower viewport makes this worse). `ids` is the
   * full engagement roster `pos` was already averaged from
   * (`focusPos`) — omit it (a one-shot event with nothing left to bound,
   * `focusPos`'s own `fallbackPos` case) to keep the plain fixed-zoom
   * behavior. Called only while an engagement is active and the viewer
   * hasn't manually taken over the view (see `noteManualViewChange`).
   */
  focusOn(pos: Vec2, ids?: ReadonlySet<string>): void;
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
  /** Tick a brand-new pair was last promoted into a real "clash" engagement — backs `CLASH_PROMOTION_COOLDOWN_TICKS`'s throttle; see that constant's own doc comment. `undefined` before the first promotion (or cleared by `reset`). */
  private lastClashPromotedTick: number | undefined;
  /** Per-category tick a one-shot engagement was last actually queued — backs `ONE_SHOT_CLUSTER_COOLDOWN_TICKS`'s throttle; see that constant's own doc comment. Absent entry = never queued yet (or cleared by `reset`). */
  private lastEnqueuedTickByCategory = new Map<NotableCategory, number>();

  /**
   * The agent the viewer has selected in the inspector, if any — while set,
   * Auto Camera only follows moments that involve THIS animal.
   *
   * Direct ask: "if you're focused on a Pokémon in inspector while autocam is
   * going, just filter to all notable autocam events that involve that unit.
   * Filter out all else while it's focused."
   *
   * Applied at the queue, not at render time, so a filtered-out moment never
   * occupies a slot, never starts a dwell timer, and never counts against
   * the one-shot cluster cooldowns — the queue behaves as if the rest of the
   * world's moments simply were not notable. Rendering-time filtering would
   * leave the camera idling through moments it had decided not to show.
   */
  private focusAgentId: string | undefined;

  constructor(private readonly host: AutoCameraHost) {}

  /**
   * Point Auto Camera at one agent, or `undefined` to follow the world
   * again. Immediately drops anything queued (and the active engagement)
   * that does not involve the new focus — selecting an animal mid-battle
   * should cut to that animal's story now, not after the current fight
   * finishes playing out.
   */
  setFocusAgent(id: string | undefined): void {
    if (this.focusAgentId === id) return;
    this.focusAgentId = id;
    if (id === undefined) return;
    this.queue = this.queue.filter((e) => e.ids.has(id));
    if (this.active && !this.active.ids.has(id)) {
      this.active = undefined;
      // Keep `controllingView` as-is: `update` gives the view back on its own
      // once the queue drains, and yanking it back here would fight a
      // still-queued engagement that DOES involve the focused agent.
    }
  }

  /** Whether a moment involving `ids` is allowed through the focus filter. */
  private passesFocusFilter(ids: ReadonlySet<string>): boolean {
    return this.focusAgentId === undefined || ids.has(this.focusAgentId);
  }

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
    this.lastClashPromotedTick = undefined;
    this.lastEnqueuedTickByCategory.clear();
    // A new world's agent ids are meaningless here — a stale focus id would
    // match nothing and silently filter out every moment in the new world.
    this.focusAgentId = undefined;
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
   *
   * `playing` — direct report: "it loses focus after a while [while paused].
   * If I pause it I don't want to focus on something else unless I click
   * outside the box." Root cause: a concluded battle's epilogue hold
   * (`BATTLE_EPILOGUE_MS`/`CLASH_EPILOGUE_MS`) counts down in real wall-clock
   * time (`performance.now()`), deliberately, so it can't stall forever
   * behind a `step()` that only fires on a timer (see `ingest`'s own doc
   * comment) — but that means it kept expiring in the background even while
   * the world itself was frozen, moving the camera on to whatever queued
   * next without the viewer ever choosing that. `reconcile` now takes
   * `playing` and freezes just that one real-time comparison while paused —
   * every other tick-gated check here is already naturally frozen (ticks
   * don't advance while paused), so this is the one real gap.
   */
  update(world: World, playing: boolean): void {
    this.reconcile(world, playing);
    if (this.enabled && this.active && !this.viewerTookOver) this.host.focusOn(this.focusPos(this.active, world), this.active.ids);
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
        this.enqueueOneShot("immigration", event.kind, new Set(event.agentIds), event.pos, `${event.agentIds.length} ${event.species} arrived`, event.tick);
        return;
      case "bonded":
        this.enqueueClusteredOneShot("courtship", event.kind, new Set([event.agentId, event.partnerId]), event.pos, `${speciesLabel(event.species, event.partnerSpecies)} bonded`, event.tick);
        return;
      case "shelterBuilt":
        this.enqueueClusteredOneShot("courtship", event.kind, new Set([event.agentId]), event.pos, `${event.species} finished a shelter`, event.tick);
        return;
      case "eggLaid":
        this.enqueueClusteredOneShot("courtship", event.kind, new Set([event.motherId, event.fatherId, event.eggId]), event.pos, `${event.species} laid an egg`, event.tick);
        return;
      case "eggHatched":
        this.enqueueClusteredOneShot("hatch", event.kind, new Set([event.agentId]), event.pos, `${event.species} hatched`, event.tick);
        return;
      case "evolved": {
        const pos = world.agents.find((a) => a.id === event.agentId)?.pos ?? { x: 0, y: 0 };
        this.enqueueClusteredOneShot("evolution", event.kind, new Set([event.agentId]), pos, `${event.fromSpecies} evolved into ${event.toSpecies}`, event.tick);
        return;
      }
      case "killed":
        this.onDeath(event.kind, new Set([event.predatorId, event.preyId]), event.pos, `${idLabel(world, event.predatorId, event.predatorSpecies)} killed ${idLabel(world, event.preyId, event.preySpecies)}`, event.tick);
        return;
      case "defeated":
        this.onDeath(event.kind, new Set([event.winnerId, event.loserId]), event.pos, `${idLabel(world, event.winnerId, event.winnerSpecies)} defeated ${idLabel(world, event.loserId, event.loserSpecies)}`, event.tick);
        return;
      case "starved":
        this.onDeath(event.kind, new Set([event.agentId]), event.pos, `${event.species} starved`, event.tick);
        return;
      case "diedOfAge":
        this.onDeath(event.kind, new Set([event.agentId]), event.pos, `${event.species} died of old age`, event.tick);
        return;
      case "herdDissolved": {
        // A herd's last living member is gone — direct ask: "make sure herd
        // extinction events are captured on autocam and clearly explained."
        // No living agent left to find a position from (that's the whole
        // point), so this always falls back to the herd's own last-known
        // centroid (`lastSeenPos`, engine's herds.ts) rather than chasing an
        // agent id that can never resolve — see `focusPos`'s own fallback
        // path. `record` can in principle be missing (a `herdDissolved` from
        // before `world.herds` existed, or a test double) — degrades to the
        // bare species-less label rather than throwing.
        const record = world.herds?.[event.herdId];
        const species = record?.species;
        const label = species ? `${event.name} have died out — the last ${species} here` : `${event.name} have died out`;
        this.enqueueClusteredOneShot("extinction", event.kind, new Set([event.herdId]), record?.lastSeenPos ?? { x: 0, y: 0 }, label, event.tick);
        return;
      }
      case "titleClaimed": {
        // A unit becoming notable — direct ask: "when a unit become
        // notable, that should be an auto cam moment." `idLabel` already
        // renders the freshly-claimed title correctly here: `notables.ts`
        // sets `agent.notableTitle = title` in the very same synchronous
        // step that records this event, so by the time `ingest` reaches
        // this (always post-tick), the agent's own record already reflects
        // the new title.
        const pos = world.agents.find((a) => a.id === event.agentId)?.pos ?? { x: 0, y: 0 };
        this.enqueueClusteredOneShot("notable", event.kind, new Set([event.agentId]), pos, `${idLabel(world, event.agentId, event.species)} has become ${TITLE_DISPLAY_NAME[event.title]}`, event.tick);
        return;
      }
      case "fought":
        this.onBattleHit("battle", new Set([event.attackerId, event.defenderId]), event.pos, `${idLabel(world, event.attackerId, event.attackerSpecies)} vs ${idLabel(world, event.defenderId, event.defenderSpecies)} fighting`, world);
        return;
      case "herdClash":
        // "clash" — a lower-drama, faster-timing-out category than "battle",
        // direct ask: real fights ("fought") are the dramatic thing worth a
        // hard one-tick-at-a-time pause; a non-lethal herd resource
        // skirmish isn't. See `CLASH_STALE_MS`/`CLASH_EPILOGUE_MS`'s own
        // doc comments. Any real (non-"missed") hit is camera-worthy on its
        // own — see `maybeEngageClash`'s own doc comment for why this no
        // longer waits for a retaliating hit first.
        if (event.outcome !== "missed") {
          // "over a contested resource" — direct ask: "it'd also be nice on
          // a multi unit fight to explain why they're fighting... same with
          // clashes or territory." `herdConflict.ts`'s own design doc
          // comment is explicit that this is ALWAYS true for a `herdClash`
          // specifically (deliberately NOT territorial crowding — real food/
          // water tile contention is the one and only trigger), so this is
          // safe to state outright rather than guess at per-event.
          this.maybeEngageClash(
            event.tick,
            new Set([event.attackerId, event.defenderId]),
            event.pos,
            `${idLabel(world, event.attackerId, event.attackerSpecies)} vs ${idLabel(world, event.defenderId, event.defenderSpecies)} clashing over a contested resource`,
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

  private enqueueOneShot(category: NotableCategory, sourceKind: SimEvent["kind"], ids: Set<string>, pos: Vec2, label: string, tick: number): void {
    if (!this.passesFocusFilter(ids)) return;
    // Same *exact* moment (same originating event kind, overlapping
    // participants) already the subject of the currently-active or a
    // still-queued engagement (e.g. a hatch that immediately re-triggers via
    // a duplicate log entry) — don't pile up a redundant duplicate. Keyed on
    // `sourceKind`, not `category` — see `Engagement.sourceKind`'s doc
    // comment for why a shared category isn't enough here.
    if (this.active && this.active.sourceKind === sourceKind && setsOverlap(this.active.ids, ids)) return;
    if (this.queue.some((e) => e.sourceKind === sourceKind && setsOverlap(e.ids, ids))) return;
    this.queue.push({ category, sourceKind, ids, fallbackPos: pos, label, continuous: false, expiresOrLastActiveTick: 0, queuedAtTick: tick, lastActiveRealMs: performance.now(), seq: this.nextSeq++ });
    this.trimQueueOverflow();
  }

  /**
   * `enqueueOneShot`, gated by `ONE_SHOT_CLUSTER_COOLDOWN_TICKS` per
   * `category` (`COURTSHIP_CLUSTER_COOLDOWN_TICKS` instead for "courtship"
   * specifically — see that constant's own doc comment). Skips entirely
   * (not even reaching `enqueueOneShot`'s own dedup check) while a same-
   * category engagement was queued too recently; only starts/renews the
   * cooldown when something was actually pushed onto the queue, so a call
   * `enqueueOneShot` itself would have silently deduped (same moment,
   * already tracked) doesn't count as "shown" for cooldown purposes.
   */
  private enqueueClusteredOneShot(category: NotableCategory, sourceKind: SimEvent["kind"], ids: Set<string>, pos: Vec2, label: string, tick: number): void {
    const cooldown = category === "courtship" ? COURTSHIP_CLUSTER_COOLDOWN_TICKS : ONE_SHOT_CLUSTER_COOLDOWN_TICKS;
    const last = this.lastEnqueuedTickByCategory.get(category);
    if (last !== undefined && tick - last < cooldown) return;
    const before = this.queue.length;
    this.enqueueOneShot(category, sourceKind, ids, pos, label, tick);
    if (this.queue.length > before) this.lastEnqueuedTickByCategory.set(category, tick);
  }

  /**
   * Whether a brand-new `herdClash` pair's real hit is allowed to become a
   * camera-worthy "clash" engagement — see `CLASH_PROMOTION_COOLDOWN_TICKS`'s
   * own doc comment for the direct ask this exists for. A pair already
   * mid-engagement (widening an existing one) always qualifies immediately —
   * the cooldown only gates a pair's first PROMOTION, never a hit landed by
   * a pair already on screen.
   */
  private maybeEngageClash(tick: number, ids: Set<string>, pos: Vec2, label: string, world: World): void {
    if (this.findContinuous(ids)) {
      this.onBattleHit("clash", ids, pos, label, world);
      return;
    }
    if (this.lastClashPromotedTick !== undefined && tick - this.lastClashPromotedTick < CLASH_PROMOTION_COOLDOWN_TICKS) return;
    this.lastClashPromotedTick = tick;
    this.onBattleHit("clash", ids, pos, label, world);
  }

  /**
   * A `fought`/non-missed `herdClash` hit — starts a new continuous
   * engagement for this pair, or keeps an existing one (for either
   * participant) alive. `category` distinguishes a real fight ("battle",
   * `enterBattleStep`-worthy) from a herd rivalry skirmish ("clash", faster
   * timeouts, never `enterBattleStep` — see `CLASH_STALE_MS`).
   */
  private onBattleHit(category: "battle" | "clash", ids: Set<string>, pos: Vec2, label: string, world: World): void {
    const existing = this.findContinuous(ids);
    // Gated only for a BRAND-NEW engagement, below — an already-tracked
    // fight the focused agent is in must still be allowed to widen when a
    // third participant joins, or the engagement would stop following the
    // very fight it exists for.
    if (existing) {
      // A new participant can join mid-fight (e.g. a pack-hunt assist, or —
      // now that herd-conflict fights can genuinely coexist nearby — two
      // separate pairs whose own ids happen to overlap through a shared
      // participant) — widen the tracked id set so the log filter/camera
      // follow both pick it up, rather than starting a second, competing
      // engagement.
      for (const id of ids) existing.ids.add(id);
      existing.fallbackPos = pos;
      existing.expiresOrLastActiveTick = world.tick;
      existing.lastActiveRealMs = performance.now();
      // Direct ask: "multi-way 6 unit free for alls that get really
      // confusing" — once widening pulls a THIRD participant into what
      // started as an ordinary pair, the original "X vs Y" label no longer
      // describes what's actually on screen. Relabel to something that
      // reads as a real multi-agent brawl instead of a stale two-name
      // string quietly tracking more than it says.
      if (existing.ids.size > 2) {
        // "explain why they're fighting" for the multi-way case too — a
        // battle widening to 3+ is a real pack hunt (predation.ts's own
        // finishing-pool/mob-defense mechanics: allies piling onto the same
        // target), and a widened clash is the same resource contention as
        // any other clash, just with more claimants at once.
        existing.label = category === "battle" ? `${existing.ids.size}-way pack hunt` : `${existing.ids.size}-way brawl over a contested resource`;
      }
      return;
    }
    if (!this.passesFocusFilter(ids)) return;
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
      if (preempt) {
        this.active.expiresOrLastActiveTick = world.tick;
        this.active.dwellUntilRealMs = performance.now();
      }
    }
    this.queue.push({
      category,
      sourceKind: category === "battle" ? "fought" : "herdClash",
      ids: new Set(ids),
      fallbackPos: pos,
      label,
      continuous: true,
      expiresOrLastActiveTick: world.tick,
      queuedAtTick: world.tick,
      lastActiveRealMs: performance.now(),
      seq: this.nextSeq++,
    });
    this.trimQueueOverflow();
  }

  /** A death, fainting, or successful-retreat signal naming a continuous engagement's participant — the real conclusion path (see `BATTLE_STALE_MS`/`CLASH_STALE_MS` for the fallback path). Idempotent against an engagement already concluding. */
  private onBattleParticipantLeft(agentId: string): void {
    const engagement = this.findContinuous(new Set([agentId]));
    if (engagement && engagement.concludedAtTick === undefined) engagement.concludedAtTick = -1; // marked now, epilogue tick stamped once we know world.tick in reconcile()
  }

  /** A true death (`killed`/`defeated`/`starved`/`diedOfAge`) both concludes any continuous engagement it belongs to (via `onBattleParticipantLeft`, called by the same switch arms above through `fainted`/`killed` sharing a victim) and is itself notable on its own — queued as a fresh one-shot only when it isn't already the natural end of an active/queued engagement for the same id, so a kill doesn't show twice back to back. */
  private onDeath(sourceKind: SimEvent["kind"], ids: Set<string>, pos: Vec2, label: string, tick: number): void {
    for (const id of ids) this.onBattleParticipantLeft(id);
    const covered = (this.active?.continuous && setsOverlap(this.active.ids, ids)) || this.queue.some((e) => e.continuous && setsOverlap(e.ids, ids));
    if (!covered) this.enqueueClusteredOneShot("death", sourceKind, ids, pos, label, tick);
  }

  /**
   * Pop the next engagement to show, preferring any queued *battle*, then any
   * queued *clash*, over however long everything else has been waiting —
   * direct ask: "prioritize battles if there are multiple things going on."
   * Among the remaining one-shot categories, a non-"courtship" one
   * (immigration/hatch/evolution/death — all rarer and more individually
   * notable than routine bonding/egg-laying) jumps ahead of any queued
   * courtship too, same "boring stuff shouldn't block the more interesting
   * stuff" reasoning as battle/clash outranking everything else — direct
   * follow-up ask: "It skips around a lot and focuses on boring shit."
   * Otherwise plain FIFO (unchanged from before this method existed). A
   * currently-*active* one-shot doesn't go through here at all — see
   * `onBattleHit`'s own preemption of `this.active` for that half.
   *
   * `COURTSHIP_STARVATION_TICKS`'s own guard runs right after
   * battle/clash — a courtship entry waiting longer than that jumps back
   * ahead of a fresher non-courtship one-shot, so the strict priority
   * order above can deprioritize courtship without ever fully starving it
   * — see that constant's own doc comment for the real empirical bug this
   * closes (0 courtship promotions across 8000 real ticks).
   *
   * `ONE_SHOT_HARD_STARVATION_TICKS` runs first, ahead of even battle/clash
   * — see its own doc comment for the real empirical bug (0 extinction/
   * notable promotions despite real events) that made this necessary on
   * top of the courtship-only guard above.
   *
   * WHICH queued battle wins (when more than one is waiting), and likewise
   * for clash, is no longer plain FIFO either — see `storyWeight`'s own doc
   * comment. Direct ask: "add a prio system for autocam that focuses on
   * things that move the story forward, from a chronicle-like perspective."
   */
  private popNextEngagement(tick: number, world: World): Engagement {
    const hardStarvedIndex = this.queue.findIndex((e) => !e.continuous && tick - e.queuedAtTick >= ONE_SHOT_HARD_STARVATION_TICKS);
    if (hardStarvedIndex >= 0) return this.queue.splice(hardStarvedIndex, 1)[0]!;
    const battleIndex = this.bestQueuedIndex("battle", world);
    if (battleIndex >= 0) return this.queue.splice(battleIndex, 1)[0]!;
    const clashIndex = this.bestQueuedIndex("clash", world);
    if (clashIndex >= 0) return this.queue.splice(clashIndex, 1)[0]!;
    const staleCourtshipIndex = this.queue.findIndex((e) => e.category === "courtship" && tick - e.queuedAtTick >= COURTSHIP_STARVATION_TICKS);
    if (staleCourtshipIndex >= 0) return this.queue.splice(staleCourtshipIndex, 1)[0]!;
    const notableOneShotIndex = this.queue.findIndex((e) => e.category !== "courtship");
    if (notableOneShotIndex >= 0) return this.queue.splice(notableOneShotIndex, 1)[0]!;
    return this.queue.shift()!;
  }

  /** The index of the highest-`storyWeight` queued entry of `category` — ties keep the earliest-queued one (stable scan, strict `>`). -1 when nothing of that category is queued. */
  private bestQueuedIndex(category: "battle" | "clash", world: World): number {
    let bestIndex = -1;
    let bestWeight = -Infinity;
    this.queue.forEach((e, i) => {
      if (e.category !== category) return;
      const weight = this.storyWeight(e.ids, world);
      if (weight > bestWeight) {
        bestWeight = weight;
        bestIndex = i;
      }
    });
    return bestIndex;
  }

  /**
   * How much a queued battle/clash is worth showing over another one
   * competing for the same "which do we cut to next" slot — direct ask:
   * "add a prio system for autocam that focuses on things that move the
   * story forward, from a chronicle-like perspective... fights that make a
   * unit notable, fights that give enough xp so the winner can evolve,
   * fights that are close... fights that lead to extinction or otherwise
   * could sway the outcome of a herd." Purely a tie-break AMONG
   * already-queued battle entries (and separately clash entries) in
   * `bestQueuedIndex` above — it never lets a one-shot or a clash skip
   * ahead of a queued battle, or a fresher fight starve out; that's the
   * deliberately separate `ONE_SHOT_HARD_STARVATION_TICKS` rule.
   *
   * A best-effort proxy for each signal, not a lookahead — nothing here
   * can know how the fight actually turns out before it plays:
   *   - a participant already holding a notable title (an established
   *     character, not just any animal);
   *   - a participant one level from a real evolution AND already at least
   *     halfway through that level's exp span — close enough that this
   *     fight's own exp could plausibly be the one that tips it over,
   *     without also flagging every fight a low-level animal happens to be
   *     in as "evolution-adjacent";
   *   - a participant whose herd is down to its last couple of living
   *     members — losing this fight could plausibly end that herd's story
   *     (see the new "extinction" autocam category this session for the
   *     other half of that same ask);
   *   - every living participant already hurt (below 35% hp) — a fight
   *     that could plausibly end either way, not a one-sided beatdown.
   * Weights are ad hoc, not from any formula — extinction stakes rank
   * highest (the most irreversible, story-ending outcome of the four).
   */
  private storyWeight(ids: ReadonlySet<string>, world: World): number {
    const agents = [...ids].map((id) => world.agents.find((a) => a.id === id)).filter((a): a is Agent => !!a);
    if (agents.length === 0) return 0;
    let weight = 0;
    for (const agent of agents) {
      if (agent.notableTitle) weight += 3;

      const profile = LEVELING_CONTEXT.getProfile(agent.species);
      const level = agent.level ?? 1;
      const evolvesNextLevel = profile?.evolutions.some((e) => e.level === level + 1);
      if (profile && evolvesNextLevel) {
        const currentThreshold = totalExpForLevel(profile.growthRate, level);
        const nextThreshold = totalExpForLevel(profile.growthRate, level + 1);
        const span = nextThreshold - currentThreshold;
        const progress = span > 0 ? ((agent.exp ?? 0) - currentThreshold) / span : 0;
        if (progress >= 0.5) weight += 4;
      }

      if (agent.herdId) {
        const herdSize = world.agents.filter((a) => a.alive !== false && a.herdId === agent.herdId).length;
        if (herdSize > 0 && herdSize <= 2) weight += 5;
      }
    }
    const hpFractions = agents.filter((a) => a.alive !== false && a.hp !== undefined && a.maxHp).map((a) => a.hp! / a.maxHp!);
    if (hpFractions.length >= 2 && hpFractions.every((f) => f <= 0.35)) weight += 2;
    return weight;
  }

  /**
   * `MAX_QUEUE` overflow handling — evicts the OLDEST queued *continuous*
   * (battle/clash) entry when one exists, only falling back to the very
   * oldest entry overall (the previous, unconditional behavior) when the
   * whole queue is one-shots. Direct requirement, discovered investigating
   * why extinction/notable moments went unseen despite real events firing:
   * a busy world's battle/clash entries are cheap and self-regenerating (a
   * dropped one just means the next real hit re-queues its pair a moment
   * later — `onBattleHit` widens/re-engages on its own), but a one-shot
   * like a herd's extinction is a single, non-repeating moment — losing it
   * to eviction means it is gone from the story forever, not just delayed.
   * `popNextEngagement`'s plain `queue[0]`-was-oldest assumption doesn't
   * hold once this stops evicting strictly front-to-back, but nothing
   * reads eviction order as a promise of pop order beyond that.
   */
  private trimQueueOverflow(): void {
    if (this.queue.length <= MAX_QUEUE) return;
    const oldestContinuousIndex = this.queue.reduce<number>((best, e, i) => (e.continuous && (best < 0 || e.queuedAtTick < this.queue[best]!.queuedAtTick) ? i : best), -1);
    if (oldestContinuousIndex >= 0) this.queue.splice(oldestContinuousIndex, 1);
    else this.queue.shift();
  }

  /** Any active/queued continuous (battle or clash) engagement overlapping `ids`. */
  private findContinuous(ids: Set<string>): Engagement | undefined {
    if (this.active?.continuous && setsOverlap(this.active.ids, ids)) return this.active;
    return this.queue.find((e) => e.continuous && setsOverlap(e.ids, ids));
  }

  // --- state machine -----------------------------------------------------------

  private reconcile(world: World, playing: boolean): void {
    const tick = world.tick;

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
        // both halves than a real "battle" — see CLASH_STALE_MS/
        // CLASH_EPILOGUE_MS's own doc comments for why.
        const staleMs = this.active.category === "clash" ? CLASH_STALE_MS : BATTLE_STALE_MS;
        const epilogueMs = this.active.category === "clash" ? CLASH_EPILOGUE_MS : BATTLE_EPILOGUE_MS;
        // Gated on `playing` — same real-time-needs-a-pause-guard reasoning
        // as the epilogue check right below (see `update`'s own doc
        // comment): staleness is now real-ms too (`BATTLE_STALE_MS`'s own
        // doc comment), so it's the second real-time check here that needs
        // the guard, not just the epilogue.
        if (playing && this.active.concludedAtTick === undefined && performance.now() - this.active.lastActiveRealMs > staleMs) {
          // Fallback path: no explicit death/flee/retreat signal, but nothing's landed a hit in a while either — treat as disengaged.
          this.active.concludedAtTick = tick;
          this.active.concludedAtRealMs = performance.now();
        }
        // The epilogue hold itself — same `playing` guard, see `update`'s own
        // doc comment — plus the minimum-on-screen floor, so a one-exchange
        // skirmish (the MEDIAN real fight, see `BATTLE_MIN_ONSCREEN_MS`) is
        // still on screen long enough to read. Only battles get the floor;
        // a "clash" is deliberately a quick glance.
        const minOnScreen = this.active.category === "clash" ? CLASH_MIN_ONSCREEN_MS : BATTLE_MIN_ONSCREEN_MS;
        const heldLongEnough =
          this.active.activeSinceRealMs === undefined || performance.now() - this.active.activeSinceRealMs >= minOnScreen;
        if (playing && heldLongEnough && this.active.concludedAtRealMs !== undefined && performance.now() - this.active.concludedAtRealMs >= epilogueMs) {
          this.finishActive(world, playing);
        }
        // Real-ms dwell, same `playing` guard as the continuous branch above
        // — see `DWELL_MS`'s own doc comment for why this is wall-clock, not
        // ticks (the old `tick >= expiresOrLastActiveTick` check no longer
        // drives this; that field is now only ever the preemption trigger).
      } else if (playing && this.active.dwellUntilRealMs !== undefined && performance.now() >= this.active.dwellUntilRealMs) {
        this.finishActive(world, playing);
      }
    }

    if (!this.active && this.queue.length > 0) {
      const next = this.popNextEngagement(tick, world);
      if (!next.continuous) next.dwellUntilRealMs = performance.now() + (next.category === "courtship" ? COURTSHIP_DWELL_MS : DWELL_MS);
      // Stamped here, at the moment this engagement actually takes the
      // screen, rather than when it was created — an engagement can wait in
      // the queue behind another, and the minimum hold is about how long it
      // was VISIBLE. See `BATTLE_MIN_ONSCREEN_MS`.
      next.activeSinceRealMs = performance.now();
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

  private finishActive(world: World, playing: boolean): void {
    this.active = undefined;
    // Immediately try to promote the next queued engagement on the same
    // reconcile pass so a back-to-back run of events (e.g. a kill right as
    // an evolution fires elsewhere) doesn't sit on an empty frame first.
    this.reconcile(world, playing);
  }

  private applySlowdownIfNeeded(): void {
    // Clashes get the one-tick-at-a-time beat too. They were already given
    // the same rich Battle Screen as a real battle (same move/crit/damage
    // lines, same HP bars) but not the same pacing, so they played out at
    // whatever the speed slider said — and they outnumber real battles 13
    // to 1, so that gap was most of what a viewer actually saw. See
    // `CLASH_MIN_ONSCREEN_MS`.
    if (this.active && (this.active.category === "battle" || this.active.category === "clash")) {
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
