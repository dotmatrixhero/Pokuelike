/**
 * Real food crops — CROPS_DESIGN.md's direct ask: "more kinds of food, not
 * just berries... nutrition dense, grow in certain regions and seasons, and
 * be heavily contested." Replaces `flora.ts`'s old `FOOD_FLAVORS` (a purely
 * cosmetic glyph/color pick with zero gameplay effect) with a real registry
 * gated on biome, runtime moisture, and season — reusing existing hooks
 * (`worldgen.ts`'s `biomeWeightsAt`/`effectiveWaterDensityAt`,
 * `flora.ts`'s own decay-only season wave, `herdConflict.ts`'s already-built
 * rivalry trigger for the "heavily contested" payoff) rather than inventing
 * parallel mechanisms. Deliberately dependency-free (no imports from
 * `flora.ts`/`worldgen.ts`) so both of those can import from here without
 * a circular import — `worldgen.ts` used to import `FOOD_FLAVORS` from
 * `flora.ts` for exactly this reason; this module replaces that need.
 */

export const CROP_IDS = ["herbs", "wheat", "tomato", "corn", "rice", "apple", "potato", "pumpkin"] as const;
export type CropId = (typeof CROP_IDS)[number];

export type SeasonName = "spring" | "summer" | "autumn" | "winter";

/**
 * Ticks per full season cycle — the same slow sine wave `flora.ts`'s
 * decay/spread already rides (`seasonalMultiplier` below, moved here so
 * crops and flora decay share one clock instead of two independent copies
 * of the same constant). No calendar/year system exists beyond this single
 * wave — a "season" is just a named quarter of it.
 */
export const SEASON_LENGTH = 1000;

/** 0..1 multiplier on decay/spread: a slow sine cycle, never fully zeroing out. */
export function seasonalMultiplier(tick: number): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * tick) / SEASON_LENGTH);
}

/** Where in the season cycle `tick` sits, 0..1 — a pure derived value over the same wave `seasonalMultiplier` already rides, not a new clock. */
export function seasonPhase(tick: number): number {
  const wrapped = tick % SEASON_LENGTH;
  return (wrapped < 0 ? wrapped + SEASON_LENGTH : wrapped) / SEASON_LENGTH;
}

/** Real "harvest window" halves of Autumn — Apple and Pumpkin sit in offset halves so the two contested crops never fully overlap. */
export const AUTUMN_FIRST_HALF: readonly [number, number] = [0.5, 0.62];
export const AUTUMN_SECOND_HALF: readonly [number, number] = [0.62, 0.75];

const SEASON_WINDOWS: Record<SeasonName, readonly [number, number]> = {
  spring: [0, 0.25],
  summer: [0.25, 0.5],
  autumn: [0.5, 0.75],
  winter: [0.75, 1],
};

/** Names the quartile `seasonPhase(tick)` falls in — Spring/Summer/Autumn/Winter, purely a label over the existing wave, no new state. */
export function seasonName(tick: number): SeasonName {
  const phase = seasonPhase(tick);
  if (phase < SEASON_WINDOWS.spring[1]) return "spring";
  if (phase < SEASON_WINDOWS.summer[1]) return "summer";
  if (phase < SEASON_WINDOWS.autumn[1]) return "autumn";
  return "winter";
}

export interface FoodCropDef {
  /** Real, human-readable name — narrative color, and what `foodNutritionFactor`'s doc comment/UI can point to. */
  name: string;
  /** Which biomes this crop can mature in — absent = any biome (Herbs, the universal filler). */
  eligibleBiomes?: readonly string[];
  /** [min, max] band on the real runtime moisture proxy (`worldgen.ts`'s `effectiveWaterDensityAt`) — absent = no moisture gate. */
  moistureRange?: readonly [number, number];
  /** Only eligible while `seasonPhase(tick)` sits in this [start, end) window — absent = eligible in every season ("wide"). */
  seasonWindow?: readonly [number, number];
  /**
   * Favored (not required) near a sunbeam tile — reuses germination's
   * existing near-sunbeam bonus (`flora.ts`'s `isNearSunbeam`), same "favor,
   * don't require" idiom as the old `SUN_FOOD_FLAVORS`. A hard requirement
   * would make this crop unreachable in its own assigned biomes: sunbeam
   * tiles only ever generate above `SUNBEAM_ELEVATION_THRESHOLD` (1.5), but
   * Tomato's Grassland/Jungle never exceed ~1.15 — confirmed by direct
   * sampling, not assumed.
   */
  sunLoving?: boolean;
  /** True only for the crop meant to stay reliably available even in Winter, when every other non-hardy crop's chance of maturing into real food is cut (`WINTER_NON_HARDY_FOOD_CHANCE_MULTIPLIER`) — currently just Potato. */
  winterHardy?: boolean;
  /** True only for the crop that should shrug off drought's usual decay penalty (`flora.ts`'s own use of this flag) — currently just Potato. */
  droughtResistant?: boolean;
  /** Multiplies hunger restored per feeding, on top of `foodNutritionFactor`'s existing quality-based factor — 1.0 is the old flat baseline every berry flavor gave. */
  nutritionMultiplier: number;
}

/**
 * CROPS_DESIGN.md's tier ladder: the harder a crop's real gate is to
 * satisfy, the higher its nutrition multiplier, so scarcity and payoff
 * reinforce each other. Every number here is a sim-original guess, same
 * "judge against a real generated run" discipline as every other tuning
 * table in this codebase.
 */
export const FOOD_CROPS: Record<CropId, FoodCropDef> = {
  herbs: {
    name: "Herbs",
    nutritionMultiplier: 1.0,
  },
  wheat: {
    name: "Wheat",
    eligibleBiomes: ["grassland", "highland"],
    nutritionMultiplier: 1.15,
  },
  tomato: {
    name: "Tomato",
    eligibleBiomes: ["grassland", "jungle"],
    sunLoving: true,
    seasonWindow: SEASON_WINDOWS.summer,
    nutritionMultiplier: 1.2,
  },
  corn: {
    name: "Corn",
    eligibleBiomes: ["grassland"],
    nutritionMultiplier: 1.25,
  },
  rice: {
    name: "Rice",
    eligibleBiomes: ["wetland", "jungle"],
    // Real runtime moisture (`effectiveWaterDensityAt`) never actually
    // reaches anywhere near 1 — a real sampled run topped out at ~0.28
    // (Wetland's own base `waterDensity`). 0.1 is calibrated against that
    // real distribution, not an arbitrary guess: it excludes the driest
    // ~half of Jungle and a thin bottom slice of Wetland (a genuine
    // restriction) while staying reachable by the wetter majority of both
    // biomes, unlike an unreachable [0.6, 1] band would be.
    moistureRange: [0.1, 1],
    nutritionMultiplier: 1.35,
  },
  apple: {
    name: "Apple",
    eligibleBiomes: ["forest"],
    seasonWindow: AUTUMN_FIRST_HALF,
    nutritionMultiplier: 1.4,
  },
  potato: {
    name: "Potato",
    eligibleBiomes: ["badlands", "highland", "desert"],
    winterHardy: true,
    droughtResistant: true,
    nutritionMultiplier: 1.5,
  },
  pumpkin: {
    name: "Pumpkin",
    eligibleBiomes: ["grassland", "jungle"],
    seasonWindow: AUTUMN_SECOND_HALF,
    nutritionMultiplier: 1.65,
  },
};

/**
 * How much a non-winter-hardy crop's chance of maturing into real food (vs.
 * decorative flora) is cut during Winter — the real "most crops stop
 * maturing at all" scarcity CROPS_DESIGN.md calls for, applied at the
 * food-vs-flora roll rather than as a nutrition penalty, so Winter reads as
 * "less food exists" rather than "food is worse."
 */
export const WINTER_NON_HARDY_FOOD_CHANCE_MULTIPLIER = 0.3;

function inWindow(phase: number, window: readonly [number, number]): boolean {
  return phase >= window[0] && phase < window[1];
}

/**
 * Picks which crop a maturing seedling becomes, uniformly among every crop
 * whose real gates (biome, moisture, season) this position/tick currently
 * satisfies — same "pick uniformly among options" idiom `flora.ts`'s own
 * `pickFlavor` already uses. Herbs has no gates at all, so the eligible set
 * is never actually empty; the `?? "herbs"` fallback below is a pure safety
 * net. `sunLoving` crops (favored, not required, near a sunbeam — see
 * `FoodCropDef.sunLoving`'s doc comment) get a second entry in the pool
 * when `nearSun` is true, doubling their odds without ever excluding them
 * otherwise.
 */
export function pickCrop(biome: string | undefined, moisture: number | undefined, tick: number, nearSun: boolean, rng: () => number): CropId {
  const phase = seasonPhase(tick);
  const eligible: CropId[] = [];
  for (const id of CROP_IDS) {
    const def = FOOD_CROPS[id];
    if (def.eligibleBiomes && (!biome || !def.eligibleBiomes.includes(biome))) continue;
    if (def.moistureRange && moisture !== undefined && (moisture < def.moistureRange[0] || moisture > def.moistureRange[1])) continue;
    if (def.seasonWindow && !inWindow(phase, def.seasonWindow)) continue;
    eligible.push(id);
    if (def.sunLoving && nearSun) eligible.push(id);
  }
  return eligible[Math.floor(rng() * eligible.length)] ?? "herbs";
}
