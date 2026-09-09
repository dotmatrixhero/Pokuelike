# The sensory layer: hearing, and describing a place

Two asks, one system underneath:

> "'you hear something skitter away behind you.' is cool. how would we even
> implement that?"

> "the 6 turn walk could be interesting to get bearings right? like
> explanation of the cave, what its made of, sounds? idk. just a thought.
> not every step, but every few, as you visually explore fog of war."

Both are **channels for telling the player something true that they cannot
see.** One is driven by events, the other by terrain. Neither invents
fiction: every line is derived from real state, which is the difference
between atmosphere and filler.

The governing discipline, from `NARRATIVE_PILLARS.md` and LORE_NOTES's
environmental-text channel: **describe, never explain, never editorialize.**
No "you feel uneasy." No "that sounded dangerous." State what is true and
let the player draw the conclusion.

---

## Part A — Hearing: a filter over the event stream

### The insight

Sound is the **inverse of field of view**. FOV says what you can see; sound
says what happened where you *couldn't*.

And the sim already generates a complete record of everything that happens,
with positions: `fought`, `missed`, `killed`, `defeated`, `herdClash`,
`fainted` all carry `pos: Vec2` today. So hearing needs **no new
simulation.** It is a filter:

```
heardThisTick =
    events from this tick
    WHERE distance(player.pos, event.pos) <= loudness(event)
    AND   event.pos NOT IN computeVisible(world, layer, player.pos, ...)
```

That second clause is the whole trick: **if you saw it, it isn't a sound.**
Sound is strictly the channel for the unseen.

This is architecturally the same thing `autoCamera.ts` already does — watch
the event stream, decide what deserves a human's attention — so there is
working precedent in the codebase for the shape, including its anti-spam
machinery.

### Loudness, and why hearing must out-range sight

Each event kind gets a loudness in tiles:

| Event | Loudness | Reads as |
|---|---|---|
| `killed` | 12 | "Something dies, some way off." |
| `fought` / `herdClash` | 9 | "A scuffle, east of here." |
| `missed` | 7 | (a near-miss; a scrabble) |
| `behaviorChanged` → `flee` | 5 | **"Something skitters away."** |
| `behaviorChanged` → `hunt`/`fight` | 6 | "Something starts moving with purpose." |
| `eggHatched` / `evolved` | 3 | rarely heard; you have to be close |

Underground and unlit, `computeVisible`'s darkness penalty cuts sight to
about 4 tiles. Hearing at 5–12 therefore **reaches further than sight in the
dark**, which is the entire point: the cave tells you it is inhabited before
it shows you anything.

Two deliberate departures from how sight works:

- **No line-of-sight check.** Sound goes around corners. Do *not* reuse
  `isPathClear` — that's the sight rule, and the contrast is the feature.
  A version 2 could muffle through walls; version 1 shouldn't bother.
- **Never reveal the tile.** Sound gives a *bearing and a vagueness*, never
  a position. The player learns "something is over there," which is an
  invitation, not information.

### Vagueness scales with distance

The ratio `distance / loudness` drives the phrasing:

- **< 0.4** — "Something skitters away, just past the light."
- **0.4–0.75** — "Something moves, off to the east."
- **> 0.75** — "Somewhere deeper in, something is fighting."

Same event, three registers, chosen by a number that already exists.

### "Behind you" — worth the small extra

The evocative phrasing needs a facing, and there is no facing model. But the
player's **last movement direction** is trivially trackable, and relative
bearings off it are much better prose than compass points:

- opposite your last move → "behind you"
- perpendicular → "off to your left"
- along it → "ahead, in the dark"

Cheap, and it's the difference between a log line and a moment.

### The best part: you cause most of it

You walk. An agent you cannot see crosses its `FLEE_DETECT_RADIUS`, changes
behavior to `flee`, and that logs an event. You hear it leave.

**The cave reacts to your presence, and the reaction is the sound.** That is
the threat-signature idea arriving for free, on turn 3, before the player
has any idea such a system exists. Carry a torch later and this gets *worse*
— more things notice you sooner, and you hear more of them going. The
mechanic teaches itself.

### Anti-spam is the real design work

The failure mode is a wall of noise. `autoCamera.ts` already learned this
lesson expensively (its comments document 594 herd clashes against 45 battle
hits over 6,000 ticks, and a staleness timeout that produced 26 seconds of
dead air). Borrow its answers:

- **At most one or two sounds per turn**, the loudest/closest winning.
- **Per-source cooldown**, so one fleeing Rattata doesn't narrate every tick.
- **Per-kind cluster cooldown**, so the common event doesn't crowd out the
  rare one — clashes are 13x more frequent than real fights, so unthrottled
  they would be all you ever hear.

### The one real gap

`behaviorChanged` does **not carry a position.** `logBehaviorChange` records
`agentId`, `species`, `from`, `to` — and nothing else. Every combat event
carries `pos`; this one doesn't.

Since flee→sound is *the* skitter, this needs `pos` added to the event. It's
a small change and `autoCamera.ts` would benefit too (it currently has to
look agents up by id to find where a fight started).

---

## Part B — Ambient place description

### First, the measurement that nearly killed this

Direct concern, and it was right:

> "i just would be cautious about overpromising how much prose we can
> deliver... imagine if the entire time youre in the cave you read 'moss on
> the walls here'."

So it was measured rather than argued about
(`packages/runner/src/validateAmbientVocabulary.ts`, 6 seeds, 90x60
underground layers):

| Terrain kind present underground | Share |
|---|---|
| `floor` | **95.75%** |
| `wall` | 3.68% |
| `water` | 0.57% |

**Three terrain kinds. Zero flora. Zero flavors assigned.** The `moss` /
`fern` / `bloom` vocabulary I built examples on does not occur underground at
all. Neither does `sunbeam`.

Rough ceiling: ~9 distinct lines including derived conditions. Over a 5–6
layer cave at one line per 5 turns, **each line repeats about 17 times.**

### Re-measured after merging master's new tile types — the point stands

Master since added water body kinds (`ocean`/`river`/`lake`/`pond`),
ground/soil types (`loam`/`sandy`/`clay`/`rocky`/`peat`), `ice`, and
permanent ground degradation. The first version of the measurement counted
only `tile.terrain` and therefore missed all of these, since they are
**orthogonal per-tile tags rather than terrain kinds** — that was a real
flaw in the script, now fixed.

Counting them properly changes almost nothing underground, for a specific
reason:

| Underground, 6 seeds | Result |
|---|---|
| `groundType` set | **0%** — 100% unset |
| `waterKind` set | **0%** — 100% unset |
| Tiles with permanent degradation | 0 |
| Ceiling | ~9 → **~11** (and only because "unset" counts as a category) |

**The new tile systems are surface-only.** `assignGroundTypes` reads
`tileAt(world, "surface", x, y)` explicitly, and `assignWaterKinds` runs the
same pass. None of it reaches the underground layer.

So the sharper version of the finding: it isn't that the *world* is poor in
detail — the surface is getting steadily richer. It's that **the cave
specifically is unenriched, and Act 1 happens entirely in the cave.** Every
enrichment pass so far has gone somewhere the opening never visits.

That also makes the fix concrete and cheap: extending `assignGroundTypes`
(and harvestable flora) underground would deliver both the mechanical
substance and the descriptive vocabulary in one change, rather than needing
a separate "make the cave interesting" project.

The concern wasn't a worry to manage. It was a correct prediction, and the
version of Part B written before this measurement was overpromising.

**Honest correction to the playthrough**, too: `PLAYTHROUGH_LAYER1.md`'s
turn-7 chamber — sunbeams, flora, berries — is *not* what ordinary
underground generation produces. Landmark zones (`deepCavern`,
`sacredSpring`, `frozenGrotto`…) carve extra terrain, but they're the
exception by definition. Layer 1's lit chamber is content that has to be
deliberately built, not something worldgen hands us.

### The real diagnosis: it's not a prose problem, it's an empty cave

A cave that is 95.75% identical floor with nothing in it isn't just boring to
*read* about — it's boring to *walk* through. The prose was going to be
repetitive because the underlying place has nothing to say. Writing better
sentences about the same three tiles would have been decoration over a
content gap.

### The fix: prose points at affordances, not scenery

Direct, and it's the reframe the whole section needed:

> "plus if there's moss, i'd want it to be harvestable as a crafting
> resource or some shit... i want the prose to DO something for us"

That solves the repetition problem structurally rather than cosmetically:

- **A repeated line is only filler if it's inert.** Roguelikes have printed
  "you see 3 arrows here" forever and nobody minds, because it's actionable.
  "Moss on the walls here" is annoying the 17th time only if moss is
  scenery. If moss is a harvestable crafting input, the 17th time is a
  resource callout — the game telling you something is available.
- **It gives the describer a job.** Not "convey atmosphere" but "tell the
  player what they can act on that they might otherwise walk past." That's a
  falsifiable purpose, and it's the same job the search/scavenge verb has.
- **The vocabulary then scales with interactable content, not with the
  terrain palette.** Every new harvestable is simultaneously a new line and
  a new mechanic. Prose variety stops being something to fake and becomes a
  free side effect of gameplay depth.

So the ordering changes: **don't build the describer first.** Put things in
the cave worth mentioning, and the describer becomes worth having as a
consequence. `flora.ts` already has growth, regrowth and decay, so a
harvestable moss/lichen/fungus that regenerates is an extension of a live
system rather than a new one — and it gives crafting the input source it
currently doesn't have anywhere.

### Why sound survives this and description didn't

Worth stating as a principle, because it generalises:

> **Event-driven prose draws on an inexhaustible source; terrain-driven
> prose draws on a finite one.**

Sound is generated by the simulation — different species, distances,
causes, outcomes, and it never stops producing new combinations because the
world keeps running. Terrain description is generated by a tileset with
three entries underground. Part A is safe as designed. Part B was not, and
needed the affordance reframe to become worth building.

### The remaining design, now much smaller

Different trigger, same principle. This one is driven by **terrain the fog
of war just revealed**, not by events.

### The trigger

Diff `computeVisible`'s output between turns. When the newly-revealed set is
*materially different* from what you already knew, say one thing about it.

"Materially different" needs to be a real test, not a timer, or it becomes
wallpaper. Fire only when the new ground crosses a threshold:

- **Composition shift** — wall ratio up sharply (the passage narrows), or
  down (it opens out).
- **A new terrain kind appears** — water, sunbeam, mud, sand, bush, tree,
  boulder.
- **Water body size** — `waterBodySizeAt` already exists; a puddle and a
  lake deserve different sentences.
- **Elevation change** — the floor is climbing.
- **A landmark tile** — `deepCavern`, `boneGrounds`, `frozenGrotto`,
  `sacredSpring`, `tunnelWarren` are all real and all carry obvious registers.

Plus a hard budget: **at most one line every N turns**, and never twice in a
row about the same thing. The user's own framing — "not every step, but
every few" — is the requirement.

### Everything it says must be true in the data

This is what separates it from a random flavour pool, and it's the project's
existing standard: *"generated text that is vague is a bug."*

| Real state | Line |
|---|---|
| wall ratio rising | "The passage narrows." |
| water revealed, small body | "There's water ahead — a pool, not much more." |
| water revealed, large body | "The ground opens onto water; you can't see the far shore." |
| `sunbeam` revealed | "Light from somewhere above." |
| `mud` terrain | "The floor turns soft underfoot." |
| flora with `flavor: "moss"` | "Moss on the walls here, and damp air." |
| `boneGrounds` landmark | "Bones underfoot. Old ones." |
| elevation climbing | "The floor is rising." |

Note the last-but-one. `boneGrounds` says *"bones underfoot, old ones"* and
**stops**. It does not say "something terrible happened here." The player
supplies that. This is the environmental-text channel from LORE_NOTES
exactly: *found, unexplained, nobody comments.*

### `Tile.flavor` is thinner than it looks

`FLORA_FLAVORS` is only `["moss", "fern", "bloom"]` and is documented as
purely cosmetic. Useful, but the real descriptive vocabulary here comes from
terrain kind, water body size, elevation delta and landmarks — all of which
carry more signal than the flavour string does.

### This is pillar 2's curation layer, in miniature

`NARRATIVE_PILLARS.md` mandates it and leaves it unbuilt: *"the game is
responsible for noticing on the player's behalf... an editorial layer that
decides what surfaces is a separate job from simulation, and it is not
optional."*

The ambient describer is the smallest possible instance of that job —
deciding, from a mass of true facts, the one worth a sentence. Building it
here is a cheap rehearsal for the version that later has to pick which
generated history a player ever sees.

---

## What this fixes

The playthrough's weakest stretch was six turns of pressing a direction key
across empty rock. These two systems turn that into the cave introducing
itself:

```
  Turn 1  > move east
          The passage narrows.

  Turn 3  > move east
          Something skitters away, behind you.

  Turn 5  > move east
          Moss on the walls here, and damp air.

  Turn 6  > move east
          Light from somewhere above.
```

Four lines across six turns. Nothing invented, nothing explained. The
narrowing is a real wall ratio, the skitter is a real agent that really fled
because you really got too close, the moss is a real tile flavor, and the
light is the sunbeam you're about to walk into.

It also means **auto-travel doesn't have to be silent.** A `travel` command
that prints these as it runs is a better solution to the dead stretch than
either walking manually or skipping instantly.

---

## Part C — Rendering is a channel, and it's the primary one

The measurement above pushed this doc toward "say less." The corollary,
arrived at while working out how exhausted ground becomes perceivable, is
that **the best answer to a lot of prose problems is not prose.**

Three channels carry the same fact on different timescales:

| Channel | Job | Cost |
|---|---|---|
| **Rendering** | The always-on tell. Warns *before* the consequence. | A palette change |
| **Prose** | Only when actionable — what you can do about it | Budgeted, repetition-prone |
| **Chronicle** | The after-the-fact why | Already built |

Worked example — degraded ground:

- **Rendering**: `groundDegraded` is a 0–1 float, so a tile can desaturate
  continuously with it. Exhausted ground simply *looks* tired next to
  healthy ground. No text, no budget, no repetition problem, and it directly
  satisfies "mechanics visible on the map, not hidden in a meter."
- **Prose**: *"The ground here is spent"* fires on approach to badly
  degraded ground and nowhere else — it earns the line by saying *don't
  bother harvesting*, which is the affordance rule from Part B.
- **Chronicle**: *"The herd left; the valley had been picked over."*

**The general lesson for this document:** before writing a describer for
something, ask whether the renderer could carry it instead. A continuous
visual signal has no vocabulary ceiling, never repeats, and never needs an
anti-spam budget — which are exactly the three problems that nearly killed
Part B.

Practical wrinkle: `PEAT_DEGRADE_MAX` caps permanent damage well short of 1,
so the visible range is narrow. The palette work has to be legible inside a
small band, or the tell won't read.

## Honest gaps

- **Part B is blocked on content, not on writing.** Ordinary underground
  affords ~9 distinct lines. Until there are harvestables and features in
  the cave, an ambient describer has nothing worth saying and shouldn't be
  built.
- **The cave needs things in it.** 95.75% identical floor is the finding
  under the finding. Harvestable flora (moss/lichen/fungus) is the obvious
  first fill, it feeds crafting's missing input source, and `flora.ts`
  already has the growth/regrowth machinery.
- **Re-run the measurement after adding content.**
  `validateAmbientVocabulary.ts` gives the ceiling as a number, so the
  question "is there enough to say yet?" stays answerable rather than
  becoming a matter of taste.
- `behaviorChanged` needs `pos` added (Part A's only real code prerequisite).
- No facing model; relative bearings need last-move-direction tracked on the
  player.
- Anti-spam tuning is the actual work here and can only be done against a
  real run, not on paper.
- The ambient describer needs a "what did I already say" memory or it will
  repeat itself in a long corridor.
- Nothing here is built.
