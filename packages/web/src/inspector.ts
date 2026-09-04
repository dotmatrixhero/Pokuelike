import type { Agent } from "@pokuelike/engine";
import { SPECIES } from "@pokuelike/data";

function row(label: string, value: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "inspect-row";
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

/** Renders the click-to-inspect panel for `agent` (or a placeholder if nothing is selected) into `container`. */
export function renderInspector(container: HTMLElement, agent: Agent | undefined): void {
  container.replaceChildren();

  if (!agent) {
    const empty = document.createElement("div");
    empty.className = "inspect-empty";
    empty.textContent = "Click an agent on the grid to inspect it.";
    container.appendChild(empty);
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
