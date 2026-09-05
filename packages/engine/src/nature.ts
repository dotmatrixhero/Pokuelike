/**
 * The 25 real mainline natures and the "tied together" Disposition system —
 * see DESIGN.md's "Individual variance: Nature and Disposition" section.
 * Nature is the single seed for both a stat multiplier (canon) and a
 * behavioral Disposition vector (sim-original, not canon).
 */

/** The five non-HP stats a nature can raise/lower — HP is never affected, matching mainline. */
export type StatKey = "attack" | "defense" | "spAttack" | "spDefense" | "speed";

export interface NatureEffect {
  /** The stat this nature multiplies by 1.1x. Absent for the 5 neutral natures. */
  raises?: StatKey;
  /** The stat this nature multiplies by 0.9x. Absent for the 5 neutral natures. */
  lowers?: StatKey;
}

/**
 * The real mainline nature table (raises 10% / lowers a different stat 10%).
 * Hardy, Docile, Serious, Bashful and Quirky are the 5 neutral natures — no
 * net effect, represented here as neither raising nor lowering anything
 * (rather than raises===lowers on the same stat) since that's the simpler
 * encoding and `natureMultiplier` treats "no raises" and "no lowers" the
 * same as a same-stat cancel either way.
 */
export const NATURES: Record<string, NatureEffect> = {
  Hardy: {},
  Lonely: { raises: "attack", lowers: "defense" },
  Brave: { raises: "attack", lowers: "speed" },
  Adamant: { raises: "attack", lowers: "spAttack" },
  Naughty: { raises: "attack", lowers: "spDefense" },
  Bold: { raises: "defense", lowers: "attack" },
  Docile: {},
  Relaxed: { raises: "defense", lowers: "speed" },
  Impish: { raises: "defense", lowers: "spAttack" },
  Lax: { raises: "defense", lowers: "spDefense" },
  Timid: { raises: "speed", lowers: "attack" },
  Hasty: { raises: "speed", lowers: "defense" },
  Serious: {},
  Jolly: { raises: "speed", lowers: "spAttack" },
  Naive: { raises: "speed", lowers: "spDefense" },
  Modest: { raises: "spAttack", lowers: "attack" },
  Mild: { raises: "spAttack", lowers: "defense" },
  Quiet: { raises: "spAttack", lowers: "speed" },
  Bashful: {},
  Rash: { raises: "spAttack", lowers: "spDefense" },
  Calm: { raises: "spDefense", lowers: "attack" },
  Gentle: { raises: "spDefense", lowers: "defense" },
  Sassy: { raises: "spDefense", lowers: "speed" },
  Careful: { raises: "spDefense", lowers: "spAttack" },
  Quirky: {},
};

export const NATURE_NAMES: readonly string[] = Object.keys(NATURES);

/** Uniform random nature pick — mainline doesn't inherit Nature by default (no Everstone here), so every agent-creation site draws fresh, never from a parent. */
export function randomNature(rng: () => number = Math.random): string {
  return NATURE_NAMES[Math.floor(rng() * NATURE_NAMES.length)];
}

/** 1.1x if this nature raises `stat`, 0.9x if it lowers `stat`, else 1x (including for an unknown/absent nature — callers get neutral stats rather than a throw). */
export function natureMultiplier(nature: string | undefined, stat: StatKey): number {
  const effect = nature ? NATURES[nature] : undefined;
  if (!effect) return 1;
  if (effect.raises === stat) return 1.1;
  if (effect.lowers === stat) return 0.9;
  return 1;
}

/** 0-1 each: how readily an agent flees vs. tolerates threats (boldness), presses fights/hunts (aggression), and seeks company (sociability). See dispositionFromNature for how these are seeded. */
export interface Disposition {
  boldness: number;
  aggression: number;
  sociability: number;
}

/** Per-individual random spread on top of the nature-seeded baseline, so two agents sharing a nature aren't behaviorally identical. Deliberately small relative to the seeding swings above. */
const JITTER_RANGE = 0.15;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Seeds a Disposition from a Nature — the "tied together" mechanism DESIGN.md
 * calls for. All of the mapping rules below are **invented for this sim, not
 * canon** (mainline Nature never touches AI behavior at all):
 *
 *   - Aggression leans higher for natures that raise an Attack-family stat
 *     (physical or special) — reads as "hits harder, presses fights harder."
 *   - Boldness leans higher for natures that raise Speed or lower Defense
 *     (reckless — fast or fragile-by-choice), and lower for natures that
 *     raise Defense or Sp. Defense (cautious — built to tank, so no rush).
 *     Both conditions can stack on one nature (e.g. Hasty: +Speed/-Defense
 *     both push boldness up), which is intentional.
 *   - Sociability has no mainline stat analogue at all, so it's seeded from
 *     the neutral-vs-extreme character of the nature instead: the 5 neutral
 *     natures (no net stat change — an even temperament) seed HIGHER
 *     sociability, while any nature with a real raise/lower pair (a stronger,
 *     more particular personality) seeds LOWER sociability. This is a bare
 *     placeholder rule, not a considered one — see DESIGN.md's "explicitly
 *     still open" note; it exists so sociability isn't just left arbitrary.
 *
 * `rng` defaults to `Math.random` but is injectable for deterministic tests,
 * matching combat.ts's `rollCritical`/`rollAccuracy` convention.
 */
export function dispositionFromNature(nature: string, rng: () => number = Math.random): Disposition {
  const effect = NATURES[nature] ?? {};
  const isNeutral = effect.raises === undefined && effect.lowers === undefined;

  let boldness = 0.5;
  let aggression = 0.5;
  if (effect.raises === "attack" || effect.raises === "spAttack") aggression += 0.2;
  if (effect.raises === "speed") boldness += 0.2;
  if (effect.lowers === "defense") boldness += 0.2;
  if (effect.raises === "defense" || effect.raises === "spDefense") boldness -= 0.2;

  const sociability = isNeutral ? 0.65 : 0.45;

  const jitter = () => (rng() * 2 - 1) * JITTER_RANGE;
  return {
    boldness: clamp01(boldness + jitter()),
    aggression: clamp01(aggression + jitter()),
    sociability: clamp01(sociability + jitter()),
  };
}

function axisLabel(value: number): "low" | "moderate" | "high" {
  if (value < 0.35) return "low";
  if (value > 0.65) return "high";
  return "moderate";
}

/**
 * A short narrative tag for the single most distinctive axis of a
 * Disposition (e.g. "high boldness"), for event-log color — see the `born`
 * event and DESIGN.md's "narrative surface" point. Picks whichever axis
 * deviates furthest from the 0.5 midpoint rather than always reporting
 * boldness, so a fearless-but-average-boldness Timid mon can still read as
 * "high aggression" if that's actually its standout trait.
 */
export function dispositionSummary(disposition: Disposition): string {
  const axes: Array<[string, number]> = [
    ["boldness", disposition.boldness],
    ["aggression", disposition.aggression],
    ["sociability", disposition.sociability],
  ];
  const [name, value] = axes.reduce((a, b) => (Math.abs(b[1] - 0.5) > Math.abs(a[1] - 0.5) ? b : a));
  return `${axisLabel(value)} ${name}`;
}
