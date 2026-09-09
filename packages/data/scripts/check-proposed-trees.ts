/**
 * Structural check for proposed-trees.ts against the shipped standard
 * (MOVES_DESIGN.md's "Crosslinks are bridges, not spurs"). Run:
 *
 *   npx tsx packages/data/scripts/check-proposed-trees.ts
 *
 * A validator that has never printed a failure has not been verified, so
 * this one is exercised against a deliberately-broken tree in the same run
 * (--selftest) before it is trusted on the real ones.
 */
import { PROPOSED_TREES, type ProposedMove, type ProposedNode } from "./proposed-trees.js";

const SHIPPED = { anyOf: 9, forks: 6, bridges: 3 };

function problems(move: ProposedMove): string[] {
  const t = move.tree;
  const nodes = Object.values(t);
  const out: string[] = [];
  const isCrosslink = (n: ProposedNode) => (n.prerequisites ?? []).length > 1;

  for (const n of nodes) {
    for (const p of [...(n.prerequisites ?? []), ...(n.prerequisitesAnyOf ?? []).flat()]) {
      if (!t[p]) out.push(`${n.id}: prerequisite "${p}" does not exist`);
    }
    for (const x of n.excludes ?? []) {
      if (!t[x]) out.push(`${n.id}: excludes "${x}" does not exist`);
      else if (!(t[x].excludes ?? []).includes(n.id)) out.push(`${n.id}/${x}: fork declared on one side only`);
    }
    if (!n.leaning) out.push(`${n.id}: missing leaning (would render invisibly in the atlas)`);
  }

  const anyOf = nodes.filter((n) => n.prerequisitesAnyOf).length;
  const forks = nodes.filter((n) => n.excludes?.length).length;
  const crosslinks = nodes.filter(isCrosslink);
  if (anyOf !== SHIPPED.anyOf) out.push(`${anyOf} prerequisitesAnyOf, shipped standard is ${SHIPPED.anyOf}`);
  if (forks !== SHIPPED.forks) out.push(`${forks} fork nodes, shipped standard is ${SHIPPED.forks}`);
  if (crosslinks.length !== SHIPPED.bridges) out.push(`${crosslinks.length} crosslinks, shipped standard is ${SHIPPED.bridges}`);

  // Every crosslink must head a real three-node bridge whose notable is an
  // alternate route into BOTH branches it connects (principle 11), landing
  // one step short of a fork, never on it (principle 12).
  for (const cross of crosslinks) {
    const mid = nodes.find((n) => (n.prerequisites ?? []).length === 1 && n.prerequisites![0] === cross.id);
    if (!mid) { out.push(`${cross.id}: crosslink has no bridge filler — spur, not bridge`); continue; }
    const notable = nodes.find((n) => (n.prerequisites ?? []).length === 1 && n.prerequisites![0] === mid.id);
    if (!notable) { out.push(`${cross.id}: bridge stops at ${mid.id} with no notable`); continue; }
    if (notable.cost < 2) out.push(`${notable.id}: bridge notable should be cost 2, is ${notable.cost}`);

    const shortcuts = nodes.filter((n) => (n.prerequisitesAnyOf ?? []).some((set) => set.includes(notable.id)));
    const leanings = new Set(shortcuts.map((n) => n.leaning));
    const connects = new Set(cross.prerequisites!.map((p) => t[p]?.leaning));
    for (const branch of connects) {
      if (!leanings.has(branch)) out.push(`${notable.id}: no shortcut into the ${branch} branch it connects (principle 11)`);
    }
    for (const s of shortcuts) {
      if (s.excludes?.length) out.push(`${notable.id}: shortcut lands ON a fork node (${s.id}) — should land one step short (principle 12)`);
    }
    // The bridge's own filler must deepen the crosslink's own lever, not
    // reach for a generic stat (principle 13).
    const lever = (n: ProposedNode) =>
      [...(n.grantsPassives ?? []), ...(n.grantsPassive ? [n.grantsPassive] : [])].map((p) => p.kind)
        .concat(Object.keys(n.delta ?? {}));
    if (!lever(mid).some((k) => lever(cross).includes(k))) {
      out.push(`${mid.id}: bridge filler shares no lever with its crosslink ${cross.id} (principle 13)`);
    }
  }

  // Principle 17: a branch must not answer every identity node with the same
  // signature lever. Background stats (power/accuracy/cooldown/range) repeat
  // harmlessly and always have — the defect is a *signature* lever (a
  // passive, a mark, a status behaviour) being the answer at notable, both
  // fork tips, the convergence AND the keystone. Bridges are exempt: they are
  // REQUIRED to be single-lever by principle 13, which is the trap this rule
  // exists to stop being applied one level up.
  const BACKGROUND = new Set(["power", "accuracy", "cooldownTicks", "range", "critRateStage", "defensePenetration", "lifestealFraction", "recoilFraction"]);
  const bridgeIds = new Set<string>();
  for (const cross of crosslinks) {
    const mid = nodes.find((n) => (n.prerequisites ?? []).length === 1 && n.prerequisites![0] === cross.id);
    const not = mid && nodes.find((n) => (n.prerequisites ?? []).length === 1 && n.prerequisites![0] === mid.id);
    for (const x of [cross, mid, not]) if (x) bridgeIds.add(x.id);
  }
  const signature = (n: ProposedNode) => [...new Set([
    ...Object.keys(n.delta ?? {}),
    ...(n.grantsPassive ? [`p:${n.grantsPassive.kind}`] : []),
    ...(n.grantsPassives ?? []).map((g) => `p:${g.kind}`),
  ])].filter((k) => !BACKGROUND.has(k));
  for (const branch of ["aggression", "boldness", "sociability"] as const) {
    const identity = nodes.filter((n) => n.leaning === branch && !bridgeIds.has(n.id) && n.cost >= 2);
    if (identity.length < 3) continue;
    const counts = new Map<string, number>();
    for (const n of identity) for (const l of signature(n)) counts.set(l, (counts.get(l) ?? 0) + 1);
    const [lever, hits] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    if (hits / identity.length > 0.6) {
      out.push(`${branch} branch: ${hits}/${identity.length} identity nodes are "${lever}" — one lever answering the whole branch (principle 17; shipped roster tops out at 50%)`);
    }
  }

  // The Disposition colour pie (MOVES_DESIGN.md): a branch picks two or three
  // flavours from the palette and builds from those. A branch drawing on one
  // or two is walking a straight line. Shipped roster averages 3.8.
  const FLAVOUR: Record<string, string[]> = {
    "raw damage": ["power", "hits", "critRateStage", "critCooldownReset", "statusSeverity", "weightScaling", "recoilFraction", "lifestealFraction", "p:bulk"],
    "stealth/ambush": ["situationalBonus", "burrow", "p:unnoticed", "p:unnoticedAura", "p:huntTargetSkip"],
    "aggressive movement": ["chargeAttack", "forcedMovement", "lockTicks"],
    "piercing": ["defensePenetration", "resistanceBreaker", "bonusVsType"],
    "defence": ["p:damageReduction", "p:damageReductionFlat", "p:defenseBoost", "p:thorns", "p:thornsRubble", "p:unshaken", "p:immovable", "p:fireproof"],
    "environment": ["terrainBurn", "terrainFill", "consumesOwnTerrain", "createsTerrain", "spawnsRain", "fertilityBoost", "fertilityCeilingBoost", "floraRegrowthMultiplier", "floraCompetition"],
    "wider aoe": ["shape", "hitsArea"],
    "reposition others": ["positionSwap", "positionSwapPull"],
    "planted/duration": ["statChangeOnHit", "p:terrainUnhindered", "p:dispersalSpeed", "herdMigrationResistance"],
    "healing": ["p:healAura", "p:regen", "p:regenFlat", "selfHeal", "herdForageBonus", "gatherBurst"],
    "no friendly fire": ["excludesAllies"],
    "rallying": ["rallyCall"],
    "ally buffing": ["targetsAlly", "allyEffect", "allyEffectOnAttack", "p:herdHaste", "p:aquaticHaste"],
    "calming": ["p:calmingPresence", "p:nonTerritorial", "statusImmunityAura"],
    // Cross-axis: PP and needs as a real spend, per "more pp tradeoffs are
    // the play. Notables that require pp. It becomes a gate."
    "resource economy": ["ppCost", "maxPPBonus", "selfCostPerUse", "drainNeeds"],
  };
  const flavourOf = new Map<string, string>();
  for (const [f, ks] of Object.entries(FLAVOUR)) for (const k of ks) flavourOf.set(k, f);
  for (const branch of ["aggression", "boldness", "sociability"] as const) {
    const bn = nodes.filter((n) => n.leaning === branch && !bridgeIds.has(n.id));
    if (!bn.length) continue;
    const fl = new Set<string>();
    // NOT `signature()` — that strips background stats for principle 17's
    // repetition check, and defensePenetration/resistanceBreaker ARE the
    // piercing flavour. Flavour coverage reads every lever a node pulls.
    const allLevers = (n: ProposedNode) => [...new Set([
      ...Object.keys(n.delta ?? {}),
      ...(n.grantsPassive ? [`p:${n.grantsPassive.kind}`] : []),
      ...(n.grantsPassives ?? []).map((g) => `p:${g.kind}`),
    ])];
    for (const n of bn) for (const k of allLevers(n)) { const f = flavourOf.get(k); if (f) fl.add(f); }
    if (fl.size < 3) out.push(`${branch} branch: draws on only ${fl.size} flavour(s) [${[...fl].join(", ")}] — the colour pie says pick two or three and build from those (shipped roster averages 3.8)`);
  }

  // PP as tree currency: a per-use cost belongs on an identity node (it is a
  // real build decision, not filler), and any tree that spends PP must also
  // offer a way to buy headroom back — otherwise it is a flat tax.
  const spenders = nodes.filter((n) => (n.delta as any)?.ppCost);
  const sellers = nodes.filter((n) => (n.delta as any)?.maxPPBonus);
  for (const n of spenders) {
    if (n.cost < 2) out.push(`${n.id}: ppCost on a filler node — a PP cost is a build decision, put it on an identity node`);
  }
  if (spenders.length && !sellers.length) {
    out.push(`spends PP (${spenders.map((n) => n.id).join(", ")}) but no node grants maxPPBonus — that is a tax, not an economy`);
  }
  // A low pool must not mean a punishing tree. PP-cost density scales with
  // the move's own canon pool: "Make the low pp moves not as punishing then.
  // We don't have to have all notable cost pp. Just some of em."
  if (!Number.isFinite(move.pp)) out.push(`no canon pp declared — the PP density and headroom checks cannot run`);
  const maxSpenders = Math.ceil(move.pp / 12);
  if (spenders.length > maxSpenders) {
    out.push(`${spenders.length} PP-costing nodes on a ${move.pp}-PP move — cap is ${maxSpenders} (ceil(pool/12)); a small pool should carry fewer, not be punished for being small`);
  }
  // On a small pool a headroom node is transformative and on a big one it is
  // a rounding error, so the floor is relative: headroom worth at least a
  // third of the pool wherever the tree spends PP at all.
  const headroom = sellers.reduce((sum, n) => sum + Number((n.delta as any).maxPPBonus ?? 0), 0);
  if (spenders.length && headroom < move.pp / 3) {
    out.push(`headroom +${headroom} against a ${move.pp} pool — a tree that spends PP should sell back at least a third of its pool (+${Math.ceil(move.pp / 3)})`);
  }

  // A node that is pure downside is a bug, not a design choice (principle 4).
  const DOWNSIDE = new Set(["recoilFraction", "selfCostPerUse", "lockTicks"]);
  for (const n of nodes) {
    const keys = Object.keys(n.delta ?? {});
    const upside = keys.some((k) => !DOWNSIDE.has(k)) || n.grantsPassive || n.grantsPassives;
    if (keys.some((k) => DOWNSIDE.has(k)) && !upside) out.push(`${n.id}: pure downside, no offsetting benefit in the same node (principle 4)`);
  }
  return out;
}

const selftest = process.argv.includes("--selftest");
if (selftest) {
  const broken: ProposedMove = {
    id: "broken", name: "Broken", type: "normal", category: "status", power: 0, accuracy: 100,
    cooldownTicks: 1, shape: {}, fantasy: "x", learners: [],
    tree: tree_([
      { id: "a", name: "A", cost: 1, leaning: "aggression", delta: {} },
      { id: "b", name: "B", cost: 1, leaning: "boldness", delta: {} },
      { id: "x", name: "X", cost: 1, prerequisites: ["a", "b"], leaning: "aggression", delta: { power: 1 } },
      { id: "y", name: "Y", cost: 1, prerequisites: ["a"], leaning: "aggression", delta: { recoilFraction: 0.1 } },
      { id: "z", name: "Z", cost: 1, prerequisites: ["nope"], delta: {} },
      // Five sociability identity nodes, every one of them rallyCall.
      { id: "s1", name: "S1", cost: 2, leaning: "sociability", delta: { rallyCall: { ticks: 1 } } },
      { id: "s2", name: "S2", cost: 2, leaning: "sociability", delta: { rallyCall: { ticks: 2 } } },
      { id: "s3", name: "S3", cost: 2, leaning: "sociability", delta: { rallyCall: { ticks: 3 } } },
      { id: "s4", name: "S4", cost: 2, leaning: "sociability", delta: { rallyCall: { ticks: 4 } } },
      { id: "s5", name: "S5", cost: 2, leaning: "sociability", delta: { rallyCall: { ticks: 5 } } },
    ]),
  };
  const found = problems(broken);
  const expect = ["spur, not bridge", "prerequisite \"nope\" does not exist", "missing leaning", "pure downside", "one lever answering the whole branch"];
  const missed = expect.filter((e) => !found.some((f) => f.includes(e)));
  console.log(`selftest: ${found.length} problems found on a deliberately broken tree`);
  found.forEach((f) => console.log(`  - ${f}`));
  if (missed.length) { console.error(`SELFTEST FAILED — checker missed: ${missed.join("; ")}`); process.exit(1); }
  console.log("selftest passed: the checker can actually fail.\n");
}
function tree_(ns: ProposedNode[]) { const o: Record<string, ProposedNode> = {}; for (const n of ns) o[n.id] = n; return o; }

let bad = 0;
for (const move of Object.values(PROPOSED_TREES)) {
  const p = problems(move);
  const n = Object.keys(move.tree).length;
  console.log(`${move.id.padEnd(14)} ${String(n).padStart(2)} nodes  ${p.length ? `${p.length} PROBLEM(S)` : "ok"}`);
  p.forEach((x) => console.log(`   - ${x}`));
  bad += p.length;
}
process.exit(bad ? 1 : 0);
