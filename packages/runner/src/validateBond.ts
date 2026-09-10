/**
 * ROADMAP.md M6's acceptance — "something follows you out of the chamber"
 * — and the design's open question, as a number. A bot that does
 * everything right: walks to the chamber, gathers berries, picks the
 * nearest chamber creature (whichever species this seed's
 * CAVE_STARTER_SPECIES roll turned up), crouches, approaches to 2 tiles,
 * sets a berry down, waits near it, repeats — then walks 25 tiles into
 * the dark. On how many of 5 seeds does it follow it out? If the answer
 * is 0, the premise is in trouble, and the user hears that before any
 * overlay is built (HANDOFF.md §4).
 *
 *   pnpm --filter @pokuelike/runner exec tsx src/validateBond.ts
 */
import { advancePlayerTurn, findPlayer, harvestableAt, countOf, GATHER_TURNS, TREAT_COOLDOWN_TICKS, tileAt, rapportScore, trustStage, EventLog, type Agent, type PlayerAction, type World } from "@pokuelike/engine";
import { createCaveScenario, walkDistances, HUNT_RULES, LEVELING_CONTEXT } from "@pokuelike/data";

const SEEDS = [20260903, 11, 202, 3003, 40404];
const steps = [-1, 0, 1] as const;
const BUDGET_KEYS = 900;

function toward(world: World, dist: Map<string, number>): PlayerAction {
  const me = findPlayer(world);
  if (!me) return { kind: "wait" };
  let best: { dx: -1 | 0 | 1; dy: -1 | 0 | 1; d: number } | undefined;
  for (const dy of steps)
    for (const dx of steps) {
      if (!dx && !dy) continue;
      const d = dist.get(`${me.pos.x + dx},${me.pos.y + dy}`);
      if (d !== undefined && (!best || d < best.d)) best = { dx, dy, d };
    }
  return best ? { kind: "move", dx: best.dx, dy: best.dy } : { kind: "wait" };
}

function cheb(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

console.log("seed      berries  offers  eaten  timesFed  bestScore  stage     follower  ticksToFollow  distAfter25");
let followed = 0;
for (const seed of SEEDS) {
  const world = createCaveScenario(seed);
  const me = findPlayer(world)!;
  const log = new EventLog();
  let keys = 0;
  const act = (a: PlayerAction) => {
    advancePlayerTurn(world, a, log, HUNT_RULES, LEVELING_CONTEXT, world.rng);
    keys++;
  };
  const walkTo = (target: { x: number; y: number }, stopAt = 0, max = 120) => {
    const dist = walkDistances(world, "underground", target);
    let n = 0;
    while (n++ < max && cheb(me.pos, target) > stopAt && findPlayer(world)) act(toward(world, dist));
  };
  // 1. Berries: nearest food tile, gather until 3 berries. A real
  // starting stock (not the earlier 4-berry batch, not a single-berry
  // "always restocking" extreme tried and rejected — traced: one at a
  // time exhausts the LOCAL patches around the courting spot fast enough
  // that most of a run goes to "NO FOOD SOURCE FOUND" wandering rather
  // than actually courting. 3 respects lever 6's "camping is worse than
  // returning" without turning the bot into a full-time forager.
  const nearestFood = () => {
    const dist = walkDistances(world, "underground", me.pos);
    let best: { x: number; y: number; d: number } | undefined;
    for (const [k, d] of dist) {
      const [x, y] = k.split(",").map(Number) as [number, number];
      if (harvestableAt(world, "underground", { x, y }).includes("food") && (!best || d < best.d)) best = { x, y, d };
    }
    return best;
  };
  while (countOf(me, "food") < 3 && keys < 300) {
    const f = nearestFood();
    if (!f) break;
    walkTo(f);
    act({ kind: "gather" });
    if (!me.activity) continue;
    for (let i = 0; i < GATHER_TURNS; i++) act({ kind: "continue" });
  }
  const berries = countOf(me, "food");
  // Keep the bot alive: drink when thirsty, eat a berry when hungry.
  const nearestWater = () => {
    const dist = walkDistances(world, "underground", me.pos);
    let best: { x: number; y: number; d: number } | undefined;
    for (const [k, d] of dist) {
      const [x, y] = k.split(",").map(Number) as [number, number];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(world, "underground", x + dx, y + dy)?.terrain === "water" && (!best || d < best.d)) best = { x, y, d };
    }
    return best;
  };
  const upkeep = () => {
    if (me.needs.thirst < 0.45) {
      const w = nearestWater();
      if (w) {
        walkTo(w, 0, 80);
        act({ kind: "drink" });
      }
    }
    if (me.needs.hunger < 0.45) {
      const f = nearestFood();
      if (f && f.d < 40) {
        walkTo(f, 0, 60);
        act({ kind: "eat" });
      }
    }
  };
  // Chase a moving creature: re-plan from its CURRENT position every step,
  // standing while far (crouched steps cost 1.5 turns) and crouching once
  // within 5. The first bots walked to a stale position and never got
  // closer than 12 tiles to a roaming chamber creature.
  const approach = (who: Agent, stopAt: number, max: number) => {
    let n = 0;
    while (n++ < max && cheb(me.pos, who.pos) > stopAt && findPlayer(world) && who.alive !== false) {
      const near = cheb(me.pos, who.pos) <= 5;
      if (near && me.posture !== "crouch") act({ kind: "crouch" });
      if (!near && me.posture === "crouch") act({ kind: "crouch" });
      const dist = walkDistances(world, "underground", who.pos);
      act(toward(world, dist));
      if (n % 10 === 0) upkeep();
    }
  };
  // 2. Court ONE chamber creature — picked once (nearest at the start)
  // and kept for the whole run. Levers 3 (habituation) and 6 (visit
  // accrual) both reward staying with the same individual; the earlier
  // bot re-picked "nearest" every loop, which is a worse player strategy
  // now that repeat feeding compounds. Lever 5 (herd spillover) still
  // lifts the rest of the herd a little regardless.
  let offers = 0;
  let eaten = 0;
  let bestScore = 0;
  let target: Agent | undefined;
  let followTick: number | undefined;
  const pickTarget = (): Agent | undefined => {
    const herd = world.agents.filter((a) => a.herdId?.endsWith("-herd") && a.alive !== false && a.layer === "underground");
    if (herd.length === 0) return undefined;
    return herd.reduce((a, b) => (cheb(a.pos, me.pos) <= cheb(b.pos, me.pos) ? a : b));
  };
  target = pickTarget();
  while (keys < BUDGET_KEYS && findPlayer(world) && target) {
    if (target.alive === false || target.layer !== "underground") {
      target = pickTarget();
      if (!target) break;
    }
    if (target.followingId === me.id) {
      followTick = followTick ?? world.tick;
      break;
    }
    // Three tiles, not two: a crouched human's radius is 2 (2.5 while
    // stepping), so at 2 the target is already fleeing when the berry goes
    // down and the treat rule never gets a turn.
    if (cheb(target.pos, me.pos) > 3) {
      approach(target, 3, 40);
      if (cheb(target.pos, me.pos) > 3) continue;
    }
    if (me.posture !== "crouch") act({ kind: "crouch" });
    upkeep();
    // Do not waste a berry inside the creature's treat cooldown: wait it out beside it.
    if (target.lastTreatTick !== undefined && target.lastTreatTick + TREAT_COOLDOWN_TICKS > world.tick) {
      for (let i = 0; i < 4; i++) act({ kind: "wait" });
      continue;
    }
    if (countOf(me, "food") > 0 && offers < 20) {
      act({ kind: "offer" });
      if (me.lastActionOutcome?.ok) offers++;
      // No retreat — lever 2 (the gift moment) collapses the player's
      // threat signature for a window right after the offer, which is
      // the whole point: the creature can close the last few tiles and
      // eat without the player having to abandon the spot first.
      for (let i = 0; i < 30; i++) {
        act({ kind: "wait" });
        if (i % 5 === 4) upkeep();
        if (target.lastTreatTick !== undefined && target.lastTreatTick > world.tick - 20) break; // it took it
        if (cheb(target.pos, me.pos) > 8) break; // it wandered off; go after it
      }
    } else {
      for (let i = 0; i < 6; i++) act({ kind: "wait" });
      upkeep();
    }
    const score = rapportScore(target, me.id, world.tick);
    bestScore = Math.max(bestScore, score);
    // Restock if empty and no follower yet.
    if (countOf(me, "food") === 0 && offers < 20) {
      const f = nearestFood();
      if (f && f.d < 30) {
        walkTo(f);
        act({ kind: "gather" });
        if (me.activity) for (let i = 0; i < GATHER_TURNS; i++) act({ kind: "continue" });
        approach(target, 3, 40);
      }
    }
  }
  // Across the whole herd, not just the last target — the bot switches targets.
  const herdAll = world.agents.filter((a) => a.herdId?.endsWith("-herd"));
  eaten = herdAll.reduce((n, a) => n + (a.rapport?.[me.id]?.memories?.find((m) => m.reason === "receivedFood")?.count ?? 0), 0);
  const bestNow = herdAll.reduce((best, a) => Math.max(best, rapportScore(a, me.id, world.tick)), 0);
  bestScore = Math.max(bestScore, bestNow);
  const stages = herdAll.map((a) => trustStage(world, a, me.id));
  const stage = stages.includes("bonded") ? "bonded" : stages.includes("curious") ? "curious" : stages.includes("tolerant") ? "tolerant" : "wary";
  const follower = herdAll.some((a) => a.followingId === me.id);
  // 3. Walk 25 tiles away into the dark (toward spawn) and see who comes.
  let distAfter = -1;
  if (target) {
    const spawn = world.agents.find((a) => a.controlledBy === "player")!.pos;
    void spawn;
    const dist = walkDistances(world, "underground", { x: me.pos.x, y: me.pos.y });
    // pick the known walkable tile ~25 steps away, farthest from the chamber water
    let far: { x: number; y: number } | undefined;
    for (const [k, d] of dist) {
      if (d >= 25 && d <= 28) {
        const [x, y] = k.split(",").map(Number) as [number, number];
        far = { x, y };
        break;
      }
    }
    if (far) walkTo(far, 0, 60);
    distAfter = cheb(target.pos, me.pos);
  }
  if (follower) followed++;
  if (!findPlayer(world)) {
    const about = log.events.filter((e) => JSON.stringify(e).includes('"player"')).slice(-3);
    console.log(`  died: ${about.map((e) => JSON.stringify(e)).join(" | ")}`);
  }
  console.log(
    `${String(seed).padEnd(9)} ${String(berries).padEnd(8)} ${String(offers).padEnd(7)} ${String(eaten).padEnd(6)} ${String(target?.timesFedByPlayer ?? 0).padEnd(9)} ${bestScore.toFixed(2).padEnd(10)} ${String(stage).padEnd(9)} ${String(follower).padEnd(9)} ${String(followTick ?? "-").padEnd(14)} ${distAfter}  (keys ${keys}, tick ${world.tick}${findPlayer(world) ? "" : ", DIED"})`
  );
}
console.log(`followed out on ${followed}/${SEEDS.length} seeds`);
