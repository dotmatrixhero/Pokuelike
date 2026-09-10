import type { Agent, MoveSpec, World } from "@pokuelike/engine";
import { LEVELING_CONTEXT, SPECIES } from "@pokuelike/data";
import { describeRapport, rapportScore, speciesDisplayName } from "@pokuelike/engine";
import { TYPE_COLOR, rgbToCss } from "./palette.js";
import { agentDisplayName, herdDisplayName, shortId, LEADER_ICON, TITLE_ICON } from "./notableTitles.js";
import { buildMoveTreeSvg, describeMoveTreeNode, summarizeBuildEffects } from "./moveTreeSvg.js";

// --- Small shared DOM helpers ------------------------------------------------

/**
 * What the viewer clicked to say "show me these" — a whole species, or one
 * named herd. Direct ask: "clicking on herd name or species should auto zoom
 * to them and highlight them on the map."
 *
 * A selection is stored as the QUERY (a species id, or a herd id), never as
 * the list of ids matching it right now. A herd is a live thing: members
 * die, are born, and wander, and a frozen id list would quietly stop
 * highlighting the herd and start highlighting a snapshot of who used to be
 * in it. `main.ts` re-resolves this every frame instead.
 */
export type GroupSelection = { kind: "species"; key: string } | { kind: "herd"; key: string };

/** Everything the inspector can hand back to its host — kept as one object so adding a second interaction later does not thread another parameter through every render function. */
export interface InspectorHooks {
  /** Clicking a species or herd row. Passing the same selection again clears it, so a row acts as a toggle. */
  onFocusGroup?: (selection: GroupSelection) => void;
  /** What is currently focused, so the matching row can render as active. */
  focused?: GroupSelection;
}

function sameSelection(a: GroupSelection | undefined, b: GroupSelection | undefined): boolean {
  return a !== undefined && b !== undefined && a.kind === b.kind && a.key === b.key;
}

/**
 * Turns any row into a clickable "focus this group" control, marked active
 * when it is the current selection.
 *
 * **`pointerdown`, not `click`, and that is not a style preference.** The
 * overview these rows live in is a live readout: `main.ts` marks the
 * inspector dirty every tick on purpose ("the no-selection view is a live
 * population/weather overview, not a static placeholder"), so the whole row
 * list is destroyed and rebuilt several times a second while the sim runs. A
 * `click` only fires if the SAME element survives from mousedown to mouseup,
 * and here it routinely does not — a real browser test clicking a herd row
 * at ordinary speed retried 25 times over 30 seconds and never landed one,
 * every attempt losing the element mid-gesture. Committing on press sidesteps
 * the rebuild entirely.
 *
 * Found by driving the actual app, not by any unit test — the handler is
 * correctly attached and would pass any test that dispatches a synthetic
 * click.
 */
function makeFocusRow(el: HTMLElement, selection: GroupSelection, hooks: InspectorHooks | undefined): HTMLElement {
  if (!hooks?.onFocusGroup) return el;
  const isFocused = sameSelection(hooks.focused, selection);
  el.classList.add("inspect-focusable");
  el.classList.toggle("inspect-focused", isFocused);
  el.title = isFocused ? "Click again to clear the highlight" : "Zoom to them and highlight them on the map";
  el.addEventListener("pointerdown", (event) => {
    // Keeps a press from starting a text selection across the row list,
    // which a press-to-act control should never do.
    event.preventDefault();
    hooks.onFocusGroup!(selection);
  });
  return el;
}

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

/** How many rapport edges the inspector lists. A real agent averages ~11 (cap 16); showing all of them would bury the ones that matter under faint acquaintances. */
const RAPPORT_ROWS_SHOWN = 6;

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

/**
 * The skill nodes this agent has actually bought for `move`.
 *
 * **`agent.moveTreeChoices` is not keyed the way `agent.moves` is**, and
 * reading it as though it were is why the atlas rendered every node
 * un-chosen. Direct report: "i don't see the actual skill allocations being
 * visible." Choices are keyed by the `knownMoves` DEX KEY (`"WATER_GUN"`),
 * `agent.moves` by the `MoveSpec`'s own id (`"water_gun"`), so the plain
 * `agent.moveTreeChoices[move.id]` lookup returned `undefined` every time.
 * Measured over a real 4,000-tick run: that lookup lit **0 nodes across 70
 * rendered trees**, while resolving properly lights **726 across 64** — a
 * level-31 Kingler holding 28 bought Water Gun nodes displayed as having
 * bought none.
 *
 * leveling.ts documents the trap at its write site ("those two are
 * frequently different casings/names for the same move") and handles it for
 * `agent.moves`. Resolving each stored key through
 * `LEVELING_CONTEXT.resolveMove` uses that same engine mapping rather than
 * upper-casing, which the comment explicitly warns is not enough.
 */
function chosenNodesFor(agent: Agent, move: MoveSpec): string[] {
  const choices = agent.moveTreeChoices;
  if (!choices) return [];
  const direct = choices[move.id];
  if (direct) return direct;
  for (const [key, nodes] of Object.entries(choices)) {
    if (LEVELING_CONTEXT.resolveMove(key)?.id === move.id) return nodes;
  }
  return [];
}

/**
 * Renders the inline skill-tree visualization for one move — the real
 * radial layout ported from the "Move Tree Atlas" artifact, see
 * `moveTreeSvg.ts`'s own doc comment. The agent's actual `moveTreeChoices`
 * nodes render lit with a checkmark badge; everything else dims according
 * to whether it's still reachable from here. Clicking a node shows its
 * plain-English effect below the tree instead of only a hover tooltip —
 * direct ask: "I don't see how they're specced either. It'd be nice to see
 * their actual allocations."
 *
 * The tree itself lives in its own scrolling `.skilltree-canvas` box at
 * true native scale — direct report: "I think you should be able to see
 * all the skills, even if they aren't specced. In your screenshot it
 * looks like it's missing a bunch." Every node was always rendered; a real
 * ~30-node tree squeezed to fit a fixed small CSS box just made each one a
 * near-invisible speck (see `buildMoveTreeSvg`'s own doc comment). A
 * `.skilltree-build-summary` above the tree shows the whole build's
 * cumulative effect at a glance — direct follow-up ask: "It'd also be nice
 * to show what all the effects are of the entire build," which the old
 * click-one-node-at-a-time detail line never covered.
 */
function renderMoveTree(move: MoveSpec, chosenIds: string[]): HTMLElement {
  const tree = move.tree!;
  const wrap = document.createElement("div");
  wrap.className = "skilltree";

  const summary = document.createElement("div");
  summary.className = "skilltree-build-summary";
  const { totalCost, deltaLines, passiveLines } = summarizeBuildEffects(tree, chosenIds);
  if (chosenIds.length === 0) {
    summary.textContent = "No nodes chosen yet.";
  } else {
    const header = document.createElement("div");
    const countB = document.createElement("b");
    countB.textContent = String(chosenIds.length);
    const costB = document.createElement("b");
    costB.textContent = String(totalCost);
    header.append(countB, ` node${chosenIds.length === 1 ? "" : "s"} chosen, `, costB, ` pt${totalCost === 1 ? "" : "s"} spent`);
    summary.appendChild(header);
    for (const line of deltaLines) {
      const lineEl = document.createElement("div");
      lineEl.textContent = line;
      summary.appendChild(lineEl);
    }
    for (const line of passiveLines) {
      const lineEl = document.createElement("div");
      lineEl.className = "passive-line";
      lineEl.textContent = line;
      summary.appendChild(lineEl);
    }
  }

  const detail = document.createElement("div");
  detail.className = "skilltree-detail";
  detail.textContent = "Click a node below for its own details.";

  const svg = buildMoveTreeSvg(tree, chosenIds, (node) => {
    const isChosen = chosenIds.includes(node.id);
    const details = describeMoveTreeNode(node);
    detail.textContent = `${node.name} (${node.cost} pt${node.cost === 1 ? "" : "s"}, ${isChosen ? "chosen" : "not chosen"})${details.length ? " — " + details.join(" ") : ""}`;
  });
  const canvas = document.createElement("div");
  canvas.className = "skilltree-canvas";
  canvas.appendChild(svg);

  // Open the scroll box ON the tree, not at its top-left corner.
  //
  // The SVG is deliberately rendered at native scale (see
  // `buildMoveTreeSvg` — a previous fit-to-width version shrank an ~1,200px
  // tree into a ~300px panel and turned every node into a speck), so it is
  // genuinely much wider than the panel and the box scrolls. But a scroll
  // container starts at 0,0, which for a RADIAL layout is the empty corner
  // diagonally away from the root — measured on a real 106-node Tackle
  // tree in a 306px-wide holder: the SVG was 1204px wide, overflowing by
  // 898px, with the first actual content 140px in and 758px of it off the
  // right edge. Direct report: "they're awkwardly positioning from the top
  // left... are the nodes centered and easy to see on expand?"
  //
  // Centring on the CHOSEN nodes rather than the geometric middle when a
  // build exists: the whole reason to open a tree is to see what this
  // animal actually bought, and on a big tree the specced cluster is often
  // nowhere near the centre.
  requestAnimationFrame(() => {
    const cr = canvas.getBoundingClientRect();
    if (cr.width === 0) return;
    // The union of every chosen node (class set by `buildMoveTreeSvg`), or
    // the whole tree when nothing is specced yet.
    const picked = Array.from(svg.querySelectorAll<SVGGraphicsElement>(".node-chosen"));
    const rects = picked.length > 0 ? picked.map((n) => n.getBoundingClientRect()) : [svg.getBoundingClientRect()];
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    canvas.scrollLeft += left - cr.left - (cr.width - (right - left)) / 2;
    canvas.scrollTop += top - cr.top - (cr.height - (bottom - top)) / 2;
  });

  wrap.append(summary, canvas, detail);
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
  // How much of this move's tree the animal has actually bought, alongside
  // how often it uses it — direct ask: "next to move it shows how many times
  // used. can you also show how many nodes allocated?" Shown only for a move
  // that HAS a tree, since "0 nodes" on a treeless move (most of a real
  // moveset — an 11-move Kingler had 2 trees) is noise, not information.
  const nodeCount = hasTree ? chosenNodesFor(agent, move).length : 0;
  useCount.textContent = hasTree ? `${nodeCount} node${nodeCount === 1 ? "" : "s"} · used ${uses}×` : `used ${uses}×`;
  if (hasTree) useCount.title = `${nodeCount} of ${Object.keys(move.tree!).length} skill nodes allocated`;

  header.append(swatch, name, summary, useCount);

  if (hasTree) {
    const caret = document.createElement("span");
    caret.className = "move-caret";
    caret.textContent = expandedKey === moveKey(agent, move) ? "▾" : "▸";
    header.appendChild(caret);
  }

  wrap.appendChild(header);

  if (hasTree && expandedKey === moveKey(agent, move)) {
    const chosen = chosenNodesFor(agent, move);
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
function renderOverview(container: HTMLElement, world: World, hooks: InspectorHooks | undefined): void {
  const title = document.createElement("div");
  title.className = "inspect-title";
  title.textContent = "World overview";
  container.appendChild(title);

  container.appendChild(row("Tick", String(world.tick)));

  const living = world.agents.filter((a) => a.alive !== false);
  const fainted = living.filter((a) => a.fainted).length;
  const corpses = world.agents.length - living.length;
  container.appendChild(row("Population", `${living.length} alive${fainted > 0 ? `, ${fainted} fainted` : ""}${corpses > 0 ? `, ${corpses} corpses` : ""}`));

  // Species, each with the named herds it is currently split across —
  // direct ask: "inspector should show the names of the chronicle herds,
  // next to species that belong to them."
  //
  // Nested rather than a flat "species, herd" pair per line because the
  // relationship really is one-to-many: a species routinely holds several
  // herds at once (the founding one plus every group that has split off or
  // wandered in), and flattening that would repeat the species name three
  // or four times and lose the fact that they are the same animal.
  const perSpecies = new Map<string, number>();
  const herdCounts = new Map<string, Map<string, number>>();
  for (const a of living) {
    perSpecies.set(a.species, (perSpecies.get(a.species) ?? 0) + 1);
    if (!a.herdId) continue;
    const forSpecies = herdCounts.get(a.species) ?? new Map<string, number>();
    forSpecies.set(a.herdId, (forSpecies.get(a.herdId) ?? 0) + 1);
    herdCounts.set(a.species, forSpecies);
  }
  const bySpecies = [...perSpecies.entries()].sort((a, b) => b[1] - a[1]);
  for (const [species, count] of bySpecies) {
    // Compact: the general #inspector row layout's fixed 130px label column
    // (tuned for longer per-agent field names like "Activity pattern") left
    // a huge gap between a short species name and its count on desktop —
    // direct ask: "the label of pokemon to number is super far apart."
    container.appendChild(
      makeFocusRow(row(SPECIES[species]?.name ?? species, String(count), true), { kind: "species", key: species }, hooks)
    );
    const herds = [...(herdCounts.get(species) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
    for (const [herdId, herdCount] of herds) {
      const herdRow = row(herdDisplayName(world, herdId), String(herdCount), true);
      herdRow.classList.add("inspect-herd-row");
      container.appendChild(makeFocusRow(herdRow, { kind: "herd", key: herdId }, hooks));
    }
  }

  if (world.weatherCells && world.weatherCells.length > 0) {
    container.appendChild(row("Weather", world.weatherCells.map((c) => c.type).join(", ")));
  }

  const hint = document.createElement("div");
  hint.className = "inspect-empty";
  hint.textContent = hooks?.onFocusGroup
    ? "Click an agent on the grid to inspect it, or a species/herd above to find them on the map."
    : "Click an agent on the grid to inspect it.";
  container.appendChild(hint);
}

// --- Per-agent panel, grouped ------------------------------------------------

/**
 * Who this animal actually knows — its rapport graph (engine's rapport.ts),
 * strongest feelings first. Direct ask: "we want rapport added to inspector
 * per unit."
 *
 * Shaped by what a real run actually contains rather than by what the -1..1
 * range suggests. Measured over 4,000 ticks: 49 of 57 living agents had
 * rapport, averaging **10.9 edges each** against a hard cap of 16 — far too
 * many to list — and the scores are overwhelmingly small positives (613
 * positive against 1 negative, most between 0.02 and 0.17, with a single
 * maxed 1.00 bond). So:
 *
 * - Only the strongest few are listed, by absolute score, so a real grudge
 *   is never buried under a dozen faint acquaintances.
 * - The bar is scaled to the row's own strongest edge, not to the full
 *   -1..1 range. Against the true range a typical 0.05 bond is a bar two
 *   pixels wide and every relationship looks identical; scaled relatively,
 *   you can see who this animal favours.
 * - The raw score is shown as text next to it, so the relative bar can
 *   never imply a 0.05 bond is a strong one.
 *
 * Edges routinely point at EGGS and at agents that have since died — an edge
 * outlives its subject until decay prunes it. Both are labelled rather than
 * silently dropped: "a lost friend" is a real thing to know about a unit.
 *
 * **Always rendered, even when empty.** See the empty-state branch below —
 * a group that deletes itself is a feature nobody can find.
 */
function renderRapportGroup(agent: Agent, world: World): HTMLElement {
  const edges = Object.keys(agent.rapport ?? {});
  const scored = edges
    .map((id) => ({ id, score: rapportScore(agent, id, world.tick) }))
    .filter((e) => e.score !== 0)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const g = group("Rapport");

  // Always render the group, even empty. It used to return `undefined` and
  // vanish entirely, which made the whole feature invisible: an agent only
  // has rapport after real interaction, so early in a run NOBODY does, and
  // you can click a dozen creatures in a row without ever learning the
  // section exists. Direct report: "I still don't see in the inspector
  // rapport. Is it underneath moves?" — it was above Moves the whole time,
  // just deleting itself. An empty state makes absence legible.
  if (scored.length === 0) {
    g.appendChild(row("", "Knows no one yet.", true));
    return g;
  }
  const shown = scored.slice(0, RAPPORT_ROWS_SHOWN);
  const strongest = Math.max(...shown.map((e) => Math.abs(e.score)));

  for (const edge of shown) {
    const other = world.agents.find((a) => a.id === edge.id);
    const isEgg = other?.isEgg === true || edge.id.startsWith("egg-");
    const gone = !other || other.alive === false;
    const species = other ? SPECIES[other.species]?.name ?? speciesDisplayName(other.species) : "someone";
    const label = isEgg ? `${species} egg` : gone ? `${species} (lost)` : `${species} ${shortId(edge.id)}`;
    // Relative to the strongest edge shown — see this function's doc comment
    // for why the raw -1..1 range makes every real bond look like nothing.
    const fraction = strongest > 0 ? Math.abs(edge.score) / strongest : 0;
    const meterRow = meter(label, fraction, edge.score >= 0 ? "#5fd18a" : "#d1605f");
    const value = meterRow.querySelector(".inspect-meter-value");
    if (value) value.textContent = edge.score.toFixed(2);
    if (gone && !isEgg) meterRow.style.opacity = "0.6";
    g.appendChild(meterRow);

    // The score says how much; this says WHY. A bar alone can only report an
    // outcome — see rapportProse.ts, and EMERGENT_SITUATIONS.md for why
    // causes are the whole point of the memories half of an edge.
    const said = describeRapport(agent, other, edge.id);
    if (said) {
      const line = document.createElement("div");
      line.className = "inspect-rapport-why";
      line.textContent = said;
      if (gone && !isEgg) line.style.opacity = "0.6";
      g.appendChild(line);
    }
  }

  if (scored.length > shown.length) {
    g.appendChild(row("", `+${scored.length - shown.length} weaker`, true));
  }
  return g;
}

/** Renders the click-to-inspect panel for `agent`, or a world-overview summary if nothing is selected, into `container`. */
export function renderInspector(container: HTMLElement, agent: Agent | undefined, world: World, hooks?: InspectorHooks): void {
  if (!agent) {
    container.replaceChildren();
    renderOverview(container, world, hooks);
    return;
  }

  // Re-render in place (not a full DOM replace performed by the caller) so a
  // move-tree toggle click can re-run this whole function without losing
  // scroll position mid-panel.
  const rerender = () => renderInspector(container, agent, world, hooks);
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
  // The selected animal's own herd is clickable too — the natural follow-up
  // to inspecting one member is "where are the rest of them?"
  if (agent.herdId) {
    social.appendChild(makeFocusRow(row("Herd", herdDisplayName(world, agent.herdId), true), { kind: "herd", key: agent.herdId }, hooks));
  }
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

  container.appendChild(renderRapportGroup(agent, world));

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
