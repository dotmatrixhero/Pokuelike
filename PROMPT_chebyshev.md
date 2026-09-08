# Task brief: make combat reach agree with 8-way movement (Chebyshev)

Copy everything below the line into a fresh agent session.

---

## Context

Repo: `dotmatrixhero/Pokuelike`. Branch: `claude/pokemon-roguelike-sim-5rje5a`.
Work on your own branch off that. **Do not merge into any other branch** —
report back and it'll be pulled in.

Movement in this engine is 8-way everywhere:

- `movement.ts`'s `stepToward`/`stepAway` try the true diagonal first
  (`candidatesToward` returns `[diagonal, horizontal, vertical]`).
- `pathfinding.ts`'s BFS expands all 8 `NEIGHBOR_OFFSETS` at **unweighted
  cost 1**.

But every combat range check measures distance with `manhattan()`, where a
diagonal neighbour is distance **2**. A point-shape move derives range **1**
(`combat.ts`'s `moveRange`/`deriveRangeFromShape`). Net effect: **a melee
attacker cannot hit a diagonally adjacent target**, even though the engine's
own pathfinding says that target is one step away. The two metrics
contradict each other.

This is already measured. `packages/runner/src/validateDiagonalReach.ts`
runs 40 trials per arrangement, identical apart from attacker position:

| Arrangement | Attacks resolved |
|---|---|
| Orthogonally adjacent (manhattan 1) | 39 / 40 |
| Diagonally adjacent (manhattan 2) | **0 / 40** |

Run it first to confirm you reproduce that before changing anything.

## The job

Switch **combat range checks** from Manhattan to Chebyshev
(`max(|dx|, |dy|)`), so melee reaches all 8 neighbours and reach agrees with
movement. Then measure what it does to the simulation.

## The trap — read this before touching anything

`manhattan()` has **58 call sites across 10 files** (`dispersal.ts`,
`herdConflict.ts`, `herdMigration.ts`, `herding.ts`, `migration.ts`,
`needs.ts`, `predation.ts`, `reproduction.ts`, `shelter.ts`, `support.ts`).

**A blind find-and-replace will break the simulation.** Most of those uses
are not combat reach — they are herd cohesion radii, migration/dispersal
distances, shelter clustering, mate-search distance, resource proximity.
Those are tuned numbers whose meaning would silently change.

Only convert the distances that feed a **move range check**. The ones known
to matter:

- `predation.ts` — the `distance`/`huntDistance` values passed to
  `canAttackFromHere` and on to `pickBestMove` (roughly lines 728, 1630,
  1675, 1681, 1803; verify rather than trusting these numbers).
- `herdConflict.ts` — the `distance` passed to `pickBestMove` in
  `resolveRivalryHit` (~line 337).
- `support.ts` — the `withinMoveRange(move, manhattan(...))` filter (~line
  737).

Add a `chebyshev()` helper next to `manhattan()` in `predation.ts` (or a
better shared home if you find one) and export it. **Leave `manhattan()` and
every non-range caller alone.**

Audit every one of the 58 sites and state in your report which you changed
and which you deliberately left, with a one-line reason each. If a site is
ambiguous, leave it and flag it rather than guessing.

## Measure it

This raises effective melee reach for every unit in the sim, so it is a
balance change, not a refactor. Required before/after, same seeds, several
of them (6+; single-seed numbers here are noise):

- Fights per 1000 ticks (`validateCombat.ts` already reports this).
- Miss rate, kills, and deaths by cause — does combat frequency spike?
- Predator and prey population curves — does predation now over-perform and
  eat out the prey base? `validateEcology.ts` and `validatePopulationCurve.ts`
  exist.
- Herd clash volume (`herdConflict` is non-lethal but very frequent — it was
  measured at 594 clashes to 45 battle hits over 6,000 ticks, so a reach
  increase here could flood the event log and the auto-camera).

Report real numbers in a before/after table. If combat frequency roughly
doubles, say so plainly — that is a real finding and a balance decision for
the owner, not something to quietly compensate for by retuning other
constants. **Do not retune anything else to hide the effect.**

## Tests

- Add a test that a melee attacker **can** now hit a diagonally adjacent
  target. Model it on the storm-accuracy and elevation-accuracy A/B tests in
  `packages/engine/test/predation.test.ts` — same fixtures (`prey`,
  `predator`, `TEST_MOVE`, `AB_COMPARISON_SEED`), and pass an explicit
  seeded rng.
- Verify your new test **fails** if you revert the change. A test that
  passes either way proves nothing.
- Update `validateDiagonalReach.ts`'s header, which currently documents the
  0/40 result as current behaviour.
- Full suite must stay green: `pnpm -r typecheck && pnpm -r test`
  (currently 1262 engine + 240 data).

Note: `createWorld` with no seed mints a non-reproducible one, so any test
running a real tick needs an explicit seed or a seeded rng threaded in —
there is a documented flake class from exactly this.

## Deliverable

Commits on your own branch, plus a report covering: the before/after table,
which call sites you changed and which you left, whether combat balance
shifted enough to need the owner's attention, and anything you found that
looks wrong but was out of scope.
