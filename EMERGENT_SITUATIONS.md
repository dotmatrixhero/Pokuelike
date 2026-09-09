# Emergent situations: how player–Pokémon interaction scales

Written in answer to a direct worry, and it is the sharpest question asked of
this design so far:

> "I'm more worried about once you get out on to the world. I want lots of
> open situations to happen you know? Act 1 can be scripted but the beauty of
> the game is that we can have many many different situations... how are we
> gonna scale out the Pokémon to player interactions in a meaningful way?
>
> Like. In dwarf fortress, units do things. You know? Stories emerge. Our core
> game loop doesn't have that."

The worry is correct. This doc says exactly *why* it's correct, what the fix
is, and plays a scene to show the difference. `SENSORY_LAYER.md` covers how
much prose we can afford; this is the prior question — **what is there to
write about.**

---

## The diagnosis, in one line

> **The sim's verbs and the player's verbs are disjoint sets.**

`BehaviorKind` has eighteen entries. The player has roughly seven actions
(move, examine, search, craft, watch, equip, attack). **Almost nothing
overlaps.**

An agent running `deliverFood` is doing something the player cannot help
with, hinder, join, follow, or rob. `carryAlly` — you cannot take the load.
`buildShelter` — you cannot hand it a plank. The world is extremely busy and
the player is sealed out of all of it.

That is the whole gap. It is **not** "not enough content."

## The rule was already discovered here — it just never got named

Set the four locked-in bonding verbs against `BehaviorKind`:

| Bonding verb | The behaviour it is a door into |
|---|---|
| **Feed** | `deliverFood` |
| **Rescue** | `carryAlly` |
| **Fight alongside** | `fight` / `herdClash` |
| **Presence** | `sleep` / `restAtShelter` |

Every one is an existing sim behaviour that the player was given a way into.
And `CAMPAIGN_DESIGN.md`'s dispersal offer is the fifth — `disperse`. Nobody
wrote a scenario for it. We found something the sim already does and let the
player be inside it.

So:

> **Every behaviour the sim runs is a situation family the moment the player
> can participate in it.**

**Eighteen behaviours. Five used.** The answer to scaling is not writing.

### The thirteen unused

| Behaviour | The situation it becomes |
|---|---|
| `seekWater` | Drought. It is dying of thirst and you know where water is — or you are carrying it |
| `seekFood` | It is starving. Or you are both stripping the same patch |
| `hunt` | Spoil the kill, drive prey toward it, or take the carcass after |
| `flee` | Something is chasing it. Block, distract, or stand aside |
| `scavenge` | You both want the same corpse |
| `train` | It is practising a move — the observation-learning hook in `CRAFTING_LOOP.md` |
| `explore` | It is mapping. Follow it |
| `buildShelter` | Contribute timber. Or watch it build somewhere that floods |
| `seekMate` | It cannot find one, and you know the other herd is two zones east |
| `socialize` | It is isolated — upstream of the `isolation` dispersal reason |
| `relocate` | The herd is moving and you can travel with it |
| `idle` | Nothing. Correct |

None of these need a written scenario. They need a **verb**.

---

## The worked example

Everything below is checked against the real roster and real move data, not
invented. `species.ts` currently holds **50 species, all Gen 1** (an earlier
note in this repo said 70 — that was wrong).

### First: the same tick as the game plays today

> *An Oddish is here.*
>
> `> examine oddish`
>
> *A small blue plant-creature. It is walking west.*

That is the entire interaction surface. It is running `relocate` because its
herd is migrating on `scarcity` because a drought cell killed the flora tiles
it lives on — **four real systems firing right now** — and all the game will
tell you is that a plant is walking. Your options are attack it or don't.

### The setup, entirely from existing data

```ts
oddish:    activityPattern: "nocturnal",  preferredTerrain: ["flora"],
           moves: ["tackle", "growth", "grassy_terrain"]
growlithe: activityPattern: "diurnal",    biomes: ["badlands"],
           moves: ["ember", "agility"],   isPredator: true
```

Three things fall out of that with no design work at all:

1. **A deadline nobody wrote.** Oddish move at night; Growlithe hunt by day.
   A migrating Oddish herd is therefore a series of night marches against a
   dawn deadline — and `nightfall`/`daybreak` are already real `SimEvent`s.
   Two flavour-text fields, set months apart for unrelated reasons, produce
   a timer.
2. **The drought destroys *their* habitat specifically.** `preferredTerrain:
   ["flora"]` and drought kills flora tiles. Not generic scarcity: the ground
   they stand on is what died.
3. **They carry their habitat with them.** `grassy_terrain` is
   `fertilityBoost: { amount: 0.15, radius: 2 }`, wired to `flora.ts`'s real
   fertility economy. **An Oddish herd fertilises wherever it rests.**

### The scene, with doors

**Week 3 of a drought cell. Night.**

> *Fourteen Oddish moving in a line, west. They are not feeding.*
>
> *Three at the back keep stopping.*

A line with a leader and no foraging is `relocate`, and it reads as purposeful
without a word of UI. That is **the tell**. You know they are going somewhere.
You do not know where.

> `> examine leader`
>
> *Its leaves are curled tight. It has not eaten today.*

Now you know why. And you know something they do not: four days ago you
crossed a shaded draw to the north where the flora held on.

> `> light torch`

You can keep pace now — and the column is visible from the ridge. The ridge is
badlands. Badlands is where Growlithe live, and Growlithe are asleep.

**Every door here has a real cost:**

| | Costs |
|---|---|
| `lead them north` | Days off your own route; they may not follow |
| `light torch` | You can see. So can anything awake |
| `carry one` | 8 units of your capacity, arms full, in the open |
| `douse torch` | Blind and slow, but unseen |
| *pass by* | Nothing. This is a real option |

**Dawn is the clock.** The stragglers will not make cover.

And when the Growlithe wake, one of them knows `ember`, and the brush has been
dry for three weeks. Worth noting: a validation run measured **zero fire
events in 24,000 agent-ticks** — `fire.ts` has never once ignited in a real
run. This is the first situation that would light it.

### The payoff, later

- **The disperser.** One of the ones you dragged out of the corridor crosses
  `MATURITY_AGE` and rolls dispersal. It has the strongest edge to you of
  anything alive. It does not wander toward a random distant tile — it comes
  and finds you. That is `CAMPAIGN_DESIGN.md`'s bonding moment, reached by a
  route nobody scripted.
- **The grudge.** The Growlithe carry `score: -0.6, reason: "drove us off a
  kill"`. Two zones east, weeks later, they hunt **you** — not the nearest
  prey. A predator with a reason.
- **The grove.** Where you stopped them is where they rested, and where they
  rested got `fertilityBoost`. Come back a season later and there are plants
  there because of a decision you made at 4am in a drought. Pillar 4, with
  zero new code.

---

## What is real versus what this needs

| Already running | New work |
|---|---|
| Drought cells drying water, killing flora | **Tells** — reading a behaviour from outside. The big one |
| `herdMigrating` with reason `scarcity` | **Player verbs**: lead, give water, carry, drive off |
| `relocate`, `hunt`, `carryAlly`, `flee`, all 18 | **Reasons on `RapportEdge`** (see below) |
| `nightfall` / `daybreak`, `activityPattern` | **Grudge-driven targeting** — `hunt` picking by rapport |
| Fainting and being dragged by an ally | Fire/smoke actually repelling a predator |
| `fertilityBoost` on `growth` / `grassy_terrain` | |
| Rapport edges and decay, chronicle, herd stories | |

**Six things.** And note what is *not* in the right-hand column: the drought,
the migration, the nocturnal/diurnal collision, the pack, the stragglers, the
fertility. **The entire plot was already happening.** All we build are
windows.

### The missing multiplier: relationships have no memory of *why*

```ts
export interface RapportEdge {
  score: number;                 // -1 grudge .. 1 bond
  lastInteractionTick: number;
}
```

A number and a timestamp. That is the whole thing.

Dwarf Fortress stories are made almost entirely of **reasons** — *he
remembered his brother's death*. Ours can report outcomes and never causes.
Add a short reason log to the edge — *led us to water / drove us off a kill /
carried me when I was down* — and two things happen at once: the same eighteen
families narrate differently every run, and **behaviour can key off history
instead of a scalar.**

This is a data change, not a system, and it is probably the highest
value-per-line item in this document.

### The honest cost: legibility

You cannot participate in a behaviour you cannot identify from outside. Today
`deliverFood`, `relocate` and `explore` all look like *an animal walking*.
Every door in this doc requires a **tell** — what it is carrying, where it is
looking, whether it is feeding, how its posture reads.

That is the real build, and it is the same work `NARRATIVE_PILLARS.md`'s
legibility rule already demands (*"build the tell before you build the
mechanic"*) and the same work the bonding arc needs regardless.

---

## Why this scales when content does not

Roll the same world again with the same six doors:

- **No drought** → the herd is not migrating, it is running `deliverFood`.
  You meet one hauling food home and the scene is about escorting it, or
  robbing it. Different afternoon, zero new code.
- **You pass by** → they still go, some still die, and you meet them at the
  draw a week later as strangers. The world moved without you, which is the
  point.
- **You let the straggler go** → no smoke, no grudge, nothing hunting you in
  the east. A quieter, poorer run — and it was a real choice.

The content is not the scene. It is that **eighteen behaviours × 50 species ×
weather × time of day × who you are to them** is a space nobody has to write,
and today the player is sealed out of every square of it.

---

## Recommended first slice

Pick the three behaviours with the strongest tells and the cheapest doors,
build one player verb each, and run it to see whether situations nobody
planned actually show up:

1. **`carryAlly`** — visibly dragging something. Door: carry it instead.
2. **`hunt`** — visibly stalking. Door: interfere.
3. **`seekWater` under a drought cell** — visibly dying. Door: lead, or give.

Plus **reasons on `RapportEdge`**, because without it none of the three leaves
a trace worth reading.

That is the falsifiable version of this entire argument: if three verbs do not
produce situations we did not plan, the thesis is wrong and we should find out
cheaply.

## Open questions

1. **Do wild agents form rapport edges toward the player at all today?** The
   player is specified as an ordinary agent, so structurally it should work —
   untested, and nothing has ever exercised it.
2. **How many tells is enough?** Eighteen behaviours do not need eighteen
   distinct tells; several could collapse into "carrying something,"
   "stalking," "feeding," "travelling."
3. **Does `hunt` target selection have anywhere to hang a grudge?** It picks
   by relative power (`isPreyOf`) today, with no rapport term.
4. **What does the reason log cost in save size** if every agent keeps a few
   strings per edge, at real population counts?
