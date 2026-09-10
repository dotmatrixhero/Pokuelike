/**
 * HISTORICAL. All five trees below have SHIPPED — they are live in
 * `packages/data/src/moves.ts` and the game reads those, not these. This
 * file is kept as the draft of record (and as the checker's `--selftest`
 * fixture host); it is NOT the source of truth for any of them any more,
 * and it deliberately still shows the drafts' original failures so the
 * before/after stays legible.
 *
 * What changed on the way in is written up in MOVES_DESIGN.md's "Round six
 * shipped" section. The short version: roughly a third of these nodes used
 * proposed engine fields (`hitsBonus`, `rangeBonus`, `rallyCallTicks`,
 * `areaBonus`, `allyEffects`, `situationalBonuses`, `reposition`, `ppCost`/
 * `maxPPBonus`) or `PassiveKind`s (`bulk`, `unnoticed`, `huntTargetSkip`,
 * `terrainUnhindered`, `dispersalSpeed`, `cooldownHaste`, `herdHaste`,
 * `thornsRubble`) that do not exist, and Harden/Growth/Agility are
 * `utilityMove`s, which never reach the hostile hit pipeline at all.
 *
 * ---
 *
 * PROPOSED move trees — drafts for review in the Move Tree Atlas's
 * "proposed" mode. Nothing here is wired into `MOVES`; the game does not
 * read it. Direct ask: "Add a proposed mode. I just want to see your trees
 * before you build em all."
 *
 * Structure matches the shipped standard exactly (MOVES_DESIGN.md's
 * "Crosslinks are bridges, not spurs"): per tree, three branches of ten
 * nodes each plus three three-node bridges = 39 nodes, 9
 * `prerequisitesAnyOf`, 6 fork nodes. Each bridge is
 * crosslink -> filler-that-deepens-the-crosslink's-own-lever -> cost-2
 * notable, and that notable is wired as an alternate route into the
 * pre-fork node of BOTH branches it connects (principle 11), landing one
 * step short of the fork rather than on it (principle 12). The crosslink
 * itself also stays a shallower alternate route on an early filler in each
 * flanking branch.
 *
 * Deliberately NOT typed against `MoveTree`: some nodes depend on engine
 * primitives that don't exist. Those carry `needsPrimitive`, naming the
 * real call site that would have to change — verified by reading the
 * function, not the field name (principle 3).
 */

export interface ProposedNode {
  id: string;
  name: string;
  cost: number;
  prerequisites?: string[];
  prerequisitesAnyOf?: string[][];
  excludes?: string[];
  leaning?: "aggression" | "boldness" | "sociability";
  grantsPassive?: { kind: string; value: number };
  grantsPassives?: Array<{ kind: string; value: number }>;
  delta: Record<string, unknown>;
  /** The engine primitive this node needs, named by real call site. Absent = buildable today. */
  needsPrimitive?: string;
  /** One line of design intent, shown in the atlas detail pane. */
  note?: string;
}

export interface ProposedMove {
  id: string;
  name: string;
  type: string;
  category: string;
  power: number;
  accuracy: number;
  cooldownTicks: number;
  /** The move's real canon max PP (dex/moves.generated.ts). PP-cost density scales off this. */
  pp: number;
  shape: unknown;
  range?: unknown;
  /** Deprecated in drafts: area SIZE is the additive `delta.areaBonus` now, and `shape` says what form it takes. Kept only to describe a move's base footprint. */
  hitsArea?: boolean;
  fantasy: string;
  learners: string[];
  tree: Record<string, ProposedNode>;
}

function tree(nodes: ProposedNode[]): Record<string, ProposedNode> {
  const out: Record<string, ProposedNode> = {};
  for (const n of nodes) {
    if (out[n.id]) throw new Error(`duplicate proposed node id: ${n.id}`);
    out[n.id] = n;
  }
  return out;
}

const BULK = "PassiveKind \"bulk\", added into predation.ts's `move.power + move.weightScaling.factor * attacker.maxHp` expression";
const UNNOTICED = "PassiveKind \"unnoticed\", subtracted from `baseRadius` in predation.ts's `isDetectable` (the same term BUSH_CONCEALMENT_DETECTION_REDUCTION already occupies)";
const SKIP = "Hunt-target skip in predation.ts's HUNT_DETECT_RADIUS pick — the same `isDetectable` call site, applied herd-wide";
const RUBBLE = "A \"rubble\" TerrainKind plus its terrainSpeedMultiplier entry — also unblocks Earthquake's Boldness branch, blocked since round three";
const NEEDS = "Status-scaled needs recovery in needs.ts — a multiplier on the hunger/thirst restore path, which no move currently touches";
const TERRAIN_SELF = "terrainFill at the CASTER's tile from the utility path — shipped terrainFill only writes at the defender's position on a landed hit (predation.ts:1265)";
const CEILING = "Raising a tile's `fertilityCeiling` (flora.ts's GROUND_TYPE_PARAMS) — fertility already regenerates and is capped per ground type, so \"permanent\" means a higher cap, not frozen decay";
const FORAGE = "Herd-scoped foraging yield on enriched ground (flora.ts harvest path)";
const MIGRATE = "Migration-pressure reduction from local abundance (herdMigration.ts's scarcity trigger)";
const UNHINDERED = "PassiveKind \"terrainUnhindered\", applied where `movementSpeedFactor` is stashed onto `agent.terrainSpeedFactor` (simulation.ts:357) — NOT in actionSpeedOf, which only reads the already-computed factor";
const DISPERSAL = "Dispersal/zone-crossing speed modifier (overworld.ts's applyDispersal)";
const HASTE = "PassiveKind \"cooldownHaste\" — a global cooldown-rate term; useMove sets raw tick counts today";
const PPC = "PP as a per-use cost (MoveSpec.ppCost) plus MoveTreeNode.delta.maxPPBonus — MoveSpec.pp is shipped and inert; spending it is the open piece";
const HERD_HASTE = "Herd-scoped speed aura — aquaticHasteMultiplier (support.ts) is the shipped shape to copy, minus its terrain condition";

export const PROPOSED_TREES: Record<string, ProposedMove> = {
  harden: {
    pp: 30,
    id: "harden", name: "Harden", type: "normal", category: "status",
    power: 0, accuracy: 100, cooldownTicks: 40, shape: { kind: "point" },
    learners: ["metapod", "kakuna", "krabby", "kingler", "shellder"],
    fantasy:
      "Harden is not a shield being raised. It is a body clenching until it is a different material — a Caterpie going rigid on a twig until it reads as bark, a Kakuna that is functionally furniture. It is the move of things that cannot run and cannot fight, and that survive by not being worth the effort. Nothing about it is dangerous. What it changes is whether anything bothers.",
    tree: tree([
      // ===== BOLDNESS: density. Heavy, or fast to set.
      { id: "settling_weight", name: "Settling Weight", cost: 1, leaning: "boldness",
        grantsPassive: { kind: "bulk", value: 0.12 }, delta: {}, needsPrimitive: BULK,
        note: "OPENER. Weight is read by every weightScaling move, so this makes the holder's TACKLE hit harder — a node in one move's tree paying off in another's. Splits into a weight lane and a speed-of-setting lane." },
      { id: "packed_shell", name: "Packed Shell", cost: 1, prerequisites: ["settling_weight"], leaning: "boldness",
        delta: { statChangesOnHit: [{ target: "self", stat: "defense", stage: 1, ticks: 75 }] } },
      { id: "deadweight", name: "Deadweight", cost: 1, prerequisites: ["packed_shell"], leaning: "boldness",
        grantsPassive: { kind: "bulk", value: 0.18 }, delta: {}, needsPrimitive: BULK },
      { id: "rooted_stance", name: "Rooted Stance", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["deadweight"], ["spines_out"]],
        grantsPassive: { kind: "immovable", value: 1 }, delta: {},
        note: "LANE W NOTABLE. Cannot be dragged, knocked back or lunged at." },
      { id: "set_bone", name: "Set Bone", cost: 1, prerequisites: ["rooted_stance"], leaning: "boldness",
        grantsPassive: { kind: "bulk", value: 0.2 }, delta: {}, needsPrimitive: BULK },
      { id: "quick_set", name: "Quick Set", cost: 1, prerequisites: ["settling_weight"], leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 1 }, delta: { cooldownTicks: -4 },
        note: "LANE S entry. Harden often and lightly rather than once and totally." },
      { id: "hardening_habit", name: "Hardening Habit", cost: 1, prerequisites: ["quick_set"], leaning: "boldness",
        delta: { cooldownTicks: -5, maxPPBonus: 10 }, needsPrimitive: PPC },
      { id: "chrysalis", name: "Chrysalis", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["hardening_habit"], ["armored_indifference"]],
        grantsPassive: { kind: "damageReduction", value: 0.2 }, delta: { lockTicks: 6, ppCost: 4 }, needsPrimitive: PPC,
        note: "LANE S NOTABLE. Voluntary helplessness: enormous mitigation bought with a real action lock. The roster has no other move where being unable to act is the point — chargeAttack spends its lock buying an attack, not survival." },
      { id: "dense_core", name: "Dense Core", cost: 1, prerequisites: ["chrysalis"], leaning: "boldness",
        grantsPassive: { kind: "regenFlat", value: 2 }, delta: {} },
      { id: "unbudgeable", name: "Unbudgeable", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["set_bone"], ["dense_core"]],
        grantsPassives: [{ kind: "bulk", value: 0.35 }, { kind: "damageReduction", value: 0.1 }], delta: {}, needsPrimitive: BULK,
        note: "DEEP NOTABLE. At full stack a Metapod is meaningfully heavy — its Tackle becomes a real threat, which is the whole cross-move thesis paying off." },
      { id: "slow_to_shift", name: "Slow to Shift", cost: 1, prerequisites: ["unbudgeable"], leaning: "boldness",
        delta: { cooldownTicks: -5, maxPPBonus: 10 }, needsPrimitive: PPC },
      { id: "the_long_sleep", name: "The Long Sleep", cost: 1, prerequisites: ["slow_to_shift"], leaning: "boldness",
        grantsPassives: [{ kind: "regen", value: 0.05 }, { kind: "unshaken", value: 1 }],
        delta: { lockTicks: 8, ppCost: 3 }, needsPrimitive: PPC,
        note: "CAPSTONE. Not a shell — a season. It stops entirely and comes out the other side whole." },

      // ===== SOCIABILITY: not worth eating. Alone, or as scenery.
      { id: "still_as_bark", name: "Still as Bark", cost: 1, leaning: "sociability",
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED,
        note: "OPENER. isDetectable already has exactly this term for bushes; nothing has ever granted it. Splits into going unnoticed alone, or as a group." },
      { id: "dead_leaf", name: "Dead Leaf", cost: 1, prerequisites: ["still_as_bark"], leaning: "sociability", delta: { cooldownTicks: -2 } },
      { id: "not_food", name: "Not Food", cost: 1, prerequisites: ["dead_leaf"], leaning: "sociability",
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED },
      { id: "driftwood", name: "Driftwood", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["not_food"], ["armored_indifference"]],
        grantsPassive: { kind: "unnoticed", value: 2 }, delta: { cooldownTicks: -5 }, needsPrimitive: UNNOTICED,
        note: "LANE Q NOTABLE. One thing nothing looks at twice." },
      { id: "bark_still", name: "Bark-Still", cost: 1, prerequisites: ["driftwood"], leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.2 }, delta: {} },
      { id: "shared_stillness", name: "Shared Stillness", cost: 1, prerequisites: ["still_as_bark"], leaning: "sociability",
        delta: { targetsAlly: true, allyEffects: [{ buff: { stat: "defense", stage: 1, ticks: 50 } }] },
        note: "LANE G entry. Hardening beside a herd-mate hardens them too." },
      { id: "hold_position", name: "Hold Position", cost: 1, prerequisites: ["shared_stillness"], leaning: "sociability",
        delta: { allyEffectOnAttack: true } },
      { id: "scenery", name: "Scenery", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["hold_position"], ["ambush_shell"]],
        grantsPassives: [{ kind: "unnoticedAura", value: 1 }, { kind: "healAura", value: 0.008 }], delta: {}, needsPrimitive: UNNOTICED,
        note: "LANE G NOTABLE. Several hardened herd-mates near each other read as scenery together — but only while they stay bunched." },
      { id: "wrong_tree", name: "Wrong Tree", cost: 1, prerequisites: ["scenery"], leaning: "sociability",
        grantsPassive: { kind: "nonTerritorial", value: 1 }, delta: {} },
      { id: "let_it_pass", name: "Let It Pass", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["bark_still"], ["wrong_tree"]],
        grantsPassive: { kind: "huntTargetSkip", value: 1 }, delta: {}, needsPrimitive: SKIP,
        note: "DEEP NOTABLE. A predator scanning for prey passes over entirely and hunts a different herd. Like rallyCall, the payoff is that OTHER agents independently decide something different." },
      { id: "not_worth_it", name: "Not Worth It", cost: 1, prerequisites: ["let_it_pass"], leaning: "sociability",
        delta: { statusImmunityAura: { ticks: 60, radius: 3 } } },
      { id: "the_forest_floor", name: "The Forest Floor", cost: 1, prerequisites: ["not_worth_it"], leaning: "sociability",
        grantsPassives: [{ kind: "huntTargetSkip", value: 1 }, { kind: "calmingPresence", value: 0.3 }], delta: {}, needsPrimitive: SKIP,
        note: "CAPSTONE. Not hidden — irrelevant. The ground itself is not hunted, and nothing near it starts anything." },

      // ===== AGGRESSION: the shell is the weapon. Splintering, or honed.
      { id: "brittle_ridge", name: "Brittle Ridge", cost: 1, leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.08 }, delta: {},
        note: "OPENER. It hurts to bite. Splits into a shell that shatters outward and one that simply holds an edge." },
      { id: "sharp_seams", name: "Sharp Seams", cost: 1, prerequisites: ["brittle_ridge"], leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.07 }, delta: { jamCooldownTicks: 4 },
        note: "Whatever bit down spends the next few ticks dealing with it." },
      { id: "shell_grit", name: "Shell Grit", cost: 1, prerequisites: ["sharp_seams"], leaning: "aggression",
        delta: { statChangesOnHit: [{ target: "self", stat: "defense", stage: 2, ticks: 50 }] } },
      { id: "splinter", name: "Splinter", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["shell_grit"], ["ambush_shell"]],
        grantsPassive: { kind: "thorns", value: 0.15 },
        delta: { statusChance: 0.15, statusSpreads: true },
        note: "LANE E NOTABLE. A third of the bite comes back, and the splinters left in the wound fester — Harden's first status of any kind." },
      { id: "grinding_plates", name: "Grinding Plates", cost: 1, prerequisites: ["splinter"], leaning: "aggression",
        delta: { cooldownTicks: -5 } },
      { id: "honed_carapace", name: "Honed Carapace", cost: 1, prerequisites: ["brittle_ridge"], leaning: "aggression",
        grantsPassives: [{ kind: "defenseBoost", value: 2 }, { kind: "damageReduction", value: 0.12 }], delta: {},
        note: "LANE C entry. A shell that simply holds, rather than one that pays for the cut by breaking." },
      { id: "barbed_plates", name: "Barbed Plates", cost: 1, prerequisites: ["honed_carapace"], leaning: "aggression",
        delta: { defensePenetration: 0.15 } },
      { id: "sharded_break", name: "Sharded Break", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["barbed_plates"], ["spines_out"]],
        grantsPassive: { kind: "thorns", value: 0.15 },
        delta: { shape: { kind: "ring" }, areaBonus: 1 },
        note: "LANE C NOTABLE. The casing shatters outward — everything adjacent takes the fragments, not just whatever bit." },
      { id: "keen_edges", name: "Keen Edges", cost: 1, prerequisites: ["sharded_break"], leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.08 }, delta: {} },
      { id: "jagged_answer", name: "Jagged Answer", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["grinding_plates"], ["keen_edges"]],
        grantsPassive: { kind: "unshaken", value: 1 }, delta: {},
        note: "DEEP NOTABLE. The first thing to bite this gets nothing at all — no damage, no roll, no effect. Shipped primitive with exactly one user (Body Slam's Unbothered)." },
      { id: "fractured_ridge", name: "Fractured Ridge", cost: 1, prerequisites: ["jagged_answer"], leaning: "aggression",
        delta: { defensePenetration: 0.2 } },
      { id: "brittle_edge", name: "Brittle Edge", cost: 1, prerequisites: ["fractured_ridge"], leaning: "aggression",
        grantsPassive: { kind: "thornsRubble", value: 0.18 }, delta: {}, needsPrimitive: RUBBLE,
        note: "CAPSTONE. The casing cracks when struck: reflects damage AND leaves real rubble on the attacker's tile. A defensive move that terraforms by being hit." },

      // ===== Bridges =====
      { id: "cracked_but_heavy", name: "Cracked but Heavy", cost: 1, prerequisites: ["brittle_ridge", "settling_weight"], leaning: "aggression",
        grantsPassive: { kind: "bulk", value: 0.1 }, delta: {}, needsPrimitive: BULK,
        note: "CROSSLINK Aggression<->Boldness. A heavier shell breaks into heavier pieces." },
      { id: "heavier_shards", name: "Heavier Shards", cost: 1, prerequisites: ["cracked_but_heavy"], leaning: "aggression",
        grantsPassive: { kind: "bulk", value: 0.15 }, delta: {}, needsPrimitive: BULK },
      { id: "spines_out", name: "Spines Out", cost: 1, prerequisites: ["heavier_shards"], leaning: "aggression",
        grantsPassives: [{ kind: "bulk", value: 0.2 }, { kind: "thorns", value: 0.12 }], delta: {}, needsPrimitive: BULK,
        note: "BRIDGE NOTABLE. The weight itself becomes the weapon. Lands on Splinter and Rooted Stance — the two lanes about mass in motion." },

      { id: "heavy_and_still", name: "Heavy and Still", cost: 1, prerequisites: ["settling_weight", "still_as_bark"], leaning: "boldness",
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED,
        note: "CROSSLINK Boldness<->Sociability. A thing that will not move and does not register." },
      { id: "deeper_stillness", name: "Deeper Stillness", cost: 1, prerequisites: ["heavy_and_still"], leaning: "boldness",
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED },
      { id: "armored_indifference", name: "Armored Indifference", cost: 1, prerequisites: ["deeper_stillness"], leaning: "sociability",
        grantsPassives: [{ kind: "unnoticed", value: 2 }, { kind: "nonTerritorial", value: 1 }], delta: {}, needsPrimitive: UNNOTICED,
        note: "BRIDGE NOTABLE. It neither notices nor is noticed. Lands on Chrysalis and Driftwood — the two lanes about vanishing." },

      { id: "quiet_spines", name: "Quiet Spines", cost: 1, prerequisites: ["still_as_bark", "brittle_ridge"], leaning: "sociability",
        grantsPassive: { kind: "thorns", value: 0.05 }, delta: { cooldownTicks: -1 },
        note: "CROSSLINK Sociability<->Aggression. Unnoticed, and unpleasant if noticed anyway." },
      { id: "hidden_barbs", name: "Hidden Barbs", cost: 1, prerequisites: ["quiet_spines"], leaning: "sociability",
        grantsPassive: { kind: "thorns", value: 0.08 }, delta: {} },
      { id: "ambush_shell", name: "Ambush Shell", cost: 1, prerequisites: ["hidden_barbs"], leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.2 }, delta: { situationalBonuses: [{ condition: "concealed", multiplier: 1.3 }] },
        note: "BRIDGE NOTABLE. Bites hardest from cover. Lands on Scenery and Sharded Break — the two lanes about a group that hurts to touch." },
    ]),
  },

  twineedle: {
    pp: 20,
    id: "twineedle", name: "Twineedle", type: "bug", category: "physical",
    power: 25, accuracy: 100, cooldownTicks: 3, shape: { kind: "point" },
    learners: ["beedrill"],
    fantasy:
      "Two strikes, one behind the other, from a thing that is mostly needles. A Beedrill does not grapple; it commutes. It arrives, stabs twice, and is gone before you have turned around. It is a poison delivery system with wings. PILOT TREE for the two-lane shape: each branch splits into two parallel lanes with a notable in each, reconverges on a third, deeper notable, then walks one last filler to a capstone. Nothing is locked out — walking both lanes just costs the points.",
    tree: tree([
      // ================= AGGRESSION: the flurry =================
      { id: "third_needle", name: "Third Needle", cost: 1, leaning: "aggression", delta: { hitsBonus: 2 },
        note: "OPENER. Splits into a raw lane and a reserve lane." },
      // --- Lane P: raw. More needles, faster.
      { id: "quicker_draw", name: "Quicker Draw", cost: 1, prerequisites: ["third_needle"], leaning: "aggression",
        delta: { accuracy: 10 },
        note: "Was a cooldown node. A 3-tick move only has three ticks to give and the tempo bridge already claims them, so Lane P's opener steadies the flurry instead." },
      { id: "barbed", name: "Barbed", cost: 1, prerequisites: ["quicker_draw"], leaning: "aggression", delta: { statusChance: 0.1 } },
      { id: "fourth_needle", name: "Fourth Needle", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["barbed"], ["venom_mark"]],
        delta: { hitsBonus: 3 },
        note: "LANE P NOTABLE. Four independent poison rolls is a near-certainty — this lane's product is reliability. A bridge lands HERE, at the lane's own notable — skipping the filler grind, never the lane choice itself." },
      { id: "thin_point", name: "Thin Point", cost: 1, prerequisites: ["fourth_needle"], leaning: "aggression",
        delta: { defensePenetration: 0.15, lockTicks: 2 },
        note: "It commits — two ticks of follow-through it cannot abort. Aggressive movement without touching `reposition`, which the Boldness chain owns." },
      // --- Lane R: reserve. Fewer, deeper, paid for in PP.
      { id: "venom_sacs", name: "Venom Sacs", cost: 1, prerequisites: ["third_needle"], leaning: "aggression",
        delta: { maxPPBonus: 8 }, needsPrimitive: PPC,
        note: "LANE R entry. +8 on a 20 pool is +40% — worth it only if you walk this lane." },
      { id: "measured_strikes", name: "Measured Strikes", cost: 1, prerequisites: ["venom_sacs"], leaning: "aggression",
        delta: { critRateStage: 1, cooldownTicks: 1 } },
      { id: "pincushion", name: "Pincushion", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["measured_strikes"], ["blur_of_needles"]],
        delta: { statusSeverity: 3, statusChance: 0.3, defensePenetration: 0.25, ppCost: 3 }, needsPrimitive: PPC,
        note: "LANE R NOTABLE. Deliberately NOT more needles — that is Lane P's answer. Two strikes that go deep and leave venom that works." },
      { id: "conserving_draw", name: "Conserving Draw", cost: 1, prerequisites: ["pincushion"], leaning: "aggression",
        delta: { maxPPBonus: 6 }, needsPrimitive: PPC },
      // --- Convergence, one last filler, capstone.
      { id: "hollow_points", name: "Hollow Points", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["thin_point"], ["conserving_draw"]],
        delta: { statusSpreads: true, jamCooldownTicks: 10, defensePenetration: 0.2 },
        note: "DEEP NOTABLE. Both lanes end here. Deliberately NOT a shape change — Sociability owns this move's footprint, and two branches quietly fighting over `shape` is how a build ends up with whichever the engine reached last. Hollow needles carry more venom, deeper." },
      { id: "hollowed_shafts", name: "Hollowed Shafts", cost: 1, prerequisites: ["hollow_points"], leaning: "aggression",
        delta: { defensePenetration: 0.2 } },
      { id: "empty_the_sacs", name: "Empty the Sacs", cost: 1, prerequisites: ["hollowed_shafts"], leaning: "aggression",
        delta: { hitsBonus: 5, statusSeverity: 4, ppCost: 5 }, needsPrimitive: PPC,
        note: "CAPSTONE. The deferred Nx-PP lever, finally at the tier it belongs: five PP in one use for everything the Beedrill has. On the base pool that is four uses; on a full reserve build, six." },

      // ================= BOLDNESS: the drive-by =================
      { id: "hit_and_gone", name: "Hit and Gone", cost: 1, leaning: "boldness",
        delta: { reposition: { mover: "attacker", to: "back", tiles: 2, timing: "onHit" } },
        note: "OPENER. Splits into a low close lane and a high wide one." },
      // --- Lane L: low and close.
      { id: "wide_approach", name: "Wide Approach", cost: 1, prerequisites: ["hit_and_gone"], leaning: "boldness", delta: { rangeBonus: 1 } },
      { id: "blindside", name: "Blindside", cost: 1, prerequisites: ["wide_approach"], leaning: "boldness",
        delta: { situationalBonuses: [{ condition: "flanking", multiplier: 1.3 }] } },
      { id: "never_landed", name: "Never Landed", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["blindside"], ["blur_of_needles"]],
        delta: { reposition: { mover: "attacker", to: "back", tiles: 3, timing: "onHit" }, critRateStage: 1 },
        note: "LANE L NOTABLE. Three tiles of daylight between the sting and the retaliation." },
      { id: "wingbeat", name: "Wingbeat", cost: 1, prerequisites: ["never_landed"], leaning: "boldness", delta: { critRateStage: 1 } },
      // --- Lane H: high and wide.
      { id: "circling_high", name: "Circling High", cost: 1, prerequisites: ["hit_and_gone"], leaning: "boldness", delta: { rangeBonus: 2 } },
      { id: "wing_shear", name: "Wing Shear", cost: 1, prerequisites: ["circling_high"], leaning: "boldness", delta: { jamCooldownTicks: 8 } },
      { id: "high_pass", name: "High Pass", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["wing_shear"], ["ambush_hive"]],
        delta: { rangeBonus: 3, hitsBonus: 2, power: -6 },
        note: "LANE H NOTABLE. Three strafing passes from out of reach instead of one committed dive." },
      { id: "gliding", name: "Gliding", cost: 1, prerequisites: ["high_pass"], leaning: "boldness",
        delta: { accuracy: 10, rangeBonus: 1 },
        note: "Was a cooldown node. On a 3-tick move the tree already spent every tick it had, so this buys reach instead — the thing Lane H is actually about." },
      // --- Convergence, filler, capstone.
      { id: "gone_before_it_turns", name: "Gone Before It Turns", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["wingbeat"], ["gliding"]],
        delta: { critCooldownReset: true, jamCooldownTicks: 10 },
        note: "DEEP NOTABLE. It is still turning around when the next pass lands, and its own moves are still on cooldown." },
      { id: "dead_reckoning", name: "Dead Reckoning", cost: 1, prerequisites: ["gone_before_it_turns"], leaning: "boldness",
        delta: { accuracy: 15 } },
      { id: "never_there", name: "Never There", cost: 1, prerequisites: ["dead_reckoning"], leaning: "boldness",
        grantsPassive: { kind: "unshaken", value: 1 },
        delta: { reposition: { mover: "attacker", to: "back", tiles: 4, timing: "onHit" } },
        note: "CAPSTONE. The first thing to reach it in a fight simply does not connect. `unshaken` is shipped with exactly one user in the whole roster." },

      // ================= SOCIABILITY: the hive =================
      { id: "swarm_signal", name: "Swarm Signal", cost: 1, leaning: "sociability", delta: { rallyCallTicks: 60 },
        note: "OPENER. Splits into a marking lane and a sustaining lane." },
      // --- Lane M: the mark.
      { id: "hive_tempo", name: "Hive Tempo", cost: 1, prerequisites: ["swarm_signal"], leaning: "sociability",
        delta: { rallyCallTicks: 40 },
        note: "Was a cooldown node. Lane M is the marking lane — a longer mark is what it should have been buying." },
      { id: "shared_venom", name: "Shared Venom", cost: 1, prerequisites: ["hive_tempo"], leaning: "sociability", delta: { statusSpreads: true } },
      { id: "converge", name: "Converge", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["shared_venom"], ["ambush_hive"]],
        delta: { rallyCallTicks: 120, allyEffectOnAttack: true, allyEffects: [{ buff: { stat: "speed", stage: 1, ticks: 40 } }] },
        note: "LANE M NOTABLE. The mark lasts twice as long and every nearby hive-mate gets faster on the way in." },
      { id: "no_stragglers", name: "No Stragglers", cost: 1, prerequisites: ["converge"], leaning: "sociability", delta: { jamCooldownTicks: 8 } },
      // --- Lane S: sustain the swarm.
      { id: "tending_drones", name: "Tending Drones", cost: 1, prerequisites: ["swarm_signal"], leaning: "sociability",
        delta: { targetsAlly: true, allyEffects: [{ healFraction: 0.12 }] } },
      { id: "close_formation", name: "Close Formation", cost: 1, prerequisites: ["tending_drones"], leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.008 }, delta: {} },
      { id: "drone_relay", name: "Drone Relay", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["close_formation"], ["venom_mark"]],
        grantsPassive: { kind: "healAura", value: 0.012 },
        delta: { targetsAlly: true, allyEffects: [{ healFraction: 0.18, buff: { stat: "attack", stage: 1, ticks: 40 } }] },
        note: "LANE S NOTABLE. No mark at all — the hive does not converge, it sustains." },
      { id: "one_mind", name: "One Mind", cost: 1, prerequisites: ["drone_relay"], leaning: "sociability",
        delta: { positionSwap: true, positionSwapPull: 1 },
        note: "Drones trade places mid-flurry. Shipped primitive, one user in the whole roster (Peck's Snatch and Swap)." },
      // --- Convergence, filler, capstone.
      { id: "nothing_forgets", name: "Nothing Forgets", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["no_stragglers"], ["one_mind"]],
        delta: { shape: { kind: "burst" }, areaBonus: 1, statusSpreads: true, power: -8 },
        note: "DEEP NOTABLE. Both lanes end here. The swarm stops being individuals and arrives as a cloud." },
      { id: "hive_memory", name: "Hive Memory", cost: 1, prerequisites: ["nothing_forgets"], leaning: "sociability",
        delta: { rallyCallTicks: 200 } },
      { id: "the_swarm_decides", name: "The Swarm Decides", cost: 1, prerequisites: ["hive_memory"], leaning: "sociability",
        delta: { excludesAllies: true, areaBonus: 1 },
        note: "CAPSTONE. A cloud twice as wide that no longer stings its own. `excludesAllies` is the one Sociability flavour NO proposed branch used — this tree's own audit flagged it, and a hive-wide AoE is exactly where it belongs." },

      // ================= Bridges — landing deep, at the lane notables =================
      { id: "quick_and_many", name: "Quick and Many", cost: 1, prerequisites: ["third_needle", "hit_and_gone"], leaning: "aggression",
        delta: { cooldownTicks: -1 },
        note: "CROSSLINK Aggression<->Boldness. More passes per minute, because each one ends somewhere safe." },
      { id: "faster_pass", name: "Faster Pass", cost: 1, prerequisites: ["quick_and_many"], leaning: "aggression", delta: { cooldownTicks: -1 } },
      { id: "blur_of_needles", name: "Blur of Needles", cost: 1, prerequisites: ["faster_pass"], leaning: "aggression",
        delta: { hitsBonus: 3 },
        note: "BRIDGE NOTABLE. Escalates its own tempo lever, and lands you at ONE lane notable per branch — Pincushion in Aggression, Never Landed in Boldness. Note it COMPLEMENTS rather than matches: a tempo bridge dropping into the slow, measured reserve lane is the tempo that lane otherwise lacks. Matching a bridge to the lane that already shares its identity just deepens a rut." },

      { id: "called_from_cover", name: "Called from Cover", cost: 1, prerequisites: ["hit_and_gone", "swarm_signal"], leaning: "boldness",
        delta: { situationalBonuses: [{ condition: "concealed", multiplier: 1.25 }] },
        note: "CROSSLINK Boldness<->Sociability." },
      { id: "deeper_cover", name: "Deeper Cover", cost: 1, prerequisites: ["called_from_cover"], leaning: "boldness",
        delta: { situationalBonuses: [{ condition: "concealed", multiplier: 1.4 }] } },
      { id: "ambush_hive", name: "Ambush Hive", cost: 1, prerequisites: ["deeper_cover"], leaning: "sociability",
        delta: { situationalBonuses: [{ condition: "concealed", multiplier: 1.7 }], rallyCallTicks: 90 },
        note: "BRIDGE NOTABLE. The mark it sets comes from somewhere nothing was looking. The ambush bridge joins the two patient, high lanes: High Pass in Boldness, Converge in Sociability." },

      { id: "marked_and_barbed", name: "Marked and Barbed", cost: 1, prerequisites: ["swarm_signal", "third_needle"], leaning: "sociability",
        delta: { statusChance: 0.1 },
        note: "CROSSLINK Sociability<->Aggression. The mark and the venom are the same act." },
      { id: "deeper_marking", name: "Deeper Marking", cost: 1, prerequisites: ["marked_and_barbed"], leaning: "sociability", delta: { statusChance: 0.15 } },
      { id: "venom_mark", name: "Venom Mark", cost: 1, prerequisites: ["deeper_marking"], leaning: "aggression",
        delta: { statusChance: 0.2, statusSpreads: true },
        note: "BRIDGE NOTABLE. Its venom-reliability lever escalated until the mark spreads with it, and it lands on Fourth Needle — four needles each carrying venom that actually holds. Complement, not match." },
    ]),
  },

  poison_sting: {
    pp: 35,
    id: "poison_sting", name: "Poison Sting", type: "poison", category: "physical",
    power: 15, accuracy: 100, cooldownTicks: 2, shape: { kind: "point" },
    learners: ["ekans", "arbok", "weedle", "zubat", "golbat"],
    fantasy:
      "A wound too small to matter, and then it matters. The sting is not the point; the sting is delivery. Nothing that uses this move expects the hit to end anything — it expects to be somewhere else when it ends. Status-first on purpose: for this move the venom IS the fantasy, where Ice Beam's is the beam.",
    tree: tree([
      // ===== BOLDNESS: the wound that waits. Starve it, or wilt it.
      { id: "slow_working", name: "Slow-Working", cost: 1, leaning: "boldness", delta: { statusSeverity: 1.3 },
        note: "OPENER. Splits into venom that starves and venom that simply works fast." },
      { id: "thin_blood", name: "Thin Blood", cost: 1, prerequisites: ["slow_working"], leaning: "boldness", delta: { statusSeverity: 1.5 } },
      { id: "creeping_dose", name: "Creeping Dose", cost: 1, prerequisites: ["thin_blood"], leaning: "boldness", delta: { statusChance: 0.15 } },
      { id: "sickened", name: "Sickened", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["creeping_dose"], ["thickened_blood"]],
        delta: { statusNeedsInterference: { hunger: 0.5, thirst: 0.5 } }, needsPrimitive: NEEDS,
        note: "LANE W NOTABLE, and the best idea in this tree. A poisoned agent recovers hunger and thirst at half rate. The payoff of poisoning something is not that it takes damage — it is that it STARVES. Legible in the chronicle, and it makes this a predator that wounds and waits." },
      { id: "no_appetite", name: "No Appetite", cost: 1, prerequisites: ["sickened"], leaning: "boldness",
        delta: { statusNeedsInterference: { hunger: 0.25 } }, needsPrimitive: NEEDS },
      { id: "quick_onset", name: "Quick Onset", cost: 1, prerequisites: ["slow_working"], leaning: "boldness",
        delta: { statusSeverity: 1.8 },
        note: "LANE F entry. Starve it slowly, or hurt it now." },
      { id: "patient", name: "Patient", cost: 1, prerequisites: ["quick_onset"], leaning: "boldness",
        delta: { reposition: { mover: "attacker", to: "back", tiles: 1, timing: "onHit" } } },
      { id: "quick_wilt", name: "Quick Wilt", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["patient"], ["the_starving_one"]],
        delta: { statusSeverity: 3, statusChance: 0.2, lifestealFraction: 0.15 },
        note: "LANE F NOTABLE. A venom that does its whole work now, at full strength, instead of over an afternoon — and feeds on it." },
      { id: "wasting", name: "Wasting", cost: 1, prerequisites: ["quick_wilt"], leaning: "boldness",
        delta: { situationalBonuses: [{ condition: "targetStatused", multiplier: 1.4 }] } },
      { id: "let_it_work", name: "Let It Work", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["no_appetite"], ["wasting"]],
        delta: { statusNeedsInterference: { hunger: 0.5, thirst: 0.5, regen: 1 } }, needsPrimitive: NEEDS,
        note: "DEEP NOTABLE. Eating, drinking and passive healing all shut down. Nothing it stings dies in front of it." },
      { id: "long_odds", name: "Long Odds", cost: 1, prerequisites: ["let_it_work"], leaning: "boldness",
        delta: { maxPPBonus: 12 }, needsPrimitive: PPC },
      { id: "nothing_recovers", name: "Nothing Recovers", cost: 1, prerequisites: ["long_odds"], leaning: "boldness",
        delta: { statusSpreads: true, statusSeverity: 2.5, rallyCallTicks: 300, ppCost: 3 }, needsPrimitive: PPC,
        note: "CAPSTONE. Not a deeper dose — a wider one. The wasting spreads to whatever the starving thing staggers into, and the whole nest knows where it went. Things it stung die later, elsewhere, of something that looks like hunger." },

      // ===== AGGRESSION: deeper venom. Volume, or a dry bite.
      { id: "double_dose", name: "Double Dose", cost: 1, leaning: "aggression", delta: { hitsBonus: 1 },
        note: "OPENER. Splits into more venom and no venom at all." },
      { id: "quick_fangs", name: "Quick Fangs", cost: 1, prerequisites: ["double_dose"], leaning: "aggression",
        delta: { cooldownTicks: -1, maxPPBonus: 12 }, needsPrimitive: PPC },
      { id: "deep_stick", name: "Deep Stick", cost: 1, prerequisites: ["quick_fangs"], leaning: "aggression", delta: { defensePenetration: 0.2 } },
      { id: "venom_glut", name: "Venom Glut", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["deep_stick"], ["everyone_bites"]],
        delta: { statusChance: 0.25, selfCostPerUse: { need: "energy", amount: 0.02 }, ppCost: 2 }, needsPrimitive: PPC,
        note: "LANE V NOTABLE. The first node in the roster to cost BOTH a need and PP — venom is a consumable twice over." },
      { id: "finisher", name: "Finisher", cost: 1, prerequisites: ["venom_glut"], leaning: "aggression",
        delta: { situationalBonuses: [{ condition: "targetStatused", multiplier: 1.4 }] } },
      { id: "dry_bite", name: "Dry Bite", cost: 1, prerequisites: ["double_dose"], leaning: "aggression",
        delta: { power: 25, statusChance: -0.2 },
        note: "LANE D entry. Spends no venom at all and simply bites through. The one line in this tree that abandons its own premise, deliberately." },
      { id: "hunters_patience", name: "Hunter's Patience", cost: 1, prerequisites: ["dry_bite"], leaning: "aggression", delta: { critRateStage: 1 } },
      { id: "run_it_down", name: "Run It Down", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["hunters_patience"], ["thickened_blood"]],
        delta: { situationalBonuses: [{ condition: "targetLowHp", multiplier: 1.6 }], defensePenetration: 0.3 },
        note: "LANE D NOTABLE. Follows the thing until it drops, on teeth alone." },
      { id: "bled_out", name: "Bled Out", cost: 1, prerequisites: ["run_it_down"], leaning: "aggression",
        delta: { critCooldownReset: true } },
      { id: "nothing_walks_away", name: "Nothing Walks Away", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["finisher"], ["bled_out"]],
        delta: { jamCooldownTicks: 10, lifestealFraction: 0.25 },
        note: "DEEP NOTABLE. Both lanes end at the same place: whatever it caught does not leave." },
      { id: "second_stomach", name: "Second Stomach", cost: 1, prerequisites: ["nothing_walks_away"], leaning: "aggression",
        grantsPassive: { kind: "regenFlat", value: 2 }, delta: {} },
      { id: "the_long_meal", name: "The Long Meal", cost: 1, prerequisites: ["second_stomach"], leaning: "aggression",
        delta: { lifestealFraction: 0.4, situationalBonuses: [{ condition: "targetLowHp", multiplier: 2 }], ppCost: 3 }, needsPrimitive: PPC,
        note: "CAPSTONE. It does not hunt again for a long time after this, and it does not need to." },

      // ===== SOCIABILITY: the shared kill. Track it, or feed on it.
      { id: "scent_trail", name: "Scent Trail", cost: 1, leaning: "sociability", delta: { rallyCallTicks: 80 },
        note: "OPENER. Poison is a tracking mechanism as much as a weapon. Splits into marking and into feeding the nest." },
      { id: "close_behind", name: "Close Behind", cost: 1, prerequisites: ["scent_trail"], leaning: "sociability",
        delta: { allyEffectOnAttack: true, allyEffects: [{ buff: { stat: "speed", stage: 1, ticks: 40 } }] } },
      { id: "it_spreads", name: "It Spreads", cost: 1, prerequisites: ["close_behind"], leaning: "sociability", delta: { statusSpreads: true } },
      { id: "nothing_leaves", name: "Nothing Leaves", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["it_spreads"], ["the_starving_one"]],
        grantsPassive: { kind: "nonTerritorial", value: 1 },
        delta: { rallyCallTicks: 200, jamCooldownTicks: 10 },
        note: "LANE T NOTABLE. Marked, slowed and surrounded — a territory nothing wounded walks out of. The nest itself picks no fights it did not start with venom, which is what makes the boundary legible." },
      { id: "long_patrol", name: "Long Patrol", cost: 1, prerequisites: ["nothing_leaves"], leaning: "sociability",
        grantsPassive: { kind: "regenFlat", value: 1.5 }, delta: { rangeBonus: 1 } },
      { id: "the_nest_eats", name: "The Nest Eats", cost: 1, prerequisites: ["scent_trail"], leaning: "sociability",
        delta: { targetsAlly: true, allyEffects: [{ healFraction: 0.08 }] },
        note: "LANE N entry. What the venom takes out of one thing goes back into the nest." },
      { id: "close_nest", name: "Close Nest", cost: 1, prerequisites: ["the_nest_eats"], leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.01 }, delta: {} },
      { id: "the_relay", name: "The Relay", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["close_nest"], ["everyone_bites"]],
        delta: { targetsAlly: true, allyEffects: [{ healFraction: 0.2, buff: { stat: "speed", stage: 2, ticks: 60 } }], allyEffectOnAttack: true },
        note: "LANE N NOTABLE. Let it run. Whoever is freshest takes the next leg." },
      { id: "shared_table", name: "Shared Table", cost: 1, prerequisites: ["the_relay"], leaning: "sociability",
        delta: { gatherBurst: 3 } },
      { id: "circling_nest", name: "Circling Nest", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["long_patrol"], ["shared_table"]],
        delta: { rallyCallTicks: 260, statusSpreads: true },
        note: "DEEP NOTABLE. Both lanes end here: a mark the whole nest keeps, and venom that travels with it." },
      { id: "old_ground_ps", name: "Old Ground", cost: 1, prerequisites: ["circling_nest"], leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.2 }, delta: {} },
      { id: "the_nest_decides", name: "The Nest Decides", cost: 1, prerequisites: ["old_ground_ps"], leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.015 },
        delta: { shape: { kind: "burst" }, areaBonus: 1, excludesAllies: true },
        note: "CAPSTONE. A cloud of venom the nest is immune to. `excludesAllies` was the one Sociability flavour no draft used." },

      // ===== Bridges =====
      { id: "thick_and_deep", name: "Thick and Deep", cost: 1, prerequisites: ["double_dose", "slow_working"], leaning: "aggression",
        delta: { statusSeverity: 1.4 },
        note: "CROSSLINK Aggression<->Boldness." },
      { id: "thicker_venom", name: "Thicker Venom", cost: 1, prerequisites: ["thick_and_deep"], leaning: "aggression", delta: { statusSeverity: 1.6 } },
      { id: "thickened_blood", name: "Thickened Blood", cost: 1, prerequisites: ["thicker_venom"], leaning: "boldness",
        delta: { statusSeverity: 2.2, statusChance: 0.15 },
        note: "BRIDGE NOTABLE. Escalates its own severity lever. Lands on Sickened and Venom Glut — the two lanes that are actually about venom." },

      { id: "marked_and_sick", name: "Marked and Sick", cost: 1, prerequisites: ["slow_working", "scent_trail"], leaning: "boldness",
        delta: { rallyCallTicks: 100 },
        note: "CROSSLINK Boldness<->Sociability. The starving one is the one everybody follows." },
      { id: "longer_mark", name: "Longer Mark", cost: 1, prerequisites: ["marked_and_sick"], leaning: "boldness", delta: { rallyCallTicks: 140 } },
      { id: "the_starving_one", name: "The Starving One", cost: 1, prerequisites: ["longer_mark"], leaning: "sociability",
        delta: { rallyCallTicks: 220, situationalBonuses: [{ condition: "targetStatused", multiplier: 1.5 }] },
        note: "BRIDGE NOTABLE. The mark now lasts as long as the venom does. Lands on Quick Wilt and Nothing Leaves." },

      { id: "pack_dosage", name: "Pack Dosage", cost: 1, prerequisites: ["scent_trail", "double_dose"], leaning: "sociability",
        delta: { statusChance: 0.12 },
        note: "CROSSLINK Sociability<->Aggression." },
      { id: "shared_dosage", name: "Shared Dosage", cost: 1, prerequisites: ["pack_dosage"], leaning: "sociability", delta: { statusChance: 0.15 } },
      { id: "everyone_bites", name: "Everyone Bites", cost: 1, prerequisites: ["shared_dosage"], leaning: "aggression",
        delta: { statusChance: 0.2, statusSpreads: true },
        note: "BRIDGE NOTABLE. One bite indistinguishable from the nest's. Lands on Run It Down and The Relay — the two lanes about the chase." },
    ]),
  },

  growth: {
    pp: 20,
    id: "growth", name: "Growth", type: "normal", category: "status",
    power: 0, accuracy: 100, cooldownTicks: 30, shape: { kind: "point" },
    learners: ["bulbasaur", "ivysaur", "venusaur", "oddish", "gloom"],
    fantasy:
      "Growth is the only move in the roster whose target is the ground. An Oddish standing still and enriching the dirt under itself is not preparing for a fight — it is farming. Over a long enough run a patch of Oddish does not defend a zone, it MAKES one: soil, then flora, then a food supply that outlives whichever Oddish planted it. This tree deliberately has NO combat branch — a first for this roster.",
    tree: tree([
      // ===== BOLDNESS: deep roots. Rich soil, or hard ground.
      { id: "deep_roots", name: "Deep Roots", cost: 1, leaning: "boldness", delta: { fertilityBoost: { amount: 0.45, radius: 0 } },
        note: "OPENER. Splits into soil that feeds and ground that holds." },
      { id: "patient_soil", name: "Patient Soil", cost: 1, prerequisites: ["deep_roots"], leaning: "boldness",
        grantsPassive: { kind: "immovable", value: 1 }, delta: { cooldownTicks: -6, maxPPBonus: 10 }, needsPrimitive: PPC },
      { id: "humus", name: "Humus", cost: 1, prerequisites: ["patient_soil"], leaning: "boldness",
        delta: { fertilityBoost: { amount: 0.6, radius: 0 } } },
      { id: "old_ground", name: "Old Ground", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["humus"], ["black_earth"]],
        delta: { fertilityCeilingBoost: 0.25 }, needsPrimitive: CEILING,
        note: "LANE R NOTABLE. Ground an Oddish worked stays richer after it dies — the first node in the game whose effect outlives its holder. Note the honest shape: fertility already regenerates toward a per-ground-type ceiling, so this raises the ceiling rather than freezing decay." },
      { id: "seedbed", name: "Seedbed", cost: 1, prerequisites: ["old_ground"], leaning: "boldness",
        delta: { floraRegrowthMultiplier: 1.4 }, needsPrimitive: "Local flora regrowth-rate modifier (flora.ts)" },
      { id: "hardpan", name: "Hardpan", cost: 1, prerequisites: ["deep_roots"], leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.08 }, delta: {},
        note: "LANE H entry. Ground packed hard enough to stand on rather than grow in." },
      { id: "terraced", name: "Terraced", cost: 1, prerequisites: ["hardpan"], leaning: "boldness",
        grantsPassive: { kind: "healAura", value: 0.01 }, delta: { cooldownTicks: -7 } },
      { id: "worked_ground", name: "Worked Ground", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["terraced"], ["the_standing_crop"]],
        grantsPassive: { kind: "defenseBoost", value: 1 },
        delta: { statChangesOnHit: [{ target: "self", stat: "defense", stage: 1, ticks: 120 }] },
        note: "LANE H NOTABLE. A very long, very small guard — duration as the payoff, not magnitude. You are part of the terrain now." },
      { id: "deep_loam", name: "Deep Loam", cost: 1, prerequisites: ["worked_ground"], leaning: "boldness",
        delta: { fertilityBoost: { amount: 0.5, radius: 1 } } },
      { id: "it_takes", name: "It Takes", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["seedbed"], ["deep_loam"]],
        delta: { createsTerrain: { terrain: "bush", chance: 0.35, at: "self" }, ppCost: 4 }, needsPrimitive: TERRAIN_SELF + "; " + PPC,
        note: "DEEP NOTABLE. A bush where there was none. 4 PP on a 20 pool — five bushes in a lifetime unless the tree buys headroom, which is exactly the weight planting a thing should carry." },
      { id: "windbreak", name: "Windbreak", cost: 1, prerequisites: ["it_takes"], leaning: "boldness",
        grantsPassive: { kind: "regenFlat", value: 1.5 }, delta: {} },
      { id: "the_orchard", name: "The Orchard", cost: 1, prerequisites: ["windbreak"], leaning: "boldness",
        delta: { createsTerrain: { terrain: "tree", chance: 0.2, at: "self" }, lockTicks: 4 }, needsPrimitive: TERRAIN_SELF,
        note: "CAPSTONE. Trees, eventually — and growing one takes real, immobile commitment. The slowest payoff in the roster and the only one measured in centuries of sim-time." },

      // ===== AGGRESSION: spread. Outward, or exclusive.
      { id: "creeping_edge", name: "Creeping Edge", cost: 1, leaning: "aggression", delta: { fertilityBoost: { amount: 0.3, radius: 1 } },
        note: "OPENER. Splits into ground taken wide and ground taken for one species only." },
      { id: "quicker_season", name: "Quicker Season", cost: 1, prerequisites: ["creeping_edge"], leaning: "aggression",
        delta: { cooldownTicks: -7, gatherBurst: 2 },
        note: "The patch it just enriched can be stripped immediately." },
      { id: "spreading", name: "Spreading", cost: 1, prerequisites: ["quicker_season"], leaning: "aggression",
        delta: { fertilityBoost: { amount: 0.3, radius: 2 } } },
      { id: "thicket", name: "Thicket", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["spreading"], ["feast"]],
        delta: { fertilityBoost: { amount: 0.35, radius: 3 }, shape: { kind: "burst" }, areaBonus: 3 },
        note: "LANE W NOTABLE. A real patch, not a tile — and the growth itself is now an area event." },
      { id: "root_war", name: "Root War", cost: 1, prerequisites: ["thicket"], leaning: "aggression",
        delta: { reposition: { mover: "defender", to: "shoved", tiles: 1, timing: "onHit" } },
        note: "Ground going over to bramble physically shoves whatever was standing on it off." },
      { id: "spore_reserve", name: "Spore Reserve", cost: 1, prerequisites: ["creeping_edge"], leaning: "aggression",
        delta: { maxPPBonus: 10 }, needsPrimitive: PPC,
        note: "LANE E entry. The reserve to plant twice as much. On a 20 pool with It Takes at 4/use, two more bushes in a lifetime." },
      { id: "choking_out", name: "Choking Out", cost: 1, prerequisites: ["spore_reserve"], leaning: "aggression",
        delta: { floraCompetition: 0.3 }, needsPrimitive: "Flora yield weighted by the forager's type (flora.ts harvest path)" },
      { id: "monoculture", name: "Monoculture", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["choking_out"], ["black_earth"]],
        delta: { floraCompetition: 0.7, fertilityBoost: { amount: 0.5, radius: 3 } },
        needsPrimitive: "Flora yield weighted by the forager's type",
        note: "LANE E NOTABLE. One enormously rich patch that only its planter can really eat from." },
      { id: "the_verge", name: "The Verge", cost: 1, prerequisites: ["monoculture"], leaning: "aggression",
        delta: { drainNeeds: { need: "energy", amount: 0.02 } },
        note: "The advancing bramble saps whatever is caught in it. drainNeeds is shipped with six users and no move has ever used it as a weapon." },
      { id: "overrun", name: "Overrun", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["root_war"], ["the_verge"]],
        delta: { createsTerrain: { terrain: "bush", chance: 0.2, at: "self", radius: 2 } }, needsPrimitive: TERRAIN_SELF,
        note: "DEEP NOTABLE. The zone slowly becomes Grass-type ground whether anything else wanted that or not." },
      { id: "seed_rain", name: "Seed Rain", cost: 1, prerequisites: ["overrun"], leaning: "aggression",
        delta: { floraRegrowthMultiplier: 1.5 }, needsPrimitive: "Local flora regrowth-rate modifier" },
      { id: "it_was_all_grass", name: "It Was All Grass", cost: 1, prerequisites: ["seed_rain"], leaning: "aggression",
        delta: { createsTerrain: { terrain: "bush", chance: 0.3, at: "self", radius: 3 }, ppCost: 3 },
        needsPrimitive: TERRAIN_SELF + "; " + PPC,
        note: "CAPSTONE. Aggression on a farming move is conquest by vegetation." },

      // ===== SOCIABILITY: feeding the herd. Settle, or share.
      { id: "shared_plot", name: "Shared Plot", cost: 1, leaning: "sociability", delta: { targetsAlly: true, allyEffects: [{ healFraction: 0.05 }] },
        note: "OPENER. Splits into a herd that settles and ground open to everyone." },
      { id: "good_year", name: "Good Year", cost: 1, prerequisites: ["shared_plot"], leaning: "sociability",
        delta: { fertilityBoost: { amount: 0.35, radius: 1 } } },
      { id: "grazing_ground", name: "Grazing Ground", cost: 1, prerequisites: ["good_year"], leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.008 }, delta: {} },
      { id: "the_patch", name: "The Patch", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["grazing_ground"], ["the_standing_crop"]],
        delta: { herdForageBonus: 0.3 }, needsPrimitive: FORAGE,
        note: "LANE S NOTABLE. The whole herd eats better on ground this Oddish worked. A skill node that shows up as a population curve." },
      { id: "settle_here", name: "Settle Here", cost: 1, prerequisites: ["the_patch"], leaning: "sociability",
        delta: { herdMigrationResistance: 0.4 }, needsPrimitive: MIGRATE,
        note: "A herd with a real farm stops wanting to leave. Directly touches herdMigration.ts's scarcity trigger." },
      { id: "open_field", name: "Open Field", cost: 1, prerequisites: ["shared_plot"], leaning: "sociability",
        delta: { fertilityBoost: { amount: 0.4, radius: 4 } },
        note: "LANE C entry. A patch wide enough that a herd never has to stop moving to use it." },
      { id: "common_ground", name: "Common Ground", cost: 1, prerequisites: ["open_field"], leaning: "sociability",
        delta: { gatherBurst: 3 } },
      { id: "the_commons", name: "The Commons", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["common_ground"], ["feast"]],
        grantsPassive: { kind: "calmingPresence", value: 0.3 },
        delta: { fertilityBoost: { amount: 0.5, radius: 3 } },
        note: "LANE C NOTABLE. Ground good enough that other herds settle beside yours instead of contesting it — calmingPresence is deliberately NOT herd-scoped, which is exactly what a commons needs." },
      { id: "granary", name: "Granary", cost: 1, prerequisites: ["the_commons"], leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.012 }, delta: {} },
      { id: "homestead", name: "Homestead", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["settle_here"], ["granary"]],
        delta: { herdMigrationResistance: 0.6, fertilityCeilingBoost: 0.5 }, needsPrimitive: MIGRATE,
        note: "DEEP NOTABLE. The herd stops migrating because it built something. The most un-combat deep node in the roster." },
      { id: "root_cellar", name: "Root Cellar", cost: 1, prerequisites: ["homestead"], leaning: "sociability",
        delta: { createsTerrain: { terrain: "bush", chance: 0.4, at: "self" } }, needsPrimitive: TERRAIN_SELF },
      { id: "nobody_leaves", name: "Nobody Leaves", cost: 1, prerequisites: ["root_cellar"], leaning: "sociability",
        delta: { herdForageBonus: 0.5, floraRegrowthMultiplier: 1.6 }, needsPrimitive: FORAGE,
        note: "CAPSTONE. A herd that has solved food. Whether that is good for the sim is a real open question — a zone that never empties is also a zone that never turns over. Flagged, not resolved." },

      // ===== Bridges =====
      { id: "rich_and_wide", name: "Rich and Wide", cost: 1, prerequisites: ["deep_roots", "creeping_edge"], leaning: "boldness",
        delta: { fertilityBoost: { amount: 0.35, radius: 1 } },
        note: "CROSSLINK Boldness<->Aggression." },
      { id: "richer_still", name: "Richer Still", cost: 1, prerequisites: ["rich_and_wide"], leaning: "boldness",
        delta: { fertilityBoost: { amount: 0.5, radius: 2 } } },
      { id: "black_earth", name: "Black Earth", cost: 1, prerequisites: ["richer_still"], leaning: "aggression",
        delta: { fertilityBoost: { amount: 0.8, radius: 2 } },
        note: "BRIDGE NOTABLE. Depth and width at once, which neither branch reaches alone. Lands on Old Ground and Thicket — the two lanes about rich soil." },

      { id: "long_harvest", name: "Long Harvest", cost: 1, prerequisites: ["deep_roots", "shared_plot"], leaning: "boldness",
        delta: { floraRegrowthMultiplier: 1.25 }, needsPrimitive: "Local flora regrowth-rate modifier",
        note: "CROSSLINK Boldness<->Sociability. Ground that keeps producing while the herd keeps eating." },
      { id: "longer_harvest", name: "Longer Harvest", cost: 1, prerequisites: ["long_harvest"], leaning: "boldness",
        delta: { floraRegrowthMultiplier: 1.4 }, needsPrimitive: "Local flora regrowth-rate modifier" },
      { id: "the_standing_crop", name: "The Standing Crop", cost: 1, prerequisites: ["longer_harvest"], leaning: "sociability",
        delta: { floraRegrowthMultiplier: 1.8 }, needsPrimitive: "Local flora regrowth-rate modifier",
        note: "BRIDGE NOTABLE. Its own regrowth lever pushed until the patch outgrows what a herd can strip. Lands on Worked Ground and The Patch." },

      { id: "wide_table", name: "Wide Table", cost: 1, prerequisites: ["creeping_edge", "shared_plot"], leaning: "aggression",
        grantsPassive: { kind: "healAura", value: 0.006 }, delta: {},
        note: "CROSSLINK Aggression<->Sociability. A patch wide enough that everyone standing in it is fed." },
      { id: "fuller_table", name: "Fuller Table", cost: 1, prerequisites: ["wide_table"], leaning: "aggression",
        grantsPassive: { kind: "healAura", value: 0.008 }, delta: {} },
      { id: "feast", name: "Feast", cost: 1, prerequisites: ["fuller_table"], leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.015 }, delta: { fertilityBoost: { amount: 0.3, radius: 3 } },
        note: "BRIDGE NOTABLE. Its feeding-aura lever escalated across the whole patch it planted. Lands on Monoculture and The Commons — the two lanes about who gets to eat." },
    ]),
  },

  agility: {
    pp: 30,
    id: "agility", name: "Agility", type: "psychic", category: "status",
    power: 0, accuracy: 100, cooldownTicks: 50, shape: { kind: "point" },
    learners: ["scyther", "sandshrew", "growlithe", "horsea", "seadra", "beedrill", "ponyta", "rapidash"],
    fantasy:
      "Agility is not a combat move and never has been. It is the difference between a herd that reaches the next zone and a herd that dies partway across the mud. Eight species learn it and none of them get anything from it today. Its real subject is the world map, not the fight.",
    tree: tree([
      // ===== BOLDNESS: ground. Ignore it, or go through it.
      { id: "sure_footing", name: "Sure Footing", cost: 1, leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.3 }, delta: {}, needsPrimitive: UNHINDERED,
        note: "OPENER. The first node in the roster whose payoff is measured in tiles crossed, not damage. Splits into distance covered and ground reshaped." },
      { id: "longer_stride", name: "Longer Stride", cost: 1, prerequisites: ["sure_footing"], leaning: "boldness",
        delta: { statChangesOnHit: [{ target: "self", stat: "speed", stage: 2, ticks: 70 }], rangeBonus: 1 } },
      { id: "water_legs", name: "Water Legs", cost: 1, prerequisites: ["longer_stride"], leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.35 }, delta: {}, needsPrimitive: UNHINDERED },
      { id: "overland", name: "Overland", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["water_legs"], ["downhill_run"]],
        grantsPassive: { kind: "dispersalSpeed", value: 0.5 }, delta: {}, needsPrimitive: DISPERSAL,
        note: "LANE D NOTABLE. A herd carrying this crosses to the next zone in half the time — and the crossing is where herds currently die." },
      { id: "long_wind", name: "Long Wind", cost: 1, prerequisites: ["overland"], leaning: "boldness",
        grantsPassive: { kind: "regen", value: 0.02 },
        delta: { statChangesOnHit: [{ target: "self", stat: "speed", stage: 2, ticks: 160 }] } },
      { id: "no_bad_ground", name: "No Bad Ground", cost: 1, prerequisites: ["sure_footing"], leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.35 },
        delta: { selfStateBonus: "selfLowHp" }, needsPrimitive: UNHINDERED,
        note: "LANE P entry. Something running for its life crosses ground it would never otherwise attempt." },
      { id: "trailbreaker", name: "Trailbreaker", cost: 1, prerequisites: ["no_bad_ground"], leaning: "boldness",
        delta: { consumesOwnTerrain: { terrain: "mud", damageMultiplier: 1 } } },
      { id: "pathfinder", name: "Pathfinder", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["trailbreaker"], ["the_pathfinders"]],
        delta: { createsTerrain: { terrain: "floor", chance: 1, at: "self" } }, needsPrimitive: TERRAIN_SELF,
        note: "LANE P NOTABLE. It does not ignore the mud — it packs it down. A real path appears behind it that anything can then use: the only node in the roster that leaves permanent infrastructure." },
      { id: "the_short_way", name: "The Short Way", cost: 1, prerequisites: ["pathfinder"], leaning: "boldness",
        delta: { cooldownTicks: -5, reposition: { mover: "attacker", to: "past", tiles: 3, timing: "beforeHit" } },
        note: "Was -15 cooldown, ten ticks of which the move did not have to give. Now it also cuts straight through to the far side of whatever is in the way — the literal short way." },
      { id: "the_long_walk", name: "The Long Walk", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["long_wind"], ["the_short_way"]],
        grantsPassives: [{ kind: "dispersalSpeed", value: 0.6 }, { kind: "healAura", value: 0.008 }], delta: {}, needsPrimitive: DISPERSAL,
        note: "DEEP NOTABLE. Both lanes end here: distance covered, and everyone who covered it still standing." },
      { id: "dead_reckoning_ag", name: "Dead Reckoning", cost: 1, prerequisites: ["the_long_walk"], leaning: "boldness",
        delta: { maxPPBonus: 10 }, needsPrimitive: PPC },
      { id: "nothing_stops_it", name: "Nothing Stops It", cost: 1, prerequisites: ["dead_reckoning_ag"], leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 1 },
        delta: { reposition: { mover: "attacker", to: "past", tiles: 4, timing: "beforeHit" }, ppCost: 3 },
        needsPrimitive: UNHINDERED + "; " + PPC,
        note: "CAPSTONE. Four tiles of ground closed before anything registers it moved. You read this one on the region map AND in a fight." },

      // ===== AGGRESSION: tempo. Act more, or be untouchable.
      { id: "first_move", name: "First Move", cost: 1, leaning: "aggression",
        delta: { statChangesOnHit: [{ target: "self", stat: "speed", stage: 3, ticks: 40 }] },
        note: "OPENER. Splits into acting more often and being impossible to pin." },
      { id: "short_rest", name: "Short Rest", cost: 1, prerequisites: ["first_move"], leaning: "aggression",
        delta: { cooldownTicks: -6, maxPPBonus: 10 }, needsPrimitive: PPC },
      { id: "wound_up", name: "Wound Up", cost: 1, prerequisites: ["short_rest"], leaning: "aggression",
        delta: { statChangesOnHit: [{ target: "self", stat: "speed", stage: 4, ticks: 40 }] } },
      { id: "blur", name: "Blur", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["wound_up"], ["the_lead"]],
        grantsPassive: { kind: "cooldownHaste", value: 0.2 }, delta: {}, needsPrimitive: HASTE,
        note: "LANE T NOTABLE. Every OTHER move this agent has comes off cooldown faster. The cross-move idea in its purest form: a node whose entire value lives in a different tree." },
      { id: "no_wind_down", name: "No Wind-Down", cost: 1, prerequisites: ["blur"], leaning: "aggression",
        delta: { statChangesOnHit: [{ target: "self", stat: "speed", stage: 4, ticks: 90 }] } },
      { id: "quickening", name: "Quickening", cost: 1, prerequisites: ["first_move"], leaning: "aggression",
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED,
        note: "LANE U entry. Too fast to track rather than too fast to catch." },
      { id: "afterimage", name: "Afterimage", cost: 1, prerequisites: ["quickening"], leaning: "aggression",
        grantsPassive: { kind: "unnoticed", value: 2 },
        delta: { statChangesOnHit: [{ target: "self", stat: "speed", stage: 6, ticks: 60 }] }, needsPrimitive: UNNOTICED },
      { id: "untouchable", name: "Untouchable", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["afterimage"], ["downhill_run"]],
        grantsPassives: [{ kind: "immovable", value: 1 }, { kind: "unshaken", value: 1 }], delta: {},
        note: "LANE U NOTABLE. Fast enough that the first thing to reach it simply does not connect. Both primitives shipped; unshaken has one user in the whole roster." },
      { id: "no_purchase", name: "No Purchase", cost: 1, prerequisites: ["untouchable"], leaning: "aggression",
        delta: { jamCooldownTicks: 12 },
        note: "You are not faster than it — it is slower than you." },
      { id: "momentum", name: "Momentum", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["no_wind_down"], ["no_purchase"]],
        grantsPassive: { kind: "cooldownHaste", value: 0.15 }, delta: { critRateStage: 1 }, needsPrimitive: HASTE,
        note: "DEEP NOTABLE. Both lanes end here." },
      { id: "wide_open", name: "Wide Open", cost: 1, prerequisites: ["momentum"], leaning: "aggression",
        delta: { defensePenetration: 0.2 } },
      { id: "faster_than_thought", name: "Faster Than Thought", cost: 1, prerequisites: ["wide_open"], leaning: "aggression",
        grantsPassives: [{ kind: "unnoticed", value: 3 }, { kind: "immovable", value: 1 }],
        delta: { critCooldownReset: true, hitsBonus: 1, ppCost: 3 },
        needsPrimitive: UNNOTICED + "; " + PPC,
        note: "CAPSTONE. Not a fourth helping of cooldown reduction — that is the Blur lane's answer and it already won. This is the end of the OTHER lane: moving so far inside the target's reaction that it lands twice, is never noticed, and cannot be shifted." },

      // ===== SOCIABILITY: the herd moves together. Fast, or intact.
      { id: "pace_setter", name: "Pace-Setter", cost: 1, leaning: "sociability",
        delta: { targetsAlly: true, allyEffects: [{ buff: { stat: "speed", stage: 2, ticks: 50 } }] },
        note: "OPENER. Splits into a herd that moves fast and one that arrives whole." },
      { id: "keep_up", name: "Keep Up", cost: 1, prerequisites: ["pace_setter"], leaning: "sociability", delta: { cooldownTicks: -5 } },
      { id: "no_one_behind", name: "No One Behind", cost: 1, prerequisites: ["keep_up"], leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.006 }, delta: {} },
      { id: "moving_as_one", name: "Moving as One", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["no_one_behind"], ["the_pathfinders"]],
        grantsPassive: { kind: "herdHaste", value: 0.25 }, delta: {}, needsPrimitive: HERD_HASTE,
        note: "LANE F NOTABLE. Not one fast Ponyta — a fast herd. aquaticHaste already proves the aura pattern works." },
      { id: "the_stragglers", name: "The Stragglers", cost: 1, prerequisites: ["moving_as_one"], leaning: "sociability",
        delta: { positionSwap: true, positionSwapPull: 2 },
        note: "The leader drops back and shoves a straggler forward into its own place — the most literal reading of \"nobody gets left behind\"." },
      { id: "close_ranks_agility", name: "Close Ranks", cost: 1, prerequisites: ["pace_setter"], leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.15 }, delta: {},
        note: "LANE I entry. Move tightly enough that nothing challenges the column." },
      { id: "drumbeat", name: "Drumbeat", cost: 1, prerequisites: ["close_ranks_agility"], leaning: "sociability",
        delta: { allyEffectOnAttack: true } },
      { id: "the_column", name: "The Column", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["drumbeat"], ["the_lead"]],
        grantsPassives: [{ kind: "healAura", value: 0.014 }, { kind: "calmingPresence", value: 0.2 }], delta: {},
        note: "LANE I NOTABLE. Not about crossing at all — a herd in formation. Nothing picks a fight with a column that is already moving." },
      { id: "one_pace", name: "One Pace", cost: 1, prerequisites: ["the_column"], leaning: "sociability",
        delta: { statusImmunityAura: { ticks: 60, radius: 4 } } },
      { id: "the_crossing", name: "The Crossing", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["the_stragglers"], ["one_pace"]],
        grantsPassive: { kind: "dispersalSpeed", value: 0.8 },
        delta: { targetsAlly: true, allyEffects: [{ healFraction: 0.12 }] }, needsPrimitive: DISPERSAL,
        note: "DEEP NOTABLE. A herd that emigrates as a group and arrives intact. Right now emigrating herds are the ones that die." },
      { id: "waypoints", name: "Waypoints", cost: 1, prerequisites: ["the_crossing"], leaning: "sociability",
        grantsPassive: { kind: "herdHaste", value: 0.15 }, delta: {}, needsPrimitive: HERD_HASTE },
      { id: "the_migration", name: "The Migration", cost: 1, prerequisites: ["waypoints"], leaning: "sociability",
        grantsPassives: [{ kind: "dispersalSpeed", value: 1 }, { kind: "healAura", value: 0.01 }], delta: { ppCost: 3 },
        needsPrimitive: DISPERSAL + "; " + PPC,
        note: "CAPSTONE. The herd that crosses the map and arrives whole. This is the tree answering the thing the sim actually has a problem with." },

      // ===== Bridges =====
      { id: "fast_over_rough", name: "Fast Over Rough", cost: 1, prerequisites: ["sure_footing", "first_move"], leaning: "boldness",
        delta: { cooldownTicks: -6 },
        note: "CROSSLINK Boldness<->Aggression. Ground that doesn't slow you means you can do it again sooner." },
      { id: "faster_over_rough", name: "Faster Over Rough", cost: 1, prerequisites: ["fast_over_rough"], leaning: "boldness",
        delta: { cooldownTicks: -6 } },
      { id: "downhill_run", name: "Downhill Run", cost: 1, prerequisites: ["faster_over_rough"], leaning: "aggression",
        delta: { cooldownTicks: -6, statChangesOnHit: [{ target: "self", stat: "speed", stage: 3, ticks: 60 }] },
        note: "BRIDGE NOTABLE. Its own tempo lever escalated until Agility is close to always-on. Lands on Overland and Blur — the two lanes about covering ground fast." },

      { id: "scout_ahead", name: "Scout Ahead", cost: 1, prerequisites: ["sure_footing", "pace_setter"], leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.2 }, delta: {}, needsPrimitive: UNHINDERED,
        note: "CROSSLINK Boldness<->Sociability. Someone goes first and finds the ground that works." },
      { id: "farther_scout", name: "Farther Scout", cost: 1, prerequisites: ["scout_ahead"], leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.25 }, delta: {}, needsPrimitive: UNHINDERED },
      { id: "the_pathfinders", name: "The Pathfinders", cost: 1, prerequisites: ["farther_scout"], leaning: "sociability",
        grantsPassives: [{ kind: "terrainUnhindered", value: 0.4 }, { kind: "dispersalSpeed", value: 0.4 }], delta: {}, needsPrimitive: UNHINDERED,
        note: "BRIDGE NOTABLE. Its bad-ground lever escalated and handed to the herd behind it. Lands on Pathfinder and Moving as One." },

      { id: "set_the_pace", name: "Set the Pace", cost: 1, prerequisites: ["pace_setter", "first_move"], leaning: "sociability",
        delta: { allyEffectOnAttack: true, allyEffects: [{ buff: { stat: "speed", stage: 1, ticks: 40 } }] },
        note: "CROSSLINK Sociability<->Aggression. Going first drags everyone else forward with you." },
      { id: "quicker_pace", name: "Quicker Pace", cost: 1, prerequisites: ["set_the_pace"], leaning: "sociability",
        delta: { allyEffects: [{ buff: { stat: "speed", stage: 2, ticks: 50 } }] } },
      { id: "the_lead", name: "The Lead", cost: 1, prerequisites: ["quicker_pace"], leaning: "aggression",
        delta: { allyEffects: [{ buff: { stat: "speed", stage: 3, ticks: 70 }, healFraction: 0.08 }], allyEffectOnAttack: true },
        note: "BRIDGE NOTABLE. The leader's own speed is what the herd runs at. Lands on Untouchable and The Column." },
    ]),
  },
};
