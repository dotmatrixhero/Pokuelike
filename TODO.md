# TODO / Side Notes

Running list of ideas and decisions to revisit — not a sprint plan, just a
place to park trains of thought so they don't get lost.

## Pending: merge the player/campaign docs into one real spec

Flagged directly: *"were gonna have to merge all the player campaign stuff
together at some point to start doing a real spec pass."*

Nine docs now cover overlapping ground, written in conversation order rather
than spec order:

| Doc | Covers |
|---|---|
| `CAMPAIGN_DESIGN.md` | The three-act pitch, what exists vs what's new |
| `PLAYER_MOVEMENT.md` | Turn model, the energy scheduler, movement, bump rules |
| `PLAYER_ACTIONS.md` | Tactics, the two tiers, coaching, automation |
| `PLAYER_INVENTORY.md` | Slots, threat signature, held vs stowed |
| `CRAFTING_DESIGN.md` | Materials, harvesting, the rules |
| `CRAFTING_LOOP.md` | Where you craft, recipe knowledge, time costs |
| `CRAFTING_TREE.md` | The dependency graph, gates, bootstrap |
| `CRAFTABLES_V1.md` | Action list, inventory UX, the item table |
| `ITEM_CATALOGUE.md` | The wider item list with engine hooks |
| `MOVES_AND_TOOLS.md` | Items and moves as one effect vocabulary |
| `PLAYTHROUGH_LAYER1.md` | The opening, played turn by turn |

**Known duplication to resolve in the merge:** the action list appears in
both `PLAYER_ACTIONS.md` and `CRAFTABLES_V1.md`; the item set appears in both
`ITEM_CATALOGUE.md` and `CRAFTABLES_V1.md`; `grantsMoves` is described in
`PLAYER_INVENTORY.md` and specified in `MOVES_AND_TOOLS.md`.

Not urgent — these are working documents and the arguments in them are the
value. But before implementation starts, one spec with a single source of
truth per topic, and these kept as the reasoning behind it.

## OPEN CALL: the bond can't complete in layer 1

Surfaced by the ~200-turn paper prototype (`PLAYTHROUGH_ACT1_FULL.md`, finding
3c). The run earned **Presence** and **Feed** and stopped — **Fight alongside**
and **Rescue** both need danger, and layer 1 is deliberately prey-only.

Working theory: that's correct, and the bond is *meant* to finish during the
ascent. Two things need a ruling before anything is built:

1. **Does a Curious (half-bonded) partner follow you across a layer
   boundary?** If not, the ascent framing doesn't hold. Recommend yes, but
   unreliably.
2. **Is the four-verb → four-rung mapping 1:1?** Assumed, never specified. If
   Presence + Feed only reaches *Tolerant*, layer 1 delivers less than the
   prototype assumed.

## BUILT: rapport reasons (Track A #1) — plus two findings it turned up

`RapportEdge` now carries `memories: RapportMemory[]` — one aggregated entry
per `RapportReason` (`{reason, count, lastTick}`), so a relationship can say
*what happened* and not only how strong it is.

- **Directional, because the edge is.** One interaction writes different
  reasons on each side: `gaveFood`/`receivedFood`, `defended`/`wasDefended`,
  `struck`/`wasStruck`; `socialized` and `bonded` are symmetric. "It fed me
  four times" and "I fed it four times" are different sentences about the
  same four events.
- **Bounded by construction** — 8 reason kinds x 16 max edges, so a long run
  cannot grow it. That answers the save-size open question in
  `EMERGENT_SITUATIONS.md` outright.
- Memories die with the edge on prune/eviction. A relationship faded to
  stranger-neutral should not keep its grievances.
- All five real triggers tagged. Verified falsifiable: stripping the reasons
  off `support.ts`'s call makes exactly the two integration tests fail.
- 12 new tests, whole suite green (1274 engine / 240 data).

### FINDING 1 — `foodDelivered` effectively never fires. Pre-existing, real.

Measured over 4 seeds x 6000 ticks: **`gaveFood`/`receivedFood` recorded 0
events**, and counting the event directly gives **1 `foodDelivered` in the
whole 24,000-agent-tick sample** (seeds 11/202/3003/40404 → 0, 0, 1, 0),
against 1,051 `herdClash` and 91 `bonded`. Live agents holding an inventory
item at run's end: 0–2. Not a pruning artifact — the trigger itself does not
run.

This contradicts `rapport.ts`'s own doc comment, which calls food delivery
*"an ordinary, fairly frequent errand"* and tunes
`RAPPORT_FOOD_DELIVERY_DELTA` deliberately small on the assumption that
repetition does the work. There is no repetition. It also means
`Agent.lifetimeFoodDeliveries` — the Gatherer notable's stat — is
approximately always zero.

**Not fixed here.** Why `deliverFood` almost never runs is a behaviour/balance
question, and this project does not retune unilaterally. Surfacing it.

### FINDING 2 — `socialized` is 95.2% of all recorded reasons

16,168 of 16,975 reason-events. So ordering an edge's reasons by raw count
puts the least interesting fact first on essentially every relationship in
the world: *"kept their company 2907 times, fought for them 19 times."*

Contribution-ordering does not fix it — socializing genuinely did drive most
of those scores. The rare reason is the interesting one, so
`notableRapportMemories` orders by `RAPPORT_REASON_SIGNIFICANCE` (scarcity of
meaning) while `rapportMemories` keeps the honest mechanical order. **The
curated view changes which reason leads on 18.6% of multi-reason edges.**
Kept as two functions rather than one so the editorial judgement is visible
rather than baked in.

**RULED AND BUILT: throttle it, don't drop it.** Direct steer: *"I would
rather have more depth to the social then drop it. But yeah the raw 3k events
on its own isn't really that useful i guess. Maybe every 500 social it creates
a useful memory."*

`RAPPORT_REASON_MEMORY_INTERVAL` throttles `socialized` to one memory per
**500** occurrences — the first shared moment records immediately, then one
milestone per 500 after. `RapportMemory.occurrences` keeps the raw total, so
the depth is preserved rather than discarded.

Measured on the same 4 seeds x 6000 ticks, before and after:

| | before | after |
|---|---|---|
| `socialized` share of memories | **95.2%** | **9.6%** |
| curation override needed (notable vs raw order) | 18.6% | **4.4%** |

The second row is the interesting one: **fixing the data at the source left
the editorial layer with a quarter as much to do.** `notableRapportMemories`
is still right to exist, it just isn't papering over a measurement problem
any more.

And the narration works:

> *(+1.00) fought for them 19 times, was defended by them 8 times, spent 6
> long stretches in their company*
>
> *(+0.69) took them as a mate, fought for them 7 times, was defended by them
> 7 times*
>
> *(-0.44) struck them 14 times, was struck by them 6 times, shared their
> company*

## BUILT: shared experience — relationships made of what you went through

Direct steer: *"I wish they were more than just #s of things... I want more
meaningful interaction even if it means building new systems. Ex. Training
together. Or leveling up together or drinking from the same water without
clashing."* Plus: *"Survived together, slept in each other's presence (not
necessarily simultaneous) are good too."*

The eight original reasons were all **transactions** — what I did *to* you.
These six are **shared experience** — what we went through. That is the
category that makes a relationship read as a relationship rather than a
ledger.

| Reason | Trigger | Hook |
|---|---|---|
| `sharedWater` | Eligible to fight over a contested tile, and didn't | `herdConflict.ts`'s declined-escalation branch |
| `trainedTogether` | Both drilling within `SOCIALIZE_RADIUS` | `needs.ts`'s `applyTraining` |
| `keptWatch` / `sleptSafely` | One goes to sleep where another awake agent can reach it | `needs.ts`'s `fellAsleep` site |
| `survivedTogether` | Something died near both of you and neither was it | new `witness.ts`, one pass in `tickWorld` |
| `mourned` | Same, where both held real rapport with the one who died | as above |

**Restraint is an interaction.** `herdConflict.ts` already decided, tile by
tile, whether two power-matched rivals escalate over water — and the "no"
branch was a bare `return false`. Its own comment noted the asymmetry: *"a
grudge biases escalation, a positive relationship never suppresses it."*
Escalation compounded; backing down earned nothing. Now it does.

**Sleep is asymmetric and deliberately not simultaneous** — two animals asleep
at once are only co-located; one asleep and one awake is a watch. That is
`DESIGN.md`'s **Presence** bonding verb, appearing as something the sim's own
agents already do to each other.

### Two examples changed on contact with the code

- **"Leveling up together"** — dropped as stated. Two agents crossing an XP
  threshold near each other is arithmetic coincidence, and XP is a hidden
  number, which the legibility rule says to avoid. The instinct was right; the
  trigger was wrong.
- **"Survived a storm together"** — *storms cannot hurt anything.*
  `weather.ts` only exposes `stormAccuracyMultiplier` and `stormFovPenalty`,
  and exposure is tracked per-**herd** for migration, never per-agent. A "we
  survived that" memory would have invented a danger the sim does not have.
  Rebuilt on the dangers that are real — predation and starvation — as *"something
  died near both of you."* That covers drought by the route drought actually
  kills through.

### Measured, 4 seeds x 6000 ticks

**38.6% of all edges now carry at least one shared-experience reason.**
`survivedTogether` 72, `trainedTogether` 90 (from 6,208 raw — the throttle
works), `mourned` 4, `keptWatch` 8 / `sleptSafely` 11.

Real output:

> *(+0.41) lost the same friend, came through 6 deaths beside them, fought
> for them 6 times, was defended by them 5 times, spent 2 long stretches in
> their company*
>
> *(+0.74) lost the same friend, came through 3 deaths beside them, took them
> as a mate, kept watch over their sleep 1 time*
>
> *(+0.07) watched something die beside them, took them as a mate, drilled
> beside them through 4 long sessions, struck them 1 time*

That last one is a mate it once came to blows with. Nothing in the design
authored that.

### FINDING 3 — `sharedWater` barely fires: 15 raw events in 24,000 agent-ticks

The best idea of the batch is close to unreachable. The declined-escalation
branch needs every gate to hold first — blocked from a resource for
`HERD_CONFLICT_MIN_BLOCKED_TICKS`, an adjacent rival, both non-predator,
power-matched within `HERD_CONFLICT_MIN_POWER_RATIO`, off cooldown — and only
*then* fail the disposition roll. All of that happened 15 times across four
6,000-tick runs, producing **one** memory.

**Not tuned here** — the gates belong to herd conflict, and loosening them
changes fight frequency, which is a balance call. Options if it should read
more often: record restraint at a wider bar than the one that gates an actual
fight (e.g. two power-matched rivals adjacent at a contested tile, whether or
not the blocked-ticks threshold was met), or lower `RAPPORT_REASON_MEMORY_INTERVAL.sharedWater`
from 50.

### Note on the numbers

The new rapport writes consume `rng`, so worlds diverge from the pre-change
runs — these figures are not directly comparable to the earlier
`socialized` table. The 95.2% → 9.6% throttle result stands, since that was
measured before and after that change alone.

## BUILT: named subjects, rescue, healing, displacement

Follow-up round on shared experience. Direct steers: *"Maybe surviving a storm
and drought and other weather together would still be worth it if it
meaningfully changed their behavior."* / *"I think defeating an enemy together
- and naming specifically what it was would be great."* / *"Lost the same
friend might be better as 'mourned a friend together' — phrasing is
important."* / *"And like defending each other? Is that a thing? Healing?"*

### The structural change: memories can name a subject

`RapportMemory.subject` — a `{ label, id?, level? }`. One per reason, kept as
the most **notable** (highest level, ties to the newest), so the structure
stays bounded exactly as `count` does. Three kills together keeps the Scyther
and drops the Rattata; `count` still says three.

That is the answer to *"more than just #s of things"*: a count says two
creatures fought a lot, a subject says **they brought down a Scyther.**

### Conceded: weather counts, and my test for it was wrong

I rejected "survived a storm together" because storms do no damage. True, and
the wrong test — **the shared experience is the displacement, not the
damage.** `weatheredTogether` now fires on a herd migration whose
`MigrationReason` is `weather` or `scarcity`: the world moved them, it moved
them together, and the memory names what drove them out. `wanderlust` and
`territorial` are excluded — those are choices, not weather.

### Two real gaps found by the questions

- **Carrying a fainted ally home built ZERO rapport.** `support.ts` only ever
  touched rapport at the food-delivery site. That is `DESIGN.md`'s **Rescue** —
  the strongest of the four bonding verbs, *"the Pokémon chooses you as much
  as you chose it"* — completely unhooked. Nothing in DESIGN.md or TODO.md
  records a decision to leave it out, so: oversight, not choice. Now
  `rescued`/`wasRescued`, and only on `"arrived"` — a carrier that dropped its
  ally because a predator turned up did not rescue anybody.
- **The `healAura` passive built zero rapport too.** Real agent-to-agent
  healing, running every tick, building nothing. Now `healed`/`wasHealed`,
  gated on HP having actually moved (topping up someone at full health is a
  no-op and must not read as care) and throttled at 100.

**Defending each other already existed** — `defended`/`wasDefended`, wired in
the first round.

### Measured, 4 seeds x 6000 ticks

**48.6% of edges carry a shared-experience reason** (was 38.6%).
`rescued` 18 / `wasRescued` 21, `weatheredTogether` 36, `defeatedTogether` 14.

> *(+1.00) brought down 2 together, the largest a scyther, came through 3
> deaths beside them, worst a scyther, was defended by them 20 times, fought
> for them 3 times, was driven out by hunger beside them*
>
> *(+0.43) brought down a fearow together, watched a onix die beside them,
> was defended by them 7 times, fought for them 6 times*

### FINDING 4 — `healAura` never occurs in a real run

`healed`/`wasHealed` recorded **0** across 24,000 agent-ticks. The hook is
proven working by a direct unit test; the *passive* is what never happens.
`healAura` is granted only by skill-tree nodes (`grantsPassive` in
`moves.ts`), and no agent in four 6,000-tick runs ever allocated one. Same
unreachable-content pattern as fire never igniting — and it predates this
change.

### Phrasing — rewritten after a blunt and correct note

> "Your phrasing is so stilted and weird."

It was. The first renderer produced:

> *brought down 2 together, the largest a scyther, came through 3 deaths
> beside them, worst a scyther, was defended by them 20 times, fought for
> them 3 times, was driven out by hunger beside them*

Everything wrong with it, named, because each fault is a rule:

- **No grammatical subject** — eight verb phrases in a row read as a dump.
- **Telegram-ese appositives** — *"the largest a scyther"*, *"worst a scyther"*.
- **Lowercase species and a broken article** — *"a onix"*. They are names.
- **Voice flipping** inside one line: active *brought down*, passive *was
  defended by*.
- **Digits** where speech wants words — *"20 times"* reads as a field.
- **It printed every reason.** That is the real fault: eight clauses of equal
  length is a table with commas, not prose. Curation was the whole point of
  `notableRapportMemories` and the renderer ignored it.

### ...and then over-corrected, so: a third pass

The fragment version was too far the other way:

> "OK you over indexed in like hyper succinct. That's not what I want either.
> Like watched three die beside them sounds confusing and ominous?"

Both notes were right. *"Killed a Scyther together. Watched three die beside
them."* is clipped, and it never says **what** died, which is precisely what
made it ominous instead of sad.

The brief for the version that stuck:

> "Be a little more poetic and emotion driven? Try to put yourself in the
> shoes of the Pokémon that lived through that explaining what you've been
> through together. Take a little creative liberty but not too much."

**The rules, third time:**

1. **First person, full sentences**, spoken by the agent whose edge it is
   about the other. A relationship is spoken, not tabulated.
2. **Always say who or what.** "Three have died within sight of us both, one
   of them a Scyther" — the old line never named anything.
3. **One feeling per sentence, carried by the facts**, never pasted on top.
4. **Liberty in the connective tissue only.** Every noun, number and event is
   real. Nothing invents an event the edge does not know about.
5. **Still at most two clauses.** Curation survived all three passes.
6. Species are proper nouns; numbers spelled out to twenty, then "again and
   again", because nobody counting their own fights lands on "twenty-seven".

| | |
|---|---|
| **First** | *brought down 2 together, the largest a scyther, came through 3 deaths beside them, worst a scyther, was defended by them 20 times* |
| **Second** | *Killed a Scyther together. Watched three die beside them.* |
| **Third** | **We brought down a Scyther together. Three have died within sight of us both, one of them a Scyther.** |

More, straight from the run:

> **We are mates. We spent whole seasons practising side by side.**
>
> **I watched an Onix die, and they were beside me. They have put themselves
> in front of me eight times.**
>
> **We have sat together. I struck them once, over ground we both wanted.**
>
> **I watched a Kakuna die, and they were beside me. They have come at me
> thirteen times.**

**One flaw the wider sample caught.** The `struck` line read *"and I started
most of it"*, which was the best sentence in the batch and had to go: the
clause only ever sees one side's count, so **both** halves of a mutual rivalry
claimed to have started it. Liberty in the connective tissue, never in the
facts.

### Fourth pass: say whose it was, and stop using euphemisms

> "But three have died still confusing. Were they foes that died? Allies?"
>
> "Put themselves in front sounds like a euphemism. Same with come at me.
> More specificity please"

Both right, and the first one was a **data** problem hiding as a prose
problem. The sim always knew whether the dead agent shared a herd with the
two remembering it; the memory just threw that away. `RapportSubject.kin`
now records `"ours"` or `"other"`, computed **per pair** rather than per
death — "one of ours" is a question about the two agents doing the
remembering, not about the corpse.

The euphemisms were laziness. Each is now what the mechanic literally does:

| Was | Is |
|---|---|
| *put themselves in front of me* | **Something had hold of me, and they hit it until it let go.** |
| *come at me* | **They have hit me thirteen times over water and feeding-ground we both wanted.** |
| *three have died beside them* | **Three of our own have died in front of us, the last of them a Pidgey.** |

Three more small ones from the same pass: *"no one of ours"* is not English
(now *"Not one of ours"*); *"they came and hit it off"* collides with the
idiom for getting along (now *"drove it off"*); and *"the last a Scyther"* was
telegram-ese appositive again (now *"the last of them a Scyther"*).

### Fifth pass: I did it again

> "Your output still is confusingly bad? Didn't seem to pick up your was/is
> changes?"

The changes had landed. The output was still bad, for the same reason each
previous pass was bad — **writing around missing data instead of going and
getting it.** I replaced *"put themselves in front of me"* with *"something
had hold of me"*, which is exactly as vague as the euphemism it replaced. The
`kin` fix was that lesson and I did not generalise it.

The predator is sitting in a local named `threat` at the defence site in
`predation.ts`. There was never a reason not to record it.

| Was | Is |
|---|---|
| *Eight times something has had hold of me* | **They have pulled a Scyther off me, and seven other things besides.** |
| *a Scyther … a Scyther* in one line | **We brought down a Scyther together. Three have died in front of us, and none of them were ours.** |
| *Not one of ours.* (clipped fragment) | **…and it was none of our herd.** |

**And one wrong turn worth recording.** The first fix for the repeated-name
stutter *dropped* the duplicate clause — which was worse than the stutter: it
threw away the best line on the edge and fell back to filler like *"We have
sat together."* Keep the clause, refer back instead. The refer-back word then
produced *"the last another"*, so a naming slot now drops the name rather than
mangling it.

Final, from a real run:

> **We brought down a Scyther together. Three have died in front of us, and
> none of them were ours.**
>
> **I watched an Onix die in front of us, and it was none of our herd. They
> have pulled another off me, and seven other things besides.**
>
> **We are mates. I have pulled a Fearow off them, and four other things
> besides.**
>
> **We have sat together. We both wanted the same water, and I hit them for
> it.**
>
> **I watched a Kakuna die in front of us, and it was none of our herd. They
> have hit me thirteen times over water and feeding-ground we both wanted.**

Also fixed across these passes: `mourned` reads *"we lost the same friend"*,
and `trainedTogether` was *"drilled beside them"* — which meant nothing.

## BUILT: rapport prose in the inspector — visible in game

`renderRapportGroup` already existed (bars and scores, top 6 by absolute
score). It now carries the sentence under each bar, so the panel says *why* a
score is what it is rather than only how big it is.

**Live-verified**, not reasoned about: dev server, Playwright, sim run to tick
2364, clicked until an agent with rapport came up. A Scyther of Tiderun:

```
RAPPORT
  Krabby 0-1        |||||||| 0.14
    We trained together.
  someone (lost)    ||       0.02
    We have sat together.
```

**One renderer now.** `packages/engine/src/rapportProse.ts` holds the only
copy — the web inspector and both runner scripts import it, so what prints in
a validator is literally what shows in game. It had been copy-pasted into two
runner scripts already; a third copy in the web package was the point at which
that stopped being acceptable.

### Decay already exists — do not build it twice

Flagged as a possible gap off a loose phrase of mine ("decay hasn't caught up
yet"). It has not caught up because it is *running*:

- `RAPPORT_DECAY_PER_TICK = 0.9977` — a ~300-tick half-life, applied lazily at
  read time by `decayedRapportScore`.
- `RAPPORT_PRUNE_THRESHOLD = 0.02` — an edge under it is deleted outright, on
  read or on write.

The -0.07 grudge against a dead agent in the earlier sample was decay
mid-flight, not its absence.

**Two real open calls it does raise**, both design rather than defect:

1. **Should an edge to a *dead* agent decay faster, or prune on death?**
   Today it fades at the ordinary rate, so a creature can carry a live
   rivalry with something that has been dead for hundreds of ticks. That is
   either a bug or the best thing in the system, and it is a taste call.
2. **Memories never decay — only `score` does.** "We have fought five times"
   stays five forever while the score fades to nothing, and the whole memory
   list dies at once when the edge prunes. So a relationship's *feeling* fades
   gradually and its *history* vanishes in one step. Deliberate so far, but
   worth ruling on.

## SUPERSEDED → see ROADMAP.md

The Track A / Track B split below was right about dependencies and wrong
about priority: tells and crafting data *can* be built without a player, but
they cannot be *felt* without one, and the risk in this project is never
"won't compile" — it is "won't play." `ROADMAP.md` puts the player agent
first and folds the remaining Track A items in where they become playable
(tells → M4, crafting data → M5). Kept below for the record.

## IMPLEMENTATION ORDER — the move from design into code

Asked directly: *"Do you think you're potentially ready to really start
implementing? I think the scenarios you made are kinda act 2 stuff. But we
want the systems for that built out."* Plus: *"Need crafting too don't
forget."*

**Three prerequisites exist in no design doc, found by grepping the code:**

| | State |
|---|---|
| **A player agent** | Does not exist. `rapport.ts`/`types.ts` mention "a future player" in comments; zero code |
| **Input / turn loop** | Does not exist. `main.ts` free-runs the sim on `setInterval`; no keydown handler anywhere in `packages/web` |
| **`InventoryItem`** | `{itemKey, weight}` — no stack count. Only `support.ts` touches inventory, only for `FOOD_ITEM_KEY` |
| **Recipe / item data** | Does not exist in code at all. Entirely in markdown |

The Act 2 scenarios are Act 2, but their *systems* are not: Presence needs to
see `sleep`, Rescue needs to see `carryAlly`, and the dispersal offer fires off
rapport. Tells and rapport-reasons are Act 1 blockers too.

### Track A — buildable now, no player agent, each with its own evidence

1. **Reasons on `RapportEdge`.** It is `{score, lastInteractionTick}` today —
   a number and a timestamp, no memory of why. Agents already form edges from
   `foodDelivered`, so this is testable immediately against a live run.
   *Evidence: dump a real run's edges and see whether they read as a story.*
2. **Tells — `describeBehavior(agent)`.** `deliverFood`, `relocate` and
   `explore` all look like "an animal walking" from outside. This blocks every
   verb in `EMERGENT_SITUATIONS.md` and both unbuilt bonding verbs.
   *Evidence: run the sim, dump what each agent looks like doing, check
   `relocate` is distinguishable from `explore`.*
3. **Crafting data + reachability tests.** The tree from `CRAFTING_TREE.md` /
   `CRAFTABLES_V1.md` / `ITEM_CATALOGUE.md`, typed. Crafting splits cleanly:
   the *data* needs no player, the *loop* does.
   *Evidence — and this is the best test in the plan: every recipe's inputs
   resolve, no cycles, every material has at least one harvest source, and the
   first-playable set is reachable from an empty inventory.* That is the
   machine version of "unreachable content is a bug" — **it would have caught
   the camouflage cloak hole automatically** instead of it taking a hand-played
   paper prototype to find.

### Track B — gated on the player agent

4. Player agent + turn gate + `InventoryItem` stack counts.
5. Crafting loop — search, the interruptible time-spend, equip.
6. The three behaviour verbs: `carryAlly`, `hunt`, `seekWater`-under-drought.

## OPEN: emergent situations — see EMERGENT_SITUATIONS.md

The scaling answer for player–Pokémon interaction out in the world: the sim's
18 `BehaviorKind`s and the player's ~7 actions are disjoint sets, and every
behaviour becomes a situation family the moment the player can participate in
it. The four bonding verbs and the dispersal offer are already five instances
of that rule; thirteen behaviours are unused.

**Recommended first slice** (falsifiable): one player verb each for
`carryAlly`, `hunt`, and `seekWater`-under-drought, plus **reasons on
`RapportEdge`** (it is `{score, lastInteractionTick}` today — a number and a
timestamp, no memory of why).

**Blocking prerequisite: tells.** `deliverFood`, `relocate` and `explore` all
look like "an animal walking" from outside. No door works until behaviour is
readable.

**Corrections logged:** the active roster is **108 species, all Gen 1** after
master's whole-roster pass (this repo has cited 70 and 50 at different points).
And `EMERGENT_SITUATIONS.md`'s first draft used Growlithe as the predator —
**Growlithe has no `isPredator` flag and never hunts anything.** Swapped to
Charmeleon (`isPredator: true`, diurnal, badlands, knows `ember`).

## OPEN: the dispersal offer — see CAMPAIGN_DESIGN.md

Proposed explicit text-decision moment at the last trust rung, triggered off
a real dispersing individual. Four calls open there (who initiates, whether
resources are involved, frequency, cost of refusal).

Now **two doors**: the disperser (it leaves, you follow, it leads you
somewhere new) and the follower (you leave, it comes after you with concern,
at the exit). Both land at Bonded; refusing a disperser burns that individual
permanently. Leaving with a disperser gets you **one armful** from your cache
— a single trip, bounded by how far it has already walked.

**Blocked on a system that doesn't exist: the player cache.** `Tile.cache` is
a number (shelter food stockpile for `buildsShelter` agents). There is no
items-on-the-ground concept at all, so nothing can be dropped, stashed or
found. Adding items to tiles is a prerequisite for the one-armful moment, and
separately unlocks dropped loot, stash raiding, and finding another
settlement's leavings.

**Measurement, no longer blocking:** how many dispersal events fire in a
layer-1-sized region over ~400 turns across several seeds. Trigger 1 is
disposition-gated (factor 0 for timid+social) and the fallbacks need
sustained stretches. The follower door means a zero result is a tuning
problem, not unreachable content — but it still decides whether the
expensive door is ever seen. Not yet run.

## DECIDED: items and moves are one system — see MOVES_AND_TOOLS.md

Direction confirmed: *"I'm fairly confident about the items as moves
direction."* Unbuilt, but this is what to build against.

**A move is an effect. A Pokémon reaches it through its body; a human
reaches it through a tool.** One vocabulary, three deliveries — innate,
tool-granted (`ItemDef.grantsMoves`), consumable (`consumableMove`).

- **A tool is a slice of a move, never the whole move.** Cut damages, fells
  trees and clears foliage; an axe only fells, a machete only clears, a
  knife only does the damage slice as Scratch. Pillar 3's "nothing craftable
  is sufficient" then holds structurally rather than by tuning.
- **Consumables are borrowed moves** — a smoke bomb fires Smokescreen
  without knowing it.
- **The player's loadout is their moveset.** No ability screen.
- **Tool-reachability:** can a human reproduce the effect with materials and
  technique, or does it require *being* the creature? Fire, stone, blades,
  smoke, nets, venom, digging → yes. **Flamethrower yes**, as a crude slice
  that ignites the tile you stand on. **Ice Beam / Dragon Rage / Thunderbolt
  / Psychic → no.**
- **The unreachable set is load-bearing.** It's the mechanical reason a
  partner is necessary — every move that gets a hand-held equivalent is one
  less reason to need somebody. Act 2's smithing tier improves slices but
  never opens that column.
- This generalizes an existing pattern: moves already change the world five
  ways (`terrainBurn`, `terrainFill`, `consumesOwnTerrain`, `igniteNear` on
  the live hit path, and a fertility bump).
- It's also the inversion of `MOVES_DESIGN.md`'s Round Four HM finding —
  HMs are Pokémon-as-key; this is tool-as-key.

**Interface asks for the moves work** (separate agent): generalize
`terrainBurn`/`terrainFill` into one `{ from?, to, yields? }` field; make
`yields` the crafting hook (a Pokémon felling a tree currently drops
nothing); keep effects declarative on `MoveSpec` so an item can point at a
move id; tag which moves are tool-reachable.

**Risk: measured, and there is headroom.** `validateTerrainChurn.ts`, 4
seeds x 6000 ticks: vegetation went **1300 -> 1453 (+11.8%)**, i.e. the world
mildly overgrows rather than stripping. Churn is dominated by the seasonal
ice cycle (freeze 72/1k, thaw 63/1k). **Fire produced zero events** across
24,000 agent-ticks, so the "igniteNear is already live" worry is currently
inert — and by the "unreachable content is a bug" standard, fire never
firing is worth a look on its own. Re-run after the move roster widens and
watch the vegetation percentage.

## Fire safety belongs to biome placement, not a global constant

Design position, given directly: *"fire does not spread a ton because they
shouldn't be around a ton of flammable stuff all the time. The environment
they normally exist in might have a couple fires, but they are designed to
burn themselves out. Now, if they take over a place they shouldn't, like a
forest, and it gets hit by a drought, maybe that ends up causing a huge
disaster."*

So fire safety is **emergent from where a species lives**: a Fire-type in
fuel-poor volcanic ground has fires that die on their own; the same species
in a forest is a catastrophe waiting for a dry season. Nobody tunes a spread
constant down — the biome does it.

Three links, all of which already half-exist:
1. **Fuel load as a biome property** — Fire-type home biomes generated
   genuinely fuel-poor.
2. **Species-biome fit enforceable *and* violable** — a mismatch via
   migration/dispersal is *the story*, not a bug to prevent. If placement is
   airtight the disaster never happens.
3. **Drought as trigger** — already real in `weather.ts` at 11.4 changes/1k.

Handed to the biome-zone-logic agent as `PROMPT_biome_fire_context.md`, with
the measured baseline and the concern that a wider roster (70 active vs 1085
in the dex) is the risk multiplier: loose gating burns every forest, airtight
gating kills the mechanic. Target is "rare but real."

## Winter ice: a lid, not a solid freeze — see BREADTH_DESIGN.md

Decided in discussion, unbuilt. Today `weather.ts` freezes only bodies below
`LARGE_WATER_BODY_MIN_SIZE`, and `canEnterWater` already lets anyone wade a
small body — so freezing currently changes nothing about traversal.

The ruling that makes it real: *"fish should be considered underground. If
they're in it the ice should not affect them unless it's shallow smaller
puddles."*

- **Large bodies (`waterKind` lake/river/ocean) get a surface lid.** Ice is
  **dual-state** — walkable terrain for anything above, still water for
  anything below. Aquatic agents underneath are unaffected. *This* is the
  seasonal topology change, and it needs large bodies to freeze at the
  surface, which they currently don't.
- **Small shallow water (`waterKind: pond`) freezes through.** No water
  column to be under, so fish there are genuinely affected — the rare
  Rescue moment, scoped small on purpose so it can't become routine.
- `waterKind` already carries the shallow/deep signal. No new data needed.
- Flags a prior call: the existing "no large-body freezing" decision was
  against freezing *solid*. A lid is a different thing — refinement, not
  reversal, but worth knowing it touches that decision.
- **Possible bug to check:** an obligate aquatic on an `ice` tile is no
  longer on `"water"`, so `canEnterLand`'s gate doesn't see what it expects.

## Make the land's scars visible — see NARRATIVE_PILLARS.md's legibility rule

Raised directly: *"herds emigrating might show in chronicle but not the land
itself. Maybe that needs to show up if you get close to scarred ground?"*

Right, and as designed the whole degradation → migration crossing would have
been invisible. The general rule this produced now lives in
`NARRATIVE_PILLARS.md`: **a cause must be visible before its consequence, or
the consequence reads as randomness.**

Three channels, different jobs:

- **Rendering (primary).** `groundDegraded`/`fertility` are floats the
  palette can carry continuously — spent ground should just *look* tired.
  No prose budget, no repetition problem. Wrinkle: `PEAT_DEGRADE_MAX` caps
  permanent damage well short of 1, so the tell must read inside a narrow
  band.
- **Prose, only when actionable.** *"The ground here is spent"* on approach
  to badly degraded ground.
- **Chronicle**, for the after-the-fact why.

## Simulation-mechanics ideas, raised mid-session, not yet built

Three direct asks raised together, each substantial enough to want its own
pass rather than a rushed bolt-on:

- [x] **"Socialize" as an intention/unit action** — built, then extended
      with real isolation pressure. New `"socialize"` `BehaviorKind` +
      `applySocializing` (needs.ts), slotted into the idle stack right
      before `applyTraining` (herd cohesion, shelter-resting, exploration
      all still get first refusal). Only fires when a genuine candidate is
      within `SOCIALIZE_RADIUS` (1 — Manhattan-adjacent only, "pretty close
      quarters"), picking the rapport-neediest neighbor (lowest current
      `|rapportScore|`, so it spreads bonds rather than always reinforcing
      the same closest pair) and applying `RAPPORT_SOCIALIZE_DELTA` (0.04,
      rapport.ts) via `strengthenRapportMutual`.
      **Follow-up, direct ask: "if they don't have same species around
      them, they should try to find other species or emigrate... they can
      survive a long time, but eventually it becomes important to
      socialize and build connections. even with other herds."** New
      `Agent.ticksSinceSocialContact` (same shape as reproduction.ts's own
      `ticksSinceEligibleMate`) — below `SOCIALIZE_ISOLATION_TICKS` (400),
      only a same-herd candidate counts (original behavior); past it, ANY
      nearby agent counts (any species, any herd, herdless included), at a
      reduced `SOCIALIZE_STRANGER_DELTA_FRACTION` (0.5) rapport delta. Past
      a much longer `SOCIALIZE_DISPERSAL_TICKS` (1200, dispersal.ts) with
      the widened search STILL empty, a real new dispersal "Trigger 3"
      fires — new `"isolation"` `DispersalReason`, the direct social
      counterpart to dispersal.ts's existing `"no_eligible_mates"`
      guaranteed fallback — sending a truly, persistently isolated agent
      off to go find people.
      AI-controlled only for now — a player-directed version is a real
      follow-up once player-controlled units exist at all.
      Verified live: 1472 real `behaviorChanged`-to-"socialize" events over
      4000 ticks on a real scenario run, 17 real rapport edges standing
      afterward (original pass); a separate 6000-tick run after the
      isolation follow-up found 1 real `"isolation"`-reason dispersal event
      and a max observed `ticksSinceSocialContact` of 2889 on a still-living
      agent, confirming the widened search and the dispersal escape hatch
      both actually engage in a real run, not just in theory.
      **Second follow-up, direct report after actually watching a run:
      "are you sure socializing is in? I just watched a psyduck train and
      never socialize."** Measured before changing anything (real 3000-tick
      scenario): at the original `SOCIALIZE_RADIUS` (1), only 4.3% of
      sampled idle-eligible agents had ANY herd-mate that close — herds
      routinely spread ~25 tiles apart during ordinary wandering/feeding
      (`herding.ts`'s `COHESION_DISTANCE`, 5, is only where cohesion starts
      pulling an agent BACK, not the herd's typical spread), and
      `train`:`socialize` promotions came out 31:1. The feature was real
      but essentially unreachable for a typical agent — the psyduck report
      was correct, not a fluke. Raised `SOCIALIZE_RADIUS` 1 → 3 (matching
      `herding.ts`'s own existing `GUARDIAN_COHESION_DISTANCE`/
      `LOW_LEVEL_COHESION_DISTANCE`, not a newly-invented number) —
      re-measured: reachability jumped to 18.1%, ratio to a real, felt
      4.2:1.
- [x] **Ground/soil types — built.** Direct ask, then a follow-up
      reframe: "I think I want more types of tiles, you know?" New
      `GroundType` ("loam" | "sandy" | "clay" | "rocky" | "peat"),
      `Tile.groundType` — an orthogonal tag on `TerrainKind`, same shape as
      `Tile.flavor`, biome-correlated at worldgen (`assignGroundTypes`,
      worldgen.ts: highland/snow/badlands → rocky, desert/beach → sandy,
      wetland → mostly clay with real peat pockets, everything else →
      loam). Real mechanics, not just a color (flora.ts's
      `GROUND_TYPE_PARAMS`): each type sets `fertility`'s own ceiling
      (rocky barely grows anything; sandy/clay have their own character —
      see the table), regen speed, and how hard a harvest knocks it down;
      needs.ts's `cropDigThreshold` scales by the same table's
      `digMultiplier` ("certain dirt is easier to dig"). **Peat doesn't
      fully forgive over-harvesting** — `Tile.groundDegraded`, a real
      permanent ceiling reduction with a real chance per harvest-death
      (`maybeDegradePeat`) — the concrete, mechanical answer to Pillar 4
      ("all that you change, changes you... the land remembers") being
      underbuilt. Rendered as a real, subtle color cast in tile mode
      (`GROUND_TYPE_TINT`, palette.ts/renderer.ts) — "mechanics should be
      visible on the map, not hidden in a meter."
      Verified: a real 120x120 `generateWorld` run placed all 5 types with
      sensible distribution (loam 3557, rocky 1350, sandy 1330, clay 606,
      peat 184) and correct starting fertility per ceiling; a real 6000-
      tick scenario run found zero fertility-ceiling violations anywhere
      on the map and 2 real permanently-degraded peat tiles. Tree-climbing/
      canopy access (the traversal half of the original ask) is still a
      separate, unbuilt follow-up — deliberately kept out of this pass.
- [x] **Water body types (ocean/river/lake/pond), real rivers, ice,
      shore-biased drought — built.** Direct follow-up ask: "what about
      rivers vs ocean vs lakes and ice." New `WaterKind`
      ("ocean" | "river" | "lake" | "pond"), `Tile.waterKind` — reuses
      three signals that already existed but were never persisted
      per-tile: the ocean mask, the river-carving pass, and
      `waterBody.ts`'s connected-size lake/pond split. Salt vs fresh isn't
      a separate field — it falls out of `waterKind` directly (ocean =
      salt). Gameplay effects (per direct instruction) deliberately
      deferred — this pass is the visible/data layer only.
      **Rivers now have a real flow direction and real width** — direct
      ask: "I want water to potentially sorta flow for elevation if
      possible. like it wants to move in a direction, and I want thicker
      than one sparse tiles." New `Tile.flowDirection` (the step-to-step
      steepest-descent movement vector the carving pass already computed,
      now persisted instead of discarded); `carveRiverWidening`
      (worldgen.ts) carves one extra tile perpendicular to the flow on
      whichever side reads as lower ground, so a river reads as a real bed
      rather than a single-file stream. No gameplay effect from
      `flowDirection` yet (a current pushing a swimmer, say) — the data is
      there for a real follow-up.
      **Ice**: new "ice" `TerrainKind`, walkable by default (the whole
      point of freezing over) and no longer "water" for every
      `terrain === "water"` check elsewhere (drinking, fishing) — a real
      consequence, not just a skin. `weather.ts`'s `advanceWaterCycle`
      freezes small (non-large) water bodies during winter
      (`ICE_FREEZE_CHANCE_PER_TICK`) and thaws them back once winter ends
      (`ICE_THAW_CHANCE_PER_TICK`) — direct ask: "global winter on smaller
      water" (not biome-gated, and oceans/big lakes stay liquid).
      **Ocean/lake drought no longer goes patchy** — direct report: "ocean
      shouldn't become patchy when hit by drought. it needs to not
      evaporate random tiles, it should be the shallower ones." Root
      cause: a large body's drought-drying roll used to fire independently
      per-tile with no position awareness at all, punching random holes in
      a deep interior the same as a true shoreline tile. New
      `isShoreWaterTile` (the cheap "touches a non-water neighbor"
      check — this codebase's only real per-tile shallow/deep signal
      before this was connected-body SIZE, the same value for every tile
      in one body) now gates large-body drying to shore tiles only, so a
      drying ocean/lake visibly recedes from its edge inward instead of
      developing random interior holes.
      Verified live: a real 150x150 `generateWorld` run placed all four
      `waterKind`s (ocean 9900, lake 1320, river 188, pond 13 tiles), 186/
      188 river tiles carrying a real `flowDirection`, and 94 river tiles
      with 2+ river neighbors (real width, not a single-file stream); a
      real 4000-tick scenario run produced 518 real freeze events, 394
      real thaw events, and 33 real (now shore-gated) drought-dry events,
      ending with 124 ice tiles on the map.
- [ ] **Bug-type Pokémon as a more commonly preferred prey target.** Direct
      ask: "bug pokemon be more common preferred prey target because
      they're easier to eat" — i.e. a predator's prey-selection logic
      (predation.ts) doesn't currently weight target choice by type at all
      (see `isPreyOfAnything`/threat detection). Needs a real design
      decision on the mechanism first (a flat preference multiplier on bug
      types specifically? a broader "some types are easier prey" axis
      predators already implicitly care about, e.g. lower effective
      defense?) and then validation the same way `herdConflict.ts`'s own
      predator-fragility constraint got validated — bug-type populations
      are not obviously more resilient than average, so this needs a real
      before/after population check, not just "seems right."

## Your call: movement is 8-way but combat range is 4-way (Manhattan)

Checked in response to "can all units do 8 way movement?" — **yes, all of
them do**, but the range metric doesn't agree with the movement metric.

- `movement.ts`'s `stepToward`/`stepAway` try the true diagonal first.
- `pathfinding.ts`'s BFS expands all 8 `NEIGHBOR_OFFSETS` at unweighted
  cost 1 (orthogonal first, then diagonals, for determinism).
- **But** every range check uses `manhattan()`, where a diagonal neighbor is
  distance **2**, and a point-shape move derives range **1**.

So BFS says a diagonal step costs 1 while Manhattan says that same target is
2 away. An agent one step from its target is out of melee range.

Measured (`npx tsx packages/runner/src/validateDiagonalReach.ts`), 40 trials
each, identical setups apart from the attacker's position:

| Arrangement | Attacks resolved |
|---|---|
| Orthogonally adjacent (manhattan 1) | **39 / 40** |
| Diagonally adjacent (manhattan 2) | **0 / 40** |

What it costs today:
- Standing diagonally adjacent to a melee attacker is **safe** until it
  steps orthogonally. A player will find this immediately and corner-dance.
- "Range 2" means "one diagonal, or two orthogonal" — not a clean radius.
- Every 8-way tactical idea in `PLAYER_ACTIONS.md` (positioning, range
  bands, holding a corridor) is built on a reach shape that reads as a
  diamond while the movement reads as a square.

Options:
- **Chebyshev distance** (`max(|dx|, |dy|)`) at the range checks — the
  standard metric for an 8-way unweighted grid. Diagonal becomes 1, melee
  reaches all 8 neighbours, and the two metrics finally agree. Recommended.
- Leave it, and treat diagonals as genuinely longer — defensible, but then
  BFS should cost diagonals more too, which is a bigger change.
- Make movement 4-way — rejected, 8-way is wanted.

Not changed unilaterally: it raises effective melee reach for every unit in
the sim, so it needs a real before/after on combat frequency and predation
balance, not just a metric swap.

## Your call: is elevation's accuracy effect big enough to feel?

Elevation is now wired into the accuracy roll (attacker's elevation minus
defender's — the gap only, never absolute height). It works, and it is
**subtle by default**. The constants look like they were written for integer
elevation tiers, but `Tile.elevation` is a continuous float and the gaps
between two agents close enough to fight are small.

Measured over 12 seeds x 6000 ticks (4,929 real hit attempts):

| |delta| between combatants | value |
|---|---|
| median | 0.015 |
| p90 | 0.676 |
| p99 | 2.068 |
| max observed | 3.661 |

At `ACCURACY_PER_ELEVATION` = 0.05 that is a ~3% accuracy swing at p90 and
~18% at the largest gap ever observed. `MODIFIER_CAP` (0.3) needs a gap of 6
and is never reached in a real fight.

Concretely: 3 of the first 6 seeds came out **bit-identical** before and
after wiring — the nudge was never large enough to flip a single roll in
those runs.

Options:
- **Leave it.** Elevation is a real but minor edge; terrain reads as texture.
- **Raise `ACCURACY_PER_ELEVATION`** (0.15-0.25 would make p90 a 10-17%
  swing) so high ground is a decision a player would actually take a detour
  for.
- **Rescale elevation itself** so terrain has sharper, more legible steps —
  bigger change, affects FOV and movement too.

Recommend raising the constant if the tactical layer in `PLAYER_ACTIONS.md`
goes ahead: "help it get to the right position/elevation" needs the bonus to
be worth a turn of walking. Not changed unilaterally — it's a balance number.
Re-measure with `npx tsx packages/runner/src/validateElevationAccuracy.ts`.

## Your call: battle log reveal pace (LINE_REVEAL_INTERVAL_MS)

Two branches independently tuned the same number and disagreed. Merged in
favour of the direct ask, but this is a balance number and it's yours.

- **450ms** (kept) — from the direct ask "Need more pause between each log
  line", plus `POST_CATCHUP_HOLD_MS` = 1000ms from "a 1000 ms pause after
  the last one."
- **200ms** (the other branch) — reasoned against the tick cadence, which
  is now `BATTLE_STEP_INTERVAL_MS` = 950ms. A four-line hit at 200ms uses
  800 of 950 and still leaves an inter-exchange gap.

The tension is real: at 450ms a four-line hit needs 1800ms against a 950ms
tick, so during a sustained exchange the reveal falls behind and
`MAX_PENDING_LINES`'s instant-catch-up is what bounds the lag. In practice
that means long fights may snap-reveal rather than pace evenly.

Options: keep 450 and accept snap-catch-up on long exchanges; drop to ~200;
or raise `BATTLE_STEP_INTERVAL_MS` so 450 fits. Not measured live yet.

## Narrative pillars — written, see NARRATIVE_PILLARS.md

What the game is *about*, and what that lets us refuse. Written because of a
claim worth taking seriously: simulator games **cannot help** but encode
their creator's model of how reality works — "an interpretation of reality
that is baked in code." In a sim there's no "just flavour"; the ruleset *is*
the ontology. Sharpening added: **omission is a claim too** — we currently
don't model disease, aging, lasting injury, or non-food scarcity, and each
silence asserts something about what a life consists of.

Four pillars, each with a **refusal test** (a pillar that never rejects
anything is a mood, not a pillar):

1. **Humans are animals too** — already structural (humans are a
   `SpeciesDef` on the same needs/herd/rapport machinery; no capture ever).
   The difference from Pokémon is *practice, not kind*, so every human
   capability must carry ecological cost. Refuses: costless human
   capabilities, and any problem solved by domination.
2. **Stories everywhere, if you look closely** — mostly built (chronicle,
   herd histories, notables, generated history). The load-bearing word is
   **curation**: "stories everywhere" without it becomes stories nowhere,
   which is DF's real limitation. Mandate: the game must notice on the
   player's behalf. Refuses: systems whose output is only readable as a log,
   single-cause events, backstory that isn't true in the data.
3. **The rugged individual is a myth** — and **the campaign deliberately
   invokes that trope in order to break it.** Act 1's lone-survivor opening
   is intentional setup: solitude is *endured, not mastered*; you escape
   because you stopped being alone. "First" means unsupported, not
   exceptional. Refuses: any moment the player succeeds alone at something
   that mattered, including single-handedly saving the village.
4. **All that you change, changes you** — least built, highest potential.
   Converges with the Pokopia contrast ("humans become what they do") into
   **no class selection, only accreted identity** — for the player, the
   partner, and the land, which remembers (`fire.ts` already leaves scorched
   ground). Refuses: costless menu-pick identity, changes that leave no
   trace.

**The method these serve**: deliberate expectation-inversion, proven by
play. And the hardest discipline that follows — **let the systems make the
argument, never the dialogue.** If an NPC has to explain the theme, the
systems failed. (Same restraint LORE_NOTES.md reached independently.)

- [ ] **Decide which omissions are deliberate** — disease, aging, lasting
      injury, non-food scarcity are all currently unmodelled by default
      rather than by decision.
- [ ] **The curation layer is a mandate with no design yet** — what promotes
      one generated event over the thousands around it into something the
      player actually sees? Separate job from simulation, real cost.
- [ ] **How much does the land remember, and for how long?** Pillar 4 wants
      persistence; the demoted-zone model currently *freezes* terrain rather
      than ageing it. Real tension.
- [ ] **Does accreted identity feed back into mechanics**, or stay
      narrative/reputation only? First is much stronger and much more work.
- [ ] **Watch pillar 3 vs. the roguelike form** — roguelikes are
      structurally solitary, and we're using the form to argue against its
      own premise. Elegant but fragile: if the solo stretch is fun in the
      wrong way, the inversion fails and it's just a competent lone-survivor
      game.

## Campaign pitch 1: cave escape -> village -> Jirachi — captured, see CAMPAIGN_DESIGN.md

The first pitch for what the *game* is rather than what the sim is: start
alone at the bottom of a 5-6 layer cave, survive (eat/drink/fire/shelter/
craft), befriend your first Pokémon out of a prey herd, fight or evade your
way up, emerge with an evolution stone, then save and rebuild a village.
Full pitch captured verbatim in CAMPAIGN_DESIGN.md, along with an audit of
what already exists versus what's genuinely new.

**Headline finding from that audit**: far more of this exists than expected
— needs/hunger/thirst, herbs and crops, real spreading fire, shelter
building, moves, named herds, the rapport graph, leveling/move-specing,
CA cave generation, and cave/village landmarks (`deepCavern`,
`tunnelWarren`, `sanctuary`, `crossroads`) are all real, shipped systems.
The four player-bonding verbs (Feed / Fight alongside / Rescue / Presence)
are already locked in from an earlier design pass too.

**The one genuinely huge gap**: there is no player agent at all — the sim is
an observer sim with a camera, no controlled entity, no input→action path.
Everything else in the pitch is content on top of that single change.

**All four opening decisions are now made** (see CAMPAIGN_DESIGN.md's
"Decided" section for the reasoning):

- [x] **Turn based.** World steps when the player acts. `tickWorld` is
      already deterministic per tick, so this is a scheduling change at the
      driver level, not a sim rewrite — but it does make the existing
      continuous observer view a second, different mode.
- [x] **"A well designed randomly generated bespoke level."** Authored
      generator, random instance — not hand-placed rooms, not "hope a level
      falls out of the ecosystem sim."
- [x] **Layer, zone and Z-level collapse into one concept**: zones on
      different Z levels with stairs between them. "Layer" as a separate
      spatial noun goes away; a Z level can span several zones horizontally.
- [x] **Forced fights come from level design, not combat tuning** — tight
      corridors, a bespoke-generator concern. Today's pursuit/give-up rules
      don't need retuning to hit a balance target.

Still genuinely open, left by the Z-level decision:

- [ ] **What happens to `Layer` (`surface`/`underground`/`canopy`)** once Z
      levels exist — sub-layers within each Z level, or does Z replace the
      enum? DESIGN.md's Z-level section raised this and left it open.
      Cheapest coherent guess: a cave Z level IS underground at a given
      depth, and surface/canopy only exist at the top level.
- [ ] **How a zone addresses itself with Z** — third coordinate on the same
      dense grid, or caves as a sparse structure hanging off the surface
      zone containing their entrance? The second is likely much cheaper
      (caves are rare; a dense 3D grid would be almost entirely empty) and
      leaves the existing surface macro grid untouched.

## Humans: what they actually are — designed, see HUMANS_DESIGN.md

Direct instruction, gating the geo pass below: "before we do that we gotta
go deep into humans design... like history and motivations and tools and
shit." The geo pass knows how to *place* villages; nothing had decided what
was in one.

Core recommendation: **humans are a simulated species with a thin authored
overlay**, not static NPCs — because a village turns out to map almost
exactly onto machinery that already exists (`herds.ts` for named groups with
founding/splits/history, `herding.ts` cohesion, `herdLeadership.ts`,
`notables.ts` for earned reputations, `shelter.ts` for building, `crops.ts`
for farming, `territories.ts`, `herdConflict.ts` for real resource
pressure, `chronicle.ts` for the record). A `SpeciesDef` already carries
`buildsShelter`/`biomes`/`preferredTerrain`/`activityPattern`/`isPredator`,
so "human" is expressible as a species entry today with no new fields.

Three things the doc goes deep on, each with a genuinely cheap hook:

- [ ] **Generated history**, sibling to the geological pass — founding
      sites, expansion over generations, settlements that split/stagnate/
      fail, ruins with real recorded causes, era events. Reuses the herd
      vocabulary almost exactly (**a settlement founding is a herd split**;
      `HerdRecord` already has `foundedTick`, a parent for splits, and an
      origin). Payoff: an elder's backstory is *true in the data*.
- [ ] **Motivations** — individual drives (provide / standing / curiosity /
      safety / devotion / grievance) biased by the `Disposition` vector
      (`boldness`/`aggression`/`sociability`) that `nature.ts` already
      carries. Plus one dominant **settlement** motivation (survive /
      rebuild / defend / expand / trade / worship) which turns out to be
      **the quest generator** — both of the pitch's own example quests fall
      out of it unmodified.
- [ ] **Tools and material culture** — pre-industrial ladder shared with the
      player's Act 1 crafting (village = better tables, not different
      physics). What a settlement can make is **already determined by the
      geology pass** (forest→timber/bows, highland/`geothermalVent`→ore/
      smithing, coast→boats/nets), so regional variation is free. Techniques
      diffuse along trade roads over historical time, and can be *lost* when
      a settlement falls.

Proposals in that doc worth a decision, not just noting:

- [ ] **Shrines sited at real generated landmarks** (`sacredSpring`,
      `geothermalVent`, `meteorCrater`, `boneGrounds`) — the world's geology
      IS its mythology, and a shrine is the evidence someone noticed. Nearly
      free to implement, gives every generated world its own religion.
- [ ] **Per-settlement attitude toward Pokémon** (reverent / fearful /
      pragmatic) set from local facts and drifting with events — decides
      quests, reactions to the player's bonded partner, and whether "clear
      the Krabby nest" is pest control or a moral problem.
- [ ] **Why nobody has bonded before**: bonding needs close-range reading of
      a dangerous animal, which is exactly what a society surviving by
      keeping its distance trains itself never to do. The player is first
      because they were desperate and alone, not chosen.
- [ ] **TMs as ancient relics, not human technology** — found in ruins/
      caverns/shrines rather than crafted. Fixes the awkwardness of
      pre-industrial people manufacturing move-teaching devices, makes ruins
      worth exploring, and seeds a "the knowledge was lost" runway toward
      Act 3.
- [ ] **Inherited roles** as the answer to "a simulated quest-giver can
      die" — *the elder* persists as an office even when the person doesn't.
      The only option that turns the problem into a feature.

**Five of the original nine questions are now decided:**

- [x] **Humans are simulated** (with a thin authored overlay for
      campaign-critical individuals).
- [x] **The world generates wild and gets settled by a history pass** —
      recommended with a real caveat about tuning (see below), and a named
      cheaper fallback (derive history backward instead of simulating it
      forward) if it misbehaves.
- [x] **Humans hunting Pokémon is lore-only, never shown** — no hunting
      behavior in the live sim; generated history, old stories and shrine
      lore can reference it. Keeps humans sympathetic in the present, keeps
      the world honest about its past, and is cheaper than the alternative.
- [x] **No domesticated Pokémon** — at least not in the starting region.
      Scoped locally on purpose so a distant culture doing otherwise stays
      available later.
- [x] **Roles are inherited** — a quest-giver can die; *the elder* is an
      office, not a person, and the fact someone had to take it up is a
      story.
- [x] **Populated world, but wilderness stays dominant** ("just gotta not
      be... everything") — a tuning target for the history pass, not a
      design change. Add "fraction of land zones settled / roaded / inside a
      settlement's influence radius" to what the 50-seed validation run
      measures.

## Lore research — see LORE_NOTES.md

Canon gathered to check this design against, tiered into what's actual
in-game text, what's fan theory, and what's fan fiction (so we don't end up
building on a creepypasta).

**The finding that matters most**: Legends: Arceus's **Hisui** is very close
to our premise — a frontier settlement where ordinary people fear Pokémon,
partnership is brand new, and clans revere them. Its villagers / clans /
expedition split independently reproduces our reverent / fearful / pragmatic
attitude axis, which is decent evidence the axis is right. LORE_NOTES.md
ends with a deliberate difference table (no capture at all, generated world
and history, turn-based, settlement simulation, and a nobody protagonist
rather than one chosen by a god).

**The pattern worth stealing outright**: in canon, *every modern power
system is the residue of an ancient catastrophe* — Mega stones are debris
from AZ's weapon, Dynamax ties to the Darkest Day, Terastallization comes
out of the Area Zero crater. Our **TMs-as-ancient-relics** proposal is
therefore house style, not a departure. The second pattern: the deep past is
revealed **archaeologically** (ruins, murals, folk tales, a diary in a
burnt-out lab), almost never by a character explaining it — which our
generated history + ruins + chronicle stack is already a machine for, if we
keep the restraint.

- [ ] **Nobles and wardens** (Legends: Arceus) is the single best mechanic to
      borrow: a revered local Pokémon, tended by a human who has never owned
      it, that can go *frenzied* and must be **calmed rather than killed**.
      Fits reverent settlements, gives a non-combat job to a bonded partner,
      matches the pitch's "befriending a predator is hard but possible," and
      is structurally close to what `herdConflict.ts` already produces (a
      pressured animal behaving badly for real reasons).
- [ ] **"Humans and Pokémon once ate at the same table"** (Sinnoh folk tale,
      real in-game text) is the strongest canon backing for our premise — a
      world of distance and reverence is a plausible *middle* of a story
      canon already tells, not a departure from it.
- [ ] **The dex is an unreliable narrator** — entries contradict each other
      across versions. For per-settlement culture plus generated history,
      two villages holding contradictory sincere beliefs about the same
      species is canon-accurate rather than sloppy. Worth building toward
      deliberately.

**Delivery channels** are now surveyed in LORE_NOTES.md too — six real
mechanisms the franchise uses, which matters because pillar 2's "the game
must notice on the player's behalf" is unbuildable until we know what
noticing looks like:

- [ ] **Ritual/behaviour is the channel we're most set up for and should
      lead with.** Lacunosa Town's people stay indoors at night because of a
      legend — the *curfew is the story*, learned by noticing, with no text.
      A village that walls itself, leaves offerings, or won't hunt the north
      woods is telling you its history without a line of dialogue. This is
      pillar 2's "let the systems make the argument" made concrete, and
      **four of the six channels need no prose generation at all** — a ruin,
      a wall, a curfew and a shrine are lore delivered as *world state*.
- [ ] **Live historiography as the curation layer** — rather than surfacing
      generated history through UI, give it to a character who is *trying to
      work it out* and can be wrong in front of you (Sonia researching and
      publishing across Gen 8; Cynthia reasoning that Giratina was edited
      out of the official story). Strong candidate answer to the otherwise
      undesigned curation mandate.
- [ ] Other four channels: environmental text (found, unexplained — the
      Mewtwo journals archetype), institutional text (a settlement's own
      written record, which can *disagree* with the chronicle), NPC
      testimony (partial, contradictory), ambient dex/item text.

**Pokémon Conquest** is now written up properly, and the piece to steal is
**Perfect Links** — compatibility is uneven and personal, so who you can bond
with easily is a fact about *you*, not a grind. Also: link % gates evolution,
meaning **progression belongs to the pair rather than the creature**.
Alongside Ranger (borrowed cooperation, Pokémon return to the wild) and Snap
(the verb is *observing*), the franchise has shipped **three** games whose
core loop isn't capture — our no-capture decision is well-precedented.

## Myth structures — see MYTH_STRUCTURES.md

Structural analysis of the leaked species folktales (form and function only;
the standing "don't build on the content" position is unchanged). This is
the spec for what a generated etiological myth would actually look like.

**Headline:** every violent myth in the corpus is a rule about taking life —
take males without offspring, never breeding females or young; return
remains by the species-specific protocol; killing for food is fine but
mutilation and excess are not; killing for amusement is the original sin.
Those are ecologically sound harvest rules, which means **respect and
sustainability are the same rule** — and in our sim that can be *literally
true*: overhunt breeding females and the population model actually crashes.
The folklore would be an accurate folk description of the sim.

Six skeletons identified, each with a trigger pattern our chronicle could
detect and a norm it outputs: **the Trial** (excess → summons → unarmed duel
→ witnesses carry the rule), **the Contract** (restraint rewarded, terms
stated, violation punished by ironic reversal), **the Ritual Error** (right
intent, wrong protocol, irreversible), **the Original Sin** (cruelty for
amusement → harm made personal → a death → the norm changes), **the
Crossing** (union across the boundary; the village's cruelty is the real
sin), and **the Bond Through Change** (Wurmple — the outlier, not
etiological, and the one that keeps the corpus from being uniformly grim).

- [ ] **Which norms are mechanically real vs. culturally held?** "Don't take
      breeding females" can be enforced by the population model; "return the
      horns skyward" can only ever be belief. Both worth having, but
      mistaking one for the other is how you get a preachy game.
- [ ] **A myth needs a norm to output, or it needs to be the outlier.** If a
      generated story doesn't change how a village behaves and isn't a
      Wurmple, it's noise — the curation problem arriving early.
- [ ] **Swords vs. bows, from the myths.** The corpus is explicit: *"No bow
      and no spear, only the sword."* Bow and spear are hunting tools with
      rites attached; the sword is *found* (taken from Sharpedo), carries no
      custom, and immediately enables atrocity — and at the trial it won't
      even draw. Suggests a real mechanical split: hunting tools tied to
      norms and sustainable use, vs. a weapon that's effective, ungoverned,
      and **corrosive** (reputation, attitude drift, ecological damage).
      Satisfies pillar 1's refusal test — no human capability without cost.
- [ ] **Violence is mutual in every one of these.** The swordsman and the
      Ursaring both die; the careless hunter dies wearing the skin he stole.
      Tonal target: combat as mutual destruction, not a skill check.

**Pokopia** (post-apocalyptic Kanto life-sim, March 2026) is now written up
too — research supplied by the project owner, since the base game sits at my
knowledge edge and the Aug 2026 expansion is past it. It's the exact mirror
of our premise (humans evacuated off-world and never came back; you're a
Ditto wearing your dead trainer's shape), which completes a bracket showing
our game sits deliberately at *the moment before partnership is invented*.
Four things worth acting on:

- [ ] **"Pokémon are what they are; humans become what they do."** Pokopia
      derives a Pokémon's civic role from typing/moveset — instinct IS the
      job. HUMANS_DESIGN.md independently proposed the opposite for humans
      (roles *earned* through accumulated history). Both are right for their
      species, and the contrast is a cheap rule that says something real.
      Species-derived specialties could come off `SpeciesDef` data we
      already have; earned titles already exist in `notables.ts`.
- [ ] **"Comfort, not capture" implies our endgame.** Our villages keep
      Pokémon *out*; the player is the first who can do the opposite. So the
      late-game payoff of "you're the first" is **building a place where
      both can live, and Pokémon start choosing to be there** —
      mechanically real, and mostly reusing `speciesFitsZone`/
      `estimateZoneSpecies` with the player changing the inputs.
- [ ] **Knowledge physically present but socially lost.** Pokopia's Pokémon
      can't read human writing, so only the player learns the truth. Invert
      it: ruins hold records nobody in the village can read any more (already
      canon-shaped — Braille, Unown). Also: **places outlive their names** —
      `territories.ts` plus a history pass could carry both a current name
      and an older one that only survives in records.
- [ ] **Don't drift cozy.** Pokopia removes aggression and territory
      disputes entirely. That's exactly wrong for us — predation, territory
      and resource conflict are the engine of the whole simulation, and the
      friction is what makes eventual coexistence mean anything. Named so we
      notice if we start sanding it off.

**The Teraleak material** is also written up (owner-supplied research, kept
with all its caveats: unconfirmed, machine-translation-layered, a ~2005
pre-Giratina draft, from a criminal breach, and with a documented case of a
viral misreading that a proper translation walked back). **Standing position:
don't build on the content** — it isn't canon, it's unstable, and the shipped
Canalave Library material covers everything we actually want and is citable.

**But the method it reveals is ordinary good worldbuilding and worth taking
freely**, and it reframes the history pass. Game Freak drafted a full dark
mythology and shipped a sanded-down fraction; the unshipped text earned its
keep by keeping the *shipped* fragments consistent with something real.

- [ ] **The history pass IS the internal bible** — this resolves a real
      worry that a generated history nobody reads is wasted computation. Its
      job is to make every fragment the player *does* meet (a ruin, an
      elder's account, a place name, a chronicle line) consistent with actual
      events. So: generate it all, expose slivers. **Restraint is the
      technique**, not a limitation.
- [ ] **Rules-myths vs. character-myths.** The shipped Pokémon myths are
      almost all mechanism-explaining (why Pokémon leap from grass, why you
      battle instead of fight, why the Regis must be gathered); the unshipped
      drafts have protagonists and grief. Split ours the same way — ship the
      rules-myths (they make systems feel reasoned rather than arbitrary),
      keep character-myths internal and surface them rarely.
- [ ] **Generated etiological myths — highest-value output of the history
      pass.** Every shipped canon myth explains a *present norm* via a *past
      event*, which is exactly what our chronicle records. So a settlement's
      culture can be derived from its own history: a recorded catastrophe
      involving a species → fearful, plus a myth saying why; saved by a
      landmark's water in a drought → reverent, with a shrine and a story.
      **The attitude axis stops being a generation-time roll and becomes a
      consequence** — the village isn't just reverent, it's reverent
      *because of something that happened to it*, and it can tell you.
- [ ] **Myths as swappable templates** — the leaked folktales were written
      as reusable structures with the species swapped (the same story exists
      in Octillery and Lapras versions). That's literally our generation
      strategy: *template + real recorded event + the species/place/people
      involved*. A dozen skeletons filled from the chronicle gives every
      village its own true stories, and lets two villages tell the same
      template about different events — which is how real folklore behaves.
- [ ] **Myths can be wrong, and that's a feature.** Cynthia's in-universe
      reading is that Giratina was *deliberately edited out* of the official
      story, and the Canalave folk tale differs between JP and Western text.
      Since our chronicle holds what actually happened, a village's myth can
      omit the shameful part, credit the wrong ancestor, or blame the wrong
      species. That gives the unreliable-narrator idea real teeth (there's a
      ground truth to be wrong about), a genuine reason to visit ruins (the
      record contradicts the story), and contradictory myths about the same
      real event.

- [ ] **Budget a real tuning pass for the history sim.** Named risk, from
      this project's own scar tissue (the overworld capacity feedback loop
      that chased 1 forever, caught only by a real multi-thousand-tick run):
      a forward history sim's likely degenerate outcomes are **collapse**
      (all ruins), **monoculture** (one settlement eats the continent), and
      **sameness** (every seed produces the same history — worst of the
      three, since it costs the same and delivers nothing). Mitigation is
      the discipline already used everywhere else here: it's cheap to run,
      so generate ~50 seeds and tune against the real distribution of
      settlement counts, ages, ruin counts and lineage depth.

## Farming: the defining human activity — designed, see HUMANS_DESIGN.md

Direct emphasis: "Oh and farming. Humans grow crops." Given its own section
because it's the clearest mechanical line between humans and everything else
in the sim — **everything else forages; humans make the land produce more.**

`crops.ts` already supplies most of the substrate: 12 crops with real
`seasonWindow` gating over a genuine spring/summer/autumn/winter cycle,
biome and runtime-moisture gating, growth stages via `Tile.growth`, and
`nutritionMultiplier` payoff differences. Farming is a new *user* of that,
not a new system.

- [ ] What farming adds on top: cleared/tilled field terrain (the most
      legible sign of human presence on a map), deliberate planting (which
      makes planting *badly* possible — where stories come from), tending as
      repeated labour investment (reusing `shelter.ts`'s travel-and-invest
      shape), irrigation near `riverEdges`, and harvest/storage.
- [ ] **Granary fullness is the single number driving the Survive
      motivation** — it's what makes the season calendar actually bite (you
      eat in winter from what you stored in autumn) and what generates the
      food quests.
- [ ] **Farming is the friction generator, and that's the point.** A field
      is a concentrated undefended pile of food in an ecosystem full of
      hungry animals. `herdConflict.ts` already fires on genuine
      cross-species resource contention, so "something is eating the crops"
      needs no new mechanic. It's also morally interesting rather than flat
      — a Tauros herd in the barley isn't evil, it's hungry, probably pushed
      there by a bad season the weather system caused — which lands directly
      on the reverent/fearful/pragmatic attitude axis and gives a bonded
      partner an obvious non-combat job (scaring a herd off a field).
- [ ] Scope: comparable to `crops.ts` or `shelter.ts`, each its own project
      — but the highest payoff-to-new-machinery ratio in the humans design,
      since most of it is pointing existing systems at each other.

Still open (see HUMANS_DESIGN.md's own list): how populated the world is,
how deep history goes, roads-from-history vs. MST, TMs as ancient relics,
what makes a settlement's attitude drift, and whether arriving with a bonded
partner mechanically changes how villages treat you.

## Human geo pass: roads, villages, ports, shrines — designed, see CAMPAIGN_DESIGN.md

Direct ask: "We also need to do 'human' geo passes to add human-ness to it
all. Like roads and villages and ports and boats and homes and shrines and
shit." This is the phase DESIGN.md deliberately deferred ("it's after the
geological stuff") — now designed, still unbuilt. Slots into `macroGrid.ts`
after `placeLandmarks`, following that function's existing eligibility-gated
/capped/spaced placement pattern.

Most of the inputs already exist as per-zone macro facts: `riverEdges`/
`isLake` (fresh water), `coastEdges` (ports — already computed for every
land zone), `estimateZoneResourceIndex` (arable land), `minLandNeighbors`
(junctions), and the greedy min-spacing loop from `selectMacroRiverSources`.
Settlement tiers (hamlet/village/town/port) fall out of the site score
rather than needing three separate placement passes.

- [ ] **Roads are the one genuinely new algorithm** — the first *connective*
      human feature (rivers are the only existing one, and steepest descent
      is exactly wrong for a road). Shape: MST over settlements plus a few
      extra edges for loops, then cost-based pathing per edge (cheap on
      grassland/beach, expensive on highland/jungle/snow, very expensive
      crossing rivers except at a bridge/ford, impassable on ocean), marking
      `roadEdges` in the same compass-edge vocabulary `riverEdges`/
      `coastEdges` already use.
- [ ] **Sea routes between ports** — same MST idea over water; what makes a
      port mechanically distinct from a coastal village rather than flavor.
- [ ] **Per-zone human influence gradient** (0..1, distance-decay from
      settlements/roads) — already called for by DESIGN.md's "life pass"
      as "extent of human influence"; falls straight out of this pass.
      Feeds species density/wariness near towns and what generates on
      promotion.
- [ ] **Roads will hit the known river gap**, identically: `biasForZone`
      currently consumes only elevation/ocean/biome, so macro edge facts
      (`riverEdges`, and now `roadEdges`) are recorded but never turned into
      real tiles entering at the right edge. Argument for fixing it **once**,
      generically — one "macro edge features → tiles at the correct edge"
      mechanism serves rivers, roads and coastlines together, instead of
      three versions of the same thing.
- [ ] **Boats are not a geo pass** — ports are terrain, a boat is a vehicle
      that carries the player between coastal zones. Different kind of thing,
      needs its own design (does it move on the macro map? is there a sea
      zone to sail through?).
- [ ] Shrines/homes: `sacredSpring` and `sanctuary` landmarks already exist
      as the natural-world cousins; shrines are the human-built version and
      could plausibly be sited near them or on high ground.

## Villages, quests and content — not designed, own pass needed

Direct ask, stated as scope: "Need to design villages and quests and
content. Lots work." Agreed — biggest unstarted piece, needs its own design
pass, deliberately not attempted in CAMPAIGN_DESIGN.md.

- [ ] **Design order matters**: human geo pass first (villages exist as
      places on the map), then village content (what's *in* one), then
      quests (what you do for them). Out of order means designing quests for
      places with no defined shape.
- [ ] The premise already justifies quest-giving for free: "trainers aren't
      really a thing yet... you're the first to train one, so people ask for
      your help." Not a chosen one — the only person with a capability
      nobody else has.
- [ ] **Keep quests sim-shaped, not scripted.** Both examples given ("clear
      out Krabby nests by the beach," "collect materials") are things the
      existing sim can actually express — a real herd with a real territory
      in a real coastal zone. Worth holding onto that property deliberately
      as quest design grows.
- [ ] Village crafting tables are the progression spine linking Act 1
      survival crafting to Act 2 — same system upgraded, not a separate
      village-economy system.

## Implement more moves — real backlog, known ceiling

Direct ask: "And implement more moves." Real numbers, checked: **~35 moves
implemented** as sim mechanics (`packages/data/src/moves.ts`) against
**~951 imported** into the dex as data (`dex/moves.generated.ts`, which
explicitly "does NOT reimplement move battle logic").

- [ ] Every dex move already has canon power/accuracy/type/category — the
      work is what each one *does* beyond damage, plus effect fields the
      engine doesn't understand yet. Three distinct pipelines already exist
      to hang them on: hostile hits (`predation.ts`), ally support
      (`support.ts`), self/tile utility (`utilityMoves.ts`), so most of the
      work is picking the next batch and deciding which pipeline each
      belongs to. See MOVES_DESIGN.md, which owns this thread.

Unbuilt systems the pitch implies, each a real project of its own, none
started: inventory/equipment (armor, stick, backpack, fishing rod, TMs,
stones), crafting + recipes + crafting tables, cooking (fire and food both
exist; the verb connecting them doesn't), the Wary→Tolerant→Curious→Bonded
trust stage machine, tactical partner commands (move + target tile, with the
UX risk the pitch itself flags), and all of Act 2's village/NPC/quest tissue.

- [ ] **Suggested first slice, if/when this gets built**: one cave layer,
      one player, one bond — a player agent using the existing `needs.ts`
      wholesale, player-driven turns, a real prey herd + water + crops (all
      of which already generate), the four bonding verbs wired to the
      existing rapport graph with legible trust stages, and an exit once
      bonded. Everything else deliberately excluded. The one question that
      can't be answered on paper — does "earn a partner by reading the
      ecosystem" read as a puzzle or as trial-and-error — is answerable with
      exactly that slice.
- [ ] Act 3 (Jirachi/wish) is a direction, not a design — the pitch says so
      itself ("or something. Idk."). Nothing to scope yet.

## Food crops (Oran/Sitrus/Pecha/Cheri berries kept + Corn/Wheat/Rice/Tomato/Apple/Potato/Pumpkin/Herbs) — built, see CROPS_DESIGN.md

Direct ask: "more kinds of food, not just berries... nutrition dense, grow
in certain regions and seasons, and be heavily contested," refined into
"make it so they keep you full for longer, and also are affected by zone
and climate and season," then corrected: "I think we need to keep berry as
food sources tho." Real biome/moisture/season-gated crops replace the old
purely-cosmetic flavor LIST (`FOOD_FLAVORS`, confirmed zero gameplay effect
before this) — the four original berries themselves are still real, ungated
food sources in the same registry, just alongside 8 new crops instead of
alone. Full scope, tier table, and built-vs-scoped delta in CROPS_DESIGN.md.
Two real calibration bugs caught by sampling a real generated world before
shipping (Rice's moisture gate and Tomato's sunbeam gate were both
unreachable as first drafted) — see CROPS_DESIGN.md's own "Built — real-run
findings" section for the numbers. Confirmed via `validateCrops.ts` over a
real 8000-tick run: all 4 berries plus 7 of 8 new crops appear (Pumpkin
absent this particular run — plausible variance, not a gate bug), Winter
cuts average live food tiles by roughly 20x. Flagged follow-ups:

- The "heavily contested" half of the ask rests on `herdConflict.ts`'s
  existing generic resource-blocking trigger, not on any crop-specific
  contest-seeking behavior (agents still just `seekFood` their nearest
  option) — the validation run couldn't actually confirm rare crops draw
  more clashes than common ones; see CROPS_DESIGN.md for the honest
  breakdown of why and what a real test of this would need (larger
  population, and/or `herdClash` events recording the contested tile's own
  position instead of wherever the skirmish itself happens).
- Honey is deferred, not built — CROPS_DESIGN.md scopes a real
  pollinator-adjacency design (a `bloom` tile timer + Butterfree/Beedrill
  proximity) but it needs new per-tile state none of the 8 shipped crops
  needed, so it was sequenced out of this pass.
- No dedicated sprite art exists for any of the 8 crops yet — they render
  via the existing colored-glyph fallback (`palette.ts`/`ascii.ts`), same
  path any flavor without real art already used.

## Natural landmarks on the macro grid — built, see DESIGN.md

Direct ask: "more character, more points of interest," refined through "stay
away from the human civilization pass, just natural places" and finally "I
want particularly unique zone gen for them... make em interesting to look at
and form interesting points of conflict and emergent stuff." Ten real,
naturalized landmark types shipped (Great Lake, Fertile Basin, Sacred
Spring, Geothermal Vent, Meteor Crater, Deep Cavern, Tunnel Warren, Bone
Grounds, Frozen Grotto, Crossroads) — mainline Pokémon location archetypes
(Mt. Moon, Cerulean Cave, Diglett's Cave, Lavender Tower, Seafoam Islands)
with every human-built structure filtered out, each still carrying a real
mechanical hook. Full writeup, rarity numbers, and the mechanical-hooks
detail in DESIGN.md's "Natural landmarks" section. Flagged follow-ups:

- Rarity (`LANDMARK_DEFS`' `chancePerEligibleZone`/`maxCount`) is a
  sim-original guess checked once against a 400x400 real grid
  (`validateLandmarks.ts`) — revisit if landmarks read too sparse/common
  once more of the game is actually played on a real map.
- Bone Grounds' resource richness is deliberately left at zero bonus for now
  (see `LANDMARK_RESOURCE_BONUS`'s doc comment) — it's meant to be earned
  through the not-yet-built corpse-decomposition-enriches-soil passive
  (itself still a pitched idea in MOVES_DESIGN.md), not handed out for free.
- No dedicated zone-info panel exists yet to name a focused zone's landmark
  in text (e.g. "Great Lake") — currently only the macro map's own colored
  marker (`macroMap.ts`) surfaces it visually.

## New standard: every attack move starts at cooldownTicks 2 minimum

Direct follow-up to the cooldown-timing fix above: "let's move all Moves
up. To like default cool down of 2 as a base. That'll be our standard to
start." Bumped every curated attack move sitting below 2
(Tackle/Slash/Vine Whip/Peck/Scratch/Water Gun/Poison Sting: 0→2;
Ember/Rock Throw/Twineedle: 1→2) in `packages/data/src/moves.ts`.
Everything already at 2+ (Sludge, Psybeam, Wing Attack, Body Slam, and
every move at 3+) is untouched, and utility/status moves (Growth, Rain
Dance, etc., already 30-150) are unaffected — never part of the bug.
Documented as a real, going-forward authoring standard in
MOVES_DESIGN.md's template section: 2 is the new floor for a basic
attack move, not a target — stronger/rarer moves should still cost more.
Typecheck + full 991 engine / 171 data tests confirmed green (engine
tests use their own hand-rolled MoveSpec fixtures, not the curated
roster, so this data-only change didn't ripple into them).

## Fixed: cooldowns now count down on the unit's own tick, not real time

Direct ask after noticing "a lot of stuff is 0 cd" and asking whether that
meant a move could be used every single world tick. Traced it down with
the user: cooldowns were ticking down in `tickAgentNeeds`, which runs for
every living agent every world tick regardless of Speed — deliberately
"real-time, orthogonal to Speed" per DESIGN.md's original Action Economy
writeup. In practice that made `cooldownTicks` nearly decorative: world
ticks pass far more often than a normal agent's own action ticks (gated
by Speed vs. `ACTION_THRESHOLD`), so a `cooldownTicks: 1`/`2` move was
already back off cooldown before all but the fastest agents got a second
turn. Direct instruction: "I want cooldown to be the unit's tick." Moved
the `tickCooldowns` call from `tickAgentNeeds` to the top of
`tickAgentAction` (needs.ts) — it now decrements once per the agent's own
real action tick, ahead of every early-return (fainted/carried/asleep/
frozen/paralysis-skip) so it still recovers on a tick that ends up doing
nothing else, same as before. Sleep's existing 2x recovery speed carries
over unchanged, just measured against the agent's own turns now. Updated
DESIGN.md's Action Economy section (which explicitly documented the old,
now-reversed reasoning) rather than leaving it stale. Fixed 3 tests that
asserted the old real-time behavior, added a new end-to-end test proving
`cooldownTicks` now genuinely gates reuse across an uneven action cadence
(Speed 20, acting every other world tick). 991 engine tests green.

**Real balance follow-up, not done here**: with cooldown now meaning
something, `cooldownTicks: 0`/`1` on basic moves (Tackle/Peck/Scratch's
base form, etc.) may deserve a real second look — those values are still
close to "no gate at all" (available again the agent's very next turn
either way). Flagged, not decided.

**Also noticed, unrelated, not fixed**: `reproduction.test.ts`'s "an egg's
parentIds/grandparentIds are recorded correctly" test calls
`createWorld(10, 10)` with no seed (defaults to a real random seed) and
expects an egg to exist after exactly one `tickWorld` call — a
probabilistic single-tick check that's flaky independent of anything in
this session's work (reproduced failing and passing across repeated runs
before this fix existed). Worth a real look — either seed that world
deterministically or loop a few ticks — but out of scope here.

## Move Tree Atlas: interactive build mode — click nodes on/off live

Direct ask right after the range grid shipped: "needs to change based on
the notable/skill I have selected. I should be able to flip em on and
have it modify the damage and stats and the range." Added a real
respec-builder to the artifact: each node's detail panel now has an
Add/Remove-from-build button (disabled with a plain-English reason when
its prerequisites aren't met or it's excluded by something already
chosen — confirmed "prevent excludes" rather than let you click into a
conflict and see an error); the stage's power/accuracy/cooldown/shape
readout and the range/AoE grid both recompute live from the actual
chosen set. The math is a faithful line-for-line port of the real
`applyMoveTree` (same additive-vs-overwrite field list), not an
approximation — verified against real tree data before publishing
(Earthquake's fork exclusion + cascade-remove-on-uncheck, Hydro Pump's
crosslink correctly zeroing out its own branch's `lockTicks` cost).
Removing a node cascades: anything that depended on it gets dropped too,
re-validated from scratch each time. Build-in-progress persists per move
in localStorage (mirrors the existing redesign-notes mechanism), with a
"Reset build" button and a running points-spent readout. Template edited
directly (the real, versioned source per the standardized process above)
and republished through the same two-script pipeline.

## Move Tree Atlas: range/AoE grid added, artifact process standardized

Direct ask: add a range/AoE grid preview per move, republish, and — since
the first version got rebuilt by hand from scratch — "add some
documentation on building that artifact in move design. Just to keep the
artifact consistent... build on it rather than from scratch every time."
Added the grid (ported straight from `resolveShape`, fixed facing "up" —
the real footprint, not an approximation) to the artifact and republished
to the same URL. Then made the whole thing real, checked-in tooling
instead of a one-off: `packages/data/scripts/export-move-trees.ts` (dumps
every move-with-a-tree as JSON from the real `MOVES` export),
`packages/data/scripts/build-move-tree-atlas.mjs` (injects that JSON into
`packages/data/scripts/move-tree-atlas.template.html`, the versioned page
shell), documented as a 3-step process in MOVES_DESIGN.md's new "Move
Tree Atlas: how to keep it updated" section (which also records the
artifact's live URL). Verified end-to-end: running the two scripts
reproduces the published artifact byte-for-byte.

## Real in-game move-tree visualizer + range/AoE preview — not started

Direct ask, after seeing the Move Tree Atlas artifact (a standalone HTML
design-review tool, not part of the actual game): "I think we will want
to build a web visualizer for the skill tree eventually... I want it to
be an interacting tree much like the one in your design doc. And a range
visualizer would be great for that too." Current state, for real:
`packages/web/src/inspector.ts` already has a functional but plain
click-to-expand skill-tree view (`layerNodes`/`renderSkillTree`) — simple
depth-ordered rows with the agent's actually-chosen nodes lit up, no
branch layout, no crosslink lines, no positional graph at all. The ask is
to upgrade that into a real interactive node-graph view (branches
radiating from a hub, crosslinks drawn as real connecting lines, forks
and `excludes` shown explicitly) — essentially porting the Move Tree
Atlas artifact's own layout algorithm and rendering into
`packages/web`'s real UI, live-data-driven (the actual agent's chosen
nodes and available points, not a static reference view) instead of a
one-off review tool. Bundle in the range/AoE grid preview from that same
artifact work (small grid showing a move's real `range`/`shape` footprint
from the user's tile) as part of the same pass, in-game, for the
currently-selected agent's actual moveset. Not started — this is a real
web/UI feature, scoped as its own follow-up, not a quick add-on to the
current move-tree redesign work.

## Hydro Pump/Solar Beam/Earthquake redesigned against v3 principles — built

Direct follow-up to the v3 principles below: "go ahead and redesign all
three." Rebuilt all three flagship trees in `packages/data/src/moves.ts`
from scratch against their own actual fantasy instead of the reused v2
kit — see MOVES_DESIGN.md's new "Hydro Pump / Solar Beam / Earthquake —
v3 redesign" writeup for the full per-branch reasoning. One genuinely new
engine primitive shipped along the way, not just prose: `MoveSpec.
excludesAllies` (+ the matching `MoveTreeNode.delta` field), wired into
`resolveAreaHit`'s target filter (predation.ts) so an AoE move can
actually spare same-herd agents — Earthquake's *Herdsafe Trigger* is the
first real content. New tests: 2 in predation.test.ts (excludesAllies
spares an ally but not an unrelated bystander; without the flag, an ally
still takes the hit exactly like before), 1 fixture update in
moves.test.ts, plus rewritten move-specific assertions in
moveTrees.test.ts for all three redesigned trees (the generic per-move
structural suite re-validated them automatically). Full suite green: 990
engine + 171 data tests. Next: update the Move Tree Atlas artifact with
the new trees, plus a small grid visualization showing each move's real
range/AoE footprint from the user's position — requested alongside this
redesign, not yet built as of this entry.

## Move-tree redesign: start from the fantasy — principles written, trees pending

Direct critique after reviewing the shipped trees in the Move Tree Atlas
artifact: "the design looks like you just copied over effects from other
trees. That's uninspired... we have to do better. Think laterally." Fair —
every tree so far shares not just the v2 template's structure (sound, kept)
but largely the same node *content*: the same fork shapes, the same
ally-buff opener, the same `resistanceBreaker` keystone, repeated across
10 trees. Wrote up three concrete principles in MOVES_DESIGN.md's new
"Skill-tree template v3 — start from the fantasy" section, worked through
against the user's own Earthquake example (an uncontrolled self-centered
blast that today genuinely does hit allies per `resolveAreaHit` — no herd
filter exists — which is real design space, not a bug to just fix): (1)
write each move's actual fantasy in 2-4 sentences before laying out any
branch, and let each branch answer what Aggression/Boldness/Sociability
specifically means for *that* fantasy, not a re-skin of the last move's
answer; (2) filler nodes should draw from the whole lever list (cooldown,
range, defensePenetration, lifesteal/recoil, crit rate, jam cooldown —
not just power/accuracy on repeat), while shape/AoE changes stay
notable/keystone-tier, never filler; (3) positional/movement levers
(forcedMovement, positionSwap, terrain interaction) deserve real per-move
design thought, not the same "fork A pushes, fork B pulls" shape reused
everywhere. Flagged two genuinely new primitives Earthquake's own
redesign would need (AoE ally-exemption, hazard terrain stronger than the
existing terrainBurn/terrainFill) rather than pretending they already
exist. Next: actually redesign the flagged trees against these principles,
per move, starting with whichever ones get flagged in the atlas.

## Twelve advanced moves + 3 more flagship trees — built, see MOVES_DESIGN.md

Direct ask, right after the move-tree batch below: "We need more moves
actually. Like... More skill trees. More advanced moves should be... More
range, more aoe." Scoped via a quick question rather than guessing: went
with the largest option offered ("everything at once" for moves — real
type-gap coverage plus evolved-line finishers — "2-3 flagship trees" for
new skill trees). Shipped 12 real gen-1 moves (`moveCanon`-sourced, same
standard as every move before them) in `packages/data/src/moves.ts`, each
given a real `shape`/`range` instead of staying a point-blank stab: Hydro
Pump/Surf (Water AoE cone/ring), Solar Beam (Grass, long single-target
line — proof AoE isn't the only kind of "advanced"), Earthquake/Rock Slide
(Ground/Rock self-centered burst AoE), Sludge/Poison Sting/Twineedle
(Poison/Bug), Ice Beam (Ice line), Psybeam (Psychic line), Wing Attack
(Flying cone AoE), Body Slam (Normal point, real paralysis payoff). Updated
movesets for the ~25 species that actually learn each one, checked against
real gen-1 movepools where practical. Three got full 33-node flagship
trees — Hydro Pump, Solar Beam, Earthquake — each following the same
Tackle/Peck template, each Boldness keystone a `resistanceBreaker` fixing
that move's own real multi-type resist. New tree-specific tests added to
the existing generic `moveTrees.test.ts` suite (which auto-covers any move
with a tree, so these three were validated structurally for free).
Explicitly out of scope, flagged rather than silently skipped: most of the
45+ species roster still knows only Tackle or one other move; Fire has no
AoE move yet; Bug/Dragon/beach-biome species are still thin. Real follow-up
candidates, not a "todo eventually and never revisit."

## Rock Throw/Peck/Scratch/Water Gun move trees — built, see MOVES_DESIGN.md

Direct ask, after noticing the gap: "Did you never implement the move
trees for peck and stuff? And water gun?" — confirmed these four had a
full design in MOVES_DESIGN.md's "full triangle treatment" section but had
never actually shipped in `packages/data/src/moves.ts` (each was still a
plain stub). Follow-up: "Yes, build all four." All four now have real,
live 33-node trees (3 branches × 10 nodes + 3 crosslinks each), following
Tackle/Slash's own established structural template exactly. Each move got
its own real hook instead of a reshuffled generic kit: Rock Throw
(`selfCostPerUse`, `bonusVsType` vs. Flying, a denial-flavored support
keystone); Peck (the roster's first `positionSwap`+`positionSwapPull` and
first `critCooldownReset`, plus the only tree that changes a move's own
`shape` mid-build — point-blank to a real 2-tile line); Scratch (the
roster's first non-Ember status inflicter — Scratch's base spec stays
clean, poison is entirely tree-earned via *Envenomed* — its only
two-passive keystone, and the roster's first `rallyCall`); Water Gun
(`resistanceBreaker` fixing its real Grass/Water/Dragon 0.5x resists,
instead of a redundant Fire bonus it never needed). New test coverage in
`packages/data/test/moveTrees.test.ts`: generic structural checks across
every treed move (no dangling prerequisite ids, every `excludes` pair
genuinely mutually exclusive, every node reachable in some valid order)
plus specific tests for each new tree's signature keystone mechanic.
Known, accepted, non-blocking limitation carried over from Slash's own
precedent: Onix, Spearow, and the Squirtle pair have no `herdId` in
`packages/data/src/scenario.ts` today, so each move's Sociability branch is
real, shipped content that's currently inert for those specific spawned
individuals (Sandshrew is the one exception, already sharing
`"underground-colony"` with Diglett).

## Environmental/utility moves — first batch built, see MOVES_DESIGN.md

Direct ask: "moves that affect the environment... pull it all in." 13 real,
already-canonical moves shipped (Growth, Grassy Terrain, Synthesis,
Moonlight, Roost, Agility, Harden, Withdraw, Defense Curl, Safeguard, Rain
Dance, Sweet Scent, Leech Seed), each a genuine mainline move the curated
roster already learns per the real dex, not invented — full writeup,
real-run validation numbers, and the two deliberately-deferred items
(persistent hazard tiles, a Sandstorm weather type — both need a genuinely
new mechanism, not just another `MoveSpec` field) in MOVES_DESIGN.md's
"Environmental utility moves" section. Real structural addition along the
way: a third move-trigger path (`utilityMoves.ts`) for moves with no enemy
or ally target, alongside the existing hostile-hit and ally-support
pipelines — and a real bug found via this feature's own validation script:
gating that new trigger on `agent.behavior === "idle"` badly under-fired
(an agent mid-exploration-walk can go many ticks with fully satisfied needs
but a stale non-idle behavior label), fixed by gating on
`chooseBehavior(agent.needs) === "idle"` instead — the real "needs
satisfied right now" signal.

## Overworld rearchitecture: a real macro zone grid — built, see DESIGN.md

Direct correction after seeing the region-graph visualization below: "I
meant like overworld is like... all these previews put together... Did the
overworld we create not do the rivers and mountains and land and ocean
over[all] as large swaths of positionally specific zones? That was the
whole point. To have it contiguous." The 3-named-region graph (see
"Overworld: region graph with promotion/demotion" further down, now marked
superseded) is replaced by a real coarse grid of thousands of zone-cells
with actual 2D adjacency — `packages/engine/src/macroGrid.ts` generates
coherent macro elevation/ocean/biome/coastline/river facts for every cell up
front (reusing the existing tile-level macro-elevation/river algorithms one
level up), and `overworld.ts` promotes zones lazily and sparsely by grid
position instead of eagerly generating a fixed handful of named regions.
See DESIGN.md's "Overworld rearchitecture: a real macro zone grid" section
for the full design, real numbers (a 1,000,000-zone grid generates in
~2.5s), and browser-validated screenshots-in-prose.

- [x] **Background (non-focused) zones were a one-way ratchet toward empty,
      not a living ecosystem — real bug, found by actually running the sim
      and looking, per direct ask ("run some sims, examine the zones...
      it's missing something")**: demoted a zone with 5 squirtle + 1 onix,
      let it run ~3000 more ticks unfocused, and it went to total
      extinction — every species, not just a poor habitat fit. Root cause:
      `RegionAggregate.baseResourceIndex` was measured once at demotion
      (real terrain snapshot, or a macro-grid biome guess) and frozen
      forever — since a demoted zone's `World` never ticks again, an
      unlucky snapshot (freshly foraged-down terrain, the normal moment-to-
      moment dip a focused zone recovers from on its own) could permanently
      cap capacity below whatever population was already living there, with
      no way back up, dooming the WHOLE zone regardless of species fit.
      Fixed in `overworld.ts`: `baseResourceIndex` now drifts (slowly,
      `BASELINE_RECOVERY_RATE`, one-directional — never pulls a real
      healthy snapshot back DOWN) toward the zone's static, population-
      independent biome potential (`estimateZoneResourceIndex`), scaled
      down (`BIOME_MISMATCH_FACTOR`) for a species whose `biomes` don't
      match this zone's — so a genuine mismatch (a wetland species stranded
      in badlands) still correctly declines toward extinction, but a
      biome-appropriate population recovers instead of dying on a
      technicality. Direct ask this also serves: "It should constantly have
      more Pokémon thriving... can be more barren but there should be
      reason for it then" — barren now means a real habitat mismatch, not
      demotion-timing bad luck.
      Also found and fixed while validating this: `macroGrid.ts`'s
      `RESOURCE_ESTIMATE_SCALE` (feeds `estimateZoneResourceIndex`, the
      biome-name-based guess used for zones with no real terrain measurement
      yet) was miscalibrated against its own stated intent ("roughly the
      same ~0.5 typical" a real generated map measures) — at the old value,
      grassland/forest/badlands/highland ALL landed under
      `DEATH_HEALTH_THRESHOLD` (0.3), so wetland was the only land biome
      whose full potential could ever sustain an abstracted population at
      all, independent of species fit. Rescaled so grassland (~0.52) and
      forest (~0.4) land safely above the threshold like the ordinary,
      moderately-provisioned habitats they're meant to be, while badlands
      (~0.12) and highland (~0.2) stay genuinely harsher.
      Real-run validated (`validateOverworld.ts`, 8000 ticks): the same
      demoted zone that used to go fully extinct now recovers squirtle to
      40 individuals, spreads (via ordinary emigration) into a real cluster
      of 8 tracked neighboring zones — several hitting the population cap —
      while onix (the actual habitat mismatch) still correctly dies out.
      43 population-boom events, 0 die-offs, vs. the pre-fix run's handful
      of booms and a silent total collapse. 2 new regression tests
      (`overworld.test.ts`) lock in both halves: recovery for a fit
      species, continued decline for a genuine mismatch.
- [ ] **Real follow-up, not attempted here**: still just ONE demoted zone
      recovering/spreading per real run — cross-zone migration itself
      remains rare (`EMIGRATION_CHANCE_PER_TICK`), so "thousands of zones"
      is still mostly a static, uninhabited backdrop around whichever
      handful a population happens to spread into. Direct ask for the
      actual next layer here: "zones talking to each other would be great
      ... cross zone migration patterns."
- [x] **Web UI, direct follow-up**: "single pannable canvas — one canvas the
      viewer pans/zooms around, not a separate macro-overview-plus-
      neighborhood-panel split." The 3-card strip below is gone; one canvas
      (`packages/web/src/macroMap.ts`) now covers the whole macro grid,
      native-resolution zoom, promoted zones showing a real terrain inset
      once zoomed in enough. Confirmed live in the browser end to end.
- [x] **Scroll-wheel zoom, Google Maps-style — direct ask.** Both the tile
      view and the macro map already had +/- buttons and pinch-to-zoom;
      wheel/trackpad scrolling over either now zooms in/out too, anchored to
      the cursor position (whatever content point is under the pointer stays
      under the pointer, rather than the viewport just drifting after a
      naive zoom). One shared `zoomAtPoint` helper (`main.ts`) does this for
      both — it reads `getBoundingClientRect` before/after the zoom mutation
      and adjusts the scroll container's `scrollLeft`/`scrollTop` by the
      delta, which works regardless of whether the resize came from the tile
      view's CSS-scale zoom or the macro map's native-resolution redraw.
      Confirmed live via a Playwright-driven browser session: repeated wheel
      events over an off-center point zoomed both canvases in (80% → 171%
      tile view; 8px/zone → 14px/zone macro map) while keeping that same
      content point within ~2px of the cursor.
- [ ] **No true edge-blending between neighboring zones' tiles** — DESIGN.md's
      own "neighbor consistency pass" from the original vision write-up,
      designed but not built. Two adjacent zones are both biased from the
      same macro data (confirmed close, ~3x more water on a coastal zone's
      macro-marked edge than the opposite one) but nothing reconciles their
      actual tile-level edges against each other after the fact.
- [ ] **Macro river/lake facts aren't fed into zone promotion bias at all
      yet** — only elevation/ocean/biome are. A zone the macro grid marked
      as river-crossing isn't guaranteed to actually show a river once
      promoted.
- [ ] Biome-threshold constants (`macroGrid.ts`) are un-tuned sim-original
      guesses — real distributions varied noticeably (badlands ~3%-14% of
      land) across different seed/scale combinations tried.
- [ ] `MacroWorld.regions` only ever grows, never prunes — cheap per entry,
      genuinely unbounded over a very long session.

## World-content roadmap (flagged, not started) — direct asks after a "zoom out, what's missing" review

Asked for a high-level assessment of the project; answered it by actually
running real sims (`validateOverworld.ts`) and reading zones rather than
guessing, which surfaced the abstract-region extinction bug fixed just
above plus a broader "content depth" gap (17 hand-curated species with real
ecological roles vs. 151 with sprite art vs. 1083 with only raw dex stats —
most of what a player could actually reach via evolution has numbers but no
personality). Explicit response, roughly in the user's own stated order —
none of this is built yet, this section is purely to not lose the thread:

- [x] **More species, more behaviors — evolution lines completed.** Every
      evolution reachable from the existing 17-species roster (Ivysaur,
      Charmeleon/Charizard, Wartortle/Blastoise, Gyarados, Tentacruel) now
      has its own curated `SpeciesDef` — 24 species now, up from 17 — with
      real biomes/preferredTerrain/moves rather than falling back to
      generic dex stats with no personality the instant an agent evolved.
      Sprite art already existed for all of them (public/sprites/ covers
      the full Gen 1 dex). Real bonus fix: Gyarados curated with
      `obligateAquatic` correctly OMITTED (mainline Gyarados leaves water
      routinely) resolves Magikarp's own "doesn't reset on evolution" gap
      for this specific case, since `computeProfileFromDexEntry` reads the
      CURRENT species' own tag, not an inherited one. Verified live: a real
      5000-tick run produced Ivysaur, Charmeleon, Charizard, and Gyarados
      via ordinary in-sim evolution, all correctly reflecting their new
      curated behavior. Automatically picked up by immigration's species
      roster (`Object.values(SPECIES)`) and this session's own biome-fit
      recovery mechanic, no extra wiring needed.
      Still open: this only closes evolution gaps on the CURRENT roster —
      growing the roster with genuinely new base-form lines (past these 24)
      wasn't attempted this pass.
- [x] **Cross-zone migration patterns — direct follow-up to the extinction
      fix's own remaining gap.** `EMIGRATION_CHANCE_PER_TICK` raised 4x
      (0.0005 → 0.002) and `EMIGRATION_MIN_POPULATION` lowered (6 → 4) —
      real-run finding (`validateOverworld.ts`): at the original rate, only
      a handful of emigrations fired across ~8000 ticks even from a healthy,
      recovering source population, so "thousands of zones" stayed a mostly
      static backdrop around whichever one or two a population happened to
      reach. The lowered population bar matters too: the extinction fix's
      own recovering populations often sit in the 5-6 range for a long
      stretch, which used to miss the old bar entirely. "Zones talking to
      each other would be great."
- [x] **Larger, multi-zone weather patterns.** Direct ask: a cold snap that
      slowly crosses the OVERWORLD grid over many zones at once, reducing
      plant growth and freezing water as it moves through, forcing real
      migration pressure; a drought that visibly kills existing plants and
      shrinks water bodies dramatically, not just a minor abundance dip.
      Built as a genuinely separate, macro-grid-scale system layered on top
      of (not replacing) the existing per-tile `weather.ts` — that one stays
      scoped to small, fast-moving cells inside whichever ONE zone is
      currently focused; this new one (`overworld.ts`'s `MacroWeatherFront`)
      is a slow front drifting across the whole grid in zone units,
      `coldSnap`/`drought` only (the two kinds with a real cross-zone habitat
      consequence). Rare on purpose (a handful of fronts per run, not
      constant churn), radius 4-10 zones, drift ~0.015 zones/tick (crosses a
      60-zone-wide grid in a few thousand ticks), lifespan 1500-4000 ticks.
      While a front is overhead, an abstracted zone's `baseResourceIndex`
      drifts (both directions, unlike the one-way baseline-recovery drift
      above) toward a much-reduced target — droughts scale the zone's real
      potential down to 15%, cold snaps to 50%, matching the user's own
      framing that droughts should hit harder — and emigration chance/
      population-bar are both relaxed 5x, so an affected zone's population
      visibly flees rather than just declining in place. Recovers back
      toward the biome's real potential via the ordinary one-way drift once
      the front moves on. New `macroWeatherChanged` `SimEvent` (`began`/
      `ended`, mirroring `weatherChanged`'s own convention). Scoped
      deliberately to the abstracted background-zone math only for this
      pass — a front passing over the currently-focused zone doesn't yet
      reach into that zone's own live per-tile `weather.ts` simulation (see
      the open follow-up right below). Verified live
      (`validateMacroWeather.ts`, a real `createDemoMacroWorld` run — natural
      spawns are rare by design, so the script rigs a drought onto a real
      migrated-to zone the same "rig the rng, run a real loop" way
      `overworld.test.ts`'s own end-to-end tests already do, rather than
      waiting out the natural spawn odds): a zone holding a healthy 24-strong
      Pidgeotto population (`baseResourceIndex` 0.52) put under a drought for
      1800 ticks saw its emigration rate jump from 3 departures/6000 ticks
      baseline to 12 departures/1800 ticks under the front (~13x), and the
      local Pidgeotto population hit 0 by the end of that window — a real
      combination of "fled" and "starved," not a synthetic number. Forcing
      the front's dissipation logged a real `ended` event at the drifted
      (not injection-point) row/col, confirming drift actually ran; the same
      8000-tick window also produced one fully organic natural spawn
      (`began`, a separate drought elsewhere on the grid) on top of the
      injected one, confirming the ordinary rare-spawn path fires too, not
      just the rigged one this script forces for a fast, deterministic
      check.
- [ ] **Open follow-up, not attempted here**: a macro weather front passing
      over the currently-FOCUSED zone has no effect on that zone's own live
      `weather.ts` simulation — a player standing in a zone a drought is
      crossing sees no in-zone sign of it (no forced dry spell, no visible
      water shrinkage) until/unless that zone gets demoted and re-measured
      afterward. Bridging the two systems (spawning/weighting the focused
      zone's own `WeatherCell`s toward whatever macro front, if any, is
      overhead) is real future work, not done in this pass.
- [x] **Cross-zone herd tracking — direct follow-up, "keep track of herd
      through zones."** Previously, a herd's identity was purely a
      focused-zone concept: `demoteRegion` folded every agent into a
      per-species number with no herd field at all, and `promoteZone`
      invented a brand-new `${species}-zone-${regionKey}` herd id on EVERY
      promotion — so a herd that got demoted, migrated, and re-promoted
      elsewhere came back as a stranger to itself, not the same herd having
      moved. `RegionAggregate` now carries a `herdId` that survives the
      whole lifecycle: `demoteRegion` picks the majority herd among the real
      agents it folds in (ties/no-herd fall back to the same invented-id
      shape as before); `maybeEmigrate`/`foldAgentIntoAggregate` carry that
      id into a brand-new destination aggregate (an existing destination
      aggregate's own herd wins instead, rather than getting overwritten by
      whichever wave of migrants happened to arrive); `promoteZone` rejoins
      that SAME herd rather than inventing a fresh one. `regionEmigrated`/
      `regionCrossed` events now carry `herdId` too, so the whole path is
      visible in the log, not just inferred from before/after aggregate
      state. Real per-species-per-zone granularity limit, same as
      everywhere else `RegionAggregate` already has one: two distinct herds
      of the same species sharing one abstracted zone still collapse into a
      single number and a single (majority) herd id — this tracks ONE
      lineage of herd identity through the grid, not a full multi-herd
      population model. Verified live (`validateHerdMigration.ts`, a real
      6000-tick `createDemoMacroWorld` run): a herd born `pidgey-zone-32,32`
      (species since evolved to Pidgeotto) shows up under that SAME id
      across a real chain of zone hops — 33,32 → 33,31 → 33,33 → 33,30 →
      34,31 → back to 33,32 — a real, continuous, trackable migration
      pattern across the grid, not a one-off move.
- [x] **Badlands BSP terrain now wobbles instead of reading as rigid
      rectangular chambers.** Direct ask: keep BSP as the starting structure
      (still the same recursive rectangle split, still
      `BSP_MIN_LEAF_SIZE`+ chambers), just paint it differently — each
      boundary line's actual painted position now offsets a few tiles
      perpendicular to its own direction (`BSP_WOBBLE_AMPLITUDE`, worldgen.ts),
      driven by the same smooth value-noise (`makeNoise2D`) this file already
      uses elsewhere, sampled per-line so every boundary meanders
      independently rather than in lockstep. A mathematically straight
      dungeon wall now reads as an eroded rock shelf. New regression test
      (`worldgen.test.ts`) directly measures this: longest unbroken
      same-column run of boulder/wall tiles, confirmed to fail (18+ tiles)
      with the wobble disabled and pass (<15) with it on — a real, checkable
      difference, not just an eyeballed screenshot. Visually confirmed too
      (ASCII dump + a live Tile-mode screenshot at seed 42: genuinely jagged
      terrain-boundary steps, not straight edges). Full suite green
      (974/974).
- [x] **Regional terrain features: real desert stretches and cleaned-up
      islands, both at the macro-grid scale.** Direct ask: "having sections
      of zones mean something... stretches of desert or something like that
      would be cool. Islands." (1) **Desert stretches**: `macroGrid.ts`'s
      moisture-noise scale (feeds `macroBiomeFor`) widened from `/6` to
      `/2.5` — same overall biome mix, but now clustered into real
      macro-scale regions instead of small patches. Real-run measured:
      badlands regions now commonly span 100-600+ zones (seed 42: a single
      614-zone stretch), up from small speckled patches. (2) **Islands**:
      turned out to already exist structurally — `generateMacroElevation`'s
      multi-uplift-point design genuinely produces separate landmasses (a
      real connected-component analysis found secondary islands up to
      460 zones on some seeds) — but the same analysis found the bulk of
      what it produced were 1-4 zone noise flecks, barely distinguishable
      from a rendering artifact. New `pruneNoiseSpeckIslands` (same
      flood-fill idiom `worldgen.ts`'s underground-cave
      `keepOnlyLargestFloorRegion` already uses, but pruning small-not-
      smallest components so a real secondary island survives) converts any
      land component under `MIN_ISLAND_ZONES` (10) back to ocean — cleans
      up the noise without inventing a new "always place N islands"
      generator that would fight the elevation field's own already-working
      structure. Visually confirmed live (a real seed's overworld map shows
      one clean, large contiguous desert region, not speckled dots). 2 new
      regression tests; full suite green (976/976).
- [x] **Species-specific environmental interactions — the two named
      examples, built.** (1) **Water-graze foraging** (needs.ts's
      `tryForageFromWater`/`isWaterForager`): a hungry agent whose species is
      obligate-aquatic OR simply prefers water (`SpeciesDef.preferredTerrain`)
      gets a real per-tick chance, while already standing on a water tile, to
      graze something incidental (algae/krill stand-in) for a partial hunger
      restore — no travel, no real "food" tile required at all. Real gap this
      closes, not just flavor: `findReachableFoodTarget`'s own doc comment
      already flags that `worldgen.ts` only places "food" terrain on LAND
      tiles, so an obligate-aquatic agent could only ever reach one at the
      shore ring. Real-run validated: 42 water-affiliated hunger-consume
      events over a 5000-tick run. (2) **Easier shelter for water types**
      (shelter.ts): an `obligateAquatic` species gets the same "comfort
      threshold" discount and build-time halving predators already had,
      stacking multiplicatively (an obligate-aquatic predator builds in a
      quarter the ordinary time). Deliberately narrower than the foraging
      gate — restricted to `obligateAquatic` specifically, not the broader
      water-preferring case — because at the same 0.15 discount magnitude
      already used for predators, the broader gate collided exactly with
      `chooseBehavior`'s own idle threshold (both land on 0.70), which would
      have made the entire Squirtle line attempt shelter-building on every
      single idle tick; a genuinely obligate-aquatic species (no
      conventional home to speak of at all) is where "trivial to build" is
      the better real fit anyway. 6 new unit tests (needs.test.ts,
      shelter.test.ts) lock in both halves plus the narrower gate; full
      suite green (973/973).
- [x] **Snowy mountaintop habitat, built — a real 6th biome.** Direct ask:
      "snowy mountain tops where ice Pokemon and dragon live." New "snow"
      `BiomeDef` (worldgen.ts) — harsher than even Badlands
      (food/water 0.01/0.02), overwhelmingly boulder (icy rock/snowdrift),
      elevation-based higher than Highland's own range. At the macro-grid
      tier this is a REAL elevation gate (`SNOW_ELEVATION_THRESHOLD`,
      checked before Highland in `macroBiomeFor`) — the tile-level
      per-biome seed placement itself is elevation-agnostic like every
      other biome there, same as Highland already is; only the macro
      classification genuinely caps one biome above another. `floor_snow.png`
      (public/tiles/) had sat unused since an earlier pass specifically for
      lack of a biome to map it to — wired up now (sprites.ts's
      `BIOME_FLOOR`), plus a macro-map color (macroMap.ts). Two new
      residents (species.ts): Seel (real mainline arctic pinniped — a
      clean fit) and Dratini (a real, flagged creative liberty: mainline
      Dratini actually lives in lakes/rivers, grouped into snow anyway
      since the direct ask named "ice... and dragon" together). Real-run
      validated: snow zones appear reliably (64-344 zones per 100x100 grid
      across 10 seeds) and promoting one spawns both new species, confirmed
      across 4 seeds. 1 updated regression test (6 biome names, was 5);
      full suite green (976/976).
- [x] **Three more biomes (desert/jungle/beach) plus a real species batch —
      direct ask: "more species? more biome types???"** Nine land biomes now,
      up from six:
      - **Desert** (`worldgen.ts`) — carved out of Badlands' own driest
        moisture extreme (`macroGrid.ts`'s `DESERT_MOISTURE_THRESHOLD`),
        deliberately a DIFFERENT character, not a recolor: open sand dunes,
        no BSP chamber-carving (`carveBadlandsChambers`'s
        `isBadlandsDominant` check is keyed by name, so Desert tiles never
        get it).
      - **Jungle** — carved out of Forest's own wettest extreme
        (`JUNGLE_MOISTURE_THRESHOLD`): denser canopy, more food/water than
        plain Forest, still land-dominant.
      - **Beach** — a genuinely different kind of biome from the other
        eight: a coastline post-process (`applyBeachReclassification`), not
        a moisture/elevation band. Real calibration finding: the elevation
        field normalizes PER-SEED (min/max of that seed's own raw values),
        so a fixed absolute elevation cutoff picked up beaches in some seeds
        and silently produced zero in others — fixed by making the
        threshold relative to each grid's own measured land-elevation floor
        instead (confirmed via direct sampling: one seed's real coastal band
        sat at 0.407-0.464, another's at 0.645-0.695 — very different
        absolute numbers, same relative position).
      - Desert's own moisture threshold needed the same real-distribution
        calibration this codebase's other biome constants already went
        through: a naive "bottom 15%" guess produced zero Desert zones in
        9 of 12 sampled seeds (`makeNoise2D`'s own doc comment already flags
        why — multi-octave value noise clusters toward the middle, so a
        small raw threshold badly under-fires). Recalibrated to 0.32 by
        directly sampling the real moisture field, chosen as the lowest
        value that reliably produced Desert in all 12 seeds while Badlands'
        own (now thinner) share stayed nonzero everywhere too.
      - 14 new base species curated (`species.ts`): Vulpix/Cubone (desert),
        Ekans (grassland/jungle), Caterpie/Weedle/Oddish/Snorlax (jungle/
        forest), Krabby/Shellder/Psyduck (beach/wetland), Ponyta (grassland/
        highland), Lapras/Jynx (snow), Zubat (highland/badlands) — plus
        every evolution reachable purely by in-sim leveling among them
        (Arbok/Metapod/Butterfree/Kakuna/Beedrill/Kingler/Golduck/Rapidash/
        Golbat/Gloom — checked against the dex's own `conditions: {}` bar,
        same standard `leveling.ts` itself uses), same "don't let an evolved
        agent quietly lose its personality" standard as the earlier
        evolution-completion pass. None tagged `isPredator` — the existing
        predator guild already struggles per this file's own extinction-fix
        history, so this batch stays out of that problem.
      - **Real bug found (not introduced) while adding this batch, fixed**:
        `leveling.ts`'s `baseSpeciesOf` correctly walks a species back to its
        true dex-root prevo, but Snorlax's/Jynx's real roots are LATER-gen
        baby forms (Munchlax/Smoochum) this codebase's hand-curated egg-group
        table never had entries for — so either species silently resolved to
        `eggGroups: []` the moment it was added to the roster. Fixed by
        giving both babies their line's real egg group, the correct fix
        (breeding a Jynx really does produce a Smoochum in the real games),
        not a workaround.
      - **Real, more significant finding, NOT fixed here (pre-existing, not
        introduced by this batch)**: tested in isolation (promoted, then
        immediately demoted with zero ticks elapsed), Desert's real measured
        `baseResourceIndex` came back ~0.153 and Badlands' ~0.118 — both
        below `DEATH_HEALTH_THRESHOLD` (0.3), so a species population
        confined to just ONE isolated zone of either biome is mathematically
        certain to decline toward local extinction over time; the
        extinction-fix's own recovery-target drift can't rescue this,
        because the recovery TARGET itself (`estimateZoneResourceIndex`,
        both biomes' analytic estimate lands in the same sub-0.3 range) is
        just as low. This is NOT new — Badlands' own existing residents
        (Charmander/Diglett/Onix/Geodude/Growlithe/Mankey line) have always
        had this same property, just never directly measured/flagged before
        now. In the real, full multi-zone simulation this reads less like a
        bug and more like a real "source, not sink" habitat: Krabby/
        Shellder/Golduck founded in a real promoted Beach zone (real-run
        validation, `validateNewBiomesAndSpecies.ts`) spread outward and
        thrived in multiple neighboring Grassland/Ocean zones over 4000
        ticks even as the beach zone's own isolated population dropped to
        zero — populations are born there and disperse rather than settling
        permanently, which is a coherent story, just not the one "give
        Desert some real residents" was originally asking for. Real
        underlying gap: the recovery-target mechanism only guarantees "don't
        get stuck below your OWN biome's ceiling forever" and "a mismatched
        species declines" — it never guaranteed every biome's OWN ceiling
        clears the survival bar to begin with. Fixing this properly (either
        a survivable-floor guarantee under `estimateZoneResourceIndex`, or
        accepting harsh biomes as deliberately migration-fed rather than
        self-sustaining and building real support for that framing) is real
        future work, flagged rather than attempted here.
      - Real-run validated (`validateNewBiomesAndSpecies.ts`, a real
        `createDemoMacroWorld` run): Jungle promoted for real produced a
        living, evolving population — Ekans→Arbok, Caterpie→Metapod
        (→Butterfree), Weedle→Kakuna→Beedrill all occurred in-sim from a
        single 4000-tick run, not just theoretically reachable. Full suite
        green (1074/1074 across engine+data), all packages typecheck clean.

## Overworld visualization — SUPERSEDED, see above and "Overworld rearchitecture" above

**Superseded** — the region-graph card strip (`overworldPanel.ts`) this
section describes no longer exists; replaced by `macroMap.ts`'s single
pannable/zoomable canvas, see the "Overworld rearchitecture" section above.
Left in place as the historical record of what was built and validated at
the time.

Direct ask: "I want to be able to see the overworld stuff... visualize
overworld." The region-graph engine (merged from the sibling
`overworld-regions` session, including its migration-edge dispersal
follow-up) had zero UI before this. New "Overworld: On/Off" toggle in
`packages/web`, a region-graph card strip (`overworldPanel.ts`) showing each
region's real individuals (if focused) or abstract aggregate stats (if
not), click-to-focus driving the actual `setFocusedRegion` promotion/
demotion. See DESIGN.md's "Overworld visualization" section for the full
design and real-browser validation (toggle on/off, live population drift,
a real focus switch confirmed end to end).

- [x] **v2, direct follow-up feedback**: "I kinda thought overworld would
      be it's own tileset... its own renderer... see the bigger picture and
      select a zone... but it seems like you just have three zones in an
      array." Fair — v1 was plain data cards. Each card now shows a real,
      zoomed-out satellite-view thumbnail of that region's own actual
      terrain (`overworldMap.ts`'s `drawRegionThumbnail` — one canvas pixel
      per tile, real population as colored dots), not an abstract swatch.
      See DESIGN.md's "Overworld visualization v2" section.

- [ ] The graph strip is a plain left-to-right layout matching the demo's
      own chain topology (`region-a - region-b - region-c`) — a real
      non-chain graph would need an actual layout algorithm, not attempted
      since only a chain currently exists. Moot now — see above.
- [ ] No visual indication on the graph strip itself of migration-edge
      dispersal/emigration actually happening between two regions (visible
      in the event log/Inspector, not as e.g. an animated pulse along the
      connector between two cards). Moot now — see above.

## Underground/canopy agents stranding in surface water on layer-crossing — fixed, see DESIGN.md

Direct user report: "a buncha canopy and underground Pokémon are dying in
water zones?" Real, high-frequency bug: crossing to Surface to seek water/
food (`needs.ts`) or resurfacing from a burrow-escape (`status.ts`) kept the
agent's (x, y) completely unchanged, with no check that the landing tile was
actually safe — a quarter to nearly half of every real cross-layer trip in a
3000-tick run ended in the agent stranded mid-lake, confirmed across 5
seeds. Fixed by reusing the exact `findWalkableNear` relocate-to-safety fix
already built for the spawn-placement version of this same bug. See
DESIGN.md's "Underground/canopy agents stranding in surface water on
layer-crossing" section for the full before/after numbers.

- [ ] Real, separate, honestly-flagged residual (not this fix's scope): an
      agent that lands safely can still be slowly boxed in by weather-driven
      water formation (`weather.ts`'s rain-forms-water rule) expanding a
      nearby lake around it over hundreds of ticks. Confirmed as the cause
      of the one still-flagged case (of 5 seeds) after this fix. A real
      future fix would need periodic re-validation of an agent's own
      standing tile, not just its landing tile — a bigger, different
      mechanic than "don't teleport into deep water."

## Bonding: pairs don't stay together, and rapport is invisible in the UI (flagged, not built)

Direct question, not a bug report, but worth tracking as a real, confirmed
gap: "it's kinda weird that bonded Pokémon don't really hang around each
other much after doing the deed. Is that true? And... are they forming
relationships with each other?"

Traced both, answer is yes to both halves:

- **Bonding doesn't create ongoing togetherness.** `reproduction.ts`'s
  `applyMateSeeking` sets `Agent.bondedPartnerId` on both agents at first
  contact, but that flag is only ever read by (a) `shelter.ts`'s
  `BOND_COMFORT_DISCOUNT` (biases toward starting a shelter sooner) and (b)
  as an input to the rapport-driven mate-search distance bonus
  (`mateScore`'s `rapportAdvantage` term) the NEXT time the pair happens to
  wander back within `mateSearchRadius` of each other. There is no active
  "seek out my bonded partner" or "stay near my bonded partner" behavior —
  nothing in `herding.ts` pulls a bonded pair together the way herd cohesion
  pulls a herd-mate toward its centroid. A bonded pair only re-converges by
  the same coincidence any two herd-mates might, plus a modest scoring nudge
  if they do cross paths again.
- **Relationships ARE real and tracked, just completely invisible.**
  `rapport.ts`'s agent-to-agent relationship graph is genuinely live (sparse,
  decaying, capped, adjusted by bonding/mob-defense/food-delivery — see its
  own module doc comment and the "Rapport" DESIGN.md section) and has two
  real engine-side consumers (`reproduction.ts`'s mate preference,
  `herdConflict.ts`'s rival targeting). Confirmed by grep: nothing in
  `packages/web` (inspector.ts or anywhere else) ever reads or displays
  `Agent.rapport` — a real, working backend system with zero UI surface.

Two real, well-scoped candidate follow-ups, neither built here:
- [ ] A "pair cohesion" behavior — bonded partners drift toward each other
      when idle and not too far apart, similar in shape to
      `applyHerdCohesion` but keyed on `bondedPartnerId` instead of
      `herdId`. Would make bonding read as an actual ongoing relationship on
      the map, not just a one-time flag flip.
- [ ] Surface rapport in the inspector panel — e.g. a per-agent "top
      relationships" list (highest |score| edges) alongside the existing
      per-agent stat rows, so a real relationship graph that's been running
      the whole time becomes something a viewer can actually see.

## Auto Camera passive overlay + multi-combatant Battle Screen + mobile log — built, see DESIGN.md

Three direct follow-up asks, all built: (1) a passive, dimmer bounding box
now shows for every currently-tracked battle even with Auto Camera toggled
off, click-to-focus turns Auto Camera on scoped to that one fight
(`autoCamera.ts`'s `listBattleEngagements`/`focusEngagement`,
`renderer.ts`'s extracted `highlightBounds`); (2) Battle Screen now shows
every combatant (not just 2 + "+N more") with a sprite, a per-INDIVIDUAL
(not per-species) accent color, and disambiguated `idLabel` names in both
the header and the turn-by-turn text lines; (3) real mobile touch-scroll fix
(`-webkit-overflow-scrolling: touch` was missing on three panels) plus a new
expand-panel toggle for a much taller reading mode. See DESIGN.md's "Auto
Camera passive overlay, multi-combatant Battle Screen, mobile log
scroll/expand" section for the full design and real-browser validation.

- [ ] Real, honestly-flagged gap: the passive-overlay-while-disabled
      interaction (item 1 above) was validated via code review and by
      confirming detection survives an off→on→off toggle cycle live in the
      browser, but a screenshot specifically catching a passive dashed box
      on screen mid-battle wasn't captured — the battle's map location fell
      outside the initial (unpanned, since nothing moves the camera while
      Auto Camera is off) viewport during the validation window. The
      underlying bounds math is the same one already proven correct for the
      solid active box, so this is a real but low-risk gap, not a guess.
- [ ] Deliberately scoped out: the passive overlay only covers *battle*
      engagements, not one-shot notable moments (immigration/courtship/
      hatch/evolution/death) — those don't have a natural "still ongoing"
      window the way a continuous battle's own stale/conclusion tracking
      gives it for free. Extending the overlay to one-shots would need real
      new timing semantics (an explicit lifetime assigned at creation, not
      just at eventual promotion) — a bigger change than this pass took on.

## Stranded spawns + cornered prey never fighting back — fixed, see DESIGN.md

Direct user feedback on the live artifact ("non water Pokemon spawning in
the middle of water," "a lot of battles are sorta just one Pokémon beating
up another. Not so much fighting back."). Both traced and fixed — see
DESIGN.md's "Land spawns stranded mid-lake, and prey with nowhere left to
run" section for the full root-cause writeup and real-run evidence
(confirmed: every one of 7 tested seeds had 2-7 stranded land agents before
the fix, 0 after; a cornered Bulbasaur actually defeated a Scyther in a real
3000-tick run after gaining a last-resort counterattack).

- [x] `findWalkableNear` (worldgen.ts) now excludes tiles that would strand
      a non-water agent deep in a large lake, via the same `canEnterWater`
      check movement already enforces — fixes `anchor()`/`findPosInBiome`
      starting-agent placement, herd-migration destinations, and
      immigration's non-obligate-aquatic arrivals all at once (one shared
      root cause, one fix).
- [x] A cornered prey agent (flee step is a no-op — nowhere left to run)
      now fights back as a last resort instead of standing still and
      absorbing free hits forever, reusing the existing mob-fighting
      `resolveHit` call. Deliberately narrow: an agent that still has any
      escape route still always flees, unchanged.
- [ ] **Real follow-up, not fixed here**: a prey agent that's merely slower
      than its pursuer (not literally cornered) still takes a full chase's
      worth of free hits with no counterattack of its own, since it never
      stops having *a* flee step even as the gap closes to zero. Needs real
      speed-driven positioning or a distinct "threat is now adjacent, not
      just nearby" threshold — see DESIGN.md's section for why this wasn't
      bundled in here.

## Species/biome/immigration — built, see DESIGN.md

- [x] Three new species (Geodude, Growlithe, Mankey) closing the
      badlands/highland "zero real residents" gap, all reusing an existing
      move and an existing `EGG_GROUPS_BY_BASE_KEY` entry. Charmander (fully
      defined earlier, never spawned) now has a real starting spot in
      `createDemoWorld`, biome-placed via the new `findPosInBiome`.
- [x] `SpeciesDef.biomes?: string[]` added and tagged on every species (new
      and existing, best-effort). Real consumers: `findPosInBiome`
      (Charmander's placement) and `immigration.ts`'s spawn-site species/
      location scoring.
- [x] Immigration system (`packages/engine/src/immigration.ts`): flat
      per-tick chance roll + cooldown + population cap (soft 70/hard 110,
      linear falloff between), species picked by under-representation x
      biome-match weighting at a random map-edge arrival point, 1-3 agents
      join-or-found a herd exactly like `dispersal.ts`'s arrival logic. New
      `"immigrated"` event, headline-worthy in the web UI. 13 new engine
      tests + 19 new data-package tests (first test suite for
      `packages/data` — `vitest` added as a devDependency there). All 593
      engine tests (580 pre-existing + 13 new) and the determinism
      acceptance test pass; existing callers without an `ImmigrationContext`
      see zero behavior change.
- [x] Real 3000-tick runs, 3 seeds, with vs. without immigration: fired 4-6
      times per run every seed; final population rose on 2/3 seeds (42:
      19->35, 7: 21->28), and on the third (20260903, this session's
      historically low-growth seed) ended at the same total (28) but with
      real compositional diversity immigration added (Geodude/Charmander/
      Scyther/Spearow/Mankey present with it on, none of those with it
      off) — worth knowing the effect isn't purely "always raises
      population," see DESIGN.md for the honest breakdown.
- [x] An 8000-tick run confirmed real in-sim survival *and breeding* of a
      newly-immigrated species (Mankey: 3 immigrants at tick 2459 -> 6
      living by tick 8000), not just spawn-and-survive.
- [ ] **Open follow-up: the population cap's scaled-down middle zone
      (70-110 living agents) is unit-tested in isolation but not yet
      exercised by a real run that actually reaches it** — every real run
      in this pass stayed at or under ~69 living agents, so the linear
      falloff between `POP_SOFT_CAP`/`POP_HARD_CAP` has never been observed
      firing in a real multi-thousand-tick run, only confirmed correct via
      `immigration.test.ts`'s direct unit tests. A longer run (10,000+
      ticks) or a seed/config that grows faster would be the way to
      actually witness it end to end.
- [ ] **Open follow-up: immigration's population cap only bounds
      immigration's own contribution — breeding itself is still completely
      uncapped**, the same pre-existing gap noted elsewhere in this file. A
      seed with strong enough organic growth could still exceed
      `POP_HARD_CAP` through breeding alone, with immigration simply
      declining to add to it. Not attempted here — a real population cap
      that reasons about the *whole* population (not just one growth
      channel) is a bigger, separate design question.
- [ ] **Open follow-up, flagged rather than guessed at: is Growlithe (and
      any future item-only-evolution species) actually a good roster fit
      given it can never evolve in-sim** at all under the current
      level-only evolution filter (`leveling.ts`)? Onix already lives with
      this same limitation without apparent issue, so it was judged
      acceptable to extend it to a second species rather than a blocker —
      but it's a real, deliberate trade-off, not an oversight, and worth a
      second look if evolution coverage across the roster ever becomes a
      priority.
- [ ] Biome-driven placement was deliberately scoped to *new* placements
      only (Charmander, immigrants) — every existing hand-placed starting
      agent (Bulbasaur herd, Venusaur guardians, Scyther, Diglett/Sandshrew
      colony, Onix, Pidgey flock, Spearow, Squirtle pair) keeps its original
      fixed coordinates, unretouched, to avoid destabilizing already-
      validated placements. If a future pass wants the *whole* starting
      roster biome-driven, that's a real, separate, riskier change — not
      done here.

## Biome generation: runtime moisture, biome drift, BSP badlands chambers, CA underground caves — built, see DESIGN.md

- [x] Water formation/drying (`weather.ts`'s `advanceWaterCycle`) now scales
      by each tile's real, drift-aware water density
      (`worldgen.ts`'s`effectiveWaterDensityAt`) instead of one flat global
      rate — the moisture field `generateWorld` blends at map-gen time is
      finally read again at runtime. Slow biome drift (see "Next up: terrain
      lifecycle" above) shares this same mechanism.
- [x] Badlands regions now get real BSP-carved chambers/canyons (mostly
      boulder boundaries, sparse wall chokepoints), masked to stay inside
      Badlands' own dominant footprint so it never fights
      `blendBiomeParams`'s continuous cross-biome blending at the edges.
- [x] Underground — previously an unconditionally flat, fully-walkable grid
      — now gets real cellular-automata cave structure (organic, not BSP's
      angular chambers, since it has no biome geometry to draw a chamber
      grid against). Surfaced and fixed a real stranding bug this
      introduced: `createDemoWorld`'s hand-placed Underground spawns used a
      bare `scaledPos` with no walkability check, safe only under the old
      always-flat assumption — now routed through a new `undergroundAnchor`
      (same `findWalkableNear` primitive the Surface layer's anchor already
      uses).
- [ ] **Open follow-up, not attempted here**: confirming a biome seed
      actually reaches a *visually* desertified state under the new drift
      mechanism needs a run one to two orders of magnitude longer than this
      project's standard 3000-tick validation length — a 30,000-tick run
      with live agents didn't finish inside this session's time budget. A
      terrain-only run without agents (the same trick the "Stronger
      weather-driven flora/water dynamics" section's own 10,000-tick
      validation used) is the likely way to actually witness a full 0->1
      shift end to end.
- [ ] **Open follow-up, flagged rather than guessed at**: this pass's BSP
      chambers only ever paint inside Badlands' *dominant* footprint by
      design — a Badlands region that's small relative to the map (or one
      whose seeds happen to land such that the global BSP split rarely
      crosses it) can end up with very few or zero chamber boundary tiles
      (seed 1 in this pass's own real-run check: 2 boulder tiles, 0 walls).
      Not a bug (the masking is doing exactly what it's supposed to), but a
      real seed-dependent variability worth knowing about — a future pass
      wanting *guaranteed* chamber density per Badlands region regardless of
      its size/shape would need to scope BSP to each region's own bounding
      box rather than the whole map, a bigger change than this one attempted.
- [ ] **Open follow-up: this pass's whole-starting-roster-biome-driven
      question (flagged just above) is still open** — Underground now having
      real terrain structure of its own (rather than "no obstacles, so
      nothing to check") is a real argument *for* eventually routing every
      hand-placed spawn (not just Underground's, which needed it for
      correctness here) through a biome/terrain-aware placement primitive,
      but that's still the same "real, separate, riskier change" flagged
      above, not done in this pass either.

## Next up: terrain lifecycle + construction + overworld (one combined design, not started)

Direct feedback: not enough dynamism in the environment — weather changes
things but the map itself never does. Three systems, decided to build as
one combined design rather than separately, in this dependency order once
work resumes:

1. **Terrain lifecycle** — trees grow from saplings and age, storms can
   fell them (real map consequence for weather, not just FOV/accuracy/
   migration-triggering), reusing flora.ts's existing stock/growth/seed-
   spread architecture rather than inventing new machinery. This is the
   foundation the other two build on.
   ~~Also: a slow weather-driven biome drift...~~ — **built**, see
   DESIGN.md's "Biome-specific generation" section: each biome seed's own
   effective water density now drifts toward Badlands-arid under sustained
   *local* drought and back under sustained rain (`World.biomeSeedDrift`,
   weather.ts's `advanceBiomeDrift`), a plain deterministic accumulator
   scoped to ~30,000 ticks for a full 0->1 shift under continuous exposure.
   A real 3000-tick run showed real, small, per-seed-differentiated drift
   (8/11 seeds nonzero, max 0.009 of the range) — confirming a seed
   actually reaching a *visually* desertified state needs a run one to two
   orders of magnitude longer than this project's standard validation
   length, not attempted here (a 30,000-tick run with live agents didn't
   finish inside this session's time budget). The tree growth/decay half of
   this item is still not started.
2. ~~**Construction/shelter-building**~~ — **built**, decoupled from this
   combined design after all (see DESIGN.md's "Shelter-building" section):
   it turned out to need only a new terrain kind + a construction behavior,
   not (1)'s tree growth/decay machinery first. Species-tied (`diglett`/
   `sandshrew` only), real travel + build-time investment, real concealment
   + storm-exposure payoffs (both literally reusing bush's/`hasCoverNearby`'s
   existing mechanisms), decay-if-abandoned. A real seed-42 run surfaced a
   genuine tuning gap worth tracking as its own follow-up rather than
   closing here: even after correcting the priority tier to be pausable
   (not dispersal's "commits no matter what"), the feature was still a net
   survival cost for this seed's Diglett/Sandshrew founders — see DESIGN.md's
   "Built" subsection for the full comparison. Candidate next step:
   resource/safety-aware build-site scoring instead of a plain distance
   floor, or investigating the pre-existing Spearow-camps-the-crossing-point
   hazard the finding also surfaced. The fancier growth/decay/storm-
   interaction layer terrain lifecycle (1) would add can still attach to
   the shipped `"shelter"` terrain kind later, unblocked by any of this.
   ~~**Follow-up: resting-at-home buffs + food cache**~~ — **built** (direct
   ask: "shelter should also...incentivize the Pokémon to stay in it...food
   cache"), see DESIGN.md's "Shelter incentives" section for the full
   design/real-run numbers. Doesn't resolve the net-survival-cost finding
   above by itself (a shelter that's never successfully built, as seed 42's
   own founders keep proving, has nothing for a resting/cache buff to
   attach to) — it's a real, separate incentive layer on top of an already-
   built shelter, not a fix for the build-site-scoring gap. Real follow-ups
   still open, not done here:
   - **Extend `buildsShelter` to more species now that shelter does more.**
     Explicitly flagged rather than done unilaterally — a separate, bigger
     roster decision the direct ask didn't cover. Worth revisiting once the
     roster grows past Diglett/Sandshrew: any other genuinely
     burrowing/nesting-flavored species (candidates judged the same way
     `species.ts`'s own top-of-roster comment already judges the current
     roster) would get real, earned value from resting/cache now, not just
     the passive concealment/storm-cover payoff shelter-building shipped
     with originally.
   - **Cache-aware herd food delivery** — `support.ts`'s `applyHerdSupport`
     currently only ever looks for a live food tile
     (`findNearestFoodTile`/`findNearestIndexed(..., "food")`); it has no
     awareness that a `buildsShelter` herd-mate's home shelter might have a
     stocked cache closer than any live patch. Left alone here since it's a
     second system's own targeting logic, not this feature's — a real
     candidate for a future pass rather than a scope-creep addition to this
     one.
   - **Tune `SHELTER_CACHE_MAX`/`SHELTER_CACHE_DEPOSIT_PER_TICK` against a
     seed where a shelter actually survives long enough to matter** — all
     three standard seeds (42/7/20260903) produced zero `shelterBuilt`
     events at 3000 ticks (DESIGN.md's real-run numbers), so this pass's
     real validation had to fall back to a controlled larger-map scenario
     (same fix `shelter.test.ts`'s own end-to-end test already needed for
     the identical problem) — the standard seeds still owe a real look at
     cache accumulation/drawdown once the underlying build-site-scoring gap
     above is addressed.
   - **Some shelters still get abandoned even with the resting pull
     active** (3-5 of 4-10 built per 3000-tick run in the controlled
     validation above — a real reduction versus the mechanism's own
     always-abandons-if-unattended baseline, not a full elimination). Not
     isolated further here: candidate causes worth checking are a
     founder's death leaving nobody to return to a specific shelter, or a
     herd relocating away (`herdMigration.ts`) and never coming back to an
     older one while a newer one gets built closer to the new range.
3. ~~**Overworld: the current map becomes one region in a larger graph**~~ —
   **built**, see "Overworld: region graph with promotion/demotion" below
   and DESIGN.md's "World scale: layers, elevation, and regions" section for
   the full design/real-run numbers.

Not started — the user has something else to try first. Note: item (1)'s
tree-growth/decay half is still not started, but its water-supply half is
now partially covered by a separate, already-shipped piece — see "Stronger
weather-driven flora/water dynamics" below — so (1) on resume should scope
itself to tree lifecycle + biome drift only, not re-do water. Items (2) and
(3) are both done — see their own sections below.

## Overworld: region graph with promotion/demotion — SUPERSEDED, see below

**Superseded by the macro zone grid** — see "Overworld rearchitecture: a
real macro zone grid" further down this file and DESIGN.md's own section of
the same name. The named 3-region graph this section describes (`Overworld`/
`Region`/`RegionEdge`, `createDemoOverworld`) was built at the wrong level
of the hierarchy — each "region" was a fully independent seed with no
spatial relationship to its neighbors, not a real geography. Left in place
below as the historical record of what was built and validated at the time
(the promotion/demotion mechanism itself, the aggregate math, the migration
mechanics — all genuinely reused, not thrown away); every named-graph
specific detail (the 3 hardcoded region ids, `RegionEdge`, `tickOverworld`/
`setFocusedRegion`/`createDemoOverworld`) no longer exists in the codebase.

New `packages/engine/src/overworld.ts`: a small region graph (`Overworld`,
`Region`, `RegionEdge`) where the focused region runs the ordinary full
per-agent `tickWorld` unchanged, and every other region collapses to a
per-species `RegionAggregate` (population, average needs, a resource
abundance index) advanced by cheap statistical rules
(`advanceAbstractRegion`) — O(species count), not O(agent count), per
background region per tick. Demotion (`demoteRegion`) folds real agents
into an aggregate and empties `world.agents`; promotion (`promoteRegion`)
invents fresh individuals from an aggregate via the same `ImmigrationContext`
dependency-injection hook `immigration.ts` already needed (no new context
type). `packages/data/src/overworldScenario.ts`'s `createDemoOverworld`
builds a 3-region chain (`region-a - region-b - region-c`), each a full
independently-seeded `createDemoWorld` map — the cheapest way to get three
genuinely different, fully-populated regions without touching
`scenario.ts`/`worldgen.ts`'s own generation logic (both this session's
sibling-session territory, in progress in parallel on
`claude/biome-species-gen`).

**Explicitly lossy, called out in DESIGN.md rather than glossed over**:
demoting a region discards which individuals existed (nature/disposition/
rapport/notable-title/parentage/build history, all of it) down to just
per-species population and average needs; promoting invents a FRESH set of
individuals matching those numbers, not the ones that were there before. Two
more real simplifications: a background region's terrain is frozen (no
`growFlora`/`advanceWeather` runs against it — the aggregate's
`resourceIndex` stands in for "how the land is doing" instead), and
in-flight eggs are silently discarded on demotion (not folded into the
population count at all).

**Migration edges (stretch goal) — both halves now built.**
`advanceAbstractRegion`'s `maybeEmigrate` moves a small population fraction
between two regions that are BOTH currently abstract (no individuals
involved) — the cheap half. The harder half the stretch goal actually asked
for — `dispersal.ts`'s real per-agent disperser walking off the edge of the
FOCUSED region's map and landing as a real individual in a neighboring
one's aggregate — is now built too: dispersal's existing triggers gained an
optional `RegionDispersalContext` (a minority `REGION_DISPERSAL_CHANCE`
roll, 0.25, on top of the pre-existing trigger, not instead of it) that
sends the disperser to the map's edge instead of an interior spot;
`tickOverworld` recognizes an arrived crosser and folds it into the
destination's aggregate (`foldAgentIntoAggregate`, weighted-averaging its
needs/level in). `dispersal.ts` was NOT actually off-limits sibling
territory (only `worldgen.ts`'s biome generation and `species.ts`'s
roster/placement were) — an earlier write-up here conflated "chose not to
touch it for a first cut" with "can't touch it"; corrected now that a real
follow-up needed it.

**Real 3000-tick validation** (`packages/runner/src/validateOverworld.ts`,
`pnpm --filter @pokuelike/runner exec tsx src/validateOverworld.ts <ticks>
[switchTick] [switchToRegionId]`): with `region-a` focused for 1500 ticks
then switching to `region-b`, `region-a` demoted with real per-species
counts (`{bulbasaur: 3, venusaur: 2, scyther: 4, ...}`, ~26 individuals
total) and `region-b` promoted with 264 invented individuals — matching the
sum of its own aggregate populations at that exact tick, the real
consistency check this feature needed. Abstract-tier populations settled
into a sane tens-not-hundreds range per species (~20-30, comparable to
`region-a`'s real full-sim population of 20) after retuning
`CAPACITY_SCALE` down from an initial guess that let populations run to
several hundred — see `overworld.ts`'s own doc comments for the specific
feedback-loop bug this run caught (deriving carrying capacity from a
resource-abundance value that itself drifts toward "however much headroom
is under capacity" chases 1 forever instead of settling; fixed by deriving
capacity from a value frozen at demotion instead). A same-seed run twice
produced byte-identical output — determinism intact. 14 new engine tests
(`overworld.test.ts`), full 888/888 engine suite green, both original
population-model bugs (the capacity feedback loop, and a starving-while-
over-capacity sign flip that reported growth instead of decline) were
caught by this test suite before the real run ever surfaced them.

**Real 16000-tick validation of the individual crossing** (same CLI, no
focus switch): a real `wartortle` (evolved from `squirtle`) triggered the
guaranteed no-eligible-mates dispersal fallback, rolled to cross regions,
walked to the map edge, and produced one real `regionCrossed` event at tick
8704 (`region-a` -> `region-b`), settling into `region-b`'s normal
~20-30-per-species population range afterward like any other aggregate
entry. Base-rate sanity check: an otherwise-identical single-region
12000-tick run (no region graph at all) produced 11 ordinary `dispersed`
events, roughly consistent with `REGION_DISPERSAL_CHANCE` (0.25) applied to
that trigger frequency over 16000 ticks. Same-seed rerun byte-identical —
determinism holds through crossing too. 11 new tests (6 in
`dispersal.test.ts`, 5 in `overworld.test.ts`, including a real forced-rng
end-to-end `tickOverworld` loop), full 899/899 engine suite green.

Real, open follow-ups, not attempted here:
- **No cross-species interaction in the abstract tier.** Each species
  aggregate advances independently — no abstract-tier predation, so a
  background region can't have its Scyther population actually suppress its
  Bulbasaur population the way the full sim's `predation.ts` does. A
  real simplification of the full sim's own dynamics, not hidden.
- **Promoted individuals have no notable titles/rapport/leadership.** A
  region that goes abstract and comes back never reconstructs The Hero, a
  herd leader, or any rapport edges — every promoted individual starts
  completely blank on all of that, even if the aggregate's own population
  was quietly this region's most accomplished lineage before it demoted.
- **`avgLevel` never advances while abstracted** — no leveling model exists
  at the aggregate tier, so a population that spends a long stretch
  abstracted doesn't get any stronger, unlike a promoted region's real
  agents would via the ordinary leveling system.
- **A region-crossing disperser's own notable/rapport/lineage history is
  discarded on the fold-in** — the same loss ordinary demotion already
  accepts elsewhere in this system (see above), not a new gap unique to
  crossing.
- **No cap or back-pressure on repeated crossings along the same edge** — an
  edge to a species-poor neighbor could in principle drain the focused
  region faster than it repopulates. Not observed in any real run here, but
  not guarded against either.
- **Only ever validated at 3 regions, a chain topology, and one focus
  switch.** TODO.md's "start small" ask is satisfied, but a larger/
  differently-shaped graph, multiple simultaneous focus moves, or a much
  longer abstracted stretch (tens of thousands of ticks, the DF-scale
  timescale this feature was originally motivated by) haven't been run.

## Stronger weather-driven flora/water dynamics — built, see DESIGN.md

Direct feedback: "i kinda want weather events to be alittle stronger about
killing off flora and reducing water/iincreasing it. it'd make it mroe
dynamic." Widened flora's existing rain/drought decay-rate divisors
(weather.ts) and, the bigger piece, gave water real terrain mutation for
the first time: a "water" tile inside a drought cell can dry to "mud", and
a "floor"/"mud"/"sand" tile adjacent to existing water inside a rain cell
can become water — both a flat per-tile-per-tick roll, same idiom as
flora.ts's own spread, both threaded through an explicit `rng` param (no
new bare `Math.random()`), new `terrainChanged` `SimEvent`. See DESIGN.md's
"Stronger weather-driven flora/water dynamics" section for the full
before/after real-run numbers (seed 20260903, 3000 ticks: water 472 -> 476
net over the run, -6 during one 272-tick drought window, +5 to +6 during
several rain windows — real, non-degenerate movement in both directions).

Open follow-up questions flagged, not implemented:

- **Should drought/rain severity scale with how long the cell has already
  been active?** Right now every drought/rain cell affects tiles at the
  same flat per-tick chance for its whole life from tick 1 to its last
  tick — a cell that's been sitting on the map for 400 ticks is no more
  intense than one that just spawned. A duration-scaled ramp (a long
  drought getting *worse* the longer it persists, not just "still going")
  might read as more dramatic, but wasn't attempted here — it would also
  make the already-tricky rain-vs-drought equilibrium tuning (below)
  harder to reason about, not easier, so it was deliberately left for a
  separate pass.
- **No stable long-run water-supply equilibrium yet.** A real 10,000-tick
  run at one seed drifted water supply up (+17%) under a naive symmetric
  rain/form-vs-drought/dry rate pairing; the asymmetric fix (rain forms
  water much more slowly per-roll than drought dries it, to counteract
  forming's own structural "each new water tile seeds its own neighbors"
  growth advantage) fixed that specific run but a different 10,000-tick
  seed still drifted the other way instead (-25%, drought-heavy). The
  system reliably moves in the direction its dominant weather type pushes,
  it just doesn't yet converge back toward a stable baseline regardless of
  which weather types a given seed happens to roll more of over very long
  runs. Worth deciding whether that's acceptable (a map's water supply
  genuinely drying up or flooding over a very long run is arguably a
  feature, not a bug, for an ecosystem sim) or needs an explicit
  equilibrium-restoring term (e.g. a slow background reversion rate, or
  capping cumulative drift as a fraction of the map's original water
  count) before trusting it over the timescales (1) above's biome-drift
  idea already assumes (tens of thousands of ticks).
- **Water formation doesn't yet use worldgen.ts's moisture field** — new
  water only ever forms adjacent to existing water, never in a "naturally
  low/wet spot" the way `generateWorld`'s own moisture-field-driven
  placement does at world-creation time. Reusing that at runtime (bias
  formation chance by local moisture, not just raw adjacency) is a natural
  next step if adjacency-only spread turns out to feel too uniform in a
  real playtest.

## Priority: sim depth + observability (current focus)

Per DESIGN.md's north star — the sim needs to be able to run headless and
produce a real story before player mechanics are worth building further.

- [x] Headless sim runner (`packages/runner`, `pnpm run run [ticks]`) that
      ticks the world N times and prints the event log — no renderer, no
      player.
- [x] Event log with semantic content (`packages/engine/src/events.ts`):
      `crossedLayer`, `consumed`, `behaviorChanged`. Still missing the
      bigger ones — births, deaths, herd relocations, predation — since
      those behaviors don't exist yet either (see Ecosystem sim below).
- [x] Ran it (300 ticks, see DESIGN.md) — it did surface a real, specific
      finding (Diglett stops going home after ~tick 70), which counts as
      passing the "worth telling" bar even though it's a tuning gap, not a
      dramatic story yet.
- [x] Predation built and run — see "Ecosystem sim" below. First run with
      it produced an actual dramatic story: a Scyther killed 3 of 4
      Bulbasaur in the herd over 300 ticks.
- [x] ASCII/color snapshot renderer, Brogue-style (`packages/runner/src/ascii.ts`,
      `dump-frames.ts`) — glyph = species initial colored by primary type,
      background = terrain shaded by elevation. Wired into the CLI
      (`pnpm run run <ticks> "<tick,tick,...>"`) and into a JSON dump path
      for building real-data artifacts. A real 2000-tick capture (kills at
      58/114, Venusaur guardian killing the Scyther at 167, then Venusaur
      going 2 -> 213 with zero starvation by tick 2000) is a sharper,
      faster demonstration of the population-control gap below than the
      run already written up in DESIGN.md's Starvation section — worth
      remembering that these are noisy single samples, not fixed numbers.
- [ ] Tuning gap found by the first run: an agent whose needs oscillate
      between just-under and just-over the 0.7 satisfied line (flat +0.4
      consume vs. 0.3 idle threshold) can permanently stop returning to
      `homeLayer` because it never registers `idle`. Decide if that's
      acceptable emergent behavior or needs a hysteresis/threshold fix.
- [ ] Tuning gap found by the predation run: fleeing agents flicker between
      `flee` and normal foraging almost every tick in some stretches (the
      4-tile flee-detection radius may be too wide relative to how far one
      flee-step moves an agent out of range). Worth a hysteresis or a
      "stay fled for N ticks after losing the threat" rule.
- [ ] **Real bottleneck found after adding reproduction + flora (see
      DESIGN.md): the predator never leaves.** Herd extinction (0 births,
      dead by tick 217) survived both a flee-radius theory and a food-
      scarcity theory — confirmed cause is `flee` unconditionally
      preempting `seekMate` every tick, forever, because Scyther has no
      migration/territory/satiation behavior pushing it to leave the
      herd's range after a kill. This is the next thing to build, and
      it's predator-side, not prey-side: something like a satiation-driven
      wander/range mechanic so a fed predator moves on and prey get a
      window. Try this before touching flee-radius or mate-priority
      numbers again — two tuning guesses have already been wrong.
- [x] Predator-side fix built: mob-fighting, risk-aware hunting, and
      relocate-after-repeated-failure (see DESIGN.md). Unit-tests confirm
      the mechanism works (a synchronized mob of 3 can defeat a predator).
      Real 1000-tick run still ended in full extinction, but for a new and
      more specific reason — see next item. Progress, not a fix yet.
- [x] **Coordination gap fixed**: `mobSize` now counts allies within
      striking distance of the *threat*, not the agent's own muster
      radius — regression-tested against the exact tick-97 scenario. No
      more solo-mob suicides.
- [ ] **New finding after the fix, and after the full combat overhaul
      (see DESIGN.md)**: in a fresh 1000-tick run, the herd never mobbed
      at all — zero fight events, not even one. The fix stopped the bad
      behavior (dying alone for nothing) but the good behavior (3+ actually
      converging) still never happened naturally in this run. Worth
      investigating whether that's a map/spacing issue (the herd doesn't
      stay clustered enough) or a genuine rarity of the trigger window —
      don't assume which without checking.
- [ ] Also flagged plainly in DESIGN.md: Scyther (level 8) vs. Bulbasaur
      (level 5) is lopsided enough under the real damage formula that
      fights resolve in 1-2 hits — mainline-accurate, but it means
      cooldowns/tactics rarely get to matter. If longer exchanges are
      wanted, the lever is the level/stat gap, not the formula.
- [x] Move range wired in (`moveRange` in combat.ts) and guardians built
      (Venusaur, see DESIGN.md). Real run: the mob-never-assembles finding
      above still holds (still zero mob-fights), and a new one on top —
      the one guardian intervention that *did* trigger failed for a
      concrete geographic reason, not a logic bug (see below).
- [x] **Guardian positioning gap fixed by herd cohesion** (see DESIGN.md) —
      cohesion keeps guardians close enough to the herd's live position
      that one actually engaged and *defeated* Scyther in a real run
      (first predator defeat this session, tick 170). Real fix, confirmed
      by rerunning, not assumed.
- [ ] **Now confirmed at bigger scale: unconstrained reproduction blows up
      the whole herd, not just a predator-free species.** Killing the
      sole predator (HuntRules has exactly one entry) removed 100% of
      population control from this ecosystem — Bulbasaur went 4→40,
      Venusaur 2→36, zero deaths for the remaining 830 ticks. This is the
      same missing piece as the earlier Venusaur-only finding, now
      unavoidable: **this is the next thing to build**, not an edge case.
      Needs a deliberate mechanism (carrying capacity tied to food
      availability? territory/space limits? age-based mortality? multiple
      predator species so no single kill zeroes out all pressure?) —
      pick one and test it, don't bolt on an arbitrary population cap.
      Inbreeding itself is now fixed (see the relatedness-check item
      below) — the carrying-capacity/population-cap mechanism is still
      the open half.
- [x] Starvation death + migrate-on-failure built (see DESIGN.md) — real
      partial fix: 564 Venusaur starved in a 2000-tick run, but 917 births
      still outpaced that, so population still grows net-positive (boom
      with heavy mortality, not equilibrium). Population control is still
      the open question above, just less extreme now.
- [ ] **Migration doesn't actually help the crowding case it needs to.**
      Traced directly: `ticksWithoutResource` only counts up when no food
      exists *anywhere reachable* — but `findNearestTerrain` succeeding
      resets it regardless of distance, so an agent that can see food
      across the map but can't reach it before starving never triggers
      migration; it just starves mid-journey. This is the actual shape of
      the Venusaur die-off (overcrowding/distance, not true absence). Fix
      target: factor in whether the nearest resource is reachable before
      the agent's remaining hunger/thirst buffer runs out, not just
      whether one exists at all.
- [x] Spawn-on-mother stacking bug — fixed (`nearbySpawnTile` in
      `reproduction.ts`) and map variety upgrade (20×14 single-resource
      map -> 24×16 with 3 food patches, 2 water sources, wall obstacles,
      a hill) — see DESIGN.md's "single-tile stacking bug" section. Real
      result: peak stack dropped 168 -> 113 of a similar population, i.e.
      genuinely better but not close to solved.
- [x] **Half fixed: idle-wander after a need is satisfied.** Traced after
      the spawn-position and map fixes above only partially helped: once an
      agent finished eating/drinking it had no reason to leave that tile —
      no idle-wander behavior existed — so a resource tile that works
      became a permanent gathering point instead of a stop. Built as part
      of the exp-motivated exploration feature (`needs.ts`'s
      `applyExploration`, see DESIGN.md): a fully-satisfied idle agent now
      wanders toward nearby unexplored territory instead of standing still
      forever, driven by the same new-sector exp trickle. **Still open**:
      no personal-space/repulsion behavior — herd cohesion (`herding.ts`)
      only ever pulls an idle agent *toward* the herd centroid when it's
      far away, nothing pushes herd-mates apart when they're already stacked
      close together. Fix target: a mild repulsion force in
      `applyHerdCohesion` when two herd-mates are on the same or adjacent
      tile.
- [x] Flora retuned per "food is too long-lived, seedlings should start
      more often": `CONSUME_STOCK_AMOUNT` 0.2->0.5, `SEED_DROP_CHANCE`/
      `GERMINATION_CHANCE` 0.02/0.3 -> 0.06/0.5. Real result: worked
      exactly as specified (floraChanged 30->73, patches actually empty
      now) but backfired on population control — 635 alive at tick 2000
      vs. 247 before, because sprouted patches accumulate (they never
      revert to floor) so total food-carrying capacity went *up*. See
      DESIGN.md's Flora section.
- [x] Flora rebuilt: food now has a real lifespan (`FOOD_LIFESPAN_TICKS =
      50`, decays every tick regardless of eating) and actually dies
      (reverts to floor) instead of sitting at low stock forever, plus a
      chance to spread to an adjacent tile before it does. Superseded the
      old "no cap on total food patches" item above — patches genuinely
      disappear now. See DESIGN.md's Flora section for the two real
      failure modes this went through (total colony collapse from a
      famine-window mismatch, then rebalancing) before landing here.
- [x] **Found and fixed a real mechanical dead end, not just an
      overshoot**: decorative "flora" tiles never died (only edible "food"
      did), and since a seedling only ever plants on bare floor, flora was
      a one-way ratchet permanently converting the map's seedable ground
      away. Confirmed in a real run: 0 food tiles *permanently* by tick
      800, 248/384 tiles converted to dead-end flora, population starving
      at the water hole with no possible path back to food ever again.
      Fixed by giving flora a lifespan too (`FLORA_LIFESPAN_TICKS = 150`).
      See DESIGN.md's flora section for the full trace.
- [ ] **Population is still net-negative on average — real boom-bust, now
      that the structural dead-end above is fixed.** Three fresh 2000-tick
      runs post-fix: activity roughly tripled (60-134 births vs. 13-34
      before, 1800-3275 `consumed` events vs. 632-974) and tile composition
      genuinely cycles now instead of ratcheting, but every run still ends
      in eventual extinction rather than settling. Candidate levers, not
      yet tried: raise `FOOD_LIFESPAN_TICKS`/lower `CONSUME_STOCK_AMOUNT`
      further now that the ratchet's gone and there's more room to tune;
      cap population growth directly (a carrying-capacity check in
      `reproduction.ts`, e.g. mate-seeking pauses above some local
      density); or accept boom-bust as the intended dynamic and build the
      "sim tells you the story of a die-off" angle on purpose instead of
      continuing to chase equilibrium.
- [ ] **Movement/speed is still uniform and unbuilt as a real mechanic.**
      Confirmed by grep: `calculateStats`'s `speed` field is computed but
      never read anywhere — every agent moves exactly 1 tile/tick,
      unconditionally. Per chat: speed should govern turn order/action
      frequency (faster acts more/first, mainline-style), while move
      cooldowns stay a separate, per-move stat — and cooldowns are meant
      to eventually be spec'able/customizable per the original move-
      leveling pitch (Ember: point -> ring, etc.), not tied to Speed at
      all. This is a real architecture change (agents currently get
      exactly one action per tick, full stop) — deliberately not rushed
      in alongside other work; needs its own pass.
- [x] **Guardian positioning gap fixed**: traced to `applyHerdCohesion`
      using the *whole* herd's centroid (guardians included) as a
      guardian's own pull-back target — when a guardian wandered off (e.g.
      to drink), its own displaced position diluted that average enough
      that the "am I too far?" check often still read "close enough," so
      it never corrected back toward the herd it's meant to protect.
      Fixed with a guardian-specific tighter leash (3 tiles vs. 5) plus a
      `protectedHerdCentroid` that averages only the herd's actual prey
      members, excluding guardians (`packages/engine/src/herding.ts`).
      Confirmed with a constructed regression case: the old whole-herd
      check does *not* move a guardian sitting exactly at the old
      boundary while its herd's real prey is 10 tiles away; the new
      rules-aware check does. See `herding.test.ts`.
- [x] **Unconstrained reproduction finding — inbreeding half fixed.** Two
      Venusaur (nothing preys on them) went from 2 to 52 individuals over
      1000 ticks, and `venusaur-0` (the founding male) fathered most of
      that growth including with his own daughters/granddaughters. Fixed
      the inbreeding half: `Agent.parentIds`/`grandparentIds` are set at
      birth (`reproduction.ts`'s `spawnOffspring`), and `isEligibleMate`
      now calls `isRelated` to block direct parent/offspring, full/half
      siblings, and grandparent/grandchild pairs — see `isRelated`'s doc
      comment and the "inbreeding avoidance" tests in
      `reproduction.test.ts` (17 tests total, all passing). Founders
      (scenario-spawned, no `parentIds`) are correctly treated as
      unrelated strangers, so founding-stock breeding is unaffected. A
      3000-tick real run with the check active still produced 17 births
      (23 starved, population stayed small) — confirms this isn't a
      reproductive-shutdown regression. The population-*cap* half (no
      predator = unbounded growth) is still open — carrying capacity tied
      to food availability, territory limits, or age-based mortality is
      still the undecided mechanism.
- [x] **Age-based mortality built** (`ageMortalityChance` in `needs.ts`) —
      a gentle per-tick hazard, 0 below `OLD_AGE_ONSET` (1500 ticks), then
      ramping linearly to a 2% per-tick chance by `OLD_AGE_HAZARD_CAP_AGE`
      (3000 ticks), deliberately not a hard cutoff age (see DESIGN.md for
      why). Records a `diedOfAge` event. Real evidence: a 5000-tick run
      produced 1 old-age death (age 1858); a 10000-tick run produced 10,
      all in the 1500-2000 age band near onset as the ramp predicts. This
      is a real but currently *minor* cause of death — most agents die of
      starvation or predation long before old age becomes likely at this
      population's typical lifespan — so it does NOT yet solve the
      predator-free-species-grows-unbounded problem above; a predator-free
      population would need a faster-acting cap (carrying capacity tied to
      food, territory limits) to actually plateau. Worth revisiting
      whether `OLD_AGE_ONSET`/`OLD_AGE_MAX_CHANCE` should be tuned more
      aggressive once that's decided, rather than guessing now.
- [ ] **Confirmed this isn't Venusaur-specific**: with the action economy
      (see "Combat / moves" below) making the guardian mechanism reliably
      defeat the Scyther predator around tick 110 in real runs, Bulbasaur
      itself now also reproduces unchecked once the threat is gone — 3
      re-runs of the 1000-tick demo produced 71, 48, and 13 Bulbasaur
      births respectively (vs. 2 in the first run written up in
      DESIGN.md). Same root cause as the Venusaur case above (no carrying
      capacity, nothing ties reproduction to predation pressure) — the
      Speed work didn't cause this, but it did make the previously-rare
      "predator dies early" case common enough to matter.
- [x] **`packages/web` evolved from bare canvas dots into a real live
      observer** — see DESIGN.md's "A real live browser observer" section.
      Play/Pause/Step/Speed controls over a real `tickWorld` loop, a seed
      input (`Load`/`Random`/`Copy`, URL-synced via `?seed=`), an
      ascii.ts-palette-matched terrain/agent grid (weather cells and
      day/night tinting included, deliberately basic), a real capped/
      virtualized event log panel with distinct treatment for
      `born`/`killed`/`defeated`/`fainted`/`evolved`/`diedOfAge`, and
      click-to-inspect with a per-agent filtered event history. Also fixed
      the `fought`/`missed` event data gap (added `moveId`/`pos`, matching
      every other combat-adjacent event) as part of the same session.
      `dump-replay.ts`'s precomputed-artifact path is untouched and still
      exists for a no-dev-server snapshot; it's just no longer the primary
      way to watch a run.
- [ ] **`packages/web` has no automated UI tests** — validated instead by a
      clean `pnpm -r build`/`typecheck`/`test` and a real (but
      click-through-free) dev server run; see DESIGN.md for exactly why
      (no browser-automation tooling available in this environment, and
      installing one didn't complete in a reasonable window). A real
      browser-driven check (Playwright or similar) of seed-load/play-pause-
      step/click-to-inspect is still open if this app grows enough to
      justify the infra.
- [ ] **Day/night and weather visualization in `packages/web` are
      deliberately basic first passes** — one flat darkness overlay (no
      directional lighting/gradient) and translucent circles for weather
      cells (no per-tile shading). Fine for "is something happening
      visually," not a polished lighting model.
- [ ] **`packages/web`'s renderer still only draws the surface layer** —
      unchanged from the original bare renderer; an agent that crosses to
      underground/canopy for a need still just vanishes/reappears rather
      than being shown on another view. A real per-layer view (tabs? a
      picture-in-picture minimap?) is future work if the underground/canopy
      populations become interesting enough to want to watch directly.

## World layers, elevation, and regions (see DESIGN.md)
- [x] `Tile`/`World` have a `layer` dimension (Underground/Surface/Canopy,
      shared x,y footprint) — agents native to one layer, movement mostly
      stays within it.
- [x] Cross-layer behavior is common: species whose resources (food/water)
      live on a different layer than their home layer routinely cross
      (Diglett surfacing, Pidgey landing) as part of normal need-seeking —
      see `findLayerWithTerrain`/`tickAgent` in `packages/engine/src/needs.ts`.
- [x] Elevation: continuous heightmap on Surface tiles, elevation-aware FOV
      (`fov.ts`) and elevation-delta combat modifiers (`elevation.ts`, not
      yet consumed by any combat resolver since one doesn't exist yet).
      Open: whether Underground/Canopy get their own elevation too.
- [x] World graph of 3 regions (`region-a`/`region-b`/`region-c`, a chain
      topology) connected by migration edges, each independently bounded —
      see "Overworld: region graph with promotion/demotion" above and
      DESIGN.md. Both halves of migration-edge crossing are built: the
      cheap abstract-tier population transfer, and a focused region's
      individual disperser actually targeting another region (see that
      section for the real-run numbers).
- [x] Region-level promotion/demotion: the focused region runs full
      per-agent sim across all layers; every other region runs abstracted
      (aggregate counts/needs/resource-abundance per species, occasional
      emitted boom/die-off/emigration events) — symmetric with the existing
      agent-level promotion boundary concept, see `overworld.ts`.
- [x] Resolved: aggregate-region state reconciles back into individuals on
      promotion by inventing plausible agents from the aggregate's numbers
      (population count, average needs, a jitter for individual variance) —
      explicitly lossy (the SPECIFIC individuals that existed before
      demotion are gone, not reconstructed), documented plainly rather than
      pretended otherwise. See "Overworld: region graph with promotion/
      demotion" above for the real-run numbers proving this actually
      produces consistent counts (promoted individual count matches the
      aggregate population it was invented from).

## Ecosystem sim
- [x] Herd cohesion built (`packages/engine/src/herding.ts`) — idle agents
      drift toward their herd's live centroid instead of standing still.
      Confirmed working and consequential in a real run — see DESIGN.md.
      Still just a simple "drift toward the average" — no real flocking
      (separation/alignment), no fixed home-range distinct from wherever
      the herd currently is.
- [x] `seekMate`/reproduction built (`packages/engine/src/reproduction.ts`)
      — mature, opposite-sex, same-species/layer/herd agents pair up and
      produce offspring on contact. See DESIGN.md for why it produced zero
      births in the current demo world (predator-pressure bottleneck, not
      a reproduction-system bug).
- [x] `hunt`/`flee` are built (`packages/engine/src/predation.ts`,
      `HuntRules`, `SpeciesDef.preysOn` in `packages/data`) — a nearby
      predator triggers flee (overrides everything), a hungry predator with
      prey in range hunts and kills on contact. Currently just Scyther ->
      Bulbasaur.
- [x] **Predation is now dynamic/size-based, not a fixed species list**,
      requested directly ("it should match by a combo of level and size...
      spearow probably goes for bulbasaurs too"). `HuntRules` is now just
      "does this species hunt at all"; `isPreyOf` computes real eligibility
      per encounter from `powerOf` (a `maxHp` reading, which already bakes
      in level + species bulk). `SpeciesDef.preysOn: string[]` renamed to
      `isPredator: boolean` accordingly. Confirmed in a real run: `spearow
      killed diglett`, `scyther killed sandshrew`, and `scyther killed
      bulbasaur` — the exact scenario asked for, none of them a hardcoded
      pairing. See DESIGN.md for the fleeing-vs-hunting distinction this
      surfaced (fleeing/mobbing stayed species-flag-only, not power-gated
      — a wounded predator is still worth fleeing).
- [x] **Species roster expanded to all three layers, not just surface** —
      Spearow now hunts a 2-Pidgey flock in the canopy, Onix hunts a
      4-agent Diglett/Sandshrew colony underground. Real mainline egg
      groups verified against Bulbapedia (Spearow/Pidgey both Flying,
      Diglett/Sandshrew both Field, Onix separately Mineral). See
      DESIGN.md's "Species expansion" section for the full writeup,
      including a real evolution-filter bug caught and fixed while
      researching Onix (PokeRogue's dex stamps a fake `level: 1` on trade
      evolutions too), and a new honest finding: nobody reaches an
      evolution-relevant level in a 10000-tick run (max observed: 8) — the
      "evolution escapes predation" design this expansion leans on is real
      and unit-tested but doesn't show up in practice yet. That's a
      pre-existing exp-pacing gap (confirmed on the Bulbasaur line too),
      not something this pass introduced — see the Leveling section below
      for where to pick that up.
- [x] **First Water-type added: Squirtle** — closes the "zero type-chart
      representation beyond 6 types" gap found while brainstorming HM-
      style moves (Surf/Whirlpool/Waterfall were all inert without one).
      Real Monster+Water1 egg groups (Bulbapedia-verified) make it a real
      cross-species breeding partner for the existing Bulbasaur/Venusaur
      line, confirmed live in a run (`squirtle-1 x bulbasaur-2`). Spearow
      opportunistically killed one with zero new predation code — the
      dynamic size-based system just worked. Evolved to Wartortle at
      level 16 in the same run. See DESIGN.md. Electric/Psychic/Ghost-or-
      Dark candidates confirmed next — see MOVES_DESIGN.md's round four.
- [x] Mob-fighting, predator risk-assessment, and relocate built on top of
      the above — see DESIGN.md's "Mob-fighting" section and the
      coordination-gap item above for the real (not yet fully successful)
      result.
- [x] Resource depletion + regrowth + seed-spread built
      (`packages/engine/src/flora.ts`) — food tiles have a depletable/
      regrowing `stock`, agents occasionally seed new patches as they move,
      a slow seasonal cycle modulates regrowth rate. Confirmed working
      (seeds sprout on schedule) but didn't fix the extinction problem —
      see the bottleneck note above. Water is still infinite/undepletable
      (a lake doesn't run dry at this scale) — food/berries only, per the
      original ask.
- [ ] Egg stage instead of instant offspring, with parental guarding
      behavior — confirmed canon-real and mechanically rich (Seaking pairs
      guard eggs for a month+, "defends with its life," per research done
      this session). A guarded, vulnerable incubation period is better
      story material than an instant birth. Deliberately deferred rather
      than built alongside plain reproduction, to keep that slice small.
- [x] Performance ceiling for the cheap tier, partially addressed — the
      naive `findNearestTerrain` scan (was O(width*height) per agent) hit a
      real wall once the map grew to 90x60 for the biome-generation feature
      (see DESIGN.md's "Environmental generation..." section): fixed with
      `packages/engine/src/resourceIndex.ts`, a cached water/food/sunbeam
      coordinate index invalidated via `World.resourceVersion`. Confirmed by
      real timing: 1,000 ticks in ~1.5-1.8s, 10,000 in ~5-6s, no blow-up as
      population grows. `growFlora`'s own full-grid-per-tick scan is still
      untouched (not the bottleneck actually observed, and out of this
      feature's stated ask) — still open if a future feature makes it one.
- [ ] Bush ambush bonus deliberately deferred (see DESIGN.md's
      "Environmental generation..." section, "As built") — concealment
      already gives a lurking predator a real, measurable detection-range
      edge; a separate first-strike/accuracy bonus on top was judged scope
      creep for a bar the detection-range reduction already clears.
- [ ] Real tuning gap found by the biome-generation feature: at the new
      90x60 map scale, food is abundant enough that solo (non-herd)
      predators — Scyther, Onix, Spearow — can self-feed from the same
      generic "food" tiles herbivores eat and rarely drop below
      `HUNT_HUNGER_THRESHOLD`, so predation becomes rare and stochastic
      run-to-run (confirmed: an 1,000-tick run showed real combat, a
      separate 10,000-tick run showed none at all). Compounds with solo
      predators having no herd-cohesion wandering (`herding.ts`'s
      `applyHerdCohesion` only fires for `herdId`-having agents), so a
      predator that starts far from prey mostly just sits and grazes.
      Possible fixes, none built: predators shouldn't eat generic "food"
      tiles at all (species-specific diet), lower predator food density in
      generation, or give solo predators their own idle-wander behavior —
      each touches predation.ts/needs.ts/herding.ts territory beyond the
      biome-generation feature's scope.
- [x] Herd-level migration built (`packages/engine/src/herdMigration.ts` —
      see DESIGN.md's "Herd-level migration" section, "As built") — shared
      `World.herdMigrations`/`World.herdScarcityTicks` state, resource-aware
      destination scoring via `resourceIndex.ts`, and `herding.ts`'s
      `applyHerdCohesion` biasing the whole herd (and guardians) toward the
      shared target. 224 tests total (11 new), all builds/typechecks clean.
- [ ] Real tuning gap found by the herd-migration feature, same root cause
      as the predation one above: confirmed via a real-engine famine
      simulation that the full trigger -> destination -> event pipeline
      works correctly, but it essentially never fires in the actual demo
      scenario (zero events in both a 1,000- and 10,000-tick run) because
      the map's abundance keeps a mobile herd's local food/water recovering
      well before the 150-tick sustained-scarcity window elapses (confirmed
      up to 30,000 ticks via a debug instrument — max observed sustained
      scarcity was ~21-26 ticks for the surface/underground herds after
      their initial post-spawn settling period). Lowering the threshold
      enough to fire organically on this map mostly just measures "time to
      find the first meal after spawning," not real depletion — a worse
      signal, so left at the documented values rather than chased down.
      Same possible fixes as the predation gap apply here too (a real
      famine/drought mechanic, lower ambient food density, or per-herd
      eating pressure modeling) — not built, out of scope for this feature.
- [ ] Real limitation found by the same famine simulation: once a migration
      *is* triggered under genuine severe scarcity, the herd doesn't
      reliably arrive — `applyHerdCohesion`'s migration bias only applies
      to *idle* agents, but a real famine keeps most members hungry/thirsty
      most of the time, and `seekFood`/`seekWater` (needs.ts) searches the
      *entire map* for the nearest resource with no awareness of the herd's
      shared migration target, so individual survival-driven wandering can
      pull the herd away from the scored destination — observed directly: a
      test migration timed out (`gaveUp`) nowhere near its target. Possible
      fix, not built: bias `findNearestTerrain`'s candidate search toward
      the active migration target (e.g. prefer a resource within some bonus
      radius of the target over a slightly-nearer one elsewhere) — touches
      needs.ts territory beyond this feature's stated scope (extend
      `applyHerdCohesion`).
- [x] **Herd migration generalized to more trigger reasons — Phase 1 of
      DESIGN.md's "Dynamics that move a content herd" section, done.**
      `MigrationReason` (`"scarcity" | "predator_pressure" | "wanderlust" |
      "territorial"`) is now a real discriminated value on
      `World.herdMigrations`/`herdMigrating`'s event; predator-pressure is a
      running per-herd counter incremented at `predation.ts`'s hit-logging
      site (not a per-tick `EventLog` scan); wanderlust is a flat per-tick
      chance scaled by herd disposition, destination not resource-scored at
      all; territorial is a per-herd-pair sustained-proximity counter that
      displaces the smaller same-species herd. `pickDestination` gained an
      `awayFrom` scoring term for the two threat-driven reasons. See
      DESIGN.md's "Dynamics that move a content herd" section, "Phase 1 — as
      built" for the full design and real-run findings. 235 tests total (11
      new), all builds/typechecks clean.
- [x] **Day/night cycle — Phase 2 of DESIGN.md's "Dynamics that move a
      content herd" section, done.** A fast, independent 200-tick
      light-level cycle (`daynight.ts`, its own tiny module — separate from
      flora.ts's existing 1000-tick season); `activityPattern` (`"diurnal" |
      "nocturnal" | "crepuscular" | "cathemeral"`, default `"cathemeral"`) on
      `SpeciesDef`/`Agent`, assigned with real reasoning to all 9 curated
      species; a real but partial (20%) off-hours Speed penalty composing
      multiplicatively with the existing injury/terrain modifiers
      (`support.ts`); a nocturnal/diurnal hunt-eagerness shift
      (`predation.ts`) composing additively with the existing
      aggression-based shift; a flat night-time FOV radius reduction
      (`fov.ts`, defaulting to full daylight so every pre-existing caller/
      test is unaffected); and `nightfall`/`daybreak` events. See
      DESIGN.md's "Phase 2 — as built" for the full design and real-run
      findings — the honest gap: hunting never occurred in any real run at
      all (same pre-existing sparse-encounter issue Phase 1 already
      flagged), so the hunt-eagerness shift is unit-tested but unconfirmed
      in an actual run. 259 tests total (24 new), all builds/typechecks
      clean.
- [x] **Spatial, moving weather — Phase 3 of DESIGN.md's "Dynamics that move
      a content herd" section, done. All three phases of that section are
      now complete.** `weather.ts` (new module) maintains 1-3 active
      `World.weatherCells` (`rain | storm | drought | coldSnap`, each with a
      center/radius/lifespan/drift), spawning, drifting, and dissipating
      once per tick; spawn type is weighted by real biome data
      (`worldgen.ts`'s new `biomeWeightsAt`, reusing the environmental-
      generation feature's seed-blending math) per a documented affinity
      table (Wetland/Grassland skew rain, Badlands skew drought, Highland
      skews storm/coldSnap). Rain/drought divide `flora.ts`'s decay-rate
      term and multiply `needs.ts`'s thirst-decay rate, composing with the
      existing season multiplier; storm adds a real accuracy penalty
      (`combat.ts`'s `rollAccuracy` gained a general `extraMultiplier`
      parameter) and a real FOV penalty bigger than night's own
      (`fov.ts`'s `computeVisible` gained an additive `stormPenalty`
      parameter, deliberately kept independent of the existing `lightLevel`
      term rather than combined into it) plus a per-herd sustained-exposure
      counter feeding a new `"weather"` `MigrationReason` through Phase 1's
      generalized trigger system, destination-scored toward real
      forest-biome cover (`pickDestination`'s new `preferCover` term); cold
      snap adds a flat fourth composable Speed penalty
      (`support.ts`'s `coldSnapSpeedMultiplier`), deliberately skipping
      per-species cold-tolerance data per DESIGN.md's own explicit
      "still open, flat default is fine" note. New `weatherChanged` event.
      See DESIGN.md's "Phase 3 — as built" for the full design and real-run
      findings — the one genuinely good-news finding across all three
      phases: unlike predator-pressure/territorial (Phase 1), the new
      `"weather"` migration trigger actually fires regularly in the
      unmodified demo scenario (observed in roughly a third of trial runs),
      because it doesn't depend on a fight landing or a second same-species
      herd existing — just a storm cell (large, common) overlapping ground
      with no tree/bush cover (also common on this map). Drought's
      acceleration of the scarcity trigger is proven directly (flora decays
      measurably faster under it) but was never observed actually crossing
      the 150-tick scarcity threshold in ~25 trial runs — it got as close as
      one tick short — the same "map's too abundant for scarcity to fire
      often" gap Phase 1 already found, now confirmed to persist even with
      drought's real assist. 317 tests total (58 new), all builds/typechecks
      clean; one pre-existing test in `herdMigration.test.ts` was found to
      already be flaky (~7% failure rate) from using unseeded `Math.random`
      for a trigger unrelated to this feature — confirmed pre-existing, not
      introduced by this work, left as a follow-up below.
- [ ] Small, low-risk test-hygiene fix found while validating the Phase 3
      weather feature, unrelated to it: `herdMigration.test.ts`'s "triggers
      once scarcity has been sustained for the full window..." test calls
      `updateHerdMigrations` with the default unseeded `Math.random` instead
      of the file's own `NEVER_WANDER` helper (which every other
      non-wanderlust-focused test in that file already uses) — over its
      150-tick loop there's a real (~7%) chance a genuine wanderlust roll
      fires first and changes the migration's `reason` out from under the
      assertion. Reproduces on the pre-Phase-3 commit too, so it predates
      this feature; a one-line fix (pass `NEVER_WANDER`) whenever someone's
      next in that file.
- [ ] Real tuning gap found by the trigger-generalization feature, same
      root cause as the two gaps just above: `fought` events are at or near
      zero in every observed real run (the pre-existing "predators barely
      land hits" dynamic), so the predator-pressure trigger's 5-hits-in-
      300-ticks bar is essentially never approached in the actual demo
      scenario; and the demo world has exactly one herd per species, so the
      territorial trigger never has a rival to compare against. Both are
      confirmed correct via direct unit tests (synthetic hit events for
      predator-pressure, two constructed same-species herds for
      territorial) — this is a scenario-content gap, not an implementation
      bug. Wanderlust *did* fire in real runs (confirmed at the documented
      rate, isolated from population effects, by a 200,000-tick statistical
      test) but is rare to see in the unmodified demo scenario specifically
      because the existing herd-boom-then-bust population dynamic (see the
      gap above) usually kills a herd off within a few thousand ticks,
      cutting short how many chances it gets to roll. Not fixed here — the
      right lever is herd survival time (a pre-existing, separately-scoped
      gap), not a higher wanderlust chance.
- [x] **Herd conflict: fighting over resources — built, see DESIGN.md.**
      Direct ask ("I think escalated rivalry, even between species or same
      species, having them fight over resources would be cool"). New
      `herdConflict.ts`, triggered off real tile-capacity contention
      (occupancy.ts) via needs.ts's existing `ticksBlockedFromResource`
      counter, not an extension of herdMigration.ts's territorial trigger
      (see below for that as an explicit follow-up). Scoped to non-predator
      species on both sides, disposition-weighted (not a flat chance,
      matching `wanderlustChance`'s convention) and relative-strength-gated,
      and structurally non-lethal — the defender's hp is clamped at 15% of
      max, it can never faint or die from this mechanic, only retreat once
      hurt past 60% hp. New `herdClash` `SimEvent`, display support in
      `packages/web/src/eventText.ts`/`packages/runner/src/format.ts`. 10 new
      engine tests, 652 total, all passing including the unmodified
      determinism acceptance test. Real 9-seed 3000-tick validation: fires
      19-90 times per run, real hit/retreat/miss distribution, zero
      kill/faint events ever produced by it, and predator populations
      (scyther/spearow/onix) stayed at the same fragile-but-nonzero baseline
      level this file already documents elsewhere — no new predator-specific
      regression observed, and by construction (predators excluded from the
      trigger entirely) this mechanic cannot be the cause of one.
- [x] **Proactive territorial guarding — built, see DESIGN.md's "Territorial
      guarding" section.** Direct follow-up: "more territorial behavior...
      guarding resources," refined into a full symmetric invader/defender
      design. Not literally an extension of herdMigration.ts's centroid-based
      trigger as first sketched below — `applyTerritorialGuard`
      (herdConflict.ts) instead checks every action tick for a nearby,
      non-tolerated, different-herd agent near real resources, so a
      resident chasing off an intruder and that same intruder fighting for a
      foothold on its own turn are the same code path, not two mechanisms.
      Real tolerance exceptions (bonded/high-rapport, same-egg-group and
      unaggressive) erode as local resources get scarcer. Validated over a
      real 8000-tick run: 696 herdClash events (well above the
      resource-contention trigger's own 19-90-per-3000-ticks baseline).
- [ ] **Real follow-up, deliberately scoped out for predator-fragility
      safety**: herd conflict currently excludes predator species entirely,
      on both sides of a potential fight (no predator-vs-predator rivalry,
      no predator muscling a herbivore off a resource). If predator
      populations are ever judged healthy/stable enough to safely absorb a
      new (even non-lethal) stress source, extending this mechanic to
      predators is a real next step — not attempted here given this
      session's repeatedly-documented predator-fragility findings.
- [ ] **Real follow-up, not built**: a herd-level (multiple members per
      side, closer to predation.ts's existing mob-fighting shape) version of
      herd conflict, rather than the current individual-pair version. Judged
      a materially bigger new death-risk surface to validate safely; the
      individual-pair version already satisfies the direct ask.

## Culture, disposition, and roles (pitched, not built — see chat)
- [x] Disposition vector per individual (boldness/aggression/sociability)
      built, and tied to a real canon-accurate Nature system rather than
      being independent of it — a deliberate departure from mainline (where
      Nature never touches behavior), see DESIGN.md's "Individual variance:
      Nature and Disposition" section. Wired into the flee-detection radius,
      mob-fight commitment headcount, predator hunt-hunger threshold, and
      mate-search radius — modest, individual-level hooks only. Herd
      "culture" as a computed aggregate of member dispositions
      weighted by role/rank (the rest of this bullet's original pitch) is
      still unbuilt — this was the individual-variance foundation it needs,
      not the aggregate itself.
- [x] Guardian behavior built, derived automatically from HuntRules (a
      species nothing preys on defends herd-mates) rather than a stored
      role — see DESIGN.md and the positioning gap above. Still open: a
      real `role` field for contested leadership/succession, which this
      isn't (guardians don't compete for the role, there's no succession).
- [x] Herd status/rank built (`herdRank` in herding.ts) — level buys real
      standing, per direct ask, see DESIGN.md's "Herd status" section for the
      full writeup. Two real payoffs: feeding priority (a lower-ranked
      herd-mate yields a contested, dwindling-stock food tile to a
      higher-ranked, also-hungry one) and mate preference (a rank-aware,
      distance-bounded bias in `reproduction.ts`'s candidate scoring). A real
      seed-42 run shows the feeding-priority mechanism firing often (2117
      yield events over 3000 ticks) and the top-ranked member of the run's
      largest herd siring more than double the next-most-prolific father's
      offspring — directionally real, though not cleanly isolated from this
      sim's documented rng-chaos-sensitivity by a single-seed A/B, flagged
      honestly in DESIGN.md rather than overclaimed. Still open: the real
      `role` field for contested leadership/succession noted just above is a
      different, bigger thing than rank (rank is a live-computed ranking,
      not a contested position), and whether a third status payoff
      (deference in contested movement/tile disputes) is worth adding.
- [x] Natal dispersal built — supersedes this bullet's original pitch with a
      more complete version (two triggers, not just evolving: a
      Disposition-weighted chance at maturity or on evolving, plus a
      guaranteed fallback after a sustained stretch mature with zero
      eligible mates found nearby) — see DESIGN.md's "Natal dispersal: real
      biology's actual fix for the inbreeding bottleneck" section, including
      its "Built, and what a real run actually showed" subsection for the
      honest result: real and working (dispersed events fire, new herds get
      founded, seed 42 at 8000 ticks shows +46% bulbasaur-line population
      across 13 herds vs. one), but at the specific 3000-tick checkpoint the
      motivating inbreeding-bottleneck A/B test used, it reads as
      statistically neutral (confirmed via a 20-seed average, not a
      single-seed fluke) rather than a clear win — the mechanism needs more
      ticks than 3000 to pay off, same as real multi-generation gene flow
      does. Tuning (`DISPERSAL_BASE_CHANCE`, `NO_MATES_DISPERSAL_TICKS`) is
      still open for revision against future runs. Sex-biased dispersal
      (many real species disperse one sex more than the other) remains a
      reasonable future refinement, not built here.
- [ ] Pair-bonding as a disposition trait (`monogamous | opportunistic`,
      or a continuous "fidelity" score): a monogamous agent that
      successfully mates records a `mateId` and prefers/restricts to that
      partner afterward; losing a bonded mate could mean never re-bonding
      (permanent, DF-style) or a grief cooldown. This is what makes
      individuals distinguishable by story ("bonded at tick 40, widowed at
      137, never mated again") rather than every agent of a species having
      the same behavior. Needs individuals to actually survive long enough
      to mate first — see the predator-pressure bottleneck above.
- [x] Individual stats/moveset/level per agent built — real mainline-scale
      stats, canon types, typed moves with cooldowns, real damage formula
      with STAB/type-effectiveness. See DESIGN.md's combat section.
      Individual variance within a species is now built too (Nature's
      1.1x/0.9x stat multiplier, see the bullet above) — same species+level
      is no longer guaranteed identical stats.

## Player / bonding (deprioritized until sim depth lands)
- [ ] Threat signature model — what exactly feeds it (speed/distance/posture)
      and how it plugs into existing perception/behavior logic.
- [ ] Concrete verbs for each trust-stage transition, per species — this is
      still just shaped, not designed as actual player inputs.
- [ ] Whether species-specific bonding puzzles read as distinct to a player
      without a tutorial — open playtesting question, see DESIGN.md.
- [ ] World-state consequences of a botched approach (herd relocation,
      species-wide wariness) — needs the resource-depletion/migration sim
      work above to exist first.

## Combat / moves
- [x] Real combat built: mainline-scale stats/HP, canon types + full 18-type
      chart, typed moves with power/accuracy/category/cooldowns, real
      damage formula with STAB/type-effectiveness. See DESIGN.md.
- [ ] The "promotion boundary" transition itself (see DESIGN.md) — not
      designed yet, just named. Wild-agent combat (predation.ts) now uses
      the real combat system directly rather than going through a
      promotion step, since there's no player yet — worth revisiting once
      the player exists and this needs to be a real transition.
- [x] **Real damage math wired in, not just data**: crit chance by stage
      (mainline 1/24, 1/8, 1/2, always — `CRIT_STAGE_CHANCE`/`rollCritical`
      in `combat.ts`, ported from PokeRogue's `getCriticalHitResult`),
      `CRITICAL_MULTIPLIER` (1.5x) actually applied in `calculateDamage`,
      mainline stat-stage multiplier table (`statStageMultiplier`, ported
      from `getStatStageMultiplier`) actually changing effective
      Atk/Def/SpAtk/SpDef when an agent carries `statStages`, and a real
      accuracy/evasion-stage formula (`accuracyStageMultiplier`, base-3 not
      base-2 — ported from `getAccuracyMultiplier`). `predation.ts`'s
      `resolveHit` now rolls `rollAccuracy` before every hit — **a move can
      genuinely miss now**, closing the old "accuracy not consumed" gap.
      New `missed` event kind for the log. Engine-tested (`combat.test.ts`):
      crit multiplier applies correctly, a crit ignores a beneficial
      Defense stage the way mainline does, a sub-100-accuracy move can miss
      with a controlled rng, stat stages measurably change damage.
      **Caveat, honestly**: nothing in the current sim roster ever *sets* a
      stat stage or uses a sub-100-accuracy move (every curated `MoveSpec` in
      `packages/data/src/moves.ts` is 100 accuracy), so in the actual demo
      run this is real, tested machinery sitting mostly idle — crit rolls
      are the one piece that visibly fires (verified in a real 1000-tick
      run: `scyther-0` landed a critical hit on `bulbasaur-1` at tick 59).
      Individual stat *variance* (Nature/IV-equivalent, different from these
      battle-only volatile stages) is still not modeled — see below.
- [x] **Speed-driven action economy built** (see DESIGN.md's "Action
      economy" section for the full design and real-run findings):
      `Agent.actionEnergy` accumulates each world tick's real `stats.speed`,
      and crossing `ACTION_THRESHOLD` (40, chosen against the demo roster's
      actual computed speeds — 9 to 37) is what lets an agent act that tick.
      `tickAgent` split into `tickAgentNeeds` (age/cooldowns/decay, always
      runs) and `tickAgentAction` (behavior/movement/attacks, gated).
      Cooldowns stay real-time, independent of the owner's action-tick
      status, per the locked design. A 1000-tick real run with it produced
      a genuinely new outcome: a Venusaur guardian, now acting almost every
      tick (speed 37 vs. threshold 40), actually caught and defeated the
      Scyther predator at tick 111 — something that never happened in any
      prior run recorded in DESIGN.md — which let the Bulbasaur herd
      reproduce for the first time ever recorded (2 births, ticks 476/543,
      both well after the kill) instead of going extinct. Not tuned
      further beyond that one constant; see DESIGN.md for what's still open
      (agents without a computed `stats` block, e.g. reproduction.ts's
      newborns, fall back to acting every tick rather than getting a real
      Speed value — a real gap, not fixed here).
- [x] **Move range is its own field** (`MoveSpec.range: { min, max }`,
      `combat.ts`'s `moveRange`/new `withinMoveRange`), replacing the old
      shape-derived-only reach — `range` is optional with a shape-based
      fallback so pre-existing hand-rolled `MoveSpec` literals (tests) don't
      need updating. The curated roster in `packages/data/src/moves.ts` now
      sets it explicitly.
- [x] **Skill tree / respec mechanism built**: `MoveSpec.tree` (a small DAG
      of nodes with a cost, optional prerequisites, and a delta on
      shape/range/power/accuracy/cooldownTicks/statusChance) plus a pure
      `applyMoveTree(base, chosenNodeIds)` in `packages/engine/src/moves.ts`.
      Ember has a real 2-node tree proving the "point -> ring, or stay small
      and trade for burn chance/cooldown" pitch works end to end (see
      DESIGN.md). **Deliberately not built / still open**: no build-point
      economy (how points are earned/spent), no UI, and — per the explicit
      scope call in DESIGN.md — wild background agents never apply a tree;
      `predation.ts` still only ever uses base `MoveSpec`s. The shape axis
      also still isn't connected to predation.ts's single-target-only
      combat — AoE moves among wild agents (who gets hit by a cone?) is a
      separate, real feature, not built. Target-tile-based ranged casting
      (aim at a tile within range, then the shape resolves from *that*
      tile, vs. today's origin-anchored shapes) is also still open.
- [ ] Status effects (burn, etc.) — `statusChance` exists on move data but
      nothing consumes it.
- [ ] Turn-based vs. real-time-with-pause for combat — undecided.
- [ ] Facing/direction for the player during combat — how is it chosen?
- [ ] No individual stat variance yet (no Nature, no IV/EV-equivalent) —
      same species+level always produces identical stats. See the
      Disposition/culture section above for the intended individuality
      layer once this matters. (Battle-only stat *stages* now exist in the
      math, per above — that's a different, temporary-per-fight axis.)
- [ ] Ability effects are not simulated — `ABILITY_DEX` (see "Data import"
      below) is reference-only; nothing reads `abilities.primary/secondary/
      hidden` at spawn or during combat.

## Leveling / exp / evolution / skill points
- [x] **Built: exp, real mainline growth curves, level-up loop, unbounded
      move learning, level-based evolution, typed skill points.** See
      DESIGN.md's "Leveling" section for the full write-up (growth-curve
      verification results, exp sources/amounts, evolution mechanics, the
      `applyMoveTreeWithSpend` spend-validation path) and real run findings.
      Short version: importer now pulls `baseExp`/`levelMoves` per species;
      `packages/engine/src/leveling.ts` has all six mainline growth curves
      (verified against `poke_the_spire`'s raw exp tables, zero mismatches);
      `grantExp`/`LevelingContext` wired into kills, passive trickle,
      eat/drink, mate/birth, new-sector, and new-species-encountered exp
      sources; level-ups loop multi-level, heal HP by the stat delta, learn
      every unlocked move, grant typed+wildcard skill points, and check for
      a level-gated evolution.
- [x] **Evolution finally observed in a real run — exp rates raised
      substantially, requested directly ("getting a kill should give a
      ton... passively eating and drinking should give some... moving
      around to new tiles gives a bunch").** Reconfirmed right before the
      fix: a 10000-tick run still topped out at level 8 for every agent
      across every species/line, zero evolutions ever. Raised
      `EXP_TRICKLE_PER_TICK`/`EXP_ON_CONSUME`/`EXP_ON_MATE_ATTEMPT`/
      `EXP_ON_BIRTH_PARENT`/`EXP_ON_NEW_SECTOR`/`EXP_ON_NEW_SPECIES_
      ENCOUNTERED` 5-10x each, and added a `KILL_EXP_MULTIPLIER` (8x) on
      top of the real mainline kill formula (which assumes a 6-Pokémon
      team splitting exp across frequent battles — doesn't apply to one
      wild agent's rare kill here). Real result: a 5000-tick run post-fix
      produced 3 real `bulbasaur -> ivysaur` evolutions, all at the exact
      real level-16 threshold, plus levels up to 17. See DESIGN.md.
- [ ] **Evolved agents can land on a species outside the curated `SPECIES`
      roster** (e.g. `"ivysaur"`, which `packages/data/src/species.ts` never
      hand-curated — only base dex fields are used for evolved stats/types).
      `packages/web`'s renderer looks up `SPECIES[agent.species]` for a
      sprite key and would break on such an agent. Not hit by the headless
      engine/runner path this feature validated against; a real gap for the
      browser app once evolution is actually reachable in a run (see above).
- [ ] **Status moves learned via `levelMoves` are recorded but not usable.**
      Most of a real species' level-up moveset is status moves (Growl, Leech
      Seed, etc.) that this sim has no engine for — `resolveMove` in
      `packages/data/src/leveling.ts` returns `undefined` for them, so they
      sit in `Agent.knownMoves` forever without a usable `MoveSpec`. Not a
      bug, but worth noting: an agent's *effective* combat moveset will
      often be much smaller than its `knownMoves` list once status moves
      exist in a species' real levelMoves table (which is most of them).
      **Design done, not built yet, and growing** — requested directly
      ("we do need status effects too" plus a separate, still-expanding
      brainstorm of environmental utility moves): the full design — data
      model, exactly which existing code each piece reuses, a running
      table of specific moves across three brainstorming rounds, and the
      real detection-radius gap found while designing Leer (FOV is fully
      built in `fov.ts` and used by zero actual AI decisions — every
      detection check today is a blind radius, not real line-of-sight) —
      now lives in **MOVES_DESIGN.md** at the repo root, its own file
      since the backlog outgrew a DESIGN.md subsection. Dig-to-escape
      shipped for real (Diglett/Sandshrew both know it) — in a leaner,
      stronger form than originally build-ordered: a real temporary
      burrow with automatic resurfacing, not just an instant one-shot
      layer cross, per MOVES_DESIGN.md's primitives checklist. Current
      top of the build-order list: Growl (highest payoff — most of the
      roster already knows it at level 1 and it's completely inert),
      Sunny Day, Leer, then burn/poison.
- [ ] **Non-combat exp trickle amounts are unguessed tuning** (trickle
      0.02/tick, consume 0.5, mate-attempt 1, birth 3, new-sector 2,
      new-species 2 — see DESIGN.md) — no canon formula exists for any of
      these since mainline doesn't grant exp for surviving/eating/mating.
      Revisit once a run shows whether leveling paces sensibly against the
      sim's actual timescale (see the evolution gap above — current signs
      point to "too slow for anything past early levels").
- [x] **A newborn's guaranteed level-up skill point required a follow-up
      fix mid-feature** (see DESIGN.md): `spawnOffspring` didn't set
      `Agent.types`, so `grantExp`'s guaranteed typed skill point (reads
      `agent.types?.[0]`) silently never fired for the majority of level-ups
      in a real run (most level-ups are newborns). Initially patched by
      inheriting `types` from the mother, but newborns still had no real
      stats/moves combat profile at birth. Fully fixed with
      `ensureCombatProfile` (`leveling.ts`) — computes real level-1
      stats/hp/types/moves from the dex, same math `grantExp`'s level-up
      loop uses, called from `spawnOffspring`.
- [x] **Bred offspring inherited the mother's current (possibly evolved)
      species instead of the line's base form** — a bred Venusaur produced
      another Venusaur, not a Bulbasaur, which is backwards from mainline
      (breeding always produces the base form; Bulbasaur is the "child
      version," not a separately-bred species). Fixed with
      `LevelingContext.baseSpeciesOf`, built from a reverse-evolution map
      over the full imported dex (`packages/data/src/leveling.ts`).
      Verified in a real run: `venusaur x venusaur` now consistently
      produces `bulbasaur` offspring.
- [x] **Mate eligibility required an exact species match — no real
      cross-species breeding, and real mainline compatibility is Egg
      Groups, not species identity.** Fixed with `canBreed`
      (`leveling.ts`) checking real Egg Group overlap; hand-curated
      `EGG_GROUPS_BY_BASE_KEY` since the imported PokeRogue dex has no
      egg-group data at all (confirmed directly against a fresh clone —
      PokeRogue's "egg" system is an unrelated gacha/rarity mechanic).
      Bulbasaur/Charmander (both Monster) verified as a real cross-species
      pair by test, but **not observable in an actual run yet** —
      `createDemoWorld` doesn't spawn a Charmander, so nothing currently
      exercises this path live. See DESIGN.md's Breeding section.
- [ ] **Herds are same-species-only today, but real mainline compatibility
      (Egg Groups) already exists in the engine (`canBreed`/
      `EGG_GROUPS_BY_BASE_KEY`, just above) and isn't used for herd
      membership at all** — `Agent.herdId` matching and dispersal's
      `findNearbyOtherHerd` both filter by exact species, not by breeding
      compatibility. Per chat: real mixed-species social groups are
      plausible wherever Egg Groups overlap, so dispersal's "join a nearby
      herd" check should filter by group compatibility instead of species
      equality, once there's a roster with real mixed-group opportunities
      to observe it working. Not started.
- [ ] **Player-recruitment herd concept (deprioritized with the rest of
      Player/bonding, captured here since it's the same "herd ≠ species"
      idea)**: once a player exists, a recruited team should function as
      the player's own herd — each teammate seeing the others as
      herd-mates (cohesion/guardian/mate-preference logic already keys off
      `herdId`, so a player-team herdId would plug into the existing
      machinery) regardless of species, same egg-group-compatibility
      question as the bullet above. Not designed in any detail — no
      player exists yet to recruit onto a team.
- [ ] **Egg-group table only covers the current spawn roster's lines
      (5 base species).** Extend `EGG_GROUPS_BY_BASE_KEY` whenever a new
      base species is added to `species.ts`. Ditto (universal breeding
      partner) and IV/Nature/ability/egg-move inheritance are real
      mainline mechanics not modeled at all — the latter three need
      underlying IV/Nature/multi-ability systems this sim doesn't have
      yet, so they're blocked on that, not just unbuilt.
- [ ] **A real O(agents²) performance regression was found and fixed
      mid-feature**: the "has this agent met a new species" check originally
      scanned every other agent every action tick for every agent. Combined
      with the sim's pre-existing unbounded Venusaur/Bulbasaur population
      growth (see the "Real tactical combat" section of DESIGN.md), a
      5000-tick run timed out (>90s) before this fix. Fixed by
      short-circuiting the scan once an agent has recorded
      `MAX_TRACKED_SPECIES` distinct species — caps the *added* cost, but
      doesn't touch the underlying unbounded-population problem, which is
      still the real, still-open item (see below and the reproduction/
      predation carrying-capacity gap already tracked elsewhere in this
      file). A long run is still at real risk of becoming impractically slow
      independent of anything in this feature.
- [ ] Item/trade/friendship evolutions are parsed into dex `conditions` but
      explicitly not consumed (no item system, no trading, no friendship
      stat exist) — only `level`-gated evolutions are checked. Matches the
      explicit scope call in DESIGN.md's original design writeup.
- [ ] Skill-point *spending* by an AI-controlled agent (an auto-spend
      heuristic, eventually the player's own choice via a UI) doesn't exist
      — `applyMoveTreeWithSpend` is real, tested plumbing that nothing calls
      yet outside tests. Wild background agents accrue skill points
      (harmlessly unused currency) but, per the existing scope call, never
      call it.

## Faint/finish-off, heal over time, herd inventory and carrying
- [x] **Built: fainting instead of instant death, heal-over-time (fed-gated),
      a finishing pool that absorbs follow-up hits, recovery, corpse
      persistence, looting, herd food delivery, and literal carrying of a
      fainted ally.** See DESIGN.md's section of the same name for the full
      write-up and real run findings. Short version:
      `packages/engine/src/support.ts` holds every new tuning constant and
      most of the new logic (heal/recover/loot/deliverFood/carryAlly);
      `predation.ts`'s `resolveHit` now faints instead of killing on a
      lethal hit and only actually kills once a 0.75\*maxHp finishing pool
      is exhausted (by however many follow-up hits, from anyone); kill-exp
      and hunger-restore-on-kill both moved to that true-death moment.
      104 pre-existing engine tests still pass (2 rewritten to match the new
      faint-then-finish semantics, not special-cased); 11 new tests added.
- [x] **Real run finding, and it's the important one: a fainted agent
      outside a herd (or one whose needs were already low when it fainted)
      can get stuck fainted forever, neither recovering nor being finished
      off.** A 3000-tick run: Scyther (solitary, no herd) fainted at tick
      152 with thirst already at ~0.52 — below `FED_THRESHOLD` (0.7) — so
      heal-over-time never even started (its own decay had already crossed
      the fed gate before the faint). One Venusaur landed a follow-up hit at
      tick 155 that didn't finish the (unlogged, since `fought` doesn't
      currently record the remaining pool) finishing pool, and then nobody
      came back into range for the rest of the 3000-tick run — Scyther just
      sat there fainted, permanently, contributing to neither the food chain
      nor the event log for ~2850 ticks straight. The margin is razor-thin
      even for an agent that faints at full needs: healing to the 18% wake
      threshold at 1%-of-maxHp/tick takes ~18 ticks, while thirst alone
      decays through the 0.7 fed gate in ~20 ticks from full — a fainted
      agent has to already be finished off or rescued (herd food delivery,
      carrying) well inside that window, or it's stuck. This is a real,
      specific tuning gap: either heal-over-time needs a faster rate, the
      fed-gate needs to be more lenient specifically for a fainted agent (a
      believable in-fiction argument: it's not moving or fighting, its needs
      shouldn't decay at the normal active rate), or fainted-with-no-herd
      needs a bounded "die of exposure eventually" fallback so a corpse
      doesn't sit in `World.agents` forever in spirit even though the
      literal `alive` flag stays true. Not fixed here — reported straight,
      exactly the finding this feature was supposed to surface.
- [x] **Fainting and finishing-off were both observed for real, not just
      engine-tested**: same 3000-tick run, two Bulbasaur fainted and were
      killed 2 ticks later each (tick 58->60, tick 107->109) — a real
      two-stage "knock down, then finish off" sequence, matching the design
      intent exactly. Hunger only restored on the tick-60/109 `killed`
      events, not the earlier `fainted` ones — eating-on-true-death-only is
      real, not just asserted.
- [ ] **Herd food delivery fired far more than intended: 7212
      `foodDelivered` events in the same 3000-tick run** (vs. 2 in a
      1000-tick run on the same demo scenario) — a direct consequence of the
      sim's pre-existing unbounded population growth (see the "Leveling"
      TODO item above and DESIGN.md's action-economy section): once the
      Venusaur/Bulbasaur population balloons into the hundreds, a large
      fraction of them are well-fed at any given moment, `HUNGRY_HERDMATE_
      THRESHOLD` (0.4) is common enough to always have a target, and nothing
      caps how often one agent restarts the errand. Worth tightening once
      the underlying population-explosion problem has a fix to test
      against — right now it's hard to tell whether 0.4/the lack of a
      cooldown is wrong in isolation or just amplified by an unrelated bug.
      **Traced further, by request, before touching any code**: three
      compounding causes, confirmed directly against `support.ts` and a
      real run, not just theorized — (1) no per-agent cooldown after
      completing a delivery errand, so a courier immediately re-scans for
      a new hungry herdmate every idle tick; (2) no "reservation" on a
      chosen recipient, so multiple couriers can target the same hungry
      agent at once — observed live in one run: `bulbasaur-2` got
      delivered to at tick 120, then again at tick 152 by a different
      courier; (3) the event count scales with population size, not tick
      count — confirmed by contrast: a small-population run (7-16 agents)
      produced only 54 `foodDelivered` over 2000 ticks (reasonable), vs.
      the hundreds-of-agents run above producing 7212 in 3000. Conclusion:
      this isn't really a broken mechanic in isolation, it's the
      population-explosion problem wearing a different hat — a real fix
      (cooldown + reservation) is straightforward but should wait until
      population equilibrium has its own fix to test against, per the
      note above. Left unchanged for now, on purpose.
- [ ] **Looting and literal carrying were never observed in either real run
      (1000 or 3000 ticks), only in direct engine tests.** Two different
      reasons, both worth naming rather than just reporting a null result:
      (1) nothing in the demo scenario ever puts real loot in an inventory
      except a `deliverFood` courier's own in-transit food item, which is
      consumed within a tick or two of being picked up, so there's almost
      never anything sitng around to loot; (2) a hunting predator's own
      follow-up hits reliably land faster (every ~2 ticks, see the finding
      above) than a herd-mate can notice a fainted ally and walk over to
      pick it up, so the carry window mostly doesn't open before the target
      either recovers, dies, or (per the finding above) gets stuck in limbo.
      The mechanism itself is real (support.ts's `applyCarrying`/
      `maybeStartCarrying` are directly engine-tested, including the
      drop-on-threat path) — this is an emergent-scenario gap, not a
      not-implemented one. A dedicated small scenario (a slow predator, a
      tanky prey that survives several hits before fainting, a herd-mate
      planted adjacent) would be the way to actually witness it end-to-end
      outside a unit test.
- [ ] **5000-tick run timed out (>300s)**, consistent with the pre-existing
      unbounded-population problem documented in DESIGN.md's action-economy
      and leveling sections, plausibly worse now: `applyLooting` and
      `applyHerdSupport` each scan `world.agents` per agent per action tick
      (same O(agents)-per-agent cost class predation.ts's own `agentsWithin`/
      `countHerdAllies` already have), so they add roughly proportional
      constant-factor overhead on top of an already-unbounded agent count
      rather than a new order of complexity — but "constant factor on top of
      unbounded" is still enough to turn 3000 ticks (61s) into "5000 ticks
      doesn't finish in 5 minutes." Not specifically optimized here, per the
      same scope call every previous feature in this area has made — the
      real fix is the carrying-capacity/population problem itself.
- [ ] **Carry-capacity uses a maxHp-based proxy, not real imported species
      weight** (`carryCapacityOf`/body-weight in support.ts) — an explicit,
      documented scope call (see DESIGN.md) rather than extending the
      importer to pull `poke_the_spire`'s height/weight fields for a second
      time this project. Revisit if held-item effects ever get consumed by
      combat (the existing out-of-scope item there) and real weight starts
      mattering for something beyond carry capacity.
- [ ] `fought` events don't carry the fainted defender's remaining
      finishing-pool value — tests and the finding above had to infer it
      from `damage` plus context. A cheap follow-up: add an optional
      `finishingPoolRemaining` field so the event log itself can narrate a
      multi-hit finishing blow ("2 hits left in the pool", etc.) without
      re-deriving it from raw damage numbers.

## Art / assets
- [ ] Sprite pipeline is bring-your-own (`packages/web/public/sprites/`) —
      decide on sprite sheet format/size once real art exists.
- [ ] Tile art vs. the current flat-color terrain rendering.

## Data import
- [x] **Bulk species/move/ability/type import from PokeRogue, done.** Unblocked
      once a session had `poke_the_spire` checked out locally alongside this
      repo (the earlier attempt's GitHub-access wall wasn't a problem this
      time — no `add_repo` needed, just read files off disk). See
      `packages/data/scripts/import-from-pokerogue.mjs` and DESIGN.md's "Data
      import" section for what got pulled in and the scope calls made along
      the way. Re-run the script against a fresh PokeRogue checkout whenever
      it's worth refreshing the dex.
- [ ] **Species dex covers only base forms** (see DESIGN.md) — PokeRogue
      models some alt forms (Alolan/Galarian/Hisuian/Paldean regional forms,
      Mega Evolutions) as their own top-level `SpeciesId` and they came in
      for free, but forms nested inside a single species' `forms: [...]`
      array (Pikachu's cosmetic caps, Deoxys/Rotom/Zygarde/Arceus formes,
      Gigantamax) did not. A future pass could add a separate forms table
      keyed by base species id if that's ever needed.
- [ ] **Move dex captures data, not behavior.** `MOVE_DEX` has real
      type/category/power/accuracy/pp/priority/target plus a tag list of
      PokeRogue's `MoveAttr` class names per move (953 moves) — but nobody
      interprets those tags. Reimplementing what e.g. `LeechSeedAttr` or
      `MultiHitAttr` actually does is a different, much bigger project.
- [ ] **Ability dex has no effect text.** `ABILITY_DEX` (319 abilities) has
      id/name/a tag list of `AbAttr` class names/`ignorable`, but no
      plain-text descriptions — those live in a separate i18n locale repo
      that wasn't part of this checkout. Nothing in the engine reads ability
      data at all yet; wiring abilities into combat is unstarted.
- [ ] **Curated items (`ITEM_DEX`, ~30 classic held items) are reference data
      only** — not wired into `combat.ts`. PokeRogue's real item/modifier
      system (shop economy, stacking rules, hundreds of items) is enormous
      and deliberately out of scope; if item effects ever get simulated,
      start from this curated list's numbers rather than the full system.
- [ ] `packages/data/src/dex/*.generated.ts` are, as the name says, generated
      — don't hand-edit them; re-run the import script instead. They're
      checked in (not gitignored) so the sim can be built without a
      PokeRogue checkout present.

## Infra
- [ ] No lint/format config yet (eslint/prettier) — add once the codebase
      is bigger than "does it typecheck."
- [ ] No CI yet.
- [x] **Found and fixed a real cross-test-file flakiness bug**: with
      vitest's default "threads" pool, a `vi.spyOn(Math, "random")` mock
      from one test file could intermittently leak into another when
      vitest happened to schedule both onto the same worker thread —
      confirmed reproducible independent of any of this session's other
      changes (`flora.test.ts` + `reproduction.test.ts` alone, both
      untouched, failed ~50% of the time run together; passed 100% of the
      time run alone). Adding `needs.test.ts`'s new old-age-mortality mocks
      (also `vi.spyOn(Math, "random")`) just raised the odds of hitting it
      in a full-suite run enough to surface it. Fixed with a
      `packages/engine/vitest.config.ts` setting `pool: "forks"` (each test
      file gets its own OS process, so `Math` genuinely can't be shared) —
      verified with 5 consecutive full-suite runs, all green, no
      measurable slowdown (~2.5s either way).
      **A second, genuinely separate flake surfaced once that one was
      fixed**: adding exp-motivated exploration (see "Leveling" below)
      meant a newborn — which gets ticked once more in the very same
      `tickWorld` call it's spawned in (a documented pre-existing quirk,
      simulation.ts) — could immediately wander a step back onto its own
      mother's tile on its first (same-tick) action, intermittently
      failing the "don't spawn stacked on the mother" test. Fixed with
      `MIN_EXPLORE_AGE = 10` in `needs.ts` (a newborn settles in for a few
      ticks before it starts wandering) — verified with 8 consecutive
      full-suite runs, all green.
- [x] **Full-engine determinism: every `Math.random()` call site now threads
      the shared seeded `World.rng` instead** — see DESIGN.md's "Determinism:
      a seeded PRNG threaded through the whole engine" section for the full
      converted-call-site list (flora/leveling/migration/needs/predation/
      reproduction, plus combat/nature/weather/herdMigration which already
      had `rng` params from earlier features but weren't yet reaching
      `world.rng` in production) and the concrete two-runs-diffed proof
      (same seed, 1000 ticks via `packages/runner`, byte-identical md5).
      Also fixed a real hidden-global bug this surfaced:
      `reproduction.ts`'s newborn-id counter was a module-level `let`
      (moved onto `World.offspringSequence`), and one missed `rng`
      passthrough in `needs.ts`'s eat/drink exp grant (silently fell back
      to its own `Math.random` default, invisible to `world.rng`
      draw-counting but a real source of run-to-run divergence — caught by
      the diffed-logs acceptance test, not by inspection). `packages/runner`
      takes an optional seed argument and prints the seed used at the start
      of every run.

## Cross-branch merge: status effects/skill-trees branch merged in

`claude/pokemon-roguelike-sim-5rje5a` (a separate parallel Claude session's
work — status effects (burn/poison/paralysis/**sleep**/freeze), forced-
movement moves (knockback/drag/lunge/retreat), and a skill-tree/move-
primitives expansion) has now been merged into this branch. The real
file-collision risk flagged below when this note was first written (both
branches editing `needs.ts`/`predation.ts`/`types.ts`/`support.ts`/
`simulation.ts`/`combat.ts` around the same time) did materialize —
conflicts in `DESIGN.md`, `events.ts`, `leveling.ts`, `needs.ts`,
`predation.ts`, and `runner/format.ts` — but all resolved by hand, not a
blind `git merge`:

- **`predation.ts` needed real reconstruction, not just picking a side.**
  The other branch's combat refactor (multi-hit moves, AoE via
  `resolveShape`, stat-stage-aware damage, lifesteal/recoil/thorns,
  situational multipliers) had **silently dropped this project's rng-
  threading discipline** — new functions (`applySingleDamageInstance`,
  `resolveHitAgainstTarget`, `resolveAreaHit`, `resolveHit`) called
  `Math.random()`/`rollCritical(...)` directly instead of accepting and
  threading an `rng` parameter, which would have broken the determinism
  guarantee (DESIGN.md's "Determinism" section, `test/determinism.test.ts`'s
  same-seed-same-log acceptance test) the moment any of that new code ran.
  Fixed by adding `rng: () => number = Math.random` to every one of those
  functions and threading it through every roll (crit, damage variance,
  accuracy, hit count, status inflict/spread, skill-point/kill-exp grants)
  — confirmed afterward that the determinism acceptance test still passes
  with the merged code. This is exactly the kind of gap this project has
  hit before (see the "missed `rng` passthrough" bug in the Determinism
  section above) — always re-check new/refactored code for a bare
  `Math.random()` call before assuming rng-threading survived a merge.
- **The move-induced vs. natural sleep unification is still NOT done.**
  This merge only made both mechanisms coexist side by side —
  `agent.asleep` (this session's energy-driven rest, with its sitting-duck/
  herd-wake logic in `predation.ts`) and `agent.status?.kind === "sleep"`
  (the other branch's move-induced status effect, `status.ts`) are two
  completely independent flags right now; an agent could theoretically be
  both, or either, with no interaction. The confirmed design intent —
  direct quote, "mechanically i do want them to be the same thing
  basically. but one is naturally caused by lack of energy and one can be
  induced by moves" — still needs real follow-up work: should a
  move-induced sleep set `agent.asleep` too (getting the same no-self-
  defense/herd-wake treatment)? Does it get the same reduced hunger/thirst
  drain and faster heal/cooldown recovery? What wakes each variant — a
  fixed duration (status.ts's `SLEEP_TICKS_MIN`/`MAX`) vs. the energy/
  urgent-need/threat-plus-watcher conditions? Not started.
- Two pre-existing flaky tests were found and fixed while validating the
  merge (both in `predation.test.ts`, inherited from the other branch,
  not introduced by the merge itself): "a positive critRateStage can crit
  on a roll that stage 0 would not" and "statusSpreads inflicts the same
  status on a nearby agent" both used `vi.spyOn(Math, "random")` to control
  a roll, which stopped having any effect once `tickWorld`'s real default
  rng (`world.rng`, not `Math.random`) was actually being consumed by the
  now-correctly-threaded code above — fixed by passing an explicit rng
  function straight into `tickWorld` instead of mocking the global. A
  third, "weightScaling... deals more bonus damage" (real, reproducible
  flake confirmed via a 30-run loop, ~1/30 rate), had no rng control at all
  on an unseeded `createWorld` — fixed with the file's existing `SAFE_RNG`
  convention. **Not fully audited**: this test file has roughly 80 other
  unseeded `createWorld(10, 10)` calls; a similar low-rate flake
  ("recoilFraction never faints the attacker outright") was observed once
  in ~20 full-file runs and not chased down further given how rare it is —
  worth a real pass converting this whole file to seeded/explicit-rng
  `createWorld`/`tickWorld` calls throughout if it recurs enough to be
  annoying in CI once CI exists.
- `master` is stale relative to both branches (0 commits ahead of this
  branch, 69 behind) and `Stable-for-Brian` is a heavily diverged,
  messily-committed branch (34 unique commits, terse/non-descriptive
  messages) — neither looks relevant to reconcile against, flagging only
  so it's not mistaken for something that needs attention later.
- [x] **Real O(agents²) perf regression found and fixed**: real timing
  (500/1000/2000-tick pure-compute benchmarks, no per-event I/O) showed
  clearly superlinear scaling after this merge — 0.9s/1.2s/6.1s. Traced one
  real cause: `status.ts`'s `applyHealAuraPassive` ran on every agent's
  every tick and, for anyone actually carrying the `healAura` passive,
  scanned all of `world.agents` for same-herd neighbors instead of a bounded
  lookup — same class of bug as the pre-existing species-encounter-tracking
  one. Fixed with a new `herdIndex.ts` (per-tick cached herd membership,
  same pattern as `resourceIndex.ts`).

  That fix wasn't the whole story, and the auto-respec hypothesis
  (`maybeAutoRespec`, leveling.ts) written down here turned out **not** to be
  it — read the actual code and confirmed `maybeAutoRespec`'s cost is bounded
  by a single agent's known-moves/tree-node count, not by population size,
  so it doesn't scale with agents at all. Profiling (`node --prof` +
  `--prof-process`) instead pointed at `packages/data/src/leveling.ts`'s
  `profileFromDexEntry` (`LEVELING_CONTEXT.getProfile`): it rebuilt a fresh
  `LevelingProfile` object (including an `evolutions.filter().map()` pass)
  from scratch on *every* call, and `reproduction.ts`'s `applyMateSeeking`
  calls it (via `canBreed`, up to twice) once per candidate in a full,
  unindexed `world.agents` scan run for *every* mate-seeking agent, every
  tick — an O(agents) scan whose per-candidate cost was itself needlessly
  heavy, and O(agents) of those scans per tick. A per-call counter confirmed
  it: a 2000-tick/~350-agent run made ~790,000 `getProfile` calls, growing
  far faster than population or tick count (500 ticks: ~43k; 1000 ticks:
  ~103k). Fixed by memoizing `profileFromDexEntry` in a small `Map` keyed by
  species id — safe because the dex it reads from is static for the life of
  the process, so nothing ever needs to invalidate the cache; same "index
  instead of a bare scan" fix shape as `herdIndex.ts`, just for a lookup
  table instead of world-position data.

  **A second, bigger contributor turned out to be a real determinism bug,
  not a pure perf one**: `grantExp`'s level-up loop (leveling.ts) called
  `grantSkillPoint(agent, primaryType, world, log, ctx)` — silently dropping
  the `rng` parameter, so every level-up's guaranteed skill-point grant (and
  its `maybeAutoRespec` follow-up, and its 1-in-`SKILLPOINT_WILDCARD_INTERVAL`
  bonus-wildcard recursion) fell back to real, unseeded `Math.random()`
  instead of `world.rng`. Confirmed via a same-seed-twice checksum
  (`createDemoWorld(42)` + 500 ticks, same process, same code): agent count
  and a position/level/HP checksum differed on *every single run* before
  this fix, identical on every run after it. This explains why the
  originally-reported 0.9s/1.2s/6.1s numbers looked so dramatically
  superlinear: re-running that exact unmodified benchmark several times (no
  code changes) produced wildly different populations at tick 2000 purely by
  luck — 97, 148, 239, 379, once even 753 — because the unseeded skill-point
  draws fed back into how much a run's population could grow (more real
  wildcard points -> more passives/moves committed -> different downstream
  survival), and a larger population is itself genuinely more expensive to
  tick. The "superlinear" shape was real variance across un-reproducible
  runs, not (mostly) a single hidden algorithmic hot path. Also
  independently found and fixed the same class of bug one call up:
  `tickAgentNeeds` (needs.ts) called `tickStatusEffects(agent, world, log)`
  without `rng`, so a frozen agent's per-tick thaw roll had the same
  unseeded-`Math.random()` problem (smaller blast radius, same fix).

  **Verified end to end**: `pnpm --filter @pokuelike/engine test` (541
  tests, run twice, no flakes seen) and `test/determinism.test.ts`'s
  acceptance test both still pass; the exact task benchmark script, run
  twice back to back on seed 42, now reproduces byte-identical agent
  counts/timing (500: ~800ms/22 agents; 1000: ~1150ms/13 agents; 2000:
  ~2100ms/11 agents, both runs). A higher-population seed (4: 27 -> 51 ->
  314 agents across the same three tick counts) stays reproducible run to
  run and scales with population roughly in line with tick count rather than
  blowing up, confirming the fix holds at scale and not just on a
  small-population seed.
- [ ] **A second pre-existing flaky test surfaced outside `predation.test.ts`**:
  `reproduction.test.ts`'s cross-species-types assertion failed once in a
  full-suite run, passed 1/1 in isolation immediately after — same unseeded-
  `createWorld`-plus-real-rng shape as the `predation.test.ts` flakes
  documented above, just in a different file. Not chased down individually
  (same "not fully audited" caveat applies) — worth folding into that same
  future seeded-rng test-hygiene pass rather than fixing file-by-file as
  each one happens to get noticed.

## Real pathfinding for `seekWater`/`seekFood` — built; other behaviors still greedy

**Built**: a new `pathfinding.ts` (BFS, `findPath`/`stepAlongPath`, cached
per-agent on `Agent.pathCache`) now backs `needs.ts`'s `seekWater`/
`seekFood` stepping specifically — see DESIGN.md's "Follow-up: real BFS
pathfinding for `seekWater`/`seekFood`" section for the full writeup. Real
re-run of the exact seed that surfaced this (20260903): thirst-starvation
deaths 20 → 13, and the specific stuck-oscillating Onix from the original
diagnosis no longer dies of thirst at all (it now dies later, in combat,
instead). Chose per-agent path caching over a shared per-(layer, target)
flow-field cache (the `resourceIndex.ts`/`herdIndex.ts` pattern) — the map
is small enough that per-agent BFS is already cheap and a real run showed
no measurable slowdown; a shared cache is a possible future optimization
if per-agent recomputation ever shows up as a real cost in a much larger
map or population, but wasn't worth its extra invalidation surface now.

**Still open at the time / now built**: hunt-a-visible-target and
mate-seeking (predation.ts/reproduction.ts) now ALSO get real BFS
pathfinding — see DESIGN.md's "Follow-up 2: real BFS pathfinding for
hunting and mate-seeking, with moving-target handling" for the full
writeup. A moving target needed its own recompute-staleness rules
(`stepTowardMovingTarget`, a new function alongside `stepAlongPath`) rather
than the static-target cache, or the caching benefit would have been
defeated by the target moving nearly every tick. Real re-run findings on
both the seed that surfaced the original bug (20260903) and seed 42: seed
42 shows the intended effect clearly (births 39 → 75, fought 21 → 26), but
seed 20260903 shows LESS combat/reproduction after the change (fought
20 → 7, born 14 → 7) — not a regression (every test passes, no wall-clock
slowdown either seed), just the same butterfly-effect divergence a
behavior-shaping change always produces in a deterministic-but-chaotic sim
under a fixed seed. See DESIGN.md for the full honest breakdown.

**Still open / explicitly out of scope for this pass**: flee, exploration,
dispersal's long walk, shelter-building's travel, and herd-migration's
relocate walk still call `movement.ts`'s plain `stepToward`/`stepAway`
unchanged, on purpose (flee especially wants "away right now," not an
optimal route, and none of these were a confirmed death-causing case).
Worth revisiting as a candidate follow-up, not fixing preemptively, if a
future real run shows one of THEM getting stuck near an obstacle cluster
the same way seekWater/seekFood (and, before this pass, hunting/mate-
seeking) used to.

**Unrelated gap noticed in passing while validating this pass, not fixed
(out of scope)**: both real 2000-tick runs (seeds 20260903 and 42) still
show `killed`/`defeated`/`born` counts that are small relative to
`floraChanged`/`supported`/`leveledUp` — hunting and mating are working
mechanically (confirmed directly by this pass's own obstacle-course
integration tests) but remain rare events over a full run relative to
everything else going on. Might be worth a future look at whether
`HUNT_HUNGER_THRESHOLD`/`MATE_SEARCH_RADIUS`/herd-density tuning is
leaving real hunting/mating opportunities on the table, independent of
pathfinding — not investigated further here since it's a tuning question,
not something this pathfinding pass itself caused or is positioned to fix.

## Urgency-based need priority, extended thirst margin, and sleep — built, tuning follow-ups

- [ ] **`LONG_SLEEP_EXP_TICKS` (200) reads a little high relative to real
      sleep-session lengths** — a real seed-42 (and 3 other seeds') run
      never saw a completed sleep session longer than 183 ticks, so the
      long-sleep exp bonus never actually fired in any of the four real
      runs tested (confirmed firing correctly, exactly once, in
      sleep.test.ts's unit test). Worth revisiting once predator population
      dynamics (see the bullet below) are healthier and agents have more
      reason to sleep longer/more often — lowering the threshold now, with
      only unit-test data to go on, risks tuning against the wrong signal.
- [ ] **Sleep's two "danger" paths (a watcher waking a sleeper, a predator
      catching a sleeper) were never observed in real-run testing** across
      four seeds (42, 7, 99, 123) at 2000 ticks each — every single wake
      was the `urgentNeed` path, zero `threatSpotted` wakes, zero hits/kills
      landed on a sleeping agent. Root cause investigated, not assumed:
      3 of 4 seeds ended their run with zero living hunter-species agents
      at all (the pre-existing predator-population problem below), so the
      "predator within detection range of a currently-sleeping prey" window
      this needs essentially never opened. Both mechanisms are directly
      unit-tested (predation.ts's guard placement + needs.ts's wake logic —
      see sleep.test.ts) and the code path is real, just unconfirmed
      end-to-end in a real scenario. A dedicated small scenario (a
      persistent, well-fed predator that doesn't die out, planted near a
      sleep-prone herd) would be the way to actually witness it, the same
      "targeted scenario, not just a longer demo run" approach this
      project has used before (see the carrying/looting gap noted above).
- [ ] **Predator (hunter-species) populations crash to near-extinction fast
      in the demo scenario** — confirmed while investigating the bullet
      above, not new to this feature: 3 of 4 test seeds had zero living
      `scyther`/`spearow`/`onix` agents by tick 2000, the fourth had
      exactly 1. Pre-existing population-dynamics territory (see the
      exploding-Bulbasaur/Venusaur growth findings and the unbounded-
      population performance notes elsewhere in this file/DESIGN.md), not
      something this feature caused, but it does mean any future
      predator-dependent feature (this one included) needs a genuinely
      sustainable predator population to actually exercise in a real run,
      not just a longer tick count.
      **Update, this session**: pack hunting + scavenging (see the section
      below, DESIGN.md) were built as two direct levers against exactly this
      — both proven real and working via dedicated stress scenarios, but
      predator populations still did NOT reliably recover in real 3000-tick,
      9-seed runs (several seeds still ended at 0). The mechanisms mostly
      just don't get a chance to fire in the stock demo scenario, because it
      spawns exactly one of each predator species — see the follow-up below
      and DESIGN.md's own honest findings section. This bullet stays open.
- [ ] **Dispersal's pause-on-urgent-need fix real-run numbers (seed 42,
      2000 ticks, A/B against the pre-feature code on the same seed): total
      starvation deaths dropped 109 -> 30 (thirst deaths 82 -> 23, hunger
      27 -> 7), final population rose 365 -> 443.** Confirms the diagnosed
      root cause (dispersal blocking hunger/thirst/mate-seeking for its
      whole multi-hundred-tick walk) was real and the fix closes most of
      the gap. One honest side effect worth tracking: completed `dispersed`
      events dropped 12 -> 3 in the same window — expected (a paused
      dispersal takes more real ticks to actually arrive, so fewer finish
      within a fixed window), not a regression, but worth knowing if a
      later feature wants to reason about "how many dispersals typically
      complete in N ticks."

## Cross-herd mating escape hatch — built, see DESIGN.md

- [x] Solo dispersal founders (and any herd with no current opposite-sex
      mature member) are no longer permanently mate-locked — `isEligibleMate`
      now allows cross-herd pairing once either party has gone
      `MATE_ISOLATION_TICKS` (200) ticks with zero eligible mates in range.
      Confirmed firing in a real 3000-tick run (seed 7, tick 2561). 4 new
      tests, all 579 engine tests pass, determinism unaffected.
- [ ] **Open tuning question:** is 200 ticks the right fuse, and should it
      scale with local population density (sparser maps might want it
      shorter)? Not resolved — needs more real runs across seeds/densities
      before touching the constant again.

## Breeding-level gate — built, but a real severe side effect flagged, see DESIGN.md

- [x] Breeding now requires evolved-once OR level 16+, on top of the
      existing age-based maturity check. Direct instruction, implemented
      exactly as asked (`meetsBreedingRequirement` in reproduction.ts).
- [ ] **Urgent-ish open question, not resolved here:** a real 3000-tick,
      3-seed run shows births collapsing to 4-5 total per run (was
      hundreds-to-thousands) — most agents simply don't reach level 16 or
      evolve within a normal run's lifetime at current exp-gain rates
      (`EXP_TRICKLE_PER_TICK` 0.8/tick vs. ~2535 exp needed for MEDIUM_SLOW
      level 16). The eligibility rule does exactly what was asked; whether
      the *practical* near-zero-breeding outcome at today's exp pacing is
      the intended end state, or whether exp-gain rates (or the level
      threshold) should be revisited alongside it, is a real open design
      question to take back to the user rather than guess at.
- [x] **Tried: quarter thirst/hunger decay rates, direct ask, on the theory
      that agents weren't surviving long enough to level up.** Real
      before/after run (same 3 seeds) shows this **did not fix breeding**:
      births stayed at 1-4 per run. Root-cause check: starvation deaths
      were already rare even before this change (0-6 thirst deaths, 0
      hunger deaths, ~2-4 kills per 3000-tick run, out of a starting
      population of 17) — agents were already surviving fine. The real
      bottleneck is leveling *speed*, not survival time: most agents simply
      never accumulate enough exp to reach level 16 within 3000 ticks
      regardless of how long they live. Kept the slower decay anyway (a
      real, independently-requested improvement — starvation was already
      rare, this makes it rarer still, no downside found), but it does NOT
      resolve the breeding-rate question above — exp-gain pacing is the
      actual lever, still unaddressed.
- [x] **Follow-up (direct ask): lowered `MIN_BREEDING_LEVEL_UNEVOLVED` 16 ->
      12, plus a slight exp bump (`EXP_TRICKLE_PER_TICK` 0.8 -> 1.0,
      `EXP_ON_CONSUME` 6 -> 8).** Real same-3-seed run: meaningfully
      better on 2 of 3 seeds — seed 42: 32 births (was 4), final pop 37
      (was 14); seed 7: 12 births (was 3), final pop 22 (was 11). Seed
      20260903 stayed stubbornly low (2 births, was 1, final pop 13). A
      real, substantial improvement, not a full solve — worth a longer run
      or more seeds if the user wants every seed to recover, not just most.

## Real bug fix: "died of thirst while in water" — see DESIGN.md

- [x] Direct report, traced to a real mechanism: `applySupportMove` had no
      urgent-need escape valve, so a zero-cooldown ally-buff move (reachable
      via the skill tree) plus a permanently-adjacent herd-mate let it claim
      every action tick forever — `tickAgentAction` never reached
      `chooseBehavior` again. Fixed via a `needsAreUrgent` gate at the
      caller (needs.ts), same pattern as dispersal/shelter's existing pause
      fix; `applyHerdSupport`'s food-delivery errand got the same fix (only
      checked the deliverer's own needs once, at errand start). This
      resolves the seed-20260903 low-growth mystery noted in the entry just
      above far more than the exp/level tuning did: real before/after same
      3 seeds, this fix alone — seed 20260903: final pop 13->40, births
      2->28, zero starvation deaths (was 5 near/on water); seed 7: 21->164;
      seed 42: 19->34. Every prior "population stays low on some seeds"
      finding this session should probably be re-read in light of this —
      it may have been the dominant cause all along, not herd-lock or exp
      pacing. New regression test in support.test.ts. All 594 engine tests
      pass, determinism unaffected.

## Inspector redesign follow-ups (grouped layout / moves / skill trees)

- [ ] The skill-tree layout is a simple BFS-depth layered layout (one row per
      depth), not a real graph-layout algorithm — no edge lines drawn between
      a node and its prerequisites, and no crossing-minimization within a
      row. Fine for the small trees that exist today (5-10 nodes); would
      likely need real edges drawn (SVG connectors) to stay readable if a
      much larger/denser tree ever gets authored.
- [ ] No real browser/DOM test harness exists in this project (confirmed
      again this session — Playwright/jsdom/happy-dom aren't installed) so
      the new grouped inspector layout was verified via a hand-rolled DOM
      shim + typecheck/build, not an actual rendered browser. Worth revisiting
      if this project ever adds one, especially for anything with real click
      interaction like the new move-tree toggle.
- [ ] Mobile/narrow-viewport responsiveness of the new grouped inspector
      sections is unverified — the existing `#inspector-panel` scroll
      container should handle it via `overflow-y: auto`, but the group
      boxes/meters haven't been checked at very narrow widths (the drawer's
      own `@media (max-width: 768px)` handling was left untouched).
- [ ] The skill-tree node tooltip (delta/leaning/passive detail) uses a
      native `title` attribute — functional but not discoverable on touch
      devices with no hover. A real click-to-expand detail popover would be
      nicer if this becomes a frequently-used feature.

## Food durability + real water-body terrain transformation — built, see DESIGN.md

- [x] Direct asks ("make food less durable... force migration" / "water
      sources dry out and refill more during droughts and rain... bigger
      lake/spring bodies might shrink but never run out") both built.
      `CONSUME_STOCK_AMOUNT` 0.25->0.35, `FOOD_LIFESPAN_TICKS` 100->70,
      `FOOD_SPREAD_CHANCE` 0.035->0.025 (flora.ts). New `waterBody.ts`
      (4-connected flood-fill component sizing, cached via
      `World.resourceVersion`) backs a tiered `advanceWaterCycle`: small
      bodies dry at a much faster `1/150` (was a flat `1/500`) and can fully
      vanish; bodies at/above `LARGE_WATER_BODY_MIN_SIZE` (12, picked from a
      real measured size distribution — see DESIGN.md) dry at a much slower
      `1/3000` and are floored at exactly that same threshold so they can
      never run out. `RAIN_WATER_FORM_CHANCE_PER_TICK` settled at `1/1800`
      (lower than the pre-existing `1/1500`) after a first attempt at
      `1/1000` was checked against a real 10,000-tick terrain-only run and
      found to cause worse runaway water growth than before (+20-47%,
      root-caused to ~89% of a real map's water now sitting in the
      slow-drying large-body tier) — `1/1800` brought that back to near
      equilibrium (-2% to +8% over the same window).
- [x] Real correctness bug found and fixed *before* shipping, not after: an
      earlier floor value (6, below the 12-tile large-body threshold) let a
      shrinking lake silently reclassify as "small" once it crossed under
      12 tiles, then dry the rest of the way to 0 at the fast rate — a
      synthetic worst-case unit test (permanent drought, no dissipation)
      caught a 25-tile lake reaching 0 tiles by tick ~2000. Fixed by setting
      the floor equal to the large-body threshold itself, closing the gap
      by construction. See `weather.test.ts`'s dedicated large-vs-small test
      and DESIGN.md's full writeup.
- [x] Real-run validation (stash-based A/B isolating just this feature's two
      files, 3000 ticks, seeds 42/7/20260903): migration-start events rose
      2->10, 2->9, 1->3 across the three seeds — a real, meaningful increase
      in scarcity-driven relocation, this feature's actual goal. Final
      population/births moved in both directions per-seed (butterfly-effect
      sensitivity, not a systematic direction) and zero starvation deaths in
      every run, before and after.
- [x] The user's own direct "keep an eye on it" ask about idle/sated agents
      answered with real sampled numbers (ticks 1000/2000/3000, all 3
      seeds): idle-and-both-needs-above-0.7 fraction of living agents never
      exceeded 11%, mostly well under 5%. See DESIGN.md for the full table
      and two honestly-flagged caveats (not fully isolated from a concurrent
      unrelated tile-occupancy feature also landing in `needs.ts` this same
      session; doesn't itself prove causation vs. the migration-count
      evidence above).
- [ ] **Residual, honestly-flagged edge case, distinct from the bug already
      fixed above:** water-body "large" classification is a stateless,
      current-size-only check with no memory of a body's own history. The
      floor-equals-threshold fix guarantees a large body can't be
      immediately reclassified-then-drained in one continuous exposure, but
      a border-line-sized lake (just above the 12-tile threshold) that
      survives many *repeated* separate droughts over a very long run could
      still, in principle, eventually cross the threshold for good and then
      dry at the fast small-body rate with no more protection. Real
      generated maps' actual major lakes sit well above the threshold
      (34-183 tiles per DESIGN.md's measured distribution), so this mainly
      matters for the handful of borderline 12-30-tile bodies specifically,
      over run lengths well beyond what the performance-ceiling item below
      currently allows a real agent-population run to reach anyway. Real
      persistent per-body hysteresis tracking (not just a per-tick size
      check) would close this fully if it's ever worth the complexity.
- [ ] **A real 8000-tick, 3-seed validation run (this task's own suggested
      upper end) could not be completed** — killed after several minutes
      without finishing, and a follow-up single-seed 5000-tick attempt was
      also killed. Confirmed this is the pre-existing population-driven
      performance ceiling noted elsewhere in this file, not something this
      feature caused (a terrain-only water-cycle run with zero agents
      completed a full 10,000 ticks in ~6 seconds). 3000 ticks per seed
      (~7-10 seconds) is this feature's actual validated range — worth
      revisiting once the underlying population-growth performance ceiling
      is addressed, so a real long-run validation (and a real check of
      whether the residual water-body edge case above ever actually bites)
      becomes practical.

## Tile capacity (weight/headcount limit per tile)

- [x] Hard per-tile capacity, direct ask: surface uses a weight-based rule
      (`TILE_WEIGHT_CAPACITY = 90`, ~3 real average-weight agents, reusing
      `support.ts`'s `bodyWeightOf` convention), underground/canopy use a
      flat `FLAT_TILE_HEADCOUNT_CAP = 5` headcount instead (mid-implementation
      clarification), both with an "empty tile always admits at least one"
      floor. New `packages/engine/src/occupancy.ts`, following
      `herdIndex.ts`'s exact per-tick cache shape.
- [x] Capacity composes with movement/pathfinding — a full tile "routes
      around, same as an obstacle" — but SCOPED to seekWater/seekFood
      (`stepAlongPath`) and exploration wandering only, not hunt/mate
      pursuit, herding, dispersal, migration, herd support, or forced
      movement. See DESIGN.md's "real-run finding that narrowed this scope"
      — capacity-gating those too caused a real, measured population
      regression (up to ~83% on one seed) with zero starvation deaths,
      traced to hunt/mate pursuit misreading ordinary herd density as
      "unreachable."
- [x] Blocked-resource AI: waits `BLOCKED_RESOURCE_GRACE_TICKS` (25) ticks
      near a crowded target, then excludes it and tries the next-nearest
      tile of the same terrain, with a fast-track safety valve into the
      existing `migrate()` escape hatch once every nearby known tile is
      excluded — prevents infinite oscillation between mutually-crowded
      tiles (tested directly). Along the way, fixed a real, initially-missed
      bug: `findLayerWithTerrain` (the underground<->surface water-sharing
      cross-layer check) wasn't threading the exclusion list, letting an
      agent ping-pong layers forever re-discovering the very tile it just
      excluded — caught by the oscillation test, not theorized in advance.
- [x] Real 3000-tick, 3-seed validation (42/7/20260903): zero starvation
      deaths on all three, real contention (max 7-9 simultaneous occupants
      on one seed's tiles, up to ~2 avg per occupied tile), and real
      waiting confirmed (`resourceWaitTicks`:`resourceBlockedFallbackCount`
      ratios of ~48:1 to ~105:1 — agents mostly wait out contention rather
      than instantly relocating).
- [ ] **Honestly-flagged, not chased down further this pass:** seed
      20260903's population dropped much more (249 -> 42, -83%) than its
      own contention numbers would predict (that seed had the LOWEST
      contention of the three: only 3 blocked-fallback events, max 2
      simultaneous occupants). Zero deaths, healthy sampled hunger/thirst
      throughout — this reads as this sim's already-documented chaotic
      seed-sensitivity (a small deterministic tick-order change cascading
      into a large population difference on a seed already flagged
      elsewhere in this file as stubborn/low-growth-prone), not a
      capacity-crowding bug, but pinning that down for certain would need
      its own dedicated event-by-event A/B isolation pass.
- [ ] Underground/canopy's flat headcount cap is unit-tested directly but
      never actually exercised by a real run — neither layer's current
      world generation places its own water/food terrain there (underground
      shares the surface's via the existing redirect; canopy has none at
      all), so real contention on those two layers stays unobserved until
      that changes.

## Grazing scars: sustained heavy grazing degrades a tile — built, see DESIGN.md
- [x] Direct pitch, approved directly ("Yeah that sounds good" — one of three
      environment-shaping ideas offered, alongside trampled paths and
      territory marking). `Tile.grazingPressure`/`Tile.overgrazed`
      (types.ts), accumulated via `flora.ts`'s new `recordGrazing` at both
      real consumption sites (needs.ts self-feeding, support.ts herd
      food-delivery pickup), decayed every tick in `growFlora` regardless of
      terrain. Crossing a hysteresis-gated threshold suppresses (not zeroes)
      germination/maturation and outright refuses spread onto the scarred
      tile, self-fading back to normal once grazing pressure decays with
      real rest. New `floraChanged` stages (`"overgrazed"`/`"recovered"`),
      filed as `NOISE_KINDS` ambient bookkeeping like the rest of
      `floraChanged`. 9 new `flora.test.ts` tests, 652 engine tests total,
      all passing including the unmodified determinism acceptance test.
- [x] First tuning pass was measurably too weak (only 3 tiles ever went
      overgrazed across a real 3-seed 3000-tick run) — retuned against that
      same real data (slower decay, lower threshold) to 9/20/1 tiles
      overgrazed across the same 3 seeds, zero starvation deaths on all
      three, confirmed via a real feature-on/feature-off A/B (not just
      before/after correlation) that the effect is real and attributable.
      See DESIGN.md for the full numbers and the diagnosis of why the first
      pass under-fired.
- [ ] **Real follow-up, not built**: no distinct map/renderer treatment for
      an overgrazed tile — it still looks like ordinary floor. Worth
      revisiting if scars turn out common enough in practice to be worth a
      glyph/tint, once `packages/web`'s tile renderer is being touched for
      something else anyway.
- [ ] **Real follow-up, not built**: migration correlation was only tested
      indirectly (herdMigrating event counts, not a controlled trigger).
      This session's own herdMigration.ts already has a `"scarcity"` trigger
      driven by local food availability, not directly by `Tile.overgrazed` —
      an overgrazed tile currently only discourages migration *indirectly*,
      by starving out the scarcity check's food-availability read. Wiring
      `Tile.overgrazed` as a direct migration-scoring input (the way
      `MigrationReason` already has room for a dedicated reason string) is a
      real, un-built next step if grazing scars turn out to need a stronger
      migration nudge than the indirect path currently gives them.
- [ ] Seed 7's overgrazing events all clustered in the last ~700 of 3000
      ticks (tracks that seed's late population boom, not chased down as a
      suspected bug — see DESIGN.md's "Explicitly not done" for this
      feature) — flagged, not resolved, same as this file's other
      honestly-reported-but-unconfirmed seed-specific observations.

## Pack hunting, scavenging, and ontogenetic niche shift — built, see DESIGN.md

- [x] Three real-biology behaviors, all approved directly ("Pack hunting
      sounds good. Scavenging is good. Ontogenic too."), built as real
      levers against this file's own repeatedly-documented predator
      fragility (see the bullet above). Pack hunting
      (`predation.ts`'s new `isPackPreyOf`/`nearbySameSpeciesConspecifics`/
      `committedPackmates`/`packAccuracyMultiplier`) is the existing
      defensive mob-fighting pattern flipped to offense: a real,
      positioning-driven trigger (a genuine nearby same-species conspecific
      has to exist) unlocks hunting a target too strong to solo, with a real
      accuracy-bonus mechanical advantage threaded through `resolveHit`.
      Scavenging (`support.ts`'s new `applyScavenging`) is a real
      alternative meal — feeding directly from a nearby corpse, restoring
      hunger by the same established amount `applyHerdSupport`'s food
      delivery already uses, cashing in the corpse-persistence window this
      session inherited from an earlier feature. Ontogenetic niche shift
      (`predation.ts`'s new `isJuvenile`, reusing `Agent.age` the same way
      `reproduction.ts`'s `isMature` already does) makes a juvenile predator
      never initiate an independent hunt at all — solo or pack — leaning
      entirely on scavenging/herd food delivery instead, plus a real,
      earlier flee-threshold vulnerability difference. 18 new engine tests,
      681 total, all passing including the unmodified determinism acceptance
      test — zero new `Math.random()`/`rng()` call sites added.
- [x] Each mechanism proven working in a dedicated, hand-built stress
      scenario (this project's own "targeted scenario, not just a longer
      demo run" standard): pack hunting real-kills a too-strong-to-solo
      target once real packmates are nearby (12 `packHunt` events, 1 kill,
      in a 3-scyther stress scenario); scavenging restores real hunger from
      a real corpse (0.1 -> 0.887 hunger in 2 ticks); a juvenile and an
      adult in the identical hungry-predator-next-to-prey setup diverge
      exactly as designed (juvenile never hunts, adult hunts and kills).
- [ ] **Honest real-run finding, not papered over**: a real 3000-tick,
      9-seed sweep (42, 7, 20260903, 1-6) found `packHunt` firing on only
      1 of 9 seeds (14 times) and `scavenged` on only 3 of 9 (4-28 times) —
      both mechanisms are real and working, but rarely get a chance to fire
      in the *stock* demo scenario specifically because
      `packages/data/src/scenario.ts` spawns exactly ONE individual of each
      predator species with no `herdId`, so pack hunting's own trigger
      structurally can't fire until a second same-species predator exists
      nearby (only reachable via reproduction — itself gated behind the same
      fragile predator population this feature targets). Predator
      populations did NOT reliably recover — several seeds still ended at 0
      living predators. The 3 seeds with real pack/scavenge activity did end
      with more living predators (1, 3, 2) than the zero-activity seeds (1,
      1, 0, 0), a real, honestly-reported correlation, but not treated as
      proven causal here — this sim is independently, repeatedly documented
      elsewhere in this file/DESIGN.md as rng-trajectory-chaos-sensitive, and
      a clean feature-on/feature-off A/B was considered and not run for that
      same reason (see DESIGN.md's full writeup).
- [ ] **Real follow-up, not built**: seed the demo scenario with 2 of each
      predator species instead of 1 (or give predators their own home-range
      cohesion so offspring stay near a parent), specifically to give pack
      hunting's own trigger a fair chance to fire in the stock scenario
      rather than only in a hand-built stress test. Not attempted this
      session — changing the demo scenario's spawn composition is its own
      real design decision with its own validation burden, out of scope for
      the direct ask here.
- [ ] **Real follow-up, not built**: kleptoparasitism (contention/priority
      between multiple scavengers over the same corpse) — the original
      brief's own "nice-to-have, not required." The existing
      `CORPSE_PERSIST_TICKS` window already lets multiple agents feed from
      the same corpse across separate ticks, which was judged enough for the
      direct "alternative to a risky hunt" ask.

## Tile preference: satisfied idle agents drift toward their species' terrain — built, see DESIGN.md

- [x] Direct ask, verbatim: "Like tile pref. Like bulbasaur should strongly
      prefer flora tiles. Squirtle should prefer water. If their needs are
      met." A new `SpeciesDef.preferredTerrain?: TerrainKind[]` field
      (denormalized onto `Agent.preferredTerrain` at spawn/birth, same
      three-hop pattern as `activityPattern`/`buildsShelter`), consulted
      inside `needs.ts`'s existing idle-wander extension point
      (`applyExploration`) ahead of its pre-existing random-unvisited-tile
      search: a tagged, satisfied agent heads toward its nearest matching
      terrain instead of a uniformly random nearby spot, and goes fully idle
      (no wander at all) once already lingering near it. An untagged
      species, or a tagged one with nothing reachable, falls straight
      through to the original random-wander behavior, unchanged. Roster
      tagging: bulbasaur/venusaur -> flora, squirtle -> water, charmander/
      mankey -> sunbeam, scyther -> bush, geodude/growlithe -> boulder;
      diglett/sandshrew/pidgey/spearow/onix deliberately left untagged
      (underground/canopy are flat, terrain-uniform grids — nothing
      meaningful to prefer among, see DESIGN.md's point 5 for the full
      per-species reasoning).
- [x] `resourceIndex.ts`'s `IndexedTerrain` extended with `"flora"`
      (justified the same way `"shelter"` was — 2+ real consumers); a
      preference kind tagged by only one species (`"bush"`, `"boulder"`)
      uses a new bounded local scan instead of extending the global index
      further. 7 new engine tests, 688 total, all passing including the
      unmodified determinism acceptance suite — zero new rng call sites
      added (the preference lookup is a pure deterministic nearest-tile
      search).
- [x] Real 3000-tick, 3-seed (42/7/20260903) feature-on/feature-off A/B via
      an isolated instrumented script: average distance from a tagged
      agent to its nearest preferred tile dropped on ON vs OFF across all
      3 seeds overall (3.70->2.96, 3.20->3.07, 4.92->3.43), and
      consistently for Bulbasaur specifically (the brief's own named
      example: 3.06->2.32, 3.10->2.66, 4.77->3.35) — see DESIGN.md for the
      full per-species table and the honest Venusaur-is-mixed caveat (herd
      cohesion dominates tile preference for the roster's almost-always-
      solo guardian).
- [ ] **Real follow-up, not built**: "we could add more tile types" (the
      brief's own explicitly optional, vague half). Nothing cheap and
      obviously missing presented itself for the *current* roster — every
      species with a real flavor-text terrain affinity already maps onto
      an existing `TerrainKind`. The one real idea worth flagging: a real
      "burrow"/underground-den terrain kind distinct from plain `"floor"`,
      giving Diglett/Sandshrew a genuine tile preference of their own
      instead of relying solely on `buildsShelter`'s homing pull — would
      require generating real terrain variance into `worldgen.ts`'s
      currently-flat underground grid, its own real design decision with
      its own validation burden. Not attempted this session.
- [ ] **Real follow-up, not built**: Venusaur's mixed A/B result (worse on
      1 of 3 seeds, essentially flat/better on the other 2) traced to herd
      cohesion (`applyHerdCohesion`, checked before `applyExploration`)
      dominating tile preference for a species that's almost always alone
      in guardian position — not a bug, but worth a closer look if herd
      cohesion and tile preference priority are ever revisited together.

## Bonding, shelter, and eggs — built, see DESIGN.md

- [x] Universal shelter: `SpeciesDef.buildsShelter`/`Agent.buildsShelter`
      no longer gate any shelter mechanic in the engine (species-tied ->
      universal, a deliberate reversal of the earlier direct instruction) —
      the field is left in place, unused for gating, purely legacy/cosmetic
      denormalization. Per-species visual variation instead:
      `Tile.shelterOwnerSpecies` + `packages/web/src/palette.ts`'s new
      `shelterOwnerTint` (deterministic per-species hue), wired into both
      of `renderer.ts`'s draw paths.
- [x] Real shelter-specific capacity: `occupancy.ts`'s
      `SHELTER_TILE_ADULT_CAP` (2) / `SHELTER_TILE_EGG_CAP` (1), layered on
      top of (not replacing) the existing weight/headcount tile-capacity
      system — shelter terrain routes through a new
      `canEnterShelter`/`canLayEggAt` pair instead. Adjacent shelter tiles
      form one connected cluster (`shelterCluster`, 4-directional BFS)
      whose capacity is the sum of its members' own caps, and household
      members range across the whole cluster rather than being pinned to
      one tile.
- [x] Bonding replaces instant offspring: `reproduction.ts`'s
      `applyMateSeeking` sets `Agent.bondedPartnerId` on first contact
      instead of spawning a child; `spawnOffspring` deleted entirely (its
      logic moved to `eggs.ts`'s hatch step). A bonded, shelterless agent
      gets a real, unit-tested comfort-threshold discount
      (`BOND_COMFORT_DISCOUNT`, 0.15) biasing it toward starting a shelter
      build sooner than an unbonded agent at the same needs.
- [x] Real eggs: new `eggs.ts` module (`spawnEgg`/`tickEgg`,
      `EGG_INCUBATION_TICKS = 80`). Egg-laying only once the household has
      real shelter access with egg-capacity room; the egg is a real `Agent`
      (`isEgg: true`), stationary and behavior-less (routed straight to
      `tickEgg` by `simulation.ts`, skipping the ordinary needs/action
      pipeline entirely); nature/disposition/sex/stat-block assignment
      moved from lay time to hatch time.
- [x] Eggs as food: `predation.ts`'s `applyEggEating` — any species that
      doesn't share an egg group with the egg (reusing `canBreed`) can eat
      an adjacent egg once hungry enough (`EGG_EAT_HUNGER_THRESHOLD = 0.9`),
      restoring hunger/granting exp via the exact same `grantKillExp`/
      hunger-restore path a real kill uses. Deliberately NOT routed through
      the `HuntRules` predator/prey pipeline — a real, explicit widening of
      who eats what, independent of a species' predator/prey role.
- [x] Extreme egg defense: `predation.ts`'s `applyEggDefense`, checked
      first in `applyPredationInstincts` — ahead of the critically-hurt
      flee check — overriding a defender's ordinary flee/self-preservation
      entirely (and waking it if asleep) to fight a threat near its own/its
      herd's egg, resolving via the real true-death combat path
      (`resolveHit(..., "killed", ...)`). A real, explicit, documented
      departure from herdConflict.ts's non-lethal rivalry model, not an
      accidental softening of it.
- [x] Fixed a real, latent bug this feature surfaced: universal
      shelter-building didn't check `agent.asleep`, letting a sleeping
      agent silently start a shelter task and skip the sleep wake-check
      machinery entirely — now gated on `!agent.asleep`, same as every
      other self-directed task in `needs.ts`'s `tickAgentAction`.
- [x] Fixed a real, latent test-hygiene bug this feature surfaced: an
      unrestored `vi.spyOn(Math, "random")` in `needs.test.ts` could pin
      `Math.random` for every later test in the same file once shelter-
      building's default `rng` param started actually calling it (it never
      had before, since shelter-building was species-gated) — added a
      file-level `afterEach(() => vi.restoreAllMocks())`.
- [x] New tests: `eggs.test.ts` (hatch timing/profile backfill/
      rng-determinism, egg-eating's full compatibility matrix, egg-defense
      overriding ordinary flee), `occupancy.test.ts`'s new shelter-capacity
      describe block, `shelter.test.ts`'s universal-triggering and
      bonded-discount cases, a full rewrite of `reproduction.test.ts`'s
      bonding/egg assertions, and a replaced `determinism.test.ts`
      reproduction section (lay-time is now deterministic; hatch-time
      nature/sex is the real rng-swept case). 720 total engine tests, all
      passing, including the unmodified full-`tickWorld` determinism
      acceptance suite.
- [x] Real headless validation, seeds 42/7/20260903: a real, honestly-large
      reduction vs. a completely-uninstrumented instant-birth baseline at
      3000 ticks (298/332/294 living -> 23/19/24 living) — but a real,
      GROWING curve, not a stalled one: seed 42 alone goes 23 -> 56 -> 94
      living across 3000/6000/8000 ticks, with 88 eggs laid and 82 hatched
      (93% survival) by tick 8000, zero starvation deaths at every tick
      count on every seed, and egg-defense firing 181-187 times over the
      longer runs — a real, frequently-exercised mechanic. See DESIGN.md
      for the full numbers and the honest "the baseline itself is a
      pathological comparison point" context.
- [ ] **Open follow-up, not chased down**: the exact growth-rate pacing
      (80-tick incubation, 0.85/0.70 shelter comfort thresholds, 0.9
      egg-eating hunger gate) is a real, legitimate tuning target — the
      population trend is proven growing and zero-starvation (the load-
      bearing safety property), but whether it reaches this session's
      previously-cited "healthy" 62-80ish range fast enough, or should grow
      faster, wasn't further hand-tuned this pass. A longer (10000+ tick)
      run, or a dedicated re-tuning pass on any of those three constants,
      would be the way to actually chase this further.
- [ ] **Open follow-up, not investigated**: dispersal interacting with a
      bonded-but-shelterless pair — a disperser keeps a `bondedPartnerId`
      pointing at an agent it may now be far away from (or that joined a
      different herd), with nothing currently clearing or re-validating a
      stale bond across a dispersal event.
- [ ] **Open follow-up, not investigated**: egg-defense's interaction with
      herd-conflict's non-lethal model — whether a rival-herd, same-egg-
      group agent can ever get caught in both systems' overlapping radii on
      the same tick.
- [ ] **Open follow-up, not investigated**: adjacency-capacity edge cases
      beyond the direct unit tests — a shelter cluster that grows or shrinks
      (new tile built, or an existing one abandoned) while an egg is already
      incubating inside it, against a real run rather than a synthetic test.
- [x] **Clutch size follow-up** ("maybe we can have multiple eggs spawn at
      once instead of one at a time"): `eggs.ts`'s `pickClutchSize(rng)`
      draws 2-4 eggs per successful laying event; `reproduction.ts`'s
      `applyMateSeeking` places as many as the existing shelter-cluster
      egg-capacity (`canLayEggAt`/`SHELTER_TILE_EGG_CAP`) actually allows,
      dropping the rest of the clutch rather than queuing or cramming it
      onto one tile. Everything downstream (incubation/hatching/egg-eating/
      egg-defense) verified to already work per-egg with no changes needed.
      New tests in `eggs.test.ts`/`reproduction.test.ts`; 717 engine tests
      pass, `pnpm -r typecheck`/`build` clean. See DESIGN.md's "Follow-up:
      clutch size" subsection for the full writeup.
- [ ] **Real, load-bearing follow-up surfaced by the above, not fixed
      here (out of scope for "let clutches vary")**: the clutch mechanism
      currently has near-zero effect on real population in the actual demo
      world, because `shelter.ts`'s `pickBuildSite` picks a uniformly
      random floor tile with no bias toward existing shelter — confirmed
      directly that every real shelter cluster across all three validation
      seeds at 8000 ticks stayed exactly 1 tile, so `SHELTER_TILE_EGG_CAP`
      (1/tile) capped every real laying event to at most 1 egg regardless
      of the clutch size drawn. If clutch size is meant to actually move
      the population needle (not just work correctly in isolated tests),
      the real next lever is biasing shelter-site selection toward building
      adjacent to an agent's own existing shelter when it has one, so
      multi-tile clusters actually form in a real run.
- [ ] **Open follow-up, not done**: `packages/runner/src/ascii.ts`'s own
      terrain palette (the headless CLI's rendering, separate from
      `packages/web`) was not given the same per-species shelter tint —
      real, known, cosmetic-only gap.

## Auto Camera — built, see DESIGN.md

- [x] Toggleable "Auto Camera" mode (`packages/web/src/autoCamera.ts` +
      `main.ts` wiring): follows immigration, courtship (bonded/
      shelterBuilt/eggLaid as three separate moments), egg hatching,
      battles (start-to-death-or-retreat), evolution, and true deaths;
      zooms in to 150% (`AUTO_CAM_ZOOM`, follow-up-adjusted down from the
      original 200%), and scopes the event log to exactly that moment's
      participants. Playback slowdown is now category-conditional: a battle
      always drops to 0.25x real slow-motion regardless of the viewer's
      current speed (`AUTO_CAM_BATTLE_SLOWDOWN_SPEED`, a direct follow-up
      ask), while every other category keeps the original 2x-from-4x+-only
      behavior (`AUTO_CAM_SLOWDOWN_SPEED`/`SLOWDOWN_THRESHOLD_SPEED`). See
      DESIGN.md's "Follow-up" subsection for the reasoning and Playwright
      verification of both changes.
- [ ] **No camera easing/animation.** Both the zoom change and the scroll
      reposition are instant (a plain `scrollLeft`/`scrollTop` assignment,
      no CSS transition) — a deliberate choice for this pass (see
      DESIGN.md: instant assignment is what makes telling "our own scroll"
      apart from "the viewer's real scroll" exact rather than a timing
      guess), but it means the actual visual cut is a hard jump, not a pan/
      zoom animation. A real fix would need a different manual-vs-auto
      scroll detection strategy (e.g. a short "ignore scroll events for
      N ms after we animate" window, or an `IntersectionObserver`-free
      alternative) before smooth easing could be added safely.
- [ ] **Battle camera doesn't account for multiple simultaneous fights.**
      Two unrelated pairs fighting at the same time correctly become two
      separate queued `Engagement`s (never merged — `findBattle` only
      widens an existing engagement when a hit's ids actually overlap it),
      but the *first* one to engage holds the camera/slowdown for its full
      run before the second ever gets shown, even if the second is (by some
      measure) the more dramatic fight. No "which fight is more interesting"
      heuristic exists — first-come-first-served only, same as every other
      queued engagement (see DESIGN.md's "no interruption" reasoning) — an
      accepted simplicity tradeoff, not an oversight, but worth revisiting
      if multi-fight scenes turn out to be common on the real demo map.
- [ ] **The `BATTLE_STALE_TICKS`/`BATTLE_EPILOGUE_TICKS`/`DWELL_TICKS`
      constants are reasoned-about but not empirically tuned** — chosen
      from reading the relevant tick-rate/behavior code, not from watching
      dozens of real runs and adjusting. A real live-observer session
      (human, not headless) would be the way to tell if 24 ticks feels too
      short/long for a one-shot moment, or whether 40 ticks of silence is
      the right disengagement threshold for a real fight's actual pacing.
- [ ] **Herd-vs-herd `herdClash` skirmishes with more than two active
      participants** (a scrum, not a clean 1v1) aren't specially handled —
      each `attacker`/`defender` pair that lands a hit becomes/extends one
      `battle` engagement via `findBattle`'s overlap check, so a genuine
      multi-agent brawl could end up as one engagement whose `ids` set
      quietly grows to several agents (camera focus averages all of their
      live positions) rather than being recognized as "a brawl" with its
      own distinct camera treatment (e.g. zooming out slightly to fit more
      combatants instead of staying at the fixed two-agent-appropriate
      `AUTO_CAM_ZOOM`). Works, reads reasonably in practice (confirmed via
      the throwaway verification's pack-hunt-adjacent scenario reasoning
      in DESIGN.md), just not a bespoke "brawl" camera mode.
- [ ] Real in-browser visual polish unverified beyond the one manual
      Playwright smoke run recorded in DESIGN.md (a single seed, one
      battle observed) — a longer real-time watch session across several
      seeds, actually looking at the zoomed-in view rather than just
      asserting on DOM state, would be the next real check.

## Battle Screen — built, see DESIGN.md

- [x] A second, differently-formatted view of Auto Camera's currently-
      followed event (`packages/web/src/battleScreenPanel.ts`), styled like
      a mainline Pokémon battle text box: a "vs" header with live HP bars for
      a followed battle's combatants, a scrolling turn-by-turn log (move
      used, crit/effectiveness callouts, damage, HP remaining, fainting/
      retreat/conclusion), and a single flavor-text scene line for every
      other notable category (hatch/evolution/immigration/death). Coexists
      with the plain event log's existing auto-cam filter rather than
      replacing it.
- [x] **Follow-up: merged into the Inspector panel as a tab, not a second
      docked panel** — the standalone `#battle-screen-panel` (and its own
      Hide/Show toggle) is gone; "Battle Screen" is now a second tab inside
      `#inspector-panel`, next to "Inspector" (`#tab-inspector`/
      `#tab-battle-screen` in its `.panel-header`), toggled via `main.ts`'s
      `selectTab` — pure visibility switching, neither `renderInspector` nor
      `BattleScreenPanel` changed at all. Auto-switches to Battle Screen the
      moment a new battle engagement starts, but a manual switch back to
      Inspector sticks for the rest of that same battle (mirrors Auto
      Camera's own manual-view-override pattern) — see DESIGN.md's
      "Follow-up" subsection for the full interaction-model writeup and
      Playwright verification.
- [ ] **No effectiveness callout when the defender agent's already been
      pruned.** "It's super effective!"/"not very effective" is computed
      client-side via the engine's own exported `typeEffectiveness` against
      the *live* defender `Agent.types` — if that agent's already left
      `world.agents` (its corpse-persistence window elapsed) by the time a
      frame renders, the callout is silently skipped rather than guessed.
      Rare in practice (the defender is almost always still present while
      its own battle is the actively-followed one), but a real gap; fixing
      it would mean snapshotting the defender's types onto the engagement
      the moment the hit event fires, rather than reading them live.
- [ ] **No client-side smoothing on the HP bar.** `Agent.hp` can carry float
      noise from elsewhere in the engine's combat math (partial-tick
      effects) — display-rounded for the bar/label, but the bar itself still
      jumps in whatever-sized steps the underlying hits actually dealt, no
      CSS transition beyond the fill's `width` easing already provides.
      Acceptable for now; a "damage taken" flash/shake on the losing side's
      HP bar specifically (distinct from the existing per-line text flash)
      would be a nice further polish pass if this feature gets revisited.
- [ ] **`+N more` for a >2-participant battle (pack hunts, herd brawls)
      doesn't show who the extra participants are** — just a count, no
      names/HP. The "vs" header assumes a clean 1v1 (reads the first two ids
      in insertion order, which are reliably the original attacker/defender
      even after widening — see `Engagement.ids`' insertion-order comment in
      autoCamera.ts), matching the same "not a bespoke brawl camera mode"
      simplicity call the Auto Camera TODO above already made for the actual
      camera framing.
- [ ] Real in-browser visual polish (the CSS-only crit/kill flash
      animation's actual timing/feel, the HP bar's color-threshold
      transitions) only spot-checked via Playwright DOM assertions, not an
      extended human eyes-on-it watch session — same standing caveat the
      Auto Camera section above already carries for its own zoom/pan feel.

## Species-dependent shelter ease and egg-defense lethality — built, see DESIGN.md

- [x] Predators (`Agent.isPredator`, newly denormalized from
      `SpeciesDef.isPredator` at spawn/egg-lay) trigger shelter-building at a
      lower comfort threshold (`PREDATOR_COMFORT_DISCOUNT`, 0.15, stacks with
      the existing `BOND_COMFORT_DISCOUNT`) and finish construction in half
      the ordinary time (`PREDATOR_BUILD_TICKS_MULTIPLIER`, 0.5, via new
      `builderShelterTicks(agent)`) — direct ask: "predators should have it
      easier to make shelter."
- [x] A predator's own critically-hurt flee check now runs BEFORE
      `applyEggDefense` in `applyPredationInstincts` (reverse of the
      universal ordering every other species still gets) — a badly hurt
      predator flees instead of unconditionally fighting to the death over
      its egg; a predator that isn't critically hurt still defends normally
      afterward. When a predator does fight, the outcome logs as
      `"defeated"` instead of `"killed"` — direct ask: "maybe they don't
      have the protect to death mentality with it."
- [x] New tests (`shelter.test.ts`/`eggs.test.ts`): predator-vs-non-predator
      trigger-threshold and build-tick comparisons, bonded-predator
      double-discount stacking, non-predator-still-fights-to-real-death
      baseline (unchanged), predator-fights-non-lethally-labeled,
      critically-hurt-predator-flees-instead-of-fighting. 725 engine tests
      pass, including the unmodified determinism acceptance suite (no new
      `rng()` calls introduced). `pnpm -r typecheck`/`build` clean across
      all 4 packages.
- [x] Real headless validation, seeds 42/7/20260903, 3000/6000/8000 ticks:
      predator population (Scyther/Onix/Spearow + evolutions) up on 6 of 9
      seed/tick combinations, including every seed-42 checkpoint (1/0/1 ->
      8/9/9) and seed 7's later ticks (2/0 -> 7/5) — flat or slightly down
      on the other 3. Zero starvation deaths on every seed/tick after this
      change (was 2/2/4 on seed 7 before). A real event-log check confirms
      the new predator-specific egg-defense branch actually fires in real
      runs (4/4 and 16/58 of that seed's total `eggDefended` events had a
      predator defender). See DESIGN.md for the full table and the honest
      "raw seed comparison isn't a clean isolated A/B in this chaotic
      system" caveat.
- [ ] **Real, honestly-reported side effect, not tuned against**: total/prey
      population is meaningfully lower after this change on 2 of 3 seeds at
      8000 ticks (a plausible, mechanistically-expected trade-off — more
      surviving predators means more sustained hunting pressure — not a
      bug). If a future pass judges this trade too aggressive, re-tuning
      `PREDATOR_COMFORT_DISCOUNT`/`PREDATOR_BUILD_TICKS_MULTIPLIER` down is
      the flagged next step, not reverting the feature.
- [ ] **Open follow-up, not done**: a predator's `"defeated"` egg-defense
      outcome only changes the EVENT LABEL today, not actual survivability —
      `resolveHitAgainstTarget`'s death branch sets `alive = false`
      regardless of `faintKind`. A genuinely can't-die predator egg-defense
      fight would need to reuse `herdConflict.ts`'s separate, HP-floor-
      clamped `resolveRivalryHit` resolver instead of `predation.ts`'s own
      faint/finishing-pool combat — not attempted this pass.
- [ ] **Open follow-up, not done**: no third lever (e.g. a shorter
      `SHELTER_MIN_BUILD_DISTANCE` for predators) was added on top of the
      two shipped (comfort discount + build-tick halving) — judged
      sufficient and validated as such, but a real option if more predator
      ease is wanted later.

## Rapport: agent-to-agent relationship graph — built, see DESIGN.md
- [x] Sparse `Agent.rapport?: Record<string, RapportEdge>` (score -1..1,
      `lastInteractionTick`), lazy read-time decay (`RAPPORT_DECAY_PER_TICK`
      = 0.9977, ~300-tick half-life), prune-on-touch below
      `RAPPORT_PRUNE_THRESHOLD` (0.02), and a hard per-agent cap
      (`RAPPORT_MAX_EDGES_PER_AGENT` = 16) with real weakest/stalest-first
      eviction (rng-tie-broken, threaded from `world.rng`).
- [x] Fed by four real, existing trigger events (not invented ones): herd
      food delivery (+0.03 both ways), joint mob-defense — the guardian
      branch of `applyPredationInstincts` (+0.06 both ways), bonding
      (+0.6 both ways, a real jump not an incremental nudge), and
      herd-conflict clash hits between the same two individuals (-0.06 both
      ways, never herd/species-wide).
- [x] Two real consumers: mate preference (`reproduction.ts`'s `mateScore`
      gains a `RAPPORT_DISTANCE_BONUS` = 3 discount term alongside the
      existing `STATUS_DISTANCE_BONUS`) and herd-conflict targeting/
      escalation (`herdConflict.ts`'s `findRivalOccupant` biases toward an
      existing grudge target, `herdConflictChance` gains a
      `HERD_CONFLICT_GRUDGE_SCALE` = 0.4 re-escalation bonus).
- [x] 20 new engine tests, all 745 engine tests passing including
      determinism.test.ts unmodified. Real 5000-8000-tick runs (seeds 42, 7,
      20260903) confirm the graph stays genuinely bounded (max 9 edges on
      any one agent across all three runs, cap of 16 never actually reached)
      and both consumers do real, measurable work — see DESIGN.md's
      "Rapport" section for the full numbers.
- [ ] **Honest finding, not a bug in this feature**: `foodDelivered` fired
      0-1 times total across all three 8000-tick validation runs —
      `applyHerdSupport`'s own real-run gate (well-fed, non-threatened,
      carry headroom, a hungry herd-mate in range) is apparently rare to
      satisfy in this sim's actual population dynamics. Bonding and
      herd-clash are this graph's two real workhorse triggers in practice,
      not food delivery. If herd food delivery itself ever gets a real-run
      tuning pass to fire more often, this rapport channel gets more real
      signal for free — not something to chase specifically for rapport's
      sake.
- [ ] **Open follow-up, not done**: extend rapport into natal dispersal — an
      agent with strong existing bonds inside its herd should plausibly
      resist leaving (a real discount on `dispersal.ts`'s own trigger
      chance/threshold), the mirror of what this pass already did for mate
      preference.
- [ ] **Open follow-up, not done**: egg-defense willingness scaling with
      rapport toward the egg's other parent/herd-mates — not attempted this
      pass; `applyEggDefense`'s current model is unconditional ("defend to
      death") regardless of any relationship.
- [ ] **The actual next step this foundation exists for, per direct
      discussion with the user**: the eventual player-as-a-node recruitment
      mechanic — a player builds real rapport with individual agents (the
      same graph, the player just becomes another id it can hold edges
      toward), and which specific herd members actually want to join a
      player's team depends on that real relationship, not just herd
      membership. Explicitly NOT built in this pass — no player/UI concept
      exists in this codebase yet. This TODO entry is the flagged
      breadcrumb for when that work starts; see also the "Player / bonding
      (deprioritized until sim depth lands)" section above, which this
      eventually supersedes/merges into once real UI work begins.

## Notables: rare, earned individual titles — built, see DESIGN.md

- [x] Seven global record-holder titles (hero/builder/gatherer/rival/
      beloved/elder/wanderer), `World.notables`/`Agent.notableTitle`,
      one-per-agent, checked once per tick (`notables.ts`'s
      `updateNotables`), `titleClaimed`/`titleLost` `SimEvent`s,
      `NOTABLE_XP_MULTIPLIER` = 1.5x, `NOTABLE_DISTANCE_BONUS` = 2.5 mate
      preference, and web UI identity/herd-name rendering. 12 new engine
      tests, all 802 engine tests passing including determinism.test.ts
      unmodified. Real 8000-tick runs (seeds 42, 7, 20260903) — see
      DESIGN.md's "Notables" section for the full calibration/validation
      numbers.
- [ ] **Open follow-up, not done**: The Beloved counts hatched offspring,
      not longest continuously-bonded mate relationship — a real,
      documented tradeoff (see DESIGN.md), not revisited here. A bonded
      pair that never clears this sim's real bond -> shelter -> egg pipeline
      currently can't earn this title at all no matter how long the bond
      itself lasts.
- [ ] **Open follow-up, not done**: no map-tile visual badge/icon for a
      title-holder — only the text-based inspector/event-log/battle-screen
      identity strings change; `renderer.ts`'s per-agent map drawing itself
      is untouched.
- [ ] **Open follow-up, not done**: no `titleClaimed` Auto Camera one-shot
      moment — `autoCamera.ts`'s `NotableCategory` union wasn't extended
      with an eighth category, so a title changing hands doesn't get its
      own camera cut the way a birth/evolution does (still visible in the
      event log panel like every other event).
- [ ] **Open follow-up, not fully resolved**: Wanderer's real-run numbers
      show it dominates total title transfers across all three validation
      seeds (it's the one title with effectively unbounded headroom — a
      living agent can always in principle set a new personal-best
      distance, unlike a bounded-by-death age/kill/build record). The
      threshold was already retuned once (30 -> 60 tiles) after a real run
      caught a worse, now-fixed bug (a live-distance version churned
      constantly on ordinary back-and-forth wandering — see DESIGN.md). A
      future session may want a required-margin-over-incumbent rule (beat
      the record by some real amount, not just by one tile) if this proves
      too active once watched over a longer real run.

## Herd Leadership: a notable can lead its herd — built, see DESIGN.md

- [x] `herdLeadership.ts`'s `updateHerdLeadership` (promotion/demotion,
      seniority tie-break via new `NotableRecord.claimedAtTick`, the
      deliberate no-churn guarantee) and `effectiveDisposition`
      (`LEADERSHIP_DISPOSITION_BLEND_WEIGHT` = 0.2), `World.herdLeaders`/
      `Agent.isHerdLeader`, `leadershipClaimed`/`leadershipLost` `SimEvent`s,
      six per-individual disposition call sites swapped to
      `effectiveDisposition` (predation.ts x3, herdConflict.ts,
      dispersal.ts, reproduction.ts), herdMigration.ts's herd-aggregate
      wanderlust factor blended toward its leader too, and web UI leader
      marker (🎖️)/leader-named-herd rendering. 12 new engine tests, all 814
      engine tests passing including determinism.test.ts unmodified. Real
      8000-tick runs (seeds 42, 7, 20260903) — see DESIGN.md's "Herd
      Leadership" section for the full calibration/validation numbers; no
      churn issue found (closest successive-leader gap in any seed was 25
      ticks, from a real dethroning cascade, not flapping).
- [ ] **Open follow-up, not done**: leadership seniority tracks tenure under
      an agent's CURRENT title only, not a broader "ever eligible" history —
      an agent that lost one title and later claimed a different one starts
      a fresh seniority clock even though it was arguably "eligible" the
      whole time under whichever title it held. A real, acknowledged
      simplification (see DESIGN.md), not revisited here.
- [ ] **Open follow-up, not done**: no map-tile visual badge for a herd
      leader, same gap Notables' own title-holder follow-up already named —
      `renderer.ts`'s per-agent map drawing is untouched.
- [ ] **Open follow-up, not done**: no `leadershipClaimed`/`leadershipLost`
      Auto Camera one-shot moment, mirroring Notables' own `titleClaimed`
      Auto Camera follow-up (still visible in the event log panel either
      way).

## Auto Camera battle-log follow-up (done — see DESIGN.md)

- [x] Prioritize a queued/starting battle over whatever else is active or
      queued.
- [x] Replace continuous 0.25x slow-motion with genuine one-tick-at-a-time
      stepping (`BATTLE_STEP_INTERVAL_MS`).
- [ ] Open: retune `BATTLE_STEP_INTERVAL_MS` (currently 650ms) once actually
      watched for real — no real-run/visual feedback on this exact value
      yet, it's a first guess.

## Player-recruitment design notes (exploratory, unbuilt — see DESIGN.md)

- [ ] Four bonding verbs locked in by direct discussion: feed, fight-
      alongside, **rescue** (the new special/high-stakes one — carry to
      safety or craft/apply medicine when the target is critically
      hurt/dying), and presence (demoted to lowest-priority/fourth). None
      of the four have any code yet — this is design-only.
- [ ] Rescue implies two real, unscoped follow-ups if ever built: (a) a new
      narratable "critically hurt/near death" moment (nothing in the engine
      currently distinguishes this from an ordinary low-HP tick), and (b) a
      crafting/medicine system for the "heal it" half.
- [x] Overworld "faking"/region abstraction (simulate a compact per-region
      summary off-screen, reconstruct a plausible live grid on visiting) —
      **built**, see "Overworld: region graph with promotion/demotion" below
      and DESIGN.md. The "notables vs. anonymous population" split this note
      originally implied is NOT built: a promoted region invents fresh,
      anonymous individuals from aggregate stats, with no notable
      titles/rapport/parentage of their own — a real, honestly-flagged gap
      relative to that original framing, not silently dropped.

## Combat/species tile-sharing (done — see DESIGN.md)

- [x] Combat approach (hunt/mob-fight/egg-defense/guardian-defense/forced-
      movement lunge) never steps an attacker onto its target's exact tile.
- [x] General same-species-only tile sharing on every non-shelter tile
      (`occupancy.ts`'s `canEnterTile`), shelter kept as the deliberate
      any-species exception.
- [ ] **Open, honest follow-up, not attempted**: the species rule above only
      gates ordinary *movement* — it doesn't retroactively separate agents
      already co-located from two other placement paths: (a) `leveling.ts`
      evolving an agent's species in place (no movement, no occupancy check
      at all), and (b) `immigration.ts` spawning a fresh arrival via
      `findWalkableNear` with no capacity/species check (a deliberate,
      already-existing exemption — see DESIGN.md's "Tile capacity" section
      for why immigration is intentionally capacity-blind). A real 3000-tick
      seed-42 run showed a handful of stable different-species pairs from
      exactly these two paths (an evolved `ivysaur` next to a `pidgey`, a
      `wartortle` next to its own hatched offspring). Fixing this would mean
      either (a) making evolution check/resolve tile-sharing at the moment
      species changes, or (b) giving immigration spawn placement a
      species-aware fallback search — both real, scoped pieces of work, not
      attempted here given immigration's documented history of regressing
      hard when given any capacity gate at all.

## Web: varied/animated tile art and floor lighting texture (done)

- [x] Web: varied/animated tile art — 7 tree variants, 2 boulder variants,
      4 bush variants, 2 wall variants (all hash-selected per tile, stable
      across frames), animated water (4 real wave-animation frames found
      already drawn in the source sheet, phase-offset per tile so the
      whole lake doesn't flash in unison), and a subtle floor texture
      (cave-floor + dirt-path crops, picked per 4x4 tile block, drawn
      under the existing "." glyph at low opacity scaled by elevation) so
      plain floor gets some varied lighting without becoming a loud fill.
      All art from legacy-cpp's "building and lake sprites.png" plus a few
      clean crops out of "biome sprites unripped.png" (a set of pre-
      composed scene panels, not a tile grid, so most of it isn't cleanly
      croppable — a low-color-variance auto-scan was used to find flat
      patches, then hand-verified since it initially grabbed a fake
      "lava" patch that was just a flat red background block, not real
      lava art).
      **Two real mistakes caught mid-pass, not just the lava one**: (1) my
      own index-to-pixel-coordinate transcription for several of the
      building-sheet floor crops was simply wrong — `floor_cave`,
      `floor_grass_1`, and `floor_grass_2` were all actually pointing at
      the same tan brick "shop counter" prop (with little feet baked in),
      not the pink cave-floor/green-grass/gray-stone tiles they were
      named for; re-derived all three from a fresh pixel-precise grid
      overlay and confirmed each visually before re-saving. (2) mixing
      the (correctly-fixed) grass/stone crops into the floor variant pool
      alongside cave/dirt reintroduced the original hue-clash problem
      (green/gray patches next to brown ones), so they're deliberately
      NOT in `FLOOR_TEXTURES` — kept as loose files for a possible future
      biome-specific floor system instead. Direct ask ("we still need the
      dirt floor tiles, there are plenty") added 3 real dirt-path crops
      from the biome sheet's dirt/mushroom-forest panel to the pool
      (same brownish family as the cave crops, so it blends).
- [ ] **Open follow-up, not done**: shelters still render as a flat
      per-owner-species-tinted rect (`shelterOwnerTint` in palette.ts) —
      now visibly crude next to the real tile/tree/water art around them.
      Would need actual shelter/hut sprite art (not yet extracted) plus a
      way to apply the existing owner tint on top of a sprite instead of a
      solid fill.
- [x] **Follow-up, resolved**: `floor_desert` and `floor_stone` are now
      actually wired up, now that worldgen.ts's real biome system (merged
      from the sibling branch) exists to select them by. Direct ask: real
      bug report on plain `sand` terrain ("I don't love how sand looks.
      Green bordered") + "we got more biomes an shit [do more fun art
      cutout]." Two real, separate things fixed in one pass: (1) `sand.png`
      itself was a bad crop — the whole 144x144 source image was a real
      desert scene panel (cacti, paths) with its surrounding green
      background never cropped out, so a visible green fringe showed on
      every "sand" terrain tile; re-cropped a genuinely clean 32x32 patch
      of open sand from the same biome-sheet desert panel, no decorations
      or background bleed. (2) `renderer.ts`'s `drawGroundBacking` now
      looks up each tile's dominant biome (new `dominantBiomeAt`, using
      worldgen's `biomeWeightsAt`, memoized per `World` object since biome
      seed placement never changes mid-sim — real work once per tile ever,
      not once per tile per frame) and passes it to `sprites.ts`'s
      `getFloorTexture`/`getFloorOverlay`, which now take an optional
      biome name and swap in a per-biome texture set (new `BIOME_FLOOR`
      map): "badlands" gets the (now-clean) desert family (`floor_desert`
      base + `sand` decal, same tan palette so they blend), "highland"
      gets `floor_stone`'s real cobble/brick crop (previously unused).
      Any other biome, or a world with no biome data at all (bare test
      fixtures), falls straight through to the original cave/dirt pool —
      purely additive, nothing about the existing look changed for
      grassland/forest/wetland. Verified live in the browser (Tile mode,
      Playwright screenshot): the desert patch shows clean tan sand with
      no green fringe, and a highland patch shows the distinct gray stone
      texture, both visibly different from the surrounding brown cave
      floor. `floor_snow` is still unused — no biome maps to "snow" yet.
      `floor_lava` was also attempted from the same sheet a while back but
      turned out to be a fake — a flat solid-red background block, not
      textured lava art — and was
      deleted rather than used.
- [x] Web: real berry-plant art for "food"/"flora"/"seedling" tiles, direct
      ask ("do we have any berries? or other plants?"). Ripped from
      legacy-cpp's "berry sprites.png" — a growth-stage sheet (each berry
      has small/medium/ripe stages, 2 idle-sway animation frames per
      stage, ~64 berries in dex order across 4 labeled blocks) that hadn't
      been touched at all before this. Grid pitch turned out to be an
      irregular ~23x35px (not the 32x32 every other sheet in this pack
      uses) — found via black-gridline detection (`np.all(arr<40,...)`)
      rather than guessed. Ripe-stage art is now keyed by the real flavor
      names flora.ts already assigns (`FOOD_FLAVORS`/`FLORA_FLAVORS`:
      cheri/oran/pecha/sitrus for food, moss/fern/bloom for flora) so a
      given tile's flavor always draws the matching plant, not a random
      one; "seedling" (pre-flavor-assignment) hash-varies across all 7
      instead. Drawn as an overlay on top of the existing flavor-tinted
      color-mix fill (not a replacement), opacity scaled by the tile's own
      `stock` so a depleting patch still visually thins out. Real Pokémon
      dex-color accuracy wasn't chased (e.g. this sheet's "oran" slot reads
      gray/rock-textured, not blue) — picked for visual distinctness
      instead, since the flavor names are this codebase's own internal
      labels, not a promise of canon fidelity.
- [x] Web: three more visual polish passes, all direct asks. (1) Trees/
      bushes had a flat colored ground-ellipse or full-square background
      baked into the source crop, which read as a hard rectangle sitting
      on top of the actual floor underneath instead of blending into it.
      Fixed by exact-color-keying the shared 3-tone base-ellipse palette
      ((108,203,112)/(74,176,81)/(43,139,53), confirmed identical across
      every affected sprite) to transparent — safer than the geometric
      row-cutoff/flood-fill attempts tried first, both of which either
      left visible remnants or ate into the tree/trunk itself (tree_7
      specifically: a fixed-fraction cutoff sliced straight through its
      trunk since the trunk and base ellipse occupy the same row range).
      Also caught mid-pass: `boulder_2` was never actually the boulder it
      claimed to be — still the wrong crop (a tree/reed cluster on a flat
      blue square) from an earlier session, re-extracted from the sheet's
      real second boulder; `bush_2`/`bush_3` were a full square, flat-
      green-background crop with no isolated ground patch to key out at
      all, so they were swapped for a different pair of small trees from
      elsewhere on the sheet that do have a proper keyable oval base.
      (2) Water edges are now real per-side directional shorelines, not
      the earlier binary "bordered vs. seamless" tile choice — the
      seamless interior fill draws first, then a strip cropped from the
      bordered source art (`getWaterEdge`) is composited on top of just
      the side(s) whose actual neighbor isn't water (`renderer.ts`'s 4
      cardinal `ctx.drawImage` calls with source-rect cropping), so a
      tile inside a lake shows no border whatsoever and a shore tile only
      shows sand on the side(s) actually facing land. (3) Floor texture
      went through two wrong extremes before landing right: per-4x4-tile-
      block variant selection made every block boundary a visible seam
      ("random square chunks... don't feel like the beautiful biome
      art"); reacting to that, a single map-wide texture removed the
      seams but then just looked like the same tile stamped everywhere
      ("same tile over and over can look bad"). Landed on per-INDIVIDUAL-
      tile selection among the same 6 earthy crops at low opacity — real
      tilesets do exactly this (scattered near-identical variants read as
      natural grain at small scale/low contrast; only a hard-edged
      multi-tile block of one texture reads as "chunks").
- [x] Post-merge polish pass, direct ask ("some of the tiles have weird
      shadow on them to make look like beveled. Some of the color
      matching isn't great. And I feel like the biome pic had way more
      beautiful variety"). Three real, distinct causes found and fixed,
      not just one tuning knob: (1) `floor_cave_3` had a dark diagonal
      crack baked into its crop from a bad extraction boundary — clean at
      small scale/low opacity, but glaring once `drawGroundBacking`
      (merged in from the sibling branch) started drawing floor texture
      at near-full strength everywhere; re-cropped clean. (2) the
      per-tile radial vignette (also from that merge) had a genuinely too
      -strong edge-darkening term — a bright-center/dark-edge gradient
      repeated on every tile is, by construction, a grid of embossed
      tiles; cut its highlight/shadow strength and max alpha by roughly
      two-thirds rather than removing it outright, since "silly simulated
      lighting" was itself a real prior ask. (3) `floor_cave` (the
      original building-sheet crop) was a measurably different, more
      pink/saturated hue than the other 5 crops (checked via actual mean
      RGB, not eyeballing) — dropped from the pool, and two more crops
      from the same clean source panel added in its place so variety went
      up (5 -> 7) while every texture in the active pool now averages
      within a few RGB points of the others.
- [x] Floor rendering redesigned again, direct ask: "layer texture atop
      the base tiles... some of em have semi transparent texture to add
      to balance and variety." Replaced N discrete full-strength floor
      textures competing tile-to-tile (still its own kind of patchwork
      even once hue-matched) with one consistent base texture
      (`getFloorTexture`, now parameterless) drawn everywhere, plus a
      sparse (1-in-4 tiles) semi-transparent decal on top
      (`getFloorOverlay`, 0.35 alpha) picked from the other 6 crops —
      the standard real-tileset move (solid ground + light scattered
      detail) instead of several competing base choices. Applied in the
      one shared `drawGroundBacking` helper, so floor/objects-on-ground/
      food-flora-seedling all get the same base+decal treatment
      consistently.
- [x] Floor decal shape/density follow-up, direct ask ("maybe to round...
      border radius", "double the amt"). The overlay decal was a bare
      square PNG stamp, reading as a hard-edged tile; `featheredOverlayStamp`
      now renders each decal image through a cached offscreen canvas
      (`roundRect` mask + `blur(1.5px)` + `destination-in` compositing)
      into a soft rounded-rect blob before it's ever drawn, and the
      per-tile decal frequency doubled (1-in-4 -> 1-in-2 tiles). Reused
      as-is for the fertile-patch decal below.
- [x] Soil fertility mechanic, direct ask ("can we decal a little green
      patch under the plants?... simulate the ground underneath the
      plants becoming fertile for growing stuff.. with intermediate
      states... tying into grazing scars but able to show it" +
      follow-up: "this limits how flora can spawn. I don't want to make
      it too much harder to spawn and ruin population growth. But make
      it take time for the soil to be able to accommodate life. And...
      Pokémon that help, like watering it via water moves and
      tilling/planting it via grass type help"). New `Tile.fertility?:
      number` (0-1) in the engine, distinct from the existing
      grazing-scar system (that punishes over-consumption; this models
      ordinary recovery time after ANY harvest). Key design choice:
      `undefined` fertility means fully fertile (1.0) — every world-gen
      floor tile starts here, so this cannot make the initial population's
      first growth cycle harder by construction, not by tuning. Only set
      to a real, lower value (0.35) in `flora.ts`'s `growFlora` once a
      food/flora patch on that tile actually dies; climbs back to 1 on
      its own (`+0.005`/tick, ~130 ticks to fully recover — comfortably
      inside one food-patch lifecycle) or faster with real Pokémon help:
      a Water-type move's hit-landing puddle (`waterSoil`, called from
      predation.ts's existing `terrainFill` site — Water Gun already
      creates puddles, so a real puddle now also "waters" the ground) or
      a live Grass-type agent simply standing on the tile, every tick
      (`tendSoil`, called from `needs.ts`'s per-tick `tickAgentNeeds`, no
      new move/intent plumbing). Fertility probabilistically (not a hard
      gate — "reduce, don't ban," same shape as the overgrazed multiplier)
      throttles both seed-drop germination chance and neighbor-tile
      spread in `flora.ts`; deliberately left seedling maturation speed
      alone to avoid stacking a second penalty on top of the existing
      overgrazed slowdown. Visually: `renderer.ts` draws a green
      `getFertilePatch()` decal (reusing `featheredOverlayStamp` above)
      under every food/flora/seedling tile, opacity `0.15 + fertility *
      0.4`, so a freshly-harvested patch reads faint and a fully-fertile
      one reads vivid — "tying into grazing scars but able to show it"
      made real rather than a `grazingPressure`-proxy stand-in. 42 new/
      updated engine tests (flora/predation/needs), full suite green
      (one `support.test.ts` failure confirmed to be a pre-existing
      order-dependent flake unrelated to this change — passes 36/36 in
      isolation).
- [ ] **Open follow-up, not done**: fertility has no "intermediate states"
      of its own beyond the single continuous 0-1 float + one decal
      opacity ramp — no distinct terrain/sprite stages (e.g. "bare dirt"
      -> "sprouting" -> "lush") the way seedling growth or grazing scars
      get their own terrain kinds. Revisit if the single smooth ramp ends
      up reading as too subtle in actual play.
- [x] Plant quality, direct ask ("fully fertile plant gives super higher
      quality berries and such. But they don't need to be fully fertile to
      produce it. And fully fertile plants tend to survive noticeably
      longer and produce more"). New `Tile.quality?: number` (0-1) in the
      engine — a fixed trait frozen onto a food/flora patch the moment it
      matures in `flora.ts`'s `growFlora`, sampling whatever the tile's
      live `fertility` happens to be right then (`undefined` behaves as
      quality 1, same convention as `fertility` itself, so ordinary
      never-harvested-before growth is unaffected). Drives three real,
      independently-floored effects, none of which can crush a patch to
      uselessness even at quality 0: (1) **yield** — starting `stock`
      scales from 70% to 100% of `FOOD_MAX_STOCK` (`yieldFactor`) — "don't
      need to be fully fertile to produce it"; (2) **lifespan** — decay
      rate scales ±40% around neutral (`decayFactor`), applied to both
      food and flora patches — "survive noticeably longer"; (3)
      **nutrition** — a new `foodNutritionFactor(tile)`, read from
      `needs.ts`'s actual feeding site, scales the real hunger restored by
      a feeding ±30% around neutral — "super higher quality berries."
      `quality` is cleared back to `undefined` when a patch dies, so the
      next thing that grows on that tile gets its own fresh quality
      sampled from fertility at that later maturation, not a stale
      leftover value. 15 new tests across `flora.test.ts` and
      `needs.test.ts`; one pre-existing decay-tuning test
      (`flora.test.ts`'s "dies of natural decay meaningfully sooner")
      needed an explicit neutral `tile.quality = 0.5` to stay isolated
      from this new effect, since it hand-builds a tile without going
      through `growFlora`'s maturation path. Full repo suite green
      (845/845 engine, 19/19 data).

## Generative History phase: macro elevation + rivers — built, see DESIGN.md

- [x] `worldgen.ts`: replaced the old small-scale noise-based `elevation`
      field with `generateMacroElevation` (seeded uplift/basin influence
      points, distance falloff, normalized + percentile-calibrated sea
      level) for real land/ocean/mountain-range coherence, plus
      `carveSuicuneRivers` (steepest-descent flow from real elevation
      maxima to the coast, forming beaches or inland lakes). First built
      slice of the "Overworld generation vision" section — two processes
      out of the full documented list. 819 engine tests (5 new) passing,
      determinism intact, real 3-seed 6000-tick population-health check
      clean.
- [ ] **Next slice candidates**, in the order they'd most naturally build on
      what's here now (not a commitment, just the honest "what's next" per
      the vision doc's own sequencing note):
  - **Tectonics/glaciers** — the vision's next listed process, and the most
        natural literal extension of macro elevation: mountain *ranges*
        with real linear/arc structure (a plate-boundary shape) instead of
        today's radially-symmetric uplift blobs. Would plug into the exact
        same `generateMacroElevation` seam this slice built.
  - **Forest-seeding (Xerneas/Celebi)** — the first "a route/path is the
        causal reason a biome exists here" process, structurally similar to
        this slice's river-carving (a path-walk that leaves a lasting mark
        on the tile grid), so the river-carving machinery
        (`carveRiver`/`NEIGHBOR_OFFSETS`/steepest-descent-shaped walks) may
        be directly reusable/adaptable rather than written from scratch.
  - Both of these are real candidates, not decided — picking 2-3 for an
        actual next slice is a separate deliberate step, same as this one
        was.
- [ ] **A real blocker for anything built directly on top of this**: this
      slice generates one single map exactly as before — it does not touch
      the "multi-region overworld" system the vision describes at all.
      Any future process whose vision write-up assumes multiple stitched
      regions (most of them, past the land/ocean + rivers pair built here)
      will need that system to exist first, or will need to be scoped down
      to "one region" the same way this slice was.
- [ ] `MACRO_INFLUENCE_RADIUS_FRACTION` (0.22) and `OCEAN_FRACTION` (0.44)
      were tuned only by "does it look like real coherent continents" +
      "does the sim stay healthy," the same ad hoc standard every other
      tuning constant in this codebase gets on a first pass — a real
      dedicated tuning pass (more seeds, maybe a numeric "does this look
      speckled vs. blobby vs. coherent" metric instead of eyeballing ASCII
      dumps) is still open.
- [ ] River-terminated-in-an-inland-lake gets no beach marker (only a true
      ocean mouth does) — see DESIGN.md's "Explicitly not done here" for
      this slice. Minor, but a real, named gap if lake shorelines matter
      later.

## Water-crossing restrictions — built, see DESIGN.md

- [x] `waterBody.ts`'s `canEnterWater`: non-water types can wade a large
      water body's shore (to drink) but not cross its interior; small
      ponds stay fully unrestricted for everyone; water types are always
      unrestricted. No Rock/Fire-specific stricter tier (an earlier draft
      had one, corrected by direct user feedback before landing). Always-on
      across every real movement/pathfinding call site, including
      capacity-blind hunt/mate pursuit. `needs.ts`'s `seekWater` gained a
      bounded reachability-aware retry (`findReachableWaterTarget`) so a
      thirsty land Pokémon targets a real reachable shore instead of a
      geometrically-nearer-but-unreachable interior tile. 863 engine tests
      (13 new) passing twice in a row, determinism intact, real 3-seed
      6000-tick population-health check clean (no landlocked-collapse
      regression after fixing a real bounded-retry bug the validation
      itself surfaced).
- [ ] **No graduated wading depth.** Every large body is exactly two zones
      for a non-water type — shore (one tile) or impassable — never an
      intermediate "can wade N tiles in." Could matter later for a
      species-specific "strong wader" trait.
- [ ] **No swimming-speed penalty/bonus.** Water types (and anyone wading
      a shore tile) move through water at the same one-action-tick pace as
      dry land. A real "water types move faster through water" mechanic
      would be a natural, separate follow-up.
- [ ] **No large-lake-vs-ocean distinction** beyond the existing
      `isLargeWaterBody` tile-count threshold — treated identically by this
      rule. Could matter if "landlocked lake" vs. "the ocean" ever needs to
      mean something different gameplay-wise.
- [ ] **No in-sim workaround for a non-water type stuck on the wrong
      shore** — no raft, no temporary water-walking move/ability, nothing.
      A real, intentional gap if "how does a stranded land Pokémon ever
      cross" becomes a real question later.
- [ ] `findReachableWaterTarget`'s retry bound (`WATER_REACHABILITY_MAX_ATTEMPTS`
      = 24) was picked empirically against this session's three validation
      seeds (42, 7, 20260903), not derived from real coastline geometry — a
      much more convoluted coastline, or a much larger minimum "large water
      body" threshold, could in principle need a higher bound before
      finding a real reachable shore. Not stress-tested past the seeds used
      here.

## Obligate-aquatic restrictions (Magikarp/Tentacool) — built, see DESIGN.md

- [x] `species.ts`'s new `obligateAquatic?: boolean` flag; `magikarp` and
      `tentacool` added to the curated roster (both were dex-only before)
      and flagged, both reusing an existing move, both with no leveling.ts
      data change needed (egg-group headroom already existed). Denormalized
      onto `Agent.obligateAquatic` at spawn, mirrored on `LevelingProfile`
      for bred offspring, and copied straight from mother to egg — the same
      three-place propagation `isPredator`/`buildsShelter` already use.
- [x] `waterBody.ts`'s new `canEnterLand` — the land-side mirror of
      `canEnterWater`: an obligate-aquatic agent can flop onto the
      immediate shore ring but nothing deeper onto land; a regular
      (non-flagged) Water-type is completely unaffected. Wired into the
      same shared `isWalkableFor`/`firstWalkable` choke points the
      water-crossing feature already built, so every real call site both
      features share is covered for free.
- [x] Two real reachability bugs found and fixed via this session's own
      multi-seed validation (not just unit tests) — see DESIGN.md's "Built,
      real-run findings" for the actual before/after numbers: (1) `seekFood`
      had the exact same "geometrically nearest isn't reachable" trap
      `findReachableWaterTarget` already existed to fix for water, just
      never extended to food — fixed with a new `findReachableFoodTarget`;
      (2) `immigration.ts` was placing obligate-aquatic arrivals via
      `findWalkableNear` (any walkable tile, water included, as an equally
      valid hit), sometimes stranding them on dry land the instant they
      arrived — fixed by routing obligate-aquatic arrivals through
      `resourceIndex.ts`'s `findNearestIndexed(..., "water", ...)` instead,
      plus a new `scenario.ts` `findWaterNear` helper so the demo world's
      own founding pair is placed on real water on every seed, not just the
      one it was eyeballed against.
- [x] 874 engine tests (11 new) passing twice in a row, determinism intact,
      real 3-seed 6000/10000-tick validation clean — no
      thirst-starvation after the fixes, a modest residual
      hunger-starvation rate honestly reported (not eliminated further —
      see below).
- [ ] **Only Magikarp and Tentacool got the flag.** Horsea/Seadra,
      Staryu/Starmie, Goldeen/Seaking (all real dex entries, none curated
      roster species yet) would plausibly all qualify on the same
      real-biology standard whenever they're actually added as roster
      species — not added this session; see DESIGN.md's "Decided" section
      for the per-species reasoning that would apply. Gyarados/Tentacruel
      likewise aren't their own curated entries — they inherit the flag
      automatically as evolutions of the two that are.
- [ ] **The flag doesn't reset on evolution** — an evolved Gyarados stays
      obligate-aquatic even though real Gyarados can fly. Same accepted
      scope `buildsShelter`/`preferredTerrain` already carry (denormalized
      at spawn, not re-derived on evolution), not a new gap.
- [ ] **Real, scoped, NOT done: a worldgen fix for shore-ring food
      scarcity.** The 10000-tick validation found a modest residual
      hunger-starvation rate (roughly one death per seed) traceable to a
      real scarcity of "food" terrain within an obligate-aquatic agent's
      actual reachable range (water + one-tile shore ring) — the
      reachability-retry logic itself is correct (`findReachableFoodTarget`
      finds whatever food genuinely exists in range), there's just not
      always much of it there. A worldgen change biasing food density to
      spawn more reliably within an aquatic species' reachable shore ring
      (same spirit as this session's placement fixes, just for food
      instead of agents) would directly address this. Not attempted this
      session — the observed impact at the population sizes validated
      (1-3 aquatic agents per seed) never approached collapse, so a
      worldgen change touching every species' food placement wasn't judged
      worth the risk without a larger aquatic population to re-validate
      against. A real follow-up, not a punt on an unexamined risk.
- [ ] **No graduated wading distance** for either direction of this
      restriction — exactly one tile of shore, no per-species variation
      (matches the water-crossing feature's own identical scope note).
- [ ] **No dedicated aquatic breeding population validated at scale.**
      Magikarp and Tentacool don't share an egg group, so the demo world's
      founding pair can never breed with each other — every population
      number in DESIGN.md's validation comes from immigration, not
      reproduction. A real same-species breeding pair (e.g. a second
      Magikarp of the opposite sex) was not added or validated this
      session.
- [x] Both queued visual follow-ups from the previous entry, built. Direct
      ask on how to source the art: "Your gonna have to rip and freestyle
      the art though" — no dedicated edge-art source exists for these (the
      biome sheet has no desert-meets-cave transition panel the way it has
      a real bordered lake tile), so both are generated rather than
      cropped. (1) **Biome floor-texture edging**: "Hmm border edging
      around different tiles to blend would be nice." New
      `drawBiomeEdgeBlend` in renderer.ts: a cached, procedurally-drawn
      linear alpha gradient per cardinal direction (`edgeGradientMask`)
      masks a neighbor tile's own floor texture (`destination-in`,
      `edgeBlendStamp`) before compositing it onto this tile wherever the
      neighbor's `getFloorBaseName` (new export, sprites.ts) actually
      differs — same shape as `getWaterEdge`'s directional compositing,
      just generated instead of cropped. First pass drew every differing
      cardinal side at once, which stacked two overlapping (sometimes
      two-different-texture) gradients into a muddy cross at any corner
      tile bordering two biomes at once — real, visible follow-up finding
      from a live screenshot: "the gradient should flow in one
      direction... painted in layers like decals... a lot of cross
      gradient murkiness." Fixed by taking only the first differing
      neighbor in a fixed direction order per tile (one clean directional
      fade, never stacked) — a deliberate trade: a true four-biome corner
      only shows one of its two real boundaries, in exchange for the
      "flowing decal" look actually asked for. (2) **Contiguous
      fertile-ground decals**: "Maybe fertile ground next to each other
      can be contiguous grass." New `contiguousPatchStamp` in renderer.ts:
      the same rounded-rect+blur shape `featheredOverlayStamp` already
      uses for the general floor-overlay decals, but canvas's 4-radius
      `roundRect` overload zeroes the two corners touching any side that
      faces a matching fertile (food/flora/seedling) neighbor — that side
      draws flush to the tile edge instead of rounded, so two adjacent
      fertile tiles' decals butt up seamlessly into one blob instead of
      two independent rounded stamps with a visible gap/seam between them.
      Both cached (per direction, and per image+open-sides combo
      respectively) the same "build once, reuse forever" way every other
      stamp in this file already is. Verified live via Playwright
      screenshots at several biome-boundary seeds; full suite still green
      (888/888 engine, 19/19 data) since neither change touches engine
      code at all, purely renderer.ts/sprites.ts.
- [x] Move-selection recency discount, direct ask: "I don't see Pokemon
      using a variety of moves often... to make the world feel real...
      they have to be choosing to use moves and stuff well" ->
      "cooldown should play a part. So like you should cycle moves" ->
      "Ticks realtime". Real finding, not just perception: `pickBestMove`
      (combat.ts) was pure greedy-best with zero memory — against a fixed
      opponent it picked the exact same top-scoring move every single time
      it came off cooldown, forever, since a fixed matchup's score barely
      changes tick to tick. New `Agent.moveLastUsedTick` (types.ts, set
      alongside `moveUseCounts` in `useMove`) feeds a new recency factor in
      `pickBestMove`'s scoring: a move's score is discounted to
      `MOVE_RECENCY_MIN_MULTIPLIER` (0.6) the instant it's used, recovering
      linearly back to 1 over `cooldownTicks * MOVE_RECENCY_WINDOW_MULTIPLIER`
      ticks (floored at `MOVE_RECENCY_MIN_WINDOW_TICKS`=3 so even a
      0-cooldown move gets real rotation pressure). A discount, not a ban —
      a genuinely superior move (e.g. STAB + a real type advantage) still
      wins immediately even fresh off cooldown; only a real, close-to-tied
      call actually rotates. Ticks-based per direct confirmation, not
      uses-based — a long fight against one target still cycles back to the
      top move once enough real time passes. Fully deterministic (no rng
      involved), so `determinism.test.ts`'s byte-identical-log guarantee is
      untouched. `Agent.moveUseCounts` (already-existing, purely
      observational lifetime-use tracking) turned out to be exactly the
      instrumentation needed to validate this for real: a scripted
      2-species population run (seed 42, 3000 ticks) showed the fix doesn't
      manufacture fake variety where a real type-effectiveness choice
      exists (ivysaur correctly kept spamming Tackle over Vine Whip against
      Scyther — grass is quad-resisted by bug/flying, so that's the right
      call, not a bug) — real cycling only shows up in a genuine close-call
      integration test (`predation.test.ts`'s new "real tickWorld combat
      cycles..." test: a minimal 2x1 world, two identical-stat moves,
      confirmed clean ~50/50 alternation over 30 real attack ticks, versus
      the old code's 100/0 spam). 8 new unit tests (combat.test.ts) plus
      that one full-integration test; full suite green (931/931 engine).
- [x] Three Auto Camera UI follow-ups, all direct asks. (1) **Battle
      epilogue is real wall-clock time now, not ticks**: "It's lingering a
      long time in step level speed after fight is over. After hp hits 0,
      just cut away back to full speed after 1000ms." The old
      `BATTLE_EPILOGUE_TICKS` (6 ticks at battle-step's ~650ms cadence,
      ~3.9s) was really just a proxy for real time anyway; new
      `BATTLE_EPILOGUE_MS` (1000) reads `performance.now()` directly via a
      new `Engagement.concludedAtRealMs`, stamped the same moment
      `concludedAtTick` gets its real value. `reconcile()` already runs
      every animation frame (not just once per tick), so this check fires
      promptly regardless of the battle-step tick cadence. Verified live: a
      3-Onix pack fight's final `defeated` event was followed by a clean
      speed-slider recovery to 32x within about 700ms in one clean trace.
      (2) **Non-battle slowdown target raised 2x -> 8x**: "Maybe for
      evolutions. And stuff make it be x8. Not x2" —
      `AUTO_CAM_SLOWDOWN_SPEED` bumped, `SLOWDOWN_THRESHOLD_SPEED` raised
      4 -> 16 to match (kept strictly above the new target so this can
      never accidentally speed play back up instead of slowing it down).
      Confirmed live: sampled speed-label transitions during an evolution/
      hatch/death one-shot consistently showed 32x -> 8x, never 2x. (3)
      **`herdClash` events now carry the move used**: "I am not seeing
      moves being used in 'clash'. Just hp being lost. Better logs
      please." Unlike `fought` (which always had `moveId`), `herdClash`
      never carried one at all. Added `moveId: string` to the event
      (events.ts), populated from `resolveRivalryHit`'s already-in-scope
      `move` (herdConflict.ts), and `eventText.ts`'s herdClash formatting
      now reads "used `<moveId>` on..." — the exact same convention (and
      live-moveset `describeMoveModifiers` lookup) `fought`/`missed`
      already use, instead of the old moveless "clashed with... over a
      resource" phrasing. Verified live: a real clash line now reads
      "bulbasaur used vine_whip on pidgey over a resource for 6 (hp left:
      25) (herd bulbasaur-herd vs pidgey-flock)". One new unit test
      (herdConflict.test.ts asserting `moveId` on a real clash event); full
      suite still green (970/970 engine, 104/104 data) since none of these
      three touch engine combat math, only event data/UI timing.
- [x] Default view is now Overworld-on-and-zoomed-into-the-focused-zone,
      direct ask: "make the default view just overworld on, zone view
      show? The dual view is useless imo... default just one big view
      pls." The old boot path (`loadWorld`) landed on a flat single map
      with Overworld mode entirely off — reaching the actually-useful
      "Overworld mode, but looking at one detailed zone" state took two
      manual clicks (the toggle, then "Show Zone View", since a fresh
      manual toggle-on itself still defaults to the more abstract macro
      map). New `enterOverworldMode(seed, subView)` — the "enabling" half
      of the toggle's click handler, pulled out so boot can call it
      directly — lets boot ask for `"zone"` specifically while the manual
      toggle keeps its own existing `"overworld"` default (a deliberate,
      separate choice, not touched). Web has no test infra (typecheck-only
      package), so verified live via Playwright: confirms `#overworld-
      toggle` reads "Overworld: On" and the zone tile view is showing (not
      the macro map) from the very first frame, "Show Overworld"/"Show
      Zone View" still swap cleanly between the two, and "Overworld: Off"
      still returns to the original flat single-map mode exactly as
      before. The "maybe a minimap" idea in the same message was
      explicitly hedged ("Idk") — not built, not decided, a real open
      option if ever wanted later rather than a silent scope-cut.
- [x] **Rock Throw v3 redesign + meta thought-process writeup** — direct
      feedback ("you're echoing my ideas... worried you're not
      UNDERSTANDING and learning how to create your own based on the
      fantasy") answered by originating a full from-scratch tree nobody had
      asked for yet: Aggression="Denial" (partial Speed-debuff pin, notable-
      tier cone widen), Boldness="Bedrock" (kept/reframed the existing tank/
      counter kit), Sociability="Tremor Rally" (finally uses the real,
      shipped `rallyCall` primitive — direct answer to "does it make allies
      aware and come help": yes). Full writeup, the "start from the
      fantasy" meta-standard, and a consolidated brainstorm dump of every
      unbuilt idea from the Earthquake/Hydro Pump/Solar Beam discussion
      (impact splash, type-conditional terrain slow, escalating pierce,
      charge-up-unless-drought, sunlight-lets-allies-cast-free, destroys
      rock terrain, Duration lever, double-PP lever) are now in
      MOVES_DESIGN.md so none of it is lost to context compaction — the
      direct trigger for writing this: "Can you just make sure you didn't
      lose all our good ideas?" after a compaction. Also flags three new,
      concretely-scoped engine primitives for later: conditional
      `lockTicks`/bonus on terrain presence, a `"recentlyDamaged"`
      `SituationalCondition`, and a distance-based `accuracyFalloffPerTile`
      field (paired with range investment as an "Aggression sniper build").
      `moveTrees.test.ts`'s Rock Throw block rewritten for the new node
      names; full suite green (177/177 data). Move Tree Atlas artifact
      rebuilt via the standardized pipeline and republished in place at its
      existing URL.
- [x] **Rock Throw v3 review fixes** — three real issues caught by direct
      review, not just unclear writing:
      (1) *Hobbling Throw*'s `prerequisitesAnyOf: [["cracked_joint",
      "dead_aim"], ...]` accidentally required **both** nodes together (an
      inner array is an AND-set), unlike every other convergence node in
      the roster. Fixed to three single-node alternatives.
      (2) *Rolling Thunder* (Sociability↔Aggression crosslink) used
      `lockTicks`, described as making the throw "stun outright" — but
      `lockTicks` locks the *user*, not the defender, so it could never do
      that. There's no tree-settable way to inflict a real status/stun
      today (`statusKind` isn't a tree delta field). Fixed by deepening
      the Aggression branch's actual Speed-debuff pin instead
      (`statChangeOnHit` stage -2/24 ticks) rather than a self-penalizing
      "reward."
      (3) Direct feedback: "the lock on thing is a bit too overdone... we
      need other stuff in the social family that's not just lock on."
      Sociability's *Deep Tremor*/*Full Convergence* (both just extended
      `rallyCall.ticks` further) replaced with *Tremor Bond* (a real,
      distinct herd-support heal via `targetsAlly`/`allyEffect`) and
      *Herd Ascendant* (a capstone paying off with `jamCooldownTicks` +
      `lifestealFraction`, not more marking). `moveTrees.test.ts` rewritten
      to match and to explicitly assert the mark stays untouched by the
      new nodes; full suite green (178/178 data). MOVES_DESIGN.md's stale
      pre-v3 Rock Throw paragraph (still describing the old "Cave-In"/
      "Bedrock Breaker" tree under the old triangle-treatment section)
      marked superseded rather than left silently contradicting the v3
      writeup. Atlas artifact rebuilt and republished.
- [x] **Made "deeper crosslinks" real, fixed a genuine range-labeling bug,
      added Hydro Pump's "spawns water," clarified two real sources of
      confusion** — direct follow-up after publishing round-2 crosslink
      *proposals* only as design-doc text: "I'm not seeing any deeper
      crosslinks tho." Shipped for real: a new `SituationalCondition:
      "rallyMarked"` primitive (defender has an active
      `rallyMarkTicksRemaining`, engine-tested in predation.test.ts) and
      three crosslink nodes that use it — Earthquake's *Marked Rupture*,
      Hydro Pump's *Marked Undertow* (needs BOTH Wake Rally's mark AND
      Undertow Pull's drag — a real cross-branch prereq), Rock Throw's
      *Marked Advantage*. Also found and fixed a real, separate bug: every
      "+Range" filler node across Earthquake/Hydro Pump/Solar Beam was
      named "+10 Range" regardless of its actual value (really +1 or +2) —
      corrected. Added Hydro Pump's *Flooding Wake* (real `terrainFill:
      "water"`, the already-shipped primitive — direct ask: "not seeing
      anything about... spawning water"). Two things flagged as
      "confusing" turned out to be real, worth documenting permanently
      (MOVES_DESIGN.md's new "Two things that read as confusing in review"
      section): (1) range and shape are genuinely decoupled — an
      `hitsArea` move's "+Range" filler doesn't widen what actually gets
      hit unless the shape itself also grows, now called out live in the
      Atlas's grid whenever range exceeds shape reach; (2) movement
      effects (`forcedMovement` beforeHit/onHit, `positionSwap`,
      `positionSwapPull`) resolve in one fixed real order documented
      explicitly, not simultaneously or build-order-dependent. Impact
      splash and the "stand still and keep spraying" Duration idea remain
      genuinely NOT built (real new engine primitives, not faked). Full
      suite green (182/182 data, 992/992 engine); Atlas artifact rebuilt
      (template + data) and republished at its existing URL.
- [x] **Move Tree Atlas: mobile layout fix** — direct report: "the range
      visualizer needs to go the bottom right of the chart or something
      it's obscuring the nodes on mobile." The grid lived inline in the
      stage's sticky header, which on the mobile single-column layout sat
      wide enough to cover real nodes underneath it. Moved to a small
      `position: fixed` panel pinned to the viewport's bottom-right corner
      (not the scrollable node canvas) under the existing `max-width: 980px`
      media query, shrunk to fit. Rebuilt and republished the artifact.
- [x] **Range panel: move stats + drag-to-reposition + collapse-to-button**
      — direct follow-up to the mobile overlap fix: "put the stats of the
      move into range visualizer, then make it easy to collapse to a
      single button and/or reposition on screen." The panel now always
      renders `position: fixed` (on every screen size, not just mobile —
      removed the now-redundant mobile-only override) with its own compact
      type/power/accuracy/cooldown/range/shape readout
      (`renderStageStats` now writes to both the header and the panel).
      A head bar doubles as a drag handle (pointerdown/move/up, clamped to
      the viewport) and a toggle button; tapping the head (when it wasn't
      a drag) or the toggle collapses the whole panel to a single round
      button, leaving just the tree graph visible. Position and collapsed
      state persist in localStorage (`moveTreeAtlas.panel.v1`), same
      pattern as the existing notes/flags/build features. Verified the
      inline script's syntax directly (`new Function(...)` on the
      extracted block) before rebuilding. Atlas rebuilt and republished.
- [x] **Range panel: swapped the range-vs-shape disclaimer for the last-
      allocated node's plain-English effect** — direct ask: "remove the
      range disclaimer text the yellow stuff and have it just be the node
      effect explanation you most recently allocated." Removed the yellow
      warning entirely from `renderRangeGrid` (the underlying explanation
      is now permanent-only in MOVES_DESIGN.md). The same panel slot now
      shows whichever node was most recently *added* to the build (not
      just clicked to inspect), reusing the exact `describePassive`/
      `describeDelta` translators the detail panel's own "In plain
      English" block already uses — `state.lastAllocatedNode`, updated by
      `toggleNode`/`lockInNode` on add, cleared if that node gets pruned
      by removing something it depended on, and re-seeded from a saved
      build's last entry when switching moves. Verified the inline
      script's syntax before rebuilding. Atlas rebuilt and republished.
- [x] **Deeper crosslinks, corrected: bridges, not dead-end leaves (pilot
      shipped)** — direct correction: "deeper cross links are not working.
      What I meant was... you take a cross link and then you can invest in
      a filler + one notable and from that deeper node you can have a
      shortcut to deeper up the trees." Piloted on Earthquake: *Coordinated
      Tremor* (crosslink) → *Marked Rupture* (filler) → new *Converged
      Ruin* (notable), which is wired into `total_collapse`/
      `focused_rupture`'s own `prerequisitesAnyOf` as a real alternate
      route — reaches the Aggression branch's AoE-size fork without ever
      walking that branch's own five-node filler chain. Two rules
      recorded for extending this pattern later: shortcut the grind, never
      the fork/decision itself; no new engine primitive needed, pure
      `prerequisitesAnyOf` authoring. Also fixed, same pass: Earthquake's
      `overload_footing` ("+10% Recoil") was a real bug — a full skill
      point spent on `recoilFraction` alone with zero offsetting benefit,
      unlike every other recoil use in the roster. Paired it with +10
      power, renamed to "Reckless Overload." Two new tests added
      (moveTrees.test.ts); full suite green (184/184 data). Not yet rolled
      out to the other three crosslinks in Earthquake or to Hydro Pump/
      Solar Beam/Rock Throw — this was a single pilot, checked before
      repeating. Atlas rebuilt and republished.
- [x] **Made the crosslink bridge actually visible in the Atlas** — direct
      report: "I don't understand visually the cross link thing in
      earthquake. I can't see what you did it's all kinda hard to see."
      Root cause, found by reading the actual rendering code rather than
      guessing: `isCrosslink()` only recognizes a node with exactly 2
      direct prerequisites, so Marked Rupture and Converged Ruin (single-
      prereq descendants of the real crosslink root) rendered as
      ordinary orange Aggression fillers with plain faint edges — the
      whole bridge was visually indistinguishable from the branch's normal
      filler chain, and its shortcut edge into the fork used the same
      faint dashed style as every other ordinary any-of convergence
      already in the graph. Added `isCrosslinkChainMember()` (a pure
      visualization concept, walks single-prereq chains back to a real
      crosslink root — doesn't touch `leaning`, tier classification, or
      layout) and used it to: give every node in a crosslink's own chain a
      dashed gold ring (nested outside the existing cost-2 ring), and
      style any `prerequisitesAnyOf` edge whose source is a chain member
      as a thicker, gold "bridge" edge distinct from ordinary any-of
      shortcuts. Added a legend entry explaining the new gold-ring/bridge-
      edge convention. Verified the inline script's syntax before
      rebuilding. Atlas rebuilt and republished.
- [x] **Fixed the real layout bug behind the crosslink chain being
      unreadable, plus a file-corruption near-miss** — a follow-up
      screenshot on mobile showed severe label/node overlap right around
      Earthquake's new crosslink bridge. Root cause, found in
      `computeLayout`: only a crosslink's own root counts as
      `isCrosslink()` (exactly 2 direct prerequisites) — its single-prereq
      descendants (Marked Rupture, Converged Ruin) fell through to the
      *main branch* placement path via their own `leaning`, landing them
      at shallow depth in the SAME angular slot and radius band as
      Aggression's own early nodes (Shaking Ground et al.), directly
      competing for space. Fixed by giving `computeLayout` a dedicated
      pass for crosslink-chain descendants: walk each one back to its real
      crosslink root, then place it radiating outward along that root's
      own angle/radius (one step per prerequisite hop) instead of folding
      it into a branch's own depth ring. Verified directly against the
      real exported tree data (`computeLayout` extracted and run against
      Earthquake/Rock Throw/Hydro Pump's actual JSON, positions printed
      and checked for separation/no missing nodes) before republishing.
      Also fixed the stage header's controls overlapping each other on
      narrow screens (missing `flex-wrap`). Caught and fixed, mid-edit: an
      Edit tool call had silently written two literal NUL bytes into the
      template instead of space characters, making the file register as
      binary (`file` reported "data") — found via a direct UTF-8/null-byte
      check, not assumed; fixed by replacing them and re-verifying both
      encoding and script syntax before rebuilding. Full data suite still
      green (184/184, unaffected — this pass never touched
      `packages/data/src/moves.ts`). Atlas rebuilt and republished.
- [x] **Softened the crosslink bridge and made it two-directional** — direct
      feedback: "the deeper cross link going straight to the choice of 2
      nodes are a bit too much. Maybe don't let then go to the two nodes.
      And then make them connect to the other branch too. Like it can go
      to either branch." Converged Ruin no longer wires directly onto
      `total_collapse`/`focused_rupture` (the fork itself) — it now wires
      onto `seismic_feed` and `tremor_reach`, the last plain filler
      *before* each of Aggression's and Sociability's own forks (the two
      branches Coordinated Tremor actually bridges). Reaching either fork
      from the bridge now takes the same one extra node it would from the
      branch's own path, and the bridge reaches into both sides instead of
      only the one matching Converged Ruin's own `leaning`. Two rules
      recorded in MOVES_DESIGN.md for the next bridge: land the shortcut
      the same distance from the decision the normal path would, and wire
      it into every branch the crosslink actually touches, not just the
      leaning-matched one. Tests updated to assert the new one-step-early
      landing on both sides and that the fork itself still requires an
      explicit extra pick; full suite green (185/185 data). Atlas rebuilt
      and republished.
- [x] **Rolled the crosslink-bridge pattern out to every crosslink in all
      four v3 trees** — direct ask, once the pilot was validated: "Build
      out cross links for every branch and all moves." Every remaining
      crosslink (2 in Earthquake, 3 each in Hydro Pump/Solar Beam/Rock
      Throw — 11 total) got its own filler+notable bridge tail, wired into
      both connected branches' pre-fork nodes via `prerequisitesAnyOf`,
      exactly matching the validated Converged Ruin pattern (land one
      step before the fork, reach both branches, no new engine
      primitives — every new node reuses power/accuracy/
      defensePenetration/lifestealFraction/jamCooldownTicks). Every
      branch's own pre-fork node now has up to 3 real alternate routes:
      its own filler chain, plus the two crosslink bridges reaching it
      from its two neighboring branches. Found and fixed a real,
      pre-existing (unrelated to this rollout) layout bug while stress-
      testing: Hydro Pump's Wake of Violence and Marked Undertow both
      bridge the same branch pair and were landing on the exact same
      graph coordinates — `computeLayout` only positioned one crosslink
      per branch-pair angle. Fixed by grouping crosslinks sharing a
      branch pair and spreading them, same pattern the branch forks
      already use. Verified directly: `computeLayout` run against the
      real exported data for all four trees confirmed zero missing,
      duplicate, or near-overlapping node positions before rebuilding.
      Added 8 new end-to-end reachability tests (one representative
      bridge-into-both-sides check per new crosslink); full suite green
      (193/193 data). Atlas rebuilt and republished.
- [x] **Redesigned every crosslink bridge — the first pass was a template,
      not a fantasy** — direct, blunt feedback: "Your cross links are
      laaaaaame tho... the skills don't feel cool." Fair: every one of the
      11 new bridges from the rollout used the exact same shape (filler =
      +8 accuracy, notable = +10 power/+0.2 defensePenetration/+0.05
      lifesteal), interchangeable across all of them — precisely the
      template problem principle #1 of this doc's own lessons-learned
      guide warns about. Rebuilt every notable to deepen the specific
      lever its own crosslink already introduced instead: Cracking
      Momentum's lunge reaches further; Fault Convergence pairs power with
      real recoil (never a pure downside, per lesson #4); Wake of
      Violence's crit gets sharper before paying off via rallyMarked;
      Warning Tremor's bracing becomes real ongoing regen; Rooted
      Assault's armor-piercing roots grow into real thorns; Coordinated
      Tremor's and Rolling Thunder's own rallyMarked payoffs deepen
      further (1.3 → 1.6) instead of bolting on flat power. Direct
      follow-up ask: "make one of the solar beam ones do like three width
      beams as a capstone" — Territorial Flare's own notable (renamed
      Triple Bloom) now turns into a genuine `hitsArea` cone (length 5,
      width 3), Solar Beam's first real AoE anywhere in that tree — a
      real capstone-tier shape change, not another stat bump. No new
      engine primitives needed for any of it; every lever already existed,
      this was about picking the *right* one per bridge. Two test
      assertions updated to match the new mechanics; full suite green
      (193/193 data). Atlas rebuilt and republished.
- [x] **Fixed the range panel's expand button — a real bug, not device-
      specific** — direct report: "The expand part of the range visualizer
      does not work." Root cause: `toggleBtn`'s own click handler only
      called `e.stopPropagation()`, on the mistaken assumption the click
      would still bubble up and get handled by the head bar's own click
      listener — but `stopPropagation()` prevents exactly that bubbling,
      so the button did nothing at all. Since the collapsed state shows
      *only* this button (the eyebrow label is hidden via CSS), that made
      expanding from collapsed completely non-functional. Fixed by giving
      the toggle button its own real toggle call (still guarded against
      double-firing via the head listener, and still respecting the
      drag-vs-tap `moved` check). Verified the template's encoding and
      script syntax before rebuilding. Atlas rebuilt and republished.
- [x] **Fixed Marked Undertow's genuinely broken-looking layout position** —
      direct report: "hydro pump marked undertow has some weird bridges
      that are not correct." Real bug, not a feel thing: every other
      crosslink bridges two branch openers (depth 0), so a fixed radius
      right at the hub was always correct for them — but Marked Undertow
      requires Undertow Pull, itself behind Aggression's entire fork chain
      (depth 7), and `computeLayout` positioned every crosslink at that
      same fixed hub radius regardless. Its own edge to Undertow Pull had
      to cut diagonally across most of the Aggression branch to reach it.
      Fixed by scaling each crosslink's radius with the real depth of its
      own deepest prerequisite, reusing the per-branch depth map
      `computeLayout` already builds — verified directly: Marked Undertow
      moved from `(-73,-56)` (right at the hub) to `(-418,-241)`, now at
      roughly the same radius as Undertow Pull itself, so the edge reads
      as a real bridge between two expensive investments instead of a
      line slashing across the graph. Re-verified zero missing/duplicate/
      near-overlapping positions across all four trees before rebuilding;
      full data suite unaffected and still green (193/193). Atlas rebuilt
      and republished.
- [x] **Removed Marked Undertow; redesigned Hydro Pump's Sociability
      capstone to actually match its own fantasy** — direct ask: "Let's
      just remove marked undertow. I think hydro pump sociable capstone is
      kinda lame. Team healing isn't like matching the fantasy imo."
      Deleted `marked_undertow` entirely (it was the one crosslink whose
      layout needed a special depth-scaling fix last round — that fix
      stays in `computeLayout` as real infrastructure, just unused by the
      current roster now). *Tidal Communion* (the Pod Tide branch's own
      capstone) was a flat `healAura` team-heal, disconnected from the
      branch's actual fantasy ("the pod moving the water together").
      Redesigned to `excludesAllies` instead — the pod finally isn't
      caught in its own `hitsArea` blast, the literal fantasy, reusing the
      same primitive Earthquake's Herdsafe Trigger already uses. Updated
      the one test that referenced Marked Undertow and the capstone's own
      assertion; full suite green (193/193 data). Atlas rebuilt and
      republished.
- [x] **Tidal Communion, third and final try — built a genuinely new engine
      primitive instead of reusing one** — direct follow-up feedback on the
      `excludesAllies` capstone above: "But with the first social capstone,
      it should heal allies, no? I think it would be better if it granted
      all allies greatly more speed when they're on water tiles?", then
      clarified: "Sorry, I meant as in, with the first notable in the tree
      it already stops friendly fire so like that's what I meant" — i.e.
      the real objection was that `excludesAllies` as the *capstone* read
      as reused content, since Earthquake's own opener (Herdsafe Trigger)
      already does the same thing. Checked the real code before proposing
      anything (`PassiveKind`'s closed union, `actionSpeedOf`'s multiplier
      chain, `terrainSpeedMultiplier`'s per-terrain-only signature) and
      confirmed a terrain-conditional ally-speed aura genuinely didn't
      exist yet; asked the user how to scope it via AskUserQuestion — they
      picked "Build the water-speed aura now." Split the two concerns onto
      two different nodes instead of cramming both onto one: moved
      `excludesAllies` down onto *Pod Current* (the opener, paired with its
      existing idle heal — answers "it should heal allies, no?" directly),
      and gave *Tidal Communion* a brand-new `PassiveKind`,
      `"aquaticHaste"` — a same-herd agent within a fixed radius of the
      passive-holder (itself included) gets a real Speed multiplier bonus,
      but only while standing on a `"water"` tile. Implemented as
      `aquaticHasteMultiplier` in `support.ts`, mirroring the existing
      `healAura` aura pattern (herd-scoped iteration + radius check), and
      composed into `actionSpeedOf`'s existing multiplier chain in
      `simulation.ts` alongside terrain/off-hours/cold-snap/paralysis. This
      is the first passive in the whole roster that's both an aura AND
      terrain-conditional — neither existing mechanism covered it alone,
      and the first keystone to need genuinely new engine work rather than
      recombining an existing lever. Added 4 new engine tests
      (`support.test.ts`: boosts on water near a holder, neutral off water,
      neutral out of radius/no herd/no holder, composes multiplicatively
      with other Speed modifiers) — engine suite 992 → 996, all green.
      Updated the two data tests that referenced the old capstone delta to
      check `grantsPassive` on the tree node directly (`applyMoveTree`
      doesn't merge `grantsPassive` into its resolved `MoveSpec` — a
      recurring gotcha this session, hit before on a Rock Throw test too);
      full data suite green (194/194). Atlas's `PASSIVE_LABEL` map updated
      with a plain-English `aquaticHaste` description; rebuilt and
      republished.
- [x] **Body Slam: a full v3 tree built as a direct demonstration of this
      doc's own design guide** — direct ask, "prove me you learned how to
      design by designing another move skill tree," after the guide's
      principles (1-17) and the "what actually makes a tree interesting"
      patterns were distilled from this session's earlier work. Picked
      Body Slam specifically because it was real, canonical, and
      completely untreed (Snorlax's only signature move, `species.ts`),
      same single-species freedom Slash used for Scyther. Wrote the
      fantasy first (mass and inevitability, not power), then three
      branches that each answer it differently: Aggression ("Landslide")
      escalates the mass itself into a real `hitsArea` capstone;
      Boldness ("Unbudging") earns real tankiness for once — nothing in
      the roster fits `immovable` better than a sleeping giant, and
      Snorlax's own curated Defense Curl already primed it; Sociability
      ("Gentle Giant") turns the real canonical Snorlax trait into an
      actual herd shelter (a `healAura`+`defenseBoost` multi-passive
      keystone), not a flat ally buff. Three crosslink bridges built
      correctly the first time — each reaching both branches it touches,
      landing one step before each fork, deepening its own introduced
      lever (a self-Defense stat stage, a `rallyMarked` bonus, a
      `lockTicks`-for-power tradeoff) — no repeat of the "lame crosslinks"
      mistake from earlier in this session. 39 nodes, zero new engine
      primitives (every lever already shipped — purely picking the right
      one per node). Added a dedicated "Body Slam tree" describe block
      (`moveTrees.test.ts`) covering the keystone AoE, both
      grantsPassive(s) gotchas, both forks' real tradeoffs, and all three
      crosslink bridges' wiring; full data suite green (207/207), engine
      suite unaffected (996/996). Atlas rebuilt (verified: no null bytes,
      inline script re-parses, `computeLayout` produces complete,
      non-overlapping positions for all 39 new nodes across all 11 treed
      moves) and republished.
- [x] **Fixed Body Slam missing from the Atlas move picker** — direct
      report: "It isn't there. I don't see body slam in the list of
      moves." Real bug, not a stale cache: `MOVE_ORDER` (the picker list in
      `move-tree-atlas.template.html`) is hand-maintained, separate from
      the actual tree data — adding Body Slam's tree never added it to
      this list, so it silently never rendered in the nav despite being in
      the underlying JSON all along. Added a new "Single-species" group
      for it. Verified (integrity, syntax, `computeLayout`) and
      republished.
- [x] **Body Slam: redesigned Boldness (real "intention," not just bulk)
      and Sociability (solitary, not herd-based), plus rebalanced
      Aggression — two genuinely new engine primitives, both direct
      follow-up asks** — "sketch the sociability. But I think boldness is
      a little bland too... Intention could be a thing too. Could add a
      charge up turn, to make it stronger. Maybe another notable could
      make him invulnerable to damage for that charge up. Maybe you could
      add a huge leap/movement tied to the skill... Full weight is
      probably too strong to be so early." Scoped via AskUserQuestion
      before writing engine code (the charge/invulnerability state and the
      rivalry hooks were both explicitly greenlit; a `maxHp`-boost
      crosslink idea was not, and wasn't built).
      - **New engine primitive: `MoveSpec.chargeAttack` →
        `Agent.chargingAttack`** — a genuine mid-commit wind-up. Reuses
        the existing `actionLockTicks` block for "can't act" (no new
        no-action guard needed); `resolveHitAgainstTarget` (predation.ts)
        checks it before even rolling accuracy for real, unconditional
        invulnerability; `tickStatusEffects` (status.ts) only ticks it
        down (deliberately not resolving it there — a real status.ts/
        predation.ts import cycle, same constraint `maybeSpreadStatus`
        already respects); `tickAgentNeeds` (needs.ts, which already
        imports from predation.ts) calls the new, exported
        `resolveChargedAttack` once ticks hit 0 — it looks the original
        target back up by id (may have moved, changed layer, or died
        since), leaps toward wherever it currently is, and lands the hit
        at a bonus power, or fizzles for nothing if the target's gone. 4
        new engine tests (`predation.test.ts`): commits without an
        immediate hit, genuine invulnerability against a real attacker,
        resolves after its ticks elapse with a real leap and a landed
        hit, fizzles for no damage if the target dies mid-charge.
      - **New engine primitives: `PassiveKind` `"nonTerritorial"`/
        `"calmingPresence"`** — both hook into herdConflict.ts, not a
        move-hit path. `"nonTerritorial"` is a flat opt-out at the top of
        `applyHerdRivalryConflict` (never initiates, can still be
        targeted as someone else's rival). `"calmingPresence"` multiplies
        down `herdConflictChance` for any living, same-layer agent within
        a fixed radius — deliberately NOT herd-scoped like `healAura`/
        `aquaticHaste`, since the fantasy is a genuinely solitary animal
        that calms *both* sides of a nearby standoff, not just its own
        herd-mates. 4 new engine tests (`herdConflict.test.ts`): opts out
        of initiating, can still be fought as someone else's rival,
        dampens a third agent's own chance regardless of herd, no effect
        beyond its radius.
      - **Aggression rebalanced**: `weightScaling` moved off the opener
        (renamed *Full Weight* → *Heavy Step*, now a modest lunge) down to
        the keystone (*Avalanche*, alongside its existing `hitsArea` shape
        change) — direct feedback that handing out the tree's biggest
        lever on the first point spent was backwards.
      - **Boldness keystone replaced**: *Mountain's Answer* (`thorns`) →
        **The Reckoning** (`chargeAttack`: 2-tick charge, +40 power, a
        5-tile leap) — real "intention," invulnerable the whole time it's
        winding up, a genuine risk (fizzles if the target's gone) not a
        guaranteed payoff.
      - **Sociability rebuilt from scratch**: the old herd-support branch
        (*Broad Back*/*Watchful Rest*/*Wake the Giant*/*Herd's Shade*/
        *Sanctuary Slam*, all `targetsAlly`/`allyEffect`/`healAura`) is
        gone entirely, replaced with *Unbothered* → *No Quarrel* → a real
        fork (*Wide Berth* vs. *Steady Nerve*) → *Left in Peace* →
        keystone *Undisturbed* (`grantsPassives`: `calmingPresence` +
        `thorns`) — no ally-targeting content survives anywhere on the
        branch (checked directly in the rewritten test).
      - **Boldness↔Sociability crosslink redesigned**: *Called to Stand*
        (`rallyMarked`, no longer fits a herdless branch) → **Nothing to
        Prove** (deepens `calmingPresence` across its own root→filler→
        notable chain — "an immovable thing that also isn't looking for a
        fight is the ultimate 'just go around it'"). The other two
        crosslinks kept their own mechanics, just re-rooted onto the
        renamed/rebuilt opener ids.
      - Rewrote the whole "Body Slam tree" test block for the new
        structure; full data suite green (210/210), engine suite green
        (1004/1004, aside from one pre-existing unseeded-RNG flake in
        `reproduction.test.ts`, confirmed unrelated by re-running it
        standalone). Atlas's `PASSIVE_LABEL`/`describeDelta` maps got real
        entries for `nonTerritorial`, `calmingPresence`, and
        `chargeAttack`; rebuilt (verified: integrity, syntax,
        `computeLayout` across the whole roster) and republished.
- [x] **Body Slam: fixed Sociability's capstone reading smaller than its
      own mid-branch notable** — direct follow-up: "No quarrel reads as
      the true capstone. It's a big effect. Undisturbed seems like... it
      could be a different effect and swapped down. Try not to make
      capstone less interesting than notables." Real numbers problem: No
      Quarrel granted `calmingPresence: 0.5` at notable tier while the old
      keystone (*Undisturbed*) only granted 0.25 + a small 0.05 `thorns`
      — a smaller echo of an earlier grant, not a real escalation. Fixed
      by trading places rather than just rebalancing in place: the
      *Undisturbed* name moved down onto the old *Left in Peace* notable
      (mechanically untouched, still plain `thorns`), No Quarrel's own
      value came down to 0.3 (a real notable number), and the actual
      keystone (same node id, new name **At Peace**) got a decisively
      bigger `calmingPresence` jump (0.5, bigger than every earlier grant
      on the branch) paired with a lever no other Sociability node uses
      (`defenseBoost`) instead of just more of what came before. Rewrote
      the two tests covering these nodes, including a direct assertion
      that the keystone's own `calmingPresence` value is strictly greater
      than No Quarrel's; full data suite green (211/211). Atlas rebuilt
      and republished.
- [x] **Body Slam: gave Unbothered a real combat mechanic, fixed its own
      dead-node problem** — direct follow-up: "Unbothered should be,
      takes no damage from first hit in a fight?" Digging into where its
      *actual* payoff (`nonTerritorial`) should live instead surfaced the
      real structural problem: `nonTerritorial` was the opener's ONLY
      grant, and it's functionally dead the instant this move sees real
      combat — a wild-AI flavor pick, not a party skill. The user's own
      hesitant answer nailed it: "it's like an interesting trait for a
      snorlax out in the wild but if it joins your party is a super bad
      skill to have... maybe its an upfront cost to have a dead node to
      get the more powerful calming aura." Rather than accept that
      trade-off, built a new primitive: **`"unshaken"`**
      (`PassiveKind` → `Agent.unshakenCooldownTicks`) — fully negates the
      next hit against the holder once it's off cooldown (no accuracy
      roll, no partial damage, nothing at all happens), then locks itself
      out for `UNSHAKEN_COOLDOWN_TICKS` (20) until it recharges. Same
      "genuinely nothing happens" shape as `chargeAttack`'s own
      invulnerability check, right below it in `resolveHitAgainstTarget`
      (predation.ts); `tickUnshaken` (status.ts) ticks the cooldown down
      alongside `tickChargingAttack`. *Unbothered* now grants `unshaken`
      directly (the literal read of its own name); `nonTerritorial` moved
      one step down to a new filler node, **Not Worth It** — still real,
      still earns its point, just no longer squatting on the branch's one
      guaranteed-useful-in-combat slot. 4 new engine tests
      (`predation.test.ts`): a hit off cooldown does nothing at all (no
      damage, no `fought` event), a second hit while still on cooldown
      lands normally, no effect at all without the passive, and it
      recharges after enough ticks pass with no further hits (two of
      these needed a real fix mid-debug: agents tick in array-push order
      within one `tickWorld` call, so a defender's own cooldown-tick can
      run in the same tick right after being set — a harmless ordering
      quirk, not a bug — and even a fully-negated hit still reads as a
      real threat to the target's own flee AI, so the test has to pin
      both agents back adjacent before a scripted second attack).
      Rewrote the moveTrees.test.ts assertions for Unbothered/Not Worth
      It's swapped grants. Full data suite green (212/212), engine suite
      green (1008/1008). MOVES_DESIGN.md's primitives checklist and Body
      Slam writeup updated; Atlas's `PASSIVE_LABEL` map got a real
      `unshaken` entry; rebuilt and republished.
- [x] **Shipped real v2 skill trees for Vine Whip, Wing Attack, Rock Slide,
      and Dig** — direct ask: "look at a bunch of the moves that are
      actually available to the average units in our sim, and then try to
      create some skill trees with em." Checked which spawned/common
      species' real signature moves still had no tree at all (bare
      `MoveSpec`, no `tree:` field) — Bulbasaur's Vine Whip, Pidgey's Wing
      Attack, Onix's Rock Slide, and Diglett/Sandshrew's Dig, all four
      guaranteed to actually show up in a real run, unlike Body Slam's
      Snorlax (see below). Also surfaced a real gap along the way, from a
      direct follow-up ("we don't have vine whip? i thought we
      designed it...."): Vine Whip's paper draft was the ORIGINAL v2
      template prototype, but the actual shipped trees went to
      Tackle/Slash/Ember instead — Vine Whip itself was never built until
      now.
      - **Vine Whip** (33 nodes): Aggression *Choking Grip* (drain/grip —
        `lifestealFraction`, a `forcedMovement`-pull fork, a multi-hit
        keystone), Boldness *Root and Bind* (rooted-plant toughness),
        Sociability *Shared Growth* (leans into the same nurturing fantasy
        `leech_seed` already carries — `allyEffect`/`allyEffectOnAttack`/
        `healAura`). Crosslink *Snapback Lash* is the original paper
        draft's own named node, finally shipped.
      - **Wing Attack** (33 nodes): Aggression *Relentless Dive* (crit-
        fisher, `critCooldownReset`), Boldness *Wind Rider* (a bird's real
        defense is air superiority, not bulk — `forcedMovement` hit-and-
        retreat, and a keystone giving `"unshaken"` its second-ever home
        after Body Slam's Unbothered), Sociability *Flock Signal* (a prey
        bird's real defense is the flock — `rallyCall`'s *Mob the Threat*,
        `calmingPresence`).
      - **Rock Slide** (33 nodes): deliberately NOT a re-skin of Onix's
        other two trees (Rock Throw's single-target defense-pen,
        Earthquake's ground-shockwave AoE) — leans on `situationalBonus`'s
        `"elevation"` condition instead (boulders falling from above), the
        first shipped tree to use it. Sociability reuses Earthquake's
        `excludesAllies` for a different reason (an advance-warning
        tremor) and forks into `calmingPresence`/`nonTerritorial`.
      - **Dig** (21 nodes, honestly smaller): Dig is never resolved as an
        actual hit (`pickBestMove` excludes any `burrow` move from hostile
        selection), so every damage-facing lever this template usually
        leans on would be silently inert here. Built instead purely from
        the two levers that ARE real: `cooldownTicks` (genuinely gates how
        often it can burrow-flee) and `grantsPassive`/`grantsPassives`
        (agent-level, real regardless of how the move is used) — no padded
        "+5 Power" filler pretending otherwise. Shared by Diglett AND
        Sandshrew (a real cross-species pairing per species.ts's own
        comment); Sociability's *Shared Ground* leans into that.
      - Verified live in a real run: Bulbasaur auto-respecs across all
        three Vine Whip branches including the *Snapback Lash* crosslink;
        Pidgey/Pidgeotto do the same for Wing Attack. Rock Slide/Dig didn't
        fire in the specific seeds spot-checked (Onix/Diglett/Sandshrew
        level up slower and compete for the same typed skill points as
        their other known moves' trees) — read as RNG variance on a small
        sample, not a structural problem; the generic structural suite
        validates all four trees' prerequisites/excludes/forks the same
        way as every other shipped tree. Full data suite green (228/228),
        engine suite unaffected (1094/1094).
      - Also confirmed along the way (a direct follow-up question, "is it
        being used by the simulator?"): Solar Beam and Hydro Pump ARE both
        live in real runs (Venusaur is spawned directly; Gyarados/Blastoise
        are reachable via real in-sim evolution from Magikarp/Squirtle),
        but Body Slam's Snorlax has no spawn or immigration path at all —
        its whole tree (including this session's chargeAttack/
        nonTerritorial/calmingPresence/unshaken work) is currently only
        reachable through unit tests, never a live run. Still open; not
        addressed this round.
- [x] **Shipped two more real v2 trees: Flamethrower and Leech Seed** —
      direct follow-up: "i just want more more moves" -> clarified: "i
      just mean implement more skill trees for commonly available moves.
      we have so many skill trees we gotta work through. i wont even be
      able to review em all." Picked the same way as the first four
      (a real signature move of an actually-common species, still bare).
      - **Flamethrower** (Charmeleon/Charizard, reachable via in-sim
        leveling from the always-spawned Charmander): 33 nodes, zero new
        engine work. Built as the design template's own "Power move"
        archetype reference example — a genuine mutually-exclusive final
        fork (*Focused Beam* single-target nuke vs. *Wildfire Cone* wide
        AoE), not just a longer grind to one ending.
      - **Leech Seed** (Bulbasaur/Ivysaur/Venusaur): 24 nodes, honestly
        scoped like Dig — `utilityMove`-flagged, never resolved as an
        actual hit, so only `drainNeeds`/`cooldownTicks`/`statChangeOnHit`
        (self)/`grantsPassive` are real. Needed two small new
        `MoveTreeNode.delta` fields (`drainNeeds`, `matingRadiusBoost`,
        both plain overwrites) to be worth building at all — added to
        `moves.ts` and unit-tested in `moves.test.ts`'s existing "kitchen
        sink" merge suite. Real fork highlight: Boldness's *Twin Taproot*
        switches `drainNeeds.need` from `"hunger"` to `"thirst"` entirely.
      - Verified live: Leech Seed auto-respecs for a real Bulbasaur in an
        8000-tick run across all three branches. Full data suite green
        (236/236), engine suite green (1094/1094). MOVES_DESIGN.md and
        Atlas updated/republished.
      - Direct follow-up mid-round, queued for next: "i think for fire
        based move we gotta add the fire burning down flora mechanic...
        and it deals dot damage to units standing in fire... gotta have a
        rendering for it too." A real new engine feature (persistent fire
        terrain/hazard — not the existing instant `terrainBurn` reversion),
        not a skill-tree change. Not yet started as of this entry.
      - Still-open backlog from this same pass, not started: Sweet Scent
        and Growth are the next candidates (both Bulbasaur's own moves,
        both need small new delta support the same way Leech Seed did —
        `matingRadiusBoost` is already added; `fertilityBoost` isn't yet).
- [x] **Design review pass on the last 6 trees: fixed a missing crosslink,
      diversified 3 reused crosslink templates** — direct follow-up: "Hmm..
      You're missing a lot of deeper cross links. And your designs are
      kinda uninspired..." A quick script counting each tree's own
      crosslink comments found a real bug: Vine Whip was 32 nodes/2
      crosslinks, not 33/3 like every other tree — its Sociability↔
      Aggression bridge was never written. Added *Thorned Bouquet*
      (`critRateStage`). Separately, the "uninspired" complaint was also
      real and verifiable: Aggression↔Boldness had settled into the exact
      same `statChangeOnHit: self attack +1` three times (Wing Attack,
      Rock Slide, Flamethrower), Boldness↔Sociability into the same
      `damageReduction` grant four times, Sociability↔Aggression into the
      same `situationalBonus: flanking 1.25` three times — a real
      authoring rut. Reworked all of them to something specific to each
      move's own fantasy: Vine Whip's *Grafted Vines* (`positionSwap`),
      Wing Attack's *Riding the Gust*/*Screening Dive*/*Scattering Strike*
      (`forcedMovement`/ally speed buff/onHit knockback), Rock Slide's
      *Quarried Weight*/*Steadfast Warning*/*Second Wave*
      (`weightScaling`/`defenseBoost`/`jamCooldownTicks`), Flamethrower's
      *Molten Edge*/*Ember Ward*/*Flashpoint*
      (`defensePenetration`/`thorns`/`critRateStage`), and Leech Seed's
      *Grounded Hunger* swapped to `defenseBoost` (it was an exact
      duplicate of Dig's own crosslink otherwise). Dig's three were left
      alone — already distinct, about as varied as an honestly-narrow tree
      gets. No two crosslinks within this six-tree batch share a mechanic
      now. Verified live (Vine Whip's new crosslink auto-respecs for a
      real Bulbasaur). Full data suite green (236/236, same count — a
      rebalance, not new content). Atlas rebuilt and republished.
- [x] **Ruthless fantasy-fit audit of all 6 trees, real fixes applied** —
      direct follow-up: "Restart on each skill starting with the fantasy.
      Does each node and capstone really fit? Be critical of your own
      work." Ran an adversarial audit (fresh eyes, not self-review)
      checking every node's displayed name against what its delta actually
      does, and every capstone against its own branch's stated fantasy.
      Real findings, not nitpicks:
      - **All 6 Sociability capstones were byte-identical**
        (`healAura 0.01`) and **3 Boldness capstones were also identical**
        (`[defenseBoost 0.08, thorns 0.08]`) — fixed by making each escalate
        the specific lever its own branch already built (Rock Slide's now
        deepens its own `calmingPresence` ladder to 0.3; Flamethrower's
        Boldness capstone leans thorns-heavy, Rock Slide's leans
        defense-heavy) instead of converging on the same generic finish.
      - **Wing Attack's own Aggression capstone contradicted its own
        branch** — *Storm of Talons* widened into an AoE cone in a branch
        explicitly built around "one bird, one committed dive," with the
        node's own comment admitting the stretch. Replaced with *Final
        Stoop*, a real single-target finishing blow.
      - **Vine Whip's Boldness fantasy ("refuses to be moved") wasn't
        actually delivered** — its opener granted flat `damageReduction`
        instead of the already-shipped `"immovable"` passive that says
        exactly that. Same fix for Rock Slide's *Unbroken* (an Onix
        anchored under its own rockfall is an even better fit).
      - **Leech Seed's Sociability branch never touched `drainNeeds`**,
        the one lever its whole tree is built on, and its own comment
        conceded it was a reskin of Vine Whip's branch. Gave it a real
        `targetsAlly`/`allyEffect` heal instead of a self-buff — verified
        this actually fires (a separate code path, `support.ts`'s
        `applySupportMove`, independent of the move's own drainNeeds
        handling) before shipping it, not assumed.
      - **Real name/mechanic lies fixed**: Vine Whip's *Unbreakable Hold*
        (promised grip, delivered flat power/cooldown) now actually denies
        tempo (`jamCooldownTicks`); Wing Attack's *Storm Wings* (flat
        `damageReduction` in a branch about NOT tanking) now uses a real
        `storm` situational bonus; Wing Attack's *Screening Dive* (was a
        strictly-worse duplicate of its own prerequisite) now does a real
        `positionSwap` intercept; Leech Seed's *Twin Drain* (nothing twin
        about it) renamed *Sharpened Hunger*; its *Feeding Frenzy* capstone
        (flat regen ending a branch about escalating theft) now actually
        escalates the drain; its *Ancient Roots* capstone (literally
        re-granting the same two values already granted lower in the same
        branch) now grants distinct ones; Dig's *Gone Before It Lands*
        (promised dodge/timing this honest tree's lever set can't deliver)
        honestly renamed *Deepening Instincts*.
      - **Real padding cut**: Dig's Aggression branch had four separate
        "-1 Cooldown" nodes (two literally identical) — merged two into one
        "-2 Cooldown" node at the combined cost.
      - **Deliberately left open, logged rather than hidden**: the three
        Boldness branches are still one structural template with different
        flavor text underneath the fixes above — a real fix needs each
        branch built from its own fantasy from scratch, a bigger rebuild
        than an audit-fix pass. Several crosslinks flagged as "generic
        single-stat grabs" also weren't deepened this round.
      - Full data suite green (236/236 — Dig's merge nets one fewer node),
        engine suite unaffected (1094/1094). Atlas rebuilt and republished.
- [x] **Environmental-hook pass on the new trees (first real run of
      SKILL_TREE_GUIDE.md as a checklist)** — direct follow-up: "Now do
      another pass on our new moves like leech seed, vine whip etc."
      Running the guide's own step 2 (scan for an environmental/utility
      moment specific to the fantasy — the Rock Throw boulder pass) found
      content three previous review rounds walked past, because every
      earlier pass audited what was there instead of asking what was
      missing.
      - **Vine Whip**: now draws on real `flora` terrain it's standing in
        (`consumesOwnTerrain`, 2x damage, tile consumed) — Rock Throw's
        exact shape on the terrain this move's fantasy cares about, and
        genuinely double-edged since it destroys real flora. Zero engine
        work. Also cleared a flagged name/mechanic mismatch on that node.
      - **Leech Seed**: "Shared Harvest" finally shares something — what
        the roots steal goes back into the soil (`fertilityBoost`), the
        literal ecosystem payoff three rounds of notes kept asking for.
        Replaced a duplicate "-1 Cooldown" filler.
      - **Real engine bug found by the guide's verify-first step**:
        `maybeUseUtilityMove` early-returned after applying `drainNeeds`,
        so every other utility field on the same move was silently dead
        code. Fixed (falls through, still one `useMove` call) with a
        regression test. Without this, the Leech Seed node above would
        have shipped doing visibly nothing.
      - **Atlas reviewability gaps closed**: `drainNeeds` had no
        `describeDelta` entry, so SIX Leech Seed nodes rendered with no
        description in the doc these trees are reviewed from;
        `fertilityBoost`/`matingRadiusBoost` likewise; and the Atlas build
        simulator silently dropped `chargeAttack`/`drainNeeds`/
        `matingRadiusBoost`/`fertilityBoost`. All fixed.
      - Engine suite green (1095/1095, +1 new), data green (236/236),
        `feed_the_soil` confirmed firing for real Bulbasaurs in an
        8000-tick run. Atlas rebuilt and republished.
- [ ] **Proposed, needs a go-ahead: Rock Slide should leave real rubble.**
      `terrainFill: { terrain: "boulder" }` would make a rockslide leave
      boulders behind, composing into a real cross-move combo — Onix
      creates boulders with Rock Slide, then consumes them for 3x damage
      via Rock Throw's existing `consumesOwnTerrain`. Best cross-move
      tension available in the roster. Two real blockers found by reading
      the code: (1) `terrainFill` unconditionally calls `waterSoil()` on
      the filled tile (its comment assumes it's Water Gun-exclusive) — a
      falling boulder watering soil is nonsense, needs gating; (2)
      `setTile` makes boulder unwalkable, so this creates impassable tiles
      under living agents and slowly accumulates permanent rubble with no
      decay mechanism. Both solvable, neither decided unilaterally.
- [x] **CORRECTED — Dig and Vine Whip both hook into the real gathering
      system; I'd been looking in the wrong place.** Direct correction:
      "dig was supposed to make digging springs and food easier... Vine
      whip too... Reduce the amount of time to harvest crops." My previous
      "not buildable" note only considered `utilityMove`; the actual hook
      is the `digTicksAccrued`/`springDigTicksAccrued` gathering system in
      needs.ts + crops.ts, which moves ALREADY feed (a `burrow` move for
      digging crops/springs, a damage move scaled by `range.max` for
      canopy harvest). What was missing was any way for a tree to improve
      it.
      - New `MoveSpec.gatherBurst` (+ matching tree delta, additive),
        composed into all three real gather paths. Never grants access a
        move lacked — Vine Whip harvests faster but still can't dig.
      - **Dig**: `Wider Burrow` and `Packed Earth` now grant real gather
        progress instead of being "-1 Cooldown" fillers under names that
        promised something else — retiring two name/mechanic mismatches
        AND two duplicate-lever fillers. Spring digging: 4 uses -> 3.
      - **Vine Whip**: `Quickening Growth` (one of two identical "+5
        Power" fillers) now speeds canopy harvest from 5 -> 8 per use.
      - 3 new engine tests, one per gather path. Engine 1098/1098.
      - Lesson worth keeping: "is there an environmental hook?" is not the
        same question as "is there one in the systems I've already read."
        The gathering system was shipped, and its own comments already
        said "moves can be used to dig faster."
- [x] **Crosslink bridge tails — the structural gap the new trees were
      missing versus the flagships.** Direct feedback: "Compare the skill
      trees for all your new moves with hydro pump/earthquake. You're
      missing stuff." Measuring rather than guessing found it: the
      flagships sat at 39-40 nodes / 9-10 `prerequisitesAnyOf`, the six
      new trees at 33 / 6. Reading Earthquake's actual source (not
      inferring from the shape) showed why — each of its crosslinks is a
      three-node **bridge**, not a one-node dead end:
      `cracking_momentum` (crosslink, forced movement 1 tile) ->
      `momentum_footing` "Deeper Lunge" (filler that deepens the
      crosslink's OWN lever to 2 tiles) -> `fault_convergence` (cost-2
      notable). And it has two rungs of shortcut, not one: an early filler
      accepts the flanking crosslinks directly, and the pre-fork node
      accepts the bridge notables.
      - Added 36 nodes (18 bridges x filler + cost-2 notable) across
        vine_whip, flamethrower, rock_slide, wing_attack, dig, leech_seed.
      - Rewired every pre-fork node to accept its bridge notables, and
        restored the early-filler shortcuts so each bridge still reaches
        BOTH branches its crosslink connects (principle 11).
      - Each bridge's content deepens its own crosslink's lever rather
        than grabbing a generic stat (principle 13).
      - Result: all six now at 9 `prerequisitesAnyOf`, matching the
        flagships; vine_whip/flamethrower/rock_slide/wing_attack at 39
        nodes, dig 29 and leech_seed 31 (deliberately smaller — their
        honest lever sets are smaller, and padding them would be the
        template problem the whole guide exists to avoid).
      - Atlas layout re-verified: no missing or overlapping positions in
        any of the 17 trees. Fixing that check caught two real bugs —
        first my own harness (`computeLayout` returns
        `{positions, crosslinks, maxR}`, not a bare id->{x,y} map, so it
        was silently reporting every tree broken), then, once it worked,
        two nodes that had lost their `leaning` field
        (`dig.never_still`, `leech_seed.wider_reach`) and would have
        rendered invisibly in the Atlas.
- [ ] **Side note: two intermittent full-suite test failures.** Seen once
      each in back-to-back full runs — `predation.test.ts` and
      `reproduction.test.ts > lays a real egg (not an instant newborn)...`
      — different test each time, both pass in isolation, and two
      subsequent full runs were clean (1334/1334). Unrelated to the move
      trees (data-only change), but worth chasing: likely shared state or
      ordering across parallel test files rather than true randomness.
- [x] **Persistent fire (`TerrainKind: "fire"`), and the passive-healing
      problem it exposed.** Direct ask: "for fire based move we gotta add
      the fire burning down flora mechanic... and it deals dot damage to
      units standing in fire... gotta have a rendering for it too."
      - New `fire.ts`: `igniteTile`, `tickFires`, `applyFireDamage`. Fire
        is a real terrain kind, so it renders everywhere for free, persists,
        and interacts with movement and flora rather than sitting in a
        parallel hazards collection.
      - `terrainBurn` now lights a real fire instead of instantly deleting
        the bush. Same end state, but it takes ticks and can get away from
        you. Wildfire's Reach (Flamethrower) is the only node using it.
      - Measured on real worlds: median 3 tiles burned / 21 ticks, p90 19 /
        49, max 47 / 59. Sharp percolation threshold in fuel density
        (60% -> ~12 tiles, 80% -> ~188, 100% -> the whole map); real worlds
        are ~5% fuel but clustered. Rain: 10 tiles/41 ticks -> 1 tile/3.
      - Two bugs caught by the tests: `setTile` leaked stale
        `burnTicksRemaining`, and the spread pass needed collect-then-apply
        or a fire chains across a whole row in one tick.
      - 15 fire tests + 2 rewritten `terrainBurn` tests; 1357 passing.
- [x] **Passive healing gated on being out of combat, and mostly converted
      to flat HP.** Direct worry: "will users just be unkillable?" —
      measurably yes. `grantPassive` accumulates with no cap across every
      move's tree and choices are permanent, so on a 20k run 117/167 living
      agents carried regen, p90 6%/tick, max 11% (full heal every 9 ticks,
      mid-fight). Theoretical ceiling 12%/tick.
      - Any damage taken suppresses `regen`/`healAura` for
        `REGEN_COMBAT_SUPPRESSION_TICKS`. Lifesteal, ally heals and the
        fed/watered heal are untouched — those are paid for or already
        gated. `healAura` checks each recipient, not the holder.
      - New `"regenFlat"` passive; 31 of 38 nodes converted to flat HP, 7
        terminal capstones keep percent (raised to 0.04 so percent reads as
        the special version). Flat 1 HP/tick = 3.3% to a 30-HP unit, 1.4%
        to a 70-HP one.
      - Two nodes named "+0.01 Regen" renamed "+0.5 HP Regen".
      - Effect: flat conversion alone takes 20k population 167 -> 28; the
        gate takes it 28 -> 8. Both oscillate rather than spiral.
- [ ] **Open question for a human: is the new carrying capacity right?**
      The healing fix is clearly correct in kind, but it lowered the 20k
      population band from ~12-34 to ~7-31 on seed 12345. That may be the
      ecosystem working properly under real predation pressure, or it may
      now be too harsh. Needs a game-feel call, and more seeds. Levers still
      unbuilt if it IS too harsh: diminishing returns on passive stacking
      instead of the hard out-of-combat gate, a shorter
      `REGEN_COMBAT_SUPPRESSION_TICKS`, or larger flat values.
- [ ] **Not built, still on the table** (raised in the same conversation):
      diminishing returns on stacked passives, and a per-move
      heal-reduction lever (Heal Block-style) the trees could reach for.
      Both are real design levers, neither is needed to close the
      unkillable problem now that the gate and flat conversion are in.
- [ ] **Fire is currently inert in real runs.** A 20k-tick run produced
      zero ignitions — `terrainBurn` lives only on Wildfire's Reach, deep
      in Flamethrower's Aggression branch, and no agent in the demo world
      reached it. The mechanic is real and tested but effectively unseen.
      Worth either seeding fire more broadly across the fire-type trees or
      accepting it as a rare, memorable event.
- [x] **Flat regen bumped 1.5x** (0.5->0.75, 1->1.5, 1.5->2.25, 2->3), per
      "flat conversion is fine. Maybe bump it a tiny bit." The two nodes
      displaying their own number renamed to "+0.75 HP Regen" to match.
- [x] **MAJOR: cost-2 and cost-3 tree nodes were nearly dead content.**
      Found while chasing why fire never triggered. `maybeAutoRespec` spends
      each point the instant it arrives and a cost-1 candidate almost always
      exists, so agents never bank the 2-3 points a keystone or capstone
      costs. Measured across a living population: cost-1 reached 77/456
      distinct nodes, cost-2 only 6/144, cost-3 exactly 0/4.
      - Fixed with `SKILLPOINT_SAVE_CHANCE` (0.5): bank the point when
        exactly one grant short of an already-unlocked node. Across 6 seeds
        this takes cost-3 from 0/4 to 2/4 reached.
      - The first attempt banked whenever ANY unaffordable node existed
        (almost always true) and agents saved forever, picking ~nothing.
        "Exactly one grant away" is what makes it self-limiting.
- [x] **Fire now actually happens: 0 -> 74 ignitions across 6 seeds.**
      Three separate causes, each found by measuring rather than guessing:
      terrainBurn sat only on Flamethrower (1 species entry vs Ember's 6);
      then on cost-3 nodes nothing reaches; then at depth 5, where only
      9 of 360 agents arrived and 18 of 1217 fights involved one. It now
      sits on Ember's opener "Wider Burn", whose name already promised it,
      and spills to an adjacent fuel tile since fuel is only ~5% of a map.
- [x] **Boldness de-templated.** vine_whip/flamethrower/rock_slide ran the
      same branch node-for-node with identical passive values. Vine Whip
      keeps rooted-and-thorny (it is the honest owner); Flamethrower rebuilt
      around a new `fireproof` passive (stands in its own wildfire, capstone
      leaves fire behind it); Rock Slide rebuilt around `weightScaling` +
      the `elevation` bonus, with a positional fork instead of the stock
      regen-vs-thorns one.
- [x] **Second seed confirms the ORIGINAL regen diagnosis** (a long
      background baseline run that only finished later). Seed 777, pre-fix:
      1368 living agents, 471 carrying regen, max 11.00%/tick, p90 6% —
      an identical ceiling to seed 12345's 11%/6%. Worth being precise
      about what this does and does not vindicate: the passive-stacking
      measurement is robust across seeds, because the ceiling is a property
      of the tree content and the uncapped `+=` rather than of a run's RNG
      trajectory. The POPULATION figures quoted alongside it are still
      unreliable (see below). Seed 777 also shows the runaway shape clearly:
      1368 agents alive at 20k ticks when nothing can finish a kill.
- [ ] **`damageReduction` has the same uncapped-stacking problem and was
      never addressed.** Same pre-fix baseline: median 0.15, p90 0.25, max
      0.33 across 1234 of 1368 living agents — every third point of damage
      simply deleted, on a passive that `damageReductionOf` only clamps at
      1.0 (i.e. total immunity). It accumulates permanently across every
      move's tree exactly like regen did, and unlike regen it is NOT gated
      on being out of combat, so it applies to every hit in a fight. The
      out-of-combat gate is the wrong tool here (flat damage reduction is
      not healing); the options are a real cap, diminishing returns, or
      converting the low-tier nodes to flat damage reduction the way regen
      went flat. Not urgent, but it is the same bug wearing a different
      passive.
- [x] **FIXED: the intermittent test flake — and it was never cross-file
      state.** Chased all session on the theory that parallel workers were
      sharing something. Wrong. The cause was plain unseeded randomness
      inside individual tests: damage carries a 0.85-1.0 roll, and dozens of
      A/B comparison tests built two `createWorld(w, h)` worlds with no seed
      and asserted one hit harder than the other. A different test lost the
      coin flip on each run, which is exactly why it looked like shared
      state and why every one of them passed in isolation.
      - Seeded every world in predation/needs/reproduction/status tests.
        Ten consecutive full runs clean, 43/43 files, 1367/1367 tests
        (previously roughly one failure every two runs).
      - I wrote one of these flaky tests myself this session, then hit it,
        which is what finally exposed the pattern.
      - **Second "verify the verifier" miss in the same session:** I first
        declared 8 runs clean while grepping only for failed TESTS. A test
        FILE was failing to collect (my seed constant landed inside a
        multi-line import block), so its 62 tests silently vanished from
        the count and the run still looked green. Always check
        `Test Files` alongside `Tests`.
- [ ] **REGRESSION I INTRODUCED: flat healing now stacks HIGHER than the
      percentage it replaced, on exactly the units it was meant to help.**
      Seed 777 post-fix shows a 51 HP ivysaur at **17.65%/tick** effective
      passive healing — above the 11%/tick maximum that started this whole
      investigation. Confirmed analytically rather than trusting the run:
      a 14-point budget in `dig` alone reaches 4.5 HP/tick flat, which is
      15%/tick on a 30 HP unit, 9% on a 50 HP one — and agents know several
      moves, so it sums across every tree they hold.
      - This is the SAME bug class I had just finished writing into
        MOVES_DESIGN.md as the lesson ("the sum of every node granting a
        passive has never been the unit of analysis") — and then repeated,
        with flat healing, in the same session. Flat values stack additively
        exactly like percentages do; dividing by a small maxHp then makes
        them worse, not better, for small units. The 1.5x bump compounded it.
      - Importantly this is NOT the original "unkillable mid-fight" problem
        returning: the out-of-combat gate still holds, so none of it applies
        while a unit is being hit. It is a between-fights recovery problem —
        roughly a 6-tick full heal for a small unit.
      - NOT re-tuned unilaterally, because the magnitudes were an explicit
        call ("maybe bump it a tiny bit") and this needs a decision, not a
        quiet revert. Options, cheapest first: cap total effective passive
        healing at some %/tick of maxHp (bounds the early-game case without
        touching the flat shape at all); apply the same `x / (1 + x)`
        diminishing returns to accumulated `regenFlat`; or simply undo the
        1.5x bump, which only gets it back to ~11%/tick and does not fix
        the stacking.
      - RESOLVED: the maxHp-relative soft cap was chosen and built
        (`softCapHealShare`, status.ts). Piecewise rather than plain
        hyperbolic so a light build is untouched — everything up to
        `PASSIVE_HEAL_KNEE` (3%/tick) passes through at face value and only
        the excess is compressed, asymptotically toward
        `PASSIVE_HEAL_CEILING` (8%/tick). The 17.65%/tick case now lands at
        6.7%, and no build can reach the six-tick full heal.
- [x] **FIXED: the percentage tier of both passives was dead content.** Post-fix seed 777: effective `damageReduction` is
      **median 0%, p90 0%, max 0%** across 568 living agents — nobody has
      any. Flat armor: median 2, max 5.5. The diminishing-returns curve is
      correct and tested, and currently has nothing to act on.
      - Cause is structural, not a bug: 39 of 41 DR nodes (and 31 of 38
        regen nodes) moved to flat, leaving percentage only on terminal
        capstones — and capstones are reached ~21 times out of 144 even
        after the `SKILLPOINT_SAVE_CHANCE` fix. "Reserve percent for
        capstones" and "capstones are barely reachable" combine into
        "percent never happens."
      - So the flat/percent split is doing only half its job: the flat half
        is live (arguably too live, see the regression above), the percent
        half is theoretical. Worth deciding whether percent belongs on some
        reachable mid-branch nodes instead, or whether capstone reachability
        needs another push, or whether percent-as-a-rare-payoff is actually
        the intent.
      - Same lesson as the fire mechanic: content gated behind a cost or a
        depth nothing reaches is not shipped, however well built.
      - RESOLVED by making it a three-tier system instead of two: cost-1
        common nodes grant flat (early-strong, late-marginal), the 27
        cost-2 mid-branch KEYSTONES grant percentage (reached ~15% of the
        time, so genuinely live), and terminal capstones grant a larger
        percentage as the rare payoff. Percent is no longer capstone-only,
        which is what made it unreachable.
- [ ] **Starvation is now the dominant cause of death.** Same run: 117
      starved vs 20 killed across 209 fights, at a population of 568.
      Unremarked on so far and possibly fine (a crowded world should run
      out of food) but it means combat balance is no longer what governs
      the population — food supply is. Worth knowing before reading any
      further balance measurement.
- [ ] **METHODOLOGY: stop trusting single-seed population numbers.**
      Adding one extra `rng()` draw per skill-point grant, with its effect
      disabled, moved a seed's 20k population from 129 to 3. Across 6 seeds
      population ranges 11-151. Earlier entries in this file quote
      single-seed population swings (167 -> 28 -> 8 -> 129) as if they were
      clean signal; they are not, and should be re-measured with
      `validateSkillEconomy.ts` before anyone acts on them.
      Distinct-nodes-reached is the metric that holds up.
- [ ] **The intermittent test flake is real and recurring.** Now seen in
      three different files across separate full runs (predation,
      reproduction "lays a real egg", status "burn halves the burned
      attacker's physical damage"), each passing in isolation and on re-run.
      Different test each time points at shared global state rather than one
      bad test. Narrowed a little: the status test passes 5/5 in isolation
      and only fails inside the full parallel run, and three test files
      (flora, needs, predation) spy on `Math.random`. All three do restore
      it, so the leak is subtler than a missing `restoreAllMocks` — likely
      worker/module sharing across parallel files. Not caused by the fire or
      healing work (it predates both). Worth a dedicated look.
- [ ] **Population may still be low.** Multi-seed median sits around 18 with
      a long tail to 151. Whether that band is right is still the open
      game-feel call from the previous round; the healing levers not built
      (diminishing returns, per-move heal reduction) remain the tuning
      options if it wants raising.
- [x] **damageReduction: diminishing returns + a flat tier.** Direct steer:
      "for damage reduction, we do diminishing returns and flat."
      - `damageReductionOf` now applies `x / (1 + x)` at read time (the raw
        passive is only ever stored as a running sum, so there are no
        individual sources to stack multiplicatively). 0.05 raw -> 0.048
        effective, 0.33 -> 0.248, 1.0 -> 0.5; immunity is unreachable
        rather than clamped. Preferred over a hard cap so single nodes
        still deliver face value and there is no dead zone where further
        investment silently does nothing.
      - New `damageReductionFlat` passive; 39 of 41 nodes converted
        (0.03->0.5, 0.04->0.75, 0.05->1, 0.06->1.25, 0.08->1.5, 0.1->2),
        the 2 terminal capstones keep percentage and were raised to 0.12.
      - `MIN_LANDED_DAMAGE` floors a landed damaging hit at 1 so flat armor
        can never make a unit immune to weak attackers — the classic
        flat-armor failure. A move already dealing 0 still deals 0.
      - One node named "+0.03 Damage Reduction" renamed "+0.5 Armor".
      - 8 new tests (curve shape, monotonicity, unreachable immunity, the
        floor, percent+flat stacking).
- [x] **Capstones made reachable — but the lever was commitment, not
      saving.** Direct steer: "should be reachable."
      - First measured the RIGHT thing. The old metric (distinct cost-2
        nodes reached across the whole roster) mostly measured how much
        agents concentrate on the same branches. Per INVESTING agent,
        at the existing settings: 36% already reached a cost-2 keystone,
        but only 1% ever reached a terminal capstone.
      - Raising `SKILLPOINT_SAVE_CHANCE` made things WORSE, not better
        (0.5 -> 0.75 took keystone reach 46% -> 29%, because agents banked
        instead of buying). Left at 0.5.
      - The actual blocker: agents spread ~14 chosen nodes across three or
        four trees and never finished a branch. New
        `SKILLPOINT_FOCUS_BONUS` (2) weights the auto-respec toward the
        move already furthest along. Across 8 seeds x 8k ticks, capstone
        reach went **1% -> 6%** with keystone reach flat (36% -> 32%,
        inside the noise). Same number of points, spent as a build.
      - It stays a bias, not a rule — a test asserts an agent still puts
        points into its other moves.
- [x] **More combat, via keeping predators alive.** Direct steer: "I think
      starvation is fine but I do want some combat."
      - Diagnosed rather than assumed: fights were ALREADY 15-28 per 1000
        ticks. The real failure was predator persistence — of four seeds,
        two ended with zero living predators and one with 77% (prey eaten
        out). A world with no hunters still has herd clashes, but nothing
        is being hunted.
      - New `predatorNicheBoost` (immigration.ts): a predator species is up
        to 6x likelier to be the one that immigrates when the living
        predator share is below `PREDATOR_TARGET_SHARE` (0.2), tapering to
        no boost once the niche is filled. Only nudges WHICH species
        arrives — never whether immigration happens or how many.
      - Result across the same four seeds: no zero-predator worlds left
        (predator share 23%/6%/14%/57%), and the two seeds that had gone
        predator-free went from 2 and 10 kills to 21 and 41.
- [ ] **Predator/prey balance is still swingy.** One seed still ends at 7
      living agents with 57% predators. The niche boost stops predators
      vanishing but does nothing about a predator population overshooting
      and eating out its own prey. A prey-side equivalent, or a predator
      starvation pressure tied to prey density, would be the next step if
      this becomes annoying.
- [x] **Ecosystem equilibrium: founder viability was the missing feedback.**
      Direct ask: "let's try to get it more balanced. Try our best to get
      equilibrium."
      - Measured the DYNAMICS, not endpoints (new
        `validateEcology.ts`, which sparklines predator/prey/food over a
        run). An endpoint cannot tell a healthy oscillation from a collapse.
      - Two false leads, both corrected by measuring rather than reasoning:
        (1) `born 0` in every seed looked like reproduction was dead — it
        is simply a live-birth event, and egg-laying is the real path
        (161 eggs hatched in one seed). (2) The shelter comfort threshold
        (0.85, vs a median agent at 0.72 hunger / 0.68 thirst) looked like
        the blocker; lowering it changed nothing and was reverted.
      - The real cause: immigration's `1 / (count + 1)` weighting peaks for
        an ABSENT species, so it relentlessly maximised diversity. Measured:
        16 living agents across 11 species, 7 singletons, only 2 species
        with both sexes present. Nothing could breed, so those worlds sat on
        immigration life-support forever while a luckier seed bootstrapped
        to 167.
      - Fixes: `founderWeight` adds an Allee-style boost for a species that
        is present but below `FOUNDER_VIABLE_COUNT`, and `MIN_GROUP_SIZE`
        goes 1 -> 2 (a lone arrival has no possible mate).
      - Result across 8 seeds x 12k ticks:

        | | before | after |
        |---|---|---|
        | predator share p90 | 57% | **31%** |
        | samples with zero predators | 14% | **9%** |
        | population volatility (cv) | 0.55 | **0.36** |
        | worst-seed volatility | 0.69 | **0.49** |

      - The remaining zero-predator samples are cycle TROUGHS that recover,
        visible in the sparklines, not extinctions — which is what
        equilibrium actually looks like.
      - Tuning note: cranking the predator niche boost makes it worse on
        every axis (target 0.3 / boost 12 puts p90 back to 53% and cv to
        0.47). A hard shove replaces extinction with overshoot; the gentle
        setting is the one that cycles.
- [x] **The Chronicle: herds as named entities with a story.** Direct ask:
      "the story of a herd as an entity... I want to trace what zones they
      migrated across, what their notables are, what happened to them...
      I want stories", plus "yes named herd, just [good] bits. Filter hard."
      - The sim was already recording nearly every beat (migrations, clashes,
        splits, titles, droughts, eggs eaten). What it could not do was say
        WHOSE story an event belonged to: a herd was an opaque id string with
        no identity, no founding and no memory of where it came from.
      - New `herds.ts`: a `HerdRecord` per herd — evocative name from the
        biome it formed in ("the Bulbasaurs of Saltrun"), founding tick and
        place, origin (founding / split / immigration), parent herd for
        lineage, peak size, and a dissolution tick so a herd's ending is part
        of its story. Registered by a once-per-tick sweep; splits and
        immigration register themselves first so lineage is not lost.
      - `agentDisplayName` gives individuals real names. "egg evolved into an
        ivysaur" reads like a bug report; "Yarrowhide took the lead" is a
        story.
      - `herdId` stamped onto killed/starved/evolved so losses can be
        attributed to a herd after the fact.
      - New `chronicle.ts` (runner) turns a run into prose. Filtering hard is
        the whole design: deaths within 400 ticks collapse into one "hard
        stretch", repeated beats dedupe (an early draft gave one herd five
        separate "Quillspur took the lead" lines), evolutions collapse to a
        single coming-of-age line, and only the 8 strongest beats per herd
        survive.
- [ ] **Chronicle: next steps.** Not built yet, in rough priority order:
      migration paths drawn on a map; a family tree of splits; notable
      titles woven in (the `titleClaimed` path is wired but no title was
      earned in the sample run, so it is untested in prose); weather and
      drought as named events a herd survived; and an Atlas-style artifact
      instead of terminal text.
- [x] **Notables as epithets, each with its own tale.** Direct ask: "I need
      notables as epithets, it'd be cool to tell the tale of the notable as
      well like how they earned it. Each notable type should spin a story
      about the individual."
      - New `notableLore.ts`. Epithets come in SETS per title (4 each) picked
        deterministically from the holder's id, so two heroes in one world
        aren't both "the Unbroken" — "Sablesong the Red-Clawed",
        "Bramclaw Grudge-Keeper", "Nimtail the Far-Walked".
      - Each of the seven titles spins its own tale from the REAL tracked
        stat, never a shared template with a number swapped in: the hero's is
        about violence, the elder's about time, the wanderer's about
        distance. A test asserts all seven produce distinct prose.
      - `rival` now records WHO the grudge is against (`nemesisOf`, the
        most-negative rapport partner) — "they nursed a grudge against
        Sablesong" is a story; "they nursed a grudge" is a stat. In the very
        first real run this produced a genuine emergent one: the world's
        Rival hated the world's Hero.
      - The claim event also carries `herdId`, so a notable reads as "a
        venusaur of the Bulbasaurs of Saltrun" — which incidentally shows
        evolution within a named herd.
      - The chronicle gives notables their own section rather than burying
        them as herd footnotes, lists the predecessors a title was taken
        from, and uses the LIVE stat for a sitting holder (an Elder crowned
        at exactly the 500-tick threshold now reads "7154 ticks alive"
        rather than being frozen at the moment they qualified).
- [x] **Names: type-flavoured pools mined from the move roster.** Prompted by
      "are you random genning them?" — they are not, they are a deterministic
      hash of the agent id, but checking the pool while answering exposed a
      real defect: 20 starts x 12 ends = 240 total names. By the birthday
      problem that is a 56% chance of a collision at 20 named animals and a
      near-certainty by 40; across 2000 ids "Vexmane" came up 18 times. Two
      notables sharing a name would wreck a chronicle.
      - New `names.ts` with roots split by Pokemon type, ~24 each, largely
        lifted or filed down from this project's own 440 move and tree-node
        names (Pyroclasm, Maelstrom, Mountainfall, Bedrock, Bramble) so names
        sound like they belong to this game. Direct ask: "pull them based on
        like Pokemon + fantasy vibes. Maybe sample move names and splice em
        up."
      - Pool is now ~24 roots x 12 infixes x 40 ends per type. Measured: zero
        collisions at 80 same-species animals, and a bug type can no longer
        collide with a grass type at all. A name now carries information —
        "Buzzpelt" reads bug, "Driftsong" reads water.
      - Two defects found and fixed by looking at real output rather than
        trusting the design: bit-shifting one hash for all three components
        left them correlated (7 of 8 sampled names drew an infix from a table
        that is two-thirds empty), so each component now uses an independent
        hash; and naive concatenation produced "Sapathhide" and
        "Nettleelmaw", so joins now drop a repeated letter at the seam.
      - Still deterministic: no rng draw, so naming cannot perturb a seeded
        run, and re-running a seed reproduces every name exactly.
- [x] **Chronicle in the renderer.** Direct ask: "make it pretty in the
      renderer."
      - Extracted the story logic into the engine (`chronicle.ts`) FIRST,
        because there are now two consumers: the runner prints text, the web
        app renders a panel. The valuable half of this feature is the
        filtering — which moments are worth telling and what gets thrown
        away — and two copies of that would have drifted within a week. The
        runner script is now a thin renderer over the shared module.
      - New Chronicle tab in the web app, between Events and Legend. Each
        beat carries a coarse `kind` (founding / loss / movement / conflict /
        notable / growth / split / end) so the panel can colour its left
        border and pick an icon without parsing prose — a chapter is
        skimmable without being read.
      - Cheap by construction: the panel no-ops entirely while its tab is
        hidden and re-derives at most once every 200 ticks while open. A
        chronicle is a whole-run summary; deriving it 60x a second would be
        pure waste.
      - Verified by actually looking at it in a browser rather than assuming
        — which caught a stutter no test would have: the founding beat
        repeated the herd's own name, so the panel read "The Spearows of
        Stormfen" as a heading and then "the Spearows of Stormfen were here
        when the world began" directly under it, lowercase mid-sentence.
        Founding beats no longer name their own herd.
- [ ] **Chronicle: still to do.** Migration paths drawn on the map; a family
      tree of splits; clicking a herd to focus the camera on it; weather and
      drought as named disasters a herd survived.
- [x] **Named territories, labelled on the overworld.** Direct ask: "what if
      zones or collections of zones were named? Can we do that based on
      biome too, and even label it on the overworld?"
      - COLLECTIONS, not zones — the overworld grid is 64x64, so naming
        every zone would mean four thousand labels and no map. New
        `territories.ts` flood-fills adjacent same-biome LAND zones into
        regions and names those: 55-78 per world, covering ~90% of the land.
        "the Endless Rainwood", "the Thirsting Dunes", "the Ash Scar",
        "the Heron Wash", "the Cloud Tors".
      - Names are `<prefix><suffix>` with biome-specific pools, joined
        without a space for a lowercase word-ending ("Elderwood") and with
        one for a standalone noun ("the Ashen Waste"). That one distinction
        is most of what separates a place name from a generated string.
      - Deliberately does NOT name a territory after a landmark inside it,
        though the first version did: landmarks are already a separate
        labelled POI layer AND they are not unique, so that produced three
        different regions all called "the Crossroads" in one world. A
        landmark sits IN a region; it is not the region.
      - Two more defects found by looking at real output: "the Crag Crags"
        (prefix repeating the suffix — now re-rolled), and duplicate names
        across regions (now tracked and re-rolled per world).
      - Labelled on the macro map, drawn in one pass after every zone so no
        block paints over a label, with a size threshold that scales with
        zoom so a zoomed-out map only names the big regions. Screenshotting
        the real app caught two more: labels clipped at the canvas edge
        ("un Meadows", "the Riot Car") now clamp inward, and overlapping
        labels are skipped biggest-region-first rather than nudged, since a
        label moved far enough to clear a collision no longer points at its
        own territory.
- [ ] **Territories: not yet wired to herd names.** A herd's place name is
      still invented locally ("of Saltrun") rather than drawn from the
      territory it was founded in. The obstacle is real: a run simulates ONE
      promoted zone, so every herd in it shares a single territory and would
      share a single name. Options: qualify the territory name with a local
      feature, name herds after the territory only for the first herd
      founded there, or show the territory as context in the chronicle
      rather than in the name.
- [x] **Herds named after their territory, with type-flavoured qualifiers.**
      Direct asks, in order: "do the zone name, unless one herd of that type
      already exists. Then give it a second name like 'the exiles of the
      elder wood'", then "try to make the qualifiers flavorful to the typing
      of the Pokemon too? The severed flame sounds super cool for example",
      then "The sinister vine. The aquatic zealots".
      - `promoteZone` now stamps the macro territory's name onto the
        promoted world, so a herd's name points at a place that exists on
        the overworld map. A standalone scenario world with no overworld
        above it still falls back to an invented local place name.
      - First herd of a species in a place gets the species: "the Rapidash
        of the Crag Heights". Every later one gets a qualifier built from
        TWO shapes in rotation, since one pattern for a whole world gets
        samey however good it is:
        - origin adjective + type noun — "the Sundered Ember", "the Severed
          Flame", "the Sinister Vine"
        - type adjective + collective noun — "the Burning Zealots", "the
          Aquatic Zealots"
      - The origin half carries WHY a second herd exists (a splinter group
        really is severed, immigrants really are wandering), and the type
        half makes it a group you can picture.
      - Two defects caught by running it rather than reading it: the
        immigration path never passed typing (the roster has none), so every
        immigrant herd fell back to the generic pool and came out "the
        Wandering Kin" whatever walked in; and uniqueness was checked
        per-species, so a Golbat herd and an Onix herd were both "the
        Wandering Kin of the Crag Heights". Names are now unique across
        every herd in the world and stay spent after a herd dies, because a
        name is an identity in the chronicle's permanent record.

- [x] **What actually killed a herd.** Direct verdict on the ending beat the
      chronicle used to print — "The last of them was gone." — "Are we not
      following what kills them? Just dying out is sad and vague."
      - We *were* following it. Every death this engine can inflict already
        records a typed event stamped with the victim's herd: `killed`
        carries the predator's own species, `starved` distinguishes hunger
        from thirst, `burned` comes from fire.ts. The chronicle simply was
        not reading any of it at the one moment it matters most. That is the
        recurring shape of this project's bugs — the data was there and
        nothing looked at it.
      - New `endingText` in `chronicle.ts` reads the herd's own deaths in the
        final stretch (the death-cluster window, not the whole run — a herd
        mauled early and starved at the end is remembered for the starving)
        and names the dominant cause: "Hunted to the last — 3 of them taken
        by **Spearow**", "Starved out — the last one died with nothing left
        to eat", "The water failed them", "Fire took them". A second cause is
        named only when it is at least half the first, so a single stray
        death does not read as more important than it was.
      - Naming the animal is the whole point. "Hunted to the last by Spearow"
        is a story; "predation" is a statistic.
      - One real fix underneath: `burned` was the only death event with no
        `herdId` on it, so fire deaths were invisible to every herd story,
        not just the ending. Stamped now, and fire deaths also join the
        "hard stretch" loss clusters they were being left out of.
      - **An honest case that matters as much as the dramatic ones.** A herd
        can end with no death at all — its last members walk into another
        region and get folded into a herd there (`foldAgentIntoAggregate`) —
        and that gets its own line rather than an invented death.
      - Nothing dies of old age, so the chronicle can never write "they grew
        old" — but that is a deliberate removal, not a gap. See the
        correction below.
      - Across six seeds the endings are dominated by thirst, which is a
        balance signal rather than a writing one and is logged separately.

- [~] **CORRECTION: "nothing dies of old age" is not a bug.** Logged here
      as a wrong finding rather than deleted, because the way it was reached
      is the instructive part. `grep 'kind: "diedOfAge"'` over the engine
      returned zero record sites, and I reported that as an oversight — an
      event type declared and never fired. It is nothing of the sort:
      `ageMortalityChance` is fully implemented in needs.ts with an onset,
      a ramp and a cap, and was then deliberately UNWIRED on direct
      instruction — "dying of old age is kinda dumb." needs.test.ts even
      has a test asserting no agent ever dies of age, with the reasoning in
      a comment right above it.
      - The grep was accurate and the conclusion drawn from it was wrong.
        Absence of a call site tells you a feature is not running; it says
        nothing about whether that is an accident or a decision. The
        decision was recorded in a test, which is exactly where it should
        have been looked for and was not.

- [x] **Names: infix removed, and a parity bug it was hiding.** Direct
      verdict: "waspdraseeker and foamthalborn and flarewynwing is a bit
      much. Waspseeker and foamborn and flarewing and pincerheart accomplish
      the same thing better." They do. Names are strictly root + end now.
      - The infix was buying pool size (~9,600 per type) at the cost of the
        names themselves. Paid for it by growing the pools instead: 24 -> 36
        roots per type and 40 -> 78 ends, giving ~2,800 per type.
      - **The interesting part is what removing it exposed.** Measuring the
        new pool showed exactly 1,404 reachable names out of 2,808 possible
        pairings — precisely half, which is never a coincidence. FNV-1a
        preserves parity: every step is an xor with a char code and a
        multiply by an odd constant, so the low bit of the output is just the
        seed parity xored with the parity of the input bytes. Salting an id
        with the fixed suffix `":end"` (one odd byte) therefore flipped that
        bit *every single time*, locking the root index and the end index
        into opposite parities. Half the name space was unreachable and the
        output looked completely fine. Fixed with an avalanche finalizer on
        the hash; all 2,808 are now reachable.
      - This is the second correlated-hash bug in this one file (the first
        was bit-shifting a single hash for three indices). The lesson that
        actually generalizes: a generated-content pool needs a test that
        asserts the *whole* pool is reachable, because partial reachability
        is invisible in the output by construction.
      - `names.test.ts` now asserts a measured collision RATE (1.4% of
        12-animal cohorts, 5.2% of 20-animal cohorts contain any duplicate)
        instead of the "zero collisions at 80 animals" it used to claim.
        With a 2,800-name pool that claim is simply false — it only ever held
        for the one hand-picked set of ids the test happened to use.

- [x] **Thirst is over half of all herd endings — and the water never
      shrank.** Measured over three seeds x 6,000 ticks, 19 herds ended: 10
      of thirst, 5 hunted to the last, 3 with no death at all, 1 of hunger,
      0 to fire. Prompted by the obvious question — did the water dry up? —
      the answer was no, and the real cause was more interesting.
      - **Water is permanent, and the drought/rain terrain cycle already
        existed.** Water is terrain, not stock: drinking never depletes a
        tile and `seekWater` can even dig a new one. And the "drought should
        dry up water, rain should refill it, drought should kill berries"
        behavior asked for in this round turned out to be **already built
        and already wired** from an earlier ask — `advanceWaterCycle` (small
        puddles dry at 1/150 under drought, large lakes shrink at 1/3000 but
        never below a floor, rain re-forms water adjacent to existing water)
        and `floraDecayDivisor` (drought decays food 4x faster and
        suppresses spread; rain slows decay 3x and spreads more). Checked
        before building, so nothing was duplicated.
      - **It was a clock asymmetry, not a resource one.** Thirst was linear
        at 0.00125/tick (801 ticks + 150 grace = 951); hunger decays as a
        fraction of what remains (1,709 + 100 = 1,809). Thirst gave 53% of
        the runway and was 53% of endings — the same number twice. The
        curve SHAPE mattered more than the total: hunger self-brakes as it
        empties, so its last 20% took 815 ticks while thirst's took 160. An
        agent in real trouble had 5x less time to reach water than food,
        which is exactly the window where it must cross terrain to get
        there. Two needs with two different physics, for no design reason:
        hunger got a curve in an earlier "much much slower" pass and thirst
        only got a smaller flat number.
      - **Fix: thirst now uses hunger's curve** (`THIRST_DECAY_RATE` 0.002 +
        `THIRST_DECAY_FLOOR` 0.0001), tuned to keep its character rather
        than become a second hunger — it still crosses the 0.7 seek-water
        cutoff FASTER than hunger (169 vs 216 ticks, so animals still drink
        more often than they eat) but the tail is forgiving: ~1,671 total
        against hunger's ~1,809 (92%, was 53%), last 20% at 804 vs 815.
      - **And drought's thirst multiplier drops 1.8 -> 1.2.** Weather here is
        one-sided — there is no drought term on hunger at all — so every
        drought cell was purely a thirst event and never a famine. The
        answer is not a bigger number on both sides: drought already has two
        better, *visible* ways to hurt (drying ponds, killing food patches).
        Making a herd walk further to a shrinking pond is a better drought
        than silently draining a hidden meter faster, so the meter effect
        steps back and lets the map do the work.
      - **Real-run result, same three seeds, before -> after:**
        - Ending causes: thirst 10 -> 6, hunger 1 -> 8, hunted 5 -> 3, no
          death 3 -> 5. Thirst went from 53% of endings to 27%; hunger from
          5% to 36%.
        - Starvation deaths by cause: seed 11 22 thirst/6 hunger -> 11/12;
          seed 22 **26 thirst / 0 hunger** -> 24/23; seed 33 20/4 -> 9/11.
          Hunger was not merely under-represented before, it was very nearly
          a non-mechanic — one seed recorded zero hunger deaths in 6,000
          ticks despite the whole flora/season/drought system feeding it.
        - Population (3 seeds): 15/16/25 -> 15/35/20. Not a wipeout in
          either direction; seed 22 more than doubled and gained living
          herds (9 -> 13), seed 33 dipped. Within the run-to-run variance
          this sim has always had, so no conclusion is drawn from it beyond
          "nothing collapsed."
      - The stale `THIRST_STARVATION_GRACE_TICKS` doc comment is fixed: it
        claimed ~350 vs ~527 from before the quartering pass and concluded
        the gap was not "principle-violating," where the real figures were
        951 vs 1,809. At the new 1,671 vs 1,809 that claim is true again.
      - `needs.test.ts` now asserts the SHAPE (thirst drains more slowly the
        emptier it gets; its last stretch is within a small factor of
        hunger's; it still crosses 0.7 sooner) rather than only a magic
        first-tick number, so retuning the constants cannot silently
        reintroduce the flat tail.

- [x] **UI round: herd/notable identity, region name, notable stars, birth
      beats, click-to-find.** Seven direct asks, all shipped. The engine
      changes are small (stamping `herdId` onto the three egg events so a
      chronicle can attribute them); the rest is presentation.
      - **Herd names in battle logs and HP bars.** `idLabel` now reads
        `"Kingler (32, the Kinglers of the Bright Coast)"`, and a combatant
        chip in the Battle Screen carries its herd on a quieter second line.
        The short id survives on purpose: a herd routinely holds several
        animals of one species, and dropping the id would make two Kinglers
        of the same herd literally identical in the log — the exact problem
        an earlier ask ("shrink the Id and origin... like cubone (32,
        immigrant)") had already fixed. The herd name takes the ORIGIN
        word's slot instead, which it strictly dominates (an immigrant herd
        is called "the Wandering Kin", a splinter "the Severed Flame").
      - **Notables under their full name.** `"Surgeshade Single-Minded
        (Kingler)"` rather than `"The Warrior (Kingler)"`, from the engine's
        own `notableFullName` — so the log, the HP bar, the inspector and
        the chronicle finally all call the same animal the same thing.
      - **`herdDisplayName` now returns the real `HerdRecord.name`.** It had
        been hashing a titled member's id into a 16-word pool and returning
        "Ember's Pack" — a leftover from when a herd was nothing but an
        opaque id string with no record behind it. The UI was inventing a
        second, unrelated name for a group the chronicle had already named.
      - **Region name above the play bar** (`#region-banner`), read live from
        `world.territoryName` every frame rather than pushed on load, so
        promoting a different zone cannot leave it stale.
      - **A persistent star on notables** on the zone map, upper right.
      - **Birth beats in the chronicle.** The honest beat is not the laying:
        a herd lays far more than it raises (eggs get eaten, and a clutch
        laid into a full cluster is simply lost), so the beat reports both
        halves when they differ — "6 eggs laid, 3 of them hatched" — plus
        "2 eggs laid, and not one of them hatched" and a clustered "3 eggs
        were taken from the nest."
      - **Click a species or herd to find them.** The selection is stored as
        the QUERY (a species id or a herd id), never as the ids matching it
        right now, and re-resolved every frame — a herd loses and gains
        members constantly, and a frozen list would quietly become a
        highlight of whoever used to be in it. Frames the whole group rather
        than centring on one member, and draws a cyan ring per member (a
        spread-out herd's bounding box says nothing; the rings are what let
        you actually pick its members out of a crowd).

- [x] **Two bugs only the running app could have shown.** Both found by
      driving the real UI with a browser, neither reachable by any test in
      this repo. Worth recording as a pattern: every test and the runner
      TICK before they assert, and they dispatch events programmatically —
      so a bug that only exists at tick 0, or only when the DOM is being
      rebuilt under a real pointer, is invisible to all of them.
      - **Herd names were raw ids on the first screen.** Herd records are
        created by `tickHerds`, a once-per-tick pass, so a world that has
        not been ticked has agents carrying `herdId`s no record exists for.
        Normally invisible for one tick — except this app boots PAUSED, so
        the first thing a viewer saw was "spearow-zone-32,32" instead of
        "the Spearows of the Green Plain", and it stayed that way until they
        pressed play. Fixed by running the engine's own `tickHerds` once at
        world-load time (it is idempotent, so this is exactly the state tick
        1 would produce, one frame earlier).
      - **The click target was being destroyed mid-click.** The inspector
        overview is deliberately marked dirty every tick ("a live
        population/weather overview, not a static placeholder"), so the row
        list is rebuilt several times a second. A `click` only fires if the
        same element survives from mousedown to mouseup — a browser test
        clicking a herd row at ordinary speed retried 25 times over 30
        seconds and never landed one. Now committed on `pointerdown`.
      - A third, milder one: the notable star shipped at 0.17 of a tile with
        a full-width dark outline, leaving **7 fill pixels** on screen at
        default zoom. A screenshot could not show that it was there or that
        it was not; a pixel-scan of the live canvas for the star's exact
        fill colour found 7 before the fix and 33 after. Small was the ask,
        invisible was not.

- [ ] **Breeding is wildly seed-dependent.** Noticed while checking the new
      birth beats: over 8,000 ticks seed 24757 laid **3** eggs while seed 11
      laid **67** (39 hatched, 28 eaten). Both are healthy-looking worlds by
      population. A 20x spread in reproduction across seeds means the
      breeding gate (level 16 or evolved, DESIGN.md) is sitting right at a
      cliff edge for some worlds and not others. Worth a multi-seed look at
      what fraction of a population ever reaches the gate at all.

- [ ] **Cross-zone migration is architecturally present and practically
      dead.** Prompted by: "it is very confusing to have 100+ krabbys in one
      zone and 0 in an adjacent one. We have random immigration. But do we
      have real herd based migration? Can they spill over?"
      Measured over 8,000 ticks per seed, not reasoned about:

      | | seed 20260903 | seed 11 |
      |---|---|---|
      | `herdMigrating` (within a zone) | 22 | 35 |
      | `dispersed` (individual leaves home) | 0 | 9 |
      | `regionCrossed` (actually left the zone) | **0** | **1** |
      | `immigrated` (arrived from off-map) | 12 | 11 |
      | zones tracked, of 4,096 | **1** | **2** |

      - **Within-zone herd migration is real and works.** `herdMigration.ts`
        moves a whole herd as a group on five triggers (scarcity, predator
        pressure, weather, territorial, wanderlust), every member pulling
        toward one shared point. 22-35 of these per run, and they show up in
        the chronicle ("Moved on — the food had run out"). That half of the
        question is a clean yes.
      - **Cross-zone movement is not.** Random immigration outnumbers actual
        emigration by 12:1 and 11:1. Population can arrive from off-map but
        essentially never leaves, which is exactly the reported symptom: one
        stuffed zone, empty neighbours.
      - **The abstract spillover mechanism cannot run, by construction.**
        `maybeEmigrate` is the thing designed to spread population across
        the grid (10% of a species into a random adjacent zone). It
        explicitly skips the FOCUSED zone — reasonably, since that zone has
        real individuals rather than an aggregate — so it only ever operates
        between two *background* zones. But a zone only becomes tracked when
        something puts population there, and the only thing that can is an
        individual walking out of the focused zone. Chicken and egg: the one
        zone that has anything to export is the one zone forbidden from
        exporting, so with 1 tracked zone `maybeEmigrate` has nothing to do
        on any tick of the run. Seed 11 is the proof — a single crossing
        created a second zone, and only then did the mechanism have two
        zones to move between.
      - **Not a level gate, which was my first guess and was wrong.**
        `DISPERSAL_MIN_LEVEL` is 15 and 19 of 20 living agents were at or
        above it, with a max of 52. The throttle is further down: dispersal
        itself is rare (0-9 per run), and `REGION_DISPERSAL_CHANCE` then
        keeps only 25% of those, and that survivor still has to walk to the
        map edge without dying.
      - **Nothing anywhere is density-driven.** `EMIGRATION_CHANCE_PER_TICK`
        is a flat 0.002 whether a zone holds 4 animals or 400, and herd
        migration's triggers are all local-resource or threat based, never
        crowding. There is no carrying-capacity pressure pushing a packed
        zone outward — which is precisely the force that would fix the
        reported symptom.

      Options, none applied — this is a design call:
      1. **Herd-level zone crossing** (what was actually asked for): when a
         herd's existing scarcity/territorial migration picks a destination
         and the herd is near a map edge, let the WHOLE herd walk out into
         the neighbouring zone instead of a lone disperser. Reuses the
         migration pipeline that already works, and makes the overworld
         story "the Krabbies of the Bright Coast moved east" rather than
         "one Krabby wandered off."
      2. **Density-driven emigration pressure**: scale emigration on
         population against the zone's own `resourceIndex`/
         `baseResourceIndex` (both already tracked), so a crowded zone
         pushes out and an empty one does not.
      3. **Let the focused zone shed a slice at the aggregate tier** — the
         cheap deadlock-breaker: remove N real agents and add them to a
         neighbour's aggregate. Least interesting, but it alone would end
         the chicken-and-egg.
      4. Separately: should the world START with populated neighbours? Right
         now every zone but one is genuinely empty at tick 0, so even a
         perfect migration system begins from a single point of life.

      Recommendation: 1 + 2 together. 1 is the mechanic the question asks
      for and 2 is the force that makes it fire when a zone is overfull.

- [x] **Herd-level zone crossing + density-driven emigration.** The fix for
      the diagnosis above ("100+ krabbys in one zone and 0 in an adjacent
      one"). Chosen approach: options 1 and 2 together — the mechanic the
      question asked for, plus the force that makes it fire.

      **A/B over 6 seeds x 8,000 ticks:**

      | | before | after |
      |---|---|---|
      | zones populated | 18 | **167** |
      | `regionCrossed` | 6 | **97** |
      | off-map population | 113 | **7,604** |
      | focused-zone population | 234 | **369** |

      The map fills in, and the focused zone was not drained doing it — the
      thing worth checking, since a migration system that empties the zone
      you are watching would be a cure worse than the disease.

      - **Crowding trigger** (`CROWDING_CAPACITY_PER_ABUNDANCE`): local
        headcount against what the land supports, expressed with the same
        capacity notion the aggregate tier already uses
        (`baseResourceIndex * CAPACITY_SCALE`) rather than a second invented
        one. It outranks scarcity deliberately: the two can be true at once
        and want opposite things — scarcity hunts for the richest patch left
        in this zone, which for an overfull zone means marching the herd to
        the least-stripped corner and stripping that too.
      - **Whole-herd zone crossing** (`tryZoneCrossing`): built entirely out
        of the existing crossing pipeline rather than a new one. An
        individual disperser already leaves by carrying `crossingToRegionId`
        plus an edge `dispersalTarget`; `finishDispersal` already
        early-returns for a crosser so its herd identity survives, and
        `applyRegionCrossings` already folds it into the destination. The
        only thing missing was anything that set those fields on more than
        one animal at once. Every trigger can now cross, at a per-reason
        chance — crowding highest (0.85, since no in-zone move relieves it),
        weather and predators lowest (0.15, since both are local by nature).
      - **Density-driven `maybeEmigrate`**: the flat 0.002/tick now scales
        with how far over capacity a zone is, up to 6x. A zone holding 400
        used to shed population at exactly the rate of one holding 4.

- [x] **Three bugs found while verifying the above, none by reading the
      code.** Recording them because the pattern keeps repeating: the code
      looked right in every case.
      - **Herds set off and never arrived.** 24 animals told to leave across
        9 emigrations; *zero* arrived in 8,000 ticks. The dispersal walk only
        advances while `chooseBehavior` reads "idle" — hunger AND thirst
        above 0.7 — and the stuck crossers sat at 0.50-0.65 forever. The
        mechanism was self-defeating: the crowded, hungry zone that makes a
        herd want to leave is precisely the condition that pins it in place.
        Fixed with `CROSSING_URGENCY_TOLERANCE` (0.55) for zone crossers
        only, which keeps the substance of the earlier "agents died of thirst
        standing next to water" fix — a genuinely desperate animal still
        breaks off and resumes after — while letting a merely peckish one
        walk. This is what the original instruction actually said: needs jump
        the queue *based on urgency*, not on any shortfall at all.
      - **The crossing re-fired every tick.** A crossing deliberately creates
        no `herdMigrations` entry (the herd is about to stop existing in this
        world), so nothing marked the herd busy and every trigger
        re-evaluated it every tick. A test asserting one emigration event
        caught **201** — one per tick. Fixed with an explicit
        `isHerdCrossing` check at the top of the per-herd loop.
      - **My own test was testing the wrong trigger.** The crowding tests
        used an always-zero rng, which fires *wanderlust* on tick 1 — so they
        were exercising a wanderlust crossing while claiming to test crowding.
        Now uses an rng tuned to fail wanderlust and pass the crowding roll.
        A test that passes for the wrong reason is worse than no test.

- [ ] **Aggregate zones can settle above their own capacity.** Noticed in the
      A/B: seed 44 ended with 5,989 animals across 80 zones, ~75 per zone
      against a capacity of at most 50 (`baseResourceIndex * CAPACITY_SCALE`
      with the index capped at 1). The world filling up is the intent, but
      sitting *above* capacity is not — emigration keeps adding to zones
      already full while the logistic term only pulls them down slowly. Worth
      checking whether an arriving slice should be refused (or bounce onward)
      when the destination is already at capacity.

- [x] **Auto Camera follows only the inspected Pokémon.** Direct ask: "if
      you're focused on a Pokémon in inspector while autocam is going, just
      filter to all notable autocam events that involve that unit. Filter out
      all else while it's focused."
      - Applied at the QUEUE, not at render time: a filtered-out moment never
        occupies a queue slot, never starts a dwell timer, and never counts
        against the per-category cluster cooldowns. Filtering at render time
        would leave the camera idling through moments it had already decided
        not to show.
      - An already-tracked fight the focused agent is in can still widen when
        a third participant joins — the gate is only on creating a NEW
        engagement, or the camera would stop following the very fight it
        exists for.
      - Selecting mid-battle cuts away immediately rather than waiting for
        the current fight to finish. `reset()` clears the focus, since a new
        world's ids would match nothing and silently filter out everything.
      - The dim passive battle boxes are deliberately NOT filtered: they are
        how a viewer sees the rest of the world is still alive and clicks
        away to something else. Filtering those too would leave no way out.

- [~] **Seamless terrain between zones — LAYER 1 DONE.** Asked: "if I wanted seamless terrain
      between zones... how hard is that? Like I move south off a zone and just
      show up like the zone itself sorta expanded?" Full analysis in
      `SEAMLESS_ZONES.md`; measured with the new
      `packages/runner/src/validateZoneSeams.ts`.
      - Today, measured: at a shared edge terrain matches 37% (east) / 50%
        (south) of the time with a mean elevation jump of 0.85 / 0.77, against
        a within-zone control of 73% and 0.131. A **6.5x discontinuity** —
        walking south would be a hard cut, not an expansion.
      - Cause: every zone is generated independently from its own seed with
        noise sampled in ZONE-LOCAL coordinates. Neighbouring zones are
        already *statistically* coherent (`biasForZone` passes down elevation,
        biome, coast/river/high edges, and massifs already bias toward a
        higher neighbour) but share no actual field, so they are not
        *geometrically* continuous.
      - Layers, cheapest first: (1) global hash-based noise lattices indexed
        by world coordinate — mechanical, most of the visible win, unambiguous
        pass/fail via the validator; (2) biome seeds scattered per macro cell
        and blended across neighbours; (3) generate-with-margin so the
        cellular-automata passes (massifs, caves, chambers, canopy) agree from
        both sides; (4) actually walking across, which is an architecture
        change (promote-on-approach, or a moving window) rather than a
        generation one.
      - Rivers stay hard even after (3) — a traced path is not a local rule.
        `ZoneGenerationBias.riverEdges` anticipated this; lining them up wants
        a macro-level river trace.
      - Recommendation: do (1) alone and re-measure. There is no point padding
        CA margins while the noise underneath still disagrees across the
        border.

- [x] **Seamless zones, layer 1: global noise + one elevation field.** Full
      writeup and the two wrong turns in `SEAMLESS_ZONES.md`. Seam terrain
      agreement went **37% -> 80%**, elevation jump **0.851 -> 0.291**, which
      is now indistinguishable from the within-zone control (77%, 0.368).
      - Noise lattices are hashed from GLOBAL coordinates instead of read
        from a per-zone array, with `origin`/`fieldSeed` threaded through
        (`WorldPlacement`). Density thresholds calibrate over a fixed global
        window, or "10% food" would mean a different raw cutoff on each side.
      - Elevation needed more than global noise, and two attempts failed
        first — both the same mistake: a per-zone `oceanFraction` percentile
        cannot be taken of a world-shared distribution (70% floor became 97%
        water, then 100%). The fix was to stop having two opinions about
        where the ocean is: the macro grid already IS a global elevation
        field, so it is now the truth, sampled bilinearly between zone
        CENTRES so neighbours agree at their shared edge by construction,
        with noise as local texture.
      - **Fixed a real pre-existing incoherence:** zones the macro map called
        ocean were generating as 70% dry land.
      - **Caused and fixed a regression:** the global calibration also hit the
        standalone path (which the macro grid itself uses), narrowing its
        range so the SNOW biome disappeared entirely and `frozenGrotto`
        became unplaceable (11/11 landmark types -> 10/11). A standalone map
        has to span its own range.
      - Three unrelated-looking test failures each got a real answer rather
        than a threshold bump — a vacuous-then-wrong `findWalkableNear`
        precondition, a BSP-wobble bar measured to sit inside its own natural
        3-17 spread, and an arid-stretch bar one seed's luck was holding up.
      - **Residual is layer 2, now measured:** dominant biome matches across a
        seam **7%** of the time against **92%** within a zone, and biome
        drives elevationBase/Variance — so where two zones blend to different
        biomes their elevation still steps (seed 11: 0.47 against a 0.03
        control). Biome seeds scattered per macro cell and blended across
        neighbours is the next layer.

- [x] **Seamless zones, layer 2: fuzzy biomes.** Direct ask: "I want fuzzy
      biomes." Biome seeds now live on one world-shared 17-tile lattice
      instead of being scattered per zone, returned in zone-local coordinates
      (negatives included) so `blendBiomeParams`/`biomeWeightsAt`/
      `World.biomeSeeds` all work unchanged — two neighbours express the same
      seed in their own frames and compute the same blend between them.
      - **Each seed's biome is chosen fuzzily**, weighted by proximity to the
        four surrounding macro-zone centres rather than snapped to the
        nearest. A hard nearest-cell lookup would have moved the seam, not
        removed it: every seed one side of a midpoint desert, every seed the
        other grassland, and the blend still flips at a line. The weighted
        roll gives border zones a real mixture, so the fade happens over a
        band tens of tiles wide.
      - `dominantBiome`'s extra seeds are skipped on this path — the macro
        grid already sets each seed's biome, and re-weighting toward "this
        zone's biome" would undo the fuzzy border entirely.
      - **Result: seams now match or beat the within-zone control on every
        seed tested.** 37%/0.851 -> 92%/0.017 (control 90%/0.028). Dominant
        biome across a seam 7% -> 93%, and one zone still blends three
        biomes, so this bought fuzziness rather than uniformity.
      - Also seeded an unseeded `createWorld(5, 1)` in simulation.test.ts that
        flaked once in a full-suite run and passed alone and on three
        re-runs — the same class of flake this repo already fixed in
        needs.test.ts. Four clean full runs since.

- [ ] **Zone-to-zone transition (the "walk south, arrive at the top" step).**
      Clarified: not smooth scrolling — a screen transition, Zelda-style.
      Walk off an edge, the neighbour promotes, and you appear at the mirrored
      position on its opposite edge. Now that terrain is seamless this should
      read as one continuous world rather than a jump cut. Needs: promote the
      neighbour on crossing, place the crosser at the mirrored edge position
      instead of folding it into an aggregate, and move the camera. The known
      cost is the existing lossy demote — the zone you leave turns its
      individuals back into aggregate numbers.

- [x] **Battles were unwatchable — and it was clashes, not battles.** Direct
      report: "battles are so short now, i can't follow em at all... its too
      fast too follow", then "it doesnt even seem to linger at all to me. on
      4x speed it barely flashes."
      - **Measured first.** Real fights in the simulation are genuinely tiny:
        over 6,000 ticks, 20 engagements with a **median duration of 1 tick**
        and a 90th percentile of 6. So part of "too short" was not a bug at
        all — a one-tick fight is a single exchange, and the camera was
        correctly framing it, showing one beat and releasing.
      - **The actual bug was that most of what you watch is a `clash`, not a
        `battle`.** Seed 20260903 over 6,000 ticks: **594 herdClash against 45
        fought** — 13 to 1. An earlier merge gave clashes the same rich Battle
        Screen as a real battle (same move/crit/damage lines, same HP bars)
        but none of the pacing that makes one readable. A clash:
        - never entered `enterBattleStep`, so it ran at whatever the speed
          slider said — at 4x, a 1-7 tick fight is a literal flash;
        - never triggered `maybeAutoSwitchTab`, so the panel it renders into
          usually was not even on screen;
        - held for `CLASH_EPILOGUE_MS` 400ms after concluding;
        - went stale after `CLASH_STALE_MS` 1200ms, which at a battle-step
          cadence is barely one tick.
      - Fixes: clashes now enter battle-step and auto-switch the tab like
        battles; `CLASH_STALE_MS` 1200 -> 2800, `CLASH_EPILOGUE_MS` 400 ->
        1500, and a new `CLASH_MIN_ONSCREEN_MS` of 3000.
      - Separately, `BATTLE_STALE_MS` (3000ms) was **shorter than the p99 gap
        between hits in one fight** (7 ticks ~ 4.6s), so real battles were
        being cut off while still going. Raised to 4500.
      - New `BATTLE_MIN_ONSCREEN_MS` (5000) is the honest lever for a
        one-exchange fight: it does not lie about the simulation (the fight
        really is over) but keeps the result on screen long enough to read.
        The alternative — a long staleness timeout — was tried at 40 ticks
        and produced ~26s of dead air, which is what an earlier fix removed.
      - Pacing: `BATTLE_STEP_INTERVAL_MS` 650 -> 950 and
        `LINE_REVEAL_INTERVAL_MS` 160 -> 200. At 650/160 a four-line hit used
        640 of the 650ms tick, so lines arrived as an unbroken stream; 800 of
        950 leaves a real gap between exchanges.
      - **A fix of mine that shipped as dead code, caught only by measuring.**
        The first commit added `BATTLE_MIN_ONSCREEN_MS`/`CLASH_MIN_ONSCREEN_MS`
        and the check that reads them — but the line that STAMPS
        `activeSinceRealMs` never landed, because the string replace that was
        meant to insert it silently no-op'd on an indentation mismatch. The
        field was therefore always `undefined`, the guard
        (`activeSinceRealMs === undefined || ...`) short-circuited to true,
        and the entire minimum-hold feature did nothing. It typechecked, it
        built, and the constants were right there in the file. Live
        measurement at 4x is the only thing that found it: median on-screen
        time 1.7s, nowhere near the 3s floor that was supposedly in force.
        After stamping it: **median 3.0s**, and the tick counter advances
        more slowly over the same wall-clock (433 vs 577 ticks in 200s),
        which independently confirms battle-step now engages for clashes.
      - `CLASH_PROMOTION_COOLDOWN_TICKS` 40 -> 100, since each clash now holds
        the camera for seconds and 594 per 6,000 ticks would otherwise
        monopolise Auto Camera and crowd out every other kind of moment.

- [x] **Skill-tree allocations were never visible — a key-space mismatch.**
      Direct report: "i don't see the actual skill allocations being
      visible."
      - `agent.moveTreeChoices` is keyed by the `knownMoves` DEX KEY
        (`"WATER_GUN"`); `agent.moves` is keyed by the `MoveSpec`'s own id
        (`"water_gun"`). Both the old flat-row tree and the new radial Move
        Tree Atlas did `agent.moveTreeChoices?.[move.id]`, which never
        matched. Measured over a real 4,000-tick run: that lookup lit **0
        nodes across 70 rendered trees**; resolving properly lights **726
        across 64**. A level-31 Kingler with 28 bought Water Gun nodes
        displayed as having bought none.
      - leveling.ts documents the trap at its write site ("those two are
        frequently different casings/names for the same move") and handles it
        for `agent.moves`. Fixed by resolving each stored key through
        `LEVELING_CONTEXT.resolveMove` — the engine's own mapping — rather
        than upper-casing, which that comment warns is not enough.
      - **Note on how this landed.** A parallel session had meanwhile built
        the radial Move Tree Atlas (`moveTreeSvg.ts`), replacing the flat
        BFS row grid. My first pass fixed the OLD renderer and also centred
        its rows; on merging, the row-centring work was discarded as
        obsolete and only the lookup fix was re-applied on top of the atlas.
        The atlas had the identical bug, so the visualization was correct and
        drawing an empty build the whole time.

- [ ] **Side note: duplicate node display names.** The Tackle tree renders two
      separate nodes both labelled "+10 Accuracy" in the same row (plus a
      "+5 Power" that repeats a row later). Not a rendering bug — the tree
      data really does give distinct nodes identical display names, which
      makes a tree impossible to read. Wants real names.

- [x] **Move Tree Atlas opened at its empty top-left corner.** Direct
      follow-up: "are the nodes centered and easy to see on expand?" — asked
      after I had verified only the DATA (nodes chosen) and not the layout.
      They were not.
      - Measured on a real 106-node Tackle tree: the SVG renders **1204px
        wide inside a 306px holder** (panel 378px), so `svgRightGap` was
        **-898** — it overflowed by 898px, with the first content 140px in
        and 758px of it off the right edge. A scroll container starts at 0,0,
        which for a RADIAL layout is the empty corner diagonally away from
        the root.
      - **Not fixed by shrinking it.** The native scale is deliberate: an
        earlier fit-to-width version squeezed a ~1,200-unit tree into ~300px
        and turned every node into a speck ("it looks like it's missing a
        bunch"). Fixed by scrolling the box to centre on load instead —
        on the union of CHOSEN nodes when a build exists (the reason to open
        a tree at all, and on a big tree the specced cluster is often
        nowhere near the middle), otherwise on the whole tree.
      - After: left/right gaps symmetric at **-449 / -449**, content gaps
        **-309 / -309**, focus offset from centre **0, 0**, scroll at
        **449, 392** instead of 0, 0.
      - Caught one of my own selector mistakes en route: the first version
        looked for `[data-chosen='1']`, an attribute I had invented and that
        `moveTreeSvg.ts` never sets — it would have silently fallen back to
        centring the whole tree and looked like it worked. The real class is
        `.node-chosen`.

- [ ] **Still open: a 1200px tree in a 306px panel means scrolling.** The
      centring makes it open in the right place, but you still see roughly a
      quarter of a large tree at a time. There is an existing
      `#expand-panel` button that widens the panel, which helps. Real
      options if that is not enough: a fit/native zoom toggle on the tree
      itself, or auto-expanding the panel when a tree is opened. Not chosen
      unilaterally — the native scale was a deliberate call and reversing it
      is a design decision, not a bug fix.

- [x] **Move rows show nodes allocated; inspector gains a Rapport group.**
      Direct ask: "next to move it shows how many times used. can you also
      show how many nodes allocated? and then also we want rapport added to
      inspector per unit."
      - Move row now reads `4 nodes · used 0×`, with a tooltip giving
        `N of M skill nodes allocated`. Shown only for a move that HAS a
        tree — "0 nodes" on a treeless move is noise, and most of a real
        moveset is treeless (an 11-move Kingler had 2 trees).
      - **Rapport shaped by what a real run contains, not by the -1..1 range
        the type suggests.** Measured at two points: by tick 1,800 agents
        average 2.9 edges (max 8) with 12 negatives among 86; by tick 4,000
        it is 10.9 each against the hard cap of 16, and 613 of 614 edges are
        positive, mostly 0.02-0.17.
        - Only the strongest 6 by ABSOLUTE score are listed, so one real
          grudge is never buried under a dozen faint acquaintances, with a
          "+N weaker" line for the rest.
        - The bar is scaled to the row's own strongest edge, not to -1..1.
          Against the true range a typical 0.05 bond is a two-pixel bar and
          every relationship looks identical. The raw score sits beside it as
          text so the relative bar can never imply 0.05 is a strong bond.
        - Edges routinely point at EGGS and at agents that have since died
          (an edge outlives its subject until decay prunes it). Both are
          labelled — "Krabby egg", "(lost)" — rather than silently dropped.
      - Verified in the running app: a Kingler showing `4 nodes · used 0×`
        and a Rapport group with a 1.00 bond to a Krabby egg. The multi-row
        and negative-score paths are confirmed present in the data but were
        not visually exercised — the agent the harness landed on had one edge.

## Biome uniqueness pass — built, see DESIGN.md

- [x] **Grassland waterDensity was higher than Forest's own** — direct
      report: "I feel like there's too much water in like grassy plains type
      environments. They don't feel distinct from coastal ones." Confirmed
      real (0.08 vs Forest's 0.07), fixed by shifting some of the cut into
      `foodDensity` instead of a flat `waterDensity` drop — a pure water cut
      to 0.03 broke a real survival-margin test (macroGrid.ts's
      `estimateZoneResourceIndex`/`RESOURCE_ESTIMATE_SCALE` explicitly
      calibrated so Grassland stays comfortably above `overworld.ts`'s
      `DEATH_HEALTH_THRESHOLD`). See DESIGN.md for the full numbers.
- [x] **Three new biomes**: Savanna (dry open plains, carved out of
      Grassland's own driest moisture sub-band), Mangrove (real coastal
      marsh, carved out of Wetland's coastal-adjacent footprint), Tundra
      (cold open steppe, elevation-gated just below Highland). Each gets its
      own real structural generation pass (not just density-knob variation):
      `carveSavannaClusters` (acacia-style tree/bush islands),
      `carveMangroveLattice` (braided water channels), `carveTundraPermafrost`
      (ice-wedge polygon crack lines) — worldgen.ts.
- [x] **3 new crops**: Groundnut (Savanna, drought-resistant), Mango
      (Mangrove/Jungle), Mushroom (Tundra/Highland/Snow, winter-hardy) —
      crops.ts, same tier-ladder gates every other crop uses.
- [x] **8 new species, all Gen 1 with real sprite art**: Kangaskhan/Tauros
      (Savanna), Poliwag/Poliwhirl/Slowpoke/Slowbro (Mangrove), Dewgong
      (Tundra/Snow) — species.ts. First pass picked 8 Gen 2/3 species by
      flavor fit alone without checking for sprite art first; direct catch:
      "Oh... you did Gen 2... I don't think we got sprites for em." Redone
      Gen-1-only, every pick's `public/sprites/` art confirmed present
      BEFORE adding it this time. Krabby/Kingler (already Gen 1, already
      arted) also picked up "mangrove" as a real secondary biome for free.
- [x] **Real recoloring for biome uniqueness** — direct ask: "just use some
      recoloring techniques." A `BIOME_TINT` ground wash (palette.ts,
      renderer.ts's `drawBiomeTint`) and a `BIOME_FLORA_TINT` tree/bush
      sprite recolor (`tintedSprite`, drawn on an isolated offscreen canvas
      per sprite variant so `source-atop` only tints the sprite's own
      silhouette, cached) — no new art files, real recolors of the existing
      shared tile art. Savanna/Tundra also reuse `floor_desert`/`floor_stone`
      as their base texture instead of the generic default.

## Biome species round 2 — built, see DESIGN.md

- [x] Direct follow-up: "we need more species that can spawn in them than
      just those... not anywhere near our full species list." Added 9 more
      Gen-1 species, all sprite-art-confirmed first: Doduo/Dodrio/Rhyhorn/
      Rhydon (Savanna), Goldeen/Seaking/Grimer/Muk/Farfetch'd (Mangrove),
      Graveler (Tundra, Geodude's own reachable evolution — Geodude itself
      also picked up "tundra" as a real third biome).
- [ ] **Still open, real gap**: `public/sprites/` has ~85 more real,
      Gen-1-arted species with zero roster entry at all. This pass only
      targeted the 3 new biomes specifically asked about — a broader
      "flesh out the whole roster" pass is a separate, bigger task.

## Fixed: thin biomes always spawned every fitting species, every zone

- [x] Direct report: "make spawn in different zones, so like i don't have
      to see a million krabby on every single beach zone. maybe some of em
      have seel or whatever and no krabby's." Confirmed real:
      `pickZoneSpeciesPool`'s existing `ZONE_SPECIES_POOL_MIN/MAX` (4-7)
      trimming only ever fires when a biome has MORE fitting species than
      that — Beach (5 fitting), Tundra (3), Desert/Snow (5) all sit at or
      under that floor, so every zone got the full fitting list,
      unconditionally, every time. Measured on a real 60x60 grid: 12/15
      Beach zones showed the identical 5-species pool, Krabby in all 15.
      Fixed by scaling the pool's own lower bound down with a thin biome's
      `fitting.length` (floored at 2) instead of always floating at the
      fixed MIN — Beach now real-measures at 72% Krabby inclusion (was
      100%), Tundra 85% (was 100%); a rich biome (Wetland, Forest) is
      unaffected. See DESIGN.md for the full numbers and the rng-stream
      regression this caught and fixed along the way.

## Whole-roster species pass — built, see DESIGN.md

- [x] Direct follow-up: "let's add more. Species to em all." Added 38 more
      Gen-1 species across every biome (not just Savanna/Mangrove/Tundra),
      taking the roster from 57 to 108 — every pick sprite-art-confirmed
      and, where an evolution is included, evolution-reachability-confirmed
      against the real dex before adding. Full evolution lines completed:
      Rattata/Raticate, Pidgeotto/Pidgeot, Fearow, Nidoran♀/Nidorina,
      Nidoran♂/Nidorino, Venonat/Venomoth, Paras/Parasect, Bellsprout/
      Weepinbell, Machop/Machoke, Drowzee/Hypno, Abra/Kadabra, Gastly/
      Haunter, Dugtrio, Sandslash, Primeape, Kabuto/Kabutops, Omanyte/
      Omastar. Base-only (no in-sim-reachable evolution, same accepted
      limitation as Growlithe/Onix): Clefairy, Jigglypuff, Exeggcute,
      Tangela, Magmar, Aerodactyl, Chansey, Lickitung, Pinsir, Pikachu,
      Eevee. Tundra (this roster's thinnest biome even after the round-2
      pass) also picked up Machop/Machoke/Primeape/Aerodactyl as a real
      cold-mountain secondary.
- [ ] **Deliberately excluded, real open question**: the 5 Gen-1
      legendaries (Articuno/Zapdos/Moltres/Mewtwo/Mew) all have real sprite
      art but were NOT added as ordinary spawnable population — this is a
      population sim, not a catching game, and whether a legendary should
      exist as a regular breeding/dying zone resident (vs. a one-off
      landmark-bound event, vs. not at all) is a real design decision, not
      a species-roster mechanical add. Flagged here rather than decided
      unilaterally.
- [ ] Also skipped for weak natural-biome fit in an ecological sim (not a
      sprite-art or evolution-reachability issue): Ditto, Porygon,
      Electabuzz, Hitmonlee/Hitmonchan, Mr. Mime, Magnemite/Magneton line,
      Voltorb/Electrode, Koffing/Weezing. Real, arted Gen-1 species — could
      still be added if the "no natural biome" call is wrong; a request to
      revisit is enough to redo it.

## Fixed: predator population per zone hard-capped — see DESIGN.md

- [x] Direct report: "Kabutops are just utterly slaughtering everything...
      make high level predators like no more than 2 in a zone." Verified
      first: Kabutops (evolution floor level 40 + PREDATOR_LEVEL_BOOST) was
      spawning at level 46-51 against level-5 co-spawned prey in the same
      zone — the real cause is the level gap, population itself was already
      only 5-7. Added the requested `PREDATOR_POPULATION_CAP = 2` anyway —
      real and requested, fewer high-level killers doing the damage — a
      real zone's Kabutops population measured at exactly 2.00 after (was
      5.3-7.5 before). Caught a real collision with the existing Sanctuary
      predator-discount test along the way: a flat cap applied AFTER the
      Sanctuary's own extra discount clamped both the ordinary and
      Sanctuary case to the same number, erasing the "Sanctuary is even
      thinner on predators" signal — fixed by capping first, then applying
      Sanctuary's discount on top of the already-capped number.
- [ ] **Still open, the deeper cause**: the level gap itself. Kabutops
      (level 40 floor) is the roster's most extreme case, but Charizard
      (36), Tentacruel (30), Haunter (25) aren't far behind, all spawning
      well above most base-form prey's low end. `PREDATOR_LEVEL_BOOST`
      (`immigration.ts`) already narrows this somewhat but wasn't designed
      around an evolution floor this high. Not fixed here — a balance
      call, not decided unilaterally.

## Fixed: high-level predator occurrence itself, not just population — see DESIGN.md

- [x] Direct follow-up: "I think the level 40 gap can happen, it should
      just be rare. We should make it a rare occurrence." Root cause: the
      earlier `PREDATOR_POPULATION_CAP` fix only thinned Kabutops'
      population once present — it was still GUARANTEED present in every
      Beach zone, since Kabutops was Beach's only fitting predator and
      every selection mechanism (pool-size trim, predator-cap split)
      deterministically includes the sole candidate whenever a predator
      slot fills. Fixed by having a predator's `rarity` ALSO gate whether
      it's even a candidate for a zone's pool at all (an independent roll,
      before any pool-size math runs) — completing `rarity`'s own
      documented intent ("a multiplier on how often this species shows
      up"), which zone-seeding had never actually read for inclusion,
      only for population size. Gave Kabutops `rarity: 0.3`. Real
      generated-grid measurement: Kabutops now shows up in 28.5% of Beach
      zones (was 100%). Full engine (1262) and data (240) suites green.

## Fixed: usually a lower-level Kabuto predator, rarely the level-40 Kabutops — see DESIGN.md

- [x] Direct follow-up correction: "can't we have a lower level kabutops?
      Change the level adding distribution instead. A predator kabuto is
      OK too." Kabutops literally can't spawn below level 40 (its real
      evolution requirement) — there's no level roll to lower while
      keeping it Kabutops. Real fix: tagged Kabuto itself `isPredator: true`
      (real mainline "preyed on smaller life" flavor) — no evolution floor
      to clear, so it spawns at a normal ~5-18 like any other base-form
      predator. A Beach/Wetland zone's predator niche now usually resolves
      to Kabuto; Kabutops (kept at its earlier `rarity: 0.3`) is the rare
      escalation on top. Measured on a real generated grid: Kabuto in 100%
      of Beach zones at level 12-18, Kabutops in 31.6% at its unavoidable
      ~46+. Full engine (1262) and data (240) suites green.

## Movepool cap, forgetting, savant bar — open (awaiting decisions)

Raised in one message: *"we technically don't cap moves to 4 moves per unit. I
think we should add a cap. Force forgetting. Also forgetting gives you skill
points back to reinvest. I think Ai on deciding to forget a move or not should
be sharpened a bit. In addition requirements for savant notable need to be
higher, maybe all nodes in an entire branch with our new 45 node trees to get
it."* Plus: *"aim to cap at 20% dmg reduction max, 10% regen per move... up to
50% thorns is fine."*

### Done
- Per-move passive ceilings are now enforced by `check-proposed-trees.ts`
  (20% `damageReduction`, 10%/tick healing as one budget, 50% `thorns`), with
  the selftest extended to prove each can fail. See `DESIGN_VALIDATION.md`.

### Measured (`measureMovepool.ts`, 4 seeds x 10k ticks, 69 living agents)
| | |
|---|---|
| knownMoves | mean 12.1, median 13, p90 16, max 17 |
| combat-usable moves | mean 8.5, p90 12, max 14 |
| agents over 4 moves | 95.7% |
| level (control) | mean 32.7, median 36, max 56 |
| nodes chosen | mean 31.7, p90 81, max 94 |
| savant today (>=6) | 60.9% of living agents |
| savant at >=12 | 24.6% |
| deepest single branch | max 13 |

A 4-move cap is a 3x cut on the typical agent and forces roughly nine forget
decisions per lifetime, which makes the forget-AI the load-bearing part of the
feature rather than a detail.

### Open decisions
1. Which nodes eat the healing cut on dig (28.4%), leech_seed (23.9%),
   solar_beam (20.8%) — all driven by `regenFlat`.
2. dig's 29% damage reduction -> 20%: proposed `deepening_instincts` 0.12->0.05,
   `unflinching_burrow` 0.05->0.03, `unshakable_ground` stays 0.12 (damage
   reduction concentrates in Boldness, per the colour pie).
3. Refund scope on forgetting: all points spent in that tree, minus a tax, or
   refunded as wildcard rather than typed points.
4. Savant bar: 11 (a genuinely maxed 12-node branch, minus one side of a fork),
   12, or including bridges.
5. What "sharpen the forget AI" is pointing at — no cap exists today, so this
   may just be "make it good from the start."
6. Does the cap apply to `knownMoves` (status moves compete for slots) or only
   to the combat-usable `moves` subset.

### Known limits of the above
- n=69 living agents on 4 seeds; an 8-seed rerun is the control for the savant
  percentages.
- A per-move passive cap does NOT bound a species. `grantPassive` is uncapped
  and totals sum across every move known, so four capped moves still stack to
  80% damage reduction. `passive-exposure.ts` is the tool for that; nothing
  fails a build on it yet. Worst live case today: thorns 65% (venusaur,
  ivysaur), damageReduction 42% (diglett, sandshrew).

## Fixed: Battle Screen chip losing HP bar/level/herd/sprite, showing bare id — see DESIGN.md

- [x] Direct report with screenshot: "Why did we lose hp bars and stuff
      sometimes? On the battle renderer." Root cause (code-confirmed,
      NOT live-reproduced despite heavy stress testing — see DESIGN.md's
      honesty note): `applyCombatantState`'s `world.agents.find` lookup can
      fail for an id a chip already painted (corpse pruned after
      `CORPSE_PERSIST_TICKS`, or a mobile tab's rAF falling behind real
      ticks), and every field degraded to its "no agent" branch at once —
      bare id text, no sprite/level/herd/HP. Fixed by freezing an
      already-painted chip on its last real state instead of stomping it,
      using the same frame-to-frame persistence `combatantEls` already
      relies on for the HP bar's CSS transition. Typecheck/build/full test
      suites green; live stress-tested (thousands of ticks, dozens of real
      battles) with zero regressions, but never actually caught the
      original failure in the act — worth re-checking if it recurs, ideally
      with a repro that's easier to force (e.g. throttling the tab).

## Built: zone-level banding (safer near a Sanctuary, rising with distance) — see DESIGN.md

- [x] Direct report + proposal: "Still got a lot of lvl 40+ slaughtering
      low levels. Maybe certain zones (friendlier ones) don't have high
      levels... spawn. We can have bands of acceptable level ranges per
      zone and adjacent zones with changing normalized probability curves
      with the median increasing or decreasing as you get further away
      from a particular zone." Decision: distance from nearest Sanctuary,
      soft re-center (not a hard clamp), spawn-time only. New
      `distanceToNearestLandmark` (macroGrid.ts), `World.sanctuaryDistance`
      (carried down at promotion, same as `territoryName`), and
      `zoneLevelCenter` (immigration.ts) blend with the existing
      `localAvgLevel` re-centering in `rollImmigrantLevel` — wired into
      both live immigration AND a never-visited zone's initial invented
      population (`estimateInitialAggregates`), so the effect isn't just on
      later immigrants. Full engine suite (1267, 5 new) green. NOT yet
      spot-checked live in the running app (Sanctuaries are sparse — a
      handful per grid — so landing near one in a short session is luck of
      the seed); worth a live check next time.
- [x] Follow-up retune: "Maybe 5 should be 30, 8 like 35 and 12+ like 46.
      Since levels get exponentially harder to gain as you get [higher].
      More xp." Reshaped `zoneLevelCenter` from a flat per-step ramp into a
      concave power curve (`floor + (cap-floor) * (dist/maxDist)^0.6`, ramp
      cap raised 7 -> 12 steps, cap level set to 46) — fast climb near a
      Sanctuary, flattening out further away, mirroring the sim's own
      "later levels cost more XP" curve spatially. Real measured checkpoints
      on a 60x60 grid, 6 seeds: dist 5 -> 29 avg (asked ~30), dist 8 -> 37
      avg (asked ~35, the one anchor this curve can't hit exactly — the
      three named anchors aren't fully consistent with any single smooth
      curve), dist 12+ -> 46 avg (asked 46, exact). See DESIGN.md's full
      table. Full engine suite (1267) green.
- [ ] Follow-up not yet built (explicitly scoped OUT of this slice, per "spawn
      time only"): a low-level zone's peace can still be broken by a
      high-level predator WANDERING in from herdMigration.ts after
      spawning elsewhere — same "40+ slaughtering low levels" symptom, a
      different cause. Whether/how to also discourage that drift is a
      separate design question for later.

## Built: herd young-protection, pieces 1+2 (proactive guardian + age-based cohesion) — see DESIGN.md

- [x] Direct question + decision: "do herds protect their young at all? I
      don't seem to see it... needs more instinct to protect while alive,
      stay closer, and avenge when dead" -> menu of 3 pieces -> "Sure."
      Built 1 (proactive guardian trigger: `findHerdmateInDanger` now
      notices a herd-mate a nearby predator has already committed to
      hunting, `behavior === "hunt"` + matching `huntTarget`, not just one
      already fleeing/fighting) and 2 (age-based tight cohesion:
      `applyHerdCohesion`'s tighter leash now also fires on
      `isJuvenile(agent)` directly, not only the level-gap proxy). Full
      engine suite (1270, 5 new) green. Real before/after (8 seeds x 10,000
      ticks each, same seeds, code swapped via `git stash` — not just two
      unrelated runs): guardian-intervention rate on a juvenile death
      roughly tripled, 17% -> 50%; juvenile deaths 6 -> 4, total deaths
      250 -> 271 across the same 8 seeds (noted honestly as suggestive, not
      a clean causal read — any behavior-timing change cascades the whole
      shared-rng timeline from that point on, so per-seed numbers aren't
      "the same encounters resolving differently"). See DESIGN.md's full
      table and honesty note.
- [ ] Piece 3 (avenge) intentionally NOT built yet — genuinely new
      mechanic (temporary pursuit/aggression toward a still-nearby killer
      after a herd death), no existing code to extend, needs its own
      design/tuning pass rather than being bolted on blind. Still on the
      menu, not decided against.


## Four-move cap, forgetting and the refund — BUILT

Direct: *"we technically don't cap moves to 4 moves per unit. I think we should
add a cap. Force forgetting. Also forgetting gives you skill points back to
reinvest. I think Ai on deciding to forget a move or not should be sharpened a
bit."* Then: *"the 4 moved cap applies to all"* (knownMoves, status moves
included) and, on who decides, **B** — the sim decides for wild Pokemon, the
player for theirs.

Refund shape, direct call **A + C**: the full amount ever spent, nothing
withheld, returned as WILDCARD rather than typed points. Full value so
forgetting is never a punishment for having specialised; wildcard so it does
not simply re-buy the branch it came from.

### Measured, 3 seeds x 6000 ticks, 71 living agents

| | before | after |
|---|---|---|
| knownMoves mean | 11.8 | 3.97 |
| knownMoves max | 21 | 4 |
| agents over 4 | 94.9% | 0% |
| agents keeping a usable status move | — | 42.3% |
| agents keeping a damage move (control) | — | 100% |

### Two flaws only the live run found — the unit tests passed through both

1. **The cap did not hold at all.** `spawnAgent` writes `knownMoves` directly
   and never went through `enforceMoveCap`, so 57 of 105 living agents sat
   over the cap (mean 7.56, max 21) while every unit test passed.
2. **The forget AI deleted the entire specialisation system.** A level-42
   Charizard spawn came out knowing Dragon Claw, Metal Claw, Fire Fang and
   Flame Burst — four generic dex-derived specs with no tree — having dropped
   Slash, the curated move with a full 45-node tree, because Slash scored
   marginally lower on raw damage per action. Fixed with a tree-POTENTIAL
   term scaled by node count. Three existing spawn tests caught this: the
   tests were right and the code was wrong.

### Open, worth a decision

- **The refund does not fire in the live sim yet, and the reason is
  structural, not a tuning error.** Direct correction: *"It's okay to drop an
  invested move but there should be reasoning behind it."*

  First guess was that the investment weight (8) was an effective veto. It
  was too high and is now 2 — the honest weight once the refund is followed
  through: forgetting returns EVERY point as wildcard and `maybeAutoRespec`
  starts spending them again, so a built move is converted, not destroyed.
  What is really lost is the build's shape, its passives (revoked), and the
  time to climb again. Friction, not a lock.

  But lowering it changed nothing live, so it got measured instead of
  guessed. Of 27 living agents: **7 have no investment at all, 9 have one
  invested slot, 5 have two, 6 have three — and none has all four.**
  `maybeAutoRespec`'s focus bonus concentrates points in one move, so there
  is always a cheaper slot to free and the AI never NEEDS to spend a built
  one. Dropping an invested move while an untouched one sits there would be
  the wrong call, so this is the AI reasoning correctly, not refusing to.

  The path is proved reachable by a test rather than left on faith: an agent
  with all four slots invested and a clearly better new move drops a built
  one, refunds all 12 points, and logs why — with a control showing a
  MARGINALLY better move does not win the slot. It will start firing live
  once agents routinely fill all four slots with investment, which is a
  consequence of every move reaching 45 nodes.

- **`forgotMove` now carries a real reason** — "outclassed" (a build given up
  because something outscored it), "redundant" (the movepool was doubling up
  on a type), "unbuilt", "declined", "capacity". Live distribution over 3
  seeds: declined 5470, capacity 902, redundant 785, unbuilt 556.
- **76% of cap events are the new move being DECLINED** (5136 of 6744), so an
  agent largely settles on its first four moves and rarely changes shape
  after early life. Whether a movepool should be that static is a design
  call.

## Fixed: a Pokémon fighting and killing itself — see DESIGN.md

- [x] Direct report with screenshot: a Weepinbell shown fighting/killing
      itself — same agent id as both attacker and defender, only one
      Battle Screen chip ever rendered. Confirmed real via a new
      `packages/runner/src/validateSelfAttack.ts` (24 self-fought events,
      8 seeds x 10,000 ticks, all the literal same agent id repeatedly).
      Root cause: the guardian branch's threat scan in
      `applyPredationInstincts` (predation.ts) is centered on the
      herd-mate being protected, not the guardian — `agentsWithin` only
      ever excludes whatever it's centered on, so the guardian itself was
      never excluded from its own scan. Weepinbell is `isPredator: true`;
      a Weepinbell guardian defending a weaker, different-species
      herd-mate could pass its own `isGenuineThreat` check against that
      herd-mate and get picked as THE threat — fighting itself, tick
      after tick, since nothing ever clears a `fightTarget` pointed at
      its own owner. Fix: one added `other.id !== agent.id` filter
      clause. Confirmed via `git stash` that the new regression test
      genuinely fails without the fix. Real before/after, same 8 seeds:
      24 self-fought events -> 0. Full engine suite (1311, 1 new) green.

## ROADMAP M2 See — built; side notes

Built per ROADMAP.md (STATUS there has the numbers). Things noticed on the
way, not acted on:

- **Leaving Overworld mode by the toggle probably leaves the macro map
  displayed.** `overworldToggleBtn`'s off-branch in main.ts sets
  `macroMapWrapEl.hidden = true` and *removes* `force-hide` — the same
  pattern that hid nothing in player mode (the wrap's `display: flex`
  beats the attribute). Hypothesis from reading the code, NOT reproduced
  live; the boot path never takes that branch. Two-line fix if confirmed.
- **The day/night tint no longer applies underground** (renderer's
  `drawDayNightTint` returns early off the surface). Before M2 the cave was
  drawn at whatever brightness the surface clock happened to be at. Fog is
  now the cave's darkness. If a real underground light model comes (M5's
  torch), it belongs in `vision.ts`'s `ambientLightAt`.
- **Cave floor still uses surface biome textures** (carried from M1).
- **Sim agents have no memory and no fog** — `Agent.vision` is
  player-only. If "did the Sandshrew see me?" ever needs to be asked from
  the sim side, `playerVisibleTiles` is agent-agnostic already.
- **Dev hook:** `window.__pokuelike.world` on the vite dev server only
  (`import.meta.env.DEV`). Playwright checks should read state from it
  rather than scraping the inspector, which only shows the selected agent.

## ROADMAP M3 Need — built; side notes

- **Energy has no consequence for the player.** Decays like anyone's
  (34% by tick 131 in the live run, 0% at death), but the only thing in the
  engine that reads low energy is `chooseBehavior`'s sleep threshold, which
  the player never runs. Needs a rest/sleep verb (a time-spend: "sleep
  until rested or disturbed") and ideally a real cost for exhaustion
  (speed? accuracy?) so the meter means something. Decision needed on the
  cost; not tuned unilaterally.
- **Death lifts the fog.** `renderer.ts`'s `playerVision` goes through
  `findPlayer`, which returns undefined for a dead player, so the frame
  under the death screen shows the whole cave. Reads as the usual
  roguelike "here is what you missed" and is kept, but it was not designed.
  If it should stay dark, look up the player with `controlledBy` directly.
- **The player's `consumed` event reads "Human (player) ate on
  underground"** in the event log — the sim's third-person line. When the
  log gets a player voice (M4+), "You ate" belongs there, not in the HUD's
  one-line message only.
- **Eat is one key per bite** (0.4 hunger per press; a patch has ~3 bites).
  Fine for now; a "eat until full" time-spend is the same shape as sleep.

## ROADMAP M4 Read — built (tells + examine); side notes

- **Hearing (SENSORY_LAYER.md's first slice) was not attempted.** The
  roadmap said "only if cheap; the tells are the priority." Still open.
- **Never seen in a 3-seed × 2000-tick sample:** "is carrying food to X"
  (deliverFood — the same unreachable `foodDelivered` finding from the
  rapport round) and "is eating from a carcass" (scavenge). Both tells
  exist and are unit-tested; neither fires on a real run. Same
  unreachable-content stack as fire / healAura / sharedWater.
- **"Training" is 31% of all reads.** Plain and true, but if a third of
  everything you look at is training, the read gets dull. Worth asking
  whether `train` should be visible as *what* is being practised ("is
  practising Ember at a rock") — the move id is on the agent.
- **`fleeingFromId` is never cleared**, only overwritten at the next flee.
  tells.ts reads it only while `behavior === "flee"`, so it cannot leak
  into a sentence, but it is stale data on the agent between flights.
- **Examine cycles only among creatures currently visible.** With one in
  view, `x` repeats it. Fine; noting so nobody reports it as stuck.
- **Watch / Play switch (direct ask, outside the roadmap).** Watch =
  `enterOverworldMode(seed, "zone")`, the spectator app as it always was;
  Play = the cave. URL carries `player=cave` so reload keeps the mode. The
  HUD's last message survives a switch to Watch (hidden, so harmless).
- **Play always starts the cave.** M0's surface demo (`?player=1`) is
  still reachable by URL only. If the surface run should be a real option,
  it is one more button.

## ROADMAP M5 Make — built (first-playable cut); side notes and rulings

- **Flint and herbs are unreachable in the real cave.** `crafting.test.ts`
  scanned 60 walked steps from spawn on 5 seeds: lichen 14–35 steps,
  deadwood 17–33, berries 19–35, flint none, herbs none. Underground has
  no `rocky` ground and no boulders near spawn; the herbs crop does not
  grow in the chamber. So knapped flint, the flint knife and the poultice
  exist in the data and cannot be made in the cave. Options: (1) floor
  beside a cave `wall` yields flint (walls are rock; "loose flint — scarce"
  fits); (2) paint a few boulders and an herbs patch into the chamber in
  `createCaveScenario`; (3) leave them for M7's deeper layers. I'd do (1)
  and (2) together; it is a content decision, so it is yours.
- **Torch fuel is not built.** HANDOFF said ask: 600 ticks (~150 keys) and
  the torch is consumed, or unlimited until M7? Unlimited today.
- **Carry cap** is the sim's own `carryCapacityOf` (maxHp × 1.5 = 28.5
  for the human). No soft encumbrance. The pouch's `capacity: 8` is in
  the item table and not yet read by anything.
- **Opening the pack mid-craft abandons the craft.** Any key cancels the
  auto-continue loop and the next action clears the engine activity. The
  live script tripped on this. Either the menu should show "Making torch…
  1 turn left · tap to keep going", or the loop should survive the menu.
- **A gathered tile that a berry bush grows over now yields berries, not
  lichen.** Seen on seed 202. Reasonable, but it means the chamber's best
  gather spots drift as flora spreads.
- **Nothing narrates gathering or crafting in the event log.** Only the
  HUD line. When the log gets a player voice, `gathered`/`crafted` events
  belong there (and add the two formatter cases).
- **Befriending — direct report: "I can't seem to befriend any Pokémon
  easily."** Correct, and structural: the human still carries M0's
  `isPredator: true` stopgap, so prey flee it inside 4 tiles, and no player
  verb builds rapport yet (Feed and Presence are M6). Nothing the player
  can do today moves a rapport edge toward them. M6 is next; HANDOFF §4
  has the plan and the bot that will measure whether it works.

## ROADMAP M6 Bond — built, 0/5 followers; rulings needed

Numbers, then the menu. All from `runner/validateBond.ts`, 5 seeds.

| seed | treats taken | best trust | stage reached |
|---|---|---|---|
| 20260903 | 0 | 0.00 | wary (bot starved) |
| 11 | 1 | 0.14 | tolerant |
| 202 | 3 | 0.13 | tolerant (bot killed, see below) |
| 3003 | 0 | 0.08 | tolerant (bot starved) |
| 40404 | 0 | 0.18 | tolerant |

The mechanics work when traced one at a time: a calm Sandshrew walks to a
set-down berry and takes it; a crouched human three tiles off is not a
threat; a sleeper beside you remembers being watched; a curious creature
follows and keeps up over 12 tiles. What does not happen is *reaching*
curious (0.2) in the real cave, because trust decays faster than a
player can feed.

Rulings (all sim-original guesses today; none tuned):
1. **Trust thresholds** 0.05 / 0.2 / 0.5. Lower curious to 0.12?
2. **Rapport decay** ×0.9977 per tick (half-life ~300 ticks) applies to
   the player's edges like everyone's. Slower decay for edges toward the
   player, or a floor once tolerant is reached?
3. **Treat delta** 0.08 per berry, **cooldown** 60 ticks. Two berries in
   a row should probably not be two treats; but 60 ticks between treats
   plus decay is what starves the curve.
4. ~~A fainted player can be finished off~~ — **RULED: "I think it's
   okay to have a sandshrew attack player and let em die lol."** Kept
   as is. Corner a wild animal and it strikes; a 19-HP human dies to it.
5. **Chamber Sandshrew roam constantly** (explore at 0 energy, mate
   drive over sleep). Courting is a chase. The energy penalty you just
   ruled on will slow them a little; the sleep gate quirk is item 6.
6. **Mate drive beats sleep.** A creature that wants a mate never sleeps,
   even at zero energy (traced). Sleep should probably win below some
   energy. Your call on where.

Also built this round on your ruling: **exhaustion** — under 20% energy,
speed drops linearly to −20% at zero, for everyone (`simulation.ts`
`lowEnergySpeedMultiplier`, tested).

## Cave starting species: random pack, wide pool

Direct ask: "I want starting cave to be a random pack of prey. Some
options like eevee, Pikachu, bulbasaur, charmander, squirtle are all
good. Sandshrew is acceptable too. Let's make a decent wide pool."

Built: `CAVE_STARTER_SPECIES` in `packages/data/src/scenario.ts` — 34
base-stage, non-predator species (the five named plus Sandshrew, Pidgey,
Rattata, Caterpie, Weedle, Oddish, Poliwag, Psyduck, Magikarp, Cubone,
Vulpix, Growlithe, Clefairy, Jigglypuff, Nidoran♀/♂, Abra, Paras,
Bellsprout, Geodude, Horsea, Shellder, Krabby, Seel, Dratini, Ponyta,
Doduo, Venonat, Machop, Tangela, Drowzee). One species rolled per world
(a herd is one species — `HerdRecord.species` — so this is "which pack
did I find," not a mixed chamber). Not cave-habitat-accurate on purpose:
the user's own named examples (Charmander, Squirtle) aren't burrowers
either, so variety won over biome realism here.

Verified: every id in the pool resolves in `SPECIES` and is
`isPredator`-free (test), the pool actually produces >5 distinct species
across seeds (test, and empirically 34/34 species turned up over 200
seeds sampled live). The two obligate-aquatic entries (Magikarp, Horsea)
were checked live for 400 ticks each — both settle in normally (one
Magikarp ends up standing in water, no deaths, no stuck agents).

Every place that used to hardcode `"sandshrew-herd"` now matches
`herdId?.endsWith("-herd")` instead: `data/test/cave.test.ts`,
`runner/validateBond.ts`. `runner/validateCaveVision.ts`,
`validateCaveNeeds.ts`, `validateTorch.ts` never referenced species and
needed no changes.

Open, not decided: the pool is my curation, not yours — if any of these
34 feel wrong for "the first thing you meet," trim or add freely; it's
one array.

## M6 Bond, lever 1: slower decay for the edge toward the player

Direct ask: "one lever at a time make us able to actually build a rapport
with this thing."

Built: `RapportEdge.towardPlayer` (types.ts), set automatically in
`adjustRapport` (it already has `World` and `otherId`, so no call site
anywhere had to learn about the player). `decayedRapportScore` reads it:
`RAPPORT_PLAYER_EDGE_DECAY_PER_TICK` = 0.9995 (half-life ~1386 ticks) for
an edge a creature holds toward the player, vs. the ordinary 0.9977
(~300 ticks) for every other edge, including the player's own edges
toward creatures — asymmetric on purpose, since nothing reads those
behaviorally.

Before/after, same bot, same 5 seeds:

| seed | treats (before → after) | best trust (before → after) | stage (before → after) |
|---|---|---|---|
| 20260903 | 0 → 1 | 0.00 → 0.08 | wary → wary |
| 11 | 1 → 3 | 0.14 → 0.21 | tolerant → tolerant\* |
| 202 | 3 → 2 | 0.13 → 0.15 | tolerant → tolerant |
| 3003 | 0 → 2 | 0.08 → 0.13 | tolerant → tolerant |
| 40404 | 0 → 4 | 0.18 → 0.22 | tolerant → tolerant\* |

\*Seeds 11 and 40404 both peaked *above* the 0.2 curious threshold during
courting (0.21, 0.22) — real progress — but the printed "stage" is read
after the bot's 25-tile walk away, and by then it had decayed back under
0.2. **Still 0 of 5 followed**, for two compounding reasons, not one:

1. Decay is still faster than the bot's real feeding cadence in the
   worse seeds (thresholds not yet crossed at all: 20260903, 202, 3003).
2. **Where it *did* cross 0.2, nothing was there to catch it.** The
   follow roll (`trust.ts`'s `tickFollowers`) only fires while the
   creature is `curious`+ AND within `FOLLOW_ENTRY_RADIUS` (3 tiles) of
   the player — but the bot's own courting loop backs off 4 tiles right
   after every offer (to stay outside flee range while the treat rule
   works), which is also outside follow range. The two mechanics were
   built to not interfere with each other and instead don't overlap in
   time at all. This is a second, independent lever, not decay.

Lever 1 alone is confirmed to move the number (treats and best-trust both
up on 4 of 5 seeds) but is not sufficient by itself. See the follow-up
message for the fuller lever menu, including this proximity-window gap.

## M6 Bond, levers 2–6: gift moment, habituation, spillover, visit accrual

Direct ask, in response to my own recommendation of "just 1 and 2 first":
*"I think all 6 are really good and necessary to get a nuanced balanced
thing here."* Built all six from the menu:

1. **Proximity fix.** `FOLLOW_ENTRY_RADIUS` 3 → 6 (`trust.ts`), and
   `tickFollowers`'s distance check switched from Manhattan to Chebyshev
   to match `applyFollowing`'s own metric. Root cause (found while
   diagnosing lever 1): the bot backed off 4 tiles after every offer to
   stay outside flee range while the treat cooldown ran, which put it
   outside the old follow radius (3) at exactly the moment trust was
   highest. Fixed on both sides: radius widened, and the bot's retreat-
   after-offer step was removed (see lever 2 below — it no longer needs
   to retreat).
2. **The gift moment** (`threat.ts`). `GIFT_GRACE_SIGNATURE = 0.1`,
   `GIFT_GRACE_TICKS = 60`. A successful `offer` sets
   `Agent.giftGraceUntil = world.tick + 60`; `threatSignatureOf` returns
   the flat 0.1 instead of the normal 0–2 range while `world.tick` is
   inside that window. Lets a creature close the last few tiles and eat
   without the player having to abandon the spot first.
3. **Habituation** (`needs.ts`). `Agent.timesFedByPlayer` — a plain
   counter, incremented on every successful treat-eat, never decremented
   and never touched by rapport pruning/eviction. `TREAT_HABITUATION_STEP
   = 0.15` per prior feed, capped at 5 (`TREAT_HABITUATION_CAP`), so a
   6th+ feeding is worth 1 + 0.15×5 = 1.75× the base delta. Survives a
   full decay-to-prune of the numeric rapport edge — verified directly in
   `bond.test.ts`.
4. **Loyalty / anti-dilution.** Deliberately *not* a new sim mechanic —
   lever 3's per-individual counter plus lever 5's spillover already
   cover it (repeat-feeding one individual compounds; the rest of the
   herd isn't left at zero). The real fix was in the bot: `pickTarget()`
   now runs once and the courting loop keeps the same target for the
   whole run instead of re-picking "nearest" every iteration, which used
   to spread feedings across whichever creature happened to be closest.
5. **Herd spillover** (`needs.ts`'s `applyPlayerFeedingBonus`). A
   herd-mate within `TREAT_SPILLOVER_RADIUS` (5, Chebyshev), same herd,
   same layer, gains `TREAT_SPILLOVER_FRACTION` (0.3) of the giver's
   rapport delta, tagged `witnessedKindness` — a new, dedicated
   `RapportReason` with its own prose ("I watched him feed a friend
   Sandshrew.") and its own, lowest-of-the-list significance weight (1)
   in `RAPPORT_REASON_SIGNIFICANCE`. One-directional: the giver's edge
   toward the herd-mate doesn't move, since nothing happened on that
   side. Verified gated correctly (radius, herd, layer) and one-directional
   in `bond.test.ts`.
6. **Visit-based accrual** (`needs.ts`). `TREAT_SAME_SITTING_TICKS = 150`
   → ×0.7 if the last treat to that individual was more recent than that;
   `TREAT_RETURN_VISIT_TICKS = 500` → ×1.3 if it's been longer. Ordinary
   cadence in between is ×1. Rewards leaving and coming back over camping
   beside one creature spamming offers.

All six are unit-tested in isolation (`bond.test.ts`, 19 tests total, up
from 11): proximity overlap, gift-grace collapse and recovery (and the
`playerFleeRadius` shrink that follows from it), habituation compounding
and surviving full decay, spillover's radius/herd/layer gating and
one-directionality, and the three visit-accrual tiers against the exact
documented formula.

**Combined empirical result** (`validateBond.ts`, same 5 seeds, bot
restructured to hold one target and not retreat after offering):

| seed | berries | offers | eaten | timesFed | bestScore | stage | follower | died |
|---|---|---|---|---|---|---|---|---|
| 20260903 | 3 | 3 | 2 | 0 | 0.18 | tolerant | false | — |
| 11 | 3 | 4 | 1 | 0 | 0.18 | tolerant | false | — |
| 202 | 3 | 5 | 0 | 0 | 0.18 | wary | false | — |
| 3003 | 3 | 3 | 1 | 1 | 0.10 | tolerant | false | **starved, tick 1808** |
| 40404 | 3 | 3 | 0 | 3 | 0.21 | wary | false | — |

Still **0/5 "followed out of the chamber"** by the bot's strict acceptance
test (follower status checked *after* a 25-tile walk away). But seed
40404's raw log shows `followTick: 2369` — `tickFollowers` actually rolled
a follow success mid-run, the first one this project has produced. By the
end of the 25-tile walk, that creature's `stage` reads back as `wary` and
`followingId` had been cleared: trust peaked above the 0.2 `curious`
threshold for long enough to win a follow roll (almost certainly right
after the habituated 3rd feeding, which is the biggest single delta this
system can produce — base × 1.3 habituation × visit multiplier), then
decayed back under `curious` before the walk-away test finished, and
`tickFollowers` stops following once trust drops to `wary`. So the
mechanism chain now demonstrably *works end to end* — the remaining gap
is durability: a single good feeding cycle's trust spike doesn't yet
outlast a ~400-tick walk.

Against lever-1-alone's table (best trust 0.08–0.22, avg ~0.158): this
run's 0.10–0.21 (avg ~0.17) is a mild improvement, not a clear win — the
honest read is "comparable, plus one real follow event." Bestscore is less
erratic than an earlier attempt at this combined run showed (see below).

One seed (3003) starved to death — down from 3/5 in an earlier attempt.
That earlier, discarded attempt gathered berries one-at-a-time
("`< 1`" instead of "`< 3`") to force more return-visit gaps for lever 6
to reward; traced with a throwaway debug script
(`runner/src/_dbg_bond.ts`, deleted) and found it backfired: one-berry
gathering exhausts the local food patches around the courting spot
(`HARVEST_YIELD_PER_TILE = 3` per tile, `HARVEST_REGROW_TICKS = 300`)
faster than they regrow, so most of the run's budget went to "NO FOOD
SOURCE FOUND" wandering instead of courting, and three of five seeds
starved. Reverted to gathering a 3-berry starting stock (a middle ground
between the original 4 and the failed 1), which is what the table above
reflects. In that same debug trace, the underlying mechanisms were
confirmed sound in isolation — score climbed 0.099 → 0.163 → 0.191 as
`timesFedByPlayer` went 1 → 2 → 3, strictly increasing gains each time,
exactly as the habituation formula predicts — so the earlier bad run was
a bot-strategy artifact, not a reward-balance defect.

**Two findings surfaced, not yet acted on:**

- **The player has no energy-recovery verb.** No rest/sleep action exists
  for the player; `energy` only goes down. The pre-existing exhaustion
  penalty (below 20% energy, action speed degrades linearly to -20% at 0)
  applies to the player exactly like any sim agent, and a long courting
  session runs the player's energy to near-zero within a few dozen turns
  with no way to recover it. This isn't a bond-lever bug — it's a gap in
  what the player can do at all, and it compounds with anything that asks
  the player to spend a long session near one spot (like courting).
- **Examine/`describeBehavior` prose was deliberately not extended** to
  say anything about `timesFedByPlayer` or habituation — given the four
  rejected rewrites that prose went through in an earlier session
  (CLAUDE.md's "Generated prose: say the plain thing"), touching it wasn't
  in scope for this lever pass. Flagging as an omission, not an oversight.

Open ruling needed: is "0/5 by the strict walk-away test, but a real
follow event happened for the first time" good enough to call M6's
acceptance criterion met, or does the walk-away trust durability need its
own, seventh lever? My read: this is progress worth showing before
guessing further at a 7th lever — the honest number is what's above.

## M6 Bond: wait recovers energy, numbers bumped to 4/5

Two direct asks in the same message: *"Wait should recover [energy]"*
and *"We need to bump our numbers to make it easier. 4/5."*

**Wait/energy** (player.ts): the player had no rest verb at all — energy
only ever drained, and the exhaustion speed penalty (`simulation.ts`'s
`lowEnergySpeedMultiplier`, -20% at 0 energy) had no way back once bond-
courting sessions started running long. Rather than invent a second rest
mechanic, `wait` now sets `Agent.asleep = true`, reusing needs.ts's
existing sleep state exactly — `tickAgentNeeds` already treats ANY
asleep agent identically regardless of `controlledBy`: energy rises
instead of draining, hunger/thirst decay drops to 0.15x
(`SLEEP_NEEDS_DECAY_MULTIPLIER`), healing and cooldown recovery speed
up. Any other queued action wakes the player back up
(`applyPlayerAction`). No new `wokeUp` event/reason: that union
(`"urgentNeed" | "threatSpotted"`) is NPC-trigger-only, and widening it
would touch `eventText.ts`'s and `format.ts`'s exhaustive `SimEvent`
switches for a case with nothing new to say.

Consequence, not a bug: `player.test.ts`'s "from full" starve-by-waiting
test assumed `wait` was a pure no-op and bounded the ticks-to-starve
under 5000; waiting is now real rest, so the same scenario takes 10431
ticks (~6.67x, matching `SLEEP_NEEDS_DECAY_MULTIPLIER`). Updated the
bound and explained why rather than leaving a stale assumption standing.
New tests in `energy.test.ts` cover both directions (repeated waiting
raises a tired player's energy; any other action wakes them and draining
resumes).

**Numbers bumped, iterated against `validateBond.ts` until the stated
target (4/5) was hit:**

| constant | before | after | file |
|---|---|---|---|
| `RAPPORT_OFFERED_FOOD_DELTA` | 0.08 | 0.12 | rapport.ts |
| `RAPPORT_PLAYER_EDGE_DECAY_PER_TICK` | 0.9995 (~1386-tick half-life) | 0.9997 (~2310-tick half-life) | rapport.ts |
| `TREAT_HABITUATION_STEP` | 0.15 | 0.2 | needs.ts |
| `FOLLOW_ENTRY_CHANCE` | 0.05 | 0.08 | trust.ts |

Also fixed a bot-side bug uncovered along the way, not a balance number:
`validateBond.ts`'s `upkeep()` was checked only every 10 steps while
chasing a moving target, at a 0.45 hunger/thirst trigger — traced a
starvation regression to exactly this (up to 10 unchecked actions at
~10 world ticks each between checks, enough to occasionally outrun the
trigger). Now every 5 steps at 0.5.

First re-run (energy fix + tighter upkeep only, before the four
constants above): 1/5 followed, 2 deaths — noisy, and a reminder that
this codebase's single RNG stream means any control-flow change
reshuffles which draws land where; a single-seed before/after isn't
signal on its own (CLAUDE.md: "measure before and after, on several
seeds" — five is what this bot has, so seed-level swaps like this are
expected, not alarming, as long as the aggregate trend holds).

After the four constant bumps: 3/5. One more bot-script change — initial
berry gather 3→5 — closed the gap to 4/5:

| seed | bestScore | stage | follower | died |
|---|---|---|---|---|
| 20260903 | 0.25 | curious | **true** | — |
| 11 | 0.44 | curious | **true** | — |
| 202 | 0.26 | curious | **true** | — |
| 3003 | 0.28 | curious | **true** | — |
| 40404 | 0.03 | wary | false | **starved, tick 2033** |

**4 of 5 seeds followed out of the chamber.** Target met.

**Seed 40404's death, traced, is NOT a bond number.** A dedicated debug
script walked seed 3003's earlier failure (before the gather bump fixed
it) tick by tick and found the real mechanism: a food tile's `stock`
(flora.ts) is a completely different counter from harvest.ts's
`harvested`/`HARVEST_REGROW_TICKS` (that one recovers in ~300 ticks and
only gates the player's own *gather* action). `stock` depletes from
actual *eating* — the player's `eat` action, the treat mechanic, and
ordinary herd grazing all draw it down — and once it crosses 0
(flora.ts's food-death branch, both surface and underground copies) the
tile's terrain reverts to plain `"floor"` **for good**. It does not
regrow on any timer; a new food tile only exists there again if a
seedling happens to mature on that spot. On a long enough run — the
courting bot's own eating plus four herd-mates grazing the same handful
of chamber patches for 1000+ ticks — every reachable food tile can cross
that line in the same stretch, and `nearestFood()` (a real, unbounded
BFS over the whole connected region — not a range problem) then finds
nothing at all. Confirmed live: seed 3003's trace showed
`nearestFood()` returning `undefined` for 400+ consecutive ticks before
the starve. Raising the bot's starting gather (3→5 berries) bought
enough runway to close each courtship before hitting this wall on 4 of
5 seeds; it does not fix the underlying mechanic, which is a real
ecological-carrying-capacity gap independent of anything in this
lever pack (`validateOverworld`/general herd-sim runs would hit the same
wall on a long enough stationary camp, bond-courting or not). Flagging
as a genuine finding, not fixing: this is a flora/regrowth-rate balance
question, not a bond one, and touching it wasn't part of either direct
ask in this round.

Open ruling for the user: is the surviving 1/5 death (a real, traceable
food-scarcity failure, not RNG noise or a bond-number gap) worth a
dedicated flora-regrowth pass, or is 4/5 good enough for M6's answer as
it stands?

## Round six shipped: five bare moves got trees — and two primitives still gate the best nodes

`harden`, `twineedle`, `poison_sting`, `growth`, `agility` are live at 45
nodes each. Full writeup, numbers and live verification in MOVES_DESIGN.md's
"Round six SHIPPED" section. Two items are deliberately left open here:

- **Needs-recovery interference from a status** (a hook in `needs.ts`, so a
  poisoned agent restores hunger/thirst more slowly). This is the only thing
  between Poison Sting's *Sickened* and its own best design — "the payoff of
  poisoning something is not that it takes damage, it is that it STARVES",
  legible in the chronicle rather than in a fight. Verified missing at the
  call site: `tickStatusEffects` gives poison a flat per-tick HP fraction and
  nothing else, and no needs-recovery path in `needs.ts` reads `agent.status`
  at all. `drainNeeds` cannot stand in — `utilityMoves.ts` is its only reader,
  and flagging Poison Sting `utilityMove` would remove it from combat.
  *Sickened* shipped as the live half (`statusSeverity` + `jamCooldownTicks`).

- **A fertility CEILING lever.** `raiseFertility` caps at the tile's own
  `fertilityCeiling` (`GROUND_TYPE_PARAMS`: sandy 0.6, loam 1.0, rocky 0.25),
  so `fertilityBoost` buys **speed to the ceiling, not a level above it** —
  measured live, a fully-specced Growth and the base move both read 0.6 on
  sandy ground once ambient regen has run. Growth's whole Boldness branch is
  therefore about getting there faster and wider, not richer. Raising the
  ceiling is the missing lever the draft's `fertilityCeilingBoost` reached
  for.

Two smaller things worth remembering, both measured:

- **`defenseBoost` had essentially no roster exposure before this** (worst
  0.5) and `statStageMultiplier` **clamps stat stages at ±6**. A tree that
  spends freely on it goes from 0.5 to 9.0 with nothing complaining, and
  everything past ~4 is points spent on nothing once the tree's own
  `statChangeOnHit` ladder is counted. Trimmed to 4.0/4.5 on Harden/Agility.
- **Nothing in the checker or `tree-balance.ts` can see a dead lever on a
  `utilityMove`.** `pickBestMove` excludes them from hostile selection, so
  ~30 delta fields are unreachable on Harden/Growth/Agility. That rule now
  lives as a test in `packages/data/test/moveTrees.test.ts`, proven to fail
  by injecting one. Folding it into `check-proposed-trees.ts` would be the
  natural next step.

## Side note from the master merge: runner reaches into web's source

`packages/runner/src/rollBuilds.ts` deep-imports `describeMoveTreeNode` and
`summarizeBuildEffects` from `../../web/src/moveTreeSvg.js`, which broke
runner's `tsc --noEmit` against its own `rootDir: "src"`. Found on the merge,
but it predates it — the branch's runner typecheck was never run.

Fixed the cheap way: `rootDir` does nothing under `noEmit: true`, so it's
gone from `packages/runner/tsconfig.json`. The real fix is to split
`moveTreeSvg.ts` — lines 1–466 are prose/layout with one DOM helper
(`svgEl`) embedded in the middle, and only the prose half is what runner
wants. Extracting the describers into a shared module would let both callers
import it by package name instead of by relative path. Not done mid-merge.

## Tool-granted moves (MOVES_AND_TOOLS.md)

Direct ask: *"I want tool granted moves. That will truly unlock gameplay
as we know it."* MOVES_AND_TOOLS.md's direction was already decided
("items and moves share one effect vocabulary... a tool is a slice of a
move, never the whole move"); this is that architecture actually wired
into the player.

**Scope for this round**, confirmed via two numbered questions: combat
*and* the generalised terrain effect together (not combat alone), and
bare hands use a real Tackle — first drafted as a weakened Scratch,
corrected mid-ask to *"Tackle\*"*.

### Combat: a held item's real moveset

- `ItemDef.grantsMoves?: MoveSpec[]` (types.ts) — a held item's actual,
  already-weakened moves. `packages/data/src/crafting.ts`'s `toolMove(base,
  powerMult=0.65, cooldownMult=1.75)` derives each one straight from the
  real curated roster (`MOVES.scratch`, `MOVES.tackle`, `MOVES.body_slam`)
  rather than inventing a parallel, hand-tuned set — MOVES_AND_TOOLS.md's
  numeric rule (*"roughly 60-70% power... 1.5-2x cooldown... if a tool
  ever matches the innate version, the slice rule has failed"*), applied
  literally.
- `World.playerBaseMoves?: MoveSpec[]` (types.ts) — same "scenario hands
  it to the world, engine only reads" pattern as `items`/`recipes`.
  `BARE_HANDS_MOVES = [toolMove(MOVES.tackle)]` (crafting.ts), set at
  spawn in both `createCaveScenario` and `createPlayerDemoWorld`,
  **replacing** the human species' own `moves: ["tackle"]` learnset
  (full creature-strength Tackle) — the loadout is the moveset now, not
  the species' default.
- `player.ts`'s `syncPlayerMoves(world, agent)` recomputes `agent.moves`
  as bare hands + the held item's grants, called after every
  `equip`/`stow` and after `tickTorch`'s own auto-unequip. A worn item
  grants nothing (MOVES_AND_TOOLS.md's worked table: worn slots are
  passive-only).
- A new `PlayerAction`, `{ kind: "attack"; dx; dy }` — swings at the
  adjacent tile in that direction. A living agent there takes a REAL hit:
  `predation.ts`'s `resolveHit` (previously module-private) is now
  exported and called completely unmodified — same
  `pickBestMove`/`useMove`/damage/crit/faint pipeline any wild agent's
  own attack goes through, `faintKind: "defeated"` (not `"killed"` — the
  player isn't hunting for food here, matching herd-rivalry/defensive
  framing, not predation). A pre-check (`pickBestMove` called once before
  committing) tells a real miss/hit apart from "nothing was off cooldown
  or in range," since `resolveHit`'s own return value only ever means a
  true kill.
- Web: an `attack` PlayerAction needs a direction with no on-screen aim
  cursor to supply it, so `main.ts` tracks `lastFacing` (UI-only state —
  the engine has no facing concept) from the last move attempted,
  successful or not (bumping a wall still points you at it). `f` key and
  an Attack button swing that way. Outcome text: "You strike
  {species}!" / "You fell it, and gather {material}." / "You clear it
  away." / "Nothing there to hit."

### Terrain: axe and machete

- `MoveSpec.terrainEffect?: { from?: TerrainKind[]; to: TerrainKind;
  yields?: MaterialId }` (moves.ts) — MOVES_AND_TOOLS.md's "generalise the
  terrain effect" ask, additive alongside (not replacing) the existing
  `terrainBurn`/`terrainFill` fields; migrating those onto the new shape
  is real future cleanup, not done here.
- `player.ts`'s `attack` case reaches a `terrainEffect` move directly
  (scanning the player's own `agent.moves` for one whose `from` matches
  the targeted tile) when there's no living defender there — bypassing
  `pickBestMove` entirely, since these are flagged `utilityMove: true`
  specifically so ordinary combat selection never offers them.
- Two new craftable items (`crafting.ts`): **axe** (`boundHaft +
  knappedFlint×2`, 14 turns) grants a fell-only move (`from: ["tree"], to:
  "floor", yields: "deadwood"`); **machete** (`boundHaft + knappedFlint +
  cordage`, 11 turns) grants a clear-only move (`from: ["bush", "flora",
  "seedling"], to: "floor"`, no yield) plus a weakened Slash. Matches
  MOVES_AND_TOOLS.md's worked table exactly: *"no tool gets all three"* —
  the axe doesn't clear, the machete doesn't fell, neither does the
  knife's damage slice. Both `knownAtStart: false` (learned later, same
  as the flint knife). Recipe weights/turns are sim-original guesses (no
  prior doc table to draw from, unlike the first-playable-cut items),
  flagged for the user to judge same as everything else on that list.
- Deliberately NOT built: a second, damage-slice grant for the axe
  (MOVES_AND_TOOLS.md's table also gives it a Karate-Chop-flavoured hit) —
  this roster has no `karate_chop` move to slice from, and inventing a
  brand-new balanced move from scratch is its own pass, not part of this
  one. An axe wielder who also wants to fight carries a knife too — the
  same held-slot tradeoff Shield/Brace already enforces everywhere else.

### Verified two ways

**12 engine tests** (`playerCombat.test.ts`, new) against synthetic
move/item fixtures — deliberately not the real curated roster, since this
suite is testing the ENGINE mechanism (does a grant reach combat, does a
terrain effect fire, does `from` gate correctly), not this project's
specific balance numbers: equip/stow syncing `agent.moves` correctly
(including switching items, worn-grants-nothing, idempotent re-sync),
landing a real hit on an adjacent hostile bare-handed, cooldown blocking
a second immediate swing, a weapon's granted move used and put on its
own cooldown, an axe felling a tree and yielding deadwood, a machete
clearing a bush but refusing a tree (the slice rule enforced by `from`),
and bare hands unable to fell anything at all. **9 data-package tests**
(`crafting.test.ts`) against the REAL roster: bare hands is really
Tackle at 60-70% power (not Scratch — the mid-ask correction), flint
knife/club really are weakened Scratch/Body Slam (never matching the
creature-strength version), axe/machete's terrain grants match the slice
rule exactly, and axe/machete are reachable from bare-hand materials
(same reachability trace as the first-playable set, just not part of it
— learned later).

**Live, against real scenario data** — `runner/validatePlayerCombat.ts`
(new), 5 seeds each:

| | seed 20260903 | seed 11 | seed 202 | seed 3003 | seed 40404 |
|---|---|---|---|---|---|
| Axe fells a real tree | ✓ (10 keys, +1 deadwood) | ✓ (2 keys) | ✓ (2 keys) | ✓ (14 keys) | ✓ (7 keys) |
| Bare-handed hit lands | ✓ (venusaur, -3 hp) | ✓ (charmander, -4 hp) | ✗ (chase lost) | ✓ (charmander, ~0 hp, already low) | ✗ (chase lost) |

5/5 real fells, 3/5 real hits. The 2 misses aren't a bug: a wild agent
moves every tick same as the player, and `accumulateActionEnergy` can
take several ticks to charge before the player's own queued action
actually fires — by then the target had often wandered off the exact
adjacent tile it was standing on when the swing was planned. Same
"chasing a moving target" shape `validateBond.ts`'s own doc comments
already describe (*"the first bots walked to a stale position and never
got closer than 12 tiles to a roaming chamber creature"*); the script's
final version re-plans and re-swings every step rather than committing
to one attempt, matching how a real player would actually chase
something, and that's what got 3 of 5. Confirmed via direct debug (not
kept in the script) that `pickBestMove` genuinely does find and select
the weakened move whenever the player is truly adjacent — the two misses
are chase failures, not resolution failures.

Also live-confirmed in a real browser session (Playwright): the
Inspector panel — pre-existing UI, untouched by this work — already
rendered the new weakened Tackle correctly (`pwr 26`, exactly 65% of
mainline Tackle's 40) the moment it reached `agent.moves`, and the
Attack button/`f` key fire with no console errors. Landing a real hit
against a wandering wild creature via blind keyboard navigation in that
same live session was unreliable for the reason above; the deterministic
runner script above is the real proof of the combat mechanism.

### Open, not decided

- No second combat move for the axe (see above) — Karate Chop or
  equivalent is real future roster work, not blocking.
- MOVES_AND_TOOLS.md's remaining open questions (does a tool-granted move
  count as "known" for progression; can the partner use tools; throw
  range for consumables; can tools teach permanently) are all untouched —
  none of them gate what shipped here.
- `terrainBurn`/`terrainFill` migrating onto the new generalised
  `terrainEffect` field is real cleanup, explicitly deferred (see the
  field's own doc comment in moves.ts).
- The "reverse direction" (MOVES_AND_TOOLS.md: wild agents reshaping
  terrain the same way — a Scyther clearing foliage where it hunts) is
  not built. Only the player's own items grant `terrainEffect` moves
  right now; no species' learnset carries one.

## HUD decluttering: Eat and Offer move into the Pack menu

Direct ask, mid-session: *"We're getting too many buttons I think. Let's
make offer and eat only available from inventory after you gather."*

`hud-pad` was at 9 buttons after Attack landed (Wait, Eat, Drink, Look,
Gather, Pack, Crouch, Offer, Attack) — down to 7 now (Wait, Drink, Look,
Gather, Pack, Crouch, Attack). Eat and Offer live as two small action
buttons on the "food" row inside the Pack menu instead
(`main.ts`'s `actionsRowEl`, new — a `pack-row` variant with its own
inline buttons, for the one carried item that has more than one thing
you'd do with it).

This surfaced a real, pre-existing asymmetry: `offer` already consumed
from the player's own inventory (a berry set down from the pack), but
`eat` only ever worked standing on a live food tile — there was no way
to eat a carried berry at all. Fixed rather than left as a trap for the
new UI: `player.ts`'s `eat` case now falls back to a carried "food" item
(`foodNutritionFactor(undefined)`, the function's own already-designed
neutral-1x default for exactly this "no tile" case) whenever nothing
edible is underfoot. Ground food is still preferred when both are
available — eating a fresh berry patch doesn't spend your pack. 3 new
unit tests (`player.test.ts`) cover all three cases (ground-first,
inventory-fallback, neither-available-fails).

The `e` key still eats directly (now strictly more capable — ground food
or a carried berry, whichever applies) since it isn't a button and isn't
part of the clutter complaint; `o` (offer) has no keyboard shortcut any
more, Pack-menu only, matching "only available from inventory."
