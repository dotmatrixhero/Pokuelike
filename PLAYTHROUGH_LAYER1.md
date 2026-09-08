# Simulated playthrough: the first 60 seconds of Act 1

A MUD-style walkthrough of the opening, played out turn by turn to find out
what the player actually *sees* and *does*, rather than what the design docs
say they will. Direct ask:

> "can you just use your imagination to like 'simulate' the experience in
> your head? like the explain the game state, to yourself, then take an
> action to yourself, almost mud like."

Every glyph, terrain kind, need and system below is real in the engine
today. Findings are at the bottom — several are problems.

## Decisions recorded before starting

- **Damage heals**, and **Speed is reduced while healing.** Given directly.
  This is free: `actionSpeedOf` already composes an injury term into the
  action economy, so being hurt already means acting less often.
- **Reputation, not a morality system.** Given directly: *"having a
  reputation is enough... not unlike becoming notable, but having Pokémon
  and human alike treat you slightly differently as you become a certain
  way."* So no kill-ratio ledger, no myth trigger to build — it's
  `notables.ts`'s existing earned-title machinery pointed at the player,
  with small attitude effects. Scoped way down from the previous doc.

---

## Turn 0 — spawn

```
                                        YOU
    # # # # #                           health   ████████████  full
   #  .   .  #                          hunger   ██████████░░  fed
  #   .  @ .  #                         thirst   █████████░░░  ok
   #  .   .  #  ~ ~                     
    # # ~ ~ ~                           carrying nothing
        ~ ~                             held     —  (bare hands)
                                        
                                        punch · kick · yell
  It is dark. Something to the east
  is faintly lit.                       > _
```

You can see four tiles in each direction. `computeVisible`'s darkness term
(`NIGHT_FOV_PENALTY`) is doing that — underground, unlit, your sight radius
is cut. Water (`~`) at the edge of vision to the southeast.

No inventory. No weapon. Three moves, all bad. Nobody has explained
anything.

**The only affordance is the light.** That's the whole opening: it is the
one thing on screen that isn't rock, and you walk toward it. No tutorial
text, no quest marker — a glow in the dark is legible to anyone.

> `> move east`

## Turns 1–6 — walking

```
     # # # # #
    #  .   .  #                         Six turns pass.
   #   . . @ .  o                       You hear something skitter
    #  .   .  #                         away in the dark behind you.
     # # ~ ~ ~
```

Nothing happens for six turns. You press a direction key six times.

**This is the dead spot, and it's exactly what the auto-roguelike idea was
for.** Travel across known-empty ground is not a decision; it's typing.
A `travel to the light` command that runs until something interrupts is
worth its weight here, and this playthrough is what justifies it — not
theory.

The skitter is ambient and does real work: it says the cave is inhabited
before anything is visible, which is tension you get for free from agents
already moving in the dark outside your FOV.

## Turn 7 — the chamber

```
      # # # # # # # # # # #             YOU
     #  `  ` o o o `  `  `  #           health   ████████████  full
    #  ` `` o o o o o `` `   #          hunger   █████████░░░  fed
   #  " `` @ o o o ` `` " "  #          thirst   ████████░░░░  ok
    #  " ` ~ ~ ~ ~ ~ ~ ` " " #
     # ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ #            Seen here
      # # ~ ~ ~ ~ ~ ~ # # #               3 × ??? (small, four-legged)
                                        
  A shaft of sunlight falls into a       > _
  wide chamber. There is a lake, and
  plants, and something is drinking
  at the far shore.
```

`o` is `sunbeam` — real terrain. `` ` `` is flora, `"` is food, `~` is the
lake. This is the pitch's *"underground lake or river with lots of sunlight
and plants... peaceful, prey only."*

Three creatures at the far shore, rendered as `???` because the knowledge
system has never seen them. You know they are small and four-legged because
you can see them, and nothing else.

**This is the real opening beat**, and it lands. Six turns of dark rock
makes the reveal work. The chamber is safe, and the game hasn't said so —
you infer it from nothing attacking you.

> `> look at the creatures`

## Turn 7 (free action) — looking

```
  ??? — a small four-legged creature, brown, with a bushy tail.
       It is drinking. It has not noticed you.
       You know nothing else about it.
```

Free action, no turn spent. This is `PLAYER_ACTIONS.md`'s "information is
never rationed" rule, and it matters immediately: the first thing a player
does in a new world is *look at things*, and charging a turn for that on
turn 7 would teach exactly the wrong lesson.

"It has not noticed you" is the threat-signature system's first readable
output — and it reads as information, not a stat.

> `> move toward them`

## Turns 8–11 — approach

```
    #  " `` ` ` ` o o ` `` " "  #
     #  " ` ~ ~ ~ ~ ~ ~ ` " " #        The nearest one lifts its head.
      # ~ ~ @ ~ e ~ ~ ~ ~ ~ #          It is watching you.
       # # ~ ~ ~ ~ ~ ~ # # #
```

At four tiles it notices you — `FLEE_DETECT_RADIUS` is 4, modified by that
individual's boldness (`effectiveDisposition`) and floored at 2. A bolder
one lets you closer. **The herd is not uniform, and that's already true in
the engine**, which is a gift: the individual that tolerates you is the one
you'll end up bonding with, and it self-selects.

> `> move toward them`

## Turn 12 — it breaks

```
      # ~ ~ ~ @ ~ ~ ~ ~ ~ #            The Eevee bolts. The other two
       # # ~ ~ ~ ~ e e # #             follow it along the shore.
```

You pushed one tile too far and the herd scattered. Nothing was lost, no
damage taken, no failure state — but the thing you wanted moved away from
you.

**This is the correct first lesson and the game taught it without a word of
text.** You now know approach has a threshold. You don't know where it is.
That's the skill the whole Act 1 arc trains.

Note what did *not* happen: no "Trust −1" popup, no meter appearing on
screen. The feedback was the animal running.

## Turns 13–20 — the needs question

Hunger and thirst are still nearly full. `needs.ts`'s decay constants are
tuned on the order of hundreds of ticks, so **survival pressure will not
arrive for a long time.**

You are standing in a safe, pretty chamber with nothing pressing to do and
three creatures that just ran away from you.

> `> drink`

Thirst restored. It cost a turn and solved a problem you didn't have yet.

> `> search`

```
  You search the shallows.
  ...
  A cluster of Oran berries under the bank. (2)
```

`scavenge` as a time-spend. Twelve ticks passed; the herd drifted back
toward the water while you weren't looking at them.

**And this is the actual opening loop**, arrived at by playing rather than
by design: you now hold food, and food is *Feed* — one of the four bonding
verbs. The berries are not a survival item. They are the first move in the
only conversation available to you.

---

## Findings

Things this exercise surfaced that the design docs did not.

### 1. Three of the four bonding verbs are unavailable at spawn

The verbs are **Feed, Fight alongside, Rescue, Presence**. On turn 1 you
have no food, nothing to fight beside, and nothing to rescue. Only Presence
— standing there — is available, and standing there is not gameplay.

So the opening is not "bond with a Pokémon." It is **get into a position
where bonding is possible**, and that reframes the first ten minutes:
foraging is not a survival chore, it's the prerequisite for the only social
verb you can reach. That's a much better justification for early foraging
than hunger, which arrives far too slowly to motivate anything.

### 2. Needs decay too slowly to drive the opening — and that's fine

Hunger and thirst run on hundreds of ticks. They will not create pressure in
the first hundred turns. Rather than retune them, let the **bonding arc**
carry the opening and let needs be the slow background clock they already
are. Survival pressure arriving around the time you leave the safe chamber
is good pacing, not a bug.

### 3. The dead stretch is real and travel automation is the fix

Six turns of pressing a direction key across empty rock. Confirmed by
playing it, not assumed. A `travel` command that runs until interrupted is
justified — and this is the concrete case that justifies it.

### 4. The light is the tutorial

No text needed. One glowing thing in a dark room teaches direction,
movement, and that the world rewards curiosity. It should stay the only
guidance in the opening.

### 5. `sunbeam` already has a mechanical role, and it fits perfectly

`flora.ts` favors germination near sunbeams, sun-loving crops do better
there, and `utilityMoves.ts`'s `selfHeal` already carries a **sunbeam
bonus**. So the lit chamber is *already* where things heal and grow, with no
new code. Given the decision that damage heals with a Speed penalty while
it does, the sunbeam chamber becomes the natural place to recover — a safe
room the world defines rather than the designer.

### 6. The herd is not uniform, and that solves the bonding-target problem

`effectiveDisposition`'s per-individual boldness means one creature tolerates
you closer than the others. **The bonding candidate self-selects** — you
don't pick from a menu, you notice which one didn't run. That is pillar 4's
"identity accretes" applied to the *partner*, and it's already in the engine.

### 7. Free look is load-bearing on turn 7

The first instinct in an unknown world is to look at things. Charging a turn
for it would be actively harmful this early. Confirmed by playing it.

### 8. What's still missing to make this playable

- A `travel`/auto-move command (finding 3).
- Knowledge states, so `???` can become "Eevee" (already designed).
- The trust-stage machine — nothing currently records that a creature let
  you closer than it let anyone else.
- `search` finding anything at all — no item spawning exists.
- Feed as an actual verb.

## The honest verdict

The first six turns are weak and the fix is known. Turn 7 onward works, and
notably it works using systems that already exist — FOV darkness, sunbeams,
per-individual boldness, flee radius, scavenge, needs. The opening does not
need new mechanics so much as it needs the player agent, `travel`, and the
ability to hand a berry to an animal.
