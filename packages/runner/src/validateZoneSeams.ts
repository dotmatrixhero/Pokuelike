import { createDemoMacroWorld, IMMIGRATION_CONTEXT } from "@pokuelike/data";
import { promoteZone, tileAt } from "@pokuelike/engine";

/**
 * Measures how discontinuous terrain is at a zone boundary.
 *
 * Prompted by: "if I wanted seamless terrain between zones... how hard is
 * that? Like I move south off a zone and just show up like the zone itself
 * sorta expanded?"
 *
 * The method is the whole point: compare the two columns that MEET at a
 * shared edge (zone A's last column against zone B's first — physically
 * adjacent tiles in a seamless world) against a control pair of genuinely
 * adjacent columns inside one zone. The control is what "continuous" looks
 * like for this generator; anything worse at the seam is the seam.
 *
 * Run: `npx tsx packages/runner/src/validateZoneSeams.ts [seed]`
 */

const seed = Number(process.argv[2] ?? 20260903);
const mw = createDemoMacroWorld(seed) as never as {
  regions: Map<string, { world?: unknown }>;
  focusedKey: string;
};
// The focused zone and its neighbours, not a hard-coded pair. An arbitrary
// cell of a 64x64 grid is very likely open ocean (59% of this grid is), and
// two all-water zones agree at their seam trivially — a measurement that
// looks perfect while testing nothing.
const [FR, FC] = mw.focusedKey.split(",").map(Number) as [number, number];

type AnyWorld = Parameters<typeof tileAt>[0];
const promote = (row: number, col: number): AnyWorld =>
  promoteZone(mw as never, row, col, IMMIGRATION_CONTEXT).world as AnyWorld;

const kindAt = (w: AnyWorld, x: number, y: number): string => tileAt(w, "surface", x, y)?.terrain ?? "?";
const elevAt = (w: AnyWorld, x: number, y: number): number => tileAt(w, "surface", x, y)?.elevation ?? 0;

function compare(label: string, n: number, sample: (i: number) => [[string, number], [string, number]]): void {
  let same = 0;
  let elevDelta = 0;
  for (let i = 0; i < n; i++) {
    const [[ka, ea], [kb, eb]] = sample(i);
    if (ka === kb) same++;
    elevDelta += Math.abs(ea - eb);
  }
  console.log(`${label.padEnd(18)} ${((same / n) * 100).toFixed(0).padStart(3)}% same terrain, mean elevation jump ${(elevDelta / n).toFixed(3)}`);
}

const a = promote(FR, FC);
const east = promote(FR, FC + 1);
const south = promote(FR + 1, FC);
const w = (a as { width: number }).width;
const h = (a as { height: number }).height;

console.log(`seed ${seed}, zone size ${w}x${h}, focused zone ${FR},${FC}\n`);
compare("east seam", h, (y) => [
  [kindAt(a, w - 1, y), elevAt(a, w - 1, y)],
  [kindAt(east, 0, y), elevAt(east, 0, y)],
]);
compare("south seam", w, (x) => [
  [kindAt(a, x, h - 1), elevAt(a, x, h - 1)],
  [kindAt(south, x, 0), elevAt(south, x, 0)],
]);
// The control: what genuine continuity looks like for this generator.
compare("within a zone", h, (y) => [
  [kindAt(a, w - 2, y), elevAt(a, w - 2, y)],
  [kindAt(a, w - 1, y), elevAt(a, w - 1, y)],
]);

console.log(
  "\nA seam is seamless when its two rows read like the control — the control" +
    "\nis what continuity looks like for this generator, not a perfect score."
);
