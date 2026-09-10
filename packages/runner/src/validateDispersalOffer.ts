/**
 * CAMPAIGN_DESIGN.md's "dispersal offer" (the two doors) is explicitly
 * "Status: not decided" and names a measurement gate before building
 * anything: "How many dispersal events actually fire in a layer-1-sized
 * region over a layer-1-length run (~400 turns), across several seeds? If
 * the answer is near zero, this path never fires in a real run." This
 * script is that measurement, run before writing any game code.
 *
 * Part A: baseline dispersal frequency — does `maybeTriggerDispersal` fire
 * AT ALL for this cave herd shape (4 members, one species, no age set —
 * i.e. already mature at spawn) within a real run's tick budget, with no
 * player involved at all.
 *
 * Part B: the actual question the doc asks — reusing `validateBond.ts`'s
 * real courting bot, does a herd member ever disperse WHILE also holding
 * real trust toward the player (the "disperser door" intersection), and
 * separately, does any herd member ever reach Bonded (0.5) trust at all
 * (the threshold CAMPAIGN_DESIGN.md's "two doors" both fire at, not just
 * Curious — the threshold the existing simple follower door already uses).
 *
 *   pnpm --filter @pokuelike/runner exec tsx src/validateDispersalOffer.ts
 */
import {
  advancePlayerTurn,
  findPlayer,
  harvestableAt,
  countOf,
  GATHER_TURNS,
  TREAT_COOLDOWN_TICKS,
  tileAt,
  rapportScore,
  trustStage,
  TRUST_BONDED,
  tickWorld,
  type Agent,
  type PlayerAction,
  type World,
} from "@pokuelike/engine";
import { createCaveScenario, walkDistances, HUNT_RULES, LEVELING_CONTEXT } from "@pokuelike/data";

const SEEDS = [20260903, 11, 202, 3003, 40404, 77, 888, 5150];
const TICK_BUDGET = 6000;

console.log("=== Part A: baseline dispersal, no player, world ticked forward ===");
console.log(`${TICK_BUDGET} ticks, ${SEEDS.length} seeds, tracking the herd's ${4} members`);
console.log("seed      dispersalEvents  reasons");
let baselineTotal = 0;
for (const seed of SEEDS) {
  const world = createCaveScenario(seed);
  const herdIds = new Set(world.agents.filter((a) => a.herdId?.endsWith("-herd")).map((a) => a.id));
  const reasons: string[] = [];
  for (let t = 0; t < TICK_BUDGET; t++) {
    tickWorld(world, undefined, HUNT_RULES, LEVELING_CONTEXT, world.rng);
    for (const a of world.agents) {
      if (!herdIds.has(a.id)) continue;
      if (a.dispersalTarget && !(a as { _seen?: boolean })._seen) {
        (a as { _seen?: boolean })._seen = true;
        reasons.push(a.dispersalReason ?? "?");
      }
    }
  }
  baselineTotal += reasons.length;
  console.log(`${String(seed).padEnd(9)} ${String(reasons.length).padEnd(16)} ${reasons.join(", ") || "-"}`);
}
console.log(`Total baseline dispersal events across ${SEEDS.length} seeds: ${baselineTotal}`);

console.log("\n=== Part B: real courting bot — does a disperser ever have real trust, does anyone reach Bonded ===");
const steps = [-1, 0, 1] as const;
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

console.log("seed      bestTrustAny  reachedBonded  disperser+trust");
for (const seed of SEEDS) {
  const world = createCaveScenario(seed);
  const me = findPlayer(world)!;
  const log = undefined;
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
  const nearestFood = () => {
    const dist = walkDistances(world, "underground", me.pos);
    let best: { x: number; y: number; d: number } | undefined;
    for (const [k, d] of dist) {
      const [x, y] = k.split(",").map(Number) as [number, number];
      if (harvestableAt(world, "underground", { x, y }).includes("food") && (!best || d < best.d)) best = { x, y, d };
    }
    return best;
  };
  while (countOf(me, "food") < 5 && keys < 300) {
    const f = nearestFood();
    if (!f) break;
    walkTo(f);
    act({ kind: "gather" });
    if (!me.activity) continue;
    for (let i = 0; i < GATHER_TURNS; i++) act({ kind: "continue" });
  }
  const upkeep = () => {
    if (me.needs.thirst < 0.5) {
      const dist = walkDistances(world, "underground", me.pos);
      let best: { x: number; y: number; d: number } | undefined;
      for (const [k, d] of dist) {
        const [x, y] = k.split(",").map(Number) as [number, number];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(world, "underground", x + dx, y + dy)?.terrain === "water" && (!best || d < best.d)) best = { x, y, d };
      }
      if (best) {
        walkTo(best, 0, 80);
        act({ kind: "drink" });
      }
    }
    if (me.needs.hunger < 0.5) {
      const f = nearestFood();
      if (f && f.d < 40) {
        walkTo(f, 0, 60);
        act({ kind: "eat" });
      }
    }
  };
  const approach = (who: Agent, stopAt: number, max: number) => {
    let n = 0;
    while (n++ < max && cheb(me.pos, who.pos) > stopAt && findPlayer(world) && who.alive !== false) {
      const near = cheb(me.pos, who.pos) <= 5;
      if (near && me.posture !== "crouch") act({ kind: "crouch" });
      if (!near && me.posture === "crouch") act({ kind: "crouch" });
      const dist = walkDistances(world, "underground", who.pos);
      act(toward(world, dist));
      if (n % 5 === 0) upkeep();
    }
  };
  const pickTarget = (): Agent | undefined => {
    const herd = world.agents.filter((a) => a.herdId?.endsWith("-herd") && a.alive !== false && a.layer === "underground");
    if (herd.length === 0) return undefined;
    return herd.reduce((a, b) => (cheb(a.pos, me.pos) <= cheb(b.pos, me.pos) ? a : b));
  };
  let target = pickTarget();
  let bestTrustAny = 0;
  let reachedBonded = false;
  let disperserTrustNote = "-";
  const seenDispersers = new Set<string>();
  while (keys < 3000 && findPlayer(world) && target) {
    if (target.alive === false || target.layer !== "underground") {
      target = pickTarget();
      if (!target) break;
    }
    // Track every herd member's trust and dispersal status this tick, not just the current target.
    for (const a of world.agents) {
      if (!a.herdId?.endsWith("-herd") || a.alive === false) continue;
      const score = rapportScore(a, me.id, world.tick);
      bestTrustAny = Math.max(bestTrustAny, score);
      if (score >= TRUST_BONDED) reachedBonded = true;
      if (a.dispersalTarget && !seenDispersers.has(a.id)) {
        seenDispersers.add(a.id);
        disperserTrustNote = `${a.species}#${a.id.slice(-1)} trust=${score.toFixed(2)} stage=${trustStage(world, a, me.id)}`;
      }
    }
    if (cheb(target.pos, me.pos) > 3) {
      approach(target, 3, 40);
      if (cheb(target.pos, me.pos) > 3) continue;
    }
    if (me.posture !== "crouch") act({ kind: "crouch" });
    upkeep();
    if (target.lastTreatTick !== undefined && target.lastTreatTick + TREAT_COOLDOWN_TICKS > world.tick) {
      for (let i = 0; i < 4; i++) act({ kind: "wait" });
      continue;
    }
    if (countOf(me, "food") > 0) {
      act({ kind: "offer" });
      for (let i = 0; i < 30; i++) {
        act({ kind: "wait" });
        if (i % 5 === 4) upkeep();
        if (target.lastTreatTick !== undefined && target.lastTreatTick > world.tick - 20) break;
        if (cheb(target.pos, me.pos) > 8) break;
      }
    } else {
      for (let i = 0; i < 6; i++) act({ kind: "wait" });
      upkeep();
    }
    if (countOf(me, "food") === 0) {
      const f = nearestFood();
      if (f && f.d < 30) {
        walkTo(f);
        act({ kind: "gather" });
        if (me.activity) for (let i = 0; i < GATHER_TURNS; i++) act({ kind: "continue" });
        approach(target, 3, 40);
      }
    }
  }
  console.log(`${String(seed).padEnd(9)} ${bestTrustAny.toFixed(2).padEnd(13)} ${String(reachedBonded).padEnd(14)} ${disperserTrustNote} (keys ${keys}, tick ${world.tick})`);
}
