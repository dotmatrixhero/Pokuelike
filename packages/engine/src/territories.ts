import type { LandmarkType } from "./landmarks.js";
import { inBounds, zoneAt, zoneIndex, type MacroGrid, type MacroZone } from "./macroGrid.js";

/**
 * Named territories — contiguous runs of one biome, named like provinces on
 * a real map.
 *
 * Direct ask: "what if zones or collections of zones were named? Can we do
 * that based on biome too, and even label it on the overworld?"
 *
 * COLLECTIONS of zones, not zones. The overworld grid is 64x64 — naming
 * every zone would produce four thousand labels and mean nothing. Flood-
 * filling adjacent same-biome land zones instead gives a few dozen real
 * regions per world, which is what a map actually looks like: one big forest
 * with a name, not four hundred numbered forest tiles.
 *
 * Territories are pure derived geography. Nothing here touches simulation
 * state, and naming takes no rng draw beyond the grid's own seed, so the
 * same seed always produces the same map with the same place names.
 */

export interface Territory {
  id: string;
  /** "the Thornwood", "the Ashen Waste" — ready to drop into prose. */
  name: string;
  biome: string;
  /** Row-major zone indices belonging to this territory. */
  zoneIndices: number[];
  /** Where to draw the label — the territory's own centre of mass, snapped to a zone it actually contains. */
  labelRow: number;
  labelCol: number;
  /** Named points of interest inside it, which also get first claim on naming the place. */
  landmarks: LandmarkType[];
}

/**
 * A territory smaller than this is a speck — a couple of stray forest zones
 * inside a plain — and naming it would clutter the map with labels for
 * places nobody would ever call a region.
 */
export const MIN_NAMED_TERRITORY_ZONES = 4;

/**
 * Suffixes per biome. The suffix carries the geography ("wood", "fen",
 * "crags") and is what makes a name read as a real place rather than a
 * generated string.
 */
const BIOME_SUFFIXES: Record<string, readonly string[]> = {
  grassland: ["Downs", "Reach", "Meadows", "Plain", "Weald", "Sweep"],
  forest: ["wood", "Forest", "Thicket", "Grove", "Wilds", "Shaws"],
  jungle: ["Deep", "Tangle", "Rainwood", "Canopy", "Sprawl", "Thicket"],
  wetland: ["Fen", "Marsh", "Mire", "Bog", "Slough", "Wash"],
  beach: ["Shore", "Strand", "Coast", "Sands", "Spit", "Reef"],
  badlands: ["Barrens", "Scour", "Waste", "Flats", "Scar", "Hardpan"],
  desert: ["Waste", "Sands", "Expanse", "Dunes", "Drift", "Wastes"],
  highland: ["Crags", "Highlands", "Heights", "Tors", "Uplands", "Spurs"],
  snow: ["Fells", "Waste", "Reach", "Drifts", "Wilds", "Barrens"],
};
const FALLBACK_SUFFIXES = ["Reach", "Wilds", "Expanse", "Marches"];

/** Adjectives per biome — the half that gives a place its character. */
const BIOME_PREFIXES: Record<string, readonly string[]> = {
  grassland: ["Green", "Clover", "Wide", "Sun", "Gold", "Long", "Fair", "Open"],
  forest: ["Thorn", "Elder", "Moss", "Deep", "Shadow", "Fern", "Bramble", "Still"],
  jungle: ["Verdant", "Emerald", "Vine", "Fever", "Riot", "Steam", "Wild", "Endless"],
  wetland: ["Reed", "Silt", "Heron", "Black", "Slow", "Drown", "Mist", "Quag"],
  beach: ["Salt", "Drift", "Shell", "Pale", "Break", "Grey", "Wrack", "Bright"],
  badlands: ["Rust", "Scoured", "Bone", "Ash", "Cracked", "Bitter", "Red", "Sere"],
  desert: ["Ashen", "Dust", "Bleach", "Amber", "Thirsting", "Glass", "Sun", "Empty"],
  highland: ["Iron", "Storm", "Cloud", "Crag", "Cold", "Hawk", "Grey", "High"],
  snow: ["Rime", "White", "Wither", "Still", "Pale", "Bitter", "Hollow", "Frost"],
};
const FALLBACK_PREFIXES = ["Grey", "Far", "Old", "Lost", "Quiet"];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * A territory's name: `<prefix><suffix>`, joined without a space when the
 * suffix is a lowercase word-ending ("Thornwood") and with one when it is a
 * noun in its own right ("the Ashen Waste") — that single distinction is
 * most of what separates a plausible place name from an obviously generated
 * one.
 *
 * Deliberately does NOT name a territory after a landmark inside it, though
 * an early version did. Landmarks are already drawn and labelled as points
 * of interest, they are a different layer of the map, and they are not
 * unique: naming regions after them produced three separate territories all
 * called "the Crossroads" in one world, which is worse than any invented
 * name. A landmark sits IN a region; it is not the region.
 *
 * `taken` carries the names already used in this world so a second
 * territory never repeats one — it re-rolls with a salted key instead.
 */
export function territoryName(biome: string, key: string, taken?: ReadonlySet<string>): string {
  const prefixes = BIOME_PREFIXES[biome] ?? FALLBACK_PREFIXES;
  const suffixes = BIOME_SUFFIXES[biome] ?? FALLBACK_SUFFIXES;

  for (let attempt = 0; attempt < 24; attempt++) {
    const salt = attempt === 0 ? key : `${key}#${attempt}`;
    const prefix = prefixes[hash(salt) % prefixes.length]!;
    const suffix = suffixes[hash(`${salt}:suffix`) % suffixes.length]!;
    // "the Crag Crags" — a prefix that is just the suffix again reads as a
    // bug, so skip that pairing and re-roll.
    if (prefix.toLowerCase().replace(/s$/, "") === suffix.toLowerCase().replace(/s$/, "")) continue;
    const joined = /^[a-z]/.test(suffix) ? `${prefix}${suffix}` : `${prefix} ${suffix}`;
    const name = `the ${joined}`;
    if (!taken?.has(name)) return name;
  }
  // Every combination for this biome is spoken for — fall back to something
  // unique rather than shipping a duplicate.
  return `the ${prefixes[hash(key) % prefixes.length]!} ${suffixes[hash(key) % suffixes.length]!} (${key.split(":")[1] ?? ""})`;
}

/**
 * Flood-fills the grid into contiguous same-biome land territories, names
 * the ones big enough to be worth naming, and stamps `territoryId` onto
 * every zone in them.
 *
 * Ocean is skipped entirely — it is one connected mass with no interesting
 * internal structure, and "the Grey Reach" written across the whole sea is
 * not a feature.
 */
export function nameTerritories(grid: MacroGrid): Territory[] {
  const seen = new Uint8Array(grid.rows * grid.cols);
  const territories: Territory[] = [];
  /** Every name already used in this world — no two regions share one. */
  const usedNames = new Set<string>();

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const index = zoneIndex(grid, row, col);
      if (seen[index]) continue;
      const start = grid.zones[index]!;
      seen[index] = 1;
      if (start.isOcean) continue;

      // Breadth-first flood fill over same-biome orthogonal neighbours.
      const members: number[] = [index];
      const queue: Array<[number, number]> = [[row, col]];
      let rowSum = row;
      let colSum = col;
      const landmarks: LandmarkType[] = [];
      if (start.landmark) landmarks.push(start.landmark);

      while (queue.length > 0) {
        const [r, c] = queue.pop()!;
        for (const [dr, dc] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inBounds(grid, nr, nc)) continue;
          const ni = zoneIndex(grid, nr, nc);
          if (seen[ni]) continue;
          const neighbor = grid.zones[ni]!;
          if (neighbor.isOcean || neighbor.biome !== start.biome) continue;
          seen[ni] = 1;
          members.push(ni);
          queue.push([nr, nc]);
          rowSum += nr;
          colSum += nc;
          if (neighbor.landmark) landmarks.push(neighbor.landmark);
        }
      }

      if (members.length < MIN_NAMED_TERRITORY_ZONES) continue;

      // The label belongs on a zone the territory actually contains — a
      // crescent-shaped region's centre of mass can easily fall in the sea.
      let labelIndex = members[0]!;
      let best = Infinity;
      const meanRow = rowSum / members.length;
      const meanCol = colSum / members.length;
      for (const member of members) {
        const r = Math.floor(member / grid.cols);
        const c = member % grid.cols;
        const d = (r - meanRow) ** 2 + (c - meanCol) ** 2;
        if (d < best) {
          best = d;
          labelIndex = member;
        }
      }

      // Keyed by the territory's own extent rather than its first zone, so
      // the name is stable for a given seed and does not depend on scan
      // order.
      const key = `${start.biome}:${labelIndex}:${members.length}`;
      const territory: Territory = {
        id: `territory-${labelIndex}`,
        name: territoryName(start.biome, key, usedNames),
        biome: start.biome,
        zoneIndices: members,
        labelRow: Math.floor(labelIndex / grid.cols),
        labelCol: labelIndex % grid.cols,
        landmarks: [...new Set(landmarks)],
      };
      usedNames.add(territory.name);
      territories.push(territory);
      for (const member of members) (grid.zones[member] as MacroZone & { territoryId?: string }).territoryId = territory.id;
    }
  }

  grid.territories = territories;
  return territories;
}

/** The territory a zone belongs to, if it is in a named one. */
export function territoryAt(grid: MacroGrid, row: number, col: number): Territory | undefined {
  const zone = zoneAt(grid, row, col) as (MacroZone & { territoryId?: string }) | undefined;
  if (!zone?.territoryId) return undefined;
  return grid.territories?.find((t) => t.id === zone.territoryId);
}
