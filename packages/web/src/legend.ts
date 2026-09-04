import type { PokemonType, TerrainKind } from "@pokuelike/engine";
import { rgbToCss, TERRAIN_GLYPH, TYPE_COLOR } from "./palette.js";

const TERRAIN_LABEL: Record<TerrainKind, string> = {
  floor: "open ground",
  wall: "wall",
  water: "water",
  food: "food",
  flora: "flora",
  sunbeam: "sunbeam",
  seedling: "seedling",
  tree: "tree",
  boulder: "boulder",
  bush: "bush (concealment)",
  sand: "sand",
  mud: "mud",
};

/** Static — the palette doesn't change at runtime, so this renders once rather than every frame. */
export function renderLegend(container: HTMLElement): void {
  const frag = document.createDocumentFragment();

  const terrainGroup = document.createElement("div");
  const terrainTitle = document.createElement("div");
  terrainTitle.className = "legend-group-title";
  terrainTitle.textContent = "Terrain";
  terrainGroup.appendChild(terrainTitle);
  const terrainGrid = document.createElement("div");
  terrainGrid.className = "legend-grid";
  for (const terrain of Object.keys(TERRAIN_GLYPH) as TerrainKind[]) {
    terrainGrid.appendChild(legendRow(TERRAIN_GLYPH[terrain], TERRAIN_LABEL[terrain]));
  }
  terrainGroup.appendChild(terrainGrid);
  frag.appendChild(terrainGroup);

  const typeGroup = document.createElement("div");
  const typeTitle = document.createElement("div");
  typeTitle.className = "legend-group-title";
  typeTitle.textContent = "Pokémon (by type)";
  typeGroup.appendChild(typeTitle);
  const typeGrid = document.createElement("div");
  typeGrid.className = "legend-grid";
  for (const type of Object.keys(TYPE_COLOR) as PokemonType[]) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = rgbToCss(TYPE_COLOR[type]);
    const label = document.createElement("span");
    label.textContent = type;
    item.append(swatch, label);
    typeGrid.appendChild(item);
  }
  typeGroup.appendChild(typeGrid);
  frag.appendChild(typeGroup);

  container.replaceChildren(frag);
}

function legendRow(glyph: string, label: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "legend-item";
  const g = document.createElement("span");
  g.className = "legend-glyph";
  g.textContent = glyph;
  const l = document.createElement("span");
  l.textContent = label;
  item.append(g, l);
  return item;
}
