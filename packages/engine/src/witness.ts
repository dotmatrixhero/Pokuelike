import type { Agent, World } from "./types.js";
import {
  RAPPORT_DEFEATED_TOGETHER_DELTA,
  RAPPORT_MOURNED_DELTA,
  RAPPORT_SURVIVED_TOGETHER_DELTA,
  rapportScore,
  strengthenRapportMutual,
} from "./rapport.js";

/**
 * Shared experience of a death — the `"survivedTogether"`, `"defeatedTogether"`
 * and `"mourned"` members of `RapportReason`'s shared-experience group (see
 * that type's doc comment for why that group exists at all).
 *
 * **Why a death and not a storm — and the correction to that.** The first
 * version of this reasoned that "we survived that storm" cannot work because
 * `weather.ts` never harms an agent: a storm only shifts accuracy
 * (`stormAccuracyMultiplier`) and sight (`stormFovPenalty`), and exposure is
 * tracked per-*herd* (`World.herdStormExposureTicks`) for migration purposes,
 * never per-agent. That is all true, and it was the wrong test — direct
 * steer: *"Maybe surviving a storm and drought and other weather together
 * would still be worth it if it meaningfully changed their behavior."*
 *
 * Right: the shared experience is the **displacement**, not the damage. That
 * half now lives in `herdMigration.ts` as `"weatheredTogether"`, keyed on a
 * migration the weather actually caused. This module keeps the other half —
 * the case where something was genuinely at stake because *somebody nearby
 * just died, and neither of you was it* — which covers drought by the route
 * drought actually kills through (thirst and famine) rather than by
 * pretending weather does damage.
 *
 * **One pass, not five call sites.** There is no central "an agent dies"
 * helper in this engine — `alive = false` is set in five places across
 * needs.ts, predation.ts (twice), herdConflict.ts and fire.ts. Rather than
 * touch all five, this reads `Agent.diedAtTick`, which every one of them
 * already stamps, and runs once per tick from `tickWorld`. It deliberately
 * does NOT read the event log: `tickWorld`'s `log` is optional, and a
 * mechanic that silently stops working when nobody passes a logger is the
 * kind of thing that makes a test pass for the wrong reason.
 */

/**
 * How far from a death an agent has to be to count as having been there.
 * Deliberately wider than `needs.ts`'s `SOCIALIZE_RADIUS` of 3 — you notice a
 * death from further away than you would choose to sit with someone — but
 * still local, an "in the same clearing" distance rather than a zone-wide
 * announcement. Sim-original guess; judge it against a real run.
 */
export const WITNESS_RADIUS = 5;

/**
 * How much positive rapport a witness needs toward the dead agent before this
 * reads as grief rather than as having watched a stranger die. Well clear of
 * `RAPPORT_PRUNE_THRESHOLD` (0.02) so a single passing interaction never
 * qualifies — roughly the weight of several real deliveries, one defense, or
 * a couple of long stretches of company.
 */
export const MOURNING_MIN_RAPPORT = 0.15;

function chebyshev(a: Agent, b: Agent): number {
  return Math.max(Math.abs(a.pos.x - b.pos.x), Math.abs(a.pos.y - b.pos.y));
}

/**
 * Records the shared-experience rapport owed by every death that happened on
 * this exact tick. Call once per tick from `tickWorld`, after every system
 * that can kill has run.
 *
 * For each death, every living agent within `WITNESS_RADIUS` on the dead
 * agent's own layer is a witness, and **every pair of witnesses** comes away
 * with `"survivedTogether"` — or `"mourned"` instead, when both of them held
 * real positive rapport (`MOURNING_MIN_RAPPORT`) toward the one that died.
 * Mourning replaces rather than stacks: it is the same event seen more
 * closely, not a second one.
 *
 * **Known limitation, deliberately cheap:** the only agent excluded from
 * witnessing is one currently running `"hunt"`, on the grounds that a hunting
 * animal is the cause of a death rather than a fellow survivor of it. Without
 * reading the event log there is no exact killer id available here, so this
 * is a heuristic and not a guarantee — a predator that has already dropped
 * out of `"hunt"` by the end of the tick can still be counted. Worth
 * revisiting if a real run shows predators accumulating survival bonds with
 * their victims' herd-mates.
 */
export function recordDeathWitnesses(world: World, rng: () => number = world.rng): void {
  const deaths = world.agents.filter((a) => a.alive === false && a.diedAtTick === world.tick);
  if (deaths.length === 0) return;

  for (const dead of deaths) {
    const witnesses: Agent[] = [];
    for (const other of world.agents) {
      if (other.id === dead.id) continue;
      if (other.alive === false || other.isEgg) continue;
      if (other.layer !== dead.layer) continue;
      // A hunting animal is why the death happened, not somebody who came
      // through it — see this function's doc comment on the limitation.
      if (other.behavior === "hunt") continue;
      if (chebyshev(other, dead) > WITNESS_RADIUS) continue;
      witnesses.push(other);
    }
    if (witnesses.length < 2) continue;

    for (let i = 0; i < witnesses.length; i++) {
      for (let j = i + 1; j < witnesses.length; j++) {
        const a = witnesses[i]!;
        const b = witnesses[j]!;
        // Name the thing, and say whether it was friend or foe. Computed per
        // pair rather than per death, because "friend" is a question about
        // the two agents remembering it, not about the corpse: it is only a
        // friend when the dead shared a herd with BOTH of them.
        const standing: "friend" | "foe" =
          dead.herdId !== undefined && dead.herdId === a.herdId && dead.herdId === b.herdId ? "friend" : "foe";
        const subject = { label: dead.species, id: dead.id, level: dead.level, standing };
        const bothLoved =
          rapportScore(a, dead.id, world.tick) >= MOURNING_MIN_RAPPORT &&
          rapportScore(b, dead.id, world.tick) >= MOURNING_MIN_RAPPORT;
        if (bothLoved) {
          strengthenRapportMutual(world, a, b, RAPPORT_MOURNED_DELTA, "mourned", "mourned", rng, subject);
        } else if (a.behavior === "fight" && b.behavior === "fight") {
          // Both still swinging as it went down. This is a heuristic, not
          // damage attribution — the engine keeps no per-agent record of who
          // hit whom, so "was fighting at the moment it died, next to it" is
          // the closest honest evidence available. It is deliberately
          // stricter than survival: BOTH have to have been in the fight.
          strengthenRapportMutual(world, a, b, RAPPORT_DEFEATED_TOGETHER_DELTA, "defeatedTogether", "defeatedTogether", rng, subject);
        } else {
          strengthenRapportMutual(world, a, b, RAPPORT_SURVIVED_TOGETHER_DELTA, "survivedTogether", "survivedTogether", rng, subject);
        }
      }
    }
  }
}
