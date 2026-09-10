# Moves and tools are one system

**Status: direction decided, specifics open.** Confirmed directly — *"Yes.
I'm fairly confident about the items as moves direction."* The architecture
below is the one to build against; the field shapes, the exact per-move
slices, and the balance numbers are still to be worked out, and the terrain
measurement under "the biggest risk" is still outstanding.

## Decided

1. **Items and moves share one effect vocabulary.** A move is an effect; a
   Pokémon reaches it through its body, a human through a tool. Not two
   systems that resemble each other — one system with three delivery
   mechanisms (innate, tool-granted, consumable).
2. **A tool is a slice of a move, never the whole move.** Cut damages, fells
   and clears; an axe only fells, a machete only clears, a knife only does
   the damage slice. This is what makes pillar 3 structural instead of a
   tuning problem.
3. **Consumables are borrowed moves.** A smoke bomb fires Smokescreen
   without knowing it.
4. **The player's loadout is their moveset.** No separate ability screen.
5. **Tool-reachability rule:** can a human reproduce the effect with
   materials and technique, or does it require being the creature?
   Flamethrower yes, as a weak and self-endangering slice. Ice Beam and
   Dragon Rage no.
6. **The unreachable set is load-bearing and stays closed.** It is the
   mechanical reason a partner is necessary. Act 2's smithing tier upgrades
   slices; it never opens that column.
7. **Raft is Act 2.**

## Still open

- The generalised terrain-effect field shape — the moves agent's call; the
  ask is in "What the moves agent needs from this" below.
- Whether a tool-granted move can ever become permanently known.
- Throw range for consumables.
- Whether a partner can use tools (recommendation: no).
- ~~Unmeasured: terrain change before the vocabulary is widened.~~
  **Measured — there is headroom.** Vegetation grew 11.8% over 4 seeds x
  6000 ticks; fire produced zero events. See "The risk, now measured".

---

The idea, as given:

> "consumable items that sorta mimic moves that Pokémon use would be really
> cool... you could use cut to cut down a tree and gather wood, but you could
> also use an axe. Cut can also clear foliage to speed you up or clear
> concealed Pokemon out, but a machete can do that too. Smoke bombs could do
> what smoke screen does; a knife behaves similarly to scratch and gives you
> scratch and maybe slash as available moves."

Yes. And it's bigger than an item list — it's the architecture that makes the
player and the simulation share one vocabulary instead of running two.

> **A move is an effect. A Pokémon reaches it through its body. A human
> reaches it through a tool.**

This doc is the **interface spec** between the moves work (in progress,
separate agent, see `MOVES_DESIGN.md`) and the item work
(`ITEM_CATALOGUE.md`, `CRAFTING_DESIGN.md`), so the two converge instead of
building parallel systems.

---

## This is generalizing an existing pattern, not adding one

Moves already modify the world in **five** distinct ways today:

| Field / call | What it does | Where |
|---|---|---|
| `terrainBurn` | A landed hit reverts a `bush` tile to floor — *"stripping its concealment for good — a real terrain interaction, not cosmetic"* | `moves.ts` |
| `terrainFill` | Converts the defender's tile to a terrain kind (Water Gun leaving a puddle) | `moves.ts` |
| `consumesOwnTerrain` | The attacker's own tile is spent for a damage bonus | `moves.ts` |
| `igniteNear` | Fire moves set real, spreading fire terrain **on the live hit path** | `predation.ts` |
| fertility bump | A utility move raises `fertility` in a radius | `utilityMoves.ts` |

And the curated roster already uses them — `terrainBurn` and
`consumesOwnTerrain` appear in real skill-tree nodes in
`packages/data/src/moves.ts`.

So terrain-affecting moves aren't speculative. What's missing is that the
effects are **ad hoc** (one boolean for bush→floor, one struct for fill) and
**unreachable by items**.

## And it's the inversion of a finding already in `MOVES_DESIGN.md`

That doc's Round Four already identified HMs as the precedent for
"a non-combat move that changes the map" — Cut, Surf, Strength, Flash,
Rock Smash, Waterfall.

But HMs are **Pokémon-as-key**: the creature is the tool, and the door opens
because you brought the right species. This proposal is the mirror image:

> **The tool is the key, and the human made it.**

Which is exactly pillar 1 — *"the difference is of practice, not of kind."* A
Scyther has Cut in its arms. You knapped a blade. Same effect, different
route, neither species special. That's the thesis as an architecture rather
than a sentiment, and it's the strongest justification this project has for
having a crafting system at all.

---

## The architecture: one vocabulary, three deliveries

Every effect is described **once**, on a `MoveSpec`. Three things can deliver
it:

| Delivery | Who | Example |
|---|---|---|
| **Innate move** | A Pokémon knows it | Scyther knows Cut |
| **Tool-granted** | Held item grants it while equipped | Axe grants a fell-only Cut |
| **Consumable** | One-shot; fires the effect without knowing the move | Smoke bomb fires Smokescreen |

`ItemDef.grantsMoves` (already proposed in `PLAYER_INVENTORY.md`) is the
first; a `consumableMove` field is the third.

**The player's moveset becomes their loadout**, which is a genuinely tidy UX
answer to "what moves does a human have":

```
bare hands        punch · kick · yell
+ flint knife     scratch · slash
+ axe             cut (fell)
+ spear           a reach-2 thrust
+ smoke bomb      throwable, one use
```

Readable, diegetic, and it makes equipment choices legible in combat terms
without a separate ability screen.

## The balance rule: a move is the whole effect; a tool is a slice of it

This is the rule that makes the whole thing safe, and it fell out of the
examples in the ask itself.

**Cut**, as a move, does three things: damages, fells trees, clears foliage.
The tools each take *one* slice:

| | Damage | Fell trees | Clear foliage |
|---|---|---|---|
| **Cut** (move) | ✓ | ✓ | ✓ |
| Axe | — | ✓ | — |
| Machete | — | — | ✓ |
| Flint knife | ✓ (as Scratch) | — | — |

Three items to cover what one move does, and none of them is the move.

This satisfies pillar 3 (*"nothing craftable is sufficient"*) **structurally
rather than by tuning**. A player can never out-tool a Pokémon into
irrelevance, because no tool is ever the whole effect — and the partner
remains the only thing that brings the complete version.

Supporting levers, in order of preference:
1. **Narrower** — the slice rule above. Always try this first.
2. **Consumable** — a smoke bomb is one use; Koffing does it every fight.
3. **Slower** — higher `cooldownTicks` on the tool-granted version.

---

## Worked table

| Move | Effect | Tool equivalent | Which slice |
|---|---|---|---|
| **Cut** | Damage; fell `tree`; clear `bush`/flora | Axe / machete / knife | One each |
| **Scratch / Slash** | Light physical | Flint knife | The damage slice, weaker |
| **Smokescreen** | Vision/accuracy denial in an area | **Smoke bomb** (consumable) | One use, no accuracy debuff |
| **Ember** | Damage + ignite terrain | Firestarter (consumable) | Ignite only, no damage |
| **Flash** | Widen own FOV; lower target accuracy | Torch | FOV only — and unlike Flash it makes *you* visible |
| **Dig** | Tunnel / temporary invulnerability | Pick | Tunnel only, slow, no invulnerability |
| **Strength** | Push a boulder into passable rubble | Pick / lever | Slower, needs several turns |
| **Rock Smash** | Break rock | Pick | Same slice, slower |
| **Surf / Whirlpool** | Cross deep water | **Raft** *(Act 2)* | Crossing only, no combat use |
| **Sweet Scent** | Draw wild agents toward you | Lure / bait | Weaker radius |
| **Growl / Leer** | Lower a target's aggression or defence | Whistle / call | Scatter or draw, no stat effect |

`MOVES_DESIGN.md` Round Four already specced the field behaviour of Cut,
Surf, Strength, Flash, Rock Smash and Waterfall. **Those specs are the
source of truth; the tool column is a slice of whatever they land on.**

---

## The reverse direction — the genuinely exciting part

If environmental move effects are general, then **wild Pokémon reshape the
world too.** Not as a feature added for them — as a consequence of the same
vocabulary.

- A Scyther clears foliage where it hunts.
- Fire types leave burn scars; `fire.ts` already spreads.
- Diggers open tunnels (`MOVES_DESIGN.md` already has "Diglett tunnel
  networks" confirmed for later).
- Water types leave puddles that raise local `fertility`.

Over a long run, **the map records what lived there** — which is pillar 4
("the land remembers") arriving without being designed for, and it's the kind
of emergent history the chronicle exists to narrate.

### The risk, now measured — and there is headroom

The worry was: if moves fell trees and start fires, thousands of agents doing
that forever could strip the world bare. `igniteNear` is already on the live
hit path and fire already spreads, so this could in principle be happening
today.

**Measured** (`validateTerrainChurn.ts`, 4 seeds x 6000 ticks). The answer is
the opposite of the worry:

| Vegetation tiles (tree/bush/flora/food/seedling) | |
|---|---|
| Start | 1300 |
| End | **1453** |
| Change | **+11.8%** |

The world is **mildly overgrowing**, not stripping. Regrowth currently
outpaces everything consuming it. Net stock: `flora` +512, `seedling` +70,
against `food` −429 — plants cycling between states with vegetation up
overall.

Two further findings from the same run:

- **Fire never happens.** Zero `cause: "fire"` terrain changes in 24,000
  agent-ticks. The whole fire system — spread, fuel, burn-out, DoT — produced
  nothing. So the "fire is already live on the hit path" risk is currently
  **inert**, and by this project's own standard ("unreachable content is a
  bug") that is worth a look on its own.
- **Churn is dominated by seasons.** Freeze 72/1k ticks and thaw 63/1k are
  the top two causes by a wide margin — that's just the ice cycle working.
  Drought and rain are single digits.

**What this means for the direction:** there is real headroom. Adding
tree-felling, brush-clearing and fire-starting moves will not strip a world
that is currently regrowing faster than it is consumed. Re-run this script
after the move roster widens and watch the vegetation percentage — if it goes
negative, that's the signal to tune.

**Caveat on the instrument:** `terrainBurn` and `terrainFill` don't log
`terrainChanged`, so they're invisible in the flow table and only show up in
the stock comparison. Worth fixing before using flow numbers to tune.

### And it has to be legible

Per `NARRATIVE_PILLARS.md`'s legibility rule: a burned clearing means nothing
if the player can't tell what burned it. The chronicle already records
`terrainChanged` with a `cause` field (weather.ts uses `"freeze"`/`"thaw"`),
so extending that to name the agent is the cheap version.

---

## What the moves agent needs from this

The concrete asks, so the two workstreams meet:

1. **Generalise the terrain effect.** Today's `terrainBurn` (a boolean for
   one transition) and `terrainFill` (a kind) should become one field —
   roughly `{ from?: TerrainKind[]; to: TerrainKind; yields?: itemKey }` —
   so "Cut fells a `tree` and yields timber" is expressible without a new
   boolean per move. `terrainBurn` becomes the bush→floor case of it.
2. **`yields` is the crafting hook.** A terrain effect that drops a material
   is what connects moves to `CRAFTING_DESIGN.md` at all. Without it, a
   Pokémon felling a tree produces nothing.
3. **Keep effects declarative on `MoveSpec`.** If an item can point at a
   move id and get its effect, tools cost nearly nothing to add. If effects
   are hardcoded per move in `predation.ts`, every tool is bespoke work.
4. **Tag which moves are tool-reachable**, using the rule in "Which moves
   are tool-reachable" below: can a human reproduce the effect with
   materials and technique, or does it require being the creature? Fire and
   thrown stone yes; Ice Beam and Dragon Rage no. The unreachable set is
   load-bearing — it's what the partner is for.

---

## Which moves are tool-reachable

Corrected from an earlier line in this doc that said Flamethrower shouldn't
have a hand-held equivalent:

> "Flamethrower could be. Dragon rage or ice beam, probably not."

Right — and the difference between those three is a rule, not a judgement
call. The question isn't how *strong* a move is. It's:

> **Can a human reproduce the effect with materials and technique, or does
> it require being the creature?**

- **Flamethrower** — directed fire. People have built fire-projecting things
  for millennia: burning pitch, a bellows, resin through a tube. Squarely
  inside `HUMANS_DESIGN.md`'s pre-industrial ladder.
- **Ice Beam** — projecting cold. There is no arrangement of wood, stone,
  fibre and hide that fires cold at something. Cold isn't a substance you
  can throw.
- **Dragon Rage** — not a material phenomenon at all. It's an expression of
  what the creature *is*.

### The gradient

Not binary — most of the interesting cases are the middle row.

| | Examples | Why |
|---|---|---|
| **Reachable** | Cut, Scratch, Tackle, Ember, Rock Throw, Dig, Smokescreen, String Shot, Flash, Poison Sting | Blade, club, fire, thrown stone, spade, smoke, net, torch, harvested venom |
| **Reachable as a weak slice** | **Flamethrower**, Water Gun, Vine Whip, Bulldoze | Real devices exist, but crude: short range, consumable fuel, slow, and dangerous to the user |
| **Not reachable** | Ice Beam, Dragon Rage, Thunderbolt, Psychic, Shadow Ball, Moonblast | Requires an organ, a nature, or a force outside the tech ladder |

**A human Flamethrower should be genuinely dangerous to hold.** Short range,
limited fuel, and it ignites terrain — including the tile you're standing on,
via the `fire.ts` spread that already exists. That's the pillar-1 cost the
slice rule asks for, and it's the difference between a fire-lance and a
Charmeleon: the Charmeleon is never in danger from its own breath.

### Roughly by type

Types are a decent proxy, though the line doesn't follow them exactly:

- **Mostly reachable** — Normal, Rock, Ground, Fighting, Poison, Bug
  (technique, stone, earth, venom, cordage and nets)
- **Partially** — Fire, Water, Grass, Dark (fire yes; moving an ocean no;
  a whip yes, growing a vine no; a dirty trick or a shout yes)
- **Not reachable** — Electric, Ice, Psychic, Ghost, Dragon, Fairy

### The payoff, and it's the best part

**The moves a human can't reach are exactly why you need a partner.**

You can make fire, throw stones, cut, dig, snare, poison and hide. You will
never call lightning, freeze a lake, or do whatever a Dragon does. Those
aren't gated behind a level or a quest — they're gated behind *not being that
thing*, permanently.

That is pillar 3 — the rugged individual is a myth — expressed through the
move list itself, with no dialogue and no scripting. The partner's
irreplaceable contribution is defined by the shape of what tools can't do.
And it means the unreachable list should stay genuinely unreachable: every
move that gets a hand-held equivalent is one less reason to need somebody.

### Act 2 raises the ceiling, slightly

The tech ladder moves: a smithing settlement means metal, and metal means a
bow, better edges, maybe a real fire-lance. So a few moves cross from
"weak slice" to "solid slice" — but **nothing crosses out of the unreachable
column**, because that column is defined by physics and nature rather than by
craftsmanship. The pre-industrial ceiling is deliberate.


---

## What every equippable actually grants

The `grantsMoves` table, concrete. Direct framing: *"how knife gives you
scratch and maybe machete gives you cut and slash. Like shield can give you
defense curl type thing."*

**Your loadout is your moveset.** Nothing else decides what a human can do.

| Held | Grants | Slices | How the tool version is worse |
|---|---|---|---|
| *(bare hands)* | **Tackle** | Tackle | Built simpler than the original Punch/Kick/Yell sketch — direct correction, "Tackle\*": an empty-handed human still tackles. Punch/Kick/Yell as their own distinct moves is unbuilt future work |
| **Flint knife** | **Scratch** | Scratch | Fast and light, but it's a short blade — no reach |
| **Obsidian knife** | **Scratch** *(high crit)* | Scratch | Sharper edge, same reach |
| **Machete** | **Cut · Slash** | Cut · Slash | Cut **clears foliage only** — it can't fell a tree. Slash is slower than a claw |
| **Axe** | **Cut · Chop** | Cut · Karate Chop | Cut **fells only** — it's the wrong tool for brush. Slow to swing |
| **Pick** | **Rock Smash · Dig** | Rock Smash · Dig | Dig **tunnels only** — none of Dig's dodge-underground trick |
| **Club** | **Pound** | Pound | Direct correction, mid-build: "Club should not be body slam... Maybe pound?" — a plain swing, not a full-body slam |
| **Spear** | **Thrust** *(reach 2)* | Horn Attack | The only reach you get. Heavy; high threat signature |
| **Sling** | **Sling Stone** *(ranged)* | Rock Throw | Weaker than a thrown rock from something strong. Noisy |
| **Shield** | **Brace** | Defense Curl | Raises defence for a turn — and **costs you the held slot**, so you can't brace and swing |
| **Torch** | **Flash** *(passive)* · **Brandish** | Flash · Scary Face | Brandish pushes something back a tile; no stat drop |
| **Digging stick** | **Dig** *(slow)* | Dig | Slower than a pick, softer ground only |
| **Sickle** | **Scratch** *(weak)* | Scratch | It's a harvesting tool that happens to have an edge |
| **Bow** *(Act 2)* | **Arrow Shot** | Pin Missile | Real range, but it needs arrows |
| **Fire-lance** *(Act 2)* | **Scorch** | Flamethrower | Short range, limited fuel, **ignites your own tile** |

| Worn | Grants | Slices | Note |
|---|---|---|---|
| **Camouflage cloak** | **Conceal** | Camouflage | Only works while you're **stationary** — move and you're visible again |
| **Hide armor · chitin scale · woven wrap** | *(passive)* | — | Defence and a Speed cost. No move |
| **Fur cloak · rain hood · snowshoes** | *(passive)* | — | Weather and terrain mitigation. No move |

### The knife/machete/axe split is the slice rule at its clearest

**Cut**, as a real move, does three things: damages, fells trees, clears
foliage. Three tools split it and **no tool gets all three**:

- **Knife** takes the damage slice, as Scratch.
- **Machete** takes the clearing slice, plus Slash.
- **Axe** takes the felling slice, plus Chop.

So a player carrying all three still hasn't got Cut — they've got three
partial answers, each occupying the held slot, each with its own weight. The
complete move stays something only a creature brings, which is pillar 3
holding structurally rather than by tuning.

### The numeric rule — reversed

~~A tool-granted move should sit at roughly 60–70% of the creature version's
power with 1.5–2× the cooldown.~~ **Overruled, direct ask:** *"If you have a
tool, the move it grants, it should not be weakened. Just make it a normal
vanilla move."* A held item now grants the exact same base move a real
Pokémon knows — no power or cooldown tax. The slice rule above (which move,
and how much of its effect) is the entire balance lever; a partial, worse
copy of the same move on top of it was double-counting the same protection.
If this ever reads as *too* strong in a real run, that is a finding to
bring back here, not something to quietly retune.

### Shield is the interesting one

`Brace` costs the **held slot**. You cannot brace and swing — putting up a
shield means putting down your weapon, every turn, as a live decision.

That's a much better shield than a passive defence bonus, and it's another
instance of the pattern that keeps recurring in this design: **the
interesting version of an item is the one that takes something away.**

## Open questions

1. **Does a tool-granted move count as the player "knowing" it** for
   progression/skill trees, or is it purely conditional on holding the item?
   Recommend conditional — it keeps identity accreting from use, not gear.
2. **Can the player's partner use tools?** Recommend no — pillar 3 refuses a
   partner that reads as equipment.
3. **Do consumables need line of sight / a throw range**, or do they apply
   at the user's tile? Throwing is much more interesting and needs a range
   band.
4. **Should tools be able to *teach*?** Carrying a knife for a long time
   granting Scratch permanently is a nice accretion story, and a slippery
   slope toward gear-as-class.
