import { describe, expect, it } from "vitest";
import { applyMoveTree } from "@pokuelike/engine";
import type { MoveSpec, MoveTreeNode } from "@pokuelike/engine";
import { MOVES } from "../src/moves.js";

/** Every move that carries a respec tree — Tackle/Slash/Ember (pre-existing) plus the new Rock Throw/Peck/Scratch/Water Gun trees. */
const TREED_MOVES = Object.values(MOVES).filter((move): move is MoveSpec & { tree: Record<string, MoveTreeNode> } => !!move.tree);

/**
 * Resolves *some* valid chosen-node path that reaches `targetId`, recursively
 * pulling in whatever `prerequisites` demand and, for `prerequisitesAnyOf`,
 * the first alternative set whose own chain resolves cleanly — real trees are
 * acyclic DAGs, so plain recursion (no cycle guard needed) always terminates.
 */
function resolveChosenSetFor(tree: Record<string, MoveTreeNode>, targetId: string, into = new Set<string>()): Set<string> {
  if (into.has(targetId)) return into;
  const node = tree[targetId];
  for (const id of node.prerequisites ?? []) resolveChosenSetFor(tree, id, into);
  if (node.prerequisitesAnyOf && node.prerequisitesAnyOf.length > 0) {
    for (const id of node.prerequisitesAnyOf[0]) resolveChosenSetFor(tree, id, into);
  }
  into.add(targetId);
  return into;
}

describe("every move tree in the curated roster is internally consistent", () => {
  for (const move of TREED_MOVES) {
    describe(move.id, () => {
      const tree = move.tree;
      const nodeIds = Object.keys(tree);

      it("every prerequisites/prerequisitesAnyOf/excludes id refers to a real node in the same tree", () => {
        for (const node of Object.values(tree)) {
          for (const id of node.prerequisites ?? []) {
            expect(nodeIds, `${move.id}: ${node.id} prerequisites references unknown node "${id}"`).toContain(id);
          }
          for (const set of node.prerequisitesAnyOf ?? []) {
            for (const id of set) {
              expect(nodeIds, `${move.id}: ${node.id} prerequisitesAnyOf references unknown node "${id}"`).toContain(id);
            }
          }
          for (const id of node.excludes ?? []) {
            expect(nodeIds, `${move.id}: ${node.id} excludes references unknown node "${id}"`).toContain(id);
          }
        }
      });

      it("has no node whose id doesn't match its own key", () => {
        for (const [key, node] of Object.entries(tree)) {
          expect(node.id).toBe(key);
        }
      });

      it("choosing every non-conflicting node in some valid order never throws", () => {
        // Greedily pick an order: repeatedly add any node whose prerequisites
        // are already satisfied and that doesn't conflict with what's chosen,
        // skipping nodes when both sides of a fork are already blocked.
        const chosen: string[] = [];
        const chosenSet = new Set<string>();
        const skipped = new Set<string>();
        let progressed = true;
        while (progressed) {
          progressed = false;
          for (const node of Object.values(tree)) {
            if (chosenSet.has(node.id) || skipped.has(node.id)) continue;
            const excludedByChoice = (node.excludes ?? []).some((id) => chosenSet.has(id));
            const excludesAChoice = [...chosenSet].some((id) => (tree[id].excludes ?? []).includes(node.id));
            if (excludedByChoice || excludesAChoice) {
              skipped.add(node.id);
              continue;
            }
            const prereqsMet = (node.prerequisites ?? []).every((id) => chosenSet.has(id));
            const anyOfMet =
              !node.prerequisitesAnyOf ||
              node.prerequisitesAnyOf.length === 0 ||
              node.prerequisitesAnyOf.some((set) => set.every((id) => chosenSet.has(id)));
            if (prereqsMet && anyOfMet) {
              chosen.push(node.id);
              chosenSet.add(node.id);
              progressed = true;
            }
          }
        }
        // Every node must have been either chosen or explicitly skipped as an
        // unreachable fork side — nothing should be left permanently stuck
        // behind an unmet prerequisite.
        expect(chosen.length + skipped.size, `${move.id}: unresolved nodes ${nodeIds.filter((id) => !chosenSet.has(id) && !skipped.has(id))}`).toBe(
          nodeIds.length
        );
        expect(() => applyMoveTree(move, chosen)).not.toThrow();
      });

      it("every excludes pair is genuinely mutually exclusive", () => {
        for (const node of Object.values(tree)) {
          for (const otherId of node.excludes ?? []) {
            // Reaching both sides of a real fork (through whatever prerequisite chain each needs) must throw.
            const bothChosen = [
              ...new Set([...resolveChosenSetFor(tree, node.id), ...resolveChosenSetFor(tree, otherId)]),
            ];
            expect(() => applyMoveTree(move, bothChosen)).toThrow(/conflicts with already-chosen/);
          }
        }
      });
    });
  }
});

describe("Rock Throw tree: v3 redesign — denial, not just bigger rocks", () => {
  const rockThrow = MOVES.rock_throw;

  it("Pinning Impact applies a real but partial Speed debuff, not a stun", () => {
    const respec = applyMoveTree(rockThrow, ["pinning_impact"]);
    expect(respec.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -1, ticks: 16 });
  });

  it("Crippling Snare widens the throw into a real cone, catching a spread of fleeing targets", () => {
    const respec = applyMoveTree(rockThrow, ["pinning_impact", "cracked_joint", "dead_aim", "hobbling_throw", "broken_stride", "crippling_snare"]);
    expect(respec.shape).toEqual({ kind: "cone", length: 3, width: 2 });
  });

  it("Quarry Break capstone trades lockTicks for a real power/penetration spike", () => {
    const respec = applyMoveTree(rockThrow, [
      "pinning_impact",
      "cracked_joint",
      "dead_aim",
      "hobbling_throw",
      "broken_stride",
      "relentless_barrage",
      "skyfall",
      "dead_weight_finisher",
      "quarry_break",
    ]);
    expect(respec.lockTicks).toBe(2);
    expect(respec.defensePenetration).toBeCloseTo(0.3);
    expect(respec.bonusVsType).toEqual({ type: "flying", multiplier: 1.5 });
  });

  it("Bedrock Breaker keystone grants a real resistanceBreaker", () => {
    const respec = applyMoveTree(rockThrow, [
      "bedrock_stance",
      "weathered_slab",
      "granite_grip",
      "unshakeable",
      "bedrock_footing",
      "granite_ward",
      "fracturing_blow",
      "bedrock_resolve",
      "bedrock_breaker",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
  });

  it("Tremor Call marks the target via the real rallyCall primitive, not a flat ally buff", () => {
    const respec = applyMoveTree(rockThrow, ["tremor_call"]);
    expect(respec.rallyCall).toEqual({ ticks: 20 });
  });

  it("Tremor Bond is a real, distinct Sociability lever (a herd heal), not another way to extend the mark", () => {
    const respec = applyMoveTree(rockThrow, ["tremor_call", "sure_footing", "herd_grip", "tremor_bond"]);
    expect(respec.rallyCall).toEqual({ ticks: 20 }); // untouched — Tremor Bond doesn't touch the mark at all
    expect(respec.targetsAlly).toBe(true);
    expect(respec.allyEffect).toEqual({ healFraction: 0.15 });
  });

  it("Herd Ascendant capstone pays off with jam + lifesteal, not a third round of mark-extension", () => {
    const respec = applyMoveTree(rockThrow, [
      "tremor_call",
      "sure_footing",
      "herd_grip",
      "tremor_bond",
      "vanguard_call",
      "colony_watch",
      "tremor_focus",
      "herd_ascendant",
    ]);
    expect(respec.rallyCall).toEqual({ ticks: 20 }); // still the opener's own value — never re-touched
    // jamCooldownTicks is additive across nodes (Vanguard Call's own +1 plus
    // Herd Ascendant's +3), not an overwrite — see applyMoveTree's merge.
    expect(respec.jamCooldownTicks).toBe(4);
    expect(respec.lifestealFraction).toBeCloseTo(0.05);
  });

  it("Rolling Thunder crosslink deepens the real Speed-debuff pin once a target is already marked, not a self-lock", () => {
    const respec = applyMoveTree(rockThrow, ["pinning_impact", "tremor_call", "rolling_thunder"]);
    expect(respec.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -2, ticks: 24 });
    expect(respec.lockTicks).toBeUndefined();
  });

  it("Marked Advantage deepens Rolling Thunder further via the shared rallyMarked primitive", () => {
    const respec = applyMoveTree(rockThrow, ["pinning_impact", "tremor_call", "rolling_thunder", "marked_advantage"]);
    expect(respec.situationalBonus).toEqual({ condition: "rallyMarked", multiplier: 1.3 });
  });

  it("Hobbling Throw only needs one prior node, not both Cracked Joint and Dead Aim together", () => {
    const viaCrackedJointOnly = applyMoveTree(rockThrow, ["pinning_impact", "cracked_joint", "hobbling_throw"]);
    const viaDeadAimOnly = applyMoveTree(rockThrow, ["pinning_impact", "dead_aim", "hobbling_throw"]);
    expect(viaCrackedJointOnly.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -1, ticks: 20 });
    expect(viaDeadAimOnly.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -1, ticks: 20 });
  });

  it("Grinding Advance's bridge (Aggression<->Boldness) reaches both Broken Stride and Bedrock Footing", () => {
    const viaAggr = applyMoveTree(rockThrow, [
      "pinning_impact",
      "bedrock_stance",
      "grinding_advance",
      "grinding_footing",
      "bedrock_momentum",
      "broken_stride",
    ]);
    expect(viaAggr.power).toBe(rockThrow.power + 8);

    const viaBold = applyMoveTree(rockThrow, [
      "pinning_impact",
      "bedrock_stance",
      "grinding_advance",
      "grinding_footing",
      "bedrock_momentum",
      "bedrock_footing",
    ]);
    expect(viaBold.power).toBe(rockThrow.power + 5);
  });

  it("Rolling Thunder's bridge (Sociability<->Aggression) reaches both Tremor Bond and Broken Stride", () => {
    const viaSoc = applyMoveTree(rockThrow, [
      "pinning_impact",
      "tremor_call",
      "rolling_thunder",
      "marked_advantage",
      "converged_quarry",
      "tremor_bond",
    ]);
    expect(viaSoc.targetsAlly).toBe(true);

    const viaAggr = applyMoveTree(rockThrow, [
      "pinning_impact",
      "tremor_call",
      "rolling_thunder",
      "marked_advantage",
      "converged_quarry",
      "broken_stride",
    ]);
    expect(viaAggr.power).toBe(rockThrow.power + 8); // Broken Stride's own +8
    // Converged Quarry deepens Marked Advantage's own rallyMarked payoff
    // (overwrite) rather than bolting on a generic power bump.
    expect(viaAggr.situationalBonus).toEqual({ condition: "rallyMarked", multiplier: 1.6 });
  });
});

describe("Peck tree: reach and positional keystones", () => {
  const peck = MOVES.peck;

  it("Extended Wingspan turns the point-blank stab into a real 2-tile line", () => {
    const respec = applyMoveTree(peck, [
      "swooping_approach",
      "wing_conditioning",
      "dive_strike_footing",
      "extended_wingspan",
    ]);
    expect(respec.shape).toEqual({ kind: "line", length: 2 });
    expect(respec.range).toEqual({ min: 0, max: 2 });
  });

  it("Snatch and Swap keystone is the roster's first positionSwap + positionSwapPull", () => {
    const respec = applyMoveTree(peck, [
      "swooping_approach",
      "wing_conditioning",
      "dive_strike_footing",
      "extended_wingspan",
      "wing_precision",
      "ambush_dive",
      "relentless_harrier",
      "diving_precision",
      "snatch_and_swap",
    ]);
    expect(respec.positionSwap).toBe(true);
    expect(respec.positionSwapPull).toBe(2);
    expect(respec.critCooldownReset).toBe(true);
  });
});

describe("Scratch tree: tree-earned status", () => {
  const scratch = MOVES.scratch;

  it("the base move never rolls a status on its own", () => {
    expect(scratch.statusChance).toBeUndefined();
    expect(scratch.statusKind).toBe("poison");
  });

  it("Envenomed turns statusChance on for the first time, and Deepening Venom stacks on it", () => {
    const respec = applyMoveTree(scratch, ["envenomed", "venom_glands", "envenomed_footing", "deepening_venom"]);
    expect(respec.statusChance).toBeCloseTo(0.25, 5);
    expect(respec.statusKind).toBe("poison");
  });

  it("Toxic Spread keystone is reachable and sets statusSpreads", () => {
    const respec = applyMoveTree(scratch, [
      "envenomed",
      "venom_glands",
      "envenomed_footing",
      "deepening_venom",
      "claw_conditioning",
      "toxin_overload",
      "sandstorm_claws",
      "claw_precision",
      "toxic_spread",
    ]);
    expect(respec.statusSpreads).toBe(true);
  });

  it("Colony Warmth is the only two-passive keystone (grantsPassives, plural)", () => {
    const node = scratch.tree!.colony_warmth;
    expect(node.grantsPassives).toEqual([
      { kind: "healAura", value: 0.01 },
      { kind: "regen", value: 0.02 },
    ]);
  });

  it("Rally the Colony sets a real rallyCall", () => {
    const respec = applyMoveTree(scratch, [
      "colony_call",
      "den_footing",
      "colony_bond_footing",
      "rally_the_colony",
    ]);
    expect(respec.rallyCall).toEqual({ ticks: 20 });
  });
});

describe("Water Gun tree: resistanceBreaker fixes the real weakness", () => {
  const waterGun = MOVES.water_gun;

  it("Overwhelming Current keystone grants resistanceBreaker, not a redundant Fire bonus", () => {
    const respec = applyMoveTree(waterGun, [
      "high_pressure_jet",
      "jet_conditioning",
      "pressurized_footing",
      "piercing_jet",
      "jet_precision",
      "torrent",
      "deluge",
      "jet_focus",
      "overwhelming_current",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
    expect(respec.bonusVsType).toBeUndefined();
  });

  it("Boldness branch's fork un-buffs the target (Undertow) as an alternative to buffing self (Bubble Shield)", () => {
    const undertow = applyMoveTree(waterGun, [
      "knockback_spray",
      "spray_conditioning",
      "evasive_spray_footing",
      "retreating_current",
      "current_precision",
      "undertow",
    ]);
    expect(undertow.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -1, ticks: 20 });

    const bubbleShield = applyMoveTree(waterGun, [
      "knockback_spray",
      "spray_conditioning",
      "evasive_spray_footing",
      "retreating_current",
      "current_precision",
      "bubble_shield",
    ]);
    expect(bubbleShield.statChangeOnHit).toEqual({ target: "self", stat: "defense", stage: 1, ticks: 20 });
  });
});

describe("Hydro Pump tree: v3 redesign — overwhelming, genuinely hard to aim", () => {
  const hydroPump = MOVES.hydro_pump;

  it("Building Pressure is a real wind-up cost (lockTicks), not a free power bump", () => {
    const respec = applyMoveTree(hydroPump, ["building_pressure"]);
    expect(respec.power).toBe(hydroPump.power + 15);
    expect(respec.lockTicks).toBe(1);
  });

  it("Undertow Pull is reachable through either Aggression fork and drags the target on a swap", () => {
    const viaNuke = applyMoveTree(hydroPump, [
      "building_pressure",
      "pump_conditioning",
      "overwhelm_footing",
      "bursting_main",
      "flooding_wake",
      "widening_main",
      "overwhelm_surge",
      "undertow_pull",
    ]);
    expect(viaNuke.positionSwap).toBe(true);
    expect(viaNuke.positionSwapPull).toBe(1);
  });

  it("Flooding Wake leaves real standing water via the already-shipped terrainFill primitive", () => {
    const respec = applyMoveTree(hydroPump, ["building_pressure", "pump_conditioning", "overwhelm_footing", "bursting_main", "flooding_wake"]);
    expect(respec.terrainFill).toEqual({ terrain: "water" });
  });

  it("Tidal Communion is a real 'pod moves as one' payoff (excludesAllies), not a flat team-heal", () => {
    const respec = applyMoveTree(hydroPump, [
      "pod_current",
      "pod_footing",
      "wake_footing",
      "wake_rally",
      "pod_reach",
      "undertow_guard",
      "pod_instinct",
      "pod_precision",
      "tidal_communion",
    ]);
    expect(respec.excludesAllies).toBe(true);
    expect(respec.grantsPassive).toBeUndefined();
  });

  it("Tidal Bastion is a real two-passive keystone, distinct from Water Gun's own resistanceBreaker", () => {
    const node = hydroPump.tree!.tidal_bastion;
    expect(node.grantsPassives).toEqual([
      { kind: "defenseBoost", value: 0.1 },
      { kind: "regen", value: 0.02 },
    ]);
    expect(node.delta.resistanceBreaker).toBeUndefined();
  });

  it("Sociability's fork is a real positional choice (push the threat back vs. interpose yourself), not the reused damageReduction/jam template", () => {
    const guard = hydroPump.tree!.undertow_guard;
    const charge = hydroPump.tree!.riptide_charge;
    expect(guard.delta.forcedMovement).toEqual({ mover: "defender", direction: "away", tiles: 1, timing: "onHit" });
    expect(charge.delta.forcedMovement).toEqual({ mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" });
  });

  it("the Aggression<->Boldness crosslink directly answers the wind-up cost its own branch introduces", () => {
    const respec = applyMoveTree(hydroPump, ["building_pressure", "wading_advance", "surge_and_brace"]);
    expect(respec.lockTicks).toBe(0); // +1 from Building Pressure, -1 from the crosslink
  });

  it("Surge and Brace's bridge (Aggression<->Boldness) reaches both Widening Main and Channel Grip", () => {
    const viaAggr = applyMoveTree(hydroPump, [
      "building_pressure",
      "wading_advance",
      "surge_and_brace",
      "brace_conditioning",
      "unified_current",
      "widening_main",
    ]);
    expect(viaAggr.range).toEqual({ min: 0, max: 5 });

    const viaBold = applyMoveTree(hydroPump, [
      "building_pressure",
      "wading_advance",
      "surge_and_brace",
      "brace_conditioning",
      "unified_current",
      "channel_grip",
    ]);
    expect(viaBold.range).toEqual({ min: 0, max: 5 });
  });

  it("Wake of Violence's bridge (Sociability<->Aggression) reaches both Pod Reach and Widening Main", () => {
    const viaSoc = applyMoveTree(hydroPump, [
      "pod_current",
      "building_pressure",
      "wake_of_violence",
      "surging_wake",
      "violent_confluence",
      "pod_reach",
    ]);
    expect(viaSoc.range).toEqual({ min: 0, max: 5 });

    const viaAggr = applyMoveTree(hydroPump, [
      "pod_current",
      "building_pressure",
      "wake_of_violence",
      "surging_wake",
      "violent_confluence",
      "widening_main",
    ]);
    expect(viaAggr.range).toEqual({ min: 0, max: 5 });
  });
});

describe("Solar Beam tree: v3 redesign — a guardian's dominance display", () => {
  const solarBeam = MOVES.solar_beam;

  it("has no hitsArea by default — Solar Beam stays a single-target beam, just with real range", () => {
    expect(solarBeam.hitsArea).toBeUndefined();
    expect(solarBeam.shape).toEqual({ kind: "line", length: 5 });
  });

  it("Claim the Grove is a real clashing-flavored bonus vs. a rival Grass-type, reachable through either Aggression fork", () => {
    const viaGlare = applyMoveTree(solarBeam, [
      "gathering_light",
      "focusing_lens",
      "dominance_footing",
      "piercing_ray",
      "widening_beam",
      "withering_glare",
      "claim_the_grove",
    ]);
    expect(viaGlare.bonusVsType).toEqual({ type: "grass", multiplier: 1.5 });
  });

  it("Ancient Grove is a real two-passive keystone (thorns + regen), distinct from the resistanceBreaker every other move's Boldness branch reaches for", () => {
    const node = solarBeam.tree!.ancient_grove;
    expect(node.grantsPassives).toEqual([
      { kind: "thorns", value: 0.1 },
      { kind: "regen", value: 0.02 },
    ]);
    expect(node.delta.resistanceBreaker).toBeUndefined();
  });

  it("Sociability's fork makes the ally-effect overwrite an explicit, deliberate choice (heal the grove vs. steel it), not an emergent quirk", () => {
    const healed = applyMoveTree(solarBeam, ["grove_ward", "grove_footing", "grove_reach", "grove_muster", "grove_precision", "vital_bloom"]);
    expect(healed.allyEffect).toEqual({ healFraction: 0.25 });

    const steeled = applyMoveTree(solarBeam, [
      "grove_ward",
      "grove_footing",
      "grove_reach",
      "grove_muster",
      "grove_precision",
      "steadfast_bloom_ally",
    ]);
    expect(steeled.allyEffect).toEqual({ buff: { stat: "defense", stage: 2, ticks: 20 } });
  });

  it("rejects choosing both sides of the ally-effect fork", () => {
    expect(() =>
      applyMoveTree(solarBeam, [
        "grove_ward",
        "grove_footing",
        "grove_reach",
        "grove_muster",
        "grove_precision",
        "vital_bloom",
        "steadfast_bloom_ally",
      ])
    ).toThrow(/conflicts with already-chosen/);
  });

  it("Rooted Assault's bridge (Aggression<->Boldness) reaches both Widening Beam and Deepening Roots", () => {
    const viaAggr = applyMoveTree(solarBeam, ["gathering_light", "sunlit_roots", "rooted_assault", "sunlit_focus", "bedrock_beam", "widening_beam"]);
    expect(viaAggr.range).toEqual({ min: 0, max: 7 });

    const viaBold = applyMoveTree(solarBeam, ["gathering_light", "sunlit_roots", "rooted_assault", "sunlit_focus", "bedrock_beam", "deepening_roots"]);
    expect(viaBold.range).toEqual({ min: 0, max: 7 });
  });

  it("Territorial Flare's bridge (Sociability<->Aggression) reaches both Grove Precision and Widening Beam", () => {
    const viaSoc = applyMoveTree(solarBeam, [
      "grove_ward",
      "gathering_light",
      "territorial_flare",
      "territorial_footing",
      "dominant_bloom",
      "grove_precision",
    ]);
    expect(viaSoc.critRateStage).toBe(2); // Gathering Light's own +1, plus Territorial Footing's own +1
    expect(viaSoc.accuracy).toBe(solarBeam.accuracy + 5); // Grove Precision's own +5

    const viaAggr = applyMoveTree(solarBeam, [
      "grove_ward",
      "gathering_light",
      "territorial_flare",
      "territorial_footing",
      "dominant_bloom",
      "widening_beam",
    ]);
    expect(viaAggr.range).toEqual({ min: 0, max: 7 });
    // Triple Bloom is a real, flashy capstone-tier payoff — a genuine
    // shape/AoE change (earned at notable tier), not another stat bump.
    expect(viaAggr.shape).toEqual({ kind: "cone", length: 5, width: 3 });
    expect(viaAggr.hitsArea).toBe(true);
  });
});

describe("Earthquake tree: v3 redesign — a reckless AoE the herd learns to read", () => {
  const earthquake = MOVES.earthquake;

  it("is a real self-centered AoE by default, not just a single-target hit", () => {
    expect(earthquake.hitsArea).toBe(true);
    expect(earthquake.shape).toEqual({ kind: "burst", radius: 2 });
    // The base move never exempts allies on its own — that's earned.
    expect(earthquake.excludesAllies).toBeUndefined();
  });

  it("Herdsafe Trigger is the Sociability opener that turns on excludesAllies immediately", () => {
    const respec = applyMoveTree(earthquake, ["herdsafe_trigger"]);
    expect(respec.excludesAllies).toBe(true);
  });

  it("Fissure Grip (Boldness opener) leaves real hazard terrain, live from the first point spent", () => {
    const respec = applyMoveTree(earthquake, ["fissure_grip"]);
    expect(respec.terrainFill).toEqual({ terrain: "mud" });
  });

  it("the Aggression fork is a real AoE-size decision: Total Collapse widens the blast, Focused Rupture narrows it", () => {
    const widen = applyMoveTree(earthquake, [
      "fault_trigger",
      "shaking_ground",
      "overload_footing",
      "aftershock_barrage",
      "seismic_feed",
      "total_collapse",
    ]);
    expect(widen.shape).toEqual({ kind: "burst", radius: 3 });

    const narrow = applyMoveTree(earthquake, [
      "fault_trigger",
      "shaking_ground",
      "overload_footing",
      "aftershock_barrage",
      "seismic_feed",
      "focused_rupture",
    ]);
    expect(narrow.shape).toEqual({ kind: "burst", radius: 1 });
  });

  it("Overload Footing's Reckless Overload pairs its recoil with real power, not recoil alone", () => {
    const respec = applyMoveTree(earthquake, ["fault_trigger", "shaking_ground", "overload_footing"]);
    expect(respec.power).toBe(earthquake.power + 10);
    expect(respec.recoilFraction).toBeCloseTo(0.1);
  });

  it("the crosslink bridge (Coordinated Tremor -> Marked Rupture -> Converged Ruin) reaches Aggression's fork one step early, not directly", () => {
    // Converged Ruin alone does NOT satisfy the fork nodes anymore — it only
    // shortcuts into Seismic Feed, one step before the fork, same as the
    // normal path (direct feedback: landing straight on "the choice of 2
    // nodes" was too much).
    expect(() =>
      applyMoveTree(earthquake, ["herdsafe_trigger", "fault_trigger", "coordinated_tremor", "marked_rupture", "converged_ruin", "total_collapse"])
    ).toThrow(/requires \[seismic_feed\]/);

    const viaBridge = applyMoveTree(earthquake, [
      "herdsafe_trigger",
      "fault_trigger",
      "coordinated_tremor",
      "marked_rupture",
      "converged_ruin",
      "seismic_feed",
      "total_collapse",
    ]);
    expect(viaBridge.shape).toEqual({ kind: "burst", radius: 3 });
    // None of the branch's own linear filler chain (Shaking Ground through
    // Aftershock Barrage) was ever chosen.
    expect(viaBridge.recoilFraction).toBeUndefined();

    // The fork itself is still a real, mutually-exclusive choice either way.
    expect(() =>
      applyMoveTree(earthquake, [
        "herdsafe_trigger",
        "fault_trigger",
        "coordinated_tremor",
        "marked_rupture",
        "converged_ruin",
        "seismic_feed",
        "total_collapse",
        "focused_rupture",
      ])
    ).toThrow(/conflicts with already-chosen/);
  });

  it("the same bridge also reaches into Sociability's own fork, not just Aggression", () => {
    // Reachable without Tremor Reach's own normal prerequisite (Bracing
    // Call) or anything earlier in Sociability's filler chain.
    const viaBridge = applyMoveTree(earthquake, [
      "herdsafe_trigger",
      "fault_trigger",
      "coordinated_tremor",
      "marked_rupture",
      "converged_ruin",
      "tremor_reach",
      "guardians_ground",
    ]);
    expect(viaBridge.power).toBe(earthquake.power - 5); // Guardian's Ground's own delta
    expect(viaBridge.excludesAllies).toBe(true); // from Herdsafe Trigger, still present
  });

  it("Ruinous Ground keystone fixes Ground's real Grass/Bug resists", () => {
    const respec = applyMoveTree(earthquake, [
      "fissure_grip",
      "bedrock_footing_2",
      "cracking_footing",
      "bedrock_anchor",
      "deepening_fissure",
      "grounding_brace",
      "rubble_wall",
      "fracture_precision",
      "ruinous_ground",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
  });

  it("Sanctuary Quake keystone is a real, ongoing herd payoff", () => {
    const node = earthquake.tree!.sanctuary_quake;
    expect(node.grantsPassive).toEqual({ kind: "healAura", value: 0.015 });
  });

  it("Marked Rupture deepens Coordinated Tremor's own mark via the shared rallyMarked primitive", () => {
    const respec = applyMoveTree(earthquake, ["herdsafe_trigger", "fault_trigger", "coordinated_tremor", "marked_rupture"]);
    expect(respec.rallyCall).toEqual({ ticks: 20 });
    expect(respec.situationalBonus).toEqual({ condition: "rallyMarked", multiplier: 1.3 });
  });

  it("Cracking Momentum's bridge (Aggression<->Boldness) reaches both Seismic Feed and Deepening Fissure", () => {
    const viaAggr = applyMoveTree(earthquake, [
      "fault_trigger",
      "fissure_grip",
      "cracking_momentum",
      "momentum_footing",
      "fault_convergence",
      "seismic_feed",
    ]);
    expect(viaAggr.lifestealFraction).toBeCloseTo(0.08);

    const viaBold = applyMoveTree(earthquake, [
      "fault_trigger",
      "fissure_grip",
      "cracking_momentum",
      "momentum_footing",
      "fault_convergence",
      "deepening_fissure",
    ]);
    expect(viaBold.defensePenetration).toBeCloseTo(0.3);
  });

  it("Fractured Warning's bridge (Boldness<->Sociability) reaches both Deepening Fissure and Tremor Reach", () => {
    const viaBold = applyMoveTree(earthquake, [
      "fissure_grip",
      "herdsafe_trigger",
      "fractured_warning",
      "tremor_lockstep",
      "warded_convergence",
      "deepening_fissure",
    ]);
    expect(viaBold.defensePenetration).toBeCloseTo(0.3);

    const viaSoc = applyMoveTree(earthquake, [
      "fissure_grip",
      "herdsafe_trigger",
      "fractured_warning",
      "tremor_lockstep",
      "warded_convergence",
      "tremor_reach",
    ]);
    expect(viaSoc.range).toEqual({ min: 0, max: 3 });
  });
});
