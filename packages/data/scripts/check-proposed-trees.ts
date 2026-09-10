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
import { MOVES } from "../src/moves.js";

// Identity-tier forks (3 per tree) plus one filler-tier fork per branch (3
// more) = 12 fork nodes. The filler forks are this roster's addition to the
// shipped standard, not a deviation from it: shipped trees have 6.
// Fork nodes = the 3 permanent identity-tier choices per tree (6 nodes),
// matching shipped. Filler-tier alternatives are PARALLEL ROUTES, not forks:
// nothing locks out, and scarcity of skill points is what makes picking one a
// decision — the Path of Exile shape, per "multi paths to same notable".
const SHIPPED = { anyOf: 9, forks: 6, bridges: 3 };

/**
 * The largest total of `valueOf` any single build can actually reach, given
 * that `excludes` pairs can never both be taken.
 *
 * Summing every node blindly is wrong and it produced a real false positive:
 * dig's Instant Vanish and False Surface exclude each other, so their two
 * cooldown cuts can never both be in one build, yet a flat sum reported dig
 * as -11 against a -10 cap and would have had a node rewritten to fix a
 * budget nothing was actually over. Every cap in this file is a claim about
 * what a BUILD can have, so every cap has to be measured the same way.
 *
 * Exclusion components are tiny (almost always a single pair), so this brute-
 * forces the maximum-weight independent set within each component and falls
 * back to the plain sum on anything implausibly large.
 */
function maxReachableTotal(nodes: ProposedNode[], valueOf: (n: ProposedNode) => number): number {
  const contributing = nodes.filter((n) => valueOf(n) !== 0);
  const byId = new Map(contributing.map((n) => [n.id, n]));
  const conflicts = (a: ProposedNode, b: ProposedNode) =>
    (a.excludes ?? []).includes(b.id) || (b.excludes ?? []).includes(a.id);

  // Connected components over the exclusion relation.
  const seen = new Set<string>();
  let total = 0;
  for (const start of contributing) {
    if (seen.has(start.id)) continue;
    const component: ProposedNode[] = [];
    const queue = [start];
    seen.add(start.id);
    while (queue.length) {
      const cur = queue.pop()!;
      component.push(cur);
      for (const other of contributing) {
        if (seen.has(other.id) || !conflicts(cur, other)) continue;
        seen.add(other.id);
        queue.push(other);
      }
    }
    if (component.length === 1) { total += valueOf(component[0]); continue; }
    if (component.length > 16) { total += component.reduce((sum, n) => sum + valueOf(n), 0); continue; }
    let best = 0;
    for (let mask = 0; mask < 1 << component.length; mask++) {
      let sum = 0;
      let ok = true;
      const picked: ProposedNode[] = [];
      for (let i = 0; i < component.length; i++) if (mask & (1 << i)) picked.push(component[i]);
      for (let i = 0; i < picked.length && ok; i++)
        for (let j = i + 1; j < picked.length && ok; j++) if (conflicts(picked[i], picked[j])) ok = false;
      if (!ok) continue;
      for (const n of picked) sum += valueOf(n);
      if (sum > best) best = sum;
    }
    total += best;
  }
  return total;
}

/**
 * The additive/append field -> the overwrite field it replaces. Two names for
 * one design lever, so anything keying on a delta's field name has to fold
 * them together (see `canon`, principle 13).
 */
const ADDITIVE_TO_OVERWRITE: Record<string, string> = {
  rangeBonus: "range",
  hitsBonus: "hits",
  areaBonus: "hitsArea",
  rallyCallTicks: "rallyCall",
  situationalBonuses: "situationalBonus",
  statChangesOnHit: "statChangeOnHit",
  allyEffects: "allyEffect",
};

function problems(move: ProposedMove): string[] {
  // With every node at 1 point, a notable is no longer marked by cost. What
  // actually MADE a node a notable is that routes converge on it — so that is
  // the definition now. A capstone is terminal. Direct: "We can make every
  // node cost 1, just make it always require 1 skill point."
  const identityOf = (all: ProposedNode[]) => (n: ProposedNode) =>
    (n.prerequisitesAnyOf ?? []).length >= 2 ||
    !all.some((o) => (o.prerequisites ?? []).includes(n.id) || (o.prerequisitesAnyOf ?? []).some((x) => x.includes(n.id)));
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

  const bridgeIds = new Set<string>();
  for (const cross of nodes.filter(isCrosslink)) {
    const mid = nodes.find((n) => (n.prerequisites ?? []).length === 1 && n.prerequisites![0] === cross.id);
    const not = mid && nodes.find((n) => (n.prerequisites ?? []).length === 1 && n.prerequisites![0] === mid.id);
    for (const x of [cross, mid, not]) if (x) bridgeIds.add(x.id);
  }
  const anyOf = nodes.filter((n) => n.prerequisitesAnyOf).length;
  const forks = nodes.filter((n) => n.excludes?.length).length;
  const crosslinks = nodes.filter(isCrosslink);
  if (anyOf !== SHIPPED.anyOf) out.push(`${anyOf} prerequisitesAnyOf, shipped standard is ${SHIPPED.anyOf}`);
  // A branch offers a real decision one of two ways: the shipped pattern (a
  // permanent `excludes` fork) or the two-lane pattern ("x x Y x x / a a B a a"
  // — two parallel filler lanes each with their own notable, nothing locked
  // out, the cost of walking both being what makes picking one a decision).
  // A branch with neither is a corridor.
  const laned = (branch: string) => {
    const inBranch = nodes.filter((n) => n.leaning === branch && !bridgeIds.has(n.id));
    const notables = inBranch.filter(identityOf(inBranch));
    // Two notables neither of which is an ancestor of the other = parallel lanes.
    const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
      if (seen.has(id)) return seen;
      seen.add(id);
      for (const p of [...(t[id]?.prerequisites ?? []), ...(t[id]?.prerequisitesAnyOf ?? []).flat()]) ancestors(p, seen);
      return seen;
    };
    return notables.some((a) => notables.some((b) => a.id !== b.id && !ancestors(a.id).has(b.id) && !ancestors(b.id).has(a.id)));
  };
  for (const branch of ["aggression", "boldness", "sociability"] as const) {
    if (!nodes.some((n) => n.leaning === branch)) continue;
    const hasFork = nodes.some((n) => n.leaning === branch && n.excludes?.length);
    if (!hasFork && !laned(branch)) out.push(`${branch} branch: no permanent fork and no parallel lanes — a corridor, not a decision`);
  }
  if (crosslinks.length !== SHIPPED.bridges) out.push(`${crosslinks.length} crosslinks, shipped standard is ${SHIPPED.bridges}`);

  // Every crosslink must head a real three-node bridge whose notable is an
  // alternate route into BOTH branches it connects (principle 11), landing
  // one step short of a fork, never on it (principle 12).
  for (const cross of crosslinks) {
    const mid = nodes.find((n) => (n.prerequisites ?? []).length === 1 && n.prerequisites![0] === cross.id);
    if (!mid) { out.push(`${cross.id}: crosslink has no bridge filler — spur, not bridge`); continue; }
    const notable = nodes.find((n) => (n.prerequisites ?? []).length === 1 && n.prerequisites![0] === mid.id);
    if (!notable) { out.push(`${cross.id}: bridge stops at ${mid.id} with no notable`); continue; }


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
    // An overwrite field and its additive form are the SAME design lever
    // ("+1 Range" is a range node either way), so they have to canonicalise
    // to one name. Without this, migrating half a tree to the additive form
    // makes a bridge that shared a lever look like it stopped sharing one —
    // which is what happened to scratch's frenzied_burrow/wrong_side bridge
    // the moment its crosslink moved to `situationalBonuses`.
    const canon = (k: string) => ADDITIVE_TO_OVERWRITE[k] ?? k;
    const lever = (n: ProposedNode) =>
      [...(n.grantsPassives ?? []), ...(n.grantsPassive ? [n.grantsPassive] : [])].map((p) => p.kind)
        .concat(Object.keys(n.delta ?? {}).map(canon));
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
  const BACKGROUND = new Set(["power", "accuracy", "cooldownTicks", "range", "rangeBonus", "critRateStage", "defensePenetration", "lifestealFraction", "recoilFraction"]);
  // Several delta fields are CONTAINERS, not levers: `allyEffect` covers both
  // a heal and a stat buff, `situationalBonus` covers night/flanking/elevation,
  // `forcedMovement` covers a shove and a lunge. Keying repetition on the
  // container name reports two genuinely different nodes as identical — a flaw
  // in the metric, not the design. Key on the discriminating sub-field instead.
  const expand = (key: string, value: any): string[] => {
    if (key === "allyEffects" && Array.isArray(value)) return value.flatMap((v: any) => expand("allyEffect", v));
    if (key === "allyEffect" && value && typeof value === "object") {
      const parts: string[] = [];
      if (value.healFraction != null) parts.push("allyEffect:heal");
      if (value.buff) parts.push(`allyEffect:buff-${value.buff.stat}`);
      if (value.statChange) parts.push(`allyEffect:buff-${value.statChange.stat}`);
      return parts.length ? parts : ["allyEffect"];
    }
    if (key === "situationalBonuses" && Array.isArray(value)) return value.map((v: any) => `situationalBonus:${v.condition}`);
    if (key === "statChangesOnHit" && Array.isArray(value)) return value.map((v: any) => `statChangeOnHit:${v.target ?? "self"}-${v.stat}`);
    if (key === "reposition" && value?.to) return [`reposition:${value.to}`];
    if (key === "situationalBonus" && value?.condition) return [`situationalBonus:${value.condition}`];
    if (key === "statChangeOnHit" && value?.stat) return [`statChangeOnHit:${value.target ?? "self"}-${value.stat}`];
    if (key === "forcedMovement" && value?.mover) return [`forcedMovement:${value.mover}`];
    return [key];
  };
  const signature = (n: ProposedNode) => [...new Set([
    ...Object.entries(n.delta ?? {}).flatMap(([k, v]) => expand(k, v)),
    ...(n.grantsPassive ? [`p:${n.grantsPassive.kind}`] : []),
    ...(n.grantsPassives ?? []).map((g) => `p:${g.kind}`),
  ])].filter((k) => !BACKGROUND.has(k));
  for (const branch of ["aggression", "boldness", "sociability"] as const) {
    const inBranch = nodes.filter((n) => n.leaning === branch && !bridgeIds.has(n.id));
    const identity = inBranch.filter((n) =>
      (n.prerequisitesAnyOf ?? []).length >= 2 ||
      !inBranch.some((o) => (o.prerequisites ?? []).includes(n.id) || (o.prerequisitesAnyOf ?? []).some((x) => x.includes(n.id))));
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
    "raw damage": ["power", "hits", "hitsBonus", "critRateStage", "critCooldownReset", "statusSeverity", "weightScaling", "recoilFraction", "lifestealFraction", "p:bulk"],
    "stealth/ambush": ["situationalBonus", "situationalBonuses", "burrow", "p:unnoticed", "p:unnoticedAura", "p:huntTargetSkip"],
    "aggressive movement": ["chargeAttack", "forcedMovement", "reposition", "lockTicks"],
    "piercing": ["defensePenetration", "resistanceBreaker", "bonusVsType", "rangeBonus"],
    "defence": ["p:damageReduction", "p:damageReductionFlat", "p:defenseBoost", "p:thorns", "p:thornsRubble", "p:unshaken", "p:immovable", "p:fireproof"],
    "environment": ["terrainBurn", "terrainFill", "consumesOwnTerrain", "createsTerrain", "spawnsRain", "fertilityBoost", "fertilityCeilingBoost", "floraRegrowthMultiplier", "floraCompetition"],
    "wider aoe": ["shape", "hitsArea", "areaBonus"],
    "reposition others": ["positionSwap", "positionSwapPull", "reposition"],
    "planted/duration": ["statChangeOnHit", "statChangesOnHit", "p:terrainUnhindered", "p:dispersalSpeed", "herdMigrationResistance"],
    "healing": ["p:healAura", "p:regen", "p:regenFlat", "selfHeal", "herdForageBonus", "gatherBurst"],
    "no friendly fire": ["excludesAllies"],
    "area status": ["areaStatus"],
    "rallying": ["rallyCall", "rallyCallTicks"],
    "ally buffing": ["targetsAlly", "allyEffect", "allyEffects", "allyEffectOnAttack", "p:herdHaste", "p:aquaticHaste"],
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
    if (!identityOf(nodes)(n)) out.push(`${n.id}: ppCost on a plain filler node — a PP cost is a build decision, put it on a notable or capstone`);
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

  // "it can fork paths, that converge at notables" — both sides of any fork
  // must reach the same downstream node, or the losing side is a dead end.
  const reaches = (id: string) =>
    nodes.filter((n) => (n.prerequisites ?? []).includes(id) || (n.prerequisitesAnyOf ?? []).some((set) => set.includes(id))).map((n) => n.id);
  for (const n of nodes) {
    for (const other of n.excludes ?? []) {
      if (n.id > other) continue; // check each pair once
      const a = new Set(reaches(n.id)), b = reaches(other);
      const isTerminal = a.size === 0 && b.length === 0;
      if (isTerminal) continue; // a fork between two capstones is allowed to end
      if (!b.some((x) => a.has(x))) {
        out.push(`fork ${n.id}/${other}: the two sides never reconverge — one of them is a dead end (${n.id} -> [${[...a].join(", ") || "nothing"}], ${other} -> [${b.join(", ") || "nothing"}])`);
      }
    }
  }

  // Multi-path: every branch should offer at least one node reachable by two
  // or more independent routes, or the "tree" is a corridor.
  const multiEntry = nodes.filter((n) => (n.prerequisitesAnyOf ?? []).length >= 2);
  const branchesWithChoice = new Set(multiEntry.map((n) => n.leaning));
  for (const branch of ["aggression", "boldness", "sociability"] as const) {
    if (nodes.some((n) => n.leaning === branch) && !branchesWithChoice.has(branch)) {
      out.push(`${branch} branch: no node reachable by two independent routes — that is a corridor, not a tree`);
    }
  }

  // A "+max PP" node is only a real pick opposite a tree that spends PP —
  // otherwise it is a dead option wearing a fork's clothes.
  if (sellers.length && !spenders.length) {
    out.push(`grants maxPPBonus (${sellers.map((n) => n.id).join(", ")}) but nothing in the tree costs PP — a dead pick, not a choice`);
  }

  // Template v4 shape check: per branch, two lanes each with a notable,
  // converging on a DEEPER notable, then a filler, then a capstone.
  //
  // Node count IS part of the standard, contrary to an earlier note here.
  // "We do have 45 nodes of real ideas on everything. It's the cool part of
  // the game" — and the measurement agrees: dig uses 12 of the roster's 71
  // levers and leaves 59 untouched, so its 29 nodes were an unexplored lever
  // set, not a small one. A tree short of 45 is a tree whose fantasy has not
  // been interrogated yet. The guard against padding is not a lower count,
  // it is the flavour/repetition/pure-downside rules below.
  for (const branch of ["aggression", "boldness", "sociability"] as const) {
    const bn = nodes.filter((n) => n.leaning === branch && !bridgeIds.has(n.id));
    if (!bn.length) continue;
    // Every node costs 1 point now ("just make it always require 1 skill
    // point"), so identity can no longer be read off `cost`. A node is an
    // identity node if it is a routing target (something reaches it by an
    // alternate route) or terminal — which is what notable/capstone MEANT.
    const identity = bn.filter(identityOf(bn));
    if (bn.length < 12) out.push(`${branch} branch: ${bn.length} nodes — v4 wants 12 (opener, two 4-node lanes, deep notable, filler, capstone). Short of that is an unexplored fantasy, not a small move.`);
    if (identity.length < 4) {
      out.push(`${branch} branch: ${identity.length} identity nodes — v4 wants 4 (two lane notables, a deep notable, a capstone)`);
      continue;
    }
    // The deep notable is the one both lanes reach; the capstone is terminal.
    const terminal = identity.filter((n) => !bn.some((o) => (o.prerequisites ?? []).includes(n.id) || (o.prerequisitesAnyOf ?? []).some((s) => s.includes(n.id))));
    if (terminal.length !== 1) {
      out.push(`${branch} branch: ${terminal.length} terminal identity nodes (${terminal.map((n) => n.id).join(", ")}) — v4 wants exactly one capstone`);
    }
    const deep = identity.find((n) => (n.prerequisitesAnyOf ?? []).length >= 2 && !terminal.includes(n));
    if (!deep) out.push(`${branch} branch: no deep notable both lanes converge on`);
    else {
      // Capstone must sit behind the deep notable via a filler, not directly.
      const cap = terminal[0];
      if (cap) {
        const direct = (cap.prerequisites ?? []).includes(deep.id) || (cap.prerequisitesAnyOf ?? []).some((s) => s.includes(deep.id));
        if (direct) out.push(`${branch} branch: capstone ${cap.id} hangs straight off the deep notable — v4 wants one filler between them`);
      }
    }
  }

  // "I think we probably don't want you to be able to capture all outer nodes
  // and capstone with just a single connected line, but none of the early
  // nodes for that branch" — a regression guard. The cheapest legal route to
  // a capstone must be spent overwhelmingly inside its own branch, so no
  // build can snake in through bridges and skip a branch's own early nodes.
  const cheapest = (id: string, memo = new Map<string, Set<string>>()): Set<string> => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, new Set([id]));
    const node = t[id];
    const need = new Set([id]);
    for (const pre of node?.prerequisites ?? []) for (const x of cheapest(pre, memo)) need.add(x);
    const sets = node?.prerequisitesAnyOf ?? [];
    if (sets.length) {
      let best: Set<string> | null = null;
      for (const set of sets) {
        const acc = new Set<string>();
        for (const pre of set) for (const x of cheapest(pre, memo)) acc.add(x);
        if (!best || acc.size < best.size) best = acc;
      }
      for (const x of best!) need.add(x);
    }
    memo.set(id, need);
    return need;
  };
  for (const cap of nodes.filter((n) => !nodes.some((o) => (o.prerequisites ?? []).includes(n.id) || (o.prerequisitesAnyOf ?? []).some((x) => x.includes(n.id))))) {
    const path = cheapest(cap.id);
    const own = [...path].filter((x) => t[x]?.leaning === cap.leaning).length;
    if (own / path.size < 0.75) {
      out.push(`capstone ${cap.id}: cheapest route is ${path.size} points but only ${own} are in its own branch — a build could snake in and skip the branch's early nodes`);
    }
  }

  // Overwrite collision. `applyMoveTree` (engine/moves.ts) ADDS power,
  // accuracy, cooldownTicks, statusChance, defensePenetration and lockTicks,
  // but OVERWRITES everything else — its own doc comment admits "order given
  // to applyMoveTree matters for overwriting fields like shape". So two
  // co-takeable nodes setting the same overwrite field produce a silent,
  // order-dependent result: "If you got both, would it just do nothing?"
  // Worse than nothing — whichever the iteration reaches last quietly wins.
  const ancestorsOf = (id: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(id)) return seen;
    seen.add(id);
    for (const pre of [...(t[id]?.prerequisites ?? []), ...(t[id]?.prerequisitesAnyOf ?? []).flat()]) ancestorsOf(pre, seen);
    return seen;
  };
  // This list is now the FULL non-boolean overwrite surface of
  // `applyMoveTree`, derived by reading the function rather than by adding
  // fields as they bite: every field it writes with `delta.X ?? result.X`,
  // minus the booleans (those OR-merge — once a node turns `terrainBurn` on
  // nothing can turn it back off, so two setters agree by construction).
  //
  // It was previously a partial list, and the omissions were real: the
  // shipped leech_seed's `drainNeeds` fork was found by hand, and
  // `weightScaling` was invisible to this checker entirely while rock_slide
  // carried five independently-takeable setters of it.
  //
  // NOT here, on purpose — the additive/append forms, which are the fix
  // rather than the bug: `rangeBonus`, `hitsBonus`, `areaBonus`,
  // `rallyCallTicks`, `situationalBonuses`, `statChangesOnHit`,
  // `allyEffects`. `applyMoveTree` appends or sums those, so two co-takeable
  // setters both count and the result does not depend on purchase order.
  // Which additive field replaces which overwrite one, so the report says
  // what to do rather than only what is wrong.
  const ADDITIVE_FORM: Record<string, string> = {
    range: "rangeBonus",
    hits: "hitsBonus",
    situationalBonus: "situationalBonuses",
    statChangeOnHit: "statChangesOnHit",
    rallyCall: "rallyCallTicks",
    allyEffect: "allyEffects",
  };
  const OVERWRITE = [
    "shape", "range", "hits", "forcedMovement", "situationalBonus", "statChangeOnHit", "rallyCall", "allyEffect", "reposition",
    "drainNeeds", "selfHeal", "fertilityBoost", "statusImmunityAura", "matingRadiusBoost",
    "weightScaling", "selfStateBonus", "bonusVsType", "resistanceBreaker", "selfCostPerUse",
    "statusSeverity", "consumesOwnTerrain", "terrainFill", "chargeAttack",
  ];
  const excl = new Map(nodes.map((n) => [n.id, new Set(n.excludes ?? [])]));
  for (const field of OVERWRITE) {
    const setters = nodes.filter((n) => (n.delta as any)?.[field] !== undefined);
    const pairs: string[] = [];
    for (let i = 0; i < setters.length; i++) {
      for (let j = i + 1; j < setters.length; j++) {
        const a = setters[i], b = setters[j];
        const related = ancestorsOf(a.id).has(b.id) || ancestorsOf(b.id).has(a.id);
        if (!related && !excl.get(a.id)?.has(b.id) && !excl.get(b.id)?.has(a.id)) pairs.push(`${a.id}+${b.id}`);
      }
    }
    if (pairs.length) {
      const fix = ADDITIVE_FORM[field];
      out.push(`"${field}" is an OVERWRITE field but ${setters.length} co-takeable nodes set it (${pairs.slice(0, 3).join(", ")}${pairs.length > 3 ? ` +${pairs.length - 3} more` : ""}) — a build taking both gets whichever the engine reaches last. ${fix ? `Use \`${fix}\`` : "Use an additive form"}, or make them mutually exclusive.`);
    }
  }

  // `shape` is the one field that genuinely cannot be additive — a cone is
  // not a ring plus a line — so taking one form locks out the others:
  // "Maybe that excludes you from taking other shape modes." Independent
  // shape nodes must declare `excludes` against each other. (Area SIZE is
  // additive via `areaBonus` and is not affected by this.)
  const shapers = nodes.filter((n) => (n.delta as any)?.shape !== undefined);
  for (let i = 0; i < shapers.length; i++) {
    for (let j = i + 1; j < shapers.length; j++) {
      const a = shapers[i], b = shapers[j];
      if (ancestorsOf(a.id).has(b.id) || ancestorsOf(b.id).has(a.id)) continue;
      if (!(a.excludes ?? []).includes(b.id) && !(b.excludes ?? []).includes(a.id)) {
        out.push(`shape nodes ${a.id} and ${b.id} are independently takeable — a move has one footprint, so alternative forms must exclude each other`);
      }
    }
  }

  // Cooldown overshoot. Reaching 0 is fine — "it's okay to get to cooldown 0,
  // just a bunch of filler beyond that is not useful" — but every tick of
  // reduction past the move's base cooldown is a node that provably does
  // nothing, which is this project's own definition of a bug. Note cooldowns
  // are counted in the agent's OWN TURNS (tickCooldowns runs inside
  // tickAgentAction, which only fires on an action tick), so `cooldownTicks:
  // N` means "usable every (N+1)th action" at any Speed — going from 2 to 0
  // on a base-2 move is a real 3x tempo gain, not a rounding difference.
  // Damage per action is power/(cooldown+1), so tempo compounds: dropping a
  // base-8 move to 0 was a 9x gain, against ~2x for power or multi-hit nodes.
  // Capped at 3x by flooring the cooldown, per "2 +1 together. Cap it at 3x".
  const cdFloor = Math.ceil((move.cooldownTicks + 1) / 3) - 1;
  const maxCut = move.cooldownTicks - cdFloor;
  // Magnitudes, not signed values: `maxReachableTotal` maximises, so feeding
  // it negative cooldown deltas made the empty set (0) the best answer and the
  // rule silently stopped firing. Caught by the selftest below, which is the
  // only reason this is not shipped broken.
  const cut = maxReachableTotal(nodes, (n) => Math.max(0, -((n.delta as any)?.cooldownTicks ?? 0)));
  if (cut > maxCut) {
    const tempo = (move.cooldownTicks + 1) / (Math.max(0, move.cooldownTicks - cut) + 1);
    out.push(`cooldown reduction totals -${cut} against a base of ${move.cooldownTicks}, a ${tempo.toFixed(1)}x tempo gain — the cap is 3.0x, so at most -${maxCut} (floor ${cdFloor}). Trim or repurpose.`);
  }

  // Per-move passive ceilings. Direct: "we should maybe try to aim to cap at
  // 20% dmg reduction max, 10% regen per move. Tbh up to 50% thorns is fine,
  // it can be a case where it hits back quite hard."
  //
  // These are PER-MOVE, and a per-move cap does not bound a species: passives
  // sum across every move a species knows (`agent.passives[kind] += value`,
  // status.ts:342, uncapped), so four capped moves still stack. That is what
  // passive-exposure.ts measures; this rule only stops any single tree from
  // being the whole problem by itself.
  const passiveOn = (n: ProposedNode, kind: string) =>
    [...(n.grantsPassive ? [n.grantsPassive] : []), ...(n.grantsPassives ?? [])]
      .filter((g) => g.kind === kind)
      .reduce((sum, g) => sum + g.value, 0);
  const passiveTotal = (kind: string) => maxReachableTotal(nodes, (n) => passiveOn(n, kind));
  const PASSIVE_CAP: [string, number, string][] = [
    ["damageReduction", 0.2, "damage reduction"],
    ["thorns", 0.5, "thorns"],
  ];
  for (const [kind, cap, label] of PASSIVE_CAP) {
    const total = passiveTotal(kind);
    if (total > cap + 1e-9) out.push(`${label} totals ${(total * 100).toFixed(0)}% across this tree — the per-move cap is ${(cap * 100).toFixed(0)}%`);
  }
  // Healing is one budget across its three kinds, because that is how the
  // engine spends it: status.ts:422 folds regen + healAura + regenFlat/maxHp
  // into a single share before softCapHealShare bends it. Checking `regen`
  // alone would pass a tree that hides the same total in `healAura`.
  // Reference maxHp so regenFlat lands in the same unit as the fractions.
  // Measured, not guessed: median maxHp over all 108 species x levels 5/15/30
  // is 43 (level-5 median 21, level-15 43, level-30 76). Using the overall
  // median rather than the level-30 one is deliberately conservative — a
  // deeply-invested agent is usually high level, where the same flat regen is
  // worth about half as much share.
  const HEAL_REF_MAX_HP = 43;
  const heal = maxReachableTotal(
    nodes,
    (n) => passiveOn(n, "regen") + passiveOn(n, "healAura") + passiveOn(n, "regenFlat") / HEAL_REF_MAX_HP
  );
  if (heal > 0.1 + 1e-9) out.push(`healing totals ${(heal * 100).toFixed(1)}%/tick across this tree (regen + healAura + regenFlat/${HEAL_REF_MAX_HP}) — the per-move cap is 10%`);

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
      // Passive ceilings: 35% DR (cap 20) and 14%/tick healing (cap 10).
      { id: "p1", name: "P1", cost: 1, leaning: "boldness", delta: {}, grantsPassive: { kind: "damageReduction", value: 0.35 } },
      { id: "p2", name: "P2", cost: 1, leaning: "boldness", delta: {}, grantsPassives: [{ kind: "regen", value: 0.08 }, { kind: "healAura", value: 0.06 }] },
      // Two independently-takeable `drainNeeds` setters — the OVERWRITE rule's
      // failing case for the utility-move fields added to that list.
      { id: "d1", name: "D1", cost: 1, leaning: "boldness", delta: { drainNeeds: { need: "hunger", amount: 0.3, radius: 4 } } },
      { id: "d2", name: "D2", cost: 1, leaning: "boldness", delta: { drainNeeds: { need: "thirst", amount: 0.3, radius: 4 } } },
      // `weightScaling` was in `applyMoveTree`'s overwrite set and NOT in this
      // checker's list, which is exactly how rock_slide ended up shipping five
      // co-takeable setters of it unreported. Its failing case, in the same
      // commit that adds the rule.
      { id: "w1", name: "W1", cost: 1, leaning: "aggression", delta: { weightScaling: { factor: 0.1 } } },
      { id: "w2", name: "W2", cost: 1, leaning: "aggression", delta: { weightScaling: { factor: 0.2 } } },
      // The CONTROL for the whole overwrite rule: the same two nodes written
      // in the additive form must NOT be reported, or the fix would look
      // identical to the bug. `expectClean` below asserts that.
      { id: "r1", name: "R1", cost: 1, leaning: "boldness", delta: { rangeBonus: 1 } },
      { id: "r2", name: "R2", cost: 1, leaning: "boldness", delta: { rangeBonus: 1 } },
      { id: "b1", name: "B1", cost: 1, leaning: "boldness", delta: { situationalBonuses: [{ condition: "flanking", multiplier: 1.3 }] } },
      { id: "b2", name: "B2", cost: 1, leaning: "boldness", delta: { situationalBonuses: [{ condition: "elevation", multiplier: 1.3 }] } },
    ]),
  };
  const expect = ["spur, not bridge", "prerequisite \"nope\" does not exist", "missing leaning", "pure downside", "one lever answering the whole branch", "damage reduction totals", "healing totals", "\"drainNeeds\" is an OVERWRITE field", "\"weightScaling\" is an OVERWRITE field"];
  // The other half of the rule: the additive forms are the FIX, so reporting
  // them would make the fix indistinguishable from the bug.
  const expectClean = ["rangeBonus", "situationalBonuses", "r1+r2", "b1+b2"];
  const found = problems(broken);
  const missed = expect.filter((e) => !found.some((f) => f.includes(e)));
  const falsePositives = expectClean.filter((e) => found.some((f) => f.includes(e)));
  console.log(`selftest: ${found.length} problems found on a deliberately broken tree`);
  found.forEach((f) => console.log(`  - ${f}`));
  if (missed.length) { console.error(`SELFTEST FAILED — checker missed: ${missed.join("; ")}`); process.exit(1); }
  if (falsePositives.length) { console.error(`SELFTEST FAILED — checker reported the additive FIX as a collision: ${falsePositives.join("; ")}`); process.exit(1); }
  console.log("selftest passed: the checker can actually fail.\n");
}
// The exclusion-reachability logic changed no shipped number when it landed,
// which makes it exactly the kind of rule that silently rots. This proves it
// both ways on a tree built for it: two mutually-exclusive -3 cooldowns must
// read as -3, not -6, and two co-takeable ones must still read as -6.
{
  const mk = (cd: number, id: string, excludes?: string[]): ProposedNode => ({
    id, name: id, cost: 1, leaning: "aggression", excludes, delta: { cooldownTicks: cd },
  });
  const cutOf = (nodes: ProposedNode[]) => {
    const move: ProposedMove = {
      id: "x", name: "X", type: "normal", category: "physical", power: 10, accuracy: 100,
      cooldownTicks: 2, shape: {}, fantasy: "", learners: [], tree: tree_(nodes),
    };
    const line = problems(move).find((m) => m.startsWith("cooldown reduction totals"));
    return line ? Number(/totals -(\d+)/.exec(line)![1]) : 0;
  };
  const exclusive = cutOf([mk(-3, "a", ["b"]), mk(-3, "b", ["a"])]);
  const together = cutOf([mk(-3, "a"), mk(-3, "b")]);
  if (exclusive !== 3 || together !== 6) {
    console.error(`SELFTEST FAILED — exclusion reachability: exclusive pair read as -${exclusive} (want -3), co-takeable pair as -${together} (want -6)`);
    process.exit(1);
  }
  if (process.argv.includes("--selftest")) console.log("selftest passed: exclusive cooldowns count once, co-takeable ones sum.\n");
}

function tree_(ns: ProposedNode[]) { const o: Record<string, ProposedNode> = {}; for (const n of ns) o[n.id] = n; return o; }

// `--shipped` runs the same rules over the real MOVES roster. Same checker,
// same thresholds — the drafts were never the only trees that needed them.
const shipped = process.argv.includes("--shipped");
const targets: ProposedMove[] = shipped
  ? (Object.values(MOVES) as any[])
      .filter((m) => m.tree && Object.keys(m.tree).length)
      .map((m) => ({ ...m, pp: m.pp, learners: [], fantasy: "", tree: m.tree }) as ProposedMove)
  : Object.values(PROPOSED_TREES);

let bad = 0;
for (const move of targets) {
  const p = problems(move);
  const n = Object.keys(move.tree).length;
  console.log(`${move.id.padEnd(14)} ${String(n).padStart(2)} nodes  ${p.length ? `${p.length} PROBLEM(S)` : "ok"}`);
  p.forEach((x) => console.log(`   - ${x}`));
  bad += p.length;
}
process.exit(bad ? 1 : 0);
