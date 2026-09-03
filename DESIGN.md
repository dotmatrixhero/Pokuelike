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
