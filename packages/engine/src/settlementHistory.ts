/**
 * Where people took hold, why there, and what became of them.
 *
 * HUMANS_DESIGN.md decision 2: "the world generates wild and gets settled by
 * a history pass" — not a static starting placement. This is that pass, and
 * it is the thing that turns "there is a village here" into "there is a
 * village here *because*".
 *
 * It runs ONCE at worldgen, over the zone grid, on compact per-settlement
 * records — the same cheap-dense-facts model that generates the macro grid
 * itself. No per-tile anything, no per-agent anything. HUMAN_PASS.md calls
 * this out as the half of the human pass that is separable from (and much
 * cheaper than) a live behaviour loop, and the half that actually delivers
 * towns and roads on the map.
 *
 * Four rules shape it, all from the design conversation:
 *
 *  1. **Every settlement sites on fresh water.** Direct ask: "Make em near
 *     water, rivers, streams." A founding constraint, not a flavour trait —
 *     coast alone does not count, because coast is salt.
 *  2. **Identity is derived from the site, then earned.** A town beside ore
 *     becomes a smithing town; one on a floodplain farms. See `specialtyFor`.
 *  3. **Roads accrete because they were walked**, not from an MST — a road
 *     exists between two settlements that actually traded for generations.
 *     (HUMANS_DESIGN.md open question 3, answered in favour of history.)
 *  4. **Failures leave ruins, with a recorded cause.** A settlement that
 *     starved or was overrun is better content than one that was never there,
 *     and the chronicle should be able to say what killed it.
 *
 * Everything here is deterministic given (grid, seed).
 */
import type { MacroGrid, MacroZone } from "./macroGrid.js";
import { zoneAt, zoneIndex } from "./macroGrid.js";

export type SettlementStatus = "living" | "ruined";
export type SettlementOrigin = "founding" | "daughter";

/**
 * What a settlement is known for. Seeded from the site (see `specialtyFor`)
 * rather than rolled, so the chronicle can always say why — "Redfen smiths
 * because the hills behind it are full of ore" is true in the data.
 */
export type SettlementSpecialty = "farming" | "smithing" | "merchant" | "port" | "timber" | "devotional";

export interface Settlement {
  id: string;
  name: string;
  row: number;
  col: number;
  /** Era index it was founded in — the compressed-generations clock, not world ticks. */
  foundedEra: number;
  origin: SettlementOrigin;
  /** The settlement that sent people out to found this one. Absent for an origin site. */
  parentId?: string;
  status: SettlementStatus;
  ruinedEra?: number;
  /** Why it fell, in words a chronicle can print. Only set when `status` is "ruined". */
  ruinedCause?: string;
  population: number;
  specialty: SettlementSpecialty;
  /** 0..1 site quality — drives growth, and how likely it is to survive a bad era. */
  siteScore: number;
  /** Real recorded events, oldest first, each already phrased for a chronicle. */
  chronicle: string[];
}

/** A corridor between two settlements that got walked enough to become a real road. */
export interface RoadEdge {
  fromId: string;
  toId: string;
  /** Row-major zone indices along the path, endpoints included. */
  zoneIndices: number[];
  /** How much traffic accreted on this corridor — higher is a more established road. */
  traffic: number;
}

export interface SettlementHistory {
  settlements: Settlement[];
  roads: RoadEdge[];
  /** Era-level events that punctuated the history, for the chronicle. */
  eraEvents: { era: number; text: string }[];
  /** Row-major zone index -> accreted traffic, the raw field the roads are thresholded out of. */
  traffic: Map<number, number>;
}

/** How many compressed generations the pass runs for. Enough for lineages a few steps deep without turning the map into a settled continent. */
const ERAS = 12;
/** One origin site per this many land zones, so density scales with how much land a grid actually has rather than being a fixed count. */
const LAND_ZONES_PER_ORIGIN = 700;
const MIN_ORIGINS = 2;
const MAX_ORIGINS = 5;
/** Origin sites must be at least this far apart (Chebyshev zones), so a world starts with genuinely separate peoples rather than one cluster. */
const MIN_ORIGIN_SEPARATION = 12;
/** No two settlements closer than this — keeps towns from merging into a conurbation and keeps wilderness between them. */
const MIN_SETTLEMENT_SEPARATION = 4;
/** How far a daughter settlement will be founded from its parent. Far enough to be its own place, close enough that the corridor stays walkable. */
const MAX_DAUGHTER_DISTANCE = 9;
/** Population a settlement needs before it can spare people to found another. */
const SURPLUS_TO_SPLIT = 55;
/**
 * How far an era event reaches, in zones. A disaster is a place, not a global
 * flag — see the epicentre roll in `generateSettlementHistory`. Wide enough
 * to catch a cluster of neighbouring settlements (so a valley can be emptied
 * together, which is the story worth telling) but well short of the 64-zone
 * grid, so no single event can take the whole world.
 */
const ERA_EVENT_RADIUS = 14;
/** Elevation above which a zone is mountain — impassable for a corridor, unsettleable. */
const MOUNTAIN_ELEVATION = 0.78;

/** Fresh water, specifically: a river runs through it, it has a spring, or it holds a lake. Coast is salt and does not count. */
export function hasFreshWater(zone: MacroZone): boolean {
  return zone.riverEdges.length > 0 || zone.isRiverSource || zone.isLake;
}

/** Biome desirability for settling — how well it feeds people. */
const BIOME_HABITABILITY: Record<string, number> = {
  grassland: 1.0,
  savanna: 0.8,
  forest: 0.8,
  mangrove: 0.6,
  beach: 0.6,
  swamp: 0.45,
  highland: 0.4,
  // Rock and salt spray, and no fresh water of its own — a cliff is a place
  // you look out from, not one you farm. Fresh water is a hard gate on
  // founding anyway, so this mostly matters for the rare cliff zone a river
  // happens to cross.
  cliff: 0.2,
  desert: 0.25,
  tundra: 0.25,
  badlands: 0.2,
  cave: 0.1,
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function passable(zone: MacroZone | undefined): boolean {
  return !!zone && !zone.isOcean && zone.elevation < MOUNTAIN_ELEVATION;
}

/**
 * A narrow neck of passable land — a pass, an isthmus, a river gap. Corridors
 * are forced through these, so trade and conflict concentrate there and a
 * settlement that holds one punches above its size. HUMAN_GEOGRAPHY.md:
 * "the map should generate chokepoints, and settlements should find them."
 */
function chokepointBonus(grid: MacroGrid, zone: MacroZone): number {
  let open = 0;
  let inBounds = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      // Count only neighbours that EXIST. Treating off-grid as impassable
      // made the map border read as a natural neck: an edge zone is missing
      // 3 of its 8 neighbours (a corner, 5), so it scored as a mountain pass
      // purely for being on the edge of the world. Measured: 4 of 25
      // settlements landed on the border against 5.3% of land zones being
      // border zones — a 3x over-representation, and 3 of 7 on one seed.
      const neighbor = zoneAt(grid, zone.row + dr, zone.col + dc);
      if (!neighbor) continue;
      inBounds++;
      if (passable(neighbor)) open++;
    }
  }
  if (inBounds === 0) return 0;
  // Judge the RATIO, so the test means the same thing wherever it is applied.
  const openRatio = open / inBounds;
  if (openRatio <= 0.25) return 0; // a dead end, not a thoroughfare
  if (openRatio <= 0.5) return 0.25;
  if (openRatio <= 0.65) return 0.12;
  return 0;
}

/**
 * 0 means unsettleable. Fresh water is a hard gate, per the founding rule;
 * everything else is preference.
 */
export function siteScore(grid: MacroGrid, zone: MacroZone): number {
  if (zone.isOcean) return 0;
  if (zone.elevation >= MOUNTAIN_ELEVATION) return 0;
  if (!hasFreshWater(zone)) return 0;

  let score = BIOME_HABITABILITY[zone.biome] ?? 0.3;
  // Coastal AND fresh water is the classic port site — a river mouth.
  if (zone.coastEdges.length > 0) score += 0.15;
  if (zone.isLake) score += 0.1;
  score += chokepointBonus(grid, zone);
  // Steep ground is hard to build and farm on, short of the outright
  // mountain cutoff above.
  score -= Math.max(0, zone.elevation - 0.55) * 0.6;
  if (zone.landmark) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

/**
 * How much of a case the site makes for each speciality. Scored and maxed
 * rather than resolved by first-match priority: priority made almost every
 * town a smithing town, because "some high ground within 8 neighbours" is
 * nearly always true on a real grid, and `farming` -- which should be the
 * commonest human settlement of all -- only ever got what fell through.
 * Measured before the change, 3 seeds: smithing 12, port 8, timber 3,
 * devotional 1, farming 1, merchant 0. A speciality nothing can reach is a
 * defect, not a rarity.
 */
function specialtyScores(grid: MacroGrid, zone: MacroZone): Record<SettlementSpecialty, number> {
  let steepNeighbours = 0;
  let oreNeighbours = 0;
  let woodNeighbours = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const n = zoneAt(grid, zone.row + dr, zone.col + dc);
      if (!n || n.isOcean) continue;
      if (n.elevation >= 0.7) steepNeighbours++;
      // Badlands and cave are the real ore tells. `highland` is deliberately
      // NOT one: it is common enough that including it made smithing the
      // default answer nearly everywhere.
      if (n.biome === "badlands" || n.biome === "cave") oreNeighbours++;
      if (n.biome === "forest" || n.biome === "mangrove") woodNeighbours++;
    }
  }

  const habitability = BIOME_HABITABILITY[zone.biome] ?? 0.3;
  return {
    // A shrine or named place makes the town about that place.
    devotional: zone.landmark ? 2.0 : 0,
    // A river mouth: fresh water AND a coast.
    port: zone.coastEdges.length > 0 ? 1.2 + zone.coastEdges.length * 0.1 : 0,
    // Real ore, or genuinely mountainous ground to quarry.
    smithing: oreNeighbours * 0.55 + (steepNeighbours >= 2 ? 0.5 : 0),
    // A neck that traffic has to pass through.
    merchant: chokepointBonus(grid, zone) * 4,
    // A real wood, not one tree.
    timber: woodNeighbours >= 3 ? 0.5 + woodNeighbours * 0.12 : 0,
    // Good ground, and flat: the commonest reason to stop and stay.
    farming: habitability * 1.15 - Math.max(0, zone.elevation - 0.45) * 1.2,
  };
}

/**
 * Identity from the site: whichever case the ground makes most strongly.
 * Ties resolve by a fixed order, so the pass stays deterministic.
 */
export function specialtyFor(grid: MacroGrid, zone: MacroZone): SettlementSpecialty {
  const scores = specialtyScores(grid, zone);
  const order: SettlementSpecialty[] = ["devotional", "port", "smithing", "merchant", "timber", "farming"];
  let best: SettlementSpecialty = "farming";
  let bestScore = -Infinity;
  for (const key of order) {
    if (scores[key] > bestScore) {
      bestScore = scores[key];
      best = key;
    }
  }
  return best;
}

const PREFIXES = ["Red", "Stone", "Ash", "Green", "Black", "Old", "White", "Thorn", "Elder", "Grey", "Cold", "Deep", "Bright", "Iron"];
/** Suffixes grouped by what the site actually is, so a name is never at odds with the place. */
const SUFFIX_BY_SPECIALTY: Record<SettlementSpecialty, readonly string[]> = {
  port: ["haven", "harbour", "mouth", "landing"],
  smithing: ["forge", "delve", "crag", "hammer"],
  merchant: ["gate", "crossing", "ford", "market"],
  timber: ["hollow", "stand", "coppice", "wick"],
  farming: ["field", "stead", "furrow", "barrow"],
  devotional: ["rest", "vigil", "barrow", "hallow"],
};

function nameFor(row: number, col: number, specialty: SettlementSpecialty, used: Set<string>): string {
  const suffixes = SUFFIX_BY_SPECIALTY[specialty];
  for (let attempt = 0; attempt < 64; attempt++) {
    const salt = `${row},${col}#${attempt}`;
    const prefix = PREFIXES[hash(salt) % PREFIXES.length]!;
    const suffix = suffixes[hash(`${salt}:s`) % suffixes.length]!;
    const name = `${prefix}${suffix}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `Holding ${row}-${col}`;
  used.add(fallback);
  return fallback;
}

function chebyshevZones(a: { row: number; col: number }, b: { row: number; col: number }): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

/**
 * Cheapest walkable corridor between two zones — Dijkstra over the zone grid.
 * Mountains and ocean are impassable; rough ground costs more, so a corridor
 * bends around a ridge the way a real track would rather than going over it.
 * Returns row-major zone indices, or undefined if there is no land route.
 */
function corridorBetween(grid: MacroGrid, from: MacroZone, to: MacroZone): number[] | undefined {
  const total = grid.rows * grid.cols;
  const dist = new Float64Array(total).fill(Infinity);
  const prev = new Int32Array(total).fill(-1);
  const visited = new Uint8Array(total);
  const start = zoneIndex(grid, from.row, from.col);
  const goal = zoneIndex(grid, to.row, to.col);
  dist[start] = 0;

  // Small grids and few calls — a linear scan beats the complexity of a heap
  // here, and keeps this dependency-free.
  for (;;) {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < total; i++) {
      if (!visited[i] && dist[i]! < bestDist) {
        bestDist = dist[i]!;
        best = i;
      }
    }
    if (best < 0 || best === goal) break;
    visited[best] = 1;
    const row = Math.floor(best / grid.cols);
    const col = best % grid.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const n = zoneAt(grid, row + dr, col + dc);
        if (!passable(n)) continue;
        const ni = zoneIndex(grid, n!.row, n!.col);
        if (visited[ni]) continue;
        // Base step, plus a penalty for climbing — and a small extra for
        // crossing a river, which is what makes fords and bridges matter.
        const step = 1 + n!.elevation * 1.5 + (n!.riverEdges.length > 0 ? 0.4 : 0);
        const alt = dist[best]! + step;
        if (alt < dist[ni]!) {
          dist[ni] = alt;
          prev[ni] = best;
        }
      }
    }
  }

  if (dist[goal] === Infinity) return undefined;
  const path: number[] = [];
  for (let at = goal; at !== -1; at = prev[at]!) {
    path.push(at);
    if (at === start) break;
  }
  if (path[path.length - 1] !== start) return undefined;
  return path.reverse();
}

/** Era events, each with the cause text a ruin or chronicle entry will carry. */
const ERA_EVENTS: readonly { text: string; cause: string; severity: number }[] = [
  { text: "the long winter", cause: "starved through the long winter", severity: 0.5 },
  { text: "the wasting sickness", cause: "emptied by the wasting sickness", severity: 0.45 },
  { text: "a year the rivers ran low", cause: "abandoned when its water failed", severity: 0.4 },
  { text: "the great herds came down from the hills", cause: "overrun when the great herds came down", severity: 0.4 },
  { text: "a burning summer", cause: "burned in the fires of that summer", severity: 0.35 },
];

/**
 * Run the pass. Deterministic given `grid` and `rng`.
 */
export function generateSettlementHistory(grid: MacroGrid, rng: () => number): SettlementHistory {
  const settlements: Settlement[] = [];
  const roads: RoadEdge[] = [];
  const eraEvents: { era: number; text: string }[] = [];
  const traffic = new Map<number, number>();
  const usedNames = new Set<string>();
  /** The single hardest thing each settlement lived through — see the survival branch below. */
  const worstSurvived = new Map<string, { text: string; severity: number; era: number }>();

  // --- Candidate sites, best first. Fresh water gates this list, so every
  // settlement founded from it satisfies the founding rule by construction.
  const candidates = grid.zones
    .map((zone) => ({ zone, score: siteScore(grid, zone) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const landZones = grid.zones.filter((z) => !z.isOcean).length;
  const originTarget = Math.max(MIN_ORIGINS, Math.min(MAX_ORIGINS, Math.round(landZones / LAND_ZONES_PER_ORIGIN)));

  const found = (zone: MacroZone, era: number, origin: SettlementOrigin, parentId?: string): Settlement => {
    const specialty = specialtyFor(grid, zone);
    const score = siteScore(grid, zone);
    const s: Settlement = {
      id: `settlement-${settlements.length}`,
      name: nameFor(zone.row, zone.col, specialty, usedNames),
      row: zone.row,
      col: zone.col,
      foundedEra: era,
      origin,
      parentId,
      status: "living",
      population: origin === "founding" ? 30 : 18,
      specialty,
      siteScore: score,
      chronicle: [],
    };
    // Say which water. "Founded on fresh water" is written around a hole when
    // the zone record knows whether it is a river, a lake or a spring --
    // go get the value rather than hedging.
    const water = zone.isLake ? "beside the lake" : zone.isRiverSource ? "at the spring" : "on the river";
    s.chronicle.push(
      origin === "founding"
        ? `Era ${era}: ${s.name} was founded ${water}.`
        : `Era ${era}: settlers from ${settlements.find((p) => p.id === parentId)?.name ?? "elsewhere"} founded ${s.name} ${water}.`
    );
    settlements.push(s);
    return s;
  };

  const tooClose = (zone: MacroZone, minimum: number): boolean =>
    settlements.some((s) => chebyshevZones(s, zone) < minimum);

  // --- Origins.
  for (const candidate of candidates) {
    if (settlements.length >= originTarget) break;
    if (tooClose(candidate.zone, MIN_ORIGIN_SEPARATION)) continue;
    found(candidate.zone, 0, "founding");
  }

  // --- Expansion over generations.
  for (let era = 1; era <= ERAS; era++) {
    // An era event lands rarely, and when it does it threatens weak sites.
    let event: (typeof ERA_EVENTS)[number] | undefined;
    let epicentre: { row: number; col: number } | undefined;
    if (rng() < 0.3) {
      event = ERA_EVENTS[Math.floor(rng() * ERA_EVENTS.length)]!;
      // A disaster happens SOMEWHERE. Rolling every settlement in the world
      // against one global event could erase an entire world's people in a
      // bad run — measured, two seeds came out with 0 of 3 and 1 of 7
      // settlements still standing, which is not a history, it is an empty
      // map. A winter is hard in the valley it settles over; the coast three
      // hundred miles away has a normal year.
      const candidateZone = candidates[Math.floor(rng() * candidates.length)];
      epicentre = candidateZone ? { row: candidateZone.zone.row, col: candidateZone.zone.col } : undefined;
      eraEvents.push({ era, text: `Era ${era}: ${event.text}.` });
    }

    for (const s of [...settlements]) {
      if (s.status !== "living") continue;

      // Growth is gated by the site, so a poor site stagnates rather than
      // booming — settlements must not grow on the animal clock.
      s.population = Math.round(s.population * (1 + 0.28 * s.siteScore));

      // Only settlements inside the event's reach are at risk.
      const inReach = event && epicentre ? chebyshevZones(s, epicentre) <= ERA_EVENT_RADIUS : false;
      if (event && inReach) {
        // A good site rides it out; a marginal one does not.
        const survival = s.siteScore * 0.9 + 0.15;
        if (rng() > survival) {
          s.status = "ruined";
          s.ruinedEra = era;
          s.ruinedCause = event.cause;
          s.chronicle.push(`Era ${era}: ${s.name} was ${event.cause}.`);
          continue;
        }
        s.population = Math.round(s.population * (1 - event.severity * 0.5));
        // Deliberately NOT a line per survived event. A chronicle that says
        // "came through X with losses" four times is a table with commas, not
        // a story -- curation is the point. Only the worst one is kept, and
        // it is written out once at the end.
        if (!worstSurvived.has(s.id) || worstSurvived.get(s.id)!.severity < event.severity) {
          worstSurvived.set(s.id, { text: event.text, severity: event.severity, era });
        }
      }
    }

    // Daughters: a settlement with real surplus sends people out.
    for (const parent of [...settlements]) {
      if (parent.status !== "living" || parent.population < SURPLUS_TO_SPLIT) continue;
      const site = candidates.find(
        (c) =>
          chebyshevZones(c.zone, parent) <= MAX_DAUGHTER_DISTANCE &&
          chebyshevZones(c.zone, parent) >= 2 &&
          !tooClose(c.zone, MIN_SETTLEMENT_SEPARATION)
      );
      if (!site) continue;
      const corridor = corridorBetween(grid, grid.zones[zoneIndex(grid, parent.row, parent.col)]!, site.zone);
      if (!corridor) continue;

      const child = found(site.zone, era, "daughter", parent.id);
      parent.population = Math.round(parent.population * 0.62);
      parent.chronicle.push(`Era ${era}: ${parent.name} sent settlers out. They founded ${child.name}.`);

      // The corridor they walked is the first traffic on what becomes a road.
      for (const index of corridor) traffic.set(index, (traffic.get(index) ?? 0) + 1);
      roads.push({ fromId: parent.id, toId: child.id, zoneIndices: corridor, traffic: 1 });
    }

    // Trade: living settlements keep walking to their neighbours, and that
    // repeated traffic is what turns a corridor into a real road. A road
    // exists because it was walked, not because a planner drew it.
    const living = settlements.filter((s) => s.status === "living");
    for (const road of roads) {
      const from = settlements.find((s) => s.id === road.fromId)!;
      const to = settlements.find((s) => s.id === road.toId)!;
      if (from.status !== "living" || to.status !== "living") continue;
      road.traffic++;
      for (const index of road.zoneIndices) traffic.set(index, (traffic.get(index) ?? 0) + 1);
    }
    void living;
  }

  // One curated survival line per settlement that earned one, in era order so
  // it sits correctly among the foundings and the ruin.
  for (const s of settlements) {
    const worst = worstSurvived.get(s.id);
    if (!worst) continue;
    s.chronicle.push(`Era ${worst.era}: ${s.name} lived through ${worst.text}.`);
    s.chronicle.sort((a, b) => Number(/^Era (\d+)/.exec(a)?.[1] ?? 0) - Number(/^Era (\d+)/.exec(b)?.[1] ?? 0));
  }

  return { settlements, roads, eraEvents, traffic };
}
