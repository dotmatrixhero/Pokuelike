import { EventLog, tickWorld, randomSeed, type Agent, type World } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, SCENARIO_SEED } from "@pokuelike/data";
import { agentAtCanvasPos, drawEventPopups, drawWorld, TILE_SIZE, type RenderStyle } from "./renderer.js";
import { EventLogPanel } from "./eventLogPanel.js";
import { EventPopups } from "./eventPopups.js";
import { renderInspector } from "./inspector.js";
import { renderLegend } from "./legend.js";

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
const hideNoiseCheckbox = document.getElementById("hide-noise") as HTMLInputElement;
const hideLevelUpsCheckbox = document.getElementById("hide-levelups") as HTMLInputElement;
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

// --- State -----------------------------------------------------------------

let world: World;
let log: EventLog;
let playing = false;
let speedIndex = DEFAULT_SPEED_INDEX;
let intervalId: number | undefined;
let selectedAgentId: string | undefined;
let lastLoggedEventCount = 0;
let inspectorDirty = true;
let renderStyle: RenderStyle = "ascii";
let zoom = DEFAULT_ZOOM;

const eventLogPanel = new EventLogPanel(eventLogEl);
const eventPopups = new EventPopups();

function currentSeed(): number {
  return world.rngSeed;
}

function loadWorld(seed: number): void {
  world = createDemoWorld(seed);
  log = new EventLog();
  lastLoggedEventCount = 0;
  selectedAgentId = undefined;

  canvas.width = world.width * TILE_SIZE;
  canvas.height = world.height * TILE_SIZE;
  applyZoom();

  seedInput.value = String(seed);
  const url = new URL(location.href);
  url.searchParams.set("seed", String(seed));
  history.replaceState(null, "", url);

  eventLogPanel.reset();
  eventLogPanel.setFilter(undefined);
  eventPopups.reset();
  renderInspector(inspectorEl, undefined, world);
  updateStatusLabels();
}

function step(): void {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT);
  // Only the events since the last step are new; EventLog is append-only for the life of a world.
  const newEvents = log.events.slice(lastLoggedEventCount);
  eventLogPanel.ingest(newEvents);
  eventPopups.ingest(newEvents, world);
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
});

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const agent = agentAtCanvasPos(world, x, y);
  selectAgent(agent);
});

clearSelectionBtn.addEventListener("click", () => selectAgent(undefined));

hideNoiseCheckbox.addEventListener("change", () => {
  eventLogPanel.setHideNoise(hideNoiseCheckbox.checked);
  eventLogPanel.render();
});

hideLevelUpsCheckbox.addEventListener("change", () => {
  eventLogPanel.setHideLevelUps(hideLevelUpsCheckbox.checked);
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
zoomOutBtn.addEventListener("click", () => setZoom(zoom / ZOOM_BUTTON_FACTOR));
zoomInBtn.addEventListener("click", () => setZoom(zoom * ZOOM_BUTTON_FACTOR));

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

// --- Boot --------------------------------------------------------------------

const seedParam = new URLSearchParams(location.search).get("seed");
const initialSeed = seedParam !== null && seedParam !== "" ? Number(seedParam) : SCENARIO_SEED;
loadWorld(Number.isFinite(initialSeed) ? initialSeed : SCENARIO_SEED);
speedLabel.textContent = `${SPEED_STEPS[speedIndex]}x`;

function frame(): void {
  drawWorld(ctx, world, selectedAgentId, renderStyle);
  drawEventPopups(ctx, eventPopups.active());
  eventLogPanel.render();
  refreshSelection();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
