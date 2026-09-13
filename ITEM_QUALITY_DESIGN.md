# Item quality as skill points

Direct ask: *"Not just axe. Like... Basic Axe gives you cut as a move. It has
no skill points allocated. A better quality axe could give you cut with 4
skill points to allocate. The benefit of such a sick skill tree is that we can
really tack on bonuses meaningfully. We haven't design the cut skill tree but
you get the idea. We can have upgraded versions of items with higher quality
crafting materials."*

## Why this is the right shape

A better axe that does +2 damage is a hidden number. A better axe that hands
you **four points to spend** is a decision the player makes and can explain.
That is the project's own pillar — *"the ability to make decisions is core to
gameplay, and being informed about what decisions youre making is
important"* — applied to loot, and it is strictly better than a damage tier.

## What already exists (more than expected)

| piece | state |
|---|---|
| `grantsMoves` on items, wired in `player.ts` and `immigration.ts` | **built** — torch->`ember`, flintKnife->`scratch`, club->`pound`, axe->`fell`, machete->`clear`+`slash` |
| `skillPoints: Partial<Record<PokemonType, number>>` — typed currency | **built** |
| `wildcardSkillPoints` — untyped, funds any move's tree | **built** |
| `moveTreeChoices: Record<moveId, nodeId[]>` — committed nodes, recomputed into the live move by `applyMoveTree` | **built** |
| `maybeAutoRespec` — auto-spends points for non-player agents | **built** |
| Move skill trees for the *tool* moves (`fell`, `clear`, `slash`...) | **the gap** |
| Item quality / material tiers | **the gap** |

The machinery is all there. What is missing is the trees and the tiers.

## The main proposal: the points live on the ITEM, not the agent

The obvious implementation is "a fine axe grants 4 wildcard points to its
holder." That is wrong, for two reasons.

**It leaks.** `wildcardSkillPoints` funds *any* move's tree. A well-forged axe
would let you improve your fire breathing. Even typed points leak within a
type. The axe's craftsmanship should improve **the axe**.

**It collides with an established invariant.** `moveTreeChoices` is documented
as never reversed — *"a real, permanent build choice, same as mainline EV/
nature investment."* If item-granted nodes evaporate when you unequip, that
rule breaks.

Both problems disappear with one move: **an item carries its own point pool
and its own allocated nodes.** The axe has a build; the agent does not borrow
one.

What that buys, beyond correctness:

- **Items become things with a history.** A well-built axe is a real object
  you can hand to someone else, and they get the build you made. "Her
  grandfather's axe, honed for felling" is then true in the data.
- **Town identity gets its deepest hook yet.** A master smith's axe comes
  with points *already allocated* along that town's tradition — "Redfen axes
  always take the cleave line." `maybeAutoRespec` is the existing mechanism
  for spending points without a player, so the town's signature build is an
  allocation policy, not new machinery. What looked like a problem (who
  spends an NPC-crafted item's points?) is the feature.
- **Loot gets real stakes.** Finding an axe with four points already spent
  *well* is a genuine prize; four points spent badly is a real
  disappointment, and both are legible.
- **Two clean progression axes.** The creature's own growth stays permanent
  and un-respeccable, exactly as documented. Gear is the *replaceable* axis —
  you can always forge a new axe and try a different line. Permanence where
  it means something, experimentation where it should be cheap.

## Quality tiers

Quality comes from two inputs, and it should be both:

- **Material tier** — flint and deadwood make a crude tool; good stone,
  seasoned haft, iron make better ones.
- **The crafter** — a smithing town's smith produces better work from the
  same inputs than a traveller at a campfire does.

| tier | points | roughly |
|---|---|---|
| crude | 0 | flint + deadwood, made anywhere |
| sound | 1-2 | decent materials, competent hands |
| fine | 3-4 | good material *and* a real crafter |
| masterwork | 5-6 + a pre-allocated signature node | rare material, a master, usually a named town |

This makes material gathering matter and makes *where you had it made* matter,
which is what ties this system to the town pass rather than leaving it a
standalone loot ladder.

## Scope control: share the trees, don't write one per tool

Each tree is real work — `SKILL_TREE_GUIDE.md` is an eleven-step process with
a feasibility check and a reachability audit. One tree per item would be
twenty trees.

The codebase is already doing the right thing: tools grant **shared** moves
(`pound`, `scratch`, `slash`, plus `terrainMove`-built `fell`/`clear`) rather
than a bespoke move each. Keep that. Then:

- Build **4-5 technique trees total**, not one per item.
- Items differentiate *within* a shared tree, by how many points they carry
  and which nodes a crafter pre-spent.

A machete and an axe both reaching into the cut tree, arriving at different
nodes, is more interesting than two shallow separate trees — and it is a
fraction of the work.

## Risks worth writing down now

- **Gear may outpace growth.** If a masterwork axe beats several levels, the
  progression centre of gravity moves to crafting. For a *fragile human* whose
  entire identity is tools, that is arguably correct — but it should be a
  decision, not a surprise, and it wants measuring once trees exist.
- **It collides with "individually weak, collectively formidable."**
  `HUMANS_DESIGN.md` commits to humans losing to most mid-tier Pokémon alone.
  A masterwork weapon with six allocated points could quietly undo that. The
  tier ceiling is the lever; masterwork should be rare enough that the
  statement stays true of humans *in general*.
- **The tool trees do not exist yet**, and the guide's own step 10b is a
  reachability audit — an unreachable capstone is a defect here, not a
  curiosity. Budget the trees as real design work, not a data entry pass.

## Open questions

1. Confirm the points-live-on-the-item model, or keep them on the holder?
2. Which 4-5 technique trees? (`cut` is the obvious first — it already has
   `fell`, `clear` and `slash` pointing at it.)
3. Can a player re-invest an item's points by reworking it at a forge, or is
   an item's build fixed once made?
4. Does item quality show on the map/sprite, or only in the inventory?
