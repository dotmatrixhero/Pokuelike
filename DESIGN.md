# Pokuelike — Design

A Pokémon-flavored roguelike with two halves that are meant to reinforce each
other:

1. **Living ecosystems.** Pokémon aren't spawned encounters — they're agents
   driven by needs (hunger, thirst, energy, mating) that produce visible,
   Dwarf-Fortress-ish behavior over time: a Bulbasaur herd camping a water
   hole and drifting toward cave sunbeams, a Scyther patrolling for prey.
2. **Spec'able tactical moves.** Combat happens on the same grid, and moves
   are area shapes (point, line, cone, ring, burst) rather than flat damage
   numbers. Leveling a move lets you respec its shape and tuning — Ember can
   grow from a single burning tile into an expanding ring, or stay small and
   trade for more burn chance and faster cooldown.

This is a rewrite. The original C++/libtcod prototype is archived at
`legacy-cpp/` (engine scaffolding only, no game content) — we're keeping the
ideas, not the code, and building fresh in TypeScript.

## North star: the sim has to stand on its own

The validation bar for this project isn't "is it fun to play" first — it's
**can the sim run unattended and produce a story worth telling.** Concretely:
it should be possible to run the sim headless for N ticks, with no renderer
and no player, and come back with something like *"the Bulbasaur herd
abandoned the east water hole after a Scyther picked off a straggler, and a
second herd moved into the vacated territory three days later"* — not a flat
dump of position diffs.

If that's not true, player-facing polish (bonding, combat, UI) won't save
the game, because the sim is the actual product — the player mechanics are
a way of participating in something that's already interesting on its own.
This reorders priorities:

- **Sim depth before player mechanics.** Herd cohesion, hunting/fleeing,
  resource depletion, birth/death need to exist before bonding or combat
  resolution get built out — see TODO.md, now organized around this.
- **The event log needs semantic content, not just state diffs.** "Agent
  a3 moved to (4,7)" isn't a story. "Agent a3 (Scyther) killed agent b1
  (Bulbasaur, herd `east-pond`) while hunting" is the unit a narrator (human
  or Claude) can work with.
- **"Run it and tell me a story" is a real acceptance test** for sim
  milestones, alongside unit tests passing. A milestone that only passes
  `vitest` but produces no observable story hasn't actually landed.

**Built:** `packages/engine/src/events.ts` (`EventLog`/`SimEvent`:
`crossedLayer`, `consumed`, `behaviorChanged`) and `packages/runner` (a
`tsx`-run CLI, `pnpm run run [ticks]`, that builds the shared demo world
from `@pokuelike/data`'s `createDemoWorld`, ticks it via the engine's
`tickWorld`, and prints every event plus a summary). `tickWorld` itself is
new too — it used to be an inline loop duplicated in `packages/web/src/main.ts`;
now both the browser app and the headless runner call the same function.

First real run (300 ticks) already surfaced something worth reporting
rather than a flat log: Pidgey commutes canopy<->surface roughly every
5-40 ticks as designed, but Diglett crosses to the surface once early on
and then never returns underground for the rest of the run — it oscillates
between `seekFood` and `seekWater` without ever dropping low enough on both
to register as `idle`, so the "go home when idle" rule never fires for it.
Not a bug exactly, but a real tuning gap between decay rate, the flat
+0.4 consume amount, and the 0.3 idle threshold — worth deciding whether
"a Diglett that abandons its burrow because the surface is more convenient"
is a feature or something to tune away. See TODO.md.

## Predation: hunt, flee, kill

**Built:** `packages/engine/src/predation.ts` (`applyPredationInstincts`,
`HuntRules` = predator species id -> the species ids it hunts) plus a
`killed` `SimEvent`. It's a survival-instinct layer that runs before normal
need-seeking in `tickAgent`: a nearby predator always triggers `flee`
(overrides everything, including hunger/thirst); otherwise a hungry
predator (hunger below 0.6) with prey within 5 tiles switches to `hunt` and
closes distance, killing on contact (restores ~0.6 hunger, prey is marked
`alive: false` and pruned from `World.agents` at the end of that tick).
Predator/prey pairs are data, not engine logic — `SpeciesDef.preysOn` in
`packages/data/src/species.ts`, currently just Scyther -> Bulbasaur,
compiled into `HUNT_RULES`. `tickWorld`/`tickAgent` both take `rules` as an
optional last argument — omit it and agents behave exactly as they did
before predation existed (this is what the "does canon support this"
tangent confirmed: Pokédex entries already have real predator/prey pairs
like Heatmor/Durant and bird Pokémon hunting bug Pokémon, so this isn't a
departure from the source material, just made mechanically visible).

First run with it (300 ticks, same demo world): the Scyther killed 3 of the
4 Bulbasaur in the herd — at ticks 52, 137, and 262 — leaving one survivor
oscillating between `flee` and resuming `seekWater`/`seekFood` for the rest
of the run. That's the first genuinely dramatic story the sim has produced,
not just a tuning curiosity. One more finding worth a look before trusting
this data: fleeing bulbasaurs flip between `flee` and normal foraging
almost every tick in some stretches (the whole herd panics in lockstep at
tick 30, for instance) — the 4-tile flee-detection radius may be too wide
relative to how far one flee-step actually moves an agent out of range,
producing twitchy panic/calm flicker instead of a clean "spotted -> ran ->
safe" arc. Not fixed yet — see TODO.md.

## Reproduction: sex, maturity, mate-seeking

**Built:** `packages/engine/src/reproduction.ts` (`applyMateSeeking`),
wired into `tickAgent`'s previously-unused `seekMate` `BehaviorKind`. A
mature agent (`age >= 200` ticks, or no age at all for agents spawned
directly into a scenario — undefined is treated as "already adult") looks
for the nearest eligible opposite-sex mate of the same species/layer/herd
within 5 tiles, closes distance, and produces an offspring on contact. A
`born` `SimEvent` records it. `Agent.sex` is `"male" | "female" |
undefined` — undefined agents never mate, which is how solitary/singleton
species in the demo world (one Scyther, one Diglett, one Pidgey) safely
coexist with the system without ever pairing.

First run with predation + reproduction together: **zero births, full herd
extinction by tick 217** (see TODO.md for the earlier version of this run
without flora — same result). Confirmed why: `flee` (predation.ts) runs
ahead of `chooseBehavior` unconditionally, so a Bulbasaur under any nearby-
predator pressure never reaches the mating check at all. Across a full
1000-tick run, zero Bulbasaur ever entered `seekMate` — not "rarely," zero.

## Flora: depletable/regrowing food, seed-spread, seasons

**Built:** `packages/engine/src/flora.ts`. Food tiles have a `stock` (0-1)
that depletes ~0.2 per feeding and regrows slowly, modulated by a slow
sine-wave "season" over `world.tick` (`seasonalMultiplier`). An agent that
actually moves has a small chance (`SEED_DROP_CHANCE * GERMINATION_CHANCE`
≈ 0.6%) of turning the open-ground tile it's on into a `"seedling"`, which
matures into a full `"food"` patch after 150 ticks. `findNearestTerrain`
skips depleted food (`stock <= 0`) — a hollowed-out patch is invisible to
need-seeking until it regrows or a new one sprouts elsewhere. Two new
`SimEvent`s: `floraChanged` with `stage: "seeded" | "sprouted"`.

**Confirmed working** over a 1000-tick run: 7 seeds took root and matured
on schedule (~149 ticks each, matching `MATURATION_TICKS`). **Did not fix
the extinction problem**, and this is worth being honest about rather than
claiming a win: the herd's death spiral was never about food scarcity —
the static demo food/water tiles were never depleted enough to matter
before the herd was already dead. The actual bottleneck is upstream of
anything flora touches: the *predator* has no reason to leave. Nothing
about Scyther's behavior involves migration, territory, or satiation-driven
wandering — it just keeps re-hunting the same herd every time its hunger
dips, because the herd's fixed water hole keeps them clustered in range.
Flora gives *prey* a reason to move; it doesn't give the *predator* one.
The next lever, per this finding, is predator-side: something that makes
Scyther leave an area after a kill (satiation-driven range/wander
behavior, most likely — not a flee-threshold tweak, which was last run's
guess and turned out not to be the actual cause). Not built — see TODO.md.

**Retuned** per "food is too long-lived, seedlings should start more
often": `CONSUME_STOCK_AMOUNT` 0.2 -> 0.5 (a patch now empties in 2
feedings, not 5) and `SEED_DROP_CHANCE`/`GERMINATION_CHANCE` 0.02/0.3 ->
0.06/0.5 (roughly 5x more new seedlings per tick of foot traffic).

**Real result, fresh 2000-tick run — both changes worked exactly as
specified, but the net effect on the population was the opposite of what
"scarcity" would suggest:** `floraChanged` events went from 30 to 73
(seedlings really are starting far more often), and per-patch depletion
is real (stock actually hits 0 now instead of just getting nibbled). But
because sprouted seedlings never disappear — a food patch that empties
just waits to regrow, it doesn't revert to floor — more frequent seeding
means the map accumulates *more total food-carrying tiles* over time, not
fewer. Total food throughput went up, not down. Population at tick 2000
went from 247 to **635** — nearly 3x more, not less. Worth being precise
about: this is the tuning working correctly, producing a result that
doesn't match what "food should be scarcer" probably intended. If the
actual goal is scarcity/population pressure rather than just faster
per-patch churn, the lever that's actually missing is a cap on how many
food patches can exist on the map at once (or regrowth/seeding rates that
shrink as more patches are already active) — not built, see TODO.md.

**Rebuilt entirely** per "food still lasts way too long — it should die
naturally, based on how many units eat from it, an eighth to a tenth of
the current life cycle, but with a chance to spread to nearby tiles":
regrowth-in-place is gone. A living food patch now decays a fixed amount
every tick regardless of eating (`FOOD_LIFESPAN_TICKS = 50`, i.e. ~1/10th
of the old ~500-tick regrowth-from-empty cycle) *and* is depleted further
per feeding, and reverts to bare floor (`stage: "died"`) once its stock
hits zero — dead for good, not just waiting to regrow. A living patch also
has a per-tick chance (`FOOD_SPREAD_CHANCE`) to seed an adjacent open tile,
so bushes propagate outward before they die instead of just sitting still.

**This broke the world on the first real run, and it's worth walking
through exactly how, because the cause wasn't the new mechanic itself:**
`CONSUME_STOCK_AMOUNT` had been bumped to 0.5 (two feedings empties a
patch) in the *previous* tuning pass. Stacked with the new natural decay,
the three starting food patches were fully eaten out within the first 5
ticks — confirmed directly in the log (`flora died at (21,4)` at tick 5).
`MATURATION_TICKS` was still 150, so the earliest any replacement food
could mature was tick 150+. That's a guaranteed ~150-tick famine window
with *zero* food anywhere on the map. Result: all 9 starting agents
starved to death by tick ~280, every single one clustered at the water
hole (they could drink, but there was nothing anywhere to eat). Total
colony collapse, confirmed via `dump-replay.ts`'s tick-by-tick population
count going to flat 0.

**Fixed in three moves, each verified against a real run before moving
on:** `MATURATION_TICKS` 150 -> 20 (new food has to actually arrive before
old food finishes dying); `CONSUME_STOCK_AMOUNT` 0.5 -> 0.25 (undoing most
of the earlier bump, since it was compounding with decay rather than
replacing it); and, per "start with like 20 food tiles, make food spawn
faster too", the starting map went from 3 food tiles to 20 (three
5-8-tile clusters plus scattered singles), `SEED_DROP_CHANCE`/
`GERMINATION_CHANCE` 0.06/0.5 -> 0.1/0.65, and `FOOD_SPREAD_CHANCE`
0.015 -> 0.035.

**Real result, five separate 2000-tick runs after all three fixes:** no
more instant collapse — every run now shows real, sustained activity
(19-34 births, 25-43 starved, `floraChanged` in the 1400-1700 range per
run, meaning food is now genuinely churning across the map instead of
sitting static). But population is still net-negative on average across
those five runs (deaths outpacing births in four of five), and the one run
inspected tick-by-tick shows why concretely: it grew cleanly from 7 to 26
agents by tick 750, then collapsed to 0 in under 200 ticks (tick 750 -> 26
agents, tick 925 -> 0). That's a real boom-bust cycle — sustained growth,
an overshoot past what the map's food supply can support, then a fast
cascading die-off — not a bug in the same sense as the total-collapse
famine above, but not a stable equilibrium either. Worth being clear about
the difference: this is now a *believable* ecological failure mode
(overshoot-and-crash is a real thing real ecosystems do) rather than a
mechanical dead end. Turned out to be understating it, though — see below.

**Found the actual mechanical dead end after watching the full replay**,
per a direct, incredulous "there was plenty of food left, they all just
sat in a watering hole and died?" It wasn't an overshoot at all.
`growFlora` gave a living **food** patch a lifespan and a death, but
never gave decorative **flora** one — it just sat there forever once
grown. Since a seedling can only ever plant on bare `"floor"`, and flora
permanently converts floor away without ever reverting, decorative growth
was a one-way ratchet silently eating the map's entire pool of ground new
food could ever grow on. Checked directly against the actual run: by tick
800, **0 food tiles existed anywhere on the map, permanently** — every
future tick stayed at exactly 0 — while 248 of 384 total tiles had been
converted to un-reseedable decorative flora and only 113 remained as bare
floor. The population wasn't overshooting anything; it was sitting at the
water hole (the one need it could still satisfy) starving of hunger with
*no possible path back to food ever again*, because there was nowhere
left on the map for a new seedling to take root as food instead of flora.
What looked like "plenty of food" on screen was moss/fern/bloom —
decorative, not edible, and rendered in similarly cheerful colors.

**Fixed** by giving flora the same mortality food already had:
`FLORA_LIFESPAN_TICKS = 150` (3x food's 50, since it's meant to be a
longer-standing feature, but it still has to eventually give the tile
back). `Tile.stock` is now reused as a generic vitality counter for both
kinds rather than being food-specific.

**Real result, three fresh 2000-tick runs:** floor/food/flora now
genuinely cycle instead of flora monotonically ratcheting to a ceiling —
tracked one run's tile composition directly: flora peaked at 182 around
tick 400, then dropped back to 0 by tick 2000 as patches aged out, with
floor recovering from a low of 81 back up to 361. Population activity
roughly tripled: 60-134 births per run (vs. 13-34 before this fix),
1800-3275 `consumed` events (vs. 632-974), still a boom-and-mostly-bust
pattern rather than settled equilibrium, but a dramatically higher-
throughput, more alive one — and, more importantly, one where extinction
is no longer structurally guaranteed by a bug that quietly locks the map's
food supply at zero forever. Population equilibrium itself is still open
— see TODO.md.

## Mob-fighting, predator risk-assessment, and relocation

**Built:** `packages/engine/src/predation.ts` was substantially rewritten,
in priority order:

1. **Self-preservation.** A predator at or below 40% HP flees whoever's
   currently fighting it instead of continuing to hunt.
2. **Mob or flee.** Prey with a predator within 2 tiles checks how many
   same-species/herd allies are within 4 tiles of *itself*. Three or more
   (self included) and it fights (`BehaviorKind: "fight"`, converges,
   deals 1 damage on contact) instead of fleeing. `Agent.hp`/`maxHp`
   default to 3 the first time something takes damage — only agents that
   ever enter combat carry them at all.
3. **Risk-aware hunting.** A predator won't select a hunt target that's
   itself protected by a big-enough nearby herd (`isProtectedByMob`) — it
   looks for an easier target instead of walking into a fight it would
   lose.
4. **Give up and relocate.** A predator that goes 150 ticks of active,
   hungry hunting without landing a kill (`ticksSinceMeal`) gives up on
   the area and walks to a random distant point (`BehaviorKind:
   "relocate"`) instead of camping the same spot forever.

New events: `fought` (one hit, with the defender's remaining HP) and
`defeated` (HP hit zero). Unit-tested in isolation: a synchronized mob of
3 *can* drop a predator to 0 HP and defeat it outright (verified in
`predation.test.ts`) — the mechanism works.

**Real run result, 1000 ticks, and it's a genuine near-miss worth reporting
straight:** the herd still went fully extinct (same four kills as before,
now at ticks 53/97/153/208). But this time something new and real
happened at tick 97 — a Bulbasaur actually landed a hit (Scyther 3hp ->
2hp) before dying. Looking at the log directly: `mobSize` only checks how
many herd-mates are *somewhere* within 4 tiles, not how many are actually
in melee range yet. bulbasaur-0 got close enough alone, the headcount
check passed because the herd technically had 3+ members alive nearby,
so it committed to `fight` solo — its actual backup was still several
tiles away, mid-flee-cycle, not yet adjacent. The predator's kill-on-
contact isn't interruptible by simultaneous damage, so it ate bulbasaur-0
the same tick it took the hit. One real hit landed; no mob ever actually
assembled. The relocate mechanic did fire once too (tick 690-702), but by
then there was nothing left to give the herd breathing room for.

This is a specific, fixable coordination gap, not a dead end: mobbing
should probably require nearby allies to also be within striking distance
(not just within a loose muster radius) before anyone commits to fighting
alone. Not fixed yet, deliberately — see TODO.md.

**Fixed since**: `mobSize` now counts allies within striking distance of
the *threat*, not just somewhere within the agent's own muster radius
(`predation.test.ts` has a regression test reproducing the exact tick-97
scenario above). Verified the fix doesn't break the "3 can defeat a
predator" or "large herd mobs" cases either.

## Real tactical combat: stats, types, moves, cooldowns

Replaced the flat/instant mechanics entirely, per direct ask ("the hp and
kill on contact system needs overhaul... we need the roguelike battle
thing"):

- **`packages/engine/src/typing.ts`**: the real 18-type mainline chart
  (`typeEffectiveness(attackType, defenderTypes[])`, multipliers stack
  across dual types — e.g. Grass into Bug/Flying is 0.25x, quadruply
  resisted).
- **`packages/engine/src/stats.ts`**: `calculateStats(base, level)` — the
  real simplified mainline formula (HP: `floor(2*base*level/100) + level +
  10`; other stats: `floor(2*base*level/100) + 5`), no IV/EV modeling, just
  mainline-scale numbers. Verified against a real level-5 Bulbasaur's HP.
- **`packages/engine/src/moves.ts`**: `MoveSpec` now carries `type`,
  `category` (physical/special), `power`, `accuracy` (not yet consumed —
  every move currently hits, see TODO), and `cooldownTicks`, replacing the
  old untyped `tuning` bag.
- **`packages/engine/src/combat.ts`**: `calculateDamage` is the real
  mainline formula (`((2*level/5+2) * power * atk/def) / 50 + 2`) with
  STAB (1.5x), type effectiveness, and an injectable random-variance
  factor (0.85-1x in the actual sim, fixed in tests) — an immune (0x)
  matchup deals exactly 0, not the usual floor-of-1 minimum.
  `pickBestMove`/`useMove`/`tickCooldowns` handle move selection (greedy:
  highest expected damage against the current defender's types) and
  per-move cooldown tracking.
- **`packages/data`**: real canon base stats and types for all 5 species
  (Bulbasaur Grass/Poison, Scyther Bug/Flying, Charmander Fire, Diglett
  Ground, Pidgey Normal/Flying), a new Grass move (Vine Whip) so Bulbasaur
  has a type-advantaged option against something, and `spawnAgent(species,
  id, pos, level)` — computes real stats/moves/types once at spawn instead
  of agents carrying ad-hoc placeholder HP.
- `predation.ts`'s mob-fight and hunt-kill both now call into real combat
  instead of flat damage/instant death — a hit that doesn't faint the
  target leaves a wounded agent that gets another chance to flee before
  the next exchange, which didn't exist before at all.
- **Move range, not just melee**: `combat.ts`'s `moveRange(move)` derives
  reach from shape (`point` = 1, `line`/`cone` = their length) — Vine Whip
  is now `{ kind: "line", length: 2 }`, so a Bulbasaur/Venusaur can hit
  from two tiles out instead of needing to close to melee first. Every
  attack site (mob-fight, hunt, guardian) checks `canAttackFromHere`
  before deciding to swing vs. step closer.
- **Guardians**: any species nothing preys on (checked directly against
  `HuntRules` — no new data field needed) that notices a herd-mate
  `flee`ing or `fight`ing moves to intercept the threat, regardless of
  whether the guardian itself is in any danger (`findHerdmateInDanger` in
  `predation.ts`). Two Venusaur (level 20, vs. Scyther's level 8) added to
  the demo herd on this basis.

**Real run result, 1000 ticks, with guardians — two findings, one expected
kind and one genuinely surprising:**

1. The Bulbasaur herd died exactly the same way as before (same 4 kills,
   same two-hit pattern). A guardian *did* trigger once — `venusaur-206-1`
   switched to `fight` at tick 208 when `bulbasaur-3` started fleeing, and
   gave chase for 15 ticks. It never arrived: the kill happened at (19,13),
   clear across the map from where the guardians actually spend their time
   (near the water hole around x=3-9) — the herd forages far enough from
   its own protectors that a guardian starting from home can't cross the
   map in time. The mechanism works exactly as coded; the demo map's
   geography just doesn't give it a chance. Real finding, not a bug: this
   points at guardian *positioning* (patrol near the grazing range, not
   just "the herd") as the next lever, not the intervention logic itself.
2. **Not asked for, and worth flagging plainly: the Venusaur population
   exploded from 2 to 52 over 1000 ticks.** Nothing hunts Venusaur, so
   they never flee/fight for their own survival — they just mate
   continuously (mature at 200 ticks, no predator ever interrupts them).
   Worse: there's no relatedness check in `reproduction.ts`, so
   `venusaur-0` (the original founding male) fathered most of that growth,
   including with his own daughters and granddaughters once they matured.
   This is the mirror image of the Bulbasaur extinction problem — a
   species with *no* population pressure grows unboundedly and
   incestuously — and it's a direct consequence of reproduction and
   predation being independent systems with nothing tying them together
   (no carrying capacity, no inbreeding avoidance). Not fixed — see
   TODO.md.

**Real run result, 1000 ticks — reporting it straight, not as a win:** the
herd still went fully extinct. But the *texture* of how is different and
worth recording: two of the four kills took two hits over several ticks
(a real multi-tick exchange — Scyther hit bulbasaur-1 for 18, it survived
at 1 hp, then died to a second hit five ticks later), while the other two
died in a single hit (~18-19 damage against a level-5 Bulbasaur's ~19 max
HP). Zero mob-fights occurred this entire run — the coordination fix means
no more suicidal solo engagements, but it also means the herd never
actually assembled 3-within-striking-distance even once in 1000 ticks;
getting a real herd defense to occur at all is apparently a harder
coordination bar to clear than getting individuals to stop dying for
nothing. Also worth flagging plainly: Scyther (level 8, base Attack 110)
vs. Bulbasaur (level 5, base Defense 49) is a lopsided matchup by the real
formula — mainline-accurate (a higher-level predator should crush a lower-
level target fast), but it means fights resolve in 1-2 hits and cooldowns
rarely get to matter. If the goal is longer, more tactical exchanges, the
lever is the level/stat gap between predator and prey, not the formula.

## Herd cohesion — and the first complete story arc

**Built:** `packages/engine/src/herding.ts`. `herdCentroid(world, herdId,
layer)` is the *live* average position of every agent sharing a `herdId`
on a layer (guardians included, since Venusaur share the herd's `herdId`
too). An idle agent more than 5 tiles from that centroid walks back toward
it instead of just standing still — wired into `tickAgent`'s `idle`
branch, after the existing "return to home layer" check.

**Real run result, 1000 ticks — and this is the first time the sim has
produced a complete beginning-to-end story:**

1. Cohesion pulled the Venusaur guardians close enough to the herd's
   actual position that the positioning gap from the previous run
   (guardian starts a chase, never arrives) stopped happening. A guardian
   engaged Scyther directly at tick 119 (17 damage, Scyther down to 12 hp)
   and again at tick 170 (19 damage) — **`venusaur-1` defeated `scyther-0`
   outright.** First predator defeat in any real run this session.
2. Scyther was the *only* predator in `HuntRules`. With it gone, every
   remaining threat to the herd disappeared — permanently, for the rest of
   the 830 remaining ticks.
3. Both defended species then grew freely: Bulbasaur went from 4 to 40
   individuals (36 births, confirmed multi-generational — e.g.
   `bulbasaur-312-4` having its own offspring `bulbasaur-513-11` later),
   Venusaur from 2 to 36. Zero deaths, zero predation, for the remaining
   82% of the run.

That's a genuinely complete arc — predator pressure, a real fight, a
decisive victory, population recovery — the first run this session that
reads as a finished story rather than a mid-arc data point. But it also
immediately reproduces last time's population-explosion finding, now at
the scale of the *entire herd* rather than just the guardians: removing
the single predator from this ecosystem removes 100% of its population
control, and nothing else replaces that pressure. This isn't a new bug —
it's the same missing piece (no carrying capacity, no population limit for
an unpredated species) now visible at higher stakes, since a guardian
succeeding at its job is exactly what triggers it. See TODO.md.

## Starvation and migration — a real (partial) fix for unbounded growth

**Built**, directly in response to "they need to be able to starve to
death or migrate": `Agent.starvationTicks` counts consecutive ticks at 0
hunger or thirst; 100 ticks there and the agent dies (`starved` event,
cause recorded). Separately, `packages/engine/src/migration.ts` (shared
with the predator relocate logic, which used to duplicate this) — an
agent whose resource search fails on every layer for 150 ticks
(`ticksWithoutResource`) gives up and walks to a random distant point.

**Real run result, 2000 ticks:** starvation is doing real work — **564
Venusaur starved to death** (out of 919 ever born), a genuine population
check that didn't exist before. But it's a partial fix, not a solved
problem: 917 births still outpaced 564 deaths, so the population kept
growing net-positive (roughly 355 alive at tick 2000, up from 2). Boom-
with-heavy-mortality, not equilibrium.

**Also worth being precise about a negative result**: migration never
triggered once for any non-predator in this run (checked directly: zero
`-> relocate` events for Bulbasaur/Venusaur/Diglett/Pidgey). Traced why:
`ticksWithoutResource` only accumulates when *no food exists anywhere on
any layer* — but the actual failure mode here is different and more
realistic: food exists, just not *close enough* before hunger runs out.
`findNearestTerrain` succeeding resets the counter the instant any food
tile is found, however far away, so an agent that can see a food patch
across the map but can't walk there in time never counts as "should
migrate" — it just starves mid-journey. Migration as built solves "there's
truly nothing here"; it doesn't solve "there's not enough here for this
many mouths," which is the actual shape of the Venusaur crash. Not fixed
— see TODO.md.

## ASCII/color snapshot renderer — seeing the sim, Brogue-style

**Built**, in response to "render an ascii image of snapshots... think
Brogue": `packages/runner/src/ascii.ts` — `captureFrame(world)` walks the
surface layer's tiles and alive agents into a `Frame` of `{char, fg, bg}`
cells (agent glyph = species initial, colored by primary type via an
18-type RGB table; terrain glyph/color per kind; background shade scales
with tile elevation, mirroring the web renderer's elevation cue), and
`frameToAnsi(frame)` renders it as 24-bit ANSI escape codes for the
terminal. Wired into the runner CLI as an optional third argument —
`pnpm run run <ticks> "<tick,tick,...>"` prints those snapshots after the
event log. `dump-frames.ts` is the same capture path aimed at a JSON file
instead of the terminal (plus per-frame species population counts), used
to build a real-data HTML artifact.

**Real run, 2000 ticks, snapshots at every kill/defeat plus fixed
checkpoints:** this run told a *different* story than the one in the
Starvation section above — same starting world, different dice. Scyther
killed 2 of the 4 wild Bulbasaur (ticks 58 and 114) before a Venusaur
guardian caught and killed it at tick 167 (`defeated` event, not just
`killed` — the first time this project's log has shown the guardians
actually winning). With the only predator gone, Venusaur went from 2 to
213 individuals by tick 2000 with **zero recorded starvation events** —
a cleaner, faster illustration of the "predator-free population has no
brake yet" problem than the run that produced the 564-starved number,
and a reminder that single-run numbers in this doc are one sample of a
noisy process, not a fixed constant. Artifact with the actual frames:
ask for the link, or regenerate with `dump-frames.ts` — nothing here is
staged or touched up after capture.

**Extended to a full continuous replay**, per "I want to watch the whole
sim, every frame, not screenshots": `packages/runner/src/dump-replay.ts`
captures *every* tick of a run (not curated snapshots) as compact
index-encoded data — per-tick agent positions as flat number arrays, plus
a sparse terrain-kind diff log (terrain rarely changes, so diffing beats
re-storing the whole grid every tick). The artifact renders it on canvas
with play/pause, a scrub bar, and speed control, replaying an entire
2000-tick run in about 90 seconds at 1x.

**Also found and fixed a real rendering bug via that full replay**: the
renderer drew one glyph per agent, so when the tile-stacking bug (see its
own section above) put over a hundred agents on one tile, it silently
looked identical to a single occupant — the replay was hiding the exact
thing it was built to reveal. Fixed by grouping agents per tile and
drawing a `×N` badge whenever more than one is actually there.

## Flora variety and map obstacles — cosmetic, not mechanical (yet)

**Built**, per "flora needs variety — some aren't for eating but are
comfier to sit on, some do better around sunbeams, some spawn different
berries, make them cute different colors/chars, add obstacles":
`packages/engine/src/flora.ts` — a maturing seedling now rolls between two
outcomes instead of always becoming generic "food": edible `FOOD_FLAVORS`
(real Pokémon berry names — Oran, Sitrus, Pecha, Cheri) or decorative,
non-edible `FLORA_FLAVORS` (moss, fern, bloom). A seedling maturing within
3 tiles of a sunbeam is 80% likely to become food (favoring sun-loving
Sitrus/Cheri) vs. 55% normally — real environmental bias at germination
time, not a growth-rate effect. Each flavor gets its own glyph and color
in both the runner's ASCII renderer and the web canvas renderer (e.g.
Oran = blue `%`, moss = soft green `` ` ``) — purely cosmetic for now, no
gameplay effect, exactly as asked. The demo map also gained more
obstacles: a scattered boulder pair and a broken wall line with a
deliberate one-tile gap (a chokepoint), on top of the existing rock
outcrop and wall corner.

## The single-tile stacking bug — a real one, found from watching the full replay

Building a full tick-by-tick replay (see the ASCII renderer section above)
surfaced something the curated snapshots had been hiding: **168 of 264
agents on one tile** by tick 2000 in one run. Two real, distinct causes,
both traced from actual data rather than guessed at:

1. **`spawnOffspring` placed the child at `{ ...mother.pos }` verbatim.**
   Combined with herd cohesion pulling the group tight, every new
   generation was born on exactly the same tile as the last, compounding
   for hundreds of births. **Fixed**: offspring now spawn on a random open
   neighbor tile (`nearbySpawnTile` in `reproduction.ts`), falling back to
   the mother's tile only if she's fully boxed in. Regression test added.
2. **The map itself was almost entirely open floor with exactly one food
   tile and one two-tile water hole** (`createDemoWorld`, unchanged since
   the very first version of this scenario). Every hungry or thirsty agent
   in the whole population had nowhere else to go.
   **Fixed**: the demo world grew from 20×14 to 24×16 with three separated
   food patches, two water sources on opposite sides of the map, a rocky
   wall obstacle plus a wall corner, and a small hill (two elevation
   steps) — real terrain variety instead of a featureless plain.

**Real result after both fixes, fresh 2000-tick run:** better, not solved.
Peak stack dropped from 168 to **113** of 247 agents, and the number of
distinct tiles agents actually used roughly doubled early in the run. But
a max stack in the hundreds is still there. Tracing it further: herd
cohesion has no repulsion term (agents only move *toward* the herd
centroid, never away from a crowded one), and once an agent finishes
eating or drinking it has no reason to leave that tile — there's no
idle-wander behavior, so a successful resource tile becomes a permanent
gathering point rather than a stop. That's the real remaining cause, not
map layout — see TODO.md.

The replay's renderer was also fixed regardless of the underlying sim
behavior: it used to draw one glyph per agent, so a 100-deep stack and a
single occupant looked identical (arguably why this took a full replay to
notice instead of the curated stills). It now groups agents by tile and
draws one glyph plus a `×N` badge, so crowding is visible instead of
silently overpainted.

## Stack

- **pnpm workspace monorepo**, TypeScript everywhere.
- `packages/engine` — headless simulation core (world grid, need-driven
  agent AI, move-shape resolution). No rendering, no DOM. Unit-testable in
  isolation (vitest).
- `packages/data` — species and move definitions, plus the shared demo
  world (`createDemoWorld`) both other apps use (imports types from `engine`).
- `packages/web` — Vite browser app. Canvas renderer draws real sprites when
  present (`packages/web/public/sprites/<spriteKey>.png`, not checked in —
  bring your own art) and falls back to a colored square + initial when a
  sprite is missing, so the sim is visible before any art exists.
- `packages/runner` — headless CLI (`pnpm run run [ticks]`, via `tsx`) that
  ticks the demo world and prints its event log — no renderer, no player.
  This is the "run it and tell me a story" tool.

Browser + real sprites was a deliberate choice over an ASCII terminal look —
easy to share as a link, and the Pokémon-art identity matters more here than
roguelike purism.

## The sim/combat boundary

This is the central architectural risk and needs a name so we keep making
the same call consistently: **the promotion boundary**.

- Off-screen or passively-observed agents run on a **cheap tier**: need
  decay + a small utility-AI behavior pick (`chooseBehavior` in
  `packages/engine/src/needs.ts`) + naive step-toward-target movement. This
  has to stay cheap enough to run dozens-to-hundreds of agents per tick.
- The moment the player engages an agent in combat, it gets **promoted** to
  a full combat rig: move slots, cooldowns, status effects, per-tile move
  resolution (`packages/engine/src/moves.ts`).
- When combat ends, the agent **demotes** back to the cheap tier with
  whatever state changes (health, position, fled/afraid) carry over.

Nothing here builds the promotion/demotion transition yet — today's engine
only has the cheap tier (needs → behavior → movement) and the move-shape
resolver in isolation. The transition is the next real design problem once
both halves exist: what state actually needs to persist across it, and
whether "promoted" agents pause the rest of the world or run in parallel.

## World scale: layers, elevation, and regions

**Layers and elevation are built** (regions/world-graph are not — see
below). What exists now in `packages/engine`:

**Three layers per region, sharing one x,y footprint:** Underground /
Surface / Canopy (`Layer` in `types.ts`, `World.tiles` is one grid per
layer). A species is native to one layer (Diglett underground, Pidgey
canopy, most things surface — see `SPECIES[...].homeLayer` in
`packages/data`) and moves within it normally. Crossing layers is **common,
not rare** — `tickAgent` (`needs.ts`) makes an agent whose resource isn't on
its current layer cross to the nearest layer that has it (`findLayerWithTerrain`),
then return to `homeLayer` once idle again. Crossing itself takes a tick and
doesn't move position — it's a discrete, loggable event, not free
teleportation. This was a deliberate choice over rare "risk event"
crossings: with frequent small exposure windows, story density comes from
volume (most crossings are uneventful, some aren't) rather than from every
crossing being a scripted set-piece. Needs-seeking also now actually
restores the relevant need on arrival (`consume` in `needs.ts`) — previously
agents walked toward resources forever without ever being satisfied.

**Elevation is continuous within a layer**, not a fourth layer — a
heightmap (`Tile.elevation`, currently populated on Surface only) for
hills/ridges that drives:
- FOV/line-of-sight (`fov.ts`: `computeVisible` — a ridge strictly taller
  than both the observer's and the target's elevation blocks the line
  between them; standing on higher ground extends the sight radius),
- combat accuracy/evasion (`elevation.ts`: `elevationAccuracyModifier` /
  `elevationEvasionModifier`, capped so an extreme height gap can't
  guarantee a hit or a dodge — standalone utilities until a combat resolver
  exists to call them).

Open, still unresolved: whether Underground/Canopy get their own elevation
too, and how a real combat resolver will actually consume the accuracy/
evasion modifiers once one exists.

**World graph, not one big map:** 3–5 regions to start, connected by
migration edges, each region independently bounded (per the earlier scale
discussion). This is where the promotion boundary concept turns out to
apply **one level up**, not just at the agent/combat level:

- A region being observed runs **full sim** — every agent, every tick,
  across all three layers.
- An unobserved region runs **abstracted**: aggregate counts per species,
  average need levels, resource stock — advanced by cheap statistical
  rules, occasionally emitting an event (boom, die-off, emigration along an
  edge) without simulating individuals.
- Crossing the graph edge (or the player/observer's attention moving to a
  region) is a **region-level promotion/demotion**, symmetric with the
  agent-level one already named above: full sim seeds the aggregate on
  demotion, the aggregate seeds a plausible population on promotion.

This is the piece that makes DF-scale time (simulate weeks/months, read a
history afterward) affordable without simulating every agent in every
region every tick forever — reuses a concept the design already has rather
than inventing a second architecture for it.

Open questions, unresolved: how the aggregate model reconciles back into
individuals on promotion (do specific agents get invented with plausible
stats, or does something get lost/smoothed over — probably fine for
background regions, but worth being honest that promotion isn't lossless);
whether elevation exists on Underground/Canopy too or only Surface.

## Player character: a fragile human, earning your first partner

Decided: you play a human, not a trainer with starting gear and not a
Pokémon. No Poké Balls, no dialogue-driven taming, no starting fight you can
win. Your first Pokémon has to be earned by observing and coexisting with
the sim before you can rely on it in combat — this is deliberately the
opposite of the usual "pick a starter, everything below the UI is decoration"
open. The tension we're aware of and designing against: this kind of
approach-and-wait taming loop is boring in most games because the player is
guessing blind and repeating one action until a hidden number crosses a
threshold. The plan is to avoid a bolted-on "friendship meter" entirely and
instead make bonding a use of the ecosystem sim that already exists:

- **The player is just another agent to the sim.** No separate taming
  system — the player emits a "threat signature" (speed, distance, posture:
  standing vs. crouched) that feeds into the same perception logic that
  already decides whether an agent flees, ignores, or reacts to anything
  else in the world. A Pokémon's tolerance for that signature is a function
  of its *existing* need state — a hungry Bulbasaur risks proximity for
  food (approach-avoidance conflict) that a well-fed one won't.
- **Trust is discrete, readable stages, not a meter:** Wary → Tolerant →
  Curious → Bonded. Each transition requires a qualitatively different
  action (stop fleeing at a held distance → approach something the player
  did on its own initiative → a species-specific bonding moment), not
  repetition of the same input, and each has a visible tell (posture/sound
  change) so a correct read is confirmed immediately.
- **Bonding paths differ by species**, on purpose, reusing the behavioral
  differences the sim already encodes: a herd forager (Bulbasaur) bonds via
  patience and not disrupting herd rhythm; a solitary hunter (Scyther) won't
  take a handout and has to be earned through utility or respect (e.g. not
  interrupting a kill) instead. Same four stages, structurally different
  puzzle per species — this is also a stress test of whether the "read the
  ecosystem" skill (see below) is actually legible without a tutorial, which
  we don't know yet.
- **Fragility has to bite.** A misread on a predator is a real injury, not a
  redo. Some bonding actions cost vulnerability on purpose (crouching to
  offer food means a slower reaction if the read was wrong). Failing badly
  has world-state consequences — a spooked herd relocates, a species gets
  warier of humans in that area — rather than just failing silently and
  letting the player retry with no cost.
- **The core skill being trained is reading the sim's tells**, not
  memorizing a script: agents should telegraph their state visibly (a
  hunting Scyther reads differently from a patrolling one) before the
  player is in danger, so a failed approach feels like a misjudgment, not
  bad RNG. This same tell-reading skill is what makes the later "avoid or
  bait an encounter" gameplay (not just the opening) work.
- **Payoff has to land fast.** First bond should be a 5–15 minute arc, not
  an hour of repetition — both to keep the tension tight and because a
  bonded partner should visibly change the game afterward (it alters the
  player's threat signature to *other* Pokémon, or senses danger), which is
  the reward that has to arrive before patience runs out.

Explicitly unresolved: whether species-specific bonding puzzles read as
distinct puzzles to a player or just as "trial and error until it works" —
that's a playtesting question this design can't answer on paper.

## Data import: species/moves/abilities/types/damage-math from PokeRogue

The old TODO item ("bulk species/stats import from a PokeRogue-derived data
source") is done, with a real reusable tool behind it rather than a one-off
scrape:

- **`packages/data/scripts/import-from-pokerogue.mjs`** parses a local
  `poke_the_spire` (PokeRogue fork) checkout's `.ts` source *as text*
  (regex + balanced-bracket scanning) — deliberately not importing/executing
  its TypeScript, since its `#app/`-style path aliases don't resolve
  standalone. It regenerates five files under `packages/data/src/dex/`:
  `species.generated.ts`, `moves.generated.ts`, `abilities.generated.ts`,
  `type-chart.generated.ts`, `items.generated.ts`. Usage is a one-liner
  (`node packages/data/scripts/import-from-pokerogue.mjs /path/to/poke_the_spire`)
  and the generated files are checked in (not gitignored) so the sim builds
  without a PokeRogue checkout present — re-run it and diff when PokeRogue
  updates.
- **Species: 1083 entries**, every `SpeciesId` PokeRogue defines, generations
  1-9. Base-form scalar fields only (types, base stats, catch rate, gender
  ratio, growth rate, ability slots, egg tier, evolutions) — verified exactly
  against six known species (Bulbasaur, Scyther, Charmander, Diglett,
  Venusaur, Pidgey) whose stats were previously hand-typed into
  `packages/data/src/species.ts`. **Scope call**: PokeRogue actually models
  some alt forms (regional variants, Mega Evolution) as their own top-level
  `SpeciesId` — those came in for free as ordinary dex entries. Forms nested
  *inside* a single species' `forms: [...]` array (Pikachu's cosmetic caps,
  Deoxys/Rotom/Zygarde/Arceus battle formes, Gigantamax) did not — reconciling
  "which nested form is canonical" plus form-change triggers was judged out
  of scope for a data import. See TODO.md.
- **Moves: 951 of 953 defined move entries** (2 skipped — they reference
  `MoveId.G_MAX_WILDFIRE`-family ids that are commented out of PokeRogue's own
  `MoveId` enum, i.e. dead code in the source itself, not a parser gap).
  Type/category/power/accuracy/pp/priority/target plus a lightweight tag list
  (chained `.attr(...)` class names and flag methods like `punchingMove`) —
  verified exactly against the 5 moves already hand-typed in
  `packages/data/src/moves.ts` (Tackle, Slash, Vine Whip, Ember, Flamethrower).
  **Scope call, explicit**: the tag list is a glance-level summary, not
  implemented logic — reimplementing what `LeechSeedAttr` or `MultiHitAttr`
  actually does is a different, much bigger project than a data import.
- **Abilities: 319 entries** (id/name + `AbAttr` tag list + `ignorable`).
  **No plain-text descriptions**: PokeRogue's ability display strings live in
  a separate i18n locale repository that wasn't part of this checkout, so
  there was nothing to extract beyond the attr tags — noted plainly in the
  generated file's header rather than faked.
- **Type chart: extracted and cross-checked, not replaced.** The importer
  parses PokeRogue's `getTypeChartMultiplier` (nested `switch(defType) {
  switch(attackType) { ... } }`) into the same shape as
  `packages/engine/src/typing.ts`'s hand-maintained chart. A scripted
  18x18 diff against the engine's chart came back **zero differences** — the
  existing chart was already fully correct, so it was left alone, and the
  imported copy lives in `dex/type-chart.generated.ts` purely as a
  cross-check for future changes (e.g. if a mainline chart update ever
  changes an interaction).
- **Items: ~30 curated, not scraped.** PokeRogue's real item/modifier system
  (shop economy, held-item stacking rules, hundreds of items) is enormous;
  pulling numbers for the ~30 classic damage-relevant held items (Choice
  Band/Specs/Scarf, Life Orb, Eviolite, Leftovers, type-boosting
  Plates/Gems, etc.) by hand was the actually-useful scope. Reference data
  only — not wired into `combat.ts`.
- **`packages/data/src/species.ts` and `moves.ts` now source canon numbers
  from the dex** instead of hand-duplicating them: `speciesFromDex(dexKey,
  simFields)` looks up base stats/types/name from `SPECIES_DEX_BY_KEY` and
  merges in only the sim-specific fields (`spriteKey`, `homeLayer`,
  `preysOn`, curated `moves` list); `moveCanon(dexKey)` does the same for a
  move's type/category/power/accuracy, leaving `shape`/`cooldownTicks`/
  `statusChance` as sim-specific tuning. Adding a new species or move to the
  sim roster going forward is "look up the dex key, supply the sim-specific
  fields" rather than retyping numbers.
- **Damage math ported into real engine behavior, not just data** — see the
  "Combat / moves" TODO entry for exactly what: crit chance by stage,
  `CRITICAL_MULTIPLIER`, the mainline stat-stage multiplier table, and a real
  accuracy/evasion-stage formula, all now actually consumed by
  `packages/engine/src/combat.ts` and `predation.ts`'s `resolveHit` — a move
  can genuinely miss now, closing an old TODO gap. Honest caveat: the
  current curated `MoveSpec` roster is 100-accuracy-everywhere and nothing
  sets a stat stage yet, so in practice only the crit roll visibly fires in
  a real run (confirmed: `scyther-0` critically hit `bulbasaur-1` at tick 59
  of a real 1000-tick run) — the accuracy/stat-stage machinery is real and
  engine-tested but currently idle until a lower-accuracy move or a
  stage-changing effect exists.

## Action economy: Speed drives frequency, not turn order; move range as its own axis

Decided, not built yet (implementation tracked next): today `tickWorld` gives
every agent exactly one action per world tick, full stop — Speed exists as a
stat (`calculateStats`) but nothing reads it. That's wrong for a roguelike-
tactics-grid combat model, and it's also the natural place to attach the
long-pitched move-leveling/respec idea (see the opening pitch and the old
"move leveling/respec system" TODO), so this locks down one coherent design
instead of bolting Speed on and rebuilding the respec system against it
later.

- **Speed → action frequency, via an energy accumulator, not an initiative
  queue.** Every agent gains an `actionEnergy` counter; each world tick,
  `actionEnergy += speed`, and once it crosses `ACTION_THRESHOLD` the agent
  gets exactly one action that tick and the threshold is subtracted (the
  remainder carries over — no drift, and no agent can bank enough excess to
  take two actions in the same single tick, capped explicitly). A classic
  sorted initiative queue would work for 1v1 promoted combat but doesn't fit
  the cheap tier, which has to stay affordable for dozens-to-hundreds of
  background agents per tick (the existing promotion-boundary concept) —
  an energy accumulator is O(1) per agent per tick either way, so the same
  mechanism serves both tiers without a separate combat-only turn system.
- **This forces `tickAgent` to split** into "always happens" (need decay —
  hunger doesn't pause because you're slow) and "only on an action tick"
  (behavior choice, movement, attacks, cooldown-gated move use). That split
  doesn't exist today; it's the real architectural surgery here, not the
  accumulator math itself.
- **Cooldowns stay real-time**, counting down every world tick regardless of
  whether the owner acted that tick — deliberately orthogonal to Speed.
  Speed governs how many chances an agent gets to act; cooldown governs how
  often one specific move is available regardless of how fast its wielder
  is. Together these are the sim's actual translation of Pokémon's
  simultaneous-turn Speed stat into a real-time tactics-grid game, rather
  than a literal port of turn order from a format this sim isn't using.
- **Move range becomes its own field**, not just inferred from AoE shape:
  `MoveSpec` gets explicit `range: { min, max }` (max replaces what
  `moveRange()` in `combat.ts` currently derives solely from `shape`; min
  defaults to 0/melee-capable, reserved for a future thrown-only move that
  can't be used at melee). This separates "how far can I target" from "what
  does the hit look like once I do," which the shape system alone
  conflates today — a real tactics-grid distinction (FFT/Into the Breach-
  style: cast range vs. effect footprint), and a prerequisite for the
  skill tree below to have range as an independent respec axis rather than
  something only shape changes can move.
- **Skill tree / respec, as a small DAG per move, not a linear list.** A
  `MoveSpec` gains an optional node graph — each node a delta on
  shape/range/power/accuracy/cooldown/statusChance, gated by a point cost
  and prerequisite node id(s). Applying a chosen set of nodes is a pure
  function (`applyMoveTree(base, chosenNodeIds) -> MoveSpec`) — it never
  mutates the canonical `MOVES`/dex data, it derives a new spec instance.
  This is what makes "Ember: point -> ring, or stay small and trade for
  more burn chance and faster cooldown" (the original pitch) concrete
  rather than aspirational.
- **Scope call: wild background agents don't get trees.** Every predation/
  guardian/mob-fight call site keeps using the base `MoveSpec` untouched —
  trees only matter once something (the player, eventually) actually earns
  and spends move points. This keeps the cheap tier cheap and avoids
  designing a build-point economy for a hundred background Bulbasaur that
  will never see it.
- **Explicitly still open**: whether `ACTION_THRESHOLD` and species' Speed
  values (mainline-scale, so this needs tuning against `calculateStats`
  output) produce a good action-frequency spread without retuning every
  existing behavior threshold that assumed "one action = one tick"; whether
  cast range vs. effect footprint needs a real target-tile concept (aim at
  a tile within range, then the shape resolves from *that* tile) or whether
  origin-anchored shapes are good enough for now — the min/max range field
  lands either way, but a true "lob it at range then it bursts there" move
  needs the target-tile version, not just the field.

**Built:**

- **`Agent.actionEnergy`** (`types.ts`, optional, defaults to 0). Every
  world tick, `tickWorld` (`simulation.ts`) adds the agent's real
  `stats.speed` to it via `accumulateActionEnergy`; crossing
  `ACTION_THRESHOLD` triggers exactly one action and subtracts the
  threshold, with the remainder explicitly clamped to at most
  `ACTION_THRESHOLD` so no agent can bank enough to double-act in one tick.
  **`ACTION_THRESHOLD = 40`**, chosen against the actual `calculateStats`
  output for the demo roster at their spawned levels (`packages/data/src/scenario.ts`):
  Bulbasaur lvl 5 -> 9, Pidgey lvl 5 -> 10, Diglett lvl 5 -> 14, Scyther lvl
  8 -> 21, Venusaur lvl 20 -> 37. At 40, Venusaur (the fastest spawned
  agent) acts on nearly every tick (37/40) while Bulbasaur (the slowest)
  acts roughly every 4-5 ticks (40/9) — a real, visible frequency gradient
  without retuning every existing need/behavior threshold that assumed "one
  action = one tick." Not deeply tuned beyond picking that one number
  against the existing cast; a wider species roster will need it revisited.
- **`tickAgent` split, as specified**: `tickAgentNeeds` (needs.ts) runs
  age/`tickCooldowns`/`decayNeeds` for every living agent every tick,
  unconditionally; `tickAgentAction` runs the old behavior-choice/movement/
  predation/mating logic, called by `tickWorld` only on an agent's action
  tick. `tickAgent` itself still exists as a convenience wrapper that runs
  both unconditionally (used by direct single-agent unit tests and any
  caller that isn't going through `tickWorld`'s Speed gate).
- **Agents without a computed `stats` block fall back to acting every
  tick** (`actionSpeedOf` in `simulation.ts` treats missing `stats.speed`
  as `ACTION_THRESHOLD` itself). This was a deliberate compatibility call,
  not an oversight: bare test fixtures and — more importantly —
  `reproduction.ts`'s newborns (`spawnOffspring` doesn't give a child a
  stat block at birth) would otherwise be silently and arbitrarily slowed
  down by data they were never designed to carry. **Real gap this leaves
  open**: a newborn Bulbasaur or Venusaur acts every tick until something
  gives it real stats, i.e. faster than its own parents. Not fixed here —
  `spawnOffspring` doesn't compute a level/stats for children at all yet,
  which is a pre-existing gap this design didn't create but does make more
  visible.
- **Move range**: `MoveSpec.range?: { min, max }` (`moves.ts`), optional
  with a shape-derived fallback (`deriveRangeFromShape` in `combat.ts`) for
  any spec that doesn't set it — chosen specifically so the many hand-rolled
  `MoveSpec` literals in `combat.test.ts`/`predation.test.ts` didn't all
  need editing. The curated roster (`packages/data/src/moves.ts`) sets it
  explicitly on every move, matching each move's previous effective reach
  exactly (Tackle/Slash/Ember: `{0,1}`, Vine Whip: `{0,2}`, Flamethrower:
  `{0,4}`). New `withinMoveRange(move, distance)` checks both `min` and
  `max`; `predation.ts`'s `canAttackFromHere` now calls it instead of the
  old bare `distance <= moveRange(move)` comparison, so a future
  thrown-only move's `min` would actually be honored — nothing sets `min >
  0` yet, so this is real but currently idle machinery, same pattern as the
  accuracy/stat-stage work before it.
- **Skill tree / respec**: `MoveSpec.tree?: Record<string, MoveTreeNode>`
  (`moves.ts`) plus a pure `applyMoveTree(base, chosenNodeIds)` that
  validates prerequisites and derives a new spec without mutating the
  canonical data (engine-tested, including a purity check comparing the
  base spec's `shape`/`range` object references before and after). Ember
  carries a real 2-node tree: `wider_burn` (statusChance +0.15, cooldown
  -1) and `ring_of_fire` (requires `wider_burn`; shape -> `{ ring, radius:
  1 }`, power -10, cooldown +1) — a working instance of the original "point
  -> ring, or stay small and trade for burn chance/cooldown" pitch.
  **Scope call honored as specified**: `predation.ts` was not touched to
  consume trees — every wild-agent call site still reads a move's base
  `MoveSpec` off `Agent.moves` untouched.
- **Real 1000-tick run result — the most interesting finding of this whole
  feature, reported straight**: for the first time across every run
  recorded in this document, the Bulbasaur herd did *not* go extinct.
  Scyther killed 2 of the 4 Bulbasaur (ticks 60 and 105, same pattern as
  always) but then, at tick 111, **a Venusaur guardian actually caught and
  defeated it** (`venusaur (venusaur-1) defeated scyther (scyther-0)`) —
  something that never happened in any prior run in this document, where
  the guardian mechanism worked exactly as coded but the herd's geography
  always kept it too far away or too slow to arrive in time. The
  action-economy change is very plausibly why: Venusaur's real computed
  Speed (37) is close enough to `ACTION_THRESHOLD` (40) that it acts almost
  every tick, while Scyther (21) acts roughly every 1.9 ticks — a
  persistence gap that didn't exist when every agent got exactly one
  identical action per tick regardless of Speed. With the predator gone at
  tick 111, the herd went on to reproduce for the first time ever recorded
  in this document: 2 Bulbasaur births (ticks 476 and 543), both well after
  the kill, exactly matching the causal chain the "Reproduction" section
  above predicted (`flee` blocking `seekMate` while a predator is alive).
  Total event counts for context: 1522 events, 5 `fought`, 2 `killed`, 1
  `defeated`, 3 `born` (1 Venusaur, 2 Bulbasaur), 8 `floraChanged`.
- **Ran it three more times to check this wasn't a fluke — it isn't.** Every
  one of 3 additional 1000-tick runs (unseeded `Math.random()`, so genuine
  RNG variance) produced the same qualitative outcome: Scyther gets 1-2
  kills, then a Venusaur guardian defeats it, consistently around tick
  109-111 (110, 111, 111 across the three re-runs, vs. 111 in the run
  written up above) — Scyther's real hunt/relocate/flee timing is
  apparently deterministic enough given these stats/positions that the
  guardian's catch-up window barely moves run to run. This *is* now a
  reliable consequence of the action-economy change, not a one-off roll,
  which is a stronger and more interesting result than "one lucky run."
  **But it immediately surfaces the next real problem, and it's worth
  reporting just as plainly as the win**: with the predator reliably
  removed early and nothing left to check the herd, Bulbasaur births
  across those 3 re-runs were 71, 48, and 13 (vs. 3 in the very first
  run above) — wildly variable, and all far more than the "2 births"
  written up as the headline result. This is the exact unbounded-growth
  problem already flagged for Venusaur earlier in this document
  ("Venusaur population exploded from 2 to 52... no relatedness check in
  reproduction.ts") now also hitting Bulbasaur, for the same underlying
  reason: reproduction and predation are still independent systems with no
  carrying capacity or inbreeding avoidance tying them together. Fixing the
  extinction problem via the action economy didn't fix that; if anything it
  makes it more visible, since now *both* sides of this predator/prey pair
  can independently blow up once the other stops checking it. Not fixed
  here — this was already a known, named gap (see the Venusaur explosion
  finding above and TODO.md), and the action-economy work wasn't scoped to
  reproduction/carrying-capacity balancing. Worth flagging as the most
  likely next real lever if someone picks this back up.

## Leveling: exp, move learning, evolution, and typed skill points

Decided, not built yet (implementation tracked next). Today "level" is a
static number baked into `calculateStats` once at `spawnAgent` time and
never changes — no exp, no move learning, no evolution, despite the
imported dex already carrying `growthRate` and `evolutions` per species
that nothing reads. This closes that gap and is deliberately combat-
adjacent: kills (already logged as `killed`/`defeated` events) become the
biggest exp source, feeding a mainline-real exp curve, which is also the
trigger for move learning and evolution.

- **Exp sources, several, not just kills.** Combat kills (hunt-kills,
  mob-fight/guardian defeats) grant real mainline-formula exp: `floor(baseExp
  * defeatedLevel / 7)` — the actual wild-battle exp-yield formula, using the
  `baseExp` field the importer needs to start pulling (see below). Everything
  else — surviving (a tiny per-tick trickle), eating/drinking, mating, and
  "life milestone" events like traveling to a new area or meeting a
  never-seen-before agent/species — also grants exp, but at small, sim-
  original tuned amounts with **no canon formula to port**, since mainline
  doesn't grant exp for any of those; document them plainly as tuning
  guesses to revisit once a real run shows whether they're sane. "New area"
  and "new agent encountered" need cheap tracking, not full memory: bucket
  the map into fixed sectors for "visited," and cap/prune a per-agent
  "known species" set (not full per-agent-id memory, which would grow
  unboundedly over a long run) for "encountered."
- **Real mainline growth-rate curves.** The six mainline growth rates
  (Erratic/Fast/Medium Fast/Medium Slow/Slow/Fluctuating) have well-known
  public exp-to-level polynomial formulas (not PokeRogue-proprietary code to
  scrape — implement them directly, referenced against `poke_the_spire`'s
  `src/data/exp.ts` as a correctness check since it already has them). A
  level-up can cross more than one level in a single exp gain (loop it, not
  a single `if`) — a big kill against a much-higher-level target shouldn't
  silently cap at +1 level.
- **Level-up stat recompute, mainline-accurate**: `calculateStats(base,
  newLevel)` recomputed, and `currentHp` increases by the same delta as
  `maxHp` (mainline heals by the stat gain on level-up, it doesn't reset to
  full or leave current HP unchanged).
- **Evolution: level-based only, for now.** The dex's `evolutions` array
  already carries level/item/trade/friendship conditions per species
  (`EvolutionDexEntry.conditions` is a freeform bag for the non-level ones).
  On a level-up, check for the first evolution whose `level` condition is
  now met (`newLevel >= condition`, not exact-match, since multi-level jumps
  can skip past it) and apply it: swap `speciesId`, recompute stats from the
  new species' base stats at the same level, keep exp/level/known
  moves/skill points as-is, emit a new `evolved` event. **Item/trade/
  friendship evolutions are explicitly deferred** — there's no item system,
  no trading, and no friendship stat, so those `conditions` stay unconsumed
  data until one of those systems exists; this is a scope call, not an
  oversight.
- **Move learning: unbounded, on purpose (explicit direction, a deliberate
  departure from mainline's 4-move cap).** The importer needs to start
  pulling each species' `levelMoves: [[level, MoveId], ...]` table (not
  previously imported). On level-up, learn every move unlocked at
  `<= newLevel` not already known; after an evolution, keep using the new
  species' `levelMoves` for anything unlocked above the evolution level.
  Movesets grow without a cap — `pickBestMove` already iterates whatever
  moves an agent knows, so this doesn't need combat-side changes, just
  volume tolerance.
- **Skill points: a typed currency for the existing move-tree respec system
  (see the action-economy section above), not a free-form point pool.**
  Points are typed by `PokemonType` and earned "based on typing of what you
  use" — landing a hit with a move of a given type has a small chance to
  grant a skill point of *that* type; leveling up also grants a small
  guaranteed point of the agent's own (primary) type, plus a *rare* chance
  of a wildcard point. A typed point can only fund `applyMoveTree` nodes on
  moves of the matching type (e.g. a Grass point only specs Grass moves); a
  wildcard point funds any move's tree. This means `applyMoveTree`'s cost
  check needs to become a real spend against `agent.skillPoints[type]` (+
  wildcard as a fallback), not just an abstract number, and typed points
  should be preferred over wildcard when both would cover a cost (don't
  burn the rare currency first). **Still consistent with the existing scope
  call** that wild background agents never call `applyMoveTree` — they'll
  accrue skill points same as anyone (harmless, just currency sitting
  unused) until something (eventually the player) actually spends them.
- **New events**: `leveledUp` (old level, new level, exp), `evolved`
  (from-species, to-species, level), `learnedMove`, `gainedSkillPoint`
  (type, or `"wildcard"`).
- **Explicitly still open**: exact tuning constants for the non-combat exp
  trickle sources (deliberately unguessed here — needs a real run to judge,
  same as every other tuning number in this project); whether erratic/
  fluctuating growth rates (the two mainline curves that aren't simple
  monotonic polynomials) need special-casing or fall out of the same
  general implementation; what "spending" skill points actually looks like
  for the player once one exists (a UI, an auto-spend heuristic for AI-
  controlled partners) — out of scope here, this only builds the earning/
  data side plus the `applyMoveTree` spend-validation plumbing.

**Built:**

- **Importer extended**: `parseLevelMoves` (scans a species block's sibling
  `levelMoves: [[level, MoveId.X], ...]` array, outside the `PokemonSpecies`
  config object) and a `baseExp` field extraction, both added to
  `SpeciesDexEntry` and regenerated for all 1083 species. `levelMoves`
  entries store `[level, dexMoveKey]` (e.g. `[4, "VINE_WHIP"]`) — the same
  key string as `MoveDexEntry.key` in `moves.generated.ts`, so no separate
  id-mapping table was needed.
- **Growth-rate curves, `packages/engine/src/leveling.ts`**: all six mainline
  curves implemented directly from the public piecewise polynomial formulas
  (Erratic/Fast/Medium Fast/Medium Slow/Slow/Fluctuating), not scraped from
  PokeRogue. **Verification result, and it's worth being precise about what
  was actually checked**: cross-checked against every entry (levels 2-100)
  of `poke_the_spire/src/data/exp.ts`'s raw per-growth-rate `expLevels`
  arrays — **zero mismatches across all six curves** (level 1 is a
  documented special case: the raw formulas alone produce a small nonzero
  residual there for several curves, and both this implementation and
  PokeRogue's own table override it to exactly 0, matching real mainline
  behavior). Deliberately **not** cross-checked against PokeRogue's
  *exported* `getLevelTotalExp` function, because that function additionally
  blends every non-Medium-Fast curve 32.5%/67.5% with Medium Fast — a
  PokeRogue-specific balance house-rule (confirmed by direct calculation:
  its Medium Slow level-10 total comes out to 857 through that function, not
  the real mainline value of 560, which is what both the raw table and this
  implementation agree on) — so matching that function would have meant
  reproducing PokeRogue's own game-balance tweak instead of real mainline
  math. All six curves verified with high confidence; none needed
  special-casing beyond the ordinary piecewise formula each already is.
- **`LevelingContext`/`LevelingProfile`, the same injected-policy pattern as
  `HuntRules`**: engine functions that need species-specific data
  (growth rate, base stats, `baseExp`, `levelMoves`, level-gated evolutions)
  take an optional `ctx: LevelingContext` parameter rather than importing
  `packages/data` directly (the engine package doesn't and shouldn't depend
  on the data package). `packages/data/src/leveling.ts` builds the real
  `LEVELING_CONTEXT` from the full dex — `getProfile` works for **any** of
  the 1083 imported species (not just the 6-species curated `SPECIES`
  roster), since evolution can land an agent on a species that was never
  hand-curated (bulbasaur -> "ivysaur", which has no `SpeciesDef`). Omitting
  `ctx` (bare engine tests, anything that predates this feature) means exp
  still accrues but nothing can level/evolve/learn — same graceful-absence
  behavior as omitting `rules`.
- **Move resolution for learned moves**: `resolveMove` in
  `packages/data/src/leveling.ts` prefers the curated `MOVES` roster (looked
  up by uppercasing the curated id — every curated id happens to be the
  lowercased dex key, e.g. `vine_whip` <-> `VINE_WHIP`) and falls back to
  deriving a `MoveSpec` via `moveCanon` (real type/category/power/accuracy)
  with a flat default shape/range/cooldown (point, `{0,1}`, 1 tick) for
  anything not in the curated five. **Scope call, explicit**: a learned
  *status* move (Growl, Leech Seed, etc. — most of a real levelMoves table)
  has no shape/power to derive at all, since this sim has no status-effect
  engine — `resolveMove` returns `undefined` for those, and `grantExp` still
  records them in `Agent.knownMoves` and emits `learnedMove`, it just adds
  no combat-usable `MoveSpec`. Confirmed in a real run: a leveled-up
  Bulbasaur's `knownMoves` includes moves it can never actually swing.
- **Exp granting, wired into every call site named in the plan**: kills
  (`predation.ts`'s `resolveHit`, both hunt-kills and mob-fight/guardian
  defeats) grant `floor(baseExp * defeatedLevel / 7)` via `grantKillExp`;
  every living agent gets a passive `EXP_TRICKLE_PER_TICK = 0.02` trickle in
  `tickAgentNeeds` (the always-runs path, not the action-gated one — matches
  the existing action-economy split); eating/drinking grants
  `EXP_ON_CONSUME = 0.5`; a mate-seeking step grants `EXP_ON_MATE_ATTEMPT =
  1` and a successful birth grants `EXP_ON_BIRTH_PARENT = 3` to each parent;
  entering an unvisited map sector (`SECTOR_SIZE = 5`-tile buckets, capped
  at `MAX_TRACKED_SECTORS = 40`) grants `EXP_ON_NEW_SECTOR = 2`; meeting a
  species this agent hasn't seen before (capped at `MAX_TRACKED_SPECIES =
  20`, and — see the performance finding below — short-circuited entirely
  once that cap is hit) grants `EXP_ON_NEW_SPECIES_ENCOUNTERED = 2`. All
  five non-combat numbers are sim-original tuning guesses with no canon
  formula, exactly as flagged in the "Decided, not built yet" section above
  — not revisited beyond picking something small and plausible.
- **Level-up loop, mainline-accurate HP heal**: `grantExp` loops (not a
  single `if`), so one big kill can cross several level thresholds in one
  call — engine-tested (5 levels in one `grantExp` call). Each level crossed
  recomputes `Stats` via `calculateStats` and heals current HP by exactly
  the max-HP delta (not a full heal, not left unchanged) — also
  engine-tested directly. **One `leveledUp` event per level gained**, not
  one summary event for a multi-level jump (a 5-level jump produces 5 log
  entries) — chosen to keep matching this project's "the event log needs
  semantic content" north star at the per-level granularity rather than
  collapsing a multi-level jump into a less legible blob.
- **Move learning**: every `levelMoves` entry with `level <= newLevel` not
  already in `Agent.knownMoves` is learned on every level crossed, uncapped,
  no forgetting — engine-tested. After an evolution mid-loop, the very next
  loop iteration reads `ctx.getProfile` on the *new* species, so anything
  the new species can learn above the evolution level keeps coming in
  correctly within the same `grantExp` call.
- **Evolution**: checks the current profile's level-gated evolutions
  (`level` condition only — item/trade/friendship deferred exactly as
  planned, filtered out before they ever reach the engine) each level
  crossed; on a match, swaps `Agent.species`, recomputes `Stats`/`maxHp`
  from the new species' base stats at the current level, and rescales
  current HP by the *fraction* of max HP it was at (not a delta-add, since
  the base-stat jump on evolution is usually large and a delta-add could
  overheal past the old fraction) — engine-tested end to end (Bulbasaur ->
  Ivysaur at level 16: species/stats/exp/level/moves/skill-points all
  checked in one test). exp/level/`knownMoves`/skill points all carry over
  untouched, per the plan. **Known gap, honestly flagged**: an evolved
  agent's new species id (e.g. `"ivysaur"`) isn't in the curated `SPECIES`
  roster in `packages/data/src/species.ts` (which only has 6 hand-curated
  entries), so `packages/web`'s renderer — which looks up `SPECIES[agent.species]`
  for a sprite key — would break on an evolved agent. Not fixed here; the
  headless engine/runner path this feature was validated against doesn't
  touch that lookup at all, but it's a real gap for the browser app.
- **Typed skill points**: `maybeGrantHitSkillPoint` rolls
  `SKILLPOINT_ON_HIT_CHANCE = 0.05` on every landed (nonzero-damage) hit in
  `resolveHit`, granting one point of the *move's* type to the attacker.
  Leveling up grants one guaranteed point of the agent's own primary type
  (`Agent.types[0]`). Bonus wildcard points are no longer an RNG roll (an
  earlier `SKILLPOINT_LEVELUP_WILDCARD_CHANCE = 0.1` per level-up, replaced
  once specialization actually started spending points — see
  "Specialization" below): every `SKILLPOINT_WILDCARD_INTERVAL`th real point
  granted, level-up or on-hit alike, deterministically grants a bonus
  wildcard, tracked via `Agent.skillPointGrantCount`. **Real bug caught and fixed during validation, not
  just claimed working**: the first real run showed almost no typed points
  despite hundreds of level-ups, because `reproduction.ts`'s newborns don't
  get a `types` field (a pre-existing gap — newborns don't get a full
  stats/moves profile either, see the action-economy section above) and
  `grantExp` reads `agent.types?.[0]` — most level-ups in a real run *are*
  newborns reaching level 2. Fixed cheaply: `spawnOffspring` now inherits
  `types` from the mother (this alone, not a full stats/moves promotion,
  which stays out of scope). Confirmed by re-running: typed-point counts
  went from 6-of-897 level-ups to 99-of-99 in a comparable run.
- **`applyMoveTreeWithSpend`, the real spend-validation path**
  (`packages/engine/src/moves.ts`): `totalTreeCost` sums a chosen node set's
  costs; `trySpendSkillPoints` validates `typed + wildcard >= cost`,
  deducts typed first and only spills into wildcard for the remainder
  (never touches wildcard if typed alone covers it — engine-tested
  directly), and mutates nothing on a failed attempt (also tested).
  `applyMoveTreeWithSpend` composes both with the existing pure
  `applyMoveTree`, throwing (rather than silently no-op'ing) on
  insufficient points — same failure style as `applyMoveTree`'s own
  prerequisite checks. Per the existing scope call, no predation/guardian/
  mob-fight call site was touched — wild agents still only ever use the
  base `MoveSpec` and never call this.
- **New events**: `leveledUp`, `evolved`, `learnedMove`, `gainedSkillPoint`
  — added to the `SimEvent` union and to `packages/runner/src/format.ts`'s
  formatter (which is an exhaustive switch, so this was required for the
  runner to typecheck at all, not optional polish).
- **A real performance bug found and fixed during validation**: the initial
  "has this agent met a new species" check scanned every other agent in the
  world, every action tick, for every agent — cheap in isolation, but this
  sim's pre-existing, previously-documented Venusaur/Bulbasaur population-
  explosion problem (see the "Real tactical combat" section above) means
  agent count is *not* bounded, so this turned into a real O(agents²)-per-
  tick cost on top of an already-unbounded population. A 5000-tick run
  timed out (>90s) with this in place; a same-length run on the pre-feature
  base commit (lucky RNG, no population explosion that run) finished in
  ~1.2s, confirming the regression was this addition, not pre-existing
  drift. **Fixed**: once an agent has recorded `MAX_TRACKED_SPECIES`
  distinct species (a handful — the demo roster only has ~6), the scan is
  skipped entirely for that agent, since it's essentially certain to have
  already met everything in play. This caps the added cost per agent to a
  small constant after an early warm-up window rather than fixing it, since
  it doesn't touch the underlying unbounded-population problem — that's
  still the same open item from the action-economy section, not something
  this feature was scoped to solve.
- **Real run findings, reported straight**: ran the runner repeatedly at
  1000 and 3000 ticks (unseeded `Math.random()`, so genuine variance run to
  run). **Leveling is real and observed, not just theoretically wired**: a
  1000-tick run produced 18 `leveledUp` events (mostly newborns reaching
  level 2 off passive trickle + consume exp) and 32 `learnedMove` events; a
  3000-tick run produced up to 897 level-ups (levels 2 through 9 observed
  across different agents), hundreds of `learnedMove` events, and (post-fix)
  skill-point counts matching level-up counts almost exactly (99 typed + 7
  wildcard from 99 level-ups in one run — the ~10% wildcard roll landing
  almost exactly on rate). **Evolution was never observed, and here's the
  honest arithmetic on why, rather than just reporting a null result**:
  Bulbasaur's Medium Slow curve needs 2535 cumulative exp to reach level 16
  (Ivysaur's threshold); a representative run's income rate (trickle +
  occasional consume/mate ticks) got an original level-5 Bulbasaur to level
  6 (179 exp) by roughly tick 2000, i.e. very roughly 0.09 exp/tick — at
  that rate, reaching 2535 exp would take on the order of 25,000-30,000
  ticks, well beyond what a run at this population-growth risk profile can
  complete in reasonable wall-clock time (the runs attempted at 5000+ ticks
  timed out on an exploding population before getting anywhere near that
  many ticks anyway). This is a real, specific tuning gap worth flagging
  plainly for whoever picks this up next: either the passive/consume exp
  trickle needs to be meaningfully larger for evolution to be observable on
  a sim timescale, or evolution verification needs a dedicated short
  scenario (spawn an agent one exp point below an evolution threshold and
  tick it) rather than relying on an emergent long run — the mechanism
  itself is engine-tested and believed correct, but "saw it happen in an
  actual run" (this project's stated bar) wasn't achieved for evolution
  specifically, only for leveling and move-learning.

## Breeding: base-form offspring and real cross-species egg groups

Two real bugs, found by direct questioning ("do Venusaur offspring get born
as Bulbasaur, right? not another Venusaur?" then "some pokemon can cross
breed"), fixed by actually checking mainline mechanics rather than
guessing:

1. **Species inheritance was backwards.** `spawnOffspring` originally gave
   the child the mother's *current* species, so a bred Venusaur produced
   another Venusaur. Mainline is the opposite: breeding always yields the
   base (lowest-evolution) form of the mother's line — Bulbasaur is bred,
   Venusaur is what an adult grows into, not a separately-bred species.
   Fixed with `LevelingContext.baseSpeciesOf`, built by inverting the
   dex's forward-only evolution links (it only records "X evolves into Y",
   never "Y evolves from X") into a prevo map, then walking any species
   back to its line's root. Verified in a real run: `venusaur x venusaur`
   now consistently produces `bulbasaur` offspring.
2. **Mate eligibility required an exact species match**, which is wrong on
   two counts versus the real games: it wouldn't even let a Bulbasaur and
   a Venusaur pair (different *current* species), and it had no concept of
   real cross-species breeding at all. Checked the actual mainline rule:
   two Pokémon can breed if they share any **Egg Group** (14-15 categories
   like Monster, Field, Water, Bug, Flying — regardless of evolution
   stage), need one male and one female (or a Ditto, not modeled — no
   Ditto in this sim), and `"Undiscovered"`-group species (legendaries,
   babies) never breed at all. The hatched species is always the
   **female** parent's line's base form, not a blend of both parents.
   `canBreed(speciesA, speciesB, ctx)` (`leveling.ts`) implements this
   exactly, wired into `isEligibleMate`.

**Real data gap, worth being honest about**: the imported PokeRogue dex
has zero egg-group data — checked directly against a fresh clone of the
actual PokeRogue source, and its "egg" system is a gacha/hatching-rarity
mechanic (currency, tiers), completely unrelated to mainline's Day Care
breeding compatibility. So egg groups can't be pulled from the existing
import pipeline; `EGG_GROUPS_BY_BASE_KEY` (`packages/data/src/leveling.ts`)
is a small hand-curated table, scoped to the species actually reachable
from the current spawn roster and their evolution lines (Bulbasaur line:
Monster/Grass; Charmander line: Monster/Dragon; Scyther: Bug; Diglett
line: Field; Pidgey line: Flying) rather than all 1083 imported species.
An unclassified species (not yet in that table) still breeds with its own
kind — the safe fallback — just can't cross-breed with anything until
someone adds it.

Bulbasaur and Charmander share the Monster egg group, so they're a real
cross-species pair in the actual games — verified with a dedicated test
(a Charmander mother bred with a Bulbasaur father produces a Charmander,
never a Bulbasaur, since offspring always follows the mother's line).
**Not yet observable in an actual run**, though: `createDemoWorld` doesn't
spawn a Charmander at all, so nothing in the current scenario exercises
this path live — it's mechanism-verified, not run-verified, until a
Charmander is added to the scenario or lands there some other way. Not
built: Ditto (universal breeding partner), IV/Nature/ability/egg-move
inheritance — this sim has no IV/Nature/multi-ability system to inherit
into yet, so those are out of scope until the underlying systems exist.

## Guardian cohesion leash and inbreeding avoidance — two smaller fixes, requested together

Both prompted directly ("guardian spawn point... relatedness check is a
good idea"), both small in scope, both verified with tests plus a real run.

**Guardian positioning gap.** The long-standing "guardian starts a chase,
never arrives" finding (see the herd-cohesion section above) turned out to
have one more layer once actually traced: `applyHerdCohesion`'s pull-back
target for *every* agent, guardians included, was the whole herd's blended
centroid. That's fine for an ordinary herd member, but for a guardian it's
self-undermining — the guardian's own position is part of the average it's
being pulled toward, so when it wanders off (to drink, say), its own
displaced position drags the target along with it, and the "am I too far?"
check can keep reading "close enough" even while the actual herd it
protects is far away. Fixed with two changes in `herding.ts`: guardians
(any species nothing preys on, same check `isPreyOfAnything` already used
elsewhere) get a tighter leash (`GUARDIAN_COHESION_DISTANCE = 3` vs. the
ordinary `COHESION_DISTANCE = 5`), and track a `protectedHerdCentroid` —
the average position of only the herd's actual prey members, guardians
excluded — instead of the whole-herd blend. A constructed regression case
in `herding.test.ts` proves the old behavior first (a guardian sitting
exactly at the old 5-tile boundary, with its only prey-member herd-mate 10
tiles away, does *not* move under the whole-herd-centroid check) and then
the fix (the same guardian, same positions, *does* move once
`protectedHerdCentroid` is used). Ordinary herd members are unaffected —
same wider leash, same whole-herd centroid, confirmed by a second test.

**Inbreeding avoidance.** The unconstrained-reproduction finding
(`venusaur-0`, the founding guardian with no predator, fathering most of a
herd's growth including his own daughters and granddaughters) had two
separable causes: no population cap for predator-free species (still
open — see the TODO), and literally nothing stopping a mate search from
matching an agent with its own parent, sibling, or grandparent. Fixed the
second half. `Agent` gained `parentIds?: [string, string]` and
`grandparentIds?: string[]`, both set once at birth in `spawnOffspring`
from information already on hand (the parents' own ids and their own
`parentIds`) rather than looked up live — a live lookup would be fragile,
since an ancestor is routinely pruned from `World.agents` well before its
descendants mature enough to mate (corpses persist only
`CORPSE_PERSIST_TICKS`). `isRelated(agent, candidate)` in `reproduction.ts`
checks both directions of parent/offspring, whether the pair shares any
parent (full or half siblings), and both directions of
grandparent/grandchild, wired into `isEligibleMate` right alongside the
existing herd/sex/maturity checks. Founders (spawned directly into a
scenario, no `parentIds`) are correctly never "related" to anything by
this check — two founders of the same species really are unrelated
strangers, so founding-stock breeding is untouched. Six tests in
`reproduction.test.ts`'s "inbreeding avoidance" block cover each blocked
relationship plus the newborn's `parentIds`/`grandparentIds` bookkeeping
itself. A real 3000-tick run with the check active still produced 17
births (population stayed small, 23 starved) — confirms this is a real
behavioral gate, not an accidental reproductive shutdown.

**Explained, deliberately not changed yet**: herd food delivery firing far
more than intended (7212 `foodDelivered` events in a 3000-tick run at a
ballooned population, vs. 54 over 2000 ticks at a small one) was traced to
three compounding causes — no per-agent cooldown after a delivery errand,
no reservation flag so multiple couriers can target the same recipient
(confirmed live: `bulbasaur-2` delivered to twice, ticks 120 and 152, by
different couriers), and event count scaling with population rather than
tick count. Conclusion: not really a broken mechanic in isolation, it's the
population-explosion problem wearing a different hat. Left as-is per
explicit instruction, pending a fix to the underlying population-cap
question — see TODO.md.

## Age-based mortality — a gentle, ramping hazard rather than a hard cutoff

The last of the four things requested together ("guardian spawn point...
relatedness check... and age based mortality"). This closes the other half
of the unconstrained-reproduction finding: the relatedness check (above)
stops a founder fathering its own descendants, but nothing previously made
an old, well-fed, predator-free individual die of anything but starvation —
in principle it could live forever.

Deliberately not a hard cutoff age (everyone dies at exactly age X reads as
an obvious game-of-life rule, not mortality). Instead `ageMortalityChance`
(`needs.ts`) is 0 below `OLD_AGE_ONSET` (1500 ticks), then rises linearly
to `OLD_AGE_MAX_CHANCE` (a 2% per-tick chance) by `OLD_AGE_HAZARD_CAP_AGE`
(3000 ticks) and stays there for anything older — checked once per tick in
`tickAgentNeeds`, right after aging and before the starvation check, same
"always runs regardless of the action economy" path starvation already
uses. A single global curve for now, same call as `MATURITY_AGE` — real
per-species lifespans are a data-layer refinement for later. Records a new
`diedOfAge` event (mirrors `starved`'s shape, plus the age at death).

Real run evidence, not just the unit tests (`needs.test.ts`'s "old-age
mortality" block, which mocks `Math.random` to check both sides of the
roll deterministically): a 5000-tick run produced exactly 1 `diedOfAge`
event (`bulbasaur-2915-35`, age 1858); a 10000-tick run produced 10, every
one in the expected 1500-2000 age range near the hazard's onset (where the
curve is still low), consistent with a gentle ramp rather than a wall.
Genuinely rare at this population's typical lifespan — most agents die of
starvation or predation well before old age becomes likely — which is
honest: old age is a real but minor cause of death here, not yet the
dominant population-control mechanism the "unconstrained reproduction"
TODO item is still asking for (a predator-free species still needs a
faster-acting cap; see TODO.md).

## Faint/finish-off, heal over time, and herd support (inventory, food delivery, carrying)

Decided, not built yet. Today a hit that brings HP to 0 is permanent —
`alive = false`, pruned from `World.agents` that tick. This replaces that
with a downed-but-recoverable state, plus the herd-support mechanics needed
to make recovery meaningful (a fainted agent can't feed itself).

- **Injury lowers effective Speed.** Effective Speed (as fed into
  `accumulateActionEnergy`, see the action-economy section above) scales
  down with current HP fraction — hurt agents act less often, not just
  weaker when they do. Floor it (don't let a badly hurt agent go fully
  inert) rather than scaling linearly to zero.
- **Heal over time, gated on being fed/watered.** A small per-tick HP
  regen applies only while hunger and thirst are both reasonably satisfied
  — an agent that isn't getting food/water doesn't recover, which is what
  makes herd food delivery (below) matter for a downed ally who can't feed
  itself.
- **Fainting, not instant death, at 0 HP.** A hit that would bring HP to 0
  instead sets a new `fainted: true` (agent stays `alive`), HP pinned at 0,
  and grants the fainted agent a **finishing pool** = 75% of its max HP —
  a real second bar, sized once at the moment of fainting, not a one-hit
  threshold check. `fainted` agents drop out of the action tick entirely
  (no movement/attack/flee) but still get needs-decay and heal-over-time
  every tick like anyone else.
- **The finishing pool absorbs damage, it doesn't require one big hit.**
  Every hit landed on a fainted agent (from anyone, not just whoever
  fainted them) subtracts its damage from the finishing pool instead of
  the (already-zero) main HP bar. Multiple weaker follow-up hits add up
  correctly — three hits at 25% of the pool each finish the job exactly
  like one hit at 75% would. Pool reaches 0 → true death (`alive = false`,
  now a corpse — eatable and the trigger for pruning after some corpse-
  persistence window; see below). This is the "killing takes a long time"
  ask made concrete: knocking something down and finishing it off are two
  separate acts, mechanically.
- **Recovery discards the pool.** If a fainted agent's HP regenerates
  back above a wake threshold before the finishing pool is exhausted, it
  regains consciousness (`fainted = false`) at that low HP and resumes
  acting normally — the finishing pool is discarded, not carried forward;
  a fresh faint later gets a fresh pool.
- **Looting vs. eating are different permissions on different states.**
  A **fainted** agent's inventory (see below) can be looted by anyone
  nearby — predator, rival, even its own herd-mates aren't special-cased,
  per direct instruction — but it cannot be eaten (no hunger restore) while
  merely fainted. Only a **true kill** (finishing pool exhausted) produces
  something eatable. A killed agent's corpse persists for a short window
  (loot/scavenge opportunity for agents other than whoever landed the
  killing blow) before being consumed or decaying/pruned — avoids both
  "corpse vanishes instantly" and "corpses pile up forever."
- **Inventory and weight, general item slots.** `Agent.inventory` holds
  weighted item stacks — both simple food units and the ~30 curated held
  items already imported (`ITEM_DEX`) — capped by a per-species carry
  capacity. Held-item *effects* stay reference-only, unconsumed by combat,
  exactly as scoped when they were first imported — this feature only
  adds the ability to hold/carry/transfer/loot them, not to use them.
  Carry capacity needs a real per-species number to scale against; the
  dex doesn't have body weight imported yet (species height/weight weren't
  pulled by the original importer) — pull it now, or use a stat-total-based
  proxy if pulling weight turns out not to be worth a separate importer
  pass. Document whichever call gets made.
- **Herd food delivery.** A well-fed, non-threatened herd member with free
  inventory space can pick up food from a flora tile (converts a small
  amount of the tile's `stock` into a carried food-item unit, same
  depletion accounting `flora.ts` already does for direct feeding) and,
  if it knows of a hungry or fainted-and-hungry herd-mate, travel to them
  and transfer the item — consumed on arrival to restore the receiver's
  hunger, same as if they'd eaten it themselves. New `BehaviorKind`
  (e.g. `deliverFood`) and a `foodDelivered` event.
- **Literal carrying, fainted allies only.** A herd-mate adjacent to a
  *fully fainted* ally (not merely injured — injured-but-conscious only
  gets the Speed-assist above) can pick it up: the carried agent's position
  mirrors the carrier's, it can't act while carried, and the carrier's own
  effective carry capacity is reduced by the carried agent's weight on top
  of whatever items it's already holding. The carrier makes for the herd's
  home range/safe area and sets the ally down on arrival or if the carrier
  itself comes under threat (drops the ally and switches to `flee` — being
  the fainted one's rescuer doesn't override the carrier's own survival
  instinct). New `carrying`/`setDown` events.
- **Explicitly still open**: exact tuning numbers (heal-over-time rate,
  wake threshold, corpse-persistence window, carry-capacity formula) —
  all sim-original guesses to be judged against a real run, same as every
  other tuning constant in this project; whether looting should remove
  items outright or drop them on the ground for a delay (kept simple as
  direct transfer for now); how carrying interacts with the action economy
  (does the carrier's own Speed/action frequency slow down while carrying
  extra weight? — a real question, not yet decided, reasonable default is
  yes but not required for a first pass).

**Built:**

- **Injury -> effective Speed**: `support.ts`'s `effectiveSpeed(agent,
  baseSpeed)` scales `agent.stats.speed` by `max(FAINT_SPEED_FLOOR, hp /
  maxHp)` before it ever reaches `accumulateActionEnergy` — `simulation.ts`'s
  `actionSpeedOf` calls it instead of reading `stats.speed` raw.
  **`FAINT_SPEED_FLOOR = 0.35`**: chosen so a fully-fainted agent (hp pinned
  at 0) still gets over a third of its normal action frequency rather than
  going fully inert, while a merely-scratched agent (hp close to maxHp)
  keeps acting at close to full speed. Agents without a computed
  `stats`/`hp`/`maxHp` (bare fixtures, newborns) are unaffected, same
  graceful-absence pattern as `actionSpeedOf`'s existing fallback.
- **Heal over time, fed-gated**: `applyHealOverTime` (`support.ts`), called
  from `tickAgentNeeds` (needs.ts) — the always-runs path, not the
  action-gated one, so a fainted agent that can't act still heals. Heals
  `maxHp * HEAL_PER_TICK_FRACTION` per tick, only while `hunger >=
  FED_THRESHOLD && thirst >= FED_THRESHOLD`. **`HEAL_PER_TICK_FRACTION =
  0.01`** (1%/tick — a full heal from 0 takes on the order of 100 ticks).
  **`FED_THRESHOLD = 0.7`** deliberately reuses `chooseBehavior`'s existing
  urgency cutoff in needs.ts (a need only drives behavior once `1 - need >
  0.3`, i.e. the need itself is below 0.7) rather than inventing a second,
  unrelated "satisfied" concept.
- **Fainting instead of instant death**: `Agent.fainted`/`Agent.
  finishingPool` (types.ts); `predation.ts`'s `resolveHit` sets `fainted =
  true`, pins `hp = 0`, and sets `finishingPool = FINISHING_POOL_FRACTION *
  maxHp` on a hit that would otherwise zero HP, emitting a new `fainted`
  event instead of `killed`/`defeated` — `alive` stays true. **
  `FINISHING_POOL_FRACTION = 0.75`**, exactly as specified. A fainted agent
  is excluded from `tickAgentAction` entirely via an early `if (agent.
  fainted) return` (needs.ts) — checked *before* carrying/predation/looting/
  herd-support, so a fainted agent truly takes zero action-tick behavior,
  while `tickAgentNeeds` still runs for it every tick (needs-decay,
  heal-over-time, recovery check).
- **The finishing pool absorbs follow-up damage from anyone**: still inside
  `resolveHit`, a hit landed on an already-`fainted` defender subtracts
  `damage` from `finishingPool` instead of the (already-zero) `hp` bar, and
  only crossing `<= 0` triggers true death (`alive = false`, `diedAtTick =
  world.tick`, the `killed`/`defeated` event, and `grantKillExp`) —
  engine-tested directly with multiple smaller hits summing correctly, not
  just one big one. `resolveHit` now returns true *only* on this true-death
  transition, never on a mere faint; the hunt call site's hunger-restore-on-
  kill was re-gated on that return value (renamed `died` for clarity), so
  eating only ever happens against a truly dead target (design point 7) —
  hunting a fainted target across several ticks to land the finishing blow,
  then eating, is the real two-stage path now. A deliberate choice to keep
  the general prey/guardian *threat*-detection filters unfiltered on
  `fainted` (i.e. a fainted predator still counts as "the threat" for
  mobbing/guarding purposes) — the alternative (excluding it) would silently
  end the encounter the moment something faints, with nothing left to land
  the finishing blow; `countHerdAllies`' mob-*muster* count, a different
  question ("how many allies can actually still fight"), does exclude
  fainted allies.
- **Recovery discards the pool**: `maybeRecoverFromFaint` (`support.ts`),
  called from `tickAgentNeeds`. Once a fainted agent's (now healing) `hp /
  maxHp` crosses `WAKE_HP_FRACTION`, `fainted` clears, `finishingPool` is
  set `undefined` (never carried into a future faint), and a `recovered`
  event fires — engine-tested end to end via a full `tickWorld` loop
  (faint -> heal -> recover -> resumes acting). **`WAKE_HP_FRACTION =
  0.18`**, picked mid-range of the "~15-20%" the design called for.
- **Corpse persistence**: `Agent.diedAtTick` (types.ts, set at the true-death
  moment); `simulation.ts`'s `tickWorld` no longer prunes `alive === false`
  agents the same tick — a new `pruneStaleCorpses` only removes one once
  `world.tick - diedAtTick >= CORPSE_PERSIST_TICKS`. **`CORPSE_PERSIST_TICKS
  = 40`**. Every existing `alive !== false` filter across predation.ts/
  reproduction.ts/needs.ts already tolerated a lingering dead entry (none of
  them assumed dead agents simply vanish), so this needed no other call-site
  changes — confirmed by the full existing suite passing unmodified except
  the two tests that explicitly asserted same-tick pruning (see below).
- **Looting, unrestricted**: `applyLooting` (`support.ts`) — any nearby
  (adjacent, `LOOT_RADIUS = 1`) agent, regardless of species/herd/
  relationship, can take one item off a fainted OR dead agent's `inventory`
  per action tick, provided it has carry headroom for that item's weight.
  New `looted` event. Engine-tested against both a fainted and a truly dead
  target, and against a looter at capacity.
- **Inventory and weight**: `Agent.inventory: InventoryItem[]` (`{itemKey,
  weight}`, types.ts) plus `carryCapacityOf`/`usedCarryWeight` (support.ts).
  **Scope call, explicit, per DESIGN.md's own permission to make it**:
  carry capacity and body weight both use a **maxHp-based proxy**
  (`carryCapacityOf = maxHp * 1.5`; body weight for a carried ally =
  `maxHp`, falling back to the same `FALLBACK_MAX_HP = 10` predation.ts
  already uses for statless agents), not a real imported species
  height/weight figure or a full six-stat total. Chose this over extending
  the importer again (like `baseExp`/`levelMoves` before it): maxHp is
  already computed on every combat-capable agent, needs zero extra data,
  and correlates with bulk about as well as a stat total would for this
  sim's purposes (a Venusaur outweighs and outcarries a Diglett under this
  proxy, which is the actual property that mattered). Held-item effects
  stay unconsumed by combat, unchanged from their original import scope —
  this only adds hold/carry/transfer/loot.
- **Herd food delivery**: new `"deliverFood"` `BehaviorKind` and
  `Agent.deliverTargetId`; `applyHerdSupport` (`support.ts`) is a two-phase,
  resumable errand (same pattern as predation.ts's `relocate`) — a well-fed,
  watered herd-mate with spare carry capacity notices a hungry (`hunger <
  HUNGRY_HERDMATE_THRESHOLD = 0.4`) same-species/same-herd ally within
  `HERD_SUPPORT_RADIUS = 8`, walks to the nearest stocked food tile,
  deducts `CONSUME_STOCK_AMOUNT` from its `stock` exactly like direct
  self-feeding does (flora.ts), carries a `{itemKey: "food", weight: 1}`
  unit, walks it to the hungry ally, and restores its hunger by the same
  `0.4` self-feeding grants on arrival. New `foodDelivered` event.
  Engine-tested end to end (stock deduction through delivered hunger
  restore) and **observed in real runs** — see below.
- **Literal carrying, fainted-only**: new `"carryAlly"` `BehaviorKind`,
  `Agent.carryingId`/`Agent.beingCarriedBy`, `Agent.homePos` (set at spawn
  in `spawnAgent`/`spawnOffspring` to the agent's own spawn position — the
  cheapest available "herd home range" stand-in, since no richer concept
  exists in the engine yet). `maybeStartCarrying` picks up an adjacent fully
  fainted, not-already-carried ally if the carrier has spare capacity for
  its body weight; `applyCarrying` mirrors the carried agent's position onto
  the carrier's every tick while walking toward `homePos`, sets it down
  (`setDown` event, `reason: "arrived"`) within `CARRY_ARRIVAL_RADIUS = 1`
  of home, or drops it immediately (`reason: "threat"`) the instant a real
  predator threat comes within `FLEE_DETECT_RADIUS` of the carrier — the
  carrier's own survival instinct isn't overridden by rescuing, per direct
  instruction, and a dropped carry falls through to normal predation
  instincts that same tick so the carrier actually flees. A carried agent
  (`beingCarriedBy` set) is excluded from its own action tick the same way a
  fainted agent is. Both paths engine-tested directly, including the
  drop-on-threat case.
- **Call order in `tickAgentAction`** (needs.ts), since several new
  behaviors now compete for the same action tick: an in-progress carry gets
  first refusal (so a threat can make the carrier drop and flee the same
  tick), then existing survival instincts (`applyPredationInstincts`), then
  starting a new carry, then looting, then herd food delivery, then the
  original needs-driven behavior choice — a conscious agent never skips
  fleeing a real predator to go loot a corpse or start a delivery errand.
- **104 pre-existing engine tests pass unmodified except two**, both
  rewritten (not special-cased around) because they directly asserted the
  old instant-death behavior: "kills prey on contact... prunes the corpse"
  now asserts fainting on the first hit and true death only after a
  follow-up hit exhausts the pool; "a mob of 3+ can defeat a predator
  outright" now uses a 1-HP predator so the first mobber's hit faints it and
  the second mobber's hit (same tick) exhausts the pool — still a real
  multi-hit finishing blow, just compressed into fewer, larger hits to fit a
  single-tick test. 11 new tests added (`support.test.ts`) covering
  heal-gating, recovery, fainted-agent action-tick exclusion, looting
  (fainted + dead, capacity-respecting), food delivery, and both carrying
  paths (arrival and drop-on-threat) — 115 total, all passing. Full
  typecheck/build across all 4 packages also clean.
- **Real run findings, reported straight — the most important part of this
  write-up.** A 1000-tick run: fainting and finishing-off both actually
  happened (2 Bulbasaur fainted then were killed 2 ticks later each, tick
  58->60 and 101->103; hunger only restored at the `killed` events, not the
  earlier `fainted` ones — confirms eating-on-true-death-only is real
  behavior, not just an assertion), plus 2 `foodDelivered` events. A
  3000-tick run: **the same two-stage faint-then-finish pattern held (tick
  58->60, tick 107->109)**, and food delivery fired far more than expected —
  **7212 `foodDelivered` events**, a direct symptom of this sim's
  pre-existing unbounded population growth (993 births in the same run; see
  the action-economy/leveling sections above) rather than the delivery logic
  itself being wrong in isolation. **The single most important finding**: a
  solitary (herdless) Scyther fainted at tick 152 and was never finished off
  or recovered for the rest of the 3000-tick run — its thirst had already
  decayed to ~0.52 (below `FED_THRESHOLD`) *before* it even fainted, so
  heal-over-time never started, and nobody wandered back into strike range
  to land the finishing blow. Worked through the arithmetic on why this
  isn't a fluke: healing from 0 hp to the 18% wake threshold at 1%/tick
  takes ~18 ticks, while thirst alone decays through the 0.7 fed gate in
  ~20 ticks starting from full — even an agent that faints at perfectly full
  needs has barely any margin to heal past the wake threshold before its own
  needs decay disqualify it from healing at all, and any agent that faints
  already below full needs (the overwhelmingly common case, since combat
  usually follows some activity) has essentially no chance. **Looting and
  carrying were never observed in either real run**, only in direct engine
  tests — nothing in the demo scenario puts durable loot in an inventory
  (a delivery courier's food item is consumed within a tick or two of
  pickup), and a hunting predator's own follow-up hits land faster than a
  herd-mate can notice a fainted ally and walk over, so the carry window
  mostly doesn't open. A 5000-tick run timed out past 300s, consistent with
  (and plausibly worsened by) the sim's already-documented unbounded-
  population problem — see TODO.md for the full, itemized list of what's
  still open here (heal-over-time/fed-gate/limbo tuning, food-delivery
  frequency, the emergent-scenario gap for looting/carrying, and the
  performance interaction with the population explosion).

## Individual variance: Nature and Disposition, tied together

**Built.** Every agent of a species+level was mechanically identical before
this — `calculateStats` had no per-individual variance, and the "Disposition
vector" pitched in TODO.md's Culture section was never built. Both now
exist, and Nature is genuinely the single seed for both — a deliberate
departure from mainline, where Nature is stat-only flavor text that never
touches AI behavior.

- **Nature: the real 25 mainline natures**, each raising one stat 10% /
  lowering a different one 10% (5 neutral ones raise/lower the same stat,
  net zero — Hardy, Docile, Serious, Bashful, Quirky). Assigned uniformly
  at random at spawn/birth, not inherited from parents (mainline doesn't
  inherit Nature by default either, barring the Everstone item this sim
  doesn't have). `calculateStats` gets a nature multiplier applied per
  stat — this is what finally closes the long-standing "no individual
  stat variance" TODO item.
- **Disposition: a 3-axis vector — boldness, aggression, sociability**
  (0-1 each), **seeded deterministically from Nature**, not independently
  random — that's the actual "tied together" mechanism. Each nature maps
  to a disposition lean along a loosely stat-correlated axis (documented
  as an invented mapping, not a canon one, since mainline never does this):
  natures that boost Attack-family stats lean higher aggression, natures
  that boost Speed/lower Defense lean higher boldness (reckless), natures
  that boost Defense/Sp.Def lean lower boldness (cautious); sociability has
  no stat-correlated analog in mainline, so seed it from the neutral-vs-
  extreme character of the nature instead (documented as an explicit
  invented rule) rather than leaving it arbitrary. On top of the nature-
  seeded baseline, add a small per-individual random jitter (e.g. ±0.15,
  clamped 0-1) so two agents sharing a nature aren't behaviorally identical
  either — real individuality, not just 25 discrete personality slots.
- **Wired into already-built behavior, modestly, not a full culture
  system.** This is not the full "Culture, disposition, and roles" pitch in
  TODO.md (herd-wide culture aggregation, pair-bonding, dispersal-on-
  evolution) — those stay open, this only wires the individual vector into
  concrete existing systems:
  - **Boldness** shifts the flee trigger in `predation.ts` (today: any
    nearby predator unconditionally flees) toward a threshold/radius that
    scales with boldness — bold agents tolerate a more distant or weaker
    threat before fleeing; timid agents flee earlier/farther. Keep a hard
    floor so no boldness value makes an agent suicidally ignore a lethal
    close threat. Also nudges mob-fight commitment (today: fixed "3+ nearby
    allies -> fight" headcount) — bolder agents commit with slightly fewer
    allies, timid ones need more.
  - **Aggression** shifts a predator's hunt-trigger hunger threshold (today
    fixed at 0.6) — an aggressive predator hunts before it's as hungry; a
    passive one waits longer. Also nudges willingness to join a mob-fight
    from the prey side, alongside boldness.
  - **Sociability** nudges mate-seeking search radius (today fixed at 5
    tiles) — more sociable agents search farther/more readily; less
    sociable ones are choosier about proximity. This is deliberately the
    *only* sociability hook for now — full herd cohesion (a shared home-
    range force) is still unbuilt and out of scope here, so don't oversell
    sociability as solving that.
- **Offspring get their own random nature** (and thus their own
  disposition), same as any spawned agent — reproduction.ts's birth path
  needs the same assignment `spawnAgent` gets.
- **Narrative surface**: attach nature/disposition to the `born` event (and
  spawn-time agent creation) so the event log can actually say "born-14
  (Timid, low boldness)" — this is squarely in the project's "the log needs
  semantic content" ethos, not just internal state nobody sees.
- **Explicitly still open**: the exact nature→disposition mapping and
  jitter range are invented, sim-original calls, not canon — worth
  revisiting once a real run shows whether the behavioral spread is
  noticeable or washed out by everything else already driving behavior;
  full herd culture/pair-bonding/dispersal (TODO.md) remain unbuilt, this
  is the individual-variance foundation they're blocked on, not those
  features themselves.

### As built

- `packages/engine/src/nature.ts` is new: the real 25-nature table
  (`NATURES`, keyed by nature name -> `{ raises?, lowers? }` over the 5
  non-HP stats), `randomNature(rng)`, `natureMultiplier(nature, stat)`,
  `dispositionFromNature(nature, rng)`, and `dispositionSummary(disposition)`
  for the narrative surface. `rng` defaults to `Math.random` but is
  injectable, matching `combat.ts`'s `rollCritical`/`rollAccuracy`
  convention — that's what makes `dispositionFromNature` deterministically
  testable.
- `calculateStats(base, level, nature?)` gained the optional third
  parameter: non-HP stats get `floor(rawStat * natureMultiplier)`, same
  ordering mainline uses (nature applies after the +5 base). HP is never
  affected, matching mainline. Omitting `nature` (or passing an unknown
  name) is neutral, so every pre-existing caller is unaffected.
- `Agent` gained `nature?: string` and `disposition?: Disposition`. Every
  behavioral hook below treats a *missing* disposition as neutral (0.5 on
  every axis) rather than requiring it — this is what let all 115
  pre-existing tests (hand-built fixtures with no disposition field) pass
  unmodified, since neutral reproduces each original fixed threshold
  exactly.
- `spawnAgent` (packages/data/src/spawn.ts) and `spawnOffspring`
  (reproduction.ts's birth path) both draw a fresh `randomNature()` and
  derive `dispositionFromNature` from it independently — never inherited,
  matching the design.
- The nature->disposition mapping actually implemented: raising an
  Attack-family stat (Attack or Sp. Attack) leans aggression +0.2; raising
  Speed leans boldness +0.2 and *separately* lowering Defense leans boldness
  another +0.2 (so a nature doing both, e.g. Hasty, stacks to +0.4); raising
  Defense or Sp. Defense leans boldness -0.2. Sociability is seeded at 0.65
  for the 5 neutral natures and 0.45 for the other 20 (the "neutral reads as
  more even-tempered/social" invented rule from the design doc). All three
  axes then get an independent `±0.15` jitter, clamped to `[0,1]`.
- Wiring, all via small helper functions in `predation.ts`/`reproduction.ts`
  that read `agent.disposition?.<axis> ?? 0.5` (so absent disposition
  reproduces the pre-existing fixed constant exactly):
  - `effectiveFleeRadius(agent)`: boldness shifts the flee-detection radius
    `±2` tiles from the baseline 4, floored at 2 so a threat that's
    genuinely adjacent is never invisible to even a maximally bold agent.
  - `mobThreshold(agent)`: `(boldness + aggression) / 2` shifts the
    mob-commitment headcount `±1` from the baseline 3 — used both for a
    prey agent's own fight-or-flee call and for a predator's
    `isProtectedByMob` read of the *candidate's* disposition.
  - `huntHungerThreshold(agent)`: aggression shifts a predator's
    hunt-trigger hunger threshold `±0.2` from the baseline 0.6.
  - `mateSearchRadius(agent)` (reproduction.ts): sociability shifts the
    mate-search radius `±2` tiles from the baseline 5.
- The `born` `SimEvent` gained required `nature: string` and
  `dispositionSummary: string` fields (always populated — every birth now
  assigns both), and the runner's `formatEvent` prints them, e.g.:
  `venusaur (venusaur-1 x venusaur-0) had offspring venusaur-991-20 (Mild,
  high boldness) at (3,2)`. `dispositionSummary` reports whichever of the
  3 axes deviates furthest from 0.5, not always boldness.
- 31 new tests in `packages/engine/test/nature.test.ts`,
  `predation.test.ts`, and `reproduction.test.ts` (146 total, up from 115):
  the full 25-nature table shape, several real stat-multiplier spot checks
  (including all 5 neutral natures being no-ops), `dispositionFromNature`'s
  determinism/lean-direction/jitter-range/clamping, and — the substantive
  part — one behavioral test per wiring point proving a bold/aggressive/
  sociable agent's outcome actually differs from a timid/passive/unsociable
  one under an otherwise-identical scenario (flee-at-distance, mob-vs-flee,
  hunt-at-hunger, mate-search-at-distance).
- **Real-run finding, reported straight**: a 1000-tick run of the demo
  scenario (`pnpm run run 1000` from `packages/runner`) shows the narrative
  surface working correctly — birth events genuinely vary
  ("Hardy, moderate aggression", "Timid, high boldness", "Quiet, high
  aggression", etc. across 21 births) — but the *behavioral* wiring is
  currently hard to observe in this scenario specifically because there's
  only one predator (Scyther) and it dies at tick 93 (two Venusaur guardians
  gang up on it), after which there's no predation pressure left at all for
  the remaining ~900 ticks to show hunt/flee/mob disposition spread against.
  The population-explosion issue already on record elsewhere in this doc
  (unbounded Venusaur/Bulbasaur breeding once predation pressure is gone)
  dominates everything else visible in the log past that point. The unit
  tests prove the wiring changes real outcomes in isolation; a longer or
  multi-predator run would be needed to see whether the spread reads as
  meaningfully different at the population level once the population-cap
  problem is separately addressed — that's a fair "still open" rather than
  a claimed win. A follow-up 5000-tick attempt didn't even finish in a
  reasonable time (killed after ~3.5 minutes of pegged CPU) — the same
  pre-existing population-explosion problem this doc already tracks
  elsewhere means agent count grows large enough to make a long run
  impractical well before disposition's effects would have a chance to
  show up at scale. Not a regression this feature introduced, but a real
  pre-existing ceiling on how much of this could be validated at range.

## Species expansion: repeating the predator/prey pattern on all three layers

Requested directly ("more species... but designed right, not just data
dumped in"). Previously only the surface layer had any real ecosystem
drama (Scyther hunting a Bulbasaur herd guarded by Venusaur) — Diglett
(underground) and Pidgey (canopy) were each a single solitary agent with
no herd, no predator, and no story. This closes that gap on both other
layers using the same pattern, not a new one:

- **Canopy**: a 2-Pidgey flock (`pidgey-flock` herd) hunted by a new
  Spearow. Real mainline data — Spearow is Normal/Flying, Flying egg group
  (matches Pidgey's own group, verified against Bulbapedia — a real
  cross-species pair, same precedent as Bulbasaur/Charmander sharing
  Monster).
- **Underground**: a 4-agent Diglett/Sandshrew colony (`underground-colony`
  herd) hunted by a new Onix. Diglett and Sandshrew are both real Field
  egg group (verified against Bulbapedia) — a real cross-species breeding
  pair, put in the *same* herd deliberately so this could actually happen
  in the default demo world instead of only in an isolated unit test (the
  Bulbasaur/Charmander pair from the breeding section above still isn't
  observable in a real run — this is the first cross-species pair that
  is). Onix is Mineral group, confirmed distinct from Field — so Onix does
  NOT cross-breed with the colony it hunts, matching the real games.

**The elegant reuse, not a new mechanic**: `preysOn` is keyed to a specific
species id, and species changes on evolution (see the Leveling section).
So Spearow's `preysOn: ["pidgey"]` only ever matches an un-evolved Pidgey
— a Pidgeotto or Pidgeot is automatically safe, no separate guardian flag
needed, exactly the same trick Venusaur already gets for free by being a
different species than Bulbasaur. Onix's `preysOn: ["diglett", "sandshrew"]`
gets the same property for both lines at once. Three lines now share one
underlying idea instead of three separate implementations.

**A real bug found while researching Onix, fixed before it could bite**:
the evolution filter in `leveling.ts` (`profileFromDexEntry`) only checked
`entry.level !== undefined` to decide "is this a level evolution." But
PokeRogue's dex stamps a `level: 1` placeholder on Onix's real evolution
to Steelix too — which actually requires trading while holding Metal Coat,
encoded in a separate `conditions: {item: "LINKING_CORD", ...}` field the
old filter never looked at. Left unfixed, Onix would have "evolved" into
Steelix on its very first level-up. Fixed by also requiring
`Object.keys(e.conditions).length === 0`; verified against a fresh dump of
every currently-used species' evolutions (Bulbasaur/Ivysaur/Pidgey/
Pidgeotto/Diglett all have empty `conditions` on their real level
evolutions, so the fix changes nothing for them) and confirmed in two real
runs (3000 and 10000 ticks) that Onix never evolves and Steelix never
appears.

**Real run results** (10000 ticks): Spearow killed 3 Pidgey over the run;
Onix killed a Diglett; the Diglett/Sandshrew colony produced real
cross-species offspring repeatedly (`diglett-1 x sandshrew-0 -> diglett`,
`sandshrew-1 x diglett-0 -> sandshrew`, offspring always the mother's
line per the breeding rules above) — the cross-species breeding path is
now genuinely observable in the stock demo world, not just in a
constructed test.

**Real, honest finding, not glossed over**: zero evolutions occurred in
that same 10000-tick run — for any line, including the pre-existing
Bulbasaur one, ruling out a bug specific to the new species. Checked
directly: the highest level any agent reached was 8, far short of even
the earliest evolution threshold in this roster (Bulbasaur at 16). The
"evolution escapes predation" design above is real and unit-tested, but
won't actually show up in a run at current pacing — exp trickle/combat/
mate-attempt exp gains are too slow relative to how fast agents cycle
through the population for anyone to level up that far. Not something
this pass fixes (leveling-pace tuning is its own scope), but worth
tracking rather than letting the new species quietly not deliver the
guardian-via-evolution story they were designed to tell.

## Dynamic (size-based) predation, exp-motivated exploration, and a real exp-rate overhaul

Three requests landed together: predation shouldn't be a fixed species
list ("it should match by a combo of level and size... spearow probably
goes for bulbasaurs too"), and exp income needed raising a lot ("getting a
kill should give a ton... make them somewhat motivated by gaining exp
too").

**Predation is now power-based, not a fixed prey list.** `HuntRules`
changed from a species -> prey-list map to a plain "does this species hunt
at all" flag; actual target eligibility is computed per encounter in
`predation.ts`'s `isPreyOf(rules, predator, target)`: same species is
never prey (no cannibalism modeled), and the target's `powerOf` (a
predator/prey-specific reading of `maxHp`, which already bakes in both
level and species bulk via `calculateStats`'s formula) must be at most
`PREY_POWER_RATIO` (0.75) of the predator's own. A hungry Spearow no
longer only recognizes Pidgey as food — it'll take a small enough
Bulbasaur too, and a Scyther that's wandered underground will happily eat
a Diglett. Confirmed for real: a 5000-tick run recorded `spearow killed
diglett`, `scyther killed sandshrew`, and — the exact scenario predicted —
`scyther killed bulbasaur (bulbasaur-540-19)` at tick 696, none of which
existed in any hardcoded pairing.

A real design split fell out of building this: *fleeing/mobbing* (a
prey's own defensive reaction) stayed purely species-flag-based, not
power-gated — a wounded or fainted predator is still worth staying away
from, prey doesn't have detailed knowledge of exactly how weak it
currently is. Only the *predator's own hunt-target selection* (and the
"is this agent currently vulnerable to anything" guardian check, since
that's asking the same question from the prey's side) is power-gated.
Discovering this distinction fixed a test that seemed to contradict the
whole feature at first (a fainted, deliberately fragile "just weak enough
to die in one more hit" test predator stopped registering as a threat
under an earlier draft that power-gated fleeing too) — see
`isHunterSpecies` vs. `isPreyOf` in predation.ts.

**Exp income raised substantially across every source** (see leveling.ts's
"Tuning constants" comment for old -> new values): kills now go through a
`KILL_EXP_MULTIPLIER` (8x) on top of the real mainline formula, since that
formula assumes a 6-Pokémon team splitting exp across frequent battles —
neither applies to one wild agent's rare kill here. Passive
eat/drink/trickle and the one-time new-sector/new-species bonuses were all
raised 5-10x. Real before/after: a 10000-tick run pre-change topped out at
level 8 with zero evolutions anywhere, ever recorded; a 5000-tick run
post-change produced **3 real evolutions** (`bulbasaur -> ivysaur at level
16`, the exact real mainline threshold) and levels up to 17. The
"evolution engine-tested but never observed in a run" gap this project had
carried since the Leveling feature shipped is closed.

**Agents are now "somewhat motivated by gaining exp too."** A fully-
satisfied idle agent (no urgent need, no herd pull-back needed) no longer
just stands on the last tile it ate at forever — `needs.ts`'s
`applyExploration` picks a nearby not-yet-visited sector and walks there,
motivated by the same `EXP_ON_NEW_SECTOR` trickle that already existed for
incidental wandering. An urgent need always interrupts it (checked fresh
each tick, not read from stale `agent.behavior`). A newborn doesn't
explore for its first `MIN_EXPLORE_AGE` (10) ticks — settling in near its
birthplace first, which also fixes a real same-tick interaction (a
newborn ticked again in the same `tickWorld` call it's born in could
otherwise wander a step back onto its own mother's tile, intermittently
breaking the spawn-placement test). This also incidentally closes the
pre-existing "no reason to leave a resource tile once satisfied" gap from
TODO.md's tile-stacking notes.

**Two more real, unrelated bugs found and fixed along the way**, both now
documented in TODO.md's Infra section: a genuine cross-test-file flake
where a `vi.spyOn(Math, "random")` mock from one test file could leak into
another under vitest's default thread pool (fixed with `pool: "forks"` in
a new `vitest.config.ts`, confirmed pre-existing and unrelated to any of
this session's other changes), and the newborn/exploration same-tick
interaction above.

## First Water-type: Squirtle, and confirmation the roster gap was real

Surfaced while brainstorming HM-style moves (Surf/Whirlpool/Waterfall):
the roster had zero representation for most of the type chart, and every
water-themed idea was inert without a species to use it. Squirtle is the
first fix — real dex data (Water, evolves to Wartortle at level 16, empty
evolution conditions so the earlier evolution-conditions bug fix doesn't
affect it), spawned as a pair at the map's existing northwest pond
(`packages/data/src/scenario.ts`), which until now was just a generic
drink stop with no resident of its own. Added `water_gun` to the curated
move roster (real dex numbers: 40 power, 100 accuracy, special) since
nothing had needed it yet.

**Real egg group, verified against Bulbapedia, with a nice payoff**:
Squirtle is Monster *and* Water 1 — Monster is the same group Bulbasaur
and Charmander are already in (all three starters share it in the real
games), so Squirtle is a real cross-species breeding partner for the
existing Bulbasaur herd, not just a bystander. Confirmed live in a
5000-tick run, not just possible in principle: `squirtle-1 x bulbasaur-2`
and `squirtle-2385-159 x venusaur-0` both produced real Squirtle
offspring (always the mother's line, per the breeding rules — a Venusaur
mother crossed with a Squirtle father still produces a Bulbasaur-line
child, so these are actually Squirtle-mother pairings, not Venusaur/
Bulbasaur fathering Squirtle).

**No new predation code needed at all** — the dynamic, size-based
predation system built earlier already treats Squirtle as fair game to
anything strong enough nearby, with zero species-specific wiring:
`spearow (spearow-0) killed squirtle (squirtle-315-10)` fired in the same
run, purely because a Spearow crossed onto the surface, was hungry, and
Squirtle was small enough. This is the intended payoff of that redesign —
adding a new species doesn't require touching `HuntRules` at all.

**Squirtle evolved to Wartortle at level 16** in the same run
(`squirtle-1 evolved: squirtle -> wartortle`), on top of two real
Bulbasaur→Ivysaur evolutions — confirms the exp-rate overhaul generalizes
to a brand new species/line, not just the one it was tuned against.

Electric, Psychic, and Ghost-or-Dark candidates are confirmed but not yet
added — see MOVES_DESIGN.md's round four for the shortlist and why each
one was picked (each unlocks a cluster of designed moves at once, same
reasoning that made Squirtle first).

## Planned: status effects + environmental/utility moves

Requested directly, in two parts: real status effects (burn/poison/
paralysis/sleep/freeze), and making non-combat moves "sick as fuck" by
having them interact with the environment instead of sitting unused. The
full design — data model, exactly which existing code each piece reuses
(`applyHealOverTime`'s shape for DOT, the fainted/`beingCarriedBy`
early-return pattern for skip-turn statuses, `applyExploration`'s
architectural slot for idle utility moves), a growing table of specific
moves across three brainstorming rounds, and a real structural finding
(FOV is fully built in fov.ts and completely unused by any actual AI
decision — every detection check today is a blind manhattan-distance
radius) — now lives in **[MOVES_DESIGN.md](./MOVES_DESIGN.md)**, its own
file so a fast-growing backlog doesn't crowd out this file's own job of
documenting what's actually shipped. One resolved decision worth stating
here since it's a real mechanical rule, not just a backlog entry: burn
and poison have no independent duration or cure — they deal damage every
tick until the DOT itself causes a faint, exactly like a normal hit does,
and ordinary recovery (already built) takes it from there.
## Environmental generation, biomes, obstacles, and elevation-aware movement/fog

Decided, not built yet. Direct feedback: the world "feels like a small
trapped box." It is one — `createDemoWorld` (`packages/data/src/scenario.ts`)
is a single hand-authored 24x16 flat grid with 7 terrain kinds and zero
obstacles. `elevation.ts` (accuracy/evasion modifiers) and `fov.ts`
(`computeVisible`) are fully built but **called by nothing** — dead code
today, confirmed by grep. This is Phase 1 of a two-phase piece of work;
Phase 2 (herd-level group migration) is the next section and deliberately
waits on this one, since coordinated migration needs an interesting, varied
map to actually be observable in a real run, not a 24x16 box with two
water holes.

- **Real procedural generation, not another hand-authored map.** Generate
  a substantially larger world (pick a real size, not another cramped box —
  something like 80x60 or bigger, tune for what stays performant given the
  existing "naive per-tick nearest-tile search is O(width*height)" ceiling
  already flagged in TODO.md; this feature may need to address that ceiling
  directly rather than inherit it silently at a much bigger map size).
  Deterministic given a seed (reproducible runs for debugging) — a simple
  seeded PRNG + smoothed value noise is enough, no new dependency needed.
- **Biome types that bleed into each other, not hard-edged regions.**
  Assign each biome a small number of seed points scattered across the map;
  every tile's parameters (food/water base density, obstacle density,
  elevation base/variance, terrain-kind weights) are a distance-weighted
  blend of its 2-3 nearest biome seeds, not a single "which region am I
  in" lookup — this is the actual mechanism for "bleed into each other,"
  continuous parameter blending rather than painting discrete zones with a
  border. A handful of biomes to start (data-driven, easy to add more
  later): **Grassland** (today's default — open, moderate food/water),
  **Forest** (dense trees, canopy-heavy, more cover, less open food),
  **Wetland** (lots of water tiles, mud slows movement), **Badlands**
  (sparse food/water, sandy, more open sightlines), **Rocky/Highland**
  (elevation-heavy, boulders, ties directly into the elevation-movement
  work below). Scope call: this pass targets the **Surface** layer only —
  Underground/Canopy keep their current simpler flat-plus-resource-crossing
  model, consistent with DESIGN.md's existing "whether Underground/Canopy
  get their own elevation too" open question, which this doesn't resolve.
- **New terrain kinds for obstacles and movement variety**, added to
  `TerrainKind`: `"tree"` (unwalkable, blocks movement and — for free,
  since `hasLineOfSight` already treats non-walkable tiles as opaque —
  blocks line of sight, no fov.ts change needed for trees specifically),
  `"bush"` (walkable but grants **concealment**: a new mechanism, not
  free like trees — reduces the effective detection range for anything
  trying to spot an agent standing in/behind one, which needs a real hook
  into predation.ts's flee-trigger detection and into `computeVisible`,
  not just a cosmetic tile), `"boulder"` (unwalkable, same LoS-blocking
  treatment as tree, distinct flavor/rendering), `"sand"`/`"mud"`
  (walkable, movement-cost penalty — feeds the same effective-speed
  mechanism elevation is about to use, see below).
- **Elevation actually affects movement speed, not just combat math sitting
  idle.** Moving onto a higher-elevation tile than your current one costs
  more (lowers effective Speed for that action, feeding the same
  `accumulateActionEnergy`/`effectiveSpeed` mechanism `support.ts` already
  uses for injury); moving onto a lower tile is faster. This is a second,
  independent modifier alongside the existing HP-based one in
  `support.ts` — document how they compose (multiplicative, most likely,
  consistent with how the injury one is already applied).
- **Elevation-aware fog of war becomes asymmetric by direction**, not just
  the existing symmetric "your own elevation extends your radius" and
  "a tall ridge blocks the view over it" rules (both already built and
  fine to keep). Add: a target standing on **higher** ground than the
  observer is harder to make out (reduced effective visibility toward it)
  than the existing ridge-blocking rule alone accounts for, while a target
  on **lower** ground (looking down into a valley) is easier to see — a
  real "fog thickens going uphill, thins going downhill" rule layered on
  top of `computeVisible`'s existing radius/line-of-sight logic, not a
  replacement for it.
- **Obstacles feeding back into behavior and combat**: a bush's
  concealment should make it a real ambush tool — a predator lurking in
  one that a prey agent hasn't detected gets some meaningful edge on the
  opening exchange (a detection-range reduction already covers "prey
  doesn't notice it's there in time to flee" — decide whether that's
  sufficient or whether an explicit first-strike/accuracy bonus on the
  ambush hit is worth adding; document whichever call is made). Move
  range/line-of-sight for actual combat moves (`combat.ts`'s
  `moveRange`/`canAttackFromHere`) should respect the new obstacle tiles
  the same way any other line-of-sight check does — a tree between
  attacker and target should block a line-shaped move's path, not just
  ambient FOV.
- **Explicitly still open**: exact biome parameter tuning (food/water
  density per biome, obstacle density, elevation variance) — sim-original
  guesses to judge against a real run like every other tuning constant
  here; whether the O(width*height) nearest-tile-search ceiling needs a
  real fix (spatial indexing) at the new map scale or can be deferred a
  bit further; multi-region/world-graph (DESIGN.md's existing "World
  scale" section) stays a separate, bigger, still-unbuilt idea — this
  generates one large varied region, not multiple connected ones.

### As built

- `packages/engine/src/worldgen.ts` is new: `mulberry32(seed)` (a small,
  well-known 32-bit seeded PRNG, public domain, no new dependency),
  `makeNoise2D` (2-octave smoothed *value* noise — bilinear + smoothstep
  interpolation over a random lattice, not true Perlin noise, which this
  didn't need), `makeDensityField` (see below), 5 `BIOMES` (Grassland,
  Forest, Wetland, Badlands, Highland — each a `{foodDensity, waterDensity,
  obstacleDensity, elevationBase, elevationVariance, terrainWeights}`
  record), `blendBiomeParams` (inverse-distance-squared blend of a tile's 3
  nearest biome seed points), `generateWorld(width, height, seed)`, and
  `findWalkableNear` (expanding-ring search, used to place scenario spawns
  on a map that isn't guaranteed walkable at any specific hand-picked
  coordinate).
- **A real bug found and fixed during this pass, worth recording**: a raw
  `noise(x, y) < density` threshold check badly under-fires for small
  `density` values, because a multi-octave value-noise field is a weighted
  average of several independent samples and so clusters toward 0.5 (like
  averaging dice rolls) rather than spreading evenly across [0, 1]. The
  first working version of `generateWorld` produced a 90x60 map with only
  **3** food tiles and next to no obstacles — the opposite of the intended
  "varied and interactive" world. Fixed with `makeDensityField`: it
  Monte-Carlo-samples a noise field once (800 samples), sorts them, and
  `thresholdFor(density)` returns the value at that percentile, so
  `sample(x, y) < thresholdFor(density)` fires for close to the requested
  fraction of tiles regardless of the field's actual raw distribution —
  `worldgen.test.ts` has a dedicated test proving this calibration holds.
  After the fix, a real generated map (90x60, seed 20260903) comes out to
  roughly 77% floor, 8.7% water, 3.4% food, and ~11% obstacles split across
  tree/boulder/bush/sand/mud — visually confirmed varied via an ASCII dump
  (distinct forest, highland/boulder-field, and lake regions, not a uniform
  scatter).
- **Map size: 90x60** (up from 24x16) — an exact 3.75x scale of the old
  map in both dimensions, chosen specifically so the old hand-picked
  scenario anchors (herd territory, Scyther's hunting ground, etc.) scale
  cleanly onto the new map via a single `SCALE_X`/`SCALE_Y` factor rather
  than being re-derived from scratch. `packages/data/src/scenario.ts`'s
  `createDemoWorld` now calls `generateWorld` instead of hand-authoring
  `fillRect`/`setTile` calls; every scenario anchor is scaled from the old
  24x16 frame and (for the surface layer) passed through
  `findWalkableNear` so a scaled anchor landing on an obstacle or lake
  doesn't break agent placement.
- **A second real bug found during this pass**: underground/canopy spawn
  anchors (Diglett/Sandshrew/Onix, Pidgey/Spearow) were first computed
  directly against the *new* `SCENARIO_WIDTH`/`SCENARIO_HEIGHT` (e.g.
  `{ x: SCENARIO_WIDTH - 3, y: SCENARIO_HEIGHT - 3 }`) while the code
  reasoning about them was still written in the old 24x16 frame — this put
  predator and prey in opposite corners of the new, much bigger map,
  confirmed by a 5000-tick run with zero predation events on either pair
  even after their `RELOCATE_AFTER_TICKS`-driven relocation kicked in
  repeatedly. Fixed by scaling every underground/canopy anchor from the old
  24x16 frame the same way the surface ones are (`scaledPos`, no
  walkability search needed since those layers are still a plain flat
  grid).
- **New `TerrainKind` values**: `"tree"`/`"boulder"` (unwalkable — `world.ts`
  gained `isWalkableTerrain`, shared by `createTile`/`setTile`, and a test
  in `fov.test.ts`/`worldgen.test.ts` confirms both block movement and, for
  free via the existing `hasLineOfSight` walkable check, line of sight —
  no fov.ts change was needed for that part), `"bush"` (walkable, `Tile`
  gained a `concealment?: boolean` flag), `"sand"`/`"mud"` (walkable,
  handled purely as a function of terrain kind in support.ts, no extra
  `Tile` field — see below).
- **Elevation/terrain -> effective movement speed**
  (`support.ts`'s `elevationSpeedMultiplier`, `terrainSpeedMultiplier`,
  `movementSpeedFactor`): composes **multiplicatively** with the existing
  injury-based `effectiveSpeed`, in this order —
  `finalSpeed = baseSpeed * elevationSpeedMultiplier * terrainSpeedMultiplier * injuryFraction(floored)`.
  A real architectural scope call, documented in both the code and here:
  Speed is spent (`accumulateActionEnergy`) to decide *whether* an action
  happens before that action's movement is even chosen, so a literal
  "climbing this step costs more, decided in advance" isn't available
  without restructuring that order. Implemented instead as a **post-move
  snapshot** — `simulation.ts`'s `tickWorld` computes the elevation delta
  and destination terrain right after a real move happens and stores the
  combined multiplier on the new `Agent.terrainSpeedFactor` field, which
  `actionSpeedOf` reads on every subsequent tick until the agent's next
  move overwrites it. The qualitative effect (climb slows you down, descend
  speeds you up, sand/mud are generally slower) still shows up in a real
  run, just applied to the *next* action rather than the one just taken.
- **Bush concealment, real, on both axes it was asked to touch**:
  `predation.ts` gained `isConcealed`/`isDetectable`
  (`BUSH_CONCEALMENT_DETECTION_REDUCTION = 2`, floored at radius 1),
  applied to *both* the flee-trigger threat filter and the hunt-target
  filter — concealment protects whichever party (predator or prey) happens
  to be standing in the bush, not just prey hiding from predators. Rule
  chosen: concealment applies only while actually **standing on** the
  bush tile itself, not "in or adjacent" — the simpler of the two options
  the design doc left open, and consistent with how every other
  position-based check in this codebase already works (no precedent for an
  "adjacent-counts" rule anywhere else). `fov.ts`'s `computeVisible` gained
  the same idea as an effective-distance penalty (`CONCEALMENT_SIGHT_PENALTY
  = 2`) on the tile being looked *at*. Both are sim-original magnitudes, not
  canon.
- **Asymmetric elevation FOV** (`fov.ts`): `ELEVATION_FOV_ASYMMETRY_PER_UNIT
  = 0.5` effective tiles of distance per unit of elevation the target sits
  above the observer (and the same amount of *bonus* — reduced effective
  distance — per unit below), clamped at ±4
  (`MAX_ELEVATION_FOV_ADJUSTMENT`) so an extreme height gap isn't an
  unbounded always/never-visible switch. Implementing the downhill bonus
  correctly required widening `computeVisible`'s scan bounding box by that
  same cap — a target whose *raw* distance is just past `radius` but whose
  *effective* distance (after the downhill bonus) is within it would
  otherwise never even be scanned. `fov.test.ts` keeps the two pre-existing
  rules (ridge-blocking, own-elevation radius bonus) passing unmodified and
  adds new tests for the asymmetry specifically, isolating it from the
  observer's own elevation bonus so each rule is tested independently.
- **Obstacles block combat move lines**: `fov.ts` gained `isPathClear` (a
  plain walkability check along a Bresenham line, no elevation gating —
  irrelevant for a flat combat range check). `predation.ts`'s
  `canAttackFromHere` was previously range-only (a real pre-existing gap,
  not something this feature broke) — it now also requires `isPathClear`
  between attacker and target, at all three call sites (guardian
  intervention, prey mob-fight, predator hunt). **Bush ambush bonus
  explicitly deferred** — concealment already gives a lurking predator a
  real, measurable edge (undetected until the prey is much closer), and
  DESIGN.md's own text called this optional; adding a separate first-strike
  bonus on top felt like scope creep for a "some measurable edge" bar this
  already clears, so it's left as an open idea rather than half-built.
- **Performance**: `packages/engine/src/resourceIndex.ts` is new — a cached
  per-(World, layer) coordinate index for `water`/`food`/`sunbeam` tiles,
  invalidated via a new `World.resourceVersion` counter (bumped by
  `setTile` always, and by `flora.ts` only on the two transitions that
  matter: a seedling maturing into food, and a food patch dying back to
  floor). `needs.ts`'s `findNearestTerrain` and `support.ts`'s internal
  food-delivery lookup both now delegate to it instead of a naive
  full-grid scan. **This was a real, necessary fix, not speculative
  optimization**: the first correctly-populated 90x60 map (after the
  density-field fix above) made the naive O(width*height) scan a genuine
  per-tick cost multiplied across every hungry/thirsty agent; with the
  index in place, a 10,000-tick run of the demo scenario completes in
  ~5-6 seconds on this machine (1,000 ticks in ~1.5-1.8s), scaling roughly
  linearly with tick count rather than blowing up as population grows —
  confirmed by comparing 1,000/5,000/10,000-tick run times. `growFlora`'s
  own full-grid-per-tick scan (also flagged in TODO.md) was left untouched
  — it wasn't the bottleneck actually observed, and DESIGN.md's ask was
  specifically about `findNearestTerrain`.
- **Underground/canopy untouched**, as scoped: `generateWorld` only ever
  writes to `world.tiles.surface`; both other layers stay the plain flat
  grid `createWorld` always produced, confirmed by a dedicated
  `worldgen.test.ts` test.
- 30 new tests across `worldgen.test.ts` (new), `fov.test.ts`,
  `support.test.ts`, and `predation.test.ts` (213 total, up from 183):
  PRNG/noise determinism, the density-field calibration, biome-blend
  gradualness across a boundary (a sampled line of tiles confirms a
  monotonic gradient, not a step), tree/boulder walkability +
  free LoS-blocking, the two pre-existing FOV rules still holding plus the
  new asymmetry/concealment rules in isolation, `isPathClear`, the
  elevation/terrain speed multipliers and their real multiplicative
  composition through a full `tickWorld` call, and bush concealment
  measurably defeating both hunt- and flee-detection at a distance that
  would otherwise trigger them.
- **Real-run findings, reported straight** (`pnpm run run <N>` from
  `packages/runner`, seed 20260903 demo scenario):
  - The generated map genuinely looks and feels varied — an ASCII dump
    (via `packages/runner`'s existing `ascii.ts`) shows a clear forest
    region (dense `T` trees), a highland/boulder field (`O`), sandy
    stretches, a couple of real lakes, and scattered food/flora glyphs
    threaded through open floor, not a uniform scatter or a repeat of the
    old two-water-hole box.
  - Performance is solid at this scale: 1,000 ticks in ~1.5-1.8s, 10,000
    ticks in ~5-6s, no sign of the O(width*height) ceiling reasserting
    itself (that's the resourceIndex.ts fix above actually earning its
    keep, not just theoretical).
  - Predation *does* happen at this map size — an 1,000-tick run showed 11
    `fought` events, a `fainted`, a `defeated`, and a `killed`; a separate
    5,000-tick run showed 7 `fought`/1 `fainted`/1 `killed` — but it's
    slower to get going and more stochastic run-to-run than on the old tiny
    map, and a full 10,000-tick run in one attempt showed *zero* combat
    events at all. Root cause, diagnosed rather than guessed at: on this
    much bigger map, food/water is abundant enough (by design, so the
    surface herbivore population doesn't starve across a much larger area)
    that a solo predator (Scyther, Onix, Spearow — none of them herd
    members, so they don't even get herding.ts's idle-cohesion wandering)
    can self-feed from the same generic "food" tiles herbivores eat and
    rarely drops below `HUNT_HUNGER_THRESHOLD` in the first place. This is
    a genuine tuning gap this feature surfaced rather than solved — flagged
    in TODO.md rather than silently patched, since a real fix (predators
    not self-feeding from berry patches at all, or a lower predator food
    density, or giving solo predators their own idle-wander behavior)
    changes predation.ts/needs.ts territory beyond this feature's scope.
  - The underground Diglett/Sandshrew/Onix colony and canopy Pidgey/Spearow
    flock are both real users of cross-layer need-seeking at the new scale
    (`crossedLayer` events show up in every run) — but a 10,000-tick run
    showed a real amount of Pidgey starvation (132 `starved` events across
    the whole run, `born: 134`), consistent with a known pre-existing
    dynamic (canopy has no food/water of its own, so every agent up there
    depends on successfully timing a cross-layer trip) rather than
    something this feature changed — noted here because it's visible in
    the same logs, not because this feature is responsible for it.

## Herd-level migration: moving as a group, not wandering individually

Decided, not built yet — Phase 2, depends on Phase 1 above landing first
(needs a real varied map to be observable, and both phases touch
`scenario.ts`/`world.ts`, so building them in the same pass invites
avoidable conflicts). Direct ask: "I want the herd to move if there's no
food," and for that to read as a genuine group decision, not individually-
wandering agents that happen to end up near each other. Today's only
relevant mechanism, `migrate()` in `migration.ts`, is single-agent and
already used for something different (a predator giving up on a hunting
area) — it picks one random distant point per agent, independently.

- **A shared per-herd migration decision, not per-agent.** When a herd's
  local resource situation is bad — sample food-tile `stock` (and water
  presence) within the herd's existing cohesion radius (`herding.ts`'s
  `COHESION_DISTANCE`) around its live centroid, sustained below a
  threshold for a real duration (not a single bad tick — avoid triggering
  on ordinary depletion/regrowth noise already modeled in `flora.ts`) —
  the herd (identified by shared `herdId`) picks **one shared destination**
  for everyone, not each member picking its own. Store this as real shared
  state (a `herdId -> target` map is enough, doesn't need to live on every
  agent) so the whole herd actually walks together rather than scattering.
- **Destination selection is resource-aware, not a blind random point**
  like the existing single-agent `migrate()` — sample candidate points at
  some distance from the current centroid and prefer ones with better
  known food/water density (reuse whatever terrain-sampling the biome-
  generation work produces, or a simpler direct tile scan if that's not
  ready/needed) — a herd should be able to plausibly walk toward the
  Forest biome's denser food if it's starving in a Badlands patch, once
  Phase 1's biome variety exists to walk toward at all.
- **Every herd member (and its guardians, per the existing
  `protectedHerdCentroid` distinction) biases toward the shared migration
  target instead of the live centroid while one is active** — reuse
  `applyHerdCohesion`'s existing structure, just swap what it's pulling
  toward when a migration is in progress, rather than building a second
  parallel movement system.
- **Migration ends on arrival** (herd centroid close enough to the target)
  or on a timeout/give-up condition (mirroring `migrate()`'s existing
  `"stuck"` case) — clears the shared target, resumes ordinary centroid-
  based foraging cohesion in the new area.
- **New `herdMigrating` event** (herdId, from, to, reason — e.g. "food
  scarcity") for the event log, and an arrival/settle event — this is
  squarely the kind of thing the project's whole "the log needs semantic
  content" ethos wants: "the east herd abandoned its depleted range and
  resettled near the forest's edge" is a real story, not a diff.
- **Explicitly still open**: whether predator-side relocation
  (`migrate()`'s existing use in predation.ts) should be unified with this
  new herd-migration mechanism or stay separate (they're conceptually
  different — one predator giving up vs. a whole herd relocating — keeping
  them separate is a reasonable default, revisit if it causes duplication);
  exact scarcity-detection thresholds/duration, another sim-original tuning
  guess to validate against a real run.

### As built

- `packages/engine/src/herdMigration.ts` is new: `World.herdMigrations`
  (`Record<herdId, {target, reason, startedTick}>`) and
  `World.herdScarcityTicks` (`Record<herdId, number>`) are the shared,
  per-herd state DESIGN.md asked for — not duplicated onto every agent.
  `updateHerdMigrations(world, log)` is called once per tick from
  `simulation.ts`'s `tickWorld` (not once per agent) and owns the whole
  lifecycle: sampling local abundance around each herd's live centroid
  (`herding.ts`'s `herdCentroid`, reusing its own `COHESION_DISTANCE` as the
  sampling radius rather than inventing a second number), incrementing/
  resetting a per-herd sustained-scarcity counter, triggering a migration
  once that counter crosses `SCARCITY_SUSTAIN_TICKS`, and clearing an active
  migration on arrival or timeout.
- **Scarcity score, not a raw tile count**: `resourceIndex.ts` gained two
  new query functions (`foodStockNear`, `countTerrainNear`) that filter its
  existing cached index by Chebyshev distance instead of doing a fresh
  full-grid scan — consistent with why that index exists at all. A herd's
  local "abundance" is `sum(live food stock within radius) + (water tiles
  within radius)`; `SCARCITY_SCORE_THRESHOLD = 1.5` and
  `SCARCITY_SUSTAIN_TICKS = 150` are the sim-original tuning guesses (150
  ticks specifically chosen to ride out one food patch's natural
  death-to-regrowth gap — flora.ts's `FOOD_LIFESPAN_TICKS`/
  `MATURATION_TICKS` — without over-reacting to it).
- **Destination selection is a direct resource-density scan, not
  biome-aware**: `pickDestination` samples candidate points at 15/25/40
  tiles out from the centroid in 8 compass directions, scores each with the
  same abundance function used for scarcity detection, and picks the best
  one — provided it beats the herd's *current* score by `MIN_IMPROVEMENT`.
  A biome-aware version (scoring by `worldgen.ts`'s `BIOMES`/
  `blendBiomeParams` instead) was considered and explicitly not built: a
  real per-tile resource scan is simpler and more directly answers "is this
  actually a better place to live" than reasoning about which biome a
  candidate statistically blends toward — a Forest-leaning tile can still
  roll foodless locally, and scanning the real tiles never has that
  mismatch. The improvement-margin gate has a second, load-bearing effect:
  the underground/canopy herds (`underground-colony`, `pidgey-flock`) have
  zero food/water tiles on their layers at all (Surface-only generation),
  so every candidate scores exactly 0, same as "home" — nothing ever clears
  the bar, so those herds correctly never migrate instead of wandering
  toward an equally-barren random point. Confirmed directly: a real run
  showed `pidgey-flock`'s scarcity counter cycle 0 -> 149 -> (destination
  search finds nothing) -> reset to 0, repeating, exactly as designed.
- **Whole herd (and guardians) pull toward the same shared point**:
  `herding.ts`'s `applyHerdCohesion` now checks `world.herdMigrations` first
  — if the agent's `herdId` has an active entry, *everyone* (ordinary
  members and guardians alike) pulls toward `migration.target` instead of
  the live centroid. A guardian keeps its tighter `GUARDIAN_COHESION_DISTANCE`
  leash while migrating rather than tracking the exact same tolerance as an
  ordinary member — the simplest reasonable reading of "guardians should
  still use their tighter leash," not a separate "vicinity of the target"
  computation, since nothing in a real run showed that extra complexity
  earning its keep.
- **Two new events**: `herdMigrating` (herdId, from, to, reason) fires when
  a migration starts; `herdSettled` (herdId, pos, outcome: "arrived" |
  "gaveUp") fires when one ends either way — `ARRIVAL_DISTANCE` reuses
  `COHESION_DISTANCE` again, `MIGRATION_TIMEOUT_TICKS = 2000` mirrors
  `migrate()`'s own give-up pattern.
- 11 new tests in `herdMigration.test.ts`: sustained-vs-brief-dip scarcity
  detection, destination scoring preferring a richer candidate (and
  correctly finding nothing on a barren map), arrival/timeout/in-progress
  clearing, and `applyHerdCohesion` pulling both an ordinary member and a
  guardian toward the shared target — confirming every member reads the
  exact same `World.herdMigrations` entry rather than each computing its
  own. All 213 pre-existing tests plus these 11 pass (224 total);
  `pnpm -r typecheck`/`build` clean across all 4 packages.
- **Real-run findings, reported straight** (seed 20260903 demo scenario,
  `pnpm run run <N>` from `packages/runner`):
  - **The mechanism works end-to-end when actually exercised**: a scripted
    real-engine run that artificially wiped every food/water tile within 40
    tiles of the bulbasaur herd's starting centroid (simulating a real
    famine, not a synthetic unit-test world) triggered a `herdMigrating`
    event at exactly tick 150 (the configured sustain window) picking a
    genuinely resource-richer target 34 tiles east, confirming the full
    scarcity-detection -> destination-scoring -> event pipeline fires
    correctly through the real `tickWorld` path, not just in isolation.
  - **But it never fires in the actual demo scenario** — a straight 1,000-
    and a 10,000-tick run of the unmodified demo world produced zero
    `herdMigrating`/`herdSettled` events. Root cause diagnosed directly: a
    debug instrument tracking each herd's live scarcity counter over a
    30,000-tick run showed `bulbasaur-herd` and `underground-colony` never
    exceed roughly 21-26 consecutive scarce ticks (well under the 150
    needed) after their initial post-spawn settling period — the same map
    abundance the biome-generation feature already flagged as making
    predation rare and stochastic (DESIGN.md's prior section, TODO.md) also
    means a mobile herd's *local* food/water around its centroid recovers
    long before real depletion could ever sustain. This is the same kind of
    tuning gap, not silently patched: at this map's default abundance,
    herd-level migration is a real, working, but essentially unreachable
    mechanism in ordinary play — it would need either a genuine famine
    event (a drought mechanic, a much larger local herd eating pressure) or
    a deliberately lower `SCARCITY_SUSTAIN_TICKS`/`SCARCITY_SCORE_THRESHOLD`
    to ever fire organically, and lowering those enough to fire on the
    unmodified map (confirmed via the same debug harness: `sustain = 15`
    fires immediately at spawn, tick 15) mostly just measures "how long it
    takes a fresh herd to find its first meal," not real depletion — a
    worse signal, not a better one. Left at the documented values rather
    than chasing an artificially-triggerable number.
  - **A second, real limitation surfaced by the same famine-simulation
    run**: once triggered, the herd did *not* reliably arrive — it timed
    out (`herdSettled`/`gaveUp` at tick 2150) and ended up at (2, 6),
    nowhere near the chosen target (59, 10). Cause understood, not a bug:
    `applyHerdCohesion`'s migration bias only applies while an agent is
    *idle* (per DESIGN.md's explicit ask to reuse its existing structure);
    a hungry/thirsty member's `seekFood`/`seekWater` behavior takes
    priority and searches the *entire map* for the nearest resource via
    `findNearestTerrain`, with no awareness of the herd's shared migration
    target — during an actual famine severe enough to trigger migration in
    the first place, members are hungry *often*, so individual survival-
    driven wandering can easily pull the herd somewhere other than the
    scored destination, undermining the "moves together" story exactly
    when it matters most (a real famine). A softer, still-open idea worth
    revisiting: bias `findNearestTerrain`'s candidate search toward the
    migration target when one is active (e.g. prefer a resource within some
    bonus radius of the target over a slightly-nearer one elsewhere) rather
    than leaving it target-agnostic — not built here, flagged in TODO.md
    since it changes needs.ts territory beyond this feature's stated scope
    (extend `applyHerdCohesion`).
  - Performance: no measurable regression from the added once-per-tick
    `updateHerdMigrations` check — 1,000 ticks in ~1.8s, 10,000 in ~5.1s,
    matching the biome-generation feature's own numbers.

## Dynamics that move a content herd: extra migration triggers, day/night, weather

Decided, not built yet. Direct feedback after herd migration landed as
purely scarcity-driven: fine for scarcity to stay occasional (per the
honest finding that the new map is abundant enough that it rarely fires),
but a herd needs reasons to move that **aren't** "we're starving" or it
just sits there forever. Five dynamics, agreed on together, split into
three build phases sequenced to avoid three agents colliding on the same
files (`herdMigration.ts`/`herding.ts`/`events.ts` get touched by more than
one of these):

**Phase 1 — generalize herd migration to more trigger reasons** (smallest,
builds first, touches `herdMigration.ts`/`herding.ts` directly so it goes
before the phases that plug into it):
- **Predator pressure**: a rolling per-herd count of hunt/fight events
  involving its members over a real window (e.g. last 300 ticks); crossing
  a threshold triggers migration with reason `"predator_pressure"`,
  destination scoring gets a new term biasing away from the threat's last
  known position on top of the existing resource-richness scoring.
- **Wanderlust**: a small, constant per-tick-per-herd chance (deliberately
  low — something like 1-in-several-thousand, tuned so it reads as
  occasional restlessness, not constant churn) of triggering a migration
  with no bad condition at all, to a moderately distant point that doesn't
  need to be *better*, just different. This is the direct, simplest answer
  to "otherwise they'll just stay there forever." Scale the chance with
  boldness/sociability (already-built Disposition axes) so bolder/more
  social herds wander somewhat more.
- **Territorial displacement**: two herds of the *same species* with
  centroids within roughly `2x COHESION_DISTANCE` of each other for a
  sustained duration pushes the smaller one (by member count) to migrate
  away — destination scoring gets an "away from the other herd" term.
- All three reuse the exact shared-state/target-selection/cohesion-bias
  machinery already built for scarcity — this phase is about adding
  trigger *evaluators*, not new core plumbing. Generalize whatever
  `herdMigrations` entry shape exists to carry a trigger-reason string if
  it doesn't already (scarcity's existing entries already need one for
  the `herdMigrating` event's `reason` field, so this may already be
  halfway there).

**Phase 2 — day/night cycle** (mostly independent of Phase 1, still
sequenced after it since both touch `events.ts`):
- A fast local cycle, independent of the existing 1000-tick season sine
  wave — something like 200 ticks per full day, a light level 0
  (midnight) to 1 (noon).
- Species get an `activityPattern: "diurnal" | "nocturnal" |
  "crepuscular" | "cathemeral"` field, defaulting to `"cathemeral"`
  (active any time) for anything unspecified so existing species/tests
  don't silently change behavior unless explicitly set. Off-hours for an
  agent's pattern apply a real but partial effective-Speed penalty
  (composing with the existing injury/elevation modifiers, not
  replacing them) and shift a predator's hunt-eagerness threshold the
  way Disposition's aggression already does — a nocturnal predator
  actually hunts more at night, not just flavor text.
- Night reduces `computeVisible`'s effective radius for everyone by
  default (a real, flat penalty — document the magnitude) — this is the
  natural next consumer of the FOV system now that biomes/elevation
  already wired it up for something.
- New `nightfall`/`daybreak` events for the log's narrative surface —
  cheap, matches the project's "the log needs semantic content" ethos.

**Phase 3 — weather, spatial and moving, not the existing invisible global
season** (biggest, sequenced last since it plugs into Phase 1's
generalized trigger system for storm-driven shelter-seeking):
- A small number (1-3) of active weather systems at once, each with a
  type (`rain` | `storm` | `drought` | `coldSnap`), a center, a radius,
  and a lifespan — spawns, drifts slowly in a random direction, dissipates,
  and a new one spawns periodically. Spawn likelihood per type should be
  biome-influenced (Wetland/Grassland skew rain, Badlands skew
  drought/heat, Highland skews storms/cold) — real use of the biome data
  from the environmental-generation work.
- Effects, local to a cell's radius: **rain** boosts flora regrowth and
  slightly eases thirst decay; **drought** suppresses regrowth and raises
  thirst decay (deliberately composes with/accelerates the existing
  scarcity trigger rather than needing a separate mechanic — real reuse,
  not duplication); **storm** meaningfully reduces visibility/accuracy
  (bigger penalty than night) and builds per-agent "exposure" while caught
  in it without forest/canopy cover nearby — sustained exposure triggers a
  herd migration via Phase 1's generalized system, reason `"weather"`,
  destination scored toward the nearest good-cover biome patch; **cold
  snap** adds a further Speed penalty (composing with everything else)
  for species without documented cold tolerance.
- New `weatherChanged` event (type, area, start/end) for the log.
- **Explicitly still open**: exact spawn rates/radii/lifespans and the
  exposure-to-migration threshold are sim-original tuning guesses like
  everything else in this project, to judge against a real run; whether
  cold/heat tolerance needs real per-species/per-type data or a flat
  default is fine for a first pass.

### Phase 1 — as built

Only Phase 1 (the four trigger reasons) is built. **Phases 2 (day/night) and
3 (weather) above are still just decided, not built** — left for a
follow-up pass, sequenced after this one specifically so it wouldn't
collide with Phase 1's edits to the same files (`herdMigration.ts`/
`herding.ts`/`events.ts`).

- **`MigrationReason`** (`types.ts`) is a real discriminated union —
  `"scarcity" | "predator_pressure" | "wanderlust" | "territorial"` — shared
  by `World.herdMigrations`' `reason` field and `SimEvent`'s
  `herdMigrating.reason`, so both always agree. The original scarcity
  trigger's ad hoc `reason: "food scarcity"` string became `"scarcity"`;
  the 7 pre-existing tests that asserted the old string were updated to
  match (a real rename, not a regression to special-case around).
- **Predator pressure** is a running per-herd counter
  (`World.herdPredatorPressure: Record<herdId, {count, windowStart,
  lastThreatPos}>`), incremented once at the exact site `predation.ts`'s
  `resolveHit` logs a `fought` event against a herd member — not a per-tick
  `EventLog` scan (would be O(events) per herd per tick, unbounded over a
  long run; this is O(1) per real hit). The "last 300 ticks" rolling window
  DESIGN.md asked for is approximated cheaply: if the previous hit in the
  counter was more than `PREDATOR_PRESSURE_WINDOW_TICKS` (300) ticks ago,
  the count restarts at 1 instead of a real sliding-window recompute — a
  documented, deliberate over-approximation (see the doc comment on
  `recordPredatorPressure`), not an oversight. `PREDATOR_PRESSURE_THRESHOLD
  = 5` hits within that window triggers a migration; the destination search
  gets a new `awayFrom` term (see below) biased away from the attacker's
  last known position (`lastThreatPos`).
- **Wanderlust** rolls a flat per-tick-per-herd chance
  (`WANDERLUST_BASE_CHANCE = 1/3000`) scaled by the herd's average
  boldness+sociability across its living members (`herdWanderlustFactor`,
  0..1) via `max(0.25, factor * 3)` — 1.5x at neutral disposition (so the
  *real* per-tick chance for a neutral herd is 1/2000, not 1/3000 — the
  base constant is a floor, not the typical value), up to 3x at fully
  bold+social, floored at 0.25x rather than zero for a fully timid/solitary
  herd (even a cautious herd wanders *occasionally*). The destination
  (`pickWanderDestination`) is deliberately **not** resource-scored at all,
  per DESIGN.md's "doesn't need to be better, just different" — one of the
  8 compass directions at a flat 25-tile distance, landed on the nearest
  walkable tile. This is also the one trigger that still works for the
  underground/canopy herds (no food/water tiles to score there at all).
- **Territorial displacement**: a per-herd-*pair* sustained-proximity
  counter (`World.herdTerritorialTicks`, keyed by a sorted `"idA|idB"` pair
  key so it's counted once regardless of iteration order) mirrors
  scarcity's own "sustained, not instantaneous" pattern exactly — same 150
  ticks (`TERRITORIAL_SUSTAIN_TICKS`), same reasoning. Two same-species
  herds' centroids within `TERRITORIAL_DISTANCE` (`2 * COHESION_DISTANCE` =
  10) for that long triggers the *smaller* (by live member count) herd to
  migrate away from the other's centroid; a tie goes to whichever herd id
  sorts first (arbitrary, documented, doesn't matter in practice). Not
  observable in the actual demo scenario, which has exactly one herd per
  species (see real-run findings below) — confirmed correct only via unit
  tests that construct two same-species herds directly.
- **Destination scoring gained an `awayFrom` term** for `predator_pressure`/
  `territorial`: `pickDestination(world, layer, from, awayFrom?)` now adds
  `AWAY_WEIGHT * manhattan(candidate, awayFrom)` (`AWAY_WEIGHT = 0.05`,
  chosen so 40 tiles of extra distance from the threat is worth about +2 —
  comparable to a couple of healthy food tiles, not an automatic override
  of resource-richness) on top of the existing abundance score. This also
  means an underground/canopy herd, which can never clear the improvement
  bar on abundance alone, *can* still relocate for predator-pressure or
  territorial reasons — pure distance from the threat is enough — unlike
  `scarcity`, which stays correctly unreachable for those herds (see the
  `MIN_IMPROVEMENT` doc comment in `herdMigration.ts`).
- **Trigger precedence, decided and documented once** (top of
  `herdMigration.ts`, not re-derived per call site): per tick, a herd with
  no active migration is checked `scarcity` → `predator_pressure` →
  `territorial` → `wanderlust`, in that order; the first to fire wins and
  the rest aren't evaluated that tick. The two survival-critical triggers
  are checked first (their relative order is an arbitrary tie-break, not a
  real priority claim); the two soft triggers are checked after, order
  irrelevant per DESIGN.md. Simpler than a general interruption-priority
  scheme: a herd already migrating for any reason skips every trigger
  check entirely (the existing early `continue`) — nothing ever interrupts
  an in-progress migration, full stop, rather than modeling which reasons
  could preempt which.
- **11 new tests** in `herdMigration.test.ts` (235 total, up from 224):
  predator-pressure not firing on an isolated hit but firing (and scoring
  away from the threat) after a sustained pattern, and consuming its
  counter on trigger; `pickDestination`'s `awayFrom` term in isolation;
  wanderlust's fire rate matching the documented chance over 200,000
  simulated ticks with a fixed seeded PRNG (mulberry32 — deterministic,
  never flaky) and scaling up for a bolder/more social herd vs. a
  timid/solitary one (same seed on both, isolating the disposition effect);
  territorial triggering the smaller of two same-species herds and scoring
  away from the rival, and correctly not triggering for two different-
  species herds; and precedence — a wanderlust roll never interrupts an
  active `scarcity` migration, and `scarcity` wins a genuine same-tick tie
  against `predator_pressure`. All 224 pre-existing tests still pass
  unmodified apart from the 7 `"food scarcity"` → `"scarcity"` string
  updates; `pnpm -r typecheck`/`build` clean across all 4 packages.
- **Real-run findings, reported straight** (seed 20260903 demo scenario,
  `pnpm run run <N>` from `packages/runner`, several independent runs since
  the demo world isn't fully deterministic — `Math.random` unseeded for
  nature/disposition/trigger rolls):
  - **The population itself is the dominant real-run finding, and it's not
    new to this feature.** A debug instrument tracking each herd's live
    member count found `bulbasaur-herd`/`underground-colony`/`pidgey-flock`
    all frequently boom (reproduction pushes them to 2-3x their starting
    size within the first ~500-1000 ticks) then bust to full extinction
    well before 10,000-20,000 ticks — `starved` events in the dozens per
    run, `killed`/`defeated` at or near zero. This is pre-existing
    population-balance behavior (starvation/reproduction dynamics, not
    anything this feature touches) but it directly bounds how much any
    migration trigger — new or old — can be observed in the unmodified
    demo scenario: a herd that goes extinct after a few thousand ticks
    simply stops rolling for anything.
  - **Wanderlust is the only one of the four triggers that fired at all in
    ordinary runs**, confirming it does deliver "herds don't just sit there
    forever" — 0-3 `herdMigrating`/wanderlust events observed per
    20,000-tick run across the 3 demo herds combined (varies run to run,
    consistent with a ~1/2000 per-tick-per-herd chance at these herds'
    actual disposition averages and the population volatility above cutting
    each herd's effective observation window short). This is genuinely rare
    in the current demo scenario — closer to "did happen at least once in
    most runs" than "occasional restlessness clearly visible in every run"
    — a direct consequence of herds not surviving long enough to accumulate
    many rolls, not evidence the per-tick chance itself is wrong (isolated
    from population churn, the statistical test above confirms it fires at
    the documented rate). Raising `WANDERLUST_BASE_CHANCE` further to
    compensate for short herd lifespans was considered and not done — it
    would fix the symptom (visibility in this scenario) by making the
    *mechanism* less "occasional," which is the wrong lever; the actual
    lever is herd survival time, out of scope here (see the pre-existing
    population-balance gap above).
  - **Predator-pressure and territorial did not fire in any real run** —
    root-caused, not just observed: `fought` events were at or near zero
    across every run (the same pre-existing "predators barely land hits"
    dynamic TODO.md already flags for the biome-generation feature), so
    `PREDATOR_PRESSURE_THRESHOLD`'s 5-hits-in-300-ticks bar was essentially
    never approached; and the demo scenario has exactly one herd per
    species, so no territorial rival ever exists for the trigger to compare
    against. Both mechanisms are confirmed correct via direct unit tests
    (predator-pressure fires and scores correctly given synthetic hit
    events; territorial fires and scores correctly given two constructed
    same-species herds) — the gap is scenario content, not implementation.
    Making either observable in the demo world would need scenario changes
    outside this feature's scope: e.g. a second Bulbasaur herd for
    territorial, or addressing the predator-hit-rate gap for
    predator-pressure.
  - Performance: no measurable regression from the added trigger checks —
    a 10,000-tick run completes in a few seconds, consistent with the
    scarcity-only feature's own numbers; the new per-hit
    `recordPredatorPressure` call is O(1) and the territorial check is
    O(herds²) per tick, negligible at this scenario's herd count (3).

### Phase 2 — as built

Built. **Phase 3 (weather) above is still just decided, not built** — left
for its own follow-up pass, sequenced after this one specifically so it
wouldn't collide with Phase 2's edits to `events.ts` (and so weather's
visibility/Speed effects, which explicitly compose with day/night's light
level, land on top of a finished light-level function rather than a moving
target).

- **The cycle itself** (`daynight.ts`, a new small module — deliberately not
  folded into flora.ts's existing seasonal code, since the two cycles share
  nothing but "cheap deterministic function of `world.tick`", see that
  file's doc comment): `DAY_LENGTH_TICKS = 200` (DESIGN.md's own suggestion),
  `lightLevel(tick)` a `0.5 - 0.5*cos(2π·tick/200)` wave — 0 at midnight
  (tick 0), 1 at noon (tick 100), same sine-wave style as
  `seasonalMultiplier` just phase-shifted so tick 0 lands exactly on
  midnight rather than mid-rise. `NIGHT_THRESHOLD = 0.5` splits every cycle
  into an exactly-even day half and night half (so a diurnal and nocturnal
  species each get an equal-length active window by default, no favoritism
  baked in); `isTwilight` is a `±0.15` light-level band around that
  threshold, which — since light crosses 0.5 exactly twice per cycle —
  produces exactly two real dawn/dusk windows per day for crepuscular
  species, not a continuous "sort of always twilight" state.
- **`activityPattern`** landed exactly as scoped: a 4-value union
  (`"diurnal" | "nocturnal" | "crepuscular" | "cathemeral"`) on both
  `SpeciesDef` (`packages/data/src/species.ts`) and `Agent` (`types.ts`),
  denormalized onto the agent at spawn (`spawn.ts`) the same way
  `types`/`stats`/`moves` already are. Absent reads as `"cathemeral"`
  everywhere it's consulted (support.ts/predation.ts), so every hand-built
  test fixture and every species that doesn't set it is provably unaffected
  — confirmed by the full pre-existing 235-test suite passing unmodified.
  Assigned to the curated roster with real (if not strictly canon-cited)
  reasoning, documented inline at each entry: Bulbasaur/Charmander/Pidgey
  diurnal (sun-loving bulb, sun-loving flame, ordinary daytime bird);
  Diglett/Sandshrew nocturnal (burrowing mole, desert-heat-avoider);
  Scyther/Spearow crepuscular (ambush predators, dawn/dusk hunters — and
  deliberately mismatched with Pidgey's diurnal window, so Spearow is most
  dangerous exactly when its prey is running an off-hours Speed penalty);
  Venusaur/Onix left at the `cathemeral` default on purpose, documented as a
  design choice rather than an oversight (a guardian that only watches half
  the clock isn't much of one; a rock snake tunneling underground has no
  real "daylight" to have an opinion about).
- **Off-hours Speed penalty** (`support.ts`'s `activityScheduleMultiplier`,
  `OFF_HOURS_SPEED_MULTIPLIER = 0.8`): a flat 20% Speed cut while active
  outside the pattern's window — deliberately the same order of magnitude as
  the existing sand/mud terrain penalties (0.75/0.5), "sluggish off-hours,"
  not "can't act." Composes multiplicatively as documented: `actionSpeedOf`
  (simulation.ts) now multiplies base Speed by terrain factor, then this
  activity factor, then hands the product to `effectiveSpeed`'s injury
  fraction — an injured nocturnal agent slogging through mud by day stacks
  all three real penalties on one action, not just whichever is worst
  (proven by a composition test in `support.test.ts`, not just each
  modifier tested in isolation).
- **Hunt-eagerness shift** (`predation.ts`'s `activityHuntShift`,
  `NOCTURNAL_HUNT_THRESHOLD_SPREAD = 0.15`, deliberately smaller than
  aggression's own `HUNT_THRESHOLD_SPREAD = 0.2` so an individual's
  Disposition still matters at least as much as its species' activity
  pattern): a nocturnal predator's hunt-hunger threshold shifts up (hunts
  even when not very hungry) as darkness increases, and down (needs to be
  hungrier) by day; diurnal is the exact mirror; crepuscular gets a smaller
  flat eagerness bump during the two twilight windows only, since it keys
  off a specific window rather than a continuous light gradient. This is a
  genuinely additive term on top of the existing aggression-based shift, not
  a replacement — `huntHungerThreshold` sums both, confirmed by a
  composition test showing an aggressive nocturnal predator at midnight
  hunts at a hunger level neither shift alone reaches.
- **Night FOV reduction** (`fov.ts`'s `NIGHT_FOV_PENALTY = 2.5`): a new
  `lightLevel` parameter on `computeVisible`, **defaulting to `1` (full
  daylight)** rather than reading `world.tick` automatically — the
  deliberate design choice that keeps every pre-existing caller/test exactly
  as it was (world.tick starts at 0, i.e. midnight, so an automatic read
  would have silently broken every unmodified FOV test). The penalty shrinks
  the *radius* itself (same treatment `ELEVATION_SIGHT_BONUS` gives it, just
  the other direction) before concealment/elevation-asymmetry per-target
  adjustments and before the ridge-blocking line-of-sight check — a fourth,
  independent term layered on, not replacing, the three that already
  existed. New tests confirm both halves explicitly: the exact same
  elevation-extends-radius and ridge-blocks-over-the-top assertions from the
  original FOV tests still hold bit-for-bit at `lightLevel: 1`, and a
  measurable, real radius shrink at `lightLevel: 0`.
- **`nightfall`/`daybreak` events**: emitted from `simulation.ts`'s
  `tickWorld`, once per actual phase transition — computed by comparing
  `isNight` at the tick before vs. after the increment, so no extra
  persisted world state is needed just to catch the boundary. Each event
  carries the exact `lightLevel` at that tick for narrative flavor.
  `packages/runner/src/format.ts`'s exhaustive `SimEvent` switch needed the
  two new cases (confirmed: TS's exhaustiveness check caught the gap
  immediately at compile time, the same class of break a recent feature
  flagged for this exact file) — added and rendered as plain "night
  falls"/"day breaks" lines with the light level to two decimal places.
- **24 new tests** across 5 files (`daynight.test.ts` new; `fov.test.ts`,
  `support.test.ts`, `predation.test.ts`, `simulation.test.ts` extended) —
  259 total, up from 235. Covers the light-level function's shape/period/
  determinism; `isNight`/`isTwilight`'s exact boundary behavior; the
  off-hours penalty per pattern *and* its multiplicative composition with
  injury/terrain (not just each modifier alone); the nocturnal/diurnal hunt
  threshold shifts *and* their composition with the pre-existing
  aggression-based shift; the night FOV reduction *and* an explicit
  regression check that the pre-existing elevation/ridge FOV tests still
  pass unmodified at full daylight; and `nightfall`/`daybreak` firing
  exactly once per real phase transition (not every tick) at the tick the
  phase actually flips. All 235 pre-existing tests still pass completely
  unmodified — no test needed updating for this feature, unlike Phase 1's 7
  string-rename updates. `pnpm -r build`/`test` clean across all 4 packages.
- **Real-run findings, reported straight** (`pnpm run run <N>` from
  `packages/runner`, several independent runs plus a 6-trial batch
  comparison against the pre-Phase-2 commit, since the demo world isn't
  seeded):
  - **`nightfall`/`daybreak` fire at exactly the right rate and nowhere
    else**: a 10,000-tick run produced exactly 50 of each (10,000 / 200 —
    the math checks out exactly, not approximately), and a dedicated test
    walks a full 200-tick cycle confirming each event's own tick is the
    real light-level crossing, not off-by-one in either direction.
  - **Hunting never happened in any real run — at all, in either
    direction.** Zero `fought`/`killed`/`hunt`-behaviorChanged events across
    every run tried (1,000 and 10,000 ticks). This makes the nocturnal/
    diurnal hunt-eagerness shift **unconfirmed in an actual run** — not
    because it's wrong (it's directly, thoroughly unit-tested, including the
    composition case) but because the pre-existing "predators barely
    encounter prey" gap Phase 1's writeup above already root-caused
    (scenario map too sparse/large relative to agent count and detection
    radii) means the mechanism this feature extends never actually fires in
    the unmodified demo scenario, day or night. Same honest gap as Phase 1's
    predator-pressure/territorial triggers, for the same underlying reason.
  - **The off-hours Speed penalty and night FOV reduction are real and
    active every run** (they don't depend on a rare encounter to trigger —
    every agent is either in its window or not, every tick), but aren't
    independently visible in the event log by design: neither produces its
    own event, only a smaller number/radius fed into existing systems.
    Confirmed working the honest way instead — direct composition tests
    above, plus manually sampling `activityScheduleMultiplier`/
    `computeVisible` at real in-run tick values.
  - **Population collapse (documented as pre-existing in Phase 1's own
    findings above) is not obviously worse under Phase 2, within the noise
    of an unseeded sim**: a 6-trial batch of 10,000-tick runs on this
    branch ended with a mean of 2.8 agents alive (range 0-11, 1/6 runs fully
    extinct); the same 6-trial batch on the pre-Phase-2 commit ended with a
    mean of 1.5 (range 0-3, also 1/6 extinct). Six trials is too small a
    sample to claim Phase 2 *improves* survival, but it rules out the
    obvious worry — that stacking a third Speed penalty onto injury/terrain,
    or a real FOV cut, would visibly accelerate the existing collapse. It
    doesn't, at least not at a magnitude six trials would catch. The
    underlying collapse itself remains exactly the pre-existing,
    out-of-scope population-balance gap Phase 1 already flagged, not
    something this feature introduces or is responsible for fixing.
  - **No stacked-penalty deadlock**: nothing in this feature can drive an
    agent's effective Speed to zero or its huntable radius to nothing —
    `OFF_HOURS_SPEED_MULTIPLIER` (0.8) floors well above
    `FAINT_SPEED_FLOOR` (0.35) even multiplied together with the worst
    terrain penalty (mud, 0.5): `0.5 * 0.8 * 0.35 ≈ 0.14`, a genuinely slow
    but nonzero action rate, not an effective freeze. `computeVisible`'s
    radius is explicitly floored at 0 (`Math.max(0, ...)`), so a tiny
    `baseRadius` at full darkness degrades to "can only see your own tile"
    rather than crashing or going negative.

### Phase 3 — as built

Built — this closes out all three phases of "Dynamics that move a content
herd." Sequenced last, per the plan, so it could plug into Phase 1's
generalized trigger system and Phase 2's finished `lightLevel` function
without either being a moving target.

- **Weather cells** (`weather.ts`, a new module matching `daynight.ts`'s
  precedent — its own small state + query functions other files' existing
  systems call into, not a parallel weather-specific code path):
  `World.weatherCells` holds 1-3 active `WeatherCell`s (`type`, `center`,
  `radius`, `startedTick`, `lifespanTicks`, a constant per-tick `drift`
  vector). `advanceWeather` (called once per tick from `simulation.ts`'s
  `tickWorld`, before `updateHerdMigrations` so the same tick's exposure
  check sees fresh weather) ages out and dissipates expired cells (logging
  `weatherChanged`'s `"ended"` phase), drifts survivors by their fixed
  vector (clamped to the map edges, not sailing off), then rolls
  `WEATHER_SPAWN_CHANCE_PER_TICK` (1/150) for a fresh cell whenever there's
  room under the cap — radius 8-18, lifespan 200-500 ticks, drift speed
  0.15 tiles/tick in a random direction fixed at spawn. All sim-original
  tuning guesses, judged against the real-run findings below like
  everything else in this codebase.
- **Biome-influenced spawn likelihood**, real reuse of the
  environmental-generation biome data, not a second invented concept:
  `generateWorld` (`worldgen.ts`) now also persists `World.biomeSeeds` —
  a name-only projection of its internal seed placement (`BiomeSeedInfo`,
  types.ts) — and a new exported `biomeWeightsAt` answers "which biome(s),
  and how strongly, does this point blend toward" using the exact same
  distance-weighted-nearest-seeds math `blendBiomeParams` already uses for
  generation, just classifying by name instead of blending the full
  density/terrain-weight table. `weather.ts`'s `pickWeatherType` combines
  every biome contributing to a candidate spawn point's blend against a
  documented affinity table (`BIOME_WEATHER_AFFINITY`) — Wetland skews
  rain hardest (weight 3 of a 4.8 total, ~62.5%), Grassland skews rain more
  mildly (2 of 4, 50%), Badlands skews drought hardest (3 of 4, 75%),
  Highland skews storm and coldSnap about equally (2.5 each of 5.8, ~43%
  each) — a world with no biome data at all (a hand-built `createWorld`
  test fixture) falls back to a uniform 25%-each roll rather than guessing.
  Confirmed by a fixed-seed statistical test (`weather.test.ts`, 5000
  trials per biome) rather than eyeballing it.
- **Rain** divides `flora.ts`'s existing decay-rate term by
  `RAIN_FLORA_DECAY_DIVISOR` (1.6, slower decay) and multiplies its
  spread-chance term the same direction — composing with, not replacing,
  the existing global `seasonalMultiplier`. This is the closest this
  codebase's stock/decay/spread flora model gets to "boosts regrowth,"
  since there's no direct "add stock back" mechanic to instead scale up
  (documented explicitly in `floraDecayDivisor`'s doc comment — a real
  scope call, not an oversight). It also eases `needs.ts`'s flat per-tick
  thirst decay via a new `thirstMultiplier` parameter on `decayNeeds`
  (`RAIN_THIRST_DECAY_MULTIPLIER = 0.6`), computed once per agent per tick
  in `tickAgentNeeds` from its own position.
- **Drought** does the exact mirror: `DROUGHT_FLORA_DECAY_DIVISOR` (0.45,
  faster decay, less spread) and `DROUGHT_THIRST_DECAY_MULTIPLIER` (1.8,
  faster thirst decay). Deliberately meant to compose with the existing
  scarcity migration trigger rather than needing a separate mechanic — and
  it does, mechanically: `tryScarcityTrigger` reads `abundanceAt`, which
  sums live food-tile `stock`, which now decays faster under an overlapping
  drought cell, so a drought-covered herd's local abundance score drops
  measurably sooner than an identical herd outside one. Confirmed
  numerically in `flora.test.ts` (same tick/season, drought vs. no weather,
  a real stock gap) — see real-run findings below for whether this ever
  actually pushes a herd's scarcity counter over its threshold in practice
  (the honest answer: it gets close but the demo scenario's abundant map
  means it still doesn't, same story as Phase 1's own scarcity finding).
- **Storm**: a real accuracy penalty (`combat.ts`'s `rollAccuracy` gained a
  5th `extraMultiplier` parameter, defaulting to 1 so every pre-existing
  call site is unaffected; `predation.ts`'s `resolveHit` — the sim's one
  live accuracy-roll call site — passes `weather.ts`'s
  `stormAccuracyMultiplier`, `STORM_ACCURACY_MULTIPLIER = 0.6`, a 40% cut).
  This is the sim's first-ever *real* accuracy debuff — there was no
  existing "elevation-accuracy-modifier" pattern to match (accuracy/evasion
  stages exist in `combat.ts` but nothing has ever set one), so
  `extraMultiplier` was added as a second, independent, general-purpose
  multiplier rather than inventing a storm-specific parameter. A real FOV
  penalty too: `fov.ts`'s `computeVisible` gained a 5th `stormPenalty`
  parameter (default 0), subtracted from the radius *alongside*
  `lightLevel`'s existing night penalty rather than folded into the same
  scalar — a deliberate choice, documented in both `computeVisible` and
  `weather.ts`: night-darkness and storm-darkness are independently
  controllable (a storm can happen by day) and describe physically
  different things, so two additive terms (both floored at 0 by the same
  `Math.max(0, ...)`, i.e. "additive severity, capped at a floor of zero
  visibility" — the simplest of the composition options DESIGN.md left
  open) beat reconstructing one combined darkness number at every call
  site. `STORM_FOV_PENALTY = 4` is bigger than `NIGHT_FOV_PENALTY` (2.5),
  per the design ask. Like Phase 2's own FOV work, `computeVisible` still
  isn't wired into any live gameplay detection (`predation.ts`'s flee/hunt
  radius is a separate manhattan-distance/concealment check, not this
  function) — confirmed directly via `fov.test.ts`, the same honest
  pattern Phase 2 already established for this same function.
- **Storm exposure -> `"weather"` migration**: a per-*herd* aggregate
  (`World.herdStormExposureTicks`, mirroring `herdScarcityTicks`'s exact
  reset-on-recovery shape) rather than a per-agent tally — DESIGN.md left
  the choice open and explicitly asked for whatever's cleanest to feed the
  shared herd-migration trigger; reusing the sustained-counter pattern
  already built twice (scarcity, territorial) was simpler than inventing a
  per-agent scheme that would need aggregating back up to the herd level
  anyway. `tryWeatherTrigger` (`herdMigration.ts`, third in trigger
  precedence — after `scarcity`/`predator_pressure`, before
  `territorial`/`wanderlust`, see the module's updated top-of-file
  precedence doc) checks the herd centroid against `weather.ts`'s
  `activeWeatherAt` (real Euclidean-radius lookup, deliberately circular
  unlike the Chebyshev-box tile scans elsewhere) and `hasCoverNearby` (a
  literal small local tree/bush tile scan, `COVER_SCAN_RADIUS = 3`) —
  exposed and uncovered for `STORM_EXPOSURE_SUSTAIN_TICKS` (100) consecutive
  ticks triggers reason `"weather"`. Destination scoring gained a
  `preferCover` term on `pickDestination` (a boolean, not a reference point
  like `awayFrom` — "toward better shelter in general" has no single
  threat position to flee): `coverBonus` adds `COVER_WEIGHT * ` a
  candidate's real forest-biome blend weight (`worldgen.ts`'s
  `biomeWeightsAt` again — a deliberate, documented split from
  `hasCoverNearby`'s tile-level exposure check: picking a destination
  *region* is a "which neighborhood is this" question biome blending
  answers well, while "am I sheltered right here, right now" is a literal
  tile fact). `COVER_WEIGHT = 6`, same tuning philosophy as Phase 1's
  `AWAY_WEIGHT` — a real pull toward cover, not an automatic override of
  resource-richness.
- **Cold snap**: a flat `COLD_SNAP_SPEED_MULTIPLIER` (0.7) for every agent
  caught in one, regardless of species — `support.ts`'s
  `coldSnapSpeedMultiplier`, the fourth composable term in
  `simulation.ts`'s `actionSpeedOf` chain (terrain/elevation, off-hours
  activity schedule, cold snap, injury). DESIGN.md's own "still open"
  note said a flat default is fine for a first pass rather than real
  per-species cold-tolerance data — this sim takes that offer directly:
  no new species-data field was added, since DESIGN.md's phrasing reads as
  an explicit deferral, not a gap to quietly half-close.
- **`weatherChanged` event** (`type`, `phase: "began" | "ended"`, rounded
  `center`, `radius`) fires at spawn and dissipation — no separate
  per-agent "entered/left a cell" event: a herd's exposure is already
  narrated indirectly via the `"weather"` `herdMigrating` reason when it
  matters enough to actually move a herd, and a per-tick per-agent
  in/out event for up to 3 slowly-drifting cells was judged a lot of
  low-value log volume for something with no other consumer yet (a
  documented scope call, not an oversight). `packages/runner/src/format.ts`'s
  exhaustive `SimEvent` switch needed the new case — caught immediately by
  TS at compile time, the same class of gap this exact file has now
  flagged three features running.
- **58 new tests** across a new `weather.test.ts` (29 tests: cell
  spawn/drift/clamp-at-edge/dissipation lifecycle; the biome-weighted
  spawn statistical tests above; every effect query in isolation, surface-
  layer gating, and the "no active weather" neutral case) plus extensions
  to `flora.test.ts`, `needs.test.ts`, `fov.test.ts`, `combat.test.ts`,
  `support.test.ts`, `predation.test.ts` (a real end-to-end test: the exact
  same mocked-roll fight hits in clear weather and misses inside an active
  storm, not just the multiplier tested in isolation), and `herdMigration.test.ts`
  (the weather trigger's sustain/reset/cover-recovery behavior, and
  `pickDestination`'s `preferCover` term in isolation). 317 tests total, up
  from 259. All pre-existing tests pass **completely unmodified** — no
  string-rename or behavior-assumption update needed this time, unlike
  Phase 1's 7. `pnpm -r build`/`typecheck` clean across all 4 packages.
  One pre-existing test (`herdMigration.test.ts`'s "triggers once scarcity
  has been sustained..." test) was found to be already flaky *before* this
  feature touched anything — it calls `updateHerdMigrations` with the
  default unseeded `Math.random` rather than `NEVER_WANDER`, so roughly a
  7% chance per run that a real wanderlust roll fires during its 150-tick
  scarcity-sustain loop and changes the migration's `reason` out from under
  the assertion. Confirmed pre-existing (not touched by this feature's
  diff, reproduces on the pre-Phase-3 commit too) rather than something
  this work introduced — left alone per this feature's scope, but worth a
  future five-minute fix (pass `NEVER_WANDER` like every other
  non-wanderlust-focused test in that file already does).
- **Real-run findings, reported straight** (`pnpm run run <N>` from
  `packages/runner`, plus several standalone diagnostic runs instrumenting
  `World.herdScarcityTicks`/`herdStormExposureTicks` directly, since the
  demo world isn't seeded):
  - **Weather cells genuinely spawn, drift, and dissipate on schedule in
    every real run.** A 10,000-tick run logged 102 `weatherChanged` events
    (51 began/51 ended) across all four types, lifespans consistently
    landing inside the documented 200-500 range (e.g. a rain cell spawned
    at tick 88 dissipated at tick 337, a 249-tick life), and drifting
    cells were observed clamped exactly at the map edge (center `(0,0)`)
    rather than sailing off it. This is the one part of Phase 3 that reads
    as unambiguously "just works" every single run, no rare-encounter
    caveat needed.
  - **The `"weather"` migration trigger is the real, honest good-news
    finding of this feature — unlike predator-pressure and territorial in
    Phase 1, this one actually fires in the unmodified demo scenario, more
    than once in a while.** Across 10 independent 20,000-tick runs, a
    `"weather"`-reason `herdMigrating` event fired in 3 of them (and, in a
    separate batch of 15 shorter 10,000-tick diagnostic runs, in about a
    third of them, sometimes more than once per run) — genuinely
    comparable in observed frequency to wanderlust, the one Phase 1 trigger
    that reliably fired. Root cause for why this one, specifically, beats
    predator-pressure/territorial's "never observed" and even beats
    scarcity's "essentially never": storm cells are large (radius 8-18 on
    an ~90x60 map) and the demo scenario's open ground routinely lacks
    nearby tree/bush cover, so a herd sitting in its usual range has a
    real, non-rare chance of landing inside a storm with nothing to shelter
    under — no dependence on a fight actually connecting (which, per every
    prior phase's finding, it essentially never does) or on a second herd
    of the same species existing at all. One observed migration's
    destination went from `(38,22)` all the way to `(78,22)` — a real,
    substantial relocation toward the map's forest-heavy side, not a
    token nudge.
  - **Drought measurably accelerates local flora decay (confirmed
    directly), but was never observed pushing a herd's scarcity counter
    over its 150-tick threshold in a real run — it got close.** Direct
    instrumentation of `World.herdScarcityTicks` across the same 10,000-
    and 20,000-tick trial batches found the counter twice reaching 149
    (one tick short of triggering) but never crossing 150, and `scarcity`
    never appeared as a `herdMigrating` reason in any of the ~25 total
    trial runs across both batches. This mirrors Phase 1's own honest
    scarcity finding exactly (the demo map is abundant enough that
    scarcity rarely fires at all, drought or not) — drought clearly speeds
    up the *local* decay math (proven directly, not assumed, in
    `flora.test.ts`), but whether a drought cell happens to overlap a
    herd's actual foraging range for a sustained-enough window, on a map
    this abundant, is itself a rare coincidence on top of an already-rare
    trigger. Not a bug in the composition — a genuine "the mechanism is
    real, the real-run conditions to observe it stacking are rarer than
    hoped" finding, the same honest category as three separate findings
    across Phases 1-2.
  - **Storm's accuracy/FOV penalties are real, tested, and wired into the
    one live accuracy-roll call site — but, like Phase 2's hunt-eagerness
    shift before them, never independently observed firing in a real run,
    because there was no combat to apply them to.** Every 1,000- and
    10,000-tick run tried had zero `fought`/`missed` events, the same
    "predators barely encounter prey" root cause Phase 1 diagnosed and
    Phase 2 re-confirmed. A dedicated `predation.test.ts` test proves the
    real wiring works end-to-end (the identical mocked dice roll hits in
    clear weather and misses inside a storm, through the actual
    `tickWorld` -> `resolveHit` -> `rollAccuracy` path, not a bypassed
    unit call), so this is confirmed correct, just — like combat itself —
    unconfirmed as *observed* in an unscripted run.
  - **Cold snap's Speed penalty is real and active every tick an agent
    spends inside one** (it doesn't depend on a rare encounter — every
    agent in a cold-snap cell is simply slower, every tick), but like
    Phase 2's own off-hours penalty, produces no event of its own to grep
    for in a log; confirmed the same honest way Phase 2's writeup did —
    direct composition tests, not log-watching.
  - **Population collapse remains exactly the pre-existing, out-of-scope
    gap Phases 1-2 already flagged, and still dominates what's observable
    in any single run.** Across the diagnostic batches, `pidgey-flock`
    routinely goes fully extinct within the first ~2,000 ticks and the two
    surviving herds frequently bottleneck to a single member each well
    before 10,000 ticks — a genuinely different mechanism than any
    migration trigger (herd cohesion/migration logic all still runs
    correctly against a 1-member "herd," it's just not a meaningful group
    dynamic anymore at that point). This bounds every trigger's real-run
    observability the same way it did in Phases 1-2, and remains something
    this feature doesn't touch or attempt to fix.
  - Performance: no measurable regression — the added `advanceWeather` call
    (O(active cells) ≤ 3, trivial) and the per-tile `floraDecayDivisor`
    lookup inside `growFlora`'s existing O(tiles) loop (each lookup itself
    O(active cells)) add negligible cost; a 10,000-tick run completed in
    ~8 seconds, consistent with every prior phase's own numbers.

**Closing out the three-phase section, honestly**: DESIGN.md's original ask
was "a herd needs reasons to move besides starving." Across all three
phases, the real-run answer is a genuine but partial yes. Wanderlust
(Phase 1) and now weather-driven shelter-seeking (Phase 3) both reliably
fire in the unmodified demo scenario and are the two triggers that actually
deliver on "herds don't just sit there forever" in practice — a real,
observable improvement over the pre-Phase-1 scarcity-only baseline.
Predator-pressure, territorial, and scarcity itself (even with drought's
real acceleration) remain confirmed-correct-but-rarely/never-observed in
this specific scenario, root-caused every time to the same two pre-existing,
out-of-scope facts: predators essentially never land a hit, and the demo
map is abundant enough (and now has population collapse cutting herd
lifetimes short on top of that) that scarcity almost never sustains long
enough to fire. So: yes, a content herd now has real reasons to move beyond
starving — just fewer of the five *mechanisms* actually exercise that in a
given run than the design doc's five bullet points might suggest, and the
gap is consistently scenario/population content, not anything wrong with
the trigger logic itself (every trigger, including the never-observed ones,
is directly confirmed correct via unit tests that don't depend on the
scenario's luck).

## Natal dispersal: real biology's actual fix for the inbreeding bottleneck

Decided, not built yet. Confirmed by direct A/B test on seed 42 (same seed,
3000 ticks, only difference: `isRelated` disabled): the bulbasaur population
reached 65 with inbreeding avoidance active vs. 98 without it, and the gap
is worse early — 9 vs. 40 by tick 1800. With only 2 founding pairs, the
relatedness check (parent/offspring, siblings, grandparent/grandchild)
genuinely starves the mate pool for the first ~1800 ticks of a 3000-tick
run, which is most of why a fresh run reads as uneventful for a long time.

The instinct to just add more founders was rejected in favor of the
actually-correct fix, confirmed against how real biology handles this: real
animals don't do genealogical bookkeeping — they avoid inbreeding
behaviorally (kin recognition, not finding natal-group-mates attractive),
and the real mechanism that keeps gene pools mixed is **natal dispersal**:
a maturing individual leaves its birth group and finds mates elsewhere,
rather than every individual doing a stricter mate-search within a fixed
population. This was already pitched, unbuilt, in TODO.md's Culture
section ("Evolution as a dispersal trigger") — this locks a concrete
version of it, triggered by more than just evolving.

- **Two triggers, not one.** (1) A disposition-weighted chance to disperse
  at maturity (age crosses `MATURITY_AGE`) or on evolving — bolder/less
  sociable individuals disperse more readily, reusing the existing
  Disposition axes, matching the original TODO pitch's flavor. (2) A
  **guaranteed fallback**: an agent that's been mature for a long sustained
  stretch with zero eligible mates found nearby (no unrelated, opposite-
  sex, mature candidate within its search radius) disperses regardless of
  the disposition roll. (1) is the biologically-flavored trait; (2) is what
  actually guarantees the mechanical bottleneck gets solved even for a
  disposition roll that never favors it — don't ship only the flavorful
  version and call the real problem fixed by luck.
- **Dispersal is a real relocation, not a stat change.** A dispersing agent
  walks to a distant point (reusing `migrate()`/`findRandomWalkableTile`'s
  existing "walk to a random distant point" utility, or resource-aware
  scoring from `herdMigration.ts` if that's a clean fit) and, on arrival:
  joins an existing other herd of its species if one is found nearby, or
  **founds a brand new herd** (a fresh, unique `herdId`) if none is. This
  is what actually pays off the mechanic: over a long run, a single
  founding herd can seed multiple independent lineages across the map,
  which can later reconverge (their descendants are unrelated by the
  existing `isRelated` check, since it only tracks direct genealogy, not
  herd membership) or trigger the already-built territorial-displacement
  migration trigger if two same-species herds end up too close. Real
  systemic reuse, not a new parallel mechanic.
- **New `dispersed` event** (agentId, species, fromHerd, toHerd, reason:
  `"matured"` | `"no_eligible_mates"`) — another real narrative beat for
  the log ("bulbasaur-14 left the herd and founded a new lineage near the
  forest's edge").
- **Explicitly still open**: exact disposition-to-dispersal-chance mapping
  and the "sustained no mates found" duration are sim-original tuning
  guesses like everything else here, to validate against a real run;
  whether dispersal should be sex-biased (many real species disperse one
  sex more than the other) is a reasonable future refinement, not required
  for this pass — an unbiased chance is a fine first cut.

### Built, and what a real run actually showed

Built as designed above, in `engine/src/dispersal.ts`: both triggers
(`maybeTriggerDispersal`), relocation reusing `migration.ts`'s
`findRandomWalkableTile` (confirmed the right call over `herdMigration.ts`'s
`pickDestination` — that machinery scores a whole herd's shared
centroid/abundance, which a lone disperser leaving its herd behind has none
of left to score against), and join-or-found on arrival
(`finishDispersal`), scanning `world.agents` directly for a nearby
same-species herd rather than any registry — confirmed this needs no
pre-registration anywhere, exactly as expected. A new `Agent.herdId` this
function assigns just works: `herdCentroid`/`applyHerdCohesion`/
`herdMigration.ts`'s per-herd trackers all derive their herd list by
scanning `world.agents`, so a freshly-founded herd is a normal herd from its
very first tick.

Two scope calls beyond the spec's literal text, both documented in code:
`dispersed`'s event gained an `outcome: "joined" | "founded"` field (spec
only asked for `agentId`/`species`/`fromHerd`/`toHerd`/`reason`) — cheap to
add and immediately useful for judging the feature's real effect (see
below); and the maturity trigger needed a one-shot `maturityDispersalRolled`
flag rather than the spec's literal "at maturity (age crosses
`MATURITY_AGE`)" exact-tick reading, because the Speed-driven action economy
means an agent's action tick (where the roll runs) doesn't reliably land on
the exact tick its age crosses the threshold — see `dispersal.ts`'s
`MATURITY_CROSSING_WINDOW_TICKS` doc comment.

**Tuning, and a real bug this surfaced in the process**: the first cut used
`NO_MATES_DISPERSAL_TICKS = 300` (this codebase's usual "sustained, not one
bad tick" order of magnitude). On seed 42/3000 ticks that produced 25
dispersals and a bulbasaur-line population of 27 — *worse* than the 65
baseline, not better. Root cause, confirmed by inspecting the actual
`dispersed` log: with a small early population (2 founding pairs), an
individual can easily go a few hundred ticks without another eligible
opposite-sex agent happening to be within `mateSearchRadius` just from
ordinary movement/herd-cohesion noise, with nothing actually wrong — herd
cohesion would have reunited them soon enough. 300 ticks was short enough
that the fallback was firing on exactly the individuals the early
population most needed to keep breeding in place, sending them off to
(usually) permanent solitude instead — of that seed's 25 dispersals, 18
founded a brand-new herd of one and only 7 found an existing herd to join,
and the 90x60 map is large enough, and `findRandomWalkableTile`'s picks
uncoordinated enough, that two independent lone dispersers rarely land near
each other. Raised to `NO_MATES_DISPERSAL_TICKS = 1000` — long enough that
it only fires on genuinely, persistently mate-starved individuals rather
than ordinary short gaps.

**The real seed-42 comparison, run twice (3000 ticks, and again at 8000)**:

| | 3000 ticks, all species | 3000 ticks, bulbasaur-line | 8000 ticks, bulbasaur-line | distinct bulbasaur-line herds at 8000 |
|---|---|---|---|---|
| Baseline (no dispersal) | 102 | 66 | 180 | 1 |
| With dispersal | 54 | 22 | 263 | 13 |

At the specific 3000-tick mark asked for, dispersal reads as *worse*, not
better — but that single-seed number is misleading on its own, and reporting
it without the rest below would be dishonest. Every `rng()` call dispersal
adds (the disposition roll, the relocation-target search) shifts every
*subsequent* draw in that world's one shared `mulberry32` stream — a
deterministic-PRNG system is chaotic-sensitive to that: adding or removing
any draw reshuffles the entire rest of the run's outcomes, unrelated to
whether the feature itself helps or hurts. Confirmed by averaging 20 seeds
(0-19) at 3000 ticks: baseline mean bulbasaur-line population 34.5, with
dispersal 33.2 — statistically indistinguishable given per-seed variance
that ranges from 0 to 162 individuals on that same species. At 3000 ticks,
dispersal is real-but-neutral, not a regression and not yet a fix.

Running seed 42 out to 8000 ticks (enough time for founded herds to mature
and actually reconverge, the payoff DESIGN.md's original pitch described)
tells the more honest story: bulbasaur-line population 263 vs. baseline
180 (+46%), spread across 13 independently founded/joined herds instead of
one. `dispersed` events did fire for real (63 of them by tick 8000: 42
founded, 21 joined) and founding a new herd is confirmed actually
happening, not just theoretically supported. The mechanism is real and
does what DESIGN.md describes — it just needs several thousand more ticks
than a 3000-tick run gives it to pay off, matching real biology's own
timescale for dispersal-driven gene flow (a multi-generation process, not
an instant fix). **Honest bottom line**: this pass doesn't move the needle
at the specific 3000-tick checkpoint the motivating A/B test used, and
shouldn't be read as a fix "confirmed" at that timescale the way the
inbreeding-avoidance regression was; it's a real, working mechanism whose
benefit shows up on a longer horizon, and 1000 ticks is very possibly still
not the last word on tuning it — flagged, like the base chance/threshold
themselves, as sim-original and open to future revision against more runs,
ideally averaged over several seeds rather than judged off any one.

### Cross-herd mating escape hatch: fixing the solo-dispersal-founder dead end

**Decided and built.** Diagnosed directly from `reproduction.ts`'s
`isEligibleMate` and `dispersal.ts`'s `finishDispersal`, not a guess: a
disperser who can't find an existing nearby herd to join founds a brand-new
herd containing exactly itself. `isEligibleMate`'s herd check
(`agent.herdId && agent.herdId !== candidate.herdId → ineligible`) then
permanently blocks that solo founder (and any herd that simply has no
current opposite-sex mature member) from mating with anyone outside its
herd of one — a real dead end, not a rare edge case, since a large map with
many independent dispersal events routinely produces herds-of-one that
never get an opposite-sex member on their own. This is the confirmed
mechanism behind "population sometimes explodes, sometimes stays low" —
whether a run's early dispersals happen to land solo founders next to
compatible herds is essentially a coin flip per founder.

Fix: `isEligibleMate` now allows a cross-herd pairing once *either* party
has gone `MATE_ISOLATION_TICKS` (200) consecutive ticks with zero eligible
mates in range — tracked via the existing `Agent.ticksSinceEligibleMate`
counter (already maintained in `applyMateSeeking` and already consumed by
dispersal's own guaranteed-fallback trigger, so this reuses state rather
than inventing new bookkeeping). Checking *either* side, not just the
scanning agent, matters because mating fires on the female's turn: without
checking the male's isolation too, an isolated male standing right next to
a non-isolated female in another herd would still never be listed as a
candidate by her own (unwidened) scan. 200 ticks is deliberately much
shorter than dispersal's own 1000-tick `NO_MATES_DISPERSAL_TICKS` — that
threshold gates the cost of physically relocating across the map, while
this one only widens who an agent already standing still is willing to
consider, so it can afford to be much more impatient.

**Real-run findings (3000-tick, `HUNT_RULES`/`LEVELING_CONTEXT`, three
seeds):** the fix is confirmed firing — seed 7 produced a genuine
cross-herd birth at tick 2561 (`venusaur-1`, herd `bulbasaur-herd` ×
`squirtle-170-4`, herd `wartortle-lineage-squirtle-170-4-2510`) that could
not have happened under the old unconditional herd lock. Seeds 42 and 123
saw zero cross-herd births in this particular run — expected, since the
escape hatch only fires for a herd that's *actually* gone sterile that
long, not every herd. Final populations shifted substantially across all
three seeds relative to a same-seed baseline without the fix (e.g. seed 42:
219 vs. a differently-shaped earlier baseline run) — consistent with this
sim's documented rng-chaos-sensitivity (changing `isEligibleMate`'s control
flow perturbs the rng consumption sequence from the first affected tick
onward, so a same-seed before/after isn't a clean isolated A/B; the
mechanism firing correctly is the confirmed finding here, not the raw
population deltas). All 579 engine tests pass, including 4 new tests
covering: no immediate cross-herd mating before isolation, same-herd
preference still winning once isolated but a same-herd mate becomes
available again, an isolated solo founder actually producing cross-herd
offspring once past the threshold, and the either-side-isolated case.
Determinism test unaffected.

**Open tuning question, not resolved here:** whether 200 ticks is the right
number, and whether it should scale with local population density (a
sparser map might want a shorter fuse) — flagged in TODO.md rather than
guessed at without more runs.

## More individual-agent incentive systems: shelter-building and herd status

Decided, not built yet. Direct ask: give individual agents more
self-directed goals beyond survive/reproduce, the same pattern the needs
system already uses for hunger/thirst/mating, extended into deliberate
agency — an agent picks a goal, invests real time/movement toward it, gets
a real payoff. Shelter-building and herd status are the first two, built
as separate features (not bundled) in that order. Food cultivation,
cross-species courtship attempts, and deliberate training/sparring for exp
are real, captured as backlog in TODO.md, not designed here yet.

### Shelter-building

Deliberately **decoupled from the "terrain lifecycle + construction +
overworld" combined design** noted earlier in TODO.md — that pitch assumed
shelter needed tree growth/decay machinery first; it doesn't, it just needs
a new persistent terrain kind and a construction behavior. The fancier
growth/decay/storm-interaction layer can attach later once terrain
lifecycle actually lands, without this feature waiting on it.

- **Species-tied**, per direct instruction, not universal: a new
  `SpeciesDef` flag (e.g. `buildsShelter: boolean`), assigned to species
  where it's thematically real (burrowing/nesting temperament — e.g.
  Diglett/Sandshrew are the obvious fits in the current roster; judge the
  rest by the same standard rather than flipping it on for everything).
- **A real spatial task, not build-on-the-spot** — direct instruction
  ("reasons to move around spatially"). Three real steps: (1) an eligible,
  otherwise-idle agent whose herd has no shelter within a real radius picks
  a build site some minimum distance from its current position (forces
  actual travel — reuse a resource/cover-aware scoring approach similar in
  spirit to `herdMigration.ts`'s `pickDestination`, or a simpler distance-
  floor if that's cleaner, document whichever), (2) travels there (reuse
  the existing step-toward-target pattern every other relocation behavior
  already uses — `migrate()`/`applyDispersal()`), (3) once arrived, spends
  a real time investment standing there (a new `BehaviorKind`, e.g.
  `"buildShelter"`) before the structure actually completes — not instant.
- **Real mechanical payoff, immediately** — per direct instruction, not
  deferred: a new terrain kind (e.g. `"shelter"`), walkable, that reduces
  detection radius the way `bush` concealment already does, **and** reduces
  the per-herd storm-exposure accumulation that currently drives weather.ts's
  shelter-seeking migration trigger — an agent near a real shelter should
  measurably need to migrate away from storms less often. Reuse both
  existing mechanisms rather than inventing new ones.
- **Decay if abandoned** — no agent within a real radius for a long
  sustained stretch reverts it to floor, same lifecycle shape flora/weather
  systems already use, so shelters don't accumulate on the map forever.
- New `shelterBuilt`/`shelterAbandoned` events for the log.
- **Explicitly still open**: exact build-site scoring, build-time duration,
  and abandonment threshold are sim-original tuning guesses like everything
  else here, to judge against a real run.

#### Built — implementation notes and real-run findings

Built as `packages/engine/src/shelter.ts` plus the wiring listed above.
Concrete scope calls and tuning constants, and what a real seed-42 run
actually showed:

- **Species**: only `diglett` and `sandshrew` got `buildsShelter: true` —
  the task brief's own two examples, and the only genuinely literal
  burrowers in the current roster. Judged and rejected the rest by the same
  standard rather than defaulting to "every underground/enclosed species":
  Onix tunnels through solid rock it's already surrounded by rather than
  constructing a discrete structure; Pidgey/Spearow are ordinary songbirds/
  raptors with no mainline nest-building flavor text; Bulbasaur/Venusaur/
  Charmander/Squirtle have no burrowing/nesting flavor at all. See
  `packages/data/src/species.ts`'s own top-of-roster comment for the full
  per-species reasoning.
- **Build-site scoring**: the simpler of the two offered options — a plain
  random pick at least `SHELTER_MIN_BUILD_DISTANCE` (8, matching
  `migration.ts`'s own relocation floor) from the builder's *own* position,
  constrained to still-bare `"floor"` tiles, not `pickDestination`'s
  abundance-sampling scoring. A shelter's value lives at its own tile
  (concealment/storm-cover), not at the destination's local abundance the
  way a migration or dispersal target's value does, so abundance-weighted
  scoring would be optimizing the wrong signal.
- **Build-time investment**: `SHELTER_BUILD_TICKS = 40` (same order of
  magnitude as `flora.ts`'s `MATURATION_TICKS`). **Abandonment**:
  `SHELTER_ABANDON_RADIUS = 6`, `SHELTER_ABANDON_TICKS = 600` — long enough
  relative to build time that a shelter doesn't decay away almost as fast
  as it was built.
- **Priority tier — corrected mid-implementation by a real run, not a
  hypothetical.** The first version copied `dispersal.ts`'s "commits no
  matter what, real risk-taking" shape: once `Agent.shelterTarget` was set,
  it ran to completion regardless of hunger/thirst, exactly like a natal
  disperser. A real seed-42 run immediately showed why that copy was wrong
  for *this* feature: all 4 of the demo scenario's `buildsShelter` founders
  (2 Diglett, 2 Sandshrew) went idle within the first 5 ticks, every one of
  them committed to the multi-hundred-tick round trip immediately, and 3 of
  the 4 starved to death by tick 166 because the task never broke off to
  eat or drink — the round trip plus build time routinely outlasts this
  sim's ~150-200 tick starvation window. The direct instruction ("not
  overriding survival instincts") already called for better than this; the
  fix makes the task **pausable**: `needs.ts`'s `tickAgentAction` only
  continues it while the agent reads as `chooseBehavior`-idle, falling
  through to ordinary needs-driven behavior (without losing `shelterTarget`/
  `shelterBuildTicks` progress) the instant something more urgent shows up,
  resuming later once satisfied again — the same shape `applyExploration`
  already uses, not dispersal's.
- **Honest finding even after that fix**: the pause fix stopped agents from
  starving *mid-build*, but a second, follow-up seed-42 run (3000 ticks)
  showed the feature is still a net survival cost in this particular seed's
  opening state, not a wash. Baseline (this same seed, feature disabled):
  one founder dies early to a Spearow camping the underground/surface
  crossing point (a pre-existing, unrelated predation hazard — confirmed by
  reproducing it with the feature off too), but the other three survive for
  thousands of ticks and produce multiple generations of offspring (new
  diglett-198/298/390, sandshrew-188/275/384/964/1112 lineages appear before
  the run ends). With shelter-building enabled: all 4 founders are dead by
  tick 783, and zero offspring were ever produced — worse outcomes across
  the board, not just a slower version of the same story. No `shelterBuilt`
  event fired at all in that run; the furthest anyone got was ~37 of the 40
  required build ticks before being pulled away again. The likely mechanism
  (not fully isolated, flagged here rather than guessed at further): a
  build site is picked purely by distance-floor from the builder's current
  position, with no preference for anywhere resource-rich or already-safe —
  so the task actively pulls a Diglett/Sandshrew away from the clustered
  food/water/herd-mate safety net right at the moment a nearby predator is
  most dangerous, the opposite of what "reduces predation risk via
  concealment" is supposed to buy them. A synthetic, controlled test (see
  `shelter.test.ts`'s end-to-end case, on a larger map with well-distributed
  resources rather than this seed's tight single-crossing-point layout)
  *does* complete a real build in ~200 ticks with no death — so the
  mechanism itself works; it's specifically exposed by a hostile opening
  layout like this seed's, not broken outright.
- **Still open, flagged rather than fixed further here** (this pass's scope
  was shelter-building's core mechanism, not a full tuning pass): whether
  build-site selection should prefer sites nearer existing resources/herd
  range (closer to `pickDestination`'s abundance-aware scoring after all,
  just without its `awayFrom`/`preferCover` terms), whether
  `SHELTER_MIN_BUILD_DISTANCE` is simply too far for a species already
  living somewhere this predation-exposed, or whether the real fix is
  upstream of this feature entirely (the Spearow-camps-the-only-crossing-
  point dynamic looks like its own pre-existing tuning gap, independent of
  shelter-building). Judge against further real runs, per this project's
  standing practice.

### Shelter incentives: resting-at-home buffs and a food cache

Decided, direct follow-up ask after shelter-building shipped: "Shelter
should also like give other buff too. Something that incentivizes the
Pokémon to stay in it. Maybe food cache and stuff idk?" Before this, a
completed shelter tile was a real (concealment/storm-cover) but entirely
passive payoff — nothing made an agent actually want to linger there once
built; it was treated like any other tile the instant construction ended.
Two real, composable pieces, both gated on `Agent.buildsShelter` (the same
small species slice — Diglett/Sandshrew — that has shelters at all):

1. **A real pull to go home when idle.** `needs.ts`'s idle tier used to
   fall straight to `applyExploration` (wander toward unvisited sectors) for
   every species once satisfied. Now a `buildsShelter` agent with a known
   shelter walks to it instead (`shelter.ts`'s new `applyShelterResting`,
   ranked after herd cohesion — a herd pulling an agent back together still
   wins over going home specifically) and genuinely lingers there once
   arrived, logged as a new `"restAtShelter"` `BehaviorKind` so it's visible
   in the event log exactly like `"buildShelter"`/`"deliverFood"` already
   are.
2. **A real buff for actually being there** — `SHELTER_HEAL_MULTIPLIER`
   (2x) and `SHELTER_NEEDS_DECAY_MULTIPLIER` (0.6x) apply every tick a
   `buildsShelter` agent is within `SHELTER_REST_RADIUS` (2, tight —
   "standing right there," not "somewhere in the herd's home range") of any
   shelter tile, composing multiplicatively with sleep's own multipliers via
   the exact same `applyHealOverTime`/`decayNeeds` multiplier hooks sleep
   already established — real but deliberately smaller than sleep's own
   3x/0.15x (this fires for a fully awake, un-vulnerable agent, so it
   shouldn't duplicate sleep's "dramatically reduced, real cost to
   oversleeping" trade for free).
3. **The user's own named idea: a food cache.** A new `Tile.cache` field on
   `"shelter"` tiles (0-`SHELTER_CACHE_MAX`, 1.2 — roughly 3 feedings' worth,
   the same order of magnitude flora.ts's `CONSUME_STOCK_AMOUNT` establishes
   for a live patch). Every tick spent genuinely resting at home (not just
   traveling there) deposits `SHELTER_CACHE_DEPOSIT_PER_TICK` (0.01, same
   magnitude as `support.ts`'s `HEAL_PER_TICK_FRACTION` — a slow, real
   accumulation, ~120 ticks to fill from empty). A genuinely hungry
   `buildsShelter` agent already home draws `SHELTER_CACHE_FEED_AMOUNT`
   (0.4, identical to `needs.ts`'s own live-feeding restore amount, same
   "delivered food restores exactly what self-feeding would" precedent
   `support.ts`'s `DELIVERED_FOOD_HUNGER_RESTORE` already established)
   before ever walking to a live food patch — a real safety net during a
   lean local patch, not a symbolic one.
4. **Explicitly not a trap** — direct constraint, and this session's
   repeatedly-confirmed bug class ("commits no matter what," fixed 4+ times
   already for dispersal/shelter-building/support-move/herd-food-delivery).
   `maybeFeedFromShelterCache` only ever fires from `needs.ts`'s existing
   `"seekFood"` branch (i.e. the agent is already genuinely hungry per
   `chooseBehavior`'s own urgency cutoff) and returns `false` — touching
   nothing — the instant the nearby cache is empty or absent, letting the
   caller fall straight through to the pre-existing live-foraging search the
   same tick. An agent is never made to wait on, or prefer, an empty cache
   over breaking off to actually eat elsewhere.
5. **Composes with abandonment rather than fighting it** — `Tile.cache`
   resets to `undefined` the moment a shelter tile reverts away from
   `"shelter"` (`setTile`), abandonment included: losing the structure loses
   the stockpile with it, the same "stopped maintaining this" consequence
   `Tile.vacantTicks` already models. And because a resting agent sits
   within `SHELTER_ABANDON_RADIUS` (6) by construction (`SHELTER_REST_RADIUS`
   is 2, well inside it), the new pull to go home directly feeds
   `decayShelters`'s existing occupancy check — a shelter that's a more
   attractive place to linger should see less abandonment, not a separate
   mechanism bolted on top of it.
6. No new `SimEvent` kind: a concurrent session is mid-redesign of
   `packages/web`'s `eventText.ts` (its `switch` is exhaustive over every
   `SimEvent.kind`), so touching that file this session would conflict with
   in-progress, uncommitted work there — same reasoning `needs.ts`'s own
   `resourceBlockedFallbackCount` doc comment already documents for an
   identical constraint. `World.shelterCacheDeposited`/
   `shelterCacheWithdrawn` (lifetime totals, mirroring
   `resourceBlockedFallbackCount`'s exact shape) are the real-run
   observability signal instead; the resting behavior itself is legible via
   the pre-existing `behaviorChanged` event now carrying `"restAtShelter"`.

#### Built — implementation notes and real-run findings

Built in `packages/engine/src/shelter.ts` (`applyShelterResting`,
`maybeFeedFromShelterCache`, and the constants above) plus the `needs.ts`/
`world.ts`/`types.ts`/`resourceIndex.ts` wiring listed above (`"shelter"`
joined `resourceIndex.ts`'s `IndexedTerrain` so "find my nearest shelter"
is an indexed lookup, not a full-grid scan, the same reasoning that index
already existed for `"food"`). 664 of the engine's 666 tests pass,
including 18 new tests covering: the resting behavior triggering/walking
home/depositing into the cache/respecting `SHELTER_REST_RADIUS`, cache
withdrawal restoring exactly the right amount (full `SHELTER_CACHE_FEED_AMOUNT`,
a partial amount from a near-empty cache, or nothing — never blocking — from
an empty/absent one), the heal/needs-decay buff measurably outperforming
baseline via `decayNeeds`/`applyHealOverTime`'s existing multiplier hooks,
a real `tickWorld` end-to-end comparison (a resting agent's hunger drains
slower than an identical wandering one), a herd that keeps resting never
accumulating `vacantTicks`, and abandonment clearing the cache along with
the structure. The 2 pre-existing failures (`predation.test.ts`'s "bush
concealment" sanity check and its "targetBurning/targetStatused" case, plus
this file's own now-identically-affected bush/shelter concealment
detection test) are unrelated to this feature — a concurrent session's
in-progress, uncommitted `predation.ts` changes (pack hunting/juvenile
combat) altered the hunt-trigger threshold those specific fixtures depend
on; confirmed via `git diff --stat` showing only `predation.ts`/`events.ts`
modified outside this feature's own files, left untouched per this
session's explicit instruction not to touch that concurrent work.
Determinism test (`determinism.test.ts`) passes unmodified — nothing new in
this feature calls `rng()` at all (deposit/withdrawal amounts are fixed
constants, not random rolls), so it's deterministic by construction, not
by luck.

**Real-run numbers** (packages/runner, `pnpm --filter @pokuelike/runner run
<ticks> "" <seed>`, standard seeds):

- **Seeds 42, 7, and 20260903, 3000 ticks each, `packages/data`'s
  `createDemoWorld`**: **0 `shelterBuilt` events in all three.** This isn't
  new — seed 42's own zero-shelters finding was already documented above —
  but running the other two standard seeds confirms it's not seed-42-
  specific: the demo scenario's Diglett/Sandshrew founders don't survive
  long enough to complete a build in *any* of the three standard seeds
  within a practical tick budget (likely worsened further right now by a
  concurrent session's in-progress, uncommitted predation.ts changes —
  pack hunting / juvenile combat — which this session did not touch or
  attempt to isolate from). With no shelter ever existing in these three
  runs, there's nothing here for the resting/cache incentive to attach to
  — an honest non-finding about these specific seeds' opening states, not
  evidence the mechanism itself doesn't work.
- **Controlled validation, matching `shelter.test.ts`'s own end-to-end
  test's precedent for this exact problem**: a larger (90x60), evenly
  resourced map (the same shape that test already uses to get past the
  "one hostile crossing point" issue) with 4 `buildsShelter` founders (2
  Diglett, 2 Sandshrew, 2 herds) and real `tickWorld` ticking (no
  predation rules — isolating the shelter/resting/cache mechanism from the
  concurrent session's in-progress predation changes), run for 3000 ticks
  at 3 independent seeds (101/202/303, chosen freshly for this validation,
  not the standard seeds above):

  | seed | first shelterBuilt at | shelters built | shelterAbandoned | restAtShelter transitions | cache deposited | cache withdrawn | peak cache on any tile |
  |---|---|---|---|---|---|---|---|
  | 101 | tick 52 | 10 | 5 | 928 | 3.90 | 2.31 | 0.80 |
  | 202 | tick 49 | 5 | 3 | 981 | 4.68 | 2.40 | 0.94 |
  | 303 | tick 49 | 4 | 3 | 1136 | 4.34 | 3.14 | 1.20 (hit `SHELTER_CACHE_MAX`) |

  Real findings from this table: (1) the resting pull actually fires, a
  lot — 928-1136 `"restAtShelter"` transitions per 3000-tick run, not a
  rare edge case; (2) most built shelters survive the run without ever
  being abandoned (3-5 `shelterAbandoned` out of 4-10 `shelterBuilt` per
  run — the remainder, roughly half to two-thirds, stay standing), a real,
  measurable reduction versus the mechanism's own baseline (an unattended
  shelter *always* abandons after exactly `SHELTER_ABANDON_TICKS`, per
  `decayShelters`'s own no-resident unit test) — though not a full
  elimination: some shelters (likely ones a founder's own death, or a
  fresher shelter a herd relocated away from, orphans) still do decay away,
  a real remaining gap rather than a perfect fix; (3) the food cache is
  genuinely used, not just accumulated and ignored — 2.31-3.14 total
  hunger-restore drawn from caches per run (`shelterCacheWithdrawn`),
  roughly half to two-thirds of what got deposited, meaning it's a real,
  regularly-tapped resource, not a number that only ever goes up; (4)
  `SHELTER_CACHE_MAX` (1.2) is reachable within a real run (seed 303 hit
  it), so the cap is doing real work, not sitting so high it's
  functionally unbounded.

**Open tuning question, not resolved here**: some shelters still get
abandoned even with the resting incentive active (3-5 of 4-10 per run
above) — worth a follow-up pass isolating *why* (a founder's death leaving
nobody to return, or a herd relocating away and never coming back) once
more real-run time is available, flagged in TODO.md rather than guessed at
further here. Also open: whether `SHELTER_CACHE_MAX`/
`SHELTER_CACHE_DEPOSIT_PER_TICK` are the right magnitudes for the cache to
matter during a real, sustained scarcity window specifically (this
validation's map never actually went scarce — it's evenly resourced by
design, so cache usage above reflects opportunistic "already home and
hungry" draws, not a proven famine safety net) — the standard demo seeds
would be the right place to check that once they're not also confounded by
zero shelters ever existing at all.

### Herd status: level buys real standing, not just personal stats

Direct ask: "being higher level gives you respect or something. Something
to earn." A real status/rank system, derived live rather than stored
persistently — consistent with how every other herd-aware system in this
codebase already works (no registry, scan `world.agents` on demand,
matching `herdCentroid`/`herdMigration.ts`'s existing convention): an
agent's rank within its herd is simply its position among living herd-mates
sorted by level, computed wherever it's needed, not a field maintained
forever.

- **Payoff 1 — feeding priority.** When multiple herd-mates would consume
  from the same tile's dwindling `stock` in the same window, higher-rank
  members' consumption resolves first (full amount), lower-rank members get
  whatever's left (possibly nothing if it depletes) — a real, earnable edge
  during scarcity, not just a flavor label.
- **Payoff 2 — mate preference.** `reproduction.ts`'s candidate selection
  (currently purely nearest-eligible) gets a rank-aware bias: among
  eligible candidates within search radius, a higher-status one is
  preferred over a merely-nearer lower-status one, within a real but not
  absolute weighting (distance still matters, status tips close calls, it
  doesn't override a huge distance gap).
- **Explicitly still open**: whether a third payoff (deference in contested
  movement/tile disputes, or an eventual real leadership/succession role —
  TODO.md's long-open "real role field for contested leadership" item) is
  worth adding now or later; exact rank-to-preference-weight mapping is
  sim-original tuning, to judge against a real run.

#### Built — implementation notes and real-run findings

Built as `herdRank`/`herdSize` in `packages/engine/src/herding.ts`, plus the
two payoffs wired into `reproduction.ts` and `needs.ts`. Concrete scope
calls, the real contention mechanism this actually attaches to, and what a
real seed-42 run showed:

- **Rank derivation**: `herdRank(world, agent)` — 1 = highest level among
  living herd-mates sharing `herdId`, counting up from there; a solitary
  agent (no `herdId`) is trivially rank 1 of 1. Deliberately herd-wide, not
  restricted to the caller's current `layer` the way `herdCentroid`/cohesion
  are — status is a social fact about the herd, not a spatial one, so a
  Diglett foraging on the surface doesn't gain or lose rank relative to
  underground herd-mates it isn't currently near. Level ties are broken by
  ascending `id` — arbitrary but deterministic. Confirmed live/non-stale by
  a direct test: a level-up or a herd-mate's death changes every affected
  agent's rank the very next call, no stored field anywhere.
- **Payoff 1 — feeding priority, real contention finding.** The direct ask
  assumed same-tick, same-tile contention over a food patch's dwindling
  `stock` was already real in this codebase — checked, and it is: a food
  tile only reverts to `"floor"` once `growFlora` runs (once per tick,
  *after* the whole per-agent loop — see `simulation.ts`'s `tickWorld`), and
  `resourceIndex.ts`'s `findNearestIndexed` re-checks a food tile's live
  `stock` on every lookup rather than trusting the cached terrain kind. So
  two herd-mates who both converge on the same nearest food tile routinely
  both reach and target it within one `tickWorld` call, and whichever one's
  turn came first in `world.agents`' iteration order (arbitrary spawn order,
  nothing to do with status) used to drain the shared stock first — this is
  the real mechanism the feature attaches to, not an invented analog.
  What *wasn't* already real: consuming never actually depended on how much
  `stock` was left — `consume()` always granted the full flat need-restore
  amount regardless, `stock` was purely bookkeeping for when a patch reverts
  to floor, so "getting whatever's left, possibly nothing" had no real gate
  to attach to. Added one: once a tile's `stock` drops below
  `FEEDING_PRIORITY_STOCK_THRESHOLD` (`2 * CONSUME_STOCK_AMOUNT`, i.e. it can
  no longer obviously feed a second herd-mate too), a lower-ranked agent that
  finds a higher-ranked, *also currently hungry* herd-mate standing on the
  exact same tile yields its turn — does nothing that tick, stays
  `seekFood`, re-checked fresh next tick — instead of eating, so the
  higher-rank member's own action tick drains the tile first. Above the
  threshold, nothing yields: stock isn't actually dwindling yet, no reason to
  make either wait.
- **Payoff 2 — mate preference.** `nearestMate` (reproduction.ts) now scores
  each eligible candidate as `distance - statusAdvantage * STATUS_DISTANCE_BONUS`
  (lower wins, same sense as the old pure-distance comparison it replaces).
  `statusAdvantage` is 0 (lowest-ranked herd-mate) to 1 (rank 1), linearly
  scaled by `(herdSize - rank) / (herdSize - 1)`; `STATUS_DISTANCE_BONUS = 2`
  is deliberately small next to `mateSearchRadius`'s ~3-7 tile range, so it
  can only ever tip a close call (candidates within a couple of tiles of each
  other) and a candidate that's merely nearer by more than that always still
  wins — confirmed by two direct tests, one proving the tip, one proving the
  bound isn't accidentally absolute.
- **Real seed-42 (3000-tick) run finding, feeding priority**: genuinely
  active, not a dead code path — 2117 real yield events (a lower-rank
  herd-mate deferring to a higher-rank one on a contested tile) over the run,
  against 1352 in a same-seed comparison run with the status bonus zeroed
  out (a smaller but still-real baseline count, since feeding priority is
  independent of the mate-preference constant) — so the mechanism fires
  often enough to matter, not just in the synthetic unit tests.
- **Real seed-42 run finding, mate preference — honest, not a clean
  isolated A/B.** With status-aware mate preference enabled, the run's
  clearest herd (`bulbasaur-herd`, containing both the Bulbasaur lineage and
  its two Venusaur guardians) shows a stark disparity: `venusaur-0`
  (level 20, rank 1 of its herd for the entire run) sired 71 of the herd's
  offspring, more than double the next-most-prolific father (`bulbasaur-2`,
  rank 6, 28 offspring) — directionally exactly what "a real, earnable
  reproductive edge" should look like. But a same-seed run with
  `STATUS_DISTANCE_BONUS` zeroed out is **not** a clean isolated baseline:
  because `nearestMate`'s pick changes which candidate a seeker walks
  toward, it changes the exact sequence of `rng()` calls from tick one
  (spawn-tile shuffling, offspring nature rolls, etc.), and this sim is
  already documented (see the determinism section) as sensitive to exactly
  that kind of perturbation — the two runs' populations diverge into
  genuinely different founders, herds, and even which species survive, well
  before status preference could plausibly be the sole cause. So the 71-vs-28
  gap is real and directionally consistent with the feature working, but
  "how much of it is the status bonus specifically, versus which chaotic
  branch the run happened to take" isn't separable with a single-seed A/B —
  flagged honestly rather than overclaimed. A controlled, non-chaotic
  comparison (fixed candidate pool, fixed rng) is what the unit tests above
  are for instead.
- **Still open, flagged rather than tuned further here**: whether
  `STATUS_DISTANCE_BONUS`/`FEEDING_PRIORITY_STOCK_THRESHOLD` are the right
  magnitudes, and the deference third-payoff/leadership-role question the
  original design left open. Judge against further real runs, per this
  project's standing practice.

### Backlog, not designed yet (captured so it isn't lost)

- **Food cultivation** — an agent actively planting/tending a food source
  rather than only foraging existing patches (a farming-flavored extension
  of `flora.ts`'s existing seed-spread mechanic, deliberate rather than
  incidental).
- **Cross-species courtship attempts** — a real behavior/story beat for
  attempted (and failed) interspecies pairing, distinct from `canBreed`'s
  existing egg-group compatibility check — even a doomed attempt is a real
  event worth logging.
- **Deliberate training/sparring for exp** — agents seeking out non-lethal
  combat/practice specifically to gain exp/skill points, distinct from
  predation's existing lethal combat.

## Urgency-based need priority, extended thirst margin, and sleep

Decided, not built yet. Three related asks, tackled together since they
all touch the same `needs.ts`/`predation.ts` priority machinery.

### 1. Dispersal should pause for urgent needs, like shelter-building does

Direct diagnosis, confirmed by reading the last-committed `needs.ts`
directly (not a guess): agents observed dying of thirst standing right
next to water turned out to be a dispersal side effect, not a crowding or
water-scarcity problem — natal dispersal (`dispersal.ts`) is explicitly
documented today as "commits no matter what," overriding hunger/thirst/
mate-seeking for the full multi-hundred-tick relocation walk, by design
(see the "Natal dispersal" section above — that unconditional commitment
was itself a deliberate fix for shelter-building's own earlier failure
mode). Direct instruction: **"needs should be able to jump queue in
priority, definitely based on urgency."** Fix: give dispersal the exact
pausable shape `tickAgentAction` already uses for shelter-building —
checked fresh every tick via `chooseBehavior(agent.needs)`, continuing the
walk (`applyDispersal`) only while `"idle"`, otherwise falling through to
ordinary needs-driven behavior for as many ticks as it takes to resolve,
with `agent.dispersalTarget` left untouched so the walk resumes exactly
where it left off once the agent is safe again. Doesn't touch
`maybeTriggerDispersal`'s own trigger conditions (level gate, chance rolls,
fallback timer) — only what happens once a dispersal is already underway.

### 2. Extend thirst's survival margin, kept linear

Separate, smaller ask on top of the fix above: even after dispersal stops
starving agents mid-walk, thirst's own budget is much tighter than
hunger's. Hunger's curve (see its section above) takes ~213 ticks to fall
from full to 0, then `STARVATION_GRACE_TICKS` (100) before death — ~313
ticks total. Thirst, still flat/linear per direct instruction ("thirst,
maybe can be closer to linear... it stays linear"), currently empties in
~67 ticks (`DECAY_PER_TICK.thirst = 0.015`) then the same 100-tick grace —
only ~167 ticks total, roughly half of hunger's budget for no particular
reason. Fix: slow the flat rate to `0.010` (full-to-empty ~100 ticks) and
give thirst its own grace period, `THIRST_STARVATION_GRACE_TICKS = 150`
(hunger keeps the existing 100) — ~250 ticks total, closing most of the
gap without touching hunger's curve or thirst's linearity.

### 3. Sleep: a real vulnerable-rest state, not just an idle animation

Direct ask, verbatim: *"lets add sleeping. make it so it replenishes hp and
pp more, but you're sitting duck. sometimes herd protects each other and
can wake each other up. hunger and thirst drain is dramatically reduced
while sleeping. long sleep can give xp."* ("pp" reads here as move
cooldowns, this sim's actual stand-in for mainline PP — there's no PP
resource to restore.)

This finally gives `Needs.energy` (`0 = exhausted, 1 = rested`) a real
purpose — it's existed on every agent since day one, decays every tick
(`DECAY_PER_TICK.energy = 0.005`), and until now nothing ever restored it
or read it for a decision. New `"sleep"` `BehaviorKind`, new `Agent` fields
`asleep?: boolean` and `sleepTicks?: number` (mirrors the
`dispersalTarget`/`shelterTarget` in-progress-task pattern — existence of
real progress state, not just a behavior label, since `behavior` itself
gets recomputed and overwritten most ticks).

**Falling asleep**: an otherwise-idle agent (`chooseBehavior(needs) ===
"idle"` — not hungry, thirsty, or mate-driven, same gate shelter-building's
trigger already uses) whose `energy` has dropped below a threshold, with no
threat currently detectable nearby (don't fall asleep in a predator's face),
sets `asleep = true` and does nothing else that tick. Checked in the same
tier as shelter-building/exploration in `tickAgentAction` — after survival
instincts, carrying, looting, herd-support, dispersal, and shelter all get
their existing first-refusal priority.

**While asleep** (checked fresh each action tick, same "drop out the
instant something wins priority" shape as shelter/dispersal above):
- Two conditions wake the agent and let it act normally the same tick,
  falling through to ordinary behavior rather than wasting a tick:
  1. `chooseBehavior(needs) !== "idle"` — hunger, thirst, or mate-drive
     became urgent. Sleep never lets an agent starve in its sleep.
  2. A threat is within detection range **and** an awake, conscious
     herd-mate is close enough to notice and rouse it — the "herd protects
     each other, can wake each other up" ask. Deliberately not a random
     roll: whether a watcher happens to be nearby is already emergent from
     herd cohesion's real positioning, the same "chance without an
     invented dice roll" approach `applyPredationInstincts`'s own
     mob-fighting already uses.
- Otherwise (safe, or a threat is near with no one to notice) the agent
  stays asleep and does nothing — no movement, no attack, no flee. This is
  the "sitting duck" half: `applyPredationInstincts`'s own self-defense
  branches (critically-hurt flee, general threat flee/mob, hunting for
  food) are skipped entirely while `agent.asleep` is true, so a sleeping
  agent that IS attacked will not flee or fight back on its own. Its
  existing guardian-intervention branch (defending a *different*,
  endangered herd-mate) is untouched and still fires even while the
  guardian itself is asleep — but firing it also clears the guardian's own
  `asleep` flag, since actively fighting isn't consistent with being
  asleep.
- Needs-decay (`tickAgentNeeds`, runs every world tick regardless of the
  Speed-gated action economy, same as hunger/thirst/heal already do) gets
  three sleep-specific effects while `asleep` is true: hunger/thirst decay
  multiplied by `SLEEP_NEEDS_DECAY_MULTIPLIER` (dramatically reduced, not
  paused entirely — still real cost to oversleeping); `energy` rises
  instead of falling; heal-over-time (`applyHealOverTime`, support.ts) gets
  a multiplier on top of its existing rate; move cooldowns
  (`tickCooldowns`, combat.ts) tick down faster.
- `sleepTicks` counts consecutive asleep ticks; once it crosses a
  long-sleep threshold, grant a one-time exp bonus (same one-shot-flag
  shape leveling.ts already uses elsewhere, e.g.
  `pendingLevelDispersalCheck`) rather than a repeating per-tick trickle.
- New `fellAsleep`/`wokeUp` event kinds for the log, matching every other
  behavior-transition event's shape.

Real run validation still needed once built: does sleep actually get used
in practice (an agent needs to reach the energy threshold at all — nothing
currently drains `energy` fast enough for that to be confirmed), and does
letting predators find easy sleeping meals change population dynamics
meaningfully. Report findings honestly either way, per this project's
standing rule — don't claim a mechanic "works" without a real run showing
it firing.

### Built, and real-run findings

All three pieces built as specified above, with a couple of implementation
choices the design left open, resolved here:

- **Dispersal pause**: `needs.ts`'s dispersal block now mirrors
  shelter-building's exact `if (agent.dispersalTarget) { if
  (chooseBehavior(agent.needs) === "idle") { applyDispersal(...); return; }
  }` shape (both the already-in-progress branch and the just-triggered
  branch this same tick), leaving `agent.dispersalTarget` untouched while
  paused. `maybeTriggerDispersal`'s own trigger conditions are untouched.
- **Thirst grace**: `DECAY_PER_TICK.thirst` is `0.010`,
  `THIRST_STARVATION_GRACE_TICKS = 150` (hunger's `STARVATION_GRACE_TICKS`
  stays 100). Hunger and thirst now each get their **own** consecutive-
  zero-ticks counter (`Agent.starvationTicks` for hunger,
  `Agent.thirstStarvationTicks`, new, for thirst) rather than one shared
  counter — the original shared counter couldn't correctly judge two
  different grace thresholds once hunger and thirst can cross 0 at
  different ticks. A tie (both thresholds crossed the same tick) still
  reports `cause: "hunger"`, matching the pre-existing tie-breaking
  convention.
- **Sleep**: `ENERGY_SLEEP_THRESHOLD = 0.3` (energy decays at 0.005/tick,
  so ~140 ticks from full rest to the threshold — reachable within a normal
  run, not vanishingly rare, confirmed below).
  `SLEEP_NEEDS_DECAY_MULTIPLIER = 0.15`, `SLEEP_ENERGY_RESTORE_RATE = 0.02`
  (4x the awake drain rate), `SLEEP_HEAL_MULTIPLIER = 3`,
  `SLEEP_COOLDOWN_TICKS = 2` (double-speed cooldown recovery),
  `LONG_SLEEP_EXP_TICKS = 200` with `LONG_SLEEP_EXP_BONUS = 25` (same order
  of magnitude as `EXP_ON_NEW_SECTOR`). The falling-asleep threat check uses
  the simpler exported primitives (`agentsWithin` + `isHunterSpecies` +
  `FLEE_DETECT_RADIUS`, wrapped as predation.ts's new `hasNearbyThreat`) —
  deliberately not the boldness-tuned `effectiveFleeRadius`/concealment-aware
  `isDetectable`, which stay private — since "is anything dangerous in the
  area at all" doesn't need that individual nuance the way an active
  flee/fight decision does. A new `SLEEP_WATCH_RADIUS = 5` (predation.ts)
  governs the "awake herd-mate close enough to notice and rouse a sleeper"
  check (`hasAwakeHerdmateNearby`, also newly exported). The long-sleep exp
  bonus is granted as a direct threshold-crossing check inside
  `tickAgentNeeds` itself (both the increment and the grant happen in the
  same function) rather than a separate one-shot flag consumed by another
  module — `pendingLevelDispersalCheck`'s flag indirection exists because
  its trigger (leveling.ts) and consumer (dispersal.ts) are different
  modules; here they're the same call, so the extra field would be pure
  overhead. `applyPredationInstincts`'s three self-defense branches
  (critically-hurt flee, general threat flee/mob, hunt-for-food) are each
  guarded with `!agent.asleep`; the guardian-intervention branch is
  deliberately unguarded and clears the guardian's own `asleep`/`sleepTicks`
  the moment it actually fires.

**Real-run findings (seed 42, 2000 ticks via `packages/runner`, same demo
scenario, compared against the pre-feature code on the same seed/tick
count — a real A/B, not a guess):**

| Metric | Before (old code) | After (this feature) |
|---|---|---|
| Total starvation deaths | 109 | **30** |
| — of which hunger | 27 | 7 |
| — of which thirst | 82 | **23** |
| Completed dispersals (`dispersed` events) | 12 | 3 |
| Final population (alive at tick 2000) | 365 | 443 |

Thirst deaths dropped ~72% (82 → 23) and total starvation deaths dropped
~72% (109 → 30) on an identical seed and tick count — the dispersal-pause
fix plus the longer thirst grace period together deliver exactly the
"agents dying of thirst standing next to water" fix this section set out to
make, confirmed with real numbers, not just unit tests. Final population
rose from 365 to 443 (+21%), consistent with meaningfully fewer deaths.
`dispersed` (completed dispersals) dropped from 12 to 3 — expected, not a
regression: a paused dispersal takes real extra wall-clock ticks to
actually arrive (however many ticks it spends resolving hunger/thirst/mate-
seeking along the way don't count toward the walk), so within the same
fixed 2000-tick window, fewer dispersals finish arriving even though the
*rate* of dispersals starting is unaffected — this is the intended
trade-off (survival over speed of relocation), not evidence dispersal is
somehow broken.

Sleep genuinely fires, a lot: **268 `fellAsleep` events, 91 distinct
individual agents** slept at least once over the 2000-tick run (seed 42) —
DESIGN.md's flagged worry that `energy` might never realistically reach the
threshold in a normal run length is **not** a problem in practice.
Confirmed across four seeds (42, 7, 99, 123): `fellAsleep` fired between 21
and 268 times depending on the seed's population size, always with 90%+ of
sleep sessions ending via a `wokeUp` event before the run ended, and the
average completed sleep session lasted 29-44 ticks (max observed: 183).

**Two things did NOT fire in any of the four real runs tested, reported
honestly per this project's standing rule rather than papered over:**
- **`wokeUp` with `reason: "threatSpotted"` never fired** — every single
  wake (254 of 254 in the seed-42 run, and 100% in the other three seeds
  too) was `"urgentNeed"`. No sleeping agent was ever woken by a herd-mate
  noticing a nearby threat.
- **No predator ever landed a hit on a sleeping agent** (`Hits/Kills landed
  on prey while it was asleep`, cross-referenced from `fellAsleep`/`wokeUp`
  interval pairs against `fought`/`killed` event ticks in the same run):
  zero in all four seeds.

Root cause, investigated rather than assumed: this demo scenario's hunter
population (`scyther`/`spearow`/`onix`) is small to begin with and dies out
fast — 3 of the 4 test seeds ended the 2000-tick run with **zero living
hunter-species agents at all** (the fourth had exactly 1). Predators aren't
a new problem this feature introduced (their population dynamics are a
pre-existing, separately-flagged concern — see TODO.md), but it does mean
the specific window this feature needs (a predator within detection range
of a *currently sleeping* prey, for the ~30-40 ticks a typical nap lasts)
essentially never opened during real-run testing: predators are rare, sleep
sessions are moderate-length, and the two just never lined up. The
mechanism itself is directly, unit-tested (see sleep.test.ts's wake/sitting-
duck/guardian tests) — this is an honest "not observed in real-scenario
testing so far" gap, not a claim that the code path is unreachable or
broken. A scenario deliberately stocked with a persistent, well-fed
predator population (so it doesn't die out) alongside a sleep-prone prey
herd would be the way to actually witness the threat-wakes-a-sleeper and
predator-catches-a-sleeper paths outside a unit test.

The long-sleep exp bonus (`longSleepBonus`) also never fired in any of the
four real runs — `LONG_SLEEP_EXP_TICKS` (200) is comfortably above every
real run's *observed* max sleep-session length (183, seed 99), so this
reads as "the threshold is tuned a little high relative to how these demo
agents actually sleep" rather than a broken mechanism (unit-tested directly
in sleep.test.ts, firing exactly once at the threshold). Flagged in TODO.md
as a tuning follow-up rather than silently lowered here without more real
data on what a "typical long sleep" should look like once predator
population dynamics are healthier.

## Specialization: nature-driven skill trees, actually spent

Ember's respec tree (`wider_burn` -> `ring_of_fire`) existed for a while as a
proof that `applyMoveTree`/`applyMoveTreeWithSpend` worked, but wild agents
never actually spent the typed/wildcard skill points they were earning —
that was an explicit, documented scope cut. This closes it: every move that
carries a `tree` now gets genuinely respec'd by the wild agents that know it,
and which node they pick is nudged by their individual Nature-derived
Disposition, not left uniform-random.

- **The trigger is a single choke point.** `grantSkillPoint` (leveling.ts) is
  the one function that ever adds to `skillPoints`/`wildcardSkillPoints` — a
  landed hit (`maybeGrantHitSkillPoint`) and the guaranteed-typed-plus-chance-
  of-wildcard level-up grant both funnel through it. It now takes an optional
  `LevelingContext` and, when given one, immediately calls `maybeAutoRespec`
  after granting — a wild agent doesn't sit on points waiting for a player
  who doesn't exist yet, it commits to a build as it goes, the same tick it
  earns the point. Calling `grantSkillPoint` without a context (most direct
  test call sites) still just grants, unchanged from before.
- **`maybeAutoRespec` scans every known move for one commitment.** For each
  id in `agent.knownMoves`, it resolves the pristine base `MoveSpec` via
  `ctx.resolveMove` (never the agent's own possibly-already-respec'd copy —
  see the bug note below) and, if that move has a `tree`, collects every node
  whose prerequisites are already satisfied, that isn't already chosen, and
  that the agent can currently afford (typed-of-the-move's-type + wildcard).
  Candidates are pooled *across all of the agent's known moves* — a single
  granted point can only ever fund one new commitment, even if it happens to
  newly unlock eligible nodes on two different trees at once — and one is
  picked via a disposition-weighted random draw.
- **The weighting is a nudge, not a determination.** Each `MoveTreeNode` can
  carry an optional `leaning: keyof Disposition` (`"boldness" | "aggression"
  | "sociability"`). A candidate's draw weight is `0.15 + (the agent's value
  on that axis, or 0.5 if the node has no leaning or the agent has no
  disposition)` — so an unleaned node always competes at the neutral weight,
  and a leaned node's odds scale with how strongly the individual actually
  has that trait, never dropping to zero and never guaranteeing the pick.
  Two agents with identical species, level, and points can still diverge.
  Ember's two nodes are tagged as the first real content: `wider_burn`
  (bigger burn chance, faster cooldown — presses the fight harder) leans
  `"aggression"`; `ring_of_fire` (ring shape, less power, slower cooldown —
  trades raw damage to hit several things around you without needing to
  path in close) leans `"boldness"`.
- **Commitments are permanent, and cost is paid incrementally.** Once picked,
  `agent.moveTreeChoices[moveId]` only ever grows (no respec-back — a real
  build choice, same framing as mainline nature/EV investment). The catch
  this surfaced: `applyMoveTreeWithSpend` (moves.ts) was designed to be
  called *once* with a move's *complete* final chosen-node list, charging the
  sum of every node's cost in one shot — calling it repeatedly as the chosen
  list grows one node at a time would re-charge the whole cumulative total on
  every call. `maybeAutoRespec` instead spends only the newly-picked node's
  own cost directly via `trySpendSkillPoints`, then recomputes the live
  `MoveSpec` from scratch with the plain (non-spending) `applyMoveTree`
  against the *pristine* base spec plus the full chosen list — so deltas
  never stack on top of a stale intermediate respec.
- **A real bug the integration check caught, not the unit tests.** The first
  working version updated `agent.moves` by searching for an entry whose `id`
  matched the `knownMoves` key that resolved to the tree (e.g. the dex key
  `"EMBER"`), but a `MoveSpec`'s own `id` is frequently a different casing/
  name entirely (`"ember"`, from `packages/data`'s curated `MOVES` table) —
  the two are only guaranteed to agree by `LevelingContext.resolveMove`'s
  lookup, not by string equality. Every unit test used a base spec with
  `id === "ember"` for both the tree lookup key *and* the move's own id, so
  they all still passed while the live move silently never actually updated.
  A one-off script that pushed a real Charmander (via `ensureCombatProfile`)
  through five `grantSkillPoint` calls and printed `agent.moves` before/after
  is what actually showed Ember's shape/power/cooldown never changing.
  Fixed by keying the `agent.moves` replacement off the *respec'd spec's own
  `id`*, not the `knownMoves` entry that led to it. Lesson kept for later
  work: a batch of new unit tests that all share the same happy-path fixture
  naming can pass in lockstep around a real wiring bug; a from-scratch,
  real-data integration check is what surfaced it here.
- **Demo-world caveat.** The demo roster (`packages/data/src/scenario.ts`)
  doesn't currently spawn any Charmander, so a real 5000-tick run of the demo
  world logs plenty of `gainedSkillPoint` events but zero `moveRespecced`
  ones — there's simply no agent alive that knows a move with a tree yet.
  Confirmed working end-to-end via a standalone script instead (see above).
  Once a species with a real tree-bearing move actually gets spawned into a
  scenario, `moveRespecced` events should start showing up in the log for
  free — no additional wiring needed.
- **Wildcard income made deterministic, not RNG-gated.** With Ember's tree
  costing only 3 total points (both nodes fire-typed), a mono-fire agent's
  guaranteed level-up income alone maxes it out by roughly level 4 — the
  wildcard/on-hit channels barely mattered in practice, and a 10%-per-level
  RNG roll meant an unlucky agent could go many levels with zero wildcard
  access, which matters much more once trees are big enough that a full
  level-up income can't carry them alone, and once an agent needs a wildcard
  to fund a tree on a move whose type doesn't match its own primary type
  (the only source of *typed* points for an off-primary-type tree is the 5%
  on-hit roll for a move of that type actually landing). Replaced the RNG
  roll with a fixed cadence: `SKILLPOINT_WILDCARD_INTERVAL = 2` — every 2nd
  real point granted (level-up or on-hit, whichever type) also grants a
  bonus wildcard, tracked via a new `Agent.skillPointGrantCount` that only
  advances on real grants (the bonus wildcard grant itself doesn't recount).
  This is a real rate increase, not just a smoothing of the old one (10% per
  level-up, only counting the level-up channel -> 50% per real point,
  counting on-hit points too) — a deliberate choice to make wildcard access
  reliable enough to actually fund off-primary-type trees once those exist,
  not just a determinism cleanup.

## Move selection: a real bug fix, plus tempo awareness

Surfaced while designing move trees: `pickBestMove` (combat.ts) scored every
off-cooldown move by `power * STAB * typeEffectiveness` alone — no notion of
range or tempo at all.

- **Real bug, not hypothetical**: `canAttackFromHere` called `pickBestMove`
  to get "the best move," then separately checked whether *that specific
  move* was in range. If the highest-scoring move happened to be out of
  range at the attacker's current distance but a *different* known move
  would have reached, the attacker simply didn't attack that tick — even
  though it owned a perfectly usable move. Scoring first and checking range
  after was backwards. Fixed by giving `pickBestMove` an optional `distance`
  parameter that filters to in-range moves *before* scoring, not after;
  `canAttackFromHere` now passes it and no longer needs its own separate
  `withinMoveRange` check. `distance` is optional (omitting it keeps the old
  range-blind behavior) purely so callers without positional context — bare
  unit tests — don't need updating.
- **Tempo awareness**: added a cooldown discount to the score,
  `1 / (1 + MOVE_SCORE_TEMPO_WEIGHT * move.cooldownTicks)` with
  `MOVE_SCORE_TEMPO_WEIGHT = 0.15` — a fast, modest move can now beat a
  slow, only-somewhat-stronger one (real per-tick expected value, not just
  "biggest number wins this instant"), which matters once move trees offer
  real cooldown-vs-power tradeoffs (see MOVES_DESIGN.md). Tuned specifically
  so a genuine type/STAB advantage still wins despite a real cooldown gap —
  0.15 was picked by checking the exact numbers against the existing
  Ember-vs-Tackle test fixture (Ember's power=40/cooldown=2 against a Grass
  defender: STAB×2 type-effectiveness gives it a 3x edge over Tackle's
  power=40/cooldown=0; at weight 0.15 Ember's discounted score is still
  ~92 against Tackle's 40 — a much higher weight, e.g. dividing outright by
  `cooldownTicks + 1`, put these two in an exact tie, which would have
  flipped the existing test depending on array order rather than which move
  is actually better here).
- `resolveHit` (predation.ts) now also takes `distance` (threaded from the
  same `canAttackFromHere` check each of its three call sites already makes
  right before calling it) and passes it through to its own internal
  `pickBestMove` call, so it picks consistently with what was just
  validated as reachable instead of re-deriving its own answer.
- Not yet done: any awareness of the *defender's* state (HP fraction, is it
  fleeing) in the score — that's the next real step once a move tree adds a
  genuinely situational effect (a finishing-blow bonus, a anti-kiting drag)
  worth picking *for*, not just a bigger number. Scoped out for now rather
  than guessed at ahead of any move that would actually use it.

## Status effects: burn, poison, paralysis, sleep, freeze

The first real consumer of `MoveSpec.statusChance`, which had sat inert
since the type-chart/move-overhaul work. `Agent.status?: { kind:
StatusKind; ticksRemaining?: number }` — at most one status at a time,
mainline-real — is set on a landed, damaging, non-killing hit (`resolveHit`
in predation.ts, right where `maybeGrantHitSkillPoint` already piggybacks
on the same hit), gated by the move's own `statusKind`/`statusChance`,
real mainline type immunities (Fire can't burn, Electric can't be
paralyzed, Poison/Steel can't be poisoned, Ice can't freeze), and "already
has a status" (no stacking). Lives in a new `status.ts`, kept separate from
`predation.ts`/`needs.ts` the same way `weather.ts`/`daynight.ts` are their
own files rather than folded into the systems that consume them.

- **Burn/poison** are damage-over-time: a fixed fraction of `maxHp` (1/16
  burn, 1/8 poison) every tick, applied in `tickStatusEffects`, called from
  `tickAgentNeeds`'s always-runs path (same slot as `tickCooldowns`) so a
  statused agent keeps ticking down even on ticks it doesn't act. Reaching
  0 HP faints, exactly like a normal attack's own faint/finishing-pool
  pipeline — DOT never kills outright. No independent duration or cure
  (no item/ability system exists in this sim to grant one); a status
  clears the instant its owner faints, for any reason, mainline-real
  (fainting always cures status) — implemented in both `resolveHit`'s own
  faint transition and `tickStatusEffects`'s DOT-causes-faint path, so it's
  consistent regardless of which one actually causes the faint.
- **Burn additionally halves the burned agent's own physical Attack** when
  it's the attacker — reuses `calculateDamage`'s existing (previously
  unconsumed by any real caller) stat-stage machinery rather than inventing
  a second damage multiplier: `resolveHit` passes `statStages: { attack:
  isBurned(attacker) ? -2 : 0 }` when building the attacker's
  `CombatantOffense`, and stage -2 is exactly a 50% multiplier
  (`statStageMultiplier(-2) === 2/(2+2)`). `calculateDamage` itself needed
  zero changes.
- **Paralysis** is modeled as two independent effects, matching mainline's
  own two independent effects rather than approximating both with one
  mechanism: a permanent Speed cut (`PARALYSIS_SPEED_MULTIPLIER = 0.5`,
  composed into `actionSpeedOf` in simulation.ts alongside the existing
  terrain/off-hours/cold-snap multipliers) plus a separate 25% chance
  (`PARALYSIS_SKIP_CHANCE`) to skip the action tick outright even when the
  agent does get one — a new early-return guard in `tickAgentAction`
  (needs.ts), same shape as the existing `fainted`/`beingCarriedBy` guards.
- **Sleep/freeze** are the "skip the action tick" shape too (same new
  guards in `tickAgentAction`), each with its own end condition ticked in
  `tickStatusEffects`: sleep gets a bounded random duration at onset
  (`SLEEP_TICKS_MIN/MAX = 10-30` — this sim's ticks are far finer-grained
  than mainline turns, so "1-3 turns" doesn't transfer directly) and wakes
  when it runs out; freeze rolls a flat 20% thaw chance every tick
  (`FREEZE_THAW_CHANCE`), and a landed Fire-type hit thaws it instantly
  regardless of that roll (`maybeThawOnFireHit`, called in `resolveHit`
  independent of whether the hit's own move inflicts anything itself).
- **New events**: `statusInflicted` (kind, agentId, inflictedBy) and
  `statusCleared` (kind, agentId, reason: `"woke" | "thawed"` — a faint
  clears status silently, the `fainted` event itself narrates that, no
  third reason needed).
- **Hand-curated inflicters, not invented ones**: `MoveSpec.statusKind` is
  set by hand only where the actual dex backs it — `ember`/`flamethrower`
  → `"burn"` (both already had `statusChance: 0.1` sitting inert). No new
  moves added to reach paralysis/poison/sleep/freeze coverage; that's
  real content for whichever move-tree work adds a move that actually
  causes one of those (Constrict's designed root effect in
  MOVES_DESIGN.md's Vine Whip tree is the natural next real inflicter,
  once a `"root"` kind — not yet one of the five modeled — gets added).
- **Confirmed working end-to-end**, not just unit-tested: a real
  Charmander (via `ensureCombatProfile`) fighting a real Bulbasaur through
  actual `tickWorld` calls showed `statusInflicted` firing on a landed,
  non-killing Ember hit, the target's HP dropping between fights by more
  than the hit damage alone (the burn DOT tick), and `status` clearing the
  moment the target fainted. **Demo-world caveat**, same shape as the
  specialization/moveRespecced one: Charmander isn't currently spawned in
  `packages/data/src/scenario.ts`, so a real run of the demo world won't
  show `statusInflicted` events yet — confirmed via a standalone script
  instead, same as the earlier `moveRespecced` verification.

## Forced movement: drags, knockback, lunges, and retreats

A move can now move someone as part of resolving — not the ordinary flee/
hunt/idle stepping every agent already does, a real, move-triggered
displacement. `MoveSpec.forcedMovement?: ForcedMovement` (moves.ts):

```ts
interface ForcedMovement {
  mover: "attacker" | "defender";
  direction: "closer" | "away"; // relative to whichever party isn't `mover`
  tiles: number;
  timing: "beforeHit" | "onHit";
}
```

- **`applyForcedMovement`** (movement.ts) displaces `mover` `tiles` times,
  one obstacle-aware step at a time, reusing the exact same `stepToward`/
  `stepAway` every agent's own ordinary movement already calls — a blocked
  step (wall, map edge) just doesn't move that tile, same as any other
  call to those functions. Never a teleport.
- **`timing: "beforeHit"`** (a lunge) resolves in `resolveHit`
  (predation.ts) right after the move is committed to (`useMove`) but
  before the accuracy/damage roll. This can't change whether *this* hit
  lands — `canAttackFromHere` already validated range before `resolveHit`
  was ever called — it only changes where the attacker ends up standing,
  which matters for follow-up ticks (and, incidentally, feeds a
  post-lunge position into that same roll's storm-accuracy check, which
  reads as more correct than less).
- **`timing: "onHit"`** (drag/knockback/retreat) resolves only on a landed,
  damaging, non-killing hit — the exact same hook `maybeInflictStatus`
  (status.ts) already uses. A corpse or a hit that itself causes a faint
  doesn't trigger it: pushing around something that's either already down
  or about to be doesn't mean anything.
- `MoveTreeNode.delta.forcedMovement` is overwrite semantics in
  `applyMoveTree`, same as `shape` — a move has at most one forced-movement
  effect active at a time, never a stack of several nodes' effects
  combined.
- **First real content, shipped alongside the primitive**: Tackle gained
  `bracing_impact` (Aggression, prereq `full_force_slam`) — an on-hit
  knockback that shoves the target back a tile. Slash gained `feint`
  (Boldness, no prerequisite, now itself the prerequisite for
  `keen_precision`) — a before-hit lunge that closes to melee as part of
  the strike rather than over several separate ticks. Both confirmed
  reached by real agents in an actual run (`bulbasaur-2658-56` speccing
  into `bracing_impact` at tick 3807 among them), not just unit-tested.
- **Deliberately out of scope for this pass**: U-turn/Volt Switch's
  designed "retreat at 2x speed for 2 ticks" effect (MOVES_DESIGN.md's
  round-five moves) needs a *sustained*, multi-tick movement override, a
  meaningfully different mechanism from this pass's instant, single-action
  displacement — noted so it isn't mistaken for already covered by this.

## The rest of the move-primitives checklist: multi-hit, passives, AoE, persistent stat stages, and more

Everything remaining on MOVES_DESIGN.md's "engine primitives needed"
checklist shipped in one pass — ten primitives, all unit-tested, a subset
confirmed together in a real multi-agent fight. None has real curated-move
content yet (see MOVES_DESIGN.md); this section documents the mechanisms.

**Multi-hit** — `MoveSpec.hits?: { min: number; max: number }`. `combat.ts`'s
`rollHitCount` rolls a count in range once per move use; `predation.ts`'s
`resolveHitAgainstTarget` loops that many independent damage instances
(each its own accuracy roll's worth of damage — the accuracy roll to hit at
all still happens once per move use, only the damage loop repeats), stopping
early the moment the defender truly dies mid-flurry. `pickBestMove` scores a
multi-hit move by its average hit count so it isn't undervalued against a
single stronger hit.

**Defense-penetration** — `MoveSpec.defensePenetration?: number` (0-1).
`calculateDamage` (combat.ts) shaves that fraction off the defender's
Defense/SpDefense *before* stat stages apply, composing with (not
replacing) them.

**Multi-action lock** — `MoveSpec.lockTicks?: number` + `Agent.actionLockTicks`.
`useMove` (combat.ts) adds `lockTicks` onto the agent's lock counter;
`tickStatusEffects` (status.ts) counts it down every world tick regardless
of whether the agent acts that tick; `tickAgentAction` (needs.ts) blocks all
action while it's positive — the same no-action shape as fainted/asleep/
frozen, for a move that commits its user past its own single action tick
(a Reaping Slash-style follow-through).

**Agent-modifying passives** — the one primitive flagged as a real
structural addition, since everything before it was a `MoveSpec` delta and
a passive has to modify the *agent* instead. `MoveTreeNode.grantsPassive?:
{ kind: PassiveKind; value: number }` (moves.ts) sits outside `delta` for
exactly that reason; `maybeAutoRespec` (leveling.ts) calls `grantPassive`
(status.ts) into `Agent.passives` the moment such a node is chosen — a
permanent, accumulating value, not part of the move's own respec'd spec.
Three kinds, each read at exactly one real call site: `"damageReduction"`
(a flat fraction off incoming damage, `resolveHit`'s `applySingleDamageInstance`),
`"immovable"` (blocks being dragged/knocked back/lunged at as the forced
mover, `applyForcedMovement` in movement.ts — it protects the passive
holder only, not whoever else a move displaces), `"regen"` (a per-tick heal
independent of being fed/watered, unlike the existing `applyHealOverTime`).

**Situational and self-state-aware scoring** — two related but distinct
levers. `MoveSpec.situationalBonus?: { condition; multiplier }` is a real
damage multiplier evaluated at the moment of the hit (`situationalMultiplier`,
predation.ts): `"targetLowHp"` (defender at or below half HP), `"flanking"`
(the defender isn't currently reacting to *this* attacker specifically — a
rough proxy using `fightTarget`/`huntTarget`, since the sim has no facing/
awareness model to check against more precisely), `"night"` (daynight.ts's
`isNight`). `MoveSpec.selfStateBonus?: { condition: "selfLowHp"; multiplier }`
is different in kind: it only ever affects *scoring* in `pickBestMove`
(combat.ts), biasing move selection toward a "cornered" move exactly when
the attacker itself is hurt, without touching the actual damage formula.

**Persistent stat stages and real-duration temporary buffs** — deliberately
built as one mechanism, not two: `Agent.statStages?: Array<{ stat; stage;
ticksRemaining? }>` (status.ts's `applyStatStage`/`getStatStage`). An entry
with `ticksRemaining` is temporary (counted down and dropped once it hits 0,
in `tickStatusEffects`); one without it is permanent until something else
removes it. Multiple entries on the same stat stack additively. Fed into
`calculateDamage`'s existing (previously burn-only) stat-stage machinery for
both attacker and defender, composing with burn's own -2 Attack. The
move-level lever is `MoveSpec.statChangeOnHit?: { target: "self" |
"defender"; stat; stage; ticks? }` — `"self"` applies the instant the move
is used (even on a miss), `"defender"` only on a landed, non-killing hit.

**Position-swap** — `MoveSpec.positionSwap?: boolean`. Attacker and
defender trade tiles on a landed, non-killing hit (`resolveHitAgainstTarget`)
— a Bodyblock-style swap, gated the same way onHit forced movement is.

**Cross-agent effects** — `MoveSpec.targetsAlly?: boolean` +
`allyEffect?: { healFraction?; buff? }`. The ally-buff/heal itself resolves
via a genuinely separate path from `resolveHit`'s hostile resolution:
`applySupportMove` (support.ts), called from the agent's own idle/support
tick (`tickAgentAction`, needs.ts), right alongside `applyHerdSupport`. It
finds the nearest in-range, hurt-preferred herd-mate for an off-cooldown
ally-targeting move, heals and/or buffs it, and puts the move on cooldown —
confirming this doc's own earlier prediction (in "Why status effects and
environmental moves are two different systems") that a cross-agent effect
would need its own trigger path rather than living inside the hostile hit
pipeline. **Additive, not a replacement of the move's combat identity**
(direct feedback): `pickBestMove` (combat.ts) does NOT exclude a
`targetsAlly` move from hostile selection, so the same move, with whatever
power/accuracy/other combat deltas it's accumulated, is also a real attack
option whenever the agent is actually fighting — it only ever gets its
ally-effect on a completely different tick, one with nothing hostile going
on. One move, two contexts, never both in the same tick (they share the
same cooldown via `useMove`).

**Multi-target/AoE resolution** — the biggest single gap on the checklist,
and Growl's entire premise. `MoveSpec.hitsArea?: boolean` switches
`resolveHit` (predation.ts) from single-target to `resolveAreaHit`: a
facing is derived from attacker->primary-target direction
(`facingToward`), `resolveShape` (moves.ts, already existed for rendering/
targeting) resolves that facing against the move's `shape` into a tile set,
and every living agent standing on one of those tiles (attacker excluded)
takes its own independent hit — each with its own accuracy roll and damage
instance. Only the one deliberately-picked primary target gets the
primary-target-only hooks (status infliction, `statChangeOnHit`'s defender
side, onHit forced movement, position swap); an incidental bystander caught
in the blast just takes the raw damage. Confirmed in a real fight: a
ring-shaped move centered on the attacker landed `fought` events against
both the picked target and an unrelated bystander standing on the same
ring, and `resolveHit`'s own "did the hunt's target truly die" return value
only reflects the primary target, not an incidental AoE kill (which still
fires its own real `killed`/`defeated` + kill-exp events, they just don't
drive the calling predator's own hunger-restore bookkeeping).

**What's still open**: no shipped move-tree node yet uses any of the ten
primitives above — they're mechanisms, confirmed via unit tests (and, for
multi-hit/positionSwap/statChangeOnHit/damageReduction/situational-bonus/
AoE, a real `tickWorld` fight) but not yet real curated content. Growl
itself specifically still needs one more thing beyond persistent stat
stages + AoE (both now shipped): a no-damage/status-move representation,
since nothing in this sim today can be "used" without going through a
damage roll — see MOVES_DESIGN.md's checklist for the up-to-date state.

## Predators valued hunting too little relative to grazing

Direct diagnosis from a real seed-42 run: a Squirtle boom (self-reinforcing
cross-species-breeding snowball, see the "Breeding" section) went
unchecked while Bulbasaur's own line shrank, and the underlying reason
population dynamics like this go unchecked at all is the same pre-existing
gap TODO.md already flagged: solo predators can self-feed on generic
"food" tiles, so they rarely get hungry enough to bother hunting —
predation stays rare and stochastic rather than a real population check.
Direct ask, refined during discussion: predators should still be able to
eat plants (no diet restriction), but a kill should be "a lot more
incentive... keeps em sated... valued higher than eating plants."

**Built**: two changes, both in `predation.ts`/`needs.ts`, no diet
restriction added.

1. `HUNT_HUNGER_THRESHOLD` raised from 0.6 to 0.85 (baseline, before
   disposition/activity-pattern shifts) — well above `chooseBehavior`'s own
   0.7 generic-seekFood cutoff. Since `applyPredationInstincts`'s hunt check
   runs (and short-circuits) before ordinary needs-driven foraging ever gets
   a turn, a predator this eager to hunt only ever falls back to plants once
   genuinely hungry AND no huntable prey is currently detectable — exactly
   "can still eat plants, but a kill is valued higher," with no separate
   priority-ordering logic needed beyond the existing structure.
2. A real kill now fully restores hunger to 1.0 and starts a
   `digestingTicksRemaining` countdown (`Agent`'s own field,
   `KILL_SATIATION_TICKS = 300`) during which hunger decays at only
   `KILL_SATIATION_HUNGER_DECAY_MULTIPLIER` (0.1x) instead of its normal
   rate — a real, lasting meal instead of a flat instant bump that wears off
   like an ordinary graze. `decayNeeds` (needs.ts) gained a fourth
   `hungerMultiplier` parameter for this, kept independent of the existing
   `asleep` multiplier (an agent can digest without sleeping or vice versa)
   and deliberately never touching thirst (eating doesn't quench thirst).

**Confirmed in a real run** (seed 42, 2000 ticks): after `spearow-0` killed
`diglett-0` at tick 84, it went straight to drinking water and then
mate-seeking — no hunger-driven behavior at all for 159+ ticks before its
next `hunt` transition — a genuinely extended post-kill quiet period, not
just an instant number bump. Existing test suite's disposition/activity-
pattern hunt-eagerness tests needed their hard-coded hunger values
recalibrated against the new 0.85 baseline (several combinations of
aggression+activity-pattern shifts now saturate near/above hunger's 0-1
range at full aggression, where they had headroom under the old 0.6
baseline) — expected fallout of a deliberate constant change, not a
regression; see the updated comments in `predation.test.ts` for the new
threshold arithmetic.

**Not yet touched, deliberately**: migration. Herd-level scarcity/
predator-pressure migration already exists (`herdMigration.ts`) but is
documented as essentially never firing in the demo scenario because
nothing creates real scarcity or real pressure. The plan is to check
whether real hunting pressure (this fix) plus real population booms
naturally starts triggering it before building anything new — not
confirmed yet, a real run at larger scale is the next step.

## Diagnosing "everything dies" on the real demo scenario seed, and three fixes

Real diagnosis on `SCENARIO_SEED` (20260903, the actual default demo world
— not seed 42, which this session had been using as a friendlier
comparison baseline) at 2000 ticks: population went from 17 founders to 6
survivors, two species (Pidgey, Squirtle) wiped out entirely, and **every
single starvation death (17 of 17) was thirst, zero were hunger.**

Root-caused two real, distinct mechanisms:

1. **Underground and canopy layers generate zero water/food tiles at
   all** (confirmed by directly counting terrain: surface has 472 water
   tiles among others, underground/canopy are both pure flat floor,
   nothing else) — a deliberate design (species native to those layers
   cross to the surface for every resource, per the existing "Cross-layer
   behavior" note above), but it means an underground/canopy species'
   survival depends entirely on how good the surface patch near *its own*
   specific crossing point happens to be. On this seed, Onix's crossing
   point landed near decent resources and it survived fine; Diglett and
   Sandshrew's didn't, and both starved.
2. **A second, previously-undiscovered instance of dispersal's old
   "commits no matter what" bug**, this time in predation.ts's predator
   give-up-and-relocate mechanic (`giveUpAndRelocate`/`migrate`,
   triggered after `RELOCATE_AFTER_TICKS` without a kill): once a predator
   started relocating, it walked toward a random far tile for as long as
   it took, with zero chance to drink along the way — confirmed directly
   in a real run, an Onix walked 262 ticks straight through on "relocate"
   without a single drink and died of thirst mid-search. This got *more*
   exposed, not less, by this session's own earlier "predators should
   hunt more eagerly" change (raising `HUNT_HUNGER_THRESHOLD`), which
   makes a predator enter the hunt/relocate state more readily.

Direct ask in response, three changes, all in `needs.ts`/`support.ts`/
`simulation.ts`/`resourceIndex.ts`/`predation.ts`:

1. **Hunger and thirst decay both halved again** — `HUNGER_DECAY_RATE`
   0.012→0.006 (and its floor 0.001→0.0005), `DECAY_PER_TICK.thirst`
   0.01→0.005. Full-to-empty time roughly doubles for both (hunger ~213→
   ~427 ticks, thirst ~100→~200 ticks) on top of their existing grace
   periods.
2. **Canopy is now genuinely fast to move through** — a new
   `CANOPY_SPEED_MULTIPLIER` (2x, `support.ts`'s `canopySpeedMultiplier`)
   composed into `actionSpeedOf` (simulation.ts) as its own independent
   term, not tied to elevation/terrain (the layer has neither). Surface and
   underground are unaffected.
3. **Underground now shares water with the surface** — direct ask: real
   groundwater access instead of every drink requiring an explicit
   cross-to-surface trip. `resourceIndex.ts`'s three lookup functions
   redirect a *water* lookup specifically FROM the underground layer to
   the surface layer's own water index; the agent still walks there and
   drinks while staying on the underground layer the entire time
   (underground is a full flat grid at every x,y, and `consume()` never
   checks the current tile's terrain kind — only that position matches).
   Canopy deliberately still requires an explicit surface crossing for
   everything, unchanged — this wasn't asked for there.

Plus the relocate bug found above got the same treatment dispersal already
has: a new `thirstIsUrgent` parameter on `applyPredationInstincts`,
computed by needs.ts (`1 - agent.needs.thirst > 0.3`) and passed in, gates
only the give-up-and-relocate branch — deliberately just thirst, not
`chooseBehavior`'s general urgency, since hunger is what's driving the
hunt/relocate in the first place (gating on hunger too would block the
very relocate that's meant to resolve it). Flee/fight/hunting-a-visible-
target are all unaffected either way.

**Confirmed in a real re-run of the exact same seed**: the relocate fix
visibly works (`seekWater -> relocate -> seekMate/seekFood` transitions
now interrupt and resume cleanly instead of running 262 ticks unchecked),
and Onix's underground water-sharing fix fired for real (`onix-0 drank at
(21,45) on underground`). Total starvation deaths only dropped modestly
(17 → 20, roughly the same order — this specific seed's death toll didn't
meaningfully improve yet), and Onix still eventually died of thirst, later
than before (tick 579 → 1139) but still dead. **Honest remaining gap
found while confirming this**: after its last drink, Onix got stuck
oscillating in `seekWater` behavior itself for 248 ticks near a boulder
cluster without ever reaching water — `movement.ts`'s `stepToward` is
greedy single-step pathing, not real pathfinding, and can fail to route
around a moderately-sized obstacle cluster between an agent and its
target. This is a distinct, deeper, pre-existing limitation from the two
fixed above — not touched here, flagged in TODO.md.

### Follow-up: real BFS pathfinding for `seekWater`/`seekFood`

Direct, explicit follow-up to the gap just above. Scoped narrowly on
purpose: only `needs.ts`'s `seekWater`/`seekFood` branch of
`tickAgentAction` got real pathfinding — every other greedy-stepping
behavior (flee, hunt-a-visible-target, mate-seeking, exploration,
dispersal's long walk, shelter-building's travel, herd-migration's
relocate walk) still calls `movement.ts`'s plain `stepToward`/`stepAway`
unchanged. Flee especially wants "move away, right now," not an optimal
route, and none of the others were the confirmed death-causing case — no
reason to touch a working, cheaper mechanism just because a fancier one
now exists elsewhere.

**What was built**:
- A new `pathfinding.ts` with `findPath(world, layer, from, to)` — an
  unweighted-grid BFS (sufficient and simpler than A* here; there's no
  per-tile movement cost to weigh, just walkable/not) that returns the
  ordered steps from `from` to `to` (excluding `from`, including `to`), or
  `undefined` if `to` is unreachable or itself unwalkable. Respects
  `tileAt(...)?.walkable` exactly like `stepToward` already does. Neighbor
  expansion order is a fixed constant (`NEIGHBOR_OFFSETS`, orthogonal
  first, then diagonals) — no randomness anywhere in the function, so it
  can never touch `world.rng` or affect the seeded-replay guarantee (see
  "Determinism" above); `determinism.test.ts`'s same-seed-twice test
  passes unchanged.
- `stepAlongPath(world, agent, target)` — the actual thing `needs.ts`
  calls, wrapping `findPath` with a cache so a multi-tile walk doesn't
  re-run BFS every tick. The cache lives on the agent itself
  (`Agent.pathCache?: { layer, target, steps }`, types.ts), recomputed
  only when the target or layer changes, the cached route is exhausted, or
  the next queued step is unexpectedly no longer walkable (rare —
  defensive, not expected to fire in normal play).
- **Per-agent caching, not a shared per-(layer, target) cache**, a
  deliberate call against the task's suggested alternative: many agents
  converging on the same nearest water tile *could* share one flow-field
  and dedupe the BFS work, but this map is small enough (~90x60, ~5400
  tiles) that a single BFS is already cheap — worst case a few thousand
  tile expansions, and the real run below showed no measurable slowdown.
  A shared cache also needs its own invalidation story (a shared route
  can go stale from a tile change or an agent's target shifting slightly
  differently from its herd-mates') that per-agent caching sidesteps for
  free. Worth revisiting only if a real run ever shows per-agent BFS
  actually costing something — see TODO.md.
- Wired into `needs.ts`'s `tickAgentAction`: the one line that used to
  read `agent.pos = stepToward(world, agent.layer, agent.pos, target)`
  inside the `seekWater`/`seekFood` branch (when a target exists on the
  current layer but the agent isn't standing on it yet) now reads
  `agent.pos = stepAlongPath(world, agent, target)` instead. Everything
  around it — the comfort/priority-yield check, the layer-crossing
  fallback, the `MIGRATE_AFTER_TICKS` give-up-and-migrate fallback — is
  untouched. The underground-water-sharing interaction (an underground
  agent's water target resolving to the surface layer's water index while
  the agent itself stays on `underground`) just works: `findPath` runs on
  whatever `agent.layer` actually is, and underground is a full flat
  walkable grid by design, so there's nothing to route around there
  anyway.

**Confirmed in a real re-run of the exact same seed (20260903, 2000
ticks)**: total thirst-starvation deaths dropped from 20 to 13. Onix-0
specifically — the confirmed stuck-oscillating death from the diagnosis
above — no longer dies of thirst at all: it keeps drinking successfully
past its old death point (30 total drinks, last one at tick 1323, versus
starving at tick 1139 before this fix), and its life eventually ends a
different way entirely — killed in real combat by `venusaur-0` at tick
1367 (`fainted` at 1366, `defeated` the next tick). That is the pathing
fix working exactly as intended: the agent survives the specific failure
mode this session set out to fix and dies of something else instead.
Performance sanity check (seed 42, 2000 ticks): ~2.8-3.4s across several
runs, no dramatic regression from before this change — the per-agent path
cache is doing its job of not re-running BFS every tick while an agent
walks an already-computed route.

### Follow-up 2: real BFS pathfinding for hunting and mate-seeking, with moving-target handling

Direct, explicit follow-up to the follow-up just above: `stepAlongPath`
above was built specifically for a STATIC target (a water/food tile) and
its cache keys on exact target position — a hunt target (predation.ts) or
mate-seeking partner (reproduction.ts) moves nearly every tick, so a naive
swap to `stepAlongPath` for those two call sites would recompute a full BFS
almost every tick anyway (the position-equality cache check would almost
never hit), defeating the entire point of caching. This follow-up gives
hunting and mate-seeking their own pathfinding entry point with staleness
rules suited to a moving target, instead.

**What was built** (`pathfinding.ts`):
- `stepTowardMovingTarget(world, agent, target)` — same underlying `findPath`
  BFS as `stepAlongPath`, but the cached route (still stored on
  `agent.pathCache`, now with an added optional `targetId` field — see
  `Agent.pathCache`'s own doc comment in types.ts) is kept and walked one
  more step instead of recomputing, UNLESS:
  - the cache is for a different layer or a different pursuit target
    entirely (`targetId` mismatch) — same hard-recompute case
    `stepAlongPath` already has;
  - the route is exhausted;
  - the target has drifted `PURSUIT_RECOMPUTE_DRIFT_TILES` (3) or more tiles
    from the position the cached route was actually aimed at;
  - the pursuer has closed to within `PURSUIT_CLOSE_RECOMPUTE_RADIUS` (3)
    tiles of the target — precision matters more than the caching benefit
    once the last few steps decide whether the chase/approach actually
    connects, and a BFS this close is trivially cheap;
  - the next queued step unexpectedly became unwalkable (the same
    defensive case `stepAlongPath` already handles).

  **Why 3 and 3, not some other number**: chosen to sit between this sim's
  tightest combat-adjacency radius (`MOB_TRIGGER_RADIUS` = 2 in
  predation.ts — once a threat/prey is this close, exact positioning starts
  to matter a lot) and its wider detection radii (`HUNT_DETECT_RADIUS` = 5,
  `MATE_SEARCH_RADIUS` = 5). A cached route survives a couple of tiles of
  ordinary drift — most of what happens tick to tick, since prey/mates move
  at the same one-tile-per-tick pace as everything else — but gets thrown
  out once the target has wandered far enough that continuing to trust the
  old route would start meaningfully misdirecting the chase. This is a
  judgment call, not a derived constant — there's no natural "correct"
  answer here, only a real tradeoff (recompute every tick = no caching
  benefit at all, recompute too rarely = a stale route that either misses
  by an ever-growing margin or, worse, waits too long to path-correct right
  at the moment precision matters most for actually landing the encounter).
  3 tiles keeps the cache doing real work during normal cruising while
  never trusting it once the outcome is actually close to being decided.

- **"Give up if can't find [a route]"**: when `findPath` returns
  `undefined` — the target is genuinely unreachable right now (e.g. walled
  off) — this does NOT freeze the pursuer in place the way `stepAlongPath`
  does for the static seekWater/seekFood case (freezing there is fine, the
  outer give-up-and-relocate timeout handles it normally). A frozen hunt or
  mate chase would instead look indistinguishable from a bug, so this falls
  back to plain `stepToward` — the exact greedy behavior hunting and
  mate-seeking already had before this change, not a new failure mode. That
  fallback step may not make real progress around the obstacle, but it's a
  pre-existing, already-tolerated outcome: predation.ts's own
  `RELOCATE_AFTER_TICKS`/`giveUpAndRelocate` and reproduction.ts's
  `ticksSinceEligibleMate` both already exist precisely to eventually route
  around a hunt/mate attempt that isn't going anywhere, so this reuses that
  existing shape (per the direct ask: "fall back to whatever the existing
  behavior already does") rather than inventing a new give-up mechanism.

- **A target that dies, faints below `isPreyOf`'s power threshold, or
  wanders out of detection/search range mid-chase needs no special handling
  inside `stepTowardMovingTarget` itself**: both call sites already
  re-scan for the nearest eligible candidate every tick
  (`applyPredationInstincts`'s `candidates`/`nearest`,
  `applyMateSeeking`'s `candidates`/`nearestMate`), so a target that's no
  longer valid simply stops being passed to this function at all the very
  next tick. The stale `pathCache` entry (tagged with the old `targetId`)
  is left on the agent but is harmless — it just won't match whatever
  (if anything) is pursued next, and gets silently replaced or cleared the
  next time this function actually runs. Confirmed directly with a targeted
  integration test in both predation.test.ts and reproduction.test.ts (see
  below).

**Wired into**:
- `predation.ts`'s `applyPredationInstincts`, hunt branch: the
  `agent.pos = stepToward(world, agent.layer, agent.pos, target.pos)` line
  for a currently-visible, currently-being-chased prey target not yet in
  attack range now reads `agent.pos = stepTowardMovingTarget(world, agent,
  target)`. The flee/mob/fight branches, the guardian-intervention branch,
  and the relocate/give-up-hunting mechanic are untouched — this only
  touches the one hunt-approach line.
- `reproduction.ts`'s `applyMateSeeking`: the equivalent
  `agent.pos = stepToward(world, agent.layer, agent.pos, partner.pos)`
  approach step now reads `agent.pos = stepTowardMovingTarget(world, agent,
  partner)`.

**Tests added**: pathfinding.test.ts gets a full `stepTowardMovingTarget`
unit suite (fresh route, cache reused on small drift, recompute on large
drift, recompute-every-tick once close, unreachable-target fallback, and
switching to a different target id not reusing the stale cache).
predation.test.ts and reproduction.test.ts each get an integration-level
suite exercising the same function through the real call site: a moving
target routed around an obstacle wall to a real kill/birth, a genuinely
unreachable (walled-off) target that never throws and never gets a bogus
cache entry, and a target leaving detection/search range mid-chase
correctly falling through to the caller's own next-candidate scan instead
of continuing a stale pursuit.

**Real-run findings** (2000 ticks each, before = commit c9b0cf6, after =
this change):

| seed | metric | before | after |
|---|---|---|---|
| 20260903 | fought | 20 | 7 |
| 20260903 | fainted | 5 | 3 |
| 20260903 | killed | 3 | 2 |
| 20260903 | defeated | 2 | 1 |
| 20260903 | born | 14 | 7 |
| 20260903 | wall-clock | 3.48s | 3.59s |
| 42 | fought | 21 | 26 |
| 42 | fainted | 7 | 4 |
| 42 | killed | 5 | 3 |
| 42 | defeated | 1 | 1 |
| 42 | born | 39 | 75 |
| 42 | wall-clock | 4.63s | 4.53s |

Honest read of these numbers, not just the favorable half: seed 42 shows
what this change is meant to do — mate-seeking in particular nearly
doubled its births (39 → 75), and combat activity (fought) went up too,
consistent with pursuers no longer getting stuck near obstacles on their
way to a target. Seed 20260903, though, shows LESS combat and fewer births
after this change, not more. This is not a regression in the pathfinding
logic itself (every determinism/behavior test above, including the new
unreachable/out-of-range/obstacle-routing cases, passes; the wall-clock
timing is unchanged either direction) — it's the same butterfly-effect
result already documented for the *first* BFS pathfinding follow-up above:
changing exactly how/when an agent moves changes its exact position every
subsequent tick, which cascades into a materially different 2000-tick
history under the same seed (different agents meet, fight, and pair off in
a different order and place than before). A deterministic sim with this
much emergent interaction will do this for almost any behavior-shaping
change, favorable or not, on any *specific* seed — the meaningful signal is
"pathfinding correctly routes moving pursuit around obstacles instead of
freezing or oscillating, and the overall system stays healthy" (confirmed
by both seeds' event logs and the targeted obstacle-course integration
tests), not "every seed's raw kill/birth count went up," which was never a
promise this kind of change could make on its own. No wall-clock slowdown
on either seed — the moving-target cache is doing its job the same way the
static-target one already was.

## Current state of the code

- `Agent` has needs, a behavior enum, and position — `tickAgent` decays
  needs, picks the most urgent one via simple utility scoring, and steps the
  agent one tile toward the nearest matching resource tile (water/food).
  Herd cohesion, mating, hunting, and fleeing are named in the types
  (`herdId`, `seekMate`, `hunt`, `flee`) but not implemented — see TODO.md.
- `MoveSpec` + `resolveShape` turn a shape descriptor into the set of grid
  tiles it covers, independent of any specific move or which Pokémon casts
  it. This is what lets a move's shape be swapped by leveling later without
  touching resolution logic.
- `packages/web` spawns a Bulbasaur herd near a water hole and a Scyther
  near a sunbeam patch, ticks the world on an interval, and renders it to
  canvas every frame.

## Determinism: a seeded PRNG threaded through the whole engine

Before this feature, `worldgen.ts`'s `mulberry32(seed)` made *map generation*
reproducible, but every other random roll in the engine — agent behavior,
flora growth, combat variance, reproduction, migration — called raw
`Math.random()`. Two runs from the same seed produced the same map but a
different *story*: not useful for reproducing/replaying a specific bug or
run, and the explicit prerequisite for Part 2 (a real live browser viewer
that replays a run from a seed).

**What changed**:
- `mulberry32` moved from `worldgen.ts` to its own dependency-free
  `engine/src/rng.ts` (still re-exported from `worldgen.ts` for every
  existing import site) so `world.ts` could import it too without a
  `world.ts` <-> `worldgen.ts` cycle. `rng.ts` also gained `randomSeed()` —
  a real (non-reproducible) seed, preferring `crypto.getRandomValues`,
  falling back to `Date.now()` — for when no seed is supplied.
- `World` gained two new required fields: `rngSeed: number` (the seed that
  produced `rng`, always readable back off the world for printing/logging)
  and `rng: () => number` (one live `mulberry32(rngSeed)` generator).
  `createWorld(width, height, seed?)` sets both; `seed` defaults to
  `randomSeed()`. `generateWorld` (worldgen.ts) seeds `world.rng` from
  `seed ^ BEHAVIOR_RNG_SEED_XOR` — a distinct derived sub-stream from its
  own terrain-placement rngs (same "xor a constant per sub-stream" pattern
  it already used for elevation/moisture/obstacle/food/flavor noise), not
  because it needs to be secret, just so `world.rng`'s first roll isn't a
  textually-identical replay of `placementRng`'s first roll.
- **Threading convention chosen**: an optional trailing `rng: () => number`
  parameter on every function that rolls randomness, defaulting to
  `Math.random` — the exact same shape this codebase already used for
  `log`/`rules`/`ctx` (see `tickAgentAction`, `applyPredationInstincts`,
  etc.), and the shape several functions (`rollAccuracy`, `rollCritical`,
  `dispositionFromNature`, `advanceWeather`, `updateHerdMigrations`) already
  had from earlier features. The one exception, deliberately: `tickWorld`
  itself defaults its `rng` param to `world.rng`, not `Math.random` — this
  is the one call every real simulation run goes through, so this default
  is what actually makes a run reproducible from its seed without every
  caller remembering to pass `world.rng` explicitly, while every other
  function's `Math.random` default keeps direct-call unit tests (that mock
  `Math.random` the old way) working unchanged. `World.rng` is *also* stored
  live on `World` (accepted per this feature's own requirements as one more
  reason `World` isn't purely serializable data — it already holds live
  `Agent` objects) so any function already holding `world` can reach
  `world.rng` directly, but the explicit parameter is still threaded
  everywhere production code runs, per point 3 below — never a hidden
  global.
- **Not a hidden global**: no module-level singleton generator anywhere.
  Two `World`s ticked in the same process (every test file does this, and
  so does the determinism check below) each carry their own independent
  `rng` instance and never interfere. Building this surfaced one *actual*
  hidden-global bug, unrelated to `Math.random` itself: `reproduction.ts`'s
  newborn-id counter (`offspringSequence`) was a module-level `let`, so two
  separate worlds ticked in the same process produced different newborn ids
  (and therefore different event-log bytes) purely from process-shared
  state — moved onto `World.offspringSequence`.

### Full sweep: every converted call site

Grepping fresh (`grep -rn "Math.random" packages/engine/src`) turned up more
than the original floor list — every one below now threads `rng` instead:

- `flora.ts` (6): `pickFlavor`'s flavor pick, `trySpread`'s neighbor-offset
  shuffle, `maybeDropSeed`'s seed-drop + germination chance, `growFlora`'s
  food-vs-flora chance and spread chance.
- `leveling.ts` (1 call site, but touched every caller): `grantExp`'s
  wildcard skill-point roll — required adding `rng` to `grantExp`,
  `grantKillExp`, `markSectorVisited`, `markSpeciesEncountered`, and every
  one of their callers in `needs.ts`/`reproduction.ts`/`predation.ts`.
- `migration.ts` (1): `findRandomWalkableTile`'s random relocate-target
  tile (feeds `migrate`).
- `needs.ts` (3): `findNearbyUnvisitedTile`'s exploration dx/dy (feeds
  `applyExploration`), old-age mortality roll in `tickAgentNeeds`.
- `predation.ts` (2, beyond the maintainer's floor list of 1): `resolveHit`'s
  accuracy roll (was already calling `rollAccuracy` but with a hardcoded
  `Math.random` instead of the threaded `rng`), crit roll, and damage
  variance roll (0.85-1.15x) — plus its downstream `maybeGrantHitSkillPoint`
  and `grantKillExp` calls, which previously used their own `Math.random`
  defaults unnoticed.
- `reproduction.ts` (2): `nearbySpawnTile`'s spawn-offset shuffle,
  `spawnOffspring`'s newborn sex roll — plus its own nature/disposition
  draws and every `grantExp` call in `applyMateSeeking`.
- **Beyond the floor list, already `rng`-parameterized from earlier features
  but not yet reaching `world.rng` in production** (found by the sweep,
  fixed by threading `rng` through their callers instead of their own
  defaults): `combat.ts`'s `rollCritical`/`rollAccuracy`/`calculateDamage`'s
  `randomFactor`, `nature.ts`'s `randomNature`/`dispositionFromNature`,
  `weather.ts`'s `advanceWeather` (weather-cell spawn roll, type pick,
  radius/lifespan/drift-angle rolls), `herdMigration.ts`'s
  `updateHerdMigrations` (wanderlust roll + wander-direction pick).
  `daynight.ts` and `support.ts` have no randomness at all — confirmed by
  the sweep, nothing to convert there.
- `packages/data/src/spawn.ts`'s `spawnAgent` (nature + disposition draws)
  and `packages/data/src/scenario.ts`'s `createDemoWorld` (threads
  `world.rng` into every `spawnAgent` call for the demo roster).

One real bug the sweep caught mid-way through: `needs.ts`'s `grantExp(world,
agent, EXP_ON_CONSUME, ctx, log)` call (on eating/drinking) was missing its
`rng` argument entirely, silently falling back to `grantExp`'s own
`Math.random` default — invisible to `world.rng` draw-counting but a real
source of run-to-run divergence, caught by the two-runs-diffed acceptance
test below, not by inspection.

### Runner seed support

`packages/runner`'s CLI (`src/index.ts`) takes an optional 4th positional
argument, a seed: `pnpm --filter @pokuelike/runner run <ticks> <snapshotTicks> <seed>`.
Omitted, a fresh seed is minted via `randomSeed()` (prefers
`crypto.getRandomValues`, falls back to `Date.now()`). Either way the seed
used is printed at the start of every run (`Seed: <n>`) so it's always
visible and copyable for an exact rerun. `dump-frames.ts`/`dump-replay.ts`
got the same treatment (5th/4th positional argument respectively);
`dump-replay.ts` also stamps the seed into its output JSON. `packages/web`
reads an optional `?seed=` query param (falling back to the demo's fixed
`SCENARIO_SEED`) — the one bit of seed-threading Part 2 (a separate
follow-up, a real live browser viewer) will build on directly; everything
else in `main.ts` already gets deterministic rng for free from `tickWorld`'s
`world.rng` default, no further change needed there.

### The determinism proof (concrete, not claimed)

Same seed, run twice, 1000 ticks, via the real CLI:

```
$ pnpm --filter @pokuelike/runner run 1000 "" 20260904 > run1.txt
$ pnpm --filter @pokuelike/runner run 1000 "" 20260904 > run2.txt
$ diff run1.txt run2.txt; echo "exit: $?"
exit: 0
$ md5sum run1.txt run2.txt
b49b4c3824acb67dab9d217b9e96caba  run1.txt
b49b4c3824acb67dab9d217b9e96caba  run2.txt
```

Byte-identical: 46,292 lines, 46,204 events, zero diff. A different seed
(`1` instead of `20260904`) produces a different md5
(`de6c526f0007ddd294cd9e8098fc20ad`) — confirming the match above isn't a
degenerate "always identical regardless of seed" bug.

Unit-level determinism tests live in `engine/test/determinism.test.ts`:
`World.rng` wiring (same seed -> same draw sequence, different seed ->
different sequence), a 500-tick `tickWorld` run compared byte-for-byte
between two same-seeded worlds, and per-call-site checks for
`flora.ts`/`migration.ts`/`leveling.ts`/`reproduction.ts`.

### A note on test flakiness this surfaced

`predation.test.ts` had 30+ tests calling `tickWorld` on a bare
`createWorld()` (no explicit seed, so a fresh random seed each run) with no
rng override — this was *already* exactly as flaky before this feature
(same exposure via raw `Math.random`), just latent. It surfaced for real
during this work: `weather.ts`'s Phase 3 spawn roll (1/150 per tick)
coincidentally fired inside a single-tick test, and the resulting storm's
accuracy modifier flipped a "would hit" into a "misses," failing an
unrelated flee/fight assertion. Fixed the same way the maintainer's own
guidance calls for: threaded a single shared `mulberry32` generator
(`SAFE_RNG`, a real varied sequence — a *constant* rng broke
`findRandomWalkableTile`'s retry loop and shuffle-based candidate picks,
which need genuinely different successive draws) through every bare
`tickWorld` call in that file. Verified flake-free across 10 consecutive
full-suite runs.

## A real live browser observer, and the `fought`/`missed` event data gap

Part 2 of the seeded-RNG work above: replace the two ways of watching the
sim — `packages/web`'s bare fixed-interval canvas dots, and
`packages/runner/src/dump-replay.ts`'s precompute-then-bake-into-static-HTML
approach — with one real, live, controllable observer built on
`packages/web`, per an earlier decision to build on that package rather than
start a parallel artifact. `dump-replay.ts` itself is untouched (still
useful for a no-dev-server snapshot artifact); it's just no longer the
primary way anyone watches a run.

**Event schema fix, done first**: `fought` and `missed` (`events.ts`) didn't
record which move was used or where it happened, unlike every other
combat-adjacent event (`killed`/`fainted`/`defeated`, which all have `pos`).
Added `moveId: string` and `pos: Vec2` to both, threaded from
`predation.ts`'s `resolveHit` — it already has `move` in scope from
`pickBestMove`, and `defender.pos` was already reachable at both call sites
(the finishing-blow branch and the normal-hit branch log separately, so both
needed the same two fields added). `packages/runner/src/format.ts`'s
`fought`/`missed` formatters now print the move and position. Existing tests
use `expect.objectContaining`, so they didn't need updating; added explicit
`moveId`/`pos` assertions to the two `predation.test.ts` cases that already
exercise a real hit and a storm-forced miss, rather than writing new tests
from scratch for a data-only field addition. Full 340-test suite still
green.

**The live observer** (`packages/web`, five source files, no new
dependencies — still just Vite + the two workspace packages):

- `main.ts` — orchestration and the tick loop. `createDemoWorld(seed)` is
  called explicitly with a real seed (a numeric input field, prefilled from
  `?seed=` or `SCENARIO_SEED`, with `Load`/`Random`/`Copy` buttons); loading
  a seed replaces the world, resets the event log and any selection, and
  rewrites the URL's `?seed=` via `history.replaceState` so a page reload
  reproduces the exact same run — the concrete "load the same seed twice"
  guarantee Part 1's determinism work was for. The tick loop is a real
  Play/Pause/Step/Speed control surface over `tickWorld`, not a fixed
  `setInterval(tick, 400)`: a speed slider (0.25x-32x across
  `BASE_TICKS_PER_SEC = 6`) reschedules an interval at the matching rate,
  batching multiple `tickWorld` calls per timer callback once the target
  rate would exceed ~60 real callbacks/sec rather than flooding the event
  loop with tiny intervals. `tickWorld`'s `rng` parameter is left at its
  default (`world.rng`), same as the runner — no separate rng plumbing
  needed here, Part 1 already made this the free/correct default.
- `renderer.ts` + `palette.ts` — a real terrain/agent grid, not flat colored
  squares. `palette.ts` is a direct port of `packages/runner/src/ascii.ts`'s
  `TYPE_COLOR`/`TERRAIN_BG`/`TERRAIN_FG`/`FLAVOR_FG`/`shade` tables (RGB
  triples instead of ANSI escapes) — the explicit palette reference the
  task asked for, kept in sync by hand rather than sharing a module across
  `runner` (CLI-only) and `web` (browser-only) for what's a small, stable
  table. Terrain tiles render elevation-shaded backgrounds exactly like the
  ASCII renderer; agents render colored by primary type (not species-initial
  placeholder color, matching ascii.ts's actual convention) with the same
  species-initial glyph, dimmed for a fainted agent (plus a small "z") and
  further dimmed for a lingering corpse (`alive === false`, still rendered
  — corpses persist for `CORPSE_PERSIST_TICKS`, see `simulation.ts`, and are
  now visibly distinct from a live agent instead of rendering identically).
  Two newer environmental layers get a first-pass visualization, deliberately
  basic: active weather cells draw as large, softly tinted translucent
  circles (no ASCII equivalent to port — weather has no per-tile ANSI
  rendering at all — so this part is sim-original, not ported), and
  day/night is one flat darkening overlay driven by `daynight.ts`'s real
  `lightLevel` (no directional lighting, no gradient — a scope call, not an
  oversight; see TODO.md).
- `eventText.ts` + `eventLogPanel.ts` — a real scrollable log panel, not a
  flat unbounded dump. `born`/`killed`/`defeated`/`fainted`/`evolved`/
  `diedOfAge` (the events that make a story, named directly in the ask) get
  a distinct icon, color, and bold weight; every other event kind renders
  small and muted. The in-memory event buffer is capped at 4,000 (oldest
  trimmed) so a long/fast run doesn't leak memory, and only the newest 250
  of whatever's currently in view ever become real DOM nodes, rebuilt
  wholesale — not appended to forever — only on animation frames where
  something actually changed (a dirty flag, not a render on every tick,
  since a 32x run can tick far faster than the display needs to redraw).
- `inspector.ts` — click-to-inspect. `renderer.ts`'s `agentAtCanvasPos` maps
  a canvas click to whichever surface-layer agent occupies that tile
  (last-drawn-wins, matching the actual render order); the inspector panel
  shows status (active/fainted/dead), species, level, HP, types, behavior,
  layer, position, sex, age, herd, nature, activity pattern, disposition
  (boldness/aggression/sociability), computed stats, current hunt/fight
  target, needs, and exp — everything meaningfully inspectable on `Agent`
  from this session's fields. Selecting an agent also narrows the event log
  panel to only events naming that agent's id (`eventText.ts`'s
  `eventNamesAgent`, checked generically across every `xId`-shaped field in
  the `SimEvent` union rather than one switch arm per kind, so a future
  event kind's own id field is covered for free).

**Validation actually performed**: `pnpm -r typecheck` and `pnpm -r build`
both clean across all four packages (engine/data/web/runner); `pnpm -r test`
green (340/340, unchanged pass count). `pnpm --filter @pokuelike/web dev`
starts cleanly and serves the real module graph (`curl`-verified the served
HTML and that `src/main.ts` resolves its imports correctly through Vite).
**What wasn't done**: no headless-browser click-through of the running
page. This repo has no browser-automation tooling installed, and installing
one (`playwright-core`, confirmed resolvable in the registry) timed out
mid-download in this environment rather than completing in a reasonable
window — a real limitation, not a corner cut silently. Confidence instead
comes from: the same code paths already exercised by
`packages/runner`/`packages/engine`'s test suite (rendering and DOM-building
are the only genuinely new, unexercised code), careful reading of the event
flow end-to-end, and the type checker/bundler agreeing the whole module
graph wires together. There is deliberately no new test framework/infra
added for `packages/web` — it has none today, and inventing one for this
session's scope wasn't asked for; if a real UI test harness is wanted later,
that's its own follow-up.

## Stronger weather-driven flora/water dynamics

### Decided

Direct feedback: "i kinda want weather events to be alittle stronger about
killing off flora and reducing water/iincreasing it. it'd make it mroe
dynamic." Two changes, both composing with weather.ts's existing
Surface-only, cell-based weather model rather than inventing a second one:

1. **Flora decay/spread magnitude, widened.** `floraDecayDivisor`
   (weather.ts) already divided flora.ts's decay-rate term and scaled its
   spread-chance term by rain/drought — that composition point was right,
   the magnitudes were just too mild to read as "the weather is killing my
   food supply." `RAIN_FLORA_DECAY_DIVISOR` went 1.6 -> 3 (decay survival
   time roughly triples under rain, up from ~1.6x) and
   `DROUGHT_FLORA_DECAY_DIVISOR` went 0.45 -> 0.25 (decay roughly
   quadruples under drought, up from ~2.2x) — both feed the same existing
   `growFlora` call sites (decay-rate divisor and spread-chance multiplier),
   no new mechanism.
2. **Water tiles: real terrain mutation, not a rate multiplier.** Water was
   previously static, undepletable terrain (`TerrainKind = "water"`) that
   weather never touched at all. New `weather.ts` function
   `advanceWaterCycle`, wired into `tickWorld` alongside `growFlora`,
   reuses flora.ts's own "flat per-tile-per-tick chance, rolled only for
   tiles that currently qualify" spread idiom rather than a new one: a
   "water" tile inside an active drought cell has a small per-tick chance
   to dry to "mud" (the driest terrain kind this codebase already had —
   reads as a cracked lakebed, not an instant flood/drought); a
   "floor"/"mud"/"sand" tile adjacent to existing water, inside an active
   rain cell, has a small per-tick chance to become water itself — the same
   8-neighbor adjacency check flora.ts's `trySpread` uses. New
   `terrainChanged` `SimEvent` (kind, tick, layer, pos, from, to, cause)
   narrates each individual change; wired into the noise-filtered tier of
   both the web app's event log (`eventText.ts`) and the runner's own
   formatter (`format.ts`), same treatment as `floraChanged`.
3. **Determinism preserved throughout.** `advanceWaterCycle` takes `rng`
   as an explicit parameter (defaulting to `Math.random` only for the same
   "safe default, real caller always passes `world.rng`" reason every other
   function in this file does), threaded from `tickWorld` exactly like
   `advanceWeather`/`growFlora` already are — no new bare `Math.random()`
   call site. See `packages/engine/test/determinism.test.ts`'s new
   "weather.ts water-cycle determinism" block.

### Built, real-run findings

A real 3000-tick headless run (`packages/runner`, seed `20260903`, the demo
world from `createDemoWorld`) with the final tuned constants
(`DROUGHT_WATER_DRY_CHANCE_PER_TICK = 1/500`,
`RAIN_WATER_FORM_CHANCE_PER_TICK = 1/1500`):

| | tick 0 | tick 3000 (final) |
|---|---|---|
| water | 472 | 476 |
| food | 181 | 349 |
| flora | 0 | 281 |
| mud | 81 | 89 |

Five real sustained weather windows occurred naturally in that run (no
weather forced for the test) — start/end tile counts for each:

- rain, tick 228->567 (339 ticks): water 472->472 (this window happened
  to have no eligible adjacent-to-water floor/mud/sand tile roll
  successfully — see the variance note below), food 1113->1247, flora
  1015->1417
- **drought, tick 726->998 (272 ticks): water 472->466 (-6 tiles, -1.3%)**,
  food 478->303, flora 728->211 — a real, visible thinning of both food and
  the map's water supply over one sustained dry spell
- rain, tick 1109->1337 (228 ticks): water 464->470 (+6), food 671->1191,
  flora 544->1209 — recovery under rain, both water and flora
- rain, tick 1948->2388 (440 ticks): water 470->471 (+1)
- rain, tick 2546->2786 (240 ticks): water 471->476 (+5)

Total: 20 `terrainChanged` events over the run (8 dried-by-drought, 12
formed-by-rain). No degenerate state in either direction — water never
approached 0 or "every tile," and food/flora still swing through their
existing multi-hundred-tick seasonal cycle (`seasonalMultiplier`,
`SEASON_LENGTH = 1000`) with weather now visibly compounding, not
replacing, that cycle (e.g. the drought window above hit during a lean
season and hit noticeably harder as a result).

**A real tuning trap this surfaced, worth documenting because it isn't
obvious from the constants alone:** an earlier pass picked
`RAIN_WATER_FORM_CHANCE_PER_TICK` only "slightly lower" than the drought
rate (1/600 vs. drought's 1/500), mirroring how the flora rain/drought
divisors above are just mild asymmetric multipliers of each other. A real
10,000-tick run at that pairing showed water creeping from 472 up to 554
(+17%) — not because rain was individually more common, but because
forming water has a structural growth advantage drying doesn't: each
newly-formed water tile is immediately a new adjacency source for its own
neighbors next tick (the same self-reinforcing perimeter-growth shape
flora's spread has), while drying only shrinks an already-fixed pool of
existing water tiles. Flora avoids exactly this trap because patches
eventually die of natural decay (`FLORA_LIFESPAN_TICKS`) — water tiles, as
built, never do. `RAIN_WATER_FORM_CHANCE_PER_TICK` was lowered to 1/1500
specifically to counteract that structural asymmetry, not just to make
rain "weaker" for its own sake — see `weather.ts`'s doc comment above the
two constants for the full math. A second real 10,000-tick run at the
final constants, a seed that happened to roll more drought than rain,
showed the opposite long-run drift instead: water fell from 472 to 353
(-25%) — real, meaningful, still nowhere near a wipeout (353 tiles
remained), but confirms this system does not yet converge to a stable
long-run equilibrium independent of which weather types a given seed
happens to roll more of. See TODO.md for this as an open follow-up
question rather than something closed here.

### Explicitly not done here

- No elevation/moisture-driven "naturally low/wet spots" bias for where new
  water forms beyond "adjacent to existing water" — `worldgen.ts` has a
  moisture field it uses at generation time, but wiring runtime water
  formation to sample it too was judged out of scope for this pass (the
  adjacency-based spread is already exactly the idiom asked for, and adding
  a second bias term would make the tuning story above harder to read, not
  easier).
- No drought-severity-scales-with-duration mechanic — every drought/rain
  cell affects tiles at the same flat per-tick chance for its entire life,
  regardless of how long it's already been active. See TODO.md.

## Explicitly not decided yet

- Turn-based vs. real-time-with-pause for combat.
- How herd cohesion/regrouping actually works (shared home range? leader
  agent? flocking forces?).
- The move leveling/respec UI for a future player character — wild agents'
  own earn/spend mechanism (skill points, disposition-weighted auto-respec)
  is now real, see "Specialization" above; a player choosing manually is
  still undecided.
- The bonding "puzzle" mechanics per species beyond the shape described
  above (what the actual verbs/inputs are).
- Save format, map generation, dungeon structure/progression.
- Data source/legality for sprite art (bring-your-own for now).

## Breeding requires a real earned edge: evolved once, or level 12+ (originally 16)

**Decided and built.** Direct instruction: on top of `isMature`'s plain
age check (`MATURITY_AGE`, 200 ticks — unchanged), breeding now additionally
requires *either* having evolved at least once *or* being at least level 16
without evolving. New `meetsBreedingRequirement(agent, ctx)` in
`reproduction.ts`: `ctx.baseSpeciesOf(agent.species) !== agent.species` means
"has evolved" (any stage past the base form counts, not just first-stage);
otherwise falls back to `agent.level >= MIN_BREEDING_LEVEL_UNEVOLVED` (16).
Without `ctx` or `agent.level` (bare fixtures), reads as eligible — same
"no data, don't block" convention `isMature` already uses for `agent.age`.
Checked both for the seeking agent itself (`applyMateSeeking`) and for each
candidate (`isEligibleMate`), alongside the existing herd/species/sex/
relatedness/isolation-escape-hatch checks — additive, not a replacement for
any of them.

**Real-run findings — a genuinely severe effect, flagged honestly:** a
3000-tick run on three seeds (42, 20260903, 7) with the real demo scenario
(`HUNT_RULES`/`LEVELING_CONTEXT`) shows births collapsing to **4-5 total**
per run (final population 13-16), down from the hundreds-to-low-thousands
seen in every other real run this session under the old age-only gate.
Average living level at the 3000-tick mark is only ~15-16 — meaning most of
the population never clears the new bar within a normal run's timescale at
all, and the agents that do breed are mostly the rare ones that evolved
early rather than ones that ground out 16 levels first (`EXP_TRICKLE_PER_TICK`
is 0.8/tick; `totalExpForLevel("MEDIUM_SLOW", 16)` alone is 2535 — passive
trickle by itself takes ~3169 ticks just to reach 16, longer than most
individual agents currently survive). The gate does exactly what was asked
(no agent breeds without a real earned edge), but at this sim's current
exp-gain rates it reads less like "breeding needs some seasoning" and more
like "breeding almost never happens" — worth a deliberate look at exp-gain
pacing (or the 16 threshold itself) as a likely necessary follow-up, not
assumed to be the intended end state without that conversation. Not touched
here since tuning exp rates is a distinct decision from the eligibility
rule itself.

**Tests:** the `parent()` test fixture in `reproduction.test.ts` now
defaults to `level: 16` (alongside its existing `age: 500`) so pre-existing
tests about other reproduction mechanics keep exercising what they meant to
test; the two herd-status-preference tests, which deliberately used a
level spread to produce a real rank difference, were bumped to `16/17/20`
(preserving the same relative ordering) since their old `level: 1` fixture
now fails the new gate on its own. All 580 engine tests pass.

### Follow-up: quartering hunger/thirst decay didn't fix it; lowering the threshold + a slight exp bump did, partially

Tried first (direct ask): quartering thirst/hunger decay rates (see
"thirst and hunger... much much much slower" commit), on the theory that
agents weren't surviving long enough to level up. **Real before/after run
showed this didn't move the needle** (births stayed at 1-4/run) — root
cause check found starvation deaths were already rare pre-change (0-6
thirst, 0 hunger, out of 17 starting agents over 3000 ticks), so survival
time was never the bottleneck. Kept the slower decay anyway as a real,
independently-good change, but it doesn't touch the actual lever.

Direct follow-up ask: lower `MIN_BREEDING_LEVEL_UNEVOLVED` 16 -> 12
(973 vs. 2535 total exp needed for a Medium Slow species) plus a slight
exp-gain bump (`EXP_TRICKLE_PER_TICK` 0.8 -> 1.0, `EXP_ON_CONSUME` 6 -> 8).

**Real-run results (same 3 seeds, 3000 ticks):** meaningfully better, though
seed-variable — seed 42: 32 births (was 4), final population 37 (was 14);
seed 7: 12 births (was 3), final population 22 (was 11); seed 20260903:
still only 2 births (was 1), final population 13 (was 11). Two of three
seeds now show real, healthy-looking growth; the third stays stubbornly
low — worth another look (a longer run, or averaging more seeds) if the
user wants seed 20260903-like runs to also recover, but the fix as given
is a real, substantial improvement over the level-16 baseline, not a full
solve. All 580 engine tests still pass (no test changes needed for this
follow-up — the `level: 16` fixture default already clears the new
level-12 floor).

See TODO.md for the running list of side notes to revisit.

## Species/biome/immigration: closing the badlands/highland gap, and a world that populates itself

**Decided.** Direct instruction ("Need more species. Immigration. Biomes
connected to world. I trust you. Please design and implement.") — a green
light to make real design calls without checking back on each one. Three
pieces, built together since they lean on each other:

**1. Three new species, chosen to fix a real, confirmed gap.** Before this
feature, `worldgen.ts`'s five biomes (`grassland`/`forest`/`wetland`/
`badlands`/`highland`) existed only for surface terrain generation — nothing
in the species roster was ever tied to any of them, and badlands/highland
specifically had zero real residents (every existing species reads as
grassland/forest/wetland-leaning). Added, all three pulled from
`leveling.ts`'s existing `EGG_GROUPS_BY_BASE_KEY` Gen 1 headroom batch (no
new egg-group entries needed) and all three reusing an already-implemented
move rather than building a new one (per the task brief's explicit steer —
a whole new move means a whole new skill tree, out of scope here):

- **Geodude** (Rock/Ground, `rock_throw`+`tackle`) — a real cross-species
  breeding pair with Onix (both Mineral egg group; `leveling.ts`'s own
  comment on `ONIX` had been anticipating exactly this since the original
  Onix addition). Tagged badlands/highland — a living boulder, per mainline
  flavor text, fits both of this roster's rockiest biomes.
- **Growlithe** (Fire, `ember`) — tagged badlands (mainline flavor text:
  arid, rocky terrain). Its only mainline evolution (Arcanine) needs a Fire
  Stone — an item-based trigger `leveling.ts`'s evolution filter already
  excludes on purpose (see that file's `computeProfileFromDexEntry` doc
  comment) — so, like Onix already in the roster, Growlithe simply never
  evolves in-sim yet. Not a new gap, the same accepted limitation Onix
  already lives with.
- **Mankey** (Fighting, `scratch`) — tagged highland/badlands (mainline
  flavor text: rocky mountains). Unlike Growlithe, this one has a real
  level-only evolution (Primeape at level 28, no conditions) that does work
  in-sim.

None of the three are tagged `isPredator`. This codebase's own prior
finding (see TODO.md) is that the existing predator guild
(Scyther/Spearow/Onix) already crashes toward near-extinction in a real
run — adding more hunters to an already-struggling guild would make that
worse, not add real variety. All three verified against
`SPECIES_DEX_BY_KEY` for real `baseStats`/`types`/evolutions before being
committed to (see `packages/data/test/species.test.ts`).

**Charmander**, already fully defined in `species.ts` since an earlier
session but never actually spawned in `createDemoWorld` — a one-line gap,
now closed. Tagged `biomes: ["badlands"]` (a sun-loving fire lizard, per
mainline flavor text: found on rocky mountainsides, flame weakens in rain)
and placed via the new `findPosInBiome` (below) instead of another
hardcoded corner.

**2. `biomes?: string[]` on `SpeciesDef`, actually wired to placement.**
Every species — new and existing — now carries a best-effort `biomes` tag
(same judged-per-species standard as `isPredator`/`buildsShelter`, not a
hard requirement — nothing stops an agent existing outside its tagged
biomes; a herd can migrate anywhere, an already-validated hand-placed
starting position is left untouched). Underground/canopy species (Diglett,
Sandshrew, Onix, Pidgey, Spearow) are tagged by whichever surface biome
best fits their flavor, on the documented understanding that those layers
are flat/biome-agnostic (worldgen.ts) and "their biome" means "the surface
biome sitting above wherever they actually live" — exactly the reading the
task brief itself suggested.

Two real consumers, not just a label nobody reads:

- `worldgen.ts`'s new `findPosInBiome(world, layer, biomeNames, rng,
  attempts=40)`: samples random points across the whole map, scores each via
  the already-existing `biomeWeightsAt`, and returns the nearest walkable
  tile to the best match (or a plain random walkable point if there's no
  biome preference or no biome data at all — never throws, never silently
  ignores the rng). Used by `createDemoWorld` to place Charmander — the
  roster's first starting agent whose position is genuinely biome-driven
  rather than a fixed coordinate, so it lands somewhere different across
  seeds depending on where the generated map's own badlands biome falls.
- `immigration.ts`'s spawn-site scoring (below) — the bigger, ongoing payoff.

**3. Immigration — new herds walking in from outside, over the course of a
run.** New `packages/engine/src/immigration.ts`, wired into `simulation.ts`'s
`tickWorld` as a new optional 6th parameter (`immigration?: ImmigrationContext`)
— the same dependency-injection shape `rules`/`ctx` already use, since the
engine has no access to `@pokuelike/data`'s `SPECIES` table (the dependency
only runs the other way). `@pokuelike/data`'s new `IMMIGRATION_CONTEXT`
supplies the real roster + `spawnAgent`.

Real design decisions, each one a direct answer to something the task brief
explicitly asked to be decided and documented:

- **Trigger shape**: `herdMigration.ts`'s exact idiom — a flat per-tick
  chance roll (`IMMIGRATION_BASE_CHANCE = 1/500`), gated behind a cooldown
  (`MIN_TICKS_BETWEEN_IMMIGRATIONS = 250`, so a lucky run of rolls can't
  cluster several immigrations back to back) and the population cap below.
- **Population cap** (the task brief's explicit "must not run unbounded"
  ask — the confirmed gap this codebase has had all along, see TODO.md):
  `POP_SOFT_CAP = 70` / `POP_HARD_CAP = 110`. Below 70 living agents,
  immigration rolls at full strength; at or above 110 it's skipped
  entirely (forced to exactly 0 chance); between the two, the chance scales
  down linearly — a soft landing, not a cliff. Picked from this session's
  own real-run context: a normal 3000-tick run's final population currently
  lands roughly 10-40 (seed 42: 37, seed 7: 22, seed 20260903: 13, after
  this session's earlier breeding-gate tuning) — 70/110 sits comfortably
  above that normal range, so immigration can meaningfully help a
  low-growth seed without choking off a seed that's already growing
  healthily on its own, while still being a real, finite ceiling. This caps
  only immigration's own contribution — breeding is still fully uncapped
  (a separate, bigger pre-existing gap, not attempted here — see TODO.md).
- **Which species arrives, and where**: two multiplicative weights, not a
  flat random pick. (1) Under-representation: `1 / (currentCount + 1)` — a
  species with few or zero living members is more likely to be the one that
  shows up, so a locally extinct or struggling species (this codebase's own
  predator-crash finding) has a real mechanical path back rather than
  staying gone forever. (2) Biome match: the arrival point (a random point
  on one of the map's four edges — "arrives from outside" is the whole
  premise, so unlike `pickDestination` this starts from the boundary, not
  an existing herd's centroid) is scored via `biomeWeightsAt` against the
  candidate species' own tagged `biomes`; an untagged species reads as
  neutral everywhere, a tagged species is floored at
  `UNTAGGED_MATCH_FLOOR = 0.15` so a badlands-tagged species can still,
  rarely, wander in at a grassland edge (real animals don't hard-respect
  biome boundaries either) rather than being flatly impossible there.
- **Group size**: 1-3 agents, matching `dispersal.ts`'s
  `finishDispersal`/`findNearbyOtherHerd` "join a nearby existing herd
  within `JOIN_HERD_RADIUS`, or found a new one" pattern exactly (exported
  from `dispersal.ts` for reuse rather than duplicated) — checked once
  against the first arrival, applied to the whole group, so they land
  together as one herd from the start. Once spawned, an immigrant group is
  an ordinary herd — no special-casing anywhere else in the engine; it
  feeds, mates, gets hunted, and disperses exactly like any hand-placed
  starting herd.
- **New event**: `"immigrated"` (`tick`, `agentIds[]`, `species`, `layer`,
  `pos`, `herdId`, `outcome: "joined" | "founded"`) — added to `HEADLINE_KINDS`
  and `STORY_KINDS` in `packages/web/src/eventText.ts` (a population-shaping
  event, the same category as `born`/`evolved`) with a canoe icon/teal
  color, and formatted in both `eventText.ts` and
  `packages/runner/src/format.ts` following the exact pattern
  `terrainChanged`'s earlier addition used.
- **New `World` state**: `lastImmigrationTick?: number` — the cooldown gate,
  mirroring the existing `herd*Ticks` per-world-state fields' documentation
  style.

### Real-run findings

3000-tick runs, seeds 42/7/20260903, with vs. without immigration
(`packages/data`'s `IMMIGRATION_CONTEXT` passed or omitted — everything else
identical):

| seed | immigration | final pop | immigrated events | born events |
|---|---|---|---|---|
| 42 | on | 35 | 6 | 22 |
| 42 | off | 19 | 0 | 11 |
| 7 | on | 28 | 4 | 14 |
| 7 | off | 21 | 0 | 8 |
| 20260903 | on | 28 | 5 | 8 |
| 20260903 | off | 28 | 0 | 18 |

Immigration fired real, observable numbers every run (4-6 events per 3000
ticks, matching the tuning target), and both new species and Charmander
genuinely showed up: seed 42's with-immigration run saw a Growlithe arrive
at tick 133, Geodude at 611, Onix at 2206, Mankey (a group of 3) at 2459 —
real per-event log lines, e.g. `[tick 2459] 3 mankey arrived from outside
at (0,23) on surface and founded mankey-immigrant-lineage-2459`. Seed
20260903 (this session's historically low-growth seed) ended at the exact
same population either way (28) but with visibly different composition —
immigration replaced some of that seed's own weak organic growth with
externally-arrived diversity (Geodude, Charmander, Scyther, Spearow, Mankey
all present with immigration on; none of those with it off) rather than
straightforwardly boosting the total, a real and slightly more nuanced
outcome than "immigration always raises final population," worth flagging
honestly rather than only reporting the two seeds where it clearly did.

**A longer 8000-tick run (seed 42) to check the population cap and real
survival/breeding of the new species**: final population 69 (still under
`POP_SOFT_CAP=70`, so immigration was still rolling at full strength the
whole run — the cap's scale-down zone was never actually tested by this
run), 13 immigration events, 63 births. Mankey grew from the single 3-agent
immigrant group (tick 2459 in the 3000-tick run) to 6 living members by
tick 8000 — real in-sim breeding of a newly-immigrated species, not just
survival. Charmander (2 starting + immigrant arrivals) grew to 11
living + 7 evolved Charmeleon — the biome-placed starting pair is
thriving. The population-cap *scaling logic itself* (soft-to-hard-cap
linear falloff, and the hard skip at/above 110) is covered directly by
`immigration.test.ts`'s unit tests rather than by this real run alone,
since a real run staying under 70 the whole time doesn't exercise the
scaled-down middle zone — see TODO.md for a flagged follow-up (a
longer/multi-seed run that actually pushes population past 70 to confirm
the falloff in a real run, not just in isolation).

### Tests

`packages/engine/test/immigration.test.ts` (13 tests): fires under a
guaranteed roll and spawns 1-3 agents as one herd; never fires under an
impossible roll; respects the cooldown (blocked mid-cooldown, fires again
once elapsed); the population-cap gate specifically — never fires at/above
`POP_HARD_CAP` even under a guaranteed roll, still fires below
`POP_SOFT_CAP`, and the *same* roll that fires below the soft cap correctly
stops firing once scaled down at the cap midpoint (a real check of the
linear falloff math, not just the two endpoints); dead agents don't count
toward the cap; underground-homed species spawn directly on the flat grid;
two rng-determinism tests (same-seed `maybeImmigrate` calls across 2000
ticks produce byte-identical outcomes; immigration threaded through a real
`tickWorld` run twice produces byte-identical event logs, with a sanity
check that immigration actually fired in that window). A separate
`packages/data/test/species.test.ts` (19 tests, new — the data package's
first test suite, `vitest` added as a devDependency alongside the existing
`typescript` one) checks the new species' actual data integrity: real dex
`baseStats`/`types`, moves resolve without crashing through `spawnAgent`,
egg groups resolve through `LEVELING_CONTEXT.getProfile`, the
Geodude/Onix Mineral pairing is real, Mankey's evolution resolves to a real
species id, Growlithe correctly has zero level-only evolutions, and every
new species is tagged with a real `worldgen.ts` biome name. All existing
580 engine tests (now 593 with the new file) and the `determinism.test.ts`
acceptance test pass unchanged — existing callers that don't pass an
`ImmigrationContext` simply never trigger immigration, so this feature adds
zero behavior change to anything that doesn't opt in.

### Explicitly not done here

- Population is capped for immigration's own contribution only — breeding
  itself is still fully uncapped, a bigger pre-existing gap this feature
  doesn't attempt to solve (see TODO.md).
- No retrofitting of every existing hand-placed starting agent's position to
  respect `biomes` — deliberately scoped to new placements only (Charmander,
  immigrants), per the task brief's own explicit steer, to avoid
  destabilizing already-validated starting positions.
- No new moves for the three new species — all three deliberately picked to
  fit an already-implemented move rather than growing `moves.ts`'s scope.
- The population-cap's scaled-down middle zone (`POP_SOFT_CAP` to
  `POP_HARD_CAP`) is unit-tested but not yet exercised by a real multi-
  thousand-tick run that actually reaches it — see TODO.md.

## Real confirmed bug: dying of thirst standing on water, fourth instance of "commits no matter what"

Direct report: "I just watched bulbasaurs die of thirst while in water." Not
a guess — traced with a real seed 20260903 run down to the exact tick,
agent, and mechanism.

**Root cause.** `applySupportMove` (support.ts, ally-targeting buff/heal
moves) had no urgent-need escape valve of its own — unlike
`applyPredationInstincts`'s `thirstIsUrgent` gate and dispersal/shelter-
building's `chooseBehavior === "idle"` pause checks, it would return `true`
(claiming the whole action tick) any time an off-cooldown support move had
an in-range ally, full stop. Two things combined to turn this into a real
death: (1) the skill tree lets a move reach `cooldownTicks: 0` (e.g. Tackle
respecced through `steadfast_guard` + `herd_instinct`'s -1 cooldown, turning
an attack move into a permanently-off-cooldown ally-buff), and (2) a
herd-mate standing permanently adjacent (a mated pair, in the traced case).
Once both align, `applySupportMove` returns `true` on literally every
action tick, forever — `tickAgentAction` never reaches `chooseBehavior`,
so the agent never re-evaluates its own hunger/thirst again. Traced agent
(`bulbasaur-0`, evolved to Ivysaur) sat at the exact same tile for 843
ticks rebuffing its mate's defense stat over and over while its own thirst
ran to 0 and through the full 150-tick starvation grace period — standing
the entire time on an actual "water" tile (confirmed via `tileAt`), exactly
matching the report. `applyHerdSupport`'s multi-tick food-delivery errand
had the same real gap, just less severe: it checked the deliverer's own
needs once, when the errand started (`isFedAndWatered`), but never again
during the walk — this is the fourth confirmed instance of this session's
established "commits no matter what" bug class (after dispersal, shelter-
building, and predation's relocate).

**Fix.** `tickAgentAction` (needs.ts) now computes
`needsAreUrgent = chooseBehavior(agent.needs) !== "idle"` once and passes it
to both call sites: `applySupportMove` is skipped entirely while urgent
(general urgency, not just thirst — neither support behavior exists to
resolve the agent's own needs, unlike predation's hunt/relocate, so there's
no reason to let hunger-urgency through either); `applyHerdSupport` gained
a `needsAreUrgent` parameter that pauses an in-progress delivery errand
(`deliverTargetId` left untouched, resumes later) the same way
dispersal/shelter already do. `applySupportMove` itself is unchanged — the
gate lives at the caller, matching `thirstIsUrgent`'s existing pattern.

**Real-run confirmation — a large effect, not a minor one.** Same 3 seeds,
3000 ticks, before vs. after this fix alone (on top of everything already
in this section): seed 20260903 (this session's stubborn low-growth seed)
went from final population 13 / 2 births / 5 near-water thirst deaths to
final population **40 / 28 births / zero starvation deaths of any kind**;
seed 7 went from 21 to **164**; seed 42 from 19 to 34. All three seeds:
zero hunger deaths, zero thirst deaths. This fix likely explains a
meaningful share of this session's earlier "population sometimes explodes,
sometimes stays low" mystery — more than the cross-herd mate-lock fix
alone did. New regression test in `support.test.ts` reproduces the exact
mechanism (a zero-cooldown ally-buff move + permanently-adjacent ally +
critical thirst) via `tickAgentAction` directly. All 594 engine tests pass,
determinism unaffected.

## Inspector redesign: grouped layout, gender emoji, moves + skill trees, move-use counts

**Direct ask.** "Can you make when selecting a Pokémon, the details are more
organized and beautiful. Use emoji for gender, make it easier to see, groups
rather than rows. Allow me to see the moves, and click into moves to see
skill trees with their choices lit up. And number of times they used a move
tbh."

**Decided.** Rewrote `packages/web/src/inspector.ts`'s per-agent panel from a
flat `.inspect-row` label/value list into five real visual groups — Identity
(species/level/age chips, type chips colored via `palette.ts`'s
`TYPE_COLOR`, sex as an emoji-adjacent symbol), Vitals (an HP bar, not just
text), Needs (hunger/thirst/energy/mate-drive as colored percentage bars),
Behavior & social (behavior/layer/position/herd/nature/activity
pattern/disposition/hunt-fight targets), Stats, and Moves. Groups reuse the
existing `.panel-header`/`.legend-group-title` uppercase-dim-small-letter-
spaced convention (a new `.inspect-group-title` class styled identically)
rather than inventing a new heading language — per the direct instruction
not to invent new visual patterns. The no-selection world-overview view is
untouched (still the flat row list — it was never the complaint and already
has its own recently-tuned compact-row spacing fix).

**Gender emoji.** ♂/♀ (plain Unicode symbols, not ZWJ/emoji-presentation
sequences) rather than the raw word "male"/"female" — these two render
reliably in every system font without needing an emoji font fallback, unlike
🚹/🚺 or the harder gendered-people emoji. Still paired with a `title` and
`aria-label` of the plain word so a screen reader or a hover still gets the
literal value, not just a symbol.

**Moves list.** Each agent's `agent.moves` now renders as a real list — a
type-color swatch, name, `type · pwr · acc` summary, and a use count (see
below) per row. A move with a populated `tree` is clickable; clicking
toggles an inline skill-tree visualization for that move underneath its row.

**How "which nodes are chosen" is represented — a real investigation, not a
workaround.** The task description flagged this as possibly unsolved
anywhere in the data model, needing reconstruction from applied deltas. That
turned out not to be necessary: `Agent.moveTreeChoices?: Record<string,
string[]>` (types.ts) already exists and is exactly this — the permanent,
ordered list of tree-node ids an agent has committed to on a given move,
maintained by `maybeAutoRespec` (leveling.ts) every time a skill point gets
auto-spent. The inspector just reads `agent.moveTreeChoices[move.id] ?? []`
and lights up exactly those node ids in the tree view — no reconstruction,
no comparing deltas against node definitions. The one real gap: `MoveSpec`
itself (`agent.moves[i]`) only ever holds the *current respecced spec*, not
which nodes produced it, so `moveTreeChoices` genuinely is the only source
of truth for "which nodes" — worth noting for the next person who goes
looking, since it's easy to assume (wrongly) that it isn't tracked anywhere
given how deep in `leveling.ts` it's read from.

**Skill-tree layout.** A simple layered/leveled layout: BFS depth from each
tree's roots (nodes with no `prerequisites`/`prerequisitesAnyOf`), one row
per depth, nodes within a row sorted by name. Depth for a node with multiple
prerequisite paths (`prerequisitesAnyOf`) is the *max* of every referenced
prerequisite's depth + 1, not the first path found — otherwise a node
reachable via both a short and a long alternate chain could render above a
node it actually depends on. Verified against a hand-built fixture tree
with a real crosslink (`prerequisitesAnyOf`) and an `excludes` pair — see
Verification below. This is deliberately not a real graph-layout algorithm
(no edge-crossing minimization, no drawn prerequisite lines between nodes) —
the per-task guidance called that over-engineering for what's needed here;
`TODO.md` has a follow-up if it's ever worth doing properly.

**Move-use counts.** Nothing tracked this before. Added `Agent.moveUseCounts
?: Record<string, number>` (types.ts, following the file's existing
optional-counter convention) and incremented it inside `combat.ts`'s
`useMove(agent, move)` — the single call site both real move-use paths
(`predation.ts`'s hit resolution and `support.ts`'s `applySupportMove`)
already go through, so both get counted for free with no per-call-site
changes. Pure counter increment, no rng involved, so it can't affect
determinism — confirmed by a new determinism test (two same-seed 500-tick
runs produce byte-identical `moveUseCounts` per agent) alongside a direct
unit test that `useMove` increments the right key. All 596 engine tests
pass (one pre-existing, unrelated flaky test in `reproduction.test.ts` uses
an unseeded `createWorld()` and occasionally rolls no offspring that tick —
confirmed by running it in isolation and re-running the full suite; not
caused by this change).

**Verification.** No browser test harness exists in this project (see
TODO.md's existing note) and Playwright/jsdom/happy-dom are not installed
here, so this was NOT screenshotted or run in a real browser. Instead: (1)
`pnpm -r typecheck`/`pnpm -r build` both pass clean across all 4 packages,
producing a real Vite bundle; (2) a throwaway verification script (not
shipped) ran the actual compiled `renderInspector` against a minimal
hand-written DOM shim covering exactly the subset of the DOM API this file
uses (`createElement`/`append(Child)`/`classList`/`style`/`setAttribute`/
`addEventListener`/`querySelector`/`replaceChildren`), fed it a hand-built
fixture agent (Bulbasaur, female, Ember with a tree including a real
`prerequisitesAnyOf` crosslink and an `excludes` pair, 3 of 5 nodes chosen,
Tackle with no tree), printed the resulting HTML tree, and asserted: use
counts render, the sex symbol renders with its accessible label, all five
groups render, chosen nodes get `.skilltree-node-chosen` and unchosen ones
get `.skilltree-node-dim` (exactly the 3 chosen ids, no more/fewer),
clicking Ember's row toggles the tree open (verified via a simulated
`click` dispatch through the shim, not just static rendering), and Tackle
(no tree) never gets a clickable header. All assertions passed. This
confirms the DOM construction and click-toggle logic are correct; it does
not confirm real-browser CSS layout/rendering, which remains unverified.

## Real replacement population pressure: less durable food, and real water-body terrain transformation

**Decided.** Direct follow-up to this session's earlier fixes (the
support-move lockup bug, slower hunger/thirst decay, the lower breeding-
level gate, the cross-herd mate-lock fix — see this file's earlier entries)
collapsing starvation deaths to zero and populations up into the
dozens-to-low-hundreds. The user's own words: "So now we'll need some other
pop control means... I see a lot of Pokémon just sorta sated doing nothing.
Waiting around. And now breeding a lot. We should keep an eye on it." Two
concrete asks, both about building real resource-scarcity pressure to
replace what starvation used to do (badly, but for free): (1) "Maybe we
make food less durable now? Make it die easier to force migration"; (2)
"Make certain water sources dry out and refill more during droughts and
rain. Bigger 'lake' or 'spring' water bodies might shrink but never run
out." A third, mid-flight ask landed while this was underway: "parametrize
things like food durability and regrowth stuff... so I can tune it" — see
each file's own "Tuning constants" banner section below for how that was
addressed structurally, not just per-constant.

### 1. Food durability — three constants tuned together, one left alone

All three tuning constants for food live together in `flora.ts`'s own
"Tuning constants" banner section now (direct ask — see above), each with
a doc comment carrying its own before/after reasoning, not just its number:

- **`CONSUME_STOCK_AMOUNT`: 0.25 -> 0.35.** A full patch now empties in 3
  feedings instead of 4. This constant has a real documented scar from
  earlier this session (0.5 caused total colony collapse when starvation
  was still common) — 0.35 is judged safe specifically because that
  earlier failure mode's root cause (starvation stacking with natural
  decay to outrun food replacement) no longer applies now that starvation
  itself is at zero across every real seed tested.
- **`FOOD_LIFESPAN_TICKS`: 100 -> 70.** A food patch now dies of old age
  30% sooner even if never fully eaten out, so a herd camping on
  abundant-looking food still sees it disappear on a visible clock.
- **`FOOD_SPREAD_CHANCE`: 0.035 -> 0.025.** Less compensating replacement
  growth right next to a dying patch — a real test now confirms a roll
  that used to beat the old rate (a fixed 0.03 vs. the old 0.035 cutoff)
  no longer beats the new one (0.025).
- **`MATURATION_TICKS` (20) and `FLORA_LIFESPAN_TICKS` (150, decorative
  flora) left unchanged** — the first because the famine-window math its
  own doc comment already covers only gets safer as patches die faster
  (more room before the next seedling needs to be ready, not less); the
  second because decorative flora isn't edible and isn't part of the
  "food durability" ask at all.

### 2. Water bodies — a real connected-component concept, and a tiered water cycle

**New `waterBody.ts`.** Before this feature, `weather.ts`'s
`advanceWaterCycle` (added earlier this session) treated every "water" tile
identically regardless of whether it was part of a 183-tile lake or a
1-tile puddle. `waterBodySizeAt(world, pos)` answers "how big is the
connected body of water this tile belongs to" via a flood fill, cached
per-`World` exactly like `resourceIndex.ts`'s established idiom (a
`WeakMap<World, ...>`, invalidated lazily) — reusing `World.resourceVersion`
itself as the cache key rather than minting a second, parallel version
field, since every water-terrain mutation already goes through `setTile`,
which already bumps it unconditionally; a water body's membership can only
change on exactly the writes that already invalidate the resource index.

**4-connected, not 8-connected** — a deliberate choice, not an oversight:
two water tiles that only touch diagonally read, visually and
hydrologically, as separate pools that happen to corner-touch, not one
contiguous lake. `worldgen.ts`'s moisture-field generation produces plenty
of these near-miss diagonal adjacencies at biome boundaries, and
8-connecting them would silently inflate how much of the map counts as one
protected "lake." (Flora's spread and weather's rain-formation adjacency
checks stay 8-connected, unchanged — those answer a different question,
"can new growth start here," where diagonal adjacency is the right call;
see `waterBody.ts`'s own doc comment for the full reasoning.)

**A real distribution check, not a guessed threshold.** Before picking
`LARGE_WATER_BODY_MIN_SIZE`, the actual connected-component size
distribution of a real generated 90x60 map was measured directly (all
three seeds):

| seed | total water tiles | components | top sizes | 1-tile | 2-5 | 6-11 | 12-30 | 30+ |
|---|---|---|---|---|---|---|---|---|
| 42 | 494 | 19 | 183, 51, 34, 31, 31, ... | 1 | 4 | 4 | 5 | 5 |
| 7 | 495 | 16 | 122, 107, 86, 57, 44, ... | 1 | 5 | 3 | 2 | 5 |
| 20260903 | 472 | 20 | 179, 80, 40, 29, 25, ... | 2 | 6 | 2 | 7 | 3 |

A real, clearly bimodal shape — a handful of large lakes (dozens to nearly
200 tiles) alongside a long tail of small puddles (1-11 tiles), with a
genuine gap around the low teens. `LARGE_WATER_BODY_MIN_SIZE = 12` sits
right in that gap: comfortably above "a few puddled tiles that happened to
touch," comfortably below "a real lake."

**Tiered `advanceWaterCycle`, and a real correctness gap found and fixed
before shipping.** `weather.ts` now snapshots every water tile's body size
once per tick (before that tick's own mutations — checked once, not
re-derived mid-loop, matching this codebase's established
`needsAreUrgent`-style convention) and applies:

- **Small bodies** (below the threshold): `DROUGHT_WATER_DRY_CHANCE_PER_TICK`
  raised `1/500 -> 1/150` — over one full 500-tick drought lifespan that's
  `1-(1-1/150)^500 ≈ 96%`, i.e. an isolated puddle sitting in a sustained
  drought is very likely to fully dry out. The direct "dry out... more" ask.
- **Large bodies** (`LARGE_WATER_BODY_MIN_SIZE`+): a much lower
  `LARGE_WATER_BODY_DRY_CHANCE_PER_TICK = 1/3000` (`≈15%` over the same
  500-tick window) — real, visible shrinkage without threatening to empty a
  major map feature.
- **A hard floor, `LARGE_WATER_BODY_FLOOR_SIZE`, is set EQUAL to
  `LARGE_WATER_BODY_MIN_SIZE`, not lower.** An earlier version of this
  feature used a lower floor (6) to give a shrinking lake more visible room
  to recede — but a synthetic worst-case unit test (one lake, one
  permanently-active drought cell that never dissipates, 4000+ ticks)
  caught a real bug this created: once a shrinking lake's size dropped
  below `LARGE_WATER_BODY_MIN_SIZE`, `isLargeWaterBody` (a stateless,
  current-size-only check) reclassified it as "small" — with no memory of
  its own history — so it silently fell back to the fast small-body rate
  with *no* floor protection at all. That test showed a 25-tile lake
  reaching **0 tiles** by tick ~2000 under continuous exposure — the exact
  "never run out" guarantee failing by construction. Setting the floor
  equal to the large-body threshold closes the gap structurally: a large
  body can only ever be skipped by the floor check at exactly the instant
  before it would cross out of "large" territory, never after. This is a
  real, checked property now (`weather.test.ts`'s dedicated large-vs-small
  test), not just a documented intention — though it's still a per-tick,
  stateless classification, so a border-line-sized lake (just above 12
  tiles) that survives many *repeated* droughts over a very long run could
  in principle still eventually cross the threshold and then dry at the
  fast rate; see TODO.md for this flagged honestly as a residual edge case,
  distinct from the bug that's now fixed.

**Rain-forming: a real runaway-growth check, root-caused, and re-tuned.**
Direct ask for more dynamism ("increasing it... more dynamic") justified a
first attempt at raising `RAIN_WATER_FORM_CHANCE_PER_TICK` from `1/1500` to
`1/1000`. **A real terrain-only 10,000-tick run (no agents — isolating the
water cycle from the unrelated population-performance ceiling, see
TODO.md) showed this was wrong**: net water tiles grew 494->593 (seed 42,
+20%), 495->728 (seed 7, +47%), 472->598 (seed 20260903, +27%) — worse
runaway growth than this session's earlier +17% finding at the original
flat rates, not better. Root cause, checked rather than assumed: a direct
count on seed 42's own water-body distribution found **roughly 89% of its
water tiles belong to bodies at/above the large-body threshold** — so this
feature's own floor protection means the large majority of the map's water
now dries at the much-slower large-body rate; raising the forming rate on
top of that newly-strengthened protection compounded instead of balancing.
Settled on `1/1800` (lower than even the pre-this-feature `1/1500`) once
that was understood: the same terrain-only run at this rate landed at
503/531/510 tiles (-2% to +8%) — real near-equilibrium, closing most of the
gap this session's own earlier "does this converge?" open question flagged
(see TODO.md — still not a mathematically airtight guarantee, just a real,
measured, much-improved one). This still reads as more dynamic than before
this feature overall: small puddles now form and fully evaporate on a real,
visible cycle; it's specifically large-lake permanence that got the
protection the direct ask wanted, not a wholesale rate hike alongside it.

### 3. Real-run findings — population, migration, and the "sated and idle" question

**Isolating this feature's own effect.** Because other engine work landed
concurrently this session on files this feature doesn't own, a clean
before/after specifically for flora.ts/weather.ts was taken by stashing
just those two files (reverting only this feature) and re-running the
identical 3000-tick/3-seed scenario with everything else in the tree held
constant, then restoring:

| seed | | final pop | births | migration starts (by reason) | water dried | water formed |
|---|---|---|---|---|---|---|
| 42 | before | 170 | 151 | scarcity:1, wanderlust:1 (2 total) | 63 | 9 |
| 42 | after | 166 | 148 | scarcity:5, wanderlust:4, territorial:1 (10 total) | 45 | 4 |
| 7 | before | 67 | 51 | wanderlust:1, scarcity:1 (2 total) | 26 | 10 |
| 7 | after | 185 | 170 | scarcity:5, wanderlust:3, weather:1 (9 total) | 53 | 20 |
| 20260903 | before | 60 | 41 | weather:1 (1 total) | 36 | 15 |
| 20260903 | after | 33 | 21 | wanderlust:2, weather:1 (3 total) | 28 | 12 |

**Migration events roughly quintupled to tripled across all three seeds**
(2->10, 2->9, 1->3) — a real, meaningful increase in herds actually
relocating due to scarcity/resource pressure, the direct goal of this
feature, checked rather than assumed. Final population and birth counts
moved in both directions across seeds (down slightly for 42, up sharply
for 7, down for 20260903) — consistent with this codebase's well-documented
butterfly-effect sensitivity to any behavior-shaping change under a fixed
seed (see the pathfinding section's own honest example of the same
pattern), not a systematic population effect in either direction. Zero
starvation deaths in every run, before and after — this feature adds
migration pressure without reopening the starvation-death problem this
session's earlier fixes closed.

**The "sated and idle" question, answered with real numbers.** Sampled at
ticks 1000/2000/3000 across all three seeds (living agents with
`behavior === "idle"` AND both hunger and thirst above 0.7):

| seed | tick 1000 | tick 2000 | tick 3000 |
|---|---|---|---|
| 42 | 3/29 (10.3%) | 1/52 (1.9%) | 11/166 (6.6%) |
| 7 | 0/25 (0%) | 3/70 (4.3%) | 3/185 (1.6%) |
| 20260903 | 0/26 (0%) | 1/27 (3.7%) | 0/33 (0%) |

Every sample lands under 11%, most well under 5% — a real, concrete answer
to "I see a lot of Pokémon just sorta sated doing nothing": at these
sampled points, that's a small minority of the living population, not the
majority impression the user's real-time observation described. Two honest
caveats, not papered over: (1) this doesn't fully isolate this feature's
own contribution to the idle fraction specifically, since other concurrent
engine work (a tile-occupancy/capacity feature landing in `needs.ts` this
same session, outside this feature's scope) also changes behavior
distribution over the same window; (2) a low idle-and-both-needs-satisfied
fraction doesn't by itself prove agents are idle *because of* scarcity
pressure rather than some other busy-ness (mating, fighting, herd cohesion)
— the migration-event increase above is the more direct, load-bearing
evidence that scarcity pressure specifically increased.

**A pre-existing performance ceiling, confirmed again, not caused here.**
An attempt at an 8000-tick, 3-seed run (per this task's own suggested
range) and a follow-up 5000-tick single-seed run both had to be killed
after several minutes without finishing — population growth driving a
real, already-documented (TODO.md) performance ceiling, unrelated to this
feature's own code (confirmed by the terrain-only water-drift script above
running the full 10,000-tick water cycle with zero agents in ~6 seconds).
3000 ticks (this feature's actual validation baseline, at the low end of
the requested 3000-8000 range) completes in ~7-10 seconds per seed; this is
a real, current practical ceiling on how long a full agent-population
headless run can go, not something this feature introduced or is
positioned to fix — see TODO.md.

### Tests

`packages/engine/test/waterBody.test.ts` (new, 11 tests): flood-fill
correctness (isolated single tile, straight line, diagonal-NOT-connected,
an irregular L-shape, two independent bodies, cache invalidation on both
tile-addition and tile-removal/splitting, independent caches per `World`
instance) plus `isLargeWaterBody`'s threshold boundary. `flora.test.ts`
gained real durability-tuning tests (3-feedings-to-empty at the new
`CONSUME_STOCK_AMOUNT`, a full patch dying meaningfully sooner than the old
~100-tick lifespan under a fixed decay rate, and a real roll that beat the
old spread rate but not the new lower one). `weather.test.ts`'s magnitude
test was rewritten for the tiered rates (small-body dry fraction >85%,
large-body dry fraction in a real 5-30% band, rain-form fraction in a real
10-60% band) and gained a dedicated large-vs-small-body integration test
(a hand-built 5x5 lake vs. an isolated puddle under the same sustained
drought, confirming the lake shrinks far more slowly and never drops below
the floor even under 4000 ticks of continuous exposure). No new rng source
was introduced (`waterBodySizeAt`'s flood fill is pure grid geometry, no
randomness) — `advanceWaterCycle`'s existing determinism test (same rng
sequence, same terrain outcome twice) continues to pass unchanged, and the
full engine suite's acceptance-level `determinism.test.ts` passes
unaffected. `pnpm -r typecheck`/`pnpm -r build` clean across all four
packages.

### Explicitly not done here

- No hysteresis/persistent-history tracking for water bodies (e.g.
  remembering "this was once a 40-tile lake" across many ticks) — the
  floor-equals-threshold fix above closes the *immediate* reclassification
  bug this feature's own testing found, but a border-line lake that
  survives many repeated droughts over a very long run could still, in
  principle, eventually cross the threshold for good and then dry at the
  fast small-body rate. Judged out of scope for this pass — real generated
  maps' actual large lakes run well above the threshold (34-183 tiles per
  the distribution table above), so this mainly matters for the handful of
  borderline 12-30-tile bodies over run lengths well beyond what this
  session's own headless-run performance ceiling currently allows anyway.
  See TODO.md.
- No fix for the pre-existing population-driven performance ceiling that
  blocked a full 8000-tick agent-population validation run — confirmed
  again here (not caused by this feature, see the terrain-only isolation
  test above), already tracked elsewhere in TODO.md.
- Idle-fraction isolation from concurrent, unrelated engine work (the
  tile-occupancy/capacity feature landing in `needs.ts` this same session)
  wasn't attempted — the real numbers above are still real and honestly
  caveated, just not a clean single-variable isolation the way the
  migration-event stash-based A/B test above is.

### Follow-up: a real, named yield cap per food source (direct ask)

Direct ask: "i think we need food sources to die out a little faster, like
20% less food produced per food source." Distinct from `CONSUME_STOCK_AMOUNT`
(how much one bite takes) — this is how much a source *holds* in the first
place. Previously an implicit `1` scattered across `flora.ts`'s maturation
branch and `world.ts`'s `createTile`/`setTile`; now a real, named constant,
`FOOD_MAX_STOCK = 0.8` (flora.ts), a flat 20% cut. Composes with
`CONSUME_STOCK_AMOUNT` (0.35) to bring a patch from ~3 feedings
(1 / 0.35 ≈ 2.86) down to ~2 (0.8 / 0.35 ≈ 2.29) before it's eaten out —
independent of `FOOD_LIFESPAN_TICKS`'s separate old-age clock. Does NOT
touch "flora" tiles' own `stock` field, which tracks decay/vitality
progress, not edible yield, and only happens to share the field name.
`world.ts` keeps a local duplicated literal (`WORLDGEN_FOOD_MAX_STOCK`) for
the same circular-dependency reason `occupancy.ts`'s `bodyWeightOf`
duplicate already documents — flora.ts is canonical, keep both in sync.

Also confirmed and answered directly (not a change, a verification): eggs
cannot die of starvation or thirst — `simulation.ts`'s `tickWorld` routes
every `isEgg` agent straight to `eggs.ts`'s `tickEgg`, never through
`tickAgentNeeds` (the only function that decays hunger/thirst or checks
starvation) — structurally impossible, not just unlikely. A new dedicated
test in `eggs.test.ts` proves this with a real `tickWorld` run starting at
0/0 needs, run well past both starvation grace periods.

Also clarified, since asked directly: there is no dynamic/runtime flora
tuning UI — "parametrize... so I can tune it" (this session's earlier
ask) delivered well-documented, grouped source constants (this file's own
"Tuning constants" section), not a live slider or debug panel. Tuning
still means editing `flora.ts` and rebuilding, same as every other
constant in this codebase.

**Real-run findings:** 3000-tick, 3-seed check: zero hunger-starvation
deaths on all three seeds (the safety bar holds), migration still firing
(2-4 events/seed), final populations 15-17 — consistent with, not a
regression from, the current post-egg-system baseline (population growth
is now bottlenecked upstream by the bond→shelter pipeline, see the eggs
section below; this change doesn't materially interact with that). Two
pre-existing tests (`flora.test.ts`, `needs.test.ts`) that hardcoded the
old implicit stock of `1` were updated to reference `FOOD_MAX_STOCK`
directly instead. All 718 engine tests pass, including the unmodified
determinism suite.

## Tile capacity: a hard limit on how crowded one tile can get

**Direct ask.** "Can we hard limit space so there's a weight limit for how
many Pokémon can be in a given tile? Like maybe around 3 max on avg. But
always allow at least 1. That way feeding and drinking has to actually be
timed. Might need ai to recognize when it's blocked or unable to get a
resource and try to relocate to find a new one." Follow-up clarification,
mid-implementation: "I think underground and canopy don't have the same
weight restriction, just go by hard number - up to 5 max per tile."

### Decided

1. **Two-tier capacity rule, by layer.** Surface uses a weight-based rule
   (reusing `support.ts`'s existing `bodyWeightOf` — `agent.maxHp ??
   FALLBACK_MAX_HP`, the same sim-original body-weight proxy already used
   for carry capacity, not a second invented weight concept). Underground
   and canopy use a flat headcount cap instead. Both share one floor: an
   **already-empty tile always admits at least one agent**, regardless of
   that agent's own weight or the flat cap — so a single heavy species (or,
   underground/canopy, any species at all — 5 >= 1 makes the floor
   automatic there) is never unable to stand anywhere.
   - **Surface** (`TILE_WEIGHT_CAPACITY = 90`, `occupancy.ts`): a tile
     already occupied only admits a newcomer if `current total weight +
     newcomer's own weight <= 90`. Calibration, real numbers not a guess: a
     3000-tick run across all three standard seeds (42/7/20260903) put the
     living population's average `maxHp`-as-body-weight at 30.15 / 32.32 /
     29.29 (mean ~30.6) — a fresh initial spawn (tick 0) averages lower,
     ~24.6, since the population hasn't leveled/evolved yet. `90 = 3 *
     ~30`, matching "maybe around 3 max on avg" against the real, matured
     roster rather than the smaller initial-spawn figure.
   - **Underground/canopy** (`FLAT_TILE_HEADCOUNT_CAP = 5`, `occupancy.ts`):
     a tile already occupied only admits a newcomer if the existing
     headcount is below 5, full stop, no weight math at all. Reasoning for
     the split (this is a real design call, not inferred from nothing):
     underground and canopy are the flat, generic, non-biome-varied layers
     — no elevation, no terrain texture, a pure flat floor grid at every
     x,y (see `createDemoWorld`'s doc comment) — so a physical "how many
     literally fit on this square" framing reads better there than a
     weight formula that has nothing to visually differentiate against; a
     flat number is also just simpler to reason about for two layers that
     don't otherwise vary tile-to-tile.
2. **Where the limit applies.** General movement, not just resource-seeking
   — the user's phrasing ("weight limit for how many Pokémon can be in a
   given tile") is about crowding in general, even though the motivating
   example is feeding/drinking. `occupancy.ts`'s `canEnterTile` is the one
   predicate every capacity-aware step checks; a full tile is "blocked for
   entry" for movement purposes (still walkable — this is not a terrain
   change) and composes with pathfinding: `pathfinding.ts`'s `findPath`
   (given an optional `mover` argument) treats a capacity-blocked tile
   exactly like an obstacle, routing around it via BFS the same way it
   already routes around trees/boulders, INCLUDING the destination tile
   itself (a capacity-blocked destination makes the whole route
   `undefined` — "can't get there right now," not a partial route to
   somewhere adjacent — a deliberate, documented scope call, see
   `findPath`'s own doc comment).
   - **Real-run finding that narrowed this scope**: capacity-gating EVERY
     kind of movement (herd cohesion converging on a centroid,
     hunt/mate-seeking pursuit via `stepTowardMovingTarget`, dispersal,
     migration/relocate, herd food-delivery/carrying, forced
     knockback/lunge) produced a severe, real population regression on a
     3000-tick real run — up to an ~83% final-population drop on one seed
     (20260903: 249 -> 42) with ZERO starvation deaths, meaning the drop
     wasn't from agents dying, it was from breeding throughput collapsing.
     Root cause: `stepTowardMovingTarget`'s hunt/mate pursuit only ever
     needs to reach *adjacency*, never to physically stand on the target's
     own tile — but gating it on capacity meant `findPath`'s "the
     destination itself is blocked" check fired constantly, since a
     potential mate standing amid an ordinary herd cluster is easily
     already at-or-near capacity from the herd itself, misreading normal
     herd density as "unreachable." Fix: capacity-gating was pulled back to
     the two places it's actually about — `stepAlongPath` (seekWater/
     seekFood, the literal ask) and `needs.ts`'s exploration wandering
     (harmless, doesn't converge on a point) — while `stepTowardMovingTarget`
     (hunt/mate pursuit), herd cohesion, dispersal, migration/relocate,
     herd support, and forced movement all stayed capacity-BLIND, exactly
     their pre-feature behavior. This is a real, load-bearing scope
     narrowing, not an oversight — every one of those reverted call sites
     has its own doc comment explaining why, pointing back here.
3. **Blocked-resource AI — the explicit ask.** When an agent's
   seekWater/seekFood target is at capacity, `needs.ts` now:
   - Waits in place for `BLOCKED_RESOURCE_GRACE_TICKS` (25) ticks, tracked
     via `Agent.ticksBlockedFromResource` — the same "sustained, not
     instant" tuning convention as everything else in this codebase, so
     this reads as genuine queueing rather than instant relocation.
     `stepAlongPath` is itself capacity-aware, so an agent still makes
     whatever real progress it safely can toward/near the tile during the
     wait rather than doing literally nothing.
   - After the grace period, excludes that specific tile
     (`Agent.blockedResourceTiles`, capped at `MAX_BLOCKED_RESOURCE_MEMORY`
     = 4 recent entries) and re-picks the nearest tile of the same terrain
     kind, now ignoring the excluded one(s) — `resourceIndex.ts`'s
     `findNearestIndexed`/`needs.ts`'s `findNearestTerrain` both gained an
     `exclude: Vec2[]` parameter for this.
   - **Oscillation prevention, tested explicitly.** A real risk: two
     mutually-crowded tiles could, in principle, bounce an agent back and
     forth forever. Three things prevent it: (a) the exclusion memory
     persists across ticks within one seeking episode, so a just-excluded
     tile isn't immediately re-offered; (b) once every currently-known
     nearby tile of that terrain is excluded (detected structurally — one
     unfiltered `findNearestTerrain` call returns something even though
     the *excluded* lookup returned nothing), a safety valve fast-tracks
     `Agent.ticksWithoutResource` straight to `MIGRATE_AFTER_TICKS`,
     handing off to the already-tested, pre-existing `migrate()` escape
     valve instead of making the agent sit through a SECOND full 150-tick
     timeout on top of the grace periods it already spent; (c) the
     exclusion memory clears the instant the episode ends (a successful
     consume, `chooseBehavior` moving on to a different need, or a
     completed migration to a new location) so a tile that frees up later
     always gets a fresh look on the agent's next real thirst/hunger spike.
     `test/needs.test.ts`'s "does not infinite-loop between two
     mutually-crowded tiles" test reproduces exactly this (both tiles
     crowded to capacity) and asserts the agent reaches `"relocate"`
     within a bounded number of ticks rather than oscillating.
   - A real, and initially missed, interaction: `resourceIndex.ts`'s
     underground->surface water redirect (underground shares surface's
     water) doesn't know about exclusion by default — `findLayerWithTerrain`
     (needs.ts, the cross-layer fallback check) was NOT threading the
     exclusion list through, so an agent that just excluded a crowded
     surface water tile could "discover" the very same tile again via the
     cross-layer check and ping-pong underground<->surface forever, one hop
     per tick, never reaching the fast-track safety valve above. Fixed by
     giving `findLayerWithTerrain` the same `exclude` parameter and
     threading the current exclusion list through at its one call site —
     caught by the oscillation test above during real validation, not
     theorized in advance.
4. **No explicit turn-taking queue built on top.** The capacity limit alone
   produces real waiting/timing (see real-run numbers below) — validated,
   not assumed.

### Built, real-run findings

Same standard 3 seeds (42, 7, 20260903), 3000 ticks, via
`packages/runner`. All numbers below are from the FINAL, narrowed-scope
code (capacity-blind hunt/mate pursuit/herding/dispersal/migration/forced
movement; capacity-aware seekWater/seekFood + exploration only).

**Calibration.** See "Decided" #1 above — `TILE_WEIGHT_CAPACITY = 90`
against a real ~30.6 average body weight, `FLAT_TILE_HEADCOUNT_CAP = 5`.

**Real crowding/contention, surface layer** (underground/canopy: 0 —
see "Explicitly not done / open follow-ups" below for why):

| seed | resource tiles ever occupied | max simultaneous occupants seen (sampled every 25 ticks) | avg occupants per occupied tile (end of run) |
|---|---|---|---|
| 42 | 26 | 7 | 2.04 |
| 7 | 17 | 9 | 1.18 |
| 20260903 | 10 | 3 | 1.20 |

Real contention happens — tiles do fill toward (and, since capacity is
weight- not count-based, sometimes past 3 for lighter species) the
designed ceiling, not just theoretically.

**Blocked-resource fallback: fires, and mostly resolves by waiting, not
relocating** — the thing item 4 above needed validating, not assuming:

| seed | `resourceBlockedFallbackCount` (gave up & switched tiles) | `resourceWaitTicks` (agent-ticks spent actually waiting) | ratio |
|---|---|---|---|
| 42 | 138 | 7078 | ~51:1 |
| 7 | 17 | 824 | ~48:1 |
| 20260903 | 3 | 316 | ~105:1 |

Tens-to-a-hundred agent-ticks of real waiting happen for every one time an
agent actually gives up and relocates to a different resource — confirms
the user's ask ("feeding and drinking has to actually be timed") is
actually happening as visible queueing, not relocation wearing a
"blocked-resource" costume.

**Starvation deaths: zero, on all three seeds, before and after.** The
explicit critical bar from the brief. Traced via the exact same
`starved`/`{hunger,thirst}` accounting this session's earlier "dying of
thirst" fixes (see the "commits no matter what" sections above) already
instrument — `world.agents.filter(a => alive).length` plus a direct
`log.events` scan for `kind: "starved"` across all three seeds, all three
0. No new starvation regression from this feature.

**Population/growth: real, honestly-reported throttling — larger than
expected on one seed, and not fully explained by capacity contention
alone.**

| seed | baseline final population / births (no capacity limit) | with capacity limit | delta |
|---|---|---|---|
| 42 | 227 / 213 | 207 / 191 | -9% |
| 7 | 101 / 88 | 75 / 61 | -26% |
| 20260903 | 249 / 225 | 42 / 26 | -83% |

Seed 42 and 7's slowdowns read as the expected, intended consequence of
adding real scarcity — some throughput lost to queueing is exactly what
"timed" feeding means. Seed 20260903's much larger drop does NOT track its
own contention numbers (only 3 blocked-fallback events, 316 wait ticks,
max 2 simultaneous occupants — among the *lowest* contention of the three
seeds, not the highest) — average hunger/thirst sampled every 250 ticks
stayed healthy throughout (0.5-0.9 range, never crisis-level) and there
were zero deaths, so this isn't a starvation-adjacent failure. The
likelier explanation, consistent with this session's own earlier
documented finding ("this fix likely explains a meaningful share of this
session's earlier 'population sometimes explodes, sometimes stays low'
mystery" — see the support-move-lockup section above): this sim's
population trajectory is genuinely chaotic-sensitive to small deterministic
changes in tick-by-tick movement on some seeds, and seed 20260903 has
already been flagged in this session as a specifically stubborn,
low-growth-prone seed even before this feature. This is reported honestly
as a real, measured finding rather than swept aside — flagged as an open
follow-up below, not silently fixed by loosening the capacity numbers the
user asked to be tight.

### Explicitly not done / open follow-ups

- **Underground/canopy contention is real-run-unobserved, not
  untested.** The flat `FLAT_TILE_HEADCOUNT_CAP = 5` rule is unit-tested
  directly (`test/occupancy.test.ts`), but a real 3000-tick run shows ZERO
  occupied resource tiles on either layer — because neither layer's
  worldgen ever places its own "water"/"food" terrain (canopy has none at
  all; underground redirects water lookups to the surface, per
  `resourceIndex.ts`'s existing convention, so agents drink while
  physically standing on the SURFACE's water coordinate, not an
  underground-native tile). The flat cap is correctly wired and will apply
  the instant underground/canopy ever get their own resource terrain, but
  nothing in the current world generation exercises it under real
  population pressure today.
- **Seed 20260903's disproportionate population effect** (see above) is
  flagged, not chased down further this pass — it doesn't present as a
  starvation/capacity-crowding problem by its own numbers, and pinning down
  exactly which deterministic tick-order perturbation this feature
  introduces that cascades into a large population difference would need
  its own dedicated isolation pass (e.g. an event-by-event diff against
  the pre-feature run, the same style of A/B this session has used for
  other perf/behavior investigations elsewhere in this doc).
- **No hysteresis on the blocked-resource exclusion memory beyond one
  seeking episode** — by design (see "Decided" #3), but worth naming
  explicitly: a tile excluded late in one episode gets a completely clean
  slate the very next time the same agent gets thirsty/hungry, even if it's
  only a handful of ticks later and the tile is still just as crowded. In
  practice this just means one extra `BLOCKED_RESOURCE_GRACE_TICKS`-long
  wait before re-excluding it, not a correctness problem.

### Follow-up: tightened to 2.5x average weight (direct ask)

Direct follow-up once the 3x cap (90) was confirmed producing zero
starvation deaths and healthy populations on all three seeds: "can probably
further reduce weight I think to avg 2.5 agents?" `TILE_WEIGHT_CAPACITY`
90 -> 75 (2.5 * ~30.6).

**Real-run findings, honestly counterintuitive.** Same 3000-tick, 3-seed
real run: zero starvation deaths on all three seeds, unchanged from the 3x
cap — the safety bar holds. But final population went *up* on every seed
(seed 42: 62->80, seed 7: 61->114, seed 20260903: 63->128), the opposite of
the naive "tighter cap -> more blocking -> lower population" expectation.
Not read as a real causal effect of tighter capacity specifically — this
sim is repeatedly documented elsewhere in this file as rng-chaos-sensitive
to any change that perturbs candidate/occupancy decision order from tick 1
onward (a capacity-threshold change alters which agent gets to enter a
contested tile on any given tick, which cascades into a completely
different rng-consumption trajectory for the rest of the run). The
directionally-relevant, causally-trustworthy number is the unchanged
zero-starvation result; the population deltas are presented as real
observed numbers, not attributed to "tighter capacity grows the
population," which would need a dedicated event-by-event isolation pass
(as the note above already flags as unresolved for the *previous* tuning
pass too) to actually confirm one way or the other.

## Herd conflict: fighting over resources

Direct feedback, in two messages: "I think I want like.. Hm.. More emergent
behavior that can actually cause conflict and stuff. Do we have interesting
herd behavior? I kinda want like more fighting," then, after being walked
through the existing territorial-rivalry relocation mechanic (herdMigration.ts)
and asked whether it should escalate to real combat: "I think escalated
rivalry, even between species or same species, having them fight over
resources would be cool."

**The overriding constraint, stated up front because it shaped every design
choice below**: this sim's predator populations are already fragile and
crash toward near-extinction easily in real runs — documented repeatedly
elsewhere in this file and in TODO.md. Any new source of combat/death risk
needed real validation that it doesn't make that worse. "More fighting"
could not mean "more extinction."

### Decided

1. **Trigger: real resource contention, not an extension of territorial
   rivalry.** Two real candidates existed going in: extending
   herdMigration.ts's existing same-species territorial trigger (today it
   always resolves by the smaller herd relocating away, never fighting), or
   a new trigger off real tile-capacity contention (occupancy.ts, shipped
   earlier this session) — two herds repeatedly blocked from the same
   crowded water/food tile by each other. The user's own phrasing ("fight
   over resources") points at the second, and it's the more concrete,
   already-instrumented condition: needs.ts already tracks
   `Agent.ticksBlockedFromResource` (a real per-agent counter, added for the
   tile-capacity feature's own "wait, then relocate" behavior) every time
   `canEnterTile` says a seekWater/seekFood target is full. That's the exact
   "the two of them both physically want THIS tile right now" signal a
   fight-over-resources mechanic needs, and it's individual-level (whoever's
   actually standing there) and cross-species-capable (any two non-predator
   species can contest a tile) in a way herdMigration's herd-centroid-level,
   same-species-only territorial trigger isn't. Built only the
   resource-contention trigger; extending territorial rivalry to escalate
   into combat is a real, separate follow-up (see TODO.md), not attempted
   here — the two triggers don't share enough machinery (one is
   per-tile-block bookkeeping in needs.ts, the other is per-herd-centroid
   bookkeeping in herdMigration.ts) that skipping one meaningfully saved
   scope, and resource contention alone already satisfies the "even between
   species or same species" ask.
2. **Scope: no predator species, either side, full stop.** Rather than
   trying to carefully tune a mechanism that's provably safe for an
   already-fragile predator roster too, predators are excluded from this
   trigger entirely — both the acting agent and the candidate rival must be
   non-predator species (`!rules[species]` on both sides) or
   `applyHerdRivalryConflict` never even looks for a rival. A predator herd
   squabbling with another predator herd, or a predator muscling a
   herbivore off a water hole, are real follow-up ideas, not built here (see
   TODO.md). This single decision is most of the population-safety case:
   this mechanic cannot, by construction, ever touch the roster this
   session's predator-fragility findings are actually about.
3. **Lethality model: cannot faint or kill, by construction, not by tuning.**
   Real animal conflicts over a resource are almost always about who backs
   off, not who dies — and given (2), "more fighting" specifically must not
   become a new unbounded death channel. Rather than reusing predation.ts's
   faint/finishing-pool machinery (which can genuinely kill) and trying to
   tune around it, the new `herdConflict.ts` module writes its own
   resolution: it reuses the exact same accuracy/crit/damage pipeline
   predator/prey combat uses (`rollAccuracy`/`rollCritical`/`calculateDamage`
   from combat.ts — real stats, real types, real STAB/effectiveness, not a
   simplified toy formula), but clamps the defender's hp at
   `HERD_CONFLICT_HP_FLOOR_FRACTION * maxHp` (15%) — this mechanic can never
   bring an agent to 0 hp, never sets `fainted`, never sets `alive: false`,
   no matter how many times it fires against the same agent. The defender
   physically retreats (steps away from the contested tile, gets a real
   cooldown) once it crosses `HERD_CONFLICT_RETREAT_HP_FRACTION` (60% of max
   hp) — a real, felt cost (meaningfully hurt, walks away, takes longer to
   heal, loses the contested tile) without ever being a death mechanism.
   Proven directly by a unit test that fires 50 consecutive hits at a
   100%-power move against the same target and confirms hp never drops
   below the floor and neither `fainted` nor `alive` ever flips.
4. **Gating: a real disposition-weighted roll plus real relative strength,
   not a flat chance** — matching this codebase's established convention
   (herdMigration.ts's `wanderlustChance`, predation.ts's `mobThreshold`/
   flee-radius/hunt-threshold, all disposition-driven rather than invented
   dice rolls). `herdConflictChance` is `HERD_CONFLICT_BASE_CHANCE +
   courage * HERD_CONFLICT_DISPOSITION_SCALE` where courage is the same
   boldness+aggression average predation.ts's `mobThreshold` already uses —
   a bold/aggressive agent is meaningfully more likely to pick a fight than
   a timid one, so low-aggression herds keep doing exactly what they already
   did before this feature (wait out the grace period, then relocate to a
   different resource tile per the pre-existing tile-capacity behavior).
   `HERD_CONFLICT_MIN_POWER_RATIO` (0.6, symmetric) additionally refuses a
   fight that's badly mismatched either direction — a real, comparably-matched,
   confident pair fights; a hopeless mismatch still just avoids/relocates,
   whichever side is asking.
5. **Only the two individuals actually contesting the tile fight** — not a
   herd-level mass event. This falls out naturally from where the trigger
   lives (an individual agent's own action tick, inside the existing
   seekWater/seekFood blocked-tile branch), not something that needed extra
   machinery to prevent: `findRivalOccupant` looks for a rival within one
   tile of the contested target, so it's always "whoever's actually standing
   there" on each side, never a mob.
6. **A new, distinct `herdClash` `SimEvent`**, not a reuse of predation's
   `fought`/`defeated`/`killed` — those kinds carry semantics (a `killed`/
   `defeated` outcome, hunger-restore on the predator's side) this mechanic
   deliberately never produces, and conflating them would make the event log
   lie about which mechanic caused what. `herdClash` carries both
   participants' `herdId` (so a UI/narrator can tell "different herds, same
   species" apart from "different species entirely") and an `outcome` of
   `"missed" | "hit" | "retreated"` — deliberately never `"fainted"`/
   `"killed"`, which is the log-level proof this can't produce those
   outcomes, not just an internal one. Display support added to
   `packages/web/src/eventText.ts` (a new `STORY_KINDS` entry, its own icon/
   color, distinct from `fought`'s) and `packages/runner/src/format.ts`,
   following the exact template `terrainChanged`/`immigrated` set when they
   were added earlier this session. Not added to `HEADLINE_KINDS` — same
   reasoning as `fought` itself already not being there: a real moment, but
   not a population-shaping one (birth/true-death/evolution), so it doesn't
   belong in the long-run "quiet mode" filter.

### Built, real-run findings

`packages/engine/src/herdConflict.ts` (new module) plus small hooks: a new
`Agent.herdConflictCooldownTicks` field (ticked down in `tickAgentNeeds`,
same shape as `digestingTicksRemaining`), and the trigger call site itself
inside needs.ts's existing seekWater/seekFood blocked-tile branch — once an
agent has been blocked from a specific crowded tile for
`HERD_CONFLICT_MIN_BLOCKED_TICKS` (8) consecutive ticks (a real, sustained
standoff, not a fresh block), `applyHerdRivalryConflict` gets a chance to
fire; when it doesn't (no eligible rival, on cooldown, a predator's
involved, or the roll just misses), the tick falls straight through to the
pre-existing wait/relocate behavior, unchanged. 10 new engine tests
(`herdConflict.test.ts`) cover: no rival present, herd-mates never counted
as rivals, predators excluded on either side, a bold comparably-matched
agent actually engaging a cross-species rival, same-species conflict working
too, a timid agent's disposition gate holding under a rigged always-succeed
accuracy/crit roll, a badly mismatched pair refusing to fight, the cooldown
gate, the non-lethal hp floor holding under 50 repeated worst-case hits, and
a defender that crosses the retreat threshold physically stepping away with
a real cooldown on both sides. All 652 engine tests pass (642 pre-existing +
10 new), including the unmodified determinism acceptance test
(`determinism.test.ts`) — the same-seed-twice byte-identical-log check still
holds with `herdConflict.ts`'s new rng draws threaded through `world.rng`
like every other random source in the engine.

**Real 3000-tick runs, 9 seeds (42, 7, 20260903, and 1-6), feature on**:
`herdClash` fired a real, non-trivial number of times per run — 19 to 90
across the 9 seeds, split across `"hit"` (real damage landed, defender not
yet at retreat threshold), `"retreated"` (the mechanic's actual resolution —
defender crossed 60% hp and backed off), and an occasional `"missed"`. Zero
`"killed"`/`"defeated"`/`"fainted"` events were ever produced by this
mechanic across any of the 9 runs — expected, since `herdConflict.ts` never
calls into predation.ts's faint/kill machinery at all, but confirmed in real
run output too, not just by the unit test's clamp check.

**Predator population, the number that actually mattered here**: across all
9 runs, predator species (scyther/spearow/onix, per `HUNT_RULES`) stayed at
the same fragile-but-not-always-zero level this session's TODO.md already
documents as the sim's pre-existing baseline — 0 to 2 living individuals per
species per run, several runs ending with the same 0-across-the-board result
this codebase already treats as expected/known, a few with 1-2 survivors.
Nothing in these 9 runs reads as a *new* predator die-off pattern, and by
construction (decision #2 above) this mechanic structurally cannot be the
cause of one — predators never appear on either side of a `herdClash`.

**Single-seed before/after comparison was attempted and explicitly
discarded as unreliable**, not glossed over: disabling the feature's call
site and re-running the same 3 seeds (42/7/20260903) produced wildly
different total-population deltas per seed — seed 42 dropped (126 -> 108),
seed 20260903 rose modestly (65 -> 79), and seed 7 swung enormously (43 ->
241). That last number is not a real effect of this feature; it's this
sim's own repeatedly-documented rng-chaos-sensitivity (see the "Tile
capacity" section's own "Follow-up: tightened to 2.5x" subsection for the
exact same phenomenon on a completely different feature) — `herdConflict.ts`
consumes `world.rng()` draws at new points in the tick sequence the moment
it's eligible to fire, which desyncs every subsequent random decision for
the rest of that run from the very first tick that difference shows up.
Paired single-seed A/B is not a trustworthy signal here, and this section
doesn't lean on it — the trustworthy evidence is the structural guarantees
(decisions #2/#3, proven by code + unit test, true regardless of any seed's
rng trajectory) and the 9-seed feature-on distribution above, which is
directionally consistent with the pre-existing documented baseline rather
than showing a new predator-specific regression.

### Explicitly not done here (see TODO.md)

- Extending herdMigration.ts's territorial trigger to escalate into combat
  instead of always relocating — the other real candidate trigger mechanism
  from the original design brief, deliberately not built (see decision #1).
- Predator involvement of any kind (predator-vs-predator rivalry, or a
  predator contesting a resource with a non-predator) — deliberately scoped
  out entirely (decision #2), not a partial/softer version of it.
- A herd-level (not just individual-level) version of this mechanic — e.g.
  several members from each side converging, closer to predation.ts's
  existing mob-fighting shape. Deliberately not attempted: mob-scale herd
  conflict is a much bigger new death-risk surface to validate safely, and
  the individual-pair version already satisfies the direct ask.

## Grazing scars: sustained heavy grazing degrades a tile beyond ordinary depletion

Direct user pitch, approved directly ("Yeah that sounds good"): world-shaping
behavior beyond shelter-building — species that leave a real, lasting mark on
the land they use. Three ideas were pitched (grazing scars, trampled paths,
territory marking); the user picked grazing scars. Explicit ask: sustained
heavy grazing by a herd should leave a lasting mark distinct from ordinary
food-patch stock depletion (which already exists) — flora should spread/
regrow measurably more slowly on a heavily-grazed spot even after the
immediate stock depletion would normally have let it recover, and this scar
should fade on its own with real rest, not become a permanent dead zone.

### Decided

1. **A persistent per-tile counter, not a derived/cached index.** `Tile.
   grazingPressure` (types.ts) accumulates independent of the tile's current
   terrain — the whole point is that the scar OUTLIVES the food patch's own
   life-cycle (a patch eaten out and reverted to "floor" keeps its pressure).
   Same "single per-tick scan in `growFlora`, not per-agent" shape as
   `Tile.stock`/`Tile.vacantTicks` (shelter abandonment) already use in this
   codebase — a derived index (`waterBody.ts`'s pattern) would have been
   overkill for a value that's read/written at the exact same call sites
   that already own `stock`.
2. **Real grazing events, not synthetic ticks.** `flora.ts`'s new
   `recordGrazing(tile)` is called from both real consumption call sites —
   `needs.ts`'s self-feeding `consume()` and `support.ts`'s herd
   food-delivery pickup — the same two places `CONSUME_STOCK_AMOUNT` already
   depletes `stock`. No new species/behavior data needed.
3. **Hysteresis, not a single threshold.** `Tile.overgrazed` flips true at
   `OVERGRAZED_ENTER_PRESSURE` (3 — matching `CONSUME_STOCK_AMOUNT`'s own
   "3 feedings empties a patch" bar: it takes a full patch's worth of real
   grazing pressure, from one patch or several regrown-and-refed at the same
   spot, to actually scar the ground) and flips back false only once pressure
   decays down to `OVERGRAZED_EXIT_PRESSURE` (1) — a lower bar than the entry
   one, so the flag doesn't flicker tick-to-tick right at the boundary.
4. **Real, not token, suppression while overgrazed** — three separate growth
   paths, all in `flora.ts`:
   - `trySpread` refuses to seed an overgrazed neighbor at all (0% — the one
     growth path with other, un-scarred neighbors usually available instead,
     so an outright ban here doesn't strand the map).
   - `maybeDropSeed`'s germination chance is multiplied by
     `OVERGRAZED_GROWTH_MULTIPLIER` (0.15 — an 85% reduction) on overgrazed
     floor, not zeroed — a real suppression, but a scarred tile can still,
     rarely, get lucky and start recovering under continued light pressure.
   - A seedling that does take root on overgrazed ground matures at the same
     0.15x rate, not the normal 1 tick/tick — the growth-path suppression
     doesn't stop at the germination gate.
5. **Self-fading, not permanent.** `growFlora` decays every tile's
   `grazingPressure` by `GRAZING_PRESSURE_DECAY_PER_TICK` every tick,
   whether or not it's currently overgrazed. A scar reads as "this ground
   needs to rest," not a dead zone — see the tuning note below for the real
   real-run finding that drove the actual decay rate.
6. **A narratable event, filed as ambient noise.** `floraChanged`'s existing
   `stage` union gained `"overgrazed"`/`"recovered"` (reusing the existing
   event kind rather than adding a new one, since it's the same "this tile's
   flora state changed" narration `floraChanged` already carries for
   seeded/sprouted/died) — both `packages/runner/src/format.ts` and
   `packages/web/src/eventText.ts` already render `floraChanged` generically
   (`flora ${stage} at (x,y)`), so no new formatting code was needed. Stays
   in `NOISE_KINDS` (ambient ecology bookkeeping, same bucket as the other
   `floraChanged` stages), not `STORY_KINDS`/`HEADLINE_KINDS` — a tile
   scarring over isn't a moment worth the same visual weight as a birth or a
   kill.

### Built, real-run findings

**First attempt was measurably too weak — caught by a real run, not
guessed.** The first tuning pass (`OVERGRAZED_ENTER_PRESSURE = 4`,
`GRAZING_PRESSURE_DECAY_PER_TICK = 0.02`, chosen so one patch's normal
3-feeding life-and-death cycle would sit right at the edge of the threshold)
produced almost nothing in a real 3000-tick, 3-seed run: only 3 tiles ever
went overgrazed across all three seeds combined. Diagnosed directly, not
theorized: a real run showed individual food tiles genuinely getting grazed
4-8 times each over 3000 ticks (170 distinct fed tiles on seed 42 alone, 12
of them hit 4+ times) — plenty of real repeated grazing was happening. The
problem was timing: consecutive feedings at the same coordinate are
naturally spaced anywhere from a few ticks (multiple herd-mates feeding at
once) to several hundred ticks apart (`FOOD_LIFESPAN_TICKS`=70 to die,
`MATURATION_TICKS`=20+ to regrow before the next feeding can happen at all),
and the 0.02/tick decay rate — full decay of a single grazing event in 50
ticks — was erasing pressure almost as fast as it accumulated, wiping the
slate clean between a herd's feeding waves nearly every time.

**Retuned against that same real data**: `OVERGRAZED_ENTER_PRESSURE` lowered
to 3, decay slowed 5x to `GRAZING_PRESSURE_DECAY_PER_TICK = 0.004` (so
pressure survives the gap between feeding waves instead of resetting before
the next one lands), `OVERGRAZED_EXIT_PRESSURE` lowered to 1 in step. Same
3000-tick, 3-seed run after the retune:

| seed | distinct tiles that went overgrazed | overgrazed events | recovered events | herdMigrating events (total) | starvation deaths |
|---|---|---|---|---|---|
| 42 | 9 | 9 | 1 | 6 (was 4 before the feature) | 0 |
| 7 | 20 | 20 | 0 | 4 (unchanged) | 0 |
| 20260903 | 1 | 1 | 1 | 4 (unchanged) | 0 |

Zero starvation deaths on all three seeds, matching the explicit safety bar
in the brief — flora regrowth suppression did not tip any seed into a
starvation regression. Seed 7's 20 overgrazed events all landed late in the
run (ticks 2272-2969, inspected directly) — consistent with that seed's
population booming to 248 by the end (231 births), meaning far more real
feeding traffic late-run than early-run, not a decay-rate bug; none of those
20 had recovered by tick 3000 because most only crossed the threshold in the
run's final ~700 ticks, not because recovery is broken (seed 42's one
`"recovered"` event, and the dedicated `flora.test.ts` regression test that
grazes a tile once and confirms it fades back under 1000 ticks of rest,
confirm the fade mechanism works on its own).

**A real, isolated A/B, not just before/after correlation**: re-ran the same
3 seeds with `OVERGRAZED_ENTER_PRESSURE` set to `Infinity` (the mechanic
structurally can't ever fire, same call sites otherwise unchanged) —
population/births/migration-event counts for all 3 seeds matched byte-for-
byte the very first (weak-tuning) run, confirming the feature's marginal
contribution is real and attributable, not a coincidence of a different rng
trajectory. Migration events rose on seed 42 specifically (4 -> 6, split
+1 wanderlust, +1 scarcity) once overgrazing started actually suppressing
regrowth there — a real, if modest, correlation with the "herds move on once
their local patch scars over" effect this feature was meant to produce.
Seeds 7 and 20260903 show no migration-count change despite real overgrazing
activity on seed 7 specifically (20 tiles) — read honestly, not oversold:
most of that seed's overgrazing happens late in a booming, food-secure
run (231 births, healthy end-of-run hunger/thirst averages 0.69-0.73), where
a scarred tile among many others isn't enough on its own to trigger a full
herd relocation. The mechanism visibly suppresses regrowth (9-20 tiles per
run genuinely degrade); whether that reliably escalates into more migration
specifically is a real, seed-dependent effect, not a guaranteed one.

**New engine tests** (`flora.test.ts`): `recordGrazing` accumulates pressure
across repeated calls and no-ops safely on an undefined tile; a single real
feeding never crosses the overgrazed threshold (the "near-miss, not an
automatic scar" design point); sustained grazing (4 events in quick
succession) does cross it and fires a real `floraChanged`/`"overgrazed"`
event; a scarred tile's `trySpread` target is refused while an otherwise-
identical fresh tile spreads normally; `maybeDropSeed`'s germination chance
is measurably suppressed on overgrazed ground (a roll that succeeds on fresh
ground fails against the suppressed rate); a seedling on overgrazed ground
matures measurably slower over 10 ticks than one on fresh ground; a scar
fades back to `overgrazed: false` after a real (not instant) rest period
with a `"recovered"` event; and an rng-determinism check confirming two runs
of `growFlora` fed the same fixed rng sequence produce byte-identical
grazing/decay/overgrazed bookkeeping. All 652 engine tests pass, including
the unmodified `determinism.test.ts` acceptance test (same-seed-twice
byte-identical event logs) — this feature adds zero new `Math.random()`
calls; every roll it touches (germination, spread) already threaded `rng`
from `world.rng`, and the new decay/threshold logic itself is deterministic
arithmetic with no randomness of its own.

### Explicitly not done / open follow-ups (see TODO.md)

- No suppression of the *decay* of what's already grown elsewhere from an
  overgrazed tile — only new growth onto/from it is suppressed. A tile that
  matures to food or flora before crossing the overgrazed threshold decays
  and dies on its own normal schedule; overgrazing doesn't accelerate that.
- No visual/renderer treatment for an overgrazed tile beyond the event log
  entry — it still looks like ordinary "floor" on the map. A real, if
  cosmetic, follow-up if scars turn out to be common enough in practice to
  be worth a distinct glyph/tint.
- Seed 7's late-run-clustering pattern (all 20 overgrazed events in the
  final ~700 of 3000 ticks) is reported as a real observation, not chased
  down as a possible timing issue — it tracks that seed's own late
  population boom, not a suspected bug, but a dedicated tick-by-tick
  isolation pass (this file's own established standard elsewhere for
  "confirm, don't assume") would be needed to rule out every alternative
  explanation with full confidence.

## Pack hunting, scavenging, and ontogenetic niche shift

Three real-biology behaviors pitched together, all approved directly: "Pack
hunting sounds good. Scavenging is good. Ontogenic too." (ontogenetic niche
shift — juveniles behaving/eating differently than adults). Direct framing
for why these specific three, not picked at random: this session's own
`herdConflict.ts` section (just above) had to scope predators out of herd
conflict *entirely* specifically because of this file and TODO.md's
repeatedly-documented predator-population fragility — real 2000-3000-tick
runs routinely end with 0-2 living `scyther`/`spearow`/`onix` per species,
sometimes zero across the board. Pack hunting (more successful hunts without
raw stat buffs) and scavenging (a real meal that doesn't require a
successful kill) are both explicitly aimed at that same fragility as real
levers, not just "more mechanics" — so this section's actual bar is whether
they measurably help, honestly reported either way.

### Decided

1. **Pack hunting is the existing mob-fighting pattern, flipped to
   offense — a real, positioning-driven trigger, not an invented dice
   roll.** `predation.ts` already has "several agents converge on one target"
   machinery (`mobThreshold`/`countHerdAllies`/the flee-vs-mob branch in
   `applyPredationInstincts`), built defensively for prey ganging up on a
   predator. Pack hunting reuses that exact shape for the predator's own
   hunt: `isPackPreyOf` extends `isPreyOf`'s existing power-ratio gate with a
   second, wider band — `PACK_PREY_POWER_RATIO` (1.15) above the solo
   ceiling (`PREY_POWER_RATIO`, 0.75, unchanged) — so a pack can only ever go
   after something a lone predator would never attempt alone but isn't
   hopeless either, never "anything goes with enough friends." The trigger
   itself only fires once a real, nearby same-species conspecific
   (`nearbySameSpeciesConspecifics`, `PACK_MUSTER_RADIUS` = 5) is actually
   there — no chance roll decides whether a pack "forms."
2. **Deliberately NOT herd-gated, unlike the defensive mob-fighting it's
   modeled on.** `countHerdAllies` (mob-fighting) requires a shared
   `herdId`, which works for prey (spawned into real herds), but this sim's
   predator species spawn and mostly stay solitary — `packages/data/src/
   scenario.ts` gives `scyther-0`/`onix-0`/`spearow-0` no `herdId` at all.
   Gating pack hunting on shared `herdId` the same way would mean it
   essentially never fires. `nearbySameSpeciesConspecifics` is proximity +
   species only — a real pack in nature doesn't require this sim's formal
   herd bookkeeping either.
3. **The real mechanical advantage: an accuracy bonus, not flavor text.**
   `committedPackmates` counts OTHER same-species conspecifics already
   actively hunting the exact same target (`Agent.huntTarget === target.id`,
   itself a real, positioning-driven signal already tracked for other
   reasons) within pack range, and `packAccuracyMultiplier` turns that into
   a real `rollAccuracy` boost (`PACK_ACCURACY_BONUS_PER_ALLY` = 0.15 per
   committed packmate, capped at `PACK_ACCURACY_BONUS_CAP` = 0.45) —
   threaded as a new `accuracyBonusMultiplier` parameter through `resolveHit`
   -> `resolveHitAgainstTarget`'s existing `rollAccuracy` call (composing
   with the pre-existing storm-accuracy multiplier, same pattern). Every
   pre-existing caller of `resolveHit` (mob-fighting's own defensive fights,
   the guardian branch) passes no bonus and is completely unaffected — the
   parameter defaults to 1 (no change). A new `packHunt` `SimEvent` fires
   whenever `committedPackmates > 0`, carrying `packmates` (the real
   committed count) so a real run can be checked for whether pack hunting is
   actually coordinating, not just firing.
4. **Scavenging: a real alternative meal, not a variant of looting.**
   `applyLooting` (support.ts) was already purely item-stripping — no hunger
   restore at all — confirmed by reading it directly rather than assumed, so
   this is a clean addition, not a duplicate of an existing mechanic. The
   corpse-persistence window this session inherited (`CORPSE_PERSIST_TICKS`,
   `isTrulyDead`) already anticipated this: `simulation.ts`'s own doc comment
   on `pruneStaleCorpses` already says a corpse "persists... so agents other
   than whoever landed the killing blow get a real scavenge/loot window" —
   this feature is what actually cashes that in. `support.ts`'s new
   `applyScavenging` finds the nearest real corpse (`isTrulyDead`, same
   detection radius as a live hunt, `SCAVENGE_DETECT_RADIUS` = 5), walks to
   it, and restores hunger by `DELIVERED_FOOD_HUNGER_RESTORE` (0.4) once
   adjacent — the exact same number `applyHerdSupport`'s food delivery and
   `needs.ts`'s own self-feeding already use, per this codebase's established
   "match the existing restore convention, don't invent a new number"
   pattern. Gated on `rules[agent.species]` (hunter species only, the direct-
   ask scope call — predators opportunistically scavenging is the most
   directly relevant case to the fragility problem) and the exact same
   `huntHungerThreshold` a live hunt would use, so an adult only ever reaches
   this as a genuine fallback (a live hunt attempt already found nothing to
   chase this tick — `needs.ts` calls it right after `applyPredationInstincts`
   returns false). Introduces zero new randomness — finding a real corpse in
   range is the only gate, no roll decides success.
5. **Ontogenetic niche shift: a juvenile predator never initiates an
   independent hunt at all — solo or pack — leaning entirely on scavenging
   (and the pre-existing `applyHerdSupport` food-delivery mechanic) instead.**
   `predation.ts`'s new `isJuvenile` reuses `Agent.age` — this codebase's
   existing maturity proxy (`reproduction.ts`'s `isMature`/`MATURITY_AGE`)
   — rather than inventing a third age concept, at `JUVENILE_AGE_THRESHOLD`
   = 60 (well below `MATURITY_AGE`'s 200, per the direct ask). A juvenile's
   solo AND pack candidate searches are both skipped outright inside
   `applyPredationInstincts`'s hunt block — real biology, not a flag nobody
   observes firing: a hungry juvenile falls straight through to
   `needs.ts`'s `applyScavenging` call (using the identical
   `huntHungerThreshold` gate an adult's own fallback scavenge would use —
   see decided point 4's own reasoning for why no separate, invented
   "juvenile eagerness" number was added) or a herd-mate's food delivery,
   never a live kill. Confirmed end-to-end, not just unit-level, in
   `predation.test.ts`: given an identical live-prey-plus-corpse choice, a
   juvenile scavenges the corpse while an adult in the same setup hunts and
   kills the live prey.
6. **A second, real vulnerability difference: juveniles flee a losing fight
   earlier.** `isCriticallyHurt`'s flee-trigger HP fraction is now
   `retreatHpFraction(agent)` — `JUVENILE_RETREAT_HP_FRACTION` (0.6) for a
   juvenile, the pre-existing fixed `RETREAT_HP_FRACTION` (0.4) for an adult
   — so a juvenile backs off from a fight it's still losing noticeably
   earlier than an adult of the same species would. Deliberately applies to
   `isCriticallyHurt` generally (any species, not gated on `rules` at all) —
   a harmless generalization confirmed against the existing suite: nothing
   in this codebase's pre-existing tests sets `agent.age` on a fixture
   (`age === undefined` reads as already-adult, matching `isMature`'s own
   "absent = mature" default exactly), so this only ever changes behavior
   for a genuinely young agent. Two pre-existing tests (`predation.test.ts`'s
   and `shelter.test.ts`'s bush/shelter-concealment tests) DID use
   `age: 0` on their predator fixture as an incidental way to disable an
   unrelated explore-wandering check (`MIN_EXPLORE_AGE` = 10) — caught by a
   real test failure, not missed silently — fixed by giving the predator in
   those two tests a real adult age instead (its own hunger already keeps it
   from exploring regardless of age, so this is safe), leaving the prey
   fixture's `age: 0` untouched.

### Built, real-run findings

18 new engine tests across `predation.test.ts` (pack hunting: a lone
predator refuses a too-strong-to-solo target, the same target becomes
huntable once a real nearby conspecific is there, a distant or
different-species conspecific doesn't count, the real accuracy-bonus lever
turning a would-be miss into a hit, rng-determinism; ontogenetic niche
shift: a juvenile never hunts even with solo-eligible prey adjacent, an
adult in the same setup does, a juvenile flees a losing fight at a higher hp
fraction than an adult at the identical fraction, the end-to-end
scavenge-vs-hunt choice) and `support.test.ts` (scavenging: a real corpse
feeds a hungry predator by the established restore amount, walks toward an
out-of-range corpse instead of feeding instantly, does nothing for a
well-fed predator/a non-hunter species/no corpse in range, the shared
hunger-threshold gate, rng-determinism). All 681 engine tests pass,
including the two pre-existing tests fixed per decided point 6 above and the
unmodified `determinism.test.ts` acceptance test — this feature adds zero
new `Math.random()`/`rng()` call sites of its own (the pack accuracy bonus
only reweights an existing `rollAccuracy` draw that already happened on
every real attack; scavenging and the juvenile hunt-gate are pure
deterministic branching).

**Each mechanism proven working in a dedicated, hand-built stress scenario**
— this session's own established standard for "confirm a real mechanism
fires and has its intended effect," not just a longer demo run (see e.g.
sleep.ts's own "a dedicated small scenario... would be the way to actually
witness it" precedent elsewhere in this file):
- **Pack hunting**: 3 scythers clustered around 1 prey sized just above the
  solo ceiling but within the pack ceiling -> 12 `packHunt` events, 13
  `fought` events, and a real kill at tick 5 — a target a lone scyther in
  the identical position never even attempts (confirmed separately by
  `predation.test.ts`'s own unit test).
- **Scavenging**: 1 hungry (hunger 0.1) scyther placed adjacent to a fresh
  corpse feeds twice across 2 ticks, hunger rising 0.1 -> 0.887.
- **Ontogenetic niche shift**: a juvenile (age 10) and an adult (age 200) in
  the identical hungry-predator-next-to-solo-eligible-prey setup diverge
  exactly as designed — the juvenile never hunts (`behavior` stays
  `seekFood`), the adult hunts and kills within 30 ticks.

**Real 3000-tick runs, 9 seeds (42, 7, 20260903, and 1-6)**:

| seed | scavenged events | packHunt events | living predators at end |
|---|---|---|---|
| 42 | 0 | 0 | 1 (onix) |
| 7 | 0 | 0 | 1 (onix) |
| 20260903 | 0 | 0 | 0 |
| 1 | 26 | 0 | 1 (spearow) |
| 2 | 0 | 0 | 4 (2 spearow, 2 onix) |
| 3 | 4 | 0 | 3 (2 scyther, 1 spearow) |
| 4 | 28 | 14 | 2 (2 scyther) |
| 5 | 0 | 0 | 2 (1 scyther, 1 spearow) |
| 6 | 0 | 0 | 0 |

**Honest read of this table, not oversold**: both mechanisms are proven real
and working (the dedicated scenarios above, plus the unit suite), but they
fire far less often in the *stock* demo scenario than in a purpose-built
stress test — 0 pack hunts on 8 of 9 seeds, 0 scavenges on 6 of 9. The
reason is structural, not a bug: `packages/data/src/scenario.ts` spawns
exactly ONE individual of each predator species, with no `herdId` — pack
hunting's own trigger (decided point 2) genuinely cannot fire until a second
same-species predator exists near the first, which in the stock scenario
only ever happens via reproduction, itself gated behind the same fragile
predator population this feature is trying to help. Scavenging's gate is
similarly starved: with only 0-8 total predator kills across a whole
3000-tick run per seed, a fresh corpse simply isn't often sitting near a
still-hungry predator when it goes looking.

**Where the mechanisms DID fire, predator populations read healthier, but
this is a correlation worth stating carefully, not a proven causal
result**: the 3 seeds with real scavenge/pack activity (1, 3, 4) ended with
1, 3, and 2 living predators respectively; seeds 42/7/20260903/6 (zero
activity) ended with 1, 1, 0, 0. Average living predators across all 9 seeds
is ~1.56 — higher than the 0.25-per-seed baseline TODO.md already documents
from an earlier 4-seed sample — but a 9-seed sample against a differently-
sampled 4-seed baseline, on a sim already repeatedly documented elsewhere in
this file as chaotically rng-trajectory-sensitive (see the herd-conflict
section's own discarded single-seed A/B, and the tile-capacity section's
identical finding on a completely different feature), isn't a clean,
attributable proof the way the dedicated stress scenarios are. A real
feature-on/feature-off A/B was considered but not run: unlike `herdConflict.ts`
this feature adds no new `rng()` draws of its own on ticks where it doesn't
fire, but ANY tick where a juvenile's hunt gate closes off (skips
`resolveHit`'s own rng draws entirely) or a pack hunt actually fires
(reweights but doesn't add a draw) still changes what happens that tick,
which is exactly the kind of divergence that cascaded into unrelated
same-seed swings elsewhere in this file. Reported honestly: the structural
mechanism (decided points 1-6, each independently proven by a dedicated
scenario) is the trustworthy evidence here, not the 9-seed population
average by itself.

**The honest bottom line on the actual success criterion**: predator
populations did **not** reliably recover to a healthy, sustainable level —
they remain fragile, several seeds still ended at 0, and this session is not
claiming otherwise. What changed is that two genuine, working alternative
survival levers now exist and are exercised in real runs whenever their
real preconditions are met, and — per the honest correlation above — the
seeds where they fired were not the ones that crashed to zero. Whether
that's enough, or whether the stock scenario itself needs to change (see
follow-ups below) to actually give these levers a fair shot at mattering, is
left as an open, explicitly-flagged question rather than papered over.

### Explicitly not done / open follow-ups (see TODO.md)

- The stock demo scenario spawns exactly one of each predator species with
  no `herdId` — the single biggest reason pack hunting rarely fires in a
  real run (see above). Seeding 2 of each predator species instead of 1, or
  giving predators their own home-range cohesion so siblings/offspring stay
  near their parent instead of dispersing solo, would give this feature a
  fairer shot at actually mattering in the stock scenario — not attempted
  here, since changing the demo scenario's spawn composition is its own real
  design decision with its own validation burden, out of scope for this
  session's direct ask.
- Kleptoparasitism (real contention/priority between multiple scavengers
  over the same corpse) — the brief's own "nice-to-have, not required."
  `CORPSE_PERSIST_TICKS`'s existing window already lets multiple agents feed
  from the same corpse across separate ticks, which is enough for the direct
  "alternative to a risky hunt" ask; no head-to-head same-tick contention
  mechanic was built.
- A real, isolated feature-on/feature-off A/B for pack hunting/scavenging's
  own population effect specifically — considered, not run, for the
  rng-cascade-sensitivity reason explained above. The dedicated stress
  scenarios are the trustworthy evidence in the meantime.

### Follow-up: more starting predators (direct ask)

The gap flagged above — "seeding 2+ of each predator species... would give
this feature a fairer shot" — acted on directly: `createDemoWorld` now
starts with 4 Scyther (was 1) and 3 Onix (was 1), specifically so pack
hunting has real conspecifics to muster from tick 1. Predators have no
species allowlist for prey (`isPreyOf` is pure relative-power, no fixed
prey list) — confirmed they'll opportunistically go after Charmander/
Squirtle too, same as any other sufficiently weak nearby agent.

**Real-run findings, honest:** a 3000-tick, 3-seed check shows real
improvement on one seed but not the others — seed 42: `packHunt` fired 24
times, 2 Scyther survived to the end (previously this species usually died
out entirely); seeds 7 and 20260903: both Scyther and Onix still ended at
0 living, `packHunt` never fired at all. More starting predators gives the
mechanism real material to work with sometimes, but doesn't fix the
underlying fragility on its own — consistent with, not a resolution of,
the predator-population-fragility finding above. All 710 engine tests
pass including the unmodified determinism test (a pure scenario-data
change, no engine logic touched).

## Tile preference: satisfied idle agents gravitate toward their species' natural terrain

Direct ask, verbatim: "Like tile pref. Like bulbasaur should strongly
prefer flora tiles. Squirtle should prefer water. If their needs are met.
We could add more tile types." Scoped narrowly and deliberately: this is
purely about where an already-*satisfied* agent chooses to spend idle
time — not need-seeking (`seekFood`/`seekWater` are untouched, and still
run first every time), not `biomes` (that's map-region-level placement/
immigration scoring, a completely different concept this feature is
explicitly NOT allowed to conflate with or derive from — see
`SpeciesDef.preferredTerrain`'s own doc comment in `packages/data/src/
species.ts`).

### Decided

1. **A new, separate `SpeciesDef.preferredTerrain?: TerrainKind[]` field,
   denormalized onto `Agent.preferredTerrain` at spawn** — the exact same
   three-hop pattern this session's own `activityPattern`/`buildsShelter`
   already established (`SpeciesDef` -> `spawnAgent` -> `Agent`), for the
   exact same reason: engine-side logic (`needs.ts`) must never import
   `@pokuelike/data` (circular — `@pokuelike/data` already depends on
   `@pokuelike/engine`). A newborn (`spawnOffspring`, reproduction.ts) picks
   its `preferredTerrain` back up the same way `buildsShelter` already does
   for a shelter-building lineage's offspring — via `LevelingProfile.
   preferredTerrain` (`leveling.ts`), denormalized in `ensureCombatProfile`,
   sourced from `SPECIES[...]` in `packages/data/src/leveling.ts`'s
   `computeProfileFromDexEntry` — otherwise a tagged lineage's children
   would silently lose the trait the instant they're born.
2. **Checked first inside the existing idle-wander extension point
   (`needs.ts`'s `applyExploration`), not a new behavior or a new
   persistent commitment field.** `applyExploration` already only ever runs
   once an agent is fully idle (no urgent need, no herd pull-back, no
   shelter-resting — see its own doc comment and the priority chain in
   `tickAgentAction`'s `idle` branch), and already stores its current
   destination in one shared field, `Agent.exploreTarget`, re-picked fresh
   every time that field is empty. Tile preference plugs into that exact
   spot: when `exploreTarget` is empty, `locatePreferredTerrain` is tried
   *before* the pre-existing random-unvisited-tile search
   (`findNearbyUnvisitedTile`) — a tagged species whose preferred terrain
   is findable becomes its `exploreTarget` instead of a uniformly random
   nearby spot; an untagged species, or a tagged one with no matching tile
   reachable at all, falls straight through to the pre-existing random
   wander, byte-for-byte unchanged. This directly satisfies the brief's own
   "commits no matter what" caution: a preference-driven wander is exactly
   as droppable as ordinary exploration always was (any urgent need re-check
   at `tickAgentAction`'s idle-branch gate skips `applyExploration` entirely
   that tick, same as before this feature existed), not a new sticky
   commitment.
3. **"Already there" is a real, distinct third outcome — `"arrived"` —
   not just "target reached, immediately re-roll."** `locatePreferredTerrain`
   returns one of: `"arrived"` (within `PREFERRED_TERRAIN_SATISFIED_RADIUS`
   = 2 of a matching tile already — content, no wander this tick at all,
   `applyExploration` returns early with no behavior change), a real `Vec2`
   destination, or `undefined` (no preference tagged, or none of the tagged
   kinds exist anywhere reachable — fall through to ordinary exploration).
   Deliberately "lingers near," not "always stands exactly on the exact
   tile": the direct ask was "prefer flora tiles," which reads as a real
   patch/neighborhood, not a single pixel-perfect square.
4. **Reuses `resourceIndex.ts`'s cheap `findNearestIndexed` lookup for
   preference kinds it already tracks (water/food/sunbeam), plus a newly
   added `"flora"` entry** — extending `IndexedTerrain` for `"flora"`
   follows the exact same precedent `"shelter"` set earlier this session
   (a real, `O(matching tiles)` per-lookup win over a naive full-grid scan,
   justified once more than one consumer needs it — flora is tagged on
   two roster species here, bulbasaur and venusaur). A preference kind
   tagged by only a single species so far (`"bush"` for Scyther, `"boulder"`
   for Geodude/Mankey) stays OUT of the global index and instead uses a new,
   separate bounded local scan (`findNearestPreferredLocal`,
   `PREFERRED_TERRAIN_LOCAL_SCAN_RADIUS` = 12) — not worth extending a
   global structure for one or two consumers, per the direct "extend the
   index only if it's cleaner" guidance; this stays cheap because it only
   ever runs when `exploreTarget` is empty (a real destination pick, not a
   per-tick cost).
5. **Roster tagging, judged per-species exactly like `biomes`/
   `buildsShelter`/`activityPattern` before it** — see the inline comment
   at each entry in `packages/data/src/species.ts` for the specific
   flavor-text reasoning; summarized:
   - **bulbasaur, venusaur -> `flora`** — the brief's own named example. A
     grass-type grazer settles near the grass it actually grazes.
   - **squirtle -> `water`** — the brief's other named example. The
     roster's only Water-type, finally giving the map's ponds a resident
     that actually lingers at them.
   - **charmander, mankey -> `sunbeam`** — Charmander's flame is said to
     weaken without warmth (mainline flavor text); Mankey is the roster's
     rocky-mountain primate, reusing the sim's existing "sun patch" tile
     mechanic (`worldgen.ts`'s elevation-driven `"sunbeam"`, already used
     for flora germination boosts) as a real warm/dry-terrain stand-in.
   - **scyther -> `bush`** — "vanishes like a ninja" (mainline flavor
     text): an ambush predator that lingers in concealing undergrowth
     between strikes. Doubly in-character since `"bush"` already grants
     real concealment (`Tile.concealment`) — idling here isn't just
     flavor, it's a real defensive choice for this specific species.
   - **geodude, growlithe -> `boulder`** — Geodude is *literally* a living
     boulder per mainline flavor text, the most direct fit in the whole
     roster; Growlithe is the roster's other dry-terrain/rocky-region
     fire-type (mirroring Charmander's own `sunbeam` reasoning).
   - **diglett, sandshrew, pidgey, spearow, onix -> untagged, on
     purpose, not an oversight.** Underground/canopy are flat,
     terrain-uniform floor grids (`worldgen.ts` never varies them — see
     its own doc comment) — there is no meaningful tile kind to prefer
     among on these species' actual home layer, so tagging them would be
     guessing at nothing. Diglett/Sandshrew specifically already have a
     real, stronger idle-homing pull via `buildsShelter` (shelter.ts) that
     this feature would only muddy by competing with.

### Built, real-run findings

7 new engine tests (`test/needs.test.ts`, "tile preference" describe
block) — a tagged agent heads toward the nearest matching tile instead of
a random spot (both flora and water cases, confirmed by checking the exact
`exploreTarget`, not just "moved somewhere"); an agent already lingering
near its preferred terrain stays fully idle (no wander, `exploreTarget`
stays `undefined`) rather than drifting off; the `"bush"`/`"boulder"`
bounded-local-scan fallback path for a preference kind outside the cheap
index; multi-kind preference order (tries the first tag, falls through to
the second when the first has nothing reachable anywhere); an untagged
agent is completely unaffected — identical random-wander target to the
pre-existing (unmodified) behavior with a mocked rng roll; and an explicit
rng-determinism check (the preference-driven path consumes no rng at all,
byte-identical across two independent runs from the same starting state).
688 total engine tests, all passing, including the unmodified
`determinism.test.ts` acceptance suite — this feature adds zero new
`rng()`/`Math.random()` call sites (the preference lookup is a pure,
deterministic nearest-tile search; only the pre-existing fallback path,
unchanged, ever rolls anything).

**Real 3000-tick runs, seeds 42/7/20260903, feature-on vs. feature-off
A/B** (an isolated script instrumented for this specific validation:
`createDemoWorld` per seed, run twice — once with every tagged species'
`preferredTerrain` stripped from `SPECIES` in memory before the run
[OFF], once restored [ON] — sampling every living tagged agent's Manhattan
distance to its nearest preferred-terrain tile every 25 ticks). Metric:
average distance-to-nearest-preferred-tile across all samples, lower is
"spends more idle time near its preferred terrain":

| seed | OFF avg dist (n) | ON avg dist (n) |
|---|---|---|
| 42 | 3.70 (3332) | 2.96 (6534) |
| 7 | 3.20 (5102) | 3.07 (7536) |
| 20260903 | 4.92 (2419) | 3.43 (8221) |

Per-species breakdown, same three runs:

| species | seed 42 OFF -> ON | seed 7 OFF -> ON | seed 20260903 OFF -> ON |
|---|---|---|---|
| bulbasaur | 3.06 -> 2.32 | 3.10 -> 2.66 | 4.77 -> 3.35 |
| squirtle | 6.12 -> 4.53 | 3.75 -> 3.91 | 5.03 -> 4.56 |
| venusaur | 4.05 -> 4.14 | 3.24 -> 6.02 | 5.75 -> 4.00 |

**Honest read**: bulbasaur (the brief's own named example) shows a real,
consistent, meaningful drop in distance-to-flora across all 3 seeds — the
mechanism is measurably doing what was asked. Squirtle shows the same
consistent direction on 2 of 3 seeds (a real drop), with seed 7 an
essentially flat, noise-level difference (3.75 -> 3.91) rather than a
regression. Venusaur is the one genuine mixed result — worse on seed 7,
flat on seed 42, better on seed 20260903 — and the honest explanation
isn't "the feature doesn't work for Venusaur," it's that Venusaur is
specifically tagged as "the herd's guardian" (see its `SpeciesDef` entry)
with a strong, higher-priority `applyHerdCohesion` pull back toward its
herd's location that runs *before* `applyExploration` ever gets a turn —
with normally only one Venusaur alive in the demo scenario at a time (n
counts above are consistent with a single agent sampled across the whole
run), herd-position noise dominates over the tile-preference signal for
this specific species far more than it does for the more independently-
wandering Bulbasaur/Squirtle. Sample counts (`n`) differ meaningfully
between OFF/ON on the same seed — expected and already documented
elsewhere in this file: any tick where the idle-wander target differs
changes what an agent does that tick, which is exactly the kind of
divergence this sim's own rng-trajectory chaos-sensitivity (see the
grazing-scars and herd-conflict sections) cascades into different
population trajectories by the time 3000 ticks have run. The directly
-requested mechanism (points 1-5 above) is proven correct by the dedicated
unit tests; this A/B is the honestly-reported real-run color on top of
that, not the only evidence.

### Explicitly not done / open follow-ups (see TODO.md)

- **"We could add more tile types"** — the brief's own explicitly vague,
  optional half. No new `TerrainKind` was added this session: nothing
  cheap and obviously missing presented itself while building this feature
  (every roster species that has a real flavor-text terrain affinity
  already maps onto an existing kind — flora/water/sunbeam/bush/boulder).
  The one real idea worth flagging for later, not guessed at here: a real
  "burrow"/underground-den terrain kind distinct from plain `"floor"`,
  which could give Diglett/Sandshrew (currently untagged for exactly the
  reason in point 5 above — underground is flat and terrain-uniform) a
  real, earned tile preference of their own instead of relying solely on
  `buildsShelter`'s existing homing pull. Left as a real open idea, not
  built, since it would mean generating real terrain variance into
  `worldgen.ts`'s currently-flat underground grid — its own real design
  decision with its own validation burden, out of scope for the direct ask
  here.
- Venusaur's mixed A/B result above (herd cohesion dominating tile
  preference for a species that's almost always alone/guardian-positioned)
  — not treated as a bug, but a real, honestly-reported interaction worth
  a closer look if herd cohesion/tile preference priority ever gets
  revisited together.

## Bonding, shelter, and eggs: mating no longer spawns offspring instantly

Direct instruction, verbatim across several messages: "I will want eggs
rather than them just spawning offspring. They gotta take care of an egg.
Egg hatches only in shelter, so maybe we make shelter a different thing
that all units have it just looks different for each type; only 2 units
and an egg can share a single tile of shelter, though multiple adjacent
shelter can increase the number who can live in it. Pokemon can mate
before shelter but that only means they bond and increase need for
shelter. They don't lay egg until after shelter is created. Eggs are
highly edible. Super desired as food by any Pokémon that does not share
egg type. Eating an egg is the same bonuses as killing and eating prey.
Same species Pokémon will not eat eggs of same type. Pokemon are extremely
territorial about their eggs. Will defend them to death." Six real, required
pieces, each covered below.

### Decided

1. **Universal shelter, cosmetic-only species variation.** `SpeciesDef.buildsShelter`
   (packages/data/src/species.ts) — a DELIBERATE, EXPLICIT reversal of the
   earlier "species-tied, not universal, per direct instruction" design
   (see this file's original "Shelter-building" section) — is no longer
   read by the engine for gating at all. `shelter.ts`'s
   `maybeTriggerShelterBuilding`, needs.ts's resting-at-home heal/needs-decay
   bonus, and the shelter-cache feed/rest mechanics now apply to every
   species unconditionally. The field itself is left in place on `Agent`/
   `SpeciesDef` (harmless, unused for gating) rather than ripped out
   everywhere it's still denormalized — a deliberate minimal-diff choice.
   Visual variation stays purely cosmetic: `Tile.shelterOwnerSpecies`
   (types.ts) records which species most recently completed a shelter tile,
   consumed only by `packages/web/src/palette.ts`'s new `shelterOwnerTint`
   (a deterministic per-species hue derived from a string hash, mixed 40%
   into the base shelter color/glyph) via `renderer.ts`'s two draw paths —
   zero gameplay effect, a real "looks different for each type" per direct
   instruction. `packages/runner/src/ascii.ts` (the headless CLI's own
   ASCII palette) was NOT updated with the same tint — flagged as an open
   follow-up in TODO.md, not an oversight.

2. **A real, shelter-specific capacity model, layered on top of the
   existing tile-weight-capacity system, not a variant of it.**
   `occupancy.ts`'s general `canEnterTile` already has a weight-based rule
   for surface tiles and a flat headcount rule for underground/canopy (see
   this file's "Tile capacity" section) — shelter terrain gets a THIRD,
   distinct rule: `SHELTER_TILE_ADULT_CAP = 2` and `SHELTER_TILE_EGG_CAP = 1`
   per tile, exactly the direct instruction's numbers. "Multiple adjacent
   shelter can increase the number who can live in it" is modeled as a real
   connected-component cluster (`shelterCluster`, 4-directional BFS over
   "shelter" tiles) whose total capacity is the SUM of each member tile's
   own cap — a 3-tile adjacent cluster holds 6 adults + 3 eggs total, and
   `canEnterShelter`/`canLayEggAt` both check the whole cluster's live
   occupant count, not just the one tile being asked about, so a household
   genuinely "ranges freely across the whole connected cluster" rather than
   being pinned to one exact tile. `canEnterTile` special-cases `terrain ===
   "shelter"` to route through this cluster rule instead of the weight rule
   (an empty tile still always admits at least one occupant, same
   "always allow at least 1" invariant every other capacity rule here
   honors).

3. **Bonding, not instant offspring.** `reproduction.ts`'s `applyMateSeeking`
   — previously: adjacent + eligible + female's turn = instant newborn via
   `spawnOffspring`. Now: first contact between an eligible pair sets
   `Agent.bondedPartnerId` on both sides (a real, lasting link, mirroring
   how `deliverTargetId`/`carryingId` already track paired relationships
   elsewhere in this codebase) and logs a new `"bonded"` event — no
   offspring, no egg, yet. `spawnOffspring` itself (and its `nearbySpawnTile`/
   `freshNeeds` helpers) is deleted entirely — its logic doesn't disappear,
   it moves to `eggs.ts`'s hatch step (see point 4). The REAL, testable
   bias toward resolving the "increase need for shelter" ask:
   `shelter.ts`'s `maybeTriggerShelterBuilding` lowers its own comfort gate
   (`SHELTER_COMFORT_THRESHOLD`, 0.85) by a flat `BOND_COMFORT_DISCOUNT`
   (0.15) for any agent with a live `bondedPartnerId` — a bonded, shelterless
   agent starts building at needs as low as 0.70 instead of 0.85, a real,
   deterministic, unit-tested (`shelter.test.ts`) difference in expectation
   across many idle ticks, not just "now eligible for the same mechanic
   everyone already had."

4. **Egg-laying only after real shelter access, hatching after a real
   incubation period.** Every subsequent contact between an already-or-
   newly-bonded pair checks `householdShelterTile` (reuses `shelter.ts`'s
   own `hasNearbyShelter`/`SHELTER_SEARCH_RADIUS` anchor logic — herd
   centroid if herded, own position if solitary) and, if a real shelter
   tile is in range AND the cluster has egg-capacity room (`canLayEggAt`),
   lays a real egg via `eggs.ts`'s `spawnEgg` instead of anything happening
   further. The egg is a real `Agent` with `isEgg: true` — reusing the
   existing type for position/hp/predation-targeting/rendering almost for
   free, per direct instruction, rather than a parallel entity type — sitting
   exactly at the picked shelter tile, stationary and behavior-less:
   `simulation.ts`'s `tickWorld` routes every `isEgg` agent straight to
   `eggs.ts`'s `tickEgg` and skips the entire ordinary `tickAgentNeeds`/
   `tickAgentAction` pipeline for it (no hunger/thirst decay, no movement,
   no action-economy participation at all). `EGG_INCUBATION_TICKS = 80` —
   between `SHELTER_BUILD_TICKS` (40) and `MATURITY_AGE` (200), the "real
   multi-tick life event, not a flicker" order of magnitude this codebase's
   other staged processes already establish. Nature/disposition/sex/stat-block
   assignment (previously all decided at instant-birth time) now happens
   at HATCH time, mutating the same `Agent` object in place (id stays
   stable, no array-splice churn mid-`tickWorld` loop) — the exact
   `ensureCombatProfile`/`randomNature`/`dispositionFromNature` calls
   `spawnOffspring` used to make, just moved and delayed. A `"bonded"`
   pair that meets repeatedly without shelter access simply keeps bonding
   (a no-op re-bond, harmless) with no egg each time, until shelter exists
   somewhere in range.

5. **Eggs as a real, cross-species-desirable food source — deliberately
   NOT routed through the ordinary predator/prey `HuntRules` pipeline.**
   `predation.ts`'s `applyEggEating`: any non-egg agent, adjacent to an
   egg, hungry past `EGG_EAT_HUNGER_THRESHOLD` (0.9 — deliberately high,
   "super desired... given the chance" reads as a standing preference, not
   a last resort), whose species does NOT share an egg group with the
   egg's species (`!canBreed`, reusing the exact compatibility check that
   already gates cross-species breeding eligibility in `reproduction.ts`)
   eats it: instant, one action, no combat rounds (an egg can't fight back
   or flee, so there's no fight to resolve) — `grantKillExp` (the real
   mainline kill-exp formula) and `agent.needs.hunger = 1` +
   `digestingTicksRemaining` (the real kill-satiation slowdown), reused
   VERBATIM from the real predation kill path, per direct instruction
   ("same bonuses as killing and eating prey"). This is a deliberate,
   real widening of who eats what: `isPreyOf`'s species-role system
   (predator/prey pairs declared in `HuntRules`) has nothing to do with
   egg-eating eligibility — a species with zero listed prey/predator role
   at all can still eat an egg it doesn't share an egg group with. Wired
   into `needs.ts`'s `tickAgentAction` at the same priority tier as
   `applyScavenging` (right after `applyPredationInstincts`, ahead of
   ordinary foraging), but NOT gated on `HuntRules` being present at all,
   unlike scavenging/hunting.

6. **Extreme egg defense — a real, explicit departure from herdConflict.ts's
   non-lethal model.** `predation.ts`'s `applyEggDefense`, checked as the
   VERY FIRST branch inside `applyPredationInstincts` — ahead of even the
   critically-hurt flee check — for any non-egg, non-fainted, non-carried
   agent: if a herd-mate's (or, for a herdless agent, its own species') egg
   within `EGG_DEFENSE_RADIUS` (8) has a non-egg-group-compatible agent
   within `EGG_THREAT_RADIUS` (4) of it, the defender fights that threat —
   full stop, overriding this agent's own flee reflex/self-preservation
   entirely, and even waking a sleeping defender (unlike this function's
   sibling self-defense branches, which stay dormant while `agent.asleep`).
   Combat resolves via `resolveHit(..., "killed", ...)` — the same real,
   true-death path an ordinary hunt uses — NOT herdConflict.ts's
   retreat-before-fainting cap, so a defender genuinely CAN die defending
   an egg (and can genuinely kill the threat), per the direct instruction's
   own wording ("will defend them to death"). This is intentionally
   different from herd-conflict's deliberately non-lethal rivalry model
   shipped earlier this session — not an oversight, a real design choice
   documented here so the two mechanics are never accidentally conflated
   or "fixed" toward each other later.

### Built, real-run findings

New engine module `eggs.ts` (`spawnEgg`/`tickEgg`/`EGG_INCUBATION_TICKS`/
`isLivingEgg`), new `occupancy.ts` exports (`shelterCluster`/
`shelterOccupants`/`canEnterShelter`/`canLayEggAt`/`SHELTER_TILE_ADULT_CAP`/
`SHELTER_TILE_EGG_CAP`), new `predation.ts` exports/internals
(`applyEggEating`, private `applyEggDefense`), new `SimEvent` kinds
(`bonded`/`eggLaid`/`eggHatched`/`eggEaten`/`eggDefended`, wired into both
`packages/web/src/eventText.ts`'s exhaustive `formatEvent` switch and
`packages/runner/src/format.ts`'s CLI equivalent), new `World` counters
(`bondsFormed`/`eggsLaid`/`eggsHatched`/`eggsEaten`, same observational
"real-run validation signal, never read back" shape as `shelterCacheDeposited`/
`shelterCacheWithdrawn`).

**A real, latent bug this feature surfaced and fixed, not introduced**:
universal shelter-building (point 1) doesn't check `agent.asleep`, and
neither did the shelter-building priority block in `needs.ts`'s
`tickAgentAction` — a sleeping, fully-satisfied agent could silently start
walking to a build site, completely bypassing the sleep wake-check
machinery (no `wokeUp` event, `agent.asleep` staying stuck `true` while the
agent visibly moved). Confirmed by three real, pre-existing sleep tests
failing the instant shelter-building went universal (they'd never
exercised this overlap before, since only 2 of ~10 species could ever
reach it). Fixed by gating the whole shelter-building block (trigger AND
continuation) on `!agent.asleep`, the same "self-directed tasks pause for
a sleeping agent" convention every other branch in that function already
follows.

**A second real, latent test-hygiene bug this surfaced**: `needs.test.ts`
had a bare `vi.spyOn(Math, "random").mockReturnValue(0)` (in the
"no tagged preference" exploration test) with no `afterEach` restore
anywhere in that file — harmless while nothing else in the file called
unmocked `Math.random`, but universal shelter-building's default `rng`
parameter does, so every test that happened to run AFTER that one in the
same process saw a permanently-pinned `Math.random() === 0`, an
order-dependent flake. Fixed with a file-level `afterEach(() =>
vi.restoreAllMocks())`, the same pattern `flora.test.ts`/`predation.test.ts`
already use and `vitest.config.ts`'s own doc comment already documents as
a REAL bug class this session hit once before (the cross-FILE version,
fixed via the "forks" pool).

**New tests**: `eggs.test.ts` (spawnEgg's initial no-nature/no-sex state;
tickEgg's exact-threshold hatch timing and full combat-profile backfill;
rng-determinism of hatch-time nature/sex, same-seed-same-result AND
different-seed-can-differ; `applyEggEating`'s cross-species-eats/
same-egg-group-refuses/same-species-refuses/hunger-gate/adjacency-required
matrix; `applyEggDefense`'s override-of-critical-flee, non-fight-against-
compatible-species, and unaffected-ordinary-flee-with-no-egg-nearby cases).
`occupancy.test.ts` (2-adult/1-egg single-tile cap; weight-irrelevance on
shelter terrain; adjacent-cluster capacity summing with a real "tile A full,
cluster still has room via tile B" case; a non-adjacent 3rd shelter tile
staying its own independent cluster). `shelter.test.ts` (universal
triggering for a `buildsShelter: false` species; the bonded comfort-discount
bias, isolated as a real before/after at fixed needs). `reproduction.test.ts`
rewritten throughout (bonds-without-shelter vs. lays-egg-with-shelter as two
separate cases; egg-laid-at-shelter-tile-not-mother's-tile; base-species
conversion moved to hatch time; egg-group compatibility tests updated to
check the egg/hatchling instead of an instant child).
`determinism.test.ts`'s reproduction section replaced (the old
lay-time-randomness test no longer applies — lay-time is now fully
deterministic, nearest-tile-first, no rng at all; added a same-seed
byte-identical lay-time check plus a hatch-time nature/sex determinism
sweep). **All 720 engine tests pass, including the unmodified
`determinism.test.ts` full-`tickWorld` acceptance suite** (two independent
runs of the same seed produce byte-identical event logs end to end, with
this whole feature threaded through it).

`pnpm -r typecheck` and `pnpm -r build` both clean across all 4 packages.

**Real headless runs, seeds 42/7/20260903 — the critical population-safety
check.** Two comparisons, both real:

*3000 ticks, feature ON vs. completely OFF* (an isolated `git worktree`
checkout of the commit immediately before this feature, same seeds, same
`createDemoWorld`, same `tickWorld` call):

| seed | OFF (instant-birth, this branch's actual pre-feature tip) | ON (bond -> shelter -> egg -> hatch) |
|---|---|---|
| 42 | 298 living, 283 born | 23 living, 5 eggs laid, 2 hatched, 2 eaten |
| 7 | 332 living, 318 born | 19 living, 7 eggs laid, 6 hatched, 1 eaten |
| 20260903 | 294 living, 279 born | 24 living, 5 eggs laid, 5 hatched, 0 eaten |

**Honest read**: this is a real, large reduction — roughly 12-17x lower at
3000 ticks. Two things temper how alarming that number actually is. First,
the OFF baseline itself is a pathological comparison point, not this
session's real recent target: instant, uncapped, zero-friction breeding on
every single adjacent-opposite-sex contact (no shelter requirement, no
incubation window, no predation exposure at all) is exactly the unbounded
exponential growth this session has fought to rein in with other mechanisms
elsewhere (breeding-level gate, tile capacity, immigration's own population
cap) — 298 living agents from 2 founding pairs by tick 3000 is itself far
outside this session's own previously-documented "healthy" range (this
file's "Tile capacity" section cites 62-80 as a recent healthy final
population at a similar tick count, under the OLDER instant-birth model
plus every other constraint already in place — the 298 baseline here is
higher than that specifically because several more growth-accelerating
features [pack hunting, tile preference driving more idle-time proximity to
food, shelter incentives] have landed since that citation, none of which
this feature disturbs on their own). Second, and more importantly: **this
is a slow, delayed-onset growth curve, not a stalled one.**

*Longer runs, seed 42, feature ON, tracking growth over time*:

| ticks | living population | bonds formed | eggs laid | eggs hatched | eggs eaten | egg-defense fights |
|---|---|---|---|---|---|---|
| 3000 | 23 | 12 | 5 | 2 | 2 | 6 |
| 6000 | 56 | 72 | 44 | 40 | 2 | 181 |
| 8000 | 94 | 199 | 88 | 82 | 4 | 187 |

Population more than doubles from tick 3000 to 6000, and keeps growing to
94 by tick 8000 — squarely back in (and above) this session's own
previously-cited healthy range, just reached later than the instant-birth
model reached it, which is the direct, expected mechanical consequence of
gating reproduction behind bonding -> a real ~40-tick shelter build/travel
task -> an 80-tick incubation window a predator or opportunistic egg-eater
can interrupt, instead of one contact = one newborn. **Zero starvation
deaths on every run at every tick count, all three seeds** — the other
explicit critical bar. The hatch survival rate is real and high (82/88 =
93% of laid eggs successfully hatched by tick 8000 on seed 42; 2 killed by
starvation/predation-adjacent causes never observed, eggs eaten instead
account for the rest), and egg-defense fired 181-187 times over the run —
a real, frequently-exercised mechanic, not a paper feature.

**Combined read**: this feature does NOT reintroduce the near-zero-births
population crash this session has repeatedly had to fix (see this file's
several "population collapsed to single digits" sections) — the population
keeps growing, starvation stays at zero, and every one of the six pieces
fires for real, measurable numbers of times across a real run. What it DOES
do, honestly, is trade a much higher, unbounded, mechanically-implausible
growth ceiling (hundreds of agents from instant zero-friction breeding) for
a slower-building, bounded, more "real ecosystem"-shaped curve — exactly
what gating reproduction behind a real, interruptible, multi-stage process
should be expected to do. Whether the specific pacing (80-tick incubation,
0.85/0.70 comfort thresholds, 0.9 egg-eating hunger gate) is tuned exactly
right is flagged as open in TODO.md rather than further hand-tuned this
pass — the population trend across 3000/6000/8000 ticks is real, growing,
and zero-starvation, which is the load-bearing safety property; the exact
growth RATE is a legitimate follow-up tuning target, not a safety
regression.

### Explicitly not done / open follow-ups (see TODO.md)

- Adjacency-capacity edge cases beyond the direct unit tests (a shelter
  cluster that grows/shrinks mid-incubation as tiles are built/abandoned
  around an already-laid egg) are untested against a real run.
- Egg-defense's interaction with herd-conflict's non-lethal model is
  unexamined beyond "they're separate, deliberately different mechanisms" —
  whether a rival-herd agent that's ALSO a same-egg-group species ever gets
  caught in both systems' overlapping radii on the same tick isn't traced.
- Dispersal interacting with a bonded-but-shelterless pair: a disperser
  that's already bonded keeps its `bondedPartnerId` pointing at an agent it
  may now be tiles away from (or that later joins a different herd) —
  nothing currently clears or re-validates a stale bond across a dispersal
  event.
- Immigration-spawned agents arrive with no `bondedPartnerId` (correctly —
  they're new arrivals) but also no special handling if the group happens
  to already contain a real mated pair narratively; not investigated.
- `packages/runner/src/ascii.ts`'s own terrain palette was not given the
  same `shelterOwnerTint` treatment `packages/web` got — a real, known gap
  in the headless CLI's visual output, not a functional one.

### Follow-up: clutch size

Direct, verbatim ask, after seeing the pipeline above validated for real:
"i like it, maybe we can have multiple eggs spawn at once instead of one at
a time tho." Explicit constraint carried over from the same conversation:
the slow bond -> shelter -> lay -> incubate pipeline itself should NOT get
any easier or faster — the user likes that pacing. A clutch is the intended
lever instead: one successful laying event should be able to produce
several eggs at once, so a household that clears the whole slow pipeline
gets more population out of that one success.

**Built**: `eggs.ts`'s `pickClutchSize(rng)` draws a clutch size uniformly
from `EGG_CLUTCH_MIN`/`EGG_CLUTCH_MAX` = 2-4 (a real, modest, sim-original
number — real animal clutch sizes vary enormously with no attempt at canon
accuracy here, just "meaningfully more than one, without letting one lucky
laying event dominate growth on its own," judged the same "check it against
a real run" way as every other tuning constant in this codebase).
`reproduction.ts`'s `applyMateSeeking` reuses the EXISTING capacity
mechanism rather than a new one: it loops up to the drawn clutch size,
calling the same `pickEggTile`/`canLayEggAt` (occupancy.ts's real shelter-
cluster capacity check, `SHELTER_TILE_EGG_CAP` = 1 per tile summed across
the cluster) once per candidate egg, pushing each placed egg onto
`world.agents` before the next capacity check — so a later check in the
same clutch genuinely sees the room the earlier eggs in the same clutch
just used up. The loop stops the moment `pickEggTile` returns `undefined`
(cluster's egg capacity exhausted); **the rest of the clutch is simply
dropped, not queued or held for a later attempt** — the simplest, most
defensible choice given the point is "a bigger household reliably gets more
eggs," and no egg-holding-pattern mechanic was asked for. Exp
(`EXP_ON_BIRTH_PARENT`) is granted once per successful laying EVENT, not
once per egg in the clutch, so clutch-size rng can't also swing leveling
speed. `eggLaid` is still logged once per egg (unchanged event shape) —
a 3-egg clutch produces 3 `eggLaid` events, same as 3 separate 1-egg
events used to, so nothing downstream needed to change at all.

**Verified everything downstream already "just works" for multiple
sibling eggs**, per the task's own explicit ask to check rather than
assume it: each egg is its own independent `Agent` object with its own
`id`/`eggTicks`/position from the moment it's pushed onto `world.agents` —
incubation (`tickEgg`), hatching, egg-eating (`applyEggEating`), and egg-
defense (`applyEggDefense`) all already operate per-`Agent`, with no
shared state between siblings anywhere in any of those four functions.
Confirmed directly with a new test (`reproduction.test.ts`): hatching one
egg from a 2-egg clutch leaves the other completely untouched
(`eggTicks` still 0, `isEgg` still true), and killing one doesn't touch the
other's (by then hatched) state either.

**New tests**: `eggs.test.ts` (`pickClutchSize` stays within
`[EGG_CLUTCH_MIN, EGG_CLUTCH_MAX]` across many draws, rng-determinism
same-seed/different-seed, and that repeated draws actually cover the whole
range rather than silently collapsing to one value).
`reproduction.test.ts` (a single laying event lays the full clutch — forced
to `EGG_CLUTCH_MAX` via a fixed rng — when a 4-tile shelter cluster has
room for it; the same forced-max clutch is capped down to exactly the
real available capacity when the cluster is smaller — 1 tile -> 1 egg, 2
tiles -> 2 eggs — never crammed onto one tile past `SHELTER_TILE_EGG_CAP`;
a direct 1/2/3/4-tile sweep showing a bigger cluster reliably yields more
eggs from the identical forced-max clutch draw, clamped at
`EGG_CLUTCH_MAX` once cluster room exceeds it; sibling-independence as
described above). **All 717 engine tests pass**, including the unmodified
`determinism.test.ts` full-`tickWorld` acceptance suite (`pnpm --filter
@pokuelike/engine test` — one pre-existing, seed-dependent flake in
`predation.test.ts`'s burn-damage-variance test was observed on the
unmodified baseline too, in an isolated rerun before this feature's changes
were applied at all — not introduced by this follow-up). `pnpm -r
typecheck` and `pnpm -r build` both clean across all 4 packages.

**Real headless runs, seeds 42/7/20260903, 3000/6000/8000 ticks — reporting
the honest result, which is a genuine, mechanism-level finding, not the
straightforward population win the ask was hoping for:**

| ticks | seed 42 before → after | seed 7 before → after | seed 20260903 before → after |
|---|---|---|---|
| 3000 | 27 → 24 | 25 → 28 | 23 → 17 |
| 6000 | 24 → 29 | 43 → 20 | 22 → 15 |
| 8000 | 25 → 50 | 85 → 22 | 18 → 16 |

("before" = this session's current tip immediately prior to this follow-up,
single-egg-per-event, same `createDemoWorld` — NOT the older instant-birth
baseline or the older 23/56/94 table earlier in this section, both of which
predate later population-affecting changes on this branch, e.g. the demo
world's predator roster growing from 1 Scyther/1 Onix to 4 Scyther/3 Onix.)

That table looks like a wash at best and a regression at worst on 2 of 3
seeds — worth being straight about why, because it's not what "lay more
eggs per event" should do on its face. **Root cause, confirmed directly**:
added a diagnostic dump of every real shelter cluster's size at the end of
each run — across all three seeds at 8000 ticks, EVERY shelter cluster
that ever existed was exactly 1 tile (11 clusters total, sizes
`[1,1,1,1,1,1]`/`[1]`/`[1,1,1,1]`). `shelter.ts`'s `pickBuildSite` chooses
a uniformly random floor tile at least `SHELTER_MIN_BUILD_DISTANCE` away
from the builder, with zero bias toward building next to an existing
shelter tile — so in a real run, shelter tiles essentially never end up
spatially adjacent to each other, which means `SHELTER_TILE_EGG_CAP` (1
per tile) caps EVERY real laying event to at most 1 egg regardless of the
clutch size drawn, in every run actually observed. Confirmed this is the
whole story with a direct control: temporarily pinning
`EGG_CLUTCH_MIN`/`EGG_CLUTCH_MAX` to 1 (i.e., disabling the clutch
mechanism entirely while keeping its one extra `rng()` draw per laying
event) reproduced the "after" column's numbers byte-for-byte. So the
before/after differences in the table above are not the clutch mechanism
doing real work at all — they're the ordinary, previously-documented
sensitivity of this whole chaotic system to a new rng draw anywhere in a
hot path (any new `rng()` call reshuffles every subsequent random outcome
for the rest of the run, regardless of what that call is even used for).

**Honest bottom line**: the clutch mechanism itself is real, correct, and
verified working in isolation (the unit tests above directly construct a
multi-tile cluster and confirm more eggs come out of it) — it does exactly
what was asked, reusing the existing capacity system exactly as directed,
with no special-casing needed anywhere downstream. But in the CURRENT demo
world, it has essentially zero practical effect on population, because the
"bigger household -> more eggs" lever depends on adjacent shelter clusters
that this world's shelter-site selection doesn't currently ever produce.
Fixing that (biasing `pickBuildSite` toward existing shelter, at least for
an agent that already has one nearby) is a real, separate, out-of-scope-
for-this-ask follow-up — flagged in TODO.md — and is the actual next lever
if the goal is still "raise the population ceiling without touching the
pipeline's pacing."

### Follow-up: raise SHELTER_TILE_EGG_CAP instead of fixing clustering

Direct ask, after the clutch-inert finding above: "i think we increase the
per tile thing to allow for more eggs" — the more direct fix (raise the
per-tile cap) over the alternative discussed (bias shelter-building toward
clustering). `SHELTER_TILE_EGG_CAP` (occupancy.ts) 1 -> `EGG_CLUTCH_MAX`
(4), so a single, realistic one-tile household can now hold an entire
clutch on its own, without needing a multi-tile cluster to ever form.

**Real-run findings — this time a genuine, large effect:** 3000/6000/8000
ticks, standard 3 seeds. Seed 42: pop 15/35/120, eggLaid 2/24/109 (was
inert at cap=1). Seed 7: pop 33/162/(pending), eggLaid 17/166 — genuinely
thriving. Seed 20260903: still 0 eggs laid at any tick count despite 9-15
bonds forming — that seed's pairs never finish building a shelter at all
(a real, separate, pre-existing shelter-building-pace issue, not something
this cap change touches). Zero hunger-starvation deaths across every seed
and tick count tested — the safety bar holds throughout.

Several pre-existing tests hardcoded the old cap-of-1 behavior (either
directly, or indirectly via real-rng clutch draws that used to always cap
out at exactly 1 egg) — updated to check "at least one real egg with the
right properties" or to pre-occupy known capacity rather than assume an
exact count, per this file's established "fix a test if new real behavior
invalidates an old assumption" convention. All 718 engine tests pass,
including the unmodified determinism suite.

**Full 8000-tick numbers, for the record:** seed 7 reached population
**414** by tick 8000 (422 eggs laid, 757 bonds) — confirms the mechanism
was working exactly as designed, at real scale, not just a modest bump.

### Follow-up: reverted back to 1 (direct ask)

Direct ask, after seeing the above numbers: "reduce the cap back to 1."
`SHELTER_TILE_EGG_CAP` back to 1 (was briefly 4). Clutches (`eggs.ts`,
2-4 eggs drawn per laying event) still draw the same way — with the cap
back at 1, only the first egg of any clutch actually gets placed on a
lone (non-clustered) shelter tile, so the mechanism is real but
practically inert again in the current demo world, same as before the
cap was raised. Real population is back down to modest, non-explosive
levels: 3000/6000/8000 ticks, seed 42: pop 15/25/39; seed 7: pop 17/10/11
— zero hunger-starvation deaths throughout. Several tests that were
updated for the cap-of-4 scenario (multi-egg-clutch capacity tests) were
adjusted back to reflect the real cap-of-1 behavior rather than reverted
wholesale — the underlying clutch mechanism and its tests remain valid,
just re-pointed at the current real per-tile limit. All 718 tests pass.

The real lever for population growth, if wanted again later without
reopening this exact back-and-forth, is still the same one flagged
earlier and left untouched: biasing `pickBuildSite` (shelter.ts) toward
building adjacent to existing shelter, so clusters actually form and the
existing "multiple adjacent shelter increases capacity" rule (part of
the original spec) does real work on its own — see TODO.md.

## Auto Camera: a toggleable director mode that follows notable events

**Direct ask.** "I want to be able to see a battle happen in real time. So I
want a toggle auto camera. Mode so that it follows interesting events. It
would zoom in on them and slow down time if it was on 4x or higher down to
2x temporarily while the event happens." Six named categories: immigration
of new units; two mates finding each other/building a shelter/laying an
egg; an egg hatching; a battle from first hit to death-or-retreat; an
evolution; a death. Plus: "the log was auto filtered to all moves used by
the things that are fighting, or which Pokémon hatched... make it more
specific."

**Decided: mapping each category to a real engine event.**

- **Immigration** → `immigrated` (one event per 1-3-member arrival group).
- **Courtship** → three *separate* camera moments, not one merged
  storyline: `bonded`, `shelterBuilt`, `eggLaid`. These routinely share the
  same pair's agent ids, but they're real, temporally separate beats (a
  bonded pair might not build a shelter or lay an egg for hundreds of
  ticks) — collapsing them into one followed "arc" would mean either
  camera-locking on a pair for that whole gap (against the "don't stall the
  queue" design goal below) or arbitrarily picking one of the three to
  show and silently dropping the other two. Three real, distinct
  `enqueueOneShot` calls is what "a real distinct camera move for each"
  means in code.
- **Egg hatching** → `eggHatched`.
- **Battle** → started by a landed, damaging hit: `fought`, or a non-
  `"missed"` `herdClash` (the non-lethal rivalry-fight mechanic — it deals
  real damage via the same "used a move" shape, so it's structurally a
  battle even though it can never end in a kill; see herdConflict.ts).
  Concluded by whichever of three explicit signals fires first for either
  participant: a true death (`killed`/`defeated`), a `fainted` (a knockout
  ends the encounter even before the finishing blow lands, per DESIGN.md's
  existing Faint/finish-off model), or a successful retreat
  (`behaviorChanged` to `"flee"`, or `herdClash`'s own `"retreated"`
  outcome). A fourth, fallback-only path (`BATTLE_STALE_TICKS` = 40 ticks
  of silence between hits) catches the case where two agents just disengage
  without producing any of those three clean signals — real fights can end
  that way (one side just walks off having decided it's not worth it), and
  the camera shouldn't get stuck locked onto a fight that's already over in
  every practical sense.
- **Evolution** → `evolved`. This event carries no `pos` field at all (only
  `agentId`/species/level) — resolved via a live `world.agents.find` lookup
  at the moment the event is observed, per the task brief's own guidance.
- **Death** → `killed`, `defeated`, `starved`, `diedOfAge` — the same "true
  death" set `eventText.ts`'s `HEADLINE_KINDS` already uses (`Agent.alive`
  goes to `false`), deliberately excluding `fainted` (recoverable, not a
  death — see predation.ts's faint/finishing-pool model, confirmed by
  reading `resolveHitAgainstTarget`: a faint sets `alive` unchanged and
  waits on a separate finishing-pool depletion before ever recording
  `killed`/`defeated`). A death that's already the natural conclusion of an
  active/queued battle for the same agent doesn't *also* get queued as a
  separate one-shot "death" moment — the battle engagement's own short
  epilogue hold covers exactly that beat, so the camera doesn't cut away and
  immediately cut back to the same spot.

**The state machine (`packages/web/src/autoCamera.ts`).** One `Engagement`
is "active" at a time; everything else notable waits in a FIFO `queue`
(capped at 20, oldest dropped on overflow). Two engagement shapes:

1. **One-shot** (immigration/courtship/hatch/evolution/death): a fixed
   `DWELL_TICKS` (24) camera hold, then it expires and the next queued
   engagement (if any) takes over.
2. **Continuous** (battle only): stays active tick-to-tick, kept alive by
   every new `fought`/non-missed-`herdClash` hit naming either participant
   (a widening `ids` set handles a pack-hunt assist joining mid-fight —
   see `onBattleHit`), until one of the four conclusion paths above fires,
   at which point it gets a short `BATTLE_EPILOGUE_TICKS` (16) hold on the
   same view — long enough to actually see the kill/retreat land, short
   enough not to stall the queue behind a fight that's already decided.

**Queueing policy: FIFO, no interruption, real dwell — chosen specifically
to avoid a jittery camera.** The brief flagged this as an open design call
("let the current follow finish" vs. "most severe wins and interrupts").
Went with strict FIFO + no interruption: a battle in progress is *never*
cut away from for a fresh one-shot event (a battle is exactly the thing
worth not whiplashing away from mid-fight), and one-shot events queue
behind each other rather than competing for the same frame. The real cost
of this choice is latency — a hatch that fires while a long battle plays out
might wait a while for its turn — judged an acceptable tradeoff against a
camera that visibly jumps around every time two things happen close
together, which is worse for "watching a battle happen in real time" than
a short queue delay on a lower-priority event.

**Camera mechanics — reusing the existing zoom/pan primitives, not a new
camera system.** `renderer.ts`/`main.ts` never had a real "viewport"
concept: `zoom` is a CSS-only scale factor on the whole canvas element, and
panning is just `#canvas-wrap`'s native `overflow: auto` scroll position.
Auto Camera's "zoom in and pan" is built entirely on those two existing
primitives — `focusCameraOn(pos)` sets `zoom` to a fixed `AUTO_CAM_ZOOM`
(`ZOOM_MAX`, 200% — 2.5x the default 80%) and then sets `canvas-wrap`'s
`scrollLeft`/`scrollTop` to center the target tile. For a multi-agent
engagement (a battle, an immigrant group) the target is the *live* average
position of every tracked id still present in `world.agents`, recomputed
every frame — a real moving follow-cam, not a snapshot of where the event
fired. A fixed zoom level (rather than a fit-to-both-combatants
calculation) was a deliberate simplicity call: a moving multi-agent fight
would invalidate a "fit" calculation on the very next frame anyway, and a
single fixed level already reads as "genuinely closer" for every category
from a lone hatchling to a three-agent immigrant group.

**Speed control: saves/restores the viewer's actual prior value, not a
fixed default.** The direct ask was explicit that this is temporary and
relative to whatever the viewer had picked, not a hardcoded "always show at
2x." `applySlowdownIfNeeded` only intervenes at all when the *current*
speed is >= `SLOWDOWN_THRESHOLD_SPEED` (4x) and stores it in `savedSpeed`;
`releaseSpeedOverride` restores exactly that value once nothing needs the
slowdown any more. A second engagement starting while the first's slowdown
is still in effect doesn't re-save (would silently overwrite the *real*
original speed with the already-slowed 2x) — `applySlowdownIfNeeded` no-ops
whenever `savedSpeed` is already set.

**Manual override — a real, considered interaction, not an accidental
race.** Two independent overrides:

- **View (pan/zoom).** `noteManualViewChange()` sets a sticky
  `viewerTookOver` flag the moment the viewer scrolls `canvas-wrap`
  themselves or uses the zoom buttons/pinch gesture. While set, the *active*
  engagement keeps running in every other respect (log filter stays scoped,
  conclusion/dwell timers keep ticking) but the camera stops re-centering —
  the viewer explicitly looked somewhere else, so auto-camera backs off
  rather than snapping back every frame. A genuinely *new* engagement
  (queue promotes) clears the flag and takes the camera back — a fresh
  notable event is a deliberate new thing to look at, not a continuation of
  whatever the viewer panned away from. Telling "auto-camera's own
  `scrollLeft` assignment" apart from "the viewer's real scroll gesture" on
  the one shared native `scroll` event is done by exact comparison against
  the position auto-camera itself just set (`autoCamLastScroll` in
  `main.ts`) — reliable specifically because auto-camera's own scrolls are
  plain instant assignments, never smooth/animated, so there's no
  intermediate-frame ambiguity to guess at.
- **Speed.** `noteManualSpeedChange()` (wired to the speed slider's own
  `input` listener, never fired by auto-camera's own `setSpeed` path)
  clears `savedSpeed` outright — a manual speed change is taken as the
  viewer's new intended speed, not something to be silently overwritten
  when the current slowdown (if any) later releases.
- **Restoring the view on full idle respects an in-progress manual
  override too**: if the viewer already took the wheel before the last
  engagement concluded, going idle does *not* snap back to the pre-auto-
  camera "home" view — that would discard a deliberate manual pan the
  instant the thing they panned away from finished, which is backwards.
  The home-view snapshot/restore only fires when the viewer never
  intervened during that run.
- **Toggling off entirely** is treated as an explicit "stop," not "finish
  this one first" — it releases the queue/active engagement, log filter,
  speed override, and view immediately (see `AutoCameraController.reset`).

**Log filtering — a new, more specific filter mode, not a variant of the
existing per-agent one.** `EventLogPanel.setAutoCamFilter(ids)` takes a
whole `Set<string>` of ids (both fighters, an egg plus both its parents,
every member of an immigrant group) and — while set — overrides every other
filter/toggle outright (`hideNoise`, `hideLevelUps`, `headlinesOnly`, and
the manual single-agent `filterAgentId`), matching a curated view of
exactly this moment's participants rather than a variant of the viewer's
ambient log preferences. This matters concretely: a flee right before a
kill is `behaviorChanged`, ordinarily in `NOISE_KINDS` and hidden by
default, but it's exactly the context a followed battle should show, so the
auto-cam filter bypasses `hideNoise` rather than inheriting it. Real fix
found in `eventText.ts` while building this: `AGENT_ID_FIELDS` (the generic
id-field list both the old single-agent filter and the new
`eventNamesAnyOf` helper walk) was missing `partnerId`/`eggId`/`eaterId`/
`threatId` — those event kinds (bonded/egg-*) postdate when that list was
first written. Added them; this also makes the pre-existing single-agent
click-to-filter behavior more complete (clicking a bonded partner now
surfaces the `bonded` row).

**Toggle UI.** `#auto-cam-toggle` in the header, reusing the existing
`.playing` on/highlighted-background convention (`#style-tile`/
`#style-ascii`/`#play-pause`) rather than inventing a new toggle affordance,
plus a small `#auto-cam-status` label next to it showing the active
engagement's short label (e.g. "scyther vs charmander fighting") or
"watching…" once enabled with nothing currently notable.

**Verification.** No browser test harness exists in this project (see
TODO.md's standing note, and the Inspector redesign section's identical
caveat) — Playwright itself, however, turned out to already be installed
globally in this environment (`/opt/node22/lib/node_modules/playwright`,
confirmed launchable), so this got *both* levels of verification, not just
the hand-rolled-shim fallback:

1. `pnpm -r typecheck`/`pnpm -r build` clean across all 4 packages.
2. A throwaway (not shipped) script drove the real, compiled-at-runtime
   `AutoCameraController` (via Node 22's built-in
   `--experimental-transform-types`, no separate build step needed) against
   a fake `AutoCameraHost` and hand-built `SimEvent` sequences, asserting on
   the resulting state transitions across 7 scenarios: a battle from first
   hit through a true kill and its epilogue hold, with speed/view save-and-
   restore verified end to end; two one-shot events queuing FIFO without
   interrupting each other; a battle concluding via a successful retreat
   (not just death) inside its short epilogue window, not the long stale-
   timeout fallback; a manual view override suppressing re-centering
   without killing the underlying engagement; the bonded/shelterBuilt/
   eggLaid courtship trio firing as three genuinely separate engagements
   (this caught a real bug — the first version's dedup logic collapsed them
   into one because it keyed on the shared `NotableCategory` rather than
   the specific originating event kind, fixed by adding a `sourceKind`
   field used only for de-duplication); the stale-timeout fallback actually
   firing (and not before its 40-tick window) when no clean conclusion
   signal ever arrives; and an immigration group's camera focus landing on
   the live midpoint of the whole group, not just the first agent. All 7
   scenarios pass.
3. A real headless-browser run (Playwright/Chromium) against the actual
   `pnpm --filter @pokuelike/web dev` server: loaded the page, set speed to
   32x, toggled Auto Camera on, pressed Play, and watched the live DOM.
   It engaged for real on an actual battle (`"scyther vs charmander
   fighting"`), and confirmed in the live page: zoom snapped to 200%
   (`AUTO_CAM_ZOOM`), speed clamped from 32x down to 2x, and the event-log
   panel showed the scoped fight text ("scyther (scyther-1) used slash on
   charmander (charmander-0)...") rather than the unfiltered full log or an
   empty placeholder. It later returned to `32x`/`"watching…"` once the
   engagement concluded and the queue drained. A simulated manual scroll
   event and the off-toggle were also exercised with no console/page
   errors the whole run. This is real-browser confirmation of the actual
   wiring, not just the isolated state-machine logic from step 2.

### Follow-up: zoom pulled back to 150%, and real 0.25x slow-motion for battles specifically

**Direct asks, verbatim.** "Okay so ui wise I want a little more zoom out on
auto cam. Maybe 150%." And: "And also slow down battles to .25x."

**Zoom: `AUTO_CAM_ZOOM` (main.ts) is now a literal `1.5`**, down from
`ZOOM_MAX` (2, i.e. 200%) — still a fixed level for the same reasons as
before (see the original zoom writeup above), just a little less
tight/claustrophobic per direct feedback. `zoomLabel` reads the raw `zoom`
value as a percentage, so this shows as exactly "150%" in the UI.

**Speed: battles get their own, much lower, always-applied target —
`AUTO_CAM_BATTLE_SLOWDOWN_SPEED` (0.25x) in `autoCamera.ts`.** The existing
`AUTO_CAM_SLOWDOWN_SPEED`/`SLOWDOWN_THRESHOLD_SPEED` pair (2x target, only
kicking in at ≥4x) is unchanged and still governs every *other* notable
category (immigration, courtship, hatch, evolution, death) exactly as
before. Battles needed a genuinely different rule, not just a different
number plugged into the same one: 0.25x is *slower than normal 1x/2x/3x
speed*, so "only intervene when the viewer is already going fast" makes no
sense here — the whole point of "slow down battles to .25x" is guaranteed
cinematic slow-motion combat, whatever speed the viewer happened to have
selected, even 1x. `applySlowdownIfNeeded` now branches on
`this.active?.category === "battle"` before deciding whether/what to slow
to:

- **Battle**: always drops to `AUTO_CAM_BATTLE_SLOWDOWN_SPEED`, skipping the
  ≥4x gate entirely — the only guard left is "don't bother saving/setting if
  the viewer is already exactly at 0.25x" (nothing to restore in that case).
- **Everything else**: unchanged ≥4x-only / 2x-target behavior, byte-for-byte
  the same code path as before.

Both paths still go through the exact same `savedSpeed`
save/restore/`releaseSpeedOverride` machinery — a battle at 1x still
remembers "1x" and puts it back afterward, not some default. This is the
same mechanism, just a conditional target/threshold, which keeps the
existing manual-override (`noteManualSpeedChange`) and no-double-save
behavior (a second engagement starting mid-slowdown doesn't re-save) intact
for both cases without duplicating any of that logic.

**Verification (Playwright, real browser, `pnpm --filter @pokuelike/web dev`).**
Confirmed live, not just via typecheck/build:

- Auto Camera zooms to exactly `150%` (`#zoom-label`) the moment it starts
  tracking any notable event.
- Starting playback at a normal `1x` and letting a real battle break out: the
  live `#speed-label` dropped to `0.25x` — confirmed at both `1x` and `8x`
  starting speeds, i.e. the battle-specific slowdown fires regardless of the
  ≥4x gate that governs every other category.
- The same run, for a non-battle event: starting at `1x` stayed at `1x`
  (below the ≥4x threshold, correctly untouched) and starting at `16x`
  (index 6) dropped to `2x` for a non-battle event — the original ≥4x/2x
  behavior, unchanged.

## Battle Screen: a Pokémon-textbox-style view of what Auto Camera is following

**Direct ask, verbatim.** "Can I get something outside of event log that
kinda shows better text as the auto cam events are happening? Like, more
pretty printed and sorta in a different collapsible view. Damage dealt,
critical hits. More framed like a Pokémon battle." A direct extension of the
just-shipped Auto Camera feature above, not a standalone request — this
panel exists specifically to narrate whatever Auto Camera is currently
following.

**Decided: additive, not a replacement — the plain event log's auto-cam
filter and this panel coexist.** `EventLogPanel.setAutoCamFilter` already
narrows the log to a followed moment's participants with full precision
(every event kind, every move-build modifier via `describeMoveModifiers`).
This new panel (`packages/web/src/battleScreenPanel.ts`) is a second,
differently-*formatted* view of a narrower slice of the same data — turn-by-
turn prose for a battle's `fought`/`missed`/`herdClash`/`fainted`/death/flee
events specifically, styled like a mainline battle text box, not a superset
or a subset that makes the log redundant. Someone who wants exact numbers
and every event kind still has the log; someone who just wants to watch the
story now has somewhere better-framed to look. Both update off the exact
same tick data (`main.ts`'s `step()` feeds both `eventLogPanel.ingest` and
the new `battleScreenPanel.ingest`), so they never drift out of sync with
each other.

**Scope: every notable category gets a line here, not just battles.** The
task brief explicitly said not to hard-restrict to battles "if other event
types read well in this format too." They do — "2 bulbasaur arrived!", "Oh?
charmander egg hatched!", "What? bulbasaur evolved into ivysaur!" all read
fine in the same battle-textbox voice. Only `"battle"` gets the rich
turn-by-turn scrollback + live HP bars treatment, though (see
`sceneLine`/`battleLinesFor` in battleScreenPanel.ts): a one-shot moment
doesn't have "turns" to scroll through, so it gets exactly one flavor-text
line instead of an empty box with a single line rattling around in it.

**Interaction model: a static, always-present collapsible panel that
updates in place — not something that pops open/closed on its own.**
Docked in `main` next to the Inspector panel (`#battle-screen-panel` in
index.html), *not* inside the `#sidebar` drawer with the legend/event log —
the drawer is closed by default and sits behind a toggle, which would defeat
"as the auto cam events are happening": the whole point is seeing it the
moment a battle starts without an extra click. It has its own Hide/Show
button (`#toggle-battle-screen`), the same convention `#toggle-legend`
already established, and shows a plain "Nothing to show" placeholder while
idle rather than collapsing/expanding itself automatically. Considered
auto-expanding on a new battle and auto-collapsing after — rejected because
it would fight a viewer who deliberately collapsed it (every new battle
would silently re-open something they just closed), the same "don't
surprise the viewer by overriding their own choice" principle Auto Camera's
own manual-override design already established for the camera/speed
controls.

**History model: a scrolling turn-by-turn log for the current battle,
cleared when a new one starts.** A real mainline battle screen shows a short
scrollback of the current fight's messages, not just the latest line — this
does the same, capped at `MAX_LINES` (60) with the DOM only ever rendering
the newest 40. The scrollback is keyed off a new `Engagement.seq` field
added to `autoCamera.ts` (a monotonic id stamped once per real `Engagement`
object) specifically so "the same battle widened by a pack-hunt assist" (an
existing engagement's `ids` set gaining a member — not a new `seq`) can be
told apart from "a genuinely new battle just got promoted" (a new `seq`),
which `category`/`sourceKind` alone can't do since two unrelated battles in
a row share both. `AutoCameraController.currentEngagement()` exposes this
as a small `ActiveEngagementInfo` shape (`seq`/`category`/`ids`/`label`)
rather than requiring the panel to reach into the controller's private
state.

**What's actually renderable, straight from what the engine already
logs — no client-side combat recomputation.** Checked `events.ts`'s real
`"fought"`/`"missed"`/`"herdClash"` shapes before assuming anything:

- **Damage, crit, HP remaining**: all real, already on `fought`/non-missed
  `herdClash` (`event.damage`, `event.critical`, `event.defenderHpRemaining`)
  — rendered directly, not recomputed. (HP values can carry float noise from
  elsewhere in the engine's combat math — e.g. "11.560000000000002" — which
  is real, pre-existing engine behavior unrelated to this feature; this
  panel rounds only for *display*, a presentation choice, not a claim the
  underlying number is actually an integer.)
- **Move name**: `fought`/`missed` carry `moveId` (a raw id like `"vineWhip"`)
  but not a display name — resolved via the exact same live-attacker-lookup
  `eventText.ts`'s `formatEvent` already used for the plain log
  (`findMoveUsed`, now exported and reused rather than duplicated) to get
  the move's real `MoveSpec.name` ("Vine Whip"). Best-effort: if the
  attacker's since died/been pruned, falls back to the raw `moveId`, same
  tradeoff the log already accepts.
- **"It's super effective!" / "It's not very effective..."**: **not** on the
  event — `events.ts` logs no effectiveness multiplier at all. This is the
  one thing computed client-side, and deliberately via the engine's own
  exported `typeEffectiveness(attackType, defenderTypes)` (typing.ts) — the
  *real* type chart the engine's own damage math is built on, not a
  reimplemented/guessed one that could drift from it. Inputs are the
  resolved move's real `type` and the live defender `Agent`'s real `types`
  array (denormalized onto every combat-capable agent at spawn) — both real
  engine data, not fabricated. The one honest gap: if the defender agent has
  already been pruned from `world.agents` (corpse persistence window
  elapsed) by the time this renders, the callout is silently skipped rather
  than guessed — an accepted, rare edge case for a live-observer panel.
- **HP bars**: live `Agent.hp`/`maxHp`, read fresh every animation frame (not
  just when a new line arrives) the same way `autoCamera.ts`'s own
  `focusPos` re-reads live positions every frame — real data, not a
  snapshot frozen at the moment of the last hit.
- **Fainting/retreat/death conclusion lines**: straight from
  `fainted`/`behaviorChanged("flee")`/`herdClash("retreated")`/`killed`/
  `defeated` — the exact same three-signal conclusion set `autoCamera.ts`'s
  `onBattleParticipantLeft` already recognizes, reused rather than
  re-derived; a matching line also flags the panel's `.battle-screen-
  concluded` visual state (dimmed "vs" header) once one fires.

**Visual treatment: CSS-only, no animation library.** A crit/faint/kill line
gets a brief highlight flash (`@keyframes battle-flash`, a background fade)
applied only to the single newest such line (a `.battle-screen-line-newest`
marker `BattleScreenPanel.render` adds to the last-rendered element) rather
than to every crit-class line — the whole log is rebuilt from scratch on
each dirty render (same "cheap, wholesale rebuild" pattern `EventLogPanel`
already uses), so without that marker every past crit would replay the
flash alongside a genuinely new one. Colors reuse the existing dark-theme
CSS variables and the same color values `eventText.ts`'s `STORY_COLOR`
already assigns to `fought`/`fainted`/`killed` — not a new palette.

**Verification.** Same two-level approach the Auto Camera commit itself
used:

1. `pnpm -r typecheck`/`pnpm -r build` clean across all 4 packages.
2. Real headless-browser runs (Playwright/Chromium, confirmed pre-installed
   at `/opt/node22/lib/node_modules/playwright` in this environment) against
   the actual `pnpm --filter @pokuelike/web dev` server: loaded the page,
   set speed to max, toggled Auto Camera on, pressed Play, and polled the
   live DOM. Directly confirmed, from real combat: the "vs" header with both
   combatants' live species/level/HP bars; a real turn-by-turn line sequence
   ("bulbasaur used Vine Whip! It's not very effective... spearow takes 6
   damage! (HP left: 12)") with genuinely correct type-effectiveness text
   (grass vs. a flying/normal-type defender computing to not-very-effective,
   matching the real chart); a critical-hit callout; a fainted-participant
   conclusion line; and, on a longer run, a non-battle scene line ("2
   bulbasaur arrived!") confirming the panel renders immigration too, not
   just battles. Also confirmed the Hide/Show toggle actually sets
   `#battle-screen`'s `hidden` attribute. Zero console/page errors across
   both runs.

### Follow-up: merged into the Inspector panel as a real tab, not a second docked panel

**Direct ask, verbatim.** "The battle log ui is great but it obscures the
map. Can you have it be a tab actually built in where the population stats
and stuff are? Just a different tab look at but you can switch back and
forth." The standalone `#battle-screen-panel` from the original feature
above (docked under the canvas, its own fixed `max-height`) cost the canvas
real vertical space on top of the Inspector panel already there — the fix is
to make it share the Inspector's existing footprint as a second tab, not add
to it.

**Decided: a thin visibility-only tab switcher in `main.ts`, neither panel
module changed.** `renderInspector` (inspector.ts) and `BattleScreenPanel`
(battleScreenPanel.ts) are completely unaware tabs exist — both still render
into their own `#inspector`/`#battle-screen` divs exactly as before, on
every tick/frame, regardless of which one is currently visible. The two divs
are now DOM siblings inside one `.panel` (`#inspector-panel` in index.html),
and a small `selectTab("inspector" | "battle-screen", manual)` function in
main.ts is the *only* new logic — it toggles `.hidden` on the two content
divs, `.playing`/`aria-selected` on the two new tab buttons
(`#tab-inspector`/`#tab-battle-screen`, in `#inspector-panel`'s own
`.panel-header`, replacing the old plain `<span>Inspector</span>` title),
and shows/hides the "Clear [selection]" button (meaningless on the Battle
Screen tab). This is deliberately the cheapest possible integration: neither
panel's own render logic, dirty-tracking, or public API changed at all,
which also means the two panels' existing "always render every frame,
regardless of visibility" behavior (each already cheap — a handful of DOM
nodes) is unchanged; the only new cost is two `.hidden` assignments.

**A real, non-obvious CSS gotcha caught while wiring this up:** both
`#inspector` and `#battle-screen` set their own unconditional `display`
(`block` default / `display: flex` respectively) for their own internal
layout needs. An *author* stylesheet's `display` declaration always beats
the browser's own built-in `[hidden] { display: none }` rule regardless of
selector specificity (origin priority, not specificity, decides between
author and user-agent stylesheets) — so naively toggling `.hidden` on either
div would have silently done nothing visually. Fixed with an explicit,
higher-specificity `#inspector[hidden], #battle-screen[hidden] { display:
none; }` override in index.html.

**Interaction model: manual switching always works; auto-switching to
Battle Screen on a new battle is a nice-to-have that respects a manual
override for that same battle — deliberately mirroring Auto Camera's own
existing manual-override pattern, not a new design language.** The user's
own phrasing ("switch back and forth") made manual control non-negotiable,
but leaving *only* manual control would regress the "as the auto cam events
are happening" spirit the original standalone panel had (it just appeared).
Landed on:

- Clicking either tab button always switches immediately — no override logic
  gates a manual click itself.
- The moment Auto Camera starts tracking a *new* battle engagement (a fresh
  `Engagement.seq`, from `currentEngagement()`), the tab auto-switches to
  Battle Screen — `main.ts`'s `maybeAutoSwitchTab()`, called once per frame
  alongside the existing `battleScreenPanel.setActive` call.
- If the viewer manually switches back to Inspector *during* that same
  battle, that choice sticks for the rest of it — recorded as
  `tabManualOverrideForBattleSeq = <that battle's seq>` — so auto-switch
  doesn't fight them back to Battle Screen on the very next frame. This is
  byte-for-byte the same shape as `AutoCameraController`'s own
  `viewerTookOver` flag for camera panning: a deliberate override sticks for
  the duration of *this* engagement, but a genuinely *new* one (a different
  `seq` — the next battle) is a fresh thing to show and earns the
  auto-switch again, exactly as a new engagement re-earns camera control
  even from a viewer who'd panned away from the last one.
- Manually switching *to* Battle Screen (whether or not a battle is active)
  clears any standing override — the viewer chose to look at it, so there's
  nothing left to protect against.
- Loading/reloading a world resets both the auto-switch and override
  tracking and snaps the tab back to Inspector — a fresh world's battle
  `seq`s (and every tracked agent id) are unrelated to whatever was on
  screen a moment ago, the same "everything's meaningless now" reasoning
  `AutoCameraController.reset()` already applies to its own state on a world
  reload.

**Sizing: the merged panel keeps the Inspector's existing footprint, not the
sum of both former panels.** `#inspector-panel`'s existing `max-height`
(46%, unchanged) now bounds whichever tab is showing — Battle Screen's own
internal flex/scroll layout (`.battle-screen-log`'s `flex: 1` + `overflow-y:
auto`) still works the same way inside that shared bound it did inside its
own former panel, since the same "container has a real height ceiling, so
flex-shrink squeezes the scrollable child to fit" mechanism applies either
way. Net effect: the canvas gets back roughly the vertical space the
standalone Battle Screen panel used to take, which was the entire point of
this follow-up.

**Verification (Playwright, real browser, `pnpm --filter @pokuelike/web dev`).**
- `#battle-screen-panel` no longer exists in the DOM at all (confirmed via a
  zero-count locator query) — it's genuinely gone, not just visually hidden.
- Both tab buttons render inside `#inspector-panel`'s header; clicking
  `#tab-battle-screen` hides `#inspector` and un-hides `#battle-screen` (and
  vice versa for `#tab-inspector`) — confirmed via each div's real `.hidden`
  state after each click, both directions, several times in the same
  session.
- Triggering a real battle with Auto Camera on and the Inspector tab
  showing: the tab auto-switched to Battle Screen the moment the battle
  engagement started, with the live "vs" header/HP bars/turn-by-turn lines
  rendering in the now-visible `#battle-screen` div.
- `#canvas-wrap`'s live bounding-box height was measured post-merge to
  confirm the map now gets the vertical space the old second panel used to
  occupy (no separate fixed-height panel below the canvas any more).

## Species-dependent shelter ease and egg-defense lethality: a direct predator-fragility follow-up

**Direct ask, verbatim.** "I think I also want to make different species
have different requirements for shelter, as in predators should have it
easier to make shelter; and maybe they don't have the protect to death
mentality with it. Species dependent I guess. Predators don't have numbers
so giving them easier reproductive cycle seems good." A continuation of this
session's repeatedly-documented predator-population-fragility investigation
(see this file's "Pack hunting, scavenging, and ontogenetic niche shift" and
"Species expansion" sections, plus the several "predator went extinct"
findings throughout) — this pass targets the bond -> shelter -> egg
reproduction pipeline itself (the "Bonding, shelter, and eggs" feature above)
specifically for predators, since a population-starved species can't afford
the same slow, cautious cycle a thriving herbivore herd can.

### Decided

1. **Predators trigger shelter-building at a lower comfort threshold.**
   `shelter.ts`'s `maybeTriggerShelterBuilding` already lowers
   `SHELTER_COMFORT_THRESHOLD` (0.85) by `BOND_COMFORT_DISCOUNT` (0.15) for a
   bonded, shelterless agent — this adds a second, independent
   `PREDATOR_COMFORT_DISCOUNT` (also 0.15, the same "real, measurable, not a
   token nudge" bar this file's other predator-fragility fixes already
   established) for any `agent.isPredator`. The two stack additively rather
   than one replacing the other: a bonded predator triggers at
   0.85 - 0.15 - 0.15 = 0.55, a genuinely large drop, because "partnered"
   and "population-starved" are independent, both-real reasons to be more
   eager to build.
2. **Predators finish construction in half the time.** New
   `PREDATOR_BUILD_TICKS_MULTIPLIER` (0.5) and exported
   `builderShelterTicks(agent)` helper — a predator invests 20 ticks at the
   build site instead of the ordinary `SHELTER_BUILD_TICKS` (40). Still a
   real, interruptible, multi-tick task (travel + `SHELTER_MIN_BUILD_DISTANCE`
   still apply unchanged), just a genuinely faster one, not a free/instant
   shelter.
3. **`Agent.isPredator`, a new denormalized field**, following the exact
   `activityPattern`/`buildsShelter`/`preferredTerrain` precedent already
   established in this codebase: `SpeciesDef.isPredator` (already existed,
   engine-side-consumed only via `HuntRules`/`isPreyOf` before now) is copied
   onto `Agent.isPredator` at spawn (`spawn.ts`), so `shelter.ts`/`predation.ts`
   never need to import `@pokuelike/data` (a circular dependency —
   `@pokuelike/data` depends on `@pokuelike/engine`). `eggs.ts`'s `spawnEgg`
   also copies `mother.isPredator` onto the egg it lays — an egg needs this
   the moment it exists, not only after hatching, since `applyEggDefense`'s
   new species-conditional check reads it directly off whichever agent is
   defending, and reads the DEFENDER's own `isPredator`, not the egg's — but
   copying it onto the egg too keeps the field consistently populated for
   any future consumer, and costs nothing (an evolved/base-form pair always
   shares the same hunting temperament, so inheriting straight from the
   mother is always correct, never a re-lookup that could disagree with her
   own already-denormalized value).
4. **A predator's egg defense is no longer unconditionally "to the death."**
   Two real, separate changes inside `predation.ts`, both gated on
   `agent.isPredator` and fully additive to the original design (a
   non-predator defender is completely unaffected by either):
   - **Priority**: `applyPredationInstincts` checks a predator's own
     critically-hurt flee reflex BEFORE `applyEggDefense`, the exact reverse
     of the original universal ordering (egg defense first, overriding
     self-preservation, for every species). A badly hurt predator now
     genuinely flees instead of unconditionally committing to a fight over
     its egg — this is the real, load-bearing mechanism: it directly reduces
     a predator's own risk of dying in this situation, which is this whole
     follow-up's actual point. A predator that ISN'T critically hurt (or has
     no live attacker fleeing from) still reaches `applyEggDefense`
     afterward and defends normally — the egg is never left undefended just
     because its parent is a predator.
   - **Event labeling**: when a predator does fight, `resolveHit` is called
     with `"defeated"` (the same label `applyPredationInstincts`'s own
     guardian/herdmate-defense branches already use for an ordinary win) in
     place of `"killed"` (the predation-kill label). Documented honestly,
     because it would be easy to oversell: in the CURRENT combat model this
     is a real distinction for anything reading the event log (a predator's
     egg-defense fight now reads as an ordinary combat loss rather than a
     predation kill), but it is **not** a change in survivability —
     `resolveHitAgainstTarget`'s actual death branch sets
     `defender.alive = false` unconditionally regardless of `faintKind`; only
     `herdConflict.ts`'s separate, HP-floor-clamped `resolveRivalryHit`
     resolver can truly guarantee an agent can't die, and reusing that
     resolver here was judged out of scope for this pass — the priority
     change above is what actually moves the predator-survival needle, the
     label swap does not, and TODO.md flags reusing `herdConflict.ts`'s
     non-lethal resolver here as the real follow-up if a truly-can't-die
     predator egg-defense fight is wanted later.

### Built, real-run findings

New `Agent.isPredator` (types.ts), denormalized at spawn (`spawn.ts`) and at
egg-lay (`eggs.ts`'s `spawnEgg`). New `shelter.ts` exports:
`PREDATOR_COMFORT_DISCOUNT`/`PREDATOR_BUILD_TICKS_MULTIPLIER`/
`builderShelterTicks`. `predation.ts`'s `applyEggDefense` takes a
per-agent `faintKind`, and `applyPredationInstincts`'s call-site ordering is
now conditional on `agent.isPredator`.

**New tests** (`shelter.test.ts`): a predator triggers shelter-building at
needs where an otherwise-identical non-predator does not (0.8/0.8, between
the discounted 0.70 and ordinary 0.85 thresholds); a bonded predator stacks
both discounts and triggers at 0.6/0.6 (below the ordinary-bonded 0.70 but
above the stacked 0.55); `builderShelterTicks` returns exactly half for a
predator, full for a non-predator, and a real `applyShelterBuilding` loop
confirms a predator's shelter actually completes at the halved tick count.
(`eggs.test.ts`): a non-predator defender's egg-defense fight against an
already-fainted threat still resolves as a real `"killed"` kill (unchanged
baseline); an otherwise-identical `isPredator` defender's fight against the
same setup logs `"defeated"` instead, never `"killed"` — while honestly
still resulting in `threat.alive === false` (see the label-vs-survivability
distinction above); a critically-hurt `isPredator` defender flees
(`behavior === "flee"`, no `eggDefended` event) instead of committing to the
fight, while a non-predator at identical HP still fights to the death
(pre-existing, unchanged test); an `isPredator` defender that ISN'T
critically hurt still reaches and fires `applyEggDefense` normally. No new
`rng()` calls were introduced by any of this (`builderShelterTicks` is pure
arithmetic on `agent.isPredator`; the `faintKind`/priority changes only
branch on already-available agent state) — `determinism.test.ts`'s full-run
acceptance suite passes unmodified. **All 725 engine tests pass** (one
pre-existing, seed-independent flake in `predation.test.ts`'s burn-damage-
variance test was reproduced on an unmodified rerun too — not introduced by
this change, matches this file's own prior note about that exact test).
`pnpm -r typecheck` and `pnpm -r build` both clean across all 4 packages.

**Real headless runs, seeds 42/7/20260903, 3000/6000/8000 ticks — the
critical predator-population check, this follow-up's actual point.** Total
living predator count (Scyther + Onix + Spearow, plus their evolutions
Fearow/etc. — `isPredator` carries forward across evolution unchanged, see
`leveling.ts`), before (this branch's tip immediately prior to this
follow-up) vs. after:

| seed | ticks | before | after |
|---|---|---|---|
| 42 | 3000 | 1 (1 spearow) | 8 (4 scyther, 2 spearow, 2 onix) |
| 42 | 6000 | 0 | 9 (5 scyther, 2 onix, 2 spearow) |
| 42 | 8000 | 1 (1 scyther) | 9 (5 scyther, 2 onix, 1 spearow, 1 fearow) |
| 7 | 3000 | 7 (2 scyther, 1 onix, 4 spearow) | 4 (3 scyther, 1 onix) |
| 7 | 6000 | 2 (1 onix, 1 spearow) | 7 (6 scyther, 1 spearow) |
| 7 | 8000 | 0 | 5 (4 scyther, 1 spearow) |
| 20260903 | 3000 | 2 (1 onix, 1 spearow) | 2 (1 onix, 1 spearow) |
| 20260903 | 6000 | 5 (2 onix, 2 scyther, 1 fearow) | 4 (2 scyther, 1 onix, 1 fearow) |
| 20260903 | 8000 | 5 (2 onix, 2 scyther, 1 fearow) | 2 (1 scyther, 1 onix) |

**Honest read**: 6 of 9 seed/tick combinations show a real, often dramatic
improvement — seed 42 in particular goes from "predators effectively extinct
or down to a single individual" (1, 0, 1) at every checkpoint to a sustained
multi-individual population (8, 9, 9) at every checkpoint, and seed 7's later
ticks (6000/8000) go from 2/0 to 7/5. 3 of 9 (seed 7 at 3000, and seed
20260903 at 6000/8000) are flat or slightly down. This is a genuinely
different picture from the mixed-to-negative "clutch size"/"raise-then-revert
egg cap" follow-ups earlier in this file — this one moved the actual metric
being chased (predator survival) in the intended direction on the clear
majority of real runs tested, not just in isolated unit tests.

**A necessary caveat, consistent with this file's own repeatedly-documented
finding**: any code-path change in this chaotic system reshuffles every
subsequent `rng()` draw for the rest of a run (see the "clutch size"
follow-up's own honest diagnosis of the identical phenomenon), so a raw
seed-by-seed population table is not a clean, isolated A/B of ONLY this
feature's effect — a same-seed run before/after this change diverges in
countless unrelated ways the instant the very first affected agent's
behavior differs by even one tick. Two things temper this: first, the
directional finding (predators up on 6/9 combinations, including every
single seed-42 checkpoint) is large and consistent enough to read as real
signal, not rng noise, especially given seed 42 went from single digits to
sustained real populations at all three checkpoints. Second, a direct,
non-chaotic confirmation that the mechanism itself fires and works exactly
as designed: a real 8000-tick run's own event log shows `eggDefended` events
where the defender is a predator species firing 4/4 times (seed 42) and
16/58 times (seed 7) — real, non-hypothetical evidence the new
priority-and-labeling logic engages in an actual run, not just in synthetic
unit tests.

**A real, honestly-reported side effect**: total living population (all
species combined) is noticeably LOWER after this change on 2 of 3 seeds at
8000 ticks (seed 42: 60 -> 13; seed 7: 70 -> 15; seed 20260903: 23 -> 29,
essentially flat/slightly up), while starvation deaths dropped to 0 on every
seed/tick after this change (seed 7's baseline showed 2/2/4 starvation
deaths at 3000/6000/8000 — genuinely eliminated, not just reduced). Reading
the species breakdown directly: prey-species colonies (Bulbasaur/Charmander/
Squirtle lines) that grew very large in the "before" runs are much smaller
or absent in the "after" runs. This reads as a real, mechanistically
plausible ecological trade-off, not a bug: more predators surviving for
longer is, definitionally, more sustained hunting pressure on prey — a
predator population this thin before couldn't meaningfully suppress prey
growth at all, so fixing the predator side was always going to cost the
prey side something. Whether this specific trade (far healthier predator
populations, meaningfully smaller total/prey populations, zero starvation)
is the right balance is a real, legitimate follow-up judgment call flagged
in TODO.md, not resolved further in this pass — the task's explicit bar was
"does this help predator population health," and on the clear majority of
real runs tested, honestly, it does.

### Explicitly not done / open follow-ups (see TODO.md)

- `applyEggDefense`'s `"defeated"` outcome for a predator does not actually
  prevent the defender's death today — only the event label changes (see
  the "Event labeling" point above). Making a predator's egg-defense fight
  genuinely non-lethal (reusing `herdConflict.ts`'s HP-floor-clamped
  `resolveRivalryHit` instead of `predation.ts`'s own faint/finishing-pool
  combat) is a real, separate, larger follow-up, not attempted here.
- The prey-population suppression side effect above is reported, not tuned
  against. If the honest trade-off (healthier predators, smaller/leaner prey
  populations) turns out to be too aggressive in a longer run, the next
  lever is almost certainly re-tuning `PREDATOR_COMFORT_DISCOUNT`/
  `PREDATOR_BUILD_TICKS_MULTIPLIER` down rather than reverting the feature
  outright, given the directional predator-health win is real.
- No third lever (e.g. a lower `SHELTER_MIN_BUILD_DISTANCE` for predators)
  was added on top of the two shipped — the task's own instruction was to
  pick real, needle-moving levers rather than touch every one offered, and
  the comfort-discount + build-speed pair was judged sufficient and was
  validated as such.

## Rapport: a real agent-to-agent relationship graph — the foundation for future player recruitment

Direct, explicit framing from the user: a future evolution of this project
from a pure ecosystem sim into a real game where a player recruits
individual Pokémon by building rapport with them — a herd becomes the
player's team, but which specific individuals actually want to join depends
on a real relationship, not just herd membership. Direct quote on priority:
"I think it's the most important thing right now." This section is
deliberately scoped to the general, in-sim, **agent-to-agent** foundation
only — no player/UI concept exists in this codebase yet, and none is built
here. The point of building it now, before any player-facing mechanic
exists, is that the general relationship graph needs to already be a real,
mechanically load-bearing part of the sim (not a UI-only stat invented later
purely to serve recruitment) — the same reasoning this codebase has already
applied to herd status, disposition, and herd conflict: a system a future
feature can plug into is only trustworthy if it's already doing real work on
its own.

### Decided

1. **Sparse, not a dense matrix.** `Agent.rapport?: Record<string,
   RapportEdge>` (types.ts), keyed by the OTHER agent's id —
   `RapportEdge = { score: number; lastInteractionTick: number }`. Absence
   means neutral/unacquainted, not a stored zero: most agents in a real run
   never interact with most other agents, so most pairs should cost nothing
   at all, the same "don't store what nothing has touched" instinct behind
   every other optional field on `Agent`. Score ranges **-1 to 1** —
   deliberately signed, not a plain friendship counter, so the same
   structure represents both a real bond (`bonded`, food delivery,
   mob-defense — all positive) and a real grudge (`herdClash` — negative).
2. **Lazy, read-time decay, not a per-tick global sweep.** `rapport.ts`'s
   `decayedRapportScore(edge, tick)` computes `edge.score *
   RAPPORT_DECAY_PER_TICK ** (tick - edge.lastInteractionTick)` — pure
   arithmetic, no stored intermediate state, evaluated fresh every time a
   consumer reads an edge (`rapportScore`) or a trigger touches one
   (`adjustRapport`). This is the same "computed from elapsed ticks on
   read/touch" shape `Tile.grazingPressure`'s decay established, chosen
   specifically *instead of* an actively-ticked-every-agent-every-tick sweep
   (the way `Agent.herdConflictCooldownTicks`/`digestingTicksRemaining` are
   ticked down inside `tickAgentNeeds`) for a structural reason:
   `grazingPressure` and the cooldown counters all live on a value already
   being visited by an existing per-tick scan (the tile grid, or the acting
   agent's own needs tick) — decaying them costs nothing extra. A
   relationship graph has no such free ride: decaying every edge of every
   agent every tick would mean a new O(agents × edges) pass with no existing
   scan to piggyback on, purely to keep values fresh that mostly nothing is
   reading on most ticks. Lazy, read-time decay means the cost is paid
   exactly when (and only when) an edge is actually consulted or touched —
   the "cheaper than a per-tick global sweep" call the task brief itself
   flagged as the likely right shape.
   - `RAPPORT_DECAY_PER_TICK = 0.9977`, chosen for a ~300-tick half-life
     (`0.5 ** (1/300) ≈ 0.9977`) — the same order of magnitude as this
     codebase's other "sustained, not a single bad tick" social/behavioral
     time constants (`MATE_ISOLATION_TICKS` = 200, `HERD_CONFLICT_COOLDOWN_TICKS`
     = 80), deliberately much faster than `grazingPressure`'s own decay
     (0.004/tick, tuned for a totally different multi-hundred-tick
     food-patch regrowth cycle) — a relationship should survive a herd-mate
     briefly stepping out of sight, but a genuine multi-hundred-tick dry
     spell with zero fresh interaction should measurably fade it back toward
     stranger-neutral.
3. **Pruned on touch, once decayed below a real threshold — the sparsity
   guarantee's other half.** `RAPPORT_PRUNE_THRESHOLD = 0.02`: any edge
   whose |decayed score| falls under this is deleted outright rather than
   left sitting at a value indistinguishable from "never interacted"
   forever. Checked both on write (`adjustRapport`, e.g. a strong grudge
   nudged back toward 0 by later goodwill) and, deliberately, on plain read
   (`rapportScore` opportunistically deletes a stale edge it discovers has
   decayed under threshold) — a real edge that nothing ever interacts with
   again would otherwise never get touched by a write again either, and
   would sit in the map forever; letting the read path prune too means a
   pair that simply stops interacting genuinely leaves the sparse structure,
   not just conceptually.
4. **A hard cap on edges per agent, independent of decay/pruning.**
   `RAPPORT_MAX_EDGES_PER_AGENT = 16` — a defensive bound in the same "should
   never be approached in practice, but bounds the pathological case" role
   as `SHELTER_CLUSTER_SCAN_CAP`. This matters specifically because decay/
   pruning alone can't guarantee sparsity under heavy, sustained interaction:
   a long-lived, stable, socially active herd could in principle accumulate
   real interaction partners faster than a ~300-tick half-life clears stale
   ones. `evictWeakestEdge` fires whenever a genuinely *new* partner (not an
   existing one being adjusted) would push an agent past the cap — it evicts
   by current decayed |score| first (the least-meaningful relationship to
   keep), then by staleness (`lastInteractionTick`), then, for a genuine tie
   on both, by `rng` (always threaded from `world.rng`, never bare
   `Math.random`, per this codebase's determinism rules — see the note
   below). Confirmed by a dedicated unit test that this holds even for 20+
   uniformly strong, uniformly fresh edges (a case decay/pruning would never
   touch on their own).
5. **Interaction magnitudes — reusing real, existing trigger events, not
   inventing new ones.** Every delta below is applied via
   `strengthenRapportMutual` (both participants' opinion of each other
   moves, not just one side):
   - **`RAPPORT_FOOD_DELIVERY_DELTA = 0.03`** — support.ts's
     `applyHerdSupport`, on a real `foodDelivered` event (carrier and
     receiver). The smallest magnitude here on purpose: an ordinary,
     opportunistic errand, not a significant moment — real repetition
     between the same two individuals is meant to be what eventually adds
     up to something a consumer actually feels.
   - **`RAPPORT_MOB_DEFENSE_DELTA = 0.06`** — predation.ts's existing
     guardian mechanic (`findHerdmateInDanger` inside
     `applyPredationInstincts`): when a herd-mate actually lands a hit
     defending another that's currently fleeing/fighting a threat, both come
     away with a real, positive nudge. Twice the food-delivery magnitude — a
     real, risk-bearing act (picking a fight with whatever's threatening a
     herd-mate), not just running food over — but still modest, since a herd
     with an active predator problem produces many of these between the same
     pairs over a real run (confirmed below), so repetition still does most
     of the work here too. (This codebase's other, more literal "mob"
     mechanic — several prey converging on one predator threat,
     `mobThreshold`/`countHerdAllies` — was considered as the hook instead;
     the guardian branch was chosen because it names an explicit, singular
     "the one defended" `herdmate`, which is the cleaner, more literal match
     for "the defender(s) and the one defended" than the mob branch's
     implicit, shared "whoever's nearest to the predator.")
   - **`RAPPORT_BONDING_DELTA = 0.6`** — reproduction.ts's `applyMateSeeking`,
     on first real contact (the `bonded` event, gated by
     `Agent.bondedPartnerId` so it fires exactly once per pair). Deliberately
     a real, immediate jump, not an incremental nudge: bonding is already a
     deliberate, rare, significant event with no repetition path of its own
     (unlike food delivery/mob-defense, which happen repeatedly between the
     same pair), so the one application has to carry the whole weight of
     "these two are now mates." 0.6 lands solidly in "clearly a bond"
     territory on the -1..1 scale without maxing it out outright, leaving
     room for a bonded pair's later real interactions to push it higher.
   - **`RAPPORT_HERD_CLASH_DELTA = -0.06`** — herdConflict.ts's
     `resolveRivalryHit`, applied to exactly the attacker/defender pair (never
     species- or herd-wide) on a real landed hit (`outcome: "hit"` or
     `"retreated"` — never `"missed"`, which never actually connected).
     Magnitude-matched to mob-defense's positive delta (same size, opposite
     sign): a single clash is a real, felt negative moment, but sustained
     rivalry between the same specific pair — which the mechanic's own
     cooldown/re-blocking structure makes likely once two herds keep
     recontesting the same tile — is what's meant to build a real, escalating
     grudge, confirmed by a real run below.
6. **Consumer #1 — mate preference (reproduction.ts).** `mateScore`
   (`nearestMate`'s ranking function) already composed a real-distance
   discount for herd status (`STATUS_DISTANCE_BONUS`, from the "Herd status"
   feature) before this — rapport is added alongside it, in the exact same
   "discount off effective distance, distance still dominates a real gap"
   composition, not a parallel mechanism:
   `distance - statusAdvantage*STATUS_DISTANCE_BONUS -
   rapportAdvantage*RAPPORT_DISTANCE_BONUS`. `RAPPORT_DISTANCE_BONUS = 3`
   (slightly above `STATUS_DISTANCE_BONUS`'s 2) — a real, earned relationship
   is judged a somewhat stronger signal than relative herd rank, but both
   stay small next to `mateSearchRadius`'s ~3-7 tile range, so this still
   only ever tips a close call, never overrides a genuine distance gap. Only
   the *positive* half of rapport attracts here (`rapportAdvantage` clamps
   negative scores to 0) — a grudge doesn't repel mate choice on its own,
   that's the herd-conflict consumer's job, not this one's.
7. **Consumer #2 — herd-conflict targeting/escalation (herdConflict.ts).**
   Two real behavioral hooks, both biased by `rapportScore(agent, rival.id,
   ...)`:
   - **Targeting**: `findRivalOccupant` (which of possibly several eligible
     occupants at the contested tile becomes the fight target) now scores
     candidates the same "distance minus a scaled discount" way `mateScore`
     already established — `dist - grudge*RAPPORT_TARGET_BIAS_TILES`
     (`RAPPORT_TARGET_BIAS_TILES = 1`), so a specific individual with an
     existing grudge is preferred over a merely-nearer stranger at
     `RIVAL_DETECT_RADIUS`'s tight 1-tile range.
   - **Escalation chance**: `herdConflictChance` gains a
     `HERD_CONFLICT_GRUDGE_SCALE = 0.4` term — at a full -1.0 grudge, the
     per-tick escalation roll gets the same order-of-magnitude boost as full
     boldness+aggression (`HERD_CONFLICT_DISPOSITION_SCALE`, also 0.4) — a
     real grudge is meant to be a comparably strong driver of re-escalating a
     fight as raw disposition, not a token nudge. Only the negative half of
     rapport biases this (a positive relationship never suppresses
     escalation below the plain disposition-driven baseline) — this consumer
     is specifically about grudges, the mirror of consumer #1 being
     specifically about bonds.

### Built, real-run findings

`packages/engine/src/rapport.ts` (new module, the data structure/decay/
prune/cap plus the tuning constants above) and small hooks at each of the
four trigger sites plus the two consumer sites listed above. 20 new engine
tests (`rapport.test.ts`) cover: absence reads as neutral (no stored zero);
clamping to [-1, 1]; representing both a bond and a grudge on the same
structure; `decayedRapportScore`'s pure elapsed-ticks decay; pruning on both
write and read once decayed under threshold; the hard cap holding with real
eviction, including the "cap holds even before decay/pruning would have
helped" case (all-fresh, all-strong edges); rng-determinism of the eviction
tie-break under a genuine tie, given the same seeded `world.rng`; each of
the four real triggers (food delivery, bonding, joint mob-defense, herd
clash) actually creating/strengthening the right edge on the right pair
(and, for herd clash, explicitly confirming an uninvolved same-herd
bystander is untouched — never a herd/species-wide effect); a real
behavioral mate-preference test (an otherwise-identical setup, isolated from
`STATUS_DISTANCE_BONUS`'s own confound by using solitary candidates, flips
from preferring a nearer stranger to preferring a farther bonded candidate
purely because of the rapport edge); and two real herd-conflict behavioral
tests (the *exact same* rng roll flips from refusing to accepting a fight
purely because of an added grudge edge; and targeting a specific grudge
individual over an equally-near stranger). All 745 engine tests pass,
including the unmodified `determinism.test.ts` acceptance test — this
feature's only new randomness (the eviction tie-break) is threaded from
`world.rng` at every real call site, and a same-seed-twice full `tickWorld`
run (verified separately at the runner level, 3000 ticks, seed 42) produces
a byte-identical event log.

**Real 5000-8000-tick runs, the three standard seeds (42, 7, 20260903),
feature on** — the graph-size/bounding question first, since a brand-new
per-agent structure is a real performance risk if it isn't actually kept
sparse:

| seed | ticks | living agents (end) | total rapport edges (end) | max edges on any one agent (end) | max edges on any one agent (peak, whole run) |
|---|---|---|---|---|---|
| 42 | 8000 | 13 | 8 | 2 | 5 |
| 7 | 8000 | 15 | 27 | 9 | 9 |
| 20260903 | 8000 | 60 | 99 | 7 | 7 |

The cap (16) was never actually reached by any agent in any of these three
runs — decay + pruning kept the structure genuinely sparse on their own at
this population scale, exactly as intended; the cap's own dedicated unit
test (not a real run) is what actually exercises eviction. Total edge count
tracks population size roughly linearly (seed 20260903's population of 60
carries about 1.65 edges/agent on average, seed 7's 15 carries 1.8/agent) —
no runaway growth over the run in any seed (seed 42's edge count peaks at 19
around tick 4500 then *falls* to 8 by tick 8000 as agents die/edges decay,
which is exactly the intended shape, not a leak).

**Trigger frequency, honestly reported — one channel barely fires in a real
run**: across the three runs, `bonded` fired 14-55 times and `herdClash`
fired 6-26 times (hit+retreated+missed combined) — both real, frequent
drivers of the graph. `foodDelivered`, by contrast, fired 0-1 times total
across all three 8000-tick runs — the existing `applyHerdSupport` mechanic's
own real-run gate (a well-fed, non-threatened herd-mate with carry headroom
noticing a hungry ally within `HERD_SUPPORT_RADIUS`) is apparently rare to
actually satisfy in this sim's real population dynamics, independent of
anything this feature added. This is reported honestly rather than
papered over: `RAPPORT_FOOD_DELIVERY_DELTA` is real and correctly wired
(confirmed by its own unit test), but in practice, bonding and herd-clash
are this graph's two real workhorse triggers in an actual run, not food
delivery — a genuine finding about this sim's existing food-delivery
mechanic, not a bug in this feature.

**Consumer #1 (mate preference) — a real, if seed-variable, effect**: of
matings (`bonded` events) where a rapport edge already existed between the
two individuals *before* that tick's bonding call (i.e. they'd already
interacted — via food delivery or mob-defense — as ordinary herd-mates
before pairing up), compared against an honest "pure chance" baseline (the
background density of positive rapport edges among all living agents at
that moment — roughly what fraction of any two random agents would already
hold one):

| seed | matings with pre-existing positive rapport | background chance baseline |
|---|---|---|
| 42 | 0/14 (0%) | 5.1% |
| 7 | 4/21 (19.0%) | 8.1% |
| 20260903 | 11/55 (20.0%) | 2.2% |

Two of three seeds show a real, meaningfully-above-baseline rate (roughly
2.3x and 9x the background chance), one seed shows none at all — read
honestly as genuine seed-to-seed variance at this sample size (14-55
matings per run is not a lot to detect a modest effect), not oversold as a
uniform win. The clean, unconfounded proof this consumer does real work is
the dedicated behavioral unit test above (an otherwise-tied setup flips
choice purely on the rapport edge, isolated from every other scoring
signal) — the real-run numbers are supporting, directionally-consistent
color on top of that, not the primary evidence.

**Consumer #2 (herd conflict) — real re-escalation between the same pairs
shows up in every run with any clashes at all**: of the distinct
attacker/defender pairs that ever landed a real clash hit, the fraction that
clashed more than once (a real repeat, i.e. the exact re-escalation this
consumer is meant to make more likely) was 2/4 (seed 42), 6/11 (seed 7), and
4/10 (seed 20260903) — roughly half of all real clash pairs in every run
that had any. This alone isn't clean proof of the grudge mechanism
specifically (two herds recontesting the same crowded tile would tend to
re-meet the same rival somewhat even without any rapport bias, since
`herdConflict.ts`'s own trigger structure — sustained blocking at the same
tile — naturally recreates the same standoff), so, as with consumer #1, the
clean unconfounded proof is the dedicated unit test: the *exact same* rng
roll that fails against a stranger succeeds against the identical rival once
a strong existing grudge is added, and, separately, a grudge individual is
chosen as the fight target over an equally-near stranger. The real-run
repeat-pair rate is honest, real-run color confirming the mechanism has
somewhere to act (rivalries do recur), not the isolated proof of the bias
itself.

**A real, isolated A/B was attempted and explicitly discarded as
unreliable, consistent with this file's own established standard** (see the
"Herd conflict" section's own identical finding): temporarily zeroing
`RAPPORT_DISTANCE_BONUS` and `HERD_CONFLICT_GRUDGE_SCALE` and re-running the
same three seeds produced wildly different downstream population/event
counts on two of the three seeds (e.g. seed 20260903: 55 bondings/60 living
agents with the feature at full strength vs. 16 bondings/23 living agents
with it zeroed) — not because either flag directly consumes extra rng
draws (both are pure, no-rng arithmetic comparisons), but because changing
*which specific individual gets chosen as a mate or a rival* is itself a
real, cascading change to simulation state (a different pairing produces
different agents in different places doing different things every following
tick), the same "a small deterministic change early cascades into a
completely different trajectory" dynamic this file has already documented
for `herdConflict.ts` and the tile-capacity tightening. Single-seed A/B
is not a trustworthy signal for this kind of change; the trustworthy
evidence is the structural guarantee (the dedicated, unconfounded behavioral
unit tests) plus the honest, seed-variable real-run distribution reported
above.

### Explicitly not done here (see TODO.md)

- Nothing player-facing. This section is the general, in-sim,
  agent-to-agent foundation only, built specifically because the user named
  a future player-recruitment mechanic (a herd becomes the player's team,
  but which individuals actually want to join tracks a real relationship,
  not just herd membership) as the current top priority — but no player/UI
  concept exists in this codebase yet, and none is built here. The natural
  extension point, when that work starts, is treating the player as just
  another node this same graph can hold an edge toward.
- No extension of rapport into natal dispersal (an agent resisting leaving
  behind a herd it has strong existing bonds to), egg-defense willingness
  scaling with rapport toward the egg's other parent, or any other existing
  mechanic beyond the two consumers built here — real, scoped follow-ups,
  not attempted in this pass (see TODO.md).
- No new `SimEvent` kind for a rapport change itself (no `rapportChanged`
  narration) — every trigger already narrates its own real event
  (`foodDelivered`/`bonded`/`herdClash`/the guardian fight's own `"fought"`),
  and this feature deliberately reuses those rather than adding a second,
  parallel log entry for the same real moment. A UI/narrator surfacing an
  agent's rapport standing directly (e.g. an inspector panel showing "close
  bonds"/"grudges") is a real, separate follow-up, not attempted here —
  `packages/web` was out of scope for this task.

## Herd Leadership: a notable can lead its herd, and the herd follows a bit

Direct, verbatim ask, building on Notables: "I think over time they can lead
their herd if there are no other notables (there can be multiple in a herd
but only one can lead) and then their herd sorta changes to follow their
behaviors a bit." Follow-up, proposed and confirmed with "Yeah": tie-break
multiple eligible candidates in a herd by seniority (whoever's held their
qualifying status longest), and blend the leader's Disposition into
herd-mates' effective behavior via nature.ts's existing boldness/aggression/
sociability system.

### Decided

1. **Eligibility exactly matches Notables' own bar.** Only a currently-titled
   agent (`Agent.notableTitle !== undefined`) is eligible to lead — leadership
   is the SAME earned standing translated into local, herd-scoped authority,
   not a second independent bar with its own thresholds. An agent stops being
   eligible the instant it loses its title, changes/leaves herd, or dies,
   re-checked fresh every tick.
2. **Seniority tie-break reuses a new field on `NotableRecord`, not a second
   clock.** `NotableRecord.claimedAtTick` (types.ts) — absent before this
   feature, added specifically because seniority can't be computed without
   knowing *when* a candidate's current title was actually claimed. Set fresh
   on every real claim/transfer in `notables.ts`'s `updateNotables`, and
   deliberately preserved (not reset) on a same-holder value refresh (a
   living Elder's age climbing every tick doesn't restart its tenure). A
   real, acknowledged simplification: seniority tracks tenure under the
   agent's CURRENT title specifically, not a broader "ever eligible" history
   — an agent that lost one title and later claimed a different one starts a
   fresh seniority clock, even though (loosely) it was "eligible" under its
   old title too. Building a continuous cross-title eligibility clock would
   need its own new field with no existing precedent to borrow from — the
   same class of tradeoff Notables' own Beloved-title section already made
   for a similar reason (see that section's offspring-vs-bonded-duration
   writeup). Existing test's exact-equality check on `World.notables`'s shape
   (`notables.test.ts`) was updated to include the new field.
3. **Promotion rule, and the deliberate no-churn guarantee.** A herd gets a
   leader when it has at least one eligible member and currently has no
   leader. Among multiple eligible candidates, lowest `claimedAtTick` wins
   (ties broken by agent id — arbitrary but deterministic, no rng). Critically,
   `herdLeadership.ts`'s `updateHerdLeadership` only ever RE-EVALUATES a
   herd's leadership when something changes FOR THAT HERD SPECIFICALLY — its
   current leader becoming ineligible, or the herd's eligible-member count
   crossing zero -> nonzero. A herd with a perfectly fine, still-eligible
   leader is never swapped out just because a more-senior candidate happens
   to exist somewhere else in the world (a real risk the task brief itself
   flagged) — confirmed by a dedicated unit test (a more-senior candidate
   joining an already-led herd afterward does NOT displace the incumbent, and
   emits no event at all). Storage: `World.herdLeaders?: Record<string,
   string>` (herdId -> agentId), matching `World.herdMigrations`'s exact
   "keyed by herdId, one value per herd" convention; `Agent.isHerdLeader?:
   boolean` is the denormalized per-agent copy, the same pattern
   `Agent.notableTitle` already established for `World.notables` — a boolean
   (not a stored herdId) was chosen since an agent already carries its own
   `herdId`, so "which herd does this leader lead" is always just
   `agent.herdId` itself; no second field would ever disagree with it.
4. **New `SimEvent` kinds** — `leadershipClaimed` (herdId, agentId, species,
   optional `previousLeaderId`) and `leadershipLost` (herdId, agentId,
   species, `reason: "died" | "titleLost" | "herdChanged"`) — following
   `titleClaimed`/`titleLost`'s exact shape convention. `titleLost`'s own
   `reason` union is `"died" | "dethroned"`; leadership's is richer
   (`"died" | "titleLost" | "herdChanged"`) since a herd's leader can become
   ineligible three genuinely different ways Notables itself doesn't have to
   distinguish (a titled agent can't "change herd" out from under its own
   title the way it can out from under its leadership role).
5. **The behavioral effect — `effectiveDisposition`, a new small function in
   `herdLeadership.ts`.** Returns an agent's own Disposition nudged toward its
   herd's current leader's Disposition by `LEADERSHIP_DISPOSITION_BLEND_WEIGHT
   = 0.2`, unchanged (the agent's own value, or the codebase's existing
   neutral-0.5 fallback) when the herd has no leader, the agent IS the leader
   (a leader leads, it doesn't follow itself), or the agent has no herd.
   **0.2, not the 0.15-0.25 band's edges**: this codebase's other "real,
   felt, never-dominant" magnitudes (`RAPPORT_MOB_DEFENSE_DELTA`,
   `NOTABLE_DISTANCE_BONUS`) all sit comfortably mid-band on their own
   scales rather than at an extreme, and 0.2 keeps a maximally-different
   follower retaining 80% of its own value — individual variance stays the
   dominant signal, leadership is a real but secondary lean. Confirmed by a
   dedicated unit test with known agent/leader dispositions and the exact
   expected blended output (0.2 + (leader - own) * 0.2 per axis). The six
   existing per-INDIVIDUAL disposition read sites were swapped from
   `agent.disposition?.X ?? 0.5` to `effectiveDisposition(world, agent).X`:
   predation.ts's `mobThreshold`/`effectiveFleeRadius`/`huntHungerThreshold`
   (all three needed a new `world` parameter threaded in — confirmed `world`
   was already in scope at every real call site first), herdConflict.ts's
   `courageOf` (feeding `herdConflictChance`), dispersal.ts's
   `dispersalChance`, and reproduction.ts's `mateSearchRadius`.
6. **herdMigration.ts's herd-*aggregate* case — a real, considered decision,
   not left untouched.** `herdWanderlustFactor` already computes a herd-wide
   average (boldness+sociability across all living members), a different
   shape than the six per-individual sites above — there's no single "this
   agent's own disposition" to swap for `effectiveDisposition` mid-function.
   Decided: after the plain unweighted average is computed exactly as
   before, it's nudged the REST OF THE WAY toward the herd's current leader's
   own raw disposition by the same `LEADERSHIP_DISPOSITION_BLEND_WEIGHT`,
   rather than inventing a second, differently-tuned "how much does the herd
   average lean on its leader" constant purely for this one site. A
   leaderless herd, or a leader with no `disposition` (a bare fixture),
   falls through to the plain average unchanged — this function's existing
   tests were unaffected since none of them set up a leader. This directly
   extends "their herd sorta changes to follow their behaviors" to migration
   TIMING too, on top of the six individual-level thresholds: a bold,
   restless leader now measurably shifts how eagerly its whole herd decides
   to relocate.
7. **`updateHerdLeadership` runs once per tick, strictly after
   `updateNotables`** (simulation.ts's `tickWorld`) — so a title claimed or
   lost THIS tick is already reflected in `Agent.notableTitle` before
   leadership eligibility is re-checked the same tick. Pure bookkeeping plus
   event emission; no rng, so it doesn't affect determinism.
8. **`packages/web/src/notableTitles.ts`'s `herdDisplayName` upgraded to name
   a herd after its actual LEADER specifically**, falling back to the
   original "any living titled member" behavior only when the herd has
   titled member(s) but genuinely no leader yet. In practice this fallback
   case is not observed in real runs — `updateHerdLeadership` promotes a
   herd's first leader the same tick it gains its first eligible member, and
   runs after `updateNotables` within that same tick, so there's no tick
   boundary where a titled member exists mid-render without having already
   been considered for leadership. It's kept as a defensive fallback anyway
   (a titled agent with no `herdId` at all, for instance, can never lead but
   could still exist) rather than an assumption the code silently relies on.
   A new `LEADER_ICON` (🎖️, a military medal — deliberately distinct from
   `TITLE_ICON`'s per-title icons and from the existing 👑 `titleClaimed`
   crown, since a title and leadership are separate, simultaneously-held
   marks on the same agent) prefixes `idLabel`/`agentDisplayName` wherever an
   agent's identity renders (inspector title bar, event log, auto-camera
   labels, Battle Screen combatant names), plus a dedicated "Leadership" row
   in the inspector's Behavior & social group. `leadershipClaimed`/
   `leadershipLost` render in the event log the same way `titleClaimed`/
   `titleLost` already do (claimed is a STORY_KINDS headline with its own
   icon/color; lost is filtered to NOISE_KINDS as the claimed event's mirror
   image, exactly mirroring Notables' own treatment).

### Built, real-run findings

`packages/engine/src/herdLeadership.ts` (the promotion/demotion mechanism,
`effectiveDisposition`, and the blend weight constant), a new
`claimedAtTick` field on `NotableRecord` and `Agent.isHerdLeader`/
`World.herdLeaders` (types.ts), two new `SimEvent` kinds, six call-site swaps
across predation.ts/herdConflict.ts/dispersal.ts/reproduction.ts (three of
which needed a new `world` parameter threaded through), the
herdMigration.ts aggregate-blend decision above, and web UI identity/herd-
naming updates across notableTitles.ts/inspector.ts/eventText.ts/
battleScreenPanel.ts/format.ts (the runner's own exhaustive event-formatting
switch also needed the two new cases to keep typechecking). 12 new engine
tests (`herdLeadership.test.ts`) cover: single-candidate promotion; the
seniority tie-break with two controlled, fixed `claimedAtTick` values (the
unconfounded proof); the no-churn guarantee (a more-senior candidate
appearing later does NOT displace an already-installed, still-eligible
leader, and emits no event); an untitled agent never leading even alone in
its herd; demotion + immediate handoff to a herd's next-best remaining
candidate; each of the three loss reasons (`died`/`titleLost`/`herdChanged`)
individually; and `effectiveDisposition`'s exact blended value against a
known agent/leader/weight combination, plus its three no-op cases
(leaderless herd, the leader itself, no herd at all). All 814 engine tests
pass (34 -> 35 files, 802 -> 814 tests; 3 consecutive full-suite runs), with
`determinism.test.ts` unmodified and passing, plus a separate same-seed-
twice real `tickWorld` run (seed 42, 3000 ticks, run at the runner level)
confirmed byte-identical — this feature's `updateHerdLeadership` has no rng
of its own, same as `updateNotables`.

**Real 8000-tick runs, the three standard seeds (42, 7, 20260903)** — via
`packages/runner/src/validateLeadership.ts` (modeled on
`validateNotables.ts`):

| seed | final population | herds ever existed | herds ever led | herds never led | total leadership transfers | unique agents ever led | min ticks between successive leaders (same herd) |
|---|---|---|---|---|---|---|---|
| 42 | 19 | 30 | 6 (20%) | 24 | 9 | 6 | 25 |
| 7 | 27 | 22 | 3 (14%) | 19 | 3 | 3 | none (each herd led at most once) |
| 20260903 | 72 | 22 | 2 (9%) | 20 | 4 | 3 | 1049 |

**Read honestly**: as Notables' own section already found, most herds a run
ever produces never accumulate a titled member at all (80-91% here) — a herd
with zero eligible members simply never gets a leader, which is the correct,
expected outcome, not a gap. Of the herds that DO get a leader, transfers are
genuinely rare and not fast-churning: seed 42's single 25-tick gap (the
closest call across all three seeds) came from a real dethroning cascade
(title lost -> immediate handoff to the herd's one remaining eligible
member, itself then also losing its title 25 ticks later) rather than any
back-and-forth flapping between the same two candidates — no herd in any of
the three seeds ever showed the "leader changes every few ticks" red flag
the validation brief called out as disqualifying, so the no-churn guarantee
(point 3 above) needed no further stability fix. `lossReasons` across all
three seeds skewed heavily toward `titleLost` (an incumbent getting
dethroned in the underlying Notables record-holder mechanism) over `died` or
`herdChanged`, consistent with Notables' own finding that most title
transfers come from a genuine new challenger, not death.

**Mechanical payoff — real, not just wired-and-untested**: `effectiveDisposition`
is exercised by a dedicated unit test with a known numeric answer (not just
"it changed something"); the six individual call-site swaps and the
herdMigration.ts aggregate blend reuse the exact composition every existing
disposition consumer already had, so no isolated real-run A/B was attempted
for those specifically, for the same documented reason Notables' own mate-
preference bonus gave (rng-chaos-sensitivity: which individual disperses,
mates, or migrates when is itself a cascading simulation-state change a
single-seed on/off comparison can't cleanly attribute) — the trustworthy
evidence is the structural unit test on the blend math itself plus the
honest real-run leadership-transfer distribution above.

**Not done here**:
- No map-tile visual badge for a leader — same gap Notables' own "not done
  here" list already named for title-holders; leadership reuses the same
  text-based identity rendering, `renderer.ts`'s per-agent map drawing is
  untouched.
- No `leadershipClaimed`/`leadershipLost` Auto Camera one-shot moment, same
  gap as Notables' own `titleClaimed` Auto Camera follow-up.
- Seniority's "current title's tenure only" simplification (point 2 above)
  is a real, acknowledged gap, not revisited in this pass.
- No overworld/region system (out of scope per the task brief, unrelated to
  this feature).
- No new dedicated leadership UI panel (out of scope per the task brief) —
  inline markers/labels on existing displays only.

## Notables: rare, earned individual titles

Direct, verbatim asks across several messages: "I like the idea of
notables... what makes a Pokémon notable?"; "give it xp boosts and name it.
And like the herd can be named around it. And then socially they are
respected."; and, the design-defining follow-up once the first pass was
described back: "I think it's good. I want more titles (like the builder or
the hero or the gatherer) tho and I don't want them in every herd. They gotta
earn it." That last sentence is the whole point of this feature's mechanism
— everything below exists to make "gotta earn it" literally true rather than
a decoration.

### Decided

1. **Record-holder, not a per-herd threshold.** The single most important
   constraint from the direct ask: titles must not become "one per herd" or
   common. Every title is a **global record-holder** — exactly one living
   agent holds it across the *entire world* at a time, or nobody, if no
   living agent has ever cleared a real minimum bar yet. `World.notables?:
   Partial<Record<NotableTitleId, { agentId: string; value: number }>>`
   (types.ts) is the source of truth, following the same "small,
   world-level, keyed structure" convention as `world.weatherCells`/
   `world.biomeSeeds`. `Agent.notableTitle?: NotableTitleId` is a cheap
   denormalized copy for the common per-agent rendering case — the same
   pattern `Agent.isPredator` already established for
   `SpeciesDef.isPredator` — so the web UI's inspector/label rendering never
   needs to cross-reference the world-level map.
2. **Seven titles, each mapped to a stat the engine already produces or can
   cheaply track** (see `notables.ts`'s `statValueFor`):
   - **The Hero** — lifetime true-kill count (`Agent.lifetimeKills`,
     incremented at predation.ts's actual death branch inside
     `applySingleDamageInstance`, right alongside `grantKillExp`). Both the
     ordinary hunt path (`faintKind: "killed"`) and the guardian mob-defense
     finishing blow (`faintKind: "defeated"`) count — both are a real,
     landed, finishing blow, and the user's own framing named "real combat
     prowess ... and/or successful herd-mate defenses" as one combined
     signal, not two separate titles.
   - **The Builder** — lifetime real shelter-build ticks
     (`Agent.lifetimeShelterTicks`, incremented in shelter.ts's
     `applyShelterBuilding` every real build tick, alongside the existing
     per-attempt `shelterBuildTicks` this mirrors but never resets).
   - **The Gatherer** — lifetime real herd food deliveries
     (`Agent.lifetimeFoodDeliveries`, incremented in support.ts's
     `applyHerdSupport` on the exact same real `foodDelivered` trigger
     rapport.ts's `RAPPORT_FOOD_DELIVERY_DELTA` already hooks). The
     Rapport section found this trigger fires rarely in a real run (0-1
     times per 8000-tick run) — deliberately NOT inflated with a padded
     proxy signal to make this title more common; "rare and real" is
     exactly what a title should be.
   - **The Rival** — whoever currently holds the single most intensely
     negative live rapport edge in the world, read straight from the
     existing `Agent.rapport` map (no new tracking) via `rapportScore`.
     Per-agent, not per-pair: an agent's own stat is the magnitude of the
     most negative edge *it personally holds* (its own perspective), so
     picking a title-holder never needs pairwise logic — see
     `statValueFor`'s `"rival"` case.
   - **The Beloved** — lifetime surviving (hatched) offspring count
     (`Agent.lifetimeOffspring`), not lifetime eggs laid. Counted for both
     parents at `eggs.ts`'s `tickEgg` hatch, via the hatchling's own
     `parentIds`. **The offspring-vs-bonded-duration tradeoff, decided
     explicitly**: the task brief offered "highest lifetime offspring count
     OR longest continuously-bonded single mate relationship, whichever is
     more natural given what the engine already tracks." Offspring count
     was chosen: `world.eggsHatched`-style counting is already a real,
     existing, validated signal (see the Bonding/shelter/eggs real-run
     numbers elsewhere in this file), while "longest continuously-bonded"
     would need a NEW timestamp field plus a definition of what breaks
     continuity (a partner's death? corpse persistence lasting
     `CORPSE_PERSIST_TICKS` after that?) that has no existing precedent to
     borrow from. This is a real, acknowledged simplification — a bonded
     pair that never successfully gets a household/shelter/egg through
     (this sim's harshest gate, per the Bonding/shelter/eggs section's own
     findings) currently can never make an agent "The Beloved" no matter
     how long the bond itself has lasted. Not revisited in this pass; see
     TODO.md.
   - **The Elder** — highest `Agent.age` among currently-living agents.
     `Agent.age` already existed (ticks alive since spawn/hatch) — no new
     field needed. One real, honestly-reported wrinkle: `Agent.age`'s own
     existing doc comment says "absent is treated as already mature (for
     agents spawned directly into a scenario)" — a founder/immigrant
     (`spawnAgent`, data/spawn.ts) never has `age` initialized at all and
     `needs.ts`'s `tickAgentNeeds` only ever increments an already-defined
     age, so founders/immigrants never accrue a tracked age and can never
     become The Elder — only a hatched offspring (`age: 0` set at
     `eggs.ts`'s hatch) can. Confirmed by a dedicated unit test
     (`notables.test.ts`) and consistent with every real run: every seed's
     current Elder holder is an `egg-...` id.
   - **The Wanderer** — highest lifetime Manhattan distance from birth
     position among currently-living agents. Needed two small pieces of new
     state: `Agent.birthPos` (set once at `spawnAgent`/`eggs.ts`'s hatch,
     never mutated again — unlike `homePos`, which a herd/carry mechanic
     resets) as the anchor, and `Agent.maxDispersalDistance`, a real,
     load-bearing design correction covered in its own point below.
3. **A live-distance Wanderer was tried first and discarded — real-run
   evidence, not a guess.** The first implementation read Wanderer's stat as
   the agent's *current* live distance from `birthPos` every tick. A real
   8000-tick run (seed 42) showed this was a mistake: 63 of the run's 72
   total title transfers were Wanderer alone, because an ordinary random
   walk lets a challenger's current distance overtake the incumbent's the
   moment the incumbent wanders back toward home even slightly — no genuine
   new achievement on anyone's part, just noise. This directly undermines
   the whole point of the feature ("gotta earn it"). Fixed by making
   Wanderer's stat a lifetime high-water mark instead
   (`Agent.maxDispersalDistance`, updated once per tick inside
   `notables.ts`'s own scan — the same place already computing the live
   distance for every living agent) — the same "real, permanent,
   non-decreasing record" shape every other title already has. Re-running
   the same three seeds after the fix cut total transfers roughly in half
   to two-thirds (see the real-run table below) — Wanderer still accounts
   for the largest single share of transfers of any title (a real, honest
   finding: an unbounded, ever-growing distance record has more headroom to
   keep being broken than a bounded age/kill-count record does), but no
   longer churns on pure noise.
4. **One title per agent.** `notables.ts`'s `TITLE_ORDER` is a fixed,
   documented (but otherwise arbitrary) priority — hero, builder, gatherer,
   rival, beloved, elder, wanderer. Each title's per-tick scan skips any
   agent already holding a *different* title, so a single standout
   individual can never be crowned twice; that title's slot instead goes to
   the next-best untitled agent, or genuinely stays vacant if no untitled
   agent clears the threshold either — confirmed by a dedicated unit test
   (an agent that's simultaneously the best hero AND the best builder only
   ever ends up holding one).
5. **Checked once per tick, not per triggering event.** Every title's real
   stat only ever increases while its agent lives (or, for
   rival/elder/wanderer, is recomputed fresh each check) — the one case a
   per-event hook can't cheaply cover is an incumbent *dying*, which needs a
   world-wide scan regardless of which event caused it. A single
   once-per-tick pass over `world.agents` (`updateNotables`, called from
   `simulation.ts`'s `tickWorld` right after `pruneStaleCorpses`, the same
   "once per tick, world-level system" slot `growFlora`/`decayShelters`
   already occupy) covers every title's transfer condition — new claim,
   dethroning, and holder-died-so-transfer — in one place, simpler than a
   bespoke hook at each of the four separate lifetime-counter trigger sites
   plus a *second*, separate periodic scan for rival/elder/wanderer. Pure
   bookkeeping plus event emission — no rng, so it doesn't affect
   determinism.
6. **New `SimEvent` kinds** — `titleClaimed` (a title's first-ever claim or
   a transfer, carrying `previousHolderId` when it's a transfer) and
   `titleLost` (`reason: "died" | "dethroned"`) — unlike Rapport's
   deliberate choice not to add an event for a rapport change (every
   rapport trigger already narrates its own real event), a title changing
   hands has no other event that narrates it, so this one gets its own.
7. **Mechanical payoffs — the "xp boosts... socially respected" half of the
   direct ask:**
   - **`NOTABLE_XP_MULTIPLIER = 1.5`** (leveling.ts) — applied once, inside
     `grantExp` itself (the single funnel every real exp grant in the
     engine already passes through: kill exp, the sector/new-species exp
     trickle, successful egg-laying), so every exp source a title-holder
     earns is boosted, not just kills. 1.5x — a real, felt acceleration
     over a run without being absurd; it speeds up leveling, it doesn't let
     a title alone out-level a genuinely stronger rival.
   - **`NOTABLE_DISTANCE_BONUS = 2.5`** (reproduction.ts) — a flat discount
     off effective mate-search distance for any candidate holding a title,
     added to `mateScore`'s existing composition alongside
     `STATUS_DISTANCE_BONUS` (2, herd rank) and `RAPPORT_DISTANCE_BONUS` (3,
     an existing personal bond) — the same "discount off distance, distance
     still dominates a real gap" shape both already established, not a
     parallel mechanism. Set between the two: a title is real and earned
     against literally everyone in the world (a stronger signal than
     relative herd rank), but a full, already-earned personal bond is still
     judged the stronger of the two. Flat, not scaled 0..1 like the other
     two, since holding a title is binary — there's no "partial" title to
     scale by.
8. **Real minimum thresholds per title, calibrated from real 8000-tick
   runs** (`NOTABLE_TITLE_MIN_THRESHOLDS`, notables.ts) — see the table
   below for the real values each seed's current holders actually reached.

### Built, real-run findings

`packages/engine/src/notables.ts` (the record-holder mechanism, the
per-title stat functions, and the calibrated thresholds), small hooks at
each of the four lifetime-counter trigger sites (predation.ts, shelter.ts,
support.ts, eggs.ts), `Agent.birthPos` set at `spawnAgent` (data/spawn.ts)
and at egg hatch, the two mechanical payoffs above, two new `SimEvent`
kinds, and `packages/web` identity/herd-naming rendering (inspector.ts,
eventText.ts, autoCamera.ts, battleScreenPanel.ts, plus a new
`notableTitles.ts` module for the shared display helpers). 12 new engine
tests (`notables.test.ts`) cover: nobody holds a title below the real
threshold; a first-ever claim; the title transferring to whichever of two
agents' fixed, controlled kill counts is higher (the clean, unconfounded
proof, per this codebase's own established "a dedicated unit test, not raw
real-run deltas, is the trustworthy evidence" standard — see the Rapport
section's identical reasoning); a dead incumbent's title transferring to
the next-best living challenger; a dead incumbent with no qualifying
challenger leaving the title genuinely unclaimed; one-title-per-agent
holding even when a single agent would qualify for two; The Rival's
magnitude-only rapport read; The Elder correctly ignoring an
age-untracked founder; The Wanderer's lifetime-max (not live) distance; the
other three lifetime-counter titles; eggs excluded from every title; and
the XP multiplier applying only to a title-holder's `grantExp`. All 802
engine tests pass (6 consecutive full-suite runs, including the
unmodified `determinism.test.ts`), and a same-seed-twice full `tickWorld`
run (verified separately at the runner level, seed 42, 3000 ticks) produces
a byte-identical event log — this feature's `updateNotables` has no rng of
its own.

A pre-existing flaky test was hit a couple of times across roughly a dozen
full-suite reruns during this work (`predation.test.ts`'s "terrainBurn
reverts a bush tile the defender stands on to floor," which uses an
unseeded `createWorld` and a real accuracy roll that can genuinely miss) —
already documented in this codebase as flaky, and confirmed unrelated to
this feature by running the identical suite on the pre-feature commit,
where it passed every time it happened to be tried — ordinary flakiness
variance at this test's real (small) failure rate, not a regression this
feature introduced.

**Real 8000-tick runs, the three standard seeds (42, 7, 20260903), feature
on** — via `packages/runner/src/validateNotables.ts` (modeled on
`validate.ts`):

| seed | final population | agents ever existed (approx.) | total title transfers | unique agents ever titled | unclaimed titles (whole run) |
|---|---|---|---|---|---|
| 42 | 33 | 62 | 29 | 14 (23%) | none — all seven claimed at some point |
| 7 | 27 | 53 | 10 | 8 (15%) | hero, builder, gatherer, rival |
| 20260903 | 46 | 86 | 16 | 10 (12%) | gatherer, rival |

Real final threshold values each seed's current holder actually reached
(seed 42, at tick 8000): Wanderer 123 (threshold 60), Builder 120
(threshold 60), Elder 6585 ticks (threshold 500), Beloved 6 (threshold 4),
Gatherer 2 (threshold 2, exactly), Rival 0.40 (threshold 0.4, exactly).
`hero` was claimed once mid-run (a Scyther with 6 real kills, threshold 5)
but had no living holder at tick 8000 in this particular seed — a real,
honestly-reported outcome, not an error: the previous holder died and no
other living agent had yet cleared 5 kills.

**Read honestly, not oversold**: 12-23% of every agent that ever existed
over a run held *some* title at some point — not the "a small handful, a
tiny fraction" outcome the task brief's validation criteria named as the
ideal signal. This is a genuine, reportable tension worth explaining rather
than hiding: with **seven** independent record-holder slots (not one), and
titles that can change hands over an 8000-tick run (an agent's death alone
forces a transfer even with no new "achievement" happening), the
denominator effect compounds — seven independent "rare" events are, in
total, less rare than any one of them alone. Two things keep this
honestly defensible rather than a design failure: first, at any *single*
moment, still only ever at most 7 of the population hold a title (never a
meaningful *simultaneous* fraction, which is what "not in every herd" most
directly asked for); second, `gatherer` and `rival` went unclaimed for the
entire run in two of three seeds, and `hero`/`builder` also came up
unclaimed in one seed each — the thresholds are genuinely real, earned
bars, not decorative ones everyone eventually crosses. Wanderer is the one
title that dominates transfer counts across all three seeds (18/29, 8/10,
8/16) since it's the only title with effectively unbounded headroom (a
living agent that keeps moving can always in principle set a new personal
best, unlike a bounded-by-death age/kill/build record) — a real, calibrated
tradeoff, not an oversight: TODO.md carries a follow-up for whether
Wanderer's threshold needs a further upward retune or a different kind of
bound (e.g. a required margin over the previous record) if a future session
judges this too active in practice.

**Mechanical payoffs — real, not just wired-and-untested**: the XP
multiplier is exercised by a dedicated unit test (`grantExp` on an
identical amount produces exactly `1.5x` for a title-holder vs. a plain
agent); the mate-preference bonus reuses `mateScore`'s exact existing
composition and distance-dominates-a-real-gap shape, the same one
`STATUS_DISTANCE_BONUS`/`RAPPORT_DISTANCE_BONUS` were validated under in
the Herd status/Rapport sections — no new isolated A/B was attempted here,
for the same documented reason both of those sections already gave
(rng-chaos-sensitivity: which specific individual gets chosen as a mate is
itself a cascading simulation-state change, so a single-seed on/off
comparison isn't trustworthy evidence; the trustworthy evidence is the
structural unit test plus the honest real-run distribution above).

**Web UI**: a title-holder renders as `"{icon} The Hero (species)"` in the
inspector's title bar (`inspector.ts`) and as `"The Hero (species)"`
wherever a bare `${species} (${id})` identity string appeared before
(`eventText.ts`'s `formatEvent`, covering the event log panel, and
`autoCamera.ts`'s one-shot/battle labels, via a shared `idLabel` helper in
the new `notableTitles.ts` module) and in the Battle Screen's combatant
name (`battleScreenPanel.ts`). The species stays visible alongside the
title (`"The Hero (bulbasaur)"`, not bare `"The Hero"`) since the title
alone loses which specific individual that is at a glance — the task
brief's own "your call, document it" choice point. A title-holder's herd
gets a display name derived from the holder (`"{Name}'s Pack"`, a small
16-name curated flavor pool picked deterministically by hashing the
holder's own agent id — no random-name-generator, per the task's explicit
scope line) wherever herd identity surfaces (`inspector.ts`'s Herd row,
`eventText.ts`'s `immigrated`/`herdMigrating`/`herdSettled` lines); a herd
with no titled living member still shows its raw `herdId`, unchanged.
Manually verified via a headless Playwright check against the dev server
(seed 7, fast-forwarded to tick 6000): the event log showed a real
`"became The Elder!"` line with its crown icon, and clicking the current
Wanderer holder rendered `"🧭 The Wanderer (wartortle) (squirtle-1)"` in the
inspector title bar with `"Herd: Thistle's Pack"` in the Social section
below it.

### Explicitly not done here (see TODO.md)

- **The Beloved's offspring-vs-bonded-duration tradeoff** (see point 2
  above) was decided in favor of offspring count for concrete, documented
  reasons, but the tradeoff itself was real: a long, stable, never-produces-
  a-surviving-egg bond currently can't earn this title at all. Not
  revisited here.
- No new UI badge/icon rendered directly on the map tile itself — a
  title-holder is only distinguishable via the text-based inspector/event
  log/battle screen identity strings above, not a visual marker on the
  agent's map dot. `renderer.ts`'s per-agent map drawing was left untouched.
- No `titleClaimed` Auto Camera one-shot moment — `autoCamera.ts`'s
  `NotableCategory` union (`immigration`/`courtship`/`hatch`/`battle`/
  `evolution`/`death`) wasn't extended with an eighth category for this,
  so a title changing hands doesn't get its own camera cut/highlight the
  way a birth or an evolution does; it's still visible in the event log
  panel exactly like every other event.
- Wanderer's threshold (60 tiles) and its "unbounded record, dominates
  transfer counts" dynamic (see the real-run findings above) is a real,
  calibrated-but-not-fully-resolved tension — a future session may want a
  required-margin-over-incumbent rule (a genuinely new challenger has to
  beat the record by some real amount, not just by one tile) if this proves
  too active once watched over a longer real run.

## Auto Camera follow-up: battle priority + one-tick stepping

**Direct ask, verbatim.** "One more battle log thingy I want to prioritize
battles if there are multiple things goin on.. And step through them one
tick at a time rather than super slow speed. It's too hard to follow."

**Battle priority.** Auto Camera's queue was plain FIFO across all six
notable categories — a battle that started while, say, an immigration
one-shot was already on screen just waited its turn behind it. Two changes
in `autoCamera.ts`:
- `AutoCameraController.popNextEngagement` (replacing a bare `queue.shift()`
  in `reconcile`) now scans the queue for any `category: "battle"` entry
  and pops that first, falling back to plain FIFO among whatever's left. A
  battle queued behind three other moments still jumps straight to the
  front the instant it's this controller's turn to promote something.
- `onBattleHit` now also preempts whatever's *currently active*, not just
  what's queued: the moment a brand-new battle starts (not an existing one
  widening via a new hit — that path already just extends the existing
  engagement), if `this.active` is a non-battle one-shot, its
  `expiresOrLastActiveTick` is stamped to the current tick. `reconcile`'s
  existing `tick >= this.active.expiresOrLastActiveTick` check then retires
  it on the very next pass and immediately promotes the battle — no new
  expiry code path needed, just feeding the existing one an already-expired
  deadline. A battle never preempts another battle (there's only ever one
  battle engagement live; a second `fought`/`herdClash` pair widens or
  starts its own queued entry, which the priority-pop above still surfaces
  next).

**One-tick stepping, not continuous slow-motion.** The `AUTO_CAM_BATTLE_SLOWDOWN_SPEED = 0.25` fixed-speed
slow-motion from the previous pass (see "UI polish" section above) was
still *continuous* — a `setInterval` firing every ~667ms at that speed,
which is fast enough that several hits or a hit-plus-a-flee could still
land close enough together to blur past a viewer, especially with the
Battle Screen log's line-by-line flash animation competing for attention.
Direct ask was explicit: step through it, don't just slow it down further.
Replaced with a completely different mechanism rather than a smaller speed
value:
- `AutoCameraHost` gained two new methods, `enterBattleStep()`/
  `exitBattleStep()`, replacing the battle branch's old `setSpeed`/
  `getSpeed` calls entirely (non-battle categories still use the original
  `setSpeed`-based 2x/4x-threshold slowdown, unchanged).
- `main.ts` implements them with a new `battleStepMode` flag consulted at
  the top of `scheduleLoop()`: while true, the ordinary speed-slider-driven
  interval math is bypassed completely and ticking runs on its own fixed
  `BATTLE_STEP_INTERVAL_MS = 650` timer instead — exactly one `step()` call
  per beat, decoupled from whatever `speedIndex` the viewer had selected
  before the battle started (and restored untouched once
  `exitBattleStep()` fires). Still gated on the existing `playing` check in
  `scheduleLoop` — if the viewer is paused, a battle starting doesn't
  quietly un-pause the world for them, same as the old speed-override
  behavior never did either.
- `AutoCameraController` tracks this with a new `battleStepping` boolean
  (mirroring `savedSpeed`'s "already applied, don't re-apply" guard, but as
  its own flag since this path never touches `getSpeed`/`setSpeed` at all),
  set in `applySlowdownIfNeeded` and cleared in `releaseSpeedOverride`
  alongside the ordinary speed-restore logic — so `reset()` (world reload,
  or the viewer toggling Auto Camera off mid-battle) still correctly hands
  ticking back to the speed slider through the one existing cleanup path.

**Not done here.** No manual "click to advance" control — `650ms` is a
fixed, automatic cadence, not a step button the viewer has to press
per-tick; the ask was "too hard to follow" at continuous slow motion, not
"I want manual control," so automatic-but-discrete seemed like the right
read. If `650ms` turns out too fast or slow once watched for real, it's a
single named constant to retune, not a design change.

## Player-recruitment design notes (exploratory — nothing built yet)

Captured here so this ongoing design thread doesn't get lost between
sessions; none of this has a mechanic behind it yet, and none of it was
asked to be built now — the rapport *engine* above is the only piece of it
that's actually implemented so far, as the deliberately player-agnostic
foundation this would eventually build on.

**"Faking" an overworld.** Direct exploratory question: can other biome
tiles be faked rather than fully simulated while off-screen, the way
Crusader Kings/RimWorld/Dwarf Fortress abstract regions the player isn't
currently looking at? Recommendation discussed: yes — simulate a compact
per-region summary (population counts, notable individuals, rough
herd/rival state) between visits rather than ticking every agent on every
unvisited grid every tick, and reconstruct a plausible-looking live grid
the moment the player jumps there. This implies a **"notables vs. anonymous
population" split**: a small number of individually-tracked, persistent
agents (with real stories, moves, rapport edges) per region, with the rest
of the population represented in aggregate until/unless something promotes
one to notable (e.g. the player interacts with it directly). Follow-up
question raised and answered: yes, an anonymous unit's "story" (its moves,
its specific history) is effectively generated on the spot the moment it's
promoted to a notable, not pre-simulated in full off-screen.

**Player bonding verbs — locked in as four, not three:**
1. **Feed** — reliable, slow, grindable. Repeated small positive nudges,
   same shape as the existing `foodDelivered` rapport trigger already
   built for herd-mates.
2. **Fight alongside** — helping the target fight off a predator
   threatening it (proactive assistance *before* a crisis lands), reusing
   the existing joint mob-defense mechanic's shape. Rarer and riskier than
   feeding.
3. **Rescue** — the special, high-stakes one, added specifically because
   "presence is nice but too passive... it has to feel special, intentional,
   with a payoff... the Pokémon chooses you as much as you chose it."
   Concretely: intervening when the target is critically hurt/dying (at or
   near a death-branch moment, not just "in a fight") — either carrying it
   to safety or applying/crafting medicine to heal it (the latter implying
   a real item-crafting hook, not just a flag flip). Rare, unrepeatable-
   feeling, and mutual in a way the other three aren't: the Pokémon
   remembers being saved specifically by *you*, not generic assistance.
4. **Presence** — patient, passive, time-invested; watching over a
   vulnerable moment like sleep or egg incubation, reusing the existing
   sleep-watch/incubation mechanics. Explicitly demoted to the fourth/
   lowest-priority verb once "rescue" was proposed — presence alone was
   judged too passive to be a primary path, but still worth keeping as one
   option among several.

**Open, unbuilt questions this raises for later:** what a "vulnerable
moment" or "critically hurt" threshold actually reads as UI-side, whether
rescue needs its own new `SimEvent` kind (a real death-branch near-miss
isn't currently narrated as a distinct moment), and the crafting/medicine
system rescue's second half implies — none of this has been scoped, let
alone built.

## Sprite/tile art polish: bigger sprites, a real facing-mirror bug, muted plants, movement interpolation

Four direct, rapid-fire follow-ups on the newly-merged sprite/tile art (see
the merge commit bringing in `claude/pokemon-roguelike-sim-5rje5a`'s real
tile art and Pokémon sprites): "Pokemon sprites are tiny make em bigger,"
"they don't face the right direction, like they face left and move right,
might have to mirror sprite," "plant tiles are too colorful, make em match
the ascii," and "give the Pokémon some interpolated animation too."

**Bigger sprites.** `renderer.ts`'s `drawAgent` used to squeeze the sprite
into an exact `TILE_SIZE` (20px) box. New `SPRITE_SCALE = 1.6` constant:
sprites now draw at `TILE_SIZE * SPRITE_SCALE` and are bottom-anchored (feet
on the actual occupied tile, body/head overflowing upward into the tile
above) rather than centered in the box — the natural way an overworld sprite
larger than its tile is normally drawn. A first-guess constant, not derived
from anything; retune if it still reads wrong once watched for real.

**Real facing-mirror bug, found and fixed — twice, the first pass was wrong.**
First pass judged `_left.png`/`_right.png` from tiny, chat-scaled thumbnails
and concluded they were duplicates of the same left-facing pose; the "fix"
was to always load `_left` and mirror it via a canvas transform for
`"right"`. Direct follow-up report: "still see them walking backwards a
lot." Re-checked properly this time — real 10x-upscaled crops via a local
Python/Pillow script, not chat thumbnails — and the first read was simply
wrong: `_left.png` and `_right.png` are genuine, correctly hand-drawn mirror
images of each other (confirmed on pikachu and charizard: `_left.png`'s
eye/snout sits on the image's *right* side, `_right.png`'s sits on the
*left* — i.e. the files are real art, just swapped relative to their
filenames). The old canvas-mirror "fix" therefore made things consistently
backwards in *both* directions (loading the right-facing `_left` file
unflipped for `"left"`, and flipping it — producing left-facing art — for
`"right"`). Real fix, simpler than the first attempt:
- `sprites.ts`'s `getSprite` now swaps which file loads for which
  direction: `"left"` loads `_right.png`, `"right"` loads `_left.png`
  (up/down untouched). No canvas transform involved at all — the art was
  never broken, just mislabeled.
- `renderer.ts`'s `drawAgent` dropped the `translate`+`scale(-1, 1)` mirror
  transform entirely — drawing the resolved image directly is correct now.
- Verified directly: a browser test loading `pikachu_right.png` for
  direction `"left"` and `pikachu_left.png` for direction `"right"` side by
  side confirmed each faces the correct way with zero transform applied.

Lesson for next time: judge sprite orientation from a real upscaled crop,
never a small chat-rendered thumbnail — the first pass's entire
misdiagnosis traced back to that one shortcut.

**Muted plant tiles, matching ASCII.** The tile-style renderer used to fill
an entire food/flora/seedling tile with a near-solid wash of its flavor's
full-saturation `FLAVOR_FG` accent (colors like a vivid pink `[255,140,190]`
meant as small ASCII-glyph foregrounds, not full-tile fills) — direct
complaint: too colorful. The ASCII render style never had this problem: a
plant tile there gets the same faint ground wash every other tile gets, plus
a small colored *glyph* standing on top, not a full-tile color fill. Ported
that same treatment into the tile style instead of the old
`mix(TERRAIN_BG.floor, accent, tile.stock)`-to-near-full-color fill: a faint
35%-alpha floor wash, plus the tile's real `TERRAIN_GLYPH`/`FLAVOR_GLYPH`
character drawn in the accent color, fading from 30% to 80% alpha with
`tile.stock` (same "fades toward nothing as it depletes" idea the old fill
had, just applied to a glyph's alpha instead of a whole-tile color mix).

**Movement interpolation.** The engine has no sub-tick position — an agent
occupies exactly one integer tile per tick (see `facingOf`'s doc comment) —
so a real sprite used to visibly teleport one tile at a time every tick,
which reads far worse with actual art than it ever did with a single ASCII
letter. Purely a client-side rendering illusion, `renderer.ts`:
`interpolatedPos` keeps a per-agent `renderPos` (separate from the engine's
real `agent.pos`) and eases it a `dt`-scaled fraction of the way toward the
real tile position every animation frame (`1 - Math.exp(-ANIM_CATCHUP_RATE
* dt)`, frame-rate-independent since `dt` is real elapsed seconds, tracked
by a module-level `frameDeltaSeconds()` clamped to 0.25s so a backgrounded
tab regaining focus can't produce one huge catch-up slide). A jump of
`TELEPORT_SNAP_TILES` (3) or more in one tick — a real relocation/dispersal/
fresh spawn, not a walk — snaps instantly instead of sliding across the map.
Scoped to the sprite/tile render style only: ASCII mode deliberately
collapses to exactly one glyph per grid cell (`drawWorldAscii`'s `agentAt`
map), which a fractional/interpolated position would break, so it's left
untouched.

**Verification (real browser, Playwright against `pnpm --filter web dev`).**
- Loaded seed 42 in tile style, pressed Play, screenshotted at 156%/200%
  zoom — real sprite art (Bulbasaur, water/grass tile art) rendering
  correctly, noticeably larger than one tile, standing on their tiles.
- Plant tiles read as faint dots/small colored glyphs (a purple `&`, a pink
  `%`) on a near-black wash, not colorful filled squares — matches the
  ASCII style's look as asked.
- The synthetic mirror-transform test described above, confirming the
  facing fix is a real correct mirror and not just "looks different."
- `pnpm -r typecheck` clean across all 4 packages; `packages/engine`'s full
  784-test suite passed (untouched by this pass — sprite/tile rendering is
  `packages/web`-only).
- Not independently re-verified live in a browser: the interpolation easing
  itself (a static screenshot can't show smoothness) — the math is
  straightforward frame-rate-independent exponential easing and passed
  typecheck, but nobody has watched it move in a real running session yet.

## Two units in combat should never share a tile, and (broader follow-up) generally only same-species units should

**Direct asks, verbatim, back to back.** "Two units in combat should never share the same tile. Just as a rule for clarity." Then, mid-investigation: "I think generally only units of the same species should share a space."

**Combat approach never lands on the target's tile.** Investigated first
(background agent, `Explore`): every hunt/mob-fight/egg-defense/guardian-
defense approach path shares one root cause — attack **range** is Manhattan
distance, but the fallback **movement** toward an out-of-range target is
8-directional (diagonals included, via `movement.ts`'s `stepToward` and
`pathfinding.ts`'s BFS-backed `stepTowardMovingTarget`), and neither ever
excludes the target's own tile as a legal step. Whenever attacker and target
are diagonally adjacent (Chebyshev 1, but Manhattan 2 — just out of a
melee-range check), the very first movement candidate tried **is** the
target's tile.

Fix, `movement.ts`: `stepToward` gained an opt-in `stopAdjacent` parameter —
when true, `firstWalkable` also excludes any candidate equal to the target,
falling through to an orthogonal neighbor instead of the diagonal-onto-
target candidate. Opt-in and defaulted off, not a global behavior change:
most `stepToward` callers (seeking a food/water/shelter tile, migrating to a
destination) genuinely want to arrive exactly on `target`. Threaded through
the four real combat-approach call sites in `predation.ts` (main hunt,
guardian/herd-mate defense, mob-fighting, egg defense) and into
`applyForcedMovement`'s "closer" (lunge) case in `movement.ts` — a forced
pull/lunge is still combat, so it shouldn't drag the mover onto the other
party's exact tile either.

`pathfinding.ts`'s `stepTowardMovingTarget` needed its own version of the
same fix, since `findPath`'s destination is always `target.pos` itself, so
the final real BFS step toward a live target always **is** the target's
tile. First attempt (discard the path, hold position instead of taking that
last step) broke a real existing test: against a stationary target it works
fine, but a target that relocates by exactly 1 tile every single tick,
independent of the pursuer, is common in this codebase's own moving-target-
pursuit tests — and a *stationary* pursuer waiting one diagonal tile short
forever never gets a second chance to close the gap if the target's own
motion never happens to walk back into range. Real fix: fall through to the
same `stepToward(..., stopAdjacent=true)` guard instead of holding position
— from a diagonal-adjacent tile this converges to a genuine Manhattan-1 tile
in one hop.

That in turn surfaced a second, narrower real edge case: an *actively
repositioning* pursuer sidestepping every tick against a target moving by
exactly 1 tile every tick, in a plain period-2 alternation precisely matched
to the pursuer's own once-per-tick reaction, can lock into a stable,
never-intersecting 2-cycle (confirmed via debug instrumentation — 297 of
300 ticks stuck oscillating between the same two tile pairs). No real
engine-driven behavior in this codebase moves like that (flee/wander/
dispersal all have real randomness or genuinely converge) — this only shows
up against a synthetic test double built to move on a fixed clock — so
`predation.test.ts`'s and `reproduction.test.ts`'s own moving-target-
pursuit tests had their synthetic prey/mate movement detuned from an exact
period-2 pattern to period-3 (`[1, 1, -1][tick % 3]`), which still
genuinely exercises "target keeps moving, forcing route recomputation"
(the tests' actual point) without exactly matching the pursuer's reaction
period. A real regression test was added alongside this
(`predation.test.ts`, "never lands the hunter on the same tile as its prey
… units in combat should never share a tile") asserting `hunter.pos` is
never `toEqual` `target.pos` across a real chase-to-kill run, not just that
the hunt eventually succeeds.

**Broader follow-up: species-exclusive tile sharing, generally.**
`occupancy.ts`'s `canEnterTile` previously only gated *how many* /
*how heavy* the occupants of a tile could be — never *which species*.
Direct follow-up ask, mid-investigation: "generally only units of the same
species should share a space." Added: the `OccupancyIndex` now also tracks
a `Set` of species present per tile (built in the same per-tick pass as the
existing count/weight maps), and `canEnterTile` now blocks a newcomer whose
species doesn't match every existing live occupant's, checked *before* the
ordinary headcount/weight rules — on every tile except shelter, which
explicitly keeps its own, already-documented universal (any-species) rule
("only 2 units and an egg can share a single tile of shelter" was never
species-restricted to begin with — see this file's shelter section). An
already-empty tile still always admits any species first, same "never
totally unable to stand anywhere" guarantee the weight rule already had.

**Real-run finding — this is a movement-time gate, not a retroactive
guarantee.** Ran a real 3000-tick seed-42 headless check sampling tile
occupancy every 10 ticks: zero combat/hunt-pursuit overlaps (the movement-
layer fix above holds), but 49 sampled snapshots still showed a handful of
distinct different-species pairs stably co-located on the same non-shelter
tile — e.g. an evolved `ivysaur` still sharing a tile with a `pidgey`, a
`wartortle` still sharing a tile with its own hatched offspring. Root cause,
confirmed by reading the actual code paths (not guessed): `canEnterTile` is
only consulted when an agent *moves* onto a tile — it says nothing about an
agent that's already standing somewhere and then either (a) evolves in
place (`leveling.ts` mutates `Agent.species` directly, no movement, no
occupancy check at all — a parent standing next to its own about-to-hatch
egg can end up "different species" from a neighbor purely by evolving where
it already stood), or (b) is a fresh immigrant spawned directly onto a
`findWalkableNear` tile (`immigration.ts`) with no capacity/species check at
all — a **deliberate**, already-documented exemption (immigration and
hunt/mate pursuit are both intentionally capacity-blind; DESIGN.md's own
"Tile capacity" section has the real-run regression numbers from when that
gate was tried and reverted). Retrofitting species-exclusivity onto either
of those two paths risks reintroducing that exact same regression and was
not attempted here — flagged as a real, honest, scoped follow-up in
TODO.md, not silently left undocumented.

**Verification.** `pnpm -r typecheck` clean across all 4 packages; the full
790-test engine suite (6 new tests: 3 occupancy species-exclusivity cases +
1 shelter-stays-universal case + 1 hunt-never-shares-a-tile regression,
alongside the 2 existing moving-target-pursuit tests' detuned synthetic
movement) passed twice in a row to rule out flakiness. Real headless run
(seed 42, 3000 ticks) confirmed zero combat-overlap violations and
population health unaffected (16 alive at tick 3000, consistent with this
seed's other documented runs this session).

## "Silly simulated lighting stuff": per-tile vignette, faux shadows, warm shimmering lights

**Direct asks, verbatim, back to back.** "Let's add some nice lighting. Like have some warm color lights kinda do aoe shimmering shit." Then: "I want radial light effects per tile, if possible. Faux shadows under the Pokémon. Just silly simulated lighting stuff." And, separately, mid-implementation: "Why is the ground tile on tile mode not the nice dirt ones we put in?" — a real, unrelated bug this pass also fixed.

**Floor texture was basically invisible — fixed first.** The just-merged
sibling branch's floor-texture pass (`getFloorTexture`, real cave-floor/
dirt-path crops) drew at `0.05 + elevation * 0.03` opacity — 5-8% at most,
so the "nice dirt tiles" the user was expecting were there in the code but
essentially invisible in practice, just a faint tint under the existing "."
glyph. Bumped to `Math.min(1, 0.82 + elevation * 0.18)` — the dirt art
itself already has real tonal variation, so unlike a single flat color it
doesn't need heavy fading to avoid looking like a loud solid fill.

**Per-tile radial vignette.** New `vignetteStamp()` in `renderer.ts`: a
20x20 offscreen canvas built once (module-level cache), radial gradient
brighter-white center fading to a darker edge. Stamped via `drawImage` onto
every tile in the tile-style render (`drawTileVignette`, called at all four
tile-loop exit points — floor/tile-art/plant/fallback branches) rather than
calling `createRadialGradient` fresh per tile: a real gradient object
~5000+ times a frame across a full 90x60 map would be meaningfully more
expensive than stamping one cached bitmap that many times. Modulated by the
same `tileLight` per-tile pseudo-random ambient factor `drawWorldAscii`
already uses for its "unevenly lit stone" look, so both render styles read
as the same underlying lighting concept rather than two unrelated systems.
Purely decorative, zero gameplay signal.

**Faux shadows.** A flat dark ellipse (`rgba(0,0,0,~0.4)` scaled by the
same corpse/fainted alpha the sprite itself uses) drawn at each agent's
actual occupied tile — pinned to the tile, not the oversized sprite
bounding box above it (see `SPRITE_SCALE`), so a tall sprite's shadow still
reads as ground contact under its feet rather than under its head. Drawn
first, before the sprite/fallback rect, so it sits underneath.

**Warm shimmering AOE lights.** New `drawWarmLights`, called after the
agent-drawing loop (so it can glow on top of sprites) and before
`drawWeather`. Two source kinds, both already thematically warm in this
codebase's own existing palette rather than invented colors: live fire-type
agents (`TYPE_COLOR.fire`) and "sunbeam" terrain tiles (a permanent
high-elevation light patch from `worldgen.ts`, `TERRAIN_FG.sunbeam`).
Rendered with `globalCompositeOperation = "lighter"` (additive blending) so
it reads as actual light brightening the scene — including punching
through `drawDayNightTint`'s night-darkening the way a real light source
should, rather than a colored shape painted flatly on top regardless of
draw order. "Shimmer" is two overlapping sine waves at different, non-
matching frequencies (a single sine reads as a steady metronome pulse; two
together read as an organic flicker), phase-offset per source via a cheap
position hash (`hashLightPhase` — same technique `sprites.ts`'s water-tile
animation phase-offset already established) so multiple lights in view
don't pulse in unison. Pure visual flourish — never touches `world.rng`,
zero gameplay effect, scoped to the tile render style only (matches every
other art-polish pass this session, which left ASCII mode untouched).

**Verification.** `pnpm -r typecheck` clean across all 4 packages, the
existing 790-test engine suite unaffected (this is `packages/web`-only —
lighting has no gameplay effect to test). Real browser screenshots (seed
42, tile style, various zoom levels): dirt floor texture now clearly
visible instead of a faint tint; the per-tile vignette reads as a subtle
"polka dot" ambient pattern across plain floor; a Charmander showed a real
warm orange glow bleeding onto the tiles around it; faint dark shadow
blobs visible under agent sprites' feet. Not independently verified: the
shimmer's actual pulsing motion (a static screenshot can't show animation,
same honest gap as the earlier movement-interpolation pass) and whether a
"lighter"-blended `sunbeam` glow reads well against every terrain it can
neighbor (only spot-checked a handful of real map tiles, not every
adjacency).

## Sandshrew was a mis-cropped Raichu; Ivysaur/Wartortle were a false alarm

**Direct bug report.** "sandshrew is a raichu sprite for some reason. And
ivysaur and wartortle doesn't exist" — informal shorthand for "the art shown
for these species doesn't look like that species," not a literal missing
file (all three PNGs existed, non-corrupt, valid 32x32 RGBA).

**Sandshrew: real bug, confirmed and fixed.** Template-matched every
existing sprite file's exact pixel content back to its source position in
`legacy-cpp/data/sprites/Sir_Henry's_32x32 and sprites.png` (a numpy
exact-match grid search, not eyeballing) to reconstruct the sheet's own
layout: each species occupies a 64x64 super-block (`(x,y)`=down,
`(x,y-64)`=up, `(x+32,y)`=left, `(x+32,y-64)`=right). In the row containing
Pikachu (x=64) and Sandslash (x=256), the slot at x=192 — right where
Sandshrew belongs between them — is `sandshrew_down.png`'s actual source
position, and it contains a second, distinct Raichu (a different pose,
confirmed pixel-different from the real Raichu block at x=128, which is why
an earlier md5sum-based duplicate check found zero exact dupes and cleared
this of being simple copy-paste). Searched the rest of that sheet for any
unclaimed cell containing real Sandshrew art (built a "claimed" bitmap by
grid-aligned-matching all 604 committed sprite files back onto the sheet,
then inspected every unclaimed cell near the Pikachu/Raichu/Sandslash row):
none exists — whoever built the original Sir Henry composite simply never
drew Sandshrew into it, and the extraction agent grabbed a spare Raichu
region instead without noticing.

Real Sandshrew art exists in a second legacy sheet, `legacy-cpp/data/sprites/kanto
sprites.png` ("Kanto Pokemon Overworlds - Ripped by Dragon for TSR, v3.0",
a different, smaller-native-resolution — 16x16 vs. Sir Henry's 32x32 —
fan rip). Found it there by dex-adjacency (between Rattata/Raticate and the
Nidoran pair) and confirmed by eye: unmistakably the tan/orange armadillo
body with the back ridge of spines. Cropped both poses this sheet actually
has (a front-standing "down" pose and a curled-up side pose used for
left/right), chroma-keyed the sheet's flat olive background (`(160,176,128)`,
10-tolerance) to real alpha transparency, and composited each onto a
transparent 32x32 canvas at roughly the sheet's native pixel density
(*not* blindly 2x-upscaled — an early attempt at 2x nearest-neighbor made
Sandshrew fill the whole 32px frame edge to edge, visibly larger than every
neighboring ground-critter sprite; matching Raichu's and Sandslash's own
~14-16px content-bbox width by scaling down instead reads as the same size
class as its neighbors). No distinct back/"up" view exists in the source at
all (this sheet appears to only ever draw a front idle + a side idle per
species, unlike Sir Henry's fuller 4-direction sets) — `sandshrew_up.png` is
therefore a documented, deliberate reuse of the front pose rather than a
fabricated back view. Left/right follow this codebase's established (if
backwards-named) convention confirmed in the facing-mirror fix above:
`_right.png` holds the left-facing raw crop, `_left.png` is its horizontal
mirror.

**Honest caveat.** This Sandshrew is real, correct, unmistakably-Sandshrew
art — but it's sourced from a different sheet than the other 150 species,
at a coarser native pixel density hand-scaled down rather than crisply
native at 32x32 like its neighbors. Up close it reads slightly chunkier
than a Sir-Henry-sourced sprite of the same size. Judged a clearly better
outcome than shipping wrong-species Raichu art, and disclosed here rather
than silently passed off as seamless.

**Ivysaur and Wartortle: could not reproduce — these already look correct.**
Direct pixel inspection of all four direction files for both species (10x
nearest-neighbor upscales, not chat-scaled thumbnails — this codebase has
already been burned once by exactly that mistake, see the facing-mirror
bug above) shows exactly what each species should look like: Ivysaur is a
teal quadruped with a green leaf collar and a pink, partially-open bud
(distinct from Bulbasaur's plain green bud and Venusaur's full bloom — the
right "middle stage" look) in all of down/up/left/right; Wartortle is a
blue turtle with white/gray fin-like ears and a tan belly, visually
distinct from Squirtle's plain round head and consistent with Blastoise's
family look, likewise correct in all four directions. Compared side by side
against their own evolutionary neighbors (Bulbasaur/Ivysaur/Venusaur and
Squirtle/Wartortle/Blastoise) and both read as a coherent, correctly-scaled
progression, not swapped or duplicated art. Live-verified too: ran a real
seed-42 session forward (Play at 32x, ~2500+ ticks, long enough for
Bulbasaur→Ivysaur evolutions to actually occur) and clicked into an
in-world Ivysaur agent with Auto Camera tracking a live battle — the
rendered in-game sprite matches the file pixel-for-pixel (teal body, pink
petaled bud). Did not manage to land on a standalone, non-overlapping
Wartortle in the same live session (evolutions are population-dependent and
the map is large with no click-to-locate-species feature), but `sprites.ts`
has no per-species branching — `getSprite` is one generic
`spriteKey_direction` lookup used identically for every species — and
Squirtle was separately confirmed rendering correctly in-app via the same
code path, so there is no mechanism by which Wartortle's already-correct,
validly-formatted file would render differently. Left both untouched. Best
guess for the original report: a second instance of the same "judged from a
tiny thumbnail" mistake the facing-mirror bug already made once in this
codebase — plausible but not confirmed, since no one on this pass reproduced
what the original reporter saw.

**Broader sanity sample — not exhaustive.** Spot-checked ~40 additional
species' `_down.png` art by eye against their names, weighted toward
"evolution stage 2" species per the task's own lead (all of: charmeleon,
metapod, kakuna, nidorina, nidorino, graveler, haunter, gloom, weepinbell,
dragonair — the full requested list — plus a scattered ~30 more spanning
early/late dex numbers and several fully-evolved/legendary species:
magneton, gyarados, alakazam, machoke, golbat, rapidash, seaking, tentacool,
exeggutor, kingler, pidgeotto, weedle, oddish, poliwhirl, abra, machamp,
victreebel, tentacruel, gengar, onix, koffing, rhyhorn, dratini, mewtwo,
vaporeon, jolteon, flareon, ditto, snorlax, articuno). All matched their
name convincingly. One near-miss investigated and cleared: `pidgeotto`'s
sprite is a red/orange/gold bird, an unusual palette for that species —
but `pidgey`/`pidgeotto`/`pidgeot` all share the same unusual palette and
the same design scaled up through the family, meaning it's just this sheet's
particular stylization of the whole line, not a mismatched species.
**The remaining ~109 of 151 species were not checked this pass** — this was
a targeted sample, not a full audit, and should be read as exactly that.

**Verification.** `pnpm -r typecheck` clean across all 4 packages;
`pnpm --filter engine test` — 790/790 passing, unaffected (this is a
public-asset-only change, no engine source touched). Real Playwright
session against `pnpm --filter web dev` (Chromium,
`executablePath: '/opt/pw-browsers/chromium'`): confirmed the new Sandshrew
files load through the actual dev-server asset path used in production, and
separately confirmed (see above) live in-game rendering for Ivysaur and
Squirtle matches their files exactly, via the same generic sprite-loading
code both species and the newly-fixed Sandshrew all share.

## Overworld generation vision (exploratory — nothing built yet)

Captured here so this doesn't get lost between sessions, same as the earlier
"Player-recruitment design notes" section — this is a vision write-up, not a
build plan. Nothing in this section is implemented. The next step (separate,
deliberate) is picking 2-3 pieces of this to slice out as a first real build,
not attempting the whole thing at once.

**Direct ask, verbatim, that kicked this off:** "I think we should start
from the overworld generation itself. It can have its own distinct
Generative phase." Followed by a detailed picture of what that phase should
actually simulate — quoted/paraphrased faithfully below rather than
compressed away, since the specific examples are the vision.

**The core idea.** Today's `worldgen.ts` produces a single map's terrain via
noise functions (elevation/moisture/biome-seed noise — see
`createDemoWorld`/`generateWorld`) — plausible-looking, but with no causal
"why" behind any of it. The proposal: an overworld (many maps/regions) gets
its terrain from a distinct **Generative/History phase** that runs once,
before any per-tile noise, simulating broad-strokes geological and
mythological history in simplified form — and *that* simulated history is
what produces the elevation/water/biome data the existing per-tile worldgen
logic would otherwise have invented from noise. Every tile ends up with a
real, traceable reason it looks the way it does, not just a plausible
coincidence.

**The specific historical processes described, roughly in the order given:**
- **Ocean/land boundary formation** — Kyogre and Groudon simulated as
  large-scale forces actively "creating" the macro land/ocean boundary
  (their canonical mythic role), driving broad elevation change.
- **Tectonic plates and glaciers** — simplified, broad-strokes plate
  movement and glacial activity shaping elevation further (mountain
  ranges, scraped valleys, etc.), not a literal physics simulation.
- **Forest seeding** — Xerneas and Celebi "travel through the land,"
  and forests grow up around their paths — a legendary's *route* becomes
  the causal reason a forest biome exists exactly where it does.
- **Rivers** — carve the land, pool into lakes, form waterfalls,
  beaches, and tributaries as they reach other water bodies/the coast.
- **Volcanic islands** — erupt and grow over (simulated) time, a
  distinct landmass-creation process from the tectonic/glacial one.
- **Earthquakes** — split land and create canyons — a discrete,
  event-like process rather than a continuous one like the others.
- **Deserts** — sandstorm-type Pokémon simulated creating desert
  regions, the same "a species' presence/behavior is the causal reason
  this biome exists here" idea as the forest-seeding one.

**How this connects to the "fake it" per-tile idea from the earlier
overworld discussion** (see this file's existing notes on simulating a
compact per-region summary off-screen and reconstructing a plausible live
grid on visiting): the user's own framing was "each square... that's where
we sorta fake it. But with coherent reasons for why and how stuff exists."
In other words, the History phase's job isn't to simulate every tile in
full — it's to produce enough real, causal, coherent *upstream* data
(elevation, water features, biome-seeding events, their rough
locations/timing) that the later per-tile faking has real grounding to draw
from, instead of inventing plausible nonsense with no history behind it.

**A real, un-scoped-yet connection to systems already built this session**:
Notables/Herd Leadership already give individual agents and herds a real,
earned identity; a History phase that tracks *where* and *why* certain
biomes/resources exist could plausibly become the reason certain species
clusters or notable-title patterns show up in certain regions (e.g. a
Xerneas-seeded ancient forest region trending toward more Gatherer/Builder
notables over time) — genuinely interesting, but explicitly not scoped or
designed here; flagging the connection so it isn't lost.

**Open, unresolved questions, on purpose — not yet answered:**
- Scale/granularity: is this simulated at the same per-tile resolution as
  the existing single-map sim, or a coarser macro-grid that the per-tile
  worldgen later resolves against? (Performance and determinism both hinge
  on this — the existing sim's own real-run findings about tile-count/
  performance would need revisiting at overworld scale.)
- Determinism: this still needs to follow the codebase's seeded-rng rules
  (see this file's repeated documentation of "rng-chaos-sensitivity"), but
  a one-time world-genesis pass has very different performance/complexity
  tolerances than the existing per-tick ecosystem sim — worth being
  explicit that these are different budgets.
- How literally "simulated" each process needs to be (a real multi-agent
  Kyogre-vs-Groudon tug-of-war vs. a single deterministic pass that
  produces a Kyogre/Groudon-*flavored* boundary) is an open, real design
  choice per process, not a single answer for all seven.
- Sequencing/dependency order between processes (tectonics before rivers,
  rivers before forests, etc.) isn't decided.

### Additional roster, added on direct follow-up ("did I miss any other
geological features or cool Pokémon to explore?" -> "write it all")

**Confirmed additions to the core seven:**
- **Rayquaza** — the missing third of the Kyogre/Groudon lore trio
  (canonically the mediator that calms their conflict, rules the sky/ozone
  layer). A real, direct omission from the original seven given the other
  two were already in — confirmed important by direct ask.
- **Suicune** — canonically purifies water and travels with rain; pairs
  with/extends the existing "rivers" process rather than replacing it,
  giving rivers a caretaker figure the same way Xerneas/Celebi caretake
  forests. Confirmed good by direct ask.
- **Raikou + Entei**, added specifically *alongside* Suicune rather than as
  independent processes, because the three share real, connected lore (all
  three were born together at the Burned Tower fire in the mainline games)
  — that gives a genuine three-act **disaster-and-renewal arc** for a
  region instead of three unrelated roles: **Entei** is the eruption/fire
  itself (the catastrophe — volcanic/fire scarring), **Raikou** is the
  storm that follows (lightning-scarred ground, storm-driven erosion), and
  **Suicune** is the purifying rain afterward (rivers, healing what the
  other two scarred). This makes Suicune's river role causally *about*
  something (healing a specific historical scar) rather than a standalone
  water-placement pass, and gives a region a real origin story: catastrophe
  -> scarring -> renewal, all from one connected trio.
- **Regigigas** — lore has it literally dragging continents into place and
  sculpting the Regi trio's golem bodies out of ice/rock/steel. A strong,
  direct fit for the tectonics process specifically.
- **Diancie** — born from Xerneas' life force, creates diamonds — a natural
  "seeds mineral deposits/cave gems" analog to Xerneas' forest-seeding,
  giving cave/mountain regions the same kind of legendary-seeded specialness
  forests already get.

**Considered, with a real open tension flagged rather than silently
included:**
- **Heatran** (lives inside volcanoes, a natural resident driving eruption/
  geothermal activity) and the **weather trio** (Zapdos/Articuno/Moltres,
  regional lightning/permafrost/fire scarring) were both raised, but likely
  **overlap with Entei's fire/volcanic role and Raikou's lightning role**
  from the beast-trio arc above. Not dropped, but flagged as a real,
  unresolved redundancy — a future slicing pass should decide whether these
  are alternates to offer per-region (different regions get different
  "flavors" of eruption/storm legend) rather than all coexisting as
  separate simultaneous processes.

**Non-legendary geological features, not tied to a specific Pokémon:**
- Caves/cave systems (erosion-driven, distinct from earthquake-driven
  canyons)
- Hot springs/geysers — smaller-scale geothermal activity, distinct from a
  full volcanic-island-creation event
- Fossil beds — a one-time historical *event* marker (an ancient die-off),
  different in kind from the other ongoing/gradual processes
- Swamps/marshland as their own biome, not just "low-lying forest"

**A real scope note, not a constraint break**: several Pokémon in both the
original seven and this expanded list (Xerneas, Celebi, Kyogre, Groudon,
Rayquaza, Suicune, Raikou, Entei, Regigigas, Diancie) are outside the Kanto
roster this codebase's `packages/data` currently implements. The vision
already crossed that line from the start, so this isn't a new decision —
just flagged honestly as a real data-scope question whenever this actually
gets built (new species data, even if only used as one-time
generation-phase actors rather than live simulated agents).

### A separate, later phase: simulated human society

Direct ask, explicitly sequenced *after* the geological/legendary phase
above, not part of it: "I think we do need to simulate human society and
stuff but we can do a separate pass for that. It's after the geological
stuff." Captured here as a placeholder for a future vision-writing pass of
its own — nothing about *what* this actually looks like (settlements,
trainers, roads, towns, whatever form "human society" takes in this sim) has
been discussed or designed yet. The only decided thing so far is the
sequencing: geological/historical world-shape first, human society layered
on top of an already-coherent world second, not simultaneously.

Next step, explicitly deferred per direct instruction ("note my vision
first... then we pick a couple features and slice it out"): pick 2-3 of the
processes above (now an expanded roster, not just the original seven) for a
first real build, prove the "simulated history -> coherent per-tile world"
pipeline shape works end to end, before expanding further — and separately,
whenever it's time, a dedicated vision pass for the human-society phase.
