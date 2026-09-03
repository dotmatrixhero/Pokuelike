import {
  generateWorld,
  findWalkableNear,
  createNeeds,
  type World,
} from "@pokuelike/engine";
import { spawnAgent } from "./spawn.js";

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
 * Same scaling, for underground/canopy — those layers are always a plain
 * flat grid (no obstacles/elevation there, a Surface-only generation pass —
 * see worldgen.ts), so every tile is walkable and no `findWalkableNear`
 * search is needed. Was a real bug in an earlier pass of this feature:
 * these positions used to be computed directly against the *new*
 * SCENARIO_WIDTH/HEIGHT (e.g. `SCENARIO_WIDTH - 3`) while sharing anchors
 * with code still written in the old 24x16 frame, which put predator and
 * prey in opposite corners of the new, much bigger map — far outside
 * detection range of each other for the entire length of a real run,
 * confirmed by a 1000-tick run with zero "fought"/"killed" events on either
 * pair. Scaling from the *old* frame consistently, the same way `anchor`
 * does for the surface, keeps them exactly as close (relatively) as they
 * were on the original map.
 */
function scaledPos(x: number, y: number) {
  return { x: Math.round(x * SCALE_X), y: Math.round(y * SCALE_Y) };
}

/**
 * The one demo world both the browser app and the headless runner show: a
 * Bulbasaur herd near a water hole guarded by Venusaur, a Scyther hunting
 * from its own separate territory, an underground Diglett/Sandshrew colony
 * hunted by Onix, and a canopy Pidgey flock hunted by Spearow — the same
 * predator/prey pattern repeated on all three layers (see DESIGN.md's
 * species-expansion section). Underground/canopy have no food or water
 * tiles of their own, so every agent down there or up there routinely
 * crosses to the surface for both — a deliberate reuse of the existing
 * cross-layer need-seeking mechanic rather than triplicating the resource
 * map per layer. Every agent gets real stats/types/moves via spawnAgent —
 * see DESIGN.md's combat section.
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
    ...spawnAgent("bulbasaur", `bulbasaur-${i}`, anchor(world, 5 + i, 6), 5),
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
      ...spawnAgent("venusaur", "venusaur-0", anchor(world, 4, 7), 20),
      herdId: "bulbasaur-herd",
      sex: "male" as const,
    },
    {
      ...spawnAgent("venusaur", "venusaur-1", anchor(world, 9, 7), 20),
      herdId: "bulbasaur-herd",
      sex: "female" as const,
    },
  ];

  const hunter = {
    ...spawnAgent("scyther", "scyther-0", anchor(world, OLD_WIDTH - 2, 1), 8),
    needs: createNeeds({ hunger: 0.3 }),
    sex: "female" as const,
  };

  // Underground: a small Diglett/Sandshrew colony (real cross-species
  // breeding pair, both Field egg group — see leveling.ts) with Onix
  // hunting both. Previously Diglett had zero threats at all down here;
  // Onix mirrors the surface's Scyther/Bulbasaur dynamic in a different
  // layer. Diglett/Sandshrew evolving into Dugtrio/Sandslash escapes
  // predation automatically — Onix's preysOn only lists the base species
  // ids, same trick as Venusaur guarding Bulbasaur (see species.ts).
  // Underground is still the plain flat grid (no obstacles/elevation there
  // — a Surface-only pass, see worldgen.ts), so every tile is walkable and
  // these just need `scaledPos`, not the walkability search `anchor` does.
  const undergroundColony = [
    {
      ...spawnAgent("diglett", "diglett-0", scaledPos(OLD_WIDTH - 3, OLD_HEIGHT - 3), 5),
      needs: createNeeds({ hunger: 0.2 }),
      herdId: "underground-colony",
      sex: "male" as const,
    },
    {
      ...spawnAgent("diglett", "diglett-1", scaledPos(OLD_WIDTH - 4, OLD_HEIGHT - 3), 5),
      herdId: "underground-colony",
      sex: "female" as const,
    },
    {
      ...spawnAgent("sandshrew", "sandshrew-0", scaledPos(OLD_WIDTH - 3, OLD_HEIGHT - 4), 5),
      herdId: "underground-colony",
      sex: "male" as const,
    },
    {
      ...spawnAgent("sandshrew", "sandshrew-1", scaledPos(OLD_WIDTH - 4, OLD_HEIGHT - 4), 5),
      herdId: "underground-colony",
      sex: "female" as const,
    },
  ];
  const onix = {
    ...spawnAgent("onix", "onix-0", scaledPos(2, OLD_HEIGHT - 2), 10),
    needs: createNeeds({ hunger: 0.3 }),
    sex: "male" as const,
  };

  // Canopy: a small Pidgey flock with Spearow hunting it, mirroring the
  // same pattern one layer up.
  const pidgeyFlock = [
    {
      ...spawnAgent("pidgey", "pidgey-0", scaledPos(2, 2), 5),
      needs: createNeeds({ thirst: 0.2 }),
      herdId: "pidgey-flock",
      sex: "female" as const,
    },
    {
      ...spawnAgent("pidgey", "pidgey-1", scaledPos(3, 2), 5),
      herdId: "pidgey-flock",
      sex: "male" as const,
    },
  ];
  const spearow = {
    ...spawnAgent("spearow", "spearow-0", scaledPos(OLD_WIDTH - 2, OLD_HEIGHT - 2), 10),
    needs: createNeeds({ hunger: 0.3 }),
    sex: "female" as const,
  };

  world.agents.push(...herd, ...guardians, hunter, ...undergroundColony, onix, ...pidgeyFlock, spearow);
  return world;
}
