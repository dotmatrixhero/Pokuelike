# How to design a move skill tree: step by step

A practical checklist, not background reading — follow it top-to-bottom
while actually building a tree. Distilled from real mistakes made and
caught across every tree shipped so far (see MOVES_DESIGN.md's "Guide for
future Claude" for the full war stories behind each rule; this doc is the
sequence to run, that one is why each step exists).

**The one rule everything else protects**: fantasy first, mechanics
second. If a branch's mechanic could be copy-pasted onto a different
move/species with only the numbers changed, it's a template, not a
fantasy. Every step below exists to catch a way that rule quietly gets
violated.

## The sequence

### 1. Pick the fantasy, not the move

One sentence: why does *this* species use *this* move? Not "what does the
move do" (that's the dex entry) — why would this specific animal reach for
it. If the sentence would read identically for a different species, keep
digging before writing a single node.

### 2. Scan EVERY world system for a hook, not just the ones you've read

Before drafting branches, ask: is there a real "moment" this move's own
fantasy implies outside of dealing damage? Rock Throw picking up and
consuming a real boulder tile. Water Gun leaving a puddle. Ember burning
down the bush a target hid in. Leech Seed draining a real resource off a
nearby agent. Vine Whip drawing on the flora it's standing in. These are
consistently the most memorable content in the roster — more than any
numeric lever — because an observer can *see them happen*. A move whose
fantasy contains one usually deserves a branch or a real capstone built
around it, not an afterthought bolted onto whichever branch has room.

**Do this as an enumeration, not a brainstorm.** This step failed once by
being run as "what comes to mind?" — which only ever surfaces hooks in the
systems already loaded in context. Dig and Vine Whip were both declared to
have no available hook, and both were wrong: there was an entire
*gathering* system (crop digging, spring digging, canopy harvesting) that
moves already fed into, whose own source comments literally said "moves
can be used to dig faster." It was never considered because nothing had
made me open needs.ts that session.

So walk the list of real world systems and ask "does this move's fantasy
touch this one?" for each, out loud, even the ones that feel unrelated:

- **Gathering / work** — crop digging, spring digging, canopy harvest
  (`digTicksAccrued`/`springDigTicksAccrued`, needs.ts + crops.ts)
- **Flora & soil** — fertility, growth, seeding, harvest recovery
  (flora.ts)
- **Terrain** — burn, fill, consume-own-tile, walkability (world.ts's
  `setTile`)
- **Water** — springs, water bodies, drying/receding (waterBody.ts)
- **Shelter** — building, occupancy, caches (shelter.ts)
- **Needs** — hunger/thirst/energy costs and restoration (needs.ts)
- **Reproduction** — mate search radius, breeding (reproduction.ts)
- **Herd** — conflict/rivalry, cohesion, migration, leadership
- **Weather** — real cells, and the conditions keyed off them
- **Layers** — surface/canopy/underground movement and access
- **Status & combat** — the obvious one, and the one that hogs attention

A "no" for most of them is fine and fast. The point is that the no is
*checked* rather than assumed.

**And verify the hook actually fires for this move** (step 9's job, but
it bites hardest here): a field can be perfectly real and still be dead on
a particular move because of how its path is gated. `fertilityBoost` only
runs for `utilityMove`-flagged moves. Canopy harvest only accepts a
damage-dealing move; crop digging only accepts a `burrow` one. Adding the
right-sounding field to the wrong move produces a node that visibly does
nothing.

### 3. Know the lever palette before drafting anything

Don't reach for whatever's easiest to imagine — know what's actually real
first. The full shipped list (see MOVES_DESIGN.md's "Engine primitives
needed" checklist for the exact code paths behind each one):

- **Damage-shape**: `power`, `accuracy`, `cooldownTicks`,
  `defensePenetration`, `critRateStage`, `critCooldownReset`,
  `bonusVsType`, `resistanceBreaker`, `statusSeverity`
- **Multi-hit / area**: `hits` (multi-hit), `hitsArea`, `shape`/`range`,
  `excludesAllies` (AoE ally-exemption)
- **Position & movement**: `forcedMovement` (drag/knockback/lunge/
  retreat), `positionSwap`/`positionSwapPull`, `weightScaling`
- **Cost/risk**: `lifestealFraction`, `recoilFraction`,
  `selfCostPerUse` (needs), `lockTicks` (self-lock)
- **Tempo/denial**: `jamCooldownTicks` (extends the defender's own
  cooldowns), `rallyCall` (focus-fire mark), `critCooldownReset`
- **Conditions**: `situationalBonus` (`targetLowHp`, `flanking`, `night`,
  `elevation`, `concealed`, `storm`/`rain`/`drought`/`coldSnap`,
  `targetBurning`, `targetStatused`), `selfStateBonus` (`selfLowHp`)
- **Status**: `statusChance`/`statusKind`, `statusSeverity`,
  `statusSpreads`
- **Terrain/environment**: `terrainBurn`, `terrainFill`,
  `consumesOwnTerrain`, `fertilityBoost`, `drainNeeds`,
  `matingRadiusBoost`, `burrow`
- **Gathering / work** (the category step 2 got caught missing —
  these are about what a move DOES for its user outside a fight, and
  they're the least-reached-for levers in the whole palette):
  `gatherBurst` (faster crop digging, spring digging, or canopy
  harvesting, composed into whichever of those paths the move already
  qualifies for), plus `fertilityBoost` and `drainNeeds` above
- **Ally-facing**: `targetsAlly`/`allyEffect` (heal/buff),
  `allyEffectOnAttack`
- **Persistent passives** (`grantsPassive`/`grantsPassives`):
  `damageReduction`, `defenseBoost`, `immovable`, `regen`, `regenFlat`,
  `thorns`, `healAura`, `aquaticHaste`, `nonTerritorial`,
  `calmingPresence`, `unshaken`
  - **Passives accumulate permanently and without a cap**, across every
    move a unit knows — `grantPassive` is a `+=`, and tree choices are
    never removed. So the question for any passive is never "is this node
    balanced" but "what does the SUM of every node granting this look like
    on a long-lived agent." That went unasked for `regen` and produced
    agents healing 11% of max HP per tick, mid-fight (see MOVES_DESIGN.md).
  - Healing specifically: reach for **`regenFlat`** (flat HP) by default.
    It is worth proportionally more to a small early unit than a big late
    one, which is the curve you almost always want. Reserve percentage
    `regen` for capstones, where being disproportionately strong is the
    point. Both are gated on being out of combat; lifesteal and ally heals
    are not, which is the deliberate line between passive and active
    healing.
- **Big/rare**: `chargeAttack` (wind-up + genuine invulnerability),
  `statChangeOnHit` (temporary stat stages)
- **Structural**: `excludes` (real forks), `prerequisitesAnyOf`
  (crosslink shortcuts)
- **Not yet built** — real gaps, worth knowing before promising one:
  a Max PP resource, `aggroRedirect` (taunt-style targeting), a `"root"`
  status kind, laid hazard tiles (Spikes/Toxic Spikes/Stealth Rock
  family), persistent fire-hazard terrain (a real DOT/burns-down-flora
  tile, distinct from the instant `terrainBurn` reversion already
  shipped)

A node that isn't built from one of the real entries above isn't ready to
write into `moves.ts` yet — flag it and confirm scope before starting new
engine work (see step 9).

### 4. Split the fantasy three ways

What does Aggression mean for *this* fantasy specifically? Boldness?
Sociability? Not the generic power/tanky/support template — the version
of each that only makes sense for this species and this move. A rooted
plant's Boldness is "refuses to be moved," not "has high defense." A
solitary predator's Sociability is de-escalation, not a herd buff a
solitary animal would never need. If a branch's answer could paste onto
another move's tree unchanged, it's not specific enough yet.

### 5. Imagine actually playing it

Before drafting a single node's numbers, picture the fight. What's fun to
build toward? What's fun to fight *against* — does an opponent need to
react differently to this build than to a generic "more damage" build?
What tension exists *between* branches — is there a build that tempts you
toward two different branches' best toys at once, forcing an actual
choice rather than an obvious best pick? A tree where every branch is
equally appealing in a different situation beats one with one clearly
"correct" branch and two consolation prizes.

### 6. Draft nodes per branch

Opener notable → filler → fork → capstone, per branch. Every node should
trace back to a phrase from step 4, not just "a lever that hasn't been
used yet in this tree." Put a real notable early (not just at the very
end of a long grind) so a route through the tree is built from felt
choices the whole way, not one branch-select decision followed by a long
quiet walk. Filler is fine and doesn't need to be ashamed of itself — just
don't let it be the only thing carrying a branch's identity.

### 7. Capstone check

Does the capstone escalate the specific lever its own branch already
built, or does it reach for whatever the roster happens to have handy? If
it can be described as "like [some other move]'s but bigger," that's the
signal to keep looking, not to ship it. Also check it isn't quietly
undoing what the rest of the branch built (a wide AoE capstone on a
branch that spent every earlier node committing to "one target, one
clean hit" contradicts itself, even if the AoE change itself is a real,
well-built lever elsewhere).

### 8. Crosslinks last

Once all three branches are drafted, bridge each adjacent pair. A
crosslink needs both: its own real, distinctive effect (not a generic
stat grab reused across every tree's equivalent slot), and a genuine
shortcut — landing one filler node short of the next notable on both
sides it connects, never skipping the actual decision point (a fork or
keystone) itself. If two different trees' crosslinks in the same
structural position end up mechanically identical, that's the tell to
rework one of them.

**A crosslink is a three-node bridge, not a single node.** This is the
single biggest structural difference between the flagship trees and a
first draft, and it was found by *measuring* (node and
`prerequisitesAnyOf` counts off the exported JSON) rather than eyeballing
silhouettes — flagships sit at ~39 nodes / 9-10 `anyOf`, an unbridged
draft at ~33 / 6. The shape:

```
<crosslink>            its own distinctive lever
  -> <filler>          deepens that SAME lever (not "+5 Power")
  -> <notable, cost 2> the payoff for committing to the detour
```

and it must land on **two rungs of shortcut, not one**:

- the cost-2 notable is an alternate route into the **pre-fork node of
  both flanking branches**, and
- the crosslink itself *stays* a shallower alternate route on an **early
  filler** in each of those branches.

So a build can dip into the bridge cheaply and bail, or commit and arrive
one step short of a fork. A bridge that only reaches one of the two
branches it connects is a spur wearing a bridge's node count.

**Do not pad a tree to hit the flagship node count.** Match the
*structure*, not the number. A move with a genuinely smaller honest lever
set should ship smaller (dig at 29 and leech_seed at 31 are deliberate);
inflating them with invented nodes is precisely the template failure every
other step here exists to catch.

### 9. Verify feasibility before writing code

For every lever the draft leans on, confirm the exact function that runs
it — read the code, don't infer from a field name or assume a primitive
exists because it sounds like it should. If something genuinely isn't
buildable from what's already shipped, that's exactly as useful a finding
as confirming it IS buildable — say so and get a scope decision before
starting new engine work, rather than deciding unilaterally or guessing
through it.

**And verify the verifier.** A check that has never once printed a failure
has not been verified — it may simply be reading nothing. The Atlas layout
check went through two silently-wrong versions (one crashing on every tree
because `computeLayout` returns `{positions, crosslinks, maxR}` rather
than a bare id->position map; one reporting every tree clean because it
was reaching for a JSON shape the exporter doesn't produce) before the
third version actually found the real defect. Before trusting a green
check, break something on purpose and confirm it goes red.

### 10. Self-audit before shipping

Go back through the finished draft looking for the ways past trees have
actually failed this exact process:
- Does every node's *displayed name* match what its delta really does?
  A flavorful name promising a property the mechanic doesn't deliver is a
  real defect, not a style nitpick.
- Any lever repeated more than once in the same branch under different
  names? Any two nodes that are mechanically identical wearing different
  flavor text?
- Any node that's a pure downside with no offsetting benefit in the same
  node?
- The real test: can each branch be described without naming the move
  it's attached to? If a branch's writeup would read identically pasted
  onto a different move, it's a template wearing that move's name.

### 10b. Check the node is actually REACHABLE, not just correct

A node can be perfectly designed, fully tested, rendered in the Atlas, and
still never happen. Two ways that bites, both found the hard way:

- **Cost.** Agents auto-spend points as they arrive, so expensive nodes are
  reached far less often than their position suggests. Before the
  `SKILLPOINT_SAVE_CHANCE` fix, cost-3 nodes were reached literally never
  and cost-2 nodes 6 times out of 144. If a mechanic only exists on an
  expensive node, it effectively does not exist.
- **Depth, and which species know the move.** A mechanic on Flamethrower
  reaches one species entry; the same mechanic on Ember reaches six. And
  depth compounds: a node five steps into a branch was held by 9 of 360
  living agents. Put a mechanic you actually want *seen* near the opener of
  a widely-known move.

The test is empirical, not architectural: run the sim and count how many
agents hold the node and how many times the effect fired. "It is in the
tree" is not the same as "it happens."

### 11. Build, test, verify, document

Implement in `moves.ts`, typecheck, run the generic structural test suite,
then actually confirm it live — a real sim run showing the tree getting
auto-respecced, not just passing structural validation.

**Average across seeds before claiming any behavioral effect.** Population
in this sim is violently RNG-sensitive: adding a single extra `rng()` draw
per skill-point grant, with its effect disabled, moved one seed's 20k-tick
population from 129 to 3, and across 6 seeds the range is 11-151. A
single-seed before/after population comparison is not evidence, however
clean the numbers look. Count distinct nodes reached, or effects fired —
those hold up where population does not. Update
MOVES_DESIGN.md (the writeup, citing the real feedback/reasoning behind
each choice) and TODO.md (a dated-style entry), rebuild and republish the
Move Tree Atlas, then commit.
