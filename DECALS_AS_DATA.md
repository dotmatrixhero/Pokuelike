# Decals as data

Status: **BUILT — A and B together.** Direct ask: *"A then B together."*
Written in response to two asks, mid-pass, while the biome ripping was landing:

> "I'm gonna have you keep in mind where you put these decals because I want
> the gather button to allow you gather appropriate materials based on the
> decals"

> "So like make them proper tiles in the data that represent something data
> wise"

---

## 1. The defect this lands on

It is not just a missing feature. The art and the rules currently **disagree**,
and the rules are the ones on the wrong side of the project's own pillar
(*mechanics should be visible on the map, not hidden in a meter*).

`harvest.ts`'s `harvestableAt` decides what a tile yields from **proximity
heuristics**:

| Yield | Current rule |
| --- | --- |
| `deadwood` | a `sunbeam` tile within range |
| `flint` | a `wall`, `boulder` or `stone` tile within 1, or `groundType === "rocky"` |
| `lichen` | underground, `water` within range |

None of those is a thing the player can see. Meanwhile the renderer is now
drawing, on specific tiles, a **fallen log**, a **cut stump**, a **boulder**, a
**bone spur**, a **mushroom cluster**, a **shell**, a **barrel**. Those are
visible causes sitting right there, and the gather rule ignores them.

So today you can stand on a tile with a log drawn on it and be told there is no
deadwood, and stand on empty sand and be handed some because a sunbeam is three
tiles away. That is the exact shape of thing this project treats as a bug.

## 2. What decals are today

`pickDecal` (web/src/sprites.ts) is a **pure function of `(x, y, biome, layer)`**:

```ts
const h = hashTile(x + saltX, y + saltY);
if (h % oneIn !== 0) return null;
const name = pool[Math.floor(h / oneIn) % pool.length]!;
```

No state anywhere. Nothing in `World`, nothing in worldgen, nothing saved. The
engine cannot see them and the renderer re-derives them every frame.

That is the whole design question in one line: **that stateless hash is either
the cheapest possible hook for gather, or the wrong foundation for it.**

## 3. Options

### A. Lift the decal table into shared code; keep it stateless

Move the pools and `pickDecal` into `@pokuelike/data` (or engine). Renderer
imports it for art; `harvestableAt` imports it for yields.

- **Cost:** low. No new tile field, no worldgen change, no save-format change.
- **Consumption:** the tile already carries `harvested` (a 0-3 take counter with
  regrowth in `tickHarvestRegrowth`). The renderer can hide a decal once its
  tile is bare and bring it back when it regrows, so gathering *does* visibly
  take the log away, using state that already exists.
- **Limits:** decals can only ever be where the hash puts them. Nothing in the
  sim can create one (a fight cannot leave bones, a storm cannot drop a log) or
  destroy one permanently.

### B. Decals become placed data: `Tile.decal?: DecalId`

Worldgen places them; the renderer reads the tile instead of hashing; gather
clears the field.

- **Cost:** medium. One optional field on `Tile`, a placement pass in worldgen,
  and the renderer's decal lookup changes source. Save format grows a field.
- **Gets:** placement can obey real rules instead of a hash — driftwood only on
  shore tiles adjacent to water, bones denser near where things actually died,
  barrels only in a quarry landmark rather than scattered evenly over every
  badlands tile. And decals become **narratable**: something can put one there
  and the chronicle can say why.
- This is what "proper tiles in the data" most plainly asks for.

### C. Each decal becomes its own `TerrainKind`

- **Cost:** high, and it fights the model. `terrain` is one-per-tile and is
  already spoken for by `floor`/`food`/`flora`/`tree`/`stone`; a stump would
  have to displace the ground it stands on. It also drags in `walkable`/`opaque`
  decisions for every decal.
- Not recommended. Decals are an overlay, not a ground type. `groundType` and
  the region tag are the precedent: orthogonal tags on a tile, not terrain.

## 4. What was built

Both, in one pass. The two turned out to compose rather than stack: B needs an
oracle for "what naturally belongs on this tile" so a picked fern can grow back
without anything having stored what it was, and A's stateless hash IS that
oracle. So the hash did not get replaced — it got demoted from "the decal
system" to `naturalDecalAt`, the function worldgen stamps from and regrowth
restores from.

- `packages/engine/src/decals.ts` — `DecalId`, the pools, the placement hash,
  and per-decal facts (`yields`, `regrows`, `footing`, `standing`).
- `Tile.scatterDecal` / `Tile.featureDecal` — two slots, because the art has
  two densities and they are not interchangeable.
- `World.origin` — decal placement hashes on ABSOLUTE coordinates, so
  neighbouring zones stop repeating each other's scatter; regrowth needs the
  origin to reproduce the hash long after generation.
- `scatterDecals(world)` runs last in `generateWorld`, after every terrain
  overlay has settled the ground a decal has to stand on.
- `harvestableAt` adds the decal's yields; `takeHarvest` clears the decal on
  the take that leaves the tile bare; `tickHarvestRegrowth` grows back only the
  decals whose spec says `regrows`.
- Five new materials: `fiber`, `shroom`, `bone`, `shell`, `scrap`.
- The renderer's scatter pass reads the tile instead of hashing.

### Verified

Engine tests (`test/decals.test.ts`, 6) plus a live end-to-end run:

| Check | Result |
| --- | --- |
| Player stands on a `stump_oak_1` tile, presses Gather 12x | pack holds **Deadwood x3**, tile's `featureDecal` is **null**, further gathers yield nothing |
| Player stands on a `tuft_dry_1` tile, gathers | pack UI reads **"Pack 3/33 · Fiber x3"** |
| Ground decals on water tiles | **0** (was: the renderer had no terrain check at all) |
| Lily pads on land | **0** |
| Decals in the canopy | **0** (a first run put 5-7 boulders and logs in the treetops) |
| Reachability over 40 seeds | every decal appears; rarest is `fence_wood_1` at 9/40 |

### Two bugs this fixed on the way

1. **The renderer's scatter pass had no terrain check.** It ran over every tile
   in view, so decals drew on water, walls and trees — which is why lily pads
   were landing on dry ground and grass tufts were floating out to sea.
2. **Decals were being placed in the canopy.** Invisible before only because
   nothing looked at the canopy layer with the old hash.

### Balance to look at, not decided

Tiles yielding each material, mean over 5 seeds of 60x60 (all three layers):

| material | tiles |
| --- | --- |
| fiber | 179 |
| bone | 42 |
| flint | 40 |
| herbs | 23 |
| deadwood | 18 |
| shroom | 18 |
| scrap | 1 |
| shell | 0 on these 5 seeds (37/40 over a wider sweep) |

`fiber` is deliberately the abundant one — it is the fine scatter layer, which
is on roughly one eligible tile in seven. `shroom` is in `FOOD_MATERIAL_IDS`,
so mushrooms are edible at a neutral 1x nutrition; that is a real food supply
in forest and jungle that did not exist before. Neither number has been tuned.

## 5. Why A then B, and why they shipped together

Each still stands alone with its own evidence:

- **A** is testable immediately and settles the thing that is actually wrong:
  what you gather matches what you see. Pass/fail is concrete — walk onto a log
  tile, get deadwood; walk onto bare sand with a sunbeam nearby, get nothing.
- **B** is worth doing the moment a decal needs a *cause* — bones where a herd
  died, driftwood on a shore, a quarry's barrels clustered at the quarry. That
  is the version that feeds "I want stories," and it is a much easier change on
  top of A than from scratch, because A already establishes the decal -> material
  table and the shared module.

The open question — **does gathering a decal consume it permanently, or does it
regrow?** — resolved the way it was posed: a per-decal `regrows` flag, not one
global rule. A stump regrowing in 300 ticks reads wrong; a mushroom cluster
regrowing reads right.

## 6. The decal -> material table, as built

As built. The five materials marked **new** below now exist in `harvest.ts`.

| Decal | Yields | Note |
| --- | --- | --- |
| `log_1`, `log_mossy_1` | `deadwood` | the visible cause the sunbeam rule was standing in for |
| `stump_oak_1/2`, `stump_cut_1/2`, `stump_ring_1` | `deadwood` | should not regrow |
| `fence_wood_1` | `deadwood` | worked timber; arguably a better plank source |
| `boulder_1`, `rock_sea_1` | `flint` | the visible cause the wall-adjacency rule was standing in for |
| `bones_1..4` | `bone` | the cave's only gatherable; does not regrow |
| `shroom_red_1/2`, `shroom_orange_1` | `shroom` | regrows; edible, neutral 1x nutrition |
| `shell_1` | `shell` | beach-only |
| `barrel_1..3` | `scrap` | worked junk, not nature |
| `sign_danger_1` | nothing | it is a sign; it is there to *say* something |
| `cactus_1/2`, `succulent_1` | `fiber` | regrows |
| `reed_1`, `cattail_1` | `fiber` | regrows |
| `fern_1`, `moss_1`, `tuft_*`, `blade_cold_*` | `fiber` | regrows; the abundant material |
| `bloom_1/2`, `flower_red_1` | `herbs` | regrows |
| `lily_1/2` | nothing | floats; now actually placed ON water, which it was not before |

## 7. Where the decals currently are

Pools live in `web/src/sprites.ts`. As of the pass-1/pass-2 rips:

- **Fine scatter** (dense, ~1 in N tiles): tufts, blossoms, moss, ferns, reeds,
  lilies, cold blades, mushrooms.
- **Sparse features** (landmark density): logs, stumps, boulders, cacti,
  cattails, shells, sea rock, barrels, the DANGER sign, the fence, and all four
  bone spurs.
- **Underground** uses its own pools and has **no fine scatter layer at all**
  (bones at ground-cover density read as a boneyard — measured at ~2,270 draws
  in one frame).

Density is the reason for the split, and it matters here too: anything in the
fine layer is on a large fraction of tiles, so making the fine layer gatherable
makes fibre effectively unlimited. The sparse layer is where scarcity lives.
