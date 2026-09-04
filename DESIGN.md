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
  (`Agent.types[0]`) plus a `SKILLPOINT_LEVELUP_WILDCARD_CHANCE = 0.1` roll
  for a wildcard point. **Real bug caught and fixed during validation, not
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

## Explicitly not decided yet

- Turn-based vs. real-time-with-pause for combat.
- How herd cohesion/regrouping actually works (shared home range? leader
  agent? flocking forces?).
- The move leveling/respec UI and how "build points" are earned and spent.
- The bonding "puzzle" mechanics per species beyond the shape described
  above (what the actual verbs/inputs are).
- Save format, map generation, dungeon structure/progression.
- Data source/legality for sprite art (bring-your-own for now).

See TODO.md for the running list of side notes to revisit.
