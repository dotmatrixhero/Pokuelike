# Human geography: how people mark the land

Direct ask: *"help me think of roads towns and like geography and like shrines
and farms and shit. Human affecting the land shit."*

Companion to `HUMAN_PASS.md` (sequencing, settlement identity) — this one is
about the **terrain**: what changes on the map because people are there, and
how you read it by looking.

## The organizing idea: a footprint is a gradient, not a boundary

A settlement should not be a walled box with wilderness starting one tile
outside it. It should fade. Walking toward a town, in order:

| ring | what you see | built from |
|---|---|---|
| **wild** | untouched | — |
| **trodden** | paths, then roads, converging | traffic accretion (below) |
| **gathered** | stumps, cut deadwood, quarried rock, thinned flora — terrain *thinned*, not replaced | `harvest.ts` + the decal system |
| **worked** | fields, orchards, pasture — terrain *replaced*, in orderly rows against wild scatter | `crops.ts` |
| **core** | homes, walls, forge, shrine | `shelter.ts`'s travel-and-invest |

The important property: **you can tell how close you are to people without
seeing a person.** That is the *mechanics visible on the map* pillar applied
to civilisation itself, and it does most of the storytelling for free.

**Most of this is composition, not new systems.** Gathering, crops, shelter
and decals all exist. What is missing is pointing them at a settlement centre
and letting intensity fall off with distance. That is the cheapest large win
in this whole design.

## Roads accrete from traffic

`HUMANS_DESIGN.md` open question 3 recommends roads that exist *because they
were walked* rather than an MST. Concretely:

- Each tile carries a **traffic** counter, bumped when someone walks it.
- Cross a threshold -> `path`. Cross a higher one -> `road`.
- **A road is cheaper to walk.** That is the whole trick: it creates positive
  feedback, so traffic concentrates into genuine corridors instead of
  smearing into a vague trampled blur.
- **Traffic decays when unused**, so roads overgrow. A settlement that falls
  leaves roads that fade — exactly the reversibility the design already asks
  for.

Two things to get right:

- **Cap the feedback.** Unbounded reinforcement produces one super-highway and
  nothing else. The cheapness bonus needs a ceiling, and decay needs to be
  fast enough that minor routes can die.
- **Two resolutions, because the history pass cannot simulate footsteps.**
  Compressed centuries at macro scale can't count per-tile steps. So: the
  history pass lays corridors between settlements at **zone** resolution from
  abstract trade volume; live play then accretes and erodes at **tile**
  resolution on top. Same output shape, two clocks.

## Geography makes chokepoints, and settlements should find them

Roads have to respect terrain: mountains block, rivers need a ford or a
bridge, marsh is slow. That is not a constraint to work around — it is a
**generator of interesting places**.

Where a corridor is forced through a narrow gap, you get a bridge town, a
pass town, a ford. Those are the places where trade concentrates, where
conflict concentrates, and where a settlement founded there punches above its
size. **The history pass should prefer chokepoints when siting**, alongside
the fresh-water rule. A town that exists because it controls the only ford
across the river is a town with a reason and a vulnerability, both legible.

## Farms

The clearest human mark on the map, and the substrate is built (`crops.ts`,
plus growth-stage rendering already shipped).

- A farm is a **claimed block of tiles** near water, in orderly rows — the
  visual opposite of wild flora's scatter. Order is the tell.
- It has **seasonal state**: tilled, growing, ripe, harvested, fallow. The
  map therefore shows *time*, not just place, and a town's year is readable.
- It is **raidable**, which is where this stops being decoration: a migration
  route that now crosses farmland is already the kind of contention
  `herdConflict.ts` generates on its own. Farms give the ecology something to
  push against.

## Shrines

Place a shrine **where something happened** — a death, a first bond, a
disaster, a founding. Never on a rule like "every town gets one at the north
gate."

That single constraint buys a lot: the shrine is narratable by construction
(*"the shrine at the ford, where the elder's daughter was taken"*), it is
true in the data because the chronicle recorded the event, it gives the
Devotion drive somewhere to act, and it generates **pilgrimage traffic** —
which feeds the road system, which means a shrine slowly draws a path to
itself. A remote shrine with a well-worn track to it tells you people still
come.

## The part that makes it mean something: humans can overshoot

Everything above is humans *improving* their surroundings. If that is all it
is, the footprint is decoration.

**Human land use should be able to go too far, visibly and with consequences:**

- Clear-cut the forest ring and the timber runs out — and so does the game
  that lived in it.
- Over-farm and soil degrades; yields fall; the town stagnates or moves.
- Quarry the hillside and it stays quarried.
- Foul or over-draw the water and downstream suffers.

This is the *equilibrium and variety* pillar pointed at people: humans as an
ecological force that can push too hard and pay for it. It also gives the
wild an actual antagonistic relationship with settlement rather than a
decorative one, and it produces the best kind of story — a town that failed
for a reason it caused.

## Everything must be reversible

A ruin is only interesting if the land remembers. Every human change needs an
un-work path:

- fields go fallow, then wild
- stumps regrow
- roads overgrow as traffic decays
- walls crumble to rubble

The machinery mostly exists: `tickHarvestRegrowth` and `naturalDecalAt`
already restore gathered decals over time, which is exactly this shape. A
ruined settlement should be findable years later as a rectangle of oddly
regular flora with a fading track leading to it — and the chronicle should
still know its name and what killed it.

## Open questions

1. Does terrain damage (deforestation, soil depletion) get simulated live, or
   only resolved at macro scale by the history pass?
2. Do roads need bridges as buildable structures, or do fords just exist as
   shallow-water tiles?
3. How far out does the gathered ring reach — one zone, or several? This sets
   how much of the map reads as "settled" and ties to decision 6's *populated
   but wilderness-dominant* target.
4. Do farms need livestock/pasture, given decision 4's no-domesticated-Pokémon
   rule? (Pasture with no animals is odd; farms may be crops-only here.)

---

# Answers and revisions

## Shrines: three kinds, not one

The "place it where something happened" rule was too narrow. Direct
correction: *"shrines can also in honor of sacred/legendary Pokémon too. So
usually like shintoism kinda a place that honors a particular spirit."*

The unifying rule is better stated as: **a shrine always honors a particular
named something.** Never a generic "shrine" prop. Three sources:

- **Event shrines** — sited where a recorded thing happened. A death, a first
  bond, a disaster, a founding. Narratable by construction.
- **Kami / nature shrines** — sited at a notable natural feature that is
  itself the honored thing: the spring, the old tree, the mountain, the ford.
  This is the Shinto reading and it fits a world whose terrain is already
  generated with real causes — the spring is *actually* the only water for
  three zones, and that is why it is sacred.
- **Legendary shrines** — honoring a sacred/legendary Pokémon, sited where it
  is, was, or was believed to have been.

A shrine record should name its spirit, because that is what lets the
settlement's attitude axis inherit from it. A town whose shrine honors a fire
legendary beneath a volcano has *opinions* about fire, and its people should
say so. See `MYTH_STRUCTURES.md` and `LORE_NOTES.md` for the register.

## Graveyards and ghost Pokémon

Direct ask: *"graveyards with ghost Pokémon is a must as well."*

- A graveyard **accretes** — one marker per recorded death, growing with the
  settlement's history. An old town has a big one; a fresh outpost has none.
- **Ghost-types are drawn to it** as a habitat bias.

The consequence is the good part: **ghost encounters become caused rather
than random.** Ghosts are where the dead are, the dead are where people have
lived and died for a long time, and all of that is already in the chronicle.
A player learning "old settlements mean ghosts" is learning something true
about the world — the *pattern over instances* this project keeps aiming for.

And the dark version comes free: a settlement that **fell** leaves a graveyard
with nobody left to tend it. A haunted ruin, generated honestly, with names
on it and a recorded cause of death for every one.

## Revision: the footprint is a gradient *plus satellites*

Direct answer to how far the worked land reaches: *"Several zones. Plus
outpost homes and stuff. More rural farms can live several zones away from a
village."*

This breaks the clean radial falloff above, and it should. Real settlement is
a gradient **with detached outliers** — the lone farmstead, the outpost, the
holding three zones out with one family on it. So the model is:

- an intensity falloff around each settlement, several zones deep, **plus**
- **detached satellites**: isolated farmsteads and outposts with their own
  tiny footprints, linked back by a thin track rather than sitting inside the
  main ring.

This is better than the pure gradient for three reasons. It puts human things
out in genuine wilderness, so you meet people before you reach a town. It
makes those places **vulnerable** — an outlying farm is the natural site for
a night raid, and that is a story the sim can generate rather than script.
And it means "settled land" is not one blob per town, which keeps decision
6's *populated but wilderness-dominant* target reachable at several zones of
reach.

## Offscreen terrain change — this needs new architecture

Direct answer: *"it is live... but it doesn't have to happen WHILE you're in
the zone. It can be offscreen."*

**Checked: nothing like this exists.** The engine ticks everything every
tick; there is no zone activity model, no dormancy, no catch-up. (The one
"dormant" mention, in `herdMigration.ts`, is a rolling-window approximation
for predator pressure, not deferred simulation.)

The substrate is right, though: the macro grid already holds compact
per-zone facts cheaply. Recommended shape:

- **Lazy fast-forward as the default.** Each zone records the tick it was
  last resolved. On entry — or on any query — advance it in a single step
  from the elapsed time rather than replaying the gap. Deforestation, soil
  depletion, regrowth and road decay are all accumulation-shaped and
  fast-forward exactly.
- **A coarse periodic pass for anything that crosses zone boundaries.**
  Water, migration and trade affect neighbours, so they cannot wait to be
  observed — those need a cheap sweep on a slow clock.

The trap to avoid: lazy resolution must be **observation-independent**, or
the world changes because you looked at it. Fast-forwarding on entry is fine;
fast-forwarding *differently* depending on whether the player is watching is
the bug that makes a simulation feel fake. Any validation harness for this
should compare a lazily-resolved zone against a fully-ticked control — and
that control is what makes the measurement mean anything.

## Bridges

Confirmed as real buildable structures, not just shallow-water fords. That
makes a river a genuine barrier until someone invests in crossing it, which
is what turns a ford or a bridge into a chokepoint worth siting a town on —
and gives a raid or a flood something specific to destroy.

## Domestication: amending decision 4

Direct answer: *"Crops only is fine. I think domestic can be fine, just not
like captured in poke balls and trained. Idk."*

`HUMANS_DESIGN.md` decision 4 currently reads **no domesticated Pokémon at
all** in this region. The amendment worth making is a distinction rather than
a reversal:

> **Domestication without partnership.** A penned Miltank is livestock. It is
> used, not befriended; it does not fight beside anyone; nobody asks it
> anything.

That is a *different relationship* from a bonded partner, and keeping them
separate is what protects the premise. The player's innovation is not "a
human using a Pokémon" — it is **a Pokémon that chooses to stand beside
you**. A village that keeps animals in pens is then the perfect foil: the
contrast is what makes the bond legible, rather than undermining it.

Two honest risks, since this is being changed rather than decided fresh:

- **It softens "you're the first."** Even framed as livestock, a village that
  already handles Pokémon daily makes the player's arrival less singular. The
  mitigation is to keep domesticates few, dull and clearly un-partnered —
  nothing anyone would call a companion.
- **It cuts against decision 3's tonal intent.** Hunting was kept lore-only
  specifically *"to keep humans sympathetic in the present."* Penned livestock
  is a milder version of the same exploitation, on screen this time. That is a
  tone call, not a mechanics call, and it is worth making deliberately rather
  than inheriting it from a yes.

**Recommendation: allow it, narrowly** — a small number of dull domesticates
(wool, milk, eggs), no working animals in combat, no named ones. If it reads
badly in a real run, it is cheap to pull back out.
