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

## Real tensions worth deciding early, not discovering late

Not resolving these here on purpose — they're the user's calls, and they're
cheap to decide now and expensive to reverse later.

1. **How much of the cave is simulated vs. authored?** The sim's whole value
   is emergent ecology; a 5-6 layer escape sequence is the most level-like,
   most authored thing this project has ever proposed. The pitch mostly
   threads this well (layer 1 is a real ecosystem with herds, water and
   plants, not a corridor), but "layer 4 always has the stone" and "the
   ecosystem decides what's here" pull in opposite directions and the ratio
   should be picked deliberately.
2. **Tick model vs. turn model** (see above). My instinct: turn-based for
   the player's own actions with the world stepping per action, because
   "traditional roguelike" and a fragile-human fantasy both want you to be
   able to *stop and think* — but that makes the existing continuous-tick
   observer view a second, different mode rather than the same one.
3. **Three overlapping spatial concepts now: layer, zone, Z-level.** The
   pitch's "layers bigger than our zones, 2 or 3 of em together" needs
   reconciling with `Layer` (the three-value enum) and with the macro grid's
   zone promotion. These are three different things currently wearing
   similar names.
4. **Scale of the ask.** This is three acts of a full game. It is worth
   saying plainly that Act 1 alone is larger than any feature this project
   has shipped so far, and Act 2 is larger again.

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
