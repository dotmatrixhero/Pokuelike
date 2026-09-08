# Player actions: the moment-to-moment game

Status: **design proposal, nothing decided.** This doc exists to be argued
with. Confidence tiers are marked per section. Nothing here is built.

The framing ask, verbatim:

> "i need you to help me design the actual player actions. moment to moment
> gameplay, ux, like how to make decisions and what info you have on screen.
> etc. do we add crafting? praying?? fog of war, etc."

And the two constraints it has to satisfy, both stated earlier by the user:

> "the ability to make decisions is core to gameplay, and being informed
> about what decisions youre making is important"

> "if we can streamline them into the limited amount of buttons a player has
> to press via separating their intention from a sequence of decisions, that
> would be awesome"

---

## The one big idea: the player gets the sim's own verbs

**Confidence: high. This is the recommendation I'd defend hardest.**

`types.ts` already defines the complete vocabulary of things a creature in
this world can want to be doing — `BehaviorKind`, 17 entries:

```
idle · seekWater · seekFood · seekMate · flee · hunt · fight · relocate
deliverFood · carryAlly · explore · disperse · buildShelter · sleep
restAtShelter · scavenge · train
```

Every Pokémon in every zone already runs on these. The proposal is that the
player character runs on **the same enum**, driven by input instead of by
utility scoring.

Why this is the right spine and not just a cute reuse:

- **It is the "humans are animals too" pillar, made mechanical rather than
  stated.** The player is not a special entity with a special interface
  bolted onto an ecology. They're an agent in it, wanting the same things,
  running the same code paths. That pillar currently lives in prose in
  `NARRATIVE_PILLARS.md`. This is what it looks like as an implementation.
- **It is precisely the intent/sequence split that was asked for.** A
  `BehaviorKind` *is* an intent. The pathfinding, the target selection, the
  multi-turn execution — that's the sequence, and the sim already owns all
  of it (`movement.ts`, `pathfinding.ts`, `resourceIndex.ts`).
- **It is enormously cheaper than a bespoke player action system.** Most of
  the verbs in the campaign pitch already have running implementations —
  they've just never had a human driving.
- **It bounds scope by construction.** When someone proposes a new player
  action, the question becomes "is this a new way an animal can want
  something?" — which is a much harder bar to clear than "should the player
  be able to do this?" That's a feature.

### The standing order

The single mechanism that makes the above playable:

> **You declare an intent. It runs until something makes it stop.**

Press "forage" and your character paths to known food and eats — for as many
turns as that takes. It ends when: the goal completes, something enters your
field of view, you take damage, a need crosses a threshold, or you press a
key. That's it.

This one mechanism covers travel, foraging, drinking, resting, sleeping,
waiting, crafting, and training. It is the answer to "limited amount of
buttons," and it's the standard modern-roguelike answer (Brogue's travel-to,
Qult's auto-explore) generalized from movement to *every* behavior.

It also solves a real problem the tick constants create. Needs and social
systems here are tuned on 200–300-tick half-lives — that's a world designed
to run at speed. If one keypress equals one tick, crossing a zone is a
thousand keypresses and the game is unplayable. Interruptible standing orders
make "many ticks pass" the default rather than the exception.

**The interruption rule is the entire craft of it.** Interrupt too eagerly
and it's a stutter; too lazily and you die during a rest you couldn't cancel.
This needs real tuning against real runs and is the highest-risk detail in
this doc.

---

## Information: the knowledge system

**Confidence: high on the shape, medium on the tiers.**

This is the direct answer to "being informed about what decisions you're
making is important," and it resolves the earlier disagreement about the
hunting example.

The user's objection then:

> "if youre hunting and you have no idea what they are why would you ever? i
> think it would be something you unlock after talking to people, you know?
> or something like that. and even then idk if the choice would come back to
> bite you, necessarily."

That objection is correct and it points at a system rather than a fix:
**what the player knows should be modelled explicitly, and knowing should
unlock content rather than not-knowing imposing penalties.**

Proposed per-species knowledge states:

| State | How you see it | How you get there |
|---|---|---|
| **Unknown** | Silhouette; a description, not a name: *"a burning horse"*. Stats `???`. | default |
| **Seen** | Real name and type. Rough size/threat read. | look at one |
| **Studied** | Known moves it has used in front of you; diet; habitat. | observe behaviours, or be told |
| **Known** | Full entry, including the folklore. Unlocks interaction options. | complete the entry |

Load-bearing consequences:

- **The Pokédex becomes a real mechanic instead of a collectible.** No
  Pokémon game has made knowledge actually gate play. This one can, and it
  costs almost nothing — the data already exists in `packages/data`; what's
  new is a per-player mask over it.
- **NPCs and books have something concrete to give.** The "lore in books and
  via NPCs" thread from the human design pass now has a mechanical payload:
  a villager doesn't give you a quest token, they give you a *knowledge
  state*. That's why you talk to people.
- **Never punishes ignorance; only rewards knowledge.** Unknown isn't a
  debuff, it's a blank in a journal. This is the version of the pattern the
  user already argued for: "the interesting design unit is the pattern, not
  the instance."
- **It gives fog of war a second dimension.** You can see a thing and still
  not know what it is. Those are different kinds of not-knowing and the game
  can show both.

### What's on screen

Existing panels do more of this than expected: `inspector.ts`,
`eventLogPanel.ts`, `chroniclePanel.ts`, `legend.ts`, `battleScreenPanel.ts`
are all built.

The layout proposal:

- **Map** — centre, the real thing, most of the screen.
- **Your body** — hunger, thirst, fatigue, health. Bars are fine *here*: the
  "no hidden meters" pillar is about world state, not about your own body,
  which you're entitled to feel directly.
- **The log** — already exists, already writes causal prose.
- **Inspect / knowledge** — what is under the cursor, at your current
  knowledge state, with `???` where you don't know.
- **Partner** — status and current standing order.

The pillar that governs all of it, in the user's own words: *"Just dying out
is sad and vague."* If a system knows why something happened, the screen says
why. Applied to UX: never show a number without its cause reachable in one
click.

---

## The three direct questions

### Fog of war — yes, and it is already built

**Confidence: high. This is a finding, not an opinion.**

`packages/engine/src/fov.ts` implements `computeVisible` with four
independent, documented, tested terms:

- sight radius bonus from the observer's own elevation
- a concealment penalty for "bush" tiles
- **directional elevation asymmetry** — "fog thickens looking uphill, thins
  looking downhill"
- night and storm penalties (`daynight.ts`, `weather.ts` both feed it)

`fov.test.ts` covers it. And `computeVisible` has **zero callers in the
entire repository** — verified by grep across all four packages. Only
`isPathClear`, from the same file, is used, by `predation.ts`.

So a complete field-of-view system was built, tested, and never wired,
because nothing in an observer sim needs a point of view. Adding a player is
the thing that switches it on.

By the project's own standard — *"unreachable content is a bug"* — this is
currently a bug, and the player character is its fix.

Recommended presentation: standard three-state. Unseen is black; remembered
shows terrain but not creatures (your memory of a place doesn't track what
walked into it); visible is live.

### Crafting — yes, but this is the ask I'd constrain hardest

**Confidence: medium. Pushing back here deliberately.**

The pitch wants armour, a large stick, herb potions, roasted berries, a
fishing rod, TMs, stones, a backpack, and crafting tables.
`CAMPAIGN_DESIGN.md` already honestly records that **none of it exists** and
that it's one system, not several.

The honest risk: crafting is where simulation games go to die. It converts
design attention into recipe-tree content, and the recipe tree grows without
ever being the reason anyone loves the game. Nobody loves Rimworld for its
bills. The ecology and the partner bond are this game's identity; crafting is
not, and it's the item in the pitch most capable of eating six months.

So the recommendation is yes with hard rules:

- **Two ingredients, maximum, ever.** No sub-assemblies, no intermediate
  goods.
- **Recipes are knowledge, not menu entries.** Learned from a person, a
  book, or observation — same system as species knowledge. There is no
  "crafting screen" listing things you can't make yet.
- **Items are verbs you don't have yet, not stat sticks.** A waterskin makes
  `seekWater` viable at range. A firestarter makes fire portable. A spear
  turns a fight you flee into one you can take. A poultice makes injury
  recoverable away from shelter. Each new item should open a *choice*, not
  add a number.
- **Nothing craftable in the first cave.** You have a rock and a fire. Act 1
  teaches needs and danger; introducing a fabrication UI in the tutorial
  buries what the game is actually about.

The thematic argument for keeping it at all — and it's a good one, which is
why the answer is yes and not no: **crafting is how a human solves the
problems a Pokémon solves with its body.** It has a flame body; you make
fire. It has claws; you knap a point. Same need, different route. That's the
"humans are animals too" pillar with the twist that makes it interesting
rather than merely stated — same problems, no better equipped, just able to
make things.

### Praying — yes, but not as a buff

**Confidence: medium-high on the mechanism, low on the scope.**

The two usual implementations are both bad: the slot machine (NetHack's
altar — pray, roll, maybe get saved) and the flavour button that does
nothing. The first makes the sacred a resource to farm; the second makes it
set dressing.

There's a much better fit available here, and it's cheap because the systems
exist:

> **A shrine tells you true history. Praying is an information verb.**

`chronicle.ts` already exposes `chronicleFor` → `HerdStory[]` with narrative
`Beat`s, and `notableLore.ts` already generates `notableTale` prose about
individual notable creatures. The world is *already writing its own myths* —
they're just being shown in a debug panel instead of found in the world.

So: shrines are placed by the human geo pass (already planned). Praying at
one surfaces a real generated story about that region — the herd that died
here, the notable that ruled this valley, the flood the chronicle actually
recorded. And because it's real, it's *actionable*: it can mark a location,
name a creature you'd only seen a silhouette of, or advance a knowledge
entry.

Why this is the strongest version:

- It makes myth diegetic instead of decorative — the reason
  `MYTH_STRUCTURES.md` was written in the first place.
- It rewards the pillar "there are stories to be found everywhere" with a
  literal verb for finding them.
- It gives the "rules-myths vs character-myths" distinction from the lore
  research a place to actually live.
- It costs a UI and a query, not a system.

**And it sets up the ending.** If prayer has been an information verb for the
whole game — you ask, the world answers with what happened — then Jirachi,
the one entity that answers a prayer by *changing* something, lands as a
genuine violation of an established rule. That only works if prayer never
granted anything before.

---

## What I'd cut, or at least defer

Stated plainly because agreement isn't useful here:

- **TMs, evolution stones and the fishing rod are three systems wearing a
  trenchcoat.** Each is a different acquisition-and-use loop. Pick one for
  the first playable; they're all deferrable without hurting Act 1.
- **The 5–6 layer cave is a real structural change**, not a bigger number —
  `Layer` is a three-value enum and `CAMPAIGN_DESIGN.md` already flags it.
  It's plausible that a 3-layer cave teaches everything a 6-layer one does.
  Worth testing before paying for the generalization.
- **The command layer deserves more design attention than crafting, and is
  getting less.** "Choose a move, choose a target, let it path there" is
  where this game is either special or generic. A partner you earned through
  the trust machine, fighting under orders you gave, is the identity. That's
  the thing to prototype early and hard.

---

## Open questions (genuinely undecided)

1. Does one player turn equal one world tick, or do actions cost variable
   ticks? Variable is more truthful to a sim with real time constants;
   fixed is dramatically easier to reason about.
2. Do abstract (unfocused) zones advance on player turns? If not, the world
   is frozen while you play and the ecology becomes scenery. Recommend yes.
3. Is the player a human from the start, or does Act 1's cave conceal that?
   The pitch implies human; the Pokopia notes raise the alternative.
4. Can the player use moves themselves, or only direct a partner? "Punch,
   kick, swing, yell" from the pitch implies yes, which makes the player a
   combatant and changes the balance of the partner relationship
   considerably.
5. How does death work? Roguelike permadeath collides badly with a 3-act
   authored campaign, and the pitch doesn't say.

## Not decided by this doc

Everything. This is a proposal. `NARRATIVE_PILLARS.md` arbitrates any
conflict, and the refusal tests there should be run against the crafting and
prayer proposals specifically before either is built.
