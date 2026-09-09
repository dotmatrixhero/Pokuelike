# Context for the biome-zone-logic agent: fire, fuel, and species placement

Not a task order — you own biome logic. This is context and concerns from
the crafting/items workstream, plus a measured baseline you can use.

Copy everything below the line.

---

## Who this is from and why it matters to you

I've been designing crafting, items and the moves-as-tools architecture
(`MOVES_AND_TOOLS.md`, `CRAFTING_DESIGN.md`, `ITEM_CATALOGUE.md`). That work
introduces **more terrain-changing effects**: felling trees, clearing brush,
starting fires — reachable by both Pokémon (as moves) and the player (as
tools). It also leans on a wider species roster.

Both of those land squarely on biome logic, so you should know what's coming
and I'd like your read on it.

## The measured baseline — use this as your "before"

`packages/runner/src/validateTerrainChurn.ts` (new), 4 seeds × 6000 ticks:

| Vegetation (tree/bush/flora/food/seedling) | |
|---|---|
| Start | 1300 |
| End | **1453** |
| Change | **+11.8%** — mildly overgrowing |

Top terrain-change causes, per 1000 ticks: **freeze 72.4**, **thaw 63.3**,
drought 11.4, rain 8.1.

**And fire produced zero events.** Not one `cause: "fire"` terrain change in
24,000 agent-ticks. The whole fire system — spread, fuel consumption,
burn-out, damage-over-time — is inert in a real run.

Two things follow:
- There is **headroom**. The world regrows faster than anything consumes it,
  so adding felling/clearing/burning moves won't strip it as things stand.
- Fire being completely inert is worth a look on its own, by this project's
  own "unreachable content is a bug" standard.

Also note a limitation of the instrument: `terrainBurn` and `terrainFill`
(moves that change a tile on a landed hit) **don't log `terrainChanged`**, so
they're invisible in the flow numbers and only show up in the stock
comparison. Worth fixing before anyone tunes off flow.

## The design position on fire, from the owner

Quoted, because the specifics matter:

> "The way fire Pokémon work should be that fire does not spread a ton
> because they shouldn't be around a ton of flammable stuff all the time.
> The environment they normally exist in might have a couple fires, but they
> are designed to burn themselves out. Now, if they take over a place they
> shouldn't, like a forest, and it gets hit by a drought, maybe that ends up
> causing a huge disaster."

This is a really good model and it has a specific implication for your work:

> **Fire safety should be an emergent property of species placement, not a
> global tuning constant.**

A Fire-type in volcanic/badlands ground is surrounded by very little fuel, so
its fires die on their own. The same species in a forest is a catastrophe
waiting for a dry season. Nobody tunes "fire spread rate" down to make this
safe — the biome does it.

## What that needs from biome logic

Three links, and the chain only works if all three hold:

1. **Fuel load is a biome property.** How much of a zone is flammable
   (`tree`, `bush`, `flora`, `food`, `seedling`) should follow from biome,
   and Fire-type home biomes should be genuinely fuel-poor. This is the part
   that makes the default case safe.
2. **Species–biome fit must be enforceable *and* violable.** `SpeciesDef.biomes`,
   `speciesFitsZone` and `estimateZoneSpecies` already gate placement. But the
   interesting case requires a Fire-type to sometimes end up somewhere it
   doesn't belong — via `herdMigration`, `dispersal`, or `immigration`. **A
   mismatch is the story, not a bug to prevent.** If placement is airtight,
   the disaster never happens and the mechanic is dead.
3. **Drought is the trigger.** `weather.ts` already has drought cells at
   11.4 changes/1k ticks. The chain is: wrong-biome fire species + flammable
   terrain + drought → real disaster.

## My actual concerns

1. **Roster widening is the risk multiplier.** The active roster is 70
   species against 1085 in the dex (see `BREADTH_DESIGN.md`). If it widens
   substantially and biome gating is loose, forests get Fire-types by
   default and the world burns constantly. If gating is airtight, the
   disaster case never fires. **The tuning target is "rare but real,"** and
   that's a distribution question only you can answer.
2. **Fire is currently inert, so nothing is being tested.** Whatever fuel and
   placement rules you set won't show their consequences until fire actually
   happens. Worth knowing *why* it never fires — no Fire-types in the demo
   roster, ignite conditions never met, or something else.
3. **Terrain-changing moves are coming.** Cut fells trees, brush-clearing
   moves exist, and the player will have an axe. Vegetation stock is the
   number to watch; the script above reports it. If it goes negative after
   the move roster widens, that's the signal.
4. **A disaster has to be legible.** `NARRATIVE_PILLARS.md` now carries a
   rule: *a cause must be visible before its consequence, or the consequence
   reads as randomness.* A burned-out forest is only a story if the player
   can connect it to the herd that moved in and the dry season that followed.
   The chronicle records `terrainChanged` with a `cause` — extending that to
   name the responsible agent/herd is the cheap version.

## Questions I'd like your view on

1. Does fuel load already fall out of biome generation, or does it need to
   be explicit?
2. Can a herd currently end up in a biome its species doesn't fit? If not,
   what would it take — and is that desirable?
3. Should Fire-type home biomes be *generated* fuel-poor, or should fire
   history make them so over time (a burned-over zone stays sparse)? The
   second is more interesting and pairs with `groundDegraded`.
4. What's your read on how wide the species roster should get, given the
   ecology balancing lands on you?

## Tools

- `packages/runner/src/validateTerrainChurn.ts` — vegetation stock and
  terrain-change flow by cause. Re-run after any change.
- `packages/runner/src/validateAmbientVocabulary.ts` — which terrain kinds
  and ground types actually occur per layer. Note it found `assignGroundTypes`
  is **surface-only**, so underground has no ground types at all.
- `packages/runner/src/validateEcology.ts`, `validateFire.ts` — existing.
