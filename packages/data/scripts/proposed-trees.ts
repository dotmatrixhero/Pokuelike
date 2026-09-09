/**
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
  shape: unknown;
  range?: unknown;
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
const HERD_HASTE = "Herd-scoped speed aura — aquaticHasteMultiplier (support.ts) is the shipped shape to copy, minus its terrain condition";

export const PROPOSED_TREES: Record<string, ProposedMove> = {
  harden: {
    id: "harden",
    name: "Harden",
    type: "normal",
    category: "status",
    power: 0,
    accuracy: 100,
    cooldownTicks: 40,
    shape: { kind: "point" },
    learners: ["metapod", "kakuna", "krabby", "kingler", "shellder"],
    fantasy:
      "Harden is not a shield being raised. It is a body clenching until it is a different material — a Caterpie going rigid on a twig until it reads as bark, a Kakuna that is functionally furniture. It is the move of things that cannot run and cannot fight, and that survive by not being worth the effort. Nothing about it is dangerous. What it changes is whether anything bothers.",
    tree: tree([
      // ===== Boldness: Density. Hardening makes you heavier, not just tougher.
      { id: "settling_weight", name: "Settling Weight", cost: 1, leaning: "boldness",
        grantsPassive: { kind: "bulk", value: 0.12 }, delta: {}, needsPrimitive: BULK,
        note: "The flagship node. Weight is read by every weightScaling move, so this makes the holder's TACKLE hit harder — a node in one move's tree paying off in another's." },
      { id: "packed_shell", name: "Packed Shell", cost: 1, prerequisites: ["settling_weight"], leaning: "boldness",
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 1, ticks: 75 } } },
      { id: "deadweight", name: "Deadweight", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["packed_shell"], ["cracked_but_heavy"], ["heavy_and_still"]],
        grantsPassive: { kind: "bulk", value: 0.18 }, delta: {}, needsPrimitive: BULK },
      { id: "rooted_stance", name: "Rooted Stance", cost: 2, prerequisites: ["deadweight"], leaning: "boldness",
        grantsPassive: { kind: "immovable", value: 1 }, delta: {},
        note: "NOTABLE. Cannot be dragged, knocked back or lunged at." },
      { id: "slow_to_shift", name: "Slow to Shift", cost: 1, prerequisites: ["rooted_stance"], leaning: "boldness",
        delta: { cooldownTicks: -6 } },
      { id: "set_bone", name: "Set Bone", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["slow_to_shift"], ["spines_out"], ["armored_indifference"]],
        grantsPassive: { kind: "bulk", value: 0.15 }, delta: {}, needsPrimitive: BULK },
      { id: "chrysalis", name: "Chrysalis", cost: 2, prerequisites: ["set_bone"], excludes: ["quick_set"], leaning: "boldness",
        grantsPassive: { kind: "damageReduction", value: 0.2 }, delta: { lockTicks: 6 },
        note: "FORK. Voluntary helplessness: enormous mitigation bought with a real action lock. The roster has no other move where being unable to act is the point — chargeAttack spends its lock buying an attack, not survival." },
      { id: "quick_set", name: "Quick Set", cost: 2, prerequisites: ["set_bone"], excludes: ["chrysalis"], leaning: "boldness",
        grantsPassive: { kind: "defenseBoost", value: 1 }, delta: { cooldownTicks: -10 },
        note: "FORK. Harden often and lightly rather than once and totally." },
      { id: "dense_core", name: "Dense Core", cost: 2, leaning: "boldness",
        prerequisitesAnyOf: [["chrysalis"], ["quick_set"]],
        grantsPassive: { kind: "bulk", value: 0.25 }, delta: {}, needsPrimitive: BULK },
      { id: "unbudgeable", name: "Unbudgeable", cost: 2, prerequisites: ["dense_core"], leaning: "boldness",
        grantsPassives: [{ kind: "bulk", value: 0.35 }, { kind: "damageReduction", value: 0.1 }], delta: {}, needsPrimitive: BULK,
        note: "KEYSTONE. At full stack a Metapod is meaningfully heavy — its Tackle becomes a real threat, which is the whole cross-move thesis paying off." },

      // ===== Sociability: Not Worth Eating. Stop reading as prey.
      { id: "still_as_bark", name: "Still as Bark", cost: 1, leaning: "sociability",
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED,
        note: "Predators' effective detection radius against the holder shrinks by a tile. isDetectable already has exactly this term for bushes; nothing has ever granted it." },
      { id: "dead_leaf", name: "Dead Leaf", cost: 1, prerequisites: ["still_as_bark"], leaning: "sociability",
        delta: { cooldownTicks: -4 } },
      { id: "not_food", name: "Not Food", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["dead_leaf"], ["heavy_and_still"], ["quiet_spines"]],
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED },
      { id: "shared_stillness", name: "Shared Stillness", cost: 2, prerequisites: ["not_food"], leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "defense", stage: 1, ticks: 50 } } },
        note: "NOTABLE. Hardening beside a herd-mate hardens them too." },
      { id: "hold_position", name: "Hold Position", cost: 1, prerequisites: ["shared_stillness"], leaning: "sociability",
        delta: { allyEffectOnAttack: true } },
      { id: "bark_still", name: "Bark-Still", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["hold_position"], ["armored_indifference"], ["ambush_shell"]],
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED,
        note: "Several hardened herd-mates near each other read as scenery together." },
      { id: "scenery", name: "Scenery", cost: 2, prerequisites: ["bark_still"], excludes: ["driftwood"], leaning: "sociability",
        grantsPassive: { kind: "unnoticedAura", value: 1 }, delta: {}, needsPrimitive: UNNOTICED,
        note: "FORK. The whole cluster goes unnoticed — but only while they stay bunched." },
      { id: "driftwood", name: "Driftwood", cost: 2, prerequisites: ["bark_still"], excludes: ["scenery"], leaning: "sociability",
        grantsPassive: { kind: "unnoticed", value: 2 }, delta: { cooldownTicks: -8 }, needsPrimitive: UNNOTICED,
        note: "FORK. One thing nothing looks at twice, rather than a group that hides together." },
      { id: "wrong_tree", name: "Wrong Tree", cost: 2, leaning: "sociability",
        prerequisitesAnyOf: [["scenery"], ["driftwood"]],
        grantsPassive: { kind: "calmingPresence", value: 0.2 }, delta: {} },
      { id: "let_it_pass", name: "Let It Pass", cost: 2, prerequisites: ["wrong_tree"], leaning: "sociability",
        grantsPassive: { kind: "huntTargetSkip", value: 1 }, delta: {}, needsPrimitive: SKIP,
        note: "KEYSTONE. A predator scanning for prey passes over entirely and goes to hunt a different herd. Like rallyCall, the payoff is that OTHER agents independently decide something different." },

      // ===== Aggression: the shell is the weapon.
      { id: "brittle_ridge", name: "Brittle Ridge", cost: 1, leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.08 }, delta: {},
        note: "It hurts to bite. Shipped primitive, never yet on a status move." },
      { id: "sharp_seams", name: "Sharp Seams", cost: 1, prerequisites: ["brittle_ridge"], leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.07 }, delta: {} },
      { id: "shell_grit", name: "Shell Grit", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["sharp_seams"], ["cracked_but_heavy"], ["quiet_spines"]],
        delta: { statChangeOnHit: { target: "self", stat: "defense", stage: 2, ticks: 50 } } },
      { id: "splinter", name: "Splinter", cost: 2, prerequisites: ["shell_grit"], leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.15 }, delta: {},
        note: "NOTABLE. A third of the bite comes back." },
      { id: "grinding_plates", name: "Grinding Plates", cost: 1, prerequisites: ["splinter"], leaning: "aggression",
        delta: { cooldownTicks: -5 } },
      { id: "keen_edges", name: "Keen Edges", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["grinding_plates"], ["spines_out"], ["ambush_shell"]],
        grantsPassive: { kind: "thorns", value: 0.08 }, delta: {} },
      { id: "sharded_break", name: "Sharded Break", cost: 2, prerequisites: ["keen_edges"], excludes: ["honed_carapace"], leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.15 }, delta: {},
        note: "FORK. The casing shatters outward — maximum reflection, and it keeps shattering." },
      { id: "honed_carapace", name: "Honed Carapace", cost: 2, prerequisites: ["keen_edges"], excludes: ["sharded_break"], leaning: "aggression",
        grantsPassives: [{ kind: "defenseBoost", value: 2 }, { kind: "damageReduction", value: 0.12 }], delta: {},
        note: "FORK. A shell that simply holds, rather than one that pays for the cut by breaking." },
      { id: "jagged_answer", name: "Jagged Answer", cost: 2, leaning: "aggression",
        prerequisitesAnyOf: [["sharded_break"], ["honed_carapace"]],
        grantsPassive: { kind: "unshaken", value: 1 }, delta: {},
        note: "The first thing to bite this gets nothing at all — no damage, no roll, no effect. Shipped primitive with exactly one user (Body Slam's Unbothered), and a better fit here than on a move that hits back." },
      { id: "brittle_edge", name: "Brittle Edge", cost: 2, prerequisites: ["jagged_answer"], leaning: "aggression",
        grantsPassive: { kind: "thornsRubble", value: 0.18 }, delta: {}, needsPrimitive: RUBBLE,
        note: "KEYSTONE. The casing cracks when struck: reflects damage AND leaves real rubble on the attacker's tile. A defensive move that terraforms by being hit." },

      // ===== Bridge A<->B: weight and shards. Lever: bulk.
      { id: "cracked_but_heavy", name: "Cracked but Heavy", cost: 1, prerequisites: ["brittle_ridge", "settling_weight"], leaning: "aggression",
        grantsPassive: { kind: "bulk", value: 0.1 }, delta: {}, needsPrimitive: BULK,
        note: "CROSSLINK Aggression<->Boldness. A heavier shell breaks into heavier pieces." },
      { id: "heavier_shards", name: "Heavier Shards", cost: 1, prerequisites: ["cracked_but_heavy"], leaning: "aggression",
        grantsPassive: { kind: "bulk", value: 0.15 }, delta: {}, needsPrimitive: BULK },
      { id: "spines_out", name: "Spines Out", cost: 2, prerequisites: ["heavier_shards"], leaning: "aggression",
        grantsPassives: [{ kind: "bulk", value: 0.2 }, { kind: "thorns", value: 0.12 }], delta: {}, needsPrimitive: BULK,
        note: "BRIDGE NOTABLE. Escalates the crosslink's own lever — the weight itself becomes the weapon, rather than bolting on an unrelated stat." },

      // ===== Bridge B<->S: stillness. Lever: unnoticed.
      { id: "heavy_and_still", name: "Heavy and Still", cost: 1, prerequisites: ["settling_weight", "still_as_bark"], leaning: "boldness",
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED,
        note: "CROSSLINK Boldness<->Sociability. A thing that will not move and does not register." },
      { id: "deeper_stillness", name: "Deeper Stillness", cost: 1, prerequisites: ["heavy_and_still"], leaning: "boldness",
        grantsPassive: { kind: "unnoticed", value: 1 }, delta: {}, needsPrimitive: UNNOTICED },
      { id: "armored_indifference", name: "Armored Indifference", cost: 2, prerequisites: ["deeper_stillness"], leaning: "sociability",
        grantsPassives: [{ kind: "unnoticed", value: 2 }, { kind: "nonTerritorial", value: 1 }], delta: {}, needsPrimitive: UNNOTICED,
        note: "BRIDGE NOTABLE. Deepens the crosslink's own not-being-noticed lever to its end point: it neither notices nor is noticed." },

      // ===== Bridge S<->A: hidden barbs. Lever: thorns.
      { id: "quiet_spines", name: "Quiet Spines", cost: 1, prerequisites: ["still_as_bark", "brittle_ridge"], leaning: "sociability",
        grantsPassive: { kind: "thorns", value: 0.05 }, delta: { cooldownTicks: -3 },
        note: "CROSSLINK Sociability<->Aggression. Unnoticed, and unpleasant if noticed anyway." },
      { id: "hidden_barbs", name: "Hidden Barbs", cost: 1, prerequisites: ["quiet_spines"], leaning: "sociability",
        grantsPassive: { kind: "thorns", value: 0.08 }, delta: {} },
      { id: "ambush_shell", name: "Ambush Shell", cost: 2, prerequisites: ["hidden_barbs"], leaning: "aggression",
        grantsPassive: { kind: "thorns", value: 0.2 }, delta: { situationalBonus: { condition: "concealed", multiplier: 1.3 } },
        note: "BRIDGE NOTABLE. The crosslink's own thorns lever escalated, and it bites hardest from cover — the one place this branch's fantasy actually lives." },
    ]),
  },

  twineedle: {
    id: "twineedle", name: "Twineedle", type: "bug", category: "physical",
    power: 25, accuracy: 100, cooldownTicks: 3, shape: { kind: "point" },
    learners: ["beedrill"],
    fantasy:
      "Two strikes, one behind the other, from a thing that is mostly needles. A Beedrill does not grapple; it commutes. It arrives, stabs twice, and is gone before you have turned around. It is a poison delivery system with wings.",
    tree: tree([
      // ===== Aggression: the flurry. The product is status RELIABILITY, not damage.
      { id: "third_needle", name: "Third Needle", cost: 1, leaning: "aggression", delta: { hits: { min: 2, max: 3 } },
        note: "Each stab rolls poison independently, so a third stab is a third chance, not just more damage." },
      { id: "quicker_draw", name: "Quicker Draw", cost: 1, prerequisites: ["third_needle"], leaning: "aggression", delta: { cooldownTicks: -1 } },
      { id: "barbed", name: "Barbed", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["quicker_draw"], ["quick_and_many"], ["marked_and_barbed"]], delta: { statusChance: 0.1 } },
      { id: "fourth_needle", name: "Fourth Needle", cost: 2, prerequisites: ["barbed"], leaning: "aggression", delta: { hits: { min: 3, max: 4 } },
        note: "NOTABLE. Four independent poison rolls is a near-certainty, which is the branch's real product." },
      { id: "thin_point", name: "Thin Point", cost: 1, prerequisites: ["fourth_needle"], leaning: "aggression", delta: { defensePenetration: 0.15 } },
      { id: "needle_rhythm", name: "Needle Rhythm", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["thin_point"], ["blur_of_needles"], ["venom_mark"]], delta: { cooldownTicks: -1 } },
      { id: "pincushion", name: "Pincushion", cost: 2, prerequisites: ["needle_rhythm"], excludes: ["venom_lance"], leaning: "aggression",
        delta: { hits: { min: 4, max: 5 }, statusSeverity: 2 },
        note: "FORK. Not more damage — worse venom. Every needle deepens what the last one left." },
      { id: "venom_lance", name: "Venom Lance", cost: 2, prerequisites: ["needle_rhythm"], excludes: ["pincushion"], leaning: "aggression",
        delta: { hits: { min: 2, max: 2 }, power: 20, defensePenetration: 0.25 },
        note: "FORK. Two strikes that go all the way through, instead of five that skim." },
      { id: "drilled", name: "Drilled", cost: 2, leaning: "aggression",
        prerequisitesAnyOf: [["pincushion"], ["venom_lance"]], delta: { accuracy: 10, critRateStage: 1 } },
      { id: "hollow_points", name: "Hollow Points", cost: 2, prerequisites: ["drilled"], leaning: "aggression",
        delta: { statusChance: 0.2, statusSpreads: true },
        note: "KEYSTONE. Enough venom in one flurry that it comes off on whatever is standing nearby." },

      // ===== Boldness: the drive-by. Never be where the counterattack lands.
      { id: "hit_and_gone", name: "Hit and Gone", cost: 1, leaning: "boldness",
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 2, timing: "onHit" } },
        note: "The USER retreats after landing — shipped primitive, used on the attacker, which almost nothing does." },
      { id: "wide_approach", name: "Wide Approach", cost: 1, prerequisites: ["hit_and_gone"], leaning: "boldness", delta: { range: { max: 2 } } },
      { id: "blindside", name: "Blindside", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["wide_approach"], ["quick_and_many"], ["called_from_cover"]],
        delta: { situationalBonus: { condition: "flanking", multiplier: 1.3 } } },
      { id: "never_landed", name: "Never Landed", cost: 2, prerequisites: ["blindside"], leaning: "boldness",
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 3, timing: "onHit" }, cooldownTicks: -1 },
        note: "NOTABLE. Three tiles of daylight between the sting and the retaliation." },
      { id: "wingbeat", name: "Wingbeat", cost: 1, prerequisites: ["never_landed"], leaning: "boldness", delta: { critRateStage: 1 } },
      { id: "circling", name: "Circling", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["wingbeat"], ["blur_of_needles"], ["ambush_hive"]], delta: { accuracy: 10 } },
      { id: "high_pass", name: "High Pass", cost: 2, prerequisites: ["circling"], excludes: ["low_pass"], leaning: "boldness",
        delta: { range: { max: 3 }, situationalBonus: { condition: "elevation", multiplier: 1.4 } },
        note: "FORK. Stay above it. Reach and height, at the cost of ever being in its face." },
      { id: "low_pass", name: "Low Pass", cost: 2, prerequisites: ["circling"], excludes: ["high_pass"], leaning: "boldness",
        delta: { critCooldownReset: true, situationalBonus: { condition: "flanking", multiplier: 1.5 } },
        note: "FORK. Straight through at head height, from behind, and immediately around again." },
      { id: "untouchable_arc", name: "Untouchable Arc", cost: 2, leaning: "boldness",
        prerequisitesAnyOf: [["high_pass"], ["low_pass"]],
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 3, timing: "onHit" }, accuracy: 10 } },
      { id: "gone_before_it_turns", name: "Gone Before It Turns", cost: 2, prerequisites: ["untouchable_arc"], leaning: "boldness",
        delta: { jamCooldownTicks: 10, situationalBonus: { condition: "targetStatused", multiplier: 1.35 } },
        note: "KEYSTONE. It is still turning around when the next pass lands, and its own moves are still on cooldown." },

      // ===== Sociability: the hive. A Beedrill is never one Beedrill.
      { id: "swarm_signal", name: "Swarm Signal", cost: 1, leaning: "sociability", delta: { rallyCall: { ticks: 60 } },
        note: "Marks the stung target; the whole hive's independently-run targeting converges on it." },
      { id: "hive_tempo", name: "Hive Tempo", cost: 1, prerequisites: ["swarm_signal"], leaning: "sociability", delta: { cooldownTicks: -1 } },
      { id: "shared_venom", name: "Shared Venom", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["hive_tempo"], ["called_from_cover"], ["marked_and_barbed"]], delta: { statusSpreads: true } },
      { id: "converge", name: "Converge", cost: 2, prerequisites: ["shared_venom"], leaning: "sociability",
        delta: { rallyCall: { ticks: 120 }, allyEffectOnAttack: true, allyEffect: { buff: { stat: "speed", stage: 1, ticks: 40 } } },
        note: "NOTABLE. The mark lasts twice as long and every nearby hive-mate gets faster on the way in." },
      { id: "no_stragglers", name: "No Stragglers", cost: 1, prerequisites: ["converge"], leaning: "sociability", delta: { jamCooldownTicks: 8 } },
      { id: "hive_mind", name: "Hive Mind", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["no_stragglers"], ["ambush_hive"], ["venom_mark"]], delta: { rallyCall: { ticks: 150 } } },
      { id: "the_hive_decides", name: "The Hive Decides", cost: 2, prerequisites: ["hive_mind"], excludes: ["drone_relay"], leaning: "sociability",
        delta: { rallyCall: { ticks: 240 } },
        note: "FORK. One mark, and it does not lapse. A hive that has decided on something does not un-decide." },
      { id: "drone_relay", name: "Drone Relay", cost: 2, prerequisites: ["hive_mind"], excludes: ["the_hive_decides"], leaning: "sociability",
        delta: { targetsAlly: true, allyEffectOnAttack: true, allyEffect: { healFraction: 0.15, buff: { stat: "attack", stage: 1, ticks: 40 } } },
        note: "FORK. No mark at all — the hive doesn't converge, it sustains. Every drone that fights beside another comes back stronger." },
      { id: "one_mind", name: "One Mind", cost: 2, leaning: "sociability",
        prerequisitesAnyOf: [["the_hive_decides"], ["drone_relay"]],
        delta: { positionSwap: true, positionSwapPull: 1, cooldownTicks: -1 },
        note: "Drones trade places mid-flurry: the one that just stung drops back and a fresh one is suddenly where it was. Shipped primitive, used by exactly one node in the whole roster (Peck's Snatch and Swap)." },
      { id: "nothing_forgets", name: "Nothing Forgets", cost: 2, prerequisites: ["one_mind"], leaning: "sociability",
        delta: { shape: { kind: "burst", radius: 1 }, hitsArea: true, statusSpreads: true, power: -8 },
        note: "KEYSTONE. The swarm stops being individuals and arrives as a cloud. A shape change is notable/keystone-tier currency (principle 14) and this branch had spent none of it." },

      // ===== Bridge A<->B: tempo. Lever: cooldownTicks.
      { id: "quick_and_many", name: "Quick and Many", cost: 1, prerequisites: ["third_needle", "hit_and_gone"], leaning: "aggression",
        delta: { cooldownTicks: -1 },
        note: "CROSSLINK Aggression<->Boldness. More passes per minute, because each one ends somewhere safe." },
      { id: "faster_pass", name: "Faster Pass", cost: 1, prerequisites: ["quick_and_many"], leaning: "aggression", delta: { cooldownTicks: -1 } },
      { id: "blur_of_needles", name: "Blur of Needles", cost: 2, prerequisites: ["faster_pass"], leaning: "aggression",
        delta: { cooldownTicks: -1, hits: { min: 3, max: 4 } },
        note: "BRIDGE NOTABLE. Escalates the crosslink's own tempo lever until the passes overlap." },

      // ===== Bridge B<->S: ambush. Lever: situationalBonus.
      { id: "called_from_cover", name: "Called from Cover", cost: 1, prerequisites: ["hit_and_gone", "swarm_signal"], leaning: "boldness",
        delta: { situationalBonus: { condition: "concealed", multiplier: 1.25 } },
        note: "CROSSLINK Boldness<->Sociability. The hive is called in from where nothing saw it waiting." },
      { id: "deeper_cover", name: "Deeper Cover", cost: 1, prerequisites: ["called_from_cover"], leaning: "boldness",
        delta: { situationalBonus: { condition: "concealed", multiplier: 1.4 } } },
      { id: "ambush_hive", name: "Ambush Hive", cost: 2, prerequisites: ["deeper_cover"], leaning: "sociability",
        delta: { situationalBonus: { condition: "concealed", multiplier: 1.7 }, rallyCall: { ticks: 90 } },
        note: "BRIDGE NOTABLE. The crosslink's own from-cover lever escalated, and the mark it sets comes from somewhere nothing was looking." },

      // ===== Bridge S<->A: venom marking. Lever: statusChance.
      { id: "marked_and_barbed", name: "Marked and Barbed", cost: 1, prerequisites: ["swarm_signal", "third_needle"], leaning: "sociability",
        delta: { statusChance: 0.1 },
        note: "CROSSLINK Sociability<->Aggression. The mark and the venom are the same act." },
      { id: "deeper_marking", name: "Deeper Marking", cost: 1, prerequisites: ["marked_and_barbed"], leaning: "sociability", delta: { statusChance: 0.15 } },
      { id: "venom_mark", name: "Venom Mark", cost: 2, prerequisites: ["deeper_marking"], leaning: "aggression",
        delta: { statusChance: 0.2, statusSpreads: true },
        note: "BRIDGE NOTABLE. Escalates its own venom-reliability lever to the point that the mark spreads with it." },
    ]),
  },

  poison_sting: {
    id: "poison_sting", name: "Poison Sting", type: "poison", category: "physical",
    power: 15, accuracy: 100, cooldownTicks: 2, shape: { kind: "point" },
    learners: ["ekans", "arbok", "weedle", "zubat", "golbat"],
    fantasy:
      "A wound too small to matter, and then it matters. The sting is not the point; the sting is delivery. Nothing that uses this move expects the hit to end anything — it expects to be somewhere else when it ends. Status-first on purpose: for this move the venom IS the fantasy, where Ice Beam's is the beam.",
    tree: tree([
      // ===== Boldness: the wound that waits. The branch that leaves combat entirely.
      { id: "slow_working", name: "Slow-Working", cost: 1, leaning: "boldness", delta: { statusSeverity: 1.3 } },
      { id: "thin_blood", name: "Thin Blood", cost: 1, prerequisites: ["slow_working"], leaning: "boldness", delta: { statusSeverity: 1.5 } },
      { id: "creeping_dose", name: "Creeping Dose", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["thin_blood"], ["thick_and_deep"], ["marked_and_sick"]], delta: { statusChance: 0.15 } },
      { id: "sickened", name: "Sickened", cost: 2, prerequisites: ["creeping_dose"], leaning: "boldness",
        delta: { statusNeedsInterference: { hunger: 0.5, thirst: 0.5 } }, needsPrimitive: NEEDS,
        note: "NOTABLE, and the best idea in this tree. A poisoned agent recovers hunger and thirst at half rate. The payoff of poisoning something is not that it takes damage — it is that it STARVES. Legible in the chronicle, and it makes this a predator that wounds and waits." },
      { id: "no_appetite", name: "No Appetite", cost: 1, prerequisites: ["sickened"], leaning: "boldness",
        delta: { statusNeedsInterference: { hunger: 0.25 } }, needsPrimitive: NEEDS },
      { id: "patient", name: "Patient", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["no_appetite"], ["thickened_blood"], ["the_starving_one"]],
        delta: { forcedMovement: { mover: "attacker", direction: "away", tiles: 1, timing: "onHit" } } },
      { id: "let_it_work", name: "Let It Work", cost: 2, prerequisites: ["patient"], excludes: ["quick_wilt"], leaning: "boldness",
        delta: { statusNeedsInterference: { hunger: 0.5, thirst: 0.5, regen: 1 }, statusSeverity: 2 }, needsPrimitive: NEEDS,
        note: "FORK. Eating, drinking and passive healing all shut down. Nothing it stings dies in front of it." },
      { id: "quick_wilt", name: "Quick Wilt", cost: 2, prerequisites: ["patient"], excludes: ["let_it_work"], leaning: "boldness",
        delta: { statusSeverity: 3, statusChance: 0.2 },
        note: "FORK. A venom that does its whole work now, at full strength, instead of over an afternoon." },
      { id: "wasting", name: "Wasting", cost: 2, leaning: "boldness",
        prerequisitesAnyOf: [["let_it_work"], ["quick_wilt"]],
        delta: { situationalBonus: { condition: "targetStatused", multiplier: 1.4 } } },
      { id: "nothing_recovers", name: "Nothing Recovers", cost: 2, prerequisites: ["wasting"], leaning: "boldness",
        delta: { statusNeedsInterference: { hunger: 0.75, thirst: 0.75, regen: 1 }, statusSpreads: true }, needsPrimitive: NEEDS,
        note: "KEYSTONE. Things it stung die later, elsewhere, of something that looks like hunger." },

      // ===== Aggression: deeper venom, faster.
      { id: "double_dose", name: "Double Dose", cost: 1, leaning: "aggression", delta: { hits: { min: 1, max: 2 } } },
      { id: "quick_fangs", name: "Quick Fangs", cost: 1, prerequisites: ["double_dose"], leaning: "aggression", delta: { cooldownTicks: -1 } },
      { id: "deep_stick", name: "Deep Stick", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["quick_fangs"], ["thick_and_deep"], ["pack_dosage"]], delta: { defensePenetration: 0.2 } },
      { id: "venom_glut", name: "Venom Glut", cost: 2, prerequisites: ["deep_stick"], leaning: "aggression",
        delta: { statusChance: 0.25, selfCostPerUse: { need: "energy", amount: 0.02 } },
        note: "NOTABLE. Near-guaranteed poison, and producing that much venom actually costs the user energy. Shipped primitive with exactly one node using it today." },
      { id: "finisher", name: "Finisher", cost: 1, prerequisites: ["venom_glut"], leaning: "aggression",
        delta: { situationalBonus: { condition: "targetStatused", multiplier: 1.4 } } },
      { id: "hunters_patience", name: "Hunter's Patience", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["finisher"], ["thickened_blood"], ["everyone_bites"]], delta: { critRateStage: 1 } },
      { id: "run_it_down", name: "Run It Down", cost: 2, prerequisites: ["hunters_patience"], excludes: ["dry_bite"], leaning: "aggression",
        delta: { situationalBonus: { condition: "targetLowHp", multiplier: 1.6 }, lifestealFraction: 0.25 },
        note: "FORK. Follows the poisoned thing until it drops, and feeds on the ending." },
      { id: "dry_bite", name: "Dry Bite", cost: 2, prerequisites: ["hunters_patience"], excludes: ["run_it_down"], leaning: "aggression",
        delta: { power: 25, defensePenetration: 0.3, statusChance: -0.2 },
        note: "FORK. Spends no venom at all and simply bites through. The one node in this tree that abandons its own premise, deliberately." },
      { id: "bled_out", name: "Bled Out", cost: 2, leaning: "aggression",
        prerequisitesAnyOf: [["run_it_down"], ["dry_bite"]], delta: { critRateStage: 1, critCooldownReset: true } },
      { id: "nothing_walks_away", name: "Nothing Walks Away", cost: 2, prerequisites: ["bled_out"], leaning: "aggression",
        delta: { situationalBonus: { condition: "targetLowHp", multiplier: 2 }, jamCooldownTicks: 10 },
        note: "KEYSTONE." },

      // ===== Sociability: the shared kill. Nothing here hunts alone.
      { id: "scent_trail", name: "Scent Trail", cost: 1, leaning: "sociability", delta: { rallyCall: { ticks: 80 } },
        note: "Poison is a tracking mechanism as much as a weapon." },
      { id: "close_behind", name: "Close Behind", cost: 1, prerequisites: ["scent_trail"], leaning: "sociability",
        delta: { allyEffectOnAttack: true, allyEffect: { buff: { stat: "speed", stage: 1, ticks: 40 } } } },
      { id: "it_spreads", name: "It Spreads", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["close_behind"], ["marked_and_sick"], ["pack_dosage"]], delta: { statusSpreads: true } },
      { id: "the_nest_eats", name: "The Nest Eats", cost: 2, prerequisites: ["it_spreads"], leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.08 } },
        note: "NOTABLE. What the venom takes out of one thing goes back into the nest." },
      { id: "long_patrol", name: "Long Patrol", cost: 1, prerequisites: ["the_nest_eats"], leaning: "sociability", delta: { range: { max: 2 } } },
      { id: "circling_nest", name: "Circling Nest", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["long_patrol"], ["the_starving_one"], ["everyone_bites"]], delta: { rallyCall: { ticks: 120 } } },
      { id: "nothing_leaves", name: "Nothing Leaves", cost: 2, prerequisites: ["circling_nest"], excludes: ["the_relay"], leaning: "sociability",
        delta: { rallyCall: { ticks: 200 }, jamCooldownTicks: 10 },
        note: "FORK. Marked, slowed and surrounded — a territory nothing wounded walks out of." },
      { id: "the_relay", name: "The Relay", cost: 2, prerequisites: ["circling_nest"], excludes: ["nothing_leaves"], leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.2, buff: { stat: "speed", stage: 2, ticks: 60 } }, allyEffectOnAttack: true },
        note: "FORK. Let it run. Whoever is freshest takes the next leg." },
      { id: "shared_table", name: "Shared Table", cost: 2, leaning: "sociability",
        prerequisitesAnyOf: [["nothing_leaves"], ["the_relay"]], delta: { allyEffect: { healFraction: 0.15 }, cooldownTicks: -1 } },
      { id: "the_nest_decides", name: "The Nest Decides", cost: 2, prerequisites: ["shared_table"], leaning: "sociability",
        delta: { rallyCall: { ticks: 300 }, statusSpreads: true },
        note: "KEYSTONE." },

      // ===== Bridge A<->B: thicker venom. Lever: statusSeverity.
      { id: "thick_and_deep", name: "Thick and Deep", cost: 1, prerequisites: ["double_dose", "slow_working"], leaning: "aggression",
        delta: { statusSeverity: 1.4 },
        note: "CROSSLINK Aggression<->Boldness." },
      { id: "thicker_venom", name: "Thicker Venom", cost: 1, prerequisites: ["thick_and_deep"], leaning: "aggression", delta: { statusSeverity: 1.6 } },
      { id: "thickened_blood", name: "Thickened Blood", cost: 2, prerequisites: ["thicker_venom"], leaning: "boldness",
        delta: { statusSeverity: 2.2, statusChance: 0.15 },
        note: "BRIDGE NOTABLE. Escalates the crosslink's own severity lever rather than reaching for a new one." },

      // ===== Bridge B<->S: the marked sick one. Lever: rallyCall.
      { id: "marked_and_sick", name: "Marked and Sick", cost: 1, prerequisites: ["slow_working", "scent_trail"], leaning: "boldness",
        delta: { rallyCall: { ticks: 100 } },
        note: "CROSSLINK Boldness<->Sociability. The starving one is the one everybody follows." },
      { id: "longer_mark", name: "Longer Mark", cost: 1, prerequisites: ["marked_and_sick"], leaning: "boldness", delta: { rallyCall: { ticks: 140 } } },
      { id: "the_starving_one", name: "The Starving One", cost: 2, prerequisites: ["longer_mark"], leaning: "sociability",
        delta: { rallyCall: { ticks: 220 }, situationalBonus: { condition: "targetStatused", multiplier: 1.5 } },
        note: "BRIDGE NOTABLE. Deepens its own marking lever: the mark now lasts as long as the venom does." },

      // ===== Bridge S<->A: everyone doses. Lever: statusChance.
      { id: "pack_dosage", name: "Pack Dosage", cost: 1, prerequisites: ["scent_trail", "double_dose"], leaning: "sociability",
        delta: { statusChance: 0.12 },
        note: "CROSSLINK Sociability<->Aggression." },
      { id: "shared_dosage", name: "Shared Dosage", cost: 1, prerequisites: ["pack_dosage"], leaning: "sociability", delta: { statusChance: 0.15 } },
      { id: "everyone_bites", name: "Everyone Bites", cost: 2, prerequisites: ["shared_dosage"], leaning: "aggression",
        delta: { statusChance: 0.2, statusSpreads: true },
        note: "BRIDGE NOTABLE. Its own reliability lever escalated until one bite is indistinguishable from the nest's." },
    ]),
  },

  growth: {
    id: "growth", name: "Growth", type: "normal", category: "status",
    power: 0, accuracy: 100, cooldownTicks: 30, shape: { kind: "point" },
    learners: ["bulbasaur", "ivysaur", "venusaur", "oddish", "gloom"],
    fantasy:
      "Growth is the only move in the roster whose target is the ground. An Oddish standing still and enriching the dirt under itself is not preparing for a fight — it is farming. Over a long enough run a patch of Oddish does not defend a zone, it MAKES one: soil, then flora, then a food supply that outlives whichever Oddish planted it. This tree deliberately has NO combat branch — a first for this roster.",
    tree: tree([
      // ===== Boldness: deep roots. Permanence over speed.
      { id: "deep_roots", name: "Deep Roots", cost: 1, leaning: "boldness", delta: { fertilityBoost: { amount: 0.45, radius: 0 } } },
      { id: "patient_soil", name: "Patient Soil", cost: 1, prerequisites: ["deep_roots"], leaning: "boldness", delta: { cooldownTicks: -6 } },
      { id: "humus", name: "Humus", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["patient_soil"], ["rich_and_wide"], ["long_harvest"]], delta: { fertilityBoost: { amount: 0.6, radius: 0 } } },
      { id: "old_ground", name: "Old Ground", cost: 2, prerequisites: ["humus"], leaning: "boldness",
        delta: { fertilityCeilingBoost: 0.25 }, needsPrimitive: CEILING,
        note: "NOTABLE. Ground an Oddish worked stays richer after it dies — the first node in the game whose effect outlives its holder. Note the honest shape: fertility already regenerates toward a per-ground-type ceiling, so this raises the ceiling rather than freezing decay." },
      { id: "seedbed", name: "Seedbed", cost: 1, prerequisites: ["old_ground"], leaning: "boldness",
        delta: { floraRegrowthMultiplier: 1.4 }, needsPrimitive: "Local flora regrowth-rate modifier (flora.ts)" },
      { id: "worked_ground", name: "Worked Ground", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["seedbed"], ["black_earth"], ["the_standing_crop"]], delta: { fertilityBoost: { amount: 0.7, radius: 0 } } },
      { id: "it_takes", name: "It Takes", cost: 2, prerequisites: ["worked_ground"], excludes: ["terraced"], leaning: "boldness",
        delta: { createsTerrain: { terrain: "bush", chance: 0.35, at: "self" } }, needsPrimitive: TERRAIN_SELF,
        note: "FORK. A bush where there was none. An Oddish gardens its zone into a food supply — visible on the map at a glance." },
      { id: "terraced", name: "Terraced", cost: 2, prerequisites: ["worked_ground"], excludes: ["it_takes"], leaning: "boldness",
        delta: { fertilityCeilingBoost: 0.5, cooldownTicks: -10 }, needsPrimitive: CEILING,
        note: "FORK. No new plants — just ground so good that whatever lands on it thrives." },
      { id: "deep_loam", name: "Deep Loam", cost: 2, leaning: "boldness",
        prerequisitesAnyOf: [["it_takes"], ["terraced"]],
        delta: { fertilityBoost: { amount: 0.5, radius: 1 } } },
      { id: "the_orchard", name: "The Orchard", cost: 2, prerequisites: ["deep_loam"], leaning: "boldness",
        delta: { createsTerrain: { terrain: "tree", chance: 0.2, at: "self" }, fertilityCeilingBoost: 0.5 }, needsPrimitive: TERRAIN_SELF,
        note: "KEYSTONE. Trees, eventually. The slowest payoff in the roster and the only one measured in centuries of sim-time." },

      // ===== Aggression: spread. Claim ground outward — territory, not damage.
      { id: "creeping_edge", name: "Creeping Edge", cost: 1, leaning: "aggression", delta: { fertilityBoost: { amount: 0.3, radius: 1 } } },
      { id: "quicker_season", name: "Quicker Season", cost: 1, prerequisites: ["creeping_edge"], leaning: "aggression", delta: { cooldownTicks: -8 } },
      { id: "spreading", name: "Spreading", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["quicker_season"], ["rich_and_wide"], ["wide_table"]], delta: { fertilityBoost: { amount: 0.3, radius: 2 } } },
      { id: "thicket", name: "Thicket", cost: 2, prerequisites: ["spreading"], leaning: "aggression",
        delta: { fertilityBoost: { amount: 0.35, radius: 3 } },
        note: "NOTABLE. A real patch, not a tile." },
      { id: "choking_out", name: "Choking Out", cost: 1, prerequisites: ["thicket"], leaning: "aggression",
        delta: { floraCompetition: 0.3 }, needsPrimitive: "Flora yield weighted by the forager's type (flora.ts harvest path)" },
      { id: "root_war", name: "Root War", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["choking_out"], ["black_earth"], ["feast"]], delta: { fertilityBoost: { amount: 0.4, radius: 3 } } },
      { id: "overrun", name: "Overrun", cost: 2, prerequisites: ["root_war"], excludes: ["monoculture"], leaning: "aggression",
        delta: { createsTerrain: { terrain: "bush", chance: 0.2, at: "self", radius: 2 } }, needsPrimitive: TERRAIN_SELF,
        note: "FORK. The zone slowly becomes Grass-type ground whether anything else wanted that or not." },
      { id: "monoculture", name: "Monoculture", cost: 2, prerequisites: ["root_war"], excludes: ["overrun"], leaning: "aggression",
        delta: { floraCompetition: 0.7, fertilityBoost: { amount: 0.5, radius: 3 } },
        needsPrimitive: "Flora yield weighted by the forager's type",
        note: "FORK. One enormously rich patch that only its planter can really eat from." },
      { id: "the_verge", name: "The Verge", cost: 2, leaning: "aggression",
        prerequisitesAnyOf: [["overrun"], ["monoculture"]], delta: { fertilityBoost: { amount: 0.3, radius: 4 } } },
      { id: "it_was_all_grass", name: "It Was All Grass", cost: 2, prerequisites: ["the_verge"], leaning: "aggression",
        delta: { createsTerrain: { terrain: "bush", chance: 0.3, at: "self", radius: 3 }, floraRegrowthMultiplier: 1.5 },
        needsPrimitive: TERRAIN_SELF,
        note: "KEYSTONE. Aggression on a farming move is conquest by vegetation." },

      // ===== Sociability: feeding the herd. Nothing here is for the caster.
      { id: "shared_plot", name: "Shared Plot", cost: 1, leaning: "sociability", delta: { targetsAlly: true, allyEffect: { healFraction: 0.05 } } },
      { id: "good_year", name: "Good Year", cost: 1, prerequisites: ["shared_plot"], leaning: "sociability", delta: { fertilityBoost: { amount: 0.35, radius: 1 } } },
      { id: "grazing_ground", name: "Grazing Ground", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["good_year"], ["long_harvest"], ["wide_table"]],
        grantsPassive: { kind: "healAura", value: 0.008 }, delta: {} },
      { id: "the_patch", name: "The Patch", cost: 2, prerequisites: ["grazing_ground"], leaning: "sociability",
        delta: { herdForageBonus: 0.3 }, needsPrimitive: FORAGE,
        note: "NOTABLE. The whole herd eats better on ground this Oddish worked. A skill node that shows up as a population curve." },
      { id: "settle_here", name: "Settle Here", cost: 1, prerequisites: ["the_patch"], leaning: "sociability",
        delta: { herdMigrationResistance: 0.4 }, needsPrimitive: MIGRATE,
        note: "A herd with a real farm stops wanting to leave." },
      { id: "common_ground", name: "Common Ground", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["settle_here"], ["the_standing_crop"], ["feast"]], delta: { herdForageBonus: 0.15 }, needsPrimitive: FORAGE },
      { id: "homestead", name: "Homestead", cost: 2, prerequisites: ["common_ground"], excludes: ["the_commons"], leaning: "sociability",
        delta: { herdMigrationResistance: 0.6, fertilityCeilingBoost: 0.5 }, needsPrimitive: MIGRATE,
        note: "FORK. The herd stops migrating because it built something. The most un-combat capstone-tier node in the roster." },
      { id: "the_commons", name: "The Commons", cost: 2, prerequisites: ["common_ground"], excludes: ["homestead"], leaning: "sociability",
        grantsPassive: { kind: "calmingPresence", value: 0.3 },
        delta: { fertilityBoost: { amount: 0.5, radius: 3 } },
        note: "FORK. Ground good enough that other herds settle beside yours instead of contesting it — calmingPresence is shipped and deliberately NOT herd-scoped, which is exactly what a commons needs." },
      { id: "granary", name: "Granary", cost: 2, leaning: "sociability",
        prerequisitesAnyOf: [["homestead"], ["the_commons"]],
        grantsPassive: { kind: "healAura", value: 0.012 },
        delta: { createsTerrain: { terrain: "bush", chance: 0.4, at: "self" } }, needsPrimitive: TERRAIN_SELF,
        note: "A store, not a bonus: real bush tiles the herd can come back to." },
      { id: "nobody_leaves", name: "Nobody Leaves", cost: 2, prerequisites: ["granary"], leaning: "sociability",
        delta: { herdMigrationResistance: 0.8, floraRegrowthMultiplier: 1.6 }, needsPrimitive: MIGRATE,
        note: "KEYSTONE. A herd that has solved food. Whether that is good for the sim is a real open question — a zone that never empties is also a zone that never turns over." },

      // ===== Bridge B<->A: black earth. Lever: fertilityBoost.
      { id: "rich_and_wide", name: "Rich and Wide", cost: 1, prerequisites: ["deep_roots", "creeping_edge"], leaning: "boldness",
        delta: { fertilityBoost: { amount: 0.35, radius: 1 } },
        note: "CROSSLINK Boldness<->Aggression." },
      { id: "richer_still", name: "Richer Still", cost: 1, prerequisites: ["rich_and_wide"], leaning: "boldness",
        delta: { fertilityBoost: { amount: 0.5, radius: 2 } } },
      { id: "black_earth", name: "Black Earth", cost: 2, prerequisites: ["richer_still"], leaning: "aggression",
        delta: { fertilityBoost: { amount: 0.8, radius: 2 } },
        note: "BRIDGE NOTABLE. Escalates the crosslink's own enrichment lever — depth and width at once, which neither branch reaches alone." },

      // ===== Bridge B<->S: the standing crop. Lever: floraRegrowthMultiplier.
      { id: "long_harvest", name: "Long Harvest", cost: 1, prerequisites: ["deep_roots", "shared_plot"], leaning: "boldness",
        delta: { floraRegrowthMultiplier: 1.25 }, needsPrimitive: "Local flora regrowth-rate modifier",
        note: "CROSSLINK Boldness<->Sociability. Ground that keeps producing while the herd keeps eating." },
      { id: "longer_harvest", name: "Longer Harvest", cost: 1, prerequisites: ["long_harvest"], leaning: "boldness",
        delta: { floraRegrowthMultiplier: 1.4 }, needsPrimitive: "Local flora regrowth-rate modifier" },
      { id: "the_standing_crop", name: "The Standing Crop", cost: 2, prerequisites: ["longer_harvest"], leaning: "sociability",
        delta: { floraRegrowthMultiplier: 1.8 }, needsPrimitive: "Local flora regrowth-rate modifier",
        note: "BRIDGE NOTABLE. Its own regrowth lever pushed until the patch outgrows what a herd can strip." },

      // ===== Bridge A<->S: the table. Lever: healAura.
      { id: "wide_table", name: "Wide Table", cost: 1, prerequisites: ["creeping_edge", "shared_plot"], leaning: "aggression",
        grantsPassive: { kind: "healAura", value: 0.006 }, delta: {},
        note: "CROSSLINK Aggression<->Sociability. A patch wide enough that everyone standing in it is fed." },
      { id: "fuller_table", name: "Fuller Table", cost: 1, prerequisites: ["wide_table"], leaning: "aggression",
        grantsPassive: { kind: "healAura", value: 0.008 }, delta: {} },
      { id: "feast", name: "Feast", cost: 2, prerequisites: ["fuller_table"], leaning: "sociability",
        grantsPassive: { kind: "healAura", value: 0.015 }, delta: { fertilityBoost: { amount: 0.3, radius: 3 } },
        note: "BRIDGE NOTABLE. Escalates its own feeding-aura lever across the whole patch it planted." },
    ]),
  },

  agility: {
    id: "agility", name: "Agility", type: "psychic", category: "status",
    power: 0, accuracy: 100, cooldownTicks: 50, shape: { kind: "point" },
    learners: ["scyther", "sandshrew", "growlithe", "horsea", "seadra", "beedrill", "ponyta", "rapidash"],
    fantasy:
      "Agility is not a combat move and never has been. It is the difference between a herd that reaches the next zone and a herd that dies partway across the mud. Eight species learn it and none of them get anything from it today. Its real subject is the world map, not the fight.",
    tree: tree([
      // ===== Boldness: no bad ground. The migration branch.
      { id: "sure_footing", name: "Sure Footing", cost: 1, leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.3 }, delta: {}, needsPrimitive: UNHINDERED,
        note: "Mud, sand and rubble cost less. The first node in the roster whose payoff is measured in tiles crossed, not damage." },
      { id: "longer_stride", name: "Longer Stride", cost: 1, prerequisites: ["sure_footing"], leaning: "boldness",
        delta: { statChangeOnHit: { target: "self", stat: "speed", stage: 2, ticks: 70 } } },
      { id: "water_legs", name: "Water Legs", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["longer_stride"], ["fast_over_rough"], ["scout_ahead"]],
        grantsPassive: { kind: "terrainUnhindered", value: 0.35 }, delta: {}, needsPrimitive: UNHINDERED },
      { id: "overland", name: "Overland", cost: 2, prerequisites: ["water_legs"], leaning: "boldness",
        grantsPassive: { kind: "dispersalSpeed", value: 0.5 }, delta: {}, needsPrimitive: DISPERSAL,
        note: "NOTABLE. A herd carrying this crosses to the next zone in half the time — and the crossing is where herds currently die." },
      { id: "no_bad_ground", name: "No Bad Ground", cost: 1, prerequisites: ["overland"], leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.35 }, delta: {}, needsPrimitive: UNHINDERED },
      { id: "trailbreaker", name: "Trailbreaker", cost: 1, leaning: "boldness",
        prerequisitesAnyOf: [["no_bad_ground"], ["downhill_run"], ["the_pathfinders"]],
        grantsPassive: { kind: "terrainUnhindered", value: 0.2 }, delta: {}, needsPrimitive: UNHINDERED },
      { id: "the_long_walk", name: "The Long Walk", cost: 2, prerequisites: ["trailbreaker"], excludes: ["the_short_way"], leaning: "boldness",
        grantsPassives: [{ kind: "dispersalSpeed", value: 0.6 }, { kind: "regen", value: 0.02 }], delta: {}, needsPrimitive: DISPERSAL,
        note: "FORK. Distance, not ground: it goes further than anything should be able to, and recovers while doing it." },
      { id: "the_short_way", name: "The Short Way", cost: 2, prerequisites: ["trailbreaker"], excludes: ["the_long_walk"], leaning: "boldness",
        grantsPassives: [{ kind: "terrainUnhindered", value: 0.9 }], delta: { cooldownTicks: -15 }, needsPrimitive: UNHINDERED,
        note: "FORK. Not faster between zones — able to go straight through the swamp instead of around it." },
      { id: "pathfinder", name: "Pathfinder", cost: 2, leaning: "boldness",
        prerequisitesAnyOf: [["the_long_walk"], ["the_short_way"]],
        delta: { createsTerrain: { terrain: "floor", chance: 1, at: "self" } }, needsPrimitive: TERRAIN_SELF,
        note: "It doesn't ignore the mud — it packs it down. A real path appears behind it that anything can then use, which is the only node in the roster that leaves permanent infrastructure." },
      { id: "nothing_stops_it", name: "Nothing Stops It", cost: 2, prerequisites: ["pathfinder"], leaning: "boldness",
        grantsPassives: [{ kind: "terrainUnhindered", value: 1 }, { kind: "dispersalSpeed", value: 0.5 }], delta: {}, needsPrimitive: UNHINDERED,
        note: "KEYSTONE. You read this one on the region map, not in a fight." },

      // ===== Aggression: tempo. Act more often, so every other move fires more.
      { id: "first_move", name: "First Move", cost: 1, leaning: "aggression",
        delta: { statChangeOnHit: { target: "self", stat: "speed", stage: 3, ticks: 40 } } },
      { id: "short_rest", name: "Short Rest", cost: 1, prerequisites: ["first_move"], leaning: "aggression", delta: { cooldownTicks: -12 } },
      { id: "wound_up", name: "Wound Up", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["short_rest"], ["fast_over_rough"], ["set_the_pace"]],
        delta: { statChangeOnHit: { target: "self", stat: "speed", stage: 4, ticks: 40 } } },
      { id: "blur", name: "Blur", cost: 2, prerequisites: ["wound_up"], leaning: "aggression",
        grantsPassive: { kind: "cooldownHaste", value: 0.2 }, delta: {}, needsPrimitive: HASTE,
        note: "NOTABLE. Every OTHER move this agent has comes off cooldown faster. The cross-move idea in its purest form: a node whose entire value lives in a different tree." },
      { id: "no_wind_down", name: "No Wind-Down", cost: 1, prerequisites: ["blur"], leaning: "aggression",
        delta: { statChangeOnHit: { target: "self", stat: "speed", stage: 4, ticks: 90 } } },
      { id: "quickening", name: "Quickening", cost: 1, leaning: "aggression",
        prerequisitesAnyOf: [["no_wind_down"], ["downhill_run"], ["the_lead"]],
        grantsPassive: { kind: "cooldownHaste", value: 0.1 }, delta: {}, needsPrimitive: HASTE },
      { id: "untouchable", name: "Untouchable", cost: 2, prerequisites: ["quickening"], excludes: ["afterimage"], leaning: "aggression",
        grantsPassives: [{ kind: "immovable", value: 1 }, { kind: "unshaken", value: 1 }], delta: {},
        note: "FORK. Fast enough that the first thing to reach it simply doesn't connect. Both primitives shipped; unshaken has one user in the whole roster." },
      { id: "afterimage", name: "Afterimage", cost: 2, prerequisites: ["quickening"], excludes: ["untouchable"], leaning: "aggression",
        grantsPassive: { kind: "unnoticed", value: 2 }, delta: { statChangeOnHit: { target: "self", stat: "speed", stage: 6, ticks: 60 } },
        needsPrimitive: UNNOTICED,
        note: "FORK. Too fast to track rather than too fast to catch — it stops being noticed at all." },
      { id: "momentum", name: "Momentum", cost: 2, leaning: "aggression",
        prerequisitesAnyOf: [["untouchable"], ["afterimage"]],
        delta: { jamCooldownTicks: 12 },
        note: "You are not faster than it — it is slower than you. Everything it was about to do gets pushed back." },
      { id: "faster_than_thought", name: "Faster Than Thought", cost: 2, prerequisites: ["momentum"], leaning: "aggression",
        grantsPassive: { kind: "cooldownHaste", value: 0.3 }, delta: { statChangeOnHit: { target: "self", stat: "speed", stage: 6, ticks: 120 } },
        needsPrimitive: HASTE,
        note: "KEYSTONE." },

      // ===== Sociability: the herd moves together, or it doesn't move.
      { id: "pace_setter", name: "Pace-Setter", cost: 1, leaning: "sociability",
        delta: { targetsAlly: true, allyEffect: { buff: { stat: "speed", stage: 2, ticks: 50 } } } },
      { id: "keep_up", name: "Keep Up", cost: 1, prerequisites: ["pace_setter"], leaning: "sociability", delta: { cooldownTicks: -10 } },
      { id: "no_one_behind", name: "No One Behind", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["keep_up"], ["scout_ahead"], ["set_the_pace"]],
        grantsPassive: { kind: "healAura", value: 0.006 }, delta: {} },
      { id: "moving_as_one", name: "Moving as One", cost: 2, prerequisites: ["no_one_behind"], leaning: "sociability",
        grantsPassive: { kind: "herdHaste", value: 0.25 }, delta: {}, needsPrimitive: HERD_HASTE,
        note: "NOTABLE. Not one fast Ponyta — a fast herd. aquaticHaste already proves the aura pattern works." },
      { id: "the_stragglers", name: "The Stragglers", cost: 1, prerequisites: ["moving_as_one"], leaning: "sociability",
        grantsPassive: { kind: "herdHaste", value: 0.15 }, delta: {}, needsPrimitive: HERD_HASTE },
      { id: "drumbeat", name: "Drumbeat", cost: 1, leaning: "sociability",
        prerequisitesAnyOf: [["the_stragglers"], ["the_pathfinders"], ["the_lead"]],
        grantsPassive: { kind: "herdHaste", value: 0.1 }, delta: {}, needsPrimitive: HERD_HASTE },
      { id: "the_crossing", name: "The Crossing", cost: 2, prerequisites: ["drumbeat"], excludes: ["the_column"], leaning: "sociability",
        grantsPassive: { kind: "dispersalSpeed", value: 0.8 },
        delta: { targetsAlly: true, allyEffect: { healFraction: 0.12 } }, needsPrimitive: DISPERSAL,
        note: "FORK. A herd that emigrates as a group and arrives intact. Right now emigrating herds are the ones that die." },
      { id: "the_column", name: "The Column", cost: 2, prerequisites: ["drumbeat"], excludes: ["the_crossing"], leaning: "sociability",
        grantsPassives: [{ kind: "healAura", value: 0.014 }, { kind: "calmingPresence", value: 0.2 }], delta: { allyEffectOnAttack: true },
        note: "FORK. Not about crossing at all — a herd in formation. Nothing picks a fight with a column that is already moving." },
      { id: "one_pace", name: "One Pace", cost: 2, leaning: "sociability",
        prerequisitesAnyOf: [["the_crossing"], ["the_column"]],
        delta: { positionSwap: true, positionSwapPull: 2 },
        note: "The leader drops back and shoves a straggler forward into its own place. Shipped positionSwap, and the most literal possible reading of \"nobody gets left behind\"." },
      { id: "the_migration", name: "The Migration", cost: 2, prerequisites: ["one_pace"], leaning: "sociability",
        grantsPassives: [{ kind: "dispersalSpeed", value: 1 }, { kind: "healAura", value: 0.01 }], delta: {}, needsPrimitive: DISPERSAL,
        note: "KEYSTONE. The herd that crosses the map and arrives whole. This is the tree answering the thing the sim actually has a problem with." },

      // ===== Bridge B<->A: downhill. Lever: cooldownTicks.
      { id: "fast_over_rough", name: "Fast Over Rough", cost: 1, prerequisites: ["sure_footing", "first_move"], leaning: "boldness",
        delta: { cooldownTicks: -6 },
        note: "CROSSLINK Boldness<->Aggression. Ground that doesn't slow you means you can do it again sooner." },
      { id: "faster_over_rough", name: "Faster Over Rough", cost: 1, prerequisites: ["fast_over_rough"], leaning: "boldness", delta: { cooldownTicks: -8 } },
      { id: "downhill_run", name: "Downhill Run", cost: 2, prerequisites: ["faster_over_rough"], leaning: "aggression",
        delta: { cooldownTicks: -14, statChangeOnHit: { target: "self", stat: "speed", stage: 3, ticks: 60 } },
        note: "BRIDGE NOTABLE. Escalates the crosslink's own tempo lever until Agility is close to always-on." },

      // ===== Bridge B<->S: scouts. Lever: terrainUnhindered.
      { id: "scout_ahead", name: "Scout Ahead", cost: 1, prerequisites: ["sure_footing", "pace_setter"], leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.2 }, delta: {}, needsPrimitive: UNHINDERED,
        note: "CROSSLINK Boldness<->Sociability. Someone goes first and finds the ground that works." },
      { id: "farther_scout", name: "Farther Scout", cost: 1, prerequisites: ["scout_ahead"], leaning: "boldness",
        grantsPassive: { kind: "terrainUnhindered", value: 0.25 }, delta: {}, needsPrimitive: UNHINDERED },
      { id: "the_pathfinders", name: "The Pathfinders", cost: 2, prerequisites: ["farther_scout"], leaning: "sociability",
        grantsPassives: [{ kind: "terrainUnhindered", value: 0.4 }, { kind: "dispersalSpeed", value: 0.4 }], delta: {}, needsPrimitive: UNHINDERED,
        note: "BRIDGE NOTABLE. Its own bad-ground lever escalated and handed to the herd behind it." },

      // ===== Bridge S<->A: the lead. Lever: allyEffect.
      { id: "set_the_pace", name: "Set the Pace", cost: 1, prerequisites: ["pace_setter", "first_move"], leaning: "sociability",
        delta: { allyEffectOnAttack: true, allyEffect: { buff: { stat: "speed", stage: 1, ticks: 40 } } },
        note: "CROSSLINK Sociability<->Aggression. Going first drags everyone else forward with you." },
      { id: "quicker_pace", name: "Quicker Pace", cost: 1, prerequisites: ["set_the_pace"], leaning: "sociability",
        delta: { allyEffect: { buff: { stat: "speed", stage: 2, ticks: 50 } } } },
      { id: "the_lead", name: "The Lead", cost: 2, prerequisites: ["quicker_pace"], leaning: "aggression",
        delta: { allyEffect: { buff: { stat: "speed", stage: 3, ticks: 70 }, healFraction: 0.08 }, allyEffectOnAttack: true },
        note: "BRIDGE NOTABLE. Escalates the crosslink's own pace-setting lever — the leader's own speed is what the herd runs at." },
    ]),
  },
};
