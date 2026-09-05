import {
  generateWorld,
  findWalkableNear,
  findPosInBiome,
  createNeeds,
  tileAt,
  type Vec2,
  type World,
} from "@pokuelike/engine";
import { spawnAgent } from "./spawn.js";
import { SPECIES } from "./species.js";

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
 * Same scaling, for Canopy — that layer is still always a plain flat grid
 * (no obstacles/elevation there, a Surface-only generation pass — see
 * worldgen.ts), so every tile is walkable and no `findWalkableNear` search is
 * needed. Was a real bug in an earlier pass of this feature: these positions
 * used to be computed directly against the *new* SCENARIO_WIDTH/HEIGHT (e.g.
 * `SCENARIO_WIDTH - 3`) while sharing anchors with code still written in the
 * old 24x16 frame, which put predator and prey in opposite corners of the
 * new, much bigger map — far outside detection range of each other for the
 * entire length of a real run, confirmed by a 1000-tick run with zero
 * "fought"/"killed" events on either pair. Scaling from the *old* frame
 * consistently, the same way `anchor` does for the surface, keeps them
 * exactly as close (relatively) as they were on the original map.
 *
 * NOT used for Underground positions any more — see `undergroundAnchor`
 * below for why that layer needs a real walkability search now too.
 */
function scaledPos(x: number, y: number) {
  return { x: Math.round(x * SCALE_X), y: Math.round(y * SCALE_Y) };
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
      ...spawnAgent("pidgey", "pidgey-0", scaledPos(2, 2), 5, world.rng),
      needs: createNeeds({ thirst: 0.2 }),
      herdId: "pidgey-flock",
      sex: "female" as const,
    },
    {
      ...spawnAgent("pidgey", "pidgey-1", scaledPos(3, 2), 5, world.rng),
      herdId: "pidgey-flock",
      sex: "male" as const,
    },
  ];
  const spearow = {
    ...spawnAgent("spearow", "spearow-0", scaledPos(OLD_WIDTH - 2, OLD_HEIGHT - 2), 10, world.rng),
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
