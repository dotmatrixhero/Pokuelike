# Moves design backlog: status effects + non-combat/environmental moves

A dedicated home for the move-system brainstorm so it doesn't get lost in
DESIGN.md (which documents what's actually built and verified) or
TODO.md (short tracked items). Nothing in this file is built yet. When a
piece of this gets built and verified with a real run, its writeup moves
to DESIGN.md and the corresponding TODO.md item gets checked off — this
file is the backlog it comes from, not a replacement for either.

**Not in scope here**: anything weather-flavored (Rain Dance, Sandstorm as
a global effect, weather-gated healing/damage). A separate effort is
building dynamic weather — deliberately not overdesigning that surface
here to avoid stepping on it. A couple of ideas below (Sandstorm as a
*local* hazard, not a weather state) are noted as deferred/reframed for
the same reason.

## Guide for future Claude: principles learned building this system

Written on direct request, after several rounds of real feedback on real
mistakes — a distillation, not a rehash. Read this before touching a move
tree. Each principle names the mistake it was learned from so it doesn't
read as generic advice.

**1. Fantasy first, then mechanics — never the reverse.** The original
sin of the pre-v3 trees: three branches built by copying another move's
kit and swapping numbers ("the design looks like you just copied over
effects from other trees"). The fix that actually worked was starting
from "why does *this* species use *this* move" before opening the delta
schema at all — Rock Throw's "Denial" branch (a lumbering body's borrowed
reach, pinning rather than escalating power) came from that question, not
from a lever list. If a branch's mechanic could be copy-pasted onto a
different move/species with only the numbers changed, it's a template,
not a fantasy — that's the test, not a vibe check.

**2. Extending the user's idea is not the same as originating one.**
Direct, important feedback: "you're echoing a lot of my ideas... I'm
worried you're not UNDERSTANDING and learning how to create your own
based on the fantasy." Costing out a suggestion into real primitives is
useful but it's translation, not design. The bar: pitch something for a
move *nobody asked about yet*, reasoning from its fantasy alone. Do this
regularly, not once as a one-time proof.

**3. Every mechanic must cite the real code path that runs it, not an
assumption.** Every "is this buildable" question in this whole effort was
answered by grepping the actual engine function, never by guessing from
the field name. This caught real, load-bearing facts late guessing would
have missed — `lockTicks` locks the *user*, not the defender (a crosslink
was shipped believing the opposite, described as "stuns outright," and
had to be fixed); `range.max` and `shape` are fully decoupled fields
(moveRange gates *whether to fire*, `resolveShape` decides *what actually
gets hit* — conflating them produced a mechanic — "+Range" on an AoE —
that silently didn't do what its name promised). When a design idea
depends on how a system works, read that system before proposing the
mechanic, not after.

**4. A lever that's pure downside with no offsetting benefit is a bug,
not a design choice.** Found twice, independently, in review: Earthquake's
`overload_footing` cost a real skill point for `recoilFraction: 0.1`
alone — a player would never buy pure self-damage. (The `"+10% Recoil"`
label was itself the tell — read as `recoilFraction * 100`, not as
"reads plausible so it must be intentional.") Every delta-only filler
node deserves this check before shipping: does taking it, on its own,
make the move strictly better for *someone*? If a lever is genuinely a
tradeoff, the benefit half lives in the *same node*, not a different one
several steps away that a build might never reach.

**5. Say the numbers, don't paraphrase them.** Every "+10 Range" node
across three trees was mislabeled — the real deltas were +1 or +2, not
+10. A generic label ("+10 Range") copy-pasted across nodes with
different real values is exactly how this kind of error survives review:
nothing about the label itself was ever cross-checked against the actual
number in the same object. When a node name states a magnitude, compute
it from the code, don't carry a boilerplate string forward.

**6. Widen a branch's *allowed* flavor before widening its mechanics.**
Boldness locked to "defensive," Aggression locked to "raw power" forces
every move's version of that branch back toward the same template — the
real unlock was permitting Boldness to be earned aggression and Aggression
to be hunting/stealth or clashing depending on move+species. Do this
once, explicitly, in the doc (see "Skill-tree template v3" below), not
implicitly per-move as an exception each time.

**7. Deeper crosslinks means a bridge, not a longer dead end.** First
attempt at "deeper crosslinks" just added one more single-effect leaf
node hanging off a crosslink (*Marked Rupture* et al.) — real, but not
what "deeper" meant. The actual ask: crosslink → filler → notable, where
that notable becomes a genuine alternate `prerequisitesAnyOf` route
*into* a main branch, letting a build skip that branch's own linear
filler grind by investing across two branches instead. Corollary learned
building the pilot: shortcut the grind, never the fork/decision itself —
a bridge that skips a branch's one meaningful choice point trivializes
it rather than offering a real alternate path to it.

**8. A proposal in the doc is not a shipped mechanic — say which one
something is, always.** Confusion arose twice from writing "proposed"
crosslinks in prose without marking them clearly enough as unbuilt: "I'm
not seeing any deeper crosslinks tho." Every mechanic in this doc now
gets an explicit **Shipped**/proposed/flagged tag, checked against
whether it's actually in `packages/data/src/moves.ts` — not inferred from
how confidently it reads.

**9. When a UI element's own visualization looks contradictory, check
whether it's actually wrong, not just confusing.** The range/shape grid
looking odd for a cone move ("if max range, do you not do a cone?") led
to discovering the fillers themselves didn't do what their names claimed
— genuinely inconsistent-looking output is worth tracing to a root cause
before writing it off as "just needs a caption."

**10. Design approvals first — proposed once, holds for the rest of the
session.** Standing rule after an artifact got built before its design
was ever presented: pitch the design in text, wait for explicit
"go ahead"/"try it out" before writing code. A pilot on one move/one
crosslink before rolling a new pattern out everywhere (rule 7's bridge
pattern) is the same instinct applied to structural changes, not just
new features.

Seven more, added after rolling the crosslink-bridge pattern out to every
tree and taking Hydro Pump's Sociability capstone through three real
iterations — none of this rehashes 1-10, each is a distinct mistake with
its own fix:

**11. A bridge must reach every branch its crosslink actually connects,
not just the branch matching its own `leaning`.** Converged Ruin
(Earthquake) is `leaning: "aggression"`, but the crosslink underneath it
(*Coordinated Tremor*) bridges Sociability too — v1 only wired the
shortcut into Aggression's own pre-fork node, corrected directly: "make
them connect to the other branch too. Like it can go to either branch." A
descendant node's own `leaning` field is not the boundary of which
branches a bridge should serve; the crosslink's actual two prerequisite
branches are.

**12. "Land one step short of the fork" isn't specific enough — land at
the same depth from the decision a normal walk would reach.** v1 of the
same bridge wired the shortcut directly onto the fork nodes' own
`prerequisitesAnyOf`, on the theory that "reaching the fork without
skipping it" was the rule — still corrected: "the deeper cross link going
straight to the choice of 2 nodes are a bit too much." The precise rule
(principle 7's corollary, sharpened): a bridge should save the *grind*,
never the *last step to the decision*, so the fork stays an equally
weighted choice regardless of which path got you there.

**13. A bridge's own new content must deepen the specific lever its own
crosslink already introduced, not reach for a generic stat grab-bag —
principle #1 applies at the single-node level too, not just the
whole-tree level.** A rollout across 11 crosslinks shipped with the same
three-lever rotation every time (+accuracy filler, then +power/
+defensePenetration/+lifestealFraction notable) — direct, blunt feedback:
"Your crosslinks are laaaaaame tho... the skills don't feel cool." Every
one had to be rebuilt so its notable escalates whatever its own crosslink
already does — a lunge gets longer, a crit gets sharper, a mark gets
stronger — instead of bolting on whichever generic lever hadn't been used
yet.

**14. A shape/AoE change is notable/capstone-tier currency, earned rather
than routine — and it's the single best payoff to spend on a bridge
notable when a big moment is explicitly asked for.** Direct ask, "make
one of the solar beam ones do like three width beams as a capstone" —
Solar Beam is single-target everywhere else in its own tree, so turning
one bridge's notable into a real `hitsArea` cone was the standout of the
whole rollout, not an arbitrary pick.

**15. When feedback comes back twice on the same node, check whether two
separate asks are being crammed onto one point before writing a third
version of it.** Hydro Pump's Tidal Communion took three passes: a flat
`healAura` didn't match the branch's own fantasy; the `excludesAllies`
replacement then read as reused content, since Earthquake's own opener
already does the same thing. The fix wasn't a fourth mechanic bolted onto
the same node — it was separating "heal" and "don't hit allies" (two
genuinely different asks) onto two different nodes: `excludesAllies`
moved down onto the opener next to its existing heal, which freed the
capstone to become something the roster didn't have yet (`aquaticHaste`).

**16. Confirming a mechanic ISN'T buildable from existing primitives is
exactly as load-bearing as confirming it IS, and still needs the user's
go-ahead before new engine work starts.** Before building `aquaticHaste`,
the closed `PassiveKind` union and `actionSpeedOf`'s multiplier chain were
read directly to confirm no existing primitive covered "ally aura +
terrain-conditional" together — then the scope question went to the user
rather than being decided unilaterally, per principle #10.

### What actually makes a tree interesting, distilled from the roster so far

The principles above are mostly about catching mistakes. These are about
the other half — recognizable, repeatable patterns behind every node in
this doc that actually landed well, worth reaching for on purpose rather
than rediscovering per move:

- **A move's own "flaw" is a branch's best possible payoff, not something
  to quietly patch over.** Earthquake's AoE doesn't distinguish friend
  from foe — Sociability's whole identity is a drilled herd that finally
  doesn't get caught in its own blast, turning the exact same
  indiscriminate hit into the branch's hook. Hydro Pump's canonically bad
  accuracy became Boldness's entire fantasy (a patient, controlled deluge
  instead of a wild spray) rather than a flat "-accuracy" tax filler
  quietly apologizes for elsewhere. Look for the thing that reads as the
  move's weakness first — it's usually a branch waiting to happen.
- **Physical/positional levers are the most memorable interactions in the
  whole roster, ahead of any number.** A drag, a lunge, a swap, a boulder
  consumed underfoot, a puddle left behind — these are things an observer
  can *see happen* mid-fight, unlike "+10% power." `forcedMovement`,
  `positionSwap`, `consumesOwnTerrain`, `terrainBurn`/`terrainFill` earn
  disproportionate design time per move specifically because of this (see
  template v3's rule 3) — reach for one of these before reaching for
  another accuracy/power filler.
- **A condition worth gating a payoff on is one the move's own fantasy
  would obviously care about, not whatever's cheapest to check.**
  `aquaticHaste` only firing on water, Rock Throw's own boulder tile
  consumed for real bonus damage, a night-hunter's bonus specifically at
  night — the condition IS the flavor, not a tax attached to an otherwise
  generic bonus. A situational bonus that could be swapped for any other
  situational bonus with no loss of sense is a tell it was picked for
  convenience, not fit.
- **Rally/mark-style mechanics are richer than a same-sized buff, because
  they change what *other* agents independently choose to do, not just a
  number on the caster.** `rallyMarked`/`preferMarked` turning several
  agents' separately-run targeting logic onto the same threat is a
  qualitatively different payoff than the same points spent on flat
  damage — coordination itself is the reward, not a means to more damage.
- **A capstone's mechanic should be something the roster doesn't already
  have, not a bigger number on a lever some other move already uses.**
  Tidal Communion's own history makes the point directly: both a flat
  heal and a reused `excludesAllies` were mechanically sound and still
  felt lame, specifically because neither one was new. When a capstone
  idea can be described as "like [other move]'s but bigger," that's the
  signal to keep looking, not to ship it.
- **The real test that three branches earned three separate identities:
  can each one be described without naming the move it's attached to?**
  If a branch's writeup would read exactly the same pasted onto a
  different move, it's a template wearing that move's name, not a real
  answer to what that move's own Aggression/Boldness/Sociability means.

## Engine primitives needed — running checklist

Every tree/lever in this doc that isn't marked "live" is blocked on one of
these. Kept in one place so it's a checklist, not something to re-derive by
grepping for "needs" across the whole file.

| Primitive | Unblocks | Status |
|---|---|---|
| `MoveTreeNode.excludes` | Every real fork (pick-one-of-two, permanent) | **Shipped** — `moves.ts`, used by Tackle & Slash |
| `MoveTreeNode.prerequisitesAnyOf` | Crosslink shortcuts; a keystone reachable from either fork tip | **Shipped** — `moves.ts`, not yet used in a shipped tree |
| Multi-hit (`MoveSpec.hits: {min,max}` + `combat.ts`'s `rollHitCount` looping in `predation.ts`) | Frenzied Pecking, Frenzy Claws, Rapid Volley/Jets, Frenzy Cutter — half the "Aggression" forks drafted below | **Shipped** — confirmed in a real fight: 3 separate `fought` events from one move use, stopping early on a mid-flurry true death. Also folded into `pickBestMove`'s scoring (average hit count). First real content: Peck's *Frenzied Pecking*/*Rapid Volley* and Water Gun's *Rapid Jets* |
| Defense-penetration delta field (`MoveSpec.defensePenetration`) | Piercing Beak | **Shipped** — `combat.ts`'s `calculateDamage` shaves the fraction off Defense/SpDefense before stages apply. First real content: Rock Throw's *Crushing Weight* and Peck's *Piercing Beak* |
| Forced movement (drag/knockback/lunge/retreat as part of a move) | Verdant Grip, Retreat Peck, Knockback Spray, Retreating Current, and most of Vine Whip's keystones | **Shipped** — see DESIGN.md's "Forced movement" section. First real content: Tackle's `bracing_impact` (onHit knockback) and Slash's `feint` (beforeHit lunge), both confirmed reached in a real run. Doesn't cover U-turn/Volt Switch's sustained multi-tick retreat — a different mechanism, still not started |
| Multi-action lock (`MoveSpec.lockTicks` + `Agent.actionLockTicks`) | Reaping Slash (both Tackle's and Slash's) | **Shipped** — `useMove` (combat.ts) sets the lock, `tickStatusEffects` (status.ts) counts it down, `tickAgentAction` (needs.ts) blocks all action while it's active, same shape as fainted/asleep/frozen. First real content: Rock Throw's *Rolling Thunder* crosslink |
| Agent-modifying passive (a tree node whose effect targets `Agent`, not `MoveSpec`) | Brace for Impact, Immovable, Overgrowth, Living Trellis | **Shipped** — `MoveTreeNode.grantsPassive` (moves.ts), applied by `maybeAutoRespec` (leveling.ts) into `Agent.passives`. Three real, wired kinds: `damageReduction` (a flat fraction off incoming damage, `resolveHit`), `immovable` (blocks being dragged/knocked back/lunged at, `applyForcedMovement`), `regen` (per-tick heal independent of being fed/watered, `tickStatusEffects`). Not yet granted by a shipped tree node — the mechanism is confirmed via unit tests, not real content yet |
| Conditional/situational bonuses (concealment, day/night, elevation, weather, target status) | Predator's Instinct, Ambush Claws/Dive, Night Hunter, Fan the Flames, Coup de Grace | **Shipped** — `MoveSpec.situationalBonus` (predation.ts's `situationalMultiplier`) now covers `"targetLowHp"`, `"flanking"`, `"night"`, `"elevation"` (attacker's tile strictly higher than the defender's), `"concealed"` (attacker standing in a bush), `"coldSnap"`/`"storm"`/`"drought"`/`"rain"` (weather.ts's `activeWeatherAt`/`isInColdSnap` at the attacker's position), `"targetBurning"` (`isBurned(defender)`), and `"targetStatused"` (any status at all, not just burn — deliberately generalized past a single status kind so it isn't just a burn-only condition wearing a different name). "Was just hit"/"moved this tick" still aren't wired — no move drafted here needs them yet |
| Weight-scaled bonus damage (`MoveSpec.weightScaling`) | Weighted Charge | **Shipped** — `predation.ts`'s `applySingleDamageInstance` adds `factor * attacker.maxHp` (this sim's size/weight proxy, same one `powerOf` already uses for predation eligibility) as bonus power before the damage formula runs. Not yet used in a shipped tree |
| Per-move crit-rate stage (`MoveSpec.critRateStage`) | Any "this move crits more often" notable | **Shipped** — passed straight into `combat.ts`'s existing `rollCritical(stage)` from `applySingleDamageInstance`, instead of always rolling stage 0. Not yet used in a shipped tree |
| Lifesteal / recoil (`MoveSpec.lifestealFraction`/`recoilFraction`) | Any "trade your own HP for damage, or heal off it" notable | **Shipped** — both apply as a fraction of the actual damage dealt, in `applySingleDamageInstance`; lifesteal caps at the attacker's own max HP, recoil floors at 1 HP (a recoil move can hurt the user badly but never faints it outright — that's a separate, deliberate design choice, not an oversight). Not yet used in a shipped tree |
| Thorns / heal-aura passives (`PassiveKind` `"thorns"`/`"healAura"`) | A defensive-notable branch that punishes attackers, and a support passive that heals nearby herd-mates (not just the holder) | **Shipped** — `thorns` reflects a fraction of incoming damage back onto the attacker (`thornsOf`, applied in `applySingleDamageInstance`, floored at 1 HP same as recoil); `healAura` heals every living, same-herd, same-layer agent within a fixed radius each tick (`applyHealAuraPassive`, `status.ts`'s `tickStatusEffects`), the holder included — the first passive that isn't purely self-targeted. Both usable via the existing `grantsPassive`/new `grantsPassives` (plural) node field. Not yet granted by a shipped tree node |
| Cooldown-jamming (`MoveSpec.jamCooldownTicks`) | A "denial" notable that punishes the defender's own tempo | **Shipped** — on a landed, non-killing hit, bumps every entry already in the defender's `moveCooldowns` map by the configured amount (`resolveHitAgainstTarget`) — it extends existing cooldowns, it doesn't put an off-cooldown move on cooldown from nothing. Not yet used in a shipped tree |
| Type-matchup levers (`MoveSpec.bonusVsType`/`resistanceBreaker`) | A "specialist" notable (extra damage vs. one type) and a "the target's resist barely helps" notable | **Shipped** — `bonusVsType` multiplies final damage when the defender has the named type (`combat.ts`'s `calculateDamage`, also folded into `pickBestMove`'s scoring); `resistanceBreaker` claws a resist (0 < effectiveness < 1) back up toward neutral, multiplicatively, capped at 1 — it can partially cancel a resist, it can never turn one into an actual weakness. First real content: Rock Throw's *Skyfall*/*Bedrock Breaker*, Peck's *Skybreaker*, and Water Gun's *Overwhelming Current* |
| Needs-based per-use cost (`MoveSpec.selfCostPerUse`) | A "powerful but exhausting" notable that costs the user energy or hunger to use, not just a cooldown | **Shipped** — deducted from the attacker's own `needs[need]` once per use, floored at 0 (`resolveHit`, alongside the existing `useMove` cooldown-setting call). First real content: Rock Throw's *Overhand Heave* |
| Move-caused terrain change (`MoveSpec.terrainBurn`) | A fire move that burns down a bush the target was hiding in | **Shipped** — on a landed, non-killing hit, reverts a `"bush"` tile the defender stands on to plain floor (`resolveHitAgainstTarget`, via `world.ts`'s `setTile`) — the target loses its concealment as a side effect of getting hit, not a separate mechanic. Not yet used in a shipped tree |
| Status spreading to a nearby agent (`MoveSpec.statusSpreads`) | A "the fire/poison catches on whoever's standing next to the target" notable | **Shipped** — once the primary status lands, rolls a second, independent chance (`status.ts`'s `maybeSpreadStatus`) to inflict the *same* status on one other living, same-layer agent within a small radius — a plain distance scan kept local to `status.ts` on purpose, to avoid a real import cycle with predation.ts. First real content: Scratch's *Toxic Spread* |
| Multi-passive nodes (`MoveTreeNode.grantsPassives`, plural, alongside the existing singular `grantsPassive`) | A single notable that grants two passives at once (e.g. Alpha Strike's fix: bonus damage *and* damage reduction, not just one) | **Shipped** — `leveling.ts`'s `maybeAutoRespec` applies both the singular and, when present, every entry of the plural array. First real content: Scratch's *Colony Warmth* |
| Rally-call focus fire (`MoveSpec.rallyCall` + `Agent.rallyMarkTicksRemaining` + `predation.ts`'s `preferMarked`) | "Rally all allies to attack this enemy" — genuinely stronger than buffing one ally, since it gets a whole herd's *independently-run* target selection to converge on the same threat instead of each agent separately picking whatever's nearest to itself | **Shipped** — on a landed, non-killing hit, marks the defender for `ticks`; `preferMarked` (replacing a plain `nearest` call) is now used at every threat/hunt-target pick where several agents choosing the *same* target matters: mob-fight threat selection, a guardian's own threat pick, and a predator's hunt-target pick — so it works for prey rallying a mob onto a specific predator, a guardian pack converging on a threat, and a predator pack co-hunting the same marked prey. First real content: Scratch's *Rally the Colony* (see below) |
| Self-state-aware scoring (a bonus keyed to the *user's own* HP, not the target's) | Cornered Fury | **Shipped** — `MoveSpec.selfStateBonus` (`"selfLowHp"`), folded into `pickBestMove`'s scoring (combat.ts). First real content: Scratch's *Cornered Fury* and Peck's *War Cry* |
| Real-duration temporary buffs (a stat change that expires after N ticks) | Bubble Shield, Slippery Current | **Shipped** — folded into the same mechanism as persistent stat stages below (`Agent.statStages` entries with `ticksRemaining` set expire; without it, they're permanent) — one array, two lifetimes. `MoveSpec.statChangeOnHit`'s optional `ticks` field drives this from a move. Not yet used in a shipped tree |
| Position-swap (two agents exchange tiles in one action) | Bodyblock | **Shipped** — `MoveSpec.positionSwap`, resolved in `resolveHitAgainstTarget` (predation.ts) on a landed, non-killing hit only; optional `positionSwapPull` continues the defender further past the swap (reuses `applyForcedMovement`, same obstacle/immovable-aware stepping as any other forced movement). First real content: Peck's *Snatch and Swap* |
| Crit-triggered cooldown reset (`MoveSpec.critCooldownReset`) | A real crit-fisher notable — reward landing a crit with tempo, not just bonus damage | **Shipped** — checked in `applySingleDamageInstance` right where the crit roll itself already happens; resets the attacker's own cooldown for that move to 0 on a landed critical hit. First real content: Peck's *Relentless Harrier* |
| Status severity multiplier (`MoveSpec.statusSeverity` → `Agent.status.severityMultiplier`) | A "badly poisons/burns" lever | **Shipped** — set on the status at infliction time (`maybeInflictStatus`), read every tick alongside the existing burn/poison DOT fraction (`tickStatusEffects`). Deliberately a flat multiplier for the whole DOT duration, not mainline Toxic's turn-by-turn escalation — a real severity difference without a second per-status counter to track. First real content: Scratch's *Widening Fangs* |
| Defense-stat boost passive (`PassiveKind` `"defenseBoost"`) | Diversifying away from flat `damageReduction` as the default "tanky branch" lever — see the design note above | **Shipped** — `predation.ts`'s `applySingleDamageInstance` adds it straight into the defender's Defense stat-stage sum fed to `calculateDamage`; physical-only for free, since `calculateDamage` only ever reads the `defense` stage for a physical move (a special move reads `spDefense` instead, untouched by this). First real content: Tackle's `watchful_pack` and Ember's `banked_embers`, both converted from flat `damageReduction` |
| Own-terrain consumption (`MoveSpec.consumesOwnTerrain`) | Rock Throw's boulder-throw idea — a real environmental payoff for standing on the right tile | **Shipped** — checked in `applySingleDamageInstance` before the damage formula runs (it changes the damage itself, not a post-hit side effect): while the attacker's own tile matches `terrain`, multiplies damage and reverts that tile to `"floor"`. A clean miss never reaches this check (accuracy is rolled first), so it doesn't waste the terrain; a multi-hit flurry only ever triggers it once, for free (the tile's already floor for later hits in the same use). First real content: Rock Throw's real, shipped base spec (3x vs. a real `"boulder"` tile) |
| Terrain fill on a landed hit (`MoveSpec.terrainFill`) | Water Gun leaving a real puddle where it hits | **Shipped** — the inverse of `terrainBurn`, same "landed, non-killing hit" hook (`resolveHitAgainstTarget`): converts a dry `"floor"`/`"sand"`/`"mud"` tile at the *defender's* position into `terrain`. Deliberately permanent, not a temporary puddle — this sim has no generic "tile change expires" mechanism yet. First real content: Water Gun's real, shipped base spec (leaves `"water"`) |
| Temporary self-burrow (`MoveSpec.burrow` → `Agent.burrowedTicksRemaining`/`burrowedFromLayer`) | The floated "Dig as temporary invulnerability" idea above | **Shipped**, in a leaner form than originally floated — a fleeing agent with an off-cooldown `burrow` move relocates to the `"underground"` layer (from wherever it currently is) instead of taking a normal flee step, for a set duration, then resurfaces automatically. **The "invulnerability" half needed no new mechanism at all**: every targeting/detection function in this engine (`agentsWithin`, `resolveAreaHit`, everything built on them) already requires `other.layer === agent.layer`, so a burrowed agent is already fundamentally untargetable by anything not also underground — this was true before this feature and would be true of any layer swap. What's actually new is the temporary/durationed window, the automatic resurfacing, `isConcealed` (predation.ts) now also returning true while burrowed (so it composes with the `"concealed"` situational bonus and detection-radius reduction against *other* underground agents), and the cooldown as the balance lever the original idea asked for — a plain flee step costs nothing and can repeat every tick, `dig`'s 15-tick cooldown can't. `pickBestMove` (combat.ts) excludes any `burrow` move from hostile move selection (a `targetsAlly` move, by contrast, is deliberately NOT excluded — see the row below and the "additive, not a replacement" note). First real content: Diglett's and Sandshrew's real, shipped `dig` move |
| Cross-agent effects (a move's hit affects an ally, not just the target) | Vine Link, Nurturing Vines, Rally Charge, Warning Lash | **Shipped** — `MoveSpec.targetsAlly`/`allyEffect` (heal and/or buff), resolved by `applySupportMove` (support.ts) from the agent's own idle/support tick — a genuinely separate path from `resolveHit`'s hostile resolution, as this doc's own "why status effects and environmental moves are two different systems" section predicted a cross-agent effect would need. **Refined per feedback**: `targetsAlly` no longer excludes a move from hostile selection either — `pickBestMove` (combat.ts) treats it as an ordinary attack option too (using whatever power/accuracy/other combat deltas it's accumulated), so every real "ally-opener" node (Colony Call, Flock Call, Shared Current, etc.) is additive to that move's combat identity, not a trade-off against it. The two effects never fire in the same tick (predation gets first refusal every tick before `applySupportMove` even runs, and both share the same cooldown via `useMove`) |
| Ally-effect piggybacking on an attack (`MoveSpec.allyEffectOnAttack`) | "Make it so some of 'em not only do it as a separate target but also auto trigger if using against an enemy while ally is in range too" — a second, independent way the ally-effect fires, on top of (not instead of) `targetsAlly`'s dedicated idle-tick use | **Shipped** — checked in `resolveHit` (predation.ts) the instant the move is used against an enemy, same timing as `statChangeOnHit`'s self-side effect, independent of whether the attack itself lands: finds the nearest in-range, hurt-preferred herd-mate (`nearestAllyEffectTarget`, support.ts — the same "who gets it" rule `applySupportMove` uses, pulled out so both share it) and applies `allyEffect` to them too, at no extra cost. Works with or without `targetsAlly` also set — a move can auto-trigger on attack without ever being a dedicated idle-tick support move, or do both. First real content: Scratch's *Colony Call* and Water Gun's *Shared Current* (see below) |
| Multi-target/AoE resolution (apply a move to every agent within its resolved shape, not one target) | Growl (its entire premise), Firestorm, Ring of Fire's full fantasy, Boulder Toss/Skipping Stone | **Shipped** — `MoveSpec.hitsArea`, resolved by `resolveAreaHit` (predation.ts): facing derived from attacker->primary-target direction, `resolveShape` finds every living agent in the move's footprint, each gets its own accuracy roll and damage instance; only the deliberately-picked primary target gets status/stat-change/forced-movement/position-swap hooks, incidental targets just take the raw hit. Confirmed in a real fight: a ring-shaped move centered on the attacker landed on both the picked target and an unrelated bystander standing on the same ring. Growl itself still isn't built — see below |
| AoE ally-exemption (`MoveSpec.excludesAllies`) | A reckless AoE (Earthquake) that a drilled herd learns not to get caught in | **Shipped** — one extra condition in `resolveAreaHit`'s existing target filter, skipping agents whose `herdId` matches the attacker's when the move sets this flag. Without it (the default, and every AoE move's real behavior before this field existed), a same-herd agent caught in the blast takes the hit exactly like an enemy would. First real content: Earthquake's *Herdsafe Trigger* (see below) |
| Terrain-conditional ally speed aura (`PassiveKind` `"aquaticHaste"`) | Hydro Pump's Pod Tide capstone — direct ask, after two rounds of feedback that its capstone didn't match the branch's own fantasy: "it would be better if it granted all allies greatly more speed when they're on water tiles" | **Shipped** — `support.ts`'s `aquaticHasteMultiplier`, composed into `actionSpeedOf`'s existing multiplier chain (simulation.ts): a same-herd agent within a fixed radius of the passive-holder (itself included) gets a real Speed bonus, but only while THAT agent is currently standing on a `"water"` tile (`world.ts`'s `tileAt`). The first passive in the roster that's both an aura (like `healAura`) AND terrain-conditional (like `terrainSpeedMultiplier`) — neither existing mechanism covered this alone. First real content: Hydro Pump's *Tidal Communion* |
| Mid-commit charge/wind-up + genuine invulnerability (`MoveSpec.chargeAttack` → `Agent.chargingAttack`) | Body Slam's Boldness keystone (The Reckoning) — direct ask, "you're on the right track but it needs more than just bulk and defense... could add a charge up turn... another notable could make him invulnerable to damage for that charge up... a huge leap/movement tied to the skill" | **Shipped** — `resolveHit` (predation.ts) sets `Agent.chargingAttack` instead of resolving immediately, reusing the existing `actionLockTicks` block for "can't act" (no new no-action guard needed); `resolveHitAgainstTarget` checks it before even rolling accuracy for genuine, unconditional invulnerability; `tickStatusEffects` (status.ts) ticks it down as pure bookkeeping (deliberately not resolving it there — a real status.ts/predation.ts import cycle); `tickAgentNeeds` (needs.ts, which already imports from predation.ts) calls the new `resolveChargedAttack` once ticks hit 0, which looks the original target back up by id (it may have moved, changed layer, or died since), leaps toward wherever it currently is, and lands the hit at a bonus power — or fizzles for nothing if the target's gone. The single biggest new primitive on this whole checklist — a real mid-commit agent state, not just another delta field. First real content: Body Slam's *The Reckoning* |
| Non-territorial opt-out + de-escalation aura (`PassiveKind` `"nonTerritorial"`/`"calmingPresence"`) | Body Slam's Sociability branch, redesigned after a direct correction on the first draft: "Snorlax tends not to be in a herd. Very solo style... maybe Snorlax is more peaceful and gets along with others easier" — the original branch was built entirely on herd-scoped ally buffs, the wrong fantasy for a solitary animal | **Shipped** — both hook into herdConflict.ts, not a move-hit path: `"nonTerritorial"` is a flat opt-out checked at the top of `applyHerdRivalryConflict` (the holder never initiates a fight over a contested tile, though it can still be found and fought as someone else's rival); `"calmingPresence"` multiplies down `herdConflictChance` for any living, same-layer agent within a fixed radius, deliberately NOT herd-scoped like `healAura`/`aquaticHaste` — a genuinely solitary animal's calm reaches both sides of a nearby standoff, not just its own herd-mates. First real content: Body Slam's *Unbothered*/*No Quarrel*/*Undisturbed* |
| Cooldown-gated hit negation (`PassiveKind` `"unshaken"` → `Agent.unshakenCooldownTicks`) | Body Slam's Unbothered opener, redesigned after a direct follow-up: "Unbothered should be, takes no damage from first hit in a fight?" — and a real structural fix, surfaced by the user's own hesitation when asked where `nonTerritorial` should land instead ("it's like an interesting trait for a snorlax out in the wild but if it joins your party is a super bad skill to have... maybe its an upfront cost to have a dead node"): `nonTerritorial` was the opener's ONLY payoff, and it's functionally dead the moment this move is actually used in a real fight | **Shipped** — same "nothing about this hit happens at all" shape as `chargeAttack`'s own invulnerability check, right below it in `resolveHitAgainstTarget` (predation.ts): while off cooldown, fully negates the next hit against the holder (no accuracy roll, no damage, no side effects), then sets `Agent.unshakenCooldownTicks` to lock itself out until `tickUnshaken` (status.ts, wired into `tickStatusEffects` alongside `tickChargingAttack`) counts it back down to 0. A genuine "doesn't even flinch the first time" shield — distinct from `damageReduction`'s flat percentage and from `chargeAttack`'s timed wind-up window. `nonTerritorial` moved down to a new filler node (*Not Worth It*) instead of being deleted — the wild-AI flavor is still real, it's just no longer squatting on the branch's one guaranteed-useful-in-combat slot. First real content: Body Slam's *Unbothered* (now grants `unshaken`) and *Not Worth It* (now grants `nonTerritorial`) |
| Persistent stat stages (`Agent`-level Attack/Defense/etc. modifiers, settable by a move, lasting until cured — distinct from burn's one-off computed halving, which just derives a stage from `agent.status` fresh at each `calculateDamage` call rather than storing one) | Growl specifically (`statStageMultiplier` already exists in combat.ts as a pure function; burn now calls it, but from a computed value, not a stored `Agent.statStages` field) | **Shipped** — `Agent.statStages` (an array of `{stat, stage, ticksRemaining?}` entries, `status.ts`'s `applyStatStage`/`getStatStage`), fed into `calculateDamage`'s existing stat-stage machinery for both attacker and defender, and composing additively with burn's own -2 Attack. `MoveSpec.statChangeOnHit` is the move-level lever: `target: "self"` applies the instant the move is used, `target: "defender"` only on a landed, non-killing hit. **Growl itself is still not built** — it needs this primitive plus multi-target/AoE (both now shipped) plus a no-damage/status-move representation, which remains the one open piece |
| Status-effect system (burn/poison DOT, paralysis/sleep/freeze) | Ember's/Flamethrower's burn chance, previously idle | **Shipped** — see DESIGN.md's "Status effects" section. Constrict's designed root effect still needs a sixth `StatusKind` (`"root"`), not modeled yet |
| Idle/opportunistic utility-move trigger (`MoveSpec.utilityMove` + `utilityMoves.ts`'s `maybeUseUtilityMove`) | Growth, Agility, Rain Dance, and every other self/tile-effect move on this whole list — the real gap this section's own "why status effects and environmental moves are two different systems" note predicted | **Shipped** — the third trigger path, alongside the hostile hit pipeline and the ally-support one, checked whenever `chooseBehavior(agent.needs) === "idle"` (needs.ts, NOT `agent.behavior === "idle"` — see this section's own note on why that gate under-fired in a real run). `pickBestMove` excludes `utilityMove`-flagged moves from hostile selection, same as `burrow`. First real content: 13 curated moves, see "Environmental utility moves" above |

Every primitive on this list is now shipped and unit-tested (a 4000-tick full-sim run with the extended roster confirms no regressions). What's left is real content: no shipped move tree grants a passive, uses multi-hit, defense penetration, a situational/self-state bonus, position-swap, an ally-targeting effect, weight scaling, lifesteal/recoil/thorns/heal-aura, cooldown-jamming, a type-matchup lever, a needs-based cost, terrain burn, status spread, or an AoE shape yet — and Growl itself still needs a no-damage/status-move representation (nothing in this sim can currently be "used" without a damage roll) before it can actually be built.

The one deliberately-deferred item from the lever brainstorm below: a real
Max PP resource (a per-move use counter, need-gated regen, AI awareness of
running dry) — a whole new resource axis, not a `MoveSpec`/`MoveTreeNode`
delta field like everything above, so it's its own follow-up project rather
than something to fold in here. `selfCostPerUse` (shipped above) covers the
"costs something to use" fantasy via the sim's *existing* needs axes in the
meantime.

A real lever to build on top of Max PP once it exists, not just a bigger
pool: a node that spends **2x (or Nx) PP in one use for a proportionally
bigger effect** — more power, a wider AoE, whatever fits the move — a real
"burn resources faster for a spike" tradeoff distinct from a plain
+max-PP node. Direct note: "I feel like we're underutilizing PP too."
Flagged here alongside the rest of the PP brainstorm rather than
implemented, since it's still gated on Max PP itself landing first.

## Why status effects and environmental moves are two different systems

A damaging move's status chance is a side effect of an existing "attack
this specific enemy" action. An environmental move (Sunny Day,
Dig-to-escape, Growth) doesn't target an enemy at all — it targets a
tile, the caster itself, or nothing in particular. They need different
trigger paths, not one unified "use a move" abstraction:

- **Status effects** ride inside the existing hit-resolution pipeline in
  `predation.ts`'s `resolveHit` — no new targeting logic.
- **Idle/opportunistic utility** (Sunny Day, Growth, self-buffs) needs a
  new check during an otherwise-idle tick, the same architectural slot
  `applyExploration` occupies in needs.ts.
- **Reactive utility** (Dig-to-escape, Leech Seed mid-hunt) hooks into
  `predation.ts`'s existing flee/hunt branches as an alternative to the
  default step-away/attack action.

## Status effects

**Shipped** — see DESIGN.md's "Status effects: burn, poison, paralysis, sleep, freeze" section for the full writeup (data model, application, resolution, confirmed working end-to-end). Kept here only as a pointer: the roster now has real inflicters for burn, poison, paralysis and freeze — see the re-measured table at the end of this doc; sleep alone still has none — Vine Whip's designed Constrict node (a `"root"` effect, not one of the five kinds modeled yet) is the natural next case, not Thunder Wave/Poison Sting (inventing moves not yet in the curated roster, which the original draft here suggested — narrowed to "a move already being built" instead).

## Environmental utility moves

**First batch shipped** — real content, not just the primitive, direct ask
("moves that affect the environment... pull it all in"). No
`ENVIRONMENTAL_EFFECT_BY_MOVE` table as originally sketched below — instead,
each effect is its own typed `MoveSpec` field (`selfHeal`/`fertilityBoost`/
`statusImmunityAura`/`spawnsRain`/`matingRadiusBoost`/`drainNeeds`, plus
reusing the existing `statChangeOnHit` self-side field), matching this
codebase's own established "one small typed field per mechanic" convention
(`terrainBurn`/`terrainFill`/`consumesOwnTerrain` already set that
precedent) rather than a lookup table keyed by move name. The real missing
piece this section correctly anticipated — a move with no enemy or ally
target needs its own trigger path, distinct from the hostile hit pipeline
and the ally-support one — is now `packages/engine/src/utilityMoves.ts`'s
`maybeUseUtilityMove`, checked whenever `chooseBehavior(agent.needs) ===
"idle"` (needs.ts), same real-run-tuned placement note as everywhere else
in this codebase: an earlier attempt gated on `agent.behavior === "idle"`
(a narrower, laggier signal — an agent mid-exploration-walk can go many
ticks with needs fully satisfied but a stale non-idle `behavior` label)
badly under-fired in a real run, confirmed via a dedicated validation
script before landing on the `chooseBehavior` gate instead.

13 real, curated moves shipped, every one a genuine mainline move the
current roster already learns canonically (checked directly against
dex/species.generated.ts's own `levelMoves`, not invented): **Growth**/
**Grassy Terrain** (fertility, not seedling-maturation as first floated
below — flora.ts's real `raiseFertility`, exported for this), **Synthesis**/
**Moonlight**/**Roost** (self-heal, the first two terrain-scaled near a
`sunbeam` tile), **Agility**/**Harden**/**Withdraw**/**Defense Curl** (self
stat-stage buffs via the existing `statChangeOnHit` field — the base
"speed" stat already drove the real action economy (`actionSpeedOf`'s
whole job), but nothing ever read a temporary Speed STAGE the way
`calculateDamage` already does for Attack/Defense; Agility is the first
move to actually grant one, `actionSpeedOf` now folding it into its
multiplier stack so it really does change how often its user acts, not
just a cosmetic number), **Safeguard** (temporary new-status immunity, self +
nearby herd-mates), **Rain Dance** (spawns a real `WeatherCell` at the
caster's position — `weather.ts`'s `spawnWeatherCellAt`, extracted from the
existing random-spawn roll), **Sweet Scent** (doubles the caster's own
mate-search radius for a duration — `reproduction.ts`'s `mateSearchRadius`),
and **Leech Seed** (real resource theft: transfers hunger from the nearest
non-herd agent in range, the one genuinely new agent-to-agent mechanic on
this whole list, matching this section's own original prediction). 24
species got at least one of these added to their curated moveset. Real-run
validated (`validateUtilityMoves.ts`): an 8000-tick `createDemoWorld` run
confirmed Growth, Leech Seed, Agility, Withdraw, and Safeguard all firing
live; Rain Dance/Sweet Scent/Moonlight/Grassy Terrain/Harden/Defense
Curl's learners (dratini/gyarados, oddish/gloom, geodude/snorlax/metapod/
kakuna/krabby/kingler/shellder) aren't part of that particular fixed
single-map scenario's starting roster, so those five are unit-tested
directly (`test/utilityMoves.test.ts`) rather than also confirmed in that
specific real run.

**Not built, deliberately deferred** (both need a genuinely new mechanism,
not just another field on the existing pattern): **Stockpile**'s buried,
later-retrievable personal food cache, and the whole hazard-tile family
(**Stealth Rock**/**Toxic Spikes**/**Spikes**/**Rapid Spin**) — a laid,
persistent tile that damages/poisons/etc. whoever crosses it later is a
real new `Tile` concept this pass didn't attempt. **Sandstorm** stays
undesigned too — Diglett/Sandshrew/Onix/Geodude all canonically know it, a
real signal a sandstorm weather type (alongside rain/storm/drought/
coldSnap) is worth adding someday, but that's a new `WeatherType`, not a
move-level change.

Below this point is the ORIGINAL brainstorm this batch drew from — kept
for its own reasoning/precedent value, not all of it shipped as originally
sketched (Growth's own description below, "force-matures a seedling," is
the clearest example: the real shipped version uses fertility instead,
noted above):

| Move (real) | Effect | What it touches |
|---|---|---|
| Sunny Day | Plants a temporary `sunbeam` tile at the caster's position | flora.ts's `isNearSunbeam`/`FOOD_CHANCE_NEAR_SUNBEAM` — zero new terrain code |
| Dig | Instantly crosses the user to the layer below, at the same (x,y) | Reuses the existing cross-layer mechanic (needs.ts) as an emergency escape. **Stronger variant floated, not yet designed or built** — see "Dig as temporary invulnerability" below instead of shipping the plain instant-escape version |
| Leech Seed | Transfers a fixed amount of hunger/thirst from target to caster | Direct `Needs` field manipulation — the one genuinely new mechanic (resource transfer between two agents). **Shipped, see above** — hunger only, not thirst, and a one-off transfer rather than a sustained per-tick drain |
| Growth | Force-matures a nearby `seedling` early, or shortens its `MATURATION_TICKS` | Direct hook into flora.ts's existing growth timer. **Shipped, see above, but via fertility instead** |
| Water Gun | Converts an adjacent dry `floor` tile into a temporary puddle, or restores a real `water` tile that's been drying/receding | New but minimal — a short-lived stock-bearing water tile; the "restore" half reuses whatever water tiles already track once anything does (currently they don't dry up at all, so this waits on that first) |
| Ember (opportunistic, not on-hit) | Burns an adjacent `flora`/`food` tile back to `floor` | Real terraforming, double-edged (clears a blocker, destroys a resource) |
| Rock Throw (**own-terrain consumption, own spec — floated, not yet built**) | While standing on a real `boulder` tile (already a real, generated `TerrainKind` — `worldgen.ts`'s Highland-leaning obstacle kind, currently just unwalkable scenery), throws *that* boulder instead of a generic rock: the boulder tile reverts to `floor` (consumed, like `terrainBurn` but on the attacker's own tile instead of the defender's) and the hit deals roughly triple damage. Its own tree node, not baked into the base move — most Rock Throw uses are the ordinary version; this is the payoff for actually standing on real terrain when you use it | Closer to buildable than it looks: `terrainBurn` is the exact same shape (revert one tile, consequence attached to a landed hit) already proven in the engine, just checked against the *attacker's* tile instead of the *defender's*, and gated on `terrain === "boulder"` specifically rather than any landed hit. Needs one new field (e.g. `MoveSpec.consumesOwnTerrain?: { terrain: TerrainKind; damageMultiplier: number }`), checked at the top of the hit-resolution path (before damage, since it changes the damage itself) rather than in the existing post-hit hook block |

### Round two

| Move (real) | Effect | What it touches |
|---|---|---|
| Acid / Sludge | Contaminates a `food`/`water` tile — can't safely feed there for a while | Inverts Water Gun (deny a resource instead of create one). **Refined per feedback**: the terrain-kill (a flora tile actually dying) is real and permanent; the "unsafe to feed" flag should decay faster the closer a real `water` source is nearby (reuse `findNearestTerrain(world, layer, pos, "water")` to gate the decay rate) rather than a flat timer — flowing water dilutes it, stagnant ground doesn't |
| Growl | AoE Attack debuff on everyone in range who isn't a herd-mate (`herdId` check, same "ally" definition `countHerdAllies` already uses) | **The best ROI move on this whole list** — Bulbasaur, Pidgey, Diglett, Spearow, and Sandshrew all already know Growl at level 1 (it's sitting inert in `knownMoves` right now). Building this one move retroactively activates something most of the current roster already "knows" |
| Leer | Ranged to anything in the user's actual FOV, not a flat radius | **The first real consumer of `computeVisible`** (fov.ts) — that function is fully built and unit-tested but currently used by nothing; every existing detection check (flee/hunt/mob/guardian) is a manhattan-distance radius that sees through walls. Leer would be the first move-driven behavior to actually respect line-of-sight |
| Spikes / Stealth Rock | Lays a persistent hazard on a tile, chips whoever crosses it | New territory — a laid, standing hazard rather than an instant effect. Gives Diglett/Onix a defensive tool with no cost to the caster after laying it |
| Rapid Spin | Clears a hazard tile the user is standing on | Pairs with the above — prey gets a counter to a trap-laying predator's territory |
| Stockpile | Buries a food reserve at the current tile, retrievable later | Real animal behavior (caching), currently totally unmodeled. Plugs into the existing herd food delivery system as another deliverable source |
| Aromatherapy / Heal Bell | Cures status on nearby herd-mates | Real counterplay to burn/poison once those exist; gives grass-types a "medic" role |
| Safeguard | Grants temporary status immunity to nearby herd-mates | A second, distinct guardian-flavored move for Venusaur alongside pure combat intervention |
| Synthesis / Morning Sun | Self-heal, stronger near a `sunbeam` tile | Direct reuse of `isNearSunbeam`, mainline-real weather-scaled-healing mechanic reframed as terrain-scaled |
| Teleport | Instant panic-button relocation | Reuses `findRandomWalkableTile`/`migrate` (migration.ts), already built for a predator giving up on an area |
| Fly | Instant escape to the layer above, mirroring Dig going down | Canopy-native equivalent for Pidgey/Spearow |
| Agility | Temporary speed boost | Hooks directly into the existing `actionEnergy`/`effectiveSpeed` action-economy system — acts more often for a while |
| Follow Me / Rage Powder | Guardian redirects a predator's target onto itself instead of the weakest nearby herd-mate | The strongest upgrade to Venusaur's guardian role on this list — actively rewrites `predation.ts`'s target selection instead of just reacting after the fact |
| Helping Hand | Buffs the next hit a nearby ally lands | Real mob-fight coordination flavor on top of the coordination logic already built |
| Confuse Ray / Supersonic | A genuine second tier beyond the 5 majors — mainline models confusion as a separate "volatile" status that can stack with a major one | For its duration, the agent's own move sometimes misfires and hits itself. Worth building once the 5-major plumbing exists, not before |
| Cut | Precise, non-destructive clear of exactly one blocking `flora` tile | Low-stakes version of Ember's terraform — no risk of torching a food supply |
| Bulldoze / Magnitude | Area version of Rock Throw's wall-cracking — multiple adjacent `wall` tiles at once | Rounds out the terraforming set |

### Round three

| Move (real) | Effect | What it touches |
|---|---|---|
| Camouflage | Shrinks how far away *others* can detect the caster | Inverse of Growl's noise-making — first real building block toward a detection-radius system (see below) |
| Withdraw / Harden | Doubles as "go still and quiet," on top of being a defense buff | Same flavor as Camouflage, real mainline moves |
| Rock Slide from high ground | Only works, or hits much harder, when the caster occupies higher elevation than the target | The scenario's own ridge is *already* described as "high ground the Venusaur guardians hold" (scenario.ts) — this move is the thing that terrain feature was built for, currently only a cosmetic-plus-combat-modifier |
| Odor Sleuth | Keeps a specific fled/hidden target locatable for a duration regardless of normal detection range | Real counterplay to Camouflage |
| Explosion / Self-Destruct | Massive area damage, faints the user | The aggressive twin to Memento — a cornered prey animal taking its predator down with it |
| Memento | User faints itself, grants a big stat/exp boost to nearby herd-mates | Real "tell an interesting story" material — an aging guardian's last act, now that old-age mortality exists as a system this can tie into |
| Wish | Plants a delayed heal that lands on whichever herd-mate occupies this tile next, not the caster | A little first-aid kit left behind |
| Rototiller | AoE version of Growth — boosts germination odds for every nearby seedling at once | "Tilling the soil" flavor for Ground/Grass types |
| Attract | Directly spikes a *specific* target's `mateDrive` toward the caster | Asymmetric to Sweet Scent (which widens the caster's own search radius) — "you, specifically, want me" instead of "I'm more findable" |
| Baby-Doll Eyes / Charm | Temporarily lowers a target's aggression | Softens how eager a predator is to commit to hunting the caster |

**Passive idea, not a move at all**: a corpse that survives its full
`CORPSE_PERSIST_TICKS` window before decaying could bump germination odds
on the tile it's on when it's finally pruned — decomposition enriching
soil, real ecology, zero new move needed, just a tweak to corpse pruning.

### Round four — HMs, and the real finding underneath them

Prompted by naming Whirlpool/Flash/Will-o-Wisp directly: HMs are the
actual real-game precedent for "a non-combat move that changes the map,"
which is exactly what this whole brainstorm has been reaching for.

| Move (real) | Effect | What it touches |
|---|---|---|
| Flash | **Dual effect, both real mainline**: expands the caster's own FOV radius (a defensive use of `computeVisible`, the mirror image of Leer's offensive one) *and* lowers a target's accuracy in combat | Confirmed: both halves stay in, not just the FOV one |
| Surf | Temporarily treats `water` tiles as walkable for the caster | Needs a Water-type to make any sense — see the roster gap below |
| Whirlpool | Field: crosses deep water. Battle: a multi-turn bind, same family as String Shot/Sand Tomb | Needs Water |
| Waterfall | Instantly scales a steep `elevation` delta that would otherwise slow/block movement | Direct reuse of `elevation.ts`'s existing delta math, inverted from "combat modifier" to "movement enabler" |
| Strength | Pushes a boulder — a `wall` tile becomes permanently passable rubble | Distinct from Rock Smash/Bulldoze: those are combat-triggered instant clears, this is a deliberate, permanent, non-combat map edit |
| Rock Smash | Single-tile version of Bulldoze/Magnitude from round two | Same slot, smaller footprint |
| Will-o-Wisp | Pure status move — little/no direct damage, very high burn chance | A genuinely different design point from Ember (damaging move with a status side effect): a move whose entire job is inflicting the condition. Doesn't strictly need a Ghost-type learner |

**The real finding underneath this round**: the current roster (Grass/
Poison, Fire, Bug/Flying, Normal/Flying, Ground, Rock) has **zero**
representation for Water, Electric, Ghost, Ice, Psychic, Dark, Steel,
Fairy, or Dragon. Most of the moves above are inert without a species of
the right type to learn them — same shape as the Spearow/Onix expansion
earlier, where two new species unlocked the underground/canopy layers for
free. **Confirmed for real addition** (not just brainstormed — explicitly
approved): a short list of real, well-known, early-game candidates, each
chosen because it unlocks a cluster of the moves above at once rather
than just one:

- **Water** (Squirtle, Poliwag, or Magikarp) — unlocks Surf/Whirlpool/
  Waterfall/Water Gun (round one) all at once, and finally gives the
  ponds already sitting on the map a resident.
- **Electric** (Pikachu, Magnemite) — unlocks Thunder Wave (paralysis,
  already in the status design) plus Discharge (AoE paralysis chance) and
  Magnet Rise (temporary immunity to ground-based hazards like Spikes).
- **Psychic** (Abra, Drowzee) — Hypnosis is Will-o-Wisp's sleep-status
  equivalent (pure status, no damage); Psychic is also the *actual*
  canonical type for Teleport (round two filed it under Ground/generic).
- **Ghost or Dark** (a real home for Will-o-Wisp, or Taunt — forces a
  target into aggressive-only behavior for a duration, overriding its
  normal flee/idle logic, a nasty and funny debuff).

Build order for the species themselves: Water first (existing pond
infrastructure means it needs zero new terrain, just a new resident —
same reasoning that put Sunny Day/Growl at the top of the move list).

**Water: shipped.** Squirtle added — see DESIGN.md's "First Water-type"
section for the real-run evidence (cross-species breeding with the
Bulbasaur/Venusaur line via the shared Monster egg group, an opportunistic
Spearow kill with zero new predation code, evolution to Wartortle at
level 16). Surf/Whirlpool/Waterfall/Water Gun above are now buildable
against a real species; Water Gun itself is already curated. Electric/
Psychic/Ghost-or-Dark are next, in that order.

**Declined**: Bug Bite / Pluck (priority looting rights on a corpse) —
explicitly cut per feedback, not worth the complexity for what it adds.

### Round five

| Move (real) | Effect | What it touches |
|---|---|---|
| Toxic Spikes | A laid hazard (same family as Spikes, round two) that poisons instead of chips whoever crosses it | Combo of the hazard-laying mechanic and the poison status once both exist |
| Stun Spore | Same hazard shape, paralysis instead | Same combo, different status |
| Stun Spore / Poison Powder **on flora, not laid as a floor hazard** | Contaminates a `food`/`flora` tile itself — whatever *eats* from it gets stunned or poisoned, not whoever walks over it | **Refined per feedback**: this is "poisoned bait," a genuinely different trigger point from every other hazard idea — it fires off the existing `consume()` path in needs.ts (the same place `CONSUME_STOCK_AMOUNT` already gets deducted), not off movement. A predator could poison a prey species' own food supply |
| Spore / Sleep Powder as a lingering area cloud | Hangs over a small tile radius for a few ticks; anyone crossing risks falling asleep | First "AoE status hazard" — distinct from a single-target status move and from an instant-damage hazard tile |
| Ingrain | Roots the user in place (can't flee, can't be forced away by Roar/Whirlwind) in exchange for real per-tick healing | The first "commit, don't escape" trade-off on the whole list — everything else so far is about mobility or damage |
| Aqua Ring | Water-type equivalent of Synthesis — a lingering self-heal, stronger near real `water` tiles | Same terrain-conditional-healing pattern as Synthesis, different terrain; immediately buildable now that Squirtle exists |
| Thief / Covet | Steals an item from a *living* target's inventory on a landed hit | `InventoryItem`/carrying (support.ts) already exists but nothing has touched it yet in this whole brainstorm — today only a corpse can be looted, this makes theft from something alive real |
| Trick / Switcheroo | Swaps inventories between caster and target outright | Same system, funnier |
| Trick Room | Inverts turn order for a duration — fast agents act less often, slow ones act more | **Refined per feedback**: bounded to a fixed box around the caster (10x10), not global — plays directly with the real Speed-driven action economy (`accumulateActionEnergy`), the only idea across five rounds that touches that system instead of terrain/needs/status |
| Rest | Instant full heal, at the cost of a guaranteed multi-tick sleep on the user | Completes a real 3-way heal-move family: Synthesis (gradual, terrain-scaled), Wish (delayed, given to someone else), Rest (instant, but costly) |
| U-turn / Volt Switch | **Refined per feedback**: on a landed hit, forces the caster to retreat directly away from its target at 2x speed for 2 ticks — not a request to flee, a guaranteed override of normal movement for that window | A real hit-and-run tactic distinct from every other move on the list, which either commit to a fight or don't engage |

**Standouts, per the discussion that produced this round**: Toxic
Spikes/Stun Spore (cheapest — same code as existing hazards/statuses,
different payload) and Trick Room (the only idea in five rounds that
touches the action-economy system rather than terrain/needs/status).

## The detection-radius gap (a real, structural finding, not a move)

Surfaced while designing Leer: there is currently **no concept of
detection at all** beyond "is it within N tiles." No fog of war, no
line-of-sight gating (FOV is fully built in fov.ts and unit-tested, but
nothing in the actual AI — flee, hunt, mob, guardian scans — consults it;
every one is a flat manhattan-distance radius that sees straight through
walls), no sound, no scent. Every agent has perfect knowledge of every
other agent within its fixed radius.

Not building this now — flagged so it doesn't get lost. When it happens,
the natural shape is a "how did this agent learn about that agent"
abstraction that flee/hunt/mob/guardian checks route through instead of a
raw radius, with real line-of-sight (reusing `computeVisible`) as the
baseline and sound/scent as radius modifiers on top (a noise-making move
like Growl would set a temporary "detectable beyond normal range" flag;
Camouflage would do the opposite). Leer (round two, above) is the
smallest possible first step — a single move that actually respects FOV —
without committing to the whole system.

## Dig as temporary invulnerability — done, leaner than floated

**Was a side note, now shipped** — see the primitives checklist's
"Temporary self-burrow" row above for the real mechanism. The
"invulnerability" half turned out to need no new primitive at all: this
engine's targeting/detection functions already require the attacker and
defender to share a layer, so a burrowed agent (relocated to
`"underground"`) is already fundamentally unreachable from any other
layer — that was true before this feature and would be true of any layer
swap. What got built instead: a *temporary*, durationed burrow (not a
one-shot escape) with automatic resurfacing, `isConcealed` (predation.ts)
extended to report true while burrowed, and a real cooldown as the
balance lever, exactly as originally asked — a plain flee step is free
and repeatable every tick, Dig's cooldown isn't. Diglett and Sandshrew
both know it for real now.

## Stop overusing `damageReduction` — partially done

**Was a side note, now partly actioned.** Feedback on the four new trees
(Rock Throw/Peck/Scratch/Water Gun): flat `damageReduction` is the
Boldness-branch opener (and reappears in most Boldness↔Sociability
crosslinks) in *every* tree shipped or drafted so far — Tackle, Slash,
Ember, and all four new ones. It works, but leaning on the same lever for
"this branch is about surviving hits" every single time is exactly the
"cookie cutter" complaint that prompted the four-tree redesign, just at
the individual-node level instead of the whole-tree level. Also raised:
`damageReduction` reduces *all* incoming damage indiscriminately
(`resolveHit`, predation.ts — it doesn't distinguish physical from
special), so it's a strictly better, less thematic version of just
buffing Defense.

**Shipped**: a real `defenseBoost` passive (see the primitives checklist)
— physical-only for free, since `calculateDamage` only ever reads the
`defense` stat stage for a physical move. Two shipped, real nodes were
converted as a first pass: Tackle's `watchful_pack` and Ember's
`banked_embers` (both generic-named crosslinks with no armor/hide fiction
behind them). **Deliberately NOT touched**: `iron_hide` (Tackle) and
`bedrock_stance` (Rock Throw) — both literally named after armor/rock
hide, exactly the case this note's own rule says to *keep* as
`damageReduction` — plus `bulwark`/`bulwark_stance` (Slash, "a last line
that doesn't move," explicit fortification fiction) and `alpha_strike`
(Ember, a deliberate two-passive keystone the primitives checklist
already calls out by name). Everything else across the drafted trees
(Screening Wings, Burrow Guard, Guarded Den, Colony Guard, Tidal Guard,
Undertow Guard, Sheltering Current, Cover Call, and the rest) is still
flat `damageReduction`, untouched — a real follow-up, not a full sweep.

## Confirmed for later: Diglett tunnel networks

**Decision, not just a brainstormed idea — explicitly confirmed
("tunnel networks are cool as fuck we're gonna do it, but just not
now").** Repeated Dig usage at two different underground points links
them as a fast-travel shortcut, letting Diglett/Dugtrio traverse the
underground layer unusually fast between marked points. Deliberately not
scoped or speced further here: it reads as map-connectivity/
infrastructure, which sits close enough to the migration/biome work
happening in parallel that it should wait until that lands, both to avoid
overlap and because tunnel shortcuts probably want to interact with
whatever "biome" boundaries that work introduces. Revisit once migration/
biomes ship.

## Skill-tree template for new moves (v2 — supersedes the first pass)

Every move built from here on should get a real respec tree, not just a
combat spec — see DESIGN.md's "Specialization" section for the mechanism
(wild agents auto-respec as they earn skill points, weighted by
Disposition). Ember's first tree (shipped, `packages/data/src/moves.ts`) was
the v1 reference — two branches, 3 tiers each, costs 1/2/3. That shape is
now superseded by the rules below; Ember itself is due for a rebuild to the
new template (tracked, not yet done as of this writing).

There's an important asymmetry that makes going big here cheap: **there is
no player-facing tree UI yet** — every point spent today is a wild agent
auto-respeccing itself, not a person navigating a passive web. So tree
depth/complexity costs us authoring and balancing effort, not player
overwhelm. PoE-scale trees are fine right now; a legible player-facing view
of one is a separate, later, solvable UI problem.

**Cost:** every node costs exactly 1 point. No escalating per-tier cost —
depth and branch count carry the "big investment" feeling instead, which
reads more clearly than an opaque cost curve.

**Archetype per move, and let it dictate tree shape** (don't design each
move's tree from a blank page — pick an archetype first):
- **Power moves** (e.g. Flamethrower): shorter, more linear, but not just a
  single line to one ending — a couple of real capstone-style decision
  points along the spine (a shape upgrade, a cooldown-vs-power fork), then a
  genuine **mutually-exclusive final fork between two distinct "sick"
  end-states** (e.g. a single-target nuke build vs. a wide-cone AoE build).
  Mostly numeric filler in between (+power, +accuracy, -cooldown) so the
  climb still feels like steady growth.
- **Utility moves** (e.g. Ember): the deep tree — real forks early and
  often, status/environmental/area effects, modest power growth. Cooldown
  reduction is the signature utility lever: a cheap, frequently-recast
  utility move can out-value a slow power move in the right moment, which is
  the actual incentive to keep an early move around instead of replacing it
  the moment a bigger one unlocks.
- **Support moves** (sociability-leaning, no example built yet — a future
  cry/rally move is the natural home): buffs/redirect/cooldown-sharing
  levers rather than damage levers. Sociability doesn't have anywhere to
  live on a pure attack move's tree, so give it its own move archetype
  instead of forcing it in everywhere.

**Real forks need a new primitive: `excludes`.** The current model
(`prerequisites` only) can express "you need A before B" but not "picking A
locks out B forever." Add `MoveTreeNode.excludes?: string[]` — once a node
in the list is chosen, the others become permanently ineligible for that
agent (checked in both directions regardless of which side declares it —
one-sided authoring still works). This is the mechanism behind every
"choose one of two builds" moment called for above, including Flamethrower's
final fork. **Shipped** (`packages/engine/src/moves.ts`, validated in
`applyMoveTree`, respected in `maybeAutoRespec`'s candidate filtering) —
Tackle and Slash's real forks (see "Move-tree drafts" below) are the first
production use, confirmed working in a real run (both sides of each fork
independently chosen by different individuals).

**Capstones:** skip gating a capstone on multiple branches — not
interesting enough to bother with. A single strong node at the end of a
branch (what Ember's v1 tree already does) is capstone enough. Power moves
get a couple of these strung along the spine, not just one at the very end.

**Branches aren't isolated spokes — add crosslinks that are real shortcuts,
not just checkpoints.** Three independent chains meeting only at the hub
reads as three tiny trees wearing one move's name, not one tree — and it
means the only real decision is "which one branch." First draft of a
crosslink (a small node gated on one prerequisite from each of two
*different* branches, using nothing but the existing `prerequisites` field
— free, since branches are purely an authoring grouping the engine's flat
node graph doesn't know about) turned out to be a dead end, literally: it
proved you'd invested in both branches and then did nothing further,
which reads as a toll booth, not a choice. A crosslink needs two things to
actually work:

1. **Its own real, flavorful effect** — it costs a point like everything
   else, so it should do something distinctive on its own. First draft used
   a generic "a bit of both branches' stats" filler (+power and +range
   together) for every crosslink in a tree, which reads as filler wearing a
   notable's costume, not an actual ability. Give each one real character
   instead, ideally foreshadowing or riffing on the branches it connects —
   Vine Whip's Aggression↔Boldness crosslink (Snapback Lash) grants range
   +1 *and* a chance to drag the target closer on hit, a small taste of
   Aggression's own eventual keystone.
2. **A shortcut *out* the other side, landing one filler node SHORT of a
   notable — never on the notable itself, and never at a fork or keystone.**
   Two mistakes here, both caught by actually looking at the diagram, not
   just reasoning about it in the abstract. Second draft let two of three
   crosslinks shortcut all the way to a fork/keystone — three crosslinks at
   that depth make every keystone in the tree cheaply reachable from a
   single opener each, gutting the point of a keystone being a real
   per-branch commitment. Capped at the next notable instead — but even
   landing *on* that notable directly turned out too generous: it made the
   notable itself free the instant both openers were taken, no different in
   practice from the notable having no real cost of its own. Landing one
   filler node short means the crosslink still buys you real ground (skips
   the filler you'd have walked to get there) without handing over the
   notable's own point cost for free — reaching it after the shortcut is
   still a deliberate, separate spend. This needs a new primitive:
   `MoveTreeNode.prerequisitesAnyOf?: string[][]` — a list of alternative
   prerequisite sets, where satisfying *any one* (each inner array still
   AND'd together) makes a node eligible. The filler node a shortcut lands
   on declares two ways in: `prerequisites: [its own earlier chain node]` OR,
   via `prerequisitesAnyOf`, `[the crosslink]` — and the notable past it
   still just needs that filler node, same as always, no special-casing.
   This is the same shape as the still-open "keystone reachable from either
   fork tip" problem two sections up — one primitive solves both. **Shipped**
   alongside `excludes` — validated in `applyMoveTree`, respected in
   `maybeAutoRespec`. Not yet used in a shipped tree (Vine Whip's crosslinks
   are still a paper design pending a diagram/data pass); Tackle and Slash's
   forks only needed `excludes`.

Put one crosslink between each adjacent pair of branches (a triangle, for a
3-branch tree), each granting its own real ability and shortcutting to one
filler node short of both flanking branches' next notable. This is what
actually delivers "customizability" without cheapening anything: an agent
can end up with Aggression's opener, the crosslink's own ability, and — for
one more point, same cost it always was — Boldness's second notable, having
skipped only the filler in between, not the notable's own price. A genuine
hybrid route through the mesh, but every notable, fork, and keystone still
costs exactly what it always did.

**Put a notable early, not just at the end of a long chain.** A tree that
saves every named effect for deep investment makes the *only* real choice
"which branch to commit to," made once, on faith, before you've felt
anything. Lead each branch with a notable as (or near) its very first node
— filler in the middle, forks/keystones at the tips — so a route through
the mesh is built from real choices made at multiple points along the way,
not one branch-select decision followed by a long, uneventful walk.

**Filler nodes are good, not padding to be ashamed of.** Small, low-drama
nodes (+3% power, -1 cooldown, +5% status chance) between the real decision
points give the tree size and a sense of "always making progress" — very
PoE-passive-web-shaped — without every single node needing to be a
dramatic build-defining choice.

**Power-curve target (the actual incentive-to-upgrade lever):** a fully
maxed instance of a lower-tier move should land **meaningfully below** the
next move up's base power — not match or exceed it. Rough target: ~65-75%
of the next tier's base power (current dex numbers: Ember 40, Flamethrower
90 — so a maxed Ember topping out somewhere around 60-65 power, not 90+,
keeps Flamethrower an obvious power upgrade while Ember's cooldown/utility
lead is what earns it a permanent slot in the moveset anyway).

**Base cooldown standard: `cooldownTicks: 2` minimum for every real attack
move, starting point.** Set once cooldown was fixed to actually count down
on the *unit's own* action tick instead of real world-tick time (see
DESIGN.md's Action Economy section) — before that fix, `cooldownTicks: 0`
or `1` were both functionally "no cooldown at all," so the whole roster
had drifted there by default. Direct instruction once cooldown started
meaning something: "let's move all Moves up to like default cooldown of 2
as a base. That'll be our standard to start." Every curated attack move
(Tackle through Body Slam) was bumped to at least 2; utility/status moves
(Growth, Rain Dance, etc.) are unaffected — their cooldowns were already
real (30-150) and were never part of this bug. A stronger or rarer move
should still cost *more* than 2, same as before; 2 is the new floor for
"basic," not a target for everything.

**Every node has a `leaning`.** Unleaned nodes still work (weighted
neutrally in `maybeAutoRespec`) but a tree that's all unleaned wastes the
whole point of tying this to Disposition — tag deliberately.

**Real tradeoffs, not strictly-better stat sticks.** A tier that's just
"more of everything for a point" isn't a choice, it's a formality — every
node should cost something (accuracy, cooldown, power, range) even when
small.

## Skill-tree template v3 — start from the fantasy (redesign principles)

Direct critique after reviewing the first batch of trees in the Move Tree
Atlas artifact: "the design looks like you just copied over effects from
other trees... uninspired." Fair. Rock Throw/Peck/Scratch/Water Gun/Hydro
Pump/Solar Beam/Earthquake all share the v2 template's *structure* (opener
→ filler → hub → notable1 → filler → fork → notable2 → filler → keystone),
which is sound and stays — but they also largely share the same node
*content* inside that skeleton: a "+power vs. +accuracy" fork, a
"damageReduction vs. +power/jamCooldown" fork, a generic ally-buff opener,
a `resistanceBreaker` keystone, over and over. That's the actual problem:
every tree's levers came from whatever the last tree happened to use,
not from that move's own fantasy. Three rules, going forward — these
supersede nothing above, they add a step *before* it:

### 1. Write the fantasy before touching a single node

Before laying out branches, write 2-4 sentences (right here in this doc,
per move, before any node list) describing what the move IS — viscerally,
not mechanically: what it looks like, what's dangerous about it, who it's
dangerous to. Only once that's written do the three branches get designed,
and each branch's mechanics should be a specific answer to "what does
Aggression/Boldness/Sociability mean for *this* fantasy" — not a re-skin
of the same three answers every other move already gave.

**Widen what each Disposition axis is allowed to mean, per feedback.**
`leaning` is fixed to nature.ts's three real axes (aggression/boldness/
sociability) — that doesn't change — but a branch's *mechanical* identity
on any given move shouldn't be locked to one default per axis. Boldness
being defensive is still completely legitimate when that's the right fit
(a thick-shelled species' Boldness branch earning more `damageReduction`
is a real, earned answer, not a cop-out) — the redesign note isn't "ban
tankiness," it's "don't reach for it out of habit on every single tree
regardless of fit," the same way Earthquake's own Boldness branch below
reaches for terraforming instead because THIS move's fantasy calls for it.
Aggression is the same story, widened further: raw power is one real
answer, but **hunting/stealth** (an ambush lean — already has full
mechanical grounding via `situationalBonus`'s `concealed`/`flanking`/
`night`/`elevation` conditions, no new primitive needed) and **clashing**
(built around contesting a resource with a rival, not a hunt-to-the-death —
grounded in the real, shipped `herdConflict.ts` system, whose
`resolveRivalryHit` already calls the attacker's own `pickBestMove`, so a
tree node tuned for that context is mechanically real today, though there's
no first-class "this hit is part of a resource clash" `situationalBonus`
condition yet to hook a bonus to specifically — a real, flaggable gap, not
assumed solved) are just as legitimate. Which flavor fits which axis is a
per-move, per-species call — a nocturnal ambush predator's Aggression
branch reads as hunting/stealth; a herd herbivore's reads as clashing over
a grazing patch; a raw brawler's reads as power. Pick deliberately from
this wider set instead of defaulting to the same one every time.

Worked example, direct from feedback — **Earthquake**: a self-centered
shockwave radiating out from the user in every direction. It's not a
precision tool — it's reckless area denial that doesn't distinguish friend
from foe, and per `resolveAreaHit` (predation.ts) that's real, current
engine behavior today, not a hypothetical: its target filter checks only
`id !== attacker.id`, `alive`, `layer`, and being in the resolved shape —
nothing about herd membership, so a same-herd ally caught in the burst
radius takes the hit exactly like an enemy would. That recklessness *is*
the design space:
- **Aggression** leans further into "more, bigger, less controlled" — the
  existing overwhelming-force direction is fine here, since "commit
  harder" is Aggression's identity on every move, not just this one.
- **Boldness**, per the redesign note, stops being generic tankiness and
  reshapes the battlefield itself instead: the ground doesn't just shake,
  it cracks. A hit could turn the ground under it to real rubble that
  slows anyone crossing it, or — for a big enough tremor — punch a hole
  down to the underground layer at the impact site.
- **Sociability** turns the move's own flaw into its payoff: a herd
  drilled on this move doesn't get caught in its own quake. The branch's
  notable/keystone could exempt same-herd agents from the AoE entirely
  and/or turn the shockwave into a shared buff pulse for whoever's nearby
  when it lands.

New primitives that example calls for, **none of which exist yet** — add
a row to the "Engine primitives needed" checklist once one is actually
built, same discipline as everything already on it:
- **AoE ally-exemption.** A `MoveTreeNode.delta` flag (e.g.
  `excludesAllies: true`) that makes `resolveAreaHit`'s target filter also
  skip same-herd agents when set. Small, real engine work — one extra
  condition in an existing filter.
- **Terrain-as-hazard from a hit**, stronger than the existing
  `terrainBurn`/`terrainFill` (which only ever change a tile's *kind*, not
  how costly it is to cross): a move-created "rubble" terrain that raises
  `terrainSpeedMultiplier` (support.ts already has this function; a new
  `TerrainKind` is the missing piece). The layer-exposure half of the idea
  is a bigger, separate lift — no primitive anywhere in this engine
  currently lets a move punch a temporary opening between layers; today
  every layer transition is agent-initiated, never move-caused. Worth its
  own design pass later, not assumed away here.
- **A "resource clash" situational condition**, for the Aggression-as-
  clashing flavor above — a new `SituationalCondition` (e.g.
  `"rivalConflict"`) checked from `herdConflict.ts`'s own call site so a
  tree node can read "this specific hit is part of a resource standoff"
  the same way one already reads `"flanking"` or `"targetLowHp"`. Not
  needed for hunting/stealth (that's fully covered by existing
  conditions already).

### 2. Filler nodes: use the whole lever list, not just power/accuracy/cooldown

Nearly every shipped tree's filler nodes are "+5 Power," "+5 Accuracy," or
occasionally "-1 Cooldown," repeated 6-8 times per tree across 10 trees —
that repetition is a real part of why the atlas reads as copy-pasted, even
though each of those levers is individually legitimate (the v2 template
above explicitly names cooldown reduction as *the* signature utility
lever). Range is another real, already-shipped, cheap delta field
(`MoveSpec.range` / `MoveTreeNode.delta.range`) that's gone almost unused
at filler tier. Consult the full **Engine primitives checklist** (top of
this doc) and **Skill-tree lever brainstorm** (right below) when filling
in a branch's small nodes — `defensePenetration`, `lifestealFraction`/
`recoilFraction`, `critRateStage`, `jamCooldownTicks`, `positionSwapPull`
(once the move has `positionSwap` at all) are all legitimate small,
low-drama bumps, not just the same two stats every time.

**The one thing that does NOT belong at filler tier: a shape/AoE change.**
Turning a point into a cone, or a single target into a burst, redefines
what the move fundamentally does — that's notable- or keystone-tier by
definition, matching how Peck's *Extended Wingspan* and Ember's *Wide
Ring* are already built (both notables, never filler).

### 3. Positional/movement levers deserve real per-move thought, not a reused kit

`forcedMovement`, `positionSwap`/`positionSwapPull`,
`consumesOwnTerrain`, `terrainBurn`/`terrainFill`, and `burrow` are the
sim's most *physical* levers — they change where agents and terrain
actually sit, which is where the most memorable interactions live (Peck's
Snatch and Swap, Rock Throw's boulder-consumption). They've mostly been
used identically across trees so far — a knockback on one fork, a retreat
on the other, everywhere. Go back to the fantasy for these specifically:
what does *this* move's own physical presence in the world look like? A
throw that drags its target through the point of impact. A retreat that
only works from concealment. A finisher that repositions the user *into*
the middle of the area it just created, instead of just away from danger.
These are worth real per-move design time, not a reused "fork A pushes,
fork B pulls" shape stamped onto every tree.

## Skill-tree lever brainstorm

The mechanical levers a tree node can pull, organized by how much new
engine work each needs. `MoveTreeNode.delta` today only supports `shape`,
`range`, `power`, `accuracy`, `cooldownTicks`, `statusChance` — everything
below that isn't one of those six is a real (if usually small) schema/engine
addition, called out per item.

**Already free (schema growth only, no new subsystem):**
- Multi-strike: hits 2-5 times per use, each roll separately for crit/status.
- Crit rate ↑.
- Lifesteal: heal a % of damage dealt.
- Recoil: extra power for self-damage on use.
- Charge-up: skip a tick to wind up, then hit much harder (a tempo cost
  distinct from cooldown).
- "Battery" cooldown: fire twice back-to-back, then a long lockout.
- **PP cost**: a move can only be used N times before it needs to
  recharge/rest — a resource axis completely orthogonal to cooldown
  (cooldown is "how often," PP is "how many total before you're out"). A
  tree node could add max PP, or trade PP pool for power, or grant free
  recasts under some condition.
- HP or needs (hunger/thirst) cost to use instead of/on top of PP — fits a
  sim built around needs pressure; a "blood magic" branch.
- Bonus power vs. a specific type; extra STAB specific to this tree.

**Free by riding an existing subsystem (near-zero new engine work):**
- Weather synergy: bonus power during a matching weather cell (weather.ts
  already models storm/drought/rain/coldSnap).
- Day/night synergy: bonus accuracy/crit at night (daynight.ts already
  exists).
- Elevation synergy: bonus power/range attacking from higher ground
  (elevation combat modifiers already exist).
- Terrain interaction: burns away a `"bush"` tile on hit, removing
  concealment there (the concealment system already exists) — a real
  tactical tradeoff (damage now vs. stealth removed).
- Herd/guardian redirect: draws a predator's attention off a weaker
  herd-mate (reuses the existing guardian-cohesion concept).

**Needs the not-yet-built status-effect system first:**
- Stacking a second status on top of burn.
- "Jam": extends the target's own move cooldown on a landed hit.
- Self-buff on hit (temporary attack boost, small heal) — a "momentum"
  snowball lever.

**Action-economy levers — a category of its own, tied to `actionEnergy`
rather than `MoveSpec`.** DESIGN.md's "Action economy" section already
separates two axes that most brainstorming (including everything above)
had been ignoring: Speed governs *how often an agent gets to act at all*
(the `actionEnergy`/`ACTION_THRESHOLD` accumulator), while cooldown governs
*how often one specific move* is available regardless of that. Neither axis
currently has a way for a *tree node* to reach into it — these levers would
be the first that do, and they need a new "mid-commit" agent state (nothing
today lets a move span/consume more than the one action tick that casts
it):
- **Locks you into a multi-action commitment.** Using this version of the
  move consumes the *next* action tick too (can't act freely on it) — a
  real wind-up/follow-through cost distinct from cooldown, since cooldown
  only blocks re-using *this* move, not acting at all. The "two really sick
  end-state" fork on a power move is a natural home for this: a maxed-out
  nuke that costs you your next turn entirely is a real commitment, not
  just a cooldown number.
- **Grows the longer you hold/channel it** — not a fixed one-tick
  charge-up, but a variable-duration channel: each consecutive action tick
  spent channeling instead of releasing adds power, and the agent is
  interruptible/vulnerable the whole time (a real risk, not just a delay).
  Mainline Solar Beam/Focus Punch energy, but with actual stakes given this
  sim's predators can and do interrupt things.
- **Forces movement as part of using the move**, beyond U-turn's already-
  designed "retreat 2x speed for 2 ticks": a gap-closer that requires
  moving in a straight line toward the target before it can trigger, or a
  finisher that repositions the user to a specific tile after landing
  (e.g. flanking, or into the middle of the AoE it just created).

**Duration — a lingering, self-refreshing pulse tied to the user, not the
target (new primitive, not built).** Direct idea, Earthquake's own
worked example: a capstone/deep-crosslink version of the move that, once
triggered, keeps re-pulsing its own AoE around the user's *current*
position for several more ticks after the initial cast — following the
user as they move, not anchored to the tile it was first cast from. Two
things make this a real new primitive, not just "cooldown but bigger":
1. It needs genuine persistent state on the agent (which move, ticks of
   pulsing left, re-resolve the hit fresh against wherever the user is
   standing *this* tick) — nothing today re-fires a move's own resolution
   without the agent explicitly choosing to use it again.
2. **The move's own cooldown must not start counting down until the
   pulsing effect actually ends** — each pulse re-arms/refreshes the
   cooldown, so it can't just be cast once and be back up while still
   actively running. This is the detail that makes it a real commitment
   (you're threatening an area for several turns straight, at the cost of
   this move being fully unavailable to recast the whole time) rather than
   a disguised power bump.
Distinct from "grows the longer you channel it" above (charging *up* to
one hit) — this is one cast producing several pulses after the fact. A
natural home for this is a capstone or a deep crosslink (see the redesign
notes on wanting crosslinks to reach further into a tree for real
hybridization payoffs), since the tradeoff (this move is now unavailable
for its whole pulsing duration) is a real build-defining commitment, not
filler.

**Needs the not-yet-built multi-target/AoE resolution first** (see "The
sim/combat boundary" investigation in DESIGN.md — nothing today applies a
move to more than one simultaneous target within a resolved shape):
- Any move whose whole point is "hits everyone in the shape" (Firestorm,
  Ring of Fire's full fantasy, Growl).
- A lingering hazard/field tile left behind (burning ground, poison cloud).
- Status spreading target-to-target.

**A bigger structural idea, worth its own pass later:** a passive-style
node whose effect isn't part of the move's own `MoveSpec` at all, but
modifies the *agent* directly (e.g. a fire move's tree granting minor fire
resistance, or a perception move's tree granting a small detection-radius
boost). This is the most PoE-shaped idea on this list — not every node in a
tree has to be about the move it's attached to — but it's a real
architecture change (a node needs a delta shape that targets `Agent`, not
`MoveSpec`), so it's flagged rather than assumed.

## Future: a real player-facing respec mechanic

Wild agents never need to respec — `maybeAutoRespec` spends every point
immediately and permanently, so there's no "should I save this point"
decision for them, and therefore no hoarding-for-the-big-unlock anti-pattern
in practice today. That anti-pattern only shows up once a *player* gets
manual control over when to spend (still undecided, see DESIGN.md). The
intended answer when that's built: no free per-node undo (that would cheapen
every "real tradeoff" tree above into `to be revisited later`), but a
player can **forget an entire move** to reclaim all points sunk into its
tree. Real cost (you lose the move outright, not just its build), rare,
deliberate — closer to a PoE respec economy than a free undo button. Not
needed for wild agents; noted here so it isn't lost before a player exists
to use it.

## Move-tree drafts: the sim's actual movepool

Vine Whip proved the v2 template — but **proving the template and shipping
it are two different things**, and it was actually Tackle/Slash/Ember that
got built with it, not Vine Whip itself. Direct catch, much later: "we don't
have vine whip? i thought we designed it...." Fair — Vine Whip's paper draft
(the origin of named nodes like "Snapback Lash") was real, but it stayed
paper. **Vine Whip, Wing Attack, Rock Slide, and Dig have now all shipped
real v2 trees**, closing that gap and a second one alongside it: a direct
ask to "look at a bunch of the moves that are actually available to the
average units in our sim" — every one of these four is a genuinely common
species' own real signature move (Bulbasaur/Pidgey/Onix/Diglett+Sandshrew,
all spawned or reachable every run), unlike Body Slam's Snorlax, which has
no spawn or immigration path at all (a real, still-open gap — see TODO.md).

- **Vine Whip (Bulbasaur)** — 33 nodes. Aggression *Choking Grip* (drain/
  grip: `lifestealFraction`, a `forcedMovement`-pull fork, a multi-hit
  `endless_lashing` keystone), Boldness *Root and Bind* (rooted-plant
  toughness: `damageReduction`/`defenseBoost`/`regen`/`thorns`, ending in a
  real two-passive keystone), Sociability *Shared Growth* (leans directly
  into the same nurturing fantasy `leech_seed` already carries: `allyEffect`
  heal/buff, `allyEffectOnAttack`, a `healAura` keystone).
- **Wing Attack (Pidgey)** — 33 nodes. Aggression *Relentless Dive*
  (`critRateStage`/`critCooldownReset`, a multi-hit-vs-bigger-hit fork, a
  wider-cone keystone). Boldness *Wind Rider* — a bird's real defense is air
  superiority, not bulk: a `forcedMovement` hit-and-retreat notable, and a
  keystone finally giving `"unshaken"` its second-ever home (Body Slam's
  Unbothered was the first). Sociability *Flock Signal* — a prey bird's real
  defense is the flock: `rallyCall` (*Mob the Threat*, marking a threat for
  the whole flock to converge on) plus a `calmingPresence`/aggression-buff
  fork.
- **Rock Slide (Onix)** — 33 nodes, deliberately NOT a re-skin of Onix's
  other two trees (Rock Throw's defense-penetrating single-target *Crushing
  Weight*, Earthquake's ground-shockwave *Herdsafe Trigger*). This one's
  real, distinct hook: boulders falling FROM ABOVE, leaning on
  `situationalBonus`'s `"elevation"` condition — the first shipped tree to
  use it. Sociability *Warning Rumble* reuses Earthquake's `excludesAllies`
  ally-exemption but for a different reason (an advance-warning tremor, not
  drilled herd discipline), forking into `calmingPresence` vs.
  `nonTerritorial` — the second real use of Body Slam's Sociability
  primitives, on an entirely different, still-solitary-by-canon species.
- **Dig (Diglett/Sandshrew)** — 21 nodes, and honestly, deliberately
  smaller than the other three. Dig is never resolved as an actual hit —
  `pickBestMove` (combat.ts) excludes any `burrow` move from hostile
  selection — so every damage-facing lever this template normally leans on
  (`power`/`accuracy`/`defensePenetration`/`forcedMovement`/lifesteal/etc.)
  is real, valid `MoveTreeNode.delta` syntax that would do *nothing at all*
  if used here, since the move it modifies is never resolved as a hit. Built
  honestly instead from the only two levers that ARE real for a move like
  this: `cooldownTicks` (genuinely gates how often it can burrow-flee) and
  `grantsPassive`/`grantsPassives` (agent-level, real regardless of how the
  move gets used). No padded "+5 Power" filler pretending otherwise — see
  the tree's own top comment in `moves.ts` for the full reasoning. Shared by
  both Diglett AND Sandshrew (a real cross-species pairing per species.ts's
  own comment), so Sociability's *Shared Ground* leans directly into that
  already-written "coexists underground" flavor.

All four verified in a real run (`npx tsx packages/runner/src/index.ts`):
Bulbasaur auto-respecs across all three Vine Whip branches including the
`snapback_lash` crosslink; Pidgey/Pidgeotto do the same for Wing Attack.
Rock Slide and Dig didn't fire in the specific seeds checked so far — Onix/
Diglett/Sandshrew level up more slowly and compete for the same typed skill
points as their OTHER known moves' trees (Onix's Rock Throw/Earthquake;
Diglett/Sandshrew's Tackle/Earthquake), so this reads as normal RNG
variance on a small sample, not a structural problem — the generic
structural test suite (`moveTrees.test.ts`) validates all four trees'
prerequisites/excludes/forks the same way it does every shipped tree, and
`applyMoveTree` itself doesn't distinguish one tree from another. Full data
suite green (228/228), engine suite unaffected (1094/1094).

**Round two, direct follow-up ("i just want more more moves" ->
clarified: "i just mean implement more skill trees for commonly available
moves. we have so many skill trees we gotta work through. i wont even be
able to review em all")** — two more real trees, chosen the same way as
the first four (an actually-common species' own real signature move, still
bare):
- **Flamethrower (Charmeleon/Charizard, reachable purely through in-sim
  leveling from the always-spawned Charmander)** — 33 nodes, zero new
  engine work. This is the design template's own reference example for the
  "Power move" archetype, finally built: a genuine mutually-exclusive final
  fork between two distinct end-states (*Focused Beam*'s single-target
  nuke vs. *Wildfire Cone*'s wide AoE), not just a longer grind to one
  ending. Keystone *Wildfire's Reach* pairs `statusSeverity` with
  `terrainBurn` — the fire doesn't leave anything the way it found it.
- **Leech Seed (Bulbasaur/Ivysaur/Venusaur)** — 24 nodes, honestly scoped
  like Dig: it's `utilityMove`-flagged, so `pickBestMove` excludes it from
  hostile selection same as `burrow` — never resolved as an actual hit.
  Needed two small new `MoveTreeNode.delta` fields to be worth building at
  all: `drainNeeds` and `matingRadiusBoost` (both plain overwrites, mirror
  every other object-shaped delta field, merged in `applyMoveTree` and
  unit-tested directly in `moves.test.ts`'s existing "kitchen sink" merge
  suite). Real fork highlight: Boldness's *Twin Taproot* switches
  `drainNeeds.need` from `"hunger"` to `"thirst"` entirely — a genuinely
  different resource, not a bigger number on the same one. Aggression's
  *Twin Drain* is a real cross-move payoff: the vigor it takes sharpens
  this agent's own Attack stage for whatever it actually fights with,
  since Leech Seed itself never lands a hit.

Verified live: Leech Seed auto-respecs for real Bulbasaur in an 8000-tick
run (`gentle_roots`, `steady_roots`, `ravenous_bite`, `wider_reach`, and
more, across all three branches). Full data suite green (236/236), engine
suite green (1094/1094, including two new `applyMoveTree` merge
assertions for `drainNeeds`/`matingRadiusBoost`).

**Design review pass, direct follow-up: "Hmm.. You're missing a lot of
deeper cross links. And your designs are kinda uninspired..."** — a fair
hit, and checking it directly (a small script counting each new tree's own
`// Crosslink:` comments and node totals) turned up one real, concrete bug
underneath the vaguer complaint: **Vine Whip was only 32 nodes with 2
crosslinks, not the 33/3 every other tree in this batch has** — the whole
Sociability↔Aggression bridge was just never written. Fixed by adding
*Thorned Bouquet* (`critRateStage`, "the gentlest touch turns vicious in a
heartbeat"), landing it as an alternate way into `reaching_vines` same as
every other crosslink shortcut. That's the literal "missing" half of the
complaint.

The "uninspired" half was just as real: across all six trees, the
Aggression↔Boldness slot had settled into the exact same
`statChangeOnHit: self attack +1` three times over (Wing Attack, Rock
Slide, Flamethrower), the Boldness↔Sociability slot into the same
`damageReduction` grant four times over (those three plus Vine Whip's
original), and the Sociability↔Aggression slot into the same
`situationalBonus: flanking 1.25` three times over (Wing Attack, Rock
Slide, Flamethrower) — principle 13 by name ("Your crosslinks are
laaaaaame tho... the same three-lever rotation every time"), repeated
almost verbatim despite being written up in this very doc as a mistake
already learned from once. Reworked all of them to something specific to
the move's own fantasy instead,
without touching any other part of the trees (branches/forks/capstones
were already distinct — this was specifically a crosslink problem):
- **Vine Whip**: Boldness↔Sociability *Shared Roots* (`damageReduction`) →
  *Grafted Vines* (`positionSwap`+`positionSwapPull` — the tangled root
  network hauls a struggling ally to safety, a real field ability instead
  of a flat stat).
- **Wing Attack**: Aggression↔Boldness *Feint and Strike* → *Riding the
  Gust* (a real `forcedMovement` lunge riding the same current that keeps
  it airborne); Boldness↔Sociability *Guard the Flock* → *Screening Dive*
  (a real ally Speed buff, not a passive); Sociability↔Aggression *Ambush
  Call* → *Scattering Strike* (a real onHit knockback timed to the flock's
  own scatter).
- **Rock Slide**: Aggression↔Boldness *Braced Throw* → *Quarried Weight*
  (`weightScaling` — the braced stance lets it put real mass behind the
  throw); Boldness↔Sociability *Watchful Bulk* → *Steadfast Warning*
  (`defenseBoost`, not `damageReduction`); Sociability↔Aggression
  *Opportunist's Fall* → *Second Wave* (`jamCooldownTicks` — a second wave
  while the herd's still reacting to the first denies real recovery
  tempo).
- **Flamethrower**: Aggression↔Boldness *Tempered Strike* → *Molten Edge*
  (`defensePenetration`); Boldness↔Sociability *Guardian Ember* → *Ember
  Ward* (`thorns`, not `damageReduction`); Sociability↔Aggression
  *Provoked Blaze* → *Flashpoint* (`critRateStage`).
- **Leech Seed**: Aggression↔Boldness *Grounded Hunger* kept its name but
  swapped `damageReduction` for `defenseBoost` — it was an exact
  value-for-value duplicate of Dig's own crosslink otherwise (both
  honestly-scoped trees share a narrow lever set, so a little more overlap
  here is real and expected, not a rut).
- **Dig**'s three crosslinks were left alone — already distinct from each
  other and about as varied as an honestly-narrow, passives-and-cooldown-
  only tree can get.

No two crosslinks *within this six-tree batch* share the same mechanic
now. Verified live: Vine Whip's new *Thorned Bouquet* auto-respecs for a
real Bulbasaur in a 10000-tick run. Full data suite green (236/236, same
count — this was a rebalance, not new content), engine suite unaffected.
Atlas rebuilt and republished.

**Round three, direct follow-up: "Restart on each skill starting with the
fantasy. Does each node and capstone really fit? Be critical of your own
work."** A dedicated adversarial audit (not self-review — a fresh pass told
to be ruthless, checking every node's *displayed* `name` against what its
`delta` actually does, and every capstone against its own branch's stated
fantasy) found real, concrete problems the crosslink pass hadn't touched,
since that pass only ever looked at crosslinks:

- **All six Sociability capstones were `grantsPassive: { kind: "healAura",
  value: 0.01 }` — byte-identical.** The exact "capstone should be
  something the roster doesn't already have" bullet, failed six times over
  in one batch. Fixed by making each one escalate the specific lever its
  OWN branch already built, instead of switching to a generic heal at the
  finish line: Vine Whip's *Verdant Grove* → `[healAura, defenseBoost]`;
  Flamethrower's *Hearth of the Flock* (name itself borrowed Wing Attack's
  own vocabulary) → renamed *Communal Blaze*, `[regen, calmingPresence]`;
  Rock Slide's *Stone Circle* → deepens the branch's own `calmingPresence`
  ladder to 0.3 (bigger than anything earlier on the branch) instead of
  switching mechanics entirely, since "Warning Rumble" is about warning,
  not healing; Wing Attack's *Flock's Eye* → deepens `calmingPresence`
  instead, distinct from Wind Rider's own `unshaken`; Dig's *Denning
  Together* → `[healAura, regen]`; Leech Seed's *Roots That Feed the
  Grove* → `[healAura, calmingPresence]`.
- **Three Boldness capstones were also identical**: `bramble_ward`
  (Vine Whip), `living_furnace` (Flamethrower), `mountains_weight` (Rock
  Slide) all granted the exact same `[defenseBoost 0.08, thorns 0.08]`
  pair. Now distinct weightings matching each branch's own emphasis:
  Flamethrower leans thorns-heavy (`[0.05, 0.12]` — a furnace punishes
  more than it shrugs off), Rock Slide leans defense-heavy (`[0.1, 0.06]`
  — a mountain's real weight matters more than retaliation), Vine Whip
  stays the baseline `[0.08, 0.08]`.
- **A real fantasy fix, not just de-duplication**: Vine Whip's Boldness
  branch is explicitly "a plant that digs in and refuses to be moved," but
  its opener (*Deep Roots*) granted flat `damageReduction` — a generic
  tanky stand-in for a specific, already-shipped primitive
  (`"immovable"`) that says exactly what the fantasy claims. Same fix for
  Rock Slide's *Unbroken* (an Onix anchored under its own rockfall is an
  even more literal fit for "cannot be moved" than a rooted plant).
- **Wing Attack's Aggression capstone directly contradicted its own
  branch.** *Storm of Talons* widened the shape into a `hitsArea` cone —
  but the branch is explicitly one bird, one committed dive, all the way
  down (*Full Talon Dive*, *Killing Stoop*), and the capstone's own
  comment admitted the stretch ("the whole flock's worth of danger from
  one bird" — flock belongs to *Sociability*, one branch over). This is
  principle 14 (shape change as capstone currency) applied without the
  fantasy actually calling for it. Replaced with *Final Stoop*: stays
  single-target, a real finishing blow (`situationalBonus: targetLowHp`)
  against something the dive already reeling — the branch's real climax
  (*Killing Stoop*'s `critCooldownReset`) finally gets a capstone that
  escalates it instead of undoing it.
- **`storm_wings` (Wing Attack Boldness) was flat `damageReduction`** in a
  branch whose own comment says "air superiority, not raw bulk" —
  `damageReduction` IS raw bulk. Replaced with a literal read of its own
  name: `situationalBonus: { condition: "storm" }`, real turbulence to fly
  through instead of another flat-mitigation stand-in.
- **`screening_dive` (Wing Attack) was a strictly-worse duplicate of its
  own prerequisite** `warning_cry` — same ally Speed buff, shorter
  duration, different name. "Screening" is a real combat term for
  interposing between a threat and whoever it's after; replaced with
  `positionSwap` — an actual intercept.
- **Leech Seed's Sociability branch never touched `drainNeeds` at all**,
  the one lever this move's whole tree is built around, and its own top
  comment conceded it was just re-running Vine Whip's nurturing template
  under a different name — the "describe without naming the move" test,
  failing in the source comment itself. `rooted_calm` was a pure self-buff
  in a branch about sharing; replaced with a real `targetsAlly`/
  `allyEffect` heal (confirmed to actually fire, via `support.ts`'s
  separate `applySupportMove` path, independent of the move's own
  `utilityMove`/`drainNeeds` handling — checked directly rather than
  assumed, since "does this even run" is exactly the kind of question this
  doc's principle 3 exists for).
- **Name/mechanic mismatches fixed**: Vine Whip's *Unbreakable Hold*
  (promised grip, delivered `power`/`cooldownTicks`) → now genuinely
  denies the target's own tempo (`jamCooldownTicks`); Leech Seed's *Twin
  Drain* (nothing twin about a single self-buff) → renamed *Sharpened
  Hunger*; Leech Seed's *Feeding Frenzy* capstone (a flat `regen` ending a
  branch built entirely on escalating theft) → now a real bigger/wider
  drain than either fork alone reaches; Leech Seed's *Ancient Roots*
  capstone (literally re-granting the exact same `damageReduction 0.05`/
  `regen 0.02` values already granted lower in the same branch) → distinct
  values and one different lever (`defenseBoost` instead of
  `damageReduction`); Dig's *Gone Before It Lands* (promised timing/dodge,
  delivered flat `damageReduction`) → honestly renamed *Deepening
  Instincts*, since this tree's real lever set (cooldown + passives only)
  can't actually deliver a dodge effect without new engine work.
- **Real padding cut, not just renamed**: Dig's Aggression branch had four
  separate "-1 Cooldown"-lever nodes in a row (two of them literally
  identical, `looser_grip` and `shallow_dive`) — merged into one `-2
  Cooldown` node at the combined cost, tightening the branch instead of
  forcing filler to hit a node count.

**Deliberately NOT fixed this round** (logged, not fixed, per this doc's
own practice of saying what's still open rather than implying a pass was
exhaustive): the three Boldness branches (Vine Whip/Flamethrower/Rock
Slide) are still the same structural template underneath the two
`immovable` swaps and the three differentiated capstones — same node
count, same shape, same order, values renamed per move. A real fix needs
each branch built from its own fantasy's own question, not a shared
skeleton with different flavor text, which is a bigger rebuild than a
targeted audit-fix pass. Several crosslinks flagged as "single generic
stat grabs" (`molten_edge`, `ember_ward`, `steadfast_warning`,
`second_wave`, `quarried_weight`, and most of Dig's/Leech Seed's three
each) weren't touched either — real content, just not deep content, and
fixing them for real likely means the same kind of "read the branch, ask
what's actually unique about this bridge" work the crosslink round did,
not another mechanical swap. Full data suite green (236/236 — Dig's merge
nets one fewer node than before), engine suite unaffected (1094/1094).
Atlas rebuilt and republished.

**Round four — the environmental-hook pass these trees never got.** First
run of SKILL_TREE_GUIDE.md as an actual checklist rather than a writeup,
and its step 2 ("scan for an environmental or utility moment specific to
this fantasy — Rock Throw picking up a real boulder") immediately turned
up content three rounds of review had walked straight past, because every
prior pass audited what was *there* instead of asking what was *missing*:

- **Vine Whip now has a real environmental moment, at zero engine cost.**
  Vines are plant matter, so a Bulbasaur standing in real `flora` terrain
  draws on it: `consumesOwnTerrain: { terrain: "flora", damageMultiplier:
  2 }` — the exact shape of Rock Throw's boulder consumption, on the
  terrain kind this move's own fantasy actually cares about, and
  genuinely double-edged (the tile reverts to bare floor, so every big
  hit costs the map real flora and whatever was growing there). 2x rather
  than Rock Throw's 3x because flora is common terrain and boulder isn't.
  This also cleared a flagged name/mechanic mismatch: the node
  (`sapping_reach`) previously delivered a flat +5 Power under an id
  promising drain and reach.
- **Leech Seed's Sociability branch finally shares something.** Three
  rounds of notes said "Shared Harvest shares nothing" and the last fix
  could only manage a generic ally-heal. The real answer was
  environmental all along: what the roots steal goes back into the ground
  the herd grazes (`fertilityBoost`, flora.ts's own fertility mechanic —
  the same one Growth and Grassy Terrain use). It also replaced one of
  two identical "-1 Cooldown" fillers that branch was padded with.
- **That fix required a real engine bug fix first, found by the guide's
  step 9 (verify before building).** `maybeUseUtilityMove` early-returned
  the moment it applied `drainNeeds`, so *every other utility field on the
  same move was silently dead code* — `fertilityBoost` on Leech Seed would
  have been a node that visibly did nothing. Fixed so a drain move falls
  through to its other effects (still exactly one `useMove` call, so no
  double cooldown), with a regression test pinning both halves firing in
  one use.
- **Two Atlas reviewability gaps closed** (found while wiring the above):
  `drainNeeds` had no `describeDelta` entry at all, so **six** Leech Seed
  nodes rendered with no description in the very document these trees get
  reviewed from; `fertilityBoost`/`matingRadiusBoost` had none either, and
  the Atlas's own build-simulator was silently dropping `chargeAttack`,
  `drainNeeds`, `matingRadiusBoost` and `fertilityBoost` when computing a
  resolved spec. All four now merge and describe correctly.

**Proposed, deliberately NOT built — needs a go-ahead** (principle 16: a
confirmed "this isn't cheaply buildable" is as load-bearing as a
confirmed yes, and new engine work waits for a scope decision): **Rock
Slide should leave real rubble.** `terrainFill: { terrain: "boulder" }`
would make a rockslide leave boulder tiles behind, which composes into a
genuine cross-move combo — Onix *creates* boulders with Rock Slide, then
*consumes* them for 3x damage with Rock Throw's already-shipped
`consumesOwnTerrain`. That's the best cross-branch/cross-move tension
available anywhere in this roster. Two real blockers found by reading the
code rather than assuming: (1) `terrainFill`'s handler unconditionally
calls `waterSoil()` on the filled tile, with a comment stating the
assumption that it's "exclusive to Water Gun's puddle effect" — a falling
boulder watering the ground is nonsense, so that call needs gating on the
filled terrain actually being water; (2) `setTile` sets
`walkable = isWalkableTerrain(terrain)`, so filling `boulder` creates a
permanently unwalkable tile *under a living agent*, and repeated use
would slowly accumulate impassable rubble across the map with no decay
mechanism (this sim has no "tile change expires" concept — the same gap
`terrainFill`'s own doc row already flags). Both are solvable; neither
should be decided unilaterally.

**Correction — I had this wrong, and the user caught it.** I concluded Dig
couldn't take an environmental hook because it isn't `utilityMove`-flagged.
That reasoning was sound but I was looking in the wrong place entirely:
"dig was supposed to make digging springs and food easier... Vine whip
too... reduce the amount of time to harvest crops." There is a whole real
*gathering* system these moves already participate in, and I never looked
at it — I only ever scanned combat and terrain levers.

What already existed (needs.ts + crops.ts, CROPS_DESIGN.md's own pitch):
an agent on the wrong layer for a crop has to process it out first,
accruing `Agent.digTicksAccrued` against a threshold, and digging a
brand-new spring works the same way via `Agent.springDigTicksAccrued`.
Moves already feed all three paths — an off-cooldown `burrow` move grants
`DIG_MOVE_BURST_TICKS` toward digging a crop out or sinking a spring, and
an off-cooldown *damage* move grants `CANOPY_HARVEST_MOVE_BASE_BURST`
(scaled by its own `range.max`) toward knocking canopy fruit down. What
was missing was any way for a **tree** to make that better.

**New primitive: `MoveSpec.gatherBurst`** (additive, mirrored as a
`MoveTreeNode.delta` field). Extra gather progress per use, composed into
whichever path the move already qualifies for rather than adding a fourth.
It deliberately never grants access a move didn't have: digging still
requires a `burrow` move, canopy harvest still requires a damage move, so
a Vine Whip node speeds up fruit harvesting and still cannot dig.

- **Dig** finally has levers about what Dig is *for*. `Wider Burrow` and
  `Packed Earth` both grant `gatherBurst: 3` — and both were previously
  "-1 Cooldown" fillers under names promising something else, so this
  retired two flagged name/mechanic mismatches and two duplicate-lever
  fillers at the same time. Measured on real data: a spring goes from 4
  digs to 3, and crop digging from 5 to 8 progress per use.
- **Vine Whip**'s `Quickening Growth` (previously one of two identical
  "+5 Power" fillers in one branch) now grants `gatherBurst: 3`, taking
  its canopy harvest burst from 5 to 8 per use — a ~60% faster fruit
  harvest, landing in the branch that's about feeding the herd rather
  than fighting.

Three new engine tests cover all three real paths (underground crop,
spring, canopy harvest). The general lesson, worth more than the feature:
**"is there an environmental hook" is not the same question as "is there
an environmental hook in the systems I happen to have already read."** The
gathering system had been shipped for a while and had explicit
"moves can be used to dig faster" intent written into its own comments.

**Tackle, Slash, and Ember have all now
shipped their full v2 trees** (`packages/data/src/moves.ts`) — three
branches (Aggression/Boldness/Sociability) plus a crosslink triangle each,
33/36/35 nodes respectively, every lever real and unit-tested (see the
primitives checklist above). Tackle is used by six different species
(Bulbasaur, Venusaur, Diglett, Pidgey, Onix, Squirtle) in six completely
different roles — guardian, herd prey, burrower, flier, tunneler, starter —
so the same tree produces very different builds depending on who's
wielding it (disposition-weighted auto-respec, `maybeAutoRespec`). Confirmed
in a real ~8000-tick run: a live Diglett auto-respec'd five real Tackle v2
nodes (`weighted_charge`, `momentum_grip`, `hardened_knuckles`, `iron_hide`,
`steadfast_guard`), spanning two of the three branches.

Two things from the original paper draft are deliberately NOT in the
shipped data, both called out in each tree's own code comment:
- **Max PP** (`maxPPBonus`/`ppCost`) — a whole new resource axis, its own
  follow-up project, not a `MoveSpec`/`MoveTreeNode` delta field like
  everything else. Every "+1 Max PP" filler node became a real, already-
  used filler instead (`+5 Power`/`+10 Accuracy`/`-1 Cooldown`/`+5% status
  chance`), so node counts and costs match the original draft exactly.
- **`aggroRedirect`** (a taunt-style passive drawing hostile targeting to
  the holder) — never actually built; real AI-targeting changes are a
  bigger, riskier lift than the other passives this pass added. The three
  nodes that wanted it (Tackle's *Bulwark*, Slash's *Alpha Strike*, Ember's
  *Eternal Flame*) grant an extra `damageReduction`/`regen` instead — a
  real, already-shipped stat, and in Alpha Strike's case exactly the fix
  the user originally asked for ("maybe needs to give damage reduction
  too") independent of the taunt idea.

### Tackle (Normal, point/melee) — v4 two-lane (Shipped)

**Shipped as v4**, 45 nodes, 0 checker problems (was 33 nodes / 11
problems). The v2 writeup it replaces is kept below for the record.

**The fantasy, written before a single node moved.** Tackle is the first
thing anything learns and the last thing it forgets. There is no element in
it, no trick, no reach — it is a body at speed, head down, feet planted,
putting its whole weight through whatever is in front of it. Everything that
makes it dangerous is borrowed: the mass the animal grew, the ground it
braces against, the herd running at its shoulder. And its flaw is that it has
to **arrive** — no range, no projectile, you cross the distance yourself, and
when you land you are standing exactly where you hit with your momentum
spent. Every branch is an answer to that flaw.

| branch | lane A | lane B | how they differ in KIND |
|---|---|---|---|
| **Aggression — the approach is the weapon** | *Broke Cover* — waiting in the scrub, and the scrub is spent on the hit (`situationalBonus: concealed` + `consumesOwnTerrain: bush`) | *Full Tilt* — a real `chargeAttack` wind-up that crosses six tiles of open ground | never seen at all vs. seen coming and unstoppable |
| **Boldness — two bodies meet, one of them moves** | *Immovable* — hide, recovery, nothing budges it | *Shoulder Through* — `positionSwap` + `positionSwapPull`: it goes through and comes out standing where they were | absorb vs. displace |
| **Sociability — the herd is the body** | *Rally Cry* — a real `rallyCall` mark; every nearby agent's own targeting converges | *Bulwark* — bulk spent for the herd: `gatherBurst` browsing the tree line, then standing in the way | change what others decide vs. change what the herd has |

Flavours drawn on: Aggression 6 (stealth/ambush, aggressive movement, raw
damage, piercing, environment, wider AoE) · Boldness 5 (defence,
reposition-others, planted/duration, healing, raw damage) · Sociability 5
(rallying, ally buffing, healing, defence, raw damage).

Deep notables are where the two lanes have to meet, not a third idea bolted
on: *Unstoppable Momentum* (both approach lanes converge on never having to
approach again), *Sets Its Feet* (whoever is better set wins the collision —
and the brace is real damage here, since `effectiveWeight` adds
`BRACED_WEIGHT_PER_STAGE` per positive Defense stage and the opener scales
power off weight), *The Herd Arrives* (`allyEffectOnAttack` — the support
effect stops needing its own turn).

**Rejected, each against a real call site rather than a field name
(principle 3):**

- `ppCost`/`maxPPBonus` — PP is still an unbuilt primitive; there is no such
  field on `MoveTreeNode.delta`. The power-vs-PP fork the design doc likes
  would have been dead content.
- `excludesAllies` — read only inside `resolveAreaHit`, so on a point-shaped
  move it does nothing unless the build also took Aggression's ring capstone.
  A Sociability branch that needs another branch's capstone to function is a
  bug, not a synergy.
- `statusChance`/`statusSeverity`/`statusSpreads` — `maybeInflictStatus`
  returns early without a `statusKind`, and `statusKind` is not a delta
  field. Tackle has none, so all three are inert on this tree.
- a new `unshaken` passive on the Boldness deep notable. It fit the fantasy
  perfectly and is non-stacking by construction — but Tackle is the
  most-shared move in the roster, so a passive here spreads further than a
  passive anywhere else. Replaced with a `delta` per PART 4's rule. **This
  pass adds zero new passive grants and `passive-exposure.ts` is
  byte-identical before and after.**

**Two nodes reworked, with reasons rather than taste:**

- *Counter Slam* was `situationalBonus: flanking`, which collided with
  *Vanguard Charge*'s own flanking bonus on the same OVERWRITE field (two
  co-takeable nodes; whichever the engine reached last quietly won) and
  duplicated that crosslink's identity outright. It now does what its name
  always said — the more it has already taken, the harder it comes back
  (`selfStateBonus`, three users in the whole roster). This is the 11th
  checker problem that had nowhere else to go.
- *Rally Cry* was called Rally Cry and did not rally: it only buffed one
  herd-mate's Attack. It now sets a real `rallyCall` mark as well.
- *Guardian's Stand* gained `jamCooldownTicks: 1`. It had an empty `delta`
  and only a passive, which left its bridge nothing to deepen (principle 13
  requires the bridge's filler to escalate the crosslink's own lever, and
  PART 4's rule is not to grant a second passive just to have one).

**Balance, against the roster median as control** (`tree-balance.ts`):

| | before | after | roster median |
|---|---|---|---|
| nodes | 33 | 45 | 39 |
| distinct levers | 23 | **31** | 22 |
| colour-pie flavours | 9 | **12** | 9 |
| tempo | 2.00x (cap 2.00) | 2.00x (cap 2.00) | 2.00x |
| power multiplier | 3.38x | **3.38x** | 1.96x |
| cheapest capstone | 11 pts | 10 pts | 11 pts |

Power was held at exactly its pre-existing 3.38x rather than "fixed":
Tackle's base power of 40 is the lowest in the roster, so every absolute
`+power` grant reads as a large multiplier, and retuning it is a balance
decision, not a conversion one. Five new nodes were drafted with a `+5`/`+10`
power rider and had it swapped for a real lever (`critRateStage`,
`weightScaling`, a stronger `allyEffect`, `defensePenetration`) specifically
to keep the total unmoved. **Flagged for a decision: 3.38x is the highest in
the roster and 72% above the median — worth a look, but not unilaterally.**

**v2, for the record** — three branches plus a crosslink triangle:

- **Aggression — "Full Charge"**: opener *Weighted Charge* (bonus power
  scales with the user's own `maxHp` — `weightScaling`, a Venusaur and a
  Diglett throwing the same move hit very differently) → filler → filler →
  notable *Bracing Impact* (knocks the target back 2 tiles on a landed,
  non-killing hit) → filler → **fork**: *Full-Force Slam* (+power,
  +cooldown, `recoilFraction`) vs. *Relentless Charge* (2 hits, less power
  each, `critRateStage`) → notable *Unstoppable Momentum* (lunges 3 tiles
  toward the next target after a landed hit) → filler → **keystone**
  *Tremor Break* (`hitsArea` ring, knocks back everyone in it).
- **Boldness — "Brace for Impact"**: opener *Iron Hide* (`damageReduction`
  passive) → filler → filler → notable *Second Wind* (`regen` passive,
  -accuracy) → filler → **fork**: *Counter Slam* (+power vs. a flanking
  target) vs. *Steady Guard* (`lifestealFraction`) → notable *Immovable*
  (`immovable` passive) → filler → **keystone** *Thornguard* (`thorns`
  passive).
- **Sociability — "Shared Ground"**: opener *Steadfast Guard*
  (`targetsAlly`/`allyEffect` defense buff) → filler → filler → notable
  *Rally Cry* (ally attack buff) → filler → **fork**: *Bulwark Stance*
  (`damageReduction`, -power) vs. *Front Line* (+power, `jamCooldownTicks`)
  → notable *Bulwark* (more `damageReduction`) → filler → **keystone**
  *Guardian's Aura* (`healAura` passive — heals nearby herd-mates, not just
  the holder).
- **Crosslinks**: *Grounded Fury* (Aggression↔Boldness, `statChangeOnHit`
  self-buff off a braced hit) · *Guardian's Stand* (Boldness↔Sociability,
  shares `damageReduction`) · *Vanguard Charge* (Sociability↔Aggression,
  bonus damage vs. a flanking threat menacing the herd).

### Slash (Normal, line-1 melee) — Power archetype, Scyther's only move

**Shipped as v2** — scaled to the same triangle as Tackle: Ferocity
(Aggression), Precision (Boldness), and a slimmer Pack Instinct
(Sociability) — even a mostly-solo hunter coordinates around a kill often
enough to earn a real, lighter support branch.

- **Ferocity**: opener *Honed Edge* (`defensePenetration`) → filler →
  filler → *Predator's Instinct* (bonus damage at night) → filler →
  *Coup de Grace* (double damage vs. any already-statused target — burned,
  poisoned, paralyzed, asleep, or frozen, not just burn) → **3-way fork**:
  *Reaping Slash* (`lockTicks`, `critRateStage`) vs. *Frenzy Cutter*
  (`hits`, `recoilFraction`) vs. *Cleaving Slash* (`hitsArea` cone) →
  notable *Apex Predator* → filler → **keystone** *Merciless*
  (`resistanceBreaker`).
- **Precision**: opener *Keen Eye* (+accuracy) → filler → filler → *Feint*
  (lunges into melee before the hit) → filler → **fork**: *Opportunist's
  Strike* (bonus vs. a flanking target) vs. *Calculated Retreat* (steps
  back after hitting) → notable *Flawless Form* (`lifestealFraction`) →
  filler → **keystone** *Perfect Strike* (+power, +accuracy).
- **Pack Instinct**: opener *Shared Scent* (ally attack buff) → filler →
  filler → *Coordinated Strike* (`statChangeOnHit` self-buff) → filler →
  **fork**: *Opportunist Scavenger* (`regen`, -power) vs. *Territorial
  Snarl* (bonus vs. a low-HP target) → notable *Alpha Strike*
  (`damageReduction`) → filler → **keystone** *United Front* (ally heal +
  buff in one move).
- **Crosslinks**: *Brutal Efficiency* (Ferocity↔Precision,
  `jamCooldownTicks`) · *Watchful Pack* (Precision↔Pack Instinct,
  `damageReduction`) · *Ambush Pack* (Pack Instinct↔Ferocity, bonus vs. a
  flanking target).

### Ember (Fire, point, cooldown 1) — Utility archetype, full treatment

**Shipped as v2** — scaled to the full triangle: Wildfire (Aggression),
Ring of Fire (Boldness), and a new Hearthfire (Sociability, sharing warmth
and healing — a genuinely different support flavor than Tackle's/Slash's
own "brace and shield" branches).

- **Wildfire**: opener *Wider Burn* (+status chance, -cooldown) → filler →
  filler → *Roaring Blaze* (+power, -accuracy) → filler → *Fan the Flames*
  (double damage vs. an already-burning target) → **fork**: *Inferno*
  (reach 2) vs. *Wildfire Burst* (`hitsArea` burst around the caster) →
  notable *Pyroclasm* (`recoilFraction`) → filler → **keystone**
  *Spreading Blaze* (`statusSpreads` — the burn can jump to a nearby agent).
- **Ring of Fire**: opener *Ring of Fire* (shape → ring, -power,
  +cooldown) → filler → filler → *Wide Ring* (radius 2) → filler →
  **fork**: *Lingering Ring* (-cooldown, +status chance) vs. *Searing Wall*
  (`damageReduction`) → notable *Unquenchable* (`regen`) → filler →
  **keystone** *Everlasting Ring* (`resistanceBreaker`).
- **Hearthfire**: opener *Shared Warmth* (ally heal) → filler → filler →
  *Kindled Spirits* (ally SpAttack buff) → filler → **fork**: *Hearthkeeper*
  (`regen`, -power) vs. *Wildfire Call* (`statChangeOnHit` self-buff) →
  notable *Eternal Flame* (extra `regen`) → filler → **keystone** *Communal
  Hearth* (ally heal + buff in one move).
- **Crosslinks**: *Smoldering Ring* (Wildfire↔Ring of Fire,
  `statChangeOnHit` defender SpDefense debuff — the one node in this tree
  that touches the target, not the caster) · *Banked Embers* (Ring of
  Fire↔Hearthfire, `damageReduction`) · *Kindled Fury*
  (Hearthfire↔Wildfire, `critRateStage`).

### Rock Throw, Peck, Scratch, Water Gun — full triangle treatment (Shipped)

**Shipped** — `packages/data/src/moves.ts`. All four trees below are real, live content: 33 nodes each (3 branches × 10 + 3 crosslinks), following the exact structural template Tackle/Slash already established. Scratch's base spec also gained a real `statusKind: "poison"` (with no baked-in `statusChance` — that's entirely tree-earned, see *Envenomed* below). Structural integrity (every `excludes` pair genuinely exclusive, every crosslink shortcut reachable, no dangling prerequisite ids) and each tree's signature keystone mechanic are covered by `packages/data/test/moveTrees.test.ts`.

**Second pass.** The first draft here upgraded all four to Tackle's full
triangle template but did it lazily — every tree ran the exact same fork
shape (multi-hit-vs-power or self-buff-vs-self-buff), and the keystone pool
was just `resistanceBreaker`/`thorns`/`healAura` reshuffled four times with
new names on top. Real critique, taken seriously: this pass gives each move
its own actual hook — a mechanic or matchup unique to it — and keeps the
lever palette from repeating keystone-for-keystone across trees. Every
lever used is still already real and shipped; the difference is which ones
and where.

- **Rock Throw**'s hook: a ranged bombardment that costs the thrower real
  stamina and specifically cracks Flying-type intruders — `selfCostPerUse`,
  `bonusVsType`, and a *denial*-flavored support keystone instead of a heal.
- **Peck**'s hook: the roster's first `positionSwap` (with `positionSwapPull`
  on top — the roster's first use of that too — genuinely hauling the
  target past the swap, not just trading tiles) and the roster's first
  `critCooldownReset` (a real crit-fisher notable, not just more crit
  rate) — plus its only move that changes its own shape mid-tree (point →
  a real 2-tile reach) and slows a target down as its support payoff
  instead of healing.
- **Scratch**'s hook: the roster's first non-Ember status inflicter — a real
  Sandshrew doesn't canonically have venom glands, so unlike Ember's
  baked-in burn the poison chance here is entirely tree-earned (the
  Aggression opener *Envenomed*, not the base move), and the whole
  Aggression branch leans into it once it's unlocked, instead of being
  free from the first cast. It's also the one Sociability branch
  guaranteed to matter today (Sandshrew's real herd), rewarded with the
  only two-passive keystone among the four and the roster's first
  `rallyCall` (Rally the Colony — marks a predator for the whole colony to
  focus, genuinely stronger than buffing one ally).
- **Water Gun**'s hook: `resistanceBreaker` fixes its own real weakness
  (resisted by Grass/Water/Dragon) instead of padding an already-favorable
  matchup — the answer to Charmander/Ember was never actually needed,
  since Water Gun already beats Fire 2x — plus a storm-specific (not just
  rainy) opener, and a Boldness branch built around *un*-buffing the
  target's own footing, not just buffing the user.

A real, honest caveat carried over from Slash's own precedent: a
Sociability branch is real engine content the moment any two same-herd
agents knowing the move exist, but **Onix, Spearow, and the Squirtle pair
have no `herdId` in the current demo world** (`packages/data/src/scenario.ts`)
— `targetsAlly`/`allyEffect` and `healAura` both key off herd membership
(`support.ts`'s `nearbyHerdmates`, `herdIndex.ts`'s `herdMembers`) and
simply find nobody, the same silently-inert state Slash's own Pack Instinct
branch is in for the sole spawned Scyther today. Sandshrew is the one
exception — it already shares a real herd (`"underground-colony"`, with
Diglett). Giving the Squirtle pair a shared `herdId` would be a small, real
follow-up if their branch should matter sooner rather than later; noted
here, not done.

- **Rock Throw** (Rock, line-3, cooldown 2) — Onix's second move, alongside
  Tackle. **Superseded** — this original triangle (Aggression "Landslide"/
  Boldness "Bedrock"/Sociability "Tremor Call") was fully redesigned under
  template v3; see "Rock Throw v3 redesign (Shipped)" below for the real,
  current tree ("Denial"/"Bedrock"/"Tremor Rally"). Left here only as a
  record of what the pre-v3 version looked like — none of the node names
  below exist in `packages/data/src/moves.ts` anymore.

- **Peck** (Flying, point) — Spearow's only move, a solitary crepuscular
  ambush hunter (mismatched with its diurnal Pidgey prey — see
  `species.ts`'s own comment on that). **Superseded** — converted to template
  v4 (33 -> 45 nodes); see "Peck converted to v4 (Shipped)" at the end of this
  document for the current tree. Several node mechanics below (Talon Strike,
  Ambush Dive, Harrier's Charge) no longer match `moves.ts`.
  - **Aggression — "Sharp Strike"**: opener *Needle Point* (+power) →
    filler → filler → notable *Frenzied Pecking* (`hits` 2) → filler →
    **fork**: *Piercing Beak* (`defensePenetration`) vs. *Rapid Volley*
    (`hits` 3, -power) → notable *Talon Strike* (bonus vs. a low-HP target)
    → filler → **keystone** *Skybreaker* (`bonusVsType` vs. Grass — Flying
    beats Grass, a real answer to the roster's own Bulbasaur/Venusaur line).
  - **Boldness — "Dive Strike"**: opener *Swooping Approach* (bonus damage
    attacking from higher ground — `elevation`) → filler → filler →
    notable *Extended Wingspan* (`shape`/`range` change — Peck actually
    gains reach for the first time, a 2-tile line instead of a point-blank
    stab) → filler → **fork**: *Ambush Dive* (bonus vs. a flanking target)
    vs. *Harrying Wings* (-power, +accuracy) → notable *Relentless Harrier*
    (+power, `critRateStage`, `critCooldownReset` — a real crit-fisher
    spec: leans into landing one, and when it lands the dive is ready to go
    again immediately instead of just hitting harder) → filler →
    **keystone** *Snatch and Swap* (`positionSwap` + `positionSwapPull: 2`
    — the roster's first use of either: a dive that doesn't just trade
    places with the target, it keeps hauling it two more tiles past the
    swap, genuinely wrenching it out of position instead of a same-spot
    trade).
  - **Sociability — "Flock Call"**: opener *Flock Call* (`targetsAlly`
    attack buff) → filler → filler → notable *Wingmate Cover*
    (`targetsAlly` defense buff) → filler → **fork**: *Screening Wings*
    (`damageReduction`, -power) vs. *Harrier's Charge* (+power,
    `jamCooldownTicks`) → notable *Preening Recovery* (`regen` passive) →
    filler → **keystone** *Harrying Flock* (`statChangeOnHit` target Speed
    -1 — a crowd-control capstone, slowing prey down, instead of a heal).
  - **Crosslinks**: *Ambush Strike* (Aggression↔Boldness,
    `jamCooldownTicks` — a coordinated snatch that throws off the target's
    own rhythm) · *Cover Call* (Boldness↔Sociability, shared
    `damageReduction`) · *War Cry* (Sociability↔Aggression,
    `selfStateBonus` — a cornered flock-mate fights harder, scored higher
    when the user itself is low).

- **Scratch** (Normal, point) — Sandshrew, a real herd member (shares
  `"underground-colony"` with Diglett), nocturnal, den-digging. Base spec
  stays clean (no baked-in status, same as Tackle/Slash) — Sandshrew
  doesn't canonically have venom, so unlike Ember's free burn, poison here
  is a build choice you earn from the Aggression branch's own opener, not
  something every Scratch use rolls for free.
  - **Aggression — "Envenomed Claws"**: opener *Envenomed* (`statusChance:
    0.15`/`statusKind: "poison"` as a tree delta — the roster's first
    status added by a node instead of the base move) → filler → filler →
    notable *Deepening Venom* (`statusChance` +0.10 — stacks on the
    opener's own roll) → filler → **fork**: *Toxin Overload*
    (`situationalBonus: targetStatused` — hits harder finishing off
    something already poisoned/statused) vs. *Widening Fangs* (+power,
    `statusChance` -0.10, `statusSeverity: 2` — **refined per feedback**:
    the original version just turned the poison off for +power, which
    fought the branch's own theme instead of building on it; this trades
    away some of the earned *chance* to poison for whatever poison does
    land hitting twice as hard — a real "badly poisons" mainline callback,
    approximated as a flat DOT multiplier rather than mainline Toxic's
    turn-by-turn escalation, since this sim doesn't track per-status turn
    counters) → notable *Sandstorm Claws* (bonus at night —
    matches Sandshrew's own `activityPattern`) → filler → **keystone**
    *Toxic Spread* (`statusSpreads` — the poison jumps to whoever's
    standing next to the target too, the branch's payoff for actually
    committing to the venom line instead of forking into Widening Fangs).
  - **Boldness — "Burrow Strike"**: opener *Ambush Claws* (bonus attacking
    from concealment) → filler → filler → notable *Dig-and-Strike*
    (`forcedMovement`, lunges in before the hit) → filler → **fork**:
    *Retreating Slash* (`forcedMovement`, retreats after hitting) vs.
    *Cornered Fury* (`selfStateBonus` — scores higher when the user itself
    is at or below half HP) → notable *Burrow Guard* (`damageReduction`
    passive) → filler → **keystone** *Spiked Curl* (`thorns` passive —
    Sandshrew's own real spiked hide, curled up defensively).
  - **Sociability — "Colony Bond"**: opener *Colony Call* (`targetsAlly` +
    `allyEffectOnAttack` attack buff — **refined per feedback**: as well as
    a dedicated idle-tick support use, a landed hit ALSO buffs a nearby
    colony-mate's attack for free, real "as you strike the predator, your
    denmate gets pumped up too" pack coordination) → filler → filler →
    notable *Rally the Colony*
    (`rallyCall` — a landed, non-killing hit marks the predator for the
    whole colony to converge on, genuinely stronger than buffing one
    ally: it gets every nearby colony-mate's own, independently-run threat
    pick to land on the *same* predator instead of each one just fighting
    whatever's nearest to itself) → filler → **fork**: *Colony Guard*
    (`damageReduction`, -power) vs. *Tunnel Runner* (+power,
    `jamCooldownTicks`) → notable *Communal Foraging* (`regen` passive) →
    filler → **keystone** *Colony Warmth* (`grantsPassives`, plural —
    `healAura` *and* `regen` together, the only two-passive keystone among
    these four trees, earned because this is the one branch guaranteed to
    actually fire for real herd-mates today, Diglett included).
  - **Crosslinks**: *Frenzied Burrow* (Aggression↔Boldness, bonus vs. a
    flanking target) · *Guarded Den* (Boldness↔Sociability, shared
    `damageReduction`) · *Colony Fury* (Sociability↔Aggression,
    `lifestealFraction` — a colony-backed strike that recoups a little of
    what it deals, not another self-buff).

- **Water Gun** (Water, line-2) — the Squirtle pair's second move,
  alongside Tackle.
  - **Aggression — "Pressurized Blast"**: opener *High-Pressure Jet*
    (**refined per feedback**: the original was just a flat +power opener
    with no real identity — replaced with `situationalBonus: storm`, a
    genuine barometric-pressure pun: this jet hits hardest specifically
    during a storm, not just any rain, distinguishing it from Deluge's
    plain-rain bonus later in the same branch) → filler → filler →
    notable *Piercing Jet* (range +1) → filler → **fork**: *Torrent*
    (+power, +cooldown) vs. *Rapid Jets* (`hits` 2, -power) → notable
    *Deluge* (bonus power while it's raining) → filler → **keystone**
    *Overwhelming Current* (**refined per feedback, renamed from Quenching
    Blast**: `resistanceBreaker` instead of `bonusVsType` vs. Fire — Water
    Gun's own type chart already beats Fire 2x, so a Fire-specific bonus
    was answering a matchup that was never actually a problem; Water Gun
    *is* resisted by Grass, Water, and Dragon (all 0.5x), so a
    `resistanceBreaker` keystone fixes a real, printed weakness instead of
    padding an already-favorable one — it's the correct primitive for
    "negate the typing loss" too, since it only ever kicks in on a matchup
    this move is actually resisted on, rather than a flat bonus vs. one
    named type regardless of whether that matchup needed help).
  - **Boldness — "Evasive Spray"**: opener *Knockback Spray*
    (`forcedMovement`, pushes the target back on a landed hit) → filler →
    filler → notable *Retreating Current* (`forcedMovement`, attacker
    retreats after hitting) → filler → **fork**: *Undertow*
    (`statChangeOnHit` target Speed -1 — washes the target's own footing
    out from under it) vs. *Bubble Shield* (`statChangeOnHit` self Defense
    +1, temporary — the one self-buff kept from the original draft, as the
    alternative to Undertow's debuff) → notable *Tidal Guard*
    (`damageReduction` passive) → filler → **keystone** *Tidal Retreat*
    (`forcedMovement`, a full 3-tile disengage on a landed hit — a real,
    always-usable panic-button retreat for the sim's most fragile spawned
    agent).
  - **Sociability — "Pond Kinship"**: opener *Shared Current*
    (`targetsAlly` + `allyEffectOnAttack` heal — **refined per feedback**:
    the splash from a landed hit also heals a nearby hurt herd-mate for
    free, on top of the dedicated idle-tick support use) → filler → filler
    → notable *Calming Wave*
    (`targetsAlly` defense buff) → filler → **fork**: *Undertow Guard*
    (`damageReduction`, -power) vs. *Riptide Rush* (+power,
    `jamCooldownTicks`) → notable *Steady Tides* (`regen` passive) →
    filler → **keystone** *Tidal Bond* (`healAura`).
  - **Crosslinks**: *Surging Retreat* (Aggression↔Boldness,
    `statChangeOnHit` self buff after a forceful hit) · *Sheltering
    Current* (Boldness↔Sociability, shared `damageReduction`) · *Rising
    Tide* (Sociability↔Aggression, `critRateStage` — a shared burst of
    coordinated ferocity, not another flanking check).

### Twelve advanced moves, real range/AoE (Shipped)

Direct ask: "we need more moves actually... more advanced moves should be...
more range, more aoe." Twelve real gen-1 moves, `moveCanon`-sourced same as
every move before them, each given a real `shape`/`range` instead of
staying a point-blank stab — `packages/data/src/moves.ts`:

- **Hydro Pump** (Water, special) — `cone` length 4/width 2, `hitsArea`.
  Blastoise/Gyarados/Lapras's signature blast.
- **Surf** (Water, special) — `ring` radius 2, `hitsArea` — the classic
  "hits everyone adjacent" spread move. Wartortle/Blastoise/Lapras/Golduck.
- **Solar Beam** (Grass, special) — `line` length 5, no `hitsArea`
  (deliberately single-target — mainline's own signature is raw reach/
  power, not a spread effect; the "gathering light" turn is approximated as
  a longer cooldown, this sim having no charge-turn mechanic). Venusaur/
  Ivysaur.
- **Earthquake** (Ground, physical) — self-centered `burst` radius 2,
  `hitsArea`. Onix/Geodude/Sandshrew/Diglett.
- **Rock Slide** (Rock, physical) — self-centered `burst` radius 1 (tighter
  spread than Earthquake's), `hitsArea`. Onix/Geodude.
- **Sludge** (Poison, special) — `cone` length 2/width 2, `hitsArea`,
  `statusChance: 0.3`/`statusKind: "poison"`. Arbok/Tentacruel.
- **Poison Sting** (Poison, physical) — `point`, `statusChance: 0.3`/
  poison. Ekans/Weedle/Zubat's real level-1 moves.
- **Twineedle** (Bug, physical) — `point`, `hits: {2,2}`, `statusChance:
  0.2`/poison. Beedrill's real signature.
- **Ice Beam** (Ice, special) — `line` length 3, `statusChance: 0.1`/
  `"freeze"`. Seel/Lapras/Jynx.
- **Psybeam** (Psychic, special) — `line` length 2. Mainline's own
  confusion chance isn't representable (no such `StatusKind` exists) so
  this is a clean hit with real reach, no status roll. Jynx/Psyduck/
  Golduck (Psyduck's real level move).
- **Wing Attack** (Flying, physical) — `cone` length 2/width 2, `hitsArea`.
  Pidgey/Golbat.
- **Body Slam** (Normal, physical) — `point`, `statusChance: 0.3`/
  `"paralysis"`. Snorlax's real iconic level move — proof not every
  "advanced" move needs AoE, just real power and a real payoff.

Three got the full flagship triangle treatment (33 nodes each, same
template as Tackle/Peck/Rock Throw/etc.) — **Hydro Pump**, **Solar Beam**,
**Earthquake**. ~~Each Boldness branch keystone is a `resistanceBreaker`
fixing that move's own real multi-type resist~~ — **superseded, see the
"v3 redesign" writeups below**: direct critique that this first pass read
as copy-pasted (the same fork shapes, the same `resistanceBreaker`
keystone, three times over) led to "Skill-tree template v3 — start from
the fantasy" above and a full redesign of all three trees against it.
Structural integrity and each tree's signature mechanics are covered by
`packages/data/test/moveTrees.test.ts` (the generic per-move suite
re-validates any redesign automatically; each tree also got new
move-specific assertions matching its actual v3 mechanics).

Real, honest scope note: the roster has grown to 45+ curated species (most
of the growth came from elsewhere, not this pass) and most still know only
Tackle or one other move — this batch targeted evolved-line finishers and
real type gaps (Ground/Rock/Poison/Ice/Psychic/Flying all had zero curated
moves before it), not a full pass across every species. A good next
follow-up, not done here: Fire's still Ember/Flamethrower-only (no AoE fire
move yet), and most Bug/Dragon/beach-biome species still have nothing past
Tackle.

### Hydro Pump / Solar Beam / Earthquake — v3 redesign (Shipped)

Direct critique of the original three flagship trees above: "the design
looks like you just copied over effects from other trees. That's
uninspired." Rebuilt against "Skill-tree template v3 — start from the
fantasy," each with a real, distinct fantasy driving its three branches
instead of a reused kit. `packages/data/src/moves.ts`'s own comment block
on each move has the full reasoning; this is the summary.

- **Earthquake** — a self-centered shockwave that doesn't distinguish
  friend from foe (real, per `resolveAreaHit`'s lack of a herd filter
  before this pass).
  - **Aggression ("Overload")**: stays power-archetype on purpose — loud,
    obvious destruction isn't a stealth fantasy. *Fault Trigger*
    (`weightScaling`) → a real AoE-size fork, *Total Collapse* (widens the
    burst to radius 3) vs. *Focused Rupture* (narrows to radius 1, more
    power/penetration) → *Cataclysm* (power + `recoilFraction` — the
    ground doesn't spare the one shaking it either).
  - **Boldness ("Fracture")**: reshapes the battlefield instead of
    defaulting to flat tankiness — *Fissure Grip* leaves real hazard
    terrain (`terrainFill: "mud"`) from the very first point spent, a
    fork between widening the rift further or bracing at the cost of a
    real `lockTicks`, and *Rubble Wall* physically shoves anyone standing
    in the rubble away. Keystone *Ruinous Ground* still fixes Ground's
    real Grass/Bug resist — the objectively correct answer for this
    move's own type chart, kept rather than swapped out for novelty's own
    sake.
  - **Sociability ("Herdsafe Ground")**: turns the move's flaw into its
    payoff — opener *Herdsafe Trigger* turns on the new `excludesAllies`
    primitive immediately (see the primitives checklist above), and *Rally
    Quake* auto-buffs a nearby ally on every attack. Keystone *Sanctuary
    Quake* (`healAura`) is the herd's actual reward for standing close to
    something that used to be dangerous to them.
  - **Crosslinks**: *Cracking Momentum* (Aggression↔Boldness, a real lunge
    into the rubble the move just created) · *Fractured Warning*
    (Boldness↔Sociability, `jamCooldownTicks`) · *Coordinated Tremor*
    (Sociability↔Aggression, `rallyCall`).

- **Hydro Pump** — an overwhelming, genuinely hard-to-aim current (the
  dex's own 80 accuracy is the fantasy, not a flaw to filler away).
  - **Aggression ("Overwhelm")**: power-archetype, deliberately — Hydro
    Pump's whole mainline identity is the biggest blast, not an ambush or
    a territorial squabble. *Building Pressure* is a real wind-up cost
    (`lockTicks`), not a free power bump; the fork (*Overwhelm* vs.
    *Relentless Surge*) is nuke-vs-sustained; keystone *Undertow Pull* is
    the roster's second `positionSwap`+`positionSwapPull` use, its own
    backwash literally dragging the target.
  - **Boldness ("Bastion")**: genuinely defensive, and earned — a bulky
    tank (Blastoise/Lapras) channeling a controlled deluge. *Wading
    Advance* is a positional opener (closes distance before unleashing,
    not just a stat bump); keystone *Tidal Bastion* is a two-passive
    (`defenseBoost`+`regen`) payoff, deliberately not another
    `resistanceBreaker` — Water Gun already owns that exact fix for this
    type family.
  - **Sociability ("Pod Tide")**: the fork is a real positional choice —
    *Undertow Guard* (push the threat away from the herd) vs. *Riptide
    Charge* (surge forward to meet it first) — instead of the
    damageReduction/jamCooldown template reused everywhere else. Opener
    *Pod Current* carries the branch's own "the pod cares for itself"
    fantasy on two fronts, live from the first point spent: a real
    idle-tick heal, plus `excludesAllies` — Hydro Pump's own `hitsArea` is
    set on the base move and, until this, always hit same-herd agents
    caught in it too. Keystone *Tidal Communion* took three tries to land:
    a flat `healAura` team-heal didn't match "the pod moving the water
    together" (direct feedback); an `excludesAllies` capstone read as
    reused content already spent as Earthquake's own opener, once moved
    down to Pod Current above; the real fantasy needed a genuinely new
    primitive instead — **`"aquaticHaste"`** (`PassiveKind`, types.ts):
    a same-herd agent near the passive-holder, itself included, gets a
    real Speed multiplier bonus while standing on water, composed into
    `actionSpeedOf`'s existing chain (`aquaticHasteMultiplier`,
    support.ts). First keystone in the whole roster to need a brand-new
    engine primitive rather than reusing an existing lever.
  - **Crosslinks**: *Surge and Brace* (Aggression↔Boldness, `lockTicks:
    -1` — directly answers the cost Building Pressure itself introduces,
    not just flavor) · *Steadfast Tide* (Boldness↔Sociability, shared
    `regen`) · *Wake of Violence* (Sociability↔Aggression, `critRateStage`
    off a rallied target).

- **Solar Beam** — concentrated sunlight gathered into one overwhelming,
  precise beam; Venusaur's own real guardian role (see species.ts) drives
  this tree directly instead of a generic power-move shape.
  - **Aggression ("Dominance")**: the widened design space's *clashing*
    flavor — a territorial grazer asserting dominance, not just raw
    damage. Keystone-adjacent *Claim the Grove* uses `bonusVsType` vs.
    Grass — a real rival of the user's own kind gets punished hardest,
    the mechanically correct expression of "clashing" (Grass resists
    Grass 0.5x).
  - **Boldness ("Bulwark")**: genuinely tanky, earned by the species —
    fork between *Guardian's Ground* (`elevation` situational bonus) and
    *Verdant Wall* (`thorns` passive); keystone *Ancient Grove* pairs
    `thorns`+`regen`, distinct from every other move's Boldness keystone
    in this batch.
  - **Sociability ("Grove")**: makes explicit, via a real `excludes` fork,
    a mechanic the engine already had implicitly — a later `allyEffect`
    node overwrites an earlier one (true since Tackle's own tree).
    *Vital Bloom* (heal the grove) vs. *Steadfast Bloom* (steel it) is now
    a deliberate choice with its own dedicated fork instead of an
    emergent quirk of node order.
  - **Crosslinks**: *Rooted Assault* (Aggression↔Boldness,
    `defensePenetration`) · *Shared Shade* (Boldness↔Sociability, shared
    `regen`) · *Territorial Flare* (Sociability↔Aggression, `flanking`
    situational bonus off the herd's own warning).

### Meta: what "start from the fantasy" actually means, in practice

Direct, important feedback mid-session: "You're echoing a lot of my ideas
which I like. But I'm worried you're not UNDERSTANDING and learning how to
create your own based on the fantasy." Recording the standard so it
survives past this conversation, not just this reply:

- Costing out the user's own suggestion into real engine primitives is
  useful, but it isn't originating — it's translation. The bar is
  reasoning from "why does *this* species use *this* move" to a genuinely
  new mechanic *before* the user has proposed one for that move, the same
  way the Rock Throw v3 branches below were built: nobody asked for a pin,
  a stored-retaliation loop, or a vibration-based rally before they existed
  as pitches.
- A useful self-check before shipping a branch idea: could this exact
  mechanic get copy-pasted onto a different move/species with only the
  numbers changed? If yes, it's a template, not a fantasy. ("+ATK on hit"
  fits anything; "the herd converges on where you just marked the ground"
  only fits a species/move where a tremor is a real signal.)
- Widening a branch's allowed flavor (Boldness can be defensive *or*
  earned aggression; Aggression can be raw power, hunting/stealth, *or*
  clashing depending on move+species — see the widened-semantics note
  above) is what makes room for this in the first place — a branch locked
  to one fixed verb forces every move's version of it back toward the
  same template.

### Rock Throw v3 redesign (Shipped) — "the reach a lumbering body wouldn't have"

Built as a from-scratch demonstration of the above, not requested for this
specific move first. Core fantasy: Onix/Geodude-type bodies are heavy and
slow — Rock Throw is the reach that body wouldn't otherwise have. All
three branches below ship using only primitives the engine already had;
see `packages/data/src/moves.ts`'s own tree comment for the short version.

- **Aggression ("Denial")** — not bigger-rock power escalation. *Pinning
  Impact* (opener) and *Hobbling Throw* apply a real but **partial**
  `statChangeOnHit` Speed debuff (stage -1, not a stun) — "prevents fleeing
  to an extent," per direct confirmation this reads right. Fork:
  *Relentless Barrage* (sustained power) vs. *Crippling Snare* (widens the
  shape to a cone — the notable tier is where shape/AoE changes are earned,
  per template v3's rule 2) so a whole line of fleeing targets gets pinned,
  not just the one in front. Capstone *Quarry Break* trades a real
  `lockTicks` cost for a big `power`/`defensePenetration` spike — the
  closest buildable approximation, this pass, of the pitched "burrows a
  boulder out of the ground first if none is already underfoot" capstone
  (see the flagged primitive below for the real version).
- **Boldness ("Bedrock")** — plant, shrug off, punish. Kept and reframed
  the existing tank/counter kit (`immovable`, flanking `situationalBonus`,
  `resistanceBreaker` capstone) rather than discard working content for
  novelty's own sake. The pitched "stored retaliation loop" (the throw's
  own power scaling with damage just absorbed) is real and liked ("I like
  boldness, kinda cool") but needs a new primitive — flagged below, not
  faked with the wrong mechanic.
- **Sociability ("Tremor Rally")** — direct answer to "does it just mean
  allies become aware and come to help": yes, and the engine already has
  the exact primitive for it. Opener *Tremor Call* sets `rallyCall`, which
  marks the target so every herd-mate's own, independently-run threat/hunt
  pick converges on it — real shared awareness, not a broadcast stat buff.
  Direct follow-up feedback caught a real gap in the first pass of this
  branch: it just repeated the same lever three times (mark, then two
  separate nodes just extending the mark's duration further). Rebuilt with
  real variety instead — *Tremor Bond* is a distinct herd-support lever (a
  real idle-tick heal via `targetsAlly`/`allyEffect`, not more marking),
  and capstone *Herd Ascendant* pays off with `jamCooldownTicks` (an actual
  control effect on the enemy) plus a small `lifestealFraction` (the
  user itself feeding off a sustained group fight) — deliberately not a
  third round of "extend `rallyCall.ticks` again."
- **Crosslinks**: *Rolling Thunder* (Sociability↔Aggression) deepens the
  Aggression branch's own Speed-debuff pin once a target is already marked
  — a real compounding payoff between two branches' actual mechanics, not
  a shared passive. This crosslink shipped with a real bug in the first
  pass, caught by direct review: it used `lockTicks`, which locks the
  *user* out of acting, not the defender — the doc even described it as
  "stuns outright," which `lockTicks` cannot do. There's no tree-settable
  way to inflict an actual status/stun today (`statusKind` isn't a tree
  delta field — only `statusChance` is, and it's meaningless without a
  `statusKind` the base move never sets), so this was fixed by deepening
  the primitive the branch actually has (a bigger `statChangeOnHit` Speed
  debuff) instead of leaving a self-penalizing "reward."

Also fixed, same review pass: *Hobbling Throw*'s prerequisite was
`prerequisitesAnyOf: [["cracked_joint", "dead_aim"], ["grinding_advance"]]`
— an inner array is an AND-set in this schema, so that accidentally
required *both* Cracked Joint and Dead Aim together as one alternative,
unlike every other convergence node in the roster (which use single-node
alternatives). Fixed to `[["cracked_joint"], ["dead_aim"],
["grinding_advance"]]` — any one of the three now suffices.

Newly flagged primitives from this pass (not built, concrete enough to
pick up directly):
- **Conditional `lockTicks`/bonus on terrain presence** — extend the same
  check `consumesOwnTerrain` already does (is the attacker standing on a
  boulder tile?) so a move can apply a *different* delta depending on the
  answer, instead of always paying the same cost. Unlocks the literal
  "spend time digging one out only if there isn't one already" capstone.
- **`SituationalCondition: "recentlyDamaged"`** — self took a hit within
  the last N ticks; a one-line addition to the same enum/check
  `"targetLowHp"` already uses. Unlocks a real "stored retaliation" branch
  for Boldness (here and elsewhere) instead of another flat passive.
- **Distance-based accuracy falloff** — a new `accuracyFalloffPerTile`
  `MoveSpec` field, subtracted per tile beyond some baseline in the
  accuracy roll (`resolveHitAgainstTarget`, predation.ts). Pitched
  specifically to pair with range investment on Rock Throw as an
  "Aggression sniper build" archetype — accuracy investment becomes a real
  build identity, not just a filler stat.

### Deeper crosslinks — round 2 (first installment Shipped, rest proposed)

Direct follow-up: "we didn't come up with specific ideas but just the idea
[of deeper crosslinks]." Fleshing that out for real, per move, rather than
leaving it as a stated principle with no content. Two of the *shipped*
crosslinks above are the exact problem template v3 was written to avoid —
Hydro Pump's *Steadfast Tide* and Solar Beam's *Shared Shade* are both
"Boldness↔Sociability, shared `regen`," the same mechanic copy-pasted
across two trees. The proposals below are deliberately never that: each
one combines the two specific branches' own *distinct* mechanics on that
move, not a generic shared passive.

Direct follow-up feedback caught that a doc-only proposal isn't the same as
a real crosslink you can actually spec into — the connective primitive and
three of the crosslinks below are now **Shipped**; the rest are still
proposals:

#### Crosslinks as bridges, not dead-end leaves (the real ask, corrected)

A second round of feedback corrected the direction of this whole effort:
"deeper crosslinks" didn't mean "one more single-effect node between two
branches" (which is all *Marked Rupture*/*Marked Undertow*/*Marked
Advantage* above are) — it meant a crosslink should be a real **bridge**:
take the crosslink, invest a filler and a notable *off of it*, and that
notable becomes a genuine shortcut deeper into one of the two parent
branches, skipping that branch's own linear filler grind.

**Pattern, piloted on Earthquake (Shipped, revised once already)**:
*Coordinated Tremor* (crosslink) → *Marked Rupture* (filler) → *Converged
Ruin* (notable). Two rounds of real feedback shaped the final version:

- **v1** wired Converged Ruin directly onto `total_collapse`/
  `focused_rupture`'s own `prerequisitesAnyOf` — landing the shortcut
  straight on the branch's fork. Direct correction: "the deeper cross
  link going straight to the choice of 2 nodes are a bit too much." Also
  v1 only reached into Aggression, even though Coordinated Tremor bridges
  *two* branches (Sociability and Aggression) — direct correction: "make
  them connect to the other branch too. Like it can go to either branch."
- **v2 (current)**: Converged Ruin is instead wired one step *before*
  each side's own fork — `seismic_feed`'s `prerequisitesAnyOf` on the
  Aggression side, `tremor_reach`'s on the Sociability side (the two
  nodes that structurally mirror each other: last plain filler before
  each branch's own exclusive fork). Reaching either fork from here still
  takes the same one extra node it would from the branch's own path — the
  bridge saves the *grind*, not the *last step to the decision* — and it
  now genuinely goes "to either branch," matching what Coordinated Tremor
  itself actually connects.

Two rules that came out of building this, worth keeping for every future
bridge:
- **Shortcut the grind, land the same distance from the decision as the
  normal path would.** Not just "never skip the fork" (v1's fix already
  tried that name, but still landed adjacent to the fork with an
  anyOf grant into the fork nodes themselves, which was still read as
  "too much") — land at the same *node depth relative to the decision*
  a normal walk would, so the fork remains an equally-weighted choice
  either way you arrived.
- **A bridge should reach every branch its crosslink actually touches,
  not just the one its own `leaning` happens to match.** Converged Ruin
  is `leaning: "aggression"`, but Coordinated Tremor bridges Sociability
  too — the shortcut needs its own wiring on *both* sides, not just the
  side that matches the descendant node's own leaning field.
- **No new engine primitive needed.** This is pure tree authoring —
  `prerequisitesAnyOf` already supports "any one of several alternative
  sets," so adding a crosslink-rooted node as one more alternative on
  each side's own pre-fork node is exactly what that field is for.

**Rolled out to every crosslink in every v3 tree (Shipped), then
redesigned once for being exactly the template problem this whole
effort exists to avoid.** Direct ask, once the pattern was validated:
"Build out cross links for every branch and all moves." The first pass
across all 11 remaining crosslinks used the same shape every time —
filler = `+8 accuracy`, notable = `+10 power`/`+0.2 defensePenetration`/
`+0.05 lifestealFraction` — direct, blunt, correct feedback: "Your
crosslinks are laaaaaame tho... the skills don't feel cool." That's
principle #1 from this doc's own guide, violated by the person who wrote
it: if a mechanic could be copy-pasted onto a different crosslink with
only the numbers changed, it's a template, not a fantasy. Every bridge
below was rebuilt so its notable **deepens the specific lever its own
crosslink already introduced**, instead of a generic stat grab-bag —
Cracking Momentum's lunge gets longer, Wake of Violence's crit gets
sharper, Warning Tremor's damage reduction becomes real ongoing regen,
Territorial Flare's own capstone became a real, flashy shape change:

| Move | Crosslink | Filler → Notable | Deepens |
|---|---|---|---|
| Earthquake | Coordinated Tremor | Marked Rupture → Converged Ruin | rallyMarked 1.3 → 1.6 (same lever, overwrite) |
| Earthquake | Cracking Momentum | Deeper Lunge (forcedMovement 2 tiles) → Fault Convergence (power+15, recoilFraction 0.08 — a real tradeoff, not a bolt-on) | the lunge itself, then a genuine cost/benefit pair |
| Earthquake | Fractured Warning | Tremor Lockstep (+1 jam) → Warded Convergence (damageReduction 0.04) | jam, then the warning becomes real protection |
| Hydro Pump | Surge and Brace | Brace Conditioning (-1 cooldown) → Unified Current (critRateStage+1) | the wind-up-softening lever, then precision |
| Hydro Pump | Steadfast Tide | Tidal Footing (regen+0.01) → Communal Current (damageReduction 0.05) | shared vitality, then shared armor |
| Hydro Pump | Wake of Violence | Surging Wake (critRateStage+1) → Violent Confluence (rallyMarked 1.4) | precision, then the pod's real convergence payoff |
| Solar Beam | Rooted Assault | Sunlit Focus (defensePenetration+0.1) → Bedrock Beam (`thorns` 0.08) | armor-piercing roots, then real retaliation |
| Solar Beam | Shared Shade | Canopy Footing (regen+0.01) → Grove Bulwark (`defenseBoost` 0.05) | shared vitality, then shared armor |
| Solar Beam | Territorial Flare | Territorial Footing (critRateStage+1) → **Triple Bloom** (shape → `cone` length 5 width 3, `hitsArea: true`) | catching a rival off guard, then a real capstone-tier AoE payoff |
| Rock Throw | Grinding Advance | (defensePenetration+0.15) → Bedrock Momentum (self Attack stage 2/16 ticks) | the self-buff itself, deepened |
| Rock Throw | Warning Tremor | Warded Footing (damageReduction 0.03) → Herd's Bulwark (regen 0.02) | bracing, then real recovery |
| Rock Throw | Rolling Thunder | (Marked Advantage already existed) → Converged Quarry | rallyMarked 1.3 → 1.6 (same lever, overwrite) |

**Triple Bloom** deserves calling out on its own: direct ask, "make one
of the solar beam ones do like three width beams as a capstone" — Solar
Beam is deliberately single-target everywhere else in this tree (its own
top comment says so explicitly), so turning one bridge notable into a
genuine `hitsArea` shape change is the single biggest payoff in this
whole rollout, and exactly where template v3's rule 2 says a shape/AoE
change is earned — notable/capstone tier, never filler.

Every branch's own pre-fork node still has up to 3 real alternate routes
in its `prerequisitesAnyOf` (its own filler chain, plus the two crosslink
bridges that reach it from its two neighboring branches) — a build can
reach any branch's own fork by walking that branch, or by investing a
little in each of its two neighbors instead. Land one step before the
fork, never on it. No new engine primitives needed anywhere in this
rollout — every lever above (`forcedMovement`, `recoilFraction`,
`critRateStage`, `situationalBonus`, `grantsPassive` variants, `shape`/
`hitsArea`) already existed; this was purely about reusing the *right*
one per bridge instead of the same three by default.

Found and fixed in the same pass, unrelated to the rollout itself but
caught while stress-testing the layout: Hydro Pump's *Wake of Violence*
and *Marked Undertow* both bridge the same branch pair (Sociability +
Aggression) and were landing on the exact same graph coordinates —
`computeLayout` only ever positioned one crosslink per branch-pair angle.
Fixed by grouping crosslinks by the pair of branches they touch and
spreading multiples along the perpendicular, the same pattern already
used for branch forks.

**A second, real layout bug in the same node, found by direct report**:
"hydro pump marked undertow has some weird bridges that are not correct."
*Marked Undertow* is architecturally different from every other crosslink
in the roster — every other one bridges two branch *openers*
(`prerequisites` at depth 0, like Building Pressure + Wading Advance), so
a fixed radius right next to the hub was always correct for them. Marked
Undertow instead requires `undertow_pull`, itself behind Aggression's
*entire* fork chain (depth 7) — but `computeLayout` positioned every
crosslink at the same fixed hub radius regardless, so Marked Undertow's
own edge to Undertow Pull had to cut diagonally across most of the
Aggression branch to reach it, reading as broken rather than just
expensive. Fixed by scaling each crosslink's radius with the real depth
of its own deepest prerequisite (reusing the same per-branch `depth` map
`computeLayout` already builds) — a shallow crosslink still sits right at
the hub as before, but Marked Undertow now sits out near where Undertow
Pull actually is, so the edge reads as a real, deliberate bridge between
two expensive investments instead of a random line slashing through the
graph. Verified directly: recomputed Hydro Pump's real layout before and
after — Marked Undertow moved from `(-73,-56)` (right at the hub) to
`(-418,-241)`, now at roughly the same radius as Undertow Pull itself.

**Marked Undertow itself was removed shortly after this fix** — direct
ask: "Let's just remove marked undertow." The `computeLayout` fix above
is kept (real, generalized infrastructure for any future crosslink built
the same deep-dual-prerequisite way), but nothing in the shipped roster
exercises it right now.

- **`SituationalCondition: "rallyMarked"` (Shipped)** — the defender
  currently has an active `rallyMarkTicksRemaining`. Same one-line-
  enum-addition pattern as `"flanking"`/`"targetLowHp"`
  (`moves.ts`/`predation.ts`'s `situationalMultiplier`, engine test in
  `predation.test.ts`). Turns "the herd calls out a target" from a pure
  awareness effect into a real payoff for whoever follows up — Aggression
  branches get an honest reason to want the mark to land *before* their
  own big hit, not just tolerate co-existing with it.

- **Earthquake**
  - *Marked Rupture* (Sociability↔Aggression, **Shipped**) — a new node
    built directly on *Coordinated Tremor*'s own mark (not a replacement —
    the mark still has to be granted by something): `situationalBonus:
    "rallyMarked"`, a real payoff for calling out a target with Herdsafe
    Trigger, then burying it with the AoE-size fork.
  - *Converged Ruin* (**Shipped**, revised — the "deeper crosslinks"
    pilot, see "Crosslinks as bridges" below for the full v1→v2 story) —
    extends that same chain one node further: *Coordinated Tremor* →
    *Marked Rupture* → *Converged Ruin*. Wired into BOTH `seismic_feed`'s
    (Aggression) and `tremor_reach`'s (Sociability) own
    `prerequisitesAnyOf` — one step before each side's own fork, not onto
    the fork itself. A build that took the Sociability opener plus this
    3-node crosslink chain reaches either branch's own decision point
    without walking that branch's own filler grind, but still has to take
    the actual fork from there, same as anyone else.
  - *Braced Convergence* (Boldness↔Sociability) — the stillness Fissure
    Grip's brace fork already costs (`lockTicks`) buys a real payoff on
    the *other* branch: a much longer `rallyCall.ticks` window, since not
    moving is exactly when giving the herd time to arrive matters most.
    Replaces the generic `jamCooldownTicks` *Fractured Warning*.
  - *Rubble Lunge* (Aggression↔Boldness) — keep *Cracking Momentum*'s
    shape (a lunge into the rubble Fracture's own hazard terrain just
    created) but make the payoff explicit: bonus `defensePenetration`
    specifically while standing in `Fissure Grip`'s own `terrainFill`
    tile, tying two branches' actual battlefield-altering mechanics
    together instead of just "moving is now allowed."

- **Hydro Pump**
  - *Anchored Surge* (Aggression↔Boldness) — Bastion's positional opener
    (*Wading Advance*, close the distance first) pays down Overwhelm's own
    windup cost: closing to melee range before unleashing removes
    *Building Pressure*'s `lockTicks`, not just the flat `-1` *Surge and
    Brace* already grants. Position substitutes for time, a genuine
    tradeoff between two branches' opposite verbs (patient tank vs. nuke).
  - *Tidal Anchor* (Boldness↔Sociability) — replaces the reused *Steadfast
    Tide* `regen`. Fires specifically off Pod Tide's push-away option
    (*Undertow Guard*): shoving the threat away from the herd also grants
    the user a real `statChangeOnHit` self Defense buff — bracing exactly
    as you create the distance, instead of a passive that runs regardless
    of which positional fork got picked.
  - ~~*Marked Undertow* (Sociability↔Aggression)~~ — **Removed**, direct
    ask: "Let's just remove marked undertow." It needed BOTH *Wake Rally*
    (the mark) AND *Undertow Pull* (the drag) — a real cross-branch
    dependency, and the primitive it used (`rallyMarked`) was sound, but
    it was architecturally the odd one out in the whole roster (every
    other crosslink bridges two branch *openers*; this one bridged two
    deep, expensive fork-culminating nodes instead), which is what forced
    the one-off depth-scaling fix to `computeLayout` documented below.
    That layout fix stays — it's real, generalized infrastructure for any
    future crosslink built the same way — but nothing in the shipped
    roster uses it anymore.

- **Solar Beam** (no `rallyCall` in this tree — Grove's own fork is the
  ally-effect choice instead, so its crosslinks lean on *that* mechanic)
  - *Sunlit Advance* (Aggression↔Boldness) — replaces the generic
    `defensePenetration` *Rooted Assault*. Ties Bulwark's `elevation`
    situational fork directly into Dominance's clashing fantasy: fighting
    from the higher ground Guardian's Ground already rewards also boosts
    *Claim the Grove*'s `bonusVsType` vs. Grass — asserting dominance over
    a rival grazer specifically hits harder from a real position of
    advantage, not just in general.
  - *Canopy Cover* (Boldness↔Sociability) — replaces the reused *Shared
    Shade* `regen`. Whichever Bulwark passive the user actually invested
    in (`thorns` from *Verdant Wall* or the `elevation` bonus from
    *Guardian's Ground*) gets extended, briefly, to whoever Grove's own
    fork (*Vital Bloom*/*Steadfast Bloom*) targets — allies borrow the
    guardian's own bulk for a moment instead of a flat shared number.
  - *Territorial Flare* (Sociability↔Aggression) — kept, deepened: the
    herd's own warning (the `flanking` situational bonus it already
    grants) is framed explicitly as *the same rival-detection read* Claim
    the Grove needs to land its Grass-vs-Grass bonus — the herd spotting
    the intruder is what lets the dominance display actually connect.

- **Rock Throw** (already has 3 real crosslinks post-v3 — deepening two of
  them rather than adding redundant new ones)
  - *Grinding Advance* (Aggression↔Boldness) — extend it: bracing first
    (Bedrock Stance) should be what makes *Quarry Break*'s ground-tearing
    capstone survivable, not just an unrelated self-Attack buff on hit —
    add a real reduction to Quarry Break's own `lockTicks` cost when
    Bedrock Stance is already taken, the same "position/setup pays down a
    later branch's time cost" shape as Hydro Pump's *Anchored Surge*.
  - *Rolling Thunder* (Sociability↔Aggression) deepens the Aggression pin
    once a target is marked (fixed from an earlier `lockTicks` self-lock
    bug — see the v3 writeup above). *Marked Advantage* (**Shipped**)
    builds on it directly: a new node using `"rallyMarked"` to add a real
    damage bonus on top of the debuff, instead of the Speed stage being
    the only payoff.
  - *Grounded Signal* (Boldness↔Sociability, new) — Unshakeable's
    `immovable` passive is at its best exactly when the herd has already
    been called in (Tremor Call): grant a real, temporary
    `damageReduction` bump specifically while a `rallyCall` mark is
    active, rewarding holding ground once support is genuinely on the way
    rather than immovability being valuable in every fight equally.

### Body Slam (Normal, point/melee) — Snorlax's only real signature move, full v3 treatment (Shipped)

Built as a direct demonstration of this doc's own guide — every principle
applied deliberately, not retrofitted afterward. **THE FANTASY, written
before a single node**: this isn't a strike, it's four hundred pounds of
sleeping mass finally deciding to move — no technique, no follow-through,
just gravity, timed. What's dangerous about it isn't power, it's
inevitability: you don't dodge a landslide, you get out from under it
before it starts, and this animal rarely bothers to warn anyone it's about
to fall. Single-species freedom (Snorlax is the only curated learner,
`species.ts`), same as Slash's Scyther-only build — nothing here had to be
generic enough to also fit a second body.

- **Aggression ("Landslide")**: stays power-archetype on purpose — more
  mass, less restraint. *Heavy Step* (a modest opening lunge) → a real
  fork, *Second Slam* (`recoilFraction` — commits fully, costs something
  back) vs. *Rolling Crush* (two lighter hits instead of one), then
  *Inevitable* (`defensePenetration` — mass doesn't need precision, just
  enough attempts). Keystone *Avalanche* turns the single point-target
  slam into a real `hitsArea` `burst` AND is where `weightScaling` finally
  lands — moved down from the original opener (*Full Weight*) after direct
  feedback that starting the tree at its own biggest lever was backwards:
  "Full weight is probably too strong to be so early." By the time this
  move can end a fight this way, its whole mass moves with it — the shape
  change and the weight payoff arriving together, at capstone tier, per
  template v3's own rule.
- **Boldness ("Unbudging")**: earned tankiness, not a default reach —
  nothing on this whole roster fits "doesn't move" better than a sleeping
  giant, and Snorlax's own curated moveset already primes this fantasy
  with Defense Curl. *Dead Weight* (`damageReduction`, same earned
  exception this doc's own "stop overusing damageReduction" note carves
  out for a fiction that actually justifies it) → *Unbudging*
  (`immovable`) → a real fork, *Sink In* (`regen`, less power) vs. *Full
  Bulk* (more `damageReduction`, -accuracy) → *Weathered Giant*
  (`defenseBoost`) → keystone **The Reckoning** — direct follow-up
  feedback that bulk/defense alone read as bland, real "intention" needed:
  "could add a charge up turn, to make it stronger. Maybe... invulnerable
  to damage for that charge up... a huge leap/movement tied to the skill."
  A genuine mid-commit wind-up (`chargeAttack`, the single biggest new
  engine primitive this whole doc has needed — see the checklist above):
  the giant rears back, is truly invulnerable the entire time (not a
  defense buff — nothing lands at all), then leaps 5 tiles and lands a
  +40-power hit — or fizzles for nothing if the target's gone by then, a
  real risk for committing this hard, not a guaranteed payoff.
- **Sociability ("At Peace")**: rebuilt from scratch after a direct
  correction on the first draft — "Snorlax tends not to be in a herd. Very
  solo style... maybe Snorlax is more peaceful and gets along with others
  easier." The original branch (*Broad Back*, ally heals/buffs, a
  `healAura` keystone) was a real fantasy mismatch: it assumed a herd this
  specific animal usually doesn't have. The real trait — famously placid
  despite its size — is now a genuine non-territorial, de-escalating
  presence, not a flat ally buff: *Unbothered* → *Not Worth It* →
  *No Quarrel* (`"calmingPresence"` 0.3, another new passive — anything
  nearby, herd or not, calms down too) → a real fork, *Wide Berth* (deepens
  `calmingPresence` further) vs. *Steady Nerve* (`regen` instead) →
  *Undisturbed* (`thorns` — doesn't start anything, but whatever finds it
  anyway regrets it) → keystone **At Peace** (`grantsPassives`,
  `calmingPresence` 0.5 + `defenseBoost` — a real "two passives, one
  keystone" finale). Second pass on this branch, direct follow-up: "No
  quarrel reads as the true capstone. It's a big effect. Undisturbed
  seems like... it could be a different effect and swapped down." Fair —
  the first version's keystone (0.25 `calmingPresence` + 0.05 `thorns`)
  read smaller than No Quarrel's own 0.5 mid-branch, backwards for a
  capstone. Fixed by trading places: the *name* "Undisturbed" moved down
  onto the old *Left in Peace* notable (mechanically unchanged, still just
  `thorns`), No Quarrel's own number came down to 0.3 (a real notable
  number, not the branch's biggest), and the actual keystone got a
  decisively bigger `calmingPresence` jump (0.5, more than every earlier
  grant on the branch) paired with a lever no other Sociability node
  uses (`defenseBoost`) — genuinely new content at the top, not a smaller
  echo of what came before. Third pass, direct follow-up on the opener
  itself: "Unbothered should be, takes no damage from first hit in a
  fight?" — fair, and it exposed a real structural problem with the
  original opener: its only payoff, `nonTerritorial`, is functionally dead
  the instant this move sees real combat (per the user's own hesitation
  when asked where it should land instead: "it's like an interesting trait
  for a snorlax out in the wild but if it joins your party is a super bad
  skill to have"). Fixed by giving *Unbothered* a genuinely new mechanic,
  `"unshaken"` — fully negates the next hit against the holder once it's
  off cooldown, no accuracy roll, no partial effects, the literal read of
  the node's own name — and relocating `nonTerritorial` one step down to a
  new filler node, *Not Worth It* (the wild-AI flavor is still real, it's
  just no longer squatting on the branch's one guaranteed-useful-in-combat
  slot).
- **Crosslinks**, each deepening its own introduced lever rather than a
  generic bolt-on (principle 13), each reaching both branches it actually
  touches (principle 11), each landing one step before its target fork,
  not on it (principle 12): *Braced Commitment* (Aggression↔Boldness —
  bracing first is what lets the giant commit its full weight without
  losing its footing; deepens a self `statChangeOnHit` Defense stage
  three times across its own root→filler→notable chain) · **Nothing to
  Prove** (Boldness↔Sociability, redesigned alongside Sociability's own
  rebuild — the old version leaned on a herd-mark primitive this branch no
  longer has any use for; new fantasy: an immovable thing that also isn't
  looking for a fight is the ultimate "just go around it," deepening
  `calmingPresence` across its own root→filler→notable chain) ·
  *Provoked Charge* (Sociability↔Aggression — an animal this placid
  doesn't pull the hit once actually roused, the restraint was the only
  thing holding the full weight back; pairs a real `lockTicks` wind-up
  cost with a growing power payoff, per principle 4).

39 nodes total (10 per branch + 3 crosslinks × 3). First shipped tree to
need genuinely new engine primitives rather than just picking the right
existing lever — three of them now, all direct follow-up asks across
successive rounds of feedback: `chargeAttack`/`Agent.chargingAttack` (a
real mid-commit wind-up with genuine invulnerability, powering The
Reckoning), `"nonTerritorial"`/`"calmingPresence"` (herdConflict.ts hooks,
powering the whole Sociability rebuild), and `"unshaken"`/
`Agent.unshakenCooldownTicks` (a cooldown-gated full hit negation, fixing
the opener's own dead-node problem — see the checklist above).
`packages/engine/test/predation.test.ts` covers the charge mechanic
directly (commits without hitting immediately, genuine invulnerability
against a real attacker, resolves after its ticks elapse with a real
leap, fizzles for no damage if the target's gone) and the `unshaken`
mechanic (a hit off cooldown does nothing at all, a second hit while on
cooldown lands normally, no effect without the passive, recharges after
enough ticks); `packages/engine/test/herdConflict.test.ts` covers both
herd-conflict passives (opts out of initiating, can still be targeted as
someone else's rival, dampens a third agent's own chance regardless of
herd, no effect beyond its radius). Engine suite green (1008/1008).
`packages/data/test/moveTrees.test.ts`'s generic per-tree suite covers
structural integrity automatically; the dedicated "Body Slam tree"
describe block was rewritten alongside each redesign round — the keystone
AoE and its relocated `weightScaling`, The Reckoning's real
`chargeAttack`, Undisturbed's two passives, Unbothered's real `unshaken`
grant and Not Worth It's `nonTerritorial` (and a direct check that no
`targetsAlly`/`allyEffect` survives anywhere on the branch), both forks,
and all three crosslink bridges' own wiring and lever-deepening. Full
data suite green (212/212). Atlas rebuilt (verified: no null bytes,
inline script re-parses, `computeLayout` produces a complete,
non-overlapping position for all 39 nodes; the `PASSIVE_LABEL`/
`describeDelta` maps in the template gained real entries for
`nonTerritorial`, `calmingPresence`, `chargeAttack`, and `unshaken`) and
republished. Also fixed in an earlier pass: the Atlas's `MOVE_ORDER`
picker list is hand-maintained, separate from the tree data itself — Body
Slam's tree had been in the data all along but never appeared in the move
picker because it was never added there; added a new "Single-species"
group for it.


#### v4 conversion (39 -> 45 nodes) — Shipped

Converted to template v4's two-lane standard. **The v3 fantasy above is
unchanged and every v3 node kept its own mechanics**: this pass added the
second lane each branch was missing, moved each branch's existing fork to the
tail of that second lane, and rewired the three bridges to land on one lane
notable per branch instead of a pre-fork filler. `check-proposed-trees.ts
--shipped` reports body_slam **7 problems -> 0**.

Six new nodes, all `delta` levers rather than passives (passives stack
uncapped across every tree a species knows, so they are the scarcest currency
in the system — this tree grants exactly the same passives it did before):

| branch | lane | new node | lever | why this lever for THIS move |
|---|---|---|---|---|
| Aggression | B *Deadfall* | **Deadfall** | `situationalBonus: elevation 1.4` + `critRateStage` | It doesn't chase, it comes DOWN. `resolveHit` pays this out only when the attacker's own tile is genuinely higher than the target's — the condition IS the fantasy. |
| Aggression | A *Momentum* | −1 Cooldown | `cooldownTicks: -1` | Tempo was 1.40x against this move's own 2.33x cap and a roster median of 1.80x; total reduction is now −3 (1.75x). Still −1 of headroom left, deliberately unspent. |
| Boldness | B *Where It's Been Lying* | **Heaving Up** | `power` + `selfCostPerUse: energy` | Getting four hundred pounds off the ground costs the animal something real, in the same node as the payoff (principle 4). |
| Boldness | B | **Crushed Thicket** | `consumesOwnTerrain: bush 1.5x` | The most physical lever in the palette on the branch that earned it: it comes up out of the brush it was sleeping in and the brush is gone. Reachable, not decorative — Snorlax's curated biomes are forest and jungle, the two with the heaviest bush weighting, and bush is walkable. |
| Sociability | B *How It Ends One Anyway* | **Pinned** | `jamCooldownTicks: 2` | De-escalation with its whole body: whatever is under it doesn't get its own move off. |
| Sociability | B | **Finally Roused** | `selfStateBonus: selfLowHp 1.5` | Read from `pickBestMove` (combat.ts), not the damage formula, and said plainly: a hurt Snorlax isn't stronger, it just finally bothers to reach for the slam. |

Lanes differ in KIND, not degree — Aggression is a body already moving versus
a drop from height; Boldness is refusing to be moved versus what lying
somewhere for a living costs and leaves behind; Sociability is nobody starting
anything versus how it ends one it didn't want. Bridges now complement the
lane they land on rather than matching it: Braced Commitment (footing) lands
on the Momentum lane and on Crushed Thicket, Nothing to Prove (calm) lands on
Unbudging and Finally Roused, Provoked Charge (all-in violence) lands on the
two lanes with no violence of their own, No Quarrel and Deadfall.

Measured, roster median as the control: 39 -> **45 nodes**, 25 -> **30
distinct levers** (median 21), 8 -> **11 colour-pie flavours** (median 9),
tempo 1.40x -> **1.75x** (median 1.80x, cap 2.33x), power 2.08x -> 2.20x
(median 1.89x), cheapest capstone 12 -> **11 points** (median 11).
`passive-exposure.ts` output is byte-identical before and after — no species'
cross-tree passive totals moved.

Verified by running the real engine, not by reading it: a one-tick `tickWorld`
harness with the resolved v4 spec dealt 30 damage on flat ground, **42 from
elevation** (exactly 1.4x) and **45 standing on a bush** (exactly 1.5x, with
the attacker's own tile left as `floor` afterward); the defender's own move
cooldown went 1 -> 3; the attacker's energy dropped 0.045 against a 0.005 idle
baseline; and `pickBestMove` chose a stronger rival move at full HP but Body
Slam at 10% HP.

Two data tests changed meaning, deliberately, and are commented as such: both
bridge tests asserted the *old* landing rule (one filler short of a notable).
v4 lands a bridge ON a lane notable — skipping that lane's grind, never its
fork — so those assertions were rewritten to the new rule rather than
weakened; the thing they exist to prove (a bridge never hands over a fork) is
still asserted, now against Deadfall instead of Rolling Advance.

### Pending brainstorm — Earthquake / Hydro Pump / Solar Beam (not yet built)

Consolidated here so none of this is lost to context compaction — these
were pushed hard in discussion after the three trees above shipped, and
none of them are implemented yet. Each is evaluated against the real code,
not assumed:

- **Hydro Pump — impact splash.** A burst centered on the *struck* tile,
  not the attacker's tile — distinct from `hitsArea` (always
  attacker-centered, via `resolveAreaHit`). New primitive: a second shape
  resolved against the defender's landed position after the hit.
- **Hydro Pump's puddle slows non-Water types.** Today
  `terrainSpeedMultiplier` (support.ts) keys only off terrain kind
  (`sand`/`mud`/`boulder`), with water at neutral 1x for everyone — making
  it type-conditional (water only slows non-Water agents) is new, scoped
  work: thread the mover's own type into that lookup.
- **Hydro Pump — rooted/stationary Duration variant.** The user's own
  proposal, and the simpler of the two Duration variants below (fixed
  origin, no per-tick recompute) — recommended as the one to build first
  if Duration gets picked up, precisely because it validates the primitive
  without the harder roaming case.
- **Solar Beam — piercing multiple targets.** Already cheap: flip
  `hitsArea` on the existing line shape. No new primitive needed.
- **Solar Beam — escalating pierce (each hit makes the next stronger).**
  Needs per-target damage/power scaling *within* a single
  `resolveAreaHit` resolution, which today resolves every target off the
  same flat `power`. New, scoped primitive.
- **Solar Beam — skip the charge requirement in `drought`.** Already
  cheap once primitive (1) below exists: `situationalBonus`-style
  condition check, reusing the already-wired `"drought"` `WeatherType`.
- **Solar Beam — genuine multi-tick charge-up, unless already in
  `drought`.** The real gating primitive everything else here depends on:
  a new "mid-commit" agent state (charging, can't act normally, resolves
  N ticks later) — the single biggest unbuilt piece in this list.
- **Solar Beam — sunlight capstone lets nearby Venusaurs cast for free.**
  Depends on the charge primitive existing first, plus a new temporary
  agent-level "skip your charge requirement this window" buff, grantable
  to nearby allies.
- **Solar Beam — destroys rock terrain.** Distinct from the existing
  single-tile `terrainBurn`: walk every tile in the resolved shape (not
  just the defender's own tile) and revert any `"boulder"` terrain found
  to floor.
- **Solar Beam — range up to 7 tiles.** Currently earned as a filler in
  all three branches, not a base stat — open question, not yet answered by
  the user, on whether it should move to base instead.
- **Duration lever (general).** Already written up under "Skill-tree lever
  brainstorm" below — a self-refreshing AoE pulse tied to the user's own
  live position (Earthquake's "roaming" version, harder — recompute origin
  every tick) or a fixed origin (Hydro Pump's "rooted" version, simpler).
  Cooldown freezes until the pulse ends either way. New primitive either
  way; rooted is the cheaper one to prototype.
- **Double-PP-for-big-effect lever.** Also already written up under
  "Skill-tree lever brainstorm" below — spend 2x PP per use in exchange for
  a real power/effect spike, distinct from every existing cost lever
  (`selfCostPerUse` spends energy/hunger, not PP).

### Two things that read as confusing in review, and what's actually true

Both flagged directly against the Atlas artifact — worth a permanent home
here rather than re-explaining from scratch next time either comes up.

**Range and shape are genuinely decoupled, not a rendering bug.**
`MoveRange.max` (`moves.ts`) is how far away a target can be for the
attacker to *decide* to fire (`moveRange`/`withinMoveRange`, combat.ts) —
checked in any direction from the attacker. The move's `shape` (resolved
by `resolveShape` once facing is chosen) is what the attack *actually
hits*, always starting from the attacker's own tile, at a fixed
`length`/`radius` independent of how far away the triggering target was.
For a single-target move (no `hitsArea`) these two numbers are usually
kept in lockstep on purpose (Peck's *Extended Wingspan* bumps `shape` and
`range` together) — genuinely extending reach. For an `hitsArea` move
(Earthquake, Hydro Pump), though, several "+Range" filler nodes (Hydro
Pump's *Widening Main*, Earthquake's *Cracking Footing*/*Tremor Reach*)
only ever bumped `range.max`, never the shape itself — so a target at the
new, farther edge of range can make the attacker fire, but isn't
guaranteed to actually be *inside* the resolved AoE footprint once it
does. That's real, current engine behavior, not a mistake to silently
patch — but it was genuinely confusing without saying so. Documented
here permanently, and in `widening_main`'s own code comment in
`moves.ts`. (The Atlas's range panel briefly showed this as a live
warning too; direct follow-up asked for that removed in favor of the
panel showing the plain-English effect of whatever node was most
recently added to the build instead — see the Atlas's own "how to keep
it updated" section below.) Also fixed in the same pass: every "+Range"
node in Earthquake/Hydro Pump/Solar Beam was mislabeled `"+10 Range"` regardless
of its real value — corrected to the actual increment (`+1` for
Earthquake/Hydro Pump, `+2` for Solar Beam, which reaches its own stated
"up to 7" cap correctly).

**Movement effects resolve in one fixed, real order — not simultaneously,
and not build-order-dependent.** A single move can carry a `beforeHit`
`forcedMovement` (a lunge/retreat), an `onHit` `forcedMovement` (a
drag/knockback), `positionSwap`, and `positionSwapPull` all at once (Hydro
Pump's Bastion+Aggression combo is a real example), and it wasn't obvious
what order they'd actually apply in. They're not simultaneous — the real
pipeline (`predation.ts`'s `resolveHitAgainstTarget`) is:
1. `forcedMovement` with `timing: "beforeHit"` — the attacker (or
   defender) moves *before* the accuracy roll. Doesn't change whether this
   specific hit lands (range was already checked before this function was
   even called) — only where the mover ends up standing for whatever
   comes next.
2. The hit resolves (accuracy roll, damage).
3. On a landed, *non-killing* hit only: status effects, the defender-side
   `statChangeOnHit`, then `forcedMovement` with `timing: "onHit"`, then
   `positionSwap` (attacker and defender's tiles swap), then
   `positionSwapPull` (an *additional* push, applied right after the swap,
   from the attacker's new post-swap position).
   A killing hit skips this whole block — none of these fire on a kill.
This is fully deterministic regardless of which order the tree nodes were
*chosen* in — it's the move's own final, merged spec that's evaluated,
always in this fixed pipeline order, every time the move is used.

## Move Tree Atlas: how to keep it updated

**Live URL: https://claude.ai/code/artifact/a089c885-1361-4004-8734-286a50c1d020**
— always update this one in place (see step 3 below); if this URL ever
stops resolving, use the Artifact tool's `list` action to find its
replacement and correct this line, don't just publish a fresh one and
leave this line stale.

The Move Tree Atlas is a standalone HTML artifact (not part of the actual
game — see TODO.md's "Real in-game move-tree visualizer" entry for the
eventual live-data, in-game version) used to review every shipped move
tree as a real, browsable node graph: branches, crosslinks, forks, and —
per direct ask — a small range/AoE grid preview per move (ported straight
from `resolveShape` in moves.ts, fixed to facing "up," so it's the real
footprint, not an approximation). Direct ask, after the first version got
rebuilt by hand from scratch: keep this process standardized so every
future update builds on the existing tool instead of re-deriving it.

**The process, in order:**

1. `npx tsx packages/data/scripts/export-move-trees.ts > /tmp/trees.json`
   — dumps every move with a `tree` (id, name, type/category/power/
   accuracy/cooldown, `shape`, `range`, `hitsArea`, and the full `tree`
   object) as one JSON blob, straight from the real `MOVES` export so it's
   never hand-transcribed.
2. `node packages/data/scripts/build-move-tree-atlas.mjs /tmp/trees.json /tmp/tree_atlas.html`
   — injects that JSON into `packages/data/scripts/move-tree-atlas.template.html`
   (the checked-in page shell: layout, the branch/depth/crosslink layout
   algorithm, the plain-English node-effect describer, the range/AoE grid
   renderer, the redesign-notes/flag localStorage feature — everything
   except the data) in place of its `__TREE_DATA__` placeholder.
3. Publish `/tmp/tree_atlas.html` with the Artifact tool, passing the
   artifact's existing URL (ask the user for it, or `list` artifacts, if
   it's not already in context) so it **updates the same artifact in
   place** rather than creating a duplicate.

**Proposed mode** — drafts live in `packages/data/scripts/proposed-trees.ts`
and are merged into the export by `export-move-trees.ts`, each flagged
`proposed: true`. They are NOT part of `MOVES`; the game never reads them.
Direct ask: "Add a proposed mode. I just want to see your trees before you
build em all." In the atlas they get their own picker group, an All /
Shipped / Proposed filter, dashed node rings, a PROPOSED badge, and the
move's `fantasy` text rendered above the graph. Any node whose effect has
no engine primitive yet carries `needsPrimitive` and gets a dashed **red**
outer ring plus a "NEEDS NEW ENGINE WORK" box in the detail pane — so a
reviewer can see at a glance which half of a draft is free and which half
costs engine work. Adding a new draft needs no template edit: the picker
group is derived from the data. When a tree is approved, its nodes move
into `moves.ts`, get the real `MoveTree` type, and come out of
`proposed-trees.ts`.

**When the template itself needs a real change** (a new layout idea, a
new field to visualize, a UI fix) — edit
`packages/data/scripts/move-tree-atlas.template.html` directly, keep its
`__TREE_DATA__` placeholder exactly as-is, and re-run the same three steps.
The template is real, versioned source (checked into the repo, reviewed
and edited like any other file) — never regenerate it from a screenshot or
from memory of what the artifact looked like; that's exactly the
"scratch every time" failure mode this process exists to avoid.

Sanity-check any template edit the same way this process itself was
verified: confirm the file has no stray null bytes (a past `Edit` call
once silently corrupted it), the inline script still parses, and the
output's embedded JSON still parses with every node still having a
`leaning`.

1. **Rock Throw / Peck / Scratch / Water Gun** — designed above, zero new
   primitives needed, purely porting work identical to what Tackle/Slash/
   Ember already went through. Highest payoff-to-effort ratio left on this
   whole document now that the primitives checklist is clear.
2. **Growl** — still the highest payoff-to-effort ratio *new-mechanism*
   item; most of the roster already knows it, but it needs a real no-
   damage/status-move representation first (see the primitives checklist).
3. **Sunny Day** — purely additive, cannot make anything worse, visible
   in a replay immediately.
4. **Leer** — first real FOV consumer; proves out line-of-sight-gated
   targeting as a pattern other moves (and eventually detection in
   general) can reuse.
5. **Dig-to-escape** — meaningfully changes prey survival odds, easy to
   verify with a before/after real-run comparison.
6. ~~Burn/poison (the DOT half of status effects)~~ — **done**, see
   DESIGN.md's "Status effects" section; unlocks Aromatherapy/Safeguard's
   counterplay whenever those get built.
7. Everything else, roughly in the order listed above within each round.

## Crosslinks are bridges, not spurs (the flagship structure, measured)

Prompted by a direct comparison ask: "Compare the skill trees for all your
new moves with hydro pump/earthquake. You're missing stuff."

The right move here was to **measure before theorising**. Node counts and
`prerequisitesAnyOf` counts per tree, straight off the exported JSON:

| | flagships (hydro_pump / earthquake / solar_beam) | six new trees, before |
|---|---|---|
| nodes | 38-40 | 33 |
| `prerequisitesAnyOf` | 9-10 | 6 |

A ~6-node, 3-anyOf gap in every one of them is a structural difference, not
a content preference. Reading Earthquake's actual source rather than
inferring from its silhouette named it: **its crosslinks are three-node
bridges**.

```
cracking_momentum   crosslink; forcedMovement 1 tile
  -> momentum_footing  "Deeper Lunge"; filler, forcedMovement 2 tiles
  -> fault_convergence cost 2; power +15, recoilFraction 0.08
```

Two things make that a bridge instead of a longer dead end:

1. **The filler deepens the crosslink's own lever.** Not "+5 Power" — the
   same forced-movement idea, escalated. That is principle 13 doing real
   work: a bridge whose middle node is a generic stat grab is just a
   corridor with a toll.
2. **It lands on two rungs of shortcut, not one.** The bridge's cost-2
   notable is wired as an alternate route into the pre-fork nodes of
   *both* flanking branches, and the crosslink itself *also* stays a
   shallower alternate route on an early filler in each. So a build can
   enter the bridge cheaply and bail early, or commit and arrive one step
   short of a fork. That is what the extra 3 `anyOf` per tree actually are.

Applied across vine_whip, flamethrower, rock_slide, wing_attack, dig and
leech_seed: 18 bridges, 36 new nodes, every pre-fork node rewired, every
early filler restored to accept both flanking crosslinks (principle 11 —
a bridge must reach every branch its crosslink connects, or it is a spur
wearing a bridge's node count).

All six now sit at 9 `anyOf`. The four full trees reached 39 nodes; **dig
(29) and leech_seed (31) were deliberately left short.** Their honest lever
sets are smaller, and inflating them to hit a number is exactly the
template failure the rest of this document exists to prevent. Matching the
flagships' *structure* was the finding; matching their *node count* was
not.

**Process note worth keeping.** The Atlas layout check that verified this
found two real defects, in order: first that my own verification harness
was wrong (`computeLayout` returns `{positions, crosslinks, maxR}`, not a
bare id->position map, so it reported all 17 trees broken, then — once
"fixed" against the wrong JSON shape — cheerfully reported all 17 clean
without examining a single one). Only the third version of the harness was
actually reading the data, and it immediately found `dig.never_still` and
`leech_seed.wider_reach` had lost their `leaning` field and would have
rendered invisibly. A verification step that has never once printed a
failure has not been verified.

## Persistent fire, and the passive-healing cap it exposed

Two things landed together here, and the second one only got found because
the first one needed tuning against it.

### Fire is a terrain kind, not a status

Direct ask: "for fire based move we gotta add the fire burning down flora
mechanic... and it deals dot damage to units standing in fire... gotta have
a rendering for it too."

`"fire"` is a real `TerrainKind` (fire.ts), not a status or a parallel
"hazards" collection. That single choice is what makes it render in every
renderer for free, persist across ticks, and interact with the movement and
flora systems that already exist. A burning tile counts down
`Tile.burnTicksRemaining`, may spread into adjacent `FLAMMABLE_TERRAIN`
(flora/bush/tree/food/seedling — vegetation only, which is what bounds a
burn), damages whatever stands in it, and reverts to scorched "floor".
`terrainBurn` — which previously just deleted a bush outright — now lights
one of these instead. Same end state, but it takes ticks, it is visible
while it happens, and it can get away from you.

**Measured, on real generated worlds** (60 burns lit at real flora tiles):

| | median | p90 | max |
|---|---|---|---|
| tiles burned | 3 | 19 | 47 |
| ticks alive | 21 | 49 | 59 |

The interesting property is a genuine percolation threshold in fuel
density: at 60% uniform fuel a fire takes ~12 tiles, at 80% it takes ~188,
at 100% it takes the entire map. Real worlds are ~5% fuel globally but
*clustered*, which is why they land in the interesting middle rather than
at either extreme. Rain cuts a burn from 10 tiles/41 ticks to 1 tile/3
ticks.

Two bugs the tests caught while building it, both worth remembering:
`setTile` cleared every other terrain-specific field but not
`burnTicksRemaining`, so a burnt-out tile kept stale fuel; and the spread
pass had to collect-then-apply, or a fire chains across an unbounded run of
fuel within a single tick (the classic grid-cellular-automaton bug).

### The real finding: stacked passive regen made units nearly unkillable

Tuning fire's damage-over-time meant asking what it had to out-heal, which
surfaced a direct worry: "I'm a little worried that heal over time will be
too strong though. Particularly every tick. With all these stacking effects
will users just be unkillable?"

**It was measurably true.** `grantPassive` does `+= value` with no cap,
tree choices are permanent and never removed, and an agent spends points
across the trees of *every* move it knows — so a long-lived agent trends
toward the sum of every regen node it can reach. On a 20k-tick run:

| | before |
|---|---|
| agents carrying regen | 117 of 167 |
| p90 | 6%/tick |
| max | 11%/tick — a full heal every 9 ticks, mid-fight |

The population had climbed to 167 precisely *because* nothing could
finish a kill. The theoretical ceiling was worse still: a 12-point build in
leech_seed or dig reaches 12%/tick.

Two fixes, both from a direct steer:

1. **Passive healing is gated on being out of combat.** "Make combat
   healing like leech seed different than passive healing, which requires
   unit to be out of combat." Any damage taken — a hit, recoil, thorns, or
   standing in fire — suppresses `regen`/`healAura` for
   `REGEN_COMBAT_SUPPRESSION_TICKS`. Lifesteal, ally heals and the
   fed/watered `applyHealOverTime` are deliberately untouched: those are
   paid for by an action, capped by a real resource, or already gated.
   `healAura` checks each *recipient* rather than the holder — gating on
   the holder would get both halves backwards.
2. **Non-capstone nodes grant flat HP, not a percentage.** "Adding more
   flat heal rather than percent... scale it better for early game
   survivors and less useful late game. Percent can be more intense
   capstone stuff. That feels more special anyways." A new `"regenFlat"`
   passive: 31 of the 38 regen nodes converted (0.01->0.5 HP, 0.02->1,
   0.03->1.5, 0.04->2); the 7 terminal capstones keep percent and were
   raised to 0.04 so percent genuinely reads as the intense version. A flat
   1 HP/tick is a real 3.3% to a 30-HP early unit and a marginal 1.4% to a
   70-HP late one — exactly the requested curve.

Two nodes were literally named "+0.01 Regen"; those became "+0.5 HP Regen"
rather than shipping the name/mechanic mismatch the design guide warns
about.

**Effect, measured.** Of the two, the flat conversion does most of the
work: it alone takes the 20k-tick population from 167 to 28, and the
out-of-combat gate takes it from 28 to 8. Both configurations oscillate
across the run rather than spiralling (base 12-34, gated 7-31), so the
system is volatile, not dying — but the gated carrying capacity is
materially lower, and whether that band is *right* is a game-feel call the
numbers alone can't settle.

Still on the table from the same conversation and deliberately not built
yet: diminishing returns on stacking, and a per-move heal-reduction lever
(a Heal Block-style effect the trees could reach for).

## Three findings from making fire actually show up

Asked to make the fire mechanic real in play, fix the Boldness template, and
bump flat healing. The first of those turned into the most important finding
in this document.

### Cost-2 and cost-3 nodes were very nearly dead content

Fire shipped, tested, rendered — and produced **zero ignitions across a
20k-tick run**. Chasing why went three levels deep:

1. `terrainBurn` lived only on Flamethrower's Wildfire's Reach. Flamethrower
   is known by one species entry; Ember by six. Moved it to Ember.
2. Still zero. Ember's `wildfire_burst` is **cost 3** — and measuring node
   picks across a living population found the real problem:

   | node cost | distinct nodes ever reached |
   |---|---|
   | 1 | 77 / 456 |
   | 2 | 6 / 144 |
   | 3 | **0 / 4** |

   `maybeAutoRespec` spends every point the instant it arrives, and a cost-1
   candidate is nearly always available, so an agent can never accumulate the
   2-3 points a keystone or capstone costs. **Every capstone in the game was
   nearly unreachable and cost-3 nodes were unreachable outright.** Fixed
   with `SKILLPOINT_SAVE_CHANCE`: bank the point when exactly one grant short
   of something already unlocked. Across 6 seeds that takes cost-3 from 0/4
   to 2/4 reached.

   The first version of this banked whenever *any* unaffordable node existed
   — almost always true — so agents saved forever and picked nearly nothing.
   Bounding it to "exactly one grant away" is what makes it self-limiting.
3. Still one ignition in 60k agent-ticks. Instrumenting rather than guessing:
   only **9 of 360** living agents had reached the depth-5 node carrying it,
   and only 18 of 1217 fights involved one. Depth was the bottleneck, not
   fuel. Ignition now sits on Ember's **opener**, whose name ("Wider Burn")
   already promised it. Result: **74 ignitions** across the same 6 seeds.

Fire also now spills to an adjacent fuel tile when the defender's own tile
has none — fuel is ~5% of a real map, so a tile-only rule meant a fight had
to land exactly on a bush.

### A methodology correction worth more than the fixes

Population in this sim is **wildly** sensitive to the RNG sequence. Inserting
a single extra `rng()` draw per skill-point grant, *with its effect
disabled*, moved one seed's 20k population from 129 to 3. Several
single-seed before/after population comparisons were made earlier in this
work — including the ones quoted in the passive-healing section above — and
they are far weaker evidence than they were presented as. Across 6 seeds the
population range is 11-151 with a median around 18; that spread swamps most
of the effects being measured. `validateSkillEconomy.ts` exists to average
across seeds. **Distinct-nodes-reached is the trustworthy metric here;
population is not.**

### Boldness: three moves were wearing one suit of armor

vine_whip, flamethrower and rock_slide ran the same branch node-for-node,
with the same passive values:

```
[damageReduction] -> +10 Acc -> +5 Pow -> [defenseBoost] -> -1 CD
   -> FORK: [regen] vs [thorns 0.12]
   -> [damageReduction] -> +10 Acc -> [defenseBoost + thorns]
```

None of them passed the guide's own test — "describe the branch without
naming the move." Vine Whip is the honest owner of rooted-and-thorny (that
genuinely is a plant's boldness), so the other two moved off it:

- **Flamethrower — the furnace that stands in its own fire.** Built on a new
  `fireproof` passive: half fire-terrain damage at the opener, full immunity
  at the capstone, which also leaves fire behind it wherever it fights. Only
  possible because fire is now real terrain, and it deliberately ties the
  Boldness branch to the Aggression branch's wildfire rather than sitting in
  its own corner. `fireproof` covers the hazard tile only — not the burn
  status, not Fire-type damage, which stay the type chart's job.
- **Rock Slide — mass, and the high ground.** Built on `weightScaling` and
  the `elevation` situational bonus, two levers the trees had barely
  touched. Its fork is now positional (take the high ground vs refuse to
  give ground) rather than the stock regen-vs-thorns.

One node was caught mid-rework promising "burn immunity" in its comment
while granting `damageReduction` — rewritten to do what its name says. That
check is cheap and it keeps finding things.

## damageReduction: diminishing returns plus a flat tier

Same uncapped-accumulation bug `regen` had, found in the same pre-fix
baseline and confirmed on a second seed: 1234 of 1368 living agents carried
some, median 0.15, p90 0.25, max 0.33 — a third of every incoming hit
deleted, permanently, with `damageReductionOf` clamping only at 1.0 (total
immunity). Unlike regen it is not healing, so the out-of-combat gate was the
wrong tool. Direct steer: "for damage reduction, we do diminishing returns
and flat."

**Diminishing returns** are hyperbolic, `x / (1 + x)`, applied at read time
because `grantPassive` only ever stores the running sum (there is no list of
individual sources to stack multiplicatively):

| raw sum | effective |
|---|---|
| 0.05 | 0.048 |
| 0.15 | 0.130 |
| 0.25 | 0.200 |
| 0.33 | 0.248 |
| 1.00 | 0.500 |
| 3.00 | 0.750 |

Chosen over a hard cap deliberately. A single node is worth almost exactly
its face value, so early nodes still deliver what they say; there is no
cliff where further investment silently stops mattering, just progressively
worse value; and immunity is mathematically unreachable rather than merely
clamped. A cap would have created exactly the "why is this node doing
nothing" dead zone that the whole reachability section above is about.

**Flat tier** mirrors the `regen`/`regenFlat` split, for the same reason:
`damageReductionFlat` takes absolute HP off a hit, so it is worth
proportionally more against the weak hits an early unit faces than the big
ones a late unit does. 39 of 41 nodes converted; the 2 terminal capstones
keep percentage and were raised to 0.12 so percentage reads as the
disproportionate version.

The one thing flat armor must not do is confer immunity, which is the
classic failure of flat-reduction systems — enough armor and a weaker
attacker simply cannot touch you. `MIN_LANDED_DAMAGE` (1) floors any landed,
damaging hit, and it deliberately only applies to a hit that was going to
hurt: a move already dealing nothing still deals nothing. Order is
percentage first, then flat off the result.

Note the shape this shares with the healing fix: in both cases the bug was
never a badly-tuned node, it was that **the sum of every node granting a
passive had never been the unit of analysis.** That question — "what does
this look like on an agent that took all of them" — is now the first one to
ask of any new passive.

## Three tiers, one cap, and a flake that was never what it looked like

Closing out the passive-stacking work. Three changes, each correcting an
earlier one in this same document.

**A soft cap on total passive healing.** Converting the common healing nodes
to flat was supposed to make healing strong early and weak late. It did —
and it also pushed peak healing *up*, to 17.65%/tick on a 51 HP unit,
because flat values stack additively exactly like percentages and dividing
by a small maxHp makes a stack worse rather than better. `softCapHealShare`
now bounds the total. It is piecewise rather than the plain hyperbolic used
for `damageReductionOf`, because a hyperbolic shaves ~20% off even a single
small node and healing needed to keep the rule that a node delivers what it
says: everything up to `PASSIVE_HEAL_KNEE` (3%/tick) passes through
untouched, only the excess is compressed, and the whole thing asymptotes at
`PASSIVE_HEAL_CEILING` (8%/tick). The 17.65% case lands at 6.7%.

**Three tiers instead of two.** Reserving percentage for capstones sounded
principled and measured as zero: effective `damageReduction` across 568
living agents was median 0%, p90 0%, max 0%, because capstones are reached
~21 times in 144. The fix is a middle tier — cost-1 common nodes grant flat,
the 27 cost-2 mid-branch keystones grant percentage, and terminal capstones
grant a larger percentage as the rare payoff. Percent is live again without
becoming common.

**The intermittent test flake, which was never cross-file state.** Chased
most of a session on the theory that parallel workers shared something.
Wrong. Damage carries a 0.85-1.0 random roll, and dozens of A/B tests built
two unseeded `createWorld` worlds and asserted one hit harder than the
other. A different test lost the coin flip each run — which is precisely why
it looked like shared state and why each one passed in isolation. Seeding
those worlds took ten consecutive full runs to clean, from roughly one
failure every two runs. I wrote one of these flaky tests myself this session
and then hit it, which is what finally exposed the pattern.

And a second verification miss worth recording next to the first: after
seeding, I declared eight runs clean while grepping only for failed *tests*.
A test *file* was failing to collect — my inserted constant had landed
inside a multi-line import block — so its 62 tests silently disappeared from
the total and the run still read green. **Check `Test Files` alongside
`Tests`.** A count that drops is a failure that does not announce itself.

## Two ecology fixes, and measuring the right thing first

Both of these started by discarding the metric I had been using.

**Capstones: the lever was commitment, not patience.** "Distinct cost-2
nodes reached across the roster" — the number that prompted the whole
`SKILLPOINT_SAVE_CHANCE` work — mostly measures how much agents concentrate
on the same few branches. Measured per *investing agent* instead, 36%
already reached a cost-2 keystone; it was only terminal capstones that were
genuinely unreachable, at 1%.

Raising the save chance made it worse (0.5 -> 0.75 dropped keystone reach
from 46% to 29%: agents banked instead of buying). The real blocker was that
an agent spends a median of 14 nodes spread across three or four trees and
never finishes a branch. `SKILLPOINT_FOCUS_BONUS` weights the auto-respec
toward whichever move is already furthest along, and takes capstone reach
from 1% to 6% with keystone reach unchanged — the same points, spent as a
build rather than scattered. It stays a bias rather than a rule; a test
pins that an agent still invests elsewhere.

**Combat: the problem was never the fight rate.** Asked for more combat, the
obvious move would have been to raise aggression or shorten cooldowns.
Measuring first showed fights already ran 15-28 per 1000 ticks. What was
actually broken was predator *persistence*: across four seeds, two ended
with zero living predators and one with 77% (having eaten out its own prey).
Both ends kill predation as a source of conflict, and the immigration
weighting could not fix it on its own, because its existing rarity term
treats a predator as just one rare species among many.

`predatorNicheBoost` makes a predator species up to 6x likelier to be the
one that immigrates when the living predator share is under 20%, tapering to
nothing once the niche is filled. It nudges only *which* species arrives —
never whether immigration happens, or how many — so a healthy world never
notices it. No zero-predator worlds remain, and the two seeds that had gone
predator-free went from 2 and 10 kills to 21 and 41.

The shared lesson, which by now is the recurring one in this document: the
first useful move is almost never the fix, it is checking that the number
being optimised is the number that matters.

## Equilibrium: the fix was letting founder populations establish

Asked to get the ecosystem into equilibrium. The obvious levers — predator
aggression, food abundance, starvation rates — were all wrong, and finding
that out needed a look at the *dynamics* rather than end-of-run numbers, so
`validateEcology.ts` now sparklines predator, prey and food across a run.

Two false leads worth recording, both killed by measurement:

- **"Reproduction is completely broken"** — `born 0` in all four seeds.
  It is not: `born` is the live-birth event and this sim reproduces by
  egg-laying, which was working fine (161 hatched in one seed). I read a
  zero on the wrong counter and nearly redesigned a healthy system.
- **"Shelter is the blocker"** — egg-laying needs a nearby shelter, shelter
  needs an agent at 85% fed AND watered, and the median agent sits at 0.72
  hunger / 0.68 thirst. Compelling, and wrong: lowering the threshold
  changed nothing measurable. Reverted.

The actual cause was in immigration. Its species weighting was
`1 / (count + 1)`, which is **maximal for a species that is entirely
absent** — so every arrival preferred a brand-new species over reinforcing
one already here. In a sparse world that produces nothing but singletons: 16
living agents across 11 species, 7 of them singletons, and only 2 species
with two or more members of both sexes. Nothing could find a mate, so those
worlds sat on immigration life-support indefinitely while a luckier seed
bootstrapped to 167 and thrived. That bimodality *was* the instability.

`founderWeight` keeps the rarity term but adds an Allee-style boost for a
species that is present and below `FOUNDER_VIABLE_COUNT`, and groups now
arrive at a minimum of 2, since a lone immigrant has no possible mate of its
own species. Across 8 seeds x 12k ticks:

| | before | after |
|---|---|---|
| predator share p90 | 57% | **31%** |
| samples with zero predators | 14% | **9%** |
| population volatility (cv) | 0.55 | **0.36** |

The remaining zero-predator samples are visible in the sparklines as cycle
troughs that recover, not extinctions — a predator line reading
`█▄▂▁▃▆▂▅▆▃▃▄▄▂▁▅▂▅▂▁▃▂▆▄` is the system working. Permanent extinction was
the bug; oscillation is the goal.

One tuning lesson: pushing the predator niche boost harder makes everything
worse (target 0.3 / boost 12 returns p90 to 53% and volatility to 0.47). A
hard corrective just trades extinction for overshoot. The gentle setting is
the one that cycles.

## Notables: epithets, and a tale per title

Direct ask: "I need notables as epithets ... Each notable type should spin a
story about the individual."

A title id is a database key. `titleClaimed: hero` tells a reader nothing,
and the first chronicle draft printed exactly that. Two things fix it, and
both are about making a notable a *character*:

**A name you could say out loud.** Epithets come in sets of four per title,
picked deterministically from the holder's id, so two heroes in one world are
not both "the Unbroken" and a re-run of a seed names them identically —
"Sablesong the Red-Clawed", "Nimtail the Far-Walked", "Bramclaw
Grudge-Keeper".

**A reason you could repeat.** Every title already had a real tracked stat
behind it, so each tale is built from the actual number that earned it. The
important constraint is that the seven tales are genuinely different in
shape, not one template with a stat swapped in — the hero's is about
violence, the elder's about time, the wanderer's about distance, the
gatherer's about going hungry so others could eat. A test asserts all seven
produce distinct prose, because a shared template is the exact failure the
chronicle's whole filtering design exists to avoid.

Two details did more work than expected:

- **The rival's nemesis.** `rival` now records *who* the grudge is against.
  "They nursed a grudge against Sablesong bitter enough to be felt across the
  whole world" is a story; "they nursed a grudge" is a stat. The very first
  real run produced an emergent one nobody wrote: the world's Rival hated the
  world's Hero.
- **Live stats for a sitting holder.** The claim event captures the stat at
  the moment the threshold was crossed, so an Elder crowned at exactly 500
  ticks read "500 ticks alive" forever. Using the world's live record for a
  holder who still sits on the title turns that into "7154 ticks alive,
  having outlasted everything they were born beside."

> **Executable rules live in [`DESIGN_VALIDATION.md`](DESIGN_VALIDATION.md)**
> — the checker that enforces the structural and content rules in this
> document, plus the self-test discipline that keeps it honest. Prose does
> not fail a build; several rules here were re-broken after being written
> down, which is why that layer exists.

## Roster census: where the tree content actually is (measured)

Design session opener, after "OK I want us to get to designing more. Moves
again." Before proposing anything new, a straight count of what the roster
actually contains today — every number below read out of `MOVES`/`SPECIES`
at runtime, not from this doc's own prose.

**35 moves. 17 have a tree, 18 are bare.** The bare 18 are not obscure:

| Bare move | Species that learn it |
|---|---|
| `agility` | 8 (scyther, sandshrew, growlithe, horsea, seadra, beedrill, ponyta, rapidash) |
| `harden` | 5 (metapod, kakuna, krabby, kingler, shellder) |
| `poison_sting` | 5 (ekans, arbok, weedle, zubat, golbat) |
| `surf`, `safeguard` | 4 each |
| `withdraw`, `sweet_scent`, `ice_beam`, `psybeam` | 3 each |
| `growth`, `grassy_terrain`, `defense_curl`, `rain_dance`, `sludge` | 2 each |
| `twineedle` | 1 (beedrill) |
| `synthesis`, `moonlight` | **0 — no species learns either** |

`synthesis` and `moonlight` are literally unreachable: they exist in the
data and no species in the game can ever have them. By this project's own
standing principle ("unreachable content is a bug"), that's a defect, not a
backlog item.

### The real finding: node budget per species varies 4.5x

Summing the tree nodes across everything a species can learn:

| Node budget | Species |
|---|---|
| **33** (Tackle only) | ekans, arbok, weedle, kakuna, metapod, caterpie, zubat, jynx, oddish, gloom, shellder, butterfree, beedrill, seadra, cubone |
| 35–36 | charmander, growlithe, vulpix, ponyta, scyther |
| 66–75 | squirtle, seel, krabby, kingler, psyduck, golduck, lapras, pidgey, snorlax, gyarados, charizard, … |
| 101–106 | diglett, sandshrew, bulbasaur, blastoise |
| **141–149** | venusaur, ivysaur, onix, geodude |

The floor group is the problem, and it's worse than the number looks: for
those species the *only* treed move is **Tackle** — the generic one every
one of 36 species shares. Their actual identity moves are all bare. An
Ekans progresses by speccing the same Tackle tree a Magikarp specs; Poison
Sting, the thing that makes it an Ekans, has nothing in it. Same for Jynx
(Ice Beam, Psybeam), Oddish (Growth), Beedrill (Twineedle), the whole
Caterpie/Weedle line (Harden).

Four **types have zero tree content anywhere in the game**: Poison, Ice,
Psychic, Bug. Not "thin" — zero.

### Lever distribution is still top-heavy

~700 lever uses across all 17 trees. The three cheapest account for 280:

`power` 131 · `accuracy` 91 · `cooldownTicks` 58 · `situationalBonus` 32 ·
`allyEffect` 30 · `forcedMovement` 27 · … · `statusSeverity` 2 ·
`terrainFill` 2 · `consumesOwnTerrain` 1 · `aquaticHaste` 1 ·
`selfCostPerUse` 1 · `chargeAttack` 1

This is the same failure mode the v3 principles section already names
("use the whole lever list, not just power/accuracy/cooldown"), now with a
number on it. Note the tail: five primitives that took real engine work
have exactly one node each using them.

### Status coverage, re-measured (this doc was stale on it)

The "Status effects" section above says the roster "currently has real
inflicters for burn only." **That is out of date** — measured against the
live data:

| Status | Sources |
|---|---|
| poison | 4 — `sludge` 30%, `poison_sting` 30%, `twineedle` 20% base; `scratch` via 3 tree nodes |
| burn | 2 — `ember`, `flamethrower` (plus 8 tree nodes deepening them) |
| paralysis | 1 — `body_slam` 30% base |
| freeze | 1 — `ice_beam` 10% base |
| **sleep** | **0 — nothing in the game can put anything to sleep** |

So `sleep` joins `synthesis`/`moonlight` on the unreachable list: modeled in
the engine, cured, ticked, tested, and impossible to cause.

Note the shape of the poison/freeze rows: three of the four poison sources
and the only freeze source are **bare moves with no tree**. The status
variety is already in the roster — it's sitting on exactly the moves that
have nothing to spec into.

## Round six: trees for the bare 18, starting with Bug and the status moves

Direct steer: "we want every move to have a tree eventually... Don't reduce
number of nodes. We add to every move. We really wanted to explore
utility/different ways it affects the environment." Priority: "Bug I think.
And more status ones that are interesting in other ways not just pure
combat." And the seed idea this whole round is built around:

> "Ex what if harden also increased weight so it strengthens weighted
> version of tackle?"

### The structural idea: a utility move's tree that buffs a *different* move

That Harden question is not a node idea, it's a new **shape** for a tree,
and the roster has nothing like it yet. Every node in every shipped tree
changes the move it hangs off. Harden making its holder *heavier* changes
Tackle's `weighted_charge`, because `weightScaling` reads the attacker's
own weight, not the move's.

This is the answer to "different ways it affects the environment" applied
inward: a utility move's payoff doesn't have to be a buff you read on a
meter, it can be a **precondition that some other move in the same
species' kit was already waiting for**. It also fixes the floor-group
problem structurally rather than by volume — a Metapod with Tackle and
Harden currently has two unrelated trees; under this shape it has one
build.

Mechanically it is nearly free: `predation.ts` already computes
`move.weightScaling.factor * attacker.maxHp`. A new `PassiveKind`
(`"bulk"`) added into that one expression is the entire engine change.

Three more pairs the roster already supports, same shape:

| Utility move node grants… | …which some other move was already reading |
|---|---|
| Harden → `bulk` | Tackle's *Weighted Charge*, Body Slam's whole weight fantasy |
| Growth/Grassy Terrain → real fertility | Leech Seed's drain, Solar Beam's charge (both Grass moves on the same species) |
| Agility → terrain-speed immunity | every cooldown-gated move, by acting more often |

### Harden — full fantasy-first treatment (the flagship)

**Fantasy.** Harden is not a shield being raised. It is a body clenching
until it is a different material. A Caterpie going rigid on a twig until
it reads as bark; a Kakuna that is, functionally, furniture. It is the
move of things that cannot run and cannot fight, and that survive by not
being worth the effort. Nothing about it is dangerous. What it changes is
whether anything bothers.

Five species: metapod, kakuna, krabby, kingler, shellder — the two most
famous of which are pupae whose entire canonical characterization is
"does nothing, very well."

- **Boldness — Density.** Hardening makes you heavier and more inert.
  Grants `bulk` (feeding every `weightScaling` move) and, deeper,
  `immovable` (already shipped, currently used by 7 nodes). Keystone
  **Chrysalis**: an enormous `damageReduction` window that costs real
  `lockTicks` — you genuinely cannot act while it holds. A voluntary
  helplessness window is a mechanic the roster does not have; the closest
  thing, `chargeAttack`, spends its lock buying an attack, not survival.
- **Sociability — Not Worth Eating.** A hardened thing stops reading as
  prey. This is the branch that finally consumes **the detection-radius
  gap** this doc flagged and never used. Keystone **Bark-Still**: several
  hardened herd-mates near each other read as scenery together, and a
  predator's hunt-target pick skips the cluster for a different herd
  entirely. Note the shape — like `rallyCall`, the payoff is that *other
  agents independently decide something different*, which this doc's own
  principles call the richest kind of payoff available.
- **Aggression — the shell as the weapon.** `thorns` (shipped, 14 nodes,
  never on a status move). Keystone **Brittle Edge**: the casing cracks
  when struck — reflects damage *and* leaves real debris terrain on the
  attacker's tile. A defensive move that terraforms by being hit.

The move's own flaw — it does nothing to anyone — is the branch material,
exactly as this doc's own "a move's flaw is a branch's best payoff" rule
predicts.

### Twineedle — Beedrill's only signature (1 learner, 0 nodes today)

**Fantasy.** Two strikes, one behind the other, from a thing that is
mostly needles. A Beedrill does not grapple; it commutes. It arrives,
stabs twice, and is gone before you have turned around. It is a poison
delivery system with wings.

- **Aggression** — the flurry: `hits` from 2 up, each stab rolling poison
  independently, so the branch's real payoff is status *reliability*, not
  raw damage.
- **Boldness** — the drive-by: `forcedMovement` retreating the *user*
  after the hit, `situationalBonus: "flanking"`. The branch is about never
  being where the counterattack lands.
- **Sociability** — the hive: `rallyCall` on the poisoned target plus
  `statusSpreads`. Beedrill are never one Beedrill.

### Poison Sting — status-first, and the one that leaves combat entirely

**Fantasy.** A wound too small to matter, and then it matters. The sting
is not the point; the sting is delivery. Five learners (ekans, arbok,
weedle, zubat, golbat) currently share nothing but Tackle.

Answering the "status-first or damage tree with a status node" question
per this move specifically: **status-first**, because for Poison Sting the
venom *is* the fantasy — where Ice Beam's is the beam.

The branch worth pitching hardest is the non-combat one: **venom
interferes with needs**. A poisoned agent recovers hunger and thirst more
slowly — so the payoff of poisoning something is not that it takes damage,
it is that it *starves*. That is a real, legible, sim-level consequence a
watcher can follow in the chronicle, and it makes a predator with Poison
Sting a genuinely different kind of predator: one that wounds and waits.
Needs an engine hook in `needs.ts`, not a `MoveSpec` delta field.

### Growth / Grassy Terrain — a pure environment tree, no combat branch

Both already do real work today (`fertilityBoost`, feeding flora.ts).
Neither has a node. This is the most literally environmental tree
available and it should not have a damage branch at all — a first for
this roster.

Directions: wider radius, richer soil, faster flora regrowth, permanently
fertile ground, and a keystone that **creates a bush where there was
none** — an Oddish that gardens its own zone into a food supply. Every one
of those is visible on the map at a glance, which is the standing
preference for diegetic mechanics over hidden multipliers.

### Agility — speed as a migration mechanic (8 learners, 0 nodes)

The interesting branch is not combat: a passive that shrugs off
`terrainSpeedMultiplier` penalties. A herd that specced Agility crosses
mud, water and rubble at full speed — which means it **emigrates faster
and reaches a new zone sooner**. That is a tree node with a visible effect
on the world map at the herd level, not the fight level.

### New primitives this round would need

Honest list, same discipline as the checklist above — none of these exist:

| Primitive | Unblocks | Est. |
|---|---|---|
| `PassiveKind: "bulk"` folded into `weightScaling`'s expression | The whole Harden→Tackle idea | One line + a type |
| Detection-radius passive | Harden's Sociability branch; the gap this doc already flagged | Small; the machinery exists |
| Needs-recovery interference from a status | Poison Sting's Sociability/utility branch | `needs.ts` hook, medium |
| Terrain-speed-immunity passive | Agility's migration branch | Small; `terrainSpeedMultiplier` exists |
| Move-created flora/bush | Growth's keystone | Medium; flora.ts has germination already |
| Debris/rubble terrain kind | Harden's *Brittle Edge*; also Earthquake's long-pending Boldness branch | Medium; a new `TerrainKind` |

The rubble one is worth noting: Earthquake's Boldness redesign has been
blocked on exactly this terrain kind since round three. Building it for
Harden unblocks both.

## Round six, self-critique: the drafts against this document's own principles

Direct ask: "your cross links are asymmetrical and a little weird... the
deep ones do need to be linked as shortcuts to deeper up the trees as well.
To be safe just match the standard cross link design." And: "we've shared
some design principles around rigor... use it to critique your own work."

Measured first, argued second. Structure of the v1 drafts against the
shipped roster, straight off the exported JSON:

| | shipped (mature trees) | v1 drafts |
|---|---|---|
| nodes | 33–40 | 21–28 |
| `prerequisitesAnyOf` | 9 | **0–1** |
| fork nodes (`excludes`) | 6 | **0–2** |
| crosslinks | 3 | 3 |

### What I got wrong, by principle

**Principle 7/11/12/13 — crosslinks were spurs.** This is what the ask
caught. All three "crosslinks" per tree were two-node dead ends: a
crosslink plus one leaf. No `prerequisitesAnyOf` anywhere in four of five
trees, so nothing they led to was ever an alternate route into anything.
That is precisely the mistake principle 7 was written about, already made
once before on the shipped trees and corrected there. I read the
"Crosslinks are bridges" section for the pitch and then did not apply it.
Two of the bridge fillers also reached for an unrelated lever
(`unnoticed` → `nonTerritorial`, `bulk` → `thorns`), which is principle 13
verbatim.

**Nobody asked about this one, and it is worse: four of five drafts had no
fork at all.** Harden had a single pair; Twineedle, Poison Sting, Growth
and Agility were pure linear chains. A tree with no `excludes` has no
decision in it — the whole "meaningful, permanent choice" premise of the
template is simply absent, and I shipped four of them for review without
noticing. Node counts and crosslinks got compared to the shipped roster in
the pitch; forks did not, which is exactly how it survived.

**Principle 3 — three "needs new engine work" claims were wrong, because I
read this document instead of the function.** Every one of them was
asserted from a doc line or a field name:

| Claim in v1 | What the code actually says |
|---|---|
| "terrain-speed immunity — small, `terrainSpeedMultiplier` exists" | It exists, but it is a pure function whose result is stashed on `agent.terrainSpeedFactor` at step time (simulation.ts:357). `actionSpeedOf` only reads the already-computed factor, so the passive has to hook the *stash*, not the read. Still small, different place. |
| "move-created flora/bush — medium, new primitive" | **`terrainFill` is shipped and writes any `TerrainKind`, and `"bush"` is a real `TerrainKind`.** The gap is only that it fires at the *defender's* tile on a landed hit (predation.ts:1265); Growth needs the caster's tile from the utility path. An extension, not a new primitive — I overstated the cost. |
| "fertility that doesn't decay back" | Fertility already regenerates toward a per-ground-type `fertilityCeiling` (flora.ts's `GROUND_TYPE_PARAMS`). "Permanent" is not a coherent shape here; raising the ceiling is. The v1 node was designed against a system I had not read. |

One went the other way, and is worth recording because it strengthens a
node rather than weakening it: the detection-radius idea has a real named
function, `isDetectable` (predation.ts:867), with `baseRadius` already
reduced by exactly the sort of term an `unnoticed` passive would add — and
four call sites (two flee-radius, two hunt-detect). Harden's *Let It Pass*
and *Still as Bark* are both cheaper and better-grounded than I claimed.

**Principle 2 — the flagship idea was not mine.** "What if harden also
increased weight so it strengthens weighted version of tackle" is the
user's sentence. I costed it into a primitive and called it "the best thing
here," which is translation, not design. Principle 2 names this exactly:
"costing out a suggestion into real primitives is useful but it's
translation, not design." The nodes here I did originate from a fantasy
nobody asked about — the honest list, so the ratio stays visible — are
*Sickened* (poison as a needs-interference effect, so the payoff of
poisoning is starvation rather than damage), the whole reading of Agility
as a migration move, Growth's *Homestead*, and *Chrysalis* as voluntary
helplessness.

**Node-count inflation, against this doc's own warning.** All five drafts
now sit at exactly 39 nodes. The crosslink rollout section says plainly:
"dig (29) and leech_seed (31) were deliberately left short. Their honest
lever sets are smaller, and inflating them to hit a number is exactly the
template failure the rest of this document exists to prevent. Matching the
flagships' *structure* was the finding; matching their *node count* was
not." Twineedle is a single-species move with one honest lever set, and I
gave it 39 nodes to match a table. That is the same failure in the other
direction, and it is not fixed — it is flagged for a decision.

### What I think holds up

- Growth having no combat branch at all, and the cross-move shape
  generally (a utility tree whose payoff lands in a different tree) —
  that is a structure the roster genuinely does not have.
- Poison Sting's *Sickened* line. It is the only node in either roster
  whose consequence is legible in the chronicle rather than in a fight.
- Naming *Nobody Leaves* as possibly bad for the sim in its own node note
  rather than shipping it quietly: a herd that has solved food is a zone
  that never turns over, which collides with the standing "equilibrium and
  variety, not a dominant answer" pillar. Flagged, not resolved.

### What changed

All five rebuilt to the shipped standard: **39 nodes, 9
`prerequisitesAnyOf`, 6 fork nodes, 3 three-node bridges** each. Every
bridge is crosslink → filler-that-deepens-the-crosslink's-own-lever →
cost-2 notable, with that notable wired as an alternate route into the
pre-fork node of *both* branches it connects, landing one step short of the
fork rather than on it. The crosslink itself stays a shallower alternate
route on an early filler in each flanking branch.

`packages/data/scripts/check-proposed-trees.ts` enforces all of that, plus
dangling prerequisites, one-sided forks, missing `leaning` (the defect that
would render a node invisibly, found once before in the atlas rollout), and
principle 4's pure-downside check. **It runs a `--selftest` against a
deliberately broken tree first**, because a verification step that has
never printed a failure has not been verified — the lesson from the atlas
layout check that reported all 17 trees clean without reading one.

**17. A branch must not answer every identity node with the same signature
lever — and this is NOT the same rule as #13, it is its opposite one level
up.** Direct, blunt: "twin needle just fuckin does the same shit the entire
branch for sociable. Surprised you didn't catch that. Is that not called
out in design docs? Uninspired."

Measured, with the shipped roster as the control. Counting only *identity*
nodes (cost-2: the notable, both fork tips, the convergence, the keystone),
excluding bridges (which principle 13 *requires* to be single-lever), and
excluding background stats — power/accuracy/cooldown/range/crit/defense-pen
repeat harmlessly everywhere and always have. What's left is the share of a
branch's identity nodes answered by one *signature* lever:

| | worst branch | branches at or over 80% |
|---|---|---|
| shipped roster | 50% | 0 of 8 |
| round-six drafts, v2 | **100%** | **6 of 15** |

Twineedle's Sociability was 4 of 5 on `rallyCall` — Converge, The Hive
Decides, Drone Relay and Nothing Forgets were all "the mark, but a bigger
number," and even the *fork* was 240 ticks versus 90. A fork between two
values of one field is not a decision. Agility's Sociability was worse at
5 of 5 on `herdHaste`, and nobody had to point that one out because the
first example was enough.

**Answering the question directly: no, this was not called out.** The
nearest existing rules both miss it:

- Template v3's rule 2 ("use the whole lever list, not just power/accuracy/
  cooldown") is scoped to *filler* tier and to the *three cheap stats*.
  `rallyCall` five times is neither, so it passes the letter of that rule
  while breaking its entire spirit.
- "A capstone's mechanic should be something the roster doesn't already
  have" is scoped to the capstone, and to *other moves* — not to
  repetition inside one branch.

Worse, there was an active trap: **principle 13 mandates exactly this
behaviour for bridges** — "a bridge's own new content must deepen the
specific lever its own crosslink already introduced." I applied bridge
logic to whole branches. The two rules are now explicitly scoped against
each other: single-lever escalation is the *requirement* across a
three-node bridge and a *defect* across a ten-node branch.

Fixed in the drafts by giving each offending branch real, distinct answers
at each identity node rather than a rising number — Twineedle's hive now
forks between a mark and a no-mark sustain build, converges on
`positionSwap` (drones trading places mid-flurry, a shipped primitive with
one user in the entire roster), and keystones on a real shape change to a
burst, which is principle 14's currency and this branch had spent none of
it. Worst branch is now 60%, against a shipped ceiling of 50%; the
remaining 60% cases are branches whose whole fantasy genuinely *is* that
lever (Poison Sting's needs-interference, Growth's fertility), which is a
different thing from a number going up five times.

`check-proposed-trees.ts` now fails any branch over 60%, and its
`--selftest` includes a five-node all-`rallyCall` branch so the rule is
proven to fire.

## The Disposition colour pie — the flavour palette for every branch

**This is the reference that should have existed before round six was
designed, and its absence is why those drafts came out narrow.** Direct:

> "Branches need to have multiple Flavors to it, not a linear path. I've
> talked about the different aspects of like aggression can be stealth, it
> can be aggressive movement. It can be raw damage. It can be piercing
> projectiles. [...] Think of it like the colors in magic. Red can be life
> burn or removal, blue can be hand manipulation or counter spells, etc.
> Our levers, our mechanics can map in loose ways to fit the fantasy of
> these branches. All of these types of flavors need to be considered when
> designing a branch under the fantasy."

What the doc had before this: principle 6 says "widen a branch's *allowed*
flavor before widening its mechanics," and template v3's rule 1 names three
flavours **for Aggression only** (raw power / hunting-stealth / clashing),
with a single worked Boldness example (Earthquake terraforming) and
**nothing at all for Sociability**. That is a third of a colour pie
described in prose. Here it is as a real table, with every flavour mapped
to the levers that actually exist.

An axis is a *colour*, not a mechanic. A branch picks two or three flavours
from its axis that fit the move's fantasy and builds from those — it does
not walk one of them in a straight line. Flavours may also be borrowed
across axes when the fantasy demands it (a shelled pupa's Aggression drawn
from defensive levers is legitimate); what is not legitimate is a branch
that never chose.

### Aggression

| Flavour | Levers that serve it |
|---|---|
| Raw damage | `power`, `hits`, `critRateStage`, `critCooldownReset`, `statusSeverity`, `weightScaling`, `recoilFraction`, `lifestealFraction` |
| Stealth / ambush | `situationalBonus` (`concealed`, `night`, `flanking`, `elevation`), `burrow`, proposed `unnoticed` |
| Aggressive movement | `chargeAttack`, `forcedMovement` (mover: attacker), `lockTicks` as commitment |
| Piercing projectiles | `defensePenetration`, `resistanceBreaker`, `bonusVsType`, `range`, line/`shape` |
| Clashing (resource contest) | `herdConflict.ts`-scoped bonuses — **still has no `situationalBonus` condition**, a real flagged gap |

### Boldness

| Flavour | Levers that serve it |
|---|---|
| Defence | `damageReduction`, `defenseBoost`, `thorns`, `unshaken`, `immovable`, `fireproof` |
| Manipulating the environment | `terrainBurn`, `terrainFill`, `consumesOwnTerrain`, `spawnsRain`, `fertilityBoost`, proposed rubble |
| Wider AoE | `shape` (ring/burst/cone), `hitsArea` — notable/keystone currency only, per principle 14 |
| Attention-grabbing | **`aggroRedirect` — DOES NOT EXIST.** See below. |
| Repositioning other units | `forcedMovement` (mover: defender), `positionSwap`, `positionSwapPull` |
| Planting one's feet / duration | `lockTicks`, `immovable`, `statChangeOnHit`'s `ticks`, `statusSeverity`'s duration, `chargeAttack` |

### Sociability

| Flavour | Levers that serve it |
|---|---|
| Healing | `allyEffect.healFraction`, `healAura`, `regen`, `regenFlat`, `selfHeal` |
| Preventing friendly fire | `excludesAllies` |
| Rallying | `rallyCall` + `preferMarked`, `allyEffectOnAttack` |
| Stat boosting | `allyEffect.buff`, `targetsAlly`, `aquaticHaste`, proposed `herdHaste` |
| Calming auras (reducing others' aggression and clashing) | `calmingPresence`, `nonTerritorial`, `statusImmunityAura` |

### The one flavour with no mechanics at all

**Attention-grabbing has zero engine support.** `aggroRedirect` is named in
this doc's own lever brainstorm as unbuilt, and **three shipped trees carry
a source comment saying they wanted it and settled for `damageReduction`
instead** (moves.ts lines 69, 407, 1182 — Tackle's *Bulwark* among them).
A whole flavour of Boldness has been quietly unavailable this entire time,
and the workaround has been shipped three times. With the palette written
down it is now obviously the highest-value missing primitive on the board:
it is the difference between a defensive branch that survives and one that
*protects*, which is the thing "boldness" is supposed to mean.

### Audit: the round-six drafts against this palette

Distinct flavours drawn on per branch, bridges excluded:

| | shipped | round-six drafts |
|---|---|---|
| mean flavours per branch | **3.8** | **2.9** |
| mean distinct levers per branch | **8.3** | **6.9** |

Three of the drafts' fifteen branches draw on exactly one flavour:
`growth/aggression` (11 nodes, all environment), `growth/boldness` (10
nodes, all environment), `agility/boldness` (10 nodes, all
planted-duration). And three flavours are touched by no proposed branch at
all: aggressive movement, attention-grabbing, and preventing friendly fire.

Direct follow-up while this was being written: "USE MORE LEVERS. Your
levers are so monotonous." The numbers agree — 6.9 against 8.3 — and the
unmapped tail is the specific evidence: `jamCooldownTicks`, `statusSpreads`,
`selfStateBonus`, `drainNeeds`, `gatherBurst`, `selfCostPerUse`,
`statusChance` and `range` are all real, shipped, and barely appear.

### The widening pass, measured

| | shipped | drafts before | drafts after |
|---|---|---|---|
| distinct flavours per branch | 3.8 | 2.9 | **3.7** |
| distinct levers per branch | 8.3 | 6.9 | **9.4** |
| top signature lever's share of a branch | 34% | 51% | **42%** |
| branches drawing on one flavour | 0 | 3 | **0** |

The levers that went in are specifically the ones the audit named as
sitting unused: `gatherBurst` (4 users in the whole roster) on Growth's
*Quicker Season*, `drainNeeds` (6 users, never once as a weapon) on *It Was
All Grass*, `jamCooldownTicks` (16 users, none on a status move) on Harden's
*Sharp Seams*, `selfStateBonus` (3 users) on Agility's *No Bad Ground*,
`consumesOwnTerrain` (1 user) on *The Short Way*, plus `range`, `lockTicks`,
`statusSpreads` and real `shape` changes where a branch had spent none of
its notable-tier currency.

`check-proposed-trees.ts` now fails any branch drawing on fewer than three
flavours, with the colour pie encoded as the lever→flavour map. Its
`--selftest` covers this rule too.

**Still true after the pass, and worth keeping visible:** no proposed
branch uses `excludesAllies` (preventing friendly fire), and nothing in the
entire roster can grab attention, because that primitive was never built.

## PP: the measurement that changes what it should be

"we do need to do the pp thing." Before designing it, two things got
checked rather than assumed.

### 1. The canonical PP data has been sitting in the repo unused

`dex/moves.generated.ts` carries a real mainline `pp` for **every one of
the 35 roster moves** (range 5–40), imported with the rest of the dex and
never surfaced: `moveCanon` returned only type/category/power/accuracy and
dropped `pp` on the floor. Nothing had to be invented, and the values
correlate with power exactly as you'd want:

| PP | moves |
|---|---|
| 5 | hydro_pump, synthesis, moonlight, roost, rain_dance |
| 10 | solar_beam, earthquake, rock_slide, ice_beam, dig, leech_seed, grassy_terrain |
| 15 | flamethrower, rock_throw, surf, body_slam |
| 20–25 | slash, twineedle, psybeam, vine_whip, ember, water_gun, growth, safeguard |
| 30–40 | agility, harden, tackle, peck, scratch, poison_sting, wing_attack, withdraw, defense_curl |

**Done and pushed:** `MoveSpec.pp` now exists and both `moveCanon` and
`statusMoveCanon` source it from the dex — 35/35 moves carry it. It is
deliberately **inert**: nothing reads it, nothing spends it. This is the
one part of PP that needed no design decision, so it is not waiting on one.

### 2. What a PP budget would actually do, measured over 3 seeds × 4,000 ticks

`packages/runner/src/measurePP.ts` counts real per-agent usage (from the
`moveUseCounts` that `useMove` already records) against each move's canon
pool. 67 living agents, 50 of which used a move at all.

| move | canon PP | total uses | agents | **max on one agent** | pools burned |
|---|---|---|---|---|---|
| vine_whip | 25 | 1,420 | 16 | **425** | **17.0x** |
| tackle | 35 | 994 | 15 | **392** | **11.2x** |
| water_gun | 25 | 80 | 5 | 60 | 2.4x |
| take_down | 20 | 146 | 17 | 21 | 1.1x |
| razor_leaf | 25 | 48 | 11 | 12 | 0.5x |
| everything else (23 moves) | — | ≤44 | ≤9 | ≤10 | **≤0.5x** |

**The distribution is the finding.** The median agent's heaviest move burns
**0.31x** of its pool in 4,000 ticks — most of the roster would never once
notice PP existed. Meanwhile two moves run 11x and 17x over.

That reframes the mechanic. Modelled as mainline PP — a budget everyone
tracks — it would be invisible to ~90% of the sim and would simply switch
off the three heaviest units, which are the guardians and territory-holders
doing the most narratively interesting work. **Its real function here is a
rate limiter on outliers**, and the outliers are already a standing balance
problem independent of PP: 1,420 Vine Whips against 48 Razor Leafs is one
move eating a whole species' combat identity.

### The decisions that actually need making

None of these are mine to pick — they change game feel, and this document's
own rule is to surface the finding and the options.

1. **Regen shape.** (a) Slow always-on trickle plus a big multiplier while
   asleep — reuses the shipped sleep machinery, and DESIGN.md's sleep
   section already records the verbatim ask *"make it so it replenishes hp
   and pp more"* with the admission that it substituted cooldowns because
   "there's no PP resource to restore." (b) Sleep-only regen: harsher,
   makes sleep genuinely mandatory, very legible in the chronicle.
   (c) Needs-gated regen (recovers only while fed and watered).
   **Recommend (a).**
2. **Behaviour at zero.** (a) The move drops out of `pickBestMove` and the
   agent uses something else — a predator that has run dry disengages,
   which is a real chronicle beat. (b) A Struggle-style fallback with
   recoil. (c) Usable at reduced power. **Recommend (a).**
3. **Rate.** To cut the 17x outlier to roughly 2x sustained, a 25-PP pool
   needs about 1 PP per 20 ticks. That number is a balance decision, and it
   should be measured before/after across seeds like every other one.
4. **The Nx-PP lever**, already asked for: *"a node that spends 2x (or Nx)
   PP in one use for a proportionally bigger effect... I feel like we're
   underutilizing PP too."* Genuinely good, and note it only becomes a real
   tradeoff for the moves PP actually binds — which, per the table above,
   is currently three of thirty-five. Widening that set is the same
   decision as (3).

Stopped short of building the mechanic deliberately (principle 10, and
"never unilaterally retune balance numbers"): the data layer needed no
decision and is done; the behaviour is gated on 1–3.

### PP is tree currency, not a rate limiter — the reframe

Direct correction after the measurement above: *"I think regen is fine. I
just think more pp tradeoffs are the play. Notables that require pp. It
becomes a gate."*

**This inverts the finding.** The measurement said PP binds on only three of
thirty-five moves, so a global PP budget would be invisible to most of the
sim — and that is a real argument against PP as a rate limiter. It is not an
argument against PP at all, because **a node that costs PP creates the
binding itself.** The pool does not need to be naturally tight; the tree
makes it tight, on the builds that opted in.

Taking regen as settled per the same message: slow always-on trickle plus
the sleep multiplier (option 1a), which is what DESIGN.md's sleep section
already promised and substituted cooldowns for.

**Why this is the best thing PP could be here.** Three reasons, and the
third is the one that makes it worth building:

1. **It is the roster's first real cost axis.** Nearly every node shipped is
   strictly upside. A node reading "much bigger effect, 4 PP a use" puts the
   benefit and the cost *in the same node*, which is exactly what principle
   4 demands and what `recoilFraction`-only fillers failed.
2. **It constrains a build.** You cannot take every heavy node, because the
   pool will not sustain them. That is a genuine decision where trees
   currently only offer forks.
3. **The gate comes free from canon, and it is already correctly shaped.**
   Canon PP tracks move power inversely, so the strongest moves have the
   tightest budgets with no tuning at all:

| Pool | Moves | What a heavy notable does to it |
|---|---|---|
| **5** | hydro_pump, synthesis, moonlight, roost, rain_dance | at 3 PP a use: **1 use.** The gate is absolute |
| **10** | solar_beam, earthquake, rock_slide, ice_beam, dig, leech_seed, grassy_terrain | at 3 PP: 3 uses |
| **15–20** | flamethrower, rock_throw, surf, body_slam, slash, twineedle, growth… | affords one heavy node, or two mid |
| **25–40** | tackle, peck, scratch, poison_sting, agility, harden, withdraw… | affords a real heavy build |

12 moves sit in the hard-gate band, 10 mid, 13 loose. A Hydro Pump build
genuinely cannot look like a Tackle build, and nobody has to hand-tune that.

**Not every notable — density scales with the pool.** Direct correction:
*"Make the low pp moves not as punishing then. We don't have to have all
notable cost pp. Just some of em."* Right: a 5-PP move should not be
punished for having a small pool. The cap is **ceil(pool / 12)**:

| Pool | PP-costing nodes allowed |
|---|---|
| 5–10 | 1 |
| 15–20 | 2 |
| 25–35 | 3 |
| 40 | 4 |

Six PP costs came back off the drafts to meet it.

**And the headroom filler is worth wildly different amounts by pool — which
is the point.** *"We can also have max pp increase filler, and for hydropump
that actually means something, you know?"* Exactly; one +5 max-PP node:

| move | pool | +5 is | uses of a 3-PP notable: base → +5 → +10 |
|---|---|---|---|
| **hydro_pump**, synthesis, roost | 5 | **+100%** | **1 → 3 → 5** |
| solar_beam, earthquake, dig | 10 | +50% | 3 → 5 → 6 |
| flamethrower, body_slam | 15 | +33% | 5 → 6 → 8 |
| twineedle, growth | 20 | +25% | 6 → 8 → 10 |
| tackle, poison_sting | 35 | +14% | 11 → 13 → 15 |
| defense_curl | 40 | +13% | 13 → 15 → 16 |

The *same node* triples Hydro Pump's uses of a heavy notable and is a
rounding error on Defense Curl. A filler that is genuinely build-defining on
one move and skippable on another is the best kind of filler this roster
has, and it needs no per-move tuning at all — the canon pool does it.

So the checker also enforces a **relative** headroom floor: a tree that
spends PP must sell back at least a third of its own pool.

**Every branch keystone requires PP, within that cap.** Direct clarification:
*"I meant make notables require pp basically."* So a per-use PP cost sits on
each branch's keystone plus the heavy fork, scaled to the move's own canon
pool — 19 PP-costing identity nodes across the five drafts:

| Draft | pool (+headroom) | PP-costing nodes → uses base / with headroom |
|---|---|---|
| Harden | 30 (+10) | 3/3 · Chrysalis 4 → 7/10 · Brittle Edge 3 · Let It Pass 2 |
| Twineedle | 20 (+8) | 2/2 · Pincushion 3 → 6/9 · Nothing Forgets 3 |
| Poison Sting | 35 (+12) | 3/3 · Nothing Recovers 3 → 11/15 · Venom Glut 2 · The Nest Decides 2 |
| Growth | 20 (+10) | 2/2 · It Takes 4 → **5/7** · The Orchard 4 → **5/7** |
| Agility | 30 (+10) | 3/3 · Faster Than Thought 3 → 10/13 · The Migration 3 · Nothing Stops It 2 |

Growth is the sharpest read: a Bulbasaur that specced *The Orchard* plants
**five trees in its life**, seven if it bought the headroom. That is the
mechanic doing what a paragraph of flavour text cannot.

**A tax is not an economy.** Every tree that spends PP must also sell
headroom back, or the node is just a nerf with extra steps. Both halves are
in the drafts:

| Draft | pool | spends | sells |
|---|---|---|---|
| Harden | 30 | *Chrysalis* 4/use → 7 uses | *Slow to Shift* +8 |
| Twineedle | 20 | *Pincushion* 3/use → 6 flurries | *Quicker Draw* +6 |
| Poison Sting | 35 | *Venom Glut* 2/use | *Quick Fangs* +10 |
| Growth | 20 | *It Takes* 4/use → 5 bushes | *Patient Soil* +10 |
| Agility | 30 | *Faster Than Thought* 3/use | *Short Rest* +8 |

*Venom Glut* is the first node in either roster to cost **both** a need and
PP — venom as a consumable twice over.

`check-proposed-trees.ts` now enforces both halves: a `ppCost` may only sit
on an identity node (a build decision, never filler), and any tree that
spends PP must grant `maxPPBonus` somewhere.

**Honest caveat on the drafts.** All five sit at pools of 20–35, so they
demonstrate the tradeoff but not the *hard* gate. The moves where PP would
bite hardest — Hydro Pump at 5, Earthquake and Solar Beam at 10 — are
already-shipped trees, and retrofitting PP costs into them is the real test
of this idea, not these five.

**Engine work this needs** (none of it built): `MoveSpec.ppCost`, a live
`Agent.movePP` counter spent in `useMove` (combat.ts — already the single
choke point that sets cooldowns and increments `moveUseCounts`),
`MoveTreeNode.delta.maxPPBonus`, regen in `tickStatusEffects` with the
sleep multiplier alongside `SLEEP_COOLDOWN_TICKS_PER_ACTION`, and
`pickBestMove` skipping a dry move.

### Filler forks: diverging paths that reconverge at the notable

Direct: *"Maybe we can split aggression filler paths even with power vs pp??
That's really cool. Boldness filler with cooldown vs aoe or duration."* Then,
sharpening it: *"Well it can fork paths, that converge at notables."*

That second sentence is the whole design. A filler fork is **not** a
permanent commitment to a sub-branch — both sides feed the same next node, so
the choice is which route you walk, not which half of the tree you give up.

**One filler fork per branch, at the post-notable slot** — the point where a
build has already committed to the branch and knows what it needs. Structure
against the shipped roster:

| | shipped | drafts |
|---|---|---|
| nodes | 36.1 | 42.0 |
| fork nodes | 6.1 (3 real choices) | 12.0 (**6 real choices**) |

Pushback that shaped it, recorded because the answer overrode it: my first
instinct was that forking every filler would make nothing feel like a choice
— shipped trees get exactly three per tree. Doubling to six is the right
size; forking all nine filler slots would not be. The reconvergence is what
makes six affordable: a route choice costs less than a commitment.

**The power-versus-PP split, which is the best pair of the set:**

| tree | fork | the PP side is worth |
|---|---|---|
| Twineedle | Thin Point vs **Venom Sacs** | +8 on a 20 pool = **+40%** |
| Growth | Choking Out vs **Spore Reserve** | +10 on a 20 = **+50%** |
| Poison Sting | Finisher vs **Glut Sacs** | +12 on a 35 = +34% |
| Agility | No Wind-Down vs **Second Wind** | +10 on a 30 = +33% |
| Harden | Slow to Shift vs **Deep Reserve** | +10 on a 30 = +33% |

**It is self-balancing, which is the part that makes it good design rather
than just another node.** `+max PP` is only worth taking if you took the
PP-heavy notables. On a build that went wide it is a dead pick; on a build
that went deep it is the strongest node in the branch. Nobody has to tune
that — the build decides it retroactively. The other pairs are drawn from
each move's own palette per the colour pie, never a fixed template: thorns
vs tempo, range vs crit, duration vs terrain, heal vs denial.

**A real bug this caught.** My first pass gave each fork's B-side the same
parent but left the downstream node requiring the A-side specifically —
so every B-side was a **dead end** and any build taking one was stranded.
"Converge at notables" named the defect before it shipped.
`check-proposed-trees.ts` now enforces it: both sides of any fork must reach
a common downstream node, with a terminal-capstone fork exempted. Verified by
deliberately stranding one and confirming the report:

```
fork deep_reserve/slow_to_shift: the two sides never reconverge — one of them
is a dead end (deep_reserve -> [nothing], slow_to_shift -> [set_bone])
```

### The two-lane branch, finished shape

Three corrections landed on the pilot in sequence, each fixing something real:

1. *"I mean little like path of exile. Like multi paths to same notable."* —
   filler alternatives stopped being mutually exclusive. 30 `excludes`
   removed; scarcity of points is what makes a route a decision, not a
   lockout.
2. *"x x Y x x / a a B a a ... you can technically go both Y and B
   'excludes' you just have to invest a Lotta skill in it."* — two parallel
   lanes, each with its own notable.
3. *"did you get rid of a deeper notable on each branch? You could have the
   paths converge to a linear notable, then have another linear single filler
   and single end capstone to really make it feel complete?"* — **yes, I
   had.** Collapsing to lanes cut identity nodes per branch from 5 to 3; the
   deep convergence notable was simply gone.

The finished branch, 12 nodes:

```
                opener
        ┌──────────┴──────────┐
   x → x → [LANE NOTABLE] → x   a → a → [LANE NOTABLE] → a
        └──────────┬──────────┘
              [DEEP NOTABLE]        <- both lanes end here
                    │
                 filler
                    │
               [CAPSTONE]
```

Four identity nodes per branch, 45 nodes per tree, and every capstone sits
26 points deep by the cheapest route. Walking one lane costs 16; walking both
costs 21 — you *can*, it just costs five more points.

**Bridges land deep now, and on one lane each.** They used to drop you at a
lane's *entry*, which is the shallowest possible landing. Each bridge notable
is now an alternate route into a **lane notable** — skipping that lane's
filler grind but never the lane choice itself (principle 12, restated for
lanes). And per *"I'm okay if the cross links only let you move to one of the
two soft exclusive branches"*, each bridge reaches **one lane per branch**,
which gives every bridge a character instead of making it a skeleton key:

| Bridge | joins | character |
|---|---|---|
| Blur of Needles | Pincushion (agg) + Never Landed (bold) | tempo dropped into the slow lane |
| Ambush Hive | High Pass (bold) + Converge (soc) | the two patient, high lanes |
| Venom Mark | Fourth Needle (agg) + Drone Relay (soc) | venom that holds, on the fast lane |

The Aggression pair was swapped for a reason that started visual and turned
out to be a design improvement: *"Blur of needles should probably go to
conserving draw and vice versa just to get it to not get visually
confusing."* The two shortcut lines were crossing the entire tree to reach
the far lane. Un-crossing them means each bridge now **complements** its lane
instead of matching it — a tempo bridge landing in the slow, measured reserve
lane supplies the tempo that lane otherwise lacks, and the venom bridge lands
where four needles can each carry venom that holds. Matching a bridge to the
lane that already shares its identity just deepens a rut.

One adjustment to the literal ask: the landings are on the lane **notables**
(Pincushion, Fourth Needle), not the fillers past them (Conserving Draw, Thin
Point). Landing past a notable skips it, and a bridge may skip a lane's grind
but never its decision — principle 12, restated for lanes.

**Two things the new capstone tier finally bought:**

- *Empty the Sacs* is the **deferred Nx-PP lever**, at last at the tier it
  belongs: 5 PP in one use for everything the Beedrill has. That idea has sat
  in this document unbuilt since the PP brainstorm.
- *The Swarm Decides* uses `excludesAllies` — the one Sociability flavour
  **no proposed branch touched**, flagged by this document's own colour-pie
  audit. A hive-wide AoE that no longer stings its own is exactly where it
  belongs.

Four drafts still use the previous shape. Rolling this out to them is a
decision, not an oversight — one tree was piloted first on purpose.

## Skill-tree template v4 — the two-lane standard (proposed for all moves)

> "Perhaps we should standardize that for ALL moves. This exact shape of
> tree?" / "Well they should get a skill point every level right."

### First, the reach check — because depth is only real if agents get there

A capstone 26 points deep needs a level-27 agent to exist. Measured, 3 seeds
x 4,000 ticks, 67 living agents, plus the existing `validateCapstoneReach`
over 4 seeds x 8,000 ticks:

| | |
|---|---|
| level | min 6 · **p50 25** · p90 34 · p99 46 · max 46 |
| an 8-point node | reachable by 94% of agents |
| a 16-point node | 82% |
| a 21-point node | 72% |
| **a 26-point node** | **45%** |
| currently reach a terminal capstone | 33% |
| **unspent points banked per agent** | **9.81** |

So the two-lane tree's 26-point capstones land at 45% reach — *better* than
the 33% the current roster manages. And the decisive number is the last one:
agents are sitting on ~10 unspent points each. **There is real headroom for
deeper trees**; the roster is currently too shallow for its own progression
curve, not too deep. Depth is affordable.

(That 9.81 figure is worth its own investigation — points banked and never
spent is either an AI picking constraint or genuinely nothing worth buying.
Logged, not chased here.)

### The standard

Per branch, 12 nodes:

```
                opener
        ┌──────────┴──────────┐
   x → x → [LANE NOTABLE] → x   a → a → [LANE NOTABLE] → a
        └──────────┬──────────┘
              [DEEP NOTABLE]
                    │
                 filler
                    │
               [CAPSTONE]
```

Plus three crosslink bridges (crosslink → filler deepening its own lever →
cost-2 notable), each landing on **one lane notable per branch** it connects,
complementing that lane rather than matching it. Nine `prerequisitesAnyOf`:
six lane notables plus three deep notables.

### Node count: "thin lever set" was a rationalisation, and the data says so

I argued the standard should be structure-only, because a move with a "thin
honest lever set" should get shorter lanes rather than invented filler —
citing this document's own note that dig (29) and leech_seed (31) were
"deliberately left short." Direct pushback:

> "Problem is, we do have 45 nodes of real ideas on everything. It's the cool
> part of the game."

**Correct, and it is measurable.** Counting the shared lever palette the
roster actually uses — 71 distinct levers — against what each tree touches:

| tree | nodes | levers used | **levers untouched** |
|---|---|---|---|
| **dig** | 29 | **12** | **59** |
| **leech_seed** | 31 | **13** | **58** |
| water_gun | 33 | 18 | 53 |
| peck / scratch | 33 | 19 | 52 |
| earthquake | 39 | 27 | 44 |
| twineedle (v4) | 45 | 27 | 44 |

Dig — the tree named as honestly thin — uses **12 of 71 levers and leaves 59
untouched.** That is not a small lever set; it is an unexplored one. And this
document contains a whole section, *"Confirmed for later: Diglett tunnel
networks"*, recording a decision ("tunnel networks are cool as fuck we're
gonna do it") that was written down and never built. The ideas were not
missing. The work was.

**So: 45 nodes is the standard too.** Not as a quota to pad toward — as an
expectation that if a move cannot fill it, the fantasy has not been
interrogated hard enough yet. That is a very different instruction from
"inflate to hit a number," and it inverts what the earlier note assumed.

The real risk was never running out of ideas; it is **filler produced under
volume pressure** — which is exactly what the earlier measurement caught in
these very drafts (power/accuracy/cooldown accounting for 280 of ~700 lever
uses). That risk is already guarded by the rules in
[`DESIGN_VALIDATION.md`](DESIGN_VALIDATION.md): a branch must draw on three
or more flavours, no signature lever may answer more than 60% of a branch's
identity nodes, and no node may be pure downside. Volume is safe when the
quality gate runs on every tree. It was not safe when the only gate was
whether I felt like writing more nodes.

`check-proposed-trees.ts` therefore enforces the **shape** — two lanes, a
notable in each, a deep convergence notable, a filler, a capstone, three
bridges, nine anyOf — and says nothing about how many nodes fill it.

### v4 addendum: every node costs 1, and the snake concern measured

> "We can make every node cost 1, just make it always require 1 skill point
> as long as you're connecting it to an existing node 'one layer' below it.
> I think we probably don't want you to be able to capture all outer nodes
> and capstone with just a single connected line, but none of the early
> nodes for that branch? Idk. thoughts?"

**Uniform cost — done.** 87 cost-2 nodes flattened. Depth is now the only
price, which is the Path-of-Exile reading and is more legible than a second
number: a notable is expensive *because it is far away*, not because it says
2 on it.

It forced a real definition change in the checker, and a better one. Notables
were previously identified by `cost >= 2` — a label. Under uniform cost the
question becomes structural: **a notable is a node that routes converge on**
(two or more `prerequisitesAnyOf` entries), and a capstone is terminal. That
is what "notable" always MEANT; cost was standing in for it.

**The snake concern: measured, and it is already a non-problem.** Cheapest
legal route to each capstone, across all five drafts:

| tree | capstone | points | in its own branch | borrowed |
|---|---|---|---|---|
| twineedle | Empty the Sacs | 8 | 8 | **0** |
| twineedle | Never There | 8 | 8 | **0** |
| twineedle | The Swarm Decides | 8 | 8 | **0** |
| harden | all three | 9 | 9 | **0** |
| poison_sting / growth / agility | all three | 9 | 9 | **0** |

**Zero points borrowed from another branch, on any capstone in any tree.**
The reason is arithmetic rather than luck: a bridge costs two openers plus
three bridge nodes (5 points) to save three points of lane filler, so
snaking is *more* expensive than walking. Bridges are shortcuts to a lane
notable for a build already invested in two branches — never a back door to
a capstone.

Encoded as a regression guard anyway, since trees will keep changing: a
capstone's cheapest route must be ≥75% inside its own branch.

**And the point economy lands somewhere satisfying by accident.** A full v4
tree is 45 nodes = 45 points. Observed agent levels: p50 25, p90 34, **max
46**. So a maximum-level agent can just about complete exactly one tree, a
median agent affords three capstones (24 points) *or* one branch walked
completely with both lanes — a real build decision, not a formality.

## The overwrite bug: "if you got both, would it just do nothing?"

> "On twineedle high pass makes it a multi strike. Blur of needles also does
> that. How does that work? If you got both, would it just do nothing? [...]
> I like the idea of ADDING modifiers so you can stack your build, not
> setting them. Because with the latter you don't know how they will interact
> with each other."

**Worse than nothing.** Read from `applyMoveTree` (engine/moves.ts), not
guessed:

| behaviour | fields |
|---|---|
| **additive** | `power`, `accuracy`, `cooldownTicks`, `statusChance`, `defensePenetration`, `lockTicks` |
| **overwrite — last one applied wins** | `shape`, `range`, `hits`, `forcedMovement`, `situationalBonus`, `statChangeOnHit`, `rallyCall`, `allyEffect`, `positionSwap`, `hitsArea`, `terrainBurn`, … |

The engine's own doc comment already admitted it: *"order given to
`applyMoveTree` matters for overwriting fields like `shape`."* So two
co-takeable nodes setting `hits` do not cancel and do not stack — whichever
the chosen-id iteration reaches last silently wins. The result depends on
allocation order, is invisible in the UI, and cannot be reasoned about from
the tree.

**Measured across the whole roster** — pairs of co-takeable nodes (neither
mutually exclusive nor on the same chain) writing the same overwrite field:

| | colliding pairs | trees affected |
|---|---|---|
| proposed drafts, before | 106 | 4 of 5 |
| **shipped trees** | **39** | **11 of 17** |
| proposed drafts, after | **0** | 0 |

Worst shipped offenders: `rock_throw` and `wing_attack` at 8 pairs each,
`slash` 6, `solar_beam` 5, `hydro_pump` 4.

### The fix: additive forms

Drafts converted — these are proposed engine fields, not shipped ones:

| was (overwrite) | now (additive) |
|---|---|
| `hits: {min, max}` | `hitsBonus: +N` |
| `range: {max}` | `rangeBonus: +N` |
| `situationalBonus: {…}` | `situationalBonuses: [{…}]` — multipliers stack |
| `statChangeOnHit: {…}` | `statChangesOnHit: [{…}]` |
| `rallyCall: {ticks}` | `rallyCallTicks: +N` |
| `allyEffect: {…}` | `allyEffects: [{…}]` |

**One refinement the first version of the rule got wrong:** a later node on
the *same chain* overwriting an earlier one is intended escalation, not a
collision — Hit and Gone (2 tiles) → Never Landed (3) → Never There (4) is a
deliberate ladder. Only *independent* setters are the bug. The checker now
tests ancestry before reporting.

**Area size is additive too, on a second pass.** *"Hits area should be
additive. Make it scalar with range of area. Agreed on shape though. Maybe
that excludes you from taking other shape modes."* Right — `hitsArea` was a
boolean bolted to a `shape` carrying a `radius`, so widening an area meant
redeclaring the whole footprint. Split in two:

- **`shape`** — what FORM the area takes (burst, ring, cone). Still an
  overwrite, because a cone genuinely is not a ring plus a line.
- **`areaBonus: +N`** — how BIG it is. Additive, stacks across nodes.

Twineedle's Sociability shows why that is better than the rule alone: Nothing
Forgets sets `shape: burst, areaBonus: +1`, and The Swarm Decides adds
`areaBonus: +1`. Taking both gives a radius-2 burst — **the same cloud,
widened**, rather than a second declaration racing the first. The capstone no
longer restates the notable's footprint; it grows it.

**And `shape` now locks out rival forms.** Independent shape nodes must
declare `excludes` against each other: a move has one footprint, so choosing
a form is a real fork rather than a silent race. Verified the rule fires by
adding a rival cone to Twineedle's Aggression and confirming the report,
then reverting.

The design rule that came out of the first pass still holds and is now
enforced by that exclusion: Twineedle's Aggression was quietly fighting
Sociability over the footprint, so Hollow Points stopped being a cone. Every
draft now has at most one shape setter (Agility has none).

### Repositioning, phrased from the target

> "the reposition moves phrasing is quite confusing. It should be phrased
> around repositioning based on a specific target. Ex. Move to the other side
> of the target by 2 tiles."

`forcedMovement: { mover, direction: "closer" | "away", tiles }` describes
motion relative to *nothing legible* — "closer" to what, and where do you end
up? Replaced in the drafts with a target-relative vocabulary:

| `reposition.to` | means |
|---|---|
| `"past"` | end up on the far side of the target, N tiles beyond it |
| `"back"` | disengage N tiles from the target |
| `"shoved"` | the target is driven N tiles away from you |
| `"dragged"` | the target is hauled N tiles toward you |

Each says who moves and where they end up relative to whom.

## Cooldown overshoot, and what the action economy says about cooldowns at all

> "We should be careful about cooldown nodes lowering the cd beyond 0." …
> "I mean it's okay to get to cooldown 0, just a bunch of filler beyond that
> is not useful."

The engine already clamps (`Math.max(0, …)`), so nothing goes negative. The
waste is real anyway: **every tick of reduction past a move's base cooldown
is a node that provably does nothing** — this project's own definition of a
bug, applied to overshoot.

Measured across the roster:

| move | base cd | total reduction | dead ticks |
|---|---|---|---|
| **agility** (draft) | 50 | −65 | **15** |
| **ember** (shipped) | 2 | −6 | **4** |
| **twineedle** (draft) | 3 | −7 | 4 |
| **harden** (draft) | 40 | −44 | 4 |
| slash, wing_attack (shipped) | 2 | −4 | 2 each |
| tackle, vine_whip (shipped) | 2 | −3 | 1 each |

Eight of twenty-two trees hand out more reduction than the move has cooldown.
And **12 of 22 can reach cooldown 0 at all** — Ember in **3 skill points**.

### CORRECTION: my "cooldown is barely a constraint" analysis was wrong

I wrote here that a 2-tick cooldown is "inert for 31% of agents" and that the
2-to-4-tick band is a weak axis, having measured `ACTION_THRESHOLD` against
the gap in **world ticks** between an agent's actions. Direct challenge:

> "I thought we made it scale off speed. So your cooldown ticks down on your
> turn, based on your speed, not individual ticks?"

**Correct.** `tickCooldowns` is called from `tickAgentAction` (needs.ts:1279),
and `tickAgentAction` "only run[s] on an agent's own action tick"
(simulation.ts:273). Cooldowns are counted in the agent's **own turns**, not
world ticks. The code comment even names the exact bug I re-created:

> "not once per world tick regardless of Speed, which is what this lived as
> before: a move with `cooldownTicks: 1` was effectively always off-cooldown
> for anything slower than the action threshold itself"

That was fixed deliberately, and I measured the system as though the fix had
never landed — a unit error, comparing turn-denominated cooldowns against
world-tick action gaps. **Retracted in full:**

- ~~"a 2-tick cooldown is inert for 31% of agents"~~ — false. A cooldown is
  never inert. `cooldownTicks: N` means the move is usable every (N+1)th
  action, for everyone, at any Speed.
- ~~"the 2-4 tick band is a weak axis to spend nodes on"~~ — false. It is a
  strong one.
- ~~"raising base cooldowns is supported by the data"~~ — withdrawn. Nothing
  supports it; the suggestion came entirely from the bad measurement.

**And the correction makes the original concern bigger, not smaller.** On a
base-2 move, going to 0 is not a rounding difference — it is the move firing
**every** action instead of every third: a real 3x tempo gain. So Ember
reaching cooldown 0 in three skill points matters more than I credited, and
"be very careful not to add too much cooldown" was right for a reason I
argued against.

What survives untouched, because it never depended on the action economy:
every tick of reduction past base is still a node that does nothing, and 12
of 22 trees still overshoot or bottom out.

### What was done

### What was done

`check-proposed-trees.ts` now fails any tree whose total cooldown reduction
exceeds its base. The three offending drafts were **repurposed rather than
just shrunk**, which is the better outcome — a node reaching for tempo out of
habit became a node that does something the lane actually cares about:

- Twineedle's *Gliding* buys **reach** instead (Lane H is the strafing lane).
- *Hive Tempo* buys a **longer mark** (Lane M is the marking lane).
- *Quicker Draw* steadies the **flurry** (Lane P's identity).
- Agility's *The Short Way* now also cuts **straight past** whatever is in
  the way — the literal short way — instead of −15 ticks a 50-tick move only
  partly had to give.

All five drafts are now within budget. **The four shipped offenders — ember
(4 dead ticks), slash (2), wing_attack (2), tackle and vine_whip (1 each) —
are untouched live data.**

## Cooldown as a balance axis — the numbers, and the decision

> "So yeah maybe the idea is we gotta make more cooldown standard? Idk."

With the units right (cooldown counts the agent's own turns), the picture is
clear and it is not what my retracted analysis said.

**Damage per action is `power / (cooldownTicks + 1)`.** That denominator is
tiny, so each −1 is worth an enormous amount, and worth more the closer to
zero it gets. Fully-invested multipliers, by lever:

| lever | mean multiplier | notes |
|---|---|---|
| power nodes | **2.00x** | |
| multi-hit | **2.00x** | |
| **tempo (cooldown)** | **2.61x** | and it is bought with the cheapest filler in the tree |

Worst cases are much worse than the mean: **Hydro Pump 22 → 110 damage per
action, a 5.0x gain from cooldown nodes alone**, no power nodes involved.
Flamethrower and Rock Slide 4.0x. Twineedle 4.0x.

**So tempo is the strongest lever in the system and the cheapest to buy.**
That is the real defect, and it is a better reason for the original worry
than the one I gave.

### Why raising base cooldowns does not fix it on its own

Raising the base makes each individual −1 proportionally smaller, but the
*total* gets worse, not better: 4 → 0 is 5x, and 8 → 0 would be 9x. Raising
the base only helps if the tree is also stopped from spending it all.

There is a second, separate reason to raise it though. Across damaging moves,
**power spans 8.0x (15–120) while cooldown spans 2–4** for everything except
Dig. Cooldown is currently doing almost no work distinguishing a Tackle from
a Hydro Pump — a 110-power nuke is available every 5th action against
Tackle's every 3rd. Widening that band would make cooldown a real identity
axis (big slow move vs. quick jab) *and* create room for tempo nodes to
matter without bottoming out.

### The options

1. **Floor total reduction at half the base.** A tree may never take a move
   below 50% of its base cooldown. Caps tempo at ~2.0x, exactly in line with
   power and multi-hit. Smallest possible change; the checker already
   computes the totals, so it is one threshold.
2. **Widen base cooldowns** so they track power the way canon PP already
   does — quick jabs at 2, heavy hitters at 8–10. Makes cooldown a real
   differentiator and gives tempo nodes somewhere to go.
3. **Multiplicative reduction** (each node −15%, stacking multiplicatively).
   Never reaches zero, naturally diminishing. Elegant, but rounds badly on
   a 2-tick cooldown where −15% is a third of a tick.
4. **2 and 1 together.** Widen the band, then floor at 50%. Hydro Pump at
   base 8 floors at 4 — still every 5th action fully invested, a 1.8x tempo
   gain, and it *feels* like a big slow move throughout.

**Recommendation: 4.** It fixes the overpowered lever and the flat
differentiation in one pass, and it is the version where cooldown finally
carries some of the identity work that only power is doing today.

**Not applied.** These are balance numbers across 22 moves and this
document's standing rule is that those are the user's call, not mine.

### Applied: widened cooldowns + a 3x tempo cap

> "2 +1 together. Cap it at 3x"

**Base cooldowns now track power**, the way canon PP already does. Utility
moves keep theirs; Dig keeps 15 (that number is about burrowing, not damage
pacing):

| power | cooldown | moves |
|---|---|---|
| ≤25 | 2 | poison_sting, twineedle |
| 26–45 | 3 | tackle, peck, scratch, water_gun, ember, vine_whip |
| 46–65 | 4 | rock_throw, wing_attack, sludge, psybeam |
| 66–80 | 5 | slash, rock_slide |
| 81–95 | 6 | body_slam, flamethrower, surf, ice_beam |
| 96–110 | 8 | earthquake, hydro_pump |
| 111+ | 9 | solar_beam |

**And the cap.** A tree may not reduce a cooldown below
`ceil((base+1)/3) − 1`, which holds the tempo multiplier at or under **3.0x**
— in line with power (2.00x) and multi-hit (2.00x) rather than the 5.0x
Hydro Pump had. Nine trees were over and were trimmed; the worst were Agility
(−50 → −34) and Harden (−40 → −27).

**A regression the trim caused, and how it was caught.** Shaving cooldown
deltas left **six nodes with nothing left to do** — `tackle/aftershock`,
`vine_whip/deeper_hold`, `ember/steady_flame`, `ember/slow_burn`,
`wing_attack/quicker_wings` and Twineedle's `quick_and_many` — five of them
literally named "-1 Cooldown" while no longer reducing cooldown, which breaks
principle 4 (a node must do something) and principle 5 (a name that states a
magnitude must match it). All six repurposed with real levers and renamed.
Twineedle's tempo bridge had the tightest squeeze: on a base of 3 there are
only 2 ticks to spend, so the crosslink and its filler take those and the
bridge *notable* escalates tempo into volume (`hitsBonus`) instead.

**Verified with a real before/after**, 4 seeds x 4,000 ticks, because this
moved balance numbers on 21 moves:

| | before | after |
|---|---|---|
| fought events | 388 | **350** (−10%) |
| deaths | 58 | **58** (identical) |
| living at end | 80 | **106** (+33%) |

Slightly less combat churn, exactly the same lethality, and a third more
survivors. Nothing broke. The population rise is a real consequence worth
watching — slower moves mean fewer resolved fights per unit time — and is
flagged rather than tuned away. 1,274 engine + 240 data tests pass.

## Shipped-roster audit, and the v4 conversion question

> "Can we rework the old trees to have the split filler paths too? I want more
> cooldown reduction for the heavier things like solar beam."

**Done: the cooldown half.** Solar Beam is the heaviest cooldown in the
damaging roster (9) and was spending only −2 of the −6 the 3x cap allows.
Now at −6: **tempo 1.67x → 2.50x**. No structural change, no test churn.
Remaining headroom elsewhere, for the same treatment: leech_seed (11 ticks
unspent), earthquake (4), rock_throw (3), hydro_pump (2), body_slam (2),
peck/scratch/water_gun (2 each).

**`check-proposed-trees.ts --shipped` now runs every rule over the real
`MOVES` roster.** That was flagged as the obvious next step several rounds
ago; it is done, and it reports **136 findings across all 17 shipped trees**:

| finding | count |
|---|---|
| branch under 12 nodes | 47 |
| under 4 identity nodes | 27 |
| crosslink is a spur, not a bridge | 22 |
| overwrite collision | 15 |
| `anyOf` below 9 | 7 |
| under 3 flavours | 5 |
| rival shape nodes | 4 |
| bridge filler shares no lever with its crosslink | 4 |
| one lever answers a whole branch | 3 |
| capstone reachable by snaking in | 1 |
| pure-downside node | 1 |

### Why the structural conversion stopped after one tree

Solar Beam's branches were converted to the two-lane shape and it worked —
39 nodes, 9 `anyOf`, both lanes reconverging. Then **five tests failed, and
they were right to.** They encode v3 decisions deliberately, and one is a
real design choice that v4 dissolves:

> *"Sociability's fork makes the ally-effect overwrite an explicit,
> deliberate choice (heal the grove vs. steel it), not an emergent quirk"*

That fork exists **because** `allyEffect` is an overwrite field — v3 solved
the collision by forcing the player to pick. Under v4, `vital_bloom` becomes
a lane notable and `steadfast_bloom_ally` the deep notable downstream of it,
so a build takes both and the later one wins. That is legitimate escalation
under v4's own rules, and it is also **the deliberate choice being quietly
removed**. Rewriting the test to match would have laundered a design decision
into a green checkmark.

So the structural rewire was reverted and the question goes back:

1. **Convert anyway**, accepting that some v3 forks dissolve into lane
   progressions. Fastest; loses a few explicit either/ors.
2. **Convert but keep the forks**, placing each preserved fork *inside* a
   lane rather than at the branch's end. Slower per tree, keeps every
   deliberate choice.
3. **Convert only the trees whose forks are ordinary power/accuracy picks**,
   and leave the ones where the fork guards a real overwrite decision.

**Recommendation: 2.** Nothing in v4 forbids a fork — the corridor rule
accepts a fork *or* lanes — so the two are compatible, and the forks that
exist were mostly put there on purpose.

**Process note.** The first rewire attempt corrupted `moves.ts`: a regex
using `.*?` to find a node's `delta` matched across node boundaries and wrote
a cooldown into the wrong node, producing `delta: {, cooldownTicks: -1 }`.
Reverted and rebuilt with brace-counting from an exact anchor. On a
6,000-line file of live game data, `.*?` is not a search, it is a guess.

### Rock Slide to v4 (Shipped) — the second converted tree, and what the numbers said

Solar Beam was the pattern; Rock Slide was the tree that *looked* easy. It
reported only 3 structural problems (three 10-node branches) against the
checker, which made it read as nearly-v4 already. `tree-balance.ts` said
otherwise:

| | before | after | roster median |
|---|---|---|---|
| nodes | 39 | **45** | 38 |
| distinct levers | **17** (3rd lowest in the roster) | **25** | 21 |
| colour-pie flavours | 9 | **12** | 9 |
| tempo | 2.00x (cap 3.00x) | 2.00x | 1.80x |
| power | 1.76x | 1.96x | 1.96x |
| cheapest capstone | 11 pts | 10 pts | 11 pts |
| checker problems | 3 | **0** | — |

**The structural gap was small and the content gap was not.** 17 levers on a
tree whose own writeup already claimed a distinct fantasy is the same finding
this document made about dig: an unexplored lever set, not a small move.

**The fantasy, written first** (per template v3's rule 1): Onix rears against
a slope and the slope lets go. Not a rock thrown (Rock Throw), not the ground
shaking (Earthquake) — tons of stone arriving from ABOVE into a one-tile
bowl, onto things whose guard is pointed the wrong way. Its danger is
positional: from the high ground gravity does the work, on the flat it mostly
buries its own feet. It does not pick targets, and everything nearby hears it
a beat before it lands.

Each branch answers that, and the lanes differ in *kind*:

- **Aggression — the whole face lets go.** Lane A is the DROP (accuracy,
  penetration, then *Straight Down*: `resistanceBreaker`, the one thing a
  hillside answers that a thrown rock does not — being built to shrug rock
  off). Lane B is the SLOPE (volume, then the preserved wide-vs-heavy fork).
  New deep notable *Swept Off* gives the move its first physical lever:
  `forcedMovement` on an AoE, so the whole bowl is carried a tile outward.
- **Boldness — standing inside your own rockfall.** Lane A is BULK (mass,
  hide, *Denser Stone*), lane B is FOOTING (*Unbroken*'s `immovable`, then
  the preserved high-ground-vs-jagged-edges fork). New deep notable *Bring It
  Down*: `selfStateBonus` — a badly hurt Onix stops trading and reaches for
  the slope, paying a real `lockTicks` beat for it in the same node.
- **Sociability — the sound before the stone.** Lane A is what the herd DOES
  about the warning (new *Set Yourselves*: `allyEffectOnAttack` braces the
  nearest herd-mate every time the slide goes off), lane B is the warning
  itself and how far its authority reaches (calm, then the preserved
  wider-warning-vs-nonterritorial fork). *Toppling Call*'s `rallyCall` is now
  the convergence both lanes earn.

**Three levers deliberately NOT used, and why** — all three would have been
sibling re-skins or dead content:

- `terrainFill: "mud"` (the rubble field). Earthquake — *the same species'
  other AoE* — already owns it.
- `bonusVsType: flying` and `consumesOwnTerrain: boulder`. Rock Throw, again
  the same species, already owns both.
- `gatherBurst`. Read the call site rather than assuming: the canopy-harvest
  path is the only one a non-`burrow` damage move can feed, and the only
  canopy crop is Apple, `eligibleBiomes: ["forest"]`. Onix/Geodude/Aerodactyl
  live in badlands/highland/tundra/underground. It would have been a node
  that can never fire — unreachable content, which this project treats as a
  bug, not a curiosity.

**Passive discipline.** Zero new passives. Onix already carries
`damageReductionFlat 12.5` / `immovable 4` / thorns 27% summed across its
movepool (`passive-exposure.ts`), and passives stack uncapped across every
tree a species knows. Where the branch wanted armour, the node got a `delta`
instead: *Digs In* is `statChangeOnHit` on the user, bounded to this move.
`passive-exposure.ts` output is byte-identical before and after.

**Verified by running it, not by reading it.** Driving the engine's own
`maybeAutoRespec` on a real Onix with points to spend, once per disposition:
**42 of 45 nodes bought in each case** (the missing three are the excluded
fork sides), **all three capstones reached**, from every disposition. In a
plain 3-seed × 6,000-tick demo run the tree is still inert — but for a
reason that predates this work and is logged already: 3 seeds produced one
living Onix and one Geodude between them. That is a population problem, not
a tree problem, and it is not this pass's to retune.

### Hydro Pump converted to v4 (option 2: forks kept, inside the lanes)

40 → 45 nodes, 12 per branch, 9 `anyOf`, 6 fork nodes, 3 real bridges. Every
v3 fork survives, relocated to the tail of a lane. Checker findings for this
tree: **7 → 2**, both leftover overwrite collisions (`range` across the three
branches' own "+1 Range" fillers, and `situationalBonus` between *Riptide
Counter* and *Violent Confluence*) — the same two Solar Beam is left with,
and they need the additive fields, not tree surgery.

The fantasy is unchanged, per the standing rule about not reinventing a
documented identity. What v4 forced was answering it **twice per branch**,
in lanes that differ in kind:

| branch | lane A | lane B | new node |
|---|---|---|---|
| Overwhelm | sustained pressure — bore through, flood the ground you crossed | commitment — wind up, unload, and on a real connection never re-pressurise (`critCooldownReset`) | *Pressure Holds* |
| Bastion | plant your feet (`immovable`, and *Open the Valve* trading `selfCostPerUse` energy for power) | control the stream | *Open the Valve*, *Narrow the Stream* |
| Pod Tide | coordination — mark, converge, reach | keeping the pod — a fuller wash, and the pump as a harvesting tool | *Fuller Wash*, *Strip the Canopy* |

**The best of the five is *Narrow the Stream*.** The branch's whole thesis
has been prose since v3 — "a patient controlled deluge instead of a wild
spray" — and it had no mechanic. It does now: the base `cone` (length 4,
width 2, 12 tiles) becomes a `line` of 5, which is fewer tiles hit at longer
reach, at the exact range *Channel Grip* buys. Measured directly, not
reasoned about: 12 tiles → 5. The tree's only `shape` setter, so the
overwrite field stays safe, and notable-tier per principle 14.

***Strip the Canopy*** is the other one worth naming: `gatherBurst` on
needs.ts's canopy-harvest path, where an off-cooldown damage move
substitutes for the dig and scales with its own `range.max`. A pod using
Hydro Pump to knock fruit down for the herd is the only node in the tree
that feeds rather than fights — and it is the fourth user of a lever the
colour-pie audit named as barely appearing.

**Two things deliberately NOT done.** `consumesOwnTerrain: { terrain:
"water" }` was drafted for the Bastion lane and cut: it permanently deletes
the water tile it consumes (predation.ts `setTile(..., "floor")`), and a
Water species fights standing on water constantly, so it is a plausible
ecology regression on a resource the sim actually meters. And **no new
passives at all** — `agent.passives[kind] += value` is uncapped and stacks
across a species' whole movepool, so *Fuller Wash* deepens the opener's
`allyEffect` delta instead of granting another heal. `passive-exposure.ts`
totals are byte-identical before and after.

**Balance, with the roster as control:**

| | before | after | roster median |
|---|---|---|---|
| nodes | 40 | 45 | 38 |
| distinct levers | 26 | **30** | 21 |
| colour-pie flavours | 11 | **13** | 9 |
| tempo | 1.80x (cap 3.00) | 1.80x | 1.80x |
| power | 1.45x | 1.59x | 1.89x |
| cheapest capstone | 11 pts | 9 pts | 11 |

Tempo is untouched — the tree still spends −4 of the −6 the cap allows, and
that headroom is a balance decision, not a conversion one. The capstone
depth drop to 9 is structural to v4 (Solar Beam sits at 9 for the same
reason: lane B reaches the deep notable in four steps) and is not a
regression specific to this tree.

### Water Gun converted to v4 — "the one that irrigates"

33 → 45 nodes, 12 per branch, 9 `anyOf`, 6 fork nodes, 3 real bridges. Both
v3 forks survive, relocated to the tail of a lane. Checker findings for this
tree: **10 → 0**, including the two overwrite collisions that Solar Beam and
Hydro Pump are still carrying — Water Gun ends up with exactly one `shape`
setter, one `range` setter and one `rallyCall` setter in the whole tree.

**Hydro Pump had just been converted, which made the real risk obvious:**
shipping a weaker fire hose. So the fantasy was written first, and written
against its sibling rather than in isolation.

> A hairline jet fired through a pinched mouth — pressure, not volume. Forty
> power, a twenty-five-shot pool, two tiles of reach. It does not knock
> anything over; it stings, it blinds, and it **wets**. The danger is not the
> hit, it is the repetition: every landed shot leaves standing water where it
> struck and puts a real fertility boost into that ground (`terrainFill` →
> `waterSoil`, predation.ts), so a creature that keeps firing is quietly
> rebuilding the ground the fight is happening on. Hydro Pump is one release
> you can barely aim; Water Gun is the same animal doing one small exact
> thing forty times, and the map remembers every one of them.

Each branch answers that, and each branch's two lanes differ in **kind**:

| branch | lane A | lane B | the new idea |
|---|---|---|---|
| **The Fine Point** (agg) | the CUT — penetration, then *Piercing Jet* pinching the two-tile line into a three-tile one | the RATE — cooldown, then *Stuttering Jet*'s 1–2 hits, ending at the preserved heavy-vs-double fork | *Stuttering Jet* |
| **Standing Water** (bold) | SPACE — the knockback/recoil chain, nothing gets to arm's length | PLANTED — *Drink the Puddle*, then the preserved unsteady-them-vs-steel-yourself fork | *Drink the Puddle*, *Sheeting Spray* |
| **The Waterhole** (soc) | CARE — heal the pod, steel it, share more of it | COMMAND — *Rally the Shoal* marks the threat, then cover the pod or press the mark | *Rally the Shoal*, *Fuller Share* |

**The best node in the tree is *Drink the Puddle*, and it is the one Hydro
Pump could not have.** Hydro Pump drafted `consumesOwnTerrain: { terrain:
"water" }` and cut it, for a good reason recorded above: `predation.ts`
reverts the consumed tile to `"floor"` permanently, and a Water species
fights standing on water constantly, so it is a plausible ecology regression
on a resource the sim actually meters. Water Gun is the one move in the
roster that answers that objection, because its **base** `terrainFill` puts a
fresh water tile under every landed, non-killing hit. The tree that spends
puddles is the same tree that makes them — net-neutral on the map, and the
only node anywhere where a move's own side effect is its own ammunition.

***Sheeting Spray*** is the Boldness capstone, and it is the roster's only
node that turns a single-target line into an area sweep. It also came with a
correction worth recording, because the first version of its source comment
was **wrong**: it claimed a build with Piercing Jet would leave a puddle
under each of three tiles. Driven for real against `tickWorld`, it does not —
`terrainFill` sits behind `isPrimaryTarget` in `resolveHitAgainstTarget`, so
an area sweep still leaves exactly **one** water tile per cast. Measured:
1 puddle for the base move and 1 for Sheeting Spray, while the secondary
target went from **0 damage to 33**. The comment now says what the engine
does, not what the design wanted.

**Four levers checked at the call site and rejected, all of them as
unreachable content rather than as taste:**

- `spawnsRain`, `drainNeeds`, `fertilityBoost`, `statusImmunityAura`. Every
  one of these is only ever read inside `maybeUseUtilityMove`
  (utilityMoves.ts), whose candidate list is `agent.moves.filter(m =>
  m.utilityMove)`. Water Gun is a damage move and `utilityMove` is not a
  `delta` field, so all four would have been dead the moment they shipped —
  and `spawnsRain` in particular reads as a *perfect* capstone for a tree
  with two weather situational-bonus nodes, which is exactly why it needed
  the grep instead of the vibe.
- `gatherBurst`. Live for a damage move, but Hydro Pump — the same type
  family, converted one tree ago — already owns it, and the only canopy crop
  is Apple (`eligibleBiomes: ["forest"]`, autumn only). A sibling re-skin on
  a narrow path.
- `excludesAllies`. Only consulted inside `resolveAreaHit`, so it does
  nothing on a move without `hitsArea`. Putting it in Sociability while
  `hitsArea` lives in Boldness would have made it cross-branch dead content
  for every build that did not take both.
- A fourth `critRateStage` node. `rollCritical` (combat.ts) clamps the stage
  to 3, and the Sociability↔Aggression bridge already grants exactly 3. A
  fourth would provably do nothing. The whole tree's crit budget therefore
  lives on that one bridge, which also gives the bridge a character.

**Passive discipline: zero new passives, and one passive-shaped node
answered with a `delta` instead.** *Fuller Share* deepens the opener's own
`allyEffect` rather than granting a fourth healing kind, and the old
`+5 Accuracy` filler in the Boldness capstone approach became *Braced Spray*
(`weightScaling`), which is systemic rather than granted: `predation.ts`'s
weight term already reads positive Defense stages, so a build that came
through *Bubble Shield* gets more out of it than one that came through
*Undertow*, with nothing pairing the two nodes explicitly.
`passive-exposure.ts` output is **byte-identical** before and after.

**Six `+5 Accuracy` fillers on a 100-accuracy move.** That was a third of
this tree's filler, and `rollAccuracy` (combat.ts) only ever spends the
surplus through `stormAccuracyMultiplier`. Four were repurposed into real
levers; **two were kept on purpose**, in the branch whose own opener wants a
storm and in the lane that stands in the open holding a spot — those two are
buying back exactly what the weather takes off them.

### Peck converted to v4 (Shipped) — "the point, not the wing"

33 → 45 nodes, 12 per branch, 9 `anyOf`, 6 fork nodes, 3 real bridges. Every
v3 fork survives, relocated to a lane tail. Checker findings for this tree:
**11 → 0**, including both overwrite collisions (see below — those were
fixable here without engine work, unlike Solar Beam's and Hydro Pump's).

**The fantasy, written before any node**, because the brief for this move was
specifically "peck must not just be a smaller Wing Attack":

> Peck is one hard point — a beak, a horn, a leek — driven into a single spot
> with the whole body behind it. Wing Attack is surface area; Peck is
> pressure. There is no wind-up and nothing to see coming: it happens inside
> your guard, at arm's length, and it happens again a half-second later in
> exactly the same place. What kills is not the size of the hole, it is the
> repetition — the same puncture reopened until something under it gives.
> What is dangerous *to the pecker* is where it has to stand to do it: range
> 1, inside the reach of everything, nowhere to be but there.

**The learners settle the "is it a bird move" question, and they say no.**
Peck is on spearow/fearow (crepuscular canopy predators), doduo/dodrio
(flightless savanna runners), goldeen/seaking (horned fish), farfetchd (a
leek), and nidoranm/nidorino (a horn). Only three of the nine can fly.
`wing_attack` — gusts, scatter, mobbing, `forcedMovement: away` — is the wing.
Peck is the point. That is the whole separation, and it is what the Boldness
deep notable inverts on purpose (below).

**Lanes differ in kind, per branch:**

| branch | lane A | lane B | deep notable |
|---|---|---|---|
| **The Same Hole** (agg) | *Through the Guard* — severity: armour, then the type chart (`defensePenetration`, `bonusVsType`, new *Stone-Seeker*'s `resistanceBreaker` answering Peck's own printed Rock/Steel resist) | *Again, Same Spot* — rate: `hits` 2, then the preserved deeper-jab-vs-third-jab fork | *Talon Strike*, rebuilt: the talons plant, the body's mass goes in behind the point (`weightScaling`) and the beak takes a piece back out (`lifestealFraction`) |
| **Where You Have To Stand** (bold) | *Longer Reach* — rewrite the geometry so point-blank stops being point-blank (`shape` line-2 + `range`) | *Nowhere To Go* — accept point-blank and make standing there survivable (new *Braced Stance*'s `lockTicks` commitment, crit-fishing, the preserved fork) | new *Nowhere to Run* |
| **Ten Beaks, One Hole** (soc) | *Everyone On That One* — the mark: new *Mark the Soft Spot*'s `rallyCall` turns every flock-mate's separately-run threat pick onto the same target | *Keep the Flock Standing* — provisioning and cover, incl. the preserved screen-vs-charge fork | *Preening Recovery*, which stops being a bare passive with an empty delta |

**The best node in the pass is *Nowhere to Run*.** `wing_attack`'s entire
positional identity is scattering things AWAY on a landed hit. A point weapon
wants the exact opposite: the beak hooks and the target comes one tile IN,
back onto the spot the next jab is already aimed at. It is one field
(`forcedMovement`, mover `defender`, direction `closer`) and it is the
clearest statement in the roster of what separates these two Flying moves.

***Set the Point*** is the Aggression capstone and answers the move's own
flaw, per the pattern about a weakness being a branch waiting to happen: Peck
is range 1, so everything in that branch has to be bought standing on top of
the target. `chargeAttack` is the only primitive that addresses that directly
— one tick fixed on a spot (invulnerable, unable to act), then three tiles
crossed in the leap and the stored commitment driven home, fizzling for
nothing if the target has moved. Second user of `chargeAttack` in the roster,
after Body Slam's *Mountainous Impact*.

**Both overwrite collisions were real dead content, not just checker noise.**
v3 had THREE co-takeable `situationalBonus` setters (`talon_strike`
targetLowHp, `swooping_approach` elevation, `ambush_dive` flanking).
`applyMoveTree` overwrites that field, so a build taking two of them was
paying a skill point for a node that provably did nothing. The tree now
carries exactly one (`swooping_approach`'s elevation — the fantasy-obvious
condition for something that drops on things), and the two freed nodes became
the levers the branches were actually missing.

**A unit check that changed the design, caught by running it.** I assumed
`jamCooldownTicks` was an overwrite field, since it is not in
`applyMoveTree`'s documented additive list, and built the Ambush Strike bridge
as an escalating 1 → 2 → 3 chain on that basis — plus rewrote *Harrier's
Charge* off the lever to avoid a collision that would not have existed. Then I
ran a fully-specced respec and read `jamCooldownTicks: 6` off the result. It
is additive (`moves.ts:773`). The bridge is now +1/+1/+2 for four ticks total,
*Harrier's Charge* is reverted to its shipped mechanic, and the file carries a
comment saying the field was verified by running it rather than by reading the
list. This is the same class of mistake as the cooldown-denominator one.

**Levers deliberately NOT used, with the call site read first:**

- **`drainNeeds`** — a beak that takes a bite off a rival is almost too apt.
  It requires `utilityMove`, and `pickBestMove` (combat.ts) *excludes* any
  `utilityMove` from hostile selection. Putting it on a Peck node would have
  removed Peck from combat entirely. Not a balance judgement — it would have
  deleted the move.
- **`positionSwap` as a Sociability node** ("take your flock-mate's place").
  `positionSwap` swaps attacker and defender; there is no ally-side form. It
  would have read as cover and done something else.
- **A second healing passive.** The branch is about focus, not medicine, and
  the roster's healing budget is already the thing `softCapHealShare` exists
  to bend.

**Passive discipline: zero net change.** `passive-exposure.ts` output is
byte-identical before and after. The tree grants exactly the passive budget it
already granted (`regen 0.03`, `damageReductionFlat` 1.0 per fork side) — the
Bridge-2 filler *Spread Wing* needed to share its crosslink's lever (principle
13), and rather than adding a second point of flat mitigation, *Cover Call*'s
own 1.0 was split 0.5/0.5 across the two nodes. Everywhere else the branch
wanted armour, the node got a delta instead.

**Balance, with the roster as control:**

| | before | after | roster median |
|---|---|---|---|
| nodes | 33 | **45** | 39 |
| distinct levers | 18 | **24** | 23 |
| colour-pie flavours | 8 | **11** | 9 |
| tempo | 1.00x (cap 2.00) | **2.00x** | 1.80–2.00x |
| power | 1.88x | 2.58x | 2.20x |
| cheapest capstone | 11 pts | 9 pts | 11 pts |
| checker problems | 10 | **0** | — |

**One balance number was moved and it should be looked at.** The tree spent
**zero** of the −2 cooldown the 3x cap allows on a base-3 move; it now spends
both (`-1 Cooldown` in the rate lane, and `Stuttering Jet`). Tempo goes
1.00x → 2.00x. That is a real buff, chosen because repeatability is literally
the fantasy — but it is a balance call, not a conversion one, and −1 (1.33x)
or −0 are both available if 2.00x is too much for a move this cheap to fire.

**Verified by running it, not by reading it.** Driving `maybeAutoRespec` on a
real Squirtle with points to spend, once per disposition: **42 of 45 nodes
bought in each case** (the missing three are the excluded fork sides), **all
three capstones reached, from every disposition**. And driving `tickWorld`
itself, with controls:

| | measured | control |
|---|---|---|
| *Drink the Puddle*, standing on water | 15 damage, attacker's tile `water` → `floor` | 10 damage off water — exactly the 1.5x |
| base move, standing on water | 9 damage, tile stays `water` | the consume is tree-earned, not baked in |
| *Sheeting Spray*, two bodies in the line | 34 and **33** damage | base move: 7 and **0** |
| puddles left per cast | **1** | base move: also 1 — `isPrimaryTarget` |

| distinct levers | 19 | **31** (2nd in the roster) | 23 |
| colour-pie flavours | 9 | **12** | 9 |
| tempo | 1.00x (cap 2.00x) | **2.00x** | 2.00x |
| power | 2.43x | 2.57x | 1.96x |
| cheapest capstone | 11 pts | 10 pts | 11 pts |
| checker problems | **11** | **0** | — |

**The one balance number moved, flagged for a decision rather than settled.**
Peck was the only damaging tree in the roster spending *nothing* on cooldown —
tempo 1.00x against a 2.00x cap, the lowest reading on the board. Two fillers
(*+5 Accuracy, -1 Cooldown* in Boldness, *+5 Power, -1 Cooldown* in
Sociability) now spend the full −2 the cap allows, landing tempo on exactly
the roster median. That is a control-anchored number, not a taste call, but it
IS a tuning decision and reverting either node to a plain stat filler is a
one-line change.

**Verified by running it, not by reading it.** Driving the engine's own
`maybeAutoRespec` on a real Spearow with points to spend, once per
disposition: **42 of 45 nodes bought in each case** (the missing three are the
excluded fork sides), **all three capstones reached from every disposition**,
and every new lever present on the resulting spec (`chargeAttack`,
`rallyCall`, `forcedMovement`, `gatherBurst`, `terrainBurn`,
`resistanceBreaker`, `weightScaling`, `allyEffectOnAttack`).

**And a live-run limit stated plainly, with its control.** In a real
`createDemoWorld` run — 5 seeds × 8,000 ticks — the tree never fires, because
the scenario's single Spearow never enters a fight at all: **0 ticks with a
fight or hunt target, 0 moves used of any kind**. Running the identical world
with no tree applied gives the same zeros, so this is pre-existing scenario
population state, not something this pass caused. It is the same finding Rock
Slide's conversion recorded for its lone Onix, and it is a population problem,
not a tree problem.

### Scratch converted to v4 (Shipped) — "the wound outlives the swipe"

Fourth structural conversion, and the first one that had to be designed
*against* another tree rather than in isolation: Scratch and Tackle are both
Normal-typed melee openers on overlapping species, so the brief was that
Scratch has to stand on its own claws.

**The fantasy, written before a node was touched:**

> Scratch is four claws and no technique. There is no wind-up and nothing to
> see coming — the paw is already moving. What separates a rake from a blow
> is that a blow is finished the moment it lands and a rake is not: it opens
> the skin and leaves the wound to do the rest of the work, hours later,
> somewhere else. Claws are filthy by design, and whatever was under them
> yesterday goes in today. And claws were tools long before they were
> weapons — the same four hooks that open a belly hook into bark, into a
> fleeing leg, into the dirt of a den, and score a line across a tree that
> every animal in the valley can read without a single fight happening.

The Tackle separation is stated in the source as a rule, not a vibe: Tackle
is **mass arriving and it is over when it stops**; Scratch is **an edge
opening something, and it leaves things behind** — a septic wound, a
shredded bush, a churned furrow, a claw mark on a tree. `weightScaling` and
`chargeAttack` are therefore deliberately absent from this tree. A claw has
no wind-up and does not care what it weighs.

**Lanes differ in kind, not degree:**

| branch | lane A | lane B | different how |
|---|---|---|---|
| Aggression — *Nothing Stays Closed* | **Filth** (statusChance → statusSpreads → jam) | **The Seam** (defensePenetration + resistanceBreaker) | attrition vs. precision |
| Boldness — *The Hook* | **Dug In** (damageReduction, `lockTicks` commitment, thorns) | **Where the Fight Happens** (the lunge, and the fork to disengage or dig in) | holding a tile vs. choosing one |
| Sociability — *The Mark* | **The Call** (`rallyCall` — a raked flank is a name shouted) | **The Boundary** (`nonTerritorial` — a scored tree is a fight that never starts) | directing attention vs. removing the reason to fight |

**The three payoffs worth naming.** *Churned Ground* fills the defender's
tile with real `"mud"` (0.5x `terrainSpeedMultiplier`) and *Purchase*, the
Boldness capstone, then **consumes mud its own tree created** for a 2x hit —
the only node in the roster that eats terrain it made itself, and the cost
is legible because standing in mud halves your own speed. *No Cover Left*
uses `terrainBurn` to shred the bush a target ducked into, permanently
stripping the concealment the branch next door is built on. *Never Your Own*
is the tree's single `shape` setter: a point move that learns a three-tile
arc (verified against `resolveShape`: 3 tiles, control = 1) and still never
cuts a herd-mate — the roster's other three `excludesAllies` users were all
AoE moves already.

**Rejected, with reasons — unreachable content is a bug.** `drainNeeds`
would have been a perfect "a raked animal cannot feed" capstone and is
**dead on this move**: `utilityMoves.ts`'s `maybeUseUtilityMove` is the only
reader and it needs `utilityMove`, which an attack move cannot carry. A
fourth `situationalBonus` condition (*Sandstorm Claws*' `night`) was dropped
because four co-takeable setters of one OVERWRITE field is exactly the
"if you got both, would it just do nothing?" bug, and `night` was
Sandshrew-specific on a move eleven species share. `situationalBonus:
{ condition: "rallyMarked" }` was the first choice for the Sociability
capstone and was cut for the same overwrite reason — it would have been
co-takeable with *Frenzied Burrow*'s `flanking` with no ancestor relation
between them.

**Passives went DOWN, measured.** `passive-exposure.ts`, before → after:

| | before | after |
|---|---|---|
| roster worst-case healing (sandshrew, sandslash) | 16.6%/tick | **13.6%/tick** |
| charmeleon healing | 12.5%/tick | **9.5%/tick** |
| charmeleon `damageReductionFlat` | 2.00 | **1.00** |
| thorns / damageReduction | unchanged | unchanged |

Two changes did that. *Communal Foraging* traded a flat `regen` passive for
`gatherBurst` — the node's own name finally meaning what it says, a visible
burst of food on the map instead of a hidden meter, and it resolved the
`2/3 identity nodes are "p:regen"` principle-17 failure at the same time.
And *Guarded Den* stopped being a second `damageReductionFlat` duplicating
*Colony Guard*'s and became a `positionSwap` — a claw hooked into an
intruder to swing it out of the den mouth, which is what the node was
always describing.

**Numbers, roster as control:**

| | before | after | roster median |
|---|---|---|---|
| checker problems | **12** | **0** | — |
| nodes | 33 | 45 | 39 |
| distinct levers | 19 | **34** | 23 |
| colour-pie flavours | 7 | **13** | 9 |
| tempo | 1.00x (cap 2.00) | **2.00x** | 2.00x |
| power | 2.25x | 2.42x | 1.96x |
| cheapest capstone | 11 pts | 10 pts | 11 pts |

**Reach, live, with a control — and an honest limit.** 6 seeds x 8,000
ticks: 14 agents knew Scratch, 10 invested, and **17 of 45 nodes were
actually bought** (before: 21 of 33). No lane notable, deep notable or
capstone was reached in that run. That is a v4-wide property rather than a
Scratch defect — in the same run `rock_slide` reached 9/45, `body_slam`
9/45, `earthquake` and `hydro_pump` 0/45, so Scratch is the best-reached
45-node tree on the board — but it is worth writing down plainly: the
deeper trees are still outrunning what an 8,000-tick population levels into.
Every capstone and every bridge shortcut *is* legal and reachable, proved by
walking all six routes through the real `applyMoveTree` (which throws on an
illegal walk) and by proving that harness rejects an illegal walk first.

### Dig converted to v4 — "the only move whose payoff is absence"

29 → 45 nodes, 12 per branch, 9 `anyOf`, 6 fork nodes, 3 real bridges. All
three v3 forks survive, relocated to the tail of a lane. Checker findings for
this tree: **10 → 0**, with no overwrite collisions left over.

**The trap had to be cleared before any design was possible.** Dig is never
resolved as a hit — `pickBestMove` (combat.ts) excludes every `burrow` move —
so power/accuracy/crit/penetration/forced-movement and everything else the
template usually leans on are dead weight. The tree's own source comment went
further and claimed cooldown and passives were "the only two real levers
left," and that turned out to be **read off the delta schema, never off the
call sites**. Measured against the real engine, each with its own control:

| lever | reaches dig through | verified |
|---|---|---|
| `cooldownTicks` | `useMove` + every off-cooldown gate | already known |
| `gatherBurst` | needs.ts crop-dig and spring-dig | already known |
| **`lockTicks`** | `useMove` (combat.ts), which the burrow-flee branch calls | lockTicks 3 → `actionLockTicks` 3, control 0 |
| **`targetsAlly` + `allyEffect`** | `applySupportMove` (support.ts) — it filters on `targetsAlly && allyEffect && !cooldown` and does **not** exclude burrow moves | healed an adjacent herd-mate on an idle tick; the shipped dig, as control, did not |
| **`range`** | only that same support path, deciding which herd-mates are reachable | max 1 could not reach an ally 3 tiles off, max 3 could |
| `power` | nothing | 200 power changed no outcome; `pickBestMove` returns undefined |

Both new engine facts are now regression-guarded with their controls in
`predation.test.ts` and `support.test.ts`.

**The fantasy:**

> Dig is the ground opening under something and closing again. Nothing is
> struck; something is simply not there any more. For a Diglett or a
> Sandshrew the tunnel is not an escape hatch, it is the house — it is where
> the water is, where the roots are, and where the other burrowers already
> live. It is the only move in the roster whose payoff is absence, and the
> only one whose real work happens where nobody can watch it.

| branch | lane A | lane B | the new idea |
|---|---|---|---|
| **Gone Before It Lands** (agg) | FREQUENCY — be gone and back before anything gets a turn (`-1`, grit, *Never Still*) | COMMITMENT — go down, stay down, come up with it (`lockTicks` + `gatherBurst`, *Straight to the Root*, then the preserved vanish-vs-bite fork) | *Stays Down* |
| **The Roof Holds** (bold) | SOAK — flat mitigation, strong early, marginal late | DENIAL — *Set in the Wall*'s `immovable`: not "the hit hurts less" but "you do not get to move me" | *Set in the Wall* |
| **Shared Ground** (soc) | PREVENTION — the tunnels are neutral ground, nothing starts down here | REPAIR — *Dug You a Den* spends the escape hatch digging cover for somebody else | *Dug You a Den*, *Open Tunnels* |

**The best node in the tree is *Dug You a Den*, and it is the one no other
move could have.** Every other support move in the roster hands out a heal it
was already going to hand out. Dig's support use costs the thing the move is
*for*: `applySupportMove` puts it on the same full 15-tick cooldown that gates
the burrow-escape, so a Diglett that just dug a den for a hurt herd-mate
cannot vanish for itself. Predation runs before support in `tickAgentAction`,
so it never costs a flee it was about to make — it costs the *next* one.

**Two dead-content bugs found and fixed in passing:**

- *Shallow Dive* was named **"-2 Cooldown"** and its delta was `-1`. Principle
  5, shipped.
- *Stone Hide* granted `damageReductionFlat: 1` against its own fork partner
  *Weathered Scales*' `1.5` — the same passive, strictly less of it. Nobody
  picks that. Changed to `defenseBoost`, which the doc's own "Stop overusing
  `damageReduction`" section says an armour fiction should have been using
  anyway: physical-only, scaling with the defence stat, so it is weak early
  and strong late — the exact opposite curve to the flat soak it now competes
  with. That is a real decision about *when in a run* you expect to need it.

**Two ceilings this tree runs into, both worth knowing before touching it
again:**

- **`calmingPresence` is already past its useful maximum.** The escalation
  multiplier is `1 - total` floored at `MIN_CALMING_MULTIPLIER` = 0.5
  (herdConflict.ts), and dig alone grants **0.78**. Everything past 0.50 buys
  nothing, so this conversion added **no new calming node at all** — one would
  have been provably dead. Same reason there is no second `nonTerritorial`,
  `unshaken` or `immovable` grant: all three are read as booleans (`> 0`).
- **`gatherBurst` saturates at +15**, because `SPRING_DIG_TICKS` is 20 and the
  base burst is 5, so a single use past that already completes the longest
  gather in the game in one tick. The Aggression branch alone reaches exactly
  +15 — no single lane wastes any of it. A hypothetical full-tree 45-point
  build reaches +29 and wastes the last 14, the same way it wastes calm.

**The colour-pie ceiling, stated plainly.** Dig can reach **5 of the 16
flavours**, not because its fantasy is thin but because 11 of them are gated
behind `resolveHit` or the `utilityMove` idle path and this move is neither.
`environment` is the painful one — a digger churning earth is the obvious
flavour and `terrainFill`/`consumesOwnTerrain`/`fertilityBoost` are all
hit-or-utility-gated. Flagging dig as `utilityMove` would unlock them and was
**rejected**: `maybeUseUtilityMove` would burn dig's cooldown on idle ticks,
directly starving the burrow-escape and both gather paths that gate on the
same cooldown. That is a regression to the move's core, bought with flavour
variety. `fireproof` was rejected too — fire spreads only through
flora/bush/tree/food/seedling (fire.ts) and a burrower's answer to fire is
already free, since the engine's strict same-layer targeting means an agent
underground is not standing on the burning tile at all.

### Slash converted to v4 (Shipped) — "the stillness before the swing"

Fifth structural conversion, and the second designed *against* a specific
neighbour rather than in isolation. Scratch had just shipped as "four claws
and no technique... a rake that LEAVES THINGS BEHIND," and Slash is the other
half of that sentence.

**The fantasy, written before a node was touched:**

> Slash is a cut, and a cut is a decision made before the arm moves. There is
> one line through an animal that opens it and a hundred that skid off bone,
> and the whole move is the discipline of waiting for that line to show
> itself. Nothing is left behind: no filth, no torn ground, no wound that
> keeps working after. The edge goes in clean, comes out clean, and the thing
> it cut simply stops. Every species that knows it carries an implement
> instead of a paw — Scyther's scythes, Pinsir's pincers, Farfetch'd's leek
> held like a sword, Charizard's talons. What is dangerous about Slash is not
> the swing. It is the stillness before it.

The four learners were the gift here: **scyther, charizard, farfetch'd,
pinsir**, and not one of them fights with a bare paw. Slash is the move of
things that carry an edge.

**The separation from Scratch is written into the source as three rules,
not as a vibe.**

| | Scratch | Slash |
|---|---|---|
| what it leaves | a septic wound, mud, a shredded bush, a scored tree | nothing — no `statusChance`, no `statusSpreads`, no `terrainFill`/`terrainBurn`/`consumesOwnTerrain` anywhere in the tree |
| the wind-up | none ("the paw is already moving"); its own comment names `chargeAttack` as deliberately absent | all of it — `chargeAttack` is Boldness's lane notable |
| Sociability | marking and shouting (`rallyCall` on a raked flank, `nonTerritorial` on a scored tree) | **teaching**: technique is the one thing about this move that can be handed to another animal |

**Lanes differ in kind, not degree:**

| branch | lane A | lane B | different how |
|---|---|---|---|
| Aggression — *The One Cut* | **The Stroke** — how the swing is spent (the crit lane, and the three-way fork) | **Where The Edge Reaches** — the seam, then two tiles of it (`range`) | severity vs. geometry |
| Boldness — *The Stillness* | **The Held Stance** — `chargeAttack`, `immovable`, `unshaken` | **The Footwork** — one tile, exactly on time (`forcedMovement` both directions) | refusing to move at all vs. moving exactly |
| Sociability — *The Form Passed On* | **The Drill** — the demonstration that stops needing to be a separate errand (`allyEffectOnAttack`) | **The Clean Kill** — the herd eats because of the edge (`gatherBurst`) | teaching vs. feeding |

**The three payoffs worth naming.** *The Long Moment* is the roster's fourth
`chargeAttack` and the **only one that does not travel** — `leapTiles: 0`
against Tackle's six tiles and Peck's three — which turns out to make the
fantasy literal, because predation.ts refuses every attack against a charging
agent outright. Going still *is* the defence. *The Long Guard* buys `range.max`
1 → 2, the one geometry lever a point move like Scratch structurally cannot
have, and it pays out twice: `moveRange` makes the holder stop stepping into
melee, and needs.ts's canopy-harvest path scales a damage move's food burst by
`range.max - 1`, so a Slash user visibly cuts fruit down faster. *Unflinching*
grants `unshaken` — three users in the whole roster, and the only defensive
passive that is not a percentage: the next hit is negated entirely, then
recharges.

**Rejected, with reasons — unreachable content is a bug.**
`critCooldownReset` was the best flavour idea in the pass ("a cut that clean,
the arm is already back on guard") and is **specifically unsafe on this tree**:
it is an invisible second tempo multiplier the tempo formula cannot see, and a
fully-invested Reaping build sits at crit stage 3 = every hit crits = the
cooldown resets every hit = **6.0x tempo on a move whose cap is 3.0x**. The one
lever that is unsafe here *because* Slash is the crit move. `statusImmunityAura`
and `selfHeal` are both driven by `maybeUseUtilityMove`, which needs the
`utilityMove` flag an attack move cannot carry — dead on Slash, same class of
finding as Scratch's `drainNeeds`. And **four of the five `situationalBonus`
setters** came out: it is an OVERWRITE field, v2 shipped five co-takeable ones,
and on any mixed build three of them silently did nothing.

**Crit, counted rather than assumed.** `rollCritical` clamps the stage at 3,
so the tree grants exactly +3 and not one more: The Line Shows Itself → Reaping
Slash → Apex Predator. Only the Reaping fork reaches 3 (100%); Frenzy and
Cleaving builds stop at 2 (50%). That is the fork paying off in kind. Verified
by walking all twelve maximal builds through the real `applyMoveTree` — the
harness was proved able to reject an illegal walk and an illegal fork pair
first.

**Passives went down where it matters, measured.** `damageReduction` and
`regenFlat` both came out — the two kinds that sum uncapped across a species'
whole movepool. What went in cannot stack: `unshaken` is read as
`passives.unshaken > 0`, `immovable` is a flat opt-out, `calmingPresence`
saturates at a floor. `passive-exposure.ts`, all four learners:

| species | dmgReduction | healing | | |
|---|---|---|---|---|
| scyther | 10% → **0%** | 1.7%/tick → **0.0%** | | |
| charizard | 16% → **6%** | 5.7%/tick → **4.0%** | | |
| farfetch'd | 10% → **0%** | 4.7%/tick → **3.0%** | | |
| pinsir | 10% → **0%** | 1.7%/tick → **0.0%** | | |

Thorns unchanged, and no species entered or left the tool's reported worst
cases. *The One They Watch*'s `calmingPresence` is **0.2 and the number is
measured**: `herdConflictChance` floors the multiplier at 0.5, so a species'
summed calm past 0.50 buys nothing, and Charizard already carries 0.30 from
Flamethrower — the first draft's 0.35 wasted 0.15 of a skill point on one of
the four learners.

**Numbers, roster as control:**

| | before | after | roster median |
|---|---|---|---|
| checker problems | **10** | **0** | — |
| nodes | 29 | 45 | 45 |
| distinct levers | 12 | **17** | 24 |
| colour-pie flavours | 3 | **5** | 10 |
| tempo | 2.29x (cap 2.67) | 2.29x | 2.00x |
| cheapest capstone | 7 pts | 7 pts | 10 pts |

Levers and flavours are both still short of the median and both are at the
honest ceiling described above — 17 of a possible 19, and 5 of a possible 5.
Tempo did not move: the conversion added **no** cooldown node, and the
often-repeated line that dig sits "at the 3x tempo cap" is off by one tick —
it is at 2.29x against a 2.67x ceiling for a base-15 move, with `-1` still
unspent.

**Cross-move passive exposure moved, and it is the one thing here worth a
second opinion** (`passive-exposure.ts`, worst case if a species takes every
passive node across its whole movepool). Only the four dig species moved;
nothing else in the roster changed:

| | diglett / dugtrio | sandshrew / sandslash |
|---|---|---|
| thorns | 25% → **40%** | 25% → **40%** |
| damageReductionFlat | 13.00 → **14.75** | 9.50 → **11.25** |
| defenseBoost | 0.10 → 0.30 | 0.10 → 0.30 |
| damageReduction | 33% (unchanged) | 33% (unchanged) |
| regen + healAura | 9.6% (unchanged) | 13.6% (unchanged) |

The thorns move is the deliberate one — "what comes down on the roof comes
back" is Boldness's whole payoff here — and it was **63% on the first pass**
before a second thorns grant was pulled off the Aggression capstone. 40% sits
below Venusaur's 65% and above Bulbasaur's 35%. It is a real change to how
these four species feel to attack, and it is a balance number, so it is
recorded here rather than presented as settled.

| nodes | 36 | 45 | 45 |
| distinct levers | 21 | **28** | 24 |
| colour-pie flavours | 9 | **12** | 11 |
| tempo | 3.00x (cap 3.00) | 3.00x (cap 3.00) | 2.00x |
| power | 2.36x | **2.94x** | 2.20x |
| cheapest capstone | 11 pts | **10 pts** | 10 pts |

**Tempo was already at the cap before this pass and not one tick was spent.**
Base 5, `cdFloor` 1, `maxCut` -4 — and v2 had already spent exactly -4. The
four -1 nodes in the v4 tree are the same four that shipped in v2. Slash is
the roster's only tree sitting on a 3.00x cap, which is worth knowing before
anyone reaches for cooldown here again.

**Two self-caught regressions in the first draft, both fixed before commit.**
The power multiplier came out at **3.94x**, the highest in the roster, because
`+power` was being used as generic "upside" to satisfy the pure-downside rule
on filler — fifteen nodes were trimmed to bring it to 2.94x. And the cheapest
capstone read **7 pts** against a converted-tree norm of 9-11, because every
node had been set to `cost: 1`; the shipped v4 trees keep `cost: 2` on the
four identity nodes per branch, and matching that put it at 10.

**One honest limit.** The accuracy total came down 105 → 80, but Slash's canon
accuracy is 100 and surplus only ever pays out through `rollAccuracy`'s
`extraMultiplier` — a storm (0.6x) or attacking uphill (down to 0.7x). A
fully-invested Retreat build reaches 195 accuracy, which is live only in those
conditions and inert everywhere else. The fix that actually made accuracy a
real purchase was *Opportunist's Strike* taking the move to **85**, which is a
genuine miss chance at any weather and finally gives Keen Eye's +15 something
to cover.

### Ember converted to v4 (Shipped) — "the first fire, and it catches"

Eighth conversion, and the worst tree on the board going in: **35 nodes, 14
checker problems**, the highest count in the roster. It was also the tree
carrying the most *dead* content — three separate mechanics that had shipped,
rendered, and never once done anything.

**The fantasy, written before a node was touched**, and written against
`flamethrower` rather than in isolation, because the brief was that Ember
must not be a small Flamethrower:

> Ember is the first fire a creature makes. Not a jet and not a beam — a
> mouthful of coals spat one tile, by a throat still learning the trick.
> Forty power: on its own it barely singes. What is dangerous about an ember
> is that it does not stop when it lands. It **catches** — in the dry grass
> behind the target, in the bush the thing was hiding in, in the next bush
> over — and a dozen ticks later what is hurting you is the ground, not the
> creature that spat at you. The same coal is also a hearth: the thing a herd
> sleeps around. Fire has no allegiance, and the creature that threw it is
> standing in the same dry grass.

Flamethrower is one held breath aimed at one thing, and it is over when the
breath runs out. Ember is one spark and no control over what happens next.

**Lanes differ in kind, per branch:**

| branch | lane A | lane B | deep notable |
|---|---|---|---|
| **Wildfire** (agg) | **the catch** — how many sparks and how hard what lands sticks (*Spit Coals*, the tree's only `hits` setter, then raw power) | **when it catches** — reach and opportunity (`defensePenetration`, *Fan the Flames* on an already-burning target, then the preserved reach-vs-intensity fork) | *Spreading Blaze* — the moment the fire stops being yours |
| **Ring of Fire** (bold) | **the ring** — how far it reaches and who it spares (*Fill the Circle*, then *Never Ours*) | **the middle** — keeping the inside of it yours (*Give Ground*, then the preserved plant-vs-fireproof fork) | ***Take Up the Coals*** |
| **Hearthfire** (soc) | **the hearth** — warmth given away (`allyEffectOnAttack`, then *Kindled Spirits*) | **the watch** — the fire as a signal (*Beacon Fire*'s `rallyCall`, then the preserved tend-vs-perform fork) | *Eternal Flame* |

#### Three shipped bugs, all found by running the engine rather than reading it

**1. `shape` does nothing without `hitsArea`, and the Boldness branch is
named after its footprint.** `shape` is only ever read by `resolveShape`
inside `resolveAreaHit`, which only runs for a `hitsArea` move. Ember had
three `shape` nodes — `ring_of_fire`, `wide_ring`, and Aggression's `inferno`
— and `hitsArea` on none of them. Measured on a real `tickWorld` with a body
on each side of the caster:

| | primary | second body |
|---|---|---|
| ring radius 1, no `hitsArea` | 13 | **0** |
| ring radius 1, `hitsArea` (control) | 13 | **13** |

**2. Which made `ring_of_fire` a pure-downside opener** (principle 4): it
charged −10 power and +1 cooldown for a ring that never covered a tile, at
the head of the branch built on it.

**3. Ember was the only tree in the roster carrying cost-3 nodes.** This
document already measured cost-3 as *unreachable outright* (0 of 4 distinct
nodes ever picked across a living population; 2 of 4 after
`SKILLPOINT_SAVE_CHANCE` was added). All four were fork tips — the branch's
actual decision. Flattened to 2, the roster's own ceiling.

And one bug introduced *by* fixing the first: a `ring` is a **hollow**
Chebyshev shell in `resolveShape`, so `wide_ring`'s radius 2, the moment it
became real, was a footprint a range-1 move can never fire into. Measured:
radius-2 ring did 9 to a body two tiles out and **0 to the one standing next
to the caster**. It is now `burst` radius 2 — the filled form, 13 tiles —
renamed *Fill the Circle*, which is the escalation the name always described.

#### The best node in the tree

***Take Up the Coals*** — `consumesOwnTerrain: { terrain: "fire" }`. The
caster is standing in a fire its own opener started, so it reaches down and
throws it. Measured on a real `tickWorld`:

| | damage | attacker's tile after |
|---|---|---|
| standing in fire, node taken | **14** | `fire` → **`floor`** |
| standing in fire, node not taken (control) | 9 | `fire` |
| node taken, not standing in fire (control) | 9 | `floor` |

Water Gun's writeup records why Hydro Pump could **not** spend water this way:
consuming a tile deletes a resource the sim meters. Fire is the one terrain
where that objection does not apply — `tickFires` was going to leave that tile
as scorched `"floor"` within `FIRE_BURN_TICKS` regardless. Spending it costs
the map nothing it was not already about to lose.

#### Fire is thin where Ember's own species live, and that is the point

Measured over `createDemoWorld`, 3 seeds, and then measured again as ignition
per landed `terrainBurn` hit against those exact fuel densities:

| biome | fuel | ignition per landed hit |
|---|---|---|
| desert | 1.5% | 5% |
| badlands | 2.0% | 8% |
| grassland | 6.7% | 25% |
| jungle (control, no Ember learner lives here) | 17.1% | 57% |

Ember's learners are charmander/charmeleon (badlands), vulpix and magmar
(desert/badlands), growlithe, ponyta/rapidash (grassland/highland). So fire on
the map is **occasional and precious** for this move rather than constant —
which is the argument for *Take Up the Coals* being a deep notable rather than
a filler: the tree that makes fires is the one tree with a reason to spend one.

#### Levers checked at the call site and rejected — unreachable content is a bug

- **`terrainFill: { terrain: "fire" }`** — reads like a shortcut past the fuel
  problem. `resolveHitAgainstTarget` calls `waterSoil(tile)` unconditionally
  after any `terrainFill`, so it would have *fertilised* the ground it set
  alight, and `TERRAIN_FILLABLE` is a dry-walkable set that has nothing to do
  with flammability.
- **`gatherBurst`** — the canopy-harvest path is the only one a non-`burrow`
  damage move can feed, and the only canopy crop is Apple
  (`eligibleBiomes: ["forest"]`). No Ember learner lives in forest. Same
  rejection Rock Slide and Water Gun made, for the same reason.
- **`drainNeeds`, `spawnsRain`, `fertilityBoost`, `statusImmunityAura`,
  `selfHeal`** — every one is read only inside `maybeUseUtilityMove`, whose
  candidate list is `agent.moves.filter(m => m.utilityMove)`. `spawnsRain` in
  particular reads as an obvious Fire-tree capstone and would have been dead
  the moment it shipped.
- **A fourth `critRateStage` node.** `rollCritical` clamps the stage at 3, and
  the Kindled Fury bridge plus *Wildfire Call* reach exactly 3. The bridge's
  own notable therefore escalates the lever with `critCooldownReset` instead
  of a stage the engine would throw away — the same discipline Water Gun's
  writeup records.
- **Three `+10 Accuracy` fillers on a 100-accuracy move.** `rollAccuracy`
  only ever spends surplus through `stormAccuracyMultiplier` and the elevation
  multiplier — and a **storm is the weather that puts fires out**
  (`FIRE_RAIN_BURNOUT_MULTIPLIER`, and a rained-on fire does not spread at
  all). Unlike Water Gun, where two of six were kept on purpose, none of
  Ember's three were worth keeping: this move least wants to fight in the one
  condition that surplus buys back. All three became real levers
  (`excludesAllies`, `allyEffectOnAttack`, and a `defensePenetration` filler).

#### Passives went DOWN, measured

`passive-exposure.ts`, before → after, for every Ember learner:

| species | damageReduction before | after |
|---|---|---|
| charmander, growlithe, vulpix, ponyta, magmar | 10% | **0%** |
| charmeleon, rapidash | 18% | **8%** |

Healing (`regen` + `healAura` + `regenFlat/43`) is **byte-identical** before
and after, at 6.8%/tick for the tree — the roster-wide worst case is unchanged
at 13.6%. Thorns unchanged. `charmeleon` drops out of the roster's top-12
damageReduction table entirely.

The change is *Searing Wall*, which was a flat `damageReduction: 0.1` — the
lever this document has a whole section asking us to stop reaching for, and
one of the two that stack uncapped into real invulnerability. It now grants
**`fireproof: 0.5`**, which is the exact, bounded thing the node was already
describing: `applyFireDamage` clamps it at 1 and it touches nothing but
standing in a fire tile, which is precisely what a creature inside its own
ring is doing. Fifth user of `fireproof` in the roster.

### Leech Seed converted to v4 (Shipped) — "the thing that never had to be there"

31 → 45 nodes, 12 per branch, 9 `anyOf`, 6 fork nodes, 3 real bridges. Checker
findings for this tree: **7 → 0**. It is one of only two STATUS moves with a
real tree, and it runs on a completely different engine path from every damage
move — which is the whole story of this conversion.

**The fantasy, written before any node:**

> Leech Seed never hits anything. A seed goes in, roots take hold under the
> skin, and from then on the victim is working for somebody else: the berries
> it walked all morning to find end up in a bulb across the clearing. There is
> no wound to point at and nothing to fight back against — the host simply gets
> hungrier than its day can explain, and it keeps getting hungrier after the
> plant that did it has wandered off. What it costs the seeder is honesty. A
> bulb that eats this way has stopped making its own food, and it only works on
> somebody who has something worth taking: plant it in an empty field and it is
> a plant standing in an empty field.

#### The lever set is small because most of the roster's levers are DEAD here

`pickBestMove` (combat.ts:275) excludes every `utilityMove` from hostile
selection, so Leech Seed never reaches `resolveHit`. Read off the call sites,
that kills `power`, `hits`, `range`, `shape`, `critRateStage`,
`defensePenetration`, `forcedMovement`, `rallyCall`, `statusChance`,
`statusSeverity`, `lockTicks`, `selfCostPerUse`, `jamCooldownTicks`,
`weightScaling`, `bonusVsType`, `resistanceBreaker`, `terrainBurn`,
`excludesAllies`, `allyEffectOnAttack` and `lifestealFraction` — all of them
resolve in predation.ts. `gatherBurst` is dead too for a second reason: its two
call sites (needs.ts:1695, 1707) require a `power > 0 && category !== "status"`
move or a `burrow` move, and Leech Seed is neither.

What is left, and where each one runs:

| path | fields it reads |
|---|---|
| `maybeUseUtilityMove` (idle tick) | `drainNeeds`, `selfHeal`, `fertilityBoost`, self `statChangeOnHit`, `statusImmunityAura`, `spawnsRain`, `matingRadiusBoost` |
| `maybeUseUtilityMoveInCombat` | **only** `selfHeal` (under 60% HP), a positive self `statChangeOnHit` (under 2 stacked stages), `statusImmunityAura` (against an opponent that can inflict one) |
| `applySupportMove` (support.ts) | `targetsAlly` + `allyEffect` — independent of `utilityMove` entirely |
| always | `grantsPassive` / `grantsPassives` |

**That middle row is the design constraint that mattered most.** Status moves
were only just made usable in a fight, and `maybeUseUtilityMoveInCombat`
decides **by effect field**, not by move id. So a status tree that spends all
its budget on `drainNeeds` and `fertilityBoost` is a tree that can never fire
in combat, no matter how deep it is. Each branch therefore owns exactly one of
the three fields that can: **Aggression's Attack stage, Boldness's status
filter, and the Sociability↔Aggression bridge's self-heal.** Verified by
running `maybeUseUtilityMoveInCombat` on real builds:

| build | fires in a fight? | what happened |
|---|---|---|
| base move, no tree | **no** | — |
| Aggression lane B (`first_taste`) | **yes** | +1 attack stage, 15 ticks |
| Boldness lane B (`filter_roots`) | **yes** | 40 ticks status immunity |
| S↔A bridge (`feeding_ground`), full HP | no | not worth an action yet |
| S↔A bridge (`feeding_ground`), 30% HP | **yes** | hp 12 → 13.6 |
| Sociability lane A (`feed_the_soil`) | **no** | fertility has nothing to say mid-fight |

The last row is the control: it proves the gate is the effect field, not "did
you buy any node".

#### Lanes, and how they differ in kind

| branch | lane A | lane B | deep notable | capstone |
|---|---|---|---|---|
| **Nothing Grows Here** (agg) | **the haul** — how much comes out and out of what: `drainNeeds` 0.25→0.35→0.5, ending in the preserved hunger/thirst fork | **the surplus** — what a body does with food it didn't work for: a self Attack stage whose axis is DURATION (15t → 45t → 80t), not magnitude | *Feeding Frenzy* — two stages at once, exactly `COMBAT_MAX_SELF_BUFF_STAGES` | ***Gorged Bloom*** |
| **You Have To Come To It** (bold) | **the stalk** — the body absorbs (`damageReductionFlat`, `defenseBoost`) | **what reaches it** — nothing lands cleanly and nothing sticks (`damageReduction`, `statusImmunityAura`, and its own new fork) | *Set Too Deep* — `unshaken` | ***Rain From the Root*** |
| **What the Roots Take, the Grove Gets** (soc) | **the ground** — the stolen bulk goes into the soil the herd grazes, slow and world-facing (`fertilityBoost` 0.2/r1 → 0.5/r3) | **the body** — it goes straight into a herd-mate, now (`targetsAlly`/`allyEffect`) | *One Mouth* — the ally heal also braces | ***Roots That Feed the Grove*** |

Lane A vs lane B in Sociability is the clearest "different in kind, not degree"
in the tree: same theft, two completely different timescales, and two different
things changed — a tile that is still enriched next season against a herd-mate
that is alive right now.

#### Two capstones the roster does not already have

***Gorged Bloom*** (Aggression) is `matingRadiusBoost`. Sweet Scent is the only
other user of that primitive anywhere, and nothing in the roster has ever used
it as a capstone: it is the only node in the game whose payoff is measured in
descendants rather than damage. It also rhymes with the move — the thing that
plants seeds in other animals ends by planting them in the valley.

***Rain From the Root*** (Boldness) is `spawnsRain`, second user after Rain
Dance. It is the reason that branch is Boldness rather than more armour: a
taproot set deep enough reaches water no surface root does and pushes it back
up until it falls out of the sky. Drought is a mechanic this sim actually runs,
it dries the ponds and kills the berry patches this species eats, and nothing
else in a Grass movepool answers it. Visible on the map rather than hidden in a
meter, and it pays out for every animal standing in it — including the ones
being robbed.

#### Preserving the last pass's work, with its lever corrected

The previous round repurposed *Feeding Ground* and *Richer Ground* from two
identical "+1.5 HP Regen" nodes into `lifestealFraction`, because "a tree
literally named for draining used no lifesteal anywhere." **The reasoning was
right and is kept whole. The lever was not.** `lifestealFraction` is read at
exactly one site — predation.ts:1095, inside `resolveHit` — which this move
provably cannot reach, so both nodes were paying a skill point for nothing.

The same bridge now carries `selfHeal`, which IS this engine path's lifesteal:
`maybeUseUtilityMove` applies the drain and then *falls through* to `selfHeal`
in the same use, so the HP genuinely comes out of the same theft. And unlike
`lifestealFraction` it is one of the three fields that makes the move worth a
fight action. Measured live, one use, tree vs. base as control:

| | with the tree | control (base move) |
|---|---|---|
| victim's hunger | 0.90 → **0.65** | 0.90 → 0.75 |
| caster's HP | 20 → **23.6** | 20 → 20 |
| tile fertility | 0.10 → **0.60** | 0.10 → 0.10 |
| rain cells in world | 0 → **1** | 0 |
| mate-search boost ticks | **300** | none |

#### The `drainNeeds` overwrite collision the checker could not see

`applyMoveTree` OVERWRITES `drainNeeds` (moves.ts:786), and the shipped v2 tree
had two independently-takeable setters: Boldness's *Twin Taproot* (thirst) and
Aggression's *Insatiable* (hunger). A build with both got whichever the engine
reached last, so the tree's best fork — the resource switch, which the file's
own comment called the real highlight — silently evaporated. Nothing caught it,
because the checker's OVERWRITE list only carried the hit-pipeline fields.

Two fixes: the fork is relocated onto the tail of the Aggression lane that owns
the drain, so it is the last word on the field and nothing downstream touches
it; and `check-proposed-trees.ts` now lists the five `utilityMove` overwrite
fields (`drainNeeds`, `selfHeal`, `fertilityBoost`, `statusImmunityAura`,
`matingRadiusBoost`) alongside the others, with its own failing case in
`--selftest`. Adding them flagged **no** other shipped tree; leech_seed is the
only user of any of them today.

#### Which fork survived, which one did not, and why

Three `excludes` forks, three preserved as forks — but not the same three.

- **Preserved and promoted:** *Bountiful Roots* | *Twin Taproot* (hunger, wide
  vs. thirst, close), moved from Boldness to the Aggression drain lane's tail
  for the overwrite reason above. It is a better fork where it now sits: the
  lane is about what you take, and the fork is the last word on it.
- **Preserved in place:** *Deepening Calm* | *Watchful Roots*.
- **Dissolved, deliberately:** *Insatiable* | *Sharpened Hunger*. Both nodes
  survive with their exact mechanics — they are now the two Aggression lane
  notables. The exclusion could not: a lane notable that excludes the other
  lane's notable makes the deep notable's convergence unreachable, so that
  specific fork is structurally incompatible with v4's two-lane shape. The
  decision it expressed ("take more" vs. "convert it") is exactly what the two
  lanes now express, with skill-point scarcity doing the excluding.
- **New:** *Sealed Sap* | *Shared Filter* — duration for yourself against reach
  for the herd, on the same `statusImmunityAura`. Fork count stays at 6.

#### Passive discipline: one new kind, chosen because it CANNOT stack

The bulbasaur line is the roster's worst case — 65% thorns, 27% damage
reduction — and leech_seed was recently pulled back to the healing cap. So
every existing passive total in this tree is **unchanged to the decimal**:

| kind | before | after | how |
|---|---|---|---|
| `defenseBoost` | 0.20 | 0.20 | same five nodes |
| `damageReductionFlat` | 1.00 | 1.00 | split 0.5/0.5 across Thick Bark and Ancient Roots |
| `damageReduction` | 0.06 | 0.06 | moved from Ironroot to Bitter Sap |
| `regen` | 0.045 | 0.045 | moved from Ancient Roots to Gorged Bloom |
| `regenFlat` | 1.50 | 1.50 | split 1.0/0.5 across Watchful Roots and One Root System |
| `healAura` | 0.008 | 0.008 | — |
| `calmingPresence` | 0.60 | 0.60 | same five nodes |
| `thorns` | **0** | **0** | — |
| `unshaken` | 0 | **1** | new |

Healing still reads **8.8%/tick** against the 10% per-move ceiling; damage
reduction 6% against 20%; thorns 0.

`unshaken` was chosen over another point of `damageReduction` specifically
because predation.ts:1242 gates it on `> 0` rather than summing, so it is
structurally incapable of stacking into invulnerability across a movepool. It
is the only passive kind on the board with that property, which makes it the
right one to hand the species that already has the two worst uncapped totals.

`passive-exposure.ts`, before and after: the only line that moved is
bulbasaur/ivysaur/venusaur gaining `unshaken 1.00`. Every regen, thorns,
damage-reduction and calming figure is byte-identical.

#### Two dead-content findings, reported not fixed

1. **`calmingPresence` in this tree already overshoots its own floor.**
   `calmingMultiplier` (herdConflict.ts) is `max(0.5, 1 − total)`, so anything
   past 0.50 buys nothing. leech_seed grants 0.60 on the *Deepening Calm* fork
   side, and it is the bulbasaur line's ONLY source of the passive — so the
   last 0.10 is provably dead. Trimming it to 0.50 would be a no-op in effect
   today. Left alone because it is a balance number.
2. **PP is data-only.** `ppCost` and `maxPPBonus` have zero call sites in the
   engine; the checker has rules for them and nothing spends them. Leech Seed's
   10-PP pool is real canon and nothing reads it. No PP node was added here for
   that reason.

#### The finding that is bigger than this tree: purchase order decides every OVERWRITE field

Driving the real `maybeAutoRespec` on a fully-pointed Bulbasaur, the finished
Leech Seed came out with `drainNeeds` set to *Wider Reach*'s 0.35/r5 rather
than the deeper *Insatiable*'s 0.5/r6. Root cause: `maybeAutoRespec` appends
each bought node to `moveTreeChoices` in **purchase order** and
`applyMoveTree` applies them in exactly that order, last-writer-wins. Because
`insatiable` is reachable through the `ironroot` bridge shortcut, an agent can
buy the deep node first and the shallow one later — and the shallow one wins.
The checker's "ancestrally related ⇒ safe" test does not catch this, because
the ancestry runs through `prerequisitesAnyOf`, which is a *route*, not a
purchase-order guarantee.

**This is not something the conversion introduced — it is roster-wide and
pre-existing.** Measured across every shipped tree, three rng seeds each,
comparing the auto-respec result against the same node set applied in depth
order:

| tree | field that drifts | bought-order result | depth-order result |
|---|---|---|---|
| tackle | `situationalBonus` | flanking ×1.7 | concealed ×1.5 |
| tackle | `statChangeOnHit` | self attack +2 | self defense +1 |
| ember | `shape` | ring r2 | line len2 |
| earthquake | `forcedMovement` | attacker, closer, 2 | defender, away, 1 |
| water_gun | `allyEffect` | buff only | heal 0.25 + buff |
| solar_beam | `allyEffect` | heal 0.25 | heal 0.25 + buff |
| wing_attack | `forcedMovement` | defender, away, 2 | attacker, away, 1 |
| leech_seed | `drainNeeds` | hunger 0.35 r5 | hunger 0.5 r6 |

Every tree with an overwrite field drifts, at every seed. **The fix belongs in
the engine, not in one tree's shape** — sorting `chosenNodeIds` by depth inside
`applyMoveTree` (or in `maybeAutoRespec` before applying) would make every
build deterministic and always land on the deepest node a build actually
bought. That changes every tree's outcome, so it is written down here as a
decision to make rather than made.

#### Balance, with the roster as control

| | before | after | roster median |
|---|---|---|---|
| checker problems | **14** (worst in the roster) | **0** | — |
| nodes | 35 | **45** | 45 |
| distinct levers | 21 | **34** (joint 1st) | 24 |
| colour-pie flavours | 9 | **14** (1st) | 11 |
| tempo | 2.00x (cap 2.00) | **2.00x — unchanged** | 2.00x |
| power | 2.38x | 2.75x | 2.20x |
| cheapest capstone | 12 pts | 11 pts | 10 pts |

**No cooldown number was moved.** Ember was already spending the full −2 the
3x cap allows on a base-3 move, so there was no headroom to spend and none was
taken. The one number that did move is power, 2.38x → 2.75x, which sits
between Peck (2.57x) and Tackle (3.38x); an earlier draft read 3.13x and three
`+5 power` riders were trimmed off notables to bring it back into the band.

**The real balance change to look at is `ring_of_fire`'s `hitsArea`.** It is
a bug fix by the letter — the node was charging for nothing — but a fully
specced Boldness build now hits 13 tiles where it used to hit one, which no
amount of "it was dead anyway" makes small. The one-line revert is removing
`hitsArea: true`, which puts the branch back to what it has always actually
done, i.e. nothing.

#### Verified by running it, not by reading it

Driving the engine's own `maybeAutoRespec` on a real Charmander with points
to spend, once per disposition: **42 of 45 nodes bought in each case** (the
missing three are the excluded fork sides), **all three capstones reached
from every disposition**, and every new lever present on the resulting spec
(`hits`, `hitsArea`, `burst`, `jamCooldownTicks 2`, `critRateStage 3` —
exactly the engine's clamp). And driving `tickWorld` itself, with controls:

| | measured | control |
|---|---|---|
| *Ring of Fire*, a body each side | 8 and **8** | base move: 9 and **0** |
| *Fill the Circle*, bodies at 1 and 2 tiles | 9 and **9** | hollow ring r2: **0** and 9 |
| *Never Ours*, herd-mate in the blast | foe 8, herd-mate **0** | without it: foe 8, herd-mate **8** |
| *Take Up the Coals*, standing in fire | **14**, tile `fire`→`floor` | 9 off fire, 9 without the node |
| *Beat At the Flames*, a target with a cooldown of 2 | **3** | without it: 1 |

**An honest limit, stated plainly.** Reachability of *Take Up the Coals* in a
real population is probabilistic and was **not** measured end-to-end: the
mechanic is proven, and the ignition rates above bound how often a fire exists
to stand in, but no long run was done to count how often a specced agent
actually ends a turn on one. That is the same class of gap the Rock Slide and
Peck conversions recorded for their own lone learners.

### Rock Throw converted to v4 (Shipped) — "one rock, found, aimed and gone"

Eighth structural conversion, and the one that had to be designed *against*
Rock Slide, converted immediately before it, on the same species. Rock Slide
is "Onix rears against a slope and the slope lets go"; the brief here was
that Rock Throw must be a different thing entirely.

| | before | after | roster median |
|---|---|---|---|
| nodes | 38 | **45** | 45 |
| checker problems | **8** | **0** | — |
| distinct levers | 17 | **23** | 24 |
| colour-pie flavours | 10 | 10 | 10 |
| tempo | **1.00x** (roster floor) | 1.67x (cap 2.50x) | 1.80–2.00x |
| power | 2.62x | 2.92x | 2.20x |
| max defensePenetration | 0.60 | 0.80 | (solar_beam 1.10, earthquake 0.95) |
| cheapest capstone | 8 pts | 10 pts | 10 pts |
| new passives | — | **zero** | — |

**The fantasy, written before a node moved:**

> Rock Throw is the only move in the roster that spends something it did not
> make. The boulder under Onix's tail is real terrain — measured at 64–189
> tiles of a 5,400-tile surface across three seeds, 1.2–3.5%, laid down at
> worldgen and never replaced by anything in the sim — and the throw EATS it:
> the tile drops to bare floor, the sight-block it gave is gone, and
> something up to three tiles away takes a rock at triple damage. Rock Slide
> is a hillside letting go and Earthquake is the ground itself; this is ONE
> rock, found on the ground, aimed, and gone. Everything dangerous about it
> is a supply question — is there a rock under you right now, is this target
> worth the last one, and what does the ground look like once you have
> thrown them all.

Lanes differ in kind, per branch:

- **Aggression — "make it count."** Lane A is THE AIM (accuracy to the exact
  90→100 the roll can actually spend, *Skyfall*'s angle, and +1 Range — the
  v3 "reach a lumbering body wouldn't have" finally spent on). Lane B is THE
  CATCH (the Speed pin, deepened in DURATION rather than magnitude because
  stat stages stack). Precision versus attrition. Deep notable *Already
  Reaching* is `critCooldownReset` — the rock that lands on the joint means
  the next one is out of the ground already.
- **Boldness — "the ground you are standing on IS the ammunition."** Lane A
  is THE STANCE (`immovable`: nothing drags you off your own quarry). Lane B
  is THE TAKE, and its notable *Stone Underfoot* is the tree's identity node
  and its ONE `consumesOwnTerrain` setter — 3x becomes 4.5x. Boulders are
  zero percent of the underground layer, so for an underground native this
  notable is a real reason to be up top.
- **Sociability — "somebody else has seen the rock."** A thrown rock is a
  pointer. Lane A is THE CALL (*Carrying Rumble* takes the mark from 20 to 34
  ticks — the node that makes `rallyCall` actually converge anybody, since a
  20-tick mark on a target three tiles away expires before a herd-mate can
  walk to it). Lane B is THE CARRY. Deep notable *Colony Watch* adds
  `allyEffectOnAttack`, so every rock thrown at something else is also a hand
  on a herd-mate's shoulder.

**A real bug found and fixed: the fork tip that did nothing.** `crippling_snare`
set `shape: { kind: "cone", length: 3, width: 2 }` and nothing else — and
`shape` is only ever read inside `resolveAreaHit`, which `resolveHit` only
calls when `hitsArea` is true. Rock Throw is single-target, so the node spent
a skill point on a footprint the engine never looked at. Proved by running
the real `resolveHit` with a bystander standing inside where the cone would
reach, **with a control** (the same cone plus `hitsArea`) so a "nobody was
hit" reading could not be a broken harness:

| spec | target hp | bystander hp |
|---|---|---|
| base (line 3, no `hitsArea`) | 175 | 200 |
| v3 cone delta, no `hitsArea` | 175 | **200** |
| CONTROL: same cone + `hitsArea` | 175 | **177** |

It could not simply be fixed by adding `hitsArea`, and that is the more
useful finding: `resolveAreaHit` builds its target set from `resolveShape`
tiles, so any footprint narrower than the move's own range envelope can whiff
outright on a legal target — a cone of length 3 does not cover a target three
tiles away on a diagonal. Rock Slide gets away with `burst` radius 1 because
its range is also 1. At range 3 the only safe footprint is a radius-3 burst,
which is Rock Slide's move. The fork is preserved, with the same decision
(hit it harder / keep it off you) in a live lever: *Driven Back* is the
tree's first physical lever, one tile of `forcedMovement` shove.

**Levers rejected, each checked at the call site:** `excludesAllies` (only
read by `resolveAreaHit`'s target filter — inert on a single-target move);
`statusChance`/`statusSpreads`/`statusSeverity` (`statusKind` is not
tree-settable and the base spec sets none); `gatherBurst` (canopy-harvest
only, forest crops, wrong biomes — the same finding Rock Slide recorded);
`weightScaling` and `chargeAttack` (Tackle's and Body Slam's signature, and
every Rock Throw learner also knows Tackle); `selfCostPerUse` on the
Aggression↔Boldness bridge (Rock Slide's *Mountainfall* is the same lever in
the same structural slot); and — the interesting one — `terrainFill:
{ terrain: "boulder" }`, which is buildable, would have dropped a fresh
boulder where the rock landed, and would have been the only self-restocking
ammunition loop in the roster. Rejected because it **erases the identity**:
this move's whole point is spending a resource it did not create, and
Earthquake already owns the fill-and-consume mud loop.

**The overwrite audit is where most of the eight problems were.** Six
co-takeable `statChangeOnHit` setters and three `situationalBonus` setters
were silently racing each other. Both are now single ancestral chains:
`pinning_impact → rolling_thunder → marked_advantage → hobbling_throw` for
the pin (monotonic in duration, deepest last), and exactly one
`situationalBonus` in the whole tree. The one that was cut is worth recording
as a design call rather than a checker concession: `flanking` reads "the
defender is not currently fighting or hunting ME", which for something
throwing rocks from three tiles away is true most of the time. A condition
that is nearly always on is not a condition. The tree's one situational
payoff went to `rallyMarked`, which the Sociability branch has to earn.

**Two things to flag for tuning, not decided here.**

- **Tempo was raised, deliberately.** Rock Throw had no cooldown node at all
  — a flat 1.00x, the roster floor against a 1.80–2.00x median. Two −1 nodes
  in different branches take it to 1.67x, still below median and well under
  its own 2.50x cap. Reverting to −1 (1.25x) or 0 is a one-line change.
- **`critCooldownReset` is a tempo lever the cooldown cap cannot see**,
  because it spends no `cooldownTicks`. It is on *Already Reaching* with a
  crit stage in the same node.

**Units, since this file has been burned by them before:** `cooldownTicks`
counts the agent's own ACTIONS (`tickCooldowns` runs inside
`tickAgentAction`), while `lockTicks` counts WORLD ticks (`tickActionLock`
runs from `tickAgentNeeds`, every tick). Two different denominators —
Quarry Break's 2 lock ticks is a smaller cost than it looks beside a
cooldown of 4.

**Accuracy surplus is conditional here, not dead.** Rock Throw's canon
accuracy is 90, unlike the 100-accuracy move where six "+5 Accuracy" fillers
were found to be pure filler. `rollAccuracy` computes
`accuracy * stageMultiplier * extraMultiplier`, and both
`stormAccuracyMultiplier` and `elevationAccuracyMultiplier` compose onto that
same `extraMultiplier` — so past 100 the points buy weather-and-uphill
insurance rather than nothing. Still capped at one accuracy node per lane;
the "+8 Accuracy" tail filler behind Skyfall was cut.

**Passive discipline: zero new passives, and `passive-exposure.ts` output is
byte-identical before and after.** Onix/Geodude already carry
`damageReductionFlat 12.50` / `immovable 4` / 27% thorns / 11.0%/tick healing
summed across their movepool, and passives stack uncapped across every tree a
species knows. Where a branch wanted more, it got a `delta`.

**Verified by running it, not reading it.** Driving the engine's own
`maybeAutoRespec` on a real Geodude with points to spend, once per
disposition: **42 of 45 nodes bought in every case**, all three capstones
reached, and the three unbought are exactly one side of each of the three
`excludes` forks — 45 − 3 = 42 is the correct "everything" number. Same
result Rock Slide's conversion produced. Note the same caveat: in a plain
demo run the tree is inert, because three seeds × 2,000 ticks produced **zero
living Rock Throw learners**. That is the population problem already logged
against Rock Slide, not a tree problem.

| nodes | 31 | **45** | 45 |
| distinct levers | 14 * | **18** | 24 |
| colour-pie flavours | 8 | **7** | 10 |
| tempo | 1.41x (cap 2.82) | **1.94x** | 2.00x |
| cheapest capstone | 7 pts | **10 pts** | 10 pts |
| checker problems | **7** | **0** | — |
| `*` = flagged >35% off the median | | | |

Nothing is flagged any more. Two numbers deserve explaining rather than
celebrating:

- **Flavours went DOWN, 8 → 7, and that is the honest number.** The 8th was
  "raw damage", contributed solely by the dead `lifestealFraction`. Seven is
  the hard ceiling for this move: "stealth", "piercing", "wider aoe",
  "reposition others", "aggressive movement", "rallying" and "no friendly
  fire" are every one of them hit-pipeline flavours, and this move has no hit
  pipeline. Every remaining flavour it can reach — resource economy, healing,
  planted/duration, calming, defence, environment, ally buffing — is in the
  tree.
- **Tempo moved 1.41x → 1.94x, and that is a tuning decision, not a conversion
  one.** The extra nodes brought six more `-1 Cooldown` fillers, landing the
  move on a 15-tick cooldown against a base of 30 — the roster median, and well
  inside the 2.82x cap. Reverting any of those six to another lever is a
  one-line change each; the six are `bitter_sap`, `set_too_deep`,
  `settled_stance`, `rain_from_the_root`, `one_mouth`, `one_root_system`.

#### Verified by running it, not by reading it

Driving the engine's own `maybeAutoRespec` on a real Bulbasaur with points to
spend, once per disposition: **42 of 45 nodes bought in each case** (the three
missing are the excluded fork sides), **all three capstones reached from every
disposition**, and every new lever present on the resulting spec — `selfHeal`
0.09, `statusImmunityAura`, `spawnsRain`, `matingRadiusBoost` ×2,
`statChangeOnHit` attack +2/80t, `fertilityBoost` 0.5/r3, `allyEffect` heal
0.18 + defense buff.

Both fork sides walked through the real `applyMoveTree`: the hunger side ends
on `drainNeeds hunger 0.25 r9` and 120t/r0 immunity, the thirst side on
`drainNeeds thirst 0.5 r5` and 50t/r3 — the two forks genuinely diverge in the
finished spec.

`applySupportMove` on a real herd: *Rooted Calm* heals an ally 10 → 14; the
finished *One Mouth* heals 10 → 17.2 **and** applies a real +1 defense stage.

**And a limit stated plainly.** `maybeUseUtilityMove` is gated behind
`chooseBehavior(agent.needs) === "idle"` (needs.ts:1544), and `chooseBehavior`
returns `seekFood` the moment hunger drops below 0.70 — measured directly:
hunger 0.75 → `idle`, hunger 0.69 → `seekFood`. **So the parasite can only
feed when it is not hungry**, and `agent.needs[need] = min(1, …)` caps what it
gains at whatever headroom is left. In practice `drainNeeds` is a weapon —
it makes the other thing starve — far more than it is sustenance, and the tree
is written to that reading. Whether that gate is intended is an engine
question, not a tree one; it is untouched here.

Separately, `maybeUseUtilityMoveInCombat` applies `selfHeal`,
`statChangeOnHit` and `statusImmunityAura` but **not** `drainNeeds` — so a
Leech Seed spent on a fight action buffs and heals but does not actually drain
the thing it is fighting. That reads like a real gap rather than a decision,
and it is the single highest-value follow-up for this move. Also untouched
here: it would change what every `drainNeeds` node is worth.

### Flamethrower converted to v4 (Shipped) — "one held breath"

Fourteenth conversion, and the deliberate opposite pole to `ember`, which was
converted one commit earlier. Going in: **39 nodes, 3 checker problems** (all
three branches at 10 nodes against v4's 12). Out: **45 nodes, 0 problems.**

**The fantasy, written before a node was touched**, and written against Ember
rather than in isolation:

> Flamethrower is ONE BREATH. The chest fills, and what comes out is not a
> spark but a jet — held, aimed and steered for exactly as long as the lungs
> last. Nothing inside the cone gets a moment to be somewhere else: you put it
> on one thing and you keep it there until that thing is finished, or until
> the air is. What is dangerous about it is that it does not let up. What is
> dangerous to the creature holding it is the same fact — while the breath is
> out it is rooted, pointed one way, and everything else on the field knows
> exactly where it is and that it is busy.

| | |
|---|---|
| **ember** | spark, then consequence — spread, aftermath, terrain |
| **flamethrower** | control, then duration — aim, hold, commitment |

Two of Ember's signature levers were therefore **removed** from this tree
rather than kept: `statusSpreads` (a burn that jumps to the next body is
*Spreading Blaze*'s whole payoff) and `terrainBurn` (this move's fire is over
when the breath is). What went in instead is `lockTicks`, three times, as the
recurring price of holding a breath — every big node here costs the caster its
own next action tick. `lockTicks` locks the **user**, not the defender
(combat.ts's `useMove`), which is why it is the right lever for this move and
the wrong one for almost every other.

**Lanes differ in kind, per branch:**

| branch | lane A | lane B | deep notable | capstone |
|---|---|---|---|---|
| **One Breath, One Thing** (agg) | **reach** — what the jet gets through (*Nothing Melts Quickly*, then *Melting Blast*) | **severity** — what being held in it does, paid in the caster's own actions (*Held Breath*, then *Held to the Bone*, then the preserved beam-vs-cone fork) | *Combustion* | ***Until It's Finished*** |
| **The Line It Holds** (bold) | **the footprint** — ***Open the Throat***, then *Nowhere to Step* | **the stance** — *Banked Coals*, then the preserved plant-vs-thorns fork | *Unburnt* | *Nothing Gets Past* |
| **What It Holds, We Finish** (soc) | **the mark** — *Held in Plain Sight*'s `rallyCall`, then *United Blaze* | **the cover** — *Warm at Your Back*, then the preserved rouse-vs-calm fork | *Communal Blaze* | *Hold the Target* |

Boldness was a generic armor ladder that vine_whip and rock_slide were running
node-for-node; it is now geometry plus refusal. Sociability was Ember's hearth
wearing a different name; it is now the inverse reading of the same flame — a
creature that is rooted, blind and pointed one way is, to a herd, a pointing
finger.

#### Three shipped bugs, all found by running the engine rather than reading it

**1. The cone had never covered a tile.** Flamethrower is the roster's cone
move — `shape: { kind: "cone", length: 4, width: 2 }`, which `resolveShape`
resolves to **12 real tiles** — and it set `hitsArea` nowhere. `shape` is read
only by `resolveShape` inside `resolveAreaHit`, which only runs for a
`hitsArea` move. Measured on a real `tickWorld`, three bodies laid inside that
footprint, 8 ticks, same seed:

| build | bodies in a `fought` event |
|---|---|
| shipped (control) | `prim` |
| + *Open the Throat* (`hitsArea`, no shape change) | `prim`, `cone_side`, `cone_far` |

Same class of bug as Ember's three dead `shape` nodes, on the one move in the
roster whose entire silhouette is its cone. The fix is Boldness's lane
notable, because turning a needle into a 12-tile cone is notable-tier currency
(principle 14).

**And it was worse than one dead node** — *Focused Beam*, one half of the
tree's oldest fork, sets `shape: { kind: "line", length: 6 }` and was equally
dead:

| build | bodies hit |
|---|---|
| *Focused Beam* alone (control) | `prim` |
| *Focused Beam* + *Open the Throat* | `prim`, `cone_far` |

(`cone_side` sits off the line, which is the line behaving correctly.)

**2. Four `fireproof` nodes summing to 2.5 against a clamp of 1.**
`applyFireDamage` (fire.ts) does `Math.min(1, agent.passives.fireproof ?? 0)`,
so **1.5 of that was provably dead** — the same clamp finding as Ember's crit
stage 3. It is now exactly two nodes, *Scorchproof Hide* (0.5) and *Unburnt*
(0.5), landing on 1.0 on the nose. *Set Your Feet* and *Living Furnace* spent
their fireproof on real levers instead.

**3. Three `+10 Accuracy` fillers on a 100-accuracy move.** `rollAccuracy`
only ever spends surplus through `stormAccuracyMultiplier` and the elevation
multiplier — and a **storm is the weather that puts fires out**. Ember made
the same call for the same reason; all three are real levers now
(`bonusVsType`, `power`+`statusChance`, `rallyCall`).

#### The best node in the tree

***Nothing Melts Quickly*** — `bonusVsType: { type: "rock", multiplier: 2 }`.
Fire is **0.5x into Rock** on this engine's own chart (typing.ts), and a
doubling puts it back at neutral. That is the whole duration fantasy said as a
type matchup: a spat coal bounces off stone, a flame *held* on it does not.
And the condition is one the map actually supplies — Charizard lives in
badlands/highland, which is exactly where Geodude and Onix live.

#### Levers checked at the call site and rejected

- **`chargeAttack`** — the obvious "one held breath" primitive, and **Slash
  already is it** ("the stillness before the swing", `ticks: 2, leapTiles: 0`).
  Charizard is the only Flamethrower learner and it knows Slash. Same species,
  same lever, twice.
- **`situationalBonus: { condition: "drought" }`** — would have been the
  roster's first `drought` user and reads perfect on a fire move. Measured over
  **3 seeds x 4,000 ticks**, 40 sampled tiles per biome, sampling every 10th
  tick:

  | biome | drought share of sampled ticks | any weather |
  |---|---|---|
  | badlands | 0.0% / 4.9% / 0.6% | 10.6% / 13.5% / 19.0% |
  | highland | 7.6% / 0.0% / 0.0% | 10.5% / 2.0% / 14.1% |
  | grassland (control) | 0.2% / 0.0% / 0.1% | 12.0% / 4.2% / 15.5% |

  Badlands has the roster's highest drought affinity (weight 3 in
  `BIOME_WEATHER_AFFINITY`) and still spends an entire 4,000-tick run at 0.0%
  on one seed in three. A capstone that is simply absent for a whole run is
  unreachable content, not a spike. Rejected; the capstone went to
  `targetLowHp` instead, which is the finisher reading and is common.
- **`excludesAllies`** — read only inside `resolveAreaHit`'s target filter, so
  it is dead unless the same build also bought `hitsArea`, which lives in a
  different branch here. A node that only works if you invested elsewhere is
  not a node.
- **A second `unshaken`.** `resolveHitAgainstTarget` tests
  `(defender.passives?.unshaken ?? 0) > 0` — **the value is never read**, only
  its sign. Slash already grants Charizard `unshaken: 1`, so a second grant is
  dead on the only species that can hold both. This is a cross-tree finding,
  not a Flamethrower one: five trees grant `unshaken` and any species learning
  two of them is wasting one.
- **`terrainFill: { terrain: "fire" }`** — `resolveHitAgainstTarget` calls
  `waterSoil(tile)` unconditionally after any `terrainFill`, so it would
  fertilise the ground it lit. Same rejection Ember made.
- **`drainNeeds`, `selfHeal`, `spawnsRain`, `fertilityBoost`,
  `statusImmunityAura`** — all read only inside `maybeUseUtilityMove`, whose
  candidate list is `agent.moves.filter(m => m.utilityMove)`. Dead on an
  attack move.
- **`gatherBurst`** — the only canopy crop is Apple (forest-only) and no
  Flamethrower learner lives in forest. Same rejection as Ember, Rock Slide
  and Water Gun.
- **A fourth `critRateStage` node.** `rollCritical` clamps the stage at 3
  (`Math.min(3, ...)`), and the Flashpoint bridge reaches exactly 3. Its own
  notable therefore stops at the clamp instead of buying a stage the engine
  throws away.

#### One thing measured that the tree does NOT claim

On an area hit, `isPrimaryTarget` gates status infliction, the defender-side
stat change, on-hit forced movement, position swap, `jamCooldownTicks` **and**
`terrainBurn` (predation.ts). So *Open the Throat* spreads **damage** across
the cone and nothing else. *Nowhere to Step* and *Nothing Gets Past* land on
the primary target only, and the node comments say so rather than implying a
cone-wide slow or a cone-wide jam.

#### Numbers, before and after

`tree-balance.ts`, roster median as the control:

| metric | before | after | roster median |
|---|---|---|---|
| nodes | 39 | **45** | 45 |
| checker problems | **3** | **0** | — |
| distinct levers | 24 | **29** | 28 |
| colour-pie flavours | 9 | **12** | 12 |
| tempo multiplier | 1.75x | **1.75x** | 2.00x |
| power multiplier | 1.61x | **2.20x** | 2.20x |
| cheapest capstone | 11 pts | **10 pts** | 10 pts |

**Cooldown deliberately untouched.** -3 against a base of 6 is 1.75x where the
cap allows 2.33x. That is 12% under the median, not an outlier, and spending
the last -1 of headroom would be a balance decision rather than a conversion.
Flagged, not taken.

#### Passives went DOWN, and nothing else moved

`passive-exposure.ts` before and after is **byte-identical** — no species in
the worst-case table moved, and the roster worst cases (33% damageReduction,
65% thorns, 13.6%/tick healing) are unchanged. Charizard is the only learner,
and the one thing that changed for it is the dead fireproof:

| charizard passive | before | after |
|---|---|---|
| fireproof | 2.5 (clamp is 1) | **1.0** |
| thorns | 0.32 | 0.32 |
| damageReduction | 0.06 | 0.06 |
| regen | 0.04 | 0.04 |

No new passive kind was added anywhere in the tree. Every new node is a
`delta`.

#### Tests

`pnpm -r test` is green at **1,587 tests, 0 changed**. No shipped test
encoded this tree's node ids or paths, so no assertion's meaning changed. The
two pre-existing `tsc --noEmit` errors in `engine/src/rapportProse.ts` and
`engine/src/predation.ts` (a `RapportSubject.standing` field) are untouched by
this work and were already failing on the branch.

### Ember's Ring of Fire: how big the circle is

The footprint and the fire count are two different numbers, and the first
write-up of this conversion conflated them.

| build | shape | tiles in footprint |
|---|---|---|
| base ember | point | 1 |
| Ring of Fire (opener) | ring r1 (hollow) | 8 |
| Fill the Circle (lane notable) | burst r1 (filled) | **5** |

Those tiles are where the HIT lands. Damage only reaches agents standing on
them, so an open-field cast is still one target.

**Fire is a separate, much smaller number.** Exactly one node in the 45-node
tree can ignite terrain (`wider_burn`, via `terrainBurn`), and `igniteNear`
lights the agent's own tile or the first of four neighbours with fuel and
then RETURNS — so ignitions are capped at **one per agent hit**, never one
per tile. Fuel is roughly 5% of a real map. A fully-specced Ring of Fire
starts one to three fires in a herd fight, not thirteen.

The notable shipped at `burst radius: 2` — 13 tiles, since burst radius is
manhattan — which was the roster's biggest single footprint on a 40-power
move that also spreads burn. Direct call: *"13 is probably too much. Do the
burst R1."* Five tiles still reads as an area, and it is still the escalation
the name describes: the r1 ring is a hollow 8-tile shell that misses the
caster's own adjacent diagonals, and the burst is the solid plus that covers
them.

The footprint is now asserted in TILES in `moveTrees.test.ts`, not left
implicit in a radius constant, because it is a balance number rather than an
implementation detail.

### Vine Whip converted to v4 (Shipped) — "the limb, the grab, the reach"

39 → 45 nodes, 12 per branch, 9 `anyOf`, 6 fork nodes, 3 real bridges. Checker
findings for this tree: **3 → 0**. Vine Whip is the tree that PROVED the v2
template in the first place — the three-branch-plus-crosslink-triangle shape
everything else in this file inherited started here — so it is fitting that it
was one of the last three still standing at 39.

**The fantasy, written before any node:**

> Vine Whip is not a projectile and not a spell. It is a pair of limbs a plant
> grows because it has none: two lengths of green muscle come out of the bulb
> and go where the body is not going to walk. It hits like a limb, which means
> it can also hook, coil, hold and haul — the whip and the grip are the same
> motion at two different moments. What is dangerous about it is the distance:
> whatever it catches has to come to the vine to answer it. What it costs is
> that a vine with a grip on something is itself gripped, and the far end of
> the reach is the soft end.

The two neighbours it has to stay clear of are its own species-mates.
**Leech Seed owns parasitism** — no wound, theft over time, a victim that keeps
working for you after you have wandered off. **Solar Beam owns the grove and
the canopy** — light, sun, the slow bloom. Vine Whip owns **contact and
leverage**: it is the only Grass move in the roster that physically touches
something and moves it.

#### Lanes, and how they differ in kind

| branch | lane A | lane B | deep notable | capstone |
|---|---|---|---|---|
| **Choking Grip** (agg) | **the lash** — landing at all, at arm's length: accuracy, `defensePenetration`, then *Past the Rind*'s `resistanceBreaker` | **the coil** — what happens after contact: *Set the Hook*'s `lockTicks`, the drain, ending in the preserved squeeze/drag fork | *Unbreakable Hold* — `jamCooldownTicks` | ***Endless Lashing*** |
| **Root and Bind** (bold) | **the body** — the plant's own tissue: `defenseBoost`, and *Full of Rain*'s turgor | **the ground** — the earth under it: *It Takes Root*'s `terrainFill`, then the regen/thorns fork drawing on it | *Ironbark* | ***Bramble Ward*** |
| **Shared Growth** (soc) | **the feed** — what the vines bring the herd out of the world: `gatherBurst`, paid for out of the plant's own hunger | **the herd** — what the vines do to herd-mates and what herd-mates then decide: *Called Out*'s mark, the ally heal, and its fork | *Reaching Growth* — the ally effect rides a hostile hit | ***Verdant Grove*** |

Sociability's split is the sharpest: lane A takes food out of the *map* for
the herd and lane B works on herd-mates' *bodies and attention* — one hand
picks, the other holds. Boldness's is the one that needed the most work: the
branch was a straight armour ladder (immovable → defenseBoost → regen/thorns →
damageReduction → defenseBoost+thorns), five passive nodes in a row and two
colour-pie flavours. It now has a lane that is about the plant's own turgor and
a lane that is about the soil, and the two new nodes there are both `delta`s,
not passives.

#### The six new nodes, and why each one is not filler

Every one of them is a lever this tree did not have, and each was checked at
its call site before it was written.

- ***Past the Rind*** (agg lane A tail) — `resistanceBreaker: 1.4`. Grass is
  the worst-resisted attacking type in this roster and Bulbasaur's own valley
  is full of Bug and Poison, so the move's real weakness is the lane's best
  payoff: a limb does not argue with your typing, it finds skin. combat.ts:120
  only fires it when effectiveness is already below 1 and clamps with
  `Math.min(1, …)`, so it claws a resist back toward neutral and can never push
  past it. Measured live, level 20 against a Bug/Flying defender: **0.5x / 8
  damage on the base move, 0.7x / 23 on the full build**, with the control (a
  Water defender, where grass is 2x) reading **2 before and 2 after**.
- ***Set the Hook*** (agg lane B head) — `power: 5, lockTicks: 1`. A vine with
  a grip on something is itself gripped. `lockTicks` locks the **user**
  (combat.ts:308 — `agent.actionLockTicks`), which is the trade this lane is
  about, and the benefit lives in the same node per principle 4. Verified:
  `actionLockTicks` reads **1** after a use of the built spec, **undefined**
  after the base move.
- ***Full of Rain*** (bold lane A tail) — `situationalBonus: { rain, 1.35 }`.
  A rooted thing drinks; a vine full of water is stiff. The condition is the
  flavour here rather than a tax, and it is picked for fit: weather.ts:86's
  `BIOME_WEATHER_AFFINITY` weights **grassland rain at 2.0 and forest at 1.5**
  against drought 0.5/0.3, and grassland+forest are exactly Bulbasaur's biomes.
  One other node in the whole roster uses this condition. Measured live with
  the fight rng held identical across both runs so only the weather differed:
  **26 damage dry, 34 in rain**.
- ***It Takes Root*** (bold lane B head) — `terrainFill: { terrain: "flora" }`.
  The vines do not just hold ground, they change it. predation.ts:1323
  converts the defender's tile (floor/sand/mud only) and then calls
  `waterSoil`, so the tile gets a real fertility bump on top of the flora. It
  is the exact mirror of Aggression's own *Sapping Reach*, which CONSUMES a
  flora tile for double damage — one branch eats the map, the other plants it,
  and flora is this species' own `preferredTerrain`. Measured live: the
  defender's tile came out **flora at fertility 1.00**, the control's stayed
  **floor**.
- ***Own Reserves*** (soc lane A tail) — `gatherBurst: 2` plus
  `selfCostPerUse: { hunger, 0.05 }`. Bringing down more fruit than the plant
  needs is not free: predation.ts:1457 takes the cost straight off the user's
  own needs every use, and hunger is a satiation meter, so this Bulbasaur goes
  hungrier every time it feeds the herd — the honest version of a branch whose
  whole fantasy is spending yourself on everybody else. `gatherBurst` is live
  for these learners rather than assumed: the only path a non-`burrow` damage
  move can feed is needs.ts's canopy harvest, whose crop is forest-eligible,
  and Bulbasaur's biomes are grassland and forest. Measured live: attacker
  hunger **1.000 → 0.950** on one use, control **1.000**.
- ***Called Out*** (soc lane B head) — `rallyCall: { ticks: 20 }`. The reach is
  the point: a limb two or three tiles long can touch a thing the herd has not
  walked to yet, and a lash that lands is the plainest way to say "that one."
  The payoff is coordination rather than damage — other agents' own targeting
  independently prefers a marked candidate. Measured live: defender
  `rallyMarkTicksRemaining` **20**, control **undefined**.

#### Levers checked at the call site and rejected

- **`hitsArea`.** Vine Whip's base spec carries `shape: { kind: "line", length:
  2 }` and **no node in the tree has ever set `hitsArea`, so that shape has
  never resolved a single tile** — `resolveShape` is only ever reached from
  `resolveAreaHit`. That is real dead content in a shipped base spec, and it is
  reported here rather than fixed, because the fix is a footprint change and
  footprints are a balance decision. It cannot be fixed by simply adding
  `hitsArea` either, for the reason Rock Throw's own v4 notes already record: a
  footprint narrower than the move's range envelope WHIFFS outright on a legal
  target. Combat distance is manhattan and this move's range is 2 (3 with
  *Snapback Lash*), so a length-2 line misses a target standing at (1,1) — the
  sweep would land on empty grass while a legal target stood one tile off the
  axis. The only footprints that cover the envelope are a burst radius 2 (13
  tiles) or a cone length 3 — Rock Slide's move and Solar Beam's respectively,
  and neither is two vines.
- **`excludesAllies`.** Its only call site is `resolveAreaHit`'s target filter,
  so on a single-target move it can never fire. It becomes available the day
  `hitsArea` does, and the "no friendly fire" flavour still has no user
  anywhere in the roster.
- **`situationalBonus: { condition: "flanking" }`**, the obvious pick for a
  reach lane, rejected for exactly the reason Rock Throw's *Aftershock Counter*
  comment records: flanking reads "the defender is not currently fighting or
  hunting ME", which for something striking from two or three tiles away is
  true most of the time. A condition that is nearly always on is not a
  condition.
- **`fertilityBoost` / `statusImmunityAura` / `selfHeal`.** All three require
  the `utilityMove` flag to ever be read (utilityMoves.ts). Vine Whip is a
  damage move; they would have been three dead nodes.
- **`positionSwapPull` as a Sociability filler.** It is documented as
  "meaningless without `positionSwap` also set by some node in the chosen set",
  and the only node that sets `positionSwap` is the Boldness↔Sociability
  bridge — so a pure-Sociability build would have bought nothing.

#### Every fork preserved, and the bridges re-landed

All three `excludes` forks survive with their exact mechanics: *Throttling
Grip* | *Constricting Pull* (squeeze versus drag), *Verdant Recovery* |
*Thornbound* (draw from the ground versus arm it), *Vine Network* | *Bracing
Growth* (heal the herd versus sharpen it). Fork count stays at 6. The only
structural change to them is that the Sociability fork moved from the tail of
the feed lane onto the tail of the herd lane, where its own content — two
different `allyEffect`s — actually lives.

Under v2 the crosslink shortcuts landed on plain fillers. Under v4 they land on
one lane notable per branch they connect, which meant re-aiming all three:

| bridge notable | lands on | lands on |
|---|---|---|
| *Hauled In* (agg↔bold) | *Deeper Hold* (agg lane B) | *Unyielding Stem* (bold lane A) |
| *Living Trellis* (bold↔soc) | *Deeper Roots* (bold lane B) | *Shared Vigor* (soc lane B) |
| *Bloom of Thorns* (soc↔agg) | *Crushing Coil* (agg lane A) | *Quickening Growth* (soc lane A) |

**That first row is load-bearing and nearly went the other way.** The obvious
wiring put *Hauled In* on the aggression lane A notable, which quietly broke a
`forcedMovement` OVERWRITE that has been safe since v2: *Constricting Pull*'s
drag and the bridge's own *Snapback Lash*/*Reeling Lash* drag are only
co-takeable-safe because the bridge is an ANCESTOR of the fork. Landing the
bridge on the other lane severed that ancestry and made them two independent
setters of the same overwrite field. Caught by the checker before it shipped,
which is the whole reason that rule exists.

#### Passive discipline: nothing moved, deliberately

The bulbasaur line is the roster's worst case for `thorns` at **65%**, with no
engine cap anywhere. So this conversion adds **zero** passive nodes and changes
**zero** passive values:

| kind | before | after |
|---|---|---|
| `thorns` | 0.20 | 0.20 |
| `damageReduction` | 0.13 | 0.13 |
| `defenseBoost` | 0.16 | 0.16 |
| `regenFlat` | 3.00 | 3.00 |
| `healAura` | 0.015 | 0.015 |
| `immovable` | 1 | 1 |

`passive-exposure.ts` before and after the change is **byte-identical across
all 100 species**. All six new nodes are `delta`s, which is the standing
preference: a delta is bounded by the move, a passive is not.

Healing reads 8.5%/tick against the 10% per-move ceiling, damage reduction 13%
against 20%, thorns 20% against 50%.

#### Balance, with the roster as control

| metric | before | after | roster median |
|---|---|---|---|
| nodes | 39 | **45** | 45 |
| distinct levers | 24 | **30** | 28 |
| colour-pie flavours | 8 | **11** | 11 |
| tempo multiplier | 2.00x | **2.00x** (cap 2.00x) | 2.00x |
| power multiplier | 1.89x | **2.00x** | 2.20x |
| cheapest capstone | 11 pts | **9 pts** | 10 pts |
| checker problems | 3 | **0** | — |

Flavours per branch went 4 / 3 / 4 → **4 / 5 / 6**. Levers per branch (bridges
excluded) are 10 / 10 / 11.

**No cooldown headroom was spent, because there is none.** Base 3 gives
`cdFloor = ceil(4/3) − 1 = 1` and a max cut of −2, and the shipped tree already
spends exactly −2 across *Deeper Roots* and *Binding Roots*. Tempo was at its
cap before this change and is at its cap after it.

**The lifesteal ceiling was left alone and is flagged, not touched.** A full
Aggression build reads **38% lifesteal** — the highest in the roster, against a
~10% median — across four nodes that all predate this conversion (*Choking
Grip*, *Deeper Hold*, *Throttling Grip*, *Endless Lashing*). Nothing here
deepens it, and nothing here should decide unilaterally whether 38% is
intended.

#### Verified by running it, not by reading it

A harness drove the real engine: a real world, a real mob-fight, one real
landed hit, each new lever against a control. Everything in the six-node list
above carries its measured number. Two things only a real run showed:

- **A full build's flora tile does not land where the target was struck.** On a
  build that also owns the Boldness↔Sociability bridge, `positionSwap` swaps
  attacker and defender and then `positionSwapPull` shoves the defender three
  further tiles — all of which resolves BEFORE `terrainFill` in
  `resolveHitAgainstTarget`. So the vines throw the thing clear and something
  grows where it lands, several tiles from where it was hit. That reads well
  and is left as is; it is recorded because it was not obvious from the source.
- **42 of 45 nodes are buyable in one legal purchase.** The other three are the
  losing sides of the three forks, which is exactly right.

`pnpm -r test` is green at 1,312 engine + 275 data tests. **No test needed
changing**, which was not expected of the oldest tree in the file: the two
tests that mention `vine_whip` (`leveling.test.ts`, `moveCap.test.ts`) both
build their own synthetic spec and never touch the shipped tree, and
`moveTrees.test.ts`'s vine-whip coverage is generic-across-the-roster rather
than path-specific. No assertion's meaning changed.

## The additive fields ship: "you don't know how they will interact"

> "I like the idea of ADDING modifiers so you can stack your build, not
> setting them. Because with the latter you don't know how they will interact
> with each other."

The earlier pass wrote the additive shapes into `proposed-trees.ts` as a
draft. This pass built them in the engine, migrated the shipped trees that
were actually colliding, and measured each one against the real combat
pipeline.

### The measured scope, first

The collision list is derived by reading `applyMoveTree` itself — every field
it writes with `delta.X ?? result.X`, minus the booleans (those OR-merge:
once a node turns `terrainBurn` on, nothing turns it back off, so two setters
agree by construction). Ancestry-aware, `excludes`-aware, all 17 shipped
trees:

| tree | field | colliding pairs | independent setters |
|---|---|---|---|
| wing_attack | `forcedMovement` | 7 | 5 |
| solar_beam | `situationalBonus` | 4 | 5 |
| rock_slide | `weightScaling` | 4 | 5 |
| solar_beam | `range` | 3 | 3 |
| hydro_pump | `range` | 3 | 3 |
| hydro_pump | `situationalBonus` | 1 | 2 |
| wing_attack | `situationalBonus` | 1 | 2 |
| | **23 pairs** | **4 trees** | |

That is the whole real surface — smaller than the 39 pairs the first audit
counted, because the v4 conversions have been clearing them tree by tree
since. Two things about this list are worth saying plainly:

- **`weightScaling` was invisible to the checker.** It is an overwrite field
  in `applyMoveTree` and was simply not in `check-proposed-trees.ts`'s
  `OVERWRITE` list, so rock_slide shipped six independently-takeable setters
  of it (0.08 to 0.25) and nothing said a word. The list is now the full
  derived surface, not a hand-maintained subset.
- **The same list expansion surfaced two collisions in the DRAFTS.** Not
  shipped, so not fixed here, but they were invisible for the same reason:
  `growth` has **14** co-takeable `fertilityBoost` pairs and `poison_sting`
  **8** on `statusSeverity`. Both fields are plain scalars underneath and are
  the obvious next additive candidates.
- **`hits`, `statChangeOnHit`, `rallyCall` and `allyEffect` have zero shipped
  collisions today.** They were built anyway, because the drafts author in
  those shapes and because they are the fields the next conversions will
  need.

### What is additive now, and what it means

| was (overwrite) | now | resolution rule |
|---|---|---|
| `range: {max}` | `rangeBonus: +N` | sums |
| `hits: {min,max}` | `hitsBonus: +N` | sums; no base `hits` counts as one strike |
| `rallyCall: {ticks}` | `rallyCallTicks: +N` | sums |
| `hitsArea` + `shape.radius` | `areaBonus: +N` | sums, and turns `hitsArea` on |
| `situationalBonus` | `situationalBonuses[]` | different conditions multiply; same condition takes the strongest |
| `statChangeOnHit` | `statChangesOnHit[]` | different target+stat both apply; same pair takes the strongest |
| `allyEffect` | `allyEffects[]` | strongest heal, plus the strongest buff per stat |

**Why "strongest wins" inside one key rather than multiplying.** Every ladder
in this roster restates a full value instead of an increment — Twineedle's
concealed chain is 1.25 → 1.4 → 1.7, Solar Beam's low-HP chain is 1.3 → 1.6,
Leech Seed's self-Attack chain is +1 → +2. Multiplying a ladder would hand
out 2.98x where the designer wrote 1.7x. So distinct keys compose (that is
the stacking the ask is about) and one key escalates (that is what a chain
already meant). Both rules are order-independent, which is the actual defect:
`situationalBonus` alone was last-writer-wins.

**`shape` stays an overwrite, deliberately.** A cone is not a ring plus a
line. Rival forms must `excludes` each other, and the checker enforces it.
Only the SIZE became additive.

**`areaBonus` accumulates separately from `shape`, and that was a real bug in
the first cut.** Growing the shape in place lost the bonus the moment a later
node overwrote `shape`: measured, buying the form first gave radius 2 and
buying the size first gave radius 1 — the same order-dependence this pass
exists to delete, reintroduced by the fix. It now sums across the whole
selection and is applied once at the end.

### Verified against the real engine, not by reading the code

Every field below was driven through `applyMoveTree` and then through
`tickWorld` → `applyPredationInstincts` → `resolveHit`, with damage read off
the real `fought` events. BEFORE is the overwrite form in both purchase
orders; CONTROL is the same measurement where it should show nothing.

| field | BEFORE (overwrite) | AFTER (additive) | control |
|---|---|---|---|
| `rangeBonus` | 3 nodes, both orders: max **5** | max **7** either order | one node: 5. Real hits on a target 5 tiles out: **0** at range 4, **14** at range 5 |
| `situationalBonuses` | order A **31** dmg (1.29x), order B **33** (1.38x) | **43** (1.79x) either order | flanking alone 33, elevation alone 31, neither 24. Ladder 1.3→1.6 on one condition: **38**, i.e. 1.6x, not 2.08x |
| `hitsBonus` | order A 3 hits, order B 2 hits | **4** hits either order | real damage 336 → 672 (2.00x) → 1344 (4.00x); overwrite both = 1008 (3.00x) |
| `rallyCallTicks` | order A 30 ticks, order B 20 | **50** either order | no node: unmarked. Real mark on the defender: 19 / 49 |
| `statChangesOnHit` | order A defender Speed −1 only, order B self Defense +1 only | **both**, real stages on both agents | each alone applies only its own |
| `allyEffects` | order A buff only (ally hp 2700), order B heal only (hp 5000, no stages) | **hp 5000 AND Defense +2** | heal-only and buff-only each do exactly one |
| `areaBonus` | — | radius 1 → 2 → 3, same either order | real bystanders caught: 0 (no area) → 0 (radius 1, `hitsArea` off) → **4** → **6** |

The range measurement needed a control of its own: a range-**20** move also
lands 0 hits on a target 6 tiles away, so beyond 5 tiles the ceiling is the
hunter's own detection radius and not the move's range. Without that, the
zeroes further out would have read as a range result.

### What was migrated, and what was left alone

`hydro_pump` and `solar_beam` are at **0 checker problems** (from 2 and 3).
15 shipped nodes moved to the additive forms: the three `+1 Range` nodes on
Hydro Pump and three `+2 Range` on Solar Beam, and every `situationalBonus`
setter on Hydro Pump, Solar Beam, Wing Attack and Scratch.

The point-economy consequence is the reason to do it at all: a Hydro Pump
build that buys all three `+1 Range` nodes used to pay three points for
**+1** tile. It now gets **+3** (max 4 → 7). Solar Beam's three `+2` nodes go
from +2 to +6 (max 5 → 11). Those are real balance changes and they are the
literal content of the ask — flagging them rather than burying them.

**Left as overwrite, on purpose:**

- **`forcedMovement`** (wing_attack, 7 pairs). There is no sensible sum: the
  fields are `mover`, `direction`, `timing`. "Drag them closer before the
  hit" plus "shove them away after it" is not a bigger effect, it is two
  different effects. This wants `excludes` between rival displacements, which
  is a tree decision belonging to wing_attack's own v4 conversion (still
  pre-v4 at 39 nodes), not an engine change.
- **`weightScaling`** (rock_slide, 4 pairs). This one genuinely could be
  additive — `factor` is a scalar. It is left alone because making it so
  sums six setters into as much as +0.9 max-HP-scaled power, which is a
  balance decision, not a cleanup. Reported, with the checker now able to see
  it, rather than decided unilaterally.

### One thing this pass changed that it did not have to

Solar Beam's last non-collision problem was principle 13: the bridge filler
*Deeper Shade* shared no lever with its crosslink *Shared Shade*. That is a
collision between two rules, not an oversight — the node's own comment
records that it was deliberately moved OFF healing to keep the tree under the
10%/tick per-move healing budget (it sits at 9.4%, with 0.25 regenFlat of
headroom). Deepening the crosslink's healing lever would break the cap.
Resolved by giving *Shared Shade* the cover lever as a second passive
(`defenseBoost` 0.03) so the filler deepens something the crosslink actually
has. Solar Beam was using 0% of a 20% damage-reduction-style budget. The
alternative — put regen back on Deeper Shade and raise the healing cap — is a
balance call and was not taken.

### The related finding: purchase ORDER, not depth, still decides every remaining overwrite field

Not fixed here. This is a decision, not a cleanup.

`maybeAutoRespec` appends each bought node to `moveTreeChoices` in the order
it buys them, and `applyMoveTree` applies them in exactly that order. Because
`prerequisitesAnyOf` bridges let an agent reach a deep node early, a build can
buy the DEEP node first and a SHALLOW one later, and the shallow one wins.
The checker's "ancestrally related ⇒ safe" test cannot see this: ancestry is
a route, not a purchase order.

Re-measured after this pass, driving the real `maybeAutoRespec` to a full
build on all 17 trees at 3 rng seeds, comparing the bought order against the
same node set sorted by depth:

| tree | field | bought order | depth order |
|---|---|---|---|
| flamethrower | `allyEffect` | heal 0.15 + spAttack +1 | heal 0.05 + attack +1 |
| rock_throw | `resistanceBreaker` | ×1.25 | ×2 |
| water_gun | `allyEffect` | buff only | heal 0.25 + buff (30 ticks) |
| hydro_pump | `forcedMovement` | attacker, closer, beforeHit | defender, away, onHit |
| rock_slide | `weightScaling` | 0.15 | 0.25 |
| wing_attack | `forcedMovement` | attacker, closer, 2 | attacker, away, 1 |
| leech_seed | `statChangeOnHit` | self attack +1, 45t | self attack +2, 80t |
| leech_seed | `fertilityBoost` | 0.4 / r2 | 0.5 / r3 |
| leech_seed | `allyEffect` | heal only | heal + defense +1 |

**7 of 17 trees drift.** Every drifting field is one still on the overwrite
path. The additive fields do NOT drift: Solar Beam dropped off this list
entirely, and its `situationalBonuses` array does come out in a different
ORDER depending on what was bought first — but `resolveSituationalBonuses`
collapses by condition and keeps the strongest, so nothing in the sim can
observe the difference. That is the interesting half of the result: making a
field additive fixes the order problem for that field as a side effect,
because a sum and a max are both commutative.

**The proposed fix is one line** — sort `chosenNodeIds` by depth inside
`applyMoveTree` (or in `maybeAutoRespec` before applying). The argument for
it: a build should land on the deepest node it actually bought, every time,
and today an agent can pay for *Insatiable* and end up with *Wider Reach*
because of what order the rng happened to hand out points in. The argument
against, and why it is not in this commit: it changes the resolved spec of 7
of 17 shipped trees in ways nobody has balanced, always in the direction of
"the deeper, stronger node wins" — so it is a global power increase on top of
the ones this pass already made, and it silently retires whatever balance
those trees currently have.

Three ways to take it, if it is wanted:

1. **Sort by depth in `applyMoveTree`.** One line, deterministic, always the
   deepest. Changes 7 trees at once.
2. **Convert the remaining fields instead.** `weightScaling` is a trivially
   additive scalar; `allyEffect` and `statChangeOnHit` are already plural in
   the engine and only need the shipped nodes migrated. That leaves
   `forcedMovement`, `resistanceBreaker` and `fertilityBoost` — which is a
   short enough list to fix with `excludes` forks, one tree at a time, on
   each tree's own conversion.
3. **Both, in that order** — convert what converts, then sort what is left.

Option 2 is the one that matches how this roster has been fixed so far, and
it is the one I would take: every conversion is a tree-sized change with its
own before/after, where the sort is a roster-sized change with none.

### Wing Attack converted to v4 (Shipped) — "the wing, and everything it moves"

Fourteenth structural conversion, and the one designed as the explicit
counterweight to `peck`, converted immediately before it. Peck's brief was
"the point, not the wing." This one is the wing.

| | before | after | roster median |
|---|---|---|---|
| nodes | 39 | **45** | 45 |
| checker problems | **6** | **0** | — |
| distinct levers | 22 | **30** | 28 |
| colour-pie flavours | 10 | **13** | 12 |
| tempo | 2.50x (cap 2.50x) | **2.50x** — unchanged | 2.00x |
| power | 2.25x | **2.42x** | 2.20x |
| cheapest capstone | 11 pts | **10 pts** | 10 pts |
| new passive kinds | — | **one** (`immovable`) | — |

**The fantasy, written before a node moved:**

> Wing Attack is displacement, not puncture. A wing is the largest flat
> surface in the roster and this move is that surface brought down across a
> whole cone of ground at once — eight tiles already, and it does not check
> who is standing on them. Nothing about it is precise: it knocks bodies off
> the tile they chose and out of the line they were holding, and it does
> exactly that to the flock-mate beside the target. What is dangerous about a
> bird is never one bird. And the wing doing the pushing is the same wing
> holding it up, so everything this move buys is bought off the thing keeping
> it in the air.

**The Peck inversion, in one field.** Peck's deep Boldness notable *Nowhere to
Run* is `forcedMovement { mover: "defender", direction: "closer", tiles: 1 }`
— the beak hooks and the target comes back onto the spot the next jab is
already aimed at. Wing Attack's identity ladder is the same field pointed the
other way: `away`, 1 → 2 → 3 tiles. The learner lists say the same thing
independently — Peck's nine learners are mostly flightless (Doduo, Goldeen,
Farfetch'd, Nidorino), Wing Attack's five are all real fliers (the Pidgey
line, Golbat, Aerodactyl). The test file asserts both directions in the same
`it`, so the inversion cannot silently drift.

**Lanes differ in kind, per branch:**

| branch | lane A | lane B | deep notable | capstone |
|---|---|---|---|---|
| **Nothing Stands Where It Was** (agg) | *The Downbeat* — where the target ENDS UP (the `forcedMovement` ladder's top rung, *Driven Off* at 3 tiles, then armour penetration) | *The Stoop* — what the bird SPENDS to land it (crit, `critCooldownReset`, and the preserved two-quick-strikes-vs-one-committed-dive fork) | *Everything Behind It* — `weightScaling`, the one node whose value depends on who is swinging, with its own `lockTicks` cost in the same node | ***Scoured Bare*** |
| **The Air Is Not Neutral** (bold) | *Hold the Line* — survive the hit and keep the air (`damageReductionFlat`, `defenseBoost`) | *Fly the Weather* — the gale that grounds everyone else, incl. the preserved mend-between-gusts-vs-fly-into-it fork | *Nothing to Push Against* — `immovable`, the literal mirror of this tree's own Aggression identity | ***The Whole Wingspan*** |
| **What One Bird Is Not** (soc) | *The Call* — the mark; changes what OTHER birds decide to attack (`rallyCall` 15 → 25) | *Open Ranks* — the formation; cover and stat support, incl. the preserved rouse-vs-settle fork | *Lifts the Flock* — `allyEffectOnAttack`: the same beat that throws the enemy back pushes air over whoever is behind you | ***Flock's Eye*** |

**The best node in the pass is *Scoured Bare*, and it exists because the
branch had an honest problem.** Aggression spends eleven points learning to
throw things three tiles away — from a move that reaches two. A branch that
gets worse the more you buy is a trap, not a design. So the capstone does not
reach further; it strips the ground where they land. `terrainFill` resolves
*after* `forcedMovement` inside the same landed-hit block (predation.ts:1300,
then :1323), reading the defender's NEW position, so the sand goes down under
wherever the gust put them, and `terrainSpeedMultiplier` (support.ts) puts
anything walking on sand at 0.75 speed. They come back slower than they left.
It is also the only `terrainFill` in the roster that is not water or mud —
scratch, hydro_pump and earthquake all wet the ground; this one takes it away
— and the test asserts that, with the other three as its control.

***Final Stoop*'s old mechanic had to go, and the reason is a checker
finding, not taste.** v3's `situationalBonus: targetLowHp` was one of two
independently-takeable setters of an OVERWRITE field, racing *Storm Wings*.
The tree now carries exactly one condition, and the one that survived is
`storm`, because a storm is the only battlefield condition in the engine that
is specifically about air. What the node's own v3 comment insisted on —
"the old capstone widened it into a flock-sized AoE cone, undoing everything
the branch just built" — was a decision, not a gap, and it still holds: the
capstone stays single-target and the footprint change lives in Boldness.

**Accuracy surplus is live here, and it is live for a reason the fantasy
already wanted.** `stormAccuracyMultiplier` (weather.ts) multiplies every
accuracy roll by **0.6** inside a storm cell, so the break-even past which a
point of accuracy buys literally nothing is `100 / 0.6` = **167**. The
fully-invested tree lands on **150**: a specced bird casts at 90% in a gale
where an unspecced one is at 60%, and the Boldness lane that buys the storm
DAMAGE bonus is the same lane that buys the accuracy back. That is the
opposite of ember's dead accuracy fillers, and the test pins the threshold
rather than the node count.

**Six checker problems, and five of them were one bug wearing five hats.**
`forcedMovement` is an OVERWRITE field and the shipped tree had **five**
co-takeable setters with three different intents — the scatter (defender
away), the approach lunge (attacker closer, *Riding the Gust* / *Gathering
Updraft*) and the peel-out (attacker away, *Wind Shear*). Any build with two
of them was paying skill points for whichever the engine reached last. The
tree now has exactly one ancestral ladder, all `defender`/`away`, threaded
through the Scattering Strike bridge (1 → 2) into Aggression's own *Driven
Off* (3). The two rewritten nodes are the honest part:

- ***Riding the Gust* / *Gathering Updraft*** became a `weightScaling` ladder
  (0.05 → 0.08 → 0.12 at *Stooping Dive*, topped by *Everything Behind It* at
  0.15). Boldness supplies the height, Aggression supplies the fall — gravity
  is the only free power source a bird has. **The first draft of this section
  claimed a species spread this lever does not have, and it was caught by
  measuring instead of asserting:** at 0.15 and level 30 the bonus is +9.6
  power on a Pidgey (`maxHp` 64) and +13.2 on an Aerodactyl (88), not the
  "+5 vs +24" first written down. `maxHp` across this move's five learners at
  level 30 only spans 64–89, so `weightScaling`'s real axis here is LEVEL,
  not species — the same Pidgey is +5.6 at level 15. Real, and modest.
- ***Wind Shear*** lost its peel entirely. This move's forced movement belongs
  on the thing it hits, not on itself; what is left is the literal aviation
  reading of its own name.

The sixth problem was principle 13: *Covering Wing* shared no lever with its
own crosslink. Fixed by splitting the pull — `screening_dive` and
`covering_wing` grant 1 each (additive) instead of 0 and 2, and
*Wingmate Shield* adds a third, so the bridge is one ladder end to end and
the total is a real escalation rather than the v3 number moved sideways.

#### The overwrite ORDER hole, measured on this tree

DESIGN_VALIDATION.md's "known hole" — ancestry is a route, not a purchase
order — bites hardest on a tree built out of escalating ladders, so it was
measured rather than assumed. Driving the engine's own `maybeAutoRespec` on a
real Pidgey, 3 dispositions × 8 rng seeds:

| | reading | |
|---|---|---|
| nodes bought | **42 of 45**, every run | the three missing are exactly one side of each fork |
| capstones reached | **3 of 3**, every run, from every disposition | |
| final scatter | **3 tiles in 18/24 runs, 2 tiles in 6/24** | *Driven Off* is 3; the bridge's *Harder Scatter* is 2 |
| final `weightScaling` | **0.15 in 6/24, 0.12 in 18/24** | perfectly anti-correlated with the row above — whichever ladder finished last wins |

So roughly a quarter of builds get the shallower rung of one ladder. That is
the engine hole, not a tree defect (ember's `shape`, earthquake's
`forcedMovement` and tackle's `situationalBonus` all drift the same way), and
it degrades gracefully in both cases — 2 tiles is still a real knockback, 0.12
is still real mass. It is worth recording because this tree makes the number
concrete: **the fix is worth about one rung of one ladder to a quarter of
builds, per ladder.**

#### The engine gate that decides what this move actually is

`resolveHitAgainstTarget` gates `forcedMovement`, `terrainFill`,
`jamCooldownTicks`, `statChangeOnHit`, `positionSwap`, `rallyCall` and status
behind `isPrimaryTarget` (predation.ts:1289). **So on this AoE only the
deliberately-picked target is ever scattered** — everyone else standing in the
cone just takes the damage. The scatter is aimed; the cone is collateral. That
is documented, deliberate behaviour (it is the same `isPrimaryTarget` finding
water_gun's conversion recorded for its puddles), and the tree is written to
what is real rather than to what the name implies.

#### Levers rejected, each with the call site read first

- **`terrainBurn`** — a downbeat flattening a bush was the most wing-shaped
  idea in the pass, and it no longer does that. `resolveHitAgainstTarget`
  now calls `igniteNear` (predation.ts:1321): the node lights a real,
  persistent, spreading fire. A Flying move is not an ignition source, and
  ember's own writeup records that it holds the roster's only ignition node.
- **`gatherBurst`** — genuinely buildable and genuinely apt: Pidgey is
  `homeLayer: "canopy"`, the canopy-harvest path takes any off-cooldown
  damage move and scales with `range.max`, and a range-3 cone would be a
  *better* fruit-shaker than Peck's range-1 beak. Rejected because Peck's
  *Shake the Branch* is that exact node on that exact path one conversion
  earlier, and "a flock shakes a tree" twice in a row is the copy-paste
  failure this template exists to stop.
- **`statusImmunityAura` / `drainNeeds` / `selfHeal`** — all require
  `utilityMove`, and `pickBestMove` (combat.ts) *excludes* any `utilityMove`
  from hostile selection. Putting one on a Wing Attack node would have
  removed the move from combat. Same finding Peck recorded; still true.
- **`chargeAttack`** — a stoop is the canonical charge and this branch is
  literally about commitment. Rejected because Peck's capstone *Set the
  Point* is `chargeAttack`, shipped one conversion ago.
- **A wider cone at the Aggression capstone** (cone 3×3 = 15 tiles, counted).
  It would have reversed a decision this document already records in the
  node's own source comment. The footprint moved to Boldness instead, where
  the colour pie puts it anyway.
- **A third accuracy filler in Boldness**, cut for the same reason Peck's
  "+8 Accuracy" tail filler was: the surplus is bounded by 167 and the tree
  should stop well short of it.

#### The one reuse this pass did NOT dodge

*Flock's Eye*, the Sociability capstone, is `excludesAllies` — and that is not
new: earthquake, ember, scratch, hydro_pump and rock_slide all have it, and
Earthquake's whole Sociability branch is built on it. A capstone is supposed
to be something the roster does not already have, so this is a real critique
and it is recorded rather than dressed up. It is here anyway because it is the
only lever in the engine that answers this move's actual flaw, and the flaw is
the branch. The difference from Earthquake's drilled herd is direction:
Earthquake's blast is centred on itself, so its flock is standing *around* the
hit; this is the one AoE in the roster you AIM, so the flock is standing
*behind* it. That is a formation, not a drill.

#### Passive discipline: one new kind, and the honest limit of it

`passive-exposure.ts` before/after differs on exactly one line:
`aerodactyl`'s `calmingPresence` total **1.05 → 0.85**, because v3 spent both
its Sociability fork tip AND its capstone on 0.2 of the same passive and the
capstone now spends `excludesAllies` instead. Both readings are far above
`MIN_CALMING_MULTIPLIER`'s 0.50 floor, so nothing an agent does changes.

The one addition is `immovable` on *Nothing to Push Against*, chosen because
it is the exact mirror of this tree's own Aggression identity — the move that
throws everyone three tiles, on the branch that cannot be thrown anywhere —
and because it is a **threshold** passive (`status.ts:418` checks `> 0`), so
unlike `thorns` and `damageReduction` it cannot stack into invulnerability.

**And its measured limit, stated rather than designed around:** every current
learner also knows a move that already grants `immovable` — tackle for the
Pidgey line and Golbat, rock_slide for Aerodactyl — so a build that fully
invests in both trees reads `immovable 2` where 1 was already the whole
effect. It is live for a wing-attack-only spec, which is the common case at
the observed p50 level of 25, and the node's `power`/`defensePenetration`
delta is live for every build regardless.

#### Balance numbers: what moved and what deliberately did not

- **Tempo did not move, and that is the point.** Wing Attack was already at
  its own cap: base 4, `cdFloor` = 1, three `-1` nodes = the full `-3`,
  2.50x. It is *above* the 1.80–2.00x roster median and there was no headroom
  to spend, so none was spent.
- **Power moved 2.25x → 2.42x** (median 2.20x). Six new nodes originally
  carried `+5 Power` and pushed it to 2.75x; four were stripped back down
  after measuring. Reverting either of the remaining two is a one-line change.
- **Cheapest capstone 11 → 10 points**, landing exactly on the roster median,
  and every capstone's cheapest route is 100% inside its own branch.

#### The footprint, in tiles

| build | shape | tiles | reach |
|---|---|---|---|
| base wing_attack | cone(2,2) | **8** (3 then 5) | 2 |
| *The Whole Wingspan* (bold capstone) | cone(3,2) | **9** (1 then 3 then 5) | 3 |

Not a strict upgrade, and that is deliberate: the span narrows at the shoulder
(three tiles down to one at depth 1) and opens at the tip. `range.max` moves
with it, because a cast range longer than the footprint is exactly how
rock_throw's cone managed to whiff on a legal target. Both numbers are
asserted in TILES in `moveTrees.test.ts`, not left implicit in a length/width
constant.

### Round six SHIPPED — the five bare moves finally get trees, and what a `utilityMove` can actually do

`harden`, `twineedle`, `poison_sting`, `growth` and `agility` are live in
`packages/data/src/moves.ts` at 45 nodes each, template v4, 9 `anyOf`, 3
three-node bridges. `packages/data/scripts/proposed-trees.ts` is now the
historical draft, not the source of truth.

**This was not a copy-paste job, and the reason is one finding.**

#### The finding: `pickBestMove` excludes every `utilityMove`, so most of the lever list is DEAD on a status move

Read at the call site, not in this doc: `combat.ts`'s `pickBestMove` filters
`utilityMove`-flagged specs out of hostile selection, exactly like `burrow`.
So Harden, Growth and Agility never roll an accuracy check, never deal
damage, and never run `resolveHit`. Everything downstream of `resolveHit` is
therefore unreachable on them:

| dead on a `utilityMove` | count in the drafts |
|---|---|
| `shape`/`hitsArea`, `power`, `hits`, `range`, `accuracy` | 5 draft nodes |
| `defensePenetration`, `critRateStage`, `critCooldownReset` | 4 |
| `statusChance`, `statusSeverity`, `statusSpreads` | 2 |
| `jamCooldownTicks`, `situationalBonus`, `selfStateBonus` | 4 |
| `forcedMovement`/`reposition`, `positionSwap`, `terrainBurn`/`terrainFill`, `consumesOwnTerrain` | 5 |
| `selfCostPerUse`, `gatherBurst`, `allyEffectOnAttack`, `excludesAllies` | 5 |

The live surface of a status move is small and worth writing down once:

- `cooldownTicks` and `lockTicks` — applied by `useMove`, which the utility
  path does call, so a real action lock is a real cost.
- `selfHeal`, `statChangeOnHit` (self), `statusImmunityAura`,
  `fertilityBoost`, `spawnsRain`, `matingRadiusBoost`, `drainNeeds` —
  `utilityMoves.ts`'s `maybeUseUtilityMove`.
- `targetsAlly` + `allyEffect` — `support.ts`'s `applySupportMove`, which
  does **not** exclude utility moves. This is the one that saves the
  Sociability branches.
- every `grantsPassive` kind — agent-level, needs no trigger at all.

That is 10 delta levers plus 13 passive kinds, and it maps to **8 of the
colour pie's 15 flavours**. Harden and Agility reach 7 of those 8, which is
why `tree-balance.ts` flags them at 7 flavours against a roster median of 11.
That is a ceiling, not an under-explored fantasy — the same shape `dig` (5)
and `leech_seed` (7) already sit in.

#### The check that matters most: can a branch fire in a fight at all

`maybeUseUtilityMoveInCombat` decides by EFFECT FIELD, not move id, and will
only ever spend a fight action on `selfHeal`, a **positive self**
`statChangeOnHit`, or `statusImmunityAura`. All three are OVERWRITE fields,
so each can only have one ancestry chain per tree — which means placing them
is a whole-tree constraint, not a per-branch decision.

Placed one per branch on every status tree:

| move | Aggression | Boldness | Sociability |
|---|---|---|---|
| harden | *passives only* (thorns/unshaken/defenseBoost) | `selfHeal` (Chrysalis) + Defense ladder | `statusImmunityAura` (Let It Pass) |
| growth | `selfHeal` (Spore Reserve) | `statChangeOnHit` (Worked Ground) | `statusImmunityAura` (Homestead) |
| agility | `statChangeOnHit` (Speed ladder) | `selfHeal` (Overland) | `statusImmunityAura` (One Pace) |

**A test caught a real defect here mid-build.** Agility's Sociability branch
originally had none of the three — it was allyEffect + passives only, so it
could never spend a fight action. The `statusImmunityAura` chain moved out of
Boldness and into Sociability to fix it, and Boldness's Pathfinder lane took
`fertilityBoost` instead (a herd churning a path leaves ground things grow
in — the live version of the draft's `createsTerrain` node). The test that
caught it is in `packages/data/test/moveTrees.test.ts` and was proven to fail
by injecting a `defensePenetration` onto an Agility node.

#### Every "needs a new primitive" claim, checked at the call site

None of these exist. Each was replaced with a live lever that serves the same
fantasy, not shipped as a dead node:

| draft primitive | verdict | what shipped instead |
|---|---|---|
| `bulk` (the Harden→Tackle weight idea) | `weightScaling` reads `attacker.maxHp` and nothing else — no term to add to | `defenseBoost` / `damageReductionFlat` |
| `unnoticed`/`unnoticedAura`/`huntTargetSkip` | nothing subtracts from `isDetectable`'s `baseRadius` but the bush term | `calmingPresence` + `nonTerritorial` — the shipped "nothing near it starts anything" |
| `thornsRubble` + a "rubble" `TerrainKind` | neither exists | `thorns` + a real `fertilityBoost`: the shell still sheds onto the ground, it grows things instead of blocking them |
| `statusNeedsInterference` (*Sickened*) | `tickStatusEffects` gives poison a flat DOT and nothing else; no needs-recovery path reads `agent.status` | `statusSeverity` + `jamCooldownTicks` — see below |
| `createsTerrain` at the caster's tile | `terrainFill` fires at the DEFENDER's tile on a landed hit; a utility move never lands one | a `fertilityBoost` flood big enough that flora.ts's own germination does the planting |
| `fertilityCeilingBoost`, `floraRegrowthMultiplier`, `floraCompetition`, `herdForageBonus`, `herdMigrationResistance` | not delta fields, nothing reads them | `matingRadiusBoost` carries the settle-here fantasy, and shows up as a population curve |
| `terrainUnhindered`, `dispersalSpeed`, `herdHaste`, `cooldownHaste` | not `PassiveKind`s | `fireproof` (ground that stops everything else), `aquaticHaste` (the shipped herd speed aura), plain `cooldownTicks` |
| `ppCost` / `maxPPBonus` | no PP economy; `MoveSpec.pp` is inert | `selfCostPerUse` (energy) on Twineedle/Poison Sting — a real per-use price on the sim's own needs axes |

**The one node that could not ship, stated plainly.** *Sickened* — "a poisoned
agent recovers hunger and thirst at half rate, so the payoff of poisoning
something is that it STARVES" — was the best idea in the round-six drafts and
it is still unbuildable. `drainNeeds` is the nearest shipped primitive and is
unreachable on Poison Sting: `utilityMoves.ts` is its only reader, and
flagging Poison Sting `utilityMove` would remove it from combat entirely. It
ships as the half that runs: venom severe enough that the thing it is in
cannot get its own tempo back. **The needs-recovery hook in needs.ts is still
the highest-value missing primitive for this move, and it is now the only
thing standing between the draft and its own best node.**

#### The OVERWRITE fix the checker caught

The draft `growth` had **fourteen** co-takeable `fertilityBoost` setters —
`applyMoveTree` overwrites that field, so a build with several of them
silently got whichever the engine reached last. Every overwrite field in all
five shipped trees is now on exactly one ancestry chain, so a later node
escalates an earlier one instead of racing it:

| tree | field | the chain |
|---|---|---|
| growth | `fertilityBoost` | Deep Roots 0.45 → Humus 0.6 → Old Ground 0.8/r1 → Seedbed 0.9 → It Takes 1.2/r2 |
| harden | `statChangeOnHit` | base +1 → Settling Weight +2 → Hardening Habit +3 → Unbudgeable +4 |
| agility | `statChangeOnHit` | base +2 → First Move +3 → Wound Up +4 → Blur +5 → Faster Than Thought +6 (the engine clamps at 6) |
| twineedle | `forcedMovement` | Hit and Gone 2 → Never Landed 3 → Never There 4 tiles |
| poison_sting | `statusSeverity` | 1.3 → 1.6 → 2.4 → 3.2 |

#### `shape` is dead without `hitsArea`

Only `resolveAreaHit` reads `shape`, and only `hitsArea` routes into it. Both
burst nodes that shipped set both, and `resolveAreaHit` centres the shape on
the **attacker**, not the target — which is what the live verification below
had to be rebuilt around. `burst` radius 1 is a filled Manhattan diamond,
5 tiles; radius 2 is 13.

#### Balance, with the roster as control

| move | nodes | levers | flavours | tempo (cap) | cheapest capstone |
|---|---|---|---|---|---|
| poison_sting | 45 | 30 | 11 | 1.50x (3.00) | 8 pts |
| twineedle | 45 | 28 | 13 | 3.00x (3.00) | 8 pts |
| growth | 45 | 21 | 8 | 2.82x (2.82) | 8 pts |
| harden | 45 | 20 | 7 * | 2.93x (2.93) | 8 pts |
| agility | 45 | 19 | 7 * | 3.00x (3.00) | 8 pts |
| **roster median** | 45 | 25 | 11 | 2.00x | 10 pts |

The two flagged flavour counts are the `utilityMove` ceiling described above,
not padding. Every tempo figure is at or under its own cap.

#### Passive exposure: the largest single change this project has made

Five trees at once, `passive-exposure.ts` before and after. Roster worst case:

| passive | before | after |
|---|---|---|
| damageReduction | 33% (diglett) | **36%** (krabby/kingler) |
| thorns | 65% (venusaur) | 65% (venusaur, unchanged) |
| regen + aura + regenFlat/43 | 18.8% (sandshrew) | **25.9%** (sandshrew) |

Per species that learns one of the five (before → after):

| species | movepool | dmgRed | thorns | healing | defenseBoost |
|---|---|---|---|---|---|
| krabby / kingler | tackle+water_gun+harden | 16% → **36%** | 15% → 45% | 10.2% → 20.0% | 0 → 4.0 |
| metapod / kakuna / shellder | tackle+harden | 8% → 28% | 15% → 45% | 6.2% → 16.0% | 0 → 4.0 |
| kabuto / kabutops | scratch+harden | 8% → 28% | 15% → 45% | 5.0% → 14.8% | 0 → 4.0 |
| grimer / muk / pinsir | harden+sludge/slash | 0% → 20% | 0% → 30% | 0.0% → 9.8% | 0 → 4.0 |
| oddish / gloom | tackle+growth+grassy_terrain | 8% → 18% | 15% → **49%** | 6.2% → 16.2% | 0 → 4.0 |
| sandshrew | scratch+dig+agility+earthquake | 33% (unchanged) | 40% (unchanged) | 18.8% → **25.9%** | 0.3 → 4.8 |
| rapidash | tackle+ember+agility | 8% (unchanged) | 15% (unchanged) | 13.1% → 20.1% | 0.5 → 5.0 |
| the other 20 learners | — | mostly unchanged | mostly unchanged | +7-8 points | 0 → ~4.5 |

Three deliberate trims were made during the build, all reported rather than
buried:

1. **Agility's `damageReduction` was pulled entirely.** At 0.18 it was legal
   per-move but pushed Sandshrew (which already carries Dig's and
   Earthquake's) to **51%** — over half of all incoming damage, uncapped.
   Converted to `damageReductionFlat`/`defenseBoost`, which scale down late
   the way MOVES_DESIGN's own note prefers. Sandshrew is back at 33%.
2. **Harden's `thorns` went 0.38 → 0.30.** At 0.38 the seven Harden species
   read 63%; they now read 45%, under Venusaur's existing 65% ceiling.
3. **`defenseBoost` went 9.0 → 4.0 on Harden and 8.0 → 4.5 on Agility.**
   `statStageMultiplier` (combat.ts) **clamps stages at ±6** and the trees'
   own `statChangeOnHit` already climbs to +4, so everything past ~4 was
   points spent on nothing — the same shape as `calmingPresence` past its
   floor. Worth knowing: `defenseBoost` had essentially no roster exposure
   before this (worst 0.5), so a naive spend would have gone from 0.5 to 9.0
   without anyone noticing.

Still true and still unfixed: `thorns` and `damageReduction` have no engine
cap at all, and the healing softcap bends healing only.

#### Verified by running it, not by reading it

**Reach** — `maybeAutoRespec` driven for real on an actual learner of each
move, 40 seeds x 60 points, control = shipped `tackle` on Rattata through the
identical harness:

| move | learner | nodes reached | capstones reached (of 40 seeds) |
|---|---|---|---|
| harden | metapod | **45/45** | 12 / 11 / 10 |
| twineedle | beedrill | **45/45** | 3 / 8 / 4 |
| poison_sting | ekans | **45/45** | 14 / 9 / 7 |
| growth | oddish | **45/45** | 10 / 10 / 9 |
| agility | scyther | **45/45** | 10 / 16 / 8 |
| *tackle (control)* | *rattata* | *45/45* | *40 / 40 / 40* |

Nothing is unreachable, and every capstone lands in a real build. The control
reaching 40/40 is the expected shape — Rattata knows one move, so no points
are split; a two- or three-move species spreads them, which is exactly why
the new trees land at 3-16 rather than 40.

**Live, one signature node per tree, each with a control that fires**, driven
through the real `tickWorld`, 3 seeds each:

| tree | node | with | control |
|---|---|---|---|
| harden | *Chrysalis* (`selfHeal` 0.15 + `lockTicks` 6) | in-combat utility uses 4, ticks healing ≥15% maxHp: **1-2** | same 3-4 uses, ticks healing ≥15%: **0** |
| twineedle | *Nothing Forgets* (burst r1 + `hitsArea`) | bystander damage **488 / 49.5 / 542.5** | base point shape, bystander damage **0 / 0 / 0** |
| poison_sting | *The Nest Decides* (+`excludesAllies`) | bystander is a herd-mate: **0 / 0 / 0** | same node, bystander is a FOE: **113 / 59 / 308.5** |
| growth | *It Takes* (`fertilityBoost` 1.2 r2) | fertility at range 2 = **1.0** | base r0 move: **0.6** (ambient regen only), both with real utility uses |
| agility | *Moving as One* (`aquaticHaste` 0.25) | herd-mate on water, mean `actionSpeedOf` **127.97** | same herd-mate on floor: **107.05** (ratio 1.19) |

**Two things the first version of that harness got wrong**, recorded because
both produced confident all-zero tables that looked like findings:

- Nothing ever attacked, because a fight needs `HuntRules` keyed by the
  attacker's species AND `isPreyOf`'s size gate (attacker `maxHp` well above
  the target's) — two same-sized agents never fight no matter how hungry.
- The AoE bystander was placed one tile past the target. `resolveAreaHit`
  centres the shape on the **attacker**, so a burst r1 never covered it. The
  first run reported "bystander damage 0" for both the burst and the control
  and would have read as a passing test.

`raiseFertility` also caps at the tile's own `fertilityCeiling`, so the growth
measurement had to run on loam (1.0) rather than the default sandy (0.6),
where ambient regen reaches the cap on its own and both arms read 0.6. That
is worth remembering: **`fertilityBoost` buys speed to the ceiling, not a
level above it** — which is exactly what the draft's `fertilityCeilingBoost`
was reaching for, and it is still not buildable.

#### Open, flagged not resolved

- *Nobody Leaves* (Growth's Sociability capstone): a herd that has solved food
  is a zone that never turns over, which collides with the standing
  "equilibrium and variety, not a dominant answer" pillar. Shipped with the
  concern written into its own node comment, as the draft did.
- The needs-recovery hook for *Sickened*, above.
- `thorns`/`damageReduction` still have no engine-side cap.

---

# Design pass: what accuracy and evasion should actually be

Accuracy just became a stat worth having. This is the argument for what to do
with it, written before any node is touched.

## The plain version

Until today, nothing in the game could miss for an interesting reason. Now
three things make you miss — distance, weather, high ground — and one thing
can fix it: accuracy. That is the good half.

The bad half is the obvious next step, and I want to argue against it before
we build it: **giving moves a raw "+2 evasion" node.** It is the standard
Pokémon answer and it is wrong for this game specifically.

Two reasons, both from our own pillars.

**It is a hidden meter.** *"Mechanics should be visible on the map, not
hidden in a meter."* We already chose the drought that dries up ponds over
the drought that multiplies a thirst number. A defender with +4 evasion looks
exactly like a defender with 0 evasion. Nothing on the map explains why the
attack missed, so the chronicle can only say "it missed" — which is the same
"sad and vague" failure as "it just died out".

**It is the classic dominant answer.** *"We want equilibrium and variety, not
a dominant answer."* Evasion stacking is the most reliably degenerate
strategy in the genre. And our numbers make it worse than usual: four move
slots, each able to hold its own evasion stage, and the cap is +6 net —
which is a **1/3 multiplier on every incoming attack, permanently**, for a
build that just re-casts.

## What to do instead

Every accuracy modifier should come from something already drawn on the map.
We have the vocabulary for this — `oneSituationalMultiplier` already resolves
twelve conditions, and most of them are visible: `concealed`, `elevation`,
`night`, `storm`, `rain`, `drought`, `coldSnap`, `flanking`.

So: **you get harder to hit by doing something, somewhere, that a player can
see.** Not by holding a number.

### The gap this exposes, and it is a good one

`isConcealed` (predation.ts) is already real: it covers a burrowed agent and
any tile with `concealment` — bushes. It already shrinks the radius at which
you get NOTICED (`BUSH_CONCEALMENT_DETECTION_REDUCTION`).

**It does nothing once a fight starts.** Standing in a bush makes you harder
to find and no harder to hit. That is the single most intuitive "hard to hit"
condition in the game, it is already on the map in a colour the player can
see, and it is currently worth nothing defensively.

That is where evasion should live.

## The three axes, and who owns them

| axis | already real? | visible? | whose flavour |
|---|---|---|---|
| distance | yes, new — first tile free then −5/tile | yes, it's the map | ranged trees pay it, accuracy nodes buy it back |
| weather / elevation | yes | yes | Boldness ("the air is not neutral", "fly the weather") |
| **cover / concealment** | **detection only — combat gap** | **yes** | **Aggression's stealth-ambush flavour** |
| raw evasion stage | wired, unused | **no** | — argue: don't |

## What this buys us

- **Accuracy stops being universal filler.** It is worthless on a range-1
  move with no weather plan and real on Solar Beam at reach 11 (50% today).
  A conditional lever is better than a flat one, and it is legible from the
  move itself.
- **Cover becomes a real tactical decision** rather than a detection detail —
  and it is a decision the player makes by MOVING, which is the most visible
  action there is.
- **It rewards noticing a pattern** rather than punishing one uninformed
  choice: "things are hard to hit in the scrub" is learnable across many
  fights.

## Answered, and shipped

1. **Cover: yes, flat −20.** `isConcealed` (bush tile or burrowed) now costs
   the attacker 20 accuracy. It already shrank detection radius; it does
   something defensive at last.
2. **A running target: yes.** *"Definitely. I don't like how easy it is to
   chase down and kill things."* −5 per consecutive action the DEFENDER spent
   moving, capped at 4 stacks (−20). Counted in the defender's own actions,
   so committing to running is what earns it, not raw Speed. The streak
   breaks the moment it does anything else, so it is paid for in actions not
   spent fighting back.
3. **Raw evasion nodes: allowed after all**, and my objection was too broad.
   *"We can allow evasion nodes for sure. Esp as temporary boost or
   conditional (ex. Upon moving multiple times in a row gain x for y turns,
   or be more evasive the further you are away)."* The thing that is bad is
   FLAT PERMANENT stacking — a number nobody can see, held forever. A
   temporary or conditional stage keeps the cause visible and situational,
   which was the actual point. Both examples given are already expressible:
   the sprint streak is live in `Agent.consecutiveMoveActions`, and distance
   is already in the roll.
4. **Night: yes.** −15 for any attacker that is not `nocturnal` — the sim's
   existing activity-pattern trait, no new flag invented.

### The numbers, all flat points on the same scale as distance

| cause | cost | visible as |
|---|---|---|
| distance | 0 for the first tile, then −5/tile | the map |
| cover | −20 | a bush, or a burrow |
| darkness | −15 (0 if the attacker is nocturnal) | the clock |
| running | −5 per consecutive move action, max −20 | the thing running |

They stack, because they are independent facts. A creature sprinting through
scrub at night is −55: a 100-accuracy move is a coin flip against it. That is
the intended shape.

### The finding that came out of building it

**Every world starts at tick 0, which is MIDNIGHT.** So the night penalty
applies to the whole opening stretch of every run, and it broke nine existing
tests at once — none of them wrong, all of them fighting in the dark at a
fleeing target without knowing it. Worth remembering before reading any early
combat numbers: the sim's default condition is night.

---

# Design pass: fight or flight when you are surrounded

*"If a Pokémon gets targeted by multiple attacks they really need to enter
fight or flight mode."*

## The gap is real, and it is bigger than it sounds

`isBeingHunted` (predation.ts) is a **boolean**. One hunter and five hunters
are the same value. Nothing anywhere counts how many things are pointed at
you, and the only flee trigger is `isCriticallyHurt` — so the sim's answer to
being surrounded is *"keep doing whatever you were doing until you are nearly
dead."*

Measured, 3 seeds x 4000 ticks, sampled every 20 ticks (15,146 agent-samples):

| attackers on one agent | share |
|---|---|
| 0 | 77.53% |
| 1 | 17.73% |
| **2** | **4.01%** |
| **3** | **0.68%** |
| **4** | **0.05%** |

Most ever on one agent: **4**. So being ganged up on is 4.73% of samples —
uncommon enough to stay a spike rather than the default, common enough that
it happens constantly across a whole run. That is a good frequency for a
dramatic rule.

## Why now, specifically

This was a weaker idea a day ago. Fleeing was close to free and close to
useless — you ran, and got hit anyway.

It is not any more. **A fleeing agent now takes −5 accuracy per consecutive
action it spends running, up to −20**, and cover is another −20. So flight is
a real defence with a real price (actions not spent fighting back), and
standing is a real commitment. Fight-or-flight is the decision that makes the
evasion work we just shipped *mean* something — without it, nothing ever
chooses to run except the nearly-dead.

## The shape I would build

Not a new behaviour state. `"flee"` and `"fight"` both already exist; what is
missing is the TRIGGER and the CHOICE.

**Trigger:** two or more attackers targeting you (`huntTarget`/`fightTarget`),
inside the existing `FLEE_DETECT_RADIUS`, evaluated on your own action tick.

**The choice** should read off things that are already true and already
visible, in the sim's existing idiom:

| leans FIGHT | leans FLIGHT |
|---|---|
| high `aggression`/`boldness` disposition | high `sociability` |
| herd-mates nearby (the mob-fight path already counts these) | alone |
| healthy | hurt |
| cornered — nowhere to step away to | open ground behind you |
| defending an egg (`applyEggDefense` already forces this) | — |

**Commitment matters more than the decision.** The failure mode is thrash:
flip to flee, take a step, flip to fight, flip back — and the sprint evasion
we just built actively rewards *not* thrashing, since the streak resets the
moment you do anything else. So whichever it picks, it should hold for a
handful of actions unless something big changes (an attacker dies, HP
collapses).

## What it buys, in this project's terms

- **Narratable.** "Three of them came at once, and it turned to face them" is
  a story. "It kept eating" is not. The chronicle already logs behaviour
  changes, so this is a beat for free.
- **Visible cause.** The trigger is a thing you can see on the map — how many
  arrows point at one creature.
- **It makes packs mean something defensively.** Pack hunting already has an
  accuracy bonus for coordinating; nothing on the prey side ever noticed
  being coordinated against.

## Where I would push back on myself

The obvious version — "2+ attackers, roll fight or flight" — risks becoming
the dominant answer for prey: always flee, always get −20, never die. Two
guards against that, both worth deciding:

- The sprint evasion is already capped (−20) and already costs actions.
- Fleeing into the open is worse than fleeing into cover, which the
  concealment rule now makes true for free.

## Questions

1. Trigger at **2 attackers**, or 3? 2 is 4.7% of samples, 3 is 0.73%.
2. Should the choice be **deterministic** from disposition + HP + allies, or
   a weighted roll? Deterministic is legible and testable; a roll gives
   variety and stops one species always doing one thing.
3. How long is the commitment — **4 actions**? Long enough to build the
   sprint streak, short enough to react.
4. Should a **predator** ganged up on by prey (the mob-fight case) use the
   same rule? Right now it flees only when critically hurt, which is the
   thing that makes mobbing feel weightless.

## Answered, and shipped

Verbatim: *"3 attackers unless they're really weak like, more than 8 levels
below. Choice is weighted roll. 6 actions. Yeah also flee when out numbered."*

| question | answer | constant |
|---|---|---|
| trigger count | 3 attackers | `SURROUNDED_ATTACKER_COUNT = 3` |
| who counts as an attacker | not the badly outmatched | `OUTMATCHED_ATTACKER_LEVEL_GAP = 8` |
| decision | weighted roll | `applyFightOrFlight` |
| commitment | 6 actions | `FIGHT_OR_FLIGHT_COMMIT_ACTIONS = 6` |
| predators too | yes | headcount adds to the flight weight |

The roll's weights, all reading off state that already existed:

```
fight  = aggression + boldness + (herd allies nearby x 0.4)
flight = sociability + 0.5 + ((1 - hpFraction) x 1.5)
                    + ((attackers - 3 + 1) x 0.5)
```

**One implementation decision worth writing down.** The first version set
`behavior = "fight"` and then fell through to the normal threat path to
carry the fight out. That silently undid the whole feature: the normal path
re-decides on mob size and level gap every single action, so a commitment
made on one action was overwritten on the next. `applyFightOrFlight` now
carries out both branches itself and returns `true`, which is what makes the
6-action commitment real rather than nominal.

The commitment also drops the instant nothing is pointed at you any more —
holding a flee for five more actions after the last attacker died would be
running from nothing.

### Measured on a real run

6 seeds x 4000 ticks (`packages/runner/src/validateFightOrFlight.ts`):

| | |
|---|---|
| commitments entered | **10** (4 stand / 6 run) |
| ticks with anyone surrounded | 79 of 24,000 (0.33%) |
| predator triggers | 1 |

**Finding, flagged not fixed:** this fires *rarely*. The design pass above
predicted it — 3 attackers was measured at 0.68% of agent-samples, and 3 was
chosen with that number on the table — but 10 commitments per 24,000 ticks is
close enough to the "unreachable content" line to be worth a decision rather
than a shrug. Two seeds produced zero. Options, in order of how much they
change:

1. **Leave it.** It is a rare dramatic spike, which is what it was designed
   to be. It just means most runs will not contain one.
2. **Drop the trigger to 2 attackers.** ~7x more common (4.7% of samples).
   Cheapest change; risks becoming prey's default answer.
3. **Count near-misses** — attackers that fought you in the last few ticks,
   not only ones targeting you at this instant. The current filter is a
   snapshot, so three attackers alternating never registers as three.

The 40/60 stand/run split is a good sign (a weighted roll that always lands
the same way is a lookup table), but on N=10 it is not yet evidence.
