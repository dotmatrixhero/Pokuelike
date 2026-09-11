import {
  generateWorld,
  findWalkableNear,
  findPosInBiome,
  createNeeds,
  setTile,
  tileAt,
  updatePlayerVision,
  type Agent,
  type Layer,
  type TerrainKind,
  type Vec2,
  type World,
} from "@pokuelike/engine";
import { spawnAgent } from "./spawn.js";
import { SPECIES } from "./species.js";
import { BARE_HANDS_MOVES, ITEMS, KNOWN_AT_START, RECIPES } from "./crafting.js";

/**
 * ~90x60 (up from the old hand-authored 24x16) — DESIGN.md's "something like
 * 80x60 or bigger" ask. Picked as an exact 3.75x scale-up of the old 24x16
 * box (90 = 24*3.75, 60 = 16*3.75) purely so the old hand-picked spawn
 * anchors below scale cleanly onto the new map without re-deriving them from
 * scratch; the actual terrain is now fully procedural, not a scaled-up copy
 * of the old layout. Confirmed to run fine at this size in a real 1000-tick
 * run (see DESIGN.md's findings) with the resourceIndex.ts fix in place —
 * see that file's doc comment for why the naive O(width*height) nearest-tile
 * scan needed addressing at this scale.
 */
export const SCENARIO_WIDTH = 90;
export const SCENARIO_HEIGHT = 60;

/**
 * Fixed seed for the one demo world both apps show — deterministic and
 * reproducible (see worldgen.ts), so a bug reported against "the demo world"
 * is always the same map. Change it to get a different roll of the same
 * biome/generation parameters.
 */
export const SCENARIO_SEED = 20260903;

/** The old hand-authored map's dimensions — every anchor below is expressed in these coordinates, then scaled. */
const OLD_WIDTH = 24;
const OLD_HEIGHT = 16;
const SCALE_X = SCENARIO_WIDTH / OLD_WIDTH;
const SCALE_Y = SCENARIO_HEIGHT / OLD_HEIGHT;

/**
 * Scales one of the old 24x16 hand-authored map's coordinates onto the new
 * generated map, then finds the nearest actually-walkable tile to it — the
 * old anchors picked sensible, spread-out *territories* (herd land,
 * Scyther's hunting ground, etc.), which is still useful structure to keep,
 * but procedural generation doesn't guarantee the exact scaled tile itself
 * is walkable (it might land on a boulder, tree, or lake).
 */
function anchor(world: World, x: number, y: number) {
  return findWalkableNear(world, "surface", x * SCALE_X, y * SCALE_Y);
}

/**
 * Same idea as `undergroundAnchor`, for Canopy. Real bug this closes: this
 * file used to compute Canopy spawn positions with the unchecked `scaledPos`
 * above, back when Canopy really was always a plain fully-walkable flat grid
 * (see worldgen.ts's own doc comment history). It no longer is —
 * `generateWorld` now derives real "wall" (unwalkable) canopy from Surface
 * wherever there's no tree or massif ridge nearby (CROPS_DESIGN.md) — so an
 * unchecked scaled anchor could land the Pidgey flock or Spearow in an
 * unwalkable gap on some seeds, the exact same class of bug
 * `undergroundAnchor` already fixed for Underground once cave generation
 * gave that layer real walls too.
 */
function canopyAnchor(world: World, x: number, y: number) {
  return findWalkableNear(world, "canopy", x * SCALE_X, y * SCALE_Y);
}

/**
 * Same idea as `anchor`, but for the Underground layer specifically. Real
 * bug this closes: worldgen.ts's Underground layer used to always be a
 * plain, fully-walkable flat grid (this file's own `scaledPos` doc comment
 * used to say so), so a scaled-but-unchecked anchor was safe there — it no
 * longer is now that `generateWorld` carves real cellular-automata cave
 * structure (real "wall" tiles) into Underground too. A fixed anchor could
 * otherwise land inside solid rock on some seeds, stranding a hand-placed
 * founder from tick 0 (the exact same class of bug the Surface layer's
 * large-water-body fix closed for `findWalkableNear` itself) — this reuses
 * that same fixed `findWalkableNear`, just pointed at "underground" instead
 * of "surface".
 */
function undergroundAnchor(world: World, x: number, y: number) {
  return findWalkableNear(world, "underground", x * SCALE_X, y * SCALE_Y);
}

/**
 * `worldgen.ts`'s own `findWalkableNear`, but for real "water" terrain
 * specifically — needed because `findWalkableNear` treats any walkable
 * tile as an equally valid hit (water included, since `UNWALKABLE_TERRAIN`
 * never lists "water" — see `waterBody.ts`'s doc comment), so it can just
 * as easily land on dry land as on water. An obligate-aquatic founder
 * (`spawnAgent`'s caller below) needs to start on an ACTUAL water tile, not
 * merely a walkable one: `canEnterLand` would otherwise immediately treat a
 * dry-land starting position more than one tile from any water as
 * off-limits, stranding the founder from tick 0. Ring search outward from
 * `(x, y)`, same shape as `findWalkableNear` (nearest ring first), so this
 * reads as "the real water this species actually needs" version of the
 * same idea rather than a different algorithm. Real bug this closes: an
 * earlier version of this feature hardcoded a raw coordinate instead
 * (assuming it was a water tile on the one seed it was eyeballed against),
 * which put both founders on dry land — silently different terrain — on
 * every OTHER seed, since `SCENARIO_SEED`'s own generated map isn't the
 * only one `createDemoWorld(seed)` is ever called with (see this
 * session's own multi-seed validation runs). Falls back to `(x, y)` itself
 * if the whole map genuinely has no water tile at all (shouldn't happen —
 * `worldgen.ts`'s biome water densities are never 0 — but this avoids an
 * infinite loop over a pathological hand-built `World` in a test).
 */
function findWaterNear(world: World, x: number, y: number): Vec2 {
  const cx = Math.min(world.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(world.height - 1, Math.max(0, Math.round(y)));
  const maxRadius = Math.max(world.width, world.height);

  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue;
        if (tileAt(world, "surface", nx, ny)?.terrain === "water") return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}

/**
 * The one demo world both the browser app and the headless runner show: a
 * Bulbasaur herd near a water hole guarded by Venusaur, a Scyther hunting
 * from its own separate territory, an underground Diglett/Sandshrew colony
 * hunted by Onix, a canopy Pidgey flock hunted by Spearow, a Squirtle
 * pair at the same water hole as the Bulbasaur herd — the roster's first
 * Water-type — and a Magikarp/Tentacool pair actually living IN that same
 * water hole's deep water, the roster's first obligate-aquatic residents
 * (see species.ts's `obligateAquatic`) — the same predator/prey pattern
 * repeated on all three layers
 * (see DESIGN.md's species-expansion section). Underground/canopy have no
 * food or water tiles of their own, so every agent down there or up there
 * routinely crosses to the surface for both — a deliberate reuse of the
 * existing cross-layer need-seeking mechanic rather than triplicating the
 * resource map per layer. Every agent gets real stats/types/moves via
 * spawnAgent — see DESIGN.md's combat section.
 *
 * The surface layer itself is now procedurally generated (worldgen.ts) —
 * biomes, obstacles, elevation, all real terrain variety instead of one
 * hand-authored flat 24x16 box with two water holes and a couple of walls.
 * See DESIGN.md's "Environmental generation, biomes, obstacles, and
 * elevation-aware movement/fog" section for the full design and real-run
 * findings.
 */
/**
 * `createDemoWorld` plus one player-controlled human — ROADMAP.md's M0. A
 * separate constructor rather than a flag on `createDemoWorld`, so every
 * existing test and validator keeps its exact deterministic world: adding an
 * agent shifts rng consumption and would silently change every seed's run.
 *
 * The player is placed a little apart from the bulbasaur herd (which spawns
 * around x=5..9, y=6..7) so the first thing you can do is walk toward it and
 * watch it react — that walk is M0's acceptance test.
 */
export function createPlayerDemoWorld(seed: number = SCENARIO_SEED): World {
  const world = createDemoWorld(seed);
  const player: Agent = {
    ...spawnAgent("human", "player", anchor(world, 14, 12), 5, world.rng),
    controlledBy: "player",
    sex: "female",
  };
  world.agents.push(player);
  // MOVES_AND_TOOLS.md's weakened bare-hands baseline — see createCaveScenario's own comment on this same assignment.
  world.playerBaseMoves = BARE_HANDS_MOVES;
  player.moves = [...BARE_HANDS_MOVES];
  updatePlayerVision(world, player);
  return world;
}

/** Nearest tile of `terrain` on `layer` by Chebyshev ring search — `findWaterNear` generalised past its surface-only hardcode. Falls back to the origin if none exists. */
function findTerrainNear(world: World, layer: Layer, x: number, y: number, terrain: TerrainKind): Vec2 {
  const cx = Math.min(world.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(world.height - 1, Math.max(0, Math.round(y)));
  for (let r = 0; r <= Math.max(world.width, world.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (tileAt(world, layer, nx, ny)?.terrain === terrain) return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}

/**
 * The nearest walkable, genuinely dry (non-water) tile to `(x, y)` — a real,
 * sampled bug found this was needed: `findWalkableNear` (worldgen.ts) only
 * rejects water belonging to a LARGE body (`canEnterWater`'s own doc
 * comment — "an ordinary pond/puddle/stream" is unrestricted for every
 * agent), so it happily returned the anchor itself when seeded at the
 * CENTER of one of `generateUndergroundCaves`'s small guaranteed water
 * pockets — several tiles deep into the pool, surrounded on every side by
 * more water out to the pocket's own radius. `walkDistances` (right below)
 * never steps onto ANY water tile at all, large body or small, so a BFS
 * seeded there found zero neighbors and stayed a single-point map — the
 * player spawned standing IN the water. This is the same ring-search shape
 * as `findWalkableNear`, just without that large-body exemption.
 */
function nearestDryLand(world: World, layer: Layer, x: number, y: number): Vec2 {
  const cx = Math.round(x), cy = Math.round(y);
  const maxRadius = Math.max(world.width, world.height);
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        const t = tileAt(world, layer, nx, ny);
        if (t?.walkable && t.terrain !== "water") return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}

/** BFS step-distance from `from` over walkable tiles of `layer` (8-way). Unreachable tiles are absent. */
export function walkDistances(world: World, layer: Layer, from: Vec2): Map<string, number> {
  const dist = new Map<string, number>();
  const key = (x: number, y: number) => `${x},${y}`;
  const queue: Vec2[] = [from];
  dist.set(key(from.x, from.y), 0);
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(key(cur.x, cur.y))!;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cur.x + dx, ny = cur.y + dy;
      const k = key(nx, ny);
      if (dist.has(k)) continue;
      const t = tileAt(world, layer, nx, ny);
      if (!t || !t.walkable || t.terrain === "water") continue;
      dist.set(k, d + 1);
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

/** How far into the dark the cave player starts from the lit chamber, in walking steps. Far enough that the light is not on screen at spawn; near enough that the first walk is a minute, not an expedition. */
export const CAVE_SPAWN_MIN_STEPS = 22;
export const CAVE_SPAWN_MAX_STEPS = 40;
/** Radius of the lit chamber painted around the underground water pocket. */
const CAVE_CHAMBER_RADIUS = 5;

/**
 * Who might be waiting in the chamber — direct ask: "I want starting cave
 * to be a random pack of prey. Some options like eevee, Pikachu, bulbasaur,
 * charmander, squirtle are all good. Sandshrew is acceptable too. Let's
 * make a decent wide pool." One species is rolled per world (a herd is
 * one species — `HerdRecord.species`, `herds.ts` — so this is "which pack
 * did I find" rather than a mixed chamber), same 4-member herd shape
 * Sandshrew always had. Every entry here is a base-stage, non-predator
 * species (checked against `SPECIES`'s `isPredator` flags) — nothing
 * that reads as a threat on the first thing the player ever meets, and
 * nothing that's secretly a stronger evolved form at the same level 5.
 * Not cave-habitat-accurate on purpose (Charmander/Squirtle aren't
 * burrowers either) — the user's own named examples aren't, so variety
 * wins over biome realism for this one chamber.
 */
export const CAVE_STARTER_SPECIES: readonly string[] = [
  "eevee",
  "pikachu",
  "bulbasaur",
  "charmander",
  "squirtle",
  "sandshrew",
  "pidgey",
  "rattata",
  "caterpie",
  "weedle",
  "oddish",
  "poliwag",
  "psyduck",
  "magikarp",
  "cubone",
  "vulpix",
  "growlithe",
  "clefairy",
  "jigglypuff",
  "nidoranf",
  "nidoranm",
  "abra",
  "paras",
  "bellsprout",
  "geodude",
  "horsea",
  "shellder",
  "krabby",
  "seel",
  "dratini",
  "ponyta",
  "doduo",
  "venonat",
  "machop",
  "tangela",
  "drowzee",
];

/**
 * ROADMAP.md M1 — Act 1, layer 1: a dark cave with one lit chamber. Not a
 * worldgen overhaul: `generateWorld` already carves cellular-automata caves
 * on the underground layer with a guaranteed water pocket and guaranteed
 * connectivity (see worldgen.test.ts). This hand-places what the opening
 * needs on top of that and nothing else:
 *
 * - **The lit chamber** around the water pocket: `sunbeam` on most floor
 *   tiles (worldgen only ever places sunbeams on surface, so a cave has none
 *   without this), with a little food and flora. CAMPAIGN_DESIGN.md: "an
 *   underground lake... with lots of sunlight and plants. It's peaceful,
 *   prey only, but herds."
 * - **One prey herd** at the chamber — a random species from
 *   `CAVE_STARTER_SPECIES` per world, so replaying with a new seed can
 *   turn up an Eevee pack instead of Sandshrew.
 * - **The player in the dark**, `CAVE_SPAWN_MIN_STEPS`..`MAX` walking steps
 *   from the water by BFS over walkable underground tiles — so the light is
 *   reachable *by construction*, never by luck of the seed. The acceptance
 *   test ("spawn in the dark and walk to the light") is a property of how
 *   the spawn is chosen, and scenario.test.ts asserts it on several seeds.
 *
 * The surface and canopy layers are generated as usual but left empty of
 * agents: M1 is the cave, and surface herds would only spend ticks and
 * clutter the event log. What the cave still lacks — ground types, a real
 * fertility economy, deadwood — is M7's problem (ROADMAP.md).
 */
export function createCaveScenario(seed: number = SCENARIO_SEED): World {
  const world = generateWorld(SCENARIO_WIDTH, SCENARIO_HEIGHT, seed);
  const L: Layer = "underground";
  const rng = world.rng;

  // `generateUndergroundCaves` now places several water pockets (direct
  // report: "I need more water around the cave"), so a plain nearest-to-
  // center search could just as easily land the hand-authored chamber on
  // one of the smaller extra pockets instead of the deliberate, wet-
  // density-weighted main one — `world.primaryUndergroundWaterAt` names
  // that main pocket's own generation CENTER directly, and `nearestDryLand`
  // (above) walks that back to real dry ground beside the pool — the
  // actual chamber anchor this scenario always needed. The plain
  // `findTerrainNear` spiral (for "water" terrain, from the map's own
  // center) is only a defensive fallback for the untested-in-practice case
  // a cave generated with no floor to seed a pocket from at all.
  const chamberCenter = world.primaryUndergroundWaterAt
    ? nearestDryLand(world, L, world.primaryUndergroundWaterAt.x, world.primaryUndergroundWaterAt.y)
    : findTerrainNear(world, L, SCENARIO_WIDTH / 2, SCENARIO_HEIGHT / 2, "water");

  // The chamber: light and growth in a ring around the water.
  for (let dy = -CAVE_CHAMBER_RADIUS; dy <= CAVE_CHAMBER_RADIUS; dy++) {
    for (let dx = -CAVE_CHAMBER_RADIUS; dx <= CAVE_CHAMBER_RADIUS; dx++) {
      const x = chamberCenter.x + dx, y = chamberCenter.y + dy;
      const t = tileAt(world, L, x, y);
      if (!t || t.terrain !== "floor") continue;
      const roll = rng();
      if (roll < 0.55) setTile(world, L, x, y, "sunbeam", t.elevation);
      else if (roll < 0.67) {
        setTile(world, L, x, y, "food", t.elevation);
        // Ruling: "I want gathering on layer 1." About a third of the
        // chamber's patches are herbs — the poultice's input — so M5's
        // crafting cut is makeable without leaving the layer.
        if (roll < 0.59) tileAt(world, L, x, y)!.flavor = "herbs";
      } else if (roll < 0.77) setTile(world, L, x, y, "flora", t.elevation);
    }
  }

  // One species rolled for the whole herd — a herd is one species
  // (herds.ts's `HerdRecord.species`) — from the wide prey pool.
  const startingSpecies = CAVE_STARTER_SPECIES[Math.floor(rng() * CAVE_STARTER_SPECIES.length)]!;
  const herd = Array.from({ length: 4 }, (_, i) => ({
    ...spawnAgent(startingSpecies, `${startingSpecies}-${i}`, findWalkableNear(world, L, chamberCenter.x + (i % 2 ? 2 : -2), chamberCenter.y + (i < 2 ? -2 : 2)), 5, rng),
    needs: createNeeds({ thirst: 0.5 + i * 0.1 }),
    herdId: `${startingSpecies}-herd`,
    // Most of the pool lives on `surface` by species default (only
    // Sandshrew's own `homeLayer` is underground) — the chamber is where
    // this herd actually is, regardless of species norm.
    layer: L,
    homeLayer: L,
    sex: (i % 2 === 0 ? "male" : "female") as "male" | "female",
  }));

  // The player: a walkable tile a real walk away from the light.
  const dist = walkDistances(world, L, chamberCenter);
  const band: Vec2[] = [];
  let farthest: { pos: Vec2; d: number } | undefined;
  for (const [k, d] of dist) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (d >= CAVE_SPAWN_MIN_STEPS && d <= CAVE_SPAWN_MAX_STEPS) band.push({ x, y });
    if (!farthest || d > farthest.d) farthest = { pos: { x, y }, d };
  }
  const spawn = band.length ? band[Math.floor(rng() * band.length)]! : farthest!.pos;
  const player: Agent = {
    ...spawnAgent("human", "player", spawn, 5, rng),
    controlledBy: "player",
    layer: L,
    homeLayer: L,
    sex: "female",
  };

  world.agents.push(...herd, player);
  // ROADMAP.md M5: the crafting tables and what a human knows on day one.
  world.recipes = RECIPES;
  world.items = ITEMS;
  player.knownRecipes = [...KNOWN_AT_START];
  // MOVES_AND_TOOLS.md: "the player's loadout is their moveset" — replaces
  // whatever `spawnAgent("human", ...)` resolved from the species' own
  // `moves: ["tackle"]` learnset (full creature-strength Tackle) with the
  // doc's weakened bare-hands baseline; a held item's own grants layer on
  // top of this via `player.ts`'s `syncPlayerMoves`.
  world.playerBaseMoves = BARE_HANDS_MOVES;
  player.moves = [...BARE_HANDS_MOVES];
  // The first frame is honest: fog is already down before the first key.
  updatePlayerVision(world, player);
  return world;
}

/** ROADMAP.md M7 Climb — how many cave levels a run chains together. */
export const CAVE_RUN_DEPTH = 5;

interface CaveLevelPopulation {
  predators: { species: string; count: number; level: number }[];
  prey: { species: string; count: number; level: number }[];
}

/**
 * Real underground roster (`species.ts`), escalating with depth — not
 * invented placeholders. Zubat (a real predator, low level) -> Golbat (its
 * own evolution, higher level) -> Onix (the roster's heaviest melee
 * predator) -> Haunter (an ambush predator) guarding the exit. Prey species
 * are the same underground natives (Diglett/Sandshrew/Dugtrio) the
 * chamber's own herd draws from — see `CAVE_STARTER_SPECIES`.
 */
const CAVE_RUN_POPULATION: Record<number, CaveLevelPopulation> = {
  2: {
    predators: [{ species: "zubat", count: 3, level: 8 }],
    prey: [{ species: "diglett", count: 3, level: 6 }],
  },
  3: {
    predators: [{ species: "golbat", count: 2, level: 15 }],
    prey: [
      { species: "sandshrew", count: 2, level: 10 },
      { species: "diglett", count: 2, level: 10 },
    ],
  },
  4: {
    predators: [{ species: "onix", count: 3, level: 22 }],
    prey: [{ species: "dugtrio", count: 2, level: 16 }],
  },
  5: {
    predators: [{ species: "haunter", count: 2, level: 28 }],
    prey: [],
  },
};

function buildDeeperLevel(seed: number, depth: number): World {
  const world = generateWorld(SCENARIO_WIDTH, SCENARIO_HEIGHT, seed ^ (depth * 0x9e3779b1));
  const pop = CAVE_RUN_POPULATION[depth]!;
  let i = 0;
  for (const group of [...pop.predators, ...pop.prey]) {
    for (let n = 0; n < group.count; n++) {
      const pos = findWalkableNear(world, "underground", Math.floor(world.rng() * SCENARIO_WIDTH), Math.floor(world.rng() * SCENARIO_HEIGHT));
      world.agents.push(spawnAgent(group.species, `${group.species}-${depth}-${i++}`, pos, group.level, world.rng));
    }
  }
  return world;
}

function farthestReachable(dist: Map<string, number>, fallback: Vec2): Vec2 {
  let best = fallback;
  let bestDist = -1;
  for (const [key, d] of dist) {
    if (d > bestDist) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      best = { x, y };
      bestDist = d;
    }
  }
  return best;
}

/**
 * How far along the real walk from where the player lands to the stairs/
 * exit each lit waypoint sits, as a fraction of that walk's total length —
 * direct report: "can't find the exit... need some better design to help
 * guide." Two waypoints (not one) so the run reads as a real trail getting
 * denser toward the goal, not one coincidental lit room.
 */
const LIT_TRAIL_WAYPOINT_FRACTIONS = [1 / 3, 2 / 3] as const;
/** Small — a real lit alcove along the way, not a corridor-length floodlight that would give away the destination outright. */
const LIT_TRAIL_WAYPOINT_RADIUS = 2;

/**
 * Lights a couple of small waypoints along the real walk from `anchor`
 * (where the player actually lands on this level) toward wherever the
 * stairs/exit ended up — direct report: "the starting cave feels very
 * open and hard to see what's going on. Can't find the exit. Need some
 * better design to help guide." Reuses the exact mechanic vision.ts's own
 * doc comment calls "the whole M1 fantasy" (spawn in the dark, walk to the
 * light) rather than inventing a compass or a HUD arrow — a real diegetic
 * trail, not a UI hint, and one that still requires exploring rather than
 * pointing straight at the goal. `dist` is the same walk-distance map
 * `attachStairsDown`/`attachExit` already computed to place the target
 * tile, so this costs no extra BFS.
 */
function litTrailToward(world: World, dist: Map<string, number>, targetDist: number, rng: () => number): void {
  for (const fraction of LIT_TRAIL_WAYPOINT_FRACTIONS) {
    const desired = targetDist * fraction;
    let bestKey: string | undefined;
    let bestDiff = Infinity;
    for (const [key, d] of dist) {
      const diff = Math.abs(d - desired);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestKey = key;
      }
    }
    if (!bestKey) continue;
    const [cx, cy] = bestKey.split(",").map(Number) as [number, number];
    for (let dy = -LIT_TRAIL_WAYPOINT_RADIUS; dy <= LIT_TRAIL_WAYPOINT_RADIUS; dy++) {
      for (let dx = -LIT_TRAIL_WAYPOINT_RADIUS; dx <= LIT_TRAIL_WAYPOINT_RADIUS; dx++) {
        if (Math.hypot(dx, dy) > LIT_TRAIL_WAYPOINT_RADIUS + 0.5) continue;
        const t = tileAt(world, "underground", cx + dx, cy + dy);
        if (t && t.terrain === "floor" && rng() < 0.7) setTile(world, "underground", cx + dx, cy + dy, "sunbeam", t.elevation);
      }
    }
  }
}

/**
 * Places a `"stairsDown"` tile at the farthest walkable point from where
 * the player actually lands on this level (`world.stairsUpAt`, when this
 * level was reached via stairs down from above — level 1 has no such
 * landing, so it falls back to its own center) — a real walk, not
 * adjacent to wherever the player lands.
 */
function attachStairsDown(world: World, depth: number): void {
  const anchor = world.stairsUpAt ?? findWalkableNear(world, "underground", world.width / 2, world.height / 2);
  const dist = walkDistances(world, "underground", anchor);
  const pos = farthestReachable(dist, anchor);
  setTile(world, "underground", pos.x, pos.y, "stairsDown");
  world.stairsDownAt = pos;
  if (world.stairsUpAt) litTrailToward(world, dist, dist.get(`${pos.x},${pos.y}`) ?? 0, world.rng);
}

/** Same placement rule as `attachStairsDown`, for the deepest level's exit instead. */
function attachExit(world: World): void {
  const anchor = world.stairsUpAt ?? findWalkableNear(world, "underground", world.width / 2, world.height / 2);
  const dist = walkDistances(world, "underground", anchor);
  const pos = farthestReachable(dist, anchor);
  setTile(world, "underground", pos.x, pos.y, "exit");
  world.exitAt = pos;
  if (world.stairsUpAt) litTrailToward(world, dist, dist.get(`${pos.x},${pos.y}`) ?? 0, world.rng);
}

/** Links `below` under `above`: sets `depth`, `below`/`above` pointers, and `below`'s own `"stairsUp"` landing tile. */
function linkLevels(above: World, below: World): void {
  below.depth = (above.depth ?? 1) + 1;
  const landing = findWalkableNear(below, "underground", below.width / 2, below.height / 2);
  setTile(below, "underground", landing.x, landing.y, "stairsUp");
  below.stairsUpAt = landing;
  above.below = below;
  below.above = above;
}

/**
 * ROADMAP.md M7 Climb — direct ask, once the design conversation resolved
 * back to something simple: "i think i just want to be able to move to the
 * next level of the cave and shit." HANDOFF.md's own architecture
 * recommendation, taken: chained `World`s (`World.below`/`above`) linked by
 * stairs, rather than widening `Layer` to five-plus values that would touch
 * every `Record<Layer, ...>` in the engine.
 *
 * Level 1 is `createCaveScenario` completely unchanged (M1/M6's own tested
 * chamber), with a `"stairsDown"` tile added afterward the same way the
 * scenario already places its own spawn — a real walk via `walkDistances`,
 * not adjacent to anything. Levels 2-5 are freshly generated `underground`
 * maps (`CAVE_RUN_POPULATION`'s escalating real predators/prey). Returns
 * level 1; the rest of the chain hangs off its `below` pointer.
 */
export function createCaveRun(seed: number = SCENARIO_SEED): World {
  const level1 = createCaveScenario(seed);
  level1.depth = 1;
  attachStairsDown(level1, 1);

  let current = level1;
  for (let depth = 2; depth <= CAVE_RUN_DEPTH; depth++) {
    const next = buildDeeperLevel(seed, depth);
    linkLevels(current, next);
    if (depth < CAVE_RUN_DEPTH) attachStairsDown(next, depth);
    else attachExit(next);
    current = next;
  }
  return level1;
}

export function createDemoWorld(seed: number = SCENARIO_SEED): World {
  const world = generateWorld(SCENARIO_WIDTH, SCENARIO_HEIGHT, seed);

  // Two mated pairs, so reproduction has someone to pair with from the start.
  // No `age` set — undefined is treated as already mature (see reproduction.ts).
  const herd = Array.from({ length: 4 }, (_, i) => ({
    ...spawnAgent("bulbasaur", `bulbasaur-${i}`, anchor(world, 5 + i, 6), 5, world.rng),
    needs: createNeeds({ thirst: 0.4 + i * 0.1 }),
    herdId: "bulbasaur-herd",
    sex: (i % 2 === 0 ? "male" : "female") as "male" | "female",
  }));

  // Two Venusaur guard the herd — much higher level, so genuinely dangerous to
  // Scyther despite Grass being quadruply resisted by its Bug/Flying typing
  // (Vine Whip barely tickles it; Tackle, with no type penalty, is the smarter
  // pick there — pickBestMove actually gets this right on its own).
  const guardians = [
    {
      ...spawnAgent("venusaur", "venusaur-0", anchor(world, 4, 7), 20, world.rng),
      herdId: "bulbasaur-herd",
      sex: "male" as const,
    },
    {
      ...spawnAgent("venusaur", "venusaur-1", anchor(world, 9, 7), 20, world.rng),
      herdId: "bulbasaur-herd",
      sex: "female" as const,
    },
  ];

  // A small Scyther hunting party rather than one lone hunter — direct ask,
  // giving pack hunting (predation.ts's isPackPreyOf) real conspecifics to
  // actually coordinate with from tick 1, and generally more real predation
  // pressure on the surface herds (isPreyOf has no species allowlist — any
  // sufficiently weak nearby agent, Charmander/Squirtle included, is fair
  // game once a Scyther is hungry, same as Bulbasaur/Pidgey already are).
  const scytherParty = [
    {
      ...spawnAgent("scyther", "scyther-0", anchor(world, OLD_WIDTH - 2, 1), 8, world.rng),
      needs: createNeeds({ hunger: 0.3 }),
      sex: "female" as const,
    },
    {
      ...spawnAgent("scyther", "scyther-1", anchor(world, OLD_WIDTH - 3, 2), 8, world.rng),
      needs: createNeeds({ hunger: 0.3 }),
      sex: "male" as const,
    },
    {
      ...spawnAgent("scyther", "scyther-2", anchor(world, OLD_WIDTH - 2, 3), 8, world.rng),
      needs: createNeeds({ hunger: 0.3 }),
      sex: "male" as const,
    },
    {
      ...spawnAgent("scyther", "scyther-3", anchor(world, OLD_WIDTH - 4, 1), 8, world.rng),
      needs: createNeeds({ hunger: 0.3 }),
      sex: "female" as const,
    },
  ];

  // Underground: a small Diglett/Sandshrew colony (real cross-species
  // breeding pair, both Field egg group — see leveling.ts) with Onix
  // hunting both. Previously Diglett had zero threats at all down here;
  // Onix mirrors the surface's Scyther/Bulbasaur dynamic in a different
  // layer. Diglett/Sandshrew evolving into Dugtrio/Sandslash escapes
  // predation automatically — Onix's preysOn only lists the base species
  // ids, same trick as Venusaur guarding Bulbasaur (see species.ts).
  // Underground now carves real cellular-automata cave walls (worldgen.ts),
  // so these route through `undergroundAnchor`'s walkability search, not the
  // bare `scaledPos` this used before that feature existed.
  const undergroundColony = [
    {
      ...spawnAgent("diglett", "diglett-0", undergroundAnchor(world, OLD_WIDTH - 3, OLD_HEIGHT - 3), 5, world.rng),
      needs: createNeeds({ hunger: 0.2 }),
      herdId: "underground-colony",
      sex: "male" as const,
    },
    {
      ...spawnAgent("diglett", "diglett-1", undergroundAnchor(world, OLD_WIDTH - 4, OLD_HEIGHT - 3), 5, world.rng),
      herdId: "underground-colony",
      sex: "female" as const,
    },
    {
      ...spawnAgent("sandshrew", "sandshrew-0", undergroundAnchor(world, OLD_WIDTH - 3, OLD_HEIGHT - 4), 5, world.rng),
      herdId: "underground-colony",
      sex: "male" as const,
    },
    {
      ...spawnAgent("sandshrew", "sandshrew-1", undergroundAnchor(world, OLD_WIDTH - 4, OLD_HEIGHT - 4), 5, world.rng),
      herdId: "underground-colony",
      sex: "female" as const,
    },
  ];
  // Three Onix instead of one, same reasoning as the Scyther party above —
  // real conspecifics for pack hunting underground, more predation pressure
  // on Diglett/Sandshrew (and opportunistically anything else small enough
  // that wanders onto this layer — no species allowlist, see isPreyOf).
  const onixGroup = [
    {
      ...spawnAgent("onix", "onix-0", undergroundAnchor(world, 2, OLD_HEIGHT - 2), 10, world.rng),
      needs: createNeeds({ hunger: 0.3 }),
      sex: "male" as const,
    },
    {
      ...spawnAgent("onix", "onix-1", undergroundAnchor(world, 3, OLD_HEIGHT - 3), 10, world.rng),
      needs: createNeeds({ hunger: 0.3 }),
      sex: "female" as const,
    },
    {
      ...spawnAgent("onix", "onix-2", undergroundAnchor(world, 2, OLD_HEIGHT - 4), 10, world.rng),
      needs: createNeeds({ hunger: 0.3 }),
      sex: "male" as const,
    },
  ];

  // Canopy: a small Pidgey flock with Spearow hunting it, mirroring the
  // same pattern one layer up.
  const pidgeyFlock = [
    {
      ...spawnAgent("pidgey", "pidgey-0", canopyAnchor(world, 2, 2), 5, world.rng),
      needs: createNeeds({ thirst: 0.2 }),
      herdId: "pidgey-flock",
      sex: "female" as const,
    },
    {
      ...spawnAgent("pidgey", "pidgey-1", canopyAnchor(world, 3, 2), 5, world.rng),
      herdId: "pidgey-flock",
      sex: "male" as const,
    },
  ];
  const spearow = {
    ...spawnAgent("spearow", "spearow-0", canopyAnchor(world, OLD_WIDTH - 2, OLD_HEIGHT - 2), 10, world.rng),
    needs: createNeeds({ hunger: 0.3 }),
    sex: "female" as const,
  };

  // Surface: a pair of Squirtle at the northwest pond — the roster's first
  // Water-type, finally giving the map's own water tiles a resident
  // instead of just being a generic drink stop. No predator/prey role of
  // its own yet; opportunistic predation (see predation.ts's isPreyOf)
  // means an existing hunter could still take one if it's ever small
  // enough relative to them, same as any other species.
  const squirtlePair = [
    {
      ...spawnAgent("squirtle", "squirtle-0", { x: 1, y: 4 }, 5, world.rng),
      sex: "male" as const,
    },
    {
      ...spawnAgent("squirtle", "squirtle-1", { x: 2, y: 4 }, 5, world.rng),
      sex: "female" as const,
    },
  ];

  // A Charmander pair — fully defined in species.ts (moves, egg groups) but
  // never actually spawned until now, a gap this feature closes. Placed via
  // `findPosInBiome` at its tagged badlands biome (species.ts's
  // `SPECIES.charmander.biomes`) rather than another hardcoded corner — the
  // roster's first starting agent whose position is actually biome-driven,
  // not hand-picked. Real "connected to the world" payoff: this pair may
  // land anywhere the generated map's badlands biome happens to fall, seed
  // to seed, instead of a fixed coordinate. No predator/prey role of its
  // own yet, same as Squirtle above.
  const charmanderSpot = findPosInBiome(world, "surface", SPECIES.charmander!.biomes, world.rng);
  const charmanderPair = [
    {
      ...spawnAgent("charmander", "charmander-0", charmanderSpot, 5, world.rng),
      sex: "male" as const,
    },
    {
      ...spawnAgent("charmander", "charmander-1", findWalkableNear(world, "surface", charmanderSpot.x + 1, charmanderSpot.y), 5, world.rng),
      sex: "female" as const,
    },
  ];

  // Surface: a Magikarp/Tentacool pair actually IN real deep water, the
  // roster's first two obligate-aquatic residents (see species.ts's
  // `obligateAquatic`/DESIGN.md's "obligate-aquatic" section) — placed via
  // `findWaterNear` (this file's own helper, see its doc comment for why
  // `anchor`/`findWalkableNear` aren't safe for this: both treat any
  // walkable tile, water included, as an equally valid hit and could just
  // as easily land these two on dry land). Anchored off a wetland-biome-
  // weighted point (`findPosInBiome`, same species-tagged-biome placement
  // Charmander already uses above) rather than a hand-picked coordinate —
  // this map's own generated wetland/lake placement varies seed to seed, so
  // a fixed `{x, y}` is real water on whichever seed it happened to be
  // eyeballed against and silently dry land on every other one (confirmed
  // by this feature's own multi-seed validation). Not a mated pair
  // (opposite `sex` isn't set) — same "no predator/prey role of its own
  // yet" scope as Squirtle/Charmander above; this is about giving the map's
  // water a real obligate-aquatic resident to validate the movement
  // restriction against, not standing up a full breeding population from
  // tick 1.
  const aquaticAnchor = findPosInBiome(world, "surface", ["wetland"], world.rng);
  const aquaticSpot = findWaterNear(world, aquaticAnchor.x, aquaticAnchor.y);
  const aquaticPair = [
    { ...spawnAgent("magikarp", "magikarp-0", aquaticSpot, 5, world.rng), sex: "male" as const },
    {
      ...spawnAgent("tentacool", "tentacool-0", findWaterNear(world, aquaticSpot.x + 1, aquaticSpot.y), 5, world.rng),
      sex: "female" as const,
    },
  ];

  world.agents.push(
    ...herd,
    ...guardians,
    ...scytherParty,
    ...undergroundColony,
    ...onixGroup,
    ...pidgeyFlock,
    spearow,
    ...squirtlePair,
    ...charmanderPair,
    ...aquaticPair
  );
  return world;
}
