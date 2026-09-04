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
): Pick<MoveSpec, "type" | "category" | "power" | "accuracy"> {
  const entry = MOVE_DEX_BY_KEY[dexKey];
  if (!entry) throw new Error(`moveCanon: no dex entry for key "${dexKey}" (packages/data/src/dex/moves.generated.ts)`);
  if (entry.category === "status") {
    throw new Error(`moveCanon: "${dexKey}" is a status move; MoveSpec only models physical/special attacks (see TODO.md)`);
  }
  return { type: entry.type, category: entry.category, power: entry.power, accuracy: entry.accuracy };
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
    cooldownTicks: 0,
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
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["bracing_impact"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
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
        grantsPassive: { kind: "damageReduction", value: 0.1 },
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
        grantsPassive: { kind: "regen", value: 0.03 },
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
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
        grantsPassive: { kind: "damageReduction", value: 0.08 },
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
    cooldownTicks: 0,
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
      // spots means fewer clean hits land.
      watchful_pack: {
        id: "watchful_pack",
        name: "Watchful Pack",
        cost: 1,
        prerequisites: ["keen_eye", "shared_scent"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
        grantsPassive: { kind: "regen", value: 0.01 },
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
    cooldownTicks: 0,
    range: { min: 0, max: 2 },
  },
  ember: {
    id: "ember",
    name: "Ember",
    shape: { kind: "point" },
    ...moveCanon("EMBER"),
    cooldownTicks: 1,
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
        delta: { statusChance: 0.15, cooldownTicks: -1 },
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
        name: "-1 Cooldown",
        cost: 1,
        prerequisitesAnyOf: [["kindling"], ["smoldering_ring"], ["kindled_fury"]],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
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
        name: "+5% status chance",
        cost: 1,
        prerequisites: ["roaring_blaze"],
        leaning: "aggression",
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
        // everything nearby, including the caster's own footing.
        delta: { shape: { kind: "burst", radius: 1 }, hitsArea: true, power: -10 },
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
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["wide_ring"],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      lingering_ring: {
        id: "lingering_ring",
        name: "Lingering Ring",
        cost: 3,
        prerequisites: ["slow_burn"],
        excludes: ["searing_wall"],
        leaning: "boldness",
        delta: { cooldownTicks: -1, statusChance: 0.1 },
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
        grantsPassive: { kind: "regen", value: 0.01 },
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
      // burns just as steady, and is harder to knock out.
      banked_embers: {
        id: "banked_embers",
        name: "Banked Embers",
        cost: 1,
        prerequisites: ["ring_of_fire", "shared_warmth"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
        grantsPassive: { kind: "regen", value: 0.015 },
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
        grantsPassive: { kind: "regen", value: 0.02 },
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
    cooldownTicks: 3,
    statusChance: 0.1,
    statusKind: "burn",
    range: { min: 0, max: 4 },
  },
  peck: {
    id: "peck",
    name: "Peck",
    shape: { kind: "point" },
    ...moveCanon("PECK"),
    cooldownTicks: 0,
    range: { min: 0, max: 1 },
  },
  scratch: {
    id: "scratch",
    name: "Scratch",
    shape: { kind: "point" },
    ...moveCanon("SCRATCH"),
    cooldownTicks: 0,
    range: { min: 0, max: 1 },
  },
  rock_throw: {
    id: "rock_throw",
    name: "Rock Throw",
    shape: { kind: "line", length: 3 },
    ...moveCanon("ROCK_THROW"),
    cooldownTicks: 1,
    range: { min: 0, max: 3 },
  },
  water_gun: {
    id: "water_gun",
    name: "Water Gun",
    shape: { kind: "line", length: 2 },
    ...moveCanon("WATER_GUN"),
    cooldownTicks: 0,
    range: { min: 0, max: 2 },
  },
};
