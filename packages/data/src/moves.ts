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
    // v4 (two-lane standard) — the fantasy first, per MOVES_DESIGN.md's
    // "Skill-tree template v4" and its own guide's principle 1.
    //
    // THE FANTASY. Tackle is the first thing anything learns and the last
    // thing it forgets. There is no element in it, no trick, no reach — it
    // is a body at speed, head down, feet planted, putting its whole weight
    // through whatever is in front of it. Everything that makes it
    // dangerous is borrowed: the mass the animal grew, the ground it braces
    // against, the herd running at its shoulder. And its flaw is that it
    // has to ARRIVE. No range, no projectile: you cross the distance
    // yourself, and when you land you are standing exactly where you hit
    // with your momentum spent. Every branch below is an answer to that
    // flaw.
    //
    // AGGRESSION — the approach is the weapon. Two lanes that differ in
    // KIND, not degree: "never saw it coming" (waiting in the scrub, the
    // bush itself spent on the hit — `situationalBonus: concealed` +
    // `consumesOwnTerrain`) against "saw it coming, could not stop it" (a
    // real `chargeAttack` wind-up that crosses six tiles of open ground).
    // Flavours: stealth/ambush, aggressive movement, raw damage, piercing.
    //
    // BOLDNESS — two bodies meet and one of them moves. Lane A is "nothing
    // moves you" (hide, recovery, `immovable`); lane B is "you move them"
    // (`positionSwap`/`positionSwapPull` — it does not go around, it goes
    // through and comes out standing where they were). Absorb versus
    // displace: the same collision from either end. Flavours: defence,
    // reposition-others, planted/duration, healing.
    //
    // SOCIABILITY — one Tackle is nothing; forty arriving at once is a
    // stampede. Lane A is the CALL (`rallyCall` — the herd's own targeting
    // logic converges on what got named, per "rally/mark mechanics are
    // richer than a same-sized buff"); lane B is what a body is FOR — bulk
    // spent on the herd's behalf, shouldering trees until the canopy gives
    // up its food (`gatherBurst`, the real canopy-harvest path in needs.ts)
    // and standing in the way of what is coming. Flavours: rallying, ally
    // buffing, healing, defence.
    //
    // Deliberately NOT here, each rejected against a real call site rather
    // than a field name (principle 3):
    //   - `ppCost`/`maxPPBonus` — PP is still an unbuilt primitive; there is
    //     no `ppCost` field on `MoveTreeNode.delta` at all, so the
    //     power-vs-PP fork the design doc likes would be dead content.
    //   - `excludesAllies` — read only inside `resolveAreaHit`
    //     (predation.ts), so on a point-shaped move it does nothing unless
    //     the build also took the Aggression capstone's ring. A Sociability
    //     branch that needs another branch's capstone to function is a bug.
    //   - `statusChance`/`statusSeverity`/`statusSpreads` —
    //     `maybeInflictStatus` returns early without a `statusKind`, and
    //     `statusKind` is not a delta field. Tackle has none, so all three
    //     are inert here.
    //   - a fourth healing passive, and any new `thorns`/`damageReduction`.
    //     Passives sum across every move an agent knows and nothing caps
    //     them; this pass adds ZERO new passive grants and moves no
    //     species' exposure totals.
    //   - `aggroRedirect` still does not exist (see the colour pie's "the
    //     one flavour with no mechanics at all"), which is why *Bulwark*
    //     still settles for `damageReduction`.
    tree: {
      // --- Aggression: "Full Charge" -------------------------------------
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

      // Lane A — "never saw it coming": it was in the scrub the whole time.
      hardened_knuckles: {
        id: "hardened_knuckles",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["weighted_charge"],
        leaning: "aggression",
        delta: { accuracy: 10 },
      },
      aftershock: {
        id: "aftershock",
        name: "Aftershock",
        cost: 1,
        prerequisites: ["hardened_knuckles"],
        leaning: "aggression",
        delta: { defensePenetration: 0.12 },
      },
      broke_cover: {
        id: "broke_cover",
        name: "Broke Cover",
        cost: 2,
        prerequisitesAnyOf: [["aftershock"], ["vanguard_press"]],
        leaning: "aggression",
        // LANE NOTABLE. The whole lane's thesis in one node, and it is
        // visible on the map rather than hidden in a meter: it hits far
        // harder out of concealment (`isConcealed` reads the ATTACKER's own
        // tile — predation.ts's `situationalMultiplier`), and the bush it
        // came out of is SPENT doing it (`consumesOwnTerrain` reverts the
        // attacker's own tile to floor). So the ambush bonus and the cover
        // that granted it are the same resource: you get it once, then
        // you're standing in the open like everything else.
        delta: {
          situationalBonus: { condition: "concealed", multiplier: 1.5 },
          consumesOwnTerrain: { terrain: "bush", damageMultiplier: 1.3 },
        },
      },
      bracing_impact: {
        id: "bracing_impact",
        name: "Bracing Impact",
        cost: 1,
        prerequisites: ["broke_cover"],
        leaning: "aggression",
        // A landed, non-killing hit shoves the target back two whole tiles —
        // denying easy follow-up range harder than v1's one-tile shove.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 2, timing: "onHit" } },
      },

      // Lane B — "saw it coming, could not stop it": the run-up itself.
      momentum_grip: {
        id: "momentum_grip",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["weighted_charge"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      full_tilt: {
        id: "full_tilt",
        name: "Full Tilt",
        cost: 2,
        prerequisitesAnyOf: [["momentum_grip"], ["blood_up"]],
        leaning: "aggression",
        // LANE NOTABLE, and the answer to the move's own flaw: Tackle has
        // to arrive. It backs off, sets, and crosses six tiles of open
        // ground in one committed run (`chargeAttack` — attacker is locked
        // for the wind-up, then leaps and lands the blow; predation.ts's
        // `resolveChargedAttack`). Deliberately NOT Body Slam's Reckoning
        // profile, which is a long invulnerable rear-up for enormous
        // damage: this one is a short wind-up and a very long approach,
        // because closing the gap is what Tackle is short of, not power.
        delta: { chargeAttack: { ticks: 1, bonusPower: 15, leapTiles: 6 } },
      },
      full_force_slam: {
        id: "full_force_slam",
        name: "Full-Force Slam",
        cost: 1,
        prerequisites: ["full_tilt"],
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
        prerequisites: ["full_tilt"],
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
        prerequisitesAnyOf: [["bracing_impact"], ["full_force_slam"], ["relentless_charge"]],
        leaning: "aggression",
        // DEEP NOTABLE — where both lanes land, and the only place they
        // could: the ambush lane and the charge lane are both about getting
        // there, so what they converge on is never having to get there
        // again. After a landed hit it immediately closes on whatever's
        // next.
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
        // CAPSTONE. The impact doesn't stop at one target — it ripples
        // outward, shoving back everyone standing nearby.
        delta: {
          shape: { kind: "ring", radius: 1 },
          hitsArea: true,
          power: -10,
          forcedMovement: { mover: "defender", direction: "away", tiles: 2, timing: "onHit" },
        },
      },

      // --- Bridge 1: Aggression <-> Boldness ------------------------------
      // A jolt of confidence off an already-braced, powerful hit — Boldness's
      // sturdiness feeding Aggression's swing. The bridge deepens that one
      // lever the whole way up (principle 13): the same self-buff, first
      // held longer, then held harder.
      grounded_fury: {
        id: "grounded_fury",
        name: "Grounded Fury",
        cost: 1,
        prerequisites: ["weighted_charge", "iron_hide"],
        leaning: "aggression",
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 12 } },
      },
      still_rising: {
        id: "still_rising",
        name: "Still Rising",
        cost: 1,
        prerequisites: ["grounded_fury"],
        leaning: "aggression",
        // Same jolt, twice as long on it — the anger doesn't come off
        // between exchanges any more.
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 24 }, accuracy: 5 },
      },
      blood_up: {
        id: "blood_up",
        name: "Blood Up",
        cost: 2,
        prerequisites: ["still_rising"],
        leaning: "boldness",
        // BRIDGE NOTABLE — an alternate route into Full Tilt (Aggression's
        // charge lane) and Immovable (Boldness's planted lane), which is
        // the pair this crosslink actually connects: a build that braced
        // AND swung can skip either lane's filler grind, never its choice.
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 2, ticks: 24 }, critRateStage: 1 },
      },

      // --- Boldness: "Brace for Impact" -----------------------------------
      iron_hide: {
        id: "iron_hide",
        name: "Iron Hide",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 2 },
        delta: {},
      },

      // Lane A — "nothing moves you".
      sturdy_stance: {
        id: "sturdy_stance",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["iron_hide"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      second_wind: {
        id: "second_wind",
        name: "Second Wind",
        cost: 1,
        prerequisites: ["sturdy_stance"],
        leaning: "boldness",
        // A real, felt recovery rhythm — bought by trading away some
        // precision to fight sustainably instead of going all-out.
        grantsPassive: { kind: "regenFlat", value: 2.25 },
        delta: { accuracy: -5 },
      },
      immovable: {
        id: "immovable",
        name: "Immovable",
        cost: 2,
        prerequisitesAnyOf: [["second_wind"], ["blood_up"]],
        leaning: "boldness",
        // LANE NOTABLE. Plants and refuses to be moved — no drag,
        // knockback, or lunge so much as budges it.
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

      // Lane B — "you move them".
      grounded_hit: {
        id: "grounded_hit",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["iron_hide"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      shoulder_through: {
        id: "shoulder_through",
        name: "Shoulder Through",
        cost: 2,
        prerequisitesAnyOf: [["grounded_hit"], ["no_clean_run"]],
        leaning: "boldness",
        // LANE NOTABLE, and the exact opposite end of the same collision
        // from Immovable's: it does not go around and it does not stop —
        // it goes through, ends the exchange standing where they were
        // (`positionSwap`), and leaves them a further tile off balance
        // (`positionSwapPull`). Physical and visible, per "a drag, a lunge,
        // a swap... an observer can see these happen mid-fight".
        delta: { positionSwap: true, positionSwapPull: 1 },
      },
      counter_slam: {
        id: "counter_slam",
        name: "Counter Slam",
        cost: 1,
        prerequisites: ["shoulder_through"],
        excludes: ["steady_guard"],
        leaning: "boldness",
        // REWORKED, for a stated reason rather than taste: this was
        // `situationalBonus: flanking`, which (a) collided with Vanguard
        // Charge's own flanking bonus on the same OVERWRITE field — two
        // co-takeable nodes, whichever the engine reached last quietly won
        // — and (b) duplicated that crosslink's identity outright. It now
        // does what its NAME always said: the more it has already taken,
        // the harder it comes back (`selfStateBonus`, a lever with three
        // users in the whole roster).
        delta: { power: 10, selfStateBonus: { condition: "selfLowHp", multiplier: 1.4 } },
      },
      steady_guard: {
        id: "steady_guard",
        name: "Steady Guard",
        cost: 1,
        prerequisites: ["shoulder_through"],
        excludes: ["counter_slam"],
        leaning: "boldness",
        // A patient, precise style that never overextends — recoups a real
        // fraction of what it deals.
        delta: { accuracy: 5, lifestealFraction: 0.12 },
      },
      sets_its_feet: {
        id: "sets_its_feet",
        name: "Sets Its Feet",
        cost: 2,
        prerequisitesAnyOf: [["boldness_capstone_filler"], ["counter_slam"], ["steady_guard"]],
        leaning: "boldness",
        // DEEP NOTABLE — the one thing both lanes are really about: whoever
        // is better set wins the collision. Every landed hit leaves it a
        // stage further braced, and that is not just defence here:
        // `effectiveWeight` (predation.ts) adds BRACED_WEIGHT_PER_STAGE per
        // positive Defense stage, and Tackle's own opener scales power off
        // weight. Bracing literally makes the next collision heavier.
        //
        // Note the deliberate overwrite ladder: on a build that came in
        // over Blood Up's bridge this replaces that node's self-ATTACK
        // buff with a self-DEFENSE one. That is the intended reading (the
        // Boldness answer supersedes the Aggression one), and the two are
        // ancestor-related so the checker's overwrite rule treats it as a
        // ladder rather than a silent collision. The `weightScaling` half is
        // the same idea stated outright, raising the opener's 0.15 to 0.25:
        // the loser of a collision is the lighter one.
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 24 }, weightScaling: { factor: 0.25 } },
      },
      weathered_grip: {
        id: "weathered_grip",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["sets_its_feet"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      thornguard: {
        id: "thornguard",
        name: "Thornguard",
        cost: 2,
        prerequisites: ["weathered_grip"],
        leaning: "boldness",
        // CAPSTONE. Standing this firm has its own cost for whoever's still
        // hitting it.
        grantsPassive: { kind: "thorns", value: 0.15 },
        delta: {},
      },

      // --- Bridge 2: Boldness <-> Sociability -----------------------------
      // Extends a bit of that thick hide to whoever's fighting alongside —
      // and gets in the way while doing it. The `jamCooldownTicks` half is
      // new: the crosslink previously had an empty `delta` and only a
      // passive, which left its bridge nothing to deepen (principle 13
      // requires the bridge's filler to escalate the crosslink's OWN lever,
      // and PART 4's rule is to spend a passive like a capstone, not to
      // grant a second one just to have a lever). Stepping into the path of
      // something mid-swing and costing it the beat is what a guardian
      // actually does; the bridge escalates exactly that, twice.
      guardians_stand: {
        id: "guardians_stand",
        name: "Guardian's Stand",
        cost: 1,
        prerequisites: ["iron_hide", "steadfast_guard"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { jamCooldownTicks: 1 },
      },
      in_the_way: {
        id: "in_the_way",
        name: "In the Way",
        cost: 1,
        prerequisites: ["guardians_stand"],
        leaning: "boldness",
        // Doesn't dodge, doesn't duck — puts a shoulder where the swing was
        // going, and it costs the attacker another beat.
        delta: { jamCooldownTicks: 1, accuracy: 5 },
      },
      no_clean_run: {
        id: "no_clean_run",
        name: "No Clean Run",
        cost: 2,
        prerequisites: ["in_the_way"],
        leaning: "sociability",
        // BRIDGE NOTABLE — an alternate route into Shoulder Through
        // (Boldness's displacement lane) and Bulwark (Sociability's
        // standing-in-the-way lane), the two lanes this crosslink connects.
        // Nothing gets a clean run at the herd: a third beat off the
        // attacker's rhythm, and its guard no longer buys it much either.
        delta: { jamCooldownTicks: 1, defensePenetration: 0.1 },
      },

      // --- Sociability: "Shared Ground" ------------------------------------
      steadfast_guard: {
        id: "steadfast_guard",
        name: "Steadfast Guard",
        cost: 1,
        leaning: "sociability",
        // Shares a braced stance with the nearest threatened herd-mate.
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },

      // Lane A — the CALL: change what everyone else decides to do.
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
        prerequisites: ["watchful_stance"],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      rally_cry: {
        id: "rally_cry",
        name: "Rally Cry",
        cost: 2,
        prerequisitesAnyOf: [["herd_instinct"], ["vanguard_press"]],
        leaning: "sociability",
        // LANE NOTABLE. It was called Rally Cry and it did not rally: the
        // node only buffed one herd-mate's Attack. It now sets a real
        // `rallyCall` mark, which is a categorically different payoff from
        // a same-sized buff — every nearby agent's OWN, independently-run
        // target selection (`preferMarked`, predation.ts) converges on
        // whatever got named. The herd deciding together is the reward.
        delta: {
          targetsAlly: true,
          allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } },
          rallyCall: { ticks: 15 },
        },
      },
      close_ranks: {
        id: "close_ranks",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["rally_cry"],
        leaning: "sociability",
        delta: { power: 5 },
      },

      // Lane B — what a body is FOR: bulk spent on the herd's behalf.
      browse_line: {
        id: "browse_line",
        name: "Browse Line",
        cost: 1,
        prerequisites: ["steadfast_guard"],
        leaning: "sociability",
        // The herd walks the tree line shouldering trunks until the canopy
        // gives up its food. Real, not flavour text: needs.ts's canopy
        // harvest lets any damage move stand in for a dig move, and adds
        // `gatherBurst` on top of the base burst — so a Tackle specced this
        // way genuinely feeds the herd faster. One of four users of the
        // lever in the entire roster.
        delta: { gatherBurst: 2 },
      },
      bulwark: {
        id: "bulwark",
        name: "Bulwark",
        cost: 2,
        prerequisitesAnyOf: [["browse_line"], ["no_clean_run"]],
        leaning: "sociability",
        // LANE NOTABLE. A last line that doesn't move and doesn't quit —
        // soaks up real damage doing it. (Still `damageReduction` because
        // `aggroRedirect`, the attention-grabbing primitive this node
        // actually wants, has never been built — see the colour pie.)
        grantsPassive: { kind: "damageReduction", value: 0.08 },
        delta: { power: 10 },
      },
      bulwark_stance: {
        id: "bulwark_stance",
        name: "Bulwark Stance",
        cost: 1,
        prerequisites: ["bulwark"],
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
        prerequisites: ["bulwark"],
        excludes: ["bulwark_stance"],
        leaning: "sociability",
        // Charges in ahead of the herd, hitting hard enough to throw off the
        // target's own rhythm.
        delta: { power: 15, jamCooldownTicks: 1 },
      },
      the_herd_arrives: {
        id: "the_herd_arrives",
        name: "The Herd Arrives",
        cost: 2,
        prerequisitesAnyOf: [["close_ranks"], ["bulwark_stance"], ["front_line"]],
        leaning: "sociability",
        // DEEP NOTABLE — where the call and the wall become the same thing.
        // The support effect stops needing its own turn: it piggybacks on
        // every hostile hit this thing lands (`allyEffectOnAttack`,
        // predation.ts), so a herd-mate is braced or emboldened every time
        // the biggest body in the herd connects with something. No longer a
        // choice between fighting and helping — and the effect it passes on
        // is a full ladder over Rally Cry's own (+2 Attack stages, 24 ticks,
        // up from +1/20), so lane A's call and lane B's wall both get
        // strictly better here rather than one overwriting the other.
        delta: { allyEffectOnAttack: true, allyEffect: { buff: { stat: "attack", stage: 2, ticks: 24 } } },
      },
      sociability_capstone_filler: {
        id: "sociability_capstone_filler",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["the_herd_arrives"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      guardians_aura: {
        id: "guardians_aura",
        name: "Guardian's Aura",
        cost: 2,
        prerequisites: ["sociability_capstone_filler"],
        leaning: "sociability",
        // CAPSTONE. Just standing near this Tackle-user mends the herd,
        // slowly, all on its own — no move needed, no cooldown to manage.
        grantsPassive: { kind: "healAura", value: 0.01 },
        delta: {},
      },

      // --- Bridge 3: Sociability <-> Aggression ---------------------------
      // Charges in specifically at whatever's caught off guard menacing the
      // herd. The bridge deepens that same flanking read the whole way up.
      vanguard_charge: {
        id: "vanguard_charge",
        name: "Vanguard Charge",
        cost: 1,
        prerequisites: ["steadfast_guard", "weighted_charge"],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.25 } },
      },
      into_the_gap: {
        id: "into_the_gap",
        name: "Into the Gap",
        cost: 1,
        prerequisites: ["vanguard_charge"],
        leaning: "sociability",
        // Reads the hole in the line rather than the target — anything
        // whose attention is elsewhere pays more for it.
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.45 }, accuracy: 5 },
      },
      vanguard_press: {
        id: "vanguard_press",
        name: "Vanguard Press",
        cost: 2,
        prerequisites: ["into_the_gap"],
        leaning: "aggression",
        // BRIDGE NOTABLE — an alternate route into Broke Cover
        // (Aggression's ambush lane) and Rally Cry (Sociability's call
        // lane), the pair this crosslink connects, and it complements both
        // rather than matching them: a herd that names its threat creates
        // the distracted flank this node punishes. The penetration is the
        // same read applied to the body rather than the field: it goes in
        // where the guard is not.
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.7 }, defensePenetration: 0.08 },
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
    // ================================================================
    // SLASH — v4 two-lane conversion (36 -> 45). "The stillness before
    // the swing."
    //
    // THE FANTASY, written before a node was touched:
    //
    //   Slash is a cut, and a cut is a decision made before the arm
    //   moves. There is one line through an animal that opens it and a
    //   hundred that skid off bone, and the whole move is the discipline
    //   of waiting for that line to show itself. Nothing is left behind:
    //   no filth, no torn ground, no wound that keeps working after. The
    //   edge goes in clean, comes out clean, and the thing it cut simply
    //   stops. Every species that knows it carries an implement instead
    //   of a paw — Scyther's scythes, Pinsir's pincers, Farfetch'd's leek
    //   held like a sword, Charizard's talons. What is dangerous about
    //   Slash is not the swing. It is the stillness before it.
    //
    // WRITTEN AGAINST SCRATCH, DELIBERATELY. Scratch was converted one
    // pass earlier as "four claws and no technique... a rake that LEAVES
    // THINGS BEHIND" — a septic wound, churned mud, a shredded bush, a
    // claw mark on a tree. Slash is the opposite animal and the source
    // enforces it as a rule, not a vibe:
    //   - Scratch leaves things behind. Slash leaves NOTHING behind, so
    //     this tree has no `statusChance`, no `statusSpreads`, no
    //     `terrainFill`, no `terrainBurn`, no `consumesOwnTerrain`.
    //     Scratch owns every one of those and Slash touches none.
    //   - Scratch has no wind-up ("the paw is already moving") and its
    //     own comment names `chargeAttack` as deliberately absent. Slash
    //     is ALL wind-up, so `chargeAttack` is this tree's Boldness lane
    //     notable — and at `leapTiles: 0` it is the only charge in the
    //     roster that does not travel. Tackle crosses six tiles, Peck
    //     three, Body Slam rears up. Slash stands still.
    //   - Scratch's Sociability marks and shouts (`rallyCall` on a raked
    //     flank, `nonTerritorial` on a scored tree). Slash's is TEACHING:
    //     technique is the one thing about this move that can be handed
    //     to another animal. A filthy claw teaches nothing; a cut can be
    //     shown, drilled and copied.
    //
    // TEMPO: base 5, cdFloor 1, maxCut -4 — and the tree already spent
    // exactly -4 before this conversion, i.e. it is ALREADY at the 3.00x
    // cap. Not one tick of new cooldown headroom was spent here; the
    // four -1 nodes are the same four that shipped in v2.
    //
    // CRIT is Slash's signature and `rollCritical` (combat.ts) CLAMPS the
    // stage at 3, so the whole tree grants exactly +3 and not one more:
    // The Line Shows Itself (+1) -> Reaping Slash (+1) -> Apex Predator
    // (+1). Stage 3 is 100% crit, and only the Reaping fork reaches it —
    // Frenzy and Cleaving builds stop at stage 2 (50%). That is the fork
    // paying off in kind rather than in degree, and nothing past 3 is
    // sold anywhere in the tree.
    //
    // REJECTED, with the call site read rather than guessed:
    //   - `critCooldownReset`. Perfect flavour ("a cut that clean, the
    //     arm is already back on guard") and a real lever with five
    //     roster users, but it is an INVISIBLE SECOND TEMPO MULTIPLIER
    //     that the tempo formula in DESIGN_VALIDATION.md cannot see. On
    //     this tree specifically, a fully-invested Reaping build sits at
    //     crit stage 3 = every hit crits = the cooldown resets every hit
    //     = effective cooldown 0 = 6.0x tempo on a move whose cap is
    //     3.0x. It is the one lever that is genuinely unsafe here BECAUSE
    //     Slash is the crit move. Left out on purpose.
    //   - `statusImmunityAura` and `selfHeal`. Both are driven by
    //     `utilityMoves.ts`'s `maybeUseUtilityMove`, which needs the
    //     `utilityMove` flag an attack move cannot carry (see
    //     MoveSpec's own doc comments, engine/moves.ts:416-418). Dead on
    //     Slash. Same class of finding as Scratch's `drainNeeds`.
    //   - Four of the tree's five `situationalBonus` setters. It is an
    //     OVERWRITE field and v2 shipped five co-takeable ones — a real
    //     checker problem, and three of the five silently did nothing on
    //     any mixed build. Exactly one survives (Coup de Grace), and the
    //     nodes that lost it gained real levers instead.
    //   - Six of the v2 tree's nine `accuracy` nodes' worth of surplus.
    //     Slash's canon accuracy is 100 and `rollAccuracy` only ever
    //     spends surplus through `extraMultiplier` — storms (0.6x,
    //     weather.ts) and attacking uphill (down to 0.7x,
    //     elevation.ts) — so it is live, but only barely, and nine
    //     accuracy nodes on a 100-accuracy move is filler wearing a
    //     precision branch's name. Tree total: 105 -> 60.
    //
    // PASSIVES went from two stacking kinds to none. `damageReduction`
    // (Alpha Strike) and `regenFlat` (Opportunist Scavenger) both came
    // out — those are the two that sum uncapped across a species' whole
    // movepool (`agent.passives[kind] += value`, status.ts) and the two
    // MOVES_DESIGN.md names as the laziest reach for a "tanky branch".
    // What went in instead is `immovable`, `unshaken` and
    // `calmingPresence`, all three of which are read as booleans or as
    // an aura at a fixed radius and CANNOT stack into invulnerability:
    // `unshaken` is `passives.unshaken > 0` with its own recharge
    // (predation.ts's `resolveHitAgainstTarget`), `immovable` is a flat
    // opt-out of forced movement (movement.ts). Slash now grants 0%
    // damage reduction, 0%/tick healing and 0% thorns.
    // ================================================================
    tree: {
      // ============================================================
      // AGGRESSION — "The One Cut"
      // Aggression here is not more swings. It is everything spent on
      // making a single stroke lethal, and on the geometry that puts the
      // edge where nothing is able to stop it.
      // Lanes differ in KIND: Lane A is HOW THE SWING IS SPENT (one
      // committed stroke / several light ones / one wide arc — the crit
      // lane), Lane B is WHERE THE EDGE REACHES (the seam, then two
      // tiles of it). Severity against geometry, not two sizes of the
      // same thing.
      // Flavours: raw damage, piercing, aggressive movement, wider AoE,
      // stealth/ambush, resource economy.
      // ============================================================
      honed_edge: {
        id: "honed_edge",
        name: "Honed Edge",
        cost: 1,
        leaning: "aggression",
        // OPENER. A wickedly sharp edge that shears through armor as
        // much as flesh.
        delta: { power: 15, defensePenetration: 0.15 },
      },

      // --- Lane A: "The Stroke" — how the swing is spent ---
      raking_claws: {
        id: "raking_claws",
        name: "Whetstone Hours",
        cost: 1,
        prerequisites: ["honed_edge"],
        leaning: "aggression",
        // LANE A filler. Was a bare "+5 Power". An edge that cuts like
        // this is an edge that gets sat with and worked on, and a stroke
        // thrown from the shoulder instead of the wrist costs real
        // stamina to throw — `selfCostPerUse` drains the user's own
        // energy every cast (predation.ts's `resolveHit`), with the
        // payoff in the same node (principle 4). Fifth user of a lever
        // the roster has barely touched.
        delta: { power: 8, selfCostPerUse: { need: "energy", amount: 0.05 } },
      },
      harder_swing: {
        id: "harder_swing",
        name: "The Line Shows Itself",
        cost: 2,
        prerequisitesAnyOf: [["raking_claws"], ["never_set_again"]],
        leaning: "aggression",
        // LANE A NOTABLE, and the tree's first crit stage. The whole
        // fantasy in one node: the opening appears and the arm is
        // already through it, so the swing comes round sooner AND finds
        // the gap more often. Crit stage 0 -> 1 is 1/24 -> 1/8
        // (`CRIT_STAGE_CHANCE`, combat.ts). The -1 cooldown is one of
        // the four this tree already shipped; no new tempo was spent.
        delta: { cooldownTicks: -1, critRateStage: 1 },
      },
      reaping_slash: {
        id: "reaping_slash",
        name: "Reaping Slash",
        cost: 1,
        prerequisites: ["harder_swing"],
        excludes: ["frenzy_cutter", "cleaving_slash"],
        leaning: "aggression",
        // FORK A. A committed, all-in follow-through — locks the user
        // out of its next action tick, but a hit this precise finds weak
        // points more often. The ONLY route to crit stage 3 (always
        // crits, once Apex Predator lands); the other two forks cap at
        // stage 2.
        delta: { power: 25, cooldownTicks: 1, lockTicks: 2, critRateStage: 1 },
      },
      frenzy_cutter: {
        id: "frenzy_cutter",
        name: "Frenzy Cutter",
        cost: 1,
        prerequisites: ["harder_swing"],
        excludes: ["reaping_slash", "cleaving_slash"],
        leaning: "aggression",
        // FORK B. Several quick, lighter cuts, reckless enough to nick
        // the user too. Volume instead of severity — and at stage 2 a
        // multi-hit build crits about half its individual hits.
        delta: { hits: { min: 2, max: 3 }, power: -20, recoilFraction: 0.05 },
      },
      cleaving_slash: {
        id: "cleaving_slash",
        name: "Cleaving Slash",
        cost: 1,
        prerequisites: ["harder_swing"],
        excludes: ["reaping_slash", "frenzy_cutter"],
        leaning: "aggression",
        // FORK C, and the tree's ONLY `shape` setter — a wide sweeping
        // arc that catches everyone standing in front of it, not just
        // the one target it was aimed at.
        delta: { shape: { kind: "cone", length: 1, width: 2 }, hitsArea: true, power: -15 },
      },

      // --- Lane B: "Where The Edge Reaches" — the seam, and then two
      // tiles of it ---
      predators_instinct: {
        id: "predators_instinct",
        name: "Predator's Instinct",
        cost: 1,
        prerequisites: ["honed_edge"],
        leaning: "aggression",
        // LANE B filler. Was `situationalBonus: night` — dropped because
        // `situationalBonus` is an OVERWRITE field and v2 shipped five
        // co-takeable setters of it, so on most builds this node either
        // erased Coup de Grace or was erased by it. The NAME survives
        // intact under a mechanic that fits it better: an instinct for
        // where a thing will actually die, not for what time of day it
        // is.
        delta: { power: 5, defensePenetration: 0.1 },
      },
      coup_de_grace: {
        id: "coup_de_grace",
        name: "Coup de Grace",
        cost: 2,
        prerequisitesAnyOf: [["predators_instinct"], ["the_named_one"]],
        leaning: "aggression",
        // LANE B NOTABLE, and now the tree's ONLY `situationalBonus`.
        // Anything already burned, poisoned, paralyzed, asleep or frozen
        // goes down twice as fast — the executioner's read, and the one
        // condition worth keeping on a move that inflicts no status of
        // its own: it can only ever fire on damage some OTHER move set
        // up, which is exactly what a finisher is.
        delta: { situationalBonus: { condition: "targetStatused", multiplier: 2 } },
      },
      sharpened_focus: {
        id: "sharpened_focus",
        name: "The Long Guard",
        cost: 1,
        prerequisites: ["coup_de_grace"],
        leaning: "aggression",
        // LANE B tail, and the memorable one. Was a bare "+10 Accuracy",
        // the fourth of nine on a 100-accuracy move. A scythe, a pincer
        // and a leek are all longer than the arm holding them, so this
        // buys the thing none of the other Normal-type melee trees have:
        // real REACH. `range.max` 1 -> 2 is read by `moveRange`/
        // `withinMoveRange` (combat.ts), which is what predation.ts uses
        // to decide "attack now" vs. "close the distance" — so the
        // holder visibly stops stepping into melee. Less shoulder behind
        // a cut thrown at full extension, hence the -5.
        //
        // It also has a real NON-COMBAT payoff, which is why it earns a
        // lane tail rather than a filler slot: needs.ts's canopy-harvest
        // path lets a damage move stand in for a dig, "with higher range
        // giving advantage" — `CANOPY_HARVEST_RANGE_BONUS_PER_POINT` is
        // multiplied by `range.max - 1`. A Slash user with the Long
        // Guard cuts fruit down out of the canopy measurably faster.
        // Scratch, a point move, cannot buy this at all.
        delta: { range: { min: 0, max: 2 }, power: -5 },
      },

      apex_predator: {
        id: "apex_predator",
        name: "Apex Predator",
        cost: 2,
        prerequisitesAnyOf: [["reaping_slash"], ["frenzy_cutter"], ["cleaving_slash"], ["sharpened_focus"]],
        leaning: "aggression",
        // DEEP NOTABLE — both lanes converge here. Every strike from
        // here carries real killing intent. Third and LAST crit stage in
        // the tree: a Reaping build lands on stage 3 (100%), everything
        // else on stage 2 (50%). `rollCritical` clamps at 3, so nothing
        // beyond this point sells another one.
        delta: { power: 10, critRateStage: 1 },
      },
      ferocity_capstone_filler: {
        id: "ferocity_capstone_filler",
        name: "All The Way Through",
        cost: 1,
        prerequisites: ["apex_predator"],
        leaning: "aggression",
        // Filler. Was a bare "+5 Power". The arm goes all the way
        // through the target and takes a beat to come back — real cost
        // and real payoff in the same node (principle 4). `lockTicks`
        // locks the USER, not the defender (principle 3).
        delta: { power: 5, lockTicks: 1 },
      },
      merciless: {
        id: "merciless",
        name: "Merciless",
        cost: 2,
        prerequisites: ["ferocity_capstone_filler"],
        leaning: "aggression",
        // CAPSTONE. Even a hide built to shrug off a Normal-type hit
        // doesn't fully blunt this anymore.
        delta: { resistanceBreaker: { multiplier: 1.5 } },
      },

      // ============================================================
      // BOLDNESS — "The Stillness"
      // Boldness for a duellist is not armour. It is the nerve to stand
      // perfectly still inside someone else's attack and wait for the
      // line to show — and then the footwork that decides, to the tile,
      // where the exchange happens.
      // Lanes differ in KIND: Lane A REFUSES TO MOVE AT ALL (a wind-up
      // that is literally untouchable, plus the two passives that stop
      // anything shifting it), Lane B MOVES EXACTLY ONE TILE at exactly
      // the right instant. Not two grades of toughness — one lane's
      // answer is stillness and the other's is distance.
      // Flavours: defence, aggressive movement, raw damage, piercing.
      // ============================================================
      keen_eye: {
        id: "keen_eye",
        name: "Keen Eye",
        cost: 1,
        leaning: "boldness",
        // OPENER. Reads an opening better than most. Slash's canon
        // accuracy is 100, so surplus only pays out through
        // `rollAccuracy`'s `extraMultiplier` — fighting in a storm
        // (0.6x) or uphill (down to 0.7x). This branch is the one place
        // in the tree where that is worth buying on purpose, and the
        // Opportunist's Strike fork below deliberately gives it
        // something to cover.
        delta: { accuracy: 15 },
      },

      // --- Lane A: "The Held Stance" — nothing moves it, including it ---
      light_footing: {
        id: "light_footing",
        name: "Rooted Stance",
        cost: 1,
        prerequisites: ["keen_eye"],
        leaning: "boldness",
        // LANE A filler. Was a bare "+5 Power". `immovable` is read by
        // movement.ts's `applyForcedMovement` as a flat opt-out of being
        // dragged, shoved or lunged at — which is precisely what a
        // wind-up lane needs, because the whole lane is built on holding
        // one tile. Binary, so it cannot stack across a movepool.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: { power: 3 },
      },
      steady_hand: {
        id: "steady_hand",
        name: "Economy of Motion",
        cost: 1,
        prerequisites: ["light_footing"],
        leaning: "boldness",
        // LANE A filler. The blade never travels further than it has to,
        // so it comes back on guard sooner. One of the four -1 cooldown
        // nodes this tree already shipped.
        delta: { cooldownTicks: -1 },
      },
      the_long_moment: {
        id: "the_long_moment",
        name: "The Long Moment",
        cost: 2,
        prerequisitesAnyOf: [["steady_hand"], ["never_set_again"]],
        leaning: "boldness",
        // LANE A NOTABLE, and the single node this whole conversion was
        // built around. "What is dangerous about Slash is not the swing,
        // it is the stillness before it" — and the engine makes that
        // literal: while `Agent.chargingAttack` is set, predation.ts's
        // `resolveHit` REFUSES every attack against the holder outright
        // ("no accuracy roll, no partial effects"). Going still is the
        // defence.
        //
        // `leapTiles: 0` is the point of difference from every other
        // charge in the roster: Tackle's Full Tilt crosses six tiles,
        // Peck's Set The Point three, Body Slam's Reckoning rears up and
        // drops. This one does not travel at all. It stands, for two
        // ticks, and then cuts. The cost is in the same node as the
        // payoff — two action ticks are two actions not taken, and if
        // the target has moved out of the line when it releases, the
        // whole thing is spent for nothing.
        delta: { chargeAttack: { ticks: 2, bonusPower: 40, leapTiles: 0 } },
      },
      unflinching: {
        id: "unflinching",
        name: "Unflinching",
        cost: 1,
        prerequisites: ["the_long_moment"],
        leaning: "boldness",
        // LANE A tail. `unshaken` is the rarest defensive passive in the
        // roster (three users) and the only one that is not a
        // percentage: the next hit against the holder is negated
        // entirely — no accuracy roll, no partial effects, the same
        // shape as the charge's own invulnerability window — and then it
        // recharges (predation.ts's `resolveHitAgainstTarget`,
        // `Agent.unshakenCooldownTicks`). "Doesn't even flinch the first
        // time" is the duellist's composure stated as a mechanic, and
        // it is deliberately NOT `damageReduction`, which is what this
        // branch would have reached for and what Scratch's own Dug In
        // lane already spends.
        grantsPassive: { kind: "unshaken", value: 1 },
        delta: { power: 3 },
      },

      // --- Lane B: "The Footwork" — one tile, exactly on time ---
      feint: {
        id: "feint",
        name: "Feint",
        cost: 1,
        prerequisites: ["keen_eye"],
        leaning: "boldness",
        // LANE B filler. Closes to melee as part of using the move,
        // before the hit itself resolves.
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" } },
      },
      quickstep: {
        id: "quickstep",
        name: "Measure",
        cost: 2,
        prerequisitesAnyOf: [["feint"], ["the_opening_called"]],
        leaning: "boldness",
        // LANE B NOTABLE. Was a bare "+5 Power". "Measure" is the
        // fencer's word for exact distance, and this is the lane's
        // thesis: step in on the precise beat their guard resets, put
        // the point where the plate does not meet, and leave them a tick
        // further from acting than they were. `jamCooldownTicks` pushes
        // the DEFENDER's own cooldowns out — tempo DENIAL, which is the
        // only honest way for a tree already sitting on the 3.00x tempo
        // cap to keep feeling faster than what it is fighting.
        delta: { power: 5, jamCooldownTicks: 1, defensePenetration: 0.1 },
      },
      opportunists_strike: {
        id: "opportunists_strike",
        name: "Opportunist's Strike",
        cost: 1,
        prerequisites: ["quickstep"],
        excludes: ["calculated_retreat"],
        leaning: "boldness",
        // FORK A. Was `situationalBonus: flanking`, cut for the
        // OVERWRITE collision (see Coup de Grace). What replaced it is
        // the fork's actual decision: this one does NOT wait for the
        // measure. It goes the instant the guard opens and sometimes
        // goes into nothing — 100 accuracy down to 85 is a real miss
        // chance in `rollAccuracy` at any weather, which is what finally
        // makes Keen Eye's +15 a live purchase rather than surplus.
        delta: { power: 12, accuracy: -15 },
      },
      calculated_retreat: {
        id: "calculated_retreat",
        name: "Calculated Retreat",
        cost: 1,
        prerequisites: ["quickstep"],
        excludes: ["opportunists_strike"],
        leaning: "boldness",
        // FORK B, and different in KIND from Fork A rather than in
        // degree: A commits and stays in the exchange, B refuses to be
        // in it. Strikes, then immediately steps back out of range —
        // never sticks around for the counter.
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 1, timing: "onHit" }, accuracy: 10 },
      },

      flawless_form: {
        id: "flawless_form",
        name: "Flawless Form",
        cost: 2,
        prerequisitesAnyOf: [["unflinching"], ["opportunists_strike"], ["calculated_retreat"]],
        leaning: "boldness",
        // DEEP NOTABLE — both lanes converge here. A style so refined it
        // barely wastes a drop of momentum, or blood.
        delta: { accuracy: 20, lifestealFraction: 0.1 },
      },
      precision_capstone_filler: {
        id: "precision_capstone_filler",
        name: "No Wasted Motion",
        cost: 1,
        prerequisites: ["flawless_form"],
        leaning: "boldness",
        // Filler. The last of the four -1 cooldown nodes this tree
        // already shipped.
        delta: { cooldownTicks: -1 },
      },
      perfect_strike: {
        id: "perfect_strike",
        name: "Perfect Strike",
        cost: 2,
        prerequisites: ["precision_capstone_filler"],
        leaning: "boldness",
        // CAPSTONE. About as close to a guaranteed, clean hit as this
        // sim's accuracy math allows.
        delta: { power: 12, accuracy: 10 },
      },

      // ============================================================
      // SOCIABILITY — "The Form Passed On"
      // Technique is the one thing about this move that can be handed to
      // another animal. A filthy claw teaches nothing; a cut can be
      // shown, drilled and copied — and a clean kill is the only kind a
      // herd can actually share, because nothing is spoiled, nothing is
      // wasted and nothing is left thrashing.
      // Lanes differ in KIND: Lane A makes herd-mates BETTER AT FIGHTING
      // (the drill — a demonstration that eventually stops needing to be
      // a separate errand), Lane B makes herd-mates FED (the clean kill
      // — the carcass opened along its seams, the fruit taken out of the
      // canopy whole). Teaching against feeding.
      // Flavours: ally buffing, healing, calming, planted/duration, raw
      // damage.
      // ============================================================
      shared_scent: {
        id: "shared_scent",
        name: "The Demonstration",
        cost: 1,
        leaning: "sociability",
        // OPENER. Was "Shared Scent" — a scent-marking name on a move
        // whose whole Sociability fantasy is technique, and Scratch owns
        // the scent-and-mark register outright. The mechanic never
        // changed and it was always describing this: `targetsAlly` means
        // the move can be aimed AT a herd-mate, and what they take from
        // it is a real Attack buff. That is a lesson, not a scent.
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 15 } } },
      },

      // --- Lane A: "The Drill" — the form, taught ---
      scavengers_patience: {
        id: "scavengers_patience",
        name: "Hours On The Form",
        cost: 1,
        prerequisites: ["shared_scent"],
        leaning: "sociability",
        // LANE A filler. Was "Scavenger's Patience", a scavenging name
        // on the teaching lane. Repetition is what a drill IS, and it is
        // the one honest place left in this tree for accuracy: an animal
        // that has cut the same line ten thousand times still finds it
        // in a storm.
        delta: { accuracy: 10, power: 5 },
      },
      kin_sense: {
        id: "kin_sense",
        name: "Called Tempo",
        cost: 1,
        prerequisites: ["scavengers_patience"],
        leaning: "sociability",
        // LANE A filler. Drilling to a called beat. One of the four -1
        // cooldown nodes this tree already shipped; its v2
        // `prerequisitesAnyOf` moved up to Coordinated Strike, which is
        // where this lane's bridge shortcut now lands.
        delta: { cooldownTicks: -1 },
      },
      coordinated_strike: {
        id: "coordinated_strike",
        name: "Coordinated Strike",
        cost: 2,
        prerequisitesAnyOf: [["kin_sense"], ["the_opening_called"]],
        leaning: "sociability",
        // LANE A NOTABLE. Fighting where another of its kind can back it
        // up breeds real confidence — and the lane's payoff is that the
        // demonstration stops being a separate errand. `allyEffectOnAttack`
        // (predation.ts) makes the opener's Attack buff ride along on an
        // ordinary hostile cut, so the teacher no longer has to stop
        // fighting to teach.
        delta: {
          statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 10 },
          allyEffectOnAttack: true,
        },
      },
      pack_rhythm: {
        id: "pack_rhythm",
        name: "In Step",
        cost: 1,
        prerequisites: ["coordinated_strike"],
        leaning: "sociability",
        // LANE A tail. Two animals cutting on the same count.
        delta: { power: 5, accuracy: 10 },
      },

      // --- Lane B: "The Clean Kill" — the herd eats because of the edge ---
      clean_through: {
        id: "clean_through",
        name: "Clean Through",
        cost: 1,
        prerequisites: ["shared_scent"],
        leaning: "sociability",
        // LANE B filler. The cut goes through rather than worrying at
        // the thing, so the edge takes what it opened instead of losing
        // it into the dirt.
        delta: { power: 5, lifestealFraction: 0.05 },
      },
      dressed_not_torn: {
        id: "dressed_not_torn",
        name: "Dressed, Not Torn",
        cost: 2,
        prerequisitesAnyOf: [["clean_through"], ["the_named_one"]],
        leaning: "sociability",
        // LANE B NOTABLE, and the lane's whole thesis: a carcass opened
        // along its seams feeds a herd, and a carcass mauled open feeds
        // half of one. `gatherBurst` is read on needs.ts's CANOPY
        // HARVEST path for a damage move — a deliberately different code
        // path from Scratch's Communal Foraging, which spends the same
        // lever on the DIG path (`digMove.gatherBurst`, needs.ts:1710).
        // Scratch digs food up; Slash cuts it down.
        delta: { gatherBurst: 3 },
      },
      opportunist_scavenger: {
        id: "opportunist_scavenger",
        name: "Opportunist Scavenger",
        cost: 1,
        prerequisites: ["dressed_not_torn"],
        excludes: ["territorial_snarl"],
        leaning: "sociability",
        // FORK A. Was a `regenFlat` passive — pulled because healing
        // passives sum uncapped across a species' entire movepool and
        // this one was buying, on a fork tip, the thing the whole roster
        // has too much of. It now does what its name says with a delta
        // instead: it takes its share out of the animal it opened, at
        // the price of a lighter cut. Bounded by the move.
        delta: { power: -5, lifestealFraction: 0.12 },
      },
      territorial_snarl: {
        id: "territorial_snarl",
        name: "Territorial Snarl",
        cost: 1,
        prerequisites: ["dressed_not_torn"],
        excludes: ["opportunist_scavenger"],
        leaning: "sociability",
        // FORK B, and different in KIND from Fork A: A takes a bigger
        // share of the kill, B refuses to share it at all and dares the
        // rest to argue. Was `situationalBonus: targetLowHp`, cut for
        // the OVERWRITE collision (see Coup de Grace). Standing over a
        // carcass and snarling is a real posture and a real cost — an
        // animal committed to the argument is not moving off the
        // carcass, which is what `lockTicks` does to its own user.
        delta: { power: 12, lockTicks: 1 },
      },

      alpha_strike: {
        id: "alpha_strike",
        name: "The One They Watch",
        cost: 2,
        prerequisitesAnyOf: [["pack_rhythm"], ["opportunist_scavenger"], ["territorial_snarl"]],
        leaning: "sociability",
        // DEEP NOTABLE — both lanes converge here. Was "Alpha Strike"
        // carrying a flat 10% `damageReduction`, which MOVES_DESIGN.md
        // names by title ("Stop overusing damageReduction") as the
        // laziest possible answer for a branch like this, and which
        // stacks uncapped across every tree a species knows.
        //
        // `calmingPresence` is the honest version of the same idea and a
        // far better one: herdConflict.ts's `herdConflictChance`
        // multiplies DOWN the rivalry-escalation chance of every living
        // agent in a radius, both sides of a standoff, not just its own
        // herd. Nothing near an animal this visibly good with an edge
        // wants to start anything. It is deterrence rather than armour,
        // it happens on the map where it can be watched, and it is the
        // one thing in this tree that makes a fight NOT happen.
        //
        // 0.2 rather than a bigger number, and the number is measured:
        // `herdConflictChance` floors the multiplier at
        // MIN_CALMING_MULTIPLIER = 0.5 (herdConflict.ts), so a species'
        // SUMMED calm past 0.50 buys literally nothing. Charizard
        // already carries 0.30 from Flamethrower's Calming Ash, so 0.35
        // here (the first draft) wasted 0.15 of a skill point on one of
        // Slash's four learners. At 0.2 Charizard lands exactly on the
        // floor and nothing in the tree is dead.
        delta: { power: 6 },
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
      },
      pack_capstone_filler: {
        id: "pack_capstone_filler",
        name: "Second On The Line",
        cost: 1,
        prerequisites: ["alpha_strike"],
        leaning: "sociability",
        // Filler. Was a bare "+10 Accuracy", the ninth in the tree.
        // Someone else standing where they were shown to stand.
        delta: { defensePenetration: 0.1 },
      },
      united_front: {
        id: "united_front",
        name: "United Front",
        cost: 2,
        prerequisites: ["pack_capstone_filler"],
        leaning: "sociability",
        // CAPSTONE. The whole point of a pack — mends and steadies a
        // herd-mate in one motion, not two separate errands.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.1, buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },

      // ============================================================
      // BRIDGE 1 — Aggression <-> Boldness: "the beat"
      // A cut placed exactly where it costs the target its own next
      // move. Every node on this bridge deepens `jamCooldownTicks` and
      // nothing else (principle 13).
      // ============================================================
      brutal_efficiency: {
        id: "brutal_efficiency",
        name: "Brutal Efficiency",
        cost: 1,
        prerequisites: ["honed_edge", "keen_eye"],
        leaning: "aggression",
        // CROSSLINK.
        delta: { jamCooldownTicks: 1 },
      },
      quick_reflexes: {
        id: "quick_reflexes",
        name: "Cut The Nerve",
        cost: 1,
        prerequisites: ["brutal_efficiency"],
        leaning: "aggression",
        // BRIDGE FILLER. This node was an Aggression "+10 Accuracy"
        // filler in v2 and was RELOCATED here rather than deleted —
        // Aggression was already at 13 branch nodes, one over the v4
        // standard, and Brutal Efficiency was a two-node spur with no
        // filler at all (one of the ten checker problems). It keeps its
        // accuracy and picks up the bridge's own lever, which is what
        // principle 13 requires of a bridge filler.
        delta: { jamCooldownTicks: 1, accuracy: 10 },
      },
      never_set_again: {
        id: "never_set_again",
        name: "Never Set Again",
        cost: 2,
        prerequisites: ["quick_reflexes"],
        leaning: "boldness",
        // BRIDGE NOTABLE. Escalates its own crosslink's lever a third
        // time rather than bolting on a generic stat: with three tiers
        // of jam on the same target's cooldowns, the thing being cut
        // never gets its guard back at all. Alternate route into BOTH
        // branches this crosslink connects (principle 11) — Aggression's
        // The Line Shows Itself and Boldness's The Long Moment, one lane
        // notable each — and it lands one step short of every fork
        // rather than on one (principle 12).
        delta: { jamCooldownTicks: 2 },
      },

      // ============================================================
      // BRIDGE 2 — Boldness <-> Sociability: "two pairs of eyes"
      // Watching each other's blind spots means both of you see the gap
      // sooner. Every node deepens `defensePenetration`.
      // ============================================================
      watchful_pack: {
        id: "watchful_pack",
        name: "Watchful Pack",
        cost: 1,
        prerequisites: ["keen_eye", "shared_scent"],
        leaning: "boldness",
        // CROSSLINK. Kept its v2 `defenseBoost` passive — a real
        // Defense-stat buff rather than `damageReduction`, deliberately,
        // since "watchful" is not an armour fiction and `defenseBoost`
        // is physical-only where `damageReduction` blunts everything
        // indiscriminately. The delta was `{}` in v2, which left the
        // bridge with no lever for its filler to share; it now carries
        // the seam-finding half the name always implied.
        grantsPassive: { kind: "defenseBoost", value: 0.5 },
        delta: { defensePenetration: 0.1 },
      },
      second_pair_of_eyes: {
        id: "second_pair_of_eyes",
        name: "Second Pair Of Eyes",
        cost: 1,
        prerequisites: ["watchful_pack"],
        leaning: "boldness",
        // BRIDGE FILLER, sharing its crosslink's own lever.
        delta: { defensePenetration: 0.1, accuracy: 10 },
      },
      the_opening_called: {
        id: "the_opening_called",
        name: "The Opening, Called",
        cost: 2,
        prerequisites: ["second_pair_of_eyes"],
        leaning: "sociability",
        // BRIDGE NOTABLE. The herd-mate watching the other side says
        // where the gap is out loud, so the cut goes straight into it.
        // Deepens the bridge's own lever a third time. Alternate route
        // into both branches it connects: Boldness's Measure and
        // Sociability's Coordinated Strike, one lane notable each, both
        // one step short of their fork.
        delta: { defensePenetration: 0.2 },
      },

      // ============================================================
      // BRIDGE 3 — Sociability <-> Aggression: "the named one"
      // The first cut names a target and the rest of the herd converges
      // on it. Every node deepens `rallyCall`.
      // ============================================================
      ambush_pack: {
        id: "ambush_pack",
        name: "Ambush Pack",
        cost: 1,
        prerequisites: ["shared_scent", "honed_edge"],
        leaning: "aggression",
        // CROSSLINK. Was `situationalBonus: flanking`, a fifth
        // co-takeable setter of an OVERWRITE field and a duplicate of
        // Opportunist's Strike's condition besides. `rallyCall` is what
        // the node's own name was always describing: a coordinated
        // ambush is other animals independently deciding to go for the
        // same throat, which is a qualitatively different payoff from a
        // number on the caster.
        delta: { rallyCall: { ticks: 45 } },
      },
      word_gets_around: {
        id: "word_gets_around",
        name: "Word Gets Around",
        cost: 1,
        prerequisites: ["ambush_pack"],
        leaning: "aggression",
        // BRIDGE FILLER, deepening its crosslink's own mark rather than
        // reaching for a new lever (principle 13). `rallyCall` is an
        // overwrite, so this is the same escalate-in-place shape
        // Earthquake's Marked Rupture already uses.
        delta: { rallyCall: { ticks: 70 } },
      },
      the_named_one: {
        id: "the_named_one",
        name: "The Named One",
        cost: 2,
        prerequisites: ["word_gets_around"],
        leaning: "sociability",
        // BRIDGE NOTABLE. The mark outlasts the fight that made it.
        // Alternate route into both branches this crosslink connects:
        // Aggression's Coup de Grace and Sociability's Dressed, Not
        // Torn, one lane notable each, both one step short of their
        // fork.
        delta: { rallyCall: { ticks: 110 } },
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
    // v4 (45 nodes, two lanes per branch, three real bridges). The fantasy,
    // written before any node was touched, and written AGAINST flamethrower
    // rather than in isolation:
    //
    //   Ember is the first fire a creature makes. Not a jet and not a beam —
    //   a mouthful of coals spat one tile, by a throat still learning the
    //   trick. Forty power: on its own it barely singes. What is dangerous
    //   about an ember is that it does not stop when it lands. It CATCHES —
    //   in the dry grass behind the target, in the bush the thing was hiding
    //   in, in the next bush over — and a dozen ticks later what is hurting
    //   you is the ground, not the creature that spat at you. The same coal
    //   is also a hearth: the thing a herd sleeps around. Fire has no
    //   allegiance, and the creature that threw it is standing in the same
    //   dry grass.
    //
    // Flamethrower is one held breath aimed at one thing, and it is over
    // when the breath runs out. Ember is one spark and no control over what
    // happens next. Every branch below answers that, and the two lanes
    // inside each branch differ in KIND, not degree:
    //
    //   Wildfire (aggression)   lane A = the catch (volume of sparks, how
    //                           hard what lands sticks) · lane B = when it
    //                           catches (reach, an already-burning target)
    //   Ring of Fire (boldness) lane A = the ring (how far it goes, who it
    //                           spares) · lane B = the middle (keeping the
    //                           inside of it yours)
    //   Hearthfire (soc.)       lane A = the hearth (warmth given away) ·
    //                           lane B = the watch (the fire as a signal)
    //
    // THREE SHIPPED BUGS FIXED HERE, each found by running the engine, not
    // by reading it:
    //
    // 1. `shape` does nothing without `hitsArea`. Measured against a real
    //    `tickWorld`: ring radius 1 with a body on each side of the caster
    //    dealt 13 to the primary and 0 to the second; with `hitsArea` added,
    //    13 and 13. The Boldness branch is NAMED for its footprint and had
    //    three `shape` nodes (`ring_of_fire`, `wide_ring`, and Aggression's
    //    `inferno`), none of which carried `hitsArea` — the whole branch's
    //    identity has never done anything. `ring_of_fire` now sets
    //    `hitsArea`, which is also what predation.ts's own `resolveAreaHit`
    //    comment already claims this move does ("a Growl/Ring-of-Fire-style
    //    blast").
    // 2. Which made `ring_of_fire` a PURE-DOWNSIDE opener (principle 4): it
    //    paid -10 power and +1 cooldown for a shape that did nothing.
    // 3. Ember was the ONLY tree in the roster carrying cost-3 nodes, and
    //    cost-3 was measured as unreachable outright (0 of 4 ever picked
    //    across a living population; 2 of 4 after `SKILLPOINT_SAVE_CHANCE`).
    //    All four are fork tips — the branch's actual decision. Flattened to
    //    2, the roster's own ceiling.
    //
    // The tree has exactly ONE `shape` lineage (boldness), one `range`
    // setter, one `hits` setter, one `forcedMovement` setter, one
    // `rallyCall`, one `consumesOwnTerrain`, one `statusSeverity`, one
    // `positionSwap` lineage and one `situationalBonus` — every OVERWRITE
    // field in `applyMoveTree` has a single owner, so no build pays a point
    // for a node another node silently overwrites.
    //
    // Ignition, measured per landed `terrainBurn` hit against real fuel
    // densities from `createDemoWorld` (3 seeds): desert 1.5% fuel -> 5% of
    // hits light something, badlands 2.0% -> 8%, grassland 6.7% -> 25%,
    // jungle 17% -> 57%. Ember's learners live in badlands/desert/grassland/
    // highland, so fire on the map is occasional and precious here, not
    // constant — which is why the fire the tree DOES start is worth
    // spending (see `take_up_the_coals`) rather than just admiring.
    //
    // Wild agents auto-respec into this via `maybeAutoRespec` (leveling.ts)
    // as they earn skill points, weighted by their own Disposition against
    // each node's `leaning` — see DESIGN.md's "Specialization" section.
    tree: {
      // ---------------------------------------------------------------
      // AGGRESSION — Wildfire: "you don't put it out, you outlive it."
      // ---------------------------------------------------------------
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
        delta: { statusChance: 0.15, terrainBurn: true },
      },
      // -- lane A: THE CATCH — how many sparks, and how hard what lands sticks.
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
        prerequisites: ["kindling"],
        leaning: "aggression",
        delta: { statusChance: 0.05 },
      },
      hot_coals: {
        id: "hot_coals",
        name: "Spit Coals",
        cost: 2,
        prerequisitesAnyOf: [["steady_flame"], ["white_heat"]],
        leaning: "aggression",
        // LANE NOTABLE. Was a bare "+5% status chance" filler wearing a
        // name. The lane's whole thesis is that an ember is a spark and
        // sparks come by the mouthful, so the notable is the tree's only
        // `hits` setter: one throw, one or two coals, each with its own
        // status roll and — because `terrainBurn` fires per landed hit —
        // its own chance to light the ground.
        delta: { hits: { min: 1, max: 2 }, statusChance: 0.05 },
      },
      roaring_blaze: {
        id: "roaring_blaze",
        name: "Roaring Blaze",
        cost: 1,
        prerequisites: ["hot_coals"],
        leaning: "aggression",
        delta: { power: 15, accuracy: -5 },
      },
      // -- lane B: WHEN IT CATCHES — reach, and a target already alight.
      in_through_the_coat: {
        id: "in_through_the_coat",
        name: "In Through the Coat",
        cost: 1,
        prerequisites: ["wider_burn"],
        leaning: "aggression",
        // A spark does not need to break a hide, it needs to get past one.
        delta: { defensePenetration: 0.2 },
      },
      fan_the_flames: {
        id: "fan_the_flames",
        name: "Fan the Flames",
        cost: 2,
        prerequisitesAnyOf: [["in_through_the_coat"], ["nothing_left_to_guard"]],
        leaning: "aggression",
        // LANE NOTABLE, and the tree's ONLY `situationalBonus` setter (an
        // OVERWRITE field). A target already burning takes double — the
        // fire doesn't have to start the job every time, just finish what
        // an earlier hit lit.
        delta: { situationalBonus: { condition: "targetBurning", multiplier: 2 } },
      },
      inferno: {
        id: "inferno",
        name: "Inferno",
        cost: 2,
        prerequisites: ["fan_the_flames"],
        excludes: ["wildfire_burst"],
        leaning: "aggression",
        // FORK SIDE — reach. Its `shape: line` was removed, not repurposed:
        // `resolveShape` is only ever consulted from `resolveAreaHit`, which
        // only runs when `hitsArea` is set, so the line was doing nothing
        // and the `range` bump was the whole node. Verified by running it,
        // not by reading it.
        delta: { range: { max: 2 }, statusChance: 0.1 },
      },
      wildfire_burst: {
        id: "wildfire_burst",
        name: "Wildfire Burst",
        cost: 2,
        prerequisites: ["fan_the_flames"],
        excludes: ["inferno"],
        leaning: "aggression",
        // FORK SIDE — intensity, against Inferno's reach. Its old
        // `shape: burst` + `hitsArea` moved to the branch that is named for
        // its footprint (see `ring_of_fire`): a tree gets one footprint, and
        // Boldness had three dead shape nodes while this one worked. What is
        // left is the node's actual sentence — you empty yourself into one
        // throw, it catches far more readily, and it costs real energy
        // (`selfCostPerUse`, a lever the colour-pie audit named as barely
        // appearing). Benefit and cost in the same node, per principle 4.
        delta: { statusChance: 0.2, selfCostPerUse: { need: "energy", amount: 0.06 } },
      },
      spreading_blaze: {
        id: "spreading_blaze",
        name: "Spreading Blaze",
        cost: 2,
        prerequisitesAnyOf: [["roaring_blaze"], ["inferno"], ["wildfire_burst"]],
        leaning: "aggression",
        // DEEP NOTABLE, where both lanes converge — and the right place for
        // it, since it is the moment the fire stops being yours: a burn this
        // fierce doesn't stay put, it catches on whatever is standing next
        // to the target.
        delta: { statusSpreads: true },
      },
      pyroclasm: {
        id: "pyroclasm",
        name: "Pyroclasm",
        cost: 1,
        prerequisites: ["spreading_blaze"],
        leaning: "aggression",
        // A blaze this size singes the caster too.
        delta: { power: 15, recoilFraction: 0.05 },
      },
      beat_at_the_flames: {
        id: "beat_at_the_flames",
        name: "Beat At the Flames",
        cost: 2,
        prerequisites: ["pyroclasm"],
        leaning: "aggression",
        // CAPSTONE, and deliberately not another damage number: a thing that
        // has just been set alight spends its next beats on the fire instead
        // of on you. `jamCooldownTicks` is additive in `applyMoveTree`
        // (moves.ts:773 — verified by running a full respec and reading the
        // result, not by trusting the field list), and it lands on the same
        // "landed, non-killing hit" hook the burn itself does. Paired with
        // Spreading Blaze one branch up, an ember build doesn't out-damage a
        // group, it stops the group acting.
        delta: { jamCooldownTicks: 2, statusChance: 0.05 },
      },
      // ---------------------------------------------------------------
      // BOLDNESS — Ring of Fire: "the safest place is inside it."
      // ---------------------------------------------------------------
      ring_of_fire: {
        id: "ring_of_fire",
        name: "Ring of Fire",
        cost: 1,
        leaning: "boldness",
        // `hitsArea` is new and it is a BUG FIX, not a buff for its own
        // sake: `shape` is read only by `resolveShape` inside
        // `resolveAreaHit`, which only runs for a `hitsArea` move, so this
        // opener has been charging -10 power and +1 cooldown for a ring that
        // never existed — a pure-downside node (principle 4) at the head of
        // the branch named after it. Measured with a body on each side of
        // the caster: 13/0 without `hitsArea`, 13/13 with it.
        delta: { shape: { kind: "ring", radius: 1 }, hitsArea: true, power: -10, cooldownTicks: 1 },
      },
      // -- lane A: THE RING — how far it reaches, and who it spares.
      banked_heat: {
        id: "banked_heat",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["ring_of_fire"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      slow_burn: {
        id: "slow_burn",
        name: "Slow Burn",
        cost: 1,
        prerequisites: ["banked_heat"],
        leaning: "boldness",
        // The tree's only `statusSeverity` setter — a ring that holds rather
        // than flares burns deeper into whatever it caught.
        delta: { statusSeverity: 1.5 },
      },
      wide_ring: {
        id: "wide_ring",
        name: "Fill the Circle",
        cost: 2,
        prerequisitesAnyOf: [["slow_burn"], ["nothing_left_to_guard"]],
        leaning: "boldness",
        // LANE NOTABLE. Was `shape: { kind: "ring", radius: 2 }` and it had
        // to change once `hitsArea` made shapes real, because `resolveShape`
        // builds a ring as a HOLLOW shell at exactly that Chebyshev radius —
        // measured on a real hit, a radius-2 ring did 9 damage to a body two
        // tiles out and 0 to the one standing next to the caster. Ember is
        // aimed at range 1, so a radius-2 shell is a footprint the move can
        // never fire into: the node would have been dead the moment it
        // started working. A `burst` is the filled form (13 tiles, manhattan
        // radius 2), which is the escalation the name always described —
        // the circle stops being an outline and becomes the whole floor.
        delta: { shape: { kind: "burst", radius: 2 } },
      },
      never_ours: {
        id: "never_ours",
        name: "Never Ours",
        cost: 1,
        prerequisites: ["wide_ring"],
        leaning: "boldness",
        // Replaces a "+10 Accuracy" filler on a 100-accuracy move —
        // `rollAccuracy` only ever spends surplus accuracy through
        // `stormAccuracyMultiplier` and the elevation multiplier, and a
        // storm is the weather that puts fires OUT, so that node was buying
        // the one condition this move least wants to fight in.
        //
        // What the branch actually needed once the ring became real: a ring
        // burns everything standing in it, herd included. `excludesAllies`
        // is consulted only inside `resolveAreaHit`, so it lives here, two
        // steps under the node that grants `hitsArea`, rather than in
        // Sociability where it would be dead for any build that skipped
        // this branch.
        delta: { excludesAllies: true },
      },
      // -- lane B: THE MIDDLE — keeping the inside of the ring yours.
      unquenchable: {
        id: "unquenchable",
        name: "Unquenchable",
        cost: 1,
        prerequisites: ["ring_of_fire"],
        leaning: "boldness",
        // The fire never really goes out.
        grantsPassive: { kind: "regen", value: 0.02 },
        delta: { cooldownTicks: -1 },
      },
      give_ground: {
        id: "give_ground",
        name: "Give Ground",
        cost: 2,
        prerequisitesAnyOf: [["unquenchable"], ["into_the_coals"]],
        leaning: "boldness",
        // LANE NOTABLE, and the tree's only `forcedMovement` setter. Nothing
        // stands in a fire on purpose: every body the ring touches is put a
        // tile further out. It is also a real cost on a range-1 move — the
        // thing you just shoved is now out of reach — which is the trade
        // this lane is about, holding the middle rather than chasing.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      lingering_ring: {
        id: "lingering_ring",
        name: "Lingering Ring",
        cost: 2,
        prerequisites: ["give_ground"],
        excludes: ["searing_wall"],
        leaning: "boldness",
        // FORK SIDE — plant. Was `cooldownTicks: 0`, which adds zero: a node
        // that provably did nothing half of. You set your feet and let the
        // circle come up around you, and you are committed to the spot for a
        // beat (`lockTicks`) while it does.
        delta: { lockTicks: 1, statusChance: 0.15 },
      },
      searing_wall: {
        id: "searing_wall",
        name: "Searing Wall",
        cost: 2,
        prerequisites: ["give_ground"],
        excludes: ["lingering_ring"],
        leaning: "boldness",
        // FORK SIDE — own the ground instead of holding it. Was a flat
        // `damageReduction: 0.1`, which is the lever MOVES_DESIGN.md has a
        // whole section asking us to stop reaching for ("Stop overusing
        // damageReduction"), and which stacks uncapped across every tree a
        // species knows. `fireproof` is the exact, bounded answer this node
        // was describing: `applyFireDamage` (fire.ts) clamps it at 1 and it
        // touches nothing but standing in a fire tile — which is precisely
        // what a creature inside its own ring is doing. Ember's own opener
        // is what puts those tiles on the map.
        grantsPassive: { kind: "fireproof", value: 0.5 },
        delta: { power: 5 },
      },
      take_up_the_coals: {
        id: "take_up_the_coals",
        name: "Take Up the Coals",
        cost: 2,
        prerequisitesAnyOf: [["never_ours"], ["lingering_ring"], ["searing_wall"]],
        leaning: "boldness",
        // DEEP NOTABLE, and the best node in the tree: the only move in the
        // roster whose own side effect is its own ammunition on the ground.
        // `wider_burn` lights tiles; this reaches down into one the caster is
        // standing in and throws it. Measured on a real `tickWorld`: 13
        // damage off fire, 20 standing in it, and the tile goes "fire" ->
        // "floor" (predation.ts's `consumesOwnTerrain`).
        //
        // Water Gun's writeup records why Hydro Pump could not spend water
        // this way — consuming a tile deletes a resource the sim meters.
        // Fire is the one terrain where that objection does not apply:
        // `tickFires` was going to leave that tile as scorched "floor" in at
        // most FIRE_BURN_TICKS anyway. Spending it costs the map nothing it
        // was not already about to lose.
        delta: { consumesOwnTerrain: { terrain: "fire", damageMultiplier: 1.6 } },
      },
      ring_capstone_filler: {
        id: "ring_capstone_filler",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["take_up_the_coals"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      everlasting_ring: {
        id: "everlasting_ring",
        name: "Everlasting Ring",
        cost: 2,
        prerequisites: ["ring_capstone_filler"],
        leaning: "boldness",
        // CAPSTONE. Even the water and stone this fire usually can't touch
        // don't fully shrug it off anymore.
        delta: { resistanceBreaker: { multiplier: 1.4 } },
      },
      // ---------------------------------------------------------------
      // SOCIABILITY — Hearthfire: "the only thing a herd sits still around."
      // ---------------------------------------------------------------
      shared_warmth: {
        id: "shared_warmth",
        name: "Shared Warmth",
        cost: 1,
        leaning: "sociability",
        // Shares a portion of its own fire's warmth to mend a hurting herd-mate.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.15 } },
      },
      // -- lane A: THE HEARTH — warmth given away.
      hearthside_calm: {
        id: "hearthside_calm",
        name: "Hearthside Calm",
        cost: 1,
        prerequisites: ["shared_warmth"],
        leaning: "sociability",
        // The second of the tree's three dead "+10 Accuracy" fillers, spent
        // on something the branch actually wanted: the warmth stops being
        // something you have to aim and becomes something everyone near the
        // fire gets every time it goes off (`allyEffectOnAttack`).
        delta: { allyEffectOnAttack: true },
      },
      banked_coals: {
        id: "banked_coals",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["hearthside_calm"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      kindled_spirits: {
        id: "kindled_spirits",
        name: "Kindled Spirits",
        cost: 2,
        prerequisitesAnyOf: [["banked_coals"], ["white_heat"]],
        leaning: "sociability",
        // LANE NOTABLE. Lights a spark in an ally's own fighting spirit.
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
      // -- lane B: THE WATCH — the fire as a signal, not as a gift.
      gentle_heat: {
        id: "gentle_heat",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["shared_warmth"],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      beacon_fire: {
        id: "beacon_fire",
        name: "Beacon Fire",
        cost: 2,
        prerequisitesAnyOf: [["gentle_heat"], ["into_the_coals"]],
        leaning: "sociability",
        // LANE NOTABLE, and the tree's only `rallyCall`. A fire is the one
        // thing every creature in a valley can see at once — a lit target is
        // a named one, and `preferMarked` (predation.ts) makes every
        // herd-mate's own, separately-run threat pick converge on it. That
        // is a different payoff in kind from lane A's giving: coordination
        // rather than warmth.
        delta: { rallyCall: { ticks: 20 } },
      },
      hearthkeeper: {
        id: "hearthkeeper",
        name: "Hearthkeeper",
        cost: 2,
        prerequisites: ["beacon_fire"],
        excludes: ["wildfire_call"],
        leaning: "sociability",
        // FORK SIDE — tend it. Tends the fire for everyone, at some cost to
        // its own offense.
        grantsPassive: { kind: "regenFlat", value: 1 },
        delta: { power: -5 },
      },
      wildfire_call: {
        id: "wildfire_call",
        name: "Wildfire Call",
        cost: 2,
        prerequisites: ["beacon_fire"],
        excludes: ["hearthkeeper"],
        leaning: "sociability",
        // FORK SIDE — perform it. Was a `statChangeOnHit` self-buff, which
        // collided with the Smouldering Ring bridge's own defender-side
        // `statChangeOnHit` (an OVERWRITE field, so a build with both paid
        // for one of them twice and got it once). The flame flares when the
        // herd is watching: +1 crit stage, which with the Kindled Fury
        // bridge's two brings a build to exactly `rollCritical`'s clamp of 3
        // — no further crit node exists in this tree, on purpose.
        delta: { power: 5, critRateStage: 1 },
      },
      eternal_flame: {
        id: "eternal_flame",
        name: "Eternal Flame",
        cost: 2,
        prerequisitesAnyOf: [["warm_hearth"], ["hearthkeeper"], ["wildfire_call"]],
        leaning: "sociability",
        // DEEP NOTABLE. A blaze that never really needs tending anymore — it
        // just keeps giving a little back, tick after tick.
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
        // CAPSTONE. Mends and inspires a herd-mate in the same breath, not
        // two separate uses.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.2, buff: { stat: "spAttack", stage: 1, ticks: 20 } } },
      },
      // ---------------------------------------------------------------
      // BRIDGES — crosslink -> filler deepening its own lever -> notable
      // that shortcuts into ONE lane notable of each branch it connects.
      // ---------------------------------------------------------------
      // Bridge 1: Aggression <-> Boldness — the heat that lingers on a body
      // long after the flame is out, and the one thing in this tree that
      // takes something away from the target rather than adding to the caster.
      smoldering_ring: {
        id: "smoldering_ring",
        name: "Smoldering Ring",
        cost: 1,
        prerequisites: ["wider_burn", "ring_of_fire"],
        leaning: "aggression",
        delta: { statChangeOnHit: { target: "defender", stat: "spDefense", stage: -1, ticks: 15 } },
      },
      scorched_ground: {
        id: "scorched_ground",
        name: "Scorched Ground",
        cost: 1,
        prerequisites: ["smoldering_ring"],
        leaning: "boldness",
        // Principle 13 — the bridge's filler deepens its own crosslink's
        // lever rather than grabbing a generic stat. Same debuff, twice as
        // deep, and it outlasts the fight.
        delta: { statChangeOnHit: { target: "defender", stat: "spDefense", stage: -2, ticks: 20 } },
      },
      nothing_left_to_guard: {
        id: "nothing_left_to_guard",
        name: "Nothing Left to Guard",
        cost: 2,
        prerequisites: ["scorched_ground"],
        leaning: "boldness",
        // BRIDGE NOTABLE — the same lever taken to its end, plus the reason
        // it matters: nothing that has been burning this long is still
        // holding a guard up. Shortcuts into Aggression's `fan_the_flames`
        // and Boldness's `wide_ring` (principle 11), one step short of
        // either branch's fork (principle 12).
        delta: { statChangeOnHit: { target: "defender", stat: "spDefense", stage: -3, ticks: 25 }, defensePenetration: 0.1 },
      },
      // Bridge 2: Boldness <-> Sociability — a fire kept low and shared burns
      // just as steady and is harder to knock over. Refined per feedback from
      // the v2 pass: a Defense-stat buff rather than flat `damageReduction`,
      // because "banked" (a fire kept smouldering, not raging) is toughness,
      // not hide or plating.
      banked_embers: {
        id: "banked_embers",
        name: "Banked Embers",
        cost: 1,
        prerequisites: ["ring_of_fire", "shared_warmth"],
        leaning: "boldness",
        // The delta is new. `positionSwap` swaps the ATTACKER and the
        // DEFENDER, not two allies (there is no ally-side form — Peck's
        // writeup rejected a node for assuming otherwise), and that is
        // exactly the sentence this node wanted: you take hold of the thing
        // standing over the banked fire and change places with it, so it is
        // the one in the coals.
        grantsPassive: { kind: "defenseBoost", value: 0.5 },
        delta: { positionSwap: true },
      },
      change_places: {
        id: "change_places",
        name: "Change Places",
        cost: 1,
        prerequisites: ["banked_embers"],
        leaning: "sociability",
        // Principle 13 — deepens its own crosslink's lever: the swap now
        // shoves what it swapped with a further tile, out past the ring's
        // edge (`positionSwapPull` is additive in `applyMoveTree`).
        delta: { positionSwap: true, positionSwapPull: 1 },
      },
      into_the_coals: {
        id: "into_the_coals",
        name: "Into the Coals",
        cost: 2,
        prerequisites: ["change_places"],
        leaning: "boldness",
        // BRIDGE NOTABLE — the same swap, one tile further, which on a build
        // that also took `wider_burn` means letting go of it in ground that
        // is already alight. Shortcuts into Boldness's `give_ground` and
        // Sociability's `beacon_fire`.
        delta: { positionSwap: true, positionSwapPull: 2 },
      },
      // Bridge 3: Sociability <-> Aggression — a spark shared between kin
      // burns hotter when it matters most.
      kindled_fury: {
        id: "kindled_fury",
        name: "Kindled Fury",
        cost: 1,
        prerequisites: ["shared_warmth", "wider_burn"],
        leaning: "aggression",
        delta: { critRateStage: 1 },
      },
      red_at_the_edges: {
        id: "red_at_the_edges",
        name: "Red at the Edges",
        cost: 1,
        prerequisites: ["kindled_fury"],
        leaning: "sociability",
        // Principle 13 — the crosslink's own lever, deeper. Two stages here
        // plus Wildfire Call's one is exactly `rollCritical`'s clamp of 3;
        // there is deliberately no fourth crit node anywhere in the tree.
        delta: { critRateStage: 1, statusChance: 0.05 },
      },
      white_heat: {
        id: "white_heat",
        name: "White Heat",
        cost: 2,
        prerequisites: ["red_at_the_edges"],
        leaning: "aggression",
        // BRIDGE NOTABLE — escalates the crit lever without adding a stage
        // that `rollCritical` would clamp away: when a spark catches
        // properly, the next one is already coming (`critCooldownReset`
        // zeroes this move's own cooldown on a crit). Shortcuts into
        // Aggression's `hot_coals` and Sociability's `kindled_spirits`.
        delta: { critCooldownReset: true, power: 5 },
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
    // --- Template v4 (45 nodes). THE FANTASY, written before any node:
    //
    // Peck is one hard point — a beak, a horn, a leek — driven into a single
    // spot with the whole body behind it. Wing Attack is surface area; Peck
    // is pressure. There is no wind-up and nothing to see coming: it happens
    // inside your guard, at arm's length, and it happens again a half-second
    // later in exactly the same place. What kills is not the size of the hole,
    // it is the repetition — the same puncture reopened until something under
    // it gives. What is dangerous *to the pecker* is where it has to stand to
    // do it: range 1, inside the reach of everything, nowhere to be but there.
    //
    // Its learners are not all birds, and that is the point: Goldeen and
    // Nidorino peck with a horn, Farfetch'd with a leek, Doduo with two heads
    // that never leave the ground. Peck is the POINT, not the wing — which is
    // exactly what keeps it out of `wing_attack`'s lane (gusts, scatter,
    // mobbing) even though the two share Spearow's sky.
    //
    // Aggression answers "where does the point land and what does the hole
    // become"; Boldness answers "range 1 is the flaw — rewrite the geometry,
    // or refuse to be moved off the spot"; Sociability answers "ten small
    // points in the same hole beat one big one, if they all pick the same
    // target". Keeps every v3 fork, relocated into a lane tail.
    tree: {
      // ============================================================
      // AGGRESSION — "The Same Hole"
      // Flavours: piercing (defensePenetration/resistanceBreaker/bonusVsType),
      // raw damage (hits/lifesteal/weightScaling), aggressive movement
      // (chargeAttack), environment (terrainBurn).
      // ============================================================
      needle_point: {
        id: "needle_point",
        name: "Needle Point",
        cost: 1,
        leaning: "aggression",
        delta: { power: 10 },
      },
      // --- Lane A: "Through the Guard" — severity. One point, past whatever
      // is in the way: armour first, then the type chart.
      beak_sharpening: {
        id: "beak_sharpening",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["needle_point"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      rapid_pecking: {
        id: "rapid_pecking",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["beak_sharpening"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      skybreaker: {
        id: "skybreaker",
        name: "Skybreaker",
        cost: 2,
        // Lane A's notable, reachable either by walking the lane or off the
        // Ambush Strike bridge (principle 12 — the bridge saves the grind,
        // never the fork).
        prerequisitesAnyOf: [["rapid_pecking"], ["never_recovers"]],
        leaning: "aggression",
        // Flying beats Grass — a real answer to the roster's own
        // Bulbasaur/Venusaur line.
        delta: { bonusVsType: { type: "grass", multiplier: 1.5 } },
      },
      stone_seeker: {
        id: "stone_seeker",
        name: "Stone-Seeker",
        cost: 1,
        prerequisites: ["skybreaker"],
        leaning: "aggression",
        // The lane's own logic, finished: Peck is Flying, so Rock and Steel
        // and Electric all shrug it off. A point does not answer that with
        // mass — it answers it by going for the seam instead of the plate,
        // which costs real force (`power: -5`) for the angle.
        delta: { resistanceBreaker: { multiplier: 1.5 }, power: -5 },
      },
      // --- Lane B: "Again, Same Spot" — rate. The point returns before the
      // wound closes. Differs from Lane A in KIND: volume, not severity.
      sharp_strike_footing: {
        id: "sharp_strike_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["needle_point"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      frenzied_pecking: {
        id: "frenzied_pecking",
        name: "Frenzied Pecking",
        cost: 2,
        prerequisitesAnyOf: [["sharp_strike_footing"], ["cornered_beak"]],
        leaning: "aggression",
        delta: { hits: { min: 2, max: 2 } },
      },
      // The v3 fork, preserved verbatim and relocated to this lane's tail:
      // one jab that goes deeper, or a third jab that does not.
      piercing_beak: {
        id: "piercing_beak",
        name: "Piercing Beak",
        cost: 1,
        prerequisites: ["frenzied_pecking"],
        excludes: ["rapid_volley"],
        leaning: "aggression",
        delta: { defensePenetration: 0.3 },
      },
      rapid_volley: {
        id: "rapid_volley",
        name: "Rapid Volley",
        cost: 1,
        prerequisites: ["frenzied_pecking"],
        excludes: ["piercing_beak"],
        leaning: "aggression",
        delta: { hits: { min: 3, max: 3 }, power: -10 },
      },
      talon_strike: {
        id: "talon_strike",
        name: "Talon Strike",
        cost: 2,
        // Deep notable: both lanes end here — Lane A's tail and both tips of
        // Lane B's fork.
        prerequisitesAnyOf: [["stone_seeker"], ["piercing_beak"], ["rapid_volley"]],
        leaning: "aggression",
        // v3 had this as `situationalBonus: targetLowHp`, which was one of
        // THREE co-takeable `situationalBonus` setters in the tree — an
        // overwrite field, so two of the three were silently dead on any build
        // that took them together. The tree now carries exactly one
        // (`swooping_approach`), and this node became the thing the branch was
        // missing instead: the convergence where opening a hole finally means
        // FEEDING through it. The talons plant, the whole body's mass goes in
        // behind the point (`weightScaling`, the fantasy's own sentence), and
        // the beak takes a piece back out.
        delta: { weightScaling: { factor: 0.1 }, lifestealFraction: 0.12 },
      },
      keen_eye: {
        id: "keen_eye",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["talon_strike"],
        leaning: "aggression",
        // Same +5 Accuracy it always was, plus the lever its own name was
        // already promising: what a hunting bird's eye is FOR is finding the
        // thing in the undergrowth, and `terrainBurn` strips that bush tile's
        // concealment for good on a landed hit.
        delta: { accuracy: 5, terrainBurn: true },
      },
      set_the_point: {
        id: "set_the_point",
        name: "Set the Point",
        cost: 2,
        prerequisites: ["keen_eye"],
        leaning: "aggression",
        // Capstone, and the one moment a Peck ever holds still. Peck's real
        // weakness is its range — everything in this branch has to be bought
        // standing on top of the target. `chargeAttack` is the only primitive
        // in the engine that answers that directly: one tick fixed on a spot
        // (invulnerable, unable to act), then three tiles crossed in the leap
        // and the whole stored commitment driven home. A genuine risk, not a
        // guaranteed payoff — if the target is gone when it releases, the
        // whole thing fizzles. Second user of `chargeAttack` in the roster.
        delta: { chargeAttack: { ticks: 1, bonusPower: 30, leapTiles: 3 } },
      },

      // ============================================================
      // BOLDNESS — "Where You Have To Stand"
      // Peck's flaw IS its range. This branch answers it two ways that are
      // not degrees of each other: Lane A changes the geometry so point-blank
      // stops being point-blank; Lane B accepts point-blank and makes staying
      // there survivable.
      // Flavours: stealth/ambush, wider aoe (shape), aggressive movement
      // (lockTicks/forcedMovement), raw damage, reposition others.
      // ============================================================
      swooping_approach: {
        id: "swooping_approach",
        name: "Swooping Approach",
        cost: 1,
        leaning: "boldness",
        // The tree's ONLY `situationalBonus` — see `talon_strike`'s comment.
        delta: { situationalBonus: { condition: "elevation", multiplier: 1.3 } },
      },
      // --- Lane A: "Longer Reach" — stop having to stand there at all.
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
        name: "+5 Accuracy, -1 Cooldown",
        cost: 1,
        prerequisites: ["wing_conditioning"],
        leaning: "boldness",
        delta: { accuracy: 5, cooldownTicks: -1 },
      },
      extended_wingspan: {
        id: "extended_wingspan",
        name: "Extended Wingspan",
        cost: 2,
        prerequisitesAnyOf: [["dive_strike_footing"], ["never_recovers"]],
        leaning: "boldness",
        // Peck actually gains reach for the first time — a 2-tile line
        // instead of a point-blank stab. The tree's only shape setter.
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
      // --- Lane B: "Nowhere To Go" — do not fix the range. Fix what happens
      // when something is already on top of you.
      braced_stance: {
        id: "braced_stance",
        name: "Braced Stance",
        cost: 1,
        prerequisites: ["swooping_approach"],
        leaning: "boldness",
        // The whole body behind the point means the body is committed too:
        // planted feet drive the point straighter past whatever it lands on,
        // and you are a beat late recovering from it (`lockTicks` locks the
        // USER, not the target — moves.ts's own doc comment). Benefit and
        // cost in the same node, per principle 4.
        delta: { defensePenetration: 0.12, lockTicks: 1 },
      },
      relentless_harrier: {
        id: "relentless_harrier",
        name: "Relentless Harrier",
        cost: 2,
        prerequisitesAnyOf: [["braced_stance"], ["they_come_with_you"]],
        leaning: "boldness",
        // A real crit-fisher spec — when the point lands one, it is ready to
        // go again immediately instead of just hitting harder, which is what
        // "nowhere to go" needs: you never get to step back and reset.
        delta: { power: 10, critRateStage: 1, critCooldownReset: true },
      },
      // The v3 fork, preserved, relocated to this lane's tail. Rebuilt off
      // `situationalBonus` (see `talon_strike`) into the choice this lane was
      // actually asking: commit everything and wear it, or stay light and
      // just never miss.
      ambush_dive: {
        id: "ambush_dive",
        name: "All-In Dive",
        cost: 1,
        prerequisites: ["relentless_harrier"],
        excludes: ["harrying_wings"],
        leaning: "boldness",
        delta: { power: 5, critRateStage: 1, recoilFraction: 0.08 },
      },
      harrying_wings: {
        id: "harrying_wings",
        name: "Harrying Wings",
        cost: 1,
        prerequisites: ["relentless_harrier"],
        excludes: ["ambush_dive"],
        leaning: "boldness",
        delta: { power: -5, accuracy: 10 },
      },
      nowhere_to_run: {
        id: "nowhere_to_run",
        name: "Nowhere to Run",
        cost: 2,
        prerequisitesAnyOf: [["wing_precision"], ["ambush_dive"], ["harrying_wings"]],
        leaning: "boldness",
        // Deep notable, and the deliberate inversion of `wing_attack`: that
        // move's whole positional identity is scattering things AWAY on a
        // landed hit. A point weapon wants the opposite — the beak hooks and
        // the target comes one tile IN, back onto the spot the next jab is
        // already aimed at. Whichever lane got here, it stops the target
        // leaving: the reach lane can no longer be walked out of, and the
        // braced lane no longer has to chase.
        delta: { forcedMovement: { mover: "defender", direction: "closer", tiles: 1, timing: "onHit" } },
      },
      diving_precision: {
        id: "diving_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["nowhere_to_run"],
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

      // ============================================================
      // SOCIABILITY — "Ten Beaks, One Hole"
      // A flock of small point-weapons is not a bigger weapon; it is the same
      // weapon used ten times in the same second on the same target. This
      // branch is about FOCUS, not healing.
      // Flavours: ally buffing, rallying, healing, defence, piercing,
      // planted/duration.
      // ============================================================
      flock_call: {
        id: "flock_call",
        name: "Flock Call",
        cost: 1,
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      // --- Lane A: "Everyone On That One" — the mark. This lane changes what
      // OTHER agents independently decide to attack, which is a different
      // kind of thing from Lane B's provisioning, not a bigger version of it.
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
        prerequisites: ["flock_footing"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      mark_the_soft_spot: {
        id: "mark_the_soft_spot",
        name: "Mark the Soft Spot",
        cost: 2,
        prerequisitesAnyOf: [["flock_call_footing"], ["they_come_with_you"]],
        leaning: "sociability",
        // The branch's actual thesis, which v3 never built: a flock's edge is
        // that all of it picks the SAME target. `rallyCall` marks the thing
        // this beak just found the soft spot on, and every nearby flock-mate's
        // own separately-run threat pick lands on it too.
        delta: { rallyCall: { ticks: 15 } },
      },
      flock_instinct: {
        id: "flock_instinct",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["mark_the_soft_spot"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      // --- Lane B: "Keep the Flock Standing" — provisioning and cover.
      flock_synergy: {
        id: "flock_synergy",
        name: "+5 Power, -1 Cooldown",
        cost: 1,
        prerequisites: ["flock_call"],
        leaning: "sociability",
        delta: { power: 5, cooldownTicks: -1 },
      },
      wingmate_cover: {
        id: "wingmate_cover",
        name: "Wingmate Cover",
        cost: 2,
        prerequisitesAnyOf: [["flock_synergy"], ["cornered_beak"]],
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      // The v3 fork, preserved verbatim on this lane's tail.
      screening_wings: {
        id: "screening_wings",
        name: "Screening Wings",
        cost: 1,
        prerequisites: ["wingmate_cover"],
        excludes: ["harriers_charge"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      harriers_charge: {
        id: "harriers_charge",
        name: "Harrier's Charge",
        cost: 1,
        prerequisites: ["wingmate_cover"],
        excludes: ["screening_wings"],
        leaning: "sociability",
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      preening_recovery: {
        id: "preening_recovery",
        name: "Preening Recovery",
        cost: 2,
        prerequisitesAnyOf: [["flock_instinct"], ["screening_wings"], ["harriers_charge"]],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.03 },
        // Deep notable. v3 left this a bare passive with an empty delta; it
        // now also deepens the ally-effect the branch has been building
        // (restating Wingmate Cover's defense buff so the overwrite loses
        // nothing, and adding the heal), which is what "preening" is: the
        // flock putting each other back in order between fights.
        delta: { allyEffect: { healFraction: 0.08, buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      shake_the_branch: {
        id: "shake_the_branch",
        name: "Shake the Branch",
        cost: 1,
        prerequisites: ["preening_recovery"],
        leaning: "sociability",
        // The one node in the tree that feeds instead of fights, and the
        // reason it is reachable rather than decorative: needs.ts's
        // canopy-harvest path processes a canopy-native crop with an
        // off-cooldown damage move (`CANOPY_HARVEST_MOVE_BASE_BURST` +
        // `gatherBurst`), Apple is canopy-native and forest-eligible
        // (crops.ts), and Spearow/Fearow live in `homeLayer: "canopy"` over
        // forest. A flock working an apple branch with its beaks.
        delta: { gatherBurst: 3, accuracy: 5 },
      },
      harrying_flock: {
        id: "harrying_flock",
        name: "Harrying Flock",
        cost: 2,
        prerequisites: ["shake_the_branch"],
        leaning: "sociability",
        // A crowd-control capstone — slows prey down, instead of a heal. The
        // tree's only `statChangeOnHit`.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -1, ticks: 20 } },
      },

      // ============================================================
      // BRIDGES — three, each crosslink -> filler deepening its own lever ->
      // notable that is an alternate route into ONE lane per branch it
      // connects (principles 7, 11, 12, 13).
      // ============================================================
      // Bridge 1: Aggression <-> Boldness. A coordinated snatch that throws
      // off the target's own rhythm. `jamCooldownTicks` is ADDITIVE in
      // `applyMoveTree` (verified by running it, not by reading the field
      // list), so this bridge stacks +1/+1/+2 to four ticks of jam — the
      // roster's deepest, and the reason the bridge exists. It lands in the
      // two SEVERITY-and-REACH lanes, the two with no tempo of their own: a
      // bridge complements its landing lane rather than deepening a rut.
      ambush_strike: {
        id: "ambush_strike",
        name: "Ambush Strike",
        cost: 1,
        prerequisites: ["needle_point", "swooping_approach"],
        leaning: "aggression",
        delta: { jamCooldownTicks: 1 },
      },
      broken_rhythm: {
        id: "broken_rhythm",
        name: "Broken Rhythm",
        cost: 1,
        prerequisites: ["ambush_strike"],
        leaning: "aggression",
        delta: { jamCooldownTicks: 1, accuracy: 5 },
      },
      never_recovers: {
        id: "never_recovers",
        name: "Never Recovers",
        cost: 2,
        prerequisites: ["broken_rhythm"],
        leaning: "aggression",
        // The bridge's own payoff, deepening its own lever rather than
        // grabbing a generic stat: four ticks in total added to everything the
        // target already has winding down. It stops being a jab that
        // interrupts and starts being a jab it never gets out from under.
        delta: { jamCooldownTicks: 2 },
      },
      // Bridge 2: Boldness <-> Sociability. A braced dive shares its own
      // cover with the flock. The crosslink's lever IS the flat mitigation,
      // so the bridge filler deepens exactly that (principle 13) — and the
      // 1.0 the crosslink used to grant alone is now split across the two,
      // so the tree's passive budget is unchanged (see passive-exposure.ts).
      cover_call: {
        id: "cover_call",
        name: "Cover Call",
        cost: 1,
        prerequisites: ["swooping_approach", "flock_call"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 0.5 },
        delta: {},
      },
      spread_wing: {
        id: "spread_wing",
        name: "Spread Wing",
        cost: 1,
        prerequisites: ["cover_call"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 0.5 },
        delta: {},
      },
      they_come_with_you: {
        id: "they_come_with_you",
        name: "They Come With You",
        cost: 2,
        prerequisites: ["spread_wing"],
        leaning: "sociability",
        // Cover stops being something you hand out on an idle tick and starts
        // being automatic: every hostile Peck now also fires the flock-buff on
        // the nearest hurt flock-mate (`allyEffectOnAttack`, support.ts's
        // `nearestAllyEffectTarget`). Guaranteed to have something to fire —
        // Flock Call is this bridge's own prerequisite.
        delta: { allyEffectOnAttack: true },
      },
      // Bridge 3: Sociability <-> Aggression. A cornered flock-mate fights
      // harder — `selfStateBonus` escalating 1.3 -> 1.5 -> 1.8, the same
      // overwrite discipline as Bridge 1. Lands on the two VOLUME lanes.
      war_cry: {
        id: "war_cry",
        name: "War Cry",
        cost: 1,
        prerequisites: ["flock_call", "needle_point"],
        leaning: "sociability",
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.3 } },
      },
      last_of_the_flock: {
        id: "last_of_the_flock",
        name: "Last of the Flock",
        cost: 1,
        prerequisites: ["war_cry"],
        leaning: "sociability",
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.5 }, accuracy: 5 },
      },
      cornered_beak: {
        id: "cornered_beak",
        name: "Cornered Beak",
        cost: 2,
        prerequisites: ["last_of_the_flock"],
        leaning: "sociability",
        // `selfStateBonus` biases `pickBestMove`'s SCORING, not damage
        // (moves.ts's own doc comment) — so what this actually buys is a
        // half-dead bird that reaches for the beak instead of fleeing, and a
        // point sharp enough past armour to make that the right call.
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.8 }, defensePenetration: 0.15 },
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
    // --- The fantasy (v4 rewrite, MOVES_DESIGN.md's "start from the
    // fantasy") ---
    //
    // Scratch is four claws and no technique. There is no wind-up and
    // nothing to see coming — the paw is already moving. What separates a
    // rake from a blow is that a blow is finished the moment it lands and a
    // rake is not: it opens the skin and leaves the wound to do the rest of
    // the work, hours later, somewhere else. Claws are filthy by design, and
    // whatever was under them yesterday goes in today. And claws were tools
    // long before they were weapons — the same four hooks that open a belly
    // hook into bark, into a fleeing leg, into the dirt of a den, and score
    // a line across a tree that every animal in the valley can read without
    // a single fight happening.
    //
    // Deliberately NOT Tackle. Tackle is mass arriving and it is over when
    // it stops; Scratch is an edge opening something and it LEAVES THINGS
    // BEHIND — a septic wound, a shredded bush, a churned furrow, a claw
    // mark on a tree. `weightScaling` and `chargeAttack` are Tackle's and
    // Body Slam's answers and are deliberately absent here: a claw has no
    // wind-up and does not care what it weighs.
    //
    // Aggression — "Nothing Stays Closed": the predator's use of a claw.
    //   Lane A is FILTH (the wound outlives the fight); lane B is THE SEAM
    //   (one opening, through whatever is in the way). Different in kind:
    //   attrition versus precision. Flavours: raw damage, piercing,
    //   stealth/ambush, environment.
    // Boldness — "The Hook": commitment, not armour. Lane A is DUG IN
    //   (hooked into the ground, refusing to be moved); lane B is WHERE THE
    //   FIGHT HAPPENS (a lunge that decides the tile). Different in kind:
    //   holding a position versus choosing one. Flavours: stealth/ambush,
    //   defence, aggressive movement, environment.
    // Sociability — "The Mark": claws are how a colony talks. Lane A is THE
    //   CALL (a raked flank is a name shouted); lane B is THE BOUNDARY (a
    //   scored tree is a fight that never happens). Different in kind:
    //   directing attention versus removing the reason to fight. Flavours:
    //   rallying, ally buffing, calming, healing, wider AoE, no friendly
    //   fire.
    //
    // Template v4: 45 nodes — three 12-node branches (opener, two parallel
    // lanes each with their own notable, a deep notable both lanes converge
    // on, a filler, a capstone) plus three 3-node crosslink bridges. Nine
    // `prerequisitesAnyOf` (six lane notables, three deep notables), six
    // fork nodes — every v2 fork preserved.
    tree: {
      // --- Aggression: "Nothing Stays Closed" ---
      envenomed: {
        id: "envenomed",
        name: "Envenomed",
        cost: 1,
        leaning: "aggression",
        delta: { statusChance: 0.15 },
      },
      // Lane A — filth: what goes in with the claw, and where it goes next.
      venom_glands: {
        id: "venom_glands",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["envenomed"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      deepening_venom: {
        id: "deepening_venom",
        name: "Deepening Venom",
        cost: 1,
        prerequisites: ["venom_glands"],
        leaning: "aggression",
        delta: { statusChance: 0.1 },
      },
      toxic_spread: {
        id: "toxic_spread",
        name: "Toxic Spread",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Sociability <->
        // Aggression bridge's own notable (Feed the Den).
        prerequisitesAnyOf: [["deepening_venom"], ["feed_the_den"]],
        leaning: "aggression",
        // The lane's whole point: the wound is the weapon, not the claw. It
        // goes bad, and it goes around — whoever crowds in around the
        // wounded one gets it too (status.ts's `maybeSpreadStatus`, generic
        // over `StatusKind`, so this really is the poison spreading).
        delta: { statusSpreads: true },
      },
      torn_tendon: {
        id: "torn_tendon",
        name: "Torn Tendon",
        cost: 1,
        prerequisites: ["toxic_spread"],
        leaning: "aggression",
        // A raked leg cannot wind up again. Adds ticks to whatever the
        // defender already has recovering, rather than a fresh lockout.
        delta: { jamCooldownTicks: 1, accuracy: 5 },
      },
      // Lane B — the seam: one opening, through whatever is in the way.
      envenomed_footing: {
        id: "envenomed_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["envenomed"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      find_the_gap: {
        id: "find_the_gap",
        name: "Find the Gap",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Aggression <->
        // Boldness bridge's own notable (Opened From Behind).
        prerequisitesAnyOf: [["envenomed_footing"], ["opened_from_behind"]],
        leaning: "aggression",
        // What a claw answers that a fist does not: it goes BETWEEN things.
        // A scaled or shelled body is still full of seams, so a matchup the
        // type chart resists comes back toward neutral.
        delta: { defensePenetration: 0.15, resistanceBreaker: { multiplier: 1.5 } },
      },
      toxin_overload: {
        id: "toxin_overload",
        name: "Toxin Overload",
        cost: 1,
        prerequisites: ["find_the_gap"],
        excludes: ["widening_fangs"],
        leaning: "aggression",
        // Hits harder finishing off something already statused.
        delta: { situationalBonus: { condition: "targetStatused", multiplier: 1.4 } },
      },
      widening_fangs: {
        id: "widening_fangs",
        name: "Widening Fangs",
        cost: 1,
        prerequisites: ["find_the_gap"],
        excludes: ["toxin_overload"],
        leaning: "aggression",
        // Trades away some of the earned chance to poison for whatever
        // poison does land hitting twice as hard.
        delta: { power: 10, statusChance: -0.1, statusSeverity: 2 },
      },
      no_cover_left: {
        id: "no_cover_left",
        name: "No Cover Left",
        cost: 2,
        // DEEP NOTABLE. Both lanes end here: filth and the seam add up to a
        // target that can neither close the wound nor get out of sight.
        prerequisitesAnyOf: [["torn_tendon"], ["toxin_overload"], ["widening_fangs"]],
        leaning: "aggression",
        // The rake goes through the bush the target ducked into and takes it
        // with it — `terrainBurn` reverts that "bush" tile to plain floor
        // for good (predation.ts's landed-hit hook), stripping the
        // concealment the `"concealed"` bonus one branch over is built on.
        // Something an observer can SEE happen, unlike another +5 power.
        delta: { terrainBurn: true },
      },
      claw_conditioning: {
        id: "claw_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["no_cover_left"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      everything_festers: {
        id: "everything_festers",
        name: "Everything Festers",
        cost: 2,
        prerequisites: ["claw_conditioning"],
        leaning: "aggression",
        // CAPSTONE. The branch's thesis at full volume: the claw stops being
        // the weapon entirely. Nearly every rake takes, and what it leaves
        // burns three times as fast — and with Toxic Spread already taken,
        // one hit is an outbreak rather than a wound.
        delta: { statusChance: 0.35, statusSeverity: 3 },
      },
      // --- Boldness: "The Hook" ---
      ambush_claws: {
        id: "ambush_claws",
        name: "Ambush Claws",
        cost: 1,
        leaning: "boldness",
        delta: { situationalBonus: { condition: "concealed", multiplier: 1.3 } },
      },
      // Lane A — dug in: hooked into the ground, and not letting go.
      braced_paws: {
        id: "braced_paws",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["ambush_claws"],
        leaning: "boldness",
        // No wind-up is the whole point of a claw: the paw is already back.
        delta: { cooldownTicks: -1 },
      },
      burrow_guard: {
        id: "burrow_guard",
        name: "Burrow Guard",
        cost: 1,
        prerequisites: ["braced_paws"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.08 },
        delta: {},
      },
      wont_let_go: {
        id: "wont_let_go",
        name: "Won't Let Go",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Aggression <->
        // Boldness bridge's own notable (Opened From Behind).
        prerequisitesAnyOf: [["burrow_guard"], ["opened_from_behind"]],
        leaning: "boldness",
        // Claws sink in and stay in. A real beat of committed downtime
        // (`lockTicks` locks the USER, not the target — predation.ts) bought
        // by a much heavier hit, benefit and cost in the same node.
        delta: { lockTicks: 1, power: 12 },
      },
      spiked_curl: {
        id: "spiked_curl",
        name: "Spiked Curl",
        cost: 1,
        prerequisites: ["wont_let_go"],
        leaning: "boldness",
        // Sandshrew's own real spiked hide, curled up defensively.
        grantsPassive: { kind: "thorns", value: 0.15 },
        delta: {},
      },
      // Lane B — where the fight happens: the claw decides the tile.
      burrow_conditioning: {
        id: "burrow_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["ambush_claws"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      dig_and_strike: {
        id: "dig_and_strike",
        name: "Dig-and-Strike",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Boldness <->
        // Sociability bridge's own notable (Shouldered Aside).
        prerequisitesAnyOf: [["burrow_conditioning"], ["shouldered_aside"]],
        leaning: "boldness",
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 2, timing: "beforeHit" } },
      },
      retreating_slash: {
        id: "retreating_slash",
        name: "Retreating Slash",
        cost: 1,
        prerequisites: ["dig_and_strike"],
        excludes: ["cornered_fury"],
        leaning: "boldness",
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 2, timing: "onHit" } },
      },
      cornered_fury: {
        id: "cornered_fury",
        name: "Cornered Fury",
        cost: 1,
        prerequisites: ["dig_and_strike"],
        excludes: ["retreating_slash"],
        leaning: "boldness",
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.3 } },
      },
      churned_ground: {
        id: "churned_ground",
        name: "Churned Ground",
        cost: 2,
        // DEEP NOTABLE. Both lanes end here: holding a tile and choosing a
        // tile are the same skill once the ground itself is the weapon.
        prerequisitesAnyOf: [["spiked_curl"], ["retreating_slash"], ["cornered_fury"]],
        leaning: "boldness",
        // The claws tear the floor out from under whatever they hit — a
        // landed hit converts the defender's floor/sand tile to real "mud"
        // (predation.ts's `TERRAIN_FILLABLE`), and mud is a 0.5x speed
        // multiplier for anything that steps on it afterwards
        // (support.ts's `terrainSpeedMultiplier`). A permanent, visible
        // furrow, not a hidden slow counter.
        delta: { terrainFill: { terrain: "mud" } },
      },
      raked_furrows: {
        id: "raked_furrows",
        name: "+8 Accuracy",
        cost: 1,
        prerequisites: ["churned_ground"],
        leaning: "boldness",
        delta: { accuracy: 8 },
      },
      purchase: {
        id: "purchase",
        name: "Purchase",
        cost: 2,
        prerequisites: ["raked_furrows"],
        leaning: "boldness",
        // CAPSTONE, and the pay-off for the branch's own deep notable rather
        // than a bigger number: standing in the bog it churned up itself,
        // the claws finally get something to brace against. Doubles the hit
        // and spends the tile (predation.ts's `consumesOwnTerrain`, checked
        // on the ATTACKER's tile before the damage formula). Rock Throw
        // consumes a boulder the world happened to put there; this is the
        // only node in the roster that eats terrain its own tree created —
        // and the cost is real and legible, because standing in mud halves
        // your own movement speed for as long as you stay there.
        delta: { consumesOwnTerrain: { terrain: "mud", damageMultiplier: 2 } },
      },
      // --- Sociability: "The Mark" ---
      colony_call: {
        id: "colony_call",
        name: "Colony Call",
        cost: 1,
        leaning: "sociability",
        // As well as a dedicated idle-tick support use, a landed hit ALSO
        // buffs a nearby colony-mate's attack for free.
        delta: { targetsAlly: true, allyEffectOnAttack: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      // Lane A — the call: a raked flank is a name shouted.
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
        prerequisites: ["den_footing"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      rally_the_colony: {
        id: "rally_the_colony",
        name: "Rally the Colony",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Boldness <->
        // Sociability bridge's own notable (Shouldered Aside).
        prerequisitesAnyOf: [["colony_bond_footing"], ["shouldered_aside"]],
        leaning: "sociability",
        // A landed, non-killing hit marks the predator for the whole colony
        // to converge on — genuinely stronger than buffing one ally, because
        // it changes what other agents independently decide to do.
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
      // Lane B — the boundary: a scored tree is a fight that never happens.
      worn_grooves: {
        id: "worn_grooves",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["colony_call"],
        leaning: "sociability",
        // The same four grooves, cut over and over into the same bark until
        // the motion costs nothing.
        delta: { cooldownTicks: -1 },
      },
      line_in_the_bark: {
        id: "line_in_the_bark",
        name: "Line in the Bark",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Sociability <->
        // Aggression bridge's own notable (Feed the Den).
        prerequisitesAnyOf: [["worn_grooves"], ["feed_the_den"]],
        leaning: "sociability",
        // The lane's thesis, and the one Sociability payoff that is measured
        // in fights that DON'T happen: a boundary everyone can read means
        // this one never starts a rivalry over a contested tile
        // (herdConflict.ts's `applyHerdRivalryConflict`, a flat opt-out —
        // a truthy flag, so it cannot stack into anything).
        grantsPassive: { kind: "nonTerritorial", value: 1 },
        delta: { accuracy: 5 },
      },
      colony_guard: {
        id: "colony_guard",
        name: "Colony Guard",
        cost: 1,
        prerequisites: ["line_in_the_bark"],
        excludes: ["tunnel_runner"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      tunnel_runner: {
        id: "tunnel_runner",
        name: "Tunnel Runner",
        cost: 1,
        prerequisites: ["line_in_the_bark"],
        excludes: ["colony_guard"],
        leaning: "sociability",
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      communal_foraging: {
        id: "communal_foraging",
        name: "Communal Foraging",
        cost: 2,
        // DEEP NOTABLE. Both lanes end here: a colony that answers a call
        // and doesn't fight over ground is a colony that eats.
        prerequisitesAnyOf: [["den_precision"], ["colony_guard"], ["tunnel_runner"]],
        leaning: "sociability",
        // Claws are a foraging tool before they are a weapon — this is the
        // node's own name finally meaning what it says. Extra
        // `digTicksAccrued` on the canopy-harvest path (needs.ts, which
        // picks the agent's first ready damage move to knock fruit down),
        // instead of the flat `regen` passive it used to hide behind. A
        // visible burst of food on the map beats a hidden meter, and it
        // takes this tree's stacked healing down with it.
        delta: { gatherBurst: 3 },
      },
      colony_warmth: {
        id: "colony_warmth",
        name: "Colony Warmth",
        cost: 2,
        prerequisites: ["communal_foraging"],
        leaning: "sociability",
        // The roster's only two-passive node — earned because this is the
        // one branch guaranteed to actually fire for real herd-mates today,
        // Diglett included.
        grantsPassives: [
          { kind: "healAura", value: 0.01 },
          { kind: "regen", value: 0.04 },
        ],
        delta: {},
      },
      never_your_own: {
        id: "never_your_own",
        name: "Never Your Own",
        cost: 2,
        prerequisites: ["colony_warmth"],
        leaning: "sociability",
        // CAPSTONE, and the only shape change in the tree (principle 14 —
        // a footprint change is notable-tier currency, spent once). The
        // whole point of a claw among kin is that it is a wild, unaimed
        // swipe; a colony animal that has spent its whole life scoring
        // boundaries with the same four claws can widen it into a three-tile
        // arc and STILL not touch a herd-mate standing in it
        // (`excludesAllies`, resolveAreaHit). Not "an AoE, but bigger" —
        // the roster's three `excludesAllies` moves were all AoE already;
        // this is a point move that learns to sweep without cutting kin.
        delta: { shape: { kind: "cone", length: 1, width: 1 }, hitsArea: true, excludesAllies: true },
      },
      // --- Bridges ---
      // Crosslink: Aggression <-> Boldness — the flank of something that has
      // not turned around yet is where the seams already are.
      frenzied_burrow: {
        id: "frenzied_burrow",
        name: "Frenzied Burrow",
        cost: 1,
        prerequisites: ["envenomed", "ambush_claws"],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.3 } },
      },
      wrong_side: {
        id: "wrong_side",
        name: "Wrong Side",
        cost: 1,
        prerequisites: ["frenzied_burrow"],
        leaning: "aggression",
        // Deepens Frenzied Burrow's own flanking bonus (overwrite — restates
        // the full multiplier, not an increment).
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.5 }, accuracy: 5 },
      },
      opened_from_behind: {
        id: "opened_from_behind",
        name: "Opened From Behind",
        cost: 2,
        prerequisites: ["wrong_side"],
        leaning: "boldness",
        // BRIDGE NOTABLE. Escalates its own crosslink's lever one more step
        // and adds the crit stage that a back turned actually deserves.
        // Lands one lane notable deep in each branch it connects — Find the
        // Gap (Aggression's seam lane) and Won't Let Go (Boldness's dug-in
        // lane) — complementing both rather than repeating either.
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.9 }, critRateStage: 1 },
      },
      // Crosslink: Boldness <-> Sociability — standing in the den's mouth.
      // Was a second flat `damageReductionFlat` node duplicating Colony
      // Guard's; MOVES_DESIGN.md's "Stop overusing damageReduction" and the
      // per-species passive totals both argue against it, and a claw hooked
      // into an intruder to swing it out of the doorway is the thing the
      // node was always describing.
      guarded_den: {
        id: "guarded_den",
        name: "Guarded Den",
        cost: 1,
        prerequisites: ["ambush_claws", "colony_call"],
        leaning: "boldness",
        delta: { positionSwap: true, power: 5 },
      },
      through_the_doorway: {
        id: "through_the_doorway",
        name: "Through the Doorway",
        cost: 1,
        prerequisites: ["guarded_den"],
        leaning: "boldness",
        // Deepens Guarded Den's own swap: it does not just trade places, it
        // keeps hauling.
        delta: { positionSwap: true, positionSwapPull: 1 },
      },
      shouldered_aside: {
        id: "shouldered_aside",
        name: "Shouldered Aside",
        cost: 2,
        prerequisites: ["through_the_doorway"],
        leaning: "sociability",
        // BRIDGE NOTABLE. One more tile of haul on the same swap. Lands on
        // Dig-and-Strike (Boldness's lunge lane) and Rally the Colony
        // (Sociability's call lane) — dragging a target out of the den mouth
        // and into the middle of the colony is both branches' business.
        delta: { positionSwap: true, positionSwapPull: 1, accuracy: 8 },
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
      red_teeth: {
        id: "red_teeth",
        name: "Red Teeth",
        cost: 1,
        prerequisites: ["colony_fury"],
        leaning: "sociability",
        // Deepens Colony Fury's own lifesteal (additive).
        delta: { lifestealFraction: 0.04, accuracy: 5 },
      },
      feed_the_den: {
        id: "feed_the_den",
        name: "Feed the Den",
        cost: 2,
        prerequisites: ["red_teeth"],
        leaning: "aggression",
        // BRIDGE NOTABLE. The same lever again, at the size that makes a
        // hunting party self-sufficient. Lands on Toxic Spread (Aggression's
        // filth lane) and Line in the Bark (Sociability's boundary lane).
        // 8/4/8 across the bridge tops out at 20% for a full 5-point walk —
        // above the roster's ~10% median, below vine_whip's 38% ceiling.
        delta: { lifestealFraction: 0.08 },
      },
    },
  },
  rock_throw: {
    id: "rock_throw",
    name: "Rock Throw",
    // Inert for this move, and worth knowing before anyone "improves" it:
    // `shape` is only ever read inside `resolveAreaHit` (predation.ts), which
    // `resolveHit` only calls when `hitsArea` is true. Rock Throw is not an
    // area move, so this line is display data, not mechanics. See the
    // Aggression fork's own comment for the dead cone this fact uncovered.
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
    //
    // --- THE FANTASY (v4 rewrite, MOVES_DESIGN.md's "start from the
    // fantasy") ---
    //
    // Rock Throw is the only move in the roster that spends something it did
    // not make. The boulder under Onix's tail is real terrain — measured at
    // 64-189 tiles of a 5,400-tile surface across three seeds, 1.2-3.5%, laid
    // down at worldgen and never replaced by anything in the sim — and the
    // throw EATS it: the tile drops to bare floor, the sight-block it gave is
    // gone, the little rise it stood on is gone, and something up to three
    // tiles away takes a rock at triple damage. Rock Slide is a hillside
    // letting go and Earthquake is the ground itself; this is ONE rock, found
    // on the ground, aimed, and gone. Everything dangerous about it is a
    // supply question — is there a rock under you right now, is this target
    // worth the last one, and what does the ground look like once you have
    // thrown them all. It is also the reach a lumbering body would not
    // otherwise have (the v3 identity, kept): three tiles of it, with no
    // accuracy falloff and a 90% roll that a lane of investment can close.
    //
    // Each branch answers that supply question differently, and the two lanes
    // inside each branch differ in KIND, not degree:
    //
    // Aggression — "make it count." One rock, so it goes where you sent it,
    //   into the part that matters. Lane A is THE AIM (accuracy, reach, and
    //   the angle nothing on legs can answer); lane B is THE CATCH (a joint,
    //   and how long the thing stays caught). Precision versus attrition.
    //   Flavours: piercing, raw damage, planted/duration, aggressive movement
    //   (the knockback fork), reposition others.
    // Boldness — "the ground you are standing on IS the ammunition." A body
    //   this heavy does not go and fetch a rock. It picks a tile that has one
    //   and refuses to be taken off it. Lane A is THE STANCE (armour, and
    //   `immovable` — nothing drags you off your own quarry); lane B is THE
    //   TAKE (what the stone under you is actually worth — the tree's one
    //   `consumesOwnTerrain` escalation). Holding a tile versus spending it.
    //   Flavours: defence, environment, piercing, raw damage.
    // Sociability — "somebody else has seen the rock." A thrown rock is a
    //   pointer: it says exactly where the fight is, out loud, three tiles
    //   away from where you are standing. Lane A is THE CALL (the mark, and
    //   how long it stays readable); lane B is THE CARRY (what the herd gets
    //   out of every throw). Directing attention versus supporting the herd.
    //   Flavours: rallying, ally buffing, healing, raw damage, piercing.
    //
    // Template v4: 45 nodes — three 12-node branches (opener, two parallel
    // lanes each with their own notable, a deep notable both lanes converge
    // on, a filler, a capstone) plus three 3-node crosslink bridges. Nine
    // `prerequisitesAnyOf` (six lane notables, three deep notables), six fork
    // nodes, every v3 fork preserved.
    //
    // Levers deliberately NOT used, each checked at the call site rather than
    // assumed — all five would have been dead content or a sibling re-skin:
    //   - `hitsArea` + a wider `shape`. `resolveAreaHit` builds its target set
    //     from `resolveShape` tiles, so any footprint narrower than the move's
    //     own range envelope can WHIFF outright on a legal target: a cone of
    //     length 3 does not cover a target three tiles away on a diagonal.
    //     Rock Slide gets away with `burst` radius 1 because its range is also
    //     1. At range 3 the only safe footprint is a radius-3 burst, which is
    //     Rock Slide's move, not this one.
    //   - `excludesAllies`. Its only call site is the `resolveAreaHit` target
    //     filter. On a single-target move it can never fire.
    //   - `statusChance` / `statusSpreads` / `statusSeverity`. `statusKind` is
    //     not a tree-settable field and this move's base spec sets none, so
    //     every status lever here is inert.
    //   - `gatherBurst`. Same finding Rock Slide recorded: the only path a
    //     non-`burrow` damage move can feed is the canopy harvest, whose only
    //     crop is Apple (`eligibleBiomes: ["forest"]`). These learners live in
    //     badlands/highland/tundra/savanna.
    //   - `weightScaling` and `chargeAttack`. Reserved, in this file's own
    //     Scratch comment, as Tackle's and Body Slam's answers — and every
    //     species that learns Rock Throw also learns Tackle.
    //   - `terrainFill: { terrain: "boulder" }`. Buildable and tempting: it
    //     would drop a fresh boulder on the tile the rock landed on, and this
    //     is the one move that could then pick it back up. Rejected on
    //     purpose. The whole identity above is that this move consumes a
    //     resource it did NOT create; a move that restocks itself is
    //     Earthquake, which already owns the fill-and-consume mud loop.
    tree: {
      // ============================================================
      // AGGRESSION — "make it count"
      // Lane A: THE AIM. Lane B: THE CATCH.
      // ============================================================
      pinning_impact: {
        id: "pinning_impact",
        name: "Pinning Impact",
        cost: 1,
        leaning: "aggression",
        // Not a stun — a real but partial slow, so a cornered target can
        // still struggle away eventually. Denial, not a lockdown. Also the
        // root of this tree's ONE `statChangeOnHit` chain: every other node
        // that touches the field is a descendant of this one, because the
        // engine OVERWRITES it (`applyMoveTree`) and two independent setters
        // would silently race.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -1, ticks: 16 } },
      },
      // --- Lane A: the aim ---
      dead_aim: {
        id: "dead_aim",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["pinning_impact"],
        leaning: "aggression",
        // Was +8. Rock Throw's canon accuracy is 90 and `rollAccuracy`
        // computes `accuracy * stageMultiplier * extraMultiplier`, so the
        // first 10 points here are worth exactly what they say and land the
        // move on 100. Past 100 the surplus is not dead — unlike the
        // 100-accuracy moves elsewhere in this roster — it is CONDITIONAL:
        // `stormAccuracyMultiplier` (weather.ts) and
        // `elevationAccuracyMultiplier` (elevation.ts) both compose onto that
        // same `extraMultiplier`, so headroom is what keeps a throw honest
        // uphill or in a storm. Still capped hard at one accuracy node per
        // lane — the old "+8 Accuracy" tail filler that sat behind Skyfall is
        // gone, because a fourth accuracy node in one branch would have been
        // buying nothing but weather insurance.
        delta: { accuracy: 10 },
      },
      cracked_joint: {
        id: "cracked_joint",
        name: "+8 Power",
        cost: 1,
        prerequisites: ["dead_aim"],
        leaning: "aggression",
        delta: { power: 8 },
      },
      skyfall: {
        id: "skyfall",
        name: "Skyfall",
        cost: 2,
        // LANE NOTABLE (the aim lane). Reachable the normal way, or via the
        // Aggression <-> Boldness bridge's own notable (Bedrock Momentum).
        prerequisitesAnyOf: [["cracked_joint"], ["bedrock_momentum"]],
        leaning: "aggression",
        // The angle a thrown rock has and a landed one does not: arced down
        // out of the sky, onto something whose whole defence is not being on
        // the ground. This lane's point is that aim beats reach of limb.
        delta: { bonusVsType: { type: "flying", multiplier: 1.5 } },
      },
      longer_arm: {
        id: "longer_arm",
        name: "+1 Range",
        cost: 1,
        prerequisites: ["skyfall"],
        leaning: "aggression",
        // The v3 identity, finally spent on: "the reach a lumbering body
        // wouldn't have." Three tiles becomes four. The tree's ONLY `range`
        // setter — it is an overwrite field — and it is live because this is
        // a single-target move: `range` alone decides whether the engine will
        // fire (`canAttackFromHere`), with no shape footprint to fall short
        // of it.
        delta: { range: { min: 0, max: 4 } },
      },
      // --- Lane B: the catch ---
      loose_scree: {
        id: "loose_scree",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["pinning_impact"],
        leaning: "aggression",
        // The only cooldown node in the tree, and the only one it should get
        // without a balance decision: Rock Throw was the roster's tempo floor
        // at a flat 1.00x (no cooldown nodes at all, against a roster median
        // of 1.80-2.00x). -1 on a base of 4 is 1.25x, well under this move's
        // own 2.50x cap. Flagged in the writeup as a real tuning change.
        delta: { cooldownTicks: -1 },
      },
      hobbling_throw: {
        id: "hobbling_throw",
        name: "Hobbling Throw",
        cost: 2,
        // LANE NOTABLE (the catch lane). Reachable the normal way, or via the
        // Sociability <-> Aggression bridge's own notable (Converged Quarry).
        prerequisitesAnyOf: [["loose_scree"], ["converged_quarry"]],
        leaning: "aggression",
        // The deepest rung of the pin ladder, and deliberately deeper in
        // DURATION rather than magnitude: stat stages stack (`applyStatStage`
        // pushes onto a list), so a bigger negative stage compounds into a
        // lockdown across repeated hits, which this branch is explicitly not.
        // A leg that stays caught is the fantasy; a target that cannot move
        // at all is a different move.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -2, ticks: 40 } },
      },
      relentless_barrage: {
        id: "relentless_barrage",
        name: "Relentless Barrage",
        cost: 2,
        prerequisites: ["hobbling_throw"],
        excludes: ["driven_back"],
        leaning: "aggression",
        // Keeps throwing, one after another — no window for the target to
        // recover its footing between hits.
        delta: { power: 15 },
      },
      driven_back: {
        id: "driven_back",
        name: "Driven Back",
        cost: 2,
        prerequisites: ["hobbling_throw"],
        excludes: ["relentless_barrage"],
        leaning: "aggression",
        // This node was `crippling_snare`, which set `shape: cone` and
        // nothing else — and `shape` is only ever read by `resolveAreaHit`,
        // which only runs when `hitsArea` is true. It was inert: a skill
        // point for a footprint the engine never looked at. Unreachable
        // content is a bug in this project, so it is replaced rather than
        // patched, and the fork it belongs to is preserved.
        //
        // The replacement is the same DECISION in a live lever: barrage is
        // "hit it harder", this is "keep it off you". The rock knocks the
        // target a tile back down the throwing lane — the tree's first
        // physical lever, and exactly what a slow, ranged, heavy body wants
        // from a fork. `forcedMovement` fires on a landed non-killing hit
        // against the primary target (predation.ts), and one tile of shove
        // leaves the target inside this move's range, so it buys distance
        // without ending the fight.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" }, power: 5 },
      },
      broken_stride: {
        id: "broken_stride",
        name: "Already Reaching",
        cost: 2,
        // DEEP NOTABLE — both lanes converge here: the aim lane's tail and
        // both tips of the catch lane's fork.
        prerequisitesAnyOf: [["longer_arm"], ["relentless_barrage"], ["driven_back"]],
        leaning: "aggression",
        // What "make it count" converges on. A rock that lands exactly on the
        // joint means the next one is already out of the ground before the
        // target has finished falling: `critCooldownReset` zeroes this move's
        // own cooldown on a crit (`applySingleDamageInstance`), and the crit
        // stage in the same node is what makes that reachable rather than
        // theoretical. Note for whoever tunes tempo next: this is a real
        // tempo lever that the cooldown cap in DESIGN_VALIDATION.md does not
        // see, because it spends no `cooldownTicks`.
        delta: { critRateStage: 1, critCooldownReset: true },
      },
      quarry_footing: {
        id: "quarry_footing",
        name: "+0.2 Defense Penetration",
        cost: 1,
        prerequisites: ["broken_stride"],
        leaning: "aggression",
        delta: { defensePenetration: 0.2 },
      },
      quarry_break: {
        id: "quarry_break",
        name: "Quarry Break",
        cost: 2,
        prerequisites: ["quarry_footing"],
        leaning: "aggression",
        // Wrenches a whole slab straight out of the ground before it throws —
        // a costly beat of committed downtime (`lockTicks`) buys a genuinely
        // bigger, armor-punching hit. Kept on `lockTicks` rather than
        // converted to `chargeAttack` on this pass: `chargeAttack` is Tackle's
        // and Body Slam's signature (see this file's Scratch comment) and
        // every Rock Throw learner also knows Tackle, so it would have been a
        // sibling re-skin. Worth recording for whoever tunes it: `lockTicks`
        // counts WORLD ticks (`tickActionLock` runs from `tickAgentNeeds`,
        // every tick) while `cooldownTicks` counts the agent's own ACTIONS —
        // two different denominators, so 2 lock ticks is a smaller cost than
        // it looks next to a cooldown of 4.
        //
        // The richer version — only pay the cost when there's no
        // `consumesOwnTerrain` boulder already underfoot to just throw for
        // free — still needs a "conditional on terrain presence" branch in
        // predation.ts's `applySingleDamageInstance`; flagged in
        // MOVES_DESIGN.md, still not built.
        delta: { lockTicks: 2, power: 25, defensePenetration: 0.3 },
      },
      // ============================================================
      // BOLDNESS — "the ground you are standing on is the ammunition"
      // Lane A: THE STANCE. Lane B: THE TAKE.
      // ============================================================
      bedrock_stance: {
        id: "bedrock_stance",
        name: "Bedrock Stance",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: {},
      },
      // --- Lane A: the stance (nothing takes you off the tile you chose) ---
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
        prerequisites: ["weathered_slab"],
        leaning: "boldness",
        delta: { accuracy: 8 },
      },
      unshakeable: {
        id: "unshakeable",
        name: "Unshakeable",
        cost: 1,
        // LANE NOTABLE (the stance lane). Reachable the normal way, or via
        // the Aggression <-> Boldness bridge's own notable (Bedrock Momentum).
        prerequisitesAnyOf: [["granite_grip"], ["bedrock_momentum"]],
        leaning: "boldness",
        // Plants and refuses to be moved — no drag, knockback, or lunge so
        // much as budges it. In this tree that is not generic tankiness: the
        // tile you are standing on is the ammunition, so being taken off it
        // is the real loss.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      bedrock_footing: {
        id: "bedrock_footing",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["unshakeable"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      // --- Lane B: the take (what the stone under you is actually worth) ---
      edge_on: {
        id: "edge_on",
        name: "+4 Power, +0.04 Lifesteal",
        cost: 1,
        prerequisites: ["bedrock_stance"],
        leaning: "boldness",
        // A slab has an edge. Thrown flat it is a weight; thrown edge-on it
        // is a wedge, and a wedge opens something you can feed on.
        delta: { power: 4, lifestealFraction: 0.04 },
      },
      stone_underfoot: {
        id: "stone_underfoot",
        name: "Stone Underfoot",
        cost: 2,
        // LANE NOTABLE (the take lane). Reachable the normal way, or via the
        // Boldness <-> Sociability bridge's own notable (Herd's Bulwark).
        prerequisitesAnyOf: [["edge_on"], ["herds_bulwark"]],
        leaning: "boldness",
        // THE identity node of the whole tree, and the tree's ONLY
        // `consumesOwnTerrain` setter — the engine overwrites that field
        // (`applyMoveTree`), so a second setter anywhere here would silently
        // win or lose depending on allocation order.
        //
        // You are not throwing a rock you found ON the boulder any more; you
        // are throwing the boulder. 3x becomes 4.5x on the one condition this
        // move's fantasy actually cares about — a real boulder tile under
        // your own feet, checked in `applySingleDamageInstance` before the
        // damage formula, and spent for good (the tile reverts to floor).
        // Measured: boulders are 1.2-3.5% of surface tiles and ZERO of the
        // underground layer, so for Onix — an underground native — this
        // notable is a reason to be up top, which is exactly the kind of
        // decision this branch is supposed to be about.
        delta: { consumesOwnTerrain: { terrain: "boulder", damageMultiplier: 4.5 } },
      },
      aftershock_counter: {
        id: "aftershock_counter",
        name: "Aftershock Counter",
        cost: 1,
        prerequisites: ["stone_underfoot"],
        excludes: ["granite_ward"],
        leaning: "boldness",
        // Was `situationalBonus: { condition: "flanking" }`. Removed on
        // purpose, and not only because the tree can afford exactly one
        // `situationalBonus` setter before the engine starts overwriting:
        // `flanking` reads "the defender is not currently fighting or hunting
        // ME" (predation.ts's `situationalMultiplier`), which for something
        // throwing rocks from three tiles away is true most of the time. A
        // condition that is nearly always on is not a condition. The tree's
        // one situational payoff went to Converged Quarry's `rallyMarked`,
        // which has to be earned.
        //
        // Same fork, same idea in a lever that always pays: whatever came at
        // you and got a rock instead leaves you something.
        delta: { lifestealFraction: 0.08 },
      },
      granite_ward: {
        id: "granite_ward",
        name: "Granite Ward",
        cost: 1,
        prerequisites: ["stone_underfoot"],
        excludes: ["aftershock_counter"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { accuracy: 10 },
      },
      fracturing_blow: {
        id: "fracturing_blow",
        name: "Fracturing Blow",
        cost: 2,
        // DEEP NOTABLE — the stance lane's tail and both tips of the take
        // lane's fork converge here.
        prerequisitesAnyOf: [["bedrock_footing"], ["aftershock_counter"], ["granite_ward"]],
        leaning: "boldness",
        // Was a defender Defense debuff, which is the same `statChangeOnHit`
        // field the Aggression pin ladder owns — two independent setters, one
        // silently winning. Rebuilt as the first rung of this branch's own
        // ladder into its capstone instead: a rock thrown by something that
        // refuses to move starts going through hide that is built to shrug
        // rock off.
        delta: { resistanceBreaker: { multiplier: 1.4 } },
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
        // Thrown hard enough that even a real resistance barely slows it —
        // the top of the ladder Fracturing Blow starts, and an escalation of
        // the same field on the same chain rather than a second independent
        // setter racing it.
        //
        // The other capstone this branch was pitched as — the throw's own
        // power scaling with damage the user just absorbed, a real "stored
        // retaliation loop" — still needs a `SituationalCondition` of
        // "recentlyDamaged", a one-line addition to the same enum/check
        // `"targetLowHp"` already uses. Flagged in MOVES_DESIGN.md, not built.
        delta: { resistanceBreaker: { multiplier: 2 } },
      },
      // ============================================================
      // SOCIABILITY — "somebody else has seen the rock"
      // Lane A: THE CALL. Lane B: THE CARRY.
      // ============================================================
      tremor_call: {
        id: "tremor_call",
        name: "Tremor Call",
        cost: 1,
        leaning: "sociability",
        // The impact's tremor doesn't just warn the herd it happened — it
        // marks exactly where. Every herd-mate's own, independently-run
        // hunt/threat pick converges on the same target (see
        // `Agent.rallyMarkTicksRemaining`'s own doc comment). A thrown rock
        // is the only thing in this species' kit that can point at something
        // three tiles away without anyone having to walk there.
        delta: { rallyCall: { ticks: 20 } },
      },
      // --- Lane A: the call (how far, and how long, the pointer holds) ---
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
        name: "+0.15 Defense Penetration",
        cost: 1,
        prerequisites: ["sure_footing"],
        leaning: "sociability",
        // The herd closing in behind the target leaves it little room to
        // brace.
        delta: { defensePenetration: 0.15 },
      },
      carrying_rumble: {
        id: "carrying_rumble",
        name: "Carrying Rumble",
        cost: 2,
        // LANE NOTABLE (the call lane). Reachable the normal way, or via the
        // Sociability <-> Aggression bridge's own notable (Converged Quarry).
        prerequisitesAnyOf: [["herd_grip"], ["converged_quarry"]],
        leaning: "sociability",
        // The one node in this tree allowed to touch the mark after the
        // opener, and it is a duration change rather than a fourth mechanic
        // because duration is the whole problem: a 20-tick mark on a target
        // three tiles away expires before a herd-mate on the far side of the
        // fight can walk to it. This is the node that makes `rallyCall`
        // actually converge anybody. `rallyCall` is an overwrite field and
        // Tremor Call is this node's ancestor on every route, so it is an
        // escalation, not a race.
        delta: { rallyCall: { ticks: 34 } },
      },
      passed_to_you: {
        id: "passed_to_you",
        name: "+6 Power",
        cost: 1,
        prerequisites: ["carrying_rumble"],
        leaning: "sociability",
        // Nobody in a herd this size throws the light one twice.
        delta: { power: 6 },
      },
      // --- Lane B: the carry (what the herd gets out of every throw) ---
      called_shot: {
        id: "called_shot",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["tremor_call"],
        leaning: "sociability",
        // The second of the tree's two cooldown nodes, and the reason the
        // carry lane exists: you are not the one who has to find the next
        // rock. Total reduction is -2 against a base of 4 — a 1.67x tempo
        // gain, still under the roster median of 1.80-2.00x and well under
        // this move's own 2.50x cap.
        delta: { cooldownTicks: -1 },
      },
      tremor_bond: {
        id: "tremor_bond",
        name: "Tremor Bond",
        cost: 2,
        // LANE NOTABLE (the carry lane). Reachable the normal way, or via the
        // Boldness <-> Sociability bridge's own notable (Herd's Bulwark).
        prerequisitesAnyOf: [["called_shot"], ["herds_bulwark"]],
        leaning: "sociability",
        // A real, distinct Sociability lever from marking: the same tremor
        // that calls the herd in doubles as a dedicated check-in — an
        // idle-tick heal for whichever herd-mate needs it most (see
        // `targetsAlly`'s own doc comment). Not another way to extend or
        // repeat the mark.
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
        // DEEP NOTABLE — the call lane's tail and both tips of the carry
        // lane's fork converge here.
        prerequisitesAnyOf: [["passed_to_you"], ["vanguard_call"], ["bulwark_call"]],
        leaning: "sociability",
        // Where the two lanes meet: the call stops being something you decide
        // to make. `allyEffectOnAttack` fires the ally effect on the NEAREST
        // eligible herd-mate every single time this move is used, whether or
        // not the throw itself lands (predation.ts's `resolveHit`) — so every
        // rock thrown at something else is simultaneously a hand on a
        // herd-mate's shoulder. The `allyEffect` here escalates Tremor Bond's
        // own (an ancestor on every route, so this is a ladder rather than a
        // race) and adds the half a bare heal could never carry: the herd-mate
        // it reaches hits harder for a while, because it now knows where to
        // hit. The regen passive is unchanged from v3 — no new passives
        // anywhere in this conversion.
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: {
          allyEffectOnAttack: true,
          allyEffect: { healFraction: 0.18, buff: { stat: "attack", stage: 1, ticks: 14 } },
        },
      },
      tremor_focus: {
        id: "tremor_focus",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["colony_watch"],
        leaning: "sociability",
        // Unchanged from v3. Worth knowing what it is actually worth: with
        // Sure Footing this branch reaches 90 + 13 = 103, so 2 of these 5
        // points always pay and the other 3 only pay under a storm or an
        // uphill shot (`stormAccuracyMultiplier` / `elevationAccuracyMultiplier`
        // both compose onto `rollAccuracy`'s `extraMultiplier`). Real, but
        // conditional — which is why no further accuracy filler was added.
        delta: { accuracy: 5 },
      },
      herd_ascendant: {
        id: "herd_ascendant",
        name: "Herd Ascendant",
        cost: 2,
        prerequisites: ["tremor_focus"],
        leaning: "sociability",
        // Deliberately not "extend the mark even further" a third time — a
        // different payoff: whatever's already marked recovers steadily worse
        // (`jamCooldownTicks`, a real control effect on the enemy), and a
        // sustained group fight lets the user feed off it a little too.
        delta: { jamCooldownTicks: 3, lifestealFraction: 0.05 },
      },
      // ============================================================
      // BRIDGE 1 — Aggression <-> Boldness: the braced heave.
      // Aim wants the rock somewhere specific; the stance wants to not move.
      // Their crossing is commitment: plant, put the whole body behind it,
      // and accept that you are not going anywhere for a beat.
      // Lands on Skyfall (Aggression's aim lane) and Unshakeable (Boldness's
      // stance lane) — one lane notable per branch, one step short of either
      // branch's fork.
      // ============================================================
      grinding_advance: {
        id: "grinding_advance",
        name: "Grinding Advance",
        cost: 1,
        prerequisites: ["pinning_impact", "bedrock_stance"],
        leaning: "aggression",
        // Was a self Attack buff via `statChangeOnHit`, which is the field
        // the Aggression pin ladder owns — an independent setter racing it.
        // Rebuilt on the lever this bridge is actually about, and one that is
        // additive so it can ladder cleanly: a real beat of committed
        // downtime, bought in the same node (principle 4) with the sharper
        // hit a planted, grinding heave actually produces.
        delta: { critRateStage: 1, lockTicks: 1 },
      },
      grinding_footing: {
        id: "grinding_footing",
        name: "+0.15 Defense Penetration, +1 Lock",
        cost: 1,
        prerequisites: ["grinding_advance"],
        leaning: "aggression",
        // Bridge filler: deepens the lever its own crosslink introduced
        // (principle 13) — one more beat spent committing to the heave, and
        // the weight behind it starts telling on whatever it lands on.
        delta: { defensePenetration: 0.15, lockTicks: 1 },
      },
      bedrock_momentum: {
        id: "bedrock_momentum",
        name: "Bedrock Momentum",
        cost: 2,
        prerequisites: ["grinding_footing"],
        leaning: "boldness",
        // BRIDGE NOTABLE. The top of the commitment ladder: a throw with the
        // user's whole braced mass behind it, which starts going through hide
        // built to shrug rock off. First rung of the same `resistanceBreaker`
        // ladder Boldness's own Fracturing Blow (1.4x) and Bedrock Breaker
        // (2x) finish — this node is an ancestor of both on every route, so
        // it escalates rather than races them. Deliberately no third lock
        // tick: two across the bridge plus Quarry Break's two is already the
        // heaviest self-commitment build here.
        delta: { resistanceBreaker: { multiplier: 1.25 }, power: 8 },
      },
      // ============================================================
      // BRIDGE 2 — Boldness <-> Sociability: the tremor's warning reaches far
      // enough to brace the thrower too. Lands on Stone Underfoot (Boldness's
      // take lane) and Tremor Bond (Sociability's carry lane).
      // ============================================================
      warning_tremor: {
        id: "warning_tremor",
        name: "Warning Tremor",
        cost: 1,
        prerequisites: ["bedrock_stance", "tremor_call"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: {},
      },
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
        // Deepens the bracing the crosslink already granted instead of a
        // generic bolt-on — the herd's own care extends into real, ongoing
        // recovery.
        grantsPassive: { kind: "regen", value: 0.025 },
        delta: {},
      },
      // ============================================================
      // BRIDGE 3 — Sociability <-> Aggression: a marked target that is
      // already stumbling gets bogged down for good, and the herd's
      // convergence is what makes the last rung worth anything. Lands on
      // Hobbling Throw (Aggression's catch lane) and Carrying Rumble
      // (Sociability's call lane).
      //
      // (Fixed a real mistake here in v3: `lockTicks` locks the *user* out of
      // acting, not the defender — it cannot express "stun the target" at
      // all. There is still no tree-settable way to inflict a status, so this
      // bridge deepens the primitive the branch actually has.)
      // ============================================================
      rolling_thunder: {
        id: "rolling_thunder",
        name: "Rolling Thunder",
        cost: 1,
        prerequisites: ["tremor_call", "pinning_impact"],
        leaning: "sociability",
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -2, ticks: 24 } },
      },
      marked_advantage: {
        id: "marked_advantage",
        name: "Marked Advantage",
        cost: 1,
        prerequisites: ["rolling_thunder"],
        leaning: "aggression",
        // Was a `situationalBonus` on `rallyMarked`, which shared no lever
        // with its own crosslink (principle 13 — the checker flagged it) and
        // raced the Boldness branch's independent `situationalBonus` setter.
        // Rebuilt to deepen the exact thing Rolling Thunder does: a target
        // the herd has already converged on stays caught longer, because
        // nobody is giving it room to shake the leg out.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -2, ticks: 32 } },
      },
      converged_quarry: {
        id: "converged_quarry",
        name: "Converged Quarry",
        cost: 2,
        prerequisites: ["marked_advantage"],
        leaning: "aggression",
        // BRIDGE NOTABLE, and the tree's ONE `situationalBonus` — spent on
        // the condition this move's own fantasy has to earn rather than one
        // that is nearly always true. A target this pinned and this marked
        // barely stands a chance.
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
    //
    // v4 conversion (MOVES_DESIGN.md's "Skill-tree template v4 — the
    // two-lane standard"): 33 -> 45 nodes, 12 per branch, 9 anyOf, 3 real
    // three-node bridges. Every v3 fork kept, relocated to the tail of a
    // lane.
    //
    // THE FANTASY, written before a single node moved: a hairline jet fired
    // through a pinched mouth — pressure, not volume. Forty power, a
    // twenty-five-shot pool, two tiles of reach. It does not knock anything
    // over; it stings, it blinds, and it WETS. The danger is not the hit, it
    // is the repetition: every landed shot leaves standing water where it
    // struck and puts a real fertility boost into that ground (`terrainFill`
    // -> `waterSoil`, predation.ts), so a creature that keeps firing is
    // quietly rebuilding the ground the fight is happening on. Hydro Pump is
    // one release you can barely aim; Water Gun is the same animal doing one
    // small exact thing forty times, and the map remembers every one of them.
    //
    // - Aggression ("The Fine Point"): aggression for a squirt gun is
    //   NARROWING the aperture, not opening it. Lane A is the CUT — one shot,
    //   thinner, further, through the guard (penetration, then Piercing Jet
    //   turning the two-tile line into a three-tile one, this tree's only
    //   `shape` setter). Lane B is the RATE — how often it arrives and how
    //   many arrive at once, ending at the preserved heavy-vs-double fork.
    //   Volume against severity, not two flavours of "more".
    // - Boldness ("Standing Water"): the most fragile spawned agent in the
    //   sim is bold by CHOOSING WHERE the fight happens and turning that
    //   ground into its own pond. Lane A is SPACE (the knockback/recoil
    //   chain — nothing gets to arm's length). Lane B is PLANTED: Drink the
    //   Puddle spends a water tile the user is standing on for real bonus
    //   damage — the base move's own `terrainFill` is what put it there, so
    //   this tree, uniquely, closes the loop instead of draining the map.
    // - Sociability ("The Waterhole"): a small repeatable water move is
    //   INFRASTRUCTURE. Lane A is the pod (heal, steel, share). Lane B is
    //   command — Rally the Shoal marks the threat so the whole herd's own
    //   targeting turns onto it, then either shield the pod or press the
    //   mark. Care against command, not two sizes of buff.
    tree: {
      // ---------------------------------------------------------------
      // AGGRESSION — "The Fine Point". 12 nodes.
      // ---------------------------------------------------------------
      high_pressure_jet: {
        id: "high_pressure_jet",
        name: "High-Pressure Jet",
        cost: 1,
        leaning: "aggression",
        // OPENER. A genuine barometric-pressure hook — hits hardest
        // specifically during a storm, not just any rain.
        delta: { situationalBonus: { condition: "storm", multiplier: 1.4 } },
      },
      jet_conditioning: {
        id: "jet_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["high_pressure_jet"],
        leaning: "aggression",
        // LANE A filler.
        delta: { power: 5 },
      },
      narrowed_aperture: {
        id: "narrowed_aperture",
        name: "Narrowed Aperture",
        cost: 1,
        prerequisites: ["jet_conditioning"],
        leaning: "aggression",
        // LANE A filler. The whole branch in one lever: the same water
        // through a smaller hole finds the gaps in a guard.
        delta: { defensePenetration: 0.2 },
      },
      piercing_jet: {
        id: "piercing_jet",
        name: "Piercing Jet",
        cost: 1,
        // LANE NOTABLE A, and the landing point for the
        // Aggression<->Boldness bridge.
        prerequisitesAnyOf: [["narrowed_aperture"], ["full_bore"]],
        leaning: "aggression",
        // The tree's ONLY `shape` setter (overwrite field, notable-tier
        // currency per principle 14): the base two-tile line becomes three,
        // with the `range.max` to actually decide to fire from there. Still
        // single-file — this lane makes the jet longer and thinner, never
        // wider. Measured against the base shape, not guessed: line 2 -> 3.
        delta: { shape: { kind: "line", length: 3 }, range: { max: 3 } },
      },
      jet_precision: {
        id: "jet_precision",
        name: "Deeper Bite",
        cost: 1,
        prerequisites: ["piercing_jet"],
        leaning: "aggression",
        // Repurposed from "+5 Accuracy": Water Gun's canon accuracy is
        // already 100, and `rollAccuracy` (combat.ts) only ever spends the
        // surplus through `stormAccuracyMultiplier`. Six of this tree's 33
        // nodes were +5 Accuracy; four of them have been given real levers
        // and two kept where the storm hook makes them deliberate.
        delta: { power: 5, defensePenetration: 0.15 },
      },
      pressurized_footing: {
        id: "pressurized_footing",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["high_pressure_jet"],
        leaning: "aggression",
        // LANE B filler. Lane B is the repetition the whole fantasy runs on,
        // so it opens by shortening the gap between shots. (Also repurposed
        // from a +5 Accuracy node — see Deeper Bite above.)
        delta: { cooldownTicks: -1 },
      },
      stuttering_jet: {
        id: "stuttering_jet",
        name: "Stuttering Jet",
        cost: 1,
        // LANE NOTABLE B, and the landing point for the
        // Sociability<->Aggression bridge.
        prerequisitesAnyOf: [["pressurized_footing"], ["rip_current"]],
        leaning: "aggression",
        // The pressure is no longer smooth: the jet breaks into a stutter
        // that sometimes lands twice, and the mouth refills faster. Volume,
        // where lane A bought severity.
        delta: { hits: { min: 1, max: 2 }, cooldownTicks: -1 },
      },
      torrent: {
        id: "torrent",
        name: "Torrent",
        cost: 1,
        prerequisites: ["stuttering_jet"],
        excludes: ["rapid_jets"],
        leaning: "aggression",
        // Preserved v3 fork, relocated to the tail of the rate lane: give up
        // the stutter's tempo for one heavy shot.
        delta: { power: 10, cooldownTicks: 1 },
      },
      rapid_jets: {
        id: "rapid_jets",
        name: "Rapid Jets",
        cost: 1,
        prerequisites: ["stuttering_jet"],
        excludes: ["torrent"],
        leaning: "aggression",
        // The other half of the same fork: commit to the stutter instead —
        // always two, never one.
        delta: { hits: { min: 2, max: 2 }, power: -10 },
      },
      deluge: {
        id: "deluge",
        name: "Deluge",
        cost: 2,
        // DEEP NOTABLE: the cut lane and both sides of the rate fork end
        // here.
        prerequisitesAnyOf: [["jet_precision"], ["torrent"], ["rapid_jets"]],
        leaning: "aggression",
        delta: { situationalBonus: { condition: "rain", multiplier: 1.3 } },
      },
      jet_focus: {
        id: "jet_focus",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["deluge"],
        leaning: "aggression",
        // One of the two accuracy fillers deliberately KEPT: this is the
        // branch whose opener wants a storm, and `stormAccuracyMultiplier`
        // (weather.ts) is the one real caller of `rollAccuracy`'s extra
        // multiplier — so a storm build is buying back exactly what the
        // storm takes off it.
        delta: { accuracy: 5 },
      },
      overwhelming_current: {
        id: "overwhelming_current",
        name: "Overwhelming Current",
        cost: 2,
        prerequisites: ["jet_focus"],
        leaning: "aggression",
        // CAPSTONE. Water Gun is resisted by Grass, Water, and Dragon — this
        // fixes a real, printed weakness instead of padding an
        // already-favorable matchup vs. Fire.
        delta: { resistanceBreaker: { multiplier: 2 } },
      },

      // ---------------------------------------------------------------
      // BOLDNESS — "Standing Water". 12 nodes.
      // ---------------------------------------------------------------
      knockback_spray: {
        id: "knockback_spray",
        name: "Knockback Spray",
        cost: 1,
        leaning: "boldness",
        // OPENER.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      spray_conditioning: {
        id: "spray_conditioning",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["knockback_spray"],
        leaning: "boldness",
        // LANE A filler.
        delta: { power: 5 },
      },
      evasive_spray_footing: {
        id: "evasive_spray_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["spray_conditioning"],
        leaning: "boldness",
        // LANE A filler. The second accuracy node kept on purpose: this is
        // the lane that stands in the open holding a spot, which is where a
        // storm's accuracy penalty actually bites.
        delta: { accuracy: 5 },
      },
      retreating_current: {
        id: "retreating_current",
        name: "Retreating Current",
        cost: 1,
        // LANE NOTABLE A, and the landing point for the
        // Boldness<->Sociability bridge.
        prerequisitesAnyOf: [["evasive_spray_footing"], ["breakwater"]],
        leaning: "boldness",
        // Lane A is SPACE: the jet's own recoil is the retreat. Nothing gets
        // to arm's length of the most fragile agent in the sim.
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 2, timing: "onHit" } },
      },
      tidal_retreat: {
        id: "tidal_retreat",
        name: "Tidal Retreat",
        cost: 1,
        prerequisites: ["retreating_current"],
        leaning: "boldness",
        // A real, always-usable panic-button retreat for the sim's most
        // fragile spawned agent. `forcedMovement` is an overwrite field, so
        // this deliberately sits downstream of Retreating Current as
        // escalation (2 tiles -> 3) rather than as a rival setting.
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 3, timing: "onHit" } },
      },
      current_precision: {
        id: "current_precision",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["knockback_spray"],
        leaning: "boldness",
        // LANE B filler, repurposed from "+5 Accuracy" (see Deeper Bite).
        // The planted lane wants weight behind the shot, not a hit chance it
        // already has.
        delta: { power: 5 },
      },
      drink_the_puddle: {
        id: "drink_the_puddle",
        name: "Drink the Puddle",
        cost: 1,
        // LANE NOTABLE B, and the landing point for the
        // Aggression<->Boldness bridge.
        prerequisitesAnyOf: [["current_precision"], ["full_bore"]],
        leaning: "boldness",
        // The loop this move and no other can close. `consumesOwnTerrain`
        // (predation.ts) checks the ATTACKER's own tile: standing in water,
        // the shot draws from the tile itself for 1.5x and the tile reverts
        // to floor. Hydro Pump drafted this exact node and cut it, because a
        // Water species fights standing on water constantly and deleting
        // those tiles is a real ecology regression on a metered resource.
        // Water Gun is the one move that answers that objection: its base
        // `terrainFill` puts a fresh water tile under every landed,
        // non-killing hit, so the tree that spends puddles is the same tree
        // that makes them. Net-neutral on the map, and the only node in the
        // roster where the move's own side effect is its own ammunition.
        delta: { consumesOwnTerrain: { terrain: "water", damageMultiplier: 1.5 } },
      },
      undertow: {
        id: "undertow",
        name: "Undertow",
        cost: 1,
        prerequisites: ["drink_the_puddle"],
        excludes: ["bubble_shield"],
        leaning: "boldness",
        // Preserved v3 fork, relocated to the tail of the planted lane.
        // Washes the target's own footing out from under it.
        delta: { statChangeOnHit: { target: "defender", stat: "speed", stage: -1, ticks: 20 } },
      },
      bubble_shield: {
        id: "bubble_shield",
        name: "Bubble Shield",
        cost: 1,
        prerequisites: ["drink_the_puddle"],
        excludes: ["undertow"],
        leaning: "boldness",
        // The other half: steel yourself instead of unsteadying them. Note
        // this side feeds Braced Spray below, since a positive Defense stage
        // is part of the engine's own weight term (predation.ts) — nothing
        // pairs the two nodes explicitly, they just both talk to stat stages.
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 20 } },
      },
      tidal_guard: {
        id: "tidal_guard",
        name: "Tidal Guard",
        cost: 2,
        // DEEP NOTABLE: the space lane and both sides of the planted lane's
        // fork end here.
        prerequisitesAnyOf: [["tidal_retreat"], ["undertow"], ["bubble_shield"]],
        leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.08 },
        delta: {},
      },
      braced_spray: {
        id: "braced_spray",
        name: "Braced Spray",
        cost: 1,
        prerequisites: ["tidal_guard"],
        leaning: "boldness",
        // Replaces the old "+5 Accuracy" filler in this slot with a real
        // lever, and a systemic one: `weightScaling` (predation.ts) reads
        // the attacker's own maxHp AND its positive Defense stages, so a
        // build that came through Bubble Shield gets more out of this than
        // one that came through Undertow. The setup is not wired up — both
        // halves just talk to the stat-stage system already.
        delta: { weightScaling: { factor: 0.2 } },
      },
      sheeting_spray: {
        id: "sheeting_spray",
        name: "Sheeting Spray",
        cost: 2,
        prerequisites: ["braced_spray"],
        leaning: "boldness",
        // CAPSTONE, and the payoff the whole branch has been standing still
        // for: the jet stops being a jet. `hitsArea` (resolveAreaHit,
        // predation.ts) makes every living agent standing in the resolved
        // line take the hit instead of only the first body — with Piercing
        // Jet that is three tiles of front, on a move whose whole identity
        // was one tiny target at a time. The only node in the roster that
        // turns a single-target line into an area sweep.
        //
        // Measured, not assumed: this does NOT multiply the move's own
        // puddle. `terrainFill` sits behind `isPrimaryTarget` in
        // `resolveHitAgainstTarget`, so an area sweep still leaves exactly
        // one water tile per cast (verified live: 1 tile, base move and
        // Sheeting Spray alike, while the secondary target went from 0
        // damage to 33). Flooding the map is still a matter of firing a
        // lot, which is the branch's point.
        delta: { hitsArea: true },
      },

      // ---------------------------------------------------------------
      // SOCIABILITY — "The Waterhole". 12 nodes.
      // ---------------------------------------------------------------
      shared_current: {
        id: "shared_current",
        name: "Shared Current",
        cost: 1,
        leaning: "sociability",
        // OPENER. The splash from a landed hit also heals a nearby hurt
        // herd-mate for free, on top of the dedicated idle-tick support use.
        delta: { targetsAlly: true, allyEffectOnAttack: true, allyEffect: { healFraction: 0.15 } },
      },
      pond_footing: {
        id: "pond_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["shared_current"],
        leaning: "sociability",
        // LANE A filler.
        delta: { accuracy: 5 },
      },
      pond_kinship_footing: {
        id: "pond_kinship_footing",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["pond_footing"],
        leaning: "sociability",
        // LANE A filler.
        delta: { power: 5 },
      },
      calming_wave: {
        id: "calming_wave",
        name: "Calming Wave",
        cost: 1,
        // LANE NOTABLE A, and the landing point for the
        // Boldness<->Sociability bridge.
        prerequisitesAnyOf: [["pond_kinship_footing"], ["breakwater"]],
        leaning: "sociability",
        // Lane A is CARE: what the waterhole does for the bodies around it.
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      wave_precision: {
        id: "wave_precision",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["calming_wave"],
        leaning: "sociability",
        // Repurposed from "+5 Accuracy" (see Deeper Bite).
        delta: { power: 5 },
      },
      tide_instinct: {
        id: "tide_instinct",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["shared_current"],
        leaning: "sociability",
        // LANE B filler.
        delta: { accuracy: 5 },
      },
      rally_the_shoal: {
        id: "rally_the_shoal",
        name: "Rally the Shoal",
        cost: 1,
        // LANE NOTABLE B, and the landing point for the
        // Sociability<->Aggression bridge.
        prerequisitesAnyOf: [["tide_instinct"], ["rip_current"]],
        leaning: "sociability",
        // Lane B is COMMAND, and it differs from lane A in kind rather than
        // size: a mark changes what other agents independently decide to do
        // (`rallyMarkTicksRemaining` -> `preferMarked` targeting) instead of
        // adding a number to one of them. The small one at the waterhole is
        // the one that sees the threat first and says so.
        delta: { rallyCall: { ticks: 20 } },
      },
      undertow_guard: {
        id: "undertow_guard",
        name: "Undertow Guard",
        cost: 1,
        prerequisites: ["rally_the_shoal"],
        excludes: ["riptide_rush"],
        leaning: "sociability",
        // Preserved v3 fork, relocated to the tail of the command lane:
        // having marked the threat, cover the pod...
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      riptide_rush: {
        id: "riptide_rush",
        name: "Riptide Rush",
        cost: 1,
        prerequisites: ["rally_the_shoal"],
        excludes: ["undertow_guard"],
        leaning: "sociability",
        // ...or go at the thing you just marked yourself.
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      steady_tides: {
        id: "steady_tides",
        name: "Steady Tides",
        cost: 2,
        // DEEP NOTABLE: the care lane and both sides of the command lane's
        // fork end here.
        prerequisitesAnyOf: [["wave_precision"], ["undertow_guard"], ["riptide_rush"]],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: {},
      },
      fuller_share: {
        id: "fuller_share",
        name: "Fuller Share",
        cost: 1,
        prerequisites: ["steady_tides"],
        leaning: "sociability",
        // A `delta` rather than another passive, deliberately: passives sum
        // uncapped across every tree a species knows, and this tree already
        // grants three. Deepens the opener's own ally effect instead — the
        // splash now both heals and steels, and holds longer.
        delta: { allyEffect: { healFraction: 0.25, buff: { stat: "defense", stage: 1, ticks: 30 } } },
      },
      tidal_bond: {
        id: "tidal_bond",
        name: "Tidal Bond",
        cost: 2,
        prerequisites: ["fuller_share"],
        leaning: "sociability",
        // CAPSTONE.
        grantsPassive: { kind: "healAura", value: 0.01 },
        delta: {},
      },

      // ---------------------------------------------------------------
      // BRIDGES — crosslink -> filler deepening its own lever -> cost-2
      // notable, each landing on ONE lane notable per branch it connects,
      // and on the lane it COMPLEMENTS rather than the one it matches.
      // ---------------------------------------------------------------

      // Crosslink: Aggression <-> Boldness — a shared burst of confidence
      // off a forceful hit. Lands on Piercing Jet (the cut lane) and Drink
      // the Puddle (the planted lane): an attack buff that only pays off if
      // you keep firing from the same spot.
      surging_retreat: {
        id: "surging_retreat",
        name: "Surging Retreat",
        cost: 1,
        prerequisites: ["high_pressure_jet", "knockback_spray"],
        leaning: "aggression",
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 12 } },
      },
      held_pressure: {
        id: "held_pressure",
        name: "Held Pressure",
        cost: 1,
        prerequisites: ["surging_retreat"],
        leaning: "boldness",
        // Bridge filler, deepening its own crosslink's lever (principle 13):
        // the same +1 Attack, held twice as long.
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 1, ticks: 24 }, power: 4 },
      },
      full_bore: {
        id: "full_bore",
        name: "Full Bore",
        cost: 2,
        prerequisites: ["held_pressure"],
        leaning: "aggression",
        // Bridge notable: the same lever escalated, not a new stat grabbed —
        // +2 Attack on hit, and the valve is open far enough that the stream
        // starts going through guards on its own.
        delta: { statChangeOnHit: { target: "self", stat: "attack", stage: 2, ticks: 24 }, defensePenetration: 0.2 },
      },

      // Crosslink: Boldness <-> Sociability — interposing. Standing between
      // the pod and the thing, and denying it its tempo rather than out-
      // tanking it. Lands on Retreating Current (the space lane) and Calming
      // Wave (the care lane).
      sheltering_current: {
        id: "sheltering_current",
        name: "Sheltering Current",
        cost: 1,
        prerequisites: ["knockback_spray", "shared_current"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        // `delta` added in the v4 pass so this bridge has a lever of its own
        // for its filler to deepen (principle 13) without granting a second
        // passive. A jet in the eyes does not wound — it costs the thing its
        // next move, which is what "sheltering" actually buys the pod.
        delta: { jamCooldownTicks: 1 },
      },
      blinding_mist: {
        id: "blinding_mist",
        name: "Blinding Mist",
        cost: 1,
        prerequisites: ["sheltering_current"],
        leaning: "sociability",
        delta: { jamCooldownTicks: 1 },
      },
      breakwater: {
        id: "breakwater",
        name: "Breakwater",
        cost: 2,
        prerequisites: ["blinding_mist"],
        leaning: "boldness",
        // Bridge notable, escalating the crosslink's own lever: two more
        // ticks off whatever the thing was about to do.
        delta: { jamCooldownTicks: 2, power: 4 },
      },

      // Crosslink: Sociability <-> Aggression — a shared burst of
      // coordinated ferocity, not another flanking check. Lands on Rally the
      // Shoal (the command lane) and Stuttering Jet (the rate lane): more
      // shots, each likelier to find a seam.
      rising_tide: {
        id: "rising_tide",
        name: "Rising Tide",
        cost: 1,
        prerequisites: ["shared_current", "high_pressure_jet"],
        leaning: "sociability",
        delta: { critRateStage: 1 },
      },
      sharpened_shoal: {
        id: "sharpened_shoal",
        name: "+1 Crit Rate Stage",
        cost: 1,
        prerequisites: ["rising_tide"],
        leaning: "aggression",
        delta: { critRateStage: 1 },
      },
      rip_current: {
        id: "rip_current",
        name: "Rip Current",
        cost: 2,
        prerequisites: ["sharpened_shoal"],
        leaning: "sociability",
        // Bridge notable. The third and LAST crit stage this tree grants,
        // and that is not a coincidence: `rollCritical` (combat.ts) clamps
        // the stage to 3, so a fourth would be a node that provably does
        // nothing. The whole tree's crit budget lives on this one bridge.
        delta: { critRateStage: 1, power: 5 },
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
    //
    // v4 conversion (MOVES_DESIGN.md's "Skill-tree template v4 — the
    // two-lane standard"): 40 -> 45 nodes, 12 per branch, every v3 fork
    // kept and moved to the tail of a lane. The fantasy is unchanged; what
    // changed is that each branch now answers it TWICE, in two lanes that
    // differ in kind rather than in degree:
    // - Overwhelm: sustained pressure (bore through, flood the ground you
    //   crossed) vs. commitment (wind up, unload, and on a real connection
    //   never re-pressurise at all). Both end at Undertow Pull.
    // - Bastion: plant your feet (immovable, valve wide open at a real
    //   per-use price) vs. control the stream — Narrow the Stream turns
    //   the base cone into a line, which is this branch's whole thesis
    //   about the dex's own 80 accuracy made visible on the map.
    // - Pod Tide: coordination (mark, converge, reach) vs. keeping the pod
    //   (a fuller wash over a herd-mate, and a pump used to strip a canopy
    //   crop for the herd instead of to fight).
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
        prerequisites: ["building_pressure"],
        leaning: "aggression",
        // LANE B, filler. Steadying the nozzle before the release — the
        // commitment lane, opposite lane A's sustained pressure.
        delta: { accuracy: 5 },
      },
      bursting_main: {
        id: "bursting_main",
        name: "Bursting Main",
        cost: 1,
        prerequisites: ["pump_conditioning"],
        leaning: "aggression",
        delta: { defensePenetration: 0.3 },
      },
      flooding_wake: {
        id: "flooding_wake",
        name: "Flooding Wake",
        cost: 1,
        // LANE NOTABLE A (v4): lane A is sustained pressure — it bores
        // through (Bursting Main) and leaves the ground it crossed
        // underwater. Also the landing point for the Aggression<->Boldness
        // bridge, which skips the lane's grind but not its decisions.
        prerequisitesAnyOf: [["bursting_main"], ["unified_current"]],
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
        prerequisites: ["flooding_wake"],
        leaning: "aggression",
        // Honest caveat, not hidden: this move's own footprint is fixed at
        // `shape.length` (4 by default, or 5 if the Boldness branch's
        // Narrow the Stream has been taken) regardless of `range.max` — range
        // only governs how far away a target can be for the attacker to
        // *decide* to fire (`moveRange`/`withinMoveRange`, combat.ts), not
        // how far the resolved blast itself reaches. A target at the new,
        // farther edge of range won't necessarily end up inside the cone.
        // See MOVES_DESIGN.md's "range vs. shape are decoupled" note.
        delta: { range: { max: 5 } },
      },
      pressure_holds: {
        id: "pressure_holds",
        name: "Pressure Holds",
        cost: 1,
        // LANE NOTABLE B (v4), and the landing point for the
        // Sociability<->Aggression bridge.
        prerequisitesAnyOf: [["overwhelm_footing"], ["violent_confluence"]],
        leaning: "aggression",
        // Lane B is commitment: wind up, unload, and — once a blast really
        // connects — the main is still full, so it fires again immediately
        // instead of re-pressurising (`critCooldownReset`, combat.ts's own
        // crit path). Deliberately not another cooldown delta: this one is
        // earned per crit, and it is what makes the nuke-vs-volley fork
        // below a real choice rather than a coin flip.
        delta: { critCooldownReset: true },
      },
      overwhelm_surge: {
        id: "overwhelm_surge",
        name: "Overwhelm",
        cost: 1,
        prerequisites: ["pressure_holds"],
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
        prerequisites: ["pressure_holds"],
        excludes: ["overwhelm_surge"],
        leaning: "aggression",
        delta: { hits: { min: 2, max: 2 }, power: -20 },
      },
      undertow_pull: {
        id: "undertow_pull",
        name: "Undertow Pull",
        cost: 2,
        // DEEP NOTABLE (v4): both lanes end here — the sustained-pressure
        // lane's widened main and either side of the commitment fork.
        prerequisitesAnyOf: [["widening_main"], ["overwhelm_surge"], ["relentless_surge"]],
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
      open_the_valve: {
        id: "open_the_valve",
        name: "Open the Valve",
        cost: 1,
        prerequisites: ["bastion_footing"],
        leaning: "boldness",
        // LANE A, filler. You can only hold the valve wide open if you are
        // planted — so the lane that plants its feet is the one allowed to.
        // A real per-use price in the same node as the payoff (principle 4):
        // `selfCostPerUse` drains the user's own energy every cast
        // (predation.ts's `resolveHit`), the roster's second use of a lever
        // it has barely touched.
        delta: { power: 15, selfCostPerUse: { need: "energy", amount: 0.05 } },
      },
      channel_footing: {
        id: "channel_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["wading_advance"],
        leaning: "boldness",
        // LANE B, filler — the control lane. Hydro Pump's canonically bad
        // accuracy is this branch's whole subject, so lane B starts by
        // tightening the stream rather than by bracing against it.
        delta: { accuracy: 5 },
      },
      undertow_anchor: {
        id: "undertow_anchor",
        name: "Undertow Anchor",
        cost: 1,
        // LANE NOTABLE A (v4), and the Aggression<->Boldness bridge's
        // landing point on this branch.
        prerequisitesAnyOf: [["open_the_valve"], ["unified_current"]],
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
        prerequisites: ["undertow_anchor"],
        leaning: "boldness",
        delta: { range: { max: 5 } },
      },
      narrow_the_stream: {
        id: "narrow_the_stream",
        name: "Narrow the Stream",
        cost: 1,
        // LANE NOTABLE B (v4), and the Boldness<->Sociability bridge's
        // landing point on this branch.
        prerequisitesAnyOf: [["channel_footing"], ["communal_current"]],
        leaning: "boldness",
        // The branch's thesis, made literal and visible on the map: stop
        // spraying. The base move's wide `cone` (length 4, width 2) becomes
        // a `line` five tiles long — fewer tiles hit, but every one of them
        // in front of you, at the exact reach Channel Grip buys. A real
        // trade, not an upgrade, and the only `shape` setter in this tree
        // (shape is an overwrite field — see MOVES_DESIGN.md principle 14:
        // notable-tier currency, never filler).
        delta: { shape: { kind: "line", length: 5 } },
      },
      bracing_wave: {
        id: "bracing_wave",
        name: "Bracing Wave",
        cost: 1,
        prerequisites: ["narrow_the_stream"],
        excludes: ["riptide_counter"],
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: { power: -5 },
      },
      riptide_counter: {
        id: "riptide_counter",
        name: "Riptide Counter",
        cost: 1,
        prerequisites: ["narrow_the_stream"],
        excludes: ["bracing_wave"],
        leaning: "boldness",
        // Punishes whoever tries to catch it off guard mid-channel.
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      fouling_backwash: {
        id: "fouling_backwash",
        name: "Fouling Backwash",
        cost: 2,
        // DEEP NOTABLE (v4): the planted lane's own reach, or either side
        // of the control lane's fork, all end here.
        prerequisitesAnyOf: [["channel_grip"], ["bracing_wave"], ["riptide_counter"]],
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
        prerequisites: ["pod_footing"],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      wake_rally: {
        id: "wake_rally",
        name: "Wake Rally",
        cost: 1,
        // LANE NOTABLE A (v4), and the Sociability<->Aggression bridge's
        // landing point on this branch. Lane A is coordination: the pod
        // converges, and reaches further to do it.
        prerequisitesAnyOf: [["wake_footing"], ["violent_confluence"]],
        leaning: "sociability",
        // The surge marks a target for the whole pod to converge on.
        delta: { rallyCall: { ticks: 20 } },
      },
      pod_reach: {
        id: "pod_reach",
        name: "+1 Range",
        cost: 1,
        prerequisites: ["wake_rally"],
        leaning: "sociability",
        delta: { range: { max: 5 } },
      },
      fuller_wash: {
        id: "fuller_wash",
        name: "Fuller Wash",
        cost: 1,
        prerequisites: ["pod_current"],
        leaning: "sociability",
        // LANE B, filler. Lane B is the other half of "the pod cares for
        // itself" — not converging on a threat, but keeping the pod: the
        // opener's own wash over a herd-mate goes from 15% to 22% of their
        // max HP. Deliberately a `delta`, not another healing passive —
        // `agent.passives` totals stack across every move a species knows
        // and are the scarcest currency in the system.
        delta: { allyEffect: { healFraction: 0.22 } },
      },
      strip_the_canopy: {
        id: "strip_the_canopy",
        name: "Strip the Canopy",
        cost: 1,
        // LANE NOTABLE B (v4), and the Boldness<->Sociability bridge's
        // landing point on this branch.
        prerequisitesAnyOf: [["fuller_wash"], ["communal_current"]],
        leaning: "sociability",
        // The pod turns the pump on a fruiting tree instead of on an
        // animal: a jet strong enough to move bodies knocks a canopy crop
        // down in a fraction of the time. Real and already wired —
        // needs.ts's canopy-harvest path substitutes any off-cooldown
        // damage move for the dig, scaling with its `range.max` and adding
        // its `gatherBurst` on top. The one node in this tree that feeds
        // the herd rather than fighting for it.
        delta: { gatherBurst: 3 },
      },
      undertow_guard: {
        id: "undertow_guard",
        name: "Undertow Guard",
        cost: 1,
        prerequisites: ["strip_the_canopy"],
        excludes: ["riptide_charge"],
        leaning: "sociability",
        // Protectively shoves the threat back from the herd.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      riptide_charge: {
        id: "riptide_charge",
        name: "Riptide Charge",
        cost: 1,
        prerequisites: ["strip_the_canopy"],
        excludes: ["undertow_guard"],
        leaning: "sociability",
        // Surges forward to meet the threat before it reaches the herd.
        delta: { forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" } },
      },
      pod_instinct: {
        id: "pod_instinct",
        name: "+8% Lifesteal",
        cost: 2,
        // DEEP NOTABLE (v4): the coordination lane's own reach, or either
        // side of the guardianship lane's fork, all end here.
        prerequisitesAnyOf: [["pod_reach"], ["undertow_guard"], ["riptide_charge"]],
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
        // Planting your feet alongside someone else both shortens the
        // wind-up Building Pressure introduces and steadies the aim — the
        // benefit lives in the same node as the commitment it pays off
        // (principle 4), and the accuracy half is on-fantasy rather than a
        // bolt-on: a braced stance is exactly what this move's canonically
        // bad aim is missing.
        delta: { lockTicks: -1, accuracy: 5 },
      },
      // Bridge tail (see MOVES_DESIGN.md's "Crosslinks as bridges"):
      // extends Surge and Brace into Aggression's and Boldness's own
      // pre-fork nodes (Widening Main / Channel Grip).
      brace_conditioning: {
        id: "brace_conditioning",
        name: "Deeper Brace",
        cost: 1,
        prerequisites: ["surge_and_brace"],
        leaning: "aggression",
        // Deepens the same wind-up-softening lever Surge and Brace already
        // introduced (principle 13) rather than the generic cooldown
        // bolt-on this was: a second -1 `lockTicks` is what pays off the
        // all-in Aggression build, whose Building Pressure (+1) and
        // Overwhelm (+1) put it at +2 — this bridge is the only thing in
        // the tree that fully cancels the wind-up it commits to. Keeps its
        // -1 cooldown so the tree's total tempo is unchanged at -4 of the
        // -6 the 3x cap allows.
        delta: { lockTicks: -1, cooldownTicks: -1 },
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
        prerequisites: ["gathering_light"],
        name: "-1 Cooldown",
        cost: 1,
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      dominance_footing: {
        id: "dominance_footing",
        prerequisites: ["gathering_light"],
        name: "+5 Accuracy",
        cost: 1,
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      piercing_ray: {
        id: "piercing_ray",
        prerequisitesAnyOf: [["sunlit_focus"], ["heliostand"]],
        name: "Piercing Ray",
        cost: 1,
        leaning: "aggression",
        delta: { defensePenetration: 0.3 },
      },
      widening_beam: {
        id: "widening_beam",
        prerequisitesAnyOf: [["dominance_footing"], ["sunspot"]],
        name: "+2 Range",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Aggression (Rooted Assault's and Territorial
        // Flare's own chains).
        leaning: "aggression",
        delta: { range: { max: 7 } },
      },
      withering_glare: {
        id: "withering_glare",
        prerequisites: ["widening_beam"],
        name: "Withering Glare",
        cost: 1,
        excludes: ["overwhelming_beam"],
        leaning: "aggression",
        // Catches a challenger off guard, before it's even noticed the
        // light gathering.
        delta: { cooldownTicks: -1, situationalBonus: { condition: "flanking", multiplier: 1.4 } },
      },
      overwhelming_beam: {
        id: "overwhelming_beam",
        prerequisites: ["widening_beam"],
        name: "Overwhelming Beam",
        cost: 1,
        excludes: ["withering_glare"],
        leaning: "aggression",
        // An all-in blast that leaves the user briefly exposed after.
        delta: { power: 20, lockTicks: 1 },
      },
      claim_the_grove: {
        id: "claim_the_grove",
        prerequisites: ["dominant_bloom"],
        name: "Claim the Grove",
        cost: 2,
        leaning: "aggression",
        // A rival Grass-type challenger gets punished hardest — a real
        // clash over territory, not a generic type-matchup bonus.
        delta: { bonusVsType: { type: "grass", multiplier: 1.5 } },
      },
      dominance_precision: {
        id: "dominance_precision",
        prerequisites: ["piercing_ray"],
        name: "+5 Accuracy",
        cost: 1,
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      sovereigns_beam: {
        id: "sovereigns_beam",
        prerequisites: ["claim_the_grove"],
        name: "Sovereign's Beam",
        cost: 2,
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
        prerequisites: ["sunlit_roots"],
        name: "+5 Accuracy",
        cost: 1,
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      bloom_footing: {
        id: "bloom_footing",
        prerequisites: ["sunlit_roots"],
        name: "-1 Cooldown",
        cost: 1,
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      steadfast_bloom: {
        id: "steadfast_bloom",
        prerequisitesAnyOf: [["bloom_footing"], ["the_canopy"]],
        name: "Steadfast Bloom",
        cost: 1,
        leaning: "boldness",
        delta: { defensePenetration: 0.2 },
      },
      deepening_roots: {
        id: "deepening_roots",
        prerequisitesAnyOf: [["bulwark_resolve"], ["guardians_ground"], ["verdant_wall"]],
        name: "+2 Range",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Boldness (Rooted Assault's and Shared Shade's own
        // chains).
        leaning: "boldness",
        delta: { range: { max: 7 } },
      },
      guardians_ground: {
        id: "guardians_ground",
        prerequisites: ["steadfast_bloom"],
        name: "Guardian's Ground",
        cost: 1,
        excludes: ["verdant_wall"],
        leaning: "boldness",
        // Holds the high, defensible ground rather than turtling in place.
        delta: { cooldownTicks: -1, situationalBonus: { condition: "elevation", multiplier: 1.3 } },
      },
      verdant_wall: {
        id: "verdant_wall",
        prerequisites: ["steadfast_bloom"],
        name: "Verdant Wall",
        cost: 1,
        excludes: ["guardians_ground"],
        leaning: "boldness",
        // Retaliates against anyone striking while it channels.
        grantsPassive: { kind: "thorns", value: 0.12 },
        delta: {},
      },
      bulwark_bloom: {
        id: "bulwark_bloom",
        prerequisites: ["deepening_roots"],
        name: "Bulwark Bloom",
        cost: 2,
        leaning: "boldness",
        // The beam's own recoiling light physically repels whoever it
        // strikes — a defensive push, not just a bigger hit.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      bulwark_resolve: {
        id: "bulwark_resolve",
        prerequisites: ["bedrock_beam"],
        name: "+5 Accuracy",
        cost: 1,
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      ancient_grove: {
        id: "ancient_grove",
        prerequisites: ["bulwark_bloom"],
        name: "Ancient Grove",
        cost: 2,
        leaning: "boldness",
        // An immovable, ancient guardian that punishes and endures. The
        // node's own comment said "immovable" and then granted regen; it now
        // grants what it describes. (`immovable` is `> 0`-gated in status.ts
        // rather than summed, so this is the tree's only grant of it — a
        // second one anywhere in Solar Beam would be a dead node.)
        grantsPassives: [
          { kind: "thorns", value: 0.1 },
          { kind: "immovable", value: 1 },
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
        prerequisites: ["grove_ward"],
        name: "+5 Accuracy",
        cost: 1,
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      grove_reach: {
        id: "grove_reach",
        prerequisites: ["grove_footing"],
        name: "+2 Range",
        cost: 1,
        leaning: "sociability",
        delta: { range: { max: 7 } },
      },
      grove_muster: {
        id: "grove_muster",
        prerequisitesAnyOf: [["grove_reach"], ["sunspot"]],
        name: "Grove Muster",
        cost: 1,
        leaning: "sociability",
        // The grove calls on the herd to converge and defend it together.
        delta: { rallyCall: { ticks: 20 } },
      },
      grove_precision: {
        id: "grove_precision",
        prerequisites: ["grove_muster"],
        name: "+5 Accuracy",
        cost: 1,
        // Reachable the normal way, or via either crosslink bridge that
        // reaches into Sociability (Shared Shade's and Territorial
        // Flare's own chains).
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      vital_bloom: {
        id: "vital_bloom",
        prerequisites: ["grove_bulwark"],
        name: "Vital Bloom",
        cost: 1,
        excludes: ["steadfast_bloom_ally"],
        leaning: "sociability",
        // Explicit fork over the same "later node wins" ally-effect
        // overwrite Tackle's own tree already relies on implicitly — here
        // it's a real, deliberate choice between healing the grove...
        delta: { allyEffect: { healFraction: 0.25 } },
      },
      steadfast_bloom_ally: {
        id: "steadfast_bloom_ally",
        prerequisites: ["grove_bulwark"],
        name: "Steadfast Bloom",
        cost: 1,
        excludes: ["vital_bloom"],
        leaning: "sociability",
        // ...or steeling it instead.
        delta: { allyEffect: { buff: { stat: "defense", stage: 2, ticks: 20 } } },
      },
      grove_instinct: {
        id: "grove_instinct",
        prerequisites: ["the_grove_answers"],
        name: "+5 Accuracy",
        cost: 1,
        leaning: "sociability",
        delta: { cooldownTicks: -2, accuracy: 5 },
      },
      the_grove_answers: {
        id: "the_grove_answers",
        prerequisitesAnyOf: [["grove_precision"], ["vital_bloom"], ["steadfast_bloom_ally"]],
        name: "The Grove Answers",
        cost: 2,
        leaning: "sociability",
        // DEEP NOTABLE. Both lanes end here: the beam stops being one
        // guardian's and becomes the grove's answer to being encroached on.
        // 0.01 -> 0.006: group healing is held to a stricter standard than
        // self-healing, since one node pays out to the whole herd every tick.
        grantsPassive: { kind: "healAura", value: 0.006 },
        delta: { allyEffectOnAttack: true },
      },
      sunward_stance: {
        id: "sunward_stance",
        prerequisites: ["rooted_assault"],
        name: "Sunward Stance",
        cost: 1,
        leaning: "boldness",
        // Bridge filler — deepens Rooted Assault's own penetration lever.
        delta: { defensePenetration: 0.1 },
      },
      heliostand: {
        id: "heliostand",
        prerequisites: ["sunward_stance"],
        name: "Heliostand",
        cost: 2,
        leaning: "aggression",
        // BRIDGE NOTABLE. Rooted through the recoil, so the beam goes
        // through what it is aimed at rather than shoving it.
        delta: { defensePenetration: 0.2, power: 10 },
      },
      deeper_shade: {
        id: "deeper_shade",
        prerequisites: ["shared_shade"],
        name: "Deeper Shade",
        cost: 1,
        leaning: "boldness",
        // Bridge filler. Was "+1 HP Regen", deepening Shared Shade's healing;
        // it now deepens the shade itself. Shade is cover, and cover is a
        // Boldness flavour — the branch keeps its lever without adding a
        // fourth healing node to a tree that had seven.
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
        delta: {},
      },
      the_canopy: {
        id: "the_canopy",
        prerequisites: ["deeper_shade"],
        name: "The Canopy",
        cost: 2,
        leaning: "sociability",
        // BRIDGE NOTABLE. Shade thick enough that standing under it is
        // itself the recovery. Trimmed against the per-move healing budget,
        // aura harder than self: 1.5 -> 1.0 flat, 0.008 -> 0.005 aura.
        grantsPassives: [
          { kind: "regenFlat", value: 1 },
          { kind: "healAura", value: 0.005 },
        ],
        delta: {},
      },
      flare_wider: {
        id: "flare_wider",
        prerequisites: ["territorial_flare"],
        name: "Flare Wider",
        cost: 1,
        leaning: "sociability",
        // Bridge filler — deepens Territorial Flare's own condition lever.
        delta: { situationalBonus: { condition: "targetLowHp", multiplier: 1.3 } },
      },
      sunspot: {
        id: "sunspot",
        prerequisites: ["flare_wider"],
        name: "Sunspot",
        cost: 2,
        leaning: "aggression",
        // BRIDGE NOTABLE. The flare escalated into a held burn on whatever
        // strayed into the grove's ground.
        delta: { situationalBonus: { condition: "targetLowHp", multiplier: 1.6 }, critRateStage: 1 },
      },
      eternal_grove: {
        id: "eternal_grove",
        prerequisites: ["grove_instinct"],
        name: "Eternal Grove",
        cost: 2,
        leaning: "sociability",
        // 0.04 -> 0.025. The `allyEffect` heal in this node's delta is the
        // real payload; the passive was doubling up on it.
        grantsPassive: { kind: "regen", value: 0.025 },
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.25, buff: { stat: "spAttack", stage: 1, ticks: 20 } } },
      },
      // Crosslink: Aggression <-> Boldness — the guardian's own steady
      // roots feed the beam's focus.
      rooted_assault: {
        id: "rooted_assault",
        prerequisites: ["gathering_light", "sunlit_roots"],
        name: "Rooted Assault",
        cost: 1,
        leaning: "aggression",
        delta: { defensePenetration: 0.2 },
      },
      // Bridge tail (see MOVES_DESIGN.md's "Crosslinks as bridges"):
      // extends Rooted Assault into Aggression's and Boldness's own
      // pre-fork nodes (Widening Beam / Deepening Roots).
      sunlit_focus: {
        id: "sunlit_focus",
        prerequisites: ["focusing_lens"],
        name: "+0.1 Defense Penetration",
        cost: 1,
        leaning: "aggression",
        // Deepens Rooted Assault's own lever directly, instead of a
        // generic accuracy bolt-on.
        delta: { defensePenetration: 0.1 },
      },
      bedrock_beam: {
        id: "bedrock_beam",
        prerequisitesAnyOf: [["canopy_footing"], ["heliostand"]],
        name: "Bedrock Beam",
        cost: 2,
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
        prerequisites: ["sunlit_roots", "grove_ward"],
        name: "Shared Shade",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "regenFlat", value: 1.5 },
        delta: {},
      },
      // Bridge tail: extends Shared Shade into Boldness's and
      // Sociability's own pre-fork nodes (Deepening Roots / Grove
      // Precision).
      canopy_footing: {
        id: "canopy_footing",
        prerequisites: ["bulwark_footing"],
        name: "Rooted Footing",
        cost: 1,
        leaning: "boldness",
        // Was literally named "+0.75 HP Regen" — a placeholder name is a tell
        // that the node had no idea, and it was the seventh healing node in
        // one tree. Its prerequisite is Bulwark Footing; planting your feet
        // is what it should have been doing all along, and flat mitigation is
        // early-strong/late-marginal exactly like the flat regen it replaces.
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: {},
      },
      grove_bulwark: {
        id: "grove_bulwark",
        prerequisitesAnyOf: [["territorial_footing"], ["the_canopy"]],
        name: "Grove Bulwark",
        cost: 2,
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
        prerequisites: ["grove_ward", "gathering_light"],
        name: "Territorial Flare",
        cost: 1,
        leaning: "sociability",
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.3 } },
      },
      // Bridge tail: extends Territorial Flare into Sociability's and
      // Aggression's own pre-fork nodes (Grove Precision / Widening Beam).
      territorial_footing: {
        id: "territorial_footing",
        prerequisites: ["grove_ward"],
        name: "+1 Crit Rate Stage",
        cost: 1,
        leaning: "sociability",
        // Catching a challenger off guard is exactly when a solid hit
        // becomes a great one — ties Dominance's own crit lever (Gathering
        // Light) in, instead of a generic accuracy bolt-on.
        delta: { critRateStage: 1 },
      },
      dominant_bloom: {
        id: "dominant_bloom",
        prerequisitesAnyOf: [["dominance_precision"], ["withering_glare"], ["overwhelming_beam"]],
        name: "Triple Bloom",
        cost: 2,
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
    // THE FANTASY (v3's "start from the fantasy" pass, unchanged by the v4
    // conversion — see MOVES_DESIGN.md's Earthquake worked example):
    // Earthquake is not aimed. The user drops its whole weight through its
    // feet and the fault answers — the ground heaves outward in every
    // direction at once and everything standing on it goes down together:
    // the thing it was angry at, the thing beside that, its own herd-mates,
    // itself. There is no behind. And what is left afterwards is not the
    // ground that was there before — split, churned, unwalkable. Its danger
    // and its cost are the same fact: it cannot tell whose feet it is under.
    // That is real, current engine behavior (`resolveAreaHit` has no herd
    // filter by default), not flavor text, and it is the design space each
    // branch answers differently:
    // - Aggression ("Overload"): answer the blindness by leaning into it —
    //   heavier, faster, more often, until the quaker is taking damage off
    //   its own fault line. The one real choice is the footprint: spread the
    //   collapse or drive it straight down. Ends on a spiral (Cataclysm) in
    //   which the recoil creates the very condition its own bonus reads.
    // - Boldness ("Fracture"): the ground is both the weapon and the
    //   property. Break it (`terrainFill: "mud"` from the opener), refuse to
    //   be moved on it, shove everyone else off it — then EAT it: Eat the
    //   Ruin's `consumesOwnTerrain` spends the exact mud this move's own
    //   opener lays down. Nothing else in the roster makes its own
    //   consumable terrain and then consumes it; Rock Throw eats boulders it
    //   did not create.
    // - Sociability ("Herdsafe Ground"): the flaw, drilled out. A herd that
    //   has learned to read the fault is not caught in it (`excludesAllies`,
    //   the primitive this redesign needed), and then the shock becomes a
    //   provision — bracing, spurring, and literally shaking the canopy down
    //   onto them (`gatherBurst`; needs.ts's canopy-harvest path takes any
    //   non-status damage move off cooldown as the harvest move, so this
    //   fires for real on Earthquake).
    //
    // Template v4 (45 nodes): each branch is opener + two parallel lanes
    // (each with its own lane notable) + a deep notable both lanes converge
    // on + a filler + a capstone, plus three three-node crosslink bridges.
    // The lanes are deliberately different in KIND, not degree:
    //   Aggression  lane A = it doesn't stop (tempo, volume, sustain)
    //               lane B = one enormous drop (mass, and the footprint fork)
    //   Boldness    lane A = the quaker's own footing (planted, immovable)
    //               lane B = everyone else's ground (shoved, broken, eaten)
    //   Sociability lane A = what the quake GIVES the herd (food, healing)
    //               lane B = what the herd DOES in it (brace, or surge)
    tree: {
      // --- Aggression: Overload ------------------------------------------
      fault_trigger: {
        id: "fault_trigger",
        name: "Fault Trigger",
        cost: 1,
        leaning: "aggression",
        // The bigger the mover, the bigger the quake it can trigger.
        delta: { weightScaling: { factor: 0.12 } },
      },
      // Lane A — "it doesn't stop": tempo, volume, and feeding off the ruin.
      shaking_ground: {
        id: "shaking_ground",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["fault_trigger"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      aftershock_barrage: {
        id: "aftershock_barrage",
        name: "Aftershock Barrage",
        cost: 1,
        prerequisites: ["shaking_ground"],
        leaning: "aggression",
        delta: { hits: { min: 2, max: 2 }, power: -10 },
      },
      seismic_feed: {
        id: "seismic_feed",
        name: "Seismic Feed",
        cost: 1,
        // LANE NOTABLE (lane A). Reachable the normal way, or via Cracking
        // Momentum's bridge — a lunge dropped into the lane that is already
        // about not stopping.
        prerequisitesAnyOf: [["aftershock_barrage"], ["fault_convergence"]],
        leaning: "aggression",
        // The lane's whole point in one node: it feeds on what it shakes
        // loose, and a clean hit rolls it straight back into the next shock
        // instead of waiting out the cooldown. `critCooldownReset` is the
        // only lever in the roster that turns a crit into tempo rather than
        // damage, which is exactly this lane's kind.
        delta: { lifestealFraction: 0.08, critCooldownReset: true },
      },
      overload_precision: {
        id: "overload_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["seismic_feed"],
        leaning: "aggression",
        delta: { accuracy: 5 },
      },
      // Lane B — "one enormous drop": mass, and the footprint decision.
      overload_footing: {
        id: "overload_footing",
        name: "Reckless Overload",
        cost: 1,
        prerequisites: ["fault_trigger"],
        leaning: "aggression",
        // Fixed a real bug here: this node used to be `recoilFraction: 0.1`
        // alone — a full skill point spent on nothing but self-damage, no
        // tradeoff at all. Recoil is a real lever everywhere else in the
        // roster (Cataclysm below, Tackle's own keystones, Ember's Pyroclasm)
        // ONLY when paired with the power it's buying in the same node.
        // Paired here to match.
        delta: { power: 10, recoilFraction: 0.1 },
      },
      crushing_mass: {
        id: "crushing_mass",
        name: "Crushing Mass",
        cost: 1,
        // LANE NOTABLE (lane B). Reachable the normal way, or via
        // Coordinated Tremor's bridge — the herd clears, and what is left
        // gets the whole body dropped on it.
        prerequisitesAnyOf: [["overload_footing"], ["converged_ruin"]],
        leaning: "aggression",
        // Doubles down on the opener's own weight scaling (overwrite, and
        // Fault Trigger is an ancestor on every route) and charges a real
        // stamina cost for it in the same node — dropping this much mass is
        // not free. `selfCostPerUse` has exactly one other user in the whole
        // roster.
        delta: { weightScaling: { factor: 0.24 }, selfCostPerUse: { need: "energy", amount: 0.05 } },
      },
      total_collapse: {
        id: "total_collapse",
        name: "Total Collapse",
        cost: 1,
        prerequisites: ["crushing_mass"],
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
        prerequisites: ["crushing_mass"],
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
        // DEEP NOTABLE — both lanes end here: lane A's tail and both tips of
        // lane B's fork.
        prerequisitesAnyOf: [["overload_precision"], ["total_collapse"], ["focused_rupture"]],
        leaning: "aggression",
        // One fault sets off the next, and anything caught between two
        // shocks never gets its feet back under it. The tree's only
        // `statChangeOnHit`, so no build can collide with it.
        delta: { critRateStage: 1, statChangeOnHit: { target: "defender", stat: "speed", stage: -1, ticks: 20 } },
      },
      overload_cadence: {
        id: "overload_cadence",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["chain_reaction"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      cataclysm: {
        id: "cataclysm",
        name: "Cataclysm",
        cost: 2,
        prerequisites: ["overload_cadence"],
        leaning: "aggression",
        // CAPSTONE. A spiral, not a bigger number: the branch's own recoil
        // is what CREATES the low-HP state this bonus reads, so an Overload
        // build gets stronger as it destroys itself. Three shipped moves use
        // `selfStateBonus` as a standalone "hurt hits harder" bonus; none of
        // them pairs it with the move's own self-damage, which is the part
        // that is new here.
        delta: { power: 20, recoilFraction: 0.05, selfStateBonus: { condition: "selfLowHp", multiplier: 1.5 } },
      },
      // --- Boldness: Fracture ---------------------------------------------
      fissure_grip: {
        id: "fissure_grip",
        name: "Fissure Grip",
        cost: 1,
        leaning: "boldness",
        // Wherever this lands, the ground cracks into real, treacherous
        // rubble — the terraforming half of the fantasy, live from the
        // opener, not saved for a keystone. Also the resource the branch's
        // capstone later spends.
        delta: { terrainFill: { terrain: "mud" } },
      },
      // Lane A — "my own footing": the one thing the quake does not move.
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
        name: "+0.15 Defense Penetration",
        cost: 1,
        prerequisites: ["bedrock_footing_2"],
        leaning: "boldness",
        // Was "+1 Range" (`range: { max: 3 }`), byte-for-byte the same node
        // as Sociability's Tremor Reach in this same tree — the in-tree
        // version of the copy-paste failure template v3 exists to stop, and
        // a real OVERWRITE collision between two co-takeable branches.
        // Repointed at the lever this lane is actually about: driving the
        // shock down THROUGH whatever is standing on it.
        delta: { defensePenetration: 0.15 },
      },
      bedrock_anchor: {
        id: "bedrock_anchor",
        name: "Bedrock Anchor",
        cost: 1,
        // LANE NOTABLE (lane A). Reachable the normal way, or via Fractured
        // Warning's bridge — the warning that throws everyone else's footing
        // off, landing in the lane that is about never losing your own.
        prerequisitesAnyOf: [["cracking_footing"], ["warded_convergence"]],
        leaning: "boldness",
        // Drives itself into the ground: the quake goes deeper because none
        // of it is spent staying upright, and it is not going anywhere for a
        // beat afterwards. The lock is the price, in the same node.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: { power: 12, lockTicks: 1 },
      },
      fracture_precision: {
        id: "fracture_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["bedrock_anchor"],
        leaning: "boldness",
        delta: { accuracy: 5 },
      },
      // Lane B — "everyone else's ground": shoved off it, or pinned on it.
      deepening_fissure: {
        id: "deepening_fissure",
        name: "+0.3 Defense Penetration",
        cost: 1,
        prerequisites: ["fissure_grip"],
        leaning: "boldness",
        delta: { defensePenetration: 0.3 },
      },
      rubble_wall: {
        id: "rubble_wall",
        name: "Rubble Wall",
        cost: 1,
        // LANE NOTABLE (lane B). Reachable the normal way, or via Cracking
        // Momentum's bridge, whose whole lever is forced movement.
        prerequisitesAnyOf: [["deepening_fissure"], ["fault_convergence"]],
        leaning: "boldness",
        // The rubble itself shoves anyone standing on it away from the
        // epicenter.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" } },
      },
      widening_rift: {
        id: "widening_rift",
        name: "Widening Rift",
        cost: 1,
        prerequisites: ["rubble_wall"],
        excludes: ["grounding_brace"],
        leaning: "boldness",
        // Was `shape: { kind: "burst", radius: 3 }` — identical to
        // Aggression's own Total Collapse in this same tree, and the source
        // of two real checker failures (a `shape` OVERWRITE collision across
        // co-takeable branches, and two independently-takeable shape nodes;
        // a move has one footprint). Repointed to the fork's actual
        // question: the rift keeps opening, so everything on it slides
        // further out — against Grounding Brace, which plants on it instead.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 2, timing: "onHit" } },
      },
      grounding_brace: {
        id: "grounding_brace",
        name: "Grounding Brace",
        cost: 1,
        prerequisites: ["rubble_wall"],
        excludes: ["widening_rift"],
        leaning: "boldness",
        // Braces so hard against its own tremor that it can't immediately
        // follow up — a real cost for the extra protection.
        grantsPassive: { kind: "damageReductionFlat", value: 2 },
        delta: { lockTicks: 1 },
      },
      ruinous_ground: {
        id: "ruinous_ground",
        name: "Ruinous Ground",
        cost: 2,
        // DEEP NOTABLE — lane A's tail and both tips of lane B's fork.
        prerequisitesAnyOf: [["fracture_precision"], ["widening_rift"], ["grounding_brace"]],
        leaning: "boldness",
        // Fixes Ground's real Grass/Bug resists — nothing resists the ground
        // itself.
        delta: { resistanceBreaker: { multiplier: 2 } },
      },
      settling_ground: {
        id: "settling_ground",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["ruinous_ground"],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      eat_the_ruin: {
        id: "eat_the_ruin",
        name: "Eat the Ruin",
        cost: 2,
        prerequisites: ["settling_ground"],
        leaning: "boldness",
        // CAPSTONE, and a closed loop the roster does not otherwise have:
        // Fissure Grip turns the ground this move lands on into mud, and
        // this spends it. `consumesOwnTerrain` reads the ATTACKER's own tile
        // (predation.ts) and reverts it to plain floor on use, so the payoff
        // is self-limiting — a Fracture build has to keep breaking new
        // ground to keep eating it. Rock Throw consumes boulders, but it
        // never made them; Leech Seed eats flora it did not plant.
        delta: { consumesOwnTerrain: { terrain: "mud", damageMultiplier: 2.5 }, defensePenetration: 0.2 },
      },
      // --- Sociability: Herdsafe Ground ------------------------------------
      herdsafe_trigger: {
        id: "herdsafe_trigger",
        name: "Herdsafe Trigger",
        cost: 1,
        leaning: "sociability",
        // The branch's whole point, live from the opener: a herd drilled
        // on this move stops getting caught in its own quake.
        delta: { excludesAllies: true },
      },
      // Lane A — "what the quake gives the herd": food, then healing.
      shaken_loose: {
        id: "shaken_loose",
        name: "Shaken Loose",
        cost: 1,
        prerequisites: ["herdsafe_trigger"],
        leaning: "sociability",
        // Was `warning_footing`, "+8% Lifesteal" — byte-for-byte Aggression's
        // own Seismic Feed in this same tree, and lifesteal has nothing to do
        // with a herd drill. Replaced with the thing a quake actually does
        // for a herd: it shakes the canopy down. Real, not flavour —
        // needs.ts's canopy-harvest path picks any non-status damage move
        // that is off cooldown as the harvest move and adds its `gatherBurst`
        // straight to `digTicksAccrued`.
        delta: { gatherBurst: 2 },
      },
      herd_precision: {
        id: "herd_precision",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["shaken_loose"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      communal_steadying: {
        id: "communal_steadying",
        name: "Communal Steadying",
        cost: 1,
        // LANE NOTABLE (lane A). Reachable the normal way, or via Fractured
        // Warning's bridge.
        prerequisitesAnyOf: [["herd_precision"], ["warded_convergence"]],
        leaning: "sociability",
        grantsPassive: { kind: "regen", value: 0.03 },
        delta: {},
      },
      tremor_reach: {
        id: "tremor_reach",
        name: "+1 Range",
        cost: 1,
        prerequisites: ["communal_steadying"],
        leaning: "sociability",
        delta: { range: { max: 3 } },
      },
      // Lane B — "what the herd does in it": brace behind it, or surge on it.
      herdsafe_footing: {
        id: "herdsafe_footing",
        name: "+5 Accuracy",
        cost: 1,
        prerequisites: ["herdsafe_trigger"],
        leaning: "sociability",
        delta: { accuracy: 5 },
      },
      bracing_call: {
        id: "bracing_call",
        name: "Bracing Call",
        cost: 1,
        // LANE NOTABLE (lane B). Reachable the normal way, or via
        // Coordinated Tremor's bridge — the mark that tells the herd where
        // the shock is going, landing in the lane about what they do next.
        prerequisitesAnyOf: [["herdsafe_footing"], ["converged_ruin"]],
        leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      guardians_ground: {
        id: "guardians_ground",
        name: "Guardian's Ground",
        cost: 1,
        prerequisites: ["bracing_call"],
        excludes: ["rally_quake"],
        leaning: "sociability",
        grantsPassive: { kind: "damageReductionFlat", value: 1 },
        delta: { power: -5 },
      },
      rally_quake: {
        id: "rally_quake",
        name: "Rally Quake",
        cost: 1,
        prerequisites: ["bracing_call"],
        excludes: ["guardians_ground"],
        leaning: "sociability",
        // The aftershock keeps helping even mid-fight — no dedicated
        // support use needed to trigger it.
        delta: { allyEffectOnAttack: true, allyEffect: { buff: { stat: "attack", stage: 1, ticks: 20 } } },
      },
      the_herd_reads_it: {
        id: "the_herd_reads_it",
        name: "The Herd Reads It",
        cost: 2,
        // DEEP NOTABLE — lane A's tail and both tips of lane B's fork.
        prerequisitesAnyOf: [["tremor_reach"], ["guardians_ground"], ["rally_quake"]],
        leaning: "sociability",
        // Where the two lanes actually meet: the herd has stopped treating
        // the shaking ground as something to contest. Nobody squares up over
        // where to stand when the fault goes off, and they close on what it
        // knocked out of the canopy instead of on each other.
        grantsPassive: { kind: "nonTerritorial", value: 1 },
        delta: { gatherBurst: 2 },
      },
      herd_cadence: {
        id: "herd_cadence",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["the_herd_reads_it"],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      sanctuary_quake: {
        id: "sanctuary_quake",
        name: "Sanctuary Quake",
        cost: 2,
        prerequisites: ["herd_cadence"],
        leaning: "sociability",
        // CAPSTONE. The aftershock settles into a real, ongoing comfort for
        // whoever stayed close — the ultimate payoff of a quake that heals
        // its own people instead of scattering them.
        grantsPassive: { kind: "healAura", value: 0.015 },
        delta: {},
      },
      // --- Crosslink bridges (3 x crosslink -> filler -> cost-2 notable) ---
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
        // BRIDGE NOTABLE. Alternate route into Aggression's Seismic Feed and
        // Boldness's Rubble Wall — one lane notable in each branch the
        // crosslink connects, one step short of either fork.
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
        // BRIDGE NOTABLE. Alternate route into Boldness's Bedrock Anchor and
        // Sociability's Communal Steadying — the two patient, planted lanes.
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
      marked_rupture: {
        id: "marked_rupture",
        name: "Marked Rupture",
        cost: 1,
        prerequisites: ["coordinated_tremor"],
        leaning: "aggression",
        // Bridge filler, and it must deepen its own crosslink's lever rather
        // than reach for a new one (principle 13) — it used to carry ONLY
        // the `rallyMarked` bonus, which shared nothing with Coordinated
        // Tremor's mark and was a real reported failure. It now holds the
        // mark half again as long AND pays off on it, via the shared
        // `"rallyMarked"` `SituationalCondition`.
        delta: { rallyCall: { ticks: 32 }, situationalBonus: { condition: "rallyMarked", multiplier: 1.3 } },
      },
      converged_ruin: {
        id: "converged_ruin",
        name: "Converged Ruin",
        cost: 2,
        prerequisites: ["marked_rupture"],
        leaning: "aggression",
        // BRIDGE NOTABLE. Alternate route into Aggression's Crushing Mass
        // and Sociability's Bracing Call — reaching into BOTH branches the
        // crosslink bridges (principle 11), and landing one step short of
        // each fork rather than on it (principle 12).
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
    // --- The fantasy (v4 rewrite, MOVES_DESIGN.md's "start from the
    // fantasy") ---
    //
    // Onix rears against a slope and the slope lets go. This is not a rock
    // thrown (Rock Throw) and it is not the ground shaking (Earthquake) —
    // it is tons of stone arriving from ABOVE, into a one-tile bowl, onto
    // things whose guard is pointed at the wrong angle. What makes it
    // dangerous is where the user is standing: from the high ground it is
    // gravity doing the work; on the flat it is a slow, heavy move that
    // mostly buries its own feet. It does not pick targets — the herd-mate
    // beside it is under the same rocks — and everything nearby hears it
    // coming a beat before it lands. That beat is the whole Sociability
    // branch; the height is the whole Aggression branch; standing in the
    // middle of your own rockfall and not moving is Boldness.
    //
    // Template v4: 45 nodes — three 12-node branches (opener, two parallel
    // lanes each with their own notable, a deep notable both lanes converge
    // on, a filler, a capstone) plus three 3-node crosslink bridges. Nine
    // `prerequisitesAnyOf` (six lane notables, three deep notables), six
    // fork nodes, every v3 fork preserved.
    tree: {
      // --- Aggression: "the whole face lets go" ---
      // Flavours (the colour pie): stealth/ambush (the elevation the drop
      // comes from), piercing (through a guard, through a resist), raw
      // damage (mass and crit), wider AoE (the fork), aggressive movement
      // (the wall sweeping everything outward at the deep notable).
      // The two lanes differ in KIND: lane A is the DROP (height, and
      // getting through whatever is in the way), lane B is the SLOPE
      // (volume, and whether it comes down wide or concentrated).
      raining_stones: {
        id: "raining_stones",
        name: "Raining Stones",
        cost: 1,
        leaning: "aggression",
        delta: { situationalBonus: { condition: "elevation", multiplier: 1.3 } },
      },
      // Lane A — the drop.
      steadier_aim: {
        id: "steadier_aim",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["raining_stones"],
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
      straight_down: {
        id: "straight_down",
        name: "Straight Down",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Aggression <->
        // Boldness bridge's own notable (Mountainfall).
        prerequisitesAnyOf: [["crushing_debris"], ["mountainfall"]],
        leaning: "aggression",
        // The one thing a fall this heavy answers that a thrown rock does
        // not: being built to shrug rock off. A Ground/Steel/Fighting type
        // still has a hillside on top of it. First `resistanceBreaker` in
        // this tree, and the lane's whole point — the drop goes through.
        delta: { resistanceBreaker: { multiplier: 1.5 } },
      },
      heavier_boulders: {
        id: "heavier_boulders",
        name: "Edge-On",
        cost: 1,
        prerequisites: ["straight_down"],
        leaning: "aggression",
        // Was a second "+5 Power" filler in a branch that already had one
        // (Settling Dust) — the duplicate-filler smell this document has
        // retired elsewhere. Same +5, plus the first crit stage in the
        // tree: a slab that lands on its edge rather than its face.
        delta: { power: 5, critRateStage: 1 },
      },
      // Lane B — the slope itself.
      faster_collapse: {
        id: "faster_collapse",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["raining_stones"],
        leaning: "aggression",
        delta: { cooldownTicks: -1 },
      },
      ground_shaking_impact: {
        id: "ground_shaking_impact",
        name: "Ground-Shaking Impact",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Sociability
        // <-> Aggression bridge's own notable (No Respite).
        prerequisitesAnyOf: [["faster_collapse"], ["no_respite"]],
        leaning: "aggression",
        // Whatever's still standing after the rockfall gets no time to
        // recover before the next one.
        delta: { power: 10, jamCooldownTicks: 1 },
      },
      wider_slide: {
        id: "wider_slide",
        name: "Wider Slide",
        cost: 1,
        prerequisites: ["ground_shaking_impact"],
        excludes: ["heavier_stones"],
        leaning: "aggression",
        // A broader wall of falling stone, spread thinner.
        delta: { shape: { kind: "burst", radius: 2 }, power: -10 },
      },
      heavier_stones: {
        id: "heavier_stones",
        name: "Heavier Stones",
        cost: 1,
        prerequisites: ["ground_shaking_impact"],
        excludes: ["wider_slide"],
        leaning: "aggression",
        // Fewer, bigger boulders, harder to line up.
        delta: { power: 15, accuracy: -10 },
      },
      swept_off: {
        id: "swept_off",
        name: "Swept Off",
        cost: 2,
        // DEEP NOTABLE. Both lanes end here — the drop and the volume add
        // up to a moving wall rather than a rain of separate rocks.
        prerequisitesAnyOf: [["heavier_boulders"], ["wider_slide"], ["heavier_stones"]],
        leaning: "aggression",
        // The debris does not stop where it lands. On an AoE move this
        // resolves per target (resolveAreaHit -> resolveHitAgainstTarget),
        // so the whole bowl gets carried a tile outward — something an
        // observer can SEE happen, which "+10% power" never is. It respects
        // `"immovable"` like any other forced movement, which is exactly
        // what the Boldness branch one over is buying.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 1, timing: "onHit" }, power: 5 },
      },
      settling_dust: {
        id: "settling_dust",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["swept_off"],
        leaning: "aggression",
        delta: { power: 5 },
      },
      avalanche_wall: {
        id: "avalanche_wall",
        name: "Avalanche Wall",
        cost: 2,
        prerequisites: ["settling_dust"],
        leaning: "aggression",
        // CAPSTONE. The whole slope comes down at once, Onix's own real
        // mass adding to the weight of what's already falling.
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
        // BRIDGE NOTABLE. Heaving that much rock is genuinely exhausting —
        // a real per-use cost in the same node as its payoff. Lands on one
        // lane notable per branch it connects: Straight Down (Aggression's
        // drop lane, which is about angle rather than mass, so the bridge
        // complements it) and Unbroken (Boldness's footing lane).
        delta: { power: 12, selfCostPerUse: { need: "energy", amount: 0.05 } },
      },
      // --- Boldness: standing in the middle of your own rockfall ---
      // Flavours: defence (bulk, and the rubble that punishes climbers),
      // raw damage (weight — this branch's thesis), stealth/ambush (the
      // ledge it drops from), planted/duration (setting its feet as the
      // stone lands), aggressive movement (the deep notable's commitment).
      // Lane A is BULK (what it is made of), lane B is FOOTING (where it
      // stands, and refusing to leave) — different in kind, not degree.
      //
      // Reworked in v3 off the generic armor ladder vine_whip and
      // flamethrower were running node-for-node; vine_whip is the honest
      // owner of rooted-and-thorny. What is only true of a rockslide is
      // that it is a WEIGHT problem and an ELEVATION problem.
      stone_shield: {
        id: "stone_shield",
        name: "Set Stance",
        cost: 1,
        leaning: "boldness",
        // Plants its feet and lets its own bulk do the work — the branch's
        // thesis stated in its first node.
        delta: { weightScaling: { factor: 0.2 } },
      },
      // Lane A — bulk.
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
        prerequisites: ["firmer_footing"],
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.05 },
        delta: {},
      },
      denser_stone: {
        id: "denser_stone",
        name: "Denser Stone",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Boldness <->
        // Sociability bridge's own notable (Unmoved Sentinel).
        prerequisitesAnyOf: [["craggy_hide"], ["unmoved_sentinel"]],
        leaning: "boldness",
        // Deepens the opener's own lever instead of being another +5 Power.
        delta: { weightScaling: { factor: 0.15 } },
      },
      digs_in: {
        id: "digs_in",
        name: "Digs In",
        cost: 1,
        prerequisites: ["denser_stone"],
        leaning: "boldness",
        // A `delta`, deliberately, and not another defensive passive:
        // passives stack uncapped across every tree a species knows, and
        // Onix already carries damageReductionFlat 12.5 / immovable 4
        // across its movepool. This one only changes what THIS move does —
        // as the stone lands it sets its feet and its guard comes up, for
        // a real but bounded window.
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 20 } },
      },
      // Lane B — footing.
      settled_stance: {
        id: "settled_stance",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["stone_shield"],
        leaning: "boldness",
        delta: { cooldownTicks: -1 },
      },
      unbroken: {
        id: "unbroken",
        name: "Unbroken",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Aggression <->
        // Boldness bridge's own notable (Mountainfall).
        prerequisitesAnyOf: [["settled_stance"], ["mountainfall"]],
        leaning: "boldness",
        // Anchored under its own rockfall — no drag/knockback/lunge so
        // much as budges it, a real delivery on "Unbroken" instead of
        // another flat damage-reduction stand-in.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      // The fork: take the high ground and rain rock down from it, or
      // refuse to give ground at all. Both are "mass"; they want opposite
      // positions on the map, which is the tension worth having.
      weathering: {
        id: "weathering",
        name: "High Perch",
        cost: 1,
        prerequisites: ["unbroken"],
        excludes: ["jagged_edges"],
        leaning: "boldness",
        delta: { situationalBonus: { condition: "elevation", multiplier: 1.45 } },
      },
      jagged_edges: {
        id: "jagged_edges",
        name: "Jagged Edges",
        cost: 1,
        prerequisites: ["unbroken"],
        excludes: ["weathering"],
        leaning: "boldness",
        grantsPassive: { kind: "thorns", value: 0.12 },
        delta: {},
      },
      bring_it_down: {
        id: "bring_it_down",
        name: "Bring It Down",
        cost: 2,
        // DEEP NOTABLE. Both lanes end here. A badly hurt Onix stops trying
        // to trade and reaches for the slope instead: `selfStateBonus`
        // biases `pickBestMove`'s own scoring toward this move once the
        // user is at or below half HP, and the extra `lockTicks` beat is
        // the real price of committing to a collapse it is standing inside.
        // Cost and payoff in the same node (principle 4).
        prerequisitesAnyOf: [["digs_in"], ["weathering"], ["jagged_edges"]],
        leaning: "boldness",
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.4 }, lockTicks: 1, power: 10 },
      },
      time_worn: {
        id: "time_worn",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["bring_it_down"],
        leaning: "boldness",
        delta: { accuracy: 10 },
      },
      mountains_weight: {
        id: "mountains_weight",
        name: "Mountain's Weight",
        cost: 2,
        prerequisites: ["time_worn"],
        leaning: "boldness",
        // CAPSTONE. Escalates the branch's OWN lever — the heaviest version
        // of the thing every node here has been building — rather than
        // reaching for the roster's stock defenseBoost+thorns tank
        // capstone, which is exactly what it used to be.
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
        // BRIDGE NOTABLE. Holds the line while everything else is still
        // getting clear. Lands on Denser Stone (Boldness's bulk lane, a
        // lane about mass rather than protection, so the bridge
        // complements it) and Settling Rumble (Sociability's warning lane).
        grantsPassives: [
          { kind: "defenseBoost", value: 0.04 },
          { kind: "damageReduction", value: 0.05 },
        ],
        delta: {},
      },
      // --- Sociability: the sound before the stone ---
      // Flavours: no friendly fire (the herd is standing in the bowl too),
      // calming (nobody has to fight over a slope that is coming down),
      // ally buffing (a warning is only worth anything if they act on it),
      // rallying (whatever is left standing gets called out).
      // Lane A is what the herd DOES about the warning; lane B is the
      // warning itself, and how far its authority reaches — different in
      // kind: one buffs herd-mates, the other de-escalates rivals.
      herd_warning: {
        id: "herd_warning",
        name: "Herd Warning",
        cost: 1,
        leaning: "sociability",
        // Same real ally-exemption Earthquake's own Herdsafe Trigger uses —
        // a same-herd agent caught in the burst takes nothing. Deliberate
        // reuse for a different reason: an advance-warning tremor, not
        // drilled herd discipline.
        delta: { excludesAllies: true },
      },
      // Lane A — what the herd does about it.
      clearer_warning: {
        id: "clearer_warning",
        name: "+10 Accuracy",
        cost: 1,
        prerequisites: ["herd_warning"],
        leaning: "sociability",
        delta: { accuracy: 10 },
      },
      deeper_rumble: {
        id: "deeper_rumble",
        name: "+5 Power",
        cost: 1,
        prerequisites: ["clearer_warning"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      set_yourselves: {
        id: "set_yourselves",
        name: "Set Yourselves",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Sociability
        // <-> Aggression bridge's own notable (No Respite).
        prerequisitesAnyOf: [["deeper_rumble"], ["no_respite"]],
        leaning: "sociability",
        // The warning finally does something on the herd's side of it:
        // every time the slide goes off, the nearest herd-mate braces
        // against it (`allyEffectOnAttack`, resolved through support.ts's
        // `nearestAllyEffectTarget`) instead of merely not being hit. A
        // bounded, per-use buff rather than another permanent aura — this
        // species already carries plenty of permanent aura.
        delta: { allyEffectOnAttack: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 20 } } },
      },
      take_cover: {
        id: "take_cover",
        name: "Take Cover",
        cost: 1,
        prerequisites: ["set_yourselves"],
        leaning: "sociability",
        // Deepens the same ally-effect one rung. A later node on the SAME
        // chain overwriting an earlier one is intended escalation, not the
        // overwrite bug — see MOVES_DESIGN.md's own note on that.
        delta: { allyEffect: { buff: { stat: "defense", stage: 2, ticks: 24 } } },
      },
      // Lane B — the warning itself.
      faster_warning: {
        id: "faster_warning",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["herd_warning"],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      settling_rumble: {
        id: "settling_rumble",
        name: "Settling Rumble",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or via the Boldness <->
        // Sociability bridge's own notable (Unmoved Sentinel).
        prerequisitesAnyOf: [["faster_warning"], ["unmoved_sentinel"]],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      wider_warning: {
        id: "wider_warning",
        name: "Wider Warning",
        cost: 1,
        prerequisites: ["settling_rumble"],
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
        prerequisites: ["settling_rumble"],
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
        // DEEP NOTABLE. Both lanes end here: the herd that got clear and
        // the rivals that backed off all now know exactly where to look.
        prerequisitesAnyOf: [["take_cover"], ["wider_warning"], ["sharpened_call"]],
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
        // CAPSTONE. Escalates the branch's own real lever instead of
        // switching to a generic heal — after enough warnings, the ground
        // around it finally settles for good, a decisively bigger calm than
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
        // BRIDGE NOTABLE. Whatever's still pinned under the aftershocks
        // gets marked for everything else nearby — denial turning into
        // focus fire. Lands on Set Yourselves (Sociability's herd lane —
        // teeth dropped into the lane that otherwise never threatens
        // anyone) and Ground-Shaking Impact (Aggression's slope lane).
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
    // v4 tree (MOVES_DESIGN.md's "Skill-tree template v4 — the two-lane
    // standard"): 45 nodes, 9 prerequisitesAnyOf, 6 fork nodes, 3 three-node
    // bridges. The v3 fantasy and every v3 node's mechanics are unchanged —
    // this pass only added the second lane each branch was missing and
    // rewired the bridges to land on lane notables.
    // THE FANTASY (unchanged, written before a single node): this isn't a
    // strike, it's four hundred pounds of sleeping mass finally deciding to
    // move — no technique, no follow-through, just gravity, timed. What's
    // dangerous about it isn't power, it's inevitability: you don't dodge a
    // landslide, you get out from under it before it starts, and this animal
    // rarely bothers to warn anyone it's about to fall. Snorlax's only real
    // signature move (species.ts) — same single-species freedom Slash's tree
    // used for Scyther, built specifically for this one body, not a generic
    // "heavy hit" template.
    // - Aggression ("Landslide"): stays power-archetype on purpose — more
    //   mass, less restraint, escalating to a real localized collapse. The
    //   full-body weight payoff (`weightScaling`) is earned at the keystone
    //   now, not handed out on the opener — direct feedback that starting
    //   this strong was backwards, moved from Full Weight (now a modest
    //   opening lunge) to Avalanche, where "the giant finally throws its
    //   whole self into it" actually belongs. Its two lanes differ in kind,
    //   not degree: MOMENTUM (a body already moving, driving whatever it hit
    //   backward) versus DEADFALL (the drop from above — no travel at all,
    //   just height, and a numbness that comes from being landed on).
    // - Boldness ("Unbudging"): earned tankiness, not a default reach —
    //   nothing on this whole roster fits "doesn't move" better than a
    //   sleeping giant (Snorlax's own curated moveset already primes this
    //   with Defense Curl). Real follow-up feedback that bulk/defense alone
    //   read as bland: the keystone is now a genuine wind-up — a deliberate,
    //   telegraphed commitment (real "intention," not just more armor),
    //   invulnerable while charging, then a huge leap and a devastating hit.
    //   Lane A is that refusal to be moved at all; lane B is the other half
    //   of lying somewhere for a living — what it costs to heave that mass
    //   back up, and what the ground it was lying on looks like afterward.
    // - Sociability ("Undisturbed"): direct correction on the first draft —
    //   Snorlax is canonically a solitary animal, not a herd one, so a
    //   branch built entirely on ally-buffing herd support was the wrong
    //   fantasy for this specific body. The real trait (famously placid
    //   despite its size) is now a genuine non-territorial, de-escalating
    //   presence: it never starts a fight over a resource, and anything
    //   nearby — herd or not, rival or not — calms down just being near it.
    //   Lane A is that outward calm (nobody starts anything); lane B is how
    //   a fight it didn't want ENDS — whatever it lands on is simply held
    //   down rather than escalated with, and it only really reaches for this
    //   move once it has actually been hurt.
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
      // Lane A — MOMENTUM: a body already in motion, and what being in the
      // way of one costs.
      mounting_momentum: {
        id: "mounting_momentum",
        name: "+8 Power",
        cost: 1,
        prerequisites: ["heavy_step"],
        leaning: "aggression",
        delta: { power: 8 },
      },
      bearing_down: {
        id: "bearing_down",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["mounting_momentum"],
        leaning: "aggression",
        // Once it's actually moving, stopping is the hard part — it comes
        // around again sooner. (Total tree reduction is now -3 against a
        // base of 6: a 1.75x tempo gain, against this move's own 2.33x cap.)
        delta: { cooldownTicks: -1 },
      },
      ground_shaking_landing: {
        id: "ground_shaking_landing",
        name: "Ground-Shaking Landing",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or through Braced
        // Commitment's bridge — bracing first is exactly what keeps the
        // force in the target instead of in its own wobble.
        prerequisitesAnyOf: [["bearing_down"], ["settled_impact"]],
        leaning: "aggression",
        // Not a technique — a body just landing somewhere it wasn't,
        // driving whatever it hit backward with it.
        delta: { forcedMovement: { mover: "defender", direction: "away", tiles: 2, timing: "onHit" } },
      },
      rolling_advance: {
        id: "rolling_advance",
        name: "+8 Power",
        cost: 1,
        prerequisites: ["ground_shaking_landing"],
        leaning: "aggression",
        delta: { power: 8 },
      },
      // Lane B — DEADFALL: no travel at all, just height and mass. Numbness
      // is what being under it does to you.
      numbing_follow_through: {
        id: "numbing_follow_through",
        name: "+10% Paralysis Chance",
        cost: 1,
        prerequisites: ["heavy_step"],
        leaning: "aggression",
        delta: { statusChance: 0.1 },
      },
      deadfall: {
        id: "deadfall",
        name: "Deadfall",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or through Provoked
        // Charge's bridge — the patient lane is exactly the one with no
        // violence of its own until something rouses it.
        prerequisitesAnyOf: [["numbing_follow_through"], ["undivided"]],
        leaning: "aggression",
        // The one condition this move's own fantasy obviously cares about:
        // it doesn't chase, it comes DOWN. `situationalBonus`'s "elevation"
        // is real and literal — resolveHit (predation.ts) compares the
        // attacker's own tile elevation against the defender's and only
        // pays out when the attacker is genuinely higher. A fall that finds
        // the soft spot on the way through, hence the crit stage.
        delta: { situationalBonus: { condition: "elevation", multiplier: 1.4 }, critRateStage: 1 },
      },
      second_slam: {
        id: "second_slam",
        name: "Second Slam",
        cost: 2,
        prerequisites: ["deadfall"],
        excludes: ["rolling_crush"],
        leaning: "aggression",
        // Commits fully — the fall itself costs something now too.
        delta: { power: 15, recoilFraction: 0.08 },
      },
      rolling_crush: {
        id: "rolling_crush",
        name: "Rolling Crush",
        cost: 2,
        prerequisites: ["deadfall"],
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
        // DEEP NOTABLE — both lanes end here: the momentum lane's tail and
        // either tip of the deadfall lane's fork.
        prerequisitesAnyOf: [["rolling_advance"], ["second_slam"], ["rolling_crush"]],
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
      // Lane A — WON'T BE MOVED: the refusal itself, as armor.
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
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or through Nothing to
        // Prove's bridge — an immovable thing that also isn't looking for a
        // fight is the ultimate "just go around it."
        prerequisitesAnyOf: [["patient_reset"], ["undivided_stand"]],
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
        prerequisites: ["unbudging"],
        leaning: "boldness",
        delta: { power: 5 },
      },
      // Lane B — WHERE IT'S BEEN LYING: the other half of a life spent
      // horizontal — what heaving that much mass upright costs, and what
      // the ground it was lying on looks like afterward.
      heaving_up: {
        id: "heaving_up",
        name: "Heaving Up",
        cost: 1,
        prerequisites: ["dead_weight"],
        leaning: "boldness",
        // A real tradeoff in one node (principle 4): getting all of that off
        // the ground hits harder and genuinely costs the animal energy —
        // `selfCostPerUse` is subtracted from the attacker's own needs on
        // every use (predation.ts), not a flavour string.
        delta: { power: 10, selfCostPerUse: { need: "energy", amount: 0.04 } },
      },
      crushed_thicket: {
        id: "crushed_thicket",
        name: "Crushed Thicket",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or through Braced
        // Commitment's bridge.
        prerequisitesAnyOf: [["heaving_up"], ["settled_impact"]],
        leaning: "boldness",
        // The most physical lever in the roster's palette, on the branch
        // that earned it: it comes up out of the brush it has been sleeping
        // in and the brush is simply gone — `consumesOwnTerrain` reverts the
        // attacker's own tile to floor and multiplies that one hit
        // (predation.ts). Reachable in practice, not decorative: Snorlax's
        // curated biomes are forest and jungle (species.ts), the two with
        // the heaviest bush weighting in worldgen, and bush is walkable
        // (only wall/tree are not).
        delta: { consumesOwnTerrain: { terrain: "bush", damageMultiplier: 1.5 } },
      },
      sink_in: {
        id: "sink_in",
        name: "Sink In",
        cost: 2,
        prerequisites: ["crushed_thicket"],
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
        prerequisites: ["crushed_thicket"],
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
        // DEEP NOTABLE — both lanes end here.
        prerequisitesAnyOf: [["bracing_follow_through"], ["sink_in"], ["full_bulk"]],
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
      // Lane A — NOBODY STARTS ANYTHING: the outward calm, aimed at the
      // world around it.
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
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or through Provoked
        // Charge's bridge — the calm lane is the one with no violence of
        // its own, so that is the bridge that complements it rather than
        // deepening a rut.
        prerequisitesAnyOf: [["unhurried_reset"], ["undivided"]],
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
        prerequisites: ["no_quarrel"],
        leaning: "sociability",
        delta: { power: 5 },
      },
      // Lane B — HOW IT ENDS ONE ANYWAY: it doesn't escalate, it settles on
      // you; and it doesn't reach for this move at all until it has actually
      // been hurt.
      pinned_under: {
        id: "pinned_under",
        name: "Pinned",
        cost: 1,
        prerequisites: ["unbothered"],
        leaning: "sociability",
        // De-escalation with its whole body: whatever it lands on doesn't
        // get its own move off. `jamCooldownTicks` adds real ticks to the
        // defender's own move cooldowns on a landed hit (predation.ts) —
        // 16 users in the roster, none of them a body this heavy.
        delta: { jamCooldownTicks: 2 },
      },
      finally_roused: {
        id: "finally_roused",
        name: "Finally Roused",
        cost: 2,
        // LANE NOTABLE. Reachable the normal way, or through Nothing to
        // Prove's bridge.
        prerequisitesAnyOf: [["pinned_under"], ["undivided_stand"]],
        leaning: "sociability",
        // Says exactly what it does, per principle 5: `selfStateBonus` is
        // read by `pickBestMove` (combat.ts), not by the damage formula —
        // at or below half HP this move's own selection score is multiplied,
        // so a hurt Snorlax stops picking at things and starts reaching for
        // the slam. A behavioural lever, and the honest one for a placid
        // animal: it isn't stronger when cornered, it just finally bothers.
        delta: { selfStateBonus: { condition: "selfLowHp", multiplier: 1.5 } },
      },
      wide_berth: {
        id: "wide_berth",
        name: "Wide Berth",
        cost: 2,
        prerequisites: ["finally_roused"],
        excludes: ["steady_nerve"],
        leaning: "sociability",
        // Deepens the branch's own calm directly — the peace it keeps
        // reaches further out — rather than staying roused.
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      steady_nerve: {
        id: "steady_nerve",
        name: "Steady Nerve",
        cost: 2,
        prerequisites: ["finally_roused"],
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
        // DEEP NOTABLE — both lanes end here.
        prerequisitesAnyOf: [["quiet_ground"], ["wide_berth"], ["steady_nerve"]],
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
      // Bridge tail (see MOVES_DESIGN.md's "Crosslinks are bridges, not
      // spurs"): extends Braced Commitment into ONE lane notable per branch
      // it connects — Aggression's Ground-Shaking Landing and Boldness's
      // Crushed Thicket. It skips those lanes' filler grind, never their own
      // decision (principle 12, restated for lanes).
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
      // Bridge tail: extends Nothing to Prove into Boldness's Unbudging and
      // Sociability's Finally Roused — one lane notable per branch.
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
      // Bridge tail: extends Provoked Charge into Sociability's No Quarrel
      // and Aggression's Deadfall — the two lanes with no violence of their
      // own, which is what makes this the bridge that complements them.
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
    // v4 two-lane standard. Dig is genuinely never resolved as a hit
    // (pickBestMove excludes every `burrow` move — combat.ts), so
    // power/accuracy/defensePenetration/forcedMovement/lifesteal and every
    // other damage-facing lever is dead weight here: there is nothing for
    // them to modify. That much was already written down. What was NOT true
    // is the old claim that cooldown and passives are "the only two real
    // levers left" — that was read off the delta schema, never off the call
    // sites. Measured against the real engine (a temporary harness driving
    // predation/needs/support with the shipped dig spec, each with its own
    // control), FOUR more deltas reach dig:
    //
    //   - `lockTicks` — `useMove` (combat.ts) applies it, and the burrow-flee
    //     branch (predation.ts) calls `useMove`. Verified: a dig with
    //     lockTicks 3 left the fleeing agent on actionLockTicks 3, control 0.
    //   - `gatherBurst` — needs.ts's crop-dig and spring-dig paths, already
    //     shipped and already used here.
    //   - `targetsAlly` + `allyEffect` — `applySupportMove` (support.ts)
    //     filters on `targetsAlly && allyEffect && !cooldown` and does NOT
    //     exclude burrow moves. Verified: a dig so specced healed an adjacent
    //     herd-mate on an idle tick; the shipped dig, as control, did not.
    //     It costs what it looks like it costs — the same 15-tick cooldown
    //     that gates the burrow-escape — so a Sociability build really is
    //     spending its own escape hatch on somebody else's shelter.
    //   - `range` — only through that same support path, deciding which
    //     herd-mates are reachable. Verified: max 1 could not reach an ally
    //     three tiles off, max 3 could.
    //
    // Everything else on the delta schema is gated behind resolveHit or the
    // `utilityMove` idle path and stays dead for this move. That ceiling is
    // real and worth stating plainly: dig can reach 5 of the colour pie's 16
    // flavours, not because its fantasy is thin but because 11 of them are
    // reachable only through hit resolution.
    //
    // Shared by Diglett AND Sandshrew (species.ts's own comment: they coexist
    // underground, a real cross-species breeding pair) — Sociability leans
    // directly into that literal, already-written flavor.
    //
    // THE FANTASY. Dig is the ground opening under something and closing
    // again. Nothing is struck; something is simply not there any more. For a
    // Diglett or a Sandshrew the tunnel is not an escape hatch, it is the
    // house — it is where the water is, where the roots are, and where the
    // other burrowers already live. It is the only move in the roster whose
    // payoff is absence, and the only one whose real work happens where
    // nobody can watch it.
    tree: {
      // --- Aggression: "Gone Before It Lands". For a move that cannot hurt
      // anything, aggression is refusal and theft: never be there when the
      // blow lands, and be the one who gets to the root first. Two lanes that
      // differ in kind, not degree — the short dive is FREQUENCY (be gone and
      // back before anything gets a turn), the long dive is COMMITMENT (go
      // down, stay down, come up with what you went for).
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

      // Lane A — "The Short Dive": frequency.
      shallow_dive: {
        id: "shallow_dive",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["quick_reflexes"],
        leaning: "aggression",
        // Name corrected from "-2 Cooldown": the delta is and always was -1.
        // Principle 5 ("say the numbers, don't paraphrase them") names this
        // exact class of bug, and it had shipped here.
        delta: { cooldownTicks: -1 },
      },
      scattered_grit: {
        id: "scattered_grit",
        name: "Scattered Grit",
        cost: 1,
        prerequisites: ["shallow_dive"],
        leaning: "aggression",
        // A shallow dive throws its spoil straight up. Whatever was standing
        // over the hole takes a face full of hard grit for it.
        grantsPassive: { kind: "thorns", value: 0.05 },
        delta: {},
      },
      never_still: {
        id: "never_still",
        name: "Never Still",
        cost: 1,
        prerequisitesAnyOf: [["scattered_grit"], ["unflinching_burrow"]],
        leaning: "aggression",
        // This lane's notable is tempo, and tempo is the honest one for a
        // move whose whole payoff is not being there.
        delta: { cooldownTicks: -2 },
      },
      loose_ground: {
        id: "loose_ground",
        name: "Loose Ground",
        cost: 1,
        prerequisites: ["never_still"],
        leaning: "aggression",
        // Ground worked this often never packs down again. A blow aimed at
        // something standing on it lands in earth that gives.
        grantsPassive: { kind: "damageReductionFlat", value: 0.5 },
        delta: {},
      },

      // Lane B — "The Long Dive": commitment. The cost is real (`lockTicks`
      // holds the agent's own action clock — needs.ts returns early on it),
      // and the benefit sits in the same node, per principle 4.
      down_deep: {
        id: "down_deep",
        name: "Down Deep",
        cost: 1,
        prerequisites: ["quick_reflexes"],
        leaning: "aggression",
        // Doesn't scrape — goes under and works while it is down there.
        // Measured on the real crop-dig path: gatherBurst +4 took a buried
        // potato from 11 ticks to 7; one tick of lock cost nothing (still 7),
        // three cost two ticks (9). So a single lock tick against real
        // gathering is a genuine trade, not a tax that eats its own payoff.
        delta: { lockTicks: 1, gatherBurst: 3 },
      },
      straight_to_the_root: {
        id: "straight_to_the_root",
        name: "Straight to the Root",
        cost: 1,
        prerequisitesAnyOf: [["down_deep"], ["first_to_ground"]],
        leaning: "aggression",
        // Aggression as resource contest — the thing under the ground belongs
        // to whoever reaches it first, and nothing else in the roster reaches
        // it at all. This is the branch's answer to "what does aggression
        // mean for a move that can never land a hit".
        delta: { gatherBurst: 4 },
      },
      instant_vanish: {
        id: "instant_vanish",
        name: "Instant Vanish",
        cost: 1,
        prerequisites: ["straight_to_the_root"],
        excludes: ["false_surface"],
        leaning: "aggression",
        // Was "+2.25 HP Regen". Healing was never this node's fantasy — it is
        // the FAST dive, the one that is gone before anything lands. Now it
        // buys the tempo it describes.
        //
        // Deliberately NOT `unshaken`, which reads like a perfect fit: dig
        // already grants it (Quick Reflexes), and predation.ts gates on
        // `passives.unshaken > 0` rather than summing, so a second grant would
        // be a node that does literally nothing.
        delta: { cooldownTicks: -1 },
      },
      false_surface: {
        id: "false_surface",
        name: "False Surface",
        cost: 1,
        prerequisites: ["straight_to_the_root"],
        excludes: ["instant_vanish"],
        leaning: "aggression",
        // Surfaces just long enough to bite before vanishing again. The other
        // half of a real decision: leave immediately, or leave a mark on the
        // way out.
        grantsPassive: { kind: "thorns", value: 0.1 },
        delta: {},
      },

      deepening_instincts: {
        id: "deepening_instincts",
        name: "Deepening Instincts",
        cost: 1,
        prerequisitesAnyOf: [["loose_ground"], ["instant_vanish"], ["false_surface"]],
        leaning: "aggression",
        // Honest rename — the old "Gone Before It Lands" promised a
        // dodge/timing effect this move's real lever set cannot deliver.
        //
        // 0.12 -> 0.05 to bring the tree under the 20% per-move damage-
        // reduction cap (it totalled 29%). The cut lands on Aggression rather
        // than Boldness deliberately: mitigation is a Boldness flavour in the
        // colour pie, and this node keeps its real lever, the cooldown.
        grantsPassive: { kind: "damageReduction", value: 0.05 },
        delta: { cooldownTicks: -1 },
      },
      spoil_heap: {
        id: "spoil_heap",
        name: "Spoil Heap",
        cost: 1,
        prerequisites: ["deepening_instincts"],
        leaning: "aggression",
        // Every dive leaves a heap behind it, and a heap is a head start on
        // the next one. Deliberately a delta rather than another passive:
        // `damageReductionFlat` already sums to ~15 on a fully-invested
        // Diglett across its whole movepool (passive-exposure.ts), and nothing
        // in the engine bends that one.
        delta: { gatherBurst: 2 },
      },
      stays_down: {
        id: "stays_down",
        name: "Stays Down",
        cost: 1,
        prerequisites: ["spoil_heap"],
        leaning: "aggression",
        // CAPSTONE. It does not come back up until it has what it came for,
        // and the roof it comes up through takes whatever was standing on it.
        // Nothing else in the roster trades the agent's own action clock for
        // gathering — this is the only node in the game where standing still
        // underground is the aggressive play. The lock is a real cost (two of
        // its own turns), which is exactly why the payoff is the largest
        // `gatherBurst` in the roster rather than another number on a hit
        // that never happens. No passive at all on it, deliberately: thorns is
        // Boldness's payoff in this tree, and a second big grant here is what
        // pushed a fully-invested Diglett to 63% reflected damage on the first
        // pass of this conversion (passive-exposure.ts, which is cross-move and
        // sees what the per-tree checker cannot).
        delta: { lockTicks: 2, gatherBurst: 6 },
      },

      // Crosslink 1: Aggression <-> Boldness — braces for real before every
      // dive, Boldness's own sturdiness feeding Aggression's speed. Lands on
      // Never Still (the fast lane) and Bedrock Grip (the soak lane).
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
        cost: 1,
        prerequisites: ["hardened_dive"],
        leaning: "aggression",
        // Takes the hit mid-dive and keeps going. 0.05 -> 0.03 for the
        // per-move damage-reduction cap; the defenseBoost is what carries
        // this node.
        grantsPassives: [
          { kind: "damageReduction", value: 0.03 },
          { kind: "defenseBoost", value: 0.04 },
        ],
        delta: {},
      },

      // --- Boldness: "The Roof Holds". Boldness for a burrower is not
      // standing in the open taking it — there is no open. It is the tunnel
      // not caving in, and nothing being able to get you out of it. Lane A
      // soaks (flat mitigation, strong early, marginal late); lane B DENIES
      // (it cannot be moved, and what comes down on the roof comes back).
      sturdy_return: {
        id: "sturdy_return",
        name: "Sturdy Return",
        cost: 1,
        leaning: "boldness",
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: {},
      },

      // Lane A — "Packed Walls": soak.
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
        prerequisites: ["thicker_hide"],
        leaning: "boldness",
        // Hard-packed ground is no obstacle to a digger that is built for it
        // — a real `gatherBurst`, and another duplicate "-1 Cooldown" filler
        // retired (this branch had two identical ones under names that both
        // promised something else).
        delta: { gatherBurst: 3 },
      },
      bedrock_grip: {
        id: "bedrock_grip",
        name: "Bedrock Grip",
        cost: 1,
        prerequisitesAnyOf: [["packed_earth"], ["unflinching_burrow"]],
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.05 },
        delta: {},
      },
      shored_up: {
        id: "shored_up",
        name: "Shored Up",
        cost: 1,
        prerequisites: ["bedrock_grip"],
        leaning: "boldness",
        // Props and packed spoil along the walls. The tunnel stops shedding
        // its own roof every time something heavy walks over it.
        grantsPassive: { kind: "damageReductionFlat", value: 0.75 },
        delta: {},
      },

      // Lane B — "Nothing Pulls It Out": denial.
      braced_shoulders: {
        id: "braced_shoulders",
        name: "Braced Shoulders",
        cost: 1,
        prerequisites: ["sturdy_return"],
        leaning: "boldness",
        // Sets itself against both walls before anything can get a grip. The
        // beat spent planting is the cost; the footing is the payoff.
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
        delta: { lockTicks: 1 },
      },
      set_in_the_wall: {
        id: "set_in_the_wall",
        name: "Set in the Wall",
        cost: 1,
        prerequisitesAnyOf: [["braced_shoulders"], ["communal_warren"]],
        leaning: "boldness",
        // The lane's notable, and a different KIND of answer from Bedrock
        // Grip's: not "the hit hurts less" but "you do not get to move me."
        // `immovable` is `> 0`-gated (status.ts), so this is the tree's one
        // and only grant of it — a second anywhere would be a dead node.
        grantsPassive: { kind: "immovable", value: 1 },
        delta: {},
      },
      weathered_scales: {
        id: "weathered_scales",
        name: "Weathered Scales",
        cost: 1,
        prerequisites: ["set_in_the_wall"],
        excludes: ["stone_hide"],
        leaning: "boldness",
        // Was "+3 HP Regen", the single biggest healing node in the tree and
        // flatly off-fantasy: weathered scales are armour. Flat mitigation
        // scales the same way flat regen did (real early, marginal late —
        // see `damageReductionFlat`'s own doc comment), so this keeps the
        // node's role in the build while changing what it means.
        grantsPassive: { kind: "damageReductionFlat", value: 1.5 },
        delta: {},
      },
      stone_hide: {
        id: "stone_hide",
        name: "Stone Hide",
        cost: 1,
        prerequisites: ["set_in_the_wall"],
        excludes: ["weathered_scales"],
        leaning: "boldness",
        // Was `damageReductionFlat: 1` against Weathered Scales' 1.5 — the
        // same passive, strictly less of it. That is not a fork, it is a node
        // nobody would ever pick, which is this project's own definition of a
        // bug. Changed to `defenseBoost`, the lever MOVES_DESIGN.md's "Stop
        // overusing damageReduction" section says an armour fiction should
        // have been using all along: physical-only, scaling with the defence
        // stat, so it is weak early and strong late — the exact opposite
        // curve to the flat soak it now competes with. That is a real
        // decision about when in a run you expect to need it.
        grantsPassive: { kind: "defenseBoost", value: 0.06 },
        delta: {},
      },

      unshakable_ground: {
        id: "unshakable_ground",
        name: "Unshakable Ground",
        cost: 1,
        prerequisitesAnyOf: [["shored_up"], ["weathered_scales"], ["stone_hide"]],
        leaning: "boldness",
        grantsPassives: [
          { kind: "defenseBoost", value: 0.05 },
          { kind: "damageReduction", value: 0.12 },
        ],
        delta: {},
      },
      deep_footing: {
        id: "deep_footing",
        name: "Deep Footing",
        cost: 1,
        prerequisites: ["unshakable_ground"],
        leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
        delta: {},
      },
      the_roof_holds: {
        id: "the_roof_holds",
        name: "The Roof Holds",
        cost: 1,
        prerequisites: ["deep_footing"],
        leaning: "boldness",
        // CAPSTONE. The tunnel takes the blow instead of the animal inside
        // it, and the roof gives it back. Deliberately NOT more
        // `damageReduction` — the tree is already at the 20% per-move cap and
        // this branch has three separate mitigation nodes already; a fourth
        // would be the "one lever answers the whole branch" failure. Thorns
        // is the branch's own fiction finally paying out: something dug in
        // this deep is not a wall you hit for free.
        grantsPassives: [
          { kind: "thorns", value: 0.1 },
          { kind: "damageReductionFlat", value: 1.5 },
        ],
        delta: {},
      },

      // Crosslink 2: Boldness <-> Sociability — a sturdy den shared with
      // whoever else is burrowed nearby. Lands on Set in the Wall (the denial
      // lane) and Settling Earth (the quiet lane).
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
        cost: 1,
        prerequisites: ["wider_shelter"],
        leaning: "boldness",
        // A warren dug together is dug faster — the shelter fantasy finally
        // paying into this move's own gathering identity, not just another
        // aura.
        grantsPassive: { kind: "calmingPresence", value: 0.1 },
        delta: { gatherBurst: 3 },
      },

      // --- Sociability: "Shared Ground". Diglett and Sandshrew genuinely
      // coexist underground (species.ts's own note); this branch is that,
      // mechanically. Lane A PREVENTS trouble (the tunnels are neutral
      // ground); lane B REPAIRS it — the digger spends its own escape hatch
      // digging cover for somebody else. Those are different in kind, and the
      // second one has a real price: `applySupportMove` puts dig on its full
      // cooldown, so a Diglett that just dug a den for a herd-mate cannot
      // vanish for itself.
      peaceful_tunnels: {
        id: "peaceful_tunnels",
        name: "Peaceful Tunnels",
        cost: 1,
        leaning: "sociability",
        // `nonTerritorial` is read as a boolean (herdConflict.ts returns early
        // on any value > 0), so this is the tree's only grant of it.
        grantsPassive: { kind: "nonTerritorial", value: 1 },
        delta: {},
      },

      // Lane A — "The Quiet Warren": prevention.
      quiet_ground: {
        id: "quiet_ground",
        name: "-1 Cooldown",
        cost: 1,
        prerequisites: ["peaceful_tunnels"],
        leaning: "sociability",
        delta: { cooldownTicks: -1 },
      },
      wider_burrow: {
        id: "wider_burrow",
        name: "Wider Burrow",
        cost: 1,
        prerequisites: ["quiet_ground"],
        leaning: "sociability",
        // Direct correction, and the hook this whole tree was missing:
        // "dig was supposed to make digging springs and food easier."
        // It already did a little — needs.ts hands any off-cooldown `burrow`
        // move a real `DIG_MOVE_BURST_TICKS` head start on uncovering an
        // underground crop or digging a brand-new spring — but nothing in the
        // tree could ever make that better. `gatherBurst` does.
        delta: { gatherBurst: 3 },
      },
      settling_earth: {
        id: "settling_earth",
        name: "Settling Earth",
        cost: 1,
        prerequisitesAnyOf: [["wider_burrow"], ["communal_warren"]],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.2 },
        delta: {},
      },
      room_for_both: {
        id: "room_for_both",
        name: "Room for Both",
        cost: 1,
        prerequisites: ["settling_earth"],
        leaning: "sociability",
        // Two diggers never meet in the same tunnel, so neither has to make
        // anything of it. The quiet lane's own answer to gathering: not
        // faster, just enough for everybody.
        delta: { gatherBurst: 3 },
      },

      // Lane B — "Dug for Others": repair.
      dug_you_a_den: {
        id: "dug_you_a_den",
        name: "Dug You a Den",
        cost: 1,
        prerequisites: ["peaceful_tunnels"],
        leaning: "sociability",
        // The branch's hinge, and the one place in this tree where dig stops
        // being about the digger. `applySupportMove` (support.ts) picks up any
        // off-cooldown `targetsAlly` + `allyEffect` move on an idle tick and
        // does not exclude burrow moves — verified live against the real
        // engine, with the unspecced dig as the control. The cost is the same
        // 15-tick cooldown that gates the burrow-escape, so this is a genuine
        // decision rather than free value.
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.06 } },
      },
      second_entrance: {
        id: "second_entrance",
        name: "Second Entrance",
        cost: 1,
        prerequisitesAnyOf: [["dug_you_a_den"], ["first_to_ground"]],
        leaning: "sociability",
        // A den does not have to be dug where the digger is standing. `range`
        // is otherwise completely dead on this move — it reaches nothing but
        // `withinMoveRange` on the support path — which is exactly what makes
        // it this lane's notable: verified live, max 1 could not reach a
        // herd-mate three tiles off and max 3 could.
        delta: { range: { min: 0, max: 3 }, gatherBurst: 2 },
      },
      deeper_calm: {
        id: "deeper_calm",
        name: "Deeper Calm",
        cost: 1,
        prerequisites: ["second_entrance"],
        excludes: ["watchful_rest"],
        leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.15 },
        delta: {},
      },
      watchful_rest: {
        id: "watchful_rest",
        name: "Watchful Rest",
        cost: 1,
        prerequisites: ["second_entrance"],
        excludes: ["deeper_calm"],
        leaning: "sociability",
        // Kept as healing — this one IS rest — but 2.25 -> 1.5 against the
        // per-move budget.
        grantsPassive: { kind: "regenFlat", value: 1.5 },
        delta: {},
      },

      denning_together: {
        id: "denning_together",
        name: "Denning Together",
        cost: 1,
        prerequisitesAnyOf: [["room_for_both"], ["deeper_calm"], ["watchful_rest"]],
        leaning: "sociability",
        // A shared den means real rest for everyone in it, not just a trickle
        // of healing.
        //
        // Group healing is held to a stricter standard than self-healing:
        // `healAura` pays out to every herd-mate in radius every tick, so one
        // node is worth its value times the herd. Direct: "be more stringent
        // on group regen." 0.01 -> 0.006 aura, 0.04 -> 0.02 self.
        grantsPassives: [
          { kind: "healAura", value: 0.006 },
          { kind: "regen", value: 0.02 },
        ],
        delta: {},
      },
      warm_walls: {
        id: "warm_walls",
        name: "Warm Walls",
        cost: 1,
        prerequisites: ["denning_together"],
        leaning: "sociability",
        // A den with bodies in it holds its heat. The last of this tree's
        // healing budget: regen + healAura + regenFlat/43 now totals 9.3%
        // against the 10% per-move cap, so nothing else in this tree may heal.
        grantsPassive: { kind: "regenFlat", value: 0.75 },
        delta: {},
      },
      open_tunnels: {
        id: "open_tunnels",
        name: "Open Tunnels",
        cost: 1,
        prerequisites: ["warm_walls"],
        leaning: "sociability",
        // CAPSTONE. The warren stops being a private hole and becomes a road:
        // anything in the herd that needs cover gets a den dug for it, where
        // it is standing, with walls already shored. Escalates Dug You a Den's
        // own `allyEffect` rather than reaching for a new lever (principle 13
        // read one level up) — a deliberate overwrite of an ancestor's value,
        // which is the only shape of overwrite that is safe here.
        //
        // Deliberately NOT another aura passive: this branch already grants
        // healAura, regen, regenFlat, calmingPresence and nonTerritorial, and
        // a sixth would be the "one lever answers the branch" failure wearing
        // a capstone's clothes. What is actually new is that the shelter is
        // now something a herd-mate KEEPS — a real defence buff with a
        // duration, dug into the ground rather than handed out as a number.
        delta: {
          targetsAlly: true,
          allyEffect: { healFraction: 0.12, buff: { stat: "defense", stage: 1, ticks: 30 } },
        },
      },

      // Crosslink 3: Sociability <-> Aggression — even the quick-vanishing
      // ones know the tunnels are shared ground. Lands on Second Entrance
      // (the lane that digs for others) and Straight to the Root (the lane
      // that digs for itself).
      quick_warning: {
        id: "quick_warning",
        name: "Quick Warning",
        cost: 1,
        prerequisites: ["peaceful_tunnels", "quick_reflexes"],
        leaning: "sociability",
        // Was "+1.5 HP Regen". A warning shouted early is what stops a fight
        // starting, not what patches one up — `calmingPresence` is the lever
        // that actually models that (herdConflict.ts multiplies down the
        // escalation chance of BOTH sides near the holder, not just its own
        // herd).
        //
        // Its -1 cooldown moved to Instant Vanish, whose entire identity is
        // speed, rather than being shaved off some third node.
        grantsPassive: { kind: "calmingPresence", value: 0.08 },
        delta: {},
      },
      sharper_warning: {
        id: "sharper_warning",
        name: "Sharper Warning",
        cost: 1,
        prerequisites: ["quick_warning"],
        leaning: "sociability",
        // Deepens Quick Warning's own de-escalation lever, which is what that
        // node now grants — the whole bridge is about the warning working,
        // not about digging faster. This gave back the tick Instant Vanish
        // needed.
        grantsPassive: { kind: "calmingPresence", value: 0.05 },
        delta: {},
      },
      first_to_ground: {
        id: "first_to_ground",
        name: "First to Ground",
        cost: 1,
        prerequisites: ["sharper_warning"],
        leaning: "aggression",
        // Underground before anything else has reacted, and recovering while
        // it waits. 0.025 -> 0.015: the waiting-and-recovering half is real
        // and stays, but the cooldown is what this node is actually for.
        grantsPassive: { kind: "regen", value: 0.015 },
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
        // Was "+1.5 HP Regen". "Steady" is a stance, not a heal — and this
        // branch's own flavour is defence. Physical-only by construction
        // (calculateDamage only reads the defense stage for a physical move),
        // which is the honest version of what a root system does.
        grantsPassive: { kind: "defenseBoost", value: 0.04 },
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
        // system, not a bigger number on the same two levers. 0.04 -> 0.025
        // against the per-move healing budget.
        grantsPassives: [
          { kind: "regen", value: 0.025 },
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
        // Kept as healing, 2.25 -> 1.5 against the per-move budget.
        grantsPassive: { kind: "regenFlat", value: 1.5 },
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
        //
        // 0.012 -> 0.008. Group healing pays out to every herd-mate in radius
        // every tick, so it is held to a stricter standard than self-healing.
        grantsPassives: [
          { kind: "healAura", value: 0.008 },
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
        // Was "+1.5 HP Regen". This crosslink sits behind Ravenous Bite on a
        // move literally named for draining, and the tree used no
        // `lifestealFraction` anywhere — a real gap, not a rebalance. The
        // recovery is now taken FROM something rather than accruing on its
        // own, which is the whole fantasy of the move.
        delta: { cooldownTicks: -1, lifestealFraction: 0.08 },
      },
      richer_ground: {
        id: "richer_ground",
        name: "Richer Ground",
        cost: 1,
        prerequisites: ["feeding_ground"],
        leaning: "aggression",
        // Bridge filler — deepens Feeding Ground's own lever, which is now
        // the drain rather than a second identical "+1.5 HP Regen". The old
        // pair was the clearest case in the roster of a filler that just
        // repeated the node above it.
        delta: { lifestealFraction: 0.06 },
      },
      endless_bounty: {
        id: "endless_bounty",
        name: "Endless Bounty",
        cost: 2,
        prerequisites: ["richer_ground"],
        leaning: "sociability",
        // Never quite empty, and never waiting long. 0.03 -> 0.02 against the
        // per-move healing budget.
        grantsPassive: { kind: "regen", value: 0.02 },
        delta: { cooldownTicks: -1 },
      },
    },
  },
};
