# The human pass — sequencing, architecture and risk

Companion to `HUMANS_DESIGN.md`, which settles *what* humans are. This one is
about *how the pass gets built*, in what order, and what will bite. Direct
ask: *"No I think Towns and stuff are important. Let's talk through the human
pass."* Towns are in scope; the no-towns v0 in `MODES_DESIGN.md` is dead.

## First: "the human pass" is two passes, and they should be named apart

They sit in adjacent sections of `HUMANS_DESIGN.md` and read as one job. They
are not.

| | **history pass** | **live behavior loop** |
|---|---|---|
| when | once, at worldgen | every tick, forever |
| scale | macro — zone grid | micro — per agent |
| cost model | compact per-settlement records, same cheap-dense-facts model that does a million-zone macro grid in 2.5s | a behavior tree per villager per tick |
| output | founding sites, expansion, roads, ruins, era events | farming, building, gathering, trade |
| risk | getting the tuning right | **getting the agent count right** |

They are separable, and the history pass is the one that actually delivers
what the ask wants: **towns and roads on the map, with a reason for being
where they are.** A world with generated settlement history, roads that
accrete from real traffic, and ruins with recorded causes is already a much
better world — before a single villager does anything clever.

That is not an argument for skipping the live loop. It is an argument for
ordering, and for not blocking towns on a settlement economy.

## The decision everything else hangs off: how many humans are real agents?

The original doc's fork was *simulated vs authored*. This pass has its own
fork, and it is a performance fork, not a taste one.

A current world runs on the order of **25 living agents**. A populated world
of 20 settlements at 50 people each is **1000 agents**, each running a
behavior tree every tick — a ~40x increase in the most expensive thing the
sim does. That does not hold, and discovering it after building the behavior
loop is the expensive way to find out.

**Recommendation: a settlement is ONE entity carrying a population count,
plus 3-8 individuated real agents.** Everything else — births, deaths, food
stores, labour, growth — is arithmetic on the settlement record, the same way
the macro grid holds compact facts rather than simulating them.

This is `HUMANS_DESIGN.md`'s own notables-vs-anonymous-population split, but
made load-bearing rather than descriptive. It is what makes 20 towns
affordable at all, and it costs nothing narratively: the individuated few are
exactly the elder, the builder, the guard — the people a story would name
anyway. An anonymous villager who becomes interesting can be *promoted* to a
real agent, which is a cheap and very natural mechanism.

## The blocker: villagers cannot win a fight, and you have already hit this

This connects directly to the combat finding measured earlier today, and it
is the thing most likely to make the whole pass read badly.

`species.ts` already records this exact problem happening to the **player**:

> *"human stats are bit too low. like i'm getting outsped and one shot by too
> many pokemon. can you make it so the stats reasonably scale."*

That was fixed by raising humans to BST 280 — `hp70 / atk28 / def50 / spA25 /
spD50 / spe90`. Note what that block actually bought: **defense and speed, not
offense.** A human has attack 28, spAttack 25, and exactly **one move:
`tackle`**.

So a villager today is moderately tanky and genuinely fast, and **cannot kill
anything**. A villager can never drive off a predator on its own.

Now combine that with this session's measurement on the current sim:

- predation kills a **full-HP** target outright **51.8%** of the time
- the mean attacker-minus-defender level gap on those one-shots is **14.3**

Drop a diurnal, offensively-helpless population next to a predator herd and a
town is not a settlement, it is a buffet — at night, when they are asleep,
with the same lethality curve that already one-shots healthy Pokémon.

**Therefore: walls, watchfires and coordinated mob-defense are not flavor and
not a polish phase. They are the mechanism by which a town exists at all**,
and they have to ship in the same phase as the towns. `HUMANS_DESIGN.md`
already names the three multipliers (numbers with coordination, tools, fire
and walls) — this is the argument that they are load-bearing rather than
characterful.

It also means the one-shot/level-gap options recorded in `TODO.md` are no
longer just a combat-balance question for the owner. They are a dependency of
the human pass.

## Which live behaviors, ranked by visible-map payoff per unit of work

The project's pillar — *mechanics should be visible on the map, not hidden in
a meter* — is also the right build-order heuristic here, because a human
behavior that does not change the map is invisible and therefore worthless
this early.

| behavior | substrate that exists | changes the map? | verdict |
|---|---|---|---|
| **Farm** | `crops.ts` already provides most of it | fields around a town | **v1** |
| **Build** | `shelter.ts`'s travel-and-invest shape | homes, walls appearing | **v1** |
| **Gather / log** | the decal -> gatherable system built this session | a visible footprint of depletion on neighbouring zones | **v1** |
| Trade | needs roads + surplus/shortage | road traffic, cut roads | defer — biggest machinery, best quest generator |
| Fish | — | coastal only | defer — narrow |

**v1 = farm + build + gather.** Those three are what make a town look alive
and leave a mark on its surroundings. Trade is the most *interesting* one and
should not be first: it needs the history pass's roads underneath it.

## Open risk: towns must not grow on the animal clock

If villagers reproduce through the existing breeding machinery, town
populations will boom and bust exactly like herd populations do — which is
correct for Tauros and wrong for a village. Settlement growth should be a
slow, resource-gated number on the settlement record (food surplus over time,
gated by housing and safety), not emergent per-agent breeding.

Getting this wrong is subtle and slow to notice: it reads as "towns feel
unstable" long before anyone traces it to the breeding model.

## Proposed phasing

Each phase stands alone with its own evidence.

0. **Species pass** (mostly data). Mob-defense bonus for humans, tool-granted
   moves wired, omnivore/farming bias, `isPredator: false` confirmed.
   Cheap, verifiable, no new systems.
1. **History pass** (macro, worldgen). Founding sites, expansion over
   generations, roads accrete from repeated traffic, failures leave ruins,
   era events. Reuses `HerdRecord`'s founded/parent/origin vocabulary — a
   settlement founding *is* a herd split. **Delivers towns and roads.**
2. **Settlement entity.** Population count, food stores, attitude axis, 3-8
   individuated agents. The architecture decision above, made real.
3. **Survival.** Walls, watchfires, coordinated defense. Pulled early and
   deliberately — see the blocker above. Without this, phases 1-2 die on
   contact with the ecology.
4. **Live loop.** Farm, build, gather.
5. **Trade, earned roles, drives.** The quest generator, once roads exist.

Auto trainer mode sits on top of this, and gets meaningfully more
interesting at each phase rather than needing all of it.

## Open questions

1. Abstracted settlement population with 3-8 real agents (recommended), or
   every villager a real agent?
2. Does the one-shot / level-gap work happen before the human pass, or do we
   build walls-first and let the ecology stay as lethal as it is?
3. Are towns founded only by the history pass at worldgen, or can new
   settlements be founded during live play?
4. Still unanswered from `MODES_DESIGN.md`: what does "how far they go"
   resolve to? (Recommendation stands: bonds + standing, both readable off
   existing machinery.)

---

# Decisions (given directly)

1. **Abstracted population, with a cycling cast.** *"Abstracted, but agents
   kinda cycle to give illusion of bustling."*
2. **Build walls; the ecology stays lethal.** *"Build walls, keep lethal."*
   The one-shot / level-gap options in `TODO.md` are therefore NOT a
   dependency of this pass after all — the answer is fortification, not
   softening the world. Recorded as settled so it doesn't get re-litigated.
3. **New settlements can be founded in live play, but it is hard.** Plus a
   substantial identity ask, below.

## 1. The cycling cast — how a town of 40 runs on 6 agents

The settlement record holds the real population (say 40). At any moment only
a handful exist as real agents. The trick is that **they rotate**:

- A cycling villager is spawned with one errand — walk to the field and work
  it, carry wood to the build site, draw water. When the errand completes,
  it retires back into the abstract pool and a *different* villager spawns on
  a different errand.
- Over a few minutes of watching you see many different people doing many
  different things, and the town reads as busy — without ever paying for 40
  behavior trees.
- **The individuated few never cycle.** The elder, the smith, the guard are
  persistent agents with names, histories and titles. So the town has both a
  stable cast you recognise and a churn of anonymous life behind it. That is
  exactly the notables-vs-population split again, now visible on screen.

Two real risks, both solvable and both worth writing down now:

- **Retirement must never be visible.** An agent evaporating while the camera
  is on it is indistinguishable from a bug. Retire only when off-screen, or
  on entering a building — a door is a perfect despawn.
- **Deaths must still count.** If a cycling villager dies, the settlement's
  population must actually drop, or death near a town stops mattering and the
  place becomes scenery. The corollary is that cycling villagers should be
  doing daytime work inside the walls, so ordinary errands aren't a slow
  population leak.

## 3. Town identity — distinct, meaningful, and *earned*

Direct ask: *"we want like chronicle level lore here, like make the towns
compelling and meaningful. Make em distinct, known for different things,
excel at crafting different items and cooked recipes. Make em near water,
rivers, streams. Make some more farm oriented others more merchant others
like smithing."*

### Siting is a rule, not an identity

*"Make em near water, rivers, streams"* is a **founding constraint**: every
settlement sites on fresh water. That is how real settlement works and it
costs nothing — the macro grid already carries rivers and coasts. It is the
history pass's first filter, not a flavour trait.

### Identity is derived from the site, then earned over history

The rest of this project never rolls a fact from a table when it can derive
one from the world — herds have causes, roads accrete because they were
walked, titles are earned from real stats. **Town specialization should work
the same way, or it is just a label on a nameplate.**

Seeded from site facts the macro grid already has:

| site fact | becomes | known for |
|---|---|---|
| rich soil, river floodplain | **farming town** | grain, cooked dishes, granaries |
| ore in nearby highlands / badlands / cave access | **smithing town** | tools, weapons, worked stone |
| junction of corridors, river confluence, coast | **merchant town** | moving goods rather than making them |
| coastal | **port** | fish, salt, preserved food |
| forest-adjacent | **timber town** | hafts, cordage, building material |
| near a shrine or landmark | **devotional** | keeps the stories, tends the shrine |

Then it is **earned**: a town that actually produced iron for two hundred
years of the history pass *becomes* known for iron. Same mechanism as
`notables.ts` earning titles from accumulated stats, pointed at a settlement
instead of an individual. This is what makes "known for" true in the data
rather than decorative — and it means the chronicle can say *why*.

### The teeth: specialization is recipe knowledge

An identity with no mechanical consequence is set dressing. Here is the hook,
and it is already half-built.

`crafting.ts` has `RECIPES` with a `knownAtStart` flag, and its own comment
records a real gap: recipes were meant to be *"learned later... examine, being
taught, a written recipe"* but **"that discovery mechanic was never built, for
ANY recipe."**

**A town known for smithing is a town that knows — and can teach — the axe
and machete recipes.** The unbuilt discovery mechanic is exactly what town
identity needs, and building it once serves both. That gives specialization
real teeth immediately:

- Towns hold a **recipe repertoire**; some recipes exist nowhere else.
- Trade has a *reason* — you go to the smithing town for a good axe, and the
  road there matters because of what is at the end of it.
- For auto trainer mode, a trainer's route through towns changes what they
  can make and carry. Which town your people wander into becomes a real
  outcome, which is exactly the legibility the mode needs.
- It also finally makes `knownAtStart: false` recipes reachable — currently a
  live instance of the *"unreachable content is a bug"* pillar.

### Keeping them distinct (the guard against samey towns)

Pure site-derivation makes every grassland town identical. Four cheap sources
of divergence, none of which is random-for-its-own-sake:

- **Era events.** A town that survived a famine becomes known for its
  granaries. The disaster is already in the chronicle; let it mark the town.
- **Lineage.** A daughter settlement inherits part of its parent's
  repertoire, so a region develops a *tradition* rather than scattered
  unrelated specialities.
- **A secondary site fact.** A farming town that also happens to sit on clay
  is the one that makes the pots.
- **Rarity.** A handful of landmark-driven identities that most worlds won't
  have at all.

### Founding in live play is hard (decision 3)

Gate it on real cost rather than a cooldown: a surplus large enough to spare
people, a viable site (fresh water, land, not too far, not through a
mountain), and a party that has to actually *walk there and survive it*. A
founding that fails leaves a ruin and a chronicle entry — which is a better
outcome than a founding that never happens.

---

# What "how far they go" means — the question, explained plainly

Reasonable confusion; the question was badly phrased. Plainly:

> **When a run ends, what tells you how it went?**

You set up some trainers and let them loose. Hours later, something has to
answer "so... how did they do?" That answer can take several shapes:

- **A. Survival.** How long they lived, how far they walked. Easy to build,
  and the least interesting thing about a person.
- **B. Bonds.** How many Pokémon they partnered with, and how deep the
  rapport got. Most on-premise, since the whole mode is about the first
  people to do this at all. Rapport machinery already exists.
- **C. Standing.** Titles earned. `notables.ts` already computes these from
  real accumulated stats, so this is very nearly free.
- **D. Legacy.** Did they found a settlement, have children, pass a role on,
  leave a ruin with their name on it.
- **E. No score at all — just the chronicle.** The run ends and you read what
  happened. No number anywhere.

**Recommendation: E as the presentation, with B + C + D as the facts inside
it.** The project's own pillar is *"I want stories"*, and a leaderboard
number is the least story-shaped possible ending. But a chronicle that can
say *"Mira bonded with three, earned the name Ashwalker, and founded Redfen
before the winter took her"* is telling a story **and** answering "how far did
she go" in the same breath — and every one of those facts is read off
machinery that already exists rather than a scoring system invented for the
purpose.

A is worth capturing anyway because it is nearly free. Skip it as the
*headline*.
