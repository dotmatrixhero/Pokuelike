# Campaign design: the cave, the village, and what comes after

The first real pitch for what the *game* is, as opposed to what the
simulation is. Everything before this doc designed systems — ecology, herds,
moves, crops, fire, the overworld grid — without ever saying what a player
actually does with them. This says it.

Nothing in this doc is built. It is a pitch captured faithfully plus an
honest audit of how far the existing codebase already gets us, written the
same way DESIGN.md's own vision sections are: quote the ask, don't
compress the specifics away, and separate "this exists" from "this is new"
so a future slicing pass isn't guessing.

**Read NARRATIVE_PILLARS.md alongside this.** It states what the game is
*about* and what that lets us refuse — and several beats below are
deliberate expectation-inversions serving those pillars rather than
straightforward genre moves. Most importantly: **Act 1's lone-survivor
opening is invoked on purpose so the simulation can disprove it.** Solitude
is endured, not mastered; "you're the first" means *unsupported*, not
exceptional; and the player must not single-handedly save the village in
Act 2. Those aren't tonal preferences — they're the point of the structure,
and they should survive contact with implementation.

## The pitch, as given

Direct, verbatim in the parts that matter — the specifics *are* the pitch:

**Act 1 — the cave.**
- "You start at the bottom of a 5 or 6 layer cave. Alone. Your first goal is
  to escape. We start with a traditional Roguelike reminiscent of the caves
  in Pokémon."
- "These layers are bigger than our zones, probably 2 or 3 of em together."
- "Layer 1 you stumble across an underground lake or river with lots of
  sunlight and plants. It's peaceful, prey only, but herds. You earn their
  trust. Collect herbs to make things like potions and such."
- "Maybe you can find armor (more stylish clothes basically) and a large
  stick that help you survive."
- "You have to eat and drink too."
- "You have moves too, like punch or kick, or swing or yell."
- "You can also make a fire. Roast some berries. Look for some. Crops."
- "You can build shelter that keeps you safe."
- "Maybe we borrow from some crafting games."
- "Your first goal is to befriend a Pokémon to help you. You have a couple
  choices. Maybe start with herds of eevee or Pikachu or something."
- "You can train them, spec their moves. Etc. And tactically command them.
  (gotta make ux easy here, basically you can easily choose their moves then
  choose a target tile, probably. They have to move themselves there. Maybe
  you can explicitly command them somewhere to move too, but mostly they'll
  auto follow you)"
- "The later layers have more prey to recruit, predators who will attack you
  directly. It's harder to befriend them, though still possible if you can
  figure out a way to do that."
- "You can run by them but some predators will catch you. We have to balance
  to basically force a fight."
- "You pick up loot, like TMs or recipes to craft stuff. Bigger backpack.
  Fishing rod."
- "Ultimately you can get a fire, water or electric stone. Then you emerge
  from the cave."

**Act 2 — the village.**
- "You make your way to a nearby village. Perhaps it's under attack somehow.
  So next level of game is to save the village."
- "Then some survivors will give you quests to help rebuild. In this world
  Pokémon trainers aren't really a thing as much yet, so no Poké Balls. And
  you're the first to train one, so people ask for your help with lots of
  things."
- "You go and clear out krabby nests by the beach, or collect materials and
  stuff. You get better crafting tables or something at the village."

**Act 3 — the hook out.**
- "Then you learn about Jirachi who can grant a wish and that sets you off on
  your next quest. Or something. Idk."

The "or something, idk" is honest and worth preserving as-is: Act 3 is a
direction, not a design. Acts 1 and 2 are specific enough to build against.

## Why this pitch fits the sim we already have

Two things about it are load-bearing and worth naming, because they're what
make it *this* project's campaign rather than a generic survival roguelike
bolted onto an ecosystem sim:

- **It starts where the sim is strongest and smallest.** A bounded cave
  layer with prey herds, plants, water and a couple of predators is exactly
  the ecology this sim already simulates well — just with a ceiling on it.
  We don't have to make the whole world interesting on day one, only one
  layer of it.
- **It makes the player's weakness the mechanic, not a difficulty setting.**
  "Alone," "you have to eat and drink," "some predators will catch you" —
  the player enters as the frailest thing in the ecosystem, which is the
  premise DESIGN.md's "Player character: a fragile human, earning your first
  partner" section already committed to. This pitch is the campaign shape
  around that decision, and it doesn't contradict it anywhere.

The pitch also, without saying so, answers a question that section left
open: what the player is *for* before they have a partner. The answer is
survival logistics — eat, drink, burn, build, craft — which gives the
bonding arc something to happen alongside instead of being the only verb in
the game.

## What already exists (real modules, not aspirations)

Audited against the current tree, not from memory. This is a lot more of the
pitch than I expected going in:

| Pitch element | Already built | Where |
|---|---|---|
| Eat and drink | Hunger/thirst/energy needs, decay, seeking, satisfaction | `needs.ts` |
| Herbs for potions | `herbs` is a real crop id, alongside 11 others, biome/season/moisture-gated | `crops.ts` |
| Roast berries / crops | Berries (Oran/Sitrus/Pecha/Cheri) + wheat/tomato/corn/rice/apple/potato/pumpkin as real growable food | `crops.ts` |
| Make a fire | Real `"fire"` terrain kind: spreads into vegetation, consumes fuel, DoT on anything standing in it, burns out to scorched floor | `fire.ts` |
| Build shelter | Site selection, real travel, multi-tick build investment, concealment + storm-cover payoff, decay if abandoned, food cache | `shelter.ts` |
| Moves (punch/kick/swing) | Full move system — hostile hits, ally support, and self/tile utility moves | `moves.ts`, `predation.ts`, `support.ts`, `utilityMoves.ts` |
| Herds to befriend | Named, persistent herds with founding, splits, migration history, notables | `herds.ts`, `herding.ts`, `herdLeadership.ts` |
| Earning trust | Sparse agent-to-agent relationship graph, explicitly built as the player-recruitment foundation | `rapport.ts` |
| Predators that hunt you | Real predation, pursuit, mob defense, rivalry escalation | `predation.ts`, `herdConflict.ts` |
| Train them / spec moves | Leveling, EXP, evolution, move trees and skill-tree specing | `leveling.ts`, `SKILL_TREE_GUIDE.md`, `MOVES_DESIGN.md` |
| Caves | Cellular-automata cave generation with guaranteed connectivity and a guaranteed water pocket | `worldgen.ts` |
| Cave set pieces | `deepCavern`, `tunnelWarren`, `frozenGrotto`, `boneGrounds`, `sacredSpring` as real landmarks with mechanical hooks | `landmarks.ts` |
| Village-ish anchors | `crossroads`, `sanctuary` landmarks already exist as named, mechanically-real places | `landmarks.ts` |
| "Layers are 2-3 zones" | Macro zone grid with promotion/demotion, named territories, coherent multi-zone geography | `macroGrid.ts`, `overworld.ts`, `territories.ts` |
| The story of it all | Event chronicle — herd histories, notable lore, named individuals | `chronicle.ts`, `notableLore.ts`, `names.ts` |

The four **bonding verbs are already locked in** from an earlier pass (see
DESIGN.md's "Player-recruitment design notes"): Feed, Fight alongside,
Rescue, Presence — with Rescue explicitly the special one ("the Pokémon
chooses you as much as you chose it"). This pitch's "you earn their trust"
doesn't need a new mechanic invented; it needs those four wired to a player.

## What is genuinely new (nothing exists — be honest about the size)

- **A player agent at all.** This is the big one. Today the sim has no
  controlled entity and no input→action path; it is an *observer* sim with a
  camera. Everything else in this pitch is content sitting on top of that
  one change.
- **A turn/action model for a player.** `tickWorld` currently advances the
  whole world on a timer. A "traditional roguelike" is world-steps-when-you-
  act. Both are viable on top of a deterministic tick, but the choice shapes
  the entire UX and should be made before anything is built against it.
- **Inventory, items and equipment.** Zero exists. Armor/clothes, the large
  stick, backpack capacity, fishing rod, TMs, evolution stones, recipes —
  all of it is one missing system, not several.
- **Crafting, recipes and crafting tables.** Nothing. The "borrow from some
  crafting games" instinct is right but unstarted.
- **Cooking.** Fire exists and food exists; "roast some berries" is the verb
  that connects them and doesn't.
- **Multi-layer Z caves.** `Layer` is a fixed three-value enum
  (`underground`/`surface`/`canopy`). A 5-6 layer stacked cave is the
  Dwarf-Fortress Z-level generalization DESIGN.md already flags as a real
  structural change, not a number bump.
- **The trust stage machine.** Wary → Tolerant → Curious → Bonded is
  designed in prose, in detail, and implemented nowhere.
- **Commanding a partner.** Choosing a move, choosing a target tile, letting
  it path there itself, mostly-auto-follow — a real tactical command layer
  with real UX risk, and the pitch already flags UX as the hard part here.
- **Escape-vs-forced-fight balance.** "You can run by them but some
  predators will catch you. We have to balance to basically force a fight"
  is a specific tuning goal that today's pursuit/give-up rules were never
  written to hit.
- **Village, NPCs, quests, rebuilding.** All of Act 2's connective tissue.
  The sim has no concept of a human other than the (unbuilt) player.

## Decided

The four open questions from the first pass, answered directly. Recorded
here as settled so they don't get relitigated.

1. **Turn based.** The world steps when the player acts. This makes the
   existing continuous-tick observer view a second, different mode rather
   than the same one — worth knowing up front, but the underlying
   `tickWorld` is already deterministic per tick, so "one tick per player
   action" is a scheduling change at the driver level, not a rewrite of the
   sim. The fragile-human fantasy needs you to be able to stop and think;
   a timer fights that.
2. **"A well designed randomly generated bespoke level."** The middle path,
   and the right one: the *generator* is authored, the *instance* is
   random. Not hand-placed rooms, and not "the ecosystem sim decides
   everything and we hope a level falls out" — a purpose-built generator for
   this level type, with real design intent baked into its rules (where the
   water is, where the corridors are, what the layer is *for*), producing a
   different real cave every run. This is the same thing `worldgen.ts`
   already does for zones, aimed at a specific authored purpose instead of
   general terrain.
3. **Layer, zone and Z-level are one concept: zones on different Z levels,
   with stairs between them. That's the cave.** This collapses the naming
   collision instead of reconciling it. A cave is a set of zones stacked
   across Z levels, connected by stair tiles; "layer" as a separate spatial
   noun goes away. The pitch's "layers are 2-3 zones together" survives as
   horizontal extent — a given Z level can span several zones.
4. **Forced fights come from level design, not combat tuning.** "We can just
   force fights in tight corridors" — a corridor with no room to slip past
   is a bespoke-generator concern (decision 2), which means today's
   pursuit/give-up rules don't need to be retuned to hit a balance target.
   Much cheaper, and much more legible to a player: you can *see* why you
   can't run.

**Standing note, not a question**: this is three acts of a full game. Act 1
alone is larger than any feature this project has shipped so far, and Act 2
is larger again. Slicing matters more here than anywhere else so far.

### What decision 3 leaves open

Collapsing layer/zone/Z-level is the right call and most of it is
straightforward, but two things genuinely need answering before it's built,
and neither is answered here:

- **What happens to `Layer` (`surface`/`underground`/`canopy`)?** Does every
  Z level still have its own three sub-layers, or does the Z axis replace
  that enum outright? DESIGN.md's Z-level vision section raised exactly this
  and left it open ("are those now sub-categories *within* a Z-level... or
  an orthogonal concept entirely"). Cheapest coherent answer is probably
  that a cave Z level IS the underground layer at a given depth, and
  surface/canopy only exist at the topmost level — but that's a guess, not a
  decision.
- **How does a zone address itself now?** Today a zone is `(row, col)` and
  the macro grid is dense 2D. Adding Z means either a third coordinate on
  the same grid, or caves as a separate, sparse structure hanging off the
  surface zone that contains their entrance. The second is likely cheaper
  (caves are rare; a dense 3D grid would be almost entirely empty) and keeps
  the existing surface macro grid completely untouched.

## The human geo pass

Direct ask, opening a new front: "We also need to do 'human' geo passes to
add human-ness to it all. Like roads and villages and ports and boats and
homes and shrines and shit."

**Read HUMANS_DESIGN.md first.** Direct instruction before building any of
this: "before we do that we gotta go deep into humans design... like history
and motivations and tools and shit." That doc covers what a human actually
is — simulated species vs. authored NPC, generated settlement history,
individual and settlement motivations (which turn out to be the natural
quest generator), and material culture. This section is only the
*placement* half; it assumes that doc's answers.

This is the phase DESIGN.md deferred on purpose — "I think we do need to
simulate human society and stuff but we can do a separate pass for that.
It's after the geological stuff" — now being asked for concretely. The
sequencing it specified still holds: geology first (built), humans layered
on top of an already-coherent world (this).

**It's a macro-grid pass, and the macro grid is already shaped for it.** The
existing generation order in `macroGrid.ts` is elevation → ocean → biome →
rivers → landmarks → territories. Human geo slots in after landmarks, and
`placeLandmarks` is the exact pattern to follow: eligibility-gated, capped,
spaced placement over the zone grid, cheap and deterministic.

What makes this more than another landmark type is that **settlements relate
to each other** — landmarks are independent rolls, roads are a network.

### Settlement siting

Not a flat random roll — humans settle where it makes sense, and every input
that decides that already exists as a per-zone macro fact:

- **Fresh water** — `riverEdges` / `isLake`, already carved.
- **Arable land** — biome (grassland/forest/wetland lean), plus
  `estimateZoneResourceIndex`, which already estimates abundance per zone
  from biome density parameters.
- **Coast access** — `coastEdges`, already computed for every land zone.
  This is exactly what a **port** needs and it's already there.
- **Junctions/defensibility** — `minLandNeighbors` is already a
  `LandmarkDef` concept (Crossroads uses it).
- **Spacing** — settlements shouldn't clump; the greedy min-spacing loop
  `selectMacroRiverSources` already uses for river sources is the same
  shape.

**Tiers fall out of the score rather than being authored**: a well-watered,
fertile, well-connected site becomes a town; a marginal one a hamlet; a
coastal one with a good hinterland a port. That gives a settlement hierarchy
for free instead of hand-tuning three separate placement passes.

### Roads are the genuinely new algorithm

Everything above is a variation on something that exists. Roads aren't:
they're the first *connective* human feature, where rivers are the only
existing connective feature and they're carved by steepest descent (which
is exactly wrong for a road — water goes downhill, roads go where it's
cheap to walk).

The shape, reusing what's already listed in DESIGN.md's own procgen toolbox
("Graph/MST-based anchor placement"):

1. Build a **minimum spanning tree** over settlements, so every settlement
   is reachable and there are no redundant highways — then add a small
   number of extra edges so the network has loops rather than being a
   strict tree (a real road network isn't a tree).
2. Path each edge across the zone grid with a **cost function**, not
   steepest descent: cheap across grassland/beach, expensive across
   highland/jungle/snow, very expensive crossing a river except where a
   bridge/ford is placed (which is itself a nice reason for a landmark),
   impassable across ocean.
3. Mark the zones a road crosses with **`roadEdges`** — deliberately the
   same compass-edge vocabulary `riverEdges` and `coastEdges` already use,
   so road continuity across a zone boundary gets handled by exactly the
   same machinery (and hits exactly the same known gap, see below).

**Sea routes** are the same MST idea over water between ports, which is what
makes ports mechanically distinct from coastal villages rather than just
flavor.

### Per-zone human influence

DESIGN.md's "generation as ordered passes" section already called for a
per-zone "extent of human influence" gradient as part of the life pass. It
falls straight out of this: distance-decay from settlements and roads. One
0..1 number per zone, which then feeds anything that should care — species
density and wariness near towns, what generates when the zone is promoted,
whether a quest even makes sense there.

### Honest flag: roads will hit the river gap

A promoted zone's terrain is biased from macro facts (`biasForZone`), but
that bias currently consumes **only elevation, ocean and biome** — the
macro `riverEdges` facts are recorded and not yet read, which is already a
tracked gap. Roads will hit it identically: the macro grid will say "a road
crosses this zone's north and east edges" and the zone generator won't yet
know how to lay actual road tiles entering at those edges.

That's worth saying plainly because it's an argument for fixing it **once**,
generically: a single "macro edge features → real tiles at the right edge"
mechanism serves rivers, roads and coastlines together. Doing it per-feature
would be three versions of the same thing.

### Boats are not a geo pass

Worth separating: ports are terrain, boats are a **vehicle** — an entity
that carries the player between coastal zones. That's a travel mechanic, not
a generation pass, and it needs its own design (does it move on the macro
map? is there a sea zone to sail through?). Not scoped here beyond noting
it's a different kind of thing than everything else in this section.

## Villages, quests and content

Direct ask, stated as scope rather than spec: "Need to design villages and
quests and content. Lots work." Agreed on both counts — it is the biggest
unstarted piece and it genuinely needs its own design pass, which this doc
deliberately does not attempt.

What's worth recording now, so that pass starts from something:

- **The village is where the campaign's second act lives**, and the human
  geo pass above is what puts villages on the map in the first place. The
  design order is: geo pass first (villages exist as places), then village
  content (what's *in* one), then quests (what you do for them). Doing them
  out of order means designing quests for places with no defined shape.
- **The premise gives quests their frame for free**: "In this world Pokémon
  trainers aren't really a thing as much yet, so no Poké Balls. And you're
  the first to train one, so people ask for your help with lots of things."
  That's a genuinely good quest-giver justification — you're not the chosen
  one, you're the only person with a capability nobody else has.
- **The example quests given are all sim-shaped, not scripted**: "clear out
  Krabby nests by the beach," "collect materials." Both are things the
  existing sim can actually express — a real herd with a real territory in a
  real coastal zone, and real gatherable crops/materials. Worth holding onto
  that property deliberately as the quest design grows: a quest that the sim
  can satisfy emergently is worth more here than a scripted one.
- **Crafting tables at the village** are the progression spine tying Act 1's
  survival crafting to Act 2 — the same crafting system, upgraded, rather
  than a separate village-economy system.

## More moves

Direct ask: "And implement more moves."

Real current numbers, checked rather than remembered: **~35 moves are
actually implemented** as sim mechanics (`packages/data/src/moves.ts`),
against **~951 imported into the move dex** as data
(`packages/data/src/dex/moves.generated.ts`). The dex import deliberately
stopped at "core numeric/categorical fields plus a lightweight tag list...
This does NOT reimplement move battle logic."

So "implement more moves" is well-defined work with a known backlog and a
known ceiling: every move already has canon power/accuracy/type/category
available; what each one *does* beyond damage is the part that needs
building. The existing pipelines to hang them on already exist and are
distinct — hostile hits (`predation.ts`), ally support (`support.ts`), and
self/tile utility effects (`utilityMoves.ts`) — so the work is mostly
picking the next batch of moves and deciding which pipeline each belongs to,
plus adding effect fields the engine doesn't understand yet.

Not scoped further here; see MOVES_DESIGN.md, which owns this thread.

## The dispersal offer — a proposal for the last trust rung (OPEN)

Proposed directly:

> "What if spending enough time around a Pokémon gave you the opportunity to
> have like.. explicit text decisions? That can help solidify bond... it
> essentially comes up to you and triggers a dialog box that sorta lets you
> make some kind of trade (time, resource, food, effort, etc) to get it to
> leave its herd and join you? Probably increased chance if it already wants
> to be herd dispersal or smth."

**Status: not decided.** Recorded here because it fills a placeholder that
has been open since the trust stages were written, and because the sim
turns out to already support most of it.

### Why it isn't actually a new stage

`DESIGN.md`'s trust ladder specifies the last transition as *"a
species-specific bonding moment"* — qualitatively different from the
repeatable verbs, and **undefined** since it was written. This is a shape for
that placeholder, not a fifth thing bolted on.

It also closes the hole found in `PLAYTHROUGH_ACT1_FULL.md` finding 3c:
**Fight alongside** and **Rescue** both require danger layer 1 deliberately
does not contain, so as designed the bond could not complete where it is
meant to be played. A dispersal moment is a **fourth route to Bonded that
needs no predator**, which makes climbing with a partner a choice rather than
the only path.

### The sim already correlates the two — this is a real finding, not a wish

`dispersal.ts` computes, today:

```
dispersalChance = DISPERSAL_BASE_CHANCE (0.3) × (boldness + (1 − sociability))
```

Those are **the same two `effectiveDisposition` axes** that decide which
individual tolerates the player's approach when the rest of the herd bolts.
So the bold, unsociable individual that lets you close to 2 tiles is
*mechanically the same individual* most likely to leave its herd. Nobody
designed that as a bonding hook. It already is one.

`DispersalReason` carries three values — `matured`, `no_eligible_mates`, and
**`isolation`**, documented in `types.ts` as a sustained stretch with nobody
at all to socialise with. A creature that has been alone too long meeting a
human who is alone is pillar 3 without a line of text having to state it.

Also already real: `Agent.dispersalTarget` (where it is walking), and the
`dispersed` `SimEvent`.

### The objection: "trade" is a capture mechanic wearing a coat

Pillar 1 refuses *"any capture mechanic, ever."* Pillar 3 refuses *"a
partner who reads as equipment rather than a relationship."* A dialog that
exchanges time/food/resources for a creature joining you is a purchase, and
a purchase makes the 200 turns spent reading that animal count for less than
whether you happened to be carrying three berries.

The moment is right. **The price list is the part that collides.**

### The proposed shape instead: it is leaving, and you go with it

It is dispersing — `dispersalTarget` set, walking away from its herd, and
that is perceivable before the moment fires (legibility rule: the cause is
visible first). It stops in front of you.

> *It has been watching the dark mouth of the passage all morning. It turns,
> and looks at you, and waits.*
>
> `1. Go with it.`  `2. Stay.`

- **Every listed cost survives.** Going means abandoning your cache, your lit
  chamber, your known ground, and travelling on its schedule. Time, effort
  and resources are all really spent — but **none of it is a price**, because
  nothing is being bought. It leaves either way.
- **You do not recruit it; you follow it.** That is Rescue's mutuality —
  *"the Pokémon chooses you as much as you chose it"* — reached without
  something having to nearly die.
- **Refusal must cost.** It disperses, and that individual is gone. A free
  refusal is not a decision.

### Two doors, not one — the second trigger

Proposed alongside the first, and it makes the system stronger than either
half alone:

> "Maybe if you don't have this incident trigger and just try to leave, if
> you reached a certain threshold of rapport and didn't experience that
> moment, maybe the moment is that the Pokémon follows you with a look of
> concern."

| | Who moves first | Where it fires |
|---|---|---|
| **The disperser** | It is leaving. You go with it. | Mid-run, in the herd's territory |
| **The follower** | You are leaving. It comes after you. | At the exit / a region crossing |

Same underlying condition — the rapport threshold. Which door you get depends
on what actually happened in your run, so **the difference between two
players' bonding moments is a story difference rather than a variant roll.**
That is pillar 2 at no extra cost.

> *You are three steps into the passage when you hear it behind you. It has
> never come this far from the water. It looks at you like you have made a
> mistake.*

**Concern is the precise emotion**, and it matters that it is not *"take me
with you."* It is **"you should not go alone"** — pillar 3 delivered by
behaviour rather than by a line of dialogue explaining the pillar.

**It also de-risks the whole feature.** The measurement below (does dispersal
fire often enough in a layer-1-length run?) stops being blocking: if no
individual disperses, the follower still fires. The measurement becomes
tuning rather than a gate.

#### The dominant-answer problem, and the fix

If the follower always fires at threshold it is **strictly better than the
disperser**: going with a disperser costs your cache, your lit chamber and
travel on its schedule, while waiting for the exit costs nothing because you
were leaving anyway. A player who notices never takes the expensive door
again — the failure mode this project keeps refusing (*"equilibrium and
variety, not a dominant answer"*).

**Fix: the disperser knows where it is going.** It already carries a
`dispersalTarget`, so going with it means **it leads** — into cave you have
not seen. The follower gives you company and no direction. Same bond either
way; different thing gained, and the expensive door buys knowledge of the
cave, which is the scarce resource down there.

#### One armful — what leaving actually costs

> "I think if it asks you to leave you get a chance to grab your stuff from
> your cache maybe."

Right, and it needs a bound or the dominance simply flips: a disperser you
can fully pack for is strictly better than the follower, since you would be
led somewhere *and* keep everything.

The bound is already in the data — **it is walking**, toward its
`dispersalTarget`.

> *It waits at the mouth of the passage. It does not wait long.*

- **One armful.** Enough turns for a single trip to the cache, not enough to
  shuttle back and forth.
- **Carry capacity does the rest.** You choose what the cache was *for*.
- **Its distance is visible**, so the pressure is informed rather than a
  hidden timer (legibility rule).

This is strictly better than "you lose everything," which is a penalty rather
than a decision. *Six units of twenty, right now, while an animal waits* is a
decision. It is also the single most dramatic moment the pouch and pack
upgrades from `CRAFTING_LOOP.md` could possibly pay off in.

The two doors stay balanced:

| | You get | You give up |
|---|---|---|
| **Disperser** | A guide into cave you have not seen | Everything past one armful |
| **Follower** | All your gear, your own schedule | Any idea where you are going |

**Scope flag — the player cache does not exist.** `Tile.cache` is real but it
is a *number*: a food stockpile on "shelter" tiles for `buildsShelter`
agents. There is no items-on-the-ground concept anywhere, so nothing can be
dropped, stashed or found. A cache you can run back to means **adding items
to tiles**, which is genuinely new work — and which also unlocks dropped
loot, another creature raiding your stash, and finding somebody else's.

**Call:** is the cache a real place you chose, or an abstraction?
**Recommend real** — pillar 4 wants you living beside what you did, and a
specific rock you piled your things behind beats a menu. It also makes the
moment play differently depending on where you cached, which is free
variety.

If resources do appear in the moment, the rule that keeps it from being a
shop:

> **The outcome is never bought and never rolled.** It is determined by state
> the player built and could read. Handing over food is the *gesture that
> closes* it, not the payment that causes it.

Deterministic and informed — the same reasoning as no failure rolls in
`CRAFTING_LOOP.md`. A random outcome after a cost is a slot machine, not a
decision.

### The constraint on the text itself — corrected

An earlier draft of this section said the box may describe *what is
happening* but never *what it means*, and gave *"it seems to have chosen
you"* as the forbidden case. **That drew the line in the wrong place**, and
the correction is worth keeping because the reasoning generalises:

> "Except the not telling you it's chosen you. We should be clear ish about
> it or at least give it context and flavor. It looks out to the unexplored
> cave with a kind of yearning in its eyes. Then it stops and looks at you,
> expectantly."

The pillar refuses **dialogue carrying the argument** — a character
explaining that bonds are necessary for survival. It does not refuse the
animal having an interior. *"Yearning in its eyes"* is characterisation;
*"it has chosen you, because no one survives alone"* is thesis. Collapsing
those two into one rule produces austerity, not restraint.

The stricter version also broke a **different** pillar: decisions must be
real and informed. *"Looks at you, expectantly"* is not flavour — it is the
part that tells the player a question is being asked. Withholding it makes
the moment unreadable, which is the worse failure.

**The actual cut:**

| | |
|---|---|
| **In** | What it does, what it wants, how it looks at you. Yearning, concern, expectation. Be clear that a question is being asked |
| **Out** | What it means about the world. No line explains why this matters |

### Open calls

1. **Who initiates** — it comes to you (recommended; that is the mutuality),
   or the player may offer once conditions are met (more agency, more
   shop-like).
2. **Are resources part of it at all**, under the gesture-not-price rule, or
   is it purely commitment and time?
3. **Frequency** — recommend once per individual, ever, refusable, not
   repeatable.
4. **Does refusing lose that individual permanently?** Recommend yes.
5. ~~If you refuse a disperser, can the follower moment fire for that same
   individual?~~ **DECIDED: no.** Refusal is permanent for that individual —
   that was its cost. A *different* individual still can.
6. ~~Do both doors land at Bonded?~~ **DECIDED: both bonded.** The guaranteed
   floor is correct while the bond gates progression; the variety lives in
   which door and which individual, not in whether you got one.
7. **Is the cache a real place or an abstraction?** Recommend real — see
   "One armful" above. Open.

### The measurable risk before this gets built

Trigger 1 is disposition-gated: a fully timid + social agent scores factor 0
and **never** disperses through it. The `no_eligible_mates` and `isolation`
fallbacks are guaranteed but require *sustained* stretches. So the open
empirical question is:

> **How many dispersal events actually fire in a layer-1-sized region over a
> layer-1-length run (~400 turns), across several seeds?**

If the answer is near zero, this path never fires in a real run — the
"unreachable content is a bug" pattern this project has hit repeatedly
(fire that never ignited, moves nothing reached, a landmark that could never
place). **Measure before building.**

## A suggested first slice (recommendation, not a decision)

The project's own established habit is "pick 2-3 pieces, prove the pipeline,
then expand." Applied here, the smallest thing that is genuinely *the game*
rather than a demo of one system:

**One cave layer. One player. One bond.**

- A player agent the sim treats as an ordinary agent (per the fragile-human
  design already decided) with real hunger/thirst — reusing `needs.ts`
  wholesale, not a parallel player-needs system.
- Player-driven turns, on one generated cave layer with a real prey herd, a
  water source, and edible crops — all of which already generate.
- The four bonding verbs wired to the player against the existing `rapport`
  graph, with the Wary → Tolerant → Curious → Bonded stages surfaced
  legibly.
- Escape via a single exit once bonded.

Everything else in the pitch — crafting, equipment, cooking, multiple
layers, tactical commands, predator balance, the village — is deliberately
out of that first slice. Each one is a real follow-up with a real payoff,
and none of them is what makes or breaks whether this is fun. Whether
"earn a partner by reading the ecosystem" actually reads as a puzzle rather
than trial-and-error is the one question that can't be answered on paper,
and it's answerable with exactly the slice above.
