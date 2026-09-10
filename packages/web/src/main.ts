import { EventLog, tickWorld, tickMacroWorld, tickHerds, setFocusedZone, findRegion, randomSeed, type Agent, type MacroWorld, type Vec2, type World, advancePlayerTurn, findPlayer, examine, nextTravelStep, visibleAgentIds, type PlayerAction, type Layer } from "@pokuelike/engine";
import { createCaveScenario, createDemoWorld, createDemoMacroWorld, createPlayerDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, SCENARIO_SEED, SPECIES } from "@pokuelike/data";
import { agentAtCanvasPos, drawEventPopups, drawMoveFlashes, drawWorld, highlightBounds, TILE_SIZE, type RenderStyle } from "./renderer.js";
import { eventNamesAgent, formatEvent } from "./eventText.js";
import { EventLogPanel } from "./eventLogPanel.js";
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
const SPEED_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;
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
const chipHideNoise = document.getElementById("chip-hide-noise") as HTMLElement;
const chipHideLevelUps = document.getElementById("chip-hide-levelups") as HTMLElement;
const chipHeadlinesOnly = document.getElementById("chip-headlines-only") as HTMLElement;
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
const gameOverCauseEl = document.getElementById("game-over-cause") as HTMLElement;
const gameOverStatsEl = document.getElementById("game-over-stats") as HTMLElement;

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
let lastLoggedEventCount = 0;
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

function focusCameraOn(pos: Vec2): void {
  setZoom(AUTO_CAM_ZOOM);
  const targetLeft = Math.max(0, (pos.x + 0.5) * TILE_SIZE * zoom - canvasWrap.clientWidth / 2);
  const targetTop = Math.max(0, (pos.y + 0.5) * TILE_SIZE * zoom - canvasWrap.clientHeight / 2);
  autoCamLastScroll = { left: targetLeft, top: targetTop };
  canvasWrap.scrollLeft = targetLeft;
  canvasWrap.scrollTop = targetTop;
}

const autoCamHost: AutoCameraHost = {
  captureHomeView(): void {
    autoCamHomeView = { zoom, scrollLeft: canvasWrap.scrollLeft, scrollTop: canvasWrap.scrollTop };
  },
  focusOn(pos: Vec2): void {
    focusCameraOn(pos);
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
  applyZoom();

  eventLogPanel.reset();
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
function loadPlayerWorld(seed: number, scene: "surface" | "cave" = "surface"): void {
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
  world = scene === "cave" ? createCaveScenario(seed) : createPlayerDemoWorld(seed);
  playerScene = scene;
  playerSeed = seed;
  playerDead = false;
  log = new EventLog();
  registerHerdsForFirstFrame();
  resetUiForNewWorld();
  seedInput.value = String(seed);
  seedChipLabel.textContent = String(seed);
  const player = findPlayer(world);
  if (player) {
    selectAgent(player);
    focusCameraOn(player.pos);
  }
  gameOverEl.hidden = true;
  playerHudEl.hidden = false;
  document.body.classList.add("player-mode");
  cancelTravel();
  hudMessageEl.textContent = scene === "cave" ? "It is dark. There is light somewhere. Tap a tile to walk." : "";
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
  playerHudEl.hidden = true;
  gameOverEl.hidden = true;
  document.body.classList.remove("player-mode");
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
  const outcome = player.lastActionOutcome;
  if (outcome && outcome.tick === world.tick) hudMessageEl.textContent = outcomeText(outcome.action.kind, outcome.ok);
}

/** Plain sentences for what the last key did. If the verb failed, say what was missing. */
function outcomeText(kind: PlayerAction["kind"], ok: boolean): string {
  switch (kind) {
    case "move":
      return ok ? "" : "Something is in the way.";
    case "wait":
      return "You wait.";
    case "eat":
      return ok ? "You eat." : "Nothing to eat here. Stand on a berry patch.";
    case "drink":
      return ok ? "You drink." : "No water within reach.";
  }
}

/**
 * The death screen. The cause is the last logged event that names the
 * player — `starved`, `killed`, whichever — in the log's own words, so the
 * screen says why, not just that.
 */
function showGameOver(playerId: string): void {
  playerDead = true;
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
  advancePlayerTurn(world, action, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
  afterTick();
  focusCameraOn(player.pos);
  renderPlayerHud();
  if (!findPlayer(world)) showGameOver(player.id);
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
};

window.addEventListener("keydown", (e) => {
  if (!playerMode) return;
  // Typing in the seed box or any input must not walk the player.
  if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
  cancelTravel();
  if (playerDead) {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      loadPlayerWorld(playerSeed, playerScene);
    }
    return;
  }
  if (e.key === "x") {
    e.preventDefault();
    examineNext();
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
  eventLogPanel.ingest(displayEvents, world);
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
    hudMessageEl.textContent = "You do not know a way there.";
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
      if (player.pos.x !== target.x || player.pos.y !== target.y) hudMessageEl.textContent = "You can go no further.";
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
        hudMessageEl.textContent = who ? `You stop. ${examine(world, who, { observer: after, name: (k) => SPECIES[k]?.name ?? k })}` : "You stop.";
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
document.querySelectorAll<HTMLButtonElement>("#hud-pad button").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!playerMode || playerDead) return;
    cancelTravel();
    const act = btn.dataset.act;
    if (act === "look") examineNext();
    else if (act === "wait" || act === "eat" || act === "drink") playerAct({ kind: act });
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
    hudMessageEl.textContent = "You see no one.";
    return;
  }
  const i = seen.findIndex((a) => a.id === selectedAgentId);
  const next = seen[(i + 1) % seen.length]!;
  selectAgent(next);
  hudMessageEl.textContent = examine(world, next, { observer: me, name: (id) => SPECIES[id]?.name ?? id });
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

type PanelTab = "inspector" | "battle-screen" | "chronicle" | "events";
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
  inspector: tabInspectorBtn,
  "battle-screen": tabBattleScreenBtn,
  chronicle: tabChronicleBtn,
  events: tabEventsBtn,
};
const TAB_PAGES: Record<PanelTab, HTMLElement> = {
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

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
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
    // Tapping a creature in Play mode is the examine verb (free, no tick).
    const me = playerMode ? findPlayer(world) : undefined;
    if (me && agent.id !== me.id) hudMessageEl.textContent = examine(world, agent, { observer: me, name: (id) => SPECIES[id]?.name ?? id });
    return;
  }
  // Play mode: tapping a tile walks there — direct ask: "I can't play at all
  // on mobile. Can you allow a click based control scheme?" See travelTo.
  if (playerMode && !playerDead) {
    travelTo({ x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) });
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
// Reflect each checkbox's own `checked` default (both "on" checkboxes are
// checked by default in index.html) the moment the page loads, not just on
// the next manual toggle.
syncChip(hideNoiseCheckbox, chipHideNoise);
syncChip(hideLevelUpsCheckbox, chipHideLevelUps);
syncChip(headlinesOnlyCheckbox, chipHeadlinesOnly);

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
  loadPlayerWorld(Number.isFinite(initialSeed) ? initialSeed : SCENARIO_SEED, playerParam === "cave" ? "cave" : "surface");
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
  drawEventPopups(ctx, eventPopups.active());
  drawMoveFlashes(ctx, moveEffects.activeFlashes());
  const autoCamText = autoCamera.currentLabel() ?? (autoCamera.isEnabled() ? "watching…" : "");
  autoCamStatusEl.textContent = autoCamText;
  autoCamBadgeEl.hidden = autoCamText === "";
  battleScreenPanel.setActive(engagement);
  maybeAutoSwitchTab();
  battleScreenPanel.render(world);
  eventLogPanel.render();
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
