# Humans: what they are in this world

The human geo pass (CAMPAIGN_DESIGN.md) knows how to *place* villages. This
doc is about what's actually in one — because "add roads and villages and
ports" is a generation problem, and "what is a human" is a design problem,
and doing the first without the second gets you buildings nobody lives in.

Direct instruction that prompted it: "Before we do that we gotta go deep
into humans design."

Nothing here is built. Where this doc makes a recommendation it says so;
where it needs a call it asks rather than assuming.

## The fork everything else hangs off

**Are humans simulated agents, or authored content?**

Every other question in this doc gets easier once this one is answered, and
harder if it's dodged. The two honest options:

- **Authored NPCs.** A village is a set of static entities with dialogue,
  inventories and quest hooks. Cheap, predictable, totally controllable —
  and completely inert. The village would be the one place in the world
  where nothing emerges.
- **Simulated agents.** Humans are a species in the sim, living in the same
  ecology as everything else. Expensive, unpredictable, and the only option
  that makes this world's villages feel like they belong to *this* project.

**Recommendation: simulated, with a thin authored overlay.** Humans are a
real species; a small number of specific individuals (the elder, the smith,
the quest-givers) are additionally marked as authored/protected so the
campaign has stable anchors. This is not a compromise so much as the same
notables-vs-anonymous-population split the sim already uses everywhere else
— most villagers are simulated population, a few are named characters with
guaranteed persistence.

### Why simulated is genuinely cheap here — a village is a herd

The reason to recommend this isn't ideology, it's that **the machinery
already exists and a village fits it almost exactly**:

| A village needs | Already built | Where |
|---|---|---|
| A named group with a founding, history, splits | `HerdRecord` — name, place name, founded tick, parent herd, running record | `herds.ts` |
| To stay together spatially | Herd cohesion toward a centroid | `herding.ts` |
| A leader | Herd leadership | `herdLeadership.ts` |
| Individuals who earn reputations | Notable titles, earned from real stats, plus generated lore | `notables.ts`, `notableLore.ts` |
| To build structures | Site selection, travel, multi-tick construction, decay if abandoned | `shelter.ts` |
| To farm | 12 crops, biome/season/moisture-gated | `crops.ts` |
| To eat, drink, sleep | Full needs model | `needs.ts` |
| To claim land | Named territories over the macro grid | `territories.ts` |
| To fight over resources | Cross-species resource contention, escalation, rivalry | `herdConflict.ts` |
| To have their story told | Event chronicle | `chronicle.ts` |
| To exist off-screen cheaply | Aggregate tier — population without individuals | `overworld.ts` |

A `SpeciesDef` already carries `buildsShelter`, `biomes`,
`preferredTerrain`, `activityPattern`, `isPredator`, stats, types and moves.
**"Human" is expressible as a species entry today** without a single new
field. That's the strongest argument in this doc: the expensive-sounding
option is mostly wiring, not new systems.

What it does *not* get for free, and what this doc is really proposing:
tools, trade, belief, and a relationship with Pokémon. Those are the human
parts.

## What a human is, mechanically

The premise ("you're the first to train one") only works if humans are
**individually weak and collectively formidable**. That should be true in
the numbers, not just the fiction:

- **Weak base stats.** A lone human loses to most mid-tier Pokémon. This is
  what makes the fragile-human player fantasy real (DESIGN.md's "Player
  character: a fragile human" section already committed to it) and what
  makes a lone traveller on a road genuinely at risk.
- **Strength comes from three multipliers**, none of which a Pokémon has:
  - **Numbers with coordination** — humans mob-defend far more effectively
    than herd animals do. The mob-defense mechanic already exists; humans
    should be unusually good at it.
  - **Tools** — a spear/bow is the great equalizer, and it's the same
    equipment system Act 1 needs anyway. An armed villager is a different
    threat than an unarmed one.
  - **Fire and walls** — both are already real terrain (`fire.ts`,
    plus shelter/wall tiles). A palisade and a watchfire are how a village
    survives a world of Pokémon without partners.
- **Not a predator** (`isPredator: false`). Humans don't hunt to eat by
  default — see the attitude axis below, which can override this per
  settlement. Keeping the default off matters tonally: humans as a species
  aren't the villain.
- **Diurnal** (`activityPattern`) — humans sleep at night, which makes
  night genuinely dangerous around settlements and gives the day/night
  system real teeth for the first time.
- **Omnivore with a farming bias** — they eat crops they grow, fish they
  catch, and gathered flora. Not berries scavenged off the ground like
  everything else; the difference between foraging and *producing* is the
  clearest mechanical line between humans and every other species.

## What humans do: the settlement loop

This is the part with no existing analog — every other species in the sim
consumes what the world provides. Humans change the world to provide more.

- **Farm.** Crops already grow biome/season/moisture-gated; a farming
  village plants them deliberately in a cleared area near the settlement,
  and a bad season is a real shortage. This makes `crops.ts`'s existing
  season model load-bearing for the first time.
- **Fish.** Ports and coastal villages draw from water instead of soil,
  which is what makes a coastal settlement mechanically distinct rather
  than just a village that happens to be on a beach.
- **Gather and log.** Wood/stone/herbs from surrounding zones — this is the
  material sink that quests ("collect materials") and crafting both draw on,
  and it gives a settlement a real footprint of influence on its
  neighbours.
- **Build.** Homes, walls, docks, crafting tables, shrines — reusing
  `shelter.ts`'s travel-and-invest construction shape rather than a
  separate building system.
- **Trade.** Along the roads the geo pass builds. A settlement's surplus
  moves to a settlement with a shortage; a road that gets cut (a predator
  den on it, a bridge out) is a real, visible consequence rather than an
  abstract debuff. This is also the most natural quest generator in the
  whole design.

**Roles, earned rather than assigned.** `notables.ts` already gives
individuals titles based on real accumulated stats. Human roles — farmer,
fisher, forager, builder, guard, elder — should work the same way: an
individual who has spent their life building *becomes* the builder. It
costs nothing extra structurally and it means a village's composition is a
real fact about its history rather than a spawn table.

## The human–Pokémon relationship (the important part)

This is where the world is either interesting or generic, and the pitch
already constrains it hard: **no Poké Balls, trainers aren't a thing yet,
and you are the first.** That constraint is a gift, because it forces an
answer to a question most Pokémon fiction skips: *what did people do about
Pokémon before they could catch them?*

**Recommendation: fear and reverence, not exploitation.** Pokémon are
dangerous, powerful, and clearly more than animals — so humans give them
distance and meaning rather than domesticating them. Concretely:

- **Distance is the default relationship.** Villages are built *away* from
  dens and migration routes; walls face the wilderness; children are kept
  in at night. The world's geography of settlement is partly a map of what
  people are avoiding — which the geo pass can express directly, by siting
  settlements away from predator-dense zones.
- **Shrines are where the world's real history gets worshipped.** This is
  the piece I'd most argue for. The macro grid already generates
  `sacredSpring`, `geothermalVent`, `meteorCrater`, `greatLake`,
  `boneGrounds` — and DESIGN.md's geological vision frames the world as
  literally shaped by legendary forces. So: **humans built shrines at the
  places where the world's generated history left visible marks.** The
  geology *is* the mythology, and the shrine is the evidence that someone
  noticed. That makes shrine placement meaningful rather than decorative,
  it costs almost nothing (site shrines on/adjacent to existing landmarks),
  and it gives every generated world its own religion for free.
- **A per-settlement attitude, not a global one.** One axis, three poles,
  set at generation from real local facts and drifting with events:
  - **Reverent** — Pokémon are sacred. Won't harm them, leaves offerings,
    shrine-heavy. Likely near a major landmark.
  - **Fearful** — Pokémon are a threat to be walled out. Guard-heavy,
    hostile to what approaches, likely in a predator-dense or
    recently-attacked region.
  - **Pragmatic** — Pokémon are a hazard and occasionally a resource.
    Hunts when hungry, uses parts, least sentimental. Likely in a
    resource-poor region.
  This single variable does an enormous amount of work: it decides what
  quests a village offers, how they react to the player arriving with a
  bonded partner, and whether "clear out the Krabby nest" is a
  pest-control job or a moral problem.
- **Why nobody has done what the player does.** Worth being explicit,
  because the premise depends on it: bonding requires *reading* a Pokémon's
  state and taking real personal risk at close range — which is precisely
  what a society that survives by keeping its distance has trained itself
  never to do. The player isn't smarter, they're the one who was desperate
  and alone in a cave with no walls to hide behind. That's a much better
  reason to be first than being chosen.

## Settlements as living things

The pitch's Act 2 opens with a village under attack. That should be a
**real event the sim can produce**, not a cutscene:

- `herdConflict.ts` already fires on genuine cross-species resource
  contention. A pressured predator herd, a bad season shrinking the harvest,
  a migration route that now runs through farmland — these are already the
  kinds of things this sim generates on its own.
- Settlements should be able to **grow, stagnate, decline and fall**. A
  ruined settlement is one of the best pieces of environmental storytelling
  available, and the chronicle system can already say what happened to it.
- **The influence gradient the geo pass produces should be reversible.** A
  village that falls leaves roads that overgrow, fields that go wild, and a
  ruin — which is a far more interesting thing to find than a village that
  was never there.

## History: where these people came from

Direct follow-up: "Yeah like history and motivations and tools and shit."

The world already has a generated geological history — uplift, basins,
rivers carved by real steepest descent. **Humans should get the same
treatment: a generated history pass, not a static starting placement.**
This is what turns "there is a village here" into "there is a village here
*because*," and it's the difference between a map and a world.

**It's cheap at macro scale**, which is the whole reason it's viable: this
runs over the zone grid on compact per-settlement records, the same
cheap-dense-facts model that generates a million-zone macro grid in 2.5s.
No per-tile anything, no per-agent anything.

### The pass, concretely

1. **Origin.** A small number of founding sites — where people first took
   hold. Coastal (arrived by sea) or river-valley (arrived overland) both
   read well, and both are sited off facts the macro grid already has.
2. **Expansion over generations.** Each step, a settlement with surplus
   founds a daughter settlement along a viable corridor — good land, fresh
   water, not too far, not through a mountain. Settlements that outgrow
   their land split; settlements on bad sites stagnate.
3. **Roads accrete rather than being planned.** This is a better answer than
   the MST I proposed in CAMPAIGN_DESIGN.md: a road exists because that path
   got *walked* repeatedly between two settlements that traded for
   generations. Same output shape (`roadEdges`), earned rather than
   computed. Keep MST as the fallback if the history pass doesn't get built.
4. **Failures leave ruins.** A settlement that starved, got overrun, or
   was abandoned when its river shifted leaves a real ruin on the map, with
   a real recorded reason.
5. **Era events punctuate it.** A great winter, a plague, a legendary
   awakening, a war between two settlements. Each one is a chronicle entry
   that later villagers can reference — and one of them can be the reason
   the Act 2 village is in trouble when the player arrives.

### It reuses the herd vocabulary almost exactly

`HerdRecord` already has `foundedTick`, a parent herd for splits, an origin
(`founding` / `split` / `immigration`), and a running record of what
happened. **A settlement founding is a herd split.** A settlement's lineage
back to its origin site is the same parent-chain herds already track. This
is not a coincidence worth ignoring — it means human history is mostly
already-built bookkeeping pointed at a new subject.

### The payoff is dialogue that isn't lying

The reason to do this rather than hand-write backstory: when an elder says
"my grandmother's people came down from the high valley after the ash
winter," that is **true in the data** — there was a settlement up there, it
did fail, in a recorded year, for a recorded reason, and this village's
lineage really does trace back to it. Generated history is the only way to
get that at scale, and it's exactly the kind of thing this project already
does for herds.

**Open: how deep?** A few hundred compressed "years" as an abstract pass is
my recommendation — enough for lineage and ruins, not so much that it
becomes its own simulation project. Simulating human history tick-by-tick
is a different and much larger thing.

## Motivations: what people want

Needs (`needs.ts`) explain why an agent eats. They don't explain why anyone
builds a shrine, takes an apprentice, or walks to the next valley. Humans
need a layer above needs.

### Individuals: dispositions they already have, drives they don't

`nature.ts` already carries a `Disposition` vector — **boldness,
aggression, sociability** — seeded per individual. That's a serviceable
personality substrate for humans as-is; it doesn't need replacing, it needs
a set of *drives* sitting on top that it biases:

- **Provide** — for family/household. The baseline drive; most villagers,
  most of the time.
- **Standing** — earn a reputation. Ties directly into the existing
  notables system, where titles are already *earned* from real accumulated
  stats rather than assigned.
- **Curiosity / wanderlust** — the drive that makes someone leave. High
  boldness, low sociability. These are the people who become travellers,
  found daughter settlements, and (not incidentally) are the ones most
  likely to react well to a stranger who walks in with a bonded Pokémon.
- **Safety** — high fear. Wants walls, wants the guard doubled, wants the
  player to go deal with the thing in the woods.
- **Devotion** — tends the shrine, keeps the stories. The mechanism by
  which a settlement's history and its attitude toward Pokémon persist
  across generations.
- **Grief / grievance** — created by real events, not spawned. Someone
  whose kin was killed by a Houndour herd is a different person afterward,
  and the rapport/event machinery can already produce that fact.

The point of naming drives rather than adding stats: **a drive explains an
action to the player**. "She's doing this because she wants standing" is
legible in a way "her sociability is 0.72" isn't.

### Settlements: motivation is the quest generator

This is the part I'd argue hardest for. A settlement has **one dominant
current motivation**, derived from its real state, and it changes as
conditions change:

| Settlement state | Motivation | What it asks the player for |
|---|---|---|
| Food stores low, bad season | **Survive** | Food, hunting the thing eating the crops |
| Recently attacked / walls broken | **Rebuild** | Materials, labour, protection while they work |
| Predator pressure nearby | **Defend** | Clear a den, escort, scout a threat |
| Surplus, growing population | **Expand** | Scout land, clear a route, escort settlers |
| Road cut, shortage of a good | **Trade** | Reopen a route, carry goods, deal with what's on the road |
| Landmark nearby, high devotion | **Worship** | Pilgrimage escort, retrieve something, tend a site |

**Quests fall out of this rather than being authored one at a time.** The
pitch's own examples fit without modification — "clear out Krabby nests by
the beach" is a Defend village on a coast; "collect materials" is a Rebuild
village. That's a good sign: the quests that came to mind naturally are
already the ones this model produces.

It also means the *same* village asks for different things depending on
when the player shows up, and that "save the village" in Act 2 is just a
settlement whose motivation has been forced to Survive by a real event.

## Tools and material culture

The third leg. Humans are defined by what they can make, and — usefully —
**what they can make is already determined by the geology pass**.

### Tech level

Pre-industrial and deliberately modest: wood, stone, fibre, hide, then
bronze and iron where the ore is. No gunpowder, no machines. This keeps the
player's Act 1 survival crafting and the village's Act 2 crafting tables on
**one continuous ladder** rather than two disconnected systems — the
village has better tables and better materials, not different physics.

### Regional material culture, free from the macro grid

A settlement can only make what its land provides, and every input already
exists as a per-zone macro fact:

- **Forest/jungle** → timber, bows, palisades, charcoal.
- **Highland/badlands/desert, or near a `geothermalVent`** → ore, smithing,
  metal tools and armour. Metalworking settlements are rarer, which makes
  metal goods a real trade good rather than a given.
- **Coast / `beach` / port** → boats, nets, rope, preserved fish.
- **Grassland/wetland** → farming implements, textiles, cordage.

So **material culture is downstream of the geology pass with no new data**,
and two villages a hundred zones apart genuinely make different things.
That's also what gives trade a reason to exist, which gives roads a reason
to exist, which is the loop closing properly.

### Techniques spread along roads

A technique (smithing, boatbuilding, a particular crop) starts somewhere and
**diffuses along trade routes over historical time**. Three things fall out
of this for free:
- Roads visibly matter — they carry more than goods.
- Isolated settlements are genuinely more primitive, without hand-authoring
  that.
- A technique can be *lost* when the settlement holding it falls, which is
  a real historical event and a real reason for a ruin to be worth
  exploring.

### The pitch's specific items, placed on this ladder

- **"A large stick"** — the starting weapon; the whole point is that it's
  barely a weapon. Spear is the first real upgrade.
- **"Armor (more stylish clothes basically)"** — hide/cloth early, plate
  only from a smithing settlement. Reads as social status as much as
  protection, which is exactly the flavour asked for.
- **Fishing rod, bigger backpack** — capacity and access tools rather than
  combat power. These are what turn a survivor into a provider.
- **Crafting tables** — the village-tier upgrade of the campfire.

### TMs are not human technology — a proposal

TMs sit awkwardly on a pre-industrial ladder: nobody who has never trained a
Pokémon is manufacturing move-teaching devices. **Recommendation: TMs are
ancient relics, found rather than crafted** — in ruins, deep caverns and
shrines, left by whoever came before. That:
- Explains why they exist in a world with no trainers.
- Makes ruins and the cave layers worth exploring for their own sake.
- Quietly seeds the bigger mystery — someone *did* know how to do this once,
  and the knowledge was lost — which is a natural runway into the Jirachi/
  wish thread Act 3 gestures at without committing to anything yet.

## Real risks, stated plainly

- **Simulated villagers can die, including quest-givers.** This is the
  sharpest practical problem with the recommendation. Options: mark
  campaign-critical individuals as protected (simple, slightly dishonest),
  let roles be inherited so *the elder* persists as an office even when the
  person doesn't (more interesting, more work), or accept the loss and let
  quests be lost with them (most honest, most likely to frustrate).
  **My lean: inherited roles.** It's the only one that turns the problem
  into a feature.
- **Humans could swamp the Pokémon ecology.** The project's whole value is
  the emergent Pokémon world; a fully-simulated human civilization is
  exactly the kind of system that quietly becomes the main character. Worth
  a deliberate cap — humans are a minority of the world's simulated
  population and only meaningfully simulated in zones the player is in or
  near.
- **Tone.** How humans treat Pokémon sets the entire emotional register of
  the game. The attitude axis above deliberately keeps "humans as villains"
  available but not default. Worth deciding on purpose rather than
  discovering it in the quest text.
- **Scope.** Everything in this doc is unbuilt. The settlement loop alone
  (farm/fish/gather/build/trade) is comparable in size to the crops or
  shelter systems, each of which was its own project.

## Open questions — yours to call

1. **Simulated species with an authored overlay** — is that the right
   answer, or do you want villagers fully authored and static (much cheaper,
   much deader)?
2. **Can villagers die permanently?** And if a quest-giver dies, is the role
   inherited by someone else, or is that quest gone?
3. **Do humans hunt Pokémon?** The attitude axis lets some settlements do it
   and others revile it. Is that range right, or should humans never hunt
   (softer world), or commonly hunt (harsher, and makes the player's
   partnership genuinely subversive)?
4. **Any domesticated Pokémon at all before the player?** Not partners, but
   e.g. penned Miltank, a Tauros pulling a plough. It's a real tonal fork:
   "nobody has ever worked with them" is cleaner, but "they're livestock,
   never companions" is a more pointed thing to say about the world the
   player changes.
5. **How populated is the world?** One starting village and a lot of
   wilderness, or a real scattering of settlements with trade between them?
   This changes the geo pass's density constants and how much content Act 2
   needs.
6. **Are humans on the macro map from the start of a run**, or does the
   world generate wild and get settled during a simulated history pass? The
   second is much more in the spirit of the geological history phase, and
   much more expensive. (The History section above assumes the second and
   argues it's cheaper than it sounds at macro scale — but it's still the
   single biggest scope call in this doc.)
7. **How deep does generated history go?** My recommendation is a few
   hundred compressed years as an abstract pass — enough for lineage, ruins
   and era events, without becoming its own simulation project.
8. **Do roads accrete from history, or get computed by MST?** History is
   better (a road exists because it was walked) but only exists if the
   history pass does. MST is the standalone fallback.
9. **TMs as ancient relics rather than crafted goods** — does that fit the
   world you want? It solves a real awkwardness (pre-industrial people
   manufacturing move-teaching devices) and seeds the "knowledge was lost"
   thread, but it does commit to there having been a *before*.
