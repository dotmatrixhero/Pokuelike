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

Deferred from here, deliberately: items on tiles (dropping, caches — needed
for the dispersal offer's "one armful", not for the torch), the wider item
catalogue, tool-granted moves (`MOVES_AND_TOOLS.md`).

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
- **The wider crafting tree, tiers 3–4, tool-granted moves.** M5 ships the
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
