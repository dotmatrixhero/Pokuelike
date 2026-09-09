import type { MoveSpec } from "@pokuelike/engine";
import { MOVE_DEX_BY_KEY } from "./dex/index.js";

/**
 * Looks up a move's canon type/category/power/accuracy from the full PokeRogue-
 * derived move dex (`dex/moves.generated.ts`) by `dexKey` (its MoveId enum key,
 * e.g. "VINE_WHIP") — the intended way to source real numbers when adding a new
 * move here, instead of hand-copying them. Assumes an attacking move (dex
 * category "status" isn't representable by `MoveSpec` yet — the sim doesn't
 * model status moves, see TODO.md); pass an explicit `category` override if a
 * looked-up move is ever needed for its status-move fields instead.
 */
export function moveCanon(
  dexKey: string
): Pick<MoveSpec, "type" | "category" | "power" | "accuracy" | "pp"> {
  const entry = MOVE_DEX_BY_KEY[dexKey];
  if (!entry) throw new Error(`moveCanon: no dex entry for key "${dexKey}" (packages/data/src/dex/moves.generated.ts)`);
  if (entry.category === "status") {
    throw new Error(`moveCanon: "${dexKey}" is a status move; MoveSpec only models physical/special attacks (see TODO.md)`);
  }
  return { type: entry.type, category: entry.category, power: entry.power, accuracy: entry.accuracy, pp: entry.pp };
}

/**
 * The status-move counterpart to `moveCanon` above, for the `utilityMove`-
 * flagged roster below (Growth, Agility, Rain Dance, etc.) — every one of
 * these is a real mainline status move (`category: "status"`, `power: 0`),
 * which `moveCanon` deliberately refuses to look up (see its own doc
 * comment). Still sources real type/accuracy from the dex rather than
 * hand-copying them; only `category`/`power` are asserted directly, since
 * a status move's dex `power` is always 0 anyway. A dex accuracy of -1
 * (mainline's "always hits" convention for most status moves) reads as 100
 * here — this engine doesn't consume accuracy at all yet (see `MoveSpec.
 * accuracy`'s own doc comment), so this is purely for a faithful display
 * value, not a gameplay effect.
 */
function statusMoveCanon(dexKey: string): Pick<MoveSpec, "type" | "category" | "power" | "accuracy" | "pp"> {
  const entry = MOVE_DEX_BY_KEY[dexKey];
  if (!entry) throw new Error(`statusMoveCanon: no dex entry for key "${dexKey}" (packages/data/src/dex/moves.generated.ts)`);
  return { type: entry.type, category: "status", power: 0, accuracy: entry.accuracy < 0 ? 100 : entry.accuracy, pp: entry.pp };
}

/**
 * Base move definitions. Type/category/power/accuracy come from the canon dex
 * via `moveCanon`; shape/cooldownTicks/statusChance are sim-specific tuning —
 * shape is still the spec'able axis for later leveling (see DESIGN.md), e.g.
 * Ember: point -> ring, or +radius/-cooldown builds — nothing consumes that yet.
 */
export const MOVES: Record<string, MoveSpec> = {
  tackle: {
    id: "tackle",
    name: "Tackle",
    shape: { kind: "point" },
    ...moveCanon("TACKLE"),
    cooldownTicks: 3,
    range: { min: 0, max: 1 },
    // v2 — Vine Whip's full treatment (MOVES_DESIGN.md's "Tackle" writeup):
    // three branches (Aggression/Boldness/Sociability — Tackle is the most-
    // shared move in the spawned roster, so a Sociability branch earns its
    // keep) plus a crosslink triangle between every pair. Every lever this
    // tree uses (weightScaling, forced movement, agent-modifying passives —
    // damageReduction/regen/immovable/thorns/healAura, statChangeOnHit,
    // situationalBonus, targetsAlly/allyEffect, lifestealFraction,
    // recoilFraction, critRateStage, jamCooldownTicks, hitsArea) is real,
    // shipped engine plumbing — see MOVES_DESIGN.md's primitives checklist.
    // Two things from the paper draft are deliberately NOT here: Max PP
    // (`maxPPBonus`/`ppCost`) is a whole new resource axis, its own
    // follow-up project — every "+1 Max PP" filler became a real, already-
    // used filler type instead; and `aggroRedirect` (a taunt-style passive)
    // was never actually built, so Bulwark grants extra `damageReduction`
    // instead of a targeting effect that doesn't exist.
    tree: {
      weighted_charge: {
        id: "weighted_charge",
        name: "Weighted Charge",
        cost: 1,
        leaning: "aggression",
        // Bonus power scales with the user's own bulk — a Venusaur throwing
        // its weight around lands very differently than a Diglett doing the
        // same (see MoveSpec.weightScaling's own doc comment).
        delta: { weightScaling: { factor: 0.15 }, accuracy: -5 },
      },
      momentum_grip: {
        id: "momentum_grip",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["weighted_charge"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      hardened_knuckles: {
        id: "hardened_knuckles",
        name: "+10 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["momentum_grip"], ["grounded_fury"], ["vanguard_charge"]],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      bracing_impact: {
        id: "bracing_impact",
        name: "Bracing Impact",
        cost: 1,
        prerequisites: ["hardened_knuckles"],
        leaning: "aggression",
        // A landed, non-killing hit shoves the target back two whole tiles —
        // denying easy follow-up range harder than v1's one-tile shove.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 2, timing: "onHit" } },
      },
      aftershock: {
        id: "aftershock",
        name: "Aftershock",
        cost: 1,
        prerequisites: ["bracing_impact"],
        leaning: "aggression",
        delta: { defensePenetration: 0.12 },
      },
      full_force_slam: {
        id: "full_force_slam",
        name: "Full-Force Slam",
        cost: 1,
        prerequisites: ["aftershock"],
        excludes: ["relentless_charge"],
        leaning: "aggression",
        // Commits fully — a heavier, slower slam that costs the user
        // something too, in recoil.
        delta: { power: 20, cooldownTicks: 1, recoilFraction: 0.08 },
      },
      relentless_charge: {
        id: "relentless_charge",
        name: "Relentless Charge",
        cost: 1,
        prerequisites: ["aftershock"],
        excludes: ["full_force_slam"],
        leaning: "aggression",
        // Two quicker, lighter blows instead of one big one — more chances
        // for either to land clean.
        delta: { hits: { min: 2, max: 2 }, power: -15, critRateStage: 1 },
      },
      unstoppable_momentum: {
        id: "unstoppable_momentum",
        name: "Unstoppable Momentum",
        cost: 2,
        prerequisitesAnyOf: [["full_force_slam"], ["relentless_charge"]],
        leaning: "aggression",
        // After a landed hit, immediately closes in on whatever's next — a
        // heavy hitter that never really stops moving.
        delta: { power: 10, forcedMovement: { mover: "attacker", direction: "closer", tiles: 3, timing: "onHit" } },
      },
      aggression_capstone_filler: {
        id: "aggression_capstone_filler",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["unstoppable_momentum"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      tremor_break: {
        id: "tremor_break",
        name: "Tremor Break",
        cost: 2,
        prerequisites: ["aggression_capstone_filler"],
        leaning: "aggression",
        // The impact doesn't stop at one target — it ripples outward,
        // shoving back everyone standing nearby.
        delta: {
          shape: { kind: "ring", radius: 1 },
          hitsArea: true,
          power: -10,
          forcedMovement: { mover: "defender", direction: "away", tiles: 2, timing: "onHit" },
        },
      },
      // Crosslink: Aggression <-> Boldness — a jolt of confidence off an
      // already-braced, powerful hit, Boldness's sturdiness feeding
      // Aggression's swing.
      grounded_fury: {
        id: "grounded_fury",
        name: "Grounded Fury",
        cost: 1,
        prerequisites: ["weighted_charge", "iron_hide"],
        leaning: "aggression",
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 12 } },
      },
      iron_hide: {
        id: "iron_hide",
        name: "Iron Hide",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 2 },
        delta: {},
      },
      sturdy_stance: {
        id: "sturdy_stance",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["iron_hide"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      grounded_hit: {
        id: "grounded_hit",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["sturdy_stance"], ["grounded_fury"], ["guardians_stand"]],
        leaning: "boldness",
        delta: { power: 5 },
      },
      second_wind: {
        id: "second_wind",
        name: "Second Wind",
        cost: 1,
        prerequisites: ["grounded_hit"],
        leaning: "boldness",
        // A real, felt recovery rhythm — bought by trading away some
        // precision to fight sustainably instead of going all-out.
        grantsPassive: { kind: "regenFlat", value: 2.25 },
        delta: { accuracy: -5 },
      },
      weathered_grip: {
        id: "weathered_grip",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["second_wind"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      counter_slam: {
        id: "counter_slam",
        name: "Counter Slam",
        cost: 1,
        prerequisites: ["weathered_grip"],
        excludes: ["steady_guard"],
        leaning: "boldness",
        // Swings hardest at a target that hasn't turned to face the threat yet.
        delta: { power: 10, situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      steady_guard: {
        id: "steady_guard",
        name: "Steady Guard",
        cost: 1,
        prerequisites: ["weathered_grip"],
        excludes: ["counter_slam"],
        leaning: "boldness",
        // A patient, precise style that never overextends — recoups a real
        // fraction of what it deals.
        delta: { accuracy: 5, lifestealFraction: 0.12 },
      },
      immovable: {
        id: "immovable",
        name: "Immovable",
        cost: 2,
        prerequisitesAnyOf: [["counter_slam"], ["steady_guard"]],
        leaning: "boldness",
        // Plants and refuses to be moved — no drag, knockback, or lunge so
        // much as budges it.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: { power: 10 },
      },
      boldness_capstone_filler: {
        id: "boldness_capstone_filler",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["immovable"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      thornguard: {
        id: "thornguard",
        name: "Thornguard",
        cost: 2,
        prerequisites: ["boldness_capstone_filler"],
        leaning: "boldness",
        // Standing this firm has its own cost for whoever's still hitting it.
        grantsPassive: { kind: "thorns", value: 0.15 },
        delta: {},
      },
      // Crosslink: Boldness <-> Sociability — extends a bit of that thick
      // hide to whoever's fighting alongside.
      guardians_stand: {
        id: "guardians_stand",
        name: "Guardian's Stand",
        cost: 1,
        prerequisites: ["iron_hide", "steadfast_guard"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: {},
      },
      steadfast_guard: {
        id: "steadfast_guard",
        name: "Steadfast Guard",
        cost: 1,
        leaning: "sociability",
        // Shares a braced stance with the nearest threatened herd-mate.
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      watchful_stance: {
        id: "watchful_stance",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["steadfast_guard"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      herd_instinct: {
        id: "herd_instinct",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["watchful_stance"], ["guardians_stand"], ["vanguard_charge"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      rally_cry: {
        id: "rally_cry",
        name: "Rally Cry",
        cost: 1,
        prerequisites: ["herd_instinct"],
        leaning: "sociability",
        // A shared burst of resolve, sharpening a herd-mate's next few strikes.
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      close_ranks: {
        id: "close_ranks",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["rally_cry"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      bulwark_stance: {
        id: "bulwark_stance",
        name: "Bulwark Stance",
        cost: 1,
        prerequisites: ["close_ranks"],
        excludes: ["front_line"],
        leaning: "sociability",
        // Turtles up to keep standing between the herd and harm.
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: { power: -5 },
      },
      front_line: {
        id: "front_line",
        name: "Front Line",
        cost: 1,
        prerequisites: ["close_ranks"],
        excludes: ["bulwark_stance"],
        leaning: "sociability",
        // Charges in ahead of the herd, hitting hard enough to throw off the
        // target's own rhythm.
        delta: { power: 15, jamCooldownTicks: 1 },
      },
      bulwark: {
        id: "bulwark",
        name: "Bulwark",
        cost: 2,
        prerequisitesAnyOf: [["bulwark_stance"], ["front_line"]],
        leaning: "sociability",
        // A last line that doesn't move and doesn't quit — soaks up real
        // damage doing it.
        grantsPassive: { kind: "damageReduction", value: 0.08 },
        delta: { power: 10 },
      },
      sociability_capstone_filler: {
        id: "sociability_capstone_filler",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["bulwark"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      guardians_aura: {
        id: "guardians_aura",
        name: "Guardian's Aura",
        cost: 2,
        prerequisites: ["sociability_capstone_filler"],
        leaning: "sociability",
        // Just standing near this Tackle-user mends the herd, slowly, all on
        // its own — no move needed, no cooldown to manage.
        grantsPassive: { kind: "healAura", value: 0.01 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — charges in specifically at
      // whatever's caught off guard menacing the herd.
      vanguard_charge: {
        id: "vanguard_charge",
        name: "Vanguard Charge",
        cost: 1,
        prerequisites: ["steadfast_guard", "weighted_charge"],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.25 } },
      },
    },
  },
  slash: {
    id: "slash",
    name: "Slash",
    shape: { kind: "line", length: 1 },
    ...moveCanon("SLASH"),
    cooldownTicks: 5,
    range: { min: 0, max: 1 },
    // v2 — scaled up to the same triangle as Tackle: Ferocity (Aggression),
    // Precision (Boldness), and a slimmer Pack Instinct (Sociability) — even
    // a mostly-solo hunter like Scyther coordinates around a kill often
    // enough to earn a real, if lighter, support branch. Ferocity leans on
    // defense-penetration and crit rate instead of the usual power/accuracy
    // trade; Precision earns its accuracy focus by being the one branch
    // that's genuinely about precision. See MOVES_DESIGN.md's "Slash"
    // writeup and Tackle's own tree comment for what's deliberately not
    // here (Max PP, `aggroRedirect`).
    tree: {
      honed_edge: {
        id: "honed_edge",
        name: "Honed Edge",
        cost: 1,
        leaning: "aggression",
        // A wickedly sharp edge that shears through armor as much as flesh.
        delta: { power: 15, defensePenetration: 0.15 },
      },
      raking_claws: {
        id: "raking_claws",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["honed_edge"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      quick_reflexes: {
        id: "quick_reflexes",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["raking_claws"],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      harder_swing: {
        id: "harder_swing",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["quick_reflexes"], ["brutal_efficiency"], ["ambush_pack"]],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      predators_instinct: {
        id: "predators_instinct",
        name: "Predator's Instinct",
        cost: 1,
        prerequisites: ["harder_swing"],
        leaning: "aggression",
        // An ambush predator's edge — hits harder after dark.
        delta: { situationalBonus: { condition: "night", multiplier: 1.3 } },
      },
      sharpened_focus: {
        id: "sharpened_focus",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["predators_instinct"],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      coup_de_grace: {
        id: "coup_de_grace",
        name: "Coup de Grace",
        cost: 1,
        prerequisites: ["sharpened_focus"],
        leaning: "aggression",
        // Anything already burned, poisoned, paralyzed, asleep, or frozen
        // goes down twice as fast — a predator finishing off whatever's
        // already weakened, not fussy about the cause.
        delta: { situationalBonus: { condition: "targetStatused", multiplier: 2 } },
      },
      reaping_slash: {
        id: "reaping_slash",
        name: "Reaping Slash",
        cost: 2,
        prerequisites: ["coup_de_grace"],
        excludes: ["frenzy_cutter", "cleaving_slash"],
        leaning: "aggression",
        // A committed, all-in follow-through — locks the user out of its
        // next action tick, but a hit this precise finds weak points more often.
        delta: { power: 25, cooldownTicks: 1, lockTicks: 2, critRateStage: 1 },
      },
      frenzy_cutter: {
        id: "frenzy_cutter",
        name: "Frenzy Cutter",
        cost: 2,
        prerequisites: ["coup_de_grace"],
        excludes: ["reaping_slash", "cleaving_slash"],
        leaning: "aggression",
        // Several quick, lighter cuts, reckless enough to nick the user too.
        delta: { hits: { min: 2, max: 3 }, power: -20, recoilFraction: 0.05 },
      },
      cleaving_slash: {
        id: "cleaving_slash",
        name: "Cleaving Slash",
        cost: 2,
        prerequisites: ["coup_de_grace"],
        excludes: ["reaping_slash", "frenzy_cutter"],
        leaning: "aggression",
        // A wide, sweeping arc that catches everyone standing in front of
        // it, not just the one target it was aimed at.
        delta: { shape: { kind: "cone", length: 1, width: 2 }, hitsArea: true, power: -15 },
      },
      apex_predator: {
        id: "apex_predator",
        name: "Apex Predator",
        cost: 2,
        prerequisitesAnyOf: [["reaping_slash"], ["frenzy_cutter"], ["cleaving_slash"]],
        leaning: "aggression",
        // The culmination of raw aggression — every strike from here carries
        // real killing intent.
        delta: { power: 10, critRateStage: 1 },
      },
      ferocity_capstone_filler: {
        id: "ferocity_capstone_filler",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["apex_predator"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      merciless: {
        id: "merciless",
        name: "Merciless",
        cost: 2,
        prerequisites: ["ferocity_capstone_filler"],
        leaning: "aggression",
        // Even a hide built to shrug off a Normal-type hit doesn't fully
        // blunt this anymore.
        delta: { resistanceBreaker: { multiplier: 1.5 } },
      },
      // Crosslink: Aggression <-> Boldness — a precise cut placed exactly
      // where it slows the target's own next move.
      brutal_efficiency: {
        id: "brutal_efficiency",
        name: "Brutal Efficiency",
        cost: 1,
        prerequisites: ["honed_edge", "keen_eye"],
        leaning: "aggression",
        delta: { jamCooldownTicks: 1 },
      },
      keen_eye: {
        id: "keen_eye",
        name: "Keen Eye",
        cost: 1,
        leaning: "boldness",
        // Reads an opening better than most — Precision's whole reason to
        // exist is accuracy, so this one earns the stat.
        delta: { accuracy: 15 },
      },
      light_footing: {
        id: "light_footing",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["keen_eye"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      steady_hand: {
        id: "steady_hand",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["light_footing"], ["brutal_efficiency"], ["watchful_pack"]],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      feint: {
        id: "feint",
        name: "Feint",
        cost: 1,
        prerequisites: ["steady_hand"],
        leaning: "boldness",
        // Closes to melee as part of using the move, before the hit itself
        // resolves.
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" } },
      },
      quickstep: {
        id: "quickstep",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["feint"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      opportunists_strike: {
        id: "opportunists_strike",
        name: "Opportunist's Strike",
        cost: 1,
        prerequisites: ["quickstep"],
        excludes: ["calculated_retreat"],
        leaning: "boldness",
        // Punishes a target that hasn't turned to face the threat yet.
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      calculated_retreat: {
        id: "calculated_retreat",
        name: "Calculated Retreat",
        cost: 1,
        prerequisites: ["quickstep"],
        excludes: ["opportunists_strike"],
        leaning: "boldness",
        // Strikes, then immediately steps back out of range — never sticks
        // around for the counter.
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 1, timing: "onHit" }, accuracy: 10 },
      },
      flawless_form: {
        id: "flawless_form",
        name: "Flawless Form",
        cost: 2,
        prerequisitesAnyOf: [["opportunists_strike"], ["calculated_retreat"]],
        leaning: "boldness",
        // A style so refined it barely wastes a drop of momentum — or blood.
        delta: { accuracy: 20, lifestealFraction: 0.1 },
      },
      precision_capstone_filler: {
        id: "precision_capstone_filler",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["flawless_form"],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      perfect_strike: {
        id: "perfect_strike",
        name: "Perfect Strike",
        cost: 2,
        prerequisites: ["precision_capstone_filler"],
        leaning: "boldness",
        // About as close to a guaranteed, clean hit as this sim's accuracy
        // math allows.
        delta: { power: 15, accuracy: 10 },
      },
      // Crosslink: Boldness <-> Sociability — watching each other's blind
      // spots means fewer clean hits land. Refined per feedback: converted
      // from a flat damageReduction (already the default lever for most
      // "tanky branch" nodes across every tree) to a real Defense-stat
      // buff — "watchful" isn't an armor/hide fiction, so a stat buff (also
      // physical-only for free, unlike damageReduction's indiscriminate
      // blunting) reads truer to the name.
      watchful_pack: {
        id: "watchful_pack",
        name: "Watchful Pack",
        cost: 1,
        prerequisites: ["keen_eye", "shared_scent"],
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.5 },
        delta: {},
      },
      shared_scent: {
        id: "shared_scent",
        name: "Shared Scent",
        cost: 1,
        leaning: "sociability",
        // Marks a kill for kin to follow in on, sharpening their own strikes.
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 15 } } },
      },
      scavengers_patience: {
        id: "scavengers_patience",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["shared_scent"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      kin_sense: {
        id: "kin_sense",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["scavengers_patience"], ["watchful_pack"], ["ambush_pack"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      coordinated_strike: {
        id: "coordinated_strike",
        name: "Coordinated Strike",
        cost: 1,
        prerequisites: ["kin_sense"],
        leaning: "sociability",
        // Fighting where another of its kind can back it up breeds real confidence.
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 10 } },
      },
      pack_rhythm: {
        id: "pack_rhythm",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["coordinated_strike"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      opportunist_scavenger: {
        id: "opportunist_scavenger",
        name: "Opportunist Scavenger",
        cost: 1,
        prerequisites: ["pack_rhythm"],
        excludes: ["territorial_snarl"],
        leaning: "sociability",
        // Feeds off scraps between fights, recovering quietly.
        grantsPassive: { kind: "regenFlat", value: 0.75 },
        delta: { power: -5 },
      },
      territorial_snarl: {
        id: "territorial_snarl",
        name: "Territorial Snarl",
        cost: 1,
        prerequisites: ["pack_rhythm"],
        excludes: ["opportunist_scavenger"],
        leaning: "sociability",
        // A wounded rival gets no mercy — least of all from something with
        // backup nearby.
        delta: { situationalBonus: { condition: "targetLowHp", multiplier: 1.3 } },
      },
      alpha_strike: {
        id: "alpha_strike",
        name: "Alpha Strike",
        cost: 2,
        prerequisitesAnyOf: [["opportunist_scavenger"], ["territorial_snarl"]],
        leaning: "sociability",
        // A relentless, all-in style that shrugs off punishment better than
        // it has any right to.
        grantsPassive: { kind: "damageReduction", value: 0.1 },
        delta: { power: 10 },
      },
      pack_capstone_filler: {
        id: "pack_capstone_filler",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["alpha_strike"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      united_front: {
        id: "united_front",
        name: "United Front",
        cost: 2,
        prerequisites: ["pack_capstone_filler"],
        leaning: "sociability",
        // The whole point of a pack — mends and steadies a herd-mate in one
        // motion, not two separate errands.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.1, buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      // Crosslink: Sociability <-> Aggression — a coordinated ambush catches
      // even a wary target off guard.
      ambush_pack: {
        id: "ambush_pack",
        name: "Ambush Pack",
        cost: 1,
        prerequisites: ["shared_scent", "honed_edge"],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.3 } },
      },
    },
  },
  vine_whip: {
    id: "vine_whip",
    name: "Vine Whip",
    shape: { kind: "line", length: 2 },
    ...moveCanon("VINE_WHIP"),
    cooldownTicks: 3,
    range: { min: 0, max: 2 },
    // v2 (MOVES_DESIGN.md's own template). Direct follow-up: "we don't
    // have vine whip? i thought we designed it..." — a fair catch. Vine
    // Whip's paper draft (named nodes like "Snapback Lash") was the
    // original prototype that PROVED the v2 template, but the actual
    // shipped v2 trees ended up going to Tackle/Slash/Ember/Body Slam
    // instead — Vine Whip itself was never built. This is that build,
    // finally, using the same three-branch-plus-crosslink-triangle shape
    // (10 nodes/branch + 3 crosslinks = 33), Bulbasaur's own real
    // signature move (spawned in every run, unlike Body Slam's Snorlax).
    // Every lever below is already-shipped engine plumbing (see the
    // primitives checklist) — no new engine work needed for this one.
    tree: {
      // --- Aggression: "Choking Grip" — the vines don't just strike, they
      // squeeze, drain, and drag the target in close.
      choking_grip: {
        id: "choking_grip",
        name: "Choking Grip",
        cost: 1,
        leaning: "aggression",
        delta: { lifestealFraction: 0.1 },
      },
      tendril_lash: {
        id: "tendril_lash",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["choking_grip"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      reaching_vines: {
        id: "reaching_vines",
        name: "+10 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["tendril_lash"], ["snapback_lash"], ["thorned_bouquet"]],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      crushing_coil: {
        id: "crushing_coil",
        name: "Crushing Coil",
        cost: 1,
        prerequisites: ["reaching_vines"],
        leaning: "aggression",
        // The wrap tightens past whatever guard the target's got up.
        delta: { defensePenetration: 0.15 },
      },
      deeper_hold: {
        id: "deeper_hold",
        name: "Deeper Hold",
        cost: 1,
        prerequisitesAnyOf: [["crushing_coil"], ["hauled_in"], ["bloom_of_thorns"]],
        leaning: "aggression",
        delta: { lifestealFraction: 0.08 },
      },
      throttling_grip: {
        id: "throttling_grip",
        name: "Throttling Grip",
        cost: 1,
        prerequisites: ["deeper_hold"],
        excludes: ["constricting_pull"],
        leaning: "aggression",
        // A harder squeeze at the cost of precision.
        delta: { lifestealFraction: 0.1, accuracy: -5 },
      },
      constricting_pull: {
        id: "constricting_pull",
        name: "Constricting Pull",
        cost: 1,
        prerequisites: ["deeper_hold"],
        excludes: ["throttling_grip"],
        leaning: "aggression",
        // Drags the target in close instead — sets up whatever comes next.
        delta: { power: 5, forcedMovement: { mover: "defender", direction: "closer", tiles: 1, timing: "onHit" } },
      },
      unbreakable_hold: {
        id: "unbreakable_hold",
        name: "Unbreakable Hold",
        cost: 2,
        prerequisitesAnyOf: [["throttling_grip"], ["constricting_pull"]],
        leaning: "aggression",
        // Actually delivers on the name now — the grip itself denies the
        // target's own tempo, not just more power.
        delta: { power: 5, jamCooldownTicks: 1 },
      },
      sapping_reach: {
        id: "sapping_reach",
        name: "Sapping Reach",
        cost: 1,
        prerequisites: ["unbreakable_hold"],
        leaning: "aggression",
        // SKILL_TREE_GUIDE.md step 2 (the environmental-hook pass this
        // tree never got): Vine Whip's vines ARE plant matter, so a
        // Bulbasaur standing in real flora can draw on it — the same
        // shape as Rock Throw's boulder-consumption, on the terrain kind
        // this move's own fantasy actually cares about. Genuinely
        // double-edged, which is the point: the tile reverts to plain
        // floor, so every big hit costs the map a real flora tile (and
        // whatever was growing on it). 2x rather than Rock Throw's 3x
        // because flora is common terrain and boulder isn't.
        // Also fixes a flagged name/mechanic mismatch: the id promised
        // "sapping" and "reach" while the node delivered a flat +5 Power.
        delta: { consumesOwnTerrain: { terrain: "flora", damageMultiplier: 2 } },
      },
      endless_lashing: {
        id: "endless_lashing",
        name: "Endless Lashing",
        cost: 2,
        prerequisites: ["sapping_reach"],
        leaning: "aggression",
        // A flurry of draining lashes instead of one grip — more chances to
        // land, more life drained doing it.
        delta: { hits: { min: 2, max: 3 }, lifestealFraction: 0.1 },
      },
      // Crosslink: Aggression <-> Boldness — the original paper draft's own
      // named node. A rooted plant's reach doesn't just strike, it can drag
      // what it catches in close.
      snapback_lash: {
        id: "snapback_lash",
        name: "Snapback Lash",
        cost: 1,
        prerequisites: ["choking_grip", "deep_roots"],
        leaning: "aggression",
        delta: { range: { max: 3 }, forcedMovement: { mover: "defender", direction: "closer", tiles: 1, timing: "onHit" } },
      },
      reeling_lash: {
        id: "reeling_lash",
        name: "Reeling Lash",
        cost: 1,
        prerequisites: ["snapback_lash"],
        leaning: "aggression",
        // Bridge tail (SKILL_TREE_GUIDE.md step 8 / MOVES_DESIGN.md principle 7):
        // deepens Snapback Lash's own drag rather than bolting on a stat.
        delta: { forcedMovement: { mover: "defender", direction: "closer", tiles: 2, timing: "onHit" } },
      },
      hauled_in: {
        id: "hauled_in",
        name: "Hauled In",
        cost: 2,
        prerequisites: ["reeling_lash"],
        leaning: "boldness",
        // Hauling something in that hard costs precision — a real tradeoff in
        // the same node, not a flat power bolt-on.
        delta: { power: 15, accuracy: -5 },
      },
      // --- Boldness: "Root and Bind" — a plant that digs in and refuses to
      // be moved, its own hide toughening the longer a fight runs.
      deep_roots: {
        id: "deep_roots",
        name: "Deep Roots",
        cost: 1,
        leaning: "boldness",
        // The branch's own stated fantasy is "refuses to be moved" — this
        // now actually delivers that (no drag/knockback/lunge budges it),
        // not a generic damage-reduction stand-in for it.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      thick_vines: {
        id: "thick_vines",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["deep_roots"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      tangled_growth: {
        id: "tangled_growth",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["thick_vines"], ["snapback_lash"], ["grafted_vines"]],
        leaning: "boldness",
        delta: { power: 5 },
      },
      unyielding_stem: {
        id: "unyielding_stem",
        name: "Unyielding Stem",
        cost: 1,
        prerequisites: ["tangled_growth"],
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.05 },
        delta: {},
      },
      deeper_roots: {
        id: "deeper_roots",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["unyielding_stem"], ["hauled_in"], ["living_trellis"]],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      verdant_recovery: {
        id: "verdant_recovery",
        name: "Verdant Recovery",
        cost: 1,
        prerequisites: ["deeper_roots"],
        excludes: ["thornbound"],
        leaning: "boldness",
        // Draws steady nourishment straight from the ground it's rooted in.
        grantsPassive: { kind: "regenFlat", value: 3 },
        delta: {},
      },
      thornbound: {
        id: "thornbound",
        name: "Thornbound",
        cost: 1,
        prerequisites: ["deeper_roots"],
        excludes: ["verdant_recovery"],
        leaning: "boldness",
        grantsPassive: { kind: "thorns", value: 0.12 },
        delta: {},
      },
      ironbark: {
        id: "ironbark",
        name: "Ironbark",
        cost: 2,
        prerequisitesAnyOf: [["verdant_recovery"], ["thornbound"]],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.07 },
        delta: {},
      },
      hardened_bark: {
        id: "hardened_bark",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["ironbark"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      bramble_ward: {
        id: "bramble_ward",
        name: "Bramble Ward",
        cost: 2,
        prerequisites: ["hardened_bark"],
        leaning: "boldness",
        // The woodier hide grows thorns of its own — a real "two passives,
        // one keystone" finale.
        grantsPassives: [
          { kind: "defenseBoost", value: 0.08 },
          { kind: "thorns", value: 0.08 },
        ],
        delta: {},
      },
      // Crosslink: Boldness <-> Sociability — the same tangled root network
      // that anchors it can trade places with a struggling ally, hauling
      // them clear through the underbrush.
      grafted_vines: {
        id: "grafted_vines",
        name: "Grafted Vines",
        cost: 1,
        prerequisites: ["deep_roots", "nurturing_tendrils"],
        leaning: "sociability",
        delta: { positionSwap: true, positionSwapPull: 1 },
      },
      deeper_graft: {
        id: "deeper_graft",
        name: "Deeper Graft",
        cost: 1,
        prerequisites: ["grafted_vines"],
        leaning: "sociability",
        // Deepens Grafted Vines' own swap-pull — the ally comes further out.
        delta: { positionSwapPull: 1 },
      },
      living_trellis: {
        id: "living_trellis",
        name: "Living Trellis",
        cost: 2,
        prerequisites: ["deeper_graft"],
        leaning: "boldness",
        // The same lattice that hauls an ally clear also braces the holder.
        grantsPassive: { kind: "damageReduction", value: 0.06 },
        delta: { positionSwapPull: 1 },
      },
      // Crosslink: Sociability <-> Aggression — the gentlest touch turns
      // vicious in a heartbeat once something's actually threatened.
      thorned_bouquet: {
        id: "thorned_bouquet",
        name: "Thorned Bouquet",
        cost: 1,
        prerequisites: ["nurturing_tendrils", "choking_grip"],
        leaning: "aggression",
        delta: { critRateStage: 1 },
      },
      honed_thorns: {
        id: "honed_thorns",
        name: "Honed Thorns",
        cost: 1,
        prerequisites: ["thorned_bouquet"],
        leaning: "aggression",
        // Deepens Thorned Bouquet's own crit lever directly.
        delta: { critRateStage: 1 },
      },
      bloom_of_thorns: {
        id: "bloom_of_thorns",
        name: "Bloom of Thorns",
        cost: 2,
        prerequisites: ["honed_thorns"],
        leaning: "sociability",
        // A landed crit now feeds straight back into tempo — the real
        // crit-fisher payoff that crit stage alone was only half of.
        delta: { critCooldownReset: true },
      },
      // --- Sociability: "Shared Growth" — Bulbasaur's own real nurturing
      // instinct (the same fantasy leech_seed already leans on), tending to
      // whoever's fighting alongside it instead of just itself.
      nurturing_tendrils: {
        id: "nurturing_tendrils",
        name: "Nurturing Tendrils",
        cost: 1,
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.15 } },
      },
      verdant_reach: {
        id: "verdant_reach",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["nurturing_tendrils"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      binding_roots: {
        id: "binding_roots",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["verdant_reach"], ["grafted_vines"], ["thorned_bouquet"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      shared_vigor: {
        id: "shared_vigor",
        name: "Shared Vigor",
        cost: 1,
        prerequisites: ["binding_roots"],
        leaning: "sociability",
        delta: { allyEffect: { healFraction: 0.2, buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      quickening_growth: {
        id: "quickening_growth",
        name: "Quickening Growth",
        cost: 1,
        prerequisitesAnyOf: [["shared_vigor"], ["living_trellis"], ["bloom_of_thorns"]],
        leaning: "sociability",
        // Direct correction: "Vine whip too... Reduce the amount of time
        // to harvest crops." Vine Whip already qualifies as a canopy
        // harvest move (needs.ts picks any off-cooldown damage move, and
        // scales the burst by `range.max` — this move's reach of 2 is
        // already worth a bonus there). `gatherBurst` makes the vines
        // genuinely better at bringing fruit down, which lands squarely in
        // the branch that's about feeding the herd rather than fighting.
        // Also retires one of two identical "+5 Power" fillers this branch
        // was padded with.
        delta: { gatherBurst: 3 },
      },
      vine_network: {
        id: "vine_network",
        name: "Vine Network",
        cost: 1,
        prerequisites: ["quickening_growth"],
        excludes: ["bracing_growth"],
        leaning: "sociability",
        // Deepens the heal, keeping the defense buff it's already carrying.
        delta: { allyEffect: { healFraction: 0.3, buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      bracing_growth: {
        id: "bracing_growth",
        name: "Bracing Growth",
        cost: 1,
        prerequisites: ["quickening_growth"],
        excludes: ["vine_network"],
        leaning: "sociability",
        // Trades the healing lean for a real Attack buff instead.
        delta: { allyEffect: { healFraction: 0.1, buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      reaching_growth: {
        id: "reaching_growth",
        name: "Reaching Growth",
        cost: 2,
        prerequisitesAnyOf: [["vine_network"], ["bracing_growth"]],
        leaning: "sociability",
        // The ally effect now also fires the instant this hits an enemy,
        // on top of its own dedicated idle-tick use — no extra cost.
        delta: { allyEffectOnAttack: true },
      },
      deep_bond: {
        id: "deep_bond",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["reaching_growth"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      verdant_grove: {
        id: "verdant_grove",
        name: "Verdant Grove",
        cost: 2,
        prerequisites: ["deep_bond"],
        leaning: "sociability",
        // Just growing near this Bulbasaur mends the herd, and the ground
        // it's rooted in grows sturdier under its care too — a real
        // "two passives, one keystone" finale, not just a bigger heal.
        grantsPassives: [
          { kind: "healAura", value: 0.015 },
          { kind: "defenseBoost", value: 0.03 },
        ],
        delta: {},
      },
    },
  },
  ember: {
    id: "ember",
    name: "Ember",
    shape: { kind: "point" },
    ...moveCanon("EMBER"),
    cooldownTicks: 3,
    statusChance: 0.1,
    statusKind: "burn",
    range: { min: 0, max: 1 },
    // v2 — scaled up to the full triangle: Wildfire (Aggression), Ring of
    // Fire (Boldness), and a new Hearthfire (Sociability) — sharing warmth
    // and healing rather than just standing guard, a genuinely different
    // flavor of support branch than Tackle's/Slash's own. Cooldown and
    // status-chance carry a real share of the filler slots here, since Ember
    // already starts with both on its base spec. Wild agents auto-respec
    // into this via `maybeAutoRespec` (leveling.ts) as they earn skill
    // points, weighted by their own Disposition against each node's
    // `leaning` — see DESIGN.md's "Specialization" section, and Tackle's own
    // tree comment for what's deliberately not here (Max PP, `aggroRedirect`).
    tree: {
      wider_burn: {
        id: "wider_burn",
        name: "Wider Burn",
        cost: 1,
        leaning: "aggression",
        // The node that puts fire on the map, and its placement is measured
        // rather than chosen for flavor. Ignition started on Flamethrower's
        // Wildfire's Reach and produced ZERO ignitions in 20k ticks;
        // Ember's `wildfire_burst` (cost 3) also zero; `hot_coals` (depth 5)
        // reached 9 of 360 living agents and fought 18 of 1217 fights, for
        // exactly ONE fire across 6 seeds. A mechanic that is shipped,
        // tested, rendered, and never seen is not shipped.
        //
        // So it belongs on the opener of the fire-starting move — Ember is
        // known by six species entries to Flamethrower's one, and "Wider
        // Burn" is a name that already promises the flame catching what is
        // around it. Fuel is only ~5% of a real map, so even at full uptake
        // this stays occasional rather than constant.
        delta: { statusChance: 0.15, cooldownTicks: 0, terrainBurn: true },
      },
      kindling: {
        id: "kindling",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["wider_burn"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      steady_flame: {
        id: "steady_flame",
        name: "Steady Flame",
        cost: 1,
        prerequisitesAnyOf: [["kindling"], ["smoldering_ring"], ["kindled_fury"]],
        leaning: "aggression",
        delta: { statusChance: 0.05 },
      },
      roaring_blaze: {
        id: "roaring_blaze",
        name: "Roaring Blaze",
        cost: 2,
        prerequisites: ["steady_flame"],
        leaning: "aggression",
        delta: { power: 15, accuracy: -5 },
      },
      hot_coals: {
        id: "hot_coals",
        name: "Hot Coals",
        cost: 1,
        prerequisites: ["roaring_blaze"],
        leaning: "aggression",
        // Renamed off "+5% status chance" — a real name for a real node.
        delta: { statusChance: 0.05 },
      },
      fan_the_flames: {
        id: "fan_the_flames",
        name: "Fan the Flames",
        cost: 1,
        prerequisites: ["hot_coals"],
        leaning: "aggression",
        // A target already burning takes double — the fire doesn't have to
        // start the job every time, just finish what an earlier hit lit.
        delta: { situationalBonus: { condition: "targetBurning", multiplier: 2 } },
      },
      inferno: {
        id: "inferno",
        name: "Inferno",
        cost: 3,
        prerequisites: ["fan_the_flames"],
        excludes: ["wildfire_burst"],
        leaning: "aggression",
        delta: { shape: { kind: "line", length: 2 }, range: { max: 2 }, statusChance: 0.1 },
      },
      wildfire_burst: {
        id: "wildfire_burst",
        name: "Wildfire Burst",
        cost: 3,
        prerequisites: ["fan_the_flames"],
        excludes: ["inferno"],
        leaning: "aggression",
        // The flame doesn't stay contained to one line anymore — it catches
        // everything nearby, including the caster's own footing. `terrainBurn`
        // makes that literal: this is the node that actually starts a fire
        // (fire.ts), which then burns down flora and spreads on its own.
        //
        // Deliberately placed here rather than only on Flamethrower's
        // Wildfire's Reach, which was the sole terrainBurn node and produced
        // ZERO ignitions across a 20k-tick run — Flamethrower is known by one
        // species entry, Ember by six. This is also what makes the
        // Inferno/Wildfire Burst fork a real choice rather than "line vs
        // burst": reach and status severity, against an area that sets the
        // ground alight and keeps burning after you have moved on.
        delta: { shape: { kind: "burst", radius: 1 }, hitsArea: true, power: -10, terrainBurn: true },
      },
      pyroclasm: {
        id: "pyroclasm",
        name: "Pyroclasm",
        cost: 2,
        prerequisitesAnyOf: [["inferno"], ["wildfire_burst"]],
        leaning: "aggression",
        // A blaze this size singes the caster too.
        delta: { power: 15, recoilFraction: 0.05 },
      },
      wildfire_capstone_filler: {
        id: "wildfire_capstone_filler",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["pyroclasm"],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      spreading_blaze: {
        id: "spreading_blaze",
        name: "Spreading Blaze",
        cost: 2,
        prerequisites: ["wildfire_capstone_filler"],
        leaning: "aggression",
        // A burn this fierce doesn't stay put — it has a real chance to
        // catch on whatever's standing next to the target too.
        delta: { statusSpreads: true },
      },
      // Crosslink: Aggression <-> Boldness — the lingering heat leaves
      // scorched, weaker defenses behind, the one node in this tree that
      // touches the target, not the caster.
      smoldering_ring: {
        id: "smoldering_ring",
        name: "Smoldering Ring",
        cost: 2,
        prerequisites: ["wider_burn", "ring_of_fire"],
        leaning: "aggression",
        delta: { statChangeOnHit: { target: "defender", stat: "spDefense", stage: -1, ticks: 15 } },
      },
      ring_of_fire: {
        id: "ring_of_fire",
        name: "Ring of Fire",
        cost: 1,
        leaning: "boldness",
        delta: { shape: { kind: "ring", radius: 1 }, power: -10, cooldownTicks: 1 },
      },
      banked_heat: {
        id: "banked_heat",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["ring_of_fire"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      even_burn: {
        id: "even_burn",
        name: "+10 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["banked_heat"], ["smoldering_ring"], ["banked_embers"]],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      wide_ring: {
        id: "wide_ring",
        name: "Wide Ring",
        cost: 2,
        prerequisites: ["even_burn"],
        leaning: "boldness",
        delta: { shape: { kind: "ring", radius: 2 } },
      },
      slow_burn: {
        id: "slow_burn",
        name: "Slow Burn",
        cost: 1,
        prerequisites: ["wide_ring"],
        leaning: "boldness",
        delta: { statusSeverity: 1.5 },
      },
      lingering_ring: {
        id: "lingering_ring",
        name: "Lingering Ring",
        cost: 3,
        prerequisites: ["slow_burn"],
        excludes: ["searing_wall"],
        leaning: "boldness",
        delta: { cooldownTicks: 0, statusChance: 0.1 },
      },
      searing_wall: {
        id: "searing_wall",
        name: "Searing Wall",
        cost: 3,
        prerequisites: ["slow_burn"],
        excludes: ["lingering_ring"],
        leaning: "boldness",
        // Standing inside your own ring of fire discourages anyone from
        // closing in.
        grantsPassive: { kind: "damageReduction", value: 0.1 },
        delta: {},
      },
      unquenchable: {
        id: "unquenchable",
        name: "Unquenchable",
        cost: 2,
        prerequisitesAnyOf: [["lingering_ring"], ["searing_wall"]],
        leaning: "boldness",
        // The fire never really goes out.
        grantsPassive: { kind: "regen", value: 0.02 },
        delta: { cooldownTicks: -1 },
      },
      ring_capstone_filler: {
        id: "ring_capstone_filler",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["unquenchable"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      everlasting_ring: {
        id: "everlasting_ring",
        name: "Everlasting Ring",
        cost: 2,
        prerequisites: ["ring_capstone_filler"],
        leaning: "boldness",
        // Even the water and stone this fire usually can't touch don't fully
        // shrug this off anymore.
        delta: { resistanceBreaker: { multiplier: 1.4 } },
      },
      // Crosslink: Boldness <-> Sociability — a fire kept low and shared
      // burns just as steady, and is harder to knock out. Refined per
      // feedback: converted from a flat damageReduction to a real
      // Defense-stat buff — "banked" (a fire kept smoldering, not raging)
      // isn't an armor fiction, so this reads truer as toughness than as
      // literal hide/plating, and it's physical-only for free besides.
      banked_embers: {
        id: "banked_embers",
        name: "Banked Embers",
        cost: 1,
        prerequisites: ["ring_of_fire", "shared_warmth"],
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.5 },
        delta: {},
      },
      shared_warmth: {
        id: "shared_warmth",
        name: "Shared Warmth",
        cost: 1,
        leaning: "sociability",
        // Shares a portion of its own fire's warmth to mend a hurting herd-mate.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.15 } },
      },
      hearthside_calm: {
        id: "hearthside_calm",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["shared_warmth"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      banked_coals: {
        id: "banked_coals",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["hearthside_calm"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      gentle_heat: {
        id: "gentle_heat",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["banked_coals"], ["banked_embers"], ["kindled_fury"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      kindled_spirits: {
        id: "kindled_spirits",
        name: "Kindled Spirits",
        cost: 1,
        prerequisites: ["gentle_heat"],
        leaning: "sociability",
        // Lights a spark in an ally's own fighting spirit.
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "spAttack", stage: 1, ticks: 15 } } },
      },
      warm_hearth: {
        id: "warm_hearth",
        name: "+5% status chance",
        cost: 1,
        prerequisites: ["kindled_spirits"],
        leaning: "sociability",
        delta: { statusChance: 0.05 },
      },
      hearthkeeper: {
        id: "hearthkeeper",
        name: "Hearthkeeper",
        cost: 1,
        prerequisites: ["warm_hearth"],
        excludes: ["wildfire_call"],
        leaning: "sociability",
        // Tends the fire for everyone, at some cost to its own offense.
        grantsPassive: { kind: "regenFlat", value: 1 },
        delta: { power: -5 },
      },
      wildfire_call: {
        id: "wildfire_call",
        name: "Wildfire Call",
        cost: 1,
        prerequisites: ["warm_hearth"],
        excludes: ["hearthkeeper"],
        leaning: "sociability",
        // Calling on the fire's full force in front of the herd.
        delta: { statChangeOnHit: { target: "self", stat: "spAttack", stage: 1, ticks: 12 } },
      },
      eternal_flame: {
        id: "eternal_flame",
        name: "Eternal Flame",
        cost: 2,
        prerequisitesAnyOf: [["hearthkeeper"], ["wildfire_call"]],
        leaning: "sociability",
        // A blaze that never really needs tending anymore — it just keeps
        // giving a little back, tick after tick.
        grantsPassive: { kind: "regen", value: 0.025 },
        delta: { statusChance: 0.1 },
      },
      hearth_capstone_filler: {
        id: "hearth_capstone_filler",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["eternal_flame"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      communal_hearth: {
        id: "communal_hearth",
        name: "Communal Hearth",
        cost: 2,
        prerequisites: ["hearth_capstone_filler"],
        leaning: "sociability",
        // Mends and inspires a herd-mate in the same breath, not two
        // separate uses.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.2, buff: { stat: "spAttack", stage: 1, ticks: 20 } } },
      },
      // Crosslink: Sociability <-> Aggression — a spark shared between kin
      // burns hotter when it matters most.
      kindled_fury: {
        id: "kindled_fury",
        name: "Kindled Fury",
        cost: 1,
        prerequisites: ["shared_warmth", "wider_burn"],
        leaning: "aggression",
        delta: { critRateStage: 1 },
      },
    },
  },
  flamethrower: {
    id: "flamethrower",
    name: "Flamethrower",
    shape: { kind: "cone", length: 4, width: 2 },
    ...moveCanon("FLAMETHROWER"),
    cooldownTicks: 6,
    statusChance: 0.1,
    statusKind: "burn",
    range: { min: 0, max: 4 },
    // v2 (MOVES_DESIGN.md's own template) — Charmeleon/Charizard's real
    // upgrade from Ember, reached purely through in-sim leveling from
    // Charmander (spawned every run). This is the template's own reference
    // example for the "Power move" archetype: a real mutually-exclusive
    // final fork between two distinct "sick" end-states (Focused Beam's
    // single-target nuke vs. Wildfire Cone's wide AoE), not just a longer
    // grind to one ending. Every lever here is standard, already-shipped
    // damage-move plumbing — no new engine work needed for this one.
    tree: {
      // --- Aggression: "Inferno Focus" — hotter, harder, ending in the
      // archetype's own real fork.
      searing_heat: {
        id: "searing_heat",
        name: "Searing Heat",
        cost: 1,
        leaning: "aggression",
        delta: { statusChance: 0.1 },
      },
      hotter_flame: {
        id: "hotter_flame",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["searing_heat"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      steadier_aim: {
        id: "steadier_aim",
        name: "+10 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["hotter_flame"], ["molten_edge"], ["flashpoint"]],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      melting_blast: {
        id: "melting_blast",
        name: "Melting Blast",
        cost: 1,
        prerequisites: ["steadier_aim"],
        leaning: "aggression",
        delta: { defensePenetration: 0.15 },
      },
      faster_ignition: {
        id: "faster_ignition",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["melting_blast"], ["slagged_guard"], ["chain_ignition"]],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      focused_beam: {
        id: "focused_beam",
        name: "Focused Beam",
        cost: 2,
        prerequisites: ["faster_ignition"],
        excludes: ["wildfire_cone"],
        leaning: "aggression",
        // A single-target nuke — narrows to a long, precise line.
        delta: { shape: { kind: "line", length: 6 }, range: { max: 6 }, power: 15 },
      },
      wildfire_cone: {
        id: "wildfire_cone",
        name: "Wildfire Cone",
        cost: 2,
        prerequisites: ["faster_ignition"],
        excludes: ["focused_beam"],
        leaning: "aggression",
        // A wide AoE instead — spread thinner, but everyone caught in the
        // cone burns.
        delta: { shape: { kind: "cone", length: 3, width: 3 }, hitsArea: true, power: -10 },
      },
      combustion: {
        id: "combustion",
        name: "Combustion",
        cost: 2,
        prerequisitesAnyOf: [["focused_beam"], ["wildfire_cone"]],
        leaning: "aggression",
        // An overwhelming blast that costs the user something too.
        delta: { power: 10, recoilFraction: 0.05 },
      },
      lingering_heat: {
        id: "lingering_heat",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["combustion"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      wildfires_reach: {
        id: "wildfires_reach",
        name: "Wildfire's Reach",
        cost: 2,
        prerequisites: ["lingering_heat"],
        leaning: "aggression",
        // Badly burns whatever it catches, and burns down any bush it was
        // hiding in — the fire doesn't leave anything the way it found it.
        delta: { statusSeverity: 2, terrainBurn: true },
      },
      // Crosslink: Aggression <-> Boldness — the banked heat sharpens the
      // blast enough to punch straight through whatever guard it meets.
      molten_edge: {
        id: "molten_edge",
        name: "Molten Edge",
        cost: 1,
        prerequisites: ["searing_heat", "thick_scales"],
        leaning: "aggression",
        delta: { defensePenetration: 0.1 },
      },
      white_heat: {
        id: "white_heat",
        name: "White Heat",
        cost: 1,
        prerequisites: ["molten_edge"],
        leaning: "aggression",
        // Deepens Molten Edge's own armor-punching lever.
        delta: { defensePenetration: 0.1 },
      },
      slagged_guard: {
        id: "slagged_guard",
        name: "Slagged Guard",
        cost: 2,
        prerequisites: ["white_heat"],
        leaning: "boldness",
        // Past a certain heat a resistance stops being much of a resistance —
        // the natural escalation of punching through guard.
        delta: { resistanceBreaker: { multiplier: 1.4 } },
      },
      // --- Boldness: "Banked Flame" — a controlled, enduring fire instead
      // of an explosive burst.
      // --- Boldness: the furnace that stands in its own fire ---
      //
      // Reworked away from a generic armor ladder (damageReduction ->
      // defenseBoost -> regen/thorns fork -> defenseBoost+thorns capstone)
      // that vine_whip and rock_slide were running node-for-node with the
      // same passive values. Three moves cannot all be "the tanky one."
      //
      // The fantasy that is only true here: this creature does not survive
      // by being armored, it survives by being made of the thing that hurts
      // everyone else. Now that fire is real, persistent terrain (fire.ts),
      // that is a mechanic and not just flavor — this branch buys the right
      // to keep fighting inside its own wildfire, which no other move in the
      // roster can do, and which pairs with the Aggression branch's
      // Wildfire's Reach rather than sitting in a separate corner.
      thick_scales: {
        id: "thick_scales",
        name: "Scorchproof Hide",
        cost: 1,
        leaning: "boldness",
        // Half damage from standing in fire — enough to hold a burning tile
        // for a while, not enough to ignore it.
        grantsPassive: { kind: "fireproof", value: 0.5 },
        delta: {},
      },
      hardened_plates: {
        id: "hardened_plates",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["thick_scales"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      steady_burn: {
        id: "steady_burn",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["hardened_plates"], ["molten_edge"], ["ember_ward"]],
        leaning: "boldness",
        delta: { power: 5 },
      },
      banked_coals: {
        id: "banked_coals",
        name: "Banked Coals",
        cost: 1,
        prerequisites: ["steady_burn"],
        leaning: "boldness",
        // Cornered and burning hotter for it — the branch's own escalation
        // lever, rather than another flat defense number.
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.35 } },
      },
      slower_burn: {
        id: "slower_burn",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["banked_coals"], ["slagged_guard"], ["warding_pyre"]],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      // The real fork: do you want to OWN the burning ground, or to make
      // yourself the thing that isn't safe to stand next to? Both are "fire
      // as armor", and they pull toward genuinely different fights — one
      // wants a wildfire to stand in, the other doesn't care about terrain
      // at all.
      smoldering_core: {
        id: "smoldering_core",
        name: "Smoldering Core",
        cost: 1,
        prerequisites: ["slower_burn"],
        excludes: ["flame_wreath"],
        leaning: "boldness",
        // Total fire immunity: at 1 the holder also keeps regenerating while
        // standing in fire (fire.ts). The burning tile becomes YOUR ground.
        grantsPassive: { kind: "fireproof", value: 0.5 },
        delta: { situationalBonus: { condition: "targetBurning", multiplier: 1.5 } },
      },
      flame_wreath: {
        id: "flame_wreath",
        name: "Flame Wreath",
        cost: 1,
        prerequisites: ["slower_burn"],
        excludes: ["smoldering_core"],
        leaning: "boldness",
        // The other answer: never mind the ground, be the hazard yourself.
        grantsPassive: { kind: "thorns", value: 0.14 },
        delta: { statusChance: 0.1 },
      },
      unburnt: {
        id: "unburnt",
        name: "Unburnt",
        cost: 2,
        prerequisitesAnyOf: [["smoldering_core"], ["flame_wreath"]],
        leaning: "boldness",
        // Tops the branch up to full fire immunity from EITHER fork — the
        // Flame Wreath side has spent its nodes on being the hazard rather
        // than on surviving one, so this is where that build stops caring
        // about burning ground too. (Named for what it does: unburnt.)
        grantsPassive: { kind: "fireproof", value: 0.5 },
        delta: { power: 5 },
      },
      hotter_scales: {
        id: "hotter_scales",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["unburnt"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      living_furnace: {
        id: "living_furnace",
        name: "Living Furnace",
        cost: 2,
        prerequisites: ["hotter_scales"],
        leaning: "boldness",
        // The capstone escalates this branch's own lever rather than
        // reaching for the roster's generic tank passives: it leaves fire
        // behind it wherever it fights, and it is the one thing in the game
        // that is comfortable there.
        grantsPassive: { kind: "fireproof", value: 1 },
        delta: { terrainBurn: true },
      },
      // Crosslink: Boldness <-> Sociability — the banked heat singes
      // anyone who gets too close to whoever it's standing guard over.
      ember_ward: {
        id: "ember_ward",
        name: "Ember Ward",
        cost: 1,
        prerequisites: ["thick_scales", "kindling_call"],
        leaning: "sociability",
        grantsPassive: { kind: "thorns", value: 0.06 },
        delta: {},
      },
      banked_ward: {
        id: "banked_ward",
        name: "Banked Ward",
        cost: 1,
        prerequisites: ["ember_ward"],
        leaning: "sociability",
        // Deepens Ember Ward's own retaliatory heat.
        grantsPassive: { kind: "thorns", value: 0.06 },
        delta: {},
      },
      warding_pyre: {
        id: "warding_pyre",
        name: "Warding Pyre",
        cost: 2,
        prerequisites: ["banked_ward"],
        leaning: "boldness",
        // Standing this close to it is its own problem, and the heat shields
        // whoever it's guarding too.
        grantsPassives: [
          { kind: "thorns", value: 0.06 },
          { kind: "damageReduction", value: 0.06 },
        ],
        delta: {},
      },
      // --- Sociability: "Rally Flame" — a shared fire that sharpens and
      // warms whoever's near it.
      kindling_call: {
        id: "kindling_call",
        name: "Kindling Call",
        cost: 1,
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "spAttack", stage: 1, ticks: 20 } } },
      },
      warmth_shared: {
        id: "warmth_shared",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["kindling_call"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      quicker_call: {
        id: "quicker_call",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["warmth_shared"], ["ember_ward"], ["flashpoint"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      deepening_warmth: {
        id: "deepening_warmth",
        name: "Deepening Warmth",
        cost: 1,
        prerequisites: ["quicker_call"],
        leaning: "sociability",
        delta: { allyEffect: { healFraction: 0.15, buff: { stat: "spAttack", stage: 1, ticks: 20 } } },
      },
      brighter_blaze: {
        id: "brighter_blaze",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["deepening_warmth"], ["warding_pyre"], ["chain_ignition"]],
        leaning: "sociability",
        delta: { power: 5 },
      },
      rousing_flame: {
        id: "rousing_flame",
        name: "Rousing Flame",
        cost: 1,
        prerequisites: ["brighter_blaze"],
        excludes: ["calming_ash"],
        leaning: "sociability",
        // Trades the healing lean for a real Attack buff instead.
        delta: { allyEffect: { healFraction: 0.05, buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      calming_ash: {
        id: "calming_ash",
        name: "Calming Ash",
        cost: 1,
        prerequisites: ["brighter_blaze"],
        excludes: ["rousing_flame"],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      united_blaze: {
        id: "united_blaze",
        name: "United Blaze",
        cost: 2,
        prerequisitesAnyOf: [["rousing_flame"], ["calming_ash"]],
        leaning: "sociability",
        // The ally effect now also fires the instant this hits an enemy.
        delta: { allyEffectOnAttack: true },
      },
      steadfast_blaze: {
        id: "steadfast_blaze",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["united_blaze"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      communal_blaze: {
        id: "communal_blaze",
        name: "Communal Blaze",
        cost: 2,
        prerequisites: ["steadfast_blaze"],
        leaning: "sociability",
        // Everyone gathered around it recovers faster AND settles down —
        // a real "two passives" finale distinct from a flat heal aura.
        grantsPassives: [
          { kind: "regen", value: 0.04 },
          { kind: "calmingPresence", value: 0.1 },
        ],
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — a fire this shared catches
      // fast and hot the instant it's actually provoked.
      flashpoint: {
        id: "flashpoint",
        name: "Flashpoint",
        cost: 1,
        prerequisites: ["kindling_call", "searing_heat"],
        leaning: "aggression",
        delta: { critRateStage: 1 },
      },
      hair_trigger: {
        id: "hair_trigger",
        name: "Hair Trigger",
        cost: 1,
        prerequisites: ["flashpoint"],
        leaning: "aggression",
        // Deepens Flashpoint's own crit lever.
        delta: { critRateStage: 1 },
      },
      chain_ignition: {
        id: "chain_ignition",
        name: "Chain Ignition",
        cost: 2,
        prerequisites: ["hair_trigger"],
        leaning: "sociability",
        // A fire that catches this fast doesn't stay on one target — the burn
        // jumps to whoever's standing next to it.
        delta: { statusSpreads: true },
      },
    },
  },
  peck: {
    id: "peck",
    name: "Peck",
    shape: { kind: "point" },
    ...moveCanon("PECK"),
    cooldownTicks: 3,
    range: { min: 0, max: 1 },
    // v2 full triangle (MOVES_DESIGN.md's "Peck" writeup): the roster's first
    // positionSwap+positionSwapPull and first critCooldownReset live here,
    // plus the only tree that changes Peck's own point shape into real reach
    // mid-build, and a support keystone that slows a target down instead of
    // healing.
    tree: {
      needle_point: {
        id: "needle_point",
        name: "Needle Point",
        cost: 1,
        leaning: "aggression",
        delta: { power: 10 },
      },
      beak_sharpening: {
        id: "beak_sharpening",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["needle_point"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      sharp_strike_footing: {
        id: "sharp_strike_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["beak_sharpening"], ["ambush_strike"], ["war_cry"]],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      frenzied_pecking: {
        id: "frenzied_pecking",
        name: "Frenzied Pecking",
        cost: 1,
        prerequisites: ["sharp_strike_footing"],
        leaning: "aggression",
        delta: { hits: { min: 2, max: 2 } },
      },
      rapid_pecking: {
        id: "rapid_pecking",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["frenzied_pecking"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      piercing_beak: {
        id: "piercing_beak",
        name: "Piercing Beak",
        cost: 1,
        prerequisites: ["rapid_pecking"],
        excludes: ["rapid_volley"],
        leaning: "aggression",
        delta: { defensePenetration: 0.3 },
      },
      rapid_volley: {
        id: "rapid_volley",
        name: "Rapid Volley",
        cost: 1,
        prerequisites: ["rapid_pecking"],
        excludes: ["piercing_beak"],
        leaning: "aggression",
        delta: { hits: { min: 3, max: 3 }, power: -10 },
      },
      talon_strike: {
        id: "talon_strike",
        name: "Talon Strike",
        cost: 2,
        prerequisitesAnyOf: [["piercing_beak"], ["rapid_volley"]],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "targetLowHp", multiplier: 1.4 } },
      },
      keen_eye: {
        id: "keen_eye",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["talon_strike"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      skybreaker: {
        id: "skybreaker",
        name: "Skybreaker",
        cost: 2,
        prerequisites: ["keen_eye"],
        leaning: "aggression",
        // Flying beats Grass — a real answer to the roster's own
        // Bulbasaur/Venusaur line.
        delta: { bonusVsType: { type: "grass", multiplier: 1.5 } },
      },
      swooping_approach: {
        id: "swooping_approach",
        name: "Swooping Approach",
        cost: 1,
        leaning: "boldness",
        delta: { situationalBonus: { condition: "elevation", multiplier: 1.3 } },
      },
      wing_conditioning: {
        id: "wing_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["swooping_approach"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      dive_strike_footing: {
        id: "dive_strike_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["wing_conditioning"], ["ambush_strike"], ["cover_call"]],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      extended_wingspan: {
        id: "extended_wingspan",
        name: "Extended Wingspan",
        cost: 1,
        prerequisites: ["dive_strike_footing"],
        leaning: "boldness",
        // Peck actually gains reach for the first time — a 2-tile line
        // instead of a point-blank stab.
        delta: { shape: { kind: "line", length: 2 }, range: { max: 2 } },
      },
      wing_precision: {
        id: "wing_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["extended_wingspan"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      ambush_dive: {
        id: "ambush_dive",
        name: "Ambush Dive",
        cost: 1,
        prerequisites: ["wing_precision"],
        excludes: ["harrying_wings"],
        leaning: "boldness",
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      harrying_wings: {
        id: "harrying_wings",
        name: "Harrying Wings",
        cost: 1,
        prerequisites: ["wing_precision"],
        excludes: ["ambush_dive"],
        leaning: "boldness",
        delta: { power: -5, accuracy: 10 },
      },
      relentless_harrier: {
        id: "relentless_harrier",
        name: "Relentless Harrier",
        cost: 2,
        prerequisitesAnyOf: [["ambush_dive"], ["harrying_wings"]],
        leaning: "boldness",
        // A real crit-fisher spec — when the dive lands one, it's ready to
        // go again immediately instead of just hitting harder.
        delta: { power: 10, critRateStage: 1, critCooldownReset: true },
      },
      diving_precision: {
        id: "diving_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["relentless_harrier"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      snatch_and_swap: {
        id: "snatch_and_swap",
        name: "Snatch and Swap",
        cost: 2,
        prerequisites: ["diving_precision"],
        leaning: "boldness",
        // A dive that doesn't just trade places with the target — it keeps
        // hauling it two more tiles past the swap, genuinely wrenching it
        // out of position instead of a same-spot trade.
        delta: { positionSwap: true, positionSwapPull: 2 },
      },
      flock_call: {
        id: "flock_call",
        name: "Flock Call",
        cost: 1,
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      flock_footing: {
        id: "flock_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["flock_call"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      flock_call_footing: {
        id: "flock_call_footing",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["flock_footing"], ["war_cry"], ["cover_call"]],
        leaning: "sociability",
        delta: { power: 5 },
      },
      wingmate_cover: {
        id: "wingmate_cover",
        name: "Wingmate Cover",
        cost: 1,
        prerequisites: ["flock_call_footing"],
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      flock_synergy: {
        id: "flock_synergy",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["wingmate_cover"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      screening_wings: {
        id: "screening_wings",
        name: "Screening Wings",
        cost: 1,
        prerequisites: ["flock_synergy"],
        excludes: ["harriers_charge"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      harriers_charge: {
        id: "harriers_charge",
        name: "Harrier's Charge",
        cost: 1,
        prerequisites: ["flock_synergy"],
        excludes: ["screening_wings"],
        leaning: "sociability",
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      preening_recovery: {
        id: "preening_recovery",
        name: "Preening Recovery",
        cost: 2,
        prerequisitesAnyOf: [["screening_wings"], ["harriers_charge"]],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: {},
      },
      flock_instinct: {
        id: "flock_instinct",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["preening_recovery"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      harrying_flock: {
        id: "harrying_flock",
        name: "Harrying Flock",
        cost: 2,
        prerequisites: ["flock_instinct"],
        leaning: "sociability",
        // A crowd-control capstone — slows prey down, instead of a heal.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -1, ticks: 20 } },
      },
      // Crosslink: Aggression <-> Boldness — a coordinated snatch that
      // throws off the target's own rhythm.
      ambush_strike: {
        id: "ambush_strike",
        name: "Ambush Strike",
        cost: 1,
        prerequisites: ["needle_point", "swooping_approach"],
        leaning: "aggression",
        delta: { jamCooldownTicks: 1 },
      },
      // Crosslink: Boldness <-> Sociability — a braced dive shares its own
      // cover with the flock.
      cover_call: {
        id: "cover_call",
        name: "Cover Call",
        cost: 1,
        prerequisites: ["swooping_approach", "flock_call"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — a cornered flock-mate
      // fights harder.
      war_cry: {
        id: "war_cry",
        name: "War Cry",
        cost: 1,
        prerequisites: ["flock_call", "needle_point"],
        leaning: "sociability",
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.3 } },
      },
    },
  },
  scratch: {
    id: "scratch",
    name: "Scratch",
    shape: { kind: "point" },
    ...moveCanon("SCRATCH"),
    cooldownTicks: 3,
    range: { min: 0, max: 1 },
    // A real Sandshrew doesn't canonically have venom glands, so unlike
    // Ember's baked-in burn this poison is entirely tree-earned — `statusKind`
    // is set here so a chosen node can turn on `statusChance` (MoveTreeNode's
    // delta has no statusKind slot of its own), but the base move never rolls
    // for it on its own.
    statusKind: "poison",
    // v2 full triangle (MOVES_DESIGN.md's "Scratch" writeup): the roster's
    // first non-Ember status inflicter, its only two-passive keystone, and
    // the roster's first rallyCall.
    tree: {
      envenomed: {
        id: "envenomed",
        name: "Envenomed",
        cost: 1,
        leaning: "aggression",
        delta: { statusChance: 0.15 },
      },
      venom_glands: {
        id: "venom_glands",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["envenomed"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      envenomed_footing: {
        id: "envenomed_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["venom_glands"], ["frenzied_burrow"], ["colony_fury"]],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      deepening_venom: {
        id: "deepening_venom",
        name: "Deepening Venom",
        cost: 1,
        prerequisites: ["envenomed_footing"],
        leaning: "aggression",
        delta: { statusChance: 0.1 },
      },
      claw_conditioning: {
        id: "claw_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["deepening_venom"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      toxin_overload: {
        id: "toxin_overload",
        name: "Toxin Overload",
        cost: 1,
        prerequisites: ["claw_conditioning"],
        excludes: ["widening_fangs"],
        leaning: "aggression",
        // Hits harder finishing off something already statused.
        delta: { situationalBonus: { condition: "targetStatused", multiplier: 1.4 } },
      },
      widening_fangs: {
        id: "widening_fangs",
        name: "Widening Fangs",
        cost: 1,
        prerequisites: ["claw_conditioning"],
        excludes: ["toxin_overload"],
        leaning: "aggression",
        // Trades away some of the earned chance to poison for whatever
        // poison does land hitting twice as hard.
        delta: { power: 10, statusChance: -0.1, statusSeverity: 2 },
      },
      sandstorm_claws: {
        id: "sandstorm_claws",
        name: "Sandstorm Claws",
        cost: 2,
        prerequisitesAnyOf: [["toxin_overload"], ["widening_fangs"]],
        leaning: "aggression",
        // Matches Sandshrew's own nocturnal activity pattern.
        delta: { situationalBonus: { condition: "night", multiplier: 1.3 } },
      },
      claw_precision: {
        id: "claw_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["sandstorm_claws"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      toxic_spread: {
        id: "toxic_spread",
        name: "Toxic Spread",
        cost: 2,
        prerequisites: ["claw_precision"],
        leaning: "aggression",
        // The branch's payoff for actually committing to the venom line —
        // the poison jumps to whoever's standing next to the target too.
        delta: { statusSpreads: true },
      },
      ambush_claws: {
        id: "ambush_claws",
        name: "Ambush Claws",
        cost: 1,
        leaning: "boldness",
        delta: { situationalBonus: { condition: "concealed", multiplier: 1.3 } },
      },
      burrow_conditioning: {
        id: "burrow_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["ambush_claws"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      burrow_strike_footing: {
        id: "burrow_strike_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["burrow_conditioning"], ["frenzied_burrow"], ["guarded_den"]],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      dig_and_strike: {
        id: "dig_and_strike",
        name: "Dig-and-Strike",
        cost: 1,
        prerequisites: ["burrow_strike_footing"],
        leaning: "boldness",
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 2, timing: "beforeHit" } },
      },
      claw_momentum: {
        id: "claw_momentum",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["dig_and_strike"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      retreating_slash: {
        id: "retreating_slash",
        name: "Retreating Slash",
        cost: 1,
        prerequisites: ["claw_momentum"],
        excludes: ["cornered_fury"],
        leaning: "boldness",
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 2, timing: "onHit" } },
      },
      cornered_fury: {
        id: "cornered_fury",
        name: "Cornered Fury",
        cost: 1,
        prerequisites: ["claw_momentum"],
        excludes: ["retreating_slash"],
        leaning: "boldness",
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.3 } },
      },
      burrow_guard: {
        id: "burrow_guard",
        name: "Burrow Guard",
        cost: 2,
        prerequisitesAnyOf: [["retreating_slash"], ["cornered_fury"]],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.08 },
        delta: {},
      },
      burrow_resolve: {
        id: "burrow_resolve",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["burrow_guard"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      spiked_curl: {
        id: "spiked_curl",
        name: "Spiked Curl",
        cost: 2,
        prerequisites: ["burrow_resolve"],
        leaning: "boldness",
        // Sandshrew's own real spiked hide, curled up defensively.
        grantsPassive: { kind: "thorns", value: 0.15 },
        delta: {},
      },
      colony_call: {
        id: "colony_call",
        name: "Colony Call",
        cost: 1,
        leaning: "sociability",
        // As well as a dedicated idle-tick support use, a landed hit ALSO
        // buffs a nearby colony-mate's attack for free.
        delta: { targetsAlly: true, allyEffectOnAttack: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      den_footing: {
        id: "den_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["colony_call"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      colony_bond_footing: {
        id: "colony_bond_footing",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["den_footing"], ["guarded_den"], ["colony_fury"]],
        leaning: "sociability",
        delta: { power: 5 },
      },
      rally_the_colony: {
        id: "rally_the_colony",
        name: "Rally the Colony",
        cost: 1,
        prerequisites: ["colony_bond_footing"],
        leaning: "sociability",
        // A landed, non-killing hit marks the predator for the whole colony
        // to converge on — genuinely stronger than buffing one ally.
        delta: { rallyCall: { ticks: 20 } },
      },
      den_precision: {
        id: "den_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["rally_the_colony"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      colony_guard: {
        id: "colony_guard",
        name: "Colony Guard",
        cost: 1,
        prerequisites: ["den_precision"],
        excludes: ["tunnel_runner"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      tunnel_runner: {
        id: "tunnel_runner",
        name: "Tunnel Runner",
        cost: 1,
        prerequisites: ["den_precision"],
        excludes: ["colony_guard"],
        leaning: "sociability",
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      communal_foraging: {
        id: "communal_foraging",
        name: "Communal Foraging",
        cost: 2,
        prerequisitesAnyOf: [["colony_guard"], ["tunnel_runner"]],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: {},
      },
      den_instinct: {
        id: "den_instinct",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["communal_foraging"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      colony_warmth: {
        id: "colony_warmth",
        name: "Colony Warmth",
        cost: 2,
        prerequisites: ["den_instinct"],
        leaning: "sociability",
        // The only two-passive keystone among these four trees — earned
        // because this is the one branch guaranteed to actually fire for
        // real herd-mates today, Diglett included.
        grantsPassives: [
          { kind: "healAura", value: 0.01 },
          { kind: "regen", value: 0.04 },
        ],
        delta: {},
      },
      // Crosslink: Aggression <-> Boldness — bonus vs. a flanking target.
      frenzied_burrow: {
        id: "frenzied_burrow",
        name: "Frenzied Burrow",
        cost: 1,
        prerequisites: ["envenomed", "ambush_claws"],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.3 } },
      },
      // Crosslink: Boldness <-> Sociability — shared damageReduction.
      guarded_den: {
        id: "guarded_den",
        name: "Guarded Den",
        cost: 1,
        prerequisites: ["ambush_claws", "colony_call"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — a colony-backed strike that
      // recoups a little of what it deals, not another self-buff.
      colony_fury: {
        id: "colony_fury",
        name: "Colony Fury",
        cost: 1,
        prerequisites: ["colony_call", "envenomed"],
        leaning: "sociability",
        delta: { lifestealFraction: 0.08 },
      },
    },
  },
  rock_throw: {
    id: "rock_throw",
    name: "Rock Throw",
    shape: { kind: "line", length: 3 },
    ...moveCanon("ROCK_THROW"),
    cooldownTicks: 4,
    range: { min: 0, max: 3 },
    // Standing on a real "boulder" tile (worldgen.ts's Highland-leaning
    // obstacle kind) lets this throw consume it for real, ~3x damage —
    // checked in applySingleDamageInstance (predation.ts) before the damage
    // formula runs, since it's a genuine damage bonus, not a post-hit side
    // effect like terrainBurn. The boulder tile reverts to floor either way
    // once thrown; a clean miss doesn't waste it (accuracy is rolled first).
    consumesOwnTerrain: { terrain: "boulder", damageMultiplier: 3 },
    // v3 redesign (MOVES_DESIGN.md's "Rock Throw v3" writeup): the fantasy is
    // the reach a lumbering, heavy, slow body wouldn't otherwise have.
    // Aggression ("Denial") isn't bigger-numbers escalation — it's partial
    // crowd control: a throw that catches a leg or wing joint and makes
    // fleeing harder, not impossible. Boldness ("Bedrock") is a tank/counter
    // fantasy — plant, shrug off retaliation, punish whatever hasn't turned
    // to face it yet. Sociability ("Tremor Rally") finally uses the real
    // `rallyCall` primitive instead of another flat ally stat buff: the
    // impact's tremor marks exactly where the fight is, so herd-mates'
    // own independent hunt/threat picks converge on it, same as a "focus
    // fire" call. Note: Onix/Spearow/the wild Squirtle pair carry no herdId
    // in scenario.ts today, so this branch is real, shipped content that's
    // currently inert for those specific individuals — see MOVES_DESIGN.md.
    tree: {
      // --- Aggression: Denial (pin, don't just out-damage) ---
      pinning_impact: {
        id: "pinning_impact",
        name: "Pinning Impact",
        cost: 1,
        leaning: "aggression",
        // Not a stun — a real but partial slow, so a cornered target can
        // still struggle away eventually. Denial, not a lockdown.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -1, ticks: 16 } },
      },
      cracked_joint: {
        id: "cracked_joint",
        name: "+8 Power",
        cost: 1,
        prerequisites: ["pinning_impact"],
        leaning: "aggression",
        delta: { power: 8 },
      },
      dead_aim: {
        id: "dead_aim",
        name: "+8 Accuracy",
        cost: 1,
        prerequisites: ["pinning_impact"],
        leaning: "aggression",
        delta: { accuracy: 8 },
      },
      hobbling_throw: {
        id: "hobbling_throw",
        name: "Hobbling Throw",
        cost: 1,
        prerequisitesAnyOf: [["cracked_joint"], ["dead_aim"], ["grinding_advance"]],
        leaning: "aggression",
        // A second, harder catch — the slow stacks worse the more of these land.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -1, ticks: 20 } },
      },
      broken_stride: {
        id: "broken_stride",
        name: "+8 Power",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Aggression (Grinding Advance's and Rolling
        // Thunder's own chains).
        prerequisitesAnyOf: [["hobbling_throw"], ["bedrock_momentum"], ["converged_quarry"]],
        leaning: "aggression",
        delta: { power: 8 },
      },
      relentless_barrage: {
        id: "relentless_barrage",
        name: "Relentless Barrage",
        cost: 2,
        prerequisites: ["broken_stride"],
        excludes: ["crippling_snare"],
        leaning: "aggression",
        // Keeps throwing, one after another — no window for the target to
        // recover its footing between hits.
        delta: { power: 15 },
      },
      crippling_snare: {
        id: "crippling_snare",
        name: "Crippling Snare",
        cost: 2,
        prerequisites: ["broken_stride"],
        excludes: ["relentless_barrage"],
        leaning: "aggression",
        // Widens the throw into a real spread — a whole line of fleeing
        // targets gets caught by the same denial, not just the one in front.
        delta: { shape: { kind: "cone", length: 3, width: 2 } },
      },
      skyfall: {
        id: "skyfall",
        name: "Skyfall",
        cost: 2,
        prerequisitesAnyOf: [["relentless_barrage"], ["crippling_snare"], ["rolling_thunder"]],
        leaning: "aggression",
        // Arcs it down out of the sky — a real problem for anything flying.
        delta: { bonusVsType: { type: "flying", multiplier: 1.5 } },
      },
      dead_weight_finisher: {
        id: "dead_weight_finisher",
        name: "+8 Accuracy",
        cost: 1,
        prerequisites: ["skyfall"],
        leaning: "aggression",
        delta: { accuracy: 8 },
      },
      quarry_break: {
        id: "quarry_break",
        name: "Quarry Break",
        cost: 2,
        prerequisites: ["dead_weight_finisher"],
        leaning: "aggression",
        // Wrenches a whole slab straight out of the ground before it
        // throws — the real "boulder charge-up" fantasy, approximated with
        // the primitives this pass has: a costly beat of committed downtime
        // (lockTicks) buys a genuinely bigger, armor-punching hit. The
        // richer version — only pay the lockTicks cost when there's no
        // `consumesOwnTerrain` boulder already underfoot to just throw for
        // free — needs a new "conditional on terrain presence" branch in
        // that same check (predation.ts's `applySingleDamageInstance`);
        // flagged in MOVES_DESIGN.md, not built this pass.
        delta: { lockTicks: 2, power: 25, defensePenetration: 0.3 },
      },
      // --- Boldness: Bedrock (plant, shrug off, punish) ---
      bedrock_stance: {
        id: "bedrock_stance",
        name: "Bedrock Stance",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: {},
      },
      weathered_slab: {
        id: "weathered_slab",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["bedrock_stance"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      granite_grip: {
        id: "granite_grip",
        name: "+8 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["weathered_slab"], ["grinding_advance"], ["warning_tremor"]],
        leaning: "boldness",
        delta: { accuracy: 8 },
      },
      unshakeable: {
        id: "unshakeable",
        name: "Unshakeable",
        cost: 1,
        prerequisites: ["granite_grip"],
        leaning: "boldness",
        // Plants and refuses to be moved — no drag, knockback, or lunge so
        // much as budges it.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      bedrock_footing: {
        id: "bedrock_footing",
        name: "+5 Power",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Boldness (Grinding Advance's and Warning Tremor's
        // own chains).
        prerequisitesAnyOf: [["unshakeable"], ["bedrock_momentum"], ["herds_bulwark"]],
        leaning: "boldness",
        delta: { power: 5 },
      },
      aftershock_counter: {
        id: "aftershock_counter",
        name: "Aftershock Counter",
        cost: 1,
        prerequisites: ["bedrock_footing"],
        excludes: ["granite_ward"],
        leaning: "boldness",
        // Hits hardest at whatever hasn't turned to face the threat yet —
        // the payoff for standing your ground instead of chasing.
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      granite_ward: {
        id: "granite_ward",
        name: "Granite Ward",
        cost: 1,
        prerequisites: ["bedrock_footing"],
        excludes: ["aftershock_counter"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { accuracy: 10 },
      },
      fracturing_blow: {
        id: "fracturing_blow",
        name: "Fracturing Blow",
        cost: 2,
        prerequisitesAnyOf: [["aftershock_counter"], ["granite_ward"]],
        leaning: "boldness",
        // A hit that leaves real cracks — the target's own guard doesn't
        // hold up as well for a while after.
        delta: { statChangeOnHit: { target: "defender", stat: "defense", stage: -1, ticks: 20 } },
      },
      bedrock_resolve: {
        id: "bedrock_resolve",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["fracturing_blow"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      bedrock_breaker: {
        id: "bedrock_breaker",
        name: "Bedrock Breaker",
        cost: 2,
        prerequisites: ["bedrock_resolve"],
        leaning: "boldness",
        // Thrown hard enough that even a real resistance barely slows it.
        // The other capstone this branch was pitched as — the throw's own
        // power scaling with damage the user just absorbed, a real "stored
        // retaliation loop" instead of another flat passive — needs a new
        // primitive: `SituationalCondition` doesn't yet have a
        // "recentlyDamaged" (self took a hit within the last N ticks) entry.
        // That's a one-line addition to the same enum/check `"targetLowHp"`
        // already uses (moves.ts / predation.ts's `situationalMultiplier`),
        // flagged in MOVES_DESIGN.md as the concrete next step, not built
        // this pass.
        delta: { resistanceBreaker: { multiplier: 2 } },
      },
      // --- Sociability: Tremor Rally (real shared awareness, not a flat buff) ---
      tremor_call: {
        id: "tremor_call",
        name: "Tremor Call",
        cost: 1,
        leaning: "sociability",
        // The impact's tremor doesn't just warn the herd it happened — it
        // marks exactly where. Every herd-mate's own, independently-run
        // hunt/threat pick converges on the same target, same as if they'd
        // seen it themselves (see `Agent.rallyMarkTicksRemaining`'s own doc
        // comment). This is the real answer to "does it make allies aware
        // and bring them in" — yes, via the shipped `rallyCall` primitive,
        // not a new one.
        delta: { rallyCall: { ticks: 20 } },
      },
      sure_footing: {
        id: "sure_footing",
        name: "+8 Accuracy",
        cost: 1,
        prerequisites: ["tremor_call"],
        leaning: "sociability",
        delta: { accuracy: 8 },
      },
      herd_grip: {
        id: "herd_grip",
        name: "Herd Grip",
        cost: 1,
        prerequisitesAnyOf: [["sure_footing"], ["warning_tremor"], ["rolling_thunder"]],
        leaning: "sociability",
        // Filler variety, not another flat power/accuracy bump — the herd
        // closing in behind the target leaves it little room to brace.
        delta: { defensePenetration: 0.15 },
      },
      tremor_bond: {
        id: "tremor_bond",
        name: "Tremor Bond",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Sociability (Warning Tremor's and Rolling
        // Thunder's own chains).
        prerequisitesAnyOf: [["herd_grip"], ["herds_bulwark"], ["converged_quarry"]],
        leaning: "sociability",
        // A real, distinct Sociability lever from marking: the same tremor
        // that calls the herd in doubles as a dedicated check-in — an
        // idle-tick heal for whichever herd-mate needs it most (see
        // `targetsAlly`'s own doc comment). Not another way to extend or
        // repeat the rallyCall mark.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.15 } },
      },
      vanguard_call: {
        id: "vanguard_call",
        name: "Vanguard Call",
        cost: 1,
        prerequisites: ["tremor_bond"],
        excludes: ["bulwark_call"],
        leaning: "sociability",
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      bulwark_call: {
        id: "bulwark_call",
        name: "Bulwark Call",
        cost: 1,
        prerequisites: ["tremor_bond"],
        excludes: ["vanguard_call"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      colony_watch: {
        id: "colony_watch",
        name: "Colony Watch",
        cost: 2,
        prerequisitesAnyOf: [["vanguard_call"], ["bulwark_call"]],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: {},
      },
      tremor_focus: {
        id: "tremor_focus",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["colony_watch"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      herd_ascendant: {
        id: "herd_ascendant",
        name: "Herd Ascendant",
        cost: 2,
        prerequisites: ["tremor_focus"],
        leaning: "sociability",
        // Deliberately not "extend the mark even further" a third time —
        // a different payoff: whatever's already marked recovers steadily
        // worse (jamCooldownTicks, a real control effect on the enemy), and
        // a sustained group fight lets the user feed off it a little too.
        delta: { jamCooldownTicks: 3, lifestealFraction: 0.05 },
      },
      // Crosslink: Aggression <-> Boldness — a heavier hit off an already
      // grounded, braced throw.
      grinding_advance: {
        id: "grinding_advance",
        name: "Grinding Advance",
        cost: 1,
        prerequisites: ["pinning_impact", "bedrock_stance"],
        leaning: "aggression",
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 12 } },
      },
      // Bridge tail (see MOVES_DESIGN.md's "Crosslinks as bridges"):
      // extends Grinding Advance into Aggression's and Boldness's own
      // pre-fork nodes (Broken Stride / Bedrock Footing).
      grinding_footing: {
        id: "grinding_footing",
        name: "+0.15 Defense Penetration",
        cost: 1,
        prerequisites: ["grinding_advance"],
        leaning: "aggression",
        delta: { defensePenetration: 0.15 },
      },
      bedrock_momentum: {
        id: "bedrock_momentum",
        name: "Bedrock Momentum",
        cost: 2,
        prerequisites: ["grinding_footing"],
        leaning: "boldness",
        // Deepens Grinding Advance's own lever instead of bolting on a
        // generic stat — the braced hit doesn't just land once, it builds:
        // a bigger, longer self-Attack surge than the crosslink alone gave.
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 2, ticks: 16 } },
      },
      // Crosslink: Boldness <-> Sociability — the tremor's warning reaches
      // far enough to brace the thrower too.
      warning_tremor: {
        id: "warning_tremor",
        name: "Warning Tremor",
        cost: 1,
        prerequisites: ["bedrock_stance", "tremor_call"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: {},
      },
      // Bridge tail: extends Warning Tremor into Boldness's and
      // Sociability's own pre-fork nodes (Bedrock Footing / Tremor Bond).
      warded_footing: {
        id: "warded_footing",
        name: "+0.5 Armor",
        cost: 1,
        prerequisites: ["warning_tremor"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 0.5 },
        delta: {},
      },
      herds_bulwark: {
        id: "herds_bulwark",
        name: "Herd's Bulwark",
        cost: 2,
        prerequisites: ["warded_footing"],
        leaning: "sociability",
        // Deepens the bracing lever Warning Tremor already granted, instead
        // of a generic lifesteal bolt-on — the herd's own care extends into
        // real, ongoing recovery.
        grantsPassive: { kind: "regen", value: 0.025 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — a marked target that's
      // already stumbling gets bogged down hard, not just slowed further.
      // (Fixed a real mistake here: `lockTicks` locks the *user* out of
      // acting, not the defender — it can't express a "stun the target"
      // payoff at all. There's no tree-settable way to inflict an actual
      // status/stun yet (`statusKind` isn't a tree delta field today), so
      // this crosslink deepens the real primitive it already had — the
      // Aggression branch's own defender Speed debuff — instead.)
      rolling_thunder: {
        id: "rolling_thunder",
        name: "Rolling Thunder",
        cost: 1,
        prerequisites: ["tremor_call", "pinning_impact"],
        leaning: "sociability",
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -2, ticks: 24 } },
      },
      // Deeper crosslink, building on Rolling Thunder: a pinned, marked
      // target is exactly what the herd's own convergence should punish
      // hardest, using the same `"rallyMarked"` primitive Earthquake and
      // Hydro Pump's own deeper crosslinks now share.
      marked_advantage: {
        id: "marked_advantage",
        name: "Marked Advantage",
        cost: 1,
        prerequisites: ["rolling_thunder"],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "rallyMarked", multiplier: 1.3 } },
      },
      // Bridge tail: extends the Rolling Thunder/Marked Advantage chain
      // into Aggression's and Sociability's own pre-fork nodes (Broken
      // Stride / Tremor Bond).
      converged_quarry: {
        id: "converged_quarry",
        name: "Converged Quarry",
        cost: 2,
        prerequisites: ["marked_advantage"],
        leaning: "aggression",
        // Deepens Marked Advantage's own rallyMarked payoff further
        // (overwrite, like every other situationalBonus) instead of a
        // flat power bolt-on — a target this pinned and this marked barely
        // stands a chance.
        delta: { situationalBonus: { condition: "rallyMarked", multiplier: 1.6 } },
      },
    },
  },
  water_gun: {
    id: "water_gun",
    name: "Water Gun",
    shape: { kind: "line", length: 2 },
    ...moveCanon("WATER_GUN"),
    cooldownTicks: 3,
    range: { min: 0, max: 2 },
    // A landed, non-killing hit leaves a real puddle where it struck —
    // converts a dry floor/sand/mud tile at the defender's position into
    // "water" (resolveHitAgainstTarget, predation.ts). Deliberately
    // permanent, like terrainBurn's own bush->floor conversion — a real
    // decaying puddle needs a generic "this tile change expires"
    // mechanism this sim doesn't have yet (see MOVES_DESIGN.md).
    terrainFill: { terrain: "water" },
    // v2 full triangle (MOVES_DESIGN.md's "Water Gun" writeup): a
    // resistanceBreaker keystone fixes Water Gun's own real weakness
    // (resisted by Grass/Water/Dragon) instead of padding an
    // already-favorable Fire matchup, plus a storm-specific opener and a
    // Boldness branch built around un-buffing the target instead of buffing
    // the user.
    tree: {
      high_pressure_jet: {
        id: "high_pressure_jet",
        name: "High-Pressure Jet",
        cost: 1,
        leaning: "aggression",
        // A genuine barometric-pressure hook — hits hardest specifically
        // during a storm, not just any rain.
        delta: { situationalBonus: { condition: "storm", multiplier: 1.4 } },
      },
      jet_conditioning: {
        id: "jet_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["high_pressure_jet"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      pressurized_footing: {
        id: "pressurized_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["jet_conditioning"], ["surging_retreat"], ["rising_tide"]],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      piercing_jet: {
        id: "piercing_jet",
        name: "Piercing Jet",
        cost: 1,
        prerequisites: ["pressurized_footing"],
        leaning: "aggression",
        delta: { range: { max: 3 } },
      },
      jet_precision: {
        id: "jet_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["piercing_jet"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      torrent: {
        id: "torrent",
        name: "Torrent",
        cost: 1,
        prerequisites: ["jet_precision"],
        excludes: ["rapid_jets"],
        leaning: "aggression",
        delta: { power: 10, cooldownTicks: 1 },
      },
      rapid_jets: {
        id: "rapid_jets",
        name: "Rapid Jets",
        cost: 1,
        prerequisites: ["jet_precision"],
        excludes: ["torrent"],
        leaning: "aggression",
        delta: { hits: { min: 2, max: 2 }, power: -10 },
      },
      deluge: {
        id: "deluge",
        name: "Deluge",
        cost: 2,
        prerequisitesAnyOf: [["torrent"], ["rapid_jets"]],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "rain", multiplier: 1.3 } },
      },
      jet_focus: {
        id: "jet_focus",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["deluge"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      overwhelming_current: {
        id: "overwhelming_current",
        name: "Overwhelming Current",
        cost: 2,
        prerequisites: ["jet_focus"],
        leaning: "aggression",
        // Water Gun is resisted by Grass, Water, and Dragon — this fixes a
        // real, printed weakness instead of padding an already-favorable
        // matchup vs. Fire.
        delta: { resistanceBreaker: { multiplier: 2 } },
      },
      knockback_spray: {
        id: "knockback_spray",
        name: "Knockback Spray",
        cost: 1,
        leaning: "boldness",
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      spray_conditioning: {
        id: "spray_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["knockback_spray"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      evasive_spray_footing: {
        id: "evasive_spray_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["spray_conditioning"], ["surging_retreat"], ["sheltering_current"]],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      retreating_current: {
        id: "retreating_current",
        name: "Retreating Current",
        cost: 1,
        prerequisites: ["evasive_spray_footing"],
        leaning: "boldness",
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 2, timing: "onHit" } },
      },
      current_precision: {
        id: "current_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["retreating_current"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      undertow: {
        id: "undertow",
        name: "Undertow",
        cost: 1,
        prerequisites: ["current_precision"],
        excludes: ["bubble_shield"],
        leaning: "boldness",
        // Washes the target's own footing out from under it.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -1, ticks: 20 } },
      },
      bubble_shield: {
        id: "bubble_shield",
        name: "Bubble Shield",
        cost: 1,
        prerequisites: ["current_precision"],
        excludes: ["undertow"],
        leaning: "boldness",
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 20 } },
      },
      tidal_guard: {
        id: "tidal_guard",
        name: "Tidal Guard",
        cost: 2,
        prerequisitesAnyOf: [["undertow"], ["bubble_shield"]],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.08 },
        delta: {},
      },
      tidal_precision: {
        id: "tidal_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["tidal_guard"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      tidal_retreat: {
        id: "tidal_retreat",
        name: "Tidal Retreat",
        cost: 2,
        prerequisites: ["tidal_precision"],
        leaning: "boldness",
        // A real, always-usable panic-button retreat for the sim's most
        // fragile spawned agent.
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 3, timing: "onHit" } },
      },
      shared_current: {
        id: "shared_current",
        name: "Shared Current",
        cost: 1,
        leaning: "sociability",
        // The splash from a landed hit also heals a nearby hurt herd-mate
        // for free, on top of the dedicated idle-tick support use.
        delta: { targetsAlly: true, allyEffectOnAttack: true, allyEffect: { healFraction: 0.15 } },
      },
      pond_footing: {
        id: "pond_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["shared_current"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      pond_kinship_footing: {
        id: "pond_kinship_footing",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["pond_footing"], ["sheltering_current"], ["rising_tide"]],
        leaning: "sociability",
        delta: { power: 5 },
      },
      calming_wave: {
        id: "calming_wave",
        name: "Calming Wave",
        cost: 1,
        prerequisites: ["pond_kinship_footing"],
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      wave_precision: {
        id: "wave_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["calming_wave"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      undertow_guard: {
        id: "undertow_guard",
        name: "Undertow Guard",
        cost: 1,
        prerequisites: ["wave_precision"],
        excludes: ["riptide_rush"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      riptide_rush: {
        id: "riptide_rush",
        name: "Riptide Rush",
        cost: 1,
        prerequisites: ["wave_precision"],
        excludes: ["undertow_guard"],
        leaning: "sociability",
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      steady_tides: {
        id: "steady_tides",
        name: "Steady Tides",
        cost: 2,
        prerequisitesAnyOf: [["undertow_guard"], ["riptide_rush"]],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: {},
      },
      tide_instinct: {
        id: "tide_instinct",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["steady_tides"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      tidal_bond: {
        id: "tidal_bond",
        name: "Tidal Bond",
        cost: 2,
        prerequisites: ["tide_instinct"],
        leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.01 },
        delta: {},
      },
      // Crosslink: Aggression <-> Boldness — a shared burst of confidence
      // off a forceful hit.
      surging_retreat: {
        id: "surging_retreat",
        name: "Surging Retreat",
        cost: 1,
        prerequisites: ["high_pressure_jet", "knockback_spray"],
        leaning: "aggression",
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 12 } },
      },
      // Crosslink: Boldness <-> Sociability — shared damageReduction.
      sheltering_current: {
        id: "sheltering_current",
        name: "Sheltering Current",
        cost: 1,
        prerequisites: ["knockback_spray", "shared_current"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — a shared burst of
      // coordinated ferocity, not another flanking check.
      rising_tide: {
        id: "rising_tide",
        name: "Rising Tide",
        cost: 1,
        prerequisites: ["shared_current", "high_pressure_jet"],
        leaning: "sociability",
        delta: { critRateStage: 1 },
      },
    },
  },
  // --- Advanced/evolved-line moves below. Direct ask: "we need more
  // moves... more advanced moves should be more range, more aoe." Every one
  // is a real gen-1 move (moveCanon pulls its type/power/accuracy straight
  // from the dex, same standard the original five moves already hold to),
  // given real reach and/or a real hitsArea footprint instead of staying a
  // point-blank single-target stab — the "advanced" half of the ask.
  // Movesets below are updated for the species that actually learn each one
  // (checked against the dex's own level/TM movepool where practical); a
  // small number take the same "off-type/flavor reuse" liberty this file
  // already takes elsewhere (Onix's Tackle, Dratini's Tackle) rather than
  // leaving an evolved line without a real upgrade.
  hydro_pump: {
    id: "hydro_pump",
    name: "Hydro Pump",
    // A real blast, not a stab — Blastoise/Gyarados/Lapras's signature.
    shape: { kind: "cone", length: 4, width: 2 },
    ...moveCanon("HYDRO_PUMP"),
    cooldownTicks: 8,
    range: { min: 0, max: 4 },
    hitsArea: true,
    // v3 redesign (MOVES_DESIGN.md's "start from the fantasy" pass). THE
    // FANTASY: an overwhelming, all-consuming current that's genuinely
    // hard to aim (the dex's own 80 accuracy) — the wildness IS the
    // identity, not a stat to quietly patch out with filler.
    // - Aggression ("Overwhelm"): raw, unstoppable force with a real
    //   wind-up cost (`lockTicks`) — power-archetype, on purpose, since
    //   Hydro Pump's own mainline identity IS the biggest blast, not an
    //   ambush or a territorial squabble.
    // - Boldness ("Bastion"): defensive is the earned answer here — a
    //   bulky tank (Blastoise/Lapras) channeling a controlled deluge
    //   instead of an explosive burst, not generic reuse of Earthquake's
    //   terraforming (that fantasy was specific to Earthquake).
    // - Sociability ("Pod Tide"): the pod moving the water together —
    //   real positional choices (push the threat back vs. interpose
    //   yourself) instead of the tired damageReduction/jam fork reused
    //   everywhere else.
    tree: {
      building_pressure: {
        id: "building_pressure",
        name: "Building Pressure",
        cost: 1,
        leaning: "aggression",
        // A wind-up you can't cancel — real commitment, not just a bigger
        // number for free.
        delta: { power: 15, lockTicks: 1 },
      },
      pump_conditioning: {
        id: "pump_conditioning",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["building_pressure"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      overwhelm_footing: {
        id: "overwhelm_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["pump_conditioning"], ["surge_and_brace"], ["wake_of_violence"]],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      bursting_main: {
        id: "bursting_main",
        name: "Bursting Main",
        cost: 1,
        prerequisites: ["overwhelm_footing"],
        leaning: "aggression",
        delta: { defensePenetration: 0.3 },
      },
      flooding_wake: {
        id: "flooding_wake",
        name: "Flooding Wake",
        cost: 1,
        prerequisites: ["bursting_main"],
        leaning: "aggression",
        // A real, already-shipped primitive (see Water Gun's own use of it):
        // a landed, non-killing hit leaves standing water where it struck.
        // Direct ask, answered with what's actually buildable now: the
        // fuller "it also slows non-Water types" version needs
        // `terrainSpeedMultiplier` (support.ts) to become type-aware, which
        // it isn't yet — flagged in MOVES_DESIGN.md, not built this pass.
        delta: { terrainFill: { terrain: "water" } },
      },
      widening_main: {
        id: "widening_main",
        name: "+1 Range",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Aggression (Surge and Brace's and Wake of
        // Violence's own chains).
        prerequisitesAnyOf: [["flooding_wake"], ["unified_current"], ["violent_confluence"]],
        leaning: "aggression",
        // Honest caveat, not hidden: this move's own cone footprint is
        // fixed at `shape.length` (4) regardless of `range.max` — range
        // only governs how far away a target can be for the attacker to
        // *decide* to fire (`moveRange`/`withinMoveRange`, combat.ts), not
        // how far the resolved blast itself reaches. A target at the new,
        // farther edge of range won't necessarily end up inside the cone.
        // See MOVES_DESIGN.md's "range vs. shape are decoupled" note.
        delta: { range: { max: 5 } },
      },
      overwhelm_surge: {
        id: "overwhelm_surge",
        name: "Overwhelm",
        cost: 1,
        prerequisites: ["widening_main"],
        excludes: ["relentless_surge"],
        leaning: "aggression",
        // Goes all-in on one unstoppable blast — the wind-up costs even
        // more, but so does what it hits with.
        delta: { power: 20, lockTicks: 1 },
      },
      relentless_surge: {
        id: "relentless_surge",
        name: "Relentless Surge",
        cost: 1,
        prerequisites: ["widening_main"],
        excludes: ["overwhelm_surge"],
        leaning: "aggression",
        delta: { hits: { min: 2, max: 2 }, power: -20 },
      },
      undertow_pull: {
        id: "undertow_pull",
        name: "Undertow Pull",
        cost: 2,
        prerequisitesAnyOf: [["overwhelm_surge"], ["relentless_surge"]],
        leaning: "aggression",
        // The backwash literally drags the target with it.
        delta: { positionSwap: true, positionSwapPull: 1 },
      },
      pump_precision: {
        id: "pump_precision",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["undertow_pull"],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      maelstrom: {
        id: "maelstrom",
        name: "Maelstrom",
        cost: 2,
        prerequisites: ["pump_precision"],
        leaning: "aggression",
        delta: { power: 15, critRateStage: 1 },
      },
      wading_advance: {
        id: "wading_advance",
        name: "Wading Advance",
        cost: 1,
        leaning: "boldness",
        // Bold enough to close distance before unleashing anything —
        // stands its ground rather than opening from a safe range.
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" } },
      },
      bastion_footing: {
        id: "bastion_footing",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["wading_advance"],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      channel_footing: {
        id: "channel_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["bastion_footing"], ["surge_and_brace"], ["steadfast_tide"]],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      undertow_anchor: {
        id: "undertow_anchor",
        name: "Undertow Anchor",
        cost: 1,
        prerequisites: ["channel_footing"],
        leaning: "boldness",
        // Ironic and earned: the water-mover that can't be swept away by
        // its own current.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      channel_grip: {
        id: "channel_grip",
        name: "+1 Range",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Boldness (Surge and Brace's and Steadfast Tide's
        // own chains).
        prerequisitesAnyOf: [["undertow_anchor"], ["unified_current"], ["communal_current"]],
        leaning: "boldness",
        delta: { range: { max: 5 } },
      },
      bracing_wave: {
        id: "bracing_wave",
        name: "Bracing Wave",
        cost: 1,
        prerequisites: ["channel_grip"],
        excludes: ["riptide_counter"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: { power: -5 },
      },
      riptide_counter: {
        id: "riptide_counter",
        name: "Riptide Counter",
        cost: 1,
        prerequisites: ["channel_grip"],
        excludes: ["bracing_wave"],
        leaning: "boldness",
        // Punishes whoever tries to catch it off guard mid-channel.
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      fouling_backwash: {
        id: "fouling_backwash",
        name: "Fouling Backwash",
        cost: 2,
        prerequisitesAnyOf: [["bracing_wave"], ["riptide_counter"]],
        leaning: "boldness",
        // The backwash fouls the target's own footing, throwing off its
        // rhythm rather than just crushing its guard down.
        delta: { jamCooldownTicks: 1 },
      },
      bastion_resolve: {
        id: "bastion_resolve",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["fouling_backwash"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      tidal_bastion: {
        id: "tidal_bastion",
        name: "Tidal Bastion",
        cost: 2,
        prerequisites: ["bastion_resolve"],
        leaning: "boldness",
        // Having weathered every countercurrent, the user simply doesn't
        // go down — a two-passive keystone distinct from Water Gun's own
        // resistanceBreaker (same real fix, already owned by that move).
        grantsPassives: [
          { kind: "defenseBoost", value: 0.1 },
          { kind: "regen", value: 0.04 },
        ],
        delta: {},
      },
      pod_current: {
        id: "pod_current",
        name: "Pod Current",
        cost: 1,
        leaning: "sociability",
        // The opener carries the branch's own "the pod cares for itself"
        // fantasy on two fronts, live from the first point spent: a real
        // idle-tick heal, and — moved here from the capstone after direct
        // feedback that reusing Earthquake's own opener trick as a
        // capstone felt recycled — the pod finally doesn't hurt its own:
        // Hydro Pump's `hitsArea` (set on the base move) no longer catches
        // herd-mates caught in it.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.15 }, excludesAllies: true },
      },
      pod_footing: {
        id: "pod_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["pod_current"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      wake_footing: {
        id: "wake_footing",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["pod_footing"], ["steadfast_tide"], ["wake_of_violence"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      wake_rally: {
        id: "wake_rally",
        name: "Wake Rally",
        cost: 1,
        prerequisites: ["wake_footing"],
        leaning: "sociability",
        // The surge marks a target for the whole pod to converge on.
        delta: { rallyCall: { ticks: 20 } },
      },
      pod_reach: {
        id: "pod_reach",
        name: "+1 Range",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Sociability (Steadfast Tide's and Wake of
        // Violence's own chains).
        prerequisitesAnyOf: [["wake_rally"], ["communal_current"], ["violent_confluence"]],
        leaning: "sociability",
        delta: { range: { max: 5 } },
      },
      undertow_guard: {
        id: "undertow_guard",
        name: "Undertow Guard",
        cost: 1,
        prerequisites: ["pod_reach"],
        excludes: ["riptide_charge"],
        leaning: "sociability",
        // Protectively shoves the threat back from the herd.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      riptide_charge: {
        id: "riptide_charge",
        name: "Riptide Charge",
        cost: 1,
        prerequisites: ["pod_reach"],
        excludes: ["undertow_guard"],
        leaning: "sociability",
        // Surges forward to meet the threat before it reaches the herd.
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" } },
      },
      pod_instinct: {
        id: "pod_instinct",
        name: "+8% Lifesteal",
        cost: 2,
        prerequisitesAnyOf: [["undertow_guard"], ["riptide_charge"]],
        leaning: "sociability",
        delta: { lifestealFraction: 0.08 },
      },
      pod_precision: {
        id: "pod_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["pod_instinct"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      tidal_communion: {
        id: "tidal_communion",
        name: "Tidal Communion",
        cost: 2,
        prerequisites: ["pod_precision"],
        leaning: "sociability",
        // Third try at this capstone, direct feedback both times: a flat
        // team-heal didn't match "the pod moving the water together," and
        // the follow-up `excludesAllies` (moved to Pod Current's own
        // opener instead — see its comment) read as reused content
        // already spent as Earthquake's own opener. The real fantasy: the
        // whole pod moves faster through its own element — a genuine,
        // brand-new engine primitive (`"aquaticHaste"`, see PassiveKind's
        // own doc comment in types.ts), not a flat stat bolt-on.
        grantsPassive: { kind: "aquaticHaste", value: 0.75 },
        delta: {},
      },
      // Crosslink: Aggression <-> Boldness — Boldness's steadiness softens
      // Aggression's own wind-up cost, directly answering the price
      // Building Pressure introduces rather than just adding flavor.
      surge_and_brace: {
        id: "surge_and_brace",
        name: "Surge and Brace",
        cost: 1,
        prerequisites: ["building_pressure", "wading_advance"],
        leaning: "boldness",
        delta: { lockTicks: -1 },
      },
      // Bridge tail (see MOVES_DESIGN.md's "Crosslinks as bridges"):
      // extends Surge and Brace into Aggression's and Boldness's own
      // pre-fork nodes (Widening Main / Channel Grip).
      brace_conditioning: {
        id: "brace_conditioning",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["surge_and_brace"],
        leaning: "aggression",
        // Deepens the same wind-up-softening lever Surge and Brace already
        // introduced, instead of a generic accuracy bolt-on.
        delta: { cooldownTicks: -1 },
      },
      unified_current: {
        id: "unified_current",
        name: "Unified Current",
        cost: 2,
        prerequisites: ["brace_conditioning"],
        leaning: "boldness",
        // A precisely-timed release lands true — ties into Overwhelm's own
        // crit lever (Maelstrom) instead of a flat defensePenetration bolt-on.
        delta: { critRateStage: 1 },
      },
      // Crosslink: Boldness <-> Sociability — a shared, steady breath
      // between whoever's bracing and whoever's supporting.
      steadfast_tide: {
        id: "steadfast_tide",
        name: "Steadfast Tide",
        cost: 1,
        prerequisites: ["wading_advance", "pod_current"],
        leaning: "boldness",
        grantsPassive: { kind: "regenFlat", value: 1.5 },
        delta: {},
      },
      // Bridge tail: extends Steadfast Tide into Boldness's and
      // Sociability's own pre-fork nodes (Channel Grip / Pod Reach).
      tidal_footing: {
        id: "tidal_footing",
        name: "+0.75 HP Regen",
        cost: 1,
        prerequisites: ["steadfast_tide"],
        leaning: "boldness",
        // Deepens Steadfast Tide's own shared-vitality lever directly,
        // instead of a generic power bolt-on.
        grantsPassive: { kind: "regenFlat", value: 0.75 },
        delta: {},
      },
      communal_current: {
        id: "communal_current",
        name: "Communal Current",
        cost: 2,
        prerequisites: ["tidal_footing"],
        leaning: "sociability",
        // The shared current becomes real shared protection, not just
        // shared healing — ties Boldness's own defensive identity into the
        // bridge instead of a flat lifesteal bolt-on.
        grantsPassive: { kind: "damageReduction", value: 0.06 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — once the pod's converged
      // on a marked target, the strike that follows lands true.
      wake_of_violence: {
        id: "wake_of_violence",
        name: "Wake of Violence",
        cost: 1,
        prerequisites: ["pod_current", "building_pressure"],
        leaning: "sociability",
        delta: { critRateStage: 1 },
      },
      // Bridge tail: extends Wake of Violence into Sociability's and
      // Aggression's own pre-fork nodes (Pod Reach / Widening Main).
      surging_wake: {
        id: "surging_wake",
        name: "+1 Crit Rate Stage",
        cost: 1,
        prerequisites: ["wake_of_violence"],
        leaning: "sociability",
        // Deepens Wake of Violence's own precision lever directly, instead
        // of a generic accuracy bolt-on.
        delta: { critRateStage: 1 },
      },
      violent_confluence: {
        id: "violent_confluence",
        name: "Violent Confluence",
        cost: 2,
        prerequisites: ["surging_wake"],
        leaning: "aggression",
        // The pod's own convergence is the real payoff here, not a flat
        // power bolt-on — a target the herd has flagged gets hit hardest
        // once the current actually catches it.
        delta: { situationalBonus: { condition: "rallyMarked", multiplier: 1.4 } },
      },
    },
  },
  surf: {
    id: "surf",
    name: "Surf",
    // Washes over everyone nearby, not just the primary target — mainline's
    // classic "hits every adjacent foe" spread move.
    shape: { kind: "ring", radius: 2 },
    ...moveCanon("SURF"),
    cooldownTicks: 6,
    range: { min: 0, max: 2 },
    hitsArea: true,
  },
  solar_beam: {
    id: "solar_beam",
    name: "Solar Beam",
    // Real long reach, deliberately single-target (mainline's own signature
    // is raw power/range, not a spread effect) — this sim has no charge-turn
    // mechanic, so the "gathering light" cost is approximated as a longer
    // cooldown instead.
    shape: { kind: "line", length: 5 },
    ...moveCanon("SOLAR_BEAM"),
    cooldownTicks: 9,
    range: { min: 0, max: 5 },
    // v3 redesign (MOVES_DESIGN.md's "start from the fantasy" pass). THE
    // FANTASY: concentrated sunlight drawn down into a devastating beam —
    // it needs a moment to gather (the long cooldown is the real "charge"
    // analog) but hits with overwhelming, precise force. Venusaur is this
    // sim's own real guardian archetype (see species.ts's own comment on
    // its isPredator-free, always-on guardian role), so this tree leans
    // into that directly instead of a generic power-move template:
    // - Aggression ("Dominance"): the widened design space's "clashing"
    //   flavor — a territorial grazer asserting dominance over a rival,
    //   not just raw damage. `bonusVsType` vs. Grass is the mechanically
    //   correct expression of that (Grass resists Grass 0.5x — a real
    //   challenger of the user's own kind gets punished hardest).
    // - Boldness ("Bulwark"): defensive is the earned answer for a
    //   guardian species — genuinely tanky, not a re-skin of Earthquake's
    //   terraforming (that fantasy belonged to Earthquake specifically).
    // - Sociability ("Grove"): protects the herd's grazing ground. Its
    //   fork makes explicit (via `excludes`) a mechanic the engine already
    //   has implicitly — a later `allyEffect` node overwrites an earlier
    //   one — so choosing between "heal the grove" and "steel the grove"
    //   is a real, deliberate decision instead of an emergent quirk.
    tree: {
      gathering_light: {
        id: "gathering_light",
        name: "Gathering Light",
        cost: 1,
        leaning: "aggression",
        delta: { critRateStage: 1 },
      },
      focusing_lens: {
        id: "focusing_lens",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["gathering_light"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      dominance_footing: {
        id: "dominance_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["focusing_lens"], ["rooted_assault"], ["territorial_flare"]],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      piercing_ray: {
        id: "piercing_ray",
        name: "Piercing Ray",
        cost: 1,
        prerequisites: ["dominance_footing"],
        leaning: "aggression",
        delta: { defensePenetration: 0.3 },
      },
      widening_beam: {
        id: "widening_beam",
        name: "+2 Range",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Aggression (Rooted Assault's and Territorial
        // Flare's own chains).
        prerequisitesAnyOf: [["piercing_ray"], ["bedrock_beam"], ["dominant_bloom"]],
        leaning: "aggression",
        delta: { range: { max: 7 } },
      },
      withering_glare: {
        id: "withering_glare",
        name: "Withering Glare",
        cost: 1,
        prerequisites: ["widening_beam"],
        excludes: ["overwhelming_beam"],
        leaning: "aggression",
        // Catches a challenger off guard, before it's even noticed the
        // light gathering.
        delta: { cooldownTicks: -1, situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      overwhelming_beam: {
        id: "overwhelming_beam",
        name: "Overwhelming Beam",
        cost: 1,
        prerequisites: ["widening_beam"],
        excludes: ["withering_glare"],
        leaning: "aggression",
        // An all-in blast that leaves the user briefly exposed after.
        delta: { power: 20, lockTicks: 1 },
      },
      claim_the_grove: {
        id: "claim_the_grove",
        name: "Claim the Grove",
        cost: 2,
        prerequisitesAnyOf: [["withering_glare"], ["overwhelming_beam"]],
        leaning: "aggression",
        // A rival Grass-type challenger gets punished hardest — a real
        // clash over territory, not a generic type-matchup bonus.
        delta: { bonusVsType: { type: "grass", multiplier: 1.5 } },
      },
      dominance_precision: {
        id: "dominance_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["claim_the_grove"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      sovereigns_beam: {
        id: "sovereigns_beam",
        name: "Sovereign's Beam",
        cost: 2,
        prerequisites: ["dominance_precision"],
        leaning: "aggression",
        delta: { power: 15, critRateStage: 1 },
      },
      sunlit_roots: {
        id: "sunlit_roots",
        name: "Sunlit Roots",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.08 },
        delta: {},
      },
      bulwark_footing: {
        id: "bulwark_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["sunlit_roots"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      bloom_footing: {
        id: "bloom_footing",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["bulwark_footing"], ["rooted_assault"], ["shared_shade"]],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      steadfast_bloom: {
        id: "steadfast_bloom",
        name: "Steadfast Bloom",
        cost: 1,
        prerequisites: ["bloom_footing"],
        leaning: "boldness",
        delta: { defensePenetration: 0.2 },
      },
      deepening_roots: {
        id: "deepening_roots",
        name: "+2 Range",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Boldness (Rooted Assault's and Shared Shade's own
        // chains).
        prerequisitesAnyOf: [["steadfast_bloom"], ["bedrock_beam"], ["grove_bulwark"]],
        leaning: "boldness",
        delta: { range: { max: 7 } },
      },
      guardians_ground: {
        id: "guardians_ground",
        name: "Guardian's Ground",
        cost: 1,
        prerequisites: ["deepening_roots"],
        excludes: ["verdant_wall"],
        leaning: "boldness",
        // Holds the high, defensible ground rather than turtling in place.
        delta: { cooldownTicks: -1, situationalBonus: { condition: "elevation", multiplier: 1.3 } },
      },
      verdant_wall: {
        id: "verdant_wall",
        name: "Verdant Wall",
        cost: 1,
        prerequisites: ["deepening_roots"],
        excludes: ["guardians_ground"],
        leaning: "boldness",
        // Retaliates against anyone striking while it channels.
        grantsPassive: { kind: "thorns", value: 0.12 },
        delta: {},
      },
      bulwark_bloom: {
        id: "bulwark_bloom",
        name: "Bulwark Bloom",
        cost: 2,
        prerequisitesAnyOf: [["guardians_ground"], ["verdant_wall"]],
        leaning: "boldness",
        // The beam's own recoiling light physically repels whoever it
        // strikes — a defensive push, not just a bigger hit.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      bulwark_resolve: {
        id: "bulwark_resolve",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["bulwark_bloom"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      ancient_grove: {
        id: "ancient_grove",
        name: "Ancient Grove",
        cost: 2,
        prerequisites: ["bulwark_resolve"],
        leaning: "boldness",
        // An immovable, ancient guardian that punishes and endures.
        grantsPassives: [
          { kind: "thorns", value: 0.1 },
          { kind: "regen", value: 0.04 },
        ],
        delta: {},
      },
      grove_ward: {
        id: "grove_ward",
        name: "Grove Ward",
        cost: 1,
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.15 } },
      },
      grove_footing: {
        id: "grove_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["grove_ward"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      grove_reach: {
        id: "grove_reach",
        name: "+2 Range",
        cost: 1,
        prerequisitesAnyOf: [["grove_footing"], ["shared_shade"], ["territorial_flare"]],
        leaning: "sociability",
        delta: { range: { max: 7 } },
      },
      grove_muster: {
        id: "grove_muster",
        name: "Grove Muster",
        cost: 1,
        prerequisites: ["grove_reach"],
        leaning: "sociability",
        // The grove calls on the herd to converge and defend it together.
        delta: { rallyCall: { ticks: 20 } },
      },
      grove_precision: {
        id: "grove_precision",
        name: "+5 Accuracy",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Sociability (Shared Shade's and Territorial
        // Flare's own chains).
        prerequisitesAnyOf: [["grove_muster"], ["grove_bulwark"], ["dominant_bloom"]],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      vital_bloom: {
        id: "vital_bloom",
        name: "Vital Bloom",
        cost: 1,
        prerequisites: ["grove_precision"],
        excludes: ["steadfast_bloom_ally"],
        leaning: "sociability",
        // Explicit fork over the same "later node wins" ally-effect
        // overwrite Tackle's own tree already relies on implicitly — here
        // it's a real, deliberate choice between healing the grove...
        delta: { allyEffect: { healFraction: 0.25 } },
      },
      steadfast_bloom_ally: {
        id: "steadfast_bloom_ally",
        name: "Steadfast Bloom",
        cost: 1,
        prerequisites: ["grove_precision"],
        excludes: ["vital_bloom"],
        leaning: "sociability",
        // ...or steeling it instead.
        delta: { allyEffect: { buff: { stat: "defense", stage: 2, ticks: 20 } } },
      },
      grove_instinct: {
        id: "grove_instinct",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["vital_bloom"], ["steadfast_bloom_ally"]],
        leaning: "sociability",
        delta: { cooldownTicks: -2, accuracy: 5 },
      },
      eternal_grove: {
        id: "eternal_grove",
        name: "Eternal Grove",
        cost: 2,
        prerequisites: ["grove_instinct"],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.04 },
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.25, buff: { stat: "spAttack", stage: 1, ticks: 20 } } },
      },
      // Crosslink: Aggression <-> Boldness — the guardian's own steady
      // roots feed the beam's focus.
      rooted_assault: {
        id: "rooted_assault",
        name: "Rooted Assault",
        cost: 1,
        prerequisites: ["gathering_light", "sunlit_roots"],
        leaning: "aggression",
        delta: { defensePenetration: 0.2 },
      },
      // Bridge tail (see MOVES_DESIGN.md's "Crosslinks as bridges"):
      // extends Rooted Assault into Aggression's and Boldness's own
      // pre-fork nodes (Widening Beam / Deepening Roots).
      sunlit_focus: {
        id: "sunlit_focus",
        name: "+0.1 Defense Penetration",
        cost: 1,
        prerequisites: ["rooted_assault"],
        leaning: "aggression",
        // Deepens Rooted Assault's own lever directly, instead of a
        // generic accuracy bolt-on.
        delta: { defensePenetration: 0.1 },
      },
      bedrock_beam: {
        id: "bedrock_beam",
        name: "Bedrock Beam",
        cost: 2,
        prerequisites: ["sunlit_focus"],
        leaning: "boldness",
        // Rooted so firmly it punishes anything that gets close — ties
        // Boldness's own thorns lever (Verdant Wall/Ancient Grove) into
        // the bridge instead of a flat power bolt-on.
        grantsPassive: { kind: "thorns", value: 0.08 },
        delta: {},
      },
      // Crosslink: Boldness <-> Sociability — shared vitality from
      // standing guard together.
      shared_shade: {
        id: "shared_shade",
        name: "Shared Shade",
        cost: 1,
        prerequisites: ["sunlit_roots", "grove_ward"],
        leaning: "boldness",
        grantsPassive: { kind: "regenFlat", value: 1.5 },
        delta: {},
      },
      // Bridge tail: extends Shared Shade into Boldness's and
      // Sociability's own pre-fork nodes (Deepening Roots / Grove
      // Precision).
      canopy_footing: {
        id: "canopy_footing",
        name: "+0.75 HP Regen",
        cost: 1,
        prerequisites: ["shared_shade"],
        leaning: "boldness",
        // Deepens Shared Shade's own shared-vitality lever directly,
        // instead of a generic power bolt-on.
        grantsPassive: { kind: "regenFlat", value: 0.75 },
        delta: {},
      },
      grove_bulwark: {
        id: "grove_bulwark",
        name: "Grove Bulwark",
        cost: 2,
        prerequisites: ["canopy_footing"],
        leaning: "sociability",
        // The shared shade becomes real shared armor — ties Boldness's own
        // defenseBoost lever (Sunlit Roots) into the bridge instead of a
        // flat defensePenetration bolt-on.
        grantsPassive: { kind: "defenseBoost", value: 0.05 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — the herd's own warning
      // lets the dominant beam catch a challenger unaware.
      territorial_flare: {
        id: "territorial_flare",
        name: "Territorial Flare",
        cost: 1,
        prerequisites: ["grove_ward", "gathering_light"],
        leaning: "sociability",
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.3 } },
      },
      // Bridge tail: extends Territorial Flare into Sociability's and
      // Aggression's own pre-fork nodes (Grove Precision / Widening Beam).
      territorial_footing: {
        id: "territorial_footing",
        name: "+1 Crit Rate Stage",
        cost: 1,
        prerequisites: ["territorial_flare"],
        leaning: "sociability",
        // Catching a challenger off guard is exactly when a solid hit
        // becomes a great one — ties Dominance's own crit lever (Gathering
        // Light) in, instead of a generic accuracy bolt-on.
        delta: { critRateStage: 1 },
      },
      dominant_bloom: {
        id: "dominant_bloom",
        name: "Triple Bloom",
        cost: 2,
        prerequisites: ["territorial_footing"],
        leaning: "aggression",
        // A real, flashy capstone-tier payoff — the dominance display
        // widens into three simultaneous beams. Solar Beam is deliberately
        // single-target everywhere else in this tree (see the move's own
        // top comment); this is the one place a shape change is earned,
        // per template v3's rule that shape/AoE changes belong at
        // notable/capstone tier, never filler.
        delta: { shape: { kind: "cone", length: 5, width: 3 }, hitsArea: true },
      },
    },
  },
  earthquake: {
    id: "earthquake",
    name: "Earthquake",
    // Self-centered — the ground shakes out from under the user, catching
    // everyone nearby regardless of which one was targeted.
    shape: { kind: "burst", radius: 2 },
    ...moveCanon("EARTHQUAKE"),
    cooldownTicks: 8,
    range: { min: 0, max: 2 },
    hitsArea: true,
    // v3 redesign (MOVES_DESIGN.md's "start from the fantasy" pass —
    // Earthquake's own worked example there). THE FANTASY: a self-centered
    // shockwave that radiates out in every direction — reckless area
    // denial that doesn't distinguish friend from foe. That's real,
    // current engine behavior (`resolveAreaHit` has no herd filter by
    // default), not just flavor text, which is exactly the design space
    // each branch answers differently:
    // - Aggression ("Overload"): leans further into scale and
    //   indiscriminate destruction — loud and obvious, not a stealth/
    //   ambush fantasy, so it stays power-archetype on purpose (widening
    //   Aggression's design space doesn't mean every move has to use
    //   every flavor).
    // - Boldness ("Fracture"): stops defaulting to flat tankiness and
    //   reshapes the battlefield instead — the ground itself becomes
    //   difficult, hazardous terrain (`terrainFill: "mud"`, a real,
    //   already-shipped slow-terrain kind) wherever the quake lands.
    // - Sociability ("Herdsafe Ground"): turns the move's own flaw into
    //   its payoff — the herd learns to read the tremor and doesn't get
    //   caught in it (`excludesAllies`, the new primitive this redesign
    //   needed), then turns the aftershock into real support.
    tree: {
      fault_trigger: {
        id: "fault_trigger",
        name: "Fault Trigger",
        cost: 1,
        leaning: "aggression",
        // The bigger the mover, the bigger the quake it can trigger.
        delta: { weightScaling: { factor: 0.12 } },
      },
      shaking_ground: {
        id: "shaking_ground",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["fault_trigger"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      overload_footing: {
        id: "overload_footing",
        name: "Reckless Overload",
        cost: 1,
        prerequisitesAnyOf: [["shaking_ground"], ["cracking_momentum"], ["coordinated_tremor"]],
        leaning: "aggression",
        // Fixed a real bug here: this node used to be `recoilFraction: 0.1`
        // alone — a full skill point spent on nothing but self-damage, no
        // tradeoff at all. Recoil is a real lever everywhere else in the
        // roster (Cataclysm below, Tackle's own keystones, Ember's Pyroclasm)
        // ONLY when paired with the power it's buying in the same node.
        // Paired here to match.
        delta: { power: 10, recoilFraction: 0.1 },
      },
      aftershock_barrage: {
        id: "aftershock_barrage",
        name: "Aftershock Barrage",
        cost: 1,
        prerequisites: ["overload_footing"],
        leaning: "aggression",
        delta: { hits: { min: 2, max: 2 }, power: -10 },
      },
      seismic_feed: {
        id: "seismic_feed",
        name: "+8% Lifesteal",
        cost: 1,
        // Reachable the normal way, or via either of the two crosslink
        // bridges that reach into Aggression (Coordinated Tremor's and
        // Cracking Momentum's own chains) — each lands here, one step
        // before the fork below, same as the normal path.
        prerequisitesAnyOf: [["aftershock_barrage"], ["converged_ruin"], ["fault_convergence"]],
        leaning: "aggression",
        delta: { lifestealFraction: 0.08 },
      },
      total_collapse: {
        id: "total_collapse",
        name: "Total Collapse",
        cost: 1,
        prerequisites: ["seismic_feed"],
        excludes: ["focused_rupture"],
        leaning: "aggression",
        // Widens the blast itself — a real AoE-size decision point, not
        // filler (see MOVES_DESIGN.md's rule on this).
        delta: { shape: { kind: "burst", radius: 3 }, power: -10 },
      },
      focused_rupture: {
        id: "focused_rupture",
        name: "Focused Rupture",
        cost: 1,
        prerequisites: ["seismic_feed"],
        excludes: ["total_collapse"],
        leaning: "aggression",
        // Pulls the blast back in tight and puts everything into what it
        // does hit.
        delta: { shape: { kind: "burst", radius: 1 }, power: 20, defensePenetration: 0.3 },
      },
      chain_reaction: {
        id: "chain_reaction",
        name: "Chain Reaction",
        cost: 2,
        prerequisitesAnyOf: [["total_collapse"], ["focused_rupture"]],
        leaning: "aggression",
        delta: { critRateStage: 1 },
      },
      overload_precision: {
        id: "overload_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["chain_reaction"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      cataclysm: {
        id: "cataclysm",
        name: "Cataclysm",
        cost: 2,
        prerequisites: ["overload_precision"],
        leaning: "aggression",
        delta: { power: 20, recoilFraction: 0.05 },
      },
      fissure_grip: {
        id: "fissure_grip",
        name: "Fissure Grip",
        cost: 1,
        leaning: "boldness",
        // Wherever this lands, the ground cracks into real, treacherous
        // rubble — the terraforming half of the fantasy, live from the
        // opener, not saved for a keystone.
        delta: { terrainFill: { terrain: "mud" } },
      },
      bedrock_footing_2: {
        id: "bedrock_footing_2",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["fissure_grip"],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      cracking_footing: {
        id: "cracking_footing",
        name: "+1 Range",
        cost: 1,
        prerequisitesAnyOf: [["bedrock_footing_2"], ["cracking_momentum"], ["fractured_warning"]],
        leaning: "boldness",
        delta: { range: { max: 3 } },
      },
      bedrock_anchor: {
        id: "bedrock_anchor",
        name: "Bedrock Anchor",
        cost: 1,
        prerequisites: ["cracking_footing"],
        leaning: "boldness",
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      deepening_fissure: {
        id: "deepening_fissure",
        name: "+0.3 Defense Penetration",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Boldness (Cracking Momentum's and Fractured
        // Warning's own chains).
        prerequisitesAnyOf: [["bedrock_anchor"], ["fault_convergence"], ["warded_convergence"]],
        leaning: "boldness",
        delta: { defensePenetration: 0.3 },
      },
      widening_rift: {
        id: "widening_rift",
        name: "Widening Rift",
        cost: 1,
        prerequisites: ["deepening_fissure"],
        excludes: ["grounding_brace"],
        leaning: "boldness",
        delta: { shape: { kind: "burst", radius: 3 } },
      },
      grounding_brace: {
        id: "grounding_brace",
        name: "Grounding Brace",
        cost: 1,
        prerequisites: ["deepening_fissure"],
        excludes: ["widening_rift"],
        leaning: "boldness",
        // Braces so hard against its own tremor that it can't immediately
        // follow up — a real cost for the extra protection.
        grantsPassive: { kind: "damageReductionFlat", value: 2 },
        delta: { lockTicks: 1 },
      },
      rubble_wall: {
        id: "rubble_wall",
        name: "Rubble Wall",
        cost: 2,
        prerequisitesAnyOf: [["widening_rift"], ["grounding_brace"]],
        leaning: "boldness",
        // The rubble itself shoves anyone standing on it away from the
        // epicenter.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      fracture_precision: {
        id: "fracture_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["rubble_wall"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      ruinous_ground: {
        id: "ruinous_ground",
        name: "Ruinous Ground",
        cost: 2,
        prerequisites: ["fracture_precision"],
        leaning: "boldness",
        // Fixes Ground's real Grass/Bug resists.
        delta: { resistanceBreaker: { multiplier: 2 } },
      },
      herdsafe_trigger: {
        id: "herdsafe_trigger",
        name: "Herdsafe Trigger",
        cost: 1,
        leaning: "sociability",
        // The branch's whole point, live from the opener: a herd drilled
        // on this move stops getting caught in its own quake.
        delta: { excludesAllies: true },
      },
      herdsafe_footing: {
        id: "herdsafe_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["herdsafe_trigger"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      warning_footing: {
        id: "warning_footing",
        name: "+8% Lifesteal",
        cost: 1,
        prerequisitesAnyOf: [["herdsafe_footing"], ["fractured_warning"], ["coordinated_tremor"]],
        leaning: "sociability",
        delta: { lifestealFraction: 0.08 },
      },
      bracing_call: {
        id: "bracing_call",
        name: "Bracing Call",
        cost: 1,
        prerequisites: ["warning_footing"],
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      tremor_reach: {
        id: "tremor_reach",
        name: "+1 Range",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Sociability (Coordinated Tremor's and Fractured
        // Warning's own chains) — each lands here, one step before the
        // fork below, same as the normal path.
        prerequisitesAnyOf: [["bracing_call"], ["converged_ruin"], ["warded_convergence"]],
        leaning: "sociability",
        delta: { range: { max: 3 } },
      },
      guardians_ground: {
        id: "guardians_ground",
        name: "Guardian's Ground",
        cost: 1,
        prerequisites: ["tremor_reach"],
        excludes: ["rally_quake"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      rally_quake: {
        id: "rally_quake",
        name: "Rally Quake",
        cost: 1,
        prerequisites: ["tremor_reach"],
        excludes: ["guardians_ground"],
        leaning: "sociability",
        // The aftershock keeps helping even mid-fight — no dedicated
        // support use needed to trigger it.
        delta: { allyEffectOnAttack: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      communal_steadying: {
        id: "communal_steadying",
        name: "Communal Steadying",
        cost: 2,
        prerequisitesAnyOf: [["guardians_ground"], ["rally_quake"]],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: {},
      },
      herd_precision: {
        id: "herd_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["communal_steadying"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      sanctuary_quake: {
        id: "sanctuary_quake",
        name: "Sanctuary Quake",
        cost: 2,
        prerequisites: ["herd_precision"],
        leaning: "sociability",
        // The aftershock settles into a real, ongoing comfort for whoever
        // stayed close — the ultimate payoff of a quake that heals its own
        // people instead of scattering them.
        grantsPassive: { kind: "healAura", value: 0.015 },
        delta: {},
      },
      // Crosslink: Aggression <-> Boldness — the user lurches forward into
      // the rubble it just cracked open, real momentum off real terrain.
      cracking_momentum: {
        id: "cracking_momentum",
        name: "Cracking Momentum",
        cost: 1,
        prerequisites: ["fault_trigger", "fissure_grip"],
        leaning: "aggression",
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "onHit" } },
      },
      // Bridge tail (see MOVES_DESIGN.md's "Crosslinks as bridges"): extends
      // Cracking Momentum into Aggression's and Boldness's own pre-fork
      // nodes (Seismic Feed / Deepening Fissure).
      momentum_footing: {
        id: "momentum_footing",
        name: "Deeper Lunge",
        cost: 1,
        prerequisites: ["cracking_momentum"],
        leaning: "aggression",
        // Deepens Cracking Momentum's own forced-movement lever directly
        // (overwrite, like every other `forcedMovement`) — the momentum
        // carries it twice as far — instead of a generic accuracy bolt-on.
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 2, timing: "onHit" } },
      },
      fault_convergence: {
        id: "fault_convergence",
        name: "Fault Convergence",
        cost: 2,
        prerequisites: ["momentum_footing"],
        leaning: "boldness",
        // Crashing through that much rubble that fast costs something real
        // — a genuine tradeoff, not a flat power bolt-on with nothing to
        // balance it (see MOVES_DESIGN.md's guide on pure-downside bugs).
        delta: { power: 15, recoilFraction: 0.08 },
      },
      // Crosslink: Boldness <-> Sociability — the visible fracture throws
      // off the footing of anyone nearby, friend and foe's tempo alike
      // (the herd already knows to keep clear, per the Sociability opener).
      fractured_warning: {
        id: "fractured_warning",
        name: "Fractured Warning",
        cost: 1,
        prerequisites: ["fissure_grip", "herdsafe_trigger"],
        leaning: "boldness",
        delta: { jamCooldownTicks: 1 },
      },
      // Bridge tail: extends Fractured Warning into Boldness's and
      // Sociability's own pre-fork nodes (Deepening Fissure / Tremor Reach).
      tremor_lockstep: {
        id: "tremor_lockstep",
        name: "+1 Jam",
        cost: 1,
        prerequisites: ["fractured_warning"],
        leaning: "boldness",
        // Deepens Fractured Warning's own jam lever directly, instead of a
        // generic accuracy bolt-on.
        delta: { jamCooldownTicks: 1 },
      },
      warded_convergence: {
        id: "warded_convergence",
        name: "Warded Convergence",
        cost: 2,
        prerequisites: ["tremor_lockstep"],
        leaning: "sociability",
        // The warning becomes real protection — ties into the herd's own
        // bracing instead of a generic jam-again bolt-on.
        grantsPassive: { kind: "damageReduction", value: 0.05 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — once the herd's clear and
      // warned, whatever's left standing gets the full, converged brunt.
      coordinated_tremor: {
        id: "coordinated_tremor",
        name: "Coordinated Tremor",
        cost: 1,
        prerequisites: ["herdsafe_trigger", "fault_trigger"],
        leaning: "sociability",
        delta: { rallyCall: { ticks: 20 } },
      },
      // Deeper crosslink, building on Coordinated Tremor's own mark: a real
      // payoff for following up on it, via the new `"rallyMarked"`
      // `SituationalCondition` (see moves.ts's own doc comment) — the herd
      // converging on something is worth more once the quake actually
      // lands on it too.
      marked_rupture: {
        id: "marked_rupture",
        name: "Marked Rupture",
        cost: 1,
        prerequisites: ["coordinated_tremor"],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "rallyMarked", multiplier: 1.3 } },
      },
      // Pilot: a crosslink that's a real bridge, not a dead-end leaf.
      // Coordinated Tremor -> Marked Rupture -> Converged Ruin is its own
      // short filler+notable tail. Converged Ruin is wired as a real
      // alternate route into BOTH branches Coordinated Tremor bridges —
      // Aggression's `seismic_feed` and Sociability's `tremor_reach` (see
      // each node's own `prerequisitesAnyOf`) — not just the one branch it
      // happens to lean toward. Revised after direct feedback on the first
      // version: landing the shortcut straight on a branch's own fork
      // ("the choice of 2 nodes") was too much; it now lands one step
      // *before* each fork instead, same distance-to-decision as the
      // normal path, and reaches into either side of the crosslink rather
      // than only Aggression.
      converged_ruin: {
        id: "converged_ruin",
        name: "Converged Ruin",
        cost: 2,
        prerequisites: ["marked_rupture"],
        leaning: "aggression",
        // Deepens Marked Rupture's own rallyMarked payoff further
        // (overwrite, like every other situationalBonus) instead of a flat
        // defensePenetration bolt-on — the ground doesn't just care about
        // the mark, the convergence multiplies it.
        delta: { situationalBonus: { condition: "rallyMarked", multiplier: 1.6 } },
      },
    },
  },
  rock_slide: {
    id: "rock_slide",
    name: "Rock Slide",
    // A tighter spread than Earthquake's — boulders raining down close
    // around the user rather than the whole ground shaking.
    shape: { kind: "burst", radius: 1 },
    ...moveCanon("ROCK_SLIDE"),
    cooldownTicks: 5,
    range: { min: 0, max: 1 },
    hitsArea: true,
    // v2 (MOVES_DESIGN.md's own template). Onix's third real move —
    // already has Rock Throw's defense-penetrating single-target tree and
    // Earthquake's ground-shockwave AoE tree, so this one earns a genuinely
    // different fantasy: boulders literally falling FROM ABOVE, not thrown
    // or shaken up from the ground. Leans on `situationalBonus`'s
    // `"elevation"` condition (attacker on a strictly higher tile) as its
    // own real hook, distinct from either sibling tree. Same three-branch-
    // plus-crosslink-triangle shape (10 nodes/branch + 3 crosslinks = 33).
    tree: {
      // --- Aggression: "Landslide Fury" — more stone, falling harder,
      // from higher up.
      raining_stones: {
        id: "raining_stones",
        name: "Raining Stones",
        cost: 1,
        leaning: "aggression",
        delta: { situationalBonus: { condition: "elevation", multiplier: 1.3 } },
      },
      heavier_boulders: {
        id: "heavier_boulders",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["raining_stones"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      steadier_aim: {
        id: "steadier_aim",
        name: "+10 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["heavier_boulders"], ["quarried_weight"], ["second_wave"]],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      crushing_debris: {
        id: "crushing_debris",
        name: "Crushing Debris",
        cost: 1,
        prerequisites: ["steadier_aim"],
        leaning: "aggression",
        delta: { defensePenetration: 0.1 },
      },
      faster_collapse: {
        id: "faster_collapse",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["crushing_debris"], ["mountainfall"], ["no_respite"]],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      wider_slide: {
        id: "wider_slide",
        name: "Wider Slide",
        cost: 1,
        prerequisites: ["faster_collapse"],
        excludes: ["heavier_stones"],
        leaning: "aggression",
        // A broader wall of falling stone, spread thinner.
        delta: { shape: { kind: "burst", radius: 2 }, power: -10 },
      },
      heavier_stones: {
        id: "heavier_stones",
        name: "Heavier Stones",
        cost: 1,
        prerequisites: ["faster_collapse"],
        excludes: ["wider_slide"],
        leaning: "aggression",
        // Fewer, bigger boulders, harder to line up.
        delta: { power: 15, accuracy: -10 },
      },
      ground_shaking_impact: {
        id: "ground_shaking_impact",
        name: "Ground-Shaking Impact",
        cost: 2,
        prerequisitesAnyOf: [["wider_slide"], ["heavier_stones"]],
        leaning: "aggression",
        // Whatever's still standing after the rockfall gets no time to
        // recover before the next one.
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      settling_dust: {
        id: "settling_dust",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["ground_shaking_impact"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      avalanche_wall: {
        id: "avalanche_wall",
        name: "Avalanche Wall",
        cost: 2,
        prerequisites: ["settling_dust"],
        leaning: "aggression",
        // The whole slope comes down at once, Onix's own real mass adding
        // to the weight of what's already falling.
        delta: { shape: { kind: "burst", radius: 2 }, weightScaling: { factor: 0.1 } },
      },
      // Crosslink: Aggression <-> Boldness — a braced stance means it can
      // really put its own mass behind the throw without losing footing.
      quarried_weight: {
        id: "quarried_weight",
        name: "Quarried Weight",
        cost: 1,
        prerequisites: ["raining_stones", "stone_shield"],
        leaning: "aggression",
        delta: { weightScaling: { factor: 0.08 } },
      },
      heaved_mass: {
        id: "heaved_mass",
        name: "Heaved Mass",
        cost: 1,
        prerequisites: ["quarried_weight"],
        leaning: "aggression",
        // Deepens Quarried Weight's own mass scaling (overwrite — restates the
        // full factor, not an increment).
        delta: { weightScaling: { factor: 0.14 } },
      },
      mountainfall: {
        id: "mountainfall",
        name: "Mountainfall",
        cost: 2,
        prerequisites: ["heaved_mass"],
        leaning: "boldness",
        // Heaving that much rock is genuinely exhausting — a real per-use cost
        // in the same node as its payoff.
        delta: { power: 12, selfCostPerUse: { need: "energy", amount: 0.05 } },
      },
      // --- Boldness: "Bedrock Stance" — standing unmoved in the middle of
      // its own rockfall.
      // --- Boldness: mass, and the high ground it fights from ---
      //
      // Reworked off the same generic armor ladder vine_whip and
      // flamethrower were running node-for-node (damageReduction ->
      // defenseBoost -> regen/thorns fork -> defenseBoost+thorns capstone,
      // identical passive values). Vine Whip is the honest owner of
      // rooted-and-thorny; this branch was borrowing it.
      //
      // What is only true of a rockslide: it is a WEIGHT problem, and it is
      // an ELEVATION problem. Nothing else in the roster gets to build
      // around `weightScaling` and the `elevation` situational bonus, and
      // both are levers the trees have barely touched. This branch is about
      // being the heavy thing standing above you, not about having thicker
      // skin than the next tank.
      stone_shield: {
        id: "stone_shield",
        name: "Set Stance",
        cost: 1,
        leaning: "boldness",
        // Plants its feet and lets its own bulk do the work — the branch's
        // thesis stated in its first node.
        delta: { weightScaling: { factor: 0.2 } },
      },
      firmer_footing: {
        id: "firmer_footing",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["stone_shield"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      craggy_hide: {
        id: "craggy_hide",
        name: "Craggy Hide",
        cost: 1,
        prerequisitesAnyOf: [["firmer_footing"], ["quarried_weight"], ["steadfast_warning"]],
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.05 },
        delta: {},
      },
      denser_stone: {
        id: "denser_stone",
        name: "Denser Stone",
        cost: 1,
        prerequisites: ["craggy_hide"],
        leaning: "boldness",
        // Deepens the opener's own lever instead of being another +5 Power.
        delta: { weightScaling: { factor: 0.15 } },
      },
      settled_stance: {
        id: "settled_stance",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["denser_stone"], ["mountainfall"], ["unmoved_sentinel"]],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      // The fork: take the high ground and rain rock down from it, or
      // refuse to give ground at all. Both are "mass"; they want opposite
      // positions on the map, which is the tension worth having.
      weathering: {
        id: "weathering",
        name: "High Perch",
        cost: 1,
        prerequisites: ["settled_stance"],
        excludes: ["jagged_edges"],
        leaning: "boldness",
        delta: { situationalBonus: { condition: "elevation", multiplier: 1.45 } },
      },
      jagged_edges: {
        id: "jagged_edges",
        name: "Jagged Edges",
        cost: 1,
        prerequisites: ["settled_stance"],
        excludes: ["weathering"],
        leaning: "boldness",
        grantsPassive: { kind: "thorns", value: 0.12 },
        delta: {},
      },
      unbroken: {
        id: "unbroken",
        name: "Unbroken",
        cost: 2,
        prerequisitesAnyOf: [["weathering"], ["jagged_edges"]],
        leaning: "boldness",
        // Anchored under its own rockfall — no drag/knockback/lunge so
        // much as budges it, a real delivery on "Unbroken" instead of
        // another flat damage-reduction stand-in.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      time_worn: {
        id: "time_worn",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["unbroken"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      mountains_weight: {
        id: "mountains_weight",
        name: "Mountain's Weight",
        cost: 2,
        prerequisites: ["time_worn"],
        leaning: "boldness",
        // Escalates the branch's OWN lever — the heaviest version of the
        // thing every node here has been building — rather than reaching
        // for the roster's stock defenseBoost+thorns tank capstone, which
        // is exactly what it used to be.
        grantsPassive: { kind: "defenseBoost", value: 0.06 },
        delta: { weightScaling: { factor: 0.25 }, defensePenetration: 0.15 },
      },
      // Crosslink: Boldness <-> Sociability — the same steadiness that
      // shrugs off falling rock is also what lets it read the coming
      // rumble early.
      steadfast_warning: {
        id: "steadfast_warning",
        name: "Steadfast Warning",
        cost: 1,
        prerequisites: ["stone_shield", "herd_warning"],
        leaning: "sociability",
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
        delta: {},
      },
      braced_footing: {
        id: "braced_footing",
        name: "Braced Footing",
        cost: 1,
        prerequisites: ["steadfast_warning"],
        leaning: "boldness",
        // Deepens Steadfast Warning's own defense lever.
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
        delta: {},
      },
      unmoved_sentinel: {
        id: "unmoved_sentinel",
        name: "Unmoved Sentinel",
        cost: 2,
        prerequisites: ["braced_footing"],
        leaning: "sociability",
        // Holds the line while everything else is still getting clear.
        grantsPassives: [
          { kind: "defenseBoost", value: 0.04 },
          { kind: "damageReduction", value: 0.05 },
        ],
        delta: {},
      },
      // --- Sociability: "Warning Rumble" — the tremor before the rockfall
      // gives everyone nearby, herd or rival, a real chance to get clear.
      herd_warning: {
        id: "herd_warning",
        name: "Herd Warning",
        cost: 1,
        leaning: "sociability",
        // Same real ally-exemption Earthquake's own Herdsafe Trigger uses —
        // a same-herd agent caught in the burst takes nothing.
        delta: { excludesAllies: true },
      },
      clearer_warning: {
        id: "clearer_warning",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["herd_warning"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      faster_warning: {
        id: "faster_warning",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["clearer_warning"], ["steadfast_warning"], ["second_wave"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      settling_rumble: {
        id: "settling_rumble",
        name: "Settling Rumble",
        cost: 1,
        prerequisites: ["faster_warning"],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      deeper_rumble: {
        id: "deeper_rumble",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["settling_rumble"], ["unmoved_sentinel"], ["no_respite"]],
        leaning: "sociability",
        delta: { power: 5 },
      },
      wider_warning: {
        id: "wider_warning",
        name: "Wider Warning",
        cost: 1,
        prerequisites: ["deeper_rumble"],
        excludes: ["sharpened_call"],
        leaning: "sociability",
        // Deepens the calm further — an even bigger radius of rivals that
        // just... don't bother.
        grantsPassive: { kind: "calmingPresence", value: 0.15 },
        delta: {},
      },
      sharpened_call: {
        id: "sharpened_call",
        name: "Sharpened Call",
        cost: 1,
        prerequisites: ["deeper_rumble"],
        excludes: ["wider_warning"],
        leaning: "sociability",
        // An Onix this reliably loud about warning everyone off doesn't
        // pick fights it doesn't need either.
        grantsPassive: { kind: "nonTerritorial", value: 1 },
        delta: {},
      },
      toppling_call: {
        id: "toppling_call",
        name: "Toppling Call",
        cost: 2,
        prerequisitesAnyOf: [["wider_warning"], ["sharpened_call"]],
        leaning: "sociability",
        // Whatever's still standing after the warning gets marked for
        // anything else nearby to finish.
        delta: { rallyCall: { ticks: 15 } },
      },
      lasting_rumble: {
        id: "lasting_rumble",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["toppling_call"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      stone_circle: {
        id: "stone_circle",
        name: "Stone Circle",
        cost: 2,
        prerequisites: ["lasting_rumble"],
        leaning: "sociability",
        // Escalates the branch's own real lever instead of switching to a
        // generic heal — after enough warnings, the ground around it
        // finally settles for good, a decisively bigger calm than
        // anything earlier on this branch (0.2/0.15 at most before this).
        grantsPassive: { kind: "calmingPresence", value: 0.3 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — the first wave was the
      // warning; while everything's still reacting to it, a second wave
      // gives whatever's left standing no real chance to recover.
      second_wave: {
        id: "second_wave",
        name: "Second Wave",
        cost: 1,
        prerequisites: ["herd_warning", "raining_stones"],
        leaning: "aggression",
        delta: { jamCooldownTicks: 1 },
      },
      rolling_aftershock: {
        id: "rolling_aftershock",
        name: "Rolling Aftershock",
        cost: 1,
        prerequisites: ["second_wave"],
        leaning: "aggression",
        // Deepens Second Wave's own tempo denial.
        delta: { jamCooldownTicks: 1 },
      },
      no_respite: {
        id: "no_respite",
        name: "No Respite",
        cost: 2,
        prerequisites: ["rolling_aftershock"],
        leaning: "sociability",
        // Whatever's still pinned under the aftershocks gets marked for
        // everything else nearby — denial turning into focus fire.
        delta: { rallyCall: { ticks: 15 } },
      },
    },
  },
  sludge: {
    id: "sludge",
    name: "Sludge",
    shape: { kind: "cone", length: 2, width: 2 },
    ...moveCanon("SLUDGE"),
    cooldownTicks: 4,
    range: { min: 0, max: 2 },
    hitsArea: true,
    statusChance: 0.3,
    statusKind: "poison",
  },
  poison_sting: {
    id: "poison_sting",
    name: "Poison Sting",
    shape: { kind: "point" },
    ...moveCanon("POISON_STING"),
    cooldownTicks: 2,
    range: { min: 0, max: 1 },
    statusChance: 0.3,
    statusKind: "poison",
  },
  twineedle: {
    id: "twineedle",
    name: "Twineedle",
    shape: { kind: "point" },
    ...moveCanon("TWINEEDLE"),
    cooldownTicks: 2,
    range: { min: 0, max: 1 },
    hits: { min: 2, max: 2 },
    statusChance: 0.2,
    statusKind: "poison",
  },
  ice_beam: {
    id: "ice_beam",
    name: "Ice Beam",
    shape: { kind: "line", length: 3 },
    ...moveCanon("ICE_BEAM"),
    cooldownTicks: 6,
    range: { min: 0, max: 3 },
    statusChance: 0.1,
    statusKind: "freeze",
  },
  psybeam: {
    id: "psybeam",
    name: "Psybeam",
    // Mainline's own confusion chance isn't representable (no such
    // StatusKind exists in this sim — see MOVES_DESIGN.md), so this is a
    // clean, real-reach special hit with no status roll.
    shape: { kind: "line", length: 2 },
    ...moveCanon("PSYBEAM"),
    cooldownTicks: 4,
    range: { min: 0, max: 2 },
  },
  wing_attack: {
    id: "wing_attack",
    name: "Wing Attack",
    shape: { kind: "cone", length: 2, width: 2 },
    ...moveCanon("WING_ATTACK"),
    cooldownTicks: 4,
    range: { min: 0, max: 2 },
    hitsArea: true,
    // v2 (MOVES_DESIGN.md's own template). Pidgey's real signature move,
    // spawned every run — a small, fast prey bird whose actual defense is
    // the flock, not raw toughness. Same three-branch-plus-crosslink-
    // triangle shape as Tackle/Vine Whip (10 nodes/branch + 3 crosslinks =
    // 33), every lever already-shipped engine plumbing.
    tree: {
      // --- Aggression: "Relentless Dive" — quick, repeated diving strikes,
      // built around landing a real crit and following up before the
      // target can recover.
      diving_strike: {
        id: "diving_strike",
        name: "Diving Strike",
        cost: 1,
        leaning: "aggression",
        delta: { critRateStage: 1 },
      },
      sharpened_talons: {
        id: "sharpened_talons",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["diving_strike"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      steady_approach: {
        id: "steady_approach",
        name: "+10 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["sharpened_talons"], ["riding_the_gust"], ["scattering_strike"]],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      talon_rake: {
        id: "talon_rake",
        name: "Talon Rake",
        cost: 1,
        prerequisites: ["steady_approach"],
        leaning: "aggression",
        delta: { defensePenetration: 0.12 },
      },
      quicker_wings: {
        id: "quicker_wings",
        name: "Quicker Wings",
        cost: 1,
        prerequisitesAnyOf: [["talon_rake"], ["stooping_dive"], ["broken_formation"]],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      rapid_wingbeats: {
        id: "rapid_wingbeats",
        name: "Rapid Wingbeats",
        cost: 1,
        prerequisites: ["quicker_wings"],
        excludes: ["full_talon_dive"],
        leaning: "aggression",
        // Two quick, lighter strikes instead of one committed dive.
        delta: { hits: { min: 2, max: 2 }, power: -10 },
      },
      full_talon_dive: {
        id: "full_talon_dive",
        name: "Full Talon Dive",
        cost: 1,
        prerequisites: ["quicker_wings"],
        excludes: ["rapid_wingbeats"],
        leaning: "aggression",
        // Commits fully to one reckless dive.
        delta: { power: 15, cooldownTicks: 1, recoilFraction: 0.05 },
      },
      killing_stoop: {
        id: "killing_stoop",
        name: "Killing Stoop",
        cost: 2,
        prerequisitesAnyOf: [["rapid_wingbeats"], ["full_talon_dive"]],
        leaning: "aggression",
        // A landed crit means the wings never actually slow down.
        delta: { power: 10, critCooldownReset: true },
      },
      diving_momentum: {
        id: "diving_momentum",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["killing_stoop"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      final_stoop: {
        id: "final_stoop",
        name: "Final Stoop",
        cost: 2,
        prerequisites: ["diving_momentum"],
        leaning: "aggression",
        // Fixes a real self-inflicted contradiction: this branch is one
        // bird, one committed dive, all the way down (full_talon_dive,
        // killing_stoop) — the old capstone widened it into a flock-sized
        // AoE cone, undoing everything the branch just built. This one
        // stays single-target and finishes what the stoop started: a real
        // predator's kill shot against something already reeling.
        delta: { power: 10, situationalBonus: { condition: "targetLowHp", multiplier: 1.5 } },
      },
      // Crosslink: Aggression <-> Boldness — rides the same current that
      // keeps it airborne straight into range before the target can react.
      riding_the_gust: {
        id: "riding_the_gust",
        name: "Riding the Gust",
        cost: 1,
        prerequisites: ["diving_strike", "evasive_flight"],
        leaning: "aggression",
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" } },
      },
      gathering_updraft: {
        id: "gathering_updraft",
        name: "Gathering Updraft",
        cost: 1,
        prerequisites: ["riding_the_gust"],
        leaning: "aggression",
        // Deepens Riding the Gust's own approach lunge — a longer run-up.
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 2, timing: "beforeHit" } },
      },
      stooping_dive: {
        id: "stooping_dive",
        name: "Stooping Dive",
        cost: 2,
        prerequisites: ["gathering_updraft"],
        leaning: "boldness",
        // All that gathered speed lands as a sharper strike, not just a
        // longer approach.
        delta: { power: 10, critRateStage: 1 },
      },
      // --- Boldness: "Wind Rider" — a bird doesn't tank a hit, it's just
      // not there when the hit arrives. Air superiority, not raw bulk.
      evasive_flight: {
        id: "evasive_flight",
        name: "Evasive Flight",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1.25 },
        delta: {},
      },
      riding_thermals: {
        id: "riding_thermals",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["evasive_flight"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      banking_turn: {
        id: "banking_turn",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["riding_thermals"], ["riding_the_gust"], ["screening_dive"]],
        leaning: "boldness",
        delta: { power: 5 },
      },
      wind_shear: {
        id: "wind_shear",
        name: "Wind Shear",
        cost: 1,
        prerequisites: ["banking_turn"],
        leaning: "boldness",
        // Strikes, then peels straight back out of range — hit and run,
        // for real.
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 1, timing: "onHit" } },
      },
      steadier_wings: {
        id: "steadier_wings",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["wind_shear"], ["stooping_dive"], ["wingmate_shield"]],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      tailwind_recovery: {
        id: "tailwind_recovery",
        name: "Tailwind Recovery",
        cost: 1,
        prerequisites: ["steadier_wings"],
        excludes: ["storm_wings"],
        leaning: "boldness",
        grantsPassive: { kind: "regenFlat", value: 2.25 },
        delta: {},
      },
      storm_wings: {
        id: "storm_wings",
        name: "Storm Wings",
        cost: 1,
        prerequisites: ["steadier_wings"],
        excludes: ["tailwind_recovery"],
        leaning: "boldness",
        // A literal read of its own name instead of another flat
        // damage-reduction stand-in — this branch's whole point is air
        // superiority, not raw bulk, and flat mitigation IS raw bulk.
        // Real turbulence to fly through, not around.
        delta: { situationalBonus: { condition: "storm", multiplier: 1.4 }, accuracy: -5 },
      },
      sky_dominance: {
        id: "sky_dominance",
        name: "Sky Dominance",
        cost: 2,
        prerequisitesAnyOf: [["tailwind_recovery"], ["storm_wings"]],
        leaning: "boldness",
        delta: { accuracy: 10 },
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
      },
      surer_wings: {
        id: "surer_wings",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["sky_dominance"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      wind_dancer: {
        id: "wind_dancer",
        name: "Wind Dancer",
        cost: 2,
        prerequisites: ["surer_wings"],
        leaning: "boldness",
        // The wing simply isn't there when the blow lands — once, then it
        // needs a moment before it can pull that off again.
        grantsPassive: { kind: "unshaken", value: 1 },
        delta: {},
      },
      // Crosslink: Boldness <-> Sociability — a real intercept, not another
      // speed buff (the old version was just `warning_cry` with a shorter
      // duration under a different name). "Screening" is a real combat
      // term for interposing between a threat and whoever it's after.
      screening_dive: {
        id: "screening_dive",
        name: "Screening Dive",
        cost: 1,
        prerequisites: ["evasive_flight", "warning_cry"],
        leaning: "sociability",
        delta: { positionSwap: true },
      },
      covering_wing: {
        id: "covering_wing",
        name: "Covering Wing",
        cost: 1,
        prerequisites: ["screening_dive"],
        leaning: "sociability",
        // Deepens Screening Dive's own intercept — carries the threat further
        // past the ally it just swapped with.
        delta: { positionSwapPull: 2 },
      },
      wingmate_shield: {
        id: "wingmate_shield",
        name: "Wingmate Shield",
        cost: 2,
        prerequisites: ["covering_wing"],
        leaning: "boldness",
        // Interposing for real, not just repositioning.
        grantsPassive: { kind: "damageReduction", value: 0.07 },
        delta: {},
      },
      // --- Sociability: "Flock Signal" — a prey bird's real defense isn't
      // toughness, it's the flock: a warning cry, then the whole group
      // converging on whatever's threatening it.
      warning_cry: {
        id: "warning_cry",
        name: "Warning Cry",
        cost: 1,
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "speed", stage: 1, ticks: 20 } } },
      },
      sharper_call: {
        id: "sharper_call",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["warning_cry"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      quicker_call: {
        id: "quicker_call",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["sharper_call"], ["screening_dive"], ["scattering_strike"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      mob_the_threat: {
        id: "mob_the_threat",
        name: "Mob the Threat",
        cost: 1,
        prerequisites: ["quicker_call"],
        leaning: "sociability",
        // The cry doesn't just warn the flock off — it marks exactly what
        // to converge on.
        delta: { rallyCall: { ticks: 15 } },
      },
      louder_call: {
        id: "louder_call",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["mob_the_threat"], ["wingmate_shield"], ["broken_formation"]],
        leaning: "sociability",
        delta: { power: 5 },
      },
      rousing_call: {
        id: "rousing_call",
        name: "Rousing Call",
        cost: 1,
        prerequisites: ["louder_call"],
        excludes: ["calming_call"],
        leaning: "sociability",
        // Trades the speed lean for a real Attack buff instead.
        delta: { allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      calming_call: {
        id: "calming_call",
        name: "Calming Call",
        cost: 1,
        prerequisites: ["louder_call"],
        excludes: ["rousing_call"],
        leaning: "sociability",
        // Once the threat's named out loud, the flock itself settles.
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      united_front: {
        id: "united_front",
        name: "United Front",
        cost: 2,
        prerequisitesAnyOf: [["rousing_call"], ["calming_call"]],
        leaning: "sociability",
        // `rallyCall` is an overwrite, not additive — this replaces Mob the
        // Threat's 15-tick mark with a genuinely longer one, not a stack.
        delta: { rallyCall: { ticks: 25 }, cooldownTicks: -1 },
      },
      steadfast_call: {
        id: "steadfast_call",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["united_front"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      flocks_eye: {
        id: "flocks_eye",
        name: "Flock's Eye",
        cost: 2,
        prerequisites: ["steadfast_call"],
        leaning: "sociability",
        // Collective vigilance, not a flat heal — the flock's real payoff
        // was always the rally/de-escalation ladder (mob_the_threat ->
        // united_front), so the capstone deepens that instead of switching
        // to a generic aura. Distinct from Wind Rider's own unshaken.
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — strikes right as the cry
      // scatters the rest of the flock clear, knocking the target away from
      // wherever it would've followed.
      scattering_strike: {
        id: "scattering_strike",
        name: "Scattering Strike",
        cost: 1,
        prerequisites: ["warning_cry", "diving_strike"],
        leaning: "aggression",
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      harder_scatter: {
        id: "harder_scatter",
        name: "Harder Scatter",
        cost: 1,
        prerequisites: ["scattering_strike"],
        leaning: "aggression",
        // Deepens Scattering Strike's own knockback.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 2, timing: "onHit" } },
      },
      broken_formation: {
        id: "broken_formation",
        name: "Broken Formation",
        cost: 2,
        prerequisites: ["harder_scatter"],
        leaning: "sociability",
        // Knocked out of position AND out of rhythm — the scatter becomes real
        // tempo denial, deepening what the knockback was already doing.
        delta: { jamCooldownTicks: 1 },
      },
    },
  },
  body_slam: {
    id: "body_slam",
    name: "Body Slam",
    shape: { kind: "point" },
    ...moveCanon("BODY_SLAM"),
    cooldownTicks: 6,
    range: { min: 0, max: 1 },
    statusChance: 0.3,
    statusKind: "paralysis",
    // v3 tree (MOVES_DESIGN.md's "start from the fantasy" pass).
    // THE FANTASY: this isn't a strike, it's four hundred pounds of
    // sleeping mass finally deciding to move — no technique, no
    // follow-through, just gravity, timed. What's dangerous about it isn't
    // power, it's inevitability: you don't dodge a landslide, you get out
    // from under it before it starts, and this animal rarely bothers to
    // warn anyone it's about to fall. Snorlax's only real signature move
    // (species.ts) — same single-species freedom Slash's tree used for
    // Scyther, built specifically for this one body, not a generic "heavy
    // hit" template.
    // - Aggression ("Landslide"): stays power-archetype on purpose — more
    //   mass, less restraint, escalating to a real localized collapse. The
    //   full-body weight payoff (`weightScaling`) is earned at the keystone
    //   now, not handed out on the opener — direct feedback that starting
    //   this strong was backwards, moved from Full Weight (now a modest
    //   opening lunge) to Avalanche, where "the giant finally throws its
    //   whole self into it" actually belongs.
    // - Boldness ("Unbudging"): earned tankiness, not a default reach —
    //   nothing on this whole roster fits "doesn't move" better than a
    //   sleeping giant (Snorlax's own curated moveset already primes this
    //   with Defense Curl). Real follow-up feedback that bulk/defense alone
    //   read as bland: the keystone is now a genuine wind-up — a deliberate,
    //   telegraphed commitment (real "intention," not just more armor),
    //   invulnerable while charging, then a huge leap and a devastating hit.
    // - Sociability ("Undisturbed"): direct correction on the first draft —
    //   Snorlax is canonically a solitary animal, not a herd one, so a
    //   branch built entirely on ally-buffing herd support was the wrong
    //   fantasy for this specific body. The real trait (famously placid
    //   despite its size) is now a genuine non-territorial, de-escalating
    //   presence: it never starts a fight over a resource, and anything
    //   nearby — herd or not, rival or not — calms down just being near it.
    tree: {
      // --- Aggression: Landslide (more mass, less restraint) ---
      heavy_step: {
        id: "heavy_step",
        name: "Heavy Step",
        cost: 1,
        leaning: "aggression",
        // The first sign of what's coming — a small, immediate lunge, not
        // yet the full weight of the thing. Deliberately modest: the real
        // weightScaling payoff moved to the keystone (Avalanche) — see this
        // move's own top comment.
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" } },
      },
      numbing_follow_through: {
        id: "numbing_follow_through",
        name: "+10% Paralysis Chance",
        cost: 1,
        prerequisites: ["heavy_step"],
        leaning: "aggression",
        delta: { statusChance: 0.1 },
      },
      mounting_momentum: {
        id: "mounting_momentum",
        name: "+8 Power",
        cost: 1,
        prerequisites: ["numbing_follow_through"],
        leaning: "aggression",
        delta: { power: 8 },
      },
      ground_shaking_landing: {
        id: "ground_shaking_landing",
        name: "Ground-Shaking Landing",
        cost: 1,
        prerequisites: ["mounting_momentum"],
        leaning: "aggression",
        // Not a technique — a body just landing somewhere it wasn't,
        // driving whatever it hit backward with it.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 2, timing: "onHit" } },
      },
      rolling_advance: {
        id: "rolling_advance",
        name: "+8 Power",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Aggression (Braced Commitment's and Provoked
        // Charge's own chains).
        prerequisitesAnyOf: [["ground_shaking_landing"], ["settled_impact"], ["undivided"]],
        leaning: "aggression",
        delta: { power: 8 },
      },
      second_slam: {
        id: "second_slam",
        name: "Second Slam",
        cost: 2,
        prerequisites: ["rolling_advance"],
        excludes: ["rolling_crush"],
        leaning: "aggression",
        // Commits fully — the fall itself costs something now too.
        delta: { power: 15, recoilFraction: 0.08 },
      },
      rolling_crush: {
        id: "rolling_crush",
        name: "Rolling Crush",
        cost: 2,
        prerequisites: ["rolling_advance"],
        excludes: ["second_slam"],
        leaning: "aggression",
        // The weight keeps going after the first impact — a lighter
        // aftershock instead of one committed drop.
        delta: { hits: { min: 2, max: 2 }, power: -12, critRateStage: 1 },
      },
      inevitable: {
        id: "inevitable",
        name: "Inevitable",
        cost: 2,
        prerequisitesAnyOf: [["second_slam"], ["rolling_crush"]],
        leaning: "aggression",
        // Mass doesn't need precision — it just needs enough attempts to
        // eventually find the gap in any guard.
        delta: { defensePenetration: 0.25 },
      },
      crushing_follow_up: {
        id: "crushing_follow_up",
        name: "+8 Power",
        cost: 1,
        prerequisites: ["inevitable"],
        leaning: "aggression",
        delta: { power: 8 },
      },
      avalanche: {
        id: "avalanche",
        name: "Avalanche",
        cost: 2,
        prerequisites: ["crushing_follow_up"],
        leaning: "aggression",
        // The single slam becomes a real localized collapse — everything
        // near the point of impact, not just the one target, gets caught
        // in the landing. Also where the real full-body weight payoff
        // finally lands (moved down from the old Full Weight opener, per
        // direct feedback that it was too strong too early) — by the time
        // this move can end a fight this way, its whole mass moves with it.
        delta: { shape: { kind: "burst", radius: 1 }, hitsArea: true, power: -10, weightScaling: { factor: 0.15 } },
      },
      // --- Boldness: Unbudging (a sleeping mountain that refuses to move) ---
      dead_weight: {
        id: "dead_weight",
        name: "Dead Weight",
        cost: 1,
        leaning: "boldness",
        // Earned, not a default reach — sheer mass makes hits land soft,
        // same exception this doc's own "stop overusing damageReduction"
        // note already carves out for a fiction that actually justifies it.
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: {},
      },
      settled_footing: {
        id: "settled_footing",
        name: "+8 Accuracy",
        cost: 1,
        prerequisites: ["dead_weight"],
        leaning: "boldness",
        delta: { accuracy: 8 },
      },
      patient_reset: {
        id: "patient_reset",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["settled_footing"],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      unbudging: {
        id: "unbudging",
        name: "Unbudging",
        cost: 1,
        prerequisites: ["patient_reset"],
        leaning: "boldness",
        // Nothing on this whole roster embodies "can't be dragged, knocked
        // back, or lunged at" better than a sleeping giant that simply
        // doesn't move.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      bracing_follow_through: {
        id: "bracing_follow_through",
        name: "+5 Power",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Boldness (Braced Commitment's and Called to Stand's
        // own chains).
        prerequisitesAnyOf: [["unbudging"], ["settled_impact"], ["undivided_stand"]],
        leaning: "boldness",
        delta: { power: 5 },
      },
      sink_in: {
        id: "sink_in",
        name: "Sink In",
        cost: 2,
        prerequisites: ["bracing_follow_through"],
        excludes: ["full_bulk"],
        leaning: "boldness",
        // The longer it just sits there, the more it recovers — laziness
        // as sustain.
        grantsPassive: { kind: "regen", value: 0.025 },
        delta: { power: -5 },
      },
      full_bulk: {
        id: "full_bulk",
        name: "Full Bulk",
        cost: 2,
        prerequisites: ["bracing_follow_through"],
        excludes: ["sink_in"],
        leaning: "boldness",
        // An even heavier stance — harder to line up, nearly impossible to
        // hurt once it lands.
        grantsPassive: { kind: "damageReduction", value: 0.06 },
        delta: { accuracy: -8 },
      },
      weathered_giant: {
        id: "weathered_giant",
        name: "Weathered Giant",
        cost: 2,
        prerequisitesAnyOf: [["sink_in"], ["full_bulk"]],
        leaning: "boldness",
        // A second, distinct armor lever, earned by a branch whose entire
        // identity is refusing to budge — no need to apologize for it the
        // way a generic tankiness reach would.
        grantsPassive: { kind: "defenseBoost", value: 0.05 },
        delta: {},
      },
      settled_power: {
        id: "settled_power",
        name: "+8 Power",
        cost: 1,
        prerequisites: ["weathered_giant"],
        leaning: "boldness",
        delta: { power: 8 },
      },
      the_reckoning: {
        id: "the_reckoning",
        name: "The Reckoning",
        cost: 2,
        prerequisites: ["settled_power"],
        leaning: "boldness",
        // Direct feedback: bulk and defense alone read as bland — this
        // branch needed real "intention," not just more armor. A deliberate,
        // telegraphed commitment: the giant rears back and gathers itself
        // (`chargeAttack`'s own mid-commit wind-up — see its doc comment,
        // moves.ts), genuinely invulnerable the whole time it's winding up,
        // then closes a huge distance in one leap and lands a devastating
        // blow. A real risk, not a guaranteed payoff — if the target's gone
        // by the time it releases, the whole commitment fizzles for
        // nothing, same "commit hard, pay a real cost" shape as every other
        // keystone-tier tradeoff on this whole roster.
        delta: { chargeAttack: { ticks: 2, bonusPower: 40, leapTiles: 5 } },
      },
      // --- Sociability: Undisturbed (a solitary, non-territorial presence,
      // not a herd defender — Snorlax is canonically a loner, direct
      // correction on the first draft of this branch: "Snorlax tends not to
      // be in a herd. Very solo style... maybe Snorlax is more peaceful and
      // gets along with others easier." Real mechanics for it, not a flat
      // ally buff: it never picks a fight over a resource
      // (`"nonTerritorial"`), it doesn't even flinch the first time
      // something actually lands a hit (`"unshaken"`), and anything nearby
      // — herd or not, rival or not — calms down just being near it
      // (`"calmingPresence"`, herdConflict.ts). See all three `PassiveKind`s'
      // own doc comments, types.ts. ---
      unbothered: {
        id: "unbothered",
        name: "Unbothered",
        cost: 1,
        leaning: "sociability",
        // Direct follow-up: "Unbothered should be, takes no damage from
        // first hit in a fight?" Fair — `"nonTerritorial"` (this node's
        // first draft) only ever mattered for wild-agent resource disputes,
        // a dead pick the moment this move actually sees real combat.
        // `"unshaken"` fixes that: the literal read of the node's own name,
        // and useful in every fight, not just a wild-AI resource squabble.
        grantsPassive: { kind: "unshaken", value: 1 },
        delta: {},
      },
      settled_ease: {
        id: "settled_ease",
        name: "Not Worth It",
        cost: 1,
        prerequisites: ["unbothered"],
        leaning: "sociability",
        // `"nonTerritorial"` moved down from the old opener — still real,
        // still earns its point (a wild Snorlax genuinely never starts a
        // resource fight), just no longer squatting on the branch's one
        // guaranteed-useful-in-combat slot.
        grantsPassive: { kind: "nonTerritorial", value: 1 },
        delta: {},
      },
      unhurried_reset: {
        id: "unhurried_reset",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["settled_ease"],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      no_quarrel: {
        id: "no_quarrel",
        name: "No Quarrel",
        cost: 1,
        prerequisites: ["unhurried_reset"],
        leaning: "sociability",
        // Real, immediate de-escalation — not herd-scoped like this sim's
        // other aura passives: whoever's nearby, herd-mate or rival alike,
        // finds less reason to start something too. A real notable-tier
        // number, not the branch's own biggest one — direct feedback that
        // this was reading as the true capstone, crowding out the actual
        // keystone below.
        grantsPassive: { kind: "calmingPresence", value: 0.3 },
        delta: {},
      },
      quiet_ground: {
        id: "quiet_ground",
        name: "+5 Power",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Sociability (Nothing to Prove's and Provoked
        // Charge's own chains).
        prerequisitesAnyOf: [["no_quarrel"], ["undivided_stand"], ["undivided"]],
        leaning: "sociability",
        delta: { power: 5 },
      },
      wide_berth: {
        id: "wide_berth",
        name: "Wide Berth",
        cost: 2,
        prerequisites: ["quiet_ground"],
        excludes: ["steady_nerve"],
        leaning: "sociability",
        // Deepens No Quarrel's own lever directly — the peace it keeps
        // reaches further out.
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      steady_nerve: {
        id: "steady_nerve",
        name: "Steady Nerve",
        cost: 2,
        prerequisites: ["quiet_ground"],
        excludes: ["wide_berth"],
        leaning: "sociability",
        // Content and undisturbed, it simply isn't worn down the way
        // something always looking over its shoulder would be.
        grantsPassive: { kind: "regen", value: 0.025 },
        delta: {},
      },
      left_in_peace: {
        id: "left_in_peace",
        name: "Undisturbed",
        cost: 2,
        prerequisitesAnyOf: [["wide_berth"], ["steady_nerve"]],
        leaning: "sociability",
        // It doesn't go looking for trouble, but whatever finds it anyway
        // doesn't enjoy the experience — real self-defense without ever
        // being the one who started it. Direct feedback moved this node's
        // own name down from the keystone: a solid notable-tier effect on
        // its own, just not the branch's biggest moment.
        grantsPassive: { kind: "thorns", value: 0.08 },
        delta: {},
      },
      unbroken_calm: {
        id: "unbroken_calm",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["left_in_peace"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      undisturbed: {
        id: "undisturbed",
        name: "At Peace",
        cost: 2,
        prerequisites: ["unbroken_calm"],
        leaning: "sociability",
        // The branch's real "final form" — direct feedback that the old
        // version of this keystone (a modest top-up on levers already
        // granted earlier) read smaller than No Quarrel's own big jump
        // mid-branch, backwards for a capstone. Real escalation instead: a
        // decisive calmingPresence jump — bigger than every earlier grant
        // on this branch combined — paired with a genuinely new lever for
        // this branch (`defenseBoost`, not reused from anywhere else in
        // Sociability): the whole area finally settles around it, and
        // anything that still tries can't even make a dent (same "two
        // passives, one keystone" shape as Scratch's Colony Warmth).
        grantsPassives: [
          { kind: "calmingPresence", value: 0.5 },
          { kind: "defenseBoost", value: 0.08 },
        ],
        delta: {},
      },
      // Crosslink: Aggression <-> Boldness — bracing first is what lets the
      // giant commit its full weight without losing its footing.
      braced_commitment: {
        id: "braced_commitment",
        name: "Braced Commitment",
        cost: 1,
        prerequisites: ["heavy_step", "dead_weight"],
        leaning: "boldness",
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 10 } },
      },
      // Bridge tail (see MOVES_DESIGN.md's "Crosslinks as bridges"): extends
      // Braced Commitment into Aggression's and Boldness's own pre-fork
      // nodes (Rolling Advance / Bracing Follow-Through).
      deepening_brace: {
        id: "deepening_brace",
        name: "Deepening Brace",
        cost: 1,
        prerequisites: ["braced_commitment"],
        leaning: "boldness",
        // Deepens Braced Commitment's own lever directly (overwrite, like
        // every other statChangeOnHit) instead of a generic accuracy
        // bolt-on.
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 2, ticks: 14 } },
      },
      settled_impact: {
        id: "settled_impact",
        name: "Settled Impact",
        cost: 2,
        prerequisites: ["deepening_brace"],
        leaning: "boldness",
        // Bracing before committing the full weight means none of that
        // force gets wasted on its own wobble.
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 3, ticks: 18 }, defensePenetration: 0.15 },
      },
      // Crosslink: Boldness <-> Sociability — redesigned alongside
      // Sociability's own rebuild (the old version leaned on a herd-mark
      // primitive this branch no longer has any use for). New fantasy: an
      // immovable thing that also isn't looking for a fight is the ultimate
      // "just go around it" — nothing here is worth anyone's trouble.
      called_to_stand: {
        id: "called_to_stand",
        name: "Nothing to Prove",
        cost: 1,
        prerequisites: ["dead_weight", "unbothered"],
        leaning: "boldness",
        grantsPassive: { kind: "calmingPresence", value: 0.15 },
        delta: {},
      },
      // Bridge tail: extends Nothing to Prove into Boldness's and
      // Sociability's own pre-fork nodes (Bracing Follow-Through / Quiet
      // Ground).
      steadfast_focus: {
        id: "steadfast_focus",
        name: "Widening Calm",
        cost: 1,
        prerequisites: ["called_to_stand"],
        leaning: "boldness",
        // Deepens Nothing to Prove's own lever directly, instead of a
        // generic power bolt-on.
        grantsPassive: { kind: "calmingPresence", value: 0.15 },
        delta: {},
      },
      undivided_stand: {
        id: "undivided_stand",
        name: "Beneath Notice",
        cost: 2,
        prerequisites: ["steadfast_focus"],
        leaning: "sociability",
        // By now, nothing sane bothers starting something with it at all.
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — an animal this placid
      // doesn't pull the hit once actually roused; the restraint was the
      // only thing holding the full weight back.
      provoked_charge: {
        id: "provoked_charge",
        name: "Provoked Charge",
        cost: 1,
        prerequisites: ["unbothered", "heavy_step"],
        leaning: "aggression",
        // A real wind-up cost, paired with the benefit it buys — a beat of
        // hesitation before something this placid actually commits.
        delta: { lockTicks: 1, power: 10 },
      },
      // Bridge tail: extends Provoked Charge into Sociability's and
      // Aggression's own pre-fork nodes (Quiet Ground / Rolling Advance).
      full_commitment: {
        id: "full_commitment",
        name: "Full Commitment",
        cost: 1,
        prerequisites: ["provoked_charge"],
        leaning: "aggression",
        // Deepens the payoff side of the same tradeoff rather than adding
        // more wind-up — the cost stays fixed, the reward keeps growing.
        delta: { power: 10 },
      },
      undivided: {
        id: "undivided",
        name: "Undivided",
        cost: 2,
        prerequisites: ["full_commitment"],
        leaning: "aggression",
        // Once it's fully provoked, there's no half-measure left in it at
        // all — it spends its own vitality as readily as the target's.
        delta: { power: 15, lifestealFraction: 0.05 },
      },
    },
  },
  dig: {
    id: "dig",
    name: "Dig",
    shape: { kind: "point" },
    ...moveCanon("DIG"),
    // Never actually used offensively — pickBestMove (combat.ts) excludes
    // any move with `burrow` set from hostile move selection, same as
    // targetsAlly moves. cooldownTicks/range are set anyway for MoveSpec's
    // sake, not because either is ever read for this move's real use.
    cooldownTicks: 15,
    range: { min: 0, max: 1 },
    // A fleeing Diglett/Sandshrew burrows instead of taking a normal flee
    // step — applyPredationInstincts' main flee branch (predation.ts). 20
    // ticks of real safety (see Agent.burrowedTicksRemaining's own doc
    // comment for what that actually protects against), balanced by a real
    // cooldown — unlike an ordinary flee step, which costs nothing and can
    // be repeated every tick, this can't be spammed.
    burrow: { ticks: 20 },
    // v2 (MOVES_DESIGN.md's own template), but honestly scoped smaller than
    // Vine Whip/Wing Attack/Rock Slide above — Dig is genuinely never
    // resolved as a hit (see the comment above), so power/accuracy/
    // defensePenetration/forcedMovement/lifesteal/every damage-facing lever
    // this template usually leans on are all dead weight here; there's
    // nothing for them to modify. The only two real levers left are
    // `cooldownTicks` (this move's own real cooldown, genuinely gating how
    // often Diglett/Sandshrew can burrow-flee) and `grantsPassive`/
    // `grantsPassives` (agent-level, real regardless of how the move is
    // used). Every node below is one or the other — no padded "+5 Power"
    // filler pretending this move deals damage. Shared by Diglett AND
    // Sandshrew (species.ts's own comment: they coexist underground, a
    // real cross-species breeding pair) — Sociability leans directly into
    // that literal, already-written flavor.
    tree: {
      // --- Aggression: "Quick Vanish" — gone before anything can react,
      // burrowing so often the cooldown itself is the whole build.
      quick_reflexes: {
        id: "quick_reflexes",
        name: "Quick Reflexes",
        cost: 1,
        leaning: "aggression",
        // Already tensed to bolt underground the instant something lands —
        // the first hit against it does nothing at all.
        grantsPassive: { kind: "unshaken", value: 1 },
        delta: {},
      },
      shallow_dive: {
        id: "shallow_dive",
        name: "-2 Cooldown",
        cost: 2,
        prerequisitesAnyOf: [["quick_reflexes"], ["braced_dive"], ["quick_warning"]],
        leaning: "aggression",
        // Consolidated from two separate "-1 Cooldown" nodes into one —
        // this branch's honestly-narrow lever set (only cooldownTicks and
        // passives are real for a move that's never resolved as a hit)
        // doesn't need the padding of splitting the same lever twice just
        // to hit a node count.
        delta: { cooldownTicks: -1 },
      },
      never_still: {
        id: "never_still",
        name: "Never Still",
        cost: 1,
        prerequisitesAnyOf: [["shallow_dive"], ["unflinching_burrow"], ["first_to_ground"]],
        leaning: "aggression",
        // This branch's real "notable" is tempo, not power — there's
        // nothing else honest to give it.
        delta: { cooldownTicks: -2 },
      },
      instant_vanish: {
        id: "instant_vanish",
        name: "Instant Vanish",
        cost: 1,
        prerequisites: ["never_still"],
        excludes: ["false_surface"],
        leaning: "aggression",
        // Recovers fast between dives instead of biting on the way past.
        grantsPassive: { kind: "regenFlat", value: 2.25 },
        delta: {},
      },
      false_surface: {
        id: "false_surface",
        name: "False Surface",
        cost: 1,
        prerequisites: ["never_still"],
        excludes: ["instant_vanish"],
        leaning: "aggression",
        // Surfaces just long enough to bite before vanishing again.
        grantsPassive: { kind: "thorns", value: 0.1 },
        delta: {},
      },
      deepening_instincts: {
        id: "deepening_instincts",
        name: "Deepening Instincts",
        cost: 2,
        prerequisitesAnyOf: [["instant_vanish"], ["false_surface"]],
        leaning: "aggression",
        // Honest rename — the old "Gone Before It Lands" promised a
        // dodge/timing effect this tree's real lever set (cooldownTicks +
        // passives only, since Dig is never resolved as a hit) can't
        // actually deliver.
        grantsPassive: { kind: "damageReduction", value: 0.12 },
        delta: { cooldownTicks: -1 },
      },
      // Crosslink: Aggression <-> Boldness — braces for real before every
      // dive, Boldness's own sturdiness feeding Aggression's speed.
      braced_dive: {
        id: "braced_dive",
        name: "Braced Dive",
        cost: 1,
        prerequisites: ["quick_reflexes", "sturdy_return"],
        leaning: "aggression",
        grantsPassive: { kind: "damageReductionFlat", value: 0.75 },
        delta: {},
      },
      hardened_dive: {
        id: "hardened_dive",
        name: "Hardened Dive",
        cost: 1,
        prerequisites: ["braced_dive"],
        leaning: "boldness",
        // Deepens Braced Dive's own mitigation.
        grantsPassive: { kind: "damageReductionFlat", value: 0.75 },
        delta: {},
      },
      unflinching_burrow: {
        id: "unflinching_burrow",
        name: "Unflinching Burrow",
        cost: 2,
        prerequisites: ["hardened_dive"],
        leaning: "aggression",
        // Takes the hit mid-dive and keeps going.
        grantsPassives: [
          { kind: "damageReduction", value: 0.05 },
          { kind: "defenseBoost", value: 0.04 },
        ],
        delta: {},
      },
      // --- Boldness: "Iron Burrow" — toughens up between dives instead of
      // just vanishing faster.
      sturdy_return: {
        id: "sturdy_return",
        name: "Sturdy Return",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: {},
      },
      thicker_hide: {
        id: "thicker_hide",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["sturdy_return"],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      packed_earth: {
        id: "packed_earth",
        name: "Packed Earth",
        cost: 1,
        prerequisitesAnyOf: [["thicker_hide"], ["braced_dive"], ["shared_shelter"]],
        leaning: "boldness",
        // Hard-packed ground is no obstacle to a digger that's built for
        // it — another real `gatherBurst`, and another duplicate
        // "-1 Cooldown" filler retired (this branch had two identical
        // ones under names that both promised something else).
        delta: { gatherBurst: 3 },
      },
      bedrock_grip: {
        id: "bedrock_grip",
        name: "Bedrock Grip",
        cost: 1,
        prerequisitesAnyOf: [["packed_earth"], ["unflinching_burrow"], ["communal_warren"]],
        grantsPassive: { kind: "defenseBoost", value: 0.05 },
        leaning: "boldness",
        delta: {},
      },
      weathered_scales: {
        id: "weathered_scales",
        name: "Weathered Scales",
        cost: 1,
        prerequisites: ["bedrock_grip"],
        excludes: ["stone_hide"],
        leaning: "boldness",
        grantsPassive: { kind: "regenFlat", value: 3 },
        delta: {},
      },
      stone_hide: {
        id: "stone_hide",
        name: "Stone Hide",
        cost: 1,
        prerequisites: ["bedrock_grip"],
        excludes: ["weathered_scales"],
        leaning: "boldness",
        // Stacks with Sturdy Return's own damageReduction for a real,
        // cumulative toughness.
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: {},
      },
      unshakable_ground: {
        id: "unshakable_ground",
        name: "Unshakable Ground",
        cost: 2,
        prerequisitesAnyOf: [["weathered_scales"], ["stone_hide"]],
        leaning: "boldness",
        grantsPassives: [
          { kind: "defenseBoost", value: 0.05 },
          { kind: "damageReduction", value: 0.12 },
        ],
        delta: {},
      },
      // Crosslink: Boldness <-> Sociability — a sturdy den shared with
      // whoever else is burrowed nearby.
      shared_shelter: {
        id: "shared_shelter",
        name: "Shared Shelter",
        cost: 1,
        prerequisites: ["sturdy_return", "peaceful_tunnels"],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.1 },
        delta: {},
      },
      wider_shelter: {
        id: "wider_shelter",
        name: "Wider Shelter",
        cost: 1,
        prerequisites: ["shared_shelter"],
        leaning: "sociability",
        // Deepens Shared Shelter's own calming reach.
        grantsPassive: { kind: "calmingPresence", value: 0.1 },
        delta: {},
      },
      communal_warren: {
        id: "communal_warren",
        name: "Communal Warren",
        cost: 2,
        prerequisites: ["wider_shelter"],
        leaning: "boldness",
        // A warren dug together is dug faster — the shelter fantasy finally
        // paying into this move's own gathering identity, not just another aura.
        grantsPassive: { kind: "calmingPresence", value: 0.1 },
        delta: { gatherBurst: 3 },
      },
      // --- Sociability: "Shared Ground" — Diglett and Sandshrew genuinely
      // coexist underground (species.ts's own note); this branch is that,
      // mechanically.
      peaceful_tunnels: {
        id: "peaceful_tunnels",
        name: "Peaceful Tunnels",
        cost: 1,
        leaning: "sociability",
        grantsPassive: { kind: "nonTerritorial", value: 1 },
        delta: {},
      },
      wider_burrow: {
        id: "wider_burrow",
        name: "Wider Burrow",
        cost: 1,
        prerequisites: ["peaceful_tunnels"],
        leaning: "sociability",
        // Direct correction, and the hook this whole tree was missing:
        // "dig was supposed to make digging springs and food easier."
        // It already did a little — needs.ts hands any off-cooldown
        // `burrow` move a real `DIG_MOVE_BURST_TICKS` head start on
        // uncovering an underground crop or digging a brand-new spring —
        // but nothing in the tree could ever make that better. `gatherBurst`
        // does, and it's the first lever on this tree that's about what Dig
        // is actually FOR rather than how fast it recharges. Also clears a
        // flagged name/mechanic mismatch: "Wider Burrow" used to grant a
        // cooldown reduction.
        delta: { gatherBurst: 3 },
      },
      quiet_ground: {
        id: "quiet_ground",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["wider_burrow"], ["shared_shelter"], ["quick_warning"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      settling_earth: {
        id: "settling_earth",
        name: "Settling Earth",
        cost: 1,
        prerequisitesAnyOf: [["quiet_ground"], ["communal_warren"], ["first_to_ground"]],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      deeper_calm: {
        id: "deeper_calm",
        name: "Deeper Calm",
        cost: 1,
        prerequisites: ["settling_earth"],
        excludes: ["watchful_rest"],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.15 },
        delta: {},
      },
      watchful_rest: {
        id: "watchful_rest",
        name: "Watchful Rest",
        cost: 1,
        prerequisites: ["settling_earth"],
        excludes: ["deeper_calm"],
        leaning: "sociability",
        grantsPassive: { kind: "regenFlat", value: 2.25 },
        delta: {},
      },
      denning_together: {
        id: "denning_together",
        name: "Denning Together",
        cost: 2,
        prerequisitesAnyOf: [["deeper_calm"], ["watchful_rest"]],
        leaning: "sociability",
        // A shared den means real rest for everyone in it, not just a
        // trickle of healing.
        grantsPassives: [
          { kind: "healAura", value: 0.01 },
          { kind: "regen", value: 0.04 },
        ],
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — even the quick-vanishing
      // ones know the tunnels are shared ground.
      quick_warning: {
        id: "quick_warning",
        name: "Quick Warning",
        cost: 1,
        prerequisites: ["peaceful_tunnels", "quick_reflexes"],
        leaning: "sociability",
        grantsPassive: { kind: "regenFlat", value: 1.5 },
        delta: { cooldownTicks: -1 },
      },
      sharper_warning: {
        id: "sharper_warning",
        name: "Sharper Warning",
        cost: 1,
        prerequisites: ["quick_warning"],
        leaning: "sociability",
        // Deepens Quick Warning's own tempo lever.
        delta: { cooldownTicks: -1 },
      },
      first_to_ground: {
        id: "first_to_ground",
        name: "First to Ground",
        cost: 2,
        prerequisites: ["sharper_warning"],
        leaning: "aggression",
        // Underground before anything else has reacted, and recovering while
        // it waits.
        grantsPassive: { kind: "regen", value: 0.025 },
        delta: { cooldownTicks: -2 },
      },
    },
  },

  // --- Environmental/utility moves below. Direct ask: "moves that affect
  // the environment... [pull in] moves that all these Pokémon already
  // learn over time." Every one of these is a REAL move already in the
  // curated roster's own canonical dex movepool (checked directly against
  // dex/species.generated.ts's levelMoves — not invented), and every one is
  // a genuine mainline status move (power 0), the reason none of them could
  // use `moveCanon` — see `statusMoveCanon` above. All flagged
  // `utilityMove: true`, resolved by the engine's new `utilityMoves.ts` on
  // an agent's own idle tick (see that file's own doc comment for why this
  // needed a third trigger path alongside the hostile/ally-support ones).
  growth: {
    id: "growth",
    name: "Growth",
    shape: { kind: "point" },
    ...statusMoveCanon("GROWTH"),
    cooldownTicks: 30,
    utilityMove: true,
    // Real canonical move (bulbasaur/ivysaur/venusaur, oddish/gloom all
    // learn it) — directly enriches the ground the caster stands on
    // (flora.ts's real fertility mechanic), rather than Bulb Seed's own
    // Round 3 in-house description tying it to seedling maturation. Own
    // tile only (radius 0) — Grassy Terrain below is the wider version.
    fertilityBoost: { amount: 0.3, radius: 0 },
  },
  grassy_terrain: {
    id: "grassy_terrain",
    name: "Grassy Terrain",
    shape: { kind: "point" },
    ...statusMoveCanon("GRASSY_TERRAIN"),
    cooldownTicks: 60,
    utilityMove: true,
    // Oddish/Gloom's own real canonical move — the AoE sibling to Growth
    // above, a smaller per-tile boost spread over real ground around the
    // caster instead of a bigger one on just its own tile.
    fertilityBoost: { amount: 0.15, radius: 2 },
  },
  synthesis: {
    id: "synthesis",
    name: "Synthesis",
    shape: { kind: "point" },
    ...statusMoveCanon("SYNTHESIS"),
    cooldownTicks: 40,
    utilityMove: true,
    // Real canonical move (bulbasaur/ivysaur/venusaur) — mainline heals more
    // in harsh sunlight; reused here as a flat self-heal with a real bonus
    // near a "sunbeam" tile (flora.ts's own terrain-scaled-healing idiom,
    // already driving germination odds, reused for HP instead).
    selfHeal: { fraction: 0.15, sunbeamBonus: 0.15 },
  },
  moonlight: {
    id: "moonlight",
    name: "Moonlight",
    shape: { kind: "point" },
    ...statusMoveCanon("MOONLIGHT"),
    cooldownTicks: 40,
    utilityMove: true,
    // Oddish/Gloom's own real canonical move — Synthesis's mechanical
    // twin under a different mainline name/type, same reasoning.
    selfHeal: { fraction: 0.15, sunbeamBonus: 0.15 },
  },
  roost: {
    id: "roost",
    name: "Roost",
    shape: { kind: "point" },
    ...statusMoveCanon("ROOST"),
    cooldownTicks: 30,
    utilityMove: true,
    // Real canonical move (pidgey/spearow) — a flat, reliable self-heal, no
    // terrain scaling (mainline Roost isn't weather/terrain-conditional,
    // unlike Synthesis/Moonlight above).
    selfHeal: { fraction: 0.25 },
  },
  agility: {
    id: "agility",
    name: "Agility",
    shape: { kind: "point" },
    ...statusMoveCanon("AGILITY"),
    cooldownTicks: 50,
    utilityMove: true,
    // Real canonical move for a big chunk of the roster (scyther, pidgey,
    // spearow, sandshrew, dratini, growlithe, ponyta, rapidash, beedrill).
    // Reuses `MoveSpec.statChangeOnHit`'s existing self-buff field — the
    // same primitive a landed hit's self-side effect already uses — just
    // applied from the idle path instead. The base "speed" stat already
    // drove the real action economy (`actionSpeedOf`'s whole job); what's
    // new is `actionSpeedOf` also folding in a temporary Speed STAGE
    // (`simulation.ts`'s `statStageMultiplier(getStatStage(agent,
    // "speed"))`) — `calculateDamage` already read a stage for Attack/
    // Defense, but nothing read one for Speed before this, so this move
    // actually makes its caster act more often for a while, not just a
    // cosmetic number.
    statChangeOnHit: { target: "self", stat: "speed", stage: 2, ticks: 40 },
  },
  harden: {
    id: "harden",
    name: "Harden",
    shape: { kind: "point" },
    ...statusMoveCanon("HARDEN"),
    cooldownTicks: 40,
    utilityMove: true,
    // Real canonical move (metapod, kakuna, krabby, kingler, shellder) —
    // mainline's flat +1 Defense, same self-buff primitive as Agility.
    statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 50 },
  },
  withdraw: {
    id: "withdraw",
    name: "Withdraw",
    shape: { kind: "point" },
    ...statusMoveCanon("WITHDRAW"),
    cooldownTicks: 40,
    utilityMove: true,
    // Real canonical move (squirtle/wartortle/blastoise, shellder) —
    // mainline's own +1 Defense, mechanically identical to Harden above
    // under a Water-flavored name, same as the real games.
    statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 50 },
  },
  defense_curl: {
    id: "defense_curl",
    name: "Defense Curl",
    shape: { kind: "point" },
    ...statusMoveCanon("DEFENSE_CURL"),
    cooldownTicks: 40,
    utilityMove: true,
    // Real canonical move (sandshrew, geodude, snorlax) — same +1 Defense
    // family as Harden/Withdraw above.
    statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 50 },
  },
  safeguard: {
    id: "safeguard",
    name: "Safeguard",
    shape: { kind: "point" },
    ...statusMoveCanon("SAFEGUARD"),
    cooldownTicks: 80,
    utilityMove: true,
    // Real canonical move (seel, dratini, vulpix, butterfree, lapras) —
    // mainline blocks status conditions for the caster's whole side; here,
    // the caster plus every living same-herd ally within radius get a real
    // window of new-status immunity (Agent.statusImmuneTicksRemaining).
    statusImmunityAura: { ticks: 60, radius: 4 },
  },
  rain_dance: {
    id: "rain_dance",
    name: "Rain Dance",
    shape: { kind: "point" },
    ...statusMoveCanon("RAIN_DANCE"),
    // Long cooldown on purpose — this is a real, rare weather-triggering
    // event (weather.ts's own rain mechanics: flora decay slows, thirst
    // decays slower, dry ground near water can convert to real puddles),
    // not an ambient buff to spam.
    cooldownTicks: 150,
    utilityMove: true,
    // Real canonical move (squirtle line, gyarados, dratini, lapras) —
    // spawns (or refreshes) a genuine rain WeatherCell centered on the
    // caster, reusing weather.ts's own cell shape/lifecycle rather than a
    // second invented weather concept.
    spawnsRain: true,
  },
  sweet_scent: {
    id: "sweet_scent",
    name: "Sweet Scent",
    shape: { kind: "point" },
    ...statusMoveCanon("SWEET_SCENT"),
    cooldownTicks: 100,
    utilityMove: true,
    // Real canonical move (bulbasaur/ivysaur/venusaur, oddish/gloom) —
    // mainline lures wild Pokémon/lowers evasion; reused here as "more
    // findable as a mate for a while" (reproduction.ts's own mate-search
    // radius, doubled via `MATING_RADIUS_BOOST_MULTIPLIER`).
    matingRadiusBoost: { multiplier: 2, ticks: 60 },
  },
  leech_seed: {
    id: "leech_seed",
    name: "Leech Seed",
    shape: { kind: "point" },
    ...statusMoveCanon("LEECH_SEED"),
    cooldownTicks: 30,
    utilityMove: true,
    // Real canonical move (bulbasaur/ivysaur/venusaur) — mainline drains HP
    // from an opponent every turn; reused here as a one-off hunger transfer
    // from the nearest non-herd agent in range, real resource theft rather
    // than a sustained drain (this sim has no per-turn "planted seed"
    // concept to tick down).
    drainNeeds: { need: "hunger", amount: 0.15, radius: 4 },
    // v2 (MOVES_DESIGN.md's own template), honestly scoped like Dig's tree
    // — Leech Seed is `utilityMove`-flagged, so `pickBestMove` (combat.ts)
    // excludes it from hostile selection same as `burrow` moves: it's never
    // resolved as an actual hit. Every damage-facing lever this template
    // usually leans on is dead weight here too. Built instead from the
    // levers that ARE real: `drainNeeds` itself (need/amount/radius — see
    // the new delta field's own doc comment, moves.ts), `cooldownTicks`,
    // `statChangeOnHit` (self, already real for a `utilityMove` — see
    // `maybeUseUtilityMove`, utilityMoves.ts), and `grantsPassive`. Real
    // fork highlight: Boldness's *Twin Taproot* switches `drainNeeds.need`
    // from `"hunger"` to `"thirst"` entirely — a genuinely different
    // resource, not just a bigger number. Bulbasaur/Ivysaur/Venusaur only.
    tree: {
      // --- Aggression: "Ravenous Roots" — takes more, and the surplus
      // sharpens its own other attacks (a real cross-move Attack stage,
      // not something Leech Seed itself ever swings with).
      ravenous_bite: {
        id: "ravenous_bite",
        name: "Ravenous Bite",
        cost: 1,
        leaning: "aggression",
        delta: { drainNeeds: { need: "hunger", amount: 0.25, radius: 4 } },
      },
      quicker_seeding: {
        id: "quicker_seeding",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["ravenous_bite"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      spreading_roots: {
        id: "spreading_roots",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["quicker_seeding"], ["grounded_hunger"], ["feeding_ground"]],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      wider_reach: {
        id: "wider_reach",
        name: "Wider Reach",
        cost: 1,
        prerequisites: ["spreading_roots"],
        leaning: "aggression",
        // Restates the full drainNeeds object — overwrite, not a merge.
        delta: { drainNeeds: { need: "hunger", amount: 0.35, radius: 5 } },
      },
      hungrier_roots: {
        id: "hungrier_roots",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["wider_reach"], ["ironroot"], ["endless_bounty"]],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      insatiable: {
        id: "insatiable",
        name: "Insatiable",
        cost: 1,
        prerequisites: ["hungrier_roots"],
        excludes: ["sharpened_hunger"],
        leaning: "aggression",
        delta: { drainNeeds: { need: "hunger", amount: 0.5, radius: 5 } },
      },
      sharpened_hunger: {
        id: "sharpened_hunger",
        name: "Sharpened Hunger",
        cost: 1,
        prerequisites: ["hungrier_roots"],
        excludes: ["insatiable"],
        leaning: "aggression",
        // Keeps Wider Reach's drain, but the vigor it takes sharpens this
        // agent's OWN Attack stage — a real, felt boost to whatever it
        // actually fights with, since Leech Seed itself never lands a hit.
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 20 } },
      },
      feeding_frenzy: {
        id: "feeding_frenzy",
        name: "Feeding Frenzy",
        cost: 2,
        prerequisitesAnyOf: [["insatiable"], ["sharpened_hunger"]],
        leaning: "aggression",
        // A real escalation regardless of which fork got here — a bigger,
        // wider theft than either path alone reaches, not a flat passive
        // standing in for "the branch is now finished."
        delta: { drainNeeds: { need: "hunger", amount: 0.6, radius: 6 }, cooldownTicks: -1 },
      },
      // Crosslink: Aggression <-> Boldness — the hunger it takes goes
      // straight into a hardier stalk, not just a bigger haul.
      grounded_hunger: {
        id: "grounded_hunger",
        name: "Grounded Hunger",
        cost: 1,
        prerequisites: ["ravenous_bite", "steady_roots"],
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
        delta: {},
      },
      thickened_stalk: {
        id: "thickened_stalk",
        name: "Thickened Stalk",
        cost: 1,
        prerequisites: ["grounded_hunger"],
        leaning: "boldness",
        // Deepens Grounded Hunger's own defensive lever.
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
        delta: {},
      },
      ironroot: {
        id: "ironroot",
        name: "Ironroot",
        cost: 2,
        prerequisites: ["thickened_stalk"],
        leaning: "aggression",
        // Everything it takes goes into the stalk.
        grantsPassives: [
          { kind: "defenseBoost", value: 0.04 },
          { kind: "damageReduction", value: 0.06 },
        ],
        delta: {},
      },
      // --- Boldness: "Deep Taproot" — a slower, safer, more sustainable
      // draw, not a bigger single theft.
      steady_roots: {
        id: "steady_roots",
        name: "Steady Roots",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "regenFlat", value: 1.5 },
        delta: {},
      },
      thick_bark: {
        id: "thick_bark",
        name: "Thick Bark",
        cost: 1,
        prerequisites: ["steady_roots"],
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        leaning: "boldness",
        delta: {},
      },
      patient_taproot: {
        id: "patient_taproot",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["thick_bark"], ["grounded_hunger"], ["communal_taproot"]],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      resilient_growth: {
        id: "resilient_growth",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["patient_taproot"], ["ironroot"], ["grove_mind"]],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      bountiful_roots: {
        id: "bountiful_roots",
        name: "Bountiful Roots",
        cost: 1,
        prerequisites: ["resilient_growth"],
        excludes: ["twin_taproot"],
        leaning: "boldness",
        // Gentler per-cast, but reaches further and lands more reliably.
        delta: { drainNeeds: { need: "hunger", amount: 0.2, radius: 6 } },
      },
      twin_taproot: {
        id: "twin_taproot",
        name: "Twin Taproot",
        cost: 1,
        prerequisites: ["resilient_growth"],
        excludes: ["bountiful_roots"],
        leaning: "boldness",
        // Draws moisture instead — a genuinely different resource, not
        // just a bigger number on the same one.
        delta: { drainNeeds: { need: "thirst", amount: 0.2, radius: 4 } },
      },
      ancient_roots: {
        id: "ancient_roots",
        name: "Ancient Roots",
        cost: 2,
        prerequisitesAnyOf: [["bountiful_roots"], ["twin_taproot"]],
        leaning: "boldness",
        // Distinct from Sturdy Return/Steady Roots below it, not the same
        // two values re-granted a second time — a genuinely deeper root
        // system, not a bigger number on the same two levers.
        grantsPassives: [
          { kind: "regen", value: 0.04 },
          { kind: "defenseBoost", value: 0.04 },
        ],
        delta: {},
      },
      // Crosslink: Boldness <-> Sociability — a taproot deep enough to
      // share.
      communal_taproot: {
        id: "communal_taproot",
        name: "Communal Taproot",
        cost: 1,
        prerequisites: ["steady_roots", "gentle_roots"],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.1 },
        delta: {},
      },
      spreading_taproot: {
        id: "spreading_taproot",
        name: "Spreading Taproot",
        cost: 1,
        prerequisites: ["communal_taproot"],
        leaning: "sociability",
        // Deepens Communal Taproot's own calming reach.
        grantsPassive: { kind: "calmingPresence", value: 0.1 },
        delta: {},
      },
      grove_mind: {
        id: "grove_mind",
        name: "Grove Mind",
        cost: 2,
        prerequisites: ["spreading_taproot"],
        leaning: "boldness",
        // The shared root system enriches a whole patch of ground, not just
        // the tile underfoot — a real escalation of Feed the Soil's own lever.
        delta: { fertilityBoost: { amount: 0.25, radius: 2 } },
      },
      // --- Sociability: "Shared Harvest" — what the roots take doesn't
      // stay with the caster. Real follow-up on a self-critique: the first
      // draft never actually shared anything it stole, just re-ran Vine
      // Whip's own nurturing template under a different name.
      gentle_roots: {
        id: "gentle_roots",
        name: "Gentle Roots",
        cost: 1,
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.15 },
        delta: {},
      },
      rooted_calm: {
        id: "rooted_calm",
        name: "Rooted Calm",
        cost: 1,
        prerequisites: ["gentle_roots"],
        leaning: "sociability",
        // A real ally-facing effect at last — fires through the separate
        // targetsAlly/allyEffect path (support.ts's applySupportMove),
        // independent of this move's own drainNeeds/utilityMove path. Not
        // literally wired to the stolen resource itself (no mechanism for
        // that yet), but a genuine "pass some of it on" gesture instead of
        // another self-buff.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.1 } },
      },
      feed_the_soil: {
        id: "feed_the_soil",
        name: "Feed the Soil",
        cost: 1,
        prerequisitesAnyOf: [["rooted_calm"], ["communal_taproot"], ["feeding_ground"]],
        leaning: "sociability",
        // SKILL_TREE_GUIDE.md step 2, and the fix for this branch's
        // sharpest self-criticism: "Shared Harvest" never actually shared
        // anything it stole. Now what the roots take goes straight back
        // into the ground the herd grazes (flora.ts's real fertility
        // mechanic, the same one Growth/Grassy Terrain use) — a literal,
        // visible ecosystem payoff instead of another passive aura.
        // Required a real engine fix to work at all: `drainNeeds` used to
        // early-return in `maybeUseUtilityMove`, silently killing every
        // other utility field on the same move. Also replaces one of two
        // identical "-1 Cooldown" fillers this branch was padded with.
        delta: { fertilityBoost: { amount: 0.2, radius: 1 } },
      },
      settled_growth: {
        id: "settled_growth",
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["feed_the_soil"], ["grove_mind"], ["endless_bounty"]],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      deepening_calm: {
        id: "deepening_calm",
        name: "Deepening Calm",
        cost: 1,
        prerequisites: ["settled_growth"],
        excludes: ["watchful_roots"],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.15 },
        delta: {},
      },
      watchful_roots: {
        id: "watchful_roots",
        name: "Watchful Roots",
        cost: 1,
        prerequisites: ["settled_growth"],
        excludes: ["deepening_calm"],
        leaning: "sociability",
        grantsPassive: { kind: "regenFlat", value: 2.25 },
        delta: {},
      },
      roots_that_feed_the_grove: {
        id: "roots_that_feed_the_grove",
        name: "Roots That Feed the Grove",
        cost: 2,
        prerequisitesAnyOf: [["deepening_calm"], ["watchful_roots"]],
        leaning: "sociability",
        // What the roots take, the grove gets back — a slow herd-wide heal
        // paired with the branch's own calm, not a bare aura on its own.
        grantsPassives: [
          { kind: "healAura", value: 0.012 },
          { kind: "calmingPresence", value: 0.1 },
        ],
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — even a shared harvest
      // takes what it needs.
      feeding_ground: {
        id: "feeding_ground",
        name: "Feeding Ground",
        cost: 1,
        prerequisites: ["gentle_roots", "ravenous_bite"],
        leaning: "aggression",
        grantsPassive: { kind: "regenFlat", value: 1.5 },
        delta: { cooldownTicks: -1 },
      },
      richer_ground: {
        id: "richer_ground",
        name: "Richer Ground",
        cost: 1,
        prerequisites: ["feeding_ground"],
        leaning: "aggression",
        // Deepens Feeding Ground's own recovery lever.
        grantsPassive: { kind: "regenFlat", value: 1.5 },
        delta: {},
      },
      endless_bounty: {
        id: "endless_bounty",
        name: "Endless Bounty",
        cost: 2,
        prerequisites: ["richer_ground"],
        leaning: "sociability",
        // Never quite empty, and never waiting long.
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: { cooldownTicks: -1 },
      },
    },
  },
};
