import { EventLog, biomeWeightsAt, tickWorld, tickMacroWorld, tickHerds, setFocusedZone, findRegion, randomSeed, type Agent, type MacroWorld, type SimEvent, type Vec2, type World, advancePlayerTurn, findPlayer, examine, describeBehavior, nextTravelStep, visibleAgentIds, harvestableAt, harvestLeft, carriedWeight, countOf, carryCapacityOf, TORCH_FUEL_TICKS, FOOD_MATERIAL_IDS, nearFire, useStairs, isAtExit, crossZoneEdge, findWalkableNear, resolveShape, type Direction, type PlayerAction, type PlayerActionOutcome, type Layer } from "@pokuelike/engine";
import { createCaveRun, CAVE_RUN_DEPTH, createDemoWorld, createDemoMacroWorld, createPlayerDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, SCENARIO_SEED, SPECIES, itemName } from "@pokuelike/data";
import { agentAtCanvasPos, drawEventPopups, drawMoveFlashes, drawTargetPreview, drawWorld, highlightBounds, setVisibleRect, TILE_SIZE, type RenderStyle } from "./renderer.js";
import { eventNamesAgent, formatEvent, findMoveUsed } from "./eventText.js";
import { EventLogPanel } from "./eventLogPanel.js";
import { clearSavedRun, loadRun, saveRun, type RestoredRun } from "./saveGame.js";
import { examineTile, verbsForTile, type TileReport, type TileVerb } from "@pokuelike/engine";
import { ActionLogPanel } from "./actionLog.js";
import { TileMenu, menuItemsFor } from "./tileMenu.js";
import { ChroniclePanel } from "./chroniclePanel.js";
import { EventPopups } from "./eventPopups.js";
import { MoveEffects } from "./moveEffects.js";
import { renderInspector, type GroupSelection } from "./inspector.js";
import { AutoCameraController, type AutoCameraHost } from "./autoCamera.js";
import { BattleScreenPanel } from "./battleScreenPanel.js";
import { MacroMapView, MACRO_MAP_DEFAULT_BLOCK_PX, drawMacroMap } from "./macroMap.js";
import { drawRegionThumbnail } from "./overworldMap.js";

/**
 * Ticks per real second at speed multiplier 1x. Multiplied by `SPEED_STEPS`
 * below for the fast end, divided for the slow end — a dev/observer control,
 * not tuned for anything more precise than "watch a story unfold at a
 * comfortable pace, or blast through to see a longer-run outcome."
 */
const BASE_TICKS_PER_SEC = 6;
/**
 * Direct ask: "Let's max the speed at x9 not x32."
 *
 * 8 stays on the ladder even though 8 -> 9 is a small last step, because
 * `AUTO_CAM_SLOWDOWN_SPEED` is 8 and `setSpeed` resolves a speed by
 * `indexOf` and silently no-ops on a miss — dropping 8 would quietly disable
 * auto-camera's slowdown rather than fail loudly.
 */
const SPEED_STEPS = [0.25, 0.5, 1, 2, 4, 6, 8, 9] as const;
const DEFAULT_SPEED_INDEX = 2; // 1x

/**
 * The 90x60 demo map renders wider/taller than most viewports at 1x
 * (TILE_SIZE px/tile) — zooming out is the common case. Continuous, not
 * stepped, so a two-finger pinch gesture can drive it smoothly; the +/-
 * buttons just multiply/divide by a fixed factor.
 */
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 2;
const ZOOM_BUTTON_FACTOR = 1.25;
const DEFAULT_ZOOM = 0.8; // the whole demo map roughly fits a laptop viewport at this level
/**
 * Auto Camera's fixed close-in zoom. Originally `ZOOM_MAX` (200%); direct
 * follow-up ask ("a little more zoom out on auto cam, maybe 150%") pulled it
 * back to 150% — still a fixed level rather than something scaled to fit
 * exactly two combatants: simple, predictable, and already a genuinely
 * closer view than default for every notable-event category (a lone
 * hatchling, a two-agent battle, a three-agent immigration group) without
 * per-category zoom-fit math that a moving multi-agent battle would
 * immediately invalidate anyway.
 */
const AUTO_CAM_ZOOM = 1.5;
/**
 * Real ms per tick while a battle has taken over ticking (see
 * `AutoCameraHost.enterBattleStep`) — a fixed, deliberate beat per tick
 * rather than a speed multiplier. Direct follow-up ask: "step through them
 * one tick at a time rather than super slow speed, it's too hard to
 * follow" (0.25x was still continuous timer-driven ticking, which could
 * still blur consecutive hits together). Chosen slow enough to read one
 * battle-log line/HP change per beat without feeling like a stall.
 *
 * Raised from 650ms on a direct follow-up: "battles are so short now, i
 * can't follow em at all... its too fast too follow." A landed hit produces
 * 3-4 log lines and the reveal is one line per
 * `LINE_REVEAL_INTERVAL_MS` (battleScreenPanel.ts), so at 650ms a
 * four-line hit had roughly 10ms of slack before the next tick's batch
 * landed on top of it — the reveal was effectively continuous rather than
 * beat-by-beat. 950ms against a 200ms reveal leaves a real pause between
 * exchanges, which is what makes a beat readable.
 */
const BATTLE_STEP_INTERVAL_MS = 950;

// --- DOM references -------------------------------------------------------

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const canvasWrap = document.getElementById("canvas-wrap") as HTMLElement;
const ctx = canvas.getContext("2d")!;
const mapAreaEl = document.getElementById("map-area") as HTMLElement;
const seedInput = document.getElementById("seed-input") as HTMLInputElement;
const loadSeedBtn = document.getElementById("load-seed") as HTMLButtonElement;
const randomSeedBtn = document.getElementById("random-seed") as HTMLButtonElement;
const copySeedBtn = document.getElementById("copy-seed") as HTMLButtonElement;
const seedChipWrap = document.getElementById("seed-chip-wrap") as HTMLElement;
const seedChipBtn = document.getElementById("seed-chip") as HTMLButtonElement;
const seedChipLabel = document.getElementById("seed-chip-label") as HTMLElement;
const seedPopover = document.getElementById("seed-popover") as HTMLElement;
const playPauseBtn = document.getElementById("play-pause") as HTMLButtonElement;
const playIcon = document.getElementById("play-icon") as unknown as HTMLElement;
const pauseIcon = document.getElementById("pause-icon") as unknown as HTMLElement;
const stepBtn = document.getElementById("step") as HTMLButtonElement;
const speedSlider = document.getElementById("speed") as HTMLInputElement;
const speedLabel = document.getElementById("speed-label") as HTMLElement;
const tickLabel = document.getElementById("tick-label") as HTMLElement;
const clockLabel = document.getElementById("clock-label") as HTMLElement;
const eventLogEl = document.getElementById("event-log") as HTMLElement;
const inspectorEl = document.getElementById("inspector") as HTMLElement;
const clearSelectionBtn = document.getElementById("clear-selection") as HTMLButtonElement;
const expandPanelBtn = document.getElementById("expand-panel") as HTMLButtonElement;
const panelBodyEl = document.getElementById("panel-body") as HTMLElement;
const hideNoiseCheckbox = document.getElementById("hide-noise") as HTMLInputElement;
const hideLevelUpsCheckbox = document.getElementById("hide-levelups") as HTMLInputElement;
const headlinesOnlyCheckbox = document.getElementById("headlines-only") as HTMLInputElement;
const myLogOnlyCheckbox = document.getElementById("my-log-only") as HTMLInputElement;
const chipHideNoise = document.getElementById("chip-hide-noise") as HTMLElement;
const chipHideLevelUps = document.getElementById("chip-hide-levelups") as HTMLElement;
const chipHeadlinesOnly = document.getElementById("chip-headlines-only") as HTMLElement;
const chipMyLogOnly = document.getElementById("chip-my-log") as HTMLElement;
const styleTileBtn = document.getElementById("style-tile") as HTMLButtonElement;
const styleAsciiBtn = document.getElementById("style-ascii") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoom-out") as HTMLButtonElement;
const zoomInBtn = document.getElementById("zoom-in") as HTMLButtonElement;
const zoomLabel = document.getElementById("zoom-label") as HTMLElement;
const autoCamToggleBtn = document.getElementById("auto-cam-toggle") as HTMLButtonElement;
const autoCamStatusEl = document.getElementById("auto-cam-status") as HTMLElement;
const autoCamBadgeEl = document.getElementById("auto-cam-badge") as HTMLElement;
const battleScreenEl = document.getElementById("battle-screen") as HTMLElement;
const eventsPageEl = document.getElementById("events-page") as HTMLElement;
const tabInspectorBtn = document.getElementById("tab-inspector") as HTMLButtonElement;
const tabChronicleBtn = document.getElementById("tab-chronicle") as HTMLButtonElement;
const chronicleEl = document.getElementById("chronicle-page") as HTMLElement;
const tabBattleScreenBtn = document.getElementById("tab-battle-screen") as HTMLButtonElement;
const tabEventsBtn = document.getElementById("tab-events") as HTMLButtonElement;
const tabYouBtn = document.getElementById("tab-you") as HTMLButtonElement;
const tabWorldBtn = document.getElementById("tab-world") as HTMLButtonElement;
const youPageEl = document.getElementById("you-page") as HTMLElement;
const youTitleEl = document.getElementById("you-title") as HTMLElement;
const partyBodyEl = document.getElementById("party-body") as HTMLElement;
const partyCountEl = document.getElementById("party-count") as HTMLElement;
const sheetHandleEl = document.getElementById("sheet-handle") as HTMLElement;
const headerToggleBtn = document.getElementById("header-toggle") as HTMLButtonElement;
const eventTickerEl = document.getElementById("event-ticker") as HTMLElement;
const togglePanelBtn = document.getElementById("toggle-panel") as HTMLButtonElement;
const sidePanelEl = document.getElementById("side-panel") as HTMLElement;
const moreMenuWrap = document.getElementById("more-menu-wrap") as HTMLElement;
const moreMenuToggleBtn = document.getElementById("more-menu-toggle") as HTMLButtonElement;
const moreMenuEl = document.getElementById("more-menu") as HTMLElement;
const mapModeSwitchEl = document.getElementById("map-mode-zone")!.parentElement as HTMLElement;
const mapModeZoneBtn = document.getElementById("map-mode-zone") as HTMLButtonElement;
const mapModeOverworldBtn = document.getElementById("map-mode-overworld") as HTMLButtonElement;
const minimapWidgetEl = document.getElementById("minimap-widget") as HTMLElement;
const minimapButton = document.getElementById("minimap-button") as HTMLButtonElement;
const minimapArtZone = document.getElementById("minimap-art-zone") as HTMLCanvasElement;
const minimapArtOverworld = document.getElementById("minimap-art-overworld") as HTMLElement;
const minimapOverworldCanvas = document.getElementById("minimap-overworld-canvas") as HTMLCanvasElement;
const minimapMarkerEl = document.getElementById("minimap-marker") as HTMLElement;
const minimapCaption = document.getElementById("minimap-caption") as HTMLElement;
const regionBannerEl = document.getElementById("region-banner") as HTMLElement;
const modeWatchBtn = document.getElementById("mode-watch") as HTMLButtonElement;
const modePlayBtn = document.getElementById("mode-play") as HTMLButtonElement;
// ROADMAP.md M3 — the player's needs HUD and the death screen.
const playerHudEl = document.getElementById("player-hud") as HTMLElement;
const hudMessageEl = document.getElementById("hud-message") as HTMLElement;
const gameOverEl = document.getElementById("game-over") as HTMLElement;
const runWonEl = document.getElementById("run-won") as HTMLElement;
const runWonStatsEl = document.getElementById("run-won-stats") as HTMLElement;
const runWonContinueBtn = document.getElementById("run-won-continue") as HTMLButtonElement;
const gameOverCauseEl = document.getElementById("game-over-cause") as HTMLElement;
const gameOverStatsEl = document.getElementById("game-over-stats") as HTMLElement;
const hudPackEl = document.getElementById("hud-pack") as HTMLElement;
const hudDepthEl = document.getElementById("hud-depth") as HTMLElement;
const packMenuEl = document.getElementById("pack-menu") as HTMLElement;
const packMenuBodyEl = document.getElementById("pack-menu-body") as HTMLElement;
const packMenuCloseBtn = document.getElementById("pack-menu-close") as HTMLButtonElement;
const commandMenuEl = document.getElementById("command-menu") as HTMLElement;
const commandMenuBodyEl = document.getElementById("command-menu-body") as HTMLElement;
const commandMenuCloseBtn = document.getElementById("command-menu-close") as HTMLButtonElement;
// Direct ask: "have herd hp and status bars like easy to pin so you can
// see all; at once."

// --- State -----------------------------------------------------------------

let world: World;
/**
 * Set only while Overworld mode is on — `world` above always mirrors
 * whatever zone is currently focused (`findRegion(macroWorld,
 * macroWorld.focusedKey)!.world`), so every existing single-map consumer
 * (renderer, inspector, event log, auto camera, ...) keeps working
 * completely unchanged; this is purely what `step()`/the overworld-toggle
 * handler need to drive the macro grid itself. `undefined` in ordinary
 * single-map mode.
 */
let macroWorld: MacroWorld | undefined;
const macroMapWrapEl = document.getElementById("macro-map-wrap") as HTMLElement;
const overworldToggleBtn = document.getElementById("overworld-toggle") as HTMLButtonElement;
const macroMapCanvas = document.getElementById("macro-map-canvas") as HTMLCanvasElement;
const macroMapZoomLabel = document.getElementById("macro-map-zoom-label") as HTMLElement;
const macroMapZoomInBtn = document.getElementById("macro-map-zoom-in") as HTMLButtonElement;
const macroMapZoomOutBtn = document.getElementById("macro-map-zoom-out") as HTMLButtonElement;
const macroMapScrollEl = document.getElementById("macro-map-scroll") as HTMLElement;
const macroMapView = new MacroMapView(macroMapCanvas, macroMapZoomLabel, focusZone);
/** Real ms between the corner mini-map widget's own redraws — see its call site in `frame()`'s own doc comment for why a modest lag here is fine. */
const MINIMAP_WIDGET_RENDER_THROTTLE_MS = 1000;
let lastMinimapWidgetRenderAt = 0;
let log: EventLog;
let playing = false;
let speedIndex = DEFAULT_SPEED_INDEX;
let intervalId: number | undefined;
/** True while a battle owns ticking via its own fixed `BATTLE_STEP_INTERVAL_MS` cadence instead of the ordinary speed slider — see `scheduleLoop` and the `enterBattleStep`/`exitBattleStep` host methods below. */
let battleStepMode = false;
let selectedAgentId: string | undefined;
/**
 * ROADMAP.md M0: when true, the world advances only when the player acts —
 * the free-running tick interval is never scheduled, and keyboard input
 * drives `advancePlayerTurn`. Entered via `?player=1`.
 */
let playerMode = false;
/** What `loadPlayerWorld` was last asked for, so "R to try again" reloads the same run. */
let playerScene: "surface" | "cave" = "surface";
let playerSeed = 0;
let playerDead = false;
/** ROADMAP.md M7: "Done when: you emerge." Set once the player steps onto the deepest level's exit tile — see `checkWinCondition`. */
let playerWon = false;
let lastLoggedEventCount = 0;
/**
 * Direct report: "I don't see what damaged me or what move was used" /
 * "when I command a unit to attack a tile it's not really clear if it's
 * hitting the tile or the Pokémon." `renderPlayerHud` already overwrites
 * `hudMessageEl` with the player's own action outcome every call
 * (`outcomeText`) — that message says nothing about a hit the player took
 * from someone ELSE's turn, or about a bonded ally's own commanded attack
 * landing/missing on its own later tick. `afterTick` computes this from
 * the real `fought`/`missed` events and stashes it here; `playerAct`
 * applies it as the FINAL word after `renderPlayerHud` runs, so real
 * combat news always wins over a routine "You move."
 */
let pendingCombatNotice: string | undefined;
/**
 * MOVES_AND_TOOLS.md's `attack` needs a direction, and there's no on-screen
 * cursor to aim one with — reused the last direction the player MOVED
 * (attempted or not; bumping into a wall still points you at it) as "which
 * way you're facing," same shorthand any roguelike with 8-directional
 * movement and no separate aim step uses. UI-only state: the engine has no
 * concept of player facing at all.
 */
let lastFacing: { dx: -1 | 0 | 1; dy: -1 | 0 | 1 } = { dx: 0, dy: 1 };
/**
 * Direct ask: "select your bonded pokemon... select a move and target a
 * space with it." Set once a move is picked from the command menu; the next
 * canvas click (any tile — living target or bare terrain) becomes that
 * order's `target` instead of the ordinary select/travel-to click. Cleared
 * on firing, on Escape, or on pressing Attack again.
 *
 * `agentId: undefined` means the move being targeted is the PLAYER's own —
 * direct ask, "change attack for player moves to also be targeted, like
 * allies moves": the same pick-a-move-then-tap-a-tile flow, just firing
 * `{kind: "attack", target, moveId}` instead of `{kind: "command", ...}`.
 */
let targeting: { agentId?: string; moveId: string } | undefined;
/**
 * Direct ask: "Even the targeting for allies should like show the cone or
 * the aoe of a target." The real resolved tiles (`resolveShape`) a move
 * would hit if committed at the currently-hovered tile — recomputed on
 * every `mousemove` while `targeting` is active (see the canvas listener
 * below), drawn by `drawTargetPreview` in `frame()`. Empty outside
 * targeting mode.
 */
let targetPreviewTiles: Vec2[] = [];
let inspectorDirty = true;
let renderStyle: RenderStyle = "tile";
let zoom = DEFAULT_ZOOM;

const eventLogPanel = new EventLogPanel(eventLogEl);
const chroniclePanel = new ChroniclePanel(chronicleEl);
const battleScreenPanel = new BattleScreenPanel(battleScreenEl);
const eventPopups = new EventPopups();
const moveEffects = new MoveEffects();

// --- Auto Camera -------------------------------------------------------------
// See autoCamera.ts for the detection/state-machine design writeup (DESIGN.md
// has the full decision record). This file supplies the DOM-facing half: the
// actual camera (zoom + canvas-wrap scroll) and speed-slider control, plus
// telling the controller apart a genuine user-driven pan/zoom/speed change
// from auto-camera's own, so the two don't fight each other.

/** The view (zoom + scroll) captured the moment auto-camera takes over from idle, restored once it lets go again. `undefined` whenever auto-camera isn't currently controlling the view. */
let autoCamHomeView: { zoom: number; scrollLeft: number; scrollTop: number } | undefined;
/**
 * The exact scroll position auto-camera itself last set — compared against
 * on the next real `scroll` event to tell "the browser fired this because
 * WE moved it" apart from "the viewer dragged/scrolled it themselves,"
 * without a fragile timing-based ignore-flag. Sharing one canvas-wrap scroll
 * listener with a real user gesture only works because our own sets are
 * exact (no smooth/animated scrolling — see `focusCameraOn`).
 */
let autoCamLastScroll: { left: number; top: number } | undefined;

/**
 * `ids`, when given, zooms OUT (never in past `AUTO_CAM_ZOOM`) far enough
 * to keep every one of them on screen — same "fit the bounding box, with a
 * margin, clamped both ways" formula `focusOnGroup` already uses for a
 * herd/species highlight. Direct ask: "sometimes it's hard to see the auto
 * cam targets like if they're bonded Pokemon but far away from each
 * other" — `pos` alone (the engagement's own midpoint, see `focusPos`) was
 * always framed at the same fixed close-in zoom regardless of how far
 * apart the participants actually were, so two bonded Pokémon on opposite
 * sides of that midpoint could both sit outside the viewport at once —
 * worse on mobile's narrower frame. Falls back to the plain fixed zoom
 * when `ids` is omitted, or when `highlightBounds` finds nothing to
 * measure (e.g. `focusPos`'s own `fallbackPos` case, no living agent left
 * to bound).
 */
function focusCameraOn(pos: Vec2, ids?: ReadonlySet<string>, keepZoom = false): void {
  const bounds = ids ? highlightBounds(world, ids) : undefined;
  if (keepZoom) {
    // Recentre without re-framing. Play mode passes this when the world
    // changed under the player (a new cave level, a zone crossing) so the
    // old scroll offsets are meaningless — but the zoom the player chose
    // is still theirs, and resetting it is the bug `keepPlayerInView`
    // below exists to avoid.
  } else if (bounds) {
    const spanX = bounds.right - bounds.left;
    const spanY = bounds.bottom - bounds.top;
    const fit = Math.min(canvasWrap.clientWidth / Math.max(1, spanX), canvasWrap.clientHeight / Math.max(1, spanY)) * 0.8;
    setZoom(Math.max(ZOOM_MIN, Math.min(AUTO_CAM_ZOOM, fit)));
  } else {
    setZoom(AUTO_CAM_ZOOM);
  }
  const targetLeft = Math.max(0, (pos.x + 0.5) * TILE_SIZE * zoom - canvasWrap.clientWidth / 2);
  const targetTop = Math.max(0, (pos.y + 0.5) * TILE_SIZE * zoom - canvasWrap.clientHeight / 2);
  autoCamLastScroll = { left: targetLeft, top: targetTop };
  canvasWrap.scrollLeft = targetLeft;
  canvasWrap.scrollTop = targetTop;
}

/**
 * How close to the viewport edge the player may get before the camera follows,
 * as a fraction of the viewport — roughly two tiles at default zoom, leaving
 * the middle ~76% of the screen as a dead zone the camera ignores entirely.
 *
 * Deliberately small. A generous dead zone (0.3 was tried and measured) parks
 * the player exactly ON the boundary whenever the camera does correct, so the
 * very next pan in that direction is immediately undone and panning feels
 * stuck — the same complaint, from the opposite cause. Small margin = the
 * camera only steps in when you are about to genuinely lose sight of yourself.
 */
const CAMERA_DEADZONE = 0.12;

/**
 * Play mode's camera follow, and deliberately NOT `focusCameraOn`.
 *
 * Direct ask: "On Mobile I don't like how hard it is to scroll around the
 * screen." The cause, measured live on a 390px viewport: `focusCameraOn` ran
 * after *every* `playerAct`, and it both re-centres and calls
 * `setZoom(AUTO_CAM_ZOOM)` unconditionally. So one step threw away whatever
 * the player had just done — zooming out to 0.96 snapped back to 1.5, and a
 * 300px pan snapped back to centre. Pinch-zoom was effectively inoperable:
 * you could zoom, but not zoom *and then play*.
 *
 * This leaves the view exactly where the player put it as long as they can
 * still see themselves, and only scrolls the minimum needed to pull them back
 * inside the dead zone. It never touches zoom at all.
 */
function keepPlayerInView(pos: Vec2): void {
  const w = canvasWrap.clientWidth;
  const h = canvasWrap.clientHeight;
  const px = (pos.x + 0.5) * TILE_SIZE * zoom;
  const py = (pos.y + 0.5) * TILE_SIZE * zoom;
  const marginX = w * CAMERA_DEADZONE;
  const marginY = h * CAMERA_DEADZONE;

  const clamp = (value: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(value, lo), hi));
  const maxScrollLeft = Math.max(0, canvasWrap.scrollWidth - w);
  const maxScrollTop = Math.max(0, canvasWrap.scrollHeight - h);

  // Two different corrections, because one size does not fit both cases.
  // Lost the player entirely (a zoom change, or a big deliberate pan)? Centre
  // them properly — a minimal nudge would park them hard against the screen
  // edge, which then makes the very next pan feel stuck. Merely drifted out
  // of the dead zone by walking? Nudge the minimum, so following reads as the
  // camera easing along with you rather than snapping.
  const onScreenX = px - canvasWrap.scrollLeft;
  const onScreenY = py - canvasWrap.scrollTop;
  const lost = onScreenX < 0 || onScreenX > w || onScreenY < 0 || onScreenY > h;
  const desiredLeft = lost ? px - w / 2 : clamp(canvasWrap.scrollLeft, px - w + marginX, px - marginX);
  const desiredTop = lost ? py - h / 2 : clamp(canvasWrap.scrollTop, py - h + marginY, py - marginY);
  const left = clamp(desiredLeft, 0, maxScrollLeft);
  const top = clamp(desiredTop, 0, maxScrollTop);

  // Don't touch the scroll (or `autoCamLastScroll`) when nothing needs to
  // move — a redundant write would register as our own scroll and pointlessly
  // suppress the next genuine manual-pan notification.
  if (Math.abs(left - canvasWrap.scrollLeft) < 1 && Math.abs(top - canvasWrap.scrollTop) < 1) return;
  autoCamLastScroll = { left, top };
  canvasWrap.scrollLeft = left;
  canvasWrap.scrollTop = top;
}

const autoCamHost: AutoCameraHost = {
  captureHomeView(): void {
    autoCamHomeView = { zoom, scrollLeft: canvasWrap.scrollLeft, scrollTop: canvasWrap.scrollTop };
  },
  focusOn(pos: Vec2, ids?: ReadonlySet<string>): void {
    focusCameraOn(pos, ids);
  },
  restoreHomeView(): void {
    const home = autoCamHomeView;
    autoCamHomeView = undefined;
    if (!home) return;
    setZoom(home.zoom);
    autoCamLastScroll = { left: home.scrollLeft, top: home.scrollTop };
    canvasWrap.scrollLeft = home.scrollLeft;
    canvasWrap.scrollTop = home.scrollTop;
  },
  getSpeed(): number {
    return SPEED_STEPS[speedIndex]!;
  },
  setSpeed(speed: number): void {
    const index = SPEED_STEPS.indexOf(speed as (typeof SPEED_STEPS)[number]);
    if (index < 0 || index === speedIndex) return;
    speedIndex = index;
    speedSlider.value = String(speedIndex);
    speedLabel.textContent = `${SPEED_STEPS[speedIndex]}x`;
    scheduleLoop();
  },
  enterBattleStep(): void {
    if (battleStepMode) return;
    battleStepMode = true;
    scheduleLoop();
    // The speed slider's own value/label is untouched by battle-step mode
    // (it isn't driving ticking at all right now — see `scheduleLoop`), so
    // left alone it just keeps showing whatever speed the viewer had picked
    // (often 16x/32x). Direct bug report: "auto cam seems broken... it's
    // not slowing down" during an actual real-fight pause-and-step — the
    // state machine genuinely was pausing ordinary ticking (verified live:
    // exactly one tick per `BATTLE_STEP_INTERVAL_MS`), the speed readout
    // just never said so, so a real slowdown read as "nothing changed."
    speedLabel.textContent = "Battle!";
    speedLabel.classList.add("battle-step-active");
  },
  exitBattleStep(): void {
    if (!battleStepMode) return;
    battleStepMode = false;
    scheduleLoop();
    speedLabel.textContent = `${SPEED_STEPS[speedIndex]}x`;
    speedLabel.classList.remove("battle-step-active");
  },
  setLogFilter(ids: Set<string> | undefined): void {
    eventLogPanel.setAutoCamFilter(ids);
  },
};

const autoCamera = new AutoCameraController(autoCamHost);

function currentSeed(): number {
  return world.rngSeed;
}

/**
 * Every tracked-id/view reset shared by loading a fresh single-map world,
 * loading a fresh overworld, and switching overworld focus (demoting the
 * old region, promoting the new one) — in all three cases, `world` has just
 * been pointed at a brand new set of agent ids, so every UI tracker keyed
 * on the old ones (auto camera's engagements, the event log's buffer, the
 * battle screen's active engagement, the inspector's selection) is
 * meaningless and needs the same clean slate. Assumes `world`/`log` are
 * already set to their new values by the caller.
 */
function resetUiForNewWorld(): void {
  lastLoggedEventCount = 0;
  selectedAgentId = undefined;
  autoCamera.reset();

  canvas.width = world.width * TILE_SIZE;
  canvas.height = world.height * TILE_SIZE;
  // Setting canvas.width/height RESETS every context property, so this has to
  // be re-applied here rather than once at startup. Without it the context
  // keeps the browser default (smoothing ON) and every drawImage that resamples
  // — which is nearly all of them, since almost no tile art is exactly
  // TILE_SIZE — gets bilinear-filtered into the backing store. The CSS
  // `image-rendering: pixelated` then faithfully upscales an already-blurred
  // image, so the blur survives to the screen. macroMap.ts always did this;
  // the main canvas never did. Direct report: "Are the pixels getting super
  // ugly compressed when rendered? I think we are losing a lot of fidelity."
  ctx.imageSmoothingEnabled = false;
  applyZoom();

  eventLogPanel.reset();
  actionLogPanel.reset();
  eventLogPanel.setFilter(undefined);
  battleScreenPanel.reset();
  eventPopups.reset();
  moveEffects.reset();
  renderInspector(inspectorEl, undefined, world);
  tabManualOverrideForBattleSeq = undefined;
  lastAutoSwitchedBattleSeq = undefined;
  selectTab("inspector", false);
  updateStatusLabels();
}

/**
 * Registers every herd in a freshly-loaded world, before the first frame is
 * drawn.
 *
 * Herd records are created by `tickHerds`, which the engine runs once per
 * tick — so a world that has not been ticked yet has agents carrying
 * `herdId`s that no record exists for, and every UI that names a herd falls
 * back to the raw id. Normally invisible (it lasts one tick), but this app
 * boots PAUSED: the very first thing a viewer sees was the inspector listing
 * "spearow-zone-32,32" instead of "the Spearows of the Green Plain", and it
 * stayed that way until they pressed play. Caught by screenshotting the real
 * app rather than by any test — every test and the runner tick first.
 *
 * Calling the engine's own once-per-tick pass rather than reimplementing
 * registration here: it is idempotent (it returns the existing record for a
 * herd it has already seen), so this is exactly the state tick 1 would
 * produce, just one frame earlier.
 */
function registerHerdsForFirstFrame(): void {
  tickHerds(world, log);
}

/**
 * The mobile bottom sheet's three resting heights. Direct ask: "one sidebar
 * with my player status, and my party members at a glance. Then expandable",
 * and "Need it to be easier to navigate with buttons either easily
 * dismissable or off to the side so it doesn't make the ui obscured."
 *
 * Peek is deliberately tiny — four vitals bars and nothing else — so the map
 * owns the screen by default. `peek` matches `--sheet-peek` in index.html,
 * which the on-map control pad also positions itself above; change one and
 * change the other.
 */
const SHEET_DETENTS = { peek: 74, full: 0.85 } as const;
type SheetDetent = keyof typeof SHEET_DETENTS;
let sheetDetent: SheetDetent = "peek";

/** A detent's height in real pixels — the fractional ones are of the viewport. */
function sheetHeightPx(detent: SheetDetent): number {
  const value = SHEET_DETENTS[detent];
  return value > 1 ? value : Math.round(window.innerHeight * value);
}

function setSheetDetent(detent: SheetDetent): void {
  sheetDetent = detent;
  document.body.classList.toggle("sheet-peek", detent === "peek");
  document.body.classList.toggle("sheet-full", detent === "full");
  document.documentElement.style.setProperty("--sheet-h", `${sheetHeightPx(detent)}px`);
}

/**
 * Drag the grip to resize, or tap it to cycle. Both, because a tap is faster
 * when you know where you are going and a drag is better when you don't —
 * and on a phone the grip is the only part of the sheet always in reach.
 */
function initSheetDrag(): void {
  let startY = 0;
  let startH = 0;
  let dragging = false;
  let moved = false;

  sheetHandleEl.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    startY = event.clientY;
    startH = sidePanelEl.getBoundingClientRect().height;
    sheetHandleEl.setPointerCapture(event.pointerId);
    sidePanelEl.classList.add("sheet-dragging");
  });

  sheetHandleEl.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const delta = startY - event.clientY; // up is taller
    if (Math.abs(delta) > 4) moved = true;
    const height = Math.max(SHEET_DETENTS.peek, Math.min(window.innerHeight * 0.92, startH + delta));
    document.documentElement.style.setProperty("--sheet-h", `${Math.round(height)}px`);
    // Peek hides the tabs and sections, so it has to come off the moment the
    // sheet is dragged open — otherwise you drag up into blank space.
    document.body.classList.toggle("sheet-peek", height < sheetHeightPx("peek") + 40);
    document.body.classList.toggle("sheet-full", height >= sheetHeightPx("peek") + 40);
  });

  const release = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    sidePanelEl.classList.remove("sheet-dragging");
    if (sheetHandleEl.hasPointerCapture(event.pointerId)) sheetHandleEl.releasePointerCapture(event.pointerId);
    if (!moved) {
      // A tap toggles. Direct ask: "I think it should just be low to full and
      // the handle should be bigger or something to easily toggle." The middle
      // detent is gone — it was the state where the sheet covered the verb pad
      // without being big enough to be worth it.
      setSheetDetent(sheetDetent === "peek" ? "full" : "peek");
      return;
    }
    // Snap to whichever detent the finger ended up nearest.
    const height = sidePanelEl.getBoundingClientRect().height;
    let best: SheetDetent = "peek";
    for (const detent of ["peek", "full"] as SheetDetent[]) {
      if (Math.abs(sheetHeightPx(detent) - height) < Math.abs(sheetHeightPx(best) - height)) best = detent;
    }
    setSheetDetent(best);
  };
  sheetHandleEl.addEventListener("pointerup", release);
  sheetHandleEl.addEventListener("pointercancel", release);

  // A fractional detent is a fraction of a viewport that just changed.
  window.addEventListener("resize", () => {
    if (playerMode) setSheetDetent(sheetDetent);
  });
}
initSheetDrag();

const actionLogPanel = new ActionLogPanel(document.getElementById("action-log") as HTMLElement);

/**
 * Tell the player something, and keep it.
 *
 * Every line the player reads used to go straight to `hudMessageEl`, which is
 * one line that the next message overwrote — so the result of looking at a
 * creature or gathering a tile existed for exactly one action. Direct ask: "I
 * want one place to see like results of look, gather, like actions."
 *
 * Transient UI prompts ("Targeting … tap a tile") still write to
 * `hudMessageEl` directly, because they are a mode indicator rather than
 * something that happened.
 */
function say(text: string): void {
  hudMessageEl.textContent = text;
  actionLogPanel.say(world.tick, text);
}

const tileMenu = new TileMenu(mapAreaEl, (open) => {
  // Stop the map panning out from under an open radial — see TileMenu's own
  // constructor comment for why this is what made release work on touch.
  canvasWrap.classList.toggle("menu-open", open);
});
const tileTipEl = document.getElementById("tile-tip") as HTMLElement;

/**
 * A tile the radial already chose, waiting for the command menu to say which
 * move to use on it. Undefined during the ordinary verb-first flow, where the
 * move is picked first and the tile tapped afterwards.
 */
let pendingTargetTile: Vec2 | undefined;

/** Issuing an order is the player's own turn to spend, same as every other verb — `agentId` undefined means the player's own swing. */
function commitMove(agentId: string | undefined, moveId: string, target: Vec2): void {
  if (agentId === undefined) playerAct({ kind: "attack", dx: lastFacing.dx, dy: lastFacing.dy, moveId, target });
  else playerAct({ kind: "command", agentId, moveId, target });
}

const TERRAIN_WORDS: Partial<Record<string, string>> = {
  floor: "Bare floor",
  wall: "Solid wall",
  water: "Water",
  food: "Food growing",
  flora: "Plants",
  sunbeam: "A shaft of light",
  seedling: "A seedling",
  tree: "A tree",
  boulder: "A boulder",
  bush: "Thick bush",
  sand: "Sand",
  mud: "Mud",
  shelter: "Shelter",
  sludge: "Fouled ground",
  stone: "Rock outcrop",
  fire: "Fire",
  ice: "Ice",
  stairsDown: "Stairs down",
  stairsUp: "Stairs up",
  exit: "The way out",
};

/**
 * What a tile is, in the player's own voice. Direct ask: "seeing what items
 * are harvestabls, what kind of terrain and what effects standing on it does."
 *
 * Two sentences at most, per the house style — the first says what the ground
 * is and what it does to you, the second what you could take from it. Vague
 * words are a bug here: if there is nothing to say about a tile, say "Nothing
 * grows here", not "not much".
 */
function describeTile(report: TileReport): string {
  const name = TERRAIN_WORDS[report.terrain] ?? report.terrain;
  const effects: string[] = [];
  if (report.poisons) effects.push("it poisons what stands in it");
  if (report.conceals) effects.push("you are hidden here");
  if (!report.walkable) effects.push("you cannot pass");
  if (report.lit) effects.push("it is lit");
  const first = effects.length > 0 ? `${name} — ${effects.join(", ")}.` : `${name}.`;

  if (report.occupantId) {
    const who = world.agents.find((a) => a.id === report.occupantId);
    if (who) return `${first} ${SPECIES[who.species]?.name ?? who.species} stands here.`;
  }
  if (report.corpseId) {
    const body = world.agents.find((a) => a.id === report.corpseId);
    if (body) return `${first} A dead ${SPECIES[body.species]?.name ?? body.species} lies here.`;
  }
  if (report.harvestable.length > 0 && report.harvestsLeft > 0) {
    return `${first} ${report.harvestable.map((m: string) => itemName(m)).join(" and ")} here.`;
  }
  return `${first} Nothing to take.`;
}

/** Where a tile currently sits inside #map-area, accounting for zoom and the wrap's scroll. */
function tileScreenPos(tile: Vec2): { x: number; y: number } {
  const wrapRect = canvasWrap.getBoundingClientRect();
  const areaRect = mapAreaEl.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const scale = canvasRect.width / canvas.width;
  return {
    x: canvasRect.left - areaRect.left + (tile.x + 0.5) * TILE_SIZE * scale,
    y: canvasRect.top - areaRect.top + (tile.y + 0.5) * TILE_SIZE * scale,
  };
}

function runTileVerb(verb: TileVerb, tile: Vec2): void {
  const me = findPlayer(world);
  if (!me) return;
  switch (verb) {
    case "examine": {
      // Free: costs no turn, which is what makes looking before you commit a
      // real option rather than a tax on not already knowing.
      const report = examineTile(world, viewLayer(), tile);
      if (report) say(describeTile(report));
      return;
    }
    case "moveHere":
      travelTo(tile);
      return;
    case "gather":
      playerAct({ kind: "gather" });
      runActivity();
      return;
    case "drink":
      playerAct({ kind: "drink" });
      return;
    case "loot":
      playerAct({ kind: "loot" });
      return;
    case "butcher":
      playerAct({ kind: "butcher" });
      return;
    case "useStairs":
      tryUseStairs();
      return;
    case "attack":
    case "command":
      // Both need a move picked, and the command menu is where moves live —
      // but the tile is already decided, so it commits on the pick instead of
      // asking for a target again.
      pendingTargetTile = tile;
      openCommandMenu();
      return;
  }
}

/**
 * Verbs the radial does NOT give a wedge to, even though the rules allow them
 * here.
 *
 * - `examine` is the centre: a release without swiping already does it, so a
 *   wedge would be a second way to do the default.
 * - `gather` acts on the tile you are already standing on, not one you point
 *   at, so it belongs with wait and crouch as a button. Direct ask: "gather I
 *   think might need to be it's own button like crouch and wait."
 *
 * `verbsForTile` still reports both — the engine says what is legal, the UI
 * decides which surface offers it.
 */
const WEDGELESS_VERBS: ReadonlySet<TileVerb> = new Set<TileVerb>(["examine", "gather"]);

function openTileMenu(tile: Vec2): void {
  const me = findPlayer(world);
  if (!me || playerDead || playerWon) return;
  const verbs = verbsForTile(world, me, viewLayer(), tile);
  if (verbs.length === 0) return;
  const wedges = menuItemsFor(verbs.filter((v) => !WEDGELESS_VERBS.has(v)));
  const centre = menuItemsFor(["examine"])[0]!;
  tileMenu.open(tileScreenPos(tile), wedges, centre, (verb) => runTileVerb(verb, tile));
}

/**
 * Long-press opens the radial on touch; a drag opens nothing, because a drag
 * is how you pan the map. `LONG_PRESS_MS` is the usual ~400ms: shorter and an
 * ordinary tap-to-walk starts triggering menus.
 */
const LONG_PRESS_MS = 400;
const DRAG_SLOP = 10;
let pressTimer: number | undefined;
let pressStart: { x: number; y: number } | undefined;
/** A long-press ends with a click event the browser still delivers; without this it would also walk the player to the tile. */
let suppressNextClick = false;

function cancelPress(): void {
  if (pressTimer !== undefined) window.clearTimeout(pressTimer);
  pressTimer = undefined;
  pressStart = undefined;
}

canvas.addEventListener("pointerdown", (event) => {
  if (!playerMode || event.button !== 0) return;
  if (tileMenu.isOpen) return;
  pressStart = { x: event.clientX, y: event.clientY };
  const tile = tileAtPointer(event);
  const pointerId = event.pointerId;
  pressTimer = window.setTimeout(() => {
    pressTimer = undefined;
    suppressNextClick = true;
    openTileMenu(tile);
    // Capture, or the drag half of press-drag-release simply does not work:
    // the radial's wedges sit above the canvas, so once the menu is open every
    // pointermove lands on a wedge and never reaches the canvas listener that
    // arms them. Measured — the wedge never armed and the hub never changed
    // until this was added. Released on pointerup below.
    try {
      canvas.setPointerCapture(pointerId);
    } catch {
      /* the pointer may already be gone; the click-a-wedge path still works */
    }
  }, LONG_PRESS_MS);
});

canvas.addEventListener("pointermove", (event) => {
  if (tileMenu.isOpen) {
    tileMenu.track({ x: event.clientX, y: event.clientY });
    return;
  }
  if (!pressStart) return;
  // Moved far enough to be a pan, not a press.
  if (Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > DRAG_SLOP) cancelPress();
});

// On the window, not the canvas: a drag that ends outside the canvas still has
// to resolve the menu rather than leaving it stuck open.
window.addEventListener("pointerup", (event) => {
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (tileMenu.isOpen) {
    // Only a genuine drag-release commits. A press-and-release in place leaves
    // the menu up so the wedges can be tapped one at a time instead.
    if (tileMenu.release()) suppressNextClick = true;
  }
  cancelPress();
});

// Desktop: right-click is the same menu, no press delay.
window.addEventListener("pointercancel", (event) => {
  if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  // Do not commit on a cancel: the player did not choose to let go, the
  // browser took the gesture away.
  tileMenu.close();
  cancelPress();
});

canvas.addEventListener("contextmenu", (event) => {
  if (!playerMode) return;
  event.preventDefault();
  openTileMenu(tileAtPointer(event));
});

// Clicking anywhere else dismisses an open radial, the way every other menu
// in this app behaves.
mapAreaEl.addEventListener("pointerdown", (event) => {
  if (tileMenu.isOpen && !(event.target as HTMLElement).closest("#tile-menu")) tileMenu.close();
});

/**
 * Desktop hover: examine for free. Direct ask: "hover and right click on
 * desktop to do stuff." Knowing what a tile is should not cost a turn or even
 * a click — this is the "informed decisions" pillar made ambient.
 */
canvas.addEventListener("mousemove", (event) => {
  if (!playerMode || tileMenu.isOpen || targeting) {
    tileTipEl.hidden = true;
    return;
  }
  const tile = tileAtPointer(event);
  const report = examineTile(world, viewLayer(), tile);
  if (!report) {
    tileTipEl.hidden = true;
    return;
  }
  tileTipEl.textContent = describeTile(report);
  const areaRect = mapAreaEl.getBoundingClientRect();
  tileTipEl.style.left = `${event.clientX - areaRect.left + 14}px`;
  tileTipEl.style.top = `${event.clientY - areaRect.top + 14}px`;
  tileTipEl.hidden = false;
});
canvas.addEventListener("mouseleave", () => {
  tileTipEl.hidden = true;
});

headerToggleBtn.addEventListener("click", () => {
  const open = !document.body.classList.contains("header-open");
  document.body.classList.toggle("header-open", open);
  headerToggleBtn.setAttribute("aria-expanded", String(open));
});

/**
 * The last three things that happened to you, in the space the spectator
 * header used to take. Direct ask: "Maybe in its place you show the last three
 * events that happened to you and your party. With the most recent fully
 * opacity and the least recent 50%."
 *
 * Reads the same `actionLogPanel` the You panel does rather than keeping its
 * own copy, so the two can never disagree about what just happened.
 */
let tickerSignature = "";

function renderEventTicker(): void {
  if (!playerMode) {
    eventTickerEl.hidden = true;
    return;
  }
  const recent = actionLogPanel.snapshot().slice(-3).reverse(); // newest first
  // Rebuilding three rows every frame is wasteful; only touch the DOM when the
  // text actually changed.
  const signature = recent.map((e) => `${e.tick}:${e.count}:${e.text}`).join("|");
  if (signature === tickerSignature) return;
  tickerSignature = signature;

  eventTickerEl.replaceChildren();
  eventTickerEl.hidden = recent.length === 0;
  recent.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = `ticker-row${entry.kind === "you" ? " you" : ""}`;
    // Newest solid, oldest at half — exactly as asked.
    row.style.opacity = String([1, 0.75, 0.5][i] ?? 0.5);
    row.textContent = entry.count > 1 ? `${entry.text} \u00d7${entry.count}` : entry.text;
    eventTickerEl.appendChild(row);
  });
}

/**
 * Autosave cadence. Long enough that holding a movement key doesn't compress
 * and write the whole world on every step, short enough that what you lose to
 * a crash is a second of play rather than an hour of it. A pending save is
 * never queued twice — the timer already covers everything that happened
 * before it fires.
 */
const SAVE_DEBOUNCE_MS = 1200;
let saveTimer: number | undefined;

function saveNow(): void {
  if (!playerMode || playerDead || playerWon) return;
  // KNOWN GAP, deliberately not silent: once the player graduates out of the
  // cave, `world` is one zone of a macro grid held in `macroWorld`, and the
  // grid is not part of the payload. Saving the zone alone would restore a
  // world with no grid behind it — zone crossings would break — so the
  // overworld simply isn't autosaved yet rather than being saved wrongly.
  if (macroWorld) return;
  const player = findPlayer(world);
  if (!player) return;
  void saveRun(world, log, { seed: playerSeed, scenario: playerScene === "cave" ? "cave" : "surface", playerId: player.id }, actionLogPanel.snapshot());
}

function scheduleSave(): void {
  if (!playerMode || playerDead || playerWon) return;
  if (saveTimer !== undefined) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    saveNow();
  }, SAVE_DEBOUNCE_MS);
}

/**
 * A backgrounded tab can be evicted without ever getting another timer tick,
 * which on iOS is a routine way to lose a run rather than an edge case — so
 * flush any pending save the moment the page stops being visible. `pagehide`
 * covers the same ground for a real navigation away; `beforeunload` is
 * deliberately not used, since it is unreliable on mobile precisely where
 * this matters most.
 */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveNow();
});
window.addEventListener("pagehide", () => saveNow());

function loadWorld(seed: number): void {
  macroWorld = undefined;
  world = createDemoWorld(seed);
  log = new EventLog();
  registerHerdsForFirstFrame();
  resetUiForNewWorld();

  seedInput.value = String(seed);
  seedChipLabel.textContent = String(seed);
  const url = new URL(location.href);
  url.searchParams.set("seed", String(seed));
  history.replaceState(null, "", url);
}

/**
 * ROADMAP.md M0 — the plain demo world plus a player-controlled human, with
 * the free-running clock replaced by "advance when the player acts." The
 * macro grid is deliberately off here: M0 proves the turn gate against a
 * world already known to be alive, and one new thing at a time is the point.
 */
function loadPlayerWorld(seed: number, scene: "surface" | "cave" = "surface", restored?: RestoredRun): void {
  macroWorld = undefined;
  playerMode = true;
  setPlaying(false);
  // Same "leaving Overworld mode" dance as the manual toggle below: the
  // macro map has no meaning in player mode, and left visible it sat as an
  // empty panel over the top half of the map, squeezing the cave into the
  // bottom (seen live in the M1 screenshot). `.force-hide`, not `hidden`:
  // the wrap's own `display: flex` defeats the attribute (see index.html's
  // `.force-hide` comment). M1 set `hidden` and measured `hidden === true`,
  // which was true and hid nothing — the M2 screenshot still had the panel.
  macroMapWrapEl.hidden = true;
  macroMapWrapEl.classList.add("force-hide");
  mapModeSwitchEl.hidden = true;
  minimapWidgetEl.hidden = true;
  overworldToggleBtn.textContent = "Overworld: Off";
  overworldToggleBtn.classList.remove("playing");
  canvasWrap.classList.remove("force-hide");
  // ROADMAP.md M1: the cave is the game; the surface world is M0's proving
  // ground for the turn gate and stays reachable for comparison.
  // A restored run brings its own world and its own history; generating a
  // fresh one here and then discarding it would burn a full cave-run worth
  // of worldgen on every reload.
  world = restored ? restored.world : scene === "cave" ? createCaveRun(seed) : createPlayerDemoWorld(seed);
  playerScene = scene;
  playerSeed = seed;
  playerDead = false;
  playerWon = false;
  log = restored ? restored.log : new EventLog();
  registerHerdsForFirstFrame();
  resetUiForNewWorld();
  seedInput.value = String(seed);
  seedChipLabel.textContent = String(seed);
  const player = findPlayer(world);
  if (player) {
    eventLogPanel.setPlayerId(player.id);
    selectAgent(player);
    focusCameraOn(player.pos);
  }
  gameOverEl.hidden = true;
  runWonEl.hidden = true;
  playerHudEl.hidden = false;
  packMenuEl.hidden = true;
  document.body.classList.add("player-mode");
  // Your own state is what the panel is for in play mode, so it opens on You
  // with the spectator tabs folded away. resetUiForNewWorld above selected
  // Inspector, which is the right default for Watch mode and the wrong one
  // here.
  document.body.classList.remove("world-tabs-open");
  if (restored) actionLogPanel.restore(restored.actionLog);
  selectTab("you", false);
  setSheetDetent(sheetDetent);
  cancelTravel();
  hudMessageEl.textContent = restored
    ? "Your run continues."
    : scene === "cave"
      ? "It is dark. There is light somewhere. Tap a tile to walk."
      : "";
  renderPlayerHud();
  syncModeButtons();
  const url = new URL(location.href);
  url.searchParams.set("player", scene === "cave" ? "cave" : "1");
  url.searchParams.set("seed", String(seed));
  history.replaceState(null, "", url);
}

/**
 * Back to the spectator app — direct ask: "a mode to just look at the full
 * Sim, too... Separate from player mode." Everything player mode put up
 * (HUD, death screen, the held turn gate) comes down; the world is the
 * ordinary demo macro world with nothing hidden, since fog only exists
 * where there is a player to see from.
 */
function enterWatchMode(seed: number): void {
  cancelTravel();
  playerMode = false;
  playerDead = false;
  playerWon = false;
  playerHudEl.hidden = true;
  gameOverEl.hidden = true;
  runWonEl.hidden = true;
  document.body.classList.remove("player-mode");
  document.body.classList.remove("world-tabs-open");
  document.body.classList.remove("header-open");
  headerToggleBtn.setAttribute("aria-expanded", "false");
  eventTickerEl.hidden = true;
  // The You page has no meaning without a player; Watch mode's own default.
  if (activeTab === "you") selectTab("inspector", false);
  enterOverworldMode(seed, "zone");
  syncModeButtons();
  const url = new URL(location.href);
  url.searchParams.delete("player");
  history.replaceState(null, "", url);
}

function syncModeButtons(): void {
  modeWatchBtn.classList.toggle("playing", !playerMode);
  modePlayBtn.classList.toggle("playing", playerMode);
}

modeWatchBtn.addEventListener("click", () => {
  if (!playerMode) return;
  enterWatchMode(Number(seedInput.value) || SCENARIO_SEED);
});
modePlayBtn.addEventListener("click", () => {
  if (playerMode) return;
  setPlaying(false);
  loadPlayerWorld(Number(seedInput.value) || SCENARIO_SEED, "cave");
});

/**
 * ROADMAP.md M3: needs on screen, always. The inspector renders the same
 * bars for whichever agent is selected; this one is the player's and does
 * not go away when you click a Sandshrew.
 */
function renderPlayerHud(): void {
  const player = findPlayer(world);
  if (!player) return;
  const bar = (id: string, value: number, text: string) => {
    const fill = document.getElementById(`hud-${id}`) as HTMLElement;
    const num = document.getElementById(`hud-${id}-text`) as HTMLElement;
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
    fill.classList.toggle("low", value < 0.25);
    num.textContent = text;
  };
  const maxHp = player.maxHp ?? 1;
  const hp = player.hp ?? maxHp;
  bar("hp", hp / maxHp, `${Math.round(hp)}/${maxHp}`);
  bar("hunger", player.needs.hunger, `${Math.round(player.needs.hunger * 100)}%`);
  bar("thirst", player.needs.thirst, `${Math.round(player.needs.thirst * 100)}%`);
  bar("energy", player.needs.energy, `${Math.round(player.needs.energy * 100)}%`);
  // Who you are, at the top of your own panel. The row under it is depth,
  // which reads as "Level 1 of 5" and is emphatically not your level.
  const speciesName = SPECIES[player.species]?.name ?? player.species;
  youTitleEl.textContent = player.level ? `${speciesName} · Lv ${player.level}` : speciesName;
  const outcome = player.lastActionOutcome;
  if (outcome && outcome.tick === world.tick) {
    // A multi-turn gather or craft reports "you start…" then a progress tick
    // per turn then the result. All of that belongs on the HUD line, which is
    // live status — but logging it turned a single gather into four rows
    // ("You start gathering berries." / "Gathering… 2 turns left." /
    // "Gathering… 1 turn left." / "You gather berries."), which is a table
    // with commas rather than a history. Only the outcome is kept.
    // `outcome.ok` matters: a gather that FAILED ("Nothing to gather here.")
    // is a real result and belongs in the log — only a gather that actually
    // started an activity is progress. Dropping that check swallowed every
    // failed gather, which a live check caught.
    const midActivity =
      outcome.ok && (outcome.action.kind === "gather" || outcome.action.kind === "craft" || (outcome.action.kind === "continue" && !outcome.completed));
    if (midActivity) hudMessageEl.textContent = outcomeText(player, outcome);
    else say(outcomeText(player, outcome));
  }
  renderPack(player);
  // ROADMAP.md M7: mechanics visible on the map, not hidden in a meter — the
  // player should always know how deep they are, same reasoning as the HP bar.
  // "Depth", not "Level": it sits directly under the player's own "Lv N" line
  // in the You panel, and two adjacent rows both reading "Level … 5" meant
  // two different fives.
  hudDepthEl.textContent = world.depth ? `Depth ${world.depth} of ${CAVE_RUN_DEPTH}` : "";
}

/** The pack line under the bars: "Pack 4/28 · Lichen ×2 · Deadwood ×1 · Torch (held)". */
function renderPack(player: Agent): void {
  const items = (player.inventory ?? []).map((i) => {
    const held = player.equipment?.held === i.itemKey;
    const fuel = held && world.items?.[i.itemKey]?.light && player.torchFuel !== undefined ? ` ${Math.round((100 * player.torchFuel) / TORCH_FUEL_TICKS)}%` : "";
    const slot = held ? ` (held${fuel})` : player.equipment?.worn === i.itemKey ? " (worn)" : "";
    return `${itemName(i.itemKey)}${i.count > 1 ? ` ×${i.count}` : ""}${slot}`;
  });
  hudPackEl.textContent = `${player.posture === "crouch" ? "Crouched · " : ""}Pack ${carriedWeight(player)}/${carryCapacityOf(world, player)}${items.length ? " · " + items.join(" · ") : " · empty"}`;
  if (player.lastNotice) {
    if (player.lastNotice.kind === "torchBurnedOut") say("Your torch burns out.");
    player.lastNotice = undefined;
  }
}

/** Plain sentences for what the last key did. If the verb failed, say what was missing. */
function outcomeText(player: Agent, outcome: PlayerActionOutcome): string {
  const { action, ok } = outcome;
  const here = harvestableAt(world, player.layer, player.pos);
  switch (action.kind) {
    case "move":
      return ok ? "" : "Something is in the way.";
    case "wait":
      return "You wait.";
    case "eat":
      return ok ? "You eat." : "Nothing to eat. Stand on a berry patch, or gather some first.";
    case "drink":
      return ok ? "You drink." : "No water within reach.";
    case "gather":
      if (ok) return `You start gathering ${here.map(itemName).join(" and ").toLowerCase()}.`;
      if (here.length === 0) return "Nothing to gather here.";
      if (harvestLeft(world, player.layer, player.pos) <= 0) return "This spot is picked clean.";
      return "Your pack is full.";
    case "craft":
      return ok ? `You start making ${itemName(action.recipeId).toLowerCase()}.` : "You cannot make that.";
    case "continue": {
      if (outcome.completed === "gather") return outcome.gathered?.length ? `You gather ${outcome.gathered.map((g) => itemName(g.itemKey).toLowerCase()).join(" and ")}.` : "Your pack is full.";
      if (outcome.completed === "craft") return `You make ${itemName(outcome.crafted ?? "").toLowerCase()}.`;
      const act = player.activity;
      return act ? `${act.kind === "gather" ? "Gathering" : "Making"}… ${act.turnsLeft} turn${act.turnsLeft === 1 ? "" : "s"} left.` : "";
    }
    case "cancel":
      return "You stop.";
    case "equip": {
      const def = world.items?.[action.itemKey];
      return ok ? (def?.slot === "worn" ? `You put on the ${itemName(action.itemKey).toLowerCase()}.` : `You hold the ${itemName(action.itemKey).toLowerCase()}.`) : "You cannot equip that.";
    }
    case "stow":
      return ok ? "You put it away." : "Your hands are empty.";
    case "crouch":
      return ok ? "You crouch. You move slowly and read as less of a threat." : "You stand up.";
    case "offer":
      if (ok) return "You set a berry down beside you.";
      return FOOD_MATERIAL_IDS.some((id) => countOf(player, id) > 0) ? "No free ground beside you." : "You have no food. Gather some from a patch.";
    case "attack": {
      if (!ok) return "Nothing there to hit.";
      if (outcome.attackedId) {
        const target = world.agents.find((a) => a.id === outcome.attackedId);
        return `You strike ${target ? (SPECIES[target.species]?.name ?? target.species) : "it"}!`;
      }
      if (outcome.felled) {
        return outcome.felled.yields ? `You fell it, and gather ${itemName(outcome.felled.yields).toLowerCase()}.` : "You clear it away.";
      }
      return "";
    }
    case "command": {
      const partner = world.agents.find((a) => a.id === action.agentId);
      const name = partner ? (SPECIES[partner.species]?.name ?? partner.species) : "it";
      return ok ? `You signal ${name}.` : `${name} won't take that order.`;
    }
    case "setStandingOrder": {
      const partner = world.agents.find((a) => a.id === action.agentId);
      const name = partner ? (SPECIES[partner.species]?.name ?? partner.species) : "it";
      if (!ok) return `${name} won't take that order.`;
      return action.order === "follow" ? `${name} goes back to following you.` : `${name} is now on ${action.order}.`;
    }
    case "drop":
      return ok ? `You drop the ${itemName(action.itemKey).toLowerCase()}.` : "You don't have that.";
    case "placeCampfire": {
      if (ok) return "You set down a campfire.";
      if (countOf(player, "campfire") < 1) return "You don't have a campfire to place.";
      return "Nowhere to put it there.";
    }
    case "loot":
      return ok ? "You loot the body." : "Nothing nearby to loot.";
    case "butcher": {
      if (!ok) return player.equipment?.held === "flintKnife" ? "Nothing nearby left to butcher." : "Nothing nearby to butcher — a knife would get you more.";
      const parts = outcome.butchered?.map((b) => `${itemName(b.itemKey).toLowerCase()}${b.count > 1 ? ` ×${b.count}` : ""}`) ?? [];
      return `You butcher it: ${parts.join(", ")}.`;
    }
    case "usePoultice": {
      if (!ok) return countOf(player, "poultice") < 1 ? "You don't have a poultice." : "Nobody hurt nearby.";
      const healed = outcome.healed;
      const who = healed?.targetId === player.id ? "yourself" : (SPECIES[world.agents.find((a) => a.id === healed?.targetId)?.species ?? ""]?.name ?? "it");
      return `You apply the poultice to ${who}, healing ${Math.round(healed?.amount ?? 0)} HP.`;
    }
  }
}

/**
 * Gather and craft are time-spends: one action starts them, and this loop
 * spends the following turns automatically, paced like tap-to-walk and
 * stopped by the same rule — something new in view ends it, turns lost,
 * materials kept (CRAFTING_LOOP.md). Any key or tap also stops it.
 */
function runActivity(): void {
  cancelTravel();
  const me = findPlayer(world);
  if (!me?.activity) return;
  let seenBefore = visibleAgentIds(world, me);
  const step = (): void => {
    travelTimer = undefined;
    const player = findPlayer(world);
    if (!player?.activity) return;
    playerAct({ kind: "continue" });
    const after = findPlayer(world);
    if (!after?.activity) return;
    const seenNow = visibleAgentIds(world, after);
    for (const id of seenNow) {
      if (!seenBefore.has(id)) {
        const who = world.agents.find((a) => a.id === id);
        playerAct({ kind: "cancel" });
        say(who ? `You stop. ${examine(world, who, { observer: after, name: (k) => SPECIES[k]?.name ?? k })}` : "You stop.");
        return;
      }
    }
    seenBefore = seenNow;
    travelTimer = window.setTimeout(step, TRAVEL_STEP_MS);
  };
  travelTimer = window.setTimeout(step, TRAVEL_STEP_MS);
}

/**
 * Direct ask: "itd be nice if it was easy to use keyboard to select
 * inventory items and use them as expected, comman[d] pokemon, select
 * attacks easily, etc." Numbers the first 9 primary rows of a just-built
 * pack/command menu (recipes to make, moves to use, standing orders,
 * partner sections) in DOM order — `activateNumberedMenuRow` below,
 * wired into the keydown handler wherever one of these menus is open,
 * fires the same row a click would. Deliberately scoped to
 * `.pack-row.tappable` only, not the smaller per-item `.pack-action-btn`
 * row (Eat/Offer/Hold/Wear/Drop/Place): those are few (1-3 per item) and
 * already sit right next to the item they act on, while the rows this
 * numbers are the longer lists (every known recipe, every move, every
 * standing order) that are genuinely tedious to reach by mouse/tap alone.
 */
function numberMenuRows(container: HTMLElement): void {
  const rows = Array.from(container.querySelectorAll<HTMLButtonElement>("button.pack-row.tappable"));
  rows.slice(0, 9).forEach((btn, i) => {
    const badge = document.createElement("span");
    badge.className = "menu-key-badge";
    badge.textContent = String(i + 1);
    btn.prepend(badge);
  });
}

/** Fires the Nth numbered row in `container` (1-based, matching `numberMenuRows`'s own badges) — a no-op, not an error, past 9 or with nothing there. Returns whether a row actually fired, so callers know whether to fall through to anything else the key might mean. */
function activateNumberedMenuRow(container: HTMLElement, key: string): boolean {
  const n = Number(key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return false;
  const rows = container.querySelectorAll<HTMLButtonElement>("button.pack-row.tappable");
  const btn = rows[n - 1];
  if (!btn) return false;
  btn.click();
  return true;
}

/**
 * The pack menu: what you carry (tap a holdable thing to hold or wear it)
 * and what you can make. Known recipes only; a known recipe you lack the
 * inputs for stays listed with what is missing — "that's the shopping list
 * that drives exploration" (CRAFTING_LOOP.md).
 */
function openPackMenu(): void {
  const me = findPlayer(world);
  if (!me) return;
  cancelTravel();
  packMenuBodyEl.replaceChildren();
  const h = (text: string) => {
    const el = document.createElement("div");
    el.className = "pack-heading";
    el.textContent = text;
    return el;
  };
  const rowEl = (text: string, sub?: string, onTap?: () => void) => {
    const el = document.createElement(onTap ? "button" : "div");
    el.className = "pack-row" + (onTap ? " tappable" : "");
    el.textContent = text;
    if (sub) {
      const s = document.createElement("span");
      s.className = "pack-sub";
      s.textContent = sub;
      el.appendChild(s);
    }
    if (onTap) el.addEventListener("click", () => { closePackMenu(); onTap(); });
    return el;
  };
  // Direct ask: "We're getting too many buttons... let's make offer and eat
  // only available from inventory after you gather" — a row with its own
  // small action buttons, rather than a single whole-row tap, for the one
  // item (food) that has more than one thing you'd do with it.
  const actionsRowEl = (text: string, actions: { label: string; onTap: () => void }[]) => {
    const el = document.createElement("div");
    el.className = "pack-row pack-row-actions";
    const labelEl = document.createElement("span");
    labelEl.textContent = text;
    el.appendChild(labelEl);
    for (const a of actions) {
      const btn = document.createElement("button");
      btn.className = "pack-action-btn";
      btn.textContent = a.label;
      btn.addEventListener("click", () => { closePackMenu(); a.onTap(); });
      el.appendChild(btn);
    }
    return el;
  };
  packMenuBodyEl.appendChild(h(`Carrying · ${carriedWeight(me)}/${carryCapacityOf(world, me)}`));
  if (!me.inventory?.length) packMenuBodyEl.appendChild(rowEl("Nothing yet. Stand on lichen or deadwood and gather."));
  // Direct report: "can't drop items." Every row gets a real Drop action
  // now, alongside whatever else it does — the same actions-row pattern
  // "food" already used for Eat/Offer, extended to every item instead of
  // one row keeping the single-whole-row-tap shape and the rest not.
  for (const item of me.inventory ?? []) {
    const def = world.items?.[item.itemKey];
    const held = me.equipment?.held === item.itemKey;
    const worn = me.equipment?.worn === item.itemKey;
    const state = held ? " (in hand)" : worn ? " (worn)" : "";
    const label = `${itemName(item.itemKey)}${item.count > 1 ? ` ×${item.count}` : ""}${state}`;
    const actions: { label: string; onTap: () => void }[] = [];
    // Direct report: "we need distinct crop... add to inventory as its own
    // thing" — gathering now hands back the specific crop (Potato, Apple,
    // ...), not just the old generic "food" — `FOOD_MATERIAL_IDS` (not a
    // bare `itemKey === "food"` check) is what still recognizes any of
    // them as "a berry in the pack" for Eat/Offer. A cooked dish (e.g.
    // Roasted Apple) isn't in that material list at all — it's an
    // `ItemDef` with a `cooked` marker — so it needs its own check here too,
    // mirroring the engine's own `isFoodItem` (player.ts).
    if ((FOOD_MATERIAL_IDS as readonly string[]).includes(item.itemKey) || world.items?.[item.itemKey]?.cooked !== undefined) {
      // Names the specific stack this row is for — with more than one kind
      // of food in the pack now (distinct crop items), a bare `{kind:
      // "eat"}` would silently eat whichever material happens to sort
      // first, not necessarily the one this row's button was tapped on.
      actions.push({ label: "Eat", onTap: () => playerAct({ kind: "eat", itemKey: item.itemKey }) });
      actions.push({ label: "Offer", onTap: () => playerAct({ kind: "offer", itemKey: item.itemKey }) });
    } else if (def?.slot === "held") {
      actions.push({ label: held ? "Put away" : "Hold", onTap: () => playerAct(held ? { kind: "stow" } : { kind: "equip", itemKey: item.itemKey }) });
    } else if (def?.slot === "worn" && !worn) {
      actions.push({ label: "Wear", onTap: () => playerAct({ kind: "equip", itemKey: item.itemKey }) });
    } else if (item.itemKey === "campfire") {
      // Direct ask: "get rid of fire building as a direct action - make it
      // a crafting thing that sets down a campfire" — placing one is a
      // per-item pack action now, same as Offer, not a raw always-there
      // key (this exact codebase already moved Eat/Offer the same way,
      // on the same "too many buttons" reasoning).
      actions.push({ label: "Place", onTap: () => playerAct({ kind: "placeCampfire", dx: lastFacing.dx, dy: lastFacing.dy }) });
    } else if (item.itemKey === "poultice") {
      // Direct report: "I can't apply poultice to heal units" — it had no
      // action at all before this (fell through to just Drop). Same
      // per-item pack action pattern as Eat/Offer/Place.
      actions.push({ label: "Apply", onTap: () => playerAct({ kind: "usePoultice" }) });
    }
    actions.push({ label: "Drop", onTap: () => playerAct({ kind: "drop", itemKey: item.itemKey }) });
    packMenuBodyEl.appendChild(actionsRowEl(label, actions));
  }
  packMenuBodyEl.appendChild(h("Make"));
  const known = (me.knownRecipes ?? []).map((id) => world.recipes?.[id]).filter((r): r is NonNullable<typeof r> => !!r);
  if (known.length === 0) packMenuBodyEl.appendChild(rowEl("You know no recipes."));
  for (const r of known) {
    const missing = r.inputs.filter((i) => countOf(me, i.itemKey) < i.count).map((i) => `${itemName(i.itemKey).toLowerCase()}${i.count > 1 ? ` ×${i.count}` : ""}`);
    const inputs = r.inputs.map((i) => `${itemName(i.itemKey).toLowerCase()}${i.count > 1 ? ` ×${i.count}` : ""}`).join(" + ");
    // Direct ask: "while near you can craft with combos of crops and
    // berries" — a cooking recipe also needs a real deployed fire nearby;
    // says so in the same "here's what's missing" style as ingredients.
    const needsFire = r.requiresNearFire && !nearFire(world, me);
    if (missing.length === 0 && !needsFire) packMenuBodyEl.appendChild(rowEl(`${r.name}`, `${inputs} · ${r.turns} turns · tap to make`, () => { playerAct({ kind: "craft", recipeId: r.id }); runActivity(); }));
    else if (missing.length === 0 && needsFire) packMenuBodyEl.appendChild(rowEl(`${r.name}`, `${inputs} · needs a fire nearby`));
    else packMenuBodyEl.appendChild(rowEl(`${r.name}`, `${inputs} · you have no ${missing.join(", ")}`));
  }
  numberMenuRows(packMenuBodyEl);
  packMenuEl.hidden = false;
}

function closePackMenu(): void {
  packMenuEl.hidden = true;
}
packMenuCloseBtn.addEventListener("click", closePackMenu);

/** Bonded followers (ROADMAP M6's follower door) standing in the player's own zone right now — the pool the command menu offers. */
function bondedPartnersInZone(me: Agent): Agent[] {
  return world.agents.filter((a) => a.followingId === me.id && a.alive !== false && a.layer === me.layer);
}

/**
 * Every bonded follower's HP, order and current behaviour, rendered into the
 * You panel. Direct ask: "I want one sidebar with my player status, and my
 * party members at a glance."
 *
 * This used to be a floating panel over the map with its own pin/dismiss
 * state and a HUD button to bring it back. All of that is gone: it lives in
 * the sidebar now, so there is nothing to dismiss it from and nothing to
 * restore. Two overlapping floating panels was the thing being complained
 * about.
 *
 * Rebuilds every frame (`EventLogPanel`'s own shape) rather than keeping
 * persistent per-agent rows — a handful of rows read once a frame is cheap,
 * and the smooth HP-transition polish the other pattern buys is not what
 * this ask is about.
 */
function renderPartySection(): void {
  const me = findPlayer(world);
  const followers = me ? bondedPartnersInZone(me) : [];
  partyCountEl.textContent = followers.length ? `(${followers.length})` : "";
  partyBodyEl.replaceChildren();
  if (followers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "you-empty";
    empty.textContent = "No one follows you yet.";
    partyBodyEl.appendChild(empty);
    return;
  }
  for (const a of followers) {
    const name = SPECIES[a.species]?.name ?? a.species;
    const maxHp = a.maxHp ?? 1;
    const hp = a.hp ?? maxHp;
    const fraction = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
    const row = document.createElement("div");
    row.className = "herd-status-row";
    const nameRow = document.createElement("div");
    nameRow.className = "herd-status-name";
    const nameSpan = document.createElement("span");
    // Direct ask: "a command button that allows you to set behaviors for
    // each of your allies" — the order is worth seeing at a glance here
    // too, not just in the command menu that set it.
    const orderLabel = a.standingOrder ? ` · ${a.standingOrder[0]!.toUpperCase()}${a.standingOrder.slice(1)}` : "";
    nameSpan.textContent = `${name}${orderLabel}`;
    const statusSpan = document.createElement("span");
    statusSpan.className = "herd-status-status";
    statusSpan.textContent = a.fainted ? "fainted" : describeBehavior(world, a, { name: (k) => SPECIES[k]?.name ?? k });
    nameRow.append(nameSpan, statusSpan);
    const bar = document.createElement("span");
    bar.className = "herd-status-bar";
    const fill = document.createElement("span");
    fill.className = `herd-status-fill${a.fainted ? " fainted" : fraction < 0.25 ? " low" : ""}`;
    fill.style.width = `${Math.round(fraction * 100)}%`;
    bar.appendChild(fill);
    row.append(nameRow, bar);
    partyBodyEl.appendChild(row);
  }
}

/**
 * Direct asks: "under the attack option a sub menu show up to select your
 * bonded pokemon if its within the same zone as you, and you can select a
 * move and target a space with it - it then uses its own pathfinding to get
 * to the right position and use it" and the follow-up, "Attack should move
 * list should work when you have a weapon, or tackle if you don't. The
 * player has moves too, even if it's just tackle." Attack always opens
 * this now: a "You" section lists the player's own real moves
 * (bare-handed Tackle, plus whatever a held item grants — `Agent.moves`,
 * kept in sync by `syncPlayerMoves`); a bonded-follower section per
 * partner in zone, same as before. Direct follow-up ask: "change attack
 * for player moves to also be targeted, like allies moves" — tapping
 * either section's move now enters the same tap-a-tile `targeting` mode
 * (`agentId: undefined` for the player's own), rather than the player's
 * own swing instant-firing in `lastFacing`'s direction the moment it's
 * picked.
 */
function openCommandMenu(): void {
  const me = findPlayer(world);
  if (!me) return;
  cancelTravel();
  targeting = undefined;
  commandMenuBodyEl.replaceChildren();
  const row = (text: string, sub: string | undefined, onTap: () => void) => {
    const el = document.createElement("button");
    el.className = "pack-row tappable";
    el.textContent = text;
    if (sub) {
      const s = document.createElement("span");
      s.className = "pack-sub";
      s.textContent = sub;
      el.appendChild(s);
    }
    el.addEventListener("click", onTap);
    return el;
  };
  const heading = (text: string) => {
    const el = document.createElement("div");
    el.className = "pack-heading";
    el.textContent = text;
    return el;
  };
  commandMenuBodyEl.appendChild(heading("You"));
  const myMoves = me.moves ?? [];
  if (myMoves.length === 0) commandMenuBodyEl.appendChild(row("No moves.", undefined, () => {}));
  for (const move of myMoves) {
    const onCooldown = (me.moveCooldowns?.[move.id] ?? 0) > 0;
    commandMenuBodyEl.appendChild(
      row(move.name, onCooldown ? "on cooldown" : "tap, then tap a tile to target it", () => {
        if (onCooldown) return;
        closeCommandMenu();
        // The radial already asked "what do you want to do to THIS tile", so
        // there is nothing left to target — go straight to the swing rather
        // than asking for a tile the player just picked.
        if (pendingTargetTile) {
          const target = pendingTargetTile;
          pendingTargetTile = undefined;
          commitMove(undefined, move.id, target);
          return;
        }
        targeting = { moveId: move.id };
        hudMessageEl.textContent = `Targeting with ${move.name} — tap a tile. Esc to cancel.`;
      })
    );
  }
  for (const partner of bondedPartnersInZone(me)) {
    const name = SPECIES[partner.species]?.name ?? partner.species;
    commandMenuBodyEl.appendChild(heading(name));
    // Direct ask: "a command button that allows you to set behaviors for
    // each of your allies; patrol, hunt, defend, etc." Instant, unlike the
    // move rows below — no tile to tap, the order just takes effect.
    const currentOrder = partner.standingOrder ?? "follow";
    const orders: { order: "follow" | "patrol" | "hunt" | "defend"; label: string; sub: string }[] = [
      { order: "follow", label: "Follow", sub: "stays close, doesn't engage on its own" },
      { order: "patrol", label: "Patrol", sub: "wanders loosely nearby" },
      { order: "hunt", label: "Hunt", sub: "actively seeks out and fights nearby threats" },
      { order: "defend", label: "Defend", sub: "stays close, fights off anything that gets near you" },
    ];
    for (const o of orders) {
      const isCurrent = currentOrder === o.order;
      commandMenuBodyEl.appendChild(
        row(`${o.label}${isCurrent ? " (current)" : ""}`, o.sub, () => {
          if (isCurrent) return;
          closeCommandMenu();
          playerAct({ kind: "setStandingOrder", agentId: partner.id, order: o.order });
        })
      );
    }
    const moves = partner.moves ?? [];
    if (moves.length === 0) commandMenuBodyEl.appendChild(row("Knows no moves.", undefined, () => {}));
    for (const move of moves) {
      const onCooldown = (partner.moveCooldowns?.[move.id] ?? 0) > 0;
      commandMenuBodyEl.appendChild(
        row(move.name, onCooldown ? "on cooldown" : "tap, then tap a tile to target it", () => {
          if (onCooldown) return;
          closeCommandMenu();
          if (pendingTargetTile) {
            const target = pendingTargetTile;
            pendingTargetTile = undefined;
            commitMove(partner.id, move.id, target);
            return;
          }
          targeting = { agentId: partner.id, moveId: move.id };
          hudMessageEl.textContent = `Targeting for ${name}'s ${move.name} — tap a tile. Esc to cancel.`;
        })
      );
    }
  }
  numberMenuRows(commandMenuBodyEl);
  commandMenuEl.hidden = false;
}

function closeCommandMenu(): void {
  commandMenuEl.hidden = true;
  pendingTargetTile = undefined;
}
commandMenuCloseBtn.addEventListener("click", closeCommandMenu);

function cancelTargeting(): void {
  if (!targeting) return;
  targeting = undefined;
  targetPreviewTiles = [];
  hudMessageEl.textContent = "";
}

/** Same "whichever axis has the larger displacement wins, ties resolve south" facing rule `predation.ts`'s own (private) `facingToward` uses for `resolveAreaHit` — the preview has to derive the same facing an actual commit would, or it would show the wrong cells for a directional shape. */
function facingToward(from: Vec2, to: Vec2): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "E" : "W";
  return dy > 0 ? "S" : "N";
}

/** Recomputes `targetPreviewTiles` for the tile under the cursor, using whichever agent (player or bonded partner) `targeting` names as the one about to act. No-op outside targeting mode. */
function updateTargetPreview(hovered: Vec2): void {
  if (!targeting) return;
  const me = findPlayer(world);
  if (!me) return;
  const actor = targeting.agentId ? world.agents.find((a) => a.id === targeting!.agentId) : me;
  const move = actor?.moves?.find((m) => m.id === targeting!.moveId);
  if (!actor || !move) {
    targetPreviewTiles = [];
    return;
  }
  targetPreviewTiles = resolveShape(move.shape, actor.pos, facingToward(actor.pos, hovered));
}

/**
 * The death screen. The cause is the last logged event that names the
 * player — `starved`, `killed`, whichever — in the log's own words, so the
 * screen says why, not just that.
 */
function showGameOver(playerId: string): void {
  playerDead = true;
  // The run is over, so the autosave has nothing left to protect — and
  // leaving it would restore straight back into this death screen on the
  // next load, which reads as the game being stuck rather than finished.
  clearSavedRun();
  let cause = "";
  for (let i = log.events.length - 1; i >= 0; i--) {
    const e = log.events[i]!;
    if (eventNamesAgent(e, playerId)) {
      cause = formatEvent(e, world);
      break;
    }
  }
  gameOverCauseEl.textContent = cause || "The log does not say how.";
  gameOverStatsEl.textContent = `Tick ${world.tick} · seed ${playerSeed}`;
  gameOverEl.hidden = false;
}

/** ROADMAP.md M7 — "Done when: you emerge." The win screen for reaching the deepest level's exit tile. */
function showWinScreen(): void {
  playerWon = true;
  runWonStatsEl.textContent = `Tick ${world.tick} · seed ${playerSeed}`;
  runWonEl.hidden = false;
}

/** Checked after every player turn: only the deepest level carries an `"exit"` tile at all, so this is a no-op everywhere else. */
function checkWinCondition(player: Agent): void {
  if (world.depth === CAVE_RUN_DEPTH && isAtExit(world, player)) showWinScreen();
}

/**
 * Direct follow-up ask, right after the cave-climb win screen shipped:
 * "spawn in overworld after graduating from the end of the cave" — scoped
 * to full seamless macro-grid walking, not a one-off spectator drop-in.
 * Carries the SAME human agent across (level, moves, inventory, hp all
 * intact — this is the graduated player, not a fresh spawn) into a brand
 * new macro-grid world. Sets `macroWorld` while `playerMode` stays true —
 * the one deliberate relaxation of the "these two are mutually exclusive"
 * invariant every other mode transition in this file still holds to;
 * `playerAct` is the only other place that reads `macroWorld` while
 * `playerMode` is on (to check for zone-edge crossings), everything else
 * (the macro map view, its own toggle) stays untouched and hidden, same as
 * ordinary player mode already keeps them.
 */
function enterOverworldFromCaveWin(): void {
  const player = findPlayer(world);
  if (!player) return;
  playerWon = false;
  runWonEl.hidden = true;
  // The cave run is finished. Drop its save rather than leave one that a
  // later reload would happily restore, dropping the player back underground
  // at the state they were in just before they won.
  clearSavedRun();
  macroWorld = createDemoMacroWorld(playerSeed);
  const startWorld = findRegion(macroWorld, macroWorld.focusedKey)!.world!;
  world.agents = world.agents.filter((a) => a !== player);
  player.layer = "surface";
  player.homeLayer = "surface";
  player.pos = findWalkableNear(startWorld, "surface", startWorld.width / 2, startWorld.height / 2);
  startWorld.agents.push(player);
  world = startWorld;
  resetUiForNewWorld();
  registerHerdsForFirstFrame();
  say("You emerge into the wider world.");
  renderPlayerHud();
  focusCameraOn(player.pos, undefined, true);
}

runWonContinueBtn.addEventListener("click", () => enterOverworldFromCaveWin());

/**
 * ROADMAP.md M7 — direct ask: "i think i just want to be able to move to
 * the next level of the cave." Not a `PlayerAction`/turn at all — crossing
 * levels swaps which `World` the whole app is looking at (same "re-point
 * `world` after the engine call" dance `focusZone` already does for the
 * macro grid), which an ordinary turn-advancing action can't express.
 */
function tryUseStairs(): void {
  const player = findPlayer(world);
  if (!player) return;
  const fromDepth = world.depth;
  const next = useStairs(world, player, log);
  if (!next) {
    say("There are no stairs here.");
    return;
  }
  world = next;
  const down = fromDepth !== undefined && world.depth !== undefined && world.depth > fromDepth;
  resetUiForNewWorld();
  registerHerdsForFirstFrame();
  renderPlayerHud();
  focusCameraOn(player.pos, undefined, true);
  say(`You climb ${down ? "down" : "up"} to level ${world.depth}.`);
}

/**
 * One player turn: queue the action and run world ticks until the player's
 * action energy comes round and it is applied — a slow human lets more of
 * the world move between steps than a fast one, same rules as every agent.
 * Then the ordinary post-tick display pipeline, and the camera follows.
 */
/** The layer the eye is on: the player's own in player mode, else the surface the spectator app has always shown. */
function viewLayer(): Layer {
  return (playerMode ? findPlayer(world)?.layer : undefined) ?? "surface";
}

function playerAct(action: PlayerAction): void {
  const player = findPlayer(world);
  if (!player) return;
  if (action.kind === "move") lastFacing = { dx: action.dx, dy: action.dy };
  // Direct ask: "spawn in overworld after graduating from the end of the
  // cave," scoped to full seamless walking — a move that would step off
  // the focused zone's own tile-grid bounds crosses into the neighbor
  // instead of just failing, the same "instant, no extra tick" shape the
  // cave's own stairs already use (tryUseStairs, below). Checked here,
  // ahead of the ordinary turn-advance, so a real wall still blocks
  // normally — only an actual out-of-bounds step reaches crossZoneEdge at
  // all (see its own doc comment for why it returns undefined otherwise).
  if (macroWorld && action.kind === "move") {
    const crossed = crossZoneEdge(macroWorld, player, action.dx, action.dy, IMMIGRATION_CONTEXT, log);
    if (crossed) {
      world = crossed;
      resetUiForNewWorld();
      registerHerdsForFirstFrame();
      afterTick();
      focusCameraOn(player.pos, undefined, true);
      renderPlayerHud();
      say(pendingCombatNotice ?? "You cross into a new stretch of land.");
      return;
    }
  }
  advancePlayerTurn(world, action, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  afterTick();
  scheduleSave();
  keepPlayerInView(player.pos);
  renderPlayerHud();
  // Real combat news — the player got hit, or a bonded follower landed or
  // missed one — outranks the routine "You move."/"You wait." outcome
  // message `renderPlayerHud` just set, so it applies last.
  if (pendingCombatNotice) say(pendingCombatNotice);
  if (!findPlayer(world)) showGameOver(player.id);
  else checkWinCondition(player);
}

const PLAYER_KEYS: Record<string, PlayerAction> = {
  ArrowUp: { kind: "move", dx: 0, dy: -1 },
  ArrowDown: { kind: "move", dx: 0, dy: 1 },
  ArrowLeft: { kind: "move", dx: -1, dy: 0 },
  ArrowRight: { kind: "move", dx: 1, dy: 0 },
  k: { kind: "move", dx: 0, dy: -1 },
  j: { kind: "move", dx: 0, dy: 1 },
  h: { kind: "move", dx: -1, dy: 0 },
  l: { kind: "move", dx: 1, dy: 0 },
  y: { kind: "move", dx: -1, dy: -1 },
  u: { kind: "move", dx: 1, dy: -1 },
  b: { kind: "move", dx: -1, dy: 1 },
  n: { kind: "move", dx: 1, dy: 1 },
  ".": { kind: "wait" },
  " ": { kind: "wait" },
  e: { kind: "eat" },
  q: { kind: "drink" },
  z: { kind: "crouch" },
};

/**
 * Direct asks: "under the attack option a sub menu show up to select your
 * bonded pokemon" and the follow-up, "Attack should move list should work
 * when you have a weapon, or tackle if you don't. The player has moves
 * too, even if it's just tackle." Attack always opens the chooser now — a
 * "You" section for the player's own real moves, plus a section per
 * bonded follower in zone. Pressing Attack again while already targeting
 * cancels the order rather than reopening the menu — the one mobile-
 * friendly way to back out besides Escape.
 */
function attemptAttack(): void {
  if (targeting) {
    cancelTargeting();
    return;
  }
  if (!findPlayer(world)) return;
  openCommandMenu();
}

window.addEventListener("keydown", (e) => {
  if (!playerMode) return;
  // Typing in the seed box or any input must not walk the player.
  if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
  if (playerDead || playerWon) {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      // Explicitly starting over must not leave the finished run's save
      // behind for the next reload to resurrect.
      clearSavedRun();
      loadPlayerWorld(playerSeed, playerScene);
    } else if (playerWon && e.key === "Enter") {
      e.preventDefault();
      enterOverworldFromCaveWin();
    }
    return;
  }
  if (!commandMenuEl.hidden) {
    if (e.key === "Escape") closeCommandMenu();
    else if (activateNumberedMenuRow(commandMenuBodyEl, e.key)) e.preventDefault();
    return;
  }
  if (targeting) {
    if (e.key === "Escape") cancelTargeting();
    return;
  }
  cancelTravel();
  if (!packMenuEl.hidden) {
    if (e.key === "Escape" || e.key === "i") closePackMenu();
    else if (activateNumberedMenuRow(packMenuBodyEl, e.key)) e.preventDefault();
    return;
  }
  if (e.key === "x") {
    e.preventDefault();
    examineNext();
    return;
  }
  if (e.key === "g") {
    e.preventDefault();
    playerAct({ kind: "gather" });
    runActivity();
    return;
  }
  if (e.key === "f") {
    e.preventDefault();
    attemptAttack();
    return;
  }
  // Direct ask: "can't loot or butcher dead units. need to be able to -
  // maybe you need a knife to do more but that should be a thing."
  if (e.key === "o") {
    e.preventDefault();
    playerAct({ kind: "loot" });
    return;
  }
  if (e.key === "p") {
    e.preventDefault();
    playerAct({ kind: "butcher" });
    return;
  }
  if (e.key === ">" || e.key === "<") {
    e.preventDefault();
    tryUseStairs();
    return;
  }
  if (e.key === "i" || e.key === "c") {
    e.preventDefault();
    openPackMenu();
    return;
  }
  const action = PLAYER_KEYS[e.key];
  if (!action) return;
  e.preventDefault();
  playerAct(action);
});

/**
 * Direct ask: "I want to be able to see the overworld stuff... visualize
 * overworld." See macroMap.ts for the single pannable/zoomable canvas this
 * drives. `seed` (default: the same `SCENARIO_SEED` `createDemoMacroWorld`
 * itself defaults to) lets Load/Random regenerate the whole macro grid with
 * a different seed — direct follow-up: "can overworld be regenerated based
 * on random seed" — mirroring `loadWorld`'s own seed-input/URL sync so the
 * seed field and the "Copy" button stay meaningful in Overworld mode too.
 */
function loadMacroWorld(seed: number = SCENARIO_SEED): void {
  macroWorld = createDemoMacroWorld(seed);
  world = findRegion(macroWorld, macroWorld.focusedKey)!.world!;
  log = new EventLog();
  registerHerdsForFirstFrame();
  resetUiForNewWorld();
  macroMapView.render(macroWorld, true);
  renderMinimapWidget();

  seedInput.value = String(seed);
  seedChipLabel.textContent = String(seed);
  const url = new URL(location.href);
  url.searchParams.set("seed", String(seed));
  history.replaceState(null, "", url);
}

/** The macro grid's own promotion/demotion transition, triggered by clicking a zone on the macro map — see macroMap.ts. A no-op if `(row, col)` is out of the grid's bounds (macroMap.ts's click handler doesn't itself bounds-check). */
function focusZone(row: number, col: number): void {
  if (!macroWorld) return;
  setFocusedZone(macroWorld, row, col, IMMIGRATION_CONTEXT, log);
  world = findRegion(macroWorld, macroWorld.focusedKey)!.world!;
  // A newly promoted zone has never been ticked either — same first-frame
  // gap as a fresh load, see `registerHerdsForFirstFrame`.
  registerHerdsForFirstFrame();
  resetUiForNewWorld();
  macroMapView.render(macroWorld, true);
  renderMinimapWidget();
}

function step(): void {
  if (macroWorld) {
    // tickMacroWorld runs the focused zone's ordinary tickWorld internally
    // (unchanged) plus cheap per-species advancement for every other tracked
    // zone — see overworld.ts's own doc comment. `world` is re-synced right
    // after in case this tick's `regionCrossed`/emigration bookkeeping
    // mattered, though focus itself only ever changes via `focusZone` (a
    // macro-map click), never mid-tick.
    tickMacroWorld(macroWorld, log, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT);
    world = findRegion(macroWorld, macroWorld.focusedKey)!.world!;
  } else {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  }
  afterTick();
}

/**
 * Direct report: "I don't see what damaged me or what move was used" /
 * "when I command a unit to attack a tile it's not really clear if it's
 * hitting the tile or the Pokémon." Plain-sentence news for any `fought`/
 * `missed` this tick that the player wasn't already told about via their
 * own `outcomeText` — either they took the hit themselves, or a bonded
 * follower (commanded or just fighting on its own) did the hitting or the
 * taking. Skips anything with the player as ATTACKER: that's already
 * covered by outcomeText's own "You strike X!" line. Picks the single
 * most relevant event in a busy tick — the player getting hit outranks a
 * follower's own fight, so a real threat to the player is never buried
 * under a routine ally skirmish.
 */
function combatNoticeFor(events: readonly SimEvent[], world: World, player: Agent): string | undefined {
  const followerIds = new Set(world.agents.filter((a) => a.followingId === player.id).map((a) => a.id));
  const name = (id: string, species: string) => (id === player.id ? "You" : SPECIES[species]?.name ?? species);
  // A busy tick can carry several relevant events (a follower's earlier
  // hit, then a later miss) — a real, sampled bug: picking whichever came
  // LAST silently buried a landed hit under a follow-up miss. Two tiers
  // (player outranks follower), each preferring a landed hit over a miss —
  // real damage is always more informative than "nothing happened."
  let playerHit: string | undefined;
  let playerMiss: string | undefined;
  let followerHit: string | undefined;
  let followerMiss: string | undefined;
  for (const event of events) {
    if (event.kind !== "fought" && event.kind !== "missed") continue;
    if (event.attackerId === player.id) continue; // already told via outcomeText
    const involvesPlayer = event.defenderId === player.id;
    const involvesFollower = followerIds.has(event.attackerId) || followerIds.has(event.defenderId);
    if (!involvesPlayer && !involvesFollower) continue;
    const move = findMoveUsed(event, world);
    const moveName = move?.name ?? event.moveId;
    const attacker = name(event.attackerId, event.attackerSpecies);
    const defender = event.defenderId === player.id ? "you" : name(event.defenderId, event.defenderSpecies);
    if (event.kind === "missed") {
      const notice = `${attacker}'s ${moveName} misses ${defender}.`;
      if (involvesPlayer) playerMiss ??= notice;
      else followerMiss ??= notice;
    } else {
      const notice = `${attacker}'s ${moveName} hits ${defender} for ${event.damage}${event.critical ? " (crit!)" : ""}.`;
      if (involvesPlayer) playerHit = notice; // last landed hit on the player wins — the most recent damage is the most relevant
      else followerHit = notice;
    }
  }
  return playerHit ?? playerMiss ?? followerHit ?? followerMiss;
}

/**
 * Everything `step()` does after the world has advanced — feeding the new
 * events to every display consumer and dirtying the inspector. Split out so
 * the player turn gate (`playerAct`, ROADMAP.md M0) can advance the world by
 * its own route and still run exactly this pipeline, rather than a copy.
 */
function afterTick(): void {
  // Only the events since the last step are new; EventLog is append-only for the life of a world.
  const newEvents = log.events.slice(lastLoggedEventCount);
  // A finishing-blow `fought` hit (predation.ts's `finishingPool` mechanic —
  // a mob still whacking an already-fainted body) carries no new information
  // for a live viewer: the target's already down, its HP is already 0, and
  // it stays 0 until the real `killed`/`defeated` event (unaffected by this
  // filter) fires. Direct ask: "if a unit is already fainted it shouldn't
  // say 0 hp in the log... just fast forward to the death." Filtered once,
  // here, rather than in each of the four display consumers below — none of
  // them (log, map popups, auto-camera engagement tracking, battle screen)
  // needs these repeats; the eventual death event already keeps a battle
  // engagement alive/concluded without them.
  const displayEvents = newEvents.filter((e) => !(e.kind === "fought" && e.finishingBlow));
  const noticePlayer = findPlayer(world);
  pendingCombatNotice = noticePlayer ? combatNoticeFor(displayEvents, world, noticePlayer) : undefined;
  eventLogPanel.ingest(displayEvents, world);
  // Your party's own news, in its own voice — see ActionLogPanel's doc
  // comment for why the player is excluded here rather than included.
  // Membership is read fresh each tick, so an event counts as your party's
  // if they were following you at the time.
  if (noticePlayer) {
    actionLogPanel.ingest(displayEvents, world, new Set(bondedPartnersInZone(noticePlayer).map((a) => a.id)));
  }
  eventPopups.ingest(displayEvents, world);
  moveEffects.ingest(displayEvents);
  autoCamera.ingest(displayEvents, world);
  // `ingest` above only queues a newly-detected engagement; promoting it to
  // `active` (what `currentEngagement()` actually reads) used to happen only
  // in `update()`, called once per animation frame in `frame()` below — fully
  // decoupled from tick cadence. Direct report: "battle log... just sorta
  // says... not much... I can't see what happens and it goes away." Root
  // cause: a fast kill (often the entire fight, for a one/two-shot) could
  // start AND finish inside this exact step() call, all before the next
  // requestAnimationFrame ever got to promote+sync it — battleScreenPanel's
  // `ingest` was gated on `setActive` having already run with the promoted
  // engagement, so every real fought/damage/faint event from that fight was
  // dropped, leaving only the generic "X vs Y fighting!" intro line
  // `setActive` itself synthesizes. Calling `update` (idempotent — see its
  // own doc comment) and re-syncing `battleScreenPanel` here, every tick
  // rather than every frame, closes that gap.
  // step() only ever runs while playing (it's driven by the tick-loop
  // interval, only scheduled while `playing` — see scheduleLoop), so this
  // is always the "playing" call.
  autoCamera.update(world, true);
  battleScreenPanel.setActive(autoCamera.currentEngagement());
  battleScreenPanel.ingest(displayEvents, world);
  lastLoggedEventCount = log.events.length;
  // Always dirty, not just when something's selected — the no-selection
  // view is a live population/weather overview, not a static placeholder.
  inspectorDirty = true;
  updateStatusLabels();
}

function updateStatusLabels(): void {
  tickLabel.textContent = `Tick ${world.tick}`;
  const hour = ((world.tick % 200) / 200) * 24;
  clockLabel.textContent = `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.floor((hour % 1) * 60)).padStart(2, "0")}`;
}

// --- Tick loop control -------------------------------------------------------

function scheduleLoop(): void {
  if (intervalId !== undefined) {
    clearInterval(intervalId);
    intervalId = undefined;
  }
  // The world waits for the player. See `playerAct`.
  if (playerMode) return;
  if (!playing) return;

  if (battleStepMode) {
    // A battle owns ticking now — exactly one tick per fixed real-time beat,
    // ignoring the speed slider entirely (see `BATTLE_STEP_INTERVAL_MS`'s
    // doc comment). Still gated on `playing` above: if the viewer is
    // paused, a battle starting shouldn't un-pause the world for them.
    intervalId = window.setInterval(step, BATTLE_STEP_INTERVAL_MS);
    return;
  }

  const speed = SPEED_STEPS[speedIndex]!;
  const ticksPerSec = BASE_TICKS_PER_SEC * speed;
  if (ticksPerSec <= 60) {
    intervalId = window.setInterval(step, 1000 / ticksPerSec);
  } else {
    // Beyond ~60 real timer callbacks/sec, batch multiple ticks per callback instead of flooding the event loop.
    const ticksPerCallback = Math.round(ticksPerSec / 60);
    intervalId = window.setInterval(() => {
      for (let i = 0; i < ticksPerCallback; i++) step();
    }, 1000 / 60);
  }
}

function setPlaying(next: boolean): void {
  playing = next;
  playPauseBtn.title = playing ? "Pause" : "Play";
  playPauseBtn.classList.toggle("playing", playing);
  // Floating HUD button (direct ask: "make pause and play floating
  // buttons") swaps its icon rather than its text — a pause glyph while
  // running, a play triangle once paused, same convention any media
  // player uses.
  pauseIcon.hidden = !playing;
  playIcon.hidden = playing;
  scheduleLoop();
}

// --- Selection / inspector ---------------------------------------------------

function selectAgent(agent: Agent | undefined): void {
  selectedAgentId = agent?.id;
  eventLogPanel.setFilter(selectedAgentId);
  // Direct ask: "if you're focused on a Pokémon in inspector while autocam is
  // going, just filter to all notable autocam events that involve that unit.
  // Filter out all else while it's focused." Deselecting hands the whole
  // world back to Auto Camera.
  autoCamera.setFocusAgent(selectedAgentId);
  inspectorDirty = true;
}

/**
 * The species or herd the viewer asked to see, or `undefined` — direct ask:
 * "clicking on herd name or species should auto zoom to them and highlight
 * them on the map."
 *
 * Stored as the query, never as the ids matching it. Resolved fresh every
 * frame by `focusGroupIds` below, so a herd that loses a member, gains a
 * hatchling, or walks across the map stays correctly highlighted instead of
 * slowly becoming a highlight of whoever used to be in it.
 */
let focusedGroup: GroupSelection | undefined;

/** Every living surface member of `focusedGroup` right now. Empty (not undefined) when the group has died out — the highlight simply stops drawing, which is the honest outcome. */
function focusGroupIds(): ReadonlySet<string> | undefined {
  if (!focusedGroup) return undefined;
  const ids = new Set<string>();
  for (const a of world.agents) {
    if (a.alive === false) continue;
    if (focusedGroup.kind === "species" ? a.species === focusedGroup.key : a.herdId === focusedGroup.key) ids.add(a.id);
  }
  return ids;
}

/**
 * Frames the whole group rather than centring on one member: a herd is
 * spread out, and centring on an arbitrary member would leave the rest off
 * screen at Auto Camera's tight zoom. Zooms out far enough to fit the group's
 * bounding box (never in past the default), then centres it.
 */
function focusOnGroup(selection: GroupSelection): void {
  // Clicking the active row again clears it — a row is a toggle, so there is
  // always an obvious way to get the highlight off screen.
  if (focusedGroup && focusedGroup.kind === selection.kind && focusedGroup.key === selection.key) {
    focusedGroup = undefined;
    inspectorDirty = true;
    return;
  }
  focusedGroup = selection;
  inspectorDirty = true;

  const ids = focusGroupIds();
  if (!ids || ids.size === 0) return;
  const bounds = highlightBounds(world, ids);
  if (!bounds) return;
  const spanX = bounds.right - bounds.left;
  const spanY = bounds.bottom - bounds.top;
  // Fit the group with a little margin, clamped so a single animal does not
  // slam the view to maximum zoom and a map-wide species does not zoom past
  // what the canvas can show.
  const fit = Math.min(canvasWrap.clientWidth / Math.max(1, spanX), canvasWrap.clientHeight / Math.max(1, spanY)) * 0.8;
  setZoom(Math.max(ZOOM_MIN, Math.min(AUTO_CAM_ZOOM, fit)));
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;
  const targetLeft = Math.max(0, cx * zoom - canvasWrap.clientWidth / 2);
  const targetTop = Math.max(0, cy * zoom - canvasWrap.clientHeight / 2);
  autoCamLastScroll = { left: targetLeft, top: targetTop };
  canvasWrap.scrollLeft = targetLeft;
  canvasWrap.scrollTop = targetTop;
}

function refreshSelection(): void {
  if (!inspectorDirty) return;
  inspectorDirty = false;
  const agent = selectedAgentId ? world.agents.find((a) => a.id === selectedAgentId) : undefined;
  renderInspector(inspectorEl, agent, world, { onFocusGroup: focusOnGroup, focused: focusedGroup, observer: playerMode ? findPlayer(world) : undefined });
}

/**
 * Tap-to-walk. One step per player turn along the shortest *known* path
 * (engine `nextTravelStep`: seen-or-remembered tiles only), re-planned each
 * step, paced so the walk is visible, and stopped early when something new
 * comes into view — the same rule a roguelike's travel command uses, so the
 * world cannot ambush you while you are not looking. Any key or tap cancels.
 */
const TRAVEL_STEP_MS = 90;
const TRAVEL_MAX_STEPS = 60;
let travelTimer: number | undefined;

function cancelTravel(): void {
  if (travelTimer !== undefined) {
    window.clearTimeout(travelTimer);
    travelTimer = undefined;
  }
}

function travelTo(target: Vec2): void {
  cancelTravel();
  const me = findPlayer(world);
  if (!me) return;
  if (target.x === me.pos.x && target.y === me.pos.y) {
    playerAct({ kind: "wait" });
    return;
  }
  const first = nextTravelStep(world, me, target);
  if (!first) {
    say("You do not know a way there.");
    return;
  }
  let steps = 0;
  let seenBefore = visibleAgentIds(world, me);
  const stepOnce = (): void => {
    travelTimer = undefined;
    const player = findPlayer(world);
    if (!player) return;
    const step = nextTravelStep(world, player, target);
    if (!step) {
      if (player.pos.x !== target.x || player.pos.y !== target.y) say("You can go no further.");
      return;
    }
    playerAct(step);
    steps++;
    const after = findPlayer(world);
    if (!after) return;
    const seenNow = visibleAgentIds(world, after);
    for (const id of seenNow) {
      if (!seenBefore.has(id)) {
        const who = world.agents.find((a) => a.id === id);
        say(who ? `You stop. ${examine(world, who, { observer: after, name: (k) => SPECIES[k]?.name ?? k })}` : "You stop.");
        return;
      }
    }
    seenBefore = seenNow;
    if ((after.pos.x === target.x && after.pos.y === target.y) || steps >= TRAVEL_MAX_STEPS) return;
    travelTimer = window.setTimeout(stepOnce, TRAVEL_STEP_MS);
  };
  stepOnce();
}

// The on-screen verbs. `click` is fine here: these buttons are never rebuilt.
// `#hud-pack-btn` moved out of `#hud-pad` to its own corner (direct ask:
// "Put a backpack emoji for pack on the top right"), so it's matched here
// by its own id alongside the row.
document.querySelectorAll<HTMLButtonElement>("#hud-pad button, #hud-pack-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!playerMode || playerDead || playerWon) return;
    const act = btn.dataset.act;
    if (targeting && act !== "attack") return; // a target tile is the only thing that should land next
    cancelTravel();
    if (act === "look") examineNext();
    else if (act === "gather") {
      playerAct({ kind: "gather" });
      runActivity();
    } else if (act === "pack") openPackMenu();
    else if (act === "attack") attemptAttack();
    else if (act === "useStairs") tryUseStairs();
    else if (act === "wait" || act === "drink" || act === "crouch") playerAct({ kind: act });
  });
});

/**
 * ROADMAP.md M4's examine: a free action (no tick). Each press selects the
 * next creature you can see, nearest first, and puts its examine line in
 * the HUD; the inspector shows the same line with the numbers under it.
 * Clicking a visible creature does the same through the ordinary click
 * handler — this is the keyboard road to it.
 */
function examineNext(): void {
  const me = findPlayer(world);
  if (!me?.vision) return;
  const seen = world.agents
    .filter((a) => a.id !== me.id && a.layer === me.layer && a.alive !== false && me.vision!.visible.has(a.pos.y * world.width + a.pos.x))
    .sort((a, b) => Math.hypot(a.pos.x - me.pos.x, a.pos.y - me.pos.y) - Math.hypot(b.pos.x - me.pos.x, b.pos.y - me.pos.y));
  if (seen.length === 0) {
    say("You see no one.");
    return;
  }
  const i = seen.findIndex((a) => a.id === selectedAgentId);
  const next = seen[(i + 1) % seen.length]!;
  selectAgent(next);
  say(examine(world, next, { observer: me, name: (id) => SPECIES[id]?.name ?? id }));
}

// --- Unified side panel: Inspector / Battle / Chronicle / Events tabs ------
// Direct UX-redesign ask: these four used to live in two different places —
// Inspector/Battle Screen shared a docked tab pair under the map, while
// Legend/Event Log hid behind a hamburger-triggered off-canvas drawer. One
// panel, tabs always in the same spot. `renderInspector`/`BattleScreenPanel`/
// `EventLogPanel` all keep rendering into their own `#inspector`/
// `#battle-screen`/`#event-log` divs exactly as before — this is purely a
// thin visibility switch over the set, the same `[hidden]` convention the
// old drawer/tab toggles already used.
//
// Direct follow-up ask: "remove the legend tab and move events to the right
// most" — the Legend tab/page (and `legend.ts`'s `renderLegend` call) are
// gone; Events moved from third to last in both the tab bar (index.html)
// and this file's own tab order.

type PanelTab = "you" | "inspector" | "battle-screen" | "chronicle" | "events";
let activeTab: PanelTab = "inspector";
/**
 * The `seq` of the battle engagement the viewer last manually switched away
 * from Battle Screen *during* (back to another tab) — mirrors
 * `AutoCameraController`'s own `viewerTookOver` sticky-override pattern:
 * auto-switching won't re-steal the tab back for *this* battle, but a
 * genuinely new battle (a different seq) is a fresh thing to show and earns
 * the auto-switch back. `undefined` when there's no active override.
 */
let tabManualOverrideForBattleSeq: number | undefined;
/** The `seq` of the battle engagement auto-switch has already acted on — so a battle that's still ongoing next frame doesn't keep re-triggering the switch (which would also stomp a manual switch away from Battle Screen on every single frame). */
let lastAutoSwitchedBattleSeq: number | undefined;

const TAB_BUTTONS: Record<PanelTab, HTMLButtonElement> = {
  you: tabYouBtn,
  inspector: tabInspectorBtn,
  "battle-screen": tabBattleScreenBtn,
  chronicle: tabChronicleBtn,
  events: tabEventsBtn,
};
const TAB_PAGES: Record<PanelTab, HTMLElement> = {
  you: youPageEl,
  inspector: inspectorEl,
  "battle-screen": battleScreenEl,
  chronicle: chronicleEl,
  events: eventsPageEl,
};

function selectTab(tab: PanelTab, manual: boolean): void {
  activeTab = tab;
  for (const key of Object.keys(TAB_PAGES) as PanelTab[]) {
    TAB_PAGES[key].hidden = key !== tab;
    TAB_BUTTONS[key].classList.toggle("playing", key === tab);
    TAB_BUTTONS[key].setAttribute("aria-selected", String(key === tab));
  }
  // A chronicle is a whole-run summary, so it only does work while visible.
  chroniclePanel.setOpen(tab === "chronicle");
  clearSelectionBtn.hidden = tab !== "inspector"; // "Clear [selection]" only means anything on the Inspector tab

  if (!manual) return;
  // A deliberate click always wins over auto-switch's own bookkeeping — see
  // the two fields' doc comments above.
  const battleSeq = autoCamera.currentEngagement()?.category === "battle" ? autoCamera.currentEngagement()!.seq : undefined;
  if (tab === "battle-screen") {
    tabManualOverrideForBattleSeq = undefined;
  } else if (battleSeq !== undefined) {
    tabManualOverrideForBattleSeq = battleSeq;
  }
}

tabYouBtn.addEventListener("click", () => {
  document.body.classList.remove("world-tabs-open");
  selectTab("you", true);
});
// "World" is a disclosure, not a page of its own: it unfolds the four
// spectator tabs and lands on whichever was last open (Inspector by
// default), so play mode spends one tab slot on them instead of four.
tabWorldBtn.addEventListener("click", () => {
  const opening = !document.body.classList.contains("world-tabs-open");
  document.body.classList.toggle("world-tabs-open", opening);
  if (opening) selectTab(activeTab === "you" ? "inspector" : activeTab, true);
  else selectTab("you", true);
});
tabInspectorBtn.addEventListener("click", () => selectTab("inspector", true));
tabChronicleBtn.addEventListener("click", () => selectTab("chronicle", true));
tabBattleScreenBtn.addEventListener("click", () => selectTab("battle-screen", true));
tabEventsBtn.addEventListener("click", () => selectTab("events", true));

/**
 * Auto-switches to the Battle Screen tab the moment Auto Camera starts
 * tracking a new battle — mirrors the spirit of the old standalone panel
 * just appearing on its own, without permanently taking the wheel: the
 * viewer can still switch back to Inspector mid-battle (a manual override,
 * tracked by `tabManualOverrideForBattleSeq`), and that choice sticks for
 * the rest of *this* battle, but a fresh battle (new `seq`) always earns the
 * auto-switch again, the same "a new thing to look at re-earns control"
 * rule Auto Camera's own camera-follow already applies to a manual pan.
 */
function maybeAutoSwitchTab(): void {
  // Never in play mode: this is Auto Camera's spectator affordance, and
  // yanking the panel off You mid-turn to show a fight elsewhere in the
  // world is exactly the "my own stuff keeps getting buried" problem the
  // You panel exists to fix.
  if (playerMode) return;
  const engagement = autoCamera.currentEngagement();
  // Clashes count too. They render the same rich Battle Screen a real battle
  // does (same move/crit/damage lines, same HP bars) and outnumber real
  // battles about 13 to 1 in a run, so excluding them here meant the panel
  // the viewer was meant to read almost never came into view on its own.
  if (!engagement || (engagement.category !== "battle" && engagement.category !== "clash")) return;
  if (engagement.seq === lastAutoSwitchedBattleSeq) return;
  lastAutoSwitchedBattleSeq = engagement.seq;
  if (engagement.seq === tabManualOverrideForBattleSeq) return;
  if (activeTab !== "battle-screen") selectTab("battle-screen", false);
}

// --- Wiring ------------------------------------------------------------------

loadSeedBtn.addEventListener("click", () => {
  const value = Number(seedInput.value);
  if (!Number.isFinite(value)) return;
  if (macroWorld) loadMacroWorld(value);
  else loadWorld(value);
  seedPopover.hidden = true;
});

randomSeedBtn.addEventListener("click", () => {
  if (macroWorld) loadMacroWorld(randomSeed());
  else loadWorld(randomSeed());
  seedPopover.hidden = true;
});

copySeedBtn.addEventListener("click", () => {
  navigator.clipboard?.writeText(String(currentSeed())).catch(() => {
    // Clipboard access can be denied depending on context — the seed is still
    // visible and selectable in the input field either way, so this is a
    // convenience, not a required path.
  });
});

playPauseBtn.addEventListener("click", () => setPlaying(!playing));

stepBtn.addEventListener("click", () => {
  setPlaying(false);
  step();
});

speedSlider.min = "0";
speedSlider.max = String(SPEED_STEPS.length - 1);
speedSlider.value = String(speedIndex);
speedSlider.addEventListener("input", () => {
  speedIndex = Number(speedSlider.value);
  speedLabel.textContent = `${SPEED_STEPS[speedIndex]}x`;
  scheduleLoop();
  // A real drag on the slider, not auto-camera's own `setSpeed` (that path
  // never touches the DOM slider's `input` event) — take it as the viewer's
  // new intended speed rather than something to snap back from later.
  autoCamera.noteManualSpeedChange();
});

/**
 * Where on the map a pointer event landed. The canvas is drawn at its
 * intrinsic tile size and then CSS-scaled, so screen pixels are not canvas
 * pixels and the ratio has to come out of the live bounding box.
 *
 * Extracted because this arithmetic was inlined three times (click,
 * mousemove, and renderer.ts's own hit test) and the tile menu would have
 * made a fourth.
 */
function tileAtPointer(event: { clientX: number; clientY: number }): Vec2 {
  const { x, y } = canvasPixelAt(event);
  return { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) };
}

/** The same event in the canvas's own pixel space — what `agentAtCanvasPos` and the engagement-box hit test want. */
function canvasPixelAt(event: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

canvas.addEventListener("click", (event) => {
  // A long-press already acted on this tile; the browser still delivers the
  // trailing click, which would otherwise also walk the player there.
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  const { x, y } = canvasPixelAt(event);
  // Direct ask: "select a move and target a space with it." Any tile —
  // whether or not something's standing on it — becomes the order's target,
  // ahead of the ordinary agent-select/tap-to-walk handling right below, the
  // same way a real target-a-tile UI would consume the next click outright.
  if (targeting) {
    const target = tileAtPointer(event);
    const { agentId, moveId } = targeting;
    targeting = undefined;
    targetPreviewTiles = [];
    // `playerAct` (not a bare `applyPlayerAction`) — issuing the order is
    // the player's own turn to spend, same as every other verb; the HUD
    // message comes from `outcomeText`'s own "command"/"attack" case.
    // `agentId` undefined means this is the player's OWN targeted swing
    // (direct ask: "change attack for player moves to also be targeted,
    // like allies moves") rather than an order for a bonded partner.
    commitMove(agentId, moveId, target);
    return;
  }
  // Direct follow-up ask: "I should be able to click specific units in the
  // box to inspect them, right now click focuses the fight." A real agent
  // hit now wins outright — checked BEFORE the engagement-box hit test
  // below, reversing the original priority (see that block's own comment
  // for why it used to go the other way): tapping a specific combatant is
  // unambiguous ("inspect THIS one"), so it no longer gets swallowed by the
  // box's own "focus the whole fight" handling just because it's also
  // sitting inside one.
  const agent = agentAtCanvasPos(world, x, y, viewLayer());
  if (agent) {
    selectAgent(agent);
    // In play mode a tap NEVER examines any more — it walks, like every other
    // tap. Direct report: "I get confused between tap to move vs tap to look."
    // One gesture, one meaning: tap moves, long-press looks. Selecting still
    // happens so the World/Inspector tab follows along.
    if (!playerMode) return;
    const me = findPlayer(world);
    if (!me || agent.id === me.id) return;
  }
  // Play mode: tapping a tile walks there — direct ask: "I can't play at all
  // on mobile. Can you allow a click based control scheme?" See travelTo.
  if (playerMode && !playerDead) {
    travelTo(tileAtPointer(event));
    return;
  }
  // Direct ask: "draw the yellow bounding box anyways on all cool events
  // happening around the map, and clicking in it enters auto cam just for
  // that one event" — a click that missed every actual agent but still
  // landed inside one of these (deliberately larger than a single tile)
  // boxes is "I want that fight."
  for (const engagement of autoCamera.listBattleEngagements()) {
    const bounds = highlightBounds(world, engagement.ids);
    if (bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      autoCamera.focusEngagement(engagement.seq);
      syncAutoCamToggleButton();
      return;
    }
  }
  // Missed everything — a real ask for a "release the camera lock" gesture:
  // "if I pause it I don't want to focus on something else unless I click
  // outside the box." A click on empty space (not on any agent, not inside
  // any tracked engagement's box) is exactly that gesture.
  autoCamera.noteManualViewChange();
  selectAgent(undefined);
});

// Direct ask: "Even the targeting for allies should like show the cone or
// the aoe of a target." Recomputes the preview on every hover while a
// move-target pick is in progress — the click handler above still does
// the actual committing, this only ever changes what's drawn.
canvas.addEventListener("mousemove", (event) => {
  if (!targeting) return;
  updateTargetPreview(tileAtPointer(event));
});

clearSelectionBtn.addEventListener("click", () => selectAgent(undefined));

// Direct ask: "the actual battle log... needs to be scrollable on mobile.
// Or more expandable." The real scroll bug is fixed in CSS
// (-webkit-overflow-scrolling: touch); this is the "more expandable" half —
// a much taller reading mode for the side panel's body, toggled on demand
// rather than always eating that much vertical space.
expandPanelBtn.addEventListener("click", () => {
  const expanded = panelBodyEl.classList.toggle("panel-expanded");
  expandPanelBtn.classList.toggle("playing", expanded);
});

/**
 * A checkbox's own wrapping `<label class="filter-chip">` gets a
 * `chip-active` class in sync with its `checked` state — direct UX-redesign
 * ask: the three event-log filters read as small toggle chips now instead
 * of checkbox+sentence rows, but they're still real `<input type=
 * "checkbox">` elements underneath (no change to the actual filtering
 * logic below), just restyled via this one class.
 */
function syncChip(checkbox: HTMLInputElement, chip: HTMLElement): void {
  chip.classList.toggle("chip-active", checkbox.checked);
}

hideNoiseCheckbox.addEventListener("change", () => {
  syncChip(hideNoiseCheckbox, chipHideNoise);
  eventLogPanel.setHideNoise(hideNoiseCheckbox.checked);
  eventLogPanel.render();
});

hideLevelUpsCheckbox.addEventListener("change", () => {
  syncChip(hideLevelUpsCheckbox, chipHideLevelUps);
  eventLogPanel.setHideLevelUps(hideLevelUpsCheckbox.checked);
  eventLogPanel.render();
});

headlinesOnlyCheckbox.addEventListener("change", () => {
  syncChip(headlinesOnlyCheckbox, chipHeadlinesOnly);
  eventLogPanel.setHeadlinesOnly(headlinesOnlyCheckbox.checked);
  eventLogPanel.render();
});

myLogOnlyCheckbox.addEventListener("change", () => {
  syncChip(myLogOnlyCheckbox, chipMyLogOnly);
  eventLogPanel.setMyLogOnly(myLogOnlyCheckbox.checked);
  eventLogPanel.render();
});
// Reflect each checkbox's own `checked` default (both "on" checkboxes are
// checked by default in index.html) the moment the page loads, not just on
// the next manual toggle.
syncChip(hideNoiseCheckbox, chipHideNoise);
syncChip(hideLevelUpsCheckbox, chipHideLevelUps);
syncChip(headlinesOnlyCheckbox, chipHeadlinesOnly);
syncChip(myLogOnlyCheckbox, chipMyLogOnly);

function setRenderStyle(style: RenderStyle): void {
  renderStyle = style;
  styleTileBtn.classList.toggle("playing", style === "tile");
  styleAsciiBtn.classList.toggle("playing", style === "ascii");
}
styleTileBtn.addEventListener("click", () => setRenderStyle("tile"));
styleAsciiBtn.addEventListener("click", () => setRenderStyle("ascii"));

// --- Side panel collapse, seed popover, overflow menu -----------------------
// Direct UX-redesign ask: Legend/Event Log no longer live behind a
// hamburger-triggered off-canvas drawer — they're ordinary tabs in the same
// always-visible side panel as Inspector/Battle (see the tab section
// above). `toggle-panel` instead collapses that whole panel away (more room
// for the map), and the old header's seed/style/zoom controls condense into
// a click-to-open chip and overflow menu so the header itself stays a
// single slim row instead of wrapping across several.
togglePanelBtn.addEventListener("click", () => {
  sidePanelEl.classList.toggle("panel-collapsed");
});

function closePopovers(): void {
  seedPopover.hidden = true;
  moreMenuEl.classList.remove("open");
}

seedChipBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = seedPopover.hidden;
  closePopovers();
  seedPopover.hidden = !opening;
});

moreMenuToggleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const opening = !moreMenuEl.classList.contains("open");
  closePopovers();
  if (opening) moreMenuEl.classList.add("open");
});

// Clicking anywhere outside either popover closes it — the same "click
// elsewhere dismisses it" convention the old drawer's backdrop provided,
// without needing a dedicated full-screen backdrop element for two small
// header popovers.
document.addEventListener("click", (event) => {
  const target = event.target as Node;
  if (!seedChipWrap.contains(target)) seedPopover.hidden = true;
  if (!moreMenuWrap.contains(target)) moreMenuEl.classList.remove("open");
});
seedPopover.addEventListener("click", (event) => event.stopPropagation());
moreMenuEl.addEventListener("click", (event) => event.stopPropagation());

// Scales the canvas's *displayed* size only (CSS width/height), leaving its
// backing pixel buffer at native TILE_SIZE resolution — agentAtCanvasPos's
// click math already divides by the element's rendered rect, not a fixed
// pixel size, so clicking a tile keeps working correctly at any zoom level.
function setZoom(next: number): void {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
  canvas.style.width = `${canvas.width * zoom}px`;
  canvas.style.height = `${canvas.height * zoom}px`;
  // `image-rendering: pixelated` is right when scaling UP — it keeps pixel art
  // crisp instead of smearing it. Scaling DOWN it is actively destructive:
  // nearest-neighbour at 0.8 throws away every fifth row and column outright,
  // so one-pixel features simply vanish. Direct report: "Krabbys left eye is
  // missing a black pixel...?" — measured at the time as a 1800x1200 canvas
  // displayed at 1440x960. Below 1:1, let the browser filter instead: softer,
  // but every pixel contributes rather than one in five being deleted.
  canvas.style.imageRendering = zoom < 1 ? "auto" : "pixelated";
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}
function applyZoom(): void {
  setZoom(zoom);
}
zoomOutBtn.addEventListener("click", () => {
  setZoom(zoom / ZOOM_BUTTON_FACTOR);
  autoCamera.noteManualViewChange();
});
zoomInBtn.addEventListener("click", () => {
  setZoom(zoom * ZOOM_BUTTON_FACTOR);
  autoCamera.noteManualViewChange();
});

/**
 * Google Maps-style scroll-wheel zoom: whatever content point sits under the
 * cursor stays under the cursor after `applyZoomFn` changes `canvasEl`'s
 * rendered size, rather than the naive "zoom, then leave scroll position
 * alone" a plain `setZoom`/`zoomIn` call would do (which visibly drifts the
 * content out from under the pointer). Generic over which canvas/scroll pair
 * it's zooming — reused for both the tile view and the macro overworld map
 * below, since `getBoundingClientRect` before/after is layout-agnostic (works
 * whether the resize came from a CSS `style.width/height` scale like the
 * tile view uses, or a native backing-buffer resize like the macro map's
 * own zoom does).
 */
function zoomAtPoint(scrollEl: HTMLElement, canvasEl: HTMLCanvasElement, clientX: number, clientY: number, applyZoomFn: () => void): void {
  const before = canvasEl.getBoundingClientRect();
  const fracX = before.width > 0 ? (clientX - before.left) / before.width : 0.5;
  const fracY = before.height > 0 ? (clientY - before.top) / before.height : 0.5;
  applyZoomFn();
  const after = canvasEl.getBoundingClientRect();
  scrollEl.scrollLeft += after.left + fracX * after.width - clientX;
  scrollEl.scrollTop += after.top + fracY * after.height - clientY;
}

/** Per-wheel-notch zoom step — gentler than the +/- buttons' 1.25x jump since a wheel/trackpad fires many events in quick succession for one gesture. */
const WHEEL_ZOOM_FACTOR = 1.1;

canvasWrap.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
    zoomAtPoint(canvasWrap, canvas, event.clientX, event.clientY, () => setZoom(zoom * factor));
    autoCamera.noteManualViewChange();
  },
  { passive: false }
);

// canvas-wrap's native `scroll` event fires identically whether the browser
// scrolled because the viewer dragged/wheeled it or because auto-camera just
// set `scrollLeft`/`scrollTop` itself (`focusCameraOn`/`restoreHomeView`) —
// tell them apart by comparing against the exact position auto-camera itself
// last set (both are plain, non-smooth assignments, so this is exact, not a
// timing-based guess).
canvasWrap.addEventListener("scroll", () => {
  const last = autoCamLastScroll;
  if (last && Math.abs(canvasWrap.scrollLeft - last.left) < 1 && Math.abs(canvasWrap.scrollTop - last.top) < 1) return;
  autoCamera.noteManualViewChange();
});

// Two-finger pinch to zoom, touch devices — canvas-wrap still scrolls with
// a single finger (touch-action: pan-x pan-y in index.html), so pinch only
// takes over once a second touch point appears.
let pinchStartDistance: number | undefined;
let pinchStartZoom = zoom;

function touchDistance(touches: TouchList): number {
  const [a, b] = [touches[0]!, touches[1]!];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

canvasWrap.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length === 2) {
      pinchStartDistance = touchDistance(event.touches);
      pinchStartZoom = zoom;
    }
  },
  { passive: true }
);
canvasWrap.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length !== 2 || pinchStartDistance === undefined) return;
    event.preventDefault();
    setZoom(pinchStartZoom * (touchDistance(event.touches) / pinchStartDistance));
    autoCamera.noteManualViewChange();
  },
  { passive: false }
);
canvasWrap.addEventListener(
  "touchend",
  (event) => {
    if (event.touches.length < 2) pinchStartDistance = undefined;
  },
  { passive: true }
);

// Same pinch-to-zoom idiom, mirrored onto the macro map: `#macro-map-scroll`
// already sets `touch-action: pan-x pan-y` (so a single finger still scrolls
// it natively), which as a side effect also blocks the browser's own native
// pinch-zoom there — but nothing filled in a replacement, so pinching over
// the overworld map used to just do nothing. Direct follow-up to "can't
// click or zoom the overworld map" on mobile: the +/- buttons did work, just
// small; this is the gesture a phone user reaches for first.
let macroPinchStartDistance: number | undefined;
let macroPinchStartBlockPx = MACRO_MAP_DEFAULT_BLOCK_PX;

macroMapScrollEl.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length === 2) {
      macroPinchStartDistance = touchDistance(event.touches);
      macroPinchStartBlockPx = macroMapView.currentBlockPx();
    }
  },
  { passive: true }
);
macroMapScrollEl.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length !== 2 || macroPinchStartDistance === undefined || !macroWorld) return;
    event.preventDefault();
    macroMapView.zoomTo(macroWorld, macroPinchStartBlockPx, touchDistance(event.touches) / macroPinchStartDistance);
  },
  { passive: false }
);
macroMapScrollEl.addEventListener(
  "touchend",
  (event) => {
    if (event.touches.length < 2) macroPinchStartDistance = undefined;
  },
  { passive: true }
);

/** Keeps the toggle button's label/style in sync with `autoCamera.isEnabled()` — needed both from the button's own click handler and from clicking a passive engagement box (which can turn Auto Camera on without going through the button at all). */
function syncAutoCamToggleButton(): void {
  autoCamToggleBtn.textContent = `Auto Camera: ${autoCamera.isEnabled() ? "On" : "Off"}`;
  autoCamToggleBtn.classList.toggle("playing", autoCamera.isEnabled());
  if (!autoCamera.isEnabled()) autoCamStatusEl.textContent = "";
}

autoCamToggleBtn.addEventListener("click", () => {
  autoCamera.setEnabled(!autoCamera.isEnabled());
  syncAutoCamToggleButton();
});

/**
 * Overworld mode has two views — the macro map and the focused zone's tile
 * view — but only room to show one well at a time (direct ask, after first
 * shipping them stacked: "they are competing too much... I want one map on
 * the screen at a time", then a direct follow-up to make desktop match the
 * mobile-only version of that fix: "let's make desktop match mobile, where
 * the whole map is either overworld or zone"). Direct UX-redesign follow-up:
 * the header's old single button (relabeling itself "Show Zone View" /
 * "Show Overworld") became a real two-button segmented control
 * (`mapModeZoneBtn`/`mapModeOverworldBtn`) so both states are visible at
 * once instead of only ever showing the NEXT state — plus a corner
 * mini-map widget (`minimapButton`) offering the same swap right on the map
 * itself. All three call this one function.
 *
 * `.force-hide` (not the plain `hidden` attribute) is what actually hides
 * either wrap: both set an unconditional `display: flex` of their own, an
 * author rule that always outranks the browser's default `[hidden]` styling
 * regardless of selector specificity, so only an `!important` class reliably
 * wins here.
 */
type OverworldSubView = "overworld" | "zone";
let overworldSubView: OverworldSubView = "overworld";

/**
 * Names the land under the zone view — direct ask: "the name of the region
 * like bright coast should be prominently displayed somewhere, maybe right
 * above the play bar."
 *
 * Read live from `world.territoryName` every frame rather than set once when
 * a zone loads: promoting a different zone swaps `world` wholesale, and a
 * banner updated at load time would have to be re-poked from every one of
 * those paths. One string comparison a frame is cheaper than that coupling.
 *
 * Hidden, not blanked, when there is no name — the macro map has its own
 * territory labels drawn on it (macroMap.ts) so a second floating name there
 * would be redundant, and a plain non-overworld world has no territories at
 * all.
 */
let lastRegionBannerText = "";
function refreshRegionBanner(): void {
  const name = overworldSubView === "zone" ? world.territoryName : undefined;
  const text = name ?? "";
  if (text !== lastRegionBannerText) {
    lastRegionBannerText = text;
    regionBannerEl.textContent = text;
  }
  regionBannerEl.hidden = text === "";
}

/**
 * Native-resolution target for the corner widget's overworld preview canvas
 * — a real 2x-ish oversample of the 108x78 CSS box (the CSS below lets
 * `image-rendering: pixelated` do the final crisp scale-down/up, same
 * "draw at native res, let CSS handle it" convention `overworldMap.ts`'s
 * own region thumbnail already uses), computed against the REAL macro
 * grid's `cols`/`rows` rather than a fixed block size — a huge grid still
 * produces exactly this many canvas pixels, never an oversized draw.
 */
const MINIMAP_OVERWORLD_TARGET_W = 216;
const MINIMAP_OVERWORLD_TARGET_H = 156;

/**
 * Redraws the corner mini-map widget's two previews from real live data —
 * see this widget's own CSS doc comment (index.html) for the bug this
 * replaces (a purely decorative static texture). Cheap: both canvases are
 * tiny, and `drawMacroMap`'s per-zone `fillRect` cost is bounded by
 * `MINIMAP_OVERWORLD_TARGET_W/H` regardless of how large the real macro
 * grid is (see that constant's own doc comment).
 */
function renderMinimapWidget(): void {
  if (world) drawRegionThumbnail(minimapArtZone, world);
  if (!macroWorld) return;
  const { grid } = macroWorld;
  const blockPx = Math.max(0.05, Math.min(MINIMAP_OVERWORLD_TARGET_W / grid.cols, MINIMAP_OVERWORLD_TARGET_H / grid.rows));
  drawMacroMap(minimapOverworldCanvas, macroWorld, blockPx);

  // Highlights the real focused zone's position within the overworld
  // preview — computed from the actual grid coordinates, not a fixed guess.
  const [rowStr, colStr] = macroWorld.focusedKey.split(",");
  const row = Number(rowStr);
  const col = Number(colStr);
  minimapMarkerEl.style.left = `${(col / grid.cols) * 100}%`;
  minimapMarkerEl.style.top = `${(row / grid.rows) * 100}%`;
  minimapMarkerEl.style.width = `${Math.max(100 / grid.cols, 3)}%`;
  minimapMarkerEl.style.height = `${Math.max(100 / grid.rows, 3)}%`;
}

function applyOverworldSubView(view: OverworldSubView): void {
  overworldSubView = view;
  canvasWrap.classList.toggle("force-hide", view === "overworld");
  macroMapWrapEl.classList.toggle("force-hide", view === "zone");
  mapModeZoneBtn.classList.toggle("playing", view === "zone");
  mapModeOverworldBtn.classList.toggle("playing", view === "overworld");
  // The mini-map widget offers a jump to whichever view ISN'T showing —
  // its own thumbnail/caption always describe the destination, not the
  // current view.
  minimapArtZone.hidden = view === "zone";
  minimapArtOverworld.hidden = view !== "zone";
  renderMinimapWidget();
  minimapCaption.textContent = view === "zone" ? "overworld" : "focused zone";
}

/**
 * The "enabling" half of the overworld-toggle click handler, pulled out so
 * boot can reuse it directly instead of simulating a click — direct ask:
 * "make the default view just overworld on, zone view show... the dual
 * view is useless." Overworld mode (the macro grid, migration, the whole
 * region system) is now on from the very first frame, no manual toggle
 * needed, landing straight on the focused zone's own tile view (`subView`
 * lets boot ask for "zone" specifically) rather than the more abstract
 * macro map — that's the one detailed, actually-useful view per the direct
 * ask, with the macro map still one click away via the segmented switch or
 * the mini-map widget for whenever the big picture is what's wanted instead.
 */
function enterOverworldMode(seed: number, subView: OverworldSubView): void {
  macroMapWrapEl.hidden = false;
  mapModeSwitchEl.hidden = false;
  minimapWidgetEl.hidden = false;
  overworldToggleBtn.textContent = "Overworld: On";
  overworldToggleBtn.classList.add("playing");
  applyOverworldSubView(subView);
  loadMacroWorld(seed);
}

overworldToggleBtn.addEventListener("click", () => {
  const enabling = !macroWorld;
  if (enabling) {
    // Fresh entry into Overworld mode via the manual toggle always defaults
    // to the macro map, rather than carrying over a stale sub-view choice
    // from a previous session in this mode — boot's own default (see
    // `enterOverworldMode`'s call below) is a separate, deliberate choice.
    enterOverworldMode(SCENARIO_SEED, "overworld");
  } else {
    // Leaving Overworld mode entirely — canvas-wrap is the only view in
    // ordinary single-map mode, so nothing here may leave it (or the now-
    // irrelevant macro map) force-hidden.
    macroMapWrapEl.hidden = true;
    mapModeSwitchEl.hidden = true;
    minimapWidgetEl.hidden = true;
    overworldToggleBtn.textContent = "Overworld: Off";
    overworldToggleBtn.classList.remove("playing");
    canvasWrap.classList.remove("force-hide");
    macroMapWrapEl.classList.remove("force-hide");
    loadWorld(SCENARIO_SEED);
  }
  moreMenuEl.classList.remove("open");
});

mapModeZoneBtn.addEventListener("click", () => applyOverworldSubView("zone"));
mapModeOverworldBtn.addEventListener("click", () => applyOverworldSubView("overworld"));
minimapButton.addEventListener("click", () => applyOverworldSubView(overworldSubView === "zone" ? "overworld" : "zone"));

macroMapZoomInBtn.addEventListener("click", () => {
  if (macroWorld) macroMapView.zoomIn(macroWorld);
});
macroMapZoomOutBtn.addEventListener("click", () => {
  if (macroWorld) macroMapView.zoomOut(macroWorld);
});

// Same Google Maps-style cursor-anchored wheel zoom as the tile view above,
// reusing `zoomAtPoint` — `zoomTo`'s ratio parameter (built for the pinch
// gesture's absolute start/current distance ratio) doubles perfectly as a
// per-notch relative factor here: `currentBlockPx() * factor` is exactly
// "the new size relative to right now."
macroMapScrollEl.addEventListener(
  "wheel",
  (event) => {
    if (!macroWorld) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
    zoomAtPoint(macroMapScrollEl, macroMapCanvas, event.clientX, event.clientY, () => macroMapView.zoomTo(macroWorld!, macroMapView.currentBlockPx(), factor));
  },
  { passive: false }
);

// --- Boot --------------------------------------------------------------------

const seedParam = new URLSearchParams(location.search).get("seed");
const initialSeed = seedParam !== null && seedParam !== "" ? Number(seedParam) : SCENARIO_SEED;
// Direct ask: "make the default view just overworld on, zone view show" —
// boots straight into Overworld mode's focused-zone tile view instead of
// the old flat single-map default (see `enterOverworldMode`'s own doc
// comment for the reasoning). The plain `loadWorld` path (no macro grid at
// all) is still reachable any time via the "Overworld: Off" toggle.
const playerParam = new URLSearchParams(location.search).get("player");
if (playerParam === "1" || playerParam === "cave") {
  // ROADMAP.md M0 (?player=1, surface) and M1 (?player=cave). No macro grid.
  const bootSeed = Number.isFinite(initialSeed) ? initialSeed : SCENARIO_SEED;
  const bootScene = playerParam === "cave" ? "cave" : "surface";
  // Load the generated world first so the game is playable immediately, then
  // swap in a saved run if one turns out to match. Waiting on the (async)
  // decompress before showing anything would put a blank screen in front of
  // every player, including the majority who have no save at all.
  loadPlayerWorld(bootSeed, bootScene);
  void loadRun().then((restored) => {
    // Only a save of the same scenario AND seed may take over: changing the
    // seed in the URL is how you deliberately ask for a different world, and
    // silently resurrecting the old one would ignore that.
    if (!restored || restored.meta.scenario !== bootScene || restored.meta.seed !== bootSeed) return;
    loadPlayerWorld(bootSeed, bootScene, restored);
  });
} else {
  enterOverworldMode(Number.isFinite(initialSeed) ? initialSeed : SCENARIO_SEED, "zone");
}
speedLabel.textContent = `${SPEED_STEPS[speedIndex]}x`;

// Dev-server only: lets a Playwright check read the real world (positions,
// the player's vision set) instead of scraping the inspector's text, which
// only shows the selected agent. Not shipped in the production build.
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  (window as unknown as { __pokuelike: unknown }).__pokuelike = {
    get world() {
      return world;
    },
    /** The dominant biome at a tile — the renderer picks ground art and scatter decals by this, so an art check needs to be able to ask for it. */
    biomeAt(x: number, y: number): string | undefined {
      const weights = biomeWeightsAt(world.biomeSeeds, x, y);
      let best: string | undefined;
      let bestWeight = 0;
      for (const [name, weight] of Object.entries(weights)) {
        if (weight > bestWeight) {
          bestWeight = weight;
          best = name;
        }
      }
      return best;
    },
  };
}

function frame(): void {
  // Run before drawWorld (was after) so this frame's highlight box below
  // reflects the engagement autoCamera just decided on, not last frame's —
  // update() itself doesn't depend on anything drawWorld does. `playing`
  // gates autoCamera's own real-time epilogue expiry — direct report: "it
  // loses focus after a while [while paused]" — see update's own doc
  // comment (autoCamera.ts) for the root cause.
  autoCamera.update(world, playing);
  const engagement = autoCamera.currentEngagement();
  // Direct ask: "on desktop [auto cam] is a bit too wide to know whats
  // going on... draw a box around it" — see drawAutoCamHighlight's own doc
  // comment (renderer.ts) for why a box scales better across viewport sizes
  // than retuning the fixed zoom level would. `listBattleEngagements()` is
  // the follow-up ask ("draw the yellow bounding box anyways on all cool
  // events happening around the map") — every other currently-tracked
  // battle, shown dimmer, clickable (see the canvas click handler above).
  refreshRegionBanner();
  // Tell the renderer what is actually on screen before it draws. The canvas
  // is the whole world (TILE_SIZE per tile) and `#canvas-wrap` scrolls it
  // while CSS scales it by `zoom`, so without this every frame paints all of
  // a 90x60 map to show a fraction of it.
  setVisibleRect({
    left: canvasWrap.scrollLeft / zoom,
    top: canvasWrap.scrollTop / zoom,
    width: canvasWrap.clientWidth / zoom,
    height: canvasWrap.clientHeight / zoom,
  });
  drawWorld(
    ctx,
    world,
    selectedAgentId,
    renderStyle,
    engagement?.ids,
    autoCamera.listBattleEngagements().map((e) => e.ids),
    moveEffects.jigglingAgentIds(),
    focusGroupIds(),
    viewLayer()
  );
  drawTargetPreview(ctx, targetPreviewTiles);
  drawEventPopups(ctx, eventPopups.active());
  drawMoveFlashes(ctx, moveEffects.activeFlashes());
  const autoCamText = autoCamera.currentLabel() ?? (autoCamera.isEnabled() ? "watching…" : "");
  autoCamStatusEl.textContent = autoCamText;
  autoCamBadgeEl.hidden = autoCamText === "";
  battleScreenPanel.setActive(engagement);
  maybeAutoSwitchTab();
  battleScreenPanel.render(world);
  eventLogPanel.render();
  if (playerMode) {
    renderPartySection();
    actionLogPanel.render();
    renderEventTicker();
  }
  // Reads the full log rather than the incremental slice — a chronicle is a
  // whole-run summary. It throttles itself and no-ops entirely while its tab
  // is hidden, so this is cheap on every other frame.
  chroniclePanel.render(world, log.events);
  refreshSelection();
  // Not forced — macroMapView.render internally throttles redraws (see its
  // own doc comment) since the macro grid's data doesn't change fast enough
  // to justify a full redraw every animation frame at real grid scale.
  if (macroWorld) macroMapView.render(macroWorld);
  // Same "doesn't need every-frame freshness" reasoning as macroMapView
  // above — both of the widget's previews are of the view the viewer ISN'T
  // currently looking at, so a modest lag between real state and this tiny
  // corner preview is unnoticeable, and self-throttling here keeps a big
  // macro grid's `drawMacroMap` cost off the hot per-frame path.
  if (!minimapWidgetEl.hidden && performance.now() - lastMinimapWidgetRenderAt >= MINIMAP_WIDGET_RENDER_THROTTLE_MS) {
    lastMinimapWidgetRenderAt = performance.now();
    renderMinimapWidget();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
