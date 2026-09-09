# Player v1: actions, inventory, and the craftables list

Deliberately narrow — **the player and what the player does.** No village, no
biome logic, no sim-wide concerns. Numbers here are starting values to build
against and tune, not final.

---

## Part 1 · The player's actions

### Tier 1 — one tick each

| Action | Notes |
|---|---|
| **Move** | 8-way, through the existing walkability gates |
| **Attack** | Explicit, so hitting a neutral is always deliberate |
| **Use item** | Consumables; the throwable ones need a target |
| **Equip / stow** | Held vs stowed — the threat-signature decision |
| **Wait** | Real: let a cooldown finish, let something come to you |
| **Change layer** | Stairs / climb where terrain allows |

### Free — no tick

| Action | Notes |
|---|---|
| **Look** | What's under the cursor, at your knowledge state |
| **Examine** | **A real action now.** On a creature: advances its knowledge entry. On a crafted item: **teaches you the recipe.** On a material: tells you what it's for |

Examine doing three different jobs depending on target is what makes it worth
a key of its own rather than being folded into look. It is the player's main
verb for *converting the world into knowledge*, and it costs nothing but
attention.

### Tier 2 — many ticks, interruptible

| Action | `BehaviorKind` | Yields |
|---|---|---|
| **Search** | `scavenge` | Materials, caches, tracks — radius grows with time spent |
| **Forage** | `seekFood` | Harvest what's visible |
| **Craft** | — | See Part 3 |
| **Rest** | `sleep` / `restAtShelter` | Health, fatigue. Faster near a `sunbeam` |
| **Watch** | `idle` | Knowledge on creatures in view, without approaching |

All Tier 2 actions stop the moment something enters view, you take damage, or
a need crosses a threshold.

---

## Part 2 · Inventory: the purpose, then the mechanism

> "remember the purpose of em; to not hoard and infinitely hoover everything
> up."

Correct, and worth stating because **weight alone doesn't achieve that.** A
weight cap stops you carrying everything *at once*; it doesn't stop you
hoarding. Three layers do the actual job, and two already exist:

### Layer 1 — recipes never want more than 2 (removes the *reason*)

The hoarding instinct comes from games that ask for 64 wood. Recipe
quantities here are `fiber ×2` at most, everything else 1 + 1. **If nothing
ever needs twenty of something, nobody stockpiles twenty of it.** This is the
most effective anti-hoard measure and it costs nothing — it's a rule already
decided in `CRAFTING_DESIGN.md`.

### Layer 2 — weight with soft encumbrance (the tried-and-true part)

`carryCapacityOf` = `maxHp × 1.5` already exists. Real numbers from
`calculateStats`: a level-5 creature has 16–22 maxHp → **capacity 24–33**;
a frail human sits near **24**.

Recommend **soft, not a hard wall**:

| Load | Effect |
|---|---|
| Up to 100% | Normal |
| 100–150% | **Speed penalty** → fewer actions, via the energy scheduler |
| Above 150% | Cannot move |

Soft encumbrance is better than a refusal because over-packing becomes a
*decision with a cost* rather than the game saying no. It also reuses exactly
the mechanism armor already uses, so there's one concept to learn, not two.

### Layer 3 — a cache lets you hoard, just not on your back

`shelter.ts` already has a food cache. Generalise it: **you can stash anything
at your shelter.**

This is the piece that makes the whole thing feel generous rather than
restrictive. You are never told you can't have things — you're told you can't
*carry* them all. Hoarding becomes a place you go back to, which also gives
your shelter a reason to exist beyond sleeping, and makes losing it matter.

### Layer 4 — food spoils

Raw food decays. Dried rations don't. That's the whole justification for
preservation as a craft, and it stops food specifically from being the thing
you stockpile infinitely.

### What we're *not* doing

- No separate bulk/volume axis. One number.
- No durability. Consumables consume; tools are permanent.
- No stack-size caps. Weight is the constraint, not slot count.

**Data-model gap:** `InventoryItem` has no stack count today, so ten berries
are ten entries. `search` yielding "lichen (3)" needs stacking to exist first.

---

## Part 3 · The craftables list

Starting numbers. **W** = weight, **T** = craft turns. `fire` = must be at a
fire.

### Materials — gathered, not crafted

| Material | W | Where |
|---|---|---|
| Lichen | 1 | Cave floor, denser near water |
| Herbs | 1 | Real crop id in `crops.ts` |
| Flint | 1 | `rocky` ground, `boulder` |
| Clay | 2 | `clay` ground beside water |
| Deadwood | 2 | **Only near `sunbeam`** |
| Cave fungus | 1 | Damp floor, `peat` |
| Bone | 1 | `boneGrounds` landmark |
| Stone | 3 | `boulder`, mined `wall` — needs a pick |
| Timber | 4 | `tree` — needs an axe |
| Hide | 2 | A dead animal |
| Food | 1 | Forage; spoils |

### Tier 0 — processing

| Item | Recipe | W | T | Notes |
|---|---|---|---|---|
| **Fiber** | Lichen | 1 | 3 | Universal binding input |
| **Cordage** | Fiber ×2 | 1 | 3 | |
| **Bound haft** | Deadwood + cordage | 2 | 4 | Shared handle for all hafted tools |
| **Knapped flint** | Flint | 1 | 3 | A cutting edge |
| **Ground stone** | Stone | 2 | 5 | A heavy head |

### Tier 1 — the v1 set

| Item | Recipe | W | T | Slot | Grants |
|---|---|---|---|---|---|
| **Torch** | Deadwood + fiber | 2 | 5 | held | Sight in the dark. **Costs: seen from further** |
| **Firestarter** | Flint + fiber | 1 | 4 | — | Make fire anywhere. Consumed |
| **Flint knife** | Haft + knapped flint | 2 | 10 | held | `scratch`; better harvest yields; cut reeds |
| **Club** | Bound haft | 3 | 6 | held | `swing`. Threat signature up |
| **Spear** | Haft + knapped flint | 3 | 12 | held | **Reach 2** |
| **Axe** | Haft + knapped flint | 3 | 12 | held | **Fell trees.** Costs canopy |
| **Pick** | Haft + ground stone | 4 | 12 | held | **Break boulders, mine walls** |
| **Sickle** | Haft + knapped flint | 2 | 10 | held | Harvest without killing the plant |
| **Sling** | Cordage + hide | 1 | 8 | held | **Ranged attack** |
| **Poultice** | Herbs + lichen | 1 | 5 | — | Heal away from shelter. Consumed |
| **Antidote** | Herbs + fungus | 1 | 5 | — | Clear a status. Consumed |
| **Smoke bomb** | Fiber + fungus | 1 | 6 | — | Fires Smokescreen. Consumed |
| **Woven wrap** | Fiber + cordage | 3 | 8 | worn | Light armor. −Speed |
| **Camouflage cloak** | Fiber + lichen | 2 | 8 | worn | **Lowers threat signature** |
| **Hide armor** | Hide + cordage | 5 | 12 | worn | Real armor. −Speed. Needs a kill |
| **Forage pouch** | Cordage + fiber | 1 | 6 | — | **+8 capacity** |
| **Pack** | Hide + cordage | 2 | 10 | — | **+14 capacity**. −Speed |
| **Waterskin** | Hide + cordage | 1 | 8 | — | Travel from water |
| **Snare** | Cordage + haft | 2 | 6 | — | Passive trapping |
| **Clay vessel** | Clay + `fire` | 2 | 20 | — | Liquids, storage |
| **Roasted food** | Food + `fire` | 1 | 8 | — | Better nutrition |
| **Dried rations** | Food + `fire` | 1 | 20 | — | **Doesn't spoil** |

### Known from the start

You are a human. These need no discovery:

**Fiber · Cordage · Bound haft · Torch · Club · Poultice**

Everything else is learned by **examining** an example, being taught, or
finding a written recipe.

---

## The first-playable cut

If only some of this ships, this is the set that makes both Act 1 paths
real, with no station required:

> **Fiber · Cordage · Bound haft · Knapped flint · Torch · Flint knife ·
> Club · Poultice · Forage pouch · Camouflage cloak**

Ten items. Torch opens the dark, knife opens materials, pouch opens carrying,
and cloak versus club is the arm-yourself-or-hide-yourself choice the whole
act turns on.

## Open

1. Soft encumbrance thresholds (100/150%) need play-testing, not reasoning.
2. Stack counts must exist in `InventoryItem` before any of this is real.
3. Should the cloak and club be mutually exclusive in practice, or is
   carrying both just heavy? Recommend heavy — let the weight decide.
4. Food spoilage rate — fast enough to matter, slow enough not to nag.
