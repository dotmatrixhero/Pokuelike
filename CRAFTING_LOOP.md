# The crafting loop: the moment-to-moment

`CRAFTING_DESIGN.md` covers materials, harvesting and rules.
`ITEM_CATALOGUE.md` lists what exists. **This is the part the player touches**
— where you craft, what you press, how you learn a recipe, how long it takes,
and what the screen shows.

Written because of a correct principle:

> "I think we need crafting more fleshed out. Its a core system. Unlike the
> Sim stuff player facing interactive systems need to be really fleshed out."

Right. A sim system can be tuned emergently after it runs; a player-facing
loop that's half-designed feels bad immediately and is expensive to rework
once content is built against it.

---

## Where crafting happens — three tiers, no menus in the field

| Tier | Where | What |
|---|---|---|
| **In hand** | Anywhere, any time | Bindings and lashing: fiber, cordage, torch, snare, poultice |
| **At a fire** | Standing on/next to `fire` terrain | Anything needing heat: clay vessels, roasting, drying rations |
| **At a station** | Act 2 village | Better tiers of the same ladder |

Fire is already real terrain, so "at a fire" needs no new object — you make a
fire (firestarter, or a lit campsite) and stand by it. That means **the
campfire is the first crafting station and you build it yourself**, which is
a much better first-hour beat than finding a workbench.

## The interaction: crafting is a time-spend, not a new mode

Crafting reuses the Tier-2 structure from `PLAYER_ACTIONS.md` rather than
adding a separate interaction mode. It's the same shape as search, forage and
rest:

1. Choose **craft**.
2. Pick from the list of things you know how to make.
3. It runs for N turns, **interruptible** — the world keeps moving.

No separate crafting screen you stand frozen in front of. You are sitting in
a cave twisting fiber while things move around you, and if something walks in
you stop.

**Interruption rule:** you lose the turns spent, not the materials. Nothing is
consumed until the item completes. Losing a bundle of fiber because a Rattata
walked past would be pure punishment.

### Time costs

Proportional to what's being made, in the same order as everything else:

| | Turns |
|---|---|
| Cordage, fiber | 2–3 |
| Torch, snare, poultice | 5 |
| Hafted tool (knife, axe, spear) | 10–12 |
| Anything at a fire | 20+ |

The point of the numbers isn't the numbers — it's that **crafting costs real
time in a world that keeps running**, so *where* and *when* you stop to make
something is a decision. Making a spear in the open is different from making
one in a shelter.

## The recipe list shows only what you know

Per `PLAYER_ACTIONS.md`'s rule: **no greyed-out list of things you can't
make yet.** Unknown recipes don't exist in the UI at all.

What the list does show, for recipes you know:

```
  CRAFT                                    you carry 11 / 26

  ✔ Cordage          fiber ×2                        3 turns
  ✔ Torch            deadwood + fiber                5 turns
  ✗ Flint knife      bound haft + knapped flint     12 turns
      you have no knapped flint
  ✗ Poultice         herbs + lichen                  5 turns
      you have no herbs
```

Knowing a recipe and being able to make it are different states, and the
second one is genuinely useful information — *"I know how to make a knife, I
need flint"* is a goal. **That's the shopping list that drives exploration**,
and it's why known-but-unmakeable recipes stay visible while unknown ones
don't.

## Learning recipes: examine the thing

The mechanic I'd argue hardest for, because it makes three existing systems
pay off at once.

> **Examining a crafted item teaches you how to make it.**

You find a coil of cordage in a cave cache. You look at it — a free action —
and the game tells you what it is: *plant fiber, twisted.* Now you know the
recipe.

Why this is the right answer:

- **It makes looting teach you**, so finding an item is interesting even when
  you don't need it.
- **It makes examining valuable.** Free look is already a rule; this gives it
  a second job beyond identifying creatures.
- **It's diegetic reverse-engineering.** Nobody hands you a recipe book; you
  work out how a thing was made by looking at it. Exactly the "read the world"
  skill the bonding arc trains.
- **It reuses the knowledge system** designed for species — same mask over
  data, different subject.

Knowing ≠ being able to make. Examining a bronze axe in Act 2 teaches the
recipe; you still need ore, a smith's fire and the tools. The recipe appears
in your list with everything you lack spelled out — which is a *quest*, not a
lockout.

The other three routes stay: **a few known innately** (you are a human,
tying a stick to a stone is not a discovery), **taught by people** in Act 2,
and **written recipes** as loot.

## Quantities and inventory pressure — the real numbers

`carryCapacityOf` is `maxHp × 1.5`. Computed against real species stats: a
level-5 creature has 16–22 maxHp, so **carry capacity 24–33**. A frail human
sits at the low end — call it **22–27 units** — against `FOOD_ITEM_WEIGHT` of
1.

So you can carry roughly 10–20 ordinary things. **Pressure is moderate, not
brutal**, which is the right setting: enough that a pack is a real upgrade and
hauling timber is a decision, not so tight that the game is a spreadsheet.

Recipe quantities stay tiny — `fiber ×2 → cordage`, everything else 1 + 1.
**No "collect 20 wood."** Depth comes from tool gating and variety, never
from counts.

## No failure rolls

Crafting always succeeds. A random failure chance is pure tedium: it doesn't
create a decision, it just makes you do the same thing twice. The cost is
already the materials and the turns.

Material quality carrying into the item (fertile-ground fiber makes better
rope) stays **out** for v1 — it doubles the item table's dimensionality for
flavour.

---

## Playthrough: the first hour of crafting

Same method as `PLAYTHROUGH_LAYER1.md` — play it to find the gaps.

**You're in the lit chamber.** Sunbeams, a lake, flora, a herd of `???` at
the far shore that scattered when you got too close. You have nothing.

> `> search`

*You search the shallows. Lichen on the wet rock. (3)*

Weight 3 of 26. First material. You don't yet know it's a material.

> `> examine lichen`

*Damp grey-green lichen. It peels away in fibrous strands.*
*You could work this into fiber.*

**That's the teaching moment**, and it costs no turn. The description of the
material implies its use. No tutorial, no popup.

> `> craft → fiber`

Three turns. You have 3 fiber.

> `> craft → cordage`

*Two lengths of fiber, twisted.* Three turns, 1 cordage.

**Nothing has happened yet that isn't busywork** — and that's fine, because
it's five turns total and the payoff is next.

> `> search` *(near the sunbeams)*

*Dry roots and fallen wood at the edge of the light. (2)*

Deadwood is **sunbeam-gated** — it only exists where light reaches. You had
to be in the safe chamber to find it.

> `> craft → torch`

Five turns.

> `> equip torch`

**And the game changes.** Your sight radius roughly doubles — `computeVisible`'s
darkness penalty stops dominating. The chamber you've been standing in has
edges you couldn't see. Passages you walked past are visible.

And the log says:

*Something moves, further off than you could see before.*

Because your light also made *you* visible — the torch's cost, arriving in
the same breath as its benefit.

### What that sequence gets right

**The lit chamber gives you the material that lets you leave it.** Deadwood
only grows in the light; the torch is what survives the dark. You must come
back to the light to get the means to go without it. Nothing states that —
the gating does it.

That's the whole Act 1 crafting arc in miniature, and it's ~15 turns.

### What the playthrough exposed

1. **The first two crafts are busywork** and only survive because they're
   short and the torch pays off immediately. If the torch were 20 turns away,
   the opening would drag. **Keep the first real payoff inside ~15 turns.**
2. **Materials must describe their own use.** "It peels away in fibrous
   strands" is what teaches crafting without a tutorial. Every material needs
   a description written to that standard, and that's real writing work, not
   a data table.
3. **The `craft` list needs to be reachable in one keypress**, or a
   five-turn item costs more UI than play.
4. **`search` yielding a count (3) implies a stack UI.** `InventoryItem` has
   no stack count today — ten berries are ten entries. That needs solving
   before the inventory is player-facing.
5. **Nothing yet tells you what you *can't* do.** Before the torch you don't
   know the dark is survivable-but-limited. The absence of a warning is
   correct, but it means the torch has to be findable within the first
   chamber or the player just wanders dark corridors at 4 tiles of sight.

---

## Open questions

1. **Is `craft` a menu or a contextual action?** A one-key menu is simplest;
   contextual ("craft here, from what's on this tile") is more diegetic and
   more work.
2. **Does the player have a crafting *skill* that improves?** Recommend no —
   it's a stat treadmill, and identity is supposed to accrete from what you
   did, not from a number.
3. **Can you dismantle an item** back into materials? Nice for the weight
   economy, and it pairs with examine-to-learn. Recommend yes, at a loss.
4. **Where do stacks live in the UI** — merged by key, or a flat list?
   Depends on (4) above being solved in the data model first.
5. **Does a partner carry materials?** `carryCapacityOf` works for any agent,
   so it's nearly free — but pillar 3 refuses a partner that reads as
   equipment. Recommend no, and revisit if inventory pressure proves too
   tight in play.
