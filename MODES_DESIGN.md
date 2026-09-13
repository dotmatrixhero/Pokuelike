# The three modes

Direct ask: *"Ok I wanna try out a third mode. Watch mode, play mode should
turn to rogue mode, then a new one called auto trainer mode. Auto trainer
mode let's you create a set of humans. Also gotta set like... Disposition to
Pokémon types they like and like... and starting pack and other stuff..
Traits that we'll want to customize and build systems around. Then starting
towns.. We'll need to do the humans pass and create towns and roads and other
stuff too. Do you see the vision? We see how far they go and stuff"*

## What the three modes actually are

They are one simulation with three different **contracts of control**. The
axis is not *how much* control you have — it is *when* you spend it.

| mode | authorship | control during the run |
|---|---|---|
| **Watch** | none | none — pure spectator |
| **Rogue** (was "play") | none — you're dropped in | continuous, one body |
| **Auto trainer** | **total, up front** | **none** |

Auto trainer is the only mode where your decisions are front-loaded and then
*tested*. That makes it a different kind of game from the other two: you are
not playing the world, you are **betting on people** and finding out whether
you were right. It is a hypothesis machine.

That framing is not decoration — it tells you exactly what the mode lives or
dies on:

1. **The authoring step must be expressive enough that two rosters feel
   different.** If every run converges, there was no decision.
2. **The run must report back legibly enough to attribute outcomes to your
   choices.** If a trainer dies in a ditch and you cannot tell whether your
   choices caused it, you learned nothing.

(2) is the one that usually gets skipped, and it is a direct application of
the project's own pillar: *"the ability to make decisions is core to
gameplay, and being informed about what decisions youre making is
important."*

## The collision that has to be settled first

**"Trainer" cannot mean what it means in mainline Pokémon here.** Two
decisions in `HUMANS_DESIGN.md` are already settled and both are in the way:

- Decision 4: **no domesticated Pokémon in this region.** No partnership of
  any kind, deliberately scoped to the starting region.
- Decision 3: **humans hunting Pokémon is lore-only, never shown.**

So a "trainer" here cannot catch, battle, or keep Pokémon without
contradicting settled canon. Three honest ways out:

- **(a) The mode is about the FIRST bonds.** You author the handful of people
  who invent the idea of partnership, and watch whether it takes. This fits
  the "you're the first" premise exactly, reuses the rapport machinery that
  already exists, and is a better story than a trainer sim — you are watching
  a practice get invented, with most attempts failing.
- **(b) Set it elsewhere/later**, in a culture where partnership is normal.
  Costs nothing in canon but throws away the premise's best hook.
- **(c) Revisit decisions 3/4.**

**Recommendation: (a), strongly.** It is the only one that makes the mode
*about* something this world uniquely has.

## The real blocker (state this plainly before scoping anything)

`HUMANS_DESIGN.md` open question 7, found while building the archetype
tendency, says it outright: **wild humans currently run the exact same
generic animal behavior tree as every other species.** There is no
gather, craft, trade, settle, train, or build behavior. Confirmed here: there
is no humans module in `packages/engine/src` at all, and no town or road
implementation anywhere.

So auto trainer mode, built on today's sim, would produce: a set of humans
with carefully authored traits and starting packs who **wander around like
Pokémon** and eventually starve or get eaten. The authoring step would be
elaborate and the outcome would be noise — an elaborate character creator
whose inputs never manifest. That is the *"unreachable content is a bug"*
pillar firing in advance.

**Auto trainer mode is not a mode you add on top of the current sim. It is
the UI on top of the humans pass.** The instinct in the ask — *"We'll need to
do the humans pass and create towns and roads and other stuff too"* — is
correct, and the ordering is not optional.

What already exists, and what doesn't:

| piece | state |
|---|---|
| `Agent.archetype` (hunter/forager/traveler/merchant/wanderer) + real starting gear from `ITEMS` + tool-granted moves | **built** |
| `Disposition` vector (boldness, aggression, sociability), seeded per individual, in `nature.ts` | **built** |
| Notables: titles *earned* from real accumulated stats | **built** |
| Rapport / bond machinery | **built** |
| Drives (Provide / Standing / Curiosity / Safety / Devotion / Grief) | designed, unbuilt |
| Human behavior loop (the settlement loop) | designed, unbuilt — **the blocker** |
| Settlements as entities | designed, unbuilt |
| Towns, roads | **nothing, not even design past open Q3** |

The "starting pack" half of the ask is therefore already partly shipped, and
the trait system already has its substrate. The behavior loop is the hole.

## Thin slice: auto trainer v0, no towns

Each slice should stand alone with its own evidence. The fantasy can be
proven long before the settlement stack exists:

**Author N trainers. Drop them into the wild world that already exists.
Watch.**

That needs only *one* new thing — a human behavior loop good enough that a
person seeks out Pokémon and tries to form a bond — plus disposition biasing
where they walk. No towns, no roads, no economy, no crafting.

"How far they go" is then literally: how far they walked, what they bonded
with, what they earned a title for, and how they died. That is a complete,
narratable run. It is also the cheapest possible test of whether the
authoring step is expressive enough to matter, which is the risk that kills
this mode if it is discovered late.

Towns and roads come after, and only if v0 reads well.

## Design constraint on traits

Hold traits to the project's own pillar: *mechanics should be visible on the
map, not hidden in a meter.*

**Prefer traits that change WHERE a human goes and WHO they approach, over
traits that change hidden numbers.**

- Good: *drawn to Fire types* -> she routes through the ash flats, walks past
  the Poliwag nest, and meets the Growlithe. Visible on the map. The
  chronicle can say why she was there.
- Bad: *+15% catch rate on Fire types* -> invisible, unfalsifiable, and turns
  the authoring step into a spreadsheet.

Second constraint: **do not build a second personality model.** `nature.ts`
already has `Disposition`, and `HUMANS_DESIGN.md` already argues for drives
sitting on top of it and biasing it. The authoring UI should be "pick drives
and a type affinity", writing into that existing substrate. A parallel trait
system would be a duplicate, and the two would drift.

## The undefined thing — what does "how far they go" mean?

This is the biggest hole in the pitch, and everything else depends on it.
Without a success axis there is no reason to compare two rosters and the mode
has no shape. Candidates:

- **Survival** — years lived. Simplest, least interesting.
- **Bonds** — Pokémon partnered. Most on-premise given "you're the first".
- **Territory** — distance and zones explored.
- **Legacy** — founded a settlement, had children, passed on a role.
- **Standing** — the notables system *already* earns titles from real
  accumulated stats, so this is very nearly free.

**Recommendation: bonds + standing.** Both can be read off machinery that
already exists rather than invented, which means v0 can report a real outcome
without a new scoring system.

## Open questions

1. Is auto trainer about the first bonds (a), a different era/region (b), or
   are decisions 3/4 back on the table (c)?
2. What is the success axis — what does "how far they go" resolve to?
3. Does v0 skip towns entirely, or are towns non-negotiable for the fantasy?
4. Is "rogue mode" just a rename of play mode, or does it also take on
   roguelike structure (runs, permadeath, meta-progression)?
