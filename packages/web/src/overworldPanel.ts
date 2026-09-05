import type { Overworld, Region } from "@pokuelike/engine";
import { drawRegionThumbnail } from "./overworldMap.js";

/**
 * Renders the overworld region graph as a horizontal strip of clickable
 * cards, one per region, with a connector between consecutive ones (the
 * demo graph — see `@pokuelike/data`'s `overworldScenario.ts` — is a simple
 * chain, `region-a - region-b - region-c`; this renders whatever topology
 * `overworld.edges` actually describes, not a hardcoded chain layout,
 * though a chain is the only shape validated so far).
 *
 * Direct ask: "I want to be able to see the overworld stuff... visualize
 * overworld." Follow-up, after the first pass shipped as plain data cards:
 * "I kinda thought overworld would be it's own tileset we can zoom out
 * to... its own renderer... see the bigger picture and select a zone."
 * Each card is now a real, zoomed-all-the-way-out satellite view of that
 * region's own generated terrain (`overworldMap.ts`'s `drawRegionThumbnail`
 * — one canvas pixel per tile, upscaled with `image-rendering: pixelated`),
 * not an abstract color swatch — clicking a thumbnail IS "selecting a
 * zone." The stat/species text below each thumbnail is unchanged from the
 * first pass and still matters: the focused region's card shows its real,
 * live per-species population (straight off `world.agents`, exactly what
 * the Inspector panel's "World overview" already reports for the single-map
 * mode); every other region's card shows its abstracted `RegionAggregate`
 * numbers instead — population, rounded, per species — making the
 * promotion/demotion boundary itself visible: a card's content genuinely
 * changes shape (real agents vs. abstract stats) depending on whether it's
 * focused, which is the whole point of this system (see overworld.ts's own
 * doc comment on why this is "explicitly lossy, not an implementation
 * detail to gloss over"). A demoted region's thumbnail correctly shows its
 * real (frozen, un-ticked) terrain with zero population dots —
 * `demoteRegion` empties `world.agents` entirely, so there's nothing false
 * to plot.
 *
 * Pure rendering + a click callback — no simulation state of its own, same
 * "DOM-agnostic detection, host does the rest" split `autoCamera.ts` uses,
 * just simpler since there's no state machine here, only a redraw.
 */
export function renderOverworldPanel(container: HTMLElement, overworld: Overworld, onFocusRegion: (regionId: string) => void): void {
  container.replaceChildren();
  overworld.regions.forEach((region, i) => {
    container.appendChild(renderRegionCard(region, region.id === overworld.focusedRegionId, onFocusRegion));
    if (i < overworld.regions.length - 1 && overworld.edges.some((e) => (e.a === region.id || e.b === region.id) && (e.a === overworld.regions[i + 1]?.id || e.b === overworld.regions[i + 1]?.id))) {
      const connector = document.createElement("div");
      connector.className = "region-connector";
      connector.textContent = "—";
      container.appendChild(connector);
    }
  });
}

function renderRegionCard(region: Region, focused: boolean, onFocusRegion: (regionId: string) => void): HTMLElement {
  const card = document.createElement("div");
  card.className = `region-card${focused ? " region-card-focused" : ""}`;
  card.title = focused ? "This region is fully simulated right now — click another card to switch focus" : "Click to switch focus here (demotes the current region, promotes this one — see DESIGN.md's overworld section)";
  if (!focused) card.addEventListener("click", () => onFocusRegion(region.id));

  const thumb = document.createElement("canvas");
  thumb.className = "region-card-thumb";
  drawRegionThumbnail(thumb, region.world);
  card.appendChild(thumb);

  const title = document.createElement("div");
  title.className = "region-card-title";
  const name = document.createElement("span");
  name.textContent = region.id;
  title.appendChild(name);
  if (focused) {
    const badge = document.createElement("span");
    badge.className = "region-card-badge";
    badge.textContent = "Focused";
    title.appendChild(badge);
  }
  card.appendChild(title);

  const speciesRow = document.createElement("div");
  speciesRow.className = "region-card-species";

  if (focused) {
    const living = region.world.agents.filter((a) => a.alive !== false && !a.isEgg);
    const stat = document.createElement("div");
    stat.className = "region-card-stat";
    stat.textContent = `${living.length} alive — full sim`;
    card.appendChild(stat);

    const bySpecies = new Map<string, number>();
    for (const agent of living) bySpecies.set(agent.species, (bySpecies.get(agent.species) ?? 0) + 1);
    for (const [species, count] of [...bySpecies.entries()].sort((a, b) => b[1] - a[1])) {
      speciesRow.appendChild(speciesChip(`${species} ${count}`));
    }
  } else {
    const aggregates = Object.values(region.aggregates ?? {});
    const totalPop = aggregates.reduce((sum, a) => sum + a.population, 0);
    const avgResource = aggregates.length > 0 ? aggregates.reduce((sum, a) => sum + a.resourceIndex, 0) / aggregates.length : 0;
    const stat = document.createElement("div");
    stat.className = "region-card-stat";
    stat.textContent = `~${Math.round(totalPop)} (abstract) — resources ${Math.round(avgResource * 100)}%`;
    card.appendChild(stat);

    for (const agg of [...aggregates].sort((a, b) => b.population - a.population)) {
      speciesRow.appendChild(speciesChip(`${agg.species} ~${Math.round(agg.population)}`));
    }
  }

  card.appendChild(speciesRow);
  return card;
}

function speciesChip(text: string): HTMLElement {
  const chip = document.createElement("span");
  chip.textContent = text;
  return chip;
}
