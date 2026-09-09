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
      { kind: "regen", value: 0.04 },
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

describe("Hydro Pump tree: v4 two-lane — overwhelming, genuinely hard to aim", () => {
  const hydroPump = MOVES.hydro_pump;

  it("Building Pressure is a real wind-up cost (lockTicks), not a free power bump", () => {
    const respec = applyMoveTree(hydroPump, ["building_pressure"]);
    expect(respec.power).toBe(hydroPump.power + 15);
    expect(respec.lockTicks).toBe(1);
  });

  it("Undertow Pull is reachable through either Aggression fork and drags the target on a swap", () => {
    const viaNuke = applyMoveTree(hydroPump, [
      "building_pressure",
      "overwhelm_footing",
      "pressure_holds",
      "overwhelm_surge",
      "undertow_pull",
    ]);
    expect(viaNuke.positionSwap).toBe(true);
    expect(viaNuke.positionSwapPull).toBe(1);

    const viaVolley = applyMoveTree(hydroPump, [
      "building_pressure",
      "overwhelm_footing",
      "pressure_holds",
      "relentless_surge",
      "undertow_pull",
    ]);
    expect(viaVolley.positionSwap).toBe(true);
    expect(viaVolley.positionSwapPull).toBe(1);
  });

  it("Undertow Pull is also reachable from lane A alone — v4's deep notable is where both lanes converge, not just the fork", () => {
    const viaLaneA = applyMoveTree(hydroPump, [
      "building_pressure",
      "pump_conditioning",
      "bursting_main",
      "flooding_wake",
      "widening_main",
      "undertow_pull",
    ]);
    expect(viaLaneA.positionSwap).toBe(true);
    // Reached without ever taking either fork tip.
    expect(viaLaneA.hits).toBeUndefined();
  });

  it("Narrow the Stream is the Boldness branch's thesis as a real shape change, not a stat bump", () => {
    const respec = applyMoveTree(hydroPump, ["wading_advance", "channel_footing", "narrow_the_stream"]);
    expect(hydroPump.shape).toEqual({ kind: "cone", length: 4, width: 2 });
    expect(respec.shape).toEqual({ kind: "line", length: 5 });
    // The only shape setter in the tree — shape is an overwrite field.
    expect(Object.values(hydroPump.tree!).filter((n) => n.delta.shape !== undefined)).toHaveLength(1);
  });

  it("Strip the Canopy makes the pump a harvesting tool, using the real canopy-harvest path's gatherBurst", () => {
    const respec = applyMoveTree(hydroPump, ["pod_current", "fuller_wash", "strip_the_canopy"]);
    expect(respec.gatherBurst).toBe(3);
    // ...and Fuller Wash deepens the opener's own ally heal rather than
    // granting another stacking healing passive.
    expect(respec.allyEffect).toEqual({ healFraction: 0.22 });
    expect(hydroPump.tree!.fuller_wash.grantsPassive).toBeUndefined();
  });

  it("Flooding Wake leaves real standing water via the already-shipped terrainFill primitive", () => {
    const respec = applyMoveTree(hydroPump, ["building_pressure", "pump_conditioning", "overwhelm_footing", "bursting_main", "flooding_wake"]);
    expect(respec.terrainFill).toEqual({ terrain: "water" });
  });

  it("Pod Current's opener heals AND keeps the pod from hurting its own (excludesAllies)", () => {
    const respec = applyMoveTree(hydroPump, ["pod_current"]);
    expect(respec.targetsAlly).toBe(true);
    expect(respec.allyEffect).toEqual({ healFraction: 0.15 });
    expect(respec.excludesAllies).toBe(true);
  });

  it("Tidal Communion is a real terrain-mastery payoff (aquaticHaste), not a flat team-heal or reused excludesAllies", () => {
    const node = hydroPump.tree!.tidal_communion;
    expect(node.grantsPassive).toEqual({ kind: "aquaticHaste", value: 0.75 });
    expect(node.delta.excludesAllies).toBeUndefined();
  });

  it("Tidal Bastion is a real two-passive keystone, distinct from Water Gun's own resistanceBreaker", () => {
    const node = hydroPump.tree!.tidal_bastion;
    expect(node.grantsPassives).toEqual([
      { kind: "defenseBoost", value: 0.1 },
      { kind: "regen", value: 0.04 },
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

  it("Surge and Brace's bridge (Aggression<->Boldness) lands on one LANE NOTABLE in each branch it connects", () => {
    // v4 moved where a bridge lands: it shortcuts into a lane's NOTABLE
    // (Flooding Wake / Undertow Anchor), skipping that lane's filler grind
    // but never a decision. Same rule as before — reach both branches the
    // crosslink connects — checked at the nodes v4 puts it on.
    const bridge = ["building_pressure", "wading_advance", "surge_and_brace", "brace_conditioning", "unified_current"];

    // Into Aggression: Flooding Wake without Pump Conditioning or Bursting Main.
    const viaAggr = applyMoveTree(hydroPump, [...bridge, "flooding_wake", "widening_main"]);
    expect(viaAggr.terrainFill).toEqual({ terrain: "water" });
    expect(viaAggr.range).toEqual({ min: 0, max: 5 });

    // Into Boldness: Undertow Anchor without Bastion Footing or Open the Valve.
    const viaBold = applyMoveTree(hydroPump, [...bridge, "undertow_anchor", "channel_grip"]);
    expect(viaBold.range).toEqual({ min: 0, max: 5 });
    expect(hydroPump.tree!.undertow_anchor.grantsPassive).toEqual({ kind: "immovable", value: 1 });
  });

  it("Wake of Violence's bridge (Sociability<->Aggression) lands on one LANE NOTABLE in each branch it connects", () => {
    // Same v4 relocation as Surge and Brace above: Wake Rally in
    // Sociability, Pressure Holds in Aggression.
    const bridge = ["pod_current", "building_pressure", "wake_of_violence", "surging_wake", "violent_confluence"];

    // Into Sociability: Wake Rally without Pod Footing or Wake Footing.
    const viaSoc = applyMoveTree(hydroPump, [...bridge, "wake_rally", "pod_reach"]);
    expect(viaSoc.rallyCall).toEqual({ ticks: 20 });
    expect(viaSoc.range).toEqual({ min: 0, max: 5 });

    // Into Aggression: Pressure Holds without Overwhelm Footing.
    const viaAggr = applyMoveTree(hydroPump, [...bridge, "pressure_holds"]);
    expect(viaAggr.critCooldownReset).toBe(true);
  });
});

describe("Solar Beam tree: v4 two-lane — a guardian's dominance display", () => {
  const solarBeam = MOVES.solar_beam;

  it("has no hitsArea by default — Solar Beam stays a single-target beam, just with real range", () => {
    expect(solarBeam.hitsArea).toBeUndefined();
    expect(solarBeam.shape).toEqual({ kind: "line", length: 5 });
  });

  it("Claim the Grove is a real clashing-flavored bonus vs. a rival Grass-type, reachable through either Aggression lane", () => {
    const viaGlare = applyMoveTree(solarBeam, [
      "gathering_light",
      "dominance_footing",
      "widening_beam",
      "withering_glare",
      "dominant_bloom",
      "claim_the_grove",
    ]);
    expect(viaGlare.bonusVsType).toEqual({ type: "grass", multiplier: 1.5 });
  });

  // The regen half became `immovable` when the per-move healing budget landed:
  // the node's own comment described "an immovable, ancient guardian" and then
  // granted regen. What this test exists to prove — that Ancient Grove is a
  // real TWO-passive keystone rather than another resistanceBreaker — is
  // unchanged; only which second passive it is moved. `immovable` is
  // `> 0`-gated in status.ts rather than summed, so the assertion that it is
  // the tree's only grant of it is load-bearing: a second one would be a node
  // that does nothing at all.
  it("Ancient Grove is a real two-passive keystone (thorns + immovable), distinct from the resistanceBreaker every other move's Boldness branch reaches for", () => {
    const node = solarBeam.tree!.ancient_grove;
    expect(node.grantsPassives).toEqual([
      { kind: "thorns", value: 0.1 },
      { kind: "immovable", value: 1 },
    ]);
    expect(node.delta.resistanceBreaker).toBeUndefined();

    const immovableGrants = Object.values(solarBeam.tree!).flatMap((n) =>
      [...(n.grantsPassive ? [n.grantsPassive] : []), ...(n.grantsPassives ?? [])].filter((g) => g.kind === "immovable")
    );
    expect(immovableGrants).toHaveLength(1);
  });

  it("Sociability's fork makes the ally-effect overwrite an explicit, deliberate choice (heal the grove vs. steel it), not an emergent quirk", () => {
    const healed = applyMoveTree(solarBeam, ["grove_ward", "territorial_footing", "grove_bulwark", "vital_bloom"]);
    expect(healed.allyEffect).toEqual({ healFraction: 0.25 });

    const steeled = applyMoveTree(solarBeam, [
      "grove_ward",
      "territorial_footing",
      "grove_bulwark",
      "steadfast_bloom_ally",
    ]);
    expect(steeled.allyEffect).toEqual({ buff: { stat: "defense", stage: 2, ticks: 20 } });
  });

  it("rejects choosing both sides of the ally-effect fork", () => {
    expect(() =>
      applyMoveTree(solarBeam, [
        "grove_ward",
        "territorial_footing",
        "grove_bulwark",
        "vital_bloom",
        "steadfast_bloom_ally",
      ])
    ).toThrow(/conflicts with already-chosen/);
  });

  it("Rooted Assault's bridge lands on a lane notable in each branch it connects — Piercing Ray and Bedrock Beam", () => {
    // v4: a bridge skips a lane's filler grind, never its notable.
    const bridge = ["gathering_light", "sunlit_roots", "rooted_assault", "sunward_stance", "heliostand"];
    expect(applyMoveTree(solarBeam, [...bridge, "piercing_ray"]).defensePenetration).toBeGreaterThan(0);
    expect(applyMoveTree(solarBeam, [...bridge, "bedrock_beam"]).defensePenetration).toBeGreaterThan(0);
  });

  it("Territorial Flare's bridge lands on a lane notable in each branch it connects — Grove Muster and Widening Beam", () => {
    // v4: bridges reach ONE lane per branch, which is what gives each bridge a
    // character instead of making it a skeleton key.
    const bridge = ["grove_ward", "gathering_light", "territorial_flare", "flare_wider", "sunspot"];
    expect(applyMoveTree(solarBeam, [...bridge, "grove_muster"]).rallyCall).toBeDefined();
    expect(applyMoveTree(solarBeam, [...bridge, "widening_beam"]).range!.max).toBeGreaterThan(solarBeam.range!.max);
  });
});

describe("Rock Slide tree: v4 two-lane — stone arriving from above", () => {
  const rockSlide = MOVES.rock_slide;

  it("Straight Down is the drop lane's payoff: the one thing a hillside answers that a thrown rock doesn't — being built to shrug rock off", () => {
    const built = applyMoveTree(rockSlide, ["raining_stones", "steadier_aim", "crushing_debris", "straight_down"]);
    expect(built.resistanceBreaker).toEqual({ multiplier: 1.5 });
    // Distinct from its sibling tree: Rock Throw answers fliers (bonusVsType),
    // this one answers resists.
    expect(built.bonusVsType).toBeUndefined();
  });

  it("Swept Off is a real positional payoff on an AoE — the whole bowl gets carried a tile outward, reachable from either lane", () => {
    const viaDrop = applyMoveTree(rockSlide, [
      "raining_stones",
      "steadier_aim",
      "crushing_debris",
      "straight_down",
      "heavier_boulders",
      "swept_off",
    ]);
    expect(viaDrop.hitsArea).toBe(true);
    expect(viaDrop.forcedMovement).toEqual({ mover: "defender", direction: "away", tiles: 1, timing: "onHit" });

    const viaSlope = applyMoveTree(rockSlide, [
      "raining_stones",
      "faster_collapse",
      "ground_shaking_impact",
      "heavier_stones",
      "swept_off",
    ]);
    expect(viaSlope.forcedMovement).toEqual({ mover: "defender", direction: "away", tiles: 1, timing: "onHit" });
  });

  it("Bring It Down is a cornered-user lever with its cost in the same node — not a free power bump", () => {
    const node = rockSlide.tree!.bring_it_down;
    expect(node.delta.selfStateBonus).toEqual({ condition: "selfLowHp", multiplier: 1.4 });
    expect(node.delta.lockTicks).toBe(1);
    expect(node.delta.power).toBeGreaterThan(0);
  });

  it("Set Yourselves is the herd's own half of the warning — a per-use ally brace, not another permanent aura", () => {
    const built = applyMoveTree(rockSlide, ["herd_warning", "clearer_warning", "deeper_rumble", "set_yourselves"]);
    expect(built.excludesAllies).toBe(true);
    expect(built.allyEffectOnAttack).toBe(true);
    expect(built.allyEffect).toEqual({ buff: { stat: "defense", stage: 1, ticks: 20 } });
    expect(rockSlide.tree!.set_yourselves.grantsPassive).toBeUndefined();
    expect(rockSlide.tree!.set_yourselves.grantsPassives).toBeUndefined();
  });

  it("Take Cover escalates the same ally-effect on the same chain (intended ladder), not an independent second setter", () => {
    const built = applyMoveTree(rockSlide, [
      "herd_warning",
      "clearer_warning",
      "deeper_rumble",
      "set_yourselves",
      "take_cover",
    ]);
    expect(built.allyEffect).toEqual({ buff: { stat: "defense", stage: 2, ticks: 24 } });
    expect(rockSlide.tree!.take_cover.prerequisites).toEqual(["set_yourselves"]);
  });

  it("Quarried Weight's bridge lands on a lane notable in each branch it connects — Straight Down and Unbroken", () => {
    // v4: a bridge skips a lane's filler grind, never its notable.
    const bridge = ["raining_stones", "stone_shield", "quarried_weight", "heaved_mass", "mountainfall"];
    expect(applyMoveTree(rockSlide, [...bridge, "straight_down"]).resistanceBreaker).toBeDefined();
    expect(rockSlide.tree!.unbroken.prerequisitesAnyOf).toContainEqual(["mountainfall"]);
  });

  it("Second Wave's bridge lands on a lane notable in each branch it connects — Set Yourselves and Ground-Shaking Impact", () => {
    const bridge = ["herd_warning", "raining_stones", "second_wave", "rolling_aftershock", "no_respite"];
    expect(applyMoveTree(rockSlide, [...bridge, "set_yourselves"]).allyEffectOnAttack).toBe(true);
    expect(applyMoveTree(rockSlide, [...bridge, "ground_shaking_impact"]).jamCooldownTicks).toBe(3);
  });

  it("the high-ground fork stays a real, permanent choice: the perch or the rubble, never both", () => {
    const path = ["stone_shield", "settled_stance", "unbroken"];
    expect(applyMoveTree(rockSlide, [...path, "weathering"]).situationalBonus).toEqual({
      condition: "elevation",
      multiplier: 1.45,
    });
    expect(() => applyMoveTree(rockSlide, [...path, "weathering", "jagged_edges"])).toThrow(
      /conflicts with already-chosen/
    );
  });
});

describe("Earthquake tree: v4 — a reckless AoE the herd learns to read", () => {
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
    // v4: the fork sits at the tail of Aggression's lane B (Reckless
    // Overload -> Crushing Mass -> fork), not at the end of one linear chain.
    const widen = applyMoveTree(earthquake, ["fault_trigger", "overload_footing", "crushing_mass", "total_collapse"]);
    expect(widen.shape).toEqual({ kind: "burst", radius: 3 });

    const narrow = applyMoveTree(earthquake, ["fault_trigger", "overload_footing", "crushing_mass", "focused_rupture"]);
    expect(narrow.shape).toEqual({ kind: "burst", radius: 1 });

    // Still mutually exclusive, and still the tree's ONLY two shape setters —
    // Boldness's Widening Rift used to set one too, which made a build taking
    // both silently order-dependent.
    expect(() => applyMoveTree(earthquake, ["fault_trigger", "overload_footing", "crushing_mass", "total_collapse", "focused_rupture"])).toThrow(
      /conflicts with already-chosen/
    );
    expect(Object.values(earthquake.tree!).filter((n) => (n.delta as { shape?: unknown }).shape !== undefined).map((n) => n.id).sort()).toEqual([
      "focused_rupture",
      "total_collapse",
    ]);
  });

  it("Overload Footing's Reckless Overload pairs its recoil with real power, not recoil alone", () => {
    const respec = applyMoveTree(earthquake, ["fault_trigger", "shaking_ground", "overload_footing"]);
    expect(respec.power).toBe(earthquake.power + 10);
    expect(respec.recoilFraction).toBeCloseTo(0.1);
  });

  it("the crosslink bridge (Coordinated Tremor -> Marked Rupture -> Converged Ruin) reaches Aggression's fork one step early, not directly", () => {
    // Converged Ruin alone does NOT satisfy the fork nodes — it shortcuts
    // into Crushing Mass, the LANE NOTABLE one step before the fork, same as
    // the normal path (direct feedback: landing straight on "the choice of 2
    // nodes" was too much). v4 changed WHICH node that is — a bridge now
    // lands on a lane notable, so it skips the lane's filler grind but never
    // the lane's own notable and never the fork.
    expect(() =>
      applyMoveTree(earthquake, ["herdsafe_trigger", "fault_trigger", "coordinated_tremor", "marked_rupture", "converged_ruin", "total_collapse"])
    ).toThrow(/requires \[crushing_mass\]/);

    const viaBridge = applyMoveTree(earthquake, [
      "herdsafe_trigger",
      "fault_trigger",
      "coordinated_tremor",
      "marked_rupture",
      "converged_ruin",
      "crushing_mass",
      "total_collapse",
    ]);
    expect(viaBridge.shape).toEqual({ kind: "burst", radius: 3 });
    // Reckless Overload — lane B's own filler, the only recoil node on this
    // route — was never chosen, so the bridge really did skip the grind.
    expect(viaBridge.recoilFraction).toBeUndefined();

    // The fork itself is still a real, mutually-exclusive choice either way.
    expect(() =>
      applyMoveTree(earthquake, [
        "herdsafe_trigger",
        "fault_trigger",
        "coordinated_tremor",
        "marked_rupture",
        "converged_ruin",
        "crushing_mass",
        "total_collapse",
        "focused_rupture",
      ])
    ).toThrow(/conflicts with already-chosen/);
  });

  it("the same bridge also reaches into Sociability's own fork, not just Aggression", () => {
    // Reachable without Bracing Call's own normal prerequisite (Herdsafe
    // Footing) or anything else in Sociability's lane B filler chain.
    const viaBridge = applyMoveTree(earthquake, [
      "herdsafe_trigger",
      "fault_trigger",
      "coordinated_tremor",
      "marked_rupture",
      "converged_ruin",
      "bracing_call",
      "guardians_ground",
    ]);
    expect(viaBridge.power).toBe(earthquake.power - 5); // Guardian's Ground's own delta
    expect(viaBridge.excludesAllies).toBe(true); // from Herdsafe Trigger, still present
  });

  // v4 moved this node from Boldness's terminal capstone to its DEEP NOTABLE
  // (the convergence both Fracture lanes end on) — the assertion below is the
  // same mechanic, unchanged in strength; only where it sits in the branch and
  // the walk to it moved. Eat the Ruin is the capstone now.
  it("Ruinous Ground (Boldness's deep notable) fixes Ground's real Grass/Bug resists", () => {
    const respec = applyMoveTree(earthquake, [
      "fissure_grip",
      "deepening_fissure",
      "rubble_wall",
      "grounding_brace",
      "ruinous_ground",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
  });

  it("Eat the Ruin (Boldness capstone) spends the mud this move's own opener lays down", () => {
    const respec = applyMoveTree(earthquake, [
      "fissure_grip",
      "deepening_fissure",
      "rubble_wall",
      "grounding_brace",
      "ruinous_ground",
      "settling_ground",
      "eat_the_ruin",
    ]);
    // Fissure Grip fills the ground it lands on with mud; the capstone
    // consumes that same terrain kind from under the user for a real damage
    // multiplier. The loop is closed on purpose — same terrain both ends.
    expect(respec.terrainFill).toEqual({ terrain: "mud" });
    expect(respec.consumesOwnTerrain).toEqual({ terrain: "mud", damageMultiplier: 2.5 });
  });

  it("Sanctuary Quake keystone is a real, ongoing herd payoff", () => {
    const node = earthquake.tree!.sanctuary_quake;
    expect(node.grantsPassive).toEqual({ kind: "healAura", value: 0.015 });
  });

  it("Marked Rupture deepens Coordinated Tremor's own mark via the shared rallyMarked primitive", () => {
    const crosslinkOnly = applyMoveTree(earthquake, ["herdsafe_trigger", "fault_trigger", "coordinated_tremor"]);
    expect(crosslinkOnly.rallyCall).toEqual({ ticks: 20 });

    const respec = applyMoveTree(earthquake, ["herdsafe_trigger", "fault_trigger", "coordinated_tremor", "marked_rupture"]);
    // Principle 13: a bridge's filler must DEEPEN its own crosslink's lever,
    // not reach for a new one. This node used to carry only the rallyMarked
    // bonus and share nothing with Coordinated Tremor's mark. It now holds
    // the mark strictly longer as well as paying off on it.
    expect(respec.rallyCall).toEqual({ ticks: 32 });
    expect(respec.rallyCall!.ticks).toBeGreaterThan(crosslinkOnly.rallyCall!.ticks);
    expect(respec.situationalBonus).toEqual({ condition: "rallyMarked", multiplier: 1.3 });
  });

  // v4 changed WHERE a bridge lands: it now drops you on ONE lane notable per
  // branch it connects, not on a mid-lane filler. So the assertions below name
  // different landing nodes than the v3 versions did — that is the rule change,
  // not a weakened test. Each still proves the same two things the v3 test did:
  // the shortcut works, and it works into BOTH branches the crosslink joins
  // (principle 11), reaching a node the walker could not otherwise have.
  it("Cracking Momentum's bridge (Aggression<->Boldness) lands on Seismic Feed and Rubble Wall", () => {
    const viaAggr = applyMoveTree(earthquake, [
      "fault_trigger",
      "fissure_grip",
      "cracking_momentum",
      "momentum_footing",
      "fault_convergence",
      "seismic_feed",
    ]);
    expect(viaAggr.lifestealFraction).toBeCloseTo(0.08);
    // Aggression's own lane A filler chain (Shaking Ground, Aftershock
    // Barrage) was never taken — this really is a shortcut.
    expect(viaAggr.hits).toBeUndefined();

    const viaBold = applyMoveTree(earthquake, [
      "fault_trigger",
      "fissure_grip",
      "cracking_momentum",
      "momentum_footing",
      "fault_convergence",
      "rubble_wall",
    ]);
    expect(viaBold.forcedMovement).toEqual({ mover: "defender", direction: "away", tiles: 1, timing: "onHit" });
    // Boldness's own lane B filler (Deepening Fissure) was skipped: the only
    // defensePenetration on this route is the bridge's own, i.e. none.
    expect(viaBold.defensePenetration).toBeUndefined();
  });

  it("Fractured Warning's bridge (Boldness<->Sociability) lands on Bedrock Anchor and Communal Steadying", () => {
    const viaBold = applyMoveTree(earthquake, [
      "fissure_grip",
      "herdsafe_trigger",
      "fractured_warning",
      "tremor_lockstep",
      "warded_convergence",
      "bedrock_anchor",
    ]);
    expect(viaBold.lockTicks).toBe(1); // Bedrock Anchor's own delta
    expect(viaBold.power).toBe(earthquake.power + 12);
    expect(earthquake.tree!.bedrock_anchor.grantsPassive).toEqual({ kind: "immovable", value: 1 });
    // Boldness's own lane A filler chain (Bedrock Footing, Cracking Footing)
    // was never taken.
    expect(viaBold.defensePenetration).toBeUndefined();

    const socRoute = ["fissure_grip", "herdsafe_trigger", "fractured_warning", "tremor_lockstep", "warded_convergence", "communal_steadying"];
    expect(() => applyMoveTree(earthquake, socRoute)).not.toThrow();
    expect(earthquake.tree!.communal_steadying.grantsPassive).toEqual({ kind: "regen", value: 0.03 });
    // Control: without the bridge notable the same walk is illegal, so the
    // assertion above is really testing the shortcut and not a node that was
    // reachable anyway.
    expect(() => applyMoveTree(earthquake, socRoute.filter((id) => id !== "warded_convergence"))).toThrow(/communal_steadying/);
  });

  it("Shaken Loose makes the quake a real food source for the herd, not another lifesteal node", () => {
    // needs.ts's canopy-harvest path takes any non-status damage move that is
    // off cooldown as the harvest move and adds its `gatherBurst` straight to
    // digTicksAccrued, so this fires for real on Earthquake.
    const respec = applyMoveTree(earthquake, ["herdsafe_trigger", "shaken_loose"]);
    expect(respec.gatherBurst).toBe(2);
    expect(respec.category).not.toBe("status");
    expect(respec.power).toBeGreaterThan(0);
    // And it is no longer a copy of Aggression's Seismic Feed.
    expect(respec.lifestealFraction).toBeUndefined();
  });
});

describe("Body Slam tree: inevitability, not just a heavier hit", () => {
  const bodySlam = MOVES.body_slam;

  it("is a real single-target hit by default — the AoE is earned, not baked in", () => {
    expect(bodySlam.shape).toEqual({ kind: "point" });
    expect(bodySlam.hitsArea).toBeUndefined();
  });

  it("Avalanche (Aggression keystone) turns the single slam into a real localized collapse, and is where the real weight payoff now lands", () => {
    // v4 walk: the opener, the Deadfall lane (numbing filler -> lane
    // notable -> either fork tip), then the branch's deep notable, its
    // filler and the capstone.
    const respec = applyMoveTree(bodySlam, [
      "heavy_step",
      "numbing_follow_through",
      "deadfall",
      "second_slam",
      "inevitable",
      "crushing_follow_up",
      "avalanche",
    ]);
    expect(respec.shape).toEqual({ kind: "burst", radius: 1 });
    expect(respec.hitsArea).toBe(true);
    // Moved down from the old Full Weight opener, per direct feedback that
    // starting this strong was backwards — Heavy Step itself carries no
    // weightScaling at all.
    expect(respec.weightScaling).toEqual({ factor: 0.15 });
    expect(bodySlam.tree!.heavy_step.delta.weightScaling).toBeUndefined();
  });

  it("Heavy Step (Aggression opener) is a modest lunge, not the old opener's big weight swing", () => {
    expect(bodySlam.tree!.heavy_step.delta).toEqual({
      forcedMovement: { mover: "attacker", direction: "closer", tiles: 1, timing: "beforeHit" },
    });
  });

  it("Unbudging (Boldness notable) grants a real Agent-level passive, not a MoveSpec delta", () => {
    expect(bodySlam.tree!.unbudging.grantsPassive).toEqual({ kind: "immovable", value: 1 });
    // applyMoveTree's own resolved MoveSpec never carries a passive — it's
    // asserted on the tree node directly, not on the respec result (a real
    // gotcha this whole doc's test suite has hit more than once).
    const respec = applyMoveTree(bodySlam, ["dead_weight", "settled_footing", "patient_reset", "unbudging"]);
    expect((respec as Record<string, unknown>).grantsPassive).toBeUndefined();
  });

  it("The Reckoning (Boldness keystone) is a real charge commitment, not more armor", () => {
    const respec = applyMoveTree(bodySlam, [
      "dead_weight",
      "settled_footing",
      "patient_reset",
      "unbudging",
      "bracing_follow_through",
      "weathered_giant",
      "settled_power",
      "the_reckoning",
    ]);
    expect(respec.chargeAttack).toEqual({ ticks: 2, bonusPower: 40, leapTiles: 5 });
  });

  it("At Peace (Sociability keystone) grants two passives at once, bigger than any single earlier grant on the branch", () => {
    expect(bodySlam.tree!.undisturbed.grantsPassives).toEqual([
      { kind: "calmingPresence", value: 0.5 },
      { kind: "defenseBoost", value: 0.08 },
    ]);
    // The capstone's own calmingPresence jump is bigger than No Quarrel's
    // (the mid-branch notable) — direct feedback that the reverse read as
    // the capstone being less interesting than a notable along the way.
    expect(bodySlam.tree!.undisturbed.grantsPassives![0].value).toBeGreaterThan(bodySlam.tree!.no_quarrel.grantsPassive!.value);
  });

  it("Undisturbed (Sociability notable, renamed down from the old keystone) grants a real but modest single passive", () => {
    expect(bodySlam.tree!.left_in_peace.grantsPassive).toEqual({ kind: "thorns", value: 0.08 });
  });

  it("Unbothered grants a real combat-relevant passive (unshaken), not just a wild-AI-only opt-out", () => {
    // Direct follow-up: nonTerritorial only ever mattered for wild-agent
    // resource disputes — a dead pick the moment this move sees real combat.
    // It moved down to Not Worth It; Unbothered itself now grants the
    // literal read of its own name.
    expect(bodySlam.tree!.unbothered.grantsPassive).toEqual({ kind: "unshaken", value: 1 });
    expect(bodySlam.tree!.settled_ease.grantsPassive).toEqual({ kind: "nonTerritorial", value: 1 });
  });

  it("No Quarrel (Sociability) grants the real non-herd de-escalation passive the solitary redesign asked for", () => {
    expect(bodySlam.tree!.no_quarrel.grantsPassive).toEqual({ kind: "calmingPresence", value: 0.3 });
    // No targetsAlly/allyEffect anywhere left on this branch — the old
    // herd-support version is gone, not just renamed.
    for (const node of Object.values(bodySlam.tree!)) {
      if (node.leaning !== "sociability") continue;
      expect(node.delta.targetsAlly).toBeUndefined();
      expect(node.delta.allyEffect).toBeUndefined();
    }
  });

  it("the fork choices are genuine tradeoffs, not strictly-better stat sticks", () => {
    // Both v4 lanes walked, so the power arithmetic is the same as before
    // the conversion: +8 (Mounting Momentum) +8 (Rolling Advance) +15.
    const secondSlam = applyMoveTree(bodySlam, ["heavy_step", "mounting_momentum", "bearing_down", "ground_shaking_landing", "rolling_advance", "numbing_follow_through", "deadfall", "second_slam"]);
    expect(secondSlam.power).toBe(bodySlam.power + 8 + 8 + 15);
    expect(secondSlam.recoilFraction).toBeCloseTo(0.08);

    const rollingCrush = applyMoveTree(bodySlam, ["heavy_step", "mounting_momentum", "bearing_down", "ground_shaking_landing", "rolling_advance", "numbing_follow_through", "deadfall", "rolling_crush"]);
    expect(rollingCrush.hits).toEqual({ min: 2, max: 2 });
    expect(rollingCrush.power).toBe(bodySlam.power + 8 + 8 - 12);

    // The Boldness fork moved to the tail of lane B (Where It's Been
    // Lying), so the walk to it now passes Heaving Up's +10 as well as lane
    // A's +5 — the tradeoff asserted is unchanged: Sink In pays 5 power for
    // real regen.
    const sinkIn = applyMoveTree(bodySlam, ["dead_weight", "settled_footing", "patient_reset", "unbudging", "bracing_follow_through", "heaving_up", "crushed_thicket", "sink_in"]);
    expect(sinkIn.power).toBe(bodySlam.power + 5 + 10 - 5);
    expect(bodySlam.tree!.sink_in.grantsPassive).toEqual({ kind: "regen", value: 0.025 });

    const fullBulk = applyMoveTree(bodySlam, ["dead_weight", "settled_footing", "patient_reset", "unbudging", "bracing_follow_through", "heaving_up", "crushed_thicket", "full_bulk"]);
    expect(fullBulk.accuracy).toBe(bodySlam.accuracy - 8 + 8);
    expect(bodySlam.tree!.full_bulk.grantsPassive).toEqual({ kind: "damageReduction", value: 0.06 });

    const wideBerth = applyMoveTree(bodySlam, ["unbothered", "settled_ease", "unhurried_reset", "no_quarrel", "quiet_ground", "pinned_under", "finally_roused", "wide_berth"]);
    expect(bodySlam.tree!.wide_berth.grantsPassive).toEqual({ kind: "calmingPresence", value: 0.2 });
    expect(wideBerth.power).toBe(bodySlam.power + 5);

    const steadyNerve = applyMoveTree(bodySlam, ["unbothered", "settled_ease", "unhurried_reset", "no_quarrel", "quiet_ground", "pinned_under", "finally_roused", "steady_nerve"]);
    expect(bodySlam.tree!.steady_nerve.grantsPassive).toEqual({ kind: "regen", value: 0.025 });
    expect(steadyNerve.power).toBe(bodySlam.power + 5);
  });

  it("second_slam and rolling_crush are a real mutually exclusive fork", () => {
    expect(() => applyMoveTree(bodySlam, ["heavy_step", "numbing_follow_through", "deadfall", "second_slam", "rolling_crush"])).toThrow(
      /conflicts with already-chosen/
    );
  });

  it("Braced Commitment's bridge (Aggression<->Boldness) reaches one lane notable per branch — Ground-Shaking Landing and Crushed Thicket", () => {
    // ASSERTION MEANING CHANGED WITH v4, deliberately: a bridge used to land
    // one filler short of a branch's next notable; the two-lane standard
    // lands it ON a lane notable instead, skipping that lane's filler grind
    // but never the lane's own fork. What is still asserted, unchanged, is
    // that the bridge does NOT hand over a fork: Second Slam still requires
    // its own lane notable (Deadfall) first.
    expect(() =>
      applyMoveTree(bodySlam, ["heavy_step", "dead_weight", "braced_commitment", "deepening_brace", "settled_impact", "second_slam"])
    ).toThrow(/requires \[deadfall\]/);

    const viaAgg = applyMoveTree(bodySlam, ["heavy_step", "dead_weight", "braced_commitment", "deepening_brace", "settled_impact", "ground_shaking_landing"]);
    expect(viaAgg.statChangeOnHit).toEqual({ target: "self", stat: "defense", stage: 3, ticks: 18 });
    expect(viaAgg.defensePenetration).toBeCloseTo(0.15);
    expect(viaAgg.forcedMovement).toEqual({ mover: "defender", direction: "away", tiles: 2, timing: "onHit" });
    // None of the Momentum lane's own filler chain was ever chosen.
    expect(viaAgg.power).toBe(bodySlam.power);
    expect(viaAgg.cooldownTicks).toBe(bodySlam.cooldownTicks);

    const viaBold = applyMoveTree(bodySlam, ["heavy_step", "dead_weight", "braced_commitment", "deepening_brace", "settled_impact", "crushed_thicket"]);
    expect(viaBold.consumesOwnTerrain).toEqual({ terrain: "bush", damageMultiplier: 1.5 });
    // Lane B's own filler (Heaving Up, +10 power) was skipped by the bridge.
    expect(viaBold.power).toBe(bodySlam.power);
  });

  it("Nothing to Prove's bridge (Boldness<->Sociability) deepens its own calmingPresence lever, and lands on one lane notable per branch", () => {
    // v4 landing change: Unbudging (Boldness lane A) and Finally Roused
    // (Sociability lane B), rather than the old pre-fork filler Quiet
    // Ground. Same rule as every other bridge here — it skips a lane's
    // grind, never its decision.
    const respec = applyMoveTree(bodySlam, [
      "dead_weight",
      "unbothered",
      "called_to_stand",
      "steadfast_focus",
      "undivided_stand",
      "unbudging",
      "finally_roused",
    ]);
    // grantsPassive isn't part of the resolved MoveSpec — the real payoff is
    // asserted on the tree nodes' own accumulated values.
    expect(bodySlam.tree!.called_to_stand.grantsPassive).toEqual({ kind: "calmingPresence", value: 0.15 });
    expect(bodySlam.tree!.steadfast_focus.grantsPassive).toEqual({ kind: "calmingPresence", value: 0.15 });
    expect(bodySlam.tree!.undivided_stand.grantsPassive).toEqual({ kind: "calmingPresence", value: 0.2 });
    // Both landings are real, and neither lane's filler was walked.
    expect(bodySlam.tree!.unbudging.grantsPassive).toEqual({ kind: "immovable", value: 1 });
    expect(respec.selfStateBonus).toEqual({ condition: "selfLowHp", multiplier: 1.5 });
    expect(respec.power).toBe(bodySlam.power);
  });

  it("Provoked Charge's bridge (Sociability<->Aggression) pairs its lockTicks cost with a real, growing benefit", () => {
    const respec = applyMoveTree(bodySlam, ["unbothered", "heavy_step", "provoked_charge", "full_commitment", "undivided"]);
    expect(respec.lockTicks).toBe(1);
    expect(respec.power).toBe(bodySlam.power + 10 + 10 + 15);
    expect(respec.lifestealFraction).toBeCloseTo(0.05);
  });
});
