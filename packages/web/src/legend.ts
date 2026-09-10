import type { PokemonType, TerrainKind } from "@pokuelike/engine";
import { FOOD_CROPS } from "@pokuelike/engine";
import { rgbToCss, CROP_EMOJI, FLAVOR_FG, TERRAIN_GLYPH, TYPE_COLOR } from "./palette.js";

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
  shelter: "shelter (concealment + storm cover)",
  fire: "fire (spreads, burns down flora, damages anything standing in it)",
  ice: "ice (a frozen small water body, walkable — melts once winter ends)",
  stairsDown: "stairs down to the next cave level",
  stairsUp: "stairs up to the previous cave level",
  exit: "the way out",
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

  // Direct report: "the other food sources. are they in the game? idk if i
  // see em" — they are (crops.ts's real FOOD_CROPS registry, rendered with
  // distinct sprites/colors per flavor, renderer.ts), but the legend only
  // ever listed one generic "food" glyph, with no way to learn which map
  // glyph/color means which crop. This group lists every real crop by its
  // actual display name and on-map look (a real emoji for the 7 crops that
  // have one — CROP_EMOJI — or its real map color as a swatch for the 4
  // original berries, which use hand-drawn sprite art instead).
  const cropGroup = document.createElement("div");
  const cropTitle = document.createElement("div");
  cropTitle.className = "legend-group-title";
  cropTitle.textContent = "Food crops";
  cropGroup.appendChild(cropTitle);
  const cropGrid = document.createElement("div");
  cropGrid.className = "legend-grid";
  for (const [id, def] of Object.entries(FOOD_CROPS)) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const mark = document.createElement("span");
    const emoji = CROP_EMOJI[id];
    if (emoji) {
      mark.className = "legend-glyph";
      mark.textContent = emoji;
    } else {
      mark.className = "legend-swatch";
      const rgb = FLAVOR_FG[id];
      if (rgb) mark.style.background = rgbToCss(rgb);
    }
    const label = document.createElement("span");
    label.textContent = def.name;
    item.append(mark, label);
    cropGrid.appendChild(item);
  }
  cropGroup.appendChild(cropGrid);
  frag.appendChild(cropGroup);

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
