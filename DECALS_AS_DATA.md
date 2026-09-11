# Decals as data

Status: **design, nothing built.** Written in response to two asks, mid-pass,
while the biome ripping was landing:

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

## 4. Recommendation

**A first, then B.** Each stands alone with its own evidence:

- **A** is testable immediately and settles the thing that is actually wrong:
  what you gather matches what you see. Pass/fail is concrete — walk onto a log
  tile, get deadwood; walk onto bare sand with a sunbeam nearby, get nothing.
- **B** is worth doing the moment a decal needs a *cause* — bones where a herd
  died, driftwood on a shore, a quarry's barrels clustered at the quarry. That
  is the version that feeds "I want stories," and it is a much easier change on
  top of A than from scratch, because A already establishes the decal -> material
  table and the shared module.

Open question for whoever takes this: **does gathering a decal consume it
permanently, or does it regrow like a food tile?** A stump regrowing in 300
ticks reads wrong; a mushroom cluster regrowing reads right. That probably means
the material table needs a per-decal `regrows` flag, not one global rule.

## 5. Proposed decal -> material table

Materials below that do not exist yet are marked. Current `MaterialId` set is in
`harvest.ts`.

| Decal | Yields | Note |
| --- | --- | --- |
| `log_1`, `log_mossy_1` | `deadwood` | the visible cause the sunbeam rule is standing in for |
| `stump_oak_1/2`, `stump_cut_1/2`, `stump_ring_1` | `deadwood` | should not regrow |
| `fence_wood_1` | `deadwood` | worked timber; arguably a better plank source |
| `boulder_1`, `rock_sea_1` | `flint` | the visible cause the wall-adjacency rule is standing in for |
| `bones_1..4` | bone (**new**) | the cave's only gatherable; pairs with the crafting tree |
| `shroom_red_1/2`, `shroom_orange_1` | a mushroom crop (**new**, or map to an existing `CROP_ID`) | regrows |
| `shell_1` | shell (**new**) | beach-only |
| `barrel_1..3` | salvage (**new**) | worked junk, not nature |
| `sign_danger_1` | nothing | it is a sign; it is there to *say* something |
| `cactus_1/2`, `succulent_1` | water + fibre (**fibre new**) | already-visible desert water source |
| `reed_1`, `cattail_1` | fibre (**new**) | |
| `fern_1`, `moss_1`, `tuft_*`, `blade_cold_*` | fibre / thatch (**new**) | regrows |
| `bloom_1/2`, `flower_red_1` | an herb crop | regrows |
| `lily_1/2` | nothing | floats on water; not standable |

## 6. Where the decals currently are

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
