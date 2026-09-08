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

**Shipped** — see DESIGN.md's "Status effects: burn, poison, paralysis, sleep, freeze" section for the full writeup (data model, application, resolution, confirmed working end-to-end). Kept here only as a pointer: the roster currently has real inflicters for burn only (Ember/Flamethrower); paralysis/poison/sleep/freeze coverage is real content for whichever future move actually causes one — Vine Whip's designed Constrict node (a `"root"` effect, not one of the five kinds modeled yet) is the natural next case, not Thunder Wave/Poison Sting (inventing moves not yet in the curated roster, which the original draft here suggested — narrowed to "a move already being built" instead).

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

### Tackle (Normal, point/melee) — Utility archetype, full treatment

**Shipped as v2** — three branches plus a crosslink triangle:

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
  `species.ts`'s own comment on that).
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
