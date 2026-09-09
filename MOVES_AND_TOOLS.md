# Moves and tools are one system

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

### Which is also the biggest risk in this document

`igniteNear` is **already on the live hit path**. Fire already spreads and
consumes fuel. Generalising terrain effects across a wide move roster and a
widened species roster could strip or burn the world, and the failure mode is
the one this project keeps hitting: a feedback loop nobody predicted, only
visible in a multi-thousand-tick run.

**This is unmeasured.** Before the vocabulary is generalised, count terrain
changes per 1000 ticks by cause, across seeds — the same shape as every other
validation script here. If a mature roster is stripping bushes and burning
forest faster than `flora.ts` regrows it, that's a balance problem to find
now rather than after twenty moves are written against it.

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
4. **Tag which moves are tool-reachable.** Not everything should be —
   Flamethrower shouldn't have a hand-held equivalent.

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
