# Narrative pillars

What this game is *about*, and — more usefully — what that lets us refuse.

Everything else in this repo describes systems. This describes the position
those systems take. It exists because of a claim worth stating plainly
before anything else:

> "These types of games, these simulator type games like DF and RimWorld,
> even Terraria and Minecraft, cannot HELP but to be a reflection of the
> creator's perspective on how the natural world functions... it is a
> statement, political or otherwise, or perhaps even deeper, an
> interpretation of reality that is baked in code."

The example that prompted it: a friend was disturbed to find that RimWorld's
women could be bisexual and its men could not. Whatever one thinks of the
specific call, the structural point stands — **somebody decided how
attraction works, and the decision shipped as a rule.** In a simulation
there is no "just flavour." The ruleset *is* the ontology. What causes what,
what's possible, what's even representable — those are claims about reality,
and they're load-bearing whether or not anyone made them on purpose.

So the stated intent for this project, even as a throwaway fan game:

> "I'm the type of person to really want to be thoughtful about the reality
> I'd reflect and create."

## Omission is a claim too

One sharpening on the thesis above, because it's the part that's easiest to
miss: **not modelling something is also an assertion.** It says that thing
isn't part of what life is. A simulation's silences are as opinionated as
its systems.

Ours, currently, honestly listed: we don't model disease, human aging,
childbirth risk, injury that doesn't heal, or scarcity of anything but food
and water. Each of those is a live claim about what a life consists of. Some
we'll want to keep (a game needn't contain everything); the point is to know
we're making them rather than discovering later that we did.

## The method: deliberate inversion, proven by play

The pillars below are not decoration and they are not warnings against
tropes. **They are scenarios built to invoke a familiar expectation and then
let the simulation disprove it.**

This is the core working principle, confirmed directly: the setups are
deliberate — "scenarios set up to carefully invert expectations to make the
very points I'm talking about." That's why establishing them precisely
matters. An accidental trope is a cliché; an invoked-then-broken trope is an
argument.

Which gives the single hardest discipline in this document:

> **Let the systems make the argument. Never the dialogue.**

If an NPC has to explain the theme, the systems failed to demonstrate it.
This is the same restraint LORE_NOTES.md already arrived at from a different
direction (the shipped Pokémon myths explain *rules*; the affecting material
stays environmental and unexplained). A game with explicit values fails by
becoming preachy, and preachiness is what happens when the text has to carry
what the mechanics didn't.

---

## Pillar 1 — Humans are animals too

> "We aren't THAT special. And the binary between man and nature is thinner
> than we realize. Perhaps one could imagine alternate ways of coexisting
> with the natural world than trying to dominate it."

**The expectation it inverts.** Pokémon trains you to be a trainer: master
of creatures, top of the hierarchy, collector of life. The game opens by
stripping that entirely — alone at the bottom of a cave, the weakest thing
present, prey rather than predator. The power fantasy never arrives. Then
something better does, and it isn't mastery.

**Where it's already structural, not aspirational.** This one is already the
file layout. Humans are a `SpeciesDef` entry running the same `needs.ts`,
the same herd machinery, the same rapport graph as any Bulbasaur. No capture
mechanic exists, so the relationship can only ever be relational. The
fragile-human player was decided long before this document.

**The tension, and its resolution.** We also made humans distinct — they
farm, they use fire and tools, they build. Doesn't that smuggle human
exceptionalism back in?

No, provided we hold the line: **the difference is of practice, not of
kind.** Humans are specialised the way beavers are specialised. And the
specialisation must carry real ecological cost — fields attract raids,
walls need manning, stored grain rots, settlements fail. If farming were
pure upside, exceptionalism would return through the back door.

**What this refuses:**
- Any human capability with no ecological cost attached.
- Any problem the player solves *by* domination.
- Any capture mechanic, ever.

## Pillar 2 — There are stories everywhere, if you look closely enough

> "History matters; the details you frame can make facts and data turn into
> something compelling and moving. And the curation of that is quite
> important; it's what speaks to us as humans."
>
> "It builds in layers. There are constellations of broad reasons why things
> happen, and it's fun to think and ponder why and how they played a role
> into how things turned out."

**The expectation it inverts.** Story is normally *delivered* — cutscenes,
quest text, an authored plot placed in front of you. Here the story is
already in the ground before you arrive. A ruin is a ruin for a recorded
reason. An elder's account of their grandmother's village is true in the
data.

**Where it's already structural.** The chronicle, herds with real founding/
split/migration histories, notable titles earned from accumulated stats,
the generated history pass, and the internal-bible principle (generate
everything, expose slivers).

**The word doing the most work is "curation," and it's a mandate.** A
simulation generates everything, and most of it is noise. Dwarf Fortress's
real limitation isn't a shortage of stories — it's that its stories are
legible mainly to people who enjoy reading logs. "Stories everywhere"
without curation becomes stories nowhere.

So the teeth-version: **the game is responsible for noticing on the
player's behalf.** An editorial layer that decides what surfaces is a
separate job from simulation, with its own real cost, and it is not
optional.

"Constellations of broad reasons" is also a design constraint, not just a
sentiment: events should have *layered* causes — a raid happens because a
bad season shrank the harvest because the weather system did something
because the macro grid put this valley in a rain shadow. Single-cause events
are the failure mode.

**What this refuses:**
- Shipping a system whose output is only readable as a log.
- Events with exactly one cause.
- Backstory that isn't true in the data.

## Pillar 3 — The rugged individual is a myth

> "Relationships and bonds are a necessity for life. The lone cowboy, though
> he looks cool, is actually supported by all the people who made him who he
> is."
>
> "The idea that a single individual can shape his own destiny and the world
> alone; or even live in 'freedom' alone, is overrated."
>
> "People can embark alone on journeys; they can be lonely. But they can't
> survive or do anything meaningful without community. Our sociability
> creates meaning."

**This is the pillar the campaign is built to invert, and the inversion is
deliberate.** Both genres we're standing in — roguelike and Pokémon — train
the player to expect *you, alone, get strong and overcome*. Act 1 invokes
that expectation on purpose: alone, at the bottom, no supplies, escape by
your own wits.

Then it doesn't hold. Solitude is something the player **endures, not
masters.** You don't get out of the cave by becoming tough enough. You get
out because you stopped being alone — and the game should make the solo
stretch feel like something barely survived rather than something conquered.

**Consequences that follow, and should be protected:**
- **"You're the first" means unsupported, not exceptional.** Your
  circumstances stripped away the social structure that taught everyone else
  to keep their distance. That's a loss you're recovering from, not a
  superpower. You could bond because you *had to*, not because you're better.
- **The player must not single-handedly save the village.** Act 2's village
  survives *with* you. Quests that enable others beat quests where you solo
  the problem — and the settlement's own simulated labour should visibly do
  the work.
- **Bonding is the mechanic that makes progress possible**, not a reward for
  having already succeeded alone.

**Where it's already structural.** No capture. The rapport graph. Herds as
named persistent entities. Inherited roles — an office survives the person,
because institutions are how communities outlast individuals. The four
bonding verbs, of which the strongest (Rescue) is explicitly mutual.

**What this refuses:**
- Any moment where the player succeeds alone at something that mattered.
- Framing the protagonist as chosen, gifted, or singular.
- A partner who reads as equipment rather than a relationship.

## Pillar 4 — All that you change, changes you

> "When you shape the environment around you, it changes something about
> yourself. To be the type of person to want to change the environment, you
> must be shaped. And then even the act of changing, changes you — your
> motivations, your being, the way you spend your time."

**The expectation it inverts.** RPGs let you *pick* who you are from a menu,
and treat the world as a resource to optimise. Here identity isn't chosen,
it accretes; and the world doesn't reset.

**The convergence that makes this buildable.** We already decided, from the
Pokopia contrast, that **"Pokémon are what they are; humans become what they
do"** — Pokémon roles come from instinct/typing, human roles are *earned*
through accumulated history. The player is a human. So the rule already
applies to them:

> **No class selection. Only accreted identity.**

You don't pick "farmer" or "fighter." You become one because your logged
history contains that life. `notables.ts` already earns titles from real
accumulated stats — the player is simply another case of a system that
exists.

**It extends three ways:**
- **You** — shaped by practice, not by a menu.
- **Your partner** — one that fought beside you becomes measurably different
  from one that guarded fields.
- **The land** — it remembers. `fire.ts` already leaves scorched ground; a
  burned forest stays burned. A heavily farmed zone is depleted. You live
  beside what you did.

**This is the least-built pillar and the highest-potential one.** Currently
the player changes the world and nothing changes back.

**What this refuses:**
- Any player-facing identity choice that's a costless menu pick.
- Any change to the world that leaves no trace.
- Fast travel or resets that let you outrun consequences.

---

## Where the pillars collide

Honest tensions, kept visible rather than smoothed over. Collisions are
where the actual design decisions live.

- **1 vs. farming.** "Humans aren't special" against "humans are the only
  thing that makes the land produce more." Resolved above via *practice, not
  kind* — but it needs active defending every time a human capability is
  added, because the drift is always toward exceptionalism.
- **2 vs. 2.** "Stories everywhere" pulls toward generating maximum history;
  "curation matters" pulls toward surfacing almost none of it. Both are
  right. The resolution is the internal-bible principle: generate richly,
  expose slivers, and treat restraint as the skill.
- **3 vs. the roguelike form.** Roguelikes are structurally solitary — one
  character, one run, mostly alone. We're deliberately using that form to
  argue against its own premise, which is elegant but fragile: if the solo
  stretch is *fun* in the wrong way, the inversion fails and we've just made
  a competent lone-survivor game.
- **4 vs. replayability.** A world that remembers, and an identity you can't
  re-pick, cuts against the "roll a fresh character and optimise differently"
  loop. That's probably correct for this game, but it is a cost.

## How to use this document

When a design decision comes up, it should be answerable by pointing at a
pillar. If no pillar arbitrates, either the decision doesn't matter much, or
a pillar is missing.

The refusal tests are the working part. A pillar that never causes us to
reject anything isn't a pillar, it's a mood — and should either be sharpened
until it bites or dropped.

## Still open

- **Which omissions are deliberate?** (See "Omission is a claim too.")
  Disease, aging, injury that doesn't heal, non-food scarcity are all
  currently unmodelled by default rather than by decision.
- **How does the curation layer actually work** — what promotes one
  generated event over the thousands around it into something the player is
  shown? Named as a mandate above; unbuilt and unscoped.
- **How much does the land remember, and for how long?** Pillar 4 wants
  persistence; the demoted-zone model currently freezes terrain rather than
  ageing it.
- **Does the player's accreted identity feed back into mechanics**, or is it
  only narrative/reputation? The first is much stronger and much more work.
