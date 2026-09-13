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
