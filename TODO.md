# TODO / Side Notes

Running list of ideas and decisions to revisit — not a sprint plan, just a
place to park trains of thought so they don't get lost.

## Priority: sim depth + observability (current focus)

Per DESIGN.md's north star — the sim needs to be able to run headless and
produce a real story before player mechanics are worth building further.

- [ ] Headless sim runner (no renderer, no player) that ticks the world N
      times and exits — the thing that makes "run it and tell me a story" a
      real, repeatable request instead of a one-off script.
- [ ] Event log with semantic content, not state diffs: births, deaths,
      herd relocations, predation, resource depletion — enough for a
      narrator (human or Claude) to summarize as a story, not just replay
      positions.
- [ ] Once the above exist: actually run it, read the log, and see if
      anything in it is a story worth telling. If not, that's a sim-depth
      problem to fix before anything else.
- [ ] Now that layers/elevation (below) are built ahead of this: run the
      headless runner + event log against the current multi-layer,
      single-region engine and see if anything in it is worth narrating.

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
      herd member biases toward?
- [ ] `seekMate` / mating behavior not implemented — what does a "mating"
      outcome even do (spawn a new agent? just a behavior with no mechanical
      effect yet)?
- [ ] `hunt` / `flee` behaviors named but unimplemented — predator/prey
      relationships need a data source (which species hunt which).
- [ ] Resource depletion — water/food tiles are infinite right now. Real DF
      feel probably wants them to deplete and regenerate, driving migration.
- [ ] Performance ceiling for the cheap tier — how many agents before naive
      per-tick nearest-tile search (`findNearestTerrain` is O(width*height)
      per agent!) needs spatial indexing?

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
- [ ] The "promotion boundary" transition itself (see DESIGN.md) — not
      designed yet, just named.
- [ ] Move leveling/respec system — how builds are earned, spent, reverted.
- [ ] Status effects (burn, etc.) — `burnChance` exists in move tuning data
      but nothing consumes it.
- [ ] Turn-based vs. real-time-with-pause for combat — undecided.
- [ ] Facing/direction for the player during combat — how is it chosen?

## Art / assets
- [ ] Sprite pipeline is bring-your-own (`packages/web/public/sprites/`) —
      decide on sprite sheet format/size once real art exists.
- [ ] Tile art vs. the current flat-color terrain rendering.

## Infra
- [ ] No lint/format config yet (eslint/prettier) — add once the codebase
      is bigger than "does it typecheck."
- [ ] No CI yet.
