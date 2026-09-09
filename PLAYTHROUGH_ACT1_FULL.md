# Paper prototype: Act 1's first hour, everything switched on

A second, longer pass than `PLAYTHROUGH_LAYER1.md` — that one covered ~20
turns of movement. This runs the whole opening arc with **crafting, items,
knowledge, observation-learning and the bonding verbs all in play**, to see
whether the pieces designed separately actually compose.

Roughly 200 turns. Everything below uses systems that exist or are specified.
Findings at the bottom, and two of them are real problems.

---

## Phase 1 · Dark — turns 1–8

Spawn. Sight radius 4 (`computeVisible`'s darkness penalty). Rock, and a
faint glow east. No inventory, no gear, three bad moves.

> *The passage narrows.*
> *Something skitters away, behind you.*

Six turns of walking, four ambient lines. The skitter is a real `flee`
behaviour change from an agent outside your view — **you caused it**, and
that's the threat-signature system introducing itself before you know it
exists.

## Phase 2 · The chamber — turns 8–20

Sunbeams, a lake, flora, three `???` drinking at the far shore.

`examine` (free) → *"a small four-legged creature, brown, bushy tail. It is
drinking. It has not noticed you."*

## Phase 3 · First crafts — turns 20–45

`search` → lichen ×3. `examine lichen` → *"it peels away in fibrous
strands."*

```
craft fiber      3 turns
craft cordage    3 turns
search (sunbeams) → deadwood ×2
craft torch      5 turns
equip torch
```

**The world doubles in size.** And: *"Something moves, further off than you
could see before."* The torch's cost arrives with its benefit.

Elapsed: ~45 turns. You have a light and a rope. **This part works.**

## Phase 4 · The first approach — turns 45–60

You walk at the herd. At 4 tiles the nearest lifts its head
(`FLEE_DETECT_RADIUS`). One more step and all three bolt.

No damage, no failure text. The thing you wanted moved away from you.

## Phase 5 · The wall — turns 60–80

**And here the prototype stalls.**

You know the threshold now. You have no way to cross it. Of the four bonding
verbs: **Feed** needs food you aren't carrying, **Fight alongside** needs a
fight, **Rescue** needs something hurt, **Presence** needs you closer than 4
tiles — which is exactly what just failed.

Your craft list (the seven known-from-start recipes) offers: fiber, cordage,
haft, torch, club, poultice, campfire. **Not one of them helps.** The club
actively hurts.

A player sits here with nothing obviously to do. This is the weakest point
in the whole opening.

## Phase 6 · The teach — turns 80–120

What should break the stall, and it's the best beat in the design:

> `> watch`

Twelve turns of the `watch` time-spend. The herd drifts back. And one of
them — spooked by something you can't see — **slips into a bush at the
water's edge and vanishes from your view.**

> *You lose sight of it entirely, though you know where it went.*
> *Glimpsed: something worn, that makes you hard to see.*

**You just learned the camouflage cloak by watching an animal hide.** That's
observation-learning firing exactly as specified, and it's thematically
perfect — the cave teaches you to hide by showing you something hiding.

```
search → lichen ×2
craft fiber, then cloak    8 turns
wear cloak
```

## Phase 7 · The second approach — turns 120–150

Cloaked, moving slowly. Threat signature down. You reach **2 tiles** before
the nearest reacts — and it doesn't bolt. It watches you.

`effectiveDisposition`'s per-individual boldness means **this one specific
creature** tolerates you and the other two don't. You didn't choose a
starter. You noticed which one didn't run.

**Presence** is now live. That's one bonding verb, earned.

## Phase 8 · Food — turns 150–200

`search` the bank → Oran berries ×2. Craft the forage pouch (cordage +
fiber, 6 turns).

Approach cloaked, crouch, set a berry down, step back.

It takes twenty turns to come. It eats.

**Feed** — two verbs. The bond has actually started, at roughly turn 200.

---

## How it feels, honestly

**Turns 1–45 are good.** Dark → light → first tool is a clean, wordless
tutorial, and the torch payoff lands.

**Turns 45–80 are the problem.** The game correctly teaches you that you
can't just walk up — and then offers no next step. Everything you know how
to make is irrelevant to the only goal you have.

**Turns 80–200 are the best part of the design**, *if the player finds
`watch`.* The chain — watch → learn from what you saw → craft it → it works
— is the whole game in miniature, and none of it was explained.

**Pacing check:** ~200 turns to first Feed. At a few seconds per turn that's
roughly 10–12 minutes, which lands inside DESIGN.md's *"first bond should be
a 5–15 minute arc."* The shape is right.

---

## Findings

### 1. The camouflage cloak isn't learnable — a real hole my own docs made

The cloak is in the **first-playable ten** and it's the peaceful path's
whole identity. It is **not** in the known-from-start seven. And in a cave
with no NPCs, no written recipes and nothing crafted lying around, there is
no way to examine an example.

So as specified, **the most important item in Act 1 is unobtainable.**

Three fixes, and I'd take the third:
- Add it to known-from-start — safe, and wastes the best teaching moment.
- Place one to find — fine, but who left a cloak in a cave?
- **Learn it by watching something conceal itself** — a creature entering a
  `bush` tile and dropping out of your FOV. That's `Tile.concealment` and
  `computeVisible`, both real, and it turns the stall in Phase 5 into the
  lesson in Phase 6.

### 2. Phase 5 needs a nudge or players will quit there

The design deliberately refuses to explain itself, and mostly that works.
But "you have failed to approach and nothing you can make helps" is a dead
end unless the player thinks to *stand still and watch* — which is not an
obvious verb in a game about doing things.

Cheapest fix that doesn't break the no-tutorial rule: **make the sensory
layer point at it.** After a failed approach, ambient text notes the herd is
still nearby and settling — *"They haven't gone far. They're drinking
again."* That's true, it's derived from real agent state, and it suggests
patience without instructing.

### 3. ~~Nothing motivates leaving layer 1~~ — I misread the pitch

**Retracted.** Re-reading Act 1 as written, the motivation is stated twice
and I'd flattened both:

> "You start at the bottom of a 5 or 6 layer cave. Alone. **Your first goal
> is to escape.**"

> "**Your first goal is to befriend a Pokémon to help you.**"

Two "first goals" is not sloppiness, it's the structure: **escape is the
frame, and the partner is the means.** You befriend something *to help you*
get out. Layer 1 being safe is therefore correct — it's the preparation
ground, not a place you need pressure to leave.

So the real answer to "why leave" is: leaving is the whole point, and you
stayed only long enough to find someone to leave *with*.

What remains open is narrower and worth keeping: **the player needs to know
early that up is the only way out.** That's one line of environmental
framing — the way down is flooded, collapsed, or simply behind you — not a
motivation system.

### 3b. The thing I actually missed: this is a five-layer structure

I prototyped the bottom layer as if it were the whole act. The pitch:

> "These layers are bigger than our zones, **probably 2 or 3 of em
> together**."

So Act 1 is **5–6 layers × 2–3 zones each = roughly 10–18 zones**, and layer
1 is deliberately the only safe one. The difficulty curve *is* the stack:

| | |
|---|---|
| **Layer 1** (bottom, start) | Peaceful, prey only, herds, water, sunlight, plants. Earn trust here |
| **Layers 2–5** | "More prey to recruit, **predators who will attack you directly**" |
| **Exit** | "Ultimately you can get a fire, water or electric stone. Then you emerge" |

Three consequences for everything designed so far:

- **The partner is a survival tool, not a collectible.** Layers 2+ are
  balanced around having one. That justifies spending 200 turns on the
  bonding arc in layer 1 — it isn't a slow opening, it's the equipment
  phase.
- **The club stops being a trap.** In layer 1 it's counterproductive (no
  predators, high threat, herds you want). From layer 2 it's the thing you
  wish you'd made. **The same item flips value across the boundary**, which
  is a much better arc than "weapons are bad."
- **Predators are befriendable too** — *"harder to befriend them, though
  still possible if you can figure out a way to do that."* That's a puzzle
  the trust design hasn't touched, and "figure out a way" implies the
  species-specific bonding paths `DESIGN.md` already specifies.

Also missed: **the evolution stone is the exit condition**, and there are
three of them. Which stone you leave with plausibly shapes what your partner
becomes — that's a real branch sitting in one line of the pitch.

### 4. The club is a trap, and that's correct

At every point in this run, crafting the club would have made things worse:
higher threat signature, herd flees sooner, no predators to use it on. A
player who defaults to "make a weapon first" gets a slower opening.

That's the design working. Worth making sure it's *recoverable* — the club
should be droppable and its threat cost should not be permanent.

### 5. Four of the seven known-from-start recipes are dead weight in the opening

Haft, club, poultice and campfire all go unused for 200 turns. Only fiber,
cordage and torch matter. Not necessarily wrong — but if the opening list is
meant to teach, three quarters of it is teaching nothing yet.

---

## What this prototype confirms works

- Dark → light → torch as a wordless tutorial.
- Sunbeam-gated deadwood: **the safe chamber holds the material that lets you
  leave it.**
- Per-individual boldness selecting your bonding candidate for you.
- Free examine as the engine of everything.
- Observation-learning, once it has something to teach.
- The two-tier turn model — Tier 2 time-spends (search, watch, craft) are
  where most of this run happens, and Tier 1 only matters at the approach.
