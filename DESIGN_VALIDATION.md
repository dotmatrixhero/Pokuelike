# Design validation layer

> "Oh you have a checker? Great idea. Is that built into an MD somewhere?
> I like having a design validation layer."

Design rules in this project have historically lived as prose in
`MOVES_DESIGN.md` — and prose does not fail a build. Every rule below was
learned from a real mistake, and several of them were *re-made* after being
written down, because nothing checked them. This file is the executable half.

```bash
npx tsx packages/data/scripts/check-proposed-trees.ts            # check the drafts
npx tsx packages/data/scripts/check-proposed-trees.ts --selftest # prove it can fail first
```

## The rule that governs the rules

**A validation step that has never printed a failure has not been
verified.** This was learned twice, expensively: an Atlas layout harness once
reported all 17 trees clean without reading a single one, and a PP density
rule silently passed everything because it compared against an undefined
pool (`NaN > NaN` is false). So the checker runs `--selftest` against a
deliberately malformed tree and **exits non-zero if it fails to find the
problems it is supposed to find**. It currently catches 16 on that tree.

When adding a rule, add its failing case to the selftest in the same commit.

## Structural rules

| Rule | Catches | Origin |
|---|---|---|
| Dangling prerequisite | A node pointing at an id that does not exist | — |
| One-sided fork | `excludes` declared on only one of a pair | — |
| Missing `leaning` | A node that would render **invisibly** in the Atlas | Found live: `dig.never_still` and `leech_seed.wider_reach` had both lost it |
| `prerequisitesAnyOf` count = 9 | A tree with fewer routes than the shipped standard | The drafts shipped at 0–1 against 9 |
| Crosslink count = 3 | — | — |
| **Corridor check** | A branch offering no decision at all: neither a permanent `excludes` fork nor two parallel lanes | Four of five drafts were pure linear chains and nobody caught it |

## Crosslink rules — bridges, not spurs

| Rule | Catches |
|---|---|
| A crosslink must have a filler *and* a notable | A two-node spur wearing a bridge's name (principle 7) |
| Bridge notable must be cost 2 | A bridge that never pays off |
| Must shortcut into **both** branches it connects | Principle 11 — a bridge serving only its own `leaning` |
| Must land one step short of a fork, never on it | Principle 12 — skipping the grind, not the decision |
| Bridge filler must share a lever with its crosslink | Principle 13 — a generic stat grab in the middle of a bridge |
| **Both sides of a fork must reconverge** | A stranded route. Caught a live bug: every filler fork's B-side was a dead end because the downstream node still required the A-side |

## Content rules

| Rule | Threshold | Origin |
|---|---|---|
| **Principle 17** — one signature lever must not answer a whole branch | ≤60% of identity nodes; shipped roster tops out at 50% | "twin needle just fuckin does the same shit the entire branch for sociable" |
| **Colour-pie coverage** — a branch draws on ≥3 flavours | shipped averages 3.8 | "Branches need to have multiple Flavors to it, not a linear path" |
| **Principle 4** — no pure-downside node | benefit and cost in the *same* node | A node that cost a skill point for `recoilFraction` alone |

Two refinements worth recording, because both were flaws in the *measurement*
rather than the design:

- **Background stats are excluded** from the repetition check. `power`,
  `accuracy`, `cooldownTicks`, `range`, `critRateStage`, `defensePenetration`
  repeat harmlessly everywhere; the defect is a *signature* lever repeating.
- **Container fields are expanded, not counted whole.** `allyEffect` covers
  both a heal and a stat buff; `situationalBonus` covers night/flanking/
  elevation; `forcedMovement` covers a shove and a lunge. Keying on the
  container name reported two genuinely different nodes as identical. The
  checker keys on the discriminating sub-field instead.

## The tempo formula

> "write down your tempo calculation in the validation documentation too.
> It's a helpful formula for us later"

**Cooldowns are counted in the agent's own turns**, not world ticks —
`tickCooldowns` runs inside `tickAgentAction`, which only fires on an action
tick. So:

```
usable every (cooldownTicks + 1) actions

                      base + 1
tempo multiplier =  ─────────────      the DPS gain from cooldown nodes alone
                     floor + 1

damage per action = power / (cooldownTicks + 1)
```

`floor` is the cooldown a fully-invested tree reaches:
`base − (total of every negative cooldownTicks delta)`.

**The cap is 3.0x**, enforced by flooring the cooldown at:

```
cdFloor  = ceil((base + 1) / 3) − 1
maxCut   = base − cdFloor          the most reduction a tree may hand out
```

| base | floor | max reduction | tempo |
|---|---|---|---|
| 2 | 0 | −2 | 3.00x |
| 3 | 1 | −2 | 2.00x |
| 5 | 1 | −4 | 3.00x |
| 8 | 2 | −6 | 3.00x |
| 9 | 3 | −6 | 2.50x |
| 15 | 5 | −10 | 2.67x |

**Why 3.0x.** Measured against the other levers fully invested: power nodes
average **2.00x**, multi-hit **2.00x**, tempo was running **2.61x** and hit
**5.0x** on Hydro Pump. Tempo is the cheapest thing to buy in a tree, so left
uncapped it dominates. The cap puts it in the same band as everything else
while still letting a heavy move feel meaningfully faster when specced.

**Corollary worth remembering:** reduction beyond `base` is not merely capped,
it is *dead* — a node that provably does nothing. That is a separate check
from the cap and fires on its own.

## PP economy rules

| Rule | Threshold | Why |
|---|---|---|
| `ppCost` only on identity nodes | — | A PP cost is a build decision, never a filler tax |
| A tree that spends PP must sell headroom back | ≥ pool ÷ 3 | "A tax is not an economy" |
| PP-cost density scales with pool | ≤ `ceil(pool / 12)` | "Make the low pp moves not as punishing then" |
| `maxPPBonus` with no `ppCost` anywhere | fails | A dead pick wearing a choice's clothes |
| Canon pool must be declared | fails loudly | The `NaN` silent-pass bug above |

## Template v4 shape

| Rule | Catches |
|---|---|
| 12 nodes per branch | A branch short of the standard — "we do have 45 nodes of real ideas on everything" |
| 4 identity nodes per branch | Two lane notables, a deep convergence notable, a capstone |
| Exactly one terminal identity node | Two competing capstones, or none |
| A deep notable both lanes converge on | Lanes that never rejoin |
| One filler between deep notable and capstone | A capstone hanging straight off the convergence |

The node-count rule reverses an earlier position in `MOVES_DESIGN.md`, and
the reversal is the interesting part: "thin lever set" turned out to be a
rationalisation. Dig uses **12 of the roster's 71 levers and leaves 59
untouched** — its 29 nodes were an unexplored fantasy, not a small move.
The guard against padding to 45 is not a lower count; it is the flavour,
repetition and pure-downside rules above.

## Passive ceilings (per move)

Direct ask: *"we should maybe try to aim to cap at 20% dmg reduction max,
10% regen per move. Tbh up to 50% thorns is fine, it can be a case where it
hits back quite hard."*

| Passive | Per-move cap | Why this one is different |
|---|---|---|
| `damageReduction` | 20% | Flat multiplicative mitigation, no engine cap at all |
| healing (`regen` + `healAura` + `regenFlat`/43) | 10%/tick | One budget across three kinds, because `status.ts:422` folds them into one share before `softCapHealShare` bends it |
| `thorns` | 50% | Deliberately loose — hitting back hard is a legitimate build |

The healing budget converts `regenFlat` at a reference **maxHp of 43**: the
measured median over all species x levels 5/15/30 (level-5 median 21,
level-15 43, level-30 76). The overall median rather than the level-30 one
is the conservative choice, since a deeply-invested agent is usually high
level, where the same flat regen is worth about half as much share.

**A per-move cap does not bound a species.** `grantPassive` does
`agent.passives[kind] += value` (`status.ts:342`) with no cap, and an agent
spends points across the trees of *every* move it knows. Four capped moves
still stack to 80% damage reduction. `passive-exposure.ts` is the tool that
measures that; this rule only stops any single tree from being the whole
problem by itself.

Findings on first run over the shipped roster:

| Move | Reading | Cap |
|---|---|---|
| dig | 29% damage reduction, 28.4%/tick healing | 20% / 10% |
| leech_seed | 23.9%/tick healing | 10% |
| solar_beam | 20.8%/tick healing | 10% |

All three healing overshoots are driven by `regenFlat`, which the earlier
per-move table missed because it summed only the fractional kinds.

## What is NOT checked, deliberately

- **Whether a fantasy is any good.** No script can tell you a branch is
  boring. The checker catches *structural* tells of boredom (one lever, one
  flavour, no decision) — it cannot catch a well-structured tree nobody wants
  to build.
- **Balance.** Numbers are a human decision here; see
  `CLAUDE.md`'s standing rule about never unilaterally retuning them.
- **Cross-move passive stacking.** Every rule here is per-tree. Species-level
  totals are `passive-exposure.ts`'s job, and nothing fails a build on them
  yet.
