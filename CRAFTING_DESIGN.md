# Crafting: materials, where they grow, and what you make

> "i think crafting an item stuff is the biggest thing we can get. yeah? so
> we gotta design some items we need to build and then figure out how the
> materials work, then harvesting them, etc."

Status: **design spec, nothing built.** Written to be buildable — real field
names, real existing systems, and an explicit list of what has to exist
first.

## The finding this rests on: the renewable-resource economy already exists

Crafting does not need a resource system invented. `flora.ts` already runs a
complete one, per tile:

| Mechanism | Value | Meaning |
|---|---|---|
| `fertility` | 0–1 per tile | how productive this ground currently is |
| `FERTILITY_AFTER_HARVEST` | 0.35 (loam) | harvesting knocks the tile down, not to zero |
| `FERTILITY_REGEN_PER_TICK` | 0.005 | ~130 ticks back to full on loam, unaided |
| `fertilityCeiling` | loam 1.0 · clay 1.0 · peat 1.0 · **sandy 0.6** · **rocky 0.25** | how good this ground can ever get |
| `regenMultiplier` | sandy 1.3 · clay 0.5 · rocky 1.0 | how fast it comes back |
| `harvestRecoveryFraction` | loam 1.0 → **rocky 0.4** | how much survives a harvest |
| `maybeDegradePeat` | permanent | **peat scars and never fully recovers** |
| plant quality | scales with `fertility` | fertile ground yields better material |

Two things follow immediately, and they're the reason this design works:

- **Pillar 1's "no capability without an ecological cost" is already
  satisfied by construction.** Harvesting depletes; the land recovers at a
  rate its own soil decides; peat never fully forgives. Nothing needs adding
  to make gathering cost something.
- **Pillar 4's "the land remembers" is already implemented** in
  `groundDegraded`, and its doc comment says so explicitly. A player who
  strips a peat bog for fiber leaves a permanent mark. That was the
  *least-built* pillar, and crafting is what will make people actually
  encounter it.

**So: materials are harvested through the fertility economy that exists.**
Quality scales with fertility. Where you gather is a real decision, because
rocky ground caps at 0.25 and recovers 40% of a harvest while loam caps at
1.0 and recovers all of it.

## Blocking prerequisite: the cave is empty

Measured (`validateAmbientVocabulary.ts`, 6 seeds): underground is **95.75%
floor, 3.68% wall, 0.57% water**, with `groundType` and `waterKind` **100%
unset**, because `assignGroundTypes` reads `tileAt(world, "surface", …)`
explicitly.

Act 1 happens entirely underground. **Nothing in this document works until
ground types and harvestable flora reach the cave.** That's prerequisite
zero, and it's a small change to an existing pass rather than a new system.

---

## The rules

Held deliberately tight, because crafting is where sim games bloat.

1. **Two inputs per recipe. One output.**
2. **Dependency depth 2, maximum.** Relaxing my own earlier "no
   sub-assemblies" line, and saying so: cordage is too classic and too
   useful to lose, and depth 2 is still a bounded list rather than a tree.
   Nothing may ever require a third tier.
3. **Every item grants a verb or removes a constraint.** No flat stat
   sticks. If it doesn't change what you can *do*, it doesn't ship.
4. **Every item names its cost.** Weight, noise, threat signature, or
   something it stops you doing.
5. **Nothing craftable is sufficient.** Pillar 3: if a loadout lets a player
   clear Act 1 without a partner, it's too strong.

---

## Materials, and where they come from

Every source is a fact the world already generates or one this spec asks for
by name. This is what makes the map worth reading.

### Underground — Act 1

| Material | Grows / found | Gated by |
|---|---|---|
| **Lichen** | Cave floor, denser near water | flora on `underground`, damp tiles |
| **Cave fungus** | Damp floor, `peat` ground | `groundType: peat`, near water |
| **Flint** | `rocky` ground, `boulder` tiles | `groundType: rocky` |
| **Clay** | `clay` ground adjacent to water | `groundType: clay` + `waterKind` |
| **Deadwood / roots** | Only near `sunbeam` chambers | `sunbeam` within `SUNBEAM_RADIUS` |
| **Herbs** | Already a real crop id | `crops.ts`, moisture-gated |
| **Bone** | `boneGrounds` landmark | landmark zone only |
| **Ice** | `frozenGrotto` landmark | landmark zone only |
| **Hide** | A dead animal | requires a kill — see below |

Deadwood being sunbeam-gated is the good one: **wood only exists where light
reaches**, so the lit chamber isn't just pretty and safe, it's the only place
handles and fuel come from. The map teaches that without a word of text.

### Surface — Act 2 and outward

| Material | Grows / found | Gated by |
|---|---|---|
| **Timber** | `tree` tiles | forest/jungle biome |
| **Reeds** | Pond and lake margins | `waterKind: pond`/`lake` |
| **Plant fiber** | Grassland flora | biome |
| **Sand** | `sandy` ground, beach | `groundType: sandy` |
| **Ore** | `rocky`/highland, `geothermalVent` | rare — the trade good `HUMANS_DESIGN.md` wants |

This is `HUMANS_DESIGN.md`'s "regional material culture, free from the macro
grid" applied to the player: two villages a hundred zones apart make
different things because their ground is different, and so do you.

---

## Harvesting

One verb, riding `scavenge` (an existing `BehaviorKind`) as a Tier-2
time-spend from `PLAYER_ACTIONS.md`.

- **Costs turns**, scaled by `digMultiplier` where digging is involved —
  `rocky` is 2.5×, `sandy` 0.6×. Prising flint out of rock is slow.
- **Yield scales with the tile's `fertility`**, using the existing quality
  curve.
- **Knocks `fertility` down** by that ground type's
  `harvestRecoveryFraction`.
- **On peat, rolls `maybeDegradePeat`** — a permanent scar.
- **A flint knife raises yield**, which is the first real "tools make you
  better at the thing" step and the cheapest way to make tools feel good.

You are stationary and audible while doing it — which, per `SENSORY_LAYER.md`,
is exactly when unseen things notice you and leave, and you hear them go.

---

## The recipes

### Tier 0 — processing (1 input)

| Output | From | Why it exists |
|---|---|---|
| **Fiber** | Lichen / reeds | The universal binding input |
| **Cordage** | Fiber ×2 | The one intermediate; depth stops here |

### Tier 1 — the real items (2 inputs)

| Item | Recipe | Verb it grants | Cost it carries |
|---|---|---|---|
| **Torch** | Deadwood + fiber | Light in the dark | **Seen from much further**; burns out |
| **Firestarter** | Flint + fiber | Fire anywhere | Consumed on use |
| **Club** | Deadwood + cordage | `swing` — real damage | Threat signature up; prey flee sooner |
| **Flint knife** | Flint + cordage | Better harvest yield; butchering | Weight; it is a visible blade |
| **Spear** | Deadwood + flint | **Reach 2** — the first genuine upgrade | Heavy; high threat signature |
| **Poultice** | Herbs + lichen | Heal away from shelter | Single use; herbs are slow to regrow |
| **Clay vessel** | Clay + fire (station) | Carry water — travel past a water source | Weight; breaks |
| **Snare** | Cordage + deadwood | **Passive trapping** — see below | Kills without you there |
| **Woven wrap** | Fiber + cordage | Light armor | Weak; −Speed |
| **Hide armor** | Hide + cordage | Real armor | **Requires killing something** |
| **Pack** | Woven/hide + cordage | Carry capacity | Bulk; slows you |
| **Fishing line** | Cordage + bone | Fish as a food source | Bone is landmark-gated |

Twelve items, two tiers, nothing needing a third. `HUMANS_DESIGN.md` already
placed the ladder above this: spear → bow → bronze/iron at a smithing
settlement, and crafting tables as the village-tier campfire.

### The armor decision is the best thing in this list

Two paths to protection, and they cost different currencies:

- **Woven wrap** — plant fiber, weak, no death involved.
- **Hide armor** — genuinely protective, and **you have to kill something for
  it.**

Layer 1 is peaceful and prey-only. So the good armor means killing a member
of a herd you are simultaneously trying to earn trust from, in the one place
where trust is the objective. Nobody prompts you. Nothing calls it a moral
choice. Prey get warier, the reputation system notices what you've become,
and you wear the consequence.

That is `MYTH_STRUCTURES.md`'s harvest-rule logic arriving as a mechanic —
*"killing for food is permitted; excess is not"* — with no morality meter and
no dialogue, which is exactly what the pillars demand.

### The snare is the most interesting and the most dangerous

A snare catches prey **while you are somewhere else.** It interacts with the
live agent simulation rather than with a menu, which is the most
this-project-shaped item on the list.

Risks worth naming now: it could trivialise food, and it kills without you
present — which is the exact shape of the myths' "killing beyond need"
transgression. Both are features if the reputation system is watching, and
problems if it isn't. **Build it after reputation, not before.**

---

## Stations

- **Campfire** — Act 1. Real `"fire"` terrain already. Enables anything
  needing heat: clay vessels, roasting, drying.
- **Crafting table** — Act 2 village tier. Same ladder, better recipes.
  `HUMANS_DESIGN.md`: *"the village has better tables and better materials,
  not different physics."*

Building one reuses `shelter.ts`'s travel-and-invest construction shape
rather than a new system.

## How recipes are learned

Recipes are knowledge, not a menu of things you can't make yet
(`PLAYER_ACTIONS.md`'s rule). But Act 1 has no NPCs to teach you, so:

- **A small set is simply known.** You are a human; tying a stick to a stone
  is not a discovery. Cordage, club, torch, poultice.
- **The rest are found or taught** — written recipes as loot, villagers in
  Act 2, and technique diffusion along roads later.
- **Never show a locked recipe list.** An unknown recipe is invisible, not
  greyed out.

---

## What has to be built

In dependency order. The first two are the real prerequisites.

1. **Ground types and harvestable flora underground** — `assignGroundTypes`
   is surface-only today. Blocking everything else here.
2. **Item definitions in data** (`ItemDef` with key, weight, slot, granted
   moves, stat mods) and inventory holding references — see
   `PLAYER_INVENTORY.md`.
3. **The harvest verb**, riding `scavenge` and the fertility economy.
4. **Recipes as data**, plus a known-recipes set on the player.
5. **Crafting at a station**, reusing shelter-style investment.
6. **The item set above**, smallest first: cordage → torch → club → spear.

## Open questions

1. **Does material quality carry into the item?** Fertile-ground fiber makes
   a better rope. Tempting and thematically right; it also doubles the item
   table's dimensionality. Recommend **no** for v1.
2. **Do items wear out?** Durability is a classic tedium generator. Recommend
   only consumables are consumed (poultice, firestarter, torch burns down)
   and tools are permanent.
3. **Can you craft anywhere, or only at a station?** Recommend cordage and
   bindings anywhere, heat-requiring recipes at fire only.
4. **Does the partner carry anything?** `carryCapacityOf` already exists for
   every agent, so it's nearly free — but it makes the partner read as
   equipment, which pillar 3 explicitly refuses. Recommend **no**.
5. **How scarce should hide be?** It's the armor tension's whole weight. Too
   easy and the choice evaporates; too hard and it's a dead branch.
