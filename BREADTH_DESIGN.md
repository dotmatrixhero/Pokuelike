# Breadth: where interesting comes from cheaply

> "Let's talk design more. How do we push breadth and interesting stuff"

## The thesis: breadth comes from crossing systems, not adding them

A new system costs O(n) to build and adds O(n) *potential interactions* with
everything already there. This project has ~45 engine modules. The
interaction space is already enormous and mostly unexplored — so the cheapest
breadth available is **wiring, not building.**

The codebase's own history is the evidence, and it's a pattern this session
hit three separate times:

- `fov.ts` — a complete field-of-view system with elevation asymmetry,
  concealment and darkness terms. Fully built, fully tested, **zero callers.**
- `elevation.ts` — accuracy/evasion modifiers, written and tested, **zero
  callers** until this session wired them.
- `assignGroundTypes` — soil types with fertility ceilings and regen rates,
  built and shipped, **surface-only**, so Act 1's entire setting gets none of
  it.

Three systems built and left disconnected. That is not sloppiness — it's what
happens when building is more fun than connecting. But it means the marginal
value in this codebase sits in the joins.

---

## Three measured findings

### 1. You are using 6.5% of your species

| | Count |
|---|---|
| Species in the generated dex | **1085** |
| Species in the active roster (`packages/data/src/species.ts`) | **70** |

And the placement machinery already exists — `estimateZoneSpecies`,
`speciesFitsZone`, and `SpeciesDef`'s `biomes` / `preferredTerrain` /
`activityPattern` / `isPredator` gating.

This is the single largest latent content pool in the project. Going from 70
to 200 biome-gated species would transform variety at close to zero design
cost per species — the work is curation (which ones, what stats, does the
ecology still balance), not construction.

**The caveat, which is real:** pillar 2's own stated tension. Breadth without
curation is noise. Triple the species and you triple the event log, and
"stories everywhere" becomes stories nowhere. Roster width and the curation
layer have to grow together.

### 2. Seasonal freezing already changes the map's topology — and nobody noticed

This is the best find in this document.

`weather.ts`'s `advanceWaterCycle` already freezes surface water to `ice` in
winter and thaws it in spring, logging `terrainChanged` with cause
`"freeze"`/`"thaw"`. Small bodies freeze; large ones don't
(`LARGE_WATER_BODY_MIN_SIZE`).

And `canEnterWater` returns `true` immediately when `tile.terrain !== "water"`.
**Ice is not water.** So:

> **In winter, frozen ponds and lakes become walkable by every land species.
> In spring, the route closes.**

That is a seasonal change to the *traversable shape of the world*, running in
the simulation right now, and no design document mentions it. It's free
level design:

- An island reachable only in winter.
- A shortcut that closes behind you.
- A herd whose migration route opens and shuts with the calendar.
- Ice fishing, later.

**And a likely bug worth checking:** an obligate-aquatic agent (Magikarp,
Tentacool) in a pond that freezes is now standing on `ice`, which is not
water. `canEnterLand` exists to stop them leaving water — what does it do
when the water stops being water? Either they're stranded or the gate leaks.

That bug is also an opportunity: **a fish trapped under ice you can break is
a Rescue** — and Rescue is the strongest of the four bonding verbs, the one
DESIGN.md calls out because "the Pokémon chooses you as much as you chose
it." A complete, emergent bonding scenario falls out of two systems that
already exist and have never been introduced.

### 3. Fire has no relationship with fertility

`grep fertility packages/engine/src/fire.ts` returns nothing.

Fire spreads, consumes fuel, damages, and burns out to scorched floor. It
never touches the soil economy that sits directly underneath it.

**Slash-and-burn is the missing crossing.** Burning vegetation should raise
`fertility` afterwards — real agronomy, and it gives fire a *constructive*
use to weigh against its destructive one. That's a genuine decision with a
time cost (burn now, richer ground later), it pairs with `groundDegraded`,
and it's the kind of thing a settlement's practice could diverge on, which
`MYTH_STRUCTURES.md` wants for its Contract skeleton.

---

## The catalogue of unconnected pairs

Ranked by (value ÷ cost). Everything here is two systems that already exist.

| Crossing | What it produces | Cost |
|---|---|---|
| **freeze × traversal** | Seasonal map topology — *already works, needs exploiting* | ~0 |
| **fire × fertility** | Slash-and-burn; fire as a tool, not just a hazard | Low |
| **`groundDegraded` × `herdMigration`** | **Herds abandon land you exhausted** — pillar 4, visibly | Low |
| **`fov` × player** | Fog of war, ambush, scouting, the whole sensory layer | Medium |
| **daynight × fov × `activityPattern`** | Night is a different game; nocturnal species get their edge | Low |
| **tree felling × canopy** | Habitat loss you can watch on another layer | Low |
| **`rapport` × `herdLeadership`** | Bond the *leader* and the herd's posture shifts — vs bonding a member | Medium |
| **`waterKind` × species** | River vs lake vs ocean species; a real aquatic geography | Low |
| **crops × seasons × storage** | Famine as a real event; the Survive motivation | Medium |
| **`notables` × player** | Reputation — earned titles pointed at the player | Low |
| **landmarks × shrines × chronicle** | Places that remember, worshipped for real reasons | Medium |

The third row deserves emphasis. **Herds leaving land the player exhausted**
is the clearest possible statement of "all that you change, changes you," it
needs no new system (scarcity-triggered migration already exists, fertility
already exists), and it is the pillar currently least visible in play.

---

## What "interesting" looks like when it falls out of a crossing

Four scenarios, none of which needs a new system:

- **The winter island.** A pond freezes; you cross to ground you couldn't
  reach; the thaw strands you there until you find another way.
- **The fish under the ice.** A pond freezes over an obligate aquatic. You
  break the ice. That's a Rescue, and the strongest bond in the game starts
  because the weather did something.
- **The exhausted valley.** You harvest a slope for a season. Fertility
  drops, the herd that fed there migrates, and the predators that followed it
  go too. The place is quieter when you come back, and the chronicle can say
  why.
- **The burned field.** You burn back the scrub. Next season it's the best
  ground in the zone. A neighbouring settlement watches you do it and adopts
  the practice — or doesn't, and their harvest is worse.

Each is two existing systems meeting. None needs new content.

---

## The trap to avoid

**Adding a system is the *most* expensive way to buy breadth**, and it's the
most tempting because it feels like progress and starts clean.

Symptoms that we're doing it wrong:
- A new module lands with no caller outside its own tests.
- Content is added faster than the curation layer that surfaces it.
- Two systems model the same thing (a "resource" system next to `fertility`,
  a "morale" system next to `Disposition`).

The test before building anything new: **which existing system does this
touch, and what does their interaction produce?** If the answer is "none,"
it's a feature, not breadth.

---

## Where I'd actually push, in order

1. **Exploit the freeze.** It already works. Design around it and it costs
   almost nothing — and check the trapped-aquatic case, which is either a bug
   or the best bonding scenario in the game.
2. **Wire `groundDegraded` → `herdMigration`.** The most pillar-serving
   crossing available, from two built systems.
3. **Fire → fertility.** Small, and it converts fire from a hazard into a
   tool with a real tradeoff.
4. **Widen the species roster**, deliberately and with the curation layer in
   mind — the 70/1085 gap is the largest content lever in the project.
5. **Ground types underground.** Still blocking crafting, still a small change
   to an existing pass.

## Open questions

1. How wide should the roster actually get? 70 → 150? → 400? The ecology
   balance work scales with it, and so does log noise.
2. Does the curation layer need to exist *before* breadth, or can it lag?
   Pillar 2 implies before; practicality implies alongside.
3. Is there a rule for which crossings are legible to a player? Herds
   leaving degraded land is only meaningful if the player can *tell* that's
   why — otherwise it's invisible simulation.
