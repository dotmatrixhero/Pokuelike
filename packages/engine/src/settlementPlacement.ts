/**
 * Turning a macro settlement record into a real place you can walk into.
 *
 * `settlementHistory.ts` decides WHERE people took hold and what became of
 * them, at zone resolution, once at worldgen. This module is the other half:
 * when a zone carrying a settlement is promoted to a live, tile-resolution
 * world, it lays the town out on the ground and puts its people in it.
 *
 * It follows the same "carry it down once, at promotion" treatment
 * `overworld.ts` already uses for `territoryName` and `sanctuaryDistance` —
 * this is not a per-tick system.
 *
 * Built entirely from terrain the sim already understands:
 *  - `"shelter"` for homes, so shelter.ts's existing "is there shelter near
 *    me" logic, home-seeking and shelter decay all apply to a town for free.
 *  - `"wall"` for the palisade. Direct decision: *"Build walls, keep
 *    lethal."* The ecology is not being softened to make towns survivable;
 *    the wall is the thing that makes them survivable, so it is structural
 *    rather than decorative.
 */
import { pickCrop } from "./crops.js";
import { dominantBiomeAt, effectiveWaterDensityAt } from "./worldgen.js";
import type { Settlement } from "./settlementHistory.js";
import type { Agent, Vec2, World } from "./types.js";
import { isWalkableTerrain, setTile, tileAt } from "./world.js";

/** What a promoted zone knows about the settlement standing in it. */
export interface SettlementPresence {
  id: string;
  name: string;
  specialty: Settlement["specialty"];
  status: Settlement["status"];
  /** Abstract head-count from the history pass — the town's real population, of which only a few are live agents. */
  population: number;
  /** Town centre in tile coordinates. */
  center: Vec2;
  /** Only set on a ruin: why it fell, already phrased for a chronicle. */
  ruinedCause?: string;
  /** How many tiles of worked field this town laid out around itself. 0 for a ruin. */
  fieldTiles: number;
}

/**
 * How many villagers exist as REAL agents, regardless of the town's actual
 * population. HUMAN_PASS.md's architecture fork: a settlement is one entity
 * carrying a population count plus a few individuated agents, because 20
 * towns of 50 people would be ~1000 behaviour trees against a current world
 * of roughly 25 agents.
 */
export const MIN_INDIVIDUATED = 3;
export const MAX_INDIVIDUATED = 8;

/** Roles a town's named people hold, picked to suit what the town is known for. */
const ROLES_BY_SPECIALTY: Record<Settlement["specialty"], readonly string[]> = {
  farming: ["elder", "farmer", "farmer", "granary-keeper", "guard"],
  smithing: ["elder", "smith", "smith", "collier", "guard"],
  merchant: ["elder", "trader", "trader", "carter", "guard"],
  port: ["elder", "fisher", "fisher", "boatwright", "guard"],
  timber: ["elder", "woodcutter", "woodcutter", "carpenter", "guard"],
  devotional: ["elder", "keeper", "keeper", "healer", "guard"],
};

function chebyshev(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Somewhere buildable: on the map, walkable, and not already water. */
function buildable(world: World, x: number, y: number): boolean {
  const tile = tileAt(world, "surface", x, y);
  if (!tile) return false;
  if (tile.terrain === "water") return false;
  return isWalkableTerrain(tile.terrain) || tile.terrain === "tree" || tile.terrain === "bush";
}

/**
 * Pick a town centre: enough dry ground around it to actually build on, and
 * water within reach but NOT underfoot.
 *
 * The first version scored `min(water, 8) * 1.5`, which maximised nearby
 * water and therefore put towns on slivers of land surrounded by sea — the
 * palisade ring landed entirely in water and no wall got built at all,
 * which quietly cancelled the "build walls, keep lethal" decision. Water
 * proximity is a REQUIREMENT, not something to maximise; buildable land is
 * the thing to maximise.
 */
function chooseCenter(world: World, radius: number): Vec2 | undefined {
  const mid = { x: Math.floor(world.width / 2), y: Math.floor(world.height / 2) };
  let best: Vec2 | undefined;
  let bestScore = -Infinity;
  for (let y = 2; y < world.height - 2; y++) {
    for (let x = 2; x < world.width - 2; x++) {
      if (!buildable(world, x, y)) continue;

      // Water has to be reachable, but it is a gate rather than a score.
      let waterNear = 0;
      for (let dy = -4; dy <= 4 && waterNear === 0; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          if (tileAt(world, "surface", x + dx, y + dy)?.terrain === "water") { waterNear = 1; break; }
        }
      }
      if (!waterNear) continue;

      // What actually matters: buildable ground across the footprint, and a
      // ring that can carry a palisade.
      let ground = 0;
      let ring = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ok = buildable(world, x + dx, y + dy);
          if (ok) ground++;
          if (ok && Math.max(Math.abs(dx), Math.abs(dy)) === radius) ring++;
        }
      }
      const score = ground + ring * 2 - chebyshev({ x, y }, mid) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * How many field plots a town lays out, before the farming-town bonus. Scales
 * with population, because fields are what feed it.
 */
function plotCountFor(population: number, specialty: Settlement["specialty"]): number {
  const base = Math.max(1, Math.min(5, Math.round(population / 22)));
  return specialty === "farming" ? base + 2 : base;
}

/**
 * Fields: the "worked ring" — terrain REPLACED rather than thinned, sitting
 * outside the palisade between the town and the wild.
 *
 * The tell is ORDER. Wild flora scatters (flora.ts germinates it against a
 * noise field); a field is a rectangle of a single crop in rows, with bare
 * furrows between them. That contrast is the whole visual point, and it is
 * why a plot grows one crop rather than a mix — a field of one thing reads as
 * planted, a field of five reads as undergrowth.
 *
 * Crops come from `pickCrop`, so a field grows what this biome and season
 * could really support, and the tiles are ordinary "seedling"/"food" terrain
 * carrying a `flavor` — meaning flora.ts's existing growth, harvest, drought
 * and winter rules all apply to a farm for free, and so does being eaten.
 */
function layOutFields(
  world: World,
  center: Vec2,
  radius: number,
  settlement: Settlement,
  rng: () => number,
  occupied: (pos: Vec2) => boolean
): number {
  const plots = plotCountFor(settlement.population, settlement.specialty);
  let placed = 0;
  for (let plot = 0; plot < plots; plot++) {
    const w = 4 + Math.floor(rng() * 3);
    const h = 3 + Math.floor(rng() * 2);

    // Somewhere just beyond the wall, in a ring around the town — but try a
    // few spots in that arc and keep the most workable one. Taking the first
    // roll put plots straight into the sea around a coastal town and left
    // them as two or three surviving tiles, which reads as scrub rather than
    // as a field. Nobody ploughs open water.
    let ox = 0;
    let oy = 0;
    let bestWorkable = -1;
    for (let attempt = 0; attempt < 6; attempt++) {
      const angle = (plot / plots) * Math.PI * 2 + (rng() - 0.5) * 1.1;
      const distance = radius + 2 + Math.floor(rng() * 3);
      const cx = center.x + Math.round(Math.cos(angle) * distance);
      const cy = center.y + Math.round(Math.sin(angle) * distance);
      let workable = 0;
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (buildable(world, cx + dx, cy + dy) && !occupied({ x: cx + dx, y: cy + dy })) workable++;
        }
      }
      if (workable > bestWorkable) {
        bestWorkable = workable;
        ox = cx;
        oy = cy;
      }
      if (workable === w * h) break; // nothing to improve on
    }
    // A plot that is still mostly unusable is not a field; skip it rather
    // than scattering a handful of orphan crop tiles.
    if (bestWorkable < Math.ceil((w * h) * 0.5)) continue;

    // One crop per plot, chosen for this spot rather than picked at random —
    // same biome-blend and moisture-proxy lookups flora.ts's own germination
    // uses, so a field grows what this ground could really support.
    const biome = dominantBiomeAt(world.biomeSeeds, ox, oy);
    const moisture = effectiveWaterDensityAt(world.biomeSeeds, world.biomeSeedDrift, ox, oy);
    // Surface fields only: Potato/Pumpkin are underground-native and Apple is
    // canopy-native, and a ploughed field is none of those.
    const crop = pickCrop(biome, moisture, world.tick, false, rng, ["underground", "canopy"]);

    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = ox + dx;
        const y = oy + dy;
        if (!buildable(world, x, y)) continue;
        if (occupied({ x, y })) continue;
        // Every third column stays bare: the furrow you walk down. Without
        // it a plot is a solid block of food and reads as a thicket.
        if (dx % 3 === 2) {
          setTile(world, "surface", x, y, "floor");
          const furrow = tileAt(world, "surface", x, y);
          // The furrow is worked land too — it is the path between the rows,
          // not a gap in the field.
          if (furrow) furrow.farmed = true;
          continue;
        }
        // A real field is not uniformly ripe. Most of it is still growing.
        setTile(world, "surface", x, y, rng() < 0.35 ? "food" : "seedling");
        const tile = tileAt(world, "surface", x, y);
        if (tile) {
          tile.flavor = crop;
          tile.farmed = true;
        }
        placed++;
      }
    }
  }
  return placed;
}

/**
 * Lay the town out and return its presence record, or undefined if the zone
 * had nowhere to put one (all water, say).
 *
 * A LIVING settlement gets homes, a palisade with real gateways, and its
 * individuated people. A RUINED one gets broken walls and empty houses and
 * nobody — HUMAN_GEOGRAPHY.md's point that a ruin is better content than a
 * village that was never there, provided the land remembers.
 */
export function placeSettlement(
  world: World,
  settlement: Settlement,
  rng: () => number,
  makeVillager?: (id: string, pos: Vec2, role: string) => Agent
): SettlementPresence | undefined {
  const ruined = settlement.status === "ruined";
  // A bigger town covers more ground, but stays well inside one zone — the
  // worked and gathered rings that spread further are a later phase.
  // Computed BEFORE the centre, because the centre is chosen partly on
  // whether a ring of this radius can actually carry a palisade.
  const radius = Math.max(3, Math.min(7, Math.round(2 + Math.sqrt(settlement.population) / 2.2)));

  const center = chooseCenter(world, radius);
  if (!center) return undefined;

  // --- Palisade: a ring of wall with gaps for gates. On a ruin, most of it
  // has fallen, so the ring is broken and the town is open.
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      const x = center.x + dx;
      const y = center.y + dy;
      if (!buildable(world, x, y)) continue;
      // Gateways on the four axes, so the town is enterable and roads have
      // somewhere to arrive.
      if (dx === 0 || dy === 0) continue;
      if (ruined && rng() < 0.65) continue; // fallen
      setTile(world, "surface", x, y, "wall");
    }
  }

  // --- Homes: a loose cluster inside the wall, never on the centre itself,
  // which stays open as the square.
  const homeTarget = Math.max(2, Math.min(14, Math.round(settlement.population / 9)));
  const homes: Vec2[] = [];
  for (let attempt = 0; attempt < homeTarget * 12 && homes.length < homeTarget; attempt++) {
    const dx = Math.round((rng() * 2 - 1) * (radius - 1));
    const dy = Math.round((rng() * 2 - 1) * (radius - 1));
    if (dx === 0 && dy === 0) continue;
    const x = center.x + dx;
    const y = center.y + dy;
    if (!buildable(world, x, y)) continue;
    if (homes.some((h) => chebyshev(h, { x, y }) < 2)) continue;
    setTile(world, "surface", x, y, "shelter");
    homes.push({ x, y });
  }

  // Fields, outside the wall. A ruin gets none: its fields went back to the
  // wild generations ago, and that absence is part of what makes a ruin read
  // as one. (HUMAN_GEOGRAPHY.md's reversibility point — the land forgets the
  // work, not the fact that people were here.)
  const fieldTiles = ruined
    ? 0
    : layOutFields(world, center, radius, settlement, rng, (pos) =>
        // Never pave over the town itself: homes, the palisade, or the square.
        chebyshev(pos, center) <= radius || homes.some((h) => chebyshev(h, pos) === 0)
      );

  const presence: SettlementPresence = {
    id: settlement.id,
    name: settlement.name,
    specialty: settlement.specialty,
    status: settlement.status,
    population: ruined ? 0 : settlement.population,
    center,
    ruinedCause: settlement.ruinedCause,
    fieldTiles,
  };

  // --- People. A ruin has none, and that absence is the point.
  if (ruined || !makeVillager) return presence;

  const roles = ROLES_BY_SPECIALTY[settlement.specialty];
  const count = Math.max(MIN_INDIVIDUATED, Math.min(MAX_INDIVIDUATED, Math.round(settlement.population / 12)));
  for (let i = 0; i < count; i++) {
    const role = roles[i % roles.length]!;
    // Stand them near a home where possible, so a town reads as inhabited
    // rather than as a crowd milling in the square.
    const anchor = homes[i % Math.max(1, homes.length)] ?? center;
    let pos: Vec2 | undefined;
    for (let attempt = 0; attempt < 24 && !pos; attempt++) {
      const x = anchor.x + Math.round((rng() * 2 - 1) * 2);
      const y = anchor.y + Math.round((rng() * 2 - 1) * 2);
      const tile = tileAt(world, "surface", x, y);
      if (!tile || !isWalkableTerrain(tile.terrain)) continue;
      if (world.agents.some((a) => a.pos.x === x && a.pos.y === y && a.layer === "surface")) continue;
      pos = { x, y };
    }
    if (!pos) continue;
    const agent = makeVillager(`${settlement.id}-villager-${i}`, pos, role);
    agent.homePos = { ...anchor };
    world.agents.push(agent);
  }

  return presence;
}
