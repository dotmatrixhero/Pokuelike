# Myth structures: the skeletons, and how our sim could generate them

Structural analysis of the leaked species folktales (see LORE_NOTES.md for
provenance and the standing "don't build on the content" position). This doc
is about **form, not content** — the recurring skeletons, what norm each one
justifies, and which of our real systems could produce and validate them.

The point: LORE_NOTES.md established that generated etiological myths are
the highest-value output of the history pass. This is the spec for what
those myths would actually look like.

Handled at the level of structure and function throughout, deliberately.

## The finding that matters most

**Every violent myth in the corpus is a rule about taking life, and what
happens when you break it.** They are a legal code wearing a story. And the
rules they encode are:

- Take males without offspring; never breeding females, never young.
  *(Rapidash)*
- Return the remains correctly, by the protocol specific to that species.
  *(Tauros, Rapidash)*
- Killing for food is permitted; **mutilation and excess are not**.
  *(Lapras/Octillery — the horror is disfigurement, not hunting)*
- Killing for **amusement** is the original sin. *(Slakoth)*

Those are ecologically sound harvest rules. Don't take breeding females.
Don't take juveniles. Don't take more than you need. Don't waste.

> **Respect and sustainability are the same rule.**

Which in our project can be **literally true rather than merely thematic.**
Overhunt breeding females and the aggregate population model actually
crashes; a settlement that keeps the customs has a stable food supply next
door. The folklore wouldn't be decoration explaining the sim — it would be
an accurate folk description *of* the sim, arrived at by people who watched
it happen. That's the strongest possible version of the generated-myth idea.

## The shared grammar

Common structure across the corpus, which doubles as a template spec:

- **Opening formula**: "Long ago, when the boundary between humans and
  Pokémon was still blurred..." — establishes a mythic past where the
  categories we take for granted hadn't separated yet.
- **The rule of three**: acts repeat two or three times before the turn (the
  beaching happens twice; the Sharpedo looks around three times; the berry
  nights repeat).
- **The revelation that they are people**: the Ursaring den becomes a house
  full of scarred humans; Slaking and Vigoroth are the same being; "Typhlosions
  are half-human"; "female Tauros are half-human." The boundary is porous in
  both directions, and it's usually revealed rather than stated.
- **Mutual destruction**: nobody wins. The swordsman and the Ursaring both
  die. The eastern hunter dies wearing the skin he stole. The Slakoth woman
  drowns herself. **Violence in this corpus is never clean and never
  one-sided.**
- **Witnesses**: the Lapras/Octillery trial explicitly requires the youth to
  bring two villagers. They survive to report. The *community learning the
  rule* is the point of the story, structurally.
- **Etiological close**: it ends by explaining a present-day norm or fact.

## The six skeletons

### 1. The Trial — *Lapras / Octillery*

**Shape.** A person acquires an ungoverned weapon → uses it far past need,
mutilating rather than hunting → is summoned by the wronged party → shown
the harm in human form → instructed to come **unarmed, with witnesses** →
duel → both die → witnesses carry the rule home.

**Norm it justifies:** limits on killing; mutilation as the specific
transgression; and a *procedure* for answering for it.

**What could trigger it in our sim:** a settlement (or the player) whose
recorded history includes killing far beyond consumption in a territory —
`herdConflict.ts` escalation plus a chronicle count of kills against food
actually taken.

**Pillar served:** 1 (humans aren't special; the wronged party gets standing
and a procedure), and 3 (he dies alone; only the witnesses matter after).

### 2. The Contract — *Rapidash*

**Shape.** Two people, one unskilled-but-observant, one skilled-but-careless
→ the careful one shows restraint and is given **explicit terms** (take males
without young; never females or juveniles; handle remains with care and they
renew) → the careless one violates them and takes a trophy → is killed by
the careful one *without either knowing*, having become the animal he
skinned.

**Norm it justifies:** sustainable harvest, stated as kinship — "the female
Rapidash are your sisters-in-law, and the Ponyta are your children."

**What could trigger it in our sim:** two settlements with divergent
recorded hunting practice in the same territory, and divergent population
outcomes to match. This is the skeleton most directly checkable against real
data.

**Pillar served:** 1, most explicitly. This is the "alternate ways of
coexisting than domination" myth — a working relationship with terms, not
mastery.

### 3. The Ritual Error — *Tauros*

**Shape.** A father teaches a species-specific rite (Tauros horns go **to the
sky**) → the son, eager to hunt alone and prove himself, applies the
*small-game* rite instead (tails go **into the earth**) → prays correctly,
diligently, at the wrong altitude → the horns come back up through the earth
into the women of his family, who become Tauros irreversibly.

**Norm it justifies:** ritual knowledge is **specific and
non-transferable**. Piety isn't enough; "I prayed" isn't enough.

**Why this one is the harshest:** everywhere else the sin is cruelty or
excess. Here it's a competent, well-meant **error**, and the world punishes
error the same as malice. Note also the reversible-then-irreversible
threshold: cut the horns and she's human; let them grow and she isn't — and
"now they've both *completely* become Tauros."

**What could trigger it in our sim:** a settlement that adopted one
species' practice wholesale for another (an easy, plausible thing for a
generated culture to do when expanding into a new biome) and suffered for
it.

**Pillar served:** 3, unexpectedly — *the son goes out alone to prove he's a
full hunter, and that ambition is what destroys his family.* The rugged
individual doesn't only fail himself.

### 4. The Original Sin — *Slakoth*

**Shape.** A group kills for **amusement**, mutilating (eyes, ears) → one is
shown the accumulated dead and injured → bears a child of that species and
raises it → her friends kill the child *as they always do*, without
malice, not recognising it → she takes the body into the lake with her →
**"From then on her friends began to see the Slakoth as friends."**

**Norm it justifies:** the origin of that specific village's respect for
that specific species.

**The horror is that the friends aren't villains.** They do exactly what
they've always done. The knowledge costs a death because that's the only
thing that makes the harm legible as personal.

**What could trigger it in our sim:** a recorded local extinction or
sustained kill-streak against one species, followed by an attitude flip in
that settlement.

**Pillar served:** 2 (curation — this is the "one death that changes
everything" story a curation layer must be able to find), and 3 (the group
changes, not the individual; she doesn't convince them by arguing).

### 5. The Crossing — *Typhlosion / Piloswine*

**Shape.** A person is lost → taken in by something in human form → lives
across the boundary, has a child → their kin comes looking → the
Pokémon-spouse foresees its own death, **teaches the rite for its own
remains** (eyes, voice, heart burned with a song) → is killed → the rite is
performed → **the village's cruelty is the actual sin**: they force the pelt
onto mother and child, who become Typhlosion and vanish → "and so people
learned that Typhlosion are half-human."

**Norm it justifies:** the belief that the species is part-human — *caused
by the community's own cruelty driving the evidence away.*

**Worth noting**: the Pokémon-spouse is genuinely morally mixed. He
abducts and erases her memory; he also feeds her, warns her, gives her the
rite, and says goodbye. Neither monster nor innocent.

**What could trigger it in our sim:** a settlement's recorded treatment of
an outsider or a mixed household — closest to our per-settlement attitude
drift, and the clearest case of a myth explaining a belief the villagers
themselves produced.

**Pillar served:** 1 (the boundary is porous), 3 (exile as the punishment
for being outside the community).

### 6. The Bond Through Change — *Wurmple*

**Shape.** A creature loves another → the other **vanishes** → grief drives a
change (Wurmple → Cascoon) → the lost one reappears, having simply
**evolved** (Burmy → Mothim) → joy drives the second change (→ Dustox) → the
returned friend **teaches the changed one to fly**.

**Norm it justifies:** nothing. **This one is not etiological, and that's
why it matters.**

**The outlier that saves the corpus.** If we only generate tragedy we've
made a different — and worse — statement about reality than these texts do.
The tonal range is the point. And this is your pillar 4 stated as tenderness
instead of consequence: the fear is that change *ends* a bond; the truth is
the bond survived the change and then enabled the next one.

It's also quietly a **rules-myth and a character-myth at once** — it's
literally about the Wurmple/Cascoon-Silcoon and Burmy/Wormadam-Mothim
divergence mechanics, while carrying real feeling. That's the combination
LORE_NOTES.md noted the *shipped* Pokémon myths never manage.

**What could trigger it in our sim:** a bonded pair separated by
migration/dispersal and reunited, or an evolution event inside an
established rapport edge. Both are things the engine already records.

**Pillar served:** 4 and 3 together.

## What this gives the generator

A myth template needs: **a skeleton, a triggering event pattern, the norm it
outputs, and the cast.**

| Skeleton | Trigger pattern in the chronicle | Norm output |
|---|---|---|
| The Trial | Kills far exceeding food taken, in one territory | Limits on killing; mutilation taboo |
| The Contract | Divergent hunting practice → divergent population outcome | Sustainable harvest rules |
| The Ritual Error | Practice transplanted between species/biomes, then loss | Species-specific rites |
| The Original Sin | Local extinction or sustained kill-streak → attitude flip | Protection of one species |
| The Crossing | Cruelty toward an outsider/mixed household → departure | A belief about a species' nature |
| The Bond Through Change | Separation then reunion; evolution within a rapport edge | *(none — tonal)* |

Two things fall out that we should hold onto:

1. **The corpus was already written as swappable templates** — Lapras is a
   sanitised redraft of Octillery (same beats; the union rendered as
   "communed"; the lodged-sword detail cut; tobacco added), and Piloswine is
   a near-verbatim redraft of Typhlosion. They were being *iterated*, not
   written once. That's direct evidence the template approach is how this
   material was actually produced.
2. **A myth needs a norm to output, or it needs to be the outlier.** If a
   generated story doesn't change how a village behaves and isn't a Wurmple,
   it's noise — which is exactly the curation problem, arriving early.

## Open

- **Which norms are mechanically real?** "Don't take breeding females" can
  be enforced by the population model. "Return the horns skyward" cannot be
  anything but belief. Both are worth having, but the split matters — the
  first is a rule the world enforces, the second is a rule a *culture*
  enforces, and mistaking one for the other is how you get a preachy game.
- **Who tells the myth?** A generated story needs a channel — see
  LORE_NOTES.md's delivery taxonomy. An elder's telling, a carving, a
  practice observed without explanation.
- **Can a myth be wrong about its own trigger?** It should be able to. The
  chronicle holds ground truth; the myth is what the village concluded.
