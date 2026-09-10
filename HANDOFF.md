# Handoff: the roadmap from M4 onward

For the next agent. This is prescriptive on purpose. Where it says "do X in
file Y" that is a decision already made with the code open, not a
suggestion. Where a decision belongs to the user it says so and gives the
menu. Read `CLAUDE.md` first, then `ROADMAP.md`, then this.

Contents:

- 0. The shape of what exists — files, functions, measured numbers
- 1. The protocol — the seven steps every milestone runs, and the traps
- 2. Hearing — the optional M4 leftover
- 3. **M5 Make — stacks, the crafting data model and its reachability
  tests, harvest sources, search and craft as time-spends, equip and the
  torch** (3.1–3.5)
- 4. M6 Bond — threat signature, the verbs, trust stages, the follower door
- 5. M7 Climb — chained layers, predators, the exit
- 6. Rulings needed from the user
- 7. Sizing

State at handoff (master, 2026-09-10): M0–M4 are built, verified live and
pushed. The player is a human in a cave with fog of war, hunger, thirst,
eat/drink, a death screen, and an examine verb that tells you what a
creature is doing and whether it has noticed you. `?player=cave` or the
**Play** button starts it. **Watch** is the spectator sim, nothing hidden.

---

## 0. The shape of what exists — what you are building on

One decision explains everything: **the player is an ordinary agent.**
`Agent.controlledBy === "player"` is the whole difference. `tickWorld`
skips the behaviour tree for that one agent and applies `queuedAction`
instead. Needs decay, action energy, predation, rapport, witness, leveling —
all real, all unchanged, all already happen to the player. When a milestone
asks "does the sim do X to the player", the answer is almost always "yes,
already"; grep before building.

| Thing | File | The functions you will call |
|---|---|---|
| Player | `engine/src/player.ts` | `findPlayer` (excludes the dead), `applyPlayerAction`, `waterWithinReach`, `foodUnderfoot` |
| Turn gate | `engine/src/simulation.ts` | `advancePlayerTurn(world, action, log, rules, ctx, rng, immigration, maxTicks)` — ticks until the player's action energy comes round and the action is consumed, then `updatePlayerVision`. One key press = 3–5 ticks for a speed-40 human. |
| Actions | `engine/src/types.ts` `PlayerAction` | `move`, `wait`, `eat`, `drink`. Add variants here; the `switch` in `player.ts`'s `apply` is exhaustive. `Agent.lastActionOutcome` carries `{action, ok, tick}` out of `tickWorld` for the UI. |
| Vision | `engine/src/vision.ts` | `updatePlayerVision`, `playerVisibleTiles`, `ambientLightAt`, `isLitTile`, `canPlayerSee`, `tileIndex`. `Agent.vision = {visible: Set<number>, explored: Partial<Record<Layer, Set<number>>>}` — tile indices `y*width+x`. `PLAYER_SIGHT_RADIUS = 7`, dark = 7 − `NIGHT_FOV_PENALTY` 2.5 ≈ 4.5. `LIT_TILE_SIGHT_RADIUS = 14`: underground, a lit tile with line of sight is visible at that range however dark it is where you stand. |
| Tells | `engine/src/tells.ts` | `describeBehavior(world, agent, {observer, name})`, `examine(...)` (adds "She has seen you."), `hasNoticed` (same radius + LOS predation uses). `Agent.fleeingFromId` set at predation's two flee sites. |
| Scenario | `data/src/scenario.ts` | `createCaveScenario(seed)`, `createPlayerDemoWorld(seed)`, `walkDistances(world, layer, from)` (BFS, string keys `"x,y"`), `CAVE_SPAWN_MIN_STEPS`/`MAX_STEPS` = 22/40. Chamber is painted around an underground water pocket: sunbeams, food, flora, 4 sandshrew. |
| Web | `web/src/main.ts` | `loadPlayerWorld(seed, scene)`, `enterWatchMode`, `playerAct(action)`, `PLAYER_KEYS`, `examineNext`, `renderPlayerHud`, `showGameOver`. `window.__pokuelike.world` on the dev server only. |
| Renderer | `web/src/renderer.ts` | `activeViewLayer` module state set by `drawWorld(..., viewLayer)`; `drawFog`; agents on unseen tiles are not drawn; `agentAtCanvasPos` returns nothing on unseen tiles; `drawDayNightTint` is surface-only. |
| Inspector | `web/src/inspector.ts` | `InspectorHooks.observer` → "What you see" group first. |
| HUD | `web/index.html` `#player-hud`, `#game-over` | Bars for HP/hunger/thirst/energy, `#hud-message`, `#hud-keys`. |
| Validators | `runner/src/validateCaveVision.ts`, `validateCaveNeeds.ts`, `validateTells.ts` | Run with `pnpm --filter @pokuelike/runner exec tsx src/<name>.ts`. Copy their shape for new milestones. |

Numbers you can rely on (measured, several seeds): 69 tiles visible in the
dark, 200+ in the chamber; first glow of the chamber after 6–23 keys; food
18–33 keys from spawn, water 1–7 past it; a player who only waits dies of
thirst at tick 1670 (from full: ~1520 ticks of decay + 150 grace). One meal
or drink restores 0.4.

---

## 1. The protocol — do this every milestone, in this order

This is the part of the handoff that matters most. The user's standing
expectation is empirical proof, and every "it works" claim in this session
that skipped a step was wrong at least once.

1. **Grep before building.** Half of each milestone already exists in the
   sim (needs, consume, deliverFood, keptWatch, herd following). Find it,
   wire it, report that it existed.
2. **Engine first, with unit tests** in `packages/engine/test/<feature>.test.ts`.
   Build agents by hand (see `player.test.ts`'s `human()` helper); use real
   constants, not tiny deltas that prune instantly.
3. **A runner validator** in `packages/runner/src/validate<Feature>.ts` that
   runs the real scenario on **5 seeds** (`[20260903, 11, 202, 3003, 40404]`)
   and prints a table. This is where "unreachable content" shows up. Every
   number in a STATUS line comes from here.
4. **Verification commands, real exit codes, never `-s`, never trust `$?`
   after a pipe:**
   ```
   pnpm typecheck > /tmp/tc.log 2>&1; echo "TC $?"; grep "error TS" /tmp/tc.log
   pnpm --filter @pokuelike/web build > /tmp/build.log 2>&1; echo "BUILD $?"
   pnpm test > /tmp/test.log 2>&1; echo "TEST $?"; grep -E "Tests |FAIL" /tmp/test.log
   ```
   The web build is what type-checks engine source as the app consumes it;
   the engine's own typecheck will not catch an exhaustive `switch` over
   `SimEvent` in `web/src/eventText.ts` or `runner/src/format.ts`.
5. **Live check with Playwright against the vite dev server** (`pnpm
   --filter @pokuelike/web dev`, port 5173; playwright is in
   `/tmp/node_modules`, chromium at `/opt/pw-browsers/chromium`; if `/tmp`
   was wiped, `cd /tmp && npm i playwright`). Read state from
   `window.__pokuelike.world`, not by scraping the inspector — it only
   shows the selected agent and hidden tabs are invisible to `innerText`.
   Measure the thing itself: computed style or a bounding rect, never the
   flag you just set; pixel counts off `#scene` for anything visual.
   Click tests must check the point is inside `#canvas-wrap`'s rect, not
   the window — clicks past the wrap land on the side panel and silently
   do nothing. Take a screenshot and look at it.
6. **Write it down**: `ROADMAP.md` gets a `**STATUS: DONE.**` paragraph with
   the numbers and what you found on the way; `TODO.md` gets a section of
   side notes and findings for the user's rulings. Quote the user's words on
   anything they originated.
7. **Commit with the milestone name, push to master** (the user authorised
   master pushes for roadmap work: "OK so merge to master"). One commit per
   milestone. Report regressions you caused prominently, with the number.

Traps this session hit, so you do not:

- `el.hidden = true` reads back true and hides nothing when the element has
  its own `display` rule. Use `.force-hide` (index.html documents it).
- `pkill -f vite` kills your own shell. Kill by PID.
- `findPlayer` excludes the dead. Anything that must keep working after
  death (the death-screen frame, replays) must look up `controlledBy`
  directly. This is why death currently lifts the fog.
- The renderer draws `activeViewLayer`; anything new that draws must use it,
  not `world.tiles.surface`.
- `setTile(world, layer, x, y, terrain)` is positional, not an object.
- Adding a `SimEvent` kind: add a case in `eventText.ts` and `format.ts` or
  the web build breaks while the engine passes.
- Cave seeds put the player in a corner on some seeds (11, 7) — fine, but
  a validator that assumes room to walk west will fail there.
- `RangeError: Maximum call stack size exceeded` was seen once in the web
  app, not reproduced, never root-caused. If it comes back, that is the
  first thing to chase.

---

## 2. M4 leftover: hearing (optional, one afternoon)

ROADMAP said "only if cheap". It is cheap now that the turn and the log
exist. Do it only after M5 is green, or skip it.

- New `engine/src/senses.ts`: `heard(world, player, events): string[]`.
  Input: the `SimEvent`s recorded since the player's last turn
  (`log.events.slice(lastCount)`, which `main.ts`'s `afterTick` already
  computes as `newEvents`). Keep events on the player's layer within
  `HEARING_RADIUS = 10` (Chebyshev) whose position is **not** in
  `player.vision.visible`. Map a handful of kinds to sentences with a
  direction from `tells.ts`'s `compass`: `fought` → "Something is fighting to
  the east.", `consumed`(thirst) → "Something is drinking to the north.",
  `behaviorChanged`(to `flee`) → "Something bolts to the south-west.",
  `killed`/`defeated` → "Something dies to the west." Species is *not*
  named — you heard it, you did not see it. At most two lines per turn.
- Surface them in `#hud-message` under the action outcome, and as a
  "You hear" group in the inspector's overview when nothing is selected.
- Test: a fight 6 tiles away behind a wall produces one line with the right
  direction; the same fight in view produces none.

---

## 3. M5 Make — search, inventory, crafting, the torch

**Done when:** you light a torch and the world doubles in size. Make that a
number: visible-tile count in the dark corridor with and without a lit
torch, 5 seeds, in `validateTorch.ts`. Today the dark disc is 69 tiles.

Build in this order; each step stands alone and is committable.

### 3.1 Stacks (half a day)

- `types.ts`: `InventoryItem { itemKey: string; weight: number; count: number }`.
  `support.ts` is the only writer today (one item key, food delivery); give
  it `count: 1`.
- New `engine/src/inventory.ts`: `addItem(agent, itemKey, count, weightEach)`,
  `removeItem(agent, itemKey, count): boolean`, `countOf(agent, itemKey)`,
  `carriedWeight(agent)`. Stable order (first-added first), one stack per
  key. Tests for merge, partial remove, remove-more-than-have returns false
  and changes nothing.

### 3.2 The crafting data model + reachability tests (one day; the important part)

`packages/data/src/crafting.ts`. Three tables, all plain literals so the
tests can walk them:

```ts
export interface MaterialDef { id; name; weight; source: MaterialSource; toolGate?: ItemId }
export type MaterialSource =
  | { kind: "terrain"; terrain: TerrainKind; nearTerrain?: TerrainKind; within?: number }  // lichen: floor within 6 of water
  | { kind: "ground"; ground: GroundType }                                                  // flint: rocky
  | { kind: "corpse" }                                                                      // hide
export interface RecipeDef { id; name; inputs: {id: MaterialId | ItemId; count: number}[]; output: ItemId | MaterialId; turns: number; knownAtStart: boolean; needsFire?: boolean }
export interface ItemDef { id; name; weight; slot?: "held" | "worn"; effects?: { lightRadius?: number; threat?: number; capacity?: number; fovBonus?: number } }
```

Ship exactly `CRAFTABLES_V1.md`'s first-playable cut and nothing more:
materials lichen, deadwood, flint, herbs, food; tier 0 fiber, cordage,
bound haft, knapped flint; items torch, flint knife, club, poultice, forage
pouch, camouflage cloak. Known at start: fiber, cordage, bound haft, torch,
club, poultice (the doc's list). Weights and turns from the doc's tables —
do not retune them.

`packages/data/test/crafting.test.ts` — the automated "unreachable content
is a bug":

1. Every recipe input resolves to a material or an item.
2. No cycles (topological sort over recipe edges succeeds).
3. Every material has a source, and every `toolGate` names an item.
4. **Reachable from nothing**: fixpoint — start with bare-hand materials
   (no `toolGate`), repeatedly add any recipe whose inputs are all owned;
   assert the whole first-playable set is reached, and print the order.
5. **Reachable in the real cave**: for 5 seeds of `createCaveScenario`,
   BFS from spawn (`walkDistances`) reaches a tile that yields lichen and a
   tile that yields deadwood within 60 steps. This is the test that would
   have caught the camouflage-cloak hole.

### 3.3 Harvest sources on the map (half a day)

Nothing on a cave tile says "lichen" today. Do not add new terrain kinds.
Derive yields from what is there, in `engine/src/harvest.ts`:
`harvestableAt(world, layer, pos, materials): {materialId, count}[]` — floor
within 6 of water → lichen; floor within 2 of a sunbeam → deadwood (the
doc's "only near sunbeam"); `rocky` ground or a `boulder` neighbour → flint;
a `food` tile → food; a `herbs` crop → herbs. Depletion: `Tile.harvested?:
number` counting takes; a tile yields at most 3 before it is bare; regrow
by decrementing `harvested` in `flora.ts`'s existing per-tick scan every
`HARVEST_REGROW_TICKS = 300`. Test with a hand-built world. Add a
`validateHarvest.ts` that counts lichen/deadwood/flint tiles reachable
from spawn on 5 seeds — if deadwood is under ~6 tiles on any seed the torch
is a coin flip and you say so before building the torch.

### 3.4 Time-spends: search and craft (one day)

Both are "an action that takes N turns and can be interrupted", so build the
mechanism once:

- `types.ts`: `Agent.activity?: { kind: "search" | "craft"; recipeId?: string; turnsLeft: number; startedTick: number }`.
- `PlayerAction` gains `{kind: "search"}`, `{kind: "craft"; recipeId}`, `{kind: "cancel"}`.
- In `player.ts`'s `apply`: `search`/`craft` set `activity` (craft only if
  the recipe is known and inputs are owned — **nothing is consumed until
  completion**, `CRAFTING_LOOP.md`'s rule). Each subsequent player turn
  while `activity` is set is spent on it regardless of the key pressed,
  except `cancel`; when `turnsLeft` hits 0: search adds `harvestableAt`
  yields and increments `Tile.harvested`; craft removes inputs, adds the
  output, records a new `SimEvent` `crafted` (add the two formatter cases).
- **Interruption**: at the end of each player turn, if any agent that was
  not visible last turn is now visible within 5 tiles, or the player took
  damage, clear `activity` and set `lastActionOutcome.ok = false` with a
  reason the HUD can print ("Something moved. You stop."). Turns are lost,
  materials are not.
- UI: `s` = search (HUD: "Searching… 3 turns left"), `c` = craft menu, a
  small `#craft-menu` overlay listing **known recipes only**, number keys
  to pick, known-but-unmakeable rows shown with what is missing
  (`CRAFTING_LOOP.md` §"The recipe list"). `i` = inventory list in the
  inspector overview and "you carry 4 / 10" permanently in the HUD.
- Tests: search yields on a lichen tile and nothing on bare rock; craft
  consumes inputs only on completion; interruption keeps materials; a craft
  with missing inputs is refused with `ok: false`.

### 3.5 Equip and the torch (half a day, then the measurement)

- `Agent.equipment?: { held?: ItemId; worn?: ItemId }`, `PlayerAction
  {kind: "equip"; itemId}` / `{kind: "stow"}`. Held vs stowed is the live
  decision `PLAYER_INVENTORY.md` asks for; keep both states.
- **The torch changes exactly one function**: `vision.ts`'s
  `ambientLightAt` returns 1 when the player holds a lit torch. That
  restores the full 7 radius in the dark. That alone is "the world doubles"
  — measure it. Do **not** also add a light-radius term to
  `LIT_TILE_SIGHT_RADIUS` logic; the torch lights *you*, not the walls.
- The cost the doc names, "seen from further": in `predation.ts`, where
  prey compute their flee radius against the player, add `+2` when the
  player holds a lit torch. Wire it now even though layer 1 has no
  predators — it is the first threat-signature term and M6 extends it.
- Fuel: `Agent.torchTicks` decremented per tick while held, `TORCH_FUEL_TICKS
  = 600` (≈150 keys). At 0 the torch is consumed and the HUD says so.
  **Ask the user before changing 600**; it is a balance number.
- `validateTorch.ts`: 5 seeds, at spawn: visible tiles without torch, with
  torch; keys to gather deadwood + lichen and craft one from spawn using
  the greedy walker in `validateCaveNeeds.ts`. The STATUS line is that
  table.

Decisions to put to the user before 3.4 (numbered, they answer in order):
1. Carry cap 10 with soft encumbrance, or no cap in v1?
2. Torch fuel 600 ticks, or unlimited until M7?
3. Harvest regrowth on, or fixed 3-per-tile with no regrowth for now?

---

## 4. M6 Bond — the game

**Done when:** something follows you out of the chamber. Make it a number:
a scripted bot in `validateBond.ts` that walks to the chamber, crouches,
waits near a sleeping Sandshrew, offers food, and then walks 20 tiles into
the dark — on how many of 5 seeds does a Sandshrew follow it out? If the
answer is 0 with a bot that does everything right, the design's premise is
in trouble and the user needs to hear that before any UI is built.

### 4.1 Threat signature (one day; replaces M0's stopgap)

- `data/src/species.ts`: remove `isPredator: true` from `human`. It was
  flagged in code as the M0 stopgap.
- `engine/src/threat.ts`: `threatSignatureOf(world, agent): number` — 0 for
  any non-player. For the player: base 1.0; `agent.posture === "crouch"`
  ×0.5; moved this turn (from `lastActionOutcome.action.kind === "move"`)
  ×1.25; held club +0.5; held lit torch +0.3; worn cloak ×0.6. Clamp 0..2.
- `PlayerAction {kind: "crouch"}` toggles `Agent.posture`; crouched moves
  cost double (apply by setting `actionEnergy` back by half a threshold —
  the scheduler already handles fractional energy).
- Hook: `predation.ts` where prey decide to flee from a nearby agent. Today
  the human is a predator by flag, so prey use the ordinary
  `FLEE_DETECT_RADIUS` (4 ± boldness). Replace with: for a player-controlled
  `other`, effective radius = `FLEE_DETECT_RADIUS * threatSignatureOf(other)`,
  and the prey only flees if that radius ≥ 1. A crouched, unarmed, still
  human is 2 tiles; a running human with a club is 8. Test all four
  corners.
- `tells.ts`: `hasNoticed` should use the same effective radius, so "has
  not noticed you" stays truthful.

### 4.2 The verbs (one day; mostly wiring)

- **Feed**: `{kind: "offer"}` — drop one food from inventory on an adjacent
  free tile as a `food` terrain tile with `stock` 0.35 (one bite) and mark
  the tile `offeredBy: playerId`. When any agent `consume`s from a tile with
  `offeredBy`, call `strengthenRapportMutual(world, eater, player, GAVE_FOOD
  delta, "receivedFood", "gaveFood")` — the reasons and deltas already
  exist in `rapport.ts`. Clear `offeredBy` after. This needs one items-on-
  tiles primitive (a food tile) and no more; it is not the cache system.
- **Presence**: `keptWatch`/`sleptSafely` fire in `needs.ts` at
  `fellAsleep` for any awake agent within the watch radius. **Test first
  that it fires for the player** — the player skips `tickAgentAction`, and
  if the hook lives there rather than in `tickAgentNeeds` it will not.
  `validateRapportReasons.ts` shows how to count reasons on a run.
- **Fight alongside / Rescue**: exist (`defended`, `rescued`); need danger,
  which is M7. Leave them.

### 4.3 Trust stages and their tells (half a day)

- `engine/src/trust.ts`: `trustStage(world, agent, player): "wary" |
  "tolerant" | "curious" | "bonded"` from the rapport edge *the creature
  holds toward the player* (`agent.rapport?.[player.id]?.score`).
  Thresholds 0.05 / 0.2 / 0.5 — **the user chooses these; present them as
  a menu with what each means in turns of feeding**. Do not pick.
- Tells per stage, added as the third sentence of `examine` when the
  observer is the player and the stage moved since the last examine:
  wary → tolerant "She has stopped watching you."; tolerant → curious "She
  comes a little closer."; curious → bonded "She stays beside you." Record
  the transition as a `SimEvent` `trustChanged` so the log narrates it.
- The rapport meter in the inspector already renders the edge and its
  memories (`describeRapport`); the stage word goes in the same group.

### 4.4 The follower door (one day)

- `Agent.followingId?: string` and a behaviour `follow`: step toward the
  followed agent when farther than 2, otherwise idle. Put it in
  `tickAgentAction` ahead of `chooseBehavior` while `followingId` is set;
  hunger/thirst still override (a follower that starves is a bug).
  `carryAlly`'s follow step (`support.ts`) is the movement to reuse.
- Entry: a creature at `curious`+ that is within 3 tiles when the player
  walks 3 consecutive steps away from it rolls `disperse`-style with
  probability from the score; on success sets `followingId` and logs
  `startedFollowing`. Exit: rapport decays below `tolerant`, or it is
  attacked by the player.
- The dispersal offer's *text moment* (`CAMPAIGN_DESIGN.md`: "It looks out
  to the unexplored cave with a kind of yearning in its eyes. Then it stops
  and looks at you, expectantly.") is an overlay with two choices when a
  `bonded` creature is adjacent and the player is at the chamber's edge.
  Refusal is permanent per individual (`Agent.refusedFollow = true`). The
  "one armful" cache needs items on tiles — **defer to M7**, ROADMAP's
  recommendation, unless the user rules otherwise.
- Renderer: draw a thin line or a small heart between the player and a
  follower so the bond is on the map, not in a meter.

---

## 5. M7 Climb — layers 2–5, predators, the exit

**Done when:** you emerge.

Architecture decision first — put it to the user with a recommendation:

1. **Chain worlds** (recommended): `World.below?: World`, `World.above?:
   World`, each cave layer a full `World` from `generateWorld` with its own
   agents; a `stairs` terrain kind on both sides links them. The player
   crosses by moving onto stairs: `main.ts` swaps `world` the way
   `focusZone` already swaps between macro-grid zones, and the player agent
   is moved between `agents` arrays. Sim agents do not cross in v1. Cheap,
   reuses the macro-grid pattern, and the existing `Layer` union stays
   three-valued.
2. **Extend `Layer`** with `underground2..5`. Touches `LAYER_ORDER`,
   `createLayerGrid`, every `Record<Layer, ...>`, `otherLayers`, the
   resource index, the renderer. Correct but wide.

With (1): `createCaveRun(seed)` builds 5 chained worlds; layer 1 is
`createCaveScenario`; layers 2+ come from `generateWorld` underground with
predators placed from `BREADTH_DESIGN.md`'s cave list (Zubat, Geodude,
Onix, Charmeleon is not a cave species — check the biome tables) at
increasing level with depth. Fight-alongside and Rescue light up here; add
`validateClimb.ts` that runs the bot down all five layers and counts
deaths per layer on 5 seeds — a layer that kills the bot every time is a
balance report for the user, not a number to tune yourself.

The exit is a `sunbeam` cluster on layer 5 reached from stairs; stepping
into it ends the run with a win screen mirroring `#game-over`.

---

## 6. Rulings needed from the user (ask in one numbered block)

Carried from this session's TODO notes; none are decided.

1. Energy has no consequence for the player. Add a `rest` time-spend and a
   real cost for exhaustion (speed? accuracy?) — which?
2. Death lifts the fog (accident, kept). Keep it or stay dark?
3. `deliverFood` and `scavenge` tells never fire on a real run; the
   `foodDelivered`/`healAura`/`fire`/`sharedWater` unreachable stack from
   the rapport round is still open. A dedicated sim-health pass, or leave
   until after M7?
4. "Training" is 31% of all examine reads. Name the move being practised?
5. Rapport memories never decay and dead agents keep edges. Prune on death?
6. Play always starts the cave; the surface demo is URL-only. Add a button?
7. Leaving Overworld mode by the toggle probably leaves the macro map
   displayed (same `hidden` bug, from code reading, not reproduced).

---

## 7. Sizing, honestly

| Milestone | New | Risk | Evidence that closes it |
|---|---|---|---|
| Hearing | one file, one test | low | direction test |
| M5 Make | data model + tests, harvest derivation, the activity mechanism, equip, torch | the activity/interruption mechanism | `validateTorch.ts` table: visible tiles with/without torch, keys to first torch, 5 seeds |
| M6 Bond | threat signature, offer tile, trust stages, follow behaviour, the text moment | **the design premise itself** | `validateBond.ts`: seeds on which a bot earns a follower |
| M7 Climb | chained worlds, stairs, predators, exit | architecture choice | `validateClimb.ts`: deaths per layer |

M6's validator is the most important artifact in this plan. ROADMAP.md says
it plainly: if a player cannot work out from tells alone that moving
slowly, feeding and staying near earns trust, the premise is wrong and
everything after changes. Build the bot before the overlay.
