# Player, inventory and equippables

Status: **design proposal, nothing built.** Sits alongside
`PLAYER_MOVEMENT.md` (what a turn is, how you move) and under
`PLAYER_ACTIONS.md` (tactics, coaching, automation).

The ask:

> "we need player and equippables and inventory. need to be able to equip a
> stick to protect yourself a little."

## Correction first: Act 1's opening layer has no predators

I previously asked whether the player can be hunted from turn one. The pitch
already answered it and I hadn't read it closely enough:

> "Layer 1 you stumble across an underground lake or river with lots of
> sunlight and plants. It's **peaceful, prey only**, but herds. You earn
> their trust."

> "The **later layers** have more prey to recruit, **predators who will
> attack you directly**."

You start at the *bottom* of a 5–6 layer cave and escape upward, so layer 1
is the starting layer and it is deliberately safe. That reshapes what
equipment is for at the moment you first find it — see "What the stick is
actually for" below. `DESIGN.md`'s committed player design matters here too:
you are a human, no Poké Balls, no starting gear, no starting fight you can
win, and the player is *"just another agent to the sim"* emitting a **threat
signature** that feeds existing perception logic.

---

## What exists

**Inventory: partially real.** Not zero, which `CAMPAIGN_DESIGN.md`'s
"nothing exists" line slightly undersells.

| Piece | State | Where |
|---|---|---|
| `InventoryItem { itemKey, weight }` | exists | `types.ts` |
| `Agent.inventory?: InventoryItem[]` | exists | `types.ts` |
| Weight-based carry capacity (`maxHp * 1.5`, fallback 8) | exists | `support.ts` |
| Carried weight includes a carried fainted ally | exists | `support.ts` |
| Looting an item off another agent | exists | `support.ts` |
| Item *types* | **one** — `FOOD_ITEM_KEY` | `support.ts` |

So there is a real weight economy with exactly one item in it.

**Equipment: zero.** `grep -rn "equip"` across engine and data returns
nothing at all.

**Threat signature / posture: zero.** Designed in `DESIGN.md` prose,
implemented nowhere.

**Not the answer:** `packages/data/src/dex/items.generated.ts` has ~30
curated entries (Choice Band, etc.). Those are Pokémon *held* items for
damage math, explicitly "not wired into combat.ts" — a different system from
human equipment. Don't conflate them.

---

## The design

### Items are definitions in data; inventory holds references

Keep `InventoryItem` as a light stack reference and put the real definition
in `packages/data`:

```
ItemDef {
  key, name, weight,
  slot?: "held" | "worn",     // absent = not equippable
  grantsMoves?: MoveSpec[],   // equipment gives you verbs
  statMods?: { defense?, speed?, ... },
  threatMod?: number,         // see below
}
```

Weight then comes from the definition rather than being copied per stack,
and the existing carry economy keeps working unchanged.

### Two slots. That's all.

The pitch names exactly two things — *"armor (more stylish clothes
basically) and a large stick"* — so: **held** and **worn**. Resisting a
six-slot RPG paper doll is the whole discipline here; `PLAYER_ACTIONS.md`
already argues that items must be *verbs you don't have yet*, not stat
sticks, and two slots enforces that by construction.

### Equipment grants moves

**Decided, and it's now an architecture rather than a convenience — see
`MOVES_AND_TOOLS.md`.** A move is an effect; a Pokémon reaches it through its
body and a human through a tool. `grantsMoves` points at real `MoveSpec`s,
and a tool always delivers a *slice* of a move rather than the whole thing.

The pitch lists the player's moves as *"punch or kick, or swing or yell"* —
and **swing is what a stick gives you.** That's the model:

| State | Moves available |
|---|---|
| Bare hands | `punch` (weak, range 1), `kick`, `yell` (utility) |
| Stick held | adds `swing` — real damage, still range 1 |
| Armor worn | no moves; defense up, **Speed down** |

Armor costing Speed is free and already meaningful: `actionSpeedOf` feeds
the energy scheduler, so heavier protection literally means **you act less
often**. A legible, diegetic tradeoff with no new system behind it.

### The idea that makes equipment interesting here: threat signature

`DESIGN.md` already commits to the player emitting a threat signature —
speed, distance, posture (standing vs. crouched) — that feeds "the same
perception logic that already decides whether an agent flees, ignores, or
reacts to anything else."

**Equipment should feed that signature.** A visible weapon makes you read as
dangerous:

- Prey flee sooner and from further away.
- Bonding is harder — the Act 1 arc is *earning trust*, and you are holding
  a club.

The hook point is real and specific: `predation.ts`'s `FLEE_DETECT_RADIUS`
(4, modified by `effectiveDisposition`'s boldness, floored at
`FLEE_RADIUS_FLOOR` = 2). Concealment already modifies exactly this radius,
so there is precedent for a modifier feeding it. Threat signature is another
term on the same number.

Why this is the right design and not just flavour:

- It puts the cost of power on **the axis Act 1 is actually about.** The
  layer is peaceful and prey-only; the thing you can lose there is trust,
  not blood.
- It is `NARRATIVE_PILLARS.md`'s fourth pillar — *"all that you change,
  changes you"* — as a mechanic rather than a theme. Take up a weapon and
  the world treats you as a thing that carries one.
- It refuses the dominator fantasy the myth research kept praising the
  absence of. You cannot simply arm your way through the bonding arc.

### Held vs. stowed — the decision this creates

Equipment shouldn't be a one-time choice made in a menu. Make it a live one:

| State | Effect |
|---|---|
| **Held** | Moves available immediately; full threat signature |
| **Stowed** | No threat penalty; costs a turn to draw |

One button, and a real recurring decision every time you meet something:
walk up to that Eevee herd holding a club, or stow it and be a turn slower
if you were wrong. That is a genuinely informed choice with a legible cost
on both sides — exactly what *"being informed about what decisions you're
making is important"* asks for, and it's the answer to "what is the stick
for on a layer with no predators."

### What the stick is actually for

On layer 1: mostly *not* combat. It is the thing you find, and the first
real tension — carrying it costs you trust in the one place trust is the
objective. Its combat value arrives in the later layers where the pitch puts
the predators. Finding it early and paying for it socially before it ever
saves you is a better arc than finding it exactly when it becomes useful.

---

## First item set (small on purpose)

| Item | Slot | Effect |
|---|---|---|
| Large stick | held | grants `swing`; notable threat signature |
| Clothes / armor | worn | +defense, −Speed (fewer actions) |
| Herbs | — | crafting input; `herbs` is already a real crop id in `crops.ts` |
| Food | — | already exists (`FOOD_ITEM_KEY`) |
| Torch | held | light radius (feeds `computeVisible`'s darkness penalty) — **and raises your own detection radius to everything else**; see the pillar-1 test below |

Five entries. Everything else in the pitch — fishing rod, TMs, stones,
bigger backpack — layers on without changing the model. A bigger backpack is
just a carry-capacity modifier over the existing weight economy.

---

---

## Running the refusal tests against this design

`NARRATIVE_PILLARS.md` says a pillar that never causes a rejection "isn't a
pillar, it's a mood." So, applied properly — three of these changed the
design above rather than endorsing it.

### Pillar 1 refuses "any human capability with no ecological cost attached"

The stick pays (threat signature) and armor pays (Speed, so fewer actions).
**The torch as I first wrote it doesn't pay, and that's a miss.** A light
source in a dark cave is the most visible thing in the world. It should
*raise your detection radius to everything else* — you see further and you
are seen further. That is a better mechanic than the free one I proposed,
and `computeVisible` already has the darkness term to hang it on.

Standing rule for every future item: **name the ecological cost or it
doesn't ship.** A bigger backpack costs carried weight and therefore Speed.
A fishing rod ties you to water. Nothing is pure upside.

### Pillar 3 refuses "any moment where the player succeeds alone at something that mattered"

This is the sharpest constraint on equipment and it gives a hard, testable
power ceiling:

> **If a player can clear Act 1 with good equipment and no partner, the
> equipment is too strong.**

Gear must make solitude *survivable*, never *sufficient*. The pillar says
solitude is "endured, not mastered" and that bonding is "the mechanic that
makes progress possible, not a reward for having already succeeded alone."
`HUMANS_DESIGN.md` independently agrees on the item itself — *"a large
stick — the whole point is that it's barely a weapon."*

That's checkable in playtest rather than a matter of taste, which is what
makes it a real test.

### Pillar 4 refuses "any player-facing identity choice that's a costless menu pick"

**An equipment-slot screen is very nearly a class-selection menu**, and I
didn't catch that when proposing it. "Am I a stick person or an armor
person" becomes a costless pick if gear is freely swappable — exactly what
the pillar rejects, and it's the pillar's own stated rule that there is
"no class selection, only accreted identity."

The resolution, and it's already built: `notables.ts` earns titles from real
accumulated stats. So **identity accretes from use, not from the slot.**
Carrying a stick makes you a person carrying a stick. Swinging it a thousand
times makes you something, and the game should notice *that*, not the
loadout. Equipment stays a tactical choice; who you become is downstream of
what you actually did with it.

### What the myth structures demand of the player's violence

`MYTH_STRUCTURES.md`'s central finding is that every violent myth in the
corpus is a harvest rule — and specifically that **the transgression is
excess and mutilation, not hunting.** Killing to eat is permitted; killing
beyond need is the sin (The Trial, The Original Sin).

It also names the trigger it wants from our data: *"a settlement (or the
player) whose recorded history includes killing far beyond consumption in a
territory."*

So the equipment system's real long-term hook is not a morality prompt at
the moment of the kill. It is:

> **The chronicle counts kills against food actually taken. The world draws
> its own conclusions.**

No meter, no dialogue, no choice popup. A pattern accumulates and the world
responds — prey warier in that territory, a settlement's attitude shifting,
eventually a generated myth about you. This is the correct form of the
"harvest respectfully vs. take the meat" idea that was rightly rejected
earlier: **the unit is the pattern, not the instance**, and nothing ever
asks you to choose at the moment you're least informed.

It also satisfies the hardest discipline in the pillars — *"let the systems
make the argument, never the dialogue."* No NPC ever explains that carrying
a club makes Pokémon skittish. You watch them flee sooner and you work it
out.

### Armor is social, not just physical

`HUMANS_DESIGN.md`: armor *"reads as social status as much as protection."*
So the worn slot should eventually feed how **humans** react to you in Act 2,
against the reverent / fearful / pragmatic attitude axis — a fearful village
reads an armed stranger very differently from a reverent one. Same
signature idea, different audience. Nothing to build now; worth not
designing it out.

### One tension the pillars raise and don't resolve

`DESIGN.md` says *"fragility has to bite — a misread on a predator is a real
injury, not a redo."* But `NARRATIVE_PILLARS.md`'s own "omission is a claim
too" section lists **injury that doesn't heal** as currently unmodelled by
default rather than by decision.

If all damage heals, fragility doesn't actually bite; injury is just a timer.
Equipment sharpens this rather than causing it — armor is only meaningful
against a consequence that persists. Flagged as a real open question rather
than silently assumed either way.

## Honest gaps

- **Threat signature is genuinely new.** The design exists in prose; the
  implementation and the perception hook do not. It is the only real new
  system here.
- **`carryCapacityOf` is `maxHp * 1.5`.** For a frail human that's a small
  number, which is thematically right but needs a real measurement rather
  than a guess about whether it's playable.
- **No item spawning.** Nothing places items in a world today. Loot on the
  floor, in landmarks, and on corpses all need doing — corpse looting is the
  one path that already exists.
- **`InventoryItem` has no stack count**, just a weight. Ten berries are ten
  entries. Fine at this scale, worth knowing.
- **Bonding tolerance doesn't exist yet**, so threat signature initially has
  only the flee-radius hook to feed. The trust-stage machine
  (Wary → Tolerant → Curious → Bonded) is still unbuilt.

## Open questions

1. Does armor's Speed penalty apply to the **energy economy** (fewer turns —
   my recommendation, it's free and legible) or only to fleeing?
2. Can the player equip anything found, or does armor need to fit? (Recommend
   no fitting rules — pure friction.)
3. Does a stowed weapon still read to a Pokémon that already saw you holding
   it? A memory would be more truthful and much more work.
4. Do Pokémon partners use the item system at all, or is it player-only for
   now? (Recommend player-only; held items are a separate rabbit hole.)
5. Is `yell` a real utility move with a mechanical effect (scattering prey,
   drawing a predator off your partner) or just flavour? `utilityMoves.ts`
   exists and could carry it.
