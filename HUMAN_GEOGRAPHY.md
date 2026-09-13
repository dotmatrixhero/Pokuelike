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
