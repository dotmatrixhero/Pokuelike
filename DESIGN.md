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

## Stack

- **pnpm workspace monorepo**, TypeScript everywhere.
- `packages/engine` — headless simulation core (world grid, need-driven
  agent AI, move-shape resolution). No rendering, no DOM. Unit-testable in
  isolation (vitest).
- `packages/data` — species and move definitions (plain data, imports types
  from `engine`).
- `packages/web` — Vite browser app. Canvas renderer draws real sprites when
  present (`packages/web/public/sprites/<spriteKey>.png`, not checked in —
  bring your own art) and falls back to a colored square + initial when a
  sprite is missing, so the sim is visible before any art exists.

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

Decided, not yet built:

**Three layers per region, sharing one x,y footprint:** Underground /
Surface / Canopy. A species is native to one layer (Diglett underground,
Pidgey canopy, most things surface) and moves within it normally. Crossing
layers is **common, not rare** — Diglett surfaces to forage, Pidgey lands to
drink, because their food/water is often only available on Surface even
though they live elsewhere. This is a deliberate choice over rare "risk
event" crossings: with frequent small exposure windows, story density comes
from volume (most crossings are uneventful, some aren't) rather than from
every crossing being a scripted set-piece.

**Elevation is continuous within a layer**, not a fourth layer — a
heightmap on Surface (and potentially the other layers) for hills/ridges
that drives:
- FOV/line-of-sight (can't see over higher terrain; high ground extends
  sight range),
- combat accuracy/evasion (elevation delta between attacker and defender
  tiles as a modifier — classic high-ground tactics).

This is a real engine change, not a config tweak: `Tile` needs an
`elevation` value per layer, and FOV/LOS needs an elevation-aware
shadowcasting pass instead of flat 2D visibility. Not built yet.

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
