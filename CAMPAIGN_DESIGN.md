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
