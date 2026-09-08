import type { MoveTreeNode } from "@pokuelike/engine";

/**
 * The real radial skill-tree visualization, ported from
 * `packages/data/scripts/move-tree-atlas.template.html` (the standalone
 * "Move Tree Atlas" artifact) into this app's own Inspector panel. Direct
 * ask: "The moves don't really show a tree - we have these super sick
 * skill tree visualizations in move atlas. It'd be really cool to have
 * that when you click a Pokémon unit, look at their moves... I don't see
 * how they're specced either." `inspector.ts`'s move list already had a
 * click-to-expand tree slot wired to a real `agent.moveTreeChoices`
 * lookup — it was just drawing a plain BFS-layered row grid instead of
 * the atlas's actual three-branch radial layout. This module IS that
 * layout/render code, adapted from the atlas's vanilla-JS `computeLayout`/
 * `renderTree` to real DOM/SVG-element construction (this codebase's own
 * idiom, matching `overworldMap.ts`/`renderer.ts`) instead of the atlas's
 * innerHTML/`el()` helper. The interactive "try a hypothetical build"
 * half of the atlas (its whole point as a design tool) is deliberately
 * NOT ported — this only ever displays an agent's REAL, already-decided
 * `moveTreeChoices` (set by `leveling.ts`'s `maybeAutoRespec`, never
 * player-chosen), so there's nothing to simulate.
 */

const BRANCH_ANGLE: Record<"aggression" | "boldness" | "sociability", number> = {
  aggression: -90,
  boldness: 30,
  sociability: 150,
};
const BRANCH_COLOR: Record<"aggression" | "boldness" | "sociability", string> = {
  aggression: "#ef6448",
  boldness: "#4c95e6",
  sociability: "#43cf95",
};
const CROSS_COLOR = "#e0ac3f";
const R0 = 64;
const RSTEP = 56;
const FORK_OFFSET = 34;
const CHAIN_STEP = 42;

interface NodePos {
  x: number;
  y: number;
  branch: "aggression" | "boldness" | "sociability" | "cross";
  depth: number;
}

interface TreeLayout {
  positions: Record<string, NodePos>;
  maxR: number;
}

function isCrosslink(node: MoveTreeNode): boolean {
  return Array.isArray(node.prerequisites) && node.prerequisites.length === 2;
}

/** A crosslink's own root, or any node reached from it through an unbroken single-prerequisite chain — see this file's own doc comment / the atlas's identical function for why this is tracked separately from ordinary same-branch nodes. */
function isCrosslinkChainMember(tree: Record<string, MoveTreeNode>, id: string, seen: Set<string> = new Set()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  const node = tree[id];
  if (!node) return false;
  if (isCrosslink(node)) return true;
  if (node.prerequisites && node.prerequisites.length === 1) return isCrosslinkChainMember(tree, node.prerequisites[0]!, seen);
  return false;
}

function firstAnyOfParent(node: MoveTreeNode): string | undefined {
  const first = node.prerequisitesAnyOf?.[0];
  return first?.[first.length - 1];
}

/** Direct port of the atlas's `computeLayout` — see that function's own extensive comments (move-tree-atlas.template.html) for the reasoning behind each pass; unchanged here beyond TS types and object literals instead of the atlas's imperative object-building. */
function computeLayout(tree: Record<string, MoveTreeNode>): TreeLayout {
  const ids = Object.keys(tree);
  const branches: Record<"aggression" | "boldness" | "sociability", string[]> = { aggression: [], boldness: [], sociability: [] };
  const crosslinks: string[] = [];
  const crosslinkDescendants: string[] = [];

  for (const id of ids) {
    const node = tree[id]!;
    if (isCrosslink(node)) crosslinks.push(id);
    else if (isCrosslinkChainMember(tree, id)) crosslinkDescendants.push(id);
    else if (node.leaning && branches[node.leaning as "aggression" | "boldness" | "sociability"]) {
      branches[node.leaning as "aggression" | "boldness" | "sociability"].push(id);
    }
  }

  const depth: Record<string, number> = {};
  function depthOf(id: string): number {
    if (depth[id] !== undefined) return depth[id]!;
    const node = tree[id]!;
    let parent: string | undefined;
    if (node.prerequisites && node.prerequisites.length === 1) parent = node.prerequisites[0];
    else if (!node.prerequisites || node.prerequisites.length === 0) parent = firstAnyOfParent(node);
    if (parent == null) {
      depth[id] = 0;
      return 0;
    }
    const d = depthOf(parent) + 1;
    depth[id] = d;
    return d;
  }
  for (const id of ids) depthOf(id);

  const positions: Record<string, NodePos> = {};

  for (const branchName of Object.keys(branches) as Array<"aggression" | "boldness" | "sociability">) {
    const angle = (BRANCH_ANGLE[branchName] * Math.PI) / 180;
    const perp = angle + Math.PI / 2;
    const nodesAtDepth: Record<number, string[]> = {};
    for (const id of branches[branchName]) {
      const d = depth[id]!;
      (nodesAtDepth[d] = nodesAtDepth[d] ?? []).push(id);
    }
    for (const dKey of Object.keys(nodesAtDepth)) {
      const d = Number(dKey);
      const group = nodesAtDepth[d]!;
      const r = R0 + d * RSTEP;
      const cx = Math.cos(angle) * r;
      const cy = Math.sin(angle) * r;
      if (group.length === 1) {
        positions[group[0]!] = { x: cx, y: cy, branch: branchName, depth: d };
      } else {
        const n = group.length;
        group.forEach((id, i) => {
          const offset = (i - (n - 1) / 2) * FORK_OFFSET;
          positions[id] = { x: cx + Math.cos(perp) * offset, y: cy + Math.sin(perp) * offset, branch: branchName, depth: d };
        });
      }
    }
  }

  const crosslinksByKey: Record<string, Array<{ id: string; mid: number; r: number }>> = {};
  for (const id of crosslinks) {
    const node = tree[id]!;
    const parents = (node.prerequisites ?? []).map((p) => tree[p]).filter((p): p is MoveTreeNode => !!p);
    const branchesTouched = parents.map((p) => p.leaning);
    const a1 = branchesTouched[0] && BRANCH_ANGLE[branchesTouched[0] as "aggression"] != null
      ? BRANCH_ANGLE[branchesTouched[0] as "aggression"]
      : BRANCH_ANGLE[(node.leaning ?? "aggression") as "aggression"];
    const a2 = branchesTouched[1] && BRANCH_ANGLE[branchesTouched[1] as "aggression"] != null ? BRANCH_ANGLE[branchesTouched[1] as "aggression"] : a1 + 120;
    let mid = (a1 + a2) / 2;
    if (Math.abs(a1 - a2) > 180) mid += 180;
    const maxParentDepth = Math.max(0, ...(node.prerequisites ?? []).map(depthOf));
    const r = R0 * 1.42 + maxParentDepth * RSTEP;
    const pairKey = `${[branchesTouched[0] ?? "", branchesTouched[1] ?? ""].sort().join("|")}@${Math.round(r)}`;
    (crosslinksByKey[pairKey] = crosslinksByKey[pairKey] ?? []).push({ id, mid, r });
  }
  for (const pairKey of Object.keys(crosslinksByKey)) {
    const group = crosslinksByKey[pairKey]!;
    const mid = group[0]!.mid;
    const r = group[0]!.r;
    const rad = (mid * Math.PI) / 180;
    const perp = rad + Math.PI / 2;
    const n = group.length;
    group.forEach((entry, i) => {
      const offset = (i - (n - 1) / 2) * (FORK_OFFSET * 0.7);
      positions[entry.id] = { x: Math.cos(rad) * r + Math.cos(perp) * offset, y: Math.sin(rad) * r + Math.sin(perp) * offset, branch: "cross", depth: 0 };
    });
  }

  function crosslinkRootAndHops(id: string): { root: string; hops: number } | undefined {
    let hops = 0;
    let cur = id;
    for (let guard = 0; guard < ids.length + 1; guard++) {
      const n = tree[cur];
      if (!n) return undefined;
      if (isCrosslink(n)) return { root: cur, hops };
      if (!(n.prerequisites && n.prerequisites.length === 1)) return undefined;
      cur = n.prerequisites[0]!;
      hops++;
    }
    return undefined;
  }
  const byRootAndHop: Record<string, string[]> = {};
  for (const id of crosslinkDescendants) {
    const info = crosslinkRootAndHops(id);
    if (!info || !positions[info.root]) continue;
    const key = `${info.root} ${info.hops}`;
    (byRootAndHop[key] = byRootAndHop[key] ?? []).push(id);
  }
  for (const key of Object.keys(byRootAndHop)) {
    const [rootId, hopsStr] = key.split(" ");
    const hops = Number(hopsStr);
    const group = byRootAndHop[key]!;
    const rootPos = positions[rootId!]!;
    const rootAngle = Math.atan2(rootPos.y, rootPos.x);
    const rootR = Math.sqrt(rootPos.x * rootPos.x + rootPos.y * rootPos.y);
    const r = rootR + hops * CHAIN_STEP;
    const perp = rootAngle + Math.PI / 2;
    const n = group.length;
    group.forEach((id, i) => {
      const offset = (i - (n - 1) / 2) * FORK_OFFSET;
      positions[id] = { x: Math.cos(rootAngle) * r + Math.cos(perp) * offset, y: Math.sin(rootAngle) * r + Math.sin(perp) * offset, branch: "cross", depth: hops };
    });
  }

  let maxR = 0;
  for (const id of Object.keys(positions)) {
    const p = positions[id]!;
    maxR = Math.max(maxR, Math.abs(p.x), Math.abs(p.y));
  }

  return { positions, maxR: maxR + FORK_OFFSET + 30 };
}

function nodeRadius(node: MoveTreeNode): number {
  return node.cost >= 2 && !isCrosslink(node) ? 15 : 11;
}

function nodeColor(node: MoveTreeNode): string {
  if (isCrosslink(node)) return CROSS_COLOR;
  return (node.leaning && BRANCH_COLOR[node.leaning as "aggression"]) || "#8a93a3";
}

/** Direct port of the atlas's `checkEligible` — whether `nodeId` could be chosen next given `chosenSet`, used only to distinguish "not chosen, still reachable" from "not chosen, prerequisites/exclusions block it" for dimming. */
function isEligible(tree: Record<string, MoveTreeNode>, chosenSet: Set<string>, nodeId: string): boolean {
  const node = tree[nodeId]!;
  if ((node.prerequisites ?? []).some((p) => !chosenSet.has(p))) return false;
  if (node.prerequisitesAnyOf && node.prerequisitesAnyOf.length > 0) {
    if (!node.prerequisitesAnyOf.some((set) => set.every((p) => chosenSet.has(p)))) return false;
  }
  for (const cid of chosenSet) {
    if ((node.excludes ?? []).includes(cid)) return false;
    const cNode = tree[cid];
    if (cNode?.excludes?.includes(nodeId)) return false;
  }
  return true;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// ---------- Plain-English translators, ported from the atlas's own
// `describeDelta`/`describePassive` (the same "In plain English" block the
// atlas's detail panel already used) — see MOVES_DESIGN.md for the full
// field list these track. Kept close to the atlas's own wording; extended
// here to run once over a whole COMBINED build's net delta, not just one
// node at a time, for `summarizeBuildEffects` below. ----------

const STAT_LABEL: Record<string, string> = { attack: "Attack", defense: "Defense", spAttack: "Sp. Attack", spDefense: "Sp. Defense", speed: "Speed" };

const PASSIVE_LABEL: Record<string, (v: number) => string> = {
  damageReduction: (v) => {
    const eff = v / (1 + v);
    return `Passive — takes less damage from every hit. Diminishing returns: ${pct(v)} raw is ${pct(eff)} in practice, and stacking can never reach immunity.`;
  },
  damageReductionFlat: (v) => `Passive — takes a flat ${v} HP off every hit, after the percentage reduction. Worth proportionally more against weak hits than strong ones; a landed hit always does at least 1.`,
  immovable: () => "Passive — can't be dragged, knocked back, or lunged at by anything.",
  regen: (v) => `Passive — heals ${pct(v)} of max HP every tick, on its own. Only out of combat (any damage taken suppresses it briefly).`,
  fireproof: (v) => (v >= 1 ? "Passive — completely immune to standing in fire: no damage, and passive healing keeps working on a burning tile." : `Passive — ignores ${pct(v)} of the damage from standing in a fire tile.`),
  regenFlat: (v) => `Passive — heals a flat ${v} HP every tick, on its own. Worth proportionally more to a small unit than a big one. Only out of combat (any damage taken suppresses it briefly).`,
  thorns: (v) => `Passive — reflects ${pct(v)} of incoming damage back onto the attacker.`,
  healAura: (v) => `Passive — heals every nearby herd-mate (itself included) ${pct(v)} of max HP every tick. Each recipient must be out of combat.`,
  defenseBoost: (v) => `Passive — permanently raises its own Defense stat-stage by ${v}.`,
  aquaticHaste: (v) => `Passive — every nearby herd-mate (itself included) moves ${pct(v)} faster while standing on water.`,
  nonTerritorial: () => "Passive — never initiates a fight over a contested resource tile (can still be targeted by someone else's).",
  calmingPresence: (v) => `Passive — every nearby agent (herd or not, itself included) is ${pct(v)} less likely to start a resource fight nearby.`,
  unshaken: () => "Passive — the next hit against it does nothing at all (no damage, no side effects), then recharges on a cooldown.",
};

function pct(v: number): string {
  return `${Math.round(v * 1000) / 10}%`;
}
function signed(v: number): string {
  return `${v > 0 ? "+" : ""}${v}`;
}
function conditionLabel(c: string): string {
  const labels: Record<string, string> = {
    targetLowHp: "at or below half HP",
    flanking: "caught off guard (flanking)",
    night: "it's night",
    elevation: "the user is standing higher up",
    concealed: "the user is concealed in a bush",
    coldSnap: "there's a cold snap",
    storm: "there's a storm",
    drought: "there's a drought",
    rain: "it's raining",
    targetBurning: "burning",
    targetStatused: "already statused",
  };
  return labels[c] ?? c;
}
function shapeLabel(shape: { kind: string; length?: number; width?: number; radius?: number }): string {
  if (shape.kind === "point") return "a point-blank hit";
  if (shape.kind === "line") return `a ${shape.length}-tile line`;
  if (shape.kind === "cone") return `a ${shape.length}-tile cone (width ${shape.width})`;
  if (shape.kind === "ring") return `a ring at radius ${shape.radius}`;
  if (shape.kind === "burst") return `a burst of radius ${shape.radius}`;
  return shape.kind;
}

function describePassive(kind: string, value: number): string {
  const fn = PASSIVE_LABEL[kind];
  return fn ? fn(value) : `Passive — ${kind} ${value}.`;
}

/** Turns one raw `delta` object (a single node's, or a whole build's combined net delta — see `combineDeltas`) into short, plain-English bullet lines. Direct port of the atlas's own `describeDelta`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeDelta(delta: Record<string, any>): string[] {
  const lines: string[] = [];
  const has = (k: string): boolean => delta[k] !== undefined;

  if (has("power")) lines.push(`${signed(delta.power)} power.`);
  if (has("accuracy")) lines.push(`${signed(delta.accuracy)} accuracy.`);
  if (has("cooldownTicks")) lines.push(`${signed(delta.cooldownTicks)} tick${Math.abs(delta.cooldownTicks) === 1 ? "" : "s"} cooldown.`);
  if (has("defensePenetration")) lines.push(`Ignores ${pct(delta.defensePenetration)} of the target's Defense/Sp. Defense.`);
  if (has("hits")) lines.push(`Strikes ${delta.hits.min === delta.hits.max ? `${delta.hits.min} times` : `${delta.hits.min}–${delta.hits.max} times`} per use.`);
  if (has("lockTicks")) lines.push(`Locks the user out of acting ${signed(delta.lockTicks)} extra tick${Math.abs(delta.lockTicks) === 1 ? "" : "s"} after use.`);
  if (has("situationalBonus")) lines.push(`×${delta.situationalBonus.multiplier} damage when the target is ${conditionLabel(delta.situationalBonus.condition)}.`);
  if (has("selfStateBonus")) lines.push("Scored higher in move-picking when the user itself is at or below half HP.");
  if (has("statChangeOnHit")) {
    const sc = delta.statChangeOnHit;
    const who = sc.target === "self" ? "its own" : "the target's";
    lines.push(
      `${sc.stage > 0 ? "Raises " : "Lowers "}${who} ${STAT_LABEL[sc.stat] ?? sc.stat} by ${Math.abs(sc.stage)} stage${Math.abs(sc.stage) === 1 ? "" : "s"}${sc.ticks ? ` for ${sc.ticks} ticks` : " permanently"}${sc.target === "self" ? " the instant it's used" : " on a landed, non-killing hit"}.`
    );
  }
  if (has("positionSwap") && delta.positionSwap) lines.push("Swaps places with the target on a landed, non-killing hit.");
  if (has("positionSwapPull")) lines.push(`Hauls the target ${delta.positionSwapPull} extra tile${delta.positionSwapPull === 1 ? "" : "s"} past the swap.`);
  if (has("targetsAlly") && delta.targetsAlly) lines.push("Gains a dedicated support use on a nearby ally, on top of staying a real attack.");
  if (has("allyEffect")) {
    const ae = delta.allyEffect;
    const parts: string[] = [];
    if (ae.healFraction) parts.push(`heals ${pct(ae.healFraction)} of max HP`);
    if (ae.buff) parts.push(`buffs ${STAT_LABEL[ae.buff.stat] ?? ae.buff.stat} +${ae.buff.stage} stage${ae.buff.stage === 1 ? "" : "s"}${ae.buff.ticks ? ` for ${ae.buff.ticks} ticks` : ""}`);
    lines.push(`That ally effect: ${parts.join(" and ")}.`);
  }
  if (has("allyEffectOnAttack") && delta.allyEffectOnAttack) lines.push("The ally effect also fires for free whenever this move lands on an enemy, no extra cost.");
  if (has("hitsArea") && delta.hitsArea) lines.push("Hits everyone caught in the move's shape, not just the one target picked.");
  if (has("weightScaling")) lines.push(`Adds ${pct(delta.weightScaling.factor)} of the user's own max HP as bonus power (heavier users hit harder).`);
  if (has("critRateStage")) lines.push(`${signed(delta.critRateStage)} crit-rate stage${Math.abs(delta.critRateStage) === 1 ? "" : "s"}.`);
  if (has("lifestealFraction")) lines.push(`Heals the user ${pct(delta.lifestealFraction)} of the damage a landed hit dealt.`);
  if (has("recoilFraction")) lines.push(`Costs the user ${pct(delta.recoilFraction)} of the damage a landed hit dealt, as recoil.`);
  if (has("jamCooldownTicks")) lines.push(`On a landed hit, adds ${delta.jamCooldownTicks} tick${delta.jamCooldownTicks === 1 ? "" : "s"} to every cooldown the target already has running.`);
  if (has("bonusVsType")) lines.push(`×${delta.bonusVsType.multiplier} damage specifically against ${capitalize(delta.bonusVsType.type)}-type targets.`);
  if (has("resistanceBreaker")) lines.push(`Partially ignores its own type resist — a resisted hit claws back up toward neutral (×${delta.resistanceBreaker.multiplier}, capped there, never becomes super-effective).`);
  if (has("selfCostPerUse")) lines.push(`Costs the user ${pct(delta.selfCostPerUse.amount)} ${delta.selfCostPerUse.need} every time it's used.`);
  if (has("rallyCall")) lines.push(`On a landed, non-killing hit, marks the target as a priority for every nearby ally for ${delta.rallyCall.ticks} ticks.`);
  if (has("critCooldownReset") && delta.critCooldownReset) lines.push("A landed critical hit resets this move's own cooldown to 0.");
  if (has("statusSeverity")) lines.push(`×${delta.statusSeverity} status severity (a stronger damage-over-time, not a longer one).`);
  if (has("statusChance")) lines.push(`${signed(Math.round(delta.statusChance * 100))}% status chance.`);
  if (has("statusSpreads") && delta.statusSpreads) lines.push("A landed status has a chance to also jump to one other nearby target.");
  if (has("consumesOwnTerrain")) lines.push(`×${delta.consumesOwnTerrain.damageMultiplier} damage while standing on ${delta.consumesOwnTerrain.terrain} terrain (consumed either way).`);
  if (has("terrainFill")) lines.push(`Leaves ${delta.terrainFill.terrain} terrain where it lands a hit.`);
  if (has("drainNeeds")) lines.push(`Steals ${Math.round(delta.drainNeeds.amount * 100)}% ${delta.drainNeeds.need} from the nearest non-herd agent within ${delta.drainNeeds.radius} tiles, and gains it.`);
  if (has("fertilityBoost")) lines.push(`Enriches the soil (+${Math.round(delta.fertilityBoost.amount * 100)}% fertility) ${delta.fertilityBoost.radius === 0 ? "on the user's own tile." : `within ${delta.fertilityBoost.radius} tiles.`}`);
  if (has("matingRadiusBoost")) lines.push(`×${delta.matingRadiusBoost.multiplier} mate-search radius for ${delta.matingRadiusBoost.ticks} ticks.`);
  if (has("gatherBurst")) lines.push(`+${delta.gatherBurst} gathering progress per use — digs crops/springs out faster, or knocks canopy fruit down faster, depending on the move.`);
  if (has("forcedMovement")) {
    const fm = delta.forcedMovement;
    const mover = fm.mover === "attacker" ? "The user" : "The target";
    const dir = fm.direction === "closer" ? "toward the other side" : "away from the other side";
    const timing = fm.timing === "beforeHit" ? "before the hit resolves" : "on a landed, non-killing hit";
    lines.push(`${mover} moves ${fm.tiles} tile${fm.tiles === 1 ? "" : "s"} ${dir}, ${timing}.`);
  }
  if (has("chargeAttack")) {
    const ca = delta.chargeAttack;
    lines.push(`Charges for ${ca.ticks} tick${ca.ticks === 1 ? "" : "s"} — invulnerable and unable to act the whole time — then leaps ${ca.leapTiles} tiles toward the target and lands the hit at +${ca.bonusPower} power (fizzles for no damage if the target's gone by then).`);
  }
  if (has("shape")) lines.push(`Changes its own shape to ${shapeLabel(delta.shape)}.`);
  if (has("range")) lines.push(`Changes its max reach to ${delta.range.max != null ? `${delta.range.max} tiles` : JSON.stringify(delta.range)}.`);
  if (has("excludesAllies") && delta.excludesAllies) lines.push("Never affects a herd-mate, even if they'd otherwise be caught in its area.");
  if (has("terrainBurn") && delta.terrainBurn) lines.push("Sets fire to the terrain wherever it lands.");
  return lines;
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Every ADDITIVE numeric delta field — combined by summing (see `combineDeltas`), same fields `applyBuildJS`/the real engine `applyMoveTree` add rather than overwrite. */
const ADDITIVE_FIELDS = [
  "power", "accuracy", "cooldownTicks", "statusChance", "defensePenetration", "lockTicks",
  "critRateStage", "lifestealFraction", "recoilFraction", "jamCooldownTicks", "positionSwapPull", "gatherBurst",
] as const;
/** OR-merge boolean fields — once any chosen node turns one on, it stays on for the whole build. */
const OR_MERGE_FIELDS = ["positionSwap", "targetsAlly", "allyEffectOnAttack", "hitsArea", "excludesAllies", "terrainBurn", "statusSpreads", "critCooldownReset"] as const;

/**
 * Merges every chosen node's `delta` into one net combined delta, using the
 * exact same additive/OR-merge/overwrite rules `applyBuildJS` (the atlas's
 * own faithful port of the real engine's `applyMoveTree`) applies — later
 * chosen nodes win an overwrite field, same as actually respeccing in order
 * would. This is the whole BUILD's net effect, not any one node's.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function combineDeltas(tree: Record<string, MoveTreeNode>, chosenIds: readonly string[]): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = {};
  for (const id of chosenIds) {
    const node = tree[id];
    if (!node) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delta = node.delta as Record<string, any>;
    for (const k of Object.keys(delta)) {
      const v = delta[k];
      if (v === undefined) continue;
      if ((ADDITIVE_FIELDS as readonly string[]).includes(k)) {
        result[k] = (result[k] ?? 0) + v;
      } else if ((OR_MERGE_FIELDS as readonly string[]).includes(k)) {
        result[k] = result[k] || v;
      } else {
        result[k] = v; // overwrite — last chosen node wins, same as applyMoveTree
      }
    }
  }
  return result;
}

/** Plain-English summary of one node's own effect (leaning + passives + its own delta) — shown in the caller-supplied detail area on a node click. */
export function describeMoveTreeNode(node: MoveTreeNode): string[] {
  const details: string[] = [];
  if (node.leaning) details.push(`Leans: ${node.leaning}`);
  if (node.grantsPassive) details.push(describePassive(node.grantsPassive.kind, node.grantsPassive.value));
  for (const p of node.grantsPassives ?? []) details.push(describePassive(p.kind, p.value));
  details.push(...describeDelta(node.delta));
  return details;
}

/**
 * The cumulative, plain-English effect of every node in `chosenIds`,
 * combined into the build's real net delta (see `combineDeltas`) — direct
 * ask: "It'd also be nice to show what all the effects are of the entire
 * build," a real gap the old click-one-node-at-a-time detail view never
 * covered. Reuses the exact same `describeDelta`/`describePassive`
 * translators a single node's own detail line already uses, just fed the
 * whole build's combined delta instead of one node's.
 */
export function summarizeBuildEffects(tree: Record<string, MoveTreeNode>, chosenIds: readonly string[]): { totalCost: number; deltaLines: string[]; passiveLines: string[] } {
  let totalCost = 0;
  const passiveTotals = new Map<string, number>();
  for (const id of chosenIds) {
    const node = tree[id];
    if (!node) continue;
    totalCost += node.cost;
    if (node.grantsPassive) passiveTotals.set(node.grantsPassive.kind, (passiveTotals.get(node.grantsPassive.kind) ?? 0) + node.grantsPassive.value);
    for (const p of node.grantsPassives ?? []) passiveTotals.set(p.kind, (passiveTotals.get(p.kind) ?? 0) + p.value);
  }
  const deltaLines = describeDelta(combineDeltas(tree, chosenIds));
  const passiveLines = [...passiveTotals].map(([kind, value]) => describePassive(kind, value));
  return { totalCost, deltaLines, passiveLines };
}

/**
 * Builds the real radial skill-tree SVG for one move — nodes positioned by
 * `computeLayout`, edges (normal/anyOf/crosslink/bridge) and exclusion
 * connectors drawn beneath them, chosen nodes lit with a checkmark badge,
 * unreachable ones dimmed. `onSelect` (optional) fires on a node click,
 * for a caller that wants to show `describeMoveTreeNode`'s detail text
 * somewhere below the tree.
 */
export function buildMoveTreeSvg(tree: Record<string, MoveTreeNode>, chosenIds: readonly string[], onSelect?: (node: MoveTreeNode) => void): SVGSVGElement {
  const layout = computeLayout(tree);
  const pos = layout.positions;
  const chosenSet = new Set(chosenIds);

  const pad = 26;
  const half = layout.maxR;
  const side = (half + pad) * 2;
  const svg = svgEl("svg", {
    viewBox: `${-half - pad} ${-half - pad} ${side} ${side}`,
    // Real bug report, after a first cut squeezed every tree into a fixed
    // small CSS box: "I think you should be able to see all the skills,
    // even if they aren't specced. In your screenshot it looks like it's
    // missing a bunch." Every node genuinely rendered — `width:100%;
    // height:auto; max-height:340px` was forcing a real ~1300-unit-wide
    // tree (35 nodes, 3 branches several levels deep — a small synthetic
    // test tree doesn't show this) down to roughly a quarter of its natural
    // size, shrinking an 11px node radius and 11px label text to only a
    // few CSS pixels each — visible as faint specks, not "missing." Native
    // 1 SVG unit = 1 CSS px here instead (explicit `width`/`height`
    // attributes, not `100%`), matching the atlas's own true-to-source
    // scale; the caller's CSS makes the surrounding box scroll (both axes)
    // rather than squish a tree that doesn't fit.
    width: side,
    height: side,
    class: "skilltree-svg",
  });
  svg.setAttribute("role", "img");

  const edgesLayer = svgEl("g");
  const nodesLayer = svgEl("g");
  svg.append(edgesLayer, nodesLayer);
  svg.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 5, fill: "none", stroke: "#4a5568", "stroke-width": 1.5 }));

  const edgeIndex: Record<string, SVGLineElement[]> = {};
  function addEdge(fromId: string, toId: string, cls: string, colorOverride?: string): void {
    if (!pos[fromId] || !pos[toId]) return;
    const a = pos[fromId]!;
    const b = pos[toId]!;
    const line = svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: cls, stroke: colorOverride ?? "#56637a" });
    edgesLayer.appendChild(line);
    (edgeIndex[fromId] = edgeIndex[fromId] ?? []).push(line);
    (edgeIndex[toId] = edgeIndex[toId] ?? []).push(line);
  }

  for (const id of Object.keys(tree)) {
    const node = tree[id]!;
    for (const p of node.prerequisites ?? []) addEdge(p, id, isCrosslink(node) ? "edge-cross" : "edge-normal", isCrosslink(node) ? CROSS_COLOR : undefined);
    for (const set of node.prerequisitesAnyOf ?? []) {
      const srcId = set[set.length - 1]!;
      const isBridge = isCrosslinkChainMember(tree, srcId);
      addEdge(srcId, id, isBridge ? "edge-bridge" : "edge-anyof", isBridge ? CROSS_COLOR : undefined);
    }
  }

  const seenExcl = new Set<string>();
  for (const id of Object.keys(tree)) {
    const node = tree[id]!;
    for (const otherId of node.excludes ?? []) {
      const key = [id, otherId].sort().join("|");
      if (seenExcl.has(key)) continue;
      seenExcl.add(key);
      if (!pos[id] || !pos[otherId]) continue;
      const a = pos[id]!;
      const b = pos[otherId]!;
      edgesLayer.appendChild(
        svgEl("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "#e0507a", "stroke-width": 1.3, "stroke-dasharray": "1 3.5", opacity: 0.55 })
      );
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const label = svgEl("text", { x: mx, y: my, "text-anchor": "middle", "dominant-baseline": "middle", fill: "#e0507a", "font-size": 9 });
      label.textContent = "×";
      edgesLayer.appendChild(label);
    }
  }

  const nodeGroups: Record<string, SVGGElement> = {};
  for (const id of Object.keys(tree)) {
    const node = tree[id]!;
    const p = pos[id];
    if (!p) continue;
    const r = nodeRadius(node);
    const color = nodeColor(node);
    const isChosen = chosenSet.has(id);
    const isLocked = !isChosen && !isEligible(tree, chosenSet, id);

    const g = svgEl("g", {
      class: `skilltree-node-hit${isChosen ? " node-chosen" : ""}${isLocked ? " node-locked" : ""}`,
      transform: `translate(${p.x},${p.y})`,
      "data-id": id,
    });

    if (node.cost >= 2 && !isCrosslink(node)) {
      g.appendChild(svgEl("circle", { class: "ring", r: r + 4, fill: "none", stroke: color, "stroke-width": 1, opacity: 0.5 }));
    }
    if (!isCrosslink(node) && isCrosslinkChainMember(tree, id)) {
      g.appendChild(
        svgEl("circle", { class: "ring", r: r + (node.cost >= 2 ? 8 : 4), fill: "none", stroke: CROSS_COLOR, "stroke-width": 1.4, "stroke-dasharray": "2 2", opacity: 0.85 })
      );
    }
    g.appendChild(svgEl("circle", { class: "ring", r, fill: "#0c1015", stroke: color, "stroke-width": 2.2 }));
    g.appendChild(svgEl("circle", { r: r - 5, fill: color, opacity: node.grantsPassive || node.grantsPassives ? 0.95 : 0.55 }));

    const badgeX = r * 0.72;
    const badgeY = -r * 0.72;
    const checkGroup = svgEl("g", { class: "node-check" });
    checkGroup.appendChild(svgEl("circle", { cx: badgeX, cy: badgeY, r: 6, fill: "#43cf95", stroke: "#0c1015", "stroke-width": 1.2 }));
    const check = svgEl("text", { x: badgeX, y: badgeY + 3, "text-anchor": "middle", fill: "#0c1015", "font-size": 8.5, "font-weight": 700 });
    check.textContent = "✓";
    checkGroup.appendChild(check);
    g.appendChild(checkGroup);

    nodesLayer.appendChild(g);

    const lbl = svgEl("text", { x: p.x, y: p.y < 0 ? p.y - r - 8 : p.y + r + 15, "text-anchor": "middle", class: "skilltree-node-label", "font-size": 11 });
    lbl.textContent = node.name;
    nodesLayer.appendChild(lbl);

    if (!(node.grantsPassive || node.grantsPassives)) {
      const costLbl = svgEl("text", { x: p.x, y: p.y + 3.5, "text-anchor": "middle", fill: "#0c1015", "font-size": 9.5 });
      costLbl.textContent = String(node.cost);
      nodesLayer.appendChild(costLbl);
    }

    g.addEventListener("mouseenter", () => applyFocus(id));
    g.addEventListener("mouseleave", () => applyFocus(undefined));
    if (onSelect) {
      g.addEventListener("click", () => onSelect(node));
      g.style.cursor = "pointer";
    }
    nodeGroups[id] = g;
  }

  function applyFocus(id: string | undefined): void {
    for (const nid of Object.keys(nodeGroups)) {
      nodeGroups[nid]!.classList.toggle("node-dim", !!id && nid !== id);
      nodeGroups[nid]!.classList.toggle("node-lit", nid === id);
    }
    for (const nid of Object.keys(edgeIndex)) {
      for (const line of edgeIndex[nid]!) {
        if (!id) {
          line.classList.remove("edge-dim", "edge-lit");
          continue;
        }
        line.classList.toggle("edge-lit", nid === id);
        if (nid !== id) line.classList.add("edge-dim");
      }
    }
  }

  return svg;
}
