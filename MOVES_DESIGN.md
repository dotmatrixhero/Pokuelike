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
| Multi-hit (`MoveSpec.hits: {min,max}` + `combat.ts`'s `rollHitCount` looping in `predation.ts`) | Frenzied Pecking, Frenzy Claws, Rapid Volley/Jets, Frenzy Cutter — half the "Aggression" forks drafted below | **Shipped** — confirmed in a real fight: 3 separate `fought` events from one move use, stopping early on a mid-flurry true death. Also folded into `pickBestMove`'s scoring (average hit count). Not yet used in a shipped tree |
| Defense-penetration delta field (`MoveSpec.defensePenetration`) | Piercing Beak | **Shipped** — `combat.ts`'s `calculateDamage` shaves the fraction off Defense/SpDefense before stages apply. Not yet used in a shipped tree |
| Forced movement (drag/knockback/lunge/retreat as part of a move) | Verdant Grip, Retreat Peck, Knockback Spray, Retreating Current, and most of Vine Whip's keystones | **Shipped** — see DESIGN.md's "Forced movement" section. First real content: Tackle's `bracing_impact` (onHit knockback) and Slash's `feint` (beforeHit lunge), both confirmed reached in a real run. Doesn't cover U-turn/Volt Switch's sustained multi-tick retreat — a different mechanism, still not started |
| Multi-action lock (`MoveSpec.lockTicks` + `Agent.actionLockTicks`) | Reaping Slash (both Tackle's and Slash's) | **Shipped** — `useMove` (combat.ts) sets the lock, `tickStatusEffects` (status.ts) counts it down, `tickAgentAction` (needs.ts) blocks all action while it's active, same shape as fainted/asleep/frozen. Not yet used in a shipped tree |
| Agent-modifying passive (a tree node whose effect targets `Agent`, not `MoveSpec`) | Brace for Impact, Immovable, Overgrowth, Living Trellis | **Shipped** — `MoveTreeNode.grantsPassive` (moves.ts), applied by `maybeAutoRespec` (leveling.ts) into `Agent.passives`. Three real, wired kinds: `damageReduction` (a flat fraction off incoming damage, `resolveHit`), `immovable` (blocks being dragged/knocked back/lunged at, `applyForcedMovement`), `regen` (per-tick heal independent of being fed/watered, `tickStatusEffects`). Not yet granted by a shipped tree node — the mechanism is confirmed via unit tests, not real content yet |
| Conditional/situational bonuses (concealment, day/night, elevation, weather, target status) | Predator's Instinct, Ambush Claws/Dive, Night Hunter, Fan the Flames, Coup de Grace | **Shipped** — `MoveSpec.situationalBonus` (predation.ts's `situationalMultiplier`) now covers `"targetLowHp"`, `"flanking"`, `"night"`, `"elevation"` (attacker's tile strictly higher than the defender's), `"concealed"` (attacker standing in a bush), `"coldSnap"`/`"storm"`/`"drought"`/`"rain"` (weather.ts's `activeWeatherAt`/`isInColdSnap` at the attacker's position), `"targetBurning"` (`isBurned(defender)`), and `"targetStatused"` (any status at all, not just burn — deliberately generalized past a single status kind so it isn't just a burn-only condition wearing a different name). "Was just hit"/"moved this tick" still aren't wired — no move drafted here needs them yet |
| Weight-scaled bonus damage (`MoveSpec.weightScaling`) | Weighted Charge | **Shipped** — `predation.ts`'s `applySingleDamageInstance` adds `factor * attacker.maxHp` (this sim's size/weight proxy, same one `powerOf` already uses for predation eligibility) as bonus power before the damage formula runs. Not yet used in a shipped tree |
| Per-move crit-rate stage (`MoveSpec.critRateStage`) | Any "this move crits more often" notable | **Shipped** — passed straight into `combat.ts`'s existing `rollCritical(stage)` from `applySingleDamageInstance`, instead of always rolling stage 0. Not yet used in a shipped tree |
| Lifesteal / recoil (`MoveSpec.lifestealFraction`/`recoilFraction`) | Any "trade your own HP for damage, or heal off it" notable | **Shipped** — both apply as a fraction of the actual damage dealt, in `applySingleDamageInstance`; lifesteal caps at the attacker's own max HP, recoil floors at 1 HP (a recoil move can hurt the user badly but never faints it outright — that's a separate, deliberate design choice, not an oversight). Not yet used in a shipped tree |
| Thorns / heal-aura passives (`PassiveKind` `"thorns"`/`"healAura"`) | A defensive-notable branch that punishes attackers, and a support passive that heals nearby herd-mates (not just the holder) | **Shipped** — `thorns` reflects a fraction of incoming damage back onto the attacker (`thornsOf`, applied in `applySingleDamageInstance`, floored at 1 HP same as recoil); `healAura` heals every living, same-herd, same-layer agent within a fixed radius each tick (`applyHealAuraPassive`, `status.ts`'s `tickStatusEffects`), the holder included — the first passive that isn't purely self-targeted. Both usable via the existing `grantsPassive`/new `grantsPassives` (plural) node field. Not yet granted by a shipped tree node |
| Cooldown-jamming (`MoveSpec.jamCooldownTicks`) | A "denial" notable that punishes the defender's own tempo | **Shipped** — on a landed, non-killing hit, bumps every entry already in the defender's `moveCooldowns` map by the configured amount (`resolveHitAgainstTarget`) — it extends existing cooldowns, it doesn't put an off-cooldown move on cooldown from nothing. Not yet used in a shipped tree |
| Type-matchup levers (`MoveSpec.bonusVsType`/`resistanceBreaker`) | A "specialist" notable (extra damage vs. one type) and a "the target's resist barely helps" notable | **Shipped** — `bonusVsType` multiplies final damage when the defender has the named type (`combat.ts`'s `calculateDamage`, also folded into `pickBestMove`'s scoring); `resistanceBreaker` claws a resist (0 < effectiveness < 1) back up toward neutral, multiplicatively, capped at 1 — it can partially cancel a resist, it can never turn one into an actual weakness. Not yet used in a shipped tree |
| Needs-based per-use cost (`MoveSpec.selfCostPerUse`) | A "powerful but exhausting" notable that costs the user energy or hunger to use, not just a cooldown | **Shipped** — deducted from the attacker's own `needs[need]` once per use, floored at 0 (`resolveHit`, alongside the existing `useMove` cooldown-setting call). Not yet used in a shipped tree |
| Move-caused terrain change (`MoveSpec.terrainBurn`) | A fire move that burns down a bush the target was hiding in | **Shipped** — on a landed, non-killing hit, reverts a `"bush"` tile the defender stands on to plain floor (`resolveHitAgainstTarget`, via `world.ts`'s `setTile`) — the target loses its concealment as a side effect of getting hit, not a separate mechanic. Not yet used in a shipped tree |
| Status spreading to a nearby agent (`MoveSpec.statusSpreads`) | A "the fire/poison catches on whoever's standing next to the target" notable | **Shipped** — once the primary status lands, rolls a second, independent chance (`status.ts`'s `maybeSpreadStatus`) to inflict the *same* status on one other living, same-layer agent within a small radius — a plain distance scan kept local to `status.ts` on purpose, to avoid a real import cycle with predation.ts. Not yet used in a shipped tree |
| Multi-passive nodes (`MoveTreeNode.grantsPassives`, plural, alongside the existing singular `grantsPassive`) | A single notable that grants two passives at once (e.g. Alpha Strike's fix: bonus damage *and* damage reduction, not just one) | **Shipped** — `leveling.ts`'s `maybeAutoRespec` applies both the singular and, when present, every entry of the plural array. Not yet used in a shipped tree |
| Self-state-aware scoring (a bonus keyed to the *user's own* HP, not the target's) | Cornered Fury | **Shipped** — `MoveSpec.selfStateBonus` (`"selfLowHp"`), folded into `pickBestMove`'s scoring (combat.ts). Not yet used in a shipped tree |
| Real-duration temporary buffs (a stat change that expires after N ticks) | Bubble Shield, Slippery Current | **Shipped** — folded into the same mechanism as persistent stat stages below (`Agent.statStages` entries with `ticksRemaining` set expire; without it, they're permanent) — one array, two lifetimes. `MoveSpec.statChangeOnHit`'s optional `ticks` field drives this from a move. Not yet used in a shipped tree |
| Position-swap (two agents exchange tiles in one action) | Bodyblock | **Shipped** — `MoveSpec.positionSwap`, resolved in `resolveHitAgainstTarget` (predation.ts) on a landed, non-killing hit only. Not yet used in a shipped tree |
| Cross-agent effects (a move's hit affects an ally, not just the target) | Vine Link, Nurturing Vines, Rally Charge, Warning Lash | **Shipped** — `MoveSpec.targetsAlly`/`allyEffect` (heal and/or buff), resolved by `applySupportMove` (support.ts) from the agent's own idle/support tick — a genuinely separate path from `resolveHit`'s hostile resolution, as this doc's own "why status effects and environmental moves are two different systems" section predicted a cross-agent effect would need. Not yet used in a shipped tree |
| Multi-target/AoE resolution (apply a move to every agent within its resolved shape, not one target) | Growl (its entire premise), Firestorm, Ring of Fire's full fantasy, Boulder Toss/Skipping Stone | **Shipped** — `MoveSpec.hitsArea`, resolved by `resolveAreaHit` (predation.ts): facing derived from attacker->primary-target direction, `resolveShape` finds every living agent in the move's footprint, each gets its own accuracy roll and damage instance; only the deliberately-picked primary target gets status/stat-change/forced-movement/position-swap hooks, incidental targets just take the raw hit. Confirmed in a real fight: a ring-shaped move centered on the attacker landed on both the picked target and an unrelated bystander standing on the same ring. Growl itself still isn't built — see below |
| Persistent stat stages (`Agent`-level Attack/Defense/etc. modifiers, settable by a move, lasting until cured — distinct from burn's one-off computed halving, which just derives a stage from `agent.status` fresh at each `calculateDamage` call rather than storing one) | Growl specifically (`statStageMultiplier` already exists in combat.ts as a pure function; burn now calls it, but from a computed value, not a stored `Agent.statStages` field) | **Shipped** — `Agent.statStages` (an array of `{stat, stage, ticksRemaining?}` entries, `status.ts`'s `applyStatStage`/`getStatStage`), fed into `calculateDamage`'s existing stat-stage machinery for both attacker and defender, and composing additively with burn's own -2 Attack. `MoveSpec.statChangeOnHit` is the move-level lever: `target: "self"` applies the instant the move is used, `target: "defender"` only on a landed, non-killing hit. **Growl itself is still not built** — it needs this primitive plus multi-target/AoE (both now shipped) plus a no-damage/status-move representation, which remains the one open piece |
| Status-effect system (burn/poison DOT, paralysis/sleep/freeze) | Ember's/Flamethrower's burn chance, previously idle | **Shipped** — see DESIGN.md's "Status effects" section. Constrict's designed root effect still needs a sixth `StatusKind` (`"root"`), not modeled yet |

Every primitive on this list is now shipped and unit-tested (a 4000-tick full-sim run with the extended roster confirms no regressions). What's left is real content: no shipped move tree grants a passive, uses multi-hit, defense penetration, a situational/self-state bonus, position-swap, an ally-targeting effect, weight scaling, lifesteal/recoil/thorns/heal-aura, cooldown-jamming, a type-matchup lever, a needs-based cost, terrain burn, status spread, or an AoE shape yet — and Growl itself still needs a no-damage/status-move representation (nothing in this sim can currently be "used" without a damage roll) before it can actually be built.

The one deliberately-deferred item from the lever brainstorm below: a real
Max PP resource (a per-move use counter, need-gated regen, AI awareness of
running dry) — a whole new resource axis, not a `MoveSpec`/`MoveTreeNode`
delta field like everything above, so it's its own follow-up project rather
than something to fold in here. `selfCostPerUse` (shipped above) covers the
"costs something to use" fantasy via the sim's *existing* needs axes in the
meantime.

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

A hand-curated `ENVIRONMENTAL_EFFECT_BY_MOVE` table (packages/data, same
pattern as the status one) maps real moves to effects. First batch, in
recommended build order (cheapest/safest first — each reuses something
that already exists):

| Move (real) | Effect | What it touches |
|---|---|---|
| Sunny Day | Plants a temporary `sunbeam` tile at the caster's position | flora.ts's `isNearSunbeam`/`FOOD_CHANCE_NEAR_SUNBEAM` — zero new terrain code |
| Dig | Instantly crosses the user to the layer below, at the same (x,y) | Reuses the existing cross-layer mechanic (needs.ts) as an emergency escape |
| Leech Seed | Transfers a fixed amount of hunger/thirst from target to caster | Direct `Needs` field manipulation — the one genuinely new mechanic (resource transfer between two agents) |
| Growth | Force-matures a nearby `seedling` early, or shortens its `MATURATION_TICKS` | Direct hook into flora.ts's existing growth timer |
| Water Gun | Converts an adjacent dry `floor` tile into a temporary puddle | New but minimal — a short-lived stock-bearing water tile |
| Ember (opportunistic, not on-hit) | Burns an adjacent `flora`/`food` tile back to `floor` | Real terraforming, double-edged (clears a blocker, destroys a resource) |

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

**Every node has a `leaning`.** Unleaned nodes still work (weighted
neutrally in `maybeAutoRespec`) but a tree that's all unleaned wastes the
whole point of tying this to Disposition — tag deliberately.

**Real tradeoffs, not strictly-better stat sticks.** A tier that's just
"more of everything for a point" isn't a choice, it's a formality — every
node should cost something (accuracy, cooldown, power, range) even when
small.

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

### Rock Throw (Rock, line-3, cooldown 1) — Power archetype, Onix

Heavy Stones (+power, -accuracy, live) → filler → *Longer Throw* (range +1,
live) → filler. **Final fork**: *Boulder Toss* (shape → small burst at the
impact point, +power, needs: AoE resolution) vs. *Skipping Stone* (line +1,
pierces everything in the path, -power, needs: AoE resolution for the
piercing-hits-everyone part, though the plain reach increase is live).

### Peck (Flying, point) — Utility archetype, Spearow, 2 branches

- **Aggression — "Sharp Strike"**: Needle Point (+power, live) → filler →
  *Frenzied Pecking* (2 hits, needs: a new `hits` field plus combat.ts
  rolling damage N times — corrected from an earlier "live" tag; multi-hit
  needs real schema growth, not just a delta on existing fields, same as
  every other item in this list past the first six). **Fork**: *Piercing
  Beak* (+power, ignores some of the target's Defense — needs: a new
  defense-penetration delta field) vs. *Rapid Volley* (3 hits, needs: same
  multi-hit field as Frenzied Pecking).
  **Keystone**: *Talon Strike* — bonus power/crit against a fleeing target
  (needs: defender-state-aware scoring, the same gap flagged in DESIGN.md's
  "Move selection" section).
- **Boldness — "Dive Strike"**: *Swooping Approach* (bonus power/accuracy
  if the user moved toward the target this tick before attacking, needs:
  movement-context-aware) → filler → *Retreat Peck* (retreats 1 tile
  immediately after landing a hit, needs: forced movement). **Fork**:
  *Ambush Dive* (bonus vs. a target that hasn't detected the user yet, near
  — reuses concealment/detection) vs. *Harrying Wings* (-cooldown, -power,
  live). **Keystone**: *Relentless Harrier* — chains directly into another
  action without waiting for the normal action-energy threshold (needs:
  action-economy interaction).

### Scratch (Normal, point) — Utility archetype, Sandshrew, 2 branches

- **Aggression — "Claw Strike"**: Sharpened Claws (+power, live) → filler →
  *Frenzy Claws* (2 hits, needs: multi-hit field). **Fork**: Shredding Blow
  (+power, -accuracy, live) vs. Flurry (3 hits, needs: multi-hit field).
  **Keystone**: *Sandstorm
  Claws* — bonus power/status specifically at night (near — reuses
  daynight.ts, matches Sandshrew's nocturnal `activityPattern`).
- **Boldness — "Burrow Strike"**: *Ambush Claws* (bonus power attacking
  from concealment, near) → filler → *Dig-and-Strike* (briefly reposition
  to an adjacent tile right after hitting, needs — foreshadows the
  already-backlogged Dig-to-escape move). **Fork**: *Retreating Slash*
  (retreats 1 tile after hitting, needs: forced movement) vs. *Cornered
  Fury* (+power while the user itself is at low HP, needs: self-state-aware
  scoring). **Keystone**: *Night Hunter* — full power/accuracy bonus during
  Sandshrew's nocturnal active hours (near — reuses daynight + activityPattern).

### Water Gun (Water, line-2) — Utility archetype, Squirtle, 2 branches

- **Aggression — "Pressurized Blast"**: High Pressure (+power, live) →
  filler → *Piercing Jet* (line +1, live). **Fork**: Torrent (+power,
  +cooldown, live) vs. Rapid Jets (2 hits, needs: multi-hit field).
  **Keystone**: *Deluge* —
  bonus power while the user is near a water tile (near — reuses the
  existing water-resource-tile concept).
- **Boldness — "Evasive Spray"**: *Knockback Spray* (pushes the target back
  1 tile on hit, needs: forced movement) → filler → *Retreating Current*
  (the user may immediately retreat after using this move, needs: forced
  movement). **Fork**: *Bubble Shield* (brief incoming-damage reduction
  after use, needs: temporary buff — new concept, nothing in the sim
  currently expires a stat change on a timer) vs. *Slippery Current* (brief
  evasion bump after use, needs: same new temporary-buff concept).
  **Keystone**: *Tidal Retreat* — using this move at low HP triggers a full
  disengage (long retreat + brief speed boost), a real panic button for the
  sim's most fragile spawned agent (needs).

### New levers/primitives this pass surfaced, not in the earlier brainstorm

- **Defense-penetration** (Piercing Beak): ignore some of the target's
  Defense — a new numeric `delta` field, live-tier once added, no new
  subsystem.
- **Movement-context-aware bonuses** (Swooping Approach, Bracing Impact's
  cousin effects): the score/effect depends on what the *agent itself* did
  the same tick, not just the target's state — needs the move-resolution
  call site to know the agent's last action, which it doesn't pass down
  today.
- **Self-state-aware bonuses** (Cornered Fury): a delta conditioned on the
  *user's own* HP fraction, not the target's — mechanically simple (the
  data's already on `Agent`) but needs a call-site plumbing change, same
  shape as the defender-HP-awareness already flagged as a gap in
  `pickBestMove`.
- **Temporary buffs with a real duration** (Bubble Shield, Slippery
  Current): nothing in the sim today expires a stat modification on a
  timer — every existing stat effect is either permanent (a tree's
  `delta`) or instantaneous (one hit's damage roll). A real "for N ticks"
  buff is a genuinely new piece of state on `Agent`, not just a bigger
  `MoveTreeNode.delta`.
- **Position-swap** (Bodyblock): a movement lever distinct from drag/
  knockback/lunge — both agents' positions exchange in one action, not one
  agent pulling or pushing the other.

## Build order recommendation, across everything above

1. **Growl** — highest payoff-to-effort ratio on this entire list; most
   of the roster already knows it.
2. **Sunny Day** — purely additive, cannot make anything worse, visible
   in a replay immediately.
3. **Leer** — first real FOV consumer; proves out line-of-sight-gated
   targeting as a pattern other moves (and eventually detection in
   general) can reuse.
4. **Dig-to-escape** — meaningfully changes prey survival odds, easy to
   verify with a before/after real-run comparison.
5. ~~Burn/poison (the DOT half of status effects)~~ — **done**, see
   DESIGN.md's "Status effects" section; unlocks Aromatherapy/Safeguard's
   counterplay whenever those get built.
6. Everything else, roughly in the order listed above within each round.
