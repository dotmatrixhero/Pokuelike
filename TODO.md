# TODO / Side Notes

Running list of ideas and decisions to revisit — not a sprint plan, just a
place to park trains of thought so they don't get lost.

## Stranded spawns + cornered prey never fighting back — fixed, see DESIGN.md

Direct user feedback on the live artifact ("non water Pokemon spawning in
the middle of water," "a lot of battles are sorta just one Pokémon beating
up another. Not so much fighting back."). Both traced and fixed — see
DESIGN.md's "Land spawns stranded mid-lake, and prey with nowhere left to
run" section for the full root-cause writeup and real-run evidence
(confirmed: every one of 7 tested seeds had 2-7 stranded land agents before
the fix, 0 after; a cornered Bulbasaur actually defeated a Scyther in a real
3000-tick run after gaining a last-resort counterattack).

- [x] `findWalkableNear` (worldgen.ts) now excludes tiles that would strand
      a non-water agent deep in a large lake, via the same `canEnterWater`
      check movement already enforces — fixes `anchor()`/`findPosInBiome`
      starting-agent placement, herd-migration destinations, and
      immigration's non-obligate-aquatic arrivals all at once (one shared
      root cause, one fix).
- [x] A cornered prey agent (flee step is a no-op — nowhere left to run)
      now fights back as a last resort instead of standing still and
      absorbing free hits forever, reusing the existing mob-fighting
      `resolveHit` call. Deliberately narrow: an agent that still has any
      escape route still always flees, unchanged.
- [ ] **Real follow-up, not fixed here**: a prey agent that's merely slower
      than its pursuer (not literally cornered) still takes a full chase's
      worth of free hits with no counterattack of its own, since it never
      stops having *a* flee step even as the gap closes to zero. Needs real
      speed-driven positioning or a distinct "threat is now adjacent, not
      just nearby" threshold — see DESIGN.md's section for why this wasn't
      bundled in here.

## Species/biome/immigration — built, see DESIGN.md

- [x] Three new species (Geodude, Growlithe, Mankey) closing the
      badlands/highland "zero real residents" gap, all reusing an existing
      move and an existing `EGG_GROUPS_BY_BASE_KEY` entry. Charmander (fully
      defined earlier, never spawned) now has a real starting spot in
      `createDemoWorld`, biome-placed via the new `findPosInBiome`.
- [x] `SpeciesDef.biomes?: string[]` added and tagged on every species (new
      and existing, best-effort). Real consumers: `findPosInBiome`
      (Charmander's placement) and `immigration.ts`'s spawn-site species/
      location scoring.
- [x] Immigration system (`packages/engine/src/immigration.ts`): flat
      per-tick chance roll + cooldown + population cap (soft 70/hard 110,
      linear falloff between), species picked by under-representation x
      biome-match weighting at a random map-edge arrival point, 1-3 agents
      join-or-found a herd exactly like `dispersal.ts`'s arrival logic. New
      `"immigrated"` event, headline-worthy in the web UI. 13 new engine
      tests + 19 new data-package tests (first test suite for
      `packages/data` — `vitest` added as a devDependency there). All 593
      engine tests (580 pre-existing + 13 new) and the determinism
      acceptance test pass; existing callers without an `ImmigrationContext`
      see zero behavior change.
- [x] Real 3000-tick runs, 3 seeds, with vs. without immigration: fired 4-6
      times per run every seed; final population rose on 2/3 seeds (42:
      19->35, 7: 21->28), and on the third (20260903, this session's
      historically low-growth seed) ended at the same total (28) but with
      real compositional diversity immigration added (Geodude/Charmander/
      Scyther/Spearow/Mankey present with it on, none of those with it
      off) — worth knowing the effect isn't purely "always raises
      population," see DESIGN.md for the honest breakdown.
- [x] An 8000-tick run confirmed real in-sim survival *and breeding* of a
      newly-immigrated species (Mankey: 3 immigrants at tick 2459 -> 6
      living by tick 8000), not just spawn-and-survive.
- [ ] **Open follow-up: the population cap's scaled-down middle zone
      (70-110 living agents) is unit-tested in isolation but not yet
      exercised by a real run that actually reaches it** — every real run
      in this pass stayed at or under ~69 living agents, so the linear
      falloff between `POP_SOFT_CAP`/`POP_HARD_CAP` has never been observed
      firing in a real multi-thousand-tick run, only confirmed correct via
      `immigration.test.ts`'s direct unit tests. A longer run (10,000+
      ticks) or a seed/config that grows faster would be the way to
      actually witness it end to end.
- [ ] **Open follow-up: immigration's population cap only bounds
      immigration's own contribution — breeding itself is still completely
      uncapped**, the same pre-existing gap noted elsewhere in this file. A
      seed with strong enough organic growth could still exceed
      `POP_HARD_CAP` through breeding alone, with immigration simply
      declining to add to it. Not attempted here — a real population cap
      that reasons about the *whole* population (not just one growth
      channel) is a bigger, separate design question.
- [ ] **Open follow-up, flagged rather than guessed at: is Growlithe (and
      any future item-only-evolution species) actually a good roster fit
      given it can never evolve in-sim** at all under the current
      level-only evolution filter (`leveling.ts`)? Onix already lives with
      this same limitation without apparent issue, so it was judged
      acceptable to extend it to a second species rather than a blocker —
      but it's a real, deliberate trade-off, not an oversight, and worth a
      second look if evolution coverage across the roster ever becomes a
      priority.
- [ ] Biome-driven placement was deliberately scoped to *new* placements
      only (Charmander, immigrants) — every existing hand-placed starting
      agent (Bulbasaur herd, Venusaur guardians, Scyther, Diglett/Sandshrew
      colony, Onix, Pidgey flock, Spearow, Squirtle pair) keeps its original
      fixed coordinates, unretouched, to avoid destabilizing already-
      validated placements. If a future pass wants the *whole* starting
      roster biome-driven, that's a real, separate, riskier change — not
      done here.

## Biome generation: runtime moisture, biome drift, BSP badlands chambers, CA underground caves — built, see DESIGN.md

- [x] Water formation/drying (`weather.ts`'s `advanceWaterCycle`) now scales
      by each tile's real, drift-aware water density
      (`worldgen.ts`'s`effectiveWaterDensityAt`) instead of one flat global
      rate — the moisture field `generateWorld` blends at map-gen time is
      finally read again at runtime. Slow biome drift (see "Next up: terrain
      lifecycle" above) shares this same mechanism.
- [x] Badlands regions now get real BSP-carved chambers/canyons (mostly
      boulder boundaries, sparse wall chokepoints), masked to stay inside
      Badlands' own dominant footprint so it never fights
      `blendBiomeParams`'s continuous cross-biome blending at the edges.
- [x] Underground — previously an unconditionally flat, fully-walkable grid
      — now gets real cellular-automata cave structure (organic, not BSP's
      angular chambers, since it has no biome geometry to draw a chamber
      grid against). Surfaced and fixed a real stranding bug this
      introduced: `createDemoWorld`'s hand-placed Underground spawns used a
      bare `scaledPos` with no walkability check, safe only under the old
      always-flat assumption — now routed through a new `undergroundAnchor`
      (same `findWalkableNear` primitive the Surface layer's anchor already
      uses).
- [ ] **Open follow-up, not attempted here**: confirming a biome seed
      actually reaches a *visually* desertified state under the new drift
      mechanism needs a run one to two orders of magnitude longer than this
      project's standard 3000-tick validation length — a 30,000-tick run
      with live agents didn't finish inside this session's time budget. A
      terrain-only run without agents (the same trick the "Stronger
      weather-driven flora/water dynamics" section's own 10,000-tick
      validation used) is the likely way to actually witness a full 0->1
      shift end to end.
- [ ] **Open follow-up, flagged rather than guessed at**: this pass's BSP
      chambers only ever paint inside Badlands' *dominant* footprint by
      design — a Badlands region that's small relative to the map (or one
      whose seeds happen to land such that the global BSP split rarely
      crosses it) can end up with very few or zero chamber boundary tiles
      (seed 1 in this pass's own real-run check: 2 boulder tiles, 0 walls).
      Not a bug (the masking is doing exactly what it's supposed to), but a
      real seed-dependent variability worth knowing about — a future pass
      wanting *guaranteed* chamber density per Badlands region regardless of
      its size/shape would need to scope BSP to each region's own bounding
      box rather than the whole map, a bigger change than this one attempted.
- [ ] **Open follow-up: this pass's whole-starting-roster-biome-driven
      question (flagged just above) is still open** — Underground now having
      real terrain structure of its own (rather than "no obstacles, so
      nothing to check") is a real argument *for* eventually routing every
      hand-placed spawn (not just Underground's, which needed it for
      correctness here) through a biome/terrain-aware placement primitive,
      but that's still the same "real, separate, riskier change" flagged
      above, not done in this pass either.

## Next up: terrain lifecycle + construction + overworld (one combined design, not started)

Direct feedback: not enough dynamism in the environment — weather changes
things but the map itself never does. Three systems, decided to build as
one combined design rather than separately, in this dependency order once
work resumes:

1. **Terrain lifecycle** — trees grow from saplings and age, storms can
   fell them (real map consequence for weather, not just FOV/accuracy/
   migration-triggering), reusing flora.ts's existing stock/growth/seed-
   spread architecture rather than inventing new machinery. This is the
   foundation the other two build on.
   ~~Also: a slow weather-driven biome drift...~~ — **built**, see
   DESIGN.md's "Biome-specific generation" section: each biome seed's own
   effective water density now drifts toward Badlands-arid under sustained
   *local* drought and back under sustained rain (`World.biomeSeedDrift`,
   weather.ts's `advanceBiomeDrift`), a plain deterministic accumulator
   scoped to ~30,000 ticks for a full 0->1 shift under continuous exposure.
   A real 3000-tick run showed real, small, per-seed-differentiated drift
   (8/11 seeds nonzero, max 0.009 of the range) — confirming a seed
   actually reaching a *visually* desertified state needs a run one to two
   orders of magnitude longer than this project's standard validation
   length, not attempted here (a 30,000-tick run with live agents didn't
   finish inside this session's time budget). The tree growth/decay half of
   this item is still not started.
2. ~~**Construction/shelter-building**~~ — **built**, decoupled from this
   combined design after all (see DESIGN.md's "Shelter-building" section):
   it turned out to need only a new terrain kind + a construction behavior,
   not (1)'s tree growth/decay machinery first. Species-tied (`diglett`/
   `sandshrew` only), real travel + build-time investment, real concealment
   + storm-exposure payoffs (both literally reusing bush's/`hasCoverNearby`'s
   existing mechanisms), decay-if-abandoned. A real seed-42 run surfaced a
   genuine tuning gap worth tracking as its own follow-up rather than
   closing here: even after correcting the priority tier to be pausable
   (not dispersal's "commits no matter what"), the feature was still a net
   survival cost for this seed's Diglett/Sandshrew founders — see DESIGN.md's
   "Built" subsection for the full comparison. Candidate next step:
   resource/safety-aware build-site scoring instead of a plain distance
   floor, or investigating the pre-existing Spearow-camps-the-crossing-point
   hazard the finding also surfaced. The fancier growth/decay/storm-
   interaction layer terrain lifecycle (1) would add can still attach to
   the shipped `"shelter"` terrain kind later, unblocked by any of this.
   ~~**Follow-up: resting-at-home buffs + food cache**~~ — **built** (direct
   ask: "shelter should also...incentivize the Pokémon to stay in it...food
   cache"), see DESIGN.md's "Shelter incentives" section for the full
   design/real-run numbers. Doesn't resolve the net-survival-cost finding
   above by itself (a shelter that's never successfully built, as seed 42's
   own founders keep proving, has nothing for a resting/cache buff to
   attach to) — it's a real, separate incentive layer on top of an already-
   built shelter, not a fix for the build-site-scoring gap. Real follow-ups
   still open, not done here:
   - **Extend `buildsShelter` to more species now that shelter does more.**
     Explicitly flagged rather than done unilaterally — a separate, bigger
     roster decision the direct ask didn't cover. Worth revisiting once the
     roster grows past Diglett/Sandshrew: any other genuinely
     burrowing/nesting-flavored species (candidates judged the same way
     `species.ts`'s own top-of-roster comment already judges the current
     roster) would get real, earned value from resting/cache now, not just
     the passive concealment/storm-cover payoff shelter-building shipped
     with originally.
   - **Cache-aware herd food delivery** — `support.ts`'s `applyHerdSupport`
     currently only ever looks for a live food tile
     (`findNearestFoodTile`/`findNearestIndexed(..., "food")`); it has no
     awareness that a `buildsShelter` herd-mate's home shelter might have a
     stocked cache closer than any live patch. Left alone here since it's a
     second system's own targeting logic, not this feature's — a real
     candidate for a future pass rather than a scope-creep addition to this
     one.
   - **Tune `SHELTER_CACHE_MAX`/`SHELTER_CACHE_DEPOSIT_PER_TICK` against a
     seed where a shelter actually survives long enough to matter** — all
     three standard seeds (42/7/20260903) produced zero `shelterBuilt`
     events at 3000 ticks (DESIGN.md's real-run numbers), so this pass's
     real validation had to fall back to a controlled larger-map scenario
     (same fix `shelter.test.ts`'s own end-to-end test already needed for
     the identical problem) — the standard seeds still owe a real look at
     cache accumulation/drawdown once the underlying build-site-scoring gap
     above is addressed.
   - **Some shelters still get abandoned even with the resting pull
     active** (3-5 of 4-10 built per 3000-tick run in the controlled
     validation above — a real reduction versus the mechanism's own
     always-abandons-if-unattended baseline, not a full elimination). Not
     isolated further here: candidate causes worth checking are a
     founder's death leaving nobody to return to a specific shelter, or a
     herd relocating away (`herdMigration.ts`) and never coming back to an
     older one while a newer one gets built closer to the new range.
3. **Overworld: the current map becomes one region in a larger graph** —
   the "World scale: layers, elevation, and regions" section from early in
   this project, finally built. Decided: full simulation for the focused/
   observed region (every agent, every tick, exactly like today), every
   other region abstracted (aggregate per-species population/need/resource
   trends advanced by cheap statistical rules, occasional emitted events,
   no individual agents) — matches the existing "promotion boundary"
   concept one level up. Promotion (focus arrives) invents plausible
   individuals from the aggregate; demotion (focus leaves) collapses
   individuals back to aggregate stats — explicitly lossy, say so plainly
   rather than pretending otherwise. Migration edges between regions are
   the natural next home for the just-built individual dispersal mechanic
   (a disperser could eventually target another region, not just a new
   herd within the same map) — stretch goal, not required for a first cut.
   Start with a small region count (3-4), not a large graph.

Not started — the user has something else to try first. Note: item (1)'s
tree-growth/decay half is still not started, but its water-supply half is
now partially covered by a separate, already-shipped piece — see "Stronger
weather-driven flora/water dynamics" below — so (1) on resume should scope
itself to tree lifecycle + biome drift only, not re-do water.

## Stronger weather-driven flora/water dynamics — built, see DESIGN.md

Direct feedback: "i kinda want weather events to be alittle stronger about
killing off flora and reducing water/iincreasing it. it'd make it mroe
dynamic." Widened flora's existing rain/drought decay-rate divisors
(weather.ts) and, the bigger piece, gave water real terrain mutation for
the first time: a "water" tile inside a drought cell can dry to "mud", and
a "floor"/"mud"/"sand" tile adjacent to existing water inside a rain cell
can become water — both a flat per-tile-per-tick roll, same idiom as
flora.ts's own spread, both threaded through an explicit `rng` param (no
new bare `Math.random()`), new `terrainChanged` `SimEvent`. See DESIGN.md's
"Stronger weather-driven flora/water dynamics" section for the full
before/after real-run numbers (seed 20260903, 3000 ticks: water 472 -> 476
net over the run, -6 during one 272-tick drought window, +5 to +6 during
several rain windows — real, non-degenerate movement in both directions).

Open follow-up questions flagged, not implemented:

- **Should drought/rain severity scale with how long the cell has already
  been active?** Right now every drought/rain cell affects tiles at the
  same flat per-tick chance for its whole life from tick 1 to its last
  tick — a cell that's been sitting on the map for 400 ticks is no more
  intense than one that just spawned. A duration-scaled ramp (a long
  drought getting *worse* the longer it persists, not just "still going")
  might read as more dramatic, but wasn't attempted here — it would also
  make the already-tricky rain-vs-drought equilibrium tuning (below)
  harder to reason about, not easier, so it was deliberately left for a
  separate pass.
- **No stable long-run water-supply equilibrium yet.** A real 10,000-tick
  run at one seed drifted water supply up (+17%) under a naive symmetric
  rain/form-vs-drought/dry rate pairing; the asymmetric fix (rain forms
  water much more slowly per-roll than drought dries it, to counteract
  forming's own structural "each new water tile seeds its own neighbors"
  growth advantage) fixed that specific run but a different 10,000-tick
  seed still drifted the other way instead (-25%, drought-heavy). The
  system reliably moves in the direction its dominant weather type pushes,
  it just doesn't yet converge back toward a stable baseline regardless of
  which weather types a given seed happens to roll more of over very long
  runs. Worth deciding whether that's acceptable (a map's water supply
  genuinely drying up or flooding over a very long run is arguably a
  feature, not a bug, for an ecosystem sim) or needs an explicit
  equilibrium-restoring term (e.g. a slow background reversion rate, or
  capping cumulative drift as a fraction of the map's original water
  count) before trusting it over the timescales (1) above's biome-drift
  idea already assumes (tens of thousands of ticks).
- **Water formation doesn't yet use worldgen.ts's moisture field** — new
  water only ever forms adjacent to existing water, never in a "naturally
  low/wet spot" the way `generateWorld`'s own moisture-field-driven
  placement does at world-creation time. Reusing that at runtime (bias
  formation chance by local moisture, not just raw adjacency) is a natural
  next step if adjacency-only spread turns out to feel too uniform in a
  real playtest.

## Priority: sim depth + observability (current focus)

Per DESIGN.md's north star — the sim needs to be able to run headless and
produce a real story before player mechanics are worth building further.

- [x] Headless sim runner (`packages/runner`, `pnpm run run [ticks]`) that
      ticks the world N times and prints the event log — no renderer, no
      player.
- [x] Event log with semantic content (`packages/engine/src/events.ts`):
      `crossedLayer`, `consumed`, `behaviorChanged`. Still missing the
      bigger ones — births, deaths, herd relocations, predation — since
      those behaviors don't exist yet either (see Ecosystem sim below).
- [x] Ran it (300 ticks, see DESIGN.md) — it did surface a real, specific
      finding (Diglett stops going home after ~tick 70), which counts as
      passing the "worth telling" bar even though it's a tuning gap, not a
      dramatic story yet.
- [x] Predation built and run — see "Ecosystem sim" below. First run with
      it produced an actual dramatic story: a Scyther killed 3 of 4
      Bulbasaur in the herd over 300 ticks.
- [x] ASCII/color snapshot renderer, Brogue-style (`packages/runner/src/ascii.ts`,
      `dump-frames.ts`) — glyph = species initial colored by primary type,
      background = terrain shaded by elevation. Wired into the CLI
      (`pnpm run run <ticks> "<tick,tick,...>"`) and into a JSON dump path
      for building real-data artifacts. A real 2000-tick capture (kills at
      58/114, Venusaur guardian killing the Scyther at 167, then Venusaur
      going 2 -> 213 with zero starvation by tick 2000) is a sharper,
      faster demonstration of the population-control gap below than the
      run already written up in DESIGN.md's Starvation section — worth
      remembering that these are noisy single samples, not fixed numbers.
- [ ] Tuning gap found by the first run: an agent whose needs oscillate
      between just-under and just-over the 0.7 satisfied line (flat +0.4
      consume vs. 0.3 idle threshold) can permanently stop returning to
      `homeLayer` because it never registers `idle`. Decide if that's
      acceptable emergent behavior or needs a hysteresis/threshold fix.
- [ ] Tuning gap found by the predation run: fleeing agents flicker between
      `flee` and normal foraging almost every tick in some stretches (the
      4-tile flee-detection radius may be too wide relative to how far one
      flee-step moves an agent out of range). Worth a hysteresis or a
      "stay fled for N ticks after losing the threat" rule.
- [ ] **Real bottleneck found after adding reproduction + flora (see
      DESIGN.md): the predator never leaves.** Herd extinction (0 births,
      dead by tick 217) survived both a flee-radius theory and a food-
      scarcity theory — confirmed cause is `flee` unconditionally
      preempting `seekMate` every tick, forever, because Scyther has no
      migration/territory/satiation behavior pushing it to leave the
      herd's range after a kill. This is the next thing to build, and
      it's predator-side, not prey-side: something like a satiation-driven
      wander/range mechanic so a fed predator moves on and prey get a
      window. Try this before touching flee-radius or mate-priority
      numbers again — two tuning guesses have already been wrong.
- [x] Predator-side fix built: mob-fighting, risk-aware hunting, and
      relocate-after-repeated-failure (see DESIGN.md). Unit-tests confirm
      the mechanism works (a synchronized mob of 3 can defeat a predator).
      Real 1000-tick run still ended in full extinction, but for a new and
      more specific reason — see next item. Progress, not a fix yet.
- [x] **Coordination gap fixed**: `mobSize` now counts allies within
      striking distance of the *threat*, not the agent's own muster
      radius — regression-tested against the exact tick-97 scenario. No
      more solo-mob suicides.
- [ ] **New finding after the fix, and after the full combat overhaul
      (see DESIGN.md)**: in a fresh 1000-tick run, the herd never mobbed
      at all — zero fight events, not even one. The fix stopped the bad
      behavior (dying alone for nothing) but the good behavior (3+ actually
      converging) still never happened naturally in this run. Worth
      investigating whether that's a map/spacing issue (the herd doesn't
      stay clustered enough) or a genuine rarity of the trigger window —
      don't assume which without checking.
- [ ] Also flagged plainly in DESIGN.md: Scyther (level 8) vs. Bulbasaur
      (level 5) is lopsided enough under the real damage formula that
      fights resolve in 1-2 hits — mainline-accurate, but it means
      cooldowns/tactics rarely get to matter. If longer exchanges are
      wanted, the lever is the level/stat gap, not the formula.
- [x] Move range wired in (`moveRange` in combat.ts) and guardians built
      (Venusaur, see DESIGN.md). Real run: the mob-never-assembles finding
      above still holds (still zero mob-fights), and a new one on top —
      the one guardian intervention that *did* trigger failed for a
      concrete geographic reason, not a logic bug (see below).
- [x] **Guardian positioning gap fixed by herd cohesion** (see DESIGN.md) —
      cohesion keeps guardians close enough to the herd's live position
      that one actually engaged and *defeated* Scyther in a real run
      (first predator defeat this session, tick 170). Real fix, confirmed
      by rerunning, not assumed.
- [ ] **Now confirmed at bigger scale: unconstrained reproduction blows up
      the whole herd, not just a predator-free species.** Killing the
      sole predator (HuntRules has exactly one entry) removed 100% of
      population control from this ecosystem — Bulbasaur went 4→40,
      Venusaur 2→36, zero deaths for the remaining 830 ticks. This is the
      same missing piece as the earlier Venusaur-only finding, now
      unavoidable: **this is the next thing to build**, not an edge case.
      Needs a deliberate mechanism (carrying capacity tied to food
      availability? territory/space limits? age-based mortality? multiple
      predator species so no single kill zeroes out all pressure?) —
      pick one and test it, don't bolt on an arbitrary population cap.
      Inbreeding itself is now fixed (see the relatedness-check item
      below) — the carrying-capacity/population-cap mechanism is still
      the open half.
- [x] Starvation death + migrate-on-failure built (see DESIGN.md) — real
      partial fix: 564 Venusaur starved in a 2000-tick run, but 917 births
      still outpaced that, so population still grows net-positive (boom
      with heavy mortality, not equilibrium). Population control is still
      the open question above, just less extreme now.
- [ ] **Migration doesn't actually help the crowding case it needs to.**
      Traced directly: `ticksWithoutResource` only counts up when no food
      exists *anywhere reachable* — but `findNearestTerrain` succeeding
      resets it regardless of distance, so an agent that can see food
      across the map but can't reach it before starving never triggers
      migration; it just starves mid-journey. This is the actual shape of
      the Venusaur die-off (overcrowding/distance, not true absence). Fix
      target: factor in whether the nearest resource is reachable before
      the agent's remaining hunger/thirst buffer runs out, not just
      whether one exists at all.
- [x] Spawn-on-mother stacking bug — fixed (`nearbySpawnTile` in
      `reproduction.ts`) and map variety upgrade (20×14 single-resource
      map -> 24×16 with 3 food patches, 2 water sources, wall obstacles,
      a hill) — see DESIGN.md's "single-tile stacking bug" section. Real
      result: peak stack dropped 168 -> 113 of a similar population, i.e.
      genuinely better but not close to solved.
- [x] **Half fixed: idle-wander after a need is satisfied.** Traced after
      the spawn-position and map fixes above only partially helped: once an
      agent finished eating/drinking it had no reason to leave that tile —
      no idle-wander behavior existed — so a resource tile that works
      became a permanent gathering point instead of a stop. Built as part
      of the exp-motivated exploration feature (`needs.ts`'s
      `applyExploration`, see DESIGN.md): a fully-satisfied idle agent now
      wanders toward nearby unexplored territory instead of standing still
      forever, driven by the same new-sector exp trickle. **Still open**:
      no personal-space/repulsion behavior — herd cohesion (`herding.ts`)
      only ever pulls an idle agent *toward* the herd centroid when it's
      far away, nothing pushes herd-mates apart when they're already stacked
      close together. Fix target: a mild repulsion force in
      `applyHerdCohesion` when two herd-mates are on the same or adjacent
      tile.
- [x] Flora retuned per "food is too long-lived, seedlings should start
      more often": `CONSUME_STOCK_AMOUNT` 0.2->0.5, `SEED_DROP_CHANCE`/
      `GERMINATION_CHANCE` 0.02/0.3 -> 0.06/0.5. Real result: worked
      exactly as specified (floraChanged 30->73, patches actually empty
      now) but backfired on population control — 635 alive at tick 2000
      vs. 247 before, because sprouted patches accumulate (they never
      revert to floor) so total food-carrying capacity went *up*. See
      DESIGN.md's Flora section.
- [x] Flora rebuilt: food now has a real lifespan (`FOOD_LIFESPAN_TICKS =
      50`, decays every tick regardless of eating) and actually dies
      (reverts to floor) instead of sitting at low stock forever, plus a
      chance to spread to an adjacent tile before it does. Superseded the
      old "no cap on total food patches" item above — patches genuinely
      disappear now. See DESIGN.md's Flora section for the two real
      failure modes this went through (total colony collapse from a
      famine-window mismatch, then rebalancing) before landing here.
- [x] **Found and fixed a real mechanical dead end, not just an
      overshoot**: decorative "flora" tiles never died (only edible "food"
      did), and since a seedling only ever plants on bare floor, flora was
      a one-way ratchet permanently converting the map's seedable ground
      away. Confirmed in a real run: 0 food tiles *permanently* by tick
      800, 248/384 tiles converted to dead-end flora, population starving
      at the water hole with no possible path back to food ever again.
      Fixed by giving flora a lifespan too (`FLORA_LIFESPAN_TICKS = 150`).
      See DESIGN.md's flora section for the full trace.
- [ ] **Population is still net-negative on average — real boom-bust, now
      that the structural dead-end above is fixed.** Three fresh 2000-tick
      runs post-fix: activity roughly tripled (60-134 births vs. 13-34
      before, 1800-3275 `consumed` events vs. 632-974) and tile composition
      genuinely cycles now instead of ratcheting, but every run still ends
      in eventual extinction rather than settling. Candidate levers, not
      yet tried: raise `FOOD_LIFESPAN_TICKS`/lower `CONSUME_STOCK_AMOUNT`
      further now that the ratchet's gone and there's more room to tune;
      cap population growth directly (a carrying-capacity check in
      `reproduction.ts`, e.g. mate-seeking pauses above some local
      density); or accept boom-bust as the intended dynamic and build the
      "sim tells you the story of a die-off" angle on purpose instead of
      continuing to chase equilibrium.
- [ ] **Movement/speed is still uniform and unbuilt as a real mechanic.**
      Confirmed by grep: `calculateStats`'s `speed` field is computed but
      never read anywhere — every agent moves exactly 1 tile/tick,
      unconditionally. Per chat: speed should govern turn order/action
      frequency (faster acts more/first, mainline-style), while move
      cooldowns stay a separate, per-move stat — and cooldowns are meant
      to eventually be spec'able/customizable per the original move-
      leveling pitch (Ember: point -> ring, etc.), not tied to Speed at
      all. This is a real architecture change (agents currently get
      exactly one action per tick, full stop) — deliberately not rushed
      in alongside other work; needs its own pass.
- [x] **Guardian positioning gap fixed**: traced to `applyHerdCohesion`
      using the *whole* herd's centroid (guardians included) as a
      guardian's own pull-back target — when a guardian wandered off (e.g.
      to drink), its own displaced position diluted that average enough
      that the "am I too far?" check often still read "close enough," so
      it never corrected back toward the herd it's meant to protect.
      Fixed with a guardian-specific tighter leash (3 tiles vs. 5) plus a
      `protectedHerdCentroid` that averages only the herd's actual prey
      members, excluding guardians (`packages/engine/src/herding.ts`).
      Confirmed with a constructed regression case: the old whole-herd
      check does *not* move a guardian sitting exactly at the old
      boundary while its herd's real prey is 10 tiles away; the new
      rules-aware check does. See `herding.test.ts`.
- [x] **Unconstrained reproduction finding — inbreeding half fixed.** Two
      Venusaur (nothing preys on them) went from 2 to 52 individuals over
      1000 ticks, and `venusaur-0` (the founding male) fathered most of
      that growth including with his own daughters/granddaughters. Fixed
      the inbreeding half: `Agent.parentIds`/`grandparentIds` are set at
      birth (`reproduction.ts`'s `spawnOffspring`), and `isEligibleMate`
      now calls `isRelated` to block direct parent/offspring, full/half
      siblings, and grandparent/grandchild pairs — see `isRelated`'s doc
      comment and the "inbreeding avoidance" tests in
      `reproduction.test.ts` (17 tests total, all passing). Founders
      (scenario-spawned, no `parentIds`) are correctly treated as
      unrelated strangers, so founding-stock breeding is unaffected. A
      3000-tick real run with the check active still produced 17 births
      (23 starved, population stayed small) — confirms this isn't a
      reproductive-shutdown regression. The population-*cap* half (no
      predator = unbounded growth) is still open — carrying capacity tied
      to food availability, territory limits, or age-based mortality is
      still the undecided mechanism.
- [x] **Age-based mortality built** (`ageMortalityChance` in `needs.ts`) —
      a gentle per-tick hazard, 0 below `OLD_AGE_ONSET` (1500 ticks), then
      ramping linearly to a 2% per-tick chance by `OLD_AGE_HAZARD_CAP_AGE`
      (3000 ticks), deliberately not a hard cutoff age (see DESIGN.md for
      why). Records a `diedOfAge` event. Real evidence: a 5000-tick run
      produced 1 old-age death (age 1858); a 10000-tick run produced 10,
      all in the 1500-2000 age band near onset as the ramp predicts. This
      is a real but currently *minor* cause of death — most agents die of
      starvation or predation long before old age becomes likely at this
      population's typical lifespan — so it does NOT yet solve the
      predator-free-species-grows-unbounded problem above; a predator-free
      population would need a faster-acting cap (carrying capacity tied to
      food, territory limits) to actually plateau. Worth revisiting
      whether `OLD_AGE_ONSET`/`OLD_AGE_MAX_CHANCE` should be tuned more
      aggressive once that's decided, rather than guessing now.
- [ ] **Confirmed this isn't Venusaur-specific**: with the action economy
      (see "Combat / moves" below) making the guardian mechanism reliably
      defeat the Scyther predator around tick 110 in real runs, Bulbasaur
      itself now also reproduces unchecked once the threat is gone — 3
      re-runs of the 1000-tick demo produced 71, 48, and 13 Bulbasaur
      births respectively (vs. 2 in the first run written up in
      DESIGN.md). Same root cause as the Venusaur case above (no carrying
      capacity, nothing ties reproduction to predation pressure) — the
      Speed work didn't cause this, but it did make the previously-rare
      "predator dies early" case common enough to matter.
- [x] **`packages/web` evolved from bare canvas dots into a real live
      observer** — see DESIGN.md's "A real live browser observer" section.
      Play/Pause/Step/Speed controls over a real `tickWorld` loop, a seed
      input (`Load`/`Random`/`Copy`, URL-synced via `?seed=`), an
      ascii.ts-palette-matched terrain/agent grid (weather cells and
      day/night tinting included, deliberately basic), a real capped/
      virtualized event log panel with distinct treatment for
      `born`/`killed`/`defeated`/`fainted`/`evolved`/`diedOfAge`, and
      click-to-inspect with a per-agent filtered event history. Also fixed
      the `fought`/`missed` event data gap (added `moveId`/`pos`, matching
      every other combat-adjacent event) as part of the same session.
      `dump-replay.ts`'s precomputed-artifact path is untouched and still
      exists for a no-dev-server snapshot; it's just no longer the primary
      way to watch a run.
- [ ] **`packages/web` has no automated UI tests** — validated instead by a
      clean `pnpm -r build`/`typecheck`/`test` and a real (but
      click-through-free) dev server run; see DESIGN.md for exactly why
      (no browser-automation tooling available in this environment, and
      installing one didn't complete in a reasonable window). A real
      browser-driven check (Playwright or similar) of seed-load/play-pause-
      step/click-to-inspect is still open if this app grows enough to
      justify the infra.
- [ ] **Day/night and weather visualization in `packages/web` are
      deliberately basic first passes** — one flat darkness overlay (no
      directional lighting/gradient) and translucent circles for weather
      cells (no per-tile shading). Fine for "is something happening
      visually," not a polished lighting model.
- [ ] **`packages/web`'s renderer still only draws the surface layer** —
      unchanged from the original bare renderer; an agent that crosses to
      underground/canopy for a need still just vanishes/reappears rather
      than being shown on another view. A real per-layer view (tabs? a
      picture-in-picture minimap?) is future work if the underground/canopy
      populations become interesting enough to want to watch directly.

## World layers, elevation, and regions (see DESIGN.md)
- [x] `Tile`/`World` have a `layer` dimension (Underground/Surface/Canopy,
      shared x,y footprint) — agents native to one layer, movement mostly
      stays within it.
- [x] Cross-layer behavior is common: species whose resources (food/water)
      live on a different layer than their home layer routinely cross
      (Diglett surfacing, Pidgey landing) as part of normal need-seeking —
      see `findLayerWithTerrain`/`tickAgent` in `packages/engine/src/needs.ts`.
- [x] Elevation: continuous heightmap on Surface tiles, elevation-aware FOV
      (`fov.ts`) and elevation-delta combat modifiers (`elevation.ts`, not
      yet consumed by any combat resolver since one doesn't exist yet).
      Open: whether Underground/Canopy get their own elevation too.
- [ ] World graph of 3–5 regions connected by migration edges, each
      independently bounded.
- [ ] Region-level promotion/demotion: observed region runs full per-agent
      sim across all layers; unobserved region runs abstracted (aggregate
      counts/needs/resources per species, occasional emitted events).
      Symmetric with the existing agent-level promotion boundary concept.
- [ ] Open: how aggregate-region state reconciles back into individual
      agents on promotion — invented plausible agents, or something lossy
      that's fine for background regions but worth being honest about.

## Ecosystem sim
- [x] Herd cohesion built (`packages/engine/src/herding.ts`) — idle agents
      drift toward their herd's live centroid instead of standing still.
      Confirmed working and consequential in a real run — see DESIGN.md.
      Still just a simple "drift toward the average" — no real flocking
      (separation/alignment), no fixed home-range distinct from wherever
      the herd currently is.
- [x] `seekMate`/reproduction built (`packages/engine/src/reproduction.ts`)
      — mature, opposite-sex, same-species/layer/herd agents pair up and
      produce offspring on contact. See DESIGN.md for why it produced zero
      births in the current demo world (predator-pressure bottleneck, not
      a reproduction-system bug).
- [x] `hunt`/`flee` are built (`packages/engine/src/predation.ts`,
      `HuntRules`, `SpeciesDef.preysOn` in `packages/data`) — a nearby
      predator triggers flee (overrides everything), a hungry predator with
      prey in range hunts and kills on contact. Currently just Scyther ->
      Bulbasaur.
- [x] **Predation is now dynamic/size-based, not a fixed species list**,
      requested directly ("it should match by a combo of level and size...
      spearow probably goes for bulbasaurs too"). `HuntRules` is now just
      "does this species hunt at all"; `isPreyOf` computes real eligibility
      per encounter from `powerOf` (a `maxHp` reading, which already bakes
      in level + species bulk). `SpeciesDef.preysOn: string[]` renamed to
      `isPredator: boolean` accordingly. Confirmed in a real run: `spearow
      killed diglett`, `scyther killed sandshrew`, and `scyther killed
      bulbasaur` — the exact scenario asked for, none of them a hardcoded
      pairing. See DESIGN.md for the fleeing-vs-hunting distinction this
      surfaced (fleeing/mobbing stayed species-flag-only, not power-gated
      — a wounded predator is still worth fleeing).
- [x] **Species roster expanded to all three layers, not just surface** —
      Spearow now hunts a 2-Pidgey flock in the canopy, Onix hunts a
      4-agent Diglett/Sandshrew colony underground. Real mainline egg
      groups verified against Bulbapedia (Spearow/Pidgey both Flying,
      Diglett/Sandshrew both Field, Onix separately Mineral). See
      DESIGN.md's "Species expansion" section for the full writeup,
      including a real evolution-filter bug caught and fixed while
      researching Onix (PokeRogue's dex stamps a fake `level: 1` on trade
      evolutions too), and a new honest finding: nobody reaches an
      evolution-relevant level in a 10000-tick run (max observed: 8) — the
      "evolution escapes predation" design this expansion leans on is real
      and unit-tested but doesn't show up in practice yet. That's a
      pre-existing exp-pacing gap (confirmed on the Bulbasaur line too),
      not something this pass introduced — see the Leveling section below
      for where to pick that up.
- [x] **First Water-type added: Squirtle** — closes the "zero type-chart
      representation beyond 6 types" gap found while brainstorming HM-
      style moves (Surf/Whirlpool/Waterfall were all inert without one).
      Real Monster+Water1 egg groups (Bulbapedia-verified) make it a real
      cross-species breeding partner for the existing Bulbasaur/Venusaur
      line, confirmed live in a run (`squirtle-1 x bulbasaur-2`). Spearow
      opportunistically killed one with zero new predation code — the
      dynamic size-based system just worked. Evolved to Wartortle at
      level 16 in the same run. See DESIGN.md. Electric/Psychic/Ghost-or-
      Dark candidates confirmed next — see MOVES_DESIGN.md's round four.
- [x] Mob-fighting, predator risk-assessment, and relocate built on top of
      the above — see DESIGN.md's "Mob-fighting" section and the
      coordination-gap item above for the real (not yet fully successful)
      result.
- [x] Resource depletion + regrowth + seed-spread built
      (`packages/engine/src/flora.ts`) — food tiles have a depletable/
      regrowing `stock`, agents occasionally seed new patches as they move,
      a slow seasonal cycle modulates regrowth rate. Confirmed working
      (seeds sprout on schedule) but didn't fix the extinction problem —
      see the bottleneck note above. Water is still infinite/undepletable
      (a lake doesn't run dry at this scale) — food/berries only, per the
      original ask.
- [ ] Egg stage instead of instant offspring, with parental guarding
      behavior — confirmed canon-real and mechanically rich (Seaking pairs
      guard eggs for a month+, "defends with its life," per research done
      this session). A guarded, vulnerable incubation period is better
      story material than an instant birth. Deliberately deferred rather
      than built alongside plain reproduction, to keep that slice small.
- [x] Performance ceiling for the cheap tier, partially addressed — the
      naive `findNearestTerrain` scan (was O(width*height) per agent) hit a
      real wall once the map grew to 90x60 for the biome-generation feature
      (see DESIGN.md's "Environmental generation..." section): fixed with
      `packages/engine/src/resourceIndex.ts`, a cached water/food/sunbeam
      coordinate index invalidated via `World.resourceVersion`. Confirmed by
      real timing: 1,000 ticks in ~1.5-1.8s, 10,000 in ~5-6s, no blow-up as
      population grows. `growFlora`'s own full-grid-per-tick scan is still
      untouched (not the bottleneck actually observed, and out of this
      feature's stated ask) — still open if a future feature makes it one.
- [ ] Bush ambush bonus deliberately deferred (see DESIGN.md's
      "Environmental generation..." section, "As built") — concealment
      already gives a lurking predator a real, measurable detection-range
      edge; a separate first-strike/accuracy bonus on top was judged scope
      creep for a bar the detection-range reduction already clears.
- [ ] Real tuning gap found by the biome-generation feature: at the new
      90x60 map scale, food is abundant enough that solo (non-herd)
      predators — Scyther, Onix, Spearow — can self-feed from the same
      generic "food" tiles herbivores eat and rarely drop below
      `HUNT_HUNGER_THRESHOLD`, so predation becomes rare and stochastic
      run-to-run (confirmed: an 1,000-tick run showed real combat, a
      separate 10,000-tick run showed none at all). Compounds with solo
      predators having no herd-cohesion wandering (`herding.ts`'s
      `applyHerdCohesion` only fires for `herdId`-having agents), so a
      predator that starts far from prey mostly just sits and grazes.
      Possible fixes, none built: predators shouldn't eat generic "food"
      tiles at all (species-specific diet), lower predator food density in
      generation, or give solo predators their own idle-wander behavior —
      each touches predation.ts/needs.ts/herding.ts territory beyond the
      biome-generation feature's scope.
- [x] Herd-level migration built (`packages/engine/src/herdMigration.ts` —
      see DESIGN.md's "Herd-level migration" section, "As built") — shared
      `World.herdMigrations`/`World.herdScarcityTicks` state, resource-aware
      destination scoring via `resourceIndex.ts`, and `herding.ts`'s
      `applyHerdCohesion` biasing the whole herd (and guardians) toward the
      shared target. 224 tests total (11 new), all builds/typechecks clean.
- [ ] Real tuning gap found by the herd-migration feature, same root cause
      as the predation one above: confirmed via a real-engine famine
      simulation that the full trigger -> destination -> event pipeline
      works correctly, but it essentially never fires in the actual demo
      scenario (zero events in both a 1,000- and 10,000-tick run) because
      the map's abundance keeps a mobile herd's local food/water recovering
      well before the 150-tick sustained-scarcity window elapses (confirmed
      up to 30,000 ticks via a debug instrument — max observed sustained
      scarcity was ~21-26 ticks for the surface/underground herds after
      their initial post-spawn settling period). Lowering the threshold
      enough to fire organically on this map mostly just measures "time to
      find the first meal after spawning," not real depletion — a worse
      signal, so left at the documented values rather than chased down.
      Same possible fixes as the predation gap apply here too (a real
      famine/drought mechanic, lower ambient food density, or per-herd
      eating pressure modeling) — not built, out of scope for this feature.
- [ ] Real limitation found by the same famine simulation: once a migration
      *is* triggered under genuine severe scarcity, the herd doesn't
      reliably arrive — `applyHerdCohesion`'s migration bias only applies
      to *idle* agents, but a real famine keeps most members hungry/thirsty
      most of the time, and `seekFood`/`seekWater` (needs.ts) searches the
      *entire map* for the nearest resource with no awareness of the herd's
      shared migration target, so individual survival-driven wandering can
      pull the herd away from the scored destination — observed directly: a
      test migration timed out (`gaveUp`) nowhere near its target. Possible
      fix, not built: bias `findNearestTerrain`'s candidate search toward
      the active migration target (e.g. prefer a resource within some bonus
      radius of the target over a slightly-nearer one elsewhere) — touches
      needs.ts territory beyond this feature's stated scope (extend
      `applyHerdCohesion`).
- [x] **Herd migration generalized to more trigger reasons — Phase 1 of
      DESIGN.md's "Dynamics that move a content herd" section, done.**
      `MigrationReason` (`"scarcity" | "predator_pressure" | "wanderlust" |
      "territorial"`) is now a real discriminated value on
      `World.herdMigrations`/`herdMigrating`'s event; predator-pressure is a
      running per-herd counter incremented at `predation.ts`'s hit-logging
      site (not a per-tick `EventLog` scan); wanderlust is a flat per-tick
      chance scaled by herd disposition, destination not resource-scored at
      all; territorial is a per-herd-pair sustained-proximity counter that
      displaces the smaller same-species herd. `pickDestination` gained an
      `awayFrom` scoring term for the two threat-driven reasons. See
      DESIGN.md's "Dynamics that move a content herd" section, "Phase 1 — as
      built" for the full design and real-run findings. 235 tests total (11
      new), all builds/typechecks clean.
- [x] **Day/night cycle — Phase 2 of DESIGN.md's "Dynamics that move a
      content herd" section, done.** A fast, independent 200-tick
      light-level cycle (`daynight.ts`, its own tiny module — separate from
      flora.ts's existing 1000-tick season); `activityPattern` (`"diurnal" |
      "nocturnal" | "crepuscular" | "cathemeral"`, default `"cathemeral"`) on
      `SpeciesDef`/`Agent`, assigned with real reasoning to all 9 curated
      species; a real but partial (20%) off-hours Speed penalty composing
      multiplicatively with the existing injury/terrain modifiers
      (`support.ts`); a nocturnal/diurnal hunt-eagerness shift
      (`predation.ts`) composing additively with the existing
      aggression-based shift; a flat night-time FOV radius reduction
      (`fov.ts`, defaulting to full daylight so every pre-existing caller/
      test is unaffected); and `nightfall`/`daybreak` events. See
      DESIGN.md's "Phase 2 — as built" for the full design and real-run
      findings — the honest gap: hunting never occurred in any real run at
      all (same pre-existing sparse-encounter issue Phase 1 already
      flagged), so the hunt-eagerness shift is unit-tested but unconfirmed
      in an actual run. 259 tests total (24 new), all builds/typechecks
      clean.
- [x] **Spatial, moving weather — Phase 3 of DESIGN.md's "Dynamics that move
      a content herd" section, done. All three phases of that section are
      now complete.** `weather.ts` (new module) maintains 1-3 active
      `World.weatherCells` (`rain | storm | drought | coldSnap`, each with a
      center/radius/lifespan/drift), spawning, drifting, and dissipating
      once per tick; spawn type is weighted by real biome data
      (`worldgen.ts`'s new `biomeWeightsAt`, reusing the environmental-
      generation feature's seed-blending math) per a documented affinity
      table (Wetland/Grassland skew rain, Badlands skew drought, Highland
      skews storm/coldSnap). Rain/drought divide `flora.ts`'s decay-rate
      term and multiply `needs.ts`'s thirst-decay rate, composing with the
      existing season multiplier; storm adds a real accuracy penalty
      (`combat.ts`'s `rollAccuracy` gained a general `extraMultiplier`
      parameter) and a real FOV penalty bigger than night's own
      (`fov.ts`'s `computeVisible` gained an additive `stormPenalty`
      parameter, deliberately kept independent of the existing `lightLevel`
      term rather than combined into it) plus a per-herd sustained-exposure
      counter feeding a new `"weather"` `MigrationReason` through Phase 1's
      generalized trigger system, destination-scored toward real
      forest-biome cover (`pickDestination`'s new `preferCover` term); cold
      snap adds a flat fourth composable Speed penalty
      (`support.ts`'s `coldSnapSpeedMultiplier`), deliberately skipping
      per-species cold-tolerance data per DESIGN.md's own explicit
      "still open, flat default is fine" note. New `weatherChanged` event.
      See DESIGN.md's "Phase 3 — as built" for the full design and real-run
      findings — the one genuinely good-news finding across all three
      phases: unlike predator-pressure/territorial (Phase 1), the new
      `"weather"` migration trigger actually fires regularly in the
      unmodified demo scenario (observed in roughly a third of trial runs),
      because it doesn't depend on a fight landing or a second same-species
      herd existing — just a storm cell (large, common) overlapping ground
      with no tree/bush cover (also common on this map). Drought's
      acceleration of the scarcity trigger is proven directly (flora decays
      measurably faster under it) but was never observed actually crossing
      the 150-tick scarcity threshold in ~25 trial runs — it got as close as
      one tick short — the same "map's too abundant for scarcity to fire
      often" gap Phase 1 already found, now confirmed to persist even with
      drought's real assist. 317 tests total (58 new), all builds/typechecks
      clean; one pre-existing test in `herdMigration.test.ts` was found to
      already be flaky (~7% failure rate) from using unseeded `Math.random`
      for a trigger unrelated to this feature — confirmed pre-existing, not
      introduced by this work, left as a follow-up below.
- [ ] Small, low-risk test-hygiene fix found while validating the Phase 3
      weather feature, unrelated to it: `herdMigration.test.ts`'s "triggers
      once scarcity has been sustained for the full window..." test calls
      `updateHerdMigrations` with the default unseeded `Math.random` instead
      of the file's own `NEVER_WANDER` helper (which every other
      non-wanderlust-focused test in that file already uses) — over its
      150-tick loop there's a real (~7%) chance a genuine wanderlust roll
      fires first and changes the migration's `reason` out from under the
      assertion. Reproduces on the pre-Phase-3 commit too, so it predates
      this feature; a one-line fix (pass `NEVER_WANDER`) whenever someone's
      next in that file.
- [ ] Real tuning gap found by the trigger-generalization feature, same
      root cause as the two gaps just above: `fought` events are at or near
      zero in every observed real run (the pre-existing "predators barely
      land hits" dynamic), so the predator-pressure trigger's 5-hits-in-
      300-ticks bar is essentially never approached in the actual demo
      scenario; and the demo world has exactly one herd per species, so the
      territorial trigger never has a rival to compare against. Both are
      confirmed correct via direct unit tests (synthetic hit events for
      predator-pressure, two constructed same-species herds for
      territorial) — this is a scenario-content gap, not an implementation
      bug. Wanderlust *did* fire in real runs (confirmed at the documented
      rate, isolated from population effects, by a 200,000-tick statistical
      test) but is rare to see in the unmodified demo scenario specifically
      because the existing herd-boom-then-bust population dynamic (see the
      gap above) usually kills a herd off within a few thousand ticks,
      cutting short how many chances it gets to roll. Not fixed here — the
      right lever is herd survival time (a pre-existing, separately-scoped
      gap), not a higher wanderlust chance.
- [x] **Herd conflict: fighting over resources — built, see DESIGN.md.**
      Direct ask ("I think escalated rivalry, even between species or same
      species, having them fight over resources would be cool"). New
      `herdConflict.ts`, triggered off real tile-capacity contention
      (occupancy.ts) via needs.ts's existing `ticksBlockedFromResource`
      counter, not an extension of herdMigration.ts's territorial trigger
      (see below for that as an explicit follow-up). Scoped to non-predator
      species on both sides, disposition-weighted (not a flat chance,
      matching `wanderlustChance`'s convention) and relative-strength-gated,
      and structurally non-lethal — the defender's hp is clamped at 15% of
      max, it can never faint or die from this mechanic, only retreat once
      hurt past 60% hp. New `herdClash` `SimEvent`, display support in
      `packages/web/src/eventText.ts`/`packages/runner/src/format.ts`. 10 new
      engine tests, 652 total, all passing including the unmodified
      determinism acceptance test. Real 9-seed 3000-tick validation: fires
      19-90 times per run, real hit/retreat/miss distribution, zero
      kill/faint events ever produced by it, and predator populations
      (scyther/spearow/onix) stayed at the same fragile-but-nonzero baseline
      level this file already documents elsewhere — no new predator-specific
      regression observed, and by construction (predators excluded from the
      trigger entirely) this mechanic cannot be the cause of one.
- [ ] **Real follow-up, deliberately not built this pass**: extending
      herdMigration.ts's existing same-species territorial-rivalry trigger
      (today it always resolves by the smaller herd relocating away) to
      sometimes escalate into a real fight instead, using the same
      non-lethal `herdConflict.ts` resolution machinery. This was the other
      real candidate trigger from the original design brief — resource
      contention (built) was judged the more concrete, better-motivated
      mechanism given the user's own "fight over resources" phrasing and
      occupancy.ts's real, frequent tile-capacity contention, but territorial
      escalation is a real, reasonable second half worth a future pass.
- [ ] **Real follow-up, deliberately scoped out for predator-fragility
      safety**: herd conflict currently excludes predator species entirely,
      on both sides of a potential fight (no predator-vs-predator rivalry,
      no predator muscling a herbivore off a resource). If predator
      populations are ever judged healthy/stable enough to safely absorb a
      new (even non-lethal) stress source, extending this mechanic to
      predators is a real next step — not attempted here given this
      session's repeatedly-documented predator-fragility findings.
- [ ] **Real follow-up, not built**: a herd-level (multiple members per
      side, closer to predation.ts's existing mob-fighting shape) version of
      herd conflict, rather than the current individual-pair version. Judged
      a materially bigger new death-risk surface to validate safely; the
      individual-pair version already satisfies the direct ask.

## Culture, disposition, and roles (pitched, not built — see chat)
- [x] Disposition vector per individual (boldness/aggression/sociability)
      built, and tied to a real canon-accurate Nature system rather than
      being independent of it — a deliberate departure from mainline (where
      Nature never touches behavior), see DESIGN.md's "Individual variance:
      Nature and Disposition" section. Wired into the flee-detection radius,
      mob-fight commitment headcount, predator hunt-hunger threshold, and
      mate-search radius — modest, individual-level hooks only. Herd
      "culture" as a computed aggregate of member dispositions
      weighted by role/rank (the rest of this bullet's original pitch) is
      still unbuilt — this was the individual-variance foundation it needs,
      not the aggregate itself.
- [x] Guardian behavior built, derived automatically from HuntRules (a
      species nothing preys on defends herd-mates) rather than a stored
      role — see DESIGN.md and the positioning gap above. Still open: a
      real `role` field for contested leadership/succession, which this
      isn't (guardians don't compete for the role, there's no succession).
- [x] Herd status/rank built (`herdRank` in herding.ts) — level buys real
      standing, per direct ask, see DESIGN.md's "Herd status" section for the
      full writeup. Two real payoffs: feeding priority (a lower-ranked
      herd-mate yields a contested, dwindling-stock food tile to a
      higher-ranked, also-hungry one) and mate preference (a rank-aware,
      distance-bounded bias in `reproduction.ts`'s candidate scoring). A real
      seed-42 run shows the feeding-priority mechanism firing often (2117
      yield events over 3000 ticks) and the top-ranked member of the run's
      largest herd siring more than double the next-most-prolific father's
      offspring — directionally real, though not cleanly isolated from this
      sim's documented rng-chaos-sensitivity by a single-seed A/B, flagged
      honestly in DESIGN.md rather than overclaimed. Still open: the real
      `role` field for contested leadership/succession noted just above is a
      different, bigger thing than rank (rank is a live-computed ranking,
      not a contested position), and whether a third status payoff
      (deference in contested movement/tile disputes) is worth adding.
- [x] Natal dispersal built — supersedes this bullet's original pitch with a
      more complete version (two triggers, not just evolving: a
      Disposition-weighted chance at maturity or on evolving, plus a
      guaranteed fallback after a sustained stretch mature with zero
      eligible mates found nearby) — see DESIGN.md's "Natal dispersal: real
      biology's actual fix for the inbreeding bottleneck" section, including
      its "Built, and what a real run actually showed" subsection for the
      honest result: real and working (dispersed events fire, new herds get
      founded, seed 42 at 8000 ticks shows +46% bulbasaur-line population
      across 13 herds vs. one), but at the specific 3000-tick checkpoint the
      motivating inbreeding-bottleneck A/B test used, it reads as
      statistically neutral (confirmed via a 20-seed average, not a
      single-seed fluke) rather than a clear win — the mechanism needs more
      ticks than 3000 to pay off, same as real multi-generation gene flow
      does. Tuning (`DISPERSAL_BASE_CHANCE`, `NO_MATES_DISPERSAL_TICKS`) is
      still open for revision against future runs. Sex-biased dispersal
      (many real species disperse one sex more than the other) remains a
      reasonable future refinement, not built here.
- [ ] Pair-bonding as a disposition trait (`monogamous | opportunistic`,
      or a continuous "fidelity" score): a monogamous agent that
      successfully mates records a `mateId` and prefers/restricts to that
      partner afterward; losing a bonded mate could mean never re-bonding
      (permanent, DF-style) or a grief cooldown. This is what makes
      individuals distinguishable by story ("bonded at tick 40, widowed at
      137, never mated again") rather than every agent of a species having
      the same behavior. Needs individuals to actually survive long enough
      to mate first — see the predator-pressure bottleneck above.
- [x] Individual stats/moveset/level per agent built — real mainline-scale
      stats, canon types, typed moves with cooldowns, real damage formula
      with STAB/type-effectiveness. See DESIGN.md's combat section.
      Individual variance within a species is now built too (Nature's
      1.1x/0.9x stat multiplier, see the bullet above) — same species+level
      is no longer guaranteed identical stats.

## Player / bonding (deprioritized until sim depth lands)
- [ ] Threat signature model — what exactly feeds it (speed/distance/posture)
      and how it plugs into existing perception/behavior logic.
- [ ] Concrete verbs for each trust-stage transition, per species — this is
      still just shaped, not designed as actual player inputs.
- [ ] Whether species-specific bonding puzzles read as distinct to a player
      without a tutorial — open playtesting question, see DESIGN.md.
- [ ] World-state consequences of a botched approach (herd relocation,
      species-wide wariness) — needs the resource-depletion/migration sim
      work above to exist first.

## Combat / moves
- [x] Real combat built: mainline-scale stats/HP, canon types + full 18-type
      chart, typed moves with power/accuracy/category/cooldowns, real
      damage formula with STAB/type-effectiveness. See DESIGN.md.
- [ ] The "promotion boundary" transition itself (see DESIGN.md) — not
      designed yet, just named. Wild-agent combat (predation.ts) now uses
      the real combat system directly rather than going through a
      promotion step, since there's no player yet — worth revisiting once
      the player exists and this needs to be a real transition.
- [x] **Real damage math wired in, not just data**: crit chance by stage
      (mainline 1/24, 1/8, 1/2, always — `CRIT_STAGE_CHANCE`/`rollCritical`
      in `combat.ts`, ported from PokeRogue's `getCriticalHitResult`),
      `CRITICAL_MULTIPLIER` (1.5x) actually applied in `calculateDamage`,
      mainline stat-stage multiplier table (`statStageMultiplier`, ported
      from `getStatStageMultiplier`) actually changing effective
      Atk/Def/SpAtk/SpDef when an agent carries `statStages`, and a real
      accuracy/evasion-stage formula (`accuracyStageMultiplier`, base-3 not
      base-2 — ported from `getAccuracyMultiplier`). `predation.ts`'s
      `resolveHit` now rolls `rollAccuracy` before every hit — **a move can
      genuinely miss now**, closing the old "accuracy not consumed" gap.
      New `missed` event kind for the log. Engine-tested (`combat.test.ts`):
      crit multiplier applies correctly, a crit ignores a beneficial
      Defense stage the way mainline does, a sub-100-accuracy move can miss
      with a controlled rng, stat stages measurably change damage.
      **Caveat, honestly**: nothing in the current sim roster ever *sets* a
      stat stage or uses a sub-100-accuracy move (every curated `MoveSpec` in
      `packages/data/src/moves.ts` is 100 accuracy), so in the actual demo
      run this is real, tested machinery sitting mostly idle — crit rolls
      are the one piece that visibly fires (verified in a real 1000-tick
      run: `scyther-0` landed a critical hit on `bulbasaur-1` at tick 59).
      Individual stat *variance* (Nature/IV-equivalent, different from these
      battle-only volatile stages) is still not modeled — see below.
- [x] **Speed-driven action economy built** (see DESIGN.md's "Action
      economy" section for the full design and real-run findings):
      `Agent.actionEnergy` accumulates each world tick's real `stats.speed`,
      and crossing `ACTION_THRESHOLD` (40, chosen against the demo roster's
      actual computed speeds — 9 to 37) is what lets an agent act that tick.
      `tickAgent` split into `tickAgentNeeds` (age/cooldowns/decay, always
      runs) and `tickAgentAction` (behavior/movement/attacks, gated).
      Cooldowns stay real-time, independent of the owner's action-tick
      status, per the locked design. A 1000-tick real run with it produced
      a genuinely new outcome: a Venusaur guardian, now acting almost every
      tick (speed 37 vs. threshold 40), actually caught and defeated the
      Scyther predator at tick 111 — something that never happened in any
      prior run recorded in DESIGN.md — which let the Bulbasaur herd
      reproduce for the first time ever recorded (2 births, ticks 476/543,
      both well after the kill) instead of going extinct. Not tuned
      further beyond that one constant; see DESIGN.md for what's still open
      (agents without a computed `stats` block, e.g. reproduction.ts's
      newborns, fall back to acting every tick rather than getting a real
      Speed value — a real gap, not fixed here).
- [x] **Move range is its own field** (`MoveSpec.range: { min, max }`,
      `combat.ts`'s `moveRange`/new `withinMoveRange`), replacing the old
      shape-derived-only reach — `range` is optional with a shape-based
      fallback so pre-existing hand-rolled `MoveSpec` literals (tests) don't
      need updating. The curated roster in `packages/data/src/moves.ts` now
      sets it explicitly.
- [x] **Skill tree / respec mechanism built**: `MoveSpec.tree` (a small DAG
      of nodes with a cost, optional prerequisites, and a delta on
      shape/range/power/accuracy/cooldownTicks/statusChance) plus a pure
      `applyMoveTree(base, chosenNodeIds)` in `packages/engine/src/moves.ts`.
      Ember has a real 2-node tree proving the "point -> ring, or stay small
      and trade for burn chance/cooldown" pitch works end to end (see
      DESIGN.md). **Deliberately not built / still open**: no build-point
      economy (how points are earned/spent), no UI, and — per the explicit
      scope call in DESIGN.md — wild background agents never apply a tree;
      `predation.ts` still only ever uses base `MoveSpec`s. The shape axis
      also still isn't connected to predation.ts's single-target-only
      combat — AoE moves among wild agents (who gets hit by a cone?) is a
      separate, real feature, not built. Target-tile-based ranged casting
      (aim at a tile within range, then the shape resolves from *that*
      tile, vs. today's origin-anchored shapes) is also still open.
- [ ] Status effects (burn, etc.) — `statusChance` exists on move data but
      nothing consumes it.
- [ ] Turn-based vs. real-time-with-pause for combat — undecided.
- [ ] Facing/direction for the player during combat — how is it chosen?
- [ ] No individual stat variance yet (no Nature, no IV/EV-equivalent) —
      same species+level always produces identical stats. See the
      Disposition/culture section above for the intended individuality
      layer once this matters. (Battle-only stat *stages* now exist in the
      math, per above — that's a different, temporary-per-fight axis.)
- [ ] Ability effects are not simulated — `ABILITY_DEX` (see "Data import"
      below) is reference-only; nothing reads `abilities.primary/secondary/
      hidden` at spawn or during combat.

## Leveling / exp / evolution / skill points
- [x] **Built: exp, real mainline growth curves, level-up loop, unbounded
      move learning, level-based evolution, typed skill points.** See
      DESIGN.md's "Leveling" section for the full write-up (growth-curve
      verification results, exp sources/amounts, evolution mechanics, the
      `applyMoveTreeWithSpend` spend-validation path) and real run findings.
      Short version: importer now pulls `baseExp`/`levelMoves` per species;
      `packages/engine/src/leveling.ts` has all six mainline growth curves
      (verified against `poke_the_spire`'s raw exp tables, zero mismatches);
      `grantExp`/`LevelingContext` wired into kills, passive trickle,
      eat/drink, mate/birth, new-sector, and new-species-encountered exp
      sources; level-ups loop multi-level, heal HP by the stat delta, learn
      every unlocked move, grant typed+wildcard skill points, and check for
      a level-gated evolution.
- [x] **Evolution finally observed in a real run — exp rates raised
      substantially, requested directly ("getting a kill should give a
      ton... passively eating and drinking should give some... moving
      around to new tiles gives a bunch").** Reconfirmed right before the
      fix: a 10000-tick run still topped out at level 8 for every agent
      across every species/line, zero evolutions ever. Raised
      `EXP_TRICKLE_PER_TICK`/`EXP_ON_CONSUME`/`EXP_ON_MATE_ATTEMPT`/
      `EXP_ON_BIRTH_PARENT`/`EXP_ON_NEW_SECTOR`/`EXP_ON_NEW_SPECIES_
      ENCOUNTERED` 5-10x each, and added a `KILL_EXP_MULTIPLIER` (8x) on
      top of the real mainline kill formula (which assumes a 6-Pokémon
      team splitting exp across frequent battles — doesn't apply to one
      wild agent's rare kill here). Real result: a 5000-tick run post-fix
      produced 3 real `bulbasaur -> ivysaur` evolutions, all at the exact
      real level-16 threshold, plus levels up to 17. See DESIGN.md.
- [ ] **Evolved agents can land on a species outside the curated `SPECIES`
      roster** (e.g. `"ivysaur"`, which `packages/data/src/species.ts` never
      hand-curated — only base dex fields are used for evolved stats/types).
      `packages/web`'s renderer looks up `SPECIES[agent.species]` for a
      sprite key and would break on such an agent. Not hit by the headless
      engine/runner path this feature validated against; a real gap for the
      browser app once evolution is actually reachable in a run (see above).
- [ ] **Status moves learned via `levelMoves` are recorded but not usable.**
      Most of a real species' level-up moveset is status moves (Growl, Leech
      Seed, etc.) that this sim has no engine for — `resolveMove` in
      `packages/data/src/leveling.ts` returns `undefined` for them, so they
      sit in `Agent.knownMoves` forever without a usable `MoveSpec`. Not a
      bug, but worth noting: an agent's *effective* combat moveset will
      often be much smaller than its `knownMoves` list once status moves
      exist in a species' real levelMoves table (which is most of them).
      **Design done, not built yet, and growing** — requested directly
      ("we do need status effects too" plus a separate, still-expanding
      brainstorm of environmental utility moves): the full design — data
      model, exactly which existing code each piece reuses, a running
      table of specific moves across three brainstorming rounds, and the
      real detection-radius gap found while designing Leer (FOV is fully
      built in `fov.ts` and used by zero actual AI decisions — every
      detection check today is a blind radius, not real line-of-sight) —
      now lives in **MOVES_DESIGN.md** at the repo root, its own file
      since the backlog outgrew a DESIGN.md subsection. Dig-to-escape
      shipped for real (Diglett/Sandshrew both know it) — in a leaner,
      stronger form than originally build-ordered: a real temporary
      burrow with automatic resurfacing, not just an instant one-shot
      layer cross, per MOVES_DESIGN.md's primitives checklist. Current
      top of the build-order list: Growl (highest payoff — most of the
      roster already knows it at level 1 and it's completely inert),
      Sunny Day, Leer, then burn/poison.
- [ ] **Non-combat exp trickle amounts are unguessed tuning** (trickle
      0.02/tick, consume 0.5, mate-attempt 1, birth 3, new-sector 2,
      new-species 2 — see DESIGN.md) — no canon formula exists for any of
      these since mainline doesn't grant exp for surviving/eating/mating.
      Revisit once a run shows whether leveling paces sensibly against the
      sim's actual timescale (see the evolution gap above — current signs
      point to "too slow for anything past early levels").
- [x] **A newborn's guaranteed level-up skill point required a follow-up
      fix mid-feature** (see DESIGN.md): `spawnOffspring` didn't set
      `Agent.types`, so `grantExp`'s guaranteed typed skill point (reads
      `agent.types?.[0]`) silently never fired for the majority of level-ups
      in a real run (most level-ups are newborns). Initially patched by
      inheriting `types` from the mother, but newborns still had no real
      stats/moves combat profile at birth. Fully fixed with
      `ensureCombatProfile` (`leveling.ts`) — computes real level-1
      stats/hp/types/moves from the dex, same math `grantExp`'s level-up
      loop uses, called from `spawnOffspring`.
- [x] **Bred offspring inherited the mother's current (possibly evolved)
      species instead of the line's base form** — a bred Venusaur produced
      another Venusaur, not a Bulbasaur, which is backwards from mainline
      (breeding always produces the base form; Bulbasaur is the "child
      version," not a separately-bred species). Fixed with
      `LevelingContext.baseSpeciesOf`, built from a reverse-evolution map
      over the full imported dex (`packages/data/src/leveling.ts`).
      Verified in a real run: `venusaur x venusaur` now consistently
      produces `bulbasaur` offspring.
- [x] **Mate eligibility required an exact species match — no real
      cross-species breeding, and real mainline compatibility is Egg
      Groups, not species identity.** Fixed with `canBreed`
      (`leveling.ts`) checking real Egg Group overlap; hand-curated
      `EGG_GROUPS_BY_BASE_KEY` since the imported PokeRogue dex has no
      egg-group data at all (confirmed directly against a fresh clone —
      PokeRogue's "egg" system is an unrelated gacha/rarity mechanic).
      Bulbasaur/Charmander (both Monster) verified as a real cross-species
      pair by test, but **not observable in an actual run yet** —
      `createDemoWorld` doesn't spawn a Charmander, so nothing currently
      exercises this path live. See DESIGN.md's Breeding section.
- [ ] **Herds are same-species-only today, but real mainline compatibility
      (Egg Groups) already exists in the engine (`canBreed`/
      `EGG_GROUPS_BY_BASE_KEY`, just above) and isn't used for herd
      membership at all** — `Agent.herdId` matching and dispersal's
      `findNearbyOtherHerd` both filter by exact species, not by breeding
      compatibility. Per chat: real mixed-species social groups are
      plausible wherever Egg Groups overlap, so dispersal's "join a nearby
      herd" check should filter by group compatibility instead of species
      equality, once there's a roster with real mixed-group opportunities
      to observe it working. Not started.
- [ ] **Player-recruitment herd concept (deprioritized with the rest of
      Player/bonding, captured here since it's the same "herd ≠ species"
      idea)**: once a player exists, a recruited team should function as
      the player's own herd — each teammate seeing the others as
      herd-mates (cohesion/guardian/mate-preference logic already keys off
      `herdId`, so a player-team herdId would plug into the existing
      machinery) regardless of species, same egg-group-compatibility
      question as the bullet above. Not designed in any detail — no
      player exists yet to recruit onto a team.
- [ ] **Egg-group table only covers the current spawn roster's lines
      (5 base species).** Extend `EGG_GROUPS_BY_BASE_KEY` whenever a new
      base species is added to `species.ts`. Ditto (universal breeding
      partner) and IV/Nature/ability/egg-move inheritance are real
      mainline mechanics not modeled at all — the latter three need
      underlying IV/Nature/multi-ability systems this sim doesn't have
      yet, so they're blocked on that, not just unbuilt.
- [ ] **A real O(agents²) performance regression was found and fixed
      mid-feature**: the "has this agent met a new species" check originally
      scanned every other agent every action tick for every agent. Combined
      with the sim's pre-existing unbounded Venusaur/Bulbasaur population
      growth (see the "Real tactical combat" section of DESIGN.md), a
      5000-tick run timed out (>90s) before this fix. Fixed by
      short-circuiting the scan once an agent has recorded
      `MAX_TRACKED_SPECIES` distinct species — caps the *added* cost, but
      doesn't touch the underlying unbounded-population problem, which is
      still the real, still-open item (see below and the reproduction/
      predation carrying-capacity gap already tracked elsewhere in this
      file). A long run is still at real risk of becoming impractically slow
      independent of anything in this feature.
- [ ] Item/trade/friendship evolutions are parsed into dex `conditions` but
      explicitly not consumed (no item system, no trading, no friendship
      stat exist) — only `level`-gated evolutions are checked. Matches the
      explicit scope call in DESIGN.md's original design writeup.
- [ ] Skill-point *spending* by an AI-controlled agent (an auto-spend
      heuristic, eventually the player's own choice via a UI) doesn't exist
      — `applyMoveTreeWithSpend` is real, tested plumbing that nothing calls
      yet outside tests. Wild background agents accrue skill points
      (harmlessly unused currency) but, per the existing scope call, never
      call it.

## Faint/finish-off, heal over time, herd inventory and carrying
- [x] **Built: fainting instead of instant death, heal-over-time (fed-gated),
      a finishing pool that absorbs follow-up hits, recovery, corpse
      persistence, looting, herd food delivery, and literal carrying of a
      fainted ally.** See DESIGN.md's section of the same name for the full
      write-up and real run findings. Short version:
      `packages/engine/src/support.ts` holds every new tuning constant and
      most of the new logic (heal/recover/loot/deliverFood/carryAlly);
      `predation.ts`'s `resolveHit` now faints instead of killing on a
      lethal hit and only actually kills once a 0.75\*maxHp finishing pool
      is exhausted (by however many follow-up hits, from anyone); kill-exp
      and hunger-restore-on-kill both moved to that true-death moment.
      104 pre-existing engine tests still pass (2 rewritten to match the new
      faint-then-finish semantics, not special-cased); 11 new tests added.
- [x] **Real run finding, and it's the important one: a fainted agent
      outside a herd (or one whose needs were already low when it fainted)
      can get stuck fainted forever, neither recovering nor being finished
      off.** A 3000-tick run: Scyther (solitary, no herd) fainted at tick
      152 with thirst already at ~0.52 — below `FED_THRESHOLD` (0.7) — so
      heal-over-time never even started (its own decay had already crossed
      the fed gate before the faint). One Venusaur landed a follow-up hit at
      tick 155 that didn't finish the (unlogged, since `fought` doesn't
      currently record the remaining pool) finishing pool, and then nobody
      came back into range for the rest of the 3000-tick run — Scyther just
      sat there fainted, permanently, contributing to neither the food chain
      nor the event log for ~2850 ticks straight. The margin is razor-thin
      even for an agent that faints at full needs: healing to the 18% wake
      threshold at 1%-of-maxHp/tick takes ~18 ticks, while thirst alone
      decays through the 0.7 fed gate in ~20 ticks from full — a fainted
      agent has to already be finished off or rescued (herd food delivery,
      carrying) well inside that window, or it's stuck. This is a real,
      specific tuning gap: either heal-over-time needs a faster rate, the
      fed-gate needs to be more lenient specifically for a fainted agent (a
      believable in-fiction argument: it's not moving or fighting, its needs
      shouldn't decay at the normal active rate), or fainted-with-no-herd
      needs a bounded "die of exposure eventually" fallback so a corpse
      doesn't sit in `World.agents` forever in spirit even though the
      literal `alive` flag stays true. Not fixed here — reported straight,
      exactly the finding this feature was supposed to surface.
- [x] **Fainting and finishing-off were both observed for real, not just
      engine-tested**: same 3000-tick run, two Bulbasaur fainted and were
      killed 2 ticks later each (tick 58->60, tick 107->109) — a real
      two-stage "knock down, then finish off" sequence, matching the design
      intent exactly. Hunger only restored on the tick-60/109 `killed`
      events, not the earlier `fainted` ones — eating-on-true-death-only is
      real, not just asserted.
- [ ] **Herd food delivery fired far more than intended: 7212
      `foodDelivered` events in the same 3000-tick run** (vs. 2 in a
      1000-tick run on the same demo scenario) — a direct consequence of the
      sim's pre-existing unbounded population growth (see the "Leveling"
      TODO item above and DESIGN.md's action-economy section): once the
      Venusaur/Bulbasaur population balloons into the hundreds, a large
      fraction of them are well-fed at any given moment, `HUNGRY_HERDMATE_
      THRESHOLD` (0.4) is common enough to always have a target, and nothing
      caps how often one agent restarts the errand. Worth tightening once
      the underlying population-explosion problem has a fix to test
      against — right now it's hard to tell whether 0.4/the lack of a
      cooldown is wrong in isolation or just amplified by an unrelated bug.
      **Traced further, by request, before touching any code**: three
      compounding causes, confirmed directly against `support.ts` and a
      real run, not just theorized — (1) no per-agent cooldown after
      completing a delivery errand, so a courier immediately re-scans for
      a new hungry herdmate every idle tick; (2) no "reservation" on a
      chosen recipient, so multiple couriers can target the same hungry
      agent at once — observed live in one run: `bulbasaur-2` got
      delivered to at tick 120, then again at tick 152 by a different
      courier; (3) the event count scales with population size, not tick
      count — confirmed by contrast: a small-population run (7-16 agents)
      produced only 54 `foodDelivered` over 2000 ticks (reasonable), vs.
      the hundreds-of-agents run above producing 7212 in 3000. Conclusion:
      this isn't really a broken mechanic in isolation, it's the
      population-explosion problem wearing a different hat — a real fix
      (cooldown + reservation) is straightforward but should wait until
      population equilibrium has its own fix to test against, per the
      note above. Left unchanged for now, on purpose.
- [ ] **Looting and literal carrying were never observed in either real run
      (1000 or 3000 ticks), only in direct engine tests.** Two different
      reasons, both worth naming rather than just reporting a null result:
      (1) nothing in the demo scenario ever puts real loot in an inventory
      except a `deliverFood` courier's own in-transit food item, which is
      consumed within a tick or two of being picked up, so there's almost
      never anything sitng around to loot; (2) a hunting predator's own
      follow-up hits reliably land faster (every ~2 ticks, see the finding
      above) than a herd-mate can notice a fainted ally and walk over to
      pick it up, so the carry window mostly doesn't open before the target
      either recovers, dies, or (per the finding above) gets stuck in limbo.
      The mechanism itself is real (support.ts's `applyCarrying`/
      `maybeStartCarrying` are directly engine-tested, including the
      drop-on-threat path) — this is an emergent-scenario gap, not a
      not-implemented one. A dedicated small scenario (a slow predator, a
      tanky prey that survives several hits before fainting, a herd-mate
      planted adjacent) would be the way to actually witness it end-to-end
      outside a unit test.
- [ ] **5000-tick run timed out (>300s)**, consistent with the pre-existing
      unbounded-population problem documented in DESIGN.md's action-economy
      and leveling sections, plausibly worse now: `applyLooting` and
      `applyHerdSupport` each scan `world.agents` per agent per action tick
      (same O(agents)-per-agent cost class predation.ts's own `agentsWithin`/
      `countHerdAllies` already have), so they add roughly proportional
      constant-factor overhead on top of an already-unbounded agent count
      rather than a new order of complexity — but "constant factor on top of
      unbounded" is still enough to turn 3000 ticks (61s) into "5000 ticks
      doesn't finish in 5 minutes." Not specifically optimized here, per the
      same scope call every previous feature in this area has made — the
      real fix is the carrying-capacity/population problem itself.
- [ ] **Carry-capacity uses a maxHp-based proxy, not real imported species
      weight** (`carryCapacityOf`/body-weight in support.ts) — an explicit,
      documented scope call (see DESIGN.md) rather than extending the
      importer to pull `poke_the_spire`'s height/weight fields for a second
      time this project. Revisit if held-item effects ever get consumed by
      combat (the existing out-of-scope item there) and real weight starts
      mattering for something beyond carry capacity.
- [ ] `fought` events don't carry the fainted defender's remaining
      finishing-pool value — tests and the finding above had to infer it
      from `damage` plus context. A cheap follow-up: add an optional
      `finishingPoolRemaining` field so the event log itself can narrate a
      multi-hit finishing blow ("2 hits left in the pool", etc.) without
      re-deriving it from raw damage numbers.

## Art / assets
- [ ] Sprite pipeline is bring-your-own (`packages/web/public/sprites/`) —
      decide on sprite sheet format/size once real art exists.
- [ ] Tile art vs. the current flat-color terrain rendering.

## Data import
- [x] **Bulk species/move/ability/type import from PokeRogue, done.** Unblocked
      once a session had `poke_the_spire` checked out locally alongside this
      repo (the earlier attempt's GitHub-access wall wasn't a problem this
      time — no `add_repo` needed, just read files off disk). See
      `packages/data/scripts/import-from-pokerogue.mjs` and DESIGN.md's "Data
      import" section for what got pulled in and the scope calls made along
      the way. Re-run the script against a fresh PokeRogue checkout whenever
      it's worth refreshing the dex.
- [ ] **Species dex covers only base forms** (see DESIGN.md) — PokeRogue
      models some alt forms (Alolan/Galarian/Hisuian/Paldean regional forms,
      Mega Evolutions) as their own top-level `SpeciesId` and they came in
      for free, but forms nested inside a single species' `forms: [...]`
      array (Pikachu's cosmetic caps, Deoxys/Rotom/Zygarde/Arceus formes,
      Gigantamax) did not. A future pass could add a separate forms table
      keyed by base species id if that's ever needed.
- [ ] **Move dex captures data, not behavior.** `MOVE_DEX` has real
      type/category/power/accuracy/pp/priority/target plus a tag list of
      PokeRogue's `MoveAttr` class names per move (953 moves) — but nobody
      interprets those tags. Reimplementing what e.g. `LeechSeedAttr` or
      `MultiHitAttr` actually does is a different, much bigger project.
- [ ] **Ability dex has no effect text.** `ABILITY_DEX` (319 abilities) has
      id/name/a tag list of `AbAttr` class names/`ignorable`, but no
      plain-text descriptions — those live in a separate i18n locale repo
      that wasn't part of this checkout. Nothing in the engine reads ability
      data at all yet; wiring abilities into combat is unstarted.
- [ ] **Curated items (`ITEM_DEX`, ~30 classic held items) are reference data
      only** — not wired into `combat.ts`. PokeRogue's real item/modifier
      system (shop economy, stacking rules, hundreds of items) is enormous
      and deliberately out of scope; if item effects ever get simulated,
      start from this curated list's numbers rather than the full system.
- [ ] `packages/data/src/dex/*.generated.ts` are, as the name says, generated
      — don't hand-edit them; re-run the import script instead. They're
      checked in (not gitignored) so the sim can be built without a
      PokeRogue checkout present.

## Infra
- [ ] No lint/format config yet (eslint/prettier) — add once the codebase
      is bigger than "does it typecheck."
- [ ] No CI yet.
- [x] **Found and fixed a real cross-test-file flakiness bug**: with
      vitest's default "threads" pool, a `vi.spyOn(Math, "random")` mock
      from one test file could intermittently leak into another when
      vitest happened to schedule both onto the same worker thread —
      confirmed reproducible independent of any of this session's other
      changes (`flora.test.ts` + `reproduction.test.ts` alone, both
      untouched, failed ~50% of the time run together; passed 100% of the
      time run alone). Adding `needs.test.ts`'s new old-age-mortality mocks
      (also `vi.spyOn(Math, "random")`) just raised the odds of hitting it
      in a full-suite run enough to surface it. Fixed with a
      `packages/engine/vitest.config.ts` setting `pool: "forks"` (each test
      file gets its own OS process, so `Math` genuinely can't be shared) —
      verified with 5 consecutive full-suite runs, all green, no
      measurable slowdown (~2.5s either way).
      **A second, genuinely separate flake surfaced once that one was
      fixed**: adding exp-motivated exploration (see "Leveling" below)
      meant a newborn — which gets ticked once more in the very same
      `tickWorld` call it's spawned in (a documented pre-existing quirk,
      simulation.ts) — could immediately wander a step back onto its own
      mother's tile on its first (same-tick) action, intermittently
      failing the "don't spawn stacked on the mother" test. Fixed with
      `MIN_EXPLORE_AGE = 10` in `needs.ts` (a newborn settles in for a few
      ticks before it starts wandering) — verified with 8 consecutive
      full-suite runs, all green.
- [x] **Full-engine determinism: every `Math.random()` call site now threads
      the shared seeded `World.rng` instead** — see DESIGN.md's "Determinism:
      a seeded PRNG threaded through the whole engine" section for the full
      converted-call-site list (flora/leveling/migration/needs/predation/
      reproduction, plus combat/nature/weather/herdMigration which already
      had `rng` params from earlier features but weren't yet reaching
      `world.rng` in production) and the concrete two-runs-diffed proof
      (same seed, 1000 ticks via `packages/runner`, byte-identical md5).
      Also fixed a real hidden-global bug this surfaced:
      `reproduction.ts`'s newborn-id counter was a module-level `let`
      (moved onto `World.offspringSequence`), and one missed `rng`
      passthrough in `needs.ts`'s eat/drink exp grant (silently fell back
      to its own `Math.random` default, invisible to `world.rng`
      draw-counting but a real source of run-to-run divergence — caught by
      the diffed-logs acceptance test, not by inspection). `packages/runner`
      takes an optional seed argument and prints the seed used at the start
      of every run.

## Cross-branch merge: status effects/skill-trees branch merged in

`claude/pokemon-roguelike-sim-5rje5a` (a separate parallel Claude session's
work — status effects (burn/poison/paralysis/**sleep**/freeze), forced-
movement moves (knockback/drag/lunge/retreat), and a skill-tree/move-
primitives expansion) has now been merged into this branch. The real
file-collision risk flagged below when this note was first written (both
branches editing `needs.ts`/`predation.ts`/`types.ts`/`support.ts`/
`simulation.ts`/`combat.ts` around the same time) did materialize —
conflicts in `DESIGN.md`, `events.ts`, `leveling.ts`, `needs.ts`,
`predation.ts`, and `runner/format.ts` — but all resolved by hand, not a
blind `git merge`:

- **`predation.ts` needed real reconstruction, not just picking a side.**
  The other branch's combat refactor (multi-hit moves, AoE via
  `resolveShape`, stat-stage-aware damage, lifesteal/recoil/thorns,
  situational multipliers) had **silently dropped this project's rng-
  threading discipline** — new functions (`applySingleDamageInstance`,
  `resolveHitAgainstTarget`, `resolveAreaHit`, `resolveHit`) called
  `Math.random()`/`rollCritical(...)` directly instead of accepting and
  threading an `rng` parameter, which would have broken the determinism
  guarantee (DESIGN.md's "Determinism" section, `test/determinism.test.ts`'s
  same-seed-same-log acceptance test) the moment any of that new code ran.
  Fixed by adding `rng: () => number = Math.random` to every one of those
  functions and threading it through every roll (crit, damage variance,
  accuracy, hit count, status inflict/spread, skill-point/kill-exp grants)
  — confirmed afterward that the determinism acceptance test still passes
  with the merged code. This is exactly the kind of gap this project has
  hit before (see the "missed `rng` passthrough" bug in the Determinism
  section above) — always re-check new/refactored code for a bare
  `Math.random()` call before assuming rng-threading survived a merge.
- **The move-induced vs. natural sleep unification is still NOT done.**
  This merge only made both mechanisms coexist side by side —
  `agent.asleep` (this session's energy-driven rest, with its sitting-duck/
  herd-wake logic in `predation.ts`) and `agent.status?.kind === "sleep"`
  (the other branch's move-induced status effect, `status.ts`) are two
  completely independent flags right now; an agent could theoretically be
  both, or either, with no interaction. The confirmed design intent —
  direct quote, "mechanically i do want them to be the same thing
  basically. but one is naturally caused by lack of energy and one can be
  induced by moves" — still needs real follow-up work: should a
  move-induced sleep set `agent.asleep` too (getting the same no-self-
  defense/herd-wake treatment)? Does it get the same reduced hunger/thirst
  drain and faster heal/cooldown recovery? What wakes each variant — a
  fixed duration (status.ts's `SLEEP_TICKS_MIN`/`MAX`) vs. the energy/
  urgent-need/threat-plus-watcher conditions? Not started.
- Two pre-existing flaky tests were found and fixed while validating the
  merge (both in `predation.test.ts`, inherited from the other branch,
  not introduced by the merge itself): "a positive critRateStage can crit
  on a roll that stage 0 would not" and "statusSpreads inflicts the same
  status on a nearby agent" both used `vi.spyOn(Math, "random")` to control
  a roll, which stopped having any effect once `tickWorld`'s real default
  rng (`world.rng`, not `Math.random`) was actually being consumed by the
  now-correctly-threaded code above — fixed by passing an explicit rng
  function straight into `tickWorld` instead of mocking the global. A
  third, "weightScaling... deals more bonus damage" (real, reproducible
  flake confirmed via a 30-run loop, ~1/30 rate), had no rng control at all
  on an unseeded `createWorld` — fixed with the file's existing `SAFE_RNG`
  convention. **Not fully audited**: this test file has roughly 80 other
  unseeded `createWorld(10, 10)` calls; a similar low-rate flake
  ("recoilFraction never faints the attacker outright") was observed once
  in ~20 full-file runs and not chased down further given how rare it is —
  worth a real pass converting this whole file to seeded/explicit-rng
  `createWorld`/`tickWorld` calls throughout if it recurs enough to be
  annoying in CI once CI exists.
- `master` is stale relative to both branches (0 commits ahead of this
  branch, 69 behind) and `Stable-for-Brian` is a heavily diverged,
  messily-committed branch (34 unique commits, terse/non-descriptive
  messages) — neither looks relevant to reconcile against, flagging only
  so it's not mistaken for something that needs attention later.
- [x] **Real O(agents²) perf regression found and fixed**: real timing
  (500/1000/2000-tick pure-compute benchmarks, no per-event I/O) showed
  clearly superlinear scaling after this merge — 0.9s/1.2s/6.1s. Traced one
  real cause: `status.ts`'s `applyHealAuraPassive` ran on every agent's
  every tick and, for anyone actually carrying the `healAura` passive,
  scanned all of `world.agents` for same-herd neighbors instead of a bounded
  lookup — same class of bug as the pre-existing species-encounter-tracking
  one. Fixed with a new `herdIndex.ts` (per-tick cached herd membership,
  same pattern as `resourceIndex.ts`).

  That fix wasn't the whole story, and the auto-respec hypothesis
  (`maybeAutoRespec`, leveling.ts) written down here turned out **not** to be
  it — read the actual code and confirmed `maybeAutoRespec`'s cost is bounded
  by a single agent's known-moves/tree-node count, not by population size,
  so it doesn't scale with agents at all. Profiling (`node --prof` +
  `--prof-process`) instead pointed at `packages/data/src/leveling.ts`'s
  `profileFromDexEntry` (`LEVELING_CONTEXT.getProfile`): it rebuilt a fresh
  `LevelingProfile` object (including an `evolutions.filter().map()` pass)
  from scratch on *every* call, and `reproduction.ts`'s `applyMateSeeking`
  calls it (via `canBreed`, up to twice) once per candidate in a full,
  unindexed `world.agents` scan run for *every* mate-seeking agent, every
  tick — an O(agents) scan whose per-candidate cost was itself needlessly
  heavy, and O(agents) of those scans per tick. A per-call counter confirmed
  it: a 2000-tick/~350-agent run made ~790,000 `getProfile` calls, growing
  far faster than population or tick count (500 ticks: ~43k; 1000 ticks:
  ~103k). Fixed by memoizing `profileFromDexEntry` in a small `Map` keyed by
  species id — safe because the dex it reads from is static for the life of
  the process, so nothing ever needs to invalidate the cache; same "index
  instead of a bare scan" fix shape as `herdIndex.ts`, just for a lookup
  table instead of world-position data.

  **A second, bigger contributor turned out to be a real determinism bug,
  not a pure perf one**: `grantExp`'s level-up loop (leveling.ts) called
  `grantSkillPoint(agent, primaryType, world, log, ctx)` — silently dropping
  the `rng` parameter, so every level-up's guaranteed skill-point grant (and
  its `maybeAutoRespec` follow-up, and its 1-in-`SKILLPOINT_WILDCARD_INTERVAL`
  bonus-wildcard recursion) fell back to real, unseeded `Math.random()`
  instead of `world.rng`. Confirmed via a same-seed-twice checksum
  (`createDemoWorld(42)` + 500 ticks, same process, same code): agent count
  and a position/level/HP checksum differed on *every single run* before
  this fix, identical on every run after it. This explains why the
  originally-reported 0.9s/1.2s/6.1s numbers looked so dramatically
  superlinear: re-running that exact unmodified benchmark several times (no
  code changes) produced wildly different populations at tick 2000 purely by
  luck — 97, 148, 239, 379, once even 753 — because the unseeded skill-point
  draws fed back into how much a run's population could grow (more real
  wildcard points -> more passives/moves committed -> different downstream
  survival), and a larger population is itself genuinely more expensive to
  tick. The "superlinear" shape was real variance across un-reproducible
  runs, not (mostly) a single hidden algorithmic hot path. Also
  independently found and fixed the same class of bug one call up:
  `tickAgentNeeds` (needs.ts) called `tickStatusEffects(agent, world, log)`
  without `rng`, so a frozen agent's per-tick thaw roll had the same
  unseeded-`Math.random()` problem (smaller blast radius, same fix).

  **Verified end to end**: `pnpm --filter @pokuelike/engine test` (541
  tests, run twice, no flakes seen) and `test/determinism.test.ts`'s
  acceptance test both still pass; the exact task benchmark script, run
  twice back to back on seed 42, now reproduces byte-identical agent
  counts/timing (500: ~800ms/22 agents; 1000: ~1150ms/13 agents; 2000:
  ~2100ms/11 agents, both runs). A higher-population seed (4: 27 -> 51 ->
  314 agents across the same three tick counts) stays reproducible run to
  run and scales with population roughly in line with tick count rather than
  blowing up, confirming the fix holds at scale and not just on a
  small-population seed.
- [ ] **A second pre-existing flaky test surfaced outside `predation.test.ts`**:
  `reproduction.test.ts`'s cross-species-types assertion failed once in a
  full-suite run, passed 1/1 in isolation immediately after — same unseeded-
  `createWorld`-plus-real-rng shape as the `predation.test.ts` flakes
  documented above, just in a different file. Not chased down individually
  (same "not fully audited" caveat applies) — worth folding into that same
  future seeded-rng test-hygiene pass rather than fixing file-by-file as
  each one happens to get noticed.

## Real pathfinding for `seekWater`/`seekFood` — built; other behaviors still greedy

**Built**: a new `pathfinding.ts` (BFS, `findPath`/`stepAlongPath`, cached
per-agent on `Agent.pathCache`) now backs `needs.ts`'s `seekWater`/
`seekFood` stepping specifically — see DESIGN.md's "Follow-up: real BFS
pathfinding for `seekWater`/`seekFood`" section for the full writeup. Real
re-run of the exact seed that surfaced this (20260903): thirst-starvation
deaths 20 → 13, and the specific stuck-oscillating Onix from the original
diagnosis no longer dies of thirst at all (it now dies later, in combat,
instead). Chose per-agent path caching over a shared per-(layer, target)
flow-field cache (the `resourceIndex.ts`/`herdIndex.ts` pattern) — the map
is small enough that per-agent BFS is already cheap and a real run showed
no measurable slowdown; a shared cache is a possible future optimization
if per-agent recomputation ever shows up as a real cost in a much larger
map or population, but wasn't worth its extra invalidation surface now.

**Still open at the time / now built**: hunt-a-visible-target and
mate-seeking (predation.ts/reproduction.ts) now ALSO get real BFS
pathfinding — see DESIGN.md's "Follow-up 2: real BFS pathfinding for
hunting and mate-seeking, with moving-target handling" for the full
writeup. A moving target needed its own recompute-staleness rules
(`stepTowardMovingTarget`, a new function alongside `stepAlongPath`) rather
than the static-target cache, or the caching benefit would have been
defeated by the target moving nearly every tick. Real re-run findings on
both the seed that surfaced the original bug (20260903) and seed 42: seed
42 shows the intended effect clearly (births 39 → 75, fought 21 → 26), but
seed 20260903 shows LESS combat/reproduction after the change (fought
20 → 7, born 14 → 7) — not a regression (every test passes, no wall-clock
slowdown either seed), just the same butterfly-effect divergence a
behavior-shaping change always produces in a deterministic-but-chaotic sim
under a fixed seed. See DESIGN.md for the full honest breakdown.

**Still open / explicitly out of scope for this pass**: flee, exploration,
dispersal's long walk, shelter-building's travel, and herd-migration's
relocate walk still call `movement.ts`'s plain `stepToward`/`stepAway`
unchanged, on purpose (flee especially wants "away right now," not an
optimal route, and none of these were a confirmed death-causing case).
Worth revisiting as a candidate follow-up, not fixing preemptively, if a
future real run shows one of THEM getting stuck near an obstacle cluster
the same way seekWater/seekFood (and, before this pass, hunting/mate-
seeking) used to.

**Unrelated gap noticed in passing while validating this pass, not fixed
(out of scope)**: both real 2000-tick runs (seeds 20260903 and 42) still
show `killed`/`defeated`/`born` counts that are small relative to
`floraChanged`/`supported`/`leveledUp` — hunting and mating are working
mechanically (confirmed directly by this pass's own obstacle-course
integration tests) but remain rare events over a full run relative to
everything else going on. Might be worth a future look at whether
`HUNT_HUNGER_THRESHOLD`/`MATE_SEARCH_RADIUS`/herd-density tuning is
leaving real hunting/mating opportunities on the table, independent of
pathfinding — not investigated further here since it's a tuning question,
not something this pathfinding pass itself caused or is positioned to fix.

## Urgency-based need priority, extended thirst margin, and sleep — built, tuning follow-ups

- [ ] **`LONG_SLEEP_EXP_TICKS` (200) reads a little high relative to real
      sleep-session lengths** — a real seed-42 (and 3 other seeds') run
      never saw a completed sleep session longer than 183 ticks, so the
      long-sleep exp bonus never actually fired in any of the four real
      runs tested (confirmed firing correctly, exactly once, in
      sleep.test.ts's unit test). Worth revisiting once predator population
      dynamics (see the bullet below) are healthier and agents have more
      reason to sleep longer/more often — lowering the threshold now, with
      only unit-test data to go on, risks tuning against the wrong signal.
- [ ] **Sleep's two "danger" paths (a watcher waking a sleeper, a predator
      catching a sleeper) were never observed in real-run testing** across
      four seeds (42, 7, 99, 123) at 2000 ticks each — every single wake
      was the `urgentNeed` path, zero `threatSpotted` wakes, zero hits/kills
      landed on a sleeping agent. Root cause investigated, not assumed:
      3 of 4 seeds ended their run with zero living hunter-species agents
      at all (the pre-existing predator-population problem below), so the
      "predator within detection range of a currently-sleeping prey" window
      this needs essentially never opened. Both mechanisms are directly
      unit-tested (predation.ts's guard placement + needs.ts's wake logic —
      see sleep.test.ts) and the code path is real, just unconfirmed
      end-to-end in a real scenario. A dedicated small scenario (a
      persistent, well-fed predator that doesn't die out, planted near a
      sleep-prone herd) would be the way to actually witness it, the same
      "targeted scenario, not just a longer demo run" approach this
      project has used before (see the carrying/looting gap noted above).
- [ ] **Predator (hunter-species) populations crash to near-extinction fast
      in the demo scenario** — confirmed while investigating the bullet
      above, not new to this feature: 3 of 4 test seeds had zero living
      `scyther`/`spearow`/`onix` agents by tick 2000, the fourth had
      exactly 1. Pre-existing population-dynamics territory (see the
      exploding-Bulbasaur/Venusaur growth findings and the unbounded-
      population performance notes elsewhere in this file/DESIGN.md), not
      something this feature caused, but it does mean any future
      predator-dependent feature (this one included) needs a genuinely
      sustainable predator population to actually exercise in a real run,
      not just a longer tick count.
      **Update, this session**: pack hunting + scavenging (see the section
      below, DESIGN.md) were built as two direct levers against exactly this
      — both proven real and working via dedicated stress scenarios, but
      predator populations still did NOT reliably recover in real 3000-tick,
      9-seed runs (several seeds still ended at 0). The mechanisms mostly
      just don't get a chance to fire in the stock demo scenario, because it
      spawns exactly one of each predator species — see the follow-up below
      and DESIGN.md's own honest findings section. This bullet stays open.
- [ ] **Dispersal's pause-on-urgent-need fix real-run numbers (seed 42,
      2000 ticks, A/B against the pre-feature code on the same seed): total
      starvation deaths dropped 109 -> 30 (thirst deaths 82 -> 23, hunger
      27 -> 7), final population rose 365 -> 443.** Confirms the diagnosed
      root cause (dispersal blocking hunger/thirst/mate-seeking for its
      whole multi-hundred-tick walk) was real and the fix closes most of
      the gap. One honest side effect worth tracking: completed `dispersed`
      events dropped 12 -> 3 in the same window — expected (a paused
      dispersal takes more real ticks to actually arrive, so fewer finish
      within a fixed window), not a regression, but worth knowing if a
      later feature wants to reason about "how many dispersals typically
      complete in N ticks."

## Cross-herd mating escape hatch — built, see DESIGN.md

- [x] Solo dispersal founders (and any herd with no current opposite-sex
      mature member) are no longer permanently mate-locked — `isEligibleMate`
      now allows cross-herd pairing once either party has gone
      `MATE_ISOLATION_TICKS` (200) ticks with zero eligible mates in range.
      Confirmed firing in a real 3000-tick run (seed 7, tick 2561). 4 new
      tests, all 579 engine tests pass, determinism unaffected.
- [ ] **Open tuning question:** is 200 ticks the right fuse, and should it
      scale with local population density (sparser maps might want it
      shorter)? Not resolved — needs more real runs across seeds/densities
      before touching the constant again.

## Breeding-level gate — built, but a real severe side effect flagged, see DESIGN.md

- [x] Breeding now requires evolved-once OR level 16+, on top of the
      existing age-based maturity check. Direct instruction, implemented
      exactly as asked (`meetsBreedingRequirement` in reproduction.ts).
- [ ] **Urgent-ish open question, not resolved here:** a real 3000-tick,
      3-seed run shows births collapsing to 4-5 total per run (was
      hundreds-to-thousands) — most agents simply don't reach level 16 or
      evolve within a normal run's lifetime at current exp-gain rates
      (`EXP_TRICKLE_PER_TICK` 0.8/tick vs. ~2535 exp needed for MEDIUM_SLOW
      level 16). The eligibility rule does exactly what was asked; whether
      the *practical* near-zero-breeding outcome at today's exp pacing is
      the intended end state, or whether exp-gain rates (or the level
      threshold) should be revisited alongside it, is a real open design
      question to take back to the user rather than guess at.
- [x] **Tried: quarter thirst/hunger decay rates, direct ask, on the theory
      that agents weren't surviving long enough to level up.** Real
      before/after run (same 3 seeds) shows this **did not fix breeding**:
      births stayed at 1-4 per run. Root-cause check: starvation deaths
      were already rare even before this change (0-6 thirst deaths, 0
      hunger deaths, ~2-4 kills per 3000-tick run, out of a starting
      population of 17) — agents were already surviving fine. The real
      bottleneck is leveling *speed*, not survival time: most agents simply
      never accumulate enough exp to reach level 16 within 3000 ticks
      regardless of how long they live. Kept the slower decay anyway (a
      real, independently-requested improvement — starvation was already
      rare, this makes it rarer still, no downside found), but it does NOT
      resolve the breeding-rate question above — exp-gain pacing is the
      actual lever, still unaddressed.
- [x] **Follow-up (direct ask): lowered `MIN_BREEDING_LEVEL_UNEVOLVED` 16 ->
      12, plus a slight exp bump (`EXP_TRICKLE_PER_TICK` 0.8 -> 1.0,
      `EXP_ON_CONSUME` 6 -> 8).** Real same-3-seed run: meaningfully
      better on 2 of 3 seeds — seed 42: 32 births (was 4), final pop 37
      (was 14); seed 7: 12 births (was 3), final pop 22 (was 11). Seed
      20260903 stayed stubbornly low (2 births, was 1, final pop 13). A
      real, substantial improvement, not a full solve — worth a longer run
      or more seeds if the user wants every seed to recover, not just most.

## Real bug fix: "died of thirst while in water" — see DESIGN.md

- [x] Direct report, traced to a real mechanism: `applySupportMove` had no
      urgent-need escape valve, so a zero-cooldown ally-buff move (reachable
      via the skill tree) plus a permanently-adjacent herd-mate let it claim
      every action tick forever — `tickAgentAction` never reached
      `chooseBehavior` again. Fixed via a `needsAreUrgent` gate at the
      caller (needs.ts), same pattern as dispersal/shelter's existing pause
      fix; `applyHerdSupport`'s food-delivery errand got the same fix (only
      checked the deliverer's own needs once, at errand start). This
      resolves the seed-20260903 low-growth mystery noted in the entry just
      above far more than the exp/level tuning did: real before/after same
      3 seeds, this fix alone — seed 20260903: final pop 13->40, births
      2->28, zero starvation deaths (was 5 near/on water); seed 7: 21->164;
      seed 42: 19->34. Every prior "population stays low on some seeds"
      finding this session should probably be re-read in light of this —
      it may have been the dominant cause all along, not herd-lock or exp
      pacing. New regression test in support.test.ts. All 594 engine tests
      pass, determinism unaffected.

## Inspector redesign follow-ups (grouped layout / moves / skill trees)

- [ ] The skill-tree layout is a simple BFS-depth layered layout (one row per
      depth), not a real graph-layout algorithm — no edge lines drawn between
      a node and its prerequisites, and no crossing-minimization within a
      row. Fine for the small trees that exist today (5-10 nodes); would
      likely need real edges drawn (SVG connectors) to stay readable if a
      much larger/denser tree ever gets authored.
- [ ] No real browser/DOM test harness exists in this project (confirmed
      again this session — Playwright/jsdom/happy-dom aren't installed) so
      the new grouped inspector layout was verified via a hand-rolled DOM
      shim + typecheck/build, not an actual rendered browser. Worth revisiting
      if this project ever adds one, especially for anything with real click
      interaction like the new move-tree toggle.
- [ ] Mobile/narrow-viewport responsiveness of the new grouped inspector
      sections is unverified — the existing `#inspector-panel` scroll
      container should handle it via `overflow-y: auto`, but the group
      boxes/meters haven't been checked at very narrow widths (the drawer's
      own `@media (max-width: 768px)` handling was left untouched).
- [ ] The skill-tree node tooltip (delta/leaning/passive detail) uses a
      native `title` attribute — functional but not discoverable on touch
      devices with no hover. A real click-to-expand detail popover would be
      nicer if this becomes a frequently-used feature.

## Food durability + real water-body terrain transformation — built, see DESIGN.md

- [x] Direct asks ("make food less durable... force migration" / "water
      sources dry out and refill more during droughts and rain... bigger
      lake/spring bodies might shrink but never run out") both built.
      `CONSUME_STOCK_AMOUNT` 0.25->0.35, `FOOD_LIFESPAN_TICKS` 100->70,
      `FOOD_SPREAD_CHANCE` 0.035->0.025 (flora.ts). New `waterBody.ts`
      (4-connected flood-fill component sizing, cached via
      `World.resourceVersion`) backs a tiered `advanceWaterCycle`: small
      bodies dry at a much faster `1/150` (was a flat `1/500`) and can fully
      vanish; bodies at/above `LARGE_WATER_BODY_MIN_SIZE` (12, picked from a
      real measured size distribution — see DESIGN.md) dry at a much slower
      `1/3000` and are floored at exactly that same threshold so they can
      never run out. `RAIN_WATER_FORM_CHANCE_PER_TICK` settled at `1/1800`
      (lower than the pre-existing `1/1500`) after a first attempt at
      `1/1000` was checked against a real 10,000-tick terrain-only run and
      found to cause worse runaway water growth than before (+20-47%,
      root-caused to ~89% of a real map's water now sitting in the
      slow-drying large-body tier) — `1/1800` brought that back to near
      equilibrium (-2% to +8% over the same window).
- [x] Real correctness bug found and fixed *before* shipping, not after: an
      earlier floor value (6, below the 12-tile large-body threshold) let a
      shrinking lake silently reclassify as "small" once it crossed under
      12 tiles, then dry the rest of the way to 0 at the fast rate — a
      synthetic worst-case unit test (permanent drought, no dissipation)
      caught a 25-tile lake reaching 0 tiles by tick ~2000. Fixed by setting
      the floor equal to the large-body threshold itself, closing the gap
      by construction. See `weather.test.ts`'s dedicated large-vs-small test
      and DESIGN.md's full writeup.
- [x] Real-run validation (stash-based A/B isolating just this feature's two
      files, 3000 ticks, seeds 42/7/20260903): migration-start events rose
      2->10, 2->9, 1->3 across the three seeds — a real, meaningful increase
      in scarcity-driven relocation, this feature's actual goal. Final
      population/births moved in both directions per-seed (butterfly-effect
      sensitivity, not a systematic direction) and zero starvation deaths in
      every run, before and after.
- [x] The user's own direct "keep an eye on it" ask about idle/sated agents
      answered with real sampled numbers (ticks 1000/2000/3000, all 3
      seeds): idle-and-both-needs-above-0.7 fraction of living agents never
      exceeded 11%, mostly well under 5%. See DESIGN.md for the full table
      and two honestly-flagged caveats (not fully isolated from a concurrent
      unrelated tile-occupancy feature also landing in `needs.ts` this same
      session; doesn't itself prove causation vs. the migration-count
      evidence above).
- [ ] **Residual, honestly-flagged edge case, distinct from the bug already
      fixed above:** water-body "large" classification is a stateless,
      current-size-only check with no memory of a body's own history. The
      floor-equals-threshold fix guarantees a large body can't be
      immediately reclassified-then-drained in one continuous exposure, but
      a border-line-sized lake (just above the 12-tile threshold) that
      survives many *repeated* separate droughts over a very long run could
      still, in principle, eventually cross the threshold for good and then
      dry at the fast small-body rate with no more protection. Real
      generated maps' actual major lakes sit well above the threshold
      (34-183 tiles per DESIGN.md's measured distribution), so this mainly
      matters for the handful of borderline 12-30-tile bodies specifically,
      over run lengths well beyond what the performance-ceiling item below
      currently allows a real agent-population run to reach anyway. Real
      persistent per-body hysteresis tracking (not just a per-tick size
      check) would close this fully if it's ever worth the complexity.
- [ ] **A real 8000-tick, 3-seed validation run (this task's own suggested
      upper end) could not be completed** — killed after several minutes
      without finishing, and a follow-up single-seed 5000-tick attempt was
      also killed. Confirmed this is the pre-existing population-driven
      performance ceiling noted elsewhere in this file, not something this
      feature caused (a terrain-only water-cycle run with zero agents
      completed a full 10,000 ticks in ~6 seconds). 3000 ticks per seed
      (~7-10 seconds) is this feature's actual validated range — worth
      revisiting once the underlying population-growth performance ceiling
      is addressed, so a real long-run validation (and a real check of
      whether the residual water-body edge case above ever actually bites)
      becomes practical.

## Tile capacity (weight/headcount limit per tile)

- [x] Hard per-tile capacity, direct ask: surface uses a weight-based rule
      (`TILE_WEIGHT_CAPACITY = 90`, ~3 real average-weight agents, reusing
      `support.ts`'s `bodyWeightOf` convention), underground/canopy use a
      flat `FLAT_TILE_HEADCOUNT_CAP = 5` headcount instead (mid-implementation
      clarification), both with an "empty tile always admits at least one"
      floor. New `packages/engine/src/occupancy.ts`, following
      `herdIndex.ts`'s exact per-tick cache shape.
- [x] Capacity composes with movement/pathfinding — a full tile "routes
      around, same as an obstacle" — but SCOPED to seekWater/seekFood
      (`stepAlongPath`) and exploration wandering only, not hunt/mate
      pursuit, herding, dispersal, migration, herd support, or forced
      movement. See DESIGN.md's "real-run finding that narrowed this scope"
      — capacity-gating those too caused a real, measured population
      regression (up to ~83% on one seed) with zero starvation deaths,
      traced to hunt/mate pursuit misreading ordinary herd density as
      "unreachable."
- [x] Blocked-resource AI: waits `BLOCKED_RESOURCE_GRACE_TICKS` (25) ticks
      near a crowded target, then excludes it and tries the next-nearest
      tile of the same terrain, with a fast-track safety valve into the
      existing `migrate()` escape hatch once every nearby known tile is
      excluded — prevents infinite oscillation between mutually-crowded
      tiles (tested directly). Along the way, fixed a real, initially-missed
      bug: `findLayerWithTerrain` (the underground<->surface water-sharing
      cross-layer check) wasn't threading the exclusion list, letting an
      agent ping-pong layers forever re-discovering the very tile it just
      excluded — caught by the oscillation test, not theorized in advance.
- [x] Real 3000-tick, 3-seed validation (42/7/20260903): zero starvation
      deaths on all three, real contention (max 7-9 simultaneous occupants
      on one seed's tiles, up to ~2 avg per occupied tile), and real
      waiting confirmed (`resourceWaitTicks`:`resourceBlockedFallbackCount`
      ratios of ~48:1 to ~105:1 — agents mostly wait out contention rather
      than instantly relocating).
- [ ] **Honestly-flagged, not chased down further this pass:** seed
      20260903's population dropped much more (249 -> 42, -83%) than its
      own contention numbers would predict (that seed had the LOWEST
      contention of the three: only 3 blocked-fallback events, max 2
      simultaneous occupants). Zero deaths, healthy sampled hunger/thirst
      throughout — this reads as this sim's already-documented chaotic
      seed-sensitivity (a small deterministic tick-order change cascading
      into a large population difference on a seed already flagged
      elsewhere in this file as stubborn/low-growth-prone), not a
      capacity-crowding bug, but pinning that down for certain would need
      its own dedicated event-by-event A/B isolation pass.
- [ ] Underground/canopy's flat headcount cap is unit-tested directly but
      never actually exercised by a real run — neither layer's current
      world generation places its own water/food terrain there (underground
      shares the surface's via the existing redirect; canopy has none at
      all), so real contention on those two layers stays unobserved until
      that changes.

## Grazing scars: sustained heavy grazing degrades a tile — built, see DESIGN.md
- [x] Direct pitch, approved directly ("Yeah that sounds good" — one of three
      environment-shaping ideas offered, alongside trampled paths and
      territory marking). `Tile.grazingPressure`/`Tile.overgrazed`
      (types.ts), accumulated via `flora.ts`'s new `recordGrazing` at both
      real consumption sites (needs.ts self-feeding, support.ts herd
      food-delivery pickup), decayed every tick in `growFlora` regardless of
      terrain. Crossing a hysteresis-gated threshold suppresses (not zeroes)
      germination/maturation and outright refuses spread onto the scarred
      tile, self-fading back to normal once grazing pressure decays with
      real rest. New `floraChanged` stages (`"overgrazed"`/`"recovered"`),
      filed as `NOISE_KINDS` ambient bookkeeping like the rest of
      `floraChanged`. 9 new `flora.test.ts` tests, 652 engine tests total,
      all passing including the unmodified determinism acceptance test.
- [x] First tuning pass was measurably too weak (only 3 tiles ever went
      overgrazed across a real 3-seed 3000-tick run) — retuned against that
      same real data (slower decay, lower threshold) to 9/20/1 tiles
      overgrazed across the same 3 seeds, zero starvation deaths on all
      three, confirmed via a real feature-on/feature-off A/B (not just
      before/after correlation) that the effect is real and attributable.
      See DESIGN.md for the full numbers and the diagnosis of why the first
      pass under-fired.
- [ ] **Real follow-up, not built**: no distinct map/renderer treatment for
      an overgrazed tile — it still looks like ordinary floor. Worth
      revisiting if scars turn out common enough in practice to be worth a
      glyph/tint, once `packages/web`'s tile renderer is being touched for
      something else anyway.
- [ ] **Real follow-up, not built**: migration correlation was only tested
      indirectly (herdMigrating event counts, not a controlled trigger).
      This session's own herdMigration.ts already has a `"scarcity"` trigger
      driven by local food availability, not directly by `Tile.overgrazed` —
      an overgrazed tile currently only discourages migration *indirectly*,
      by starving out the scarcity check's food-availability read. Wiring
      `Tile.overgrazed` as a direct migration-scoring input (the way
      `MigrationReason` already has room for a dedicated reason string) is a
      real, un-built next step if grazing scars turn out to need a stronger
      migration nudge than the indirect path currently gives them.
- [ ] Seed 7's overgrazing events all clustered in the last ~700 of 3000
      ticks (tracks that seed's late population boom, not chased down as a
      suspected bug — see DESIGN.md's "Explicitly not done" for this
      feature) — flagged, not resolved, same as this file's other
      honestly-reported-but-unconfirmed seed-specific observations.

## Pack hunting, scavenging, and ontogenetic niche shift — built, see DESIGN.md

- [x] Three real-biology behaviors, all approved directly ("Pack hunting
      sounds good. Scavenging is good. Ontogenic too."), built as real
      levers against this file's own repeatedly-documented predator
      fragility (see the bullet above). Pack hunting
      (`predation.ts`'s new `isPackPreyOf`/`nearbySameSpeciesConspecifics`/
      `committedPackmates`/`packAccuracyMultiplier`) is the existing
      defensive mob-fighting pattern flipped to offense: a real,
      positioning-driven trigger (a genuine nearby same-species conspecific
      has to exist) unlocks hunting a target too strong to solo, with a real
      accuracy-bonus mechanical advantage threaded through `resolveHit`.
      Scavenging (`support.ts`'s new `applyScavenging`) is a real
      alternative meal — feeding directly from a nearby corpse, restoring
      hunger by the same established amount `applyHerdSupport`'s food
      delivery already uses, cashing in the corpse-persistence window this
      session inherited from an earlier feature. Ontogenetic niche shift
      (`predation.ts`'s new `isJuvenile`, reusing `Agent.age` the same way
      `reproduction.ts`'s `isMature` already does) makes a juvenile predator
      never initiate an independent hunt at all — solo or pack — leaning
      entirely on scavenging/herd food delivery instead, plus a real,
      earlier flee-threshold vulnerability difference. 18 new engine tests,
      681 total, all passing including the unmodified determinism acceptance
      test — zero new `Math.random()`/`rng()` call sites added.
- [x] Each mechanism proven working in a dedicated, hand-built stress
      scenario (this project's own "targeted scenario, not just a longer
      demo run" standard): pack hunting real-kills a too-strong-to-solo
      target once real packmates are nearby (12 `packHunt` events, 1 kill,
      in a 3-scyther stress scenario); scavenging restores real hunger from
      a real corpse (0.1 -> 0.887 hunger in 2 ticks); a juvenile and an
      adult in the identical hungry-predator-next-to-prey setup diverge
      exactly as designed (juvenile never hunts, adult hunts and kills).
- [ ] **Honest real-run finding, not papered over**: a real 3000-tick,
      9-seed sweep (42, 7, 20260903, 1-6) found `packHunt` firing on only
      1 of 9 seeds (14 times) and `scavenged` on only 3 of 9 (4-28 times) —
      both mechanisms are real and working, but rarely get a chance to fire
      in the *stock* demo scenario specifically because
      `packages/data/src/scenario.ts` spawns exactly ONE individual of each
      predator species with no `herdId`, so pack hunting's own trigger
      structurally can't fire until a second same-species predator exists
      nearby (only reachable via reproduction — itself gated behind the same
      fragile predator population this feature targets). Predator
      populations did NOT reliably recover — several seeds still ended at 0
      living predators. The 3 seeds with real pack/scavenge activity did end
      with more living predators (1, 3, 2) than the zero-activity seeds (1,
      1, 0, 0), a real, honestly-reported correlation, but not treated as
      proven causal here — this sim is independently, repeatedly documented
      elsewhere in this file/DESIGN.md as rng-trajectory-chaos-sensitive, and
      a clean feature-on/feature-off A/B was considered and not run for that
      same reason (see DESIGN.md's full writeup).
- [ ] **Real follow-up, not built**: seed the demo scenario with 2 of each
      predator species instead of 1 (or give predators their own home-range
      cohesion so offspring stay near a parent), specifically to give pack
      hunting's own trigger a fair chance to fire in the stock scenario
      rather than only in a hand-built stress test. Not attempted this
      session — changing the demo scenario's spawn composition is its own
      real design decision with its own validation burden, out of scope for
      the direct ask here.
- [ ] **Real follow-up, not built**: kleptoparasitism (contention/priority
      between multiple scavengers over the same corpse) — the original
      brief's own "nice-to-have, not required." The existing
      `CORPSE_PERSIST_TICKS` window already lets multiple agents feed from
      the same corpse across separate ticks, which was judged enough for the
      direct "alternative to a risky hunt" ask.

## Tile preference: satisfied idle agents drift toward their species' terrain — built, see DESIGN.md

- [x] Direct ask, verbatim: "Like tile pref. Like bulbasaur should strongly
      prefer flora tiles. Squirtle should prefer water. If their needs are
      met." A new `SpeciesDef.preferredTerrain?: TerrainKind[]` field
      (denormalized onto `Agent.preferredTerrain` at spawn/birth, same
      three-hop pattern as `activityPattern`/`buildsShelter`), consulted
      inside `needs.ts`'s existing idle-wander extension point
      (`applyExploration`) ahead of its pre-existing random-unvisited-tile
      search: a tagged, satisfied agent heads toward its nearest matching
      terrain instead of a uniformly random nearby spot, and goes fully idle
      (no wander at all) once already lingering near it. An untagged
      species, or a tagged one with nothing reachable, falls straight
      through to the original random-wander behavior, unchanged. Roster
      tagging: bulbasaur/venusaur -> flora, squirtle -> water, charmander/
      mankey -> sunbeam, scyther -> bush, geodude/growlithe -> boulder;
      diglett/sandshrew/pidgey/spearow/onix deliberately left untagged
      (underground/canopy are flat, terrain-uniform grids — nothing
      meaningful to prefer among, see DESIGN.md's point 5 for the full
      per-species reasoning).
- [x] `resourceIndex.ts`'s `IndexedTerrain` extended with `"flora"`
      (justified the same way `"shelter"` was — 2+ real consumers); a
      preference kind tagged by only one species (`"bush"`, `"boulder"`)
      uses a new bounded local scan instead of extending the global index
      further. 7 new engine tests, 688 total, all passing including the
      unmodified determinism acceptance suite — zero new rng call sites
      added (the preference lookup is a pure deterministic nearest-tile
      search).
- [x] Real 3000-tick, 3-seed (42/7/20260903) feature-on/feature-off A/B via
      an isolated instrumented script: average distance from a tagged
      agent to its nearest preferred tile dropped on ON vs OFF across all
      3 seeds overall (3.70->2.96, 3.20->3.07, 4.92->3.43), and
      consistently for Bulbasaur specifically (the brief's own named
      example: 3.06->2.32, 3.10->2.66, 4.77->3.35) — see DESIGN.md for the
      full per-species table and the honest Venusaur-is-mixed caveat (herd
      cohesion dominates tile preference for the roster's almost-always-
      solo guardian).
- [ ] **Real follow-up, not built**: "we could add more tile types" (the
      brief's own explicitly optional, vague half). Nothing cheap and
      obviously missing presented itself for the *current* roster — every
      species with a real flavor-text terrain affinity already maps onto
      an existing `TerrainKind`. The one real idea worth flagging: a real
      "burrow"/underground-den terrain kind distinct from plain `"floor"`,
      giving Diglett/Sandshrew a genuine tile preference of their own
      instead of relying solely on `buildsShelter`'s homing pull — would
      require generating real terrain variance into `worldgen.ts`'s
      currently-flat underground grid, its own real design decision with
      its own validation burden. Not attempted this session.
- [ ] **Real follow-up, not built**: Venusaur's mixed A/B result (worse on
      1 of 3 seeds, essentially flat/better on the other 2) traced to herd
      cohesion (`applyHerdCohesion`, checked before `applyExploration`)
      dominating tile preference for a species that's almost always alone
      in guardian position — not a bug, but worth a closer look if herd
      cohesion and tile preference priority are ever revisited together.

## Bonding, shelter, and eggs — built, see DESIGN.md

- [x] Universal shelter: `SpeciesDef.buildsShelter`/`Agent.buildsShelter`
      no longer gate any shelter mechanic in the engine (species-tied ->
      universal, a deliberate reversal of the earlier direct instruction) —
      the field is left in place, unused for gating, purely legacy/cosmetic
      denormalization. Per-species visual variation instead:
      `Tile.shelterOwnerSpecies` + `packages/web/src/palette.ts`'s new
      `shelterOwnerTint` (deterministic per-species hue), wired into both
      of `renderer.ts`'s draw paths.
- [x] Real shelter-specific capacity: `occupancy.ts`'s
      `SHELTER_TILE_ADULT_CAP` (2) / `SHELTER_TILE_EGG_CAP` (1), layered on
      top of (not replacing) the existing weight/headcount tile-capacity
      system — shelter terrain routes through a new
      `canEnterShelter`/`canLayEggAt` pair instead. Adjacent shelter tiles
      form one connected cluster (`shelterCluster`, 4-directional BFS)
      whose capacity is the sum of its members' own caps, and household
      members range across the whole cluster rather than being pinned to
      one tile.
- [x] Bonding replaces instant offspring: `reproduction.ts`'s
      `applyMateSeeking` sets `Agent.bondedPartnerId` on first contact
      instead of spawning a child; `spawnOffspring` deleted entirely (its
      logic moved to `eggs.ts`'s hatch step). A bonded, shelterless agent
      gets a real, unit-tested comfort-threshold discount
      (`BOND_COMFORT_DISCOUNT`, 0.15) biasing it toward starting a shelter
      build sooner than an unbonded agent at the same needs.
- [x] Real eggs: new `eggs.ts` module (`spawnEgg`/`tickEgg`,
      `EGG_INCUBATION_TICKS = 80`). Egg-laying only once the household has
      real shelter access with egg-capacity room; the egg is a real `Agent`
      (`isEgg: true`), stationary and behavior-less (routed straight to
      `tickEgg` by `simulation.ts`, skipping the ordinary needs/action
      pipeline entirely); nature/disposition/sex/stat-block assignment
      moved from lay time to hatch time.
- [x] Eggs as food: `predation.ts`'s `applyEggEating` — any species that
      doesn't share an egg group with the egg (reusing `canBreed`) can eat
      an adjacent egg once hungry enough (`EGG_EAT_HUNGER_THRESHOLD = 0.9`),
      restoring hunger/granting exp via the exact same `grantKillExp`/
      hunger-restore path a real kill uses. Deliberately NOT routed through
      the `HuntRules` predator/prey pipeline — a real, explicit widening of
      who eats what, independent of a species' predator/prey role.
- [x] Extreme egg defense: `predation.ts`'s `applyEggDefense`, checked
      first in `applyPredationInstincts` — ahead of the critically-hurt
      flee check — overriding a defender's ordinary flee/self-preservation
      entirely (and waking it if asleep) to fight a threat near its own/its
      herd's egg, resolving via the real true-death combat path
      (`resolveHit(..., "killed", ...)`). A real, explicit, documented
      departure from herdConflict.ts's non-lethal rivalry model, not an
      accidental softening of it.
- [x] Fixed a real, latent bug this feature surfaced: universal
      shelter-building didn't check `agent.asleep`, letting a sleeping
      agent silently start a shelter task and skip the sleep wake-check
      machinery entirely — now gated on `!agent.asleep`, same as every
      other self-directed task in `needs.ts`'s `tickAgentAction`.
- [x] Fixed a real, latent test-hygiene bug this feature surfaced: an
      unrestored `vi.spyOn(Math, "random")` in `needs.test.ts` could pin
      `Math.random` for every later test in the same file once shelter-
      building's default `rng` param started actually calling it (it never
      had before, since shelter-building was species-gated) — added a
      file-level `afterEach(() => vi.restoreAllMocks())`.
- [x] New tests: `eggs.test.ts` (hatch timing/profile backfill/
      rng-determinism, egg-eating's full compatibility matrix, egg-defense
      overriding ordinary flee), `occupancy.test.ts`'s new shelter-capacity
      describe block, `shelter.test.ts`'s universal-triggering and
      bonded-discount cases, a full rewrite of `reproduction.test.ts`'s
      bonding/egg assertions, and a replaced `determinism.test.ts`
      reproduction section (lay-time is now deterministic; hatch-time
      nature/sex is the real rng-swept case). 720 total engine tests, all
      passing, including the unmodified full-`tickWorld` determinism
      acceptance suite.
- [x] Real headless validation, seeds 42/7/20260903: a real, honestly-large
      reduction vs. a completely-uninstrumented instant-birth baseline at
      3000 ticks (298/332/294 living -> 23/19/24 living) — but a real,
      GROWING curve, not a stalled one: seed 42 alone goes 23 -> 56 -> 94
      living across 3000/6000/8000 ticks, with 88 eggs laid and 82 hatched
      (93% survival) by tick 8000, zero starvation deaths at every tick
      count on every seed, and egg-defense firing 181-187 times over the
      longer runs — a real, frequently-exercised mechanic. See DESIGN.md
      for the full numbers and the honest "the baseline itself is a
      pathological comparison point" context.
- [ ] **Open follow-up, not chased down**: the exact growth-rate pacing
      (80-tick incubation, 0.85/0.70 shelter comfort thresholds, 0.9
      egg-eating hunger gate) is a real, legitimate tuning target — the
      population trend is proven growing and zero-starvation (the load-
      bearing safety property), but whether it reaches this session's
      previously-cited "healthy" 62-80ish range fast enough, or should grow
      faster, wasn't further hand-tuned this pass. A longer (10000+ tick)
      run, or a dedicated re-tuning pass on any of those three constants,
      would be the way to actually chase this further.
- [ ] **Open follow-up, not investigated**: dispersal interacting with a
      bonded-but-shelterless pair — a disperser keeps a `bondedPartnerId`
      pointing at an agent it may now be far away from (or that joined a
      different herd), with nothing currently clearing or re-validating a
      stale bond across a dispersal event.
- [ ] **Open follow-up, not investigated**: egg-defense's interaction with
      herd-conflict's non-lethal model — whether a rival-herd, same-egg-
      group agent can ever get caught in both systems' overlapping radii on
      the same tick.
- [ ] **Open follow-up, not investigated**: adjacency-capacity edge cases
      beyond the direct unit tests — a shelter cluster that grows or shrinks
      (new tile built, or an existing one abandoned) while an egg is already
      incubating inside it, against a real run rather than a synthetic test.
- [x] **Clutch size follow-up** ("maybe we can have multiple eggs spawn at
      once instead of one at a time"): `eggs.ts`'s `pickClutchSize(rng)`
      draws 2-4 eggs per successful laying event; `reproduction.ts`'s
      `applyMateSeeking` places as many as the existing shelter-cluster
      egg-capacity (`canLayEggAt`/`SHELTER_TILE_EGG_CAP`) actually allows,
      dropping the rest of the clutch rather than queuing or cramming it
      onto one tile. Everything downstream (incubation/hatching/egg-eating/
      egg-defense) verified to already work per-egg with no changes needed.
      New tests in `eggs.test.ts`/`reproduction.test.ts`; 717 engine tests
      pass, `pnpm -r typecheck`/`build` clean. See DESIGN.md's "Follow-up:
      clutch size" subsection for the full writeup.
- [ ] **Real, load-bearing follow-up surfaced by the above, not fixed
      here (out of scope for "let clutches vary")**: the clutch mechanism
      currently has near-zero effect on real population in the actual demo
      world, because `shelter.ts`'s `pickBuildSite` picks a uniformly
      random floor tile with no bias toward existing shelter — confirmed
      directly that every real shelter cluster across all three validation
      seeds at 8000 ticks stayed exactly 1 tile, so `SHELTER_TILE_EGG_CAP`
      (1/tile) capped every real laying event to at most 1 egg regardless
      of the clutch size drawn. If clutch size is meant to actually move
      the population needle (not just work correctly in isolated tests),
      the real next lever is biasing shelter-site selection toward building
      adjacent to an agent's own existing shelter when it has one, so
      multi-tile clusters actually form in a real run.
- [ ] **Open follow-up, not done**: `packages/runner/src/ascii.ts`'s own
      terrain palette (the headless CLI's rendering, separate from
      `packages/web`) was not given the same per-species shelter tint —
      real, known, cosmetic-only gap.

## Auto Camera — built, see DESIGN.md

- [x] Toggleable "Auto Camera" mode (`packages/web/src/autoCamera.ts` +
      `main.ts` wiring): follows immigration, courtship (bonded/
      shelterBuilt/eggLaid as three separate moments), egg hatching,
      battles (start-to-death-or-retreat), evolution, and true deaths;
      zooms in to 150% (`AUTO_CAM_ZOOM`, follow-up-adjusted down from the
      original 200%), and scopes the event log to exactly that moment's
      participants. Playback slowdown is now category-conditional: a battle
      always drops to 0.25x real slow-motion regardless of the viewer's
      current speed (`AUTO_CAM_BATTLE_SLOWDOWN_SPEED`, a direct follow-up
      ask), while every other category keeps the original 2x-from-4x+-only
      behavior (`AUTO_CAM_SLOWDOWN_SPEED`/`SLOWDOWN_THRESHOLD_SPEED`). See
      DESIGN.md's "Follow-up" subsection for the reasoning and Playwright
      verification of both changes.
- [ ] **No camera easing/animation.** Both the zoom change and the scroll
      reposition are instant (a plain `scrollLeft`/`scrollTop` assignment,
      no CSS transition) — a deliberate choice for this pass (see
      DESIGN.md: instant assignment is what makes telling "our own scroll"
      apart from "the viewer's real scroll" exact rather than a timing
      guess), but it means the actual visual cut is a hard jump, not a pan/
      zoom animation. A real fix would need a different manual-vs-auto
      scroll detection strategy (e.g. a short "ignore scroll events for
      N ms after we animate" window, or an `IntersectionObserver`-free
      alternative) before smooth easing could be added safely.
- [ ] **Battle camera doesn't account for multiple simultaneous fights.**
      Two unrelated pairs fighting at the same time correctly become two
      separate queued `Engagement`s (never merged — `findBattle` only
      widens an existing engagement when a hit's ids actually overlap it),
      but the *first* one to engage holds the camera/slowdown for its full
      run before the second ever gets shown, even if the second is (by some
      measure) the more dramatic fight. No "which fight is more interesting"
      heuristic exists — first-come-first-served only, same as every other
      queued engagement (see DESIGN.md's "no interruption" reasoning) — an
      accepted simplicity tradeoff, not an oversight, but worth revisiting
      if multi-fight scenes turn out to be common on the real demo map.
- [ ] **The `BATTLE_STALE_TICKS`/`BATTLE_EPILOGUE_TICKS`/`DWELL_TICKS`
      constants are reasoned-about but not empirically tuned** — chosen
      from reading the relevant tick-rate/behavior code, not from watching
      dozens of real runs and adjusting. A real live-observer session
      (human, not headless) would be the way to tell if 24 ticks feels too
      short/long for a one-shot moment, or whether 40 ticks of silence is
      the right disengagement threshold for a real fight's actual pacing.
- [ ] **Herd-vs-herd `herdClash` skirmishes with more than two active
      participants** (a scrum, not a clean 1v1) aren't specially handled —
      each `attacker`/`defender` pair that lands a hit becomes/extends one
      `battle` engagement via `findBattle`'s overlap check, so a genuine
      multi-agent brawl could end up as one engagement whose `ids` set
      quietly grows to several agents (camera focus averages all of their
      live positions) rather than being recognized as "a brawl" with its
      own distinct camera treatment (e.g. zooming out slightly to fit more
      combatants instead of staying at the fixed two-agent-appropriate
      `AUTO_CAM_ZOOM`). Works, reads reasonably in practice (confirmed via
      the throwaway verification's pack-hunt-adjacent scenario reasoning
      in DESIGN.md), just not a bespoke "brawl" camera mode.
- [ ] Real in-browser visual polish unverified beyond the one manual
      Playwright smoke run recorded in DESIGN.md (a single seed, one
      battle observed) — a longer real-time watch session across several
      seeds, actually looking at the zoomed-in view rather than just
      asserting on DOM state, would be the next real check.

## Battle Screen — built, see DESIGN.md

- [x] A second, differently-formatted view of Auto Camera's currently-
      followed event (`packages/web/src/battleScreenPanel.ts`), styled like
      a mainline Pokémon battle text box: a "vs" header with live HP bars for
      a followed battle's combatants, a scrolling turn-by-turn log (move
      used, crit/effectiveness callouts, damage, HP remaining, fainting/
      retreat/conclusion), and a single flavor-text scene line for every
      other notable category (hatch/evolution/immigration/death). Coexists
      with the plain event log's existing auto-cam filter rather than
      replacing it.
- [x] **Follow-up: merged into the Inspector panel as a tab, not a second
      docked panel** — the standalone `#battle-screen-panel` (and its own
      Hide/Show toggle) is gone; "Battle Screen" is now a second tab inside
      `#inspector-panel`, next to "Inspector" (`#tab-inspector`/
      `#tab-battle-screen` in its `.panel-header`), toggled via `main.ts`'s
      `selectTab` — pure visibility switching, neither `renderInspector` nor
      `BattleScreenPanel` changed at all. Auto-switches to Battle Screen the
      moment a new battle engagement starts, but a manual switch back to
      Inspector sticks for the rest of that same battle (mirrors Auto
      Camera's own manual-view-override pattern) — see DESIGN.md's
      "Follow-up" subsection for the full interaction-model writeup and
      Playwright verification.
- [ ] **No effectiveness callout when the defender agent's already been
      pruned.** "It's super effective!"/"not very effective" is computed
      client-side via the engine's own exported `typeEffectiveness` against
      the *live* defender `Agent.types` — if that agent's already left
      `world.agents` (its corpse-persistence window elapsed) by the time a
      frame renders, the callout is silently skipped rather than guessed.
      Rare in practice (the defender is almost always still present while
      its own battle is the actively-followed one), but a real gap; fixing
      it would mean snapshotting the defender's types onto the engagement
      the moment the hit event fires, rather than reading them live.
- [ ] **No client-side smoothing on the HP bar.** `Agent.hp` can carry float
      noise from elsewhere in the engine's combat math (partial-tick
      effects) — display-rounded for the bar/label, but the bar itself still
      jumps in whatever-sized steps the underlying hits actually dealt, no
      CSS transition beyond the fill's `width` easing already provides.
      Acceptable for now; a "damage taken" flash/shake on the losing side's
      HP bar specifically (distinct from the existing per-line text flash)
      would be a nice further polish pass if this feature gets revisited.
- [ ] **`+N more` for a >2-participant battle (pack hunts, herd brawls)
      doesn't show who the extra participants are** — just a count, no
      names/HP. The "vs" header assumes a clean 1v1 (reads the first two ids
      in insertion order, which are reliably the original attacker/defender
      even after widening — see `Engagement.ids`' insertion-order comment in
      autoCamera.ts), matching the same "not a bespoke brawl camera mode"
      simplicity call the Auto Camera TODO above already made for the actual
      camera framing.
- [ ] Real in-browser visual polish (the CSS-only crit/kill flash
      animation's actual timing/feel, the HP bar's color-threshold
      transitions) only spot-checked via Playwright DOM assertions, not an
      extended human eyes-on-it watch session — same standing caveat the
      Auto Camera section above already carries for its own zoom/pan feel.

## Species-dependent shelter ease and egg-defense lethality — built, see DESIGN.md

- [x] Predators (`Agent.isPredator`, newly denormalized from
      `SpeciesDef.isPredator` at spawn/egg-lay) trigger shelter-building at a
      lower comfort threshold (`PREDATOR_COMFORT_DISCOUNT`, 0.15, stacks with
      the existing `BOND_COMFORT_DISCOUNT`) and finish construction in half
      the ordinary time (`PREDATOR_BUILD_TICKS_MULTIPLIER`, 0.5, via new
      `builderShelterTicks(agent)`) — direct ask: "predators should have it
      easier to make shelter."
- [x] A predator's own critically-hurt flee check now runs BEFORE
      `applyEggDefense` in `applyPredationInstincts` (reverse of the
      universal ordering every other species still gets) — a badly hurt
      predator flees instead of unconditionally fighting to the death over
      its egg; a predator that isn't critically hurt still defends normally
      afterward. When a predator does fight, the outcome logs as
      `"defeated"` instead of `"killed"` — direct ask: "maybe they don't
      have the protect to death mentality with it."
- [x] New tests (`shelter.test.ts`/`eggs.test.ts`): predator-vs-non-predator
      trigger-threshold and build-tick comparisons, bonded-predator
      double-discount stacking, non-predator-still-fights-to-real-death
      baseline (unchanged), predator-fights-non-lethally-labeled,
      critically-hurt-predator-flees-instead-of-fighting. 725 engine tests
      pass, including the unmodified determinism acceptance suite (no new
      `rng()` calls introduced). `pnpm -r typecheck`/`build` clean across
      all 4 packages.
- [x] Real headless validation, seeds 42/7/20260903, 3000/6000/8000 ticks:
      predator population (Scyther/Onix/Spearow + evolutions) up on 6 of 9
      seed/tick combinations, including every seed-42 checkpoint (1/0/1 ->
      8/9/9) and seed 7's later ticks (2/0 -> 7/5) — flat or slightly down
      on the other 3. Zero starvation deaths on every seed/tick after this
      change (was 2/2/4 on seed 7 before). A real event-log check confirms
      the new predator-specific egg-defense branch actually fires in real
      runs (4/4 and 16/58 of that seed's total `eggDefended` events had a
      predator defender). See DESIGN.md for the full table and the honest
      "raw seed comparison isn't a clean isolated A/B in this chaotic
      system" caveat.
- [ ] **Real, honestly-reported side effect, not tuned against**: total/prey
      population is meaningfully lower after this change on 2 of 3 seeds at
      8000 ticks (a plausible, mechanistically-expected trade-off — more
      surviving predators means more sustained hunting pressure — not a
      bug). If a future pass judges this trade too aggressive, re-tuning
      `PREDATOR_COMFORT_DISCOUNT`/`PREDATOR_BUILD_TICKS_MULTIPLIER` down is
      the flagged next step, not reverting the feature.
- [ ] **Open follow-up, not done**: a predator's `"defeated"` egg-defense
      outcome only changes the EVENT LABEL today, not actual survivability —
      `resolveHitAgainstTarget`'s death branch sets `alive = false`
      regardless of `faintKind`. A genuinely can't-die predator egg-defense
      fight would need to reuse `herdConflict.ts`'s separate, HP-floor-
      clamped `resolveRivalryHit` resolver instead of `predation.ts`'s own
      faint/finishing-pool combat — not attempted this pass.
- [ ] **Open follow-up, not done**: no third lever (e.g. a shorter
      `SHELTER_MIN_BUILD_DISTANCE` for predators) was added on top of the
      two shipped (comfort discount + build-tick halving) — judged
      sufficient and validated as such, but a real option if more predator
      ease is wanted later.

## Rapport: agent-to-agent relationship graph — built, see DESIGN.md
- [x] Sparse `Agent.rapport?: Record<string, RapportEdge>` (score -1..1,
      `lastInteractionTick`), lazy read-time decay (`RAPPORT_DECAY_PER_TICK`
      = 0.9977, ~300-tick half-life), prune-on-touch below
      `RAPPORT_PRUNE_THRESHOLD` (0.02), and a hard per-agent cap
      (`RAPPORT_MAX_EDGES_PER_AGENT` = 16) with real weakest/stalest-first
      eviction (rng-tie-broken, threaded from `world.rng`).
- [x] Fed by four real, existing trigger events (not invented ones): herd
      food delivery (+0.03 both ways), joint mob-defense — the guardian
      branch of `applyPredationInstincts` (+0.06 both ways), bonding
      (+0.6 both ways, a real jump not an incremental nudge), and
      herd-conflict clash hits between the same two individuals (-0.06 both
      ways, never herd/species-wide).
- [x] Two real consumers: mate preference (`reproduction.ts`'s `mateScore`
      gains a `RAPPORT_DISTANCE_BONUS` = 3 discount term alongside the
      existing `STATUS_DISTANCE_BONUS`) and herd-conflict targeting/
      escalation (`herdConflict.ts`'s `findRivalOccupant` biases toward an
      existing grudge target, `herdConflictChance` gains a
      `HERD_CONFLICT_GRUDGE_SCALE` = 0.4 re-escalation bonus).
- [x] 20 new engine tests, all 745 engine tests passing including
      determinism.test.ts unmodified. Real 5000-8000-tick runs (seeds 42, 7,
      20260903) confirm the graph stays genuinely bounded (max 9 edges on
      any one agent across all three runs, cap of 16 never actually reached)
      and both consumers do real, measurable work — see DESIGN.md's
      "Rapport" section for the full numbers.
- [ ] **Honest finding, not a bug in this feature**: `foodDelivered` fired
      0-1 times total across all three 8000-tick validation runs —
      `applyHerdSupport`'s own real-run gate (well-fed, non-threatened,
      carry headroom, a hungry herd-mate in range) is apparently rare to
      satisfy in this sim's actual population dynamics. Bonding and
      herd-clash are this graph's two real workhorse triggers in practice,
      not food delivery. If herd food delivery itself ever gets a real-run
      tuning pass to fire more often, this rapport channel gets more real
      signal for free — not something to chase specifically for rapport's
      sake.
- [ ] **Open follow-up, not done**: extend rapport into natal dispersal — an
      agent with strong existing bonds inside its herd should plausibly
      resist leaving (a real discount on `dispersal.ts`'s own trigger
      chance/threshold), the mirror of what this pass already did for mate
      preference.
- [ ] **Open follow-up, not done**: egg-defense willingness scaling with
      rapport toward the egg's other parent/herd-mates — not attempted this
      pass; `applyEggDefense`'s current model is unconditional ("defend to
      death") regardless of any relationship.
- [ ] **The actual next step this foundation exists for, per direct
      discussion with the user**: the eventual player-as-a-node recruitment
      mechanic — a player builds real rapport with individual agents (the
      same graph, the player just becomes another id it can hold edges
      toward), and which specific herd members actually want to join a
      player's team depends on that real relationship, not just herd
      membership. Explicitly NOT built in this pass — no player/UI concept
      exists in this codebase yet. This TODO entry is the flagged
      breadcrumb for when that work starts; see also the "Player / bonding
      (deprioritized until sim depth lands)" section above, which this
      eventually supersedes/merges into once real UI work begins.

## Notables: rare, earned individual titles — built, see DESIGN.md

- [x] Seven global record-holder titles (hero/builder/gatherer/rival/
      beloved/elder/wanderer), `World.notables`/`Agent.notableTitle`,
      one-per-agent, checked once per tick (`notables.ts`'s
      `updateNotables`), `titleClaimed`/`titleLost` `SimEvent`s,
      `NOTABLE_XP_MULTIPLIER` = 1.5x, `NOTABLE_DISTANCE_BONUS` = 2.5 mate
      preference, and web UI identity/herd-name rendering. 12 new engine
      tests, all 802 engine tests passing including determinism.test.ts
      unmodified. Real 8000-tick runs (seeds 42, 7, 20260903) — see
      DESIGN.md's "Notables" section for the full calibration/validation
      numbers.
- [ ] **Open follow-up, not done**: The Beloved counts hatched offspring,
      not longest continuously-bonded mate relationship — a real,
      documented tradeoff (see DESIGN.md), not revisited here. A bonded
      pair that never clears this sim's real bond -> shelter -> egg pipeline
      currently can't earn this title at all no matter how long the bond
      itself lasts.
- [ ] **Open follow-up, not done**: no map-tile visual badge/icon for a
      title-holder — only the text-based inspector/event-log/battle-screen
      identity strings change; `renderer.ts`'s per-agent map drawing itself
      is untouched.
- [ ] **Open follow-up, not done**: no `titleClaimed` Auto Camera one-shot
      moment — `autoCamera.ts`'s `NotableCategory` union wasn't extended
      with an eighth category, so a title changing hands doesn't get its
      own camera cut the way a birth/evolution does (still visible in the
      event log panel like every other event).
- [ ] **Open follow-up, not fully resolved**: Wanderer's real-run numbers
      show it dominates total title transfers across all three validation
      seeds (it's the one title with effectively unbounded headroom — a
      living agent can always in principle set a new personal-best
      distance, unlike a bounded-by-death age/kill/build record). The
      threshold was already retuned once (30 -> 60 tiles) after a real run
      caught a worse, now-fixed bug (a live-distance version churned
      constantly on ordinary back-and-forth wandering — see DESIGN.md). A
      future session may want a required-margin-over-incumbent rule (beat
      the record by some real amount, not just by one tile) if this proves
      too active once watched over a longer real run.

## Herd Leadership: a notable can lead its herd — built, see DESIGN.md

- [x] `herdLeadership.ts`'s `updateHerdLeadership` (promotion/demotion,
      seniority tie-break via new `NotableRecord.claimedAtTick`, the
      deliberate no-churn guarantee) and `effectiveDisposition`
      (`LEADERSHIP_DISPOSITION_BLEND_WEIGHT` = 0.2), `World.herdLeaders`/
      `Agent.isHerdLeader`, `leadershipClaimed`/`leadershipLost` `SimEvent`s,
      six per-individual disposition call sites swapped to
      `effectiveDisposition` (predation.ts x3, herdConflict.ts,
      dispersal.ts, reproduction.ts), herdMigration.ts's herd-aggregate
      wanderlust factor blended toward its leader too, and web UI leader
      marker (🎖️)/leader-named-herd rendering. 12 new engine tests, all 814
      engine tests passing including determinism.test.ts unmodified. Real
      8000-tick runs (seeds 42, 7, 20260903) — see DESIGN.md's "Herd
      Leadership" section for the full calibration/validation numbers; no
      churn issue found (closest successive-leader gap in any seed was 25
      ticks, from a real dethroning cascade, not flapping).
- [ ] **Open follow-up, not done**: leadership seniority tracks tenure under
      an agent's CURRENT title only, not a broader "ever eligible" history —
      an agent that lost one title and later claimed a different one starts
      a fresh seniority clock even though it was arguably "eligible" the
      whole time under whichever title it held. A real, acknowledged
      simplification (see DESIGN.md), not revisited here.
- [ ] **Open follow-up, not done**: no map-tile visual badge for a herd
      leader, same gap Notables' own title-holder follow-up already named —
      `renderer.ts`'s per-agent map drawing is untouched.
- [ ] **Open follow-up, not done**: no `leadershipClaimed`/`leadershipLost`
      Auto Camera one-shot moment, mirroring Notables' own `titleClaimed`
      Auto Camera follow-up (still visible in the event log panel either
      way).

## Auto Camera battle-log follow-up (done — see DESIGN.md)

- [x] Prioritize a queued/starting battle over whatever else is active or
      queued.
- [x] Replace continuous 0.25x slow-motion with genuine one-tick-at-a-time
      stepping (`BATTLE_STEP_INTERVAL_MS`).
- [ ] Open: retune `BATTLE_STEP_INTERVAL_MS` (currently 650ms) once actually
      watched for real — no real-run/visual feedback on this exact value
      yet, it's a first guess.

## Player-recruitment design notes (exploratory, unbuilt — see DESIGN.md)

- [ ] Four bonding verbs locked in by direct discussion: feed, fight-
      alongside, **rescue** (the new special/high-stakes one — carry to
      safety or craft/apply medicine when the target is critically
      hurt/dying), and presence (demoted to lowest-priority/fourth). None
      of the four have any code yet — this is design-only.
- [ ] Rescue implies two real, unscoped follow-ups if ever built: (a) a new
      narratable "critically hurt/near death" moment (nothing in the engine
      currently distinguishes this from an ordinary low-HP tick), and (b) a
      crafting/medicine system for the "heal it" half.
- [ ] Overworld "faking"/region abstraction (simulate a compact per-region
      summary off-screen, reconstruct a plausible live grid on visiting) and
      the "notables vs. anonymous population" split it implies — still
      fully deferred, not started; captured here only so the design
      reasoning isn't lost.

## Combat/species tile-sharing (done — see DESIGN.md)

- [x] Combat approach (hunt/mob-fight/egg-defense/guardian-defense/forced-
      movement lunge) never steps an attacker onto its target's exact tile.
- [x] General same-species-only tile sharing on every non-shelter tile
      (`occupancy.ts`'s `canEnterTile`), shelter kept as the deliberate
      any-species exception.
- [ ] **Open, honest follow-up, not attempted**: the species rule above only
      gates ordinary *movement* — it doesn't retroactively separate agents
      already co-located from two other placement paths: (a) `leveling.ts`
      evolving an agent's species in place (no movement, no occupancy check
      at all), and (b) `immigration.ts` spawning a fresh arrival via
      `findWalkableNear` with no capacity/species check (a deliberate,
      already-existing exemption — see DESIGN.md's "Tile capacity" section
      for why immigration is intentionally capacity-blind). A real 3000-tick
      seed-42 run showed a handful of stable different-species pairs from
      exactly these two paths (an evolved `ivysaur` next to a `pidgey`, a
      `wartortle` next to its own hatched offspring). Fixing this would mean
      either (a) making evolution check/resolve tile-sharing at the moment
      species changes, or (b) giving immigration spawn placement a
      species-aware fallback search — both real, scoped pieces of work, not
      attempted here given immigration's documented history of regressing
      hard when given any capacity gate at all.

## Web: varied/animated tile art and floor lighting texture (done)

- [x] Web: varied/animated tile art — 7 tree variants, 2 boulder variants,
      4 bush variants, 2 wall variants (all hash-selected per tile, stable
      across frames), animated water (4 real wave-animation frames found
      already drawn in the source sheet, phase-offset per tile so the
      whole lake doesn't flash in unison), and a subtle floor texture
      (cave-floor + dirt-path crops, picked per 4x4 tile block, drawn
      under the existing "." glyph at low opacity scaled by elevation) so
      plain floor gets some varied lighting without becoming a loud fill.
      All art from legacy-cpp's "building and lake sprites.png" plus a few
      clean crops out of "biome sprites unripped.png" (a set of pre-
      composed scene panels, not a tile grid, so most of it isn't cleanly
      croppable — a low-color-variance auto-scan was used to find flat
      patches, then hand-verified since it initially grabbed a fake
      "lava" patch that was just a flat red background block, not real
      lava art).
      **Two real mistakes caught mid-pass, not just the lava one**: (1) my
      own index-to-pixel-coordinate transcription for several of the
      building-sheet floor crops was simply wrong — `floor_cave`,
      `floor_grass_1`, and `floor_grass_2` were all actually pointing at
      the same tan brick "shop counter" prop (with little feet baked in),
      not the pink cave-floor/green-grass/gray-stone tiles they were
      named for; re-derived all three from a fresh pixel-precise grid
      overlay and confirmed each visually before re-saving. (2) mixing
      the (correctly-fixed) grass/stone crops into the floor variant pool
      alongside cave/dirt reintroduced the original hue-clash problem
      (green/gray patches next to brown ones), so they're deliberately
      NOT in `FLOOR_TEXTURES` — kept as loose files for a possible future
      biome-specific floor system instead. Direct ask ("we still need the
      dirt floor tiles, there are plenty") added 3 real dirt-path crops
      from the biome sheet's dirt/mushroom-forest panel to the pool
      (same brownish family as the cave crops, so it blends).
- [ ] **Open follow-up, not done**: shelters still render as a flat
      per-owner-species-tinted rect (`shelterOwnerTint` in palette.ts) —
      now visibly crude next to the real tile/tree/water art around them.
      Would need actual shelter/hut sprite art (not yet extracted) plus a
      way to apply the existing owner tint on top of a sprite instead of a
      solid fill.
- [ ] **Not wired up, sitting in public/tiles/ for later**: `floor_desert`
      and `floor_snow` — clean, real textures pulled from the biome sheet's
      desert/snow scene panels, but there's no desert/snow `TerrainKind`
      or biome system yet, so nothing selects them today. `floor_lava` was
      also attempted from the same sheet but turned out to be a fake — a
      flat solid-red background block, not textured lava art — and was
      deleted rather than used.
- [x] Web: real berry-plant art for "food"/"flora"/"seedling" tiles, direct
      ask ("do we have any berries? or other plants?"). Ripped from
      legacy-cpp's "berry sprites.png" — a growth-stage sheet (each berry
      has small/medium/ripe stages, 2 idle-sway animation frames per
      stage, ~64 berries in dex order across 4 labeled blocks) that hadn't
      been touched at all before this. Grid pitch turned out to be an
      irregular ~23x35px (not the 32x32 every other sheet in this pack
      uses) — found via black-gridline detection (`np.all(arr<40,...)`)
      rather than guessed. Ripe-stage art is now keyed by the real flavor
      names flora.ts already assigns (`FOOD_FLAVORS`/`FLORA_FLAVORS`:
      cheri/oran/pecha/sitrus for food, moss/fern/bloom for flora) so a
      given tile's flavor always draws the matching plant, not a random
      one; "seedling" (pre-flavor-assignment) hash-varies across all 7
      instead. Drawn as an overlay on top of the existing flavor-tinted
      color-mix fill (not a replacement), opacity scaled by the tile's own
      `stock` so a depleting patch still visually thins out. Real Pokémon
      dex-color accuracy wasn't chased (e.g. this sheet's "oran" slot reads
      gray/rock-textured, not blue) — picked for visual distinctness
      instead, since the flavor names are this codebase's own internal
      labels, not a promise of canon fidelity.
- [x] Web: three more visual polish passes, all direct asks. (1) Trees/
      bushes had a flat colored ground-ellipse or full-square background
      baked into the source crop, which read as a hard rectangle sitting
      on top of the actual floor underneath instead of blending into it.
      Fixed by exact-color-keying the shared 3-tone base-ellipse palette
      ((108,203,112)/(74,176,81)/(43,139,53), confirmed identical across
      every affected sprite) to transparent — safer than the geometric
      row-cutoff/flood-fill attempts tried first, both of which either
      left visible remnants or ate into the tree/trunk itself (tree_7
      specifically: a fixed-fraction cutoff sliced straight through its
      trunk since the trunk and base ellipse occupy the same row range).
      Also caught mid-pass: `boulder_2` was never actually the boulder it
      claimed to be — still the wrong crop (a tree/reed cluster on a flat
      blue square) from an earlier session, re-extracted from the sheet's
      real second boulder; `bush_2`/`bush_3` were a full square, flat-
      green-background crop with no isolated ground patch to key out at
      all, so they were swapped for a different pair of small trees from
      elsewhere on the sheet that do have a proper keyable oval base.
      (2) Water edges are now real per-side directional shorelines, not
      the earlier binary "bordered vs. seamless" tile choice — the
      seamless interior fill draws first, then a strip cropped from the
      bordered source art (`getWaterEdge`) is composited on top of just
      the side(s) whose actual neighbor isn't water (`renderer.ts`'s 4
      cardinal `ctx.drawImage` calls with source-rect cropping), so a
      tile inside a lake shows no border whatsoever and a shore tile only
      shows sand on the side(s) actually facing land. (3) Floor texture
      went through two wrong extremes before landing right: per-4x4-tile-
      block variant selection made every block boundary a visible seam
      ("random square chunks... don't feel like the beautiful biome
      art"); reacting to that, a single map-wide texture removed the
      seams but then just looked like the same tile stamped everywhere
      ("same tile over and over can look bad"). Landed on per-INDIVIDUAL-
      tile selection among the same 6 earthy crops at low opacity — real
      tilesets do exactly this (scattered near-identical variants read as
      natural grain at small scale/low contrast; only a hard-edged
      multi-tile block of one texture reads as "chunks").
- [x] Post-merge polish pass, direct ask ("some of the tiles have weird
      shadow on them to make look like beveled. Some of the color
      matching isn't great. And I feel like the biome pic had way more
      beautiful variety"). Three real, distinct causes found and fixed,
      not just one tuning knob: (1) `floor_cave_3` had a dark diagonal
      crack baked into its crop from a bad extraction boundary — clean at
      small scale/low opacity, but glaring once `drawGroundBacking`
      (merged in from the sibling branch) started drawing floor texture
      at near-full strength everywhere; re-cropped clean. (2) the
      per-tile radial vignette (also from that merge) had a genuinely too
      -strong edge-darkening term — a bright-center/dark-edge gradient
      repeated on every tile is, by construction, a grid of embossed
      tiles; cut its highlight/shadow strength and max alpha by roughly
      two-thirds rather than removing it outright, since "silly simulated
      lighting" was itself a real prior ask. (3) `floor_cave` (the
      original building-sheet crop) was a measurably different, more
      pink/saturated hue than the other 5 crops (checked via actual mean
      RGB, not eyeballing) — dropped from the pool, and two more crops
      from the same clean source panel added in its place so variety went
      up (5 -> 7) while every texture in the active pool now averages
      within a few RGB points of the others.
- [x] Floor rendering redesigned again, direct ask: "layer texture atop
      the base tiles... some of em have semi transparent texture to add
      to balance and variety." Replaced N discrete full-strength floor
      textures competing tile-to-tile (still its own kind of patchwork
      even once hue-matched) with one consistent base texture
      (`getFloorTexture`, now parameterless) drawn everywhere, plus a
      sparse (1-in-4 tiles) semi-transparent decal on top
      (`getFloorOverlay`, 0.35 alpha) picked from the other 6 crops —
      the standard real-tileset move (solid ground + light scattered
      detail) instead of several competing base choices. Applied in the
      one shared `drawGroundBacking` helper, so floor/objects-on-ground/
      food-flora-seedling all get the same base+decal treatment
      consistently.
- [x] Floor decal shape/density follow-up, direct ask ("maybe to round...
      border radius", "double the amt"). The overlay decal was a bare
      square PNG stamp, reading as a hard-edged tile; `featheredOverlayStamp`
      now renders each decal image through a cached offscreen canvas
      (`roundRect` mask + `blur(1.5px)` + `destination-in` compositing)
      into a soft rounded-rect blob before it's ever drawn, and the
      per-tile decal frequency doubled (1-in-4 -> 1-in-2 tiles). Reused
      as-is for the fertile-patch decal below.
- [x] Soil fertility mechanic, direct ask ("can we decal a little green
      patch under the plants?... simulate the ground underneath the
      plants becoming fertile for growing stuff.. with intermediate
      states... tying into grazing scars but able to show it" +
      follow-up: "this limits how flora can spawn. I don't want to make
      it too much harder to spawn and ruin population growth. But make
      it take time for the soil to be able to accommodate life. And...
      Pokémon that help, like watering it via water moves and
      tilling/planting it via grass type help"). New `Tile.fertility?:
      number` (0-1) in the engine, distinct from the existing
      grazing-scar system (that punishes over-consumption; this models
      ordinary recovery time after ANY harvest). Key design choice:
      `undefined` fertility means fully fertile (1.0) — every world-gen
      floor tile starts here, so this cannot make the initial population's
      first growth cycle harder by construction, not by tuning. Only set
      to a real, lower value (0.35) in `flora.ts`'s `growFlora` once a
      food/flora patch on that tile actually dies; climbs back to 1 on
      its own (`+0.005`/tick, ~130 ticks to fully recover — comfortably
      inside one food-patch lifecycle) or faster with real Pokémon help:
      a Water-type move's hit-landing puddle (`waterSoil`, called from
      predation.ts's existing `terrainFill` site — Water Gun already
      creates puddles, so a real puddle now also "waters" the ground) or
      a live Grass-type agent simply standing on the tile, every tick
      (`tendSoil`, called from `needs.ts`'s per-tick `tickAgentNeeds`, no
      new move/intent plumbing). Fertility probabilistically (not a hard
      gate — "reduce, don't ban," same shape as the overgrazed multiplier)
      throttles both seed-drop germination chance and neighbor-tile
      spread in `flora.ts`; deliberately left seedling maturation speed
      alone to avoid stacking a second penalty on top of the existing
      overgrazed slowdown. Visually: `renderer.ts` draws a green
      `getFertilePatch()` decal (reusing `featheredOverlayStamp` above)
      under every food/flora/seedling tile, opacity `0.15 + fertility *
      0.4`, so a freshly-harvested patch reads faint and a fully-fertile
      one reads vivid — "tying into grazing scars but able to show it"
      made real rather than a `grazingPressure`-proxy stand-in. 42 new/
      updated engine tests (flora/predation/needs), full suite green
      (one `support.test.ts` failure confirmed to be a pre-existing
      order-dependent flake unrelated to this change — passes 36/36 in
      isolation).
- [ ] **Open follow-up, not done**: fertility has no "intermediate states"
      of its own beyond the single continuous 0-1 float + one decal
      opacity ramp — no distinct terrain/sprite stages (e.g. "bare dirt"
      -> "sprouting" -> "lush") the way seedling growth or grazing scars
      get their own terrain kinds. Revisit if the single smooth ramp ends
      up reading as too subtle in actual play.
- [x] Plant quality, direct ask ("fully fertile plant gives super higher
      quality berries and such. But they don't need to be fully fertile to
      produce it. And fully fertile plants tend to survive noticeably
      longer and produce more"). New `Tile.quality?: number` (0-1) in the
      engine — a fixed trait frozen onto a food/flora patch the moment it
      matures in `flora.ts`'s `growFlora`, sampling whatever the tile's
      live `fertility` happens to be right then (`undefined` behaves as
      quality 1, same convention as `fertility` itself, so ordinary
      never-harvested-before growth is unaffected). Drives three real,
      independently-floored effects, none of which can crush a patch to
      uselessness even at quality 0: (1) **yield** — starting `stock`
      scales from 70% to 100% of `FOOD_MAX_STOCK` (`yieldFactor`) — "don't
      need to be fully fertile to produce it"; (2) **lifespan** — decay
      rate scales ±40% around neutral (`decayFactor`), applied to both
      food and flora patches — "survive noticeably longer"; (3)
      **nutrition** — a new `foodNutritionFactor(tile)`, read from
      `needs.ts`'s actual feeding site, scales the real hunger restored by
      a feeding ±30% around neutral — "super higher quality berries."
      `quality` is cleared back to `undefined` when a patch dies, so the
      next thing that grows on that tile gets its own fresh quality
      sampled from fertility at that later maturation, not a stale
      leftover value. 15 new tests across `flora.test.ts` and
      `needs.test.ts`; one pre-existing decay-tuning test
      (`flora.test.ts`'s "dies of natural decay meaningfully sooner")
      needed an explicit neutral `tile.quality = 0.5` to stay isolated
      from this new effect, since it hand-builds a tile without going
      through `growFlora`'s maturation path. Full repo suite green
      (845/845 engine, 19/19 data).

## Generative History phase: macro elevation + rivers — built, see DESIGN.md

- [x] `worldgen.ts`: replaced the old small-scale noise-based `elevation`
      field with `generateMacroElevation` (seeded uplift/basin influence
      points, distance falloff, normalized + percentile-calibrated sea
      level) for real land/ocean/mountain-range coherence, plus
      `carveSuicuneRivers` (steepest-descent flow from real elevation
      maxima to the coast, forming beaches or inland lakes). First built
      slice of the "Overworld generation vision" section — two processes
      out of the full documented list. 819 engine tests (5 new) passing,
      determinism intact, real 3-seed 6000-tick population-health check
      clean.
- [ ] **Next slice candidates**, in the order they'd most naturally build on
      what's here now (not a commitment, just the honest "what's next" per
      the vision doc's own sequencing note):
  - **Tectonics/glaciers** — the vision's next listed process, and the most
        natural literal extension of macro elevation: mountain *ranges*
        with real linear/arc structure (a plate-boundary shape) instead of
        today's radially-symmetric uplift blobs. Would plug into the exact
        same `generateMacroElevation` seam this slice built.
  - **Forest-seeding (Xerneas/Celebi)** — the first "a route/path is the
        causal reason a biome exists here" process, structurally similar to
        this slice's river-carving (a path-walk that leaves a lasting mark
        on the tile grid), so the river-carving machinery
        (`carveRiver`/`NEIGHBOR_OFFSETS`/steepest-descent-shaped walks) may
        be directly reusable/adaptable rather than written from scratch.
  - Both of these are real candidates, not decided — picking 2-3 for an
        actual next slice is a separate deliberate step, same as this one
        was.
- [ ] **A real blocker for anything built directly on top of this**: this
      slice generates one single map exactly as before — it does not touch
      the "multi-region overworld" system the vision describes at all.
      Any future process whose vision write-up assumes multiple stitched
      regions (most of them, past the land/ocean + rivers pair built here)
      will need that system to exist first, or will need to be scoped down
      to "one region" the same way this slice was.
- [ ] `MACRO_INFLUENCE_RADIUS_FRACTION` (0.22) and `OCEAN_FRACTION` (0.44)
      were tuned only by "does it look like real coherent continents" +
      "does the sim stay healthy," the same ad hoc standard every other
      tuning constant in this codebase gets on a first pass — a real
      dedicated tuning pass (more seeds, maybe a numeric "does this look
      speckled vs. blobby vs. coherent" metric instead of eyeballing ASCII
      dumps) is still open.
- [ ] River-terminated-in-an-inland-lake gets no beach marker (only a true
      ocean mouth does) — see DESIGN.md's "Explicitly not done here" for
      this slice. Minor, but a real, named gap if lake shorelines matter
      later.

## Water-crossing restrictions — built, see DESIGN.md

- [x] `waterBody.ts`'s `canEnterWater`: non-water types can wade a large
      water body's shore (to drink) but not cross its interior; small
      ponds stay fully unrestricted for everyone; water types are always
      unrestricted. No Rock/Fire-specific stricter tier (an earlier draft
      had one, corrected by direct user feedback before landing). Always-on
      across every real movement/pathfinding call site, including
      capacity-blind hunt/mate pursuit. `needs.ts`'s `seekWater` gained a
      bounded reachability-aware retry (`findReachableWaterTarget`) so a
      thirsty land Pokémon targets a real reachable shore instead of a
      geometrically-nearer-but-unreachable interior tile. 863 engine tests
      (13 new) passing twice in a row, determinism intact, real 3-seed
      6000-tick population-health check clean (no landlocked-collapse
      regression after fixing a real bounded-retry bug the validation
      itself surfaced).
- [ ] **No graduated wading depth.** Every large body is exactly two zones
      for a non-water type — shore (one tile) or impassable — never an
      intermediate "can wade N tiles in." Could matter later for a
      species-specific "strong wader" trait.
- [ ] **No swimming-speed penalty/bonus.** Water types (and anyone wading
      a shore tile) move through water at the same one-action-tick pace as
      dry land. A real "water types move faster through water" mechanic
      would be a natural, separate follow-up.
- [ ] **No large-lake-vs-ocean distinction** beyond the existing
      `isLargeWaterBody` tile-count threshold — treated identically by this
      rule. Could matter if "landlocked lake" vs. "the ocean" ever needs to
      mean something different gameplay-wise.
- [ ] **No in-sim workaround for a non-water type stuck on the wrong
      shore** — no raft, no temporary water-walking move/ability, nothing.
      A real, intentional gap if "how does a stranded land Pokémon ever
      cross" becomes a real question later.
- [ ] `findReachableWaterTarget`'s retry bound (`WATER_REACHABILITY_MAX_ATTEMPTS`
      = 24) was picked empirically against this session's three validation
      seeds (42, 7, 20260903), not derived from real coastline geometry — a
      much more convoluted coastline, or a much larger minimum "large water
      body" threshold, could in principle need a higher bound before
      finding a real reachable shore. Not stress-tested past the seeds used
      here.

## Obligate-aquatic restrictions (Magikarp/Tentacool) — built, see DESIGN.md

- [x] `species.ts`'s new `obligateAquatic?: boolean` flag; `magikarp` and
      `tentacool` added to the curated roster (both were dex-only before)
      and flagged, both reusing an existing move, both with no leveling.ts
      data change needed (egg-group headroom already existed). Denormalized
      onto `Agent.obligateAquatic` at spawn, mirrored on `LevelingProfile`
      for bred offspring, and copied straight from mother to egg — the same
      three-place propagation `isPredator`/`buildsShelter` already use.
- [x] `waterBody.ts`'s new `canEnterLand` — the land-side mirror of
      `canEnterWater`: an obligate-aquatic agent can flop onto the
      immediate shore ring but nothing deeper onto land; a regular
      (non-flagged) Water-type is completely unaffected. Wired into the
      same shared `isWalkableFor`/`firstWalkable` choke points the
      water-crossing feature already built, so every real call site both
      features share is covered for free.
- [x] Two real reachability bugs found and fixed via this session's own
      multi-seed validation (not just unit tests) — see DESIGN.md's "Built,
      real-run findings" for the actual before/after numbers: (1) `seekFood`
      had the exact same "geometrically nearest isn't reachable" trap
      `findReachableWaterTarget` already existed to fix for water, just
      never extended to food — fixed with a new `findReachableFoodTarget`;
      (2) `immigration.ts` was placing obligate-aquatic arrivals via
      `findWalkableNear` (any walkable tile, water included, as an equally
      valid hit), sometimes stranding them on dry land the instant they
      arrived — fixed by routing obligate-aquatic arrivals through
      `resourceIndex.ts`'s `findNearestIndexed(..., "water", ...)` instead,
      plus a new `scenario.ts` `findWaterNear` helper so the demo world's
      own founding pair is placed on real water on every seed, not just the
      one it was eyeballed against.
- [x] 874 engine tests (11 new) passing twice in a row, determinism intact,
      real 3-seed 6000/10000-tick validation clean — no
      thirst-starvation after the fixes, a modest residual
      hunger-starvation rate honestly reported (not eliminated further —
      see below).
- [ ] **Only Magikarp and Tentacool got the flag.** Horsea/Seadra,
      Staryu/Starmie, Goldeen/Seaking (all real dex entries, none curated
      roster species yet) would plausibly all qualify on the same
      real-biology standard whenever they're actually added as roster
      species — not added this session; see DESIGN.md's "Decided" section
      for the per-species reasoning that would apply. Gyarados/Tentacruel
      likewise aren't their own curated entries — they inherit the flag
      automatically as evolutions of the two that are.
- [ ] **The flag doesn't reset on evolution** — an evolved Gyarados stays
      obligate-aquatic even though real Gyarados can fly. Same accepted
      scope `buildsShelter`/`preferredTerrain` already carry (denormalized
      at spawn, not re-derived on evolution), not a new gap.
- [ ] **Real, scoped, NOT done: a worldgen fix for shore-ring food
      scarcity.** The 10000-tick validation found a modest residual
      hunger-starvation rate (roughly one death per seed) traceable to a
      real scarcity of "food" terrain within an obligate-aquatic agent's
      actual reachable range (water + one-tile shore ring) — the
      reachability-retry logic itself is correct (`findReachableFoodTarget`
      finds whatever food genuinely exists in range), there's just not
      always much of it there. A worldgen change biasing food density to
      spawn more reliably within an aquatic species' reachable shore ring
      (same spirit as this session's placement fixes, just for food
      instead of agents) would directly address this. Not attempted this
      session — the observed impact at the population sizes validated
      (1-3 aquatic agents per seed) never approached collapse, so a
      worldgen change touching every species' food placement wasn't judged
      worth the risk without a larger aquatic population to re-validate
      against. A real follow-up, not a punt on an unexamined risk.
- [ ] **No graduated wading distance** for either direction of this
      restriction — exactly one tile of shore, no per-species variation
      (matches the water-crossing feature's own identical scope note).
- [ ] **No dedicated aquatic breeding population validated at scale.**
      Magikarp and Tentacool don't share an egg group, so the demo world's
      founding pair can never breed with each other — every population
      number in DESIGN.md's validation comes from immigration, not
      reproduction. A real same-species breeding pair (e.g. a second
      Magikarp of the opposite sex) was not added or validated this
      session.
