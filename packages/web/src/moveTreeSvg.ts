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

/** Plain-English summary of one node's effect, reused from the row header's own former tooltip text — shown in the caller-supplied detail area on click instead of just a native `title` hover. */
export function describeMoveTreeNode(node: MoveTreeNode): string[] {
  const details: string[] = [];
  if (node.leaning) details.push(`Leans: ${node.leaning}`);
  if (node.grantsPassive) details.push(`Grants: ${node.grantsPassive.kind} +${node.grantsPassive.value}`);
  for (const p of node.grantsPassives ?? []) details.push(`Grants: ${p.kind} +${p.value}`);
  const deltaBits = Object.entries(node.delta)
    .filter(([k]) => k !== "shape" && k !== "range")
    .map(([k, v]) => `${k}: ${typeof v === "number" && v > 0 ? "+" : ""}${JSON.stringify(v)}`);
  details.push(...deltaBits);
  return details;
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
  const svg = svgEl("svg", {
    viewBox: `${-half - pad} ${-half - pad} ${(half + pad) * 2} ${(half + pad) * 2}`,
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

    const g = svgEl("g", { class: `skilltree-node-hit${isChosen ? " node-chosen" : ""}${isLocked ? " node-locked" : ""}`, transform: `translate(${p.x},${p.y})` });

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
