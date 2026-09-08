# Basic player movement and actions

Status: **design proposal, nothing built.** This is the rung below
`PLAYER_ACTIONS.md` — that doc argues about tactics, coaching, automation and
crafting, none of which can be prototyped until pressing a direction key does
something. Direct correction that produced this doc:

> "your jumping the gun. those are extremely important mechanics dont get me
> wrong. but i think we need basic player movement and actions figured out."

Correct. This doc covers only: what the player *is*, when it gets to act, how
it moves, and the smallest action set worth building.

---

## Finding 1: the turn model is already built, and it isn't "1 key = 1 tick"

**Confidence: high. Read from the source.**

`simulation.ts` already implements a real roguelike **energy scheduler**:

```
ACTION_THRESHOLD = 40
accumulateActionEnergy(agent, speed):
    agent.actionEnergy += speed
    if actionEnergy < ACTION_THRESHOLD: return false   // no action this tick
    actionEnergy -= ACTION_THRESHOLD                    // spend one action
    clamp so no double-actions bank up
    return true
```

Speed comes from `actionSpeedOf`, which already composes base Speed,
paralysis, injury, **terrain** (`terrainSpeedFactor` — mud slows you), and
day/night activity schedule, all through `SPEED_ACTION_COMPRESSION`.

This settles the open question `PLAYER_ACTIONS.md` raised as "fixed or
variable tick cost?" **The engine already answered: variable, driven by
Speed, and already tuned.** `SPEED_ACTION_COMPRESSION` even exists because of
a direct ask about fairness — *"tweak the speed to action economy tick calc
to be a little less influential. To give Pokémon who are weaker a chance to
actually escape or use a move."*

The player model that falls out of this:

> **The world ticks. When the player's action energy crosses the threshold,
> the sim stops and waits for input. Everything else keeps moving between
> your turns.**

Consequences worth stating, because they're all free and all good:

- A fast creature genuinely acts more often than you. On the demo roster the
  spread is roughly 1.1 to 4.5 ticks per action — a Venusaur acts ~4x as
  often as a Bulbasaur. Being outsped is a real, legible threat.
- Walking through mud costs you turns *relative to everything else*, because
  `terrainSpeedFactor` feeds the same number. Terrain is already tactical.
- Being injured slows you. Fleeing wounded is already harder.
- Night already penalizes species by activity schedule.

None of that needs building. It needs a player standing in it.

## Finding 2: there is exactly one integration seam

The per-agent loop in `tickWorld` is:

```
for each agent:
  if dead        -> skip
  if egg         -> tickEgg, skip
  tickAgentNeeds(...)                       // hunger/thirst decay
  acted = accumulateActionEnergy(agent, actionSpeedOf(...))
  if !acted      -> skip
  tickAgentAction(...)                      // <-- THE SEAM: utility AI picks
  post-move terrain-factor + seed bookkeeping
```

**`tickAgentAction` is the only line that needs to branch.** When the acting
agent is the player, consume a queued player intent instead of running
utility AI. Needs decay, the energy economy, terrain factors, occupancy and
every post-action bookkeeping step apply to the player unchanged, for free.

That is a genuinely small change for what it unlocks.

---

## The player is an `Agent`

**Recommendation: yes, with an `isPlayer?: true` flag. Confidence: high.**

The alternative — a separate `PlayerEntity` type — means reimplementing or
special-casing every interaction in the sim. Making the player an ordinary
`Agent` means it inherits, with no new code:

- needs decay, starvation, thirst (`needs.ts`)
- the action-energy economy above
- movement gates and tile occupancy
- **being a valid target** — predators can hunt you, herds can clash with
  you. This is not a side effect, it is *required* for the flanking dynamic
  in `PLAYER_ACTIONS.md`: an enemy fixated on you is what gives your partner
  its bonus. The player must be targetable or that whole design is inert.
- status effects, injury, fainting, death
- rapport edges with individual creatures (`rapport.ts`)
- appearing in the chronicle like anyone else — you get a story written about
  you by the same system that writes about herds

The cost is a handful of exclusions, listed under Risks below.

### What the player is, statistically

A human with no species moves is the honest starting point, and the pitch
already names the answer: *"punch, kick, swing, yell."* Those are `MoveSpec`s
like any other — a weak `point`-shape physical move with a `range.max` of 1,
which is exactly what being unarmed should feel like next to a creature that
breathes fire. Items later extend that (a sling giving you a real range band
is in `PLAYER_ACTIONS.md`).

---

## Movement

8-way, reusing the gates `firstWalkable` already applies, in order:

1. `tile.walkable` (or `canFlyOverObstacle` — not the player)
2. `canEnterWater` — species-gated. **A human can't swim into deep water**
   without something to solve it. This is a real, diegetic wall for Act 1's
   cave and it costs nothing.
3. `canEnterLand` — obligate-aquatic gate, irrelevant for the player
4. `canEnterTile` — per-tile occupancy capacity

### Bump rules — the actual design question

What happens when you walk into something is most of what "basic movement"
*is*, and it's where a roguelike feels good or awful.

| You bump | Result | Turn spent? |
|---|---|---|
| Wall / unwalkable | Nothing, brief message | **No** |
| Water you can't enter | Nothing, message naming why | **No** |
| Hostile creature | Attack it (bump-to-attack) | Yes |
| Your partner | Swap places | Yes |
| Neutral creature | *Open question — see below* | — |
| Edge of the zone | Zone transition prompt | Yes |

The one rule I'd defend hardest: **a blocked bump must not consume a turn.**
Charging a mis-keyed direction into a wall and losing a turn to a predator is
the single most common way roguelikes feel unfair, and it's pure input noise,
not a decision. Every good modern roguelike refuses to spend the turn.

The neutral-creature bump is genuinely open and it matters more than it
looks, because most creatures in this world are neutral most of the time.
Options: displace/swap (friendly, can be exploited to shove things around),
refuse and message (safe, can feel unresponsive), or attack (dangerous —
turns a mis-key into a war with a herd, and this sim has `rapport.ts`
tracking grudges, so an accidental punch has *lasting* social consequences).
Recommend **refuse and message**, with attacking a neutral requiring an
explicit attack command. Accidentally starting a blood feud by walking is a
bad story, not a good one.

### Layers and stairs

`Layer` is a three-value enum (`underground`/`surface`/`canopy`) and agents
already change layer — `migration.ts`'s cross-layer resource trips do it
today. For the player, a stair/climb tile is a *move* that changes `layer`
rather than `pos`. The 5–6 layer cave from the campaign pitch needs the
`Layer` generalization `CAMPAIGN_DESIGN.md` already flags as structural;
basic movement does **not** need it, and shouldn't wait for it.

---

## The minimal action set

Six verbs. Deliberately fewer than `PLAYER_ACTIONS.md` proposes, because
this is the foundation, not the game.

| Verb | Notes |
|---|---|
| **Move** (8-way) | Includes bump-to-attack |
| **Wait** one turn | Real tactical value: let a cooldown finish, let something come to you |
| **Look / inspect** | **Free**, no turn — see `PLAYER_ACTIONS.md` on why information is never rationed |
| **Attack** a direction | Explicit, so attacking a neutral is always deliberate |
| **Change layer** | Stairs/climb where terrain allows |
| **Pick up** | `InventoryItem` and carry-weight already exist in `support.ts` |

Search, rest, forage, train, command, craft and pray all layer on top of this
without changing it. If this set feels good to move around in, the rest is
content. If it doesn't, nothing built on top will save it.

---

## Risks: what will bite

Honest list, from reading the systems the player would be dropped into.

- **`resolveTileOverlaps` runs after every agent has acted** and can relocate
  agents to fix same-tile collisions. It must never teleport the player —
  a camera that jumps because the resolver shoved you is disorienting and
  looks like a bug.
- **World systems must exclude the player**: `maybeImmigrate`,
  `updateHerdMigrations`, dispersal, herd leadership, breeding. A player
  auto-joining a herd or being emigrated out of the zone is absurd.
- **Predation power ratios.** `isPreyOf` gates hunting on a power ratio
  (`PREY_POWER_RATIO`). An unarmed human is weak, so the player may read as
  prey to a great many species at once. That is thematically perfect and
  mechanically brutal; it needs a real measurement, not a guess.
- **Corpse persistence.** `alive = false` leaves a lootable corpse for
  `CORPSE_PERSIST_TICKS`. For the player that's the game-over hook, and it
  wants a deliberate decision rather than the default.
- **The focused zone must follow the player.** `MacroWorld.focusedKey` drives
  which zone runs a full `tickWorld`; it has to track the player's zone, and
  zone transitions become promote/demote events.
- **Determinism.** `DESIGN.md`'s guarantee is that every random draw comes
  from `World.rng`. Player input is a *new* non-deterministic input to the
  world. Replay therefore needs the input stream recorded alongside the seed,
  or the replay feature quietly stops working.

---

## Open questions

1. **Neutral bump** — displace, refuse, or attack? (Recommend refuse.)
2. **Does a blocked bump ever cost a turn?** (Recommend never.)
3. **Can the player be hunted from turn one?** Thematically yes; it may make
   Act 1's cave unsurvivable. Needs measuring before deciding.
4. **Diagonal movement through wall corners** — allowed or blocked? Blocking
   is the usual choice and matters for corridor tactics.
5. **What does the player look like to the chronicle?** Included is a lovely
   idea (the world writes your story in the same voice as everyone else's)
   but it may read oddly narrating things you already watched happen.
6. **Death.** Still unanswered, and now concrete: `alive = false` plus a
   corpse is the default, and it's almost certainly not what a 3-act campaign
   wants.

## The first slice I'd actually build

Smallest thing that proves the model, with its own pass/fail evidence:

> A player agent in one already-generated zone. Arrow keys move it 8-way
> through the real movement gates. The world ticks around it on the existing
> energy economy — it waits for input on the player's turn and not otherwise.
> Bump-to-attack on hostiles, blocked bumps cost nothing, `wait` works.
> Nothing else: no partner, no inventory, no search, no commands.

Pass/fail is legible: does it feel right to walk around a living ecology, and
does being outsped by a fast creature read as threat rather than as lag? Both
are answerable in a browser in one sitting, and everything in
`PLAYER_ACTIONS.md` is downstream of the answer.
