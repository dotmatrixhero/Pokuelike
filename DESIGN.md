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
