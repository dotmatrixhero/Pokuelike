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

### 1. You are using 10% of your species

| | Count |
|---|---|
| Species in the generated dex | **1085** |
| Species in the active roster (`packages/data/src/species.ts`) | **108**, all Gen 1 |

*(This section originally said 70, then 50; master's whole-roster pass took it
57 → 108. Recounted directly off the `SPECIES` record. Design decision
recorded alongside it: **stay Gen 1 for now** — 108 of Gen 1's 151.)*

And the placement machinery already exists — `estimateZoneSpecies`,
`speciesFitsZone`, and `SpeciesDef`'s `biomes` / `preferredTerrain` /
`activityPattern` / `isPredator` gating.

This was the single largest latent content pool in the project and master has
now largely spent it for Gen 1 — 108 of 151. The remaining headroom inside the
Gen 1 decision is small; the next real breadth lever is behaviour doors, not
roster size.

**Note added from `EMERGENT_SITUATIONS.md`:** breadth here multiplies against
behaviour doors rather than adding to them. Each new species is not one new
thing, it is one more row against eighteen behaviours, four weather types and
two activity patterns — which is also the argument for doing the doors *first*
and the roster second.

**The caveat, which is real:** pillar 2's own stated tension. Breadth without
curation is noise. Triple the species and you triple the event log, and
"stories everywhere" becomes stories nowhere. Roster width and the curation
layer have to grow together.

### 2. Seasonal freezing — corrected, and then made real

**I overstated this and it needs fixing before the design built on it.**

The claim was that frozen water becomes a walkable route. Verified against
`weather.ts`, it doesn't, for a reason its own doc comment states plainly:

> "deliberately NOT applied to large bodies (an ocean/big lake freezing
> solid isn't the ask; a pond/puddle/small pool is)"

Only bodies **below** `LARGE_WATER_BODY_MIN_SIZE` freeze. And
`canEnterWater` already returns `true` for any small body — anyone can wade
a puddle. So the water that freezes was **already crossable**, and freezing
changes nothing about traversal. No winter island, no shortcut. The
mechanism is real; the gameplay consequence I claimed is not.

(Second time this session I asserted from a plausible reading instead of
checking. The correction discipline holds: grep the callers first.)

#### The version that does work — from the ruling on fish

> "for freeze, fish should be considered underground. If they're in it the
> ice should not affect them unless it's shallow smaller puddles."

That ruling is what makes the feature real, because it separates two things
the current implementation conflates: **an ice lid is not the same as
freezing solid.**

- **Large bodies get a surface lid.** The water underneath is unchanged.
  Land species walk on top; aquatic species keep swimming below, unaffected —
  they are, as the ruling puts it, *underground* relative to the ice.
  This is the seasonal topology change, and it needs large bodies to freeze
  at the surface, which today they explicitly don't.
- **Small, shallow water freezes through.** A pond or puddle has no water
  column to be under. Fish there are genuinely affected.

The prior "no large-body freezing" decision was against a lake freezing
*solid*, and a lid isn't that — so this reads as a refinement rather than a
reversal. Worth flagging as one anyway.

**`waterKind` already carries the shallow/deep signal.** `pond` is the
shallow case; `lake`/`river`/`ocean` are the ones that get a lid. No new
data needed — the field landed on master days ago.

The ice tile becomes **dual-state**: walkable terrain for anything above it,
still water for anything below. That's the whole mechanic, and it's what
makes a frozen lake interesting rather than just a recoloured tile.

#### The trapped fish, correctly scoped

Under this ruling the Rescue scenario only happens in **small shallow
water** — which is better design than my version. It's rare, it's specific,
and it can't become a routine occurrence that cheapens the strongest bonding
verb. A fish stranded in a frozen puddle is a moment; a lake full of them
every winter is a chore.

Still worth checking as a possible bug either way: an obligate aquatic on an
`ice` tile is no longer on `"water"`, so `canEnterLand`'s gate doesn't see
what it expects.

---

### 2b. What the original finding was actually pointing at

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

---

## Legibility: the rule for whether a crossing is worth building

Raised directly, and it's the more important of the two threads:

> "I think herds emigrating might show in chronicle but not the land itself.
> Maybe that needs to show up if you get close to scarred ground?"

Correct — and as designed, the crossing would have been invisible. The
chronicle would record *"the herd left, food was scarce"* while the ground
that caused it looked identical to every other tile. A true simulation the
player cannot perceive is worth nothing.

So the general rule, which applies to every crossing in the catalogue above:

> **A cause must be visible before its consequence, or the consequence reads
> as randomness.**

Not merely *visible at all* — visible **first**. If you can only tell the
ground was exhausted after the herd has gone, you've learned nothing you can
act on. If you can watch it degrade while the herd is still there, the
departure becomes a thing you saw coming and could have prevented. That is
the difference between a simulation that teaches and one that just happens.

### Three channels, doing different jobs

- **Rendering — always on, no prose.** `groundDegraded` is a 0–1 float, so
  the renderer can desaturate or dull a tile continuously with it. Exhausted
  ground should simply *look* tired next to healthy ground. This is the
  primary channel and it costs one palette change: no text, no budget, no
  repetition problem, and it satisfies the "mechanics visible on the map,
  not hidden in a meter" principle directly.
- **Prose — only when actionable.** Per `SENSORY_LAYER.md`'s affordance
  rule, a line earns its place by telling you something you can act on.
  *"The ground here is spent"* qualifies: it says don't bother harvesting.
  It should fire on approach to badly degraded ground and nowhere else.
- **Chronicle — the why, after the fact.** *"The herd left; the valley had
  been picked over."* This is the record, not the warning.

Rendering warns, prose explains the affordance, the chronicle closes the
loop. Same fact, three timescales.

### Why this one matters more than the mechanic

`NARRATIVE_PILLARS.md` asks for "constellations of broad reasons" and calls
single-cause events the failure mode. The full chain here is already
available: *you harvested → fertility fell → the herd migrated → the
predators that followed it went too → the valley is quiet.* Every link is a
built system.

But a player only experiences that as a story if they can see the first link.
Otherwise it's four invisible steps and one visible outcome, which reads as
the world being arbitrary — the exact opposite of the intended effect.

**Generalised: for any crossing, ask what the player sees at each link. If
the answer is "nothing" for the early ones, build the tell before the
mechanic.**

## Open questions

1. How wide should the roster actually get? 70 → 150? → 400? The ecology
   balance work scales with it, and so does log noise.
2. Does the curation layer need to exist *before* breadth, or can it lag?
   Pillar 2 implies before; practicality implies alongside.
3. Should large water bodies get an ice lid in winter (the ruling above
   implies yes), and does that reverse the earlier "no large-body freezing"
   call or refine it?
4. How degraded is *visibly* degraded? `PEAT_DEGRADE_MAX` caps the permanent
   damage well short of 1, so the visual range is narrow and the tell has to
   work inside it.
