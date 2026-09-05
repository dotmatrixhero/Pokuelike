import type { Agent, MoveSpec, MoveTreeNode, World } from "@pokuelike/engine";
import { SPECIES } from "@pokuelike/data";
import { TYPE_COLOR, rgbToCss, rgbaToCss } from "./palette.js";
import { agentDisplayName, herdDisplayName, LEADER_ICON, TITLE_ICON } from "./notableTitles.js";

// --- Small shared DOM helpers ------------------------------------------------

function row(label: string, value: string, compact = false): HTMLElement {
  const el = document.createElement("div");
  el.className = compact ? "inspect-row inspect-row-compact" : "inspect-row";
  const l = document.createElement("span");
  l.className = "inspect-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "inspect-value";
  v.textContent = value;
  el.append(l, v);
  return el;
}

function statusOf(agent: Agent): string {
  if (agent.alive === false) return "dead (corpse)";
  if (agent.fainted) return "fainted";
  return "active";
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** One labeled section with a header matching the app's existing `.panel-header`/`.legend-group-title` typographic convention. */
function group(title: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "inspect-group";
  const h = document.createElement("div");
  h.className = "inspect-group-title";
  h.textContent = title;
  el.appendChild(h);
  return el;
}

/** A labeled 0-1 fraction rendered as a filled bar plus its percentage, instead of a bare decimal/percent string. */
function meter(label: string, fraction: number, colorCss: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "inspect-meter-row";
  const l = document.createElement("span");
  l.className = "inspect-meter-label";
  l.textContent = label;
  const track = document.createElement("div");
  track.className = "inspect-meter-track";
  const fill = document.createElement("div");
  fill.className = "inspect-meter-fill";
  fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  fill.style.background = colorCss;
  track.appendChild(fill);
  const v = document.createElement("span");
  v.className = "inspect-meter-value";
  v.textContent = pct(fraction);
  wrap.append(l, track, v);
  return wrap;
}

/** ♂/♀ with an accessible label — plain symbols (no ZWJ/emoji-presentation) render reliably across fonts, still paired with text for screen readers/hover. */
function sexBadge(sex: "male" | "female"): HTMLElement {
  const el = document.createElement("span");
  el.className = `inspect-sex inspect-sex-${sex}`;
  el.textContent = sex === "male" ? "♂" : "♀";
  el.title = sex;
  el.setAttribute("aria-label", sex);
  return el;
}

function typeColorCss(type: string): string {
  const rgb = (TYPE_COLOR as Record<string, [number, number, number]>)[type];
  return rgb ? rgbToCss(rgb) : "#8b93a1";
}

// --- Moves + skill tree -------------------------------------------------------

/**
 * Which module-scoped move is currently expanded (its skill tree shown),
 * keyed by "<agentId>:<moveId>" so switching to a different agent doesn't
 * carry over an expansion that no longer makes sense. Lives outside
 * `renderInspector` deliberately: the panel gets fully torn down and rebuilt
 * (`container.replaceChildren()`) on every re-render — including every tick
 * while the sim is playing — so any expand/collapse state kept only in the
 * DOM would be wiped out before a user could ever see the tree they just
 * clicked open.
 */
let expandedKey: string | undefined;

function moveKey(agent: Agent, move: MoveSpec): string {
  return `${agent.id}:${move.id}`;
}

/** BFS depth from any root (a node with no prerequisites of either kind) — good enough for a simple layered layout without a real graph-layout algorithm. */
function layerNodes(tree: Record<string, MoveTreeNode>): MoveTreeNode[][] {
  const ids = Object.keys(tree);
  const depth = new Map<string, number>();
  const prereqsOf = (node: MoveTreeNode): string[] => [
    ...(node.prerequisites ?? []),
    ...(node.prerequisitesAnyOf ?? []).flat(),
  ];

  // Roots first (BFS frontier), then relax repeatedly until stable — the
  // tree is a DAG (possibly with `prerequisitesAnyOf` alternate paths of
  // different lengths), so a node's depth is the *max* of its prereqs' + 1,
  // not just the first path found.
  for (const id of ids) if (prereqsOf(tree[id]!).length === 0) depth.set(id, 0);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < ids.length + 1) {
    changed = false;
    for (const id of ids) {
      const node = tree[id]!;
      const prereqs = prereqsOf(node);
      if (prereqs.length === 0) continue;
      const prereqDepths = prereqs.map((p) => depth.get(p));
      if (prereqDepths.some((d) => d === undefined)) continue;
      const next = Math.max(...(prereqDepths as number[])) + 1;
      if (depth.get(id) !== next) {
        depth.set(id, next);
        changed = true;
      }
    }
  }
  // Anything still unresolved (a malformed/cyclic prereq, shouldn't happen
  // in real data) falls back to depth 0 rather than being silently dropped.
  for (const id of ids) if (!depth.has(id)) depth.set(id, 0);

  const maxDepth = Math.max(0, ...depth.values());
  const rows: MoveTreeNode[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const id of ids) rows[depth.get(id)!]!.push(tree[id]!);
  for (const r of rows) r.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** Renders the inline skill-tree visualization for one move, with the agent's chosen nodes lit up. */
function renderMoveTree(move: MoveSpec, chosenIds: string[]): HTMLElement {
  const tree = move.tree!;
  const chosen = new Set(chosenIds);
  const wrap = document.createElement("div");
  wrap.className = "skilltree";

  const accent = typeColorCss(move.type);
  const rows = layerNodes(tree);
  for (const rowNodes of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "skilltree-row";
    for (const node of rowNodes) {
      const isChosen = chosen.has(node.id);
      const nodeEl = document.createElement("div");
      nodeEl.className = `skilltree-node${isChosen ? " skilltree-node-chosen" : " skilltree-node-dim"}`;
      if (isChosen) {
        nodeEl.style.borderColor = accent;
        nodeEl.style.boxShadow = `0 0 6px 1px ${rgbaToCss((TYPE_COLOR as Record<string, [number, number, number]>)[move.type] ?? [139, 147, 161], 0.55)}`;
      }
      const nameEl = document.createElement("div");
      nameEl.className = "skilltree-node-name";
      nameEl.textContent = node.name;
      const costEl = document.createElement("div");
      costEl.className = "skilltree-node-cost";
      costEl.textContent = `${node.cost} pt${node.cost === 1 ? "" : "s"}`;
      nodeEl.append(nameEl, costEl);

      // Nice-to-have detail (delta/leaning/passive) as a native tooltip — cheap, not shipped as its own UI.
      const details: string[] = [];
      if (node.leaning) details.push(`leans: ${node.leaning}`);
      if (node.grantsPassive) details.push(`grants: ${node.grantsPassive.kind} +${node.grantsPassive.value}`);
      for (const p of node.grantsPassives ?? []) details.push(`grants: ${p.kind} +${p.value}`);
      const deltaBits = Object.entries(node.delta)
        .filter(([k]) => k !== "shape" && k !== "range")
        .map(([k, v]) => `${k}: ${typeof v === "number" && v > 0 ? "+" : ""}${JSON.stringify(v)}`);
      details.push(...deltaBits);
      nodeEl.title = `${node.name} (${isChosen ? "chosen" : "not chosen"})${details.length ? "\n" + details.join("\n") : ""}`;

      rowEl.appendChild(nodeEl);
    }
    wrap.appendChild(rowEl);
  }
  return wrap;
}

/** One move row: name/type/power-accuracy summary, use count, and (if it has a tree) a click target that toggles the inline skill-tree view. */
function renderMoveRow(agent: Agent, move: MoveSpec): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "move-row";

  const header = document.createElement("div");
  header.className = "move-row-header";
  const hasTree = !!move.tree && Object.keys(move.tree).length > 0;
  if (hasTree) {
    header.classList.add("move-row-clickable");
    header.tabIndex = 0;
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", String(expandedKey === moveKey(agent, move)));
  }

  const swatch = document.createElement("span");
  swatch.className = "move-type-swatch";
  swatch.style.background = typeColorCss(move.type);
  swatch.title = move.type;

  const name = document.createElement("span");
  name.className = "move-name";
  name.textContent = move.name;

  const summary = document.createElement("span");
  summary.className = "move-summary";
  summary.textContent = `${move.type} · pwr ${move.power} · acc ${move.accuracy}`;

  const uses = agent.moveUseCounts?.[move.id] ?? 0;
  const useCount = document.createElement("span");
  useCount.className = "move-use-count";
  useCount.textContent = `used ${uses}×`;

  header.append(swatch, name, summary, useCount);

  if (hasTree) {
    const caret = document.createElement("span");
    caret.className = "move-caret";
    caret.textContent = expandedKey === moveKey(agent, move) ? "▾" : "▸";
    header.appendChild(caret);
  }

  wrap.appendChild(header);

  if (hasTree && expandedKey === moveKey(agent, move)) {
    const chosen = agent.moveTreeChoices?.[move.id] ?? [];
    wrap.appendChild(renderMoveTree(move, chosen));
  }

  return wrap;
}

function renderMovesGroup(agent: Agent, onToggle: () => void): HTMLElement | undefined {
  if (!agent.moves || agent.moves.length === 0) return undefined;
  const g = group("Moves");
  const list = document.createElement("div");
  list.className = "move-list";
  for (const move of agent.moves) {
    const rowEl = renderMoveRow(agent, move);
    const header = rowEl.querySelector<HTMLElement>(".move-row-clickable");
    if (header) {
      const toggle = () => {
        const key = moveKey(agent, move);
        expandedKey = expandedKey === key ? undefined : key;
        onToggle();
      };
      header.addEventListener("click", toggle);
      header.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      });
    }
    list.appendChild(rowEl);
  }
  g.appendChild(list);
  return g;
}

// --- World overview (no selection) -------------------------------------------

/** With nothing selected, the inspector doubles as a world-overview panel instead of sitting empty. */
function renderOverview(container: HTMLElement, world: World): void {
  const title = document.createElement("div");
  title.className = "inspect-title";
  title.textContent = "World overview";
  container.appendChild(title);

  container.appendChild(row("Tick", String(world.tick)));

  const living = world.agents.filter((a) => a.alive !== false);
  const fainted = living.filter((a) => a.fainted).length;
  const corpses = world.agents.length - living.length;
  container.appendChild(row("Population", `${living.length} alive${fainted > 0 ? `, ${fainted} fainted` : ""}${corpses > 0 ? `, ${corpses} corpses` : ""}`));

  const perSpecies = new Map<string, number>();
  for (const a of living) perSpecies.set(a.species, (perSpecies.get(a.species) ?? 0) + 1);
  const bySpecies = [...perSpecies.entries()].sort((a, b) => b[1] - a[1]);
  for (const [species, count] of bySpecies) {
    // Compact: the general #inspector row layout's fixed 130px label column
    // (tuned for longer per-agent field names like "Activity pattern") left
    // a huge gap between a short species name and its count on desktop —
    // direct ask: "the label of pokemon to number is super far apart."
    container.appendChild(row(SPECIES[species]?.name ?? species, String(count), true));
  }

  if (world.weatherCells && world.weatherCells.length > 0) {
    container.appendChild(row("Weather", world.weatherCells.map((c) => c.type).join(", ")));
  }

  const hint = document.createElement("div");
  hint.className = "inspect-empty";
  hint.textContent = "Click an agent on the grid to inspect it.";
  container.appendChild(hint);
}

// --- Per-agent panel, grouped ------------------------------------------------

/** Renders the click-to-inspect panel for `agent`, or a world-overview summary if nothing is selected, into `container`. */
export function renderInspector(container: HTMLElement, agent: Agent | undefined, world: World): void {
  if (!agent) {
    container.replaceChildren();
    renderOverview(container, world);
    return;
  }

  // Re-render in place (not a full DOM replace performed by the caller) so a
  // move-tree toggle click can re-run this whole function without losing
  // scroll position mid-panel.
  const rerender = () => renderInspector(container, agent, world);
  container.replaceChildren();

  const def = SPECIES[agent.species];
  const title = document.createElement("div");
  title.className = "inspect-title";
  // `agentDisplayName` already prepends the leader marker (see
  // notableTitles.ts's `leaderPrefix`) — only the plain no-title branch below
  // needs its own explicit prefix, since it doesn't call `agentDisplayName`.
  const leaderMark = agent.isHerdLeader ? `${LEADER_ICON} ` : "";
  title.textContent = agent.notableTitle
    ? `${TITLE_ICON[agent.notableTitle]} ${agentDisplayName(agent, def)} (${agent.id})`
    : `${leaderMark}${def?.name ?? agent.species} (${agent.id})`;
  container.appendChild(title);

  // --- Identity ---------------------------------------------------------
  const identity = group("Identity");
  const idRow = document.createElement("div");
  idRow.className = "inspect-identity-row";
  if (agent.types && agent.types.length > 0) {
    for (const t of agent.types) {
      const chip = document.createElement("span");
      chip.className = "type-chip";
      chip.style.background = typeColorCss(t);
      chip.textContent = t;
      idRow.appendChild(chip);
    }
  }
  if (agent.sex) idRow.appendChild(sexBadge(agent.sex));
  if (agent.level !== undefined) {
    const lvl = document.createElement("span");
    lvl.className = "inspect-chip";
    lvl.textContent = `Lv ${agent.level}`;
    idRow.appendChild(lvl);
  }
  if (agent.age !== undefined) {
    const age = document.createElement("span");
    age.className = "inspect-chip";
    age.textContent = `${agent.age} ticks old`;
    idRow.appendChild(age);
  }
  identity.appendChild(idRow);
  identity.appendChild(row("Status", statusOf(agent)));
  container.appendChild(identity);

  // --- Vitals -------------------------------------------------------------
  if (agent.hp !== undefined && agent.maxHp !== undefined) {
    const vitals = group("Vitals");
    const hpFraction = agent.maxHp > 0 ? agent.hp / agent.maxHp : 0;
    const hpColor = hpFraction > 0.5 ? "#5ec26a" : hpFraction > 0.2 ? "#e0b23a" : "#e05a4c";
    vitals.appendChild(meter(`HP ${agent.hp}/${agent.maxHp}`, hpFraction, hpColor));
    if (agent.status) vitals.appendChild(row("Status effect", agent.status.kind, true));
    container.appendChild(vitals);
  }

  // --- Needs ----------------------------------------------------------------
  if (agent.needs) {
    const needs = group("Needs");
    needs.appendChild(meter("Hunger", agent.needs.hunger, "#c98a3c"));
    needs.appendChild(meter("Thirst", agent.needs.thirst, "#4a8cff"));
    needs.appendChild(meter("Energy", agent.needs.energy, "#c9b93c"));
    needs.appendChild(meter("Mate drive", agent.needs.mateDrive, "#d15fb0"));
    container.appendChild(needs);
  }

  // --- Behavior & social ------------------------------------------------
  const social = group("Behavior & social");
  social.appendChild(row("Behavior", agent.behavior, true));
  social.appendChild(row("Layer", `${agent.layer} (home: ${agent.homeLayer})`, true));
  social.appendChild(row("Position", `(${agent.pos.x}, ${agent.pos.y})`, true));
  if (agent.herdId) social.appendChild(row("Herd", herdDisplayName(world, agent.herdId), true));
  if (agent.isHerdLeader) social.appendChild(row("Leadership", `${LEADER_ICON} leads this herd`, true));
  if (agent.nature) social.appendChild(row("Nature", agent.nature, true));
  if (agent.activityPattern) social.appendChild(row("Activity pattern", agent.activityPattern, true));
  if (agent.disposition) {
    social.appendChild(
      row(
        "Disposition",
        `bold ${pct(agent.disposition.boldness)}, aggr ${pct(agent.disposition.aggression)}, social ${pct(agent.disposition.sociability)}`,
        true
      )
    );
  }
  if (agent.huntTarget) social.appendChild(row("Hunting", agent.huntTarget, true));
  if (agent.fightTarget) social.appendChild(row("Fighting", agent.fightTarget, true));
  container.appendChild(social);

  // --- Stats / exp ----------------------------------------------------------
  if (agent.stats || agent.exp !== undefined) {
    const statsGroup = group("Stats");
    if (agent.stats) {
      statsGroup.appendChild(
        row("Combat stats", `atk ${agent.stats.attack} / def ${agent.stats.defense} / spd ${agent.stats.speed}`, true)
      );
    }
    if (agent.exp !== undefined) statsGroup.appendChild(row("Exp", String(agent.exp), true));
    container.appendChild(statsGroup);
  }

  // --- Moves (list + click-to-expand skill trees) ----------------------------
  const movesGroup = renderMovesGroup(agent, rerender);
  if (movesGroup) container.appendChild(movesGroup);
}
