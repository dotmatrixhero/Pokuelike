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
      Inbreeding is still also unaddressed (the founding male fathering
      his own descendants) — a separate, smaller fix (track parent/
      offspring or sibling pairs, exclude them as mates) once the bigger
      population-control question is settled.
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
- [ ] Performance ceiling for the cheap tier — how many agents before naive
      per-tick nearest-tile search (`findNearestTerrain` is O(width*height)
      per agent!) needs spatial indexing? Also now true of `growFlora`'s
      full-grid scan every tick.

## Culture, disposition, and roles (pitched, not built — see chat)
- [ ] Disposition vector per individual (boldness/aggression/sociability at
      minimum) driving AI decisions, distinct from canon Nature (stat bias
      only). Herd "culture" (fight-or-flee threshold, etc.) should be a
      computed aggregate of member dispositions weighted by role/rank, not
      a stored per-herd flag — same shape as the region-level promotion-
      boundary aggregate, one level down.
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
      with STAB/type-effectiveness. See DESIGN.md's combat section. Still
      no *individual* variance within a species (no Disposition, no Nature
      applied yet — same species+level = identical stats), which is what
      the rest of this section is about.

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
- [ ] Move `accuracy` field exists but isn't consumed — every move
      currently hits. No miss chance yet.
- [ ] Move leveling/respec system — how builds are earned, spent, reverted.
      The shape axis (point/line/cone/ring/burst) still isn't connected to
      predation.ts's single-target-only combat — AoE moves among wild
      agents (who gets hit by a cone?) is a separate, real feature, not
      built.
- [ ] Status effects (burn, etc.) — `statusChance` exists on move data but
      nothing consumes it.
- [ ] Turn-based vs. real-time-with-pause for combat — undecided.
- [ ] Facing/direction for the player during combat — how is it chosen?
- [ ] No individual stat variance yet (no Nature, no IV/EV-equivalent) —
      same species+level always produces identical stats. See the
      Disposition/culture section above for the intended individuality
      layer once this matters.

## Art / assets
- [ ] Sprite pipeline is bring-your-own (`packages/web/public/sprites/`) —
      decide on sprite sheet format/size once real art exists.
- [ ] Tile art vs. the current flat-color terrain rendering.

## Data import
- [ ] Bulk species/stats import from a PokeRogue-derived data source
      (user has a fork, `dotmatrixhero/poke_the_spire`) — blocked this
      session because this session's GitHub access is locked to just this
      repo and the `add_repo` tool isn't available to widen it (tried both
      the user's fork and the canonical `pagefaultgames/pokerogue`, same
      wall either way). Next attempt: either a session with that repo
      attached from the start, or the user pastes the relevant data
      file(s) directly.

## Infra
- [ ] No lint/format config yet (eslint/prettier) — add once the codebase
      is bigger than "does it typecheck."
- [ ] No CI yet.
