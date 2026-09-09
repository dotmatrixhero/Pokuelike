# Item catalogue: what to craft, and what it actually unlocks

Companion to `CRAFTING_DESIGN.md` (which covers materials, harvesting and
the rules). This is the example list.

**The organizing principle:** every item opens a gate that *already exists in
the engine*. Not "+2 defense" — a specific `if` in the codebase that
currently says no. That's what keeps this from being a generic survival-game
list, and it's why each entry names the system it hooks.

Rules carried over: **two inputs, depth 2, grants a verb, names its cost.**

---

## 1 · Bindings — the base of everything

| Item | Recipe | Notes |
|---|---|---|
| **Fiber** | Lichen / reeds *(harvest)* | Universal input |
| **Cordage** | Fiber ×2 | Binding |
| **Bound haft** | Deadwood + cordage | Shared handle for every hafted tool |
| **Knapped flint** | Flint *(work)* | A cutting edge |
| **Ground stone** | Stone *(work)* | A heavy head |

---

## 2 · Tools — each one makes a material exist

The tool-gating ladder. Hooks `flora.ts`'s fertility economy and terrain.

| Item | Recipe | Unlocks | Hooks |
|---|---|---|---|
| **Flint knife** | Haft + knapped flint | Reeds, butchering, better yields | Harvest yield curve |
| **Axe** | Haft + knapped flint | **Fell `tree` tiles → timber** | Removes canopy above (`deriveCanopyFromSurface`) |
| **Pick** | Haft + ground stone | **Break `boulder`; mine `wall`** | `digMultiplier` per ground type |
| **Digging stick** | Haft + bone | Root vegetables; faster soft digging | `digMultiplier` (sandy 0.6×) |
| **Sickle** | Haft + knapped flint | Harvest crops without killing the plant | `FERTILITY_AFTER_HARVEST` — a gentler recovery fraction |

**The sickle is the sleeper.** It's the first item whose whole point is
*taking less damage out of the land* — a tool that exists to reduce your
ecological footprint. Pillar 1 as a craftable.

---

## 3 · Light and fire

Hooks `fov.ts`'s darkness penalty (`NIGHT_FOV_PENALTY`) and `fire.ts`'s real
spreading fire terrain.

| Item | Recipe | Unlocks | Cost |
|---|---|---|---|
| **Torch** | Deadwood + fiber | Sight underground; the cave stops being 4 tiles wide | **Seen from further**; burns down |
| **Firestarter** | Flint + fiber | Fire anywhere — a real terrain change | Consumed |
| **Banked coal** | Fungus + clay vessel | Carry fire without holding a flame | Slow; fragile |
| **Smoke bundle** | Fiber + damp moss | Drives agents off a tile without harming them | Wind/weather dependent |

**Smoke** is the non-violent crowd-control answer, and it matters because the
alternative — hitting things — costs reputation and trust. A herd in your
crop field can be *moved* instead of fought, which is exactly the
reverent-vs-pragmatic distinction `HUMANS_DESIGN.md` builds villages around.

---

## 4 · Mobility — the map-openers

**The most valuable category**, because this engine has real, hard traversal
gates that currently just say no.

| Item | Recipe | Unlocks | The gate it opens |
|---|---|---|---|
| **Raft** | Timber + cordage | **Cross large water** | `canEnterWater` returns `false` for non-Water types on large bodies — a hard block today |
| **Climbing rope** | Cordage ×2 | Traverse elevation you can't walk | `movementSpeedFactor`'s elevation term; steep ground |
| **Snowshoes** | Fiber + hide | Cross deep snow / soft ground without the speed penalty | `terrainSpeedMultiplier` |
| **Ice awl** | Bone + haft | Break a frozen surface | The dual-state ice lid (TODO.md) |
| **Waterskin** | Hide/clay + cordage | Travel away from water | `needs.ts` thirst decay |

**The raft is the single biggest unlock in this document.** Large water is
currently an absolute wall for a land species — it's the one gate that makes
whole regions unreachable. An item that turns a wall into a route changes the
shape of the world more than any weapon could.

**The ice awl** pairs with the winter-lid design: it's how you get *through*
the lid — to fish, or to free something trapped under shallow ice.

---

## 5 · Body and survival

Hooks `needs.ts`, `status.ts`, `weather.ts`.

| Item | Recipe | Effect | Hooks |
|---|---|---|---|
| **Poultice** | Herbs + lichen | Heal away from shelter | Injury → Speed penalty (decided) |
| **Antidote** | Herbs + fungus | Clear a status | `status.ts`'s real `StatusKind`s |
| **Roasted food** | Food + fire | Better nutrition than raw | `nutritionMultiplier` |
| **Dried rations** | Food + fire/salt | Food that survives the season | Storage, winter |
| **Fur cloak** | Hide + cordage | Cold-snap protection | `weather.ts` cold-snap penalties |
| **Rain hood** | Hide + fiber | Storm accuracy penalty reduced | `stormAccuracyMultiplier` |

**Dried rations are the item that makes seasons matter.** `crops.ts` already
has a real four-season cycle with per-crop windows; without preservation,
winter is just a period when less grows. With it, autumn becomes a decision
about how much to put away — and that's the same "how full is the granary"
number `HUMANS_DESIGN.md` says drives the Survive motivation.

---

## 6 · Bonding — the Act 1 core

The playthrough found that **three of the four bonding verbs are unavailable
at spawn** (Feed, Fight alongside, Rescue, Presence — you begin with only
Presence). These items are what make the other three reachable, which makes
this the most load-bearing category in the game.

| Item | Recipe | Bonding verb it enables | Hooks |
|---|---|---|---|
| **Forage pouch** | Woven + cordage | **Feed** — carry food to give | `carryCapacityOf` |
| **Travois** | Haft + cordage | **Rescue** — drag a fainted creature | `carryingId` — agents already carry fainted allies |
| **Poultice** | *(above)* | **Rescue** — heal what you saved | Injury recovery |
| **Camouflage cloak** | Fiber + moss | **Presence** — approach without spooking | `Tile.concealment`, `FLEE_DETECT_RADIUS` |
| **Whistle / call** | Bone + cordage | Draw or scatter at range | Behavior change at distance |

**The camouflage cloak is the anti-weapon**, and the best single item in this
list for what the game is about. Every other piece of gear raises your threat
signature; this one lowers it. Concealment is already a real detection
reduction — but only from standing on a `bush` tile. A cloak makes that
portable.

So the two paths through Act 1 become craftable and opposed: **arm yourself
and be feared, or hide yourself and be tolerated.** Neither is a menu choice;
both are things you built.

**The travois** is worth flagging because `carryingId` already exists —
agents physically carry fainted allies, with the weight counting against
capacity. A travois makes that affordable for a weak human, which turns the
strongest bonding verb from theoretically-available into practical.

---

## 7 · Traps and hunting

| Item | Recipe | Effect | Risk |
|---|---|---|---|
| **Snare** | Cordage + haft | Catches prey while you're elsewhere | Could trivialise food |
| **Fishing line** | Cordage + bone | Fish as a food source | Needs water access |
| **Fish trap** | Reeds + cordage | Passive fishing | Same as snare |
| **Sling** | Cordage + hide | **Ranged attack** for the player | Ammo; noise |

**The sling matters structurally**, not for damage: it gives the player a
range band at all. Every move the player has bare-handed is `range 1`, which
means every fight is a fight you're already losing. A sling makes *distance*
a tactic instead of just a retreat.

---

## 8 · Carrying and storage

| Item | Recipe | Effect | Hooks |
|---|---|---|---|
| **Basket** | Reeds + cordage | Carry capacity | `carryCapacityOf` (`maxHp × 1.5`) |
| **Pack** | Hide/woven + cordage | More capacity, slows you | Weight → Speed → fewer actions |
| **Clay vessel** | Clay + fire | Liquids; storage | Needs a station |
| **Cache / granary** | Timber + cordage | Store food against winter | `shelter.ts` already has a food cache |

`carryCapacityOf` is `maxHp × 1.5` — a frail human's is genuinely small, so
capacity items are real upgrades rather than convenience.

---

## 9 · Protection and weapons

Deliberately the shortest category. Pillar 3: **nothing here may be
sufficient** — if a loadout clears Act 1 without a partner, it's too strong.

| Item | Recipe | Effect | Cost |
|---|---|---|---|
| **Club** | Bound haft | `swing` | Threat signature up |
| **Spear** | Haft + knapped flint | **Reach 2** | Heavy; high threat |
| **Woven wrap** | Fiber + cordage | Light armor | Weak; −Speed |
| **Hide armor** | Hide + cordage | Real armor | Requires a kill; −Speed |
| **Shield** | Timber + hide | Blunt one hit per exchange | Bulk; occupies the held slot |

---

## 10 · Act 2 — the village tier

Same ladder, better materials. *"The village has better tables and better
materials, not different physics."*

| Item | Needs | Why it's village-tier |
|---|---|---|
| **Bronze/iron tools** | Ore + smithing settlement | Ore is regionally rare — a real trade good |
| **Bow** | Timber + cordage | Named in the myth corpus; real range |
| **Plough** | Timber + metal | Farming at settlement scale |
| **Boat** | Timber ×2 + station | The raft's real successor; coastal travel |
| **Loom / kiln** | Station upgrades | Unlocks the tiers above |

---

## What this list is trying to prove

Four things, each tied to something already running:

1. **Mobility items open real walls.** `canEnterWater` and elevation are hard
   gates today; a raft and a rope reshape the reachable world.
2. **Bonding items are the actual progression.** Act 1's goal is a partner,
   and three of four bonding verbs need equipment to reach at all.
3. **Some tools reduce your footprint** (sickle, smoke, cloak) rather than
   increasing your power. That's pillar 1 as a craftable, not a lecture.
4. **Seasons only bite once you can preserve food.** Drying rations connects
   `crops.ts`'s season windows to the granary number that drives village
   motivation later.

## Open questions

1. **Is the raft too big an unlock for Act 1?** It trivialises water as an
   obstacle. Maybe it's Act 2, or maybe large water isn't in the cave anyway.
2. **Ammo for the sling** — a consumable to manage, or infinite stones?
   Recommend infinite; ammo counting is tedium.
3. **Does the cloak stack with a real `bush` tile,** or does it just grant the
   same flag? Recommend grant, not stack.
4. **How many of these ship for a first playable?** My cut: torch,
   cordage, knife, club, poultice, forage pouch, camouflage cloak. Seven —
   enough for both Act 1 paths, no station required.
