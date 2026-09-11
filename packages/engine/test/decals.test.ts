import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/worldgen.js";
import { DECALS, naturalDecalAt, tileTakesDecal, type DecalId } from "../src/decals.js";
import { HARVEST_REGROW_TICKS, HARVEST_YIELD_PER_TILE, harvestableAt, takeHarvest, tickHarvestRegrowth } from "../src/harvest.js";
import { tileAt } from "../src/world.js";
import { LAYER_ORDER, type Layer, type Vec2 } from "../src/types.js";

const SEEDS = [1, 7, 13, 29, 101];

function findTileWith(world: ReturnType<typeof generateWorld>, pred: (id: DecalId) => boolean): { layer: Layer; pos: Vec2 } | undefined {
  for (const layer of LAYER_ORDER) {
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const tile = tileAt(world, layer, x, y)!;
        if (tile.featureDecal && pred(tile.featureDecal)) return { layer, pos: { x, y } };
      }
    }
  }
  return undefined;
}

describe("decals as tile data", () => {
  it("places decals on generated worlds, in both slots", () => {
    for (const seed of SEEDS) {
      const world = generateWorld(60, 60, seed);
      const count = (layer: Layer) => {
        let scatter = 0;
        let feature = 0;
        for (const tile of world.tiles[layer]) {
          if (tile.scatterDecal) scatter++;
          if (tile.featureDecal) feature++;
        }
        return { scatter, feature };
      };

      const surface = count("surface");
      expect(surface.scatter, `seed ${seed} surface scatter`).toBeGreaterThan(0);
      expect(surface.feature, `seed ${seed} surface feature`).toBeGreaterThan(0);
      // The fine layer is 1-in-7 and the sparse one 1-in-47, so the fine layer
      // has to come out several times denser or the two pools have been
      // crossed. A bare `> 0` on each would pass with them swapped.
      //
      // Per layer, not summed: summed, the two came out 199 vs 218 and this
      // read as a failure. The cave has no fine scatter layer at all by
      // design, so it contributes features and no scatter, and the sum hid a
      // surface ratio that was in fact exactly 6.9x.
      expect(surface.scatter, `seed ${seed} density order`).toBeGreaterThan(surface.feature * 3);

      // The cave: features only.
      const cave = count("underground");
      expect(cave.feature, `seed ${seed} cave feature`).toBeGreaterThan(0);
      expect(cave.scatter, `seed ${seed} cave scatter`).toBe(0);

      // The canopy is treetops; nothing stands up there.
      expect(count("canopy"), `seed ${seed} canopy`).toEqual({ scatter: 0, feature: 0 });
    }
  });

  it("never puts a ground decal on water, or a lily on land", () => {
    for (const seed of SEEDS) {
      const world = generateWorld(60, 60, seed);
      for (const layer of LAYER_ORDER) {
        const tiles = world.tiles[layer];
        for (let i = 0; i < tiles.length; i++) {
          const tile = tiles[i]!;
          for (const id of [tile.scatterDecal, tile.featureDecal]) {
            if (!id) continue;
            expect(tileTakesDecal(tile.terrain, DECALS[id].footing), `seed ${seed} ${id} on ${tile.terrain}`).toBe(true);
          }
        }
      }
    }
  });

  it("gathering a log hands back deadwood and takes the log away", () => {
    const world = generateWorld(60, 60, 7);
    const found = findTileWith(world, (id) => DECALS[id].yields.includes("deadwood"));
    expect(found, "no deadwood decal on seed 7").toBeDefined();
    const { layer, pos } = found!;
    expect(harvestableAt(world, layer, pos)).toContain("deadwood");

    for (let i = 0; i < HARVEST_YIELD_PER_TILE; i++) {
      expect(takeHarvest(world, layer, pos)).toContain("deadwood");
    }
    // Bare now: the log is gone and so is the deadwood it was the reason for.
    expect(tileAt(world, layer, pos.x, pos.y)!.featureDecal).toBeUndefined();
    expect(takeHarvest(world, layer, pos)).toEqual([]);
  });

  it("a picked fern comes back; a felled stump does not", () => {
    const world = generateWorld(60, 60, 7);
    const stump = findTileWith(world, (id) => id.startsWith("stump_") || id.startsWith("log_"));
    expect(stump, "no stump/log on seed 7").toBeDefined();

    // A regrowing ground decal, found in the fine slot.
    let fern: { layer: Layer; pos: Vec2 } | undefined;
    outer: for (const layer of LAYER_ORDER) {
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          const id = tileAt(world, layer, x, y)!.scatterDecal;
          if (id && DECALS[id].regrows && DECALS[id].yields.length > 0) {
            fern = { layer, pos: { x, y } };
            break outer;
          }
        }
      }
    }
    expect(fern, "no regrowing scatter decal on seed 7").toBeDefined();

    for (const spot of [stump!, fern!]) {
      for (let i = 0; i < HARVEST_YIELD_PER_TILE; i++) takeHarvest(world, spot.layer, spot.pos);
    }
    expect(tileAt(world, fern!.layer, fern!.pos.x, fern!.pos.y)!.scatterDecal).toBeUndefined();

    // Regrow the tiles all the way back.
    for (let i = 0; i < HARVEST_YIELD_PER_TILE; i++) {
      world.tick += HARVEST_REGROW_TICKS;
      tickHarvestRegrowth(world);
    }
    expect(tileAt(world, fern!.layer, fern!.pos.x, fern!.pos.y)!.scatterDecal).toBeDefined();
    expect(tileAt(world, stump!.layer, stump!.pos.x, stump!.pos.y)!.featureDecal).toBeUndefined();
  });

  it("the sign is scenery: it is never gatherable", () => {
    const world = generateWorld(60, 60, 7);
    for (const layer of LAYER_ORDER) {
      for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
          if (tileAt(world, layer, x, y)!.featureDecal !== "sign_danger_1") continue;
          expect(harvestableAt(world, layer, { x, y })).not.toContain("scrap");
        }
      }
    }
  });

  it("placement is reproducible from the hash, which is what regrowth relies on", () => {
    const world = generateWorld(60, 60, 29);
    for (const layer of LAYER_ORDER) {
      const tiles = world.tiles[layer];
      for (let i = 0; i < tiles.length; i += 37) {
        const x = i % world.width;
        const y = Math.floor(i / world.width);
        expect(naturalDecalAt(world, layer, x, y, "scatter")).toBe(tiles[i]!.scatterDecal);
        expect(naturalDecalAt(world, layer, x, y, "feature")).toBe(tiles[i]!.featureDecal);
      }
    }
  });
});
