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

## PP economy rules

| Rule | Threshold | Why |
|---|---|---|
| `ppCost` only on identity nodes | — | A PP cost is a build decision, never a filler tax |
| A tree that spends PP must sell headroom back | ≥ pool ÷ 3 | "A tax is not an economy" |
| PP-cost density scales with pool | ≤ `ceil(pool / 12)` | "Make the low pp moves not as punishing then" |
| `maxPPBonus` with no `ppCost` anywhere | fails | A dead pick wearing a choice's clothes |
| Canon pool must be declared | fails loudly | The `NaN` silent-pass bug above |

## What is NOT checked, deliberately

- **Whether a fantasy is any good.** No script can tell you a branch is
  boring. The checker catches *structural* tells of boredom (one lever, one
  flavour, no decision) — it cannot catch a well-structured tree nobody wants
  to build.
- **Balance.** Numbers are a human decision here; see
  `CLAUDE.md`'s standing rule about never unilaterally retuning them.
- **Shipped trees.** The checker only reads `proposed-trees.ts` today.
  Pointing it at `MOVES` is the obvious next step and would immediately
  report real findings — several shipped trees sit at 6 `anyOf` against the
  standard of 9.
