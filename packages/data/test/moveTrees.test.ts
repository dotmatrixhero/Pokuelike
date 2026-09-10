import { describe, expect, it } from "vitest";
import { applyMoveTree, raiseFertility, raiseFertilityCeiling, resolveAllyEffect, resolveShape, resolveSituationalBonuses, resolveStatChangesOnHit } from "@pokuelike/engine";
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

describe("Rock Throw tree: v4 — one rock, found, aimed and gone", () => {
  const rockThrow = MOVES.rock_throw;

  it("Pinning Impact applies a real but partial Speed debuff, not a stun", () => {
    const respec = applyMoveTree(rockThrow, ["pinning_impact"]);
    expect(respec.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -1, ticks: 16 });
  });

  // v4 replaced `crippling_snare` (which set `shape: cone` and nothing else)
  // with `driven_back`. The old node was INERT, and this pair of tests is the
  // regression guard for the reason why: `shape` is only ever read inside
  // `resolveAreaHit` (predation.ts), which `resolveHit` only calls when
  // `hitsArea` is true. Rock Throw is a single-target move, so a tree node
  // that only widened the footprint spent a skill point on nothing.
  it("no node in the tree sets `shape` — it would be inert on a non-area move", () => {
    const shapeSetters = Object.values(rockThrow.tree!).filter((n) => n.delta.shape !== undefined);
    expect(shapeSetters).toEqual([]);
    expect(rockThrow.hitsArea).toBeFalsy();
    expect(Object.values(rockThrow.tree!).some((n) => n.delta.hitsArea)).toBe(false);
  });

  it("Driven Back replaces the inert cone with a real knockback, and keeps the fork", () => {
    const respec = applyMoveTree(rockThrow, ["pinning_impact", "loose_scree", "hobbling_throw", "driven_back"]);
    expect(respec.forcedMovement).toEqual({ mover: "defender", direction: "away", tiles: 1, timing: "onHit" });
    // One tile of shove leaves the target inside the move's own range, so the
    // fork buys distance without ending the engagement.
    expect(respec.range!.max).toBeGreaterThan(1);
    expect(rockThrow.tree!.driven_back.excludes).toEqual(["relentless_barrage"]);
  });

  it("Stone Underfoot is the tree's only consumesOwnTerrain setter, and escalates the base 3x", () => {
    // The engine OVERWRITES `consumesOwnTerrain` (`applyMoveTree`), so a
    // second setter anywhere in the tree would silently win or lose on
    // allocation order. This move's whole identity is the boulder it spends,
    // so exactly one node is allowed to touch it.
    const setters = Object.values(rockThrow.tree!).filter((n) => n.delta.consumesOwnTerrain !== undefined);
    expect(setters.map((n) => n.id)).toEqual(["stone_underfoot"]);
    expect(rockThrow.consumesOwnTerrain).toEqual({ terrain: "boulder", damageMultiplier: 3 });
    const respec = applyMoveTree(rockThrow, ["bedrock_stance", "edge_on", "stone_underfoot"]);
    expect(respec.consumesOwnTerrain).toEqual({ terrain: "boulder", damageMultiplier: 4.5 });
  });

  it("Quarry Break capstone trades lockTicks for a real power/penetration spike", () => {
    // v4 walk: the aim lane (Dead Aim -> Cracked Joint -> Skyfall -> Longer
    // Arm) into the deep notable, then the filler and the capstone. The
    // assertions are unchanged from v3.
    const respec = applyMoveTree(rockThrow, [
      "pinning_impact",
      "dead_aim",
      "cracked_joint",
      "skyfall",
      "longer_arm",
      "broken_stride",
      "quarry_footing",
      "quarry_break",
    ]);
    expect(respec.lockTicks).toBe(2);
    expect(respec.defensePenetration).toBeCloseTo(0.5); // Quarry Footing's 0.2 + the capstone's 0.3
    expect(respec.bonusVsType).toEqual({ type: "flying", multiplier: 1.5 });
  });

  it("Bedrock Breaker keystone grants a real resistanceBreaker", () => {
    const respec = applyMoveTree(rockThrow, [
      "bedrock_stance",
      "weathered_slab",
      "granite_grip",
      "unshakeable",
      "bedrock_footing",
      "fracturing_blow",
      "bedrock_resolve",
      "bedrock_breaker",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
  });

  it("Fracturing Blow and Bedrock Breaker are one resistanceBreaker ladder, not two racing setters", () => {
    const midway = applyMoveTree(rockThrow, [
      "bedrock_stance",
      "weathered_slab",
      "granite_grip",
      "unshakeable",
      "bedrock_footing",
      "fracturing_blow",
    ]);
    expect(midway.resistanceBreaker).toEqual({ multiplier: 1.4 });
  });

  it("Tremor Call marks the target via the real rallyCall primitive, not a flat ally buff", () => {
    const respec = applyMoveTree(rockThrow, ["tremor_call"]);
    expect(respec.rallyCall).toEqual({ ticks: 20 });
  });

  it("Carrying Rumble is the one node allowed to touch the mark after the opener", () => {
    const respec = applyMoveTree(rockThrow, ["tremor_call", "sure_footing", "herd_grip", "carrying_rumble"]);
    expect(respec.rallyCall).toEqual({ ticks: 34 });
    const markSetters = Object.values(rockThrow.tree!).filter((n) => n.delta.rallyCall !== undefined);
    expect(markSetters.map((n) => n.id).sort()).toEqual(["carrying_rumble", "tremor_call"]);
  });

  it("Tremor Bond is a real, distinct Sociability lever (a herd heal), not another way to extend the mark", () => {
    const respec = applyMoveTree(rockThrow, ["tremor_call", "called_shot", "tremor_bond"]);
    expect(respec.rallyCall).toEqual({ ticks: 20 }); // untouched — Tremor Bond doesn't touch the mark at all
    expect(respec.targetsAlly).toBe(true);
    expect(respec.allyEffect).toEqual({ healFraction: 0.15 });
  });

  it("Colony Watch makes the herd effect fire on every throw, escalating Tremor Bond's own allyEffect", () => {
    const respec = applyMoveTree(rockThrow, [
      "tremor_call",
      "called_shot",
      "tremor_bond",
      "vanguard_call",
      "colony_watch",
    ]);
    expect(respec.allyEffectOnAttack).toBe(true);
    expect(respec.allyEffect).toEqual({ healFraction: 0.18, buff: { stat: "attack", stage: 1, ticks: 14 } });
  });

  it("Herd Ascendant capstone pays off with jam + lifesteal, not a third round of mark-extension", () => {
    const respec = applyMoveTree(rockThrow, [
      "tremor_call",
      "called_shot",
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

  it("Marked Advantage deepens Rolling Thunder's own pin (principle 13), and every statChangeOnHit setter is on one chain", () => {
    // v4 change of meaning, stated plainly: Marked Advantage used to grant a
    // `situationalBonus` on `rallyMarked`, which (a) shared no lever with its
    // own crosslink — the checker flagged it under principle 13 — and (b) was
    // one of three independent `situationalBonus` setters racing each other
    // through an overwrite field. It now escalates the exact thing Rolling
    // Thunder does. The `rallyMarked` payoff did not disappear: it moved down
    // one node, onto Converged Quarry, which is the bridge's notable and the
    // tree's only `situationalBonus`.
    const respec = applyMoveTree(rockThrow, ["pinning_impact", "tremor_call", "rolling_thunder", "marked_advantage"]);
    expect(respec.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -2, ticks: 32 });

    const situational = Object.values(rockThrow.tree!).filter((n) => n.delta.situationalBonus !== undefined);
    expect(situational.map((n) => n.id)).toEqual(["converged_quarry"]);
  });

  it("Hobbling Throw only needs one prior node, not a whole AND-set", () => {
    // An inner `prerequisitesAnyOf` array is an AND-set in this schema, so a
    // convergence node written as [[a, b]] would silently require both. Every
    // alternative here is a single node, reachable on its own.
    const viaOwnLane = applyMoveTree(rockThrow, ["pinning_impact", "loose_scree", "hobbling_throw"]);
    const viaBridge = applyMoveTree(rockThrow, [
      "pinning_impact",
      "tremor_call",
      "rolling_thunder",
      "marked_advantage",
      "converged_quarry",
      "hobbling_throw",
    ]);
    expect(viaOwnLane.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -2, ticks: 40 });
    expect(viaBridge.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -2, ticks: 40 });
  });

  it("Grinding Advance's bridge (Aggression<->Boldness) reaches a lane notable in BOTH branches", () => {
    // v4 relocated where every bridge lands: on one LANE NOTABLE per branch
    // it connects, one step short of that branch's fork (principles 11/12),
    // rather than on a pre-fork filler. The assertion's meaning is unchanged
    // — the bridge is a real alternate route into both branches.
    const bridge = ["pinning_impact", "bedrock_stance", "grinding_advance", "grinding_footing", "bedrock_momentum"];

    const viaAggr = applyMoveTree(rockThrow, [...bridge, "skyfall"]);
    expect(viaAggr.bonusVsType).toEqual({ type: "flying", multiplier: 1.5 });

    const viaBold = applyMoveTree(rockThrow, [...bridge, "unshakeable"]);
    expect(viaBold.tree!.unshakeable.grantsPassive).toEqual({ kind: "immovable", value: 1 });
  });

  it("Rolling Thunder's bridge (Sociability<->Aggression) reaches a lane notable in BOTH branches", () => {
    const bridge = ["pinning_impact", "tremor_call", "rolling_thunder", "marked_advantage", "converged_quarry"];

    const viaSoc = applyMoveTree(rockThrow, [...bridge, "carrying_rumble"]);
    expect(viaSoc.rallyCall).toEqual({ ticks: 34 });

    const viaAggr = applyMoveTree(rockThrow, [...bridge, "hobbling_throw"]);
    expect(viaAggr.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -2, ticks: 40 });
    // Converged Quarry keeps the rallyMarked payoff it has always had.
    expect(viaAggr.situationalBonus).toEqual({ condition: "rallyMarked", multiplier: 1.6 });
  });

  it("Warning Tremor's bridge (Boldness<->Sociability) reaches a lane notable in BOTH branches", () => {
    const bridge = ["bedrock_stance", "tremor_call", "warning_tremor", "warded_footing", "herds_bulwark"];

    const viaBold = applyMoveTree(rockThrow, [...bridge, "stone_underfoot"]);
    expect(viaBold.consumesOwnTerrain).toEqual({ terrain: "boulder", damageMultiplier: 4.5 });

    const viaSoc = applyMoveTree(rockThrow, [...bridge, "tremor_bond"]);
    expect(viaSoc.targetsAlly).toBe(true);
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
    // v4 relocated the Ambush Dive / Harrying Wings fork onto the tail of
    // Boldness's *other* lane ("Nowhere To Go"), behind Relentless Harrier —
    // so this is the new legal walk to the same keystone. The assertions
    // below are unchanged.
    const respec = applyMoveTree(peck, [
      "swooping_approach",
      "braced_stance",
      "relentless_harrier",
      "ambush_dive",
      "nowhere_to_run",
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

  // v4: Toxic Spread is now Aggression's lane-A notable (the "filth" lane)
  // rather than the branch's terminal keystone, so the route is shorter. The
  // assertion is unchanged — it still proves the node is reachable by a legal
  // walk and still turns `statusSpreads` on.
  it("Toxic Spread is reachable and sets statusSpreads", () => {
    const respec = applyMoveTree(scratch, [
      "envenomed",
      "venom_glands",
      "deepening_venom",
      "toxic_spread",
    ]);
    expect(respec.statusSpreads).toBe(true);
  });

  it("Everything Festers, the Aggression capstone, is reachable by a legal walk", () => {
    const respec = applyMoveTree(scratch, [
      "envenomed",
      "venom_glands",
      "deepening_venom",
      "toxic_spread",
      "torn_tendon",
      "no_cover_left",
      "claw_conditioning",
      "everything_festers",
    ]);
    // 0.15 (Envenomed) + 0.1 (Deepening Venom) + 0.35 (Everything Festers).
    expect(respec.statusChance).toBeCloseTo(0.6, 5);
    expect(respec.statusSeverity).toBe(3);
    expect(respec.terrainBurn).toBe(true);
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
      "pressurized_footing",
      "stuttering_jet",
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
      "current_precision",
      "drink_the_puddle",
      "undertow",
    ]);
    expect(undertow.statChangeOnHit).toEqual({ target: "defender", stat: "speed", stage: -1, ticks: 20 });

    const bubbleShield = applyMoveTree(waterGun, [
      "knockback_spray",
      "current_precision",
      "drink_the_puddle",
      "bubble_shield",
    ]);
    expect(bubbleShield.statChangeOnHit).toEqual({ target: "self", stat: "defense", stage: 1, ticks: 20 });
  });

  it("Drink the Puddle spends a water tile the user is standing on — the loop the base move's own terrainFill feeds", () => {
    const respec = applyMoveTree(waterGun, ["knockback_spray", "current_precision", "drink_the_puddle"]);
    expect(respec.consumesOwnTerrain).toEqual({ terrain: "water", damageMultiplier: 1.5 });
    // The base move is what puts the puddle there in the first place.
    expect(waterGun.terrainFill).toEqual({ terrain: "water" });
  });

  it("Sheeting Spray is the tree's only hitsArea node, and Piercing Jet its only shape setter", () => {
    const nodes = Object.values(waterGun.tree!);
    expect(nodes.filter((n) => n.delta.hitsArea !== undefined).map((n) => n.id)).toEqual(["sheeting_spray"]);
    expect(nodes.filter((n) => n.delta.shape !== undefined).map((n) => n.id)).toEqual(["piercing_jet"]);
    const respec = applyMoveTree(waterGun, [
      "knockback_spray",
      "current_precision",
      "drink_the_puddle",
      "bubble_shield",
      "tidal_guard",
      "braced_spray",
      "sheeting_spray",
    ]);
    expect(respec.hitsArea).toBe(true);
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

describe("Ember tree: v4 two-lane — the first fire, and it catches", () => {
  const ember = MOVES.ember;

  it("Ring of Fire finally covers tiles: shape is dead without hitsArea, and this branch is named after its footprint", () => {
    // The bug this fixes: `shape` is only ever read by `resolveShape` inside
    // `resolveAreaHit`, which only runs for a `hitsArea` move. The Boldness
    // opener set a ring and never set `hitsArea`, so it charged -10 power
    // and +1 cooldown for a footprint that did nothing — a pure-downside
    // node (principle 4) at the head of the branch named for it.
    const respec = applyMoveTree(ember, ["ring_of_fire"]);
    expect(respec.hitsArea).toBe(true);
    expect(respec.shape).toEqual({ kind: "ring", radius: 1 });
    expect(respec.power).toBe(ember.power - 10);
    expect(ember.hitsArea).toBeUndefined();
  });

  it("Fill the Circle is a filled burst, not a hollow ring the range-1 move could never fire into", () => {
    // `resolveShape` builds a ring as a hollow shell at exactly that
    // Chebyshev radius. Ember is aimed at range 1, so a radius-2 ring is a
    // footprint the move can never reach — the node would have been dead the
    // moment `hitsArea` made it real.
    const respec = applyMoveTree(ember, ["ring_of_fire", "banked_heat", "slow_burn", "wide_ring"]);
    expect(respec.shape).toEqual({ kind: "burst", radius: 1 });
    expect(respec.range).toEqual({ min: 0, max: 1 });

    // The radius is a deliberate balance number, not an implementation
    // detail, so the footprint is asserted in TILES rather than left implicit
    // in a constant. Burst radius is manhattan: r1 is 5 tiles, r2 is 13.
    // Direct call on the size: "13 is probably too much. Do the burst R1."
    expect(resolveShape(respec.shape, { x: 10, y: 10 }, "east")).toHaveLength(5);
  });

  it("the whole tree has exactly one shape lineage, and it is Boldness's", () => {
    const shapers = Object.values(ember.tree!).filter((n) => n.delta.shape !== undefined);
    expect(shapers.map((n) => n.id)).toEqual(["ring_of_fire", "wide_ring"]);
    // wide_ring descends from ring_of_fire, so the overwrite is escalation
    // rather than a co-takeable collision.
    expect(shapers.every((n) => n.leaning === "boldness")).toBe(true);
  });

  it("Take Up the Coals spends a fire tile the caster is standing in — the loop the opener's own terrainBurn feeds", () => {
    const respec = applyMoveTree(ember, [
      "ring_of_fire",
      "banked_heat",
      "slow_burn",
      "wide_ring",
      "never_ours",
      "take_up_the_coals",
    ]);
    expect(respec.consumesOwnTerrain).toEqual({ terrain: "fire", damageMultiplier: 1.6 });
    // `wider_burn` is what puts those tiles on the map in the first place.
    expect(ember.tree!.wider_burn.delta.terrainBurn).toBe(true);
  });

  it("Never Ours keeps the ring off the herd, and it lives under the node that grants hitsArea", () => {
    // `excludesAllies` is only consulted inside `resolveAreaHit`, so putting
    // it in Sociability would have been dead content for any build that
    // skipped the branch carrying `hitsArea`.
    const respec = applyMoveTree(ember, ["ring_of_fire", "banked_heat", "slow_burn", "wide_ring", "never_ours"]);
    expect(respec.excludesAllies).toBe(true);
    expect(respec.hitsArea).toBe(true);
    expect(ember.tree!.never_ours.leaning).toBe("boldness");
  });

  it("Searing Wall answers 'standing inside your own fire' with fireproof, not another stacking damageReduction", () => {
    expect(ember.tree!.searing_wall.grantsPassive).toEqual({ kind: "fireproof", value: 0.5 });
    const drNodes = Object.values(ember.tree!).filter(
      (n) => n.grantsPassive?.kind === "damageReduction" || (n.grantsPassives ?? []).some((g) => g.kind === "damageReduction")
    );
    expect(drNodes).toEqual([]);
  });

  it("Beat At the Flames is denial, not another damage number — jamCooldownTicks is additive", () => {
    const respec = applyMoveTree(ember, [
      "wider_burn",
      "kindling",
      "steady_flame",
      "hot_coals",
      "roaring_blaze",
      "spreading_blaze",
      "pyroclasm",
      "beat_at_the_flames",
    ]);
    expect(respec.jamCooldownTicks).toBe(2);
    expect(respec.statusSpreads).toBe(true);
  });

  it("Spit Coals is the tree's only hits setter, and the lane's answer to 'an ember is a spark'", () => {
    const hitsNodes = Object.values(ember.tree!).filter((n) => n.delta.hits !== undefined);
    expect(hitsNodes.map((n) => n.id)).toEqual(["hot_coals"]);
    const respec = applyMoveTree(ember, ["wider_burn", "kindling", "steady_flame", "hot_coals"]);
    expect(respec.hits).toEqual({ min: 1, max: 2 });
  });

  it("crit tops out at exactly rollCritical's clamp of 3 — no fourth crit node exists", () => {
    const critTotal = Object.values(ember.tree!).reduce((sum, n) => sum + (n.delta.critRateStage ?? 0), 0);
    expect(critTotal).toBe(3);
  });

  it("Inferno keeps only the half of itself that ever worked: reach, not a line it could not resolve", () => {
    const respec = applyMoveTree(ember, ["wider_burn", "in_through_the_coat", "fan_the_flames", "inferno"]);
    expect(respec.range).toEqual({ min: 0, max: 2 });
    expect(respec.shape).toEqual({ kind: "point" });
    expect(ember.tree!.inferno.excludes).toEqual(["wildfire_burst"]);
  });

  it("Nothing Left to Guard's bridge (Aggression<->Boldness) lands on one LANE NOTABLE in each branch it connects", () => {
    const bridge = ["wider_burn", "ring_of_fire", "smoldering_ring", "scorched_ground", "nothing_left_to_guard"];

    // Into Aggression: Fan the Flames without walking In Through the Coat.
    const viaAggr = applyMoveTree(ember, [...bridge, "fan_the_flames"]);
    expect(viaAggr.situationalBonus).toEqual({ condition: "targetBurning", multiplier: 2 });

    // Into Boldness: Fill the Circle without walking Banked Heat / Slow Burn.
    const viaBold = applyMoveTree(ember, [...bridge, "wide_ring"]);
    expect(viaBold.shape).toEqual({ kind: "burst", radius: 1 });
  });

  it("Into the Coals' bridge (Boldness<->Sociability) deepens its own crosslink's swap rather than grabbing a stat", () => {
    const bridge = ["ring_of_fire", "shared_warmth", "banked_embers", "change_places", "into_the_coals"];
    const respec = applyMoveTree(ember, bridge);
    expect(respec.positionSwap).toBe(true);
    expect(respec.positionSwapPull).toBe(3); // 1 (Change Places) + 2 (Into the Coals)

    // And it shortcuts into one lane notable of each branch it connects.
    expect(applyMoveTree(ember, [...bridge, "give_ground"]).forcedMovement).toEqual({
      mover: "defender",
      direction: "away",
      tiles: 1,
      timing: "onHit",
    });
    expect(applyMoveTree(ember, [...bridge, "beacon_fire"]).rallyCall).toEqual({ ticks: 20 });
  });

  it("White Heat's bridge (Sociability<->Aggression) escalates crit without adding a stage the engine would clamp away", () => {
    const bridge = ["shared_warmth", "wider_burn", "kindled_fury", "red_at_the_edges", "white_heat"];
    const respec = applyMoveTree(ember, bridge);
    expect(respec.critRateStage).toBe(2);
    expect(respec.critCooldownReset).toBe(true);

    expect(applyMoveTree(ember, [...bridge, "hot_coals"]).hits).toEqual({ min: 1, max: 2 });
    expect(applyMoveTree(ember, [...bridge, "kindled_spirits"]).allyEffect).toEqual({
      buff: { stat: "spAttack", stage: 1, ticks: 15 },
    });
  });
});

describe("additive delta fields: a build that pays twice gets twice", () => {
  // The bug these exist for, in the user's words: "If you got both, would it
  // just do nothing? [...] I like the idea of ADDING modifiers so you can
  // stack your build, not setting them." Two co-takeable nodes on one
  // OVERWRITE field used to resolve to whichever `applyMoveTree` reached
  // LAST — so the second point bought nothing, and which one won depended on
  // purchase order. Each case below asserts the stack AND asserts that
  // reversing the order changes nothing.
  const hydroPump = MOVES.hydro_pump;
  const solarBeam = MOVES.solar_beam;

  /** A legal chosen-node order reaching every one of `targets`, prerequisites first. */
  const buildFor = (tree: Record<string, MoveTreeNode>, targets: string[]) => {
    const into = new Set<string>();
    for (const t of targets) resolveChosenSetFor(tree, t, into);
    return [...into];
  };

  it("Hydro Pump's three independent '+1 Range' nodes now add up to +3, not +1", () => {
    // Bought one at a time they were each `range: { max: 5 }` on a base of 4,
    // so three points bought one tile between them.
    expect(hydroPump.range).toEqual({ min: 0, max: 4 });
    expect(applyMoveTree(hydroPump, buildFor(hydroPump.tree!, ["widening_main"])).range).toEqual({ min: 0, max: 5 });

    const targets = ["widening_main", "channel_grip", "pod_reach"];
    expect(applyMoveTree(hydroPump, buildFor(hydroPump.tree!, targets)).range).toEqual({ min: 0, max: 7 });
    // A different — still legal — purchase order resolves identically. That
    // is the property the overwrite form did not have.
    expect(applyMoveTree(hydroPump, buildFor(hydroPump.tree!, [...targets].reverse())).range).toEqual({ min: 0, max: 7 });
  });

  it("Solar Beam's flanking and elevation bonuses both survive a build that takes both", () => {
    const targets = ["withering_glare", "guardians_ground"];
    const conditionsOf = (ids: string[]) =>
      resolveSituationalBonuses(applyMoveTree(solarBeam, ids)).map((b) => `${b.condition}:${b.multiplier}`).sort();

    const conditions = conditionsOf(buildFor(solarBeam.tree!, targets));
    expect(conditions).toContain("flanking:1.4");
    expect(conditions).toContain("elevation:1.3");
    // Reversed purchase order, same resolved set — not merely the same count.
    expect(conditionsOf(buildFor(solarBeam.tree!, [...targets].reverse()))).toEqual(conditions);
  });

  it("a same-condition ladder escalates to its strongest step, it does not multiply", () => {
    // flare_wider (1.3) -> sunspot (1.6) on one chain. Multiplying a ladder
    // would hand out 2.08x where the designer wrote 1.6x, and every ladder in
    // this roster restates a full value rather than an increment.
    const respec = applyMoveTree(solarBeam, [...resolveChosenSetFor(solarBeam.tree!, "sunspot")]);
    const lowHp = resolveSituationalBonuses(respec).filter((b) => b.condition === "targetLowHp");
    expect(lowHp).toEqual([{ condition: "targetLowHp", multiplier: 1.6 }]);
  });

  it("resolveStatChangesOnHit composes different stats and escalates the same one", () => {
    const base: MoveSpec = { ...MOVES.tackle, statChangeOnHit: undefined, statChangesOnHit: undefined };
    const compose = {
      ...base,
      statChangesOnHit: [
        { target: "self" as const, stat: "defense" as const, stage: 1, ticks: 50 },
        { target: "defender" as const, stat: "speed" as const, stage: -1, ticks: 50 },
      ],
    };
    expect(resolveStatChangesOnHit(compose)).toHaveLength(2);

    const ladder = {
      ...base,
      statChangesOnHit: [
        { target: "self" as const, stat: "defense" as const, stage: 1, ticks: 50 },
        { target: "self" as const, stat: "defense" as const, stage: 2, ticks: 80 },
      ],
    };
    expect(resolveStatChangesOnHit(ladder)).toEqual([{ target: "self", stat: "defense", stage: 2, ticks: 80 }]);
  });

  it("resolveAllyEffect takes the strongest heal and every distinct buff", () => {
    const base: MoveSpec = { ...MOVES.tackle, allyEffect: undefined };
    const merged = resolveAllyEffect({
      ...base,
      allyEffects: [
        { healFraction: 0.08 },
        { healFraction: 0.2 },
        { buff: { stat: "speed", stage: 1, ticks: 40 } },
        { buff: { stat: "defense", stage: 2, ticks: 40 } },
      ],
    })!;
    expect(merged.healFraction).toBe(0.2);
    expect(merged.buffs.map((b) => b.stat).sort()).toEqual(["defense", "speed"]);
    // A move with no ally payload at all still reads as absent — that is what
    // the `targetsAlly` call sites gate on.
    expect(resolveAllyEffect(base)).toBeUndefined();
  });

  it("areaBonus sums and turns on hitsArea, whichever order form and size are bought in", () => {
    const move: MoveSpec = {
      ...MOVES.tackle,
      shape: { kind: "point" },
      hitsArea: undefined,
      tree: {
        form: { id: "form", name: "Form", cost: 1, delta: { shape: { kind: "burst", radius: 1 } } },
        wider: { id: "wider", name: "Wider", cost: 1, delta: { areaBonus: 1 } },
        widest: { id: "widest", name: "Widest", cost: 1, delta: { areaBonus: 1 } },
      },
    };
    // Form alone is not an area move — `areaBonus` is what turns that on.
    expect(applyMoveTree(move, ["form"]).hitsArea).toBeUndefined();
    const grown = applyMoveTree(move, ["form", "wider", "widest"]);
    expect(grown.shape).toEqual({ kind: "burst", radius: 3 });
    expect(grown.hitsArea).toBe(true);
    // Size bought BEFORE the form: this was genuinely broken in the first cut
    // (the bonus was applied at the node that carried it, so a later `shape`
    // overwrite threw it away) and is the regression this line guards.
    expect(applyMoveTree(move, ["widest", "wider", "form"]).shape).toEqual({ kind: "burst", radius: 3 });
  });

  it("hitsBonus and rallyCallTicks sum instead of racing", () => {
    const move: MoveSpec = {
      ...MOVES.tackle,
      hits: undefined,
      rallyCall: undefined,
      tree: {
        a: { id: "a", name: "A", cost: 1, delta: { hitsBonus: 1, rallyCallTicks: 20 } },
        b: { id: "b", name: "B", cost: 1, delta: { hitsBonus: 2, rallyCallTicks: 30 } },
      },
    };
    // No base `hits` counts as one strike, so +1 makes it a 2-hit move.
    expect(applyMoveTree(move, ["a"]).hits).toEqual({ min: 2, max: 2 });
    expect(applyMoveTree(move, ["a", "b"]).hits).toEqual({ min: 4, max: 4 });
    expect(applyMoveTree(move, ["b", "a"]).hits).toEqual({ min: 4, max: 4 });
    expect(applyMoveTree(move, ["a", "b"]).rallyCall).toEqual({ ticks: 50 });
    expect(applyMoveTree(move, ["b", "a"]).rallyCall).toEqual({ ticks: 50 });
  });
});

describe("Wing Attack tree: v4 two-lane — the wing, and everything it moves", () => {
  const wingAttack = MOVES.wing_attack;
  const tilesOf = (shape: Parameters<typeof resolveShape>[0]) => resolveShape(shape, { x: 10, y: 10 }, "E").length;

  it("the base move really is an area move, so `shape` on this tree is live content and not another dead cone", () => {
    // The lesson ember and rock_throw both paid for: `shape` is only ever
    // read by `resolveShape` inside `resolveAreaHit`, which `resolveHit`
    // only calls when `hitsArea` is true. Wing Attack ships with it on, so
    // its one shape node genuinely changes which tiles get hit.
    expect(wingAttack.hitsArea).toBe(true);
    expect(wingAttack.shape).toEqual({ kind: "cone", length: 2, width: 2 });
  });

  it("The Whole Wingspan is asserted in TILES, and it is a trade, not a strict upgrade", () => {
    // Counted, not inferred from the radius/length constants: cone(2,2) is a
    // 3-then-5 fan reaching two tiles; cone(3,2) is 1-then-3-then-5 reaching
    // three. The span narrows at the shoulder and opens at the tip.
    expect(tilesOf(wingAttack.shape)).toBe(8);

    const capstone = wingAttack.tree!.full_wingspan;
    expect(tilesOf(capstone.delta.shape!)).toBe(9);
    const perDepth = (shape: Parameters<typeof resolveShape>[0]) => {
      const counts: Record<number, number> = {};
      for (const t of resolveShape(shape, { x: 10, y: 10 }, "E")) counts[t.x - 10] = (counts[t.x - 10] ?? 0) + 1;
      return counts;
    };
    expect(perDepth(wingAttack.shape)).toEqual({ 1: 3, 2: 5 });
    expect(perDepth(capstone.delta.shape!)).toEqual({ 1: 1, 2: 3, 3: 5 });

    // `range.max` moves with the footprint. A cast range longer than the
    // shape is how rock_throw's cone managed to whiff on a legal target.
    expect(capstone.delta.range).toEqual({ max: 3 });
  });

  it("is the tree's only `shape` setter, and its only `situationalBonus` — both are OVERWRITE fields", () => {
    const nodes = Object.values(wingAttack.tree!);
    expect(nodes.filter((n) => n.delta.shape !== undefined).map((n) => n.id)).toEqual(["full_wingspan"]);
    expect(nodes.filter((n) => n.delta.situationalBonus !== undefined).map((n) => n.id)).toEqual(["storm_wings"]);
  });

  it("`forcedMovement` is one monotone scatter ladder — the shipped tree had five setters racing each other", () => {
    const setters = Object.values(wingAttack.tree!).filter((n) => n.delta.forcedMovement !== undefined);
    expect(setters.map((n) => n.id)).toEqual(["driven_off", "scattering_strike", "harder_scatter"]);
    // Every one of them shoves the DEFENDER away — the deliberate inversion
    // of peck's `Nowhere to Run`, which hooks the defender one tile closer.
    for (const n of setters) {
      expect(n.delta.forcedMovement!.mover).toBe("defender");
      expect(n.delta.forcedMovement!.direction).toBe("away");
    }
    expect(setters.map((n) => n.delta.forcedMovement!.tiles).sort()).toEqual([1, 2, 3]);
    expect(MOVES.peck.tree!.nowhere_to_run.delta.forcedMovement).toEqual({
      mover: "defender",
      direction: "closer",
      tiles: 1,
      timing: "onHit",
    });
  });

  it("Scoured Bare leaves real terrain under wherever the gust put them — the only non-water terrainFill in the roster", () => {
    const capstone = wingAttack.tree!.final_stoop;
    expect(capstone.delta.terrainFill).toEqual({ terrain: "sand" });
    // Every other terrainFill in the roster wets the ground; this one takes
    // it away, and sand is a real 0.75 movement-speed tile (support.ts's
    // `terrainSpeedMultiplier`), which is what makes a 3-tile shove
    // survivable for the attacker.
    const otherFills = Object.values(MOVES)
      .filter((m) => m.tree && m.id !== "wing_attack")
      .flatMap((m) => Object.values(m.tree!))
      .filter((n) => n.delta.terrainFill)
      .map((n) => n.delta.terrainFill!.terrain);
    expect(otherFills.length).toBeGreaterThan(0);
    expect(otherFills).not.toContain("sand");
  });

  it("Flock's Eye answers the move's own flaw: an eight-tile cone that does not know your flock from theirs", () => {
    const built = applyMoveTree(wingAttack, [
      "warning_cry",
      "quicker_call",
      "open_ranks",
      "rousing_call",
      "lifts_the_flock",
      "steadfast_call",
      "flocks_eye",
    ]);
    expect(built.excludesAllies).toBe(true);
    expect(built.rallyCall).toEqual({ ticks: 40 });
    expect(built.allyEffectOnAttack).toBe(true);
    // The base move has no such mercy — that is the flaw the branch buys off.
    expect(wingAttack.excludesAllies).toBeUndefined();
  });

  it("`weightScaling` is one ladder across the Riding-the-Gust bridge into Aggression's deep notable", () => {
    const setters = Object.values(wingAttack.tree!).filter((n) => n.delta.weightScaling !== undefined);
    expect(setters.map((n) => n.id)).toEqual(["everything_behind_it", "riding_the_gust", "gathering_updraft", "stooping_dive"]);
    expect(setters.map((n) => n.delta.weightScaling!.factor).sort()).toEqual([0.05, 0.08, 0.12, 0.15]);
    // Principle 4: the deep notable's cost lives in the same node as its benefit.
    expect(wingAttack.tree!.everything_behind_it.delta.lockTicks).toBe(1);
  });

  it("Covering Wing shares its crosslink's own lever (principle 13) and the total pull is unchanged from v3", () => {
    const bridge = ["evasive_flight", "warning_cry", "screening_dive", "covering_wing", "wingmate_shield"];
    const built = applyMoveTree(wingAttack, bridge);
    expect(built.positionSwap).toBe(true);
    // 1 + 1 + 1, additive in `applyMoveTree` — v3 granted 2 from a single
    // node whose filler shared nothing with its own crosslink.
    expect(built.positionSwapPull).toBe(3);
    expect(wingAttack.tree!.screening_dive.delta.positionSwapPull).toBe(1);
    expect(wingAttack.tree!.covering_wing.delta.positionSwapPull).toBe(1);
  });

  it("accuracy surplus is spendable rather than dead, because the storm penalty is what the Boldness lane is for", () => {
    // `rollAccuracy` (combat.ts) multiplies by `stormAccuracyMultiplier`'s
    // 0.6 inside a storm cell, so the break-even before a point of accuracy
    // buys literally nothing is 100 / 0.6 = 167. The tree stops short of it.
    const everything = Object.values(wingAttack.tree!).reduce((sum, n) => sum + (n.delta.accuracy ?? 0), 0);
    expect(wingAttack.accuracy).toBe(100);
    expect(wingAttack.accuracy + everything).toBeLessThan(Math.ceil(100 / 0.6));
  });

  it("crit stage stays inside `rollCritical`'s clamp of 3", () => {
    const total = Object.values(wingAttack.tree!).reduce((sum, n) => sum + (n.delta.critRateStage ?? 0), 0);
    expect(total).toBeLessThanOrEqual(3);
  });

  it("spends no more cooldown than the 3x tempo cap allows on a base of 4", () => {
    const cut = Object.values(wingAttack.tree!).reduce((sum, n) => sum + Math.max(0, -(n.delta.cooldownTicks ?? 0)), 0);
    const floor = Math.ceil((wingAttack.cooldownTicks + 1) / 3) - 1;
    expect(cut).toBeLessThanOrEqual(wingAttack.cooldownTicks - floor);
    expect(cut).toBe(3); // unchanged from the shipped tree — no headroom was spent
  });
});

// ---------------------------------------------------------------------------
// Round six: the five trees that shipped for moves that previously had none.
// ---------------------------------------------------------------------------

/**
 * A `utilityMove` NEVER reaches the hostile hit pipeline — `pickBestMove`
 * (combat.ts) filters it out of hostile selection, so `resolveHit` is never
 * called with it and nothing downstream of `resolveHit` can ever fire. Every
 * one of these delta fields is read ONLY from there, so a status-move tree
 * node that sets one is dead content, which this project treats as a bug.
 *
 * This is the rule the round-six drafts broke hardest: they carried
 * `shape`/`hitsArea`, `defensePenetration`, `statusChance`, `jamCooldownTicks`,
 * `situationalBonus` and `forcedMovement` nodes on Harden, Growth and Agility.
 */
const DEAD_ON_A_UTILITY_MOVE = [
  "power", "accuracy", "hits", "shape", "hitsArea", "range", "excludesAllies",
  "defensePenetration", "critRateStage", "critCooldownReset", "lifestealFraction",
  "recoilFraction", "jamCooldownTicks", "situationalBonus", "selfStateBonus",
  "statusChance", "statusSeverity", "statusSpreads", "forcedMovement",
  "positionSwap", "positionSwapPull", "terrainBurn", "terrainFill",
  "consumesOwnTerrain", "chargeAttack", "weightScaling", "bonusVsType",
  "resistanceBreaker", "selfCostPerUse", "rallyCall", "allyEffectOnAttack",
  "gatherBurst",
] as const;

/**
 * The effect fields `maybeUseUtilityMoveInCombat` (utilityMoves.ts) will
 * spend a fight action on. It decides by effect field, not by move id, so a
 * status tree whose branch reaches none of them can never fire in a fight —
 * which is the single most important thing to check about one.
 */
const COMBAT_USABLE_FIELDS = [
  "selfHeal",
  "statChangeOnHit",
  // The plural belongs here for the same reason the singular does, and
  // leaving it out was a real gap rather than a policy:
  // `combatUtilityValue` reads `resolveStatChangesOnHit(move)`, which folds
  // BOTH forms. The plural is the one that does not silently race a
  // co-takeable setter, so it is what a careful tree reaches for — and the
  // singular-only list called those branches dead.
  "statChangesOnHit",
  "statusImmunityAura",
  // Widened from three families to six. `maybeUseUtilityMoveInCombat` used
  // to apply only the first three while the out-of-combat path applied
  // several more, which meant everything a support move exists to do — patch
  // up a herd-mate, take something off the thing attacking you, change the
  // weather — went dead the instant a fight started. That was the real
  // constraint on status-move trees, and it was an engine gap, not a design
  // one.
  "allyEffect",
  "drainNeeds",
  "spawnsRain",
] as const;

/**
 * The APPENDING form of a self stat change is the same combat-usable lever as
 * the singular one — `resolveStatChangesOnHit` (engine/moves.ts) folds both
 * and `maybeUseUtilityMoveInCombat` reads only that folded result. Keying the
 * check on the singular name alone reported a branch built entirely out of
 * `statChangesOnHit` as unable to fire in a fight, which is the opposite of
 * true; safeguard and withdraw use the plural form throughout precisely
 * because the singular is an overwrite field.
 */
const combatUsableFields = (delta: Record<string, unknown>): string[] =>
  [
    ...COMBAT_USABLE_FIELDS.filter((f) => delta[f] !== undefined),
    ...(Array.isArray(delta.statChangesOnHit) && delta.statChangesOnHit.length ? ["statChangesOnHit"] : []),
  ];

/** Every self stat change a node declares, in either form. */
const statChangesOf = (node: MoveTreeNode) => [
  ...(node.delta.statChangeOnHit ? [node.delta.statChangeOnHit] : []),
  ...(node.delta.statChangesOnHit ?? []),
];

const passiveTotal = (move: MoveSpec & { tree: Record<string, MoveTreeNode> }, kind: string) =>
  Object.values(move.tree)
    .flatMap((n) => [...(n.grantsPassive ? [n.grantsPassive] : []), ...(n.grantsPassives ?? [])])
    .filter((g) => g.kind === kind)
    .reduce((sum, g) => sum + g.value, 0);

describe("the status trees only pull levers a utilityMove can actually reach", () => {
  for (const moveId of ["harden", "growth", "agility", "roost", "defense_curl", "safeguard", "withdraw"]) {
    const move = MOVES[moveId] as MoveSpec & { tree: Record<string, MoveTreeNode> };

    it(`${moveId} is flagged utilityMove, so these are the right rules for it`, () => {
      expect(move.utilityMove).toBe(true);
      expect(Object.keys(move.tree)).toHaveLength(45);
    });

    it(`${moveId} has no node setting a field only the hostile hit pipeline reads`, () => {
      const offenders: string[] = [];
      for (const node of Object.values(move.tree)) {
        for (const field of DEAD_ON_A_UTILITY_MOVE) {
          if ((node.delta as Record<string, unknown>)[field] !== undefined) offenders.push(`${node.id}.${field}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it(`every ${moveId} stat change targets self and is positive — the defender side would be dead`, () => {
      for (const node of Object.values(move.tree)) {
        for (const change of statChangesOf(node)) {
          expect(change.target).toBe("self");
          expect(change.stage).toBeGreaterThan(0);
        }
      }
    });

    it(`every ${moveId} branch reaches something maybeUseUtilityMoveInCombat would spend an action on`, () => {
      for (const branch of ["aggression", "boldness", "sociability"] as const) {
        const inBranch = Object.values(move.tree).filter((n) => n.leaning === branch);
        expect(inBranch.length).toBeGreaterThan(0);
        const reaches = inBranch.some((n) => combatUsableFields(n.delta as Record<string, unknown>).length > 0);
        // Harden's Aggression used to be carved out here as "the one
        // deliberate exception — passives only, can never be spent as a fight
        // action." That exception was STALE, and it was passing for the wrong
        // reason: the check only looked at the singular `statChangeOnHit`,
        // while Honed Carapace had already migrated to the appending
        // `statChangesOnHit` form. `resolveStatChangesOnHit` folds both, so
        // that branch has been fight-usable (a +2 self Defense) ever since.
        // Two separate rounds found this independently. No branch in any
        // status tree is exempt now.
        expect(reaches).toBe(true);
        expect(inBranch.filter((n) => n.grantsPassive || n.grantsPassives).length).toBeGreaterThan(2);
      }
    });
  }
});

describe("Harden tree: a body clenching until it is a different material", () => {
  const harden = MOVES.harden as MoveSpec & { tree: Record<string, MoveTreeNode> };

  it("Chrysalis is voluntary helplessness: a real action lock bought for a real heal", () => {
    const respec = applyMoveTree(harden, [...resolveChosenSetFor(harden.tree, "chrysalis")]);
    // `lockTicks` is applied by `useMove`, which the utility path DOES call —
    // so this is a genuine cost, not a decorative one.
    expect(respec.lockTicks).toBe(6);
    expect(respec.selfHeal).toEqual({ fraction: 0.15 });
    expect(harden.lockTicks ?? 0).toBe(0); // the base move locks nobody
    expect(harden.selfHeal).toBeUndefined(); // and cannot heal at all
  });

  it("The Long Sleep escalates Chrysalis instead of racing it — Chrysalis is its ancestor", () => {
    // Both selfHeal setters lie on one ancestry chain (Chrysalis -> Dense Core
    // -> Unbudgeable -> Slow to Shift -> The Long Sleep), so a build holding
    // both is a deliberate ladder, not an order-dependent race.
    const path = [
      ...resolveChosenSetFor(harden.tree, "chrysalis"),
      ...resolveChosenSetFor(harden.tree, "the_long_sleep"),
    ];
    expect(path).toContain("chrysalis");
    const respec = applyMoveTree(harden, [...new Set(path)]);
    expect(respec.selfHeal).toEqual({ fraction: 0.3 });
    expect(respec.lockTicks).toBe(14); // 6 (Chrysalis) + 8 — lockTicks is additive
    expect(Object.values(harden.tree).filter((n) => n.delta.selfHeal).map((n) => n.id).sort())
      .toEqual(["chrysalis", "the_long_sleep"]);
  });

  it("the Defense ladder climbs 1 -> 2 -> 3 -> 4 on one chain, so no two setters race", () => {
    const stageAt = (id: string) =>
      applyMoveTree(harden, [...resolveChosenSetFor(harden.tree, id)]).statChangeOnHit?.stage;
    expect(harden.statChangeOnHit?.stage).toBe(1);
    expect(stageAt("settling_weight")).toBe(2);
    expect(stageAt("hardening_habit")).toBe(3);
    expect(stageAt("unbudgeable")).toBe(4);
    expect(Object.values(harden.tree).filter((n) => n.delta.statChangeOnHit).map((n) => n.id).sort())
      .toEqual(["hardening_habit", "settling_weight", "unbudgeable"]);
  });

  it("the shell that breaks feeds the ground it breaks on — a real, map-visible fertilityBoost", () => {
    const respec = applyMoveTree(harden, [...resolveChosenSetFor(harden.tree, "brittle_edge")]);
    expect(respec.fertilityBoost).toEqual({ amount: 0.6, radius: 2 });
    expect(Object.values(harden.tree).filter((n) => n.delta.fertilityBoost).map((n) => n.id).sort())
      .toEqual(["brittle_edge", "shell_grit", "splinter"]);
  });

  it("Let It Pass is Sociability's fight-usable node and the capstone widens it, on one chain", () => {
    expect(applyMoveTree(harden, [...resolveChosenSetFor(harden.tree, "let_it_pass")]).statusImmunityAura)
      .toEqual({ ticks: 60, radius: 3 });
    expect(applyMoveTree(harden, [...resolveChosenSetFor(harden.tree, "the_forest_floor")]).statusImmunityAura)
      .toEqual({ ticks: 140, radius: 5 });
  });

  it("stays inside its per-move passive budgets, including the +6 stat-stage clamp", () => {
    expect(passiveTotal(harden, "thorns")).toBeLessThanOrEqual(0.5);
    expect(passiveTotal(harden, "damageReduction")).toBeLessThanOrEqual(0.2);
    // Stat stages clamp at +6 (`statStageMultiplier`, combat.ts) and the tree's
    // own statChangeOnHit already reaches +4, so a bigger defenseBoost pile
    // would be points spent on nothing.
    expect(passiveTotal(harden, "defenseBoost")).toBeLessThanOrEqual(4);
  });
});

describe("Safeguard tree: one animal stays awake and draws a line around the rest", () => {
  const safeguard = MOVES.safeguard as MoveSpec & { tree: Record<string, MoveTreeNode> };
  const auraAt = (id: string) =>
    applyMoveTree(safeguard, [...resolveChosenSetFor(safeguard.tree, id)]).statusImmunityAura;

  it("the ward itself is one ladder on one chain, so no two setters race", () => {
    // `statusImmunityAura` is an OVERWRITE field: two co-takeable setters
    // resolve to whichever `applyMoveTree` reaches last. Every setter here is
    // an ancestor or descendant of every other, so a build holding two is a
    // deliberate escalation.
    expect(safeguard.statusImmunityAura).toEqual({ ticks: 60, radius: 4 });
    expect(auraAt("drawn_ring")).toEqual({ ticks: 90, radius: 5 });
    expect(auraAt("the_line")).toEqual({ ticks: 120, radius: 6 });
    expect(auraAt("nothing_crosses")).toEqual({ ticks: 220, radius: 8 });
    expect(Object.values(safeguard.tree).filter((n) => n.delta.statusImmunityAura).map((n) => n.id).sort())
      .toEqual(["drawn_ring", "held_line", "nothing_crosses", "the_line"]);
  });

  it("Aggression's drain is a real, visible hunger transfer and it escalates on one chain", () => {
    expect(applyMoveTree(safeguard, [...resolveChosenSetFor(safeguard.tree, "no_grazing_here")]).drainNeeds)
      .toEqual({ need: "hunger", amount: 0.06, radius: 4 });
    expect(applyMoveTree(safeguard, [...resolveChosenSetFor(safeguard.tree, "not_worth_the_walk")]).drainNeeds)
      .toEqual({ need: "hunger", amount: 0.22, radius: 6 });
    expect(safeguard.drainNeeds).toBeUndefined(); // the base move steals nothing
  });

  it("the warden's own payoff is a heal, which is what makes Boldness spendable in a fight", () => {
    // `maybeUseUtilityMoveInCombat` spends an action on a `selfHeal` under 60%
    // HP — without one, a whole branch of a status tree can never fire mid-fight.
    expect(applyMoveTree(safeguard, [...resolveChosenSetFor(safeguard.tree, "second_wind")]).selfHeal)
      .toEqual({ fraction: 0.08 });
    expect(applyMoveTree(safeguard, [...resolveChosenSetFor(safeguard.tree, "the_whole_night")]).selfHeal)
      .toEqual({ fraction: 0.24 });
  });

  it("stays inside its per-move passive budgets", () => {
    expect(passiveTotal(safeguard, "thorns")).toBeLessThanOrEqual(0.5);
    expect(passiveTotal(safeguard, "damageReduction")).toBeLessThanOrEqual(0.2);
    // One healing budget across all three kinds, the way status.ts spends it.
    const heal =
      passiveTotal(safeguard, "regen") + passiveTotal(safeguard, "healAura") + passiveTotal(safeguard, "regenFlat") / 43;
    expect(heal).toBeLessThanOrEqual(0.1);
  });
});

describe("Withdraw tree: a shell is a room you go into, not armour you wear", () => {
  const withdraw = MOVES.withdraw as MoveSpec & { tree: Record<string, MoveTreeNode> };
  const stageAt = (id: string, stat: string) => {
    const built = applyMoveTree(withdraw, [...resolveChosenSetFor(withdraw.tree, id)]);
    return resolveStatChangesOnHit(built).find((c) => c.target === "self" && c.stat === stat)?.stage;
  };

  it("is not Harden: no lockTicks and no thorns anywhere in the tree", () => {
    // The load-bearing difference. Harden's answer to danger is to stop
    // acting — `lockTicks` on four of its nodes — and its shell is a surface
    // that hurts to touch (`thorns` on six). Withdraw pays neither: the shell
    // is portable, so it costs no tempo, and it has an inside rather than an
    // edge. If either of these ever becomes non-zero the two trees have
    // converged and one of them is redundant.
    const lock = Object.values(withdraw.tree).filter((n) => n.delta.lockTicks !== undefined);
    expect(lock.map((n) => n.id)).toEqual([]);
    expect(passiveTotal(withdraw, "thorns")).toBe(0);
    // The control: Harden really does spend both, so this is a difference
    // between the trees rather than a lever nothing in the roster uses.
    const harden = MOVES.harden as MoveSpec & { tree: Record<string, MoveTreeNode> };
    expect(Object.values(harden.tree).filter((n) => n.delta.lockTicks !== undefined).length).toBeGreaterThan(0);
    expect(passiveTotal(harden, "thorns")).toBeGreaterThan(0);
  });

  it("buys Speed while defended — the tempo Harden gives up — without out-running Agility", () => {
    expect(stageAt("tucked_and_rolling", "speed")).toBe(2);
    expect(stageAt("the_shell_gets_there_first", "speed")).toBe(4);
    const agility = MOVES.agility as MoveSpec & { tree: Record<string, MoveTreeNode> };
    const agilityMax = Math.max(
      ...Object.values(agility.tree).flatMap((n) =>
        [...(n.delta.statChangeOnHit ? [n.delta.statChangeOnHit] : []), ...(n.delta.statChangesOnHit ?? [])]
          .filter((c) => c.stat === "speed")
          .map((c) => c.stage)
      )
    );
    expect(agilityMax).toBeGreaterThan(4); // the roster's actual speed move still wins
  });

  it("the Defense ladder climbs 1 -> 2 -> 3 -> 4 and stops at the clamp", () => {
    expect(withdraw.statChangeOnHit?.stage).toBe(1);
    expect(stageAt("pulled_in", "defense")).toBe(2);
    expect(stageAt("nobody_home", "defense")).toBe(3);
    expect(stageAt("an_empty_shell", "defense")).toBe(4);
    // Stat stages clamp at +6 (`statStageMultiplier`), and `defenseBoost` is a
    // permanent stage on top, so the passive pile has to stay small too.
    expect(passiveTotal(withdraw, "defenseBoost")).toBeLessThanOrEqual(4);
  });

  it("stays inside its per-move passive budgets", () => {
    expect(passiveTotal(withdraw, "damageReduction")).toBeLessThanOrEqual(0.2);
    const heal =
      passiveTotal(withdraw, "regen") + passiveTotal(withdraw, "healAura") + passiveTotal(withdraw, "regenFlat") / 43;
    expect(heal).toBeLessThanOrEqual(0.1);
  });
});

describe("Growth tree: the only move in the roster whose target is the ground", () => {
  const growth = MOVES.growth as MoveSpec & { tree: Record<string, MoveTreeNode> };

  it("has no damage branch at all — a first for this roster", () => {
    for (const node of Object.values(growth.tree)) {
      expect(node.delta.power).toBeUndefined();
      expect(node.delta.hits).toBeUndefined();
    }
  });

  it("every fertilityBoost setter is on ONE ancestry chain — the draft had 14 racing each other", () => {
    const setters = Object.values(growth.tree).filter((n) => n.delta.fertilityBoost).map((n) => n.id);
    expect(setters.length).toBeGreaterThan(1);
    // The deepest setter's own resolved path must contain every other one.
    const deepest = [...resolveChosenSetFor(growth.tree, "it_takes")];
    for (const id of setters) expect(deepest).toContain(id);
  });

  it("It Takes floods a 5x5 of ground and pays for it with a real action lock", () => {
    const respec = applyMoveTree(growth, [...resolveChosenSetFor(growth.tree, "it_takes")]);
    expect(respec.fertilityBoost).toEqual({ amount: 1.2, radius: 2 });
    expect(respec.lockTicks).toBe(4);
    expect(growth.fertilityBoost).toEqual({ amount: 0.3, radius: 0 }); // base: own tile only
  });

  it("uses drainNeeds as a weapon — the bramble takes the food out of what stands in it", () => {
    const respec = applyMoveTree(growth, [...resolveChosenSetFor(growth.tree, "thicket")]);
    expect(respec.drainNeeds).toEqual({ need: "hunger", amount: 0.05, radius: 3 });
    // `drainNeeds` only ever reads hunger/thirst; "energy" would be inert.
    for (const node of Object.values(growth.tree)) {
      if (node.delta.drainNeeds) expect(["hunger", "thirst"]).toContain(node.delta.drainNeeds.need);
    }
  });

  it("The Orchard calls real weather down rather than inventing a terrain primitive", () => {
    const respec = applyMoveTree(growth, [...resolveChosenSetFor(growth.tree, "the_orchard")]);
    expect(respec.spawnsRain).toBe(true);
    expect(respec.lockTicks).toBe(10); // 4 (It Takes) + 6 — additive
  });

  it("Homestead and Nobody Leaves land as a population curve, via the shipped matingRadiusBoost", () => {
    expect(applyMoveTree(growth, [...resolveChosenSetFor(growth.tree, "homestead")]).matingRadiusBoost)
      .toEqual({ multiplier: 2.2, ticks: 300 });
    expect(applyMoveTree(growth, [...resolveChosenSetFor(growth.tree, "nobody_leaves")]).matingRadiusBoost)
      .toEqual({ multiplier: 3, ticks: 400 });
  });
});

describe("Agility tree: the difference between getting somewhere and dying partway", () => {
  const agility = MOVES.agility as MoveSpec & { tree: Record<string, MoveTreeNode> };

  it("the Speed ladder climbs 2 -> 3 -> 4 -> 5 -> 6 on one chain and really feeds actionSpeedOf", () => {
    const stageAt = (id: string) =>
      applyMoveTree(agility, [...resolveChosenSetFor(agility.tree, id)]).statChangeOnHit?.stage;
    expect(agility.statChangeOnHit?.stage).toBe(2);
    expect(stageAt("first_move")).toBe(3);
    expect(stageAt("wound_up")).toBe(4);
    expect(stageAt("blur")).toBe(5);
    expect(stageAt("faster_than_thought")).toBe(6); // the engine clamps stages at 6
  });

  it("Wound Up pairs its extra stage with a real wind-up cost in the same node (principle 4)", () => {
    const node = agility.tree.wound_up;
    expect(node.delta.lockTicks).toBe(1);
    expect(node.delta.statChangeOnHit?.stage).toBe(4);
  });

  it("the bad-ground fantasy is carried by shipped `fireproof`, topping out at exactly 1.0", () => {
    expect(passiveTotal(agility, "fireproof")).toBeCloseTo(1, 6);
  });

  it("Moving as One grants the shipped herd speed aura, not an invented one", () => {
    expect(agility.tree.moving_as_one.grantsPassive).toEqual({ kind: "aquaticHaste", value: 0.25 });
    const respec = applyMoveTree(agility, [...resolveChosenSetFor(agility.tree, "moving_as_one")]);
    // resolved through `applySupportMove`, which does NOT exclude utility moves
    expect(respec.targetsAlly).toBe(true);
    expect(respec.allyEffect).toEqual({ buff: { stat: "speed", stage: 3, ticks: 90 } });
  });

  it("stays inside the 3x tempo cap: base 50 floors at 16, so at most -34", () => {
    const cut = Object.values(agility.tree)
      .map((n) => Math.max(0, -(n.delta.cooldownTicks ?? 0)))
      .reduce((a, b) => a + b, 0);
    expect(cut).toBe(34);
    expect(agility.cooldownTicks - cut).toBe(16);
  });
});

describe("Twineedle tree: a poison delivery system with wings", () => {
  const twineedle = MOVES.twineedle as MoveSpec & { tree: Record<string, MoveTreeNode> };

  it("Nothing Forgets sets hitsArea alongside its shape — shape alone is dead content", () => {
    const respec = applyMoveTree(twineedle, [...resolveChosenSetFor(twineedle.tree, "nothing_forgets")]);
    expect(respec.hitsArea).toBe(true);
    expect(respec.shape).toEqual({ kind: "burst", radius: 1 });
    // `burst` is a filled MANHATTAN diamond: radius 1 is five tiles.
    expect(resolveShape(respec.shape, { x: 0, y: 0 }, "north")).toHaveLength(5);
    expect(twineedle.hitsArea).toBeUndefined(); // the base move is single-target
  });

  it("The Swarm Decides widens the same cloud rather than redeclaring it, and spares the hive", () => {
    const respec = applyMoveTree(twineedle, [...resolveChosenSetFor(twineedle.tree, "the_swarm_decides")]);
    expect(respec.shape).toEqual({ kind: "burst", radius: 2 });
    expect(resolveShape(respec.shape, { x: 0, y: 0 }, "north")).toHaveLength(13);
    expect(respec.excludesAllies).toBe(true);
    expect(respec.hitsArea).toBe(true); // inherited from Nothing Forgets, its own ancestor
  });

  it("the two Aggression lanes differ in KIND: volume in lane P, depth bought with energy in lane R", () => {
    const volume = applyMoveTree(twineedle, [...resolveChosenSetFor(twineedle.tree, "fourth_needle")]);
    expect(volume.hits).toEqual({ min: 3, max: 4 });
    expect(volume.statusSeverity).toBeUndefined();

    const depth = applyMoveTree(twineedle, [...resolveChosenSetFor(twineedle.tree, "pincushion")]);
    expect(depth.statusSeverity).toBe(3);
    expect(depth.selfCostPerUse).toEqual({ need: "energy", amount: 0.01 }); // Venom Sacs' real price
    // Lane R adds NO needles of its own — the {3,3} it shows is the shared
    // opener's, which both lanes walk through. More needles is lane P's answer.
    expect(depth.hits).toEqual({ min: 3, max: 3 });
    expect(twineedle.tree.venom_sacs.delta.hits).toBeUndefined();
    expect(twineedle.tree.measured_strikes.delta.hits).toBeUndefined();
    expect(twineedle.tree.pincushion.delta.hits).toBeUndefined();
    expect(twineedle.tree.conserving_draw.delta.hits).toBeUndefined();
  });

  it("Venom Sacs and Empty the Sacs carry benefit and cost in the same node (principle 4)", () => {
    expect(twineedle.tree.venom_sacs.delta.statusChance).toBe(0.1);
    expect(twineedle.tree.venom_sacs.delta.selfCostPerUse).toEqual({ need: "energy", amount: 0.01 });
    const cap = twineedle.tree.empty_the_sacs.delta;
    expect(cap.hits).toEqual({ min: 4, max: 6 });
    expect(cap.selfCostPerUse).toEqual({ need: "energy", amount: 0.06 });
  });

  it("the retreat ladder is one chain — 2 -> 3 -> 4 tiles — not three racing forcedMovement setters", () => {
    const tilesAt = (id: string) =>
      applyMoveTree(twineedle, [...resolveChosenSetFor(twineedle.tree, id)]).forcedMovement?.tiles;
    expect(tilesAt("hit_and_gone")).toBe(2);
    expect(tilesAt("never_landed")).toBe(3);
    expect(tilesAt("never_there")).toBe(4);
    expect(Object.values(twineedle.tree).filter((n) => n.delta.forcedMovement).map((n) => n.id).sort())
      .toEqual(["hit_and_gone", "never_landed", "never_there"]);
  });

  it("High Pass buys real cast range and strips the cover the target was standing in", () => {
    const respec = applyMoveTree(twineedle, [...resolveChosenSetFor(twineedle.tree, "high_pass")]);
    expect(respec.range).toEqual({ min: 0, max: 3 });
    expect(respec.terrainBurn).toBe(true);
    expect(respec.power).toBe(twineedle.power - 5); // it pays for the reach
  });
});

describe("Poison Sting tree: the sting is not the point, the sting is delivery", () => {
  const poisonSting = MOVES.poison_sting as MoveSpec & { tree: Record<string, MoveTreeNode> };

  it("Sickened ships the half of its own design the engine can actually run", () => {
    const respec = applyMoveTree(poisonSting, [...resolveChosenSetFor(poisonSting.tree, "sickened")]);
    expect(respec.statusSeverity).toBe(2.4);
    expect(respec.jamCooldownTicks).toBe(12);
    // The needs-interference half could NOT ship: nothing on any needs-recovery
    // path in needs.ts reads `agent.status`, and `drainNeeds` is unreachable on
    // a non-utility move (utilityMoves.ts is its only reader).
    for (const node of Object.values(poisonSting.tree)) {
      expect(node.delta.drainNeeds).toBeUndefined();
    }
  });

  it("the severity ladder is one chain, 1.3 -> 1.6 -> 2.4 -> 3.2", () => {
    const sevAt = (id: string) =>
      applyMoveTree(poisonSting, [...resolveChosenSetFor(poisonSting.tree, id)]).statusSeverity;
    expect(poisonSting.statusSeverity).toBeUndefined();
    expect(sevAt("slow_working")).toBe(1.3);
    expect(sevAt("thin_blood")).toBe(1.6);
    expect(sevAt("sickened")).toBe(2.4);
    expect(sevAt("let_it_work")).toBe(3.2);
  });

  it("Dry Bite genuinely abandons the tree's own premise: real power for real venom", () => {
    const node = poisonSting.tree.dry_bite;
    expect(node.delta.power).toBe(25);
    expect(node.delta.statusChance).toBe(-0.2);
    const respec = applyMoveTree(poisonSting, [...resolveChosenSetFor(poisonSting.tree, "dry_bite")]);
    expect(respec.statusChance).toBeCloseTo(0.1, 6); // base 0.3 - 0.2
    expect(respec.power).toBe(poisonSting.power + 25);
  });

  it("The Long Meal breaks the resist Poison actually runs into, and feeds the pack", () => {
    const respec = applyMoveTree(poisonSting, [...resolveChosenSetFor(poisonSting.tree, "the_long_meal")]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 1.6 });
    // `gatherBurst` is genuinely live here: the canopy-harvest path (needs.ts)
    // picks a `power > 0 && category !== "status"` move, which this is.
    expect(respec.gatherBurst).toBe(3);
    expect(poisonSting.power).toBeGreaterThan(0);
    expect(poisonSting.category).not.toBe("status");
  });

  it("The Nest Decides is a real venom cloud the nest itself is exempt from", () => {
    const respec = applyMoveTree(poisonSting, [...resolveChosenSetFor(poisonSting.tree, "the_nest_decides")]);
    expect(respec.shape).toEqual({ kind: "burst", radius: 1 });
    expect(respec.hitsArea).toBe(true);
    expect(respec.excludesAllies).toBe(true);
    expect(resolveShape(respec.shape, { x: 0, y: 0 }, "north")).toHaveLength(5);
  });

  it("the mark ladder is one chain — 80 -> 200 -> 260 ticks — not racing rallyCall setters", () => {
    const ticksAt = (id: string) =>
      applyMoveTree(poisonSting, [...resolveChosenSetFor(poisonSting.tree, id)]).rallyCall?.ticks;
    expect(ticksAt("scent_trail")).toBe(80);
    expect(ticksAt("nothing_leaves")).toBe(200);
    expect(ticksAt("circling_nest")).toBe(260);
  });
});

describe("Roost tree: the bird comes down, and being down is the price", () => {
  const roost = MOVES.roost as MoveSpec & { tree: Record<string, MoveTreeNode> };

  it("the landing is a real action lock, not a label — and it is bought, never free", () => {
    // `lockTicks` is additive and applied by `useMove`, which the utility
    // path DOES call, so this is a genuine window of not acting.
    expect(roost.lockTicks ?? 0).toBe(0); // the base move grounds nobody
    const settled = applyMoveTree(roost, [...resolveChosenSetFor(roost.tree, "settled_in")]);
    expect(settled.lockTicks).toBe(6); // Wings Folded 3 + Settled In 3
    expect(settled.selfHeal).toEqual({ fraction: 0.4 });
    const night = applyMoveTree(roost, [...resolveChosenSetFor(roost.tree, "night_on_the_branch")]);
    expect(night.selfHeal).toEqual({ fraction: 0.7 });
    expect(night.lockTicks).toBe(14); // + Dead Asleep 3 + Night on the Branch 5
    // Every node that spends lock ticks pays for them in the same node.
    for (const node of Object.values(roost.tree)) {
      if (!node.delta.lockTicks) continue;
      const upside = Object.keys(node.delta).some((k) => k !== "lockTicks") || node.grantsPassive || node.grantsPassives;
      expect(upside).toBeTruthy();
    }
  });

  it("the two Boldness lanes are opposites: lane D locks and heals, lane B never locks at all", () => {
    const laneB = resolveChosenSetFor(roost.tree, "up_again");
    expect([...laneB].some((id) => roost.tree[id].delta.lockTicks)).toBe(false);
    const spec = applyMoveTree(roost, [...laneB]);
    expect(spec.lockTicks ?? 0).toBe(0);
    expect(spec.cooldownTicks).toBe(19); // 30 - 2 - 3 - 4 - 2
    expect(spec.statChangesOnHit).toEqual([{ target: "self", stat: "speed", stage: 2, ticks: 60 }]);
  });

  it("every selfHeal setter lies on one ancestry chain, so no two of them race", () => {
    const healers = Object.values(roost.tree).filter((n) => n.delta.selfHeal).map((n) => n.id).sort();
    expect(healers).toEqual(["full_crop", "night_on_the_branch", "settled_in"]);
    const chain = resolveChosenSetFor(roost.tree, "night_on_the_branch");
    for (const id of healers) expect(chain.has(id)).toBe(true);
  });

  it("the roost is a place: a real fertilityBoost and a real status aura, laddered on one chain", () => {
    expect(applyMoveTree(roost, [...resolveChosenSetFor(roost.tree, "rich_ground")]).fertilityBoost)
      .toEqual({ amount: 0.5, radius: 2 });
    expect(applyMoveTree(roost, [...resolveChosenSetFor(roost.tree, "roosting_hours")]).fertilityBoost)
      .toEqual({ amount: 0.7, radius: 2 });
    expect(applyMoveTree(roost, [...resolveChosenSetFor(roost.tree, "whole_tree_down")]).statusImmunityAura)
      .toEqual({ ticks: 70, radius: 3 });
  });

  it("stays inside its per-move passive budgets", () => {
    expect(passiveTotal(roost, "thorns")).toBeLessThanOrEqual(0.5);
    expect(passiveTotal(roost, "damageReduction")).toBeLessThanOrEqual(0.2);
    expect(passiveTotal(roost, "regen") + passiveTotal(roost, "healAura") + passiveTotal(roost, "regenFlat") / 43)
      .toBeLessThanOrEqual(0.1);
  });
});

describe("Defense Curl tree: a ball has no handles", () => {
  const curl = MOVES.defense_curl as MoveSpec & { tree: Record<string, MoveTreeNode> };
  const harden = MOVES.harden as MoveSpec & { tree: Record<string, MoveTreeNode> };
  const passivesOf = (n: MoveTreeNode) => [...(n.grantsPassives ?? []), ...(n.grantsPassive ? [n.grantsPassive] : [])];

  it("is not Harden: no lockTicks and no immovable anywhere, where Harden leans on both", () => {
    const uses = (move: MoveSpec & { tree: Record<string, MoveTreeNode> }, pred: (n: MoveTreeNode) => unknown) =>
      Object.values(move.tree).filter(pred).length;
    expect(uses(curl, (n) => n.delta.lockTicks)).toBe(0);
    expect(uses(curl, (n) => passivesOf(n).some((p) => p.kind === "immovable"))).toBe(0);
    // The control: Harden uses both, which is why the two moves read
    // differently rather than being the same tree twice.
    expect(uses(harden, (n) => n.delta.lockTicks)).toBeGreaterThan(0);
    expect(uses(harden, (n) => passivesOf(n).some((p) => p.kind === "immovable"))).toBeGreaterThan(0);
  });

  it("a defensive move that buys Speed: the roll ladder is 1 -> 2 -> 3 -> 4", () => {
    const speedAt = (id: string) => {
      const spec = applyMoveTree(curl, [...resolveChosenSetFor(curl.tree, id)]);
      const speeds = (spec.statChangesOnHit ?? []).filter((c) => c.stat === "speed");
      return Math.max(0, ...speeds.map((c) => c.stage));
    };
    expect(speedAt("set_the_spin")).toBe(1);
    expect(speedAt("still_rolling")).toBe(2);
    expect(speedAt("long_grade")).toBe(3);
    expect(speedAt("comes_back_around")).toBe(4);
    // Harden's whole tree never touches Speed — the control for "this is a
    // different answer, not a bigger one".
    expect(Object.values(harden.tree).some((n) =>
      [...(n.delta.statChangesOnHit ?? []), ...(n.delta.statChangeOnHit ? [n.delta.statChangeOnHit] : [])].some((c) => c.stat === "speed")
    )).toBe(false);
  });

  it("the Defense ladder climbs 2 -> 3 -> 4 -> 5 and stops one stage short of the +6 clamp", () => {
    const setters = Object.values(curl.tree)
      .filter((n) => (n.delta.statChangesOnHit ?? []).some((c) => c.stat === "defense"))
      .map((n) => n.id).sort();
    expect(setters).toEqual(["limbs_in", "one_curve", "the_soft_side_in", "tuck"]);
    const defenseAt = (id: string) => {
      const spec = applyMoveTree(curl, [...resolveChosenSetFor(curl.tree, id)]);
      return Math.max(0, ...(spec.statChangesOnHit ?? []).filter((c) => c.stat === "defense").map((c) => c.stage));
    };
    expect(curl.statChangeOnHit?.stage).toBe(1); // the base move
    expect(defenseAt("tuck")).toBe(2);
    expect(defenseAt("limbs_in")).toBe(3);
    expect(defenseAt("the_soft_side_in")).toBe(4);
    // One Curve is reachable by three routes and only one of them walks the
    // Defense lane, so its own +5 has to stand on its own — which is exactly
    // why every rung uses the APPENDING form: two rungs in one build resolve
    // to the strongest (`resolveStatChangesOnHit`), never to whichever the
    // engine happened to apply last.
    expect(defenseAt("one_curve")).toBe(5);
    const bothRoutes = new Set([
      ...resolveChosenSetFor(curl.tree, "heat_kept"),
      ...resolveChosenSetFor(curl.tree, "one_curve"),
    ]);
    expect(bothRoutes.has("the_soft_side_in")).toBe(true);
    const spec = applyMoveTree(curl, [...bothRoutes, "one_curve"].filter((id, i, a) => a.indexOf(id) === i));
    expect(Math.max(...(spec.statChangesOnHit ?? []).filter((c) => c.stat === "defense").map((c) => c.stage))).toBe(5);
  });

  it("both halves of lane R's fork differ in kind, not degree — measured on the respec'd spec", () => {
    const long = applyMoveTree(curl, [...resolveChosenSetFor(curl.tree, "long_grade")]);
    const short = applyMoveTree(curl, [...resolveChosenSetFor(curl.tree, "short_hops")]);
    expect(Math.max(...(long.statChangesOnHit ?? []).map((c) => c.stage))).toBe(3);
    expect(Math.max(...(short.statChangesOnHit ?? []).map((c) => c.stage))).toBe(2);
    expect(short.cooldownTicks).toBeLessThan(long.cooldownTicks);
  });

  it("stays inside its per-move passive budgets", () => {
    expect(passiveTotal(curl, "thorns")).toBeLessThanOrEqual(0.5);
    // Slack Hide and Packed Tight exclude each other, so the reachable
    // damageReduction total is what matters; both sides are under the cap.
    expect(passiveTotal(curl, "damageReduction")).toBeLessThanOrEqual(0.2);
    expect(passiveTotal(curl, "regen") + passiveTotal(curl, "healAura") + passiveTotal(curl, "regenFlat") / 43)
      .toBeLessThanOrEqual(0.1);
  });
});

// ---------------------------------------------------------------------------
// Round seven: the two world-changing trees — Rain Dance and Grassy Terrain.
// ---------------------------------------------------------------------------

describe("the two world-changing status trees pull only levers a utilityMove can reach", () => {
  for (const moveId of ["rain_dance", "grassy_terrain"]) {
    const move = MOVES[moveId] as MoveSpec & { tree: Record<string, MoveTreeNode> };

    it(`${moveId} is a 45-node utilityMove tree`, () => {
      expect(move.utilityMove).toBe(true);
      expect(Object.keys(move.tree)).toHaveLength(45);
    });

    it(`${moveId} sets no field only the hostile hit pipeline reads`, () => {
      const offenders: string[] = [];
      for (const node of Object.values(move.tree)) {
        for (const field of DEAD_ON_A_UTILITY_MOVE) {
          if ((node.delta as Record<string, unknown>)[field] !== undefined) offenders.push(`${node.id}.${field}`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it(`every ${moveId} statChangeOnHit targets self and is positive`, () => {
      for (const node of Object.values(move.tree)) {
        const change = node.delta.statChangeOnHit;
        if (!change) continue;
        expect(change.target).toBe("self");
        expect(change.stage).toBeGreaterThan(0);
      }
    });

    it(`every ${moveId} branch can spend a real fight action`, () => {
      // The families `maybeUseUtilityMoveInCombat` (utilityMoves.ts) scores.
      // `spawnsRain` is deliberately NOT in this list even though it scores
      // 20: it only scores while no cell of its own type is up, so a branch
      // resting on it alone would fire rarely and this test would pass for
      // the wrong reason.
      const COMBAT_USABLE = ["selfHeal", "statChangeOnHit", "statusImmunityAura", "allyEffect", "allyEffects", "drainNeeds"];
      for (const branch of ["aggression", "boldness", "sociability"] as const) {
        const inBranch = Object.values(move.tree).filter((n) => n.leaning === branch);
        expect(inBranch.length).toBeGreaterThan(0);
        const reaches = inBranch.filter((n) => COMBAT_USABLE.some((f) => (n.delta as Record<string, unknown>)[f] !== undefined));
        expect(reaches.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("Rain Dance tree: the move whose target is the sky", () => {
  const rain = MOVES.rain_dance as MoveSpec & { tree: Record<string, MoveTreeNode> };

  it("the base move can only say 'yes, rain' — the tree is what makes the cell bigger, longer and worse", () => {
    expect(rain.spawnsRain).toBe(true);
    expect(rain.weatherRadiusBonus).toBeUndefined();
    expect(rain.weatherLifespanBonus).toBeUndefined();
    expect(rain.weatherType).toBeUndefined();
  });

  it("Black Water turns the cell into a real storm, and is the only node that changes its kind", () => {
    const respec = applyMoveTree(rain, [...resolveChosenSetFor(rain.tree, "black_water")]);
    expect(respec.weatherType).toBe("storm");
    expect(Object.values(rain.tree).filter((n) => n.delta.weatherType).map((n) => n.id)).toEqual(["black_water"]);
  });

  it("radius and lifespan are ADDITIVE, so two nodes buying width both count", () => {
    const radiusNodes = Object.values(rain.tree).filter((n) => n.delta.weatherRadiusBonus !== undefined);
    expect(radiusNodes.length).toBeGreaterThan(3);
    // squall_line 2 + low_sky 3 + black_water 4 + nowhere_dry 4
    expect(applyMoveTree(rain, [...resolveChosenSetFor(rain.tree, "nowhere_dry")]).weatherRadiusBonus).toBe(13);
    // open_water 40 + slow_front 60 + it_does_not_pass 200 + mist_after 80
    expect(applyMoveTree(rain, [...resolveChosenSetFor(rain.tree, "mist_after")]).weatherLifespanBonus).toBe(380);
  });

  it("the thirst-theft ladder is one chain, and the two deepest rungs exclude each other", () => {
    const amountAt = (id: string) => applyMoveTree(rain, [...resolveChosenSetFor(rain.tree, id)]).drainNeeds?.amount;
    expect(rain.drainNeeds).toBeUndefined();
    expect(amountAt("drinking_it")).toBeCloseTo(0.03);
    expect(amountAt("rain_shadow")).toBeCloseTo(0.07);
    expect(rain.tree.undertow!.excludes).toEqual(["standing_flood"]);
    expect(rain.tree.standing_flood!.excludes).toEqual(["undertow"]);
  });

  it("the cooldown cut stays inside the 3x tempo cap for a 150-tick move", () => {
    const cut = Object.values(rain.tree).reduce((sum, n) => sum + Math.max(0, -(n.delta.cooldownTicks ?? 0)), 0);
    const floor = Math.ceil((rain.cooldownTicks + 1) / 3) - 1;
    expect(cut).toBeLessThanOrEqual(rain.cooldownTicks - floor);
  });
});

describe("Grassy Terrain tree: the ground, and what it can hold", () => {
  const grass = MOVES.grassy_terrain as MoveSpec & { tree: Record<string, MoveTreeNode> };

  it("the base move only raises fertility, which on rock is measurably nothing", () => {
    expect(grass.fertilityBoost).toEqual({ amount: 0.15, radius: 2 });
    expect(grass.fertilityCeilingBoost).toBeUndefined();
    // The control that makes that claim mean something: a rocky tile exactly
    // as worldgen leaves it, its fertility written AT the 0.25 ceiling.
    const tile = { terrain: "floor" as const, walkable: true, groundType: "rocky" as const, fertility: 0.25 };
    raiseFertility(tile, grass.fertilityBoost!.amount);
    expect(tile.fertility).toBeCloseTo(0.25); // nothing moved
    raiseFertilityCeiling(tile, 0.15);
    raiseFertility(tile, grass.fertilityBoost!.amount);
    expect(tile.fertility).toBeCloseTo(0.4); // the ceiling lever is what moved it
  });

  it("the ceiling ladder is one chain — 0.05 -> 0.08 -> 0.15 -> 0.3 — widening as it climbs", () => {
    const at = (id: string) => applyMoveTree(grass, [...resolveChosenSetFor(grass.tree, id)]).fertilityCeilingBoost;
    expect(at("breaking_ground")).toEqual({ amount: 0.05, radius: 1 });
    expect(at("root_split")).toEqual({ amount: 0.08, radius: 2 });
    expect(at("made_ground")).toEqual({ amount: 0.15, radius: 3 });
    expect(at("it_was_a_meadow")).toEqual({ amount: 0.3, radius: 4 });
  });

  it("Oddish and Gloom already carry Growth's thorns, so this tree grants none", () => {
    const thorns = Object.values(grass.tree)
      .flatMap((n) => [...(n.grantsPassive ? [n.grantsPassive] : []), ...(n.grantsPassives ?? [])])
      .filter((p) => p.kind === "thorns");
    expect(thorns).toEqual([]);
    // The control: Growth, which the same two species learn, does grant it.
    expect(passiveTotal(MOVES.growth as MoveSpec & { tree: Record<string, MoveTreeNode> }, "thorns")).toBeGreaterThan(0.2);
  });

  it("the fertility ladder is one chain ending in an 11-tile-wide flood", () => {
    const at = (id: string) => applyMoveTree(grass, [...resolveChosenSetFor(grass.tree, id)]).fertilityBoost;
    expect(at("settling_in")).toEqual({ amount: 0.25, radius: 2 });
    expect(at("whole_field")).toEqual({ amount: 0.7, radius: 4 });
    expect(at("the_meadow_holds")).toEqual({ amount: 1, radius: 5 });
  });
});
