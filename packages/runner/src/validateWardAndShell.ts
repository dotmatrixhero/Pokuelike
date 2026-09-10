/**
 * Do the Safeguard and Withdraw TREES actually fire in a real fight, and do
 * their effects actually land?
 *
 * A tree that checks out structurally can still be dead content: a
 * `utilityMove` never reaches the hostile hit pipeline, and
 * `maybeUseUtilityMoveInCombat` (utilityMoves.ts) decides by EFFECT FIELD —
 * it will spend a fight action only on a `selfHeal`, a positive self stat
 * change, or a `statusImmunityAura` against an opponent that can inflict a
 * status. So the only way to know a branch is live is to watch it fire.
 *
 * The fight here is real, not simulated by hand: every staged agent is a
 * `spawnAgent` agent in a `createDemoWorld` world, and the fight is driven by
 * the engine's own egg-defence path (predation.ts's `applyEggDefense`, called
 * from `tickAgentAction` inside `tickWorld`) — "extremely territorial about
 * their eggs", the one hostile trigger that fires unconditionally every
 * action tick rather than waiting on hunger and pathing. Nothing in this file
 * calls a combat primitive directly.
 *
 * Every measurement has a control, because a count of firings on its own says
 * nothing:
 *   - the BASE (untreed) move in the identical duel, so the number the tree
 *     adds is visible rather than asserted;
 *   - for Safeguard's ward, an opponent that CANNOT inflict a status, which
 *     `maybeUseUtilityMoveInCombat` refuses to spend an action warding
 *     against — same build, same duel, and it must read zero;
 *   - for the ward's reach, a same-distance bystander in a DIFFERENT herd,
 *     who must never pick up the immunity the herd-mates do.
 *
 * Run: `npx tsx packages/runner/src/validateWardAndShell.ts [ticks] [nSeeds]`
 */
import { EventLog, applyMoveTree, maybeUseUtilityMoveInCombat, tickWorld, tileAt } from "@pokuelike/engine";
import type { Agent, MoveSpec, World } from "@pokuelike/engine";
import { HUNT_RULES, IMMIGRATION_CONTEXT, LEVELING_CONTEXT, MOVES, createDemoWorld, spawnAgent } from "@pokuelike/data";

const ticks = Number(process.argv[2] ?? 600);
const nSeeds = Number(process.argv[3] ?? 3);

function rngFrom(s: number): () => number {
  let x = s >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0xffffffff;
  };
}

/** Every node on a shortest legal path to `targetId`, in a purchase order `applyMoveTree` accepts. */
function pathTo(tree: Record<string, any>, targetId: string, into: string[] = []): string[] {
  if (into.includes(targetId)) return into;
  const node = tree[targetId];
  for (const id of node.prerequisites ?? []) pathTo(tree, id, into);
  if (node.prerequisitesAnyOf?.length) {
    const best = [...node.prerequisitesAnyOf]
      .map((set: string[]) => set.flatMap((id) => pathTo(tree, id, [...into])))
      .sort((a, b) => a.length - b.length)[0];
    for (const id of best) if (!into.includes(id)) into.push(id);
  }
  if (!into.includes(targetId)) into.push(targetId);
  return into;
}

/** A walkable land tile within `spread` of `(x, y)`, or undefined. */
function walkableNear(world: World, x: number, y: number, spread: number): { x: number; y: number } | undefined {
  for (let r = 0; r <= spread; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tile = tileAt(world, "surface", x + dx, y + dy);
        if (tile?.walkable && tile.terrain !== "water") return { x: x + dx, y: y + dy };
      }
    }
  }
  return undefined;
}

interface Staged {
  world: World;
  log: EventLog;
  warden: Agent;
  herdmate: Agent;
  outsider: Agent;
  foe: Agent;
  egg: Agent;
  spots: { x: number; y: number }[];
  move: MoveSpec;
}

/**
 * A duel in a real world: the warden, one herd-mate, one same-distance
 * bystander from a DIFFERENT herd (the ward-reach control), an egg of the
 * warden's own herd, and a threat standing next to that egg.
 */
function stage(seed: number, wardenSpecies: string, move: MoveSpec, foeSpecies: string): Staged | undefined {
  const world = createDemoWorld(seed) as World;
  const anchorAgent = world.agents.find((a) => a.alive !== false);
  if (!anchorAgent) return undefined;
  const anchor = walkableNear(world, anchorAgent.pos.x, anchorAgent.pos.y, 6);
  if (!anchor) return undefined;
  const spots = [
    anchor,
    { x: anchor.x - 1, y: anchor.y },
    { x: anchor.x, y: anchor.y - 1 },
    { x: anchor.x, y: anchor.y + 1 },
    { x: anchor.x + 1, y: anchor.y },
  ];
  if (spots.some((s) => !tileAt(world, "surface", s.x, s.y)?.walkable)) return undefined;
  // A staged duel, not an ecology run: the world's own population is cleared
  // so nothing else can eat, distract or out-compete the five agents being
  // measured. The world itself (terrain, weather, flora, every system
  // `tickWorld` runs) is untouched.
  world.agents = [];

  const rng = rngFrom(seed * 31 + 7);
  const warden = spawnAgent(wardenSpecies, "warden", spots[0]!, 30, rng);
  warden.herdId = "ward";
  // The built move REPLACES the species' own copy where it has one, so the
  // agent never carries two Safeguards.
  warden.moves = [move, ...(warden.moves ?? []).filter((m) => m.id !== move.id)];
  warden.needs = { ...warden.needs, hunger: 0.9, thirst: 0.9, energy: 0.9 };

  const herdmate = spawnAgent(wardenSpecies, "herdmate", spots[1]!, 20, rng);
  herdmate.herdId = "ward";

  const outsider = spawnAgent(wardenSpecies, "outsider", spots[2]!, 20, rng);
  outsider.herdId = "elsewhere"; // control: same species, same distance, wrong herd

  const egg = spawnAgent(wardenSpecies, "egg", spots[3]!, 5, rng);
  egg.isEgg = true;
  egg.herdId = "ward";

  const foe = spawnAgent(foeSpecies, "foe", spots[4]!, 30, rng);
  foe.herdId = "raiders";
  foe.needs = { ...foe.needs, hunger: 0.9, thirst: 0.9, energy: 0.9 };

  world.agents.push(warden, herdmate, outsider, egg, foe);
  return { world, log: new EventLog(), warden, herdmate, outsider, foe, egg, spots: spots as { x: number; y: number }[], move };
}

interface Result {
  fights: number;
  fired: number;
  firedInCombat: number;
  peakStage: Record<string, number>;
  peakHerdmateImmunity: number;
  peakOutsiderImmunity: number;
  biggestHealPct: number;
  foeCanStatus: boolean;
}

function duel(seed: number, wardenSpecies: string, move: MoveSpec, foeSpecies: string): Result | undefined {
  const staged = stage(seed, wardenSpecies, move, foeSpecies);
  if (!staged) return undefined;
  const { world, log, warden, herdmate, outsider, foe, egg, spots } = staged;
  const cast = [warden, herdmate, outsider, egg, foe];
  /**
   * Re-pin the tableau every tick. Left alone the five of them wander off,
   * the egg hatches, and `maybeAutoRespec` overwrites the warden's built
   * move with a freshly-rolled one — three separate ways the duel stops
   * being the thing under test after a dozen ticks. Everything pinned here
   * is staging (who is standing where, whose egg it is, which build the
   * warden holds); nothing about how the engine DECIDES to spend the action
   * is touched.
   */
  const repin = () => {
    for (let i = 0; i < cast.length; i++) {
      cast[i]!.pos = { ...spots[i]! };
      cast[i]!.layer = "surface";
      cast[i]!.alive = true;
      cast[i]!.fainted = false;
    }
    egg.isEgg = true;
    egg.eggTicks = 0; // never hatches — a hatched egg ends the fight it exists to start
    warden.moves = [staged.move, ...(warden.moves ?? []).filter((m) => m.id !== staged.move.id)];
    // Fed and watered, so the duel is not interrupted by foraging. Hunger is
    // deliberately NOT topped up on the foe in the drain measurement below.
    for (const a of [warden, foe]) a.needs = { ...a.needs, hunger: 0.9, thirst: 0.9, energy: 0.9 };
  };
  repin();
  const res: Result = {
    fights: 0,
    fired: 0,
    firedInCombat: 0,
    peakStage: {},
    peakHerdmateImmunity: 0,
    peakOutsiderImmunity: 0,
    biggestHealPct: 0,
    foeCanStatus: (foe.moves ?? []).some((m) => (m.statusChance ?? 0) > 0),
  };
  for (let t = 0; t < ticks; t++) {
    // Attribute the heal to the MOVE rather than to the HP bar: note where
    // the log and the HP stand going in, and only count a rise on a tick the
    // move was actually used. Watching the HP bar alone counted passive
    // regen, rests, and this harness's own top-up as heals — the untreed base
    // move, which cannot heal at all, scored 31 of them that way.
    const eventsBefore = (log.events as any[]).length;
    const hpBefore = warden.hp ?? 0;
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    const usedThisTick = (log.events as any[])
      .slice(eventsBefore)
      .some((e) => e.kind === "utilityMoveUsed" && e.moveId === move.id && e.agentId === warden.id);
    if (usedThisTick && (warden.hp ?? 0) > hpBefore && warden.maxHp) {
      // The SIZE of the rise, not a count of them: passive regen also ticks
      // up on a use tick, so a count reads non-zero even for a move that
      // cannot heal (the untreed base moves score 5-6). A rise worth a
      // quarter of the HP bar is a `selfHeal`; one worth 1 HP is regen.
      res.biggestHealPct = Math.max(res.biggestHealPct, ((warden.hp ?? 0) - hpBefore) / warden.maxHp);
    }
    // Keep the duel going for the whole window: neither side is allowed to
    // die of the fight, so the sample size is the tick count rather than
    // however long the first one survived. Damage still lands; it is just
    // topped back up, which also keeps the warden cycling under the 60% HP
    // line `selfHeal` needs.
    repin();
    for (const a of [warden, herdmate, outsider, foe]) {
      if (a.hp !== undefined && a.maxHp !== undefined && a.hp < a.maxHp * 0.35) a.hp = a.maxHp * 0.55;
    }
    for (const st of warden.statStages ?? []) {
      if (st.stage > 0) res.peakStage[st.stat] = Math.max(res.peakStage[st.stat] ?? 0, st.stage);
    }
    res.peakHerdmateImmunity = Math.max(res.peakHerdmateImmunity, herdmate.statusImmuneTicksRemaining ?? 0);
    res.peakOutsiderImmunity = Math.max(res.peakOutsiderImmunity, outsider.statusImmuneTicksRemaining ?? 0);
  }

  for (const e of log.events as any[]) {
    // The control on every single row: hostile actions the warden actually
    // took. A zero in the "used" column means a dead branch only if this
    // column is non-zero — otherwise it means the duel never happened.
    if (e.kind === "eggDefended" && e.defenderId === warden.id) res.fights++;
    if (e.kind !== "utilityMoveUsed" || e.moveId !== move.id || e.agentId !== warden.id) continue;
    res.fired++;
    if (e.inCombat) res.firedInCombat++;
  }
  return res;
}

function runAcrossSeeds(label: string, wardenSpecies: string, move: MoveSpec, foeSpecies: string): Result {
  const total: Result = { fights: 0, fired: 0, firedInCombat: 0, peakStage: {}, peakHerdmateImmunity: 0, peakOutsiderImmunity: 0, biggestHealPct: 0, foeCanStatus: false };
  for (let i = 0; i < nSeeds; i++) {
    const r = duel(2000 + i * 7919, wardenSpecies, move, foeSpecies);
    if (!r) continue;
    total.fights += r.fights;
    total.fired += r.fired;
    total.firedInCombat += r.firedInCombat;
    total.biggestHealPct = Math.max(total.biggestHealPct, r.biggestHealPct);
    total.foeCanStatus = r.foeCanStatus;
    total.peakHerdmateImmunity = Math.max(total.peakHerdmateImmunity, r.peakHerdmateImmunity);
    total.peakOutsiderImmunity = Math.max(total.peakOutsiderImmunity, r.peakOutsiderImmunity);
    for (const [stat, v] of Object.entries(r.peakStage)) total.peakStage[stat] = Math.max(total.peakStage[stat] ?? 0, v);
  }
  const stages = Object.entries(total.peakStage).map(([s, v]) => `${s} +${v}`).join(", ") || "none";
  console.log(
    `  ${label.padEnd(34)} fights ${String(total.fights).padStart(4)}  used ${String(total.fired).padStart(4)} (${String(total.firedInCombat).padStart(4)} mid-fight)  ` +
      `peak self stages: ${stages.padEnd(24)} herd-mate ward ${String(total.peakHerdmateImmunity).padStart(3)}t  ` +
      `outsider ward ${String(total.peakOutsiderImmunity).padStart(3)}t  biggest hp rise on a use tick ${(total.biggestHealPct * 100).toFixed(0)}%`
  );
  return total;
}

const safeguard = MOVES.safeguard as MoveSpec;
const withdraw = MOVES.withdraw as MoveSpec;
const build = (move: MoveSpec, capstone: string) => applyMoveTree(move, pathTo(move.tree!, capstone));

let failures = 0;
const fail = (msg: string) => { console.error(`FAIL: ${msg}`); failures++; };

/**
 * `drainNeeds` is the Safeguard Aggression lane's signature lever and it is
 * IDLE-TICK ONLY — `maybeUseUtilityMoveInCombat` never drains, so the duel
 * above cannot show it. Same staged tableau, no egg and therefore no fight:
 * the warden loiters, the outsider loiters next to it, and the question is
 * whether the outsider's hunger actually moves.
 */
function idleDrain(seed: number, move: MoveSpec): { used: number; foeHungerDrop: number } {
  const staged = stage(seed, "chansey", move, "charmander");
  if (!staged) return { used: 0, foeHungerDrop: 0 };
  const { world, log, warden, foe, egg, spots } = staged;
  world.agents = world.agents.filter((a) => a.id !== egg.id); // no egg, no fight
  const cast = [warden, staged.herdmate, staged.outsider, foe];
  let drop = 0;
  for (let t = 0; t < ticks; t++) {
    tickWorld(world, log, HUNT_RULES, LEVELING_CONTEXT, world.rng, IMMIGRATION_CONTEXT);
    for (let i = 0; i < cast.length; i++) {
      cast[i]!.pos = { ...spots[i]! };
      cast[i]!.layer = "surface";
      cast[i]!.alive = true;
    }
    warden.moves = [move, ...(warden.moves ?? []).filter((m) => m.id !== move.id)];
    // Three staging pins, all of them about the warden being AVAILABLE rather
    // than about what it chooses: needs satisfied and no mate drive, so
    // `chooseBehavior` reads "idle" (the gate `maybeUseUtilityMove` sits
    // behind in needs.ts); and no shelter site, because shelter-building
    // takes the action tick and returns before that gate is ever reached —
    // which is why the first version of this measurement read a flat zero.
    warden.needs = { ...warden.needs, hunger: 0.9, thirst: 0.9, energy: 0.9, mateDrive: 0 };
    warden.shelterTarget = undefined;
    // Hunger is topped back up each tick and the shortfall banked, so the
    // measurement is the TOTAL taken over the window rather than a final
    // reading that bottoms out at zero either way. Measured across BOTH
    // non-herd agents, not just the raider: `drainNeeds` takes from the
    // NEAREST non-herd agent, and the bystander is exactly as near — reading
    // only the raider made the treed and control runs look identical.
    for (const outsiderish of [foe, staged.outsider]) {
      drop += 0.9 - outsiderish.needs.hunger;
      outsiderish.needs = { ...outsiderish.needs, hunger: 0.9 };
    }
  }
  const used = (log.events as any[]).filter(
    (e) => e.kind === "utilityMoveUsed" && e.moveId === move.id && e.agentId === warden.id && !e.inCombat
  ).length;
  return { used, foeHungerDrop: drop };
}

console.log(`${nSeeds} seeds x ${ticks} ticks, one staged egg-defence duel each.\n`);

// --- Safeguard ---------------------------------------------------------
// Charmander's Ember carries a real `statusChance`, so the ward is worth an
// action against it. Squirtle's kit carries none — that is the control.
console.log("SAFEGUARD (Chansey warden, Charmander raider — a foe that CAN inflict a status)");
const sgBase = runAcrossSeeds("base move, no tree", "chansey", safeguard, "charmander");
const sgWard = runAcrossSeeds("Sociability -> Nothing Crosses", "chansey", build(safeguard, "nothing_crosses"), "charmander");
const sgVigil = runAcrossSeeds("Boldness -> The Whole Night", "chansey", build(safeguard, "the_whole_night"), "charmander");
const sgWarden = runAcrossSeeds("Aggression -> Not Worth the Walk", "chansey", build(safeguard, "not_worth_the_walk"), "charmander");
console.log("  CONTROL — the same ward build against a foe that can inflict nothing:");
const sgControl = runAcrossSeeds("Sociability vs. Squirtle", "chansey", build(safeguard, "nothing_crosses"), "squirtle");

if (sgWard.firedInCombat === 0) fail("Safeguard's Sociability build never fired in a fight");
if (sgVigil.firedInCombat === 0) fail("Safeguard's Boldness build never fired in a fight");
if (sgWarden.firedInCombat === 0) fail("Safeguard's Aggression build never fired in a fight");
if (sgWard.peakHerdmateImmunity <= sgBase.peakHerdmateImmunity) {
  fail(`the ward tree did not widen the herd-mate's immunity window (tree ${sgWard.peakHerdmateImmunity}t vs base ${sgBase.peakHerdmateImmunity}t)`);
}
if (sgWard.peakOutsiderImmunity > 0) fail("the ward reached an agent outside the warden's herd — it is a herd effect");
if (sgControl.firedInCombat > 0) {
  fail(`the ward was spent as a fight action against a foe that cannot inflict a status (${sgControl.firedInCombat}x)`);
}
if (sgWarden.peakStage.attack === undefined) fail("Safeguard's Aggression build never landed its own Attack stage");

console.log("\n  Aggression's drain, which the fight path cannot reach at all (idle ticks only):");
let drainUsed = 0;
let drainDrop = 0;
let drainControlDrop = 0;
for (let i = 0; i < nSeeds; i++) {
  const treed = idleDrain(2000 + i * 7919, build(safeguard, "not_worth_the_walk"));
  const base = idleDrain(2000 + i * 7919, safeguard);
  drainUsed += treed.used;
  drainDrop += treed.foeHungerDrop;
  drainControlDrop += base.foeHungerDrop;
}
console.log(`    treed  — ${drainUsed} idle uses, the raider lost ${(drainDrop * 100).toFixed(0)}% hunger in total`);
console.log(`    CONTROL (base move, no drain at all) — the raider lost ${(drainControlDrop * 100).toFixed(0)}% to plain decay`);
if (drainUsed === 0) fail("Safeguard never fired on an idle tick, so the drain lane could not have been measured");
if (drainDrop <= drainControlDrop) {
  fail(`the drain lane took no more hunger off the raider than plain decay did (${(drainDrop * 100).toFixed(0)}% vs ${(drainControlDrop * 100).toFixed(0)}%)`);
}

// --- Withdraw ----------------------------------------------------------
console.log("\nWITHDRAW (Squirtle warden, Vulpix raider)");
const wdBase = runAcrossSeeds("base move, no tree", "squirtle", withdraw, "vulpix");
const wdShell = runAcrossSeeds("Boldness -> Nothing to Hit", "squirtle", build(withdraw, "nothing_to_hit"), "vulpix");
const wdRoll = runAcrossSeeds("Aggression -> Gets There First", "squirtle", build(withdraw, "the_shell_gets_there_first"), "vulpix");
const wdRoom = runAcrossSeeds("Sociability -> A Shell Is a Room", "squirtle", build(withdraw, "a_shell_is_a_room"), "vulpix");

if (wdShell.firedInCombat === 0) fail("Withdraw's Boldness build never fired in a fight");
if (wdRoll.firedInCombat === 0) fail("Withdraw's Aggression build never fired in a fight");
if (wdRoom.firedInCombat === 0) fail("Withdraw's Sociability build never fired in a fight");
if ((wdShell.peakStage.defense ?? 0) <= (wdBase.peakStage.defense ?? 0)) {
  fail(`the shell tree did not raise the Defense stage past the base move (${wdShell.peakStage.defense} vs ${wdBase.peakStage.defense})`);
}
if ((wdRoll.peakStage.speed ?? 0) === 0) fail("Withdraw's Aggression build never landed a Speed stage — the whole point is that it costs no tempo");

// --- The heal, isolated ------------------------------------------------
// The duel above cannot cleanly attribute a heal: passive regen, a rest and
// this harness's own HP top-up all move the same bar on the same tick, and
// the untreed base Withdraw scored a 16% "heal" that way. So the heal is
// measured where nothing else can touch it - a direct call into the engine's
// own `maybeUseUtilityMoveInCombat` with an rng pinned at 0 (so the 20%
// per-action roll always passes) on an agent parked at half HP. Same real
// function the fight path calls; only the noise is gone.
console.log("\nThe heal, isolated (real `maybeUseUtilityMoveInCombat`, rng pinned so it always fires):");
{
  const world = createDemoWorld(2000) as World;
  const anchor2 = { ...world.agents[0]!.pos };
  const zero = () => 0;
  const check = (label: string, wardenSpecies: string, move: MoveSpec, expected: number) => {
    const user = spawnAgent(wardenSpecies, "user", { ...anchor2 }, 30, zero);
    user.herdId = "solo";
    user.moves = [move];
    user.hp = (user.maxHp ?? 1) * 0.5;
    const opponent = spawnAgent("charmander", "opp", { x: anchor2.x + 1, y: anchor2.y }, 30, zero);
    opponent.herdId = "other";
    world.agents = [user, opponent];
    const before = user.hp;
    const spent = maybeUseUtilityMoveInCombat(world, user, opponent, undefined, zero);
    const gained = (user.hp ?? 0) - before;
    const want = (user.maxHp ?? 0) * expected;
    console.log(
      `  ${label.padEnd(30)} action spent: ${String(spent).padEnd(5)} hp ${before.toFixed(1)} -> ${(user.hp ?? 0).toFixed(1)} ` +
        `(+${gained.toFixed(1)}, expected +${want.toFixed(1)})`
    );
    if (Math.abs(gained - want) > 0.51) fail(`${label}: healed ${gained.toFixed(1)} HP, expected ${want.toFixed(1)}`);
  };
  // Control first, so the number that follows means something: the untreed
  // move has no `selfHeal` and must move the bar by exactly nothing.
  check("CONTROL base safeguard", "chansey", safeguard, 0);
  check("Safeguard Does Not Sleep", "chansey", build(safeguard, "does_not_sleep"), 0.24);
  check("CONTROL base withdraw", "squirtle", withdraw, 0);
  check("Withdraw Nothing to Hit", "squirtle", build(withdraw, "nothing_to_hit"), 0.3);
}

console.log(
  `\nControl on the controls: the untreed base moves fired too (safeguard ${sgBase.firedInCombat} mid-fight, ` +
    `withdraw ${wdBase.firedInCombat}) — so a zero above would mean a dead branch, not a dead harness.`
);
if (sgBase.firedInCombat === 0 && wdBase.firedInCombat === 0) {
  fail("no move fired at all, treed or not — the duel never happened, so nothing above is interpretable");
}

process.exit(failures ? 1 : 0);
