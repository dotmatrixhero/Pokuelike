# TODO / Side Notes

Running list of ideas and decisions to revisit — not a sprint plan, just a
place to park trains of thought so they don't get lost.

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
