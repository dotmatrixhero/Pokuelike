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

Vine Whip proved the v2 template. **Tackle, Slash, and Ember have all now
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

- **Rock Throw** (Rock, line-3, cooldown 1) — Onix's second move, alongside
  Tackle.
  - **Aggression — "Landslide"**: opener *Heavy Stones* (+power, -accuracy)
    → filler → filler → notable *Crushing Weight* (`defensePenetration`)
    → filler → **fork**: *Overhand Heave* (+power, `selfCostPerUse` energy
    — an all-out throw that costs the thrower something real every time)
    vs. *Measured Toss* (+accuracy, no cost — a controlled, sustainable
    throw) → notable *Skyfall* (`bonusVsType` vs. Flying — a rockslide is a
    real answer to anything with wings) → filler → **keystone** *Cave-In*
    (+power, heavy `critRateStage`).
  - **Boldness — "Bedrock"**: opener *Bedrock Stance* (`damageReduction`
    passive) → filler → notable *Unshakeable* (`immovable` passive) →
    filler → **fork**: *Aftershock Counter* (bonus vs. a flanking target)
    vs. *Granite Ward* (+accuracy, more `damageReduction`) → notable
    *Fracturing Blow* (`statChangeOnHit` target Defense -1 — repeated
    braced throws crack the target's own guard, not the user's) → filler →
    **keystone** *Bedrock Breaker* (`resistanceBreaker`).
  - **Sociability — "Tremor Call"**: opener *Tremor Signal* (`targetsAlly`
    defense buff) → filler → filler → notable *Seismic Rally*
    (`targetsAlly` attack buff) → filler → **fork**: *Bulwark Coil*
    (`damageReduction`, -power) vs. *Vanguard Tunneler* (+power,
    `jamCooldownTicks`) → notable *Colony Watch* (`regen` passive) →
    filler → **keystone** *Seismic Lockdown* (heavy `jamCooldownTicks` — a
    denial capstone, not a heal: the ground itself won't let enemies
    recover their tempo).
  - **Crosslinks**: *Grinding Advance* (Aggression↔Boldness,
    `statChangeOnHit` self-buff off a braced throw) · *Warning Tremor*
    (Boldness↔Sociability, shared `damageReduction`) · *Rolling Thunder*
    (Sociability↔Aggression, `lockTicks` — a combined tremor-and-throw big
    enough to lock the user out of its next tick, not just another
    situational bonus).

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
    damageReduction/jamCooldown template reused everywhere else.
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
"scratch every time" failure mode this process exists to avoid. Sanity-
check any template edit the same way this process itself was verified:
run the two build steps and confirm the output's embedded JSON still
parses and every node still has a `leaning` (a quick Python/Node one-
liner, same as this file's own move-tree redesigns were checked before
publishing).

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
