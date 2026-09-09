# The crafting tree

A proper dependency pass, rather than the list-with-hints in
`CRAFTABLES_V1.md`. This is the graph: what feeds what, what gates what, and
in what order a player actually walks it.

---

## The tree

```
GATHERED BARE-HANDED
  lichen ─────────→ FIBER ─────┬──→ (×2) CORDAGE ────┐
  reeds (knife) ──→ FIBER ─────┘                     │
                                                      │
  deadwood (sunbeam-gated) ───────────────────────────┼──→ BOUND HAFT
                                                      │
  loose flint ────→ KNAPPED FLINT ────────────────────┼──┐
  loose stone ────→ GROUND STONE ─────────────────────┼┐ │
                                                      ││ │
                                                      ││ │
  ── from FIBER alone ──────────────────────────────  ││ │
     fiber + lichen    → camouflage cloak    (worn)   ││ │
     fiber + cordage   → woven wrap          (worn)   ││ │
     fiber + deadwood  → torch               (held)   ││ │
     fiber + flint     → firestarter         (use)    ││ │
     fiber + fungus    → smoke bomb          (use)    ││ │
     herbs + lichen    → poultice            (use)    ││ │
     herbs + fungus    → antidote            (use)    ││ │
                                                      ││ │
  ── from CORDAGE ────────────────────────────────    ││ │
     cordage + fiber   → forage pouch     (+8 cap)    ││ │
     cordage + haft    → snare                        ││ │
     cordage + hide    → sling               (held)   ││ │
     cordage + bone    → fishing line                 ││ │
     cordage + hide    → waterskin                    ││ │
     cordage + hide    → hide armor          (worn)   ││ │
     cordage ×3 + hide → pack            (+14 cap)    ││ │
                                                      ││ │
  ── HAFTED TOOLS ────────────────────────────────    ││ │
     BOUND HAFT alone           → club       (held) ──┘│ │
     BOUND HAFT + ground stone  → pick       (held) ───┘ │
     BOUND HAFT + knapped flint → knife / axe / spear ───┘

  ── AT A FIRE ───────────────────────────────────
     clay + fire   → clay vessel
     food + fire   → roasted food
     food + fire   → dried rations  (doesn't spoil)
```

## The three hubs

The tree has a narrow spine and wide branches, which is the shape you want —
a few things feed everything, so the player learns three recipes and unlocks
a dozen.

| Hub | Feeds |
|---|---|
| **Fiber** | Cordage, cloak, wrap, torch, firestarter, smoke bomb, poultice |
| **Cordage** | Haft, pouch, pack, sling, snare, waterskin, armor, fishing line |
| **Bound haft** | Club, knife, axe, pick, spear, snare |

Everything else is a leaf. **If those three exist, the tree is playable**;
everything after is content.

---

## The bootstrap, and a circular dependency it fixes

Writing the tree out exposed a real bug in the earlier list:

> **Pick** = haft + ground stone. **Ground stone** = stone. **Stone** =
> mined from `boulder`/`wall` — *which requires a pick.*

Unreachable by construction. The fix is the classic one — **loose material
is gatherable bare-handed; abundant material needs the tool:**

| Material | Bare hands | With the tool |
|---|---|---|
| **Flint** | Loose flint on `rocky` ground — scarce | — |
| **Stone** | Loose stone / scree — scarce, slow | Pick: mined `wall`, abundant |
| **Fiber** | From lichen | Knife: from reeds, better yield |
| **Wood** | Deadwood near sunbeams — scarce | Axe: timber from `tree`, abundant |

Same pattern four times: **you can always start, the tool makes it
practical.** That's the Minecraft punch-a-tree bootstrap, and it also gives
every tool a legible "before/after" rather than a binary lock.

### Reachability check

Traced from nothing, everything is reachable:

`lichen → fiber → cordage`; `deadwood + cordage → haft`; `loose flint →
knapped flint → knife`; knife → hide (butcher) → armor/pack/waterskin/sling;
`loose stone → ground stone → pick` → mined stone; `haft + knapped flint →
axe` → timber; `flint + fiber → firestarter` → fire → clay vessel, rations.

No orphans, no unreachable nodes. Worth re-running this trace whenever a
recipe changes — by this project's own standard, an unreachable craftable is
a bug.

---

## The order a player actually walks it

The tree has a spine and then a fork, and the fork is the interesting part.

### Stage 1 — before you have anything (turns ~1–15)

```
  lichen → fiber → cordage
```

Two crafts, six turns, no gates. This is the tutorial and it teaches itself.

### Stage 2 — the fork

**Here's the thing the tree exposes that the list didn't:**

> **The peaceful path is available strictly earlier than the violent one.**

- **Camouflage cloak** = `fiber + lichen`. Both come off the same lichen
  harvest. You can make it **immediately after fiber** — one craft in.
- **Club** = `bound haft` = `deadwood + cordage`, and deadwood is
  **sunbeam-gated**. So a weapon requires finding the lit chamber first.

That's roughly **four crafts and a journey** between the two options, and
nobody wrote a rule to make it so — it falls out of where the materials are.
The game's thesis is in the dependency graph: *hiding is cheap and immediate;
arming yourself costs you a trip to the light.*

Worth protecting deliberately if the recipes get retuned.

### Stage 3 — the first tool decides your branch

| First tool | Opens | Reads as |
|---|---|---|
| **Knife** | Reeds, butchering → hide → armor, pack, sling, waterskin | Provider |
| **Club / spear** | Damage, reach | Fighter |
| **Axe** | Timber → building, Act 2 tier | Builder |
| **Pick** | Stone, **digging through walls** | Explorer |

None is exclusive — they're all `haft + X` and the haft is reusable. But the
*first* one is a real choice, because a haft costs a trip to the sunbeams and
your early turns are scarce.

### Stage 4 — fire unlocks the second half

`firestarter` (flint + fiber) is cheap and it gates a whole tier: clay
vessels, roasted food, and **dried rations**, which is what makes seasons
matter. Fire is the first "station" and it's craftable in the first hour.

---

## Gate summary

Every gate in the tree, in one table:

| Gate | Opens |
|---|---|
| **Sunbeam proximity** | Deadwood → haft → every hafted tool |
| **Knife** | Reeds, butchering (hide) |
| **Axe** | Timber |
| **Pick** | Mined stone, digging through walls |
| **Fire** | Clay vessel, roasted food, dried rations |
| **A kill** | Hide → armor, pack, sling, waterskin |
| **Landmark** | Bone (`boneGrounds`), ice (`frozenGrotto`) |
| **Knowledge** | Any recipe not in the known-from-start six |

Note how many things route through **hide**, and hide needs a kill. That's
the one gate with a social cost attached, and it sits in front of the best
carrying upgrade — so the pack is the item that quietly asks whether you're
willing.

---

## Act 2 extension

Same tree, deeper. Nothing restructures:

```
  ore (rocky/geothermal) ──→ BRONZE / IRON  (needs a smithing settlement)
                                  │
                                  ├──→ metal axe / pick / knife  (faster tiers)
                                  ├──→ bow          (timber + cordage + metal)
                                  └──→ plough
  timber ×N + station ──→ boat, crafting table, loom, kiln
```

The ladder is continuous: better materials and better stations, **not
different physics**.

---

## Open

1. **How scarce is loose flint/stone?** It's the bootstrap valve — too scarce
   and the opening stalls, too common and the pick is pointless.
2. **Does the haft survive re-tooling?** Swapping a knife head for an axe head
   on the same haft is realistic and reduces busywork. Recommend yes.
3. **Is there a second fiber source underground** besides lichen? Currently
   lichen is a single point of failure for the whole tree.
4. **Does felling a tree yield more than one timber?** If not, an axe is a lot
   of setup for a small return.
