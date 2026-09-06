import { EventLog, tickWorld, tickMacroWorld, setFocusedZone, findRegion, randomSeed, type Agent, type MacroWorld, type Vec2, type World } from "@pokuelike/engine";
import { createDemoWorld, createDemoMacroWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT, SCENARIO_SEED } from "@pokuelike/data";
import { agentAtCanvasPos, drawEventPopups, drawWorld, highlightBounds, TILE_SIZE, type RenderStyle } from "./renderer.js";
import { EventLogPanel } from "./eventLogPanel.js";
import { EventPopups } from "./eventPopups.js";
import { renderInspector } from "./inspector.js";
import { renderLegend } from "./legend.js";
import { AutoCameraController, type AutoCameraHost } from "./autoCamera.js";
import { BattleScreenPanel } from "./battleScreenPanel.js";
import { MacroMapView, MACRO_MAP_DEFAULT_BLOCK_PX } from "./macroMap.js";

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
 */
const BATTLE_STEP_INTERVAL_MS = 650;

// --- DOM references -------------------------------------------------------

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const canvasWrap = document.getElementById("canvas-wrap") as HTMLElement;
const ctx = canvas.getContext("2d")!;
const seedInput = document.getElementById("seed-input") as HTMLInputElement;
const loadSeedBtn = document.getElementById("load-seed") as HTMLButtonElement;
const randomSeedBtn = document.getElementById("random-seed") as HTMLButtonElement;
const copySeedBtn = document.getElementById("copy-seed") as HTMLButtonElement;
const playPauseBtn = document.getElementById("play-pause") as HTMLButtonElement;
const stepBtn = document.getElementById("step") as HTMLButtonElement;
const speedSlider = document.getElementById("speed") as HTMLInputElement;
const speedLabel = document.getElementById("speed-label") as HTMLElement;
const tickLabel = document.getElementById("tick-label") as HTMLElement;
const clockLabel = document.getElementById("clock-label") as HTMLElement;
const eventLogEl = document.getElementById("event-log") as HTMLElement;
const inspectorEl = document.getElementById("inspector") as HTMLElement;
const clearSelectionBtn = document.getElementById("clear-selection") as HTMLButtonElement;
const expandPanelBtn = document.getElementById("expand-panel") as HTMLButtonElement;
const inspectorPanelEl = document.getElementById("inspector-panel") as HTMLElement;
const hideNoiseCheckbox = document.getElementById("hide-noise") as HTMLInputElement;
const hideLevelUpsCheckbox = document.getElementById("hide-levelups") as HTMLInputElement;
const headlinesOnlyCheckbox = document.getElementById("headlines-only") as HTMLInputElement;
const styleTileBtn = document.getElementById("style-tile") as HTMLButtonElement;
const styleAsciiBtn = document.getElementById("style-ascii") as HTMLButtonElement;
const legendEl = document.getElementById("legend") as HTMLElement;
const toggleLegendBtn = document.getElementById("toggle-legend") as HTMLButtonElement;
const sidebarEl = document.getElementById("sidebar") as HTMLElement;
const drawerBackdrop = document.getElementById("drawer-backdrop") as HTMLElement;
const toggleDrawerBtn = document.getElementById("toggle-drawer") as HTMLButtonElement;
const zoomOutBtn = document.getElementById("zoom-out") as HTMLButtonElement;
const zoomInBtn = document.getElementById("zoom-in") as HTMLButtonElement;
const zoomLabel = document.getElementById("zoom-label") as HTMLElement;
const autoCamToggleBtn = document.getElementById("auto-cam-toggle") as HTMLButtonElement;
const autoCamStatusEl = document.getElementById("auto-cam-status") as HTMLElement;
const battleScreenEl = document.getElementById("battle-screen") as HTMLElement;
const tabInspectorBtn = document.getElementById("tab-inspector") as HTMLButtonElement;
const tabBattleScreenBtn = document.getElementById("tab-battle-screen") as HTMLButtonElement;

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
const macroViewToggleBtn = document.getElementById("macro-view-toggle") as HTMLButtonElement;
const macroMapView = new MacroMapView(macroMapCanvas, macroMapZoomLabel, focusZone);
let log: EventLog;
let playing = false;
let speedIndex = DEFAULT_SPEED_INDEX;
let intervalId: number | undefined;
/** True while a battle owns ticking via its own fixed `BATTLE_STEP_INTERVAL_MS` cadence instead of the ordinary speed slider — see `scheduleLoop` and the `enterBattleStep`/`exitBattleStep` host methods below. */
let battleStepMode = false;
let selectedAgentId: string | undefined;
let lastLoggedEventCount = 0;
let inspectorDirty = true;
let renderStyle: RenderStyle = "ascii";
let zoom = DEFAULT_ZOOM;

const eventLogPanel = new EventLogPanel(eventLogEl);
const battleScreenPanel = new BattleScreenPanel(battleScreenEl);
const eventPopups = new EventPopups();

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
  },
  exitBattleStep(): void {
    if (!battleStepMode) return;
    battleStepMode = false;
    scheduleLoop();
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
  renderInspector(inspectorEl, undefined, world);
  tabManualOverrideForBattleSeq = undefined;
  lastAutoSwitchedBattleSeq = undefined;
  selectTab("inspector", false);
  updateStatusLabels();
}

function loadWorld(seed: number): void {
  macroWorld = undefined;
  world = createDemoWorld(seed);
  log = new EventLog();
  resetUiForNewWorld();

  seedInput.value = String(seed);
  const url = new URL(location.href);
  url.searchParams.set("seed", String(seed));
  history.replaceState(null, "", url);
}

/** Direct ask: "I want to be able to see the overworld stuff... visualize overworld." See macroMap.ts for the single pannable/zoomable canvas this drives. */
function loadMacroWorld(): void {
  macroWorld = createDemoMacroWorld();
  world = findRegion(macroWorld, macroWorld.focusedKey)!.world!;
  log = new EventLog();
  resetUiForNewWorld();
  macroMapView.render(macroWorld, true);
}

/** The macro grid's own promotion/demotion transition, triggered by clicking a zone on the macro map — see macroMap.ts. A no-op if `(row, col)` is out of the grid's bounds (macroMap.ts's click handler doesn't itself bounds-check). */
function focusZone(row: number, col: number): void {
  if (!macroWorld) return;
  setFocusedZone(macroWorld, row, col, IMMIGRATION_CONTEXT, log);
  world = findRegion(macroWorld, macroWorld.focusedKey)!.world!;
  resetUiForNewWorld();
  macroMapView.render(macroWorld, true);
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
  autoCamera.ingest(displayEvents, world);
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
  playPauseBtn.textContent = playing ? "Pause" : "Play";
  playPauseBtn.classList.toggle("playing", playing);
  scheduleLoop();
}

// --- Selection / inspector ---------------------------------------------------

function selectAgent(agent: Agent | undefined): void {
  selectedAgentId = agent?.id;
  eventLogPanel.setFilter(selectedAgentId);
  inspectorDirty = true;
}

function refreshSelection(): void {
  if (!inspectorDirty) return;
  inspectorDirty = false;
  const agent = selectedAgentId ? world.agents.find((a) => a.id === selectedAgentId) : undefined;
  renderInspector(inspectorEl, agent, world);
}

// --- Inspector / Battle Screen tabs -----------------------------------------
// Battle Screen used to be its own docked panel; direct follow-up ask: it
// "obscures the map," so it now shares the Inspector panel's footprint as a
// second tab instead (see index.html's `#inspector-panel` markup). Both
// `renderInspector`/`BattleScreenPanel` keep rendering into their own
// `#inspector`/`#battle-screen` divs exactly as before — this is purely a
// thin visibility switch over the two, the same `[hidden]` convention the
// drawer/legend toggles already use.

type PanelTab = "inspector" | "battle-screen";
let activeTab: PanelTab = "inspector";
/**
 * The `seq` of the battle engagement the viewer last manually switched away
 * from Battle Screen *during* (back to Inspector) — mirrors
 * `AutoCameraController`'s own `viewerTookOver` sticky-override pattern:
 * auto-switching won't re-steal the tab back for *this* battle, but a
 * genuinely new battle (a different seq) is a fresh thing to show and earns
 * the auto-switch back. `undefined` when there's no active override.
 */
let tabManualOverrideForBattleSeq: number | undefined;
/** The `seq` of the battle engagement auto-switch has already acted on — so a battle that's still ongoing next frame doesn't keep re-triggering the switch (which would also stomp a manual switch back to Inspector on every single frame). */
let lastAutoSwitchedBattleSeq: number | undefined;

function selectTab(tab: PanelTab, manual: boolean): void {
  activeTab = tab;
  inspectorEl.hidden = tab !== "inspector";
  battleScreenEl.hidden = tab !== "battle-screen";
  clearSelectionBtn.hidden = tab !== "inspector"; // "Clear [selection]" only means anything on the Inspector tab
  tabInspectorBtn.classList.toggle("playing", tab === "inspector");
  tabInspectorBtn.setAttribute("aria-selected", String(tab === "inspector"));
  tabBattleScreenBtn.classList.toggle("playing", tab === "battle-screen");
  tabBattleScreenBtn.setAttribute("aria-selected", String(tab === "battle-screen"));

  if (!manual) return;
  // A deliberate click always wins over auto-switch's own bookkeeping — see
  // the two fields' doc comments above.
  const battleSeq = autoCamera.currentEngagement()?.category === "battle" ? autoCamera.currentEngagement()!.seq : undefined;
  if (tab === "inspector" && battleSeq !== undefined) {
    tabManualOverrideForBattleSeq = battleSeq;
  } else if (tab === "battle-screen") {
    tabManualOverrideForBattleSeq = undefined;
  }
}

tabInspectorBtn.addEventListener("click", () => selectTab("inspector", true));
tabBattleScreenBtn.addEventListener("click", () => selectTab("battle-screen", true));

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
  if (!engagement || engagement.category !== "battle") return;
  if (engagement.seq === lastAutoSwitchedBattleSeq) return;
  lastAutoSwitchedBattleSeq = engagement.seq;
  if (engagement.seq === tabManualOverrideForBattleSeq) return;
  if (activeTab !== "battle-screen") selectTab("battle-screen", false);
}

// --- Wiring ------------------------------------------------------------------

loadSeedBtn.addEventListener("click", () => {
  const value = Number(seedInput.value);
  if (!Number.isFinite(value)) return;
  loadWorld(value);
});

randomSeedBtn.addEventListener("click", () => {
  loadWorld(randomSeed());
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
  // Direct ask: "draw the yellow bounding box anyways on all cool events
  // happening around the map, and clicking in it enters auto cam just for
  // that one event" — checked before the ordinary agent-select hit test
  // below, since a click inside one of these (deliberately larger than a
  // single tile) boxes is clearly "I want that fight," not "I want to
  // inspect whichever agent happens to be under my exact tap."
  for (const engagement of autoCamera.listBattleEngagements()) {
    const bounds = highlightBounds(world, engagement.ids);
    if (bounds && x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
      autoCamera.focusEngagement(engagement.seq);
      syncAutoCamToggleButton();
      return;
    }
  }
  const agent = agentAtCanvasPos(world, x, y);
  selectAgent(agent);
});

clearSelectionBtn.addEventListener("click", () => selectAgent(undefined));

// Direct ask: "the actual battle log... needs to be scrollable on mobile.
// Or more expandable." The real scroll bug is fixed in CSS
// (-webkit-overflow-scrolling: touch); this is the "more expandable" half —
// a much taller reading mode for the Inspector/Battle Screen panel, toggled
// on demand rather than always eating that much vertical space.
expandPanelBtn.addEventListener("click", () => {
  const expanded = inspectorPanelEl.classList.toggle("panel-expanded");
  expandPanelBtn.classList.toggle("playing", expanded);
});

hideNoiseCheckbox.addEventListener("change", () => {
  eventLogPanel.setHideNoise(hideNoiseCheckbox.checked);
  eventLogPanel.render();
});

hideLevelUpsCheckbox.addEventListener("change", () => {
  eventLogPanel.setHideLevelUps(hideLevelUpsCheckbox.checked);
  eventLogPanel.render();
});

headlinesOnlyCheckbox.addEventListener("change", () => {
  eventLogPanel.setHeadlinesOnly(headlinesOnlyCheckbox.checked);
  eventLogPanel.render();
});

function setRenderStyle(style: RenderStyle): void {
  renderStyle = style;
  styleTileBtn.classList.toggle("playing", style === "tile");
  styleAsciiBtn.classList.toggle("playing", style === "ascii");
}
styleTileBtn.addEventListener("click", () => setRenderStyle("tile"));
styleAsciiBtn.addEventListener("click", () => setRenderStyle("ascii"));

renderLegend(legendEl);
toggleLegendBtn.addEventListener("click", () => {
  const hidden = legendEl.hidden;
  legendEl.hidden = !hidden;
  toggleLegendBtn.textContent = hidden ? "Hide" : "Show";
});

// Legend + event log live in a drawer that floats over the canvas from the
// right (see index.html/#sidebar) — closed by default so a narrow/mobile
// viewport isn't permanently missing canvas width to a docked sidebar.
function setDrawerOpen(open: boolean): void {
  sidebarEl.classList.toggle("open", open);
  drawerBackdrop.classList.toggle("open", open);
}
toggleDrawerBtn.addEventListener("click", () => setDrawerOpen(!sidebarEl.classList.contains("open")));
drawerBackdrop.addEventListener("click", () => setDrawerOpen(false));

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

/** Overworld mode stacks the macro map above the focused zone's tile view — fine on desktop, cramped on a phone (direct ask: they were "competing too much on mobile"). `macro-view-toggle` (only visible inside `#macro-map-wrap`, so already hidden outside Overworld mode) lets the viewer hide the tile view and give the macro map the full area instead, then bring it back. */
function setOverworldOnly(only: boolean): void {
  canvasWrap.hidden = only;
  macroViewToggleBtn.textContent = only ? "Show Both" : "Overworld Only";
}

overworldToggleBtn.addEventListener("click", () => {
  const enabling = !macroWorld;
  // The seed controls don't mean anything in Overworld mode (the macro grid
  // has its own seed — see overworldScenario.ts's createDemoMacroWorld) —
  // disabled rather than left to silently drop the viewer out of Overworld
  // mode if clicked.
  seedInput.disabled = enabling;
  loadSeedBtn.disabled = enabling;
  randomSeedBtn.disabled = enabling;
  macroMapWrapEl.hidden = !enabling;
  overworldToggleBtn.textContent = `Overworld: ${enabling ? "On" : "Off"}`;
  overworldToggleBtn.classList.toggle("playing", enabling);
  // Reset to "both visible" (the default either way) whether entering a
  // fresh Overworld session or leaving it back to ordinary single-map mode —
  // canvas-wrap is the only view there, so it must never stay hidden from a
  // stale "Overworld Only" choice left over from a previous session.
  setOverworldOnly(false);
  if (enabling) loadMacroWorld();
  else loadWorld(SCENARIO_SEED);
});

macroViewToggleBtn.addEventListener("click", () => {
  setOverworldOnly(!canvasWrap.hidden);
});

macroMapZoomInBtn.addEventListener("click", () => {
  if (macroWorld) macroMapView.zoomIn(macroWorld);
});
macroMapZoomOutBtn.addEventListener("click", () => {
  if (macroWorld) macroMapView.zoomOut(macroWorld);
});

// --- Boot --------------------------------------------------------------------

const seedParam = new URLSearchParams(location.search).get("seed");
const initialSeed = seedParam !== null && seedParam !== "" ? Number(seedParam) : SCENARIO_SEED;
loadWorld(Number.isFinite(initialSeed) ? initialSeed : SCENARIO_SEED);
speedLabel.textContent = `${SPEED_STEPS[speedIndex]}x`;

function frame(): void {
  // Run before drawWorld (was after) so this frame's highlight box below
  // reflects the engagement autoCamera just decided on, not last frame's —
  // update() itself doesn't depend on anything drawWorld does.
  autoCamera.update(world);
  const engagement = autoCamera.currentEngagement();
  // Direct ask: "on desktop [auto cam] is a bit too wide to know whats
  // going on... draw a box around it" — see drawAutoCamHighlight's own doc
  // comment (renderer.ts) for why a box scales better across viewport sizes
  // than retuning the fixed zoom level would. `listBattleEngagements()` is
  // the follow-up ask ("draw the yellow bounding box anyways on all cool
  // events happening around the map") — every other currently-tracked
  // battle, shown dimmer, clickable (see the canvas click handler above).
  drawWorld(
    ctx,
    world,
    selectedAgentId,
    renderStyle,
    engagement?.ids,
    autoCamera.listBattleEngagements().map((e) => e.ids)
  );
  drawEventPopups(ctx, eventPopups.active());
  autoCamStatusEl.textContent = autoCamera.currentLabel() ?? (autoCamera.isEnabled() ? "watching…" : "");
  battleScreenPanel.setActive(engagement);
  maybeAutoSwitchTab();
  battleScreenPanel.render(world);
  eventLogPanel.render();
  refreshSelection();
  // Not forced — macroMapView.render internally throttles redraws (see its
  // own doc comment) since the macro grid's data doesn't change fast enough
  // to justify a full redraw every animation frame at real grid scale.
  if (macroWorld) macroMapView.render(macroWorld);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
