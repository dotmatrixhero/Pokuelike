# Player actions: the moment-to-moment game

Status: **design proposal, nothing decided.** Confidence tiers marked per
section. Nothing here is built.

The framing ask, verbatim:

> "i need you to help me design the actual player actions. moment to moment
> gameplay, ux, like how to make decisions and what info you have on screen.
> etc. do we add crafting? praying?? fog of war, etc."

And the course correction that reshaped this doc, also verbatim — v1 of this
proposal was too Dwarf-Fortress-shaped and got corrected:

> "i kinda wanted the player actions to be tactical, like less dwarf
> fortress-y and more broguelike. with the opportunity to wait/pass time in
> an area. when you tell a pokemon which opponent to target, there's skill
> expression in helping it get to the right position/elevation and using the
> right range. it might not follow your command, but the intent to help it be
> tactical would be part of the game."

The standing constraint both versions have to satisfy:

> "the ability to make decisions is core to gameplay, and being informed
> about what decisions youre making is important"

---

## The finding that should drive everything: the tactical engine already exists

**Confidence: high. This is measured from the source, not an opinion.**

The Brogue-style tactical layer is not a thing to build. It is largely built,
tested, and currently being driven by utility AI because there has never been
a player to drive it. Verified in `packages/engine/src`:

| Tactical primitive | Status | Where |
|---|---|---|
| Cast range, separate from effect area | **exists** — `MoveRange {min, max}` | `moves.ts` |
| AoE footprints: point, line, cone, ring, burst | **exists** — `MoveShape` | `moves.ts` |
| **High ground bonus** | **exists** — `situationalBonus: "elevation"`, attacker above defender | `predation.ts` |
| **Flanking bonus** | **exists** — defender not reacting to this attacker | `predation.ts` |
| Concealment bonus (attacking from a bush) | **exists** — `"concealed"` | `predation.ts` |
| Night / storm / rain / drought / cold-snap bonuses | **exists** | `predation.ts` |
| Knockback, drag, lunge, retreat | **exists** — `forcedMovement` | `moves.ts` |
| Status effects and status-synergy bonuses | **exists** | `status.ts` |
| Fire that spreads tile to tile | **exists** | `fire.ts` |
| Field of view, with uphill/downhill asymmetry | **exists, zero callers** | `fov.ts` |
| Per-pair relationship graph | **exists** | `rapport.ts` |
| Personality | **exists** | `nature.ts` |
| 8-way movement | **exists** | `movement.ts` |

The move system's own doc comment already calls `MoveRange` *"a real tactics-
grid distinction."* Somebody built this for a tactical game.

The strategic conclusion: **the Brogue direction is the cheap direction, and
the Dwarf Fortress direction is the expensive one.** Standing orders, job
queues and priority lists are all systems that do not exist and would have to
be invented. Range bands, high ground, flanking and spreading fire are
sitting there already. v1 of this doc proposed building the expensive thing
while the cheap thing was already in the repository. The correction was right
on the design merits *and* on cost.

---

## The turn model: two tiers

**Confidence: high on shape, medium on the tick-cost detail.**

Shaped by a second correction, verbatim:

> "so i think we might need a little more than just a menu to set spending
> your time to do stuff. i think i'd want to tie some mechanic of 'search'
> like a traditional rogue like to look for crops hidden underground or loot,
> etc. or maybe there's auto search, but it's a mechanic based on waiting, or
> something you know? we need to map some player input meaningfully to the
> types of intents and action behavior the player is taking."

That is correct and it fixes the weakest thing in this doc's first tactical
pass, which had a single bland "rest" verb doing all the work of passing
time. Time spent should have a *flavour*. "Wait 10 turns" is a menu; "spend
10 turns searching this chamber" is a decision.

So: **two tiers of input, and the game is the rhythm between them.**

### Tier 1 — tactical actions (1 tick each)

Used when something is happening. Every one is a real per-turn decision.

- **Move** one tile, 8-way (`movement.ts` is already 8-way).
- **Attack / use a move** — target within the move's `range.max`.
- **Use an item.**
- **Command your partner** — the heart; see below.
- **Wait** one turn. Tactically real: letting a cooldown finish or an enemy
  step into your range is a *move*, not a pass.
- **Look / inspect** — free, costs no tick.

### Tier 2 — time-spend intents (N ticks, interruptible)

Used when nothing is happening. This is where "the opportunity to wait/pass
time in an area" lives, and where player input maps onto the sim's own intent
vocabulary. **Every one of these is already a `BehaviorKind`** — this is the
meaningful mapping the correction asked for, and it costs nothing to invent:

| Input | `BehaviorKind` | What you get | What it costs |
|---|---|---|---|
| **Search** | `scavenge` | Reveals hidden things in a growing radius — see below | Stationary, distracted, loud |
| **Forage** | `seekFood` | Harvest what's already visible | Slow, safe-ish |
| **Rest** | `sleep` / `restAtShelter` | Recover health and fatigue | Most vulnerable state in the game |
| **Watch** | `idle` | Observe creatures in view — advances knowledge without approaching | Time only; the safe way to learn |
| **Train** | `train` | Work with your partner — rapport and skill | Time, noise, and needs |

Five inputs, five intents, each with a different payoff and a different risk
profile. That is a game, not a menu.

### The rule that makes the two tiers work

**Tier 2 always interrupts back into Tier 1.** The moment something enters
your field of view, you take damage, or a need crosses a threshold, the
time-spend stops and you are back to per-turn decisions with the world where
it now is.

That gives the game its rhythm: long, intentional, slightly nervous stretches
of spending time, punctuated by sharp tactical encounters. Which is, not
coincidentally, exactly Brogue's rhythm.

It also means **time-spending is never free**, and that is what makes it a
decision. Needs tick down (`needs.ts`), day becomes night (`daynight.ts`),
weather rolls in (`weather.ts`), creatures migrate (`migration.ts`,
`herdMigration.ts`). All of that already runs. Choosing to spend forty turns
searching a chamber is a real gamble against a world that keeps moving.

### Free actions are a design position, not a convenience

Anything that only *reads* state costs zero ticks: inspect, check a range
overlay, read your journal, look at a creature's known moves. This is the
mechanical form of "being informed about what decisions you're making is
important." A game that charges you a turn to find out what something is has
made ignorance the efficient play — exactly the trap the earlier
hunting-example argument identified.

### What search actually finds

Two layers, and the second matters more.

**Material:** buried and wild crops (`crops.ts`, `flora.ts` exist), caches,
loot, concealed passages, dens and nests.

**Informational — the better half:** *tracks and signs.* Search a tile and
learn what passed through it. *"A large three-toed print, half a day old,
heading toward the water."*

Tracks are the strongest version of this mechanic because they are
information rather than loot:

- They feed the knowledge system directly — a print you can't identify is a
  journal entry you can fill.
- They make hunting a skill rather than a dice roll: read the sign, predict
  the route, choose the ground, be there first. That is the tactical layer
  reaching outside of combat.
- They are narratable, which is the project's founding pillar. A track is a
  story fragment the world wrote without being asked.
- They are the "humans are animals too" pillar as a verb — you are doing
  exactly what a predator does, with no better equipment than attention.

### Auto-search versus deliberate search

Traditional Rogue and NetHack made you press `s` repeatedly, and every
roguelike since has walked that back, because content you miss for not
spamming a key is a design failure, not a difficulty.

Recommendation, satisfying both halves of "or maybe there's auto search, but
it's a mechanic based on waiting":

- **Passive auto-search while moving** — weak, automatic, guarantees you
  never miss something for failing to press a button. No input required.
- **Deliberate search as a Tier 2 time-spend** — strong, radius grows the
  longer you commit, finds the buried and the concealed and the old.

So searching is never mandatory busywork, but choosing to spend real time on
it is a genuine gamble: you are stationary, distracted and audible in a world
that keeps moving.

---

## The auto-roguelike: automation as a decision-surfacing engine

**Confidence: medium-high on the architecture, low on the boundary. The
boundary is the whole design and it is not settled.**

The third correction, verbatim:

> "maybe there's some thought here about designing an auto-roguelike the way
> that auto-battlers exist, like maybe we can smooth some of the boring stuff
> over like i know some roguelikes had auto explore. but you and i have an
> opportunity now to really reconsider what that could be like, surfacing
> more interesting decisions while also giving intentional input into game
> behavior?"

### Why this fits this project specifically

**This codebase is already an auto-battler engine.** Every agent in every
zone already chooses targets, paths, moves and behaviours by utility AI. The
ecology plays itself, competently, today. What has never existed is the
player's *preparation* layer.

That inverts the usual build order. Most games build manual play and bolt
automation on afterwards as a convenience. Here the automation is the
finished part and the manual layer is the new one — so "auto-roguelike" isn't
a feature to add, it's an accurate description of what already runs.

### The interrupt problem is already solved, in `autoCamera.ts`

The hard question in any auto-roguelike is *when does it stop and ask you?*
Stop too often and it isn't automation; too rarely and you die during a
fast-forward.

`packages/web/src/autoCamera.ts` already answers exactly this question. It
watches the live event stream and decides what deserves a human's attention:
`NotableCategory` (immigration, courtship, hatch, battle, clash, evolution,
death), a priority queue where battles preempt lesser moments, dwell times,
staleness detection, and cluster cooldowns so one category can't crowd out
the rest. And it is *tuned against real runs* — its comments carry real
measurements (594 herd clashes against 45 battle hits over 6,000 ticks;
engagement durations with a median of 1 tick).

That is a notability detector with real mileage on it. **Point it at "stop
and hand the player control" instead of "pan the camera,"** and the
auto-roguelike's hardest system is already built and already tuned.

### The genuinely new idea: make the interrupt policy the player's input

This is the part I think is actually novel, and it is the direct answer to
"giving intentional input into game behavior."

In every existing implementation, auto-explore's stopping rules are fixed by
the developer. DCSS stops when a monster comes into view. Full stop. You
cannot tell it what you care about.

**Let the player configure what interrupts them.** Not as a settings menu —
as a diegetic, in-world stance with real costs:

- *Stop for anything that moves* — safe, slow, constantly interrupted.
- *Stop for predators and unknowns only* — the default working stance.
- *Stop only if we're in danger* — fast, and how you get killed.
- *Stop for tracks, dens, unfamiliar plants* — the forager's stance, tuned
  for discovery rather than safety.

Why this earns its place:

- **It is a real, repeated decision with real consequences** — which is what
  the tactical correction asked for; it just lives one level up.
- **It expresses character.** Cautious and bold become chosen postures
  rather than emergent habits.
- **It ties to the knowledge system.** You cannot set "stop when a Rapidash
  appears" if you have never learned what a Rapidash is. Knowledge literally
  buys finer-grained control over your own attention.
- **It can progress.** A character who has survived things notices more; a
  partner with high rapport warns you about what you'd have walked past.
  A progression axis that isn't a stat bar.

### Automation that *surfaces* decisions rather than skipping them

The framing that makes this more than a fast-forward button: **the
automation layer's job is to find decisions the player would otherwise never
have been offered.**

A player manually walking forty turns through quiet forest isn't making
decisions, they're pressing a key. The same forty turns run automatically,
with a system watching for what's notable, can *generate* forks:

> *You find tracks — something large, half a day old, heading toward the
> water. Follow them, or press on?*

> *Your partner has stopped. It won't go further up this slope.*

> *The berries here are a kind you don't recognise.*

None of those are decisions manual play would have surfaced — they require a
system to have been *watching on your behalf*. That is the reframe:
automation as an attention mechanism, not a skip button. Very well matched to
a project whose stated pillar is *"there are stories to be found
everywhere."*

### Where I think this is dangerous — the real pushback

1. **This is in genuine tension with the Brogue correction, not harmony with
   it.** One message asked for *less* automation and more per-turn tactical
   decisions; this one asks for *more* automation. Both are right about
   different parts of the game, but the boundary between them is not a
   detail to settle later — it *is* the design. Draw it wrong toward
   automation and the tactical layer becomes a cutscene; wrong toward manual
   and you've rebuilt the walking simulator the automation was meant to fix.
   Better to name this as the central open question than to pretend the
   three messages compose cleanly.

2. **If auto-play performs as well as manual play, the tactical layer is
   fake.** The auto-battler failure mode: when prep is thin, watching is
   just slower than skipping. The saving grace is that this is *measurable* —
   run the same seed automated and manual, compare outcomes. If they match,
   the tactical layer isn't earning its screen time and should be deepened or
   cut, not shipped. Worth building that harness early; the runner package
   and the determinism guarantee already make that comparison exact.

3. **Interrupt fatigue is the tuning failure that kills it.**
   `autoCamera.ts` already learned this the expensive way — its comments
   document a 40-tick staleness timeout that produced 26 real seconds of dead
   air, and a clash-to-battle ratio that had to be tuned so the common thing
   didn't crowd out the rare one. The same problem recurs here with higher
   stakes: an unwanted camera pan is an annoyance, an unwanted interrupt
   breaks a flow state.

### Where the earlier intent vocabulary finally belongs

Worth recording, since this doc has now argued three positions. v1 proposed
`BehaviorKind` as the player's per-turn action menu, and that was wrong. It
belongs here instead — as **standing conduct**, set once, revised
occasionally, resolved automatically until something notable happens:

- **Your conduct** — what you're spending time on (the Tier 2 table).
- **Your partner's conduct** — aggressive / defensive / hold / disengage
  early, filtered through whether it actually obeys.
- **Your alertness** — what interrupts you.

Three standing policies, six tactical verbs, five commands. The depth is in
the board state and the world, not in the length of the verb list — which is
the original "not the nethack thing" constraint, satisfied.

---

## The command layer: coaching, not puppeteering

**Confidence: high on the core loop. This is the game's identity.**

> "when you tell a pokemon which opponent to target, there's skill expression
> in helping it get to the right position/elevation and using the right
> range. it might not follow your command."

### The mechanic that makes this work already exists, and it is `flanking`

`situationalBonus: "flanking"` gives an attacker a damage multiplier when the
defender *isn't currently reacting to that specific attacker* — its
`fightTarget` points somewhere else.

Read that again with a player in the world: **if the enemy is fixated on
you, your partner is flanking it.**

That single existing multiplier gives the whole game its cooperative shape:

- You take the aggro and the risk; it lands the damage.
- Your body position is a tactical instrument, not a camera mount.
- Neither of you can do it alone — the "rugged individual is a myth" pillar
  stated as a damage formula rather than as prose.
- It is the exact inversion of the trainer-throws-a-ball dynamic the myth
  research kept praising: *"i like that these stories show something other
  than the trainer/dominator and dominated dynamic."* You are in the fight,
  in front, drawing the bite.

Nothing needs to be invented for this. It needs a player who can be targeted.

### The four skill expressions

1. **Elevation.** `situationalBonus: "elevation"` already multiplies damage
   when the attacker is above the defender, and `fov.ts` already makes
   uphill harder to see than downhill. Getting your partner onto high ground
   is a real, already-implemented edge.
2. **Range bands.** Every curated move has an explicit `range.max`. A
   long-range special attacker standing adjacent is wasting its best option;
   a melee bruiser at distance is walking, not fighting. Positioning it at
   the right band is the core tactical read.
3. **Aggro and flanking.** Above. Where you stand decides who gets the bonus.
4. **Terrain and weather.** Fire spreads. Storms, rain, night and cold snaps
   all already carry damage modifiers. Concealment is an ambush bonus.
   Choosing *where* and *when* to take a fight matters before it starts.

### The commands themselves — keep this small

Commands are intents; the partner owns execution. This is where v1's
intent/sequence split genuinely belongs, and it maps onto the existing
`BehaviorKind` enum rather than inventing a parallel vocabulary:

| Command | Maps to | Meaning |
|---|---|---|
| **Target that** | `fight` / `hunt` + target | Focus this enemy |
| **Move there** | `relocate` | Take that position — the elevation play |
| **Hold** | `idle` | Stay put, don't chase |
| **Fall back** | `flee` toward the player | Disengage |
| **Use that move** | direct | Situational override |

Five commands. That is the answer to "not the nethack thing" — the depth is
in the board state, not the verb list.

### Disobedience is an information channel, not a tax

> "it might not follow your command"

This is the best idea in the correction and it needs to be built as
*legible*, or it is pure frustration. Compliance should be governed by things
the player can learn and influence:

- **Rapport** (`rapport.ts`, already a real per-pair graph, already
  documented as the intended foundation for recruitment).
- **Nature** (`nature.ts`) — a timid one won't lead a charge.
- **Its current state** — hurt, starving, afraid.
- **Whether the order is sensible** — it will not walk into fire.

And when it refuses, **the log says why**, in the project's existing house
style: *"Charmander won't go near the water."* That refusal is not a failed
turn — it taught you something true about that creature, which advances the
knowledge system below. Disobedience becomes the main way you learn who your
partner actually is.

This also makes trust a *mechanical* progression rather than a story beat:
early partners refuse often, and the same command later succeeds because of
what you've done together. That progression is the campaign's real arc.

---

## Information: the knowledge system

**Confidence: high on shape. Carried forward from v1 largely unchanged —
this part survived the correction, and Brogue's transparency reinforces it.**

Per-species knowledge states, as a mask over data that already exists in
`packages/data`:

| State | How you see it | How you get there |
|---|---|---|
| **Unknown** | Silhouette; a description, not a name: *"a burning horse."* Stats `???`. | default |
| **Seen** | Real name and type. Rough threat read. | look at one |
| **Studied** | Moves it has used in front of you, **and their ranges**; diet; habitat. | observe, or be told |
| **Known** | Full entry including folklore. Unlocks interaction options. | complete the entry |

Under a tactical model this gets sharper teeth than it had in v1: **knowing a
species means knowing its range bands.** Not knowing whether the thing across
the room is a 1-tile melee attacker or a 5-tile artillery piece is precisely
the tactical unknown that makes scouting worth doing. Knowledge converts
directly into correct positioning.

It still never punishes ignorance — Unknown is a blank in a journal, not a
debuff. It gates content and precision, which is the version the user already
argued for: knowledge should be *"something you unlock after talking to
people."*

### What's on screen

Existing panels do more of this than expected — `inspector.ts`,
`eventLogPanel.ts`, `chroniclePanel.ts`, `battleScreenPanel.ts` are built.

- **Map**, centre, most of the screen.
- **Range overlay** — the single most important new UI. Highlight what a
  selected move can reach, and where the elevation and flanking bonuses
  currently apply. Free to toggle. Brogue's whole design thesis is that
  showing the player the math is not a spoiler, it is the game.
- **Your body** — hunger, thirst, fatigue, health. Bars are fine for your own
  body; the "no hidden meters" pillar is about world state.
- **Partner** — health, current order, and *whether it is complying*.
- **The log** — already writes causal prose.
- **Inspect / knowledge** — what's under the cursor at your knowledge state,
  with `???` where you don't know.

---

## The three direct questions

### Fog of war — yes, and it is already built

**Confidence: high. A finding, not an opinion.**

`fov.ts` implements `computeVisible` with four independent, tested terms:
elevation sight bonus, concealment penalty, **directional elevation
asymmetry** ("fog thickens looking uphill, thins looking downhill"), and
night/storm penalties. `fov.test.ts` covers it.

`computeVisible` has **zero callers in the entire repository** — verified by
grep across all four packages. Only `isPathClear`, same file, is used, by
`predation.ts`. An observer sim has no point of view, so it was built and
never wired.

By the project's own standard — *"unreachable content is a bug"* — that is
currently a bug, and the player character is its fix. Under a tactical model
it is doubly load-bearing: fog is what makes scouting, ambush and the
concealment bonus mean anything.

Recommended: three states. Unseen black; remembered shows terrain but not
creatures; visible live.

### Crafting — yes, but constrain it hard

**Confidence: medium. Pushing back deliberately.**

`CAMPAIGN_DESIGN.md` honestly records that none of it exists and it is one
system, not several. Crafting is where simulation games go to die: it turns
design attention into recipe-tree content that is never why anyone loves the
game. It is the item in the pitch most able to eat six months.

The tactical reframe makes the constraint sharper and easier to hold:
**every craftable must change a tactical option, or it doesn't ship.**

- Two ingredients maximum, ever. No sub-assemblies.
- Recipes are knowledge, not menu entries — same system as species
  knowledge. No screen listing things you can't make.
- **Items are verbs you don't have yet.** A sling gives *you* a range band
  when you'd otherwise be melee-only bait. A firestarter turns terrain into
  a weapon via the existing fire spread. A spear lets you hold a corridor
  instead of dying in it. A waterskin makes distance survivable. Each opens
  a positional choice; none is a flat stat stick.
- Nothing craftable in the first cave. You have a rock and a fire.

The thematic argument for keeping it: **crafting is how a human solves the
problems a Pokémon solves with its body.** It has a flame body; you make
fire. It has claws; you knap a point. Same needs, no better equipped, just
able to make things — the "humans are animals too" pillar with the twist that
makes it interesting rather than merely stated.

### Praying — yes, but as an information verb

**Confidence: medium-high on mechanism, low on scope.**

The two usual implementations are both bad: the slot machine (NetHack's
altar — pray, roll, maybe get saved) makes the sacred farmable; the flavour
button makes it set dressing.

A better fit, and cheap because the systems exist:

> **A shrine tells you true history. Praying is how you ask.**

`chronicle.ts` exposes `chronicleFor` → `HerdStory[]` with narrative `Beat`s;
`notableLore.ts` generates `notableTale` prose about notable individuals. The
world is already writing its own myths — into a debug panel, rather than into
the world where they'd be found.

So: shrines are placed by the human geo pass (already planned). Praying
surfaces a real generated story about that region — the herd that died here,
the notable that ruled this valley. Because it's real, it's actionable: it
can mark a location, name a creature you'd only seen in silhouette, or
advance a knowledge entry.

Why this version:

- Makes myth diegetic instead of decorative — the reason
  `MYTH_STRUCTURES.md` exists.
- Gives "there are stories to be found everywhere" a literal verb.
- Costs a query and a UI, not a system.
- **It sets up the ending.** If prayer has only ever *answered* — you ask,
  the world tells you what happened — then Jirachi, the one entity that
  answers by *changing* something, violates an established rule. That only
  works if prayer never granted anything before.

---

## Honest gaps: what the tactical model needs that doesn't exist

Stated plainly, because the "already built" table above could otherwise read
as more finished than it is.

- **No player agent and no input path.** The big one, already recorded in
  `CAMPAIGN_DESIGN.md`. Everything here sits on top of that one change.
- **`accuracy` is not consumed by combat.** `MoveSpec.accuracy` exists and
  `combat.ts` ignores it — the doc comment says so outright: *"every move
  currently hits."* For a tactical game that's a live question, not a bug:
  guaranteed hits make positioning deterministic and readable, which is
  arguably *more* Brogue-like than a miss chance. Worth deciding on purpose
  rather than by default.
- **No facing or awareness model.** `flanking` is explicitly a proxy —
  "caught it off guard" via `fightTarget`, because there's no real facing.
  Good enough, probably better than good enough, but it means true
  backstab-style positioning isn't available.
- **`range.min` is 0 on every move.** The thrown-only, can't-use-at-melee
  case is designed but unused.
- **The trust/compliance machine.** Rapport and nature exist; a command
  actually being refused because of them does not.
- **No AI for a partner taking orders.** Wild agents choose targets by
  utility. A partner weighing an order against its own state is new.

---

## Open questions (genuinely undecided)

1. Does one player action always cost exactly one tick, or do actions cost
   variable ticks? Variable is truthful to a sim with real time constants;
   fixed is dramatically more readable, and readability is the Brogue virtue.
2. Do abstract (unfocused) zones advance while the player takes turns? If
   not, the world freezes while you play and the ecology becomes scenery.
   Recommend yes.
3. Should `accuracy` be wired in, or should hits stay deterministic? See
   above — this shapes the entire feel of the tactical layer.
4. Can the player use moves themselves, or only direct a partner? "Punch,
   kick, swing, yell" from the pitch implies yes. It also makes the flanking
   dynamic two-way, which is probably good.
5. How does death work? Roguelike permadeath collides badly with a 3-act
   authored campaign, and the pitch doesn't say.
6. Is refusing an order ever *right*? A partner that correctly refuses a
   fatal charge is a great scene; one that's just wrong is a bad mechanic.
7. **Where exactly is the automation boundary?** The central question this
   doc raises and does not answer. What is always automated, what is always
   manual, and what is player-configurable in between?
8. Does the player ever watch a fight resolve without input, auto-battler
   style, or is combat always Tier 1? A "commit and watch" option would make
   the coaching layer the *whole* combat game, which is a bolder and
   cleaner design than mixing both — and a real risk if the coaching inputs
   turn out to be too thin to carry it.

## Not decided by this doc

Everything. `NARRATIVE_PILLARS.md` arbitrates conflicts, and its refusal
tests should be run against the crafting and prayer proposals specifically
before either is built.
