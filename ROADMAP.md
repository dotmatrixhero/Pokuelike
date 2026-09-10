# Roadmap: from a world you watch to a game you play

Written on a direct ask, after the rapport work landed:

> "We implemented rapport and stuff but for an actual player experience, we
> have a long way to go. Can you help make a plan for what's next?"

Yes. Here is where things stand, honestly:

- **The simulation is rich.** Ecology, herds with histories, predation,
  weather, crops, fire, moves and leveling, a chronicle, and now
  relationships that can say why they are what they are. All of it verified
  against real runs.
- **None of it is a game yet.** There is no player agent. The web app is a
  spectator: `setInterval` free-runs the sim, and no keyboard input exists.
  `computeVisible` — the whole field-of-view system — has **zero callers**.
  There is no `human` species. Nothing can be dropped, picked up, or crafted.

The design docs for the player are extensive (`PLAYER_MOVEMENT.md`,
`PLAYER_ACTIONS.md`, `PLAYER_INVENTORY.md`, the crafting set,
`SENSORY_LAYER.md`, `CAMPAIGN_DESIGN.md`, `EMERGENT_SITUATIONS.md`). What
they lack is a *sequence* — an order that lets each step be played and judged
before the next one is built.

That is what this is.

---

## The one question everything below exists to answer

`CAMPAIGN_DESIGN.md` names it, and it has not moved:

> "Whether 'earn a partner by reading the ecosystem' actually reads as a
> puzzle rather than trial-and-error is the one question that can't be
> answered on paper."

Every milestone here is the minimum needed to reach the point where that
can be tested by playing. Nothing below is on the list because it would be
nice; it is on the list because the test cannot run without it.

## The ordering rule

**Build the thinnest playable loop first, then add one system at a time,
each playable on its own.** Not the reverse — not "finish the systems, then
add a player." The earlier plan in `TODO.md` ("Track A: things buildable
without a player") was correct about dependencies and wrong about priority.
Tells and crafting data can be built without a player, but they cannot be
*felt* without one, and the risk in this project is not that a system won't
compile — it is that it won't play. Only a player finds that out.

So the player agent moves from the middle of the plan to the very front.

---

## Milestones

Each has: what it is, what genuinely has to be built, and **one thing you
can do when it is done** — the acceptance test is always a thing a player
does, never a thing a test asserts.

### M0 — Walk

A human on the map, moved by the keyboard, in the existing surface demo
world. The sim advances **one tick per player action** and otherwise waits.
The camera follows.

Build:
- A `human` `SpeciesDef` — none exists. Fragile stats, `homeLayer: surface`
  for now.
- `Agent.controlledBy: "sim" | "player"`. The behaviour tree skips a
  player-controlled agent; input decides its action instead.
- The turn gate in `main.ts`: replace the free-running `setInterval` with
  "advance when the player acts." The existing energy scheduler
  (`ACTION_THRESHOLD`, `accumulateActionEnergy`) stays — other agents still
  act at their own speeds within the ticks the player's actions release.
  `PLAYER_MOVEMENT.md` already specifies this.
- Arrow/hjkl movement, 8-way, respecting `canEnterTile`.
- Camera follow on the player.

**Done when:** you walk toward a herd and it moves away from you.

**STATUS: DONE.** Live in the app via `?player=1`: the tick sat at 0 for 3s
with no input, one keypress advanced 4 ticks (speed 9 against a threshold
of 40), eleven keypresses 47 ticks, camera followed, no page errors. The
flee itself was proven in node against the real `createPlayerDemoWorld`:
with the player two tiles from bulbasaur-0, it goes `idle → flee` on the
second turn, 17 flee events over six turns. 7 engine tests.

Two findings on the way, both recorded in code:
- `canEnterTile` is **occupancy only**. The first draft of the player move
  used it alone and walked through walls — caught by a test. Fix was to
  export the real step predicate (`movement.ts`'s new `canStepTo`: walkable
  or flyer, water, land, capacity) and have both the sim and the player use
  it, so the "forgot to wire the water check" class of bug the file warns
  about is closed for the player too.
- The browser check for the flee read `document.body.innerText`, which
  skips hidden elements; the Events tab was hidden, so it reported no flee
  while 17 had fired. Measuring nothing again. Verified in node instead.

Honest note on that test: prey flee via `isPreyOf(rules, …)`, which is keyed
by hunter species. A human is not in `HUNT_RULES`, so nothing will flee from
it by default. For M0, mark `human` as a hunter so the loop can be proven —
crude, and replaced in M6 by the real threat-signature design
(`PLAYER_INVENTORY.md`: speed, distance, posture).

**Why the surface, when the game is a cave:** because the surface ecology is
proven alive. If the player loop misbehaves here, the loop is at fault. In a
brand-new cave scenario, a bug could be either, and you would not know which.
One milestone on the surface, then underground for everything after.

**Risk:** this is the plumbing risk of the whole roadmap. Converting a
free-running sim into a gated one touches the scheduler, and the web app's
battle-step mode already owns ticking under some conditions. Expect this to
be the milestone that finds surprises.

### M1 — Cave

A hand-built layer-1 scenario: `createCaveScenario(seed)`, the same kind of
thing as `createDemoWorld`. Not a worldgen overhaul.

Build:
- Dark underground grid. A few passages. One lit chamber with `sunbeam`
  tiles, a lake, flora and food tiles, and deadwood placement gated to the
  sunbeams (the torch beat depends on this — `CRAFTING_LOOP.md`).
- One prey herd in the chamber. One species is enough. Pick from the roster
  by `homeLayer`/biome fit; Oddish or Sandshrew are candidates.
- The player spawns in the dark, some distance from the light.

**Done when:** you spawn in the dark and walk to the light.

**STATUS: DONE.** `?player=cave`. Live: spawned at (47,31) on `underground`,
tick held at 0 with no input, the 19-key BFS path replayed and landed on the
nearest sunbeam at (66,28) exactly, 71 ticks, no page errors. Screenshots
confirm the chamber draws — water pocket, food and flora, sunbeam floor,
four Sandshrew beside the player. Six data tests on five seeds assert the
property, not the instance: player and herd underground, ≥8 sunbeams, a
sunbeam reachable on foot from spawn at 16–42 steps, spawn tile unlit.

Two things this found:
- **The renderer was hard-wired to `surface` at ten sites** — tiles,
  agents, highlights, fire glow, hit-test. An underground agent "simply
  isn't drawn." Now `drawWorld` takes a `viewLayer` (module state, read by
  every pass) and the app draws the player's own layer. Prerequisite nobody
  had listed.
- **Reachability is by construction, not by luck.** The spawn is chosen by
  BFS from the water pocket at 22–40 walking steps, so "the light is a real
  walk away" is a property of the constructor on every seed, and the test
  pins it on five.

Not darkness yet — everything is fully lit, because FOV is M2. And the cave
floor draws with surface biome textures, since the tile pass has no
underground palette; cosmetic, parked.

**Risk — content, and it is real:** underground today is 95.75% floor, and
`assignGroundTypes`/`waterKind` are surface-only, so the cave has none of the
fertility economy or water variety the surface has. M1 does not fix that —
it hand-places what the opening needs. Making underground a *generated*
ecology is M7's problem.

### M2 — See

Field of view, at last. `computeVisible` exists, is tested, and is called by
nobody.

Build:
- Wire `computeVisible` to the player each turn. Fog-of-war rendering:
  unseen, remembered, visible.
- Darkness: sight radius ~4 without light (`NIGHT_FOV_PENALTY` is the
  existing lever). The lit chamber is the first place you can see properly.
- The renderer draws only what the player can see or remembers.

**Done when:** you cannot see the chamber until you are in it.

**STATUS: DONE.** `vision.ts` is the caller `computeVisible` never had:
`updatePlayerVision` runs at the end of every player turn and once at
spawn; `Agent.vision` holds the visible set and a per-layer explored set.
Three decisions made here, not in fov.ts: underground has no day (ambient
light is 0 unless you stand on or beside a sunbeam, then 1); a lit tile is
visible from up to 14 tiles away in the dark given line of sight, so the
chamber is a glow you walk toward rather than a surprise; memory is per
layer and only grows. Renderer: unseen tiles are solid dark, remembered
tiles dimmed, agents on unseen tiles are not drawn at all, and a click on
an unseen tile finds nothing. Measured (`runner/validateCaveVision.ts`, 8
seeds): no lit tile visible from spawn on any seed; first glow after 6–23
keys; 69 tiles visible in the dark vs 200+ in the chamber. Live
(Playwright, seed 20260903): fog pixel count off the canvas matched the
engine's set exactly (69 at spawn, 447 explored at the light); clicking an
unseen Sandshrew selected nothing, clicking the one in view selected it.
Also found and fixed: M1's macro-map hide set `hidden`, which the wrap's
own `display: flex` defeats — the panel was still there in the M2
screenshot. `.force-hide` now, and the canvas wrap measures 922px tall,
not 470.

### M3 — Need

Hunger and thirst on the player, and the consequence.

Build:
- Nearly free: the player is an agent, so `needs.ts` already decays its
  hunger/thirst. What is new is the *player-driven* satisfaction: a drink
  action at water, an eat action at a food tile.
- A death state and a game-over screen. Currently death just means
  `alive = false` and a corpse.
- Needs shown on screen. The inspector already renders them for any agent;
  the player's need to be persistent, not click-to-see.

**Done when:** you can starve.

**STATUS: DONE.** Two new actions, `eat` (e) and `drink` (q), in
`player.ts`. They go through the same `consume` the behaviour tree's
seekFood/seekWater arrive at, with the same stock depletion, grazing scar,
exp and `consumed` event — the sim does not know a human ate rather than a
Sandshrew. Eat needs a food tile underfoot with stock left; drink needs
water on your tile or any of the eight around it (you kneel at the edge).
A failed verb still costs the turn and the HUD says what was missing.
`Agent.lastActionOutcome` carries the result out of `tickWorld` for the UI.
Death was already real (`tickAgentNeeds` starves the player like anyone);
what is new is the screen: a game-over overlay whose cause is the last
logged event naming the player, in the log's own words, and R to restart
the same seed. Needs HUD top-right, always on, red under 25%.
Measured (`runner/validateCaveNeeds.ts`, 5 seeds): food 18–33 keys from
spawn, eat succeeds on every seed; water 1–7 keys past it, drink succeeds;
a player who only waits dies of thirst at tick 1670 on every seed (thirst
decays faster than hunger: from full, ~1520 ticks to empty plus a 150-tick
grace). One meal restores 0.4. Live (Playwright): see the commit for the
HUD readings before/after e and q, the death screen's cause line, and the
restart.
Two things found on the way, neither fixed here: **energy is a meter with
no teeth for the player** — the only consumer of low energy is the
behaviour tree's sleep threshold, which the player skips, so it hit 25% by
tick 150 and 0% at death with no effect. A rest/sleep verb is a time-spend
with interrupt rules (PLAYER_ACTIONS.md) and belongs with M4's examine or
later, not here. And **death lifts the fog**: the renderer asks
`findPlayer`, which excludes the dead, so the death screen sits over the
whole cave. An accident that matches the roguelike convention; kept, and
named as an accident.

### M4 — Read

The free examine action and the tells — reading what a creature is doing
from the outside.

Build:
- `describeBehavior(world, agent)` → what an observer can perceive. This is
  the Track A item that never got built, and `EMERGENT_SITUATIONS.md` calls
  it the blocker for every player verb. Not eighteen distinct tells; a
  handful of readable states — feeding, drinking, travelling, stalking,
  fleeing, sleeping, carrying something, fighting.
- `examine` as a free action (no tick). Output: species name if known,
  what it is doing, whether it has noticed you. Prose under the CLAUDE.md
  rules: plain, specific, no ornament.
- The sensory layer's first slice from `SENSORY_LAYER.md`: hearing as a
  filter over the event stream ("something skitters away, behind you").
  Only if cheap; the tells are the priority.

**Done when:** you can tell a drinking creature from a fleeing one from a
sleeping one by looking.

**STATUS: DONE (tells + examine; the hearing slice was not attempted).**
`tells.ts`: `describeBehavior` gives one plain sentence per readable state,
and where the sim knows the specific thing the sentence says it — "The
Charmeleon is stalking the Rattata.", "The Rattata is running from the
Charmeleon." (a new `Agent.fleeingFromId`, set at predation's two flee
sites, because "running from something" is the vague word that means the
data is missing), "The Sandshrew is travelling east with its herd.",
"The Machop is carrying the Rattata." `examine` adds the second sentence:
"She has seen you." / "He has not noticed you.", using the same
flee-detection radius and line of sight predation uses, so "has seen you"
means "will react to you". Dead, down, asleep and egg come before
behaviour. Examine is free: `x` selects the next creature you can see,
nearest first, no tick; the inspector opens with a "What you see" group in
player mode. Sampled on real runs (`runner/validateTells.ts`, 3 seeds ×
2000 ticks, 1511 reads): wandering 37%, training 31%, foraging 7%, with
its herd 6%, building a shelter 5%, travelling 3%, looking for water 2%,
running from X 2%, down 2%, drinking 1%, eating 1%, fighting X 1%. The
sample caught one bad line, "is wandering nowhere" (explore target on the
agent's own tile), fixed and tested. Never seen in the sample: carrying
food (deliverFood — the known unreachable `foodDelivered`) and eating from
a carcass. Also this round, a direct ask outside the roadmap: a
**Watch / Play** switch in the header — Watch is the spectator app with
nothing hidden, Play is the cave.

### M5 — Make

Search, inventory, crafting, and the torch.

Build:
- `InventoryItem` gets a stack count. It is `{itemKey, weight}` today and
  only `support.ts` uses it, for one item key.
- `search` as a time-spend: harvest from the tile you stand on into inventory
  (lichen, deadwood, berries). Goes straight to inventory — no items-on-tiles
  needed yet.
- The crafting data model in `packages/data`: recipes, materials, harvest
  sources, tool gates, from `CRAFTING_TREE.md`/`CRAFTABLES_V1.md`. **With the
  reachability test**: every recipe's inputs resolve, no cycles, every
  material has a source, the first-playable set is reachable from an empty
  inventory. This is the automated form of "unreachable content is a bug" and
  would have caught the camouflage-cloak hole without a paper prototype.
- `craft` as an interruptible time-spend, per `CRAFTING_LOOP.md`. Known
  recipes only; known-but-unmakeable shown with what is missing.
- `equip`. The torch widens the FOV radius. **This is the payoff the whole
  opening is built on** (`PLAYTHROUGH_ACT1_FULL.md`: "the world doubles in
  size").

**Done when:** you light a torch and the world doubles in size.

**STATUS: DONE (first-playable cut).** Direct ask: "I do want like gather as
a verb/move. Inventory and stuff." Built per HANDOFF.md §3, in order:
`InventoryItem.count` and `inventory.ts` (one stack per key, stable
order); `harvest.ts` derives materials from terrain already on the map
(lichen on cave floor within 6 of water, deadwood within 2 of a sunbeam,
flint on rocky ground or beside a boulder, berries from a food tile,
herbs from the herbs crop), 3 takes per tile then bare, regrows one take
per 300 ticks; `packages/data/src/crafting.ts` holds exactly
CRAFTABLES_V1.md's ten-item cut with the doc's weights and turns, known at
start = fiber, cordage, bound haft, torch, club, poultice; the scenario
hands the tables to the world (`World.recipes`/`items`). Gather and craft
are time-spends through one `Activity` mechanism: start, then `continue`
per turn, anything else abandons it (turns lost, materials kept, nothing
consumed until the last turn). Equip: two slots; the torch changes exactly
one function, `ambientLightAt`. UI: `g` gather, `i`/`c` the pack menu
(carrying with tap-to-hold, known recipes with what is missing), Gather
and Pack buttons on the pad, a pack line in the HUD, auto-continue with
the same stop rule as tap-to-walk.
**Reachability tests** (`data/test/crafting.test.ts`): inputs resolve, no
cycles, the whole cut is reachable from bare-hand materials (order: fiber
→ cordage → haft → knapped flint → torch → knife → club → poultice →
pouch → cloak), and in the real cave lichen and deadwood are gatherable
within 60 steps on all 5 seeds (14–35 steps). **Finding: flint and herbs
exist on no cave seed**, so knapped flint, the knife and the poultice are
unreachable in the actual cave — recorded in TODO.md with the options.
**Measured live** (Playwright, seed 20260903): 18 keys to a tile yielding
both lichen and deadwood, two gathers, fiber, torch, walk back to spawn:
**69 tiles visible stowed, 149 held** — the world doubles (2.16×).
`runner/validateTorch.ts` on 5 seeds: 32–58 keys from spawn to a lit
torch. Fuel is not built (the torch burns forever) pending the ruling
below. Also found: the chamber's plants grow over the floor between
planning and arrival, so gather now works on flora and seedling tiles.

Deferred from here, deliberately: items on tiles (dropping, caches — needed
for the dispersal offer's "one armful", not for the torch), the wider item
catalogue.

**Tool-granted moves, built** (`MOVES_AND_TOOLS.md`) — direct ask: "I want
tool granted moves. That will truly unlock gameplay as we know it." A held
item now grants real combat moves onto `Agent.moves`, so a player `attack`
goes through the exact same `pickBestMove`/`resolveHit` pipeline any wild
agent's own attack does — the sim does not know a human swung a knife
rather than a Sandshrew's claw. Bare hands (a real Tackle — mid-ask
correction, "Tackle\*", not the first-drafted Scratch), flint knife
(Scratch), and club (**Pound**, not the first-drafted Body Slam — second
correction: "Club should not be body slam... Maybe pound?") all grant the
move **at full, unweakened strength** — the doc's original "60-70% power"
numeric rule was overruled outright, direct ask: "it should not be
weakened. Just make it a normal vanilla move." The slice rule (which move,
how much of its effect) is the entire balance lever now, not a power tax
on top of it. Two new items, axe and machete, exercise the doc's other
ask — MOVES_AND_TOOLS.md's generalised terrain effect
(`MoveSpec.terrainEffect`): an axe fells a tree (yields deadwood), a
machete clears brush (plus a real, full-power Slash) — the slice rule at
its clearest, gated by `terrainEffect.from` so neither tool does the
other's job. Verified two ways: 21 unit tests (engine + data), and a live
runner script against REAL scenario data — `validatePlayerCombat.ts` —
5/5 seeds felled a real tree for real deadwood, 3/5 landed a real hit on
a real wild Pokémon (the other 2 lost the chase within budget, same
moving-target difficulty `validateBond.ts` already documents, not a
regression). Full build, both corrections, and the live numbers are
in TODO.md's "Tool-granted moves" section.

### M6 — Bond

The game.

Build:
- **Threat signature** — the real version replacing M0's hunter flag. The
  player's flee radius on other agents is a function of speed, distance and
  posture (`PLAYER_INVENTORY.md`). `crouch` as an action. Moving slowly
  matters.
- **The four verbs wired to the player**: Feed (set food down; the existing
  `deliverFood` shape), Presence (stay near while it sleeps; the existing
  `sleptSafely`/`keptWatch` hook already fires for any awake agent nearby —
  the player just needs to *be* one), Fight alongside and Rescue (need
  danger; layer 1 has none, so these light up in M7).
- **Trust stages surfaced**: Wary → Tolerant → Curious → Bonded, driven by
  the rapport the player accrues through the same edges every other agent
  uses. A visible tell at each transition.
- **The dispersal offer** (`CAMPAIGN_DESIGN.md`): the two doors. This is the
  first explicit-decision moment in the game. It needs the disperser door
  (a real `disperse` roll on a bonded-enough individual, with the text) and
  the follower door (leaving the layer with a Curious partner). The "one
  armful" cache mechanic needs items on tiles — either build that here or
  ship M6 with the follower door only and add the disperser door in M7.
- A partner that follows. `carryAlly`/herd-cohesion movement already exists
  for agents following agents; the player is an agent.

**Done when:** something follows you out of the chamber.

**STATUS: 4 of 5 seeds followed out of the chamber** (`validateBond.ts`,
after lever 1, levers 2-6, and a numbers pass — "we need to bump our
numbers to make it easier. 4/5" — see this section's later paragraphs
and TODO.md for the full history). Target met; the dispersal-offer
overlay is the one Build item still not started (deferred until a
follower happened at all, which it now has):
- **Threat signature** (`threat.ts`) replaces the human's `isPredator`
  stopgap: base 1, crouched ×0.5, just moved ×1.25, club +0.5, torch +0.3,
  cloak ×0.6. Prey flee the player inside their own radius × signature ×
  trust. `z` crouches (a crouched step costs 1.5 turns). Prey never mob
  the player (traced: a Sandshrew walked up to a crouched, empty-handed
  human and started a fight).
- **Feed** — `o` sets a berry down beside you (`Tile.offeredBy`). A calm
  creature within 4 tiles takes it whether or not it is hungry, once per
  60 ticks (`applyTreatSeeking`; without this rule 28 berries across 5
  seeds went untouched, because chamber Sandshrew are never hungry), and
  remembers you (`receivedFood`, +0.08).
- **Presence** — `keptWatch`/`sleptSafely` fire for the player like for
  any awake agent; verified. The sleep gate now uses the trust-aware
  radius, else no creature would ever sleep within watch range of you.
- **Trust stages** (`trust.ts`): wary/tolerant/curious/bonded at rapport
  0.05/0.2/0.5, each shrinking the flee radius (×1, ×0.5, ×0.25, 0). Third
  sentence of examine: "She has stopped watching you." / "She comes a
  little closer." / "She stays beside you."
- **The follower door** — a curious creature within 3 tiles rolls 5% per
  player turn to follow (`startedFollowing` event), walks with you
  (`applyFollowing`, needs override), stops when trust decays to wary.
Measured (`runner/validateBond.ts`, a bot that gathers berries, chases the
nearest Sandshrew, crouches at 3 tiles, sets a berry down, backs off,
waits out the cooldown, repeats): treats taken 0–3 per seed, best trust
0.08–0.18 — **tolerant on 4 seeds, curious on none, so no follower**. Why:
rapport decays ×0.9977/tick (half-life ~300 ticks); at one 0.08 treat per
60-tick cooldown the ceiling is ~0.6, but the bot's real cadence (chasing
a roaming Sandshrew, restocking, drinking) is one treat per several
hundred ticks, and the stage decays between. Two deaths on the way: the
bot starved twice (its own upkeep), and on seed 202 it chased a Sandshrew
into the map edge; a cornered creature strikes back (existing rule), one
Fury Cutter fainted the 19-HP human, and the finishing-blow rule killed
it. Everything built is unit-tested (`bond.test.ts`, 11) and the offer,
crouch and treat paths were traced live in the cave. Rulings needed are
in TODO.md: the three thresholds, the decay, the treat delta and cooldown,
and whether a fainted player can be finished off.

**Lever 1, pulled: slower decay for the edge toward the player**
(`RapportEdge.towardPlayer`, `RAPPORT_PLAYER_EDGE_DECAY_PER_TICK` = 0.9995,
~1386-tick half-life vs. the ordinary 300). Re-measured, same bot, same 5
seeds: treats and best-trust both up on 4 of 5 (e.g. seed 40404: 0→4
treats, 0.18→0.22 best trust). **Still 0/5 followed.** Two seeds (11,
40404) actually crossed the 0.2 curious threshold mid-courting — but the
follow roll only fires within 3 tiles of the player, and the bot backs off
4 tiles right after every offer (to stay outside flee range while the
treat cooldown runs), so the trust window and the proximity window never
overlapped. Full before/after table in TODO.md's "M6 Bond, lever 1"
section. Decay was a real, necessary lever; on its own it isn't
sufficient — the proximity-window gap is a second, independent bug/lever,
not more of the same one.

**Levers 2–6, pulled together.** Direct ask, overriding my own narrower
recommendation of "just 1 and 2": *"I think all 6 are really good and
necessary to get a nuanced balanced thing here."* Built: the proximity fix
(`FOLLOW_ENTRY_RADIUS` 3→6, Chebyshev not Manhattan), the gift moment
(threat signature collapses to 0.1 for 60 ticks after a successful offer),
habituation (`Agent.timesFedByPlayer`, never decayed or pruned, up to a
+75% multiplier at 5+ prior feeds), herd spillover (a witnessed feeding
lifts nearby herd-mates 30% as much, tagged `witnessedKindness`), and
visit-based accrual (0.7× within 150 ticks of the last treat, 1.3× after a
500-tick gap). Loyalty/anti-dilution (the original lever 4) was folded into
spillover + habituation rather than built as its own mechanic, plus a bot
fix: court one individual instead of re-targeting "nearest" every loop.
19/19 unit tests (`bond.test.ts`) confirm each mechanism in isolation.

Combined, same 5-seed bot, best trust 0.10–0.21 (vs. lever-1-alone's
0.08–0.22) — comparable, not a clear win on the headline number. **But
seed 40404 crossed into `curious` and a follow roll actually fired
(`followTick: 2369`) — the first follower this project has ever
produced.** It didn't survive the bot's 25-tile walk-away test: trust
decayed back under the `curious` threshold before the walk finished, and
`tickFollowers` drops a follower once it does. So the proximity/trust
mechanics now demonstrably *can* connect — the remaining gap is that a
spike from one good feeding cycle decays faster than the walk-away test
takes. One seed (3003) starved to death mid-run (down from 3/5 in an
earlier, since-reverted "gather one berry at a time" bot experiment that
exhausted local food patches). Full table and root-causing in TODO.md's
"M6 Bond, levers 2–6" section.

Two findings surfaced along the way: the player's `energy` need had no
recovery verb, so a long courting session ran into the exhaustion speed
penalty with no way back — **fixed**: direct ask, "Wait should recover
[energy]." `wait` now sets `Agent.asleep = true` (needs.ts's existing
sleep state, reused rather than reinvented — the player is just another
agent to the sim), any other action wakes the player back up. And
`describeBehavior`/examine prose was deliberately NOT extended to mention
`timesFedByPlayer`, given that prose's documented fragility.

**Numbers bumped, target hit: 4/5.** Direct ask, "we need to bump our
numbers to make it easier," with a stated target: *"4/5."*
`RAPPORT_OFFERED_FOOD_DELTA` 0.08→0.12, `RAPPORT_PLAYER_EDGE_DECAY_PER_TICK`
0.9995→0.9997 (half-life ~1386→~2310 ticks), `TREAT_HABITUATION_STEP`
0.15→0.2, `FOLLOW_ENTRY_CHANCE` 0.05→0.08. Same 5-seed bot, plus the
wait/energy fix above and a tightened upkeep cadence (validateBond.ts was
checking hunger/thirst only every 10 chase-steps at a lower 0.45
trigger; now every 5 at 0.5): **4 of 5 seeds followed** (20260903, 11,
202, 3003 — all curious+, follower `true`). Full table and the one
remaining death's real root cause (not a bond number at all — a flora
tile that decays to 0 stock permanently reverts to bare floor,
independent of harvest.ts's faster `harvested`-counter regrowth; a long
enough courting session can graze an entire reachable region's food to
nothing) are in TODO.md's "M6 Bond: numbers bumped to 4/5" section.

**This is where the design's open question gets answered.** If a player who
has never read a design doc can work out that moving slowly, feeding, and
staying near a sleeping creature earns its trust — from tells alone — the
premise holds. If they cannot, the premise is wrong and everything after
this changes. There is no way to know earlier than this milestone.

### M7 — Climb

Layers 2–5 and the exit.

Build:
- Multiple cave layers and transitions between them. `crossedLayer` events
  exist; the underground/surface/canopy layers exist. What is new is
  *several* underground layers stacked.
- Predators on layers 2+. Fight alongside and Rescue become reachable.
- The stone and the exit.
- Underground as a generated ecology rather than a hand-placed chamber —
  the ground-type / water-kind / fertility work M1 deferred.
- The disperser door's "one armful," if it was deferred from M6.

**Done when:** you emerge.

---

## What this does NOT include, on purpose

- **Act 2 and 3.** The village, quests, humans. `HUMANS_DESIGN.md` is a
  design, not a plan; it waits on M6's answer.
- **The four unreachable-content findings** — `foodDelivered` (1 event in
  24,000 agent-ticks), `healAura` (0), `fire` (0), `sharedWater` (15). These
  are sim-health defects and none of them blocks the player path. They stay
  in `TODO.md` for a dedicated pass.
- **The wider crafting tree, tiers 3–4.** M5 ships the
  minimum: the torch chain and a few things that make the opening work.
- **Chebyshev range** (`PROMPT_chebyshev.md`), the elevation effect size, the
  battle-panel cadence — all still parked balance calls.

## Sizing, honestly

Not hours — I would be guessing. What is genuinely new versus wiring:

| | New | Wiring | Note |
|---|---|---|---|
| M0 Walk | human species, turn gate, input | camera | The turn gate is the only risky part |
| M1 Cave | the scenario | — | Content, and small if hand-placed |
| M2 See | fog renderer | `computeVisible` | The FOV maths is done and tested |
| M3 Need | death screen, HUD | eat/drink actions | Needs decay is free |
| M4 Read | `describeBehavior`, examine | — | The tells need writing, not engineering |
| M5 Make | stacks, search, recipe data, craft, equip | torch → FOV | Biggest engineering milestone |
| M6 Bond | threat signature, trust UI, the offer | the verbs | Biggest design milestone |
| M7 Climb | multi-layer, underground ecology, exit | predators | Biggest content milestone |

## Decisions needed before starting

1. **Surface first for M0, or straight into the cave?** Recommended:
   surface for M0 only, as argued above. It costs one milestone of not
   being in the real setting and buys certainty about which of two new
   things broke.
2. **Does the dispersal offer's "one armful" (items on tiles) land in M6
   or M7?** Recommended: M7. Ship M6 with the follower door — it is the
   door that guarantees the bond can complete — and add the disperser
   door with the cache once items on tiles exist.
3. **Is `human` a hunter for M0?** Recommended yes, as a stopgap flagged in
   code, replaced in M6. The alternative is building threat signature in M0,
   which puts design work in the plumbing milestone.
