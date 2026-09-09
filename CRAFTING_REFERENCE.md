# Crafting reference: every material, every recipe

The single lookup table. `CRAFTING_TREE.md` has the dependency graph and the
reasoning; `CRAFTING_LOOP.md` has the UX. **This is the data.**

Rules in force: recipes are cheap (1–2 of a thing, up to ~6 for something
deliberately expensive), every item grants a verb or removes a constraint,
every item names a cost, and nothing craftable is sufficient on its own.

**W** = weight · **T** = craft turns · 🔥 = must be at a fire

---

# Part 1 · Materials

## Act 1 — underground

| Material | W | Where it comes from | Tool |
|---|---|---|---|
| **Lichen** | 1 | Cave floor, denser near water | — |
| **Cave vine** | 1 | Hanging in chambers near water and sunbeams | — *(knife: better yield)* |
| **Cave fungus** | 1 | Damp floor, `peat` ground | — |
| **Herbs** | 1 | Moist floor near water/sunbeam — real crop id | — |
| **Deadwood** | 2 | **Only near `sunbeam`** — dry roots, fallen wood | — |
| **Loose flint** | 1 | Scattered on `rocky` ground — scarce | — |
| **Loose stone** | 3 | Scree on `rocky` ground — scarce, slow | — |
| **Clay** | 2 | `clay` ground beside water | — |
| **Bone** | 1 | `boneGrounds` landmark | — |
| **Obsidian** | 1 | `geothermalVent` landmark — rare | — |
| **Ice** | 1 | `frozenGrotto` landmark | — |
| **Food** | 1 | Forage: roots, berries, fungus. **Spoils** | — |
| **Stone** | 3 | Mined from `wall`/`boulder` — abundant | **Pick** |

## From a carcass — requires a knife

| Material | W | Notes |
|---|---|---|
| **Hide** | 2 | The armor/pack/waterskin input |
| **Sinew** | 1 | Stronger cordage than plant fiber |
| **Fat** | 1 | Renders to tallow |
| **Shell** | 1 | Crustacean/shelled species — vessels, scales |
| **Chitin** | 1 | Insect species — light armor plate |
| **Feathers** | 1 | Bird species — fletching (Act 2) |

## Act 2 — surface

| Material | W | Where it comes from | Tool |
|---|---|---|---|
| **Plant fiber** | 1 | Grassland flora | — |
| **Reeds** | 1 | Pond and lake margins | **Knife** |
| **Resin** | 1 | Weeping from `tree` tiles | **Knife** |
| **Timber** | 4 | `tree` tiles. **Costs the canopy above** | **Axe** |
| **Sand** | 2 | `sandy` ground, beach | — |
| **Salt** | 1 | Ocean margins, dried flats | — |
| **Ore** | 4 | `rocky`/highland, near `geothermalVent` — rare | **Pick** |

---

# Part 2 · Processing (tier 0)

Single-step conversions. These are the hubs — most of the tree runs through
the first three.

| Output | W | Recipe | T | Notes |
|---|---|---|---|---|
| **Fiber** | 1 | Lichen · or vine · or reeds · or plant fiber | 3 | **Four sources** — no single point of failure |
| **Cordage** | 1 | Fiber ×2 | 3 | The universal binding |
| **Sinew cord** | 1 | Sinew ×2 | 3 | Stronger; needed for the bow |
| **Bound haft** | 2 | Deadwood + cordage | 4 | Handle for every hafted tool |
| **Knapped flint** | 1 | Loose flint | 3 | A cutting edge |
| **Ground stone** | 2 | Stone | 5 | A heavy head |
| **Obsidian edge** | 1 | Obsidian | 5 | Superior edge — sharper, brittle |
| **Charcoal** | 1 | Deadwood or timber 🔥 | 10 | Hotter fuel; needed for smithing |
| **Pitch** | 1 | Resin 🔥 | 8 | Adhesive and waterproofing |
| **Tallow** | 1 | Fat 🔥 | 8 | Waterproofing, candles, fuel |
| **Meltwater** | 1 | Ice + clay vessel | 4 | Drinkable water where there is none liquid |
| **Ingot** *(Act 2)* | 3 | Ore + charcoal 🔥 | 25 | Bronze or iron — needs a smithing fire |
| **Glass** *(Act 2)* | 1 | Sand + charcoal 🔥 | 25 | Vessels, lenses — needs a kiln |

---

# Part 3 · Items

## Light and fire

| Item | W | Recipe | T | Grants | Cost |
|---|---|---|---|---|---|
| **Torch** | 2 | Deadwood + fiber | 5 | Sight in the dark | **Seen from further**; burns down |
| **Firestarter** | 1 | Loose flint + fiber | 4 | Fire anywhere | Consumed |
| **Lamp** | 2 | Clay vessel + tallow | 8 | Longer-lasting light | Needs a vessel first |
| **Banked coal** | 2 | Charcoal + clay vessel | 6 | Carry fire without a flame | Slow, fragile |
| **Smoke bomb** | 1 | Fiber + fungus | 6 | **Smokescreen** — moves creatures without harm | Consumed |

## Tools

| Item | W | Recipe | T | Grants |
|---|---|---|---|---|
| **Flint knife** | 2 | Haft + knapped flint | 10 | `scratch`; butchering; reeds; better yields |
| **Obsidian knife** | 2 | Haft + obsidian edge | 10 | As above, sharper |
| **Axe** | 3 | Haft + knapped flint | 12 | **Fell trees → timber.** Costs canopy |
| **Pick** | 4 | Haft + ground stone | 12 | **Break boulders; mine walls** |
| **Sickle** | 2 | Haft + knapped flint | 10 | Harvest without killing the plant |
| **Digging stick** | 2 | Haft + bone | 8 | Roots; faster soft digging |
| **Ice awl** | 1 | Haft + bone | 8 | Break a frozen surface |
| **Fishing line** | 1 | Cordage + bone | 6 | Fish as a food source |
| **Fish trap** | 2 | Reeds + cordage | 8 | Passive fishing |
| **Snare** | 2 | Cordage + haft | 6 | Catches prey while you're elsewhere |

## Weapons

| Item | W | Recipe | T | Grants | Cost |
|---|---|---|---|---|---|
| **Club** | 3 | Bound haft | 6 | `swing` | Threat signature up |
| **Spear** | 3 | Haft + knapped flint | 12 | **Reach 2** | Heavy; high threat |
| **Sling** | 1 | Cordage + hide | 8 | **Ranged attack** | Noise |
| **Bow** *(Act 2)* | 3 | Timber + sinew cord | 20 | Real range | Needs arrows |
| **Arrows ×5** | 1 | Deadwood + feathers | 8 | Ammunition | Recoverable |
| **Fire-lance** *(Act 2)* | 3 | Timber + pitch 🔥 | 20 | **Flamethrower, crudely** | **Ignites your own tile**; fuel |

## Metal tier — Act 2, needs a smithing settlement

| Item | W | Recipe | T | Grants |
|---|---|---|---|---|
| **Metal axe** | 3 | Haft + ingot | 20 | Fells faster; the timber tier at scale |
| **Metal pick** | 4 | Haft + ingot | 20 | Digs faster; reaches ore |
| **Metal knife** | 2 | Haft + ingot | 18 | Best yields |
| **Plough** | 6 | Timber + ingot | 40 | Farming at settlement scale |

## Worn

| Item | W | Recipe | T | Effect |
|---|---|---|---|---|
| **Camouflage cloak** | 2 | Fiber + lichen | 8 | **Lowers threat signature** — approach without spooking |
| **Woven wrap** | 3 | Fiber + cordage | 8 | Light armor. −Speed |
| **Hide armor** | 5 | Hide + cordage | 12 | Real armor. −Speed. **Needs a kill** |
| **Chitin scale** | 4 | Chitin ×2 + cordage | 14 | Better than hide, lighter |
| **Fur cloak** | 3 | Hide + cordage | 10 | Cold-snap protection |
| **Rain hood** | 2 | Hide + tallow | 8 | Reduces the storm accuracy penalty |
| **Snowshoes** | 2 | Fiber + hide | 8 | No speed penalty on soft ground |

## Carrying

| Item | W | Recipe | T | Effect |
|---|---|---|---|---|
| **Forage pouch** | 1 | Cordage + fiber | 6 | **+8 capacity** |
| **Pack** | 2 | Hide + cordage ×3 | 10 | **+14 capacity**. −Speed |
| **Waterskin** | 1 | Hide + tallow | 8 | Travel away from water |
| **Clay vessel** | 2 | Clay 🔥 | 20 | Liquids, storage, lamp base |
| **Shell bowl** | 1 | Shell + pitch | 6 | Cheap vessel, no fire needed |
| **Travois** | 3 | Haft + cordage ×2 | 10 | **Drag a fainted creature** — makes Rescue practical |

## Consumables

| Item | W | Recipe | T | Effect |
|---|---|---|---|---|
| **Poultice** | 1 | Herbs + lichen | 5 | Heal away from shelter |
| **Antidote** | 1 | Herbs + fungus | 5 | Clear a status |
| **Roasted food** | 1 | Food 🔥 | 8 | Better nutrition |
| **Dried rations** | 1 | Food + salt 🔥 | 20 | **Doesn't spoil** |
| **Bait** | 1 | Food + herbs | 4 | Draws creatures to a tile |

## Bonding

| Item | Enables | Note |
|---|---|---|
| **Forage pouch** | **Feed** | Carry food to give |
| **Travois** | **Rescue** | Drag what you saved |
| **Poultice** | **Rescue** | Heal what you saved |
| **Camouflage cloak** | **Presence** | Approach without spooking |
| **Whistle** | — | Bone + cordage, T6. Draw or scatter at range |

## Structures

| Item | Recipe | T | Effect |
|---|---|---|---|
| **Campfire** | Deadwood + firestarter | 10 | **The first crafting station** |
| **Shelter** | Timber ×2 + cordage | 40 | Rest, storm cover, **cache** |
| **Cache** | Timber + cordage | 20 | Stash without carrying |
| **Crafting table** *(Act 2)* | Timber ×4 + cordage | 60 | Unlocks the Act 2 tier |

---

# Part 4 · Known from the start

You are a human; these need no discovery:

> **Fiber · Cordage · Bound haft · Torch · Club · Poultice · Campfire**

Everything else is learned by **examining an example**, being taught, or
finding a written recipe.

# Part 5 · The first-playable cut

Ten items, no station required, both Act 1 paths real:

> **Fiber · Cordage · Bound haft · Knapped flint · Torch · Flint knife ·
> Club · Poultice · Forage pouch · Camouflage cloak**

---

## Notes on what got invented here

New materials added to fill real gaps, each with a source and at least one
use:

- **Cave vine** — the second fiber source. Lichen was a single point of
  failure for the entire tree.
- **Sinew, fat, shell, chitin, feathers** — butchering currently yields only
  hide, which made a kill an all-or-nothing proposition. Now a carcass is a
  *set* of materials, which makes hunting a real supply decision rather than
  a switch.
- **Resin → pitch** and **fat → tallow** — adhesive and waterproofing, so
  vessels and rain gear don't all route through hide.
- **Charcoal** — the fuel step that Act 2 smithing needs.
- **Obsidian** — gives `geothermalVent` a reason to be worth visiting.
- **Salt** — makes preservation a real recipe rather than hand-waving.

**Reachability checked, and it found four dead-end materials** — ice,
feathers, sand and ore were all gatherable with nothing to make from them.
Fixed: ice melts to water in a vessel (so `frozenGrotto` is a water source),
feathers now fletch arrows, and sand and ore both route through charcoal at
a fire into glass and ingots, which gives the Act 2 metal tier its input.

Every material now has at least one downstream use, and every recipe's
inputs appear in the tables above. **Re-trace on any change** — an
unreachable craftable is a bug by this project's own standard, and this pass
found four in a list that looked finished.
