import type { Agent, World } from "@pokuelike/engine";
import { SPECIES } from "@pokuelike/data";

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

/** Renders the click-to-inspect panel for `agent`, or a world-overview summary if nothing is selected, into `container`. */
export function renderInspector(container: HTMLElement, agent: Agent | undefined, world: World): void {
  container.replaceChildren();

  if (!agent) {
    renderOverview(container, world);
    return;
  }

  const def = SPECIES[agent.species];
  const title = document.createElement("div");
  title.className = "inspect-title";
  title.textContent = `${def?.name ?? agent.species} (${agent.id})`;
  container.appendChild(title);

  container.appendChild(row("Status", statusOf(agent)));
  container.appendChild(row("Species", agent.species));
  if (agent.level !== undefined) container.appendChild(row("Level", String(agent.level)));
  if (agent.hp !== undefined && agent.maxHp !== undefined) {
    container.appendChild(row("HP", `${agent.hp} / ${agent.maxHp} (${pct(agent.maxHp > 0 ? agent.hp / agent.maxHp : 0)})`));
  }
  if (agent.types && agent.types.length > 0) container.appendChild(row("Types", agent.types.join(" / ")));
  container.appendChild(row("Behavior", agent.behavior));
  container.appendChild(row("Layer", `${agent.layer} (home: ${agent.homeLayer})`));
  container.appendChild(row("Position", `(${agent.pos.x}, ${agent.pos.y})`));
  if (agent.sex) container.appendChild(row("Sex", agent.sex));
  if (agent.age !== undefined) container.appendChild(row("Age", `${agent.age} ticks`));
  if (agent.herdId) container.appendChild(row("Herd", agent.herdId));
  if (agent.nature) container.appendChild(row("Nature", agent.nature));
  if (agent.activityPattern) container.appendChild(row("Activity pattern", agent.activityPattern));
  if (agent.disposition) {
    container.appendChild(
      row(
        "Disposition",
        `bold ${pct(agent.disposition.boldness)}, aggr ${pct(agent.disposition.aggression)}, social ${pct(agent.disposition.sociability)}`
      )
    );
  }
  if (agent.stats) {
    container.appendChild(
      row("Stats", `atk ${agent.stats.attack} / def ${agent.stats.defense} / spd ${agent.stats.speed}`)
    );
  }
  if (agent.huntTarget) container.appendChild(row("Hunting", agent.huntTarget));
  if (agent.fightTarget) container.appendChild(row("Fighting", agent.fightTarget));
  if (agent.needs) {
    container.appendChild(
      row(
        "Needs",
        `hunger ${pct(agent.needs.hunger)}, thirst ${pct(agent.needs.thirst)}, energy ${pct(agent.needs.energy)}, mate ${pct(agent.needs.mateDrive)}`
      )
    );
  }
  if (agent.exp !== undefined) container.appendChild(row("Exp", String(agent.exp)));
}
