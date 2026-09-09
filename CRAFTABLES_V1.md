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

### Layer 1 — recipes stay cheap (removes the *reason*)

The hoarding instinct comes from games that ask for 64 wood.

**Not a hard cap** — *"i dont think we codify more than 2. maybe some
expensive things cost 6. but yeah, i think for the most part we try to keep
it cheap."* So:

- **Default 1–2 of anything.** Most recipes are 1 + 1.
- **Up to ~6 for something deliberately expensive** — a pack, a raft, a
  station. The cost is the point in those cases.
- **Never more than that.** 6 is a trip; 64 is a job.

**If nothing ever needs twenty of something, nobody stockpiles twenty of
it.** This is the most effective anti-hoard measure and it costs nothing.

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

### Capacity should grow — it's a real progression axis

Base capacity is `maxHp × 1.5`, which grows a little as you do. On top of
that, **carried upgrades stack**:

| | Capacity |
|---|---|
| Base (frail human) | ~24 |
| + Forage pouch | +8 |
| + Pack | +14 |
| + Act 2 pack / panniers | +20 |
| + Cache at shelter | unlimited, but stationary |

So "how much can I carry" is something you visibly improve, and each upgrade
has a weight and a Speed cost of its own — you're trading mobility for
capacity, not getting it free.

---

## Inventory UX: the best inventory screen is one you rarely open

> "make it not painful to sort through your backpack and shit please. also
> show encumbrance and stuff easily on ui."

Five rules, in order of how much pain they remove.

### 1 · Encumbrance is always on screen, never behind a menu

A small persistent readout, colour-coded, next to your needs:

```
  ☰ 17 / 24                    (normal)
  ☰ 27 / 24   slowed           (amber — you're in the 100–150% band)
  ☰ 38 / 24   can't move       (red)
```

You should never have to open anything to find out you're overloaded. The
moment it starts costing you actions, the number that says so is visible.

### 2 · Keep it small enough that sorting is unnecessary

The real fix isn't a better sort — it's **fewer things.** At ~24 capacity
with items weighing 1–5, you carry 10–20 stacks. Grouped, that's one screen
with no scrolling. Every design choice here should protect that: cheap
recipes, no ammo counting, no durability spares, no crafting components that
exist only to be intermediate.

### 3 · Auto-grouped, auto-stacked, stable order

```
  CARRYING                                    17 / 24

  HELD     torch                                   2
  WORN     camouflage cloak                        2

  TOOLS
    flint knife                                    2
  MATERIALS
    fiber          ×4    → cordage, torch          4
    lichen         ×3    → fiber                   3
    flint          ×2    → knapped flint           2
  CONSUMABLES
    poultice       ×2                              2
```

- **Grouped by category** with headers. No manual sorting, ever.
- **Auto-stacked** by key.
- **Stable order** — items never jump around between openings. This is the
  single biggest anti-frustration measure; muscle memory only works if
  position is predictable.

### 4 · Materials say what they're for, right in the list

The `→ cordage, torch` column is the payoff of examine-teaches-recipes: once
you know a recipe, every material you carry shows what it feeds. **You never
have to remember why you picked something up**, and you can tell at a glance
what's dead weight.

A material with an empty arrow column is either something you haven't learned
a use for yet, or genuinely junk — and that ambiguity is fine, it's a reason
to go find out.

### 5 · Overloaded gets help, not just a warning

When you're over capacity the screen marks the obvious candidates — heaviest
first, and anything with no known use. Not automatic, just pointed at. The
common case ("I picked up too much timber") should be two keypresses to fix.

### The screen you actually use is the craft list

Worth saying plainly: **the crafting list is the real inventory screen.** It
already shows what you can make, what you know but can't make, and exactly
what you're missing. Most of the time the player wants "what can I do with
this stuff," not "enumerate my possessions" — so the craft list should be the
one-key screen, and raw inventory the second-key one.

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
| **Pack** | Hide + cordage ×3 | 2 | 10 | — | **+14 capacity**. −Speed. *(an example of a deliberately expensive recipe)* |
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
2. Stack counts must exist in `InventoryItem` before any of this is real —
   they gate stacking, the "×4" display, and the whole grouped list.
3. Should the cloak and club be mutually exclusive in practice, or is
   carrying both just heavy? Recommend heavy — let the weight decide.
4. Food spoilage rate — fast enough to matter, slow enough not to nag.
