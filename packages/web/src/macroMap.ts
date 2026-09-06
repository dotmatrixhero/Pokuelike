import { zoneAt, type MacroWorld, type World } from "@pokuelike/engine";
import { shade, rgbToCss, type Rgb } from "./palette.js";
import { drawRegionThumbnail } from "./overworldMap.js";

/**
 * The overworld's own renderer — ONE pannable/zoomable canvas over the
 * whole macro grid (thousands of zone-cells), not a strip of cards. Direct
 * follow-up refinement of the first two overworld-visualization passes (see
 * DESIGN.md): "single pannable canvas — one canvas the viewer pans/zooms
 * around, not a separate macro-overview-plus-neighborhood-panel split. Show
 * the whole macro grid at a coarse zoom level by default, with zoom-in
 * support so individual zones become large enough to actually click as the
 * viewer zooms in — same canvas throughout."
 *
 * Native-resolution zoom, not CSS scaling: `blockPx` (native canvas pixels
 * per zone) IS the zoom level — zooming in regenerates the canvas at a
 * bigger native size rather than upscaling a small bitmap via CSS, so a
 * zoomed-in zone gets real detail, not blur. Below `INSET_MIN_BLOCK_PX`, a
 * zone (promoted or not) is just its flat macro-color block (biome + ocean,
 * shaded by elevation via the same `shade()` the tile renderer's own
 * elevation shading uses); at/above it, a zone that's actually been
 * promoted (has a real `World`) gets its real terrain thumbnail inset
 * instead — `overworldMap.ts`'s existing `drawRegionThumbnail` technique,
 * reused via `drawImage` rather than duplicated. Panning is native browser
 * scroll on the wrapping `overflow: auto` div, same idiom `#canvas-wrap`
 * already uses for the tile-level view.
 *
 * Only the handful of zones a `MacroWorld` actually tracks (see
 * overworld.ts) can ever show an inset — the overwhelming majority of the
 * grid is untracked and only ever contributes its cheap macro-grid facts,
 * which is the whole performance point of this architecture.
 */

const MACRO_BIOME_COLOR: Record<string, Rgb> = {
  ocean: [24, 68, 112],
  grassland: [92, 148, 78],
  forest: [46, 104, 58],
  wetland: [64, 128, 116],
  badlands: [172, 134, 80],
  highland: [146, 132, 120],
  // Pale icy blue-white — reads as a real snowcap even at this zoomed-out,
  // flat-color-block scale, distinct from Highland's own grey-brown.
  snow: [220, 232, 238],
};
const DEFAULT_BIOME_COLOR: Rgb = MACRO_BIOME_COLOR["grassland"]!;

const FOCUSED_OUTLINE = "rgb(255, 209, 102)";
const TRACKED_OUTLINE = "rgba(255, 255, 255, 0.35)";

/** Native px/zone at/above which a promoted zone's real terrain thumbnail is legible enough to draw instead of a flat color block. */
const INSET_MIN_BLOCK_PX = 14;

export const MACRO_MAP_MIN_BLOCK_PX = 2;
export const MACRO_MAP_MAX_BLOCK_PX = 48;
export const MACRO_MAP_DEFAULT_BLOCK_PX = 8;

function drawZoneInset(ctx: CanvasRenderingContext2D, world: World, px: number, py: number, blockPx: number): void {
  const thumb = document.createElement("canvas");
  drawRegionThumbnail(thumb, world);
  ctx.drawImage(thumb, px, py, blockPx, blockPx);
}

/** Draws the whole macro grid at `blockPx` native pixels per zone — see this file's top doc comment for the zoom model. Resizes `canvas` to exactly fit the grid at this zoom level. */
export function drawMacroMap(canvas: HTMLCanvasElement, mw: MacroWorld, blockPx: number): void {
  const { grid } = mw;
  canvas.width = grid.cols * blockPx;
  canvas.height = grid.rows * blockPx;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const showInsets = blockPx >= INSET_MIN_BLOCK_PX;
  const outlinePx = Math.max(1, Math.round(blockPx * 0.12));

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const zone = zoneAt(grid, row, col)!;
      const key = `${row},${col}`;
      const region = mw.regions.get(key);
      const px = col * blockPx;
      const py = row * blockPx;

      if (showInsets && region?.world) {
        drawZoneInset(ctx, region.world, px, py, blockPx);
      } else {
        const [r, g, b] = shade(MACRO_BIOME_COLOR[zone.biome] ?? DEFAULT_BIOME_COLOR, zone.elevation);
        ctx.fillStyle = rgbToCss([r, g, b]);
        ctx.fillRect(px, py, blockPx, blockPx);
      }

      if (key === mw.focusedKey) {
        ctx.lineWidth = outlinePx;
        ctx.strokeStyle = FOCUSED_OUTLINE;
        ctx.strokeRect(px + outlinePx / 2, py + outlinePx / 2, blockPx - outlinePx, blockPx - outlinePx);
      } else if (region) {
        // A tracked-but-not-focused zone (has real history — past agents,
        // received migrants) gets a faint outline even at flat-block
        // scale, so "this zone isn't a blank macro guess" is visible
        // without needing insets legible yet.
        ctx.lineWidth = 1;
        ctx.strokeStyle = TRACKED_OUTLINE;
        ctx.strokeRect(px + 0.5, py + 0.5, blockPx - 1, blockPx - 1);
      }
    }
  }
}

/**
 * Owns the macro canvas's zoom level and click-to-focus interaction; pure
 * rendering + a click callback otherwise, same "DOM-agnostic detection,
 * host does the rest" split `autoCamera.ts`/`overworldPanel.ts` (its
 * predecessor) already use. Rendering is throttled internally (see
 * `render`'s doc comment) since redrawing thousands of zones' worth of
 * `fillRect` calls every animation frame would be wasted work for data
 * (macro biome/elevation, background aggregate populations) that doesn't
 * change every tick.
 */
export class MacroMapView {
  private blockPx = MACRO_MAP_DEFAULT_BLOCK_PX;
  private lastRenderAt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly zoomLabel: HTMLElement,
    onFocusZone: (row: number, col: number) => void
  ) {
    this.canvas.addEventListener("click", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      const col = Math.floor(x / this.blockPx);
      const row = Math.floor(y / this.blockPx);
      onFocusZone(row, col);
    });
    this.updateZoomLabel();
  }

  private updateZoomLabel(): void {
    this.zoomLabel.textContent = `${this.blockPx}px/zone`;
  }

  private setBlockPx(next: number): void {
    const clamped = Math.max(MACRO_MAP_MIN_BLOCK_PX, Math.min(MACRO_MAP_MAX_BLOCK_PX, Math.round(next)));
    if (clamped === this.blockPx) return;
    this.blockPx = clamped;
    this.updateZoomLabel();
  }

  zoomIn(mw: MacroWorld): void {
    this.setBlockPx(this.blockPx * 1.5);
    this.render(mw, true);
  }

  zoomOut(mw: MacroWorld): void {
    this.setBlockPx(this.blockPx / 1.5);
    this.render(mw, true);
  }

  /** Current px/zone, so a pinch gesture can scale relative to where it started rather than the (possibly stale-by-then) value at gesture start. */
  currentBlockPx(): number {
    return this.blockPx;
  }

  /** Continuous zoom for pinch gestures — sets px/zone directly to `startBlockPx * ratio` rather than the fixed 1.5x step `zoomIn`/`zoomOut` use, so the map tracks finger spread smoothly. */
  zoomTo(mw: MacroWorld, startBlockPx: number, ratio: number): void {
    this.setBlockPx(startBlockPx * ratio);
    this.render(mw, true);
  }

  /** Renders the whole grid at the current zoom level. Throttled to a modest cadence unless `force` (a focus change, a zoom change, or a fresh overworld load) — macro biome/elevation data never changes and background aggregate populations drift slowly, so redrawing every animation frame like the old per-region card strip did would be wasted `fillRect` work at real grid scale. */
  render(mw: MacroWorld, force = false): void {
    const RENDER_THROTTLE_MS = 500;
    const now = performance.now();
    if (!force && now - this.lastRenderAt < RENDER_THROTTLE_MS) return;
    this.lastRenderAt = now;
    drawMacroMap(this.canvas, mw, this.blockPx);
  }
}
