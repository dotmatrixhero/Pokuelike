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
function statusMoveCanon(dexKey: string): Pick<MoveSpec, "type" | "category" | "power" | "accuracy"> {
  const entry = MOVE_DEX_BY_KEY[dexKey];
  if (!entry) throw new Error(`statusMoveCanon: no dex entry for key "${dexKey}" (packages/data/src/dex/moves.generated.ts)`);
  return { type: entry.type, category: "status", power: 0, accuracy: entry.accuracy < 0 ? 100 : entry.accuracy };
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
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
    cooldownTicks: 0,
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
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
          { kind: "regen", value: 0.02 },
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
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
    cooldownTicks: 1,
    range: { min: 0, max: 3 },
    // Standing on a real "boulder" tile (worldgen.ts's Highland-leaning
    // obstacle kind) lets this throw consume it for real, ~3x damage —
    // checked in applySingleDamageInstance (predation.ts) before the damage
    // formula runs, since it's a genuine damage bonus, not a post-hit side
    // effect like terrainBurn. The boulder tile reverts to floor either way
    // once thrown; a clean miss doesn't waste it (accuracy is rolled first).
    consumesOwnTerrain: { terrain: "boulder", damageMultiplier: 3 },
    // v2 full triangle (MOVES_DESIGN.md's "Rock Throw" writeup): Aggression
    // ("Landslide") throws heavier for more, at a real energy cost; Boldness
    // ("Bedrock") plants and shrugs off retaliation; Sociability
    // ("Tremor Call") turns the throw's own tremor into herd buffs. Note:
    // Onix/Spearow/the wild Squirtle pair carry no herdId in scenario.ts
    // today, so this branch is real, shipped content that's currently inert
    // for those specific individuals — see MOVES_DESIGN.md.
    tree: {
      heavy_stones: {
        id: "heavy_stones",
        name: "Heavy Stones",
        cost: 1,
        leaning: "aggression",
        delta: { power: 10, accuracy: -5 },
      },
      boulder_momentum: {
        id: "boulder_momentum",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["heavy_stones"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      landslide_footing: {
        id: "landslide_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["boulder_momentum"], ["grinding_advance"], ["rolling_thunder"]],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      crushing_weight: {
        id: "crushing_weight",
        name: "Crushing Weight",
        cost: 1,
        prerequisites: ["landslide_footing"],
        leaning: "aggression",
        delta: { defensePenetration: 0.3 },
      },
      avalanche_force: {
        id: "avalanche_force",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["crushing_weight"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      overhand_heave: {
        id: "overhand_heave",
        name: "Overhand Heave",
        cost: 1,
        prerequisites: ["avalanche_force"],
        excludes: ["measured_toss"],
        leaning: "aggression",
        // Throws as hard as it can manage — a real bite out of its own
        // energy for the extra weight behind it.
        delta: { power: 15, selfCostPerUse: { need: "energy", amount: 0.05 } },
      },
      measured_toss: {
        id: "measured_toss",
        name: "Measured Toss",
        cost: 1,
        prerequisites: ["avalanche_force"],
        excludes: ["overhand_heave"],
        leaning: "aggression",
        delta: { accuracy: 15 },
      },
      skyfall: {
        id: "skyfall",
        name: "Skyfall",
        cost: 2,
        prerequisitesAnyOf: [["overhand_heave"], ["measured_toss"]],
        leaning: "aggression",
        // Arcs it down out of the sky — a real problem for anything flying.
        delta: { bonusVsType: { type: "flying", multiplier: 1.5 } },
      },
      rockslide_precision: {
        id: "rockslide_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["skyfall"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      cave_in: {
        id: "cave_in",
        name: "Cave-In",
        cost: 2,
        prerequisites: ["rockslide_precision"],
        leaning: "aggression",
        delta: { power: 15, critRateStage: 2 },
      },
      bedrock_stance: {
        id: "bedrock_stance",
        name: "Bedrock Stance",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.08 },
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
      bedrock_footing: {
        id: "bedrock_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisitesAnyOf: [["weathered_slab"], ["grinding_advance"], ["warning_tremor"]],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      unshakeable: {
        id: "unshakeable",
        name: "Unshakeable",
        cost: 1,
        prerequisites: ["bedrock_footing"],
        leaning: "boldness",
        // Plants and refuses to be moved — no drag, knockback, or lunge so
        // much as budges it.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      granite_grip: {
        id: "granite_grip",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["unshakeable"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      aftershock_counter: {
        id: "aftershock_counter",
        name: "Aftershock Counter",
        cost: 1,
        prerequisites: ["granite_grip"],
        excludes: ["granite_ward"],
        leaning: "boldness",
        // Hits hardest at whatever hasn't turned to face the threat yet.
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      granite_ward: {
        id: "granite_ward",
        name: "Granite Ward",
        cost: 1,
        prerequisites: ["granite_grip"],
        excludes: ["aftershock_counter"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
        delta: { resistanceBreaker: { multiplier: 2 } },
      },
      tremor_signal: {
        id: "tremor_signal",
        name: "Tremor Signal",
        cost: 1,
        leaning: "sociability",
        // The impact's own tremor doubles as a warning the herd can brace to.
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      colony_footing: {
        id: "colony_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["tremor_signal"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      tremor_footing: {
        id: "tremor_footing",
        name: "+5 Power",
        cost: 1,
        prerequisitesAnyOf: [["colony_footing"], ["warning_tremor"], ["rolling_thunder"]],
        leaning: "sociability",
        delta: { power: 5 },
      },
      seismic_rally: {
        id: "seismic_rally",
        name: "Seismic Rally",
        cost: 1,
        prerequisites: ["tremor_footing"],
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      tremor_precision: {
        id: "tremor_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["seismic_rally"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      bulwark_coil: {
        id: "bulwark_coil",
        name: "Bulwark Coil",
        cost: 1,
        prerequisites: ["tremor_precision"],
        excludes: ["vanguard_tunneler"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReduction", value: 0.05 },
        delta: { power: -5 },
      },
      vanguard_tunneler: {
        id: "vanguard_tunneler",
        name: "Vanguard Tunneler",
        cost: 1,
        prerequisites: ["tremor_precision"],
        excludes: ["bulwark_coil"],
        leaning: "sociability",
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      colony_watch: {
        id: "colony_watch",
        name: "Colony Watch",
        cost: 2,
        prerequisitesAnyOf: [["bulwark_coil"], ["vanguard_tunneler"]],
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
      seismic_lockdown: {
        id: "seismic_lockdown",
        name: "Seismic Lockdown",
        cost: 2,
        prerequisites: ["tremor_focus"],
        leaning: "sociability",
        delta: { jamCooldownTicks: 3 },
      },
      // Crosslink: Aggression <-> Boldness — a heavier hit off an already
      // grounded, braced throw.
      grinding_advance: {
        id: "grinding_advance",
        name: "Grinding Advance",
        cost: 1,
        prerequisites: ["heavy_stones", "bedrock_stance"],
        leaning: "aggression",
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 12 } },
      },
      // Crosslink: Boldness <-> Sociability — the tremor's warning reaches
      // far enough to brace the thrower too.
      warning_tremor: {
        id: "warning_tremor",
        name: "Warning Tremor",
        cost: 1,
        prerequisites: ["bedrock_stance", "tremor_signal"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.05 },
        delta: {},
      },
      // Crosslink: Sociability <-> Aggression — the herd's own call turns a
      // hurled rock into a stunning one.
      rolling_thunder: {
        id: "rolling_thunder",
        name: "Rolling Thunder",
        cost: 1,
        prerequisites: ["tremor_signal", "heavy_stones"],
        leaning: "sociability",
        delta: { lockTicks: 2 },
      },
    },
  },
  water_gun: {
    id: "water_gun",
    name: "Water Gun",
    shape: { kind: "line", length: 2 },
    ...moveCanon("WATER_GUN"),
    cooldownTicks: 0,
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
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
        grantsPassive: { kind: "damageReduction", value: 0.05 },
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
  },
};
