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

describe("Rock Throw tree: Aggression keystone and Flying matchup", () => {
  const rockThrow = MOVES.rock_throw;

  it("Cave-In keystone is reachable through the Aggression fork and boosts crit rate", () => {
    const respec = applyMoveTree(rockThrow, [
      "heavy_stones",
      "boulder_momentum",
      "landslide_footing",
      "crushing_weight",
      "avalanche_force",
      "overhand_heave",
      "skyfall",
      "rockslide_precision",
      "cave_in",
    ]);
    expect(respec.critRateStage).toBe(2);
    expect(respec.bonusVsType).toEqual({ type: "flying", multiplier: 1.5 });
  });

  it("Bedrock Breaker keystone grants a real resistanceBreaker", () => {
    const respec = applyMoveTree(rockThrow, [
      "bedrock_stance",
      "weathered_slab",
      "bedrock_footing",
      "unshakeable",
      "granite_grip",
      "granite_ward",
      "fracturing_blow",
      "bedrock_resolve",
      "bedrock_breaker",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
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

describe("Hydro Pump tree: raw overwhelming force", () => {
  const hydroPump = MOVES.hydro_pump;

  it("Tidal Devastation keystone is reachable through the Aggression fork", () => {
    const respec = applyMoveTree(hydroPump, [
      "pressurized_core",
      "surging_jets",
      "deluge_footing",
      "overwhelming_flow",
      "torrent_conditioning",
      "concentrated_blast",
      "torrential_downpour",
      "current_precision",
      "tidal_devastation",
    ]);
    expect(respec.critRateStage).toBe(2);
  });

  it("Abyssal Pressure keystone fixes the real Grass/Water/Dragon resist", () => {
    const respec = applyMoveTree(hydroPump, [
      "grounded_stance",
      "steady_flow",
      "undertow_footing",
      "steady_current",
      "current_grip",
      "measured_flow",
      "eroding_current",
      "current_resolve",
      "abyssal_pressure",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
  });
});

describe("Solar Beam tree: real long reach, single target", () => {
  const solarBeam = MOVES.solar_beam;

  it("has no hitsArea by default — Solar Beam stays a single-target beam, just with real range", () => {
    expect(solarBeam.hitsArea).toBeUndefined();
    expect(solarBeam.shape).toEqual({ kind: "line", length: 5 });
  });

  it("Photosynthetic Ward keystone fixes Grass's real multi-type resists", () => {
    const respec = applyMoveTree(solarBeam, [
      "steady_roots",
      "deepening_roots",
      "rooted_footing",
      "unwavering_stance",
      "canopy_grip",
      "piercing_focus",
      "withering_grasp",
      "root_resolve",
      "photosynthetic_ward",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
    expect(respec.statChangeOnHit).toEqual({ target: "defender", stat: "spAttack", stage: -1, ticks: 20 });
  });
});

describe("Earthquake tree: self-centered burst AoE", () => {
  const earthquake = MOVES.earthquake;

  it("is a real self-centered AoE by default, not just a single-target hit", () => {
    expect(earthquake.hitsArea).toBe(true);
    expect(earthquake.shape).toEqual({ kind: "burst", radius: 2 });
  });

  it("Fault Line grants the defenseBoost passive, diversifying away from flat damageReduction", () => {
    const node = earthquake.tree!.fault_line;
    expect(node.grantsPassive).toEqual({ kind: "defenseBoost", value: 0.1 });
  });

  it("Tectonic Shield keystone fixes Ground's real Grass/Bug resists", () => {
    const respec = applyMoveTree(earthquake, [
      "anchored_stance",
      "bedrock_momentum",
      "anchor_footing",
      "immovable_ground",
      "tectonic_grip",
      "steady_tremor",
      "fault_line",
      "bedrock_resolve",
      "tectonic_shield",
    ]);
    expect(respec.resistanceBreaker).toEqual({ multiplier: 2 });
  });
});
