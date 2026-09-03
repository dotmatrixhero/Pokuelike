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
- [ ] **Guardian positioning gap**: a guardian's `findHerdmateInDanger`
      check works, but guardians only ever hang out near their own spawn
      area (the water hole), while the herd forages clear across the map
      near the food patch — so by the time a guardian notices a herd-mate
      fleeing and gives chase, the kill happens before it can cross the
      distance. Fix target: guardians should patrol nearer the herd's
      actual grazing range, not just sit at one fixed spot.
- [ ] **New, unplanned finding: unconstrained reproduction blows up.** Two
      Venusaur (nothing preys on them) went from 2 to 52 individuals over
      1000 ticks, and `venusaur-0` (the founding male) fathered most of
      that growth including with his own daughters/granddaughters — no
      relatedness/inbreeding check exists in `reproduction.ts`, and
      nothing caps population for a species with no predator. This is the
      mirror image of the Bulbasaur extinction: predation-free species
      need *some* population-limiting force (carrying capacity tied to
      food availability? territory limits? age-based mortality?) or they
      grow without bound. Not fixed — worth deciding the mechanism
      deliberately rather than bolting on a random cap.
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
- [ ] Herd cohesion: agents share `herdId` in the type but nothing groups or
      regroups them yet. Flocking forces? A shared "home range" center each
      herd member biases toward? — still open, unrelated to predation below.
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
- [ ] Herd cohesion: agents share `herdId` in the type but nothing groups or
      regroups them yet. Flocking forces? A shared "home range" center each
      herd member biases toward? — still open, unrelated to predation.
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
