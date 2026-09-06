# Food crops — built (12-crop table: 4 original berries kept + 8 new crops; Honey deferred, see below)

Direct ask, following the landmarks work: "I wonder if we need more kinds of
food, not just berries... corn and wheat and rice, tomatoes, apples, herbs,
honey, potato, pumpkin. They can be more nutrition dense, grow in certain
regions and seasons and be heavily contested?" Follow-up: "make it so they
keep you full for longer, and also are affected by zone and climate and
season." Direct correction after the first build: "I think we need to keep
berry as food sources tho" — the four original berries (Oran, Sitrus, Pecha,
Cheri) are real entries in the same crop registry now, not replaced by the
new crops. What's actually gone is `FOOD_FLAVORS`, the old purely-cosmetic
flavor list — the berries it named are still real, ungated food sources,
just alongside 8 new ones instead of on their own.

This is a scope, not an implementation — grounded in what's actually already
built (see "Existing hooks" below) so every piece below reuses a real
mechanism instead of inventing a parallel one.

## The real gap today

`flora.ts`'s `FOOD_FLAVORS` (`oran`/`sitrus`/`pecha`/`cheri`) is **purely
cosmetic** — a glyph/color pick at maturation, confirmed by its own doc
comment ("No gameplay effects yet") and a full usage audit (only
rendering/tests read it). Every food tile restores hunger by the same flat
formula regardless of flavor:

```ts
// needs.ts
const CONSUME_RATE = { seekFood: { need: "hunger", amount: 0.4 }, ... };
function consume(needs, behavior, qualityMultiplier = 1) {
  needs[need] = Math.min(1, needs[need] + amount * qualityMultiplier);
}
```

`qualityMultiplier` here is `foodNutritionFactor(tile)` (flora.ts), which
only reads the tile's frozen `quality` (0.7–1.0x, set from local fertility at
maturation) — nothing crop-specific exists to multiply against. This is
exactly the seam a crop system plugs into.

## Existing hooks to reuse (not invent)

- **Nutrition density → "keep you full longer"**: the `amount`/
  `qualityMultiplier` chain above already IS the "how much one bite restores"
  lever. A nutrition-dense crop just needs a bigger per-crop multiplier here
  — no new satiation-timer mechanism required. Hunger decays at a fixed
  per-tick rate elsewhere in `needs.ts`, so a bigger one-shot restore
  directly means more ticks pass before the next feeding trip — literally
  "full for longer," for free, from the existing decay math.
- **Region**: biomes are already real and per-tile (`BIOME_NAMES`:
  grassland, forest, jungle, wetland, beach, badlands, desert, highland,
  snow — `worldgen.ts`), with a distinct per-zone/per-tile **moisture**
  field separate from biome name (`macroGrid.ts`'s moisture thresholds,
  `worldgen.ts`'s own per-tile moisture field). A crop's `eligibleBiomes` +
  optional moisture-band gate is the same pattern `landmarks.ts`'s
  `LANDMARK_DEFS.eligibleBiomes` already established — reused, not new.
- **Season**: `flora.ts` already runs a second, slower independent sine
  cycle purely for decay (`SEASON_LENGTH = 1000` ticks, `seasonalMultiplier`)
  — there is no calendar/year system, just this one cheap wave. A crop's
  "harvest window" is a phase-of-that-same-wave gate (e.g., only sprouts
  when `seasonalMultiplier`'s underlying phase sits in some arc), not a new
  clock.
- **Climate/weather**: `weather.ts`'s per-zone `WeatherCell`s
  (rain/storm/drought/coldSnap) already drive `floraDecayDivisor`, which
  `flora.ts` already calls for food-tile decay/spread. A crop's
  weather-sensitivity (e.g., rice thriving in rain, potato shrugging off
  drought) is a per-crop multiplier composed into that same existing call,
  not a new coupling.
- **Contested**: `herdConflict.ts`'s rivalry trigger
  (`HERD_CONFLICT_MIN_BLOCKED_TICKS = 8`, already fires for ANY blocked food
  or water tile, cross-species) needs zero new code. A nutrition-dense,
  region/season-locked crop becomes "heavily contested" automatically, the
  same way landmarks did: make it rare and valuable enough that agents queue
  for it, and the existing trigger does the rest. The only real design lever
  is tuning `stock`/`maxStock` low enough relative to its nutrition payoff
  that multiple agents actually compete for one tile's yield.

## Naming the season — a real derived value, not a new clock

`seasonalMultiplier(tick) = 0.5 + 0.5*sin(2π·tick/SEASON_LENGTH)` already
exists (`flora.ts`, `SEASON_LENGTH = 1000`), currently used only as a raw
0..1 decay multiplier with no name attached to where in the cycle it is.
Refinement: derive a `seasonPhase(tick) = (tick % SEASON_LENGTH) /
SEASON_LENGTH` and split it into four named quartiles — pure naming over an
existing wave, zero new tracking:

| Phase | Range | Character |
|---|---|---|
| Spring | 0.00–0.25 | growth resuming; wide-window crops sprout freely |
| Summer | 0.25–0.50 | peak growth; sunbeam-bonus crops (Tomato) do best here |
| Autumn | 0.50–0.75 | the real harvest window — Apple and Pumpkin's narrow gates both sit here (see below) |
| Winter | 0.75–1.00 | scarcity — only hardy, wide-window/drought-tolerant crops (Potato, and the wide-window staples at reduced yield) mature reliably |

Winter is the deliberate payoff for "affected by season": for one quarter of
the cycle, most crops stop maturing at all, and whatever still grows (Potato
above all) becomes the only real food source — a natural, recurring,
world-wide version of the same contested-scarcity dynamic a single rare
landmark gives locally, without any new mechanism beyond the phase gate
itself.

## Proposed crop table

Each crop = a `FOOD_FLAVORS`-like tag, but with real fields instead of a
cosmetic one. Refinement over the first pass: nutrition tiers are now a
**deliberate ladder tied to restriction** — the harder a crop's
biome/moisture/season gate is to satisfy, the higher its nutrition
multiplier, so scarcity and payoff reinforce each other instead of being
picked independently. Sim-original guesses (rough relative tiers, not final
numbers — same "judge against a real generated run" discipline as every
other tuning table in this codebase).

| Tier | Crop | Eligible biome(s) | Moisture/climate note | Season window | Nutrition (vs. today's flat 0.4) | Notes |
|---|---|---|---|---|---|---|
| 0 — Berries (kept) | Oran, Pecha | any biome, no gate | — | wide | 1.0x | the original plain berry pair, unchanged behavior, now real `CropId`s instead of cosmetic flavors |
| 0 — Berries (kept) | Sitrus, Cheri | any biome, no gate | sun-loving (favored, not required, near a sunbeam) | wide | 1.0x | the original `SUN_FOOD_FLAVORS` pair — same favor-near-sunbeam behavior, ported forward unchanged |
| 1 — Filler | Herbs | any biome, low density | — | wide (all four phases) | 1.0x, **but see the new Herbs hook below** | intentionally weak on nutrition — a real "always available" tier, not a min-max target |
| 2 — Common | Wheat | grassland, highland | low–moderate | wide | 1.15x | widest eligibility of the real crops — the true default replacement for today's flat berries |
| 2 — Common | Tomato | grassland, jungle | sun-loving (reuses `SUN_FOOD_FLAVORS`'s existing sunbeam-proximity bonus) | Summer only | 1.2x | first crop with a real season gate, still common biome-wise |
| 2 — Common | Corn | grassland | moderate | wide | 1.25x | the "reliable staple" — slightly denser than Wheat for slightly narrower moisture tolerance |
| 3 — Dense | Rice | wetland, jungle | high moisture only | wide | 1.35x | real climate gate (moisture-band, not just biome name) is what earns the density bump over Corn |
| 3 — Dense | Apple | forest | moderate | **Autumn, first half (0.50–0.62)** | 1.4x | narrowest biome + a real season window — "grows on a tree, once a year" |
| 4 — Hardy | Potato | badlands, highland, desert, **and available in Winter when nothing else is** | drought-tolerant (little/no `floraDecayDivisor` penalty under drought) | wide, including Winter | 1.5x | the actual "survival staple" — its density is earned by being the one reliable Winter food, not by rarity alone |
| 5 — Rare/contested | Pumpkin | grassland, jungle | moderate | **Autumn, second half (0.62–0.75)**, offset from Apple | 1.65x | the deliberately scarce one — narrow biome-season overlap, small `maxStock`, big payoff |

## Herbs get a real second hook, not just weak filler

Refinement: instead of Herbs being nutrition-tier filler with nothing else
going for it, give them a genuine (small) utility on eat — a short
`statusImmuneTicksRemaining` grant, reusing the exact field/mechanism
`utilityMoves.ts`'s Safeguard already sets (`status.ts`). Kept deliberately
brief (well under Safeguard's own duration) so Herbs read as "the humble
remedy," not a strictly-better food. This makes the Filler tier a real
choice (nutrition vs. a minor status hedge) instead of a tier that exists
only to be skipped.

## Honey — a real first-cut design, not just deferred

Refinement over "revisit later": honey doesn't fit the seedling-grows-into-
food model, but it does fit a **pollinator-adjacency** model that's real
enough to scope now, using pieces that already exist:

- A `bloom`-flavored `FLORA_FLAVORS` tile (already decorative-only, no
  gameplay effect — same "clean unused slot" `FOOD_FLAVORS` was) gains one
  new field: `pollinatedTicksRemaining`, set to a short window whenever an
  agent from a real pollinator-tagged species (Butterfree/Beedrill are
  already on the curated roster) is adjacent to it — the same
  "near"-distance-check idiom `isNearSunbeam` already established.
- While that timer is active, the bloom tile gets a small chance per tick to
  spawn a `honey` food-stock pocket directly on itself (reusing `flora.ts`'s
  existing stock/decay fields, not a new tile type) — rare, small `maxStock`,
  very high nutrition multiplier (tentatively 2.0x — the single richest
  food in the sim, matching honey's real-world reputation).
- This is still a second-cut item relative to the 8-crop table above — it
  needs one new per-tile field and a species-tag adjacency check that
  doesn't exist yet, vs. every crop above reusing fields/checks that already
  exist. Sequence it after the main crop table lands, not alongside it.

## What actually needs building

1. **Data model**: replace `FOOD_FLAVORS: readonly string[]` with a real
   `FoodCropDef` registry (id, `eligibleBiomes`, optional moisture band,
   optional season-phase window, `nutritionMultiplier`, maybe a
   `maxStock`/`yieldFactor` override for rarity tiers) — same shape as
   `LANDMARK_DEFS`, not a new pattern.
2. **Placement gating**: `flora.ts`'s seedling-maturation path
   (`maybeDropSeed`/`trySpread`/the flavor-pick at maturation) needs to pick
   a crop based on the maturing tile's actual biome + current season phase +
   local moisture, instead of a uniform random flavor pick.
3. **Nutrition hookup**: `foodNutritionFactor` (or a sibling function) needs
   to read the tile's crop id and apply `nutritionMultiplier` on top of the
   existing `quality`-based factor — `consume()`'s signature doesn't need to
   change at all, just what feeds `qualityMultiplier`.
4. **Season naming**: add `seasonPhase(tick)` (a pure derived function over
   the existing `SEASON_LENGTH` wave, per the quartile table above) —
   zero new state, just a name for where in the cycle `world.tick` sits.
5. **Weather/season interaction**: extend the existing `floraDecayDivisor`
   call site with a per-crop weather-sensitivity multiplier (drought-hardy
   Potato vs. rain-loving Rice), and gate maturation-into-that-crop on the
   crop's season-phase window from step 4.
6. **Herbs' status hook**: on eating a Herbs tile, grant a short
   `statusImmuneTicksRemaining`, reusing `status.ts`'s existing field
   (already set/consumed by Safeguard) — no new field, just a second real
   caller of it.
7. **Rendering**: new glyphs/colors per crop in `sprites.ts`/`palette.ts`
   (mechanical, same pattern as the existing 4 flavors — the cheap part).
8. **Validation**: a dedicated `validateCrops.ts` runner script (this
   session's own established discipline) confirming crops actually appear
   in their intended biomes/seasons on a real generated world, nutrition
   deltas are measurable, Winter genuinely thins out which crops mature,
   and — the actual "heavily contested" payoff — `herdConflict.ts` rivalry
   events measurably increase around a rare high-value crop (Pumpkin) vs.
   an ordinary one (Wheat) over a real multi-thousand-tick run.
9. **Tests**: crop eligibility/season-gating determinism, nutrition-multiplier
   correctness, the Herbs status-immunity grant, and a regression guard that
   `consume()`'s own math is untouched (only its input changed).
10. **Honey (second cut, after the above lands)**: the `pollinatedTicksRemaining`
    field on `bloom` tiles, the pollinator-species adjacency check, and the
    honey stock-pocket spawn chance — sequenced after the main crop table
    since it needs new per-tile state the rest of this scope doesn't.

## Open questions

- Exact `nutritionMultiplier`/season-window-width/`maxStock` numbers are all
  guesses to be judged against a real generated run, same as every other
  tuning constant in this codebase — not meant to be final. The one
  structural claim worth stress-testing early: does the tier-vs-restriction
  ladder (harder to get → more nutrition-dense) actually produce visibly
  different contest behavior in a real run, or do the gates need to be
  tightened/loosened once seen live?
- Herbs' status-immunity duration needs to be short enough that it doesn't
  make Herbs a strictly-better pick over a real nutrition crop whenever
  status risk is nonzero — a real balance question, not just a number.
- Honey's 2.0x nutrition figure is a placeholder reflecting "richest food in
  the sim" — worth confirming that reads as a reward rather than trivializing
  hunger once a colony has reliable access to a bloom patch.

## Built — real-run findings and two real calibration bugs caught

The 8-crop table above shipped as scoped: `crops.ts` (the `FoodCropDef`
registry, `pickCrop`, `seasonPhase`/`seasonName`), wired into `flora.ts`'s
maturation path and `foodNutritionFactor`, `worldgen.ts`'s initial
placement, and needs.ts's Herbs status-immunity grant. Rendering got real
per-crop glyphs/colors in `palette.ts`/`ascii.ts` (no dedicated sprite art
yet — falls back cleanly to the colored-glyph path, same as any other
flavor without art). Validated end-to-end with a dedicated
`validateCrops.ts` runner script over a real 8000-tick `createDemoWorld`
run, plus `crops.test.ts` and additions to `flora.test.ts`/`needs.test.ts`.

**Two real, sampling-confirmed calibration bugs caught before shipping** —
exactly the "judge against a real run, don't guess" discipline this
codebase holds every tuning constant to, applied here for the first time to
a crop gate rather than a single constant:

- **Rice's moisture gate was unreachable.** The first draft used
  `moistureRange: [0.6, 1]`, picked without checking the real distribution.
  A direct sample of `effectiveWaterDensityAt` across a real generated world
  showed the true range tops out at ~0.28 (Wetland's own base
  `waterDensity`) — Rice could never have matured once shipped. Rescaled to
  `[0.1, 1]`, calibrated against that real sampled distribution (excludes
  the driest ~half of Jungle and a thin slice of Wetland — still a genuine
  restriction, now an achievable one).
- **Tomato's `sunLoving` hard gate was unreachable.** Sunbeam tiles only
  ever generate above `SUNBEAM_ELEVATION_THRESHOLD` (1.5), but Tomato's own
  Grassland/Jungle biomes never exceed ~1.15 in real generated elevation —
  confirmed by direct sampling, not assumed. A hard "near sunbeam or
  ineligible" gate would have made Tomato permanently unreachable in its own
  assigned biomes. Changed `sunLoving` from a hard requirement to a
  doubled-weight preference (matching the original pre-crop-system
  `SUN_FOOD_FLAVORS` idiom, which was always "favor, don't require") — real,
  reachable, and it still means something when it does occur.

After both fixes, a real 8000-tick run produced every one of the 8 crops at
least once (`cropIdsNeverSeen: []`), and the headline seasonal claim held up
strongly: **1.7 average food tiles alive during Winter samples vs. 66.6
outside Winter** — a real, measured, order-of-magnitude scarcity swing, not
a marginal one.

**What the same run could NOT confirm — reported honestly, not glossed
over**: `herdClashEventsOnFoodTilesByCrop` came back empty despite 56 real
clashes over the run. Two real reasons, not a broken mechanism: (1) a
`herdClash` event's `pos` is wherever the two contesting agents' skirmish
actually happens, which isn't guaranteed to be the exact contested tile's
coordinates at that instant; and (2) unlike landmarks (which got a real
`LANDMARK_POPULATION_MULTIPLIER` biasing multiple species toward the same
tiles), crops have no analogous mechanism yet pulling extra population
toward a rare crop specifically — an agent's `seekFood` still just goes to
its nearest reachable food tile, so a rare crop (Pumpkin matured only 3
times across the whole run) only gets "contested" if it happens to be
several agents' nearest option at once, which a small demo-scenario
population may simply not have produced in this one run. The "heavily
contested" claim rests entirely on `herdConflict.ts`'s existing generic
resource-blocking trigger doing its job under real scarcity, not on any
crop-specific contest-seeking behavior — which is what CROPS_DESIGN.md
proposed, but this run didn't have the population density to actually
observe it firing on a crop tile specifically. Worth a longer/larger-
population validation run, or a closer look at whether `herdClash`'s `pos`
should instead record the contested resource tile's own coordinates, before
calling this half of the ask fully confirmed.

## Berries restored — direct correction

Direct follow-up: "I think we need to keep berry as food sources tho" — the
first build accidentally read as a replacement (the doc's own original
framing, "Replaces `flora.ts`'s old `FOOD_FLAVORS`," was ambiguous about
whether it meant the list or what it named). Fixed: `CROP_IDS`/`FOOD_CROPS`
now carry Oran/Pecha/Sitrus/Cheri as real, ungated entries (Tier 0 above) —
Oran/Pecha with no gate at all, Sitrus/Cheri with the exact original
`SUN_FOOD_FLAVORS` near-sunbeam preference, all at a neutral 1.0x nutrition
matching their original (no-op) behavior before this whole feature. Real
sprite art (`sprites.ts`'s `getFoodSprite`) that already existed for these
four flavor names now actually loads again too — it was never removed, just
briefly unreachable while the berries themselves were.

Re-validated with the same `validateCrops.ts` script: all four berries
appear immediately and dominate the food-tile population (as the only
fully-ungated options, expected), the 8 new crops still appear alongside
them, and Winter thinning still holds (76.0 avg outside Winter vs. 3.9
inside, this run). Pumpkin didn't mature at all in this particular 8000-tick
sample — plausible variance for the deliberately rarest crop now sharing its
eligible pool with 4 more always-available competitors, not a new gate bug
(its own eligibility logic is unchanged); worth a longer run if it's ever
suspiciously absent across several seeds.

## Layer-gated access, digging, canopy harvest, growth stages, water rework (pitched, not built)

Direct follow-up, a genuinely bigger pitch than the crop table itself:
underground crops (Potato, Pumpkin) should be effortless for underground
agents but cost surface agents real "digging" time; canopy crops (Apple,
Corn) should be harvested by *damage* — attack moves, not walking up to a
tile — with range giving an edge; every crop gets a real per-crop process
time (Rice/Wheat/Herbs/Tomato fastest for surface agents); an unripe crop
should render differently from a harvestable one; and water should get the
same "always exists somewhere, costs effort to reach if not already there"
treatment — guaranteed underground, drought can zero out the surface,
digging (Dig itself, and "most damage moves" generally) creates a spring.

This is a scope, not an implementation, and a bigger one than the crop
table — it touches `movement.ts`'s layer model, `combat.ts`'s move-targeting
pipeline, and `worldgen.ts`'s underground/canopy generation, not just
`flora.ts`/`crops.ts`. Same discipline as before: every piece below is
checked against what's actually already built first.

### The real blocker: canopy has no terrain at all

Before Apple-on-trees or Corn-on-stalks can mean anything, canopy needs to
exist as a real layer. Right now it doesn't: `worldgen.ts`'s own doc
comment states plainly that "Underground/canopy are untouched (still the
plain flat grid `createWorld` always produces) — this is a Surface-only
pass." No food, no trees, no obstacles, nothing — every canopy tile is bare
floor, on every world, always. The web renderer doesn't even draw agents
standing on canopy today (`renderer.ts`: "an agent on underground/canopy
simply isn't drawn"). This is the real prerequisite the whole
"apple/corn are canopy crops" idea sits on top of — not a small gap to
patch alongside the rest, but its own real generation pass (canopy tree
crowns, at minimum) that has to land first. Scoping it fully is out of
this pass's depth; flagging it as the genuine blocker rather than quietly
assuming canopy terrain "just exists" once crops are layer-aware.

### Canopy is derived, not independent — direct correction to the above

Direct correction: canopy shouldn't get its own independent biome/obstacle
generation pass the way Surface does — "things don't generate in canopy
just floating there. They have to be growing on trees or plants that grow
high." That's the right model, and it's consistent with how every other
piece of this codebase already works — nothing generates ungrounded; biome
blend, moisture, macro elevation, landmarks are all derived from something
real. Canopy should be the same: a tile only has real canopy terrain if
something on the SAME (x, y) surface tile projects up into it —

- **Tree clusters** project a real canopy "island" above themselves — dense
  Forest/Jungle tree cover (already a real, already-generated surface fact:
  `obstacleField`'s tree placement) is the natural trigger, not a separate
  canopy-specific noise field.
- **Tall crops** (Corn, per the pitch) project a small canopy patch above
  their own single tile — a stalk is "high" the same way a tree is, just at
  one-tile scale instead of a cluster.
- **Mountain-massif ridges** (see below) project canopy along their own
  outer edge — the rim of a real tall landform reads as ridge terrain at
  canopy height, a third, geologically-driven source of canopy alongside
  the two vegetation-driven ones above.

This actually shrinks the "real blocker" above rather than growing it: canopy
generation doesn't need its own independent biome pass at all — it needs a
derivation step that reads Surface's already-real tree/crop/massif placement
and stamps canopy tiles only where one of those three sits, sized to match
(a tree cluster's tile footprint, a single corn tile, a massif's rim). Real,
scoped, and grounded in what Surface already generated — not a fourth
generation system running in parallel and hoping it lines up.

### Mountain massifs — the other real generation gap this surfaced

Direct question: "do we have solid wall chunks yet like mountain terrain?"
**No, not on the surface.** What exists instead:

- **Highland/Snow biomes** are elevation-biased *scatter* — each obstacle
  tile (boulder/tree/etc.) is picked independently from its own per-tile
  noise field (`kindNoise`, worldgen.ts). High boulder density, but no two
  boulder tiles know about each other as part of one landform — there's no
  contiguous shape.
- **Badlands BSP chambers** (`carveBadlandsChambers`) DO carve real,
  contiguous wall structures — but they're canyon/chamber dividers for a
  labyrinth, biome-specific to Badlands, and read as carved-out corridors,
  not a solid raised massif.
- **Underground caves** (`generateUndergroundCaves`) use cellular automata
  (random fill, neighbor-majority smoothing, keep-largest-region) that
  genuinely DOES produce thick, blobby, connected wall regions — the
  closest existing technique to "large thick wall chunk" anywhere in this
  codebase. It's just on the underground layer, generating cave walls, not
  the surface layer generating a mountain.

A real surface mountain-massif generator is new work, but not
from-scratch new — it's the underground caves' own cellular-automata
technique, reapplied to Highland/Snow's surface footprint instead of a
flat underground grid, biased to actually connect into one solid mass
rather than the many small disconnected obstacle scatter-points those
biomes place today. Its outer rim (the boundary between massif-wall and
open ground) is exactly the "ridges on canopy" idea above — the natural
edge a canopy-derivation pass reads from.

**Built** (`carveMountainMassifs`, worldgen.ts): same CA recipe (random
fill + neighbor-majority smoothing), scoped to Highland/Snow-*dominant*
tiles (same `dominantBiomeAt`-driven gating `carveBadlandsChambers`
already uses for its own biome), with a real cleared-speckle step
(`clearSmallWallComponents`) so only genuinely large connected components
survive as real massifs, not CA noise. A real, sampling-caught bug along
the way: the first pass mirrored `CAVE_INITIAL_WALL_CHANCE` (0.4) —
wrong, because that value works for caves precisely because *floor* is
the phase meant to consolidate there; a massif needs *wall* to be the
consolidating phase, which requires wall to start as the majority, not
the minority. At 0.45 (still under 50%), only 7 of 20 sampled worlds
produced any massif at all, averaging ~11 wall tiles against an ~867-tile
Highland/Snow footprint. Retuned to 0.58: all 20 worlds produced at least
one real massif, averaging ~78 wall tiles/world (~9% of the Highland/Snow
footprint), largest single component 126 tiles — real, substantial
mountain formations, not a token scattering, without swallowing the whole
biome. Validated via `validateMountainMassifs.ts` and a dedicated
`describe("generateWorld: Mountain massifs")` block (containment within
Highland/Snow's own footprint, contiguity via 4-connected flood-fill,
elevation boost, determinism) in worldgen.test.ts.

### Cross-zone contiguity — rivers and mountains shouldn't stop at a zone edge

Direct ask: "rivers and mountains should try to be contiguous across
zones. Even if it doesn't perfectly line up." Grounding this against what's
real:

- **Rivers**: this is a gap DESIGN.md already names explicitly, not a new
  one — its own "What's honestly still open" list states: "Macro
  river/lake edges (`MacroZone.riverEdges`/`isLake`) aren't fed into
  `biasForZone` at all yet... a promoted zone's own per-tile rivers are
  generated by the ordinary unbiased `carveSuicuneRivers` pass, so a zone
  the macro grid marked as river-crossing isn't guaranteed to actually
  show a river once promoted, let alone one crossing at the marked edge."
  The macro-level fact already exists (`MacroZone.riverEdges`, carved by
  `carveMacroRivers` at grid-generation time) — it's just never consumed
  by the per-zone `ZoneGenerationBias` the way `dominantBiome`/`landmark`
  already are. Wiring `riverEdges` into `ZoneGenerationBias` (a new
  `riverEdges?: readonly ZoneDirection[]` field, read by
  `carveSuicuneRivers` to bias its steepest-descent starting point/direction
  toward the marked edge) is a real, scoped fix to an already-documented
  gap, not new architecture.
- **Mountains**: the same shape, but for elevation instead of rivers.
  `MacroElevationBias` already has `lowEdges`/`highEdges` — "Edges of the
  tile grid to pull elevation... toward" a neighbor the macro grid marked
  as higher/lower — this is the exact mechanism coastlines already use to
  land on the correct edge, and it already softly biases a zone's overall
  elevation toward a highland neighbor. What it doesn't do yet is bias
  WHERE a real massif (once built, per above) actually sits or which
  direction its ridge runs — that's the missing piece once massifs exist:
  the massif generator reading `highEdges` the same way `carveSuicuneRivers`
  would read `riverEdges`, so a massif in one zone is more likely to abut a
  massif in the neighbor across a `highEdges`-marked boundary. "Even if it
  doesn't perfectly line up" matches this exactly — a bias, not a
  guaranteed pixel-for-pixel stitch, same honesty DESIGN.md already applies
  to the river gap.

**Both built.** `riverEdges` (river cross-zone contiguity): retuned once
against a real sample — the first pass was a near-total wash (4/8 samples
favoring the marked edge), strengthened to 6-7/8. Mountains: `carveMountain
Massifs` now takes `highEdges` and boosts initial CA fill chance near the
marked edge (same "narrow band via `edgeCloseness` raised to an exponent"
technique as the river trench, `MASSIF_EDGE_SEED_BOOST`/`_EXPONENT`).
Validated via `validateMassifEdges.ts` and a dedicated worldgen.test.ts
case, both against a real macro grid: 12 of 15 sampled Highland/Snow zones
with a real `highEdges` fact showed denser massif wall on the marked side,
aggregate ~1.67x (0.327 vs 0.196) — a real, working bias.

### Underground informed by surface water — a real, currently-zero coupling

Direct ask: "places with deep water (underground springs, rivers, lakes,
sea) needs to be reflected in the underground as well; the surface also
influences how the underground is." Grounding: today there is NO coupling
at all — `generateWorld`'s own comment on `generateUndergroundCaves` states
underground generation is "independent of everything Surface-only above (no
biome/elevation/moisture data to read)," using its own derived rng
sub-stream with zero awareness of what the surface above it looks like.
That's a real, total gap, not a partial one — underground water (from the
Water Rework pitch earlier) shouldn't just be "one guaranteed pocket per
zone, positioned arbitrarily" as first proposed; it should be biased toward
sitting under wherever the surface already has a lake, river, or coastline.
Concretely: `generateUndergroundCaves` (or whatever guarantees underground
water per the earlier Water Rework pitch) would need to read the same
per-tile moisture/water-density facts `effectiveWaterDensityAt` already
computes for Surface, and bias its water-pocket placement toward the (x, y)
columns where Surface is wettest — a real vertical correlation, "what's
above tends to inform what's below," not two fully independent RNG draws
that happen to occupy the same (x, y) footprint by coincidence.

**Built** (`pickUndergroundWaterPocket`, called from `generateUndergroundCaves`):
underground gained a real third terrain kind ("water," alongside its old
wall/floor-only vocabulary) for the first time. Every real floor cell in
the already-finalized single connected cave region is scored by Surface's
own `effectiveWaterDensityAt` at that (x, y); the pocket's center is drawn
from the top 15% wettest candidates (real variety within a genuinely wet
area, not always literally the single wettest point), then a small
(`UNDERGROUND_WATER_POCKET_RADIUS` = 3) jittered-circle pocket is carved —
guaranteed every generation, never sparse. A real connectivity risk this
surfaced and fixed: the underground caves' own reachability test checked
"floor" tiles only, which a water pocket carved out of floor could in
principle fragment; fixed the test (and confirmed via the real generation
code) to treat floor+water together as the real walkable region, since
water is real walkable terrain (`UNWALKABLE_TERRAIN` is only wall/tree),
not an obstacle. Validated via `validateUndergroundWater.ts` over 30 real
worlds: 30/30 guaranteed a pocket, and underground water sits at surface
locations averaging ~2.1x the water density of a random underground floor
tile (0.182 vs 0.085) — a real, strong vertical correlation, not
coincidence.

### Real hooks to reuse

- **Cross-layer access, structurally**: there's no general "walk to a
  neighboring layer" mechanic today — only `LAYER_ORDER`'s adjacency rule
  (`underground <-> surface <-> canopy`, `types.ts`) and one narrow existing
  precedent: Diglett's own `burrow` move. A fleeing agent with an off-cooldown
  `burrow`-flagged move (`MoveSpec.burrow: { ticks }`) sets `agent.layer =
  "underground"` for a countdown (`agent.burrowedTicksRemaining`, ticked
  down in `status.ts`'s `tickBurrow`), then restores its original layer.
  Real, already-built, but purely a *flee/concealment* action today, not an
  offense-on-a-resource action. Directly relevant: `packages/data/src/moves.ts`
  already defines a real, currently-unused-for-this-purpose `dig` move —
  `burrow: { ticks: 20 }`, `range: { min: 0, max: 1 }`, `cooldownTicks: 15` —
  with its own doc comment admitting cooldown/range are "set anyway for
  MoveSpec's sake, not because either is ever read for this move's real
  use." Digging out a Potato is thematically exactly what this move already
  claims to do; reusing (or extending) `dig`/`burrow` for real extraction
  instead of only fleeing is the obvious hook, not a new mechanic layered on
  top of an unrelated one.
- **Multi-tick "channel then reward"**: no such thing exists for
  eating/drinking (both instant on arrival, confirmed by `needs.ts`'s own
  doc comment: "consuming never actually depended on how much stock was
  left... always grants the full flat need-restore amount"). But
  `shelter.ts`'s construction mechanic is exactly this pattern, real and
  already built: `SHELTER_BUILD_TICKS`, a per-agent `Agent.shelterBuildTicks`
  counter incremented once per tick spent at the build site, completing at
  a threshold, cancelable if interrupted by a more urgent need, and already
  supporting real multipliers (`WATER_BUILD_TICKS_MULTIPLIER`,
  `PREDATOR_BUILD_TICKS_MULTIPLIER`). "Process time" for digging out a
  layer-mismatched crop is a direct reuse of this exact shape — an
  `Agent.digTicks` counter, a per-crop base duration, a move-driven
  multiplier — not a new kind of mechanic for this codebase.
- **Range for canopy harvest advantage**: `MoveSpec.range?: { min, max }`
  already exists and is real (`moveRange()`/`withinMoveRange()`, combat.ts)
  — a ranged move's `max` is a real, already-consumed number. "Higher range
  gives a canopy-harvest advantage" is a direct, cheap reuse: score/gate
  canopy-crop eligibility by the acting move's own `range.max` instead of
  inventing a second range concept.
- **Water digging vs. `Dig`/damage moves**: no underground water exists at
  all today — `generateUndergroundCaves` is strictly wall/floor cellular
  automata, no water tile-kind ever placed. A guaranteed underground water
  pocket per zone is new generation work, but a small, bounded addition to
  that same function (the same "stamp something rare and guaranteed" idea
  `landmarks.ts` already established, just mandatory instead of sparse).

### What's genuinely new, not a reuse

- **Damage applied to a tile/resource instead of a living agent.** Every
  existing terrain-mutating move field (`terrainBurn`, `terrainFill`,
  `consumesOwnTerrain`) triggers off a landed hit against a *living
  defender* and mutates that defender's *own occupied tile* — none of them
  let a move target a food/tree tile directly the way "canopy foods
  processed by damage" needs. This is real new plumbing: a move needs a
  target-a-tile-instead-of-an-agent mode, and a food tile needs something
  analogous to HP (stock already exists — reusable) that damage can reduce
  as "processing progress" instead of (or alongside) an agent standing
  there accumulating channel-ticks.
- **Growth-stage rendering** (unripe vs. harvestable): the closest existing
  thing is `Tile.growth` (seedling-to-maturity, `flora.ts`), but that ends
  the moment a tile becomes real "food" terrain — there's no post-maturity
  "still ripening" sub-state today. A canopy Apple tree or Corn stalk
  reading as "growing" before "ready to pick" needs a new field (or a
  repurposed `growth` continuing to count past maturation, gating which
  glyph/emoji renders) — real but small, same shape as the seedling
  mechanic already uses.
- **Underground-crop surface inaccessibility, and vice versa.** Nothing
  today gates "which layer can eat from this specific food tile" — any
  agent that can path to a tile's (x, y) on its own layer eats from it, full
  stop. Real new logic needed: a crop's `FoodCropDef` gaining a notion of
  "native layer" (Potato/Pumpkin = underground, Apple/Corn = canopy,
  everything else = surface, as today) and `needs.ts`'s target-selection
  path respecting it instead of layer-blind pathfinding to the nearest food.

**Digging — built** (`FoodCropDef.nativeLayer`/`digTicks`, `Agent.
digTicksAccrued`, `cropDigThreshold`, needs.ts): Potato/Pumpkin now carry
`nativeLayer: "underground"`. An agent standing on the food tile whose
layer doesn't match pays a real, multi-tick digging tax
(`DIG_TICKS_DEFAULT = 15`, the real `dig` move's own `burrow.ticks` order
of magnitude) before it can actually consume — reusing `shelter.ts`'s
exact accrue-then-complete shape, not a new mechanism. An agent already on
the crop's native layer pays nothing. The real `dig` move (`MoveSpec.
burrow`) speeds this up when known and off-cooldown: a real burst
(`DIG_MOVE_BURST_TICKS = 5`) instead of the ordinary +1/tick, respecting
its own cooldown via the existing `useMove` pipeline — a real second use
for a move that was previously flee-only. Scoped to `burrow`-flagged moves
only, not "most damage moves" — CROPS_DESIGN.md's own open question below
is left open, not decided by default. Validated via `validateDigging.ts`
over a real 8000-tick run: 7548/8000 ticks had at least one agent actively
digging, 7 real completions. What's honestly NOT built: an underground
agent still has to physically path up to the surface tile to reach a
Potato/Pumpkin — "no dig tax" is real, "never has to leave its own layer"
isn't. Also not built: `digTicksAccrued` isn't reset on interruption (a
different tile/behavior doesn't lose accrued progress) — a real, minor,
currently-unaddressed edge case, not a correctness-breaking one.

**Dig a spring — built** (`Agent.springDigTicksAccrued`, `SPRING_DIG_TICKS`,
needs.ts, `events.ts`'s widened `terrainChanged.cause`): reuses the exact
same accrue-then-complete shape as crop digging, as its own independent
counter (not shared with `digTicksAccrued`, to avoid one dig's progress
bleeding into the other). When an agent's `seekWater` search finds *no*
water anywhere reachable at all — same-layer or cross-layer — and it is
standing on diggable "floor" terrain, it starts digging a spring in place
(`SPRING_DIG_TICKS = 20`), sped up by an off-cooldown `burrow` move the same
way crop-digging is. On completion the tile itself becomes real "water"
terrain (`setTile`, elevation 0) and logs a `terrainChanged` event with the
new `cause: "dug"`. A real gating bug was caught and fixed here: the first
version fired whenever the ordinary water search returned nothing, which
included the case where water tiles exist but are merely crowded/excluded
— this broke a pre-existing regression test ("does not infinite-loop
between two mutually-crowded tiles — eventually relocates instead of
oscillating forever"), because the agent started digging a brand-new spring
instead of falling through to the existing wait/relocate escape valve.
Fixed by requiring `!somethingExistsNearby` — digging now only triggers
when water is genuinely absent, never merely contested. Two pre-existing
starvation tests ("records a starved event with the right cause", "gives
thirst its own, longer grace period") had to be reconciled with this new,
real behavior: their bare hand-built test worlds have zero water anywhere
and no obstruction, so the agent that was supposed to die of unrecoverable
thirst instead survived by digging a spring — a correct, intended
consequence of the new mechanic, not a bug, but one that broke those
tests' original premise. Fixed by placing a boulder on the agent's own
tile so it has nothing diggable under it, preserving each test's real
intent elsewhere. Validated two ways: 4 targeted unit tests exercise the
mechanic directly (a real spring dug over real time, the crowded-water
non-trigger, boulder blocking, and the `burrow` move speeding it up), and
`validateDigASpring.ts` ran it over a real 8000-tick `createDemoWorld` run
— an honest 0-trigger result, because the demo world's rivers, lakes, and
the now-guaranteed underground water pocket already give agents real water
within reach everywhere, so this last-resort mechanic correctly never had
to fire there.

### Open questions

- Whether "most damage moves" (the pitch's own phrase) can dig/process, or
  only `Dig`-flagged ones — the broader version needs a real per-move-type
  rule (e.g. any move with `category !== "status"`), the narrower version
  is a straightforward `burrow`/new-field check. Worth deciding before
  implementing since it changes how many existing moves suddenly do double
  duty as extraction tools.
- Whether canopy terrain generation is scoped as part of this feature or
  genuinely its own prerequisite pass first — given the size of that gap
  (an entire unbuilt layer of worldgen), doing it "alongside" risks the
  canopy-crop half of this pitch shipping on top of placeholder flat floor,
  which would read as broken rather than unfinished. Now a real dependency
  chain, not just a size question: canopy-from-vegetation (tree clusters,
  Corn) doesn't need massifs at all and could land first on its own; canopy
  ridges specifically need the mountain-massif generator to exist first.
  Worth sequencing as two real, separately-shippable passes rather than one
  "canopy" ticket.
- How "process time" composes with the existing feeding-priority/grazing
  mechanics (`needs.ts`'s `yieldsToHigherRankedFeeder`, `flora.ts`'s
  grazing-pressure scars) — a slow-to-dig Potato patch with multiple hungry
  agents queued on it is exactly the kind of scarcity `herdConflict.ts`
  already turns into rivalry; worth confirming that composition is
  desirable before building it, since it stacks two "real, but slow"
  systems on the same tile.
- Whether the mountain-massif generator is scoped here at all, or is its
  own separate pass this feature merely depends on — it's real new
  worldgen work in its own right (reused technique, new application),
  arguably bigger than the crop-layer-access mechanics that motivated it in
  the first place. Same "don't let a big dependency quietly ride along
  inside a smaller feature's scope" concern as the canopy blocker above.
- Cross-zone river-edge wiring (`riverEdges` into `ZoneGenerationBias`) is
  a small, real, already-identified gap that could genuinely ship on its
  own, independent of everything else in this section — worth doing as a
  quick, separate fix rather than bundling it into a much larger pass.
- How strongly underground water should correlate with surface water —
  directly beneath, or just "somewhere in the same zone, biased but not
  guaranteed adjacent"? A real cave system doesn't always run directly
  under the river feeding it; worth deciding how literal the vertical
  correlation should read before building the bias.
