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

### 2. Scan for an environmental or utility hook specific to this fantasy

Before drafting branches, ask: is there a physical "moment" this move's
own fantasy implies — something that touches terrain, a resource, the
map itself, not just a target's HP? Rock Throw picking up and consuming a
real boulder tile. Water Gun leaving a puddle behind. Ember burning down
the bush a target was hiding in. Leech Seed literally draining a real
resource from a nearby agent. These are consistently the most memorable,
specific content in the whole roster — more so than any numeric lever —
because they're something an observer can *see happen* mid-fight. If the
move's own fantasy has one of these sitting in it, it usually deserves a
branch of its own or a real capstone, not an afterthought bolted onto
whichever branch has room.

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
- **Ally-facing**: `targetsAlly`/`allyEffect` (heal/buff),
  `allyEffectOnAttack`
- **Persistent passives** (`grantsPassive`/`grantsPassives`):
  `damageReduction`, `defenseBoost`, `immovable`, `regen`, `thorns`,
  `healAura`, `aquaticHaste`, `nonTerritorial`, `calmingPresence`,
  `unshaken`
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

### 9. Verify feasibility before writing code

For every lever the draft leans on, confirm the exact function that runs
it — read the code, don't infer from a field name or assume a primitive
exists because it sounds like it should. If something genuinely isn't
buildable from what's already shipped, that's exactly as useful a finding
as confirming it IS buildable — say so and get a scope decision before
starting new engine work, rather than deciding unilaterally or guessing
through it.

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

### 11. Build, test, verify, document

Implement in `moves.ts`, typecheck, run the generic structural test suite,
then actually confirm it live — a real sim run showing the tree getting
auto-respecced, not just passing structural validation. Update
MOVES_DESIGN.md (the writeup, citing the real feedback/reasoning behind
each choice) and TODO.md (a dated-style entry), rebuild and republish the
Move Tree Atlas, then commit.
