/**
 * Roll random skill-tree builds and print them in plain English.
 *
 *   npx tsx packages/runner/src/rollBuilds.ts [count] [seed] [moveId]
 *
 * Direct ask: "It's really hard for me to review the builds... random sample
 * builds for me and output them? Like roll random skill points and just
 * explain all nodes you've taken and final stats + effects?"
 *
 * The point is that these are REAL builds, not synthetic ones: every point is
 * spent by the engine's own `maybeAutoRespec` on a real spawned agent with a
 * real disposition, so what prints is what the sim actually produces —
 * including its banking, its focus bias and its exclusion handling. A roller
 * that picked nodes itself would be reviewing my sampling, not the game.
 *
 * The prose comes from `moveTreeSvg.ts`'s `describeDelta`/`describePassive`,
 * the same translators the Move Tree Atlas uses, so a node reads identically
 * here and there rather than drifting into a second vocabulary.
 */
import { applyMoveTree, grantSkillPoint, type LevelingContext } from "@pokuelike/engine";
import { LEVELING_CONTEXT, MOVES, SPECIES, spawnAgent } from "@pokuelike/data";
import { describeMoveTreeNode, summarizeBuildEffects } from "../../web/src/moveTreeSvg.js";

const count = Number(process.argv[2] ?? 5);
const seed = Number(process.argv[3] ?? 42);
const onlyMove = process.argv[4] && process.argv[4] !== "--md" ? process.argv[4] : undefined;
/** `--md` anywhere in the args switches to Markdown, for reading in a doc viewer rather than a terminal. */
const md = process.argv.includes("--md");

/** Deterministic rng so a printed build can be reproduced from its seed. */
function rngFrom(s: number): () => number {
  let x = s >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0xffffffff;
  };
}

const treedMoves = (Object.values(MOVES) as any[]).filter((m) => m.tree && Object.keys(m.tree).length);
const learnersOf = (moveId: string) =>
  (Object.values(SPECIES) as any[]).filter((sp) => (sp.moves ?? []).includes(moveId));

const rng = rngFrom(seed);
const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
/** Identity/immutable fields — never differ between a base move and its build, so listing them is noise. */
const SKIP_FIELDS = new Set(["id", "name", "tree", "type", "category", "pp"]);
const fmt = (v: any): string => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

if (md) console.log(`# ${count} random builds\n\nSeed \`${seed}\` — reproduce with \`npx tsx packages/runner/src/rollBuilds.ts ${count} ${seed} --md\`.\n\nEvery point below was spent by the engine's own \`maybeAutoRespec\` on a real spawned agent with a real disposition — these are builds the sim actually produces, not ones I picked.\n`);
else console.log(`${count} random builds — seed ${seed}\n`);

for (let i = 0; i < count; i++) {
  const move = onlyMove ? treedMoves.find((m) => m.id === onlyMove) : pick(treedMoves);
  if (!move) { console.error(`no tree for "${onlyMove}"`); process.exit(1); }
  const learners = learnersOf(move.id);
  if (learners.length === 0) { i--; continue; } // nothing learns it — reroll rather than print a fake owner
  const species = pick(learners);
  const level = 20 + Math.floor(rng() * 30);
  const points = 6 + Math.floor(rng() * 30);

  const agent: any = spawnAgent(species.id, `roll-${i}`, { x: 0, y: 0 }, level, rng);
  // Spend through the real engine. A world stub is enough: grantSkillPoint
  // only reads world.tick for the log, and we pass no log.
  const world: any = { tick: 0, agents: [agent] };
  const ctx: LevelingContext = LEVELING_CONTEXT as any;
  const type = move.type;
  for (let p = 0; p < points; p++) grantSkillPoint(agent, type, world, undefined, ctx, rng);

  const chosen: string[] = agent.moveTreeChoices?.[move.id.toUpperCase()] ?? agent.moveTreeChoices?.[move.id] ?? [];
  const disp = agent.disposition ?? {};
  const dispStr = ["aggression", "boldness", "sociability"]
    .map((k) => `${k[0].toUpperCase()}${(disp[k] ?? 0).toFixed(2)}`).join(" ");

  if (md) {
    console.log(`\n---\n\n# ${i + 1}. ${species.name ?? species.id} — ${move.name}`);
    console.log(`\nLevel ${level} · disposition ${dispStr} · ${points} points granted, **${chosen.length} nodes taken**`);
  } else {
    console.log("=".repeat(74));
    console.log(`BUILD ${i + 1}: ${species.name ?? species.id} (lv ${level}) — ${move.name}`);
    console.log(`  disposition ${dispStr}   |   ${points} points granted, ${chosen.length} nodes taken`);
    console.log("=".repeat(74));
  }

  // Where the points ACTUALLY went. `maybeAutoRespec` spends across every
  // move the agent knows, not just the one being sampled, and it banks when
  // it is one point short of something — so "bought nothing here" is usually
  // "bought things elsewhere", and printing only the sampled move made the
  // engine look broken when it was working.
  const spread = Object.entries(agent.moveTreeChoices ?? {})
    .map(([k, v]) => `${k.toLowerCase()} ${(v as string[]).length}`)
    .join(", ");
  const bankLine = `points went to: ${spread || "nothing"} — still banked: ${agent.skillPoints?.[type] ?? 0} typed + ${agent.wildcardSkillPoints ?? 0} wildcard`;
  console.log(md ? `\n> ${bankLine}` : `  ${bankLine}`);

  if (chosen.length === 0) {
    console.log(md ? `\n_Nothing bought on ${move.name} itself — see the spread above._` : `  (nothing bought on ${move.name} itself — see the spread above)\n`);
    continue;
  }

  const nodeBlock = () => {
    for (const id of chosen) {
      const node = move.tree[id];
      if (!node) continue;
      const lines = describeMoveTreeNode(node).filter((l) => !l.startsWith("Leans:"));
      if (md) {
        console.log(`- **${node.name}** — _${node.leaning}, ${node.cost}pt_`);
        for (const l of lines) console.log(`  - ${l}`);
      } else {
        console.log(`    • ${node.name}  [${node.leaning}, ${node.cost}pt]`);
        for (const l of lines) console.log(`        ${l}`);
      }
    }
  };

  const built = applyMoveTree(move, chosen);

  // The numbers a balance read actually needs, computed the way the engine
  // computes them rather than eyeballed off the field list: damage per ACTION
  // (cooldowns tick on the agent's own action clock, so power alone is
  // misleading), and the weight term folded in at this agent's real maxHp.
  const perAction = (m: any) => {
    const hits = m.hits ? (m.hits.min + m.hits.max) / 2 : 1;
    const weight = m.weightScaling ? m.weightScaling.factor * (agent.maxHp ?? 0) : 0;
    return ((m.power + weight) * hits) / (m.cooldownTicks + 1);
  };
  const before = perAction(move), after = perAction(built);
  const weightNote = built.weightScaling
    ? `  (+${(built.weightScaling.factor * (agent.maxHp ?? 0)).toFixed(1)} from weight at ${agent.maxHp} maxHp)`
    : "";
  const glance: [string, string][] = [
    ["power", `${move.power} → ${built.power}${weightNote}`],
    ["cooldown", `${move.cooldownTicks} → ${built.cooldownTicks} ticks (usable every ${built.cooldownTicks + 1} actions)`],
    ["accuracy", `${move.accuracy} → ${built.accuracy}`],
    ["damage/action", `${before.toFixed(1)} → ${after.toFixed(1)} (**${(after / before).toFixed(2)}×**)`],
  ];

  const { totalCost, deltaLines, passiveLines } = summarizeBuildEffects(move.tree, chosen);

  if (md) {
    console.log("\n## At a glance\n");
    console.log("| | |\n|---|---|");
    for (const [k, v] of glance) console.log(`| ${k} | ${v} |`);

    console.log(`\n## What the build does\n\n_${totalCost} points spent._\n`);
    for (const l of deltaLines) console.log(`- ${l}`);
    if (passiveLines.length) {
      console.log("\n## Passives it now carries\n\n_These stack across every move the agent knows._\n");
      for (const l of passiveLines) console.log(`- ${l}`);
    }

    console.log("\n<details><summary>Final spec vs. base</summary>\n");
    console.log("| field | base | built |\n|---|---|---|");
    for (const k of [...new Set([...Object.keys(move), ...Object.keys(built)])].sort()) {
      if (SKIP_FIELDS.has(k)) continue;
      const a = fmt((move as any)[k]), b = fmt((built as any)[k]);
      if (a !== b) console.log(`| \`${k}\` | ${a} | ${b} |`);
    }
    console.log("\n</details>");

    // Nodes last: the summary above is what a review actually reads, and the
    // node list is the receipt you check it against.
    console.log("\n## Nodes\n");
    nodeBlock();
  } else {
    console.log("\n  AT A GLANCE:");
    for (const [k, v] of glance) console.log(`    ${k.padEnd(15)} ${v.replace(/\*\*/g, "")}`);

    console.log(`\n  WHAT THE BUILD DOES (${totalCost} points spent):`);
    for (const l of deltaLines) console.log(`    - ${l}`);
    if (passiveLines.length) {
      console.log("\n  PASSIVES IT NOW CARRIES (these stack across every move it knows):");
      for (const l of passiveLines) console.log(`    - ${l}`);
    }

    console.log("\n  FINAL MOVE vs. its base:");
    for (const k of [...new Set([...Object.keys(move), ...Object.keys(built)])].sort()) {
      if (SKIP_FIELDS.has(k)) continue;
      const a = fmt((move as any)[k]), b = fmt((built as any)[k]);
      if (a !== b) console.log(`    ${k.padEnd(20)} ${a}  ->  ${b}`);
    }

    console.log("\n  NODES TAKEN, in the order the engine bought them:");
    nodeBlock();
  }
  console.log();
}
