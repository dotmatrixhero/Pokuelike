/**
 * Do the Roost and Defense Curl trees actually FIRE, and does what they buy
 * actually land — in a real fight, on real agents, through the real engine
 * functions?
 *
 * A 45-node tree that no agent can ever trigger is unreachable content,
 * which this project treats as a bug, so every claim here is measured rather
 * than reasoned about, and every measurement has a control:
 *
 *   1. Per branch: build that branch's capstone with `applyMoveTree`, put the
 *      agent in a real fight against a real opponent, and see whether
 *      `maybeUseUtilityMoveInCombat` spends the action. Control: the SAME
 *      agent at full HP and with no status threat facing it — the branches
 *      whose trigger is "I am hurt" or "that thing can poison me" must NOT
 *      fire then, or the check would only be able to agree with itself.
 *   2. Effects landing: HP restored, stat stages written, action lock set,
 *      status immunity granted — read off the agent AFTER the call, never
 *      off the spec.
 *   3. Whole-sim: `createDemoWorld` for real ticks, counting
 *      `utilityMoveUsed` events for these two moves. Control: the count of
 *      hostile actions in the same run (no fights would mean no chance to
 *      fire, which is not the same as a broken tree).
 *
 * Run: `npx tsx packages/runner/src/validateRoostAndDefenseCurl.ts [ticks] [nSeeds]`
 */
import {
  EventLog,
  tickWorld,
  applyMoveTree,
  maybeUseUtilityMoveInCombat,
  type Agent,
  type MoveSpec,
  type MoveTreeNode,
} from "@pokuelike/engine";
import {
  createDemoWorld,
  spawnAgent,
  MOVES,
  HUNT_RULES,
  LEVELING_CONTEXT,
  IMMIGRATION_CONTEXT,
} from "@pokuelike/data";

/** status.ts's `getStatStage` is not re-exported from the package index, so read the agent's own entries — the same array it writes. */
const getStatStage = (agent: Agent, stat: string) =>
  Math.max(0, ...(agent.statStages ?? []).filter((s) => s.stat === stat).map((s) => s.stage), 0);

const ticks = Number(process.argv[2] ?? 4000);
const nSeeds = Number(process.argv[3] ?? 3);
let failures = 0;
const fail = (msg: string) => {
  console.error(`FAIL: ${msg}`);
  failures++;
};

/** Every node needed to own `targetId`, cheapest route, same walk the tests use. */
function chosenSetFor(tree: Record<string, MoveTreeNode>, targetId: string, into = new Set<string>()): string[] {
  const node = tree[targetId];
  if (!node || into.has(targetId)) return [...into];
  for (const id of node.prerequisites ?? []) chosenSetFor(tree, id, into);
  if (node.prerequisitesAnyOf?.length) for (const id of node.prerequisitesAnyOf[0]) chosenSetFor(tree, id, into);
  into.add(targetId);
  return [...into];
}

/** A real spawned agent of `species`, holding exactly `spec` as its only move. */
function fighter(world: any, species: string, id: string, x: number, y: number, spec: MoveSpec): Agent {
  const agent = {
    ...spawnAgent(species, id, { x, y }, 25, world.rng),
    moves: [spec],
    layer: "surface",
  } as Agent;
  world.agents.push(agent);
  return agent;
}

// ---------------------------------------------------------------------------
// 1 + 2. Per branch: does it fire in a fight, and does the effect land?
// ---------------------------------------------------------------------------
/** The opponent that CAN inflict a status — Ember burns, so it makes a `statusImmunityAura` worth an action. */
const THREAT_MOVE = MOVES.ember;
/** The control opponent: Tackle inflicts nothing, so an immunity aura is worth nothing against it. */
const HARMLESS_MOVE = MOVES.tackle;

type BranchCase = { move: string; species: string; branch: string; capstone: string; expect: string };
const CASES: BranchCase[] = [
  { move: "roost", species: "pidgey", branch: "boldness", capstone: "night_on_the_branch", expect: "heal" },
  { move: "roost", species: "pidgey", branch: "aggression", capstone: "it_does_not_fly", expect: "defense" },
  { move: "roost", species: "pidgey", branch: "sociability", capstone: "the_roost", expect: "immunity" },
  { move: "defense_curl", species: "geodude", branch: "aggression", capstone: "comes_back_around", expect: "speed" },
  { move: "defense_curl", species: "geodude", branch: "boldness", capstone: "nothing_to_hold", expect: "defense" },
  { move: "defense_curl", species: "geodude", branch: "sociability", capstone: "a_field_of_stones", expect: "immunity" },
];

console.log("=== 1. Every branch, in a real fight ===\n");
for (const c of CASES) {
  const base = MOVES[c.move] as MoveSpec & { tree: Record<string, MoveTreeNode> };
  // The capstone route only reaches its own branch's own nodes; the deep
  // notable is what a branch's fight-usable field usually sits on, so the
  // build is "everything on the cheapest route to this branch's capstone".
  const built = applyMoveTree(base, chosenSetFor(base.tree, c.capstone));

  const world: any = createDemoWorld(1234);
  const log = new EventLog();
  const user = fighter(world, c.species, `${c.move}-user`, 10, 10, built);
  const foe = fighter(world, "rattata", `${c.move}-foe`, 11, 10, { ...THREAT_MOVE, statusChance: 0.3 });

  // Hurt, so a `selfHeal` is worth an action (COMBAT_HEAL_HP_FRACTION = 0.6).
  user.hp = Math.floor((user.maxHp ?? 20) * 0.4);
  const hpBefore = user.hp;

  // A real rng, not an always-zero one: `maybeUseUtilityMoveInCombat` rolls
  // COMBAT_UTILITY_USE_CHANCE (0.2) per action, so this is 60 real action
  // opportunities against a real opponent, not one rigged call.
  let fired = 0;
  for (let i = 0; i < 60; i++) {
    if (maybeUseUtilityMoveInCombat(world, user, foe, log, world.rng)) fired++;
    user.moveCooldowns = {}; // stand in for the ticks between actions
  }

  const speed = getStatStage(user, "speed");
  const defense = getStatStage(user, "defense");
  const healed = (user.hp ?? 0) - hpBefore;
  const locked = user.actionLockTicks ?? 0;
  const immune = user.statusImmuneTicksRemaining ?? 0;
  console.log(
    `${c.move}/${c.branch} (${c.capstone}): fired ${fired}x  ` +
      `hp ${hpBefore}->${user.hp} (+${healed})  speed stage ${speed}  defense stage ${defense}  ` +
      `lock ${locked}  statusImmune ${immune}`
  );
  if (fired === 0) fail(`${c.move}/${c.branch} never spent a fight action — the branch is unreachable in combat`);
  if (c.expect === "heal" && healed <= 0) fail(`${c.move}/${c.branch} fired but healed nothing`);
  if (c.expect === "speed" && speed <= 0) fail(`${c.move}/${c.branch} fired but wrote no Speed stage`);
  if (c.expect === "defense" && defense <= 0) fail(`${c.move}/${c.branch} fired but wrote no Defense stage`);
  if (c.expect === "immunity" && immune <= 0) fail(`${c.move}/${c.branch} fired but granted no status immunity`);
  if (c.move === "roost" && c.branch === "boldness" && locked <= 0) {
    fail("Roost's landing cost never landed — lockTicks did not reach actionLockTicks");
  }
  if (c.move === "defense_curl" && locked !== 0) {
    fail("Defense Curl locked its user — it is supposed to have no lockTicks anywhere (that is Harden)");
  }
}

// ---------------------------------------------------------------------------
// The controls. Same code, same agents, conditions under which these branches
// must NOT fire — a check that can only agree with you is not a check.
// ---------------------------------------------------------------------------
console.log("\n=== 2. Controls ===\n");
{
  // Control A: a HEALTHY Roost user with only the Boldness heal build. Its
  // one trigger is "I am under 60% HP", so at full health it must sit still.
  const base = MOVES.roost as MoveSpec & { tree: Record<string, MoveTreeNode> };
  const built = applyMoveTree(base, chosenSetFor(base.tree, "settled_in"));
  const world: any = createDemoWorld(1234);
  const log = new EventLog();
  const user = fighter(world, "pidgey", "ctrl-healthy", 10, 10, built);
  const foe = fighter(world, "rattata", "ctrl-healthy-foe", 11, 10, HARMLESS_MOVE);
  user.hp = user.maxHp;
  let fired = 0;
  for (let i = 0; i < 60; i++) {
    if (maybeUseUtilityMoveInCombat(world, user, foe, log, world.rng)) fired++;
    user.moveCooldowns = {};
  }
  console.log(`control A — Roost (heal build) at FULL hp: fired ${fired}x  (expected 0)`);
  if (fired !== 0) fail("a full-HP agent spent fight actions on a heal it did not need");
}
{
  // Control B: the Sociability immunity build against an opponent that
  // cannot inflict any status at all. `maybeUseUtilityMoveInCombat` gates
  // the aura on `opponentCanInflictStatus`, so this must stay silent.
  const base = MOVES.defense_curl as MoveSpec & { tree: Record<string, MoveTreeNode> };
  const built = applyMoveTree(base, chosenSetFor(base.tree, "closed_heap"));
  const world: any = createDemoWorld(1234);
  const log = new EventLog();
  const user = fighter(world, "geodude", "ctrl-immune", 10, 10, { ...built, statChangeOnHit: undefined });
  const foe = fighter(world, "rattata", "ctrl-immune-foe", 11, 10, HARMLESS_MOVE);
  user.hp = user.maxHp;
  let fired = 0;
  for (let i = 0; i < 60; i++) {
    if (maybeUseUtilityMoveInCombat(world, user, foe, log, world.rng)) fired++;
    user.moveCooldowns = {};
  }
  console.log(`control B — Defense Curl (aura build) vs a foe with no status move: fired ${fired}x  (expected 0)`);
  if (fired !== 0) fail("a status-immunity aura was spent against an opponent that can inflict nothing");
}
{
  // Control C: the BASE moves, untreed, in the same fight as case 1. This is
  // what the tree is measured against — if the built numbers matched these,
  // the 45 nodes would be decoration.
  for (const [moveId, species] of [["roost", "pidgey"], ["defense_curl", "geodude"]] as const) {
    const world: any = createDemoWorld(1234);
    const log = new EventLog();
    const user = fighter(world, species, `ctrl-base-${moveId}`, 10, 10, MOVES[moveId]);
    const foe = fighter(world, "rattata", `ctrl-base-${moveId}-foe`, 11, 10, { ...THREAT_MOVE, statusChance: 0.3 });
    user.hp = Math.floor((user.maxHp ?? 20) * 0.4);
    const hpBefore = user.hp;
    for (let i = 0; i < 60; i++) {
      maybeUseUtilityMoveInCombat(world, user, foe, log, world.rng);
      user.moveCooldowns = {};
    }
    console.log(
      `control C — base ${moveId}: hp +${(user.hp ?? 0) - hpBefore}  ` +
        `speed stage ${getStatStage(user, "speed")}  defense stage ${getStatStage(user, "defense")}  ` +
        `lock ${user.actionLockTicks ?? 0}  statusImmune ${user.statusImmuneTicksRemaining ?? 0}`
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Unarranged: a real world, ticked normally, nobody choosing anything.
// ---------------------------------------------------------------------------
// The shipped `createDemoWorld` roster contains no Pidgey at all and very
// few Geodude, so a plain demo run measures the demo world's species list
// rather than these trees — `validateUtilityMoves.ts` on that same world
// logs 1 Defense Curl use and 0 Roost uses in 4000 ticks for exactly that
// reason. So the learners are SPAWNED IN, and then nothing else is
// arranged: no forced fights, no hand-set HP, no rigged rng.
console.log("\n=== 3. Unarranged: learners spawned into a real world, then just ticked ===\n");
{
  let hostileActions = 0;
  let learnerTicks = 0;
  const counts = new Map<string, { idle: number; combat: number }>();
  const alive = new Map<string, number>();
  const idleGate = new Map<string, number>();
  const fightGate = new Map<string, number>();
  /** Attacker-side hostile actions by a learner — the REAL denominator for the in-combat path: `maybeUseUtilityMoveInCombat` is called from `resolveHit` on the ATTACKER only (predation.ts:1302), so a learner that only ever gets hunted never reaches it however long it spends in behaviour=fight. */
  const attacked = new Map<string, number>();
  for (let s = 0; s < nSeeds; s++) {
    const world: any = createDemoWorld(2000 + s * 7919);
    const log = new EventLog();
    for (let i = 0; i < 6; i++) {
      fighter(world, "pidgey", `harness-pidgey-${s}-${i}`, 12 + i, 12, MOVES.roost);
      fighter(world, "geodude", `harness-geodude-${s}-${i}`, 12 + i, 14, MOVES.defense_curl);
    }
    for (let t = 0; t < ticks; t++) {
      tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
      for (const a of world.agents as Agent[]) {
        if (a.alive === false) continue;
        const which = a.species === "pidgey" ? "roost" : a.species === "geodude" ? "defense_curl" : undefined;
        if (!which) continue;
        learnerTicks++;
        alive.set(which, (alive.get(which) ?? 0) + 1);
        // The out-of-combat trigger is gated on `chooseBehavior(agent.needs)
        // === "idle"` (needs.ts:1719), so counting the ticks that actually
        // clear that gate is what makes a zero interpretable.
        if (a.behavior === "idle") idleGate.set(which, (idleGate.get(which) ?? 0) + 1);
        if (a.behavior === "fight") fightGate.set(which, (fightGate.get(which) ?? 0) + 1);
      }
    }
    for (const e of log.events as any[]) {
      if (e.kind === "fought" || e.kind === "killed" || e.kind === "defeated") hostileActions++;
      if (e.kind === "fought") {
        const which = e.attackerSpecies === "pidgey" ? "roost" : e.attackerSpecies === "geodude" ? "defense_curl" : undefined;
        if (which) attacked.set(which, (attacked.get(which) ?? 0) + 1);
      }
      if (e.kind !== "utilityMoveUsed") continue;
      if (e.moveId !== "roost" && e.moveId !== "defense_curl") continue;
      const c = counts.get(e.moveId) ?? { idle: 0, combat: 0 };
      if (e.inCombat) c.combat++;
      else c.idle++;
      counts.set(e.moveId, c);
    }
  }
  console.log(`${nSeeds} seeds x ${ticks} ticks`);
  console.log(`  hostile actions resolved   ${hostileActions}   <-- control: no fights would mean no chance to fire in one`);
  console.log(`  ticks with a learner alive ${learnerTicks}   <-- control: a move nothing alive knows cannot be used`);
  for (const moveId of ["roost", "defense_curl"]) {
    const c = counts.get(moveId) ?? { idle: 0, combat: 0 };
    const live = alive.get(moveId) ?? 0;
    const idleTicks = idleGate.get(moveId) ?? 0;
    const fightTicks = fightGate.get(moveId) ?? 0;
    const swings = attacked.get(moveId) ?? 0;
    console.log(
      `  ${moveId.padEnd(14)} used: idle ${String(c.idle).padStart(4)}  in combat ${String(c.combat).padStart(4)}` +
        `   | learner alive-ticks ${String(live).padStart(6)}, of which behaviour=idle ${String(idleTicks).padStart(5)}` +
        `, behaviour=fight ${String(fightTicks).padStart(4)}, attacker-side swings ${String(swings).padStart(4)}`
    );
    // The bar for calling this a TREE problem: the learner actually reached
    // the two call sites often enough that firing zero times is not just the
    // 15%/20% rolls coming up empty. Anything less and the honest answer is
    // the exposure finding below, not a verdict on the tree.
    if (c.idle + c.combat === 0 && idleTicks > 100 && swings > 100) {
      fail(`${moveId} never fired despite ${idleTicks} idle ticks and ${swings} attacker-side swings — that is a tree problem`);
    }
    if (c.idle + c.combat === 0) {
      console.log(
        `  FINDING (an exposure gap, not a tree gap): ${moveId}'s learners were behaviour=idle on ${idleTicks} of ` +
          `${live} alive-ticks (${((idleTicks / Math.max(1, live)) * 100).toFixed(2)}%) and landed ${swings} ` +
          `attacker-side hostile actions. The out-of-combat trigger needs \`chooseBehavior(...) === "idle"\` ` +
          `(needs.ts:1719) and then a 15% roll; the in-combat one is only ever called on the ATTACKER ` +
          `(predation.ts:1302) and then rolls 20%. A species that neither idles nor initiates fights can hold any ` +
          `utility move at all and effectively never use it — this is roster-wide, not specific to this tree, and ` +
          `section 1 above shows every branch of it firing the moment the agent does reach that call.`
      );
    }
  }
}

console.log(failures === 0 ? "\nOK — every branch fired, every control stayed quiet." : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
