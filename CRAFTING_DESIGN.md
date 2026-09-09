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
   **Decided (see `MOVES_AND_TOOLS.md`):** that verb is a real `MoveSpec` —
   items and moves share one effect vocabulary, and a tool is always a
   *slice* of a move, never the whole move.
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
| **Timber** | `tree` tiles — **requires an axe** | forest/jungle biome; costs canopy |
| **Stone** | `boulder` tiles, mined `wall` — **requires a pick** | anywhere with rock |
| **Reeds** | Pond and lake margins | `waterKind: pond`/`lake` |
| **Plant fiber** | Grassland flora | biome |
| **Sand** | `sandy` ground, beach | `groundType: sandy` |
| **Ore** | `rocky`/highland, `geothermalVent` | rare — the trade good `HUMANS_DESIGN.md` wants |

This is `HUMANS_DESIGN.md`'s "regional material culture, free from the macro
grid" applied to the player: two villages a hundred zones apart make
different things because their ground is different, and so do you.

---

## Harvest nodes: trees and stone

> "wood from trees too, maybe we can chop em down and shit with an axe.
> stone. idk pull from typical crafter game knowledge too"

Both node types already exist as real terrain: **`tree`** and **`boulder`**,
plus **`wall`** underground. So "chop a tree" is a terrain transition, not a
new object system.

### Chopping a tree has a consequence no crafter game has

`worldgen.ts`'s `deriveCanopyFromSurface` builds the **canopy layer out of
surface trees** — a tile is canopy-walkable if it's a tree or sits in a
tree island (`CANOPY_TREE_LINK_RADIUS` / `CANOPY_TREE_LINK_MIN_NEIGHBORS`),
and canopy apples are placed on exactly those tiles.

So felling trees **destroys the layer above them.** Canopy-dwelling species
lose walkable ground and a food source; clear enough and an island fragments
into gaps that only Flying types can cross (`canFlyOverObstacle`).

That is habitat loss as a real, already-modelled mechanic — you can watch it
happen on the canopy layer — and it's the single strongest argument for
sourcing wood from trees rather than hand-waving it. In Minecraft you can
level a forest and the world doesn't notice. Here it does, without a line of
new code.

Regrowth should reuse `flora.ts`: a felled tree leaves a `seedling`, which
matures back through the existing growth machinery. Fast enough that a
forest recovers, slow enough that clear-cutting is a real decision.

### Stone, boulders, and digging walls

- **`boulder` tiles** break into stone with a pick.
- **`wall` tiles underground** can be mined — which changes the cave's shape.
  This is powerful (any obstacle becomes passable given time) and needs to
  stay expensive. `digMultiplier` already parameterises exactly this:
  `rocky` 2.5×, `clay` 1.8×, `sandy` 0.6×.

Digging through walls is the biggest single power grant in this document and
should be gated behind a real tool and real time, or it dissolves every
spatial problem in Act 1.

### Tool gating — the ladder worth stealing

The cleanest progression structure crafting games ever invented: **the tool
you have decides which materials exist for you.**

| Tool | Unlocks | Made from |
|---|---|---|
| *(bare hands)* | Lichen, fiber, loose deadwood, surface flint | — |
| **Flint knife** | Better yields, reeds, butchering | haft + knapped flint |
| **Axe** | **Trees → timber** | haft + knapped flint |
| **Pick** | **Boulders → stone; walls → digging** | haft + ground stone |
| **Metal tools** | Faster everything; Act 2 | smithing settlement |

Each tool is a genuine unlock rather than a stat bump, which is rule 3 of
this document satisfied by the structure itself.

### The bootstrap, and the three-input problem

Real hafted tools are head + handle + binding — three inputs, which breaks
this document's two-input rule. The fix is one shared intermediate:

```
lichen/reeds  →  fiber
fiber ×2      →  cordage
deadwood + cordage  →  BOUND HAFT
haft + knapped flint  →  knife / axe / spear
haft + ground stone   →  pick / maul
```

Depth 2, two inputs everywhere, and it gives the classic Minecraft bootstrap
shape — gather by hand, make the first crude thing, that thing unlocks the
next material — without a recipe tree.

**Open collision:** axe and spear currently take the same two inputs.
Recommend differentiating the worked material (a knapped *edge* vs a heavy
*head*) rather than adding a third input or quantities.

### What to take from crafter games, and what not to

Worth being explicit, because the genre's defaults conflict with this
project's pillars in one specific way.

**Take:**
- Tool gating as progression (above).
- Harvest nodes visible in the world, broken with the right tool.
- The bootstrap ladder — it teaches crafting with no tutorial.
- Stations that unlock recipe tiers (campfire → crafting table).

**Don't take:**
- **Consequence-free infinite resources.** Minecraft's world doesn't care
  how much you take. This one has `fertility`, `fertilityCeiling`,
  `groundDegraded` and now canopy loss — the whole point is that it does.
- **Volume progression.** "Collect 64 wood" is tedium. Keep quantities
  tiny; get depth from variety and tool gating, never from grinding counts.
- **Durability.** A classic tedium generator. Consumables are consumed;
  tools are permanent (see open questions).
- **A recipe spreadsheet.** Unknown recipes are invisible, not greyed out.

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
| **Cordage** | Fiber ×2 | Binding |
| **Bound haft** | Deadwood + cordage | The shared handle for every hafted tool — see the three-input problem above |
| **Knapped flint** | Flint | A cutting edge |
| **Ground stone** | Stone | A heavy head |

### Tier 1 — the real items (2 inputs)

| Item | Recipe | Verb it grants | Cost it carries |
|---|---|---|---|
| **Torch** | Deadwood + fiber | Light in the dark | **Seen from much further**; burns out |
| **Firestarter** | Flint + fiber | Fire anywhere | Consumed on use |
| **Club** | Bound haft (alone) | `swing` — real damage | Threat signature up; prey flee sooner |
| **Flint knife** | Haft + knapped flint | Better harvest yield; butchering; reeds | Weight; it is a visible blade |
| **Axe** | Haft + knapped flint | **Fell trees → timber** | Costs canopy habitat |
| **Pick** | Haft + ground stone | **Break boulders; dig walls** | Slow; `digMultiplier` gated |
| **Spear** | Haft + knapped flint | **Reach 2** — the first genuine upgrade | Heavy; high threat signature |
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

### Two armor paths, as a plain tradeoff

- **Woven wrap** — plant fiber. Weak, cheap, nothing dies.
- **Hide armor** — real protection, needs a kill.

That's the whole thing: a cheap weak option and a better one with a
prerequisite you may not want to meet on a peaceful layer. **Scoped as a
small reputation modifier, not a morality system** — direct correction, and
a fair one: *"beyond need scope isn't real right now. it's a reputation
modifier not like a crucial thing."* No transgression tracking, no myth
trigger, no ledger. Kill things and prey get a bit warier of you. That's it.

### The snare

Catches prey **while you are somewhere else** — it interacts with the live
agent simulation rather than a menu, which makes it the most
this-project-shaped item on the list.

Real risk: it could trivialise food. Worth tuning against a real run rather
than assuming.

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

## Harvesting has to be legible, or the ecological cost is invisible

The fertility economy gives crafting its pillar-1 cost for free — but a cost
the player cannot perceive isn't a cost, it's a hidden number. Per the
legibility rule in `NARRATIVE_PILLARS.md`: **the tell has to come before the
consequence.**

The chain crafting creates:

> you harvest a slope → `fertility` falls → `groundDegraded` accrues on peat
> → the herd that fed there migrates on scarcity → the predators following
> it leave → the valley is quiet

Every link is built. But if spent ground looks identical to healthy ground,
the player sees five invisible steps and one silent outcome.

So harvesting needs, in order of importance:

1. **Degraded ground renders differently** — `groundDegraded` and `fertility`
   are both floats the palette can carry continuously. This is the warning,
   and it must be visible *while you are still harvesting*, not after the
   herd has gone.
2. **A yield tell.** Diminishing returns from the same patch should be
   obvious from the yields themselves, not inferred.
3. **Prose only when actionable** — *"the ground here is spent"* on approach
   to badly degraded ground, per `SENSORY_LAYER.md`'s affordance rule.

Without (1) this whole design is a well-simulated cost nobody experiences.

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
