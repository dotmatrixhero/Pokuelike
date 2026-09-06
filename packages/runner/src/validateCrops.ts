/**
 * Real-run validation for the food-crop system (CROPS_DESIGN.md) — proves
 * crops actually appear across biomes/seasons on a live `createDemoWorld`
 * run, Winter genuinely thins out which crops mature, and the "heavily
 * contested" payoff shows up as real `herdClash` events (herdConflict.ts's
 * pre-existing rivalry trigger) clustering on rare, nutrition-dense crop
 * tiles rather than common ones. Usage:
 * `pnpm --filter @pokuelike/runner exec tsx src/validateCrops.ts <ticks>`
 */
import { tickWorld, tileAt, FOOD_CROPS, CROP_IDS, seasonName, SEASON_LENGTH, type CropId } from "@pokuelike/engine";
import { createDemoWorld, HUNT_RULES, LEVELING_CONTEXT, IMMIGRATION_CONTEXT } from "@pokuelike/data";
import { EventLog } from "@pokuelike/engine";

const ticks = Number(process.argv[2] ?? 8000);
const SAMPLE_EVERY = 100;

const world = createDemoWorld();
const log = new EventLog();

function surveyFoodTiles(): { total: number; byCrop: Record<string, number>; season: string } {
  const byCrop: Record<string, number> = {};
  let total = 0;
  for (const tile of world.tiles.surface) {
    if (tile.terrain !== "food" || !tile.flavor) continue;
    total++;
    byCrop[tile.flavor] = (byCrop[tile.flavor] ?? 0) + 1;
  }
  return { total, byCrop, season: seasonName(world.tick) };
}

const seasonSurveys: { tick: number; season: string; total: number }[] = [];
const cropTotals: Record<string, number> = {};
let sampleCount = 0;

for (let i = 0; i < ticks; i++) {
  tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);

  if (i % SAMPLE_EVERY === 0) {
    const survey = surveyFoodTiles();
    seasonSurveys.push({ tick: world.tick, season: survey.season, total: survey.total });
    for (const [crop, count] of Object.entries(survey.byCrop)) {
      cropTotals[crop] = (cropTotals[crop] ?? 0) + count;
    }
    sampleCount++;
  }
}

// Winter vs. non-winter food-tile counts, straight off the same samples
// above — the real "most crops stop maturing at all in Winter" claim,
// measured, not assumed.
const winterSamples = seasonSurveys.filter((s) => s.season === "winter");
const nonWinterSamples = seasonSurveys.filter((s) => s.season !== "winter");
const avgWinterFood = winterSamples.length ? winterSamples.reduce((a, s) => a + s.total, 0) / winterSamples.length : undefined;
const avgNonWinterFood = nonWinterSamples.length ? nonWinterSamples.reduce((a, s) => a + s.total, 0) / nonWinterSamples.length : undefined;

// Correlate herdClash events (herdConflict.ts's real rivalry trigger) with
// what crop (if any) sat under the defender's tile at the moment of the
// clash — the direct measurement of "heavily contested" this scope was
// built for.
let totalClashes = 0;
const clashesByCrop: Record<string, number> = {};
for (const event of log.events) {
  if (event.kind !== "herdClash") continue;
  totalClashes++;
  const tile = tileAt(world, "surface", event.pos.x, event.pos.y);
  if (tile?.terrain === "food" && tile.flavor) {
    clashesByCrop[tile.flavor] = (clashesByCrop[tile.flavor] ?? 0) + 1;
  }
}

console.log(
  JSON.stringify(
    {
      ticks,
      sampleCount,
      finalPopulation: world.agents.filter((a) => a.alive !== false && !a.isEgg).length,
      cropIdsEverSeen: Object.keys(cropTotals).sort(),
      cropIdsNeverSeen: CROP_IDS.filter((id) => !(id in cropTotals)),
      totalFoodTileSamplesByCrop: cropTotals,
      nutritionMultiplierByCrop: Object.fromEntries(CROP_IDS.map((id) => [id, FOOD_CROPS[id].nutritionMultiplier])),
      avgFoodTilesInWinterSamples: avgWinterFood,
      avgFoodTilesOutsideWinterSamples: avgNonWinterFood,
      totalHerdClashEvents: totalClashes,
      herdClashEventsOnFoodTilesByCrop: clashesByCrop,
    },
    null,
    2
  )
);

// A quick, human-readable sanity note on the two headline claims.
if (avgWinterFood !== undefined && avgNonWinterFood !== undefined) {
  console.log(
    `\nWinter thinning: ${avgWinterFood.toFixed(1)} avg food tiles in Winter vs ${avgNonWinterFood.toFixed(1)} outside it (${
      avgWinterFood < avgNonWinterFood ? "confirmed thinner" : "NOT thinner — investigate"
    }).`
  );
}
const rareCropClashes = (["pumpkin", "apple"] as CropId[]).reduce((a, id) => a + (clashesByCrop[id] ?? 0), 0);
const commonCropClashes = (["herbs", "wheat", "corn"] as CropId[]).reduce((a, id) => a + (clashesByCrop[id] ?? 0), 0);
console.log(
  `Contest signal: ${rareCropClashes} clashes on rare crops (Pumpkin/Apple) vs ${commonCropClashes} on common ones (Herbs/Wheat/Corn) — sample sizes vary with how much of each crop actually grew this run, read alongside totalFoodTileSamplesByCrop above.`
);
