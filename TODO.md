# TODO / Side Notes

Running list of ideas and decisions to revisit — not a sprint plan, just a
place to park trains of thought so they don't get lost.

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
- [ ] **No personal-space/repulsion behavior, and no idle-wander after a
      need is satisfied — the actual remaining cause of tile-stacking.**
      Traced after the spawn-position and map fixes above only partially
      helped: herd cohesion (`herding.ts`) only ever pulls an idle agent
      *toward* the herd centroid when it's far away; there's no term that
      pushes agents apart when they're already close together. Worse, once
      an agent finishes eating/drinking it has no reason to leave that
      tile — no idle-wander behavior exists — so a resource tile that
      works becomes a permanent gathering point instead of a stop. Fix
      target: (a) a mild repulsion force in `applyHerdCohesion` when two
      herdmates are on the same or adjacent tile, and (b) idle agents with
      full needs should wander a random walkable tile occasionally instead
      of standing still forever.
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
- [ ] **Phases 2 (day/night cycle) and 3 (spatial weather) of the same
      DESIGN.md section are still just decided, not built** — deliberately
      left for a follow-up pass sequenced after Phase 1 landed, to avoid
      colliding with its edits to `herdMigration.ts`/`herding.ts`/
      `events.ts`. Phase 3 in particular plugs into Phase 1's generalized
      trigger system (a `"weather"` migration reason for storm-driven
      shelter-seeking), so it can't start before Phase 1 exists.
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
- [ ] Evolution as a dispersal trigger: a Disposition-weighted chance to
      leave the herd and seek a mate elsewhere on evolving — real biology
      (natal dispersal/inbreeding avoidance), and the concrete reason the
      world-graph/region-migration idea above would actually get used.
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
- [ ] **Evolution mechanism is engine-tested but never observed in a real
      run** — the honest gap, not a hidden one. Bulbasaur->Ivysaur needs
      2535 cumulative exp (level 16, Medium Slow); a real run's income rate
      put that on the order of 25,000-30,000 ticks, and runs past ~3000-5000
      ticks risk timing out entirely on the sim's pre-existing unbounded
      population growth (see below) before getting anywhere near that many
      ticks. Either the non-combat exp trickle amounts need to be
      meaningfully larger, or evolution needs a dedicated short scenario
      (spawn one exp point below a threshold, tick once) instead of relying
      on emergent long-run behavior to actually witness it.
      **Reconfirmed** while adding the Spearow/Onix expansion above: a
      10000-tick run (this time actually completing, unlike the timed-out
      5000-tick attempt referenced elsewhere) still topped out at level 8
      for every agent across all species/lines — the new lines hit the
      same ceiling as Bulbasaur, not a species-specific issue.
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
